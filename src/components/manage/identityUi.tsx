import { useEffect, useRef, useState } from 'react';
import { apiClient, type BackendCommand, type BackendCommandResult } from '../../services/apiClient';

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
  const [ready,setReady]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [message,setMessage]=useState('');const [conflict,setConflict]=useState(false);const [pending,setPending]=useState<BackendCommand|null>(null);
  const callback=useRef(onConfirmed);callback.current=onConfirmed;const inFlight=useRef(false);const mounted=useRef(true);
  const restore=async()=>{
    setReady(false);setError('');
    try {
      const records=await apiClient.listRecoverableCommands(session.tenant.id);
      const retained=records.find(record=>types.includes(record.command.type)&&record.actorId===session.user.id&&record.command.deviceId===session.deviceId&&(!targetUserId||!record.command.payload.userId||record.command.payload.userId===targetUserId));
      if(!mounted.current)return;
      setPending(retained?.command??null);setReady(true);
      if(retained)setMessage('An access command is awaiting confirmation. Check its original status before submitting another change.');
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'Access command recovery could not be checked.');}
  };
  useEffect(()=>{mounted.current=true;void restore();return()=>{mounted.current=false;};},[session.tenant.id,session.user.id,session.deviceId,targetUserId]);
  const acknowledge=async(command:BackendCommand,result:BackendCommandResult)=>{
    if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status))setPending(null);
    if(result.status==='CONFIRMED'){setConflict(false);setMessage('The server confirmed the access change.');await callback.current(command,result);}
    else if(result.status==='CONFLICT'){setConflict(true);setError(result.message??'These records changed. Reload current access settings before saving again.');}
    else if(result.status==='REJECTED'){setError(result.message??'The server rejected this access change. Review the form before trying again.');}
    else{setPending(command);setMessage('The outcome is unknown. Check this original command before retrying.');}
  };
  const send=async(command:BackendCommand)=>{
    if(inFlight.current||!ready)return;
    inFlight.current=true;setBusy(true);setError('');setMessage('');
    try{await acknowledge(command,await apiClient.submitCommand(command));}
    catch(cause){
      if((cause as {code?:string}).code==='COMMAND_NOT_SENT'){setPending(null);setError(cause instanceof Error?cause.message:'The command was not sent.');}
      else{setPending(command);setMessage(cause instanceof Error?cause.message:'The outcome is unknown. Check the original command status.');}
    }finally{inFlight.current=false;setBusy(false);}
  };
  const check=async()=>{
    if(!pending||inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');
    try{const result=await apiClient.checkCommandStatus(pending.commandId);await acknowledge(pending,{commandId:pending.commandId,status:result.status,...result.response});}
    catch(cause){setError(cause instanceof Error?cause.message:'Status lookup failed. The original command remains retained.');}
    finally{inFlight.current=false;setBusy(false);}
  };
  return {ready,busy,error,message,conflict,pending,locked:!ready||busy||Boolean(pending)||conflict,restore,send,check,clearConflict:()=>{setConflict(false);setError('');},setError};
}
export type IdentityController=ReturnType<typeof useIdentityCommands>;
export function IdentityNotices({controller,onReload}:{controller:IdentityController;onReload?:()=>void}) {
  return <>
    {!controller.ready&&<div role={controller.error?'alert':'status'} className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">{controller.error||'Checking retained access command evidence…'}{controller.error&&<button type="button" className={identityButton+' ml-2'} onClick={()=>void controller.restore()}>Retry access recovery</button>}</div>}
    {controller.ready&&controller.error&&<p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{controller.error}</p>}
    {controller.message&&<p role="status" className="rounded-lg border border-blue-800 p-3 text-sm text-blue-200">{controller.message}</p>}
    {controller.pending&&<section className="rounded-xl border border-amber-800 p-4"><h3 className="font-semibold">Check access command status</h3><p className="mt-2 break-all font-mono text-xs text-zinc-400">Command {controller.pending.commandId}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={identityButton} disabled={controller.busy} onClick={()=>void controller.check()}>Check access command status</button><button type="button" className={identityButton} disabled={controller.busy} onClick={()=>controller.pending&&void controller.send(controller.pending)}>Retry original access command</button></div></section>}
    {controller.conflict&&onReload&&<button type="button" className={identityButton+' self-start'} onClick={onReload}>Reload current access settings</button>}
  </>;
}
