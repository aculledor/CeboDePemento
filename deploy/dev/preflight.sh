#!/usr/bin/env bash
# REFERENCE: review/install locally outside Git, never execute a PR on the NUC.
set -Eeuo pipefail
umask 077
[[ "$EUID" == 0 && -z "${DOCKER_HOST:-}" ]]
[[ "$(docker context show)" == default ]]
exec 9>/run/lock/cebo-pemento-dev.lock
flock -w 10 9
work="$(mktemp -d /run/cebo-dev-preflight.XXXXXX)"
trap 'rm -rf -- "$work"' EXIT
cd /opt/servicios-dev/cebo-pemento
# Private baseline and local template were reviewed at bootstrap. No pull or up.
env -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME -u CEBO_DEV_IMAGE -u CEBO_DEV_HOST -u CEBO_DEV_BIND \
  docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml config --format json > "$work/config.json"
/usr/bin/python3 -I /usr/local/libexec/cebo-pemento-dev/validate-dev.py \
  --config "$work/config.json" --directory /opt/servicios-dev/cebo-pemento --mode lan --guards
