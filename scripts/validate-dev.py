#!/usr/bin/env python3
"""Read-only checks of rendered DEV Compose and host guards. No deployment API."""
import argparse
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import socket
import struct
import shutil
import hashlib
import os
import ssl
import stat
import tempfile
import time

PROJECT = "cebo-pemento-dev"
HOST = "cebo-dev.home.arpa"
SUBNETS = {"172.29.92.0/24", "172.29.93.0/24"}
GATEWAY_IMAGE = "caddy:2.11.2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d"
LABEL = "com.servidor-casa.env"


def require(value, message):
    if not value:
        raise ValueError(message)


def command(*args):
    result = subprocess.run(args, check=True, text=True, capture_output=True, timeout=30,
                            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root",
                                 "LC_ALL": "C", "OPENSSL_CONF": "/dev/null"})
    return result.stdout.strip()


def write_tls_status(path, value):
    """Reuse SpecOps' private state directory; no new service or log per tick."""
    path = Path(path).absolute()
    for part in (path.parent, *path.parent.parents):
        require(not part.is_symlink(), "tls-status-symlink")
    info = path.parent.stat()
    require(info.st_uid == os.geteuid() and not info.st_mode & 0o022, "tls-status-directory")
    previous = None
    if path.exists() or path.is_symlink():
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                info.st_uid == os.geteuid() and info.st_mode & 0o777 == 0o600, "tls-status-permissions")
        previous = json.loads(path.read_text())
    if previous == value:
        return False
    fd, temporary = tempfile.mkstemp(prefix=".cebo-tls-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(value, output, sort_keys=True)
            output.flush(); os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    # Daily freshness updates do not repeat the warning.
    return previous is None or any(previous.get(k) != value.get(k) for k in ("warnings", "valid", "fingerprints"))


def tls_health(directory, status=None, now=None):
    """Public-cert expiry warning without early failure or an offline CA key."""
    now = time.time() if now is None else now
    directory = Path(directory).absolute() / "tls"
    warnings, dates, fingerprints = [], {}, {}
    valid = False
    try:
        for part in (directory, *directory.parents):
            require(not part.is_symlink(), "tls-path-symlink")
        require({p.name for p in directory.iterdir()} == {"server.key", "server.crt", "root.crt"}, "tls-bundle-files")
        for name in ("server.key", "server.crt", "root.crt"):
            info = (directory / name).lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o022, "tls-file-permissions")
        require(not (directory / "server.key").stat().st_mode & 0o007, "tls-key-world-readable")
        for role, name in (("server", "server.crt"), ("ca", "root.crt")):
            path = str(directory / name)
            end = command("openssl", "x509", "-in", path, "-noout", "-enddate").removeprefix("notAfter=")
            expires = ssl.cert_time_to_seconds(end)
            dates[role] = int(expires)
            fingerprints[role] = hashlib.sha256(ssl.PEM_cert_to_DER_cert(Path(path).read_text())).hexdigest()
            if expires <= now: warnings.append(role + "-expired")
            elif expires - now <= 30 * 86400: warnings.append(role + "-expires-within-30-days")
        public = command("openssl", "x509", "-in", str(directory / "server.crt"), "-pubkey", "-noout")
        require(public == command("openssl", "pkey", "-in", str(directory / "server.key"), "-pubout"), "tls-key-mismatch")
        san = command("openssl", "x509", "-in", str(directory / "server.crt"), "-noout", "-ext", "subjectAltName")
        require(" ".join(san.split()) == "X509v3 Subject Alternative Name: DNS:" + HOST, "tls-san")
        command("openssl", "verify", "-check_ss_sig", "-attime", str(int(now)), "-CAfile", str(directory / "root.crt"), str(directory / "root.crt"))
        command("openssl", "verify", "-attime", str(int(now)), "-purpose", "sslserver", "-CAfile", str(directory / "root.crt"),
                "-verify_hostname", HOST, str(directory / "server.crt"))
        valid = True
    except (OSError, ValueError, subprocess.SubprocessError):
        if not any(w.endswith("-expired") for w in warnings): warnings.append("tls-invalid")
    value = {"version": 1, "host": HOST, "valid": valid, "warnings": warnings,
             "expires_at": dates, "fingerprints": fingerprints, "checked_utc_day": int(now // 86400)}
    changed = write_tls_status(status, value) if status else True
    if changed and warnings:
        print("<4>DEV TLS: " + ", ".join(warnings) + "; renew offline; see cebo-dev-tls.json expiry dates.")
    require(valid, "tls-invalid-or-expired")
    return value


def validate(config, mode, directory):
    directory = Path(directory).resolve()
    require(config["name"] == PROJECT, "wrong-project")
    require(set(config["services"]) == {"app-dev", "gateway-dev"}, "service-collision")
    app, gateway = config["services"]["app-dev"], config["services"]["gateway-dev"]
    image_pattern = r"ghcr\.io/aculledor/cebo-de-pemento-dev@sha256:[0-9a-f]{64}"
    if mode == "ci":
        image_pattern = r"sha256:[0-9a-f]{64}"
    require(re.fullmatch(image_pattern, app["image"]), "immutable-image-required")
    require(gateway["image"] == GATEWAY_IMAGE, "gateway-image-changed")
    require(app["environment"]["APP_ORIGINS"] == "https://" + HOST + ":18444" and
            gateway["environment"]["DEV_HOST"] == HOST, "host-origin-mismatch")
    require(not app.get("ports") and len(gateway["ports"]) == 1, "unexpected-port")
    port = gateway["ports"][0]
    require((port["host_ip"], str(port["published"]), port["target"]) ==
            ("127.0.0.1" if mode == "ci" else "192.168.1.145", "18444", 8443), "host-bind-mismatch")
    require(set(config.get("volumes", {})) == {"fishing_data"}, "unexpected-volumes")
    volume = config["volumes"]["fishing_data"]
    require(volume["name"] == PROJECT + "_fishing_data" and not volume.get("external") and
            not volume.get("driver_opts") and volume.get("labels", {}).get(LABEL) == "dev", "volume-collision")
    require(set(config["networks"]) == {"dev", "ingress"}, "unexpected-networks")
    for name, subnet in (("dev", "172.29.92.0/24"), ("ingress", "172.29.93.0/24")):
        network = config["networks"][name]
        require(network["name"] == PROJECT + ("_internal" if name == "dev" else "_ingress") and
                not network.get("external") and not network.get("driver_opts") and not network.get("enable_ipv6") and
                network.get("labels", {}).get(LABEL) == "dev" and
                network["ipam"]["config"] == [{"subnet": subnet}], "network-collision")
    require(config["networks"]["dev"]["internal"] and not config["networks"]["ingress"].get("internal"), "network-topology")
    for name, service in config["services"].items():
        memory = (512 if name == "app-dev" else 128) * 1024 ** 2
        require(service.get("labels", {}).get(LABEL) == "dev" and service["user"] == "1000:1000" and
                service["restart"] == "no" and service["read_only"] and not service.get("privileged") and
                not service.get("build") and not service.get("container_name") and not service.get("extra_hosts") and
                service.get("network_mode") is None and service.get("pid") is None and not service.get("devices"), "unsafe-service")
        require("ALL" in service["cap_drop"] and set(service.get("cap_add", [])) <= {"NET_BIND_SERVICE"} and
                "no-new-privileges:true" in service["security_opt"] and
                str(service["sysctls"]["net.ipv6.conf.all.disable_ipv6"]) == "1", "unsafe-privileges")
        require(int(service["mem_limit"]) == memory and int(service["memswap_limit"]) == memory and
                service["oom_score_adj"] == 500 and service["cgroup_parent"] == "servidor-dev.slice" and
                float(service["cpus"]) == (0.5 if name == "app-dev" else 0.25) and
                service["pids_limit"] == (128 if name == "app-dev" else 64), "resource-budget")
        require(service.get("dns") == ["127.0.0.1"] and service["logging"]["options"] ==
                {"max-size": "5m", "max-file": "2"}, "dns-or-logs")
        require(set(service["networks"]) == ({"dev"} if name == "app-dev" else {"dev", "ingress"}), "production-network")
        for mount in service.get("volumes", []):
            if mount["type"] == "bind":
                expected = {"/etc/caddy/Caddyfile": directory / "Caddyfile", "/tls": directory / "tls"}
                require(mount["target"] in expected and Path(mount["source"]).resolve() == expected[mount["target"]] and
                        not Path(mount["source"]).is_symlink() and mount["read_only"] and
                        not mount.get("bind", {}).get("create_host_path", False), "production-bind")
            else:
                require(name == "app-dev" and mount["type"] == "volume" and mount["source"] == "fishing_data" and
                        mount["target"] == "/app/data", "production-volume")


def firewall(rules):
    for parent, child in (("FORWARD", "DOCKER-USER"), ("DOCKER-USER", "SPECOPS-DEV-FWD"), ("INPUT", "SPECOPS-DEV-HOST")):
        entries = [r for r in rules(parent) if r.startswith("-A ")]
        require(entries and entries[0] == f"-A {parent} -j {child}", "firewall-order")
    found = []
    for chain, destination in (("SPECOPS-DEV-FWD", True), ("SPECOPS-DEV-HOST", False)):
        entries = [r for r in rules(chain) if r.startswith("-A ")]
        require(entries and entries[-1] == f"-A {chain} -j RETURN", "firewall-return")
        subnets = set()
        for entry in entries[:-1]:
            pattern = rf"-A {chain} -s ([0-9./]+)" + (r" ! -d ([0-9./]+)" if destination else "") + r" -m conntrack --ctstate NEW -j DROP"
            match = re.fullmatch(pattern, entry)
            require(match is not None, "firewall-bypass")
            subnet = str(ipaddress.IPv4Network(match[1]))
            require(not destination or match[2] == subnet, "firewall-destination")
            subnets.add(subnet)
        require(SUBNETS <= subnets, "firewall-missing-subnet")
        found.append(subnets)
    require(found[0] == found[1], "firewall-host-forward-mismatch")


def resources(cgroup_root=Path("/sys/fs/cgroup")):
    info = json.loads(command("docker", "info", "--format", "{{json .}}"))
    require(info["CgroupDriver"] == "systemd" and str(info["CgroupVersion"]) == "2", "systemd-cgroup-v2-required")
    group = command("systemctl", "show", "servidor-dev.slice", "--property=ControlGroup", "--value")
    require(group == "/servidor.slice/servidor-dev.slice", "slice-not-active")
    root = cgroup_root / group.lstrip("/")
    require(int((root / "memory.max").read_text()) <= 1152 * 1024 ** 2 and
            int((root / "memory.swap.max").read_text()) == 0 and
            int((root / "pids.max").read_text()) <= 512, "slice-budget")
    quota, period = (root / "cpu.max").read_text().split()
    require(quota != "max" and 0 < int(quota) / int(period) <= 1.75, "slice-cpu-budget")


def host_health():
    memory = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
    require(int(memory["MemAvailable"].split()[0]) >= 1024 * 1024, "host-memory-insufficient")
    for path in ("/opt/servicios-dev/cebo-pemento", "/var/lib/docker"):
        require(shutil.disk_usage(path).free >= 2 * 1024 ** 3, "host-disk-insufficient")
    require(command("findmnt", "-rn", "-M", "/srv/almacenamiento/hdd2tb", "-o", "UUID") ==
            "229b28a3-03a7-4577-ac8f-ac21614e700f", "critical-media-mount-not-ready")
    query_id = 32131
    query = struct.pack("!HHHHHH", query_id, 256, 1, 0, 0, 0) + b"\x07example\x03com\x00" + struct.pack("!HH", 1, 1)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(3)
        sock.sendto(query, ("192.168.1.145", 53))
        response, peer = sock.recvfrom(4096)
    require(peer == ("192.168.1.145", 53) and len(response) >= 12, "critical-dns-unavailable")
    ident, flags, questions, answers, _, _ = struct.unpack("!HHHHHH", response[:12])
    require(ident == query_id and flags & 0x8000 and not flags & 0xf and questions == 1 and answers > 0,
            "critical-dns-unavailable")


def runtime(config):
    resources()
    firewall(lambda chain: command("iptables", "-w", "2", "-S", chain).splitlines())
    for network in config["networks"].values():
        item = json.loads(command("docker", "network", "inspect", network["name"]))[0]
        require(item["Driver"] == "bridge" and not item["EnableIPv6"] and
                item["Labels"].get(LABEL) == "dev" and item["Labels"].get("com.docker.compose.project") == PROJECT and
                {s["Subnet"] for s in item["IPAM"]["Config"]} <= SUBNETS, "runtime-network")
    for volume in config["volumes"].values():
        item = json.loads(command("docker", "volume", "inspect", volume["name"]))[0]
        require(item["Name"] == PROJECT + "_fishing_data" and item["Driver"] == "local" and
                not item.get("Options") and item["Labels"].get(LABEL) == "dev" and
                item["Labels"].get("com.docker.compose.project") == PROJECT, "runtime-production-volume")
    for name, service in config["services"].items():
        ids = command("docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + PROJECT,
                      "--filter", "label=com.docker.compose.service=" + name).split()
        require(len(ids) == 1 and re.fullmatch(r"[0-9a-f]{12,64}", ids[0]), "runtime-service")
        item = json.loads(command("docker", "inspect", ids[0]))[0]
        hc = item["HostConfig"]
        require(item["Config"]["Labels"].get(LABEL) == "dev" and item["Config"]["User"] == "1000:1000" and
                hc["Memory"] == int(service["mem_limit"]) and hc["MemorySwap"] == hc["Memory"] and
                hc["OomScoreAdj"] == 500 and hc["CgroupParent"] == "servidor-dev.slice" and
                not hc["Privileged"] and hc["ReadonlyRootfs"], "runtime-service-budget")
        require(set(item["NetworkSettings"]["Networks"]) == {config["networks"][n]["name"] for n in service["networks"]}, "runtime-production-network")
        process_group = Path(f'/proc/{item["State"]["Pid"]}/cgroup').read_text()
        require("/servidor.slice/servidor-dev.slice/" in process_group, "runtime-cgroup-membership")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config")
    parser.add_argument("--directory", required=True)
    parser.add_argument("--mode", choices=("lan", "ci"), default="lan")
    parser.add_argument("--runtime", action="store_true")
    parser.add_argument("--guards", action="store_true", help="Check pre-existing host guards before boot; read-only")
    parser.add_argument("--tls-only", action="store_true", help="Existing SpecOps ExecStartPre: no Docker or network access")
    parser.add_argument("--tls-status", help="Private local status JSON; warnings only on transitions")
    args = parser.parse_args()
    if args.tls_only:
        try:
            tls_health(args.directory, args.tls_status)
        except (OSError, ValueError, subprocess.SubprocessError):
            parser.exit(1, "DEV TLS invalid or expired; inspect private TLS status and renew offline.\n")
        raise SystemExit(0)
    if not args.config: parser.error("--config is required unless --tls-only")
    config = json.loads(Path(args.config).read_text())
    validate(config, args.mode, args.directory)
    if args.guards:
        tls_health(args.directory, args.tls_status)
        resources()
        firewall(lambda chain: command("iptables", "-w", "2", "-S", chain).splitlines())
        if args.mode == "lan":
            host_health()
    if args.runtime:
        runtime(config)
    print("DEV checks passed; no host configuration changed.")
