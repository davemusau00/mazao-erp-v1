# Mazao backup and restore runbook

## Gate before business data

The pilot supports an off-host checkpoint on the operator's Windows PC using infra/Backup-Mazao.ps1 -VerifyRestore. It downloads a PostgreSQL custom-format dump over verified SSH, encrypts it with Windows DPAPI for the current Windows account, decrypts that encrypted file, and restores it into a disposable PostgreSQL 16 container with no network. It records the live migration count and head before and after the dump, requires the restored database to match that exact current migration state, records tenant, order and journal totals, and rejects unbalanced journals. It does not assume that a future candidate migration is already applied to production. Temporary plaintext dumps are removed on the VPS and Windows PC. The encrypted files are saved under %LOCALAPPDATA%/Mazao/Backups with owner-only permissions. Recovery requires this Windows account and its DPAPI recovery material; the copy is not portable to another account.

Run this verified checkpoint before creating a real pilot tenant, then again after initial setup. A daily Windows scheduled task can run the script while this PC is on and its account is available; missed runs and offline PCs must be monitored. This interim arrangement has no claimed RPO or unattended cloud retention. Configure a continuously available off-host destination before routine business use. For object storage, configure age and rclone as below; keep the age private key offline and never store credentials or dumps in Git.

## Create an encrypted backup

Run from a restricted backup runner with Docker Compose, age, and rclone configured. The database is private to the Mazao Compose network; no PostgreSQL host port is needed.

```sh
set -euo pipefail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="mazao/postgres/$stamp.dump.age"

docker compose --project-name mazao \
  --env-file /srv/mazao/.env \
  -f /srv/mazao/compose.yml \
  exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  | age -r "$MAZAO_AGE_RECIPIENT" \
  | rclone rcat "$MAZAO_BACKUP_REMOTE/$file"

rclone lsjson "$MAZAO_BACKUP_REMOTE/$file" --stat
```

The backup runner must fail the job on any pipeline error, record the object version and timestamp, and alert if the newest verified object exceeds the agreed interval. Retain encrypted backups off-host with provider-side lifecycle and immutability controls. Do not treat a successful upload or checksum as a restore test.

## Restore verification

At least monthly, retrieve one encrypted backup to an isolated workstation or recovery host, decrypt with the offline-controlled age private key, and restore into a disposable PostgreSQL 16 container on a private network. Use separate temporary credentials; do not point the restore job at the live Compose project or enable workers, webhooks, or external providers.

After restore:

1. Confirm PostgreSQL starts and the recorded migration head/checksums match the release.
2. Run integrity checks for tenant totals, order/tender/journal counts, balanced journal entries, inventory movement totals, and customer account allocations.
3. Record elapsed recovery time, backup object version, database migration head, and any discrepancies.
4. Remove only the disposable restore container and its temporary volume after evidence is recorded.

Never use reverse SQL migrations as a restore strategy. For a real incident, fence writes, select the authoritative recovery point, preserve unknown command IDs for reconciliation, restore and validate, then deliberately reopen writes and document the audit trail.

## Observed local restore runtime failure ? 14 October 2026

A verification attempt reported PostgreSQL fdatasync I/O errors and Docker Desktop read-only metadata storage. The VPS remained healthy. Encrypted off-host backup creation still works because it uses remote pg_dump and Windows DPAPI; the post-release backup metadata remains restoreVerified=false. Keep the earlier successfully restored checkpoint. Do not treat the failed attempt as a passed restore or erase new live records.

The failed disposable container is mazao-restore-575a26ba59c540f6834135bec5019920. Its removal failed while Docker's filesystem was read-only. Repair local Docker, confirm this exact task-owned container, remove it and rerun Backup-Mazao.ps1 -VerifyRestore. Do not reset Docker's data store or remove unrelated containers/volumes without separate approval. Plaintext Windows/VPS dump paths from the failed attempt were checked absent. See docs/25-PILOT-DEPLOYMENT-2026-10-14.md for the dated checkpoint/release evidence and automatic-review rejection of the alternate restore attempt.
