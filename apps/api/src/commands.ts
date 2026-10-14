import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ApiPermission, ApiSession, CommandEnvelope } from './contracts.js';
import { DomainError, ROLE_PERMISSIONS } from './contracts.js';
import { stableStringify } from './security.js';
import { executeConfigurationCommand, receiptConfigurationSnapshot } from './configuration.js';

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
  switch (envelope.type) {
    case 'configuration.business.update':
    case 'configuration.outlet.update':
    case 'configuration.capabilities.update': return executeConfigurationCommand(client, session, envelope);
    case 'catalog.product.create': return createProduct(client, session, envelope);
    case 'inventory.receive': return receiveInventory(client, session, envelope);
    case 'inventory.count.open': return openStockCount(client, session, envelope);
    case 'inventory.count.save': return saveStockCount(client, session, envelope);
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
  requireCapability(session, 'commerce');
  requirePermission(session, 'customers.manage');
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
  requireCapability(session, 'commerce');
  requirePermission(session, 'customers.manage');
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
  requireCapability(session, 'commerce');
  requirePermission(session, 'customers.settle');
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
  requirePermission(session, 'catalog.manage');
  const { sku, name, baseUnit, currency, sellingPriceMinor, costPriceMinor, taxRateBps } = envelope.payload;
  if (typeof sku !== 'string' || !/^[\w.-]{1,64}$/.test(sku) || typeof name !== 'string' || !name.trim() || name.length > 160 || typeof baseUnit !== 'string' || !/^[\w.-]{1,24}$/.test(baseUnit)) {
    throw new DomainError('VALIDATION_FAILED', 'SKU, item name, and base unit are required and must be valid.');
  }
  const sell = asMinor(sellingPriceMinor, 'sellingPriceMinor');
  const cost = asMinor(costPriceMinor, 'costPriceMinor');
  if (!Number.isInteger(taxRateBps) || Number(taxRateBps) < 0 || Number(taxRateBps) > 10_000) throw new DomainError('VALIDATION_FAILED', 'taxRateBps must be from 0 through 10000.');
  const currencyResult = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
  if (currency !== currencyResult.rows[0]?.currency) throw new DomainError('VALIDATION_FAILED', 'Product currency must match the tenant currency.');
  const productId = randomUUID();
  try {
    await client.query(
      `INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [productId, session.tenantId, session.outletId, sku.trim(), name.trim(), baseUnit, currency, sell, cost, taxRateBps],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new DomainError('VALIDATION_FAILED', 'That SKU already exists at this outlet.');
    throw error;
  }
  await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity) VALUES($1,$2,$3,0)', [session.tenantId, session.outletId, productId]);
  const result = { productId, sku: sku.trim() };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function receiveInventory(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requirePermission(session, 'inventory.receive');
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
    const product = await client.query<{ id: string }>('SELECT id FROM catalog.products WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND active FOR UPDATE', [line.productId, session.tenantId, session.outletId]);
    if (!product.rowCount) throw new DomainError('NOT_FOUND', 'A receipt item is unavailable at this outlet.', 404);
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
  requirePermission(session, 'inventory.count');
  const areaLabel = envelope.payload.areaLabel;
  if (areaLabel !== undefined && (typeof areaLabel !== 'string' || areaLabel.trim().length > 100)) {
    throw new DomainError('VALIDATION_FAILED', 'Count label must be 100 characters or fewer.');
  }
  const snapshots = await client.query<{ product_id: string; sku: string; name: string; base_unit: string; quantity: string; balance_version: string; inventory_value_minor: string; cost_price_minor: string }>(
    `SELECT p.id product_id,p.sku,p.name,p.base_unit,b.quantity::text quantity,b.version::text balance_version,b.inventory_value_minor::text inventory_value_minor,p.cost_price_minor::text cost_price_minor
     FROM catalog.products p JOIN inventory.balances b ON b.tenant_id=p.tenant_id AND b.outlet_id=p.outlet_id AND b.product_id=p.id
     WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.active ORDER BY p.id FOR UPDATE OF b`,
    [session.tenantId, session.outletId],
  );
  if (!snapshots.rowCount) throw new DomainError('VALIDATION_FAILED', 'Create and receive at least one stock item before opening a count.');
  const countId = randomUUID();
  let header: { baseline_at: Date };
  try {
    const inserted = await client.query<{ baseline_at: Date }>(
      `INSERT INTO inventory.stock_counts(id,tenant_id,outlet_id,area_label,opened_by)
       VALUES($1,$2,$3,$4,$5) RETURNING baseline_at`,
      [countId, session.tenantId, session.outletId, typeof areaLabel === 'string' ? areaLabel.trim() || null : null, session.userId],
    );
    header = inserted.rows[0];
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new DomainError('VERSION_CONFLICT', 'An outlet stock count is already open. Resume that count instead.', 409);
    throw error;
  }
  for (const row of snapshots.rows) {
    await client.query(
      `INSERT INTO inventory.stock_count_lines(tenant_id,outlet_id,count_id,product_id,sku_snapshot,name_snapshot,base_unit_snapshot,baseline_quantity,baseline_balance_version,baseline_unit_cost_minor,baseline_inventory_value_minor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11)`,
      [session.tenantId, session.outletId, countId, row.product_id, row.sku, row.name, row.base_unit, row.quantity, row.balance_version, row.cost_price_minor, row.inventory_value_minor],
    );
  }
  const result = { countId, status: 'OPEN', lineCount: snapshots.rowCount, version: 1, baselineAt: header.baseline_at };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function saveStockCount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requirePermission(session, 'inventory.count');
  const countId = envelope.payload.countId;
  if (typeof countId !== 'string') throw new DomainError('VALIDATION_FAILED', 'countId is required.');
  const expectedVersion = versionFor(envelope, `count:${countId}`);
  if (!expectedVersion) throw new DomainError('VALIDATION_FAILED', 'Expected count version is required.');
  const count = await client.query<{ status: string; version: string }>(
    'SELECT status,version::text version FROM inventory.stock_counts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 FOR UPDATE',
    [countId, session.tenantId, session.outletId],
  );
  if (!count.rowCount) throw new DomainError('NOT_FOUND', 'Stock count was not found.', 404);
  if (count.rows[0].status !== 'OPEN' || Number(count.rows[0].version) !== expectedVersion) {
    throw new DomainError('VERSION_CONFLICT', 'This stock count changed or is no longer open. Reload it before saving.', 409, { status: count.rows[0].status, currentVersion: Number(count.rows[0].version) });
  }
  const lines = envelope.payload.lines;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 5000) throw new DomainError('VALIDATION_FAILED', 'Provide every count line to save the draft.');
  const baseline = await client.query<{ product_id: string }>(
    'SELECT product_id FROM inventory.stock_count_lines WHERE tenant_id=$1 AND outlet_id=$2 AND count_id=$3 ORDER BY product_id',
    [session.tenantId, session.outletId, countId],
  );
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
  for (const line of normalized) {
    await client.query(
      `UPDATE inventory.stock_count_lines SET counted_quantity=$5::numeric,variance_reason=$6,counted_by=$7,counted_at=CASE WHEN $5::numeric IS NULL THEN NULL ELSE now() END
       WHERE tenant_id=$1 AND outlet_id=$2 AND count_id=$3 AND product_id=$4`,
      [session.tenantId, session.outletId, countId, line.productId, line.countedQuantity, line.reason, line.countedQuantity === null ? null : session.userId],
    );
  }
  const updated = await client.query(
    `UPDATE inventory.stock_counts SET version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='OPEN' AND version=$4 RETURNING version::text version`,
    [countId, session.tenantId, session.outletId, expectedVersion],
  );
  if (!updated.rowCount) throw new DomainError('VERSION_CONFLICT', 'This stock count changed while it was being saved. Reload it before continuing.', 409);
  const result = { countId, status: 'OPEN', lineCount: normalized.length, version: Number(updated.rows[0].version) };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function postStockCount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requirePermission(session, 'inventory.count.approve');
  const countId = envelope.payload.countId;
  if (typeof countId !== 'string') throw new DomainError('VALIDATION_FAILED', 'countId is required.');
  const expectedVersion = versionFor(envelope, `count:${countId}`);
  if (!expectedVersion) throw new DomainError('VALIDATION_FAILED', 'Expected count version is required.');
  const count = await client.query<{ status: string; version: string; area_label: string | null }>(
    'SELECT status,version::text version,area_label FROM inventory.stock_counts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 FOR UPDATE',
    [countId, session.tenantId, session.outletId],
  );
  if (!count.rowCount) throw new DomainError('NOT_FOUND', 'Stock count was not found.', 404);
  if (count.rows[0].status !== 'OPEN' || Number(count.rows[0].version) !== expectedVersion) {
    throw new DomainError('VERSION_CONFLICT', 'This stock count changed or is no longer open. Reload it before posting.', 409, { status: count.rows[0].status, currentVersion: Number(count.rows[0].version) });
  }
  const lines = await client.query<{ product_id: string; sku_snapshot: string; name_snapshot: string; base_unit_snapshot: string; baseline_quantity: string; baseline_balance_version: string; baseline_unit_cost_minor: string; baseline_inventory_value_minor: string; counted_quantity: string | null; variance_reason: string | null }>(
    `SELECT product_id,sku_snapshot,name_snapshot,base_unit_snapshot,baseline_quantity::text baseline_quantity,baseline_balance_version::text baseline_balance_version,
       baseline_unit_cost_minor::text baseline_unit_cost_minor,baseline_inventory_value_minor::text baseline_inventory_value_minor,counted_quantity::text counted_quantity,variance_reason
     FROM inventory.stock_count_lines WHERE tenant_id=$1 AND outlet_id=$2 AND count_id=$3 ORDER BY product_id`,
    [session.tenantId, session.outletId, countId],
  );
  if (!lines.rowCount || lines.rows.some(line => line.counted_quantity === null)) throw new DomainError('VALIDATION_FAILED', 'Count every listed item before posting the full outlet count.');
  const unlisted = await client.query<{ id: string }>(
    `SELECT p.id FROM catalog.products p LEFT JOIN inventory.stock_count_lines l
       ON l.tenant_id=p.tenant_id AND l.outlet_id=p.outlet_id AND l.count_id=$3 AND l.product_id=p.id
     WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.active AND l.product_id IS NULL LIMIT 1`,
    [session.tenantId, session.outletId, countId],
  );
  if (unlisted.rowCount) throw new DomainError('VERSION_CONFLICT', 'The item catalogue changed after this count opened. Reload the count and recount before posting.', 409, { newProductId: unlisted.rows[0].id });
  const productIds = lines.rows.map(line => line.product_id);
  const balances = await client.query<{ product_id: string; quantity: string; version: string; inventory_value_minor: string }>(
    `SELECT product_id,quantity::text quantity,version::text version,inventory_value_minor::text inventory_value_minor FROM inventory.balances
     WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=ANY($3::uuid[]) ORDER BY product_id FOR UPDATE`,
    [session.tenantId, session.outletId, productIds],
  );
  const balancesByProduct = new Map(balances.rows.map(row => [row.product_id, row]));
  const stale = lines.rows.filter(line => {
    const balance = balancesByProduct.get(line.product_id);
    return !balance || Number(balance.version) !== Number(line.baseline_balance_version) || databaseQuantityMicros(balance.quantity) !== databaseQuantityMicros(line.baseline_quantity) || BigInt(balance.inventory_value_minor) !== BigInt(line.baseline_inventory_value_minor);
  });
  if (stale.length) throw new DomainError('VERSION_CONFLICT', 'Stock changed after this count opened. Review the changed items, recount them, and open a fresh count before posting.', 409, { changedProductIds: stale.map(line => line.product_id) });
  const currencyResult = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
  let gainMinor = 0n;
  let shrinkMinor = 0n;
  let adjustedLineCount = 0;
  const auditLines: Array<{ productId: string; sku: string; expected: string; counted: string; reason: string | null }> = [];
  for (const line of lines.rows) {
    const baselineMicros = databaseQuantityMicros(line.baseline_quantity);
    const countedMicros = databaseQuantityMicros(line.counted_quantity!);
    const deltaMicros = countedMicros - baselineMicros;
    const reason = line.variance_reason?.trim() || null;
    if (deltaMicros !== 0n && !reason) throw new DomainError('VALIDATION_FAILED', `A reason is required for the variance on ${line.sku_snapshot}.`);
    auditLines.push({ productId: line.product_id, sku: line.sku_snapshot, expected: line.baseline_quantity, counted: line.counted_quantity!, reason });
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
      { account: 'INVENTORY', debit: Number(gainMinor), credit: Number(shrinkMinor) },
      { account: 'INVENTORY_COUNT_GAIN', debit: 0, credit: Number(gainMinor) },
      { account: 'INVENTORY_COUNT_SHRINKAGE', debit: Number(shrinkMinor), credit: 0 },
    ]);
  }
  const posted = await client.query(
    `UPDATE inventory.stock_counts SET status='POSTED',version=version+1,posted_by=$4,posted_at=now()
     WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='OPEN' AND version=$5 RETURNING version::text version`,
    [countId, session.tenantId, session.outletId, session.userId, expectedVersion],
  );
  if (!posted.rowCount) throw new DomainError('VERSION_CONFLICT', 'This stock count changed while posting. Reload it before continuing.', 409);
  const result = { countId, status: 'POSTED', lineCount: lines.rowCount, adjustedLineCount, gainMinor: Number(gainMinor), shrinkMinor: Number(shrinkMinor), totalVarianceMinor: Number(totalVarianceMinor), currency: currencyResult.rows[0].currency, version: Number(posted.rows[0].version) };
  await audit(client, session, envelope.commandId, envelope.type, { ...result, areaLabel: count.rows[0].area_label, lines: auditLines });
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function cancelStockCount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requirePermission(session, 'inventory.count.approve');
  const countId = envelope.payload.countId;
  if (typeof countId !== 'string') throw new DomainError('VALIDATION_FAILED', 'countId is required.');
  const expectedVersion = versionFor(envelope, `count:${countId}`);
  if (!expectedVersion) throw new DomainError('VALIDATION_FAILED', 'Expected count version is required.');
  const count = await client.query<{ status: string; version: string }>(
    'SELECT status,version::text version FROM inventory.stock_counts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 FOR UPDATE',
    [countId, session.tenantId, session.outletId],
  );
  if (!count.rowCount) throw new DomainError('NOT_FOUND', 'Stock count was not found.', 404);
  if (count.rows[0].status !== 'OPEN' || Number(count.rows[0].version) !== expectedVersion) {
    throw new DomainError('VERSION_CONFLICT', 'This stock count changed or is no longer open.', 409, { status: count.rows[0].status, currentVersion: Number(count.rows[0].version) });
  }
  const result = await client.query(
    `UPDATE inventory.stock_counts SET status='CANCELLED',version=version+1,cancelled_by=$4,cancelled_at=now()
     WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='OPEN' AND version=$5 RETURNING version::text version`,
    [countId, session.tenantId, session.outletId, session.userId, expectedVersion],
  );
  if (!result.rowCount) throw new DomainError('VERSION_CONFLICT', 'This stock count changed while it was being cancelled.', 409);
  const value = { countId, status: 'CANCELLED', version: Number(result.rows[0].version) };
  await audit(client, session, envelope.commandId, envelope.type, value);
  await outbox(client, session, envelope.commandId, envelope.type, value);
  return value;
}

async function openShift(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requirePermission(session, 'shift.open');
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
  requirePermission(session, 'shift.payout');
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
  requirePermission(session, 'shift.close');
  const shiftId = envelope.payload.shiftId;
  if (typeof shiftId !== 'string') throw new DomainError('VALIDATION_FAILED', 'shiftId is required.');
  const expected = versionFor(envelope, `shift:${shiftId}`);
  if (!expected) throw new DomainError('VALIDATION_FAILED', 'Expected shift version is required.');
  const counted = asMinor(envelope.payload.countedCashMinor, 'countedCashMinor');
  const shift = await client.query<{
    expected_cash_minor: string; opening_float_minor: string; cash_sales_minor: string;
    customer_collections_minor: string; cash_refunds_minor: string; version: string; opened_at: Date;
  }>(
    `SELECT expected_cash_minor::text,opening_float_minor::text,cash_sales_minor::text,
        customer_collections_minor::text,cash_refunds_minor::text,version::text,opened_at
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
  const identity = await client.query<{ tenant_name: string; outlet_name: string; time_zone: string; operator_name: string; currency: string; business_date: string }>(`SELECT t.name tenant_name,o.name outlet_name,o.time_zone,u.full_name operator_name,t.currency,
      to_char($3::timestamptz AT TIME ZONE o.time_zone,'YYYY-MM-DD') business_date
    FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id JOIN identity.users u ON u.id=$2
    WHERE t.id=$1 AND o.id=$4`, [session.tenantId, session.userId, closedShift.rows[0].closed_at, session.outletId]);
  const snapshot = identity.rows[0];
  if (!snapshot) throw new DomainError('INTERNAL_ERROR', 'Shift close identity snapshot could not be loaded.', 500);
  const reportId = randomUUID();
  await client.query(`INSERT INTO commerce.shift_close_reports(
      id,tenant_id,outlet_id,shift_id,command_id,operator_id,tenant_name_snapshot,outlet_name_snapshot,
      operator_name_snapshot,time_zone_snapshot,business_date,currency,shift_version,opened_at,closed_at,
      opening_float_minor,cash_sales_minor,customer_collections_minor,cash_refunds_minor,
      cash_paid_in_minor,cash_payout_minor,expected_cash_minor,counted_cash_minor,variance_minor)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
  [reportId, session.tenantId, session.outletId, shiftId, envelope.commandId, session.userId,
    snapshot.tenant_name, snapshot.outlet_name, snapshot.operator_name, snapshot.time_zone, snapshot.business_date,
    snapshot.currency, closedShift.rows[0].version, row.opened_at, closedShift.rows[0].closed_at,
    openingFloat.toString(), cashSales.toString(), customerCollections.toString(), cashRefunds.toString(),
    cashPaidIn.toString(), cashPayout.toString(), expectedCashBig.toString(), counted, varianceBig.toString()]);
  if (variance) {
    const tenant = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
    await journal(client, session, envelope.commandId, 'SHIFT_CASH_VARIANCE', tenant.rows[0].currency, variance > 0 ? [
      { account: 'CASH_TILL', debit: variance, credit: 0 }, { account: 'CASH_OVER_SHORT', debit: 0, credit: variance },
    ] : [
      { account: 'CASH_OVER_SHORT', debit: Math.abs(variance), credit: 0 }, { account: 'CASH_TILL', debit: 0, credit: Math.abs(variance) },
    ]);
  }
  const result = { shiftId, closeReportId: reportId, businessDate: snapshot.business_date, version: Number(closedShift.rows[0].version), expectedCashMinor: expectedCashBig.toString(), countedCashMinor: String(counted), varianceMinor: varianceBig.toString() };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function settleSale(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requirePermission(session, 'commerce.sell');
  const lines = envelope.payload.lines;
  const tenders = envelope.payload.tenders;
  const customerIdValue = envelope.payload.customerId;
  const customerId = typeof customerIdValue === 'string' ? customerIdValue : null;
  if (customerIdValue !== undefined && customerId === null) throw new DomainError('VALIDATION_FAILED', 'customerId must be a valid customer account identifier.');
  if (customerId) requirePermission(session, 'customers.charge');
  if (customerId) requireCapability(session, 'commerce');
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) throw new DomainError('VALIDATION_FAILED', 'Sale must contain between 1 and 100 lines.');
  if (!Array.isArray(tenders) || tenders.length > 10 || (!customerId && tenders.length < 1) || (customerId && tenders.length !== 0)) {
    throw new DomainError('VALIDATION_FAILED', customerId ? 'This account-charge checkout must not include cash tender.' : 'Provide between 1 and 10 cash tender allocations.');
  }
  const tenderTotal = tenders.reduce((sum: number, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new DomainError('VALIDATION_FAILED', 'Tender allocation is invalid.');
    const tender = raw as Record<string, unknown>;
    if (tender.method !== 'CASH') throw new DomainError('REQUIRES_ONLINE', 'This API slice confirms cash tender only. Card and mobile-money payment verification are not connected.', 409);
    if (tender.currency !== undefined && tender.currency !== (tenders[0] as Record<string, unknown>).currency) throw new DomainError('VALIDATION_FAILED', 'Tender currencies must match.');
    return sum + asMinor(tender.amountMinor, 'tender.amountMinor');
  }, 0);
  if (!Number.isSafeInteger(tenderTotal) || (customerId ? tenderTotal !== 0 : tenderTotal <= 0)) throw new DomainError('VALIDATION_FAILED', customerId ? 'Account charge cannot include cash tender.' : 'Cash tender total must be a positive safe integer.');

  const normalized = lines.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new DomainError('VALIDATION_FAILED', `Sale line ${index + 1} is invalid.`);
    const line = raw as Record<string, unknown>;
    if (typeof line.productId !== 'string') throw new DomainError('VALIDATION_FAILED', `Sale line ${index + 1} needs a productId.`);
    return { productId: line.productId, quantity: quantityMicros(line.quantity) };
  }).sort((a, b) => a.productId.localeCompare(b.productId));
  const uniqueProductIds = new Set(normalized.map(line => line.productId));
  if (uniqueProductIds.size !== normalized.length) throw new DomainError('VALIDATION_FAILED', 'Combine duplicate item lines before submitting the sale.');

  const shiftId = envelope.payload.shiftId;
  if (typeof shiftId !== 'string') throw new DomainError('VALIDATION_FAILED', 'An open shift is required.');
  const expectedShift = versionFor(envelope, `shift:${shiftId}`);
  if (!expectedShift) throw new DomainError('VALIDATION_FAILED', 'Expected shift version is required.');
  const shift = await client.query<{ version: string }>(`SELECT version FROM commerce.shifts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' FOR UPDATE`, [shiftId, session.tenantId, session.outletId, session.userId]);
  if (!shift.rowCount) throw new DomainError('NOT_FOUND', 'Open shift was not found for this operator.', 404);
  if (Number(shift.rows[0].version) !== expectedShift) throw new DomainError('VERSION_CONFLICT', 'The open shift changed. Refresh and retry using the current version.', 409, { currentVersion: Number(shift.rows[0].version) });

  const tenant = await client.query<{ currency: string; tenant_name: string; outlet_name: string; outlet_time_zone: string; business_profile: unknown; outlet_profile: unknown }>(`SELECT t.currency,t.name tenant_name,o.name outlet_name,o.time_zone outlet_time_zone,t.business_profile,o.outlet_profile
    FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id WHERE t.id=$1 AND o.id=$2`, [session.tenantId, session.outletId]);
  if (!tenant.rowCount) throw new DomainError('NOT_FOUND', 'Tenant outlet is no longer available.', 404);
  const currency = tenant.rows[0].currency;
  const productRows: Array<{ id: string; sku: string; name: string; currency: string; selling_price_minor: string; cost_price_minor: string; tax_rate_bps: number; quantity: string; inventory_value_minor: string }> = [];
  for (const line of normalized) {
    const result = await client.query(
      `SELECT p.id,p.sku,p.name,p.currency,p.selling_price_minor,p.cost_price_minor,p.tax_rate_bps,b.quantity,b.inventory_value_minor::text inventory_value_minor
       FROM catalog.products p JOIN inventory.balances b ON b.tenant_id=p.tenant_id AND b.outlet_id=p.outlet_id AND b.product_id=p.id
       WHERE p.id=$1 AND p.tenant_id=$2 AND p.outlet_id=$3 AND p.active FOR UPDATE OF p,b`,
      [line.productId, session.tenantId, session.outletId],
    );
    if (!result.rowCount) throw new DomainError('NOT_FOUND', 'A sale item is unavailable at this outlet.', 404);
    const product = result.rows[0] as typeof productRows[number];
    if (product.currency !== currency) throw new DomainError('VALIDATION_FAILED', 'Item price currency differs from tenant currency.');
    if (databaseQuantityMicros(product.quantity) < line.quantity) throw new DomainError('INSUFFICIENT_STOCK', `${product.name} does not have enough available stock.`, 409, { productId: product.id });
    productRows.push(product);
  }
  const computed = normalized.map((line, index) => {
    const product = productRows[index];
    const quantityTextValue = quantityText(line.quantity);
    const subtotal = amountForQuantity(Number(product.selling_price_minor), line.quantity);
    const tax = taxFor(subtotal, product.tax_rate_bps);
    const cogsBig = valueForQuantity(BigInt(product.inventory_value_minor), databaseQuantityMicros(product.quantity), line.quantity);
    if (cogsBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', 'Sale COGS exceeds the supported safe money range.');
    const cogs = Number(cogsBig);
    return { ...line, product, quantityText: quantityTextValue, subtotal, tax, cogs };
  });
  const subtotal = computed.reduce((sum, line) => sum + line.subtotal, 0);
  const tax = computed.reduce((sum, line) => sum + line.tax, 0);
  const cogs = computed.reduce((sum, line) => sum + line.cogs, 0);
  const total = subtotal + tax;
  if (![subtotal, tax, cogs, total].every(Number.isSafeInteger) || total < 1) throw new DomainError('VALIDATION_FAILED', 'Sale total is invalid or exceeds the safe integer range.');
  if (!customerId && tenderTotal < total) throw new DomainError('VALIDATION_FAILED', 'Cash tender allocations do not cover the sale total.', 400, { amountDueMinor: total, tenderedMinor: tenderTotal });

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
      customerId ? null : tenderTotal, customerId ? null : tenderTotal - total, customerId, customer?.name ?? null, customerId ? total : 0,
      JSON.stringify(receiptConfigurationSnapshot(tenant.rows[0].business_profile, tenant.rows[0].outlet_profile))],
  );
  for (const line of computed) {
    await client.query(
      `INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,cogs_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13,$14)`,
      [randomUUID(), session.tenantId, session.outletId, orderId, line.product.id, line.product.sku, line.product.name, line.quantityText, Number(line.product.selling_price_minor), Number(line.product.cost_price_minor), line.cogs, line.product.tax_rate_bps, line.subtotal, line.tax],
    );
    const nextInventoryValue = BigInt(line.product.inventory_value_minor) - BigInt(line.cogs);
    await client.query('UPDATE inventory.balances SET quantity=quantity-$4::numeric,inventory_value_minor=$5,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3', [session.tenantId, session.outletId, line.product.id, line.quantityText, checkedBigintMinor(nextInventoryValue, `Inventory value for ${line.product.sku}`)]);
    await client.query(
      `INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id)
       VALUES($1,$2,$3,$4,$5,'SALE',-$6::numeric,$7,$8,$9)`,
      [randomUUID(), session.tenantId, session.outletId, line.product.id, envelope.commandId, line.quantityText, roundedUnitCost(BigInt(line.cogs), line.quantity), line.cogs, orderId],
    );
  }
  let amountRemaining = total;
  for (const raw of tenders) {
    const tender = raw as Record<string, unknown>;
    const amount = asMinor(tender.amountMinor, 'tender.amountMinor');
    if (amount === 0 || amountRemaining === 0) continue;
    if (tender.currency !== currency) throw new DomainError('VALIDATION_FAILED', 'Tender currency must match the tenant currency.');
    await client.query(
      `INSERT INTO commerce.payments(id,tenant_id,outlet_id,order_id,method,amount_minor,currency,status)
       VALUES($1,$2,$3,$4,'CASH',$5,$6,'CONFIRMED')`,
      [randomUUID(), session.tenantId, session.outletId, orderId, Math.min(amount, amountRemaining), currency],
    );
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
  } else {
    await client.query(
      `UPDATE commerce.shifts SET cash_sales_minor=cash_sales_minor+$5,expected_cash_minor=expected_cash_minor+$5,version=version+1
       WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4`,
      [shiftId, session.tenantId, session.outletId, session.userId, total],
    );
  }
  const salesLines = [
    { account: customerId ? 'ACCOUNTS_RECEIVABLE' : 'CASH_TILL', debit: total, credit: 0 },
    { account: 'SALES_REVENUE', debit: 0, credit: subtotal },
    { account: 'VAT_PAYABLE', debit: 0, credit: tax },
  ];
  await journal(client, session, envelope.commandId, 'SALE', currency, salesLines);
  if (cogs > 0) await journal(client, session, envelope.commandId, 'SALE_COGS', currency, [
    { account: 'COST_OF_GOODS_SOLD', debit: cogs, credit: 0 },
    { account: 'INVENTORY', debit: 0, credit: cogs },
  ]);
  const result = { saleId: orderId, receiptId: orderId, receiptNumber, currency, subtotalMinor: subtotal, taxMinor: tax, totalMinor: total, tenderedMinor: tenderTotal, changeMinor: tenderTotal - total, ...(customerId ? { customerId, customerBalanceMinor: customer!.nextBalanceMinor.toString() } : {}), shiftVersion: nextVersion, status: 'CONFIRMED' };
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
  requirePermission(session,'commerce.refund');
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
  const tenantCurrency=await client.query<{currency:string}>('SELECT currency FROM core.tenants WHERE id=$1',[session.tenantId]);
  if(order.rows[0].currency!==tenantCurrency.rows[0].currency)throw new DomainError('VALIDATION_FAILED','Sale currency differs from the active tenant currency.');
  const refundId=randomUUID();let subtotal=0,tax=0,cogs=0,restockedCogs=0,total=0;const normalized=[] as Array<{orderLineId:string;productId:string;quantity:bigint;restock:boolean;subtotal:number;tax:number;cogs:number;unitCost:number}>;
   for(const requestedLine of requested){
    const lineResult=await client.query<{product_id:string;quantity:string;line_subtotal_minor:string;line_tax_minor:string;cost_price_minor:string;cogs_minor:string;sku_snapshot:string}>(`SELECT product_id,quantity,line_subtotal_minor,line_tax_minor,cost_price_minor,cogs_minor,sku_snapshot FROM commerce.order_lines WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND order_id=$4 FOR UPDATE`,[requestedLine.orderLineId,session.tenantId,session.outletId,orderId]);
    if(!lineResult.rowCount)throw new DomainError('NOT_FOUND','A selected item does not belong to this sale.',404);
    const line=lineResult.rows[0];const originalQty=databaseQuantityMicros(line.quantity);
    const prior=await client.query<{quantity:string;subtotal_minor:string;tax_minor:string;cogs_minor:string}>('SELECT COALESCE(SUM(quantity),0)::text quantity,COALESCE(SUM(subtotal_minor),0)::text subtotal_minor,COALESCE(SUM(tax_minor),0)::text tax_minor,COALESCE(SUM(cogs_minor),0)::text cogs_minor FROM commerce.refund_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_line_id=$3',[session.tenantId,session.outletId,requestedLine.orderLineId]);
    const p=prior.rows[0];const priorQty=databaseQuantityMicros(p.quantity);if(priorQty+requestedLine.quantity>originalQty)throw new DomainError('ALREADY_REFUNDED','Requested quantity exceeds the unrefunded amount.',409,{orderLineId:requestedLine.orderLineId,remainingQuantity:quantityText(originalQty-priorQty)});
    const lineSubtotal=refundPortionMinor(Number(line.line_subtotal_minor),Number(p.subtotal_minor),priorQty,requestedLine.quantity,originalQty);
    const lineTax=refundPortionMinor(Number(line.line_tax_minor),Number(p.tax_minor),priorQty,requestedLine.quantity,originalQty);
    const lineCogs=refundPortionMinor(Number(line.cogs_minor),Number(p.cogs_minor),priorQty,requestedLine.quantity,originalQty);
    const unitCost=roundedUnitCost(BigInt(line.cogs_minor),originalQty);subtotal+=lineSubtotal;tax+=lineTax;cogs+=lineCogs;if(requestedLine.restock)restockedCogs+=lineCogs;total+=lineSubtotal+lineTax;
    normalized.push({...requestedLine,productId:line.product_id,subtotal:lineSubtotal,tax:lineTax,cogs:lineCogs,unitCost});
  }
  if(![subtotal,tax,cogs,restockedCogs,total].every(Number.isSafeInteger)||total<1)throw new DomainError('VALIDATION_FAILED','Refund amount is invalid or exceeds the supported safe integer range.');
  const payments=await client.query<{paid_minor:string}>('SELECT COALESCE(SUM(amount_minor),0)::text paid_minor FROM commerce.payments WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 AND method=\'CASH\' AND status=\'CONFIRMED\'',[session.tenantId,session.outletId,orderId]);
  const priorRefunds=await client.query<{total_minor:string}>('SELECT COALESCE(SUM(total_minor),0)::text total_minor FROM commerce.refunds WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3',[session.tenantId,session.outletId,orderId]);
  if(BigInt(priorRefunds.rows[0].total_minor)+BigInt(total)>BigInt(payments.rows[0].paid_minor))throw new DomainError('PAYMENT_NOT_REFUNDABLE','Cash paid does not cover this refund.',409);
  const expectedCash=Number(shift.rows[0].expected_cash_minor);if(!Number.isSafeInteger(expectedCash)||expectedCash<total)throw new DomainError('INSUFFICIENT_CASH','The active till does not have enough expected cash for this refund.',409,{availableMinor:expectedCash,refundMinor:total});
  await client.query(`INSERT INTO commerce.refunds(id,tenant_id,outlet_id,order_id,shift_id,command_id,actor_id,currency,reason,subtotal_minor,tax_minor,total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[refundId,session.tenantId,session.outletId,orderId,shiftId,envelope.commandId,session.userId,tenantCurrency.rows[0].currency,reason.trim(),subtotal,tax,total]);
  for(const line of normalized){
    const qty=quantityText(line.quantity);
    await client.query(`INSERT INTO commerce.refund_lines(id,tenant_id,outlet_id,refund_id,order_id,order_line_id,product_id,quantity,subtotal_minor,tax_minor,cogs_minor,restocked) VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12)`,[randomUUID(),session.tenantId,session.outletId,refundId,orderId,line.orderLineId,line.productId,qty,line.subtotal,line.tax,line.cogs,line.restock]);
    if(line.restock){
       await client.query('UPDATE inventory.balances SET quantity=quantity+$4::numeric,inventory_value_minor=inventory_value_minor+$5,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3',[session.tenantId,session.outletId,line.productId,qty,line.cogs]);
       await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id,document_reference) VALUES($1,$2,$3,$4,$5,'REFUND',$6::numeric,$7,$8,$9,$10)`,[randomUUID(),session.tenantId,session.outletId,line.productId,envelope.commandId,qty,line.unitCost,line.cogs,orderId,`Refund ${refundId}`]);
    }
  }
  await client.query('UPDATE commerce.shifts SET expected_cash_minor=expected_cash_minor-$5,cash_refunds_minor=cash_refunds_minor+$5,version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4',[shiftId,session.tenantId,session.outletId,session.userId,total]);
  const allReturned=await client.query<{all_refunded:boolean}>(`SELECT NOT EXISTS(SELECT 1 FROM commerce.order_lines ol WHERE ol.tenant_id=$1 AND ol.outlet_id=$2 AND ol.order_id=$3 AND ol.quantity>COALESCE((SELECT SUM(rl.quantity) FROM commerce.refund_lines rl WHERE rl.tenant_id=ol.tenant_id AND rl.outlet_id=ol.outlet_id AND rl.order_line_id=ol.id),0)) all_refunded`,[session.tenantId,session.outletId,orderId]);
  await client.query('UPDATE commerce.orders SET status=$4 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3',[orderId,session.tenantId,session.outletId,allReturned.rows[0].all_refunded?'REFUNDED':'PARTIALLY_REFUNDED']);
  await journal(client,session,envelope.commandId,'SALE_REFUND',tenantCurrency.rows[0].currency,[{account:'SALES_REVENUE',debit:subtotal,credit:0},{account:'VAT_PAYABLE',debit:tax,credit:0},{account:'CASH_TILL',debit:0,credit:total}]);
  if(restockedCogs>0)await journal(client,session,envelope.commandId,'SALE_REFUND_COGS',tenantCurrency.rows[0].currency,[{account:'INVENTORY',debit:restockedCogs,credit:0},{account:'COST_OF_GOODS_SOLD',debit:0,credit:restockedCogs}]);
  const result={refundId,orderId,totalMinor:total,subtotalMinor:subtotal,taxMinor:tax,currency:tenantCurrency.rows[0].currency,reason:reason.trim(),status:allReturned.rows[0].all_refunded?'REFUNDED':'PARTIALLY_REFUNDED',shiftVersion:expectedShift+1};
  await audit(client,session,envelope.commandId,envelope.type,result);await outbox(client,session,envelope.commandId,envelope.type,result);return result;
}

