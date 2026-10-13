import React, { useState } from 'react';
import { LedgerEntry, TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import {
  Scale,
  Download,
  Filter,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Landmark,
  ArrowRight
} from 'lucide-react';

interface LedgerViewProps {
  tenant: TenantProfile;
}

export const LedgerView: React.FC<LedgerViewProps> = ({ tenant }) => {
  const [entries, setEntries] = useState<LedgerEntry[]>(storage.getLedgerEntries());
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const categories = ['all', ...Array.from(new Set(entries.map(e => e.category)))];
  const accountDisplay = (account: string, alternate?: string) => {
    const value = accountTotals[account] ?? (alternate ? accountTotals[alternate] : undefined);
    return value === undefined ? 'No source data' : `${tenant.currencySymbol} ${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const filteredEntries = entries.filter(e => {
    if (categoryFilter === 'all') return true;
    return e.category === categoryFilter;
  });

  const totalDebits = entries.reduce((acc, e) => acc + e.amount, 0);
  const totalCredits = entries.reduce((acc, e) => acc + e.amount, 0);

  // Account Summaries
  const accountTotals = entries.reduce((acc, e) => {
    acc[e.debitAccount] = (acc[e.debitAccount] || 0) + e.amount;
    acc[e.creditAccount] = (acc[e.creditAccount] || 0) - e.amount;
    return acc;
  }, {} as Record<string, number>);

  const handleExportCSV = () => {
    const headers = ['ID,Timestamp,Reference,Category,Description,Debit Account,Credit Account,Amount'];
    const rows = entries.map(e =>
      `"${e.id}","${e.timestamp}","${e.reference}","${e.category}","${e.description}","${e.debitAccount}","${e.creditAccount}",${e.amount}`
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Mazao_General_Ledger_${tenant.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-[#090b10] space-y-6 pb-20 lg:pb-6">
      {/* Header & Invariant Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl bg-zinc-950 border border-zinc-850">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold text-zinc-100">Ledger Preview</h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Browser-local sample entries. No accounting authority or trial balance validation is connected.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950/50 border border-amber-800/50 text-amber-200 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Not reconciled</span>
          </div>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-xs font-medium text-zinc-200 transition-colors min-h-[38px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Account Balances Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>Operating Bank</span>
            <Landmark className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-lg sm:text-xl font-bold font-mono text-zinc-100 tabular-nums truncate">
            {accountDisplay('Operating Bank Account')}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Liquid operational balance</div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>Till Cash</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-lg sm:text-xl font-bold font-mono text-emerald-400 tabular-nums truncate">
            {accountDisplay('Cash in Till (Drawer)')}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Cashier drawer holdings</div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>AR Guest Folios</span>
            <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-lg sm:text-xl font-bold font-mono text-amber-400 tabular-nums truncate">
            {accountDisplay('Accounts Receivable - Guest Ledger', 'Accounts Receivable - Guest Folios')}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Unsettled guest balances</div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>VAT Payable</span>
            <Scale className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-lg sm:text-xl font-bold font-mono text-purple-400 tabular-nums truncate">
            {accountDisplay('VAT Payable')}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Statutory tax liability</div>
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors min-h-[38px] ${
              categoryFilter === cat
                ? 'bg-zinc-800 text-zinc-100 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* MOBILE / NARROW TERMINAL VIEW (< md): Responsive Transaction Cards */}
      <div className="grid grid-cols-1 gap-2.5 md:hidden">
        {filteredEntries.map(e => (
          <div key={e.id} className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-850 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-zinc-200">{e.reference}</span>
              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono bg-zinc-900 border border-zinc-800 text-zinc-400">
                {e.category}
              </span>
            </div>

            <p className="text-zinc-200 font-medium">{e.description}</p>

            <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-850/80 space-y-1 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-zinc-500">DR:</span>
                <span className="text-blue-400 truncate max-w-[200px]">{e.debitAccount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">CR:</span>
                <span className="text-emerald-400 truncate max-w-[200px]">{e.creditAccount}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-zinc-900 font-mono">
              <span className="text-[10px] text-zinc-500">
                {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="font-bold text-zinc-100 tabular-nums">
                {tenant.currencySymbol} {e.amount.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* DESKTOP VIEW (≥ md): Full Journal Table */}
      <div className="hidden md:block border border-zinc-850 rounded-xl bg-zinc-950 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-zinc-850 text-zinc-500 font-mono text-[11px] bg-zinc-950/80">
                <th className="p-3.5">DATE / TIME</th>
                <th className="p-3.5">REF</th>
                <th className="p-3.5">CATEGORY</th>
                <th className="p-3.5">DESCRIPTION</th>
                <th className="p-3.5">DEBIT ACCOUNT (DR)</th>
                <th className="p-3.5">CREDIT ACCOUNT (CR)</th>
                <th className="p-3.5 text-right">AMOUNT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {filteredEntries.map(e => (
                <tr key={e.id} className="hover:bg-zinc-900/40 transition-colors">
                  <td className="p-3.5 font-mono text-zinc-400 text-[11px] whitespace-nowrap">
                    {new Date(e.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="p-3.5 font-mono text-zinc-300 font-semibold">{e.reference}</td>
                  <td className="p-3.5">
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono bg-zinc-900 border border-zinc-800 text-zinc-400">
                      {e.category}
                    </span>
                  </td>
                  <td className="p-3.5 text-zinc-200 font-medium max-w-xs truncate">{e.description}</td>
                  <td className="p-3.5 font-mono text-blue-400">{e.debitAccount}</td>
                  <td className="p-3.5 font-mono text-emerald-400">{e.creditAccount}</td>
                  <td className="p-3.5 text-right font-mono font-bold text-zinc-100 tabular-nums whitespace-nowrap">
                    {tenant.currencySymbol} {e.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
