# MAZAO ERP system performance and loading acceptance

**Evidence date:** 18 October 2026

**Branch:** `feat/product-finishing`, based on `134d176`

**Technical acceptance: FAIL.** The product owner accepted the listed performance exceptions and authorized production activation. The exact-main CI, verified current-data restore, completed deployment, and subsequent production compression measurements are recorded in [the production release report](45-PRODUCTION-RELEASE-2026-10-18.md). The pending release statuses below describe the earlier benchmark checkpoint.

The latency targets passed on the local reference workload. The report records fixed list limits that omit authoritative rows, incomplete broad loading and HTTP failure coverage, and remaining workload and release gates.

## Reference environment and method

| Dimension | Reference |
|---|---|
| Database | Disposable PostgreSQL 16; seeded with 5,000 products, 5,000 sales, 5,000 customer accounts, 500 staff plus the tenant owner, 501 assignments, 40,000 stock movements, 300 rooms, 1,200 reservations, 5,000 open count lines, two 512 KiB configuration PNGs, and a historical receipt containing two 512 KiB PNG snapshots. |
| API and ingress | Pinned Bun production API container, task-owned Nginx with gzip and request-ID access logging, Firefox PWA served from `127.0.0.1:55445`. No production host, database, account, proxy or browser profile was used. |
| Route workload | 30 serial plus 20 concurrent reads per route. The 20 concurrent reads use one disposable operator; they do not model separate operators or a full business workload. p99 is the largest observation for each small burst, not a population guarantee. |
| Workspace workload | 50 repeated in-app navigation samples for each of 15 implemented workspaces in Firefox at 1280×800 (750 samples total). This measures warm navigation from click to usable state, including its blocking reads and a post-commit animation frame. It does not establish a cold-start p95. |
| Instrumentation | Browser request-to-headers, body transfer, JSON parse and decoded bytes; API request ID and `Server-Timing` app, handler, database, pool wait, serialization and query count; Nginx total/upstream duration and wire bytes correlated by request ID; React layout-effect first-usable event. |

The fixture is synthetic and production-shaped by table relationships and volume; it contains no copied business records. The legacy `/configuration` exercise sends a synthetic legacy-shaped JSON body and PNGs through Nginx and Firefox. It measures transfer, decompression, parse and image decode, but does not reconstruct the historical production database query or claim to reproduce an unavailable production trace.

## Before and after measurements

The Firefox collector recorded 1,250 common API requests in each run (30 serial and 20 concurrent for each of 25 routes). Both runs had zero failed route reads. The initial route run used the prior API image; the after run used the instrumented candidate API and current source build.

| Common API request metric | Before | After | Target / result |
|---|---:|---:|---|
| Total request p50 / p95 / observed p99 | 56 / 349 / 568 ms | 53 / 299 / 663 ms | Highest route-level concurrent p95: 860 → 747 ms; **PASS**, below 1,500 ms |
| Decoded response bytes p50 / p95 / observed p99 | 31,249 / 1,399,457 / 1,655,011 | 30,824 / 1,275,321 / 1,655,011 | Measured; no universal response-size limit established |
| Compressed wire bytes p50 / p95 / observed p99 | 3,282 / 154,853 / 157,094 | 3,282 / 154,853 / 157,094 | Measured through Nginx |
| Nginx total request p50 / p95 / observed p99 | 19 / 135 / 191 ms | 19 / 143 / 204 ms | Measured; includes proxy and upstream time |
| PostgreSQL execution p50 / p95 / observed p99 | Baseline instrumentation incomplete | 17.1 / 90.3 / 149.8 ms | After measurement only; do not infer before/after database improvement |
| Pool acquisition wait p50 / p95 / observed p99 | Baseline instrumentation incomplete | 0 / 0.1 / 0.1 ms | No material pool wait in this workload |

The maximum concurrent route p95 after changes was catalog at 747 ms (1,655,011 decoded bytes, 157,094 wire bytes, 173.3 ms database time, 0.1 ms pool wait). The current open stock count returned all 5,000 lines at 604 ms p95 and 1,275,321 decoded bytes. Movement history was 539 ms p95 and 155.4 ms database time; query planning shows the latest-250 query scans and windows over the 40,000-row fixture before its limit. These results meet the latency threshold at the measured volume but expose large and silently shortened list responses.

All 15 warm workspace navigation p95 values passed the 3,000 ms target. The slowest was Count Stock at 537 ms; next was Stock at 391 ms. There were zero non-ready outcomes in the 750 samples. Before/after worst workspace p95 was 482/537 ms. This does not prove a cold first-usable p95: the PWA reliability run measured one cold path per browser/viewport, with recorded cold-start timings from 6.374 to 11.320 seconds that include login, while the workspace percentile run measures in-app navigation after sign-in.

