# CODEX MASTER EXECUTION INSTRUCTIONS
## MAZAO ERP V1: Controlled Out-of-Stock Sales and Stock Exception Reconciliation

**Repository:** https://github.com/davemusau00/mazao-erp-v1  
**Starting branch:** Latest `main`  
**Last verified main SHA:** `ce5b8aba597ca5077aa1b4eb45e2aabc12a4a847`  
**Proposed development branch:** `feat/confirmed-stock-exception-sales`  
**Application:** Existing deployed Mazao ERP PWA and PostgreSQL API  
**Priority:** High  
**Implementation type:** Additive, production-compatible feature  
**Deployment:** Not authorized until all release gates pass and the product owner explicitly approves deployment.

---

# 1. YOUR ROLE AND MISSION

You are the lead full-stack software engineer, PostgreSQL database engineer, financial-systems engineer, QA engineer and release architect responsible for implementing a controlled inventory exception feature in the existing Mazao ERP.

Your task is to **implement working, tested, production-ready code**, not just write specifications or recommend changes.

The business requirement is straightforward:

> Mazao must allow an authorized cashier to complete a legitimate sale even when the system indicates zero or insufficient stock, provided the cashier explicitly confirms the goods are physically present. The system must warn the cashier, record the inventory discrepancy, preserve the financial transaction, alert management, and provide a controlled mechanism for reconciling the discrepancy later.

The problem being solved is operational rather than theoretical.

Employees sometimes:

- Receive goods physically but fail to record the delivery.
- Forget to conduct or complete stock counts.
- Leave stock records outdated.
- Make mistakes when recording stock.
- Sell an item that is physically available but incorrectly recorded as unavailable.

Such errors should not unnecessarily prevent legitimate customer transactions.

However, Mazao must retain inventory accountability and reliable financial records.

Do not implement unrestricted negative stock by removing a validation check or database constraint.

Deliver a complete, auditable, configurable mechanism that preserves existing system invariants.

## Core outcome

After this implementation:

1. Normal sales operate exactly as before.
2. When recorded quantity is insufficient, Mazao warns the cashier.
3. The cashier can acknowledge the shortage and confirm physical fulfillment.
4. The backend independently validates that acknowledgement.
5. The sale, receipt, tender and tax are recorded normally.
6. Recorded inventory cannot become negative.
7. Any unrecorded sold quantity is recorded in an immutable, traceable exception history.
8. Estimated stock costs are clearly differentiated from verified costs.
9. Managers can investigate and reconcile the discrepancies with supporting evidence.
10. Reports accurately identify unresolved stock, cashier activity, estimated costs and subsequent reconciliations.
11. Existing accounting and inventory reports remain mathematically consistent.
12. All changes can be released without destroying or rewriting existing production data.

---

# 2. REPOSITORY INSPECTION AND PREPARATION

## 2.1 Inspect before editing

Fetch the latest repository state and inspect the implementation rather than relying on potentially outdated documentation.

Run the appropriate local commands:

```powershell
git status --short
git remote -v
git fetch origin
git log -5 --oneline origin/main
git branch -a
```

If there are uncommitted changes, preserve them. Do not silently discard, stash or overwrite the user's work.

When the worktree is clean:

```powershell
git switch main
git pull --ff-only origin main
git switch -c feat/confirmed-stock-exception-sales
```

If the branch name already exists, inspect it before reusing it.

Record the exact baseline SHA.

Check whether a newer migration or any overlapping stock-exception work has appeared. If migration 021 is occupied, select the next available migration number.

## 2.2 Inspect these implementation areas

Start with:

### Backend

- `apps/api/src/commands.ts`
- `apps/api/src/app.ts`
- `apps/api/src/contracts.ts`
- `apps/api/src/commandAuthorization.ts`
- `apps/api/src/accounting.ts`
- `apps/api/src/financeReports.ts`
- `apps/api/src/reportMetadata.ts`
- `apps/api/src/operationalAnalytics.ts`
- `apps/api/src/itemReports.ts`
- `apps/api/src/receipts.ts`
- `apps/api/src/productImport.ts`
- `apps/api/src/identityAuthority.ts`
- `apps/api/src/db.ts`

### Database

- `apps/api/migrations/001_initial.sql`
- `apps/api/migrations/006_inventory_counts.sql`
- `apps/api/migrations/007_weighted_average_inventory_cost.sql`
- `apps/api/migrations/008_reconcile_inventory_value_from_movements.sql`
- `apps/api/migrations/009_reconcile_restocked_refund_values.sql`
- `apps/api/migrations/010_composite_tenant_foreign_keys.sql`
- `apps/api/migrations/018_manual_mpesa_item_discounts.sql`
- `apps/api/migrations/019_accounting_controls.sql`
- `apps/api/migrations/020_account_display_catalog.sql`

### Frontend

- `src/components/pos/PointOfSaleView.tsx`
- `src/components/inventory/BackendStockCountWorkspace.tsx`
- `src/components/analytics/BackendOperationalAnalyticsWorkspace.tsx`
- `src/components/analytics/ItemPerformanceReport.tsx`
- `src/components/manage/BackendManageWorkspace.tsx`
- `src/components/home/BackendTodayWorkspace.tsx`
- `src/services/apiClient.ts`
- `src/app/featureRegistry.ts`

### Existing tests

Inspect the real PostgreSQL integration tests, particularly:

- Manual M-Pesa and item discounts.
- Sales and refunds.
- Inventory receiving.
- Stock counts.
- Weighted-average valuation.
- Financial reconciliation.
- Command idempotency and recovery.
- Tenant and role authorization.
- Browser acceptance.

Identify reusable fixtures, helpers and transaction assertions.

Do not create an entirely separate test infrastructure when existing helpers can be reused.

## 2.3 Establish the existing invariants

Before implementation, document the exact behavior of:

- `sales.order.settle`
- `sales.order.refund`
- `inventory.receive`
- `inventory.count.open`
- `inventory.count.save`
- `inventory.count.post`
- `shift.close`
- `finance.period.transition`

Confirm the stock, journal, command and database constraints enforced by each operation.

The existing application uses authoritative command IDs, transactional execution, version checks, audit events and PostgreSQL-backed journals.

**Preserve this architecture.**

---

# 3. NON-NEGOTIABLE TECHNICAL RULES

Do not compromise these requirements.

### Inventory

