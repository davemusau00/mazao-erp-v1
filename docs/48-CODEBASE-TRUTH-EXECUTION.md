# CODEBASE-TRUTH implementation evidence

Execution started 20 October 2026 (Africa/Nairobi). The user requires every fix and filled gap to be documented. Each subsequent implementation must update this register and its focused evidence document before closure.

This is an execution register for [CODEBASE-TRUTH.md](../CODEBASE-TRUTH.md), not a full-v1 completion claim. The S00 local checkpoint is preserved and S01 catalog maintenance is in progress. S01–S11 retain their original acceptance gates and dependencies.

## Integration and release identity (S00-01 / G02)

- Original checkout: `fix/release-gate-reliability` at `75d7011`; clean worktree. That commit contains the user-supplied plan and `docs/sale.md`.
- Fetched canonical main: `6119ee2d2043afca38b764b5a0750dd9cf75908c`. Created `feat/codebase-truth-s00` and merged main as `df2b68b984e0f02761ced2bee195a87a05d27a7f`. No old feature branch was blindly reapplied; the already merged stock-exception implementation is present.
- Preserved [19 October deployment evidence](47-PRODUCTION-RELEASE-2026-10-19.md), including its technical performance failure and recovery/plaintext follow-up. That historical record identifies release `ce5b8ab` and migrations 001–020.
- Read GitHub main metadata during this run: main remains `6119ee2`, `protected=false`, ruleset count `0`. Latest exact-main [CI run 39417548593](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39417548593) succeeded. This is baseline evidence, not validation of the new worktree.
- Current staging/live application SHA and schema were not read. No deployment, SSH, production database access, remote PR closure or repository-governance mutation occurred. Production state remains unverified for this change.
- Merge policy: each reviewable slice must have exact-head CI, additive migration/upgrade/rerun evidence, and a documented diff/recovery boundary before merging. Governance configuration still requires the owner decision described by S00-01. No previous green SHA waives a changed candidate's checks.

Read-only PR reconciliation confirmed #13, #14, #15 and #16 are still open against main. `git cherry -v origin/main <branch>` reports every extra patch on their fetched branches as equivalent (`-`): login runtime `4c6e742` and container acceptance `e65c258`, mixed count `4319b9a`, account self-service `7cffafd`, hotel dates `69cbd21`. Their business fixes are already represented on audited main. They were preserved rather than reapplied; remote supersession/closure remains a separate repository-state action.

## Ticket and fix ledger

| Ticket / gap | Implemented behavior | Evidence / remaining boundary |
| --- | --- | --- |
| S00-01 / G02 | Reconciled local evidence and audited main on an implementation branch; preserved source and release records | Baseline verified above; governance changes, duplicate PR disposition and actual live identity remain open |
| S00-02 / G03,G28 | Strict public login/envelope parsing and incremental schema/policy/dispatch catalogue | [Public inputs and command contracts](49-PUBLIC-INPUTS-COMMAND-CONTRACTS.md); legacy per-command schema migration remains explicit |
| S00-03 / G01 | Metadata-only credential reconciliation fences a never-received original ID; delayed originals cannot change credentials after fencing | [Credential operation fencing](50-CREDENTIAL-OPERATION-FENCING.md); migration 022 and client retention rules |
| S00-04 / G04,G05 | Keyset continuation, full-data search and matching totals for movements, count/import/close history, shift cash movements and eligible exception evidence | Details and validation below; UI and combined regression verification in progress |
| S00-05 / G04 | Customer/staff/assignment/session/reservation server navigation, full-tenant customer totals and server-backed pickers | [Directory continuation](54-DIRECTORY-CONTINUATION.md) and [staff/session history](53-STAFF-SESSION-HISTORY.md); real database acceptance passed, combined browser validation in progress |
| S00-06 / G17 | Manage/Purchasing route to implemented Money workflows; availability labels describe their actual limits | [Feature and history navigation](52-FEATURE-AVAILABILITY-HISTORY-NAVIGATION.md) and [completion register](27-V1-COMPLETION-REGISTER.md) |
| S01-01 / G08 | Versioned product metadata/lifecycle and category master with exact-label rename/merge/archive, shared CSV validation and scoped reads | [Catalog maintenance](55-CATALOG-MAINTENANCE.md); implementation and focused checks underway, database/browser acceptance pending |

