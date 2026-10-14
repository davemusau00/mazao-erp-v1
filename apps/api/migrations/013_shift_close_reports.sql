ALTER TABLE commerce.shifts
  ADD CONSTRAINT commerce_shifts_close_report_identity_key UNIQUE (tenant_id, outlet_id, id, operator_id);

CREATE TABLE commerce.shift_close_reports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  command_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  tenant_name_snapshot text NOT NULL,
  outlet_name_snapshot text NOT NULL,
  operator_name_snapshot text NOT NULL,
  time_zone_snapshot text NOT NULL,
  business_date date NOT NULL,
  currency char(3) NOT NULL,
  shift_version bigint NOT NULL CHECK (shift_version >= 2),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  opening_float_minor bigint NOT NULL CHECK (opening_float_minor >= 0),
  cash_sales_minor bigint NOT NULL CHECK (cash_sales_minor >= 0),
  customer_collections_minor bigint NOT NULL CHECK (customer_collections_minor >= 0),
  cash_refunds_minor bigint NOT NULL CHECK (cash_refunds_minor >= 0),
  cash_paid_in_minor bigint NOT NULL CHECK (cash_paid_in_minor >= 0),
  cash_payout_minor bigint NOT NULL CHECK (cash_payout_minor >= 0),
  expected_cash_minor bigint NOT NULL CHECK (expected_cash_minor >= 0),
  counted_cash_minor bigint NOT NULL CHECK (counted_cash_minor >= 0),
  variance_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, outlet_id, shift_id),
  UNIQUE (tenant_id, command_id),
  FOREIGN KEY (tenant_id, outlet_id, shift_id, operator_id)
    REFERENCES commerce.shifts(tenant_id, outlet_id, id, operator_id),
  CHECK (
    expected_cash_minor::numeric = opening_float_minor::numeric + cash_sales_minor::numeric
      + customer_collections_minor::numeric + cash_paid_in_minor::numeric
      - cash_payout_minor::numeric - cash_refunds_minor::numeric
  ),
  CHECK (variance_minor::numeric = counted_cash_minor::numeric - expected_cash_minor::numeric)
);

CREATE INDEX commerce_shift_close_reports_history_idx
  ON commerce.shift_close_reports(tenant_id, outlet_id, closed_at DESC, id DESC);

CREATE FUNCTION commerce.reject_shift_close_report_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shift close reports are immutable evidence.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER shift_close_reports_immutable
  BEFORE UPDATE OR DELETE ON commerce.shift_close_reports
  FOR EACH ROW EXECUTE FUNCTION commerce.reject_shift_close_report_mutation();
