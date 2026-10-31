import { lazy, Suspense, useState } from 'react';
import { apiClient } from '../../services/apiClient';
const Setup=lazy(()=>import('./BackendRestaurantWorkspace').then(module=>({default:module.BackendRestaurantWorkspace})));
const Orders=lazy(()=>import('./BackendRestaurantOrdersWorkspace').then(module=>({default:module.BackendRestaurantOrdersWorkspace})));
const Tickets=lazy(()=>import('./RestaurantStationTicketsWorkspace').then(module=>({default:module.RestaurantStationTicketsWorkspace})));
type View='orders'|'tickets'|'setup';

export function RestaurantWorkspace(){
  const session=apiClient.getSession()!,live=session.onboardingStatus!=='SETUP';
  const canOrders=live&&session.user.permissions.includes('restaurant.order.view'),canTickets=live&&session.user.permissions.includes('restaurant.ticket.view');
  const [view,setView]=useState<View>(canOrders?'orders':canTickets?'tickets':'setup');
  const changeView=(next:View)=>{if(next===view)return;if(!window.dispatchEvent(new Event('mazao:before-navigate',{cancelable:true})))return;apiClient.cancelPendingReads();setView(next);};
  return <div className="space-y-5"><nav aria-label="Restaurant workspaces" className="flex flex-wrap gap-2">{([...(canOrders?[['orders','Orders']]:[]),...(canTickets?[['tickets','Station tickets']]:[]),['setup','Restaurant setup']] as Array<[View,string]>).map(([id,label])=><button key={id} type="button" aria-pressed={view===id} onClick={()=>changeView(id)} className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${view===id?'border-blue-500 bg-blue-950 text-blue-100':'border-zinc-700'}`}>{label}</button>)}</nav><Suspense fallback={<p role="status" className="p-5 text-sm text-zinc-400">Loading restaurant workspace…</p>}>{view==='orders'&&canOrders?<Orders/>:view==='tickets'&&canTickets?<Tickets/>:<Setup/>}</Suspense></div>;
}
