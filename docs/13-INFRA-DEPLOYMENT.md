# Infrastructure and deployment

## Verified shared host

Read-only inventory was performed on 14 October 2026 before installing Mazao.

| Property | Observed |
| --- | --- |
| VPS | **93.127.131.55**, Ubuntu 24.04.5 LTS |
| Capacity | 4 vCPUs, 7.8 GiB RAM, 2 GiB swap, 142 GiB root volume |
| Point-in-time availability | 5.8 GiB memory available and 111 GiB disk available |
| Ingress | Nginx active on ports 80 and 443; Caddy inactive |
| Database and app runtime | Docker active; existing PostgreSQL and application containers are host-local/private |
| Mazao DNS | **mazao.davemusau.co.ke** and **mazaoapi.davemusau.co.ke** resolved to this VPS |
| Mazao baseline | No Mazao host directories, containers, volumes, networks, Nginx vhosts, or TLS certificates were present |

This is a single resource snapshot, not a capacity guarantee or load test. Recheck available memory, disk, and load before each release.

The existing host contains independent ServOS projects (serveos-prod, serveos-next, serveos-replacement, serveos-stage-pos2, plus standalone POS2 containers) and SMS projects (sms-platform, sms-platform-africa). Nginx currently routes the existing SMS, business site, and ServOS names. Treat all existing containers, volumes, networks, Nginx files, and data as protected.

Ports 80, 443, and 22 are in use. Host loopback ports 3000, 3001, 3101–3104, 3202, and 3203 are also in use. PostgreSQL containers publish no host listener on 5432. Mazao uses only 127.0.0.1:4101 for its API, with PostgreSQL private to its own Docker network.

## Mazao topology

The canonical application origin is https://mazao.davemusau.co.ke. The PWA calls relative /api/v1 URLs, so Nginx serves the static PWA and proxies that path to the API at 127.0.0.1:4101. This keeps browser requests same-origin and matches the API's current origin checks. mazaoapi.davemusau.co.ke is DNS-resolved but unused in this deployment; do not add a second API vhost until the client and API explicitly support cross-origin requests.

    Browser
      └─ HTTPS Nginx: mazao.davemusau.co.ke
           ├─ / and static files → /var/www/mazao/current
           └─ /api/v1/* → 127.0.0.1:4101
                                └─ Mazao API container
                                     └─ private mazao Docker network
                                          └─ PostgreSQL 16 container

Use Compose project mazao, files under /srv/mazao, a dedicated mazao-private network, and persistent volume mazao-postgres-data. Do not publish the database port. The API binds to 0.0.0.0:4101 inside its container and only to host loopback outside it. The Compose example applies initial memory and CPU caps; revisit them after representative load measurements.

PostgreSQL 16 is used to match CI. The example pins the current postgres:16.15-alpine multi-platform manifest digest. The API image uses the pinned Bun 1.4.3 base digest and is tagged in GHCR with the full source commit SHA. The worker image in the old example was only a placeholder; no worker implementation exists, so the pilot does not run a worker or claim that outbox events are delivered to external systems.

## Release packaging and activation

The CI workflow runs migration fresh-and-rerun checks, TypeScript checks, API acceptance, and browser acceptance. On a successful push to main, it uploads the PWA directory and publishes the API image as ghcr.io/davemusau00/mazao-erp-v1/api:<full-commit-sha>; it also uploads the exact image archive for deployment without registry credentials on the VPS. Do not deploy a local uncommitted tree.

For each release:

1. Record the full source SHA and download that run's PWA and API image artifacts.
2. Keep environment values in /srv/mazao/.env with owner-only read/write permissions. Set APP_ORIGINS=https://mazao.davemusau.co.ke, API_HOST=0.0.0.0, and API_PORT=4101; generate a random database password. Never commit populated environment files or bootstrap credentials.
3. Load the API image archive, install the Compose file, and run the matching release image's migration runner. The migration runner verifies applied checksums and never edits applied migration files.
4. Extract PWA assets into /var/www/mazao/releases/<full-commit-sha>. Switch /var/www/mazao/current atomically only after API readiness succeeds.
5. Install only the Mazao Nginx site. Obtain a certificate for mazao.davemusau.co.ke using the existing Certbot installation and verified DNS, run nginx -t, then perform a graceful reload. Do not add an API subdomain vhost.
6. Verify the PWA and same-origin live/readiness endpoints over HTTPS. Check existing Nginx routes and containers before and after activation.

The local SSH alias mazao-live points to administrator@93.127.131.55 using the existing id_ed25519 key with strict host checking. No new key needs to be installed on this server.

Keep the prior PWA symlink target and a dated copy of the Mazao Nginx file for rollback. Roll back only Mazao's API image, static symlink, and vhost. Never stop or recreate another Compose project, remove an existing volume, or reverse a database migration. Do not open the pilot for business data until its off-host backup and restore procedure has been verified.

## Data and operational boundaries

The initial administrator and tenant are created only through apps/api/scripts/bootstrap.ts with actual owner-provided business details and a locally entered password. Do not seed preview/demo tenants or paid orders. Authenticated server mode supports only the journeys listed as server-connected in the README and backend integration register; preview-only modules must not be presented as authoritative server data.

The Windows helper infra/Bootstrap-Mazao.ps1 prompts for and confirms the administrator password. The password crosses SSH through stdin and is not written to a file or command argument. Upload infra/bootstrap-initial-tenant.sh to /srv/mazao first; it rejects an initial bootstrap if a tenant already exists. The initial pilot enables only retail, inventory and commerce. Keep user credentials and business metadata out of public release evidence.

The database is the source of truth. A transactional outbox row proves local transaction evidence only; there is no deployed outbox worker, server-side offline replay service, or external delivery guarantee. Maintain an encrypted off-host PostgreSQL backup and perform an isolated restore before recording business transactions. See the backup runbook.
