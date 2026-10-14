import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, ChefHat, CircleHelp, ClipboardCheck, Clock3, Download, Hotel, LayoutDashboard, Menu, Package, Scale, Settings2, ShoppingCart, Truck, Users, Wifi, WifiOff, X, CalendarDays } from 'lucide-react';
import type { WorkspaceDefinition, WorkspaceId } from '../../types/ui';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { apiClient, type BackendSession } from '../../services/apiClient';
import type { RecoverableCommand } from '../../services/commandJournal';
import type { ImportValidationRecovery } from '../../services/importValidationJournal';

export type ActiveTab=WorkspaceId;
const workspaceItems:Array<WorkspaceDefinition&{icon:React.ReactNode}>=[
  {id:'today',label:'Today',description:'Your shift at a glance',group:'work',icon:<LayoutDashboard/>},
  {id:'sell',label:'Sell',description:'Take payment and serve guests',group:'work',icon:<ShoppingCart/>},
  {id:'sales',label:'Sales history',description:'Find receipts and returns',group:'work',icon:<Clock3/>},
  {id:'service',label:'Tables & kitchen',description:'Orders, tabs and preparation',group:'work',icon:<ChefHat/>},
  {id:'stock',label:'Stock',description:'Items, movements and counts',group:'work',icon:<Package/>},
  {id:'stock-count',label:'Count stock',description:'Scan and review a count',group:'work',icon:<ClipboardCheck/>},
  {id:'purchasing',label:'Purchasing',description:'Suppliers and deliveries',group:'work',icon:<Truck/>},
  {id:'hotel',label:'Hotel',description:'Rooms and guest bills',group:'work',icon:<Hotel/>},
  {id:'reservations',label:'Reservations',description:'Check dates and room options',group:'work',icon:<CalendarDays/>},
  {id:'customers',label:'Customers',description:'Accounts and repayments',group:'work',icon:<Users/>},
  {id:'shifts',label:'Shifts',description:'Till opening and cash-up',group:'money',icon:<Clock3/>},
  {id:'money',label:'Money',description:'Ledger and balances',group:'money',icon:<Scale/>},
  {id:'reports',label:'Reports',description:'Sales and operating reports',group:'money',icon:<BarChart3/>},
  {id:'manage',label:'Manage',description:'Business setup and access',group:'manage',icon:<Settings2/>},
  {id:'help',label:'Help',description:'Guides and recovery steps',group:'support',icon:<CircleHelp/>},
];
const groups=[{id:'work',label:'WORK'},{id:'money',label:'MONEY'},{id:'manage',label:'MANAGE'},{id:'support',label:'SUPPORT'}] as const;

export function canOpenWorkspace(session:BackendSession,workspace:WorkspaceId):boolean {
  const has=(...permissions:string[])=>permissions.some(permission=>session.user.permissions.includes(permission));
  const enabled=(capability:string)=>session.tenant.capabilities.includes(capability);
  const allowed:Record<WorkspaceId,boolean>={
    today:true,help:true,sell:enabled('commerce')&&has('commerce.sell'),sales:has('commerce.sell','commerce.refund','finance.view'),
    service:false,stock:enabled('inventory')&&has('catalog.manage','inventory.receive'),
    'stock-count':enabled('inventory')&&has('inventory.count','inventory.count.approve'),purchasing:enabled('inventory')&&has('inventory.receive'),
    hotel:enabled('hospitality')&&has('hotel.frontdesk','hotel.manage','hotel.housekeeping'),
    reservations:enabled('hospitality')&&has('hotel.frontdesk','hotel.manage'),
    customers:enabled('commerce')&&has('customers.view'),shifts:enabled('commerce')&&has('shift.open','shift.close'),
    money:has('finance.view'),reports:has('finance.view'),manage:has('config.view','config.manage'),onboarding:false,
  };
  return allowed[workspace];
}

