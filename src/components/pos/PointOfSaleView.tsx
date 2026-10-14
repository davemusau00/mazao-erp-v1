import { useEffect, useRef, useState } from 'react';
import { Banknote, Barcode, Minus, Plus, RefreshCw, Search, ShoppingCart, Trash2, Users } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendCustomerAccount, type BackendProduct, type BackendShift } from '../../services/apiClient';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { formatMinorMoneyText, minorToMoneyInput, moneyInputToMinor } from '../../utils/money';
import { sumDecimalStrings, subtractDecimalStrings } from '../../utils/decimal';

interface BasketLine { productId: string; quantity: string }
const quantityScale = 1_000_000n;
function quantityMicros(value: string): bigint | null {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * quantityScale + BigInt(fraction.padEnd(6, '0'));
}
function lineMinor(unitMinor: number, quantity: string): bigint {
  const micros = quantityMicros(quantity);
  return micros === null ? 0n : (BigInt(unitMinor) * micros + quantityScale / 2n) / quantityScale;
}
const actionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm disabled:opacity-50';

/** Basket projections and settlement evidence belong to the authenticated outlet. */
export function PointOfSaleView({ onOrderCompleted }: { onOrderCompleted: (orderId: string) => void }) {
  const session = apiClient.getSession()!;
  const currency = session.tenant.currency;
  const [products, setProducts] = useState<BackendProduct[]>([]);
  const [shift, setShift] = useState<BackendShift | null>(null);
  const [customers, setCustomers] = useState<BackendCustomerAccount[]>([]);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [customerError, setCustomerError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'customer_credit'>('cash');
  const [tender, setTender] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [unknownId, setUnknownId] = useState('');
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const pending = useRef<BackendCommand | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const searchInput = useRef<HTMLInputElement>(null);
  const canChargeAccount = session.user.permissions.includes('customers.charge');
  const locked = busy || !!unknownId;
  const refresh = async () => {
    setLoading(true); setLoaded(false); setError('');
    try {
      const [catalog, currentShift] = await Promise.all([apiClient.listCatalog(), apiClient.getCurrentShift()]);
      setProducts(catalog.items); setShift(currentShift.shift); setLoaded(true);
      if (session.user.permissions.includes('customers.view')) {
        try { const accounts = await apiClient.listCustomerAccounts(); setCustomers(accounts.customers); setCustomerError(''); }
        catch (failure) { setCustomers([]); setCustomerError(failure instanceof Error ? failure.message : 'Customer accounts could not be loaded.'); }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The outlet catalog and shift could not be loaded.'); setShift(null); }
    finally { setLoading(false); }
  };
  const loadRecovery = async () => {
    setRecoveryChecked(false); setRecoveryError('');
    try {
        const records = await apiClient.listRecoverableCommands(session.tenant.id);
        const record = records.find(entry => entry.command.type === 'sales.order.settle' && entry.command.deviceId === session.deviceId);
        if (!mounted.current) return;
        if (record) {
          pending.current = record.command; setUnknownId(record.command.commandId);
          const lines = record.command.payload.lines as BasketLine[];
          setBasket(lines.map(line => ({ productId: line.productId, quantity: line.quantity })));
          if (typeof record.command.payload.customerId === 'string') { setCustomerId(record.command.payload.customerId); setPaymentMethod('customer_credit'); }
          setNotice('A sale has an unresolved outcome. Check its original command status before collecting another payment.');
        }
        setRecoveryChecked(true);
      } catch (failure) {
        if (mounted.current) setRecoveryError(failure instanceof Error ? failure.message : 'Command recovery could not be loaded.');
      }
  };
  useEffect(() => {
    mounted.current = true;
    setRecoveryChecked(false);
    void refresh(); void loadRecovery();
    return () => { mounted.current = false; };
  }, [session.tenant.id, session.outlet.id, session.deviceId]);
  const productById = new Map(products.map(product => [product.id, product]));
  const validBasket = basket.length > 0 && basket.every(line => {
    const micros = quantityMicros(line.quantity);
    return !!productById.get(line.productId) && micros !== null && micros > 0n;
  });
  const subtotalMinor = basket.reduce((sum, line) => sum + lineMinor(productById.get(line.productId)?.sellingPriceMinor ?? 0, line.quantity), 0n);
  const taxMinor = basket.reduce((sum, line) => {
    const product = productById.get(line.productId), subtotal = lineMinor(product?.sellingPriceMinor ?? 0, line.quantity);
    return sum + (subtotal * BigInt(product?.taxRateBps ?? 0) + 5_000n) / 10_000n;
  }, 0n);
  const totalMinor = subtotalMinor + taxMinor;
  let tenderMinor: bigint | null = null;
  try { tenderMinor = BigInt(moneyInputToMinor(tender, currency)); } catch { /* Invalid input disables confirmation. */ }
  const selectedCustomer = customers.find(customer => customer.id === customerId);
  const availableCredit = selectedCustomer ? BigInt(selectedCustomer.creditLimitMinor) - BigInt(selectedCustomer.balanceMinor) : 0n;
  const creditAllowed = !!selectedCustomer && selectedCustomer.status === 'ACTIVE' && availableCredit >= totalMinor;
  const readyToConfirm = loaded && recoveryChecked && !!shift && validBasket && totalMinor > 0n && !locked && (
    paymentMethod === 'cash' ? tenderMinor !== null && tenderMinor >= totalMinor : canChargeAccount && creditAllowed
  );
  const filteredProducts = products.filter(product => `${product.name} ${product.sku}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const filteredCustomers = customers.filter(customer => `${customer.name} ${customer.phone} ${customer.email ?? ''}`.toLocaleLowerCase().includes(customerQuery.toLocaleLowerCase()));
  const addProduct = (product: BackendProduct) => {
    if (locked || !loaded) return;
    setBasket(previous => {
      const existing = previous.find(line => line.productId === product.id);
      return existing ? previous.map(line => line.productId === product.id ? { ...line, quantity: sumDecimalStrings([line.quantity, '1']) } : line) : [...previous, { productId: product.id, quantity: '1' }];
    });
    if (quantityMicros(product.quantity) === 0n) setNotice(`${product.name} has no outlet stock. The server validates stock before settlement.`);
  };
  const scan = (event: React.FormEvent) => {
    event.preventDefault();
    const match = products.find(product => product.sku.toLocaleLowerCase() === query.trim().toLocaleLowerCase() || product.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase());
    if (match) { addProduct(match); setQuery(''); }
    else setNotice('No exact SKU or item name found. Choose a search result or review the catalog.');
    searchInput.current?.focus();
  };
  const changeQuantity = (productId: string, value: string) => {
    if (!locked) setBasket(previous => previous.map(line => line.productId === productId ? { ...line, quantity: value } : line));
  };
  const acknowledge = async (response: { status?: string; value?: Record<string, unknown>; message?: string }, command: BackendCommand) => {
    if (response.status === 'CONFIRMED' && typeof response.value?.saleId === 'string') {
      pending.current = null; setUnknownId(''); setBasket([]); setPaymentOpen(false);
      setNotice('Sale confirmed. Loading the receipt from the server.'); onOrderCompleted(response.value.saleId); await refresh();
    } else if (response.status === 'REJECTED' || response.status === 'CONFLICT') {
      pending.current = null; setUnknownId(''); setNotice(response.message ?? `Sale ${response.status.toLocaleLowerCase()}. Review the basket before trying again.`); await refresh();
    } else { setUnknownId(command.commandId); setNotice('Payment outcome is unknown. Check the original command status before retrying.'); }
  };
  const confirmSale = async () => {
    if (inFlight.current || !readyToConfirm || !shift) return;
    const command: BackendCommand = {
      protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId,
      type: 'sales.order.settle', occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shift.id}`]: shift.version },
      payload: { shiftId: shift.id, lines: basket.map(line => ({ productId: line.productId, quantity: line.quantity })), ...(paymentMethod === 'customer_credit' ? { customerId } : {}), tenders: paymentMethod === 'cash' ? [{ method: 'CASH', amountMinor: Number(tenderMinor!), currency }] : [] },
    };
    pending.current = command; inFlight.current = true; setBusy(true); setNotice('');
    try { await acknowledge(await apiClient.submitCommand(command), command); }
    catch (failure) { setUnknownId(command.commandId); setNotice(failure instanceof Error ? failure.message : 'Sale outcome is unknown.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const recover = async () => {
    const command = pending.current;
    if (!command || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      try { const status = await apiClient.checkCommandStatus(command.commandId); await acknowledge(status.response, command); }
      catch (failure) {
        if ((failure as { status?: number }).status !== 404) throw failure;
        // A server-confirmed missing command can be resent only with its original envelope.
        await acknowledge(await apiClient.submitCommand(command), command);
      }
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Command status could not be checked.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <main className="grid min-h-full gap-4 p-4 pb-24 text-zinc-100 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-6">
    <section className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-blue-300">Sell · {session.outlet.name}</p><h1 className="mt-1 text-2xl font-bold">Make a sale</h1><p className="mt-1 text-xs text-zinc-400">{currency} · {session.tenant.timeZone} · item tax rates from the outlet catalog</p></div><button type="button" className={actionClass} disabled={loading || locked} onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button></header>
      {error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">{error} Checkout remains disabled until the outlet is loaded.</p>}
      {!recoveryChecked && <div role={recoveryError ? 'alert' : 'status'} className="rounded-xl border border-amber-800 p-3 text-sm text-amber-200">{recoveryError || 'Checking retained command evidence before accepting payment.'}{recoveryError && <button type="button" onClick={() => void loadRecovery()} className="ml-3 min-h-11 underline">Retry command recovery</button>}</div>}
      {notice && <div role={unknownId ? 'alert' : 'status'} className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-800 bg-blue-950/30 p-3 text-sm"><p className="flex-1">{notice}</p>{unknownId && <button type="button" disabled={busy} onClick={() => void recover()} className={actionClass}>Check command status</button>}</div>}
      {!loading && loaded && !shift && <p className="rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">Open a shift in Shifts before taking payment.</p>}
      <form onSubmit={scan} className="relative"><Search className="absolute left-3 top-3.5 text-zinc-500" size={18} /><label className="sr-only" htmlFor="pos-search">Search items or scan SKU</label><input id="pos-search" ref={searchInput} disabled={locked || !loaded} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search items or scan SKU, then Enter" className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 pl-10 pr-12 text-sm" /><button type="submit" aria-label="Add scanned item" disabled={locked || !loaded || !query.trim()} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-blue-300"><Barcode size={19} /></button></form>
      {loading ? <p role="status" className="py-12 text-center text-zinc-400">Loading outlet catalog and shift…</p> : filteredProducts.length === 0 ? <div className="rounded-xl border border-zinc-800 p-8 text-center"><ShoppingCart className="mx-auto text-zinc-500" /><p className="mt-3 text-sm text-zinc-400">{products.length ? 'No items match this search.' : 'No items in this outlet. Create items and receive stock in Stock.'}</p></div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{filteredProducts.map(product => <button key={product.id} type="button" disabled={locked || !loaded} onClick={() => addProduct(product)} className="min-h-32 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-left disabled:opacity-50 hover:border-blue-600"><strong className="block text-sm">{product.name}</strong><span className="mt-1 block text-xs text-zinc-500">{product.sku}</span><span className="mt-3 block font-mono text-sm text-blue-300">{formatMinorMoneyText(BigInt(product.sellingPriceMinor), currency)}</span><span className="mt-1 block text-xs text-zinc-400">{product.quantity} {product.unit} on hand</span></button>)}</div>}
    </section>
    <section className="h-fit min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 lg:sticky lg:top-0" aria-label="Basket">
      <header className="flex items-center justify-between"><h2 className="text-lg font-semibold">Basket</h2><button type="button" disabled={locked || !basket.length} onClick={() => setBasket([])} className="flex min-h-11 items-center gap-2 px-2 text-xs text-zinc-400"><Trash2 size={16} />Clear</button></header>
      {!basket.length ? <p className="py-12 text-center text-sm text-zinc-500">Choose items to start a sale.</p> : <div className="max-h-[42dvh] space-y-4 overflow-y-auto py-4">{basket.map(line => {
        const product = productById.get(line.productId);
        return <article key={line.productId} className="border-b border-zinc-800 pb-3"><div className="flex justify-between gap-2"><strong className="text-sm">{product?.name ?? `Item ${line.productId}`}</strong><button type="button" disabled={locked} aria-label={`Remove ${product?.name ?? 'item'}`} onClick={() => setBasket(previous => previous.filter(entry => entry.productId !== line.productId))} className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-400"><Trash2 size={15} /></button></div><div className="flex items-center gap-2"><button type="button" disabled={locked || (quantityMicros(line.quantity) ?? 0n) <= quantityScale} onClick={() => changeQuantity(line.productId, subtractDecimalStrings(line.quantity, '1'))} aria-label={`Decrease ${product?.name ?? 'item'} quantity`} className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700"><Minus size={16} /></button><label className="min-w-0 flex-1"><span className="sr-only">Quantity for {product?.name ?? line.productId}</span><input disabled={locked} inputMode="decimal" value={line.quantity} onChange={event => changeQuantity(line.productId, event.target.value)} className="min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-center text-sm" /></label><button type="button" disabled={locked} onClick={() => changeQuantity(line.productId, sumDecimalStrings([line.quantity, '1']))} aria-label={`Increase ${product?.name ?? 'item'} quantity`} className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700"><Plus size={16} /></button></div><p className="mt-2 text-right font-mono text-sm">{formatMinorMoneyText(lineMinor(product?.sellingPriceMinor ?? 0, line.quantity), currency)}</p>{(!product || quantityMicros(line.quantity) === null || quantityMicros(line.quantity) === 0n) && <p className="text-xs text-rose-300">Enter a positive quantity with up to six decimals for an available item.</p>}</article>;
      })}</div>}
      <dl className="space-y-2 border-t border-zinc-800 pt-4 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd className="font-mono">{formatMinorMoneyText(subtotalMinor, currency)}</dd></div><div className="flex justify-between"><dt>Tax by item</dt><dd className="font-mono">{formatMinorMoneyText(taxMinor, currency)}</dd></div><div className="flex justify-between pt-2 text-lg font-bold"><dt>Estimated total</dt><dd className="font-mono text-blue-300">{formatMinorMoneyText(totalMinor, currency)}</dd></div></dl>
      <button type="button" disabled={!loaded || !recoveryChecked || !shift || !validBasket || locked} onClick={() => { setTender(minorToMoneyInput(totalMinor, currency)); setPaymentOpen(true); }} className="mt-5 min-h-12 w-full rounded-xl bg-blue-600 px-3 font-semibold disabled:opacity-50">Take payment</button><p className="mt-3 text-xs leading-5 text-zinc-500">The server confirms the final price, tax, stock and payment. Receipt printing opens after confirmation.</p>
    </section>
    <ResponsiveDialog isOpen={paymentOpen} onClose={() => { if (!locked) setPaymentOpen(false); }} title="Take payment" subtitle={`${currency} · ${session.outlet.name}`} footerActions={<><button type="button" disabled={locked} onClick={() => setPaymentOpen(false)} className={actionClass}>Cancel</button><button type="button" disabled={!readyToConfirm} onClick={() => void confirmSale()} className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold disabled:opacity-50">{busy ? 'Confirming…' : 'Confirm payment'}</button></>}>
      <p className="text-lg font-bold">Amount due {formatMinorMoneyText(totalMinor, currency)}</p>
      <div className="grid grid-cols-2 gap-3"><button type="button" disabled={locked} onClick={() => setPaymentMethod('cash')} aria-pressed={paymentMethod === 'cash'} className={`${actionClass} ${paymentMethod === 'cash' ? 'border-blue-500 bg-blue-950' : ''}`}><Banknote size={17} />Cash</button>{canChargeAccount && <button type="button" disabled={locked} onClick={() => setPaymentMethod('customer_credit')} aria-pressed={paymentMethod === 'customer_credit'} className={`${actionClass} ${paymentMethod === 'customer_credit' ? 'border-blue-500 bg-blue-950' : ''}`}><Users size={17} />Customer account</button>}</div>
      {paymentMethod === 'cash' ? <div className="space-y-3"><label className="block text-sm">Cash received ({currency})<input disabled={locked} autoFocus inputMode="decimal" value={tender} onChange={event => setTender(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 font-mono" /></label><button type="button" disabled={locked} onClick={() => setTender(minorToMoneyInput(totalMinor, currency))} className={actionClass}>Exact amount</button><p className="flex justify-between"><span>Change</span><strong className="font-mono">{formatMinorMoneyText(tenderMinor !== null && tenderMinor >= totalMinor ? tenderMinor - totalMinor : 0n, currency)}</strong></p>{(tenderMinor === null || tenderMinor < totalMinor) && <p role="status" className="text-amber-300">Enter valid cash received covering the amount due.</p>}</div> : <div className="space-y-3">{customerError && <p role="alert" className="text-rose-300">{customerError}</p>}<label className="block text-sm">Find a customer<input disabled={locked} value={customerQuery} onChange={event => setCustomerQuery(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" /></label><div className="max-h-56 space-y-2 overflow-y-auto">{filteredCustomers.length ? filteredCustomers.map(customer => <button type="button" key={customer.id} disabled={locked} onClick={() => setCustomerId(customer.id)} aria-pressed={customer.id === customerId} className={`min-h-14 w-full rounded-xl border p-3 text-left ${customer.id === customerId ? 'border-blue-500 bg-blue-950' : 'border-zinc-700'}`}><strong className="block">{customer.name}</strong><small className="mt-1 block text-zinc-400">{customer.phone} · {customer.status} · available {formatMinorMoneyText(BigInt(customer.creditLimitMinor) - BigInt(customer.balanceMinor), currency)}</small></button>) : <p className="text-zinc-400">No customer accounts match. A manager can add an account in Customers.</p>}</div>{selectedCustomer && <p role="status" className={creditAllowed ? 'text-emerald-300' : 'text-rose-300'}>{creditAllowed ? 'The amount is within the approved account limit.' : 'The account is suspended or its approved credit is insufficient.'}</p>}<p className="text-xs text-zinc-500">Account charges record a receivable. They do not record cash received.</p></div>}
      {notice && <p role={unknownId ? 'alert' : 'status'} className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">{notice}{unknownId && <button type="button" disabled={busy} onClick={() => void recover()} className="ml-3 underline">Check command status</button>}</p>}
    </ResponsiveDialog>
  </main>;
}
