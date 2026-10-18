import React,{useEffect,useRef,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {apiClient} from '../../services/apiClient';
import type {BackendItemReport} from '../../types/reporting';
import {formatDecimalQuantity as quantity,formatMinorMoneyText as money} from '../../utils/money';
import {downloadReportCsv} from '../../utils/reportPresentation';
import {ItemTransactionPanel} from './ItemTransactionPanel';

const button='min-h-11 rounded-lg border border-zinc-700 px-4 text-sm text-zinc-200 disabled:opacity-50';
export function ItemPerformanceReport({from,to}:{from:string;to:string}){
  const [report,setReport]=useState<BackendItemReport|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [exportBusy,setExportBusy]=useState(false),[exportError,setExportError]=useState('');
  const [selectedItem,setSelectedItem]=useState(''),[pageError,setPageError]=useState(false);
  const generation=useRef(0),pageRequest=useRef<AbortController|null>(null),exportRequest=useRef<AbortController|null>(null);
  useEffect(()=>{
    const current=++generation.current,controller=new AbortController();pageRequest.current?.abort();exportRequest.current?.abort();
    setBusy(true);setError('');setPageError(false);setSelectedItem('');setExportBusy(false);setExportError('');
    void apiClient.getItemReport({from,to,limit:100},controller.signal).then(result=>{if(generation.current===current)setReport(result);})
      .catch(cause=>{if(generation.current===current)setError(cause instanceof Error?cause.message:'The item report could not be loaded.');})
      .finally(()=>{if(generation.current===current)setBusy(false);});
    return()=>{generation.current++;controller.abort();pageRequest.current?.abort();exportRequest.current?.abort();};
  },[from,to,revision]);
  const stale=report&&(report.from!==from||report.to!==to);
  const next=async()=>{
    if(!report?.nextAfter||busy||stale)return;
    const current=generation.current,controller=new AbortController();pageRequest.current=controller;setBusy(true);setError('');
    try{const result=await apiClient.getItemReport({from:report.from,to:report.to,asOf:report.asOf,after:report.nextAfter,limit:100},controller.signal);
      if(generation.current===current)setReport(previous=>previous?{...result,items:[...previous.items,...result.items]}:result);
    }catch(cause){if(generation.current===current){setPageError(true);setError(cause instanceof Error?cause.message:'The next page could not be loaded.');}}
    finally{if(generation.current===current)setBusy(false);}
  };
  const download=async()=>{
    if(!report||stale||exportBusy)return;
    const current=generation.current,controller=new AbortController();exportRequest.current=controller;setExportBusy(true);setExportError('');
    try{const csv=await apiClient.getItemReportCsv({from:report.from,to:report.to,asOf:report.asOf},controller.signal);if(generation.current===current)downloadReportCsv(`item-performance-${report.from}-${report.to}.csv`,csv);}
    catch(cause){if(generation.current===current)setExportError(cause instanceof Error?cause.message:'The report could not be downloaded.');}
    finally{if(generation.current===current)setExportBusy(false);}
  };
  return <section className="space-y-4" aria-label="Complete item report">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Item sales, returns and margin</h2><p className="mt-1 text-xs text-zinc-400">Complete totals for the selected outlet. Revenue and margin exclude tax; returns use their own dates.</p></div><div className="flex gap-2"><button type="button" onClick={()=>setRevision(value=>value+1)} disabled={busy} className={button}><RefreshCw size={14} className="mr-2 inline"/>Refresh items</button><button type="button" disabled={!report||!!stale||busy||exportBusy} onClick={()=>void download()} className={button}><Download size={14} className="mr-2 inline"/>{exportBusy?'Preparing download…':'Export complete CSV'}</button></div></header>
    {busy&&<p role="status" className="text-sm text-zinc-400">{report?'Loading item report. The last result remains visible.':'Loading item sales and returns…'}</p>}
    {error&&<div role="alert" className="rounded-lg border border-rose-900 p-3 text-sm text-rose-200">{error}<button type="button" onClick={()=>pageError?void next():setRevision(value=>value+1)} disabled={busy} className="ml-3 min-h-11 underline">Try again</button></div>}
    {exportError&&<p role="alert" className="text-sm text-rose-200">{exportError}</p>}
    {stale&&<p role="note" className="text-sm text-amber-200">Showing the previous report until the new dates load.</p>}
    {report&&<><p className="text-xs text-zinc-400">{report.outletName} · {report.from} through {report.to} · {report.timeZone} · {report.currency} · {report.total} items</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Original item value',report.totals.originalSubtotalMinor],['Item discounts',report.totals.discountMinor],['Net sales revenue',report.totals.netRevenueMinor],['Gross profit on items',report.totals.grossProfitMinor]].map(([label,value])=><article key={label} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><p className="text-xs text-zinc-400">{label}</p><p className="mt-2 break-words font-mono text-lg font-semibold">{money(value,report.currency)}</p></article>)}</div>
      <ItemTable report={report} disabled={busy||!!stale} onSelect={id=>setSelectedItem(previous=>previous===id?'':id)}/>
      <footer className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-zinc-500">Showing {report.items.length} of {report.total} items. Totals cover all items.</p>{report.nextAfter&&<button type="button" onClick={()=>void next()} disabled={busy||!!stale} className={button}>Load next 100 items</button>}</footer>
      {selectedItem&&<ItemTransactionPanel key={`${selectedItem}:${report.asOf}`} productId={selectedItem} from={report.from} to={report.to} asOf={report.asOf} onClose={()=>setSelectedItem('')}/>}
      <details className="text-xs text-zinc-500"><summary className="min-h-11 cursor-pointer py-3">Report calculation and coverage</summary><p>{report.coverage.namePolicy}</p><p className="mt-2">{report.coverage.returnsPolicy}</p><p className="mt-2">{report.coverage.snapshotPolicy}</p><p className="mt-2">Exports contain all selected items, with exact minor-unit amounts and explicit currency. Exports above 10,000 items or 5 MiB require a shorter period; a partial export is never produced.</p></details>
    </>}
  </section>;
}
function ItemTable({report,disabled,onSelect}:{report:BackendItemReport;disabled:boolean;onSelect:(id:string)=>void}){
  return <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950"><table className="w-full min-w-[1250px] text-left text-xs"><thead className="text-zinc-500"><tr>{['Item','Sold / returned','Original value','Discount','Revenue','Return revenue','Net revenue','Tax / reversed','Net COGS','Gross profit'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{report.items.map(item=><tr key={item.productId} className="border-t border-zinc-800"><th className="max-w-52 p-3 font-medium text-zinc-200"><button type="button" disabled={disabled} onClick={()=>onSelect(item.productId)} className="min-h-11 break-words text-left text-blue-300 disabled:opacity-50">{item.name} · View sales</button><p className="mt-1 text-[10px] text-zinc-500">{item.sku} · {item.unit}</p></th><td className="p-3 text-zinc-300">{quantity(item.quantity)} / {quantity(item.returnedQuantity)}</td>{[item.originalSubtotalMinor,item.discountMinor,item.revenueMinor,item.refundSubtotalMinor,item.netRevenueMinor].map((value,index)=><td key={index} className="p-3 text-right font-mono text-zinc-300">{money(value,report.currency)}</td>)}<td className="p-3 text-right font-mono text-zinc-300">{money(item.taxMinor,report.currency)} / {money(item.refundTaxMinor,report.currency)}</td><td className="p-3 text-right font-mono text-zinc-300">{money(item.netCogsMinor,report.currency)}</td><td className="p-3 text-right font-mono text-zinc-200">{money(item.grossProfitMinor,report.currency)}</td></tr>)}{!report.items.length&&<tr><td colSpan={10} className="p-10 text-center text-zinc-500">No item sales or returns in this period.</td></tr>}</tbody></table></div>;
}
