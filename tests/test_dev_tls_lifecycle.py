"""Real OpenSSL lifecycle, failure atomicity, expiry and fixed SpecOps TLS paths."""
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


certs = module("tls_lifecycle", "scripts/dev-certificates.py")
v = module("tls_guard", "scripts/validate-dev.py")


def ends(path):
    values = certs.run("x509", "-in", str(path), "-noout", "-dates").splitlines()
    return [ssl.cert_time_to_seconds(line.split("=", 1)[1]) for line in values]


def contents(directory):
    return {str(p.relative_to(directory)): p.read_bytes() for p in directory.rglob("*") if p.is_file()}


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.ca = self.root / "offline-ca"
        self.install = self.root / "installed"; self.install.mkdir()
        self.tls = self.install / "tls"
        certs.issue(self.ca, self.tls)

    def test_five_year_ca_one_year_leaf_and_no_issuer_in_bundle(self):
        self.assertEqual(ends(self.ca / "root.crt")[1] - ends(self.ca / "root.crt")[0], 1825*86400)
        self.assertEqual(ends(self.tls / "server.crt")[1] - ends(self.tls / "server.crt")[0], 365*86400)
        self.assertEqual(set(contents(self.tls)), certs.BUNDLE)
        self.assertEqual((self.ca / "root.key").stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.tls / "server.key").stat().st_mode & 0o777, 0o640)
        self.assertTrue(v.tls_health(self.install)["valid"])

    def test_renewal_retains_root_rotates_leaf_and_preserves_active_bundle(self):
        before_ca, before_tls = contents(self.ca), contents(self.tls)
        output = self.root / "renewed"
        certs.renew(self.ca, self.tls, output)
        self.assertEqual(contents(self.ca), before_ca)
        self.assertEqual(contents(self.tls), before_tls)
        self.assertEqual(certs.fingerprint(output / "root.crt"), certs.fingerprint(self.tls / "root.crt"))
        self.assertNotEqual((output / "server.crt").read_bytes(), before_tls["server.crt"])
        self.assertNotEqual((output / "server.key").read_bytes(), before_tls["server.key"])
        certs.validate_bundle(output, self.ca)
        self.assertEqual(set(contents(output)), certs.BUNDLE)
        # No symlink/generation mount changes: central Compose hash stays fixed.
        self.assertFalse(any(p.is_symlink() for p in output.iterdir()))

    def test_wrong_ca_and_mismatched_ca_key_leave_active_files_untouched(self):
        other = self.root / "other-ca"; certs.issue(other, self.root / "other-tls")
        before = contents(self.tls)
        with self.assertRaisesRegex(ValueError, "Incorrect CA"):
            certs.renew(other, self.tls, self.root / "wrong-output")
        (self.ca / "root.key").write_bytes((other / "root.key").read_bytes())
        with self.assertRaisesRegex(ValueError, "CA certificate/key mismatch"):
            certs.renew(self.ca, self.tls, self.root / "wrong-output")
        self.assertEqual(contents(self.tls), before)
        self.assertFalse((self.root / "wrong-output").exists())

    def test_missing_or_broadened_ca_constraints_are_rejected(self):
        for constraints in (None, "critical,permitted;DNS:home.arpa"):
            args = ["req", "-x509", "-key", str(self.ca / "root.key"), "-subj", "/CN=test root", "-days", "1825",
                    "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]
            if constraints: args += ["-addext", "nameConstraints=" + constraints]
            certs.run(*args, "-out", str(self.ca / "root.crt"))
            with self.subTest(constraints=constraints), self.assertRaisesRegex(ValueError, "name constraints"):
                certs.renew(self.ca, self.tls, self.root / "bad-constraints")
            self.assertFalse((self.root / "bad-constraints").exists())

    def test_ca_must_cover_full_leaf_lifetime_and_bad_permissions_are_rejected(self):
        certs.run("x509", "-in", str(self.ca / "root.crt"), "-signkey", str(self.ca / "root.key"),
                  "-days", "1", "-out", str(self.ca / "root.crt"))
        with self.assertRaisesRegex(ValueError, "leaf lifetime"):
            certs.renew(self.ca, self.tls, self.root / "short-ca")
        (self.ca / "root.key").chmod(0o644)
        with self.assertRaisesRegex(ValueError, "mode 0600"):
            certs.renew(self.ca, self.tls, self.root / "loose-key")

    def test_signing_failure_does_not_publish_half_a_pair(self):
        before_ca, before_tls = contents(self.ca), contents(self.tls)
        original = certs.run
        def sign(*args):
            if args[:2] == ("x509", "-req"):
                raise subprocess.CalledProcessError(1, ["openssl", "x509"])
            return original(*args)
        with patch.object(certs, "run", side_effect=sign), self.assertRaises(subprocess.CalledProcessError):
            certs.renew(self.ca, self.tls, self.root / "failed")
        self.assertFalse((self.root / "failed").exists())
        self.assertEqual(contents(self.ca), before_ca); self.assertEqual(contents(self.tls), before_tls)

    def test_no_in_place_overwrite_symlink_or_hardlink_keys(self):
        before = contents(self.tls)
        with self.assertRaises(ValueError): certs.renew(self.ca, self.tls, self.tls)
        link = self.root / "link"; link.symlink_to(self.install, target_is_directory=True)
        with self.assertRaises(ValueError): certs.renew(self.ca, link / "tls", self.root / "new")
        os.link(self.ca / "root.key", self.root / "key-hardlink")
        with self.assertRaises(ValueError): certs.renew(self.ca, self.tls, self.root / "new")
        self.assertEqual(contents(self.tls), before)

    def test_wrong_leaf_san_is_rejected_even_with_valid_key(self):
        csr, ext = self.root / "wrong.csr", self.root / "wrong.ext"
        certs.run("req", "-new", "-key", str(self.tls / "server.key"), "-subj", "/CN=wrong", "-out", str(csr))
        ext.write_text("subjectAltName=DNS:child.cebo-dev.home.arpa\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n")
        certs.run("x509", "-req", "-in", str(csr), "-CA", str(self.ca / "root.crt"), "-CAkey", str(self.ca / "root.key"),
                  "-set_serial", "12345", "-days", "1", "-extfile", str(ext), "-out", str(self.tls / "server.crt"))
        with self.assertRaisesRegex(ValueError, "SAN"):
            certs.renew(self.ca, self.tls, self.root / "wrong-san")

    def test_expired_leaf_is_renewable_with_valid_same_ca(self):
        csr, ext = self.root / "expired.csr", self.root / "expired.ext"
        certs.run("req", "-new", "-key", str(self.tls / "server.key"), "-subj", "/CN=" + certs.HOST, "-out", str(csr))
        ext.write_text("subjectAltName=DNS:" + certs.HOST + "\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n")
        # Real expired fixture, not a mocked verification result.
        database, serial, config = (self.root / name for name in ("index", "serial", "signer.cnf"))
        database.write_text(""); serial.write_text("01\n")
        config.write_text(f"""[ca]
default_ca=signer
[signer]
database={database}
serial={serial}
new_certs_dir={self.root}
certificate={self.ca / 'root.crt'}
private_key={self.ca / 'root.key'}
default_md=sha256
policy=names
[names]
commonName=supplied
""")
        certs.run("ca", "-config", str(config), "-batch", "-notext", "-startdate", "20200101000000Z", "-enddate", "20200102000000Z",
                  "-in", str(csr), "-extfile", str(ext), "-out", str(self.tls / "server.crt"))
        with redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, "tls-invalid-or-expired"):
            v.tls_health(self.install)
        certs.renew(self.ca, self.tls, self.root / "renewed-expired")
        certs.validate_bundle(self.root / "renewed-expired", self.ca)

    def test_leaf_warning_at_30_days_does_not_block_and_is_not_repeated(self):
        expiry = ends(self.tls / "server.crt")[1]
        status = self.root / "cebo-dev-tls.json"
        self.assertEqual(v.tls_health(self.install, status, expiry - 31*86400)["warnings"], [])
        with redirect_stdout(io.StringIO()) as output:
            value = v.tls_health(self.install, status, expiry - 30*86400)
        self.assertTrue(value["valid"])
        self.assertEqual(value["warnings"], ["server-expires-within-30-days"])
        self.assertIn("<4>DEV TLS", output.getvalue())
        before = status.stat().st_mtime_ns
        with redirect_stdout(io.StringIO()) as output:
            v.tls_health(self.install, status, expiry - 30*86400 + 1)
        self.assertEqual(output.getvalue(), ""); self.assertEqual(status.stat().st_mtime_ns, before)
        self.assertEqual(status.stat().st_mode & 0o777, 0o600)
        with redirect_stdout(io.StringIO()), self.assertRaises(ValueError): v.tls_health(self.install, status, expiry + 1)
        self.assertIn("server-expired", json.loads(status.read_text())["warnings"])

    def test_ca_warning_is_emitted_too_and_no_issuer_key_is_needed(self):
        ca, install = self.root / "short-fixture-ca", self.root / "short-fixture"
        install.mkdir()
        with patch.object(certs, "CA_DAYS", 45), patch.object(certs, "LEAF_DAYS", 40):
            certs.issue(ca, install / "tls")
        expiry = ends(ca / "root.crt")[1]
        # Simulates a near-expiring public root while the leaf is still valid.
        with redirect_stdout(io.StringIO()): value = v.tls_health(install, now=expiry - 30*86400)
        self.assertTrue(value["valid"])
        self.assertIn("ca-expires-within-30-days", value["warnings"])
        self.assertEqual(set(contents(install / "tls")), certs.BUNDLE)
        status = self.root / "expired-root-status.json"
        with redirect_stdout(io.StringIO()), self.assertRaises(ValueError):
            v.tls_health(install, status, expiry + 1)
        self.assertIn("ca-expired", json.loads(status.read_text())["warnings"])

    def test_leaf_key_mismatch_and_unsafe_status_file_are_rejected(self):
        other = self.root / "other-ca"; other_tls = self.root / "other-tls"
        certs.issue(other, other_tls)
        original = (self.tls / "server.key").read_bytes()
        (self.tls / "server.key").write_bytes((other_tls / "server.key").read_bytes())
        with self.assertRaisesRegex(ValueError, "Leaf certificate/key mismatch"):
            certs.renew(self.ca, self.tls, self.root / "bad-key")
        (self.tls / "server.key").write_bytes(original)
        real = self.root / "untouched"; real.write_text("private unrelated state")
        link = self.root / "status.json"; link.symlink_to(real)
        with self.assertRaisesRegex(ValueError, "tls-status-permissions"):
            v.tls_health(self.install, link)
        self.assertEqual(real.read_text(), "private unrelated state")

    def test_specops_fixed_paths_and_seals_need_deliberate_update_after_renewal(self):
        old_seals = {name: hashlib.sha256(data).hexdigest() for name, data in contents(self.tls).items()}
        output = self.root / "new-bundle"; certs.renew(self.ca, self.tls, output)
        new_seals = {name: hashlib.sha256(data).hexdigest() for name, data in contents(output).items()}
        self.assertEqual(old_seals["root.crt"], new_seals["root.crt"])
        self.assertNotEqual(old_seals["server.crt"], new_seals["server.crt"])
        # Installing uses the SAME fixed paths/mounts; no symlinks, Compose or image change.
        for name in certs.BUNDLE: (self.tls / name).write_bytes((output / name).read_bytes())
        self.assertTrue(v.tls_health(self.install)["valid"])
        self.assertEqual({name: hashlib.sha256(data).hexdigest() for name, data in contents(self.tls).items()}, new_seals)

    def test_expiry_check_is_hooked_to_every_existing_tick_without_new_service(self):
        dropin = (ROOT / "deploy/dev/systemd/specops-cebo-dev.conf").read_text()
        self.assertIn("ExecStartPre=", dropin)
        self.assertIn("--tls-only", dropin)
        self.assertIn("/var/lib/servidor-specops/cebo-dev-tls.json", dropin)
        self.assertFalse(list((ROOT / "deploy/dev").rglob("*.timer")))
