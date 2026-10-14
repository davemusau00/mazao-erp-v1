ALTER TABLE commerce.orders
  ADD COLUMN receipt_number text,
  ADD COLUMN tenant_name_snapshot text,
  ADD COLUMN outlet_name_snapshot text,
  ADD COLUMN outlet_time_zone_snapshot text,
  ADD COLUMN cash_tendered_minor bigint,
  ADD COLUMN change_minor bigint;

UPDATE commerce.orders o
SET receipt_number='MZ-' || upper(replace(o.id::text, '-', '')),
    tenant_name_snapshot=t.name,
    outlet_name_snapshot=outlet.name,
    outlet_time_zone_snapshot=outlet.time_zone
FROM core.tenants t
JOIN core.outlets outlet ON outlet.tenant_id=t.id
WHERE o.tenant_id=t.id AND o.outlet_id=outlet.id;

ALTER TABLE commerce.orders
  ALTER COLUMN receipt_number SET NOT NULL,
  ALTER COLUMN tenant_name_snapshot SET NOT NULL,
  ALTER COLUMN outlet_name_snapshot SET NOT NULL,
  ALTER COLUMN outlet_time_zone_snapshot SET NOT NULL,
  ADD CONSTRAINT commerce_orders_receipt_number_unique UNIQUE (tenant_id, outlet_id, receipt_number),
  ADD CONSTRAINT commerce_orders_cash_tender_evidence_check CHECK (
    (cash_tendered_minor IS NULL AND change_minor IS NULL)
    OR (cash_tendered_minor >= total_minor AND change_minor = cash_tendered_minor - total_minor)
  );
