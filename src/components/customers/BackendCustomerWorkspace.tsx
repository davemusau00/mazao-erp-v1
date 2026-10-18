import { actionStatusLabel } from '../../utils/presentation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDownLeft, CheckCircle2, CreditCard, DollarSign, Plus, RefreshCw, Search, ShieldAlert, TrendingUp, UserRound, X } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendCustomerAccount, type BackendCustomerStatement, type BackendShift } from '../../services/apiClient';
import { formatMinorMoneyText, minorToMoneyInput, parseMoneyToMinor } from '../../utils/money';
import { filterCustomers, summarizeCustomers, type CustomerFilter } from './customerPresentation';

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
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [loading, setLoading] = useState(true);
  const [statementLoading, setStatementLoading] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [error, setError] = useState('');
  const [statementError, setStatementError] = useState('');
  const [shiftError, setShiftError] = useState('');
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
  const accountGeneration = useRef(0);
  const statementGeneration = useRef(0);
  const shiftGeneration = useRef(0);
  const selected = customers.find(customer => customer.id === selectedId) ?? null;

  const loadShift = async () => {
    const request = ++shiftGeneration.current;
    setShiftLoading(true); setShiftError('');
    try {
      const result = await apiClient.getCurrentShift();
      if (request === shiftGeneration.current) setShift(result.shift);
    } catch (cause) {
      if (request === shiftGeneration.current) setShiftError(cause instanceof Error ? cause.message : 'Current shift status could not be loaded.');
    } finally {
      if (request === shiftGeneration.current) setShiftLoading(false);
    }
  };

  const loadStatement = async (customerId: string) => {
    const request = ++statementGeneration.current;
    setStatementLoading(true); setStatementError('');
    try {
      const result = await apiClient.getCustomerStatement(customerId);
      if (request === statementGeneration.current) setStatement(result);
    } catch (cause) {
      if (request === statementGeneration.current) setStatementError(cause instanceof Error ? cause.message : 'Customer statement could not be loaded.');
    } finally {
      if (request === statementGeneration.current) setStatementLoading(false);
    }
  };

  const selectCustomer = (customerId: string) => {
    setSelectedId(customerId); setStatement(null); setStatementError('');
    void loadStatement(customerId);
  };

  const load = async (preferredId = selectedId) => {
    const request = ++accountGeneration.current;
    setLoading(true); setError('');
    if (canSettle) void loadShift();
    try {
      const result = await apiClient.listCustomerAccounts();
      if (request !== accountGeneration.current) return;
      setCustomers(result.customers);
      const nextId = result.customers.some(customer => customer.id === preferredId) ? preferredId : result.customers[0]?.id ?? '';
      setSelectedId(nextId);
      if (nextId) {
        if (nextId !== selectedId) setStatement(null);
        void loadStatement(nextId);
      } else {
        ++statementGeneration.current; setStatement(null); setStatementError(''); setStatementLoading(false);
      }
    } catch (cause) {
      if (request === accountGeneration.current) setError(cause instanceof Error ? cause.message : 'Customer accounts could not be loaded.');
    } finally {
      if (request === accountGeneration.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load('');
    void apiClient.listRecoverableCommands(session.tenant.id).then(records => {
      const record = records.find(item => item.command.type.startsWith('customers.'));
      if (record) { pending.current = record.command; setUnknownId(record.command.commandId); setNotice('A customer account change needs review. Check its status before continuing.'); }
    }).catch(() => undefined);
    return () => { ++accountGeneration.current; ++statementGeneration.current; ++shiftGeneration.current; };
  }, []);

  const summary = useMemo(() => summarizeCustomers(customers), [customers]);
  const visibleCustomers = useMemo(() => filterCustomers(customers, search, filter), [customers, search, filter]);
  const suspended = summary.suspended;
  const metricsAvailable = !error && (!loading || customers.length > 0);

  const openCreate = () => {
    setEditing(false); setDraft({ name: '', phone: '', email: '', creditLimit: '0', status: 'ACTIVE' }); setDraftOpen(true); setNotice('');
  };
  const openEdit = () => {
    if (!selected) return;
    setEditing(true); setDraft({ name: selected.name, phone: selected.phone, email: selected.email ?? '', creditLimit: minorToMoneyInput(selected.creditLimitMinor, session.tenant.currency), status: selected.status }); setDraftOpen(true); setNotice('');
  };

  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || !draft.name.trim() || !draft.phone.trim()) return;
    const limit = parseMoneyToMinor(draft.creditLimit, session.tenant.currency);
    if (limit === null) { setNotice('Enter a valid credit limit in the business currency.'); return; }
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
        pending.current = null; setNotice(result.message ?? `Account action: ${actionStatusLabel(result.status)}.`);
      }
    } catch (cause) {
      setUnknownId(command.commandId); setNotice(cause instanceof Error ? cause.message : 'We could not confirm this change. Check its status before trying again.');
    } finally { setBusy(false); }
  };

  const checkCommand = async () => {
    if (!unknownId) return;
    setBusy(true);
    try {
      const result = await apiClient.checkCommandStatus(unknownId);
      const response = result.response as { status?: string; message?: string };
      if (response.status === 'CONFIRMED') {
        pending.current = null; setUnknownId(''); setNotice('Customer account action completed.'); setDraftOpen(false); setRepaymentOpen(false); await load(selectedId);
      } else if (response.status === 'REJECTED' || response.status === 'CONFLICT') {
        pending.current = null; setUnknownId(''); setNotice(response.message ?? `Account action: ${actionStatusLabel(response.status!)}.`);
      } else setNotice(`Status: ${actionStatusLabel(result.status)}. Check again shortly.`);
    } catch (cause) {
      if ((cause as { status?: number }).status === 404 && pending.current) {
        const original = pending.current;
        await submitCommand(original, 'The server confirmed the command.', selectedId);
        return;
      }
      setNotice(cause instanceof Error ? cause.message : 'We could not check status.');
    }
    finally { setBusy(false); }
  };

  return <main className="min-h-full space-y-4 overflow-y-auto bg-[#090b10] p-3 pb-24 text-zinc-100 sm:p-5 lg:p-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl"><UserRound className="h-6 w-6 text-blue-400"/>Customer Directory &amp; Credit Accounts</h1><span className="rounded border border-blue-800/60 bg-blue-950/60 px-2 py-0.5 text-[11px] font-medium text-blue-300">{metricsAvailable ? `${customers.length} Accounts` : 'Accounts'}</span></div><p className="mt-1 text-xs text-zinc-400">Customer accounts · {session.tenant.name}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void load()} disabled={loading||busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-700 px-3.5 text-xs font-medium disabled:opacity-50"><RefreshCw size={14}/>Refresh</button>{canManage&&<button type="button" onClick={openCreate} disabled={!!unknownId} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold hover:bg-blue-500 disabled:opacity-50"><Plus size={15}/>New Customer</button>}{canSettle&&<button type="button" onClick={()=>{if(selected&&BigInt(selected.balanceMinor)>0n){setAmount(minorToMoneyInput(selected.balanceMinor,session.tenant.currency));setReference('');setRepaymentOpen(true);setNotice('');}}} disabled={!selected||BigInt(selected.balanceMinor)===0n||!shift||!!unknownId} title={!shift?'Open a till before recording a cash repayment.':!selected||BigInt(selected.balanceMinor)===0n?'Select an account with an outstanding balance.':'Record a cash repayment'} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"><CreditCard size={14}/>Record Repayment</button>}</div>
    </header>
    {error&&<div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}<button type="button" className="ml-3 min-h-11 underline" disabled={loading} onClick={()=>void load()}>Retry customer loading</button></div>}
    {notice&&<div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-800 bg-blue-950/40 p-3 text-sm text-blue-200"><span>{notice}</span>{unknownId&&<button type="button" onClick={()=>void checkCommand()} disabled={busy} className="min-h-10 rounded-lg border border-blue-700 px-3 underline">Check status</button>}</div>}
    <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
      <CustomerMetric label="Total Receivables" value={metricsAvailable?formatMinorMoneyText(summary.totalBalanceMinor,session.tenant.currency):'—'} detail={metricsAvailable?`${summary.debtors} account${summary.debtors===1?'':'s'} with outstanding debt`:'Business details unavailable'} icon={<DollarSign className="h-4 w-4 text-amber-400"/>} color="text-amber-400"/>
      <CustomerMetric label="Approved Credit Line" value={metricsAvailable?formatMinorMoneyText(summary.totalCreditLimitMinor,session.tenant.currency):'—'} detail="Total approved customer credit limits" icon={<TrendingUp className="h-4 w-4 text-blue-400"/>}/>
      <CustomerMetric label="Credit Utilization" value={metricsAvailable?formatUtilization(summary.utilizationTenths):'—'} detail="Portfolio balance against approved limits" icon={<CreditCard className="h-4 w-4 text-emerald-400"/>} color="text-emerald-400"/>
      <CustomerMetric label="Account Risk & Holds" value={metricsAvailable?String(suspended):'—'} detail={metricsAvailable?(suspended?'Suspended from new credit':'No suspended accounts reported'):'Business details unavailable'} icon={<ShieldAlert className="h-4 w-4 text-rose-400"/>}/>
    </section>
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-col gap-3 border-b border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-md"><Search size={15} className="absolute left-3 top-3 text-zinc-500"/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search customer name, phone, or email…" className="min-h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-9 text-xs text-white placeholder:text-zinc-500 focus:border-blue-500" aria-label="Search customer accounts"/>{search&&<button type="button" onClick={()=>setSearch('')} aria-label="Clear search" className="absolute right-2 top-2.5 text-zinc-500 hover:text-zinc-200"><X size={15}/></button>}</label>
        <div role="group" aria-label="Filter customer accounts" className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {([{id:'all',label:'All Accounts',count:customers.length,active:'bg-blue-600 text-white'},{id:'debtors',label:'Debtors',count:summary.debtors,active:'bg-amber-600 text-white'},{id:'good_standing',label:'Zero Balance',count:customers.length-summary.debtors,active:'bg-emerald-700 text-white'},{id:'suspended',label:'Suspended',count:suspended,active:'bg-rose-700 text-white'}] as const).map(item=><button key={item.id} type="button" aria-pressed={filter===item.id} onClick={()=>setFilter(item.id)} className={`min-h-9 whitespace-nowrap rounded-lg px-3 text-[11px] font-medium transition-colors ${filter===item.id?item.active:'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100'}`}>{item.label} ({metricsAvailable?item.count:'—'})</button>)}
        </div>
      </div>
      {loading&&customers.length>0&&<p role="status" className="px-4 py-2 text-xs text-zinc-400">Refreshing customer accounts; previously loaded accounts remain available.</p>}{loading&&customers.length===0?<div role="status" className="p-10 text-center text-sm text-zinc-400">Loading customer accounts…</div>:error&&customers.length===0?<div role="status" className="p-10 text-center text-sm text-zinc-400">Customer accounts are unavailable. Retry the read above.</div>:visibleCustomers.length===0?<div className="p-10 text-center"><UserRound className="mx-auto text-zinc-600"/><p className="mt-3 text-sm font-semibold">{search||filter!=='all'?'No customers match this search or filter':'No customer accounts yet'}</p><p className="mt-1 text-xs text-zinc-500">{canManage?'Add a customer account with an approved credit limit.':'A manager can add customer accounts.'}</p></div>:<>
        <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-xs"><thead className="border-b border-zinc-800 bg-zinc-900/80 text-[10px] font-semibold uppercase text-zinc-400"><tr><th className="px-4 py-3">Customer / Contact</th><th className="px-4 py-3 text-right">Credit Limit</th><th className="px-4 py-3 text-right">Outstanding Debt</th><th className="px-4 py-3 text-right">Available Credit</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-right">Quick Actions</th></tr></thead><tbody className="divide-y divide-zinc-800">{visibleCustomers.map(customer=><tr key={customer.id} className={`hover:bg-zinc-900/50 ${selectedId===customer.id?'bg-blue-950/20':''}`}><td className="px-4 py-2.5"><button type="button" onClick={()=>{selectCustomer(customer.id)}} className="flex items-center gap-2.5 text-left"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-blue-800/60 bg-blue-950/60 text-[10px] font-bold text-blue-300">{customer.name.slice(0,2).toUpperCase()}</span><span><strong className="block text-xs text-zinc-100">{customer.name}</strong><small className="text-[11px] text-zinc-500">{customer.phone}{customer.email?` · ${customer.email}`:''}</small></span></button></td><td className="px-4 py-2.5 text-right font-mono text-zinc-300">{formatMinorMoneyText(customer.creditLimitMinor,session.tenant.currency)}</td><td className="px-4 py-2.5 text-right font-mono text-amber-300">{formatMinorMoneyText(customer.balanceMinor,session.tenant.currency)}</td><td className="px-4 py-2.5 text-right font-mono text-zinc-300">{formatMinorMoneyText(availableCredit(customer),session.tenant.currency)}</td><td className="px-4 py-2.5 text-center"><StatusBadge status={customer.status}/></td><td className="px-4 py-2.5 text-right"><button type="button" onClick={()=>{selectCustomer(customer.id)}} className="min-h-8 rounded-md border border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:border-blue-500 hover:text-white">Statement</button>{canManage&&<button type="button" onClick={()=>{selectCustomer(customer.id);setEditing(true);setDraft({name:customer.name,phone:customer.phone,email:customer.email??'',creditLimit:minorToMoneyInput(customer.creditLimitMinor,session.tenant.currency),status:customer.status});setDraftOpen(true)}} disabled={!!unknownId} className="ml-1.5 min-h-8 rounded-md border border-zinc-700 px-2.5 text-[11px] text-zinc-300 disabled:opacity-50">Edit</button>}</td></tr>)}</tbody></table></div>
        <div className="divide-y divide-zinc-800 md:hidden">{visibleCustomers.map(customer=><article key={customer.id} className={`p-3 ${selectedId===customer.id?'bg-blue-950/20':''}`}><button type="button" onClick={()=>{selectCustomer(customer.id)}} aria-pressed={selectedId===customer.id} className="flex w-full items-start justify-between gap-3 text-left"><span className="flex min-w-0 items-center gap-2.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-blue-800/60 bg-blue-950/60 text-[10px] font-bold text-blue-300">{customer.name.slice(0,2).toUpperCase()}</span><span className="min-w-0"><strong className="block truncate text-sm">{customer.name}</strong><small className="block truncate text-[11px] text-zinc-500">{customer.phone}{customer.email?` · ${customer.email}`:''}</small></span></span><StatusBadge status={customer.status}/></button><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 pl-11 text-[11px]"><span className="text-zinc-500">Limit <b className="float-right font-mono font-medium text-zinc-300">{formatMinorMoneyText(customer.creditLimitMinor,session.tenant.currency)}</b></span><span className="text-zinc-500">Owed <b className="float-right font-mono font-medium text-amber-300">{formatMinorMoneyText(customer.balanceMinor,session.tenant.currency)}</b></span><span className="text-zinc-500">Available <b className="float-right font-mono font-medium text-zinc-300">{formatMinorMoneyText(availableCredit(customer),session.tenant.currency)}</b></span><span className="flex justify-end gap-1.5"><button type="button" onClick={()=>{selectCustomer(customer.id)}} className="min-h-8 rounded-md border border-zinc-700 px-2.5 text-[11px] text-zinc-300">Statement</button>{canManage&&<button type="button" onClick={()=>{selectCustomer(customer.id);setEditing(true);setDraft({name:customer.name,phone:customer.phone,email:customer.email??'',creditLimit:minorToMoneyInput(customer.creditLimitMinor,session.tenant.currency),status:customer.status});setDraftOpen(true)}} disabled={!!unknownId} className="min-h-8 rounded-md border border-zinc-700 px-2.5 text-[11px] text-zinc-300 disabled:opacity-50">Edit</button>}</span></div></article>)}</div>
      </>}
    </section>
    <section className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950">
        {!selected?<div className="p-10 text-center text-sm text-zinc-500">Select a customer to review their statement.</div>:<>
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 p-4"><div><p className="text-xs uppercase tracking-wider text-sky-300">Customer statement</p><h2 className="mt-1 text-xl font-semibold">{selected.name}</h2><p className="mt-1 text-sm text-zinc-400">{selected.phone}{selected.email?` · ${selected.email}`:''}</p></div><div className="flex flex-wrap gap-2">{canManage&&<button type="button" onClick={openEdit} disabled={!!unknownId} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-sm">Edit account</button>}{canSettle&&BigInt(selected.balanceMinor)>0n&&<button type="button" onClick={()=>{setAmount(minorToMoneyInput(selected.balanceMinor,session.tenant.currency));setReference('');setRepaymentOpen(true);setNotice('')}} disabled={!!unknownId||!shift} title={!shift?'Open a till before recording a cash repayment.':'Record a cash repayment'} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"><ArrowDownLeft size={15}/>Record repayment</button>}</div></header>
          <div className="grid grid-cols-2 gap-3 border-b border-zinc-800 p-4"><Metric label="Balance due" value={formatMinorMoneyText(selected.balanceMinor,session.tenant.currency)}/><Metric label="Credit limit" value={formatMinorMoneyText(selected.creditLimitMinor,session.tenant.currency)}/></div>
          {canSettle&&(shiftLoading||shiftError)&&<div role={shiftError?'alert':'status'} className="mx-4 mt-3 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">{shiftError||'Checking current till status...'}{shiftError&&<button type="button" className="ml-2 min-h-11 underline" onClick={()=>void loadShift()}>Retry shift status</button>}</div>}{canSettle&&!shift&&!shiftLoading&&!shiftError&&<div className="m-4 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100"><p>Open a till before receiving a cash repayment. Cash collections count toward that till.</p><button type="button" onClick={()=>onNavigate('shifts')} className="mt-2 min-h-10 rounded-lg border border-amber-700 px-3 font-medium">Open shift</button></div>}
          <div className="p-4"><h3 className="text-sm font-semibold">Account activity</h3>{statementLoading?<p role="status" className="py-8 text-center text-sm text-zinc-500">Loading statement…</p>:statementError?<div role="alert" className="py-4 text-sm text-rose-300">{statementError}<button type="button" className="ml-2 min-h-11 underline" onClick={()=>void loadStatement(selected.id)}>Retry customer statement</button></div>:!statement||statement.entries.length===0?<p className="py-8 text-center text-sm text-zinc-500">No credit charges or repayments have been recorded.</p>:<div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">{[...statement.entries].reverse().map(entry=><article key={entry.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"><div className="flex items-start justify-between gap-3"><div><strong className="text-sm">{entry.type==='CHARGE'?'Credit sale':'Cash repayment'}</strong><p className="mt-1 text-xs text-zinc-500">{formatDate(entry.createdAt,(session.outlet.timeZone ?? session.tenant.timeZone))}{entry.receiptNumber?` · ${entry.receiptNumber}`:''}{entry.reference?` · Ref ${entry.reference}`:''}</p>{entry.type==='REPAYMENT'&&entry.allocations.map((allocation,index)=><small key={`${entry.id}-${index}`} className="mt-1 block text-xs text-zinc-400">Allocated {formatMinorMoneyText(allocation.amountMinor,session.tenant.currency)} to {allocation.receiptNumber}</small>)}</div><div className="text-right"><strong className={entry.type==='CHARGE'?'font-mono text-amber-300':'font-mono text-emerald-300'}>{entry.type==='CHARGE'?'+':'−'}{formatMinorMoneyText(entry.amountMinor,session.tenant.currency)}</strong><small className="mt-1 block text-zinc-500">Balance {formatMinorMoneyText(entry.balanceAfterMinor,session.tenant.currency)}</small></div></div></article>)}</div>}</div>
        </>}
      </section>
    {draftOpen&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3"><form onSubmit={submitAccount} role="dialog" aria-modal="true" aria-labelledby="customer-account-title" className="w-full max-w-lg space-y-4 rounded-2xl border border-zinc-700 bg-zinc-950 p-5"><header className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-blue-300">Customer setup</p><h2 id="customer-account-title" className="mt-1 text-xl font-bold">{editing?'Edit account':'New customer account'}</h2><p className="mt-1 text-sm text-zinc-400">Sales on account cannot exceed the approved credit limit.</p></div><button type="button" onClick={()=>setDraftOpen(false)} aria-label="Close account form" disabled={busy||!!unknownId} className="grid h-11 w-11 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800"><X size={18}/></button></header><label className="block text-sm text-zinc-300">Customer name<input required maxLength={160} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"/></label><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-zinc-300">Phone<input required maxLength={40} value={draft.phone} onChange={event=>setDraft({...draft,phone:event.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"/></label><label className="block text-sm text-zinc-300">Email (optional)<input type="email" value={draft.email} onChange={event=>setDraft({...draft,email:event.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"/></label></div><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-zinc-300">Credit limit ({session.tenant.currency})<input required inputMode="decimal" value={draft.creditLimit} onChange={event=>setDraft({...draft,creditLimit:event.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 font-mono"/></label>{editing&&<label className="block text-sm text-zinc-300">Account status<select value={draft.status} onChange={event=>setDraft({...draft,status:event.target.value as AccountDraft['status']})} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select></label>}</div>{error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy||!!unknownId} onClick={()=>setDraftOpen(false)} className="min-h-11 rounded-lg border border-zinc-700 px-4">Cancel</button><button disabled={busy||!!unknownId} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold disabled:opacity-50">{busy?'Saving…':editing?'Save account':'Create account'}</button></div></form></div>}
    {repaymentOpen&&selected&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3"><form onSubmit={submitRepayment} role="dialog" aria-modal="true" aria-labelledby="repayment-title" className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-700 bg-zinc-950 p-5"><header><p className="text-xs uppercase tracking-widest text-emerald-300">Cash collection · {session.outlet.name}</p><h2 id="repayment-title" className="mt-1 text-xl font-bold">Record repayment</h2><p className="mt-1 text-sm text-zinc-400">Current balance {formatMinorMoneyText(selected.balanceMinor,session.tenant.currency)}. Receipt allocation follows oldest open charges first.</p></header><label className="block text-sm text-zinc-300">Amount ({session.tenant.currency})<input required inputMode="decimal" autoFocus value={amount} onChange={event=>setAmount(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 font-mono text-lg"/></label><label className="block text-sm text-zinc-300">Cash receipt reference (optional)<input maxLength={120} value={reference} onChange={event=>setReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"/></label><div className="rounded-lg border border-amber-900/70 bg-amber-950/30 p-3 text-xs text-amber-100"><AlertCircle size={15} className="mr-2 inline"/>Cash only. M-Pesa and card receipts need verified provider integration before they can settle a balance.</div>{!shift&&<p role="alert" className="text-sm text-rose-300">No open shift is available.</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy||!!unknownId} onClick={()=>setRepaymentOpen(false)} className="min-h-11 rounded-lg border border-zinc-700 px-4">Cancel</button><button disabled={busy||!!unknownId||!shift} className="min-h-11 rounded-lg bg-emerald-700 px-4 font-semibold disabled:opacity-50">{busy?'Recording…':'Confirm cash repayment'}</button></div></form></div>}
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 truncate font-semibold tabular-nums">{value}</p></div>; }
function CustomerMetric({ label, value, detail, icon, color = 'text-zinc-100' }: { label:string; value:string; detail:string; icon:React.ReactNode; color?:string }) { return <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 p-3 sm:p-4"><div className="mb-1 flex items-center justify-between gap-2 text-xs text-zinc-400"><span>{label}</span>{icon}</div><div className={`truncate font-mono text-base font-bold tabular-nums sm:text-xl ${color}`}>{value}</div><div className="mt-1 truncate text-[10px] text-zinc-500">{detail}</div></div>; }
function StatusBadge({ status }: { status:BackendCustomerAccount['status'] }) { const active=status==='ACTIVE'; return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${active?'border-emerald-800 bg-emerald-950/50 text-emerald-300':'border-rose-800 bg-rose-950/50 text-rose-300'}`}>{active?'Active':'Suspended'}</span>; }
function availableCredit(customer:BackendCustomerAccount) { const available=BigInt(customer.creditLimitMinor)-BigInt(customer.balanceMinor); return available>0n?available:0n; }
function formatUtilization(tenths:string|null) { if(tenths===null)return 'Not available'; const value=BigInt(tenths); return `${value/10n}.${value%10n}%`; }
function formatDate(value: string, timeZone: string) { try { return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); } catch { return value; } }
