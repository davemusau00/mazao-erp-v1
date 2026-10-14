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
The API currently supports a durable **full outlet count** session. Opening it snapshots each active catalog item's on-hand quantity, balance version, unit and current catalog cost. Storekeepers can save count quantities and variance reasons; a manager-authorized command posts all differences together, records immutable count movements and a balanced variance journal, and rejects stale balance versions without discarding the draft. A manager can cancel a stale or abandoned draft, which remains visible in count history. The optional area label is descriptive only because inventory is not yet modeled by physical location.

Spot counts, unknown barcode resolution, blind-count separation, location-specific balances, package conversions, count-adjustment commands independent of a full count, and FIFO/weighted-average cost layers remain unimplemented. Count variance journals use the unit cost captured from the catalog at session opening; this does not resolve the separate inventory valuation policy.
