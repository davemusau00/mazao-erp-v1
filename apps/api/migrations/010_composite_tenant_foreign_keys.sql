-- Add tenant-scoped integrity to the legacy sales and journal relationships.
-- NOT VALID keeps each ADD fast; VALIDATE makes this migration fail closed if
-- existing rows cross tenant/outlet boundaries.

ALTER TABLE identity.devices
  ADD CONSTRAINT identity_devices_tenant_id_unique UNIQUE (tenant_id, id);
ALTER TABLE finance.journal_entries
  ADD CONSTRAINT finance_journal_entries_tenant_id_unique UNIQUE (tenant_id, id);

CREATE INDEX identity_devices_member_idx
  ON identity.devices (tenant_id, assigned_user_id);
CREATE INDEX commerce_shifts_operator_membership_idx
  ON commerce.shifts (tenant_id, operator_id);
CREATE INDEX commerce_orders_shift_scope_idx
  ON commerce.orders (tenant_id, outlet_id, shift_id);
CREATE INDEX commerce_orders_operator_membership_idx
  ON commerce.orders (tenant_id, operator_id);
CREATE INDEX commerce_payments_order_scope_idx
  ON commerce.payments (tenant_id, outlet_id, order_id);
CREATE INDEX finance_journal_entries_creator_membership_idx
  ON finance.journal_entries (tenant_id, created_by);
CREATE INDEX finance_journal_lines_entry_scope_idx
  ON finance.journal_lines (tenant_id, journal_entry_id);

ALTER TABLE identity.devices
  ADD CONSTRAINT identity_devices_assigned_member_fk
  FOREIGN KEY (tenant_id, assigned_user_id)
  REFERENCES identity.memberships (tenant_id, user_id) NOT VALID;
ALTER TABLE commerce.shifts
  ADD CONSTRAINT commerce_shifts_operator_membership_fk
  FOREIGN KEY (tenant_id, operator_id)
  REFERENCES identity.memberships (tenant_id, user_id) NOT VALID;
ALTER TABLE commerce.orders
  ADD CONSTRAINT commerce_orders_shift_scope_fk
  FOREIGN KEY (tenant_id, outlet_id, shift_id)
  REFERENCES commerce.shifts (tenant_id, outlet_id, id) NOT VALID;
ALTER TABLE commerce.orders
  ADD CONSTRAINT commerce_orders_operator_membership_fk
  FOREIGN KEY (tenant_id, operator_id)
  REFERENCES identity.memberships (tenant_id, user_id) NOT VALID;
ALTER TABLE commerce.order_lines
  ADD CONSTRAINT commerce_order_lines_order_scope_fk
  FOREIGN KEY (tenant_id, outlet_id, order_id)
  REFERENCES commerce.orders (tenant_id, outlet_id, id) NOT VALID;
ALTER TABLE commerce.payments
  ADD CONSTRAINT commerce_payments_order_scope_fk
  FOREIGN KEY (tenant_id, outlet_id, order_id)
  REFERENCES commerce.orders (tenant_id, outlet_id, id) NOT VALID;
ALTER TABLE finance.journal_entries
  ADD CONSTRAINT finance_journal_entries_creator_membership_fk
  FOREIGN KEY (tenant_id, created_by)
  REFERENCES identity.memberships (tenant_id, user_id) NOT VALID;
ALTER TABLE finance.journal_lines
  ADD CONSTRAINT finance_journal_lines_entry_scope_fk
  FOREIGN KEY (tenant_id, journal_entry_id)
  REFERENCES finance.journal_entries (tenant_id, id) NOT VALID;

ALTER TABLE identity.devices VALIDATE CONSTRAINT identity_devices_assigned_member_fk;
ALTER TABLE commerce.shifts VALIDATE CONSTRAINT commerce_shifts_operator_membership_fk;
ALTER TABLE commerce.orders VALIDATE CONSTRAINT commerce_orders_shift_scope_fk;
ALTER TABLE commerce.orders VALIDATE CONSTRAINT commerce_orders_operator_membership_fk;
ALTER TABLE commerce.order_lines VALIDATE CONSTRAINT commerce_order_lines_order_scope_fk;
ALTER TABLE commerce.payments VALIDATE CONSTRAINT commerce_payments_order_scope_fk;
ALTER TABLE finance.journal_entries VALIDATE CONSTRAINT finance_journal_entries_creator_membership_fk;
ALTER TABLE finance.journal_lines VALIDATE CONSTRAINT finance_journal_lines_entry_scope_fk;
