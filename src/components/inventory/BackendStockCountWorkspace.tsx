import { actionStatusLabel } from '../../utils/presentation';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Barcode, CircleAlert, ClipboardCheck, PackageSearch, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendInventoryCount, type BackendInventoryCountLine, type BackendInventoryCountSummary, type BackendProduct } from '../../services/apiClient';
import { formatMinorMoney, formatDecimalQuantity } from '../../utils/money';
import { decimalStringsEqual, subtractDecimalStrings } from '../../utils/decimal';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { useCommandRecoveryReadiness } from '../../hooks/useCommandRecoveryReadiness';
import { CountDraftConflictError, countDraftStore, type LocalCountDraft } from '../../services/countDraftStore';
import { CommandRecoveryReadiness } from '../common/CommandRecoveryReadiness';
import { HistoryNavigation } from '../common/HistoryNavigation';
import type { HistoryPage } from '../../types/history';
import type { CountReview } from '../../types/countRecovery';
const CountChangesReviewDialog=lazy(()=>import('./CountChangesReviewDialog').then(module=>({default:module.CountChangesReviewDialog})));
const CountEvidenceHistoryChunk=lazy(()=>import('./CountEvidenceHistory').then(module=>({default:module.CountEvidenceHistory})));

function CountEvidenceHistory(props:{countId:string;currency:string;timeZone:string}){
  return <Suspense fallback={<p role="status" className="mt-4 text-xs text-zinc-400">Loading count evidence history…</p>}><CountEvidenceHistoryChunk {...props}/></Suspense>;
}

const quantityPattern = /^\d+(?:\.\d{1,6})?$/;

function lineVariance(line: BackendInventoryCountLine): string | null {
  if (line.expectedQuantity === null || line.countedQuantity === null || !quantityPattern.test(line.countedQuantity)) return null;
  return subtractDecimalStrings(line.countedQuantity, line.expectedQuantity);
}

interface CountGainEstimate {
  line: BackendInventoryCountLine;
  unitCostMinor: string | null;
  valueMinor: string | null;
}
function zeroBaselineGainEstimate(line: BackendInventoryCountLine): CountGainEstimate | null {
  if (line.expectedQuantity === null || !decimalStringsEqual(line.expectedQuantity, '0') || !line.countedQuantity || !quantityPattern.test(line.countedQuantity)) return null;
  const [whole, fraction = ''] = line.countedQuantity.split('.');
  const quantityMicros = BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
  if (quantityMicros <= 0n) return null;
  if (!line.referenceCostMinor || !/^\d+$/.test(line.referenceCostMinor)) return { line, unitCostMinor: null, valueMinor: null };
  const unitCostMinor = BigInt(line.referenceCostMinor);
  if (unitCostMinor > BigInt(Number.MAX_SAFE_INTEGER)) return { line, unitCostMinor: line.referenceCostMinor, valueMinor: null };
  const valueMinor = (unitCostMinor * quantityMicros + 500_000n) / 1_000_000n;
  if (valueMinor > BigInt(Number.MAX_SAFE_INTEGER)) return { line, unitCostMinor: line.referenceCostMinor, valueMinor: null };
  return { line, unitCostMinor: line.referenceCostMinor, valueMinor: valueMinor.toString() };
}

function dateLabel(value: string, timeZone: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone });
}

