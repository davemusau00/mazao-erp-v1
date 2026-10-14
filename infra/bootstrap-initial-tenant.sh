#!/usr/bin/env bash
set -euo pipefail
cd /srv/mazao
compose=(docker compose --project-name mazao --env-file /srv/mazao/.env -f /srv/mazao/compose.yml)
count=$("${compose[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM core.tenants"')
if [[ "$count" != 0 ]]; then
  echo 'A tenant already exists. Initial bootstrap stopped without changing data.' >&2
  exit 1
fi
"${compose[@]}" run -T --rm --no-deps api bun -e 'const input = await Bun.stdin.json(); Object.assign(process.env, input); await import("./apps/api/scripts/bootstrap.ts");'
