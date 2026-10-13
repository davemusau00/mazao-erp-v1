# SRE, backups and service operation

## Telemetry
Structured logs with request ID, tenant surrogate ID, actor/device non-sensitive identifiers, command ID, outcome, latency, exception family and deployment SHA. Never log authentication tokens, guest ID documents, payment credentials or raw CSV. Metrics: API p50/p95/p99, error classes, DB connections/locks, worker backlog, outbox age, sync cursor lag, offline pending and conflict counts, successful print spools vs uncertain sends, backup age, restore age, disk/memory, business transaction reconciliation failures. Trace commands end-to-end across API/worker.

## Reliability targets (proposed)
99.9% monthly server availability after beta; API success p95 under 300ms excluding provider round trips and large report queries; cashier visual tap p95 under 100ms on accepted device; zero unexplained duplicate confirmed payment; zero journal imbalance; zero stock negative beyond policy; nightly offsite backups plus PITR if selected; RPO goal 15 minutes / RTO goal 4 hours subject to funded architecture and rehearsed acceptance. Record the exact achieved figures before sales claims.

## Alerts
Page on no recent verified backup, restore check failed, critical API error rate, DB nearing disk limit, corrupt migrations, unbalanced journal, unhandled worker dead-letter, multiple tenants affected. Business exception alerts stay in tenant manager inbox rather than paging developers by default.

## Backups
Automated encrypted PostgreSQL backups + optional WAL/PITR, off-host object store with immutable/retention protections, secrets separate from dumps; restore to isolated instance and compare control totals monthly; quarterly full service failover drill. Export tenant business data through permissioned APIs without exposing other tenants. Never put only backup beside production DB on same VPS.

## Incident process
Incident commander, severity tiers, audit evidence, customer communication, containment, timeline, restore test, reconciliation, postmortem. Dedicated runbooks: outage, compromised user/device, stuck sync, payment unknown, print uncertain, stock corruption, room double allocation, expired TLS, disk exhaustion and credential rotation.
