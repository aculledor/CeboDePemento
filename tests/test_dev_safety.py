"""Offline security regressions, including real constrained-certificate validation."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import yaml

ROOT = Path(__file__).parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


v = module("dev_validator", "scripts/validate-dev.py")
certs = module("dev_certificates", "scripts/dev-certificates.py")
deployer = module("deploy_backup", "deploy/nuc/deploy.py")


def rendered():
    # Render only the small Compose subset offline; hosted smoke validates the
    # authoritative `docker compose config --format json` for both modes too.
    text = (ROOT / "deploy/dev/compose.yaml").read_text()
    values = {"CEBO_DEV_IMAGE": "ghcr.io/aculledor/cebo-de-pemento-dev@sha256:" + "a" * 64,
              "CEBO_DEV_HOST": "cebo-dev.home.arpa", "CEBO_DEV_BIND": "192.168.1.145"}
    text = re.sub(r"\$\{([A-Z_]+):\?[^}]*\}", lambda m: values[m[1]], text)
    config = yaml.safe_load(text)
    for service in config["services"].values():
        for field in ("mem_limit", "memswap_limit"):
            service[field] = int(service[field].removesuffix("m")) * 1024 ** 2
        service["networks"] = {name: {} for name in service["networks"]}
        if service.get("ports"):
            ip, published, target = service["ports"][0].split(":")
            service["ports"] = [{"host_ip": ip, "published": published, "target": int(target)}]
        mounts = []
        for mount in service["volumes"]:
            if isinstance(mount, str):
                source, target = mount.split(":")
                mounts.append({"type": "volume", "source": source, "target": target})
            else:
                mount["source"] = str((ROOT / "deploy/dev" / mount["source"]).resolve())
                mounts.append(mount)
        service["volumes"] = mounts
    return config


class WorkflowSafety(unittest.TestCase):
    def setUp(self):
        self.workflow = yaml.safe_load((ROOT / ".github/workflows/ci-ghcr.yml").read_text())

    def test_only_main_publisher_can_write_packages(self):
        jobs = self.workflow["jobs"]
        self.assertEqual(self.workflow["permissions"], {"contents": "read"})
        writers = [name for name, job in jobs.items() if job.get("permissions", {}).get("packages") == "write"]
        self.assertEqual(writers, ["publish"])
        self.assertEqual(jobs["test-image"]["permissions"], {"contents": "read"})
        self.assertEqual(jobs["publish"]["if"], "github.event_name == 'push' && github.ref == 'refs/heads/main'")
        self.assertEqual(jobs["publish"]["needs"], "test-image")

    def test_no_checkout_credentials_or_pr_execution_in_publisher(self):
        for name, job in self.workflow["jobs"].items():
            for step in job["steps"]:
                if step.get("uses", "").startswith("actions/checkout@"):
                    self.assertIs(step["with"]["persist-credentials"], False)
                    self.assertNotEqual(name, "publish")
        for name in ("validate", "test-image"):
            self.assertIn("Verificar ausencia de credenciales antes de ejecutar código",
                          [s.get("name") for s in self.workflow["jobs"][name]["steps"]])
        steps = self.workflow["jobs"]["publish"]["steps"]
        text = json.dumps(steps)
        for command in ("npm ", "scripts/", "docker run", "docker build", "build-push-action", "checkout@"):
            self.assertNotIn(command, text)
        self.assertIn("--preserve-digests", text)
        self.assertIn("skopeo copy --all", text)
        self.assertIn('actual', text)
        self.assertTrue(any(step.get("if") == "always()" and "ghcr-auth.json" in step.get("run", "") for step in steps))
        names = [step.get("name", "") for step in steps]
        self.assertLess(names.index("Validar OCI antes de autenticar o escribir en el registro"),
                        names.index("Autenticar solo al publicador confiable"))

    def test_prs_export_internal_build_input_without_credentials_or_candidate_publication(self):
        image = self.workflow["jobs"]["test-image"]
        exports = [s for s in image["steps"] if s.get("with", {}).get("name") == "cebo-tested-oci"]
        self.assertEqual(len(exports), 1)
        self.assertEqual(exports[0]["if"], "github.event_name == 'push' && github.ref == 'refs/heads/main'")
        self.assertEqual(len([s for s in image["steps"] if "build-push-action" in s.get("uses", "")]), 1)
        for name in ("validate", "test-image"):
            for step in self.workflow["jobs"][name]["steps"]:
                self.assertNotIn("GITHUB_TOKEN", step.get("env", {}))
                self.assertNotIn("GHCR_TOKEN", step.get("env", {}))
                self.assertNotIn("github.token", json.dumps(step))
        candidate_inputs=[s for s in image['steps'] if s.get('with',{}).get('name')=='specops-cebo-build-v1']
        self.assertEqual(len(candidate_inputs),1)
        self.assertIn('head.repo.full_name == github.repository',candidate_inputs[0]['if'])
        self.assertIn('user.id == 45120213',candidate_inputs[0]['if'])
        self.assertEqual(candidate_inputs[0]['with']['retention-days'],7)
        self.assertNotIn("specops-candidate-v1", json.dumps(self.workflow))


class DevPolicy(unittest.TestCase):
    def setUp(self):
        self.config = rendered()

    def check(self, config=None, mode="lan"):
        v.validate(config or self.config, mode, ROOT / "deploy/dev")

    def test_valid_lan_and_ci(self):
        self.check()
        ci = copy.deepcopy(self.config)
        ci["services"]["app-dev"]["image"] = "sha256:" + "a" * 64
        ci["services"]["gateway-dev"]["ports"][0]["host_ip"] = "127.0.0.1"
        self.check(ci, "ci")

    def test_reject_mutable_images_partial_hosts_and_prod_project(self):
        for path, value in [
            (("name",), "cebo-pemento"),
            (("services", "app-dev", "image"), "cebo-pemento:dev"),
            (("services", "app-dev", "image"), "ghcr.io/aculledor/cebo-de-pemento@sha256:" + "a" * 64),
            (("services", "app-dev", "environment", "APP_ORIGINS"), "https://127.0.0.1:18444"),
            (("services", "gateway-dev", "environment", "DEV_HOST"), "127.0.0.1"),
            (("volumes", "fishing_data", "name"), "cebo_pemento_data"),
            (("volumes", "fishing_data", "external"), True),
            (("networks", "ingress", "name"), "media_net"),
            (("networks", "ingress", "driver_opts"), {"example": "bind"}),
            (("services", "gateway-dev", "user"), "0:0"),
            (("services", "app-dev", "cgroup_parent"), "system.slice"),
            (("services", "gateway-dev", "oom_score_adj"), 0),
            (("services", "app-dev", "memswap_limit"), 1024 ** 3),
            (("services", "app-dev", "labels", v.LABEL), "prod"),
        ]:
            c = copy.deepcopy(self.config); target = c
            for key in path[:-1]: target = target[key]
            target[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(ValueError): self.check(c)

    def test_wrong_project_does_not_reuse_prod_services_or_volume_names(self):
        prod = yaml.safe_load((ROOT / "compose.yaml").read_text())
        self.assertFalse(set(prod["services"]) & set(self.config["services"]))
        self.assertNotIn("cebo_pemento_data", json.dumps(self.config))
        for resource in [*self.config["volumes"].values(), *self.config["networks"].values()]:
            self.assertTrue(resource["name"].startswith("cebo-pemento-dev_"))
            self.assertEqual(resource["labels"][v.LABEL], "dev")

    def test_foreign_bind_dns_and_extra_network_are_rejected(self):
        c = copy.deepcopy(self.config)
        c["services"]["gateway-dev"]["volumes"][0]["source"] = "/opt/servicios/cebo-pemento/deploy/Caddyfile"
        with self.assertRaises(ValueError): self.check(c)
        c = copy.deepcopy(self.config); c["services"]["app-dev"]["dns"] = ["192.168.1.145"]
        with self.assertRaises(ValueError): self.check(c)
        c = copy.deepcopy(self.config); c["services"]["app-dev"]["networks"]["media_net"] = {}
        with self.assertRaises(ValueError): self.check(c)

    def test_firewall_missing_or_bypassed_fails_closed(self):
        rules = {"FORWARD": ["-A FORWARD -j DOCKER-USER"], "DOCKER-USER": ["-A DOCKER-USER -j SPECOPS-DEV-FWD"],
                 "INPUT": ["-A INPUT -j SPECOPS-DEV-HOST"]}
        for chain in ("SPECOPS-DEV-FWD", "SPECOPS-DEV-HOST"):
            rules[chain] = [f"-A {chain} -s {s}" + (f" ! -d {s}" if chain.endswith("FWD") else "") +
                            " -m conntrack --ctstate NEW -j DROP" for s in sorted(v.SUBNETS)] + [f"-A {chain} -j RETURN"]
        v.firewall(rules.__getitem__)
        rules["INPUT"].insert(0, "-A INPUT -j ACCEPT")
        with self.assertRaises(ValueError): v.firewall(rules.__getitem__)
        rules["INPUT"].pop(0); rules["SPECOPS-DEV-HOST"].pop(0)
        with self.assertRaises(ValueError): v.firewall(rules.__getitem__)

    def test_restart_authority_is_central_controller(self):
        self.assertTrue(all(s["restart"] == "no" for s in self.config["services"].values()))
        self.assertFalse(list((ROOT / "deploy/dev").rglob("*.timer")))

    def test_slice_limits_are_enforced_not_only_declared(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); group = root / "servidor.slice/servidor-dev.slice"; group.mkdir(parents=True)
            limits = {"memory.max": str(1152 * 1024 ** 2), "memory.swap.max": "0", "pids.max": "512", "cpu.max": "175000 100000"}
            for name, value in limits.items(): (group / name).write_text(value)
            def command(*args):
                return json.dumps({"CgroupDriver": "systemd", "CgroupVersion": "2"}) if args[0] == "docker" else "/servidor.slice/servidor-dev.slice"
            with patch.object(v, "command", side_effect=command):
                v.resources(root)
                for name, value in (("memory.max", str(2048 * 1024 ** 2)), ("memory.swap.max", "1"),
                                    ("cpu.max", "200000 100000"), ("pids.max", "1024")):
                    (group / name).write_text(value)
                    with self.subTest(name=name), self.assertRaises(ValueError): v.resources(root)
                    (group / name).write_text(limits[name])

    def test_boot_preflight_refuses_memory_or_disk_pressure_before_dns(self):
        from types import SimpleNamespace
        with patch.object(Path, "read_text", return_value="MemAvailable: 100 kB\n"), patch.object(v.socket, "socket") as sock:
            with self.assertRaisesRegex(ValueError, "host-memory-insufficient"): v.host_health()
            sock.assert_not_called()
        with patch.object(Path, "read_text", return_value="MemAvailable: 2097152 kB\n"), \
                patch.object(v.shutil, "disk_usage", return_value=SimpleNamespace(free=1)), patch.object(v.socket, "socket") as sock:
            with self.assertRaisesRegex(ValueError, "host-disk-insufficient"): v.host_health()
            sock.assert_not_called()


class Certificates(unittest.TestCase):
    def test_constrained_root_leaf_tls_and_invalid_domain(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); ca, tls = root / "offline", root / "tls"
            certs.issue(ca, tls)
            self.assertEqual({p.name for p in tls.iterdir()}, {"server.key", "server.crt", "root.crt"})
            text = subprocess.check_output(["openssl", "x509", "-in", str(ca / "root.crt"), "-noout", "-text"], text=True)
            self.assertIn("Name Constraints: critical", text)
            self.assertIn("DNS:cebo-dev.home.arpa", text)
            self.assertEqual((ca / "root.key").stat().st_mode & 0o777, 0o600)
            certs.run("verify", "-CAfile", str(ca / "root.crt"), "-verify_hostname", certs.HOST, str(tls / "server.crt"))
            csr = root / "wrong.csr"; wrong_key = root / "wrong.key"
            certs.run("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
                      "-subj", "/CN=example.com", "-keyout", str(wrong_key), "-out", str(csr))
            ext = root / "wrong.ext"; ext.write_text("subjectAltName=DNS:example.com\nbasicConstraints=critical,CA:FALSE\n")
            wrong_cert = root / "wrong.crt"
            certs.run("x509", "-req", "-in", str(csr), "-CA", str(ca / "root.crt"), "-CAkey", str(ca / "root.key"),
                      "-set_serial", "99", "-days", "1", "-extfile", str(ext), "-out", str(wrong_cert))
            result = subprocess.run(["openssl", "verify", "-CAfile", str(ca / "root.crt"), str(wrong_cert)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("permitted subtree violation", result.stderr)
            with self.assertRaises(ValueError): certs.issue(ca, tls)

    def test_ca_must_not_be_inside_deployable_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): certs.issue(Path(tmp) / "tls/ca", Path(tmp) / "tls")
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            certs.issue(ROOT / "untracked-ca", ROOT / "deploy/dev/tls")

    def test_certificate_paths_cannot_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); real = root / "real"; real.mkdir(); link = root / "link"; link.symlink_to(real)
            with self.assertRaises(ValueError): certs.issue(link, root / "tls")


class BackupLock(unittest.TestCase):
    def test_backup_waits_then_proceeds_and_auto_skips(self):
        with patch.object(deployer.fcntl, "flock", side_effect=[BlockingIOError(), None]), patch.object(deployer.time, "sleep"):
            self.assertTrue(deployer.acquire_lock(1, backup_mode=True, clock=lambda: 1, pause=lambda _: None))
        with patch.object(deployer.fcntl, "flock", side_effect=BlockingIOError()):
            self.assertFalse(deployer.acquire_lock(1))

    def test_backup_timeout_fails_instead_of_false_success(self):
        with patch.object(deployer.fcntl, "flock", side_effect=BlockingIOError()):
            with self.assertRaisesRegex(deployer.DeployError, "no se ha creado copia"):
                deployer.acquire_lock(1, backup_mode=True, timeout=1, clock=iter([0, 2]).__next__, pause=lambda _: None)


if __name__ == "__main__":
    unittest.main()
