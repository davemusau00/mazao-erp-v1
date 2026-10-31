#!/usr/bin/env bash
# Activate only CI artifacts from a successful main workflow for this exact SHA.
set -euo pipefail
umask 077
release=${1:?full source commit SHA required}
api_tar_hash=${2:?API image TAR SHA-256 required}
pwa_tar_hash=${3:?Yako PWA TAR SHA-256 required}
[[ $release =~ ^[a-f0-9]{40}$ && $api_tar_hash =~ ^[a-f0-9]{64}$ && $pwa_tar_hash =~ ^[a-f0-9]{64}$ ]]

cd /srv/mazaoyako
compose=(sudo -n docker compose --project-name mazaoyako --env-file /srv/mazaoyako/.env -f /srv/mazaoyako/compose.yml)
image="ghcr.io/davemusau00/mazao-erp-v1/api:$release"
api_tar="incoming/api-$release.tar"
pwa_tar="incoming/pwa-$release.tar.gz"
destination="/var/www/mazaoyako/releases/$release"
stage="/var/www/mazaoyako/releases/.$release.staging"
[[ -f .env && -f compose.yml && -f "$api_tar" && -f "$pwa_tar" ]]
printf '%s  %s\n%s  %s\n' "$api_tar_hash" "$api_tar" "$pwa_tar_hash" "$pwa_tar" | sha256sum --check --strict

python3 - "$pwa_tar" <<'PY'
import sys, tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe PWA archive entry')
PY

test ! -e "$destination" && test ! -e "$stage"
sudo -n nginx -t
mkdir -p incoming backups
sudo -n docker load -i "$api_tar"
test "$(sudo -n docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$release"
sudo -n install -d -o www-data -g www-data -m 755 "$stage"
sudo -n tar -xzf "$pwa_tar" -C "$stage"
test -f "$stage/index.html"
grep -Rq 'https://api.mazaoyako.co.ke' "$stage/assets"
sudo -n find "$stage" -type d -exec chmod 755 {} +
sudo -n find "$stage" -type f -exec chmod 644 {} +
sudo -n chown -R www-data:www-data "$stage"
sudo -n mv -T "$stage" "$destination"

cp .env "backups/env-before-$release"
chmod 600 "backups/env-before-$release"
previous_static=''
if [[ -L /var/www/mazaoyako/current ]]; then
  previous_static=$(readlink -f /var/www/mazaoyako/current)
  [[ $previous_static == /var/www/mazaoyako/releases/* ]]
fi
printf '%s\n' "$previous_static" > "backups/pwa-before-$release"

rollback() {
  local rc=$?
  trap - ERR
  set +e
  echo 'Mazao Yako activation failed; restoring its prior API/static configuration when one exists.' >&2
  cp "backups/env-before-$release" .env
  if [[ -n "$previous_static" ]]; then
    "${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api
    sudo -n ln -s "$previous_static" "/var/www/mazaoyako/current.rollback"
    sudo -n mv -Tf "/var/www/mazaoyako/current.rollback" /var/www/mazaoyako/current
    curl --retry 5 --retry-all-errors --retry-delay 1 --fail --silent --show-error http://127.0.0.1:4102/api/v1/health/ready
  else
    echo 'This was the initial Yako activation; existing applications were not changed.' >&2
  fi
  exit "$rc"
}
trap rollback ERR

sed -i "s|^MAZAO_API_IMAGE=.*|MAZAO_API_IMAGE=$image|" .env
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait --wait-timeout 120 db
"${compose[@]}" run -T --rm --no-deps api bun apps/api/src/migration.ts
"${compose[@]}" run -T --rm --no-deps api bun apps/api/src/migration.ts
"${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api
test "$(sudo -n docker inspect mazaoyako-api-1 --format '{{.Config.Image}}')" = "$image"
network_config=$(sudo -n docker network inspect mazaoyako-private --format '{{json .IPAM.Config}}')
python3 -c 'import json,sys; config=json.loads(sys.argv[1]); assert len(config)==1 and config[0]["Subnet"]=="172.26.0.0/24" and config[0]["Gateway"]=="172.26.0.1", config' "$network_config"
api_pid=$(sudo -n docker inspect mazaoyako-api-1 --format '{{.State.Pid}}')
proxy_peer=$(python3 deployment-config/verify-proxy-peer.py "$api_pid")
printf 'api_container_host_pid=%s\nobserved_proxy_peer=%s\n' "$api_pid" "$proxy_peer" > "backups/proxy-peer-$release.txt"
sudo -n docker inspect mazaoyako-db-1 | python3 -c 'import json,sys; bindings=json.load(sys.stdin)[0]["HostConfig"]["PortBindings"] or {}; assert not bindings, bindings'
sudo -n docker inspect mazaoyako-api-1 | python3 -c 'import json,sys; bindings=json.load(sys.stdin)[0]["HostConfig"]["PortBindings"] or {}; assert bindings == {"4101/tcp":[{"HostIp":"127.0.0.1","HostPort":"4102"}]}, bindings'
curl --fail --silent --show-error http://127.0.0.1:4102/api/v1/health/ready

preflight=$(curl --silent --show-error --include --request OPTIONS http://127.0.0.1:4102/api/v1/auth/login \
  --header 'Origin: https://mazaoyako.co.ke' --header 'Access-Control-Request-Method: POST' \
  --header 'Access-Control-Request-Headers: content-type,x-csrf-token,x-request-id')
grep -Fqi 'access-control-allow-origin: https://mazaoyako.co.ke' <<< "$preflight"
grep -Fqi 'access-control-allow-credentials: true' <<< "$preflight"
rejected=$(curl --silent --show-error --include --request OPTIONS http://127.0.0.1:4102/api/v1/auth/login \
  --header 'Origin: https://attacker.invalid' --header 'Access-Control-Request-Method: POST' \
  --header 'Access-Control-Request-Headers: content-type')
grep -q '^HTTP/[^ ]* 403' <<< "$rejected"
! grep -Eqi '^access-control-allow-origin:' <<< "$rejected"

sudo -n ln -s "$destination" "/var/www/mazaoyako/current.$release.next"
sudo -n mv -Tf "/var/www/mazaoyako/current.$release.next" /var/www/mazaoyako/current
sudo -n nginx -t
curl --retry 5 --retry-all-errors --retry-delay 1 --resolve api.mazaoyako.co.ke:443:127.0.0.1 --fail --silent --show-error https://api.mazaoyako.co.ke/api/v1/health/ready
curl --retry 5 --retry-all-errors --retry-delay 1 --resolve mazaoyako.co.ke:443:127.0.0.1 --fail --silent --show-error https://mazaoyako.co.ke/ -o /dev/null
public_preflight=$(curl --silent --show-error --include --resolve api.mazaoyako.co.ke:443:127.0.0.1 https://api.mazaoyako.co.ke/api/v1/auth/login \
  --request OPTIONS --header 'Origin: https://mazaoyako.co.ke' --header 'Access-Control-Request-Method: POST' \
  --header 'Access-Control-Request-Headers: content-type,x-csrf-token,x-request-id')
grep -q '^HTTP/[^ ]* 204' <<< "$public_preflight"
grep -Fqi 'access-control-allow-origin: https://mazaoyako.co.ke' <<< "$public_preflight"
grep -Fqi 'access-control-allow-credentials: true' <<< "$public_preflight"

printf '%s\n' "$release" > release-sha
trap - ERR
printf '\nMazao Yako release activated: %s\n' "$release"
