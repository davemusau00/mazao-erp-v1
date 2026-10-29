import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ApiPermission, ApiSession, CommandEnvelope } from './contracts.js';
import { DomainError, ROLE_PERMISSIONS } from './contracts.js';
import { stableStringify } from './security.js';
import { executeConfigurationCommand, readBusinessProfile, readOutletProfile, receiptConfigurationSnapshot } from './configuration.js';
import { executeProductImportCommand } from './productImport.js';
import { normalizeCatalogProductCreate } from './catalogValidation.js';
import { executeCatalogMaintenanceCommand, lockCatalogOutlet, assertNoOpenCatalogCount, resolveCatalogCategory, catalogIdentityError } from './catalogMaintenance.js';
import { isStockTracked, requireItemKindCapability, type ItemKind } from './itemKinds.js';
import { executeStaffCommand } from './staff.js';
import { revalidateOperator } from './identityAuthority.js';
import { requireCommandAuthority } from './commandAuthorization.js';
import { validateCommandPayload } from './commandCatalogue.js';
import { executeAccountingCommand, guardFinancialCommand } from './accounting.js';
import { executeAccountCatalogCommand } from './accountCatalog.js';
import { executeStockExceptionCommand } from './stockShortfalls.js';
import { COUNT_CAPACITY, appendCountEvent, assertCountPostable, countBefore, ensureCountCheckpoint, loadCountState, reviewStockCount } from './countRecovery.js';

