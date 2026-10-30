import { catalogItemKind, isStockTracked } from '../../types/catalog';
import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, RotateCcw, Search, Printer } from 'lucide-react';
import { apiClient, type BackendCommand } from '../../services/apiClient';
import type { SaleHistoryOrder } from '../../types/sales';
import { subtractDecimalStrings } from '../../utils/decimal';
import { formatMinorMoneyText } from '../../utils/money';
import { formatDecimalQuantity } from '../../utils/presentation';

type RefundLineDraft = { quantity:string;restock:boolean };
export function BackendSalesHistoryWorkspace({onReprintOrder}:{onReprintOrder:(orderId:string)=>void}) {
  const session = apiClient.getSession()!, currency = session.tenant.currency;
  const canRefund = session.user.permissions.includes('commerce.refund');
  const inventoryEnabled = session.tenant.capabilities.includes('inventory');
  const refundableWithCapabilities = (order: SaleHistoryOrder) => order.lines.some(line => subtractDecimalStrings(line.quantity, line.refundedQuantity) !== '0' && (!isStockTracked(line) || inventoryEnabled));
  const [orders,setOrders]=useState<SaleHistoryOrder[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [query,setQuery]=useState(''),[appliedQuery,setAppliedQuery]=useState(''),[nextAfter,setNextAfter]=useState<string|null>(null),[asOf,setAsOf]=useState<string|undefined>();
  const [target,setTarget]=useState<SaleHistoryOrder|null>(null),[reason,setReason]=useState('Customer returned undamaged merchandise'),[lines,setLines]=useState<Record<string,RefundLineDraft>>({});
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[unknownId,setUnknownId]=useState('');
  const pending=useRef<BackendCommand|null>(null), inFlight=useRef(false), mounted=useRef(true), read=useRef<AbortController|null>(null);
  const load=async(more=false,search=appliedQuery,restore=false)=>{
    read.current?.abort();const controller=new AbortController();read.current=controller;
    const current=()=>mounted.current&&read.current===controller&&!controller.signal.aborted;
    setLoading(true);setError('');
    try {
      const result=await apiClient.listSalesOrders(controller.signal,{...(search?{q:search}:{}),...(more&&nextAfter?{after:nextAfter,asOf}:{})});
      if(!current())return;
      setOrders(previous=>more?[...previous,...result.orders.filter(row=>!previous.some(old=>old.id===row.id))]:result.orders);
      setNextAfter(result.nextAfter??null);setAsOf(result.asOf);setAppliedQuery(search);
      if(restore){
        const records=await apiClient.listRecoverableCommands(session.tenant.id);
        if(!current())return;
        const stored=records.find(record=>record.command.type==='sales.order.refund'&&record.command.deviceId===session.deviceId);
        if(stored){
          pending.current=stored.command;setUnknownId(stored.command.commandId);
          const orderId=String(stored.command.payload.orderId);
          // Recovery must also reach a sale older than the first history page.
          // Keep this exact scoped lookup out of the visible page and its totals.
          const order=result.orders.find(row=>row.id===orderId)??
            (await apiClient.listSalesOrders(controller.signal,{q:orderId})).orders.find(row=>row.id===orderId);
          if(!current())return;
          if(order){setTarget(order);setReason(String(stored.command.payload.reason??''));const entries=stored.command.payload.lines as Array<{orderLineId:string;quantity:string;restock:boolean}>;setLines(Object.fromEntries(entries.map(line=>[line.orderLineId,{quantity:line.quantity,restock:line.restock}])));}
          setNotice('A refund needs review. Check its status before issuing another refund.');
        }
      }
    } catch(cause){if(current())setError(cause instanceof Error?cause.message:'Sales history could not be loaded. Try again.');}
    finally{if(current())setLoading(false);}
  };
  useEffect(()=>{mounted.current=true;void load(false,'',true);return()=>{mounted.current=false;read.current?.abort();};},[]);
  const search=orders.filter(order=>`${order.orderNumber} ${order.cashierName} ${order.customerName??''} ${order.id} ${order.payments?.map(payment=>payment.reference??'').join(' ')??''}`.toLowerCase().includes(query.toLowerCase()));
  const salesMinor=search.reduce((sum,order)=>sum+BigInt(order.totalMinor)-BigInt(order.refundedMinor),0n), refundedMinor=search.reduce((sum,order)=>sum+BigInt(order.refundedMinor),0n);
  const beginRefund=(order:SaleHistoryOrder)=>{
    if(unknownId||inFlight.current||order.paymentMethod!=='cash'||!refundableWithCapabilities(order))return;
    setTarget(order);setReason('Customer returned undamaged merchandise');setNotice('');pending.current=null;
    setLines(Object.fromEntries(order.lines.map(line=>[line.lineId,{quantity:isStockTracked(line)&&!inventoryEnabled?'0':subtractDecimalStrings(line.quantity,line.refundedQuantity),restock:isStockTracked(line)&&session.tenant.capabilities.includes('inventory')}])));
  };
  const acknowledge=async(outcome:{status?:unknown;message?:unknown;value?:unknown})=>{
    if(!mounted.current)return;
    if(outcome.status==='CONFIRMED'){
      const value=outcome.value as Record<string,unknown>|undefined;
      setNotice(`Refund completed: ${formatMinorMoneyText(String(value?.totalMinor??'0'),currency)}, including any tax reversal.`);
      pending.current=null;setUnknownId('');setTarget(null);await load();
    }else if(outcome.status==='REJECTED'||outcome.status==='CONFLICT'){
      setNotice(typeof outcome.message==='string'?outcome.message:'The refund was not completed. Review the details.');pending.current=null;setUnknownId('');
    }else setNotice('The refund has not been confirmed. Check its status before repeating it.');
  };
  const submitRefund=async()=>{
    if(!target||unknownId||inFlight.current||target.paymentMethod!=='cash')return;
    inFlight.current=true;setBusy(true);setNotice('');
    try {
      if(!reason.trim())throw new Error('Enter a refund reason.');
      const entries=target.lines.map(line=>({line,entry:lines[line.lineId]})).filter(row=>row.entry?.quantity&&row.entry.quantity!=='0').map(({line,entry})=>{
        if(isStockTracked(line)&&!inventoryEnabled)throw new Error('Enable inventory before refunding a stocked good. Original pending refunds retain their requested stock disposition.');
        if(!/^\d+(?:\.\d{1,6})?$/.test(entry.quantity))throw new Error(`Enter a valid quantity for ${line.name}.`);
        return{orderLineId:line.lineId,quantity:entry.quantity,restock:isStockTracked(line)&&session.tenant.capabilities.includes('inventory')&&entry.restock};
      });
      if(!entries.length)throw new Error('Select at least one remaining item quantity.');
      const currentShift=(await apiClient.getCurrentShift()).shift;if(!currentShift)throw new Error('Open a cash shift before issuing a cash refund.');
      const command:BackendCommand={protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type:'sales.order.refund',occurredAt:new Date().toISOString(),expectedVersions:{[`shift:${currentShift.id}`]:currentShift.version},payload:{orderId:target.id,shiftId:currentShift.id,reason:reason.trim(),lines:entries}};
      pending.current=command;setUnknownId(command.commandId);
      await acknowledge(await apiClient.submitCommand(command));
    }catch(cause){if((cause as{code?:string}).code==='COMMAND_NOT_SENT'){pending.current=null;setUnknownId('');}if(mounted.current)setNotice(cause instanceof Error?cause.message:'The refund has not been confirmed. Check its status.');}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  };
  const checkStatus=async()=>{
    const command=pending.current;if(!command||inFlight.current)return;
    inFlight.current=true;setBusy(true);
    try{try{await acknowledge((await apiClient.checkCommandStatus(command.commandId)).response);}catch(cause){if((cause as{status?:number}).status!==404)throw cause;await acknowledge(await apiClient.submitCommand(command));}}
    catch(cause){if(mounted.current)setNotice(cause instanceof Error?cause.message:'Refund status could not be checked. Try again.');}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  };
  // A committed refund may already have exhausted the remaining quantity.
  // Its original requested lines still need review until status is confirmed.
  const pendingLineIds=new Set(unknownId&&Array.isArray(pending.current?.payload.lines)
    ?(pending.current.payload.lines as Array<{orderLineId:string}>).map(line=>line.orderLineId):[]);
  return <main className="min-h-full space-y-5 overflow-y-auto p-4 pb-24 text-zinc-100 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs tracking-[.18em] text-blue-300">SALES · {session.outlet.name.toUpperCase()}</p><h1 className="mt-2 text-3xl font-bold">Receipts and refunds</h1><p className="mt-2 text-sm text-zinc-400">Review completed sales and their payment details. Cash refunds require an open shift and an authorized manager.</p></div><button onClick={()=>void load()} disabled={loading||busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4"><RefreshCw size={15}/>Refresh</button></header>
    {error&&<p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}<button type="button" onClick={()=>void load()} className="ml-2 min-h-11 underline">Try again</button></p>}
    {notice&&<div role={unknownId?'alert':'status'} className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-800 bg-blue-950/40 p-3 text-sm text-blue-200"><span>{notice}</span>{unknownId&&<button disabled={busy} className="min-h-11 underline" onClick={()=>void checkStatus()}>Check refund status</button>}</div>}
    <section className="grid grid-cols-2 gap-3"><Metric label="Orders shown" value={String(search.length)}/><Metric label="Net receipt value shown (including tax)" value={formatMinorMoneyText(salesMinor,currency)}/><Metric label="Refunds shown (including tax)" value={formatMinorMoneyText(refundedMinor,currency)}/></section>
    <p className="text-xs text-zinc-500">These totals cover the receipts shown. Use Reports for complete totals over a date range.</p>
    <form onSubmit={event=>{event.preventDefault();void load(false,query.trim());}} className="flex flex-wrap gap-2"><label className="relative block min-w-0 flex-1"><span className="sr-only">Search receipt or operator</span><Search size={16} className="absolute left-3 top-3.5 text-zinc-500"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search receipt or operator" className="min-h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-10 pr-3 text-white"/></label><button type="submit" disabled={loading} className="min-h-11 rounded-xl border border-zinc-700 px-4 text-sm">Search all receipts</button></form>
    {loading&&<p role="status" className="text-sm text-zinc-400">{orders.length?'Refreshing receipts… Earlier results remain visible.':'Loading sales…'}</p>}
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">{!loading&&search.length===0?<p className="p-8 text-center text-sm text-zinc-400">No receipts match this search.</p>:<div className="divide-y divide-zinc-800">{search.map(order=><article key={order.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Receipt {order.orderNumber}</h2><p className="mt-1 text-xs text-zinc-500">{new Date(order.timestamp).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:session.outlet.timeZone??session.tenant.timeZone})} · {order.cashierName}</p><p className="mt-1 text-xs text-cyan-300">{order.paymentMethod==='manual_mpesa'?'M-Pesa · confirmed by cashier':order.paymentMethod==='customer_credit'?`Customer account · ${order.customerName??''}`:'Cash'}</p>{order.payments?.filter(payment=>payment.reference).map((payment,index)=><p key={index} className="mt-1 text-xs text-zinc-400">Transaction reference: {payment.reference}</p>)}<p className="mt-2 text-sm text-zinc-300">{order.lines.map(line=>`${line.name} × ${formatDecimalQuantity(line.quantity)}`).join(' · ')}</p>{BigInt(order.discountMinor??'0')>0n&&<p className="mt-1 text-xs text-emerald-300">Item discounts {formatMinorMoneyText(order.discountMinor!,currency)}</p>}</div><div className="text-right"><p className="font-mono font-semibold">{formatMinorMoneyText(BigInt(order.totalMinor),order.currency)}</p>{order.amountDueMinor>0&&<p className="mt-1 text-xs text-amber-300">Customer balance {formatMinorMoneyText(BigInt(order.amountDueMinor),order.currency)}</p>}{order.refundedMinor>0&&<p className="mt-1 text-xs text-rose-300">Refunded {formatMinorMoneyText(BigInt(order.refundedMinor),order.currency)}</p>}<span className="mt-1 inline-block rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{order.status.replaceAll('_',' ')}</span></div></div><div className="mt-3 flex flex-wrap justify-end gap-2"><button onClick={()=>onReprintOrder(order.id)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-700 px-3 text-xs"><Printer size={14}/>Receipt preview</button>{canRefund&&order.status!=='refunded'&&(order.paymentMethod==='cash'?<><button disabled={busy||!!unknownId||!refundableWithCapabilities(order)} onClick={()=>beginRefund(order)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-rose-950/70 px-3 text-xs text-rose-200"><RotateCcw size={14}/>Refund remaining items</button>{!refundableWithCapabilities(order)&&<span className="self-center text-xs text-amber-200">Enable inventory to refund remaining stocked goods.</span>}</>:<span className="self-center text-xs text-zinc-500">{order.paymentMethod==='manual_mpesa'?'M-Pesa refunds are not available here.':'Account-charge refunds are not available here.'}</span>)}</div></article>)}</div>}</section>
    {nextAfter&&<button type="button" disabled={loading} onClick={()=>void load(true)} className="min-h-11 rounded-xl border border-zinc-700 px-4">Load more receipts</button>}
    {target&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3"><section role="dialog" aria-modal="true" aria-labelledby="refund-title" className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-5"><header><p className="text-xs uppercase tracking-widest text-rose-300">Cash refund · {target.orderNumber}</p><h2 id="refund-title" className="mt-1 text-xl font-bold">Review returned quantities</h2><p className="mt-1 text-sm text-zinc-400">Refunds use the price paid after item discounts, with the original tax. Refund only the reviewed quantities. Services have no stock return.</p></header><div className="mt-4 space-y-2">{target.lines.map(line=>{const remaining=subtractDecimalStrings(line.quantity,line.refundedQuantity);if(unknownId?!pendingLineIds.has(line.lineId):remaining==='0')return null;return <div key={line.lineId} role="group" aria-label={'Refund '+line.name} className="grid grid-cols-[1fr_95px] items-center gap-3 rounded-xl border border-zinc-800 p-3 sm:grid-cols-[1fr_130px_145px]"><div><p className="font-medium">{line.name}</p><p className="text-xs text-zinc-500">Remaining {formatDecimalQuantity(remaining)} · original price {formatMinorMoneyText(line.unitPriceMinor,target.currency)} / unit</p>{BigInt(line.discountMinor??'0')>0n&&<p className="text-xs text-emerald-300">Original line discount {formatMinorMoneyText(line.discountMinor!,target.currency)} · {line.discountReason}</p>}</div><label className="text-xs text-zinc-400">Qty<input disabled={busy||!!unknownId||(isStockTracked(line)&&!inventoryEnabled)} inputMode="decimal" value={lines[line.lineId]?.quantity??''} onChange={event=>setLines(previous=>({...previous,[line.lineId]:{...previous[line.lineId],quantity:event.target.value}}))} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-white"/></label><label className="col-span-2 flex min-h-11 items-center gap-2 text-xs text-zinc-300 sm:col-span-1"><input type="checkbox" disabled={busy||!!unknownId||!isStockTracked(line)||!session.tenant.capabilities.includes('inventory')} checked={isStockTracked(line)&&(!!unknownId||inventoryEnabled)&&(lines[line.lineId]?.restock??true)} onChange={event=>setLines(previous=>({...previous,[line.lineId]:{...previous[line.lineId],restock:event.target.checked}}))}/>{catalogItemKind(line)==='SERVICE'?'Service refund: no stock return':catalogItemKind(line)==='PREPARED'?'Prepared item refund: no stock return':!inventoryEnabled?unknownId&&lines[line.lineId]?.restock?'Original request: return to stock. Inventory is disabled.':'Inventory required to refund this stocked good':'Return to stock'}</label></div>;})}</div><label className="mt-4 block text-sm text-zinc-300">Reason<select disabled={busy||!!unknownId} value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"><option>Customer returned undamaged merchandise</option><option>Damaged or defective goods detected</option><option>Incorrect ring-up / Cashier error</option><option>Customer change of mind before departure</option></select></label>{notice&&<p role="status" className="mt-3 text-sm text-amber-300">{notice}</p>}<div className="mt-5 flex flex-wrap justify-end gap-2"><button disabled={busy||!!unknownId} onClick={()=>setTarget(null)} className="min-h-11 rounded-xl border border-zinc-700 px-4">Cancel</button>{unknownId?<button disabled={busy} onClick={()=>void checkStatus()} className="min-h-11 rounded-xl border border-amber-600 px-4">Check status</button>:<button disabled={busy} onClick={()=>void submitRefund()} className="min-h-11 rounded-xl bg-rose-600 px-4 font-semibold">{busy?'Submitting…':'Confirm cash refund'}</button>}</div></section></div>}
  </main>;
}
function Metric({label,value}:{label:string;value:string}){return <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p></div>;}
