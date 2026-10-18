import React, { useEffect, useId, useRef, useState } from 'react';
import { apiClient, type BackendCommandResult } from '../../services/apiClient';
import type { SecretOperationRecovery } from '../../services/secretOperationJournal';
import { identityButton, identityInput } from '../manage/identityUi';

export function PasswordOperationPanel({userId,displayName,credentialVersion,hasCredential=true,onConfirmed,onBusyChange}:{
  userId:string;displayName:string;credentialVersion:number;hasCredential?:boolean;onConfirmed?:()=>Promise<void>;onBusyChange?:(busy:boolean)=>void;
}) {
  const session=apiClient.getSession()!;const own=userId===session.user.id;const id=useId();
  const canChange=own||session.user.permissions.includes('staff.manage');
  const form=useRef<HTMLFormElement>(null);const inFlight=useRef(false);
  const [version,setVersion]=useState(credentialVersion);const [busy,setBusy]=useState(false);const [ready,setReady]=useState(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [show,setShow]=useState(false);const [conflict,setConflict]=useState(false);
  const [pending,setPending]=useState<SecretOperationRecovery|null>(null);
  const clearInputs=()=>{form.current?.reset();setShow(false);};
  const setOperationBusy=(value:boolean)=>{inFlight.current=value;setBusy(value);onBusyChange?.(value);};
  useEffect(()=>setVersion(credentialVersion),[credentialVersion]);
  useEffect(()=>()=>{form.current?.reset();},[]);
  useEffect(()=>{
    const beforeNavigate=(event:Event)=>{if(inFlight.current)event.preventDefault();};
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(inFlight.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('mazao:before-navigate',beforeNavigate);window.addEventListener('mazao:before-account-open',beforeNavigate);window.addEventListener('beforeunload',beforeUnload);
    return()=>{window.removeEventListener('mazao:before-navigate',beforeNavigate);window.removeEventListener('mazao:before-account-open',beforeNavigate);window.removeEventListener('beforeunload',beforeUnload);};
  },[]);
  const restore=async()=>{
    setReady(false);setError('');
    try{const records=await apiClient.listSecretOperationRecovery();setPending(records.find(record=>record.targetUserId===userId)??null);setReady(true);}
    catch(cause){setError(cause instanceof Error?cause.message:'We could not check for an unfinished password change.');}
  };
  useEffect(()=>{void restore();},[session.tenant.id,session.user.id,userId]);
  const complete=async(result:BackendCommandResult,operation:SecretOperationRecovery)=>{
    if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status))setPending(null);
    if(result.status==='CONFIRMED'){
      setConflict(false);setNotice(`Password change confirmed. ${String(result.value?.sessionsRevoked??0)} session(s) signed out.`);
      if(result.value?.reauthenticate===true||operation.kind==='auth.password.change'){apiClient.clearAuthenticatedSession();return;}
      setVersion(Number(result.value?.credentialVersion??version));await onConfirmed?.();
    }else if(result.status==='CONFLICT'){setConflict(true);setError(result.message??'This password was changed elsewhere. Refresh before trying again.');}
    else if(result.status==='REJECTED'){setError(result.message??'The password was not changed. Review the details and enter it again.');}
    else{setPending(operation);setNotice('We could not confirm the password change. Check its status before trying again. Password fields have been cleared.');}
  };
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!canChange||!ready||busy||pending||conflict||inFlight.current)return;
    const values=new FormData(event.currentTarget);
    let next=String(values.get('newPassword')??'');let current=String(values.get('currentPassword')??'');
    const confirmation=String(values.get('confirmation')??'');
    values.delete('newPassword');values.delete('currentPassword');values.delete('confirmation');
    clearInputs();setError('');setNotice('');
    if(next.length<12||next.length>256){next='';current='';setError('Use a password between 12 and 256 characters.');return;}
    if(next!==confirmation){next='';current='';setError('Passwords did not match. Enter the new password again.');return;}
    const operation:SecretOperationRecovery={tenantId:session.tenant.id,actorId:session.user.id,commandId:crypto.randomUUID(),kind:own?'auth.password.change':'staff.password.set',targetUserId:userId,expectedCredentialVersion:version,state:'sending',savedAt:new Date().toISOString()};
    setOperationBusy(true);
    try{await complete(await apiClient.submitPasswordOperation(operation,next,own?current:undefined),operation);}
    catch(cause){
      if((cause as {code?:string}).code==='COMMAND_NOT_SENT'){setError(cause instanceof Error?cause.message:'The password request was not sent.');}
      else{setPending(operation);setNotice('The password change outcome is unknown. Check its original status before entering another password.');}
    }finally{next='';current='';setOperationBusy(false);}
  };
  const check=async()=>{
    if(!pending||inFlight.current)return;
    setOperationBusy(true);setError('');
    try{const result=await apiClient.checkSecretOperationStatus(pending.commandId);await complete({commandId:pending.commandId,status:result.status,...result.response},pending);}
    catch(cause){setError((cause as {status?:number}).status===404?'No completed password operation was found yet. Check again; passwords cannot be replayed from this device.':cause instanceof Error?cause.message:'Password status could not be checked.');}
    finally{setOperationBusy(false);}
  };
  const reload=async()=>{
    if(inFlight.current)return;
    setOperationBusy(true);setError('');clearInputs();
    try{const result=own?await apiClient.getOwnSessions():await apiClient.getStaffSessions(userId);setVersion(result.credentialVersion);setConflict(false);}
    catch(cause){setError(cause instanceof Error?cause.message:'We could not refresh password details. Try again.');}
    finally{setOperationBusy(false);}
  };
  return <section className="space-y-4 rounded-xl border border-zinc-700 p-4">
    <div><h3 className="text-base font-semibold">{own?'Change my password':hasCredential?'Reset operator password':'Set initial password'}</h3><p className="mt-1 text-sm leading-6 text-zinc-400">{displayName}. A confirmed change signs out existing sessions.{own?' You will sign in again with your new password.':''}</p></div>
    <p className="text-xs leading-5 text-zinc-400">Password fields are cleared after submission. If confirmation is interrupted, check status before changing the password again.</p>
    {busy&&<p role="status" className="text-sm text-amber-200">Wait for the password request before leaving or choosing another operator.</p>}
    {!ready&&<p role={error?'alert':'status'} className="text-sm text-amber-200">{error||'Checking for an unfinished password change...'}{error&&<button type="button" className={identityButton+' mt-2'} onClick={()=>void restore()}>Retry password recovery</button>}</p>}
    {ready&&error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}
    {notice&&<p role="status" className="text-sm text-blue-200">{notice}</p>}
    {pending&&<div className="space-y-3 rounded-lg border border-amber-800 p-3"><h4 className="font-semibold">Check password change status</h4><details className="mt-2 text-xs text-zinc-400"><summary className="min-h-9 cursor-pointer py-2">Support reference</summary><p className="break-all font-mono text-xs text-zinc-400">Reference {pending.commandId}</p></details><p className="text-sm text-amber-200">The original password is not retained. Check status before submitting another change.</p><button type="button" className={identityButton} disabled={busy} onClick={()=>void check()}>Check password change status</button></div>}
    {conflict&&<button type="button" className={identityButton} disabled={busy} onClick={()=>void reload()}>Refresh password details</button>}
    <form ref={form} onSubmit={submit} className="space-y-3">
      <fieldset disabled={!canChange||!ready||busy||Boolean(pending)||conflict} className="space-y-3">
        {own&&<label className="block text-sm text-zinc-300" htmlFor={id+'-current'}>Current password<input id={id+'-current'} name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} className={identityInput}/></label>}
        <label className="block text-sm text-zinc-300" htmlFor={id+'-new'}>New password<input id={id+'-new'} name="newPassword" type={show?'text':'password'} autoComplete="new-password" required maxLength={256} className={identityInput}/></label>
        <label className="block text-sm text-zinc-300" htmlFor={id+'-confirm'}>Confirm new password<input id={id+'-confirm'} name="confirmation" type={show?'text':'password'} autoComplete="new-password" required maxLength={256} className={identityInput}/></label>
        <button type="button" aria-pressed={show} onClick={()=>setShow(value=>!value)} className="min-h-11 text-sm text-blue-300">{show?'Hide new password':'Show new password'}</button>
      </fieldset>
      <div className="flex flex-wrap gap-2"><button type="button" className={identityButton} disabled={busy} onClick={clearInputs}>Clear password fields</button><button type="submit" className={identityButton+' border-blue-600 bg-blue-600 font-semibold'} disabled={!canChange||!ready||busy||Boolean(pending)||conflict}>{busy?'Submitting…':own?'Change my password':hasCredential?'Reset operator password':'Set initial password'}</button></div>
    </form>
  </section>;
}
