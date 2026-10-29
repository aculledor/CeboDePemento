#!/usr/bin/env bash
# Isolated test data only. No fixed production container/volume names.
set -Eeuo pipefail
image="${1:?Specify built image}"
suffix="$(date +%s)-$$"
container="cebo-smoke-$suffix"
volume="cebo-smoke-data-$suffix"
temporary="$(mktemp -d)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "$temporary"
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null
start() {
  docker run -d --name "$container" --read-only --cap-drop ALL --security-opt no-new-privileges \
    --memory 512m --cpus 0.5 --pids-limit 128 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000 \
    -e APP_ORIGINS=https://smoke.invalid -e BACKUP_INTERVAL_HOURS=0 \
    -v "$volume:/app/data" "$image" >/dev/null
  for attempt in $(seq 1 40); do
    if docker exec "$container" node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then return; fi
    sleep 2
  done
  docker logs "$container" >&2
  return 1
}
start
printf '%s\n' 'isolated-smoke-test-password' | docker exec -i "$container" node apps/api/dist/cli.js admin smokeadmin >/dev/null
docker exec "$container" node apps/api/dist/pescaderias/cli.js help >/dev/null
docker exec "$container" node -e "const d=require('better-sqlite3')('/app/data/catalogo.sqlite');if(d.pragma('integrity_check',{simple:true})!=='ok'||d.pragma('foreign_key_check').length||d.prepare('SELECT count(*) n FROM taxa').get().n!==932)process.exit(1);"
docker exec "$container" node apps/api/dist/cli.js backup > "$temporary/backup.json"
snapshot="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["directory"])' "$temporary/backup.json")"
docker cp "$container:$snapshot" "$temporary/snapshot"
test -d "$temporary/snapshot"
# Recreate only this test container, retaining its test volume.
docker rm -f "$container" >/dev/null
start
docker exec "$container" node -e "const d=require('better-sqlite3')('/app/data/catalogo.sqlite');if(d.prepare(\"SELECT count(*) n FROM users WHERE username='smokeadmin'\").get().n!==1)process.exit(1);"
docker exec "$container" node --input-type=module -e "import {restoreSnapshot} from './apps/api/dist/restore.js'; await restoreSnapshot(process.argv[1],'data/smoke-restored.sqlite','data/smoke-photos');" "$snapshot" >/dev/null
printf '%s\n' 'Production image: health, compiled importer, read-only runtime, migrations, persistence, backup export and restore passed.'
