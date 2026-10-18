# MAZAO | Non-destructive production release and rollback runbook

**Use only after all other sprint gates pass.** This document describes a procedure; it does not authorize immediate execution, assert that PR #18 is green, or substitute for a live operator's permission. Target: MAZAO's isolated Compose project on VPS `93.127.131.55`. Other stacks sharing the VPS must not be touched.

## Architecture verified during previous release

- MAZAO installation `/srv/mazao`, Compose project `mazao`, `.env` and `compose.yml`.
- API `mazao-api-1` exposed via loopback `127.0.0.1:4101`, PostgreSQL `mazao-db-1` using named volume `mazao-postgres-data`.
- Frontend symlink `/var/www/mazao/current` points to versioned `/var/www/mazao/releases/<sha>`.
- Public app `https://mazao.davemusau.co.ke`; health `GET /api/v1/health/ready`.
- `infra/activate-release.sh` verifies two archives, checks image source revision, installs a new static directory, preserves env/PWA rollback references, migrates and restarts **only** MAZAO API, switches symlink and checks readiness.
- Last operator-verified deployment: `872514217272c154236fcab02bfda11417dd5dff`. Re-check the live state before any future release.

## Preflight and no-go checks

1. **Merge and test exact code first.** PR #18 must be green after reconciliation and review. Artifact names are generated only for passing `main` pushes, not arbitrary PR commits. Record promoted `NEW_SHA` from the successful `main` Actions run. The old artifact IDs and hashes from `8725142` are **not reusable** for a new release.
2. **Schema compatibility.** Inventory all candidate migration versions and SQL checksums (PR #18 adds `017_configuration_assets.sql`; other work may also propose 017). Verify *new* migration numbering before application. Additive migration does not imply the **old API** can read all new data: test rollback-app compatibility explicitly.
3. **Backup.** Use the existing `infra/Backup-Mazao.ps1 -VerifyRestore` from **local Windows PowerShell**, not Ubuntu Bash. Require `restoreVerified: true`, no unbalanced journal control totals and retain the encrypted DPAPI backup off-host. Store backup metadata, not credentials, in release ticket. The Windows DPAPI key depends on the creating account and its recovery material.
4. **VPS read-only check.** API/db Compose health, current image SHA, PWA target, disk/RAM, `nginx -t`, and independent services. Resolve any active production incidents before cutover.
5. **Business acceptance.** Existing unposted 74-item physical count remains in progress; no automated count close/post. Confirm current QR/logo/reprints and staff accounts before migrating asset model.
6. **Change window.** Inform operators of a possible brief MAZAO-only API interruption. Do not reboot Ubuntu or apply unrelated system/Compose updates during release.

## Phase 1: discover and verify release artifacts

- CI workflow: `.github/workflows/ci.yml` (jobs `TypeScript and production build`, `Validate API container and publish main releases`).
- Required artifact names: `mazao-api-image-<NEW_SHA>` and `mazao-pwa-<NEW_SHA>` from the **same passing `main` run**.
- Use `gh` with authenticated GitHub API to download each artifact. GitHub's artifact ZIP may wrap `mazao-api-image.tar`; preserve the exact canonical image identity.
- Compare API ZIP bytes against GitHub-provided digest where available, then compute `sha256sum` on the zip staged on VPS. Extract/build PWA tar locally, compute its new SHA256, and compare VPS upload checksum. Never reuse hash of an old tar for a new PWA.
- Fetch the **exact** `infra/activate-release.sh` from the new SHA, inspect its diff against previously approved script, and do not use a modified script from an unverified working directory.

## Phase 2: stage files without changing live services

Example read-only server inspection from Windows:

```powershell
ssh mazao-live 'cd /srv/mazao && cat release-sha && docker compose --project-name mazao --env-file .env -f compose.yml ps && readlink -f /var/www/mazao/current && sudo -n nginx -t'
```

Stage only the three **new** exact files under `/srv/mazao/incoming/` using `scp`. Verify file sizes and SHA256 on VPS. Confirm currently deployed `release-sha` still equals the expected old release. Stop if it has advanced or there is an unexpected existing release destination.

## Phase 3: controlled activation

The script usage is:

```bash
bash /srv/mazao/incoming/activate-release.sh <FULL_NEW_SHA> <NEW_API_ZIP_SHA256> <NEW_PWA_TAR_SHA256>
```

Only run the above with actual, independently verified current arguments and an approved change window. Do not run placeholders. The script migrates the database **before** it swaps API/PWA, then replaces only the API with `docker compose up -d --no-deps --wait api`; it does not recreate the DB.

Observe all migration output. If migration 017 fails or the API image health check fails, stop and inspect the script's rollback log. Don't repeatedly apply partially failed releases until state is inspected.

## Phase 4: immediate verification

```bash
cd /srv/mazao
cat release-sha
docker compose --project-name mazao --env-file .env -f compose.yml ps
docker inspect mazao-api-1 --format '{{.Config.Image}}'
readlink -f /var/www/mazao/current
curl --fail --silent --show-error http://127.0.0.1:4101/api/v1/health/ready
curl --fail --silent --show-error https://mazao.davemusau.co.ke/api/v1/health/ready
sudo nginx -t
```

Then, in a permitted authenticated **read-only** pilot session, verify: same business/outlet identity, existing products and balances, saved counts including user's 74-item open count, historical receipt and logo/QR, Staff/Assignments listing, fixed role matrix, Manage configuration latency, signed-in PWA freshness and request errors. Exercise new writes only in disposable/staging or an explicitly approved pilot procedure, not ad hoc on the real business.

## Rollback, recovery and migration caveat

`activate-release.sh` snapshots `.env` and previous PWA symlink, and on failure attempts to restore the former MAZAO API and static release. **It does not reverse database migrations.** It cannot guarantee the old API understands records transformed by a newer API, and it does not automatically recover off-host data loss. Do not claim complete rollback until database and application compatibility has been tested.

If activation fails:

1. Preserve entire output and timestamps. Confirm which step ran last and whether `release-sha` was rewritten.
2. Check only the MAZAO project's API, static symlink and migration state. Avoid `docker compose down -v`, `docker system prune --volumes`, `docker volume prune`, DB recreates or broad Nginx restarts.
3. Verify previous app is healthy and retained image exists; if rollback isn't healthy, stop and involve operator rather than hand-editing DB to match old source.
4. If a database restore is ever needed, restore to a **new isolated instance first**, verify command/journal invariants and operational data. Production replacement requires a separate controlled decision and downtime plan.
5. Recheck SERVEOS and all unrelated stack processes, routing and ports (without restarting them).

## Release record template

```text
Change ticket:
Operator approval:
Production old API/PWA SHA:
Candidate new SHA:
GitHub successful run URL:
API artifact ID/digest/local SHA256/VPS SHA256:
PWA artifact ID/source ZIP SHA256/packaged tar SHA256/VPS SHA256:
Migration list and 016→017 upgrade acceptance:
Credential-key continuity verified (yes/no, no secret value):
Off-host backup createdAt/restoreVerified/control totals:
Cutover started/completed UTC+EAT:
API readiness and symlink verification:
Read-only business check results:
PWA SW/version check:
Other VPS services verified:
Rollback path and backward compatibility verified:
Final disposition: SUCCESS / HOLD / ROLLBACK
```

## Banned shortcuts

- `docker compose down -v` or delete `mazao-postgres-data`.
- Global `docker prune`/volume cleanup or broad `docker compose up --force-recreate` across projects.
- Re-run bootstrap/seed over existing tenant data.
- Update `main`/GitHub CI from a release shell or use untested PR-built PWA against old API.
- Ignore red CI, assign new SHA/hash by guess, or manually edit immutable migration files.
- Delete live browser storage/IndexedDB or replace the saved count with opening quantities during a performance investigation.
