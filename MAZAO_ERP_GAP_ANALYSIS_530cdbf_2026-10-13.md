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

The current local branch is at `f2bee31b79e39d5b90ab8bf940975970242c76a9`, two commits after the audited SHA. The following remediation is present in the **uncommitted worktree**; it is not part of that commit and has no CI result yet.

| Finding | Current source status | Remaining proof / limitation |
|---|---|---|
| G-00 wrong order status constraint name | Addressed without editing migration 003: the migration runner normalizes the legacy generated constraint name before applying an unapplied 003. | Fresh PostgreSQL migration and checksum-safe rerun are configured in CI; workflow result is pending. |
| G-01 missing hospitality schema | Addressed without editing migration 004: the runner creates `hospitality` before applying an unapplied 004. | Fresh PostgreSQL migration and upgrade path are not yet observed. |
| G-02 catalog product join | Fixed to join `inventory.balances.product_id` to `catalog.products.id`. | Authenticated read is covered by the new PostgreSQL CI test; run pending. |
| G-03 server POS demo fallback | Signed-in checkout now blocks when server catalog state is unavailable; the local `processSale` path runs only without a server session. | Browser/API failure-transition acceptance is still pending. |
| G-04 command replay shape | Exact replay now returns the stored canonical response shape instead of nesting it under `response`. | New PostgreSQL acceptance asserts same response and one product/command row; run pending. |
| G-05 PostgreSQL acceptance | CI now provisions PostgreSQL, applies migrations twice, and runs authenticated catalog, replay and reservation-contention acceptance. | No result from the changed workflow is available in this worktree. Bootstrap and full sale/refund/shift/journal matrix remain uncovered. |
| G-06 serialization retries | `inTransaction` now retries SQLSTATE `40001` and `40P01` up to three times with a short backoff; callbacks are documented as database-only. | Retry behavior has not been exercised against PostgreSQL. |
| G-07 reservation contention | Reservation create/cancel advances the locked room version in the serializable transaction; the integration test races two overlapping commands. | No database exclusion constraint exists; rely on versioned room writes, transaction retries and the pending race test. |
| G-08 hotel operator integration | Server room, reservation, stay and housekeeping workspace is wired into Hotel and Reservations; server Today uses authenticated session/shift data. | No PostgreSQL/browser acceptance; deposits, add-ons, early checkout, split settlement and complete folio remain out of scope. |
| G-15 server-mode local workflows | Navigation hides unsupported server modules; authenticated POS cannot post a local demo sale. | Role permissions remain coarse role maps and require broader authorization/security review. |

**Verification performed for this recheck:** `npm run typecheck` passed (UI and API TypeScript). No test command, PostgreSQL runtime, browser E2E, production deployment, or hardware test was run. The revised CI and integration test are configuration/source evidence only until that workflow runs.

## Decision at audited SHA

**PRODUCTION NO-GO.** The repository contains significant and improving backend code, but fresh database creation and server product loading have source-level defects. An authenticated checkout can also take a browser-local fallback when server catalog readiness is absent, and command replay changes the response structure. Passing CI does not test real PostgreSQL transactions or migrations.

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
| G-09 | Server shift/cash lifecycle lacks full movements, payout evidence, reconciled Z-report | Can't prove drawer value/variance or explain all tenders. Implement till movement ledger and supervisor controls. |
| G-10 | Cart/receipt success derived from response and local snapshot; immutable receipt document and authoritative print status absent | Historical receipt and reprint evidence incomplete. Add receipt snapshot/document endpoint, stable number, retry queue/acknowledgement. |
| G-11 | `GET /catalog/items` and `/sales/orders` expose cost prices to roles allowed to sell | Unnecessary COGS confidentiality exposure. Scope projections by role; cashier sees selling price, quantity and permitted tax only. |
| G-12 | Posting sale COGS uses mutable `catalog.products.cost_price_minor` while receiving accepts per-delivery cost | Financial margins can diverge from received cost. Choose and implement explicit FIFO/weighted-average policy with immutable cost layers/snapshots and reconciliation tests. |
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
| Catalog and inventory | 40% | CRUD/receive/movements; no counts/transfers/packaging/cost layers |
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

**Gate B, first authoritative operating shift:** Bootstrap tenant A and B, add item, receive stock, open shift, sell KES 1,700 under correct product tax, verify money minor units, stock, journal, payments and receipts, refund partially, close with cash counted. Exercise failed stock, duplicate request, lost response, and two operators racing last unit. All balances match.

**Gate C, hospitality acceptance:** Install 004 on fresh and upgraded DB, enable hospitality, create room, attempt two concurrent overlapping reservations (one must be rejected), check in, collect actual supported charges, settle and check out, mark cleaned, preserve ledger and audit. Prove that failed tender leaves occupied status and no cash posting.

**Gate D, security and resilience:** Cross-tenant ID substitutions, revoked device/session, cashier cost confidentiality, permission denial, forged CSRF, failed storage journal, serialization retry, backup/restore and frontend no-demo-fallback. All automated where possible.

**Gate E, breadth and production:** Add customers, procurement/AP, kitchen, reports, offline sync, real hardware and provider integrations as separately accepted vertical slices. Load/restore/recovery evidence and production deployment approval required.

## Suggested Codex direction recorded in the original audit

> The P0 remediation set and PostgreSQL CI test setup are now present in the local worktree as recorded above. Next, obtain CI execution evidence, then complete Gate B with exact SQL balance, replay and cross-tenant assertions. Do not treat this worktree as deployed or production accepted. Keep `docs/24-BACKEND-INTEGRATION.md` synchronized with **actual** capabilities. At the end, report changed files, commit SHA only if a commit is created, executed commands, observed PostgreSQL/E2E results and remaining gaps. Never claim runtime tests without execution.

## Reference paths

- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/migrations/003_cash_refunds.sql
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/migrations/004_hospitality.sql
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/src/app.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/src/commands.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/src/components/pos/PointOfSaleView.tsx
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/src/services/commandJournal.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/530cdbf189de3e816749d00ce3bb184b9b1340b3/apps/api/test/api.test.ts
- https://github.com/davemusau00/mazao-erp-v1/actions/runs/38455212343
