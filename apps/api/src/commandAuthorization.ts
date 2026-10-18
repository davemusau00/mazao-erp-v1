import { DomainError, ROLE_PERMISSIONS, type ApiPermission, type ApiSession } from './contracts.js';

interface CommandPolicy { permissions: readonly ApiPermission[]; capabilities: readonly string[] }

// One baseline for execution and recovery. Payload-dependent permissions and
// domain invariants still belong to their command's application service.
const policies: Readonly<Record<string, CommandPolicy>> = {
  'catalog.product.create': { permissions: ['catalog.manage'], capabilities: ['inventory'] },
  'catalog.import.validate': { permissions: ['catalog.manage'], capabilities: ['inventory'] },
  'catalog.import.revalidate': { permissions: ['catalog.manage'], capabilities: ['inventory'] },
  'catalog.import.apply': { permissions: ['catalog.manage'], capabilities: ['inventory'] },
  'inventory.receive': { permissions: ['inventory.receive'], capabilities: ['inventory'] },
  'inventory.count.open': { permissions: ['inventory.count'], capabilities: ['inventory'] },
  'inventory.count.save': { permissions: ['inventory.count'], capabilities: ['inventory'] },
  'inventory.count.post': { permissions: ['inventory.count.approve'], capabilities: ['inventory'] },
  'inventory.count.cancel': { permissions: ['inventory.count.approve'], capabilities: ['inventory'] },
  'shift.open': { permissions: ['shift.open'], capabilities: ['commerce'] },
  'shift.cash.movement': { permissions: ['shift.payout'], capabilities: ['commerce'] },
  'shift.close': { permissions: ['shift.close'], capabilities: ['commerce'] },
  'sales.order.settle': { permissions: ['commerce.sell'], capabilities: ['commerce', 'inventory'] },
  'sales.order.refund': { permissions: ['commerce.refund'], capabilities: ['commerce', 'inventory'] },
  'finance.expense.record': { permissions: ['finance.manage'], capabilities: [] },
  'finance.account.label': { permissions: ['finance.manage'], capabilities: [] },
  'finance.expense.reverse': { permissions: ['finance.manage'], capabilities: [] },
  'finance.expense.reclassify': { permissions: ['finance.manage'], capabilities: [] },
  'finance.supplier.create': { permissions: ['finance.manage'], capabilities: [] },
  'finance.supplier.invoice': { permissions: ['finance.manage'], capabilities: [] },
  'finance.supplier.invoice.reverse': { permissions: ['finance.manage'], capabilities: [] },
  'finance.supplier.payment': { permissions: ['finance.manage'], capabilities: [] },
  'finance.mpesa.statement.record': { permissions: ['finance.manage'], capabilities: [] },
  'finance.mpesa.statement.match': { permissions: ['finance.manage'], capabilities: [] },
  'finance.mpesa.statement.correct': { permissions: ['finance.manage'], capabilities: [] },
  'finance.period.create': { permissions: ['finance.close'], capabilities: [] },
  'finance.period.transition': { permissions: ['finance.close'], capabilities: [] },
  'customers.account.create': { permissions: ['customers.manage'], capabilities: ['commerce'] },
  'customers.account.update': { permissions: ['customers.manage'], capabilities: ['commerce'] },
  'customers.repayment': { permissions: ['customers.settle'], capabilities: ['commerce'] },
  'hotel.room.create': { permissions: ['hotel.manage'], capabilities: ['hospitality'] },
  'hotel.reservation.create': { permissions: ['hotel.frontdesk'], capabilities: ['hospitality'] },
  'hotel.reservation.cancel': { permissions: ['hotel.frontdesk'], capabilities: ['hospitality'] },
  'hotel.checkin': { permissions: ['hotel.frontdesk'], capabilities: ['hospitality'] },
  'hotel.checkout': { permissions: ['hotel.frontdesk'], capabilities: ['hospitality'] },
  'hotel.room.mark_ready': { permissions: ['hotel.housekeeping'], capabilities: ['hospitality'] },
  'configuration.business.update': { permissions: ['config.manage'], capabilities: [] },
  'configuration.outlet.update': { permissions: ['config.manage'], capabilities: [] },
  'configuration.capabilities.update': { permissions: ['config.manage'], capabilities: [] },
  'staff.member.create': { permissions: ['staff.manage'], capabilities: [] },
  'staff.member.update': { permissions: ['staff.manage'], capabilities: [] },
  'staff.member.set_active': { permissions: ['staff.manage'], capabilities: [] },
  'staff.sessions.revoke': { permissions: ['staff.manage'], capabilities: [] },
  'devices.assignment.create': { permissions: ['devices.manage'], capabilities: [] },
  'devices.assignment.update': { permissions: ['devices.manage'], capabilities: [] },
  'devices.assignment.revoke': { permissions: ['devices.manage'], capabilities: [] },
  'auth.session.revoke': { permissions: [], capabilities: [] },
  // These execute only through their dedicated credential endpoints.
  'staff.password.set': { permissions: ['staff.manage'], capabilities: [] },
  'auth.password.change': { permissions: [], capabilities: [] },
};

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
