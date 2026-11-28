#!/usr/bin/python3
"""Root-installed, opt-in updater for Cebo de Pemento ONLY. Never execute code from Git.

Git supplies a main SHA, GHCR supplies an OCI image with that revision. The reviewed
Compose, Caddyfile, env, script and units remain local and require manual updates.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
import time
import uuid

PROJECT = Path("/opt/servicios/cebo-pemento")
REPO = Path("/opt/cebo-pemento")
BACKUPS = Path("/var/backups/cebo-pemento-deploy")
GATE = Path("/etc/cebo-pemento/auto.enabled")
IMAGE_REPO = "ghcr.io/aculledor/cebo-de-pemento"
REF_RE = re.compile(r"^ghcr\.io/aculledor/cebo-de-pemento:sha-([0-9a-f]{40})@sha256:[0-9a-f]{64}$")
DIGEST_RE = re.compile(r"^ghcr\.io/aculledor/cebo-de-pemento@sha256:[0-9a-f]{64}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SPECOPS_ROOT = Path("/etc/servidor-casa/specops")
SPECOPS_STATE = Path("/var/lib/servidor-specops")
GLOBAL_LOCK = Path("/run/lock/servidor-casa-deploy.lock")
DEV_REF_RE = re.compile(r"^ghcr\.io/aculledor/cebo-de-pemento-dev@sha256:[0-9a-f]{64}$")


class DeployError(Exception):
    pass


def acquire_lock(lock, backup_mode=False, timeout=300, clock=time.monotonic, pause=time.sleep):
    """A scheduled backup must never report success without making its snapshot."""
    deadline = clock() + timeout
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError as error:
            if not backup_mode:
                return False
            if clock() >= deadline:
                raise DeployError("Backup bloqueado: timeout esperando el lock compartido; no se ha creado copia") from error
            pause(min(1, max(0, deadline - clock())))


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


def backup_require(condition, code):
    if not condition:
        raise DeployError("Backup rechazado: " + code)


def json_object(content):
    def pairs(items):
        result = {}
        for key, value in items:
            backup_require(key not in result, "duplicate-json-key")
            result[key] = value
        return result
    value = json.loads(content, object_pairs_hook=pairs,
                       parse_constant=lambda _: backup_require(False, "invalid-json-number"))
    backup_require(isinstance(value, dict), "json-object")
    return value


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def private_record(path):
    # State/profile are root-local data, never imported code from either checkout.
    for parent in reversed(path.parents):
        trusted(parent)
    trusted(path, True)
    backup_require(stat.S_ISREG(path.lstat().st_mode), "state-file-type")
    return json_object(path.read_text())


def present(path):
    return path.exists() or path.is_symlink()


def data_relative(value):
    path = PurePosixPath(value)
    backup_require(not path.is_absolute() and path.parts[:1] == ("data",) and
                   len(path.parts) > 1 and ".." not in path.parts and "\\" not in value,
                   "data-path")
    return path.relative_to("data")


def backup_state(ref, revision, legacy, config, mountpoint, database, photos):
    profile_path = SPECOPS_ROOT / "cebo-prod.json"
    image_path = SPECOPS_STATE / "cebo-prod-image.json"
    journal_path = SPECOPS_STATE / "cebo-prod.json"
    if not any(present(p) for p in (profile_path, image_path, journal_path)):
        backup_require(ref == legacy, "legacy-image-drift")
        return {"mode": "legacy"}
    backup_require(present(profile_path), "specops-profile-missing")
    profile = private_record(profile_path)
    expected = {"version": 1, "app": "cebo", "environment": "prod",
                "directory": str(PROJECT), "project": "cebo-pemento", "service": "app",
                "compose": str(PROJECT / "compose.yaml"), "env_file": str(PROJECT / ".env"),
                "image_variable": "APP_IMAGE", "baseline_image": legacy}
    backup_require(all(profile.get(k) == v for k, v in expected.items()), "specops-profile-target")
    seals = profile["seals"]
    backup_require({str(PROJECT / "compose.yaml"), str(PROJECT / ".env")} <= set(seals), "specops-seals")
    for filename, digest in seals.items():
        path = Path(filename)
        trusted(path, path.name in (".env", "image.env"))
        backup_require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, "specops-seal-drift")
    normalized = json.loads(json.dumps(config))
    normalized["services"]["app"]["image"] = "SPECOPS_IMAGE"
    backup_require(fingerprint(normalized) == profile["compose_hash"], "specops-compose-drift")
    backup_require(profile["database"] == str(Path(mountpoint) / database) and
                   profile.get("photos") == str(Path(mountpoint) / photos), "specops-data-drift")
    image = private_record(image_path) if present(image_path) else None
    if image is not None:
        backup_require(set(image) == {"image"} and image["image"] == ref, "specops-image-drift")
    else:
        backup_require(ref == legacy, "specops-image-missing")
    if not present(journal_path):
        backup_require(image is None and ref == legacy, "specops-journal-missing")
        return {"mode": "specops-baseline", "profile_hash": fingerprint(profile)}
    state = private_record(journal_path)
    backup_require("pending" in state and state["pending"] is None, "specops-pending-transaction")
    backup_require("current" in state and
                   (state["current"] if state["current"] is not None else legacy) == ref, "specops-current-drift")
    # Engine uses host.current() before first acceptance. Local baseline recovery
    # may have persisted its image record while journal.current is still None.
    candidate = state.get("accepted_candidate")
    backup_require(candidate is None or isinstance(candidate, dict), "specops-candidate-format")
    if DEV_REF_RE.fullmatch(ref):
        backup_require(isinstance(candidate, dict) and candidate.get("app") == "cebo" and
                       candidate.get("repository") == "aculledor/CeboDePemento" and
                       isinstance(candidate.get("image"), str) and isinstance(candidate.get("digest"), str) and
                       candidate.get("image") + "@" + candidate.get("digest") == ref and
                       candidate.get("tested_digest") == candidate.get("digest") and
                       candidate.get("sha") == revision and candidate.get("platform") == "linux/amd64" and
                       fingerprint(candidate) == state.get("candidate_id"), "specops-candidate-drift")
    # Rollback deliberately leaves historical sha/digest/selected_candidate fields.
    # current + image record describe the live version; never use historical fields.
    return {"mode": "specops", "profile_hash": fingerprint(profile), "current": state["current"],
            "candidate_id": state.get("candidate_id") if candidate and
            candidate.get("image", "") + "@" + candidate.get("digest", "") == ref else None}


def active_backup():
    """Read-only selection under the global lock, before any snapshot/helper."""
    try:
        return inspect_active_backup()
    except (ValueError, KeyError, TypeError, IndexError) as error:
        raise DeployError("Backup rechazado: invalid-local-evidence") from error


def inspect_active_backup():
    image_env = env_values((PROJECT / "image.env").read_text())
    backup_require(set(image_env) == {"APP_IMAGE"} and REF_RE.fullmatch(image_env["APP_IMAGE"]), "legacy-image-env")
    ids = compose("ps", "--all", "--quiet", "app", timeout=30).split()
    backup_require(len(ids) == 1 and re.fullmatch(r"[0-9a-f]{64}", ids[0]), "container-identity")
    container = json.loads(run("/usr/bin/docker", "inspect", ids[0], timeout=30))
    backup_require(len(container) == 1 and container[0]["Id"] == ids[0], "container-identity")
    container = container[0]
    labels = container["Config"]["Labels"]
    backup_require(labels.get("com.docker.compose.project") == "cebo-pemento" and
                   labels.get("com.docker.compose.service") == "app" and
                   labels.get("com.docker.compose.oneoff") == "False" and
                   labels.get("com.docker.compose.project.working_dir") == str(PROJECT), "container-labels")
    state = container["State"]
    backup_require(state.get("Running") is True and not state.get("Paused") and not state.get("Restarting") and
                   state.get("Health", {}).get("Status") == "healthy", "container-health")
    ref = container["Config"]["Image"]
    backup_require(REF_RE.fullmatch(ref) or DEV_REF_RE.fullmatch(ref), "image-reference")
    image = json.loads(run("/usr/bin/docker", "image", "inspect", ref, timeout=30))
    backup_require(len(image) == 1, "image-identity")
    image = image[0]
    revision = image["Config"]["Labels"].get("org.opencontainers.image.revision", "")
    repository = ref.split("@", 1)[0].split(":", 1)[0]
    backup_require(re.fullmatch(r"sha256:[0-9a-f]{64}", image["Id"]) and
                   image["Id"] == container["Image"] and image.get("Os") == "linux" and
                   image.get("Architecture") == "amd64" and
                   repository + "@" + ref.split("@", 1)[1] in image.get("RepoDigests", []) and
                   SHA_RE.fullmatch(revision) and
                   image["Config"]["Labels"].get("org.opencontainers.image.source") ==
                   "https://github.com/aculledor/CeboDePemento" and
                   (not REF_RE.fullmatch(ref) or REF_RE.fullmatch(ref).group(1) == revision), "oci-provenance")
    config = json_object(compose("config", "--format", "json", overrides={"APP_IMAGE": ref}, timeout=30))
    backup_require(config["name"] == "cebo-pemento" and config["services"]["app"]["image"] == ref,
                   "compose-identity")
    service = config["services"]["app"]
    backup_require(not service.get("build"), "compose-build-forbidden")
    mounts = service.get("volumes", [])
    backup_require(len(mounts) == 1 and mounts[0]["type"] == "volume" and
                   mounts[0]["target"] == "/app/data" and not mounts[0].get("read_only"), "compose-data-mount")
    volume = config["volumes"][mounts[0]["source"]]
    backup_require(volume.get("external") is True and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", volume["name"]),
                   "volume-name")
    actual = [m for m in container["Mounts"] if m["Type"] != "tmpfs"]
    backup_require(len(actual) == 1 and actual[0]["Type"] == "volume" and
                   actual[0]["Name"] == volume["name"] and actual[0]["Destination"] == "/app/data" and
                   actual[0]["RW"] is True and
                   all(m["Destination"] == "/tmp" for m in container["Mounts"] if m["Type"] == "tmpfs"), "container-data-mount")
    info = json.loads(run("/usr/bin/docker", "volume", "inspect", volume["name"], timeout=30))
    backup_require(len(info) == 1 and info[0]["Name"] == volume["name"] and info[0]["Driver"] == "local" and
                   not info[0].get("Options") and PurePosixPath(info[0]["Mountpoint"]).is_absolute() and
                   actual[0]["Source"] == info[0]["Mountpoint"], "volume-identity")
    environment = service["environment"]
    runtime_env = {}
    for item in container["Config"]["Env"]:
        key, separator, value = item.partition("=")
        backup_require(separator and key and key not in runtime_env, "container-environment-ambiguous")
        runtime_env[key] = value
    database = data_relative(environment["DATABASE_PATH"])
    photos = data_relative(environment["PHOTO_DIRECTORY"])
    backup_require(all(runtime_env.get(key) == environment[key] for key in ("DATABASE_PATH", "PHOTO_DIRECTORY")),
                   "container-data-environment")
    proof = backup_state(ref, revision, image_env["APP_IMAGE"], config, info[0]["Mountpoint"], database, photos)
    data = Path(info[0]["Mountpoint"])
    for relative in (database, photos):
        path = data / relative
        backup_require(not any(part.is_symlink() for part in (*path.parents, path)), "data-symlink")
    # openDatabase() can initialize a missing DB: never let a scheduled backup
    # silently archive a newly seeded database instead of the live dataset.
    backup_require((data / database).is_file(), "database-missing")
    photos_required = proof.get("current") is not None
    backup_require((data / photos).is_dir() if present(data / photos) or photos_required else True,
                   "photos-missing-or-type")
    return {"image": ref, "revision": revision, "container_id": ids[0], "image_id": image["Id"],
            "volume": volume["name"], "database": str(database), "photos": str(photos), "specops": proof}


def backup(old_image, verified=None):
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    trusted(BACKUPS)
    directory = BACKUPS / stamp
    directory.mkdir(mode=0o700)
    for name in (".env", "image.env", "compose.yaml"):
        content = f"APP_IMAGE={old_image}\n" if verified and name == "image.env" else (PROJECT / name).read_text()
        atomic(directory / name, content)
    # compose run has no --no-build flag. The selected config must have no build
    # section, its exact image is already local, and pulling is forbidden.
    offline = ("--pull", "never") if verified else ()
    output = compose("run", "--rm", "--no-deps", *offline, "--entrypoint", "node", "app",
                     "apps/api/dist/cli.js", "backup", overrides={"APP_IMAGE": old_image})
    result = json.loads(output)
    snapshot = result["directory"]
    if not re.fullmatch(r"/app/data/backups/snapshot-[a-zA-Z0-9:.\-]+", snapshot):
        raise DeployError("Ruta de snapshot inesperada")
    config = env_values((PROJECT / ".env").read_text())
    volume = config.get("DATA_VOLUME", "cebo_pemento_data")
    if verified:
        backup_require(volume == verified["volume"], "backup-volume-drift")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", volume):
        raise DeployError("Volumen no admitido")
    helper = "cebo-export-" + uuid.uuid4().hex
    created = False
    try:
        run("/usr/bin/docker", "create", *(("--pull=never",) if verified else ()), "--name", helper, "--mount",
            f"type=volume,src={volume},dst=/app/data,readonly", "--entrypoint", "node", old_image, "-e", "")
        created = True
        run("/usr/bin/docker", "cp", f"{helper}:{snapshot}", str(directory / "snapshot"))
    finally:
        if created:
            run("/usr/bin/docker", "rm", helper)
    # Snapshot includes a consistent SQLite file and local photos; no token output.
    if verified:
        backup_require(active_backup() == verified, "runtime-changed-during-backup")
    atomic(directory / "release.json", json.dumps({"image": old_image, "snapshot": snapshot,
                                                  **({"version": 2, "runtime": verified} if verified else {})}))
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
    if args.backup:
        with open(GLOBAL_LOCK, "a+") as lock:
            acquire_lock(lock, backup_mode=True)
            selected = active_backup()
            print("Backup verificado:", backup(selected["image"], verified=selected)[0])
        return
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
    with open(GLOBAL_LOCK, "a+") as lock:
        if not acquire_lock(lock, backup_mode=args.backup):
            print("Otro GitOps está ocupado; se reintentará en el siguiente ciclo")
            return
        old = image_env["APP_IMAGE"]
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
