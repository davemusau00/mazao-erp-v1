import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { inReadSnapshot } from './db.js';
import { DomainError, ROLE_PERMISSIONS, type ApiSession, type CommandEnvelope } from './contracts.js';
import type { AccountingControls, AccountingRecordKind, AccountingRecordPage, ExpenseCategory, NoncashPaymentAccount } from '../../../src/types/accounting.js';

const categories = [{ code: 'OPERATING_EXPENSE', label: 'Other operating expense' }, { code: 'RENT_EXPENSE', label: 'Rent' }, { code: 'UTILITIES_EXPENSE', label: 'Utilities' }] as const;
const paymentAccounts = [{ code: 'BANK_CONTROL', label: 'Bank (manually recorded)' }, { code: 'MOBILE_MONEY_CONTROL', label: 'M-Pesa (manually recorded)' }] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const postingCommands = new Set(['inventory.receive', 'inventory.count.post', 'shift.open', 'shift.cash.movement', 'shift.close', 'sales.order.settle', 'sales.order.refund', 'customers.repayment', 'hotel.checkout', 'catalog.import.apply', 'finance.expense.record', 'finance.expense.reverse', 'finance.expense.reclassify', 'finance.supplier.invoice', 'finance.supplier.invoice.reverse', 'finance.supplier.payment']);
const financePostingCommands = new Set(['finance.expense.record', 'finance.expense.reverse', 'finance.expense.reclassify', 'finance.supplier.invoice', 'finance.supplier.invoice.reverse', 'finance.supplier.payment']);

function record(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new DomainError('VALIDATION_FAILED', 'Review the accounting details. An unsupported field was supplied.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, min = 1, max = 500) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new DomainError('VALIDATION_FAILED', `${label} needs ${min} to ${max} characters without control characters.`);
  return value.trim();
}
function optionalText(value: unknown, label: string, max: number): string | null { return value === undefined || value === null || value === '' ? null : text(value, label, 1, max); }
function id(value: unknown) { if (typeof value !== 'string' || !uuid.test(value)) throw new DomainError('VALIDATION_FAILED', 'Choose a valid accounting record.'); return value; }
function minor(value: unknown) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new DomainError('VALIDATION_FAILED', 'Enter a positive amount within the supported currency precision.'); return value; }
function date(value: unknown, label = 'Accounting date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError('VALIDATION_FAILED', `${label} must be a calendar date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError('VALIDATION_FAILED', `${label} is not a real calendar date.`);
  return value;
}
function category(value: unknown): ExpenseCategory { if (!categories.some(candidate => candidate.code === value)) throw new DomainError('VALIDATION_FAILED', 'Choose an available expense category. Inventory purchases must use a received-stock invoice.'); return value as ExpenseCategory; }
function paymentAccount(value: unknown): NoncashPaymentAccount { if (!paymentAccounts.some(candidate => candidate.code === value)) throw new DomainError('VALIDATION_FAILED', 'Choose a bank or M-Pesa payment account. Cash drawer expenses use the separate cash movement workflow.'); return value as NoncashPaymentAccount; }
function version(envelope: CommandEnvelope, key: string) { const value = envelope.expectedVersions[key]; if (!Number.isSafeInteger(value) || value < 1) throw new DomainError('VALIDATION_FAILED', 'Refresh this accounting record before changing it.'); return value; }
function requireView(session: ApiSession) { if (!ROLE_PERMISSIONS[session.role].includes('finance.view')) throw new DomainError('FORBIDDEN', 'Your role cannot review accounting records.', 403); }
async function scope(client: PoolClient, session: ApiSession) {
  const found = await client.query<{ currency: string; time_zone: string; business_date: string }>("SELECT currency,time_zone,to_char(transaction_timestamp() AT TIME ZONE time_zone,'YYYY-MM-DD') business_date FROM core.tenants WHERE id=$1", [session.tenantId]);
  if (!found.rowCount) throw new DomainError('NOT_FOUND', 'The business could not be found.', 404);
  return found.rows[0];
}

/** Called inside the existing command transaction before stock/cash writes.
 * Occurred-at is recovery evidence, never authority for a legacy posting date. */
export async function guardFinancialCommand(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  if (!postingCommands.has(envelope.type)) return;
  if (envelope.type === 'catalog.import.apply') {
    const batch = await client.query('SELECT validation_report FROM catalog.product_import_batches WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3', [session.tenantId, session.outletId, envelope.payload.batchId]);
    if (!batch.rowCount || BigInt(batch.rows[0].validation_report?.summary?.openingValueMinor ?? 0) === 0n) return;
  }
  await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1::text,9036))', [session.tenantId]);
  await client.query('SELECT accounting_period_version FROM core.tenants WHERE id=$1 FOR SHARE', [session.tenantId]);
  const current = await scope(client, session);
  const effectiveDate = financePostingCommands.has(envelope.type) ? date(envelope.type === 'finance.supplier.invoice' ? envelope.payload.invoiceDate : envelope.payload.effectiveDate) : current.business_date;
  if (effectiveDate > current.business_date) throw new DomainError('VALIDATION_FAILED', 'A future accounting date cannot be posted.');
  const period = await client.query('SELECT status FROM finance.accounting_periods WHERE tenant_id=$1 AND $2::date BETWEEN from_date AND to_date FOR SHARE', [session.tenantId, effectiveDate]);
  if (period.rows.some(row => row.status !== 'OPEN')) throw new DomainError('PERIOD_CLOSED', 'This accounting date is in a period that is closing or closed. Choose an open accounting date.', 409);
}

async function evidence(client: PoolClient, session: ApiSession, envelope: CommandEnvelope, value: unknown) {
  const body = JSON.stringify(value);
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)', [randomUUID(), session.tenantId, session.outletId, session.userId, envelope.commandId, envelope.type, body]);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)', [randomUUID(), session.tenantId, envelope.commandId, envelope.type, body]);
  return value;
}
async function post(client: PoolClient, session: ApiSession, envelope: CommandEnvelope, sourceType: string, effectiveDate: string, currency: string, debitAccount: string, creditAccount: string, amount: number) {
  const journalId = randomUUID();
  await client.query('INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by,effective_date) VALUES($1,$2,$3,$4,$5,$6,$7::date)', [journalId, session.tenantId, sourceType, envelope.commandId, currency, session.userId, effectiveDate]);
  await client.query('INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5,0),($6,$2,$3,$7,0,$5)', [randomUUID(), session.tenantId, journalId, debitAccount, amount, randomUUID(), creditAccount]);
  return journalId;
}
async function outgoing(client: PoolClient, session: ApiSession, envelope: CommandEnvelope, sourceId: string, kind: 'EXPENSE' | 'SUPPLIER_PAYMENT', payload: Record<string, unknown>, description: string) {
  if (payload.manuallyConfirmed !== true) throw new DomainError('PAYMENT_CONFIRMATION_REQUIRED', 'Check that the outgoing payment was completed before recording it. This action does not send money.');
  const current = await scope(client, session), currency = payload.currency;
  if (currency !== current.currency) throw new DomainError('VALIDATION_FAILED', 'The payment currency must match this business.');
  const account = paymentAccount(payload.paymentAccount), reference = text(payload.reference, 'Payment reference', 4, 120).toUpperCase();
  const amount = minor(payload.amountMinor), effectiveDate = date(payload.effectiveDate), paymentId = randomUUID();
  const inserted = await client.query(`INSERT INTO finance.outgoing_payments(id,tenant_id,outlet_id,command_id,source_id,kind,effective_date,amount_minor,currency,payment_account,reference,description,actor_id,operator_name_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT(tenant_id,payment_account,reference) DO NOTHING RETURNING id`, [paymentId, session.tenantId, session.outletId, envelope.commandId, sourceId, kind, effectiveDate, amount, currency, account, reference, description, session.userId, session.fullName]);
  if (!inserted.rowCount) throw new DomainError('DUPLICATE_PAYMENT_REFERENCE', 'This outgoing payment reference has already been recorded. Review its original entry.', 409);
  return { paymentId, amount, effectiveDate, currency: current.currency, account, reference };
}

