# Domain modules and invariants

## Tenancy and configuration
Organizations have locations/outlets, staff memberships, feature capabilities, fiscal settings, time zone, currency, receipt profile. Tenant-scoped uniqueness and queries mandatory. Feature switching changes UI and policies, not the underlying database lineage.

## Sales and service
Sale draft, order lines, modifier selections, service routes, ticket sent state, price/tax snapshots, tenders, split payments, discounts, voids, refunds and immutable receipt documents. Committed line's price snapshot never recomputed from changing product prices. Tab/table transfer must lock both orders and preserve history. Paid order may only be amended through explicitly auditable adjustment/refund paths.

## Stock and catalog
Product family and variants; purchase packages and multiple barcodes; inventory items with canonical unit; stock locations; reservations; sealed containers/open volumes; ingredient recipes and yields; movement ledger. Available = physical - reserved - outstanding provisionally committed allocations (never double-subtract same pending movement). Count corrections are movements with reasons, never silent `UPDATE quantity`.

## Purchasing and supplier accounts
PO draft/approved/ordered; delivery reception; rejected goods; supplier invoice; tax/cost allocation; three-way matching; AP balance and settlement. Receiving creates stock/valuation and payable or GRNI policy, not supplier cash expense. Reject duplicate supplier invoice reference per supplier/tenant.

## Hotel lifecycle
Room types, rooms, rates, availability, reservations, check-in, stay, guest bill, deposits, charges, room moves, checkout, housekeeping and maintenance hold. Overlapping confirmed reservations/stays require correct concurrency guard. Walk-in can be created without a mandatory marketing customer profile; legal guest requirements remain configurable and locally reviewed.

## Money and accounting
Tills, movements, cash-up, payments, customer account balances, supplier account balances, recognized revenue, cost of goods, chart of accounts, balanced postings, period close, adjustments. `settled` is not inferred from "print receipt" or external collection promise.

## People and assets
Staff memberships, permissions, time-bound manager approvals, device register/revoke, shifts, assets acquisition/custody/maintenance/disposal, immutable audit trail. General users must not see administrator workspaces.

## Reporting
Sales/returns, tender mix, shift, stock valuation/movement, gross margin, purchases/AP, guest balances, ADR/occupancy, financial statements and exceptions. Reports show as-of and coverage indicators, plus drill-down. Zero differs from unavailable or incomplete.

## Command manifest requirement
Every domain operation entry: `name`, input/output JSON Schema, minimum permission, approval, isolation/locking, online/offline mode, side effects, audit event, idempotency key scope, unit and integration acceptance tests. Generated contract catalogue is CI-gated.
