import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, ChefHat, ChevronDown, CircleHelp, ClipboardCheck, Clock3, Download, Hotel, LayoutDashboard, Menu, Package, Scale, Settings2, ShoppingCart, Truck, UserPlus, Users, Wifi, WifiOff, Wrench, X, CalendarDays } from 'lucide-react';
import { TenantProfile, Permission, ROLE_PERMISSIONS } from '../../types/erp';
import type { WorkspaceDefinition, WorkspaceId } from '../../types/ui';
import { storage } from '../../services/storage';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { apiClient, type BackendSession } from '../../services/apiClient';
import type {RecoverableCommand} from '../../services/commandJournal';

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
const serverRolePermissions:Record<string,string[]>={
  admin:['catalog.manage','inventory.receive','commerce.sell','commerce.refund','shift.open','shift.close','finance.view','hotel.manage','hotel.frontdesk','hotel.housekeeping'],
  owner:['catalog.manage','inventory.receive','commerce.sell','commerce.refund','shift.open','shift.close','finance.view','hotel.manage','hotel.frontdesk','hotel.housekeeping'],
  manager:['catalog.manage','inventory.receive','commerce.sell','commerce.refund','shift.open','shift.close','finance.view','hotel.manage','hotel.frontdesk','hotel.housekeeping'],
  accountant:['finance.view'],cashier:['commerce.sell','shift.open','shift.close'],storekeeper:['inventory.receive'],
  receptionist:['hotel.frontdesk','shift.open','shift.close'],housekeeper:['hotel.housekeeping'],waiter:[],cook:[],bartender:[],
};

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
  const [backendSession, setBackendSession] = useState<BackendSession | null>(apiClient.getSession());
  const [recoverableCommands,setRecoverableCommands]=useState<RecoverableCommand[]>([]);
  const [backendLoginOpen, setBackendLoginOpen] = useState(false);
  const [backendEmail, setBackendEmail] = useState('');
  const [backendPassword, setBackendPassword] = useState('');
  const [backendError, setBackendError] = useState('');
  const [backendBusy, setBackendBusy] = useState(false);
  const [, setStorageRevision] = useState(0);
  useEffect(() => storage.subscribe(() => setStorageRevision(revision => revision + 1)), []);
  useEffect(() => apiClient.subscribe(setBackendSession), []);
  useEffect(()=>{if(!backendSession){setRecoverableCommands([]);return}void apiClient.listRecoverableCommands(backendSession.tenant.id).then(setRecoverableCommands).catch(()=>setRecoverableCommands([]));return apiClient.subscribeRecovery(setRecoverableCommands)},[backendSession?.tenant.id]);
  const connectBackend = async (event: React.FormEvent) => {
    event.preventDefault(); setBackendBusy(true); setBackendError('');
    try { await apiClient.login(backendEmail,backendPassword); setBackendPassword(''); setBackendLoginOpen(false); }
    catch(error) { setBackendError(error instanceof Error ? error.message : 'Could not sign in.'); }
    finally { setBackendBusy(false); }
  };
  const isOnline = storage.isOnline();
  const pendingOutbox = storage.getOutboxCount();
  const persistenceError = storage.getPersistenceError();
  const staffUsers = storage.getStaffUsers();
  const activeStaff = storage.getActiveStaff();
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const availableWorkspaces = useMemo(() => workspaceItems.filter(item => {
    if(backendSession){
      const role=backendSession.user.role;
      const has=(...permissions:string[])=>permissions.some(permission=>serverRolePermissions[role]?.includes(permission));
      const serverAllowed:Record<WorkspaceId,boolean>={
        today:true,help:true,sell:has('commerce.sell'),sales:has('commerce.sell'),service:false,stock:has('catalog.manage','inventory.receive'),
        'stock-count':false,purchasing:has('inventory.receive'),hotel:backendSession.tenant.capabilities.includes('hospitality')&&has('hotel.frontdesk','hotel.manage','hotel.housekeeping'),reservations:backendSession.tenant.capabilities.includes('hospitality')&&has('hotel.frontdesk','hotel.manage'),customers:false,
        shifts:has('shift.open','shift.close'),money:has('finance.view'),reports:has('finance.view'),manage:['admin','owner','manager'].includes(role),onboarding:['admin','owner','manager'].includes(role),
      };
      return serverAllowed[item.id];
    }
    if (item.permission && !storage.hasPermission(item.permission as Permission)) return false;
    if (item.anyPermissions && !item.anyPermissions.some(permission => storage.hasPermission(permission))) return false;
    if (item.capability === 'hospitality' && activeTenant.capabilities && !activeTenant.capabilities.includes('hospitality')) return false;
    if (item.capability === 'hospitality' && !activeTenant.capabilities && activeTenant.type !== 'hospitality' && activeTenant.type !== 'restaurant') return false;
    if (item.capability === 'food_service' && activeTenant.capabilities && !activeTenant.capabilities.includes('food_service')) return false;
    if (item.capability === 'food_service' && !activeTenant.capabilities && activeTenant.type !== 'restaurant') return false;
    return true;
  }), [activeTenant.id, activeTenant.type, activeTenant.capabilities, activeStaff.id, activeStaff.role, backendSession?.user.id,backendSession?.user.role]);
  useEffect(()=>{if(backendSession&&!availableWorkspaces.some(item=>item.id===activeTab))onTabChange('today')},[backendSession?.user.id,activeTab,availableWorkspaces,onTabChange]);

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
      <div className="sidebar-context"><span className="context-label">{backendSession?'SERVER OUTLET':'BUSINESS'}</span><strong title={backendSession?.outlet.name ?? activeTenant.outletName ?? activeTenant.name}>{backendSession?.outlet.name ?? activeTenant.outletName ?? activeTenant.name}</strong><span>{backendSession?`${backendSession.tenant.currency} · ${backendSession.tenant.timeZone}`:`${activeTenant.currency} · ${activeTenant.timeZone ?? 'Africa/Nairobi'}`}</span></div>
      <nav className="workspace-nav">
        {groups.map(group => {
          const items = availableWorkspaces.filter(item => item.group === group.id);
          if (!items.length) return null;
          return <section key={group.id} className="nav-group"><h2>{group.label}</h2>{items.map(item => <button key={item.id} type="button" title={item.label} aria-label={item.label} className={`nav-link ${activeTab === item.id ? 'active' : ''}`} onClick={() => selectWorkspace(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}>
            <span className="nav-icon">{item.icon}</span><span className="nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
          </button>)}</section>;
        })}
      </nav>
      <div className="sidebar-footer"><span className="demo-indicator"><span />{backendSession?`Server · ${backendSession.outlet.name}`:'Local demo workspace'}</span>{storage.hasPermission('settings.view') && <button type="button" className="sidebar-tool" onClick={onOpenDiagnostics}><Wrench size={16} /> Diagnostics</button>}</div>
    </aside>

    <div className="app-main-column">
      <header className="topbar">
        <div className="topbar-context">
          <label className="tenant-select-wrap"><Building2 size={15} /><span className="sr-only">Business</span><select disabled={!!backendSession} value={activeTenant.id} onChange={event => onTenantChange(event.target.value)} aria-label="Select business">
            {tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select><ChevronDown size={13} /></label>
          <span className="topbar-divider" />
          <div className="operator-wrap"><button className="operator-button" type="button" onClick={() => setOperatorOpen(value => !value)} aria-expanded={operatorOpen}>
            <span className="operator-avatar">{activeStaff.name.slice(0, 1)}</span><span className="operator-copy"><strong>{activeStaff.name}</strong><small>{activeStaff.title} · {activeStaff.role}</small></span><ChevronDown size={14} />
          </button>{operatorOpen && <div className="operator-menu" role="menu"><span className="menu-caption">DEMO OPERATOR</span>{staffUsers.map(staff => <button role="menuitem" type="button" key={staff.id} onClick={() => changeStaff(staff.id)} className={staff.id === activeStaff.id ? 'selected' : ''}><span>{staff.name}</span><small>{staff.title} · {staff.role}</small></button>)}</div>}</div>
        </div>
        <div className="topbar-actions">
          {backendSession ? <div className="connection-pill online" title={`${backendSession.tenant.name} · ${backendSession.outlet.name}`}><Wifi size={15}/><span>Server · {backendSession.user.name}</span><button type="button" onClick={() => void apiClient.logout()} aria-label="Sign out of server">Sign out</button></div> : <button className="connection-pill offline" type="button" onClick={() => setBackendLoginOpen(true)}><WifiOff size={15}/><span>Connect backend</span></button>}
          <button className={`connection-pill ${isOnline ? 'online' : 'offline'}`} type="button" onClick={onOpenSyncCenter} aria-label={`${isOnline ? 'Local preview online' : 'Local preview offline'}${pendingOutbox ? `, ${pendingOutbox} waiting in the local preview` : ''}`}>
            {isOnline ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{isOnline ? 'Local preview online' : 'Local preview offline'}</span>{pendingOutbox > 0 && <b>{pendingOutbox}</b>}
          </button>
          {isInstallable && !isInstalled && <button type="button" className="icon-action install-action" onClick={install}><Download size={16} /><span>Install app</span></button>}
          {storage.hasPermission('settings.view') && <button type="button" className="icon-action mobile-diagnostics" onClick={onOpenDiagnostics} aria-label="Open diagnostics"><Wrench size={16} /></button>}
        </div>
      </header>
      <main className="workspace-content" id="main-content" tabIndex={-1}>
        {persistenceError && <div role="alert" className="persistence-error-banner"><strong>Local save failed.</strong> {persistenceError}</div>}
        {backendSession&&['today','manage','onboarding','help'].includes(activeTab)&&<div role="status" className="persistence-error-banner"><strong>Local preview workspace.</strong> This screen is not connected to the signed-in server account.</div>}
        {backendSession&&recoverableCommands.length>0&&<div role="alert" className="persistence-error-banner"><strong>{recoverableCommands.length} server command{recoverableCommands.length===1?'':'s'} need status review.</strong> The exact command is safely retained on this device. <button type="button" className="ml-2 underline" onClick={()=>{const type=recoverableCommands[0].command.type;onTabChange(type==='sales.order.settle'||type==='sales.order.refund'?'sales':type==='inventory.receive'?'purchasing':type==='catalog.product.create'?'stock':'shifts')}}>Open recovery workspace</button></div>}
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
      {backendLoginOpen && <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="presentation"><form onSubmit={connectBackend} className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl" aria-labelledby="backend-login-title"><h2 id="backend-login-title" className="text-xl font-semibold">Connect to Mazao server</h2><p className="mt-2 text-sm text-zinc-400">Use your assigned operator account. Demo data remains local until you sign in.</p><label className="mt-5 block text-sm text-zinc-300">Email<input required type="email" autoComplete="username" value={backendEmail} onChange={e=>setBackendEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-white"/></label><label className="mt-3 block text-sm text-zinc-300">Password<input required type="password" autoComplete="current-password" value={backendPassword} onChange={e=>setBackendPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-white"/></label>{backendError&&<p role="alert" className="mt-3 text-sm text-rose-300">{backendError}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>{setBackendLoginOpen(false);setBackendError('')}} className="rounded-lg border border-zinc-700 px-4 py-2.5">Cancel</button><button disabled={backendBusy} className="rounded-lg bg-blue-600 px-4 py-2.5 font-semibold disabled:opacity-50">{backendBusy?'Connecting…':'Sign in'}</button></div></form></div>}
    </div>
  </div>;
};