- Never remove the `inventory.balances.quantity >= 0` constraint.
- Never allow negative inventory carrying values.
- Never create phantom inventory by silently increasing stock before selling.
- Never modify a product's current stock directly from the frontend.
- Never erase a recorded stock discrepancy because a later delivery arrives.
- Never claim that an estimated cost is a verified cost.
- Never treat inventory variance as employee theft without independent evidence.

### Financial records

- All successful sale journals must balance.
- Cash and M-Pesa settlement behavior must remain correct.
- Revenue and tax must be posted from actual confirmed sales.
- Estimated COGS must remain identifiable.
- Any later cost adjustment must be recorded as a new journal event.
- Do not rewrite original sale journals to force reconciliation.
- Do not backdate financial journals into closed accounting periods.
- Do not silently edit historical receipts or payments.

### Security

- All policy and reconciliation permissions must be enforced on the backend.
- All records must be tenant and outlet scoped.
- Client-provided tenant, actor, role and device fields must not become authority.
- Only authorized managers or owners may change policies or reconcile exceptions.
- Ordinary cashiers must not be allowed to resolve their own discrepancies by editing stock balances.
- Command replay must not produce duplicate sales or reconciliation effects.

### Deployment

- Do not modify production data during development.
- Do not delete, truncate or recreate existing business tables.
- Do not rewrite previously applied migrations.
- Do not use manual SQL patches against the live database as a substitute for a migration.
- Do not restart or change unrelated applications on the VPS.
- Do not merge or deploy automatically.

---

# 4. FEATURE DEFINITION

Name the feature:

**Stock Exception Sales**

Use customer-facing wording:

**Sell with stock warning**

Avoid unnecessarily technical terms such as negative-stock override, suspense ledger or COGS when communicating with cashiers.

The feature should be available only when the owner or an administrator has enabled it for the relevant outlet.

## 4.1 Default behavior

The default must be disabled.

When disabled, Mazao must continue rejecting insufficient-stock sales using the existing behavior.

When enabled:

- Regular sales proceed without additional prompts.
- Insufficient-stock sales require acknowledgement.
- Any shortfall is tracked.
- Management receives visibility into the discrepancy.
- Normal receiving and stock counting remain available.

## 4.2 Applicable sale types

Support existing:

- Cash sales.
- Cashier-confirmed manual M-Pesa sales.
- Customer account credit sales, subject to the existing account rules.

Do not weaken current tender validation or introduce unrelated payment features.

The new functionality changes inventory availability handling, not the existing payment system.

---

# 5. PER-OUTLET POLICY

Implement a database-backed outlet stock exception policy.

Suggested table:

`inventory.outlet_stock_sale_policies`

Required fields:

- `tenant_id`
- `outlet_id`
- `enabled`
- `require_physical_confirmation`
- `require_reason`
- `allow_zero_reference_cost`
- `version`
- `updated_by`
- `updated_at`

Default values:

```text
enabled = false
require_physical_confirmation = true
require_reason = true
allow_zero_reference_cost = true
version = 1
```

Treat the confirmation and reason requirements as mandatory for V1 even if the schema leaves room for future policy versions.

The policy must have appropriate composite tenant/outlet references and a unique key for each outlet.

## 5.1 Policy commands

Introduce a server-authoritative command such as:

`configuration.stock_exception_policy.update`

The command must:

1. Require an authorized owner or administrator.
2. Validate the new configuration.
3. Require the current policy version.
4. Lock and update the policy transactionally.
5. Record an audit event containing the previous and new policy.
6. Record the actor and timestamp.
7. Prevent silent changes by users without permission.

Recommended permission:

`inventory.shortfall.configure`

The current Mazao permission system uses fixed roles. Add the permission without allowing ordinary cashiers to change the feature configuration.

## 5.2 Configuration screen

Add a section in Manage:

**Stock Sale Exceptions**

Display:

- Enable confirmed out-of-stock sales.
- Explanation of what the feature does.
- Confirmation requirement.
- Current policy status.
- Last updated by.
- Last updated date.
- Link to stock exception reports.

Include this notice:

> This setting allows staff to complete physically verified sales when recorded stock is insufficient. Every exception is logged and must be reviewed. The feature does not automatically correct missing inventory records.

Preserve the existing Manage interface and styling.

---

# 6. DATABASE MIGRATION

Create an additive migration using the next available sequence.

Proposed filename:

`apps/api/migrations/021_confirmed_stock_exception_sales.sql`

Do not assume this number remains available without checking.

## 6.1 Add the stock-shortfall ledger

Create:

`inventory.sale_shortfalls`

Required fields:

```text
id
tenant_id
outlet_id
order_id
order_line_id
product_id
command_id
operator_id

quantity
resolved_quantity

recorded_quantity_before
requested_quantity

recorded_cogs_minor
provisional_cogs_minor

reason_code
reason_note

operator_name_snapshot
created_at
version
```

Rules:

- Quantity values use `NUMERIC(20,6)`.
- Requested and shortfall quantities must be positive.
- Resolved quantity must never exceed the original shortfall.
- One sale line may have at most one primary shortfall record.
- Use composite tenant/outlet constraints consistent with the rest of the repository.
- Add appropriate indexes for product, order, operator, date and unresolved quantity.
- Never hard-delete financial/inventory exception history.

Derive status from quantities:

```text
OPEN:
resolved_quantity = 0

PARTIALLY_RESOLVED:
0 < resolved_quantity < quantity

RESOLVED:
resolved_quantity = quantity
```

Do not store a freely editable status field that can disagree with the quantities.

## 6.2 Add reconciliation history

Create:

`inventory.sale_shortfall_resolutions`

Suggested fields:

```text
id
tenant_id
outlet_id
shortfall_id
command_id
resolved_by
resolved_by_name_snapshot

quantity
provisional_cogs_released_minor
actual_cogs_minor
cogs_adjustment_minor

resolution_type
supporting_movement_id
supporting_document_reference
reason

created_at
```

Each record must be immutable.

Add unique command constraints and references to prevent duplicate resolution.

Support partial resolution through multiple records.

Never exceed the original unresolved quantity.

Reconciliation is not complete merely because an operator changes a status.

## 6.3 Add immutable order-line snapshots

Extend `commerce.order_lines` with fields representing:

```text
unrecorded_quantity
provisional_cogs_minor
```

Use safe defaults for historical rows.

Historical existing orders must retain their existing interpretation.

The existing `cogs_minor` can continue representing the total COGS originally recognized, including its estimated portion. Ensure all dependent reports understand that some of that amount is provisional.

Do not rewrite historical `cogs_minor` after reconciliation. Subsequent variance journals and resolution history provide the final accounting adjustment.

