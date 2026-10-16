import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import type { ApiSession, CommandEnvelope } from './contracts.js';
import { DomainError, ROLE_PERMISSIONS } from './contracts.js';
import { requireCommandAuthority } from './commandAuthorization.js';

export const SUPPORTED_CAPABILITIES = ['commerce', 'inventory', 'hospitality', 'retail'] as const;
export interface TaxPolicy { calculation: 'exclusive'; defaultRateBps: number; label: string; reviewed: boolean }
export interface BusinessProfile {
  legalName: string; registrationNumber: string; taxRegistrationNumber: string;
  address: string; phone: string; email: string; website: string; logoUrl: string; receiptQrImage: string; showQrOnReceipt: boolean;
  receiptHeader: string; receiptFooter: string; taxPolicy: TaxPolicy;
}
export interface OutletProfile { address: string; phone: string; email: string; receiptHeader: string; receiptFooter: string }
export interface BusinessConfiguration extends BusinessProfile { id: string; name: string; currency: string; timeZone: string; version: number }
export interface OutletConfiguration extends OutletProfile { id: string; name: string; timeZone: string; version: number }
export interface BusinessUpdateInput extends BusinessProfile { name: string; currency: string; timeZone: string }
export interface OutletUpdateInput extends OutletProfile { name: string; timeZone: string }
export interface CapabilitiesUpdateInput { capabilities: Array<typeof SUPPORTED_CAPABILITIES[number]> }
export type ConfigurationUpdateOutcome = { tenantId: string; version: number; capabilities?: string[] } | { outletId: string; version: number };
export interface ConfigurationRead {
  business: BusinessConfiguration; outlet: OutletConfiguration; capabilities: string[];
  supportedCapabilities: typeof SUPPORTED_CAPABILITIES; currencyLocked: boolean;
  readiness: { readyForFirstSale: boolean; checks: Array<{ key: string; label: string; complete: boolean; detail: string }> };
}

