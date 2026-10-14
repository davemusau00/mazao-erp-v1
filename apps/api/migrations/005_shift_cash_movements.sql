ALTER TABLE commerce.shifts
  ADD CONSTRAINT commerce_shifts_tenant_outlet_id_key UNIQUE (tenant_id, outlet_id, id);

CREATE TABLE commerce.shift_cash_movements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity.users(id),
  movement_type text NOT NULL CHECK (movement_type IN ('PAID_IN', 'PAYOUT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 200),
  reference text CHECK (reference IS NULL OR length(reference) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, command_id),
  FOREIGN KEY (tenant_id, outlet_id) REFERENCES core.outlets(tenant_id, id),
  FOREIGN KEY (tenant_id, outlet_id, shift_id) REFERENCES commerce.shifts(tenant_id, outlet_id, id)
);

CREATE INDEX commerce_shift_cash_movements_history_idx
  ON commerce.shift_cash_movements(tenant_id, outlet_id, shift_id, created_at DESC, id DESC);
