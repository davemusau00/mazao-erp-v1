import React, { useEffect, useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendInventoryCountLine } from '../../services/apiClient';
import type { CountReview, CountReviewLine } from '../../types/countRecovery';
import { formatDecimalQuantity, formatMinorMoneyText } from '../../utils/money';
import { sourceLabel } from '../../utils/presentation';
import { ResponsiveDialog } from '../common/ResponsiveDialog';

const reasonLabels: Record<string, string> = {
  BALANCE_CHANGED: 'The recorded stock version changed.',
  BALANCE_VERSION_CHANGED: 'The recorded stock version changed.',
  MOVEMENTS_CHANGED: 'New physical stock movements were recorded.',
  QUANTITY_CHANGED: 'The recorded quantity changed.',
  VALUE_CHANGED: 'The carrying value changed.',
  INVENTORY_VALUE_CHANGED: 'The carrying value changed.',
  REFERENCE_COST_CHANGED: 'The reference cost changed.',
  LEGACY_CHECKPOINT: 'The original movement boundary is unavailable. Establish a reviewed baseline and recount.',
  LEGACY_BASELINE: 'The original movement boundary is unavailable. Establish a reviewed baseline and recount.',
  NEW_PRODUCT: 'This stocked item was not in the earlier count.',
  NEW_ITEM: 'This stocked item was not in the earlier count.',
  MISSING_BALANCE: 'This stocked item has no current stock balance. Ask an administrator to review its evidence.',
  BALANCE_MISSING: 'This stocked item has no current stock balance. Ask an administrator to review its evidence.',
  PRODUCT_INACTIVE: 'This item is no longer active. Review its count evidence before continuing.',
  ITEM_INACTIVE: 'This item is no longer active. Review its count evidence before continuing.',
  ITEM_KIND_CHANGED: 'This item no longer has the same physical stock classification.',
  COUNT_NOT_OPEN: 'This count is already posted or cancelled. Its evidence remains available in history.',
  COUNT_CAPACITY_EXCEEDED: 'This full count exceeds the supported review capacity. Ask an administrator to review the count scope.',
  INELIGIBLE_ITEMS: 'Some items are inactive, have changed classification or lack stock evidence. Review those items before continuing.',
  NO_CHANGED_ITEMS: 'No items need a new baseline.',
};
const changeLabel = (reason: string) => reasonLabels[reason] ?? 'The item or recorded stock needs review.';
const quantity = (value: string | null) => value === null ? 'Not recorded' : formatDecimalQuantity(value);

interface Props {
  countId: string;
  countVersion: number | null;
  localLines: BackendInventoryCountLine[];
  currency: string;
  timeZone: string;
  dirty: boolean;
  busy: boolean;
  canApprove: boolean;
  canCount: boolean;
  canReadCost: boolean;
  pendingCommand: BackendCommand | null;
  refreshKey: number;
  notice: string;
  onClose: () => void;
  onSave: () => Promise<number | null>;
  onReview: (review: CountReview, reason: string) => Promise<void>;
  onCheckStatus: () => void;
  onReplaceDraft: () => Promise<void>;
}