async function createHotelRoom(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  requireCapability(session,'hospitality');requirePermission(session,'hotel.manage');
  const roomNumber=envelope.payload.roomNumber;const roomType=envelope.payload.roomType;const rate=asMinor(envelope.payload.nightlyRateMinor,'nightlyRateMinor');const taxRateBps=envelope.payload.taxRateBps;
  if(typeof roomNumber!=='string'||!roomNumber.trim()||roomNumber.trim().length>24||typeof roomType!=='string'||!roomType.trim()||roomType.trim().length>80||rate===0)throw new DomainError('VALIDATION_FAILED','Room number, room type, and a positive nightly rate are required.');
  if(typeof taxRateBps!=='number'||!Number.isInteger(taxRateBps)||taxRateBps<0||taxRateBps>10_000)throw new DomainError('VALIDATION_FAILED','Room tax rate must be from 0 through 10000 basis points.');
  const tenant=await client.query<{currency:string}>('SELECT currency FROM core.tenants WHERE id=$1',[session.tenantId]);const roomId=randomUUID();
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
  requireCapability(session,'hospitality');requirePermission(session,'hotel.frontdesk');
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
  requireCapability(session,'hospitality');requirePermission(session,'hotel.frontdesk');const reservationId=envelope.payload.reservationId;
  if(typeof reservationId!=='string')throw new DomainError('VALIDATION_FAILED','reservationId is required.');const expected=versionFor(envelope,`reservation:${reservationId}`);if(!expected)throw new DomainError('VALIDATION_FAILED','Expected reservation version is required.');
  const result=await client.query<{version:string;room_id:string}>(`UPDATE hospitality.reservations SET status='CANCELLED',version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='CONFIRMED' AND version=$4 RETURNING version,room_id`,[reservationId,session.tenantId,session.outletId,expected]);
  if(!result.rowCount)throw new DomainError('VERSION_CONFLICT','Reservation was changed, cancelled, or checked in already.',409);
  const room=await client.query<{version:string}>(`UPDATE hospitality.rooms SET version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 RETURNING version`,[result.rows[0].room_id,session.tenantId,session.outletId]);
  const value={reservationId,status:'CANCELLED',version:Number(result.rows[0].version),roomVersion:Number(room.rows[0].version)};await audit(client,session,envelope.commandId,envelope.type,value);await outbox(client,session,envelope.commandId,envelope.type,value);return value;
}

