#!/usr/bin/env bash
# CI hosted runner only, disposable Docker engine; never execute on production.
set -Eeuo pipefail
[[ "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
: "${CEBO_DEV_IMAGE:?Use the already built CI image}"
export CEBO_DEV_IMAGE
export CEBO_DEV_HOST=127.0.0.1 CEBO_DEV_BIND=127.0.0.1
project=cebo-pemento-dev
compose=(docker compose --env-file /dev/null -p "$project" -f deploy/dev/compose.yaml)
tmp="$(mktemp -d)"
cleanup() {
  "${compose[@]}" stop >/dev/null 2>&1 || true
  rm -rf -- "$tmp"
}
trap cleanup EXIT
"${compose[@]}" config --format json > "$tmp/config.json"
python3 - "$tmp/config.json" <<'PY'
import json, sys
from pathlib import Path
c = json.loads(Path(sys.argv[1]).read_text())
assert c["name"] == "cebo-pemento-dev"
assert set(c["services"]) == {"app", "caddy"}
assert c["networks"]["dev"]["internal"] is True
for v in c["volumes"].values():
    assert not v.get("external") and v["name"].startswith("cebo-pemento-dev_")
for s in c["services"].values():
    assert s["restart"] == "no"
    assert not s.get("privileged") and not s.get("container_name")
    assert s.get("network_mode") is None
    assert set(s["networks"]) == {"dev"}
    for v in s.get("volumes", []):
        if v["type"] == "bind":
            assert v["target"] == "/etc/caddy/Caddyfile" and v["read_only"]
            assert Path(v["source"]).resolve() == Path("deploy/dev/Caddyfile").resolve()
        else:
            assert v["type"] == "volume" and v["source"] in c["volumes"]
app, gateway = c["services"]["app"], c["services"]["caddy"]
assert not app.get("ports")
assert app["environment"]["APP_ORIGINS"] == "https://127.0.0.1:18444"
assert app["environment"]["DATABASE_PATH"] == "data/catalogo.sqlite"
assert app["environment"]["PHOTO_DIRECTORY"] == "data/photos"
assert gateway["environment"]["DEV_HOST"] == "127.0.0.1"
assert len(gateway["ports"]) == 1
p = gateway["ports"][0]
assert (p["host_ip"], str(p["published"]), p["target"]) == ("127.0.0.1", "18444", 8443)
PY
CEBO_DEV_HOST=cebo-dev.home.arpa CEBO_DEV_BIND=192.0.2.10 "${compose[@]}" config --format json > "$tmp/lan.json"
python3 - "$tmp/lan.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
assert c["services"]["app"]["environment"]["APP_ORIGINS"] == "https://cebo-dev.home.arpa:18444"
assert c["services"]["caddy"]["environment"]["DEV_HOST"] == "cebo-dev.home.arpa"
assert c["services"]["caddy"]["ports"][0]["host_ip"] == "192.0.2.10"
PY
"${compose[@]}" pull caddy
"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 120
"${compose[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$tmp/root.crt"
curl --noproxy '*' --fail --silent --show-error --cacert "$tmp/root.crt" https://127.0.0.1:18444/api/health
echo
echo "DEV Compose isolation, health and verified TLS passed."
