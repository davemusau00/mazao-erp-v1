import React, { useEffect, useRef, useState } from 'react';
import { apiClient, type BackendCommand, type BackendShift, type BackendShiftCloseReport } from '../../services/apiClient';
import { formatMinorMoney, formatMinorMoneyText, minorToMoneyInput, moneyInputToMinor } from '../../utils/money';
import { MinusCircle, PlusCircle } from 'lucide-react';
import { useCommandRecoveryReadiness } from '../../hooks/useCommandRecoveryReadiness';
import { CommandRecoveryReadiness } from '../common/CommandRecoveryReadiness';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const pending = useRef<BackendCommand|null>(null);
  const recovery = useCommandRecoveryReadiness('shift.', command => {
    pending.current = command; setUnknownCommandId(command.commandId);
    setMessage('An unresolved shift action was restored. Check its original status before retrying.');
    if (command.type === 'shift.cash.movement') {
      const payload = command.payload;
      setMovementType(payload.movementType === 'PAID_IN' ? 'PAID_IN' : 'PAYOUT');
      setMovementAmount(minorToMoneyInput(String(payload.amountMinor ?? '0'), currency));
      setMovementReason(String(payload.reason ?? '')); setMovementReference(String(payload.reference ?? ''));
      setMovementMessage('This movement is awaiting confirmation. Check its original status before editing or resubmitting.');
    }
  });
  const locked = loading || !!loadError || !recovery.ready || busy || !!unknownCommandId;

  const refresh = async () => {
    setLoading(true); setLoadError('');
    try {
      const [current, reports] = await Promise.all([apiClient.getCurrentShift(), apiClient.listShiftCloseReports()]);
      setShift(current.shift);
      setCloseReports(reports.reports);
    }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Unable to load server shift.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  const acknowledge = async (command: BackendCommand, outcome: { status?: string; value?: Record<string, unknown>; message?: string }) => {
    const terminal = ['CONFIRMED', 'REJECTED', 'CONFLICT'].includes(outcome.status ?? '');
    if (terminal) { pending.current = null; setUnknownCommandId(null); }
    if (outcome.status === 'CONFIRMED') {
      setMovementType(null); setMovementAmount(''); setMovementReason(''); setMovementReference(''); setMovementMessage('');
      setMessage(command.type === 'shift.open' ? 'Server shift opened.' : command.type === 'shift.close'
        ? `Server shift closed. Close report ${String(outcome.value?.closeReportId ?? '')} is saved below.`
        : command.payload.movementType === 'PAID_IN' ? 'Cash paid-in recorded.' : 'Cash payout recorded.');
      await refresh();
    } else {
      const message = outcome.message ?? (terminal ? `Shift action ${outcome.status?.toLowerCase()}.` : 'The shift action is awaiting confirmation. Check its original command status.');
      setMessage(message); setMovementMessage(message);
      if (!terminal) setUnknownCommandId(command.commandId);
    }
    if (terminal) await recovery.inspect();
  };

  const submitShift = async (type:'shift.open'|'shift.close') => {
    if (locked || pending.current || !recovery.begin()) return;
    setBusy(true);
    setMessage('');
    let amountMinor: number;
    try { amountMinor = moneyInputToMinor(type === 'shift.open' ? (float || '0') : (counted || '0'), currency); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Enter a valid amount.'); recovery.finish(); setBusy(false); return; }
    const commandId = crypto.randomUUID();
    const command: BackendCommand = {
      protocolVersion:1, commandId, tenantId:session.tenant.id, deviceId:session.deviceId,
      type, occurredAt:new Date().toISOString(), expectedVersions:shift ? { [`shift:${shift.id}`]:shift.version } : {},
      payload:type === 'shift.open' ? { openingFloatMinor:amountMinor } : { shiftId:shift!.id, countedCashMinor:amountMinor },
    };
    pending.current = command;
    try {
      await acknowledge(command, await apiClient.submitCommand(command));
    } catch (error) {
      setUnknownCommandId(commandId);
      setMessage(error instanceof Error ? error.message : 'Shift command outcome is unknown. Check its status before retrying.');
    } finally { recovery.finish(); setBusy(false); }
  };

  const submitCashMovement = async (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!movementType || !shift || locked || pending.current) return;
    let amountMinor: number;
    try {
      amountMinor = moneyInputToMinor(movementAmount, currency);
      if (amountMinor <= 0) throw new Error('Enter an amount greater than zero.');
      if (!movementReason.trim()) throw new Error('Enter a reason for this till movement.');
    } catch (error) { setMovementMessage(error instanceof Error ? error.message : 'Enter valid movement details.'); return; }
    if (!recovery.begin()) return;
    const commandId = crypto.randomUUID();
    const command: BackendCommand = {
      protocolVersion:1, commandId, tenantId:session.tenant.id, deviceId:session.deviceId,
      type:'shift.cash.movement', occurredAt:new Date().toISOString(), expectedVersions:{ [`shift:${shift.id}`]:shift.version },
      payload:{ shiftId:shift.id, movementType, amountMinor, reason:movementReason.trim(), reference:movementReference.trim() || undefined },
    };
    pending.current = command;
    setBusy(true);
    setMovementMessage('');
    try {
      await acknowledge(command, await apiClient.submitCommand(command));
    } catch (error) {
      setUnknownCommandId(commandId);
      setMovementMessage(error instanceof Error ? error.message : 'Till movement outcome is unknown. Check its status before retrying.');
      setMessage('The cash movement outcome is unknown. Check its status before retrying.');
    } finally { recovery.finish(); setBusy(false); }
  };

  const checkUnknown = async () => {
    if (!unknownCommandId || !pending.current || !recovery.begin()) return;
    const original = pending.current;
    setBusy(true);
    try {
      const result = await apiClient.checkCommandStatus(unknownCommandId);
      await acknowledge(original, result.response);
    } catch (error) {
      try {
        if ((error as {status?:number}).status !== 404) throw error;
        await acknowledge(original, await apiClient.submitCommand(original));
      } catch (failure) { setMessage(failure instanceof Error ? failure.message : 'Unable to check shift command status.'); }
    } finally { recovery.finish(); setBusy(false); }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-5 p-4 pb-24 text-zinc-100 sm:p-8">
      <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} />
      {loadError && <div role="alert" className="rounded-xl border border-rose-800 p-3 text-sm text-rose-200">{loadError}<button type="button" onClick={() => void refresh()} className="ml-3 min-h-11 underline">Retry shift loading</button></div>}
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
              <p className="mt-1 text-xs text-zinc-500">Version {shift.version} · opened {new Date(shift.openedAt).toLocaleString(undefined,{timeZone:(session.outlet.timeZone ?? session.tenant.timeZone)})}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {canMoveCash && <>
                <button type="button" disabled={locked} onClick={() => { setMessage(''); setMovementMessage(''); setMovementType('PAID_IN'); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-800 px-4 text-sm text-emerald-200 hover:bg-emerald-950 disabled:opacity-50"><PlusCircle size={16}/> Cash paid-in</button>
                <button type="button" disabled={locked} onClick={() => { setMessage(''); setMovementMessage(''); setMovementType('PAYOUT'); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-800 px-4 text-sm text-amber-200 hover:bg-amber-950 disabled:opacity-50"><MinusCircle size={16}/> Cash payout</button>
              </>}
              <label className="text-xs text-zinc-400">Counted cash ({currency})<input disabled={locked} inputMode="decimal" value={counted} onChange={event=>setCounted(event.target.value)} className="mt-1 block min-h-11 w-36 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white"/></label>
              <button type="button" disabled={locked} onClick={()=>void submitShift('shift.close')} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold disabled:opacity-50">{busy?'Working…':'Close shift'}</button>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-zinc-800">
            <div className="border-b border-zinc-800 px-4 py-3"><h3 className="font-semibold">Till cash movements</h3><p className="mt-1 text-xs text-zinc-500">Paid-ins and payouts update expected cash and keep a reason and reference.</p></div>
            {shift.cashMovements.length === 0 ? <p className="p-4 text-sm text-zinc-500">No paid-ins or payouts recorded for this shift.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="p-3">When</th><th className="p-3">Movement</th><th className="p-3">Reason / reference</th><th className="p-3">Recorded by</th><th className="p-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-zinc-800">{shift.cashMovements.map(movement=><tr key={movement.id}><td className="p-3 text-zinc-400">{new Date(movement.createdAt).toLocaleString(undefined,{dateStyle:'short',timeStyle:'short',timeZone:(session.outlet.timeZone ?? session.tenant.timeZone)})}</td><td className={movement.movementType==='PAID_IN'?'p-3 font-medium text-emerald-300':'p-3 font-medium text-amber-300'}>{movement.movementType==='PAID_IN'?'Cash paid-in':'Cash payout'}</td><td className="p-3"><span>{movement.reason}</span>{movement.reference&&<small className="ml-2 text-zinc-500">{movement.reference}</small>}</td><td className="p-3 text-zinc-400">{movement.actorName}</td><td className="p-3 text-right font-mono">{movement.movementType==='PAID_IN'?'+':'−'}{formatMinorMoney(movement.amountMinor,currency)}</td></tr>)}</tbody></table></div>}
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
          <label className="text-xs text-zinc-400">Opening float ({currency})<input disabled={locked} inputMode="decimal" value={float} onChange={event=>setFloat(event.target.value)} className="mt-1 block min-h-11 w-36 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white"/></label>
          <button type="button" disabled={locked} onClick={()=>void submitShift('shift.open')} className="min-h-11 rounded-lg bg-emerald-600 px-4 font-semibold disabled:opacity-50">{busy?'Working…':'Open shift'}</button>
        </div>}
        {message && <div role={unknownCommandId?'alert':'status'} className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200"><span>{message}</span>{unknownCommandId&&<button type="button" onClick={()=>void checkUnknown()} disabled={busy || !recovery.ready} className="min-h-11 underline">Check command status</button>}</div>}
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
          <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} /><form onSubmit={event=>void submitCashMovement(event)} className="mt-4 space-y-3">
            <label className="block text-sm text-zinc-300">Amount ({currency})<input required disabled={locked} autoFocus inputMode="decimal" value={movementAmount} onChange={event=>setMovementAmount(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white" placeholder="0.00" /></label>
            <label className="block text-sm text-zinc-300">Reason<textarea required disabled={locked} maxLength={200} value={movementReason} onChange={event=>setMovementReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white" placeholder={movementType==='PAID_IN'?'Cash returned to the till':'Petty cash withdrawal'} /></label>
            <label className="block text-sm text-zinc-300">Reference <span className="text-zinc-500">(optional)</span><input disabled={locked} maxLength={120} value={movementReference} onChange={event=>setMovementReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white" placeholder="Voucher or receipt number" /></label>
            {movementMessage && <p role={unknownCommandId?'alert':'status'} className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">{movementMessage}{unknownCommandId&&<button type="button" onClick={()=>void checkUnknown()} disabled={busy || !recovery.ready} className="ml-2 min-h-11 underline">Check status</button>}</p>}
            <div className="flex flex-wrap justify-end gap-2 pt-2"><button type="button" disabled={locked} onClick={()=>setMovementType(null)} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-zinc-300">Cancel</button><button disabled={locked} className={`min-h-11 rounded-lg px-4 font-semibold text-white disabled:opacity-50 ${movementType==='PAID_IN'?'bg-emerald-600':'bg-amber-700'}`}>{busy?'Saving…':movementType==='PAID_IN'?'Record paid-in':'Record payout'}</button></div>
          </form>
        </section>
      </div>}
    </section>
  );
};
