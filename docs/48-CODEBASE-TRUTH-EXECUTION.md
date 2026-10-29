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
| S00-04 / G04,G05 | Keyset continuation, full-data search and matching totals for movements, count/import/close history, shift cash movements and eligible exception evidence | Local database and browser regressions passed; details and limitations below, exact-head hosted/release gates remain |
| S00-05 / G04 | Customer/staff/assignment/session/reservation server navigation, full-tenant customer totals and server-backed pickers | [Directory continuation](54-DIRECTORY-CONTINUATION.md) and [staff/session history](53-STAFF-SESSION-HISTORY.md); local database and combined browser acceptance passed |
| S00-06 / G17 | Manage/Purchasing route to implemented Money workflows; availability labels describe their actual limits | [Feature and history navigation](52-FEATURE-AVAILABILITY-HISTORY-NAVIGATION.md) and [completion register](27-V1-COMPLETION-REGISTER.md) |
| S01-01 / G08 | Versioned product metadata/lifecycle and category master with exact-label rename/merge/archive, shared CSV validation and scoped reads | [Catalog maintenance](55-CATALOG-MAINTENANCE.md); locally verified database/fresh-upgrade-rerun/browser/recovery behavior; exact-head hosted CI and release gates pending |
| S01-02 / G08 | Explicit stocked/service/prepared kinds, service-only commerce, reviewed kind changes, original sale-kind snapshots and persisted command capability requirements | [Item kinds and service sales](56-ITEM-KINDS-SERVICE-SALES.md); focused domain/CSV/recovery/upgrade checks passed, combined API and browser verification in progress |
| S01-03 / G06 | Separate count-recovery worktree prepared from the frozen S01-02 follow-up snapshot; reviewed baseline/recount and immutable-evidence design selected | [Count recovery](57-COUNT-RECOVERY.md); isolated implementation in progress, no count recovery integrated or accepted in this checkout |

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

After the fixture corrections, the full isolated API regression passed **181/181,
0 failed, 0 skipped**, with `--test-concurrency=2` in 179.66 seconds. Full
intercepted Chromium acceptance passed **89/89** in 3.7 minutes. The existing
real API/PostgreSQL browser suite passed **17/17** in 1.6 minutes, and a new
focused real catalog maintenance journey passed **1/1**, checking current master
versions and unchanged posted receipts/stock/journals. Focused upgrade and
preflight checks passed **5/5**. These local runs precede the final shared-client
acknowledgement review follow-up described in docs/55; its verification is
recorded separately. They do not establish exact-head hosted CI or release
acceptance.

While final review was in progress, the shared checkout acquired commit
`24c1bd5949f22cc71829b468f569cb3921960d9c` on
`feat/codebase-truth-s01`, tracking its matching origin branch. This agent did
not create or push that commit. The checkpoint is preserved; subsequent review
tests/documentation and the archived-category rename affordance remain follow-up
work. Read-only GitHub inspection found no PR for this branch, so no exact-head
hosted acceptance is claimed. Its tracked generated browser last-run file is
preserved rather than treated as release evidence.

Review identified that generic command recovery overwrote a nested response
command ID before validating it, and generic confirmations accepted an empty
create result. The shared-client follow-up retains the original journal for
mismatched IDs, incomplete creation evidence, empty rejection codes and
idempotency mismatch. The catalog UI is also being aligned with the canonical
nonempty reason rule. These fixes require fresh-build focused browser evidence
before S01-01 is treated as locally verified.

Final review verification passed against the rebuilt artifact: **93/93 Chromium
tests** in 3.9 minutes, **18/18 real API/PostgreSQL browser tests** in 1.6 minutes,
**9/9 focused Firefox catalog tests**, and **7/7 terminal-response helper tests**.
The focused Chromium catalog/recovery batch also passed 13/13. Both UI/API
typecheck and production PWA build passed; the 502.43 kB main chunk retains its
existing size warning, so no performance budget is claimed. The 181-case API
regression preceded the final client-only acknowledgement follow-up; its new
helper tests and the final browser runs validate that follow-up without claiming
another full API rerun. No API/domain/migration source changed after that API
run. Full artifact paths and all first-attempt failures/corrections are in
docs/55. S01-01 is locally verified, with final review follow-ups left reviewable
in the worktree above checkpoint `24c1bd5`.

The following continuation implements S01-02: explicit stocked/service/prepared
classifications, service settlement without fictitious stock or inventory COGS,
reviewed reclassification of legacy goods, and trusted persisted capability
requirements for recovery. Migration 024 preserves legacy goods and snapshots;
025 preserves recovery requirements independently of later classification.
Focused tests pass: 7 direct trading/correction checks, 7 CSV checks, 13 command
recovery checks, 9 populated/new/legacy upgrade checks and 32 shared pure checks.
Combined API and fresh-build browser acceptance remain in progress; docs/56
records exact evidence and limits. Count conflict recovery, local draft
persistence, count review/valuation and scoped counts remain S01-03–07.

