# Commerce and inventory design

## POS workflows
Dedicated fast cashier workspace. Favorite/categories/search/scanner, portion/modifier selection, quantity +/- controls, discounts/comp approval, held order, open tab, table/guest charge, split tender, refund and printable immutable receipt. Product tap renders within target 100ms p95; durable command state shown separately. No full data refresh for each tap. Store local draft as first-class object distinct from server-accepted order.

## Product model
One Item Wizard handles packaged drink, portioned spirit, wine, ingredient by weight/count, cooked dish, retail good, service. User describes **Buy → Count → Sell/Use**. Internal item ↔ product variants ↔ stock item ↔ locations ↔ packages ↔ recipes created atomically. Every barcode maps to unit and multiplier. Price input explicitly says per pack vs per unit, with visible calculated total, loss warning and confirmation.

## Packaging example
Coke single=1 can, six-pack=6 cans, case=24 cans. Four packs @ KES 900 per pack yields 24 units at KES 150 per can and KES 3,600 inventory receipt before any extra charges. Unit conversion dimensional guard forbids grams→milliliters without specific density.

## Open-container example
Whisky 750mL may sell 30mL, 60mL, or sealed 750mL. Maintain sealed container count and opened usable volume per location. Whole-bottle sale consumes sealed container; shot consumes open volume and can atomically open sealed container when policy allows. Do not allow total volume to stand in for commercial sealed availability. Record breakage/waste and reconciliation measurements.

## Food recipes
Recipe version has ingredient quantities with units, yield, waste assumptions and costing; production/batches move raw ingredients to prepared stock if configured. Actual stock consumption uses an explicit trigger (e.g., fired/fulfilled) and cannot double-consume on payment retry. Portion cost snapshots feed financial COGS.

## Inventory count
A durable location count session stores baseline revision, scanned lines, unknown barcode queue, counted quantity, review status and actor. Unknown barcodes require resolution before final review. Submit complete count as one atomic reviewed command; spot count is a separate command with different semantics. Audit before/after delta, reason, approval and costs. Never directly overwrite balances.

## Stock availability
Display physical, reserved, pending local, available. Distinguish local provisional position from server authoritative position. Concurrency locking protects selling remaining stock and reconciling offline reservations.

## Current server implementation boundary
The API currently supports a durable **full outlet count** session. Opening it snapshots each active catalog item's on-hand quantity, balance version, unit, carrying value and reference-cost fallback. Storekeepers can save count quantities and variance reasons; a manager-authorized command posts all differences together, records immutable quantity/value count movements and a balanced variance journal, and rejects stale balance versions without discarding the draft. A manager can cancel a stale or abandoned draft, which remains visible in count history. The optional area label is descriptive only because inventory is not yet modeled by physical location.

## Inventory valuation

The connected API uses the moving weighted-average policy in [ADR 0006](adr/0006-weighted-average-inventory-cost.md). Outlet balances carry both decimal quantity and integer-minor-unit inventory value. Receipts add extended receipt value; sales allocate COGS from the locked carrying value; refunds that restock restore the original sale-line COGS; full-count gains/shrinkage adjust carrying value at the baseline average. Item setup cost is a reference/fallback, not the source of sale COGS. Exact extended value is retained on each movement and sale line. Partial allocations round half-up to the currency minor unit; full depletion consumes the balance's remaining carrying value. Upgrade migrations reconcile balances from complete movement history; legacy restocked-refund values come from their exact refund COGS snapshots. Incomplete movement histories use the item reference cost as a one-time opening estimate.

Spot counts, unknown barcode resolution, blind-count separation, location-specific balances, package conversions, count-adjustment commands independent of a full count and inventory valuation reports remain unimplemented. When a count discovers stock from a zero baseline, the reference item cost is used as an estimate and needs a separately reviewed workflow before such gains can be treated as fully evidenced valuation.