async function expense(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload, ['effectiveDate','amountMinor','currency','category','description','payee','paymentAccount','reference','manuallyConfirmed']);
  const expenseId = randomUUID(), expenseCategory = category(p.category), description = text(p.description, 'Expense description', 3, 500), payee = optionalText(p.payee, 'Payee', 160);
  const paid = await outgoing(client, session, envelope, expenseId, 'EXPENSE', p, description);
  await client.query(`INSERT INTO finance.expenses(id,tenant_id,outlet_id,command_id,payment_id,effective_date,amount_minor,currency,category,description,payee,actor_id,operator_name_snapshot)
    VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13)`, [expenseId, session.tenantId, session.outletId, envelope.commandId, paid.paymentId, paid.effectiveDate, paid.amount, paid.currency, expenseCategory, description, payee, session.userId, session.fullName]);
  const journalId = await post(client, session, envelope, 'EXPENSE', paid.effectiveDate, paid.currency, expenseCategory, paid.account, paid.amount);
  return evidence(client, session, envelope, { expenseId, paymentId: paid.paymentId, journalId, amountMinor: String(paid.amount), currency: paid.currency, version:1, status: 'RECORDED' });
}
async function reverseExpense(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload, ['expenseId','effectiveDate','reason']), expenseId = id(p.expenseId), effectiveDate = date(p.effectiveDate), reason = text(p.reason, 'Correction reason', 3, 500);
  const found = await client.query(`SELECT e.*,coalesce(c.effective_date,e.effective_date)::text date_text,coalesce(c.to_category,e.category) current_category,p.payment_account FROM finance.expenses e JOIN finance.outgoing_payments p ON p.tenant_id=e.tenant_id AND p.id=e.payment_id
    LEFT JOIN LATERAL (SELECT * FROM finance.expense_reclassifications history WHERE history.tenant_id=e.tenant_id AND history.expense_id=e.id ORDER BY history.version DESC LIMIT 1) c ON true
    WHERE e.tenant_id=$1 AND e.id=$2 FOR UPDATE OF e`, [session.tenantId, expenseId]);
  if (!found.rowCount) throw new DomainError('NOT_FOUND', 'The expense could not be found.', 404);
  const e = found.rows[0], expected=version(envelope,`expense:${expenseId}`); if (effectiveDate < e.date_text) throw new DomainError('VALIDATION_FAILED', 'A correction cannot be dated before the original expense.');
  if (Number(e.version)!==expected) throw new DomainError('VERSION_CONFLICT','This expense changed. Review its latest category before voiding the record.',409);
  const reversalId = randomUUID();
  const inserted = await client.query(`INSERT INTO finance.expense_reversals(id,tenant_id,expense_id,command_id,effective_date,reason,actor_id,operator_name_snapshot) VALUES($1,$2,$3,$4,$5::date,$6,$7,$8) ON CONFLICT(tenant_id,expense_id) DO NOTHING RETURNING id`, [reversalId, session.tenantId, expenseId, envelope.commandId, effectiveDate, reason, session.userId, session.fullName]);
  if (!inserted.rowCount) throw new DomainError('ALREADY_REVERSED', 'This expense already has a correction entry.', 409);
  await client.query('UPDATE finance.expenses SET version=version+1 WHERE tenant_id=$1 AND id=$2',[session.tenantId,expenseId]);
  const journalId = await post(client, session, envelope, 'EXPENSE_REVERSAL', effectiveDate, e.currency, e.payment_account, e.current_category, Number(e.amount_minor));
  return evidence(client, session, envelope, { reversalId, expenseId, journalId, amountMinor: String(e.amount_minor), currency: e.currency, version:expected+1, status: 'REVERSED', moneyTransferInitiated: false });
}

async function reclassifyExpense(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload,['expenseId','effectiveDate','category','reason']), expenseId = id(p.expenseId), effectiveDate = date(p.effectiveDate), nextCategory = category(p.category), reason = text(p.reason,'Category correction reason',3,500);
  const found = await client.query(`SELECT e.*,coalesce(c.to_category,e.category) current_category,coalesce(c.effective_date,e.effective_date)::text date_text FROM finance.expenses e
    LEFT JOIN LATERAL (SELECT * FROM finance.expense_reclassifications history WHERE history.tenant_id=e.tenant_id AND history.expense_id=e.id ORDER BY history.version DESC LIMIT 1) c ON true
    WHERE e.tenant_id=$1 AND e.id=$2 FOR UPDATE OF e`,[session.tenantId,expenseId]);
  if (!found.rowCount) throw new DomainError('NOT_FOUND','The expense could not be found.',404);
  const e = found.rows[0], expected=version(envelope,`expense:${expenseId}`);
  if (Number(e.version)!==expected) throw new DomainError('VERSION_CONFLICT','This expense category changed. Review its current details before continuing.',409);
  if (effectiveDate<e.date_text) throw new DomainError('VALIDATION_FAILED','A category correction cannot precede the earlier expense or its latest category correction.');
  const reversed = await client.query('SELECT 1 FROM finance.expense_reversals WHERE tenant_id=$1 AND expense_id=$2',[session.tenantId,expenseId]);
  if (reversed.rowCount) throw new DomainError('EXPENSE_REVERSED','A voided expense cannot be reclassified.',409);
  if (nextCategory===e.current_category) throw new DomainError('VALIDATION_FAILED','Choose a different expense category.');
  const reclassificationId = randomUUID();
  await client.query('INSERT INTO finance.expense_reclassifications(id,tenant_id,expense_id,command_id,effective_date,from_category,to_category,version,reason,actor_id,operator_name_snapshot) VALUES($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11)',[reclassificationId,session.tenantId,expenseId,envelope.commandId,effectiveDate,e.current_category,nextCategory,expected+1,reason,session.userId,session.fullName]);
  await client.query('UPDATE finance.expenses SET version=version+1 WHERE tenant_id=$1 AND id=$2',[session.tenantId,expenseId]);
  const journalId = await post(client,session,envelope,'EXPENSE_RECLASSIFICATION',effectiveDate,e.currency,nextCategory,e.current_category,Number(e.amount_minor));
  return evidence(client,session,envelope,{reclassificationId,expenseId,journalId,category:nextCategory,amountMinor:String(e.amount_minor),currency:e.currency,version:expected+1,moneyTransferInitiated:false});
}

