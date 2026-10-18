import { useEffect, useRef, useState } from 'react';
import { CircleAlert, PackageCheck, Plus, RefreshCw, Truck } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendProduct } from '../../services/apiClient';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { formatDecimalQuantity, currencyMinorDigits, formatMinorMoneyText, moneyInputToMinor } from '../../utils/money';
import { useCommandRecoveryReadiness } from '../../hooks/useCommandRecoveryReadiness';
import { CommandRecoveryReadiness } from '../common/CommandRecoveryReadiness';

type ProcurementTab = 'orders' | 'receive' | 'suppliers' | 'payables';
interface DeliveryLine { productId: string; quantity: string; unitCost: string }
function validQuantity(value: string) { return /^\d+(?:\.\d{1,6})?$/.test(value) && BigInt(value.replace('.', '').replace(/^0+/, '') || '0') > 0n; }
function extendedCost(line: DeliveryLine, currency: string): bigint {
  const [whole, fraction = ''] = line.quantity.split('.');
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return (BigInt(moneyInputToMinor(line.unitCost, currency)) * micros + 500_000n) / 1_000_000n;
}
function minorInput(minor: number, currency: string) {
  const digits = currencyMinorDigits(currency), scale = 10n ** BigInt(digits), amount = BigInt(minor);
  return `${amount / scale}${digits ? `.${(amount % scale).toString().padStart(digits, '0')}` : ''}`;
}

