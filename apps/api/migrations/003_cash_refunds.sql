ALTER TABLE commerce.orders DROP CONSTRAINT commerce_orders_status_check;
ALTER TABLE commerce.orders ADD CONSTRAINT commerce_orders_status_check
  CHECK (status IN ('CONFIRMED','PARTIALLY_REFUNDED','REFUNDED'));
ALTER TABLE commerce.orders ADD CONSTRAINT commerce_orders_tenant_outlet_id_unique
  UNIQUE (tenant_id,outlet_id,id);
ALTER TABLE commerce.order_lines ADD CONSTRAINT commerce_order_lines_tenant_order_id_unique
  UNIQUE (tenant_id,outlet_id,order_id,id);
ALTER TABLE commerce.shifts ADD CONSTRAINT commerce_shifts_tenant_outlet_id_unique
  UNIQUE (tenant_id,outlet_id,id);
ALTER TABLE commerce.shifts ADD COLUMN cash_refunds_minor bigint NOT NULL DEFAULT 0 CHECK (cash_refunds_minor >= 0);

CREATE TABLE commerce.refunds (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity.users(id),
  currency char(3) NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,command_id),
  UNIQUE (tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id,order_id) REFERENCES commerce.orders(tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id,shift_id) REFERENCES commerce.shifts(tenant_id,outlet_id,id)
);

CREATE TABLE commerce.refund_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  refund_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  cogs_minor bigint NOT NULL CHECK (cogs_minor >= 0),
  restocked boolean NOT NULL,
  FOREIGN KEY (tenant_id,outlet_id,refund_id) REFERENCES commerce.refunds(tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id,order_id,order_line_id) REFERENCES commerce.order_lines(tenant_id,outlet_id,order_id,id),
  FOREIGN KEY (tenant_id,outlet_id,product_id) REFERENCES catalog.products(tenant_id,outlet_id,id)
);
CREATE INDEX commerce_refunds_order_idx ON commerce.refunds(tenant_id,outlet_id,order_id,created_at);
CREATE INDEX commerce_refund_lines_order_line_idx ON commerce.refund_lines(tenant_id,outlet_id,order_line_id);