async function supplier(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload, ['name','phone']), supplierId = randomUUID(), name = text(p.name, 'Supplier name', 1, 160), phone = optionalText(p.phone, 'Supplier phone', 40);
  await client.query('INSERT INTO finance.suppliers(id,tenant_id,name,phone) VALUES($1,$2,$3,$4)', [supplierId, session.tenantId, name, phone]);
  return evidence(client, session, envelope, { supplierId, name, phone });
}
async function invoice(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload, ['supplierId','reference','invoiceDate','dueDate','amountMinor','currency','description','kind','category','receiptCommandId']);
  const supplierId = id(p.supplierId), reference = text(p.reference, 'Invoice reference', 1, 120).toUpperCase(), invoiceDate = date(p.invoiceDate), dueDate = date(p.dueDate, 'Due date');
  if (dueDate < invoiceDate) throw new DomainError('VALIDATION_FAILED', 'The due date cannot precede the invoice date.');
  const amount = minor(p.amountMinor), current = await scope(client, session), description = text(p.description, 'Invoice description', 3, 500);
  if (p.currency !== current.currency) throw new DomainError('VALIDATION_FAILED', 'The invoice currency must match this business.');
  const found = await client.query('SELECT name FROM finance.suppliers WHERE tenant_id=$1 AND id=$2', [session.tenantId, supplierId]);
  if (!found.rowCount) throw new DomainError('NOT_FOUND', 'The supplier could not be found.', 404);
  let debitAccount: string, expenseCategory: ExpenseCategory | null = null, receiptCommandId: string | null = null;
  if (p.kind === 'EXPENSE') {
    if (p.receiptCommandId !== undefined) throw new DomainError('VALIDATION_FAILED', 'An operating expense invoice cannot contain a stock receipt.');
    expenseCategory = category(p.category); debitAccount = expenseCategory;
  } else if (p.kind === 'RECEIPT') {
    if (p.category !== undefined) throw new DomainError('VALIDATION_FAILED', 'A stock receipt invoice cannot charge an expense category.');
    receiptCommandId = id(p.receiptCommandId); debitAccount = 'GOODS_RECEIVED_NOT_INVOICED';
    const received = await client.query(`SELECT j.currency,coalesce(sum(l.credit_minor-l.debit_minor),0)::text amount_minor
      FROM finance.journal_entries j JOIN finance.journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_entry_id=j.id
      JOIN system.commands c ON c.tenant_id=j.tenant_id AND c.command_id=j.source_id
      JOIN identity.devices d ON d.tenant_id=c.tenant_id AND d.id=c.device_id
      WHERE j.tenant_id=$1 AND j.source_id=$2 AND j.source_type='INVENTORY_RECEIPT' AND d.outlet_id=$3 AND l.account_code='GOODS_RECEIVED_NOT_INVOICED'
      GROUP BY j.id,j.currency`, [session.tenantId, receiptCommandId, session.outletId]);
    if (received.rowCount !== 1 || received.rows[0].currency !== current.currency || BigInt(received.rows[0].amount_minor) !== BigInt(amount)) throw new DomainError('RECEIPT_INVOICE_MISMATCH', 'Choose a received-stock record from this outlet and match its full recorded value. Price differences need a separately reviewed adjustment.', 409);
  } else throw new DomainError('VALIDATION_FAILED', 'Choose an operating expense or a received-stock invoice.');
  const invoiceId = randomUUID();
  const inserted = await client.query(`INSERT INTO finance.supplier_invoices(id,tenant_id,outlet_id,command_id,supplier_id,supplier_name_snapshot,reference,invoice_date,due_date,amount_minor,currency,kind,category,receipt_command_id,description)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING RETURNING id`, [invoiceId, session.tenantId, session.outletId, envelope.commandId, supplierId, found.rows[0].name, reference, invoiceDate, dueDate, amount, current.currency, p.kind, expenseCategory, receiptCommandId, description]);
  if (!inserted.rowCount) throw new DomainError('DUPLICATE_SUPPLIER_INVOICE', 'This invoice reference or stock receipt has already been recorded.', 409);
  const journalId = await post(client, session, envelope, 'SUPPLIER_INVOICE', invoiceDate, current.currency, debitAccount, 'ACCOUNTS_PAYABLE', amount);
  return evidence(client, session, envelope, { invoiceId, journalId, supplierId, amountMinor: String(amount), currency: current.currency, version: 1 });
}
async function supplierPayment(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload, ['invoiceId','effectiveDate','amountMinor','currency','paymentAccount','reference','manuallyConfirmed']), invoiceId = id(p.invoiceId), expected = version(envelope, `invoice:${invoiceId}`);
  const found = await client.query('SELECT *,invoice_date::text date_text FROM finance.supplier_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [session.tenantId, invoiceId]);
  if (!found.rowCount) throw new DomainError('NOT_FOUND', 'The supplier invoice could not be found.', 404);
  const i = found.rows[0]; if (Number(i.version) !== expected) throw new DomainError('VERSION_CONFLICT', 'This supplier invoice changed. Refresh before recording payment.', 409);
  if (i.status !== 'OPEN') throw new DomainError('INVOICE_REVERSED', 'This supplier invoice has been reversed.', 409);
  if (date(p.effectiveDate) < i.date_text) throw new DomainError('VALIDATION_FAILED', 'A payment cannot be dated before its invoice.');
  const amount = minor(p.amountMinor), remaining = BigInt(i.amount_minor) - BigInt(i.paid_minor);
  if (BigInt(amount) > remaining) throw new DomainError('PAYMENT_EXCEEDS_BALANCE', 'This payment exceeds the remaining supplier balance.', 409);
  const recorded = await client.query('SELECT coalesce(sum(amount_minor),0)::text paid FROM finance.supplier_payments WHERE tenant_id=$1 AND invoice_id=$2', [session.tenantId, invoiceId]);
  if (BigInt(recorded.rows[0].paid) !== BigInt(i.paid_minor)) throw new DomainError('AP_RECONCILIATION_FAILED', 'The supplier payment history does not match this balance. Review it before paying.', 409);
  const supplierPaymentId = randomUUID(), paid = await outgoing(client, session, envelope, supplierPaymentId, 'SUPPLIER_PAYMENT', p, `Supplier ${i.supplier_name_snapshot} · invoice ${i.reference}`);
  if (paid.currency !== i.currency) throw new DomainError('VALIDATION_FAILED', 'The payment currency differs from its invoice.');
  await client.query('INSERT INTO finance.supplier_payments(id,tenant_id,invoice_id,payment_id,command_id,amount_minor,effective_date) VALUES($1,$2,$3,$4,$5,$6,$7::date)', [supplierPaymentId, session.tenantId, invoiceId, paid.paymentId, envelope.commandId, amount, paid.effectiveDate]);
  await client.query('UPDATE finance.supplier_invoices SET paid_minor=paid_minor+$3,version=version+1 WHERE tenant_id=$1 AND id=$2', [session.tenantId, invoiceId, amount]);
  const journalId = await post(client, session, envelope, 'SUPPLIER_PAYMENT', paid.effectiveDate, paid.currency, 'ACCOUNTS_PAYABLE', paid.account, amount);
  return evidence(client, session, envelope, { supplierPaymentId, paymentId: paid.paymentId, invoiceId, journalId, amountMinor: String(amount), remainingMinor: (remaining - BigInt(amount)).toString(), currency: paid.currency, version: expected + 1 });
}
async function reverseInvoice(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload, ['invoiceId','effectiveDate','reason']), invoiceId = id(p.invoiceId), effectiveDate = date(p.effectiveDate), reason = text(p.reason, 'Correction reason', 3, 500), expected = version(envelope, `invoice:${invoiceId}`);
  const found = await client.query('SELECT *,invoice_date::text date_text FROM finance.supplier_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [session.tenantId, invoiceId]);
  if (!found.rowCount) throw new DomainError('NOT_FOUND', 'The supplier invoice could not be found.', 404);
  const i = found.rows[0];
  if (Number(i.version) !== expected) throw new DomainError('VERSION_CONFLICT', 'This supplier invoice changed. Refresh before correcting it.', 409);
  if (i.status !== 'OPEN') throw new DomainError('ALREADY_REVERSED', 'This supplier invoice is already reversed.', 409);
  if (BigInt(i.paid_minor) !== 0n) throw new DomainError('PAID_INVOICE_REVERSAL_UNAVAILABLE', 'A paid invoice needs a supplier credit and returned-payment workflow. Its payment history cannot be removed.', 409);
  if (effectiveDate < i.date_text) throw new DomainError('VALIDATION_FAILED', 'A correction cannot precede the original invoice.');
  const reversalId = randomUUID();
  await client.query('INSERT INTO finance.supplier_invoice_reversals(id,tenant_id,invoice_id,command_id,effective_date,reason,actor_id,operator_name_snapshot) VALUES($1,$2,$3,$4,$5::date,$6,$7,$8)', [reversalId, session.tenantId, invoiceId, envelope.commandId, effectiveDate, reason, session.userId, session.fullName]);
  await client.query("UPDATE finance.supplier_invoices SET status='REVERSED',version=version+1 WHERE tenant_id=$1 AND id=$2", [session.tenantId, invoiceId]);
  const journalId = await post(client, session, envelope, 'SUPPLIER_INVOICE_REVERSAL', effectiveDate, i.currency, 'ACCOUNTS_PAYABLE', i.kind === 'RECEIPT' ? 'GOODS_RECEIVED_NOT_INVOICED' : i.category, Number(i.amount_minor));
  return evidence(client, session, envelope, { reversalId, invoiceId, journalId, version: expected + 1, status: 'REVERSED' });
}

