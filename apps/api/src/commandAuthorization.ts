import { DomainError, ROLE_PERMISSIONS, type ApiSession } from './contracts.js';
import { COMMAND_CATALOGUE } from './commandCatalogue.js';

const policies = COMMAND_CATALOGUE;

export function requireCommandAuthority(session: ApiSession, type: string, recovery = false) {
  if (!Object.hasOwn(policies, type)) {
    throw new DomainError(recovery ? 'FORBIDDEN' : 'VALIDATION_FAILED', recovery ? 'Recovery is not available for this operation.' : `Unsupported command type: ${type}`, recovery ? 403 : 400);
  }
  const policy = policies[type];
  for (const permission of policy.permissions) {
    if (!ROLE_PERMISSIONS[session.role].includes(permission)) throw new DomainError('FORBIDDEN', 'Your current role cannot access this operation.', 403);
  }
  for (const capability of policy.capabilities) {
    if (!session.capabilities.includes(capability)) throw new DomainError('CAPABILITY_DISABLED', `The ${capability} capability is not enabled for this tenant.`, 403);
  }
}

/** Frozen pre-item-kind requirements. Version-zero rows include commands written
 * by an older API after the additive migration, so current catalogue policy must
 * never broaden their recovery authority. */
export function legacyCommandCapabilities(type: string): readonly string[] {
  if (type.startsWith('catalog.product.') || type.startsWith('catalog.category.') || type.startsWith('catalog.import.')) return ['inventory'];
  if (type === 'sales.order.settle' || type === 'sales.order.refund') return ['commerce', 'inventory'];
  return Object.hasOwn(policies, type) ? policies[type].capabilities : [];
}

export function requireCapabilities(session: ApiSession, capabilities: readonly string[]) {
  for (const capability of capabilities) {
    if (!session.capabilities.includes(capability)) throw new DomainError('CAPABILITY_DISABLED', `The ${capability} capability is not enabled for this tenant.`, 403);
  }
}

export interface StoredCommandScope {
  actor_id: string; outlet_id: string; command_type: string;
  authority_version?: unknown; required_capabilities?: unknown;
}

export function requireStoredCommandAuthority(session: ApiSession, command: StoredCommandScope) {
  requireCommandAuthority(session, command.command_type, true);
  // Dedicated legacy credential readers omit these columns; credentials have
  // no dynamic requirements. Generic readers always select both columns.
  const version = command.authority_version === undefined ? 0 : command.authority_version;
  const capabilities = command.required_capabilities;
  const known = new Set(['commerce', 'inventory', ...Object.values(policies).flatMap(policy => policy.capabilities)]);
  const validCapabilities = Array.isArray(capabilities) && capabilities.every(value => typeof value === 'string' && known.has(value)) && new Set(capabilities).size === capabilities.length;
  if (version === 0) {
    if (capabilities !== undefined && !validCapabilities) throw new DomainError('FORBIDDEN', 'Stored command authority is unavailable.', 403);
    requireCapabilities(session, legacyCommandCapabilities(command.command_type));
    return;
  }
  const dynamicCatalog = /^(catalog\.(product|category|import)\.)/.test(command.command_type);
  if (version !== 1 || !validCapabilities || !Array.isArray(capabilities) ||
      (dynamicCatalog && !capabilities.includes('commerce') && !capabilities.includes('inventory')) ||
      policies[command.command_type].capabilities.some(value => !capabilities.includes(value))) {
    throw new DomainError('FORBIDDEN', 'Stored command authority is unavailable. Contact an administrator with the original command ID.', 403);
  }
  requireCapabilities(session, capabilities);
}

export function requireCommandRecoveryAuthority(session: ApiSession, command: StoredCommandScope, mode: 'status' | 'replay') {
  if (command.actor_id !== session.userId || command.outlet_id !== session.outletId) {
    throw new DomainError(mode === 'status' ? 'NOT_FOUND' : 'FORBIDDEN', mode === 'status' ? 'Command was not found in your operator/outlet scope.' : 'This operation belongs to another operator or outlet.', mode === 'status' ? 404 : 403);
  }
  // The submitted type can be changed; only persisted type grants recovery.
  requireStoredCommandAuthority(session, command);
}
