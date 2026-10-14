# ADR 0006: Moving weighted-average inventory valuation

**Status:** Accepted.

## Decision

Value each outlet's on-hand stock with an integer minor-unit carrying value stored with its decimal-safe quantity. A receipt adds its extended receipt value to that balance. A sale consumes a proportionate share of the balance value at the sale transaction's locked stock revision. This is a perpetual moving weighted-average policy.

The item setup cost remains a reference cost and a fallback estimate when a physical count discovers stock while the baseline quantity is zero. It is not used as sale COGS. Full-count gains use the current carrying-value-per-unit when stock exists; full-count shrinkage removes carrying value at that same baseline average. Count variances retain the estimate fallback when no baseline stock exists.

## Rounding and history

Quantity remains exact to six decimal places. Extended line values and partial value allocations round half-up to the nearest integer currency minor unit. When an operation consumes the entire remaining quantity, it consumes the remaining carrying value so the balance cannot retain stranded value. The final allocation can therefore differ by one minor unit from an earlier partial allocation.

Every receipt, sale, restocked refund and count adjustment stores the exact extended `value_minor` on its immutable stock movement. Every sale line stores its exact COGS amount for later partial refunds. Refund COGS is apportioned from that original sale-line snapshot; it never reads the current item cost. Existing balances are migrated using their current recorded item cost as the opening valuation baseline, and legacy movement/order/count rows are backfilled from their recorded quantity and unit cost.

## Consequences and limits

Inventory carrying value and COGS reconcile at minor-unit precision for the supported receipt, sale, refund-restock and full-count commands. The item setup cost is not an inventory valuation report. Transfers, locations, landed cost, supplier invoices, zero-stock count gain approval, and restocking non-cash provider refunds need their own accepted workflows. This decision does not make incomplete financial reports authoritative.
