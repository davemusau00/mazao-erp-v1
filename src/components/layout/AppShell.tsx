import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, BarChart3, ChefHat, CircleHelp, ClipboardCheck, Clock3, Download, Hotel, LayoutDashboard, Menu, Package, Scale, Settings2, ShoppingCart, Truck, Users, Wifi, WifiOff, X, CalendarDays, PackageSearch } from 'lucide-react';
import type { WorkspaceId } from '../../types/ui';
import { featureState, workspaceFeatures } from '../../app/featureRegistry';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { apiClient, type BackendAssignmentChoice, type BackendContextSwitchBlockers, type BackendSession } from '../../services/apiClient';
import type { RecoverableCommand } from '../../services/commandJournal';
import type { ImportValidationRecovery } from '../../services/importValidationJournal';
import { MyAccountDialog } from '../auth/MyAccountDialog';
import { actionStatusLabel, operationLabel, roleLabel } from '../../utils/presentation';

export type ActiveTab=WorkspaceId;
const workspaceIcons:Record<WorkspaceId,React.ReactNode>={today:<LayoutDashboard/>,sell:<ShoppingCart/>,sales:<Clock3/>,service:<ChefHat/>,catalog:<Package/>,stock:<Package/>,'stock-count':<ClipboardCheck/>,'stock-exceptions':<PackageSearch/>,purchasing:<Truck/>,hotel:<Hotel/>,reservations:<CalendarDays/>,customers:<Users/>,shifts:<Clock3/>,money:<Scale/>,reports:<BarChart3/>,manage:<Settings2/>,onboarding:<ClipboardCheck/>,help:<CircleHelp/>};
const workspaceItems=workspaceFeatures.map(feature=>({...feature,icon:workspaceIcons[feature.id]}));
const groups=[{id:'work',label:'WORK'},{id:'money',label:'MONEY'},{id:'manage',label:'MANAGE'},{id:'support',label:'SUPPORT'}] as const;
const setupWorkspaces=new Set<WorkspaceId>(['onboarding','manage','catalog','stock','stock-count','service','help']);

export function canOpenWorkspace(session:BackendSession,workspace:WorkspaceId):boolean {
  if(session.onboardingStatus==='SETUP'&&!setupWorkspaces.has(workspace))return false;
  const feature=workspaceFeatures.find(item=>item.id===workspace);
  return Boolean(feature&&['connected','partial'].includes(featureState(session,feature)));
}

