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

export interface StoredCommandScope { actor_id: string; outlet_id: string; command_type: string }

export function requireCommandRecoveryAuthority(session: ApiSession, command: StoredCommandScope, mode: 'status' | 'replay') {
  if (command.actor_id !== session.userId || command.outlet_id !== session.outletId) {
    throw new DomainError(mode === 'status' ? 'NOT_FOUND' : 'FORBIDDEN', mode === 'status' ? 'Command was not found in your operator/outlet scope.' : 'This operation belongs to another operator or outlet.', mode === 'status' ? 404 : 403);
  }
  // The submitted type can be changed; only persisted type grants recovery.
  requireCommandAuthority(session, command.command_type, true);
}
