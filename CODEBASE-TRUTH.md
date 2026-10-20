# Mazao ERP — Codebase gaps and completion sprint plan

**Audit date:** 20 October 2026, Africa/Nairobi  
**Repository:** https://github.com/davemusau00/mazao-erp-v1  
**Audited main:** `6119ee2d2043afca38b764b5a0750dd9cf75908c` — Confirmed stock exception sales and reconciliation (#23)  
**Purpose:** finish the documented Mazao v1 through prioritized, reviewable vertical slices. This is a development plan; no application source, GitHub issue/PR state, production data or deployment was changed.

## 1. Decision

Mazao has a substantial working online foundation. The fastest route to completion is to close operational dead ends, finish catalog and stock semantics, establish outlet and approval boundaries, then complete payment corrections, purchasing, restaurant and hotel workflows. Complete finance from those source workflows before implementing bounded offline cash and final acceptance.

Do not restart the architecture, rebuild working staff screens, repeat the mixed-count journal fix, or treat every old branch as unmerged work. The current code is a React/Vite PWA with a Fastify/PostgreSQL modular API, serializable commands, command recovery, balanced journal controls and meaningful automated acceptance. Those foundations should be extended.

**Main is currently green in GitHub Actions. Full v1 is not complete.** Source completion, CI acceptance and production activation are separate states. No defensible percentage-complete score follows from the number of screens or passing tests.

### Three delivery gates

| Gate | What it means | Completion boundary |
| --- | --- | --- |
| R1: dependable existing online pilot | Current supported jobs have no known recovery dead end; count/catalog/service semantics are usable; operators can reach complete history; release identity is known | S00–S01, relevant pagination/performance work, regression acceptance. This is not full retail/restaurant/hotel v1. |
| R2: complete online v1 workflows | Outlets, inventory, counter corrections, purchasing, restaurant, hotel, assets and supported finance all work through their source records | S02–S08 plus applicable S10 acceptance. Offline remains unavailable until R3. |
| R3: documented full v1 | Bounded offline cash, device authority, replay, physical hardware, accessibility, restoration and all A–H suites accepted on the exact release | S09–S11 and every earlier gate. |

The full scope is anchored in `docs/01-PRODUCT-PRD.md`, `docs/04-DOMAIN-MODULES.md`, `docs/15-TESTING-ACCEPTANCE.md` and the repository agent rules. Wholesale-specific extensions from the separate Stockflow proposal are not silently added to this completion baseline.

## 2. Audit scope and evidence quality

Reviewed all **17 remote branch heads**, all **4 open PRs**, current main CI jobs, release metadata/rulesets, the source tree, domain/migration/authorization boundaries, reachable workspaces and acceptance configurations. The tree contains **30 API source modules, 21 SQL migrations, 34 API test files and 24 browser test files**. File counts describe the tree, not implementation coverage.

Source inspection covered identity/configuration, catalog/import, receiving/counts, stock exceptions, POS/payments/refunds, shifts, customers, hospitality, accounting/controls/reporting, command journals, PWA, deployment and backup tooling. This is a cross-codebase engineering audit, not a line-by-line formal proof or a security penetration test.

Evidence labels used below:

- **Reproduced:** observed directly in this audit.
- **Confirmed in source:** executable paths or missing contracts establish the boundary; not a new production reproduction.
- **Documented runtime evidence:** recorded repository measurements/deployment evidence; date and branch matter.
- **Unverified operational gate:** current runtime/hardware/account configuration needs direct acceptance.
- **Proposed work:** implementation recommendation derived from documented scope; not an allegation of a current defect.

### Verification performed now

| Check | Observed result | Limit |
| --- | --- | --- |
| Main Actions run `39417548593` on `6119ee2` | Both jobs passed: type/build/API checks, fresh+rereun migrations, Chromium/Firefox matrix, real API/PostgreSQL browser integration, production container smoke and release artifacts | Existing test scope only; no acceptance for absent modules |
| Local `npm run typecheck` | Passed | Dependencies installed through npm, not the frozen Bun CI environment |
| Local `npm run build` | Passed; main entry 493.67 kB / 133.55 kB gzip; 18 precache entries, 788.42 KiB | Generated bundle under local dependency resolution; not the immutable CI artifact |
| Four focused test files via Node/tsx | **19 passed, 0 failed, 0 skipped**: API messages, CSV parser, report mapping, exact money/quantity formatting | Pure/boundary tests only |
| Invalid login input via Fastify inject | `{email:123,password:"example-invalid-password"}` returns **500 INTERNAL_ERROR**; TypeError occurs before any database query | Reproduces input validation defect, not authentication bypass |
| Standard local API test command | `tsx` CLI hit an environment IPC `EPERM`; direct Node/tsx broad no-DB invocation exited without a complete reporter summary | Not counted as a full API pass. PostgreSQL suites not rerun locally; PostgreSQL/Docker unavailable here |
| Live production, installed PWA, physical terminal/printer/scanner, screen reader | Not exercised | No new claim about current deployed SHA or physical acceptance |

Latest hosted CI: https://github.com/davemusau00/mazao-erp-v1/actions/runs/39417548593

### Working features that must not be rebuilt

| Area | Current verified source foundation | Boundary still open |
| --- | --- | --- |
| Identity | Staff create/edit/deactivate, fixed roles, logical outlet assignments, initial/reset/self password, sessions/revocation, multi-assignment login selection | Never-received credential recovery, physical device authority, outlet administration, granular approval policy |
| Business settings | Tenant/current-outlet identity, tax defaults, receipt text/assets, first-sale checklist | Repeatable tenant creation, multiple outlets/switching, reviewed go-live, full operating settings |
| Catalog/import | Item creation; strict reviewed CSV create/SKU update, barcode/category/reorder metadata, opening value evidence | Direct edit/archive, service/nonstock semantics, categories/packages/variants, XLSX |
| Stock | Weighted-average receiving, immutable movements, saved outlet count, mixed gain/loss journals | Movement-aware count restart/review, packages, locations/transfers/waste, recipes/sealed-open, reserved/provisional views |
| Sales | Cash, cashier-confirmed manual M-Pesa, full customer-account charge, fixed currency amount discount once per whole item line, immutable receipt | Held baskets, split tender, time-bound approvals, customer-credit/M-Pesa reversals, room charges |
| Exceptions | Optional explicit physical confirmation for selling above recorded stock; provisional COGS/clearing; evidence-backed resolution and close blocking | Source acceptance beyond current scenarios, return reconciliation, complete evidence continuation, production acceptance of migration 021 |
| Cash-up | Shift/till movements, tax/tender evidence, immutable close reports | Complete history/search, expanded tender/correction coverage and physical checks |
| Customers | Credit limits, account charge, FIFO cash repayment, snapshot-consistent statement, age-since-charge report and AR controls | Due dates, overdue aging, noncash/split collections, linked credit reversal, statement scale/export |
| Purchasing/finance | Supplier creation, expense or full-value receipt invoice, duplicate guard, partial bank/M-Pesa supplier payments, unpaid bill reversal | PO, partial receipt/invoice matching, landed cost/tax variance, supplier credits, full supplier statements |
| Finance | Expenses/reclassifications/reversals; incoming M-Pesa statement matching/corrections; periods; account display labels; controls; journal drilldown | Configurable posting mappings, opening balances, bank/outgoing settlement, assets/depreciation/accruals, complete supported statements |
| Hotel | Room/reservation/walk-in/check-in, booked-night cash checkout, dirty→ready, corrected date handling | Deposits, rate quotes, food/service folios, partial/mixed payments, stays/extensions/moves, housekeeping holds |
| Recovery | Durable original-command journal, status lookup, permission revalidation, read timeouts/cancellation, fail-closed write readiness | This is not offline financial operation |

## 3. Branch and release reconciliation

Ahead/behind means commit ancestry against audited main. Patch equivalence and tree comparison are needed because cherry-picks/squash merges make ancestry misleading.

| Remote branch | Behind / ahead main | Disposition |
| --- | --- | --- |
| `main` | 0 / 0 | Canonical baseline `6119ee2` |
| `feat/confirmed-stock-exception-sales` | 1 / 4 | **Exact same tree as main**; feature was squash merged as #23. Do not merge again. |
| `feat/product-finishing` | 5 / 0 | Already ancestor; older completion notes on this branch are not the current backlog |
| `fix/release-gate-reliability` | 2 / 1 | Unique **documentation/evidence commit** `01d13de`; preserve/reconcile its 19 October deployment record |
| `feat/staff-workspace-access` | 54 / 1 | Extra commit is patch-equivalent to main |
| `fix/account-self-service` | 48 / 1 | Patch-equivalent; PR #15 remains open |
| `fix/hotel-calendar-dates` | 48 / 1 | Patch-equivalent; PR #16 remains open |
| `fix/login-runtime-guard` | 48 / 2 | Both patches equivalent; PR #13 remains open |
| `fix/mixed-stock-count` | 48 / 1 | Patch-equivalent; PR #14 remains open |
| `fix/api-test-isolation` | 39 / 0 | Ancestor; retain test isolation and real within-suite races |
| `fix/operational-analytics-500` | 49 / 0 | Ancestor |
| `feat/product-csv-import` | 81 / 0 | Ancestor |
| `feat/server-configuration` | 88 / 0 | Ancestor |
| `docs/pilot-configuration-evidence` | 86 / 0 | Ancestor |
| `docs/csv-pilot-release` | 79 / 0 | Ancestor |
| `fix/pilot-server-login` | 95 / 0 | Ancestor |
| `deploy/mazao-isolated-vps` | 105 / 0 | Ancestor |

The open PRs are review/governance cleanup, not four missing production features. Compare patches, preserve acceptance evidence and close/supersede duplicate PRs with an explanation during S00. Do not reset branches or cherry-pick all old commits.

**Governance gap:** GitHub reports main unprotected and the repository ruleset list is empty. CI is useful but not enforced as a merge barrier. A published `mazao` release exists from 16 October; it is not evidence for today's head.

**Deployment evidence gap:** main's `docs/46` still says the accounting release is pending. The unique `fix/release-gate-reliability` record `docs/47-PRODUCTION-RELEASE-2026-10-19.md` records `ce5b8ab` activated with migrations 018–020 and successful restore/integrity checks. Today's main adds migration 021. Thus the latest located deployment evidence is one application commit behind main, but current live state is **not verified in this audit**. Read actual runtime SHA/schema before any release decision. Preserve the record about incomplete workstation plaintext cleanup as operational follow-up; no cleanup was attempted here.

## 4. Prioritized gap register

P0 = safety/support/release-trust blocker that must be resolved before broadening usage. P1 = necessary operational v1 completion. P2 = required finish/polish or a scope item that can follow core correctness. P0 does not imply that a confirmed production incident exists.

| ID | Priority and evidence | Gap / practical effect | Code anchor | Sprint |
| --- | --- | --- | --- | --- |
| G01 | P0; confirmed source | Credential metadata is retained before send, but a request never received by the server stays 404 indefinitely. UI cannot submit another password operation. Do not resolve this by deleting metadata after 404. | `credentials.ts`; `PasswordOperationPanel.tsx:60–72`; `secretOperationJournal.ts`; command status route | S00 |
| G02 | P0; GitHub metadata | Main is unprotected; no repository rulesets. Older open PRs and stale completion records obscure which fixes shipped. | Branches/rulesets; docs/27,38,46; unique release evidence branch | S00 |
| G03 | P1; reproduced | Numeric login email produces HTTP 500. Command envelope also has a loose UUID regex and object checks accepting arrays. Generic malformed input should be rejected before DB/domain work. | `app.ts:139–143,407–409` | S00 |
| G04 | P1; confirmed source | Customer directory 500, movements 250, counts 50, imports 50, close reports 50, cash movements 100, staff/assignments 500, sessions 100, reservations 250: incomplete navigation without continuation. Sales history already has pagination and must be preserved. | `app.ts`; `customerAccounts.ts:16`; `staff.ts:125,133,142`; `shiftCloseReports.ts:19`; `productImport.ts:275` | S00/S10 |
| G05 | P1; confirmed source | Exception resolution offers only latest 100 eligible positive stock movements, without paging. Older valid evidence is unreachable through this picker. Top-100 exception summaries need explicit coverage labeling. | `stockShortfalls.ts:340–355,382,386` | S00 |
| G06 | P1; confirmed source | Any changed stock quantity/value/version after count opens prevents posting. New product also conflicts. Safe rejection exists, but no supported reviewed rebase; a long count can become operationally unusable. | `commands.ts:406–441,516–536`; count workspace | S01 |
| G07 | P1; confirmed source | Unsaved count edits are component state; navigation warns, saved drafts persist, but unsaved keystrokes do not survive a crash. Every full count line must be entered; line-level errors need faster review. | `BackendStockCountWorkspace.tsx:80,136–173`; `saveStockCount` | S01 |
| G08 | P1; confirmed source | No direct product update/archive command or stock/nonstock/service classification. Every active product with a balance enters full counts. A room stay or service represented as an ordinary product will be counted as inventory. | command policies; catalog schema/read; `openStockCount` | S01 |
| G09 | P1; confirmed source | Zero-baseline count gains use reference cost; zero/estimated valuations can enter stock/profit without an explicit valuation review workflow. Existing provisional exceptions are separate evidence and must remain separate. | `commands.ts:550–556`; `stockShortfalls.ts`; coverage in accounting controls | S01 |
| G10 | P1; confirmed source | Logical assignments exist, but operator outlet creation/switching and full tenant provisioning do not. A selectable assignment is not cryptographic enrollment of a physical terminal. | `staff.ts`; login assignment selection; bootstrap scripts; feature registry | S02/S09 |
| G11 | P1; confirmed source | Fixed-role permissions and cashier line discounts exist; scoped one-time approval limits, approval replay protection and granular business policy are absent. Waiter/cook/bartender have empty permissions. | `contracts.ts`; `commandAuthorization.ts` | S02/S04/S06 |
| G12 | P1; confirmed source | No package/barcode conversion model, stock locations/transfers/waste or reservation/pending availability projections. A free-text base unit cannot deliver these invariants. | migrations; catalog and inventory commands | S03 |
| G13 | P1; confirmed source | Recipe/yield and sealed/open volume consumption are absent. Selling a shot cannot safely consume a linked bottle through the current product-only quantity model. | domain specs vs command manifest/schemas | S03/S06 |
| G14 | P1; confirmed source | POS basket is component state; no durable held/resumed basket/tab. One settlement method per order; no supported mixed cash/M-Pesa/account allocation. | `PointOfSaleView.tsx`; `settleSale` | S04 |
| G15 | P1; confirmed source | M-Pesa and account-sale refunds explicitly blocked. Normal restocking is also blocked for exception-sale lines; no complete manager return/clearing workflow yet. | `commands.ts:1052–1063` | S04 |
| G16 | P1; confirmed source | Customer collections are cash-only. Age-since-charge bands exist, but no contractual due-date model/true overdue aging or credit-reversal allocation. | customer repayment commands; `controlReports.ts`; customer schema | S04/S08 |
| G17 | P1; confirmed source | Purchasing only receives; supplier/AP exist under Money while Manage still says unavailable. Stock invoice requires exactly one receipt's full value. PO, part receipt/invoice, variance/credits/landed costs are absent. | `ProcurementWorkspace.tsx`; `featureRegistry.ts:60`; `accounting.ts:131–177` | S00/S05 |
| G18 | P1; confirmed source | Restaurant is intentionally disabled; prototype table/ticket components do not reach server workflows. | feature registry service `not_connected`; no service routes/commands | S06 |
| G19 | P1; confirmed source | Hotel checkout posts room charge and equal cash payment together for booked nights. No deposit liability, running folio/service charges, partial/mixed settlement, stay changes or maintenance workflow. | `commands.ts:1160–1184`; hospitality schema/workspace | S07 |
| G20 | P1; confirmed source | Account display labels are editable, not a configurable chart/posting map. Expense categories and payment controls are bounded; opening balance/accrual/asset/depreciation/general adjustment workflows are missing. | `accountCatalog.ts`; `accounting.ts`; finance schema | S08 |
| G21 | P1; confirmed source | P&L intentionally returns PARTIAL_OPERATING_SUMMARY, omitting depreciation/accruals, complete bank/provider settlement and general adjustments. Periods and AR/AP/inventory controls exist; complete statements cannot be claimed. | `financeReports.ts:getProfitLoss`; `accounting.ts:260–346` | S08 |
| G22 | P1; confirmed source | Incoming manual M-Pesa evidence matching exists. Outgoing/bank settlement and statement completeness are not reconciled; a negative ledger control balance is not available cash. | accounting coverage exclusions and M-Pesa matching | S08 |
| G23 | P1; confirmed source | No signed offline grants, local cash commits, allocation/replay/feed/sequence/fencing implementation. Current journals recover online unknown outcomes only. | `commandJournal.ts`; command routes; `docs/07` | S09 |
| G24 | P1; confirmed source | Outbox writes exist but no operational worker/feed/dead-letter implementation is present. Logging/timing exist; production alerts, backup freshness/key-independent recovery and measured RPO/RTO remain acceptance work. | source tree; transactional outbox; requestMetrics; infra runbooks | S09/S10 |
| G25 | P1; documented runtime | 18/19 October release evidence explicitly retains failed overall performance acceptance. Prior signed-out cold samples were 9.6–24.3 seconds after compression. Warm fixture p95 success is not cold/concurrent production acceptance. | docs/44–45; branch-only 19 October release record | S10 |
| G26 | P1; confirmed test scope | Browser matrix covers six selected specs, Chromium/Firefox desktop/mobile viewports; service workers blocked. It does not prove all role/viewports, real installed-PWA transactions, physical hardware or future A–H workflows. | Playwright configs; `docs/15` | Every sprint/S10–S11 |
| G27 | P1; confirmed source | Active receipt uses browser print with hardcoded 76mm layout. No connected selectable 58/80mm profile, copy/job lifecycle or verified physical scanner/printer acceptance. Archived hardware simulator does not count. | `BackendReceiptModal.tsx:32,95–97`; `src/services/hardware.ts` unreachable prototype | S10 |
| G28 | P2; confirmed source | Generic types/manual dispatch have no generated command/JSON-Schema catalogue as required. Large `commands.ts` (~120 kB) and API/UI adapters increase drift risk. | contracts, authorization policies, command dispatcher, apiClient | S00 incremental through S11 |

### The immediate stock-count interpretation

Mixed surplus/shrinkage posting already has separate inventory debit and credit lines on main. Do not reopen that solved defect based only on PR #14 still being open. For today's count, distinguish: missing variance reasons, actual balance/catalog version conflict, stale deployed build/schema, and a new server failure using its request/command ID. This audit did not inspect that live count or its actual response, so it does not assert which one is preventing its commit.

Service classification should prevent future “Quick Room” inventory counting. Existing quantities/value/history require an explicit reviewed reclassification/reversal policy; do not silently exclude or delete balances to make the count pass.

## 5. Execution rules and dependency order

Each sprint below is an **outcome-gated work package**, not a promise that its full scope fits a calendar week. Use a five-working-day review cadence; carry unfinished acceptance forward openly. Work in progress: one foundational domain change at a time per owner. If a package exceeds available capacity, split it into numbered iterations without lowering its exit gate.

Required order:

1. S00 establish truthful baseline/recovery/contracts and complete access to history.
2. S01 make count/catalog/service jobs dependable; S02 establish tenant/outlet/device/approval boundaries.
3. S03 establish stock and valuation semantics; S04 payment/correction semantics.
4. S05 purchasing follows stock; S06 restaurant follows stock/payment/approval contracts; S07 hotel uses the same payment/folio boundaries.
5. S08 completes finance from those actual source flows. Add each source's posting tests as it is built, never wait until S08 to balance it.
6. S09 builds offline against stable online contracts and real device identity.
7. S10 hardens actual performance/hardware/operations; start its measurements and backup work in S00, finish after offline.
8. S11 closes all A–H gates and the exact release evidence.

Independent UI/report/support work may proceed once its contracts are fixed; this plan does not require agent delegation. Avoid concurrent changes to command contracts, stock valuation or payment allocation without a designated integration owner.

### Shared definition of done for every ticket

The ticket is complete only when reachable UI, typed validated contracts, permission/capability checks, tenant/outlet scope, versions, canonical same-ID replay, transaction/audit/journal effects, and negative/recovery cases are accepted together. Use additive migrations; test fresh, checksum-safe rerun and upgrade from the preceding supported release. Preserve historic receipts/journals/stock evidence. Mark each operation ONLINE_ONLY, DRAFT_ONLY or accepted OFFLINE_ALLOWED. Include accessible loading/empty/error/conflict states and support references. Record exact commands/results, known limitations and CI SHA.

The estimates below are implementation planning units: **S 0.5–1 developer-day; M 1–2; L 2–4; XL 4–7**. They include focused tests/docs, exclude waiting/review/production observation, and are not model-runtime estimates. XL tickets must be split into smaller PRs. These are first-pass estimates; revise after S00 and the first completed vertical slice.



## 6. Sprint backlog — implementation-ready tickets

### S00 — Trust the baseline and remove recovery/history dead ends

**Outcome:** A clean integration baseline, controlled malformed-input errors, recoverable credential outcomes and complete access to existing authoritative records.

**Exit gate:** Prove request-dropped-before-arrival password recovery and old evidence lookup beyond every cap; exact-head CI stays green.

**Planning effort:** 7.5–15 developer-days across 6 tickets.

#### S00-01 · Establish one truthful integration and release baseline

**Priority:** P0 · **Size:** M · **Owner function:** Lead/platform · **Depends on:** none

**Implementation anchors:** `README.md; docs/27,38,43–47; CI; GitHub protection; branch-only release evidence`.

**Acceptance:** Record audited main, actual staging/live SHAs and migration heads separately. Preserve 19 October deployment evidence. Verify patch-equivalent PRs before superseding them. Require exact-head checks and a documented merge policy; owner approves governance configuration. Preserve green CI and per-file DB isolation.

#### S00-02 · Validate public inputs and introduce the command contract catalogue

**Priority:** P1 · **Size:** M · **Owner function:** API/platform · **Depends on:** S00-01

**Implementation anchors:** `apps/api/src/app.ts; contracts.ts; commandAuthorization.ts; commands.ts`.

**Acceptance:** Numeric/array/null/overlong email values return controlled 4xx before DB work; real UUIDs and object shapes are validated; unknown fields do not silently alter intent. Catalogue current commands with schemas, permissions, effects and online/offline modes. Add CI checks for schema/policy/dispatch drift; migrate existing commands incrementally.

#### S00-03 · Fence never-received password operations safely

**Priority:** P0 · **Size:** L · **Owner function:** Identity/domain · **Depends on:** S00-02

**Implementation anchors:** `credentials.ts; secretOperationJournal.ts; PasswordOperationPanel.tsx; additive identity/command migration`.

**Acceptance:** An authorized metadata-only reconciliation atomically determines accepted/finished versus safely fenced; a delayed original request cannot execute after fencing. Test request dropped before arrival, commit/lost response, late arrival, revoked assignment, changed actor, old browser and upgrade. Store no passwords or replayable password body. Only a terminal response unlocks a new operation.

#### S00-04 · Complete movement/count/import/close/evidence history access

**Priority:** P1 · **Size:** L · **Owner function:** API/UI · **Depends on:** S00-02

**Implementation anchors:** `app.ts; stockShortfalls.ts; shiftCloseReports.ts; productImport.ts; matching workspaces`.

**Acceptance:** Stable tenant/outlet-scoped continuation and server filters reach records beyond 250/100/50. Exception picker reaches the 101st eligible evidence movement. Show totals/coverage and empty/error/retry states. Exports either cover the entire filter or explicitly reject oversized requests; no silent truncation.

#### S00-05 · Complete customer/staff/assignment/session/reservation navigation

**Priority:** P1 · **Size:** M · **Owner function:** API/UI · **Depends on:** S00-02

**Implementation anchors:** `customerAccounts.ts; staff.ts; hospitality reads; directories/pickers`.

**Acceptance:** Customer 501, staff/assignment 501, session 101 and reservation 251 are discoverable. Search executes against full authorized data, not a truncated local list. Continuation remains correct with equal sort values and concurrent inserts. Preserve existing paged sales history and reporting paths.

#### S00-06 · Reconcile feature availability and route operators to real services

**Priority:** P1 · **Size:** S · **Owner function:** Product/UI · **Depends on:** S00-01

**Implementation anchors:** `featureRegistry.ts; ProcurementWorkspace.tsx; MoneyWorkspace.tsx; README.md; completion register`.

**Acceptance:** Manage/Purchasing clearly link authorized users to existing supplier bills/payments in Money. Periods, expenses and manual M-Pesa are marked implemented with exact limits. Disabled restaurant/offline remain honest. Every visible action maps to a real endpoint or a clear unavailable state; no prototype imports become authoritative.

### S01 — Make catalog and stock counts usable in daily trading

**Outcome:** A storekeeper can maintain correct item types, preserve count work and resolve a count that conflicts with live activity without rewriting sales.

**Exit gate:** Mixed gain/loss count, zero-baseline value, service exclusion and count-versus-sale race all reconcile; crash restores draft.

**Planning effort:** 9.5–19 developer-days across 7 tickets.

#### S01-01 · Finish versioned direct product maintenance

**Priority:** P1 · **Size:** L · **Owner function:** Catalog/domain+UI · **Depends on:** S00-02

**Implementation anchors:** `catalog schema; commands.ts; BackendInventoryWorkspace.tsx; apiClient.ts`.

**Acceptance:** Create/edit/archive/restore barcode/reorder/price metadata with expected versions and audit. Add a category master with safe rename/merge/archive and product references. SKU/barcode conflicts are explicit. Open quotes detect changed products; paid receipt/tax/COGS snapshots stay unchanged. Archiving does not erase stock or prevent historical lookup. CSV and direct edits share validation.

#### S01-02 · Separate stocked goods, services and prepared sale items

**Priority:** P1 · **Size:** L · **Owner function:** Inventory/domain · **Depends on:** S01-01

**Implementation anchors:** `catalog migration; count/catalog/settlement/import commands; item UI`.

**Acceptance:** Service sells without fictitious stock/COGS or an irrelevant inventory capability requirement; stocked good counts normally; prepared item is distinguished for later recipe consumption. Existing misclassified records require a reviewed quantity/value correction, never silent deletion. A room stay uses hotel billing or explicit service policy and cannot inadvertently enter physical stock counts.

#### S01-03 · Make count conflicts recoverable without overwriting live sales

**Priority:** P1 · **Size:** L · **Owner function:** Inventory/domain+UI · **Depends on:** S01-02

**Implementation anchors:** `open/save/post count; count conflict contract and review UI`.

**Acceptance:** Choose and document a controlled count window or explicit movement-aware rebase. Show changed lines/movements and preserve prior count evidence. Recount/confirm affected items under fresh versions. Test sale/receipt/refund/new product/cost change during count and competing posts; no blind rebase or erased variance.

#### S01-04 · Persist count edits and operator progress safely

**Priority:** P1 · **Size:** M · **Owner function:** UI/recovery · **Depends on:** S01-03

**Implementation anchors:** `BackendStockCountWorkspace.tsx; local draft store; recovery routing`.

**Acceptance:** Distinguish local unsent edits, server-saved draft and posted result. Refresh/browser restart restores unsent edits under actor/tenant/outlet/count/version scope; stale draft opens for review, not automatic post. Test quota/blocked storage, two tabs, actor change, cancellation and lost acknowledgement. Remove local draft only after confirmed outcome.

#### S01-05 · Speed count review and resolve validation dead ends

**Priority:** P1 · **Size:** S · **Owner function:** UI/QA · **Depends on:** S01-04

**Implementation anchors:** `count workspace and API validation details`.

**Acceptance:** Before posting, show missing quantities, missing variance reasons and affected item links; keyboard/scanner focuses the correct input. Explain full-count semantics and explicitly entered zero. Reasons survive save/reload. Confirm remains reachable at 1024×600 and 390×844. Saved-line totals and hidden-search totals remain accurate.

#### S01-06 · Review estimated opening and count-gain valuation

**Priority:** P1 · **Size:** M · **Owner function:** Inventory/finance · **Depends on:** S01-02,S01-03

**Implementation anchors:** `count posting; opening import; stock exception reports; finance coverage`.

**Acceptance:** Positive stock from zero baseline exposes proposed unit cost/value, origin and approval reason. Unknown/zero cost follows explicit business policy. Preserve gross gain/shrinkage, exact weighted-average values and provisional-vs-verified COGS. Known-value fixture reconciles movements, balance and journal through count and later sale.

#### S01-07 · Support scoped spot/blind counts and unknown barcodes

**Priority:** P1 · **Size:** M · **Owner function:** Inventory/UI · **Depends on:** S01-03,S01-05

**Implementation anchors:** `count modes/contracts; barcode lookup; item creation permissions`.

**Acceptance:** Choose full/location/selected-item count scope before snapshot. Blind mode hides expected quantity until authorized review. Uncounted outside-scope products never become zero. Unknown barcode routes to permissioned item-link/create review, not an invented product. Conflicts, saved draft, variance approvals and exact valuation remain correct across every mode.

### S02 — Finish business, outlet, device and approval authority

**Outcome:** A second business/outlet and staff member are provisioned through supported workflows with explicit device and approval boundaries.

**Exit gate:** Fresh tenant→outlet→staff→enrolled terminal→first sale plus context-switch/forged approval tests pass.

**Planning effort:** 7.5–15 developer-days across 6 tickets.

#### S02-01 · Provision a new tenant without bespoke SQL

**Priority:** P1 · **Size:** M · **Owner function:** Platform/identity · **Depends on:** S00-03,S00-06

**Implementation anchors:** `bootstrap scripts; new onboarding service; setup checklist`.

**Acceptance:** Idempotent secure owner/business/outlet bootstrap from an empty database through UI or supported admin workflow. No fixed tenant IDs or embedded credentials. Retry does not create duplicate tenants/owners; another tenant cannot inspect setup. Record onboarding state and require reviewed go-live before ordinary use.

#### S02-02 · Create and maintain outlets and operating settings

**Priority:** P1 · **Size:** M · **Owner function:** Platform/domain · **Depends on:** S02-01

**Implementation anchors:** `configuration.ts; core.outlets; Manage workspace`.

**Acceptance:** Create/edit/deactivate outlets, time zones and supported receipt/tax/default policies with versions and audit. Never deactivate an outlet with unresolved shifts/resources without a documented closure workflow. Tenant-wide reporting time zone remains stable; labels/settings affect future records while historical snapshots remain intact.

#### S02-03 · Switch authenticated outlet context safely

**Priority:** P1 · **Size:** M · **Owner function:** Identity/UI · **Depends on:** S02-02

**Implementation anchors:** `login assignment selection; session/context APIs; AppShell; recovery stores`.

**Acceptance:** Select only active authorized assignments. Context switch handles active/unknown commands and drafts, cancels obsolete reads and clears old catalog/customer/receipt state. No cross-outlet screen data flashes or command replay in the new context. Existing sign-in assignment selection remains supported.

#### S02-04 · Establish actual terminal enrollment and revocation

**Priority:** P1 · **Size:** L · **Owner function:** Identity/security · **Depends on:** S02-03

**Implementation anchors:** `identity devices/session model; enrollment UI; server auth`.

**Acceptance:** Separate a staff outlet assignment from an enrolled browser/terminal identity. Enroll with an authorized one-time flow and bound key/material; review/revoke device and fence new work. Test copied assignment ID, unregistered device, lost terminal, revoked operator and concurrent enrollment. Define rotation/recovery before offline grants.

#### S02-05 · Implement scoped single-use manager approvals

**Priority:** P1 · **Size:** L · **Owner function:** Identity/domain · **Depends on:** S00-02,S02-02

**Implementation anchors:** `approval model; command manifest; permission UI`.

**Acceptance:** Approval binds tenant/outlet/action/actor/amount/document version/expiry and is consumed in the same transaction as the action. Reuse, stale target, changed amount or revoked approver fails. Preserve fixed roles as defaults; add approval policy before introducing broad custom role editors.

#### S02-06 · Accept role/capability and context boundaries

**Priority:** P1 · **Size:** S · **Owner function:** Security/QA · **Depends on:** S02-03,S02-05

**Implementation anchors:** `contracts.ts; featureRegistry.ts; API tests; identity docs`.

**Acceptance:** All reachable actions agree with effective API permissions; disabled capability cannot be bypassed by direct command or status/replay. Test cashier, storekeeper, receptionist, housekeeper, accountant, manager, owner, and denied staff cases. Record tenant-wide customer/finance access policy explicitly; extend role matrix for service staff in S06.

### S03 — Finish real inventory and cost semantics

**Outcome:** Packages, locations, transfers, waste, opened containers and recipes preserve exact quantity and value.

**Exit gate:** Four six-packs→24 cans; bottle→ml→pours; recipe→waste; transfer/count/sale all conserve stock and reconcile journals.

**Planning effort:** 12–24 developer-days across 7 tickets.

#### S03-01 · Implement canonical units, variants, packages and barcodes

**Priority:** P1 · **Size:** L · **Owner function:** Catalog/inventory · **Depends on:** S01-02,S02-02

**Implementation anchors:** `new catalog/package schemas; import; receiving/POS/count UI`.

**Acceptance:** Receive four six-packs as 24 canonical cans; sale/count use the same exact base quantity. Multiple package barcodes map unambiguously. Nested conversion cycles, dimension mismatch, duplicate codes and precision overflow reject. Variants retain individual stock identity; historical snapshots and cost basis survive later package edits.

#### S03-02 · Implement locations and auditable transfers

**Priority:** P1 · **Size:** L · **Owner function:** Inventory/domain · **Depends on:** S03-01,S02-03

**Implementation anchors:** `location/balance/transfer schema; stock UI; commands`.

**Acceptance:** One transfer reduces source and increases destination atomically at conserved quantity/value. Support same-outlet locations and documented cross-outlet transit/receipt policy. Duplicate replay, competing transfers, insufficient stock and cancellation/partial receipt preserve conservation and audit. No direct edits to quantity projections.

#### S03-03 · Add waste, damage and authorized stock corrections

**Priority:** P1 · **Size:** M · **Owner function:** Inventory/finance · **Depends on:** S03-02,S02-05

**Implementation anchors:** `movement commands; approval policy; movement reports`.

**Acceptance:** Reason-coded write-off/correction has immutable source, actor, approval and exact valuation. Prevent below-policy stock and duplicate correction. Reports separate shrinkage, waste, receiving, transfer and count adjustment; journal effects reconcile and closed periods reject ordinary historical changes.

#### S03-04 · Track sealed bottles and open volume

**Priority:** P1 · **Size:** L · **Owner function:** Inventory/domain · **Depends on:** S03-01,S03-02

**Implementation anchors:** `container/volume model; open/consume/waste commands`.

**Acceptance:** Unseal bottle once, transfer volume without creating stock/value, consume exact ml, expose sealed plus open stock. Test mixed sizes, partial pours, spillage, empty bottle, concurrent opens and replay. Preserve cost through container→volume conversions and count sealed/open stock using explicit units.

#### S03-05 · Implement versioned recipes and yields

**Priority:** P1 · **Size:** L · **Owner function:** Inventory/service · **Depends on:** S03-04

**Implementation anchors:** `recipe schema; ingredient consumption contracts; item setup`.

**Acceptance:** Prepared food/drink consumes linked ingredients under a declared fire/fulfillment/settlement boundary. Recipe edits affect future orders only. Test subrecipes/cycles, yield, modifiers, insufficient ingredients, void-before/after-prep and wastage. No double consumption on kitchen retry or settlement replay.

#### S03-06 · Publish truthful stock availability and reconciliation

**Priority:** P1 · **Size:** M · **Owner function:** Inventory/reports · **Depends on:** S03-02,S03-05

**Implementation anchors:** `inventory projections/reports; reservations; exception controls`.

**Acceptance:** Expose physical, reserved, offline-allocated/pending and available with one documented formula and no duplicate subtraction. Before offline is implemented, mark that component unavailable rather than inventing it. Known fixture reconciles quantity/value/movements across sale, recipe, count, waste and transfer.

#### S03-07 · Complete package-aware CSV and bounded XLSX import

**Priority:** P1 · **Size:** L · **Owner function:** Catalog/import · **Depends on:** S03-01,S01-01

**Implementation anchors:** `productImport.ts; workbook parser; mappings/preview/history; package contracts`.

**Acceptance:** Support documented variants, category/package/base-unit conversion and barcode mappings through the same reviewed validation pipeline. Preserve text identifiers and explicit units/currency. Reject ambiguous conversions, archive conflicts, zip/workbook bombs and oversize sheets. Any blocking row error prevents commit; apply/replay/opening inventory value and immutable batch evidence match the reviewed result.

### S04 — Complete counter payments and corrections

**Outcome:** Cashiers can hold/resume, take mixed payment and handle authorized returns/collections without changing immutable history.

**Exit gate:** Mixed tender→partial discounted return→AR/noncash collection and repeated recovery produce exactly one financial outcome.

**Planning effort:** 9–18 developer-days across 7 tickets.

#### S04-01 · Persist held baskets and resume them safely

**Priority:** P1 · **Size:** M · **Owner function:** Commerce/UI · **Depends on:** S01-01,S00-03

**Implementation anchors:** `order draft contracts/schema; POS; local draft store`.

**Acceptance:** Hold/resume/rename/discard basket under actor/outlet scope with version protection. Refresh/restart preserves it; two cashiers cannot settle the same draft. Resume refreshes quote/tax/stock authority and requires review of changes. Holding a basket does not falsely post cash, sales or COGS.

#### S04-02 · Implement split and mixed settlement

**Priority:** P1 · **Size:** L · **Owner function:** Commerce/finance · **Depends on:** S04-01,S02-05

**Implementation anchors:** `settle command; payment allocations; POS; receipt; shifts`.

**Acceptance:** Cash plus manual M-Pesa plus permitted account allocation exactly covers payable total; cash change comes only from cash. Enforce confirmation, unique references, credit limit, shift versions and allocation caps. Lost response/replay creates one sale and one allocation set. Receipt, sales history and Z report agree on every tender.

#### S04-03 · Apply approvals to discounts, voids and price exceptions

**Priority:** P1 · **Size:** M · **Owner function:** Commerce/security · **Depends on:** S02-05,S04-02

**Implementation anchors:** `POS policy; approval engine; audit; tax snapshots`.

**Acceptance:** Retain fixed currency amount discount once per full item line. Add explicit business limits and one-time approval above limits, with reason and actor. Void of draft vs reversal of paid order follows separate policies. Tampering/reuse/stale approval fails server-side; discounts and tax refund allocation stay exact.

#### S04-04 · Complete linked cash/M-Pesa/customer-account returns

**Priority:** P1 · **Size:** L · **Owner function:** Commerce/AR · **Depends on:** S04-02,S04-03

**Implementation anchors:** `refund commands/schema; AR allocations; receipt/return UI`.

**Acceptance:** Partial and full returns never exceed remaining item/discount/tax/tender amounts. M-Pesa return is manually confirmed outgoing evidence, never automatic cash drawer payout. Account credit reverses AR with allocation/repaid-sale rules. Original documents remain immutable and mixed tender returns cannot overpay.

#### S04-05 · Resolve returns from stock exception sales

**Priority:** P1 · **Size:** M · **Owner function:** Inventory/commerce · **Depends on:** S04-04,S01-06

**Implementation anchors:** `stockShortfalls.ts; refund resolution commands; manager UI`.

**Acceptance:** Return of recorded/unrecorded and already-resolved portions has explicit quantity, provisional clearing and COGS reversal policy. Manager verifies restock evidence; no fictitious inventory or orphan clearing. Test full/partial return before/after resolution, lost response and repeated refund.

#### S04-06 · Accept noncash and split customer collections

**Priority:** P1 · **Size:** M · **Owner function:** AR/finance · **Depends on:** S04-02,S04-04

**Implementation anchors:** `customer repayment command; allocations; statement; shift reports`.

**Acceptance:** Cash/manual M-Pesa collections allocate FIFO or reviewed allocation once, obey account balance, and create no new revenue. Noncash collection leaves drawer unchanged. Repayment correction remains linked and cannot strand allocations. Statement, tender reports and AR control reconcile after concurrency/replay.

#### S04-07 · Record credit terms, due dates and complete statements

**Priority:** P1 · **Size:** M · **Owner function:** AR/UI · **Depends on:** S04-06

**Implementation anchors:** `customer terms/charge snapshots; aging/report/export`.

**Acceptance:** Snapshot due dates per charge; changing future terms does not rewrite old obligations. Distinguish charge age from true overdue debt. Page/date-filter/export a full statement with opening/closing balances and linked reversals. Long-history, partial repayment and as-of boundaries reconcile.

### S05 — Complete purchasing and supplier accounts

**Outcome:** Supplier→PO→partial receipt→matched invoice→partial payment/credit is one auditable source chain.

**Exit gate:** PO/receipt/GRNI/AP/inventory/COGS and supplier statement control fixture agrees exactly across replay and variance.

**Planning effort:** 6.5–13 developer-days across 6 tickets.

#### S05-01 · Finish supplier maintenance and purchase orders

**Priority:** P1 · **Size:** M · **Owner function:** Purchasing/UI · **Depends on:** S02-05,S03-01

**Implementation anchors:** `supplier extension; PO domain; Procurement workspace`.

**Acceptance:** Maintain supplier identities/terms with historical invoice snapshots. Draft→approve→order PO with versioned lines, package units and audit. Unauthorized/stale/replayed approvals fail. Preserve existing supplier creation/invoice/payment services rather than introducing a second AP authority.

#### S05-02 · Link partial deliveries and rejected goods to PO

**Priority:** P1 · **Size:** M · **Owner function:** Purchasing/inventory · **Depends on:** S05-01,S03-02

**Implementation anchors:** `receiving command; PO/receipt allocations; receiving UI`.

**Acceptance:** Partial/multiple receipts and rejects update remaining PO quantities exactly once. Supplier and delivery references link to durable receipt documents. Return/overdelivery requires explicit reviewed policy. Stock receipt posts inventory/GRNI, not a second expense or cash payment.

#### S05-03 · Match invoices to partial/multiple receipt evidence

**Priority:** P1 · **Size:** L · **Owner function:** Purchasing/finance · **Depends on:** S05-02

**Implementation anchors:** `accounting.ts invoice; matching allocations; AP UI`.

**Acceptance:** Replace exact-one-full-receipt restriction with bounded allocations. Duplicate supplier invoice guard remains; invoice/receipt quantities and value cannot be allocated twice. Price/quantity/tax discrepancy blocks or requests explicit approval. Preserve original receipt values and record linked variance policy.

#### S05-04 · Allocate landed cost and purchase tax with evidence

**Priority:** P1 · **Size:** M · **Owner function:** Inventory/finance · **Depends on:** S05-03

**Implementation anchors:** `landed-cost/variance commands; valuation; tax classification`.

**Acceptance:** Shipping/fees/tax treatment follow approved business configuration, not a hardcoded jurisdiction assumption. Allocate using a declared exact method; stock on hand vs already sold cost adjustment follows documented policy. Totals reconcile to invoice, GRNI/AP, inventory and any COGS true-up; no silent revaluation of historical lines.

#### S05-05 · Add supplier credits, returns and settlement corrections

**Priority:** P1 · **Size:** M · **Owner function:** AP/finance · **Depends on:** S05-03,S04-02

**Implementation anchors:** `supplier credit/return/payment correction sources; AP UI`.

**Acceptance:** Credit note/return links to original bill and stock evidence; partial payments and corrections do not exceed outstanding payable. Noncash outgoing references remain unique. Duplicate/replayed credit does not reduce AP twice. Reversed paid invoice follows explicit correction path, not deletion.

#### S05-06 · Reconcile supplier statements, aging and outstanding GRNI

**Priority:** P1 · **Size:** S · **Owner function:** AP/reports · **Depends on:** S05-04,S05-05

**Implementation anchors:** `supplier/AP/PO reports; CSV/print; source drilldown`.

**Acceptance:** Supplier opening + bills − credits − payments equals closing AP; aging uses invoice due dates. Show uninvoiced receipts and unmatched invoice/PO variance separately. Full filtered exports, per-outlet source links and tenant-wide permissions are tested with multi-page populated data.

### S06 — Deliver a complete restaurant and bar shift

**Outcome:** Waiter, kitchen, bar and cashier use live server workflows with deterministic ticket/stock/settlement effects.

**Exit gate:** Table→fire→prepare→split/transfer→settle→cash close passes under competing operators and interrupted responses.

**Planning effort:** 6.5–13 developer-days across 6 tickets.

#### S06-01 · Connect tables, sections, stations and service roles

**Priority:** P1 · **Size:** M · **Owner function:** Service/identity · **Depends on:** S02-06,S04-01

**Implementation anchors:** `new service schema/commands; role map; service workspace`.

**Acceptance:** Waiter/cook/bartender receive bounded permissions and role-specific landing tasks. Tables/stations/routes persist server-side. Disabled restaurant capability blocks API work. Two operators cannot overwrite a table assignment or see another tenant's tickets; prototype components are replaced or adapted through actual contracts.

#### S06-02 · Create/edit orders, modifiers and fire tickets exactly once

**Priority:** P1 · **Size:** L · **Owner function:** Service/domain · **Depends on:** S06-01,S03-05,S04-03

**Implementation anchors:** `service order/ticket command model; kitchen/bar UI`.

**Acceptance:** Order revision/modifier/route and fired line versions persist. Fire retries send one station ticket per intended revision; later add-ons and cancellations preserve prior evidence. Consumption policy from S03 is applied at one declared event. Offline fire remains unavailable unless explicitly accepted later.

#### S06-03 · Implement preparation, completion and handoff

**Priority:** P1 · **Size:** M · **Owner function:** Service/UI · **Depends on:** S06-02

**Implementation anchors:** `ticket state commands; station queue; role UI`.

**Acceptance:** Station acknowledges/prepares/marks ready with ordered state/version transitions and timestamps. Failed refresh/reconnect cannot lose or duplicate a ticket. Authorized staff see live/polled changes with visible freshness; canceled/prepared waste is explicit rather than restoring stock invisibly.

#### S06-04 · Transfer/split/merge tabs and settle them once

**Priority:** P1 · **Size:** M · **Owner function:** Service/commerce · **Depends on:** S06-02,S04-02

**Implementation anchors:** `tab ownership/line allocation; settlement; table UI`.

**Acceptance:** Lock affected tabs/orders in stable order. Line/tax/discount/paid allocation is conserved across transfer/split/merge. Two waiters/cashiers racing final settlement produce one payment and correct kitchen/stock history. Printed bill is not proof of settlement.

#### S06-05 · Connect service sources to receipts, bills and reports

**Priority:** P1 · **Size:** S · **Owner function:** Service/finance · **Depends on:** S06-03,S06-04

**Implementation anchors:** `service source documents; report metadata; print contracts`.

**Acceptance:** Bill/ticket/paid receipt identify table/order/version, modifiers, server and station as appropriate. Refund/void/waste and COGS drill through to actual source. Manager can trace prepared-but-unpaid and unserved-but-paid exceptions without granting cook access to finance.

#### S06-06 · Accept a full restaurant/bar shift and failure cases

**Priority:** P1 · **Size:** M · **Owner function:** QA/business · **Depends on:** S06-05

**Implementation anchors:** `real PostgreSQL browser acceptance; service runbook`.

**Acceptance:** Receive packages→open bottle/recipe→table order→fire→complete→split→mixed settle→return/void→cash close. Repeat with simultaneous operators, lost fire/settle responses and browser restart. Stock, clearing, tenders, revenue/tax/COGS and Z report reconcile exactly.

### S07 — Deliver the full guest lifecycle

**Outcome:** Reception can manage a quoted stay, deposit, running bill, payment, move and checkout; housekeeping can release the room safely.

**Exit gate:** Deposit liability/earned room revenue/folio/tenders/guest AR and room availability reconcile through the complete stay.

**Planning effort:** 9–18 developer-days across 7 tickets.

#### S07-01 · Implement room types, rates, availability and quotes

**Priority:** P1 · **Size:** M · **Owner function:** Hotel/domain · **Depends on:** S02-02,S00-05

**Implementation anchors:** `hospitality schema; rates/quote APIs; reservations UI`.

**Acceptance:** Rate/tax/date/policy quote is immutable for accepted booking; explicit versions detect stale rate/availability. Booking race, overlap, cancellation, time zone and daylight/calendar cases are tested. Complete room/reservation search does not depend on a 250-row list.

#### S07-02 · Record guest deposits and partial/mixed payments

**Priority:** P1 · **Size:** L · **Owner function:** Hotel/finance · **Depends on:** S07-01,S04-02

**Implementation anchors:** `deposit/payment allocations; folio; payment UI`.

**Acceptance:** Guest advance is liability until applied/earned under policy. Partial cash/M-Pesa payments do not duplicate room revenue or imply full settlement. Payment/refund/forfeit allocations have immutable source, approval and replay protection; drawer and M-Pesa controls remain separate.

#### S07-03 · Operate a running guest folio and charge POS to room

**Priority:** P1 · **Size:** L · **Owner function:** Hotel/service · **Depends on:** S07-02,S06-04

**Implementation anchors:** `folio charges/reversals; room-charge tender; hotel/POS UI`.

**Acceptance:** Add room/food/service charges to the correct active stay once, with source snapshots and authorization. Moving a charge needs linked correction. Guest statement reconciles deposits, charges, payments, tax and balance; duplicate room-charge request cannot bill twice.

#### S07-04 · Support extensions, room moves and departure policies

**Priority:** P1 · **Size:** M · **Owner function:** Hotel/domain · **Depends on:** S07-01,S07-03

**Implementation anchors:** `stay change commands; availability locks; quote review`.

**Acceptance:** Extend/move locks both resources and checks overlaps/rates/tax. Early/late/day-use rules use explicit accepted quote/billing policy. Test runtime/outlet time zones, mid-stay rate change, concurrent move and closed accounting dates. Never edit original charged nights silently.

#### S07-05 · Complete balanced checkout and approved outstanding balance

**Priority:** P1 · **Size:** M · **Owner function:** Hotel/finance · **Depends on:** S07-03,S07-04,S02-05

**Implementation anchors:** `checkout command; guest AR policy; statement/receipt`.

**Acceptance:** Check out only when folio reconciles to settled amounts or explicit approved receivable. Carry unpaid balance to a real debtor subledger with limits and audit. Concurrent payment/checkout, lost response and duplicate request cannot double charge. Final guest statement and settlement receipt are distinguishable.

#### S07-06 · Complete housekeeping, inspection and maintenance holds

**Priority:** P1 · **Size:** M · **Owner function:** Hotel/operations · **Depends on:** S07-05

**Implementation anchors:** `room state commands; housekeeping/maintenance queue`.

**Acceptance:** Checkout routes room to cleaning. Authorized clean→inspect→ready transitions and out-of-order/maintenance holds prevent booking/check-in of unavailable rooms. Track defects/responsible staff/times without exposing guest finance to housekeepers. Test cancellation, active-stay hold and concurrent status changes.

#### S07-07 · Accept full hotel lifecycle and daily revenue controls

**Priority:** P1 · **Size:** M · **Owner function:** Hotel/finance/QA · **Depends on:** S07-06

**Implementation anchors:** `hotel source reports; occupancy/ADR; journals; browser tests`.

**Acceptance:** Deposit→check-in→room/food charges→partial pay→extend/move→checkout→clean/inspect passes with exact controls. Agree earned-room-revenue/night-posting timing before closing periods; do not postpone all earned revenue to cash checkout by accident. Occupancy/ADR/guest balances derive from accepted events and explain exclusions.

### S08 — Make finance and reports complete for supported operations

**Outcome:** Every supported operational source reaches a reconciled ledger/report with controlled periods, assets, basic accruals and clear completeness.

**Exit gate:** Known populated control fixture balances across all sources; complete statements never rely on missing source data or hidden rows.

**Planning effort:** 9–18 developer-days across 7 tickets.

#### S08-01 · Complete posting-account templates and controlled mappings

**Priority:** P1 · **Size:** M · **Owner function:** Finance/domain · **Depends on:** S05-06,S07-07

**Implementation anchors:** `accountCatalog.ts; new mapping contracts; account metadata`.

**Acceptance:** Keep display-name editing intact. Add bounded posting-account configuration with classification, currency/control rules and versioned effective use. Prevent arbitrary mapping changes from breaking AR/AP/inventory/clearing controls or rewriting old journals. Unknown account codes block complete-report claims.

#### S08-02 · Record reviewed opening balances and safe adjustments

**Priority:** P1 · **Size:** M · **Owner function:** Finance/domain · **Depends on:** S08-01

**Implementation anchors:** `opening balance/journal source; period/approval guards`.

**Acceptance:** Balanced approved opening entries link to AR/AP/stock/cash/bank subledger evidence and do not double-count imported inventory. Append-only corrections use an open effective date. Arbitrary unbalanced/control-account direct journals are refused. Report unexplained opening clearing instead of calling it profit.

#### S08-03 · Connect cash expenses, accruals and ordinary costs

**Priority:** P1 · **Size:** M · **Owner function:** Finance/domain · **Depends on:** S08-02,S02-05

**Implementation anchors:** `shift.cash.movement; expense categories; accrual/reversal sources`.

**Acceptance:** Business expense payout is classified to expense or approved clearing; a float transfer does not become expense. Existing bank/M-Pesa expenses/reclassifications remain supported. Record basic approved accruals and reversals, without building advanced payroll. Tax treatment is configured and evidence-backed; closed-date and replay cases pass.

#### S08-04 · Implement minimal asset register, custody, maintenance and depreciation

**Priority:** P1 · **Size:** L · **Owner function:** Assets/finance · **Depends on:** S08-02,S05-04

**Implementation anchors:** `asset domain/migration; Money/Manage UI; posting/report sources`.

**Acceptance:** Acquire asset without treating it as stock/resale expense; record cost/date/life/policy/custodian. Run idempotent depreciation per asset/period and authorized disposal/correction. Track maintenance/defects through minimal operator workflow. Asset schedule, accumulated depreciation and journals reconcile; advanced asset management stays deferred.

#### S08-05 · Complete supported bank and outgoing M-Pesa reconciliation

**Priority:** P1 · **Size:** M · **Owner function:** Finance/reconciliation · **Depends on:** S08-03,S05-05,S04-06

**Implementation anchors:** `statement/settlement model; controls; matching UI`.

**Acceptance:** Extend incoming-only evidence to supported outgoing/fees/transfers/openings with explicit coverage. Unmatched and duplicate entries are visible; match/correction creates no fictitious cash or revenue. Distinguish ledger balance, externally verified balance and unknown completeness. Record business verification of the manually supplied statement boundary.

#### S08-06 · Deliver complete supported statements and close controls

**Priority:** P1 · **Size:** L · **Owner function:** Finance/reports · **Depends on:** S08-03,S08-04,S08-05,S07-07

**Implementation anchors:** `financeReports.ts; accounting.ts; reports UI; source drilldown`.

**Acceptance:** Known fixture reconciles sales/returns/discounts, inventory/COGS, expense/accrual/depreciation, hotel revenue/deposits, AR/AP, cash/bank/M-Pesa and exception clearing. P&L can be complete only for the declared supported business coverage; otherwise retain partial status. Financial position and cash movement statements reconcile. Close prevents late posting and records exact checks/evidence.

#### S08-07 · Finish an explicit operator report catalogue and exports

**Priority:** P1 · **Size:** M · **Owner function:** Reports/UI · **Depends on:** S08-06,S06-06

**Implementation anchors:** `operational/item/control/finance reports; docs/report catalogue; CSV/print`.

**Acceptance:** Cover product/outlet/operator sales, tenders, discounts/returns, stock movement/value/waste, purchases/AP, AR/guest balances, room revenue/occupancy/ADR and daily supported profit. Every report declares date zone/scope/as-of/freshness/coverage, total and source links; full exports/print and permissions match UI totals under populated multi-page data.

### S09 — Deliver bounded offline cash and reliable synchronization

**Outcome:** Real enrolled devices can commit explicitly permitted local cash work, retain evidence and replay exactly once within grants and allocations.

**Exit gate:** 100-sale blackout suite, five replays, arbitrary restart, migration, grant expiry/revocation and cross-device recovery all pass.

**Planning effort:** 16–31 developer-days across 8 tickets.

#### S09-01 · Issue signed bounded offline cash grants

**Priority:** P1 · **Size:** L · **Owner function:** Offline/security · **Depends on:** S02-04,S03-06,S04-02,S08-06

**Implementation anchors:** `grant schema/service; real device keys; command manifest`.

**Acceptance:** Grant binds tenant/outlet/operator/device key, allowed commands, expiry, amount/quantity/sequence exposure and allocation. Server fences revocation and validates replay. Design expiry-during-outage and account/room/M-Pesa restrictions explicitly. Stolen/copied grant, wrong device, expired limit and clock manipulation cannot grant unlimited authority.

#### S09-02 · Build versioned durable local projections and quota controls

**Priority:** P1 · **Size:** L · **Owner function:** Offline/storage · **Depends on:** S09-01

**Implementation anchors:** `IndexedDB schema/migrations; storage health; PWA boot`.

**Acceptance:** Atomic migration of actor/outlet projections, grants, counters, drafts and pending cash evidence with reopen/versionchange/blocked handling. Request persistence where supported and monitor quota. Crash at every boundary, two tabs and application upgrade preserve committed local evidence; lack of durable storage disables offline finalization.

#### S09-03 · Commit permitted local cash sales with truthful receipt status

**Priority:** P1 · **Size:** XL · **Owner function:** Offline/commerce · **Depends on:** S09-02

**Implementation anchors:** `local transaction kernel; POS; local receipt; shift evidence`.

**Acceptance:** Persist immutable command, sequence, stock allocation and cash evidence atomically before locally confirmed message. Mark receipt locally issued/pending sync and keep original identity. Safe limits enforced before acceptance. Local committed sale survives reboot; no claim of server/provider confirmation and no offline unrestricted credit/room settlement.

#### S09-04 · Replay exact commands in dependency order

**Priority:** P1 · **Size:** L · **Owner function:** Sync/domain · **Depends on:** S09-03

**Implementation anchors:** `sync endpoint; sequence/ack contracts; idempotent command kernel`.

**Acceptance:** Original IDs, payload hashes and device sequence survive retries. Same command replay five times creates one source/payment/journal; gaps/out-of-order/revoked grant produce explicit reconciliation outcomes. Maintain cash collected even when server replay conflicts. Version protocol and support the preceding released client during upgrade.

#### S09-05 · Publish an authorized durable change feed and cursors

**Priority:** P1 · **Size:** M · **Owner function:** Sync/API · **Depends on:** S09-04

**Implementation anchors:** `outbox/feed read model; cursor contracts; local projection apply`.

**Acceptance:** Feed is tenant/outlet/role scoped; cursor advances only after durable local apply. Resuming/repeating a page cannot miss or double apply an event. Handle permission removal, pagination, tombstones/redactions and retention reset explicitly. Protect cost/PII fields from unauthorized projections.

#### S09-06 · Operate retries, dead letters and sync diagnostics

**Priority:** P1 · **Size:** M · **Owner function:** Worker/operations · **Depends on:** S09-05

**Implementation anchors:** `outbox worker; job state; admin diagnostics; alerts`.

**Acceptance:** Worker claims jobs safely, retries with bounds/backoff and preserves stable external-effect IDs. Poison event/dead letter visible and recoverable with audit. No irreversible network/print effect inside a retried DB transaction. Measure oldest unprocessed event and command outcome backlog.

#### S09-07 · Recover device loss/export and multi-device conflicts

**Priority:** P1 · **Size:** L · **Owner function:** Recovery/security · **Depends on:** S09-02,S09-04

**Implementation anchors:** `encrypted recovery package; fence/re-enroll; allocation resolution`.

**Acceptance:** Quota/IndexedDB loss/private browsing/expired grant produce actionable states. Export contains required pending evidence without reusable authentication secrets; restore on another enrolled device is fenced until authorized. Two devices cannot both spend one exclusive allocation. Recovery never erases collected local cash to make sync green.

#### S09-08 · Pass the 100-sale blackout and replay suite

**Priority:** P1 · **Size:** L · **Owner function:** QA/business · **Depends on:** S09-06,S09-07

**Implementation anchors:** `real installed-PWA acceptance; failure injection; audit controls`.

**Acceptance:** 100 permitted cash sales, arbitrary refresh/restart, interrupted local migration and sync, repeated replay, expired/revoked grants and two competing devices. Reconcile local/server sales, stock, cash, journal and print identities exactly with zero unexplained duplicates/loss. Record supported outage length and limits on actual accepted hardware.

### S10 — Finish performance, hardware and production operation

**Outcome:** Complete history remains usable on accepted network/hardware; physical printing, real PWA upgrades, alerts and restoration have evidence.

**Exit gate:** Performance/error/physical matrix, scheduled backup/key recovery and production failure drills accepted with explicit supported profiles.

**Planning effort:** 7.5–15 developer-days across 7 tickets.

#### S10-01 · Meet measured cold/warm and distinct-operator performance budgets

**Priority:** P1 · **Size:** L · **Owner function:** Performance/API/UI · **Depends on:** S00-04,S00-05,S08-07

**Implementation anchors:** `requestMetrics; performance fixtures/scripts; catalog/report reads; bundles/Nginx`.

**Acceptance:** Separate DNS/TLS/TTFB/transfer/render/DB/pool and installed-PWA paths. Rerun representative 5,000-item/customer/order, 40,000-movement, 501-staff and 1,200-reservation workloads with distinct operators. Agree reference network/device; warm workspace p95 ≤3s and common reads ≤1.5s are initial ceilings, cold target separately recorded. No latency pass achieved by hiding rows.

#### S10-02 · Finish complete error-state and real PWA-upgrade acceptance

**Priority:** P1 · **Size:** M · **Owner function:** UI/PWA/QA · **Depends on:** S10-01,S09-08

**Implementation anchors:** `AppShell; apiClient; SW lifecycle; all reachable workspaces`.

**Acceptance:** Inject 401/403/409/429/500, timeout, malformed JSON and interrupted body per workspace. Old results keep old scope labels; retry is safe and unknown mutations retain IDs. Real service-worker upgrade/reconnect preserves drafts and pending local cash; old API/new UI compatibility is explicit. Accessibility of loading/recovery states is verified.

#### S10-03 · Connect printer profiles and immutable copy semantics

**Priority:** P1 · **Size:** M · **Owner function:** Hardware/UI · **Depends on:** S04-04,S07-05,S09-03

**Implementation anchors:** `BackendReceiptModal; receipt/print contracts; selected browser/kiosk path`.

**Acceptance:** Selectable accepted 58/80mm printable width/margins, logo/QR/footer ordering and copy/document hash/reference. Print retry never resettles payment; browser dialog cannot claim paper success. Stable job/copy policy for local/server receipt and offline receipt reconciliation. Silent agent remains optional unless a chosen device profile requires it.

#### S10-04 · Accept actual Windows POS/tablet/scanner/printer profiles

**Priority:** P1 · **Size:** M · **Owner function:** Hardware/QA · **Depends on:** S10-03,S06-06

**Implementation anchors:** `physical test matrix; printer/scanner instructions; print failure runbook`.

**Acceptance:** Test actual AIO/Windows 80mm printer and selected tablet/browser profiles, not screenshots alone. Rapid barcode/unknown/repeated scan, cutter, paper end, QR readability, interrupted queue, reprint and driver restart accepted where supported. Mark untested hardware HARDWARE_PENDING; do not block universal print on an optional agent.

#### S10-05 · Automate recoverable backups and alerting

**Priority:** P0 · **Size:** M · **Owner function:** Operations/security · **Depends on:** S00-01

**Implementation anchors:** `Backup-Mazao.ps1; BACKUP-RUNBOOK; off-host storage; recovery secrets`.

**Acceptance:** Automated encrypted off-host backup with retention/freshness/failure alerts and independently recoverable key procedure. Rehearse from a second recovery context and record actual RPO/RTO/control totals. Preserve documented successful restores while resolving current coverage gaps; require fresh pre-release checkpoint. Scope plaintext cleanup to exact owned artifacts under authorized workflow.

#### S10-06 · Make production observable and bounded under failure

**Priority:** P1 · **Size:** M · **Owner function:** Operations/platform · **Depends on:** S09-06,S08-06

**Implementation anchors:** `server shutdown; db pool/query/lock timeouts; logging/alerts; health`.

**Acceptance:** Correlate deployment/request/command IDs without secrets; alert on 5xx/latency/pool/locks/disk/backup/dead letters/reconciliation failures. Define query/lock/transaction limits and graceful shutdown/drain; timeout preserves unknown-command recovery. Exercise blocked DB, slow reader and process restart without false confirmed outcome or lost diagnostics.

#### S10-07 · Finish reproducible dependency and supply-chain controls

**Priority:** P1 · **Size:** S · **Owner function:** Platform/security · **Depends on:** S00-02

**Implementation anchors:** `package.json; bun.lock; Dockerfile; CI; archived components`.

**Acceptance:** Document/pin supported runtime/toolchain and use frozen installs for releases. Review dependency/security scan results without speculative version upgrades. Separate or remove unreachable prototype authority with boundary tests. Extract large modules only behind accepted contracts; avoid a framework rewrite or cosmetic refactor blocking business completion.

### S11 — Accept and release full v1

**Outcome:** One exact candidate passes every required workflow/security/physical/restore gate and survives representative business use.

**Exit gate:** All A–H suites and viewport matrix pass; exact artifacts activated with required authorization; pilot has no unresolved blockers.

**Planning effort:** 4.5–9 developer-days across 5 tickets.

#### S11-01 · Run full A–H end-to-end and adversarial matrix

**Priority:** P1 · **Size:** M · **Owner function:** QA/business · **Depends on:** S08-07,S09-08,S10-02

**Implementation anchors:** `docs/15; API/DB/browser acceptance; traceable fixtures`.

**Acceptance:** A first use; B counter; C stock; D hotel; E finance; F security; G offline; H infrastructure all pass on one exact candidate. Include tenant swaps, stale/reused approvals, competing sale/count/room/period close, malformed CSV and unknown outcomes. No suite skipped because the feature is unfinished; reconcile all money/stock controls.

#### S11-02 · Accept every documented viewport and assistive workflow

**Priority:** P1 · **Size:** M · **Owner function:** UI/accessibility · **Depends on:** S11-01,S10-04

**Implementation anchors:** `all reachable screens; shared dialogs/forms; role navigation`.

**Acceptance:** 1024×600,1280×720,1280×800,800×1280,1366×768,1920×1080,390×844. Keyboard/focus/dialog escape, screen reader names/status/errors, touch/scanner, reduced motion and 44px primary targets accepted with appropriate roles. Confirm/pay/post remains reachable on short screen; no cost/admin data leaks through hidden content.

#### S11-03 · Rehearse fresh install, upgrade, rollback and restore

**Priority:** P1 · **Size:** M · **Owner function:** Platform/operations · **Depends on:** S11-01,S10-05,S10-06

**Implementation anchors:** `migration runner; activate-release.sh; API/static artifacts; restore scripts`.

**Acceptance:** Fresh install and supported previous-release upgrade+rereun pass. Roll back API/static only where forward schema compatibility is proven; never reverse posted business history. Restore latest checkpoint to isolated environment and compare financial/subledger/stock/guest totals. Protect unrelated VPS services with before/after inventory and scoped commands.

#### S11-04 · Produce immutable release manifest and live acceptance record

**Priority:** P1 · **Size:** S · **Owner function:** Lead/release · **Depends on:** S11-02,S11-03

**Implementation anchors:** `CI artifacts; image digest; manifest/checksums; release notes`.

**Acceptance:** Record exact SHA/API digest/static hashes/schema checksums/test evidence/hardware matrix/known limitations/restore proof. Obtain required production authorization only after package is concrete and reviewable. Activate only accepted artifact; verify readiness, versions, assets, protected services and real operator workflow without invented live test transactions.

#### S11-05 · Complete pilot observation and close the v1 register

**Priority:** P1 · **Size:** M · **Owner function:** Business/support · **Depends on:** S11-04

**Implementation anchors:** `operator guides; support handover; acceptance register; incident log`.

**Acceptance:** Observe at least three representative full trading days including busy shift, return/credit collection, stock task, guest lifecycle and daily/period review. Every blocking incident has reproduced root cause and regression evidence. Owner signs documented supported business/hardware/offline limits. Close v1 only when every required ticket/gate is accepted; move explicitly deferred enhancements to a separate backlog.

## 7. Capacity, first actions and scope control

The backlog contains **79 tickets**. First-pass summed effort is **104.5–208 developer-days** before review/waiting/production observation or contingency. This is work effort, not an elapsed-date commitment; tasks overlap only when dependencies, ownership and test environments permit. The offline kernel, package/recipe valuation and mixed refund allocations have the most estimation uncertainty.

| Sprint | Developer-day range | Outcome dependency |
| --- | ---: | --- |
| S00 | 7.5–15 | Trust the baseline and remove recovery/history dead ends |
| S01 | 9.5–19 | Make catalog and stock counts usable in daily trading |
| S02 | 7.5–15 | Finish business, outlet, device and approval authority |
| S03 | 12–24 | Finish real inventory and cost semantics |
| S04 | 9–18 | Complete counter payments and corrections |
| S05 | 6.5–13 | Complete purchasing and supplier accounts |
| S06 | 6.5–13 | Deliver a complete restaurant and bar shift |
| S07 | 9–18 | Deliver the full guest lifecycle |
| S08 | 9–18 | Make finance and reports complete for supported operations |
| S09 | 16–31 | Deliver bounded offline cash and reliable synchronization |
| S10 | 7.5–15 | Finish performance, hardware and production operation |
| S11 | 4.5–9 | Accept and release full v1 |


At five focused developer-days per week, raw effort is approximately 21–42 solo development weeks; interruptions, review and support add time. Do not turn two developers into an automatic 2× speed claim because financial/stock schema work is sequential. Re-estimate after S00/S01 using actual cycle time. A useful working budget reserves 20–30% of capacity for defects/integration rather than filling every sprint with new features.

R1 can be released incrementally before full v1, using only explicitly accepted online workflows. If the business needs an earlier rollout, agree a named capability cohort and retain missing v1 work as open; do not call a narrower pilot the completed product.

### First two working days — start in this order

1. Create a branch from the audited main (refresh SHA first if new commits arrived), preserve existing release evidence and record a clean baseline. Reproduce any current live count rejection using its actual request/command ID and deployed SHA; do not guess from an old PR title.
2. Land the narrow malformed-login/envelope validation correction and its negative tests. Keep generic errors controlled without exposing internals.
3. Specify and begin credential request fencing, including delayed-original-request race acceptance; do not add a UI “clear pending” workaround.
4. Deliver one complete pagination vertical slice, preferably stock movements plus exception-resolution evidence, then use the accepted contract for the other capped lists.
5. Start count conflict/review and service classification design against the actual product catalog. Preserve existing quantities and value until the reviewed reclassification rule is implemented.
6. Confirm actual deployment/schema identity and scheduled backup ownership read-only. Assemble any release package and acceptance evidence before asking for required production activation authorization.

These are priorities for the next development execution, not claims that the full six-ticket S00 package fits into two days.

### Required business-policy choices and proposed defaults

Resolve these in the relevant sprint without blocking unrelated engineering. Record approval in versioned configuration/specification before posting live business events.

| Choice | Proposed starting policy | Why it affects implementation |
| --- | --- | --- |
| Count during trading | Explicit controlled count session initially; movement-aware rebase only with reviewed changed lines | Prevents unexplained overwrite while reducing repeated full recounts |
| Service/nonstock legacy items | Reviewed reclassification with linked quantity/value evidence | Existing “stay” stock cannot simply disappear |
| Discounts | Retain whole-line fixed amount; add business limit and single-use supervisor approval above it | Avoids changing the user's already agreed discount semantics |
| M-Pesa | Cashier/manual confirmation and statement matching; no claim of provider verification | Keeps accepted manual flow and separates automated integration |
| Returns | Return to original approved tender allocation; manual noncash evidence; explicit credit/restock approval | Prevents cash payout for a noncash sale and phantom stock |
| Recipes | One declared consumption boundary, with prepared cancellation recorded as waste where applicable | Prevents duplicate or missing ingredient consumption |
| Hotel revenue/deposits | Deposits remain liabilities until earned/applied; explicitly choose daily/night posting policy | Period closure and guest balance must agree |
| Offline | Cash counter sales only under signed grant, storage/device health, exposure/allocation limits | Rooms, unrestricted credit, administration and provider settlement remain online unless separately accepted |
| Finance coverage | Support actual v1 source types plus approved basic adjustments; advanced payroll stays deferred | “Complete” reporting needs recorded source coverage, not a new label |
| Hardware | Universal print dialog and accepted terminal profiles first; silent agent only if required | Avoids an optional agent delaying core operational acceptance |

### Explicitly defer beyond full v1

Automated M-Pesa/provider settlement integration; eTIMS certification/integration; loyalty; public booking engine; advanced payroll; native business apps; AI insights; reseller/subscription billing; sophisticated revenue management; advanced forecasting. The minimal asset/custody/maintenance workflow, ordinary restaurant/hotel operations and bounded offline cash remain inside this documented v1.

## 8. Release acceptance matrix and evidence pack

| Suite | Required business proof | Failure cases that must be included | Completion tickets |
| --- | --- | --- | --- |
| A — first use | Empty tenant→outlet→stock import/setup→staff/device→first sale→receipt→close | Duplicate setup, missing tax review, unauthorized setup, lost password acknowledgement | S00–S02, S11 |
| B — POS | Fast barcode sale, mixed tax/tender, discount/void/refund, credit collection, held basket | Rapid repeated scan/pay, stale quote, duplicate reference, partial return remainder, response loss | S04, S10–S11 |
| C — inventory | Packages, sealed/open, recipes, count, transfers, waste and valuation | Count vs sale/receipt; changed package; unknown barcode; repeated transfer; concurrent resolution | S01,S03,S05,S06 |
| D — hotel | Availability race, deposit, stay/folio, room food charge, partial/mixed checkout, cleaning | Same-room race, timezone/calendar, overpayment/refund, move/extend overlap, closed date | S07 |
| E — finance | Every posted source balances and traces; AR/AP/stock/guest/control reconciliation; periods | Backdated ordinary post, competing close/post, duplicate credit/payment, missing source and unknown mapping | S04–S08 |
| F — security | Tenant/outlet/role/device/approval isolation and safe malformed input | Tenant ID swap, escalated roles, revoked device/grant, expired/reused approval, malicious CSV, status/replay scope | All sprints |
| G — offline | 100 accepted local cash sales, restarts, interrupted sync and repeated replay | Quota, storage loss, two tabs/devices, expiry/revocation, migration interruption, recovery import | S09 |
| H — operations | Fresh deployment, upgrade, compatible API/static rollback, isolated latest restore | DB lock/outage, wrong artifact/checksum, failed readiness, expired recovery credential, unrelated stack preservation | S10–S11 |

Every release candidate needs:

- Version manifest: commit SHA, immutable API image digest, static hashes, migration names/checksums, API/client protocol compatibility and supported prior client.
- Exact-head CI plus populated fixture controls and real API/DB/browser acceptance. No skipped mandatory suite and no broad “all tests passed” statement from a no-database subset.
- Role/capability, seven-viewport and assistive-input matrix; actual device/printer/scanner profiles and any explicit HARDWARE_PENDING state.
- Report catalogue with completeness/timezone/scope/export checks; every subtotal traceable to immutable source.
- Fresh encrypted off-host backup, independently available recovery keys, isolated restore/control totals, measured recovery time and scoped rollback procedure.
- Unknown-command/local-cash backlog review, write fencing/rollback decision and pre/post protected-service inventory.
- Documented owner acceptance of supported business scope and any temporary exception with expiry/owner. A historical exception does not silently waive the final full-v1 gate.

Suggested ticket closure record:

```text
Ticket and operator outcome:
Commit/PR and migration:
Authority/capability/approval boundary:
Source/payment/stock/journal effects:
Original-ID replay / unknown outcome evidence:
Tests run and exact observed results:
Fresh / upgrade / rerun compatibility:
Views/roles/hardware exercised:
Performance/report completeness:
Known limits and next dependency:
Exact CI artifact SHA:
Production state: not deployed | activated with linked evidence
```

## 9. Completion rule

Mazao v1 is complete when every in-scope operator journey works from setup to correction/reconciliation, all declared offline/hardware paths have acceptance evidence, all A–H gates pass on one exact artifact and the supported business has accepted representative operation. Green CI, deployed health and a polished screen are individual evidence points, not substitutes for that result.

## 10. Source index

All main links below are pinned to audited SHA. Branch-only release evidence is separately pinned so it cannot be mistaken for main content.

- [docs/01-PRODUCT-PRD.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/docs/01-PRODUCT-PRD.md)
- [docs/04-DOMAIN-MODULES.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/docs/04-DOMAIN-MODULES.md)
- [docs/15-TESTING-ACCEPTANCE.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/docs/15-TESTING-ACCEPTANCE.md)
- [agents/AGENTS.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/agents/AGENTS.md)
- [apps/api/src/app.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/app.ts)
- [apps/api/src/commands.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/commands.ts)
- [apps/api/src/credentials.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/credentials.ts)
- [apps/api/src/commandAuthorization.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/commandAuthorization.ts)
- [apps/api/src/contracts.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/contracts.ts)
- [apps/api/src/staff.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/staff.ts)
- [apps/api/src/customerAccounts.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/customerAccounts.ts)
- [apps/api/src/productImport.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/productImport.ts)
- [apps/api/src/stockShortfalls.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/stockShortfalls.ts)
- [apps/api/src/accounting.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/accounting.ts)
- [apps/api/src/accountCatalog.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/accountCatalog.ts)
- [apps/api/src/financeReports.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/financeReports.ts)
- [apps/api/src/controlReports.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/src/controlReports.ts)
- [apps/api/migrations/019_accounting_controls.sql](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/migrations/019_accounting_controls.sql)
- [apps/api/migrations/021_confirmed_stock_exception_sales.sql](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/apps/api/migrations/021_confirmed_stock_exception_sales.sql)
- [src/app/featureRegistry.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/src/app/featureRegistry.ts)
- [src/App.tsx](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/src/App.tsx)
- [src/components/auth/PasswordOperationPanel.tsx](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/src/components/auth/PasswordOperationPanel.tsx)
- [src/components/inventory/BackendStockCountWorkspace.tsx](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/src/components/inventory/BackendStockCountWorkspace.tsx)
- [src/components/procurement/ProcurementWorkspace.tsx](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/src/components/procurement/ProcurementWorkspace.tsx)
- [src/components/hardware/BackendReceiptModal.tsx](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/src/components/hardware/BackendReceiptModal.tsx)
- [src/services/commandJournal.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/src/services/commandJournal.ts)
- [src/services/secretOperationJournal.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/src/services/secretOperationJournal.ts)
- [playwright.browser-matrix.config.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/playwright.browser-matrix.config.ts)
- [playwright.integration.config.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/playwright.integration.config.ts)
- [vite.config.ts](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/vite.config.ts)
- [infra/activate-release.sh](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/infra/activate-release.sh)
- [infra/BACKUP-RUNBOOK.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/infra/BACKUP-RUNBOOK.md)
- [docs/43-LOADING-STAFF-BUILDOUT-STATUS-2026-10-16.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/docs/43-LOADING-STAFF-BUILDOUT-STATUS-2026-10-16.md)
- [docs/44-PERFORMANCE-ACCEPTANCE-2026-10-18.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/docs/44-PERFORMANCE-ACCEPTANCE-2026-10-18.md)
- [docs/45-PRODUCTION-RELEASE-2026-10-18.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/docs/45-PRODUCTION-RELEASE-2026-10-18.md)
- [docs/46-POS-PAYMENTS-REPORTING-REMEDIATION-2026-10-18.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/docs/46-POS-PAYMENTS-REPORTING-REMEDIATION-2026-10-18.md)
- [docs/47-CONFIRMED-STOCK-EXCEPTION-SALES.md](https://github.com/davemusau00/mazao-erp-v1/blob/6119ee2d2043afca38b764b5a0750dd9cf75908c/docs/47-CONFIRMED-STOCK-EXCEPTION-SALES.md)
- [19 October release evidence on unique commit 01d13de](https://github.com/davemusau00/mazao-erp-v1/blob/01d13de23300cd2850f0b6284af00feddfbf8e89/docs/47-PRODUCTION-RELEASE-2026-10-19.md)
- [Exact-main CI run 39417548593](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39417548593)
- [Open PR #13](https://github.com/davemusau00/mazao-erp-v1/pull/13), [#14](https://github.com/davemusau00/mazao-erp-v1/pull/14), [#15](https://github.com/davemusau00/mazao-erp-v1/pull/15), [#16](https://github.com/davemusau00/mazao-erp-v1/pull/16) — patches already present/equivalent on audited main
