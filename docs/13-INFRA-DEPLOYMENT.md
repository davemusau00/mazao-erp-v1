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

# deployment server
 at 93.127.130.9 can potentially host MAZAO ERP SaaS alongside KKA, particularly for an initial production launch with a modest number of customers.
The important distinction is between hosting MAZAO as a small SaaS application and operating a growing, multi-tenant ERP platform with many businesses, simultaneous users, background jobs, and large databases.
1. Current server capacity
KKA + MAZAO shared VPS
Pilot feasible

Processing
3 vCPUs
Shared between both ERPs
Available RAM
3.9 GiB
After KKA repair
Available storage
67 GB
Database, uploads, logs, builds
Existing stack
KKA ERP
Six running containers


I'd treat this as a shared production host suitable for a controlled MAZAO launch, not yet as a high-capacity commercial SaaS host. The next question is how much infrastructure MAZAO itself requires.
2. I checked the current MAZAO repository
I inspected davemusau00/mazao-erp-v1, including its application dependencies, backend architecture, integration register, and implementation gaps.
The current stack is relatively suitable for your VPS.
MAZAO component	Technology	Hosting requirement
Frontend / PWA	React 19, Vite	Static web hosting
Backend	Fastify 5, Node.js	API container
Database	PostgreSQL	Dedicated database
Authentication	Server sessions, cookies, CSRF	API + PostgreSQL
Background jobs	Not yet a full worker infrastructure	Add when needed
Reverse proxy / TLS	Production configuration needed	Existing Caddy
The backend is a modular monolith, which is a good fit for deployment on a modest VPS. There's no need to introduce Kubernetes or a large microservices infrastructure.
Sources: MAZAO dependencies · Backend integration
3. Estimated MAZAO resource requirements
These are initial resource-planning allowances, not measured MAZAO benchmarks.
Component	RAM allowance
Fastify API	300–600 MiB
PostgreSQL	250–600 MiB
Static frontend server	30–100 MiB
Background processing, when added	100–300 MiB
Operational headroom	300–500 MiB
A reasonable starting budget is approximately 1–2 GiB of additional RAM, subject to testing.
With 3.9 GiB currently available, you have a plausible path to hosting both platforms while retaining spare capacity. However, simultaneous reporting, stock imports, database queries, and backups may produce considerably higher load than the idle measurements suggest.
4. Recommended shared-server architecture
Internet / HTTPS

Existing Caddy reverse proxy
Routes traffic by domain

KKA ERP

Existing stack

KKA Web + API
KKA Worker
KKA PostgreSQL
KKA Redis


MAZAO SaaS

Independent stack

MAZAO PWA


mazao.davemusau.co.ke

MAZAO Fastify API 

mazaoapi.davemusau.co.ke

MAZAO PostgreSQL
Dedicated volumes



One VPS, two isolated application stacks, with a shared HTTPS entry point. Both still share the underlying physical resources.
I'd deploy MAZAO into /srv/mazao, with its own Compose project, database credentials, Docker network, environment configuration, backups and resource limits.
The existing Caddy proxy can route a separate MAZAO domain to its frontend and API, using a deliberately configured shared proxy network. MAZAO's PostgreSQL port should remain private.
5. Important: MAZAO isn't yet a fully production-ready SaaS
The current repository contains real, server-backed commerce, stock, shift, customer credit and initial hospitality functionality.
However, its own implementation review identifies unfinished production capabilities, including server-side tenant onboarding, restaurant workflows, advanced inventory, complete accounting, real offline synchronization and browser acceptance testing.
Sources: Current README · Implementation review
The server is therefore closer to being ready to host MAZAO than MAZAO is to being ready for unrestricted commercial deployment.
My recommended sequence is to finalize production packaging and migrations, test tenant isolation, verify critical transactions, establish off-server backups and restore procedures, then perform concurrent-user load testing while KKA is running.
