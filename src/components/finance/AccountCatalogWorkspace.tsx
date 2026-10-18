import React,{useCallback,useEffect,useRef,useState} from 'react';
import {apiClient,type BackendCommand} from '../../services/apiClient';
import type {AccountCatalog} from '../../types/accountCatalog';

const button='min-h-11 rounded-lg border border-zinc-700 px-3 text-sm disabled:opacity-50';
const input='min-h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100';

export function AccountCatalogWorkspace(){
  const session=apiClient.getSession()!;
  const [catalog,setCatalog]=useState<AccountCatalog|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [editing,setEditing]=useState<string|null>(null),[label,setLabel]=useState(''),[saving,setSaving]=useState(false),[pending,setPending]=useState<BackendCommand|null>(null),[recoveryReady,setRecoveryReady]=useState(false);
  const mounted=useRef(true),inFlight=useRef(false);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setBusy(true);setError('');
    try{const result=await apiClient.getAccountCatalog(signal);if(!signal?.aborted)setCatalog(result);}
    catch(cause){if(!signal?.aborted)setError(cause instanceof Error?cause.message:'Account names could not be loaded.');}
    finally{if(!signal?.aborted)setBusy(false);}
  },[]);
  useEffect(()=>{mounted.current=true;const controller=new AbortController();void load(controller.signal);void apiClient.listRecoverableCommands(session.tenant.id).then(records=>{if(!mounted.current)return;const found=records.find(row=>row.command.type==='finance.account.label'&&row.command.deviceId===session.deviceId);if(found){setPending(found.command);setNotice('An account name change needs review. Check its status before making another change.');}setRecoveryReady(true);}).catch(()=>{if(mounted.current){setNotice('Saved account changes could not be checked on this device.');setRecoveryReady(true);}});return()=>{mounted.current=false;controller.abort();};},[load,session.tenant.id,session.deviceId]);
  const finish=(result:{status?:string;message?:string})=>{
    if(!mounted.current)return;
    if(result.status==='CONFIRMED'){setPending(null);setEditing(null);setNotice('Account name updated. Reports and balances are refreshing.');void load();}
    else if(result.status==='REJECTED'||result.status==='CONFLICT'){setPending(null);setNotice(result.message??'The account name was not changed. Refresh the list and review the details.');}
    else setNotice('This account name change is not confirmed. Check its status before trying again.');
  };
  const send=async(command:BackendCommand)=>{
    if(inFlight.current)return;inFlight.current=true;setSaving(true);setPending(command);setNotice('');
    try{finish(await apiClient.submitCommand(command));}
    catch(cause){if(mounted.current){if((cause as{code?:string}).code==='COMMAND_NOT_SENT')setPending(null);setNotice(cause instanceof Error?cause.message:'The account name change could not be confirmed. Check its status.');}}
    finally{inFlight.current=false;if(mounted.current)setSaving(false);}
  };
  const recover=async()=>{
    if(!pending||inFlight.current)return;inFlight.current=true;setSaving(true);
    try{try{finish((await apiClient.checkCommandStatus(pending.commandId)).response as {status?:string;message?:string});}
      catch(cause){if((cause as{status?:number}).status!==404)throw cause;finish(await apiClient.submitCommand(pending));}}
    catch(cause){if(mounted.current)setNotice(cause instanceof Error?cause.message:'The account name status could not be checked. Try again.');}
    finally{inFlight.current=false;if(mounted.current)setSaving(false);}
  };
  const save=()=>{
    const account=catalog?.accounts.find(row=>row.accountCode===editing);if(!account||!catalog||!label.trim()||label.trim().length>120||pending||saving)return;
    void send({protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type:'finance.account.label',occurredAt:new Date().toISOString(),expectedVersions:{[`account-catalog:${session.tenant.id}`]:catalog.version},payload:{accountCode:account.accountCode,label:label.trim()}});
  };
  const locked=busy||saving||!!pending||!recoveryReady;
  return <section className="space-y-4 p-4 pb-24 text-zinc-100 sm:p-6" aria-labelledby="account-catalog-title">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 id="account-catalog-title" className="text-2xl font-semibold">Account names</h1><p className="mt-1 text-sm text-zinc-400">Version {catalog?.version??'—'} · display names only. Account classes and posted records do not change.</p></div><button type="button" disabled={busy||saving} onClick={()=>void load()} className={button}>Refresh</button></header>
    {!recoveryReady&&<p role="status" className="text-sm text-zinc-400">Checking saved account changes…</p>}
    {pending&&<div role="alert" className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm">An account name change has an unknown result. Check its status before making another change. <button type="button" disabled={saving} onClick={()=>void recover()} className="ml-2 min-h-11 underline">Check status</button></div>}
    {notice&&!pending&&<p role="status" className="rounded-lg border border-zinc-800 p-3 text-sm">{notice}</p>}
    {error&&<p role="alert" className="rounded-lg border border-rose-900 p-3 text-sm text-rose-200">{error}<button type="button" onClick={()=>void load()} className="ml-2 min-h-11 underline">Try again</button></p>}
    {busy&&<p role="status" className="text-sm text-zinc-400">{catalog?'Refreshing account names. Earlier results remain visible.':'Loading account names…'}</p>}
    {catalog&&<div className="overflow-x-auto rounded-xl border border-zinc-800"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-zinc-900 text-xs text-zinc-400"><tr><th className="p-3">Account name</th><th className="p-3">Class</th><th className="p-3">System account</th><th className="p-3 text-right">Action</th></tr></thead><tbody>{catalog.accounts.map(account=><tr key={account.accountCode} className="border-t border-zinc-800"><td className="p-3"><strong>{account.label}</strong><span className="ml-2 text-xs text-zinc-500">{account.accountCode}</span>{editing===account.accountCode&&<div className="mt-2 flex flex-wrap gap-2"><input autoFocus aria-label={`Display name for ${account.accountCode}`} value={label} maxLength={120} onChange={event=>setLabel(event.target.value)} className={input}/><button type="button" disabled={locked||!label.trim()} onClick={save} className={`${button} border-blue-700 bg-blue-950`}>{saving?'Saving…':'Save name'}</button><button type="button" disabled={saving} onClick={()=>setEditing(null)} className={button}>Cancel</button></div>}</td><td className="p-3">{account.classification.replaceAll('_',' ').toLowerCase()}</td><td className="p-3">Yes</td><td className="p-3 text-right">{catalog.permissions.manage&&editing!==account.accountCode&&<button type="button" disabled={locked} onClick={()=>{setEditing(account.accountCode);setLabel(account.label);setNotice('');}} className={button}>Rename</button>}</td></tr>)}</tbody></table></div>}
    <p className="text-xs text-zinc-500">Names are saved as dated catalogue versions. This screen cannot change account classifications or redirect financial postings.</p>
  </section>;
}