## 6.4 Extend inventory movement types

The final reconciliation operation will need a distinct movement classification, provisionally:

`SHORTFALL_RECONCILIATION`

Inspect the current movement-type check constraint before implementing the migration.

Extend that constraint additively and safely.

Do not misrepresent an unrecorded sale as a normal `SALE` movement that deducts nonexistent recorded stock.

## 6.5 Financial account metadata

Introduce an appropriately classified account such as:

`UNRECORDED_STOCK_CLEARING`

This is an unresolved cost clearing account, **not automatically a supplier payable**.

Ensure the account is:

- Recognized by the ledger/report metadata layer.
- Included in relevant trial balance and accounting control views.
- Disclosed separately from confirmed inventory carrying value.
- Handled by reconciliation journals.
- Cleared precisely when the related provisional cost is fully resolved.

Its accounting classification and presentation must be reviewed against the existing chart of accounts and financial report semantics before release.

## 6.6 Migration correctness

Verify:

- Fresh database installation.
- Upgrade from migration 020.
- Repeated migration execution/checksum validation.
- Historical data preservation.
- Tenant and outlet foreign keys.
- Existing transaction compatibility.
- No full-table destructive rewrite.
- Appropriate indexes and lock scope.
- No unexpected table scans under the existing production data shape.

---

# 7. CASHIER POS EXPERIENCE

Modify:

`src/components/pos/PointOfSaleView.tsx`

Retain Mazao's existing dark interface.

Use the established UI conventions:

- Dark page background.
- Existing blue primary actions.
- Amber warning appearance.
- Existing responsive dialogs.
- Existing typography and spacing.
- Minimum 44px practical touch targets.
- Existing desktop and mobile layouts.

Do not redesign the POS.

## 7.1 Add-to-basket warning

When an item is added to the basket:

```text
Product: Tusker Lager 500ml

Recorded stock: 0
Requested quantity: 2

Warning:
The recorded stock is insufficient.
Confirm that these items are physically available
before completing the sale.
```

The product must remain in the basket.

Do not block basket creation merely because its recorded quantity is zero.

Update the warning whenever quantities change.

## 7.2 Final payment confirmation

Before confirming payment, show all affected products together.

Example:

```text
STOCK RECORDS NEED ATTENTION

Some items in this sale exceed the recorded stock.

Tusker Lager 500ml
Recorded: 0
Selling: 2
Shortfall: 2

Viceroy 250ml
Recorded: 1
Selling: 3
Shortfall: 2

Reason:
[ ] Delivery not entered
[ ] Stock count not updated
[ ] Other / requires investigation

[ ] I confirm these goods are physically available
    and will be supplied to the customer.

The sale will be recorded and the discrepancy
flagged for management review.

[Cancel] [Confirm Payment]
```

Use per-line reasons if multiple affected products have different causes.

For the reason codes, prefer wording that distinguishes the employee's suspected explanation from a verified root cause:

```text
SUSPECTED_UNRECORDED_DELIVERY
SUSPECTED_OUTDATED_COUNT
UNKNOWN
```

Require a note for `UNKNOWN`.

## 7.3 Confirmation state

Reset the stock confirmation when any relevant change occurs:

- Basket quantity changes.
- Affected products change.
- The product catalog is refreshed and the shortage increases.
- The currently selected outlet changes.
- The cashier signs out.
- The payment dialog closes and a new review is required.

Do not retain a blanket acknowledgement indefinitely.

## 7.4 Backend is authoritative

The frontend can display estimated shortages using current catalog data.

However, the server must recalculate the actual shortage after locking inventory rows.

The cashier must not be able to submit:

```text
physicallyConfirmed = false
```

and still settle the sale when a shortfall exists.

The server must reject missing, malformed, duplicate or insufficient product acknowledgements.

If the new shortage is greater than the quantity the cashier acknowledged, return a domain conflict, refresh stock and require another confirmation.

If stock becomes sufficient before settlement, complete the sale normally and do not create a new stock exception.

## 7.5 Command recovery

Reuse the existing command journal and recovery UI.

Do not issue a new payment command when the outcome of the previous attempt is unknown.

Retain the original command ID and original payload during recovery.

The cashier must not be encouraged to charge the customer again because the browser lost a response.

---

# 8. CHECKOUT COMMAND CONTRACT

Keep:

`sales.order.settle`

Extend its payload using an optional field:

```json
{
  "stockException": {
    "physicallyConfirmed": true,
    "lines": [
      {
        "productId": "PRODUCT_UUID",
        "maxConfirmedShortfall": "2",
        "reasonCode": "SUSPECTED_UNRECORDED_DELIVERY",
        "reasonNote": null
      }
    ]
  }
}
```

This object belongs inside the existing command payload alongside `shiftId`, `lines`, `tenders` and optional `customerId`.

Do not create a new independently settled "exception sale" type.

Existing valid commands without a stock exception must continue functioning exactly as they currently do when sufficient stock is available.

Validation rules:

1. The submitted product must belong to the current sale.
2. Each exception product appears at most once.
3. The acknowledgement must cover the actual shortage.
4. Quantities must be valid decimal strings using Mazao's six-decimal precision.
5. The reason must match an allowed code.
6. An `UNKNOWN` reason requires an explanation.
7. Physical confirmation must be explicit.
8. The outlet policy must be enabled at execution time.
9. Existing role, shift, product-version, payment and tax checks must still pass.
10. Unknown extra payload properties must not be silently accepted.

Prefer strict rejection of unsupported fields, consistent with existing `saleRecord()` behavior.

---

# 9. BACKEND SALE IMPLEMENTATION

Implement the logic in the existing sale transaction in:

`apps/api/src/commands.ts`

Prefer extracting reusable exception logic into a dedicated module rather than making `settleSale()` substantially harder to audit.

Suggested module:

`apps/api/src/inventoryShortfalls.ts`

## 9.1 Quantity allocation

For each sale line:

```text
recorded_qty = min(available_qty, requested_qty)

shortfall_qty = requested_qty - recorded_qty
```

Example:

```text
Recorded stock: 2
Requested sale: 5

Recorded quantity sold: 2
Shortfall quantity: 3
Recorded stock after sale: 0
```

## 9.2 Execution requirements

Inside the existing command transaction:

