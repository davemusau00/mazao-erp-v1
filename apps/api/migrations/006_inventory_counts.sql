DO $$
DECLARE
  movement_check text;
BEGIN
  SELECT conname INTO movement_check
  FROM pg_constraint
  WHERE conrelid = 'inventory.movements'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%movement_type%';
  IF movement_check IS NOT NULL THEN
    EXECUTE format('ALTER TABLE inventory.movements DROP CONSTRAINT %I', movement_check);
  END IF;
END $$;

ALTER TABLE inventory.movements
  ADD CONSTRAINT inventory_movements_type_allowed_check
  CHECK (movement_type IN ('OPENING', 'RECEIPT', 'SALE', 'REFUND', 'COUNT_ADJUSTMENT'));

CREATE TABLE inventory.stock_counts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'POSTED', 'CANCELLED')),
  count_mode text NOT NULL DEFAULT 'FULL' CHECK (count_mode = 'FULL'),
  area_label text CHECK (area_label IS NULL OR length(trim(area_label)) BETWEEN 1 AND 100),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  baseline_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid NOT NULL REFERENCES identity.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid REFERENCES identity.users(id),
  posted_at timestamptz,
  cancelled_by uuid REFERENCES identity.users(id),
  cancelled_at timestamptz,
  UNIQUE (tenant_id, outlet_id, id),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id),
  CHECK ((status = 'POSTED' AND posted_at IS NOT NULL AND posted_by IS NOT NULL)
      OR (status <> 'POSTED' AND posted_at IS NULL AND posted_by IS NULL)),
  CHECK ((status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
      OR (status <> 'CANCELLED' AND cancelled_at IS NULL AND cancelled_by IS NULL))
);

CREATE UNIQUE INDEX inventory_one_open_full_count_per_outlet
  ON inventory.stock_counts(tenant_id, outlet_id)
  WHERE status = 'OPEN';

CREATE TABLE inventory.stock_count_lines (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  count_id uuid NOT NULL,
  product_id uuid NOT NULL,
  sku_snapshot text NOT NULL,
  name_snapshot text NOT NULL,
  base_unit_snapshot text NOT NULL,
  baseline_quantity numeric(20,6) NOT NULL CHECK (baseline_quantity >= 0),
  baseline_balance_version bigint NOT NULL CHECK (baseline_balance_version > 0),
  baseline_unit_cost_minor bigint NOT NULL CHECK (baseline_unit_cost_minor >= 0),
  counted_quantity numeric(20,6) CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  variance_reason text CHECK (variance_reason IS NULL OR length(trim(variance_reason)) BETWEEN 1 AND 200),
  counted_by uuid REFERENCES identity.users(id),
  counted_at timestamptz,
  PRIMARY KEY (tenant_id, outlet_id, count_id, product_id),
  FOREIGN KEY (tenant_id, outlet_id, count_id) REFERENCES inventory.stock_counts(tenant_id, outlet_id, id),
  FOREIGN KEY (tenant_id, outlet_id, product_id) REFERENCES catalog.products(tenant_id, outlet_id, id),
  CHECK ((counted_quantity IS NULL) = (counted_at IS NULL AND counted_by IS NULL))
);

CREATE INDEX inventory_stock_count_lines_product_idx
  ON inventory.stock_count_lines(tenant_id, outlet_id, product_id, count_id);
