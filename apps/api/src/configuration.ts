import { createHash, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ConfigurationAssetKind = 'logo' | 'receipt_qr';
export interface ConfigurationImageAction { mode: 'keep' | 'remove' | 'replace'; assetId?: string }
export interface ConfigurationImageActions { logo: ConfigurationImageAction; receiptQr: ConfigurationImageAction }
export function decodePngDataUrl(value: unknown, field = 'image'): Buffer {
  if (typeof value !== 'string') throw new DomainError('VALIDATION_FAILED', `${field} must be a PNG image.`);
  const normalized = value.trim();
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(normalized);
  if (!match || normalized.length > Math.ceil(MAX_RECEIPT_IMAGE_BYTES * 4 / 3) + 32) throw new DomainError('VALIDATION_FAILED', `${field} must be a PNG image up to 512 KB.`);
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_IMAGE_BYTES || bytes.toString('base64') !== match[1] || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new DomainError('VALIDATION_FAILED', `${field} must contain a valid PNG image up to 512 KB.`);
  }
  return bytes;
}
function pngCrc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function validatePngStructure(bytes: Buffer, field: string): void {
  const invalid = (): never => { throw new DomainError('VALIDATION_FAILED', `${field} must be a complete, readable PNG image.`); };
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) invalid();
  let offset = 8; let header: { width: number; height: number; depth: number; color: number; interlace: number } | undefined;
  let palette = false; let sawData = false; let ended = false; let dataChunks: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8; const crcOffset = dataStart + length;
    if (pngCrc32(bytes.subarray(offset + 4, crcOffset)) !== bytes.readUInt32BE(crcOffset)) invalid();
    const data = bytes.subarray(dataStart, crcOffset);
    if (!header) {
      if (type !== 'IHDR' || length !== 13) invalid();
      const width = data.readUInt32BE(0); const height = data.readUInt32BE(4); const depth = data[8]; const color = data[9];
      const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || width > 4096 || height > 4096 || width * height > 4_194_304 || !validDepths[color]?.includes(depth) || data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(data[12])) invalid();
      header = { width, height, depth, color, interlace: data[12] };
    } else if (type === 'IHDR') invalid();
    if (type === 'PLTE') palette = true;
    if (type === 'IDAT') { if (ended) invalid(); sawData = true; dataChunks.push(data); }
    if (type === 'IEND') {
      if (length !== 0 || !sawData || crcOffset + 4 !== bytes.length) invalid();
      ended = true; offset = crcOffset + 4; break;
    }
    if ((type[0] >= 'A' && type[0] <= 'Z') && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) invalid();
    offset = crcOffset + 4;
  }
  if (!header) invalid();
  const parsedHeader = header!;
  if (!palette && parsedHeader.color === 3 || !ended || offset !== bytes.length) invalid();
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const bitsPerPixel = channels[parsedHeader.color] * parsedHeader.depth;
  const passes = parsedHeader.interlace === 0 ? [[0, 0, 1, 1]] : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let expectedBytes = 0; const rows: Array<{ bytes: number; count: number }> = [];
  for (const [x, y, dx, dy] of passes) {
    const width = Math.max(0, Math.ceil((parsedHeader.width - x) / dx)); const height = Math.max(0, Math.ceil((parsedHeader.height - y) / dy));
    if (!width || !height) continue;
    const rowBytes = Math.ceil(width * bitsPerPixel / 8); expectedBytes += height * (rowBytes + 1); rows.push({ bytes: rowBytes, count: height });
  }
  if (expectedBytes > 32 * 1024 * 1024) invalid();
  let decoded: Buffer;
  try { decoded = inflateSync(Buffer.concat(dataChunks), { maxOutputLength: expectedBytes + 1 }); } catch { invalid(); }
  if (decoded!.length !== expectedBytes) invalid();
  let decodedOffset = 0;
  for (const row of rows) for (let index = 0; index < row.count; index++) {
    if (decoded![decodedOffset] > 4) invalid();
    decodedOffset += row.bytes + 1;
  }
}
function uploadedPng(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new DomainError('VALIDATION_FAILED', `${field} must be a PNG image.`);
  const normalized = value.trim();
  if (!normalized) return '';
  decodePngDataUrl(normalized, field);
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
export function validateBusinessInput(payload: Record<string, unknown>, currentProfile: BusinessProfile = businessDefaults) {
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
  const rawImageActions = payload.imageActions;
  let imageActions: ConfigurationImageActions;
  let logoUrl: string;
  let receiptQrImage: string;
  if (rawImageActions === undefined) {
    imageActions = {
      logo: { mode: 'keep' },
      receiptQr: { mode: 'keep' },
    };
    logoUrl = payload.logoUrl === undefined ? currentProfile.logoUrl : logoImage(payload.logoUrl);
    receiptQrImage = payload.receiptQrImage === undefined ? currentProfile.receiptQrImage : uploadedPng(payload.receiptQrImage, 'receiptQrImage');
  } else {
    if (!rawImageActions || typeof rawImageActions !== 'object' || Array.isArray(rawImageActions)) throw new DomainError('VALIDATION_FAILED', 'imageActions must specify keep, remove, or replace for each image.');
    const actions = rawImageActions as Record<string, unknown>;
    const parseAction = (raw: unknown, name: string): ConfigurationImageAction => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DomainError('VALIDATION_FAILED', `imageActions.${name} is required.`);
      const item = raw as Record<string, unknown>;
      if (item.mode === 'keep' || item.mode === 'remove') return { mode: item.mode };
      if (item.mode === 'replace' && typeof item.assetId === 'string' && UUID_PATTERN.test(item.assetId)) return { mode: 'replace', assetId: item.assetId };
      throw new DomainError('VALIDATION_FAILED', `imageActions.${name} must be keep, remove, or replace with a staged asset ID.`);
    };
    imageActions = { logo: parseAction(actions.logo, 'logo'), receiptQr: parseAction(actions.receiptQr, 'receiptQr') };
    const requestedLogo = typeof payload.logoUrl === 'string' ? payload.logoUrl.trim() : '';
    logoUrl = imageActions.logo.mode === 'keep'
      ? requestedLogo && !requestedLogo.startsWith('/api/v1/configuration/assets/') ? logoImage(requestedLogo) : currentProfile.logoUrl
      : '';
    receiptQrImage = imageActions.receiptQr.mode === 'keep' ? currentProfile.receiptQrImage : '';
  }
  const profile: BusinessProfile = {
    legalName: text(payload.legalName, 'legalName', 160), registrationNumber: text(payload.registrationNumber, 'registrationNumber', 80), taxRegistrationNumber: text(payload.taxRegistrationNumber, 'taxRegistrationNumber', 80),
    address: text(payload.address, 'address', 500, false, true), phone: phone(payload.phone), email: email(payload.email, 'email'), website: url(payload.website, 'website'), logoUrl,
    receiptQrImage,
    showQrOnReceipt: payload.showQrOnReceipt === undefined ? true : typeof payload.showQrOnReceipt === 'boolean' ? payload.showQrOnReceipt : (() => { throw new DomainError('VALIDATION_FAILED', 'showQrOnReceipt must be a boolean.'); })(),
    receiptHeader: text(payload.receiptHeader, 'receiptHeader', 500, false, true), receiptFooter: text(payload.receiptFooter, 'receiptFooter', 500, false, true),
    taxPolicy: { calculation: 'exclusive', defaultRateBps: policy.defaultRateBps, label: text(policy.label, 'taxPolicy.label', 40, true), reviewed: policy.reviewed },
  };
  return { name, currency, timeZone, profile, imageActions };
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
export async function stageConfigurationAsset(client: PoolClient, session: ApiSession, value: unknown) {
  requireConfigurationAccess(session, true);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('VALIDATION_FAILED', 'Provide a PNG image, image kind, and draft ID.');
  const input = value as Record<string, unknown>;
  if (input.kind !== 'logo' && input.kind !== 'receipt_qr') throw new DomainError('VALIDATION_FAILED', 'Image kind must be logo or receipt_qr.');
  if (typeof input.draftId !== 'string' || !UUID_PATTERN.test(input.draftId)) throw new DomainError('VALIDATION_FAILED', 'A valid image draft ID is required.');
  const content = decodePngDataUrl(input.dataUrl, input.kind === 'logo' ? 'logoUrl' : 'receiptQrImage');
  validatePngStructure(content, input.kind === 'logo' ? 'logoUrl' : 'receiptQrImage');
  const sha256 = createHash('sha256').update(content).digest();
  await client.query("DELETE FROM core.configuration_assets WHERE tenant_id=$1 AND status='PENDING' AND created_at<now()-interval '7 days'", [session.tenantId]);
  const existing = await client.query<{ id: string; sha256: Buffer; byte_length: number }>(`SELECT id,sha256,byte_length FROM core.configuration_assets
    WHERE tenant_id=$1 AND draft_id=$2 AND kind=$3 FOR UPDATE`, [session.tenantId, input.draftId, input.kind]);
  if (existing.rowCount) {
    if (!Buffer.from(existing.rows[0].sha256).equals(sha256)) throw new DomainError('IDEMPOTENCY_MISMATCH', 'This image draft ID was already used for different image content.', 409);
    return { asset: { id: existing.rows[0].id, kind: input.kind, sha256: sha256.toString('hex'), byteLength: existing.rows[0].byte_length } };
  }
  const id = randomUUID();
  await client.query(`INSERT INTO core.configuration_assets(id,tenant_id,kind,draft_id,uploaded_by,content,sha256,byte_length)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, session.tenantId, input.kind, input.draftId, session.userId, content, sha256, content.length]);
  return { asset: { id, kind: input.kind, sha256: sha256.toString('hex'), byteLength: content.length } };
}
export async function getConfigurationAsset(session: ApiSession, assetId?: string, legacyKind?: 'logo' | 'receipt_qr'): Promise<Buffer | null> {
  if (assetId) {
    if (!UUID_PATTERN.test(assetId)) return null;
    const result = await pool.query<{ content: Buffer }>(`SELECT content FROM core.configuration_assets
      WHERE tenant_id=$1 AND id=$2`, [session.tenantId, assetId]);
    return result.rowCount ? Buffer.from(result.rows[0].content) : null;
  }
  if (!legacyKind) return null;
  const field = legacyKind === 'logo' ? 'logoUrl' : 'receiptQrImage';
  const result = await pool.query<{ image: string | null }>('SELECT business_profile->>$2 AS image FROM core.tenants WHERE id=$1', [session.tenantId, field]);
  if (!result.rowCount || !result.rows[0].image?.startsWith('data:image/png;base64,')) return null;
  try { return decodePngDataUrl(result.rows[0].image, field); } catch { return null; }
}
export async function getConfiguration(session: ApiSession): Promise<{ configuration: ConfigurationRead }> {
  requireConfigurationAccess(session);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await client.query(`SELECT t.id tenant_id,t.name tenant_name,t.currency,t.time_zone tenant_time_zone,t.version tenant_version,
      t.business_profile-'logoUrl'-'receiptQrImage' business_profile,
      CASE WHEN t.business_profile->>'logoUrl' LIKE 'data:image/png;base64,%' THEN NULL ELSE t.business_profile->>'logoUrl' END business_logo_url,
      CASE WHEN t.business_profile->>'logoUrl' LIKE 'data:image/png;base64,%' THEN true ELSE false END has_legacy_logo,
      CASE WHEN t.business_profile->>'receiptQrImage' LIKE 'data:image/png;base64,%' THEN true ELSE false END has_legacy_receipt_qr,
      logo.id logo_asset_id,receipt_qr.id receipt_qr_asset_id,
      o.id outlet_id,o.name outlet_name,o.time_zone outlet_time_zone,o.version outlet_version,o.outlet_profile
      FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id
      LEFT JOIN LATERAL (SELECT id FROM core.configuration_assets WHERE tenant_id=t.id AND kind='logo' AND status='ACTIVE' LIMIT 1) logo ON true
      LEFT JOIN LATERAL (SELECT id FROM core.configuration_assets WHERE tenant_id=t.id AND kind='receipt_qr' AND status='ACTIVE' LIMIT 1) receipt_qr ON true
      WHERE t.id=$1 AND o.id=$2`, [session.tenantId, session.outletId]);
    if (!result.rowCount) throw new DomainError('NOT_FOUND', 'Business outlet was not found.', 404);
    const row = result.rows[0];
    const baseProfile = readBusinessProfile(row.business_profile);
    const business: BusinessConfiguration = {
      id: row.tenant_id, name: row.tenant_name, currency: row.currency, timeZone: row.tenant_time_zone, version: Number(row.tenant_version),
      ...baseProfile,
      logoUrl: row.logo_asset_id ? `/api/v1/configuration/assets/${row.logo_asset_id}` : row.has_legacy_logo ? '/api/v1/configuration/assets/legacy/logo' : (row.business_logo_url ?? baseProfile.logoUrl),
      receiptQrImage: row.receipt_qr_asset_id ? `/api/v1/configuration/assets/${row.receipt_qr_asset_id}` : row.has_legacy_receipt_qr ? '/api/v1/configuration/assets/legacy/receipt_qr' : baseProfile.receiptQrImage,
    };
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
function safeImageEvidence(value: string) {
  if (!value) return null;
  if (value.startsWith('data:image/')) return { source: 'legacy-inline-image', sha256: createHash('sha256').update(value).digest('hex') };
  if (value.startsWith('/api/v1/configuration/assets/')) return { source: 'configuration-asset', reference: value.split('/').at(-1) };
  try { return { source: 'external-image', host: new URL(value).host }; } catch { return { source: 'stored-image-reference' }; }
}
function safeBusinessProfileEvidence(value: unknown) {
  const profile = readBusinessProfile(value);
  return { ...profile, logoUrl: safeImageEvidence(profile.logoUrl), receiptQrImage: safeImageEvidence(profile.receiptQrImage) };
}
async function applyImageAction(client: PoolClient, session: ApiSession, action: ConfigurationImageAction, kind: ConfigurationAssetKind) {
  if (action.mode === 'keep') return null;
  if (action.mode === 'replace') {
    const pending = await client.query<{ id: string; sha256: Buffer; byte_length: number }>(`SELECT id,sha256,byte_length FROM core.configuration_assets
      WHERE tenant_id=$1 AND id=$2 AND kind=$3 AND uploaded_by=$4 AND status='PENDING' FOR UPDATE`, [session.tenantId, action.assetId, kind, session.userId]);
    if (!pending.rowCount) throw new DomainError('NOT_FOUND', 'The replacement image is no longer available. Upload it again before saving settings.', 404);
    await client.query("UPDATE core.configuration_assets SET status='RETIRED',retired_at=now() WHERE tenant_id=$1 AND kind=$2 AND status='ACTIVE'", [session.tenantId, kind]);
    await client.query("UPDATE core.configuration_assets SET status='ACTIVE',activated_at=now() WHERE tenant_id=$1 AND id=$2", [session.tenantId, action.assetId]);
    return { kind, id: action.assetId, sha256: Buffer.from(pending.rows[0].sha256).toString('hex'), byteLength: pending.rows[0].byte_length };
  }
  await client.query("UPDATE core.configuration_assets SET status='RETIRED',retired_at=now() WHERE tenant_id=$1 AND kind=$2 AND status='ACTIVE'", [session.tenantId, kind]);
  return { kind, removed: true };
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
    const currentProfile = readBusinessProfile(current.rows[0].business_profile);
    const input = validateBusinessInput(envelope.payload, currentProfile);
    if (input.currency !== current.rows[0].currency && await currencyLocked(client, session.tenantId)) throw new DomainError('CURRENCY_LOCKED', 'Currency cannot change after monetary setup or posted evidence exists. Existing prices, balances and receipts retain their currency.', 409);
    const imageAssets = [
      await applyImageAction(client, session, input.imageActions.logo, 'logo'),
      await applyImageAction(client, session, input.imageActions.receiptQr, 'receipt_qr'),
    ].filter(Boolean);
    const result = await client.query('UPDATE core.tenants SET name=$2,currency=$3,time_zone=$4,business_profile=$5::jsonb,version=version+1 WHERE id=$1 RETURNING version', [session.tenantId, input.name, input.currency, input.timeZone, JSON.stringify(input.profile)]);
    const value = { tenantId: session.tenantId, version: Number(result.rows[0].version) };
    const before = { name: current.rows[0].name, currency: current.rows[0].currency, timeZone: current.rows[0].time_zone, version: Number(current.rows[0].version), profile: safeBusinessProfileEvidence(currentProfile) };
    const after = { name: input.name, currency: input.currency, timeZone: input.timeZone, version: value.version, profile: safeBusinessProfileEvidence(input.profile), imageAssets };
    await recordEvidence(client, session, envelope, before, after);
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

export function receiptConfigurationSnapshot(businessValue: unknown, outletValue: unknown, assets: { logoId?: string | null; receiptQrId?: string | null } = {}) {
  const business = readBusinessProfile(businessValue); const outlet = readOutletProfile(outletValue);
  return {
    legalName: business.legalName, registrationNumber: business.registrationNumber, taxRegistrationNumber: business.taxRegistrationNumber,
    address: outlet.address || business.address, phone: outlet.phone || business.phone, email: outlet.email || business.email,
    website: business.website, logoUrl: assets.logoId ? `/api/v1/configuration/assets/${assets.logoId}` : business.logoUrl,
    receiptQrImage: assets.receiptQrId ? `/api/v1/configuration/assets/${assets.receiptQrId}` : business.receiptQrImage, showQrOnReceipt: business.showQrOnReceipt,
    receiptHeader: outlet.receiptHeader || business.receiptHeader,
    receiptFooter: outlet.receiptFooter || business.receiptFooter, taxLabel: business.taxPolicy.label, taxCalculation: 'exclusive',
  };
}
