#!/usr/bin/python3
"""Root-installed, opt-in updater for Cebo de Pemento ONLY. Never execute code from Git.

Git supplies a main SHA, GHCR supplies an OCI image with that revision. The reviewed
Compose, Caddyfile, env, script and units remain local and require manual updates.
"""
import argparse
import datetime as dt
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

PROJECT = Path("/opt/servicios/cebo-pemento")
REPO = Path("/opt/cebo-pemento")
BACKUPS = Path("/var/backups/cebo-pemento-deploy")
GATE = Path("/etc/cebo-pemento/auto.enabled")
IMAGE_REPO = "ghcr.io/aculledor/cebo-de-pemento"
REF_RE = re.compile(r"^ghcr\.io/aculledor/cebo-de-pemento:sha-([0-9a-f]{40})@sha256:[0-9a-f]{64}$")
DIGEST_RE = re.compile(r"^ghcr\.io/aculledor/cebo-de-pemento@sha256:[0-9a-f]{64}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class DeployError(Exception):
    pass


def run(*args, timeout=180, env=None):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise DeployError(f"Comando no disponible o timeout: {args[0]}") from error
    if result.returncode:
        raise DeployError(f"Comando fallido ({result.returncode}): {args[0]}")
    return result.stdout.strip()


def trusted(path, private=False):
    st = path.lstat()
    if path.is_symlink() or st.st_uid != 0 or st.st_gid != 0 or st.st_mode & 0o022:
        raise DeployError(f"Requiere root:root, sin enlaces ni escritura de grupo/otros: {path}")
    if private and st.st_mode & 0o077:
        raise DeployError(f"Requiere permisos 0600: {path}")


def env_values(content):
    values = {}
    for line in content.splitlines():
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or key in values or not re.fullmatch(r"[A-Z_]+", key):
            raise DeployError("Formato de entorno ambiguo; usar KEY=value sin comillas ni export")
        if "\x00" in value or "$" in value or "`" in value:
            raise DeployError("No se admite interpolación en el entorno privado")
        values[key] = value
    return values


def replace_values(content, changes):
    values = env_values(content)
    result = []
    for line in content.splitlines():
        key = line.partition("=")[0]
        result.append(f"{key}={changes[key]}" if key in changes else line)
    for key, value in changes.items():
        if key not in values:
            result.append(f"{key}={value}")
    return "\n".join(result) + "\n"


def atomic(path, content):
    fd, name = tempfile.mkstemp(prefix=".cebo-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def compose(*args, overrides=None, timeout=240):
    env = dict(os.environ)
    # The reviewed local env files are authoritative. Do not inherit shell overrides.
    for key in ("APP_IMAGE", "DATABASE_PATH", "PHOTO_DIRECTORY", "LAN_IP", "HTTPS_PORT", "DATA_VOLUME", "PUBLIC_ORIGINS"):
        env.pop(key, None)
    env.update(overrides or {})
    return run("/usr/bin/docker", "compose", "--project-directory", str(PROJECT),
               "--env-file", str(PROJECT / ".env"), "--env-file", str(PROJECT / "image.env"),
               "-p", "cebo-pemento", "-f", str(PROJECT / "compose.yaml"), *args, env=env, timeout=timeout)


def pinned_image(sha, inspect):
    if not SHA_RE.fullmatch(sha) or inspect.get("Architecture") != "amd64" or inspect.get("Os") != "linux":
        raise DeployError("Revisión o arquitectura no admitida")
    if inspect.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision") != sha:
        raise DeployError("La revisión OCI no coincide con main")
    digests = {x for x in inspect.get("RepoDigests", []) if DIGEST_RE.fullmatch(x)}
    if len(digests) != 1:
        raise DeployError("Digest ausente o ambiguo")
    return f"{IMAGE_REPO}:sha-{sha}@{digests.pop().split('@')[1]}"


def backup(old_image):
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    trusted(BACKUPS)
    directory = BACKUPS / stamp
    directory.mkdir(mode=0o700)
    for name in (".env", "image.env", "compose.yaml"):
        atomic(directory / name, (PROJECT / name).read_text())
    output = compose("run", "--rm", "--no-deps", "--entrypoint", "node", "app",
                     "apps/api/dist/cli.js", "backup", overrides={"APP_IMAGE": old_image})
    result = json.loads(output)
    snapshot = result["directory"]
    if not re.fullmatch(r"/app/data/backups/snapshot-[a-zA-Z0-9:.\-]+", snapshot):
        raise DeployError("Ruta de snapshot inesperada")
    config = env_values((PROJECT / ".env").read_text())
    volume = config.get("DATA_VOLUME", "cebo_pemento_data")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", volume):
        raise DeployError("Volumen no admitido")
    helper = "cebo-export-" + uuid.uuid4().hex
    created = False
    try:
        run("/usr/bin/docker", "create", "--name", helper, "--mount",
            f"type=volume,src={volume},dst=/app/data,readonly", "--entrypoint", "node", old_image, "-e", "")
        created = True
        run("/usr/bin/docker", "cp", f"{helper}:{snapshot}", str(directory / "snapshot"))
    finally:
        if created:
            run("/usr/bin/docker", "rm", helper)
    # Snapshot includes a consistent SQLite file and local photos; no token output.
    atomic(directory / "release.json", json.dumps({"image": old_image, "snapshot": snapshot}))
    return directory, snapshot


def recover(old_image, original_env, snapshot, directory):
    compose("stop", "app")
    token = uuid.uuid4().hex
    target_db, target_photos = f"data/rollback-{token}.sqlite", f"data/rollback-photos-{token}"
    # Import the restore function directly: do not run an old migration runner on a newer DB.
    script = "import {restoreSnapshot} from './apps/api/dist/restore.js'; await restoreSnapshot(...process.argv.slice(1));"
    compose("run", "--rm", "--no-deps", "--entrypoint", "node", "app", "--input-type=module", "-e", script,
            snapshot, target_db, target_photos, overrides={"APP_IMAGE": old_image})
    atomic(PROJECT / ".env", replace_values(original_env, {"DATABASE_PATH": target_db, "PHOTO_DIRECTORY": target_photos}))
    atomic(PROJECT / "image.env", f"APP_IMAGE={old_image}\n")
    compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "120", "app")
    compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "caddy")
    atomic(directory / "rollback.json", json.dumps({"database": target_db, "photos": target_photos}))