## 25 October continuation checkpoint

Verified a clean S00 checkpoint at `9df7ca32e4cb90428c90ea82e4a45cece28a664e`
on `feat/codebase-truth-s00`; its commit records the preceding local source,
tests and evidence. A fresh fetch still identifies canonical main as `6119ee2`.
Created `feat/codebase-truth-s01` from that checkpoint for the next vertical
slice. No remote merge, deployment or production database operation occurred.

S01-01 adds additive migration 023 and the catalog domain/UI work described in
docs/55. Full UI/API typecheck passes after initial integration. Stock/service/
prepared classification (S01-02), count conflict recovery and local drafts remain
pending; product maintenance alone does not close S01 or the R1 gate.

The first combined S01 API regression completed **178 passed, 2 failed, 0
skipped (180 tests)** in 106.21 seconds. The only failed assertion and its parent
test were the new upgrade fixture's assumed ordering of `Milk` and `milk` under
the database collation. Both exact identities were preserved. The fixture is
being corrected to compare exact labels without imposing that ordering, then
the upgrade checks must rerun. All command/financial/inventory suites, the new
nine-case catalog suite and corrected import audit checks passed in this run.

## Complete history and eligible evidence (S00-04)

The old limits were terminal caps: 250 stock movements, 50 counts/imports/close reports, 100 till cash movements and 100 eligible positive evidence movements. They are now bounded page sizes with `page.nextCursor`, `page.hasMore`, `page.totalCount`, `page.limit` and `page.asOf`. `q` searches the full authorized result before page slicing. Counts search area/status/operator; imports search filename/mode/status/reference; close reports search operator/business date/shift/reference; till movements search reason/reference/type/operator; stock movements search SKU/name/reference/type; evidence searches reference/type/movement ID.

`historyPagination.ts` binds a versioned opaque continuation to the tenant, outlet, actor, resource and applied search. Invalid shapes, page sizes outside 1–250 and changed-scope/filter cursors return `VALIDATION_FAILED`. Repository-owned SQL always rechecks the authenticated scope and domain permission; the cursor is not an authorization token. Ordering uses the exact PostgreSQL microsecond timestamp plus UUID, avoiding millisecond conversion gaps at a tied boundary. Each page and its matching total share one repeatable-read snapshot. The as-of boundary excludes later timestamped insertions; mutable eligibility/status is re-evaluated on later pages and again by the posting command. This is not a long-lived database snapshot across separate HTTP requests.

Stock running balances are computed over the complete authorized movement source before search and continuation. Searching for an old receipt therefore retains its actual historical running balance. Cost fields retain the original permission boundary. Eligible evidence still requires positive, unallocated receipt/count quantity for the selected exception's product. Loading older evidence grants no extra resolution authority; settlement still locks and validates stock/evidence versions.

`GET /api/v1/shifts/:shiftId/cash-movements` provides complete permitted shift history. `shifts/current` preserves its cash preview and adds `cashMovementPage`, so its limit is visible and recoverable. Close reports can be selected individually from history; their immutable figures remain unchanged. UI history controls provide matching totals, server search, older pages and retained results/errors on read failure. Existing sales pagination and CSV export guards remain intact.

Stock-exception operator/product summaries remain bounded to 100 groups, now explicitly labeled in UI and `coverage.policy`; `operatorGroups`, `productGroups` and `summaryLimit` distinguish summary coverage from complete report totals. No capped export was introduced. Existing exports retain all-filter semantics or explicit size rejection.

### Observed validation

Disposable PostgreSQL 16 runs in the task-owned container `mazao-truth-s00-postgres`, bound to localhost port 55435. Existing unrelated containers were left running. Applied baseline migrations 001–021 successfully before the additive credential work. Per-file database isolation remains enabled.

`node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test apps/api/test/history-pagination.integration.test.ts` with the disposable `TEST_DATABASE_URL`: **7 passed, 0 failed, 0 skipped** after adding outlet/current-role coverage. The suite verifies:

