# Confirmed Stock Exception Sales

## Behavior

Migration `021_confirmed_stock_exception_sales` adds an outlet policy that is disabled by default. When an authorized administrator enables it, a cashier may complete a sale above the outlet's recorded quantity only after confirming the physical quantity for each affected item and choosing a reason. An unknown reason requires a note. The command includes the maximum shortfall the cashier confirmed; the API recomputes stock while holding the inventory row lock and rejects a larger shortfall.

The order line retains its full sold quantity and an immutable recorded-versus-unrecorded split. Inventory quantity and value decrease only by the recorded portion. Cost of goods sold includes recorded weighted-average cost plus a provisional estimate from the item's reference cost. The provisional portion is credited to `UNRECORDED_STOCK_CLEARING`, shown as a liability, and is not represented as a supplier payable. Zero reference cost is allowed by default and can be disabled per outlet.

Exception history and manager resolutions are outlet scoped. A manager can resolve quantity only against an existing positive receipt or verified count adjustment for the same item, with enough unallocated source quantity and enough current recorded inventory. Resolution posts current weighted-average inventory cost, releases the matching provisional estimate, and records a cost-of-sales adjustment. Shortfall rows retain only their monotonic resolution quantity and version; resolution records are append only. A returned exception-sale item cannot be restocked by the normal refund command.

## Permissions and surfaces

- Owners and administrators configure the outlet policy in Manage.
- Cashiers see the exception confirmation in POS only when the outlet policy permits the flow.
- Managers review and resolve exceptions from Stock or Reports. Accountants can review outlet history and costs.
- The exception workspace filters creation activity by business date, shows current unresolved outlet totals separately, pages records, and exports complete filtered CSV files up to 10,000 records.
- Shift close snapshots the count of affected sales. Item performance reports include provisional and verified COGS separately. Accounting controls compare clearing ledger and exception subledger balances. Period close is blocked by unresolved exceptions created in that period.

All list, detail, evidence, report, and export queries constrain both tenant and outlet. Financial cost fields are returned only to roles with `finance.view`.

## Validation

The implementation adds an API integration scenario for disabled policy rejection, stale physical confirmation, immutable history, cash refund restock protection, evidence-backed resolution, cost true-up, shift close counts, and accounting period close blocking. Browser coverage checks the POS confirmation and reason flow.

Run source and API type checks with `npm run typecheck`, production build with `npm run build`, and browser tests with `npm run test:e2e`. The API integration scenario runs through `npm run test:api` when `TEST_DATABASE_URL` points to a disposable migrated PostgreSQL database; the isolation guard rejects production database targets.

## Release boundary

The migration is additive and requires the normal migration runner. This document describes the branch implementation; it does not claim hosted CI, production migration, live acceptance, or backup-and-restore verification.