export function CountChangesReviewDialog({countId,countVersion,localLines,currency,timeZone,dirty,busy,canApprove,canCount,canReadCost,pendingCommand,refreshKey,notice,onClose,onSave,onReview,onCheckStatus,onReplaceDraft}: Props) {
  const [review,setReview]=useState<CountReview|null>(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [reason,setReason]=useState(''),[acknowledged,setAcknowledged]=useState(false);
  const [movementBusy,setMovementBusy]=useState<Record<string,boolean>>({});
  const [movementError,setMovementError]=useState<Record<string,string>>({});
  const controller=useRef<AbortController|null>(null),movementControllers=useRef(new Map<string,AbortController>());
  const pending=!!pendingCommand;
  const originalIds=pendingCommand?.payload.affectedProductIds;
  const originalProducts=Array.isArray(originalIds)?originalIds.filter((id):id is string=>typeof id==='string'):[];
  const originalReason=typeof pendingCommand?.payload.reason==='string'?pendingCommand.payload.reason:'';
  const versionMismatch=!!review&&countVersion!==review.countVersion;
  const load=async()=>{
    if(pending)return;
    controller.current?.abort();
    for(const read of movementControllers.current.values())read.abort();
    movementControllers.current.clear();
    const current=new AbortController();controller.current=current;
    setLoading(true);setError('');setMovementBusy({});setMovementError({});setAcknowledged(false);
    try{const result=await apiClient.getInventoryCountReview(countId,current.signal);if(!current.signal.aborted)setReview(result.review);}
    catch(cause){if(!current.signal.aborted)setError(cause instanceof Error?cause.message:'The changed-item review could not be loaded. Retry the review.');}
    finally{if(!current.signal.aborted)setLoading(false);}
  };
  useEffect(()=>{void load();return()=>{controller.current?.abort();for(const read of movementControllers.current.values())read.abort();};},[countId,countVersion,pending,refreshKey]);
  const loadMovements=async(line:CountReviewLine)=>{
    const cursor=line.movementPage.nextCursor;if(!cursor||pending)return;
    movementControllers.current.get(line.productId)?.abort();const current=new AbortController();movementControllers.current.set(line.productId,current);
    setMovementBusy(previous=>({...previous,[line.productId]:true}));setMovementError(previous=>({...previous,[line.productId]:''}));
    try{
      const result=await apiClient.getInventoryCountReviewMovements(countId,cursor,current.signal);
      if(current.signal.aborted)return;
      const page=result.page;
      if(result.productId!==line.productId||page.lowerExclusive!==line.movementPage.lowerExclusive||page.upperInclusive!==line.movementPage.upperInclusive||page.coverage!==line.movementPage.coverage
        ||page.totalCount!==line.movementPage.totalCount||page.limit!==line.movementPage.limit||page.nextCursor===cursor
        ||result.movements.some(item=>BigInt(item.sequence)<=BigInt(page.lowerExclusive)||BigInt(item.sequence)>BigInt(page.upperInclusive)||line.movements.some(old=>old.id===item.id)))throw new Error('These movements do not match the open review. Refresh the review before continuing.');
      setReview(previous=>previous?{...previous,changedLines:previous.changedLines.map(item=>item.productId===line.productId?{...item,movements:[...item.movements,...result.movements.filter(movement=>!item.movements.some(old=>old.id===movement.id))],movementPage:page}:item)}:previous);
    }catch(cause){if(!current.signal.aborted)setMovementError(previous=>({...previous,[line.productId]:cause instanceof Error?cause.message:'This movement page could not be loaded. Retry it.'}));}
    finally{if(!current.signal.aborted)setMovementBusy(previous=>({...previous,[line.productId]:false}));}
  };
  const locked=busy||pending;
  const invalidReason=/[\u0000-\u001f\u007f]/.test(reason.trim());
  const canSubmit=!!review&&review.canReview&&canApprove&&!dirty&&!versionMismatch&&!loading&&!error&&!Object.values(movementError).some(Boolean)&&!locked&&acknowledged&&reason.trim().length>0&&!invalidReason;
  const close=()=>{if(!locked)onClose();};
  return <ResponsiveDialog isOpen onClose={close} closeDisabled={locked} title={pending?'Check count review status':'Review changed count items'} subtitle="Earlier counts remain in history. A new baseline requires a physical recount." icon={<ClipboardCheck className="h-5 w-5 text-blue-300"/>} maxWidth="2xl" footerActions={<div className="flex w-full flex-wrap justify-end gap-2"><button type="button" disabled={locked} onClick={close} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-zinc-200">Return to count</button>{pending?<button type="button" disabled={busy} onClick={onCheckStatus} className="min-h-11 rounded-lg border border-amber-600 px-4 font-semibold text-amber-100">Check review status</button>:<button type="button" disabled={!canSubmit} onClick={()=>review&&void onReview(review,reason.trim())} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">{busy?'Reviewing…':'Accept baseline and require recount'}</button>}</div>}>
    {pending&&<section className="space-y-2 rounded-xl border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-100"><p>The original review has not been confirmed. Its items and reason remain locked while status is checked.</p><p>Original items: {originalProducts.map(id=>localLines.find(line=>line.productId===id)?.name??id).join(', ')||'Retained in the original request'}</p><p>Original review reason: {originalReason}</p></section>}
    {notice&&<p role="status" className="rounded-lg border border-zinc-700 p-3 text-sm text-amber-200">{notice}</p>}
    {!pending&&<div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-zinc-300">Compare saved evidence with current stock before clearing any affected physical count.</p><button type="button" disabled={busy||loading} onClick={()=>void load()} className="min-h-11 rounded-lg border border-zinc-700 px-3">Refresh changed items</button></div>}
    {loading&&<p role="status" className="text-sm text-zinc-400">Loading changed items and movement evidence…</p>}
    {error&&<div role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{error}<button type="button" disabled={locked||loading} onClick={()=>void load()} className="ml-2 min-h-11 underline">Retry changed-item review</button></div>}
    {dirty&&!pending&&<section className="space-y-2 rounded-xl border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-100"><p>Your unsent quantities and reasons are still in the count. Save them before accepting a new baseline so their earlier evidence survives the review.</p>{canCount&&<button type="button" disabled={locked||versionMismatch} onClick={()=>void onSave()} className="min-h-11 rounded-lg border border-amber-700 px-3 font-semibold">Save edits and refresh review</button>}</section>}
    {versionMismatch&&!pending&&<section role="alert" className="space-y-2 rounded-xl border border-amber-800 p-3 text-sm text-amber-100"><p>The saved draft changed elsewhere. Your local entries have been retained. Review the current saved draft before another change.</p><button type="button" disabled={locked} onClick={()=>void onReplaceDraft()} className="min-h-11 rounded-lg border border-amber-700 px-3">Replace local entries with current saved draft</button></section>}
    {review&&<>
      {review.coverage==='LEGACY_CHECKPOINT'&&<p className="rounded-lg border border-amber-800 p-3 text-sm text-amber-100">Legacy checkpoint: the original movement boundary is unavailable. The history shown is complete historical evidence, not a reconstructed list of changes since opening. A new reviewed baseline requires recounting.</p>}
      {review.blockers.some(blocker=>blocker!=='NO_CHANGED_ITEMS')&&<div role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200"><p>A new baseline cannot be accepted yet.</p><ul className="mt-2 list-disc pl-5">{review.blockers.filter(blocker=>blocker!=='NO_CHANGED_ITEMS').map((blocker,index)=><li key={index}>{changeLabel(blocker)}</li>)}</ul></div>}
      {!loading&&!error&&review.changedLines.length===0&&<p className="rounded-lg border border-emerald-900 p-3 text-sm text-emerald-200">No count-relevant stock changes were found. Existing saved quantities remain available for normal review and posting.</p>}
      <p className="text-xs text-zinc-400">{review.changedLines.length} affected items · {review.unchangedLineCount} unchanged saved lines will stay in the count.</p>
      <div className="space-y-3">{review.changedLines.map(line=>{
        const local=localLines.find(item=>item.productId===line.productId);
        const hasUnsent=dirty&&local&&(local.countedQuantity!==line.previous.countedQuantity||local.varianceReason!==line.previous.varianceReason);
        return <section key={line.productId} role="group" aria-label={'Changed item '+line.name} className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/50 p-3 sm:p-4">
          <div><h4 className="font-semibold text-zinc-100">{line.name}</h4><p className="text-xs text-zinc-500">{line.sku} · {line.unit}</p>{line.changeReasons.map((reason,index)=><p key={index} className="mt-1 text-xs text-amber-200">{changeLabel(reason)}</p>)}</div>
          <div className="grid gap-2 text-sm sm:grid-cols-2"><div className="rounded-lg border border-zinc-800 p-3"><p className="text-xs text-zinc-500">Previous baseline</p><p>{quantity(line.previous.expectedQuantity)} {line.unit}</p><p className="mt-2 text-xs text-zinc-500">Earlier saved physical count</p><p>{quantity(line.previous.countedQuantity)} {line.unit}</p><p className="mt-1 text-xs text-zinc-400">Earlier reason: {line.previous.varianceReason||'No reason recorded'}</p>{hasUnsent&&<p className="mt-2 text-xs text-amber-200">Unsent entry still in your count: {quantity(local.countedQuantity)} {line.unit} · {local.varianceReason||'No reason entered'}</p>}</div><div className="rounded-lg border border-zinc-800 p-3"><p className="text-xs text-zinc-500">Current recorded stock</p><p>{quantity(line.current.quantity)} {line.unit}</p>{canReadCost&&line.current.inventoryValueMinor!==undefined&&<p className="mt-2 text-xs text-zinc-400">Carrying value: {formatMinorMoneyText(line.current.inventoryValueMinor,currency)}</p>}{canReadCost&&line.current.referenceCostMinor!==undefined&&<p className="mt-1 text-xs text-zinc-400">Reference cost: {formatMinorMoneyText(line.current.referenceCostMinor,currency)} per {line.unit}</p>}{canReadCost&&line.previous.inventoryValueMinor!==undefined&&<p className="mt-1 text-xs text-zinc-500">Previous carrying value: {formatMinorMoneyText(line.previous.inventoryValueMinor,currency)}</p>}{canReadCost&&line.previous.referenceCostMinor!==undefined&&<p className="mt-1 text-xs text-zinc-500">Previous reference cost: {formatMinorMoneyText(line.previous.referenceCostMinor,currency)} per {line.unit}</p>}</div></div>
          <div className="space-y-2"><p className="text-xs text-zinc-400">{line.movementPage.coverage==='FULL_LEGACY_HISTORY'?'Full historical movements; original boundary unknown':'Movements after this line’s baseline'} · {line.movements.length} of {line.movementPage.totalCount} shown</p>{line.movements.length?<ul className="space-y-2">{line.movements.map(movement=><li key={movement.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-zinc-800 p-2 text-xs"><span><strong>{sourceLabel(movement.type)}</strong><span className="ml-2 text-zinc-400">{new Date(movement.timestamp).toLocaleString(undefined,{dateStyle:'short',timeStyle:'short',timeZone})}</span>{movement.documentReference&&<span className="mt-1 block break-words text-zinc-400">{movement.documentReference}</span>}</span><span className="font-mono text-zinc-200">{movement.quantity.startsWith('-')?'':'+'}{formatDecimalQuantity(movement.quantity)} {line.unit}{canReadCost&&movement.valueMinor!==undefined&&<small className="ml-2 text-zinc-500">{formatMinorMoneyText(movement.valueMinor,currency)}</small>}</span></li>)}</ul>:<p className="text-xs text-zinc-500">No recorded movements are present in this review range. Review the changed baseline fields.</p>}{movementError[line.productId]&&<p role="alert" className="text-xs text-rose-300">{movementError[line.productId]}</p>}{line.movementPage.hasMore&&<button type="button" disabled={locked||movementBusy[line.productId]} onClick={()=>void loadMovements(line)} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-xs">{movementBusy[line.productId]?'Loading movements…':movementError[line.productId]?'Retry item movements':'Load more item movements'}</button>}</div>
        </section>;
      })}</div>
    </>}
    {!pending&&review&&review.changedLines.length>0&&<section className="space-y-3 border-t border-zinc-700 pt-4"><label className="block text-sm text-zinc-300">Manager review reason<input maxLength={500} value={reason} disabled={locked} onChange={event=>setReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white"/></label>{invalidReason&&<p role="alert" className="text-xs text-rose-300">Use one line of text for the review reason.</p>}<label className="flex min-h-11 items-start gap-3 text-sm text-zinc-300"><input type="checkbox" className="mt-1" disabled={locked} checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/><span>Keep earlier counts in history, clear only affected physical counts and require these items to be counted again. Unchanged saved lines stay available.</span></label>{!canApprove&&<p className="text-sm text-amber-200">A manager must accept the new baseline before these items are recounted.</p>}</section>}
  </ResponsiveDialog>;
}
