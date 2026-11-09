import type { BackendSession } from '../services/apiClient';
import type { RecoverableCommand } from '../services/commandJournal';
import type { WorkspaceId } from '../types/ui';
import { featureState, workspaceFeatures } from './featureRegistry';

export type RecoveryDestination =
  | { kind: 'workspace'; workspace: WorkspaceId }
  | { kind: 'manage'; section: 'staff' | 'devices' | 'business' | 'outlet' | 'capabilities' | 'readiness' | 'stockExceptions' }
  | { kind: 'account' };
export interface RecoveryNavigation { requestId: string; record: RecoverableCommand; destination: RecoveryDestination }

const destinations: Record<string, { permission: string; destination: RecoveryDestination }> = {
  'staff.member.create': { permission: 'staff.manage', destination: { kind: 'manage', section: 'staff' } },
  'staff.member.update': { permission: 'staff.manage', destination: { kind: 'manage', section: 'staff' } },
  'staff.member.set_active': { permission: 'staff.manage', destination: { kind: 'manage', section: 'staff' } },
  'staff.sessions.revoke': { permission: 'staff.manage', destination: { kind: 'manage', section: 'staff' } },
  'devices.assignment.create': { permission: 'devices.manage', destination: { kind: 'manage', section: 'devices' } },
  'devices.assignment.update': { permission: 'devices.manage', destination: { kind: 'manage', section: 'devices' } },
  'devices.assignment.revoke': { permission: 'devices.manage', destination: { kind: 'manage', section: 'devices' } },
  'configuration.business.update': { permission: 'config.manage', destination: { kind: 'manage', section: 'business' } },
  'configuration.outlet.update': { permission: 'config.manage', destination: { kind: 'manage', section: 'outlet' } },
  'configuration.outlet.create': { permission: 'config.manage', destination: { kind: 'manage', section: 'outlet' } },
  'configuration.outlet.set_active': { permission: 'config.manage', destination: { kind: 'manage', section: 'outlet' } },
  'configuration.capabilities.update': { permission: 'config.manage', destination: { kind: 'manage', section: 'capabilities' } },
  'configuration.go_live.approve': { permission: 'config.manage', destination: { kind: 'manage', section: 'readiness' } },
  'catalog.product.create': { permission: 'catalog.manage', destination: { kind: 'workspace', workspace: 'catalog' } },
  'catalog.import.apply': { permission: 'catalog.manage', destination: { kind: 'workspace', workspace: 'catalog' } },
  'configuration.stock_exception_policy.update': { permission: 'inventory.shortfall.configure', destination: { kind: 'manage', section: 'stockExceptions' } },
  'inventory.receive': { permission: 'inventory.receive', destination: { kind: 'workspace', workspace: 'purchasing' } },
  'inventory.count.open': { permission: 'inventory.count', destination: { kind: 'workspace', workspace: 'stock-count' } },
  'inventory.count.save': { permission: 'inventory.count', destination: { kind: 'workspace', workspace: 'stock-count' } },
  'inventory.count.review': { permission: 'inventory.count.approve', destination: { kind: 'workspace', workspace: 'stock-count' } },
  'inventory.count.post': { permission: 'inventory.count.approve', destination: { kind: 'workspace', workspace: 'stock-count' } },
  'inventory.count.cancel': { permission: 'inventory.count.approve', destination: { kind: 'workspace', workspace: 'stock-count' } },
  'inventory.sale_shortfall.resolve': { permission: 'inventory.shortfall.resolve', destination: { kind: 'workspace', workspace: 'stock-exceptions' } },
  'sales.order.settle': { permission: 'commerce.sell', destination: { kind: 'workspace', workspace: 'sales' } },
  'sales.order.refund': { permission: 'commerce.refund', destination: { kind: 'workspace', workspace: 'sales' } },
  'customers.account.create': { permission: 'customers.manage', destination: { kind: 'workspace', workspace: 'customers' } },
  'customers.account.update': { permission: 'customers.manage', destination: { kind: 'workspace', workspace: 'customers' } },
  'customers.repayment': { permission: 'customers.settle', destination: { kind: 'workspace', workspace: 'customers' } },
  'hotel.room.create': { permission: 'hotel.manage', destination: { kind: 'workspace', workspace: 'hotel' } },
  'hotel.reservation.create': { permission: 'hotel.frontdesk', destination: { kind: 'workspace', workspace: 'hotel' } },
  'hotel.reservation.cancel': { permission: 'hotel.frontdesk', destination: { kind: 'workspace', workspace: 'hotel' } },
  'hotel.checkin': { permission: 'hotel.frontdesk', destination: { kind: 'workspace', workspace: 'hotel' } },
  'hotel.checkout': { permission: 'hotel.frontdesk', destination: { kind: 'workspace', workspace: 'hotel' } },
  'hotel.room.mark_ready': { permission: 'hotel.housekeeping', destination: { kind: 'workspace', workspace: 'hotel' } },
  'shift.open': { permission: 'shift.open', destination: { kind: 'workspace', workspace: 'shifts' } },
  'shift.close': { permission: 'shift.close', destination: { kind: 'workspace', workspace: 'shifts' } },
  'shift.cash.movement': { permission: 'shift.payout', destination: { kind: 'workspace', workspace: 'shifts' } },
  'finance.expense.record': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.expense.reverse': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.expense.reclassify': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.account.label': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.supplier.create': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.supplier.invoice': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.supplier.invoice.reverse': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.supplier.payment': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.mpesa.statement.record': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.mpesa.statement.match': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.mpesa.statement.correct': { permission: 'finance.manage', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.period.create': { permission: 'finance.close', destination: { kind: 'workspace', workspace: 'money' } },
  'finance.period.transition': { permission: 'finance.close', destination: { kind: 'workspace', workspace: 'money' } },
};

/** Navigation hints are derived from current authority, never from journal payload routes. */
export function recoveryDestination(session: BackendSession, record: RecoverableCommand): RecoveryDestination | null {
  if (record.actorId !== session.user.id || record.command.tenantId !== session.tenant.id || record.command.deviceId !== session.deviceId) return null;
  if (record.command.type === 'auth.session.revoke') return { kind: 'account' };
  const rule = Object.hasOwn(destinations, record.command.type) ? destinations[record.command.type] : undefined;
  if (!rule || !session.user.permissions.includes(rule.permission)) return null;
  const workspace = rule.destination.kind === 'manage' ? 'manage' : rule.destination.kind === 'workspace' ? rule.destination.workspace : null;
  const feature = workspaceFeatures.find(feature => feature.id === workspace);
  if (!feature || !['connected', 'partial'].includes(featureState(session, feature))) return null;
  if (rule.destination.kind === 'manage' && rule.destination.section === 'staff' && !session.user.permissions.includes('staff.view')) return null;
  if (rule.destination.kind === 'manage' && rule.destination.section === 'devices' && !session.user.permissions.includes('devices.view')) return null;
  if (rule.destination.kind === 'manage' && rule.destination.section === 'readiness' && !session.user.permissions.includes('config.view') && !session.user.permissions.includes('config.manage')) return null;
  if (rule.destination.kind === 'manage' && rule.destination.section === 'stockExceptions' && !session.user.permissions.includes('inventory.shortfall.view') && !session.user.permissions.includes('inventory.shortfall.configure')) return null;
  return rule.destination;
}

export function recoveryNavigationUnavailable(session: BackendSession, record: RecoverableCommand): string | null {
  if (record.actorId !== session.user.id || record.command.tenantId !== session.tenant.id) return 'This operation belongs to another signed-in operator or business.';
  if (record.command.deviceId !== session.deviceId) return 'Sign in with the original workspace assignment to reopen this operation. Its evidence remains retained.';
  if (!recoveryDestination(session, record)) return 'Your current access or enabled services do not allow this operation to be reopened. Its evidence remains retained.';
  return null;
}