export function BackendStockCountWorkspace({ onOpenCatalog }: { onOpenCatalog?: (barcode: string) => void } = {}) {
  const session = apiClient.getSession()!;
  const countDraftScope = { tenantId: session.tenant.id, actorId: session.user.id, outletId: session.outlet.id, countId: '' };
  const canCount = session.user.permissions.includes('inventory.count');
  const canApprove = session.user.permissions.includes('inventory.count.approve');
  const canManageCatalog = session.user.permissions.includes('catalog.manage');
  const canReadCost = session.user.permissions.includes('catalog.manage') || session.user.permissions.includes('finance.view');
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
  const [countScope, setCountScope] = useState<'FULL'|'SELECTED'>('FULL');
  const [blindCount, setBlindCount] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectionQuery, setSelectionQuery] = useState('');
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unknownId, setUnknownId] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [valuationAcknowledged, setValuationAcknowledged] = useState(false);
  const [valuationReason, setValuationReason] = useState('');
  const [changesOpen, setChangesOpen] = useState(false);
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const [draftVersionConflict, setDraftVersionConflict] = useState(false);
  const [localDraftStatus, setLocalDraftStatus] = useState<'none'|'checking'|'saving'|'saved'|'failed'|'conflict'|'stale'>('none');
  const [localDraftError, setLocalDraftError] = useState('');
  const [recoveredDraft, setRecoveredDraft] = useState<LocalCountDraft | null>(null);
  const [staleDraftOpen, setStaleDraftOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<BackendInventoryCount | null>(null);
  const [lineInputs, setLineInputs] = useState<Map<string, HTMLInputElement>>(new Map());
  const reasonInputs = useRef(new Map<string, HTMLInputElement>());
  const pending = useRef<BackendCommand | null>(null);
  const localDraftRevision = useRef<number | null>(null);
  const localDraftWrite = useRef<Promise<LocalCountDraft | null>>(Promise.resolve(null));
  const localDraftWriteSequence = useRef(0);
  const localDraftStatusRef = useRef(localDraftStatus);
  const focusAfterLoad = useRef<string | null>(null);
  const recovery = useCommandRecoveryReadiness('inventory.count.', command => {
    pending.current = command;
    setUnknownId(command.commandId);
    setNotice('A stock count action needs review. Check its status before editing or trying again.');
    if (command.type === 'inventory.count.review') setChangesOpen(true);
  });
  const locked = loading || !dataReady || !recovery.ready || busy || !!unknownId || localDraftStatus === 'conflict' || localDraftStatus === 'stale';
  const catalogByProduct = new Map(catalog.map(product => [product.id, product]));
  const selectableProducts = catalog.filter(product => product.active && product.itemKind === 'STOCKED_GOOD' && product.stockTracked);
  const matchingSelectableProducts = selectableProducts.filter(product => `${product.name} ${product.sku} ${product.barcode ?? ''}`.toLocaleLowerCase().includes(selectionQuery.trim().toLocaleLowerCase()));

  const setLocalStatus = (status: typeof localDraftStatus) => { localDraftStatusRef.current = status; setLocalDraftStatus(status); };
  const scopeForCount = (countId: string) => ({ ...countDraftScope, countId });
  const queueLocalDraftSave = (snapshot: BackendInventoryCount): Promise<LocalCountDraft | null> => {
    const sequence = ++localDraftWriteSequence.current;
    const scope = scopeForCount(snapshot.id);
    const lines = snapshot.lines.map(line => ({ productId: line.productId, countedQuantity: line.countedQuantity, varianceReason: line.varianceReason }));
    setLocalStatus('saving'); setLocalDraftError('');
    const write = localDraftWrite.current.catch(() => null).then(() => countDraftStore.save(scope, snapshot.version, lines, localDraftRevision.current));
    localDraftWrite.current = write.then(record => {
      localDraftRevision.current = record.revision;
      if (sequence === localDraftWriteSequence.current) setLocalStatus('saved');
      return record;
    }).catch(cause => {
      if (sequence === localDraftWriteSequence.current) {
        if (cause instanceof CountDraftConflictError) {
          setLocalStatus('conflict');
        } else {
          setLocalDraftError(cause instanceof Error ? `Unsent edits are not durably saved on this device. ${cause.message}` : 'Unsent edits are not durably saved on this device.');
          setLocalStatus('failed');
        }
      }
      return null;
    });
    return localDraftWrite.current;
  };

  const clearLocalDraft = async (countId: string): Promise<boolean> => {
    await localDraftWrite.current;
    try {
      await countDraftStore.remove(scopeForCount(countId), localDraftRevision.current);
      localDraftRevision.current = null;
      setRecoveredDraft(null); setStaleDraftOpen(false); setLocalDraftError(''); setLocalStatus('none');
      return true;
    } catch (cause) {
      if (cause instanceof CountDraftConflictError) {
        setLocalStatus('conflict');
      } else {
        setLocalDraftError(cause instanceof Error ? cause.message : 'The local count recovery copy could not be cleared.');
        setLocalStatus('failed');
      }
      return false;
    }
  };

  const applyLocalDraft = (record: LocalCountDraft, target = count): boolean => {
    if (!target || record.countId !== target.id) return false;
    const values = new Map(record.lines.map(line => [line.productId, line]));
    if (record.lines.length !== target.lines.length || target.lines.some(line => !values.has(line.productId))) return false;
    const restored: BackendInventoryCount = { ...target, lines: target.lines.map(line => {
      const local = values.get(line.productId)!;
      return { ...line, countedQuantity: local.countedQuantity, varianceReason: local.varianceReason };
    }) };
    localDraftRevision.current = record.revision;
    setCount(restored); setDirty(true); setRecoveredDraft(null); setStaleDraftOpen(false); setLocalDraftError(''); setLocalStatus('saved');
    return true;
  };

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
      let loadedCount = current.count;
      let restoredLocalDraft = false;
      setRecoveredDraft(null); setStaleDraftOpen(false);
      localDraftRevision.current = null;
      if (loadedCount) {
        setLocalStatus('checking');
        try {
          const local = await countDraftStore.get(scopeForCount(loadedCount.id));
          if (local) {
            localDraftRevision.current = local.revision;
            const sameLines = local.lines.length === loadedCount.lines.length && loadedCount.lines.every(line => local.lines.some(saved => saved.productId === line.productId));
            if (local.countVersion === loadedCount.version && sameLines) {
              const values = new Map(local.lines.map(line => [line.productId, line]));
              loadedCount = { ...loadedCount, lines: loadedCount.lines.map(line => ({ ...line, countedQuantity: values.get(line.productId)!.countedQuantity, varianceReason: values.get(line.productId)!.varianceReason })) };
              restoredLocalDraft = true; setLocalStatus('saved'); setNotice('Unsent count edits were restored from this device. Save the draft to the server when ready.');
            } else {
              setRecoveredDraft(local); setLocalStatus('stale'); setStaleDraftOpen(true);
            }
          } else setLocalStatus('none');
        } catch (cause) {
          setLocalDraftError(cause instanceof Error ? cause.message : 'Local count recovery could not be read.'); setLocalStatus('failed');
        }
      } else setLocalStatus('none');
      setCount(loadedCount);
      setAreaLabel(current.count?.areaLabel ?? '');
      setDirty(restoredLocalDraft);
      setDraftVersionConflict(false);
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
    const productId = focusAfterLoad.current;
    if (loading || !productId || !count?.lines.some(line => line.productId === productId)) return;
    if(query){setQuery('');return;}
    focusAfterLoad.current = null;
    const focusFrame = requestAnimationFrame(() => {
      const target = lineInputs.get(productId);
      const active = document.activeElement;
      // Let a counter finish typing if the refreshed count renders before this
      // queued focus; the review's requested focus is only a default.
      if (active instanceof HTMLInputElement && active !== target) return;
      target?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [count, loading, query]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if ((dirty && localDraftStatusRef.current !== 'saved') || recovery.inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    const navigate = (event: Event) => {
      if (recovery.inFlight.current) { event.preventDefault(); setNotice('Wait while this count action is checked. Its original details are needed to confirm the result.'); return; }
      if (dirty && localDraftStatusRef.current === 'saving') { event.preventDefault(); setNotice('Wait for this device to finish saving your unsent count edits before leaving.'); return; }
      if (dirty && localDraftStatusRef.current !== 'saved' && !window.confirm('These edits are not safely saved on this device. Leave and risk losing them?')) event.preventDefault();
      else if (dirty && localDraftStatusRef.current === 'saved' && !window.confirm('Leave with these edits saved only on this device? They are not yet saved to the server.')) event.preventDefault();
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
    if (!canCount || locked || pending.current || countScope === 'SELECTED' && !selectedItemIds.length) return;
    const result = await send(makeCommand('inventory.count.open', {
      areaLabel: areaLabel.trim() || undefined,
      scope: countScope,
      ...(countScope === 'SELECTED' ? { productIds: selectedItemIds } : {}),
      blind: blindCount,
    }));
    if (!result) return;
    if (result.status === 'CONFIRMED') {
      setNotice(`Stock count opened for ${countScope === 'FULL' ? 'all active stocked goods' : `${selectedItemIds.length} selected item${selectedItemIds.length === 1 ? '' : 's'}`}${blindCount ? ' in blind mode' : ''}. The saved baseline is fixed.`);
      await load();
    } else {
      setNotice(result.message ?? `Count could not be opened (${result.status.toLowerCase()}).`);
      if (result.status === 'CONFLICT') await load();
    }
  };

  const updateLine = (productId: string, field: 'countedQuantity' | 'varianceReason', value: string) => {
    if (!count) return;
    const next: BackendInventoryCount = {
      ...count,
      lines: count.lines.map(line => line.productId === productId ? { ...line, [field]: value } : line),
    };
    setCount(next);
    setDirty(true);
    void queueLocalDraftSave(next);
  };

  const saveDraft = async (): Promise<number | null> => {
    if (!count || !canCount || locked || pending.current) return null;
    await localDraftWrite.current;
    if (localDraftStatusRef.current === 'conflict' || localDraftStatusRef.current === 'stale') return null;
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
        if (result.status === 'CONFLICT') {setDraftVersionConflict(true);setReviewRefresh(value=>value+1);}
      }
      return null;
    }
    await clearLocalDraft(count.id);
    const version = Number(result.value?.version);
    setCount(previous => previous ? { ...previous, version, countedLineCount: count.lines.filter(line => line.countedQuantity !== null && line.countedQuantity !== '').length,
      lines:previous.lines.map(line=>({...line,requiresRecount:line.countedQuantity===null||line.countedQuantity===''?line.requiresRecount:false,countedRevision:line.countedQuantity===null||line.countedQuantity===''?null:line.baselineRevision??line.countedRevision})) } : previous);
    setDirty(false);
    setDraftVersionConflict(false);
    setNotice('Count draft saved.');
    return version;
  };

  const complete = !!count?.lines.length && count.coverage !== 'LEGACY_CHECKPOINT' && count.lines.every(line => !line.requiresRecount && line.countedQuantity !== null && quantityPattern.test(line.countedQuantity));
  const missingQuantityLines = count?.lines.filter(line => line.requiresRecount || line.countedQuantity === null || line.countedQuantity === '') ?? [];
  const invalidQuantityLines = count?.lines.filter(line => line.countedQuantity !== null && line.countedQuantity !== '' && !quantityPattern.test(line.countedQuantity)) ?? [];
  const missingReasonLines = count?.lines.filter(line => {
    const variance = lineVariance(line);
    return line.countedQuantity !== null && line.countedQuantity !== '' && quantityPattern.test(line.countedQuantity)
      && variance !== null && !decimalStringsEqual(variance, '0') && !line.varianceReason?.trim();
  }) ?? [];
  const missingReasons = missingReasonLines.length > 0;
  const valuationEstimates = count?.lines.flatMap(line => {
    const estimate = zeroBaselineGainEstimate(line);
    return estimate ? [estimate] : [];
  }) ?? [];
  const valuationReviewRequired = valuationEstimates.length > 0;
  const valuationEstimatesValid = valuationEstimates.every(estimate => estimate.unitCostMinor !== null && estimate.valueMinor !== null);
  const valuationReviewReady = !valuationReviewRequired || (canReadCost && valuationEstimatesValid && valuationAcknowledged && valuationReason.trim().length > 0);
  const matchingLines = count?.lines.filter(line => {
    const product = catalogByProduct.get(line.productId);
    return `${line.name} ${line.sku} ${product?.barcode ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }) ?? [];
  const matchingCatalogProducts = catalog.filter(product => `${product.name} ${product.sku} ${product.barcode ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visibleLines = count?.lines.filter(line => `${line.name} ${line.sku}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];

  const focusLine = (line: BackendInventoryCountLine) => {
    setQuery('');
    requestAnimationFrame(() => lineInputs.get(line.productId)?.focus());
  };

  const focusReason = (line: BackendInventoryCountLine) => {
    setQuery('');
    requestAnimationFrame(() => reasonInputs.current.get(line.productId)?.focus());
  };

  const selectScannedLine = () => {
    if (matchingLines.length === 1) focusLine(matchingLines[0]);
  };

  const postCount = async () => {
    if (!count || !canApprove || !complete || missingReasons || !valuationReviewReady || locked || pending.current) return;
    let version = count.version;
    if (dirty) {
      const savedVersion = await saveDraft();
      if (savedVersion === null) return;
      version = savedVersion;
    }
    const result = await send(makeCommand('inventory.count.post', { countId: count.id, ...(valuationReviewRequired ? { valuationReason: valuationReason.trim() } : {}) }, { [`count:${count.id}`]: version }));
    if (!result) return;
    if (result.status === 'CONFIRMED') {
      const value = result.value ?? {};
      setNotice(`Count posted: ${Number(value.adjustedLineCount ?? 0)} stock adjustments; gains ${formatMinorMoney(Number(value.gainMinor ?? 0), session.tenant.currency)}, shrinkage ${formatMinorMoney(Number(value.shrinkMinor ?? 0), session.tenant.currency)}.`);
      setReviewOpen(false);
      setValuationAcknowledged(false);
      setValuationReason('');
      await clearLocalDraft(count.id);
      await load();
    } else {
      setNotice(result.message ?? `Count was not posted (${result.status.toLowerCase()}).`);
      if (result.status === 'CONFLICT') { setReviewOpen(false); setValuationAcknowledged(false); setValuationReason(''); setChangesOpen(true); setReviewRefresh(value=>value+1); }
    }
  };

  const reviewChangedItems = async (review: CountReview, reason: string) => {
    if (!count || !canApprove || locked || pending.current) return;
    if (dirty) { setNotice('Save the unsent count entries before accepting a new baseline.'); return; }
    if (review.countId !== count.id || review.countVersion !== count.version) {
      setDraftVersionConflict(true); setNotice('The saved draft changed. Your local entries remain available until you choose to replace them.'); return;
    }
    if (!review.canReview || !review.changedLines.length || review.changedLines.some(line=>!line.reviewable||line.current.balanceVersion===null)) return;
    const affectedProductIds=review.changedLines.map(line=>line.productId);
    const expectedVersions:Record<string,number>={[`count:${count.id}`]:review.countVersion};
    for(const line of review.changedLines){expectedVersions[`product:${line.productId}`]=line.current.productVersion;expectedVersions[`balance:${line.productId}`]=line.current.balanceVersion!;}
    const result=await send(makeCommand('inventory.count.review',{countId:count.id,reason,reviewFingerprint:review.fingerprint,affectedProductIds},expectedVersions));
    if(!result)return;
    if(result.status==='CONFIRMED'){
      setChangesOpen(false);focusAfterLoad.current=affectedProductIds[0];
      setNotice('New baseline reviewed. Earlier counts remain in history. Physically recount the affected items; unchanged saved lines are retained.');
      await load();
    }else{
      setNotice(result.message??'The baseline review did not complete. Review the latest changed items before continuing.');
      setReviewRefresh(value=>value+1);
    }
  };

  const cancelCount = async () => {
    if (!count || !canApprove || locked || pending.current || dirty) return;
    const result = await send(makeCommand('inventory.count.cancel', { countId: count.id }, { [`count:${count.id}`]: count.version }));
    if (!result) return;
    if (result.status === 'CONFIRMED') {
      setCancelOpen(false);
      setNotice('Count cancelled. Its saved lines remain in count history; no stock was changed.');
      await clearLocalDraft(count.id);
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
        const recoveredCountId = original.payload.countId;
        if (['inventory.count.save', 'inventory.count.post', 'inventory.count.cancel'].includes(original.type) && typeof recoveredCountId === 'string') await clearLocalDraft(recoveredCountId);
        if(original.type==='inventory.count.review'){
          setChangesOpen(false);
          const affected=original.payload.affectedProductIds;
          focusAfterLoad.current=Array.isArray(affected)&&typeof affected[0]==='string'?affected[0]:null;
        }
        setNotice(original.type==='inventory.count.review'?'Baseline review completed. Earlier counts remain in history; recount the affected items.':'Count action completed. The count view was refreshed.');
        await recovery.inspect();
        if(original.type==='inventory.count.review')setReviewRefresh(value=>value+1);
        await load();
      } else if (response.status === 'REJECTED' || response.status === 'CONFLICT') {
        pending.current = null;
        setUnknownId('');
        setNotice(response.message ?? `Count action: ${actionStatusLabel(response.status!)}.`);
        await recovery.inspect();
        if(original.type==='inventory.count.review')setReviewRefresh(value=>value+1);
        if(dirty)setDraftVersionConflict(true);else await load();
      } else {
        setNotice(`Status: ${actionStatusLabel(status.status)}. Check again shortly.`);
      }
    } catch (cause) {
      try {
        if ((cause as { status?: number }).status !== 404 || !original) throw cause;
        const retry = await apiClient.submitCommand(original);
        if (['CONFIRMED', 'REJECTED', 'CONFLICT'].includes(retry.status)) {
          pending.current = null; setUnknownId('');
          const recoveredCountId = original.payload.countId;
          if (retry.status === 'CONFIRMED' && ['inventory.count.save', 'inventory.count.post', 'inventory.count.cancel'].includes(original.type) && typeof recoveredCountId === 'string') await clearLocalDraft(recoveredCountId);
          if(original.type==='inventory.count.review'&&retry.status==='CONFIRMED'){
            setChangesOpen(false);const affected=original.payload.affectedProductIds;focusAfterLoad.current=Array.isArray(affected)&&typeof affected[0]==='string'?affected[0]:null;
          }
          setNotice(retry.status === 'CONFIRMED' ? original.type==='inventory.count.review'?'Baseline review completed. Recount the affected items.':'Count action completed.' : retry.message ?? `Count action: ${actionStatusLabel(retry.status)}.`);
          await recovery.inspect(); if(retry.status==='CONFIRMED'||!dirty)await load();else setDraftVersionConflict(true);
          if(original.type==='inventory.count.review')setReviewRefresh(value=>value+1);
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

  const restoreStaleDraft = () => {
    if (!recoveredDraft || !count) return;
    if (!applyLocalDraft(recoveredDraft, count)) {
      setLocalDraftError('The recovered draft has a different item list. It remains saved on this device for review.');
      return;
    }
    const restored = { ...count, lines: count.lines.map(line => {
      const saved = recoveredDraft.lines.find(item => item.productId === line.productId)!;
      return { ...line, countedQuantity: saved.countedQuantity, varianceReason: saved.varianceReason };
    }) };
    setNotice('Recovered edits are open for review. Check each quantity, then save the draft to the server when ready. Nothing was posted.');
    void queueLocalDraftSave(restored);
  };

  const loadLatestLocalDraft = async () => {
    if (!count) return;
    try {
      const latest = await countDraftStore.get(scopeForCount(count.id));
      if (!latest) {
        localDraftRevision.current = null; setLocalStatus('none');
        setNotice('The other tab no longer has a local count draft. Your current edits remain on screen; review them before saving.');
        setDirty(true);
        return;
      }
      const matchingLines = latest.lines.length === count.lines.length && count.lines.every(line => latest.lines.some(saved => saved.productId === line.productId));
      if (latest.countVersion !== count.version || !matchingLines || !applyLocalDraft(latest, count)) {
        localDraftRevision.current = latest.revision;
        setLocalDraftError('The other tab saved a different count item list. The latest recovery copy remains available.');
        setLocalStatus('stale'); setRecoveredDraft(latest); setStaleDraftOpen(true);
        return;
      }
      setNotice('Loaded the latest edits saved by the other tab. Review them before saving to the server.');
    } catch (cause) {
      setLocalDraftError(cause instanceof Error ? cause.message : 'The latest local count edits could not be loaded.');
      setLocalStatus('conflict');
    }
  };

  const retryLocalDraftSave = () => { if (count) void queueLocalDraftSave(count); };

  const recoveryMessage = unknownId && <div role="alert" className="mb-3 rounded-lg border border-amber-800 p-3 text-sm text-amber-100">{notice}<button type="button" disabled={busy || !recovery.ready} onClick={() => void checkStatus()} className="mt-2 min-h-11 rounded-lg border border-amber-700 px-4 underline">Check status</button></div>;
  const reviewPending=unknownId&&pending.current?.type==='inventory.count.review'?pending.current:null;
  const changesCountId=reviewPending&&typeof reviewPending.payload.countId==='string'?reviewPending.payload.countId:count?.id;

  return <main className="min-h-full space-y-5 overflow-y-auto p-4 pb-24 text-zinc-100 sm:p-6">
    <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} />
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold tracking-[.18em] text-blue-300">STOCK · {session.outlet.name.toUpperCase()}</p><h1 className="mt-2 text-3xl font-bold">Count stock</h1><p className="mt-2 max-w-2xl text-sm text-zinc-400">Record a full-outlet or selected-item count against a saved stock baseline. A manager reviews and posts all differences together.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading || busy || dirty || !!unknownId} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm disabled:opacity-50"><RefreshCw size={15} /> Refresh</button>
    </header>
    <div className="rounded-xl border border-blue-900/70 bg-blue-950/30 p-3 text-sm text-blue-100"><strong>Stock count:</strong> unsent edits are retained on this device for this account, outlet, and count. They are not sent or posted until you save the draft to the server and complete manager review. Approval checks for stock changes and records all differences together.</div>
    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200"><CircleAlert size={17} />{error}</div>}
    {notice && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-200"><span>{notice}</span>{unknownId && <button type="button" onClick={() => void checkStatus()} disabled={busy || !recovery.ready} className="min-h-11 font-semibold text-blue-300 underline">Check status</button>}</div>}
    {localDraftStatus === 'saving' && <p role="status" className="rounded-xl border border-blue-900 bg-blue-950/30 p-3 text-sm text-blue-100">Saving unsent count edits on this device…</p>}
    {localDraftStatus === 'failed' && <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-100"><p>{localDraftError || 'Unsent count edits are only on screen and could not be saved on this device.'} Save the draft to the server before leaving if the command journal is available.</p>{count && dirty && <button type="button" onClick={retryLocalDraftSave} className="mt-2 min-h-11 rounded-lg border border-rose-700 px-3">Retry saving on this device</button>}</div>}
    {localDraftStatus === 'conflict' && <div role="alert" className="rounded-xl border border-amber-800 p-3 text-sm text-amber-100"><p>{localDraftError || 'Another tab saved count edits first. This tab is paused to protect both versions.'}</p><button type="button" onClick={() => void loadLatestLocalDraft()} className="mt-2 min-h-11 rounded-lg border border-amber-700 px-3">Load latest edits from other tab</button></div>}
    {localDraftStatus === 'stale' && recoveredDraft && <div role="alert" className="rounded-xl border border-amber-800 p-3 text-sm text-amber-100"><p>Recovered edits are from count version {recoveredDraft.countVersion}; the server is now at version {count?.version}. Review them before they can be applied.</p><button type="button" onClick={() => setStaleDraftOpen(true)} className="mt-2 min-h-11 rounded-lg border border-amber-700 px-3">Review recovered edits</button></div>}
    {draftVersionConflict&&<div role="alert" className="rounded-xl border border-amber-800 p-3 text-sm text-amber-100"><p>The saved draft changed elsewhere. Your unsent quantities and reasons are still here. Replace them only after reviewing that change.</p><button type="button" disabled={busy||!!unknownId} onClick={()=>void load()} className="mt-2 min-h-11 rounded-lg border border-amber-700 px-3">Replace local entries with current saved draft</button></div>}
    {count?.coverage==='LEGACY_CHECKPOINT'&&<p className="rounded-xl border border-amber-800 p-3 text-sm text-amber-100">This count has a legacy checkpoint. Review stock changes with a manager before recounting and posting; its earlier physical entries remain in history.</p>}
    {loading ? <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">Loading saved count…</section> : !count ? <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-7">
      <div className="flex items-start gap-3"><PackageSearch className="mt-1 text-blue-300" /><div><h2 className="text-lg font-semibold">No open stock count</h2><p className="mt-1 text-sm text-zinc-400">Choose the stock scope before its quantities are captured. Only selected products will be counted in a spot count.</p></div></div>
      {canCount ? <div className="mt-5 space-y-4">
        <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-2 text-sm font-medium text-zinc-200">Count scope</legend>
          <label className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 ${countScope==='FULL'?'border-blue-600 bg-blue-950/30':'border-zinc-800'}`}><input type="radio" name="count-scope" checked={countScope==='FULL'} onChange={()=>setCountScope('FULL')} className="mt-1 accent-blue-500"/><span><strong className="block text-sm">Full outlet</strong><small className="text-xs text-zinc-400">Snapshot every active stocked good.</small></span></label>
          <label className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 ${countScope==='SELECTED'?'border-blue-600 bg-blue-950/30':'border-zinc-800'}`}><input type="radio" name="count-scope" checked={countScope==='SELECTED'} onChange={()=>setCountScope('SELECTED')} className="mt-1 accent-blue-500"/><span><strong className="block text-sm">Selected-item spot count</strong><small className="text-xs text-zinc-400">Snapshot only the stocked goods selected below.</small></span></label>
        </fieldset>
        {countScope==='SELECTED'&&<section className="rounded-lg border border-zinc-800 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Select items before snapshot</h3><span className="text-xs text-zinc-400">{selectedItemIds.length} selected</span></div><label className="mt-2 block text-xs text-zinc-400">Find a stocked item<input value={selectionQuery} onChange={event=>setSelectionQuery(event.target.value)} placeholder="Name, SKU, or barcode" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white"/></label><div className="mt-2 max-h-56 divide-y divide-zinc-800 overflow-y-auto">{matchingSelectableProducts.slice(0,100).map(product=><label key={product.id} className="flex min-h-11 items-center gap-3 py-2 text-sm"><input type="checkbox" checked={selectedItemIds.includes(product.id)} onChange={event=>setSelectedItemIds(previous=>event.target.checked?[...previous,product.id]:previous.filter(id=>id!==product.id))} className="h-4 w-4 accent-blue-500"/><span className="min-w-0"><strong>{product.name}</strong><small className="ml-2 text-xs text-zinc-500">{product.sku}{product.barcode?` · ${product.barcode}`:''}</small></span></label>)}{!matchingSelectableProducts.length&&<p className="py-3 text-xs text-zinc-500">No active stocked goods match this search.</p>}</div>{matchingSelectableProducts.length>100&&<p className="mt-2 text-[11px] text-zinc-500">Showing the first 100 matches. Refine the search to find another item.</p>}</section>}
        <label className="flex items-start gap-3 rounded-lg border border-zinc-800 p-3 text-sm"><input type="checkbox" checked={blindCount} onChange={event=>setBlindCount(event.target.checked)} className="mt-1 h-4 w-4 accent-blue-500"/><span><strong className="block">Blind count</strong><small className="text-xs leading-relaxed text-zinc-400">Counters will not receive expected quantities or baseline values. Only a count approver can reveal the saved baseline for review.</small></span></label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="block flex-1 text-sm text-zinc-300">Area label <span className="text-zinc-500">(optional)</span><input maxLength={100} value={areaLabel} onChange={event => setAreaLabel(event.target.value)} placeholder="e.g. Main store" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white" /></label><button type="button" onClick={() => void openCount()} disabled={locked || countScope==='SELECTED'&&!selectedItemIds.length} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50"><ClipboardCheck size={17} /> Start {countScope==='FULL'?'full':'spot'} count</button></div>
        <p className="text-xs text-amber-200">Location-scoped counts will be available after stock locations are implemented. An area label does not change which balances are counted.</p>
      </div> : <p className="mt-4 text-sm text-zinc-400">Your role can review counts but cannot open or record one.</p>}
    </section> : <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 p-4 sm:p-5"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{count.scope!=='SELECTED'?'Full outlet count':'Selected-item spot count'} in progress</h2><span className="rounded-full bg-amber-950 px-2.5 py-1 text-xs text-amber-200">Draft</span>{count.blind&&<span className="rounded-full bg-violet-950 px-2.5 py-1 text-xs text-violet-200">Blind</span>}</div><p className="mt-1 text-sm text-zinc-400">{count.areaLabel || 'No area label'} · starting quantities recorded {dateLabel(count.baselineAt, (session.outlet.timeZone ?? session.tenant.timeZone))}</p><p className="mt-1 text-xs text-zinc-500">{count.countedLineCount} of {count.lineCount} items have a saved count.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={()=>setChangesOpen(true)} disabled={locked || count.blind&&!canApprove} className="min-h-11 rounded-lg border border-blue-700 px-3 text-sm text-blue-200 disabled:opacity-50">Review stock changes</button>{canApprove && <button type="button" onClick={() => setCancelOpen(true)} disabled={locked || dirty} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 disabled:opacity-50">Cancel count</button>}</div></div>
      <section aria-labelledby="count-readiness-heading" className="space-y-3 border-b border-zinc-800 bg-zinc-900/30 p-4 sm:p-5">
        <div><h3 id="count-readiness-heading" className="font-semibold">Prepare this {count.scope!=='SELECTED'?'full':'selected-item'} count</h3><p className="mt-1 text-xs leading-relaxed text-zinc-400">Enter a physical quantity for every item in this saved scope. Enter 0 when none are present; leave the field blank only when the item has not been counted. Every non-zero difference needs a reason after an authorized reviewer can see the baseline.</p>{count.blind&&<p className="mt-2 text-xs text-violet-200">Blind count: the expected quantity is hidden for this account until an inventory count approver opens the review.</p>}</div>
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <p className="rounded-lg border border-zinc-800 p-2 text-zinc-300"><strong className="text-white">{count.countedLineCount} of {count.lineCount}</strong> counts saved to the server</p>
          <p className={`rounded-lg border p-2 ${missingQuantityLines.length ? 'border-amber-800 text-amber-100' : 'border-zinc-800 text-zinc-300'}`}><strong>{missingQuantityLines.length}</strong> {missingQuantityLines.length === 1 ? 'quantity' : 'quantities'} still needed</p>
          <p className={`rounded-lg border p-2 ${missingReasonLines.length ? 'border-amber-800 text-amber-100' : 'border-zinc-800 text-zinc-300'}`}><strong>{missingReasonLines.length}</strong> variance {missingReasonLines.length === 1 ? 'reason' : 'reasons'} still needed</p>
          <p className={`rounded-lg border p-2 ${invalidQuantityLines.length ? 'border-rose-800 text-rose-200' : 'border-zinc-800 text-zinc-300'}`}><strong>{invalidQuantityLines.length}</strong> quantities need correction</p>
        </div>
        {!canCount && (missingQuantityLines.length > 0 || missingReasonLines.length > 0 || invalidQuantityLines.length > 0) && <p className="text-xs text-amber-200">A staff member with count permission must complete these entries before manager review.</p>}
        {missingQuantityLines.length > 0 && <div><h4 className="text-xs font-semibold text-amber-100">Items not counted</h4><ul className="mt-1 flex flex-wrap gap-2">{missingQuantityLines.map(line => <li key={line.productId}><button type="button" disabled={!canCount || locked} onClick={() => focusLine(line)} className="min-h-10 rounded-lg border border-amber-800 px-3 text-left text-xs text-amber-100 disabled:opacity-50">{line.sku} · {line.name}</button></li>)}</ul></div>}
        {missingReasonLines.length > 0 && <div><h4 className="text-xs font-semibold text-amber-100">Differences that need a reason</h4><ul className="mt-1 flex flex-wrap gap-2">{missingReasonLines.map(line => <li key={line.productId}><button type="button" disabled={!canCount || locked} onClick={() => focusReason(line)} className="min-h-10 rounded-lg border border-amber-800 px-3 text-left text-xs text-amber-100 disabled:opacity-50">{line.sku} · {line.name}</button></li>)}</ul></div>}
        {invalidQuantityLines.length > 0 && <div><h4 className="text-xs font-semibold text-rose-200">Invalid quantities</h4><ul className="mt-1 flex flex-wrap gap-2">{invalidQuantityLines.map(line => <li key={line.productId}><button type="button" disabled={!canCount || locked} onClick={() => focusLine(line)} className="min-h-10 rounded-lg border border-rose-800 px-3 text-left text-xs text-rose-200 disabled:opacity-50">{line.sku} · {line.name}</button></li>)}</ul></div>}
        {complete && !missingReasons && invalidQuantityLines.length === 0 && count.status === 'OPEN' && <p role="status" className="text-xs text-emerald-200">All baseline items have a valid quantity and every difference has a reason. Save unsent changes to the server before manager review.</p>}
      </section>
      <div className="border-b border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <label className="relative block"><Barcode className="absolute left-3 top-3 h-5 w-5 text-blue-300"/><span className="sr-only">Scan barcode or search count items</span><input autoComplete="off" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();selectScannedLine();}}} placeholder="Scan barcode or search item name / SKU" className="min-h-12 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-11 pr-10 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500" aria-controls="count-scan-suggestions" aria-expanded={!!query}/><Search className="absolute right-3 top-3.5 h-4 w-4 text-zinc-500"/></label>
        {query&&<div id="count-scan-suggestions" role="listbox" aria-label="Matching items in this count scope" className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950">{matchingLines.length?matchingLines.slice(0,8).map(line=>{const product=catalogByProduct.get(line.productId);return <button key={line.productId} type="button" role="option" aria-selected="false" onClick={()=>focusLine(line)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-zinc-800 px-3 py-2 text-left last:border-0 hover:bg-zinc-900"><span className="min-w-0"><strong className="block truncate text-xs">{line.name}</strong><small className="text-[11px] text-zinc-500">{line.sku}{product?.barcode?` · ${product.barcode}`:''}</small></span><span className="shrink-0 text-right text-[11px] text-zinc-400">{line.expectedQuantity===null?'Baseline hidden':'Baseline '+formatDecimalQuantity(line.expectedQuantity)+' '+line.unit}<small className="block text-blue-300">Focus count field</small></span></button>; }):<p className="p-3 text-xs text-zinc-400">{matchingCatalogProducts.length?'A catalogue item exists but is outside this saved count scope. It will not be added or set to zero.':'No item matches this scan. Check the catalogue before changing the count.'}</p>}</div>}
        {query&&!matchingLines.length&&!matchingCatalogProducts.length&&canManageCatalog&&onOpenCatalog&&<button type="button" onClick={()=>onOpenCatalog(query.trim())} className="mt-2 min-h-10 rounded-lg border border-blue-700 px-3 text-xs font-semibold text-blue-100">Open permissioned catalog review</button>}
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-zinc-500"><span>Scan finds only items in this saved count scope.</span>{catalogError&&<span role="status" className="text-amber-300">Barcode data unavailable. Search by item name or SKU.</span>}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"><span className="inline-flex items-center gap-2 text-zinc-300"><PackageSearch size={15} className="text-blue-300"/>{count.lines.length} baseline items · {count.countedLineCount} saved counts</span><span className="text-zinc-400">{visibleLines.length} shown · {count.lines.length-visibleLines.length} hidden by search</span></div>
      {visibleLines.length ? <div className="divide-y divide-zinc-800">{visibleLines.map(line => {
        const variance = lineVariance(line);
        const invalid = line.countedQuantity !== null && line.countedQuantity !== '' && !quantityPattern.test(line.countedQuantity);
        const changed = variance !== null && !decimalStringsEqual(variance, '0');
        return <article key={line.productId} className="grid gap-3 p-4 md:grid-cols-[minmax(160px,1fr)_140px_140px_minmax(190px,1fr)] md:items-end">
          <div className="min-w-0"><h3 className="truncate font-semibold">{line.name}</h3><p className="mt-1 text-xs text-zinc-500">{line.sku} · {line.unit} · {line.expectedQuantity===null?'baseline hidden until manager review':'baseline '+formatDecimalQuantity(line.expectedQuantity)}</p>{line.requiresRecount&&<p className="mt-2 text-xs font-semibold text-amber-200">Physical recount required. Enter and save a fresh quantity.</p>}</div>
          <label className="block text-xs text-zinc-400">Counted quantity<input ref={element=>{if(element)lineInputs.set(line.productId,element);else lineInputs.delete(line.productId);}} inputMode="decimal" value={line.countedQuantity ?? ''} disabled={!canCount || locked || count.status !== 'OPEN'} onChange={event => updateLine(line.productId, 'countedQuantity', event.target.value)} placeholder="Enter quantity" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white disabled:opacity-50" /></label>
          <div className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${invalid ? 'border-rose-800 text-rose-300' : changed ? 'border-amber-800 text-amber-200' : 'border-zinc-800 text-zinc-400'}`}>{invalid ? 'Invalid quantity' : variance === null ? (line.countedQuantity!==null&&line.countedQuantity!==''&&line.expectedQuantity===null?'Blind count saved':'Not counted') : decimalStringsEqual(variance, '0') ? 'Matches baseline' : `${variance.startsWith('-') ? '' : '+'}${formatDecimalQuantity(variance)} ${line.unit}`}</div>
          <label className="block text-xs text-zinc-400">Reason for difference{changed && <span className="text-amber-300"> · required</span>}<input ref={element=>{if(element)reasonInputs.current.set(line.productId,element);else reasonInputs.current.delete(line.productId);}} maxLength={200} value={line.varianceReason ?? ''} disabled={!canCount || locked || count.status !== 'OPEN'} onChange={event => updateLine(line.productId, 'varianceReason', event.target.value)} placeholder="Explain damage, loss, or correction" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white disabled:opacity-50" /></label>
        </article>;
      })}</div> : <p className="p-5 text-sm text-zinc-400">No count items match that search.</p>}
      <footer className="flex flex-col gap-3 border-t border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="text-xs text-zinc-400">{dirty ? localDraftStatus === 'saved' ? 'Unsent changes are saved on this device; save the draft to the server before manager review.' : 'Unsent changes · save the draft to the server before leaving.' : 'Draft saved on the server.'}{!canApprove && <span className="block mt-1 text-amber-200">A manager must review and post the count.</span>}</div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void saveDraft()} disabled={!canCount || !dirty || locked} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save draft'}</button>{canApprove && <button type="button" onClick={() => { setValuationAcknowledged(false); setValuationReason(''); setReviewOpen(true); }} disabled={!complete || missingReasons || dirty || locked || count.status !== 'OPEN'} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><ShieldCheck size={16} /> Review and post</button>}</div></footer>
    </section>}
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"><div className="border-b border-zinc-800 p-4"><h2 className="font-semibold">Count history</h2><p className="mt-1 text-xs text-zinc-500">Outlet count sessions, newest first</p></div>{historyLoading&&<p role="status" className="p-4 text-sm text-zinc-400">Loading count history...</p>}{historyError&&<p role="alert" className="p-4 text-sm text-rose-300">{historyError}<button type="button" className="ml-3 min-h-11 underline" onClick={()=>void loadHistory(historyAttempt.current.more,historyAttempt.current.search)}>Retry count history</button></p>}{history.length ? <div className="divide-y divide-zinc-800">{history.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><strong className="text-sm">{item.areaLabel || (item.scope==='SELECTED'?'Selected-item spot count':'Full outlet count')}</strong><span className="rounded-full bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300">{item.scope==='SELECTED'?'Spot count':'Full outlet'}</span>{item.blind&&<span className="rounded-full bg-violet-950 px-2 py-1 text-[11px] text-violet-200">Blind</span>}<span className={`rounded-full px-2 py-1 text-[11px] ${item.status === 'POSTED' ? 'bg-emerald-950 text-emerald-300' : item.status === 'CANCELLED' ? 'bg-zinc-800 text-zinc-400' : 'bg-amber-950 text-amber-200'}`}>{actionStatusLabel(item.status)}</span></div><p className="mt-1 text-xs text-zinc-500">{item.countedLineCount}/{item.lineCount} counted · opened {dateLabel(item.openedAt, (session.outlet.timeZone ?? session.tenant.timeZone))}{item.postedAt ? ` · posted ${dateLabel(item.postedAt, (session.outlet.timeZone ?? session.tenant.timeZone))}` : ''}</p></div><button type="button" onClick={() => void openHistoryDetail(item.id)} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-200">View details</button></div>)}</div> : !historyLoading&&!historyError&&<p className="p-4 text-sm text-zinc-400">No stock counts match this search.</p>}<HistoryNavigation page={historyPage} loaded={history.length} busy={historyLoading} label="count history" onMore={()=>void loadHistory(true)} onSearch={value=>{setHistoryQuery(value);setHistory([]);setHistoryPage(undefined);void loadHistory(false,value);}}/></section>

    {changesOpen&&changesCountId&&<Suspense fallback={<p role="status" className="p-3 text-sm text-zinc-400">Loading count review…</p>}><CountChangesReviewDialog countId={changesCountId} countVersion={count?.id===changesCountId?count.version:null} localLines={count?.lines??[]} currency={session.tenant.currency} timeZone={session.outlet.timeZone??session.tenant.timeZone} dirty={dirty} busy={busy} canApprove={canApprove} canCount={canCount} canReadCost={canReadCost} pendingCommand={reviewPending} refreshKey={reviewRefresh} notice={notice} onClose={()=>setChangesOpen(false)} onSave={saveDraft} onReview={reviewChangedItems} onCheckStatus={()=>void checkStatus()} onReplaceDraft={async()=>{await load();setReviewRefresh(value=>value+1);}}/></Suspense>}

    {reviewOpen && count && <ResponsiveDialog isOpen={reviewOpen} onClose={() => { setReviewOpen(false); setValuationAcknowledged(false); setValuationReason(''); }} title={count.scope!=='SELECTED'?'Review full outlet count':'Review selected-item count'} subtitle={`${count.areaLabel || 'Outlet count'} · ${count.lineCount} items`} icon={<ShieldCheck className="h-5 w-5 text-blue-400" />} maxWidth="lg" footerActions={<><button type="button" onClick={() => { setReviewOpen(false); setValuationAcknowledged(false); setValuationReason(''); }} className="min-h-11 rounded-lg px-4 text-zinc-300 hover:bg-zinc-800">Return to count</button><button type="button" onClick={() => void postCount()} disabled={locked || !complete || missingReasons || !valuationReviewReady} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">{busy ? 'Posting…' : 'Post reviewed count'}</button></>}>
      {recoveryMessage}
      {valuationReviewRequired && <section className="mb-4 rounded-lg border border-blue-800 bg-blue-950/30 p-3 text-sm">
        <h3 className="font-semibold text-blue-100">Estimated value for stock gained from a zero baseline</h3>
        <p className="mt-1 text-xs leading-relaxed text-blue-100">These proposed values use the catalog reference cost captured when this count opened. They are estimates, not verified purchase costs, and do not replace provisional COGS for stock exceptions.</p>
        <div className="mt-3 space-y-2">{valuationEstimates.map(estimate => <div key={estimate.line.productId} className="flex flex-wrap justify-between gap-2 rounded-md border border-blue-900/70 p-2 text-xs">
          <span><strong>{estimate.line.name}</strong><small className="mt-1 block text-blue-100">Counted {formatDecimalQuantity(estimate.line.countedQuantity!)} {estimate.line.unit} · origin: opening reference cost</small></span>
          <span className="text-right font-mono text-blue-100">{estimate.unitCostMinor === null || estimate.valueMinor === null ? 'Valuation unavailable' : `Unit ${formatMinorMoney(Number(estimate.unitCostMinor), session.tenant.currency)} · value ${formatMinorMoney(Number(estimate.valueMinor), session.tenant.currency)}`}
            {estimate.unitCostMinor === '0' && <small className="mt-1 block font-sans text-amber-200">Opening reference cost is zero; policy keeps this gain at zero value after manager review.</small>}
          </span>
        </div>)}</div>
        {!canReadCost && <p role="alert" className="mt-3 text-xs text-rose-200">Cost access is required to review and post these values.</p>}
        {!valuationEstimatesValid && canReadCost && <p role="alert" className="mt-3 text-xs text-rose-200">The proposed value could not be calculated safely. Refresh the count and resolve the cost record before posting.</p>}
        <label className="mt-3 flex items-start gap-2 text-xs text-blue-50"><input type="checkbox" checked={valuationAcknowledged} onChange={event => setValuationAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-500" />I reviewed the proposed values. A zero reference cost will remain zero-valued only with the reason entered below.</label>
        <label className="mt-3 block text-xs font-medium text-blue-50">Valuation approval reason<textarea value={valuationReason} onChange={event => setValuationReason(event.target.value)} maxLength={500} rows={2} placeholder="Explain why the reference-cost estimate, including any zero value, is appropriate." className="mt-1 min-h-20 w-full rounded-lg border border-blue-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-500" /></label>
        <p className="mt-1 text-[11px] text-blue-200">The reason is stored with the immutable posted-count event and audit record.</p>
      </section>}
      <div className="max-h-[50vh] space-y-2 overflow-y-auto">{count.lines.filter(line => {const delta=lineVariance(line);return delta!==null&&!decimalStringsEqual(delta,'0')}).map(line => <div key={line.productId} className="flex flex-wrap justify-between gap-2 rounded-lg border border-zinc-800 p-3 text-sm"><span><strong>{line.name}</strong><small className="mt-1 block text-xs text-zinc-400">Expected {line.expectedQuantity===null?'hidden':formatDecimalQuantity(line.expectedQuantity)} · counted {line.countedQuantity === null ? null : formatDecimalQuantity(line.countedQuantity)} {line.unit} · {line.varianceReason}</small></span><span className="font-mono text-amber-200">{formatDecimalQuantity(lineVariance(line) ?? '0')}</span></div>)}{!count.lines.some(line=>{const delta=lineVariance(line);return delta!==null&&!decimalStringsEqual(delta,'0')})&&<p className="rounded-lg border border-zinc-800 p-3 text-sm text-zinc-300">All counted quantities match the saved baseline. Posting will close the count without creating stock adjustments.</p>}</div>
      <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100">If stock changes during the count, approval stops and keeps this draft for manager review. Differences use the stock value recorded when this count started. Gains from zero use that opening reference cost estimate; verified sale COGS remains governed by sale evidence.</div>
    </ResponsiveDialog>}

    {cancelOpen && count && <ResponsiveDialog isOpen={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this count?" subtitle="No stock will change; the count will remain in history." icon={<CircleAlert className="h-5 w-5 text-amber-300" />} maxWidth="md" footerActions={<><button type="button" onClick={() => setCancelOpen(false)} className="min-h-11 rounded-lg px-4 text-zinc-300">Keep count</button><button type="button" onClick={() => void cancelCount()} disabled={locked || dirty} className="min-h-11 rounded-lg bg-rose-700 px-4 font-semibold text-white disabled:opacity-50">Cancel count</button></>} >{recoveryMessage}<p className="text-sm text-zinc-300">The saved baseline and entered quantities will be retained as cancelled evidence. Start a new count to capture a fresh stock baseline.</p></ResponsiveDialog>}

    {staleDraftOpen && recoveredDraft && count && <ResponsiveDialog isOpen={staleDraftOpen} onClose={() => setStaleDraftOpen(false)} title="Review recovered count edits" subtitle={`Saved for count version ${recoveredDraft.countVersion}; current server version ${count.version}.`} icon={<CircleAlert className="h-5 w-5 text-amber-300" />} maxWidth="lg" footerActions={<><button type="button" onClick={() => setStaleDraftOpen(false)} className="min-h-11 rounded-lg px-4 text-zinc-300">Return to count</button><button type="button" onClick={restoreStaleDraft} disabled={busy || !!unknownId || !recoveredDraft.lines.every(saved => count.lines.some(line => line.productId === saved.productId))} className="min-h-11 rounded-lg bg-amber-700 px-4 font-semibold text-white disabled:opacity-50">Restore edits for review</button></>}><p className="mb-3 text-sm text-amber-100">These entries will only be placed back into the count for you to review. Restoring them does not save, send, approve, or post anything.</p><div className="max-h-[45vh] divide-y divide-zinc-800 overflow-y-auto">{recoveredDraft.lines.map(saved => {const line=count.lines.find(candidate=>candidate.productId===saved.productId);return <div key={saved.productId} className="py-3 text-sm"><strong>{line?.name ?? saved.productId}</strong><p className="mt-1 text-zinc-300">Counted: {saved.countedQuantity ?? 'not counted'}{saved.varianceReason ? ` · Reason: ${saved.varianceReason}` : ''}</p></div>})}</div>{localDraftError&&<p role="alert" className="mt-3 text-sm text-rose-300">{localDraftError}</p>}</ResponsiveDialog>}

    {historyDetail && <ResponsiveDialog isOpen={!!historyDetail} onClose={() => setHistoryDetail(null)} title="Stock count details" subtitle={`${historyDetail.areaLabel || (historyDetail.scope==='SELECTED'?'Selected-item spot count':'Full outlet count')} · ${historyDetail.scope==='SELECTED'?'spot count':'full outlet'}${historyDetail.blind?' · blind':''} · ${actionStatusLabel(historyDetail.status)}`} icon={<ClipboardCheck className="h-5 w-5 text-blue-400" />} maxWidth="lg" footerActions={<button type="button" onClick={() => setHistoryDetail(null)} className="min-h-11 rounded-lg px-4 text-zinc-300">Close</button>}><div className="max-h-[55vh] divide-y divide-zinc-800 overflow-y-auto">{historyDetail.lines.map(line => {const variance=lineVariance(line);return <div key={line.productId} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><span className="text-sm font-semibold">{line.name}<small className="mt-1 block text-xs font-normal text-zinc-500">{line.sku} · {line.expectedQuantity===null?'baseline hidden until manager review':'baseline '+formatDecimalQuantity(line.expectedQuantity)} · counted {line.countedQuantity === null ? '—' : formatDecimalQuantity(line.countedQuantity)} {line.unit}</small>{line.varianceReason&&<small className="mt-1 block text-xs font-normal text-zinc-400">Reason: {line.varianceReason}</small>}</span><span className="font-mono text-sm">{variance === null ? (line.countedQuantity!==null&&line.countedQuantity!==''&&line.expectedQuantity===null?'Blind count saved':'Not counted') : `${variance.startsWith('-') ? '' : '+'}${formatDecimalQuantity(variance)} ${line.unit}`}</span></div>})}</div><CountEvidenceHistory countId={historyDetail.id} currency={session.tenant.currency} timeZone={session.outlet.timeZone??session.tenant.timeZone}/></ResponsiveDialog>}
  </main>;
}