1. Revalidate authenticated actor and permissions.
2. Read and lock the current outlet policy.
3. Validate the shift.
4. Validate product revisions and prices.
5. Lock relevant product and stock-balance records using a deterministic order.
6. Calculate recorded and unrecorded quantities.
7. Validate stock acknowledgements.
8. Calculate original price, discount and tax normally.
9. Calculate verified stock COGS.
10. Calculate provisional COGS for the shortfall.
11. Insert the normal confirmed order and sale lines.
12. Decrement recorded stock by the covered quantity only.
13. Decrement recorded inventory carrying value by the verified COGS only.
14. Insert normal inventory `SALE` movements only for covered recorded stock.
15. Insert exception records for every shortfall.
16. Increment affected stock balance versions, even when zero recorded quantity was deducted.
17. Record the existing tender/customer charge.
18. Update shift figures normally.
19. Create balanced accounting journals.
20. Insert audit and transactional outbox events.
21. Return the original confirmed sale response extended with stock exception evidence.

All effects must succeed or fail atomically.

No partially committed sale is acceptable.

## 9.3 Product locking and concurrency

The current implementation uses row locks for product and balance records.

Preserve locking.

Do not introduce an unbounded, inconsistent lock order that could increase deadlock risk.

Test:

- Two cashiers selling the same product.
- Two cashiers selling overlapping baskets.
- Sale concurrent with receiving.
- Sale concurrent with stock count posting.
- Sale concurrent with policy disabling.
- Reconciliation concurrent with checkout.

The resulting recorded balances, exceptions and journals must remain correct.

## 9.4 Stock-count versioning

A critical existing behavior is that a stock count becomes stale if its underlying balance changes after the count was opened.

For a zero-stock override sale, the quantity may stay at zero.

Nevertheless, the balance version must increment.

Otherwise a count opened before that sale could be posted later without knowing an intervening transaction occurred.

Preserve stale-count rejection. Provide a user-facing message requiring a recount or fresh count snapshot.

## 9.5 Idempotency

Reuse the existing command ID and request-hash handling.

A successful command must never create duplicate:

- Orders.
- Payments.
- Inventory movements.
- Stock exception rows.
- Journal entries.
- Audit events.

The status/recovery endpoint must return the stored original result.

Do not add a second independent write path for exception sales.

---

# 10. COST OF GOODS SOLD ACCOUNTING

This is a mandatory correctness requirement.

The existing implementation calculates COGS from inventory carrying value.

For insufficient-stock sales, split the costs.

```text
verified_cogs:
Value of the quantity deducted from recorded stock.

provisional_cogs:
Estimated cost of the unrecorded quantity.

total_initial_cogs:
verified_cogs + provisional_cogs
```

Use the existing weighted-average valuation calculation for the recorded portion.

For the shortfall portion, use the product's current recorded reference cost as a provisional estimate.

Perform calculations in integer minor units with BigInt-safe operations, consistent with the existing repository.

## 10.1 Example

```text
Recorded stock = 1 bottle
Recorded carrying value = KES 90
Quantity sold = 3 bottles
Reference cost = KES 80 per bottle
Selling price = KES 150 per bottle

Recorded quantity sold = 1
Unrecorded quantity = 2

Verified COGS = KES 90
Provisional COGS = KES 160

Total initial COGS = KES 250
```

The sale should post:

```text
DR Cost of Goods Sold          KES 250
CR Inventory                   KES 90
CR Unrecorded Stock Clearing   KES 160
```

Tax and payment journals follow the existing sale implementation.

## 10.2 Do not double-count COGS

A subsequent reconciliation must never debit full COGS again as though the original sale had no cost.

Reconciliation releases the original estimate and records only the difference between estimated and verified costs.

Example:

```text
Provisional COGS: KES 160
Final verified COGS: KES 180
Difference: KES 20
```

Resolution:

```text
DR Unrecorded Stock Clearing   KES 160
DR Cost of Goods Sold          KES 20
CR Inventory                   KES 180
```

If the actual cost is below the provisional estimate, credit COGS for the difference.

If provisional cost is zero, record zero estimate, retain the quantity exception and disclose that margin is not final.

## 10.3 Partial reconciliation and rounding

Support quantities such as:

```text
Original shortfall: 5
Resolved now: 2
Remaining: 3
```

Allocate the provisional cost proportionally using integer minor units.

On the final resolution, release the exact remaining estimated amount.

Never leave rounding residue in the clearing account.

## 10.4 Reporting implications

Update:

- Trial balance account metadata.
- Accounting control balances.
- Item performance reports.
- Cost-of-sales reports.
- Operational analytics.
- Financial-report coverage statements.
- Period-close checks.

Clearly distinguish:

```text
Confirmed revenue
Recorded inventory value
Provisional COGS
COGS reconciliation adjustments
Unresolved clearing balance
Estimated/incomplete gross margin
```

Do not report provisional margins as fully verified profitability.

---

# 11. RECONCILIATION ENGINE

Implement an authorized command:

`inventory.sale_shortfall.resolve`

Recommended permission:

`inventory.shortfall.resolve`

Grant it only to appropriate management roles.

The command must require:

```text
shortfallId
quantity
resolutionType
supportingEvidence
reason
expectedVersions
```

Where appropriate, supporting evidence may reference an existing inventory receipt or count/correction record.

Do not accept arbitrary claimed cost or quantity as authoritative input.

## 11.1 Supported reconciliation paths

### Path A: Previously omitted receiving

A physical delivery happened earlier but was not entered into Mazao.

The stockkeeper records the omitted delivery through the existing receiving workflow.

The manager reviews the receipt and links the available recorded quantity to the previous shortfall.

The reconciliation command:

- Checks that supporting evidence exists.
- Checks tenant/outlet/product consistency.
- Checks sufficient current recorded stock.
- Deducts the resolved quantity.
- Deducts its supported carrying value.
- Releases provisional COGS.
- Posts any variance.
- Records the resolution.

A supporting receipt is evidence, not proof of a specific physical lot when the system only maintains weighted-average stock. Do not claim lot-level provenance without a proper lot-tracking model.

### Path B: Incorrect stock count or opening records

The manager verifies current physical stock and examines previous stock evidence.

Use the existing count/correction framework where applicable.

Never manufacture an arbitrary historical receipt merely to clear the shortage.

A count confirms current stock, not necessarily where an earlier sold item came from.

Only resolve historical exceptions when the explanation and corresponding inventory/accounting adjustment can be supported.

### Path C: Cause unknown

Leave the exception open.

Allow management to record investigation notes and supporting documents where the existing storage capabilities safely permit it.

Do not erase outstanding quantities or estimated costs.

