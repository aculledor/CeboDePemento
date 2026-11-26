#!/usr/bin/env python3
"""Offline reusable DEV CA. Renewal publishes a NEW bundle, never live files."""
import argparse
import hashlib
import os
from pathlib import Path
import ssl
import stat
import subprocess
import tempfile

HOST = "cebo-dev.home.arpa"
CA_DAYS, LEAF_DAYS = 1825, 365
BUNDLE = {"root.crt", "server.crt", "server.key"}


def run(*args):
    return subprocess.run(["openssl", *args], check=True, capture_output=True, text=True,
                          stdin=subprocess.DEVNULL, timeout=30,
                          env={"PATH": os.defpath, "LC_ALL": "C", "OPENSSL_CONF": "/dev/null"}).stdout.strip()


def path_check(value):
    path = Path(value).absolute()
    if any(part.is_symlink() for part in [path, *path.parents]):
        raise ValueError("Certificate paths must not contain symlinks")
    return path.resolve()


def checked_file(path, private=False):
    path = path_check(path)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o022:
        raise ValueError("Unsafe certificate file")
    if private and (info.st_uid != os.geteuid() or info.st_mode & 0o077):
        raise ValueError("CA key must belong to the operator and have mode 0600")
    return path


def fingerprint(path):
    return hashlib.sha256(ssl.PEM_cert_to_DER_cert(Path(path).read_text())).hexdigest()


def extension(path, name):
    return " ".join(run("x509", "-in", str(path), "-noout", "-ext", name).split())


def key_matches(certificate, key):
    return run("x509", "-in", str(certificate), "-pubkey", "-noout") == run("pkey", "-in", str(key), "-pubout")


def validate_ca(ca):
    if ca.stat().st_uid != os.geteuid() or ca.stat().st_mode & 0o077:
        raise ValueError("Offline CA directory must belong to the operator and have mode 0700")
    crt, key = checked_file(ca / "root.crt"), checked_file(ca / "root.key", private=True)
    if not key_matches(crt, key):
        raise ValueError("CA certificate/key mismatch")
    if extension(crt, "basicConstraints") != "X509v3 Basic Constraints: critical CA:TRUE, pathlen:0":
        raise ValueError("CA must have critical CA:TRUE and pathlen:0")
    expected = ("X509v3 Name Constraints: critical Permitted: DNS:" + HOST +
                " Excluded: IP:0.0.0.0/0.0.0.0 IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0")
    if extension(crt, "nameConstraints") != expected:
        raise ValueError("CA name constraints must be exactly the reviewed DEV policy")
    if extension(crt, "keyUsage") != "X509v3 Key Usage: critical Certificate Sign, CRL Sign":
        raise ValueError("CA signing usage invalid")
    identity = run("x509", "-in", str(crt), "-noout", "-subject", "-issuer", "-nameopt", "RFC2253").splitlines()
    if identity[0].removeprefix("subject=") != identity[1].removeprefix("issuer="):
        raise ValueError("Expected a self-signed offline root")
    run("verify", "-check_ss_sig", "-CAfile", str(crt), str(crt))
    # A one-year leaf must not outlive the root. Rotate the root deliberately
    # when its remaining lifetime is insufficient; never do that silently.
    try:
        run("x509", "-in", str(crt), "-noout", "-checkend", str(LEAF_DAYS * 86400 + 300))
    except subprocess.CalledProcessError as error:
        raise ValueError("CA has less than one leaf lifetime remaining; plan root rollover") from error


def validate_bundle(tls, ca, expired_leaf=False):
    if not tls.is_dir() or tls.stat().st_mode & 0o022:
        raise ValueError("TLS directory must not be writable by group or others")
    if set(p.name for p in tls.iterdir()) != BUNDLE:
        raise ValueError("TLS bundle must contain only leaf, leaf key and public root")
    for name in BUNDLE:
        checked_file(tls / name)
    if (tls / "server.key").stat().st_mode & 0o007:
        raise ValueError("Leaf key must not be world-readable")
    if fingerprint(tls / "root.crt") != fingerprint(ca / "root.crt"):
        raise ValueError("Incorrect CA: current DEV trust must not change on renewal")
    if not key_matches(tls / "server.crt", tls / "server.key"):
        raise ValueError("Leaf certificate/key mismatch")
    if extension(tls / "server.crt", "subjectAltName") != "X509v3 Subject Alternative Name: DNS:" + HOST:
        raise ValueError("Leaf SAN must be exactly the DEV hostname")
    run("verify", *( ["-no_check_time"] if expired_leaf else [] ), "-purpose", "sslserver",
        "-CAfile", str(ca / "root.crt"), "-verify_hostname", HOST, str(tls / "server.crt"))


