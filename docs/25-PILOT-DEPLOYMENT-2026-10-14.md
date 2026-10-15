# Mazao pilot deployment evidence — 14 October 2026

## Initial release

- Host: 93.127.131.55; canonical origin: https://mazao.davemusau.co.ke.
- Initial API and PWA source: b38496ae577264e771426360bca9d0acdf9c7f28.
- [Initial release CI](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38569102463): 10 API tests passed, no failures/skips; 3 browser tests passed; TypeScript, fresh migrations, checksum replay and production-container readiness passed.
- Published GHCR digest: sha256:a2e575de4212ce948aa9c5fb91194fd244b9727f916f3c40f90767f189b04474.
- API artifact ZIP digest matched GitHub's sha256:31a040666b1cf71d32ac7e93cf693d4129f38213fa686a2880f4bf1c3ae0db9a. Local and server image archive hashes also matched.
- Dedicated Compose project mazao, network mazao-private, PostgreSQL volume mazao-postgres-data; no database host port. API publishes only 127.0.0.1:4101.
- All 13 migrations applied on the VPS. A second run verified all applied checksums. Both containers reported healthy.
- The application TLS certificate was issued for mazao.davemusau.co.ke and expires on 12 January 2027. Its renewal uses the dedicated /var/www/mazao/acme webroot.
- HTTPS app and /api/v1/health/ready returned 200 from the host and public origin. The initial PWA rendered at 1280×720 and 390×844 without uncaught JavaScript errors.

## Protected services

All six baseline hashes for the existing Nginx main configuration and five enabled sites matched after Mazao activation. The existing domains retained their baseline responses: business site 200, ServOS PWA 200, ServOS API root 404, and the two SMS roots 307. The API root's 404 was present before Mazao deployment and is not a readiness test. Existing containers remained running with their original images and ports. No existing application's database or Compose project was used for Mazao.

## Off-host recovery

An encrypted Windows DPAPI checkpoint was downloaded from the new database, decrypted, and restored into a disposable PostgreSQL 16 container with no network. A second checkpoint after initial tenant setup also restored successfully: 13 migrations, one tenant, zero orders, zero journals and zero unbalanced journals. The temporary restore container and plaintext dump files were removed.

The Windows PC has a daily encrypted backup task at 02:15 Nairobi time and a Sunday restore verification task at 02:45. The daily task was manually triggered and returned result 0. The tasks run as the logged-in Windows account; this PC must be on and the account available. No cloud destination, continuous backup guarantee, portable encryption recovery, measured RPO/RTO or provider integrations are claimed.

## Authentication correction

The authentication-correction API and PWA release was **15aaa9b64690e28d48e32db7ca3290434a61f5a2**; the current configuration release is recorded below. [Release CI](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38573179076) passed 10 API tests, 5 browser tests, TypeScript and production-container checks. Its GHCR image digest is sha256:f5e6821a226bd96d15a05a16b73705dc07fe5fa3f569231a1e5d0dfa682db44a. The artifact digest was verified before loading on the VPS, migrations replayed with unchanged checksums, and API readiness passed after the update.

The initial frontend showed its prototype preview after an unauthenticated session response. The production build now requires server sign-in and provides no demo fallback. The shared sign-in form submits actual input values, including password-manager autofill. Tests cover rejected credentials, sign-out and the production session boundary.

The public origin was checked at 1280×720 and 390×844 after this update: sign-in was visible, Apex/demo workspaces were absent, the primary action was fully in view with a 44px minimum height, and no uncaught JavaScript errors occurred. This verifies the signed-out boundary, not a complete live transaction journey. The owner uses a local password prompt for account verification; no password is available to the deployment agent.

The initial local setup helper created the owner-supplied tenant and administrator. Its subsequent report probe failed because the request omitted the required asOf date; the helper was corrected. The live administrator has one active membership/device/outlet assignment. No duplicate tenant or demonstration transactions were created. Passwords remain in local interactive prompts and are never recorded in this evidence.

## Rollback

The initial Nginx snapshot and previous Mazao site configuration are under /srv/mazao/backups. Immutable PWA releases are under /var/www/mazao/releases. For rollback, restore only the previous Mazao static symlink, compatible API image and Mazao site, validate Nginx, and reload gracefully. Preserve the PostgreSQL volume and applied migrations; never run Compose down with volume deletion or restore an unrelated application.

## Business configuration and server-only runtime release

