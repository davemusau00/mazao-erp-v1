# Backup and restore runbook
1. Confirm target DB, environment and encryption destination; block accidental production-to-staging reverse restore.
2. Take transaction-consistent dump/base backup plus configured WAL archive; record SHA256, schema migration head, timestamp and object storage version.
3. Encrypt with separately controlled keys and upload to offsite bucket with lifecycle retention/immutability.
4. Once a month, restore into isolated PostgreSQL container using separate credentials; apply no production side effects, disable workers/webhooks/provider calls.
5. Run integrity queries: tenant totals, order/tender/journal count, balanced journal, stock movement recon, all migration checksums.
6. Time recovery and update RPO/RTO evidence. Never claim restore works based only on presence of a `.sql` file.
7. In an actual incident fence writes, determine authoritative recovery point, communicate potential unacknowledged local offline commands, restore, reconcile by original command IDs, unlock deliberately, document audit.
