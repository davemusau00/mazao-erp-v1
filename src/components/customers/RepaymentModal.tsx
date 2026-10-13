import React, { useState, useEffect } from 'react';
import { CustomerAccount, TenantProfile, PaymentMethod, CustomerTransaction } from '../../types/erp';
import { storage } from '../../services/storage';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { Banknote, CreditCard, Smartphone, Building, CheckCircle2, AlertCircle } from 'lucide-react';

interface RepaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: TenantProfile;
  initialCustomer?: CustomerAccount | null;
  onRepaymentComplete: (transaction: CustomerTransaction, customer: CustomerAccount, previousBalance: number) => void;
}

export const RepaymentModal: React.FC<RepaymentModalProps> = ({
  isOpen,
  onClose,
  tenant,
  initialCustomer,
  onRepaymentComplete,
}) => {
  const [customers, setCustomers] = useState<CustomerAccount[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mobile_money');
  const [reference, setReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const tenantCustomers = storage.getCustomers(tenant.id);
      setCustomers(tenantCustomers);
      if (initialCustomer) {
        setSelectedCustomerId(initialCustomer.id);
        setAmount(initialCustomer.currentBalance > 0 ? String(initialCustomer.currentBalance) : '');
      } else if (tenantCustomers.length > 0) {
        const firstWithBalance = tenantCustomers.find(c => c.currentBalance > 0) || tenantCustomers[0];
        setSelectedCustomerId(firstWithBalance.id);
        setAmount(firstWithBalance.currentBalance > 0 ? String(firstWithBalance.currentBalance) : '');
      }
      setReference('PAY-' + Math.random().toString(36).substring(2, 7).toUpperCase());
      setError(null);
    }
  }, [isOpen, initialCustomer, tenant.id]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const parsedAmount = parseFloat(amount) || 0;
  const currentBalance = selectedCustomer?.currentBalance || 0;
  const projectedBalance = Math.max(0, currentBalance - parsedAmount);

  const handleQuickAmount = (val: number) => {
    setAmount(String(Math.min(val, currentBalance)));
  };

  const handleConfirmRepayment = () => {
    if (!selectedCustomer) {
      setError('Please select a customer account');
      return;
    }

    if (parsedAmount <= 0) {
      setError('Repayment amount must be greater than zero');
      return;
    }

    if (parsedAmount > currentBalance) {
      setError(`Repayment cannot exceed current outstanding balance (${tenant.currencySymbol} ${currentBalance.toLocaleString()})`);
      return;
    }

    try {
      const prevBal = selectedCustomer.currentBalance;
      const tx = storage.settleCustomerAccount(
        selectedCustomer.id,
        parsedAmount,
        paymentMethod,
        reference.trim() || `PAY-${Date.now()}`,
        notes.trim() || `Credit debt repayment received via ${paymentMethod.replace('_', ' ')}`
      );

      // Re-fetch updated customer
      const updatedCust = storage.getCustomerById(selectedCustomer.id) || selectedCustomer;
      onRepaymentComplete(tx, updatedCust, prevBal);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to record repayment');
    }
  };

  return (
    <ResponsiveDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Record Customer Debt Repayment"
      maxWidth="max-w-lg"
      footerActions={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmRepayment}
            disabled={!selectedCustomer || parsedAmount <= 0 || parsedAmount > currentBalance}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold text-xs shadow-sm transition-all min-h-[44px]"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Confirm & Print Receipt</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg flex items-center gap-2.5 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Customer Selector */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Select Customer Account</label>
          <select
            value={selectedCustomerId}
            onChange={e => {
              setSelectedCustomerId(e.target.value);
              const found = customers.find(c => c.id === e.target.value);
              if (found && found.currentBalance > 0) {
                setAmount(String(found.currentBalance));
              }
            }}
            className="w-full p-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-100 min-h-[44px] focus:outline-none focus:border-blue-500"
          >
            {customers.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} · Bal: {tenant.currencySymbol} {c.currentBalance.toLocaleString()} (Limit: {tenant.currencySymbol} {c.creditLimit.toLocaleString()})
              </option>
            ))}
          </select>
        </div>

        {/* Live Customer Debt Summary Card */}
        {selectedCustomer && (
          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Current Outstanding Debt:</span>
              <span className="font-mono font-bold text-amber-400 text-sm">
                {tenant.currencySymbol} {currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Approved Credit Limit:</span>
              <span className="font-mono text-zinc-300">
                {tenant.currencySymbol} {selectedCustomer.creditLimit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="pt-2 border-t border-zinc-850 flex items-center justify-between text-xs">
              <span className="text-zinc-400">Balance After Repayment:</span>
              <span className={`font-mono font-bold ${projectedBalance === 0 ? 'text-emerald-400' : 'text-zinc-200'}`}>
                {tenant.currencySymbol} {projectedBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}

        {/* Payment Tender Method Buttons */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Payment Tender Received</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => setPaymentMethod('mobile_money')}
              className={`p-2.5 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all min-h-[46px] ${
                paymentMethod === 'mobile_money'
                  ? 'bg-emerald-600/15 border-emerald-500 text-emerald-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>M-Pesa / Till</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className={`p-2.5 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all min-h-[46px] ${
                paymentMethod === 'cash'
                  ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <Banknote className="w-4 h-4" />
              <span>Cash in Till</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className={`p-2.5 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all min-h-[46px] ${
                paymentMethod === 'card'
                  ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>Card POS</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className={`p-2.5 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all min-h-[46px] ${
                paymentMethod === 'card'
                  ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <Building className="w-4 h-4" />
              <span>Bank Transfer</span>
            </button>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Repayment Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono text-zinc-500">
              {tenant.currencySymbol}
            </span>
            <input
              type="number"
              step="any"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full pl-12 pr-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-lg font-mono font-bold text-zinc-100 focus:outline-none focus:border-emerald-500 min-h-[44px]"
            />
          </div>

          {/* Quick Amount Pills */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => handleQuickAmount(currentBalance)}
              className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-xs font-medium text-emerald-400 min-h-[32px]"
            >
              Full Debt ({tenant.currencySymbol} {currentBalance.toLocaleString()})
            </button>
            {currentBalance > 0 && (
              <button
                type="button"
                onClick={() => handleQuickAmount(Math.round(currentBalance / 2))}
                className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-xs font-medium text-zinc-300 min-h-[32px]"
              >
                50% ({tenant.currencySymbol} {Math.round(currentBalance / 2).toLocaleString()})
              </button>
            )}
            {[500, 1000, 2000, 5000].map(val => (
              <button
                key={val}
                type="button"
                onClick={() => handleQuickAmount(val)}
                className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-xs font-medium text-zinc-300 min-h-[32px]"
              >
                {tenant.currencySymbol} {val.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        {/* Reference and Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Payment Reference / Code</label>
            <input
              type="text"
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="e.g. M-Pesa Code / Cheque #"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Receipt Notes (Optional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Direct cash handover"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
            />
          </div>
        </div>
      </div>
    </ResponsiveDialog>
  );
};
