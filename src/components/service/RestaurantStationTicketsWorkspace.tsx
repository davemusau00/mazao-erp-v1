import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ApiClientError, type BackendCommand } from '../../services/apiClient';
import type { RestaurantOrderStation, RestaurantOrderTicket, RestaurantTicketState } from '../../types/restaurantOrders';
import type { HistoryOptions, HistoryPage } from '../../types/history';
import { useCommandRecoveryReadiness } from '../../hooks/useCommandRecoveryReadiness';
import { CommandRecoveryReadiness } from '../common/CommandRecoveryReadiness';
import { HistoryNavigation } from '../common/HistoryNavigation';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';
import { RestaurantTicketCards } from './RestaurantTicketCards';

const nextStatus:Record<RestaurantTicketState,Exclude<RestaurantTicketState,'NEW'>|null>={NEW:'ACKNOWLEDGED',ACKNOWLEDGED:'PREPARING',PREPARING:'READY',READY:null};
const ticketCommands=['restaurant.ticket.advance'] as const;

export function RestaurantStationTicketsWorkspace(){
  const session=apiClient.getSession()!,timeZone=session.outlet.timeZone??session.tenant.timeZone;
  const [stations,setStations]=useState<RestaurantOrderStation[]>([]),[selected,setSelected]=useState(''),[tickets,setTickets]=useState<RestaurantOrderTicket[]>([]),[page,setPage]=useState<HistoryPage>();
  const [loading,setLoading]=useState(true),[ticketBusy,setTicketBusy]=useState(false),[error,setError]=useState(''),[online,setOnline]=useState(navigator.onLine),[stale,setStale]=useState(true);
  const [busyTicket,setBusyTicket]=useState(''),[unknownId,setUnknownId]=useState(''),[actionError,setActionError]=useState('');
  const selectedRef=useRef(''),query=useRef(''),generation=useRef(0),feedGeneration=useRef(0),mounted=useRef(true),controller=useRef<AbortController|null>(null);
  const pending=useRef<BackendCommand|null>(null),canWork=session.user.permissions.includes('restaurant.ticket.work');
  const recovery=useCommandRecoveryReadiness('restaurant.ticket.',command=>{pending.current=command;setUnknownId(command.commandId);setActionError('A kitchen action needs review. Check its status before updating the ticket again.');},ticketCommands);
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
  useEffect(()=>{if(!online||!selected||loading||ticketBusy||busyTicket||unknownId)return;const timer=window.setInterval(()=>{if(!ticketBusy)void readFeed(selectedRef.current,{q:query.current});},8000);return()=>window.clearInterval(timer);},[online,selected,loading,ticketBusy,busyTicket,unknownId,readFeed]);
  const advance=async(ticket:RestaurantOrderTicket)=>{
    const toStatus=nextStatus[ticket.status];if(!canWork||!toStatus||!online||unknownId||!recovery.ready||!recovery.begin())return;
    const command:BackendCommand={protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type:'restaurant.ticket.advance',occurredAt:new Date().toISOString(),expectedVersions:{['ticket:'+ticket.id]:ticket.stateVersion},payload:{ticketId:ticket.id,fromStatus:ticket.status,toStatus}};
    pending.current=command;setBusyTicket(ticket.id);setActionError('');setStale(true);
    try{
      const result=await apiClient.submitCommand(command);pending.current=null;
      if(result.status!=='CONFIRMED'||result.value?.ticketId!==ticket.id||result.value?.status!==toStatus||Number(result.value?.version)!==ticket.stateVersion+1){setActionError(result.message??'The kitchen state did not advance. Refresh the ticket before trying again.');await readFeed(selectedRef.current,{q:query.current});return;}
      await readFeed(selectedRef.current,{q:query.current});
    }catch(cause){const code=(cause as {code?:string}).code;if(code==='COMMAND_NOT_SENT'){pending.current=null;setActionError(cause instanceof Error?cause.message:'The ticket update was not sent.');}else{setUnknownId(command.commandId);setActionError('This ticket update is unconfirmed. Check the original action status before continuing.');}}
    finally{recovery.finish();if(mounted.current)setBusyTicket('');}
  };
  const checkPending=async()=>{
    if(!unknownId||!recovery.begin())return;setActionError('');
    try{await apiClient.checkCommandStatus(unknownId);pending.current=null;setUnknownId('');await recovery.inspect();await readFeed(selectedRef.current,{q:query.current});}
    catch(cause){setActionError(cause instanceof Error?cause.message:'The original kitchen action status is still unavailable. Keep this ticket unchanged and retry the status check.');}
    finally{recovery.finish();}
  };
  const actionsDisabled=!online||stale||!recovery.ready||!!recovery.error||!!unknownId||!!busyTicket;
  return <div className="page-stack"><WorkspaceHeading eyebrow={session.outlet.name} title="Station tickets" description="Review assigned preparation tickets and update their server-recorded kitchen status." action={<button type="button" className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm font-semibold disabled:opacity-50" disabled={loading||ticketBusy||!online} onClick={()=>void refresh()}>Refresh station tickets</button>}/>
    <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={()=>void recovery.inspect()}/>
    <p className="rounded-lg border border-amber-800 p-3 text-sm text-amber-100">Kitchen staff can acknowledge, start and mark tickets ready on an assigned station. Paper printing and physical delivery are not yet available.</p>
    {(!online||stale)&&<p role="alert" className="rounded-lg border border-amber-800 p-3 text-sm text-amber-100">{!online?'You are offline. These saved tickets may be out of date.':loading||ticketBusy?'Ticket access and freshness are being checked. Existing rows may be out of date.':'Ticket access or freshness could not be confirmed. Refresh station tickets before using these records.'}</p>}
    {error&&<p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{error}</p>}{actionError&&<p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{actionError}</p>}
    {unknownId&&<button type="button" className="min-h-11 rounded-lg border border-amber-700 px-4 font-semibold text-amber-100 disabled:opacity-50" disabled={busyTicket!==''||!online} onClick={()=>void checkPending()}>Check original ticket action status</button>}
    {loading&&<p role="status" className="text-sm text-zinc-400">Loading station access...</p>}
    <nav aria-label="Authorized ticket stations" className="flex flex-wrap gap-2">{stations.map(station=><button type="button" key={station.id} disabled={loading||ticketBusy||!online} aria-pressed={selected===station.id} className={`min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50 ${selected===station.id?'border-blue-500 bg-blue-950 text-blue-100':'border-zinc-700'}`} onClick={()=>{selectedRef.current=station.id;setSelected(station.id);setTickets([]);setPage(undefined);query.current='';setStale(true);void readFeed(station.id);}}>{station.name}</button>)}</nav>
    {!loading&&!stations.length&&!error&&<p className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">No preparation stations are assigned to this workspace. Ask a manager to review its station access.</p>}
    {ticketBusy&&<p role="status" className="text-sm text-zinc-400">Loading saved station tickets...</p>}
    <RestaurantTicketCards tickets={tickets} timeZone={timeZone} onAdvance={canWork?advance:undefined} busyTicket={busyTicket} actionsDisabled={actionsDisabled}/>
    {selected&&<HistoryNavigation label="station tickets" page={page} loaded={tickets.length} busy={loading||ticketBusy||!online} onSearch={q=>void readFeed(selected,{q})} onMore={()=>void readFeed(selected,{q:query.current,after:page?.nextCursor??undefined},true)}/>}
  </div>;
}
