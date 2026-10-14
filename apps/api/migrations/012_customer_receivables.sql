ALTER TABLE commerce.shifts
  ADD COLUMN customer_collections_minor bigint NOT NULL DEFAULT 0 CHECK (customer_collections_minor >= 0);

ALTER TABLE commerce.orders
  ADD COLUMN customer_account_id uuid,
  ADD COLUMN customer_name_snapshot text,
  ADD COLUMN customer_amount_due_minor bigint NOT NULL DEFAULT 0 CHECK (customer_amount_due_minor >= 0);

CREATE TABLE finance.customer_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  phone text NOT NULL CHECK (length(trim(phone)) BETWEEN 3 AND 40),
  email text CHECK (email IS NULL OR length(email) <= 254),
  credit_limit_minor bigint NOT NULL CHECK (credit_limit_minor >= 0),
  balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

ALTER TABLE commerce.orders
  ADD CONSTRAINT commerce_orders_customer_reference_key UNIQUE (tenant_id, outlet_id, id, customer_account_id),
  ADD CONSTRAINT commerce_orders_customer_account_fk
    FOREIGN KEY (tenant_id, customer_account_id) REFERENCES finance.customer_accounts(tenant_id, id),
  ADD CONSTRAINT commerce_orders_customer_charge_snapshot_check CHECK (
    (customer_account_id IS NULL AND customer_name_snapshot IS NULL AND customer_amount_due_minor = 0)
    OR (customer_account_id IS NOT NULL AND customer_name_snapshot IS NOT NULL AND customer_amount_due_minor <= total_minor)
  );

CREATE TABLE finance.customer_charges (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  customer_account_id uuid NOT NULL,
  order_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, outlet_id, order_id),
  UNIQUE (tenant_id, id, customer_account_id),
  FOREIGN KEY (tenant_id, customer_account_id) REFERENCES finance.customer_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, outlet_id, order_id, customer_account_id) REFERENCES commerce.orders(tenant_id, outlet_id, id, customer_account_id)
);

CREATE TABLE finance.customer_repayments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  customer_account_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity.users(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  reference text CHECK (reference IS NULL OR length(reference) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, command_id),
  UNIQUE (tenant_id, id, customer_account_id),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id),
  FOREIGN KEY (tenant_id, customer_account_id) REFERENCES finance.customer_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, outlet_id, shift_id) REFERENCES commerce.shifts(tenant_id, outlet_id, id)
);

CREATE TABLE finance.customer_repayment_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  repayment_id uuid NOT NULL,
  charge_id uuid NOT NULL,
  customer_account_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, repayment_id, charge_id),
  FOREIGN KEY (tenant_id, repayment_id, customer_account_id) REFERENCES finance.customer_repayments(tenant_id, id, customer_account_id),
  FOREIGN KEY (tenant_id, charge_id, customer_account_id) REFERENCES finance.customer_charges(tenant_id, id, customer_account_id)
);

CREATE INDEX finance_customer_accounts_name_idx
  ON finance.customer_accounts(tenant_id, lower(display_name), id);
CREATE INDEX finance_customer_charges_history_idx
  ON finance.customer_charges(tenant_id, customer_account_id, created_at, id);
CREATE INDEX finance_customer_repayments_history_idx
  ON finance.customer_repayments(tenant_id, customer_account_id, created_at DESC, id DESC);
CREATE INDEX finance_customer_repayment_allocations_charge_idx
  ON finance.customer_repayment_allocations(tenant_id, charge_id);
