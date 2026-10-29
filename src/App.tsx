import React, { useEffect, useRef, useState } from 'react';
import { AppShell, canOpenWorkspace, type ActiveTab } from './components/layout/AppShell';
import { PointOfSaleView } from './components/pos/PointOfSaleView';
import { InventoryView } from './components/inventory/InventoryView';
import { ShiftManagerView } from './components/shifts/ShiftManagerView';
import { lazy, Suspense } from 'react';

const BackendOperationalAnalyticsWorkspace = lazy(() => import('./components/analytics/BackendOperationalAnalyticsWorkspace').then(module => ({ default: module.BackendOperationalAnalyticsWorkspace })));
const BackendManageWorkspace = lazy(() => import('./components/manage/BackendManageWorkspace').then(module => ({ default: module.BackendManageWorkspace })));
const MoneyWorkspace = lazy(() => import('./components/finance/MoneyWorkspace').then(module => ({ default: module.MoneyWorkspace })));
const StockExceptionsWorkspace = lazy(() => import('./components/inventory/StockExceptionsWorkspace').then(module => ({ default: module.StockExceptionsWorkspace })));
const CatalogWorkspace = lazy(() => import('./components/inventory/CatalogWorkspace').then(module => ({ default: module.CatalogWorkspace })));
const BackendRestaurantWorkspace = lazy(() => import('./components/service/BackendRestaurantWorkspace').then(module => ({ default: module.BackendRestaurantWorkspace })));
import { BackendCustomerWorkspace } from './components/customers/BackendCustomerWorkspace';
import { BackendReceiptModal } from './components/hardware/BackendReceiptModal';
import { SalesHistoryView } from './components/sales/SalesHistoryView';
import { HelpWorkspace } from './components/help/HelpWorkspace';
import { ProcurementWorkspace } from './components/procurement/ProcurementWorkspace';
import { BackendHotelWorkspace } from './components/hospitality/BackendHotelWorkspace';
import { BackendTodayWorkspace } from './components/home/BackendTodayWorkspace';
import { BackendStockCountWorkspace } from './components/inventory/BackendStockCountWorkspace';
import { apiClient, type BackendSaleReceipt } from './services/apiClient';
import { SignInForm } from './components/auth/SignInForm';
import { normalizedWorkspaceRoute, workspaceInitialReads } from './services/workspacePerformance';
import type { AccountingArea } from './types/accounting';

function WorkspaceRenderProbe({workspace}:{workspace:string}){
  const startedAt=useRef(performance.now());
  const reported=useRef(false);
  React.useLayoutEffect(()=>{
    if(reported.current||typeof window==='undefined')return;
    reported.current=true;
    window.dispatchEvent(new CustomEvent('mazao:workspace-render-cycle',{detail:{workspace,durationMs:Math.round(performance.now()-startedAt.current)}}));
  },[workspace]);
  return null;
}