export function AppShell({activeTab,onTabChange,children}:{activeTab:ActiveTab;onTabChange:(tab:ActiveTab)=>void;children:React.ReactNode}) {
  const [moreOpen,setMoreOpen]=useState(false);
  const [session,setSession]=useState(apiClient.getSession());
  const [online,setOnline]=useState(navigator.onLine);
  const [recoverableCommands,setRecoverableCommands]=useState<RecoverableCommand[]>([]);
  const [importRecoveries,setImportRecoveries]=useState<ImportValidationRecovery[]>([]);
  const [logoutError,setLogoutError]=useState('');
  const {isInstallable,isInstalled,install}=usePWAInstall();
  useEffect(()=>apiClient.subscribe(setSession),[]);
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine);
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);
  useEffect(()=>{
    if(!session){setRecoverableCommands([]);return;}
    void apiClient.listRecoverableCommands(session.tenant.id).then(setRecoverableCommands).catch(()=>setRecoverableCommands([]));
    return apiClient.subscribeRecovery(setRecoverableCommands);
  },[session?.tenant.id]);
  useEffect(()=>{
    if(!session){setImportRecoveries([]);return;}
    void apiClient.listImportValidationRecovery().then(setImportRecoveries).catch(()=>setImportRecoveries([]));
    return apiClient.subscribeImportRecovery(setImportRecoveries);
  },[session?.tenant.id,session?.user.id,session?.deviceId]);
  const available=useMemo(()=>session?workspaceItems.filter(item=>canOpenWorkspace(session,item.id)):[],[session]);
  useEffect(()=>{if(session&&!available.some(item=>item.id===activeTab))onTabChange('today');},[session,activeTab,available,onTabChange]);
  if(!session)return null;
  const selectWorkspace=(id:WorkspaceId)=>{
    if(!canOpenWorkspace(session,id))return;
    if(id!==activeTab&&!window.dispatchEvent(new Event('mazao:before-navigate',{cancelable:true})))return;
    onTabChange(id);setMoreOpen(false);
  };
  const signOut=async()=>{
    if(!window.dispatchEvent(new Event('mazao:before-navigate',{cancelable:true})))return;
    setLogoutError('');try{await apiClient.logout();}catch(cause){setLogoutError(cause instanceof Error?cause.message:'Sign-out could not be confirmed.');}
  };
  const openRecovery=()=>{
    if(importRecoveries.length){selectWorkspace('stock');return;}
    const type=recoverableCommands[0]?.command.type??'';
    const destination:WorkspaceId=type.startsWith('configuration.')?'manage':type.startsWith('inventory.count.')?'stock-count':type.startsWith('customers.')?'customers':type.startsWith('hotel.')?'hotel':type==='sales.order.settle'||type==='sales.order.refund'?'sales':type==='inventory.receive'?'purchasing':type.startsWith('catalog.')?'stock':'shifts';
    selectWorkspace(destination);
  };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="workspace-sidebar" aria-label="Main navigation">
      <div className="brand-lockup"><div className="brand-mark">M</div><div><strong>Mazao</strong><small>BUSINESS WORKSPACE</small></div></div>
      <div className="sidebar-context"><span className="context-label">OUTLET</span><strong title={session.outlet.name}>{session.outlet.name}</strong><span>{session.tenant.currency} · {session.tenant.timeZone}</span></div>
      <nav className="workspace-nav">{groups.map(group=>{const items=available.filter(item=>item.group===group.id);return items.length?<section key={group.id} className="nav-group"><h2>{group.label}</h2>{items.map(item=><button key={item.id} type="button" title={item.label} aria-label={item.label} className={'nav-link '+(activeTab===item.id?'active':'')} onClick={()=>selectWorkspace(item.id)} aria-current={activeTab===item.id?'page':undefined}><span className="nav-icon">{item.icon}</span><span className="nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span></button>)}</section>:null;})}</nav>
      <div className="sidebar-footer"><span className="demo-indicator"><span/>Server · {session.outlet.name}</span></div>
    </aside>
    <div className="app-main-column">
      <header className="topbar"><div className="topbar-context"><div className="operator-button" aria-label={'Signed in as '+session.user.name}><span className="operator-avatar">{session.user.name.slice(0,1)}</span><span className="operator-copy"><strong>{session.tenant.name}</strong><small>{session.outlet.name} · {session.user.name} · {session.user.role}</small></span></div></div><div className="topbar-actions"><div className={'connection-pill '+(online?'online':'offline')} title={online?'Server connection available':'Offline: server actions require a connection'}>{online?<Wifi size={15}/>:<WifiOff size={15}/>}<span>{online?'Server account':'Offline'}</span><button className="min-h-11" type="button" onClick={()=>void signOut()} aria-label="Sign out of server">Sign out</button></div>{isInstallable&&!isInstalled&&<button type="button" className="icon-action install-action" onClick={install}><Download size={16}/><span>Install app</span></button>}</div></header>
      <main className="workspace-content" id="main-content" tabIndex={-1}>
        {!online&&<div role="status" className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">You are offline. Server actions require a connection. Unconfirmed commands remain available for status review.</div>}
        {logoutError&&<div role="alert" className="persistence-error-banner"><strong>Server sign-out was not confirmed.</strong> {logoutError}</div>}
        {recoverableCommands.length+importRecoveries.length>0&&<div role="alert" className="persistence-error-banner"><strong>{recoverableCommands.length+importRecoveries.length} server command{recoverableCommands.length+importRecoveries.length===1?'':'s'} need status review.</strong> Command IDs and recovery evidence are retained on this device. <button type="button" className="ml-2 min-h-11 underline" onClick={openRecovery}>Open recovery workspace</button></div>}
        <div className="workspace-interaction-boundary">{children}</div>
      </main>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">{(['today','sell','stock'] as WorkspaceId[]).map(id=>{const item=available.find(entry=>entry.id===id);return item?<button type="button" key={id} className={activeTab===id?'active':''} onClick={()=>selectWorkspace(id)} aria-current={activeTab===id?'page':undefined}>{item.icon}<span>{item.label}</span></button>:null;})}<button type="button" className={moreOpen?'active':''} onClick={()=>setMoreOpen(value=>!value)} aria-expanded={moreOpen}><Menu/><span>More</span></button></nav>
      {moreOpen&&<div className="mobile-more-panel"><div className="mobile-more-head"><strong>All workspaces</strong><button type="button" className="min-h-11 min-w-11" onClick={()=>setMoreOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>{available.filter(item=>!['today','sell','stock'].includes(item.id)).map(item=><button type="button" key={item.id} onClick={()=>selectWorkspace(item.id)} className={activeTab===item.id?'active':''}>{item.icon}<span>{item.label}</span></button>)}</div>}
    </div>
  </div>;
}
