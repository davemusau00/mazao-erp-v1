#!/usr/bin/env bash
set -euo pipefail
cd /srv/mazaoyako
compose=(sudo -n docker compose --project-name mazaoyako --env-file /srv/mazaoyako/.env -f /srv/mazaoyako/compose.yml)

count=$("${compose[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM core.tenants"')
if [[ "$count" != 0 ]]; then
  echo 'A tenant already exists. Initial bootstrap stopped without changing data.' >&2
  exit 1
fi

# Keep this interactive: bootstrap.ts reads owner details from the terminal and
# accepts the password through a hidden prompt, never through shell arguments or env.
"${compose[@]}" run -it --rm --no-deps api bun apps/api/scripts/bootstrap.ts