## 27 October item-kind acceptance follow-up

The shared checkout now contains user-authored checkpoint
`f36509061cf0f8a69319b11dea6a5ae920dd4a06`, preserving the preceding S01-02 source,
tests and documentation. This agent did not create or push it. Current follow-up
fixes remain reviewable above that checkpoint; no reset or deployment occurred.

The complete sequential API rerun finished **217 passed, 2 failed, 0 skipped**
(219 tests, 399.27 seconds). Both failed scenarios are under review as fixture
drift: an invalid-capability list still rejects commerce alone, and an
unsupported customer-credit refund supplies an unrelated random line ID before
the trusted planner can reach its tender guard. The runtime acceptance rules
remain unchanged while those scenarios are corrected and rerun.

The preceding full real API browser run completed **18 passed, 1 failed** (19
tests, 3.0 minutes). Its failure was the configured inventory-to-sale journey:
after a confirmed settings save, the UI still marked the form dirty until a
refresh finished, so an immediate Stock navigation opened a discard prompt.
A held-refresh browser regression reproduced that blocked navigation on the
unchanged static artifact (1 failed, retained trace). Confirmed settings now
clear their unsaved marker before refreshing. Failed runs are preserved under
`dist-artifacts/playwright-s01-item-kinds-real-all` and
`dist-artifacts/playwright-s01-settings-nav-repro-2026-10-27`.

Independent review also found a synthetic terminal rejection on unauthorized
import replay and hidden pending refund lines after a committed/lost response.
Those fixes and their fresh evidence are recorded in docs/56. Combined API and
rebuilt browser acceptance remain open; the preceding focused green checks do
not establish full acceptance. S01-03–07 and S02–S11 remain in scope.

The subsequent fresh artifact passed **19/19 real API/PostgreSQL browser
workflows** in 1.8 minutes, including the corrected settings-navigation behavior
and commerce-only Manage followed by service creation, taxed sale, refund and
cash close. The new configuration regressions passed **2/2**, and the focused
catalog/kind/recovery browser batch passed **29/29**. UI/API typecheck and the
production PWA build passed. Full Chromium passed **111/111** in 9.0 minutes.
The corrected full API rerun passed **219/219, 0 skipped**, in 417.23 seconds,
using unchanged sequential standard isolation. The first Firefox batch finished
**110/111**. Its catalog-creation failure was traced to delayed dialog focus
stealing active typing; two deterministic regressions reproduced that defect.
The shared focus/cleanup correction passed three focused cases in each browser
and **19/19 real browser workflows** again on new artifact `index-cBYBUKkU.js`.
Full 113-case Chromium/Firefox acceptance of this artifact remains pending; the
slice is not yet fully locally accepted. Exact evidence belongs to docs/56.

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

R1 is not yet accepted. S00 governance/live identity and exact-head hosted/release acceptance remain open. S01-01 through S01-06 have local slice evidence recorded above; S01-07 selected/blind implementation is present but its newest API acceptance could not be rerun after the isolated PostgreSQL container stopped. Location-scoped counts remain open behind S03-02's stock-location authority. R2 and R3 remain open in full, including business-policy choices, offline/device authority, physical profiles, independent recovery context, and all A–H exact-artifact gates. No completion percentage is inferred from files or tests.

## 29 October 2026 local S01 acceptance follow-up

The system-font artifact now passes the full intercepted browser regression in
both engines: **113/113 Firefox** and **113/113 Chromium**. The prior Firefox
109/113 failure was tied by traces to externally hosted font requests blocking
`load`; the remote dependency was removed and the regression rerun on the rebuilt
artifact. S01-02's full locally required browser matrix is now green. Its
219/219 API run, 19/19 real API browser workflows, focused configuration tests,
typecheck and production build are recorded in [docs/56](56-ITEM-KINDS-SERVICE-SALES.md).
Hosted exact-head CI, production, backup/restore, installed-device and
performance gates remain separate.

S01-03 count recovery is now integrated as uncommitted changes in the primary
`feat/codebase-truth-s01` worktree. Its intercepted suite passed **12/12**, the
real API/PostgreSQL browser suite passed **2/2** at desktop and mobile viewports,
and the final sequential API run passed **239/239, 0 skipped** in 426.5 seconds.
The four migration/route compatibility test files passed **16/16** on focused
rerun. Migration 026 checksum is
`13a318cfc63f5fbcc4e340fc02168ac28e406f7810f60e12283db6588572f407`.
`mazao_test` remains at `025_command_capability_evidence`; only generated
`mazao_api_<uuid>` and `mazao_count_e2e_<uuid>` databases received migration 026.
The final full API reporter and exact browser/database evidence are detailed in
[docs/57](57-COUNT-RECOVERY.md). S01-03 has local slice acceptance; exact-head
hosted CI, release, backup/restore, production, physical-device and performance
gates remain open. No commit, merge or deployment was performed.

