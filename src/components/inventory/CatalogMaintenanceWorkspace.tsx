import { catalogItemKind, catalogItemKindLabel, isStockTracked, type CatalogItemKind } from '../../types/catalog';
import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react';
import { apiClient, type BackendCatalogCategory, type BackendCommand, type BackendCommandResult, type BackendProduct } from '../../services/apiClient';
import { useCommandRecoveryReadiness } from '../../hooks/useCommandRecoveryReadiness';
import { CommandRecoveryReadiness } from '../common/CommandRecoveryReadiness';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { formatBasisPoints, formatDecimalQuantity, formatMinorMoneyText, minorToMoneyInput, moneyInputToMinor } from '../../utils/money';

type Action = 'product-create' | 'product-edit' | 'product-active' | 'product-kind' | 'category-create' | 'category-edit' | 'category-active' | 'category-merge';
type Target = { id: string; name: string; version: number; active: boolean; balanceVersion: number | null; itemKind: CatalogItemKind };
type Draft = { sku: string; name: string; unit: string; price: string; cost: string; tax: string; barcode: string; category: string; reorder: string; reason: string; targetCategoryId: string; nextActive: boolean; kind: CatalogItemKind };
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50';
const input = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white disabled:opacity-60';
const titles: Record<Action, string> = { 'product-create': 'Create item', 'product-edit': 'Edit item', 'product-active': 'Change item availability', 'product-kind': 'Change item type', 'category-create': 'Create category', 'category-edit': 'Rename category', 'category-active': 'Change category availability', 'category-merge': 'Merge categories' };
const types: Record<Action, string> = { 'product-create': 'catalog.product.create', 'product-edit': 'catalog.product.update', 'product-active': 'catalog.product.set_active', 'product-kind': 'catalog.product.change_kind', 'category-create': 'catalog.category.create', 'category-edit': 'catalog.category.update', 'category-active': 'catalog.category.set_active', 'category-merge': 'catalog.category.merge' };
function blank(): Draft { return { sku: '', name: '', unit: 'each', price: '', cost: '', tax: '', barcode: '', category: '', reorder: '0', reason: '', targetCategoryId: '', nextActive: true, kind: 'STOCKED_GOOD' }; }
function percent(bps: number): string { return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}`; }
function taxBps(value: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a tax percentage from 0 to 100 with up to two decimal places.');
  const bps = Number(BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0')));
  if (bps > 10000) throw new Error('Tax cannot exceed 100%.');
  return bps;
}
function productDraft(product: BackendProduct): Draft {
  return { ...blank(), kind: catalogItemKind(product), name: product.name, sku: product.sku, unit: product.unit, price: minorToMoneyInput(product.sellingPriceMinor, product.currency), cost: minorToMoneyInput(product.costPriceMinor ?? 0, product.currency), tax: percent(product.taxRateBps), barcode: product.barcode ?? '', category: product.category ?? '', reorder: product.reorderLevel ?? '0' };
}

/** Only confirmed commands change the displayed catalog, through fresh server reads. */
export function CatalogMaintenanceWorkspace({ onBack, initialCreate = false, backLabel = 'Back to stock', onImport }: { onBack: (notice?: string) => void; initialCreate?: boolean; backLabel?: string; onImport?: () => void }) {
  const session = apiClient.getSession()!;
  const canManage = session.user.permissions.includes('catalog.manage');
  const inventoryEnabled = session.tenant.capabilities.includes('inventory');
  const commerceEnabled = session.tenant.capabilities.includes('commerce');
  const formId = useId();
  const [view, setView] = useState<'products' | 'categories'>('products');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [items, setItems] = useState<BackendProduct[]>([]);
  const [categories, setCategories] = useState<BackendCatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [productError, setProductError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<Action | null>(initialCreate ? 'product-create' : null);
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState<Draft>(() => ({ ...blank(), kind: inventoryEnabled ? 'STOCKED_GOOD' : 'SERVICE' }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [unsupportedRecovery, setUnsupportedRecovery] = useState(false);
  const pending = useRef<BackendCommand | null>(null);
  const mounted = useRef(true);
  const read = useRef<AbortController | null>(null);
  const restore = (command: BackendCommand) => {
    pending.current = command;
    setUnknown(true); setConflict(false); setDirty(false);
    const found = (Object.keys(types) as Action[]).find(key => types[key] === command.type);
    if (!found) { setUnsupportedRecovery(true); setNotice('A catalog import needs review. Open its saved import before starting another catalog change.'); return; }
    setUnsupportedRecovery(false); setAction(found);
    const p = command.payload;
    const id = String(p.productId ?? p.categoryId ?? p.sourceCategoryId ?? '');
    const kind = found.startsWith('product-') ? 'product' : 'category';
    setTarget(id ? { id, name: String(p.name ?? id), version: command.expectedVersions[`${kind}:${id}`] ?? 0, active: p.active === false, itemKind: p.itemKind as CatalogItemKind ?? 'STOCKED_GOOD', balanceVersion: command.expectedVersions[`balance:${id}`] ?? null } : null);
    setDraft({ ...blank(), sku: String(p.sku ?? ''), name: String(p.name ?? ''), unit: String(p.baseUnit ?? 'each'), price: p.sellingPriceMinor === undefined ? '' : minorToMoneyInput(Number(p.sellingPriceMinor), session.tenant.currency), cost: p.costPriceMinor === undefined ? '' : minorToMoneyInput(Number(p.costPriceMinor), session.tenant.currency), tax: p.taxRateBps === undefined ? '' : percent(Number(p.taxRateBps)), barcode: String(p.barcode ?? ''), category: String(p.category ?? ''), reorder: String(p.reorderLevel ?? '0'), reason: String(p.reason ?? ''), targetCategoryId: String(p.targetCategoryId ?? ''), nextActive: p.active === true, kind: p.itemKind as CatalogItemKind ?? 'STOCKED_GOOD' });
    setNotice('An item or category change needs review. Its original values are restored. Check its status before editing or repeating it.');
  };
  const recovery = useCommandRecoveryReadiness('catalog.', restore);
  const locked = busy || unknown || !recovery.ready || unsupportedRecovery;
  const refresh = async (showArchived = includeArchived) => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller;
    setLoading(true); setProductError(''); setCategoryError('');
    const results = await Promise.allSettled([apiClient.listCatalog(controller.signal, { includeArchived: showArchived }), apiClient.listCatalogCategories(controller.signal, { includeArchived: true })]);
    if (!mounted.current || controller.signal.aborted) return;
    if (results[0].status === 'fulfilled') setItems(results[0].value.items);
    else setProductError(results[0].reason instanceof Error ? results[0].reason.message : 'Items could not be loaded.');
    if (results[1].status === 'fulfilled') setCategories(results[1].value.categories);
    else setCategoryError(results[1].reason instanceof Error ? results[1].reason.message : 'Categories could not be loaded.');
    setLoading(false);
  };
  useEffect(() => { mounted.current = true; if (canManage) void refresh(); return () => { mounted.current = false; read.current?.abort(); }; }, []);
  useEffect(() => {
    const leave = (event: Event) => {
      if (recovery.inFlight.current) { event.preventDefault(); setFormError('Wait while the original catalog command is being checked.'); }
      else if (dirty && !window.confirm('Discard these unsaved catalog edits?')) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirty || recovery.inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('mazao:before-navigate', leave); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('mazao:before-navigate', leave); window.removeEventListener('beforeunload', unload); };
  }, [dirty]);

  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setDirty(true); };
  const open = (next: Action, product?: BackendProduct, category?: BackendCatalogCategory) => {
    if (locked || loading) return;
    const source = product ?? category;
    setTarget(source ? { id: source.id, name: source.name, active: source.active !== false, version: product ? product.productVersion ?? 0 : category!.version, balanceVersion: product ? (product.balanceVersion === undefined ? (product.itemKind ? null : product.version) : product.balanceVersion) : null, itemKind: product ? catalogItemKind(product) : 'STOCKED_GOOD' } : null);
    setDraft(product ? { ...productDraft(product), nextActive: product.active === false } : { ...blank(), kind: inventoryEnabled ? 'STOCKED_GOOD' : 'SERVICE', name: category?.name ?? '', nextActive: category?.active === false });
    setFormError(''); setNotice(''); setConflict(false); setDirty(false); setAction(next);
  };
  const close = () => {
    if (locked) return;
    if (dirty && !window.confirm('Discard these unsaved catalog edits?')) return;
    setAction(null); setDirty(false); setFormError(''); setConflict(false);
    if (initialCreate) onBack();
  };
  const acknowledge = async (result: BackendCommandResult, command: BackendCommand) => {
    if (!mounted.current) return;
    if (result.status === 'CONFIRMED') {
      pending.current = null; setUnknown(false); setDirty(false); setAction(null); setFormError(''); setConflict(false);
      const message = command.type === 'catalog.product.create' ? command.payload.itemKind === 'SERVICE' ? 'Service created for future sales.' : command.payload.itemKind === 'PREPARED' ? 'Prepared item created. Recipe setup is required before sale.' : 'Item created. Receive stock before selling it.' : command.type.startsWith('catalog.category.') ? 'Category change confirmed.' : 'Item change confirmed.';
      setNotice(message);
      await recovery.inspect();
      if (initialCreate && command.type === 'catalog.product.create') { onBack(message); return; }
      await refresh();
    } else if (result.status === 'REJECTED' || result.status === 'CONFLICT') {
      pending.current = null; setUnknown(false);
      setConflict(result.status === 'CONFLICT');
      setFormError((result.message ?? 'The catalog change was not applied.') + (result.status === 'CONFLICT' ? ' Your entered values are kept. Reload the catalog and review the latest record before starting another command.' : ' Review the values before trying again.'));
      await recovery.inspect();
    } else { setUnknown(true); setFormError('This change is not confirmed. Check its status before repeating it.'); }
  };
  const send = async (command: BackendCommand) => {
    if (!recovery.begin()) return;
    pending.current = command; setBusy(true); setFormError('');
    try { await acknowledge(await apiClient.submitCommand(command), command); }
    catch (cause) {
      if (!mounted.current) return;
      if ((cause as { code?: string }).code === 'COMMAND_NOT_SENT') pending.current = null;
      else setUnknown(true);
      setFormError(cause instanceof Error ? cause.message : 'This catalog change is not confirmed. Check its status.');
    } finally { recovery.finish(); if (mounted.current) setBusy(false); }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!action || locked || conflict || pending.current) return;
    try {
      const expectedVersions: Record<string, number> = {};
      let payload: Record<string, unknown>;
      if (action === 'product-create' || action === 'product-edit') {
        if (!draft.name.trim()) throw new Error('Enter an item name.');
        if (!/^\d{1,14}(?:\.\d{1,6})?$/.test(draft.reorder.trim())) throw new Error('Reorder level needs a non-negative base-unit quantity with up to six decimal places.');
        if (action === 'product-create' && draft.kind !== 'STOCKED_GOOD' && !commerceEnabled) throw new Error('Enable sales before creating services or prepared items.');
        if (action === 'product-create' && draft.kind === 'STOCKED_GOOD' && !inventoryEnabled) throw new Error('Enable inventory before creating stocked goods.');
        const metadata = { name: draft.name.trim(), sellingPriceMinor: moneyInputToMinor(draft.price, session.tenant.currency), costPriceMinor: moneyInputToMinor(draft.cost || '0', session.tenant.currency), barcode: draft.barcode.trim() || null, category: draft.category, reorderLevel: draft.reorder.trim() };
        payload = action === 'product-create' ? { ...metadata, itemKind: draft.kind, sku: draft.sku.trim(), baseUnit: draft.unit.trim(), currency: session.tenant.currency, ...(draft.tax.trim() ? { taxRateBps: taxBps(draft.tax) } : {}) } : { ...metadata, productId: target!.id, taxRateBps: taxBps(draft.tax), reason: draft.reason.trim() };
      } else if (action === 'product-kind') {
        if (draft.kind === target?.itemKind) throw new Error('Choose a different item type.');
        if (draft.kind !== 'STOCKED_GOOD' && !commerceEnabled) throw new Error('Enable sales before classifying services or prepared items.');
        if (draft.kind === 'STOCKED_GOOD' && !inventoryEnabled) throw new Error('Enable inventory before classifying a stocked good.');
        if (target?.balanceVersion !== null && target?.balanceVersion !== undefined) expectedVersions[`balance:${target.id}`] = target.balanceVersion;
        payload = { productId: target!.id, itemKind: draft.kind, reason: draft.reason.trim() };
      } else if (action === 'product-active') payload = { productId: target!.id, active: draft.nextActive, reason: draft.reason.trim() };
      else if (action === 'category-create') payload = { name: draft.name.trim() };
      else if (action === 'category-edit') payload = { categoryId: target!.id, name: draft.name.trim(), reason: draft.reason.trim() };
      else if (action === 'category-active') payload = { categoryId: target!.id, active: draft.nextActive, reason: draft.reason.trim() };
      else {
        const destination = categories.find(category => category.id === draft.targetCategoryId && category.active && !category.mergedInto && category.id !== target?.id);
        if (!destination) throw new Error('Choose a different active destination category.');
        expectedVersions[`category:${destination.id}`] = destination.version;
        payload = { sourceCategoryId: target!.id, targetCategoryId: destination.id, reason: draft.reason.trim() };
      }
      if (action !== 'product-create' && action !== 'category-create') {
        if (!draft.reason.trim()) throw new Error('Give a reason for this change.');
        if (!target || !Number.isSafeInteger(target.version) || target.version < 1) throw new Error('Reload the current record before changing it.');
        expectedVersions[`${action.startsWith('product-') ? 'product' : 'category'}:${target.id}`] = target.version;
      }
      void send({ protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId, type: types[action], occurredAt: new Date().toISOString(), expectedVersions, payload });
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Check the catalog values.'); }
  };
  const recover = async () => {
    const command = pending.current;
    if (!command || unsupportedRecovery || !recovery.begin()) return;
    setBusy(true); setFormError('');
    try {
      try { const result = await apiClient.checkCommandStatus(command.commandId); await acknowledge(result.response as unknown as BackendCommandResult, command); }
      catch (cause) { if ((cause as { status?: number }).status !== 404) throw cause; await acknowledge(await apiClient.submitCommand(command), command); }
    } catch (cause) { if (mounted.current) setFormError(cause instanceof Error ? cause.message : 'The original command is still unconfirmed.'); }
    finally { recovery.finish(); if (mounted.current) setBusy(false); }
  };
  const reloadAfterConflict = async () => {
    setAction(null); setDirty(false); setConflict(false); setFormError('');
    setNotice('Latest catalog requested. Open the item or category again and review its current values.');
    await refresh();
  };
  const field = (label: string, key: keyof Pick<Draft, 'sku' | 'name' | 'unit' | 'price' | 'cost' | 'tax' | 'barcode' | 'reorder' | 'reason'>, options: { required?: boolean; maxLength?: number; decimal?: boolean; placeholder?: string } = {}) => <label className="block min-w-0 text-sm">{label}<input className={input} disabled={locked || conflict} required={options.required} maxLength={options.maxLength ?? 160} inputMode={options.decimal ? 'decimal' : undefined} value={draft[key]} placeholder={options.placeholder} onChange={event => change(key, event.target.value)} /></label>;
  const kindField = <label className="block min-w-0 text-sm">Item type<select className={input} disabled={locked || conflict} value={draft.kind} onChange={event => change('kind', event.target.value as CatalogItemKind)}><option value="STOCKED_GOOD" disabled={!inventoryEnabled}>Stocked good{!inventoryEnabled ? ' (requires inventory)' : ''}</option><option value="SERVICE" disabled={!commerceEnabled}>Service (no stock tracking{!commerceEnabled ? '; requires sales' : ''})</option><option value="PREPARED" disabled={!commerceEnabled}>Prepared item (recipe required before sale{!commerceEnabled ? '; requires sales' : ''})</option></select></label>;
  const activeCategories = categories.filter(category => category.active && !category.mergedInto);
  const currentCategoryKnown = !draft.category || activeCategories.some(category => category.name === draft.category);
  const productForm = action === 'product-create' || action === 'product-edit';
  const visibleItems = items.filter(product => `${product.name} ${product.sku} ${product.barcode ?? ''} ${product.category ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const visibleCategories = categories.filter(category => (includeArchived || category.active) && category.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const submitLabel = action === 'product-create' ? 'Create item' : action === 'product-edit' ? 'Save item changes' : action === 'product-kind' ? 'Confirm item type change' : action === 'category-create' ? 'Create category' : action === 'category-edit' ? 'Rename category' : action === 'category-merge' ? 'Merge categories' : draft.nextActive ? (action === 'product-active' ? 'Restore item' : 'Restore category') : (action === 'product-active' ? 'Archive item' : 'Archive category');

  if (!canManage) return <p role="alert" className="p-6">Catalog management requires catalog access.</p>;
  return <main className="page-stack">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-blue-300">CATALOG · {session.outlet.name}</p><h1 className="mt-1 text-2xl font-bold">Manage items and categories</h1><p className="mt-2 max-w-3xl text-sm text-zinc-400">Changes apply to future sales. Posted receipts, stock movements and carrying value keep their original evidence.</p></div><button type="button" className={button} disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard these unsaved catalog edits?')) onBack(); }}><ArrowLeft size={16} />{backLabel}</button></header>
    {onImport && <button type="button" className={button} disabled={busy} onClick={onImport}>Import products</button>}
    <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} />
    {notice && <p role={unknown ? 'alert' : 'status'} className="rounded-lg border border-blue-800 p-3 text-sm text-blue-200">{notice}</p>}
    {unknown && !unsupportedRecovery && !action && <button type="button" className={button} disabled={busy} onClick={() => void recover()}>Check change status</button>}
    <nav aria-label="Catalog management" className="flex flex-wrap gap-2">{(['products', 'categories'] as const).map(key => <button type="button" key={key} className={button} aria-pressed={view === key} disabled={locked} onClick={() => { setView(key); setQuery(''); }}>{key === 'products' ? 'Items' : 'Categories'}</button>)}</nav>
    <div className="flex flex-wrap items-end gap-3"><label className="block flex-1 text-sm">Search loaded {view === 'products' ? 'items' : 'categories'}<input className={input} value={query} onChange={event => setQuery(event.target.value)} /></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeArchived} disabled={loading || locked} onChange={event => { setIncludeArchived(event.target.checked); void refresh(event.target.checked); }} />Include archived</label><button type="button" className={button} disabled={loading || locked} onClick={() => void refresh()}><RefreshCw size={16} />Refresh catalog</button><button type="button" className={button} disabled={loading || locked} onClick={() => open(view === 'products' ? 'product-create' : 'category-create')}><Plus size={16} />{view === 'products' ? 'Add item' : 'Add category'}</button></div>
    {loading && <p role="status" className="text-sm text-zinc-400">Loading catalog records…</p>}
    {productError && <p role="alert" className="text-sm text-rose-300">{productError}<button type="button" className={button + ' ml-2'} disabled={loading} onClick={() => void refresh()}>Retry items</button></p>}
    {categoryError && <p role="alert" className="text-sm text-rose-300">{categoryError}<button type="button" className={button + ' ml-2'} disabled={loading} onClick={() => void refresh()}>Retry categories</button></p>}
    {view === 'products' ? <section aria-label="Items for maintenance" className="grid gap-3 lg:grid-cols-2">{!loading && !productError && !visibleItems.length && <p className="text-sm text-zinc-400">No items match this view.</p>}{visibleItems.map(product => {
      const current = Number.isSafeInteger(product.productVersion) && Number(product.productVersion) > 0;
      const tracked = isStockTracked(product);
      const typeEnabled = tracked ? inventoryEnabled : commerceEnabled;
      const hasStock = tracked && (product.quantity === null || !/^0(?:\.0+)?$/.test(product.quantity) || BigInt(product.inventoryValueMinor ?? '0') !== 0n);
      const balanceKnown = product.balanceVersion !== undefined || product.itemKind === undefined;
      const archivedCategory = !!product.category && !activeCategories.some(category => category.name === product.category);
      const blockedReason = !typeEnabled ? tracked ? 'Enable inventory before changing this stocked good.' : 'Enable sales before changing this service or prepared item.' : !current ? 'Refresh this item to obtain its current product version.' : tracked && product.quantity === null ? 'Current stock quantities are unavailable. Enable inventory and refresh before archiving or changing type.' : product.active === false && archivedCategory ? 'Restore this item’s category before restoring the item.' : hasStock ? 'Recorded quantity or value remains. Sell or reconcile stock before archiving.' : '';
      return <article key={product.id} className="min-w-0 space-y-3 rounded-xl border border-zinc-800 p-4"><div><h2 className="break-words font-semibold">{product.name}</h2><p className="mt-1 break-all text-xs text-zinc-400">{product.sku} · {product.unit} · {catalogItemKindLabel(catalogItemKind(product))} · {product.active === false ? 'Archived' : 'Active'}</p></div><p className="text-sm">Sell {formatMinorMoneyText(String(product.sellingPriceMinor), product.currency)} · Tax {formatBasisPoints(product.taxRateBps)}%</p><p className="text-xs text-zinc-400">{product.category || 'No category'} · {tracked ? product.quantity === null ? 'Stock quantities unavailable' : `${formatDecimalQuantity(product.quantity)} ${product.unit} recorded` : catalogItemKind(product) === 'SERVICE' ? 'No stock tracking' : 'Recipe required before sale'}</p>{blockedReason && <p className="text-xs text-amber-200">{blockedReason}</p>}<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={locked || loading || !!productError || !typeEnabled || !current} onClick={() => open('product-edit', product)}>Edit {product.name}</button><button type="button" className={button} disabled={locked || loading || !!productError || !typeEnabled || !current || (product.active === false ? archivedCategory : hasStock)} onClick={() => open('product-active', product)}>{product.active === false ? 'Restore' : 'Archive'} {product.name}</button><button type="button" className={button} disabled={locked || loading || !!productError || !typeEnabled || !current || hasStock || !balanceKnown} onClick={() => open('product-kind', product)}>Change type {product.name}</button></div>{hasStock && product.quantity !== null && <p className="text-xs text-zinc-400">Correct recorded stock through receiving or a reviewed count before changing this item's type.</p>}{!balanceKnown && <p className="text-xs text-amber-200">Refresh this item to obtain its balance version before changing its type.</p>}</article>;
    })}</section> : <section aria-label="Category records" className="grid gap-3 lg:grid-cols-2">{!loading && !categoryError && !visibleCategories.length && <p className="text-sm text-zinc-400">No categories match this view.</p>}{visibleCategories.map(category => <article key={category.id} className="min-w-0 space-y-3 rounded-xl border border-zinc-800 p-4"><div><h2 className="break-words font-semibold">{category.name}</h2><p className="mt-1 text-xs text-zinc-400">{category.mergedInto ? 'Merged' : category.active ? 'Active' : 'Archived'} · {category.activeProductCount} active items · {category.productCount} linked items</p></div>{category.mergedInto && <p className="text-xs text-amber-200">Merged into {categories.find(item => item.id === category.mergedInto)?.name ?? category.mergedInto}. Use the destination category; this category cannot be restored.</p>}{category.active && category.activeProductCount > 0 && <p className="text-xs text-zinc-400">Move active items to another category or merge this category before archiving it.</p>}<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={locked || loading || !!categoryError || !!category.mergedInto} onClick={() => open('category-edit', undefined, category)}>Rename {category.name}</button><button type="button" className={button} disabled={locked || loading || !!categoryError || !!category.mergedInto || (category.active && category.activeProductCount > 0)} onClick={() => open('category-active', undefined, category)}>{category.active ? 'Archive' : 'Restore'} {category.name}</button><button type="button" className={button} disabled={locked || loading || !!categoryError || !category.active || !!category.mergedInto || activeCategories.length < 2} onClick={() => open('category-merge', undefined, category)}>Merge {category.name}</button></div></article>)}</section>}
    <ResponsiveDialog isOpen={!!action} title={action ? titles[action] : ''} subtitle={target?.name ?? session.tenant.currency} maxWidth="lg" closeDisabled={locked} onClose={close} footerActions={<><button type="button" className={button} disabled={locked} onClick={close}>Cancel</button>{unknown ? <button type="button" className={button + ' border-blue-600'} disabled={busy || !recovery.ready || unsupportedRecovery} onClick={() => void recover()}>{busy ? 'Checking…' : 'Check change status'}</button> : conflict ? <button type="button" className={button + ' border-blue-600'} disabled={busy} onClick={() => void reloadAfterConflict()}>Discard edits and reload latest data</button> : <button type="submit" form={formId} className={button + ' border-blue-600 bg-blue-600'} disabled={locked || loading}>{busy ? 'Recording…' : submitLabel}</button>}</>}>
      <form id={formId} onSubmit={submit} className="space-y-4">
        <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} />
        {unknown && <p role="status" className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">The original command and values are retained. New changes are blocked until its status is confirmed.</p>}
        {formError && <p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{formError}</p>}
        {productForm ? <><div className="grid min-w-0 gap-3 sm:grid-cols-2">{field('Item name', 'name', { required: true })}{action === 'product-create' ? <>{kindField}{field('SKU', 'sku', { required: true, maxLength: 64 })}{field('Base unit', 'unit', { required: true, maxLength: 24 })}</> : <p className="text-xs leading-5 text-zinc-400">SKU, base unit, item type and currency identify this item and cannot be changed here.</p>}{field(`Selling price (${session.tenant.currency})`, 'price', { required: true, decimal: true, maxLength: 30 })}{field(`Reference cost per unit (${session.tenant.currency})`, 'cost', { decimal: true, maxLength: 30 })}{field('Tax rate (%)', 'tax', { required: action === 'product-edit', decimal: true, maxLength: 6, placeholder: action === 'product-create' ? 'Use configured business default' : undefined })}{field('Barcode', 'barcode', { maxLength: 64 })}{field('Reorder level', 'reorder', { required: true, decimal: true, maxLength: 21 })}<label className="block min-w-0 text-sm">Category<select className={input} disabled={locked || conflict || !!categoryError} value={draft.category} onChange={event => change('category', event.target.value)}><option value="">No category</option>{!currentCategoryKnown && <option value={draft.category}>{draft.category} (current archived category)</option>}{activeCategories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label></div><p className="text-xs leading-5 text-zinc-400">{target?.active===false&&action==='product-edit'?'This item remains archived until restored separately. ':''}Reference cost does not change existing stock value or posted COGS. Stock quantities change through receiving or a reviewed count. Services do not track stock. Stocked goods start with zero stock. Prepared items cannot be sold until recipe consumption is available.</p></> : action === 'product-kind' ? <>{kindField}<p className="text-sm leading-6 text-zinc-300">{unknown ? 'Requested type' : 'Current type'}: {catalogItemKindLabel(target?.itemKind ?? 'STOCKED_GOOD')}. This reviewed change preserves identity and all posted history. The server requires zero recorded quantity and value, no unresolved stock exception and no open count. Correct stock through a reviewed count first when needed.</p><p className="text-sm text-amber-200">Prepared items require recipe consumption and cannot be sold yet. Services have no stock balance or inventory COGS.</p></> : action === 'category-create' || action === 'category-edit' ? <>{field('Category name', 'name', { required: true, maxLength: 80 })}<p className="text-xs leading-5 text-zinc-400">Category labels keep their exact spelling and letter case. Renaming changes the current catalog label and preserves posted receipt evidence.</p></> : action === 'category-merge' ? <><p className="text-sm">Move all current product links from <strong>{target?.name}</strong> to the chosen destination. The source category will be archived as merged and cannot be restored.</p><label className="block text-sm">Destination category<select className={input} required disabled={locked || conflict || !!categoryError} value={draft.targetCategoryId} onChange={event => change('targetCategoryId', event.target.value)}><option value="">Choose an active destination</option>{activeCategories.filter(category => category.id !== target?.id).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><p className="text-xs text-zinc-400">Both category versions are checked. Quantities, carrying values and financial history are preserved.</p></> : <p className="text-sm leading-6">{draft.nextActive ? 'Restore this record for future catalog use.' : action === 'product-active' ? 'Archive this item from future sales and receiving. The server requires zero recorded quantity and value, no unresolved stock exception and no open full count. Historical receipts and movements remain available.' : 'Archive this category after its active items have been reassigned. Historical product links remain available.'}</p>}
        {action !== 'product-create' && action !== 'category-create' && field('Reason for change', 'reason', { required: true, maxLength: 500 })}
      </form>
    </ResponsiveDialog>
  </main>;
}
