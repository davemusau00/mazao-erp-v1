import React, { useEffect, useRef, useState } from 'react';
import { Banknote, Barcode, Minus, Plus, RefreshCw, Search, ShoppingCart, Smartphone, Trash2, Users } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendCustomerAccount, type BackendProduct, type BackendShift, type BackendStockSalePolicy } from '../../services/apiClient';
import { moneyInputToMinor, minorToMoneyInput, formatMinorMoneyText } from '../../utils/money';
import { subtractDecimalStrings, sumDecimalStrings } from '../../utils/decimal';
import { formatDecimalQuantity } from '../../utils/presentation';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { HistoryNavigation } from '../common/HistoryNavigation';
import type { HistoryPage, HistoryOptions } from '../../types/history';

interface BasketLine { productId: string; quantity: string; discount: string; discountReason: string }
type StockExceptionReason='SUSPECTED_UNRECORDED_DELIVERY'|'SUSPECTED_OUTDATED_COUNT'|'UNKNOWN'|'';
interface StockExceptionAcknowledgement {reasonCode:StockExceptionReason;reasonNote:string;confirmedQuantity:string|null}
const quantityScale = 1_000_000n;
function quantityMicros(value: string): bigint | null {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * quantityScale + BigInt(fraction.padEnd(6, '0'));
}
function quantityTextFromMicros(value:bigint):string {const fraction=(value%quantityScale).toString().padStart(6,'0').replace(/0+$/,'');return fraction?`${value/quantityScale}.${fraction}`:(value/quantityScale).toString();}
function lineMinor(unitMinor: number, quantity: string): bigint {
  const micros = quantityMicros(quantity);
  return micros === null ? 0n : (BigInt(unitMinor) * micros + quantityScale / 2n) / quantityScale;
}
const actionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm disabled:opacity-50';
const unresolved = 'We couldn’t confirm whether this payment completed. Check its status before taking payment again.';

