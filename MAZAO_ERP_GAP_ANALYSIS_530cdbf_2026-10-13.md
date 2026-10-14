# MAZAO ERP V1 — Updated Repository Gap Analysis

**Audit date:** 13 October 2026 (Africa/Nairobi)  
**Repository:** https://github.com/davemusau00/mazao-erp-v1  
**Audited branch:** `main`  
**Audited SHA:** `530cdbf189de3e816749d00ce3bb184b9b1340b3`  
**Previous audit SHA:** `47457db633a4a71f207f6d162c7fde9601bb1ace`  
**Comparison:** 2 commits ahead, 111 tracked files (previously 105), 12 server command types (previously 5).  
**Latest CI:** Success, https://github.com/davemusau00/mazao-erp-v1/actions/runs/38455212343; Bun install, TypeScript check, five small API/boundary tests, Vite build.  
**Method:** Read GitHub repository tree, commit comparison, selected application/domain/schema/UI source files, integration register, API test suite, and workflow run jobs. **No live PostgreSQL migration, full API transaction suite, browser E2E, deployment, or printer test was executed by this audit.** Static defects are categorized as confirmed in source; behavioral consequences are predicted until runtime tests verify them.

## Remediation recheck (13 October 2026)

The source remediation is in commit `a1625452e30126acdba37c10acb8dfd4456d0d59`; the current worktree also contains an expanded, uncommitted PostgreSQL acceptance test. GitHub Actions run [38458774590](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38458774590) failed in that committed test version because it expected quantity `0` while PostgreSQL correctly returned the canonical decimal string `0.000000`. The log shows fresh migrations, authenticated login, catalog read and canonical command replay succeeded before that assertion. The expected value is corrected in the current worktree, which also adds sale/receive/refund/shift-close, journal-balance, tenant-isolation and reservation-contention assertions; that expanded version has not run in CI yet.

| Finding | Current source status | Remaining proof / limitation |
|---|---|---|
| G-00 wrong order status constraint name | Addressed without editing migration 003: the migration runner normalizes the legacy generated constraint name before applying an unapplied 003. | Fresh PostgreSQL migration succeeded in CI run 38458774590; the overall run failed later on a quantity-string test assertion. |
| G-01 missing hospitality schema | Addressed without editing migration 004: the runner creates `hospitality` before applying an unapplied 004. | Fresh PostgreSQL migration succeeded in CI run 38458774590; upgrade-from-003 remains untested. |
| G-02 catalog product join | Fixed to join `inventory.balances.product_id` to `catalog.products.id`. | Authenticated catalog read succeeded in CI run 38458774590. |
| G-03 server POS demo fallback | Signed-in checkout now blocks when server catalog state is unavailable; the local `processSale` path runs only without a server session. | Browser/API failure-transition acceptance is still pending. |
| G-04 command replay shape | Exact replay now returns the stored canonical response shape instead of nesting it under `response`. | Exact replay passed in CI run 38458774590 before the later quantity assertion failed. |
| G-05 PostgreSQL acceptance | CI provisions PostgreSQL, applies migrations twice, and runs authenticated catalog/replay plus sale, refund, shift, journal, tenant-isolation, reservation-contention and supported hotel-lifecycle acceptance. The local suite now also covers paid-in/payout and cashier payout denial. | CI run 38458774590 still records the historical failure at the old quantity expectation. On 14 Oct, the corrected suite passed locally against a disposable PostgreSQL 16 database: 9 passed, 0 failed, 0 skipped. CI has not rerun the corrected suite. |
| G-06 serialization retries | `inTransaction` retries SQLSTATE `40001` and `40P01` up to three times with a short backoff; callbacks are documented as database-only. | PostgreSQL fault-injection acceptance raised each SQLSTATE through a server-side `DO` block, confirmed one retry, and confirmed failure after the third repeated `40001`. Real SSI/deadlock contention is not covered by this fault-injection check. |
| G-07 reservation contention | Reservation create/cancel advances the locked room version in the serializable transaction; the integration test races two overlapping commands. | Competing overlapping reservation acceptance passed locally on 14 Oct. No database exclusion constraint exists; rely on versioned room writes and transaction retries. |
| G-08 hotel operator integration | Server room, reservation, stay and housekeeping workspace is wired into Hotel and Reservations; server Today uses authenticated session/shift data. | PostgreSQL acceptance now covers reservation, check-in, rejected underpayment with no folio/cash side effect, cash checkout, balanced journal, settled folio, dirty room and ready transition. The test advances stay dates in SQL to simulate one elapsed night. Browser acceptance, deposits, add-ons, early checkout, split settlement and full folio remain out of scope. |
| G-09 till movements | `shift.cash.movement` records authorized paid-ins and payouts against an open, versioned shift; payouts cannot exceed expected drawer cash. The UI displays movement evidence and supports unknown-command status recovery. | The 14 Oct PostgreSQL suite verifies paid-in/payout balances, overdraw rejection and cashier denial. Movements post to clearing accounts; actual expense/supplier classification, reconciliation against counted cash, supervisor approval and a complete Z report remain absent. |
| G-15 server-mode local workflows | Navigation hides unsupported server modules; authenticated POS cannot post a local demo sale. | Role permissions remain coarse role maps and require broader authorization/security review. |

