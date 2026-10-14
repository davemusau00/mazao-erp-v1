CREATE TABLE catalog.product_import_batches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 160),
  raw_source text NOT NULL,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_bytes integer NOT NULL CHECK (source_bytes BETWEEN 0 AND 524288),
  column_mapping jsonb NOT NULL CHECK (jsonb_typeof(column_mapping) = 'object'),
  import_mode text NOT NULL CHECK (import_mode IN ('CREATE_ONLY','UPSERT')),
  status text NOT NULL CHECK (status IN ('READY','INVALID','APPLIED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  configuration_snapshot jsonb NOT NULL CHECK (jsonb_typeof(configuration_snapshot) = 'object'),
  validation_report jsonb NOT NULL CHECK (jsonb_typeof(validation_report) = 'object'),
  validation_sha256 char(64) NOT NULL,
  applied_at timestamptz,
  applied_by uuid,
  apply_result jsonb,
  UNIQUE (tenant_id, outlet_id, id),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES identity.memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, applied_by) REFERENCES identity.memberships(tenant_id, user_id),
  CHECK ((status='APPLIED') = (applied_at IS NOT NULL AND applied_by IS NOT NULL AND apply_result IS NOT NULL))
);
CREATE INDEX product_import_history_idx ON catalog.product_import_batches(tenant_id,outlet_id,created_at DESC);

ALTER TABLE catalog.products
  ADD COLUMN category text NOT NULL DEFAULT '' CHECK (length(category) <= 80),
  ADD COLUMN barcode text CHECK (barcode IS NULL OR length(barcode) BETWEEN 1 AND 64),
  ADD COLUMN reorder_level numeric(20,6) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  ADD COLUMN last_import_batch_id uuid,
  ADD CONSTRAINT product_import_batch_scope_fk FOREIGN KEY (tenant_id,outlet_id,last_import_batch_id)
    REFERENCES catalog.product_import_batches(tenant_id,outlet_id,id);
CREATE UNIQUE INDEX products_outlet_barcode_unique ON catalog.products(tenant_id,outlet_id,barcode) WHERE barcode IS NOT NULL;

ALTER TABLE inventory.movements DROP CONSTRAINT inventory_movements_type_allowed_check;
ALTER TABLE inventory.movements ADD CONSTRAINT inventory_movements_type_allowed_check
  CHECK (movement_type IN ('OPENING','OPENING_IMPORT','RECEIPT','SALE','REFUND','COUNT_ADJUSTMENT'));
