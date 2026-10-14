import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDownLeft, CheckCircle2, Plus, RefreshCw, Search, UserRound, X } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendCustomerAccount, type BackendCustomerStatement, type BackendShift } from '../../services/apiClient';
import { formatMinorMoneyText, parseMoneyToMinor } from '../../utils/money';

type AccountDraft = { name: string; phone: string; email: string; creditLimit: string; status: 'ACTIVE' | 'SUSPENDED' };

export function BackendCustomerWorkspace({ onNavigate }: { onNavigate: (tab: 'shifts') => void }) {
  const session = apiClient.getSession()!;
  const canManage = session.user.permissions.includes('customers.manage');
  const canSettle = session.user.permissions.includes('customers.settle');
  const [customers, setCustomers] = useState<BackendCustomerAccount[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [statement, setStatement] = useState<BackendCustomerStatement | null>(null);
  const [shift, setShift] = useState<BackendShift | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [statementLoading, setStatementLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draftOpen, setDraftOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [repaymentOpen, setRepaymentOpen] = useState(false);
  const [draft, setDraft] = useState<AccountDraft>({ name: '', phone: '', email: '', creditLimit: '0', status: 'ACTIVE' });
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [unknownId, setUnknownId] = useState('');
  const pending = useRef<BackendCommand | null>(null);
  const selected = customers.find(customer => customer.id === selectedId) ?? null;

  const load = async (preferredId = selectedId) => {
    setLoading(true); setError('');
    try {
      const result = await apiClient.listCustomerAccounts();
      setCustomers(result.customers);
      const nextId = result.customers.some(customer => customer.id === preferredId) ? preferredId : result.customers[0]?.id ?? '';
      setSelectedId(nextId);
      if (nextId) await loadStatement(nextId); else setStatement(null);
      if (canSettle) setShift((await apiClient.getCurrentShift()).shift);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Customer accounts could not be loaded.'); }
    finally { setLoading(false); }
  };

  const loadStatement = async (customerId: string) => {
    setStatementLoading(true);
    try { setStatement(await apiClient.getCustomerStatement(customerId)); }
    catch (cause) { setStatement(null); setError(cause instanceof Error ? cause.message : 'Customer statement could not be loaded.'); }
    finally { setStatementLoading(false); }
  };

  useEffect(() => {
    void load('');
    void apiClient.listRecoverableCommands(session.tenant.id).then(records => {
      const record = records.find(item => item.command.type.startsWith('customers.'));
      if (record) { pending.current = record.command; setUnknownId(record.command.commandId); setNotice('A customer account command has an unresolved outcome. Check its server status before continuing.'); }
    }).catch(() => undefined);
  }, []);

  const visibleCustomers = useMemo(() => customers.filter(customer => `${customer.name} ${customer.phone} ${customer.email ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [customers, search]);
  const receivablesMinor = customers.reduce((sum, customer) => sum + BigInt(customer.balanceMinor), 0n);
  const debtors = customers.filter(customer => BigInt(customer.balanceMinor) > 0n).length;

  const openCreate = () => {
    setEditing(false); setDraft({ name: '', phone: '', email: '', creditLimit: '0', status: 'ACTIVE' }); setDraftOpen(true); setNotice('');
  };
  const openEdit = () => {
    if (!selected) return;
    setEditing(true); setDraft({ name: selected.name, phone: selected.phone, email: selected.email ?? '', creditLimit: minorToInput(selected.creditLimitMinor, session.tenant.currency), status: selected.status }); setDraftOpen(true); setNotice('');
  };

  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || !draft.name.trim() || !draft.phone.trim()) return;
    const limit = parseMoneyToMinor(draft.creditLimit, session.tenant.currency);
    if (limit === null) { setNotice('Enter a valid credit limit in the tenant currency.'); return; }
    const id = editing && selected ? selected.id : undefined;
    const command: BackendCommand = {
      protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId,
      type: editing ? 'customers.account.update' : 'customers.account.create', occurredAt: new Date().toISOString(),
      expectedVersions: id && selected ? { [`customer:${id}`]: selected.version } : {},
      payload: { ...(id ? { customerId: id } : {}), name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim() || null, creditLimitMinor: limit, ...(editing ? { status: draft.status } : {}) },
    };
    await submitCommand(command, editing ? 'Customer account updated.' : 'Customer account created.', id);
  };

  const submitRepayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !shift || !canSettle) return;
    const amountMinor = parseMoneyToMinor(amount, session.tenant.currency);
    if (amountMinor === null || amountMinor <= 0) { setNotice('Enter a positive repayment amount.'); return; }
    if (BigInt(amountMinor) > BigInt(selected.balanceMinor)) { setNotice('Repayment cannot exceed the current account balance.'); return; }
    const command: BackendCommand = {
      protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId,
      type: 'customers.repayment', occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shift.id}`]: shift.version },
      payload: { customerId: selected.id, shiftId: shift.id, amountMinor, reference: reference.trim() || null },
    };
    await submitCommand(command, 'Cash repayment recorded and allocated to the oldest outstanding charges.', selected.id);
  };

  const submitCommand = async (command: BackendCommand, successMessage: string, customerId?: string) => {
    pending.current = command; setBusy(true); setNotice(''); setError('');
    try {
      const result = await apiClient.submitCommand(command);
      if (result.status === 'CONFIRMED') {
        pending.current = null; setUnknownId(''); setNotice(successMessage); setDraftOpen(false); setRepaymentOpen(false); setAmount(''); setReference(''); await load(customerId);
      } else {
        pending.current = null; setNotice(result.message ?? `Command ${result.status.toLowerCase()}.`);
      }
    } catch (cause) {
      setUnknownId(command.commandId); setNotice(cause instanceof Error ? cause.message : 'Command outcome is unknown. Check its status before retrying.');
    } finally { setBusy(false); }
  };

  const checkCommand = async () => {
    if (!unknownId) return;
    setBusy(true);
    try {
      const result = await apiClient.checkCommandStatus(unknownId);
      const response = result.response as { status?: string; message?: string };
      if (response.status === 'CONFIRMED') {
        pending.current = null; setUnknownId(''); setNotice('Server confirmed the command.'); setDraftOpen(false); setRepaymentOpen(false); await load(selectedId);
      } else if (response.status === 'REJECTED' || response.status === 'CONFLICT') {
        pending.current = null; setUnknownId(''); setNotice(response.message ?? `Command ${response.status.toLowerCase()}.`);
      } else setNotice(`Command status: ${result.status}. Check again shortly.`);
    } catch (cause) {
      if ((cause as { status?: number }).status === 404 && pending.current) {
        const original = pending.current;
        await submitCommand(original, 'The server confirmed the command.', selectedId);
        return;
      }
      setNotice(cause instanceof Error ? cause.message : 'Command status could not be checked.');
    }
    finally { setBusy(false); }
  };

  return <main className="min-h-full space-y-5 overflow-y-auto p-4 pb-24 text-zinc-100 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs tracking-[.18em] text-blue-300">CUSTOMER ACCOUNTS · {session.tenant.name.toUpperCase()}</p><h1 className="mt-2 text-3xl font-bold">Receivables</h1><p className="mt-2 max-w-3xl text-sm text-zinc-400">Approved credit charges and cash repayments are posted to the server account ledger and general ledger.</p></div><div className="flex gap-2"><button type="button" onClick={()=>void load()} disabled={loading||busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4"><RefreshCw size={15}/>Refresh</button>{canManage&&<button type="button" onClick={openCreate} disabled={!!unknownId} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold disabled:opacity-50"><Plus size={16}/>New customer</button>}</div></header>
    {error&&<div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>}
    {notice&&<div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-800 bg-blue-950/40 p-3 text-sm text-blue-200"><span>{notice}</span>{unknownId&&<button type="button" onClick={()=>void checkCommand()} disabled={busy} className="min-h-10 rounded-lg border border-blue-700 px-3 underline">Check command status</button>}</div>}
    <section className="grid gap-3 sm:grid-cols-3"><Metric label="Customer accounts" value={String(customers.length)}/><Metric label="Outstanding receivables" value={formatMinorMoneyText(receivablesMinor,session.tenant.currency)}/><Metric label="Accounts with balance" value={String(debtors)}/></section>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)]">
      <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-4"><label className="relative block"><Search size={16} className="absolute left-3 top-3.5 text-zinc-500"/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search name, phone, or email" className="min-h-11 w-full rounded-xl border border-zinc-800 bg-zinc-900 pl-10 pr-3 text-white" aria-label="Search customer accounts"/></label></div>
        {loading?<div role="status" className="p-10 text-center text-sm text-zinc-400">Loading customer accounts…</div>:visibleCustomers.length===0?<div className="p-10 text-center"><UserRound className="mx-auto text-zinc-600"/><p className="mt-3 font-medium">{search?'No matching accounts':'No customer accounts yet'}</p><p className="mt-1 text-sm text-zinc-500">{canManage?'Add a customer with an approved credit limit to accept account charges.':'A manager can add customer accounts.'}</p></div>:<div className="divide-y divide-zinc-800">{visibleCustomers.map(customer=><button key={customer.id} type="button" onClick={()=>{setSelectedId(customer.id);void loadStatement(customer.id)}} aria-pressed={selectedId===customer.id} className={`flex min-h-[68px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-900 ${selectedId===customer.id?'bg-sky-950/30':''}`}><span className="min-w-0"><strong className="block truncate text-sm">{customer.name}</strong><small className="text-zinc-500">{customer.phone} · {customer.status==='ACTIVE'?'Active':'Suspended'}</small></span><span className="shrink-0 text-right"><strong className="block font-mono text-sm">{formatMinorMoneyText(customer.balanceMinor,session.tenant.currency)}</strong><small className="text-zinc-500">of {formatMinorMoneyText(customer.creditLimitMinor,session.tenant.currency)}</small></span></button>)}</div>}
      </section>

      <section className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950">
        {!selected?<div className="p-10 text-center text-sm text-zinc-500">Select a customer to review their statement.</div>:<>
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 p-4"><div><p className="text-xs uppercase tracking-wider text-sky-300">Customer statement</p><h2 className="mt-1 text-xl font-semibold">{selected.name}</h2><p className="mt-1 text-sm text-zinc-400">{selected.phone}{selected.email?` · ${selected.email}`:''}</p></div><div className="flex flex-wrap gap-2">{canManage&&<button type="button" onClick={openEdit} disabled={!!unknownId} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-sm">Edit account</button>}{canSettle&&BigInt(selected.balanceMinor)>0n&&<button type="button" onClick={()=>{setAmount(minorToInput(selected.balanceMinor,session.tenant.currency));setReference('');setRepaymentOpen(true);setNotice('')}} disabled={!!unknownId} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold disabled:opacity-50"><ArrowDownLeft size={15}/>Record repayment</button>}</div></header>
          <div className="grid grid-cols-2 gap-3 border-b border-zinc-800 p-4"><Metric label="Balance due" value={formatMinorMoneyText(selected.balanceMinor,session.tenant.currency)}/><Metric label="Credit limit" value={formatMinorMoneyText(selected.creditLimitMinor,session.tenant.currency)}/></div>
          {canSettle&&!shift&&<div className="m-4 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100"><p>Open a server shift before receiving a cash repayment. Cash collections count toward that till.</p><button type="button" onClick={()=>onNavigate('shifts')} className="mt-2 min-h-10 rounded-lg border border-amber-700 px-3 font-medium">Open shift</button></div>}
          <div className="p-4"><h3 className="text-sm font-semibold">Account activity</h3>{statementLoading?<p role="status" className="py-8 text-center text-sm text-zinc-500">Loading statement…</p>:!statement||statement.entries.length===0?<p className="py-8 text-center text-sm text-zinc-500">No credit charges or repayments have been recorded.</p>:<div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">{[...statement.entries].reverse().map(entry=><article key={entry.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"><div className="flex items-start justify-between gap-3"><div><strong className="text-sm">{entry.type==='CHARGE'?'Credit sale':'Cash repayment'}</strong><p className="mt-1 text-xs text-zinc-500">{formatDate(entry.createdAt,session.tenant.timeZone)}{entry.receiptNumber?` · ${entry.receiptNumber}`:''}{entry.reference?` · Ref ${entry.reference}`:''}</p>{entry.type==='REPAYMENT'&&entry.allocations.map((allocation,index)=><small key={`${entry.id}-${index}`} className="mt-1 block text-xs text-zinc-400">Allocated {formatMinorMoneyText(allocation.amountMinor,session.tenant.currency)} to {allocation.receiptNumber}</small>)}</div><div className="text-right"><strong className={entry.type==='CHARGE'?'font-mono text-amber-300':'font-mono text-emerald-300'}>{entry.type==='CHARGE'?'+':'−'}{formatMinorMoneyText(entry.amountMinor,session.tenant.currency)}</strong><small className="mt-1 block text-zinc-500">Balance {formatMinorMoneyText(entry.balanceAfterMinor,session.tenant.currency)}</small></div></div></article>)}</div>}</div>
        </>}
      </section>
    </div>
    {draftOpen&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3"><form onSubmit={submitAccount} role="dialog" aria-modal="true" aria-labelledby="customer-account-title" className="w-full max-w-lg space-y-4 rounded-2xl border border-zinc-700 bg-zinc-950 p-5"><header className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-blue-300">Customer setup</p><h2 id="customer-account-title" className="mt-1 text-xl font-bold">{editing?'Edit account':'New customer account'}</h2><p className="mt-1 text-sm text-zinc-400">The approved credit limit is enforced by the server at checkout.</p></div><button type="button" onClick={()=>setDraftOpen(false)} aria-label="Close account form" disabled={busy||!!unknownId} className="grid h-11 w-11 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800"><X size={18}/></button></header><label className="block text-sm text-zinc-300">Customer name<input required maxLength={160} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"/></label><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-zinc-300">Phone<input required maxLength={40} value={draft.phone} onChange={event=>setDraft({...draft,phone:event.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"/></label><label className="block text-sm text-zinc-300">Email (optional)<input type="email" value={draft.email} onChange={event=>setDraft({...draft,email:event.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"/></label></div><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-zinc-300">Credit limit ({session.tenant.currency})<input required inputMode="decimal" value={draft.creditLimit} onChange={event=>setDraft({...draft,creditLimit:event.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 font-mono"/></label>{editing&&<label className="block text-sm text-zinc-300">Account status<select value={draft.status} onChange={event=>setDraft({...draft,status:event.target.value as AccountDraft['status']})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select></label>}</div>{error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy||!!unknownId} onClick={()=>setDraftOpen(false)} className="min-h-11 rounded-lg border border-zinc-700 px-4">Cancel</button><button disabled={busy||!!unknownId} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold disabled:opacity-50">{busy?'Saving…':editing?'Save account':'Create account'}</button></div></form></div>}
    {repaymentOpen&&selected&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3"><form onSubmit={submitRepayment} role="dialog" aria-modal="true" aria-labelledby="repayment-title" className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-700 bg-zinc-950 p-5"><header><p className="text-xs uppercase tracking-widest text-emerald-300">Cash collection · {session.outlet.name}</p><h2 id="repayment-title" className="mt-1 text-xl font-bold">Record repayment</h2><p className="mt-1 text-sm text-zinc-400">Current balance {formatMinorMoneyText(selected.balanceMinor,session.tenant.currency)}. Receipt allocation follows oldest open charges first.</p></header><label className="block text-sm text-zinc-300">Amount ({session.tenant.currency})<input required inputMode="decimal" autoFocus value={amount} onChange={event=>setAmount(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 font-mono text-lg"/></label><label className="block text-sm text-zinc-300">Cash receipt reference (optional)<input maxLength={120} value={reference} onChange={event=>setReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"/></label><div className="rounded-lg border border-amber-900/70 bg-amber-950/30 p-3 text-xs text-amber-100"><AlertCircle size={15} className="mr-2 inline"/>Cash only. M-Pesa and card receipts need verified provider integration before they can settle a balance.</div>{!shift&&<p role="alert" className="text-sm text-rose-300">No open shift is available.</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy||!!unknownId} onClick={()=>setRepaymentOpen(false)} className="min-h-11 rounded-lg border border-zinc-700 px-4">Cancel</button><button disabled={busy||!!unknownId||!shift} className="min-h-11 rounded-lg bg-emerald-700 px-4 font-semibold disabled:opacity-50">{busy?'Recording…':'Confirm cash repayment'}</button></div></form></div>}
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 truncate font-semibold tabular-nums">{value}</p></div>; }
function minorToInput(value: string, currency: string) {
  const digits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const amount = BigInt(value); const scale = 10n ** BigInt(digits); const whole = amount / scale;
  return digits ? `${whole}.${(amount % scale).toString().padStart(digits, '0')}` : whole.toString();
}
function formatDate(value: string, timeZone: string) { try { return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); } catch { return value; } }