const quantityScale = 1_000_000n;
function quantityMicros(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new DomainError('VALIDATION_FAILED', 'Quantity must be a positive decimal string with at most 6 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const micros = BigInt(whole) * quantityScale + BigInt((fraction + '000000').slice(0, 6));
  if (micros <= 0n) throw new DomainError('VALIDATION_FAILED', 'Quantity must be greater than zero.');
  return micros;
}
function quantityText(micros: bigint): string {
  const whole = micros / quantityScale;
  const fraction = (micros % quantityScale).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function databaseQuantityMicros(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * quantityScale + BigInt((fraction + '000000').slice(0, 6));
}
function countQuantityText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new DomainError('VALIDATION_FAILED', 'Counted quantity must be a non-negative decimal string with at most 6 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const wholeValue = BigInt(whole);
  if (wholeValue > 99_999_999_999_999n) throw new DomainError('VALIDATION_FAILED', 'Counted quantity exceeds the supported range.');
  return quantityText(wholeValue * quantityScale + BigInt((fraction + '000000').slice(0, 6)));
}
function signedQuantityText(value: bigint): string {
  return value < 0n ? `-${quantityText(-value)}` : quantityText(value);
}
function addMinorChecked(left: bigint, right: bigint): bigint {
  const result = left + right;
  if (result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', 'Count variance value exceeds the supported safe money range.');
  return result;
}
function asMinor(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new DomainError('VALIDATION_FAILED', `${field} must be a non-negative safe integer in minor units.`);
  return value;
}

function saleRecord(value: unknown, allowedKeys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('VALIDATION_FAILED', `${label} is invalid.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowedKeys.includes(key))) {
    throw new DomainError('VALIDATION_FAILED', `${label} contains an unsupported field. Review the item discounts and payment details.`);
  }
  return record;
}

/** Canonical reference is retained in the original payment command, then made
 * unique across all outlets of the business by the database. This intentionally
 * does not encode one assumed permanent payment-provider reference format. */
export function validateManualMpesaReference(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9][A-Z0-9-]{3,63}$/.test(value) || value !== value.trim().toUpperCase()) {
    throw new DomainError('VALIDATION_FAILED', 'Enter a payment reference of 4 to 64 uppercase letters, numbers or hyphens.');
  }
  return value;
}
function amountForQuantity(unitMinor: number, micros: bigint): number {
  const amount = (BigInt(unitMinor) * micros + quantityScale / 2n) / quantityScale;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', 'Line amount exceeds the supported safe integer range.');
  return Number(amount);
}
function valueForQuantity(valueMinor: bigint, sourceQuantityMicros: bigint, allocationQuantityMicros: bigint): bigint {
  if (valueMinor < 0n || sourceQuantityMicros <= 0n || allocationQuantityMicros < 0n) throw new DomainError('INTERNAL_ERROR', 'Inventory value allocation inputs are invalid.', 500);
  if (allocationQuantityMicros === 0n) return 0n;
  if (allocationQuantityMicros === sourceQuantityMicros) return valueMinor;
  return (valueMinor * allocationQuantityMicros + sourceQuantityMicros / 2n) / sourceQuantityMicros;
}
function checkedBigintMinor(value: bigint, label: string): string {
  if (value < 0n || value > 9_223_372_036_854_775_807n) throw new DomainError('VALIDATION_FAILED', `${label} exceeds the supported inventory value range.`);
  return value.toString();
}
function roundedUnitCost(valueMinor: bigint, quantityMicros: bigint): number {
  if (quantityMicros <= 0n) return 0;
  const unitCost = (valueMinor * quantityScale + quantityMicros / 2n) / quantityMicros;
  if (unitCost > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', 'Inventory unit cost exceeds the supported safe money range.');
  return Number(unitCost);
}
function taxFor(subtotal: number, basisPoints: number): number {
  return Number((BigInt(subtotal) * BigInt(basisPoints) + 5_000n) / 10_000n);
}
type StockExceptionReason = 'SUSPECTED_UNRECORDED_DELIVERY' | 'SUSPECTED_OUTDATED_COUNT' | 'UNKNOWN';
type StockExceptionAcknowledgement = { productId: string; maxConfirmedShortfall: bigint; reasonCode: StockExceptionReason; reasonNote: string | null };
function stockExceptionAcknowledgement(value: unknown): { physicallyConfirmed: boolean; lines: StockExceptionAcknowledgement[] } | null {
  if (value === undefined) return null;
  const record = saleRecord(value, ['physicallyConfirmed', 'lines'], 'Stock exception confirmation');
  if (typeof record.physicallyConfirmed !== 'boolean' || !Array.isArray(record.lines) || record.lines.length > 100) {
    throw new DomainError('VALIDATION_FAILED', 'Stock exception confirmation must identify the affected items and physical confirmation.');
  }
  const lines = record.lines.map((raw, index) => {
    const line = saleRecord(raw, ['productId', 'maxConfirmedShortfall', 'reasonCode', 'reasonNote'], `Stock exception item ${index + 1}`);
    if (typeof line.productId !== 'string' || !/^[0-9a-f-]{36}$/i.test(line.productId)) throw new DomainError('VALIDATION_FAILED', `Stock exception item ${index + 1} needs a valid product ID.`);
    if (!['SUSPECTED_UNRECORDED_DELIVERY', 'SUSPECTED_OUTDATED_COUNT', 'UNKNOWN'].includes(String(line.reasonCode))) throw new DomainError('VALIDATION_FAILED', `Choose a reason for stock exception item ${index + 1}.`);
    const reasonCode = line.reasonCode as StockExceptionReason;
    if (line.reasonNote !== undefined && line.reasonNote !== null && (typeof line.reasonNote !== 'string' || line.reasonNote.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(line.reasonNote))) {
      throw new DomainError('VALIDATION_FAILED', `The note for stock exception item ${index + 1} is invalid.`);
    }
    const reasonNote = typeof line.reasonNote === 'string' && line.reasonNote.trim() ? line.reasonNote.trim() : null;
    if (reasonCode === 'UNKNOWN' && (!reasonNote || reasonNote.length < 3)) throw new DomainError('VALIDATION_FAILED', `Explain the unknown cause for stock exception item ${index + 1}.`);
    return { productId: line.productId, maxConfirmedShortfall: quantityMicros(line.maxConfirmedShortfall), reasonCode, reasonNote };
  });
  if (new Set(lines.map(line => line.productId)).size !== lines.length) throw new DomainError('VALIDATION_FAILED', 'Each affected item can have only one stock exception confirmation.');
  return { physicallyConfirmed: record.physicallyConfirmed, lines };
}
function requirePermission(session: ApiSession, permission: ApiPermission): void {
  if (!ROLE_PERMISSIONS[session.role].includes(permission)) throw new DomainError('FORBIDDEN', 'Your role cannot perform this operation.', 403);
}
function requireCapability(session:ApiSession,capability:string){if(!session.capabilities.includes(capability))throw new DomainError('CAPABILITY_DISABLED',`The ${capability} capability is not enabled for this tenant.`,403)}
function dateOnly(value:unknown,field:string):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new DomainError('VALIDATION_FAILED',`${field} must be a valid ISO calendar date.`);try{if(new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)!==value)throw new Error()}catch{throw new DomainError('VALIDATION_FAILED',`${field} must be a valid ISO calendar date.`)}return value}
function versionFor(envelope: CommandEnvelope, key: string): number | undefined {
  const value = envelope.expectedVersions[key];
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}
async function audit(client: PoolClient, session: ApiSession, commandId: string, type: string, payload: unknown) {
  await client.query(
    `INSERT INTO system.audit_events(id, tenant_id, outlet_id, actor_id, command_id, event_type, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [randomUUID(), session.tenantId, session.outletId, session.userId, commandId, type, JSON.stringify(payload)],
  );
}
async function outbox(client: PoolClient, session: ApiSession, commandId: string, type: string, payload: unknown) {
  await client.query(
    `INSERT INTO system.transactional_outbox(id, tenant_id, command_id, event_type, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [randomUUID(), session.tenantId, commandId, type, JSON.stringify(payload)],
  );
}
async function journal(client: PoolClient, session: ApiSession, commandId: string, sourceType: string, currency: string, lines: Array<{ account: string; debit: number; credit: number }>) {
  const valid = lines.filter(line => line.debit || line.credit);
  const debit = valid.reduce((sum, line) => sum + BigInt(line.debit), 0n);
  const credit = valid.reduce((sum, line) => sum + BigInt(line.credit), 0n);
  if (debit === 0n || debit !== credit) throw new DomainError('INTERNAL_ERROR', 'Journal lines failed the balance invariant.', 500);
  const entryId = randomUUID();
  await client.query(
    'INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES ($1,$2,$3,$4,$5,$6)',
    [entryId, session.tenantId, sourceType, commandId, currency, session.userId],
  );
  for (const line of valid) {
    await client.query(
      'INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), session.tenantId, entryId, line.account, line.debit, line.credit],
    );
  }
  return entryId;
}

export async function executeCommand(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  if (envelope.deviceId !== session.deviceId) throw new DomainError('FORBIDDEN', 'Command device does not match the authenticated session.', 403);
  if (envelope.tenantId && envelope.tenantId !== session.tenantId) throw new DomainError('FORBIDDEN', 'Command tenant does not match the authenticated session.', 403);
  // Permissions and assignment authority are rechecked inside the transaction,
  // so an earlier HTTP preflight cannot preserve a revoked or changed role.
  session = await revalidateOperator(client, session);
  requireCommandAuthority(session, envelope.type);
  validateCommandPayload(envelope);
  await guardFinancialCommand(client, session, envelope);
  if(envelope.type==='catalog.product.create'||envelope.type==='catalog.import.apply'||envelope.type.startsWith('inventory.count.'))await lockCatalogOutlet(client,session);
  if(['sales.order.settle','sales.order.refund','inventory.receive','inventory.sale_shortfall.resolve'].includes(envelope.type))await lockCatalogOutlet(client,session,'shared');
  switch (envelope.type) {
    case 'finance.account.label': return executeAccountCatalogCommand(client, session, envelope);
    case 'finance.expense.record':
    case 'finance.expense.reverse':
    case 'finance.expense.reclassify':
    case 'finance.supplier.create':
    case 'finance.supplier.invoice':
    case 'finance.supplier.invoice.reverse':
    case 'finance.supplier.payment':
    case 'finance.mpesa.statement.record':
    case 'finance.mpesa.statement.match':
    case 'finance.mpesa.statement.correct':
    case 'finance.period.create':
    case 'finance.period.transition': return executeAccountingCommand(client, session, envelope);
    case 'staff.member.create':
    case 'staff.member.update':
    case 'staff.member.set_active':
    case 'devices.assignment.create':
    case 'devices.assignment.update':
    case 'devices.assignment.revoke':
    case 'staff.sessions.revoke':
    case 'auth.session.revoke': return executeStaffCommand(client,session,envelope);
    case 'catalog.import.validate':
    case 'catalog.import.revalidate':
    case 'catalog.import.apply': return executeProductImportCommand(client,session,envelope);
    case 'configuration.business.update':
    case 'configuration.outlet.create':
    case 'configuration.outlet.update':
    case 'configuration.outlet.set_active':
    case 'configuration.capabilities.update': return executeConfigurationCommand(client, session, envelope);
    case 'configuration.stock_exception_policy.update':
    case 'inventory.sale_shortfall.resolve': return executeStockExceptionCommand(client, session, envelope);
    case 'catalog.product.update':
    case 'catalog.product.set_active':
    case 'catalog.product.change_kind':
    case 'catalog.category.create':
    case 'catalog.category.update':
    case 'catalog.category.set_active':
    case 'catalog.category.merge': return executeCatalogMaintenanceCommand(client,session,envelope);
    case 'catalog.product.create': return createProduct(client, session, envelope);
    case 'inventory.receive': return receiveInventory(client, session, envelope);
    case 'inventory.count.open': return openStockCount(client, session, envelope);
    case 'inventory.count.save': return saveStockCount(client, session, envelope);
    case 'inventory.count.review': return reviewStockCount(client, session, envelope);
    case 'inventory.count.post': return postStockCount(client, session, envelope);
    case 'inventory.count.cancel': return cancelStockCount(client, session, envelope);
    case 'shift.open': return openShift(client, session, envelope);
    case 'shift.cash.movement': return recordShiftCashMovement(client, session, envelope);
    case 'shift.close': return closeShift(client, session, envelope);
    case 'sales.order.settle': return settleSale(client, session, envelope);
    case 'sales.order.refund': return refundSale(client, session, envelope);
    case 'customers.account.create': return createCustomerAccount(client, session, envelope);
    case 'customers.account.update': return updateCustomerAccount(client, session, envelope);
    case 'customers.repayment': return recordCustomerRepayment(client, session, envelope);
    case 'hotel.room.create': return createHotelRoom(client,session,envelope);
    case 'hotel.reservation.create': return createReservation(client,session,envelope);
    case 'hotel.reservation.cancel': return cancelReservation(client,session,envelope);
    case 'hotel.checkin': return checkInGuest(client,session,envelope);
    case 'hotel.checkout': return checkOutGuest(client,session,envelope);
    case 'hotel.room.mark_ready': return markRoomReady(client,session,envelope);
    default: throw new DomainError('VALIDATION_FAILED', `Unsupported command type: ${envelope.type}`);
  }
}

async function createCustomerAccount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const name = envelope.payload.name;
  const phone = envelope.payload.phone;
  const email = envelope.payload.email;
  const creditLimitMinor = asMinor(envelope.payload.creditLimitMinor, 'creditLimitMinor');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) throw new DomainError('VALIDATION_FAILED', 'Customer name is required and must be 160 characters or fewer.');
  if (typeof phone !== 'string' || phone.trim().length < 3 || phone.trim().length > 40) throw new DomainError('VALIDATION_FAILED', 'A customer phone number of 3 to 40 characters is required.');
  if (email !== undefined && email !== null && (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new DomainError('VALIDATION_FAILED', 'Customer email is invalid.');
  const id = randomUUID();
  await client.query(`INSERT INTO finance.customer_accounts(id,tenant_id,display_name,phone,email,credit_limit_minor)
    VALUES($1,$2,$3,$4,$5,$6)`, [id, session.tenantId, name.trim(), phone.trim(), typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null, creditLimitMinor]);
  const result = { customerId: id, name: name.trim(), phone: phone.trim(), creditLimitMinor: String(creditLimitMinor), balanceMinor: '0', status: 'ACTIVE', version: 1 };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function updateCustomerAccount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const id = envelope.payload.customerId;
  if (typeof id !== 'string') throw new DomainError('VALIDATION_FAILED', 'customerId is required.');
  const expectedVersion = versionFor(envelope, `customer:${id}`);
  if (!expectedVersion) throw new DomainError('VALIDATION_FAILED', 'Expected customer account version is required.');
  const name = envelope.payload.name;
  const phone = envelope.payload.phone;
  const email = envelope.payload.email;
  const creditLimitMinor = asMinor(envelope.payload.creditLimitMinor, 'creditLimitMinor');
  const status = envelope.payload.status;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) throw new DomainError('VALIDATION_FAILED', 'Customer name is required and must be 160 characters or fewer.');
  if (typeof phone !== 'string' || phone.trim().length < 3 || phone.trim().length > 40) throw new DomainError('VALIDATION_FAILED', 'A customer phone number of 3 to 40 characters is required.');
  if (email !== undefined && email !== null && (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new DomainError('VALIDATION_FAILED', 'Customer email is invalid.');
  if (status !== 'ACTIVE' && status !== 'SUSPENDED') throw new DomainError('VALIDATION_FAILED', 'Customer status must be ACTIVE or SUSPENDED.');
  const current = await client.query<{ balance_minor: string; version: string }>(`SELECT balance_minor::text,version::text FROM finance.customer_accounts
    WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, session.tenantId]);
  if (!current.rowCount) throw new DomainError('NOT_FOUND', 'Customer account was not found.', 404);
  if (Number(current.rows[0].version) !== expectedVersion) throw new DomainError('VERSION_CONFLICT', 'The customer account changed. Reload it before saving.', 409, { currentVersion: Number(current.rows[0].version) });
  if (BigInt(creditLimitMinor) < BigInt(current.rows[0].balance_minor)) throw new DomainError('CUSTOMER_CREDIT_LIMIT_BELOW_BALANCE', 'Credit limit cannot be lower than the current account balance.', 409, { balanceMinor: current.rows[0].balance_minor });
  await client.query(`UPDATE finance.customer_accounts SET display_name=$3,phone=$4,email=$5,credit_limit_minor=$6,status=$7,version=version+1,updated_at=now()
    WHERE id=$1 AND tenant_id=$2`, [id, session.tenantId, name.trim(), phone.trim(), typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null, creditLimitMinor, status]);
  const result = { customerId: id, balanceMinor: current.rows[0].balance_minor, creditLimitMinor: String(creditLimitMinor), status, version: expectedVersion + 1 };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function recordCustomerRepayment(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const customerId = envelope.payload.customerId;
  const shiftId = envelope.payload.shiftId;
  const amountMinor = asMinor(envelope.payload.amountMinor, 'amountMinor');
  const reference = envelope.payload.reference;
  const tenderMethod = envelope.payload.tenderMethod ?? 'CASH';
  if (typeof customerId !== 'string' || typeof shiftId !== 'string' || amountMinor <= 0) throw new DomainError('VALIDATION_FAILED', 'Customer, open shift and a positive cash amount are required.');
  if (tenderMethod !== 'CASH') throw new DomainError('REQUIRES_ONLINE', 'Only cash repayments can be confirmed. Card and mobile-money provider verification is not connected.', 409);
  if (reference !== undefined && reference !== null && (typeof reference !== 'string' || reference.trim().length > 120)) throw new DomainError('VALIDATION_FAILED', 'Payment reference must be 120 characters or fewer.');
  const expectedShift = versionFor(envelope, `shift:${shiftId}`);
  if (!expectedShift) throw new DomainError('VALIDATION_FAILED', 'Expected shift version is required.');

  const shift = await client.query<{ version: string }>(`SELECT version::text FROM commerce.shifts
    WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' FOR UPDATE`,
  [shiftId, session.tenantId, session.outletId, session.userId]);
  if (!shift.rowCount) throw new DomainError('NOT_FOUND', 'Open shift was not found for this operator.', 404);
  if (Number(shift.rows[0].version) !== expectedShift) throw new DomainError('VERSION_CONFLICT', 'The open shift changed. Refresh before recording this repayment.', 409, { currentVersion: Number(shift.rows[0].version) });

  const account = await client.query<{ balance_minor: string; version: string }>(`SELECT balance_minor::text,version::text FROM finance.customer_accounts
    WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [customerId, session.tenantId]);
  if (!account.rowCount) throw new DomainError('NOT_FOUND', 'Customer account was not found.', 404);
  const currentBalance = BigInt(account.rows[0].balance_minor);
  if (BigInt(amountMinor) > currentBalance) throw new DomainError('VALIDATION_FAILED', 'Repayment cannot exceed the customer balance.', 409, { balanceMinor: currentBalance.toString() });

  const charges = await client.query<{ id: string; amount_minor: string; allocated_minor: string }>(`SELECT c.id,c.amount_minor::text,
      COALESCE(sum(a.amount_minor),0)::text allocated_minor
    FROM finance.customer_charges c LEFT JOIN finance.customer_repayment_allocations a
      ON a.tenant_id=c.tenant_id AND a.charge_id=c.id
    WHERE c.tenant_id=$1 AND c.customer_account_id=$2
    GROUP BY c.id,c.amount_minor,c.created_at ORDER BY c.created_at,c.id`, [session.tenantId, customerId]);
  const outstanding = charges.rows.map(charge => ({ id: charge.id, amount: BigInt(charge.amount_minor) - BigInt(charge.allocated_minor) }));
  const ledgerBalance = outstanding.reduce((sum, charge) => sum + charge.amount, 0n);
  if (ledgerBalance !== currentBalance) throw new DomainError('CUSTOMER_LEDGER_INTEGRITY_FAILED', 'Customer charges do not reconcile to the account balance.', 500);

  const tenant = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
  const repaymentId = randomUUID();
  await client.query(`INSERT INTO finance.customer_repayments(id,tenant_id,outlet_id,customer_account_id,shift_id,command_id,actor_id,amount_minor,currency,reference,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())`, [repaymentId, session.tenantId, session.outletId, customerId, shiftId, envelope.commandId, session.userId, amountMinor, tenant.rows[0].currency, typeof reference === 'string' ? reference.trim() || null : null]);
  let amountRemaining = BigInt(amountMinor);
  const allocations: Array<{ chargeId: string; amountMinor: string }> = [];
  for (const charge of outstanding) {
    if (amountRemaining === 0n) break;
    if (charge.amount <= 0n) continue;
    const allocation = charge.amount < amountRemaining ? charge.amount : amountRemaining;
    await client.query(`INSERT INTO finance.customer_repayment_allocations(id,tenant_id,repayment_id,charge_id,customer_account_id,amount_minor)
      VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), session.tenantId, repaymentId, charge.id, customerId, allocation.toString()]);
    allocations.push({ chargeId: charge.id, amountMinor: allocation.toString() });
    amountRemaining -= allocation;
  }
  if (amountRemaining !== 0n) throw new DomainError('CUSTOMER_LEDGER_INTEGRITY_FAILED', 'Repayment could not be allocated to open customer charges.', 500);
  const newBalance = currentBalance - BigInt(amountMinor);
  await client.query(`UPDATE finance.customer_accounts SET balance_minor=$3,version=version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
    [customerId, session.tenantId, newBalance.toString()]);
  const nextShiftVersion = expectedShift + 1;
  await client.query(`UPDATE commerce.shifts SET customer_collections_minor=customer_collections_minor+$5,
      expected_cash_minor=expected_cash_minor+$5,version=version+1
    WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4`, [shiftId, session.tenantId, session.outletId, session.userId, amountMinor]);
  await journal(client, session, envelope.commandId, 'CUSTOMER_REPAYMENT', tenant.rows[0].currency, [
    { account: 'CASH_TILL', debit: amountMinor, credit: 0 },
    { account: 'ACCOUNTS_RECEIVABLE', debit: 0, credit: amountMinor },
  ]);
  const result = { repaymentId, customerId, amountMinor: String(amountMinor), currency: tenant.rows[0].currency, previousBalanceMinor: currentBalance.toString(), balanceMinor: newBalance.toString(), allocationCount: allocations.length, allocations, shiftVersion: nextShiftVersion, tenderMethod: 'CASH' };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function createProduct(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const currencyResult=await client.query<{currency:string;business_profile:unknown;outlet_profile:unknown}>(`SELECT t.currency,t.business_profile,o.outlet_profile FROM core.tenants t
    JOIN core.outlets o ON o.tenant_id=t.id AND o.id=$2 AND o.active WHERE t.id=$1`,[session.tenantId,session.outletId]);
  if(!currencyResult.rowCount)throw new DomainError('NOT_FOUND','Active outlet was not found for catalog setup.',404);
  const businessTax=readBusinessProfile(currencyResult.rows[0].business_profile).taxPolicy;
  const outletTax=readOutletProfile(currencyResult.rows[0].outlet_profile).taxPolicy;
  const normalized=normalizeCatalogProductCreate(envelope.payload,{currency:currencyResult.rows[0].currency,taxRateBps:(outletTax??businessTax).defaultRateBps});
  const {sku,name,baseUnit,currency,sellingPriceMinor,costPriceMinor,taxRateBps,category,barcode,reorderLevel,itemKind}=normalized;
  requireItemKindCapability(session,itemKind);
  if(isStockTracked(itemKind))await assertNoOpenCatalogCount(client,session,true);
  const duplicate=await client.query('SELECT id FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND upper(btrim(sku))=upper($3) LIMIT 1',[session.tenantId,session.outletId,sku]);
  if(duplicate.rowCount)throw new DomainError('CATALOG_IDENTITY_CONFLICT','That SKU is reserved by an existing product at this outlet.',409,{productId:duplicate.rows[0].id});
  const categoryId=await resolveCatalogCategory(client,session,category,envelope.commandId),productId=randomUUID();
  try {
    await client.query(`INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,category,barcode,reorder_level,category_id,item_kind)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::numeric,$14,$15)`,[productId,session.tenantId,session.outletId,sku,name,baseUnit,currency,sellingPriceMinor,costPriceMinor,taxRateBps,category,barcode,reorderLevel,categoryId,itemKind]);
  }catch(error){catalogIdentityError(error);}
  if(isStockTracked(itemKind))await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity) VALUES($1,$2,$3,0)',[session.tenantId,session.outletId,productId]);
  const result={productId,sku};
  await audit(client,session,envelope.commandId,envelope.type,{...result,metadata:normalized,categoryId});
  await outbox(client,session,envelope.commandId,envelope.type,result);return result;
}

async function receiveInventory(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const documentReference=envelope.payload.documentReference;
  const supplierName=envelope.payload.supplierName;
  if(documentReference!==undefined&&(typeof documentReference!=='string'||documentReference.trim().length>120)) throw new DomainError('VALIDATION_FAILED','Delivery reference must be 120 characters or fewer.');
  if(supplierName!==undefined&&(typeof supplierName!=='string'||supplierName.trim().length>160)) throw new DomainError('VALIDATION_FAILED','Supplier name must be 160 characters or fewer.');
  const lines = envelope.payload.lines;
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 500) throw new DomainError('VALIDATION_FAILED', 'Provide between 1 and 500 receipt lines.');
  const seen = new Set<string>();
  const normalized = lines.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new DomainError('VALIDATION_FAILED', `Line ${index + 1} is invalid.`);
    const line = raw as Record<string, unknown>;
    if (typeof line.productId !== 'string' || seen.has(line.productId)) throw new DomainError('VALIDATION_FAILED', 'Receipt product IDs must be valid and unique.');
    seen.add(line.productId);
    const quantity = quantityMicros(line.quantity);
    const unitCost = asMinor(line.unitCostMinor, `lines[${index}].unitCostMinor`);
    if (unitCost === 0) throw new DomainError('VALIDATION_FAILED', 'Unit cost must be greater than zero for a receipt.');
    return { productId: line.productId, quantity, unitCost, extended: amountForQuantity(unitCost, quantity) };
  });
  const currencyResult = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
  let total = 0;
  for (const line of normalized) {
    const product = await client.query<{ id: string;item_kind:ItemKind }>('SELECT id,item_kind FROM catalog.products WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND active FOR UPDATE', [line.productId, session.tenantId, session.outletId]);
    if (!product.rowCount) throw new DomainError('NOT_FOUND', 'A receipt item is unavailable at this outlet.', 404);
    if(!isStockTracked(product.rows[0].item_kind))throw new DomainError('NOT_STOCKED_ITEM','Receiving requires a stocked good. Services and prepared sale items cannot receive physical stock here.',409,{productId:line.productId});
    await client.query('UPDATE inventory.balances SET quantity=quantity+$4::numeric,inventory_value_minor=inventory_value_minor+$5,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3', [session.tenantId, session.outletId, line.productId, quantityText(line.quantity), line.extended]);
    await client.query(
      `INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,document_reference)
       VALUES($1,$2,$3,$4,$5,'RECEIPT',$6::numeric,$7,$8,$9)`,
      [randomUUID(), session.tenantId, session.outletId, line.productId, envelope.commandId, quantityText(line.quantity), line.unitCost, line.extended, typeof documentReference==='string'?documentReference.trim()||null:null],
    );
    total += line.extended;
  }
  if (!Number.isSafeInteger(total)) throw new DomainError('VALIDATION_FAILED', 'Receipt total exceeds the supported safe integer range.');
  await journal(client, session, envelope.commandId, 'INVENTORY_RECEIPT', currencyResult.rows[0].currency, [
    { account: 'INVENTORY', debit: total, credit: 0 },
    { account: 'GOODS_RECEIVED_NOT_INVOICED', debit: 0, credit: total },
  ]);
  const result = { receiptId: envelope.commandId, lineCount: normalized.length, totalMinor: total, currency: currencyResult.rows[0].currency,documentReference:typeof documentReference==='string'?documentReference.trim()||null:null,supplierName:typeof supplierName==='string'?supplierName.trim()||null:null };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function openStockCount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const areaLabel = envelope.payload.areaLabel;
  if (areaLabel !== undefined && (typeof areaLabel !== 'string' || areaLabel.trim().length > 100)) {
    throw new DomainError('VALIDATION_FAILED', 'Count label must be 100 characters or fewer.');
  }
  const scope = envelope.payload.scope === undefined ? 'FULL' : envelope.payload.scope;
  if (scope !== 'FULL' && scope !== 'SELECTED') throw new DomainError('VALIDATION_FAILED', 'Choose a full outlet or selected-item count scope.');
  const blind = envelope.payload.blind === undefined ? false : envelope.payload.blind;
  if (typeof blind !== 'boolean') throw new DomainError('VALIDATION_FAILED', 'Blind count mode must be true or false.');
  const rawProductIds = envelope.payload.productIds;
  let selectedProductIds: string[] = [];
  if (scope === 'SELECTED') {
    if (!Array.isArray(rawProductIds) || rawProductIds.length < 1 || rawProductIds.length > COUNT_CAPACITY) throw new DomainError('VALIDATION_FAILED', `Choose between 1 and ${COUNT_CAPACITY} stocked items for a selected-item count.`);
    selectedProductIds = rawProductIds.map(value => {
      if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new DomainError('VALIDATION_FAILED', 'Selected item IDs must be valid catalogue items.');
      return value.toLowerCase();
    });
    if (new Set(selectedProductIds).size !== selectedProductIds.length) throw new DomainError('VALIDATION_FAILED', 'Each selected stock item can appear only once.');
  } else if (rawProductIds !== undefined) throw new DomainError('VALIDATION_FAILED', 'A full outlet count selects every active stocked good automatically.');
  const capacity = scope === 'FULL'
    ? await client.query("SELECT count(*)::int total FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND active AND item_kind='STOCKED_GOOD'", [session.tenantId, session.outletId])
    : await client.query("SELECT count(*)::int total FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=ANY($3::uuid[]) AND active AND item_kind='STOCKED_GOOD'", [session.tenantId, session.outletId, selectedProductIds]);
  if (capacity.rows[0].total > COUNT_CAPACITY) throw new DomainError('COUNT_CAPACITY_EXCEEDED', `A count supports at most ${COUNT_CAPACITY} stocked items. No partial count was opened.`, 409, { maximum: COUNT_CAPACITY, lineCount: capacity.rows[0].total });
  if (!capacity.rows[0].total) throw new DomainError('VALIDATION_FAILED', scope === 'SELECTED' ? 'Selected items must all be active stocked goods at this outlet.' : 'Create at least one stocked item before opening a count.');
  if (scope === 'SELECTED' && capacity.rows[0].total !== selectedProductIds.length) throw new DomainError('VALIDATION_FAILED', 'One or more selected items are unavailable, inactive, or not tracked as stock.');
  const countId = randomUUID();
  let header: { baseline_at: Date };
  try {
    const inserted = await client.query<{ baseline_at: Date }>(
      `INSERT INTO inventory.stock_counts(id,tenant_id,outlet_id,count_mode,blind_count,area_label,opened_by,recovery_protocol,recovery_coverage,baseline_at,opened_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,1,'COMPLETE',clock_timestamp(),clock_timestamp()) RETURNING baseline_at`,
      [countId, session.tenantId, session.outletId, scope, blind, typeof areaLabel === 'string' ? areaLabel.trim() || null : null, session.userId],
    );
    header = inserted.rows[0];
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new DomainError('VERSION_CONFLICT', 'An outlet stock count is already open. Resume that count instead.', 409);
    throw error;
  }
  const products = scope === 'FULL'
    ? await client.query("SELECT * FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND active AND item_kind='STOCKED_GOOD' ORDER BY id FOR UPDATE", [session.tenantId, session.outletId])
    : await client.query("SELECT * FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=ANY($3::uuid[]) AND active AND item_kind='STOCKED_GOOD' ORDER BY id FOR UPDATE", [session.tenantId, session.outletId, selectedProductIds]);
  const productIds = products.rows.map(row => row.id);
  const balances = await client.query('SELECT * FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=ANY($3::uuid[]) ORDER BY product_id FOR UPDATE', [session.tenantId, session.outletId, productIds]);
  const byProduct = new Map(balances.rows.map(row => [row.product_id, row]));
  if (products.rows.some(product => !byProduct.has(product.id))) throw new DomainError('INVENTORY_STATE_INVALID', 'A stocked item has no balance. Review the catalogue before opening its count.', 409);
  const boundaries = await client.query('SELECT product_id,max(movement_seq)::text through FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=ANY($3::uuid[]) GROUP BY product_id', [session.tenantId, session.outletId, productIds]);
  const through = new Map(boundaries.rows.map(row => [row.product_id, row.through]));
  for (const product of products.rows) {
    const balance = byProduct.get(product.id)!;
    await client.query(
      `INSERT INTO inventory.stock_count_lines(tenant_id,outlet_id,count_id,product_id,sku_snapshot,name_snapshot,base_unit_snapshot,baseline_quantity,baseline_balance_version,baseline_unit_cost_minor,baseline_inventory_value_minor,reviewed_product_version,baseline_item_kind,baseline_active,movement_after)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,'STOCKED_GOOD',true,$13)`,
      [session.tenantId, session.outletId, countId, product.id, product.sku, product.name, product.base_unit, balance.quantity, balance.version, product.cost_price_minor, balance.inventory_value_minor, product.version, through.get(product.id) ?? '0'],
    );
  }
  const eventId = await appendCountEvent(client, session, envelope, countId, 'OPENED', 1, 1, 'OPEN', new Map(), productIds);
  await client.query('UPDATE inventory.stock_counts SET last_event_id=$4 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3', [session.tenantId, session.outletId, countId, eventId]);
  const result = { countId, status: 'OPEN', scope, blind, lineCount: products.rowCount, version: 1, baselineAt: header.baseline_at };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function saveStockCount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const countId = envelope.payload.countId;
  if (typeof countId !== 'string') throw new DomainError('VALIDATION_FAILED', 'countId is required.');
  const expectedVersion = versionFor(envelope, `count:${countId}`);
  if (!expectedVersion) throw new DomainError('VALIDATION_FAILED', 'Expected count version is required.');
  const state = await loadCountState(client, session, countId, true), count = { rows: [state.header] };
  if (count.rows[0].status !== 'OPEN' || Number(count.rows[0].version) !== expectedVersion) {
    throw new DomainError('VERSION_CONFLICT', 'This stock count changed or is no longer open. Reload it before saving.', 409, { status: count.rows[0].status, currentVersion: Number(count.rows[0].version) });
  }
  const lines = envelope.payload.lines;
  if (state.lines.length > COUNT_CAPACITY) throw new DomainError('COUNT_CAPACITY_EXCEEDED', 'This legacy count exceeds the 5,000-item full-draft capacity. Preserve its evidence and cancel it for a supported count scope.', 409, { maximum: COUNT_CAPACITY, lineCount: state.lines.length });
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > COUNT_CAPACITY) throw new DomainError('VALIDATION_FAILED', 'Provide every count line to save the draft.');
  const baseline = { rows: state.lines, rowCount: state.lines.length };
  if (lines.length !== baseline.rowCount) throw new DomainError('VALIDATION_FAILED', 'The saved draft must contain every item in the count.');
  const allowedProducts = new Set(baseline.rows.map(row => row.product_id));
  const seen = new Set<string>();
  const normalized = lines.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new DomainError('VALIDATION_FAILED', `Count line ${index + 1} is invalid.`);
    const line = raw as Record<string, unknown>;
    if (typeof line.productId !== 'string' || seen.has(line.productId) || !allowedProducts.has(line.productId)) {
      throw new DomainError('VALIDATION_FAILED', 'Count line item IDs must be unique items from this count.');
    }
    seen.add(line.productId);
    const countedQuantity = countQuantityText(line.countedQuantity);
    const reason = line.varianceReason;
    if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.trim().length > 200)) throw new DomainError('VALIDATION_FAILED', 'Variance reason must be 200 characters or fewer.');
    return { productId: line.productId, countedQuantity, reason: typeof reason === 'string' ? reason.trim() || null : null };
  });
  await ensureCountCheckpoint(client, session, state);
  const changedIds: string[] = [];
  for (const line of normalized) {
    const old = state.lines.find(row => row.product_id === line.productId)!;
    if (countQuantityText(old.counted_quantity) === line.countedQuantity && old.variance_reason === line.reason) continue;
    changedIds.push(line.productId);
    await client.query(
      `UPDATE inventory.stock_count_lines SET counted_quantity=$5::numeric,variance_reason=$6,counted_by=$7,counted_at=CASE WHEN $5::numeric IS NULL THEN NULL ELSE clock_timestamp() END,
        counted_revision=CASE WHEN $5::numeric IS NULL THEN NULL ELSE baseline_revision END,requires_recount=CASE WHEN $5::numeric IS NULL THEN requires_recount ELSE false END
       WHERE tenant_id=$1 AND outlet_id=$2 AND count_id=$3 AND product_id=$4`,
      [session.tenantId, session.outletId, countId, line.productId, line.countedQuantity, line.reason, line.countedQuantity === null ? null : session.userId],
    );
  }
  const eventId = await appendCountEvent(client, session, envelope, countId, 'SAVED', expectedVersion + 1, state.header.baseline_revision, 'OPEN', countBefore(state, changedIds), changedIds);
  const updated = await client.query(
    `UPDATE inventory.stock_counts SET version=version+1,last_event_id=$5 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='OPEN' AND version=$4 RETURNING version::text version`,
    [countId, session.tenantId, session.outletId, expectedVersion, eventId],
  );
  if (!updated.rowCount) throw new DomainError('VERSION_CONFLICT', 'This stock count changed while it was being saved. Reload it before continuing.', 409);
  const result = { countId, status: 'OPEN', lineCount: normalized.length, version: Number(updated.rows[0].version) };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function postStockCount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const countId = envelope.payload.countId;
  if (typeof countId !== 'string') throw new DomainError('VALIDATION_FAILED', 'countId is required.');
  const expectedVersion = versionFor(envelope, `count:${countId}`);
  if (!expectedVersion) throw new DomainError('VALIDATION_FAILED', 'Expected count version is required.');
  const state = await loadCountState(client, session, countId, true), count = { rows: [state.header] };
  if (count.rows[0].status !== 'OPEN' || Number(count.rows[0].version) !== expectedVersion) {
    throw new DomainError('VERSION_CONFLICT', 'This stock count changed or is no longer open. Reload it before posting.', 409, { status: count.rows[0].status, currentVersion: Number(count.rows[0].version) });
  }
  const lines = { rows: state.lines, rowCount: state.lines.length };
  if (!lines.rowCount || lines.rows.some(line => line.counted_quantity === null)) throw new DomainError('VALIDATION_FAILED', 'Count every item in this saved scope before posting.');
  assertCountPostable(state);
  const currencyResult = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
  let gainMinor = 0n;
  let shrinkMinor = 0n;
  let adjustedLineCount = 0;
  const valuationReasonInput = envelope.payload.valuationReason;
  if (valuationReasonInput !== undefined && (typeof valuationReasonInput !== 'string' || !valuationReasonInput.trim() || valuationReasonInput.length > 500)) {
    throw new DomainError('VALIDATION_FAILED', 'A valuation approval reason must contain 1 to 500 characters.');
  }
  const valuationReason = typeof valuationReasonInput === 'string' ? valuationReasonInput.trim() : null;
  const canReadCost = ROLE_PERMISSIONS[session.role].some(permission => permission === 'catalog.manage' || permission === 'finance.view');
  const auditLines: Array<{ productId: string; sku: string; expected: string; counted: string; reason: string | null; valuation?: { origin: 'COUNT_OPENING_REFERENCE_COST_ESTIMATE'; unitCostMinor: string; proposedValueMinor: string; status: 'ESTIMATE' | 'ZERO_REFERENCE_COST' } }> = [];
  const zeroBaselineGains = lines.rows.filter(line => databaseQuantityMicros(line.baseline_quantity) === 0n && databaseQuantityMicros(line.counted_quantity!) > 0n);
  if (zeroBaselineGains.length && !canReadCost) throw new DomainError('FORBIDDEN', 'A count approver with catalog or finance cost access must review this zero-baseline valuation.', 403);
  if (zeroBaselineGains.length && !valuationReason) throw new DomainError('VALIDATION_FAILED', 'Review the proposed value of stock gained from a zero baseline and enter a valuation approval reason before posting.');
  if (!zeroBaselineGains.length && valuationReason) throw new DomainError('VALIDATION_FAILED', 'A valuation approval reason is only accepted when the count adds stock from a zero baseline.');
  for (const line of lines.rows) {
    const baselineMicros = databaseQuantityMicros(line.baseline_quantity);
    const countedMicros = databaseQuantityMicros(line.counted_quantity!);
    const deltaMicros = countedMicros - baselineMicros;
    const reason = line.variance_reason?.trim() || null;
    if (deltaMicros !== 0n && !reason) throw new DomainError('VALIDATION_FAILED', `A reason is required for the variance on ${line.sku_snapshot}.`);
    const isZeroBaselineGain = deltaMicros > 0n && baselineMicros === 0n;
    const referenceCostMinor = BigInt(line.baseline_unit_cost_minor);
    if (isZeroBaselineGain && referenceCostMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', `Reference cost for ${line.sku_snapshot} exceeds the supported safe money range.`);
    const proposedValueMinor = isZeroBaselineGain ? BigInt(amountForQuantity(Number(referenceCostMinor), deltaMicros)) : null;
    auditLines.push({ productId: line.product_id, sku: line.sku_snapshot, expected: line.baseline_quantity, counted: line.counted_quantity!, reason,
      ...(isZeroBaselineGain ? { valuation: { origin: 'COUNT_OPENING_REFERENCE_COST_ESTIMATE', unitCostMinor: referenceCostMinor.toString(), proposedValueMinor: proposedValueMinor!.toString(), status: referenceCostMinor === 0n ? 'ZERO_REFERENCE_COST' : 'ESTIMATE' } } : {}) });
    if (deltaMicros === 0n) continue;
    const baselineValue = BigInt(line.baseline_inventory_value_minor);
    const allocatedQuantity = deltaMicros < 0n ? -deltaMicros : deltaMicros;
    let valueMinor: bigint;
    if (deltaMicros > 0n && baselineMicros === 0n) {
      const fallbackCost = BigInt(line.baseline_unit_cost_minor);
      if (fallbackCost > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', `Reference cost for ${line.sku_snapshot} exceeds the supported safe money range.`);
      valueMinor = BigInt(amountForQuantity(Number(fallbackCost), allocatedQuantity));
    } else {
      valueMinor = valueForQuantity(baselineValue, baselineMicros, allocatedQuantity);
    }
    const nextInventoryValue = deltaMicros > 0n ? baselineValue + valueMinor : baselineValue - valueMinor;
    const valueText = checkedBigintMinor(nextInventoryValue, `Inventory value for ${line.sku_snapshot}`);
    if (deltaMicros > 0n) gainMinor = addMinorChecked(gainMinor, valueMinor);
    else shrinkMinor = addMinorChecked(shrinkMinor, valueMinor);
    await client.query(
      `UPDATE inventory.balances SET quantity=$4::numeric,inventory_value_minor=$6,version=version+1
       WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 AND version=$5`,
      [session.tenantId, session.outletId, line.product_id, line.counted_quantity, line.baseline_balance_version, valueText],
    );
    await client.query(
      `INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id,document_reference)
       VALUES($1,$2,$3,$4,$5,'COUNT_ADJUSTMENT',$6::numeric,$7,$8,$9,$10)`,
      [randomUUID(), session.tenantId, session.outletId, line.product_id, envelope.commandId, signedQuantityText(deltaMicros), baselineMicros > 0n ? roundedUnitCost(baselineValue, baselineMicros) : Number(line.baseline_unit_cost_minor), Number(valueMinor), countId, `Count ${countId.slice(0, 8).toUpperCase()}`],
    );
    adjustedLineCount += 1;
  }
  const totalVarianceMinor = gainMinor + shrinkMinor;
  if (totalVarianceMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', 'Count variance value exceeds the supported safe money range.');
  if (totalVarianceMinor > 0n) {
    await journal(client, session, envelope.commandId, 'INVENTORY_COUNT', currencyResult.rows[0].currency, [
      { account: 'INVENTORY', debit: Number(gainMinor), credit: 0 },
      { account: 'INVENTORY', debit: 0, credit: Number(shrinkMinor) },
      { account: 'INVENTORY_COUNT_GAIN', debit: 0, credit: Number(gainMinor) },
      { account: 'INVENTORY_COUNT_SHRINKAGE', debit: Number(shrinkMinor), credit: 0 },
    ]);
  }
  const eventId = await appendCountEvent(client, session, envelope, countId, 'POSTED', expectedVersion + 1, state.header.baseline_revision, 'POSTED', countBefore(state), state.lines.map(line => line.product_id), valuationReason);
  const posted = await client.query(
    `UPDATE inventory.stock_counts SET status='POSTED',version=version+1,posted_by=$4,posted_at=clock_timestamp(),last_event_id=$6
     WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='OPEN' AND version=$5 RETURNING version::text version`,
    [countId, session.tenantId, session.outletId, session.userId, expectedVersion, eventId],
  );
  if (!posted.rowCount) throw new DomainError('VERSION_CONFLICT', 'This stock count changed while posting. Reload it before continuing.', 409);
  const result = { countId, status: 'POSTED', lineCount: lines.rowCount, adjustedLineCount, gainMinor: Number(gainMinor), shrinkMinor: Number(shrinkMinor), totalVarianceMinor: Number(totalVarianceMinor), currency: currencyResult.rows[0].currency, version: Number(posted.rows[0].version) };
  await audit(client, session, envelope.commandId, envelope.type, { ...result, areaLabel: count.rows[0].area_label, valuationReview: zeroBaselineGains.length ? { reason: valuationReason, policy: 'COUNT_OPENING_REFERENCE_COST_ESTIMATE; ZERO_REFERENCE_COST_REQUIRES_MANAGER_REASON', gainLineCount: zeroBaselineGains.length } : null, lines: auditLines });
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function cancelStockCount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const countId = envelope.payload.countId;
  if (typeof countId !== 'string') throw new DomainError('VALIDATION_FAILED', 'countId is required.');
  const expectedVersion = versionFor(envelope, `count:${countId}`);
  if (!expectedVersion) throw new DomainError('VALIDATION_FAILED', 'Expected count version is required.');
  const state = await loadCountState(client, session, countId, true), count = { rows: [state.header] };
  if (count.rows[0].status !== 'OPEN' || Number(count.rows[0].version) !== expectedVersion) {
    throw new DomainError('VERSION_CONFLICT', 'This stock count changed or is no longer open.', 409, { status: count.rows[0].status, currentVersion: Number(count.rows[0].version) });
  }
  await ensureCountCheckpoint(client, session, state);
  const eventId = await appendCountEvent(client, session, envelope, countId, 'CANCELLED', expectedVersion + 1, state.header.baseline_revision, 'CANCELLED', countBefore(state), state.lines.map(line => line.product_id));
  const result = await client.query(
    `UPDATE inventory.stock_counts SET status='CANCELLED',version=version+1,cancelled_by=$4,cancelled_at=clock_timestamp(),last_event_id=$6
     WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='OPEN' AND version=$5 RETURNING version::text version`,
    [countId, session.tenantId, session.outletId, session.userId, expectedVersion, eventId],
  );
  if (!result.rowCount) throw new DomainError('VERSION_CONFLICT', 'This stock count changed while it was being cancelled.', 409);
  const value = { countId, status: 'CANCELLED', version: Number(result.rows[0].version) };
  await audit(client, session, envelope.commandId, envelope.type, value);
  await outbox(client, session, envelope.commandId, envelope.type, value);
  return value;
}

async function openShift(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const openingFloat = asMinor(envelope.payload.openingFloatMinor, 'openingFloatMinor');
  const expected = versionFor(envelope, 'shift:new');
  if (expected !== undefined) throw new DomainError('VALIDATION_FAILED', 'A new shift does not accept an expected version.');
  const shiftId = randomUUID();
  try {
    await client.query(
      `INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,expected_cash_minor)
       VALUES($1,$2,$3,$4,'OPEN',$5,$5)`,
      [shiftId, session.tenantId, session.outletId, session.userId, openingFloat],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new DomainError('VALIDATION_FAILED', 'You already have an open shift at this outlet.');
    throw error;
  }
  if (openingFloat) {
    const tenant = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
    await journal(client, session, envelope.commandId, 'SHIFT_OPEN', tenant.rows[0].currency, [
      { account: 'CASH_TILL', debit: openingFloat, credit: 0 },
      { account: 'CASH_FLOAT_CLEARING', debit: 0, credit: openingFloat },
    ]);
  }
  const result = { shiftId, version: 1, openingFloatMinor: openingFloat };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function recordShiftCashMovement(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const shiftId = envelope.payload.shiftId;
  const movementType = envelope.payload.movementType;
  const amount = asMinor(envelope.payload.amountMinor, 'amountMinor');
  const reason = envelope.payload.reason;
  const reference = envelope.payload.reference;
  if (typeof shiftId !== 'string') throw new DomainError('VALIDATION_FAILED', 'shiftId is required.');
  if (movementType !== 'PAID_IN' && movementType !== 'PAYOUT') throw new DomainError('VALIDATION_FAILED', 'movementType must be PAID_IN or PAYOUT.');
  if (amount === 0) throw new DomainError('VALIDATION_FAILED', 'Cash movement amount must be greater than zero.');
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 200) throw new DomainError('VALIDATION_FAILED', 'Enter a cash movement reason of 1 to 200 characters.');
  if (reference !== undefined && (typeof reference !== 'string' || reference.trim().length > 120)) throw new DomainError('VALIDATION_FAILED', 'Cash movement reference must be 120 characters or fewer.');
  const expected = versionFor(envelope, `shift:${shiftId}`);
  if (!expected) throw new DomainError('VALIDATION_FAILED', 'Expected shift version is required.');
  const shift = await client.query<{ expected_cash_minor: string; version: string }>(
    `SELECT expected_cash_minor,version FROM commerce.shifts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' FOR UPDATE`,
    [shiftId, session.tenantId, session.outletId, session.userId],
  );
  if (!shift.rowCount) throw new DomainError('NOT_FOUND', 'Open shift was not found for this operator.', 404);
  const row = shift.rows[0];
  if (Number(row.version) !== expected) throw new DomainError('VERSION_CONFLICT', 'The shift changed. Refresh its cash balance before recording a movement.', 409, { currentVersion: Number(row.version) });
  const currentCash = BigInt(row.expected_cash_minor);
  const amountBig = BigInt(amount);
  const nextCash = movementType === 'PAID_IN' ? currentCash + amountBig : currentCash - amountBig;
  if (nextCash < 0n) throw new DomainError('INSUFFICIENT_CASH', 'A payout cannot exceed the expected cash in this till.', 409, { availableMinor: Number(currentCash), payoutMinor: amount });
  if (nextCash > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', 'Shift cash exceeds the supported safe money range.');

  const movementId = randomUUID();
  await client.query(
    `INSERT INTO commerce.shift_cash_movements(id,tenant_id,outlet_id,shift_id,command_id,actor_id,movement_type,amount_minor,reason,reference)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [movementId, session.tenantId, session.outletId, shiftId, envelope.commandId, session.userId, movementType, amount, reason.trim(), typeof reference === 'string' ? reference.trim() || null : null],
  );
  const updated = await client.query<{ version: string }>(
    `UPDATE commerce.shifts SET expected_cash_minor=$5,version=version+1
     WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' AND version=$6 RETURNING version`,
    [shiftId, session.tenantId, session.outletId, session.userId, nextCash.toString(), expected],
  );
  if (!updated.rowCount) throw new DomainError('VERSION_CONFLICT', 'The shift changed while recording this movement.', 409);
  const tenant = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
  await journal(client, session, envelope.commandId, movementType === 'PAID_IN' ? 'SHIFT_CASH_PAID_IN' : 'SHIFT_CASH_PAYOUT', tenant.rows[0].currency, movementType === 'PAID_IN' ? [
    { account: 'CASH_TILL', debit: amount, credit: 0 }, { account: 'CASH_PAID_IN_CLEARING', debit: 0, credit: amount },
  ] : [
    { account: 'CASH_PAYOUT_CLEARING', debit: amount, credit: 0 }, { account: 'CASH_TILL', debit: 0, credit: amount },
  ]);
  const result = { movementId, shiftId, movementType, amountMinor: amount, expectedCashMinor: Number(nextCash), version: Number(updated.rows[0].version) };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function closeShift(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const shiftId = envelope.payload.shiftId;
  if (typeof shiftId !== 'string') throw new DomainError('VALIDATION_FAILED', 'shiftId is required.');
  const expected = versionFor(envelope, `shift:${shiftId}`);
  if (!expected) throw new DomainError('VALIDATION_FAILED', 'Expected shift version is required.');
  const counted = asMinor(envelope.payload.countedCashMinor, 'countedCashMinor');
  const shift = await client.query<{
    expected_cash_minor: string; opening_float_minor: string; cash_sales_minor: string;
    customer_collections_minor: string; cash_refunds_minor: string; mpesa_sales_minor: string; version: string; opened_at: Date;
  }>(
    `SELECT expected_cash_minor::text,opening_float_minor::text,cash_sales_minor::text,
        customer_collections_minor::text,cash_refunds_minor::text,mpesa_sales_minor::text,version::text,opened_at
     FROM commerce.shifts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' FOR UPDATE`,
    [shiftId, session.tenantId, session.outletId, session.userId],
  );
  if (!shift.rowCount) throw new DomainError('NOT_FOUND', 'Open shift was not found for this operator.', 404);
  const row = shift.rows[0];
  if (Number(row.version) !== expected) throw new DomainError('VERSION_CONFLICT', 'This shift changed. Reload its current cash-up before closing.', 409, { currentVersion: Number(row.version) });
  const movementTotals = await client.query<{ paid_in_minor: string; payout_minor: string }>(`SELECT
      COALESCE(sum(amount_minor) FILTER (WHERE movement_type='PAID_IN'),0)::text paid_in_minor,
      COALESCE(sum(amount_minor) FILTER (WHERE movement_type='PAYOUT'),0)::text payout_minor
    FROM commerce.shift_cash_movements WHERE tenant_id=$1 AND outlet_id=$2 AND shift_id=$3`,
  [session.tenantId, session.outletId, shiftId]);
  const openingFloat = BigInt(row.opening_float_minor);
  const cashSales = BigInt(row.cash_sales_minor);
  const customerCollections = BigInt(row.customer_collections_minor);
  const cashRefunds = BigInt(row.cash_refunds_minor);
  const cashPaidIn = BigInt(movementTotals.rows[0].paid_in_minor);
  const cashPayout = BigInt(movementTotals.rows[0].payout_minor);
  const expectedCashBig = BigInt(row.expected_cash_minor);
  const reconstructedCash = openingFloat + cashSales + customerCollections + cashPaidIn - cashPayout - cashRefunds;
  if (reconstructedCash < 0n || reconstructedCash !== expectedCashBig) {
    throw new DomainError('SHIFT_CASH_RECONCILIATION_FAILED', 'Shift cash totals do not reconcile to the expected till balance. Review the source records before closing.', 409, {
      expectedCashMinor: expectedCashBig.toString(),
      reconstructedCashMinor: reconstructedCash.toString(),
    });
  }
  const mpesaPayments = await client.query<{ amount_minor: string }>(`SELECT COALESCE(sum(p.amount_minor),0)::text amount_minor
    FROM commerce.payments p JOIN commerce.orders o ON o.tenant_id=p.tenant_id AND o.outlet_id=p.outlet_id AND o.id=p.order_id
    WHERE o.tenant_id=$1 AND o.outlet_id=$2 AND o.shift_id=$3 AND p.method='MANUAL_MPESA' AND p.status='CONFIRMED'`,
  [session.tenantId, session.outletId, shiftId]);
  const mpesaSales = BigInt(row.mpesa_sales_minor);
  if (mpesaSales !== BigInt(mpesaPayments.rows[0].amount_minor)) throw new DomainError('SHIFT_PAYMENT_RECONCILIATION_FAILED', 'The M-Pesa total does not match the recorded payments. Review these payments before closing.', 409);
  if (expectedCashBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('SHIFT_CASH_AMOUNT_UNSUPPORTED', 'Shift balance exceeds the supported safe money range. Contact an administrator.', 409);
  const varianceBig = BigInt(counted) - expectedCashBig;
  const variance = Number(varianceBig);
  const closedShift = await client.query<{ version: string; closed_at: Date }>(
    `UPDATE commerce.shifts SET status='CLOSED',counted_cash_minor=$5,variance_minor=$6,closed_at=clock_timestamp(),version=version+1
     WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' AND version=$7
     RETURNING version::text,closed_at`,
    [shiftId, session.tenantId, session.outletId, session.userId, counted, variance, expected],
  );
  if (!closedShift.rowCount) throw new DomainError('VERSION_CONFLICT', 'The shift changed while it was being closed.', 409);
  const stockExceptionCount = await client.query<{ count: string }>(`SELECT count(DISTINCT s.order_id)::text count
    FROM inventory.sale_shortfalls s JOIN commerce.orders o ON o.tenant_id=s.tenant_id AND o.outlet_id=s.outlet_id AND o.id=s.order_id
    WHERE o.tenant_id=$1 AND o.outlet_id=$2 AND o.shift_id=$3`, [session.tenantId, session.outletId, shiftId]);
  const identity = await client.query<{ tenant_name: string; outlet_name: string; time_zone: string; operator_name: string; currency: string; business_date: string }>(`SELECT t.name tenant_name,o.name outlet_name,o.time_zone,m.display_name operator_name,t.currency,
      to_char($3::timestamptz AT TIME ZONE o.time_zone,'YYYY-MM-DD') business_date
    FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id JOIN identity.memberships m ON m.tenant_id=t.id AND m.user_id=$2
    WHERE t.id=$1 AND o.id=$4`, [session.tenantId, session.userId, closedShift.rows[0].closed_at, session.outletId]);
  const snapshot = identity.rows[0];
  if (!snapshot) throw new DomainError('INTERNAL_ERROR', 'Shift close identity snapshot could not be loaded.', 500);
  const reportId = randomUUID();
  await client.query(`INSERT INTO commerce.shift_close_reports(
      id,tenant_id,outlet_id,shift_id,command_id,operator_id,tenant_name_snapshot,outlet_name_snapshot,
      operator_name_snapshot,time_zone_snapshot,business_date,currency,shift_version,opened_at,closed_at,
      opening_float_minor,cash_sales_minor,customer_collections_minor,cash_refunds_minor,
      cash_paid_in_minor,cash_payout_minor,expected_cash_minor,counted_cash_minor,variance_minor,mpesa_sales_minor,stock_exception_sales_count)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
  [reportId, session.tenantId, session.outletId, shiftId, envelope.commandId, session.userId,
    snapshot.tenant_name, snapshot.outlet_name, snapshot.operator_name, snapshot.time_zone, snapshot.business_date,
    snapshot.currency, closedShift.rows[0].version, row.opened_at, closedShift.rows[0].closed_at,
    openingFloat.toString(), cashSales.toString(), customerCollections.toString(), cashRefunds.toString(),
    cashPaidIn.toString(), cashPayout.toString(), expectedCashBig.toString(), counted, varianceBig.toString(), mpesaSales.toString(), Number(stockExceptionCount.rows[0].count)]);
  if (variance) {
    const tenant = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
    await journal(client, session, envelope.commandId, 'SHIFT_CASH_VARIANCE', tenant.rows[0].currency, variance > 0 ? [
      { account: 'CASH_TILL', debit: variance, credit: 0 }, { account: 'CASH_OVER_SHORT', debit: 0, credit: variance },
    ] : [
      { account: 'CASH_OVER_SHORT', debit: Math.abs(variance), credit: 0 }, { account: 'CASH_TILL', debit: 0, credit: Math.abs(variance) },
    ]);
  }
  const result = { shiftId, closeReportId: reportId, businessDate: snapshot.business_date, version: Number(closedShift.rows[0].version), expectedCashMinor: expectedCashBig.toString(), countedCashMinor: String(counted), varianceMinor: varianceBig.toString(), mpesaSalesMinor: mpesaSales.toString(), stockExceptionSalesCount: Number(stockExceptionCount.rows[0].count) };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function settleSale(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  saleRecord(envelope.payload, ['shiftId', 'lines', 'tenders', 'customerId', 'stockException'], 'Sale');
  const lines = envelope.payload.lines;
  const tenders = envelope.payload.tenders;
  const customerIdValue = envelope.payload.customerId;
  const customerId = typeof customerIdValue === 'string' ? customerIdValue : null;
  if (customerIdValue !== undefined && customerId === null) throw new DomainError('VALIDATION_FAILED', 'customerId must be a valid customer account identifier.');
  if (customerId) requirePermission(session, 'customers.charge');
  if (customerId) requireCapability(session, 'commerce');
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) throw new DomainError('VALIDATION_FAILED', 'Sale must contain between 1 and 100 lines.');
  if (!Array.isArray(tenders) || tenders.length > 10 || (!customerId && tenders.length < 1) || (customerId && tenders.length !== 0)) {
    throw new DomainError('VALIDATION_FAILED', customerId ? 'An account charge must not include a payment.' : 'Provide a payment for this sale.');
  }
  const payments = tenders.map((raw: unknown) => {
    const tender = saleRecord(raw, ['method', 'amountMinor', 'currency', 'reference', 'manuallyConfirmed'], 'Payment');
    if (tender.method !== 'CASH' && tender.method !== 'MANUAL_MPESA') throw new DomainError('VALIDATION_FAILED', 'Choose cash or manually confirmed M-Pesa.');
    if (typeof tender.currency !== 'string') throw new DomainError('VALIDATION_FAILED', 'Payment currency is required.');
    if (tender.method === 'CASH' && (Object.hasOwn(tender, 'reference') || Object.hasOwn(tender, 'manuallyConfirmed'))) {
      throw new DomainError('VALIDATION_FAILED', 'Cash cannot contain M-Pesa confirmation details.');
    }
    const reference = tender.method === 'MANUAL_MPESA' ? validateManualMpesaReference(tender.reference) : null;
    if (tender.method === 'MANUAL_MPESA' && tender.manuallyConfirmed !== true) throw new DomainError('PAYMENT_CONFIRMATION_REQUIRED', 'Check that the M-Pesa payment was received before confirming this sale.');
    return { method: tender.method as 'CASH' | 'MANUAL_MPESA', amountMinor: asMinor(tender.amountMinor, 'Payment amount'), currency: tender.currency, reference };
  });
  const manualMpesa = payments.some(payment => payment.method === 'MANUAL_MPESA');
  if (manualMpesa && (payments.length !== 1 || payments[0].method !== 'MANUAL_MPESA')) throw new DomainError('VALIDATION_FAILED', 'M-Pesa must pay the full sale using one transaction.');
  const tenderTotal = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  if (!Number.isSafeInteger(tenderTotal) || (customerId ? tenderTotal !== 0 : tenderTotal <= 0)) throw new DomainError('VALIDATION_FAILED', 'Payment amount is invalid.');

  const normalized = lines.map((raw, index) => {
    const line = saleRecord(raw, ['productId', 'quantity', 'discountMinor', 'discountReason'], `Item ${index + 1}`);
    if (typeof line.productId !== 'string') throw new DomainError('VALIDATION_FAILED', `Sale line ${index + 1} needs a productId.`);
    const discountMinor = line.discountMinor === undefined ? 0 : asMinor(line.discountMinor, 'Item discount');
    if (line.discountReason !== undefined && typeof line.discountReason !== 'string') throw new DomainError('VALIDATION_FAILED', 'The item discount reason is invalid.');
    const reason = typeof line.discountReason === 'string' ? line.discountReason.trim() : '';
    if (discountMinor > 0) {
      requirePermission(session, 'commerce.discount');
      if (reason.length < 3 || reason.length > 300) throw new DomainError('VALIDATION_FAILED', 'Give an item discount reason between 3 and 300 characters.');
    } else if (reason) throw new DomainError('VALIDATION_FAILED', 'A discount reason needs a positive item discount.');
    return { productId: line.productId, quantity: quantityMicros(line.quantity), discountMinor, discountReason: discountMinor > 0 ? reason : null };
  }).sort((a, b) => a.productId.localeCompare(b.productId));
  const uniqueProductIds = new Set(normalized.map(line => line.productId));
  if (uniqueProductIds.size !== normalized.length) throw new DomainError('VALIDATION_FAILED', 'Combine duplicate item lines before submitting the sale.');
  const stockAcknowledgement = stockExceptionAcknowledgement(envelope.payload.stockException);
  if (stockAcknowledgement?.lines.some(line => !uniqueProductIds.has(line.productId))) throw new DomainError('VALIDATION_FAILED', 'A stock exception confirmation references an item outside this sale.');

  const outletLock = await client.query('SELECT id FROM core.outlets WHERE tenant_id=$1 AND id=$2 AND active FOR SHARE', [session.tenantId, session.outletId]);
  if (!outletLock.rowCount) throw new DomainError('NOT_FOUND', 'The current outlet is no longer available.', 404);
  const policyResult = await client.query<{ enabled: boolean; allow_zero_reference_cost: boolean }>(
    'SELECT enabled,allow_zero_reference_cost FROM inventory.outlet_stock_sale_policies WHERE tenant_id=$1 AND outlet_id=$2 FOR SHARE',
    [session.tenantId, session.outletId]);
  const stockPolicy = policyResult.rowCount ? policyResult.rows[0] : { enabled: false, allow_zero_reference_cost: true };

  const shiftId = envelope.payload.shiftId;
  if (typeof shiftId !== 'string') throw new DomainError('VALIDATION_FAILED', 'An open shift is required.');
  const expectedShift = versionFor(envelope, `shift:${shiftId}`);
  if (!expectedShift) throw new DomainError('VALIDATION_FAILED', 'Expected shift version is required.');
  const shift = await client.query<{ version: string }>(`SELECT version FROM commerce.shifts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' FOR UPDATE`, [shiftId, session.tenantId, session.outletId, session.userId]);
  if (!shift.rowCount) throw new DomainError('NOT_FOUND', 'Open shift was not found for this operator.', 404);
  if (Number(shift.rows[0].version) !== expectedShift) throw new DomainError('VERSION_CONFLICT', 'The open shift changed. Refresh and retry using the current version.', 409, { currentVersion: Number(shift.rows[0].version) });

  const tenant = await client.query<{ currency: string; tenant_name: string; outlet_name: string; outlet_time_zone: string; business_profile: unknown; outlet_profile: unknown; logo_asset_id: string | null; receipt_qr_asset_id: string | null }>(`SELECT t.currency,t.name tenant_name,o.name outlet_name,o.time_zone outlet_time_zone,t.business_profile,o.outlet_profile,logo.id logo_asset_id,receipt_qr.id receipt_qr_asset_id
    FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id
    LEFT JOIN LATERAL (SELECT id FROM core.configuration_assets WHERE tenant_id=t.id AND kind='logo' AND status='ACTIVE' LIMIT 1) logo ON true
    LEFT JOIN LATERAL (SELECT id FROM core.configuration_assets WHERE tenant_id=t.id AND kind='receipt_qr' AND status='ACTIVE' LIMIT 1) receipt_qr ON true
    WHERE t.id=$1 AND o.id=$2`, [session.tenantId, session.outletId]);
  if (!tenant.rowCount) throw new DomainError('NOT_FOUND', 'Tenant outlet is no longer available.', 404);
  const currency = tenant.rows[0].currency;
  const productRows: Array<{ id: string; sku: string; name: string; currency: string; selling_price_minor: string; cost_price_minor: string; tax_rate_bps: number; quantity: string|null; inventory_value_minor: string|null; product_version: string;item_kind:ItemKind }> = [];
  for (const line of normalized) {
    const result = await client.query(
      `SELECT p.id,p.sku,p.name,p.currency,p.selling_price_minor,p.cost_price_minor,p.tax_rate_bps,p.version::text product_version,p.item_kind
       FROM catalog.products p WHERE p.id=$1 AND p.tenant_id=$2 AND p.outlet_id=$3 AND p.active FOR UPDATE OF p`,
      [line.productId, session.tenantId, session.outletId],
    );
    if (!result.rowCount) throw new DomainError('NOT_FOUND', 'A sale item is unavailable at this outlet.', 404);
    const product = result.rows[0] as typeof productRows[number];
    requireItemKindCapability(session,product.item_kind);
    if(product.item_kind==='PREPARED')throw new DomainError('RECIPE_CONSUMPTION_UNAVAILABLE','Prepared items cannot be sold until reviewed recipe consumption is available.',409,{productId:product.id});
    product.quantity=null;product.inventory_value_minor=null;
    if(isStockTracked(product.item_kind)) {
      const balance=await client.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 FOR UPDATE',[session.tenantId,session.outletId,product.id]);
      if(!balance.rowCount)throw new DomainError('INVENTORY_STATE_INVALID','A stocked item has no inventory balance. Review its inventory evidence before selling.',409,{productId:product.id});
      product.quantity=balance.rows[0].quantity;product.inventory_value_minor=balance.rows[0].inventory_value_minor;
    }
    const productVersion = Number(product.product_version);
    const quotedVersion = versionFor(envelope, `product:${product.id}`);
    if (Object.hasOwn(envelope.expectedVersions, `product:${product.id}`) && quotedVersion === undefined) throw new DomainError('VALIDATION_FAILED', 'Quoted product versions must be positive safe integers.');
    // Earlier clients could only sell revision-one items. After metadata imports,
    // a fresh catalog quote must be reviewed before charging its changed prices.
    if ((quotedVersion === undefined && productVersion !== 1) || (quotedVersion !== undefined && quotedVersion !== productVersion)) {
      throw new DomainError('VERSION_CONFLICT', `${product.name} changed after this basket was reviewed. Refresh the catalog and review the new price and tax before payment.`, 409, { productId: product.id, currentVersion: productVersion });
    }
    if (product.currency !== currency) throw new DomainError('VALIDATION_FAILED', 'Item price currency differs from tenant currency.');
    productRows.push(product);
  }
  const computed = normalized.map((line, index) => {
    const product = productRows[index];
    const stocked=isStockTracked(product.item_kind);
    const availableQuantity = stocked?databaseQuantityMicros(product.quantity!):0n;
    const recordedQuantity = stocked?(availableQuantity < line.quantity ? availableQuantity : line.quantity):0n;
    const shortfallQuantity = stocked?line.quantity - recordedQuantity:0n;
    const quantityTextValue = quantityText(line.quantity);
    const originalSubtotal = amountForQuantity(Number(product.selling_price_minor), line.quantity);
    if (line.discountMinor > originalSubtotal) throw new DomainError('DISCOUNT_EXCEEDS_LINE', `The discount for ${product.name} exceeds its item value.`);
    const subtotal = originalSubtotal - line.discountMinor;
    const tax = taxFor(subtotal, product.tax_rate_bps);
    const recordedCogsBig = recordedQuantity > 0n ? valueForQuantity(BigInt(product.inventory_value_minor!), availableQuantity, recordedQuantity) : 0n;
    const provisionalCogsBig = shortfallQuantity > 0n
      ? (BigInt(product.cost_price_minor) * shortfallQuantity + quantityScale / 2n) / quantityScale : 0n;
    const cogsBig = recordedCogsBig + provisionalCogsBig;
    if (cogsBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', 'Sale COGS exceeds the supported safe money range.');
    const cogs = Number(cogsBig);
    return { ...line, product, quantityText: quantityTextValue, originalSubtotal, subtotal, tax, cogs,
      recordedQuantity, recordedQuantityText: quantityText(recordedQuantity), shortfallQuantity, shortfallQuantityText: quantityText(shortfallQuantity),
      recordedCogs: Number(recordedCogsBig), provisionalCogs: Number(provisionalCogsBig), orderLineId: randomUUID() };
  });
  const shortfallLines = computed.filter(line => line.shortfallQuantity > 0n);
  const acknowledgementByProduct = new Map((stockAcknowledgement?.lines ?? []).map(line => [line.productId, line]));
  if (shortfallLines.length) {
    if (!stockPolicy.enabled) {
      const line = shortfallLines[0];
      throw new DomainError('INSUFFICIENT_STOCK', `${line.product.name} does not have enough available stock.`, 409, { productId: line.product.id });
    }
    if (!stockAcknowledgement || stockAcknowledgement.physicallyConfirmed !== true) {
      throw new DomainError('PHYSICAL_CONFIRMATION_REQUIRED', 'Confirm that the goods are physically available before completing this sale.', 409,
        { productIds: shortfallLines.map(line => line.product.id) });
    }
    if (acknowledgementByProduct.size !== shortfallLines.length || shortfallLines.some(line => !acknowledgementByProduct.has(line.product.id))) {
      throw new DomainError('VALIDATION_FAILED', 'Provide one reason and confirmed quantity for every item with insufficient recorded stock.');
    }
    for (const line of shortfallLines) {
      const acknowledgement = acknowledgementByProduct.get(line.product.id)!;
      if (acknowledgement.maxConfirmedShortfall < line.shortfallQuantity) {
        throw new DomainError('SHORTFALL_QUANTITY_CHANGED', `${line.product.name} has a larger stock shortfall than you confirmed. Refresh stock and review this item again.`, 409,
          { productId: line.product.id, currentShortfall: line.shortfallQuantityText, confirmedShortfall: quantityText(acknowledgement.maxConfirmedShortfall) });
      }
      if (!stockPolicy.allow_zero_reference_cost && BigInt(line.product.cost_price_minor) === 0n) {
        throw new DomainError('REFERENCE_COST_REQUIRED', `${line.product.name} needs a reference cost before a stock exception sale can be completed.`, 409, { productId: line.product.id });
      }
    }
  }
  const subtotal = computed.reduce((sum, line) => sum + line.subtotal, 0);
  const tax = computed.reduce((sum, line) => sum + line.tax, 0);
  const cogs = computed.reduce((sum, line) => sum + line.cogs, 0);
  const total = subtotal + tax;
  const discountMinor = computed.reduce((sum, line) => sum + line.discountMinor, 0);
  const originalSubtotalMinor = computed.reduce((sum, line) => sum + line.originalSubtotal, 0);
  if (![subtotal, tax, cogs, total, discountMinor, originalSubtotalMinor].every(Number.isSafeInteger) || total < 1) throw new DomainError('VALIDATION_FAILED', 'Sale total is invalid or exceeds the supported amount.');
  if (payments.some(payment => payment.currency !== currency)) throw new DomainError('VALIDATION_FAILED', 'Payment currency must match the sale.');
  if (manualMpesa && tenderTotal !== total) throw new DomainError('PAYMENT_AMOUNT_MISMATCH', 'The M-Pesa amount must equal the full amount due.', 400, { amountDueMinor: total, receivedMinor: tenderTotal });
  if (!customerId && tenderTotal < total) throw new DomainError('VALIDATION_FAILED', 'The payment does not cover the sale total.', 400, { amountDueMinor: total, tenderedMinor: tenderTotal });

  let customer: { name: string; balanceMinor: bigint; nextBalanceMinor: bigint } | null = null;
  if (customerId) {
    const account = await client.query<{ display_name: string; balance_minor: string; credit_limit_minor: string; status: string }>(`SELECT display_name,balance_minor::text,credit_limit_minor::text,status
      FROM finance.customer_accounts WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [customerId, session.tenantId]);
    if (!account.rowCount) throw new DomainError('NOT_FOUND', 'Customer account was not found.', 404);
    if (account.rows[0].status !== 'ACTIVE') throw new DomainError('CUSTOMER_ACCOUNT_SUSPENDED', 'This customer account is suspended. Contact a manager.', 409);
    const balanceMinor = BigInt(account.rows[0].balance_minor);
    const nextBalanceMinor = balanceMinor + BigInt(total);
    if (nextBalanceMinor > BigInt(account.rows[0].credit_limit_minor)) throw new DomainError('CUSTOMER_CREDIT_LIMIT_EXCEEDED', 'This sale exceeds the customer account credit limit.', 409, { balanceMinor: balanceMinor.toString(), creditLimitMinor: account.rows[0].credit_limit_minor, saleTotalMinor: String(total) });
    customer = { name: account.rows[0].display_name, balanceMinor, nextBalanceMinor };
  }

  const orderId = randomUUID();
  const receiptNumber = `MZ-${orderId.replaceAll('-', '').toUpperCase()}`;
  await client.query(
    `INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,
       receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot,cash_tendered_minor,change_minor,
       customer_account_id,customer_name_snapshot,customer_amount_due_minor,receipt_profile_snapshot)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CONFIRMED',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
    [orderId, session.tenantId, session.outletId, shiftId, session.userId, currency, subtotal, tax, total, receiptNumber,
      tenant.rows[0].tenant_name, tenant.rows[0].outlet_name, tenant.rows[0].outlet_time_zone,
       customerId || manualMpesa ? null : tenderTotal, customerId || manualMpesa ? null : tenderTotal - total, customerId, customer?.name ?? null, customerId ? total : 0,
      JSON.stringify(receiptConfigurationSnapshot(tenant.rows[0].business_profile, tenant.rows[0].outlet_profile, { logoId: tenant.rows[0].logo_asset_id, receiptQrId: tenant.rows[0].receipt_qr_asset_id }))],
  );
  for (const line of computed) {
    await client.query(
      `INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,cogs_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor,discount_minor,discount_reason,unrecorded_quantity,provisional_cogs_minor,item_kind_snapshot)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13,$14,$15,$16,$17::numeric,$18,$19)`,
      [line.orderLineId, session.tenantId, session.outletId, orderId, line.product.id, line.product.sku, line.product.name, line.quantityText, Number(line.product.selling_price_minor), isStockTracked(line.product.item_kind)?Number(line.product.cost_price_minor):0, line.cogs, line.product.tax_rate_bps, line.subtotal, line.tax, line.discountMinor, line.discountReason, line.shortfallQuantityText, line.provisionalCogs,line.product.item_kind],
    );
    if(isStockTracked(line.product.item_kind)) {
      const nextInventoryValue = BigInt(line.product.inventory_value_minor!) - BigInt(line.recordedCogs);
      await client.query('UPDATE inventory.balances SET quantity=quantity-$4::numeric,inventory_value_minor=$5,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3', [session.tenantId, session.outletId, line.product.id, line.recordedQuantityText, checkedBigintMinor(nextInventoryValue, `Inventory value for ${line.product.sku}`)]);
    }
    if (line.recordedQuantity > 0n) {
      await client.query(
        `INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id)
         VALUES($1,$2,$3,$4,$5,'SALE',-$6::numeric,$7,$8,$9)`,
        [randomUUID(), session.tenantId, session.outletId, line.product.id, envelope.commandId, line.recordedQuantityText, roundedUnitCost(BigInt(line.recordedCogs), line.recordedQuantity), line.recordedCogs, orderId],
      );
    }
    if (line.shortfallQuantity > 0n) {
      const acknowledgement = acknowledgementByProduct.get(line.product.id);
      if (!acknowledgement) throw new DomainError('INTERNAL_ERROR', 'The validated stock exception confirmation was not available.', 500);
      await client.query(`INSERT INTO inventory.sale_shortfalls(id,tenant_id,outlet_id,order_id,order_line_id,product_id,command_id,operator_id,
          quantity,recorded_quantity_before,requested_quantity,recorded_cogs_minor,provisional_cogs_minor,reason_code,reason_note,operator_name_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10::numeric,$11::numeric,$12,$13,$14,$15,$16)`,
      [randomUUID(), session.tenantId, session.outletId, orderId, line.orderLineId, line.product.id, envelope.commandId, session.userId,
        line.shortfallQuantityText, line.product.quantity, line.quantityText, line.recordedCogs, line.provisionalCogs, acknowledgement.reasonCode, acknowledgement.reasonNote, session.fullName]);
    }
  }
  let amountRemaining = total;
  for (const payment of payments) {
    const amount = payment.amountMinor;
    if (amount === 0 || amountRemaining === 0) continue;
    const inserted = await client.query(
      `INSERT INTO commerce.payments(id,tenant_id,outlet_id,order_id,method,amount_minor,currency,status,reference,manually_confirmed_by,manually_confirmed_at,confirmed_operator_name_snapshot)
       VALUES($1,$2,$3,$4,$5,$6,$7,'CONFIRMED',$8,$9,CASE WHEN $5='MANUAL_MPESA' THEN clock_timestamp() ELSE NULL END,$10)
       ON CONFLICT (tenant_id,reference) WHERE method='MANUAL_MPESA' DO NOTHING RETURNING id`,
      [randomUUID(), session.tenantId, session.outletId, orderId, payment.method, Math.min(amount, amountRemaining), currency, payment.reference, manualMpesa ? session.userId : null, manualMpesa ? session.fullName : null],
    );
    if (!inserted.rowCount) throw new DomainError('DUPLICATE_PAYMENT_REFERENCE', 'This M-Pesa reference has already been recorded. Check the earlier payment before taking payment again.', 409);
    amountRemaining -= Math.min(amount, amountRemaining);
  }
  const nextVersion = expectedShift + 1;
  if (customerId) {
    await client.query(`UPDATE commerce.shifts SET version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4`,
      [shiftId, session.tenantId, session.outletId, session.userId]);
    await client.query(`UPDATE finance.customer_accounts SET balance_minor=$3,version=version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [customerId, session.tenantId, customer!.nextBalanceMinor.toString()]);
    await client.query(`INSERT INTO finance.customer_charges(id,tenant_id,outlet_id,customer_account_id,order_id,amount_minor,currency,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`, [randomUUID(), session.tenantId, session.outletId, customerId, orderId, total, currency]);
  } else if (manualMpesa) {
    await client.query(`UPDATE commerce.shifts SET mpesa_sales_minor=mpesa_sales_minor+$5,version=version+1
      WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4`, [shiftId, session.tenantId, session.outletId, session.userId, total]);
  } else {
    await client.query(
      `UPDATE commerce.shifts SET cash_sales_minor=cash_sales_minor+$5,expected_cash_minor=expected_cash_minor+$5,version=version+1
       WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4`,
      [shiftId, session.tenantId, session.outletId, session.userId, total],
    );
  }
  const salesLines = [
    { account: customerId ? 'ACCOUNTS_RECEIVABLE' : manualMpesa ? 'MOBILE_MONEY_CONTROL' : 'CASH_TILL', debit: total, credit: 0 },
    { account: 'SALES_REVENUE', debit: 0, credit: subtotal },
    { account: 'VAT_PAYABLE', debit: 0, credit: tax },
  ];
  await journal(client, session, envelope.commandId, 'SALE', currency, salesLines);
  if (cogs > 0) await journal(client, session, envelope.commandId, 'SALE_COGS', currency, [
    { account: 'COST_OF_GOODS_SOLD', debit: cogs, credit: 0 },
    { account: 'INVENTORY', debit: 0, credit: computed.reduce((sum, line) => sum + line.recordedCogs, 0) },
    { account: 'UNRECORDED_STOCK_CLEARING', debit: 0, credit: computed.reduce((sum, line) => sum + line.provisionalCogs, 0) },
  ]);
  const stockExceptions = shortfallLines.map(line => ({ productId: line.product.id, name: line.product.name, quantity: line.shortfallQuantityText,
    reasonCode: acknowledgementByProduct.get(line.product.id)!.reasonCode }));
  const result = { saleId: orderId, receiptId: orderId, receiptNumber, currency, originalSubtotalMinor, discountMinor, subtotalMinor: subtotal, taxMinor: tax, totalMinor: total, paymentMethod: customerId ? 'customer_credit' : manualMpesa ? 'manual_mpesa' : 'cash', tenderedMinor: tenderTotal, changeMinor: customerId ? 0 : tenderTotal - total, ...(customerId ? { customerId, customerBalanceMinor: customer!.nextBalanceMinor.toString() } : {}), ...(stockExceptions.length ? { stockExceptions, stockExceptionCount: stockExceptions.length } : {}), shiftVersion: nextVersion, status: 'CONFIRMED' };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

export function refundPortionMinor(originalMinor:number,alreadyRefundedMinor:number,alreadyRefundedQty:bigint,refundQty:bigint,originalQty:bigint):number {
  if(!Number.isSafeInteger(originalMinor)||!Number.isSafeInteger(alreadyRefundedMinor)||alreadyRefundedMinor<0||alreadyRefundedMinor>originalMinor||refundQty<=0n||originalQty<=0n||alreadyRefundedQty+refundQty>originalQty) throw new DomainError('VALIDATION_FAILED','Refund allocation is outside the refundable line quantity.');
  const remainingQty=originalQty-alreadyRefundedQty;const remainingMinor=originalMinor-alreadyRefundedMinor;
  if(refundQty===remainingQty)return remainingMinor;
  return Number((BigInt(remainingMinor)*refundQty+remainingQty/2n)/remainingQty);
}

async function refundSale(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  const orderId=envelope.payload.orderId;const reason=envelope.payload.reason;const rawLines=envelope.payload.lines;
  if(typeof orderId!=='string'||typeof reason!=='string'||reason.trim().length<3||reason.trim().length>500)throw new DomainError('VALIDATION_FAILED','A sale ID and return reason are required.');
  if(!Array.isArray(rawLines)||rawLines.length<1||rawLines.length>100)throw new DomainError('VALIDATION_FAILED','Select at least one order line to refund.');
  const requested=rawLines.map((raw,index)=>{if(!raw||typeof raw!=='object')throw new DomainError('VALIDATION_FAILED',`Refund line ${index+1} is invalid.`);const row=raw as Record<string,unknown>;if(typeof row.orderLineId!=='string'||typeof row.restock!=='boolean')throw new DomainError('VALIDATION_FAILED',`Refund line ${index+1} requires an orderLineId and stock disposition.`);return {orderLineId:row.orderLineId,quantity:quantityMicros(row.quantity),restock:row.restock}});
  if(new Set(requested.map(line=>line.orderLineId)).size!==requested.length)throw new DomainError('VALIDATION_FAILED','Each order line can appear only once in a refund command.');
  const shiftId=envelope.payload.shiftId;if(typeof shiftId!=='string')throw new DomainError('VALIDATION_FAILED','Refund requires an open cash shift.');
  const expectedShift=versionFor(envelope,`shift:${shiftId}`);if(!expectedShift)throw new DomainError('VALIDATION_FAILED','Expected shift version is required.');
  const shift=await client.query<{version:string;expected_cash_minor:string}>(`SELECT version,expected_cash_minor FROM commerce.shifts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' FOR UPDATE`,[shiftId,session.tenantId,session.outletId,session.userId]);
  if(!shift.rowCount)throw new DomainError('NOT_FOUND','Open refund shift was not found for this operator.',404);
  if(Number(shift.rows[0].version)!==expectedShift)throw new DomainError('VERSION_CONFLICT','The shift changed. Reload before issuing the refund.',409,{currentVersion:Number(shift.rows[0].version)});
  const order=await client.query<{currency:string;status:string;subtotal_minor:string;tax_minor:string;total_minor:string;customer_account_id:string|null}>(`SELECT currency,status,subtotal_minor,tax_minor,total_minor,customer_account_id FROM commerce.orders WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 FOR UPDATE`,[orderId,session.tenantId,session.outletId]);
  if(!order.rowCount)throw new DomainError('NOT_FOUND','Sale was not found at this outlet.',404);
  if(order.rows[0].customer_account_id)throw new DomainError('CUSTOMER_CREDIT_REFUND_UNAVAILABLE','Customer credit refunds are blocked until account credits and tax-aware reversal workflow is implemented.',409);
  const nonCashPayment = await client.query(`SELECT 1 FROM commerce.payments WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 AND method='MANUAL_MPESA' AND status='CONFIRMED' LIMIT 1`,[session.tenantId,session.outletId,orderId]);
  if(nonCashPayment.rowCount)throw new DomainError('MANUAL_MPESA_REFUND_UNAVAILABLE','M-Pesa refunds are not available here. Do not refund this payment from the cash drawer.',409);
  const tenantCurrency=await client.query<{currency:string}>('SELECT currency FROM core.tenants WHERE id=$1',[session.tenantId]);
  if(order.rows[0].currency!==tenantCurrency.rows[0].currency)throw new DomainError('VALIDATION_FAILED','Sale currency differs from the active tenant currency.');
  const refundId=randomUUID();let subtotal=0,tax=0,cogs=0,restockedCogs=0,total=0,discount=0;const normalized=[] as Array<{orderLineId:string;productId:string;quantity:bigint;restock:boolean;subtotal:number;tax:number;cogs:number;unitCost:number;discount:number}>;
   for(const requestedLine of requested){
    const lineResult=await client.query<{product_id:string;quantity:string;line_subtotal_minor:string;line_tax_minor:string;cost_price_minor:string;cogs_minor:string;sku_snapshot:string;discount_minor:string;unrecorded_quantity:string;item_kind_snapshot:ItemKind}>(`SELECT product_id,quantity,line_subtotal_minor,line_tax_minor,cost_price_minor,cogs_minor,sku_snapshot,discount_minor,unrecorded_quantity::text unrecorded_quantity,item_kind_snapshot FROM commerce.order_lines WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND order_id=$4 FOR UPDATE`,[requestedLine.orderLineId,session.tenantId,session.outletId,orderId]);
    if(!lineResult.rowCount)throw new DomainError('NOT_FOUND','A selected item does not belong to this sale.',404);
    const line=lineResult.rows[0];const originalQty=databaseQuantityMicros(line.quantity);
    requireItemKindCapability(session,line.item_kind_snapshot);
    if(requestedLine.restock&&!isStockTracked(line.item_kind_snapshot))throw new DomainError('NONSTOCK_RESTOCK_UNAVAILABLE','A service refund cannot restore physical inventory. Choose no stock return.',409);
    if(requestedLine.restock){const active=await client.query('SELECT id,item_kind FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 AND active FOR UPDATE',[session.tenantId,session.outletId,line.product_id]);if(!active.rowCount)throw new DomainError('PRODUCT_ARCHIVED','Restore the original stocked product before restocking its returned quantity.',409);if(!isStockTracked(active.rows[0].item_kind))throw new DomainError('ITEM_KIND_CHANGED','This original stocked item has since been reclassified. Review its type before returning physical stock.',409);}
    if(requestedLine.restock&&databaseQuantityMicros(line.unrecorded_quantity)>0n)throw new DomainError('SHORTFALL_RESTOCK_REQUIRES_REVIEW','This item was sold while its stock records needed review. A manager must verify the returned stock before it can be added back to inventory.',409);
    const prior=await client.query<{quantity:string;subtotal_minor:string;tax_minor:string;cogs_minor:string;discount_minor:string}>('SELECT COALESCE(SUM(quantity),0)::text quantity,COALESCE(SUM(subtotal_minor),0)::text subtotal_minor,COALESCE(SUM(tax_minor),0)::text tax_minor,COALESCE(SUM(cogs_minor),0)::text cogs_minor,COALESCE(SUM(discount_minor),0)::text discount_minor FROM commerce.refund_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_line_id=$3',[session.tenantId,session.outletId,requestedLine.orderLineId]);
    const p=prior.rows[0];const priorQty=databaseQuantityMicros(p.quantity);if(priorQty+requestedLine.quantity>originalQty)throw new DomainError('ALREADY_REFUNDED','Requested quantity exceeds the unrefunded amount.',409,{orderLineId:requestedLine.orderLineId,remainingQuantity:quantityText(originalQty-priorQty)});
    const lineSubtotal=refundPortionMinor(Number(line.line_subtotal_minor),Number(p.subtotal_minor),priorQty,requestedLine.quantity,originalQty);
    const lineTax=refundPortionMinor(Number(line.line_tax_minor),Number(p.tax_minor),priorQty,requestedLine.quantity,originalQty);
    const lineCogs=refundPortionMinor(Number(line.cogs_minor),Number(p.cogs_minor),priorQty,requestedLine.quantity,originalQty);
    const lineDiscount=refundPortionMinor(Number(line.discount_minor),Number(p.discount_minor),priorQty,requestedLine.quantity,originalQty);
    const unitCost=roundedUnitCost(BigInt(line.cogs_minor),originalQty);subtotal+=lineSubtotal;tax+=lineTax;cogs+=lineCogs;if(requestedLine.restock)restockedCogs+=lineCogs;total+=lineSubtotal+lineTax;
    discount+=lineDiscount;
    normalized.push({...requestedLine,productId:line.product_id,subtotal:lineSubtotal,tax:lineTax,cogs:lineCogs,unitCost,discount:lineDiscount});
  }
  if(![subtotal,tax,cogs,restockedCogs,total,discount].every(Number.isSafeInteger)||total<0)throw new DomainError('VALIDATION_FAILED','Refund amount is invalid or exceeds the supported safe integer range.');
  const payments=await client.query<{paid_minor:string}>('SELECT COALESCE(SUM(amount_minor),0)::text paid_minor FROM commerce.payments WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 AND method=\'CASH\' AND status=\'CONFIRMED\'',[session.tenantId,session.outletId,orderId]);
  const priorRefunds=await client.query<{total_minor:string}>('SELECT COALESCE(SUM(total_minor),0)::text total_minor FROM commerce.refunds WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3',[session.tenantId,session.outletId,orderId]);
  if(BigInt(priorRefunds.rows[0].total_minor)+BigInt(total)>BigInt(payments.rows[0].paid_minor))throw new DomainError('PAYMENT_NOT_REFUNDABLE','Cash paid does not cover this refund.',409);
  const expectedCash=Number(shift.rows[0].expected_cash_minor);if(!Number.isSafeInteger(expectedCash)||expectedCash<total)throw new DomainError('INSUFFICIENT_CASH','The active till does not have enough expected cash for this refund.',409,{availableMinor:expectedCash,refundMinor:total});
  await client.query(`INSERT INTO commerce.refunds(id,tenant_id,outlet_id,order_id,shift_id,command_id,actor_id,currency,reason,subtotal_minor,tax_minor,total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[refundId,session.tenantId,session.outletId,orderId,shiftId,envelope.commandId,session.userId,tenantCurrency.rows[0].currency,reason.trim(),subtotal,tax,total]);
  for(const line of normalized){
    const qty=quantityText(line.quantity);
    await client.query(`INSERT INTO commerce.refund_lines(id,tenant_id,outlet_id,refund_id,order_id,order_line_id,product_id,quantity,subtotal_minor,tax_minor,cogs_minor,restocked,discount_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13)`,[randomUUID(),session.tenantId,session.outletId,refundId,orderId,line.orderLineId,line.productId,qty,line.subtotal,line.tax,line.cogs,line.restock,line.discount]);
    if(line.restock){
       await client.query('UPDATE inventory.balances SET quantity=quantity+$4::numeric,inventory_value_minor=inventory_value_minor+$5,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3',[session.tenantId,session.outletId,line.productId,qty,line.cogs]);
       await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id,document_reference) VALUES($1,$2,$3,$4,$5,'REFUND',$6::numeric,$7,$8,$9,$10)`,[randomUUID(),session.tenantId,session.outletId,line.productId,envelope.commandId,qty,line.unitCost,line.cogs,orderId,`Refund ${refundId}`]);
    }
  }
  await client.query('UPDATE commerce.shifts SET expected_cash_minor=expected_cash_minor-$5,cash_refunds_minor=cash_refunds_minor+$5,version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4',[shiftId,session.tenantId,session.outletId,session.userId,total]);
  const allReturned=await client.query<{all_refunded:boolean}>(`SELECT NOT EXISTS(SELECT 1 FROM commerce.order_lines ol WHERE ol.tenant_id=$1 AND ol.outlet_id=$2 AND ol.order_id=$3 AND ol.quantity>COALESCE((SELECT SUM(rl.quantity) FROM commerce.refund_lines rl WHERE rl.tenant_id=ol.tenant_id AND rl.outlet_id=ol.outlet_id AND rl.order_line_id=ol.id),0)) all_refunded`,[session.tenantId,session.outletId,orderId]);
  await client.query('UPDATE commerce.orders SET status=$4 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3',[orderId,session.tenantId,session.outletId,allReturned.rows[0].all_refunded?'REFUNDED':'PARTIALLY_REFUNDED']);
  if(total>0)await journal(client,session,envelope.commandId,'SALE_REFUND',tenantCurrency.rows[0].currency,[{account:'SALES_REVENUE',debit:subtotal,credit:0},{account:'VAT_PAYABLE',debit:tax,credit:0},{account:'CASH_TILL',debit:0,credit:total}]);
  if(restockedCogs>0)await journal(client,session,envelope.commandId,'SALE_REFUND_COGS',tenantCurrency.rows[0].currency,[{account:'INVENTORY',debit:restockedCogs,credit:0},{account:'COST_OF_GOODS_SOLD',debit:0,credit:restockedCogs}]);
  const result={refundId,orderId,totalMinor:total,originalSubtotalMinor:subtotal+discount,discountMinor:discount,subtotalMinor:subtotal,taxMinor:tax,currency:tenantCurrency.rows[0].currency,reason:reason.trim(),status:allReturned.rows[0].all_refunded?'REFUNDED':'PARTIALLY_REFUNDED',shiftVersion:expectedShift+1};
  await audit(client,session,envelope.commandId,envelope.type,result);await outbox(client,session,envelope.commandId,envelope.type,result);return result;
}

async function createHotelRoom(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  const roomNumber=envelope.payload.roomNumber;const roomType=envelope.payload.roomType;const rate=asMinor(envelope.payload.nightlyRateMinor,'nightlyRateMinor');
  if(typeof roomNumber!=='string'||!roomNumber.trim()||roomNumber.trim().length>24||typeof roomType!=='string'||!roomType.trim()||roomType.trim().length>80||rate===0)throw new DomainError('VALIDATION_FAILED','Room number, room type, and a positive nightly rate are required.');
  const tenant=await client.query<{currency:string;business_profile:unknown;outlet_profile:unknown}>(`SELECT t.currency,t.business_profile,o.outlet_profile FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id AND o.id=$2 AND o.active WHERE t.id=$1`,[session.tenantId,session.outletId]);
  if(!tenant.rowCount)throw new DomainError('NOT_FOUND','Active outlet was not found for room setup.',404);
  const roomId=randomUUID();const taxRateBps=envelope.payload.taxRateBps===undefined?(readOutletProfile(tenant.rows[0].outlet_profile).taxPolicy??readBusinessProfile(tenant.rows[0].business_profile).taxPolicy).defaultRateBps:envelope.payload.taxRateBps;
  if(typeof taxRateBps!=='number'||!Number.isInteger(taxRateBps)||taxRateBps<0||taxRateBps>10_000)throw new DomainError('VALIDATION_FAILED','Room tax rate must be from 0 through 10000 basis points.');
  try{await client.query(`INSERT INTO hospitality.rooms(id,tenant_id,outlet_id,room_number,room_type,nightly_rate_minor,tax_rate_bps,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[roomId,session.tenantId,session.outletId,roomNumber.trim(),roomType.trim(),rate,taxRateBps,tenant.rows[0].currency])}catch(error){if((error as {code?:string}).code==='23505')throw new DomainError('VALIDATION_FAILED','That room number already exists at this outlet.');throw error}
  const result={roomId,roomNumber:roomNumber.trim(),version:1};await audit(client,session,envelope.commandId,envelope.type,result);await outbox(client,session,envelope.commandId,envelope.type,result);return result;
}

async function roomForUpdate(client:PoolClient,session:ApiSession,roomId:string){const room=await client.query<{id:string;status:string;version:string;nightly_rate_minor:string;tax_rate_bps:number;currency:string}>(`SELECT id,status,version,nightly_rate_minor,tax_rate_bps,currency FROM hospitality.rooms WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 FOR UPDATE`,[roomId,session.tenantId,session.outletId]);if(!room.rowCount)throw new DomainError('NOT_FOUND','Room was not found at this outlet.',404);return room.rows[0]}

async function assertRoomAvailable(client:PoolClient,session:ApiSession,roomId:string,checkIn:string,checkOut:string,excludeReservationId?:string){
  const reservation=await client.query('SELECT id FROM hospitality.reservations WHERE tenant_id=$1 AND outlet_id=$2 AND room_id=$3 AND status=\'CONFIRMED\' AND check_in_date<$5::date AND check_out_date>$4::date AND ($6::uuid IS NULL OR id<>$6::uuid) LIMIT 1',[session.tenantId,session.outletId,roomId,checkIn,checkOut,excludeReservationId??null]);
  if(reservation.rowCount)throw new DomainError('ROOM_UNAVAILABLE','Room already has a confirmed reservation for part of those dates.',409,{reservationId:reservation.rows[0].id});
  const stay=await client.query('SELECT id FROM hospitality.stays WHERE tenant_id=$1 AND outlet_id=$2 AND room_id=$3 AND status=\'CHECKED_IN\' AND check_in_date<$5::date AND expected_check_out_date>$4::date LIMIT 1',[session.tenantId,session.outletId,roomId,checkIn,checkOut]);
  if(stay.rowCount)throw new DomainError('ROOM_UNAVAILABLE','Room is occupied for part of those dates.',409,{stayId:stay.rows[0].id});
}

async function createReservation(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  const roomId=envelope.payload.roomId;const guestName=envelope.payload.guestName;const guestContact=envelope.payload.guestContact;
  if(typeof roomId!=='string'||typeof guestName!=='string'||!guestName.trim()||guestName.trim().length>160||(guestContact!==undefined&&(typeof guestContact!=='string'||guestContact.length>80)))throw new DomainError('VALIDATION_FAILED','Room and guest name are required.');
  const checkIn=dateOnly(envelope.payload.checkInDate,'checkInDate');const checkOut=dateOnly(envelope.payload.checkOutDate,'checkOutDate');if(checkOut<=checkIn)throw new DomainError('VALIDATION_FAILED','Check-out date must be after check-in date.');
  const expected=versionFor(envelope,`room:${roomId}`);if(!expected)throw new DomainError('VALIDATION_FAILED','Expected room version is required.');
  const room=await roomForUpdate(client,session,roomId);if(room.status==='MAINTENANCE')throw new DomainError('ROOM_UNAVAILABLE','Room is unavailable for maintenance.',409);if(Number(room.version)!==expected)throw new DomainError('VERSION_CONFLICT','Room availability changed. Refresh and select a room again.',409,{currentVersion:Number(room.version)});
  await assertRoomAvailable(client,session,roomId,checkIn,checkOut);
  const reservationId=randomUUID();await client.query(`INSERT INTO hospitality.reservations(id,tenant_id,outlet_id,room_id,guest_name,guest_contact,check_in_date,check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,'CONFIRMED',$12)`,[reservationId,session.tenantId,session.outletId,roomId,guestName.trim(),typeof guestContact==='string'?guestContact.trim()||null:null,checkIn,checkOut,room.nightly_rate_minor,room.tax_rate_bps,room.currency,session.userId]);
  const bumped=await client.query<{version:string}>('UPDATE hospitality.rooms SET version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND version=$4 RETURNING version',[roomId,session.tenantId,session.outletId,expected]);if(!bumped.rowCount)throw new DomainError('VERSION_CONFLICT','Room availability changed while creating the reservation.',409);
  const result={reservationId,roomId,roomVersion:Number(bumped.rows[0].version),checkInDate:checkIn,checkOutDate:checkOut,status:'CONFIRMED'};await audit(client,session,envelope.commandId,envelope.type,result);await outbox(client,session,envelope.commandId,envelope.type,result);return result;
}

async function cancelReservation(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  const reservationId=envelope.payload.reservationId;
  if(typeof reservationId!=='string')throw new DomainError('VALIDATION_FAILED','reservationId is required.');const expected=versionFor(envelope,`reservation:${reservationId}`);if(!expected)throw new DomainError('VALIDATION_FAILED','Expected reservation version is required.');
  const result=await client.query<{version:string;room_id:string}>(`UPDATE hospitality.reservations SET status='CANCELLED',version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='CONFIRMED' AND version=$4 RETURNING version,room_id`,[reservationId,session.tenantId,session.outletId,expected]);
  if(!result.rowCount)throw new DomainError('VERSION_CONFLICT','Reservation was changed, cancelled, or checked in already.',409);
  const room=await client.query<{version:string}>(`UPDATE hospitality.rooms SET version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 RETURNING version`,[result.rows[0].room_id,session.tenantId,session.outletId]);
  const value={reservationId,status:'CANCELLED',version:Number(result.rows[0].version),roomVersion:Number(room.rows[0].version)};await audit(client,session,envelope.commandId,envelope.type,value);await outbox(client,session,envelope.commandId,envelope.type,value);return value;
}

async function checkInGuest(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  const reservationId=envelope.payload.reservationId;let roomId=envelope.payload.roomId;let guestName=envelope.payload.guestName;let guestContact=envelope.payload.guestContact;let checkIn='';let checkOut='';
  if(typeof reservationId==='string'){
    const reservation=await client.query<{room_id:string;guest_name:string;guest_contact:string|null;check_in_date:string;check_out_date:string;nightly_rate_minor:string;tax_rate_bps:number;currency:string;version:string}>(`SELECT room_id,guest_name,guest_contact,to_char(check_in_date,'YYYY-MM-DD') check_in_date,to_char(check_out_date,'YYYY-MM-DD') check_out_date,nightly_rate_minor,tax_rate_bps,currency,version FROM hospitality.reservations WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='CONFIRMED' FOR UPDATE`,[reservationId,session.tenantId,session.outletId]);
    if(!reservation.rowCount)throw new DomainError('NOT_FOUND','Confirmed reservation was not found.',404);const r=reservation.rows[0];const expectedReservation=versionFor(envelope,`reservation:${reservationId}`);if(!expectedReservation||Number(r.version)!==expectedReservation)throw new DomainError('VERSION_CONFLICT','Reservation changed. Refresh arrivals before check-in.',409,{currentVersion:Number(r.version)});
    roomId=r.room_id;guestName=r.guest_name;guestContact=r.guest_contact;checkIn=r.check_in_date;checkOut=r.check_out_date;
  }else{checkIn=dateOnly(envelope.payload.checkInDate,'checkInDate');checkOut=dateOnly(envelope.payload.checkOutDate,'checkOutDate')}
  if(typeof roomId!=='string'||typeof guestName!=='string'||!guestName.trim()||checkOut<=checkIn||(guestContact!==undefined&&guestContact!==null&&(typeof guestContact!=='string'||guestContact.length>80)))throw new DomainError('VALIDATION_FAILED','Room, guest name, and valid check-in/check-out dates are required.');
  const businessDate=await client.query<{currency:string;local_today:string}>(`SELECT t.currency,to_char(now() AT TIME ZONE o.time_zone,'YYYY-MM-DD') local_today FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id WHERE t.id=$1 AND o.id=$2`,[session.tenantId,session.outletId]);
  if(checkIn>businessDate.rows[0].local_today||checkOut<=businessDate.rows[0].local_today)throw new DomainError('VALIDATION_FAILED','Check-in is allowed only on or after the arrival date and before the booked departure date.',409,{businessDate:businessDate.rows[0].local_today,checkInDate:checkIn,checkOutDate:checkOut});
  if(typeof reservationId!=='string'&&checkIn!==businessDate.rows[0].local_today)throw new DomainError('VALIDATION_FAILED','Walk-in check-in must use the outlet business date.',409,{businessDate:businessDate.rows[0].local_today});
  const expectedRoom=versionFor(envelope,`room:${roomId}`);if(!expectedRoom)throw new DomainError('VALIDATION_FAILED','Expected room version is required.');const room=await roomForUpdate(client,session,roomId);
  if(room.status!=='READY'||Number(room.version)!==expectedRoom)throw new DomainError('VERSION_CONFLICT','Room is not ready or changed. Refresh room status before check-in.',409,{currentVersion:Number(room.version),roomStatus:room.status});
  await assertRoomAvailable(client,session,roomId,checkIn,checkOut,typeof reservationId==='string'?reservationId:undefined);
  const stayId=randomUUID();const folioId=randomUUID();const tenant=businessDate;
  if(room.currency!==tenant.rows[0].currency)throw new DomainError('VALIDATION_FAILED','Room rate currency differs from the tenant.');
  await client.query(`INSERT INTO hospitality.stays(id,tenant_id,outlet_id,room_id,reservation_id,guest_name,guest_contact,check_in_date,expected_check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12,'CHECKED_IN',$13)`,[stayId,session.tenantId,session.outletId,roomId,typeof reservationId==='string'?reservationId:null,guestName.trim(),typeof guestContact==='string'?guestContact.trim()||null:null,checkIn,checkOut,room.nightly_rate_minor,room.tax_rate_bps,room.currency,session.userId]);
  await client.query('INSERT INTO hospitality.folios(id,tenant_id,outlet_id,stay_id,currency) VALUES($1,$2,$3,$4,$5)',[folioId,session.tenantId,session.outletId,stayId,room.currency]);
  await client.query(`UPDATE hospitality.rooms SET status='OCCUPIED',version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND version=$4`,[roomId,session.tenantId,session.outletId,expectedRoom]);
  if(typeof reservationId==='string')await client.query(`UPDATE hospitality.reservations SET status='CHECKED_IN',version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3`,[reservationId,session.tenantId,session.outletId]);
  const value={stayId,folioId,roomId,roomVersion:expectedRoom+1,guestName:guestName.trim(),checkInDate:checkIn,checkOutDate:checkOut,status:'CHECKED_IN'};await audit(client,session,envelope.commandId,envelope.type,value);await outbox(client,session,envelope.commandId,envelope.type,value);return value;
}

async function checkOutGuest(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  const stayId=envelope.payload.stayId;const tendered=asMinor(envelope.payload.tenderedMinor,'tenderedMinor');if(typeof stayId!=='string')throw new DomainError('VALIDATION_FAILED','stayId is required.');const expectedStay=versionFor(envelope,`stay:${stayId}`);if(!expectedStay)throw new DomainError('VALIDATION_FAILED','Expected stay version is required.');
  const stay=await client.query<{room_id:string;folio_id:string;guest_name:string;check_in_date:string;expected_check_out_date:string;local_today:string;nightly_rate_minor:string;tax_rate_bps:number;currency:string;version:string;nights:number}>(`SELECT s.room_id,f.id folio_id,s.guest_name,to_char(s.check_in_date,'YYYY-MM-DD') check_in_date,to_char(s.expected_check_out_date,'YYYY-MM-DD') expected_check_out_date,to_char(now() AT TIME ZONE o.time_zone,'YYYY-MM-DD') local_today,s.nightly_rate_minor,s.tax_rate_bps,s.currency,s.version,(s.expected_check_out_date-s.check_in_date)::int nights FROM hospitality.stays s JOIN hospitality.folios f ON f.stay_id=s.id AND f.tenant_id=s.tenant_id AND f.outlet_id=s.outlet_id JOIN core.outlets o ON o.id=s.outlet_id AND o.tenant_id=s.tenant_id WHERE s.id=$1 AND s.tenant_id=$2 AND s.outlet_id=$3 AND s.status='CHECKED_IN' FOR UPDATE OF s,f`,[stayId,session.tenantId,session.outletId]);
  if(!stay.rowCount)throw new DomainError('NOT_FOUND','Active guest stay was not found.',404);const stayRow=stay.rows[0];if(Number(stayRow.version)!==expectedStay)throw new DomainError('VERSION_CONFLICT','Guest bill changed. Refresh before checkout.',409,{currentVersion:Number(stayRow.version)});
  if(stayRow.expected_check_out_date>stayRow.local_today)throw new DomainError('VALIDATION_FAILED','Checkout is available from the booked departure date in this release.',409,{businessDate:stayRow.local_today,bookedDepartureDate:stayRow.expected_check_out_date});
  const expectedRoom=versionFor(envelope,`room:${stayRow.room_id}`);if(!expectedRoom)throw new DomainError('VALIDATION_FAILED','Expected room version is required.');const room=await roomForUpdate(client,session,stayRow.room_id);if(room.status!=='OCCUPIED'||Number(room.version)!==expectedRoom)throw new DomainError('VERSION_CONFLICT','Room state changed. Refresh checkout details.',409,{currentVersion:Number(room.version)});
  const shiftId=envelope.payload.shiftId;if(typeof shiftId!=='string')throw new DomainError('VALIDATION_FAILED','Checkout cash requires an open cashier shift.');const expectedShift=versionFor(envelope,`shift:${shiftId}`);if(!expectedShift)throw new DomainError('VALIDATION_FAILED','Expected cashier shift version is required.');
  const shift=await client.query<{version:string;expected_cash_minor:string}>(`SELECT version,expected_cash_minor FROM commerce.shifts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' FOR UPDATE`,[shiftId,session.tenantId,session.outletId,session.userId]);if(!shift.rowCount)throw new DomainError('NOT_FOUND','Open cashier shift was not found for this operator.',404);if(Number(shift.rows[0].version)!==expectedShift)throw new DomainError('VERSION_CONFLICT','Cashier shift changed. Refresh before checkout.',409,{currentVersion:Number(shift.rows[0].version)});
  const nextExpectedCash=BigInt(shift.rows[0].expected_cash_minor);
  const tenant=await client.query<{currency:string}>('SELECT currency FROM core.tenants WHERE id=$1',[session.tenantId]);if(tenant.rows[0].currency!==stayRow.currency)throw new DomainError('VALIDATION_FAILED','Stay currency differs from the tenant.');if(envelope.payload.currency!==stayRow.currency)throw new DomainError('VALIDATION_FAILED','Tender currency must match the guest bill.');
  const subtotalBig=BigInt(stayRow.nightly_rate_minor)*BigInt(stayRow.nights);const taxBig=(subtotalBig*BigInt(stayRow.tax_rate_bps)+5000n)/10000n;const totalBig=subtotalBig+taxBig;if(totalBig>BigInt(Number.MAX_SAFE_INTEGER))throw new DomainError('VALIDATION_FAILED','Guest bill exceeds the supported safe money range.');const subtotal=Number(subtotalBig),tax=Number(taxBig),total=Number(totalBig);
  if(tendered<total)throw new DomainError('VALIDATION_FAILED','Cash tender does not cover the guest bill.',400,{amountDueMinor:total,tenderedMinor:tendered});
  if(nextExpectedCash+BigInt(total)>BigInt(Number.MAX_SAFE_INTEGER))throw new DomainError('VALIDATION_FAILED','Shift cash exceeds the supported safe money range.');
  const commandReceiptId=envelope.commandId;await client.query(`INSERT INTO hospitality.folio_entries(id,tenant_id,outlet_id,folio_id,command_id,entry_type,amount_minor,currency) VALUES($1,$2,$3,$4,$5,'ROOM_CHARGE',$6,$7),($8,$2,$3,$4,$5,'CASH_PAYMENT',$6,$7)`,[randomUUID(),session.tenantId,session.outletId,stayRow.folio_id,commandReceiptId,total,stayRow.currency,randomUUID()]);
  await client.query(`UPDATE hospitality.folios SET status='SETTLED' WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='OPEN'`,[stayRow.folio_id,session.tenantId,session.outletId]);
  await client.query(`UPDATE hospitality.stays SET status='CHECKED_OUT',checked_out_at=now(),version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3`,[stayId,session.tenantId,session.outletId]);
  await client.query(`UPDATE hospitality.reservations SET status='CHECKED_OUT',version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=(SELECT reservation_id FROM hospitality.stays WHERE id=$3 AND tenant_id=$1 AND outlet_id=$2) AND status='CHECKED_IN'`,[session.tenantId,session.outletId,stayId]);
  await client.query(`UPDATE hospitality.rooms SET status='DIRTY',version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND version=$4`,[stayRow.room_id,session.tenantId,session.outletId,expectedRoom]);
  await client.query(`INSERT INTO hospitality.housekeeping_events(id,tenant_id,outlet_id,room_id,command_id,actor_id,from_status,to_status) VALUES($1,$2,$3,$4,$5,$6,'OCCUPIED','DIRTY')`,[randomUUID(),session.tenantId,session.outletId,stayRow.room_id,commandReceiptId,session.userId]);
  await client.query(`UPDATE commerce.shifts SET expected_cash_minor=expected_cash_minor+$5,cash_sales_minor=cash_sales_minor+$5,version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4`,[shiftId,session.tenantId,session.outletId,session.userId,total]);
  await journal(client,session,commandReceiptId,'ROOM_CHECKOUT',stayRow.currency,[{account:'CASH_TILL',debit:total,credit:0},{account:'ROOM_REVENUE',debit:0,credit:subtotal},{account:'VAT_PAYABLE',debit:0,credit:tax}]);
  const value={stayId,folioId:stayRow.folio_id,roomId:stayRow.room_id,guestName:stayRow.guest_name,nights:stayRow.nights,subtotalMinor:subtotal,taxMinor:tax,totalMinor:total,tenderedMinor:tendered,changeMinor:tendered-total,currency:stayRow.currency,status:'CHECKED_OUT',roomStatus:'DIRTY',stayVersion:expectedStay+1,roomVersion:expectedRoom+1,shiftVersion:expectedShift+1};await audit(client,session,commandReceiptId,envelope.type,value);await outbox(client,session,commandReceiptId,envelope.type,value);return value;
}

async function markRoomReady(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  const roomId=envelope.payload.roomId;if(typeof roomId!=='string')throw new DomainError('VALIDATION_FAILED','roomId is required.');const expected=versionFor(envelope,`room:${roomId}`);if(!expected)throw new DomainError('VALIDATION_FAILED','Expected room version is required.');const room=await roomForUpdate(client,session,roomId);if(room.status!=='DIRTY'||Number(room.version)!==expected)throw new DomainError('VERSION_CONFLICT','Only a dirty room at its current version can be marked ready.',409,{roomStatus:room.status,currentVersion:Number(room.version)});await client.query(`UPDATE hospitality.rooms SET status='READY',version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND version=$4`,[roomId,session.tenantId,session.outletId,expected]);await client.query(`INSERT INTO hospitality.housekeeping_events(id,tenant_id,outlet_id,room_id,command_id,actor_id,from_status,to_status) VALUES($1,$2,$3,$4,$5,$6,'DIRTY','READY')`,[randomUUID(),session.tenantId,session.outletId,roomId,envelope.commandId,session.userId]);const value={roomId,status:'READY',version:expected+1};await audit(client,session,envelope.commandId,envelope.type,value);await outbox(client,session,envelope.commandId,envelope.type,value);return value;
}

export function hashCommand(envelope: CommandEnvelope): Buffer {
  return createHash('sha256').update(stableStringify(envelope)).digest();
}
