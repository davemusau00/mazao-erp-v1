import React, { useEffect, useRef, useState } from 'react';
import { apiClient, type BackendOperatorSession } from '../../services/apiClient';
import { IdentityNotices, identityButton, identityCommand, identityInput, useIdentityCommands } from './identityUi';
import { HistoryNavigation } from '../common/HistoryNavigation';
import type { HistoryPage } from '../../types/history';

export function OperatorSessionsPanel({userId,onVersion}:{userId:string;onVersion?:(version:number)=>void}) {
  const session=apiClient.getSession()!;const own=userId===session.user.id;
  const canRevoke=own||session.user.permissions.includes('staff.manage');
  const [sessions,setSessions]=useState<BackendOperatorSession[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const [page,setPage]=useState<HistoryPage>();const [query,setQuery]=useState('');const generation=useRef(0);const pendingRead=useRef<AbortController|null>(null);
  const [target,setTarget]=useState<BackendOperatorSession|null>(null);const [reason,setReason]=useState('');
  const zone=session.outlet.timeZone??session.tenant.timeZone;
  const load=async(more=false,search=query)=>{
    pendingRead.current?.abort();const abort=new AbortController();pendingRead.current=abort;const current=++generation.current;
    setLoading(true);setError('');
    try{const options={q:search,...(more&&page?.nextCursor?{after:page.nextCursor}:{})};const result=own?await apiClient.getOwnSessions(abort.signal,options):await apiClient.getStaffSessions(userId,abort.signal,options);if(current!==generation.current)return;setQuery(search);setSessions(existing=>more?[...existing,...result.sessions.filter(record=>!existing.some(known=>known.id===record.id))]:result.sessions);setPage(result.page);onVersion?.(result.credentialVersion);}
    catch(cause){if(current===generation.current&&(cause as {code?:string}).code!=='REQUEST_CANCELLED')setError(cause instanceof Error?cause.message:'Sessions could not be loaded.');}
    finally{if(current===generation.current)setLoading(false);if(pendingRead.current===abort)pendingRead.current=null;}
  };
  const controller=useIdentityCommands([own?'auth.session.revoke':'staff.sessions.revoke'],async()=>{setTarget(null);setReason('');await load();await apiClient.restore();},userId);
  useEffect(()=>{setTarget(null);setReason('');setQuery('');setSessions([]);setPage(undefined);void load(false,'');return()=>{generation.current++;pendingRead.current?.abort();};},[userId]);
  const revoke=()=>{
    if(!target||!canRevoke||controller.locked)return;
    if(!reason.trim()){controller.setError('Enter a reason for signing out this session.');return;}
    void controller.send(identityCommand(own?'auth.session.revoke':'staff.sessions.revoke',{...(!own?{userId}:{}),sessionId:target.id,reason:reason.trim()},{['session:'+target.id]:target.version}));
  };
  const date=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:zone});
  return <section className="space-y-4 rounded-xl border border-zinc-700 p-4" aria-label="Operator sessions">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold">{own?'My sessions':'Operator sessions'}</h3><p className="mt-1 text-xs text-zinc-400">Times in {zone}. Review where this account is signed in and when each sign-in expires.</p></div><button type="button" className={identityButton} disabled={loading||controller.busy} onClick={()=>void load()}>Refresh sessions</button></div>
    <IdentityNotices controller={controller} onReload={()=>{void load().then(()=>{controller.clearConflict();setTarget(null);});}}/>
    {error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}
    {loading?<p role="status" className="py-4 text-sm text-zinc-400">Loading sessions…</p>:sessions.length===0?<p className="py-4 text-sm text-zinc-400">No sessions recorded for this operator.</p>:<div className="space-y-3">{sessions.map(record=>{
      const ended=Boolean(record.revokedAt)||new Date(record.expiresAt).getTime()<=Date.now();
      return <article key={record.id} className="rounded-xl border border-zinc-800 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words text-sm font-semibold">{record.deviceLabel} · {record.outletName}</h4><p className="mt-1 text-xs text-zinc-400">{record.current?'This session · ':''}{record.revokedAt?'Signed out':ended?'Expired':'Access not revoked'}</p><p className="mt-2 text-xs text-zinc-400">Created {date(record.createdAt)}<br/>Expires {date(record.expiresAt)}{record.revokedAt&&<><br/>Signed out {date(record.revokedAt)}</>}</p></div>{canRevoke&&!ended&&<button type="button" className={identityButton} disabled={controller.locked} aria-label={'Sign out session '+record.deviceLabel} onClick={()=>{setTarget(record);setReason('');}}>Sign out session</button>}</div></article>;
    })}</div>}
    <HistoryNavigation page={page} loaded={sessions.length} busy={loading} label="operator sessions" onMore={()=>void load(true)} onSearch={value=>void load(false,value)}/>
    {target&&<form className="space-y-3 rounded-xl border border-amber-800 p-4" onSubmit={event=>{event.preventDefault();revoke();}}><h4 className="font-semibold">Sign out {target.deviceLabel}</h4><p className="text-sm text-zinc-400">{target.current?'This browser will return to sign-in.':'The selected session will be signed out.'}</p><label className="block text-sm text-zinc-300">Session sign-out reason<input aria-label="Session sign-out reason" className={identityInput} value={reason} maxLength={200} required disabled={controller.locked} onChange={event=>setReason(event.target.value)}/></label><div className="flex flex-wrap gap-2"><button type="button" className={identityButton} disabled={controller.busy||Boolean(controller.pending)} onClick={()=>setTarget(null)}>Cancel session sign-out</button><button type="submit" className={identityButton+' border-rose-700 text-rose-200'} disabled={controller.locked}>Confirm session sign-out</button></div></form>}
  </section>;
}
