#!/usr/bin/env bash
# Same preserve-digests copy as publish, against an unauthenticated local fixture.
set -Eeuo pipefail
[[ "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
[[ "$(hostname)" != nuc-cas && -z "${DOCKER_HOST:-}" && "$(docker context show)" == default ]]
: "${EXPECTED_DIGEST:?Pass the OCI digest produced by the existing build}"
[[ "$EXPECTED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
archive="${1:?Pass the already tested OCI archive}"
test -f "$archive"
work="$(mktemp -d)"
registry="cebo-oci-fixture-$$"
cleanup() {
  docker rm -f "$registry" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
docker run -d --name "$registry" --memory 768m --cpus 1 --pids-limit 128 \
  --read-only --tmpfs /var/lib/registry:rw,size=1g --tmpfs /tmp:rw,size=16m \
  -p 127.0.0.1::5000 registry:2.8.3 >/dev/null
endpoint="$(docker port "$registry" 5000/tcp)"
[[ "$endpoint" =~ ^127\.0\.0\.1:[0-9]+$ ]]
for attempt in {1..40}; do
  if curl --noproxy '*' --fail --silent "http://$endpoint/v2/" >/dev/null; then break; fi
  sleep 0.25
done
curl --noproxy '*' --fail --silent "http://$endpoint/v2/" >/dev/null
ref="$endpoint/cebo-oci-fixture:tested"
# No auth, GHCR, rebuild, secrets or SpecOps candidate publication.
skopeo copy --all --preserve-digests --dest-tls-verify=false "oci-archive:$archive" "docker://$ref"
skopeo inspect --tls-verify=false --raw "docker://$ref" > "$work/index.json"
[[ "sha256:$(sha256sum "$work/index.json" | cut -d' ' -f1)" == "$EXPECTED_DIGEST" ]]
python3 - "$work/index.json" > "$work/manifests" <<'PY'
import json,re,sys
index=json.load(open(sys.argv[1]))
manifests=index['manifests']
assert any(m.get('platform',{}).get('architecture')=='amd64' and m['platform'].get('os')=='linux' for m in manifests)
assert any(m.get('annotations',{}).get('vnd.docker.reference.type')=='attestation-manifest' for m in manifests)
for manifest in manifests:
    assert re.fullmatch(r'sha256:[0-9a-f]{64}', manifest['digest'])
    print(manifest['digest'])
PY
while read -r digest; do
  skopeo inspect --tls-verify=false --raw "docker://$endpoint/cebo-oci-fixture@$digest" > "$work/manifest.json"
  [[ "sha256:$(sha256sum "$work/manifest.json" | cut -d' ' -f1)" == "$digest" ]]
done < "$work/manifests"
echo 'OCI loopback: index, AMD64 and attestation manifests preserve their tested digests.'
