#!/usr/bin/env bash
# Disposable hosted CI only. Never run this on NUC or against a remote daemon.
set -Eeuo pipefail
[[ "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
[[ "$EUID" == 0 && "$(hostname)" != nuc-cas && -z "${DOCKER_HOST:-}" ]]
[[ "$(docker context show)" == default ]]
: "${CEBO_DEV_IMAGE:?Use the immutable local image ID already built and tested}"
[[ "$CEBO_DEV_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]]
export CEBO_DEV_IMAGE CEBO_DEV_HOST=cebo-dev.home.arpa CEBO_DEV_BIND=127.0.0.1
tmp="$(mktemp -d)"
install_dir="$tmp/stack"
mkdir -p "$install_dir"
cp deploy/dev/compose.yaml deploy/dev/Caddyfile "$install_dir/"
compose=(docker compose --env-file /dev/null -p cebo-pemento-dev -f "$install_dir/compose.yaml")
host_fixture_pid=""
sentinel="cebo-prod-sentinel-$$"
sentinel_net="cebo-prod-sentinel-$$"
firewall_installed=false
slice_installed=false
cleanup() {
  "${compose[@]}" stop >/dev/null 2>&1 || true
  if [[ -n "$host_fixture_pid" ]]; then kill "$host_fixture_pid" 2>/dev/null || true; fi
  docker rm -f "$sentinel" >/dev/null 2>&1 || true
  if [[ "$firewall_installed" == true ]]; then
    iptables -D DOCKER-USER -j SPECOPS-DEV-FWD
    iptables -D INPUT -j SPECOPS-DEV-HOST
    iptables -F SPECOPS-DEV-FWD
    iptables -F SPECOPS-DEV-HOST
    iptables -X SPECOPS-DEV-FWD
    iptables -X SPECOPS-DEV-HOST
  fi
  if [[ "$slice_installed" == true ]]; then
    systemctl stop servidor-dev.slice || true
    rm -f -- /run/systemd/system/servidor-dev.slice
    systemctl daemon-reload
  fi
  rm -rf -- "$tmp"
}
trap cleanup EXIT
python3 scripts/dev-certificates.py --ca-dir "$tmp/offline-ca" --tls-dir "$install_dir/tls"
# Neither a missing image nor a partial host/bind configuration may render.
if env -u CEBO_DEV_IMAGE "${compose[@]}" config --quiet 2>/dev/null; then exit 1; fi
if env -u CEBO_DEV_HOST "${compose[@]}" config --quiet 2>/dev/null; then exit 1; fi
if env -u CEBO_DEV_BIND "${compose[@]}" config --quiet 2>/dev/null; then exit 1; fi
"${compose[@]}" config --format json > "$tmp/config.json"
python3 scripts/validate-dev.py --config "$tmp/config.json" --mode ci --directory "$install_dir"
# Render a deliberately wrong project, but NEVER execute it.
docker compose --env-file /dev/null -p cebo-pemento -f "$install_dir/compose.yaml" config --format json > "$tmp/wrong-project.json"
if python3 scripts/validate-dev.py --config "$tmp/wrong-project.json" --mode ci --directory "$install_dir" >/dev/null 2>&1; then exit 1; fi
CEBO_DEV_IMAGE=ghcr.io/aculledor/cebo-de-pemento-dev@sha256:$(printf 'a%.0s' {1..64}) CEBO_DEV_BIND=192.168.1.145 "${compose[@]}" config --format json > "$tmp/lan.json"
python3 scripts/validate-dev.py --config "$tmp/lan.json" --mode lan --directory "$install_dir"
# Install reference budget/guards only on this disposable runner.
test ! -e /run/systemd/system/servidor-dev.slice
install -m 0644 deploy/dev/systemd/servidor-dev.slice /run/systemd/system/servidor-dev.slice
slice_installed=true
systemctl daemon-reload
systemctl start servidor-dev.slice
iptables -N SPECOPS-DEV-FWD
iptables -N SPECOPS-DEV-HOST
iptables -I DOCKER-USER 1 -j SPECOPS-DEV-FWD
iptables -I INPUT 1 -j SPECOPS-DEV-HOST
firewall_installed=true
for subnet in 172.29.92.0/24 172.29.93.0/24; do
  iptables -A SPECOPS-DEV-FWD -s "$subnet" ! -d "$subnet" -m conntrack --ctstate NEW -j DROP
  iptables -A SPECOPS-DEV-HOST -s "$subnet" -m conntrack --ctstate NEW -j DROP
done
iptables -A SPECOPS-DEV-FWD -j RETURN
iptables -A SPECOPS-DEV-HOST -j RETURN
"${compose[@]}" pull gateway-dev
"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 120
python3 scripts/validate-dev.py --config "$tmp/config.json" --mode ci --directory "$install_dir" --runtime
# TLS uses a constrained offline root; no root private key exists in the gateway.
curl --noproxy '*' --fail --silent --show-error --cacert "$install_dir/tls/root.crt" --resolve cebo-dev.home.arpa:18444:127.0.0.1 https://cebo-dev.home.arpa:18444/api/health
python3 scripts/validate-dev.py --tls-only --directory "$install_dir" --tls-status "$tmp/cebo-dev-tls.json"
if curl --noproxy '*' --silent --cacert "$install_dir/tls/root.crt" --resolve wrong.invalid:18444:127.0.0.1 https://wrong.invalid:18444/api/health; then exit 1; fi
# Annual offline renewal: same trusted root, complete new bundle, app untouched.
cp "$install_dir/tls/root.crt" "$tmp/trusted-root.crt"
app_before=$("${compose[@]}" ps -q app-dev)
gateway_before=$("${compose[@]}" ps -q gateway-dev)
python3 scripts/dev-certificates.py --renew --ca-dir "$tmp/offline-ca" --tls-dir "$install_dir/tls" --output-dir "$tmp/renewed-tls"
"${compose[@]}" stop gateway-dev
mv "$install_dir/tls" "$install_dir/tls-before-renewal"
mv "$tmp/renewed-tls" "$install_dir/tls"
"${compose[@]}" start gateway-dev
for attempt in {1..40}; do
  if curl --noproxy '*' --fail --silent --cacert "$tmp/trusted-root.crt" --resolve cebo-dev.home.arpa:18444:127.0.0.1 https://cebo-dev.home.arpa:18444/api/health >/dev/null; then break; fi
  sleep 1
done
curl --noproxy '*' --fail --silent --cacert "$tmp/trusted-root.crt" --resolve cebo-dev.home.arpa:18444:127.0.0.1 https://cebo-dev.home.arpa:18444/api/health >/dev/null
python3 - "$install_dir" "$tmp/trusted-root.crt" <<'PY'
import hashlib,socket,ssl,sys
from pathlib import Path
root=Path(sys.argv[1]); tls=root/'tls'
assert (tls/'root.crt').read_bytes()==Path(sys.argv[2]).read_bytes()
assert (tls/'server.crt').read_bytes()!=(root/'tls-before-renewal/server.crt').read_bytes()
context=ssl.create_default_context(cafile=sys.argv[2])
with socket.create_connection(('127.0.0.1',18444),timeout=5) as connection:
    with context.wrap_socket(connection,server_hostname='cebo-dev.home.arpa') as peer:
        expected=ssl.PEM_cert_to_DER_cert((tls/'server.crt').read_text())
        assert hashlib.sha256(peer.getpeercert(binary_form=True)).digest()==hashlib.sha256(expected).digest()
PY
[[ "$app_before" == "$("${compose[@]}" ps -q app-dev)" ]]
[[ "$gateway_before" == "$("${compose[@]}" ps -q gateway-dev)" ]]
python3 scripts/validate-dev.py --tls-only --directory "$install_dir" --tls-status "$tmp/cebo-dev-tls.json"
echo 'DEV TLS renewal: original CA trusted, new leaf actually served, app and gateway IDs preserved.'
# A synthetic PROD-labelled service and host listener prove guards block real destinations.
gateway_image=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["services"]["gateway-dev"]["image"])' "$tmp/config.json")
docker network create "$sentinel_net" >/dev/null
docker run -d --name "$sentinel" --network "$sentinel_net" --label com.docker.compose.project=cebo-pemento --label com.docker.compose.service=app "$gateway_image" caddy file-server --listen :8080 --root /usr/share/caddy >/dev/null
sentinel_id=$(docker inspect "$sentinel" --format '{{.Id}}')
sentinel_ip=$(docker inspect "$sentinel" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
mkdir "$tmp/public"; printf 'synthetic\n' > "$tmp/public/index.html"
python3 -m http.server 12347 --bind 172.29.93.1 --directory "$tmp/public" >/dev/null 2>&1 &
host_fixture_pid=$!
for attempt in {1..20}; do
  if curl --noproxy '*' --fail --silent http://172.29.93.1:12347/ >/dev/null; then break; fi
  sleep 0.2
done
curl --noproxy '*' --fail --silent http://172.29.93.1:12347/ >/dev/null
for target in "http://$sentinel_ip:8080" http://172.29.93.1:12347 http://1.1.1.1:80; do
  "${compose[@]}" exec -T app-dev node -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(1500)}).then(()=>process.exit(1)).catch(()=>process.exit(0))' "$target"
  if "${compose[@]}" exec -T gateway-dev wget -Y off -T 2 -q -O /dev/null "$target"; then exit 1; fi
done
"${compose[@]}" exec -T app-dev node -e "const d=require('dns').promises; Promise.race([d.resolve4('example.com'),new Promise((_,r)=>setTimeout(()=>r(Error()),2000))]).then(()=>process.exit(1)).catch(()=>process.exit(0))"
# Reboot equivalent: start provisioned containers, preserving IDs and synthetic PROD.
before=$("${compose[@]}" ps -q | sort)
"${compose[@]}" stop
"${compose[@]}" start
for attempt in {1..40}; do
  if curl --noproxy '*' --fail --silent --cacert "$install_dir/tls/root.crt" --resolve cebo-dev.home.arpa:18444:127.0.0.1 https://cebo-dev.home.arpa:18444/api/health >/dev/null; then break; fi
  sleep 1
done
curl --noproxy '*' --fail --silent --cacert "$install_dir/tls/root.crt" --resolve cebo-dev.home.arpa:18444:127.0.0.1 https://cebo-dev.home.arpa:18444/api/health >/dev/null
[[ "$before" == "$("${compose[@]}" ps -q | sort)" ]]
[[ "$sentinel_id true" == "$(docker inspect "$sentinel" --format '{{.Id}} {{.State.Running}}')" ]]
python3 scripts/validate-dev.py --config "$tmp/config.json" --mode ci --directory "$install_dir" --runtime
echo 'DEV: immutable image, fixed resources, constrained TLS, no PROD/host/internet egress, DNS isolation and restart passed.'