async function statement(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload, ['reference','from','to','currency','lines']), current = await scope(client, session);
  const reference = text(p.reference, 'Statement reference', 1, 120).toUpperCase(), from = date(p.from), to = date(p.to);
  if (from > to || to > current.business_date || Date.parse(to)-Date.parse(from) > 366*86_400_000) throw new DomainError('VALIDATION_FAILED', 'Choose a statement period of up to 367 days ending today or earlier.');
  if (p.currency !== current.currency) throw new DomainError('VALIDATION_FAILED', 'The statement currency must match this business.');
  if (!Array.isArray(p.lines) || p.lines.length < 1 || p.lines.length > 2000) throw new DomainError('VALIDATION_FAILED', 'A statement needs 1 to 2,000 incoming entries. Split larger statements into distinct dated batches.');
  const seen = new Set<string>();
  const lines = p.lines.map(raw => {
    const line = record(raw, ['reference','occurredOn','amountMinor']), ref = text(line.reference, 'Transaction reference', 4, 64).toUpperCase(), occurredOn = date(line.occurredOn), amount = minor(line.amountMinor);
    if (!/^[A-Z0-9][A-Z0-9-]{3,63}$/.test(ref)) throw new DomainError('VALIDATION_FAILED', 'An incoming transaction reference contains unsupported characters.');
    if (seen.has(ref)) throw new DomainError('DUPLICATE_STATEMENT_REFERENCE', 'The statement contains the same transaction reference more than once.'); seen.add(ref);
    if (occurredOn < from || occurredOn > to) throw new DomainError('VALIDATION_FAILED', 'A statement entry falls outside its selected period.');
    return { reference: ref, occurredOn, amount };
  });
  const statementId = randomUUID(), inserted = await client.query(`INSERT INTO finance.mpesa_statements(id,tenant_id,command_id,reference,from_date,to_date,currency,actor_id,operator_name_snapshot)
    VALUES($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9) ON CONFLICT(tenant_id,reference) DO NOTHING RETURNING id`, [statementId, session.tenantId, envelope.commandId, reference, from, to, current.currency, session.userId, session.fullName]);
  if (!inserted.rowCount) throw new DomainError('DUPLICATE_STATEMENT_REFERENCE', 'This incoming statement batch has already been recorded.', 409);
  let total = 0n;
  for (const line of lines) {
    const lineId = randomUUID();
    const saved = await client.query(`INSERT INTO finance.mpesa_statement_lines(id,tenant_id,statement_id,reference,occurred_on,amount_minor,currency)
      VALUES($1,$2,$3,$4,$5::date,$6,$7) ON CONFLICT(tenant_id,reference) DO NOTHING RETURNING id`, [lineId, session.tenantId, statementId, line.reference, line.occurredOn, line.amount, current.currency]);
    if (!saved.rowCount) throw new DomainError('DUPLICATE_STATEMENT_REFERENCE', 'One of these incoming transactions is already recorded in a statement. No entries from this batch were added.', 409);
    const claimed = await client.query('INSERT INTO finance.mpesa_statement_reference_claims(tenant_id,reference,line_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING line_id',[session.tenantId,line.reference,lineId]);
    if (!claimed.rowCount) throw new DomainError('DUPLICATE_STATEMENT_REFERENCE','This reference is reserved by an earlier statement or its correction. No entries from this batch were added.',409);
    total += BigInt(line.amount);
  }
  return evidence(client, session, envelope, { statementId, lineCount: lines.length, totalMinor: total.toString(), currency: current.currency, journalEntriesCreated: 0 });
}
async function matchStatement(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload, ['lineId','paymentId']), lineId = id(p.lineId), paymentId = id(p.paymentId);
  const statementLine = await client.query(`SELECT l.*,coalesce(c.reference,l.reference) reference,coalesce(c.amount_minor,l.amount_minor) amount_minor
    FROM finance.mpesa_statement_lines l LEFT JOIN LATERAL (SELECT * FROM finance.mpesa_statement_line_corrections history WHERE history.tenant_id=l.tenant_id AND history.line_id=l.id ORDER BY history.version DESC LIMIT 1) c ON true WHERE l.tenant_id=$1 AND l.id=$2 FOR UPDATE OF l`, [session.tenantId, lineId]);
  const payment = await client.query("SELECT * FROM commerce.payments WHERE tenant_id=$1 AND id=$2 AND method='MANUAL_MPESA' AND status='CONFIRMED' FOR UPDATE", [session.tenantId, paymentId]);
  if (!statementLine.rowCount || !payment.rowCount) throw new DomainError('NOT_FOUND', 'The statement entry or incoming M-Pesa payment could not be found.', 404);
  const line = statementLine.rows[0], paid = payment.rows[0];
  if (line.reference !== paid.reference || BigInt(line.amount_minor) !== BigInt(paid.amount_minor) || line.currency !== paid.currency) throw new DomainError('STATEMENT_PAYMENT_MISMATCH', 'The transaction reference, amount and currency must match exactly. Review the original payment evidence.', 409);
  const matchId = randomUUID(), inserted = await client.query(`INSERT INTO finance.mpesa_statement_matches(id,tenant_id,line_id,payment_id,command_id,actor_id,operator_name_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`, [matchId, session.tenantId, lineId, paymentId, envelope.commandId, session.userId, session.fullName]);
  if (!inserted.rowCount) throw new DomainError('ALREADY_MATCHED', 'This statement entry or incoming payment has already been matched.', 409);
  return evidence(client, session, envelope, { matchId, lineId, paymentId, amountMinor: String(paid.amount_minor), currency: paid.currency, journalEntriesCreated: 0 });
}

