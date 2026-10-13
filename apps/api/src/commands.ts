import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ApiPermission, ApiSession, CommandEnvelope } from './contracts.js';
import { DomainError, ROLE_PERMISSIONS } from './contracts.js';
import { stableStringify } from './security.js';

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
function asMinor(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new DomainError('VALIDATION_FAILED', `${field} must be a non-negative safe integer in minor units.`);
  return value;
}
function amountForQuantity(unitMinor: number, micros: bigint): number {
  const amount = (BigInt(unitMinor) * micros + quantityScale / 2n) / quantityScale;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('VALIDATION_FAILED', 'Line amount exceeds the supported safe integer range.');
  return Number(amount);
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
    case 'catalog.product.create': return createProduct(client, session, envelope);
    case 'inventory.receive': return receiveInventory(client, session, envelope);
    case 'shift.open': return openShift(client, session, envelope);
    case 'shift.close': return closeShift(client, session, envelope);
    case 'sales.order.settle': return settleSale(client, session, envelope);
    case 'sales.order.refund': return refundSale(client, session, envelope);
    case 'hotel.room.create': return createHotelRoom(client,session,envelope);
    case 'hotel.reservation.create': return createReservation(client,session,envelope);
    case 'hotel.reservation.cancel': return cancelReservation(client,session,envelope);
    case 'hotel.checkin': return checkInGuest(client,session,envelope);
    case 'hotel.checkout': return checkOutGuest(client,session,envelope);
    case 'hotel.room.mark_ready': return markRoomReady(client,session,envelope);
    default: throw new DomainError('VALIDATION_FAILED', `Unsupported command type: ${envelope.type}`);
  }
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
    await client.query('UPDATE inventory.balances SET quantity=quantity+$4::numeric, version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3', [session.tenantId, session.outletId, line.productId, quantityText(line.quantity)]);
    await client.query(
      `INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,document_reference)
       VALUES($1,$2,$3,$4,$5,'RECEIPT',$6::numeric,$7,$8)`,
      [randomUUID(), session.tenantId, session.outletId, line.productId, envelope.commandId, quantityText(line.quantity), line.unitCost, typeof documentReference==='string'?documentReference.trim()||null:null],
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

async function closeShift(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requirePermission(session, 'shift.close');
  const shiftId = envelope.payload.shiftId;
  if (typeof shiftId !== 'string') throw new DomainError('VALIDATION_FAILED', 'shiftId is required.');
  const expected = versionFor(envelope, `shift:${shiftId}`);
  if (!expected) throw new DomainError('VALIDATION_FAILED', 'Expected shift version is required.');
  const counted = asMinor(envelope.payload.countedCashMinor, 'countedCashMinor');
  const shift = await client.query<{ expected_cash_minor: string; version: string }>(
    `SELECT expected_cash_minor,version FROM commerce.shifts WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4 AND status='OPEN' FOR UPDATE`,
    [shiftId, session.tenantId, session.outletId, session.userId],
  );
  if (!shift.rowCount) throw new DomainError('NOT_FOUND', 'Open shift was not found for this operator.', 404);
  const row = shift.rows[0];
  if (Number(row.version) !== expected) throw new DomainError('VERSION_CONFLICT', 'This shift changed. Reload its current cash-up before closing.', 409, { currentVersion: Number(row.version) });
  const expectedCash = Number(row.expected_cash_minor);
  const variance = counted - expectedCash;
  await client.query(
    `UPDATE commerce.shifts SET status='CLOSED',counted_cash_minor=$5,variance_minor=$6,closed_at=now(),version=version+1
     WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4`,
    [shiftId, session.tenantId, session.outletId, session.userId, counted, variance],
  );
  if (variance) {
    const tenant = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
    await journal(client, session, envelope.commandId, 'SHIFT_CASH_VARIANCE', tenant.rows[0].currency, variance > 0 ? [
      { account: 'CASH_TILL', debit: variance, credit: 0 }, { account: 'CASH_OVER_SHORT', debit: 0, credit: variance },
    ] : [
      { account: 'CASH_OVER_SHORT', debit: Math.abs(variance), credit: 0 }, { account: 'CASH_TILL', debit: 0, credit: Math.abs(variance) },
    ]);
  }
  const result = { shiftId, version: expected + 1, expectedCashMinor: expectedCash, countedCashMinor: counted, varianceMinor: variance };
  await audit(client, session, envelope.commandId, envelope.type, result);
  await outbox(client, session, envelope.commandId, envelope.type, result);
  return result;
}

async function settleSale(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requirePermission(session, 'commerce.sell');
  const lines = envelope.payload.lines;
  const tenders = envelope.payload.tenders;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) throw new DomainError('VALIDATION_FAILED', 'Sale must contain between 1 and 100 lines.');
  if (!Array.isArray(tenders) || tenders.length < 1 || tenders.length > 10) throw new DomainError('VALIDATION_FAILED', 'Provide between 1 and 10 tender allocations.');
  const tenderTotal = tenders.reduce((sum: number, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new DomainError('VALIDATION_FAILED', 'Tender allocation is invalid.');
    const tender = raw as Record<string, unknown>;
    if (tender.method !== 'CASH') throw new DomainError('REQUIRES_ONLINE', 'This API slice confirms cash tender only. Card and mobile-money payment verification are not connected.', 409);
    if (tender.currency !== undefined && tender.currency !== (tenders[0] as Record<string, unknown>).currency) throw new DomainError('VALIDATION_FAILED', 'Tender currencies must match.');
    return sum + asMinor(tender.amountMinor, 'tender.amountMinor');
  }, 0);
  if (!Number.isSafeInteger(tenderTotal) || tenderTotal <= 0) throw new DomainError('VALIDATION_FAILED', 'Cash tender total must be a positive safe integer.');

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

  const tenant = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
  const currency = tenant.rows[0].currency;
  const productRows: Array<{ id: string; sku: string; name: string; currency: string; selling_price_minor: string; cost_price_minor: string; tax_rate_bps: number; quantity: string }> = [];
  for (const line of normalized) {
    const result = await client.query(
      `SELECT p.id,p.sku,p.name,p.currency,p.selling_price_minor,p.cost_price_minor,p.tax_rate_bps,b.quantity
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
    const cogs = amountForQuantity(Number(product.cost_price_minor), line.quantity);
    return { ...line, product, quantityText: quantityTextValue, subtotal, tax, cogs };
  });
  const subtotal = computed.reduce((sum, line) => sum + line.subtotal, 0);
  const tax = computed.reduce((sum, line) => sum + line.tax, 0);
  const cogs = computed.reduce((sum, line) => sum + line.cogs, 0);
  const total = subtotal + tax;
  if (![subtotal, tax, cogs, total].every(Number.isSafeInteger) || total < 1) throw new DomainError('VALIDATION_FAILED', 'Sale total is invalid or exceeds the safe integer range.');
  if (tenderTotal < total) throw new DomainError('VALIDATION_FAILED', 'Cash tender allocations do not cover the sale total.', 400, { amountDueMinor: total, tenderedMinor: tenderTotal });

  const orderId = randomUUID();
  await client.query(
    `INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CONFIRMED')`,
    [orderId, session.tenantId, session.outletId, shiftId, session.userId, currency, subtotal, tax, total],
  );
  for (const line of computed) {
    await client.query(
      `INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13)`,
      [randomUUID(), session.tenantId, session.outletId, orderId, line.product.id, line.product.sku, line.product.name, line.quantityText, Number(line.product.selling_price_minor), Number(line.product.cost_price_minor), line.product.tax_rate_bps, line.subtotal, line.tax],
    );
    await client.query('UPDATE inventory.balances SET quantity=quantity-$4::numeric,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3', [session.tenantId, session.outletId, line.product.id, line.quantityText]);
    await client.query(
      `INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,reference_id)
       VALUES($1,$2,$3,$4,$5,'SALE',-$6::numeric,$7,$8)`,
      [randomUUID(), session.tenantId, session.outletId, line.product.id, envelope.commandId, line.quantityText, Number(line.product.cost_price_minor), orderId],
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
  await client.query(
    `UPDATE commerce.shifts SET cash_sales_minor=cash_sales_minor+$5,expected_cash_minor=expected_cash_minor+$5,version=version+1
     WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND operator_id=$4`,
    [shiftId, session.tenantId, session.outletId, session.userId, total],
  );
  const salesLines = [
    { account: 'CASH_TILL', debit: total, credit: 0 },
    { account: 'SALES_REVENUE', debit: 0, credit: subtotal },
    { account: 'VAT_PAYABLE', debit: 0, credit: tax },
  ];
  await journal(client, session, envelope.commandId, 'SALE', currency, salesLines);
  if (cogs > 0) await journal(client, session, envelope.commandId, 'SALE_COGS', currency, [
    { account: 'COST_OF_GOODS_SOLD', debit: cogs, credit: 0 },
    { account: 'INVENTORY', debit: 0, credit: cogs },
  ]);
  const result = { saleId: orderId, receiptId: orderId, currency, subtotalMinor: subtotal, taxMinor: tax, totalMinor: total, tenderedMinor: tenderTotal, changeMinor: tenderTotal - total, shiftVersion: nextVersion, status: 'CONFIRMED' };
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
  const order=await client.query<{currency:string;status:string;subtotal_minor:string;tax_minor:string;total_minor:string}>(`SELECT currency,status,subtotal_minor,total_minor FROM commerce.orders WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 FOR UPDATE`,[orderId,session.tenantId,session.outletId]);
  if(!order.rowCount)throw new DomainError('NOT_FOUND','Sale was not found at this outlet.',404);
  const tenantCurrency=await client.query<{currency:string}>('SELECT currency FROM core.tenants WHERE id=$1',[session.tenantId]);
  if(order.rows[0].currency!==tenantCurrency.rows[0].currency)throw new DomainError('VALIDATION_FAILED','Sale currency differs from the active tenant currency.');
  const refundId=randomUUID();let subtotal=0,tax=0,cogs=0,restockedCogs=0,total=0;const normalized=[] as Array<{orderLineId:string;productId:string;quantity:bigint;restock:boolean;subtotal:number;tax:number;cogs:number;unitCost:number}>;
  for(const requestedLine of requested){
    const lineResult=await client.query<{product_id:string;quantity:string;line_subtotal_minor:string;line_tax_minor:string;cost_price_minor:string;sku_snapshot:string}>(`SELECT product_id,quantity,line_subtotal_minor,line_tax_minor,cost_price_minor,sku_snapshot FROM commerce.order_lines WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND order_id=$4 FOR UPDATE`,[requestedLine.orderLineId,session.tenantId,session.outletId,orderId]);
    if(!lineResult.rowCount)throw new DomainError('NOT_FOUND','A selected item does not belong to this sale.',404);
    const line=lineResult.rows[0];const originalQty=databaseQuantityMicros(line.quantity);
    const prior=await client.query<{quantity:string;subtotal_minor:string;tax_minor:string;cogs_minor:string}>('SELECT COALESCE(SUM(quantity),0)::text quantity,COALESCE(SUM(subtotal_minor),0)::text subtotal_minor,COALESCE(SUM(tax_minor),0)::text tax_minor,COALESCE(SUM(cogs_minor),0)::text cogs_minor FROM commerce.refund_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_line_id=$3',[session.tenantId,session.outletId,requestedLine.orderLineId]);
    const p=prior.rows[0];const priorQty=databaseQuantityMicros(p.quantity);if(priorQty+requestedLine.quantity>originalQty)throw new DomainError('ALREADY_REFUNDED','Requested quantity exceeds the unrefunded amount.',409,{orderLineId:requestedLine.orderLineId,remainingQuantity:quantityText(originalQty-priorQty)});
    const lineSubtotal=refundPortionMinor(Number(line.line_subtotal_minor),Number(p.subtotal_minor),priorQty,requestedLine.quantity,originalQty);
    const lineTax=refundPortionMinor(Number(line.line_tax_minor),Number(p.tax_minor),priorQty,requestedLine.quantity,originalQty);
    const lineCogs=refundPortionMinor(amountForQuantity(Number(line.cost_price_minor),originalQty),Number(p.cogs_minor),priorQty,requestedLine.quantity,originalQty);
    const unitCost=Number(line.cost_price_minor);subtotal+=lineSubtotal;tax+=lineTax;cogs+=lineCogs;if(requestedLine.restock)restockedCogs+=lineCogs;total+=lineSubtotal+lineTax;
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
      await client.query('UPDATE inventory.balances SET quantity=quantity+$4::numeric,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3',[session.tenantId,session.outletId,line.productId,qty]);
      await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,reference_id,document_reference) VALUES($1,$2,$3,$4,$5,'REFUND',$6::numeric,$7,$8,$9)`,[randomUUID(),session.tenantId,session.outletId,line.productId,envelope.commandId,qty,line.unitCost,orderId,`Refund ${refundId}`]);
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

export function hashCommand(envelope: CommandEnvelope): Buffer {
  return createHash('sha256').update(stableStringify(envelope)).digest();
}
