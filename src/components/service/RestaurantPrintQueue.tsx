import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ApiClientError, type BackendCommand } from '../../services/apiClient';
import type { RestaurantPrintJob, RestaurantPrintJobStatus } from '../../types/restaurantOrders';
import { useCommandRecoveryReadiness } from '../../hooks/useCommandRecoveryReadiness';
import { CommandRecoveryReadiness } from '../common/CommandRecoveryReadiness';
import { RestaurantPrintDocument } from './RestaurantPrintDocument';

const printCommands=['restaurant.print.job.claim','restaurant.print.job.confirm','restaurant.print.job.fail','restaurant.print.job.copy'] as const;
type PrintCommand=typeof printCommands[number];
const statusLabel:Record<RestaurantPrintJobStatus,string>={QUEUED:'Waiting to print',CLAIMED:'Print attempt in progress',OPERATOR_CONFIRMED:'Operator confirmed paper output',FAILED:'Print failure reported'};

export function RestaurantPrintQueue({stationId,timeZone,online}:{stationId:string;timeZone:string;online:boolean}){
  const session=apiClient.getSession()!,canWork=session.user.permissions.includes('restaurant.ticket.work');
  const [jobs,setJobs]=useState<RestaurantPrintJob[]>([]),[pendingCount,setPendingCount]=useState(0),[loading,setLoading]=useState(false),[stale,setStale]=useState(true),[error,setError]=useState(''),[actionError,setActionError]=useState('');
  const [busyJob,setBusyJob]=useState(''),[unknownId,setUnknownId]=useState(''),[printJobId,setPrintJobId]=useState(''),[dialogClosed,setDialogClosed]=useState(false),[failureReason,setFailureReason]=useState('');
  const mounted=useRef(true),pending=useRef<BackendCommand|null>(null),request=useRef(0);
  const recovery=useCommandRecoveryReadiness('restaurant.print.job.',command=>{pending.current=command;setUnknownId(command.commandId);setActionError('A printer action needs review. Check the original command status before taking another print action.');},printCommands);
  const refresh=useCallback(async()=>{
    if(!stationId||!online){setStale(true);return;}
    const current=++request.current;setLoading(true);setError('');
    try{const result=await apiClient.listRestaurantStationPrintJobs(stationId);if(!mounted.current||request.current!==current)return;setJobs(result.jobs);setPendingCount(result.pendingCount);setStale(false);}
    catch(cause){if(!mounted.current||request.current!==current)return;if(cause instanceof ApiClientError&&(cause.status===401||cause.status===403)){setJobs([]);setPendingCount(0);}setStale(true);setError(cause instanceof Error?cause.message:'The station print queue could not load. Refresh and retry.');}
    finally{if(mounted.current&&request.current===current)setLoading(false);}
  },[stationId,online]);
  useEffect(()=>{mounted.current=true;setJobs([]);setPendingCount(0);setStale(true);setPrintJobId('');setDialogClosed(false);void refresh();return()=>{mounted.current=false;++request.current;};},[stationId,refresh]);
  useEffect(()=>{if(!online||!stationId||busyJob||unknownId)return;const timer=window.setInterval(()=>void refresh(),8000);return()=>window.clearInterval(timer);},[online,stationId,busyJob,unknownId,refresh]);
  useEffect(()=>{const after=()=>setDialogClosed(true);window.addEventListener('afterprint',after);return()=>window.removeEventListener('afterprint',after);},[]);
  const run=async(type:PrintCommand,payload:Record<string,unknown>,expectedVersions:Record<string,number>={})=>{
    if(!canWork||!online||stale||unknownId||!recovery.ready||recovery.error||!recovery.begin())return;
    const command:BackendCommand={protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload};
    pending.current=command;setBusyJob(String(payload.jobId??payload.ticketId));setActionError('');
    try{const result=await apiClient.submitCommand(command);pending.current=null;if(result.status!=='CONFIRMED'){setActionError(result.message??'The printer queue did not confirm this action. Refresh before continuing.');await refresh();return;}await refresh();setDialogClosed(false);setFailureReason('');}
    catch(cause){const code=(cause as {code?:string}).code;if(code==='COMMAND_NOT_SENT'){pending.current=null;setActionError(cause instanceof Error?cause.message:'The print action was not sent.');}else{setUnknownId(command.commandId);setActionError('This print action is unconfirmed. Check the status of the original command before continuing.');}}
    finally{recovery.finish();if(mounted.current)setBusyJob('');}
  };
  const checkPending=async()=>{if(!unknownId||!recovery.begin())return;setActionError('');try{await apiClient.checkCommandStatus(unknownId);pending.current=null;setUnknownId('');await recovery.inspect();await refresh();}catch(cause){setActionError(cause instanceof Error?cause.message:'The original print command status is still unavailable. Keep the queue unchanged and retry the status check.');}finally{recovery.finish();}};
  const actionsDisabled=!canWork||!online||stale||loading||!!busyJob||!!unknownId||!recovery.ready||!!recovery.error;
  const printJob=jobs.find(job=>job.id===printJobId&&job.status==='CLAIMED'&&job.claimId!==null);
  return <section className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-950 p-4" aria-labelledby="restaurant-print-queue-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="restaurant-print-queue-title" className="text-lg font-semibold">KOT / BOT print queue</h2><p className="mt-1 text-sm text-zinc-400">A queued job is durable. A green result means an operator reported paper output; it is not printer telemetry.</p></div><button type="button" className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm font-semibold disabled:opacity-50" disabled={!online||loading} onClick={()=>void refresh()}>Refresh print queue</button></div>
    <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={()=>void recovery.inspect()}/>
    {pendingCount>0&&<p className="text-sm text-amber-100" role="status">{pendingCount} print {pendingCount===1?'job is':'jobs are'} queued or in progress.</p>}
    {pendingCount>250&&<p className="rounded-lg border border-amber-800 p-3 text-sm text-amber-100">The queue is larger than the visible 250-job window. Work the oldest jobs first and refresh to load the remainder.</p>}
    {(!online||stale)&&<p role="alert" className="rounded-lg border border-amber-800 p-3 text-sm text-amber-100">{!online?'Printing requires a live connection. The server queue is unchanged.':'The print queue is stale. Refresh and confirm station access before using it.'}</p>}
    {error&&<p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{error}</p>}{actionError&&<p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{actionError}</p>}
    {unknownId&&<button type="button" className="min-h-11 rounded-lg border border-amber-700 px-4 font-semibold text-amber-100 disabled:opacity-50" disabled={!online||!!busyJob} onClick={()=>void checkPending()}>Check original printer action status</button>}
    {loading&&<p role="status" className="text-sm text-zinc-400">Loading station print jobs…</p>}
    {!loading&&jobs.length===0&&!error&&<p className="text-sm text-zinc-400">No KOT or BOT print jobs are recorded for this station.</p>}
    <ul className="space-y-3">{jobs.map(job=>{
      const ownsClaim=job.status==='CLAIMED'&&!!job.claimId;
      const expected={['printJob:'+job.id]:job.version};
      return <li key={job.id} className="space-y-3 rounded-lg border border-zinc-800 p-3" data-testid={`restaurant-print-job-${job.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{job.jobType==='COPY'?`Copy ${job.copyNumber}`:job.jobType==='ADD_ON'?'Add-on ticket':'New ticket'} · {job.documentSnapshot.station.name}</p><p className="text-sm text-zinc-300">{job.documentSnapshot.tableName??'Takeaway / counter'} · {job.documentSnapshot.serviceLabel}</p><p className="text-xs text-zinc-400">{statusLabel[job.status]} · {new Date(job.outcomeAt??job.createdAt).toLocaleString(undefined,{timeZone})}</p>{(job.status==='OPERATOR_CONFIRMED'||job.status==='FAILED')&&<p className="text-xs text-zinc-300">Reported by {job.outcomeByName??'operator'}{job.failureReason?` · Reason: ${job.failureReason}`:''}</p>}</div><span className="rounded-full border border-zinc-700 px-3 py-1 text-xs" aria-label={`Print status ${job.status}`}>{job.status.replaceAll('_',' ')}</span></div>
        {job.status==='CLAIMED'&&!ownsClaim&&<div className="space-y-2"><p className="text-sm text-amber-100">{job.claimedByName||'Another operator'} has this short print lease until {job.claimExpiresAt?new Date(job.claimExpiresAt).toLocaleTimeString(undefined,{timeZone}):'it expires'}. The server checks expiry before allowing another claim.</p><button type="button" className="min-h-11 rounded-lg border border-amber-700 px-4 text-sm font-semibold text-amber-100 disabled:opacity-50" disabled={actionsDisabled} onClick={()=>void run('restaurant.print.job.claim',{jobId:job.id},expected)}>{busyJob===job.id?'Checking print lease…':'Try to claim or reclaim print job'}</button></div>}
        {job.status==='QUEUED'&&<button type="button" className="min-h-11 rounded-lg border border-blue-700 bg-blue-950 px-4 text-sm font-semibold text-blue-100 disabled:opacity-50" disabled={actionsDisabled} onClick={()=>void run('restaurant.print.job.claim',{jobId:job.id},expected)}>{busyJob===job.id?'Claiming print job…':'Claim print job'}</button>}
        {ownsClaim&&<div className="space-y-3 rounded-lg border border-blue-900 p-3">
          <p className="text-sm text-blue-100">This browser holds the print lease. Prepare the 80 mm document, open the system dialog, inspect the paper, then record the operator outcome.</p>
          {printJobId!==job.id?<button type="button" className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm font-semibold" onClick={()=>{setPrintJobId(job.id);setDialogClosed(false);setFailureReason('');}}>Prepare 80 mm ticket</button>:<button type="button" className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm font-semibold" onClick={()=>{setDialogClosed(false);window.print();setDialogClosed(true);}}>Open 80 mm print dialog</button>}
          {dialogClosed&&printJobId===job.id&&<div className="space-y-3"><p className="text-sm text-amber-100">Confirm only after checking the paper output. Cancelled dialogs and printer failures must be reported as failures.</p><div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-lg border border-emerald-700 px-4 text-sm font-semibold text-emerald-100 disabled:opacity-50" disabled={actionsDisabled} onClick={()=>void run('restaurant.print.job.confirm',{jobId:job.id,claimId:job.claimId!},expected)}>Confirm paper printed</button></div><label className="block text-sm">Failure reason<input className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3" maxLength={300} value={failureReason} onChange={event=>setFailureReason(event.target.value)}/></label><button type="button" className="min-h-11 rounded-lg border border-rose-800 px-4 text-sm font-semibold text-rose-200 disabled:opacity-50" disabled={actionsDisabled||!failureReason.trim()} onClick={()=>void run('restaurant.print.job.fail',{jobId:job.id,claimId:job.claimId!,reason:failureReason.trim()},expected)}>Report print failure</button></div>}
        </div>}
        {(job.status==='OPERATOR_CONFIRMED'||job.status==='FAILED')&&<button type="button" className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm font-semibold disabled:opacity-50" disabled={actionsDisabled} onClick={()=>void run('restaurant.print.job.copy',{ticketId:job.ticketId})}>Create clearly marked reprint copy</button>}
      </li>;
    })}</ul>
    {printJob&&<RestaurantPrintDocument job={printJob} timeZone={timeZone}/>}
    <p className="text-xs text-zinc-500">This web print workflow does not report USB/network printer state. Physical printer, cutter, paper-out and duplicate-output acceptance remain separate hardware checks.</p>
  </section>;
}