After integration, primary-worktree typecheck and production build both pass.
The primary count-review browser suite passed **12/12**, and its new generated
database migrated through 026 before the real API/PostgreSQL browser suite passed
**2/2**. Existing count UI coverage passed **2/2** and the other real count API
and posting workflows passed **3/3** on the same fresh generated database. The
final primary artifact is `index-Cvreg54l.js` with 22 precache entries. Full run
details and retained logs are in docs/57; no generated migration-026 database
replaced or migrated the named `mazao_test` fixture.

S01-04 local unsent count recovery is implemented in the primary worktree.
Unsent quantities/reasons are stored separately from server-saved count data
and the command journal, scoped by tenant/actor/outlet/count, and tagged with
server count version plus an IndexedDB compare-and-swap revision. Matching
drafts restore after reload; stale versions open for explicit review. Storage
quota/open errors and cross-tab revision conflicts remain visible and retryable.
Terminal command confirmation is required before local recovery data is cleared.
The focused new browser suite passed **8/8**, including reload, stale review,
quota/blocked storage, two tabs, actor change, lost save acknowledgement and
cancellation recovery. The prior recovery-readiness navigation assertion was
updated to expect persistence. Primary typecheck and PWA build passed; the final
entry is 523.88 kB / 142.95 kB gzip with 22 precache entries / 879.71 KiB.
The chunk-size warning remains informational, not a performance result. S01-04
has local slice acceptance only; hosted CI, installed-PWA, release and
production evidence remain open.

S01-05 readiness guidance is implemented and locally accepted. The new count
readiness browser cases passed **4/4** at 1024x600 and 390x844. They verify
missing/invalid quantities and variance reasons, direct keyboard focus links,
barcode scanner focus, explicit zero semantics, saved reason restoration,
server-saved line totals, filtered hidden-line totals and visible posting
confirmation. `npm run typecheck` and `npm run build` passed on artifact
`index-BI4q23jy.js` (527.79 kB / 143.66 kB gzip; 22 PWA entries / 883.53 KiB).
The existing chunk warning does not establish performance acceptance. S01-05
is locally accepted; exact-head hosted CI, production and release gates remain
open.

## S01-06 valuation review implementation, 29 October 2026

Positive count gains from a zero-quantity baseline now display the proposed
unit cost and extended value from the reference cost captured when that count
opened. The review identifies that source as an estimate. A count approver with
catalog or finance cost access must acknowledge the estimate and enter a
valuation reason before posting. The API enforces the same requirement, so a
direct command cannot bypass the review. If the opening reference cost is zero,
the explicit policy is to retain a zero-valued gain only after manager review
and a reason explaining that treatment; it is not treated as verified purchase
cost.

The approval reason is stored in the immutable POSTED count event and in the
audit record. Audit line evidence stores the opening-cost origin, proposed unit cost,
proposed extended value and whether the cost was zero. Existing exact movement,
weighted-average balance, gross gain/shrinkage journal and subsequent sale
valuation paths remain in use. This workflow does not change provisional COGS
for stock exceptions. No migration is needed because count-event reasons and
movement values already have durable storage.

S01-06 local acceptance now passes. The generated disposable PostgreSQL
integration run passed **10/10** in
`apps/api/test/count-recovery.integration.test.ts`; this includes the exact
zero-baseline estimate, required reason, no-effect rejection, count movement,
balance, gain journal and subsequent sale COGS reconciliation, plus explicit
zero-reference-cost behavior. Supporting mixed gain/shrinkage and separate
stock-exception provisional-COGS suites passed **8/8**. The focused valuation
browser suite passed **2/2**, checking the visible estimate, zero-cost policy,
acknowledgement gate and exact reason payload. `npm run typecheck` passes. The
production PWA build is `index-B0hTPVqF.js` (531.56 kB / 144.77 kB gzip) with
22 precache entries (887.35 KiB); its existing chunk-size warning is not
performance acceptance. Tests used only generated `mazao_api_<uuid>` databases
on the local disposable PostgreSQL container; no named fixture or production
database was migrated. Exact-head CI, release, backup/restore, production and
physical-device evidence remain separate gates.

## S01-07 dependency finding, 29 October 2026

