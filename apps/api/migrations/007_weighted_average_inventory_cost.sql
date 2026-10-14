-- Keep integer minor-unit carrying value beside the decimal stock quantity.
-- Legacy balances are valued at the product's recorded cost as a one-time seed.
ALTER TABLE inventory.balances
  ADD COLUMN inventory_value_minor bigint NOT NULL DEFAULT 0
  CHECK (inventory_value_minor >= 0);

UPDATE inventory.balances b
SET inventory_value_minor = round(b.quantity * p.cost_price_minor)::bigint
FROM catalog.products p
WHERE p.tenant_id = b.tenant_id
  AND p.outlet_id = b.outlet_id
  AND p.id = b.product_id;

ALTER TABLE inventory.movements
  ADD COLUMN value_minor bigint NOT NULL DEFAULT 0
  CHECK (value_minor >= 0);

UPDATE inventory.movements
SET value_minor = round(abs(quantity_delta) * unit_cost_minor)::bigint;

ALTER TABLE commerce.order_lines
  ADD COLUMN cogs_minor bigint NOT NULL DEFAULT 0
  CHECK (cogs_minor >= 0);

UPDATE commerce.order_lines
SET cogs_minor = round(quantity * cost_price_minor)::bigint;

ALTER TABLE inventory.stock_count_lines
  ADD COLUMN baseline_inventory_value_minor bigint NOT NULL DEFAULT 0
  CHECK (baseline_inventory_value_minor >= 0);

UPDATE inventory.stock_count_lines
SET baseline_inventory_value_minor = round(baseline_quantity * baseline_unit_cost_minor)::bigint;

