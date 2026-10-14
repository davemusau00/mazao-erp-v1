import React, { useEffect, useRef, useState } from 'react';
import { CircleAlert, ClipboardCheck, PackageSearch, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendInventoryCount, type BackendInventoryCountLine, type BackendInventoryCountSummary } from '../../services/apiClient';
import { formatMinorMoney } from '../../utils/money';
import { decimalStringsEqual, subtractDecimalStrings } from '../../utils/decimal';
import { ResponsiveDialog } from '../common/ResponsiveDialog';

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
  const [areaLabel, setAreaLabel] = useState('');
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unknownId, setUnknownId] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<BackendInventoryCount | null>(null);
  const pending = useRef<BackendCommand | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [current, previous] = await Promise.all([apiClient.getCurrentInventoryCount(), apiClient.listInventoryCounts()]);
      setCount(current.count);
      setHistory(previous.counts);
      setAreaLabel(current.count?.areaLabel ?? '');
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load server stock counts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    let active = true;
    void apiClient.listRecoverableCommands(session.tenant.id).then(records => {
      const record = [...records].reverse().find(item => item.command.type.startsWith('inventory.count.'));
      if (!active || !record) return;
      pending.current = record.command;
      setUnknownId(record.command.commandId);
      setNotice('An unresolved count command was restored. Check its server status before editing or submitting another action.');
    }).catch(() => undefined);
    return () => { active = false; };
  }, [session.tenant.id]);

  const send = async (command: BackendCommand) => {
    pending.current = command;
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.submitCommand(command);
      if (['CONFIRMED', 'REJECTED', 'CONFLICT'].includes(result.status)) {
        pending.current = null;
        setUnknownId('');
      }
      return result;
    } catch (cause) {
      setUnknownId(command.commandId);
      setNotice(cause instanceof Error ? cause.message : 'The server outcome is unknown. Check this command before retrying.');
      return null;
    } finally {
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
    if (!canCount) return;
    const result = await send(makeCommand('inventory.count.open', { areaLabel: areaLabel.trim() || undefined }));
    if (!result) return;
    if (result.status === 'CONFIRMED') {
      setNotice('Server opened the full outlet count and saved its stock baseline.');
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
    if (!count || !canCount || unknownId) return null;
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
    setNotice('Count draft is saved on the server.');
    return version;
  };

  const complete = !!count?.lines.length && count.lines.every(line => line.countedQuantity !== null && quantityPattern.test(line.countedQuantity));
  const missingReasons = !!count && count.lines.some(line => {
    const variance = lineVariance(line);
    return variance !== null && !decimalStringsEqual(variance, '0') && !line.varianceReason?.trim();
  });
  const visibleLines = count?.lines.filter(line => `${line.name} ${line.sku}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];

  const postCount = async () => {
    if (!count || !canApprove || !complete || missingReasons || unknownId) return;
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
    if (!count || !canApprove || unknownId || dirty) return;
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
    if (!unknownId) return;
    try {
      const status = await apiClient.checkCommandStatus(unknownId);
      const response = status.response as { status?: string; value?: Record<string, unknown>; message?: string };
      if (response.status === 'CONFIRMED') {
        pending.current = null;
        setUnknownId('');
        setNotice('Server confirmed the count command. The count view was refreshed.');
        await load();
      } else if (response.status === 'REJECTED' || response.status === 'CONFLICT') {
        pending.current = null;
        setUnknownId('');
        setNotice(response.message ?? `Count command ${response.status.toLowerCase()}.`);
        await load();
      } else {
        setNotice(`Command status is ${status.status}. Check again shortly.`);
      }
    } catch (cause) {
      if ((cause as { status?: number }).status === 404 && pending.current) {
        const retry = await send(pending.current);
        if (retry?.status === 'CONFIRMED') await load();
        return;
      }
      setNotice(cause instanceof Error ? cause.message : 'Could not check the count command status.');
    }
  };

  const openHistoryDetail = async (countId: string) => {
    try {
      const result = await apiClient.getInventoryCount(countId);
      setHistoryDetail(result.count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load count details.');
    }
  };

  return <main className="min-h-full space-y-5 overflow-y-auto p-4 pb-24 text-zinc-100 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold tracking-[.18em] text-blue-300">SERVER INVENTORY · {session.outlet.name.toUpperCase()}</p><h1 className="mt-2 text-3xl font-bold">Count stock</h1><p className="mt-2 max-w-2xl text-sm text-zinc-400">Record a full outlet count against a saved stock baseline. A manager reviews and posts all differences together.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading || busy || dirty || !!unknownId} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm disabled:opacity-50"><RefreshCw size={15} /> Refresh</button>
    </header>
    <div className="rounded-xl border border-blue-900/70 bg-blue-950/30 p-3 text-sm text-blue-100"><strong>Server count:</strong> drafts persist across reloads. Posting checks every saved balance revision and applies all variances atomically. The optional area label is for staff reference; stock is not yet split across locations.</div>
    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200"><CircleAlert size={17} />{error}</div>}
    {notice && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-200"><span>{notice}</span>{unknownId && <button type="button" onClick={() => void checkStatus()} className="font-semibold text-blue-300 underline">Check command status</button>}</div>}
    {loading ? <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">Loading saved count…</section> : !count ? <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-7">
      <div className="flex items-start gap-3"><PackageSearch className="mt-1 text-blue-300" /><div><h2 className="text-lg font-semibold">No open outlet count</h2><p className="mt-1 text-sm text-zinc-400">Opening a count saves every active catalogue item and its current quantity as the baseline.</p></div></div>
      {canCount ? <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="block flex-1 text-sm text-zinc-300">Area label <span className="text-zinc-500">(optional)</span><input maxLength={100} value={areaLabel} onChange={event => setAreaLabel(event.target.value)} placeholder="e.g. Main store" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white" /></label><button type="button" onClick={() => void openCount()} disabled={busy || !!unknownId} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50"><ClipboardCheck size={17} /> Start full count</button></div> : <p className="mt-4 text-sm text-zinc-400">Your role can review counts but cannot open or record one.</p>}
    </section> : <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 p-4 sm:p-5"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">Outlet count in progress</h2><span className="rounded-full bg-amber-950 px-2.5 py-1 text-xs text-amber-200">Draft · v{count.version}</span></div><p className="mt-1 text-sm text-zinc-400">{count.areaLabel || 'No area label'} · opened by {count.openedBy} · baseline {dateLabel(count.baselineAt, (session.outlet.timeZone ?? session.tenant.timeZone))}</p><p className="mt-1 text-xs text-zinc-500">{count.countedLineCount} of {count.lineCount} items have a saved count.</p></div>{canApprove && <button type="button" onClick={() => setCancelOpen(true)} disabled={busy || !!unknownId || dirty} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 disabled:opacity-50">Cancel count</button>}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4"><label className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" /><span className="sr-only">Search count items</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by item name or SKU" className="min-h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-3 text-sm text-white" /></label><span className="text-xs text-zinc-400">Server barcode lookup is not available yet.</span></div>
      {visibleLines.length ? <div className="divide-y divide-zinc-800">{visibleLines.map(line => {
        const variance = lineVariance(line);
        const invalid = line.countedQuantity !== null && line.countedQuantity !== '' && !quantityPattern.test(line.countedQuantity);
        const changed = variance !== null && !decimalStringsEqual(variance, '0');
        return <article key={line.productId} className="grid gap-3 p-4 md:grid-cols-[minmax(160px,1fr)_140px_140px_minmax(190px,1fr)] md:items-end">
          <div className="min-w-0"><h3 className="truncate font-semibold">{line.name}</h3><p className="mt-1 text-xs text-zinc-500">{line.sku} · {line.unit} · baseline {line.expectedQuantity}</p></div>
          <label className="block text-xs text-zinc-400">Counted quantity<input inputMode="decimal" value={line.countedQuantity ?? ''} disabled={!canCount || busy || !!unknownId || count.status !== 'OPEN'} onChange={event => updateLine(line.productId, 'countedQuantity', event.target.value)} placeholder="Scan then count" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white disabled:opacity-50" /></label>
          <div className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${invalid ? 'border-rose-800 text-rose-300' : changed ? 'border-amber-800 text-amber-200' : 'border-zinc-800 text-zinc-400'}`}>{invalid ? 'Invalid quantity' : variance === null ? 'Not counted' : decimalStringsEqual(variance, '0') ? 'Matches baseline' : `${variance.startsWith('-') ? '' : '+'}${variance} ${line.unit}`}</div>
          <label className="block text-xs text-zinc-400">Reason for difference{changed && <span className="text-amber-300"> · required</span>}<input maxLength={200} value={line.varianceReason ?? ''} disabled={!canCount || busy || !!unknownId || count.status !== 'OPEN'} onChange={event => updateLine(line.productId, 'varianceReason', event.target.value)} placeholder="Explain damage, loss, or correction" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white disabled:opacity-50" /></label>
        </article>;
      })}</div> : <p className="p-5 text-sm text-zinc-400">No count items match that search.</p>}
      <footer className="flex flex-col gap-3 border-t border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="text-xs text-zinc-400">{dirty ? 'Unsaved changes · save the draft before leaving.' : 'Server draft saved.'}{!canApprove && <span className="block mt-1 text-amber-200">A manager must review and post the count.</span>}</div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void saveDraft()} disabled={!canCount || !dirty || busy || !!unknownId} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save draft'}</button>{canApprove && <button type="button" onClick={() => setReviewOpen(true)} disabled={!complete || missingReasons || dirty || busy || !!unknownId || count.status !== 'OPEN'} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><ShieldCheck size={16} /> Review and post</button>}</div></footer>
    </section>}
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"><div className="border-b border-zinc-800 p-4"><h2 className="font-semibold">Count history</h2><p className="mt-1 text-xs text-zinc-500">Latest 50 outlet count sessions</p></div>{history.length ? <div className="divide-y divide-zinc-800">{history.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><strong className="text-sm">{item.areaLabel || 'Full outlet count'}</strong><span className={`rounded-full px-2 py-1 text-[11px] ${item.status === 'POSTED' ? 'bg-emerald-950 text-emerald-300' : item.status === 'CANCELLED' ? 'bg-zinc-800 text-zinc-400' : 'bg-amber-950 text-amber-200'}`}>{item.status.toLowerCase()}</span></div><p className="mt-1 text-xs text-zinc-500">{item.countedLineCount}/{item.lineCount} counted · opened {dateLabel(item.openedAt, (session.outlet.timeZone ?? session.tenant.timeZone))}{item.postedAt ? ` · posted ${dateLabel(item.postedAt, (session.outlet.timeZone ?? session.tenant.timeZone))}` : ''}</p></div><button type="button" onClick={() => void openHistoryDetail(item.id)} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-200">View details</button></div>)}</div> : <p className="p-4 text-sm text-zinc-400">No stock counts have been recorded.</p>}</section>

    {reviewOpen && count && <ResponsiveDialog isOpen={reviewOpen} onClose={() => setReviewOpen(false)} title="Review full stock count" subtitle={`${count.areaLabel || 'Outlet count'} · ${count.lineCount} items`} icon={<ShieldCheck className="h-5 w-5 text-blue-400" />} maxWidth="lg" footerActions={<><button type="button" onClick={() => setReviewOpen(false)} className="min-h-11 rounded-lg px-4 text-zinc-300 hover:bg-zinc-800">Return to count</button><button type="button" onClick={() => void postCount()} disabled={busy || !!unknownId || !complete || missingReasons} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">{busy ? 'Posting…' : 'Post reviewed count'}</button></>}>
      <div className="max-h-[50vh] space-y-2 overflow-y-auto">{count.lines.filter(line => {const delta=lineVariance(line);return delta!==null&&!decimalStringsEqual(delta,'0')}).map(line => <div key={line.productId} className="flex flex-wrap justify-between gap-2 rounded-lg border border-zinc-800 p-3 text-sm"><span><strong>{line.name}</strong><small className="mt-1 block text-xs text-zinc-400">Expected {line.expectedQuantity} · counted {line.countedQuantity} {line.unit} · {line.varianceReason}</small></span><span className="font-mono text-amber-200">{lineVariance(line)}</span></div>)}{!count.lines.some(line=>{const delta=lineVariance(line);return delta!==null&&!decimalStringsEqual(delta,'0')})&&<p className="rounded-lg border border-zinc-800 p-3 text-sm text-zinc-300">All counted quantities match the saved baseline. Posting will close the count without creating stock adjustments.</p>}</div>
      <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100">Posting checks all saved balance versions. If stock changed during the count, the server rejects posting and leaves this draft intact for manager review. Variance values use the unit cost captured at count start; the broader inventory valuation policy is still pending.</div>
    </ResponsiveDialog>}

    {cancelOpen && count && <ResponsiveDialog isOpen={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this count?" subtitle="No stock will change; the count will remain in history." icon={<CircleAlert className="h-5 w-5 text-amber-300" />} maxWidth="md" footerActions={<><button type="button" onClick={() => setCancelOpen(false)} className="min-h-11 rounded-lg px-4 text-zinc-300">Keep count</button><button type="button" onClick={() => void cancelCount()} disabled={busy || !!unknownId || dirty} className="min-h-11 rounded-lg bg-rose-700 px-4 font-semibold text-white disabled:opacity-50">Cancel count</button></>}><p className="text-sm text-zinc-300">The saved baseline and entered quantities will be retained as cancelled evidence. Start a new count to capture a fresh stock baseline.</p></ResponsiveDialog>}

    {historyDetail && <ResponsiveDialog isOpen={!!historyDetail} onClose={() => setHistoryDetail(null)} title="Stock count details" subtitle={`${historyDetail.areaLabel || 'Full outlet count'} · ${historyDetail.status.toLowerCase()}`} icon={<ClipboardCheck className="h-5 w-5 text-blue-400" />} maxWidth="lg" footerActions={<button type="button" onClick={() => setHistoryDetail(null)} className="min-h-11 rounded-lg px-4 text-zinc-300">Close</button>}><div className="max-h-[55vh] divide-y divide-zinc-800 overflow-y-auto">{historyDetail.lines.map(line => {const variance=lineVariance(line);return <div key={line.productId} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><span className="text-sm font-semibold">{line.name}<small className="mt-1 block text-xs font-normal text-zinc-500">{line.sku} · baseline {line.expectedQuantity} · counted {line.countedQuantity ?? '—'} {line.unit}</small>{line.varianceReason&&<small className="mt-1 block text-xs font-normal text-zinc-400">Reason: {line.varianceReason}</small>}</span><span className="font-mono text-sm">{variance === null ? 'Not counted' : `${variance.startsWith('-') ? '' : '+'}${variance} ${line.unit}`}</span></div>})}</div></ResponsiveDialog>}
  </main>;
}
