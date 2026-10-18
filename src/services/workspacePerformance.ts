import type { ActiveTab } from '../components/layout/AppShell';
import type { BackendSession } from './apiClient';

/** Blocking reads whose completion makes each entry workspace usable or recoverable. */
export function workspaceInitialReads(tab: ActiveTab, session: BackendSession): string[] {
  const permissions = new Set(session.user.permissions);
  switch (tab) {
    case 'today': return permissions.has('shift.open') || permissions.has('shift.close') ? ['/shifts/current'] : [];
    case 'sell': return ['/catalog/items', '/shifts/current'];
    case 'sales': return ['/sales/orders'];
    case 'hotel': return ['/hospitality/rooms', '/hospitality/reservations', '/hospitality/stays'];
    case 'reservations': return ['/hospitality/rooms', '/hospitality/reservations', '/hospitality/stays'];
    case 'stock': return ['/catalog/items', '/inventory/movements'];
    case 'stock-count': return ['/catalog/items', '/inventory/counts/current', '/inventory/counts'];
    case 'purchasing': return ['/catalog/items'];
    case 'customers': return permissions.has('customers.settle') ? ['/customers', '/shifts/current'] : ['/customers'];
    case 'shifts': return ['/shifts/current', '/shifts/close-reports'];
    case 'money': return ['/reports/trial-balance'];
    case 'reports': return ['/reports/operational-analytics'];
    // The management landing page is immediately usable from its local navigation
    // and setup cards. Configuration is fetched only after opening a settings
    // section, so it must not hold first-usable timing for the whole workspace.
    case 'manage': return [];
    case 'onboarding': return ['/configuration'];
    case 'help': return [];
    default: return [];
  }
}

export function normalizedWorkspaceRoute(route: string): string {
  return route.split('?', 1)[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');
}