export function AppShell({activeTab,onTabChange,children}:{activeTab:ActiveTab;onTabChange:(tab:ActiveTab)=>void;children:React.ReactNode}) {
  const [moreOpen,setMoreOpen]=useState(false);
  const [session,setSession]=useState(apiClient.getSession());
  const [online,setOnline]=useState(navigator.onLine);
  const [recoverableCommands,setRecoverableCommands]=useState<RecoverableCommand[]>([]);
  const [importRecoveries,setImportRecoveries]=useState<ImportValidationRecovery[]>([]);
  const [logoutError,setLogoutError]=useState('');
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [accountOpen,setAccountOpen]=useState(false);
  const [contextSwitchOpen,setContextSwitchOpen]=useState(false);
  const [contextAssignments,setContextAssignments]=useState<BackendAssignmentChoice[]>([]);
  const [contextBlockers,setContextBlockers]=useState<BackendContextSwitchBlockers|null>(null);
  const [contextLoading,setContextLoading]=useState(false);
  const [contextBusy,setContextBusy]=useState(false);
  const [contextError,setContextError]=useState('');
  const [checkingCommand,setCheckingCommand]=useState('');
  const [recoveryMessages,setRecoveryMessages]=useState<Record<string,string>>({});
  const [lastRecoveryResult,setLastRecoveryResult]=useState<{commandId:string;status:string;message:string}|null>(null);
  const [slowRequests,setSlowRequests]=useState<Map<string,string>>(()=>new Map());
  const [requestFailures,setRequestFailures]=useState<Array<{requestId:string;route:string;code:string;status?:number;durationMs:number}>>([]);
  const [copiedRequestId,setCopiedRequestId]=useState('');
  const {isInstallable,isInstalled,install}=usePWAInstall();
  useEffect(()=>apiClient.subscribe(setSession),[]);
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine);
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);
  useEffect(()=>{
    const slow=(event:Event)=>{const detail=(event as CustomEvent<{requestId:string;route:string}>).detail;if(detail?.requestId)setSlowRequests(previous=>new Map(previous).set(detail.requestId,detail.route));};
    const finished=(event:Event)=>{const detail=(event as CustomEvent<{requestId:string}>).detail;if(detail?.requestId)setSlowRequests(previous=>{const next=new Map(previous);next.delete(detail.requestId);return next;});};
    const failed=(event:Event)=>{const detail=(event as CustomEvent<{requestId:string;route:string;code:string;status?:number;durationMs:number}>).detail;if(!detail||!/^[A-Za-z0-9._:-]{1,128}$/.test(detail.requestId)||typeof detail.route!=='string'||typeof detail.code!=='string')return;setRequestFailures(previous=>[...previous.filter(item=>item.requestId!==detail.requestId),{requestId:detail.requestId,route:detail.route.slice(0,120),code:detail.code.slice(0,80),...(typeof detail.status==='number'?{status:detail.status}:{}),durationMs:Math.max(0,Math.round(detail.durationMs))}].slice(-6));};
    window.addEventListener('mazao:api-request-slow',slow);window.addEventListener('mazao:api-request-finished',finished);
    window.addEventListener('mazao:api-request-failed',failed);
    return()=>{window.removeEventListener('mazao:api-request-slow',slow);window.removeEventListener('mazao:api-request-finished',finished);window.removeEventListener('mazao:api-request-failed',failed);};
  },[]);
  useEffect(()=>{
    if(!session){setRecoverableCommands([]);return;}
    void apiClient.listRecoverableCommands(session.tenant.id).then(setRecoverableCommands).catch(()=>setRecoverableCommands([]));
    return apiClient.subscribeRecovery(records=>setRecoverableCommands(records.filter(record=>record.actorId===session.user.id)));
  },[session?.tenant.id,session?.user.id,session?.deviceId]);
  useEffect(()=>{
    if(!session){setImportRecoveries([]);return;}
    void apiClient.listImportValidationRecovery().then(setImportRecoveries).catch(()=>setImportRecoveries([]));
    return apiClient.subscribeImportRecovery(setImportRecoveries);
  },[session?.tenant.id,session?.user.id,session?.deviceId]);
  const discoverable=useMemo(()=>session?workspaceItems.filter(item=>(item.discoverability==='all'||featureState(session,item)!=='insufficient_permission')&&(session.onboardingStatus!=='SETUP'||setupWorkspaces.has(item.id))):[],[session]);
  const available=useMemo(()=>session?discoverable.filter(item=>canOpenWorkspace(session,item.id)):[],[session,discoverable]);
  useEffect(()=>{if(session&&!available.some(item=>item.id===activeTab))onTabChange('today');},[session,activeTab,available,onTabChange]);
  if(!session)return null;
  const selectWorkspace=(id:WorkspaceId)=>{
    if(!canOpenWorkspace(session,id))return;
    if(id!==activeTab&&!window.dispatchEvent(new Event('mazao:before-navigate',{cancelable:true})))return;
    if(id!==activeTab)apiClient.cancelPendingReads();
    onTabChange(id);setMoreOpen(false);
  };
  const signOut=async()=>{
    if(!window.dispatchEvent(new Event('mazao:before-navigate',{cancelable:true})))return;
    setLogoutError('');apiClient.cancelPendingReads();try{await apiClient.logout();}catch(cause){setLogoutError(cause instanceof Error?cause.message:'Sign-out could not be confirmed.');}
  };
  const openRecovery=()=>setRecoveryOpen(true);
  const openContextSwitch=async()=>{
    if(!window.dispatchEvent(new Event('mazao:before-navigate',{cancelable:true})))return;
    if(!window.dispatchEvent(new Event('mazao:before-context-switch',{cancelable:true})))return;
    setContextSwitchOpen(true);setContextLoading(true);setContextError('');setContextBlockers(null);setContextAssignments([]);
    try{
      const [assignments,blockers]=await Promise.all([apiClient.listContextAssignments(),apiClient.inspectContextSwitchBlockers()]);
      setContextAssignments(assignments);setContextBlockers(blockers);
    }catch(cause){setContextError(cause instanceof Error?cause.message:'Workspace choices could not be checked. Retry.');}
    finally{setContextLoading(false);}
  };
  const switchContext=async(assignment:BackendAssignmentChoice)=>{
    if(assignment.deviceId===session.deviceId){setContextSwitchOpen(false);return;}
    setContextBusy(true);setContextError('');
    try{
      const blockers=await apiClient.inspectContextSwitchBlockers();setContextBlockers(blockers);
      if(blockers.commands+blockers.imports+blockers.credentialChanges+blockers.countDrafts>0)return;
      apiClient.cancelPendingReads();await apiClient.switchContext(assignment.deviceId);
    }catch(cause){setContextError(cause instanceof Error?cause.message:'The workspace could not be changed. Check your sign-in and try again.');}
    finally{setContextBusy(false);}
  };
  const copyRequestId=async(requestId:string)=>{try{await navigator.clipboard.writeText(requestId);setCopiedRequestId(requestId);}catch{setCopiedRequestId('');}};
  const openAccount=()=>{if(window.dispatchEvent(new Event('mazao:before-account-open',{cancelable:true})))setAccountOpen(true);};
  const checkCommand=async(commandId:string)=>{
    setCheckingCommand(commandId);setRecoveryMessages(previous=>({...previous,[commandId]:''}));
    try{
      const result=await apiClient.checkCommandStatus(commandId);
      const response=result.response as {status?:string;message?:string};
      const message=response.message??(response.status==='CONFIRMED'?'This action completed.':response.status==='REJECTED'?'This action did not complete. Review the details before trying again.':response.status==='CONFLICT'?'These details changed elsewhere. Review them before trying again.':'This action is still being checked. Check again shortly.');
      setRecoveryMessages(previous=>({...previous,[commandId]:message}));
      setLastRecoveryResult({commandId,status:response.status??result.status,message});
    }catch(cause){setRecoveryMessages(previous=>({...previous,[commandId]:cause instanceof Error?cause.message:'We could not check status. The original action details remain saved.'}));}
    finally{setCheckingCommand('');}
  };
  const openCommandWorkspace=(type:string)=>{
    const destination:WorkspaceId=type.startsWith('restaurant.')?'service':type.startsWith('configuration.')?'manage':type.startsWith('finance.')?'money':type.startsWith('inventory.sale_shortfall.')?'stock-exceptions':type.startsWith('inventory.count.')?'stock-count':type.startsWith('customers.')?'customers':type.startsWith('hotel.')?'hotel':type==='sales.order.settle'||type==='sales.order.refund'?'sales':type==='inventory.receive'?'purchasing':type.startsWith('catalog.')?'catalog':'shifts';
    setRecoveryOpen(false);selectWorkspace(destination);
  };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="workspace-sidebar" aria-label="Main navigation">
      <div className="brand-lockup"><div className="brand-mark">M</div><div><strong>Mazao</strong><small>BUSINESS WORKSPACE</small></div></div>
      <div className="sidebar-context"><span className="context-label">OUTLET</span><strong title={session.outlet.name}>{session.outlet.name}</strong><span>{session.tenant.currency} · {session.tenant.timeZone}</span></div>
      <nav className="workspace-nav">{groups.map(group=>{const items=discoverable.filter(item=>item.group===group.id);return items.length?<section key={group.id} className="nav-group"><h2>{group.label}</h2>{items.map(item=>{const state=featureState(session,item);const navigable=state==='connected'||state==='partial';const stateLabel=state==='not_connected'?'Unavailable':state==='not_enabled'?'Not enabled':state==='partial'?'Limited':null;return <button key={item.id} type="button" title={stateLabel?`${item.label}: ${stateLabel}. ${item.description}`:item.label} aria-label={stateLabel?`${item.label}, ${stateLabel}`:item.label} aria-disabled={!navigable} disabled={!navigable} className={'nav-link '+(activeTab===item.id?'active ':'')+(!navigable?'nav-link-disabled':'')} onClick={()=>selectWorkspace(item.id)} aria-current={activeTab===item.id?'page':undefined}><span className="nav-icon">{item.icon}</span><span className="nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>{stateLabel&&<span className="nav-feature-state">{stateLabel}</span>}</button>;})}</section>:null;})}</nav>
      <div className="sidebar-footer"><span className="demo-indicator"><span/>{session.outlet.name}</span></div>
    </aside>
    <div className="app-main-column">
      <header className="topbar"><div className="topbar-context"><button type="button" className="operator-button min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={'Signed in as '+session.user.name} aria-haspopup="dialog" aria-expanded={accountOpen} title="Open My account" onClick={openAccount}><span className="operator-avatar">{session.user.name.slice(0,1)}</span><span className="operator-copy"><strong>{session.tenant.name}</strong><small>{session.outlet.name} · {session.user.name} · {roleLabel(session.user.role)}</small></span></button></div><div className="topbar-actions"><button type="button" className="icon-action min-h-11" onClick={()=>void openContextSwitch()} aria-haspopup="dialog" aria-expanded={contextSwitchOpen} aria-label="Switch workspace"><ArrowLeftRight size={16}/><span className="hidden sm:inline">Switch workspace</span></button><div className={'connection-pill server-session '+(online?'online':'offline')} title={online?'Your browser is online':'You are offline. A connection is required to complete business actions.'}>{online?<Wifi size={15}/>:<WifiOff size={15}/>}<span>{online?'Online':'Offline'}</span><button className="min-h-11 min-w-11 whitespace-nowrap" type="button" onClick={()=>void signOut()} aria-label="Sign out">Sign out</button></div>{isInstallable&&!isInstalled&&<button type="button" className="icon-action install-action" onClick={install}><Download size={16}/><span>Install app</span></button>}</div></header>
      <main className="workspace-content" id="main-content" tabIndex={-1}>
        {!online&&<div role="status" className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">You are offline. Reconnect to complete business actions. You can still review actions awaiting confirmation.</div>}
        {slowRequests.size>0&&<div role="status" className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">Loading is taking longer than usual. If it stops, use Try again in the affected section.</div>}
        {requestFailures.length>0&&<details className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Support references ({requestFailures.length})</summary><p className="mb-2 text-zinc-500">Share a reference with support if you need help loading information.</p><ul className="space-y-2">{requestFailures.map(item=><li key={item.requestId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800 pt-2"><span>Information could not be loaded.</span><code className="break-all text-blue-200">{item.requestId}</code><button type="button" className="min-h-9 rounded border border-zinc-700 px-2" onClick={()=>void copyRequestId(item.requestId)}>{copiedRequestId===item.requestId?'Copied':'Copy reference'}</button></li>)}</ul></details>}
        {logoutError&&<div role="alert" className="persistence-error-banner"><strong>We could not confirm sign-out.</strong> {logoutError}</div>}
        {recoverableCommands.length+importRecoveries.length>0&&<div role="alert" className="persistence-error-banner"><strong>{recoverableCommands.length+importRecoveries.length} operation{recoverableCommands.length+importRecoveries.length===1?'':'s'} need review.</strong> The original action details are saved on this device for checking status. <button type="button" className="ml-2 min-h-11 underline" onClick={openRecovery}>Review actions</button></div>}
        <div className="workspace-interaction-boundary">{children}</div>
      </main>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">{(['today','sell','stock'] as WorkspaceId[]).map(id=>{const item=available.find(entry=>entry.id===id);return item?<button type="button" key={id} className={activeTab===id?'active':''} onClick={()=>selectWorkspace(id)} aria-current={activeTab===id?'page':undefined}>{item.icon}<span>{item.label}</span></button>:null;})}<button type="button" className={moreOpen?'active':''} onClick={()=>setMoreOpen(value=>!value)} aria-expanded={moreOpen}><Menu/><span>More</span></button></nav>
      {moreOpen&&<div className="mobile-more-panel"><div className="mobile-more-head"><strong>All workspaces</strong><button type="button" className="min-h-11 min-w-11" onClick={()=>setMoreOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>{discoverable.filter(item=>!['today','sell','stock'].includes(item.id)).map(item=>{const state=featureState(session,item);const navigable=state==='connected'||state==='partial';const status=state==='not_connected'?'Unavailable':state==='not_enabled'?'Not enabled':state==='partial'?'Limited':null;return <button type="button" key={item.id} disabled={!navigable} aria-disabled={!navigable} title={status?`${status}. ${item.description}`:item.label} onClick={()=>selectWorkspace(item.id)} className={`${activeTab===item.id?'active ':''}${!navigable?'nav-link-disabled':''}`}>{item.icon}<span>{item.label}</span>{status&&<small>{status}</small>}</button>;})}</div>}
      {recoveryOpen&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setRecoveryOpen(false);}}><section role="dialog" aria-modal="true" aria-labelledby="recovery-center-title" className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"><header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-800 bg-zinc-950 p-4 sm:p-5"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-blue-300">CHECK BEFORE REPEATING</p><h2 id="recovery-center-title" className="mt-1 text-xl font-bold">Actions needing review</h2><p className="mt-1 text-xs text-zinc-400">Check status before repeating an action. Nothing is automatically sent again from here.</p></div><button type="button" onClick={()=>setRecoveryOpen(false)} aria-label="Close actions needing review" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800"><X size={18}/></button></header>
        <div className="space-y-5 p-4 sm:p-5">{lastRecoveryResult&&<div role="status" className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-3 text-xs text-emerald-100"><strong>Last status check: {actionStatusLabel(lastRecoveryResult.status)}</strong><p className="mt-1">{lastRecoveryResult.message}</p><details className="mt-2"><summary className="cursor-pointer">Support reference</summary><p className="mt-1 break-all font-mono text-[10px]">{lastRecoveryResult.commandId}</p></details></div>}<section aria-labelledby="server-command-list-title"><div className="mb-2 flex items-center justify-between gap-2"><h3 id="server-command-list-title" className="text-sm font-semibold">Business actions</h3><span className="text-[11px] text-zinc-500">{recoverableCommands.length} to review</span></div>{recoverableCommands.length? <div className="space-y-2">{recoverableCommands.map(record=><article key={record.command.commandId} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-zinc-100">{operationLabel(record.command.type)}</p><details className="mt-2 text-xs text-zinc-400"><summary className="cursor-pointer">Support reference</summary><p className="mt-1 break-all font-mono text-[10px]">{record.command.commandId}</p></details><p className="mt-1 text-[10px] text-zinc-500">{record.state==='sending'?'Submission was interrupted':'Outcome was not confirmed'} · retained {new Date(record.savedAt).toLocaleString()}</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={()=>void checkCommand(record.command.commandId)} disabled={checkingCommand===record.command.commandId} className="min-h-10 rounded-lg border border-blue-800 px-3 text-xs font-medium text-blue-200 disabled:opacity-50">{checkingCommand===record.command.commandId?'Checking…':'Check status'}</button><button type="button" onClick={()=>openCommandWorkspace(record.command.type)} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-300">Open workspace</button></div></div>{recoveryMessages[record.command.commandId]&&<p role="status" className="mt-2 text-xs text-amber-200">{recoveryMessages[record.command.commandId]}</p>}</article>)}</div>:<p className="rounded-lg border border-zinc-800 p-4 text-xs text-zinc-500">No business actions need review on this browser.</p>}</section>
          <section aria-labelledby="import-recovery-title"><div className="mb-2 flex items-center justify-between gap-2"><h3 id="import-recovery-title" className="text-sm font-semibold">Product imports</h3><span className="text-[11px] text-zinc-500">{importRecoveries.length} to review</span></div>{importRecoveries.length?<div className="space-y-2">{importRecoveries.map(record=><article key={record.commandId} className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3"><p className="text-xs font-semibold text-amber-100">{record.fileName} · confirmation needed</p><details className="mt-2 text-xs"><summary className="cursor-pointer">Support reference</summary><p className="mt-1 break-all font-mono text-[10px]">{record.sourceHash}</p></details><p className="mt-1 text-[11px] text-amber-100/70">Reopen product import and select the original file to check it again. The file contents are not saved on this device.</p><button type="button" onClick={()=>{setRecoveryOpen(false);selectWorkspace('catalog');}} className="mt-2 min-h-10 rounded-lg border border-amber-800 px-3 text-xs font-semibold text-amber-100">Open product import review</button></article>)}</div>:<p className="rounded-lg border border-zinc-800 p-4 text-xs text-zinc-500">No product imports need review on this browser.</p>}</section>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] leading-relaxed text-zinc-400">Sales need a connection to complete. Check an unconfirmed payment before taking payment again.</div>
        </div></section></div>}
      {contextSwitchOpen&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!contextBusy)setContextSwitchOpen(false);}}>
        <section role="dialog" aria-modal="true" aria-labelledby="context-switch-title" className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
          <header className="flex items-start justify-between gap-3 border-b border-zinc-800 p-4 sm:p-5"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-blue-300">AUTHORIZED WORKSPACES</p><h2 id="context-switch-title" className="mt-1 text-xl font-bold">Switch workspace</h2><p className="mt-1 text-sm text-zinc-400">Choose an active outlet assignment for your account.</p></div><button type="button" onClick={()=>setContextSwitchOpen(false)} disabled={contextBusy} aria-label="Close workspace choices" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"><X size={18}/></button></header>
          <div className="space-y-3 p-4 sm:p-5">
            {contextLoading&&<p role="status" className="text-sm text-zinc-400">Checking active assignments and saved recovery details…</p>}
            {contextError&&<p role="alert" className="rounded-lg border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">{contextError}</p>}
            {contextBlockers&&contextBlockers.commands+contextBlockers.imports+contextBlockers.credentialChanges+contextBlockers.countDrafts>0&&<div role="alert" className="space-y-2 rounded-lg border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-100"><p>Resolve or safely save current workspace work before switching. No pending action will be sent again automatically.</p><ul className="list-inside list-disc text-xs text-amber-100/80">{contextBlockers.commands>0&&<li>{contextBlockers.commands} business action{contextBlockers.commands===1?'':'s'} need status review</li>}{contextBlockers.imports>0&&<li>{contextBlockers.imports} product import{contextBlockers.imports===1?'':'s'} need review</li>}{contextBlockers.credentialChanges>0&&<li>{contextBlockers.credentialChanges} password operation{contextBlockers.credentialChanges===1?'':'s'} need recovery</li>}{contextBlockers.countDrafts>0&&<li>{contextBlockers.countDrafts} unsent count draft{contextBlockers.countDrafts===1?'':'s'} are saved on this device</li>}</ul><div className="flex flex-wrap gap-2">{(contextBlockers.commands>0||contextBlockers.imports>0)&&<button type="button" className="min-h-10 rounded-lg border border-amber-700 px-3 text-xs" onClick={()=>{setContextSwitchOpen(false);setRecoveryOpen(true);}}>Review saved actions</button>}{contextBlockers.countDrafts>0&&canOpenWorkspace(session,'stock-count')&&<button type="button" className="min-h-10 rounded-lg border border-amber-700 px-3 text-xs" onClick={()=>{setContextSwitchOpen(false);selectWorkspace('stock-count');}}>Open stock count</button>}{contextBlockers.ownPasswordChanges>0&&<button type="button" className="min-h-10 rounded-lg border border-amber-700 px-3 text-xs" onClick={()=>{setContextSwitchOpen(false);setAccountOpen(true);}}>Open account security</button>}{contextBlockers.staffPasswordChanges>0&&canOpenWorkspace(session,'manage')&&<button type="button" className="min-h-10 rounded-lg border border-amber-700 px-3 text-xs" onClick={()=>{setContextSwitchOpen(false);selectWorkspace('manage');}}>Open staff management</button>}</div></div>}
            {!contextLoading&&!contextAssignments.length&&!contextError&&<p className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">No active workspace assignments are available.</p>}
            {contextAssignments.map(assignment=><button key={assignment.deviceId} type="button" disabled={contextBusy||assignment.deviceId===session.deviceId||contextLoading} aria-current={assignment.deviceId===session.deviceId?'true':undefined} onClick={()=>void switchContext(assignment)} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-900/50 p-3 text-left hover:border-blue-700 disabled:cursor-default disabled:opacity-60"><span><strong className="block text-sm text-zinc-100">{assignment.tenantName}</strong><span className="mt-1 block text-xs text-zinc-400">{assignment.outletName} · {assignment.deviceLabel}</span></span><span className="text-xs text-blue-200">{contextBusy?'Switching…':assignment.deviceId===session.deviceId?'Current':'Switch'}</span></button>)}
            {!contextLoading&&contextAssignments.length>0&&!contextBlockers&&!contextError&&<p className="text-xs text-zinc-500">Saved actions and unsent stock count edits must be resolved before changing outlets.</p>}
          </div>
        </section>
      </div>}
      {accountOpen&&<MyAccountDialog onClose={()=>setAccountOpen(false)}/>}
    </div>
  </div>;
}
