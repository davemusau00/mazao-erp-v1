import React, { useEffect, useRef, useState } from 'react';
import { AppShell, canOpenWorkspace, type ActiveTab } from './components/layout/AppShell';
import { PointOfSaleView } from './components/pos/PointOfSaleView';
import { InventoryView } from './components/inventory/InventoryView';
import { ShiftManagerView } from './components/shifts/ShiftManagerView';
import { BackendFinancialReportsWorkspace } from './components/finance/BackendFinancialReportsWorkspace';
import { lazy, Suspense } from 'react';

const BackendOperationalAnalyticsWorkspace = lazy(() => import('./components/analytics/BackendOperationalAnalyticsWorkspace').then(module => ({ default: module.BackendOperationalAnalyticsWorkspace })));
const BackendManageWorkspace = lazy(() => import('./components/manage/BackendManageWorkspace').then(module => ({ default: module.BackendManageWorkspace })));
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

export default function App() {
  const [activeTab,setActiveTab]=useState<ActiveTab>('today');
  const [purchaseStartTab,setPurchaseStartTab]=useState<'orders'|'receive'>('orders');
  const [stockStartView,setStockStartView]=useState<'inventory'|'import'>('inventory');
  const [session,setSession]=useState(apiClient.getSession());
  const [sessionBootstrap,setSessionBootstrap]=useState<'checking'|'ready'|'error'>('checking');
  const [restoreError,setRestoreError]=useState('');
  const [receiptOrderId,setReceiptOrderId]=useState<string|null>(null);
  const [receipt,setReceipt]=useState<BackendSaleReceipt|null>(null);
  const [receiptLoading,setReceiptLoading]=useState(false);
  const [receiptError,setReceiptError]=useState('');
  const receiptRequest=useRef(0);

  useEffect(()=>{
    const unsubscribe=apiClient.subscribe(setSession);
    let mounted=true;
    void apiClient.restore().then(()=>{if(mounted)setSessionBootstrap('ready');}).catch(cause=>{
      if(!mounted)return;
      setRestoreError(cause instanceof Error?cause.message:'The server session could not be verified.');setSessionBootstrap('error');
    });
    return()=>{mounted=false;unsubscribe();};
  },[]);
  useEffect(()=>{++receiptRequest.current;setReceiptOrderId(null);setReceipt(null);setReceiptLoading(false);setReceiptError('');setActiveTab('today');},[session?.user.id]);
  const navigate=(tab:ActiveTab):boolean=>{
    if(!session||!canOpenWorkspace(session,tab))return false;
    if(tab!==activeTab&&!window.dispatchEvent(new Event('mazao:before-navigate',{cancelable:true})))return false;
    setActiveTab(tab);
    return true;
  };
  const openReceipt=(orderId:string)=>{
    const requestId=++receiptRequest.current;
    setReceiptOrderId(orderId);setReceipt(null);setReceiptLoading(true);setReceiptError('');
    void apiClient.getSaleReceipt(orderId).then(result=>{if(receiptRequest.current===requestId)setReceipt(result);}).catch(cause=>{if(receiptRequest.current===requestId)setReceiptError(cause instanceof Error?cause.message:'Receipt lookup failed.');}).finally(()=>{if(receiptRequest.current===requestId)setReceiptLoading(false);});
  };
  const closeReceipt=()=>{++receiptRequest.current;setReceiptOrderId(null);setReceipt(null);setReceiptLoading(false);setReceiptError('');};

  if(sessionBootstrap==='checking')return <SessionBootstrapScreen status="checking"/>;
  if(sessionBootstrap==='error')return <SessionBootstrapScreen status="error" message={restoreError} onRetry={()=>{
    setSessionBootstrap('checking');setRestoreError('');
    void apiClient.restore().then(()=>setSessionBootstrap('ready')).catch(cause=>{setRestoreError(cause instanceof Error?cause.message:'The server session could not be verified.');setSessionBootstrap('error');});
  }}/>;
  if(!session)return <main className="flex min-h-dvh items-center justify-center bg-[#090b10] p-5 text-zinc-100"><SignInForm/></main>;
  const visibleTab=canOpenWorkspace(session,activeTab)?activeTab:'today';

  return <div className="h-dvh w-screen overflow-hidden bg-[#090b10] text-zinc-100 flex flex-col font-sans antialiased">
    <AppShell activeTab={visibleTab} onTabChange={setActiveTab}>
      {visibleTab==='today'&&<BackendTodayWorkspace onNavigate={navigate}/>}
      {visibleTab==='sell'&&<PointOfSaleView onOrderCompleted={openReceipt}/>}
      {visibleTab==='sales'&&<SalesHistoryView onReprintOrder={openReceipt}/>}
      {visibleTab==='hotel'&&<BackendHotelWorkspace/>}
      {visibleTab==='reservations'&&<BackendHotelWorkspace initialView="reservations"/>}
      {visibleTab==='stock'&&<InventoryView initialView={stockStartView} onInitialViewConsumed={()=>setStockStartView('inventory')} onOpenReceiving={()=>{setPurchaseStartTab('receive');navigate('purchasing');}}/>}
      {visibleTab==='stock-count'&&<BackendStockCountWorkspace/>}
      {visibleTab==='purchasing'&&<ProcurementWorkspace initialTab={purchaseStartTab} onInitialTabConsumed={()=>setPurchaseStartTab('orders')}/>}
      {visibleTab==='customers'&&<BackendCustomerWorkspace onNavigate={navigate}/>}
      {visibleTab==='shifts'&&<ShiftManagerView/>}
      {visibleTab==='money'&&<BackendFinancialReportsWorkspace initialView="trial-balance"/>}
      {visibleTab==='reports'&&<Suspense fallback={<div role="status" className="p-6 text-sm text-zinc-400">Loading operational reports…</div>}><BackendOperationalAnalyticsWorkspace/></Suspense>}
      {(visibleTab==='manage'||visibleTab==='onboarding')&&<Suspense fallback={<div role="status" className="p-6 text-sm text-zinc-400">Loading business administration…</div>}><BackendManageWorkspace initialSection={visibleTab==='onboarding'?'readiness':'overview'} onNavigate={navigate} onOpenImport={()=>setStockStartView('import')}/></Suspense>}
      {visibleTab==='help'&&<HelpWorkspace onNavigate={navigate}/>}
    </AppShell>
    {receiptOrderId&&<BackendReceiptModal receipt={receipt} loading={receiptLoading} error={receiptError} onRetry={()=>openReceipt(receiptOrderId)} onClose={closeReceipt}/>}
  </div>;
}

function SessionBootstrapScreen({status,message,onRetry}:{status:'checking'|'error';message?:string;onRetry?:()=>void}) {
  return <main className="flex min-h-dvh items-center justify-center bg-[#090b10] p-5 text-zinc-100"><section className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl" aria-labelledby="session-bootstrap-title"><p className="text-xs uppercase tracking-[.18em] text-blue-300">Mazao workspace</p><h1 id="session-bootstrap-title" className="mt-2 text-2xl font-bold">{status==='checking'?'Checking saved server session':'Server session could not be verified'}</h1><p role={status==='error'?'alert':'status'} className="mt-3 text-sm leading-6 text-zinc-300">{status==='checking'?'Wait while Mazao checks this browser’s authenticated operator session.':(message??'The server is unavailable.')+' No business workspace has been opened.'}</p>{status==='error'&&<button type="button" onClick={onRetry} className="mt-5 min-h-11 rounded-lg bg-blue-600 px-4 font-semibold">Retry server check</button>}</section></main>;
}
