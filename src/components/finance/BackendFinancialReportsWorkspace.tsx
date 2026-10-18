import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,BookOpen,CalendarDays,ChevronRight,RefreshCw,Scale} from 'lucide-react';
import {apiClient,type BackendJournalLines,type BackendPartialOperatingSummary,type BackendTrialBalance} from '../../services/apiClient';
import {formatMinorMoneyText as money} from '../../utils/money';
import {businessDateKey,shiftBusinessDate} from '../../utils/businessDate';
import {sourceLabel} from '../../utils/reportPresentation';
import {JournalSourcePanel} from './JournalSourcePanel';

type ReportView='trial-balance'|'operating-summary';
type Selection={code:string;name:string;asOf?:string;from?:string;to?:string};
const button='min-h-11 rounded-lg border border-zinc-700 px-4 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-50';
const dateInput='h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 [color-scheme:dark]';

export function BackendFinancialReportsWorkspace({initialView='operating-summary'}:{initialView?:ReportView}){
  const session=apiClient.getSession()!;
  const today=useMemo(()=>businessDateKey(new Date(),session.tenant.timeZone),[session.tenant.timeZone]);
  const [view,setView]=useState<ReportView>(initialView),[asOfInput,setAsOfInput]=useState(today),[asOf,setAsOf]=useState(today);
  const [fromInput,setFromInput]=useState(today.slice(0,7)+'-01'),[toInput,setToInput]=useState(today);
  const [period,setPeriod]=useState({from:today.slice(0,7)+'-01',to:today}),[revision,setRevision]=useState(0);
  const [trial,setTrial]=useState<BackendTrialBalance|null>(null),[summary,setSummary]=useState<BackendPartialOperatingSummary|null>(null);
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  const [selection,setSelection]=useState<Selection|null>(null),[journal,setJournal]=useState<BackendJournalLines|null>(null);
  const [offset,setOffset]=useState(0),[journalRevision,setJournalRevision]=useState(0),[journalBusy,setJournalBusy]=useState(false),[journalError,setJournalError]=useState('');
  const [sourceId,setSourceId]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let current=true;setBusy(true);setError('');
    const request=view==='trial-balance'?apiClient.getTrialBalance(asOf,controller.signal).then(value=>{if(current)setTrial(value);}):apiClient.getProfitLoss(period.from,period.to,controller.signal).then(value=>{if(current)setSummary(value);});
    void request.catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'The report could not be loaded.');}).finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;controller.abort();};
  },[view,asOf,period,revision]);
  useEffect(()=>{
    if(!selection){setJournal(null);setJournalError('');return;}
    const controller=new AbortController();let current=true;setJournalBusy(true);setJournalError('');
    if(offset===0)setJournal(null);
    void apiClient.getJournalLines({accountCode:selection.code,asOf:selection.asOf,from:selection.from,to:selection.to,limit:100,offset},controller.signal)
      .then(value=>{if(current)setJournal(previous=>offset>0&&previous?{...value,entries:[...previous.entries,...value.entries]}:value);})
      .catch(cause=>{if(current)setJournalError(cause instanceof Error?cause.message:'The account detail could not be loaded.');})
      .finally(()=>{if(current)setJournalBusy(false);});
    return()=>{current=false;controller.abort();};
  },[selection,offset,journalRevision]);
  const report=view==='trial-balance'?trial:summary;
  const currency=report?.currency??session.tenant.currency,timeZone=report?.timeZone??session.tenant.timeZone;
  const stale=report&&(view==='trial-balance'?trial?.asOf!==asOf:summary?.from!==period.from||summary?.to!==period.to);
  const clearDetail=()=>{setSelection(null);setSourceId('');setOffset(0);};
  const refresh=()=>{clearDetail();setRevision(value=>value+1);};
  const apply=()=>{
    if(view==='trial-balance'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(asOfInput)){setError('Choose a business date.');return;}
      setAsOf(asOfInput);
    }else{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(fromInput)||!/^\d{4}-\d{2}-\d{2}$/.test(toInput)||fromInput>toInput){setError('Choose a valid date range, with the start on or before the end.');return;}
      setPeriod({from:fromInput,to:toInput});
    }
    refresh();
  };
  const choose=(from:string,to:string)=>{setFromInput(from);setToInput(to);setPeriod({from,to});setAsOfInput(to);setAsOf(to);refresh();};
  const select=(code:string,name?:string)=>{
    setSourceId('');setOffset(0);
    if(selection?.code===code){setSelection(null);return;}
    setSelection({code,name:name??'Unclassified account',...(view==='trial-balance'?{asOf:trial!.asOf}:{from:summary!.from,to:summary!.to})});
  };
  return <section className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8" aria-labelledby="finance-reports-title"><div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-sky-300"><Scale size={15}/>Finance</div><h1 id="finance-reports-title" className="text-2xl font-semibold text-zinc-50">Financial reports</h1><p className="mt-1 text-sm text-zinc-400">{session.tenant.name} · all outlets · {currency} · {timeZone}</p></div>{report&&<p className="text-xs text-zinc-400">Updated {new Date(report.generatedAt).toLocaleString(undefined,{timeZone})}</p>}</header>
    <nav className="flex flex-wrap gap-2" aria-label="Financial report type">{([['trial-balance','Trial balance',BookOpen],['operating-summary','Operating summary',CalendarDays]] as const).map(([id,label,Icon])=><button type="button" key={id} onClick={()=>{setView(id);clearDetail();}} aria-pressed={view===id} className={`${button} ${view===id?'border-sky-600 bg-sky-950 text-sky-200':''}`}><Icon size={16} className="mr-2 inline"/>{label}</button>)}</nav>
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><div className="flex flex-wrap gap-2">{[['Today',today,today],['Yesterday',shiftBusinessDate(today,-1),shiftBusinessDate(today,-1)],['Last 7 days',shiftBusinessDate(today,-6),today],['This month',today.slice(0,7)+'-01',today]].map(([label,from,to])=><button key={label} type="button" className={button} onClick={()=>choose(from,to)}>{label}</button>)}</div><div className="flex flex-wrap items-end gap-3">
      {view==='trial-balance'?<label className="grid gap-1 text-xs text-zinc-400">Business date<input type="date" value={asOfInput} onChange={event=>setAsOfInput(event.target.value)} className={dateInput}/></label>:<><label className="grid gap-1 text-xs text-zinc-400">From<input type="date" value={fromInput} onChange={event=>setFromInput(event.target.value)} className={dateInput}/></label><label className="grid gap-1 text-xs text-zinc-400">To<input type="date" value={toInput} onChange={event=>setToInput(event.target.value)} className={dateInput}/></label></>}
      <button type="button" onClick={apply} disabled={busy} className={button}><RefreshCw size={15} className="mr-2 inline"/>Refresh</button><span className="text-xs text-zinc-500">Business dates use the business time zone{view==='operating-summary'?' · up to 367 days':''}</span>
    </div></div>
    {busy&&<div role="status" className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-400">{report?'Refreshing report. The last loaded result stays visible.':'Loading financial report…'}</div>}
    {error&&<div role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{error}<button type="button" onClick={refresh} disabled={busy} className="ml-3 min-h-11 underline">Try again</button></div>}
    {stale&&<p role="note" className="text-sm text-amber-200">The previous date selection is shown below until the new report loads.</p>}
    {view==='trial-balance'&&trial&&<>
      <div className={`rounded-xl border p-4 ${trial.totals.balanced?'border-emerald-900 bg-emerald-950/30':'border-amber-800 bg-amber-950/30'}`}><h2 className="font-semibold text-zinc-100">{trial.totals.balanced?'Posted journal totals balance':'Journal imbalance needs review'}</h2><p className="mt-1 text-sm text-zinc-400">{trial.coverage.explanation}</p><div className="mt-4 grid grid-cols-2 gap-3"><Metric label="Debit balances" value={trial.totals.debitMinor} currency={currency}/><Metric label="Credit balances" value={trial.totals.creditMinor} currency={currency}/></div></div>
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"><h2 className="border-b border-zinc-800 p-4 font-semibold text-zinc-100">Account balances · as of {trial.asOf}</h2><div className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="p-4">Account</th><th className="p-4 text-right">Total debits</th><th className="p-4 text-right">Total credits</th><th className="p-4 text-right">Debit balance</th><th className="p-4 text-right">Credit balance</th></tr></thead><tbody>{trial.accounts.map(account=><tr key={account.accountCode} className="border-t border-zinc-900"><th className="p-4 font-medium"><button type="button" disabled={busy||!!stale} onClick={()=>select(account.accountCode,account.accountName)} className="min-h-11 text-left text-sky-300 disabled:opacity-60">{account.accountName??'Unclassified account'}<ChevronRight size={14} className="ml-1 inline"/></button></th>{[account.debitMinor,account.creditMinor,account.netDebitMinor,account.netCreditMinor].map((value,index)=><td key={index} className="p-4 text-right font-mono text-zinc-300">{money(value,currency)}</td>)}</tr>)}{!trial.accounts.length&&<tr><td colSpan={5} className="p-10 text-center text-zinc-500">No accounting entries were posted through this date.</td></tr>}</tbody></table></div></div>
      <Coverage report={trial}/>
    </>}
    {view==='operating-summary'&&summary&&<>
      <div role="note" className="rounded-xl border border-amber-800 bg-amber-950/30 p-4"><h2 className="font-semibold text-amber-100"><AlertTriangle className="mr-2 inline" size={18}/>Partial operating summary · not net profit</h2><p className="mt-1 text-sm text-amber-100/70">{summary.coverage.explanation}</p><p className="mt-2 text-sm text-amber-100">{summary.from} through {summary.to}</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[['Revenue',summary.totals.revenueMinor],['Cost of goods sold',summary.totals.costOfGoodsSoldMinor],['Gross profit',summary.totals.grossProfitMinor],['Other income',summary.totals.otherIncomeMinor],['Other operating costs',summary.totals.otherOperatingCostsMinor],['Partial operating result',summary.totals.partialOperatingResultMinor]].map(([label,value])=><Metric key={label} label={label} value={value} currency={currency}/>)}</div>
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"><h2 className="border-b border-zinc-800 p-4 font-semibold text-zinc-100">Included operating accounts</h2><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="p-4">Account</th><th className="p-4">Section</th><th className="p-4 text-right">Amount</th></tr></thead><tbody>{summary.lines.map(line=><tr key={line.accountCode} className="border-t border-zinc-900"><th className="p-4 font-medium"><button type="button" disabled={busy||!!stale} onClick={()=>select(line.accountCode,line.accountName)} className="min-h-11 text-left text-sky-300 disabled:opacity-60">{line.accountName??'Unclassified account'}<ChevronRight size={14} className="ml-1 inline"/></button></th><td className="p-4 text-zinc-400">{line.section.replaceAll('_',' ').toLowerCase()}</td><td className="p-4 text-right font-mono text-zinc-200">{money(line.amountMinor,currency)}</td></tr>)}{!summary.lines.length&&<tr><td colSpan={3} className="p-10 text-center text-zinc-500">No operating entries were recorded in this period.</td></tr>}</tbody></table></div></div><Coverage report={summary}/>
    </>}
    {selection&&<section className="overflow-hidden rounded-xl border border-sky-900 bg-zinc-950" aria-label="Account detail"><header className="flex flex-wrap justify-between gap-3 p-4"><div><h2 className="font-semibold text-zinc-100">{selection.name} · journal detail</h2><p className="mt-1 text-xs text-zinc-400">{selection.asOf?`Through ${selection.asOf}`:`${selection.from} through ${selection.to}`} · all outlets · {timeZone}</p></div><button type="button" onClick={clearDetail} className={button}>Close detail</button></header>
      {journalBusy&&<p role="status" className="p-4 text-sm text-zinc-400">Loading account detail…</p>}{journalError&&<div role="alert" className="p-4 text-sm text-rose-300">{journalError}<button type="button" onClick={()=>setJournalRevision(value=>value+1)} className="ml-3 min-h-11 underline">Try again</button></div>}
      {journal&&<><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="p-4">Posted</th><th className="p-4">Source</th><th className="p-4 text-right">Debit</th><th className="p-4 text-right">Credit</th></tr></thead><tbody>{journal.entries.map((line,index)=><tr key={line.journalLineId??`${line.journalEntryId}-${index}`} className="border-t border-zinc-900"><td className="p-4 text-zinc-300">{new Date(line.postedAt).toLocaleString(undefined,{timeZone})}</td><td className="p-4"><button type="button" onClick={()=>setSourceId(line.journalEntryId)} className="min-h-11 text-left text-sky-300">{line.sourceName??sourceLabel(line.sourceType)} · View document</button></td><td className="p-4 text-right font-mono text-zinc-200">{money(line.debitMinor,currency)}</td><td className="p-4 text-right font-mono text-zinc-200">{money(line.creditMinor,currency)}</td></tr>)}{!journal.entries.length&&<tr><td colSpan={4} className="p-10 text-center text-zinc-500">No entries for this account in the selected dates.</td></tr>}</tbody></table></div><footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 p-4"><p className="text-xs text-zinc-500">Showing {journal.entries.length} of {journal.total} lines · document detail uses the selected outlet</p>{journal.nextOffset!==null&&<button type="button" disabled={journalBusy} onClick={()=>setOffset(journal.nextOffset!)} className={button}>Load next 100 entries</button>}</footer></>}
    </section>}
    {sourceId&&<JournalSourcePanel entryId={sourceId} onClose={()=>setSourceId('')}/>}
  </div></section>;
}
function Metric({label,value,currency}:{label:string;value:string;currency:string}){return <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><p className="text-sm text-zinc-400">{label}</p><p className="mt-2 break-words font-mono text-xl font-semibold text-zinc-100">{money(value,currency)}</p></div>;}
function Coverage({report}:{report:BackendTrialBalance|BackendPartialOperatingSummary}){
  const coverage=report.coverage;
  const omissions='omittedSources' in coverage?coverage.omittedSources:[],unknown='unknownAccountCodes' in coverage?coverage.unknownAccountCodes:[];
  return <details className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-medium text-zinc-200">Coverage and source checks</summary><div className="mt-3 grid gap-4 lg:grid-cols-3"><div><h3 className="text-xs font-semibold text-zinc-500">Journal checks</h3><p className="mt-2 text-zinc-300">{coverage.journalEntryCount} entries · {coverage.emptyJournalEntryCount} empty · {coverage.unbalancedJournalEntryCount} unbalanced</p></div><div><h3 className="text-xs font-semibold text-zinc-500">Included sources</h3><ul className="mt-2 space-y-1 text-zinc-300">{coverage.sourceTypes.length?coverage.sourceTypes.map(item=><li key={item.sourceType}>{sourceLabel(item.sourceType)}: {item.entryCount}</li>):<li>No accounting entries in scope.</li>}</ul></div>{!!(omissions.length||unknown.length)&&<div><h3 className="text-xs font-semibold text-zinc-500">Missing or unclassified</h3><ul className="mt-2 space-y-1 text-zinc-300">{omissions.map(item=><li key={item}>{item}</li>)}{!!unknown.length&&<li>{unknown.length} accounts need classification.</li>}</ul>{!!unknown.length&&<details className="mt-2 text-zinc-500"><summary className="min-h-11 cursor-pointer py-3">Account references</summary>{unknown.join(', ')}</details>}</div>}</div></details>;
}