The corrected after instrumentation is linked in [firefox-performance.json](performance/evidence/after-2026-10-18/firefox-performance.json), including per-route p50/p95/p99, bytes and timing summaries. Nginx matched 1,500/1,500 request IDs. The baseline image did not report valid aggregate database metrics for most handlers; its zero database samples are instrumentation gaps, not zero-cost queries. The database comparison above is therefore intentionally not claimed.

## Bottlenecks and source changes

### Findings supported by the measurements

- The legacy inline configuration replay transferred 683,876 decoded JSON bytes and 463,130 gzip wire bytes. Firefox parsed it and decoded the two synthetic PNGs (320×200 and 120×120). The current configuration endpoint returned 2,156 decoded bytes at 127 ms concurrent p95; its database time was 27.5 ms p95. Current image assets are separate authenticated, no-store PNG reads. This shows the payload reduction; it does not identify the historical production query plan.
- The session projection in [app.ts](../apps/api/src/app.ts) selects only `business_profile->'taxPolicy'`; it does not retrieve the complete business profile.
- The old historical receipt returned 1,399,457 decoded bytes at 490 ms concurrent p95. Candidate receipt JSON returned 1,469 bytes at 157 ms p95. PNG snapshots load through separate outlet-scoped reads. PostgreSQL integration checks compare the immutable receipt snapshot, order lines/totals, payment, journal entries and inventory balance before and after receipt reads, and compare exact asset bytes.
- `EXPLAIN (ANALYZE, BUFFERS)` covered 14 selected queries. The slowest was movement history at 87.603 ms on the 40,000-row fixture, followed by operational analytics at 43.915 ms. Catalog, count lines and sales history each process their corresponding fixture records. The tested customer, shift-report and receipt reads used available indexes. No index or cache change was made without plan evidence.
- After-run concurrent route examples: configuration 127 ms p95; auth/me 104 ms; sales history 299 ms; staff 138 ms; assignments 176 ms; customers 156 ms; reservations 130 ms; operational analytics 355 ms. All had zero read errors.

### Source changes under evaluation

- Added request-scoped browser, API, PostgreSQL/pool and Nginx timing collection with request-ID correlation. A checked-out pool client retains its request metrics context through asynchronous query callbacks.
- Removed embedded image payloads from historical receipt JSON and added separate authenticated receipt image reads while retaining immutable sale snapshots.
- Customer directory and statement reads now load independently; refresh can retain the prior ready view; stale statement responses cannot replace a newer selection.
- Workspace navigation cancels obsolete pending GETs. The performance collector records workspace usability after the React layout commit and required reads.
- Added a production-shaped fixture, route/workspace collectors, response assertions, query-plan capture, browser reliability checks, service-worker upgrade checks and Nginx measurement configuration.

The prior configuration UI already used separate configuration, staff and assignment reads; the source changes here preserve that independence. This report does not claim every route has had every status/error mode injected.

## Data completeness blocker

The measured fixture demonstrates response limits without pagination or another continuation mechanism. These handlers return only the first fixed number of rows:

| Data | Current cap | Fixture total | Consequence |
|---|---:|---:|---|
| Customer directory | 500 | 5,000 | 4,500 accounts are absent from the directory response. |
| Sales history | 250 | 5,000 | 4,750 orders are absent from the history response. |
| Stock movement history | 250 | 40,000 | Older movement rows are absent from the history response. |
| Staff and workspace assignments | 500 each | 501 each | At least one fixture row is absent from each response. |
| Confirmed reservations | 250 | 1,200 | Older confirmed reservations are absent from the response. |

Other capped histories include stock-count history (50), shift close reports (50), shift cash movements (100), catalog import history (50) and staff sessions (100). These caps are not accompanied by a complete continuation flow in the reviewed screens. Database records remain unchanged, but operators cannot reach all authoritative history through these responses. The latency gate therefore does **not** satisfy the full objective. Add bounded pagination with stable ordering and visible continuation, or otherwise provide a tested complete-data path, before release acceptance.

## Browser, offline, regression and integrity results

