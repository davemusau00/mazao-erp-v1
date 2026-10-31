import type { ActiveTab } from '../components/layout/AppShell';
import type { BackendSession } from './apiClient';
import type { AccountingArea } from '../types/accounting';

/** Blocking reads whose completion makes each entry workspace usable or recoverable. */
export function workspaceInitialReads(tab: ActiveTab, session: BackendSession, accountingArea?: AccountingArea): string[] {
  const permissions = new Set(session.user.permissions);
  switch (tab) {
    case 'today': return session.tenant.capabilities.includes('commerce') && (permissions.has('shift.open') || permissions.has('shift.close')) ? ['/shifts/current'] : [];
    case 'sell': return ['/catalog/items', '/shifts/current'];
    case 'sales': return ['/sales/orders'];
    case 'service': return session.onboardingStatus!=='SETUP'&&permissions.has('restaurant.order.view')?['/restaurant/configuration','/restaurant/orders','/restaurant/menu']:session.onboardingStatus!=='SETUP'&&permissions.has('restaurant.ticket.view')?['/restaurant/ticket-stations']:['/restaurant/configuration'];
    case 'hotel': return ['/hospitality/rooms', '/hospitality/reservations', '/hospitality/stays'];
    case 'reservations': return ['/hospitality/rooms', '/hospitality/reservations', '/hospitality/stays'];
    case 'catalog': return ['/catalog/items', '/catalog/categories'];
    case 'stock': return ['/catalog/items', '/inventory/movements'];
    case 'stock-count': return ['/catalog/items', '/inventory/counts/current', '/inventory/counts'];
    case 'stock-exceptions': return ['/inventory/shortfalls', '/reports/stock-exceptions'];
    case 'purchasing': return ['/catalog/items'];
    case 'customers': return permissions.has('customers.settle') ? ['/customers', '/shifts/current'] : ['/customers'];
    case 'shifts': return ['/shifts/current', '/shifts/close-reports'];
    case 'money': {
      if (!accountingArea) return ['/reports/trial-balance'];
      const records = { overview: 'payments', expenses: 'expenses', suppliers: 'invoices', mpesa: 'statement-lines', periods: 'periods' };
      return ['/finance/controls', '/finance/records/suppliers', '/finance/records/receipts', `/finance/records/${records[accountingArea]}`];
    }
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