export default function App() {
  const [activeTab,setActiveTab]=useState<ActiveTab>('today');
  const [purchaseStartTab,setPurchaseStartTab]=useState<'orders'|'receive'>('orders');
  const [stockStartView,setStockStartView]=useState<'inventory'|'import'>('inventory');
  const [catalogStartImport,setCatalogStartImport]=useState(false);
  const [catalogInitialBarcode,setCatalogInitialBarcode]=useState('');
  const [moneyStartArea,setMoneyStartArea]=useState<AccountingArea|undefined>();
  const [session,setSession]=useState(apiClient.getSession());
  const sessionContextKey=session?`${session.user.id}:${session.tenant.id}:${session.outlet.id}`:'';
  const [workspaceContextKey,setWorkspaceContextKey]=useState(sessionContextKey);
  const contextChanged=!!session&&sessionContextKey!==workspaceContextKey;
  const visibleTab:ActiveTab=contextChanged?(session?.onboardingStatus==='SETUP'?'onboarding':'today'):session&&canOpenWorkspace(session,activeTab)?activeTab:session?.onboardingStatus==='SETUP'?'onboarding':'today';
  const [sessionBootstrap,setSessionBootstrap]=useState<'checking'|'ready'|'error'>('checking');
  const [restoreError,setRestoreError]=useState('');
  const [receiptOrderId,setReceiptOrderId]=useState<string|null>(null);
  const [receipt,setReceipt]=useState<BackendSaleReceipt|null>(null);
  const [receiptLoading,setReceiptLoading]=useState(false);
  const [receiptError,setReceiptError]=useState('');
  const [receiptContextKey,setReceiptContextKey]=useState('');
  const receiptRequest=useRef(0);
  const workspaceNavigationStarted=useRef(performance.now());
  const measuredWorkspaceIdentity=useRef<string|null>(null);

  useEffect(()=>{
    const unsubscribe=apiClient.subscribe(setSession);
    let mounted=true;
    void apiClient.restore().then(()=>{if(mounted)setSessionBootstrap('ready');}).catch(cause=>{
      if(!mounted)return;
      setRestoreError(cause instanceof Error?cause.message:'We could not check your sign-in. Try again.');setSessionBootstrap('error');
    });
    return()=>{mounted=false;unsubscribe();};
  },[]);
  useEffect(()=>{
    if(sessionContextKey===workspaceContextKey)return;
    ++receiptRequest.current;setReceiptOrderId(null);setReceipt(null);setReceiptLoading(false);setReceiptError('');setReceiptContextKey('');
    setActiveTab(session?.onboardingStatus==='SETUP'?'onboarding':'today');setPurchaseStartTab('orders');setStockStartView('inventory');setCatalogStartImport(false);setCatalogInitialBarcode('');setMoneyStartArea(undefined);
    setWorkspaceContextKey(sessionContextKey);
  },[sessionContextKey,workspaceContextKey,session?.onboardingStatus]);
  const changeWorkspace=(tab:ActiveTab)=>{workspaceNavigationStarted.current=performance.now();if(tab!=='money')setMoneyStartArea(undefined);setActiveTab(tab);};
  const navigate=(tab:ActiveTab):boolean=>{
    if(!session||!canOpenWorkspace(session,tab))return false;
    if(tab!==activeTab&&!window.dispatchEvent(new Event('mazao:before-navigate',{cancelable:true})))return false;
    if(tab!==activeTab)apiClient.cancelPendingReads();
    changeWorkspace(tab);
    return true;
  };
  const openAccounting=(area:AccountingArea)=>{if(navigate('money'))setMoneyStartArea(area);};
  const openReceipt=(orderId:string)=>{
    const requestId=++receiptRequest.current;
    setReceiptContextKey(sessionContextKey);
    setReceiptOrderId(orderId);setReceipt(null);setReceiptLoading(true);setReceiptError('');
    void apiClient.getSaleReceipt(orderId).then(result=>{if(receiptRequest.current===requestId)setReceipt(result);}).catch(cause=>{if(receiptRequest.current===requestId)setReceiptError(cause instanceof Error?cause.message:'Receipt lookup failed.');}).finally(()=>{if(receiptRequest.current===requestId)setReceiptLoading(false);});
  };
  const closeReceipt=()=>{++receiptRequest.current;setReceiptOrderId(null);setReceipt(null);setReceiptLoading(false);setReceiptError('');};

  React.useLayoutEffect(()=>{
    if(!session||typeof window==='undefined')return;
    const identity=`${session.user.id}:${session.tenant.id}:${session.outlet.id}`;
    if(measuredWorkspaceIdentity.current!==identity){measuredWorkspaceIdentity.current=identity;workspaceNavigationStarted.current=performance.now();}
    const startedAt=workspaceNavigationStarted.current;
    const workspace=visibleTab;
    const expected=new Set(workspaceInitialReads(workspace,session,moneyStartArea));
    const settled=new Set<string>();
    let failed=false;let frame=0;let emitted=false;
    const emitUsable=()=>{
      if(emitted||settled.size<expected.size)return;
      emitted=true;
      const detail={workspace,durationMs:Math.round(performance.now()-startedAt),outcome:failed?'recovery':'ready',blockingReadCount:expected.size};
      if(expected.size===0)window.dispatchEvent(new CustomEvent('mazao:workspace-first-usable',{detail}));
      else frame=requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent('mazao:workspace-first-usable',{detail})));
    };
    const onSettled=(event:Event,wasFailure:boolean)=>{
      const detail=(event as CustomEvent<{route?:string;outcome?:string;status?:number}>).detail;
      if(typeof detail?.route!=='string')return;
      const route=normalizedWorkspaceRoute(detail.route);
      if(!expected.has(route))return;
      settled.add(route);failed ||= wasFailure||detail.outcome!==undefined&&detail.outcome!=='success'||typeof detail.status==='number'&&detail.status>=400;emitUsable();
    };
    const completed=(event:Event)=>onSettled(event,false);
    const failedRead=(event:Event)=>onSettled(event,true);
    window.addEventListener('mazao:api-request-completed',completed);
    window.addEventListener('mazao:api-request-failed',failedRead);
    performance.mark(`mazao:workspace:${workspace}:commit`);
    window.dispatchEvent(new CustomEvent('mazao:workspace-rendered',{detail:{workspace,durationMs:Math.round(performance.now()-startedAt),blockingReadCount:expected.size}}));
    if(expected.size===0)emitUsable();
    return()=>{
      window.removeEventListener('mazao:api-request-completed',completed);
      window.removeEventListener('mazao:api-request-failed',failedRead);
      if(frame)cancelAnimationFrame(frame);
    };
  },[visibleTab,session?.user.id,session?.tenant.id,session?.outlet.id,moneyStartArea]);

  if(sessionBootstrap==='checking')return <SessionBootstrapScreen status="checking"/>;
  if(sessionBootstrap==='error')return <SessionBootstrapScreen status="error" message={restoreError} onRetry={()=>{
    setSessionBootstrap('checking');setRestoreError('');
    void apiClient.restore().then(()=>setSessionBootstrap('ready')).catch(cause=>{setRestoreError(cause instanceof Error?cause.message:'We could not check your sign-in. Try again.');setSessionBootstrap('error');});
  }}/>;
  if(!session)return <main className="flex min-h-dvh items-center justify-center bg-[#090b10] p-5 text-zinc-100"><SignInForm/></main>;
  return <div className="h-dvh w-screen overflow-hidden bg-[#090b10] text-zinc-100 flex flex-col font-sans antialiased">
    <AppShell key={sessionContextKey} activeTab={visibleTab} onTabChange={changeWorkspace}>
      <React.Fragment key={sessionContextKey}>
      <WorkspaceRenderProbe key={visibleTab} workspace={visibleTab}/>
      {visibleTab==='today'&&<BackendTodayWorkspace onNavigate={navigate}/>}
      {visibleTab==='sell'&&<PointOfSaleView onOrderCompleted={openReceipt}/>}
      {visibleTab==='sales'&&<SalesHistoryView onReprintOrder={openReceipt}/>}
      {visibleTab==='service'&&<Suspense fallback={<p role="status" className="p-6 text-sm text-zinc-400">Loading restaurant setup…</p>}><BackendRestaurantWorkspace/></Suspense>}
      {visibleTab==='hotel'&&<BackendHotelWorkspace/>}
      {visibleTab==='reservations'&&<BackendHotelWorkspace initialView="reservations"/>}
      {visibleTab==='stock'&&<InventoryView initialView={stockStartView} onInitialViewConsumed={()=>setStockStartView('inventory')} onOpenStockExceptions={()=>navigate('stock-exceptions')} onOpenReceiving={()=>{setPurchaseStartTab('receive');navigate('purchasing');}}/>}
      {visibleTab==='stock-count'&&<BackendStockCountWorkspace onOpenCatalog={barcode=>{if(navigate('catalog'))setCatalogInitialBarcode(barcode);}}/>}
      {visibleTab==='catalog'&&<Suspense fallback={<p role="status" className="p-6 text-sm text-zinc-400">Loading items and services…</p>}><CatalogWorkspace onBack={()=>{setCatalogInitialBarcode('');navigate('today');}} initialImport={catalogStartImport} initialBarcode={catalogInitialBarcode} onInitialImportConsumed={()=>setCatalogStartImport(false)}/></Suspense>}
      {visibleTab==='stock-exceptions'&&<Suspense fallback={<div role="status" className="p-6 text-sm text-zinc-400">Loading stock exception records…</div>}><StockExceptionsWorkspace onNavigate={navigate}/></Suspense>}
      {visibleTab==='purchasing'&&<ProcurementWorkspace initialTab={purchaseStartTab} onInitialTabConsumed={()=>setPurchaseStartTab('orders')} onOpenSupplierAccounts={()=>openAccounting('suppliers')}/>}
      {visibleTab==='customers'&&<BackendCustomerWorkspace onNavigate={navigate}/>}
      {visibleTab==='shifts'&&<ShiftManagerView/>}
      {visibleTab==='money'&&<Suspense fallback={<div role="status" className="p-6 text-sm text-zinc-400">Loading financial workspace…</div>}><MoneyWorkspace initialAccountingArea={moneyStartArea}/></Suspense>}
      {visibleTab==='reports'&&<Suspense fallback={<div role="status" className="p-6 text-sm text-zinc-400">Loading operational reports…</div>}><BackendOperationalAnalyticsWorkspace onNavigate={navigate}/></Suspense>}
      {(visibleTab==='manage'||visibleTab==='onboarding')&&<Suspense fallback={<div role="status" className="p-6 text-sm text-zinc-400">Loading business administration…</div>}><BackendManageWorkspace key={visibleTab} initialSection={visibleTab==='onboarding'?'readiness':'overview'} onNavigate={navigate} onOpenImport={()=>setCatalogStartImport(true)} onOpenAccounting={openAccounting}/></Suspense>}
      {visibleTab==='help'&&<HelpWorkspace onNavigate={navigate}/>}
      </React.Fragment>
    </AppShell>
    {receiptOrderId&&receiptContextKey===sessionContextKey&&<BackendReceiptModal receipt={receipt} loading={receiptLoading} error={receiptError} onRetry={()=>openReceipt(receiptOrderId)} onClose={closeReceipt}/>}
  </div>;
}

function SessionBootstrapScreen({status,message,onRetry}:{status:'checking'|'error';message?:string;onRetry?:()=>void}) {
  return <main className="flex min-h-dvh items-center justify-center bg-[#090b10] p-5 text-zinc-100"><section className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl" aria-labelledby="session-bootstrap-title"><p className="text-xs uppercase tracking-[.18em] text-blue-300">Mazao workspace</p><h1 id="session-bootstrap-title" className="mt-2 text-2xl font-bold">{status==='checking'?'Checking your sign-in':'We could not check your sign-in'}</h1><p role={status==='error'?'alert':'status'} className="mt-3 text-sm leading-6 text-zinc-300">{status==='checking'?'Wait while Mazao checks this browser’s authenticated operator session.':(message??'We could not connect. Try again.')+''}</p>{status==='error'&&<button type="button" onClick={onRetry} className="mt-5 min-h-11 rounded-lg bg-blue-600 px-4 font-semibold">Try again</button>}</section></main>;
}
