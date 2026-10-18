# Mazao production release evidence - 18 October 2026

## Release decision and scope

**Deployment: activated. Public asset integrity and signed-out browser function: PASS. Production cold loading: slow. Technical performance acceptance: FAIL, with the documented exceptions accepted by the product owner.**

The owner reviewed the [performance acceptance report](44-PERFORMANCE-ACCEPTANCE-2026-10-18.md) and authorized production activation. The report's measured latency improvements and remaining gaps remain applicable: authoritative list continuation, complete cold-start percentiles, all-screen error coverage and concurrent distinct-operator coverage are not complete. This release does not establish that all loading or performance problems are fixed.

This dated release evidence supersedes the earlier pending CI, restore and deployment status in that report. The technical performance verdict remains unchanged.

| Release property | Evidence |
|---|---|
| Canonical production origin | https://mazao.davemusau.co.ke |
| Activated API and PWA source | `a3d5e563c737703a9b1f5df4b50bb33c5457b362` |
| Previous API and PWA source | `872514217272c154236fcab02bfda11417dd5dff` |
| Pull request | [PR #18](https://github.com/davemusau00/mazao-erp-v1/pull/18), merged after passing feature CI |
| Feature CI | [Run 39124648780](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39124648780): passed |
| Exact-main release CI | [Run 39124896364](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39124896364): all jobs passed |
| Activation scope | Existing isolated Mazao API and static PWA release; migration 017 |
| Active static compression configuration source | `d9e71bc403d1b9c054e752769c18793227f822d7`; application/API/PWA release remains `a3d5e563c737703a9b1f5df4b50bb33c5457b362` |

## Artifact integrity

Artifacts came from the successful exact-main release run. The API artifact ZIP and packaged PWA transfer archive matched their expected hashes on the production host before activation.

| Artifact | Bytes | SHA256 |
|---|---:|---|
| API image artifact ZIP | 136,094,097 | `8c36b79ae39b4e49fab240f9a57e15da307203ac166c429a9a8defe49bd2eb5b` |
| GitHub PWA artifact ZIP | 185,446 | `adbfb8415b323929fad404e05fa0753ef896029642392518eb40635c120a2d77` |
| Packaged PWA transfer archive | 183,183 | `c1c0615b584591dc50b87377e9bda917f9525a649a9f96c472e7a431eb70ee7e` |

The first activation invocation stopped at the script's CRLF-terminated `set -euo` line before changing production state. The reviewed activation script was normalized to LF. Its SHA256, `e7f013f9825ee749c375e061377cc16e4c9d63b5a714c3ad62f65b326ac544df`, matched on the host before the successful invocation. This was a script line-ending correction; no database downgrade or data reset was performed.

## Verified recovery checkpoint

A fresh off-host Windows DPAPI backup was decrypted and restored into an isolated PostgreSQL 16 container with networking disabled before activation.

| Checkpoint property | Evidence |
|---|---|
| Encrypted checkpoint | `20261018T144351-e2322c3a3b3a41aca787a48c11e3bf9b.dump.dpapi` |
| SHA256 | `aca7164dd52834ba0b37a81b6f0b979cb631b67fdb1e95f2de4ef99773153d20` |
| Restore result | Passed |
| Restored applied migrations | 16 |
| Restored tenants | 1 |
| Restored orders | 29 |
| Restored journal entries | 89 |
| Unbalanced journal entries | 0 |

This checkpoint covers the production control totals captured before activation. DPAPI recovery remains tied to the backup Windows account and its recovery material, as described in the [backup runbook](../infra/BACKUP-RUNBOOK.md); this evidence does not establish portable encryption recovery or a continuous backup guarantee.

Cleanup checks confirmed that the temporary plaintext dump was absent from both the Windows scratch location and the remote host. The uniquely named disposable restore container was also absent after verification.

## Activation and data preservation

The [activation helper](../infra/activate-release.sh) loaded the verified API image, applied `017_configuration_assets`, reran migrations and confirmed all 17 applied migration checksums. The API image and current static release point to `a3d5e563c737703a9b1f5df4b50bb33c5457b362`. API container health and HTTPS readiness passed; readiness returned HTTP 200.

Migration 017 creates the configuration image asset table and its indexes. It does not rewrite existing tenant profiles, orders or receipt snapshots. The new `core.configuration_assets` table contained zero rows after activation.

Whole-row fingerprints captured for 29 existing tables across the core, catalog, commerce, finance, hospitality and inventory schemas matched after activation. These checks include stored receipt snapshots, stock balances and movements, orders, payments and journal records. Post-release controls found 17 migrations, one tenant, 29 orders, 19 payments, 89 journal entries, zero unbalanced journal entries and zero configuration assets.

Machine-readable evidence: [before activation](performance/production-2026-10-18/data-integrity-before.txt) and [after activation](performance/production-2026-10-18/data-integrity-after.txt).

## Protected services

All 20 retained containers, comprising the Mazao PostgreSQL container and 19 unrelated containers, retained their recorded images, published ports and health state. Nginx configuration validation passed. Protected public roots retained their expected responses after application activation and the compression reload: detailskilonzo.com 200, serveos.davemusau.co.ke 200, serveosapi.davemusau.co.ke 404, sms.detailskilonzo.com 307 and africa.detailskilonzo.com 307. The historical API-root 404 does not establish internal service readiness. No unrelated application project or database was changed by this activation.

## Post-deployment acceptance

| Check | Result |
|---|---|
| Exact-main CI and release artifacts | **PASS** |
| Current-data off-host isolated restore | **PASS** |
| API image and static release SHA | **PASS** |
| Migration application and checksum rerun | **PASS**, 17 migrations |
| API container health and HTTPS readiness | **PASS**, readiness HTTP 200 |
| Existing table whole-row fingerprints and journal balance | **PASS** |
| Retained container comparison and Nginx validation | **PASS** |
| Public HTML and referenced JavaScript/CSS integrity | **PASS**, HTTP 200 and exact asset hashes matched CI |
| Service worker and manifest | **PASS**, HTTP 200 with `no-cache` |
| Configuration without authentication | **PASS**, HTTP 401 |
| Production signed-out browser function before compression | **PASS**, 4/4 browser/viewport cases |
| Production cold loading | **SLOW**, after samples of 9.559-24.315 seconds, down from 38.577-65.643 seconds; no percentile claim |
| Static JavaScript compression and decoded integrity | **PASS**, gzip with `Vary: Accept-Encoding`; decoded hash matches CI |
| Production browser probes after compression | **PASS**, 4/4 signed-out browser/viewport cases; CSS and JS use gzip with exact decoded CI hashes |
| Full system performance acceptance | **FAIL**, owner accepted documented exceptions |

Public HTML and its JavaScript/CSS references returned HTTP 200. The delivered assets matched the exact-main CI build:

| Asset | Decoded bytes | Wire bytes with active gzip | Decoded SHA256 |
|---|---:|---:|---|
| CSS | 109,956 | 21,123 | `e251b55c06acb2d081673b785853db8cc337ce12f9183fa9f7a8a133c0568c3f` |
| JavaScript | 522,206 | 141,468 | `032b3d61a699a44c826e50988f2415e071a28ec08c2c1086643c97223e8e7253` |

Before compression activation, Chromium and Firefox passed signed-out functional probes at desktop 1280 x 800 and mobile 390 x 844. All four cases rendered the sign-in screen with a 48 px primary button, no page errors, no server HTTP 500 responses and no horizontal overflow. [Browser results](performance/production-2026-10-18/browser-smoke.json) and [four screenshots](performance/production-2026-10-18/) record this coverage. No authenticated live business journey was run; authenticated browser-to-API-to-PostgreSQL coverage belongs to the disposable CI environment.

### Observed production cold-loading delay

The signed-out functional passes do not pass production performance acceptance. Individual cold-start observations before and after compression were:

| Browser | Viewport | First usable before | First usable after |
|---|---|---:|---:|
| Chromium | Desktop, 1280 x 800 | 65.643 s | 12.534 s |
| Chromium | Mobile, 390 x 844 | 50.776 s | 24.315 s |
| Firefox | Desktop, 1280 x 800 | 38.577 s | 12.185 s |
| Firefox | Mobile, 390 x 844 | 57.004 s | 9.559 s |

These are individual observations, not p50/p95/p99 estimates or measurements of authenticated workspaces. Every after sample remains above three seconds. Network conditions varied, so the entire observed time reduction cannot be attributed to compression.

The [after-compression browser results](performance/production-2026-10-18/after-static-compression/browser-smoke.json) and [four screenshots](performance/production-2026-10-18/after-static-compression/) record **4/4 signed-out functional passes** for the same browsers and viewports. Every case received gzip CSS and JavaScript with `Vary: Accept-Encoding` and decoded hashes matching CI; there were zero page errors, server HTTP 500 responses or horizontal overflow, and the sign-in button remained 48 px high. Resource timings recorded `/api/v1/auth/me` taking 0.391-1.175 seconds after the assets loaded. These probes do not establish authenticated workspace latency or complete performance acceptance.

A focused `curl --compressed` probe of the public JavaScript recorded 1.538846 s to response headers and 23.410607 s total for 522,206 bytes, with no `Content-Encoding` response header. The same HTTPS asset served through the host loopback took 0.046716 s to headers and 0.049390 s total for 522,206 bytes. A loopback `/api/v1/auth/me` request returned its expected unauthenticated HTTP 401 in 0.093669 s.

The public asset transferred without compression in that initial probe. The public-versus-loopback difference identifies substantial time outside local static serving in these probes; it does not by itself establish the precise network cause. The scoped static-asset gzip change was subsequently activated with the evidence below.

### Compression follow-up CI

The gzip infrastructure change in PR #19 reached main commit `6803dfb88ced09a7e01bb372fe6554ec97f94e9f`, but [main CI run 39127386622](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39127386622) failed on an ambiguous `getByRole('status')` locator at `e2e/integration/count-recovery-readiness.spec.ts:76`. Both the global checking banner and the count confirmation matched that locator.

The follow-up corrected three assertions to select the expected text and require visibility. It retained the recovery checks for the original command, exactly one inventory movement, exactly one audit record and the database inventory value. A fresh disposable PostgreSQL 16 database with migrations 001-017 and a PWA build passed three repetitions of the targeted case: **3/3 in 23 seconds**.

[PR #20](https://github.com/davemusau00/mazao-erp-v1/pull/20), head `46dff86a5ff9393e376417630acffe7ddf030d41`, passed [full feature CI run 39127791053](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39127791053) and merged as main `d9e71bc403d1b9c054e752769c18793227f822d7`. Its [exact-main CI run 39128037838](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39128037838) **PASSED** before the compression change was activated. The application frontend and API source have no diff from the activated `a3d5e563c737703a9b1f5df4b50bb33c5457b362` release. The application image and PWA release remain at that SHA.

### Active static compression and transfer measurements

Only the Mazao `mazao-pilot` vhost was changed, by adding the five reviewed gzip directives within `/assets/`. The active configuration source is recorded as `d9e71bc403d1b9c054e752769c18793227f822d7` in `/srv/mazao/nginx-static-assets-revision`. The vhost file SHA256 changed from `076c28a4ef1748c8a1dcbed18e304d2d72bbb55e696a7d4c889804b0138603bf` to `021429513ee5c405e29e6f31aca73333dfbecf1fe2d3258fde7264a3c8cf4ca0`. All seven protected Nginx configuration hashes remained identical; [the comparison](performance/production-2026-10-18/nginx-config-comparison.json) records those checks and the protected public-root responses. Nginx validation and API readiness passed.

The first probe immediately after graceful reload still received the 522,206-byte uncompressed JavaScript. The automated rollback restored the previous vhost. A retry with bounded one-second polling passed with gzip and the unchanged decoded asset hash. This behavior is consistent with a reload handoff; the precise cause of the first response was not established. The final active vhost is the compression-enabled version above.

Focused JavaScript transfer measurements are recorded in [transfer-comparison.json](performance/production-2026-10-18/transfer-comparison.json):

| Path and state | Headers | Total | Wire bytes | Decoded bytes | Content encoding |
|---|---:|---:|---:|---:|---|
| Public, before compression | 1.538846 s | 23.410607 s | 522,206 | 522,206 | None |
| Public, after compression | 8.342276 s | 21.290392 s | 141,468 | 522,206 | gzip |
| HTTPS host loopback, before compression | 0.046716 s | 0.049390 s | 522,206 | 522,206 | None |
| HTTPS host loopback, after compression | 0.084893 s | 0.104956 s | 141,468 | 522,206 | gzip |

The gzip response has `Vary: Accept-Encoding`, and its decoded SHA256 remains `032b3d61a699a44c826e50988f2415e071a28ec08c2c1086643c97223e8e7253`, matching CI. Compression reduced JavaScript transfer bytes by approximately **73%**. Timing varied substantially, and the public transfer still took 21.290392 seconds in the focused after sample. This byte reduction is not a 73% time improvement and does not establish the three-second workspace target. The separate after-compression browser observations above likewise remain slow despite passing functional checks.

## Rollback compatibility

The previous Mazao API/static release and its restricted environment snapshot remain the rollback references. No application release rollback or reverse migration was executed; the transient Nginx vhost rollback during compression activation is recorded above. Preserve the PostgreSQL volume and applied migrations when restoring a compatible application release; follow the [deployment runbook](13-INFRA-DEPLOYMENT.md).

Migration 017 is additive and permits the previous API to run against the schema immediately after activation. Compatibility narrows after users replace configuration images or create receipts using new image assets: the new application can store images in `core.configuration_assets` and place authenticated asset URLs in new receipt snapshots, while the previous API does not implement those asset routes. A later rollback to `872514217272c154236fcab02bfda11417dd5dff` therefore requires an explicit compatibility review of intervening image edits and receipt records. Do not reverse the migration or rewrite historical snapshots to make an older application appear compatible.
