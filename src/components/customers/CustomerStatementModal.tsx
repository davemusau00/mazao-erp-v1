import React from 'react';
import { CustomerAccount, CustomerTransaction, TenantProfile } from '../../types/erp';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { Printer, TrendingUp, TrendingDown, Clock, ShieldCheck, CreditCard } from 'lucide-react';

interface CustomerStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: CustomerAccount | null;
  transactions: CustomerTransaction[];
  tenant: TenantProfile;
  onOpenRepay: (customer: CustomerAccount) => void;
}

export const CustomerStatementModal: React.FC<CustomerStatementModalProps> = ({
  isOpen,
  onClose,
  customer,
  transactions,
  tenant,
  onOpenRepay,
}) => {
  if (!customer) return null;

  const handlePrint = () => {
    window.print();
  };

  const totalCharges = transactions
    .filter(t => t.type === 'charge')
    .reduce((acc, t) => acc + t.amount, 0);

  const totalPayments = transactions
    .filter(t => t.type === 'payment')
    .reduce((acc, t) => acc + t.amount, 0);

  const availableCredit = Math.max(0, customer.creditLimit - customer.currentBalance);

  return (
    <ResponsiveDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Customer Credit Statement: ${customer.name}`}
      maxWidth="max-w-2xl"
      footerActions={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 min-h-[44px]"
          >
            Close
          </button>
          <div className="flex items-center gap-2">
            {customer.currentBalance > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRepay(customer);
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white min-h-[44px] flex items-center gap-1.5"
              >
                <CreditCard className="w-4 h-4" />
                <span>Record Repayment</span>
              </button>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-sm transition-all min-h-[44px]"
            >
              <Printer className="w-4 h-4" />
              <span>Print Statement</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Customer Header Summary */}
        <div className="p-4 bg-zinc-950 border border-zinc-850 rounded-xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-850 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-zinc-100">{customer.name}</h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase ${
                    customer.status === 'active'
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                      : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                  }`}
                >
                  {customer.status}
                </span>
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">
                {customer.phone} {customer.email && `· ${customer.email}`}{' '}
                {customer.nationalIdOrTaxId && `· ID/PIN: ${customer.nationalIdOrTaxId}`}
              </div>
            </div>

            <div className="text-left sm:text-right">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold block">
                Current Outstanding Balance
              </span>
              <span className="text-xl font-mono font-bold text-amber-400">
                {tenant.currencySymbol} {customer.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
            <div className="p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800/60">
              <span className="text-[10px] text-zinc-500 block">Credit Limit</span>
              <span className="font-mono font-bold text-zinc-200">
                {tenant.currencySymbol} {customer.creditLimit.toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800/60">
              <span className="text-[10px] text-zinc-500 block">Available Credit</span>
              <span className={`font-mono font-bold ${availableCredit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {tenant.currencySymbol} {availableCredit.toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800/60">
              <span className="text-[10px] text-zinc-500 block">Lifetime Charges</span>
              <span className="font-mono font-bold text-zinc-300">
                {tenant.currencySymbol} {totalCharges.toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800/60">
              <span className="text-[10px] text-zinc-500 block">Lifetime Payments</span>
              <span className="font-mono font-bold text-emerald-400">
                {tenant.currencySymbol} {totalPayments.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Transactions Ledger */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
            <span>Transaction Ledger & Audit Trail</span>
            <span className="text-[11px] text-zinc-500">{transactions.length} record(s)</span>
          </div>

          {transactions.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 bg-zinc-950/50 rounded-lg border border-zinc-850 text-xs">
              No transactions recorded for this customer yet.
            </div>
          ) : (
            <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-zinc-900/80 text-zinc-400 text-[10px] uppercase font-semibold border-b border-zinc-800">
                    <tr>
                      <th className="px-3 py-2">Date / Time</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-right">Running Balance</th>
                      <th className="px-3 py-2">Cashier / Staff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-850">
                    {transactions.map(tx => {
                      const isCharge = tx.type === 'charge';
                      return (
                        <tr key={tx.id} className="hover:bg-zinc-900/40">
                          <td className="px-3 py-2.5 text-zinc-400 whitespace-nowrap font-mono text-[11px]">
                            {new Date(tx.timestamp).toLocaleDateString()}{' '}
                            <span className="text-zinc-500 text-[10px]">
                              {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                isCharge
                                  ? 'bg-amber-950/40 text-amber-300 border border-amber-800/40'
                                  : 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40'
                              }`}
                            >
                              {isCharge ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              <span>{tx.type}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-200">
                            <div>{tx.reference}</div>
                            {tx.notes && <div className="text-[10px] text-zinc-500 italic truncate max-w-[180px]">{tx.notes}</div>}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap ${isCharge ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {isCharge ? '+' : '-'}{tenant.currencySymbol} {tx.amount.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-zinc-100 whitespace-nowrap">
                            {tenant.currencySymbol} {tx.runningBalance.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-zinc-400 whitespace-nowrap text-[11px]">
                            {tx.cashierName}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </ResponsiveDialog>
  );
};