def deploy(candidate, old_image):
    if not REF_RE.fullmatch(candidate) or not REF_RE.fullmatch(old_image):
        raise DeployError("Solo se admiten imágenes propias por commit y digest")
    original_env = (PROJECT / ".env").read_text()
    # Stop only this application's proxy before snapshot/validation: no writes can be
    # confirmed against a candidate DB that might then be rolled back.
    compose("stop", "caddy")
    compose("stop", "app")
    try:
        directory, snapshot = backup(old_image)
    except Exception:
        compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "app")
        compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "caddy")
        raise
    atomic(PROJECT / "image.env", f"APP_IMAGE={candidate}\n")
    try:
        compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "150", "app")
        compose("exec", "-T", "app", "node", "-e", "Promise.all([fetch('http://127.0.0.1:3001/api/health'),fetch('http://127.0.0.1:3001/')]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))")
    except Exception as error:
        atomic(PROJECT / "failed-release.json", json.dumps({"image": candidate, "backup": str(directory)}))
        recover(old_image, original_env, snapshot, directory)
        raise DeployError("Actualización rechazada; imagen y snapshot previos recuperados") from error
    # Commit before reopening the proxy. After this point never automatically restore
    # data: users may have received confirmed writes on this accepted release.
    atomic(directory / "accepted.json", json.dumps({"image": candidate}))
    compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "120", "caddy")
    cfg = env_values((PROJECT / ".env").read_text())
    host = str(ipaddress.IPv4Address(cfg.get("LAN_IP", "127.0.0.1")))
    port = int(cfg.get("HTTPS_PORT", "8444"))
    run("/usr/bin/curl", "--fail", "--silent", "--show-error", "--max-time", "15", "--cacert", str(PROJECT / "ca.crt"), f"https://{host}:{port}/api/health")
    print("Actualización aceptada y HTTPS comprobado. Backup:", directory)


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--auto", action="store_true")
    group.add_argument("--backup", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise DeployError("Instalar y ejecutar explícitamente como root")
    for path in (PROJECT, PROJECT / "deploy", PROJECT / "compose.yaml", PROJECT / "deploy/Caddyfile", PROJECT / ".env", PROJECT / "image.env", PROJECT / "ca.crt"):
        trusted(path, path.name in (".env", "image.env"))
    image_env = env_values((PROJECT / "image.env").read_text())
    if set(image_env) != {"APP_IMAGE"} or not REF_RE.fullmatch(image_env["APP_IMAGE"]):
        raise DeployError("image.env debe contener solamente APP_IMAGE por digest")
    compose("config", "--quiet")
    if args.check:
        print("Configuración local válida. No se ha descargado ni desplegado.")
        return
    if args.auto:
        trusted(GATE, True)
        if GATE.read_text().strip() != "enabled":
            raise DeployError("Actualización automática no autorizada localmente")
    # Share the existing infrastructure lock; never invoke its deploy script.
    with open("/run/lock/servidor-casa-deploy.lock", "a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Otro GitOps está ocupado; se reintentará en el siguiente ciclo")
            return
        old = image_env["APP_IMAGE"]
        if args.backup:
            print("Backup verificado:", backup(old)[0])
            return
        git = ("/usr/sbin/runuser", "-u", "servidor", "--", "/usr/bin/git", "-C", str(REPO))
        remote = run(*git, "remote", "get-url", "origin")
        if remote not in ("https://github.com/aculledor/CeboDePemento.git", "git@github.com:aculledor/CeboDePemento.git"):
            raise DeployError("Origen Git no admitido")
        run(*git, "fetch", "--no-tags", "origin", "main")
        sha = run(*git, "rev-parse", "FETCH_HEAD")
        if not SHA_RE.fullmatch(sha):
            raise DeployError("SHA Git no válido")
        if REF_RE.fullmatch(old).group(1) == sha:
            print("Ya está instalada la revisión de main")
            return
        tag = f"{IMAGE_REPO}:sha-{sha}"
        # Missing image (CI in progress/failing) exits before any service is stopped.
        run("/usr/bin/docker", "pull", "--platform", "linux/amd64", tag, timeout=600)
        image = json.loads(run("/usr/bin/docker", "image", "inspect", tag))[0]
        candidate = pinned_image(sha, image)
        failed = PROJECT / "failed-release.json"
        if failed.exists() and json.loads(failed.read_text()).get("image") == candidate:
            raise DeployError("Esta versión ya falló; revisar antes de reintentar manualmente")
        deploy(candidate, old)


if __name__ == "__main__":
    try:
        main()
    except (DeployError, OSError, ValueError, KeyError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
