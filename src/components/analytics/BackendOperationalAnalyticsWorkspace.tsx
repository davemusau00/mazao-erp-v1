import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CalendarDays, CreditCard, DollarSign, Package, RefreshCw, Wallet } from 'lucide-react';
import { apiClient, type BackendOperationalAnalytics } from '../../services/apiClient';
import { formatMinorMoneyText } from '../../utils/money';

function dateForZone(timeZone: string, value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(value);
  const get = (key:string) => parts.find(part=>part.type===key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function addDays(value:string, amount:number) { const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10); }
function width(value:string, maximum:string) { const max=BigInt(maximum);if(max===0n)return '0%';const valueBig=BigInt(value);const percent=valueBig*10_000n/max;return `${Number(percent)/100}%`; }

export function BackendOperationalAnalyticsWorkspace() {
  const session=apiClient.getSession()!;
  const timeZone=session.outlet.timeZone??session.tenant.timeZone;
  const today=useMemo(()=>dateForZone(timeZone),[timeZone]);
  const [fromInput,setFromInput]=useState(addDays(today,-6));
  const [toInput,setToInput]=useState(today);
  const [period,setPeriod]=useState({from:addDays(today,-6),to:today});
  const [report,setReport]=useState<BackendOperationalAnalytics|null>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{
    let current=true;setBusy(true);setError('');
    void apiClient.getOperationalAnalytics(period.from,period.to)
      .then(result=>{if(current)setReport(result);})
      .catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'Operational analytics could not be loaded.');})
      .finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[period]);

  const applyRange=()=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fromInput)||!/^\d{4}-\d{2}-\d{2}$/.test(toInput)||fromInput>toInput){setError('Choose real business dates with the start on or before the end.');return;}
    setPeriod({from:fromInput,to:toInput});
  };
  const choose=(from:string,to:string)=>{setFromInput(from);setToInput(to);setPeriod({from,to});};
  const currency=report?.currency??session.tenant.currency;
  const largestDay=report?.daily.reduce((max,day)=>BigInt(day.grossMinor)>max?BigInt(day.grossMinor):max,0n).toString()??'0';
  const largestProduct=report?.topProducts.reduce((max,item)=>BigInt(item.revenueMinor)>max?BigInt(item.revenueMinor):max,0n).toString()??'0';

  return <main className="min-h-full space-y-4 overflow-y-auto bg-[#090b10] p-3 pb-24 text-zinc-100 sm:p-5 lg:p-6">
    <header className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-blue-400"/><h1 className="text-xl font-bold sm:text-2xl">Sales &amp; Operations Overview</h1></div><p className="mt-1 text-xs text-zinc-400">Confirmed server sales for {session.outlet.name} · {timeZone}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={()=>choose(today,today)} aria-pressed={period.from===today&&period.to===today} className="min-h-9 rounded-lg border border-zinc-700 px-3 text-xs">Today</button><button type="button" onClick={()=>choose(addDays(today,-1),addDays(today,-1))} className="min-h-9 rounded-lg border border-zinc-700 px-3 text-xs">Yesterday</button><button type="button" onClick={()=>choose(addDays(today,-6),today)} className="min-h-9 rounded-lg border border-zinc-700 px-3 text-xs">Last 7 days</button><button type="button" onClick={()=>choose(`${today.slice(0,7)}-01`,today)} className="min-h-9 rounded-lg border border-zinc-700 px-3 text-xs">This month</button></div></header>
    <section className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3"><label className="grid gap-1 text-[11px] text-zinc-400">From<input type="date" value={fromInput} onChange={event=>setFromInput(event.target.value)} className="min-h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white [color-scheme:dark]"/></label><label className="grid gap-1 text-[11px] text-zinc-400">To<input type="date" value={toInput} onChange={event=>setToInput(event.target.value)} className="min-h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white [color-scheme:dark]"/></label><button type="button" onClick={applyRange} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-semibold disabled:opacity-50"><CalendarDays size={14}/>Apply dates</button><button type="button" onClick={()=>setPeriod({...period})} disabled={busy} aria-label="Refresh operational analytics" className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-zinc-700 disabled:opacity-50"><RefreshCw size={14}/></button><span className="text-[11px] text-zinc-500">Up to 367 days · report currency {currency}</span></section>
    {error&&<div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>}
    {busy&&!report&&<div role="status" className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">Loading scoped server aggregates…</div>}
    {report&&<>
      <div role="note" className="flex items-start gap-3 rounded-xl border border-blue-900/70 bg-blue-950/30 p-3 text-xs text-blue-100"><AlertTriangle className="mt-0.5 shrink-0 text-blue-300" size={16}/><span>{report.coverage.scope} Coverage: {report.coverage.orderCount} orders, {report.coverage.refundCount} refunds. Card and mobile-money provider settlements are excluded. These operating measures are not an accounting profit report.</span></div>
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3"><Kpi label="Gross Sales" value={formatMinorMoneyText(report.totals.grossSalesMinor,currency)} note={`${report.coverage.orderCount} confirmed orders`} icon={<DollarSign className="h-4 w-4 text-emerald-400"/>}/><Kpi label="Cash Collected" value={formatMinorMoneyText(report.totals.cashCollectedMinor,currency)} note={`${report.coverage.cashPaymentCount} confirmed cash payments`} icon={<Wallet className="h-4 w-4 text-blue-400"/>}/><Kpi label="Account Credit" value={formatMinorMoneyText(report.totals.accountCreditMinor,currency)} note={`${report.coverage.accountChargeCount} customer account charges`} icon={<CreditCard className="h-4 w-4 text-purple-400"/>}/><Kpi label="Refunds" value={formatMinorMoneyText(report.totals.refundsMinor,currency)} note={`${report.coverage.refundCount} server-recorded refunds`} icon={<Package className="h-4 w-4 text-amber-400"/>}/></section>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.8fr)]"><article className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><h2 className="text-sm font-semibold">Daily confirmed sales</h2><p className="mt-1 text-[11px] text-zinc-500">Outlet business date · refunds are listed separately</p><div className="mt-4 space-y-2">{report.daily.map(day=><div key={day.date} className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-2 text-[11px]"><time className="text-zinc-400">{new Intl.DateTimeFormat(undefined,{timeZone,month:'short',day:'numeric'}).format(new Date(`${day.date}T12:00:00Z`))}</time><div className="h-5 overflow-hidden rounded bg-zinc-900"><div className="h-full rounded bg-blue-600" style={{width:width(day.grossMinor,largestDay)}} title={formatMinorMoneyText(day.grossMinor,currency)}/></div><span className="w-28 text-right font-mono text-zinc-300">{formatMinorMoneyText(day.grossMinor,currency)}</span></div>)}</div></article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><h2 className="text-sm font-semibold">Tender and account sales</h2><p className="mt-1 text-[11px] text-zinc-500">Only server-confirmed cash and customer credit</p><div className="mt-5 space-y-4"><Breakdown label="Cash payments" amount={report.totals.cashCollectedMinor} total={report.totals.grossSalesMinor} currency={currency} color="bg-emerald-600"/><Breakdown label="Customer account charges" amount={report.totals.accountCreditMinor} total={report.totals.grossSalesMinor} currency={currency} color="bg-purple-600"/></div><p className="mt-4 text-[11px] text-zinc-500">Cash receipts and account charges are separate evidence; provider payment methods are not connected.</p></article>
      </section>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950"><header className="border-b border-zinc-800 p-4"><h2 className="text-sm font-semibold">Top products by recorded sales</h2><p className="mt-1 text-[11px] text-zinc-500">Line totals before refunds · quantity and revenue come from confirmed order lines</p></header>{report.topProducts.length?<div className="divide-y divide-zinc-800">{report.topProducts.map((product,index)=><article key={product.productId} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 p-3"><span className="text-xs text-zinc-600">{index+1}</span><div className="min-w-0"><div className="flex flex-wrap items-baseline justify-between gap-x-3"><strong className="truncate text-xs">{product.name}</strong><span className="text-[10px] text-zinc-500">{product.sku} · {product.quantity} units · {product.orderCount} orders</span></div><div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-900"><div className="h-full rounded bg-blue-500" style={{width:width(product.revenueMinor,largestProduct)}}/></div></div><strong className="font-mono text-xs text-zinc-200">{formatMinorMoneyText(product.revenueMinor,currency)}</strong></article>)}</div>:<p className="p-8 text-center text-xs text-zinc-500">No product sales were recorded in this period.</p>}</section>
      <footer className="flex flex-wrap justify-between gap-2 text-[10px] text-zinc-500"><span>Snapshot generated {new Date(report.generatedAt).toLocaleString(undefined,{timeZone})} · scope {report.scope.toLowerCase()}</span><span>{report.from} through {report.to} · subtotal {formatMinorMoneyText(report.totals.subtotalMinor,currency)} · tax {formatMinorMoneyText(report.totals.taxMinor,currency)}</span></footer>
    </>}
  </main>;
}

function Kpi({label,value,note,icon}:{label:string;value:string;note:string;icon:React.ReactNode}){return <article className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 p-3 sm:p-4"><div className="mb-1 flex items-center justify-between gap-2 text-xs text-zinc-400"><span>{label}</span>{icon}</div><strong className="block truncate font-mono text-base tabular-nums sm:text-xl">{value}</strong><p className="mt-1 truncate text-[10px] text-zinc-500">{note}</p></article>}
function Breakdown({label,amount,total,currency,color}:{label:string;amount:string;total:string;currency:string;color:string}){return <div><div className="flex justify-between gap-3 text-xs"><span className="text-zinc-300">{label}</span><strong className="font-mono">{formatMinorMoneyText(amount,currency)}</strong></div><div className="mt-2 h-2 overflow-hidden rounded bg-zinc-900"><div className={`h-full rounded ${color}`} style={{width:width(amount,total)}}/></div></div>}