**Verification performed for this recheck:** `npm run typecheck` and `npm run build` pass. The rebuilt bundle includes the Stock workspace header and its actions. On 14 Oct, a new disposable PostgreSQL 16 database accepted migrations 001–009; a second run verified all checksums. `npm run test:api` passed 9 tests (0 failed, 0 skipped). Coverage includes full-outlet count draft/save/replay/permission/reason/post/journal/conflict/cancel; receipts at multiple costs; weighted-average COGS, movement values and balanced journals; partial-refund carrying-value restoration; role-scoped catalog/sales data; tenant rejection; paid-in/payout and shift close; reservation contention; SQLSTATE retry fault injection; hotel lifecycle; hostile print-helper input; and origin checks. Browser E2E, physical printer acknowledgement, production deployment and backup/restore were not verified.

## Integration follow-up (14 October 2026)

### Current checkout update

The supplied 14 October completion review estimates implementation at about 53%; this is a qualitative scope estimate, not test coverage. Hosted CI run 38544946257 passed for commit `448865f`, but it predates migration 010 and the finance report slice below.

| Finding | Current source status | Evidence and remaining boundary |
|---|---|---|
| G-14 tenant/outlet foreign keys | Migration 010 adds validated composite foreign keys for device assignment, shift operator, order shift/operator, order lines, payments, and journal lines. It fails closed when existing rows cross their tenant/outlet boundary. | On 14 Oct, migrations 001–010 applied to populated-upgrade and fresh PostgreSQL 16 databases; fresh migration checksums passed on rerun. Direct-SQL adversarial cases reject cross-tenant references. Hosted CI predates migration 010. Other actor/event references still need review. |
| G-20 authoritative reports | Read-only trial balance, partial operating summary, and journal-line drill-through routes are connected to a finance-view-only server workspace. | PostgreSQL acceptance verifies tenant scope, outlet-time-zone dates, integer-minor totals, journal balance checks, explicit incomplete coverage, account source drill-through, invalid-date rejection, and cashier denial. Period controls, complete P&L sources, AP/AR, full reconciliation, and inventory valuation reporting remain open. |

**Current verification (14 October):** `npm run typecheck`, `npm run build`, and `npm run test:api` pass; API result is 9 passed, 0 failed, 0 skipped against the task-owned PostgreSQL 16 database migrated through 010. CI has not run migration 010 or these report changes. Browser journeys, hardware output, deployment and backup/restore remain unverified.

The original audit date and SHA above remain the historical baseline. Follow-up work on the current branch expands the backend integration register to map each connected UI surface to its client methods, API routes, command records and remaining boundaries. Authenticated session responses carry server role permissions; navigation and connected workspace actions consume them rather than maintaining a second server role map. Catalog cost fields are returned only to `catalog.manage` or `finance.view`; order-line cost fields are returned only to `finance.view`. The receipt HTML helper escapes the dynamic text fields, including quantity, and restricts image sources to an allowlist.

