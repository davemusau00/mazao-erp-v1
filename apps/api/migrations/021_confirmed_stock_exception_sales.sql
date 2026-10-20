-- Controlled out-of-stock sales keep recorded inventory nonnegative and retain
-- an immutable discrepancy plus append-only cost reconciliation evidence.

CREATE TABLE inventory.outlet_stock_sale_policies (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  require_physical_confirmation boolean NOT NULL DEFAULT true,
  require_reason boolean NOT NULL DEFAULT true,
  allow_zero_reference_cost boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, outlet_id),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES identity.memberships(tenant_id, user_id),
  CHECK (require_physical_confirmation AND require_reason)
);

ALTER TABLE commerce.order_lines
  ADD COLUMN unrecorded_quantity numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN provisional_cogs_minor bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT order_line_unrecorded_quantity_nonnegative CHECK (unrecorded_quantity >= 0) NOT VALID,
  ADD CONSTRAINT order_line_unrecorded_quantity_bounded CHECK (unrecorded_quantity <= quantity) NOT VALID,
  ADD CONSTRAINT order_line_provisional_cogs_nonnegative CHECK (provisional_cogs_minor >= 0) NOT VALID;
ALTER TABLE commerce.order_lines VALIDATE CONSTRAINT order_line_unrecorded_quantity_nonnegative;
ALTER TABLE commerce.order_lines VALIDATE CONSTRAINT order_line_unrecorded_quantity_bounded;
ALTER TABLE commerce.order_lines VALIDATE CONSTRAINT order_line_provisional_cogs_nonnegative;
ALTER TABLE commerce.order_lines ADD CONSTRAINT commerce_order_lines_scope_id_unique UNIQUE (tenant_id, outlet_id, id);

ALTER TABLE inventory.movements
  ADD CONSTRAINT inventory_movements_scope_id_unique UNIQUE (tenant_id, outlet_id, id);
ALTER TABLE inventory.movements DROP CONSTRAINT inventory_movements_type_allowed_check;
ALTER TABLE inventory.movements
  ADD CONSTRAINT inventory_movements_type_allowed_check
  CHECK (movement_type IN ('OPENING', 'OPENING_IMPORT', 'RECEIPT', 'SALE', 'REFUND', 'COUNT_ADJUSTMENT', 'SHORTFALL_RECONCILIATION'));

CREATE TABLE inventory.sale_shortfalls (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  product_id uuid NOT NULL,
  command_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  resolved_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (resolved_quantity >= 0),
  recorded_quantity_before numeric(20,6) NOT NULL CHECK (recorded_quantity_before >= 0),
  requested_quantity numeric(20,6) NOT NULL CHECK (requested_quantity > 0),
  recorded_cogs_minor bigint NOT NULL CHECK (recorded_cogs_minor >= 0),
  provisional_cogs_minor bigint NOT NULL CHECK (provisional_cogs_minor >= 0),
  reason_code text NOT NULL CHECK (reason_code IN ('SUSPECTED_UNRECORDED_DELIVERY', 'SUSPECTED_OUTDATED_COUNT', 'UNKNOWN')),
  reason_note text,
  operator_name_snapshot text NOT NULL CHECK (length(trim(operator_name_snapshot)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, outlet_id, id),
  UNIQUE (tenant_id, outlet_id, order_line_id),
  UNIQUE (tenant_id, command_id, order_line_id),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id),
  FOREIGN KEY (tenant_id, outlet_id, order_id) REFERENCES commerce.orders(tenant_id, outlet_id, id),
  FOREIGN KEY (tenant_id, outlet_id, order_line_id) REFERENCES commerce.order_lines(tenant_id, outlet_id, id),
  FOREIGN KEY (tenant_id, outlet_id, product_id) REFERENCES catalog.products(tenant_id, outlet_id, id),
  FOREIGN KEY (tenant_id, command_id) REFERENCES system.commands(tenant_id, command_id),
  FOREIGN KEY (tenant_id, operator_id) REFERENCES identity.memberships(tenant_id, user_id),
  CHECK (recorded_quantity_before + quantity = requested_quantity),
  CHECK (resolved_quantity <= quantity),
  CHECK ((reason_code = 'UNKNOWN' AND reason_note IS NOT NULL AND length(trim(reason_note)) BETWEEN 3 AND 500)
      OR (reason_code <> 'UNKNOWN' AND (reason_note IS NULL OR length(trim(reason_note)) <= 500)))
);

CREATE INDEX sale_shortfalls_outlet_date_idx
  ON inventory.sale_shortfalls(tenant_id, outlet_id, created_at DESC, id DESC);
CREATE INDEX sale_shortfalls_open_date_idx
  ON inventory.sale_shortfalls(tenant_id, outlet_id, created_at, id)
  WHERE resolved_quantity < quantity;
CREATE INDEX sale_shortfalls_product_date_idx
  ON inventory.sale_shortfalls(tenant_id, outlet_id, product_id, created_at DESC, id DESC);
CREATE INDEX sale_shortfalls_operator_date_idx
  ON inventory.sale_shortfalls(tenant_id, outlet_id, operator_id, created_at DESC, id DESC);

