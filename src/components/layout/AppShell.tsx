import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, ChefHat, ChevronDown, CircleHelp, ClipboardCheck, Clock3, Download, Hotel, LayoutDashboard, Menu, Package, Scale, Settings2, ShoppingCart, Truck, UserPlus, Users, Wifi, WifiOff, Wrench, X, CalendarDays } from 'lucide-react';
import { TenantProfile, Permission, ROLE_PERMISSIONS } from '../../types/erp';
import type { WorkspaceDefinition, WorkspaceId } from '../../types/ui';
import { storage } from '../../services/storage';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export type ActiveTab = WorkspaceId;

const workspaceItems: Array<WorkspaceDefinition & { icon: React.ReactNode }> = [
  { id: 'today', label: 'Today', description: 'Your shift at a glance', group: 'work', icon: <LayoutDashboard /> },
  { id: 'sell', label: 'Sell', description: 'Take payment and serve guests', permission: 'pos.sell', group: 'work', icon: <ShoppingCart /> },
  { id: 'sales', label: 'Sales history', description: 'Find receipts and returns', permission: 'sales.history', group: 'work', icon: <Clock3 /> },
  { id: 'service', label: 'Tables & kitchen', description: 'Orders, tabs and preparation', anyPermissions: ['pos.sell', 'kitchen.work'], capability: 'food_service', group: 'work', icon: <ChefHat /> },
  { id: 'stock', label: 'Stock', description: 'Items, movements and counts', permission: 'inventory.adjust', group: 'work', icon: <Package /> },
  { id: 'stock-count', label: 'Count stock', description: 'Scan and review a count', permission: 'inventory.adjust', group: 'work', icon: <ClipboardCheck /> },
  { id: 'purchasing', label: 'Purchasing', description: 'Suppliers and deliveries', permission: 'procurement.manage', group: 'work', icon: <Truck /> },
  { id: 'hotel', label: 'Hotel', description: 'Rooms and guest bills', anyPermissions: ['rooms.checkin', 'rooms.checkout', 'hotel.housekeeping'], capability: 'hospitality', group: 'work', icon: <Hotel /> },
  { id: 'reservations', label: 'Reservations', description: 'Check dates and room options', permission: 'rooms.checkin', capability: 'hospitality', group: 'work', icon: <CalendarDays /> },
  { id: 'customers', label: 'Customers', description: 'Accounts and repayments', permission: 'customers.view', group: 'work', icon: <Users /> },
  { id: 'shifts', label: 'Shifts', description: 'Till opening and cash-up', permission: 'shift.open', group: 'money', icon: <Clock3 /> },
  { id: 'money', label: 'Money', description: 'Ledger and balances', permission: 'ledger.view', group: 'money', icon: <Scale /> },
  { id: 'reports', label: 'Reports', description: 'Sales and operating reports', permission: 'analytics.view', group: 'money', icon: <BarChart3 /> },
  { id: 'manage', label: 'Manage', description: 'Business setup and access', permission: 'settings.view', group: 'manage', icon: <Settings2 /> },
  { id: 'onboarding', label: 'Setup checklist', description: 'Prepare an outlet for go-live', permission: 'settings.manage', group: 'manage', icon: <UserPlus /> },
  { id: 'help', label: 'Help', description: 'Guides and recovery steps', group: 'support', icon: <CircleHelp /> },
];

const groups = [
  { id: 'work', label: 'WORK' },
  { id: 'money', label: 'MONEY' },
  { id: 'manage', label: 'MANAGE' },
  { id: 'support', label: 'SUPPORT' },
] as const;

