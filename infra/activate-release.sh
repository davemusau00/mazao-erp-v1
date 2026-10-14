#!/usr/bin/env bash
# Run only after passing CI artifacts and a verified off-host restore checkpoint.
# Usage: bash activate-release.sh <full-commit-sha> <api-zip-sha256> <pwa-tar-sha256>
set -euo pipefail
umask 077
release=${1:?full commit SHA required}
api_hash=${2:?API artifact ZIP checksum required}
pwa_hash=${3:?PWA archive checksum required}
[[ $release =~ ^[a-f0-9]{40}$ && $api_hash =~ ^[a-f0-9]{64}$ && $pwa_hash =~ ^[a-f0-9]{64}$ ]]
cd /srv/mazao
image=ghcr.io/davemusau00/mazao-erp-v1/api:$release
api_zip=incoming/api-$release.zip
pwa_tar=incoming/pwa-$release.tar.gz
destination=/var/www/mazao/releases/$release
stage=/var/www/mazao/releases/.$release.staging
test -f .env && test -f compose.yml
grep -q '^MAZAO_API_IMAGE=' .env
printf '%s  %s\n%s  %s\n' "$api_hash" "$api_zip" "$pwa_hash" "$pwa_tar" | sha256sum --check --strict
test "$(unzip -Z1 "$api_zip")" = 'mazao-api-image.tar'
# Never extract an absolute path, escaping path or link into the web root.
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
mkdir -p "incoming/api-$release" backups
unzip -o "$api_zip" -d "incoming/api-$release"
docker load -i "incoming/api-$release/mazao-api-image.tar"
test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$release"
sudo -n install -d -m 755 "$stage"
sudo -n tar -xzf "$pwa_tar" -C "$stage"
test -f "$stage/index.html"
sudo -n find "$stage" -type d -exec chmod 755 {} +
sudo -n find "$stage" -type f -exec chmod 644 {} +
sudo -n mv -T "$stage" "$destination"
cp .env "backups/env-before-$release"
chmod 600 "backups/env-before-$release"
previous_static=$(readlink /var/www/mazao/current)
[[ $previous_static == /var/www/mazao/releases/* ]]
printf '%s\n' "$previous_static" > "backups/pwa-before-$release"
compose() { docker compose --project-name mazao --env-file /srv/mazao/.env -f /srv/mazao/compose.yml "$@"; }
rollback() {
  trap - ERR
  set +e
  echo 'Activation failed; restoring the previous Mazao API/static release without reversing migrations.' >&2
  cp "backups/env-before-$release" .env || { echo 'Could not restore the Mazao environment; operator recovery is required.' >&2; exit 1; }
  compose up -d --no-deps --wait --wait-timeout 120 api
  rollback_api_status=$?
  if [[ $(readlink /var/www/mazao/current) != "$previous_static" ]]; then
    sudo -n ln -s "$previous_static" /var/www/mazao/current.rollback
    sudo -n mv -Tf /var/www/mazao/current.rollback /var/www/mazao/current
  fi
  curl --retry 5 --retry-all-errors --retry-delay 1 --fail --silent --show-error http://127.0.0.1:4101/api/v1/health/ready
  rollback_ready_status=$?
  if [[ $rollback_api_status != 0 || $rollback_ready_status != 0 || $(readlink /var/www/mazao/current) != "$previous_static" ]]; then
    echo 'Rollback verification failed; inspect only the Mazao project before routing further traffic.' >&2
  else
    echo 'Previous Mazao API is ready and static release restored.' >&2
  fi
  exit 1
}
trap rollback ERR
sed -i "s|^MAZAO_API_IMAGE=.*|MAZAO_API_IMAGE=$image|" .env
compose config --quiet
compose run -T --rm --no-deps api bun apps/api/src/migration.ts
compose run -T --rm --no-deps api bun apps/api/src/migration.ts
compose up -d --no-deps --wait --wait-timeout 120 api
test "$(docker inspect mazao-api-1 --format '{{.Config.Image}}')" = "$image"
curl --fail --silent --show-error http://127.0.0.1:4101/api/v1/health/ready
sudo -n ln -s "$destination" "/var/www/mazao/current.$release.next"
sudo -n mv -Tf "/var/www/mazao/current.$release.next" /var/www/mazao/current
curl --retry 5 --retry-all-errors --retry-delay 1 --resolve mazao.davemusau.co.ke:443:127.0.0.1 --fail --silent --show-error https://mazao.davemusau.co.ke/api/v1/health/ready
sudo -n nginx -t
printf '%s\n' "$release" > release-sha
trap - ERR
printf '\nMazao release activated: %s\n' "$release"