CREATE TABLE inventory.sale_shortfall_resolutions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  shortfall_id uuid NOT NULL,
  command_id uuid NOT NULL,
  resolved_by uuid NOT NULL,
  resolved_by_name_snapshot text NOT NULL CHECK (length(trim(resolved_by_name_snapshot)) BETWEEN 1 AND 160),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  provisional_cogs_released_minor bigint NOT NULL CHECK (provisional_cogs_released_minor >= 0),
  actual_cogs_minor bigint NOT NULL CHECK (actual_cogs_minor >= 0),
  cogs_adjustment_minor bigint NOT NULL,
  resolution_type text NOT NULL CHECK (resolution_type IN ('OMITTED_RECEIPT', 'VERIFIED_COUNT_ADJUSTMENT')),
  supporting_movement_id uuid NOT NULL,
  supporting_document_reference text,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, command_id),
  UNIQUE (tenant_id, outlet_id, id),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id),
  FOREIGN KEY (tenant_id, outlet_id, shortfall_id) REFERENCES inventory.sale_shortfalls(tenant_id, outlet_id, id),
  FOREIGN KEY (tenant_id, command_id) REFERENCES system.commands(tenant_id, command_id),
  FOREIGN KEY (tenant_id, resolved_by) REFERENCES identity.memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, outlet_id, supporting_movement_id) REFERENCES inventory.movements(tenant_id, outlet_id, id),
  CHECK (cogs_adjustment_minor = actual_cogs_minor - provisional_cogs_released_minor),
  CHECK (supporting_document_reference IS NULL OR length(trim(supporting_document_reference)) <= 160)
);
CREATE INDEX sale_shortfall_resolution_history_idx
  ON inventory.sale_shortfall_resolutions(tenant_id, outlet_id, shortfall_id, created_at, id);
CREATE INDEX sale_shortfall_resolution_movement_idx
  ON inventory.sale_shortfall_resolutions(tenant_id, outlet_id, supporting_movement_id);

CREATE FUNCTION inventory.validate_sale_shortfall_resolution_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s inventory.sale_shortfalls%ROWTYPE;
  movement inventory.movements%ROWTYPE;
  used_quantity numeric(20,6);
  used_provisional bigint;
BEGIN
  SELECT * INTO s FROM inventory.sale_shortfalls
    WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND id=NEW.shortfall_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock exception was not found.' USING ERRCODE='23503'; END IF;
  SELECT * INTO movement FROM inventory.movements
    WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND id=NEW.supporting_movement_id FOR UPDATE;
  IF NOT FOUND OR movement.product_id<>s.product_id THEN RAISE EXCEPTION 'Supporting inventory record does not match this stock exception.' USING ERRCODE='23514'; END IF;
  IF (NEW.resolution_type='OMITTED_RECEIPT' AND movement.movement_type<>'RECEIPT')
     OR (NEW.resolution_type='VERIFIED_COUNT_ADJUSTMENT' AND movement.movement_type<>'COUNT_ADJUSTMENT')
     OR movement.quantity_delta<=0 THEN RAISE EXCEPTION 'Supporting inventory record is not valid for this resolution type.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(quantity),0),COALESCE(sum(provisional_cogs_released_minor),0)
    INTO used_quantity,used_provisional FROM inventory.sale_shortfall_resolutions
    WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND shortfall_id=NEW.shortfall_id;
  IF used_quantity+NEW.quantity>s.quantity OR used_provisional+NEW.provisional_cogs_released_minor>s.provisional_cogs_minor THEN
    RAISE EXCEPTION 'Stock exception resolution exceeds its remaining quantity or provisional cost.' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(quantity),0) INTO used_quantity FROM inventory.sale_shortfall_resolutions
    WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND supporting_movement_id=NEW.supporting_movement_id;
  IF used_quantity+NEW.quantity>movement.quantity_delta THEN
    RAISE EXCEPTION 'Supporting inventory record quantity has already been allocated.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_shortfall_resolution_allocation_guard
  BEFORE INSERT ON inventory.sale_shortfall_resolutions
  FOR EACH ROW EXECUTE FUNCTION inventory.validate_sale_shortfall_resolution_allocation();

CREATE FUNCTION inventory.guard_sale_shortfall_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Stock exception evidence cannot be deleted.' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['resolved_quantity', 'version']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['resolved_quantity', 'version'])
     OR NEW.resolved_quantity < OLD.resolved_quantity
     OR NEW.resolved_quantity > OLD.quantity
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Stock exception history is immutable; append a linked resolution.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_shortfalls_append_only
  BEFORE UPDATE OR DELETE ON inventory.sale_shortfalls
  FOR EACH ROW EXECUTE FUNCTION inventory.guard_sale_shortfall_update();

CREATE FUNCTION inventory.reject_sale_shortfall_resolution_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock exception resolution evidence is immutable.' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER sale_shortfall_resolutions_immutable
  BEFORE UPDATE OR DELETE ON inventory.sale_shortfall_resolutions
  FOR EACH ROW EXECUTE FUNCTION inventory.reject_sale_shortfall_resolution_mutation();

ALTER TABLE commerce.shift_close_reports
  ADD COLUMN stock_exception_sales_count integer NOT NULL DEFAULT 0 CHECK (stock_exception_sales_count >= 0);
