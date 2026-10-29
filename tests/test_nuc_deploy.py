"""Offline safety/state-machine tests. Never call Docker, Git, systemd or the NUC."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("cebo_deploy", Path(__file__).parents[1] / "deploy/nuc/deploy.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
SHA = "a" * 40
OLD = d.IMAGE_REPO + ":sha-" + "b" * 40 + "@sha256:" + "1" * 64
NEW = d.IMAGE_REPO + ":sha-" + SHA + "@sha256:" + "2" * 64


class DeployTests(unittest.TestCase):
    def test_digest_and_architecture_must_match_approved_commit(self):
        data = {"Architecture": "amd64", "Os": "linux", "Config": {"Labels": {"org.opencontainers.image.revision": SHA}}, "RepoDigests": [d.IMAGE_REPO + "@sha256:" + "2" * 64]}
        self.assertEqual(d.pinned_image(SHA, data), NEW)
        for field, value in [("Architecture", "arm64"), ("RepoDigests", ["evil.invalid/image@sha256:" + "2" * 64])]:
            with self.assertRaises(d.DeployError):
                d.pinned_image(SHA, dict(data, **{field: value}))
        data["Config"]["Labels"]["org.opencontainers.image.revision"] = "c" * 40
        with self.assertRaises(d.DeployError):
            d.pinned_image(SHA, data)

    def test_env_updates_preserve_other_settings_and_reject_ambiguous_input(self):
        original = "# private\nLAN_IP=192.168.1.145\nDATABASE_PATH=data/original.sqlite\n"
        updated = d.replace_values(original, {"DATABASE_PATH": "data/restored.sqlite", "PHOTO_DIRECTORY": "data/restored-photos"})
        self.assertIn("LAN_IP=192.168.1.145", updated)
        self.assertEqual(d.env_values(updated)["DATABASE_PATH"], "data/restored.sqlite")
        for invalid in ["X=1\nX=2", "export X=1", "X=$(touch /tmp/pwn)"]:
            with self.assertRaises(d.DeployError):
                d.env_values(invalid)

    def test_failed_candidate_restores_only_after_quiescing_proxy(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            (project / ".env").write_text("LAN_IP=127.0.0.1\n")
            (project / "image.env").write_text("APP_IMAGE=" + OLD + "\n")
            backup = project / "backup"
            backup.mkdir()
            calls = []

            def compose(*args, **kwargs):
                calls.append(args)
                if args[0] == "up" and args[-1] == "app":
                    raise d.DeployError("candidate unhealthy")

            with patch.object(d, "PROJECT", project), patch.object(d, "compose", compose), patch.object(d, "backup", return_value=(backup, "/app/data/backups/snapshot-test")), patch.object(d, "recover") as recover:
                with self.assertRaisesRegex(d.DeployError, "snapshot previos"):
                    d.deploy(NEW, OLD)
                self.assertEqual(calls[:2], [("stop", "caddy"), ("stop", "app")])
                recover.assert_called_once_with(OLD, "LAN_IP=127.0.0.1\n", "/app/data/backups/snapshot-test", backup)
                self.assertEqual(json.loads((project / "failed-release.json").read_text())["image"], NEW)

    def test_after_acceptance_proxy_failure_does_not_roll_back_confirmed_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            (project / ".env").write_text("LAN_IP=127.0.0.1\n")
            (project / "image.env").write_text("APP_IMAGE=" + OLD + "\n")
            backup = project / "backup"
            backup.mkdir()

            def compose(*args, **kwargs):
                if args[0] == "up" and args[-1] == "caddy":
                    raise d.DeployError("proxy failed after acceptance")

            with patch.object(d, "PROJECT", project), patch.object(d, "compose", compose), patch.object(d, "backup", return_value=(backup, "/app/data/backups/snapshot-test")), patch.object(d, "recover") as recover:
                with self.assertRaises(d.DeployError):
                    d.deploy(NEW, OLD)
                recover.assert_not_called()
                self.assertTrue((backup / "accepted.json").exists())
                self.assertIn(NEW, (project / "image.env").read_text())

    def test_restore_uses_new_targets_and_never_runs_old_migrations(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            (project / "image.env").write_text("APP_IMAGE=" + NEW + "\n")
            calls = []
            with patch.object(d, "PROJECT", project), patch.object(d, "compose", lambda *args, **kw: calls.append(args)):
                d.recover(OLD, "LAN_IP=127.0.0.1\n", "/app/data/backups/snapshot-test", project)
            script = next(args for args in calls if "--input-type=module" in args)
            self.assertIn("restoreSnapshot", " ".join(script))
            self.assertNotIn("cli.js", " ".join(script))
            self.assertTrue(d.env_values((project / ".env").read_text())["DATABASE_PATH"].startswith("data/rollback-"))
            for args in calls:
                self.assertNotIn("down", args)
                self.assertNotIn("--remove-orphans", args)
                self.assertTrue(args[-1] in ("app", "caddy") or "--input-type=module" in args)


if __name__ == "__main__":
    unittest.main()
