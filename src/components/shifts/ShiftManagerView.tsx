import React, { useEffect, useState } from 'react';
import { apiClient, type BackendShift, type BackendShiftCloseReport } from '../../services/apiClient';
import { formatMinorMoney, formatMinorMoneyText, moneyInputToMinor } from '../../utils/money';
import { MinusCircle, PlusCircle } from 'lucide-react';

type ShiftCashMovementType = 'PAID_IN' | 'PAYOUT';

export const ShiftManagerView: React.FC = () => {
  const session = apiClient.getSession()!;
  const canMoveCash = session.user.permissions.includes('shift.payout');
  const currency = session.tenant.currency;
  const [shift, setShift] = useState<BackendShift|null>(null);
  const [closeReports, setCloseReports] = useState<BackendShiftCloseReport[]>([]);
  const [float, setFloat] = useState('0');
  const [counted, setCounted] = useState('0');
  const [movementType, setMovementType] = useState<ShiftCashMovementType|null>(null);
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [movementReference, setMovementReference] = useState('');
  const [movementMessage, setMovementMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unknownCommandId, setUnknownCommandId] = useState<string|null>(null);

  const refresh = async () => {
    try {
      const [current, reports] = await Promise.all([apiClient.getCurrentShift(), apiClient.listShiftCloseReports()]);
      setShift(current.shift);
      setCloseReports(reports.reports);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load server shift.'); }
  };

  useEffect(() => {
    void (async () => {
      await refresh();
      const records = await apiClient.listRecoverableCommands(session.tenant.id);
      const pending = records.find(record => ['shift.open','shift.close','shift.cash.movement'].includes(record.command.type));
      if (!pending) return;
      setUnknownCommandId(pending.command.commandId);
      setMessage('An unresolved shift action was restored. Check its original status before retrying.');
      if (pending.command.type === 'shift.cash.movement') {
        const payload = pending.command.payload;
        setMovementType(payload.movementType === 'PAID_IN' ? 'PAID_IN' : 'PAYOUT');
        setMovementAmount(`${Math.floor(Number(payload.amountMinor ?? 0) / 100)}.${String(Number(payload.amountMinor ?? 0) % 100).padStart(2,'0')}`);
        setMovementReason(String(payload.reason ?? ''));
        setMovementReference(String(payload.reference ?? ''));
        setMovementMessage('This movement has an unknown result. Check its status before editing or resubmitting.');
      }
    })();
  }, []);

  const submitShift = async (type:'shift.open'|'shift.close') => {
    if (unknownCommandId) return;
    setBusy(true);
    setMessage('');
    let amountMinor: number;
    try { amountMinor = moneyInputToMinor(type === 'shift.open' ? (float || '0') : (counted || '0')); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Enter a valid amount.'); setBusy(false); return; }
    const commandId = crypto.randomUUID();
    try {
      const outcome = await apiClient.submitCommand({
        protocolVersion:1, commandId, tenantId:session.tenant.id, deviceId:session.deviceId,
        type, occurredAt:new Date().toISOString(), expectedVersions:shift ? { [`shift:${shift.id}`]:shift.version } : {},
        payload:type === 'shift.open' ? { openingFloatMinor:amountMinor } : { shiftId:shift!.id, countedCashMinor:amountMinor },
      });
      setUnknownCommandId(null);
      const value = outcome.value ?? {};
      setMessage(outcome.status === 'CONFIRMED'
        ? (type === 'shift.open' ? 'Server shift opened.' : `Server shift closed. Close report ${String(value.closeReportId ?? '')} is saved below.`)
        : (outcome.message ?? `Shift command ${outcome.status.toLowerCase()}.`));
      await refresh();
    } catch (error) {
      setUnknownCommandId(commandId);
      setMessage(error instanceof Error ? error.message : 'Shift command outcome is unknown. Check its status before retrying.');
    } finally { setBusy(false); }
  };

  const submitCashMovement = async (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!movementType || !shift || unknownCommandId) return;
    let amountMinor: number;
    try {
      amountMinor = moneyInputToMinor(movementAmount);
      if (amountMinor <= 0) throw new Error('Enter an amount greater than zero.');
      if (!movementReason.trim()) throw new Error('Enter a reason for this till movement.');
    } catch (error) { setMovementMessage(error instanceof Error ? error.message : 'Enter valid movement details.'); return; }
    const commandId = crypto.randomUUID();
    setBusy(true);
    setMovementMessage('');
    try {
      const outcome = await apiClient.submitCommand({
        protocolVersion:1, commandId, tenantId:session.tenant.id, deviceId:session.deviceId,
        type:'shift.cash.movement', occurredAt:new Date().toISOString(), expectedVersions:{ [`shift:${shift.id}`]:shift.version },
        payload:{ shiftId:shift.id, movementType, amountMinor, reason:movementReason.trim(), reference:movementReference.trim() || undefined },
      });
      if (outcome.status === 'CONFIRMED') {
        setUnknownCommandId(null);
        setMovementType(null);
        setMovementAmount('');
        setMovementReason('');
        setMovementReference('');
        setMessage(movementType === 'PAID_IN' ? 'Cash paid-in recorded.' : 'Cash payout recorded.');
      } else {
        setMovementMessage(outcome.message ?? `Till movement ${outcome.status.toLowerCase()}.`);
      }
      await refresh();
    } catch (error) {
      setUnknownCommandId(commandId);
      setMovementMessage(error instanceof Error ? error.message : 'Till movement outcome is unknown. Check its status before retrying.');
      setMessage('The cash movement outcome is unknown. Check its status before retrying.');
    } finally { setBusy(false); }
  };

  const checkUnknown = async () => {
    if (!unknownCommandId) return;
    try {
      const result = await apiClient.checkCommandStatus(unknownCommandId);
      const response = result.response as { status?:string; message?:string };
      if (response.status === 'CONFIRMED') {
        setUnknownCommandId(null);
        setMovementType(null);
        setMovementAmount(''); setMovementReason(''); setMovementReference('');
        setMovementMessage('');
        setMessage('Server confirmed the shift action.');
        await refresh();
      } else if (response.status === 'REJECTED' || response.status === 'CONFLICT') {
        setUnknownCommandId(null);
        setMovementMessage(response.message ?? `Shift action ${response.status.toLowerCase()}.`);
        setMessage(response.message ?? `Shift action ${response.status.toLowerCase()}.`);
      } else setMessage(`Command status: ${result.status}. Check again shortly.`);
    } catch (error) {
      if ((error as {status?:number}).status === 404) {
        const pending = (await apiClient.listRecoverableCommands(session.tenant.id)).find(record => record.command.commandId === unknownCommandId);
        if (pending) { await apiClient.submitCommand(pending.command); await checkUnknown(); return; }
      }
      setMessage(error instanceof Error ? error.message : 'Unable to check shift command status.');
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-5 p-4 pb-24 text-zinc-100 sm:p-8">
      <header>
        <p className="text-xs uppercase tracking-widest text-blue-300">Server-backed shift</p>
        <h1 className="mt-2 text-3xl font-bold">Cash control</h1>
        <p className="mt-2 text-zinc-400">{session.outlet.name} · {session.user.name} · {currency}</p>
      </header>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6" aria-labelledby="server-shift-heading">
        {shift ? <>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-sm text-emerald-300">Shift open</p>
              <h2 id="server-shift-heading" className="mt-1 text-2xl font-semibold">Expected cash {formatMinorMoney(shift.expectedCashMinor, currency)}</h2>
              <p className="mt-1 text-sm text-zinc-400">Opening float {formatMinorMoney(shift.openingFloatMinor, currency)} · Cash sales {formatMinorMoney(shift.cashSalesMinor, currency)} · Customer repayments {formatMinorMoney(shift.customerCollectionsMinor, currency)}</p>
              <p className="mt-1 text-xs text-zinc-500">Version {shift.version} · opened {new Date(shift.openedAt).toLocaleString(undefined,{timeZone:session.tenant.timeZone})}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {canMoveCash && <>
                <button type="button" disabled={busy || !!unknownCommandId} onClick={() => { setMessage(''); setMovementMessage(''); setMovementType('PAID_IN'); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-800 px-4 text-sm text-emerald-200 hover:bg-emerald-950 disabled:opacity-50"><PlusCircle size={16}/> Cash paid-in</button>
                <button type="button" disabled={busy || !!unknownCommandId} onClick={() => { setMessage(''); setMovementMessage(''); setMovementType('PAYOUT'); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-800 px-4 text-sm text-amber-200 hover:bg-amber-950 disabled:opacity-50"><MinusCircle size={16}/> Cash payout</button>
              </>}
              <label className="text-xs text-zinc-400">Counted cash ({currency})<input disabled={busy || !!unknownCommandId} inputMode="decimal" value={counted} onChange={event=>setCounted(event.target.value)} className="mt-1 block min-h-11 w-36 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white"/></label>
              <button type="button" disabled={busy || !!unknownCommandId} onClick={()=>void submitShift('shift.close')} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold disabled:opacity-50">{busy?'Working…':'Close shift'}</button>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-zinc-800">
            <div className="border-b border-zinc-800 px-4 py-3"><h3 className="font-semibold">Till cash movements</h3><p className="mt-1 text-xs text-zinc-500">Paid-ins and payouts update expected cash and keep a reason and reference.</p></div>
            {shift.cashMovements.length === 0 ? <p className="p-4 text-sm text-zinc-500">No paid-ins or payouts recorded for this shift.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="p-3">When</th><th className="p-3">Movement</th><th className="p-3">Reason / reference</th><th className="p-3">Recorded by</th><th className="p-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-zinc-800">{shift.cashMovements.map(movement=><tr key={movement.id}><td className="p-3 text-zinc-400">{new Date(movement.createdAt).toLocaleString(undefined,{dateStyle:'short',timeStyle:'short',timeZone:session.tenant.timeZone})}</td><td className={movement.movementType==='PAID_IN'?'p-3 font-medium text-emerald-300':'p-3 font-medium text-amber-300'}>{movement.movementType==='PAID_IN'?'Cash paid-in':'Cash payout'}</td><td className="p-3"><span>{movement.reason}</span>{movement.reference&&<small className="ml-2 text-zinc-500">{movement.reference}</small>}</td><td className="p-3 text-zinc-400">{movement.actorName}</td><td className="p-3 text-right font-mono">{movement.movementType==='PAID_IN'?'+':'−'}{formatMinorMoney(movement.amountMinor,currency)}</td></tr>)}</tbody></table></div>}
          </div>
          <p className="mt-3 text-xs text-zinc-500">Till movements keep a clearing journal and do not create a supplier payment or classify a business expense.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ['Cash paid-in', shift.cashPaidInMinor],
              ['Cash payouts', shift.cashPayoutMinor],
              ['Cash refunds', shift.cashRefundsMinor],
              ['Customer collections', shift.customerCollectionsMinor],
            ] as const).map(([label, amount]) => <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"><p className="text-xs text-zinc-400">{label}</p><p className="mt-1 text-base font-semibold">{formatMinorMoney(amount,currency)}</p></div>)}
          </div>
        </> : <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1"><h2 id="server-shift-heading" className="text-lg font-semibold">No server shift is open</h2><p className="mt-1 text-sm text-zinc-400">Open a till before server-backed checkout.</p></div>
          <label className="text-xs text-zinc-400">Opening float ({currency})<input disabled={busy || !!unknownCommandId} inputMode="decimal" value={float} onChange={event=>setFloat(event.target.value)} className="mt-1 block min-h-11 w-36 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white"/></label>
          <button type="button" disabled={busy || !!unknownCommandId} onClick={()=>void submitShift('shift.open')} className="min-h-11 rounded-lg bg-emerald-600 px-4 font-semibold disabled:opacity-50">{busy?'Working…':'Open shift'}</button>
        </div>}
        {message && <div role={unknownCommandId?'alert':'status'} className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200"><span>{message}</span>{unknownCommandId&&<button type="button" onClick={()=>void checkUnknown()} className="min-h-9 underline">Check command status</button>}</div>}
      </section>

      {closeReports[0] && <section className="rounded-2xl border border-emerald-900/70 bg-zinc-950 p-5 sm:p-6" aria-labelledby="z-report-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs uppercase tracking-widest text-emerald-300">Server close report · {closeReports[0].businessDate}</p><h2 id="z-report-title" className="mt-1 text-xl font-semibold">Z report</h2><p className="mt-1 text-sm text-zinc-400">{closeReports[0].outletName} · {closeReports[0].operatorName} · shift {closeReports[0].shiftId.slice(0,8)}</p></div>
          <p className="text-xs text-zinc-500">Closed {new Date(closeReports[0].closedAt).toLocaleString(undefined,{timeZone:closeReports[0].timeZone})}</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {([
            ['Opening float', closeReports[0].openingFloatMinor],
            ['Cash sales', closeReports[0].cashSalesMinor],
            ['Customer collections', closeReports[0].customerCollectionsMinor],
            ['Cash paid-in', closeReports[0].cashPaidInMinor],
            ['Cash payouts', closeReports[0].cashPayoutMinor],
            ['Cash refunds', closeReports[0].cashRefundsMinor],
            ['Expected cash', closeReports[0].expectedCashMinor],
            ['Counted cash', closeReports[0].countedCashMinor],
          ] as const).map(([label, amount]) => <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"><p className="text-xs text-zinc-400">{label}</p><p className="mt-1 text-base font-semibold">{formatMinorMoneyText(amount,currency)}</p></div>)}
        </div>
        <p className={`mt-4 rounded-lg border p-3 text-sm ${BigInt(closeReports[0].varianceMinor)===0n?'border-emerald-900 bg-emerald-950/30 text-emerald-200':'border-amber-900 bg-amber-950/30 text-amber-200'}`}>
          Cash variance: <strong className="font-mono">{formatMinorMoneyText(closeReports[0].varianceMinor,currency)}</strong>. This server report records the counted till and its cash source totals.
        </p>
        <p className="mt-2 text-xs text-zinc-500">Report ID {closeReports[0].id} · close command {closeReports[0].commandId}</p>
      </section>}

      {movementType && shift && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy&&!unknownCommandId)setMovementType(null)}}>
        <section role="dialog" aria-modal="true" aria-labelledby="cash-movement-title" className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
          <header><p className="text-xs uppercase tracking-widest text-blue-300">Till movement · {session.outlet.name}</p><h2 id="cash-movement-title" className="mt-1 text-xl font-bold">{movementType==='PAID_IN'?'Record cash paid-in':'Record cash payout'}</h2><p className="mt-1 text-sm text-zinc-400">Expected cash before movement: {formatMinorMoney(shift.expectedCashMinor,currency)}.</p></header>
          <form onSubmit={event=>void submitCashMovement(event)} className="mt-4 space-y-3">
            <label className="block text-sm text-zinc-300">Amount ({currency})<input required disabled={busy||!!unknownCommandId} autoFocus inputMode="decimal" value={movementAmount} onChange={event=>setMovementAmount(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white" placeholder="0.00" /></label>
            <label className="block text-sm text-zinc-300">Reason<textarea required disabled={busy||!!unknownCommandId} maxLength={200} value={movementReason} onChange={event=>setMovementReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white" placeholder={movementType==='PAID_IN'?'Cash returned to the till':'Petty cash withdrawal'} /></label>
            <label className="block text-sm text-zinc-300">Reference <span className="text-zinc-500">(optional)</span><input disabled={busy||!!unknownCommandId} maxLength={120} value={movementReference} onChange={event=>setMovementReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white" placeholder="Voucher or receipt number" /></label>
            {movementMessage && <p role={unknownCommandId?'alert':'status'} className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">{movementMessage}{unknownCommandId&&<button type="button" onClick={()=>void checkUnknown()} className="ml-2 underline">Check status</button>}</p>}
            <div className="flex flex-wrap justify-end gap-2 pt-2"><button type="button" disabled={busy||!!unknownCommandId} onClick={()=>setMovementType(null)} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-zinc-300">Cancel</button><button disabled={busy||!!unknownCommandId} className={`min-h-11 rounded-lg px-4 font-semibold text-white disabled:opacity-50 ${movementType==='PAID_IN'?'bg-emerald-600':'bg-amber-700'}`}>{busy?'Saving…':movementType==='PAID_IN'?'Record paid-in':'Record payout'}</button></div>
          </form>
        </section>
      </div>}
    </section>
  );
};