async function checkInGuest(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  requireCapability(session,'hospitality');requirePermission(session,'hotel.frontdesk');
  const reservationId=envelope.payload.reservationId;let roomId=envelope.payload.roomId;let guestName=envelope.payload.guestName;let guestContact=envelope.payload.guestContact;let checkIn='';let checkOut='';
  if(typeof reservationId==='string'){
    const reservation=await client.query<{room_id:string;guest_name:string;guest_contact:string|null;check_in_date:string;check_out_date:string;nightly_rate_minor:string;tax_rate_bps:number;currency:string;version:string}>(`SELECT room_id,guest_name,guest_contact,check_in_date,check_out_date,nightly_rate_minor,tax_rate_bps,currency,version FROM hospitality.reservations WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND status='CONFIRMED' FOR UPDATE`,[reservationId,session.tenantId,session.outletId]);
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
  requireCapability(session,'hospitality');requirePermission(session,'hotel.frontdesk');
  const stayId=envelope.payload.stayId;const tendered=asMinor(envelope.payload.tenderedMinor,'tenderedMinor');if(typeof stayId!=='string')throw new DomainError('VALIDATION_FAILED','stayId is required.');const expectedStay=versionFor(envelope,`stay:${stayId}`);if(!expectedStay)throw new DomainError('VALIDATION_FAILED','Expected stay version is required.');
  const stay=await client.query<{room_id:string;folio_id:string;guest_name:string;check_in_date:string;expected_check_out_date:string;local_today:string;nightly_rate_minor:string;tax_rate_bps:number;currency:string;version:string;nights:number}>(`SELECT s.room_id,f.id folio_id,s.guest_name,s.check_in_date,s.expected_check_out_date,to_char(now() AT TIME ZONE o.time_zone,'YYYY-MM-DD') local_today,s.nightly_rate_minor,s.tax_rate_bps,s.currency,s.version,(s.expected_check_out_date-s.check_in_date)::int nights FROM hospitality.stays s JOIN hospitality.folios f ON f.stay_id=s.id AND f.tenant_id=s.tenant_id AND f.outlet_id=s.outlet_id JOIN core.outlets o ON o.id=s.outlet_id AND o.tenant_id=s.tenant_id WHERE s.id=$1 AND s.tenant_id=$2 AND s.outlet_id=$3 AND s.status='CHECKED_IN' FOR UPDATE OF s,f`,[stayId,session.tenantId,session.outletId]);
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
  requireCapability(session,'hospitality');requirePermission(session,'hotel.housekeeping');const roomId=envelope.payload.roomId;if(typeof roomId!=='string')throw new DomainError('VALIDATION_FAILED','roomId is required.');const expected=versionFor(envelope,`room:${roomId}`);if(!expected)throw new DomainError('VALIDATION_FAILED','Expected room version is required.');const room=await roomForUpdate(client,session,roomId);if(room.status!=='DIRTY'||Number(room.version)!==expected)throw new DomainError('VERSION_CONFLICT','Only a dirty room at its current version can be marked ready.',409,{roomStatus:room.status,currentVersion:Number(room.version)});await client.query(`UPDATE hospitality.rooms SET status='READY',version=version+1 WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND version=$4`,[roomId,session.tenantId,session.outletId,expected]);await client.query(`INSERT INTO hospitality.housekeeping_events(id,tenant_id,outlet_id,room_id,command_id,actor_id,from_status,to_status) VALUES($1,$2,$3,$4,$5,$6,'DIRTY','READY')`,[randomUUID(),session.tenantId,session.outletId,roomId,envelope.commandId,session.userId]);const value={roomId,status:'READY',version:expected+1};await audit(client,session,envelope.commandId,envelope.type,value);await outbox(client,session,envelope.commandId,envelope.type,value);return value;
}

export function hashCommand(envelope: CommandEnvelope): Buffer {
  return createHash('sha256').update(stableStringify(envelope)).digest();
}