| Finding | Follow-up source status | Evidence and limit |
|---|---|---|
| G-11 cost projection | API response projection is now role-scoped for catalog and sales history. | PostgreSQL acceptance now proves cashier catalog and order-line responses omit cost; an admin/finance session receives the projected costs. Passed locally on 14 Oct. |
| G-15 duplicated navigation roles | Login and `/auth/me` issue `user.permissions` from the API role map; server navigation and connected workspace actions consume that session value. | PostgreSQL acceptance verifies the cashier session includes `commerce.sell` and omits `catalog.manage`/`finance.view`. Server route and command authorization remain authoritative. Permissions are still coarse role maps rather than tenant-specific grants. |
| G-18 print HTML interpolation | Text interpolation is escaped; logo/QR sources are restricted; quantity is now escaped. Helper hostile-input coverage exists. | The 14 Oct API suite includes hostile text and unsafe-image assertions and passed. Browser print output and physical hardware acknowledgement were not tested. |
| G-19 production origin allowlist | Production API startup now requires exact `APP_ORIGINS` entries, and unsafe production requests without an allowed Origin are rejected. | Regression test verifies startup fails without configured origins, missing/disallowed origins return 403, and the exact allowed origin reaches route validation. Passed locally; no deployment was run. |
| G-12 inventory valuation / sale COGS | Added additive migrations 007–009 and accepted ADR 0006 for perpetual moving weighted-average valuation. Receipt, count, sale, and restocked refund commands now update carrying value; sale lines and movements retain exact extended COGS/value snapshots. | PostgreSQL acceptance uses receipts at two different unit costs, verifies historical movement/refund reconciliation and count shrinkage at the weighted average, checks sale COGS and journal, verifies cashier cost redaction, then proves partial-refund COGS restoration and movement-to-balance conservation. A complete valuation report, landed costs, and zero-stock count-gain review remain open. |

**Updated verification (14 October):** The current worktree passes `npm run typecheck` and the PostgreSQL API suite (9 passed, 0 failed, 0 skipped) against a fresh disposable PostgreSQL 16 database. Migrations 001–009 applied cleanly and a second run confirmed checksums. Count acceptance covers persistent full-outlet drafts, exact replay, incomplete-count and variance-reason rejection, storekeeper/manager permissions, balanced posting, stale-baseline conflict preservation and manager cancellation. Inventory acceptance receives stock at two costs, verifies carrying value and average-cost count shrinkage, posts a weighted-average sale COGS journal, confirms cashier cost redaction, and restores an exact partial COGS value on refund. Other coverage includes tenant isolation, shift cash movements/close, reservation contention, synthetic SQLSTATE retry faults, hotel lifecycle, hostile print-helper input and origin checks. SQLSTATE tests do not induce natural SSI/deadlock contention; the hotel test advances stay dates in SQL. Browser behavior, hardware output, deployment and restore readiness remain unverified. CI has not rerun this test version.

The broad integration request is **not complete**: server endpoints still do not exist for restaurant tickets, customer credit, full accounting/reporting, user/device administration, product imports or settings. The server now supports full-outlet stock counts and moving weighted-average carrying value; spot counts, locations, barcode lookup/recovery, transfers, zero-stock gain approvals and valuation reporting remain absent. Unsupported preview surfaces stay hidden in authenticated mode. Do not describe the prototype as fully linked or production-ready.

The supplied operator screenshot matches the earlier built UI bundle: its Stock screen starts at KPI cards and has no page header. The current source and rebuilt `dist` show a dedicated Stock header with **Add item** and **Add stock** in local preview mode. Add item opens the catalogue form; Add stock selects an item and opens the quantity form. Local changes are browser-only, new items start at zero stock, and quantities allow up to six decimal places without a negative balance. In authenticated mode, permitted users see **Add item** and **Receive stock**; the latter opens Purchasing -> Receive delivery. A reviewed receipt is the connected stock-in operation; server manual adjustments and transfers are not implemented.

### Inventory feature check from the operator screenshot

