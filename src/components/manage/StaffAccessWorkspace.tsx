import { permissionLabel, roleLabel } from '../../utils/presentation';
import React, { useEffect, useRef, useState } from 'react';
import { apiClient, type BackendStaffMember, type BackendWorkspaceAssignment } from '../../services/apiClient';
import { PasswordOperationPanel } from '../auth/PasswordOperationPanel';
import { OperatorSessionsPanel } from './OperatorSessionsPanel';
import { IdentityNotices, identityButton, identityCommand, identityInput, useIdentityCommands } from './identityUi';

type Directory = Awaited<ReturnType<typeof apiClient.listStaff>>;
type Mode = 'staff' | 'devices';
type ProvisioningStep = 'identity' | 'password' | 'assignment' | 'verification' | 'complete';
interface ProvisioningRecord { userId?:string;step:ProvisioningStep }
function readProvisioningRecord(key:string):ProvisioningRecord|null {
  try{const raw=sessionStorage.getItem(key);if(!raw)return null;const value=JSON.parse(raw) as Partial<ProvisioningRecord>;if(['identity','password','assignment','verification','complete'].includes(value.step??''))return {step:value.step as ProvisioningStep,...(typeof value.userId==='string'?{userId:value.userId}:{})};}
  catch{}
  return null;
}

