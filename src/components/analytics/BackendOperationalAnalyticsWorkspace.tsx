import React,{useEffect,useMemo,useState} from 'react';
import {BarChart3,RefreshCw} from 'lucide-react';
import {apiClient,type BackendOperationalAnalytics} from '../../services/apiClient';
import {formatDecimalQuantity,formatMinorMoneyText as money} from '../../utils/money';
import {businessDateKey,shiftBusinessDate,formatBusinessDateLabel} from '../../utils/businessDate';
import {ItemPerformanceReport} from './ItemPerformanceReport';

const button='min-h-11 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-200 disabled:opacity-50';
function barWidth(value:string,maximum:string){const max=BigInt(maximum);if(max<=0n)return'0%';const percentage=BigInt(value)*10_000n/max;return`${Math.max(0,Math.min(100,Number(percentage)/100))}%`;}
export function BackendOperationalAnalyticsWorkspace(){
  const session=apiClient.getSession()!,timeZone=session.outlet.timeZone??session.tenant.timeZone;
  const today=useMemo(()=>businessDateKey(new Date(),timeZone),[timeZone]);
  const [fromInput,setFromInput]=useState(shiftBusinessDate(today,-6)),[toInput,setToInput]=useState(today);
  const [period,setPeriod]=useState({from:shiftBusinessDate(today,-6),to:today}),[revision,setRevision]=useState(0);
  const [report,setReport]=useState<BackendOperationalAnalytics|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const [view,setView]=useState<'overview'|'items'>('overview');
  useEffect(()=>{
    const controller=new AbortController();let current=true;setBusy(true);setError('');
    void apiClient.getOperationalAnalytics(period.from,period.to,controller.signal).then(value=>{if(current)setReport(value);})
      .catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'The sales overview could not be loaded.');})
      .finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;controller.abort();};
  },[period,revision]);
  const choose=(from:string,to:string)=>{setFromInput(from);setToInput(to);setPeriod({from,to});};
  const apply=()=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fromInput)||!/^\d{4}-\d{2}-\d{2}$/.test(toInput)||fromInput>toInput){setError('Choose a valid date range, with the start on or before the end.');return;}
    setPeriod({from:fromInput,to:toInput});
  };
  const currency=report?.currency??session.tenant.currency;
  const stale=report&&(report.from!==period.from||report.to!==period.to);
  const largestDay=report?.daily.reduce((max,day)=>BigInt(day.grossMinor)>max?BigInt(day.grossMinor):max,0n).toString()??'0';
  const largestProduct=report?.topProducts.reduce((max,item)=>BigInt(item.revenueMinor)>max?BigInt(item.revenueMinor):max,0n).toString()??'0';
  return <main className="min-h-full space-y-4 overflow-y-auto bg-[#090b10] p-3 pb-24 text-zinc-100 sm:p-5 lg:p-6">
    <header className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:justify-between"><div><h1 className="text-xl font-bold sm:text-2xl"><BarChart3 className="mr-2 inline text-blue-400" size={22}/>Sales &amp; Operations Overview</h1><p className="mt-1 text-xs text-zinc-400">{session.outlet.name} · {timeZone} · {session.tenant.currency}</p></div><div className="flex flex-wrap gap-2">{[['Today',today,today],['Yesterday',shiftBusinessDate(today,-1),shiftBusinessDate(today,-1)],['Last 7 days',shiftBusinessDate(today,-6),today],['This month',today.slice(0,7)+'-01',today]].map(([label,from,to])=><button key={label} type="button" className={button} onClick={()=>choose(from,to)}>{label}</button>)}</div></header>
    <section className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3"><label className="grid gap-1 text-xs text-zinc-400">From<input type="date" value={fromInput} onChange={event=>setFromInput(event.target.value)} className="min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white [color-scheme:dark]"/></label><label className="grid gap-1 text-xs text-zinc-400">To<input type="date" value={toInput} onChange={event=>setToInput(event.target.value)} className="min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white [color-scheme:dark]"/></label><button type="button" onClick={apply} className={button}>Apply dates</button><button type="button" onClick={()=>setRevision(value=>value+1)} disabled={busy} aria-label="Refresh operational analytics" className={button}><RefreshCw size={15}/></button><span className="text-xs text-zinc-500">Up to 367 days</span></section>
    <nav className="flex gap-2" aria-label="Operating report"><button type="button" onClick={()=>setView('overview')} aria-pressed={view==='overview'} className={button}>Sales overview</button><button type="button" onClick={()=>setView('items')} aria-pressed={view==='items'} className={button}>All items, returns and margin</button></nav>
    {view==='items'?<ItemPerformanceReport from={period.from} to={period.to}/>:<>
      {busy&&<p role="status" className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-400">{report?'Refreshing sales overview. The last result remains visible.':'Loading sales and collections…'}</p>}
      {error&&<div role="alert" className="rounded-xl border border-rose-900 p-4 text-sm text-rose-200">{error}<button type="button" disabled={busy} onClick={()=>setRevision(value=>value+1)} className="ml-3 min-h-11 underline">Try again</button></div>}
      {stale&&<p role="note" className="text-sm text-amber-200">The previous dates remain visible until the new overview loads.</p>}
      {report&&<>
        <div className="rounded-xl border border-blue-900 bg-blue-950/30 p-3 text-xs text-blue-100"><p>{report.outletName} · {report.from} through {report.to} · {report.timeZone}</p><p className="mt-2">{report.coverage.scope} These measures are not a complete accounting profit report.</p></div>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
          ['Item invoice totals',report.totals.grossSalesMinor,`${report.coverage.orderCount} sales · includes tax`],
          ['Net sales revenue',report.totals.netRevenueMinor,'After discounts and returns · excludes tax'],
          ['Cash from sales',report.totals.cashCollectedMinor,`${report.coverage.cashPaymentCount} cash sale payments`],
          ['M-Pesa received',report.totals.manualMpesaMinor,`${report.coverage.manualMpesaPaymentCount} cashier-confirmed payments`],
        ].map(([label,value,note])=><Kpi key={label} label={label} value={money(value,currency)} note={note}/>)}</section>
        <section className="grid gap-4 lg:grid-cols-2"><Breakdown title="Sales and returns" currency={currency} rows={[
          ['Original item value',report.totals.originalSubtotalMinor],['Item discounts',report.totals.discountMinor],['Discounted revenue',report.totals.subtotalMinor],
          ['Return revenue',report.totals.refundSubtotalMinor],['Net sales revenue',report.totals.netRevenueMinor],['Tax charged',report.totals.taxMinor],
          ['Tax reversed on returns',report.totals.refundTaxMinor],['Net tax',report.totals.netTaxMinor],['Cash refunds including tax',report.totals.refundsMinor],
          ['Net invoices including tax',report.totals.netInvoiceMinor],['Sales on customer account',report.totals.accountCreditMinor],
        ]} note="Returns are included on their return date, even for an earlier sale. Customer account charges are sales, not cash collections."/>
          <Breakdown title="Cash receipts and drawer movement" currency={currency} rows={[
            ['Cash from item sales',report.totals.cashCollectedMinor],['Customer account collections',report.totals.customerCollectionsMinor],['Guest checkout cash',report.totals.roomCashCollectionsMinor],
            ['Total cash collections',report.totals.totalCashCollectionsMinor],['Cash paid-in',report.totals.cashPaidInMinor],['Cash refunds',report.totals.cashRefundsMinor],['Cash payouts',report.totals.cashPayoutMinor],['Net drawer movement',report.totals.netDrawerMovementMinor],
          ]} note={report.coverage.drawerMovementExplanation}/></section>
        <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><h2 className="text-sm font-semibold">Daily item sales and returns</h2><p className="mt-1 text-xs text-zinc-500">Invoice amounts include tax. Returns use their own business dates.</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[500px] text-left text-xs"><thead className="text-zinc-500"><tr><th className="py-2">Business date</th><th>Sales</th><th className="text-right">Invoice total</th><th className="text-right">Returns</th></tr></thead><tbody>{report.daily.map(day=><tr key={day.date}><th className="py-2 font-normal text-zinc-400">{formatBusinessDateLabel(day.date,report.timeZone)}</th><td className="w-2/5 px-3"><div className="h-4 rounded bg-zinc-900"><div className="h-full rounded bg-blue-600" style={{width:barWidth(day.grossMinor,largestDay)}}/></div></td><td className="text-right font-mono text-zinc-300">{money(day.grossMinor,currency)}</td><td className="pl-3 text-right font-mono text-amber-200">{money(day.refundMinor,currency)}</td></tr>)}</tbody></table></div></section>
        <section className="rounded-xl border border-zinc-800 bg-zinc-950"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 p-4"><div><h2 className="text-sm font-semibold">Top products by recorded sales</h2><p className="mt-1 text-xs text-zinc-500">Showing {report.topProducts.length} of {report.coverage.productCount} items · after item discounts, before returns · excludes tax</p></div><button type="button" onClick={()=>setView('items')} className={button}>View complete item report</button></header>{report.topProducts.length?<div className="divide-y divide-zinc-800">{report.topProducts.map((item,index)=><article key={item.productId} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 p-3"><span className="text-xs text-zinc-600">{index+1}</span><div className="min-w-0"><h3 className="break-words text-sm font-medium">{item.name}</h3><p className="mt-1 text-xs text-zinc-500">{item.sku} · {formatDecimalQuantity(item.quantity)} units · {item.orderCount} sales</p><div className="mt-2 h-1.5 rounded bg-zinc-900"><div className="h-full rounded bg-blue-500" style={{width:barWidth(item.revenueMinor,largestProduct)}}/></div></div><p className="font-mono text-xs text-zinc-200">{money(item.revenueMinor,currency)}</p></article>)}</div>:<p className="p-8 text-center text-sm text-zinc-500">No item sales in this period.</p>}</section>
        <footer className="text-xs text-zinc-500">Updated {new Date(report.generatedAt).toLocaleString(undefined,{timeZone:report.timeZone})}. M-Pesa entries are cashier-confirmed; settlement statements and automatic provider verification are not included. Room revenue is available in Money and is excluded from item sales.</footer>
      </>}
    </>}
  </main>;
}
function Kpi({label,value,note}:{label:string;value:string;note:string}){return <article className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 p-4"><p className="text-xs text-zinc-400">{label}</p><p className="mt-2 break-words font-mono text-lg font-semibold">{value}</p><p className="mt-2 text-xs text-zinc-500">{note}</p></article>;}
function Breakdown({title,rows,currency,note}:{title:string;rows:string[][];currency:string;note:string}){return <article className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><h2 className="text-sm font-semibold">{title}</h2><dl className="mt-4 space-y-3">{rows.map(([label,value])=><div key={label} className="flex flex-wrap justify-between gap-2 text-xs"><dt className="text-zinc-400">{label}</dt><dd className="font-mono text-zinc-200">{money(value,currency)}</dd></div>)}</dl><p className="mt-4 text-xs leading-5 text-zinc-500">{note}</p></article>;}