export function PointOfSaleView({ onOrderCompleted }: { onOrderCompleted: (orderId: string) => void }) {
  const session = apiClient.getSession()!;
  const currency = session.tenant.currency;
  const [products, setProducts] = useState<BackendProduct[]>([]);
  const [shift, setShift] = useState<BackendShift | null>(null);
  const [stockPolicy, setStockPolicy] = useState<BackendStockSalePolicy | null>(null);
  const [stockAcknowledgements, setStockAcknowledgements] = useState<Record<string,StockExceptionAcknowledgement>>({});
  const [customers, setCustomers] = useState<BackendCustomerAccount[]>([]);
  const [customerPage, setCustomerPage] = useState<HistoryPage>();
  const customerSearch = useRef('');
  const customerGeneration = useRef(0);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [customerError, setCustomerError] = useState('');
  const [customersBusy, setCustomersBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'manual_mpesa' | 'customer_credit'>('cash');
  const [tender, setTender] = useState('');
  const [mpesaReference, setMpesaReference] = useState('');
  const [mpesaConfirmed, setMpesaConfirmed] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [unknownId, setUnknownId] = useState('');
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const pending = useRef<BackendCommand | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const refreshController = useRef<AbortController | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const canChargeAccount = session.user.permissions.includes('customers.charge');
  const canDiscount = session.user.permissions.includes('commerce.discount');
  const locked = busy || !!unknownId;
  const discountFor = (line: BasketLine): bigint | null => {
    try { return line.discount.trim() ? BigInt(moneyInputToMinor(line.discount, currency)) : 0n; }
    catch { return null; }
  };
  const refresh = async () => {
    refreshController.current?.abort();
    const controller = new AbortController(); refreshController.current = controller;
    const current = () => mounted.current && refreshController.current === controller && !controller.signal.aborted;
    setLoading(true); setLoaded(false); setError(''); setStockAcknowledgements({});
    if (session.user.permissions.includes('customers.view')) {
      const customerRequest = ++customerGeneration.current;
      setCustomersBusy(true);
      void apiClient.listCustomerAccounts(controller.signal,{q:customerSearch.current}).then(result => {
        if (current()&&customerRequest===customerGeneration.current) { setCustomers(result.customers); setCustomerPage(result.page); setCustomerError(''); }
      }).catch(failure => {
        if (current()&&customerRequest===customerGeneration.current) setCustomerError(failure instanceof Error ? failure.message : 'Customer accounts could not be loaded.');
      }).finally(() => { if (current()&&customerRequest===customerGeneration.current) setCustomersBusy(false); });
    }
    try {
      const [catalog, currentShift, policy] = await Promise.all([apiClient.listCatalog(controller.signal), apiClient.getCurrentShift(controller.signal), apiClient.getStockSalePolicy(controller.signal)]);
      if (current()) { setProducts(catalog.items); setShift(currentShift.shift); setStockPolicy(policy.policy); setLoaded(true); }
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : 'The items and shift could not be loaded. Try again.');
    } finally { if (current()) setLoading(false); }
  };
  const loadRecovery = async () => {
    setRecoveryChecked(false); setRecoveryError('');
    try {
      const records = await apiClient.listRecoverableCommands(session.tenant.id);
      const record = records.find(entry => entry.command.type === 'sales.order.settle' && entry.command.deviceId === session.deviceId);
      if (!mounted.current) return;
      if (record) {
        pending.current = record.command; setUnknownId(record.command.commandId);
        const lines = record.command.payload.lines as Array<{productId:string;quantity:string;discountMinor?:number;discountReason?:string}>;
        if (!Array.isArray(lines)) throw new Error('Saved sale details need review. Open Actions needing review for help.');
        setBasket(lines.map(line => ({ productId: line.productId, quantity: line.quantity, discount: line.discountMinor ? minorToMoneyInput(line.discountMinor, currency) : '', discountReason: line.discountReason ?? '' })));
        const savedException=record.command.payload.stockException as {physicallyConfirmed?:boolean;lines?:Array<{productId:string;maxConfirmedShortfall:string;reasonCode:Exclude<StockExceptionReason,''>;reasonNote?:string|null}>}|undefined;
        if(savedException?.physicallyConfirmed&&Array.isArray(savedException.lines))setStockAcknowledgements(Object.fromEntries(savedException.lines.map(line=>[line.productId,{reasonCode:line.reasonCode,reasonNote:line.reasonNote??'',confirmedQuantity:line.maxConfirmedShortfall}])));
        const tenders = record.command.payload.tenders as Array<{method:string;amountMinor:number;reference?:string;manuallyConfirmed?:boolean}>;
        if (typeof record.command.payload.customerId === 'string') { setCustomerId(record.command.payload.customerId); setPaymentMethod('customer_credit'); }
        else if (tenders?.[0]?.method === 'MANUAL_MPESA') { setPaymentMethod('manual_mpesa'); setMpesaReference(tenders[0].reference ?? ''); setMpesaConfirmed(tenders[0].manuallyConfirmed === true); }
        else { setPaymentMethod('cash'); if (tenders?.[0]) setTender(minorToMoneyInput(tenders[0].amountMinor, currency)); }
        setNotice(unresolved);
      }
      setRecoveryChecked(true);
    } catch { if (mounted.current) setRecoveryError('Saved payments could not be checked on this device. Enable browser storage and try again, or ask your manager for help.'); }
  };
  useEffect(() => {
    mounted.current = true; void refresh(); void loadRecovery();
    return () => { mounted.current = false; refreshController.current?.abort(); ++customerGeneration.current; };
  }, [session.tenant.id, session.outlet.id, session.deviceId]);
  const loadCustomers = async (options: HistoryOptions, append = false) => {
    const generation = ++customerGeneration.current;
    setCustomersBusy(true); setCustomerError('');
    try {
      const result = await apiClient.listCustomerAccounts(undefined, options);
      if (!mounted.current || generation !== customerGeneration.current) return;
      customerSearch.current = options.q ?? '';
      setCustomerPage(result.page);
      setCustomers(current => append ? [...current,...result.customers.filter(row=>!current.some(item=>item.id===row.id))] : result.customers);
    } catch (failure) {
      if (mounted.current && generation === customerGeneration.current) setCustomerError(failure instanceof Error ? failure.message : 'Customer accounts could not be loaded.');
    } finally { if (mounted.current && generation === customerGeneration.current) setCustomersBusy(false); }
  };
  useEffect(()=>{
    if (customerQuery.trim() === customerSearch.current || !session.user.permissions.includes('customers.view')) return;
    const timeout=setTimeout(()=>{void loadCustomers({q:customerQuery.trim()});},300);
    return ()=>clearTimeout(timeout);
  },[customerQuery]);
  const productById = new Map(products.map(product => [product.id, product]));
  const validBasket = basket.length > 0 && basket.every(line => {
    const micros = quantityMicros(line.quantity), discount = discountFor(line);
    const product = productById.get(line.productId);
    return !!product && micros !== null && micros > 0n && discount !== null && discount <= lineMinor(product.sellingPriceMinor, line.quantity)
      && (discount === 0n || (canDiscount && !!line.discountReason.trim()));
  });
  const shortfallLines = basket.flatMap(line => {
    const product=productById.get(line.productId),requested=quantityMicros(line.quantity),recorded=product?quantityMicros(product.quantity):null;
    return !product||requested===null||recorded===null||requested<=recorded?[]:[{product,shortfall:requested-recorded}];
  });
  const stockExceptionsReady = shortfallLines.length===0 || (stockPolicy?.enabled===true && shortfallLines.every(({product,shortfall})=>{
    const ack=stockAcknowledgements[product.id];
    return !!ack?.reasonCode&&ack.confirmedQuantity===quantityTextFromMicros(shortfall)&&(ack.reasonCode!=='UNKNOWN'||ack.reasonNote.trim().length>=3);
  }));
  const originalSubtotalMinor = basket.reduce((sum, line) => sum + lineMinor(productById.get(line.productId)?.sellingPriceMinor ?? 0, line.quantity), 0n);
  const discountMinor = basket.reduce((sum, line) => sum + (discountFor(line) ?? 0n), 0n);
  const subtotalMinor = originalSubtotalMinor - discountMinor;
  const taxMinor = basket.reduce((sum, line) => {
    const product = productById.get(line.productId);
    const discounted = lineMinor(product?.sellingPriceMinor ?? 0, line.quantity) - (discountFor(line) ?? 0n);
    return sum + ((discounted > 0n ? discounted : 0n) * BigInt(product?.taxRateBps ?? 0) + 5_000n) / 10_000n;
  }, 0n);
  const totalMinor = subtotalMinor + taxMinor;
  let tenderMinor: bigint | null = null;
  try { tenderMinor = BigInt(moneyInputToMinor(tender, currency)); } catch { /* Validation is shown beside the input. */ }
  const selectedCustomer = customers.find(customer => customer.id === customerId);
  const availableCredit = selectedCustomer ? BigInt(selectedCustomer.creditLimitMinor) - BigInt(selectedCustomer.balanceMinor) : 0n;
  const creditAllowed = !customersBusy && !customerError && !!selectedCustomer && selectedCustomer.status === 'ACTIVE' && availableCredit >= totalMinor;
  const normalizedReference = mpesaReference.trim().toUpperCase();
  const validReference = /^[A-Z0-9][A-Z0-9-]{3,63}$/.test(normalizedReference);
  const readyToConfirm = loaded && recoveryChecked && !!shift && validBasket && stockExceptionsReady && totalMinor > 0n && totalMinor <= BigInt(Number.MAX_SAFE_INTEGER) && !locked && (
    paymentMethod === 'cash' ? tenderMinor !== null && tenderMinor >= totalMinor : paymentMethod === 'manual_mpesa' ? validReference && mpesaConfirmed : canChargeAccount && creditAllowed
  );
  const filteredProducts = products.filter(product => `${product.name} ${product.sku} ${product.barcode??''} ${product.category??''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const filteredCustomers = customers.filter(customer => `${customer.name} ${customer.phone} ${customer.email ?? ''}`.toLocaleLowerCase().includes(customerQuery.toLocaleLowerCase()));
  const addProduct = (product: BackendProduct) => {
    if (locked || !loaded) return;
    setBasket(previous => {
      const existing = previous.find(line => line.productId === product.id);
      return existing ? previous.map(line => line.productId === product.id ? { ...line, quantity: sumDecimalStrings([line.quantity, '1']) } : line) : [...previous, { productId: product.id, quantity: '1', discount: '', discountReason: '' }];
    });
    setStockAcknowledgements(previous=>({...previous,[product.id]:{...(previous[product.id]??{reasonCode:'',reasonNote:'',confirmedQuantity:null}),confirmedQuantity:null}}));
    if (quantityMicros(product.quantity) === 0n) setNotice(stockPolicy?.enabled ? `${product.name} has no recorded stock. Physically verify its availability before confirming a sale.` : `${product.name} has no stock available. Review stock before taking payment.`);
  };
  const scan = (event: React.FormEvent) => {
    event.preventDefault();
    const match = products.find(product => product.barcode === query.trim() || product.sku.toLocaleLowerCase() === query.trim().toLocaleLowerCase() || product.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase());
    if (match) { addProduct(match); setQuery(''); } else setNotice('No exact barcode, SKU or item name found. Choose a search result.');
    searchInput.current?.focus();
  };
  const editLine = (productId: string, patch: Partial<BasketLine>) => {
    if (!locked) { setBasket(previous => previous.map(line => line.productId === productId ? { ...line, ...patch } : line)); setStockAcknowledgements(previous=>({...previous,[productId]:{...(previous[productId]??{reasonCode:'SUSPECTED_OUTDATED_COUNT',reasonNote:'',confirmedQuantity:null}),confirmedQuantity:null}})); setMpesaConfirmed(false); }
  };
  const acknowledge = async (response: { status?: string; value?: Record<string, unknown>; message?: string }, command: BackendCommand) => {
    if (!mounted.current) return;
    if (response.status === 'CONFIRMED' && typeof response.value?.saleId === 'string') {
      pending.current = null; setUnknownId(''); setBasket([]); setStockAcknowledgements({}); setPaymentOpen(false); setMpesaConfirmed(false); setMpesaReference('');
      setNotice('Sale completed. Opening the receipt.'); onOrderCompleted(response.value.saleId); await refresh();
    } else if (response.status === 'REJECTED' || response.status === 'CONFLICT') {
      pending.current = null; setUnknownId(''); setMpesaConfirmed(false); setNotice(response.message ?? 'This sale was not completed. Review the basket before trying again.'); await refresh();
    } else { setUnknownId(command.commandId); setNotice(unresolved); }
  };
  const confirmSale = async () => {
    if (inFlight.current || !readyToConfirm || !shift) return;
    const command: BackendCommand = {
      protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId,
      type: 'sales.order.settle', occurredAt: new Date().toISOString(),
      expectedVersions: { [`shift:${shift.id}`]: shift.version, ...Object.fromEntries(basket.map(line => [`product:${line.productId}`, productById.get(line.productId)?.productVersion ?? 1])) },
      payload: { shiftId: shift.id, lines: basket.map(line => ({ productId: line.productId, quantity: line.quantity, ...(discountFor(line)! > 0n ? { discountMinor: Number(discountFor(line)), discountReason: line.discountReason.trim() } : {}) })),
        ...(paymentMethod === 'customer_credit' ? { customerId } : {}),
        ...(shortfallLines.length ? {stockException:{physicallyConfirmed:true,lines:shortfallLines.map(({product,shortfall})=>{const ack=stockAcknowledgements[product.id]!;return {productId:product.id,maxConfirmedShortfall:ack.confirmedQuantity!,reasonCode:ack.reasonCode,...(ack.reasonNote.trim()?{reasonNote:ack.reasonNote.trim()}:{})};})}} : {}),
        tenders: paymentMethod === 'cash' ? [{ method: 'CASH', amountMinor: Number(tenderMinor!), currency }] : paymentMethod === 'manual_mpesa' ? [{ method: 'MANUAL_MPESA', amountMinor: Number(totalMinor), currency, reference: normalizedReference, manuallyConfirmed: true }] : [] },
    };
    pending.current = command; inFlight.current = true; setBusy(true); setNotice('');
    try { await acknowledge(await apiClient.submitCommand(command), command); }
    catch (failure) {
      if (mounted.current) { if ((failure as {code?:string}).code === 'COMMAND_NOT_SENT') pending.current = null; else setUnknownId(command.commandId); setNotice(failure instanceof Error ? failure.message : unresolved); }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const recover = async () => {
    const command = pending.current; if (!command || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      try { const status = await apiClient.checkCommandStatus(command.commandId); await acknowledge(status.response, command); }
      catch (failure) {
        if ((failure as { status?: number }).status !== 404) throw failure;
        await acknowledge(await apiClient.submitCommand(command), command);
      }
    } catch (failure) { if (mounted.current) setNotice(failure instanceof Error ? failure.message : 'Payment status could not be checked. Try again.'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const selectMethod = (method: typeof paymentMethod) => { setPaymentMethod(method); setMpesaConfirmed(false); };
  return <main className="grid min-h-full gap-4 p-4 pb-24 text-zinc-100 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-6">
    <section className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-blue-300">Sell · {session.outlet.name}</p><h1 className="mt-1 text-2xl font-bold">Make a sale</h1><p className="mt-1 text-xs text-zinc-400">{currency} · Tax is added at each item’s configured rate</p></div><button type="button" className={actionClass} disabled={loading || locked} onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button></header>
      {error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">{error} Refresh before taking payment.</p>}
      {!recoveryChecked && <div role={recoveryError ? 'alert' : 'status'} className="rounded-xl border border-amber-800 p-3 text-sm text-amber-200">{recoveryError || 'Checking for payments that need review…'}{recoveryError && <button type="button" onClick={() => void loadRecovery()} className="ml-3 min-h-11 underline">Try again</button>}</div>}
      {notice && <div role={unknownId ? 'alert' : 'status'} className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-800 bg-blue-950/30 p-3 text-sm"><p className="flex-1">{notice}</p>{unknownId && <button type="button" disabled={busy} onClick={() => void recover()} className={actionClass}>Check payment status</button>}</div>}
      {!loading && loaded && !shift && <p className="rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">Open a shift in Shifts before taking payment.</p>}
      <form onSubmit={scan} className="relative"><Search className="absolute left-3 top-3.5 text-zinc-500" size={18} /><label className="sr-only" htmlFor="pos-search">Search items or scan SKU</label><input id="pos-search" ref={searchInput} disabled={locked || !loaded} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search items or scan SKU, then Enter" className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 pl-10 pr-12 text-sm" /><button type="submit" aria-label="Add scanned item" disabled={locked || !loaded || !query.trim()} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-blue-300"><Barcode size={19} /></button></form>
      {loading && <p role="status" className="py-3 text-sm text-zinc-400">{products.length ? 'Refreshing items and shift… Previously loaded items remain visible.' : 'Loading items and shift…'}</p>}
      {!loading && filteredProducts.length === 0 ? <div className="rounded-xl border border-zinc-800 p-8 text-center"><ShoppingCart className="mx-auto text-zinc-500" /><p className="mt-3 text-sm text-zinc-400">{products.length ? 'No items match this search.' : 'No items in this outlet. Create items and receive stock in Stock.'}</p></div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{filteredProducts.map(product => <button key={product.id} type="button" disabled={locked || !loaded} onClick={() => addProduct(product)} className="min-h-32 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-left disabled:opacity-50 hover:border-blue-600"><strong className="block text-sm">{product.name}</strong><span className="mt-1 block text-xs text-zinc-500">{product.sku}</span><span className="mt-3 block font-mono text-sm text-blue-300">{formatMinorMoneyText(BigInt(product.sellingPriceMinor), currency)}</span><span className="mt-1 block text-xs text-zinc-400">{formatDecimalQuantity(product.quantity)} {product.unit} on hand</span></button>)}</div>}
    </section>
    <section className="h-fit min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 lg:sticky lg:top-0" aria-label="Basket">
      <header className="flex items-center justify-between"><h2 className="text-lg font-semibold">Basket</h2><button type="button" disabled={locked || !basket.length} onClick={() => {setBasket([]);setStockAcknowledgements({});}} className="flex min-h-11 items-center gap-2 px-2 text-xs text-zinc-400"><Trash2 size={16} />Clear</button></header>
      {!basket.length ? <p className="py-12 text-center text-sm text-zinc-500">Choose items to start a sale.</p> : <div className="max-h-[42dvh] space-y-4 overflow-y-auto py-4">{basket.map(line => {
        const product = productById.get(line.productId), original = lineMinor(product?.sellingPriceMinor ?? 0, line.quantity), discount = discountFor(line);
        const invalidDiscount = discount === null || discount > original || (discount > 0n && !line.discountReason.trim());
        return <article key={line.productId} className="border-b border-zinc-800 pb-3"><div className="flex justify-between gap-2"><strong className="text-sm">{product?.name ?? 'Unavailable item'}</strong><button type="button" disabled={locked} aria-label={`Remove ${product?.name ?? 'item'}`} onClick={() => {setBasket(previous => previous.filter(entry => entry.productId !== line.productId));setStockAcknowledgements(previous=>{const next={...previous};delete next[line.productId];return next;});}} className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-400"><Trash2 size={15} /></button></div>
          <div className="flex items-center gap-2"><button type="button" disabled={locked || (quantityMicros(line.quantity) ?? 0n) <= quantityScale} onClick={() => editLine(line.productId, { quantity: subtractDecimalStrings(line.quantity, '1') })} aria-label={`Decrease ${product?.name ?? 'item'} quantity`} className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700"><Minus size={16} /></button><label className="min-w-0 flex-1"><span className="sr-only">Quantity for {product?.name ?? 'item'}</span><input disabled={locked} inputMode="decimal" value={line.quantity} onChange={event => editLine(line.productId, { quantity: event.target.value })} className="min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-center text-sm" /></label><button type="button" disabled={locked} onClick={() => editLine(line.productId, { quantity: sumDecimalStrings([line.quantity, '1']) })} aria-label={`Increase ${product?.name ?? 'item'} quantity`} className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700"><Plus size={16} /></button></div>
          {canDiscount && <details className="mt-2 text-xs text-zinc-300"><summary className="cursor-pointer py-2">Item discount{discount && discount > 0n ? ` · ${formatMinorMoneyText(discount, currency)}` : ''}</summary><label className="mt-2 block">Discount for these items ({currency})<input disabled={locked} inputMode="decimal" value={line.discount} onChange={event => editLine(line.productId, { discount: event.target.value })} aria-label={`Discount amount for ${product?.name ?? 'item'}`} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm" /></label><p className="mt-1 text-zinc-500">Applied once to all {formatDecimalQuantity(line.quantity)} items on this line. Maximum {formatMinorMoneyText(original, currency)} before tax.</p><label className="mt-2 block">Discount reason<input disabled={locked} value={line.discountReason} maxLength={240} onChange={event => editLine(line.productId, { discountReason: event.target.value })} aria-label={`Discount reason for ${product?.name ?? 'item'}`} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm" /></label></details>}
          <p className="mt-2 text-right font-mono text-sm">{discount && discount > 0n && <del className="mr-2 text-zinc-500">{formatMinorMoneyText(original, currency)}</del>}{formatMinorMoneyText(original - (discount ?? 0n), currency)}</p>
          {invalidDiscount && <p className="mt-1 text-xs text-rose-300">Enter a valid amount within the line value and give a reason for the discount.</p>}
          {(!product || !quantityMicros(line.quantity)) && <p className="text-xs text-rose-300">Enter a positive quantity with up to six decimal places for an available item.</p>}
        </article>;
      })}</div>}
      <dl className="space-y-2 border-t border-zinc-800 pt-4 text-sm"><div className="flex justify-between"><dt>Items before discounts</dt><dd className="font-mono">{formatMinorMoneyText(originalSubtotalMinor, currency)}</dd></div>{discountMinor > 0n && <div className="flex justify-between"><dt>Item discounts</dt><dd className="font-mono">−{formatMinorMoneyText(discountMinor, currency)}</dd></div>}<div className="flex justify-between"><dt>Subtotal</dt><dd className="font-mono">{formatMinorMoneyText(subtotalMinor, currency)}</dd></div><div className="flex justify-between"><dt>Tax by item</dt><dd className="font-mono">{formatMinorMoneyText(taxMinor, currency)}</dd></div><div className="flex justify-between pt-2 text-lg font-bold"><dt>Estimated total</dt><dd className="font-mono text-blue-300">{formatMinorMoneyText(totalMinor, currency)}</dd></div></dl>
      <button type="button" disabled={!loaded || !recoveryChecked || !shift || !validBasket || totalMinor <= 0n || locked} onClick={() => { setTender(minorToMoneyInput(totalMinor, currency)); setMpesaConfirmed(false); setPaymentOpen(true); }} className="mt-5 min-h-12 w-full rounded-xl bg-blue-600 px-3 font-semibold disabled:opacity-50">Take payment</button><p className="mt-3 text-xs leading-5 text-zinc-500">Review quantities and item discounts before taking payment. A connection is required to complete the sale.</p>
    </section>
    <ResponsiveDialog isOpen={paymentOpen} closeDisabled={locked} onClose={() => { if (!locked) {setPaymentOpen(false);setStockAcknowledgements(previous=>Object.fromEntries(Object.entries(previous).map(([id,ack])=>[id,{...ack,confirmedQuantity:null}])));} }} title="Take payment" subtitle={`${currency} · ${session.outlet.name}`} footerActions={<><button type="button" disabled={locked} onClick={() => {setPaymentOpen(false);setStockAcknowledgements(previous=>Object.fromEntries(Object.entries(previous).map(([id,ack])=>[id,{...ack,confirmedQuantity:null}])));}} className={actionClass}>Cancel</button><button type="button" disabled={!readyToConfirm} onClick={() => void confirmSale()} className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold disabled:opacity-50">{busy ? 'Confirming…' : 'Confirm payment'}</button></>}>
      <p className="text-lg font-bold">Amount due {formatMinorMoneyText(totalMinor, currency)}</p>
      {shortfallLines.length>0&&<section className="space-y-3 rounded-xl border border-amber-700 bg-amber-950/20 p-3" aria-label="Stock exception confirmation"><div><h2 className="font-semibold text-amber-100">Recorded stock is short</h2><p className="mt-1 text-xs leading-5 text-amber-200">{stockPolicy?.enabled?'Continue only after physically checking that each item is available. Your confirmation and reason will be saved with the sale.':'This outlet does not allow sales against stock shortfalls. Ask an administrator to review the outlet policy.'}</p></div>{shortfallLines.map(({product,shortfall})=>{const quantity=quantityTextFromMicros(shortfall),ack=stockAcknowledgements[product.id]??{reasonCode:'' as const,reasonNote:'',confirmedQuantity:null};return <div key={product.id} className="space-y-2 border-t border-amber-900 pt-3"><p className="text-sm font-medium">{product.name}: {formatDecimalQuantity(quantity)} {product.unit} beyond recorded stock</p><label className="block text-xs text-zinc-300">Reason<select disabled={locked||!stockPolicy?.enabled} value={ack.reasonCode} onChange={event=>setStockAcknowledgements(previous=>({...previous,[product.id]:{...ack,reasonCode:event.target.value as StockExceptionReason}}))} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm"><option value="">Choose a reason</option><option value="SUSPECTED_UNRECORDED_DELIVERY">Delivery may not have been recorded</option><option value="SUSPECTED_OUTDATED_COUNT">Stock count may be outdated</option><option value="UNKNOWN">Other or unknown cause</option></select></label><label className="block text-xs text-zinc-300">Additional note<input disabled={locked||!stockPolicy?.enabled} maxLength={500} value={ack.reasonNote} onChange={event=>setStockAcknowledgements(previous=>({...previous,[product.id]:{...ack,reasonNote:event.target.value}}))} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm" placeholder={ack.reasonCode==='UNKNOWN'?'Required for an unknown cause':'Optional'}/></label>{ack.reasonCode==='UNKNOWN'&&ack.reasonNote.trim().length<3&&<p className="text-xs text-amber-200">Explain the unknown cause in at least 3 characters.</p>}<label className="flex min-h-11 items-start gap-3 rounded-lg border border-zinc-700 p-3 text-xs"><input type="checkbox" disabled={locked||!stockPolicy?.enabled} checked={ack.confirmedQuantity===quantity} onChange={event=>setStockAcknowledgements(previous=>({...previous,[product.id]:{...ack,confirmedQuantity:event.target.checked?quantity:null}}))} className="mt-0.5"/><span>I physically checked and confirmed that this item is available in this quantity.</span></label></div>;})}</section>}
      <div className="grid grid-cols-2 gap-3"><button type="button" disabled={locked} onClick={() => selectMethod('cash')} aria-pressed={paymentMethod === 'cash'} className={`${actionClass} ${paymentMethod === 'cash' ? 'border-blue-500 bg-blue-950' : ''}`}><Banknote size={17} />Cash</button><button type="button" disabled={locked} onClick={() => selectMethod('manual_mpesa')} aria-pressed={paymentMethod === 'manual_mpesa'} className={`${actionClass} ${paymentMethod === 'manual_mpesa' ? 'border-blue-500 bg-blue-950' : ''}`}><Smartphone size={17} />M-Pesa</button>{canChargeAccount && <button type="button" disabled={locked} onClick={() => selectMethod('customer_credit')} aria-pressed={paymentMethod === 'customer_credit'} className={`${actionClass} ${paymentMethod === 'customer_credit' ? 'border-blue-500 bg-blue-950' : ''}`}><Users size={17} />Customer account</button>}</div>
      {paymentMethod === 'cash' ? <div className="space-y-3"><label className="block text-sm">Cash received ({currency})<input disabled={locked} autoFocus inputMode="decimal" value={tender} onChange={event => setTender(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 font-mono" /></label><button type="button" disabled={locked} onClick={() => setTender(minorToMoneyInput(totalMinor, currency))} className={actionClass}>Exact amount</button><p className="flex justify-between"><span>Change</span><strong className="font-mono">{formatMinorMoneyText(tenderMinor !== null && tenderMinor >= totalMinor ? tenderMinor - totalMinor : 0n, currency)}</strong></p>{(tenderMinor === null || tenderMinor < totalMinor) && <p role="status" className="text-amber-300">Enter cash received covering the amount due.</p>}</div>
        : paymentMethod === 'manual_mpesa' ? <div className="space-y-3"><p className="text-sm text-zinc-300">Check the business’s M-Pesa payment confirmation for the exact amount due before completing this sale.</p><label className="block text-sm">M-Pesa transaction reference<input disabled={locked} value={mpesaReference} autoCapitalize="characters" autoComplete="off" maxLength={64} onChange={event => { setMpesaReference(event.target.value.toUpperCase()); setMpesaConfirmed(false); }} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 font-mono" /></label>{mpesaReference && !validReference && <p role="status" className="text-amber-300">Enter the transaction reference using 4–64 letters, numbers or hyphens.</p>}<label className="flex min-h-11 items-start gap-3 rounded-xl border border-zinc-700 p-3 text-sm"><input type="checkbox" disabled={locked} checked={mpesaConfirmed} onChange={event => setMpesaConfirmed(event.target.checked)} className="mt-1" /><span>I have checked that {formatMinorMoneyText(totalMinor, currency)} was received by M-Pesa.</span></label><p className="text-xs text-zinc-500">Recorded as confirmed by you. Statement matching is separate. This payment adds no cash to the drawer.</p></div>
        : <div className="space-y-3">{customersBusy && <p role="status">Loading customer accounts…</p>}{customerError && <p role="alert" className="text-rose-300">{customerError}<button type="button" onClick={() => void refresh()} className="ml-2 underline">Try again</button></p>}<label className="block text-sm">Find a customer<input disabled={locked} value={customerQuery} onChange={event => setCustomerQuery(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" /></label><div className="max-h-56 space-y-2 overflow-y-auto">{filteredCustomers.length ? filteredCustomers.map(customer => <button type="button" key={customer.id} disabled={locked || customersBusy || !!customerError} onClick={() => setCustomerId(customer.id)} aria-pressed={customer.id === customerId} className={`min-h-14 w-full rounded-xl border p-3 text-left ${customer.id === customerId ? 'border-blue-500 bg-blue-950' : 'border-zinc-700'}`}><strong className="block">{customer.name}</strong><small className="mt-1 block text-zinc-400">{customer.phone} · {customer.status === 'ACTIVE' ? 'Active' : 'Suspended'} · available {formatMinorMoneyText(BigInt(customer.creditLimitMinor) - BigInt(customer.balanceMinor), currency)}</small></button>) : !customersBusy && <p className="text-zinc-400">No customer accounts match. A manager can add an account in Customers.</p>}</div><HistoryNavigation page={customerPage} loaded={customers.length} busy={customersBusy} label="customer accounts" onMore={()=>void loadCustomers({q:customerSearch.current,after:customerPage?.nextCursor??undefined},true)}/>{selectedCustomer && <p role="status" className={creditAllowed ? 'text-emerald-300' : 'text-rose-300'}>{creditAllowed ? 'The amount is within the approved account limit.' : 'Check the account status and available credit.'}</p>}<p className="text-xs text-zinc-500">Account charges increase the customer’s balance. They do not record money received.</p></div>}
      {notice && <p role={unknownId ? 'alert' : 'status'} className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">{notice}{unknownId && <button type="button" disabled={busy} onClick={() => void recover()} className="ml-3 underline">Check payment status</button>}</p>}
    </ResponsiveDialog>
  </main>;
}
