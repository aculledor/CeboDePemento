"""Daily-backup contract with synthetic Docker evidence and real SQLite/files/locks.

No Docker, registry, Git, systemd or production paths are accessed by these tests.
"""
from contextlib import ExitStack
import copy
import fcntl
import importlib.util
import inspect
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("active_backup_deploy", ROOT / "deploy/nuc/deploy.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
REAL_RUN = d.run
REAL_COMPOSE = d.compose
REVISION = "a" * 40
LEGACY = d.IMAGE_REPO + ":sha-" + REVISION + "@sha256:" + "1" * 64
PROMOTED = d.IMAGE_REPO + "-dev@sha256:" + "2" * 64
EARLIER = d.IMAGE_REPO + "-dev@sha256:" + "3" * 64
CONTAINER = "c" * 64
IMAGE = "sha256:" + "d" * 64


class Fixture:
    def __init__(self, root):
        self.root = root
        self.project = root / "project"
        self.state = root / "state"
        self.profiles = root / "profiles"
        self.volume = root / "volume"
        self.backups = root / "exports"
        self.lock = root / "global.lock"
        self.calls = []
        self.fail = None
        self.result = None
        self.must_hold_lock = False
        for folder in (self.project / "deploy", self.state, self.profiles, self.volume / "photos"):
            folder.mkdir(parents=True, mode=0o700)
        for filename, content in {
            ".env": "DATA_VOLUME=cebo_pemento_data\nDATABASE_PATH=data/catalogo.sqlite\nPHOTO_DIRECTORY=data/photos\n",
            "image.env": "APP_IMAGE=" + LEGACY + "\n",
            "compose.yaml": "# reviewed synthetic compose\n",
            "deploy/Caddyfile": "# synthetic gateway\n",
            "ca.crt": "synthetic public certificate\n",
        }.items():
            self.write(self.project / filename, content)
        self.config = {"name": "cebo-pemento", "services": {"app": {
            "image": LEGACY, "environment": {"DATABASE_PATH": "data/catalogo.sqlite", "PHOTO_DIRECTORY": "data/photos"},
            "volumes": [{"type": "volume", "source": "fishing_data", "target": "/app/data"}],
        }}, "volumes": {"fishing_data": {"external": True, "name": "cebo_pemento_data"}}}
        self.container = {"Id": CONTAINER, "Image": IMAGE, "Config": {
            "Image": LEGACY, "Labels": {"com.docker.compose.project": "cebo-pemento",
            "com.docker.compose.service": "app", "com.docker.compose.oneoff": "False",
            "com.docker.compose.project.working_dir": str(self.project)},
            "Env": ["DATABASE_PATH=data/catalogo.sqlite", "PHOTO_DIRECTORY=data/photos"]},
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "Mounts": [{"Type": "volume", "Name": "cebo_pemento_data", "Source": str(self.volume),
                        "Destination": "/app/data", "RW": True}]}
        self.image = {"Id": IMAGE, "Architecture": "amd64", "Os": "linux", "Config": {"Labels": {
            "org.opencontainers.image.source": "https://github.com/aculledor/CeboDePemento",
            "org.opencontainers.image.revision": REVISION}}, "RepoDigests": [d.IMAGE_REPO + "@sha256:" + "1" * 64]}
        self.volume_info = {"Name": "cebo_pemento_data", "Driver": "local", "Options": None,
                            "Mountpoint": str(self.volume)}
        with sqlite3.connect(self.volume / "catalogo.sqlite") as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE captures(id INTEGER PRIMARY KEY, species TEXT)")
            db.execute("INSERT INTO captures VALUES(1,'synthetic-catch')")
        (self.volume / "photos" / "fixture.jpg").write_bytes(b"synthetic-photo")

    def write(self, path, content):
        path.write_text(content if isinstance(content, str) else json.dumps(content))
        path.chmod(0o600)

    def install_specops(self, ref=PROMOTED, current=True, image=True, pending=None, status="prod-ready", revision=REVISION):
        self.container["Config"]["Image"] = ref
        self.image["Config"]["Labels"]["org.opencontainers.image.revision"] = revision
        self.image["RepoDigests"] = [ref.split("@", 1)[0].split(":", 1)[0] + "@" + ref.split("@", 1)[1]]
        normalized = copy.deepcopy(self.config)
        normalized["services"]["app"]["image"] = "SPECOPS_IMAGE"
        profile = {"version": 1, "enabled": True, "app": "cebo", "environment": "prod",
                   "directory": str(self.project), "project": "cebo-pemento", "service": "app",
                   "compose": str(self.project / "compose.yaml"), "env_file": str(self.project / ".env"),
                   "image_variable": "APP_IMAGE", "baseline_image": LEGACY,
                   "seals": {str(self.project / name): d.hashlib.sha256((self.project / name).read_bytes()).hexdigest()
                             for name in ("compose.yaml", ".env", "image.env")},
                   "compose_hash": d.fingerprint(normalized), "database": str(self.volume / "catalogo.sqlite"),
                   "photos": str(self.volume / "photos")}
        self.write(self.profiles / "cebo-prod.json", profile)
        if image:
            self.write(self.state / "cebo-prod-image.json", {"image": ref})
        candidate = {"version": 1, "app": "cebo", "repository": "aculledor/CeboDePemento", "pr": 5,
                     "sha": revision, "tree": "f" * 40, "image": ref.split("@", 1)[0],
                     "digest": ref.split("@", 1)[1], "tested_digest": ref.split("@", 1)[1],
                     "platform": "linux/amd64", "source_run": 17, "publisher_run": 23,
                     "publisher_attempt": 1, "migration": "none", "schema": 0}
        accepted = candidate if d.DEV_REF_RE.fullmatch(ref) else None
        self.write(self.state / "cebo-prod.json", {"current": ref if current else None, "pending": pending,
                   "status": status, "accepted_candidate": accepted, "candidate_id": d.fingerprint(candidate) if accepted else None,
                   "sha": REVISION, "digest": candidate["digest"]})

    def update(self, path, **values):
        data = json.loads(path.read_text()); data.update(values); self.write(path, data)

    def trusted(self, path, private=False):
        # The runner is non-root. Apply the same path/mode rules to fixture-owned
        # files; system ancestors outside this private fixture model root provision.
        path = Path(path)
        if not path.is_relative_to(self.root):
            return
        info = path.lstat()
        if path.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o022 or (private and info.st_mode & 0o077):
            raise d.DeployError("untrusted fixture path")

    def compose(self, *args, overrides=None, **kwargs):
        self.calls.append(("compose", args, overrides))
        if self.must_hold_lock:
            with self.lock.open("a+") as other:
                try:
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    pass
                else:
                    raise AssertionError("runtime selection happened outside global lock")
        if args[0] == "ps":
            return CONTAINER
        if args[0] == "config":
            if "--quiet" in args:
                return ""
            config = copy.deepcopy(self.config)
            config["services"]["app"]["image"] = overrides["APP_IMAGE"]
            return json.dumps(config)
        if args[0] != "run":
            raise AssertionError("Unexpected Compose mutation: " + str(args))
        if self.fail == "snapshot":
            raise d.DeployError("synthetic snapshot fault")
        folder = self.volume / "backups/snapshot-fixture"
        folder.mkdir(parents=True)
        with sqlite3.connect(self.volume / "catalogo.sqlite") as source, sqlite3.connect(folder / "copy.sqlite") as target:
            source.backup(target)
        shutil.copytree(self.volume / "photos", folder / "photos")
        return self.result or json.dumps({"directory": "/app/data/backups/snapshot-fixture"})

    def run(self, *args, **kwargs):
        self.calls.append(("docker", args, None))
        if self.fail and self.fail in args:
            raise d.DeployError("synthetic command fault")
        if args[1] == "inspect":
            return json.dumps([self.container])
        if args[1:3] == ("image", "inspect"):
            return json.dumps([self.image])
        if args[1:3] == ("volume", "inspect"):
            return json.dumps([self.volume_info])
        if args[1] == "create":
            return "synthetic-helper"
        if args[1] == "cp":
            shutil.copytree(self.volume / "backups/snapshot-fixture", args[-1])
            return ""
        if args[1] == "rm":
            return ""
        raise AssertionError("Unexpected Docker command: " + str(args))

    def patches(self):
        stack = ExitStack()
        for key, value in {"PROJECT": self.project, "BACKUPS": self.backups, "SPECOPS_ROOT": self.profiles,
                           "SPECOPS_STATE": self.state, "GLOBAL_LOCK": self.lock, "trusted": self.trusted,
                           "compose": self.compose, "run": self.run}.items():
            stack.enter_context(patch.object(d, key, value))
        return stack


class ActiveBackupTests(unittest.TestCase):
    def fixture(self):
        temp = self.enterContext(tempfile.TemporaryDirectory())
        fixture = Fixture(Path(temp))
        self.enterContext(fixture.patches())
        return fixture

    def test_legacy_baseline_without_any_specops_state(self):
        f = self.fixture()
        selected = d.active_backup()
        self.assertEqual(selected["image"], LEGACY)
        self.assertEqual(selected["specops"], {"mode": "legacy"})

    def test_installed_specops_baseline_without_first_promotion(self):
        f = self.fixture(); f.install_specops(LEGACY, current=False, image=False)
        self.assertEqual(d.active_backup()["image"], LEGACY)
        (f.state / "cebo-prod.json").unlink()
        self.assertEqual(d.active_backup()["specops"]["mode"], "specops-baseline")
        f.install_specops(LEGACY, current=False, image=True)
        self.assertEqual(d.active_backup()["image"], LEGACY)

    def test_promoted_digest_and_rollback_to_prior_dev_or_legacy(self):
        f = self.fixture()
        for ref in (PROMOTED, EARLIER, LEGACY):
            with self.subTest(ref=ref):
                f.install_specops(ref, status="rolled-back" if ref != PROMOTED else "prod-ready",
                                  revision="e" * 40 if ref == EARLIER else REVISION)
                # Engine.rollback retains historical digest/sha fields.
                f.update(f.state / "cebo-prod.json", digest="sha256:" + "9" * 64, sha="9" * 40,
                         selected_candidate={"digest": "sha256:" + "9" * 64})
                self.assertEqual(d.active_backup()["image"], ref)

    def test_runtime_and_state_drift_reject_before_snapshot(self):
        f = self.fixture(); f.install_specops()
        cases = [
            (f.state / "cebo-prod-image.json", {"image": EARLIER}),
            (f.state / "cebo-prod.json", {"current": EARLIER}),
            (f.state / "cebo-prod.json", {"pending": {"phase": "verifying", "new": PROMOTED}}),
            (f.state / "cebo-prod.json", {"current": None}),
            (f.state / "cebo-prod.json", {"current": ""}),
            (f.state / "cebo-prod.json", {"candidate_id": "0" * 64}),
            (f.profiles / "cebo-prod.json", {"database": "/other/data.sqlite"}),
            (f.profiles / "cebo-prod.json", {"photos": "/other/photos"}),
            (f.profiles / "cebo-prod.json", {"baseline_image": EARLIER}),
            (f.profiles / "cebo-prod.json", {"compose_hash": "0" * 64}),
        ]
        for path, values in cases:
            with self.subTest(path=path.name, values=values):
                original = path.read_bytes(); f.update(path, **values)
                with self.assertRaises(d.DeployError): d.active_backup()
                path.write_bytes(original)
        self.assertFalse(any(call[0] == "compose" and call[1][0] == "run" for call in f.calls))

    def test_all_pending_transaction_phases_are_rejected(self):
        f = self.fixture()
        for phase in ("deploying", "verifying", "rolling-back"):
            f.install_specops(pending={"phase": phase})
            with self.subTest(phase=phase), self.assertRaisesRegex(d.DeployError, "pending-transaction"):
                d.active_backup()

    def test_missing_or_partial_state_never_authorizes_dev_ref(self):
        f = self.fixture(); f.install_specops()
        for path in (f.state / "cebo-prod.json", f.state / "cebo-prod-image.json", f.profiles / "cebo-prod.json"):
            with self.subTest(path=path.name):
                original = path.read_bytes(); path.unlink()
                with self.assertRaises(d.DeployError): d.active_backup()
                f.write(path, original.decode())
        shutil.rmtree(f.state); shutil.rmtree(f.profiles)
        with self.assertRaisesRegex(d.DeployError, "legacy-image-drift"): d.active_backup()

    def test_seals_symlinks_permissions_and_ambiguous_json_fail_closed(self):
        f = self.fixture(); f.install_specops()
        path = f.state / "cebo-prod-image.json"; original = path.read_bytes()
        for content in ('{"image":"x","image":"y"}', '{"image":NaN}', '[]', 'broken'):
            f.write(path, content)
            with self.subTest(content=content), self.assertRaises(d.DeployError): d.active_backup()
        f.write(path, original.decode()); path.chmod(0o644)
        with self.assertRaises(d.DeployError): d.active_backup()
        path.chmod(0o600); target = f.root / "target.json"; path.rename(target); path.symlink_to(target)
        with self.assertRaises(d.DeployError): d.active_backup()
        path.unlink(); target.rename(path)
        (f.project / ".env").write_text("DATA_VOLUME=different\n")
        with self.assertRaisesRegex(d.DeployError, "seal-drift"): d.active_backup()

    def test_container_image_volume_and_oci_provenance_matrix(self):
        f = self.fixture(); f.install_specops()
        cases = [
            (f.container, "Id", "f" * 64),
            (f.container["Config"]["Labels"], "com.docker.compose.project", "cebo-pemento-dev"),
            (f.container["Config"]["Labels"], "com.docker.compose.service", "caddy"),
            (f.container["Config"]["Labels"], "com.docker.compose.oneoff", "True"),
            (f.container["Config"]["Labels"], "com.docker.compose.project.working_dir", "/other"),
            (f.container["State"]["Health"], "Status", "unhealthy"),
            (f.container["State"], "Running", False),
            (f.container["State"], "Paused", True),
            (f.container["State"], "Restarting", True),
            (f.container["Config"], "Image", d.IMAGE_REPO + "-dev:latest"),
            (f.container["Config"], "Image", "evil.invalid/cebo@sha256:" + "2" * 64),
            (f.container, "Image", "sha256:" + "e" * 64),
            (f.image, "Architecture", "arm64"),
            (f.image, "RepoDigests", []),
            (f.image["Config"]["Labels"], "org.opencontainers.image.source", "https://github.com/evil/repo"),
            (f.image["Config"]["Labels"], "org.opencontainers.image.revision", "f" * 40),
            (f.container["Mounts"][0], "Name", "cebo-pemento-dev_data"),
            (f.container["Mounts"][0], "Type", "bind"),
            (f.container["Mounts"][0], "RW", False),
            (f.container["Mounts"][0], "Source", "/another/volume"),
            (f.container["Config"], "Env", ["DATABASE_PATH=data/wrong.sqlite", "PHOTO_DIRECTORY=data/photos"]),
            (f.container["Config"], "Env", ["DATABASE_PATH=data/catalogo.sqlite", "DATABASE_PATH=data/wrong.sqlite"]),
            (f.config["services"]["app"], "build", {"context": "."}),
            (f.volume_info, "Driver", "nfs"),
            (f.volume_info, "Options", {"device": "/other"}),
        ]
        for obj, key, value in cases:
            with self.subTest(key=key, value=value):
                old = obj.get(key); existed = key in obj; obj[key] = value
                with self.assertRaises(d.DeployError): d.active_backup()
                if existed: obj[key] = old
                else: del obj[key]

    def test_rejects_missing_multiple_containers_and_unexpected_mounts(self):
        f = self.fixture()
        for ids in ("", CONTAINER + "\n" + "f" * 64, "short"):
            with patch.object(d, "compose", return_value=ids), self.assertRaisesRegex(d.DeployError, "container-identity"):
                d.active_backup()
        f.container["Mounts"].append({"Type": "bind", "Destination": "/etc/private"})
        with self.assertRaises(d.DeployError): d.active_backup()

    def test_missing_database_and_symlinked_data_never_seed_a_replacement(self):
        f = self.fixture(); f.install_specops()
        database = f.volume / "catalogo.sqlite"; moved = f.root / "original.sqlite"; database.rename(moved)
        with self.assertRaisesRegex(d.DeployError, "database-missing"): d.active_backup()
        self.assertFalse(database.exists())
        database.symlink_to(moved)
        with self.assertRaisesRegex(d.DeployError, "data-symlink"): d.active_backup()
        database.unlink(); moved.rename(database)
        shutil.rmtree(f.volume / "photos")
        with self.assertRaisesRegex(d.DeployError, "photos-missing-or-type"): d.active_backup()

    def test_legacy_installation_without_uploaded_photos_remains_supported(self):
        f = self.fixture(); shutil.rmtree(f.volume / "photos")
        self.assertEqual(d.active_backup()["image"], LEGACY)
        f.install_specops(LEGACY, current=False, image=False)
        self.assertEqual(d.active_backup()["image"], LEGACY)
        f.install_specops(LEGACY, current=False, image=True)
        self.assertEqual(d.active_backup()["image"], LEGACY)

    def test_backup_export_restore_metadata_and_no_production_mutations(self):
        f = self.fixture(); f.install_specops(); before = (f.project / "image.env").read_bytes()
        writer = sqlite3.connect(f.volume / "catalogo.sqlite")
        self.addCleanup(writer.close)
        writer.execute("PRAGMA wal_autocheckpoint=0")
        writer.execute("INSERT INTO captures VALUES(2,'committed-in-wal')"); writer.commit()
        self.assertTrue(Path(str(f.volume / "catalogo.sqlite") + "-wal").stat().st_size > 0)
        selected = d.active_backup()
        directory, snapshot = d.backup(selected["image"], verified=selected)
        metadata = json.loads((directory / "release.json").read_text())
        self.assertEqual(metadata["image"], PROMOTED)
        self.assertEqual(metadata["runtime"], selected)
        self.assertEqual(d.env_values((directory / "image.env").read_text())["APP_IMAGE"], PROMOTED)
        self.assertEqual((f.project / "image.env").read_bytes(), before)
        for path in (directory / "release.json", directory / "image.env", directory / ".env", directory / "compose.yaml"):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
        # Restore the exported SQLite/photos into new paths, never the live data.
        with sqlite3.connect(directory / "snapshot/copy.sqlite") as source, sqlite3.connect(f.root / "restored.sqlite") as restored:
            source.backup(restored)
            self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            self.assertEqual(restored.execute("SELECT species FROM captures").fetchone(), ("synthetic-catch",))
            self.assertEqual(restored.execute("SELECT species FROM captures WHERE id=2").fetchone(), ("committed-in-wal",))
        self.assertEqual((directory / "snapshot/photos/fixture.jpg").read_bytes(), b"synthetic-photo")
        compose_run = next(c for c in f.calls if c[0] == "compose" and c[1][0] == "run")
        self.assertEqual(compose_run[2], {"APP_IMAGE": PROMOTED})
        self.assertNotIn("--build", compose_run[1]); self.assertNotIn("--no-build", compose_run[1])
        self.assertIn("never", compose_run[1])
        helper = next(c[1] for c in f.calls if c[0] == "docker" and c[1][1] == "create")
        self.assertIn(PROMOTED, helper); self.assertIn("--pull=never", helper)
        self.assertIn("type=volume,src=cebo_pemento_data,dst=/app/data,readonly", helper)
        self.assertTrue(any(c[0] == "docker" and c[1][1] == "rm" for c in f.calls))
        for call in f.calls:
            self.assertFalse({"pull", "build", "stop", "up", "down", "restart", "fetch", "enable"} & set(call[1]))

    def test_export_errors_remove_only_helper_and_never_mark_success(self):
        for fault in ("snapshot", "create", "cp", "rm"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as temp:
                f = Fixture(Path(temp))
                with f.patches():
                    f.install_specops(); selected = d.active_backup(); f.fail = fault
                    with self.assertRaises(d.DeployError): d.backup(PROMOTED, verified=selected)
                self.assertFalse(list(f.backups.rglob("release.json")))
                removed = any(c[0] == "docker" and c[1][1] == "rm" for c in f.calls)
                self.assertEqual(removed, fault in ("cp", "rm"))

    def test_invalid_snapshot_response_never_exports_or_marks_success(self):
        for response in ('not-json', '{}', '{"directory":"/etc/private"}'):
            with self.subTest(response=response), tempfile.TemporaryDirectory() as temp:
                f = Fixture(Path(temp))
                with f.patches():
                    f.install_specops(); selected = d.active_backup(); f.result = response
                    with self.assertRaises((d.DeployError, ValueError, KeyError)):
                        d.backup(PROMOTED, verified=selected)
                self.assertFalse(list(f.backups.rglob("release.json")))
                self.assertFalse(any(c[0] == "docker" and c[1][1] == "create" for c in f.calls))

    @unittest.skipUnless(shutil.which("node") and (ROOT / "apps/api/dist/restore.js").is_file(),
                         "Node restore integration runs after npm build in hosted CI")
    def test_export_restores_with_existing_application_function_to_new_targets(self):
        f = self.fixture(); f.install_specops(); selected = d.active_backup()
        directory, _ = d.backup(PROMOTED, verified=selected)
        (ROOT / "data").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="backup-restore-test-", dir=ROOT / "data") as temp:
            target = Path(temp)
            script = "import {pathToFileURL} from 'node:url'; const {restoreSnapshot}=await import(pathToFileURL(process.argv[1]).href); await restoreSnapshot(...process.argv.slice(2));"
            args = ["node", "--input-type=module", "-e", script, str(ROOT / "apps/api/dist/restore.js"),
                    str(directory / "snapshot"), str(target / "restored.sqlite"), str(target / "photos")]
            result = subprocess.run(args, capture_output=True, text=True, timeout=30, env={**os.environ, "NODE_ENV": "test"})
            self.assertEqual(result.returncode, 0, result.stderr)
            with sqlite3.connect(target / "restored.sqlite") as db:
                self.assertEqual(db.execute("SELECT species FROM captures").fetchone(), ("synthetic-catch",))
            self.assertEqual((target / "photos/fixture.jpg").read_bytes(), b"synthetic-photo")
            again = subprocess.run(args, capture_output=True, text=True, timeout=30, env={**os.environ, "NODE_ENV": "test"})
            self.assertNotEqual(again.returncode, 0)
            self.assertEqual(json.loads((directory / "release.json").read_text())["image"], PROMOTED)

    def test_post_snapshot_drift_is_not_marked_as_verified(self):
        f = self.fixture(); f.install_specops(); selected = d.active_backup()
        f.container["State"]["Health"]["Status"] = "unhealthy"
        with self.assertRaises(d.DeployError): d.backup(PROMOTED, verified=selected)
        self.assertFalse(list(f.backups.rglob("release.json")))

    def test_cli_backup_selects_inside_real_global_lock(self):
        for ref in (None, PROMOTED, EARLIER, LEGACY):
            with self.subTest(ref=ref), tempfile.TemporaryDirectory() as temp:
                f = Fixture(Path(temp)); f.must_hold_lock = True
                revision = "e" * 40 if ref == EARLIER else REVISION
                if ref: f.install_specops(ref, status="rolled-back" if ref != PROMOTED else "prod-ready", revision=revision)
                before = (f.project / "image.env").read_bytes()
                with f.patches(), patch.object(d.os, "geteuid", return_value=0), \
                     patch.object(sys, "argv", ["deploy", "--backup"]):
                    d.main()
                releases = list(f.backups.rglob("release.json")); self.assertEqual(len(releases), 1)
                release = json.loads(releases[0].read_text()); expected = ref or LEGACY
                self.assertEqual(release["image"], expected)
                self.assertEqual(release["runtime"]["image"], expected)
                self.assertEqual(release["runtime"]["revision"], revision)
                self.assertEqual(d.env_values((releases[0].parent / "image.env").read_text())["APP_IMAGE"], expected)
                self.assertEqual((f.project / "image.env").read_bytes(), before)

    def test_cli_lock_timeout_never_selects_or_exports(self):
        f = self.fixture()
        with patch.object(d.os, "geteuid", return_value=0), patch.object(sys, "argv", ["deploy", "--backup"]), \
             patch.object(d, "acquire_lock", side_effect=d.DeployError("timeout")):
            with self.assertRaisesRegex(d.DeployError, "timeout"): d.main()
        self.assertEqual(f.calls, [])
        self.assertFalse(f.backups.exists())

    def test_real_process_lock_contention_timeout_then_release(self):
        f = self.fixture()
        code = "import fcntl,sys; f=open(sys.argv[1],'a+'); fcntl.flock(f,fcntl.LOCK_EX); print('locked',flush=True); sys.stdin.readline()"
        holder = subprocess.Popen([sys.executable, "-c", code, str(f.lock)], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), "locked")
            with f.lock.open("a+") as lock:
                self.assertFalse(d.acquire_lock(lock))
                with self.assertRaisesRegex(d.DeployError, "no se ha creado copia"):
                    d.acquire_lock(lock, backup_mode=True, timeout=0.05)
                holder.communicate("release\n", timeout=5)
                self.assertTrue(d.acquire_lock(lock, backup_mode=True, timeout=1))
        finally:
            if holder.poll() is None: holder.kill(); holder.communicate()
        self.assertEqual(inspect.signature(d.acquire_lock).parameters["timeout"].default, 300)
        self.assertIn("TimeoutStartSec=900", (ROOT / "deploy/nuc/cebo-pemento-backup.service").read_text())

    def test_legacy_check_is_read_only_and_dev_refs_stay_forbidden_for_auto(self):
        f = self.fixture(); f.install_specops()
        with patch.object(d.os, "geteuid", return_value=0), patch.object(sys, "argv", ["deploy", "--check"]):
            d.main()
        self.assertEqual([c[1] for c in f.calls], [("config", "--quiet")])
        f.write(f.project / "image.env", "APP_IMAGE=" + PROMOTED + "\n")
        with patch.object(d.os, "geteuid", return_value=0), patch.object(sys, "argv", ["deploy", "--auto"]):
            with self.assertRaises(d.DeployError): d.main()
        with self.assertRaises(d.DeployError): d.deploy(PROMOTED, LEGACY)

    @unittest.skipUnless(shutil.which("docker"), "Docker CLI schema check runs on hosted CI")
    def test_real_compose_cli_options_and_effective_config_without_daemon_mutations(self):
        f = self.fixture()
        (f.project / "compose.yaml").write_bytes((ROOT / "compose.yaml").read_bytes())
        with patch.object(d, "run", REAL_RUN):
            config = json.loads(REAL_COMPOSE("config", "--format", "json", overrides={"APP_IMAGE": PROMOTED}))
        f.config = config
        f.install_specops()
        self.assertEqual(d.active_backup()["image"], PROMOTED)
        result = subprocess.run(["docker", "compose", "run", "--rm", "--no-deps", "--pull", "never", "--help"],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_backup_maintenance_changes_are_outside_candidate_scope(self):
        from specops_delivery.render import CONFIGS
        from specops_delivery.scope import affected
        files = [{"filename": name} for name in ("deploy/nuc/deploy.py", "tests/test_nuc_backup_active.py",
                                                 "docs/SPECOPS_BACKUP.md", "docs/NUC.md")]
        self.assertFalse(affected(files, CONFIGS["cebo"]["candidate_paths"]))


if __name__ == "__main__":
    unittest.main()
