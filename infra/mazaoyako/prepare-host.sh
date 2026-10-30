#!/usr/bin/env bash
set -euo pipefail
umask 077

release=${1:?full main commit SHA required}
[[ $release =~ ^[a-f0-9]{40}$ ]]
config_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
operator=$(id -un)
operator_group=$(id -gn)
root=/srv/mazaoyako

if sudo -n test -e "$root"; then
  echo "$root already exists; inspect it before preparing this new deployment." >&2
  exit 1
fi
if sudo -n docker ps -a --filter label=com.docker.compose.project=mazaoyako --quiet | grep -q .; then
  echo 'Compose project mazaoyako already exists; inspect it before preparing this new deployment.' >&2
  exit 1
fi
if sudo -n docker volume inspect mazaoyako-postgres-data >/dev/null 2>&1; then
  echo 'Docker volume mazaoyako-postgres-data already exists; refusing to reuse unknown database state.' >&2
  exit 1
fi
if sudo -n docker network inspect mazaoyako-private >/dev/null 2>&1; then
  echo 'Docker network mazaoyako-private already exists; inspect it before preparing this new deployment.' >&2
  exit 1
fi
if sudo -n ss -Hlnt 'sport = :4102' | grep -q .; then
  echo 'Port 4102 is already listening; choose and review an unused Yako API port before proceeding.' >&2
  exit 1
fi

command -v openssl >/dev/null
database_password=$(openssl rand -hex 32)
credential_key=$(openssl rand -hex 32)
sudo -n install -d -o "$operator" -g "$operator_group" -m 750 "$root"
install -d -m 700 "$root/incoming" "$root/backups"
install -d -m 750 "$root/deployment-config"
sudo -n install -o "$operator" -g "$operator_group" -m 644 "$config_dir/compose.yml" "$root/compose.yml"
for file in "$config_dir"/*.conf "$config_dir"/*.sh "$config_dir"/*.py "$config_dir"/.env.example; do
  install -m 640 "$file" "$root/deployment-config/"
done

env_file=$(mktemp "$root/.env.XXXXXXXX")
trap 'rm -f "$env_file"' EXIT
cat > "$env_file" <<EOF
NODE_ENV=production
API_PORT=4102
APP_ORIGINS=https://mazaoyako.co.ke
TRUSTED_PROXY_IPS=172.26.0.1
CREDENTIAL_FINGERPRINT_KEY=$credential_key
DB_NAME=mazaoyako
DB_USER=mazaoyako_app
DB_PASSWORD=$database_password
DATABASE_URL=postgresql://mazaoyako_app:$database_password@db:5432/mazaoyako
MAZAO_API_IMAGE=ghcr.io/davemusau00/mazao-erp-v1/api:$release
EOF
chmod 600 "$env_file"
mv -T "$env_file" "$root/.env"
trap - EXIT
unset database_password credential_key

printf 'Prepared isolated Mazao Yako host configuration for %s. Secrets were written only to %s/.env.\n' "$release" "$root"
