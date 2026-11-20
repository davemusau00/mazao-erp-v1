import { useEffect, useRef, useState } from 'react';
import { apiClient, type BackendCommand, type BackendCommandResult } from '../../services/apiClient';
import { useCommandRecoveryNavigation } from '../../app/CommandRecoveryNavigation';

export const identityButton='inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50';
export const identityInput='mt-2 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 disabled:opacity-50';
export function identityCommand(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):BackendCommand {
  const session=apiClient.getSession()!;
  return {protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload};
}
export function useUnsavedIdentityChanges(dirty:boolean){
  useEffect(()=>{
    const unload=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};
    const navigate=(event:Event)=>{if(dirty&&!window.confirm('Discard unsaved access settings?'))event.preventDefault();};
    window.addEventListener('beforeunload',unload);window.addEventListener('mazao:before-navigate',navigate);
    return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('mazao:before-navigate',navigate);};
  },[dirty]);
}
export function useIdentityCommands(types:string[],onConfirmed:(command:BackendCommand,result:BackendCommandResult)=>Promise<void>,targetUserId?:string) {
  const session=apiClient.getSession()!;
  const recoveryNavigation=useCommandRecoveryNavigation();
  const [ready,setReady]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [message,setMessage]=useState('');const [conflict,setConflict]=useState(false);const [pending,setPending]=useState<BackendCommand|null>(null);
  const callback=useRef(onConfirmed);callback.current=onConfirmed;const inFlight=useRef(false);const mounted=useRef(true);const recoveryRead=useRef(0);
  const typesKey=types.join('|');
  const restore=async()=>{
    const request=++recoveryRead.current;
    setReady(false);setError('');setPending(null);setMessage('');
    try {
      const records=await apiClient.listRecoverableCommands(session.tenant.id);
      const matching=records.filter(record=>{
        if(!types.includes(record.command.type)||record.actorId!==session.user.id||record.command.tenantId!==session.tenant.id||record.command.deviceId!==session.deviceId)return false;
        if(!targetUserId)return true;
        if(record.command.type==='auth.session.revoke')return targetUserId===session.user.id;
        return record.command.payload.userId===targetUserId;
      });
      const retained=matching.find(record=>record.command.commandId===recoveryNavigation?.record.command.commandId)??matching[0];
      if(!mounted.current||request!==recoveryRead.current)return;
      setPending(retained?.command??null);setReady(true);
      if(retained)setMessage('An access change needs review. Check its status before making another change.');
    }catch(cause){if(mounted.current&&request===recoveryRead.current)setError(cause instanceof Error?cause.message:'We could not check for unfinished access changes.');}
  };
  useEffect(()=>{mounted.current=true;setConflict(false);void restore();return()=>{mounted.current=false;++recoveryRead.current;};},[session.tenant.id,session.user.id,session.deviceId,targetUserId,typesKey,recoveryNavigation?.requestId]);
  useEffect(()=>{
    const navigate=(event:Event)=>{if(inFlight.current)event.preventDefault();};
    const unload=(event:BeforeUnloadEvent)=>{if(inFlight.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('mazao:before-navigate',navigate);window.addEventListener('mazao:before-account-open',navigate);window.addEventListener('mazao:before-context-switch',navigate);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener('mazao:before-navigate',navigate);window.removeEventListener('mazao:before-account-open',navigate);window.removeEventListener('mazao:before-context-switch',navigate);window.removeEventListener('beforeunload',unload);};
  },[]);
  const acknowledge=async(command:BackendCommand,result:BackendCommandResult)=>{
    if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status))setPending(null);
    if(result.status==='CONFIRMED'){setConflict(false);setMessage('Access change completed.');await callback.current(command,result);}
    else if(result.status==='CONFLICT'){setConflict(true);setError(result.message??'These records changed. Reload current access settings before saving again.');}
    else if(result.status==='REJECTED'){setError(result.message??'Access was not changed. Review the form before trying again.');}
    else{setPending(command);setMessage('We could not confirm this change. Check its status before trying again.');}
  };
  const send=async(command:BackendCommand)=>{
    if(inFlight.current||!ready)return;
    inFlight.current=true;setBusy(true);setError('');setMessage('');
    try{await acknowledge(command,await apiClient.submitCommand(command));}
    catch(cause){
      if((cause as {code?:string}).code==='COMMAND_NOT_SENT'){setPending(null);setError(cause instanceof Error?cause.message:'This action was not sent.');}
      else{setPending(command);setMessage(cause instanceof Error?cause.message:'We could not confirm this change. Check its status before trying again.');}
    }finally{inFlight.current=false;setBusy(false);}
  };
  const check=async()=>{
    if(!pending||inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');
    try{const result=await apiClient.checkCommandStatus(pending.commandId);await acknowledge(pending,{commandId:pending.commandId,status:result.status,...result.response});}
    catch(cause){setError(cause instanceof Error?cause.message:'We could not check status. The original action details remain saved.');}
    finally{inFlight.current=false;setBusy(false);}
  };
  return {ready,busy,error,message,conflict,pending,locked:!ready||busy||Boolean(pending)||conflict,restore,send,check,clearConflict:()=>{setConflict(false);setError('');},setError};
}
export type IdentityController=ReturnType<typeof useIdentityCommands>;
export function IdentityNotices({controller,onReload}:{controller:IdentityController;onReload?:()=>void}) {
  const recoveryNavigation=useCommandRecoveryNavigation();
  const pendingRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(controller.pending?.commandId===recoveryNavigation?.record.command.commandId)pendingRef.current?.focus();
  },[controller.pending?.commandId,recoveryNavigation?.requestId]);
  return <>
    {controller.busy&&<p role="status" className="rounded-lg border border-blue-800 p-3 text-sm text-blue-200">Waiting for the server access response. Keep this operation open until the request finishes.</p>}
    {!controller.ready&&<div role={controller.error?'alert':'status'} className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">{controller.error||'Checking for unfinished access changes...'}{controller.error&&<button type="button" className={identityButton+' ml-2'} onClick={()=>void controller.restore()}>Retry access recovery</button>}</div>}
    {controller.ready&&controller.error&&<p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{controller.error}</p>}
    {controller.message&&<p role="status" className="rounded-lg border border-blue-800 p-3 text-sm text-blue-200">{controller.message}</p>}
    {controller.pending&&<section ref={pendingRef} tabIndex={-1} role="region" aria-label="Retained access command" className="rounded-xl border border-amber-800 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><h3 className="font-semibold">Check access change status</h3><details className="mt-2 text-xs text-zinc-400"><summary className="min-h-9 cursor-pointer py-2">Support reference</summary><p className="mt-2 break-all font-mono text-xs text-zinc-400">Reference {controller.pending.commandId}</p></details><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={identityButton} disabled={controller.busy} onClick={()=>void controller.check()}>Check access change status</button><button type="button" className={identityButton} disabled={controller.busy} onClick={()=>controller.pending&&void controller.send(controller.pending)}>Retry original access change</button></div></section>}
    {controller.conflict&&onReload&&<button type="button" className={identityButton+' self-start'} onClick={onReload}>Reload current access settings</button>}
  </>;
}
