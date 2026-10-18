import React,{lazy,Suspense,useState} from 'react';
import {apiClient} from '../../services/apiClient';
import {BackendFinancialReportsWorkspace} from './BackendFinancialReportsWorkspace';
const AccountCatalogWorkspace=lazy(()=>import('./AccountCatalogWorkspace').then(module=>({default:module.AccountCatalogWorkspace})));
const AccountingControlsWorkspace=lazy(()=>import('./AccountingControlsWorkspace').then(module=>({default:module.AccountingControlsWorkspace})));
const ControlReportsWorkspace=lazy(()=>import('./ControlReportsWorkspace').then(module=>({default:module.ControlReportsWorkspace})));
type View='reports'|'accounting'|'controls'|'catalog';
const views:Array<[View,string]>=[['reports','Financial reports'],['accounting','Accounting and reconciliation'],['controls','Customer and stock balances'],['catalog','Account names']];
export function MoneyWorkspace(){
  const [view,setView]=useState<View>('reports');
  return <div className="h-full overflow-y-auto"><nav aria-label="Money workspace" className="flex flex-wrap gap-2 px-4 pt-4 sm:px-6">{views.map(([key,label])=><button key={key} type="button" aria-pressed={view===key} onClick={()=>{if(key!==view){apiClient.cancelPendingReads();setView(key);}}} className={`min-h-11 rounded-lg border px-4 text-sm ${view===key?'border-blue-500 bg-blue-950':'border-zinc-700'}`}>{label}</button>)}</nav>{view==='reports'?<BackendFinancialReportsWorkspace initialView="trial-balance"/>:<Suspense fallback={<p role="status" className="p-6 text-zinc-400">Loading accounting…</p>}>{view==='catalog'?<AccountCatalogWorkspace/>:view==='accounting'?<AccountingControlsWorkspace/>:<ControlReportsWorkspace/>}</Suspense>}</div>;
}
