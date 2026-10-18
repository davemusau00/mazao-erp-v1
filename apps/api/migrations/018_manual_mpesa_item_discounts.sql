-- Add evidence for new sales without rewriting existing prices, receipts,
-- journals, payments or immutable cash close reports. Existing discounts are zero.
ALTER TABLE commerce.order_lines
  ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  ADD COLUMN discount_reason text,
  ADD CONSTRAINT order_line_discount_reason_check CHECK (
    (discount_minor = 0 AND discount_reason IS NULL)
    OR (discount_minor > 0 AND discount_reason IS NOT NULL AND length(trim(discount_reason)) BETWEEN 3 AND 300)
  );

ALTER TABLE commerce.refund_lines
  ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0);

-- A fully discounted item may be returned for stock with no money payable.
-- The sale itself must still have a positive total. Such a return has no empty
-- cash/revenue journal; any restocked original COGS is reversed normally.
ALTER TABLE commerce.refunds DROP CONSTRAINT refunds_total_minor_check;
ALTER TABLE commerce.refunds ADD CONSTRAINT refunds_total_minor_check CHECK (total_minor >= 0);

ALTER TABLE commerce.payments DROP CONSTRAINT payments_method_check;
ALTER TABLE commerce.payments
  ADD CONSTRAINT payments_method_check CHECK (method IN ('CASH','MANUAL_MPESA')),
  ADD COLUMN reference text,
  ADD COLUMN manually_confirmed_by uuid,
  ADD COLUMN manually_confirmed_at timestamptz,
  ADD COLUMN confirmed_operator_name_snapshot text,
  ADD CONSTRAINT payments_manual_confirmation_actor_fk
    FOREIGN KEY (tenant_id,manually_confirmed_by) REFERENCES identity.memberships(tenant_id,user_id),
  ADD CONSTRAINT payments_manual_confirmation_check CHECK (
    (method='CASH' AND reference IS NULL AND manually_confirmed_by IS NULL
      AND manually_confirmed_at IS NULL AND confirmed_operator_name_snapshot IS NULL)
    OR (method='MANUAL_MPESA' AND reference IS NOT NULL
      AND reference ~ '^[A-Z0-9][A-Z0-9-]{3,63}$'
      AND manually_confirmed_by IS NOT NULL AND manually_confirmed_at IS NOT NULL
      AND confirmed_operator_name_snapshot IS NOT NULL
      AND length(trim(confirmed_operator_name_snapshot)) BETWEEN 1 AND 160)
  );

-- References remain reserved permanently, including after a future reversal.
-- This protects concurrent operators and different outlets within one business.
CREATE UNIQUE INDEX commerce_payments_manual_mpesa_reference_unique
  ON commerce.payments(tenant_id,reference) WHERE method='MANUAL_MPESA';

CREATE FUNCTION commerce.reject_sale_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted sale, payment and return item evidence is immutable.' USING ERRCODE='55000';
END $$;
CREATE TRIGGER payment_evidence_immutable
  BEFORE UPDATE OR DELETE ON commerce.payments
  FOR EACH ROW EXECUTE FUNCTION commerce.reject_sale_evidence_mutation();
CREATE TRIGGER order_line_evidence_immutable
  BEFORE UPDATE OR DELETE ON commerce.order_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.reject_sale_evidence_mutation();
CREATE TRIGGER refund_line_evidence_immutable
  BEFORE UPDATE OR DELETE ON commerce.refund_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.reject_sale_evidence_mutation();

ALTER TABLE commerce.shifts
  ADD COLUMN mpesa_sales_minor bigint NOT NULL DEFAULT 0 CHECK (mpesa_sales_minor >= 0);
ALTER TABLE commerce.shift_close_reports
  ADD COLUMN mpesa_sales_minor bigint NOT NULL DEFAULT 0 CHECK (mpesa_sales_minor >= 0);
