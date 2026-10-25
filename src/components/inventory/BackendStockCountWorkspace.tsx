import { actionStatusLabel } from '../../utils/presentation';
import React, { useEffect, useRef, useState } from 'react';
import { Barcode, CircleAlert, ClipboardCheck, PackageSearch, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendInventoryCount, type BackendInventoryCountLine, type BackendInventoryCountSummary, type BackendProduct } from '../../services/apiClient';
import { formatMinorMoney, formatDecimalQuantity } from '../../utils/money';
import { decimalStringsEqual, subtractDecimalStrings } from '../../utils/decimal';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { useCommandRecoveryReadiness } from '../../hooks/useCommandRecoveryReadiness';
import { CommandRecoveryReadiness } from '../common/CommandRecoveryReadiness';
import { HistoryNavigation } from '../common/HistoryNavigation';
import type { HistoryPage } from '../../types/history';

const quantityPattern = /^\d+(?:\.\d{1,6})?$/;

function lineVariance(line: BackendInventoryCountLine): string | null {
  if (line.countedQuantity === null || !quantityPattern.test(line.countedQuantity)) return null;
  return subtractDecimalStrings(line.countedQuantity, line.expectedQuantity);
}

function dateLabel(value: string, timeZone: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone });
}

export function BackendStockCountWorkspace() {
  const session = apiClient.getSession()!;
  const canCount = session.user.permissions.includes('inventory.count');
  const canApprove = session.user.permissions.includes('inventory.count.approve');
  const [count, setCount] = useState<BackendInventoryCount | null>(null);
  const [history, setHistory] = useState<BackendInventoryCountSummary[]>([]);
  const [historyPage, setHistoryPage] = useState<HistoryPage>();
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const historyController = useRef<AbortController | null>(null);
  const historyAttempt = useRef({ more: false, search: '' });
  const [catalog, setCatalog] = useState<BackendProduct[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [areaLabel, setAreaLabel] = useState('');
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unknownId, setUnknownId] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<BackendInventoryCount | null>(null);
  const [lineInputs, setLineInputs] = useState<Map<string, HTMLInputElement>>(new Map());
  const pending = useRef<BackendCommand | null>(null);
  const recovery = useCommandRecoveryReadiness('inventory.count.', command => {
    pending.current = command;
    setUnknownId(command.commandId);
    setNotice('A stock count action needs review. Check its status before editing or trying again.');
  });
  const locked = loading || !dataReady || !recovery.ready || busy || !!unknownId;
  const catalogByProduct = new Map(catalog.map(product => [product.id, product]));

  const loadHistory = async (more = false, search = historyQuery) => {
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    historyAttempt.current = { more, search };
    setHistoryLoading(true); setHistoryError('');
    try {
      const result = await apiClient.listInventoryCounts(controller.signal, { q: search, ...(more && historyPage?.nextCursor ? { after: historyPage.nextCursor } : {}) });
      if (controller.signal.aborted) return;
      setHistory(previous => more ? [...previous, ...result.counts] : result.counts);
      setHistoryPage(result.page);
    } catch (cause) {
      if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : 'Count history could not be loaded.');
    } finally {
      if (!controller.signal.aborted) setHistoryLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setDataReady(false);
    setError('');
    try {
      const [current] = await Promise.all([apiClient.getCurrentInventoryCount(), loadHistory()]);
      setCount(current.count);
      setAreaLabel(current.count?.areaLabel ?? '');
      setDirty(false);
      setDataReady(true);
      setCatalogError('');
      if (canCount || canApprove) {
        try { setCatalog((await apiClient.listCatalog()).items); }
        catch (cause) { setCatalogError(cause instanceof Error ? cause.message : 'Catalog barcode lookup is unavailable.'); }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not load stock counts. Try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); return () => historyController.current?.abort(); }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || recovery.inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    const navigate = (event: Event) => {
      if (recovery.inFlight.current) { event.preventDefault(); setNotice('Wait while this count action is checked. Its original details are needed to confirm the result.'); return; }
      if (dirty && !window.confirm('Leave without saving these count edits? Your last saved draft will remain available.')) event.preventDefault();
    };
    window.addEventListener('beforeunload', unload); window.addEventListener('mazao:before-navigate', navigate);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('mazao:before-navigate', navigate); };
  }, [dirty]);

  const send = async (command: BackendCommand) => {
    if (pending.current || loading || !dataReady || !recovery.begin()) return null;
    pending.current = command;
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.submitCommand(command);
      if (['CONFIRMED', 'REJECTED', 'CONFLICT'].includes(result.status)) {
        pending.current = null;
        setUnknownId('');
        await recovery.inspect();
      } else {
        setUnknownId(command.commandId);
        setNotice('We could not confirm this count action. Check its status before continuing.');
      }
      return result;
    } catch (cause) {
      setUnknownId(command.commandId);
      setNotice(cause instanceof Error ? cause.message : 'We could not confirm this count action. Check its status before trying again.');
      return null;
    } finally {
      recovery.finish();
      setBusy(false);
    }
  };

  const makeCommand = (type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): BackendCommand => ({
    protocolVersion: 1,
    commandId: crypto.randomUUID(),
    tenantId: session.tenant.id,
    deviceId: session.deviceId,
    type,
    occurredAt: new Date().toISOString(),
    expectedVersions,
    payload,
  });

  const openCount = async () => {
    if (!canCount || locked || pending.current) return;
    const result = await send(makeCommand('inventory.count.open', { areaLabel: areaLabel.trim() || undefined }));
    if (!result) return;
    if (result.status === 'CONFIRMED') {
      setNotice('Stock count opened. Starting quantities are saved for the full outlet.');
      await load();
    } else {
      setNotice(result.message ?? `Count could not be opened (${result.status.toLowerCase()}).`);
      if (result.status === 'CONFLICT') await load();
    }
  };

  const updateLine = (productId: string, field: 'countedQuantity' | 'varianceReason', value: string) => {
    setCount(previous => previous ? ({
      ...previous,
      lines: previous.lines.map(line => line.productId === productId
        ? { ...line, [field]: field === 'countedQuantity' ? value : value }
        : line),
    }) : previous);
    setDirty(true);
  };

  const saveDraft = async (): Promise<number | null> => {
    if (!count || !canCount || locked || pending.current) return null;
    for (const line of count.lines) {
      if (line.countedQuantity !== null && line.countedQuantity !== '' && !quantityPattern.test(line.countedQuantity)) {
        setError(`Enter a non-negative quantity with up to six decimal places for ${line.sku}.`);
        return null;
      }
    }
    const command = makeCommand('inventory.count.save', {
      countId: count.id,
      lines: count.lines.map(line => ({ productId: line.productId, countedQuantity: line.countedQuantity || null, varianceReason: line.varianceReason?.trim() || null })),
    }, { [`count:${count.id}`]: count.version });
    const result = await send(command);
    if (result?.status !== 'CONFIRMED') {
      if (result) {
        setNotice(result.message ?? `Draft was not saved (${result.status.toLowerCase()}).`);
        if (result.status === 'CONFLICT') await load();
      }
      return null;
    }
    const version = Number(result.value?.version);
    setCount(previous => previous ? { ...previous, version, countedLineCount: count.lines.filter(line => line.countedQuantity !== null && line.countedQuantity !== '').length } : previous);
    setDirty(false);
    setNotice('Count draft saved.');
    return version;
  };

  const complete = !!count?.lines.length && count.lines.every(line => line.countedQuantity !== null && quantityPattern.test(line.countedQuantity));
  const missingReasons = !!count && count.lines.some(line => {
    const variance = lineVariance(line);
    return variance !== null && !decimalStringsEqual(variance, '0') && !line.varianceReason?.trim();
  });
  const matchingLines = count?.lines.filter(line => {
    const product = catalogByProduct.get(line.productId);
    return `${line.name} ${line.sku} ${product?.barcode ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }) ?? [];
  const visibleLines = count?.lines.filter(line => `${line.name} ${line.sku}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];

  const focusLine = (line: BackendInventoryCountLine) => {
    setQuery('');
    requestAnimationFrame(() => lineInputs.get(line.productId)?.focus());
  };

  const selectScannedLine = () => {
    if (matchingLines.length === 1) focusLine(matchingLines[0]);
  };

  const postCount = async () => {
    if (!count || !canApprove || !complete || missingReasons || locked || pending.current) return;
    let version = count.version;
    if (dirty) {
      const savedVersion = await saveDraft();
      if (savedVersion === null) return;
      version = savedVersion;
    }
    const result = await send(makeCommand('inventory.count.post', { countId: count.id }, { [`count:${count.id}`]: version }));
    if (!result) return;
    if (result.status === 'CONFIRMED') {
      const value = result.value ?? {};
      setNotice(`Count posted: ${Number(value.adjustedLineCount ?? 0)} stock adjustments; gains ${formatMinorMoney(Number(value.gainMinor ?? 0), session.tenant.currency)}, shrinkage ${formatMinorMoney(Number(value.shrinkMinor ?? 0), session.tenant.currency)}.`);
      setReviewOpen(false);
      await load();
    } else {
      setNotice(result.message ?? `Count was not posted (${result.status.toLowerCase()}).`);
      if (result.status === 'CONFLICT') await load();
    }
  };

  const cancelCount = async () => {
    if (!count || !canApprove || locked || pending.current || dirty) return;
    const result = await send(makeCommand('inventory.count.cancel', { countId: count.id }, { [`count:${count.id}`]: count.version }));
    if (!result) return;
    if (result.status === 'CONFIRMED') {
      setCancelOpen(false);
      setNotice('Count cancelled. Its saved lines remain in count history; no stock was changed.');
      await load();
    } else {
      setNotice(result.message ?? `Count could not be cancelled (${result.status.toLowerCase()}).`);
      if (result.status === 'CONFLICT') await load();
    }
  };

  const checkStatus = async () => {
    if (!unknownId || !pending.current || !recovery.begin()) return;
    const original = pending.current;
    setBusy(true);
    try {
      const status = await apiClient.checkCommandStatus(unknownId);
      const response = status.response as { status?: string; value?: Record<string, unknown>; message?: string };
      if (response.status === 'CONFIRMED') {
        pending.current = null;
        setUnknownId('');
        setNotice('Count action completed. The count view was refreshed.');
        await recovery.inspect();
        await load();
      } else if (response.status === 'REJECTED' || response.status === 'CONFLICT') {
        pending.current = null;
        setUnknownId('');
        setNotice(response.message ?? `Count action: ${actionStatusLabel(response.status!)}.`);
        await recovery.inspect();
        await load();
      } else {
        setNotice(`Status: ${actionStatusLabel(status.status)}. Check again shortly.`);
      }
    } catch (cause) {
      try {
        if ((cause as { status?: number }).status !== 404 || !original) throw cause;
        const retry = await apiClient.submitCommand(original);
        if (['CONFIRMED', 'REJECTED', 'CONFLICT'].includes(retry.status)) {
          pending.current = null; setUnknownId('');
          setNotice(retry.status === 'CONFIRMED' ? 'Count action completed.' : retry.message ?? `Count action: ${actionStatusLabel(retry.status)}.`);
          await recovery.inspect(); await load();
        } else setNotice('This count action is still awaiting confirmation. Check again.');
      } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'We could not check this count action. Try again.'); }
    } finally { recovery.finish(); setBusy(false); }
  };

  const openHistoryDetail = async (countId: string) => {
    try {
      const result = await apiClient.getInventoryCount(countId);
      setHistoryDetail(result.count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load count details.');
    }
  };

  const recoveryMessage = unknownId && <div role="alert" className="mb-3 rounded-lg border border-amber-800 p-3 text-sm text-amber-100">{notice}<button type="button" disabled={busy || !recovery.ready} onClick={() => void checkStatus()} className="mt-2 min-h-11 rounded-lg border border-amber-700 px-4 underline">Check status</button></div>;

  return <main className="min-h-full space-y-5 overflow-y-auto p-4 pb-24 text-zinc-100 sm:p-6">
    <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} />
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold tracking-[.18em] text-blue-300">STOCK · {session.outlet.name.toUpperCase()}</p><h1 className="mt-2 text-3xl font-bold">Count stock</h1><p className="mt-2 max-w-2xl text-sm text-zinc-400">Record a full outlet count against a saved stock baseline. A manager reviews and posts all differences together.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading || busy || dirty || !!unknownId} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm disabled:opacity-50"><RefreshCw size={15} /> Refresh</button>
    </header>
    <div className="rounded-xl border border-blue-900/70 bg-blue-950/30 p-3 text-sm text-blue-100"><strong>Stock count:</strong> drafts are kept when you reload. Approval checks for stock changes and records all differences together. The area label is for staff reference; quantities cover the full outlet.</div>
    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200"><CircleAlert size={17} />{error}</div>}
    {notice && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-200"><span>{notice}</span>{unknownId && <button type="button" onClick={() => void checkStatus()} disabled={busy || !recovery.ready} className="min-h-11 font-semibold text-blue-300 underline">Check status</button>}</div>}
    {loading ? <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">Loading saved count…</section> : !count ? <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-7">
      <div className="flex items-start gap-3"><PackageSearch className="mt-1 text-blue-300" /><div><h2 className="text-lg font-semibold">No open outlet count</h2><p className="mt-1 text-sm text-zinc-400">Opening a count saves every active stocked good and its current quantity as the baseline.</p></div></div>
      {canCount ? <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="block flex-1 text-sm text-zinc-300">Area label <span className="text-zinc-500">(optional)</span><input maxLength={100} value={areaLabel} onChange={event => setAreaLabel(event.target.value)} placeholder="e.g. Main store" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white" /></label><button type="button" onClick={() => void openCount()} disabled={locked} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50"><ClipboardCheck size={17} /> Start full count</button></div> : <p className="mt-4 text-sm text-zinc-400">Your role can review counts but cannot open or record one.</p>}
    </section> : <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 p-4 sm:p-5"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">Outlet count in progress</h2><span className="rounded-full bg-amber-950 px-2.5 py-1 text-xs text-amber-200">Draft</span></div><p className="mt-1 text-sm text-zinc-400">{count.areaLabel || 'No area label'} · starting quantities recorded {dateLabel(count.baselineAt, (session.outlet.timeZone ?? session.tenant.timeZone))}</p><p className="mt-1 text-xs text-zinc-500">{count.countedLineCount} of {count.lineCount} items have a saved count.</p></div>{canApprove && <button type="button" onClick={() => setCancelOpen(true)} disabled={locked || dirty} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 disabled:opacity-50">Cancel count</button>}</div>
      <div className="border-b border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <label className="relative block"><Barcode className="absolute left-3 top-3 h-5 w-5 text-blue-300"/><span className="sr-only">Scan barcode or search count items</span><input autoComplete="off" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();selectScannedLine();}}} placeholder="Scan barcode or search item name / SKU" className="min-h-12 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-11 pr-10 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500" aria-controls="count-scan-suggestions" aria-expanded={!!query}/><Search className="absolute right-3 top-3.5 h-4 w-4 text-zinc-500"/></label>
        {query&&<div id="count-scan-suggestions" role="listbox" aria-label="Matching items in this full outlet count" className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950">{matchingLines.length?matchingLines.slice(0,8).map(line=>{const product=catalogByProduct.get(line.productId);return <button key={line.productId} type="button" role="option" aria-selected="false" onClick={()=>focusLine(line)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-zinc-800 px-3 py-2 text-left last:border-0 hover:bg-zinc-900"><span className="min-w-0"><strong className="block truncate text-xs">{line.name}</strong><small className="text-[11px] text-zinc-500">{line.sku}{product?.barcode?` · ${product.barcode}`:''}</small></span><span className="shrink-0 text-right text-[11px] text-zinc-400">Baseline {formatDecimalQuantity(line.expectedQuantity)} {line.unit}<small className="block text-blue-300">Focus count field</small></span></button>; }):<p className="p-3 text-xs text-zinc-400">No item in this saved full-outlet baseline matches that scan. Items cannot be added selectively after the count opens.</p>}</div>}
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-zinc-500"><span>Scan finds items in this full outlet count.</span>{catalogError&&<span role="status" className="text-amber-300">Barcode data unavailable. Search by item name or SKU.</span>}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"><span className="inline-flex items-center gap-2 text-zinc-300"><PackageSearch size={15} className="text-blue-300"/>{count.lines.length} baseline items · {count.countedLineCount} saved counts</span><span className="text-zinc-400">{visibleLines.length} shown · {count.lineCount-visibleLines.length} hidden by search</span></div>
      {visibleLines.length ? <div className="divide-y divide-zinc-800">{visibleLines.map(line => {
        const variance = lineVariance(line);
        const invalid = line.countedQuantity !== null && line.countedQuantity !== '' && !quantityPattern.test(line.countedQuantity);
        const changed = variance !== null && !decimalStringsEqual(variance, '0');
        return <article key={line.productId} className="grid gap-3 p-4 md:grid-cols-[minmax(160px,1fr)_140px_140px_minmax(190px,1fr)] md:items-end">
          <div className="min-w-0"><h3 className="truncate font-semibold">{line.name}</h3><p className="mt-1 text-xs text-zinc-500">{line.sku} · {line.unit} · baseline {formatDecimalQuantity(line.expectedQuantity)}</p></div>
          <label className="block text-xs text-zinc-400">Counted quantity<input ref={element=>{if(element)lineInputs.set(line.productId,element);else lineInputs.delete(line.productId);}} inputMode="decimal" value={line.countedQuantity ?? ''} disabled={!canCount || locked || count.status !== 'OPEN'} onChange={event => updateLine(line.productId, 'countedQuantity', event.target.value)} placeholder="Enter quantity" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white disabled:opacity-50" /></label>
          <div className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${invalid ? 'border-rose-800 text-rose-300' : changed ? 'border-amber-800 text-amber-200' : 'border-zinc-800 text-zinc-400'}`}>{invalid ? 'Invalid quantity' : variance === null ? 'Not counted' : decimalStringsEqual(variance, '0') ? 'Matches baseline' : `${variance.startsWith('-') ? '' : '+'}${formatDecimalQuantity(variance)} ${line.unit}`}</div>
          <label className="block text-xs text-zinc-400">Reason for difference{changed && <span className="text-amber-300"> · required</span>}<input maxLength={200} value={line.varianceReason ?? ''} disabled={!canCount || locked || count.status !== 'OPEN'} onChange={event => updateLine(line.productId, 'varianceReason', event.target.value)} placeholder="Explain damage, loss, or correction" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white disabled:opacity-50" /></label>
        </article>;
      })}</div> : <p className="p-5 text-sm text-zinc-400">No count items match that search.</p>}
      <footer className="flex flex-col gap-3 border-t border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="text-xs text-zinc-400">{dirty ? 'Unsaved changes · save the draft before leaving.' : 'Draft saved.'}{!canApprove && <span className="block mt-1 text-amber-200">A manager must review and post the count.</span>}</div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void saveDraft()} disabled={!canCount || !dirty || locked} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save draft'}</button>{canApprove && <button type="button" onClick={() => setReviewOpen(true)} disabled={!complete || missingReasons || dirty || locked || count.status !== 'OPEN'} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><ShieldCheck size={16} /> Review and post</button>}</div></footer>
    </section>}
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"><div className="border-b border-zinc-800 p-4"><h2 className="font-semibold">Count history</h2><p className="mt-1 text-xs text-zinc-500">Outlet count sessions, newest first</p></div>{historyLoading&&<p role="status" className="p-4 text-sm text-zinc-400">Loading count history...</p>}{historyError&&<p role="alert" className="p-4 text-sm text-rose-300">{historyError}<button type="button" className="ml-3 min-h-11 underline" onClick={()=>void loadHistory(historyAttempt.current.more,historyAttempt.current.search)}>Retry count history</button></p>}{history.length ? <div className="divide-y divide-zinc-800">{history.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><strong className="text-sm">{item.areaLabel || 'Full outlet count'}</strong><span className={`rounded-full px-2 py-1 text-[11px] ${item.status === 'POSTED' ? 'bg-emerald-950 text-emerald-300' : item.status === 'CANCELLED' ? 'bg-zinc-800 text-zinc-400' : 'bg-amber-950 text-amber-200'}`}>{actionStatusLabel(item.status)}</span></div><p className="mt-1 text-xs text-zinc-500">{item.countedLineCount}/{item.lineCount} counted · opened {dateLabel(item.openedAt, (session.outlet.timeZone ?? session.tenant.timeZone))}{item.postedAt ? ` · posted ${dateLabel(item.postedAt, (session.outlet.timeZone ?? session.tenant.timeZone))}` : ''}</p></div><button type="button" onClick={() => void openHistoryDetail(item.id)} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-200">View details</button></div>)}</div> : !historyLoading&&!historyError&&<p className="p-4 text-sm text-zinc-400">No stock counts match this search.</p>}<HistoryNavigation page={historyPage} loaded={history.length} busy={historyLoading} label="count history" onMore={()=>void loadHistory(true)} onSearch={value=>{setHistoryQuery(value);setHistory([]);setHistoryPage(undefined);void loadHistory(false,value);}}/></section>

    {reviewOpen && count && <ResponsiveDialog isOpen={reviewOpen} onClose={() => setReviewOpen(false)} title="Review full stock count" subtitle={`${count.areaLabel || 'Outlet count'} · ${count.lineCount} items`} icon={<ShieldCheck className="h-5 w-5 text-blue-400" />} maxWidth="lg" footerActions={<><button type="button" onClick={() => setReviewOpen(false)} className="min-h-11 rounded-lg px-4 text-zinc-300 hover:bg-zinc-800">Return to count</button><button type="button" onClick={() => void postCount()} disabled={locked || !complete || missingReasons} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">{busy ? 'Posting…' : 'Post reviewed count'}</button></>}>
      {recoveryMessage}<div className="max-h-[50vh] space-y-2 overflow-y-auto">{count.lines.filter(line => {const delta=lineVariance(line);return delta!==null&&!decimalStringsEqual(delta,'0')}).map(line => <div key={line.productId} className="flex flex-wrap justify-between gap-2 rounded-lg border border-zinc-800 p-3 text-sm"><span><strong>{line.name}</strong><small className="mt-1 block text-xs text-zinc-400">Expected {formatDecimalQuantity(line.expectedQuantity)} · counted {line.countedQuantity === null ? null : formatDecimalQuantity(line.countedQuantity)} {line.unit} · {line.varianceReason}</small></span><span className="font-mono text-amber-200">{formatDecimalQuantity(lineVariance(line) ?? '0')}</span></div>)}{!count.lines.some(line=>{const delta=lineVariance(line);return delta!==null&&!decimalStringsEqual(delta,'0')})&&<p className="rounded-lg border border-zinc-800 p-3 text-sm text-zinc-300">All counted quantities match the saved baseline. Posting will close the count without creating stock adjustments.</p>}</div>
      <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100">If stock changes during the count, approval stops and keeps this draft for manager review. Differences use the stock value recorded when this count started.</div>
    </ResponsiveDialog>}

    {cancelOpen && count && <ResponsiveDialog isOpen={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this count?" subtitle="No stock will change; the count will remain in history." icon={<CircleAlert className="h-5 w-5 text-amber-300" />} maxWidth="md" footerActions={<><button type="button" onClick={() => setCancelOpen(false)} className="min-h-11 rounded-lg px-4 text-zinc-300">Keep count</button><button type="button" onClick={() => void cancelCount()} disabled={locked || dirty} className="min-h-11 rounded-lg bg-rose-700 px-4 font-semibold text-white disabled:opacity-50">Cancel count</button></>} >{recoveryMessage}<p className="text-sm text-zinc-300">The saved baseline and entered quantities will be retained as cancelled evidence. Start a new count to capture a fresh stock baseline.</p></ResponsiveDialog>}

    {historyDetail && <ResponsiveDialog isOpen={!!historyDetail} onClose={() => setHistoryDetail(null)} title="Stock count details" subtitle={`${historyDetail.areaLabel || 'Full outlet count'} · ${actionStatusLabel(historyDetail.status)}`} icon={<ClipboardCheck className="h-5 w-5 text-blue-400" />} maxWidth="lg" footerActions={<button type="button" onClick={() => setHistoryDetail(null)} className="min-h-11 rounded-lg px-4 text-zinc-300">Close</button>}><div className="max-h-[55vh] divide-y divide-zinc-800 overflow-y-auto">{historyDetail.lines.map(line => {const variance=lineVariance(line);return <div key={line.productId} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><span className="text-sm font-semibold">{line.name}<small className="mt-1 block text-xs font-normal text-zinc-500">{line.sku} · baseline {formatDecimalQuantity(line.expectedQuantity)} · counted {line.countedQuantity === null ? '—' : formatDecimalQuantity(line.countedQuantity)} {line.unit}</small>{line.varianceReason&&<small className="mt-1 block text-xs font-normal text-zinc-400">Reason: {line.varianceReason}</small>}</span><span className="font-mono text-sm">{variance === null ? 'Not counted' : `${variance.startsWith('-') ? '' : '+'}${formatDecimalQuantity(variance)} ${line.unit}`}</span></div>})}</div></ResponsiveDialog>}
  </main>;
}
