-- Effective dates are additive. Historical journal rows retain their stored
-- timestamps and values; readers fall back to their tenant business date.
ALTER TABLE finance.journal_entries ADD COLUMN effective_date date;
CREATE INDEX finance_journal_effective_date_idx ON finance.journal_entries(tenant_id,effective_date,id);
ALTER TABLE core.tenants ADD COLUMN accounting_period_version bigint NOT NULL DEFAULT 0;

CREATE TABLE finance.accounting_periods (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  from_date date NOT NULL, to_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSING','CLOSED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,from_date,to_date), CHECK (from_date<=to_date)
);
CREATE INDEX accounting_period_dates_idx ON finance.accounting_periods(tenant_id,from_date,to_date);
CREATE TABLE finance.accounting_period_events (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, period_id uuid NOT NULL,
  command_id uuid NOT NULL, actor_id uuid NOT NULL, operator_name_snapshot text NOT NULL,
  from_status text, to_status text NOT NULL, reason text NOT NULL, checks jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,period_id) REFERENCES finance.accounting_periods(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);

-- The epoch row lock is essential with SERIALIZABLE transactions: a posting
-- waiting behind a newly created/closed period must restart its stale snapshot.
CREATE FUNCTION finance.initialize_and_guard_journal_date() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.tenant_id::text,9036));
  PERFORM accounting_period_version FROM core.tenants WHERE id=NEW.tenant_id FOR SHARE;
  IF NEW.effective_date IS NULL THEN
    SELECT (NEW.posted_at AT TIME ZONE t.time_zone)::date INTO NEW.effective_date FROM core.tenants t WHERE t.id=NEW.tenant_id;
  END IF;
  IF EXISTS (SELECT 1 FROM finance.accounting_periods WHERE tenant_id=NEW.tenant_id
      AND NEW.effective_date BETWEEN from_date AND to_date AND status IN ('CLOSING','CLOSED')) THEN
    RAISE EXCEPTION 'Accounting date belongs to a period that is closing or closed.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_effective_date_guard BEFORE INSERT ON finance.journal_entries
  FOR EACH ROW EXECUTE FUNCTION finance.initialize_and_guard_journal_date();

CREATE TABLE finance.outgoing_payments (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL,
  command_id uuid NOT NULL, source_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('EXPENSE','SUPPLIER_PAYMENT')),
  effective_date date NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0), currency char(3) NOT NULL,
  payment_account text NOT NULL CHECK(payment_account IN ('BANK_CONTROL','MOBILE_MONEY_CONTROL')),
  reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 4 AND 120),
  description text NOT NULL, actor_id uuid NOT NULL, operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,command_id), UNIQUE(tenant_id,payment_account,reference),
  FOREIGN KEY(tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);
CREATE TABLE finance.expenses (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, command_id uuid NOT NULL,
  payment_id uuid NOT NULL, effective_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0), currency char(3) NOT NULL,
  category text NOT NULL CHECK(category IN ('OPERATING_EXPENSE','RENT_EXPENSE','UTILITIES_EXPENSE')),
  description text NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 500), payee text,
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  actor_id uuid NOT NULL, operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,command_id), UNIQUE(tenant_id,payment_id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES finance.outgoing_payments(tenant_id,id),
  FOREIGN KEY(tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);
CREATE TABLE finance.expense_reversals (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, expense_id uuid NOT NULL, command_id uuid NOT NULL,
  effective_date date NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
  actor_id uuid NOT NULL, operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,expense_id), UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,expense_id) REFERENCES finance.expenses(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);
CREATE TABLE finance.expense_reclassifications (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, expense_id uuid NOT NULL, command_id uuid NOT NULL,
  effective_date date NOT NULL, from_category text NOT NULL, to_category text NOT NULL,
  version bigint NOT NULL CHECK(version>=2), reason text NOT NULL, actor_id uuid NOT NULL, operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,expense_id,version), UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,expense_id) REFERENCES finance.expenses(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id),
  CHECK(from_category IN ('OPERATING_EXPENSE','RENT_EXPENSE','UTILITIES_EXPENSE')),
  CHECK(to_category IN ('OPERATING_EXPENSE','RENT_EXPENSE','UTILITIES_EXPENSE')), CHECK(from_category<>to_category)
);

