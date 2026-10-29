import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ApiClientError } from '../../services/apiClient';
import type { RestaurantOrderStation, RestaurantOrderTicket } from '../../types/restaurantOrders';
import type { HistoryOptions, HistoryPage } from '../../types/history';
import { HistoryNavigation } from '../common/HistoryNavigation';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';
import { RestaurantTicketCards } from './RestaurantTicketCards';

export function RestaurantStationTicketsWorkspace(){
  const session=apiClient.getSession()!,timeZone=session.outlet.timeZone??session.tenant.timeZone;
  const [stations,setStations]=useState<RestaurantOrderStation[]>([]),[selected,setSelected]=useState(''),[tickets,setTickets]=useState<RestaurantOrderTicket[]>([]),[page,setPage]=useState<HistoryPage>();
  const [loading,setLoading]=useState(true),[ticketBusy,setTicketBusy]=useState(false),[error,setError]=useState(''),[online,setOnline]=useState(navigator.onLine),[stale,setStale]=useState(true);
  const selectedRef=useRef(''),query=useRef(''),generation=useRef(0),feedGeneration=useRef(0),mounted=useRef(true),controller=useRef<AbortController|null>(null);
  const clearProtectedTickets=useCallback(()=>{
    ++feedGeneration.current;selectedRef.current='';query.current='';setStations([]);setSelected('');setTickets([]);setPage(undefined);setTicketBusy(false);setStale(true);
  },[]);
  const readFeed=useCallback(async(stationId:string,options:HistoryOptions={},append=false)=>{
    const request=++feedGeneration.current;setTicketBusy(true);setError('');
    try{const result=await apiClient.listRestaurantStationTickets(stationId,options);if(!mounted.current||request!==feedGeneration.current||selectedRef.current!==stationId)return;query.current=options.q??'';setTickets(previous=>append?[...previous,...result.tickets.filter(row=>!previous.some(ticket=>ticket.id===row.id))]:result.tickets);setPage(result.page);setStale(false);}
    catch(cause){if(mounted.current&&request===feedGeneration.current){if(cause instanceof ApiClientError&&(cause.status===401||cause.status===403))clearProtectedTickets();setStale(true);setError(cause instanceof Error?cause.message:'Station tickets could not load. Refresh and retry.');}}
    finally{if(mounted.current&&request===feedGeneration.current)setTicketBusy(false);}
  },[clearProtectedTickets]);
  const refresh=useCallback(async()=>{
    controller.current?.abort();const readController=new AbortController();controller.current=readController;const request=++generation.current;
    ++feedGeneration.current;setLoading(true);setError('');setStale(true);
    try{const result=await apiClient.listRestaurantTicketStations(readController.signal);if(!mounted.current||request!==generation.current)return;setStations(result.stations);
      const stationId=result.stations.some(station=>station.id===selectedRef.current)?selectedRef.current:result.stations[0]?.id??'';selectedRef.current=stationId;setSelected(stationId);query.current='';
      if(stationId)await readFeed(stationId);else{setTickets([]);setPage(undefined);setStale(false);}
    }catch(cause){if(mounted.current&&request===generation.current&&!(cause instanceof ApiClientError&&cause.code==='REQUEST_CANCELLED')){if(cause instanceof ApiClientError&&(cause.status===401||cause.status===403))clearProtectedTickets();setError(cause instanceof Error?cause.message:'Station access could not be checked. Refresh and retry.');}}
    finally{if(mounted.current&&request===generation.current)setLoading(false);}
  },[readFeed,clearProtectedTickets]);
  useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;++generation.current;++feedGeneration.current;controller.current?.abort();};},[refresh,session.tenant.id,session.outlet.id,session.deviceId]);
  useEffect(()=>{const offline=()=>{setOnline(false);setStale(true);++generation.current;++feedGeneration.current;controller.current?.abort();setLoading(false);setTicketBusy(false);};const reconnect=()=>{setOnline(true);void refresh();};window.addEventListener('offline',offline);window.addEventListener('online',reconnect);return()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',reconnect);};},[refresh]);
  return <div className="page-stack"><WorkspaceHeading eyebrow={session.outlet.name} title="Station tickets" description="Review saved tickets for stations this workspace can access." action={<button type="button" className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm font-semibold disabled:opacity-50" disabled={loading||ticketBusy||!online} onClick={()=>void refresh()}>Refresh station tickets</button>}/>
    <p className="rounded-lg border border-amber-800 p-3 text-sm text-amber-100">Read-only saved tickets. Kitchen acknowledgement, preparation, serving, printing and paper delivery are unavailable. Refresh to check for newer tickets.</p>
    {(!online||stale)&&<p role="alert" className="rounded-lg border border-amber-800 p-3 text-sm text-amber-100">{!online?'You are offline. These saved tickets may be out of date.':loading||ticketBusy?'Ticket access and freshness are being checked. Existing rows may be out of date.':'Ticket access or freshness could not be confirmed. Refresh station tickets before using these records.'}</p>}
    {error&&<p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{error}</p>}{loading&&<p role="status" className="text-sm text-zinc-400">Loading station access…</p>}
    <nav aria-label="Authorized ticket stations" className="flex flex-wrap gap-2">{stations.map(station=><button type="button" key={station.id} disabled={loading||ticketBusy||!online} aria-pressed={selected===station.id} className={`min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50 ${selected===station.id?'border-blue-500 bg-blue-950 text-blue-100':'border-zinc-700'}`} onClick={()=>{selectedRef.current=station.id;setSelected(station.id);setTickets([]);setPage(undefined);query.current='';setStale(true);void readFeed(station.id);}}>{station.name}</button>)}</nav>
    {!loading&&!stations.length&&!error&&<p className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">No preparation stations are assigned to this workspace. Ask a manager to review its station access.</p>}
    {ticketBusy&&<p role="status" className="text-sm text-zinc-400">Loading saved station tickets…</p>}
    <RestaurantTicketCards tickets={tickets} timeZone={timeZone}/>
    {selected&&<HistoryNavigation label="station tickets" page={page} loaded={tickets.length} busy={loading||ticketBusy||!online} onSearch={q=>void readFeed(selected,{q})} onMore={()=>void readFeed(selected,{q:query.current,after:page?.nextCursor??undefined},true)}/>}
  </div>;
}
