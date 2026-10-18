import type { BackendSession } from '../services/apiClient';
import type { WorkspaceId } from '../types/ui';

export type FeatureAvailability = 'connected' | 'partial' | 'not_connected' | 'not_enabled' | 'insufficient_permission';
type Discoverability = 'all' | 'authorized' | 'admin';

export interface WorkspaceFeature {
  id: WorkspaceId;
  label: string;
  description: string;
  group: 'work' | 'money' | 'manage' | 'support';
  capability?: string;
  anyPermissions?: string[];
  discoverability: Discoverability;
  availability: FeatureAvailability;
}

export const workspaceFeatures: WorkspaceFeature[] = [
  { id: 'today', label: 'Today', description: 'Your shift at a glance', group: 'work', discoverability: 'all', availability: 'connected' },
  { id: 'sell', label: 'Sell', description: 'Take payment and serve guests', group: 'work', capability: 'commerce', anyPermissions: ['commerce.sell'], discoverability: 'authorized', availability: 'connected' },
  { id: 'sales', label: 'Sales history', description: 'Find receipts and returns', group: 'work', anyPermissions: ['commerce.sell', 'commerce.refund', 'finance.view'], discoverability: 'authorized', availability: 'connected' },
  { id: 'service', label: 'Tables & kitchen', description: 'Restaurant orders and kitchen preparation are unavailable', group: 'work', capability: 'hospitality', discoverability: 'all', availability: 'not_connected' },
  { id: 'stock', label: 'Stock', description: 'Items, movements and counts', group: 'work', capability: 'inventory', anyPermissions: ['catalog.manage', 'inventory.receive'], discoverability: 'authorized', availability: 'connected' },
  { id: 'stock-count', label: 'Count stock', description: 'Scan and review a count', group: 'work', capability: 'inventory', anyPermissions: ['inventory.count', 'inventory.count.approve'], discoverability: 'authorized', availability: 'connected' },
  { id: 'purchasing', label: 'Purchasing', description: 'Suppliers and deliveries', group: 'work', capability: 'inventory', anyPermissions: ['inventory.receive'], discoverability: 'authorized', availability: 'partial' },
  { id: 'hotel', label: 'Hotel', description: 'Rooms and guest bills', group: 'work', capability: 'hospitality', anyPermissions: ['hotel.frontdesk', 'hotel.manage', 'hotel.housekeeping'], discoverability: 'authorized', availability: 'partial' },
  { id: 'reservations', label: 'Reservations', description: 'Check dates and room options', group: 'work', capability: 'hospitality', anyPermissions: ['hotel.frontdesk', 'hotel.manage'], discoverability: 'authorized', availability: 'partial' },
  { id: 'customers', label: 'Customers', description: 'Accounts and repayments', group: 'work', capability: 'commerce', anyPermissions: ['customers.view'], discoverability: 'authorized', availability: 'connected' },
  { id: 'shifts', label: 'Shifts', description: 'Till opening and cash-up', group: 'money', capability: 'commerce', anyPermissions: ['shift.open', 'shift.close'], discoverability: 'authorized', availability: 'connected' },
  { id: 'money', label: 'Money', description: 'Ledger and balances', group: 'money', anyPermissions: ['finance.view'], discoverability: 'authorized', availability: 'partial' },
  { id: 'reports', label: 'Reports', description: 'Sales and operating reports', group: 'money', anyPermissions: ['finance.view'], discoverability: 'authorized', availability: 'partial' },
  { id: 'manage', label: 'Manage', description: 'Business setup and access', group: 'manage', anyPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', availability: 'connected' },
  { id: 'onboarding', label: 'Setup checklist', description: 'First-sale readiness checks', group: 'manage', anyPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', availability: 'partial' },
  { id: 'help', label: 'Help', description: 'Guides and recovery steps', group: 'support', discoverability: 'all', availability: 'connected' },
];

export type ManagementFeatureId = 'business' | 'staff' | 'permissions' | 'devices' | 'imports' | 'assets' | 'suppliers' | 'offline' | 'payments' | 'capabilities' | 'readiness' | 'outlet';
export interface ManagementFeature {
  id: ManagementFeatureId;
  title: string;
  description: string;
  status: string;
  availability: FeatureAvailability;
  capability?: string;
  requiredPermissions?: string[];
  discoverability: Discoverability;
  route?: WorkspaceId;
  section?: 'business' | 'outlet' | 'capabilities' | 'readiness' | 'permissions' | 'staff' | 'devices';
  explanation: string;
}

export const managementFeatures: ManagementFeature[] = [
  { id: 'business', title: 'Business and outlets', description: 'Business details and current outlet settings', status: 'Limited', availability: 'partial', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'business', explanation: 'Manage business details and the current outlet. Adding and switching outlets is unavailable here.' },
  { id: 'staff', title: 'Staff', description: 'Staff accounts and business access', status: 'Available', availability: 'connected', requiredPermissions: ['staff.view'], discoverability: 'authorized', section: 'staff', explanation: 'Set up staff accounts, choose available roles and review sign-ins. Individual role permissions cannot be edited here.' },
  { id: 'permissions', title: 'Roles and permissions', description: 'Staff role access', status: 'Unavailable', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', explanation: 'Review available roles under Staff. Individual role permissions cannot be edited here.' },
  { id: 'devices', title: 'Workspace assignments', description: 'Assign staff to outlets', status: 'Available', availability: 'connected', requiredPermissions: ['devices.view'], discoverability: 'authorized', section: 'devices', explanation: 'Assign staff to outlets and review access changes. Printer setup is unavailable here.' },
  { id: 'imports', title: 'Data import', description: 'Review and import stock CSV files', status: 'Available', availability: 'connected', capability: 'inventory', requiredPermissions: ['catalog.manage'], discoverability: 'authorized', route: 'stock', explanation: 'Review product CSV imports from Stock. Spreadsheet workbooks, packages and variants are unavailable.' },
  { id: 'assets', title: 'Assets and maintenance', description: 'Equipment, custody and repairs', status: 'Unavailable', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'admin', explanation: 'Equipment records and maintenance tracking are unavailable.' },
  { id: 'suppliers', title: 'Supplier accounts and payables', description: 'Supplier balances, bills and payments', status: 'Unavailable', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'admin', explanation: 'Supplier accounts and payables are unavailable. Purchasing supports stock delivery receiving.' },
  { id: 'offline', title: 'Connection and recovery', description: 'Connection needed to complete sales', status: 'Unavailable', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'admin', explanation: 'Sales require a connection. Unfinished actions remain available for status review.' },
  { id: 'payments', title: 'Payment reconciliation', description: 'Automatic payment confirmation and reconciliation', status: 'Unavailable', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'admin', explanation: 'Automatic payment confirmation is unavailable. Cashier-confirmed M-Pesa is available during a sale.' },
  { id: 'capabilities', title: 'Business capabilities', description: 'Services enabled for this business', status: 'Available', availability: 'connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'capabilities', explanation: 'Choose the services this business uses.' },
  { id: 'readiness', title: 'Setup checklist', description: 'First-sale setup checks', status: 'Limited', availability: 'partial', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'readiness', explanation: 'Review the setup needed for a first sale. Complete your wider business checks separately.' },
  { id: 'outlet', title: 'Outlet and receipts', description: 'Current outlet details and receipt text', status: 'Available', availability: 'connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'outlet', explanation: 'Manage outlet contact details, receipt text, the business logo and optional payment QR image.' },
];

export function featureState(session: BackendSession, feature: Pick<WorkspaceFeature, 'capability' | 'anyPermissions' | 'availability'>): FeatureAvailability {
  if (feature.anyPermissions?.length && !feature.anyPermissions.some(permission => session.user.permissions.includes(permission))) return 'insufficient_permission';
  if (feature.capability && !session.tenant.capabilities.includes(feature.capability)) return 'not_enabled';
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
  return feature.availability;
}