interface AppShellProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  activeTenant: TenantProfile;
  tenants: TenantProfile[];
  onTenantChange: (tenantId: string) => void;
  onOpenSyncCenter: () => void;
  onOpenDiagnostics: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ activeTab, onTabChange, activeTenant, tenants, onTenantChange, onOpenSyncCenter, onOpenDiagnostics, children }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [, setStorageRevision] = useState(0);
  useEffect(() => storage.subscribe(() => setStorageRevision(revision => revision + 1)), []);
  const isOnline = storage.isOnline();
  const pendingOutbox = storage.getOutboxCount();
  const persistenceError = storage.getPersistenceError();
  const staffUsers = storage.getStaffUsers();
  const activeStaff = storage.getActiveStaff();
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const availableWorkspaces = useMemo(() => workspaceItems.filter(item => {
    if (item.permission && !storage.hasPermission(item.permission as Permission)) return false;
    if (item.anyPermissions && !item.anyPermissions.some(permission => storage.hasPermission(permission))) return false;
    if (item.capability === 'hospitality' && activeTenant.capabilities && !activeTenant.capabilities.includes('hospitality')) return false;
    if (item.capability === 'hospitality' && !activeTenant.capabilities && activeTenant.type !== 'hospitality' && activeTenant.type !== 'restaurant') return false;
    if (item.capability === 'food_service' && activeTenant.capabilities && !activeTenant.capabilities.includes('food_service')) return false;
    if (item.capability === 'food_service' && !activeTenant.capabilities && activeTenant.type !== 'restaurant') return false;
    return true;
  }), [activeTenant.id, activeTenant.type, activeTenant.capabilities, activeStaff.id, activeStaff.role]);

  const changeStaff = (staffId: string) => {
    storage.switchStaff(staffId);
    setOperatorOpen(false);
    const route = workspaceItems.find(item => item.id === activeTab);
    const nextStaff = staffUsers.find(staff => staff.id === staffId);
    const permissions = nextStaff ? ROLE_PERMISSIONS[nextStaff.role] : [];
    const allowedByRole = !route?.permission || permissions.includes(route.permission as Permission);
    const allowedByAnyRole = !route?.anyPermissions || route.anyPermissions.some(permission => permissions.includes(permission));
    const allowedByCapability = route?.capability === 'hospitality'
      ? activeTenant.capabilities?.includes('hospitality') ?? ['hospitality', 'restaurant'].includes(activeTenant.type)
      : route?.capability === 'food_service'
        ? activeTenant.capabilities?.includes('food_service') ?? activeTenant.type === 'restaurant'
        : true;
    if (!route || !allowedByRole || !allowedByAnyRole || !allowedByCapability) onTabChange('today');
  };
  const selectWorkspace = (id: WorkspaceId) => { onTabChange(id); setMoreOpen(false); };

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="workspace-sidebar" aria-label="Main navigation">
      <div className="brand-lockup"><div className="brand-mark">M</div><div><strong>Mazao</strong><small>BUSINESS WORKSPACE</small></div></div>
      <div className="sidebar-context"><span className="context-label">BUSINESS</span><strong title={activeTenant.outletName ?? activeTenant.name}>{activeTenant.outletName ?? activeTenant.name}</strong><span>{activeTenant.currency} · {activeTenant.timeZone ?? 'Africa/Nairobi'}</span></div>
      <nav className="workspace-nav">
        {groups.map(group => {
          const items = availableWorkspaces.filter(item => item.group === group.id);
          if (!items.length) return null;
          return <section key={group.id} className="nav-group"><h2>{group.label}</h2>{items.map(item => <button key={item.id} type="button" title={item.label} aria-label={item.label} className={`nav-link ${activeTab === item.id ? 'active' : ''}`} onClick={() => selectWorkspace(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}>
            <span className="nav-icon">{item.icon}</span><span className="nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
          </button>)}</section>;
        })}
      </nav>
      <div className="sidebar-footer"><span className="demo-indicator"><span />Local demo workspace</span>{storage.hasPermission('settings.view') && <button type="button" className="sidebar-tool" onClick={onOpenDiagnostics}><Wrench size={16} /> Diagnostics</button>}</div>
    </aside>

    <div className="app-main-column">
      <header className="topbar">
        <div className="topbar-context">
          <label className="tenant-select-wrap"><Building2 size={15} /><span className="sr-only">Business</span><select value={activeTenant.id} onChange={event => onTenantChange(event.target.value)} aria-label="Select business">
            {tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select><ChevronDown size={13} /></label>
          <span className="topbar-divider" />
          <div className="operator-wrap"><button className="operator-button" type="button" onClick={() => setOperatorOpen(value => !value)} aria-expanded={operatorOpen}>
            <span className="operator-avatar">{activeStaff.name.slice(0, 1)}</span><span className="operator-copy"><strong>{activeStaff.name}</strong><small>{activeStaff.title} · {activeStaff.role}</small></span><ChevronDown size={14} />
          </button>{operatorOpen && <div className="operator-menu" role="menu"><span className="menu-caption">DEMO OPERATOR</span>{staffUsers.map(staff => <button role="menuitem" type="button" key={staff.id} onClick={() => changeStaff(staff.id)} className={staff.id === activeStaff.id ? 'selected' : ''}><span>{staff.name}</span><small>{staff.title} · {staff.role}</small></button>)}</div>}</div>
        </div>
        <div className="topbar-actions">
          <button className={`connection-pill ${isOnline ? 'online' : 'offline'}`} type="button" onClick={onOpenSyncCenter} aria-label={`${isOnline ? 'Demo online' : 'Demo offline'}${pendingOutbox ? `, ${pendingOutbox} waiting to sync in the local preview` : ''}`}>
            {isOnline ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{isOnline ? 'Demo online' : 'Demo offline'}</span>{pendingOutbox > 0 && <b>{pendingOutbox}</b>}
          </button>
          {isInstallable && !isInstalled && <button type="button" className="icon-action install-action" onClick={install}><Download size={16} /><span>Install app</span></button>}
          {storage.hasPermission('settings.view') && <button type="button" className="icon-action mobile-diagnostics" onClick={onOpenDiagnostics} aria-label="Open diagnostics"><Wrench size={16} /></button>}
        </div>
      </header>
      <main className="workspace-content" id="main-content" tabIndex={-1}>
        {persistenceError && <div role="alert" className="persistence-error-banner"><strong>Local save failed.</strong> {persistenceError}</div>}
        <div className="workspace-interaction-boundary" inert={persistenceError ? true : undefined}>{children}</div>
      </main>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {(['today', 'sell', 'stock'] as WorkspaceId[]).map(id => {
          const item = workspaceItems.find(entry => entry.id === id)!;
          if (!availableWorkspaces.some(entry => entry.id === id)) return null;
          return <button type="button" key={id} className={activeTab === id ? 'active' : ''} onClick={() => selectWorkspace(id)} aria-current={activeTab === id ? 'page' : undefined}>{item.icon}<span>{item.label}</span></button>;
        })}
        <button type="button" className={moreOpen ? 'active' : ''} onClick={() => setMoreOpen(value => !value)} aria-expanded={moreOpen}><Menu /><span>More</span></button>
      </nav>
      {moreOpen && <div className="mobile-more-panel"><div className="mobile-more-head"><strong>All workspaces</strong><button type="button" onClick={() => setMoreOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>{availableWorkspaces.filter(item => !['today', 'sell', 'stock'].includes(item.id)).map(item => <button type="button" key={item.id} onClick={() => selectWorkspace(item.id)} className={activeTab === item.id ? 'active' : ''}>{item.icon}<span>{item.label}</span></button>)}</div>}
    </div>
  </div>;
};
