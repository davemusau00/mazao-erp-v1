import type { PoolClient } from 'pg';
import { DomainError, type ApiSession, type CommandEnvelope } from './contracts.js';
import { COMMAND_CATALOGUE, validateCommandPayload } from './commandCatalogue.js';
import { legacyCommandCapabilities, requireCapabilities, requireCommandAuthority } from './commandAuthorization.js';
import { lockCatalogOutlet } from './catalogMaintenance.js';
import { productImportRequiredCapabilities } from './productImport.js';
import { isStockTracked, normalizeItemKind } from './itemKinds.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new DomainError('VALIDATION_FAILED', 'A valid scoped record ID is required.');
  return value;
}
function kindCapability(kind: unknown): string {
  return isStockTracked(normalizeItemKind(kind)) ? 'inventory' : 'commerce';
}
const union = (values: readonly string[]) => [...new Set(values)].sort();
const emptyCatalogCapability = (session: ApiSession) => session.capabilities.includes('commerce') ? 'commerce' : 'inventory';

/** Trusted planning only: same serializable transaction and outlet lock as the
 * execution. No business writes, row-lock upgrades, or retry-body authority. */
export async function resolveCommandRequirements(client: PoolClient, session: ApiSession, envelope: CommandEnvelope): Promise<string[]> {
  requireCommandAuthority(session, envelope.type);
  validateCommandPayload(envelope);
  const baseline = [...COMMAND_CATALOGUE[envelope.type].capabilities];
  const { type, payload } = envelope;
  if (type.startsWith('catalog.')) await lockCatalogOutlet(client, session);
  else if (type === 'sales.order.settle' || type === 'sales.order.refund') await lockCatalogOutlet(client, session, 'shared');
  let dynamic: string[] = [];
  if (type === 'catalog.product.create') {
    dynamic = [kindCapability(payload.itemKind)];
  } else if (type.startsWith('catalog.product.')) {
    const rows = await client.query('SELECT item_kind FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3', [session.tenantId, session.outletId, id(payload.productId)]);
    if (!rows.rowCount) throw new DomainError('NOT_FOUND', 'Item was not found at this outlet.', 404);
    dynamic = [kindCapability(rows.rows[0].item_kind)];
    if (payload.itemKind !== undefined) dynamic.push(kindCapability(payload.itemKind));
  } else if (type.startsWith('catalog.category.')) {
    const ids = type === 'catalog.category.create' ? [] : type === 'catalog.category.merge' ? [id(payload.sourceCategoryId), id(payload.targetCategoryId)] : [id(payload.categoryId)];
    if (ids.length) {
      const categories = await client.query('SELECT id FROM catalog.categories WHERE tenant_id=$1 AND outlet_id=$2 AND id=ANY($3::uuid[])', [session.tenantId, session.outletId, ids]);
      if (categories.rowCount !== new Set(ids).size) throw new DomainError('NOT_FOUND', 'Category was not found at this outlet.', 404);
      const products = await client.query('SELECT DISTINCT item_kind FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND category_id=ANY($3::uuid[])', [session.tenantId, session.outletId, ids]);
      dynamic = products.rows.map(row => kindCapability(row.item_kind));
    }
    if (!dynamic.length) dynamic = [emptyCatalogCapability(session)];
  } else if (type.startsWith('catalog.import.')) {
    dynamic = await productImportRequiredCapabilities(client, session, envelope);
    if (!dynamic.length) dynamic = [emptyCatalogCapability(session)];
  } else if (type === 'sales.order.settle' || type === 'sales.order.refund') {
    if (!Array.isArray(payload.lines) || !payload.lines.length) throw new DomainError('VALIDATION_FAILED', 'At least one line is required.');
    const ids = payload.lines.map(line => id(line && typeof line === 'object' ? (line as Record<string, unknown>)[type === 'sales.order.settle' ? 'productId' : 'orderLineId'] : undefined));
    const rows = type === 'sales.order.settle'
      ? await client.query('SELECT id,item_kind AS kind FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=ANY($3::uuid[])', [session.tenantId, session.outletId, ids])
      : await client.query('SELECT id,item_kind_snapshot AS kind FROM commerce.order_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 AND id=ANY($4::uuid[])', [session.tenantId, session.outletId, id(payload.orderId), ids]);
    if (rows.rowCount !== new Set(ids).size) throw new DomainError('NOT_FOUND', 'A line was not found at this outlet.', 404);
    dynamic = rows.rows.map(row => kindCapability(row.kind));
  }
  return union([...baseline, ...dynamic]);
}

export async function persistCommandRequirements(client: PoolClient, session: ApiSession, commandId: string, requirements: readonly string[]) {
  await client.query('UPDATE system.commands SET authority_version=1,required_capabilities=$3::text[] WHERE tenant_id=$1 AND command_id=$2', [session.tenantId, commandId, union(requirements)]);
}

/** Call before the business savepoint. Rejected planning retains a conservative
 * legacy descriptor; successful planning freezes exact requirements first. */
export async function prepareCommandRequirements(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  const requirements = await resolveCommandRequirements(client, session, envelope);
  await persistCommandRequirements(client, session, envelope.commandId, requirements);
  requireCapabilities(session, requirements);
}

export async function initializeCommandRequirements(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  await persistCommandRequirements(client, session, envelope.commandId, legacyCommandCapabilities(envelope.type));
}