### Path D: Refund or reversal

Respect the existing sale refund rules.

Do not treat a customer return as automatic proof that an original unrecorded stock source has been reconciled.

A returned physical product may require separate stock verification.

## 11.2 New deliveries must not automatically clear old exceptions

Example:

```text
Monday:
2 bottles sold while recorded stock = 0.

Tuesday:
5 completely new bottles delivered.
```

Mazao must not automatically assume that Tuesday's delivery explains Monday's discrepancy.

Auto-resolution would incorrectly reduce Tuesday's legitimate stock.

Require a manager to explicitly reconcile.

## 11.3 Reconciliation locking

Within one transaction, lock:

1. Shortfall record.
2. Relevant source evidence where appropriate.
3. Inventory balance.
4. Required financial/accounting state.

Verify:

```text
resolve_qty > 0

resolve_qty <= unresolved_qty

resolve_qty <= eligible recorded stock
```

Prevent double-use of the same resolution event or command ID.

When linking a source receiving record, validate existing reconciliation allocations and never claim more than the supporting recorded receipt quantity. Also require sufficient actual current recorded inventory.

Record all results before committing.

## 11.4 Reconciliation journal rules

The resolution must:

- Release the appropriate provisional clearing amount.
- Credit Inventory by verified consumed carrying value.
- Post any positive or negative COGS adjustment.
- Remain balanced.
- Preserve the original sale journal.
- Preserve the original customer receipt.
- Record the resolution date according to open accounting-period policy.

Do not automatically backdate a correction into the original sale date.

---

# 12. REFUND AND RETURN SAFETY

Review the existing `sales.order.refund` handler carefully.

It currently assumes COGS and returned-stock value were derived from recorded inventory.

That assumption may not hold for an exception sale.

For this initial implementation:

**Permit otherwise valid supported cash refunds without restocking, but do not silently restock an unrecorded-stock sale line.**

When a refund references a line with stock exception history:

- If `restock=false`, retain normal supported refund behavior while preserving original shortfall history.
- If `restock=true`, reject with an understandable message until the exception-aware return valuation and restocking workflow is implemented and accepted.
- Do not bypass existing M-Pesa or customer-credit refund limitations.
- Do not credit Inventory using provisional stock cost without appropriate verification.
- Do not automatically mark the stock exception resolved because a refund exists.

Suggested error:

```text
This item was sold while its stock records needed
review. A manager must verify the returned stock
before it can be added back to inventory.
```

If a fully supported return/reconciliation workflow can be built safely within the feature branch, implement and test it separately. Otherwise preserve the conservative restriction rather than weakening accounting safeguards.

Ensure normal, non-exception refunds remain unchanged.

---

# 13. STOCK EXCEPTION API

Provide authoritative endpoints under `/api/v1`.

Suggested endpoints:

```text
GET /inventory/shortfalls

GET /inventory/shortfalls/:id

GET /reports/stock-exceptions

GET /reports/stock-exceptions.csv

GET /configuration/stock-sale-policy
```

Mutations should use the existing command endpoint.

## 13.1 Shortfall directory

Support filters for:

```text
from
to
status
productId
operatorId
outletId (within authorized scope)
reasonCode
limit
after
```

Use stable, deterministic server-side pagination.

Do not return an arbitrary first 50 or 250 records without continuation.

## 13.2 Detail response

Include:

```text
Exception identity
Original receipt/order
Original sale line
SKU/product snapshot
Recorded stock before sale
Requested quantity
Original shortfall
Resolved quantity
Remaining quantity
Provisional cost
Cost released by reconciliations
Final cost adjustments
Cashier identity snapshot
Reason
Created date
Resolution history
Supporting stock evidence
```

Hide financial cost fields from roles that lack cost or finance permissions, consistent with existing Mazao behavior.

## 13.3 Reporting totals

Calculate:

- Total exception events.
- Total unrecorded quantity.
- Currently unresolved quantity.
- Count of affected sales.
- Count of affected products.
- Estimated unresolved COGS.
- Exceptions resolved during the reporting period.
- Oldest outstanding exception age.
- Exception frequency by cashier.
- Exception frequency by product.
- Exception frequency by outlet where permitted.

Do not confuse "created in period" with "currently open".

A discrepancy created last week and resolved today belongs in the historical creation report and the current resolution report.

---

# 14. MANAGEMENT UI

Add a Stock Exceptions management view, reachable from Stock and Reports.

Retain Mazao's visual identity.

Suggested sections:

### Overview

Cards:

```text
Open exceptions
Outstanding quantity
Estimated unresolved value
Oldest pending discrepancy
```

### Exception directory

Columns:

```text
Date
Receipt
Product
Quantity
Cashier
Reason
Estimated value
Status
Action
```

### Exception detail

Show:

```text
Original transaction
Recorded stock at sale
Reported physical confirmation
Employee explanation
Supporting evidence
Reconciliation history
Outstanding discrepancy
```

### Reconciliation dialog

Require:

- Quantity being resolved.
- Resolution type.
- Supporting stock evidence.
- Manager explanation.
- Preview of the quantity effect.
- Preview of provisional and actual cost effects.
- Confirmation before posting.

Show the actual computed accounting impact, not a manually typed journal.

Never expose direct editing of historical quantity or amount fields.

## 14.1 Today dashboard

Add a concise management indicator:

```text
Stock exceptions needing review: 7
```

Only display it to appropriate roles.

Allow navigation to the dedicated report.

Do not clutter the cashier's main Today interface with sensitive financial estimates.

## 14.2 Shift close

Allow normal cashier shift close when cash reconciles.

If stock exceptions occurred during the shift, display an informational summary:

```text
This shift recorded 3 sales with stock discrepancies.
They remain available for management review.
```

Do not automatically block ordinary cash-up solely because stock corrections remain outstanding.

Accounting-period close may have stricter controls.

---

# 15. ACCOUNTING-PERIOD SAFETY

Review:

`apps/api/src/accounting.ts`

The existing financial commands check accounting-period restrictions.

The new reconciliation command must participate in those controls.

A manager should not be able to post a reconciliation adjustment into a closed financial period.

Add coverage checks for unresolved provisional inventory costs.

Recommended policy:

- Normal cashier shift close remains available.
- Finance reports disclose unresolved exceptions.
- A fully certified accounting-period close cannot proceed with unresolved exceptions affecting the covered financial period unless a separately implemented, auditable finance-approved disposition is available.

If the existing partial accounting implementation cannot safely support such a disposition, do not invent one.