- 251 stock movements and 251 eligible evidence rows, including the 101st/251st candidates;
- 51 counts, 51 import batches, 51 immutable close reports and 101 shift cash movements;
- exact matching totals, every page, UUID ties and PostgreSQL microsecond boundaries without duplicate IDs;
- full-data search for the oldest record, preserving its whole-history running balance;
- invalid/changed-resource/changed-filter continuation and out-of-range page sizes;
- insertions after the first page and explicit limited-preview metadata.
- cross-outlet empty reads, rejection of a copied cursor/evidence ID, and role demotion rechecked before reading another page.

The first full API regression completed **145 passed, 1 failed, 0 skipped (146 tests)**. The single failure compared two entire close-history HTTP responses and treated the changing page `asOf` value as immutable report content. Updated that test to compare every immutable report field and separately check matching totals/continuation. The receipts, cashier-name snapshots, sales and Z-report contents are still checked unchanged. Final rerun evidence will be recorded below.

Final combined API command: `node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test --test-concurrency=4 apps/api/test/*.test.ts` with the disposable `TEST_DATABASE_URL`: **157 passed, 0 failed, 0 skipped**, 69.06 seconds, after route/query/cursor hardening (preceding combined run: 152/152). This includes the new credential, history and directory suites plus prior accounting, stock, tenant/security, command-recovery and immutable-evidence acceptance. Focused name-evidence rerun also passed 2/2. The subsequent year-zero cursor guard passed its focused 2/2 pure validation tests. `npm run typecheck` passed both UI and API projects. These runs used the installed local Node/npm dependencies, not the frozen Bun CI environment.

Migration verification: baseline test database upgraded from 001–021 to `022_credential_operation_fencing`, then all 22 migrations reran with matching checksums. The isolated upgrade suite also preserves pre-existing command and business evidence. Baseline applied migration files were not edited.

History reads cancel superseded requests and retain the applied query/cursor together after failure. Refresh aborts an older movement read before replacing the history. Selected close-report content comes from that report's stored snapshot; only read pagination metadata changes with time. Browser acceptance exercises failed-page retry, server search, older evidence selection and viewing a selected older Z report; results are appended when the combined run finishes.

Review follow-up fixes: public request validation now rejects malformed UUID path parameters and repeated/non-scalar/control-bearing query values before authentication database work. Opaque enum path parameters remain supported. History cursor dates use the shared strict calendar/time validator, rejecting impossible dates and PostgreSQL's unsupported year zero before database parsing, and history search rejects control characters even for non-HTTP callers. Focused pure/HTTP validation and scoped database tests cover these negative inputs; final combined rerun follows these changes.

Full stock refresh and import-return reads now abort the earlier full catalog/history request, including its later recovery lookup; stale results cannot overwrite the newer movement page. Evidence retry intent resets when selecting another exception or refreshing its detail, preserving the selected exception's own cursor/filter. The browser race test requires the original held request to be cancelled, then checks newer history remains visible.

The first real API/PostgreSQL Chromium run completed **15 passed, 2 failed (17 tests)**. One failure was the integration test's global status locator after adding an accessible history status; it now selects the intended item-created notice. One CSV validation encountered a 503/unknown outcome while the watched development API's source was changing; no posting success was claimed. This needs a source-frozen rerun before attributing the failure to a domain defect. Concurrent browser runs also shared the default artifact directory, causing an independent trace-file collision in another batch; subsequent runs use separate output directories. Neither interruption is counted as a pass.

Source-frozen real browser rerun: `npx playwright test --config playwright.integration.config.ts --output dist-artifacts/playwright-s00-integration` with `MAZAO_E2E_DATABASE_URL` pointing to the dedicated `mazao_test` database inside the task-owned localhost container: **17 passed**, 1.4 minutes. This exercises real sign-in/password/session work, business/outlet settings, tax/sale/receiving/cash-up, count recovery and mixed variances, customer statements, hotel dates and CSV validation/apply/stale/recovery. The earlier CSV interruption did not reproduce with stable API source. No unrelated database was used.