CREATE TABLE finance.suppliers (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160), phone text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(tenant_id,id)
);
CREATE TABLE finance.supplier_invoices (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL,
  command_id uuid NOT NULL, supplier_id uuid NOT NULL, supplier_name_snapshot text NOT NULL,
  reference text NOT NULL, invoice_date date NOT NULL, due_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0), currency char(3) NOT NULL,
  kind text NOT NULL CHECK(kind IN ('EXPENSE','RECEIPT')), category text, receipt_command_id uuid,
  description text NOT NULL, paid_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','REVERSED')),
  version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,supplier_id) REFERENCES finance.suppliers(tenant_id,id),
  FOREIGN KEY(tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id),
  CHECK(due_date>=invoice_date), CHECK(paid_minor>=0 AND paid_minor<=amount_minor),
  CHECK(status<>'REVERSED' OR paid_minor=0),
  CHECK((kind='EXPENSE' AND category IS NOT NULL AND category IN ('OPERATING_EXPENSE','RENT_EXPENSE','UTILITIES_EXPENSE') AND receipt_command_id IS NULL)
    OR (kind='RECEIPT' AND category IS NULL AND receipt_command_id IS NOT NULL))
);
-- An unpaid invoice may be reversed with linked evidence and then recorded
-- correctly. Only one active liability may claim its invoice/received stock.
CREATE UNIQUE INDEX supplier_invoice_reference_active ON finance.supplier_invoices(tenant_id,supplier_id,reference) WHERE status='OPEN';
CREATE UNIQUE INDEX supplier_invoice_receipt_once ON finance.supplier_invoices(tenant_id,receipt_command_id) WHERE receipt_command_id IS NOT NULL AND status='OPEN';
CREATE TABLE finance.supplier_payments (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, invoice_id uuid NOT NULL, payment_id uuid NOT NULL,
  command_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0), effective_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,command_id), UNIQUE(tenant_id,payment_id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES finance.supplier_invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES finance.outgoing_payments(tenant_id,id)
);
CREATE TABLE finance.supplier_invoice_reversals (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, invoice_id uuid NOT NULL, command_id uuid NOT NULL,
  effective_date date NOT NULL, reason text NOT NULL, actor_id uuid NOT NULL, operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,invoice_id), UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES finance.supplier_invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);

-- Incoming statement entries only. Recording/matching evidence never posts a
-- journal, changes a receipt, initiates a transfer or claims bank reconciliation.
CREATE TABLE finance.mpesa_statements (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES core.tenants(id), command_id uuid NOT NULL,
  reference text NOT NULL, from_date date NOT NULL, to_date date NOT NULL, currency char(3) NOT NULL,
  actor_id uuid NOT NULL, operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,command_id), UNIQUE(tenant_id,reference), CHECK(from_date<=to_date),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);
CREATE TABLE finance.mpesa_statement_lines (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, statement_id uuid NOT NULL,
  reference text NOT NULL, occurred_on date NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency char(3) NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,reference),
  FOREIGN KEY(tenant_id,statement_id) REFERENCES finance.mpesa_statements(tenant_id,id)
);
CREATE TABLE finance.mpesa_statement_reference_claims (
  tenant_id uuid NOT NULL, reference text NOT NULL, line_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,reference),
  FOREIGN KEY(tenant_id,line_id) REFERENCES finance.mpesa_statement_lines(tenant_id,id)
);
CREATE TABLE finance.mpesa_statement_line_corrections (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, line_id uuid NOT NULL, command_id uuid NOT NULL,
  reference text NOT NULL, occurred_on date NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0),
  version bigint NOT NULL CHECK(version>=2), reason text NOT NULL, actor_id uuid NOT NULL, operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,line_id,version), UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,line_id) REFERENCES finance.mpesa_statement_lines(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);
ALTER TABLE commerce.payments ADD CONSTRAINT commerce_payments_tenant_id_unique UNIQUE(tenant_id,id);
CREATE TABLE finance.mpesa_statement_matches (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, line_id uuid NOT NULL, payment_id uuid NOT NULL,
  command_id uuid NOT NULL, actor_id uuid NOT NULL, operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,line_id), UNIQUE(tenant_id,payment_id), UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,line_id) REFERENCES finance.mpesa_statement_lines(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES commerce.payments(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);

CREATE FUNCTION finance.reject_accounting_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Posted accounting evidence is immutable; record a linked correction.' USING ERRCODE='55000'; END $$;
CREATE FUNCTION finance.guard_supplier_invoice_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['paid_minor','version','status']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['paid_minor','version','status']) THEN
    RAISE EXCEPTION 'Supplier invoice evidence is immutable.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_invoice_evidence_immutable BEFORE UPDATE OR DELETE ON finance.supplier_invoices FOR EACH ROW EXECUTE FUNCTION finance.guard_supplier_invoice_evidence();
CREATE FUNCTION finance.guard_expense_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') THEN
    RAISE EXCEPTION 'Expense payment evidence is immutable.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expense_evidence_immutable BEFORE UPDATE OR DELETE ON finance.expenses FOR EACH ROW EXECUTE FUNCTION finance.guard_expense_evidence();
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['accounting_period_events','outgoing_payments','expense_reversals','expense_reclassifications','supplier_payments','supplier_invoice_reversals','mpesa_statements','mpesa_statement_lines','mpesa_statement_matches','mpesa_statement_reference_claims','mpesa_statement_line_corrections'] LOOP
    EXECUTE format('CREATE TRIGGER accounting_evidence_immutable BEFORE UPDATE OR DELETE ON finance.%I FOR EACH ROW EXECUTE FUNCTION finance.reject_accounting_evidence_mutation()',table_name);
  END LOOP;
END $$;

CREATE INDEX accounting_expense_history ON finance.expenses(tenant_id,created_at DESC,id DESC);
CREATE INDEX accounting_invoice_history ON finance.supplier_invoices(tenant_id,created_at DESC,id DESC);
CREATE INDEX accounting_outgoing_history ON finance.outgoing_payments(tenant_id,created_at DESC,id DESC);
CREATE INDEX accounting_statement_line_history ON finance.mpesa_statement_lines(tenant_id,created_at DESC,id DESC);
CREATE INDEX accounting_statement_match_payment ON finance.mpesa_statement_matches(tenant_id,payment_id);
