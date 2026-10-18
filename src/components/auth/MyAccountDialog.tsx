import { roleLabel } from '../../utils/presentation';
import React, { useRef, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { OperatorSessionsPanel } from '../manage/OperatorSessionsPanel';
import { PasswordOperationPanel } from './PasswordOperationPanel';

export function MyAccountDialog({onClose}:{onClose:()=>void}) {
  const session=apiClient.getSession()!;
  const [version,setVersion]=useState(session.user.credentialVersion??1);
  const [passwordBusy,setPasswordBusy]=useState(false);
  const passwordInFlight=useRef(false);
  return <ResponsiveDialog isOpen onClose={()=>{if(!passwordInFlight.current)onClose();}} closeDisabled={passwordBusy} title="My account" subtitle={session.user.email} maxWidth="xl">
    <section className="rounded-xl border border-zinc-700 p-4"><h2 className="text-lg font-semibold">{session.user.name}</h2><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-zinc-400">Business</dt><dd>{session.tenant.name}</dd></div><div><dt className="text-zinc-400">Role</dt><dd className="capitalize">{roleLabel(session.user.role)}</dd></div><div><dt className="text-zinc-400">Outlet</dt><dd>{session.outlet.name}</dd></div><div><dt className="text-zinc-400">Time zone</dt><dd>{session.outlet.timeZone??session.tenant.timeZone}</dd></div></dl></section>
    <OperatorSessionsPanel userId={session.user.id} onVersion={setVersion}/>
    <PasswordOperationPanel key={session.user.id} userId={session.user.id} displayName={session.user.name} credentialVersion={version} onBusyChange={busy=>{passwordInFlight.current=busy;setPasswordBusy(busy);}}/>
  </ResponsiveDialog>;
}