/** The purchasing workspace exposes authoritative receiving until supplier/PO services exist. */
export function ProcurementWorkspace({ initialTab = 'receive', onInitialTabConsumed }: { initialTab?: ProcurementTab; onInitialTabConsumed?: () => void }) {
  const session = apiClient.getSession()!;
  const currency = session.tenant.currency;
  const [products, setProducts] = useState<BackendProduct[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<DeliveryLine[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [unknownId, setUnknownId] = useState('');
  const pending = useRef<BackendCommand | null>(null);
  const recovery = useCommandRecoveryReadiness('inventory.receive', command => {
    pending.current = command; setUnknownId(command.commandId);
    const payloadLines = command.payload.lines as Array<{ productId: string; quantity: string; unitCostMinor: number }>;
    setLines(payloadLines.map(line => ({ productId: line.productId, quantity: line.quantity, unitCost: minorInput(line.unitCostMinor, currency) })));
    setSupplierName(String(command.payload.supplierName ?? '')); setReference(String(command.payload.documentReference ?? ''));
    setReviewOpen(true); setNotice('A stock delivery needs review. Check its status before changing the delivery.');
  });
  const locked = busy || !!unknownId || !recovery.ready;
  const refresh = async () => {
    setLoading(true); setError('');
    try { setProducts((await apiClient.listCatalog()).items); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The outlet catalog could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [session.tenant.id, session.outlet.id, session.deviceId]);
  useEffect(() => { if (initialTab !== 'orders') onInitialTabConsumed?.(); }, [initialTab, onInitialTabConsumed]);
  const productById = new Map(products.map(product => [product.id, product]));
  const addLine = () => {
    if (locked || loading || error) return;
    try {
      if (!productById.has(productId)) throw new Error('Choose an outlet item.');
      if (lines.some(line => line.productId === productId)) throw new Error('This item is already in the delivery. Remove its existing line to enter the corrected total quantity and unit cost.');
      if (!validQuantity(quantity)) throw new Error('Enter a positive quantity with up to six decimals.');
      moneyInputToMinor(unitCost, currency);
      setLines(previous => [...previous, { productId, quantity, unitCost }]); setProductId(''); setQuantity('1'); setUnitCost(''); setNotice('');
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Delivery line is invalid.'); }
  };
  const receiptTotal = lines.reduce((sum, line) => sum + extendedCost(line, currency), 0n);
  const acknowledge = async (outcome: { status?: string; value?: Record<string, unknown>; message?: string }, command: BackendCommand) => {
    if (outcome.status === 'CONFIRMED') {
      pending.current = null; setUnknownId(''); setLines([]); setReference(''); setSupplierName(''); setReviewOpen(false);
      setNotice(`Receipt confirmed: ${String(outcome.value?.lineCount ?? lines.length)} lines, ${formatMinorMoneyText(BigInt(String(outcome.value?.totalMinor ?? 0)), currency)} accrued.`); await refresh();
    } else if (outcome.status === 'REJECTED' || outcome.status === 'CONFLICT') {
      pending.current = null; setUnknownId(''); setNotice(outcome.message ?? `Receipt ${outcome.status.toLowerCase()}. Review the delivery.`);
    } else { setUnknownId(command.commandId); setNotice('We could not confirm this delivery. Check its status before trying again.'); }
    if (['CONFIRMED', 'REJECTED', 'CONFLICT'].includes(outcome.status ?? '')) await recovery.inspect();
  };
  const post = async () => {
    if (locked || pending.current || !lines.length || loading || error) return;
    const command: BackendCommand = { protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId, type: 'inventory.receive', occurredAt: new Date().toISOString(), expectedVersions: {}, payload: { lines: lines.map(line => ({ productId: line.productId, quantity: line.quantity, unitCostMinor: moneyInputToMinor(line.unitCost, currency) })), supplierName: supplierName.trim(), documentReference: reference.trim() } };
    if (!recovery.begin()) return;
    pending.current = command; setBusy(true); setNotice('');
    try { await acknowledge(await apiClient.submitCommand(command), command); }
    catch (failure) { setUnknownId(command.commandId); setNotice(failure instanceof Error ? failure.message : 'Receipt outcome is unknown.'); }
    finally { recovery.finish(); setBusy(false); }
  };
  const recover = async () => {
    const command = pending.current;
    if (!command || !recovery.begin()) return;
    setBusy(true);
    try {
      try { const status = await apiClient.checkCommandStatus(command.commandId); await acknowledge(status.response, command); }
      catch (failure) { if ((failure as { status?: number }).status !== 404) throw failure; await acknowledge(await apiClient.submitCommand(command), command); }
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Receipt status could not be checked.'); }
    finally { recovery.finish(); setBusy(false); }
  };
  const lineList = <div className="space-y-3">{lines.length ? lines.map((line, index) => <article key={`${line.productId}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 p-3"><div><strong className="text-sm">{productById.get(line.productId)?.name ?? `Item ${line.productId}`}</strong><p className="mt-1 text-xs text-zinc-400">{formatDecimalQuantity(line.quantity)} {productById.get(line.productId)?.unit} × {line.unitCost} {currency} per unit</p></div><span className="font-mono text-sm">{formatMinorMoneyText(extendedCost(line, currency), currency)}</span><button type="button" disabled={locked} onClick={() => setLines(previous => previous.filter((_, position) => position !== index))} className="min-h-11 px-3 text-xs text-zinc-400">Remove</button></article>) : <p className="py-8 text-center text-zinc-500">Choose items and quantities from the delivery paperwork.</p>}</div>;
  return <main className="page-stack">
    <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} />
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-blue-300">Purchasing · {session.outlet.name}</p><h1 className="mt-1 text-3xl font-bold">Receive a delivery</h1><p className="mt-2 text-sm text-zinc-400">Review received quantities and costs before adding this delivery to stock.</p></div><button type="button" disabled={loading || locked} onClick={() => void refresh()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm"><RefreshCw size={16} />Refresh</button></header>
    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-800 p-3 text-sm text-rose-200"><CircleAlert size={16} />{error}</div>}
    {notice && <div role={unknownId ? 'alert' : 'status'} className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-800 p-3 text-sm text-blue-200"><PackageCheck size={16} /><span>{notice}</span>{unknownId && <button type="button" disabled={busy} onClick={() => void recover()} className="min-h-11 underline">Check receipt status</button>}</div>}
    <section className="workflow-panel"><div className="panel-heading"><div><h2>Delivery paperwork</h2><p>{currency} · quantities in the item's base unit</p></div><Truck size={19} /></div>
      <fieldset disabled={locked || loading || !!error} className="space-y-4"><div className="form-grid"><label className="form-field"><span>Supplier name (receipt record)</span><input maxLength={160} value={supplierName} onChange={event => setSupplierName(event.target.value)} placeholder="Supplier shown on delivery" /></label><label className="form-field"><span>Delivery reference</span><input maxLength={120} value={reference} onChange={event => setReference(event.target.value)} placeholder="Delivery note or invoice reference" /></label></div><div className="line-entry-grid"><label className="form-field"><span id="receiving-item-label">Item</span><select aria-labelledby="receiving-item-label" value={productId} onChange={event => setProductId(event.target.value)}><option value="">{loading ? 'Loading catalog…' : 'Choose item'}</option>{products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.unit}</option>)}</select></label><label className="form-field"><span>Quantity</span><input inputMode="decimal" value={quantity} onChange={event => setQuantity(event.target.value)} /></label><label className="form-field"><span>Cost per base unit ({currency})</span><input inputMode="decimal" value={unitCost} onChange={event => setUnitCost(event.target.value)} placeholder="0.00" /></label><button type="button" onClick={addLine} className="secondary-action"><Plus size={16} />Add item</button></div></fieldset>
      {lineList}<div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-zinc-300">{lines.length} delivery {lines.length === 1 ? 'line' : 'lines'} · {formatMinorMoneyText(receiptTotal, currency)}</p><button type="button" disabled={!lines.length || locked || loading || !!error} onClick={() => setReviewOpen(true)} className="primary-action">Review delivery</button></div>
    </section>
    <ResponsiveDialog isOpen={reviewOpen} onClose={() => { if (!locked) setReviewOpen(false); }} title="Review delivery receipt" subtitle={`${currency} · ${session.outlet.name}`} footerActions={<><button type="button" disabled={locked} onClick={() => setReviewOpen(false)} className="quiet-action">Return to delivery</button><button type="button" disabled={locked || !lines.length || !!error} onClick={() => void post()} className="primary-action">{busy ? 'Posting receipt…' : 'Post reviewed receipt'}</button></>}>
      <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} /><p className="text-sm text-zinc-300">{supplierName || 'Supplier not named'} · {reference || 'No reference supplied'}</p>{lineList}<p className="font-semibold">Receipt cost {formatMinorMoneyText(receiptTotal, currency)}</p><p className="text-xs leading-5 text-zinc-400">Confirmation records the stock quantity and value together. The supplier name is kept with this delivery.</p>{notice && <p role={unknownId ? 'alert' : 'status'} className="text-amber-200">{notice}{unknownId && <button type="button" disabled={busy} onClick={() => void recover()} className="ml-3 min-h-11 underline">Check receipt status</button>}</p>}
    </ResponsiveDialog>
  </main>;
}
