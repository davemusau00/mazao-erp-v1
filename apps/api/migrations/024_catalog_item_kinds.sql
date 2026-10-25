-- Existing identities remain goods until an explicit reviewed command changes
-- them. Never infer an item type from a label or rewrite posted sale evidence.
ALTER TABLE catalog.products ADD COLUMN item_kind text NOT NULL DEFAULT 'STOCKED_GOOD'
  CHECK (item_kind IN ('STOCKED_GOOD','SERVICE','PREPARED'));
ALTER TABLE commerce.order_lines ADD COLUMN item_kind_snapshot text NOT NULL DEFAULT 'STOCKED_GOOD'
  CHECK (item_kind_snapshot IN ('STOCKED_GOOD','SERVICE','PREPARED'));
ALTER TABLE commerce.order_lines ADD CONSTRAINT nonstock_sale_has_no_inventory_cost
  CHECK (item_kind_snapshot='STOCKED_GOOD' OR
    (cogs_minor=0 AND provisional_cogs_minor=0 AND unrecorded_quantity=0));
CREATE INDEX products_outlet_kind_idx ON catalog.products(tenant_id,outlet_id,item_kind,id);

-- Historical zero balance rows may remain after reviewed reclassification.
-- They cannot acquire new physical quantity/value, nor new stock movements.
CREATE FUNCTION inventory.require_stocked_item_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
  SELECT item_kind INTO kind FROM catalog.products
    WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND id=NEW.product_id FOR SHARE;
  IF kind IS NULL THEN RETURN NEW; END IF; -- Retain the scoped FK rejection.
  IF kind<>'STOCKED_GOOD' AND (NEW.quantity<>0 OR NEW.inventory_value_minor<>0) THEN
    RAISE EXCEPTION 'Physical stock writes require a stocked-good identity.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER balance_item_kind_guard BEFORE INSERT OR UPDATE ON inventory.balances
  FOR EACH ROW EXECUTE FUNCTION inventory.require_stocked_item_write();

-- Separate movement function: movement rows have no balance columns.
CREATE FUNCTION inventory.require_stocked_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
  SELECT item_kind INTO kind FROM catalog.products
    WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND id=NEW.product_id FOR SHARE;
  IF kind IS NULL THEN RETURN NEW; END IF; -- Retain the scoped FK rejection.
  IF kind<>'STOCKED_GOOD' THEN
    RAISE EXCEPTION 'Physical stock movements require a stocked-good identity.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER movement_item_kind_guard BEFORE INSERT ON inventory.movements
  FOR EACH ROW EXECUTE FUNCTION inventory.require_stocked_movement();

CREATE FUNCTION catalog.guard_item_kind_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_kind IS NOT DISTINCT FROM OLD.item_kind THEN RETURN NEW; END IF;
  PERFORM 1 FROM inventory.balances
    WHERE tenant_id=OLD.tenant_id AND outlet_id=OLD.outlet_id AND product_id=OLD.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM inventory.balances WHERE tenant_id=OLD.tenant_id AND outlet_id=OLD.outlet_id
      AND product_id=OLD.id AND (quantity<>0 OR inventory_value_minor<>0)) THEN
    RAISE EXCEPTION 'Reclassification requires a reviewed zero quantity and carrying value.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM inventory.sale_shortfalls WHERE tenant_id=OLD.tenant_id AND outlet_id=OLD.outlet_id
      AND product_id=OLD.id AND resolved_quantity<quantity) THEN
    RAISE EXCEPTION 'Reclassification requires resolved stock exceptions.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM inventory.stock_counts WHERE tenant_id=OLD.tenant_id AND outlet_id=OLD.outlet_id AND status='OPEN') THEN
    RAISE EXCEPTION 'Reclassification cannot change an open count membership.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_item_kind_change_guard BEFORE UPDATE OF item_kind ON catalog.products
  FOR EACH ROW EXECUTE FUNCTION catalog.guard_item_kind_change();