Final shared focused Chromium batch: **23 passed**, comprising account access 10, staff history 3, customer regression 3, directory/POS/reservation history 3 and movement/evidence/till history 4. Isolated artifacts are under `dist-artifacts/playwright-s00-directories`. Feature navigation 4/4 and count/import history 2/2 had also passed in the prior focused batch. Latest local build passed: main entry 506.82 kB / 137.41 kB gzip, 18 precache entries, 807.20 KiB. The existing over-500 kB bundle warning remains; no performance budget is claimed from these sizes. Full browser/cross-browser regression results follow when complete.

Full Chromium regression: `npx playwright test --output dist-artifacts/playwright-s00-browser`: **80 passed**, 4.4 minutes. This includes all intercepted browser specifications. After the final evidence-retry scope reset, rebuilt the PWA and reran `history-pagination.spec.ts`: **4 passed**, 10.7 seconds, including selection of a second exception after an older-page attempt and explicit cancellation of a stale full inventory request. Final rebuilt precache size is 807.23 KiB (18 entries). The full 80-case run preceded that final one-line reset; the focused four-case rerun covers its changed behavior.

An independent policy comparison against the original `HEAD` authorization source found **51 original policies, 51 catalogue policies, zero permission/capability differences**. This comparison is independent of the catalogue-derived role tests. Review also caught a migrated session-reason schema that rejected outer whitespace accepted by the domain's trimmed-length rule. Corrected the schema without changing command bytes or hash semantics. Focused public/catalogue/login validation now passes **18/18**; the expanded directory/contract database suite passes **8/8**, including real HTTP execution and output-schema validation of all four migrated handlers and padded 500-character reasons. Typecheck passes after the correction. Detailed per-ticket evidence is in docs/49 and docs/54.

An intervening focused rerun encountered `ECONNREFUSED` after Docker Desktop stopped. Restarted the local daemon and only the task-owned test PostgreSQL container; verified `pg_isready`, then reran the history suite successfully. The interrupted run was not counted as a pass. No unrelated container was explicitly started, stopped or removed.

These are disposable read fixtures plus real setup/exception-sale commands. They do not replace the separate stock/finance posting invariant suites, browser checks, exact-head CI, performance budgets or physical/production acceptance. Combined regression and UI evidence must be appended when observed.

## 25 October 2026 browser follow-up

Against the unchanged S00 static build dated 20 October, reran the corrected Firefox cashier account case: **1 passed**, using `npx playwright test e2e/account-access.spec.ts --browser=firefox --grep 'cashier can reach' --output=dist-artifacts/playwright-s00-firefox-cashier-2026-10-25`. The earlier 25/26 Firefox result remains historical evidence; this is a focused acceptance of its fractional geometry assertion correction.

The existing matrix command `npx playwright test --config=playwright.browser-matrix.config.ts --output=dist-artifacts/playwright-s00-browser-matrix-2026-10-25` completed **35 passed, 1 failed** across Chromium desktop/mobile and Firefox desktop/mobile viewport. The Firefox desktop invalid-discount case timed out during sign-in bootstrap before Sell became available; its trace contained only the HTML response and no `/auth/me` request. The other three projects passed that case. Without changing source, fixture or static build, reran that exact Firefox desktop case with `--project=firefox-desktop --grep 'invalid line discount' --output=dist-artifacts/playwright-s00-matrix-firefox-discount-rerun-2026-10-25`: **1 passed** in 12.5 seconds. The failed matrix run is retained and is not described as an uninterrupted 36/36 pass. These intercepted checks do not add production or installed-PWA evidence.

The task-owned PostgreSQL container was found stopped after Docker Desktop restarted. Started only `mazao-truth-s00-postgres`; it completed crash recovery from the interrupted 20 October process, then `pg_isready -U postgres -d mazao_truth` reported accepting connections. No database reset, cleanup or unrelated container mutation was performed.

## Remaining delivery gates

R1 is not yet accepted. S00 governance/live identity and combined regression remain open; S01 catalog/type/count recovery semantics are still required. R2 and R3 remain open in full, including business-policy choices, offline/device authority, physical profiles, independent recovery context, and all A–H exact-artifact gates. No completion percentage is inferred from files or tests.
