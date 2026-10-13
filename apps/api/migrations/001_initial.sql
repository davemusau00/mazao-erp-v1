CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS system;

CREATE TABLE IF NOT EXISTS system.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  time_zone text NOT NULL DEFAULT 'Africa/Nairobi',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core.outlets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  name text NOT NULL,
  time_zone text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id)
);
CREATE TABLE identity.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity.memberships (
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  user_id uuid NOT NULL REFERENCES identity.users(id),
  role text NOT NULL CHECK (role IN ('admin','owner','manager','accountant','cashier','storekeeper','receptionist','housekeeper','waiter','cook','bartender')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE identity.devices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  outlet_id uuid NOT NULL,
  assigned_user_id uuid NOT NULL REFERENCES identity.users(id),
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id),
  UNIQUE (tenant_id, outlet_id, id)
);
CREATE TABLE identity.sessions (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  csrf_hash bytea NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  device_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES identity.memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, outlet_id, device_id) REFERENCES identity.devices(tenant_id, outlet_id, id)
);
CREATE INDEX identity_sessions_expiry_idx ON identity.sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE catalog.products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  outlet_id uuid NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  base_unit text NOT NULL,
  currency char(3) NOT NULL,
  selling_price_minor bigint NOT NULL CHECK (selling_price_minor >= 0),
  cost_price_minor bigint NOT NULL CHECK (cost_price_minor >= 0),
  tax_rate_bps integer NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, outlet_id, sku),
  UNIQUE (tenant_id, outlet_id, id),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id)
);
CREATE TABLE inventory.balances (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, outlet_id, product_id),
  FOREIGN KEY (tenant_id, outlet_id, product_id) REFERENCES catalog.products(tenant_id, outlet_id, id)
);
CREATE TABLE commerce.shifts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  operator_id uuid NOT NULL REFERENCES identity.users(id),
  status text NOT NULL CHECK (status IN ('OPEN','CLOSED')),
  opening_float_minor bigint NOT NULL CHECK (opening_float_minor >= 0),
  cash_sales_minor bigint NOT NULL DEFAULT 0,
  card_sales_minor bigint NOT NULL DEFAULT 0,
  expected_cash_minor bigint NOT NULL DEFAULT 0,
  counted_cash_minor bigint,
  variance_minor bigint,
  version bigint NOT NULL DEFAULT 1,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id)
);
CREATE UNIQUE INDEX commerce_one_open_shift_per_operator ON commerce.shifts(tenant_id, outlet_id, operator_id) WHERE status = 'OPEN';
CREATE TABLE commerce.orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  shift_id uuid NOT NULL REFERENCES commerce.shifts(id),
  operator_id uuid NOT NULL REFERENCES identity.users(id),
  currency char(3) NOT NULL,
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  status text NOT NULL CHECK (status IN ('CONFIRMED','REFUNDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id)
);
CREATE TABLE commerce.order_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES commerce.orders(id),
  product_id uuid NOT NULL,
  sku_snapshot text NOT NULL,
  name_snapshot text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL,
  cost_price_minor bigint NOT NULL,
  tax_rate_bps integer NOT NULL,
  line_subtotal_minor bigint NOT NULL,
  line_tax_minor bigint NOT NULL,
  FOREIGN KEY (tenant_id, outlet_id, product_id) REFERENCES catalog.products(tenant_id, outlet_id, id)
);
CREATE TABLE commerce.payments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES commerce.orders(id),
  method text NOT NULL CHECK (method IN ('CASH')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('CONFIRMED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id)
);
CREATE TABLE inventory.movements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  product_id uuid NOT NULL,
  command_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('OPENING','RECEIPT','SALE','REFUND')),
  quantity_delta numeric(20,6) NOT NULL,
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, outlet_id, product_id) REFERENCES catalog.products(tenant_id, outlet_id, id),
  UNIQUE (tenant_id, command_id, product_id, movement_type)
);
CREATE TABLE finance.journal_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  currency char(3) NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES identity.users(id),
  UNIQUE (tenant_id, source_type, source_id)
);
CREATE TABLE finance.journal_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL REFERENCES finance.journal_entries(id),
  account_code text NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);
CREATE FUNCTION finance.assert_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_id uuid; debit_total numeric; credit_total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN entry_id := OLD.journal_entry_id;
  ELSE entry_id := NEW.journal_entry_id;
  END IF;
  SELECT COALESCE(sum(debit_minor),0), COALESCE(sum(credit_minor),0)
    INTO debit_total, credit_total FROM finance.journal_lines WHERE journal_entry_id = entry_id;
  IF debit_total = 0 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'journal entry % is not balanced', entry_id USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON finance.journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.assert_journal_balanced();

CREATE TABLE system.commands (
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity.users(id),
  device_id uuid NOT NULL REFERENCES identity.devices(id),
  command_type text NOT NULL,
  request_hash bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('EXECUTING','CONFIRMED','REJECTED','CONFLICT')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, command_id)
);
CREATE TABLE system.audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  outlet_id uuid,
  actor_id uuid NOT NULL REFERENCES identity.users(id),
  command_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE system.transactional_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  command_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (tenant_id, command_id, event_type)
);
CREATE INDEX system_outbox_pending_idx ON system.transactional_outbox(created_at) WHERE processed_at IS NULL;