async function correctStatement(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const p = record(envelope.payload,['lineId','reference','occurredOn','amountMinor','reason']), lineId = id(p.lineId), expected = version(envelope,`statement-line:${lineId}`), reference = text(p.reference,'Transaction reference',4,64).toUpperCase(), occurredOn = date(p.occurredOn), amount = minor(p.amountMinor), reason = text(p.reason,'Correction reason',3,500);
  if (!/^[A-Z0-9][A-Z0-9-]{3,63}$/.test(reference)) throw new DomainError('VALIDATION_FAILED','The corrected reference contains unsupported characters.');
  const current = await scope(client,session);
  if (occurredOn>current.business_date) throw new DomainError('VALIDATION_FAILED','An incoming statement entry cannot be future dated.');
  const found = await client.query('SELECT id FROM finance.mpesa_statement_lines WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[session.tenantId,lineId]);
  if (!found.rowCount) throw new DomainError('NOT_FOUND','The incoming statement entry could not be found.',404);
  const matched = await client.query('SELECT 1 FROM finance.mpesa_statement_matches WHERE tenant_id=$1 AND line_id=$2',[session.tenantId,lineId]);
  if (matched.rowCount) throw new DomainError('MATCHED_STATEMENT_CORRECTION_UNAVAILABLE','Matched statement evidence cannot be changed. Review its original payment and match.',409);
  const prior = await client.query('SELECT coalesce(max(version),1)::text version FROM finance.mpesa_statement_line_corrections WHERE tenant_id=$1 AND line_id=$2',[session.tenantId,lineId]);
  if (Number(prior.rows[0].version)!==expected) throw new DomainError('VERSION_CONFLICT','This statement entry has a newer correction. Review its current details before continuing.',409);
  const claim = await client.query('SELECT line_id FROM finance.mpesa_statement_reference_claims WHERE tenant_id=$1 AND reference=$2',[session.tenantId,reference]);
  if (claim.rowCount && claim.rows[0].line_id!==lineId) throw new DomainError('DUPLICATE_STATEMENT_REFERENCE','The corrected transaction reference is reserved by another statement entry.',409);
  if (!claim.rowCount) {
    const claimed = await client.query('INSERT INTO finance.mpesa_statement_reference_claims(tenant_id,reference,line_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING line_id',[session.tenantId,reference,lineId]);
    if (!claimed.rowCount) throw new DomainError('DUPLICATE_STATEMENT_REFERENCE','The corrected transaction reference is reserved by another statement entry.',409);
  }
  const correctionId = randomUUID();
  await client.query('INSERT INTO finance.mpesa_statement_line_corrections(id,tenant_id,line_id,command_id,reference,occurred_on,amount_minor,version,reason,actor_id,operator_name_snapshot) VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11)',[correctionId,session.tenantId,lineId,envelope.commandId,reference,occurredOn,amount,expected+1,reason,session.userId,session.fullName]);
  return evidence(client,session,envelope,{correctionId,lineId,reference,occurredOn,amountMinor:String(amount),version:expected+1,journalEntriesCreated:0});
}

async function readControls(client: PoolClient, session: ApiSession): Promise<AccountingControls> {
  const current = await scope(client, session);
  const totals = await client.query(`WITH ledger AS (
      SELECT l.account_code,coalesce(sum(l.debit_minor-l.credit_minor),0) balance FROM finance.journal_lines l
      JOIN finance.journal_entries j ON j.tenant_id=l.tenant_id AND j.id=l.journal_entry_id WHERE l.tenant_id=$1 GROUP BY l.account_code
    ) SELECT
      coalesce((SELECT balance FROM ledger WHERE account_code='ACCOUNTS_RECEIVABLE'),0)::text ar_ledger,
      coalesce((SELECT sum(balance_minor) FROM finance.customer_accounts WHERE tenant_id=$1),0)::text ar_subledger,
      coalesce((SELECT balance FROM ledger WHERE account_code='INVENTORY'),0)::text inventory_ledger,
      coalesce((SELECT sum(inventory_value_minor) FROM inventory.balances WHERE tenant_id=$1),0)::text inventory_subledger,
      coalesce((SELECT -balance FROM ledger WHERE account_code='ACCOUNTS_PAYABLE'),0)::text ap_ledger,
      coalesce((SELECT sum(amount_minor-paid_minor) FROM finance.supplier_invoices WHERE tenant_id=$1 AND status='OPEN'),0)::text ap_subledger,
      coalesce((SELECT jsonb_agg(jsonb_build_object('accountCode',account_code,'balanceMinor',balance::text)) FROM ledger WHERE account_code IN ('BANK_CONTROL','MOBILE_MONEY_CONTROL') AND balance<0),'[]'::jsonb) negative_accounts`, [session.tenantId]);
  const money = await client.query(`SELECT
    (SELECT coalesce(sum(p.amount_minor),0)::text FROM commerce.payments p WHERE p.tenant_id=$1 AND p.method='MANUAL_MPESA' AND p.status='CONFIRMED') recorded_minor,
    (SELECT count(*)::text FROM commerce.payments p WHERE p.tenant_id=$1 AND p.method='MANUAL_MPESA' AND p.status='CONFIRMED') recorded_count,
    (SELECT coalesce(sum(p.amount_minor),0)::text FROM commerce.payments p JOIN finance.mpesa_statement_matches m ON m.tenant_id=p.tenant_id AND m.payment_id=p.id WHERE p.tenant_id=$1) matched_minor,
    (SELECT count(*)::text FROM finance.mpesa_statement_matches WHERE tenant_id=$1) matched_count,
    (SELECT coalesce(sum(coalesce(c.amount_minor,l.amount_minor)),0)::text FROM finance.mpesa_statement_lines l LEFT JOIN LATERAL (SELECT * FROM finance.mpesa_statement_line_corrections history WHERE history.tenant_id=l.tenant_id AND history.line_id=l.id ORDER BY history.version DESC LIMIT 1) c ON true WHERE l.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM finance.mpesa_statement_matches m WHERE m.tenant_id=l.tenant_id AND m.line_id=l.id)) unmatched_statement_minor,
    (SELECT count(*)::text FROM finance.mpesa_statement_lines l WHERE l.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM finance.mpesa_statement_matches m WHERE m.tenant_id=l.tenant_id AND m.line_id=l.id)) unmatched_statement_count`, [session.tenantId]);
  const r = totals.rows[0], m = money.rows[0];
  const check = (ledger: string, subledger: string) => ({ ledgerMinor: ledger, subledgerMinor: subledger, differenceMinor: (BigInt(ledger)-BigInt(subledger)).toString(), balanced: BigInt(ledger) === BigInt(subledger) });
  return {
    generatedAt: new Date().toISOString(), businessDate: current.business_date, currency: current.currency, timeZone: current.time_zone,
    controls: { receivables: check(r.ar_ledger,r.ar_subledger), inventory: check(r.inventory_ledger,r.inventory_subledger), payables: check(r.ap_ledger,r.ap_subledger) },
    incomingMpesa: { recordedMinor: m.recorded_minor, matchedMinor: m.matched_minor, unmatchedMinor: (BigInt(m.recorded_minor)-BigInt(m.matched_minor)).toString(), recordedCount: m.recorded_count, matchedCount: m.matched_count, unmatchedCount: (BigInt(m.recorded_count)-BigInt(m.matched_count)).toString(), unmatchedStatementMinor: m.unmatched_statement_minor, unmatchedStatementCount: m.unmatched_statement_count },
    coverage: { status: 'PARTIAL', negativeNoncashAccounts: r.negative_accounts,
      exclusions: ['Bank balances and outgoing M-Pesa entries are not statement reconciled. A negative control balance does not prove money is available.', 'Incoming M-Pesa matching covers recorded entries only; no automated provider verification or statement completeness is claimed.', 'Inventory may include documented opening estimates and reference-cost estimates from zero-stock count gains.', 'Tax recovery, payroll, depreciation, supplier credits and complete financial statements need their separately supported source workflows.'] },
    categories: categories.map(item => ({...item})), paymentAccounts: paymentAccounts.map(item => ({...item})),
    permissions: { manage: ROLE_PERMISSIONS[session.role].includes('finance.manage'), close: ROLE_PERMISSIONS[session.role].includes('finance.close') },
  };
}
export async function getAccountingControls(session: ApiSession) { requireView(session); return inReadSnapshot(client => readControls(client,session)); }

async function period(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const create = envelope.type === 'finance.period.create';
  const p = record(envelope.payload, create ? ['from','to','reason'] : ['periodId','status','reason']);
  const reason = create && p.reason === undefined ? 'Accounting period opened' : text(p.reason, 'Period change reason', 3, 500);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,9036))', [session.tenantId]);
  await client.query('UPDATE core.tenants SET accounting_period_version=accounting_period_version+1 WHERE id=$1', [session.tenantId]);
  let periodId: string, previous: string | null = null, next: string, nextVersion: number, checks: unknown = null;
  if (create) {
    const from = date(p.from), to = date(p.to);
    if (from > to || Date.parse(to)-Date.parse(from) > 366*86_400_000) throw new DomainError('VALIDATION_FAILED', 'Choose an accounting period of up to 367 days.');
    const overlaps = await client.query('SELECT 1 FROM finance.accounting_periods WHERE tenant_id=$1 AND from_date<=$3::date AND to_date>=$2::date', [session.tenantId,from,to]);
    if (overlaps.rowCount) throw new DomainError('PERIOD_OVERLAP', 'These dates overlap an existing accounting period.', 409);
    periodId = randomUUID(); next = 'OPEN'; nextVersion = 1;
    await client.query('INSERT INTO finance.accounting_periods(id,tenant_id,from_date,to_date,reason,operator_name_snapshot) VALUES($1,$2,$3::date,$4::date,$5,$6)', [periodId,session.tenantId,from,to,reason,session.fullName]);
  } else {
    periodId = id(p.periodId); const expected = version(envelope,`period:${periodId}`);
    const found = await client.query('SELECT *,from_date::text from_text,to_date::text to_text FROM finance.accounting_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [session.tenantId,periodId]);
    if (!found.rowCount) throw new DomainError('NOT_FOUND','The accounting period could not be found.',404);
    const r = found.rows[0];
    if (Number(r.version)!==expected) throw new DomainError('VERSION_CONFLICT','This accounting period changed. Refresh before continuing.',409);
    previous = r.status; next = p.status as string; nextVersion = expected+1;
    if (!((previous==='OPEN' && next==='CLOSING') || (previous==='CLOSING' && (next==='OPEN' || next==='CLOSED')))) throw new DomainError('INVALID_PERIOD_TRANSITION','An open period must enter review before closing. Closed periods cannot be reopened.',409);
    const current = await scope(client,session);
    if (next==='CLOSING' && current.business_date>=r.from_text && current.business_date<=r.to_text) {
      const active = await client.query("SELECT count(*)::text count FROM commerce.shifts WHERE tenant_id=$1 AND status='OPEN'",[session.tenantId]);
      if (BigInt(active.rows[0].count)>0n) throw new DomainError('OPEN_SHIFTS_BLOCK_PERIOD','Close the active cashier shifts before putting this accounting date into review.',409);
    }
    if (next==='CLOSED') {
      if (r.to_text>current.business_date) throw new DomainError('VALIDATION_FAILED','A future accounting period cannot be closed.');
      const controls = await readControls(client,session);
      const unmatched = await client.query(`SELECT
        (SELECT count(*)::text FROM commerce.payments p WHERE p.tenant_id=$1 AND p.method='MANUAL_MPESA' AND p.status='CONFIRMED'
          AND (p.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
          AND NOT EXISTS(SELECT 1 FROM finance.mpesa_statement_matches m WHERE m.tenant_id=p.tenant_id AND m.payment_id=p.id)) payments,
        (SELECT count(*)::text FROM finance.mpesa_statement_lines l LEFT JOIN LATERAL (SELECT * FROM finance.mpesa_statement_line_corrections history WHERE history.tenant_id=l.tenant_id AND history.line_id=l.id ORDER BY history.version DESC LIMIT 1) c ON true WHERE l.tenant_id=$1 AND coalesce(c.occurred_on,l.occurred_on) BETWEEN $2::date AND $3::date
          AND NOT EXISTS(SELECT 1 FROM finance.mpesa_statement_matches m WHERE m.tenant_id=l.tenant_id AND m.line_id=l.id)) statement_lines,
        (SELECT count(*)::text FROM (SELECT j.id FROM finance.journal_entries j LEFT JOIN finance.journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_entry_id=j.id
          WHERE j.tenant_id=$1 AND coalesce(j.effective_date,(j.posted_at AT TIME ZONE $4)::date) BETWEEN $2::date AND $3::date
          GROUP BY j.id HAVING coalesce(sum(l.debit_minor),0)=0 OR coalesce(sum(l.debit_minor),0)<>coalesce(sum(l.credit_minor),0)) bad) unbalanced_entries`, [session.tenantId,r.from_text,r.to_text,current.time_zone]);
      const failures = unmatched.rows[0];
      if (Object.values(controls.controls).some(control=>!control.balanced) || Object.values(failures).some(count=>BigInt(count as string)>0n)) throw new DomainError('PERIOD_RECONCILIATION_FAILED','Resolve ledger differences and unmatched incoming M-Pesa evidence before closing this period.',409,{controls:controls.controls,unmatchedPayments:failures.payments,unmatchedStatementLines:failures.statement_lines,unbalancedEntries:failures.unbalanced_entries});
      checks = { generatedAt:controls.generatedAt,controls:controls.controls,unmatchedPayments:failures.payments,unmatchedStatementLines:failures.statement_lines,unbalancedEntries:failures.unbalanced_entries,coverage:controls.coverage };
    }
    await client.query('UPDATE finance.accounting_periods SET status=$3,version=version+1,reason=$4,operator_name_snapshot=$5,changed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2',[session.tenantId,periodId,next,reason,session.fullName]);
  }
  await client.query('INSERT INTO finance.accounting_period_events(id,tenant_id,period_id,command_id,actor_id,operator_name_snapshot,from_status,to_status,reason,checks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[randomUUID(),session.tenantId,periodId,envelope.commandId,session.userId,session.fullName,previous,next,reason,checks===null?null:JSON.stringify(checks)]);
  return evidence(client,session,envelope,{periodId,status:next,version:nextVersion});
}

export async function executeAccountingCommand(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  switch (envelope.type) {
    case 'finance.expense.record': return expense(client,session,envelope);
    case 'finance.expense.reverse': return reverseExpense(client,session,envelope);
    case 'finance.expense.reclassify': return reclassifyExpense(client,session,envelope);
    case 'finance.supplier.create': return supplier(client,session,envelope);
    case 'finance.supplier.invoice': return invoice(client,session,envelope);
    case 'finance.supplier.invoice.reverse': return reverseInvoice(client,session,envelope);
    case 'finance.supplier.payment': return supplierPayment(client,session,envelope);
    case 'finance.mpesa.statement.record': return statement(client,session,envelope);
    case 'finance.mpesa.statement.match': return matchStatement(client,session,envelope);
    case 'finance.mpesa.statement.correct': return correctStatement(client,session,envelope);
    case 'finance.period.create': case 'finance.period.transition': return period(client,session,envelope);
    default: throw new DomainError('VALIDATION_FAILED','This accounting action is not supported.');
  }
}

const recordQueries: Record<AccountingRecordKind,string> = {
  expenses: `SELECT e.id,e.created_at,jsonb_build_object('id',e.id,'createdAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'effectiveDate',e.effective_date::text,'amountMinor',e.amount_minor::text,'currency',e.currency,'category',e.category,'description',e.description,'payee',e.payee,
    'paymentAccount',p.payment_account,'reference',p.reference,'operatorName',e.operator_name_snapshot,'version',e.version,'currentCategory',coalesce(c.to_category,e.category),
    'reclassification',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('effectiveDate',c.effective_date::text,'category',c.to_category,'reason',c.reason,'operatorName',c.operator_name_snapshot) END,
    'reversal',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'effectiveDate',r.effective_date::text,'reason',r.reason,'operatorName',r.operator_name_snapshot) END) data
    FROM finance.expenses e JOIN finance.outgoing_payments p ON p.tenant_id=e.tenant_id AND p.id=e.payment_id LEFT JOIN finance.expense_reversals r ON r.tenant_id=e.tenant_id AND r.expense_id=e.id
    LEFT JOIN LATERAL (SELECT * FROM finance.expense_reclassifications history WHERE history.tenant_id=e.tenant_id AND history.expense_id=e.id ORDER BY history.version DESC LIMIT 1) c ON true WHERE e.tenant_id=$1`,
  suppliers: `SELECT s.id,s.created_at,jsonb_build_object('id',s.id,'createdAt',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'name',s.name,'phone',s.phone) data FROM finance.suppliers s WHERE s.tenant_id=$1`,
  invoices: `SELECT i.id,i.created_at,jsonb_build_object('id',i.id,'createdAt',to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'supplierId',i.supplier_id,'supplierName',i.supplier_name_snapshot,'reference',i.reference,'invoiceDate',i.invoice_date::text,'dueDate',i.due_date::text,'amountMinor',i.amount_minor::text,'paidMinor',i.paid_minor::text,
    'remainingMinor',CASE WHEN i.status='REVERSED' THEN '0' ELSE (i.amount_minor-i.paid_minor)::text END,'currency',i.currency,'kind',i.kind,'category',i.category,'receiptCommandId',i.receipt_command_id,'description',i.description,'status',i.status,'version',i.version) data
    FROM finance.supplier_invoices i WHERE i.tenant_id=$1`,
  payments: `SELECT p.id,p.created_at,jsonb_build_object('id',p.id,'createdAt',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'effectiveDate',p.effective_date::text,'amountMinor',p.amount_minor::text,'currency',p.currency,'paymentAccount',p.payment_account,'reference',p.reference,'operatorName',p.operator_name_snapshot,'kind',p.kind,'sourceId',p.source_id,'description',p.description) data FROM finance.outgoing_payments p WHERE p.tenant_id=$1`,
  periods: `SELECT p.id,p.created_at,jsonb_build_object('id',p.id,'createdAt',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'from',p.from_date::text,'to',p.to_date::text,'status',p.status,'version',p.version,'reason',p.reason,'operatorName',p.operator_name_snapshot,'changedAt',p.changed_at) data FROM finance.accounting_periods p WHERE p.tenant_id=$1`,
  statements: `SELECT s.id,s.created_at,jsonb_build_object('id',s.id,'createdAt',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'reference',s.reference,'from',s.from_date::text,'to',s.to_date::text,'currency',s.currency,
    'lineCount',(SELECT count(*) FROM finance.mpesa_statement_lines l WHERE l.tenant_id=s.tenant_id AND l.statement_id=s.id),
    'totalMinor',(SELECT coalesce(sum(coalesce(c.amount_minor,l.amount_minor)),0)::text FROM finance.mpesa_statement_lines l LEFT JOIN LATERAL (SELECT * FROM finance.mpesa_statement_line_corrections history WHERE history.tenant_id=l.tenant_id AND history.line_id=l.id ORDER BY history.version DESC LIMIT 1) c ON true WHERE l.tenant_id=s.tenant_id AND l.statement_id=s.id),
    'matchedCount',(SELECT count(*) FROM finance.mpesa_statement_lines l JOIN finance.mpesa_statement_matches m ON m.tenant_id=l.tenant_id AND m.line_id=l.id WHERE l.tenant_id=s.tenant_id AND l.statement_id=s.id)) data FROM finance.mpesa_statements s WHERE s.tenant_id=$1`,
  'statement-lines': `SELECT l.id,l.created_at,jsonb_build_object('id',l.id,'createdAt',to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'statementId',l.statement_id,'statementReference',s.reference,'reference',coalesce(c.reference,l.reference),'occurredOn',coalesce(c.occurred_on,l.occurred_on)::text,'amountMinor',coalesce(c.amount_minor,l.amount_minor)::text,'currency',l.currency,'paymentId',m.payment_id,'matchedAt',m.created_at,
    'originalReference',l.reference,'originalAmountMinor',l.amount_minor::text,'originalOccurredOn',l.occurred_on::text,'correctionReason',c.reason,'version',coalesce(c.version,1)) data
    FROM finance.mpesa_statement_lines l JOIN finance.mpesa_statements s ON s.tenant_id=l.tenant_id AND s.id=l.statement_id LEFT JOIN finance.mpesa_statement_matches m ON m.tenant_id=l.tenant_id AND m.line_id=l.id LEFT JOIN LATERAL (SELECT * FROM finance.mpesa_statement_line_corrections history WHERE history.tenant_id=l.tenant_id AND history.line_id=l.id ORDER BY history.version DESC LIMIT 1) c ON true WHERE l.tenant_id=$1`,
  receipts: `SELECT j.source_id id,j.posted_at created_at,jsonb_build_object('id',j.source_id,'createdAt',to_char(j.posted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'reference',c.response->'value'->>'documentReference','supplierName',c.response->'value'->>'supplierName','amountMinor',(SELECT coalesce(sum(l.credit_minor-l.debit_minor),0)::text FROM finance.journal_lines l WHERE l.tenant_id=j.tenant_id AND l.journal_entry_id=j.id AND l.account_code='GOODS_RECEIVED_NOT_INVOICED'),'currency',j.currency,'outletName',o.name) data
    FROM finance.journal_entries j JOIN system.commands c ON c.tenant_id=j.tenant_id AND c.command_id=j.source_id JOIN identity.devices d ON d.tenant_id=c.tenant_id AND d.id=c.device_id JOIN core.outlets o ON o.tenant_id=d.tenant_id AND o.id=d.outlet_id
    WHERE j.tenant_id=$1 AND j.source_type='INVENTORY_RECEIPT' AND d.outlet_id=$6::uuid AND NOT EXISTS(SELECT 1 FROM finance.supplier_invoices i WHERE i.tenant_id=j.tenant_id AND i.receipt_command_id=j.source_id AND i.status='OPEN')`,
  'mpesa-payments': `SELECT p.id,p.created_at,jsonb_build_object('id',p.id,'createdAt',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'reference',p.reference,'amountMinor',p.amount_minor::text,'currency',p.currency,'outletName',o.name,'operatorName',p.confirmed_operator_name_snapshot,'matched',EXISTS(SELECT 1 FROM finance.mpesa_statement_matches m WHERE m.tenant_id=p.tenant_id AND m.payment_id=p.id)) data
    FROM commerce.payments p JOIN core.outlets o ON o.tenant_id=p.tenant_id AND o.id=p.outlet_id WHERE p.tenant_id=$1 AND p.method='MANUAL_MPESA' AND p.status='CONFIRMED'`,
};

/** Every bounded history returns a continuation cursor. Cursor timestamps retain
 * PostgreSQL microseconds, so equal/millisecond-near rows are not skipped. */
export async function listAccountingRecords(session: ApiSession, kindValue: unknown, query: {limit?:unknown;after?:unknown;reference?:unknown} = {}): Promise<AccountingRecordPage> {
  requireView(session);
  if (typeof kindValue!=='string' || !Object.hasOwn(recordQueries,kindValue)) throw new DomainError('NOT_FOUND','This accounting history is not available.',404);
  const kind = kindValue as AccountingRecordKind, limit = query.limit===undefined ? 50 : Number(query.limit);
  if (!Number.isSafeInteger(limit) || limit<1 || limit>100) throw new DomainError('VALIDATION_FAILED','Choose a history page size from 1 to 100.');
  let at: string|null = null, afterId: string|null = null;
  if (query.after!==undefined && query.after!=='') {
    try {
      if (typeof query.after!=='string' || query.after.length>512) throw new Error();
      const cursor = JSON.parse(Buffer.from(query.after,'base64url').toString('utf8'));
      if (cursor.kind!==kind || typeof cursor.at!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at)) || !uuid.test(cursor.id)) throw new Error();
      at = cursor.at; afterId = cursor.id;
    } catch { throw new DomainError('VALIDATION_FAILED','This history page reference is invalid. Reload the first page.'); }
  }
  let reference: string|null = null;
  if (query.reference!==undefined && query.reference!=='') {
    if (kind!=='mpesa-payments') throw new DomainError('VALIDATION_FAILED','Reference filtering is only available for incoming M-Pesa payments.');
    reference = text(query.reference,'Transaction reference',4,64).toUpperCase();
  }
  return inReadSnapshot(async client=>{
    const base = recordQueries[kind];
    // All six placeholders are explicitly typed, even for kinds not needing an
    // outlet filter. No caller-controlled identifier is interpolated into SQL.
    const result = await client.query(`SELECT r.data FROM (${base}) r CROSS JOIN (SELECT $6::uuid outlet_scope) permitted
      WHERE ($3::timestamptz IS NULL OR (r.created_at,r.id)<($3::timestamptz,$4::uuid))
      AND ($5::text IS NULL OR r.data->>'reference'=$5::text) ORDER BY r.created_at DESC,r.id DESC LIMIT $2`,[session.tenantId,limit+1,at,afterId,reference,session.outletId]);
    const rows = result.rows.map(row=>row.data), hasMore = rows.length>limit, records = rows.slice(0,limit), last = records.at(-1);
    return {records,pageInfo:{limit,hasMore,nextCursor:hasMore&&last?Buffer.from(JSON.stringify({kind,at:last.createdAt,id:last.id})).toString('base64url'):null}};
  });
}
