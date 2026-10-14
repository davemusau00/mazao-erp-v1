import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, CalendarDays, ChevronRight, RefreshCw, Scale } from 'lucide-react';
import { apiClient, type BackendJournalLines, type BackendPartialOperatingSummary, type BackendTrialBalance } from '../../services/apiClient';

type ReportView = 'trial-balance' | 'operating-summary';

function businessDate(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function monthStart(date: string) { return `${date.slice(0, 7)}-01`; }

function formatMinor(value: string, currency: string) {
  const amount = BigInt(value);
  const sign = amount < 0n ? '-' : '';
  const absolute = amount < 0n ? -amount : amount;
  const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(fractionDigits);
  const major = absolute / scale;
  const fraction = absolute % scale;
  const grouped = new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(major);
  return `${sign}${currency} ${grouped}${fractionDigits ? `.${fraction.toString().padStart(fractionDigits, '0')}` : ''}`;
}

function reportError(error: unknown) {
  return error instanceof Error ? error.message : 'The report could not be loaded.';
}

export function BackendFinancialReportsWorkspace({ initialView = 'operating-summary' }: { initialView?: ReportView }) {
  const session = apiClient.getSession();
  const outletTimeZone = session?.tenant.timeZone ?? 'Africa/Nairobi';
  const today = useMemo(() => businessDate(outletTimeZone), [outletTimeZone]);
  const [view, setView] = useState<ReportView>(initialView);
  const [asOfInput, setAsOfInput] = useState(today);
  const [asOf, setAsOf] = useState(today);
  const [fromInput, setFromInput] = useState(monthStart(today));
  const [toInput, setToInput] = useState(today);
  const [period, setPeriod] = useState({ from: monthStart(today), to: today });
  const [trialBalance, setTrialBalance] = useState<BackendTrialBalance | null>(null);
  const [summary, setSummary] = useState<BackendPartialOperatingSummary | null>(null);
  const [journalLines, setJournalLines] = useState<BackendJournalLines | null>(null);
  const [journalOffset, setJournalOffset] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [journalBusy, setJournalBusy] = useState(false);
  const [error, setError] = useState('');
  const [journalError, setJournalError] = useState('');

  useEffect(() => {
    let current = true;
    setBusy(true);
    setError('');
    const request = view === 'trial-balance'
      ? apiClient.getTrialBalance(asOf).then(report => { if (current) setTrialBalance(report); })
      : apiClient.getProfitLoss(period.from, period.to).then(report => { if (current) setSummary(report); });
    void request.catch(reason => { if (current) setError(reportError(reason)); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [view, asOf, period]);

  useEffect(() => {
    if (!selectedAccount) { setJournalLines(null); setJournalError(''); return; }
    let current = true;
    setJournalBusy(true);
    setJournalError('');
    const query = view === 'trial-balance'
      ? { accountCode: selectedAccount, asOf, limit: 100, offset: journalOffset }
      : { accountCode: selectedAccount, from: period.from, to: period.to, limit: 100, offset: journalOffset };
    if (journalOffset === 0) setJournalLines(null);
    void apiClient.getJournalLines(query)
      .then(result => { if (current) setJournalLines(previous => journalOffset > 0 && previous ? { ...result, entries: [...previous.entries, ...result.entries] } : result); })
      .catch(reason => { if (current) setJournalError(reportError(reason)); })
      .finally(() => { if (current) setJournalBusy(false); });
    return () => { current = false; };
  }, [selectedAccount, view, asOf, period, journalOffset]);

  const currency = trialBalance?.currency ?? summary?.currency ?? session?.tenant.currency ?? 'KES';
  const generatedAt = view === 'trial-balance' ? trialBalance?.generatedAt : summary?.generatedAt;
  const sourceTypes = view === 'trial-balance' ? trialBalance?.coverage.sourceTypes : summary?.coverage.sourceTypes;
  const refreshTrial = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfInput)) return;
    setSelectedAccount(''); setAsOf(asOfInput);
  };
  const refreshSummary = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromInput) || !/^\d{4}-\d{2}-\d{2}$/.test(toInput) || fromInput > toInput) {
      setError('Choose a valid date range with the start date on or before the end date.');
      return;
    }
    setSelectedAccount(''); setError(''); setPeriod({ from: fromInput, to: toInput });
  };

  const selectAccount = (accountCode: string) => {
    setJournalOffset(0);
    setSelectedAccount(value => value === accountCode ? '' : accountCode);
  };
  const selectedDescription = view === 'trial-balance'
    ? `Posted journal lines through ${asOf} in ${outletTimeZone}`
    : `Posted journal lines from ${period.from} through ${period.to} in ${outletTimeZone}`;

  return <section className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8" aria-labelledby="finance-reports-title">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-300"><Scale size={15} /> Finance · server ledger</div>
          <h1 id="finance-reports-title" className="text-2xl font-semibold tracking-tight text-zinc-50">Financial reports</h1>
          <p className="mt-1 text-sm text-zinc-400">{session?.tenant.name} · all outlets · {currency} · business dates use {outletTimeZone}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-400">
          {generatedAt ? <>Snapshot generated <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleString()}</time></> : 'Reports read posted server journal entries'}
        </div>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Financial report type">
        <button type="button" onClick={() => { setView('trial-balance'); setSelectedAccount(''); }} aria-pressed={view === 'trial-balance'} className={`min-h-11 rounded-lg border px-4 text-sm font-medium transition-colors ${view === 'trial-balance' ? 'border-sky-400/50 bg-sky-400/10 text-sky-200' : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'}`}><BookOpen className="mr-2 inline" size={16} />Trial balance</button>
        <button type="button" onClick={() => { setView('operating-summary'); setSelectedAccount(''); }} aria-pressed={view === 'operating-summary'} className={`min-h-11 rounded-lg border px-4 text-sm font-medium transition-colors ${view === 'operating-summary' ? 'border-sky-400/50 bg-sky-400/10 text-sky-200' : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'}`}><CalendarDays className="mr-2 inline" size={16} />Operating summary</button>
      </nav>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        {view === 'trial-balance' ? <>
          <label className="grid gap-1 text-xs font-medium text-zinc-400">Business date
            <input type="date" value={asOfInput} onChange={event => setAsOfInput(event.target.value)} className="h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 [color-scheme:dark]" />
          </label>
          <button type="button" onClick={refreshTrial} disabled={busy} className="h-11 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:opacity-60"><RefreshCw className="mr-2 inline" size={15} />Refresh</button>
        </> : <>
          <label className="grid gap-1 text-xs font-medium text-zinc-400">From
            <input type="date" value={fromInput} onChange={event => setFromInput(event.target.value)} className="h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 [color-scheme:dark]" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-zinc-400">To
            <input type="date" value={toInput} onChange={event => setToInput(event.target.value)} className="h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 [color-scheme:dark]" />
          </label>
          <button type="button" onClick={refreshSummary} disabled={busy} className="h-11 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:opacity-60"><RefreshCw className="mr-2 inline" size={15} />Refresh</button>
          <span className="text-xs text-zinc-500">Maximum range: 367 days</span>
        </>}
      </div>

      {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-900/70 bg-rose-950/40 p-4 text-sm text-rose-200"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}

      {view === 'trial-balance' && <>
        {busy && <div role="status" className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm text-zinc-400">Loading posted ledger totals…</div>}
        {trialBalance && !busy && <>
          <div className={`flex flex-wrap items-start justify-between gap-4 rounded-xl border p-4 ${trialBalance.totals.balanced ? 'border-emerald-900 bg-emerald-950/30' : 'border-amber-800 bg-amber-950/30'}`}>
            <div className="flex items-start gap-3">
              {trialBalance.totals.balanced ? <Scale className="mt-0.5 text-emerald-300" size={19} /> : <AlertTriangle className="mt-0.5 text-amber-300" size={19} />}
              <div><h2 className="font-semibold text-zinc-100">{trialBalance.totals.balanced ? 'Posted journal totals balance' : 'Journal imbalance needs review'}</h2><p className="mt-1 max-w-3xl text-sm text-zinc-400">{trialBalance.coverage.explanation}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-5 text-right text-sm sm:min-w-80">
              <div><div className="text-xs text-zinc-500">Debit balances</div><div className="mt-1 font-mono text-zinc-100">{formatMinor(trialBalance.totals.debitMinor, currency)}</div></div>
              <div><div className="text-xs text-zinc-500">Credit balances</div><div className="mt-1 font-mono text-zinc-100">{formatMinor(trialBalance.totals.creditMinor, currency)}</div></div>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            <div className="flex flex-wrap justify-between gap-2 border-b border-zinc-800 px-4 py-3"><h2 className="font-semibold text-zinc-100">Account balances · as of {trialBalance.asOf}</h2><span className="text-xs text-zinc-500">{trialBalance.coverage.journalEntryCount} posted entries</span></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-zinc-900/70 text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-4 py-3">Account</th><th className="px-4 py-3 text-right">Total debits</th><th className="px-4 py-3 text-right">Total credits</th><th className="px-4 py-3 text-right">Debit balance</th><th className="px-4 py-3 text-right">Credit balance</th></tr></thead><tbody className="divide-y divide-zinc-900">{trialBalance.accounts.map(account => <tr key={account.accountCode} className="hover:bg-zinc-900/60"><th scope="row" className="px-4 py-3 font-medium"><button type="button" onClick={() => selectAccount(account.accountCode)} aria-expanded={selectedAccount === account.accountCode} className="min-h-11 text-left text-sky-300 hover:text-sky-200">{account.accountCode}<ChevronRight className="ml-1 inline" size={14} /></button></th><td className="px-4 py-3 text-right font-mono text-zinc-300">{formatMinor(account.debitMinor, currency)}</td><td className="px-4 py-3 text-right font-mono text-zinc-300">{formatMinor(account.creditMinor, currency)}</td><td className="px-4 py-3 text-right font-mono text-zinc-300">{formatMinor(account.netDebitMinor, currency)}</td><td className="px-4 py-3 text-right font-mono text-zinc-300">{formatMinor(account.netCreditMinor, currency)}</td></tr>)}{trialBalance.accounts.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-500">No journal entries were posted through this date.</td></tr>}</tbody></table></div>
          </div>
          <CoverageDetails entryCount={trialBalance.coverage.journalEntryCount} emptyCount={trialBalance.coverage.emptyJournalEntryCount} unbalancedCount={trialBalance.coverage.unbalancedJournalEntryCount} sourceTypes={sourceTypes ?? []} />
        </>}
      </>}

      {view === 'operating-summary' && <>
        {busy && <div role="status" className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm text-zinc-400">Loading posted operating summary…</div>}
        {summary && !busy && <>
          <div role="note" className="flex items-start gap-3 rounded-xl border border-amber-800 bg-amber-950/30 p-4"><AlertTriangle className="mt-0.5 shrink-0 text-amber-300" size={19} /><div><h2 className="font-semibold text-amber-100">Partial operating summary · not net profit</h2><p className="mt-1 text-sm text-amber-100/70">{summary.coverage.explanation}</p></div></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[
            ['Revenue', summary.totals.revenueMinor, ArrowUpRight], ['Cost of goods sold', summary.totals.costOfGoodsSoldMinor, ArrowDownRight], ['Gross profit', summary.totals.grossProfitMinor, Scale], ['Other income', summary.totals.otherIncomeMinor, ArrowUpRight], ['Other operating costs', summary.totals.otherOperatingCostsMinor, ArrowDownRight], ['Partial operating result', summary.totals.partialOperatingResultMinor, AlertTriangle],
          ].map(([label, amount, Icon]) => { const MetricIcon = Icon as typeof Scale; return <div key={String(label)} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><div className="flex items-center gap-2 text-sm text-zinc-400"><MetricIcon size={16} />{String(label)}</div><div className="mt-3 font-mono text-xl font-semibold text-zinc-100">{formatMinor(String(amount), currency)}</div></div>; })}</div>
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"><div className="border-b border-zinc-800 px-4 py-3"><h2 className="font-semibold text-zinc-100">Recognized posted accounts</h2><p className="mt-1 text-xs text-zinc-500">Select an account to review its source journal lines.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><thead className="bg-zinc-900/70 text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-4 py-3">Account</th><th className="px-4 py-3">Section</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-zinc-900">{summary.lines.map(line => <tr key={line.accountCode} className="hover:bg-zinc-900/60"><th scope="row" className="px-4 py-3 font-medium"><button type="button" onClick={() => selectAccount(line.accountCode)} aria-expanded={selectedAccount === line.accountCode} className="min-h-11 text-left text-sky-300 hover:text-sky-200">{line.accountCode}<ChevronRight className="ml-1 inline" size={14} /></button></th><td className="px-4 py-3 text-zinc-400">{line.section.replaceAll('_', ' ').toLowerCase()}</td><td className="px-4 py-3 text-right font-mono text-zinc-200">{formatMinor(line.amountMinor, currency)}</td></tr>)}{summary.lines.length === 0 && <tr><td colSpan={3} className="px-4 py-12 text-center text-zinc-500">No recognized operating entries in this period.</td></tr>}</tbody></table></div></div>
          <CoverageDetails entryCount={summary.coverage.journalEntryCount} emptyCount={summary.coverage.emptyJournalEntryCount} unbalancedCount={summary.coverage.unbalancedJournalEntryCount} sourceTypes={summary.coverage.sourceTypes} omissions={summary.coverage.omittedSources} unknownAccounts={summary.coverage.unknownAccountCodes} />
        </>}
      </>}

      {selectedAccount && (
        <section aria-labelledby="journal-lines-title" className="overflow-hidden rounded-xl border border-sky-900/70 bg-zinc-950">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div>
              <h2 id="journal-lines-title" className="font-semibold text-zinc-100">{selectedAccount} - journal detail</h2>
              <p className="mt-1 text-xs text-zinc-500">{selectedDescription}</p>
            </div>
            <button type="button" onClick={() => setSelectedAccount('')} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 hover:bg-zinc-900">Close detail</button>
          </div>
          {journalBusy && <div role="status" className="p-4 text-sm text-zinc-400">Loading journal detail...</div>}
          {journalError && <div role="alert" className="p-4 text-sm text-rose-300">{journalError}</div>}
          {journalLines && (!journalBusy || journalOffset > 0) && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-zinc-900/70 text-xs uppercase tracking-wide text-zinc-500">
                    <tr><th className="px-4 py-3">Posted</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Journal ID</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {journalLines.entries.map(line => (
                      <tr key={`${line.journalEntryId}-${line.accountCode}`}>
                        <td className="px-4 py-3 text-zinc-300">{new Date(line.postedAt).toLocaleString(undefined, { timeZone: outletTimeZone })}</td>
                        <td className="px-4 py-3 text-zinc-300">{line.sourceType}{line.sourceId ? ` - ${line.sourceId.slice(0, 8)}` : ''}</td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-500">{line.journalEntryId}</td>
                        <td className="px-4 py-3 text-right font-mono">{formatMinor(line.debitMinor, currency)}</td>
                        <td className="px-4 py-3 text-right font-mono">{formatMinor(line.creditMinor, currency)}</td>
                      </tr>
                    ))}
                    {journalLines.entries.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-500">No journal lines for this account in the selected scope.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
                <span className="text-xs text-zinc-500">Showing {journalLines.entries.length} of {journalLines.total} source lines</span>
                {journalLines.nextOffset !== null && <button type="button" onClick={() => setJournalOffset(journalLines.nextOffset ?? 0)} disabled={journalBusy} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-50">Load next 100 entries</button>}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  </section>;
}

function CoverageDetails({ entryCount, emptyCount, unbalancedCount, sourceTypes, omissions = [], unknownAccounts = [] }: {
  entryCount: string; emptyCount: string; unbalancedCount: string; sourceTypes: Array<{ sourceType: string; entryCount: string }>; omissions?: string[]; unknownAccounts?: string[];
}) {
  return <details className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm">
    <summary className="min-h-11 cursor-pointer py-2 font-medium text-zinc-200">Coverage and source checks</summary>
    <div className="mt-3 grid gap-4 lg:grid-cols-3">
      <div><h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Journal checks</h3><p className="mt-2 text-zinc-300">{entryCount} entries · {emptyCount} empty · {unbalancedCount} unbalanced</p></div>
      <div><h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Included sources</h3><ul className="mt-2 space-y-1 text-zinc-300">{sourceTypes.length ? sourceTypes.map(item => <li key={item.sourceType}>{item.sourceType}: {item.entryCount}</li>) : <li>No journal source types in scope.</li>}</ul></div>
      {(omissions.length > 0 || unknownAccounts.length > 0) && <div><h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Not included or classified</h3><ul className="mt-2 space-y-1 text-zinc-300">{omissions.map(item => <li key={item}>• {item}</li>)}{unknownAccounts.map(item => <li key={item}>Unmapped account: {item}</li>)}</ul></div>}
    </div>
  </details>;
}
