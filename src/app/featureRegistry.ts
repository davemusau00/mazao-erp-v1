import type { BackendSession } from '../services/apiClient';
import type { WorkspaceId } from '../types/ui';
import type { AccountingArea } from '../types/accounting';

export type FeatureAvailability = 'connected' | 'partial' | 'not_connected' | 'not_enabled' | 'insufficient_permission';
type Discoverability = 'all' | 'authorized' | 'admin';

export interface WorkspaceFeature {
  id: WorkspaceId;
  label: string;
  description: string;
  group: 'work' | 'money' | 'manage' | 'support';
  capability?: string;
  anyCapabilities?: string[];
  anyPermissions?: string[];
  discoverability: Discoverability;
  availability: FeatureAvailability;
}

export const workspaceFeatures: WorkspaceFeature[] = [
  { id: 'today', label: 'Today', description: 'Your shift at a glance', group: 'work', discoverability: 'all', availability: 'connected' },
  { id: 'sell', label: 'Sell', description: 'Take payment and serve guests', group: 'work', capability: 'commerce', anyPermissions: ['commerce.sell'], discoverability: 'authorized', availability: 'connected' },
  { id: 'sales', label: 'Sales history', description: 'Find receipts and returns', group: 'work', anyPermissions: ['commerce.sell', 'commerce.refund', 'finance.view'], discoverability: 'authorized', availability: 'connected' },
  { id: 'service', label: 'Tables & kitchen', description: 'Set up service areas, tables, stations and menu routing', group: 'work', capability: 'restaurant', anyPermissions: ['restaurant.view', 'restaurant.manage'], discoverability: 'all', availability: 'partial' },
  { id: 'stock', label: 'Stock', description: 'Items, movements and counts', group: 'work', capability: 'inventory', anyPermissions: ['catalog.manage', 'inventory.receive'], discoverability: 'authorized', availability: 'connected' },
  { id: 'catalog', label: 'Items and services', description: 'Maintain items, service prices and categories', group: 'work', anyCapabilities: ['commerce', 'inventory'], anyPermissions: ['catalog.manage'], discoverability: 'authorized', availability: 'connected' },
  { id: 'stock-count', label: 'Count stock', description: 'Scan and review a count', group: 'work', capability: 'inventory', anyPermissions: ['inventory.count', 'inventory.count.approve'], discoverability: 'authorized', availability: 'connected' },
  { id: 'stock-exceptions', label: 'Stock exceptions', description: 'Review confirmed sales with unrecorded stock', group: 'work', capability: 'inventory', anyPermissions: ['inventory.shortfall.view'], discoverability: 'authorized', availability: 'connected' },
  { id: 'purchasing', label: 'Purchasing', description: 'Receive deliveries; supplier bills in Money', group: 'work', capability: 'inventory', anyPermissions: ['inventory.receive'], discoverability: 'authorized', availability: 'partial' },
  { id: 'hotel', label: 'Hotel', description: 'Rooms and guest bills', group: 'work', capability: 'hospitality', anyPermissions: ['hotel.frontdesk', 'hotel.manage', 'hotel.housekeeping'], discoverability: 'authorized', availability: 'partial' },
  { id: 'reservations', label: 'Reservations', description: 'Check dates and room options', group: 'work', capability: 'hospitality', anyPermissions: ['hotel.frontdesk', 'hotel.manage'], discoverability: 'authorized', availability: 'partial' },
  { id: 'customers', label: 'Customers', description: 'Accounts and repayments', group: 'work', capability: 'commerce', anyPermissions: ['customers.view'], discoverability: 'authorized', availability: 'connected' },
  { id: 'shifts', label: 'Shifts', description: 'Till opening and cash-up', group: 'money', capability: 'commerce', anyPermissions: ['shift.open', 'shift.close'], discoverability: 'authorized', availability: 'connected' },
  { id: 'money', label: 'Money', description: 'Supplier bills, expenses, periods and reports', group: 'money', anyPermissions: ['finance.view'], discoverability: 'authorized', availability: 'partial' },
  { id: 'reports', label: 'Reports', description: 'Sales and operating reports', group: 'money', anyPermissions: ['finance.view'], discoverability: 'authorized', availability: 'partial' },
  { id: 'manage', label: 'Manage', description: 'Business setup and access', group: 'manage', anyPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', availability: 'connected' },
  { id: 'onboarding', label: 'Setup checklist', description: 'First-sale readiness checks', group: 'manage', anyPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', availability: 'partial' },
  { id: 'help', label: 'Help', description: 'Guides and recovery steps', group: 'support', discoverability: 'all', availability: 'connected' },
];

export type ManagementFeatureId = 'business' | 'staff' | 'permissions' | 'devices' | 'imports' | 'assets' | 'suppliers' | 'expenses' | 'periods' | 'offline' | 'payments' | 'capabilities' | 'readiness' | 'outlet' | 'stockExceptions';
export interface ManagementFeature {
  id: ManagementFeatureId;
  title: string;
  description: string;
  status: string;
  availability: FeatureAvailability;
  capability?: string;
  anyCapabilities?: string[];
  requiredPermissions?: string[];
  discoverability: Discoverability;
  route?: WorkspaceId;
  accountingArea?: AccountingArea;
  section?: 'business' | 'outlet' | 'capabilities' | 'readiness' | 'permissions' | 'staff' | 'devices' | 'stockExceptions';
  explanation: string;
}

export const managementFeatures: ManagementFeature[] = [
  { id: 'business', title: 'Business and outlets', description: 'Business details and current outlet settings', status: 'Limited', availability: 'partial', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'business', explanation: 'Manage business details and the current outlet. Adding and switching outlets is unavailable here.' },
  { id: 'staff', title: 'Staff', description: 'Staff accounts and business access', status: 'Available', availability: 'connected', requiredPermissions: ['staff.view'], discoverability: 'authorized', section: 'staff', explanation: 'Set up staff accounts, choose available roles and review sign-ins. Individual role permissions cannot be edited here.' },
  { id: 'permissions', title: 'Roles and permissions', description: 'Staff role access', status: 'Unavailable', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', explanation: 'Review available roles under Staff. Individual role permissions cannot be edited here.' },
  { id: 'devices', title: 'Workspace assignments', description: 'Assign staff to outlets', status: 'Available', availability: 'connected', requiredPermissions: ['devices.view'], discoverability: 'authorized', section: 'devices', explanation: 'Assign staff to outlets and review access changes. Printer setup is unavailable here.' },
  { id: 'imports', title: 'Data import', description: 'Review and import item or service CSV files', status: 'Available', availability: 'connected', anyCapabilities: ['commerce', 'inventory'], requiredPermissions: ['catalog.manage'], discoverability: 'authorized', route: 'catalog', explanation: 'Review CSV imports from Items and services. Services require sales access; stocked goods and opening stock require inventory. Spreadsheet workbooks, packages and variants are unavailable.' },
  { id: 'assets', title: 'Assets and maintenance', description: 'Equipment, custody and repairs', status: 'Unavailable', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'admin', explanation: 'Equipment records and maintenance tracking are unavailable.' },
  { id: 'suppliers', title: 'Supplier accounts and payables', description: 'Bills and recorded bank or M-Pesa payments in Money', status: 'Limited', availability: 'partial', requiredPermissions: ['finance.view'], discoverability: 'authorized', route: 'money', accountingArea: 'suppliers', explanation: 'Create suppliers, record unpaid expense bills or the full value of one stock delivery, and record partial payments already made. Purchase orders, supplier credits and partial delivery matching are unavailable.' },
  { id: 'expenses', title: 'Expenses', description: 'Record paid bank or M-Pesa expenses in Money', status: 'Limited', availability: 'partial', requiredPermissions: ['finance.view'], discoverability: 'authorized', route: 'money', accountingArea: 'expenses', explanation: 'Record already-paid operating, rent and utilities expenses, with linked category corrections and reversals. Stock purchases and cash till movements use separate workflows; this does not send money.' },
  { id: 'periods', title: 'Accounting periods', description: 'Review and close accounting dates in Money', status: 'Limited', availability: 'partial', requiredPermissions: ['finance.view'], discoverability: 'authorized', route: 'money', accountingArea: 'periods', explanation: 'Create periods and review account checks before closing. Posting is blocked in closing or closed dates. Closed periods cannot be reopened; period changes require financial close access.' },
  { id: 'offline', title: 'Connection and recovery', description: 'Connection needed to complete sales', status: 'Unavailable', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'admin', explanation: 'Sales require a connection. Unfinished actions remain available for status review.' },
  { id: 'payments', title: 'Payment reconciliation', description: 'Match incoming manual M-Pesa evidence in Money', status: 'Limited', availability: 'partial', requiredPermissions: ['finance.view'], discoverability: 'authorized', route: 'money', accountingArea: 'mpesa', explanation: 'Match incoming statements to cashier-confirmed M-Pesa receipts. Matching does not send money, verify with the provider, reconcile outgoing payments or prove statement completeness.' },
  { id: 'capabilities', title: 'Business capabilities', description: 'Services enabled for this business', status: 'Available', availability: 'connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'capabilities', explanation: 'Choose the services this business uses.' },
  { id: 'readiness', title: 'Setup checklist', description: 'First-sale setup checks', status: 'Limited', availability: 'partial', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'readiness', explanation: 'Review the setup needed for a first sale. Complete your wider business checks separately.' },
  { id: 'outlet', title: 'Outlet and receipts', description: 'Current outlet details and receipt text', status: 'Available', availability: 'connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'outlet', explanation: 'Manage outlet contact details, receipt text, the business logo and optional payment QR image.' },
  { id: 'stockExceptions', title: 'Stock exception sales', description: 'Allow confirmed sales against a recorded stock shortfall', status: 'Available', availability: 'connected', capability: 'inventory', requiredPermissions: ['inventory.shortfall.configure'], discoverability: 'authorized', section: 'stockExceptions', explanation: 'Set the current outlet policy for confirmed sales when recorded stock is short.' },
];

export function featureState(session: BackendSession, feature: Pick<WorkspaceFeature, 'capability' | 'anyCapabilities' | 'anyPermissions' | 'availability'>): FeatureAvailability {
  if (feature.anyPermissions?.length && !feature.anyPermissions.some(permission => session.user.permissions.includes(permission))) return 'insufficient_permission';
  if (feature.capability && !session.tenant.capabilities.includes(feature.capability)) return 'not_enabled';
  if (feature.anyCapabilities?.length && !feature.anyCapabilities.some(capability => session.tenant.capabilities.includes(capability))) return 'not_enabled';
  return feature.availability;
}

export function canDiscover(discoverability: Discoverability, session: BackendSession): boolean {
  if (discoverability === 'all') return true;
  if (discoverability === 'admin') return ['owner', 'admin'].includes(session.user.role.toLowerCase()) || session.user.permissions.includes('config.manage');
  return true;
}

export function managementFeatureState(session: BackendSession, feature: ManagementFeature): FeatureAvailability {
  if (feature.requiredPermissions?.length && !feature.requiredPermissions.some(permission => session.user.permissions.includes(permission))) return 'insufficient_permission';
  if (feature.capability && !session.tenant.capabilities.includes(feature.capability)) return 'not_enabled';
  if (feature.anyCapabilities?.length && !feature.anyCapabilities.some(capability => session.tenant.capabilities.includes(capability))) return 'not_enabled';
  return feature.availability;
}