const businessDefaults: BusinessProfile = {
  legalName: '', registrationNumber: '', taxRegistrationNumber: '', address: '', phone: '', email: '', website: '', logoUrl: '', receiptQrImage: '', showQrOnReceipt: true, receiptHeader: '', receiptFooter: '',
  taxPolicy: { calculation: 'exclusive', defaultRateBps: 0, label: 'Tax', reviewed: false },
};
const outletDefaults: OutletProfile = { address: '', phone: '', email: '', receiptHeader: '', receiptFooter: '' };
export function readTaxPolicy(value: unknown): TaxPolicy {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<TaxPolicy> : {};
  return { ...businessDefaults.taxPolicy, ...candidate };
}
export function readBusinessProfile(value: unknown): BusinessProfile {
  const profile = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<BusinessProfile> : {};
  return { ...businessDefaults, ...profile, taxPolicy: readTaxPolicy(profile.taxPolicy) };
}
export function readOutletProfile(value: unknown): OutletProfile {
  return { ...outletDefaults, ...(value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<OutletProfile> : {}) };
}
function requireConfigurationAccess(session: ApiSession, write = false) {
  if (!ROLE_PERMISSIONS[session.role].includes(write ? 'config.manage' : 'config.view')) throw new DomainError('FORBIDDEN', 'Your role cannot access this business configuration operation.', 403);
}
function text(value: unknown, field: string, max: number, required = false, multiline = false): string {
  if (typeof value !== 'string') throw new DomainError('VALIDATION_FAILED', `${field} must be text.`);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(normalized)) throw new DomainError('VALIDATION_FAILED', `${field} ${required ? 'is required and ' : ''}must be ${max} characters or fewer without unsupported control characters.`);
  return normalized;
}
function email(value: unknown, field: string) {
  const normalized = text(value, field, 254).toLowerCase();
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new DomainError('VALIDATION_FAILED', `${field} must be a valid email address.`);
  return normalized;
}
function phone(value: unknown) {
  const normalized = text(value, 'phone', 40);
  if (normalized && (!/[0-9]/.test(normalized) || !/^[+0-9() .-]+$/.test(normalized))) throw new DomainError('VALIDATION_FAILED', 'phone must contain a phone number.');
  return normalized;
}
function url(value: unknown, field: string, httpsOnly = false) {
  const normalized = text(value, field, 2048);
  if (!normalized) return '';
  try { const parsed = new URL(normalized); if (!(httpsOnly ? ['https:'] : ['http:', 'https:']).includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
  catch { throw new DomainError('VALIDATION_FAILED', `${field} must be an ${httpsOnly ? 'HTTPS' : 'HTTP or HTTPS'} address without credentials.`); }
  return normalized;
}
const MAX_RECEIPT_IMAGE_BYTES = 512 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function uploadedPng(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new DomainError('VALIDATION_FAILED', `${field} must be a PNG image.`);
  const normalized = value.trim();
  if (!normalized) return '';
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(normalized);
  if (!match || normalized.length > Math.ceil(MAX_RECEIPT_IMAGE_BYTES * 4 / 3) + 32) throw new DomainError('VALIDATION_FAILED', `${field} must be a PNG image up to 512 KB.`);
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_IMAGE_BYTES || bytes.toString('base64') !== match[1] || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new DomainError('VALIDATION_FAILED', `${field} must contain a valid PNG image up to 512 KB.`);
  }
  return normalized;
}
function logoImage(value: unknown): string {
  if (typeof value === 'string' && value.trim().startsWith('data:')) return uploadedPng(value, 'logoUrl');
  return url(value, 'logoUrl', true);
}
export function validateTimeZone(value: unknown): string {
  const timeZone = text(value, 'timeZone', 100, true);
  if (!timeZone.includes('/') && timeZone !== 'UTC') throw new DomainError('VALIDATION_FAILED', 'timeZone must be an IANA time zone, such as Africa/Nairobi.');
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); }
  catch { throw new DomainError('VALIDATION_FAILED', 'timeZone must be a supported IANA time zone.'); }
  return timeZone;
}
export function validateBusinessInput(payload: Record<string, unknown>) {
  const name = text(payload.name, 'name', 160, true);
  const currency = text(payload.currency, 'currency', 3, true);
  if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf('currency').includes(currency)) throw new DomainError('VALIDATION_FAILED', 'currency must be a supported ISO currency code.');
  const timeZone = validateTimeZone(payload.timeZone);
  const rawPolicy = payload.taxPolicy;
  if (!rawPolicy || typeof rawPolicy !== 'object' || Array.isArray(rawPolicy)) throw new DomainError('VALIDATION_FAILED', 'taxPolicy is required.');
  const policy = rawPolicy as Record<string, unknown>;
  if (policy.calculation !== 'exclusive') throw new DomainError('VALIDATION_FAILED', 'This release supports tax added to item prices (exclusive) only.');
  if (typeof policy.defaultRateBps !== 'number' || !Number.isInteger(policy.defaultRateBps) || policy.defaultRateBps < 0 || policy.defaultRateBps > 10000) throw new DomainError('VALIDATION_FAILED', 'taxPolicy.defaultRateBps must be an integer from 0 to 10000.');
  if (typeof policy.reviewed !== 'boolean') throw new DomainError('VALIDATION_FAILED', 'taxPolicy.reviewed must be a boolean.');
  const profile: BusinessProfile = {
    legalName: text(payload.legalName, 'legalName', 160), registrationNumber: text(payload.registrationNumber, 'registrationNumber', 80), taxRegistrationNumber: text(payload.taxRegistrationNumber, 'taxRegistrationNumber', 80),
    address: text(payload.address, 'address', 500, false, true), phone: phone(payload.phone), email: email(payload.email, 'email'), website: url(payload.website, 'website'), logoUrl: logoImage(payload.logoUrl),
    receiptQrImage: uploadedPng(payload.receiptQrImage, 'receiptQrImage'),
    showQrOnReceipt: payload.showQrOnReceipt === undefined ? true : typeof payload.showQrOnReceipt === 'boolean' ? payload.showQrOnReceipt : (() => { throw new DomainError('VALIDATION_FAILED', 'showQrOnReceipt must be a boolean.'); })(),
    receiptHeader: text(payload.receiptHeader, 'receiptHeader', 500, false, true), receiptFooter: text(payload.receiptFooter, 'receiptFooter', 500, false, true),
    taxPolicy: { calculation: 'exclusive', defaultRateBps: policy.defaultRateBps, label: text(policy.label, 'taxPolicy.label', 40, true), reviewed: policy.reviewed },
  };
  return { name, currency, timeZone, profile };
}
export function validateOutletInput(payload: Record<string, unknown>) {
  const profile: OutletProfile = { address: text(payload.address, 'address', 500, false, true), phone: phone(payload.phone), email: email(payload.email, 'email'), receiptHeader: text(payload.receiptHeader, 'receiptHeader', 500, false, true), receiptFooter: text(payload.receiptFooter, 'receiptFooter', 500, false, true) };
  return { name: text(payload.name, 'name', 160, true), timeZone: validateTimeZone(payload.timeZone), profile };
}
export function validateCapabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !(SUPPORTED_CAPABILITIES as readonly string[]).includes(item)) || new Set(value).size !== value.length) throw new DomainError('VALIDATION_FAILED', 'capabilities must contain unique supported capability names. Restaurant service is not connected.');
  if (value.includes('commerce') && !value.includes('inventory')) throw new DomainError('VALIDATION_FAILED', 'Commerce requires inventory.');
  if (value.includes('retail') && !value.includes('commerce')) throw new DomainError('VALIDATION_FAILED', 'Retail requires commerce and inventory.');
  if (value.includes('hospitality') && !value.includes('commerce')) throw new DomainError('VALIDATION_FAILED', 'Hospitality checkout requires commerce.');
  return [...value].sort();
}
async function currencyLocked(client: PoolClient, tenantId: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(`SELECT EXISTS(SELECT 1 FROM catalog.products WHERE tenant_id=$1)
    OR EXISTS(SELECT 1 FROM hospitality.rooms WHERE tenant_id=$1)
    OR EXISTS(SELECT 1 FROM commerce.shifts WHERE tenant_id=$1)
    OR EXISTS(SELECT 1 FROM finance.customer_accounts WHERE tenant_id=$1)
    OR EXISTS(SELECT 1 FROM finance.journal_entries WHERE tenant_id=$1) locked`, [tenantId]);
  return result.rows[0].locked;
}
export async function getConfiguration(session: ApiSession): Promise<{ configuration: ConfigurationRead }> {
  requireConfigurationAccess(session);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await client.query(`SELECT t.id tenant_id,t.name tenant_name,t.currency,t.time_zone tenant_time_zone,t.version tenant_version,t.business_profile,
      o.id outlet_id,o.name outlet_name,o.time_zone outlet_time_zone,o.version outlet_version,o.outlet_profile
      FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id WHERE t.id=$1 AND o.id=$2`, [session.tenantId, session.outletId]);
    if (!result.rowCount) throw new DomainError('NOT_FOUND', 'Business outlet was not found.', 404);
    const row = result.rows[0];
    const business: BusinessConfiguration = { id: row.tenant_id, name: row.tenant_name, currency: row.currency, timeZone: row.tenant_time_zone, version: Number(row.tenant_version), ...readBusinessProfile(row.business_profile) };
    const outlet: OutletConfiguration = { id: row.outlet_id, name: row.outlet_name, timeZone: row.outlet_time_zone, version: Number(row.outlet_version), ...readOutletProfile(row.outlet_profile) };
    const capabilitiesResult = await client.query<{ capability: string }>('SELECT capability FROM core.tenant_capabilities WHERE tenant_id=$1 ORDER BY capability', [session.tenantId]);
    const capabilities = capabilitiesResult.rows.map(item => item.capability);
    const counts = await client.query<{ products: number; stocked: number; staff: number; devices: number }>(`SELECT
      (SELECT count(*)::int FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND active) products,
      (SELECT count(*)::int FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND quantity>0) stocked,
      (SELECT count(*)::int FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.active AND u.active) staff,
      (SELECT count(*)::int FROM identity.devices WHERE tenant_id=$1 AND outlet_id=$2 AND active) devices`, [session.tenantId, session.outletId]);
    const totals = counts.rows[0];
    const checks = [
      { key: 'business', label: 'Business identity', complete: !!business.name && !!business.currency && !!business.timeZone, detail: `${business.name} · ${business.currency} · ${business.timeZone}` },
      { key: 'outlet', label: 'Outlet identity', complete: !!outlet.name && !!outlet.timeZone, detail: `${outlet.name} · ${outlet.timeZone}` },
      { key: 'tax', label: 'Tax policy reviewed', complete: business.taxPolicy.reviewed, detail: 'The default rate applies to new item setup; posted lines retain their tax snapshots.' },
      { key: 'commerce', label: 'Selling capability enabled', complete: capabilities.includes('commerce') && capabilities.includes('inventory'), detail: 'Cash checkout needs commerce and inventory.' },
      { key: 'catalog', label: 'Items available', complete: totals.products > 0, detail: `${totals.products} active catalogue items` },
      { key: 'stock', label: 'Stock received', complete: totals.stocked > 0, detail: `${totals.stocked} items with stock available` },
      { key: 'staff', label: 'Active operator and device', complete: totals.staff > 0 && totals.devices > 0, detail: `${totals.staff} active staff · ${totals.devices} active outlet devices` },
    ];
    const configuration: ConfigurationRead = { business, outlet, capabilities, supportedCapabilities: SUPPORTED_CAPABILITIES, currencyLocked: await currencyLocked(client, session.tenantId), readiness: { readyForFirstSale: checks.every(check => check.complete), checks } };
    await client.query('COMMIT');
    return { configuration };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function expectedVersion(envelope: CommandEnvelope, key: string): number {
  const version = envelope.expectedVersions[key];
  if (!Number.isSafeInteger(version) || version < 1) throw new DomainError('VALIDATION_FAILED', `Expected version ${key} is required.`);
  return version;
}
async function recordEvidence(client: PoolClient, session: ApiSession, envelope: CommandEnvelope, before: unknown, after: unknown) {
  const evidence = JSON.stringify({ before, after });
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)', [randomUUID(), session.tenantId, session.outletId, session.userId, envelope.commandId, envelope.type, evidence]);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)', [randomUUID(), session.tenantId, envelope.commandId, envelope.type, evidence]);
}
export async function executeConfigurationCommand(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requireCommandAuthority(session,envelope.type);
  if (envelope.type === 'configuration.outlet.update') {
    const expected = expectedVersion(envelope, `outlet:${session.outletId}`);
    const input = validateOutletInput(envelope.payload);
    const current = await client.query('SELECT name,time_zone,version,outlet_profile FROM core.outlets WHERE tenant_id=$1 AND id=$2 AND active FOR UPDATE', [session.tenantId, session.outletId]);
    if (!current.rowCount) throw new DomainError('NOT_FOUND', 'Current outlet was not found.', 404);
    if (Number(current.rows[0].version) !== expected) throw new DomainError('VERSION_CONFLICT', 'Outlet configuration changed. Review current settings before saving.', 409, { currentVersion: Number(current.rows[0].version) });
    const result = await client.query('UPDATE core.outlets SET name=$3,time_zone=$4,outlet_profile=$5::jsonb,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING version', [session.tenantId, session.outletId, input.name, input.timeZone, JSON.stringify(input.profile)]);
    const value = { outletId: session.outletId, version: Number(result.rows[0].version) };
    await recordEvidence(client, session, envelope, current.rows[0], { ...input, ...value });
    return value;
  }
  const expected = expectedVersion(envelope, `business:${session.tenantId}`);
  const current = await client.query('SELECT name,currency,time_zone,version,business_profile FROM core.tenants WHERE id=$1 FOR UPDATE', [session.tenantId]);
  if (!current.rowCount) throw new DomainError('NOT_FOUND', 'Business was not found.', 404);
  if (Number(current.rows[0].version) !== expected) throw new DomainError('VERSION_CONFLICT', 'Business configuration changed. Review current settings before saving.', 409, { currentVersion: Number(current.rows[0].version) });
  if (envelope.type === 'configuration.business.update') {
    const input = validateBusinessInput(envelope.payload);
    if (input.currency !== current.rows[0].currency && await currencyLocked(client, session.tenantId)) throw new DomainError('CURRENCY_LOCKED', 'Currency cannot change after monetary setup or posted evidence exists. Existing prices, balances and receipts retain their currency.', 409);
    const result = await client.query('UPDATE core.tenants SET name=$2,currency=$3,time_zone=$4,business_profile=$5::jsonb,version=version+1 WHERE id=$1 RETURNING version', [session.tenantId, input.name, input.currency, input.timeZone, JSON.stringify(input.profile)]);
    const value = { tenantId: session.tenantId, version: Number(result.rows[0].version) };
    await recordEvidence(client, session, envelope, current.rows[0], { ...input, ...value });
    return value;
  }
  if (envelope.type !== 'configuration.capabilities.update') throw new DomainError('VALIDATION_FAILED', 'Unsupported configuration command.');
  const capabilities = validateCapabilities(envelope.payload.capabilities);
  const old = await client.query<{ capability: string }>('SELECT capability FROM core.tenant_capabilities WHERE tenant_id=$1 ORDER BY capability', [session.tenantId]);
  const removed = old.rows.map(row => row.capability).filter(capability => !capabilities.includes(capability));
  if (removed.includes('commerce')) {
    const active = await client.query('SELECT 1 FROM commerce.shifts WHERE tenant_id=$1 AND status=\'OPEN\' LIMIT 1', [session.tenantId]);
    if (active.rowCount) throw new DomainError('CAPABILITY_IN_USE', 'Close all open tills before disabling commerce.', 409);
  }
  if (removed.includes('inventory')) {
    const active = await client.query('SELECT 1 FROM inventory.stock_counts WHERE tenant_id=$1 AND status=\'OPEN\' LIMIT 1', [session.tenantId]);
    if (active.rowCount) throw new DomainError('CAPABILITY_IN_USE', 'Finish or cancel all open stock counts before disabling inventory.', 409);
  }
  if (removed.includes('hospitality')) {
    const active = await client.query('SELECT 1 FROM hospitality.stays WHERE tenant_id=$1 AND status=\'CHECKED_IN\' UNION ALL SELECT 1 FROM hospitality.reservations WHERE tenant_id=$1 AND status=\'CONFIRMED\' LIMIT 1', [session.tenantId]);
    if (active.rowCount) throw new DomainError('CAPABILITY_IN_USE', 'Resolve active stays and reservations before disabling hospitality.', 409);
  }
  await client.query('DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND NOT (capability=ANY($2::text[]))', [session.tenantId, capabilities]);
  for (const capability of capabilities) await client.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2) ON CONFLICT DO NOTHING', [session.tenantId, capability]);
  const updated = await client.query('UPDATE core.tenants SET version=version+1 WHERE id=$1 RETURNING version', [session.tenantId]);
  const value = { tenantId: session.tenantId, version: Number(updated.rows[0].version), capabilities };
  await recordEvidence(client, session, envelope, { capabilities: old.rows.map(row => row.capability), version: Number(current.rows[0].version) }, value);
  return value;
}

export function receiptConfigurationSnapshot(businessValue: unknown, outletValue: unknown) {
  const business = readBusinessProfile(businessValue); const outlet = readOutletProfile(outletValue);
  return {
    legalName: business.legalName, registrationNumber: business.registrationNumber, taxRegistrationNumber: business.taxRegistrationNumber,
    address: outlet.address || business.address, phone: outlet.phone || business.phone, email: outlet.email || business.email,
    website: business.website, logoUrl: business.logoUrl, receiptQrImage: business.receiptQrImage, showQrOnReceipt: business.showQrOnReceipt,
    receiptHeader: outlet.receiptHeader || business.receiptHeader,
    receiptFooter: outlet.receiptFooter || business.receiptFooter, taxLabel: business.taxPolicy.label, taxCalculation: 'exclusive',
  };
}