| Check | Result |
|---|---|
| Workspace performance matrix | 750/750 warm navigation samples ready; all 15 workspace p95 values below 3 seconds. Firefox desktop only for this percentile matrix. |
| Route performance matrix | 1,250 common API samples per run; 30 serial and 20 concurrent per route; zero failed reads; highest after route p95 747 ms. |
| Request-ID correlation | 1,500/1,500 candidate requests matched to Nginx access records. |
| PWA cold/warm/offline/reconnect | Firefox and Chromium, desktop 1280×800 and mobile 390×844: four browser/viewport combinations passed cold launch, warm refresh, offline actionable error, offline refresh, reconnection and IndexedDB recovery sentinel preservation. Cold path was one sample per combination, not a p95 acceptance run. |
| Service-worker upgrade | Firefox and Chromium both activated the update and preserved the IndexedDB sentinel; the generated worker file was restored byte-for-byte after the isolated probe. |
| Current configuration PNGs | Status 200 and Firefox decode succeeded. The performance fixture PNGs are valid but encode at 1×1 dimensions; the separate legacy replay used 320×200 and 120×120 images. |
| Typecheck and build | Passed. The main JS bundle is 522.20 kB minified / 140.58 kB gzip; the existing chunk-size and native config-loader warnings remain. |
| End-to-end suite | 52/52 passed. |
| API suite | 95/95 passed against task-owned disposable PostgreSQL. |
| PostgreSQL-backed browser integration | 17/17 passed against freshly migrated disposable PostgreSQL. Receipt financial and inventory invariants were checked. |
| Fresh migrations | Migrations 001–017 applied to a fresh disposable test database; rerun checksums matched. |
| Production API container smoke | Candidate `Dockerfile.api` image was built and tested locally with read-only root. Readiness passed; the eighth invalid login returned 400 and the ninth returned 429 with `Retry-After: 60`. This was not a live server test. |
| Financial command recovery | Existing command IDs and IndexedDB recovery sentinel were preserved across refresh/offline/reconnect tests. No financial mutation was automatically retried with a new command ID. |
| Diff check | `git diff --check` passed before the documentation reconciliation. |

Artifacts: [before evidence](performance/evidence/before-2026-10-18/), [after evidence and screenshots](performance/evidence/after-2026-10-18/), [browser reliability JSON and screenshots](performance/evidence/after-2026-10-18/browser-reliability/), [14 query plans](performance/evidence/after-2026-10-18/query-plans.json), [latency assertion](performance/evidence/after-2026-10-18/performance-assertion.json). The latency assertion is not full release acceptance.

## Explicit acceptance decision

| Acceptance item | Result |
|---|---|
| Common API route p95 ≤1.5 seconds on reference fixture | **PASS** for measured routes and the 20-read same-operator burst. |
| Warm workspace navigation p95 ≤3 seconds | **PASS** for 15 workspaces, 50 Firefox samples each. |
| Zero errors in measured route/workspace samples | **PASS** in these runs. |
| No truncated authoritative history | **FAIL**; fixed caps above have no complete continuation flow. |
| All-workspace cold-start p95 ≤3 seconds | **NOT MEASURED**; only individual cold paths were recorded. |
| Full state/error injection across every implemented screen, including 401/403/429/500, malformed JSON and interrupted bodies | **NOT COMPLETE**. |
| Concurrent distinct operators and representative workload bursts | **NOT RUN**; route burst used one synthetic operator. |
| Exact-main GitHub CI artifact and full CI | **NOT RUN** for this uncommitted feature-branch tree. |
| Restore coverage for current production records | **OPEN**. The latest local metadata with `restoreVerified: true` is from 16 October and records 17 orders / 52 journals; read-only live totals on 18 October were 29 orders / 89 journals, balanced. That older restore does not cover the current production data. |
| Live deployment and post-deployment acceptance | **NOT RUN**. |

**Technical acceptance: FAIL.** The latency-only result passes on the documented disposable fixture, but pagination/data completeness and other coverage remain open. The product owner accepted these performance gaps for release preparation, as recorded below. Deployment still requires the exact-main CI artifact and a verified restore covering current production data. No live deployment was performed.

## Live release preflight and owner disposition

On 18 October 2026, read-only checks found production running main release `872514217272c154236fcab02bfda11417dd5dff`, with a healthy API and PostgreSQL container, 16 applied migrations, one tenant, 29 orders, 89 journal entries and zero unbalanced journal entries. The current static release points to the same SHA. No production files, containers or database rows were changed.

The product owner reviewed this report and stated that the performance result was “good enough” to proceed. This records an owner acceptance of the known performance gaps for release preparation; it does not change the technical acceptance verdict or waive the exact-main CI artifact and a verified restore covering current production data. The local Docker Desktop service was stopped and could not be started with the current Windows permissions, so a current-data restore checkpoint could not be produced during this deployment attempt.