S01-07 requires location-scoped counts, but the current inventory schema has no
stock-location entity or per-location balance. The existing count `areaLabel`
is descriptive text only and cannot safely filter outlet-level quantities.
S03-02 is the roadmap ticket that introduces locations and transfers, which
provides the stock-location authority required by S01-07. Implementing location
counts before that stock model would compare a local physical quantity to an
outlet-wide balance. Resolve the dependency by delivering the location authority from
S03-02 before location-scoped count modes. Do not treat free text as a stock
location. Selected-item and blind-count behavior can proceed independently.

## S02-01 tenant bootstrap and reviewed go-live implementation, 29 October 2026

Migration 028 persists tenant onboarding state and backfills existing tenants
as `LEGACY_ACTIVE` without inventing past review evidence. The supported
bootstrap command now requires an interactive terminal, hidden owner-password
entry and an explicit confirmation. It uses random identities and a reusable
request UUID for safe recovery, and only creates a tenant in an empty business
database. New tenants remain in `SETUP`.

The API limits pending tenants to setup reads and commands; ordinary business
routes and command submissions are rejected server-side. The owner can approve
go-live only after supplying a reason and confirming the setup. The command
locks and recomputes first-sale checks transactionally, records audit/outbox
evidence and makes a one-time `LIVE` transition. The setup workspace and
operator docs expose the pending state and review process. Physical terminal
pairing remains separate work. Detailed behavior is in
[tenant onboarding](58-TENANT-ONBOARDING.md).

`npm run typecheck` passed after implementation. The focused onboarding
integration case is present but was not rerun: the disposable PostgreSQL
service is unavailable. Do not substitute the named `mazao_truth` fixture.
Migration, tenant-isolation, route-gating and go-live database acceptance,
exact-head CI, release and production evidence remain open.

## S02-02 outlet lifecycle and local defaults implementation, 29 October 2026

Manage now reads a tenant-scoped outlet directory and supports owner/admin
creation, versioned profile edits, tax defaults and safe activation/deactivation.
The business reporting time zone stays tenant-wide. An outlet can inherit the
business tax default or keep its own reviewed rate and label. New items, rooms
and imports read the selected outlet policy; receipt snapshots and existing
product/room rates remain unchanged.

Closure refuses active assignments, open tills/counts, stock quantity/value,
confirmed reservations and checked-in stays. It also requires another active
outlet with an active owner/admin workspace. The existing versioned outlet
profile and command journal support the feature, so no schema migration was
needed. See [outlet lifecycle](59-OUTLET-LIFECYCLE.md).

`npm run typecheck` passed. The PWA bundle built for the outlet lifecycle slice
as `index-Ch6bpAI1.js` (538.07 kB / 146.12 kB gzip; 22 precache entries /
904.61 KiB). Database and browser acceptance remain pending because the
isolated PostgreSQL service is unavailable. Authenticated outlet switching is
source-implemented in S02-03, but still needs isolated database/browser
acceptance; physical terminal enrollment, hosted CI and production evidence
remain open.

## S02-03 authenticated context switching implementation, 29 October 2026

The API lists only the current operator's active assignments. The switch input
contains only the selected device ID; server-side identity determines all other
scope. A serializable transaction locks the current session and active target
assignment, changes tenant/outlet/device on the existing session, increments
its version and writes an audit event in the prior tenant/outlet. The session
token and CSRF value remain stable so `/auth/me` can resolve a lost response.
An unauthorized or stale target leaves the current session in place. No new
business command is sent or replayed during context change.

The browser preserves the existing sign-in assignment picker and adds an
authenticated **Switch workspace** dialog. It checks current-device unknown
commands, import validation, password operation and local count-draft recovery
before enabling a switch. Local storage errors fail closed. A POS basket asks
before it is cleared. Pending reads are aborted; uncertain responses resolve
through `/auth/me`; a context identity key resets outlet-local workspace and
receipt state. A BroadcastChannel transition hides old workspace data in other
tabs until they reload the authoritative session.

The API integration and browser regression cases are included. `npm run
typecheck` passed for UI and API projects. `npm run build` passed with artifact
`index-BIxqB31C.js` (540.70 kB / 146.05 kB gzip; 22 PWA entries / 914.51 KiB).
The focused intercepted browser regression passed 1/1, including POS basket
confirmation and source/target catalog isolation. The PostgreSQL API test did
not run locally because the disposable PostgreSQL service is unavailable; do
not restart the unrelated stopped Docker stack or use the named `mazao_truth`
database. Exact-head hosted CI, isolated API/migration acceptance, real API/browser
acceptance, and release checks remain open. This slice is source/build and
browser-fixture checked, not database-accepted or deployed. See
[context switching](60-CONTEXT-SWITCHING.md).