| Operator need | What is present | Missing or limited |
|---|---|---|
| Create a catalogue item | **Add item** is visible in local and server Stock headers for authorized roles. Local requires `products.manage`; server requires `catalog.manage`. | Server supports SKU, name, unit, currency, sell/cost price and tax. Barcode, category, reorder point, package conversions and import are not in the server command/schema. |
| Increase on-hand stock | Local preview **Add stock** opens a quantity adjustment. Authenticated Stock **Receive stock** opens Purchasing -> Receive delivery. | Local changes are browser-only. Server stock-in is receipt-only; manual adjustments, transfers and locations are absent. Supplier master, PO, AP and landed cost are also absent. |
| Count physical stock | `Count stock` supports saved full-outlet drafts, line counting, variance reasons, review, post and cancel. Storekeepers save; manager roles post/cancel. | Baseline changes return a conflict and preserve the draft. Spot counts, physical locations, barcode lookup and unknown-barcode queue are not implemented. |
| Receive a delivery | Purchasing has reviewed receiving; authenticated receive writes a stock movement and inventory/accrual journal. | Supplier and reference are evidence text; supplier master, purchase orders, invoice matching, AP and landed cost are absent. |
| Review movement history | Stock exposes movement history; server mode lists recent API movements, including count and receipt movements. Server balances use the accepted moving weighted-average method. | A complete valuation report and selectable costing policy are not implemented. |
## Decision at audited SHA

**Current checkout update:** Migration 010 and permission-scoped trial balance/partial-summary reports are locally verified on the worktree described above. The older `001–009` and no-report wording in the historical audited-SHA assessment below refers to the earlier baseline; it is superseded by the 14 October current-checkout evidence above. Production remains **NO-GO** because current work has not run in CI, and browser acceptance, provider/hardware integration, operations, deployment and backup/restore are incomplete.

**PRODUCTION NO-GO.** The defects in this section describe audited SHA `530cdbf`, not the current source. The current worktree has addressed the listed P0 migration/catalog/POS/replay defects and now has local PostgreSQL acceptance for migrations 001–009, supported stock counts, weighted-average inventory value and the connected sales/shift/hotel paths. Production remains unaccepted: corrected CI has not rerun; browser journeys, full tenant-FK/security and revocation matrix, backup/restore, deployment, operational monitoring and hardware/provider integrations remain unverified or incomplete.

Estimated broad ERP scope completeness: **35–40%** (subjective, based on repository implementation versus the product specifications, *not* test pass percentage). A substantial frontend preview exists, but only a narrow set of workflows are server-authoritative.

## Delta recorded at audit SHA 530cdbf (historical baseline)

| Previously reported area | Updated assessment | Evidence |
|---|---|---|
| Backend database migration runner | Improved: now registers 001–004, but migration 003 likely drops the wrong constraint and 004 lacks its schema | `apps/api/src/migration.ts`, `apps/api/migrations/004_hospitality.sql` |
| Refunds | Improved: idempotent partial cash refund commands, original-line quantity caps, VAT reversal, optional stock restitution | `apps/api/src/commands.ts`; migration 003 |
| Sales history | Improved: server-backed list and refund interface | `src/components/sales/BackendSalesHistoryWorkspace.tsx` |
| Stock administration | Improved: server product creation and stock movement review | `src/components/inventory/BackendInventoryWorkspace.tsx` |
| Receiving | Improved: reviewed UI, document reference, supplier text evidence | migration 002; `ProcurementWorkspace.tsx` |
| Hospitality | Backend created: room/reservation/stay/folio/housekeeping commands and tables; no end-to-end accepted lifecycle | migration 004; `apps/api/src/commands.ts` |
| Unknown command recovery | Improved: IndexedDB command journal before submit; still lacks full offline sync and tested recovery matrix | `src/services/commandJournal.ts`; `src/services/apiClient.ts` |
| Catalog SQL | Still broken | `apps/api/src/app.ts` lines 89–95 |
| Authenticated POS demo fallback | Still present | `src/components/pos/PointOfSaleView.tsx` around `handleFinalizeSale` |
| Identical command replay envelope | Still inconsistent | `apps/api/src/app.ts` lines 153–176 |
| PostgreSQL CI acceptance | Still absent | `.github/workflows/ci.yml`; `apps/api/test/api.test.ts` |

## P0 — Release-blocking defects at audited SHA 530cdbf

### G-00 — Migration 003 references the wrong generated status constraint name (P0, highly probable)

`001_initial.sql` defines `commerce.orders.status` with an **unnamed** `CHECK (status IN (...))`. PostgreSQL normally generates a check name from the table and column, i.e. `orders_status_check` for table `orders`. But `003_cash_refunds.sql` executes:

```sql
ALTER TABLE commerce.orders DROP CONSTRAINT commerce_orders_status_check;
```

This references a different, explicitly named constraint that the initial schema does not declare. On a fresh database, this is expected to fail at **migration 003**, before 004 is reached. Confirm the actual constraint name from PostgreSQL before issuing DDL:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'commerce.orders'::regclass AND contype = 'c';
```

**Fix:** Use the actual generated constraint name for 001, and keep migrations checksum-safe: edit 003 only if demonstrably unapplied in all environments; otherwise create a compatible remediation migration. Require clean migration 001→004 and rerun tests in CI.

### G-01 — Missing hospitality schema, clean migration fails (P0, confirmed)

`001_initial.sql` creates `core`, `identity`, `catalog`, `inventory`, `commerce`, `finance`, `system`, but not `hospitality`. Migration `004_hospitality.sql` starts with `CREATE TABLE core.tenant_capabilities`, then immediately creates `hospitality.rooms`. It never creates the `hospitality` schema. The runner registers 004, so this failure blocks a fresh install and prevents the new capability table from remaining available after the rolled-back migration. The login query now references `core.tenant_capabilities`, compounding the first-use blocker.

**Fix:** Prepend `CREATE SCHEMA IF NOT EXISTS hospitality;` to 004 *only if the migration has never been successfully applied in any environment*. If applied anywhere under existing checksum, use a checksum-preserving, separately versioned repair path. Test empty database and upgrade from 003; prove migration checksums and sequential reruns.

### G-02 — Catalog join refers to nonexistent products column (P0, confirmed)

`app.ts`:

```sql
FROM catalog.products p
JOIN inventory.balances b USING(tenant_id,outlet_id,product_id)
```

`catalog.products` defines `id`, while `inventory.balances` has `product_id`. This query is incompatible with the declared schema.

**Fix:**

```sql
FROM catalog.products p
JOIN inventory.balances b
  ON b.tenant_id=p.tenant_id
 AND b.outlet_id=p.outlet_id
 AND b.product_id=p.id