def destinations(ca_dir, tls_dir):
    ca, tls = path_check(ca_dir), path_check(tls_dir)
    if ca.is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("CA private keys must live outside the repository")
    if ca == tls or ca.is_relative_to(tls) or tls.is_relative_to(ca):
        raise ValueError("CA and deployable TLS directories must be separate")
    if tls.exists() and (not tls.is_dir() or any(tls.iterdir())):
        raise ValueError("Use a new empty TLS destination; active keys are never overwritten")
    tls.parent.mkdir(parents=True, exist_ok=True)
    return ca, tls


def leaf(ca, output):
    output.mkdir(mode=0o750)
    with tempfile.TemporaryDirectory() as tmp:
        csr = Path(tmp) / "server.csr"
        run("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
            "-subj", "/CN=" + HOST, "-keyout", str(output / "server.key"), "-out", str(csr))
        ext = Path(tmp) / "leaf.cnf"
        ext.write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:" + HOST + "\n")
        run("x509", "-req", "-in", str(csr), "-CA", str(ca / "root.crt"), "-CAkey", str(ca / "root.key"),
            "-set_serial", "0x" + os.urandom(16).hex(), "-days", str(LEAF_DAYS), "-extfile", str(ext), "-out", str(output / "server.crt"))
    (output / "root.crt").write_bytes((ca / "root.crt").read_bytes())
    for file in output.iterdir():
        file.chmod(0o640 if file.suffix == ".key" else 0o644)
        if os.geteuid() == 0:
            os.chown(file, 0, 1000)
    if os.geteuid() == 0:
        os.chown(output, 0, 1000)
    validate_bundle(output, ca)


def publish_bundle(ca, tls):
    # Same-filesystem rename publishes all three files together. Failures and
    # concurrent writers cannot replace a populated existing directory.
    with tempfile.TemporaryDirectory(prefix=".cebo-tls-", dir=tls.parent) as tmp:
        stage = Path(tmp) / "bundle"
        leaf(ca, stage)
        publish_directory(stage, tls)


def publish_directory(stage, destination):
    for path in stage.iterdir():
        with path.open("rb") as stream: os.fsync(stream.fileno())
    fd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)
    os.rename(stage, destination)
    fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def issue(ca_dir, tls_dir):
    ca, tls = destinations(ca_dir, tls_dir)
    if ca.exists() and (not ca.is_dir() or any(ca.iterdir())):
        raise ValueError("Use a new empty CA directory; use --renew to retain existing trust")
    ca.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".cebo-ca-", dir=ca.parent) as tmp:
        stage = Path(tmp) / "ca"; stage.mkdir(mode=0o700)
        cfg = Path(tmp) / "root.cnf"
        cfg.write_text("""[req]
distinguished_name=dn
x509_extensions=ca
prompt=no
[dn]
CN=Cebo DEV restricted offline root
[ca]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
nameConstraints=critical,permitted;DNS:cebo-dev.home.arpa,excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:::/::
""")
        run("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
            "-days", str(CA_DAYS), "-config", str(cfg), "-keyout", str(stage / "root.key"), "-out", str(stage / "root.crt"))
        for file in stage.iterdir(): file.chmod(0o600)
        validate_ca(stage)
        with tempfile.TemporaryDirectory(prefix=".cebo-tls-", dir=tls.parent) as bundle_tmp:
            bundle = Path(bundle_tmp) / "bundle"
            leaf(stage, bundle)
            publish_directory(stage, ca)
            publish_directory(bundle, tls)


def renew(ca_dir, current_tls_dir, output_dir):
    ca, output = destinations(ca_dir, output_dir)
    current = path_check(current_tls_dir)
    if output == current or output.is_relative_to(current) or current.is_relative_to(output):
        raise ValueError("Renewal output must be a separate new directory")
    validate_ca(ca)
    # Expired leaves can be renewed; the CA itself must still be valid. Check
    # chain/SAN/key and same root even when the old leaf has already expired.
    validate_bundle(current, ca, expired_leaf=True)
    publish_bundle(ca, output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ca-dir", required=True)
    parser.add_argument("--tls-dir", required=True, help="Initial destination, or current bundle for --renew")
    parser.add_argument("--renew", action="store_true")
    parser.add_argument("--output-dir", help="New empty bundle destination, required for --renew")
    args = parser.parse_args()
    try:
        if args.renew:
            if not args.output_dir: parser.error("--renew requires a separate --output-dir")
            renew(args.ca_dir, args.tls_dir, args.output_dir)
        else:
            if args.output_dir: parser.error("--output-dir only applies to --renew")
            issue(args.ca_dir, args.tls_dir)
    except (ValueError, OSError, subprocess.SubprocessError):
        parser.exit(1, "DEV TLS issuance rejected; check CA identity, validity, constraints and private paths. Active bundle unchanged.\n")
    print("DEV leaf verified (365 days); retain the five-year CA private key offline. No trust store modified.")
