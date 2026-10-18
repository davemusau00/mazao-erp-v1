import React,{useEffect,useState} from 'react';
import {apiClient} from '../../services/apiClient';
import type {BackendJournalSource} from '../../types/reporting';
import {formatDecimalQuantity,formatMinorMoneyText as money} from '../../utils/money';

export function JournalSourcePanel({entryId,onClose}:{entryId:string;onClose:()=>void}){
  const [value,setValue]=useState<BackendJournalSource|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let current=true;setBusy(true);setError('');setValue(null);
    void apiClient.getJournalSource(entryId,controller.signal).then(result=>{if(current)setValue(result);})
      .catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'The source document could not be loaded.');})
      .finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;controller.abort();};
  },[entryId,revision]);
  return <section className="rounded-xl border border-sky-900 bg-zinc-950 p-4" aria-label="Original document">
    <header className="flex items-center justify-between gap-3"><h3 className="font-semibold text-zinc-100">{value?.document.title??'Original document'}</h3><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300">Close document</button></header>
    {busy&&<p role="status" className="py-4 text-sm text-zinc-400">Loading the original document…</p>}
    {error&&<div role="alert" className="py-4 text-sm text-rose-300">{error}<button type="button" onClick={()=>setRevision(v=>v+1)} className="ml-3 min-h-11 underline">Try again</button></div>}
    {value&&<><p className="mt-2 break-all text-xs text-zinc-400">Reference {value.document.reference} · Accounting date {value.businessDate} · Recorded {new Date(value.postedAt).toLocaleString()}</p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">{value.document.fields.map((field,index)=><div key={index}><dt className="text-xs text-zinc-500">{field.label}</dt><dd className="break-words text-sm text-zinc-200">{field.value}</dd></div>)}</dl>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="p-2">Detail</th><th className="p-2 text-right">Quantity</th><th className="p-2 text-right">Amount</th><th className="p-2 text-right">Discount</th><th className="p-2 text-right">Tax</th></tr></thead><tbody>{value.document.rows.map((row,index)=><tr key={index} className="border-t border-zinc-800"><th className="p-2 font-medium text-zinc-200">{row.label}</th><td className="p-2 text-right text-zinc-300">{row.quantity?formatDecimalQuantity(row.quantity):'—'}</td><td className="p-2 text-right font-mono text-zinc-200">{money(row.amountMinor,value.currency)}</td><td className="p-2 text-right text-zinc-300">{row.discountMinor?money(row.discountMinor,value.currency):'—'}</td><td className="p-2 text-right text-zinc-300">{row.taxMinor?money(row.taxMinor,value.currency):'—'}</td></tr>)}</tbody></table></div>
      <details className="mt-4 text-xs text-zinc-400"><summary className="min-h-11 cursor-pointer py-3">Accounting entries</summary><div className="space-y-2">{value.lines.map(line=><div key={line.id} className="flex flex-wrap justify-between gap-2"><span>{line.accountName}</span><span>Debit {money(line.debitMinor,value.currency)} · Credit {money(line.creditMinor,value.currency)}</span></div>)}</div></details>
    </>}
  </section>;
}
