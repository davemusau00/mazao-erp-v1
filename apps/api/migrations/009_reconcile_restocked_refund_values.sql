-- A legacy partial refund movement's rounded unit cost can differ by one
-- minor unit from the apportioned COGS snapshot. Use the refund subledger,
-- then rebuild the carrying-value projection from corrected movement values.
WITH refund_values AS (
  SELECT r.tenant_id,r.outlet_id,r.command_id,rl.product_id,sum(rl.cogs_minor) value_minor
  FROM commerce.refunds r
  JOIN commerce.refund_lines rl
    ON rl.tenant_id=r.tenant_id AND rl.outlet_id=r.outlet_id AND rl.refund_id=r.id
  WHERE rl.restocked
  GROUP BY r.tenant_id,r.outlet_id,r.command_id,rl.product_id
)
UPDATE inventory.movements m
SET value_minor=rv.value_minor
FROM refund_values rv
WHERE m.tenant_id=rv.tenant_id AND m.outlet_id=rv.outlet_id
  AND m.command_id=rv.command_id AND m.product_id=rv.product_id
  AND m.movement_type='REFUND';

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

UPDATE inventory.stock_count_lines l
SET baseline_inventory_value_minor=b.inventory_value_minor
FROM inventory.stock_counts c
JOIN inventory.balances b
  ON b.tenant_id=c.tenant_id AND b.outlet_id=c.outlet_id
WHERE c.id=l.count_id AND c.tenant_id=l.tenant_id AND c.outlet_id=l.outlet_id
  AND c.status='OPEN' AND b.product_id=l.product_id
  AND b.version=l.baseline_balance_version AND b.quantity=l.baseline_quantity;
