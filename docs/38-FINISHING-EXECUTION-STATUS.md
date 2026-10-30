# Product finishing execution status

Started **16 October 2026, Africa/Nairobi**. The active objective is full execution of [the finishing audit](32-PRODUCT-FINISHING-AUDIT-2026-10-16.md) while preserving [the UI parity specification](../MAZAO_UI_PARITY_RESTORATION_SPEC.md). This file records progress; it does not narrow the full v1 objective or authorize production activation.

**Superseding checkpoint, 20 October:** the dated integration/CI statements below are historical. Fetched main `6119ee2` has successful exact-head CI; `feat/codebase-truth-s00` preserves that source and the 19 October release evidence while implementing the new completion plan. [The current execution register](48-CODEBASE-TRUTH-EXECUTION.md) records the actual worktree, local acceptance and remaining release gates. Current live identity has not been reverified. F08 below is updated to its new migration-022 implementation.

## 16 October checkpoint (historical)

The integration branch is `feat/product-finishing`. Focused fixes are committed on separate branches/worktrees and brought into the local integration branch for combined verification. The user confirmed an accidental push of integration commits to `main`; those commits are preserved. Main's failed CI must be repaired before claiming a release-ready baseline. No deployment, hosted database mutation or protected shared-server change has occurred.

| Audit item | State | Current evidence / remaining work |
| --- | --- | --- |
| F01 login throttle | Implemented; review/CI pending | `fix/login-runtime-guard`, draft [PR #13](https://github.com/davemusau00/mazao-erp-v1/pull/13). Actual route and production Bun image enforce request nine as 429 with Retry-After; bounded explicit ingress trust. |
| F02 mixed counts | Implemented; review/CI pending | `fix/mixed-stock-count`, draft [PR #14](https://github.com/davemusau00/mazao-erp-v1/pull/14), docs/34. Seven focused PostgreSQL cases, eight including legacy regression; two real count/recovery browser journeys. |
| F03 hotel calendar | Implemented; review/CI pending | `fix/hotel-calendar-dates`, draft [PR #16](https://github.com/davemusau00/mazao-erp-v1/pull/16), docs/36. Three real database runtime/outlet timezone combinations and two desktop/mobile browser journeys. |
| F04 password target isolation | Implemented; review/CI pending | `fix/account-self-service`, draft [PR #15](https://github.com/davemusau00/mazao-erp-v1/pull/15), docs/35. Secret fields/session state reset by target; active requests block dismissal/target navigation. |
| F05 recovery readiness | Implemented locally | `cda5396`, integrated as `c40d54b`, docs/37: receiving/count/hotel/shift fail-closed readiness, synchronous submission/status locks, retained envelopes and retryable storage errors. Fourteen focused browser cases and one real count recovery journey passed. |
| F06 runtime and governance | Runtime implemented; governance open | Required key/origin validation plus real container negative/positive acceptance in PR #13. GitHub branch protection/review/release controls still need explicit configuration and verification. |
| F07 reachable My account | Implemented; review/CI pending | PR #15. Seven new mocked account browser cases, full suite 31/31, one real PostgreSQL cashier password/session journey. |
| F08 never-received credential recovery | Implemented and locally verified on 20 October; release pending | S00-03 now supplies migration **022** and metadata-only reconciliation in `feat/codebase-truth-s00`; see [docs/50](50-CREDENTIAL-OPERATION-FENCING.md). This supersedes the earlier unfinished branch/migration-017 proposal. Original-ID fencing, late arrival, current authority, upgrade/rerun, lost response and malformed terminal acknowledgements are tested. No password or replayable password body is retained; a 404 alone never clears metadata. |
| F09 statement snapshot | Implemented locally | `fix/customer-statement-snapshot` commit `377f288`, integrated as `def0c6c`, docs/39. Six focused real database cases, deterministic interleaved sale/repayment, one real browser statement/repayment journey. |
| F10 recovery authorization | Implemented locally | `65d390b`, integrated as `16734ac`, docs/40: shared current authority and original actor/outlet scope for status/replay; original assignment required for exact generic replay. Eight focused cases, 76 API cases and ten real browser journeys passed on its source branch. |
| F11 tenant staff names | Implemented locally | `adde772`, integrated as `9a4bf8c`, docs/42: current tenant names for session/new sales/Z reports; immutable order/close-report snapshots for historical evidence. Cross-tenant and rename cases reproduced red then passed 2/2; existing staff/PostgreSQL regression 9/9. Other actor-name projections remain a documented follow-up. |
| F12 count draft/navigation | In progress | Unsaved-count/in-flight departure guards implemented in F05. `fix/access-recovery-routing` adds permission/actor/tenant/assignment checked Manage sections and original target/command selection; browser regression running. |
| F13 no-database test startup | Implemented locally | `edf46fe`: defer analytics DB imports until integration is enabled, close pool afterward. No-DB API run 38 pass / 0 fail / 9 skips before other new test additions. |

## Verification checkpoint

The first integrated source, including login/count/account/hotel fixes, passed UI/API typecheck, production PWA build, **78/78 API/database tests with serial test-file execution**, and **15/15 real browser/API/PostgreSQL journeys**. That browser run includes existing setup/CSV/cash-close and new account/count/hotel/login behavior. The account branch separately passed its full **31/31 mocked browser suite**. These are scoped implementation results, not full v1 acceptance.

Default concurrent API files on the shared fixture database failed locally **76/78** and in hosted checks on the 1,000-row import because unrelated suites created SERIALIZABLE read/write dependencies. No application isolation or retry limit was weakened. `fix/api-test-isolation` commit `9b29e56` introduces a fresh migrated localhost database per Node test process; its default API command passed **78/78, zero failures/skips, 48.2 seconds**, with deliberate within-file transaction races still concurrent. Without PostgreSQL configuration it passed **43 tests with 11 explicit database skips**. Details: [database isolation](41-API-TEST-DATABASE-ISOLATION.md) after that commit is integrated. Exact hosted CI for the repaired harness remains required.

The integration source including F09 subsequently passed **84/84 default concurrent API cases** and **31/31 mocked browser cases**. After F05/F10/F11 integration, a new combined run was interrupted by the disposable server being unavailable during crash recovery; it is not a source regression pass. Updated PR #17 also exposed a scratch-database teardown race on hosted Linux Node 22: `Pool.end()` resolved before socket shutdown, and `DROP DATABASE WITH (FORCE)` caused uncaught SQLSTATE 57P01. A Linux reproduction observed this in 3/30 cycles. Commit `a883e5a` uses a dedicated PostgreSQL Client and ordinary DROP in both upgrade fixtures; both upgrade cases passed with their assertions intact. Exact hosted CI and a fresh combined integration run remain required.

Catalog maintenance is in progress on `feat/catalog-maintenance`: versioned direct edits, category/barcode/reorder fields, archive/restore, stale quote protection and immutable historical evidence. This is one milestone-1 slice; category master administration, packages, locations and operational setup remain open.

Local Docker was started successfully. Task-owned test PostgreSQL 16 containers are `mazao-finishing-pg-20261016` (loopback 55436) and `mazao-stock-count-pg-20261016` (55437, memory-backed data). Both passed fresh migrations 001-016 and checksum-safe reruns. Other existing containers were neither restarted nor removed. Generated `mazao_api_<uuid>` databases stay inside the disposable test server for diagnosis and are removed only with its owned lifecycle.

Current screenshots are test artifacts in each worktree's `test-results/`. Account captures at 390x844, 1024x600 and 1280x720 and hotel captures at 390x844/1024x600 were inspected. Existing OLED design, readable labels, scrollable account dialog and 44px account controls are retained. Full approved-original parity, all module/viewports, assistive technology, physical hardware, installed-PWA updates and production performance remain unverified.

## Remaining full objective

Milestone 0 is **not complete** until all urgent findings and their actual acceptance gates are satisfied. Following it, retain every audit milestone:

1. Complete business provisioning, outlets/switching, catalog edit/archive/categories/barcodes, package/unit semantics, locations/transfers/waste and reviewed go-live.
2. Complete counter workflows: manual M-Pesa evidence, split tender, held baskets, discounts/void approvals, linked credit/noncash reversals, AR aging/controls and tender/tax/Z reports.
3. Supplier/PO/delivery/invoice/AP/partial settlement, expenses/COA mappings and period controls.
4. Restaurant tables/tabs/modifiers/stations/fire/fulfillment/splits/settlement, recipes/yield/sealed/open consumption.
5. Hotel rate/availability/deposit/folio/service/POS charges/partial settlement/reversal/statements, extensions/moves and complete housekeeping/holds.
6. Assets and supported financial statements/source/subledger/valuation reconciliation/scoped exports.
7. Signed offline grants, real device identity, bounded allocations/exposure, local cash evidence, feed/replay/fencing/storage recovery and worker operations.
8. All acceptance suites A-H, full role/viewport/accessibility/PWA/hardware/performance matrix, monitored independent backup/key recovery/restore, exact release artifacts, rollback and business acceptance.

Each slice remains independently reviewable and must carry exact commands/results, permissions, transaction/recovery/invariant evidence, migration compatibility and honest UI availability. No discovered shell, type, screenshot or green subset can be used as proof that a remaining milestone is complete.
