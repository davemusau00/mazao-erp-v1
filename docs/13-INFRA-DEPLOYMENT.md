# Production infrastructure and deploy model

## Environments
Local developer Docker; isolated CI ephemeral PostgreSQL; staging separate DNS/database/keys; production separate credentials, backups and deployment permissions. Do not let staging migrations or OAuth callbacks target production. Illustrative DNS: `app.mazao.example`, `api.mazao.example` until the brand controls a real domain. Avoid claiming a domain is registered.

## Initial topology
Nginx HTTPS ingress → static hashed PWA assets + Fastify API on internal listener → private PostgreSQL; private worker consumes transactional outbox. Container network private, database not exposed publicly. Start single-node VPS with external offsite backup; introduce managed DB and more API nodes as traffic and RTO require. Port assignments parameterized to avoid conflicts with co-hosted services.

## Containers
API and worker from same immutable source digest; DB pinned supported major/minor after compatibility tests; health/readiness endpoints; nonroot users; readonly root FS where possible; resource caps; restart policies; no `latest` tag. Postgres volume separate from application release. Deployment examples under `infra/` are templates, not verified production manifests.

## CI/CD stages
1. Format/type/lint/contracts. 2. unit/domain/property tests. 3. migration fresh + upgrade. 4. API integration. 5. offline failure tests. 6. browser desktop/tablet/mobile. 7. a11y + visual regression. 8. supply-chain/secret checks. 9. build signed/pinned images and static PWA release. 10. deploy staging + smoke. 11. human approval prod. 12. online readiness, exact release evidence and canary. 13. rollback runbook. No deployments from local uncommitted files.

## Database upgrades
Backup + verified restore checkpoint. Expand schema first, deploy backward-compatible API, then PWA, migrate data in controlled job, contract schema only after compatibility window. Never downgrade database blindly via reverse SQL. Roll back binary to compatible previous API when safe; if schema requires restoring backup, perform explicit full data-loss/reconciliation review.

## Resource guidance
First hardware sizing requires load testing; do not assert fixed capacity. Start modest (e.g., 2–4 vCPU, 4–8GiB RAM) and verify against real customer mix. PostgreSQL RAM/IOPS, connection pool and backup footprint dominate decisions. PWA uses CDN/static caching. Keep database storage encrypted and monitored; no public admin port.