Fail closed with a clear error explaining the outstanding reconciliation.

Test both period-close and period-transition concurrency.

---

# 16. INVENTORY COUNT INTEROPERABILITY

Inspect:

- `inventory.count.open`
- `inventory.count.save`
- `inventory.count.post`

Ensure exception sales do not corrupt stock count baselines.

Required behavior:

1. Opening a count captures the current authoritative recorded balance and version.
2. An intervening ordinary sale changes the version.
3. An intervening exception sale also changes the version, even if recorded stock remains zero.
4. Attempting to post an outdated count must return an appropriate version conflict.
5. The user must refresh/recount rather than overwrite intervening transaction evidence.
6. Posting a stock count must not automatically resolve historical sale shortfalls.
7. Mixed positive and negative count adjustments must retain existing financial correctness.
8. Count gain/shrinkage journals must not be duplicated by shortfall reconciliation.

Test a stock count opened before a zero-stock sale, then posted afterward.

This scenario must not pass incorrectly.

---

# 17. REPORTING AND GROSS PROFIT

Update:

`apps/api/src/itemReports.ts`

The existing report calculates COGS and gross profit from sales and refunds.

Once provisional-cost sales are introduced, this needs explicit treatment.

Required reporting behavior:

- Original sale-date COGS remains recorded as initially posted.
- Provisional cost is identified separately.
- Later reconciliation cost variances are recognized on their actual permitted accounting dates.
- The report must expose whether gross margin includes unresolved estimated costs.
- Historical sale documents are not rewritten.
- Product-level and overall totals remain reconcilable with journal postings.

Do not simply replace the original sale-line COGS with a subsequently computed amount.

That would silently change historical report results without a corresponding journal event.

Any summary of final adjusted cost must identify its as-of time and its reconciliation events.

For zero reference-cost items, display that the cost is unknown/estimated rather than suggesting a verified zero cost or unusually high profit.

Extend existing operational analytics without confusing confirmed revenue with estimated margin.

---

# 18. TESTING REQUIREMENTS

Create a dedicated PostgreSQL-backed test suite.

Suggested filename:

`apps/api/test/stock-exception-sales.integration.test.ts`

Reuse the repository's existing test helpers and disposable database conventions.

## 18.1 Normal sales

Verify:

- Sufficient stock, policy disabled.
- Sufficient stock, policy enabled.
- Normal discounts.
- Normal cash payment.
- Normal manual M-Pesa.
- Normal customer account charge.
- Normal receipt.
- Normal refund.
- Normal shift close.

These must remain behaviorally unchanged.

## 18.2 Insufficient stock

Test:

```text
Available 0, sell 1
Available 0, sell 5
Available 1, sell 3
Available 2.5, sell 3.25
Available 10, sell 10
```

Confirm decimal quantity handling and no negative balance.

## 18.3 Policy enforcement

Test:

- Policy disabled.
- Policy enabled.
- Policy disabled after cashier opened checkout.
- Cashier attempts to enable policy.
- Manager attempts unauthorized configuration.
- Concurrent policy edits.
- Missing policy version.
- Repeated policy update command.

## 18.4 Confirmation validation

Test:

- Missing physical confirmation.
- Missing reason.
- Invalid reason.
- Other reason without note.
- Invalid quantity string.
- Incorrect product reference.
- Duplicate product reference.
- Extra unknown payload field.
- Acknowledged shortage less than actual shortage.
- Acknowledged shortage greater than actual shortage.
- Stock recovered before command execution.

No invalid confirmation should silently pass.

## 18.5 Financial integrity

Assert:

```text
Sum(debits) == Sum(credits)

Inventory >= 0

Inventory carrying value >= 0

Customer payment == confirmed sale obligation

Recorded stock value == inventory GL control
```

Include provisional clearing amounts in finance assertions.

Test nonzero and zero reference costs.

Test positive and negative cost adjustment variance.

Test exact rounding in partial reconciliation.

## 18.6 Command recovery

Test:

- Network response lost after commit.
- Retry with the same command ID.
- Retry with a different payload using the same ID.
- Duplicate requests from the same device.
- Concurrent duplicate requests.
- Recovery after browser reload.
- Recovery after authentication/permission change.

Expect exactly one sale and one exception record per affected sale line.

## 18.7 Multiple operators

Test two operators simultaneously selling the final recorded units.

Example:

```text
Recorded stock = 1

Cashier A sells 1
Cashier B sells 1
```

The outcome must be:

```text
Two valid sales only if the policy/confirmations allow them.

Recorded quantity cannot fall below zero.

Exactly one unit is deducted from recorded stock.

Exactly one unit is recorded as an unrecorded sale.

No duplicated COGS.
No duplicated payment.
No incorrect shift totals.
```

Also test overlapping multi-product baskets to detect lock-order issues.

## 18.8 Receiving and reconciliation

Test:

- Missing delivery entered later.
- New unrelated delivery arrives.
- Manager explicitly links supporting evidence.
- Partial resolution.
- Full resolution.
- Repeated resolution command.
- Resolution exceeding outstanding quantity.
- Resolution with insufficient current recorded stock.
- Resolution with invalid support evidence.
- Cross-tenant support evidence.
- Cost estimate higher than actual.
- Cost estimate lower than actual.
- Zero-cost estimate resolved at nonzero actual cost.
- A further sale occurs before reconciliation.
- Concurrent receiving and reconciliation.

Never automatically resolve historical shortages merely because a delivery was recorded.

## 18.9 Stock counts

Test:

- A count opened before an exception sale.
- A count posted after an intervening exception sale.
- Partial recorded quantity sold.
- Zero recorded quantity sold with version increment.
- Count gains after an exception.
- Count shrinkage after an exception.
- Original stock count approval permissions.

## 18.10 Refunds

Test:

- Normal refunds unaffected.
- No-restock cash refund of exception sale.
- Attempted restock of unresolved exception sale.
- M-Pesa refund restrictions preserved.
- Customer credit refund restrictions preserved.
- No invalid inventory or cost entries created.

## 18.11 Security

Test cross-tenant and cross-outlet access for:

- Policy read/update.
- Exception list.
- Exception detail.
- Reconciliation.
- CSV export.
- Financial cost data.

Confirm no authorization bypass through command replay or predictable identifiers.

## 18.12 Reporting

Confirm:

- Open exceptions appear immediately.
- Resolved exceptions remain in history.
- Partially resolved quantities calculate correctly.
- Date-range counts reconcile.
- CSV totals match API totals.
- No silent pagination truncation.
- COGS estimates are disclosed.
- Financial controls remain balanced.
- Period-close safeguards work.