```

Acceptance: authenticated cashier loads catalog after fresh migrations, tenant and outlet scoping tested, empty catalog returns `[]` not 500.

### G-03 — Authenticated POS still falls through to local demo sale (P0, confirmed)

`PointOfSaleView.tsx` checks `if (backendSession && backendCatalog) { ... submitCommand(...) ... return }`; if backend session exists but catalog is not loaded or fails, it falls through to local `storage.processSale(...)`. This can create an operator-visible transaction not present in PostgreSQL.

**Fix:** Define explicit `DEMO`, `SERVER_LOADING`, `SERVER_READY`, `SERVER_UNAVAILABLE`, and `SERVER_RECOVERY_REQUIRED` modes. On *any authenticated session*, never call `storage.processSale`. Disable all server money operations when catalog/session/shift authority is not confirmed. Test forced catalog 500, API timeout, logout/login transitions, and browser refresh.

### G-04 — Idempotent replay response shape differs (P0, confirmed)

New submission yields `{ commandId, status:'CONFIRMED', value }`. Duplicate exact ID returns `{ commandId, status:'CONFIRMED', response: { status:'CONFIRMED', value } }` in `apps/api/src/app.ts`, which violates the canonical API response contract and the frontend's expected value field. **Fix** return the originally persisted result *flattened* to the same canonical shape; never execute the business mutation twice. Test byte-equivalent response and unchanged row counts on repeat submission and concurrent duplicate submissions.

## P1 — Findings at audited SHA 530cdbf: integrity, security, reliability, and functionality

| ID | Gap / source | Consequence and required acceptance |
|---|---|---|
| G-05 | No database-backed API tests; `apps/api/test/api.test.ts` contains five isolated route/hash/money/refund-math tests | CI can be green with invalid SQL/migrations. Add PostgreSQL service; fresh+upgrade migration, bootstrap, login, authorization, receive, sell, refund, close, journals, cross-tenant, contention and restart tests. |
| G-06 | Serializable transactions without 40001/40P01 retry in `apps/api/src/db.ts` | Concurrency can surface as HTTP 500. Introduce bounded command-safe retries with same ID; ensure no external side effects in retried DB transaction. |
| G-07 | No DB exclusion constraint on overlapping hotel reservations; `assertRoomAvailable` is code-level check | Availability is not protected by database invariant. Add `daterange` exclusion constraints or equivalently validated locking policy and race tests. |
| G-08 | Hospitality commands created but no signed-in hotel workspace integration; `HospitalityView.tsx` remains local storage | Server room lifecycle is not an accepted operator flow. Integrate reservation, check-in, folio, cash checkout and housekeeping UI and test. |
| G-09 | At the audited baseline, server shifts lacked till movements and payout evidence. | Partial fix in follow-up: paid-in/payout commands, immutable movement records and drawer versioning are implemented; expense classification, counted-cash reconciliation, supervisor approval and a complete Z report remain open. |
| G-10 | Cart/receipt success derived from response and local snapshot; immutable receipt document and authoritative print status absent | Historical receipt and reprint evidence incomplete. Add receipt snapshot/document endpoint, stable number, retry queue/acknowledgement. |
| G-11 | `GET /catalog/items` and `/sales/orders` expose cost prices to roles allowed to sell | Unnecessary COGS confidentiality exposure. Scope projections by role; cashier sees selling price, quantity and permitted tax only. |
| G-12 | At audited SHA, posting sale COGS used mutable `catalog.products.cost_price_minor` while receiving accepted per-delivery cost | Financial margins could diverge from received cost. Follow-up status is recorded in the 14 October integration table above; that implemented policy still needs CI and broader valuation/report reconciliation. |
| G-13 | New refund path cash only, manager/owner/admin only, no server approval grants | Provider refund, credit reversals, per-role approvals and receipt evidence incomplete. Implement explicit refund types and permission audit. |
| G-14 | DB FK constraints are not consistently tenant/outlet-composite (older order/payment/journal children) | Defense-in-depth isolation incomplete. Add composite FK constraints and adversarial cross-tenant fixture tests using additive migrations. |
| G-15 | UI navigation/active operator and preview-derived workspaces still use browser demo permissions on authenticated sessions | Misleading access and cross-authority workflows. Derive navigation and actions from server permissions/capabilities, block demo mutations in server mode. |
| G-16 | IndexedDB journal added, but no server change feed, cursor, offline grants, or worker | Crash recovery is improved; actual offline-first operation and multi-terminal convergence remain unimplemented. Build command replay protocol and explicit online/offline matrices. |
| G-17 | Outbox table exists without worker, retry/dead-letter, or delivery metrics | Outbox events never propagate. Implement idempotent worker and processing visibility. |
| G-18 | `hardware.ts` uses `printContainer.innerHTML` with interpolation of catalogue/tenant/receipt data | Potential DOM injection/XSS when operator-controllable text contains markup. Escape/DOM-node construct or sanitize, and add hostile-content tests. |
| G-19 | `APP_ORIGINS` allows any Origin when unset; session security hardening incomplete | Misconfiguration hazard. Fail-closed on production environment origins and secure cookie settings; add security regression tests. |
| G-20 | No financial report endpoints, trial balance drill-down, period close, AP, customer credit service | ERP finance not authoritative outside journal posting. Add validated report datasets with completeness metadata before calling them P&L. |
| G-21 | `004_hospitality.sql` functionality dates, rates and checkout policies untested in PostgreSQL | Stay lifecycle may fail on SQL/date/runtime behavior despite TypeScript passing. Include live PostgreSQL 2-business/2-device tests and room reservation contention. |

## P2 — Scope completeness and product operations at audited SHA 530cdbf

| Domain | Missing or incomplete |
|---|---|
| Hospitality | Deposits, variable actual-night charges, split bills, ancillary folio charges, guest balances, occupancy reports, rate plans, no-show, early checkout and refund policies |
| Stock | Stock counts, transfers, packaging/barcodes, variants, sealed/open bottles, recipes and production consumption |
| Procurement | Supplier master, PO approvals, deliveries matched to orders/invoices, AP, partial receipts, landed costs |
| Restaurant | Persistent tables/tickets, kitchen/bar routing, held tabs, modifiers, split bills |
| Customers | Server receivables, credit limits, repayments, statements and aging |
| Tax/payments | Provider-backed M-Pesa/card, real settlement/chargebacks, reconciliations, verified Kenyan compliance integration where required |
| SaaS identity | Invitations, password reset/MFA, multiple outlet memberships, granular grants, device assignment and revocation UI |
| Infrastructure | Staging production parity, TLS ingress, worker deployment, backup and restore verification, observability/alerts, failover runbooks, hardware tests |

## Engineering estimates at audited SHA (not measured test coverage)

| Area | Estimated feature scope implemented | Reason |
|---|---:|---|
| Frontend workspaces and navigation | 80% | Broad UX coverage, uneven server attachment |
| API/database foundation | 50% | Real migrations and routes, P0 defects and lacking integration tests |
| Identity/tenant isolation | 45% | Session/token/role/capabilities; incomplete administration and least privilege |
| Catalog and inventory | 40% | Historical audited-SHA estimate: CRUD/receive/movements; no counts/transfers/packaging/cost layers |
| POS, payments and refunds | 45% | Cash sale, history, partial cash refund; no providers/split/till reconciliation |
| Cash shifts | 45% | Open/close/versioning; no full physical reconciliation evidence |
| Hospitality | 30% | Domain schema and commands only, missing operator integration/tests |
| Procurement | 25% | Receiving, supplier text evidence; no PO/AP service |
| Finance and reports | 20% | Balanced journal posting, no complete financial reports/period controls |
| Customers | 10% | Mostly browser demo |
| Restaurant | 10% | Mostly browser demo |
| Offline/server sync | 12% | IndexedDB unknown-outcome recovery, no offline transport/remote feed |
| Hardware printing | 20% | Browser printing, no device-level verification |
| CI and acceptance evidence | 25% | Five passing boundary tests, no PostgreSQL/E2E/security acceptance |
| Deployment operations | 10% | Templates, no proven staging/backup/restoration |

**Overall full-ERP estimate: ~35–40%.** Better functionality is present than at SHA `47457db`, but full-scope production readiness is still blocked.

## Required development waves and pass/fail gates

**Gate A, immediate P0 remediation:** Repair the 003 constraint name and 004 hospitality schema migration failures, catalogue join, no-demo-on-server invariant and canonical replay response. CI PostgreSQL service must demonstrate a completely fresh migration plus logged-in catalog fetch and exact-ID replay. No P0 failures.

**Gate B, first authoritative operating shift:** The disposable PostgreSQL suite now covers bootstrap/login, item setup, multi-cost receipts, stock count posting/conflict, weighted-average sale/refund COGS, cash shift movements/close, journal balance, idempotent replay and tenant rejection. Still required: rerun in CI, test two authenticated operators racing the last unit, verify a lost-response recovery in a browser, and reconcile cash drawer and stock carrying values against operational statements. No live operating shift has been performed.

**Gate C, hospitality acceptance:** Install 004 on fresh and upgraded DB, enable hospitality, create room, attempt two concurrent overlapping reservations (one must be rejected), check in, collect actual supported charges, settle and check out, mark cleaned, preserve ledger and audit. Prove that failed tender leaves occupied status and no cash posting.

**Gate D, security and resilience:** Cross-tenant ID substitutions, revoked device/session, cashier cost confidentiality, permission denial, forged CSRF, failed storage journal, serialization retry, backup/restore and frontend no-demo-fallback. All automated where possible.

**Gate E, breadth and production:** Add customers, procurement/AP, kitchen, reports, offline sync, real hardware and provider integrations as separately accepted vertical slices. Load/restore/recovery evidence and production deployment approval required.

## Suggested Codex direction recorded in the original audit

> Continue the documented gaps in priority order. Obtain CI execution evidence for the current migrations/tests, then address tenant-scoped foreign keys, full stock-availability concurrency, operation-ready cashier recovery, and accurate finance reports. Do not treat this worktree as deployed or production accepted. Keep `docs/24-BACKEND-INTEGRATION.md` synchronized with actual capabilities and report exact local/CI/browser evidence separately.

## Reference paths

- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/migrations/003_cash_refunds.sql
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/migrations/004_hospitality.sql
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/src/app.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/src/commands.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/src/components/pos/PointOfSaleView.tsx
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/src/services/commandJournal.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/test/api.test.ts
- https://github.com/davemusau00/mazao-erp-v1/actions/runs/38455212343
