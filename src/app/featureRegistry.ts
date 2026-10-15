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
  { id: 'service', label: 'Tables & kitchen', description: 'Restaurant orders and preparation are not connected yet', group: 'work', capability: 'hospitality', discoverability: 'all', availability: 'not_connected' },
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

export type ManagementFeatureId = 'business' | 'staff' | 'permissions' | 'devices' | 'imports' | 'assets' | 'capabilities' | 'readiness' | 'outlet';
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
  section?: 'business' | 'outlet' | 'capabilities' | 'readiness' | 'permissions';
  explanation: string;
}

export const managementFeatures: ManagementFeature[] = [
  { id: 'business', title: 'Business and outlets', description: 'Business identity and current outlet settings', status: 'Partial', availability: 'partial', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'business', explanation: 'Business profile and the current outlet are connected. Additional outlet creation and switching are not connected.' },
  { id: 'staff', title: 'Staff', description: 'Operator profiles and staff access', status: 'Not connected', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'admin', explanation: 'Staff records and create, edit, and suspend actions are unavailable until the server provides authorized staff commands.' },
  { id: 'permissions', title: 'Roles and permissions', description: 'Role access and permission administration', status: 'Not connected', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', explanation: 'Role grant editing is not connected. This card cannot inspect or change another operator’s access.' },
  { id: 'devices', title: 'Devices and printing', description: 'Device enrollment and printer setup', status: 'Not connected', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'admin', explanation: 'This browser can use its print dialog. Device enrollment, revocation, and paired-printer confirmation are not connected.' },
  { id: 'imports', title: 'Data import', description: 'Review and import stock CSV files', status: 'Connected · CSV', availability: 'connected', capability: 'inventory', requiredPermissions: ['catalog.manage'], discoverability: 'authorized', route: 'stock', explanation: 'Reviewed product CSV import is available from Stock. XLSX, packages, and variants are not connected.' },
  { id: 'assets', title: 'Assets and maintenance', description: 'Equipment, custody, and repair', status: 'Not connected', availability: 'not_connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'admin', explanation: 'Asset records and maintenance workflows are not connected. No sample asset data is shown.' },
  { id: 'capabilities', title: 'Business capabilities', description: 'Services enabled for this business', status: 'Connected', availability: 'connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'capabilities', explanation: 'Supported business capabilities are read from and saved through server configuration.' },
  { id: 'readiness', title: 'Setup checklist', description: 'First-sale setup readiness', status: 'Connected · limited', availability: 'partial', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'readiness', explanation: 'The server provides first-sale checks. Broader operational sign-off is not connected.' },
  { id: 'outlet', title: 'Outlet and receipts', description: 'Current outlet details and receipt text', status: 'Connected', availability: 'connected', requiredPermissions: ['config.view', 'config.manage'], discoverability: 'authorized', section: 'outlet', explanation: 'Current outlet contact and receipt text are server-backed. Logo upload and payment QR integrations are not connected.' },
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