---

# 19. BROWSER ACCEPTANCE

Add Playwright tests against the real API and disposable PostgreSQL database.

Use current desktop and mobile viewports.

Required browser journey:

1. Administrator enables exception sales.
2. Cashier signs in.
3. Cashier opens shift.
4. Cashier searches for a zero-stock item.
5. Cashier adds it to the basket.
6. Warning appears.
7. Cashier opens payment.
8. Cashier initially tries without confirmation.
9. Confirmation is correctly blocked.
10. Cashier chooses a reason and confirms physical supply.
11. Cashier completes payment.
12. Receipt is displayed correctly.
13. Cashier shift reflects the payment.
14. Manager signs in.
15. Manager sees the stock exception.
16. Manager reviews linked receipt, product and cashier.
17. A supporting missing delivery is recorded.
18. Manager partially or fully resolves the exception.
19. Stock, accounting and report balances update correctly.
20. Original receipt and sale payment remain unchanged.

Include keyboard navigation, focus behavior, responsive dialogs and browser refresh/recovery.

Preserve established Mazao aesthetics. Do not substitute generic demo screens for connected components.

---

# 20. PERFORMANCE AND DATA QUALITY

The repository already has known history-pagination gaps.

Do not repeat those problems in the new implementation.

Requirements:

- Indexed queries on tenant/outlet/date/product.
- Bounded page sizes.
- Stable keyset or equivalent continuation.
- Consistent summary totals across complete datasets.
- No N+1 queries in exception directories.
- No unnecessary JSONB dumps of complete histories.
- No excessive round trips during checkout.
- Consistent lock ordering.
- No long-running reconciliation transaction holding locks while waiting for external services.
- Clear handling of large datasets.

Use server-side aggregation for totals.

Test the reporting APIs against thousands of exceptions and reconciliations in disposable data.

Measure the added overhead for normal checkout and exception checkout separately.

The feature must not make ordinary checkout materially slower just because exception tracking exists.

---

# 21. CODE QUALITY AND MAINTAINABILITY

Follow current repository conventions.

Prefer small, reviewable functions:

```text
loadStockExceptionPolicy
validateStockExceptionAcknowledgement
calculateRecordedAndShortfallQuantities
calculateProvisionalStockCost
recordSaleShortfall
resolveStockShortfall
getStockShortfallSummary
getStockShortfalls
getStockShortfallDetail
```

These are suggested responsibilities, not mandatory exact signatures.

Avoid:

- Duplicating the entire checkout handler.
- Adding a parallel financial ledger.
- Putting financial calculations in React.
- Relying on frontend-derived permissions.
- Hiding a production accounting issue behind a catch block.
- Using floating-point money calculations.
- Silently fixing reconciliation mismatches.
- Disabling old tests to obtain a green build.
- Introducing dependencies unnecessarily.
- Rewriting unrelated modules.

Prefer the smallest coherent change that satisfies all release invariants.

---

# 22. IMPLEMENTATION SEQUENCE

Execute the implementation in the following order.

## Phase A: Baseline and design verification

1. Fetch latest `main`.
2. Confirm worktree safety.
3. Inspect the current handlers and migrations.
4. Record existing invariants.
5. Determine the next valid migration number.
6. Identify likely integration conflicts.
7. Produce a concise implementation checklist.

Then proceed to implementation. Do not stop after the checklist.

## Phase B: Schema and shared contracts

1. Add outlet policy table.
2. Add shortfall ledger.
3. Add resolution history.
4. Add sale-line snapshots.
5. Add inventory reconciliation movement classification.
6. Add required indexes and composite foreign keys.
7. Extend API types and permissions.
8. Test fresh and upgrade migrations.

## Phase C: Backend settlement

1. Add policy lookup.
2. Add strict acknowledgement validation.
3. Split recorded and unrecorded sale quantities.
4. Split verified and provisional COGS.
5. Preserve payment/tax handling.
6. Persist exception evidence atomically.
7. Preserve idempotency.
8. Write concurrency and settlement tests.

## Phase D: Reconciliation

1. Implement authorized resolution command.
2. Validate evidence and current stock.
3. Handle partial/full quantity allocations.
4. Post cost variance journals.
5. Implement duplicate-resolution protection.
6. Handle accounting-period restrictions.
7. Add receiving, count and refund interoperability tests.

## Phase E: Frontend

1. Add POS warning.
2. Add reason selection.
3. Add physical-confirmation checkbox.
4. Add server-conflict recovery UI.
5. Add manager policy controls.
6. Add stock exception directory.
7. Add exception details and reconciliation interface.
8. Add Today/Reports summaries.

## Phase F: Reporting

1. Add management report APIs.
2. Add CSV export.
3. Add COGS provisional-cost coverage.
4. Add clearing-account visibility.
5. Add reconciled versus unresolved totals.
6. Add reporting integration tests.

## Phase G: Acceptance and release evidence

1. Run the full test suite.
2. Run browser acceptance.
3. Verify migrations and financial consistency.
4. Run performance checks.
5. Inspect the full diff.
6. Update documentation.
7. Open a reviewable pull request.
8. Produce a release readiness report.

Do not deploy as part of implementation unless separately instructed.

---

# 23. LOCAL VERIFICATION COMMANDS

Use the repository's actual scripts and test configuration. Inspect `package.json` and `.github/workflows/ci.yml` first.

Expected checks include:

```powershell
bun install --frozen-lockfile

bun run typecheck

bun run test:api

bun run test:integration

bun run test:e2e

bunx playwright test --config playwright.browser-matrix.config.ts

bun run build

git diff --check
```

Run migrations and the PostgreSQL-backed tests only against a disposable database using the repository's existing `TEST_DATABASE_URL` and migration conventions.

Do not accidentally run development migration commands against production `DATABASE_URL`.

Verify all existing CI checks, not only the newly added tests.

If a test fails:

1. Identify whether it is a genuine regression or a test environment problem.
2. Fix the underlying problem.
3. Rerun the focused test.
4. Rerun the broader relevant suite.
5. Record the evidence.

Never weaken an assertion simply to make the workflow pass.

---

# 24. RELEASE AND DEPLOYMENT SAFETY

Production currently has valuable business data.

The release must preserve it.

Before deployment is considered:

- Exact PR build must pass CI.
- Schema migration must pass on a copy of the current schema/data.
- A current encrypted off-host production backup must be completed.
- The backup must be restored to an isolated PostgreSQL instance.
- Existing orders, payments, journal entries and inventory movements must reconcile.
- The release artifact must match the reviewed commit.
- A rollback plan must be documented.
- Other VPS services must remain untouched.

The feature must remain **disabled by default** after deployment.

The owner or administrator can enable it deliberately for the intended outlet after the deployment smoke checks pass.

## 24.1 Safe rollout

Recommended rollout:

```text
1. Deploy new code and migration with policy disabled.
2. Verify existing ordinary checkout still works.
3. Verify read APIs and reports.
4. Verify application and PostgreSQL health.
5. Verify no existing rows were altered unexpectedly.
6. Enable exception sales for the selected outlet.
7. Run a controlled acceptance transaction.
8. Verify sale, receipt, journals and shortfall history.
9. Verify an authorized reconciliation.
10. Monitor errors and accounting controls.
```

Do not use a fabricated test transaction in live production unless the owner explicitly authorizes that transaction and specifies how it should be handled.

## 24.2 Rollback

A database migration may be additive without being safely reversible.

Document:

- How to disable the new outlet policy immediately.
- Which older binaries are schema-compatible.
- Whether rollback is safe after new exception sales have been recorded.
- How to preserve newly created exception and reconciliation history.
- How to restore application health without losing confirmed sales.

Do not automatically roll back application binaries to code that misinterprets new exception transactions.

Do not roll back the database by deleting new financial history.

---

# 25. DOCUMENTATION

Add a focused feature document, suggested:

`docs/STOCK-EXCEPTION-SALES.md`

Cover:

1. Business motivation.
2. Cashier workflow.
3. Permission model.
4. Outlet policy.
5. Database schema.
6. Sale command contract.
7. Inventory quantity invariants.
8. Provisional COGS and clearing-account design.
9. Reconciliation workflow.
10. Reporting coverage.
11. Refund restrictions.
12. Stock-count interoperability.
13. API endpoints.
14. Test evidence.
15. Deployment and rollback.
16. Known limitations.

Update the current integration and completion documentation to reflect verified implementation.

Do not erase historical audit reports. Mark them superseded where appropriate.

Update the UI feature registry so it accurately reflects the new supported functionality.

---

# 26. REQUIRED FINAL DELIVERABLES

At completion, provide:

### A. Source implementation

Actual committed changes for:

- Migration.
- API.
- Domain commands.
- Financial journal handling.
- Policy configuration.
- POS interface.
- Exception reporting.
- Reconciliation UI.
- Authorization.
- Tests.

### B. Acceptance evidence

Report:

```text
Typecheck:
API tests:
PostgreSQL integration:
Browser E2E:
Browser matrix:
Production build:
Migration fresh install:
Migration upgrade:
Migration checksum rerun:
Concurrency acceptance:
Tenant isolation:
Financial reconciliation:
```

Include actual commands, results, counts and relevant CI URLs.

Do not invent pass results.

### C. Risk report

Identify:

- Remaining limitations.
- Any untested physical environment behavior.
- Any partial refund restrictions.
- Any provisional financial statement coverage.
- Any operational risks discovered.

### D. Pull request

Open a PR targeting `main` with a clear title, such as:

`feat: allow confirmed stock-shortage sales with auditable reconciliation`

The PR must explain:

- The business problem.
- How the backend preserves nonnegative inventory.
- How the new exception ledger works.
- How COGS and account clearing are handled.
- How staff confirm physical fulfillment.
- How managers reconcile.
- Which tests passed.
- Why the migration is safe.
- Whether the feature is enabled by default.
- Remaining limitations.

Do not merge without approval.

### E. Deployment notes

Provide a concise production deployment checklist referencing the exact tested commit and migration head.

Make clear whether deployment is ready, blocked or incomplete.

---

# 27. DEFINITION OF DONE

The feature is complete only when every statement below is demonstrably true.

- [ ] The owner can enable or disable stock exception sales per outlet.
- [ ] Existing checkout behavior is unchanged when the feature is disabled.
- [ ] A cashier can select an item whose recorded stock is zero.
- [ ] Mazao displays a clear warning before payment.
- [ ] The cashier must confirm physical availability and provide a reason.
- [ ] The backend independently validates the confirmation.
- [ ] The sale completes using existing payment methods.
- [ ] The customer receives a correct receipt.
- [ ] Inventory quantity never becomes negative.
- [ ] Recorded inventory value never becomes negative.
- [ ] Normal recorded stock movements remain reconcilable.
- [ ] Unrecorded sold quantities are stored permanently.
- [ ] Provisional COGS is identified and journalled correctly.
- [ ] Sales revenue, tax and shift totals remain correct.
- [ ] Management can see exceptions and investigate them.
- [ ] Management can reconcile supported discrepancies with evidence.
- [ ] Partial and full resolutions work without double counting.
- [ ] New deliveries do not automatically clear older discrepancies.
- [ ] Stock counts cannot overwrite intervening exception sales.
- [ ] Refunds cannot invent stock or misstate COGS.
- [ ] Reports distinguish provisional and verified costs.
- [ ] Existing accounting controls remain balanced.
- [ ] Tenant and outlet isolation tests pass.
- [ ] Retry and concurrency tests pass.
- [ ] The browser acceptance journey passes.
- [ ] The database migration is additive and verified.
- [ ] Existing production data remains intact.
- [ ] Full CI passes.
- [ ] Documentation is updated.
- [ ] A reviewable PR exists.
- [ ] Deployment remains pending explicit approval.

---

# 28. FINAL INSTRUCTIONS TO CODEX

Do not stop at planning.

Do not return a list of proposed modifications while leaving the feature unimplemented.

Do not replace the current Mazao application with a simplified demo.

Do not disable inventory, payment, accounting or security checks merely to make an out-of-stock sale pass.

Implement the feature in the established architecture, preserve the existing UI, produce the required migration and tests, and verify all financial and inventory invariants against disposable PostgreSQL data.

Prioritize the business objective:

**Never unnecessarily lose a legitimate sale because a staff member failed to update recorded stock.**

But uphold the equally important financial objective:

**Never conceal or silently manufacture inventory to make that sale possible.**

Treat this as a small, controlled change to Mazao's business behavior with comprehensive accounting protection, not as an opportunity to rebuild unrelated ERP modules.

Complete implementation, tests, documentation and a reviewable pull request. Report any unresolved release blockers explicitly.

**Do not deploy, merge or mutate production without explicit approval.**
