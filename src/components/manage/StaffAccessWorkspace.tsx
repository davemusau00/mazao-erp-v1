import React, { useEffect, useState } from 'react';
import { apiClient, type BackendStaffMember, type BackendWorkspaceAssignment } from '../../services/apiClient';
import { PasswordOperationPanel } from '../auth/PasswordOperationPanel';
import { OperatorSessionsPanel } from './OperatorSessionsPanel';
import { IdentityNotices, identityButton, identityCommand, identityInput, useIdentityCommands } from './identityUi';

type Directory = Awaited<ReturnType<typeof apiClient.listStaff>>;
type Mode = 'staff' | 'devices';

export function StaffAccessWorkspace({ mode }: { mode: Mode }) {
  const session = apiClient.getSession()!;
  const canManageStaff = session.user.permissions.includes('staff.manage');
  const canManageDevices = session.user.permissions.includes('devices.manage');
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

  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await apiClient.listStaff();
      setDirectory(result);
      setAssignments(mode === 'devices' ? (await apiClient.listWorkspaceAssignments()).devices : []);
      setSelectedId(current => current && result.staff.some(person => person.userId === current) ? current : result.staff[0]?.userId ?? '');
      setAssignedUserId(current => current && result.staff.some(person => person.userId === current && person.active) ? current : result.staff.find(person => person.active)?.userId ?? '');
      setOutletId(current => current && result.outlets.some(outlet => outlet.id === current && outlet.active) ? current : result.outlets.find(outlet => outlet.active)?.id ?? '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Staff access could not be loaded from the server.'); }
    finally { setLoading(false); }
  };
  const controller = useIdentityCommands(
    ['staff.member.create', 'staff.member.update', 'staff.member.set_active', 'devices.assignment.create', 'devices.assignment.update', 'devices.assignment.revoke'],
    async () => { setNewOperator(false); setEditId(''); setReason(''); await load(); },
  );
  useEffect(() => { void load(); }, [mode]);

  const send = (type: string, payload: Record<string, unknown>, versions: Record<string, number> = {}) => {
    if (controller.locked || !directory) return;
    void controller.send(identityCommand(type, payload, versions));
  };
  const selected = directory?.staff.find(person => person.userId === selectedId) ?? null;
  const activeOperators = directory?.staff.filter(person => person.active) ?? [];
  const chooseRole = (value: string) => {
    if (directory?.roles.some(option => option.role === value && option.assignable)) setRole(value);
  };

  return <section className="workflow-panel space-y-5" aria-labelledby="staff-access-heading">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs tracking-[.18em] text-blue-300">SERVER ACCESS CONTROL</p><h2 id="staff-access-heading" className="mt-1 text-2xl font-bold">{mode === 'staff' ? 'Staff access' : 'Workspace assignments'}</h2><p className="mt-1 max-w-3xl text-sm text-zinc-400">{mode === 'staff' ? 'Tenant-scoped operator memberships and coarse server roles. Role grants themselves are not editable here.' : 'Authorized operator and outlet assignments. This does not enroll printers or confirm physical device state.'}</p></div><button type="button" className={identityButton} disabled={loading || controller.busy} onClick={() => void load()}>Refresh server records</button></header>
    <IdentityNotices controller={controller} onReload={() => { void load().then(controller.clearConflict); }} />
    {error && <p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{error}</p>}
    {loading && !directory && <p role="status" className="p-5 text-sm text-zinc-400">Loading tenant access records...</p>}
    {mode === 'staff' && directory && <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric label="Operators" value={String(directory.staff.length)} /><Metric label="Active memberships" value={String(directory.staff.filter(person => person.active).length)} /><Metric label="Authorization" value="Server roles" /></div>
      {canManageStaff && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4"><div><h3 className="font-semibold">Provision a staff account</h3><p className="mt-1 text-xs text-zinc-400">New operators receive no password until an administrator sets one through the protected password flow.</p></div><button type="button" className={identityButton + ' border-blue-600'} onClick={() => setNewOperator(value => !value)}>{newOperator ? 'Cancel operator setup' : 'Add operator'}</button></div>}
      {newOperator && canManageStaff && <form className="grid gap-3 rounded-xl border border-blue-900 p-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); send('staff.member.create', { email: email.trim(), displayName: name.trim(), role }); }}>
        <label className="text-sm text-zinc-300">Display name<input required maxLength={160} className={identityInput} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="text-sm text-zinc-300">Email<input required type="email" maxLength={254} className={identityInput} value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="text-sm text-zinc-300">Server role<select className={identityInput} value={role} onChange={event => chooseRole(event.target.value)}>{directory.roles.filter(option => option.assignable).map(option => <option key={option.role} value={option.role}>{option.label}</option>)}</select></label>
        <button type="submit" className={identityButton + ' self-end border-blue-600 bg-blue-600'} disabled={controller.locked}>Create staff membership</button>
      </form>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.85fr)]">
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950" aria-label="Staff directory"><div className="divide-y divide-zinc-800">{directory.staff.map(person => <button type="button" key={person.userId} aria-pressed={selectedId === person.userId} onClick={() => { setSelectedId(person.userId); setEditId(''); }} className={`block min-h-20 w-full p-4 text-left ${selectedId === person.userId ? 'bg-blue-950/40' : 'hover:bg-zinc-900'}`}><span className="flex flex-wrap items-center justify-between gap-2"><strong>{person.displayName}</strong><span className={`rounded-full px-2 py-1 text-xs ${person.active ? 'bg-emerald-950 text-emerald-200' : 'bg-zinc-800 text-zinc-400'}`}>{person.active ? 'Active' : 'Suspended'}</span></span><span className="mt-1 block break-all text-xs text-zinc-400">{person.email}</span><span className="mt-2 block text-xs text-zinc-500">{directory.roles.find(option => option.role === person.role)?.label ?? person.role} · {person.assignmentCount} active assignment(s) · {person.activeSessionCount} active session(s)</span></button>)}</div>{directory.staff.length === 0 && <p className="p-5 text-sm text-zinc-400">No staff memberships are recorded for this business.</p>}</section>
        {selected && <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4" aria-label="Selected staff member"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{selected.displayName}</h3><p className="break-all text-sm text-zinc-400">{selected.email}</p><p className="mt-1 text-xs text-zinc-500">Record version {selected.version} · credential version {selected.credentialVersion}</p></div>{canManageStaff && <button type="button" className={identityButton} onClick={() => { setEditId(editId === selected.userId ? '' : selected.userId); setName(selected.displayName); const currentRole = directory.roles.find(option => option.role === selected.role); setRole(currentRole?.role ?? 'cashier'); setReason(''); }}>{editId === selected.userId ? 'Cancel edit' : 'Edit access'}</button>}</div>
          {editId === selected.userId && canManageStaff && <div className="space-y-3 rounded-lg border border-zinc-800 p-3"><label className="block text-sm text-zinc-300">Display name<input className={identityInput} maxLength={160} value={name} onChange={event => setName(event.target.value)} disabled={controller.locked} /></label><label className="block text-sm text-zinc-300">Server role<select className={identityInput} value={role} onChange={event => chooseRole(event.target.value)} disabled={controller.locked}><option value={selected.role}>{directory.roles.find(option => option.role === selected.role)?.label ?? selected.role}</option>{directory.roles.filter(option => option.assignable && option.role !== selected.role).map(option => <option key={option.role} value={option.role}>{option.label}</option>)}</select></label><button type="button" className={identityButton + ' border-blue-700'} disabled={controller.locked || (name.trim() === selected.displayName && role === selected.role)} onClick={() => send('staff.member.update', { userId: selected.userId, displayName: name.trim(), role }, { ['staff:' + selected.userId]: selected.version })}>Save staff details</button>
            <label className="block text-sm text-zinc-300">Reason for membership status change<input className={identityInput} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={controller.locked} /></label><button type="button" className={identityButton + (selected.active ? ' border-rose-800 text-rose-200' : ' border-emerald-800 text-emerald-200')} disabled={controller.locked || !reason.trim() || selected.userId === session.user.id} title={selected.userId === session.user.id ? 'Use another administrator to suspend your own account.' : undefined} onClick={() => send('staff.member.set_active', { userId: selected.userId, active: !selected.active, reason: reason.trim() }, { ['staff:' + selected.userId]: selected.version })}>{selected.active ? 'Suspend membership' : 'Reactivate membership'}</button>
          </div>}
          <PasswordOperationPanel userId={selected.userId} displayName={selected.displayName} credentialVersion={selected.credentialVersion} hasCredential={selected.hasCredential} onConfirmed={load} />
          <OperatorSessionsPanel userId={selected.userId} onVersion={() => {}} />
        </section>}
      </div>
    </>}
    {mode === 'devices' && directory && <>
      {canManageDevices && <form className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); send('devices.assignment.create', { label: label.trim(), outletId, assignedUserId }); }}><div className="sm:col-span-2"><h3 className="font-semibold">Create workspace assignment</h3><p className="mt-1 text-xs text-zinc-400">The server binds each assignment to one business outlet and one active operator.</p></div><label className="text-sm text-zinc-300">Assignment label<input required maxLength={160} className={identityInput} value={label} onChange={event => setLabel(event.target.value)} /></label><label className="text-sm text-zinc-300">Active outlet<select className={identityInput} value={outletId} onChange={event => setOutletId(event.target.value)}>{directory.outlets.filter(outlet => outlet.active).map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label><label className="text-sm text-zinc-300">Active operator<select className={identityInput} value={assignedUserId} onChange={event => setAssignedUserId(event.target.value)}>{activeOperators.map(person => <option key={person.userId} value={person.userId}>{person.displayName} · {person.role}</option>)}</select></label><button type="submit" className={identityButton + ' self-end border-blue-600 bg-blue-600'} disabled={controller.locked || !outletId || !assignedUserId}>Create assignment</button></form>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <section className="space-y-3" aria-label="Workspace assignment list">{assignments.map(assignment => <article key={assignment.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{assignment.label}</h3><p className="mt-1 text-sm text-zinc-300">{assignment.assignedUserName} · {assignment.outletName}</p><p className="mt-1 text-xs text-zinc-500">{assignment.active ? 'Active assignment' : 'Revoked'} · version {assignment.version}</p></div>{canManageDevices && assignment.active && <button type="button" className={identityButton} onClick={() => { setEditId(editId === assignment.id ? '' : assignment.id); setEditLabel(assignment.label); setEditAssignee(assignment.assignedUserId); setReason(''); }}>{editId === assignment.id ? 'Close assignment actions' : 'Edit assignment'}</button>}</div>
        {editId === assignment.id && canManageDevices && <div className="mt-4 grid gap-3 border-t border-zinc-800 pt-4 sm:grid-cols-2"><label className="text-sm text-zinc-300">Assignment label<input className={identityInput} maxLength={160} value={editLabel} onChange={event => setEditLabel(event.target.value)} disabled={controller.locked} /></label><label className="text-sm text-zinc-300">Assign to active operator<select className={identityInput} value={editAssignee} onChange={event => setEditAssignee(event.target.value)} disabled={controller.locked}>{activeOperators.map(person => <option key={person.userId} value={person.userId}>{person.displayName} · {person.role}</option>)}</select></label><button type="button" className={identityButton} disabled={controller.locked || (editLabel.trim() === assignment.label && editAssignee === assignment.assignedUserId)} onClick={() => send('devices.assignment.update', { deviceId: assignment.id, label: editLabel.trim(), assignedUserId: editAssignee }, { ['device:' + assignment.id]: assignment.version })}>Save assignment</button><div className="flex flex-wrap gap-2"><input aria-label="Assignment revocation reason" placeholder="Reason for revocation" className={identityInput + ' mt-0'} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={controller.locked} /><button type="button" className={identityButton + ' border-rose-800 text-rose-200'} disabled={controller.locked || !reason.trim()} onClick={() => send('devices.assignment.revoke', { deviceId: assignment.id, reason: reason.trim() }, { ['device:' + assignment.id]: assignment.version })}>Revoke assignment</button></div></div>}
      </article>)}{assignments.length === 0 && <p className="rounded-xl border border-zinc-800 p-5 text-sm text-zinc-400">No workspace assignments are recorded for this business.</p>}</section>
      <p className="text-xs text-zinc-500">Assignment records report server authorization only. Printer enrollment, local device health, and print acknowledgement are not connected.</p>
    </>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p></div>; }
