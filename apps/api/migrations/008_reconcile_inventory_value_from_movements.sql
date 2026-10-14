-- Prefer complete immutable movement evidence when upgrading balances that
-- existed before inventory carrying value was introduced in migration 007.
WITH movement_totals AS (
  SELECT tenant_id,outlet_id,product_id,
    sum(quantity_delta) movement_quantity,
    sum(CASE WHEN quantity_delta < 0 THEN -value_minor ELSE value_minor END) movement_value
  FROM inventory.movements
  GROUP BY tenant_id,outlet_id,product_id
)
UPDATE inventory.balances b
SET inventory_value_minor = CASE
  WHEN coalesce(m.movement_quantity,0) = b.quantity
    AND coalesce(m.movement_value,0) BETWEEN 0 AND 9223372036854775807
    THEN coalesce(m.movement_value,0)::bigint
  ELSE round(b.quantity * p.cost_price_minor)::bigint
END
FROM catalog.products p
LEFT JOIN movement_totals m
  ON m.tenant_id=p.tenant_id AND m.outlet_id=p.outlet_id AND m.product_id=p.id
WHERE p.tenant_id=b.tenant_id AND p.outlet_id=b.outlet_id AND p.id=b.product_id;

-- An open pre-valuation count is still the same baseline only when both its
-- quantity and version match the current balance. Preserve stale drafts so
-- the normal version-conflict path forces a recount.
UPDATE inventory.stock_count_lines l
SET baseline_inventory_value_minor=b.inventory_value_minor
FROM inventory.stock_counts c
JOIN inventory.balances b
  ON b.tenant_id=c.tenant_id AND b.outlet_id=c.outlet_id
WHERE c.id=l.count_id AND c.tenant_id=l.tenant_id AND c.outlet_id=l.outlet_id
  AND c.status='OPEN' AND b.product_id=l.product_id
  AND b.version=l.baseline_balance_version AND b.quantity=l.baseline_quantity;
