# ADR 0006: Moving weighted-average inventory valuation

**Status:** Accepted.

## Decision

Value each outlet's on-hand stock with an integer minor-unit carrying value stored with its decimal-safe quantity. A receipt adds its extended receipt value to that balance. A sale consumes a proportionate share of the balance value at the sale transaction's locked stock revision. This is a perpetual moving weighted-average policy.

The item setup cost remains a reference cost and an estimate when a physical count discovers stock while the baseline quantity is zero. Before posting such a gain, a cost-authorized count approver must review the opening reference unit cost and proposed extended value and record an approval reason. If the opening reference cost is zero, the gain may remain zero-valued only with an explicit reason; this does not assert that purchase cost is zero or verified. The estimate origin and exact values are recorded with the posted count/audit evidence. It is not used as verified sale COGS. Full-count gains use the current carrying-value-per-unit when stock exists; full-count shrinkage removes carrying value at that same baseline average.

## Rounding and history

Quantity remains exact to six decimal places. Extended line values and partial value allocations round half-up to the nearest integer currency minor unit. When an operation consumes the entire remaining quantity, it consumes the remaining carrying value so the balance cannot retain stranded value. The final allocation can therefore differ by one minor unit from an earlier partial allocation.

Every receipt, sale, restocked refund and count adjustment stores the exact extended `value_minor` on its immutable stock movement. Every sale line stores its exact COGS amount for later partial refunds. Refund COGS is apportioned from that original sale-line snapshot; it never reads the current item cost. Legacy movement/order/count rows are backfilled from their recorded quantity and unit cost. Migration 008 reconciles an existing balance from immutable movement values when their net quantity matches the balance; balances without complete matching movement history use recorded item cost as a one-time opening estimate. Migration 009 repairs legacy restocked-refund movement values from exact refund-line COGS snapshots before rebuilding matching balances. Matching open count snapshots receive the reconciled value; stale drafts remain stale and use the normal conflict/recount flow.

## Consequences and limits

Inventory carrying value and COGS reconcile at minor-unit precision for the supported receipt, sale, refund-restock and full-count commands. The item setup cost is not an inventory valuation report. The zero-baseline count valuation gate passed local API and UI reconciliation acceptance in S01-06; provisional COGS for stock exceptions remains a separate evidence path. Exact-head hosted CI, release and production acceptance remain open. Transfers, locations, landed cost, supplier invoices, and restocking non-cash provider refunds need their own accepted workflows. This decision does not make incomplete financial reports authoritative.