export function StaffAccessWorkspace({ mode }: { mode: Mode }) {
  const session = apiClient.getSession()!;
  const canManageStaff = session.user.permissions.includes('staff.manage');
  const canManageDevices = session.user.permissions.includes('devices.manage');
  const provisionKey=`mazao-staff-setup:${session.tenant.id}:${session.user.id}`;
  const [provision,setProvisionState]=useState<ProvisioningRecord|null>(()=>readProvisioningRecord(provisionKey));
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [assignments, setAssignments] = useState<BackendWorkspaceAssignment[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newOperator, setNewOperator] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('cashier');
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState('');
  const [outletId, setOutletId] = useState(session.outlet.id);
  const [assignedUserId, setAssignedUserId] = useState('');
  const [editId, setEditId] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editAssignee, setEditAssignee] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [wizardLabel,setWizardLabel]=useState('');
  const [wizardOutletId,setWizardOutletId]=useState(session.outlet.id);
  const [wizardMessage,setWizardMessage]=useState(()=>provision?.step==='complete'?'First sign-in confirmed. Staff setup is complete.':'');
  const passwordInFlight = useRef(false);
  const loadController = useRef<AbortController|null>(null);
  const loadGeneration = useRef(0);
  const mounted = useRef(true);
  const updateProvision=(value:ProvisioningRecord|null)=>{
    setProvisionState(value);
    try{if(value)sessionStorage.setItem(provisionKey,JSON.stringify(value));else sessionStorage.removeItem(provisionKey);}catch{}
  };

  const load = async () => {
    loadController.current?.abort();const controller=new AbortController();loadController.current=controller;const generation=++loadGeneration.current;
    setLoading(true); setError('');
    try {
      const [result, assignmentResult] = await Promise.all([
        apiClient.listStaff(controller.signal),
        mode === 'devices'||(mode==='staff'&&Boolean(provision&&['assignment','verification'].includes(provision.step))) ? apiClient.listWorkspaceAssignments(controller.signal) : Promise.resolve(null),
      ]);
      if(!mounted.current||generation!==loadGeneration.current)return;
      setDirectory(result);
      setAssignments(assignmentResult?.devices ?? []);
      setSelectedId(current => current && result.staff.some(person => person.userId === current) ? current : result.staff[0]?.userId ?? '');
      setAssignedUserId(current => current && result.staff.some(person => person.userId === current && person.active) ? current : result.staff.find(person => person.active)?.userId ?? '');
      setOutletId(current => current && result.outlets.some(outlet => outlet.id === current && outlet.active) ? current : result.outlets.find(outlet => outlet.active)?.id ?? '');
      if(provision?.userId){
        const member=result.staff.find(person=>person.userId===provision.userId);
        if(!member)updateProvision(null);
        else if(provision.step==='password'&&member.hasCredential)updateProvision({...provision,step:'assignment'});
        else if(provision.step==='assignment'&&member.assignmentCount>0)updateProvision({...provision,step:'verification'});
        else if(provision.step==='verification'&&member.activeSessionCount>0){updateProvision({...provision,step:'complete'});setWizardMessage('First sign-in confirmed. Staff setup is complete.');}
      }
      return result;
    } catch (cause) { if((cause as {code?:string}).code!=='REQUEST_CANCELLED'&&mounted.current&&generation===loadGeneration.current)setError(cause instanceof Error ? cause.message : 'We could not load staff access. Try again.');return null; }
    finally { if(mounted.current&&generation===loadGeneration.current)setLoading(false);if(loadController.current===controller)loadController.current=null; }
  };
  const controller = useIdentityCommands(
    ['staff.member.create', 'staff.member.update', 'staff.member.set_active', 'devices.assignment.create', 'devices.assignment.update', 'devices.assignment.revoke'],
    async (command,result) => {
      setNewOperator(false);setEditId('');setReason('');
      if(command.type==='staff.member.create'&&typeof result.value?.userId==='string'){
        const userId=result.value.userId;setSelectedId(userId);setWizardMessage('Membership created. Set an initial password, add a workspace assignment, then verify the operator sign-in.');updateProvision({userId,step:'password'});
      }else if(command.type==='devices.assignment.create'&&provision?.userId&&command.payload.assignedUserId===provision.userId){
        updateProvision({...provision,step:'verification'});setWizardMessage('Workspace assignment confirmed. Ask the operator to sign in on the assigned terminal.');
      }
      await load();
    },
  );
  useEffect(() => { mounted.current=true;void load();return()=>{mounted.current=false;loadController.current?.abort();}; }, [mode]);

  const send = (type: string, payload: Record<string, unknown>, versions: Record<string, number> = {}) => {
    if (controller.locked || passwordInFlight.current || !directory) return;
    void controller.send(identityCommand(type, payload, versions));
  };
  const startProvisioning=()=>{setNewOperator(true);setWizardMessage('Step 1 of 4: enter staff details and choose a role.');updateProvision({step:'identity'});};
  const verifyProvisioning=async()=>{
    if(!provision?.userId)return;
    setWizardMessage('Checking account access, password setup, outlet assignment and sign-in…');
    const refreshed=await load();const member=refreshed?.staff.find(person=>person.userId===provision.userId);
    if(!member){setWizardMessage('We could not check this staff account. Refresh and try again.');return;}
    if(!member.hasCredential){updateProvision({...provision,step:'password'});setWizardMessage('An initial password is still required.');}
    else if(member.assignmentCount===0){updateProvision({...provision,step:'assignment'});setWizardMessage('A workspace assignment is still required.');}
    else if(member.activeSessionCount===0){updateProvision({...provision,step:'verification'});setWizardMessage('The account and assignment are ready. Ask the operator to sign in, then check again.');}
    else{updateProvision({...provision,step:'complete'});setWizardMessage('First sign-in confirmed. Staff setup is complete.');}
  };
  const selected = directory?.staff.find(person => person.userId === selectedId) ?? null;
  const activeOperators = directory?.staff.filter(person => person.active) ?? [];
  const chooseRole = (value: string) => {
    if (directory?.roles.some(option => option.role === value && option.assignable)) setRole(value);
  };

  return <section className="workflow-panel space-y-5" aria-labelledby="staff-access-heading">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs tracking-[.18em] text-blue-300">STAFF ACCESS</p><h2 id="staff-access-heading" className="mt-1 text-2xl font-bold">{mode === 'staff' ? 'Staff access' : 'Workspace assignments'}</h2><p className="mt-1 max-w-3xl text-sm text-zinc-400">{mode === 'staff' ? 'Manage staff accounts and choose from the available roles. Individual role permissions cannot be edited here.' : 'Assign staff to outlets and manage their access.'}</p></div><button type="button" className={identityButton} disabled={loading || controller.busy || passwordBusy} onClick={() => void load()}>Refresh</button></header>
    <IdentityNotices controller={controller} onReload={() => { void load().then(controller.clearConflict); }} />
    {error && <p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{error}</p>}
    {loading && !directory && <p role="status" className="p-5 text-sm text-zinc-400">Loading staff access...</p>}
    {mode === 'staff' && directory && <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric label="Operators" value={String(directory.staff.length)} /><Metric label="Active accounts" value={String(directory.staff.filter(person => person.active).length)} /><Metric label="Authorization" value="Staff roles" /></div>
      {provision&&<section className="space-y-3 rounded-xl border border-blue-900 bg-blue-950/20 p-4" aria-label="Guided operator setup"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-blue-300">People and access · guided setup</p><h3 className="mt-1 text-lg font-semibold">{provision.userId?(directory?.staff.find(person=>person.userId===provision.userId)?.displayName??'New operator'):'Add operator'}</h3><p className="mt-1 text-sm text-zinc-300">{provision.step==='identity'?'Step 1 of 4 · Enter staff details and choose a role.':provision.step==='password'?'Step 2 of 4 · Set an initial password. This guide does not save passwords.':provision.step==='assignment'?'Step 3 of 4 · Choose the outlet this staff member can use.':provision.step==='complete'?'Setup complete · first sign-in is confirmed.':'Step 4 of 4 · Ask the staff member to sign in, then check their first sign-in.'}</p></div><button type="button" className={identityButton} onClick={()=>{updateProvision(null);setNewOperator(false);}}>Close setup guide</button></div><ol className="grid gap-2 text-xs sm:grid-cols-4" aria-label="Operator setup steps">{(['identity','password','assignment','verification'] as ProvisioningStep[]).filter(step=>step!=='complete').map((step,index)=><li key={step} aria-current={provision.step===step||provision.step==='complete'&&step==='verification'?'step':undefined} className={`rounded-lg border p-2 ${provision.step===step||provision.step==='complete'&&step==='verification'?'border-blue-500 bg-blue-950/60 text-blue-100':'border-zinc-800 text-zinc-400'}`}>{index+1}. {step==='identity'?'Identity':step==='password'?'Password':step==='assignment'?'Workspace':'Sign-in check'}</li>)}</ol>{wizardMessage&&<p role="status" className="text-sm text-blue-100">{wizardMessage}</p>}{provision.step==='password'&&<p className="text-sm text-zinc-300">Set an initial password in the staff details below to continue.</p>}{provision.step==='assignment'&&<>{canManageDevices?<form className="grid gap-3 rounded-lg border border-zinc-800 p-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();if(!provision.userId)return;send('devices.assignment.create',{label:wizardLabel.trim(),outletId:wizardOutletId,assignedUserId:provision.userId});}}><label className="text-sm text-zinc-300">Workspace label<input required maxLength={160} className={identityInput} value={wizardLabel} onChange={event=>setWizardLabel(event.target.value)} disabled={controller.locked}/></label><label className="text-sm text-zinc-300">Active outlet<select className={identityInput} value={wizardOutletId} onChange={event=>setWizardOutletId(event.target.value)} disabled={controller.locked}>{directory.outlets.filter(outlet=>outlet.active).map(outlet=><option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label><button type="submit" className={identityButton+' border-blue-600 bg-blue-600 sm:col-span-2'} disabled={controller.locked||!provision.userId||!wizardLabel.trim()||!wizardOutletId}>Create operator workspace assignment</button></form>:<p role="alert" className="text-sm text-amber-200">Ask an administrator who manages outlet assignments to complete this step.</p>}</>}{provision.step==='verification'&&<div className="flex flex-wrap items-center gap-3"><p className="text-sm text-zinc-300">A password and active outlet assignment are required before first sign-in.</p><button type="button" className={identityButton+' border-blue-700'} disabled={loading} onClick={()=>void verifyProvisioning()}>Check first sign-in</button></div>}</section>}
      {canManageStaff && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4"><div><h3 className="font-semibold">Set up a staff account</h3><p className="mt-1 text-xs text-zinc-400">Create the account, set a password, assign an outlet and check the first sign-in.</p></div><button type="button" className={identityButton + ' border-blue-600'} onClick={() => {if(provision?.step==='identity'){setNewOperator(value=>!value);}else startProvisioning();}}>{newOperator ? 'Cancel operator setup' : provision?.step==='identity'?'Continue operator setup':'Add operator'}</button></div>}
      {newOperator && canManageStaff && <form className="grid gap-3 rounded-xl border border-blue-900 p-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); send('staff.member.create', { email: email.trim(), displayName: name.trim(), role }); }}>
        <label className="text-sm text-zinc-300">Display name<input required maxLength={160} className={identityInput} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="text-sm text-zinc-300">Email<input required type="email" maxLength={254} className={identityInput} value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="text-sm text-zinc-300">Staff role<select className={identityInput} value={role} onChange={event => chooseRole(event.target.value)}>{directory.roles.filter(option => option.assignable).map(option => <option key={option.role} value={option.role}>{option.label}</option>)}</select></label>
        <button type="submit" className={identityButton + ' self-end border-blue-600 bg-blue-600'} disabled={controller.locked}>Create staff account</button>
      </form>}
      <details className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Staff roles and access</summary><p className="mt-2 text-sm text-zinc-400">Choose from the available roles. Individual role permissions cannot be edited here.</p><div className="mt-3 overflow-x-auto"><table className="min-w-[680px] w-full text-left text-xs"><thead className="text-zinc-500"><tr><th className="p-2">Role</th><th className="p-2">Allowed tasks</th></tr></thead><tbody className="divide-y divide-zinc-800">{directory.roles.map(entry=><tr key={entry.role}><th scope="row" className="p-2 align-top">{entry.label}{!entry.assignable&&<span className="ml-2 text-zinc-500">(not assignable)</span>}</th><td className="p-2 font-mono text-zinc-300">{entry.permissions.map(permissionLabel).join(' / ')||'No allowed tasks'}</td></tr>)}</tbody></table></div></details>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.85fr)]">
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950" aria-label="Staff directory"><div className="divide-y divide-zinc-800">{directory.staff.map(person => <button type="button" key={person.userId} aria-pressed={selectedId === person.userId} disabled={passwordBusy} onClick={() => { if(passwordInFlight.current)return;setSelectedId(person.userId);setEditId(''); }} className={`block min-h-20 w-full p-4 text-left disabled:opacity-50 ${selectedId === person.userId ? 'bg-blue-950/40' : 'hover:bg-zinc-900'}`}><span className="flex flex-wrap items-center justify-between gap-2"><strong>{person.displayName}</strong><span className={`rounded-full px-2 py-1 text-xs ${person.active ? 'bg-emerald-950 text-emerald-200' : 'bg-zinc-800 text-zinc-400'}`}>{person.active ? 'Active' : 'Suspended'}</span></span><span className="mt-1 block break-all text-xs text-zinc-400">{person.email}</span><span className="mt-2 block text-xs text-zinc-500">{directory.roles.find(option => option.role === person.role)?.label ?? roleLabel(person.role)} · {person.assignmentCount} active assignment(s) · {person.activeSessionCount} active session(s)</span><span className="mt-2 flex flex-wrap gap-2">{!person.hasCredential&&<small className="rounded-full border border-amber-800 px-2 py-1 text-amber-200">Initial password required</small>}{person.assignmentCount===0&&<small className="rounded-full border border-amber-800 px-2 py-1 text-amber-200">Workspace assignment required</small>}{person.activeSessionCount>0&&<small className="rounded-full border border-emerald-800 px-2 py-1 text-emerald-200">Signed in</small>}</span></button>)}</div>{directory.staff.length === 0 && <p className="p-5 text-sm text-zinc-400">No staff accounts are recorded for this business.</p>}</section>
        {selected && <section key={selected.userId} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4" aria-label="Selected staff member"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{selected.displayName}</h3><p className="break-all text-sm text-zinc-400">{selected.email}</p></div>{canManageStaff && <button type="button" className={identityButton} onClick={() => { setEditId(editId === selected.userId ? '' : selected.userId); setName(selected.displayName); const currentRole = directory.roles.find(option => option.role === selected.role); setRole(currentRole?.role ?? 'cashier'); setReason(''); }}>{editId === selected.userId ? 'Cancel edit' : 'Edit access'}</button>}</div>
          {editId === selected.userId && canManageStaff && <div className="space-y-3 rounded-lg border border-zinc-800 p-3"><label className="block text-sm text-zinc-300">Display name<input className={identityInput} maxLength={160} value={name} onChange={event => setName(event.target.value)} disabled={controller.locked} /></label><label className="block text-sm text-zinc-300">Staff role<select className={identityInput} value={role} onChange={event => chooseRole(event.target.value)} disabled={controller.locked}><option value={selected.role}>{directory.roles.find(option => option.role === selected.role)?.label ?? roleLabel(selected.role)}</option>{directory.roles.filter(option => option.assignable && option.role !== selected.role).map(option => <option key={option.role} value={option.role}>{option.label}</option>)}</select></label><button type="button" className={identityButton + ' border-blue-700'} disabled={controller.locked || (name.trim() === selected.displayName && role === selected.role)} onClick={() => send('staff.member.update', { userId: selected.userId, displayName: name.trim(), role }, { ['staff:' + selected.userId]: selected.version })}>Save staff details</button>
            <label className="block text-sm text-zinc-300">Reason for changing account access<input className={identityInput} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={controller.locked} /></label><button type="button" className={identityButton + (selected.active ? ' border-rose-800 text-rose-200' : ' border-emerald-800 text-emerald-200')} disabled={controller.locked || !reason.trim() || selected.userId === session.user.id} title={selected.userId === session.user.id ? 'Use another administrator to suspend your own account.' : undefined} onClick={() => send('staff.member.set_active', { userId: selected.userId, active: !selected.active, reason: reason.trim() }, { ['staff:' + selected.userId]: selected.version })}>{selected.active ? 'Suspend account' : 'Reactivate account'}</button>
          </div>}
          <PasswordOperationPanel userId={selected.userId} displayName={selected.displayName} credentialVersion={selected.credentialVersion} hasCredential={selected.hasCredential} onConfirmed={async()=>{const refreshed=await load();if(provision?.userId===selected.userId&&refreshed?.staff.some(person=>person.userId===selected.userId&&person.hasCredential)){updateProvision({...provision,step:'assignment'});setWizardMessage('Initial password confirmed. Choose an active outlet workspace next.');}}} onBusyChange={busy=>{passwordInFlight.current=busy;setPasswordBusy(busy);}} />
          <OperatorSessionsPanel userId={selected.userId} onVersion={() => {}} />
        </section>}
      </div>
    </>}
    {mode === 'devices' && directory && <>
      {canManageDevices && <form className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); send('devices.assignment.create', { label: label.trim(), outletId, assignedUserId }); }}><div className="sm:col-span-2"><h3 className="font-semibold">Create workspace assignment</h3><p className="mt-1 text-xs text-zinc-400">Each assignment gives one active staff member access to one outlet.</p></div><label className="text-sm text-zinc-300">Assignment label<input required maxLength={160} className={identityInput} value={label} onChange={event => setLabel(event.target.value)} /></label><label className="text-sm text-zinc-300">Active outlet<select className={identityInput} value={outletId} onChange={event => setOutletId(event.target.value)}>{directory.outlets.filter(outlet => outlet.active).map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label><label className="text-sm text-zinc-300">Active operator<select className={identityInput} value={assignedUserId} onChange={event => setAssignedUserId(event.target.value)}>{activeOperators.map(person => <option key={person.userId} value={person.userId}>{person.displayName} · {roleLabel(person.role)}</option>)}</select></label><button type="submit" className={identityButton + ' self-end border-blue-600 bg-blue-600'} disabled={controller.locked || !outletId || !assignedUserId}>Create assignment</button></form>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <section className="space-y-3" aria-label="Workspace assignment list">{assignments.map(assignment => <article key={assignment.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{assignment.label}</h3><p className="mt-1 text-sm text-zinc-300">{assignment.assignedUserName} · {assignment.outletName}</p><p className="mt-1 text-xs text-zinc-500">{assignment.active ? 'Active assignment' : 'Revoked'}</p></div>{canManageDevices && assignment.active && <button type="button" className={identityButton} onClick={() => { setEditId(editId === assignment.id ? '' : assignment.id); setEditLabel(assignment.label); setEditAssignee(assignment.assignedUserId); setReason(''); }}>{editId === assignment.id ? 'Close assignment actions' : 'Edit assignment'}</button>}</div>
        {editId === assignment.id && canManageDevices && <div className="mt-4 grid gap-3 border-t border-zinc-800 pt-4 sm:grid-cols-2"><label className="text-sm text-zinc-300">Assignment label<input className={identityInput} maxLength={160} value={editLabel} onChange={event => setEditLabel(event.target.value)} disabled={controller.locked} /></label><label className="text-sm text-zinc-300">Assign to active operator<select className={identityInput} value={editAssignee} onChange={event => setEditAssignee(event.target.value)} disabled={controller.locked}>{activeOperators.map(person => <option key={person.userId} value={person.userId}>{person.displayName} · {roleLabel(person.role)}</option>)}</select></label><button type="button" className={identityButton} disabled={controller.locked || (editLabel.trim() === assignment.label && editAssignee === assignment.assignedUserId)} onClick={() => send('devices.assignment.update', { deviceId: assignment.id, label: editLabel.trim(), assignedUserId: editAssignee }, { ['device:' + assignment.id]: assignment.version })}>Save assignment</button><div className="flex flex-wrap gap-2"><input aria-label="Assignment revocation reason" placeholder="Reason for revocation" className={identityInput + ' mt-0'} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={controller.locked} /><button type="button" className={identityButton + ' border-rose-800 text-rose-200'} disabled={controller.locked || !reason.trim()} onClick={() => send('devices.assignment.revoke', { deviceId: assignment.id, reason: reason.trim() }, { ['device:' + assignment.id]: assignment.version })}>Revoke assignment</button></div></div>}
      </article>)}{assignments.length === 0 && <p className="rounded-xl border border-zinc-800 p-5 text-sm text-zinc-400">No workspace assignments are recorded for this business.</p>}</section>
      <p className="text-xs text-zinc-500">Assignments control outlet access. Printer setup is unavailable here.</p>
    </>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p></div>; }
