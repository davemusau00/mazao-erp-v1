import React,{useEffect,useRef,useState} from 'react';
import {apiClient,type BackendSaleReceipt} from '../../services/apiClient';
import type {BackendItemEvents} from '../../types/reporting';
import {formatDecimalQuantity as quantity,formatMinorMoneyText as money} from '../../utils/money';
import {BackendReceiptModal} from '../hardware/BackendReceiptModal';

export function ItemTransactionPanel({productId,from,to,asOf,onClose}:{productId:string;from:string;to:string;asOf:string;onClose:()=>void}){
  const [data,setData]=useState<BackendItemEvents|null>(null),[after,setAfter]=useState<string|undefined>(),[revision,setRevision]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const [receiptId,setReceiptId]=useState(''),[receipt,setReceipt]=useState<BackendSaleReceipt|null>(null),[receiptBusy,setReceiptBusy]=useState(false),[receiptError,setReceiptError]=useState(''),[receiptRevision,setReceiptRevision]=useState(0);
  const key=`${productId}:${from}:${to}:${asOf}`,loadedKey=useRef('');
  useEffect(()=>{
    const controller=new AbortController();let current=true;setBusy(true);setError('');
    const changed=loadedKey.current!==key;
    if(changed){setData(null);setAfter(undefined);loadedKey.current=key;}
    void apiClient.getItemEvents({productId,from,to,asOf,after:changed?undefined:after,limit:100},controller.signal)
      .then(result=>{if(current)setData(previous=>!changed&&after&&previous?{...result,events:[...previous.events,...result.events]}:result);})
      .catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'Item transactions could not be loaded.');})
      .finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;controller.abort();};
  },[key,after,revision]);
  useEffect(()=>{
    if(!receiptId)return;
    const controller=new AbortController();let current=true;setReceipt(null);setReceiptBusy(true);setReceiptError('');
    void apiClient.getSaleReceipt(receiptId,controller.signal).then(value=>{if(current)setReceipt(value);})
      .catch(cause=>{if(current)setReceiptError(cause instanceof Error?cause.message:'The receipt could not be loaded.');})
      .finally(()=>{if(current)setReceiptBusy(false);});
    return()=>{current=false;controller.abort();};
  },[receiptId,receiptRevision]);
  return <section className="rounded-xl border border-blue-900 bg-zinc-950 p-4" aria-label="Item source transactions">
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Original item transactions</h3><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm">Close item detail</button></header><p className="mt-2 text-xs text-zinc-400">{from} through {to} · sales and returns keep their original prices, discounts, tax and costs.</p>
    {busy&&<p role="status" className="py-4 text-sm text-zinc-400">Loading item transactions…</p>}{error&&<div role="alert" className="py-3 text-sm text-rose-300">{error}<button type="button" onClick={()=>setRevision(value=>value+1)} className="ml-3 min-h-11 underline">Try again</button></div>}
    {data&&<><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="text-zinc-500"><tr>{['Business time','Action and receipt','Recorded item name','Quantity','Revenue','Discount','Tax','Original cost'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{data.events.map(event=><tr key={`${event.kind}-${event.eventId}`} className="border-t border-zinc-800"><td className="p-3 text-zinc-400">{new Date(event.occurredAt).toLocaleString(undefined,{timeZone:data.timeZone})}</td><td className="p-3"><p className="text-zinc-300">{event.kind==='SALE'?'Sale':event.restocked?'Return · restocked':'Return · not restocked'}</p><button type="button" onClick={()=>setReceiptId(event.receiptId)} className="min-h-11 text-blue-300">View receipt #{event.receiptId.slice(0,8).toUpperCase()}</button></td><td className="p-3 text-zinc-300">{event.name}</td><td className="p-3 text-right text-zinc-300">{quantity(event.quantity)}</td>{[event.subtotalMinor,event.discountMinor,event.taxMinor,event.cogsMinor].map((value,index)=><td key={index} className="p-3 text-right font-mono text-zinc-200">{money(value,data.currency)}</td>)}</tr>)}{!data.events.length&&<tr><td colSpan={8} className="p-8 text-center text-zinc-500">No item transactions in these dates.</td></tr>}</tbody></table></div><footer className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500"><p>Showing {data.events.length} of {data.total} transactions.</p>{data.nextAfter&&<button type="button" disabled={busy} onClick={()=>setAfter(data.nextAfter!)} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-zinc-200 disabled:opacity-50">Load next 100 transactions</button>}</footer></>}
    {receiptId&&<BackendReceiptModal receipt={receipt} loading={receiptBusy} error={receiptError} onRetry={()=>setReceiptRevision(value=>value+1)} onClose={()=>setReceiptId('')}/>}
  </section>;
}