Activated on 14 October 2026 at 14:48 UTC (17:48 Nairobi). Current API/PWA source is **e5f93938ba1d8e6f038e803a556cdfb4ef7a6ecc**, from [PR 3](https://github.com/davemusau00/mazao-erp-v1/pull/3) and [main release CI 38583030049](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38583030049).

- CI: client/API TypeScript, all 18 API tests, 14 browser state tests and four real browser-to-API-to-PostgreSQL journeys passed. Fresh and checksum-rerun migrations and the production Bun container passed. The integrated journey configures an outlet, creates an item, receives stock, confirms a taxed cash sale/receipt and closes with zero variance. Response-loss/restart recovery and all seven requested viewports are covered separately. These transactions run only in the disposable acceptance database.
- Published API manifest digest: **sha256:28e1266a9814b7454e8bebfeb1c4a33ce51c59233232bcd43f2bbc57a75c310c**. GitHub image artifact ZIP SHA256 **b1d4aec29f9ea8f1b00a50250e930cabfa935ebd615fce5c5b48b72f083deda1** matched on the VPS. PWA transfer archive SHA256 **e39bddf291cf8c99faaf0a0c78e97f0b9806a01feb51e80f814080ae6ec5e9c1** matched. Image revision equals the full source commit.
- Migration 014_configuration applied once; all 14 checksums matched on replay. Only the Mazao API container was replaced. The existing Mazao database container and 19 unrelated containers retained their IDs/images. All eight captured Nginx configuration hashes remained unchanged. No Nginx reload or unrelated project/database change was needed.
- Current static link: `/var/www/mazao/releases/e5f93938ba1d8e6f038e803a556cdfb4ef7a6ecc`. Prior release 15aaa9b, compatible API image and Mazao environment snapshot remain available. Activation uses the checksummed helper in infra/activate-release.sh and never reverses database migrations.
- Public Chromium at 1280?720 and 390?844: app, liveness and readiness HTTP 200; sign-in primary action 48px and fully visible; zero preview records and uncaught JavaScript errors. Delivered JS SHA256 **415cda50582cda146330a716e682efa84014090168622e19372b4c36273240f7** matched the downloaded CI artifact. Service workers were allowed. An initial 30-second DOM-navigation probe timed out; a response-commit navigation with a 45-second rendered-sign-in assertion passed. This verifies the real signed-out origin and exact assets, not a live authenticated financial transaction.
- Existing roots retained the recorded responses: detailskilonzo.com 200, serveos.davemusau.co.ke 200, serveosapi.davemusau.co.ke 404, sms.detailskilonzo.com 307, africa.detailskilonzo.com 307. The API root's historical 404 is not a readiness claim.
- Read-only control totals after activation: 14 migrations, one tenant/outlet, zero products/rooms/orders/journals/imbalances. Three customer accounts appeared during live activity and remain untouched. No deployment acceptance paid orders were created in the real business.

Manage now uses authoritative PostgreSQL configuration, permissions, versions and command recovery. Every build requires server authentication; the preview flag/routes, local financial startup and simulated hardware path are excluded. Receipt/contact/tax metadata applies to future records; historical snapshots remain intact. Contracts and remaining limitations are documented in [configuration integration](28-BUSINESS-CONFIGURATION-INTEGRATION.md) and [the full v1 register](27-V1-COMPLETION-REGISTER.md).

### Backup exception and retained recovery evidence

The pre-release encrypted checkpoint `20261014T171558-5d1d2985cb314dbc85c6a376da137ae6.dump.dpapi` restored successfully (13 migrations, one tenant, zero orders/journals/imbalances). Live control totals before activation still showed no products, rooms, customers, orders or journals. A later local restore attempt failed because Docker Desktop's filesystem became read-only; pg_restore reported an fdatasync I/O failure. Automatic approval review rejected the attempted alternate VPS restore with only ?blocked by policy,? so no alternate container or restore was executed.

The subsequent encrypted post-release checkpoint `20261014T175256-8b0d646f6d93474a92b31dc5c834ed09.dump.dpapi` was created successfully; its SHA256 is **6a5787416834db71e649313691a5fa598a598e846649f8471c5e097eb395f28b** and its metadata correctly says restoreVerified=false. The earlier verified checkpoint is retained. Windows/VPS task plaintext dumps were checked absent. Cleanup of the failed local restore container could not complete while the Docker daemon was read-only; repair that local runtime and remove only `mazao-restore-575a26ba59c540f6834135bec5019920` after confirming ownership, then rerun restoration against the latest encrypted checkpoint. Do not restart or remove unrelated application containers as part of this repair.

Daily encrypted backups do not use local Docker and the post-release run succeeded. Weekly local restore verification requires Docker Desktop to be repaired. No cloud backup, continuous guarantee or latest-checkpoint restore success is claimed. This exception remains open alongside the remaining v1 work.

## Current live release: reviewed product CSV import

The CSV slice was deployed before resuming staff/device implementation. Canonical origin remains **https://mazao.davemusau.co.ke**, same-origin `/api/v1`, isolated `/srv/mazao` project on **93.127.131.55**. This supersedes e5f9393 as the current API/PWA release; preceding sections remain dated historical evidence.

- Exact main commit: **79dcf3d1b2d25ad02d5715d4eb9620216623ba61**, merged [PR #5](https://github.com/davemusau00/mazao-erp-v1/pull/5). [Main CI run 38598421665](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38598421665) passed TypeScript, fresh/rerun and populated upgrade migrations, **49 API/unit/PostgreSQL tests with zero failures/skips**, **14 browser state cases**, **8 real API/PostgreSQL browser journeys**, PWA build and Bun container checks. All seven specified viewports were included. The 1,000-row case measured **160.0 ms validation / 737.0 ms apply** on the CI runner.
- Published GHCR manifest digest: **a40064524b0dc663ab06b96d5b9c06993338c34a4c0ad929eb6760b5a0c36efa**. Exact API artifact ZIP SHA256: **f8e6fb47055bd876b2fe26e10e4aa9b82d0ab882ceb9890eefe2bf472e59b8b6**. PWA transfer archive SHA256: **bdaa7ea9675e764ceea94c1b85385a8489bcaddd91e496be456f5c97d47a7da8**. Both archives matched on the VPS; OCI revision matched the source commit.
- Static current: `/var/www/mazao/releases/79dcf3d1b2d25ad02d5715d4eb9620216623ba61`. Migration **015_product_import** applied once and all fifteen checksums matched on replay. Only `mazao-api-1` was replaced. **Twenty retained container IDs/images/ports (Mazao PostgreSQL plus nineteen unrelated containers)** and **all eight captured Nginx file hashes** were identical before/after. `nginx -t` passed; no reload was needed. Previous API/static e5f9393 and the restricted Mazao environment snapshot remain available; no reverse migrations or volume removal occurred.
- Pre/post read-only controls: **15 migrations after activation**, one tenant/outlet, **2 products, 11 rooms, 3 customer accounts, 2 orders, 7 journal entries and 0 unbalanced entries**. The business had recorded a second sale during implementation; these were real operator records, preserved. Hash comparisons of earlier receipt/line/movement/journal evidence at the captured cutoff matched. No deployment acceptance products, imports or paid orders were created in the live business.
- Live Bun **1.4.3** passed pure UTF-8 BOM/RFC CSV, exact opening value, zero-preserving barcode, configured tax-default and scientific-money rejection checks, with **zero database writes**. Authenticated CSV → stock → sale → cash-up and command recovery were tested in disposable CI PostgreSQL; public live probes did not impersonate an operator or use their password.
- Public Chromium at **1280×720 and 390×844**, service workers allowed: app/liveness/readiness **HTTP 200**, sign-in **48px** and fully visible, no retired preview records and no uncaught errors. Delivered JS SHA256 **26b8d34779190c3c72395c1bb5f6f35da950704c019130cd813cd7c1b34317d5** matched the downloaded CI artifact. An initial 45-second rendered-sign-in assertion timed out; a diagnostic navigation and full repeat passed. The exact cause of that intermittent initial-load delay was not established.
- Protected vhost roots retained responses: detailskilonzo.com **200**, serveos.davemusau.co.ke **200**, serveosapi.davemusau.co.ke **404** (historical root response), sms.detailskilonzo.com **307**, africa.detailskilonzo.com **307**. This does not assert readiness of every unrelated application's internal services.

### CSV recovery checkpoint and remaining boundaries

Fresh encrypted off-host checkpoint **20261014T192215-8d134a8e0dd24f91a81be482d70ef776.dump.dpapi**, SHA256 **42eb5c8794310a9aa19fec4a88995e1d23b7dc193ddf321d993fdf7a4accee14**, was created successfully. Its metadata correctly remains **restoreVerified=false** because local Docker restore verification is still unavailable. The earlier successfully restored checkpoint is retained; this release does not resolve the documented latest-backup restoration exception.

Stock now exposes **Import products** with server staging/mapping/row errors/export, reviewed atomic new items or SKU metadata updates, immutable new-only opening stock, history and original-command recovery. [The integration register](29-PRODUCT-CSV-IMPORT-INTEGRATION.md) documents source privacy, money/quantity precision, tax/currency snapshots, count/version conflicts and accounting lineage. XLSX, packages/variants, direct archive/edit forms and the rest of v1 remain outstanding. Staff/device work resumed after CSV activation and is not part of this deployed release.
