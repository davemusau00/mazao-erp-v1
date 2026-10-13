import React from 'react';
import { CustomerTransaction, CustomerAccount, TenantProfile } from '../../types/erp';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { Printer, CheckCircle2 } from 'lucide-react';

interface RepaymentReceiptModalProps {
  transaction: CustomerTransaction | null;
  customer: CustomerAccount | null;
  tenant: TenantProfile;
  previousBalance: number;
  onClose: () => void;
}

export const RepaymentReceiptModal: React.FC<RepaymentReceiptModalProps> = ({
  transaction,
  customer,
  tenant,
  previousBalance,
  onClose,
}) => {
  if (!transaction || !customer) return null;

  const handleBrowserPrint = () => {
    window.print();
  };

  return (
    <ResponsiveDialog
      isOpen={Boolean(transaction)}
      onClose={onClose}
      title="Repayment Official Receipt"
      maxWidth="max-w-md"
      footerActions={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 min-h-[44px]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleBrowserPrint}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-sm transition-all min-h-[44px]"
          >
            <Printer className="w-4 h-4" />
            <span>Print Receipt</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Success Banner */}
        <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-lg flex items-center gap-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Payment successfully recorded to general ledger and customer credit account.</span>
        </div>

        {/* 80mm ESC/POS Thermal Receipt Preview */}
        <div className="bg-white text-zinc-900 p-5 rounded font-mono text-xs shadow-inner border border-zinc-300 max-w-[340px] mx-auto select-text print:max-w-none print:shadow-none print:border-none print:p-0">
          {/* Header */}
          <div className="text-center font-bold text-sm tracking-tight mb-0.5">
            {tenant.name.toUpperCase()}
          </div>
          <div className="text-center text-[10px] text-zinc-600 mb-0.5">{tenant.tagline}</div>
          <div className="text-center text-[9px] text-zinc-500 mb-2">
            {tenant.address} · {tenant.phone}
          </div>

          <div className="border-t border-dashed border-zinc-400 my-2"></div>

          <div className="text-center font-bold text-xs tracking-wider mb-1 text-zinc-900">
            OFFICIAL CREDIT REPAYMENT RECEIPT
          </div>

          <div className="flex justify-between text-[10px]">
            <span>REF: {transaction.reference}</span>
            <span>{new Date(transaction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="flex justify-between text-[10px] mb-1">
            <span>DATE: {new Date(transaction.timestamp).toLocaleDateString()}</span>
            <span>STAFF: {transaction.cashierName}</span>
          </div>

          <div className="border-t border-dashed border-zinc-400 my-2"></div>

          {/* Customer Details Box */}
          <div className="bg-zinc-50 p-2 rounded border border-zinc-200 text-[10px] space-y-0.5">
            <div className="font-bold text-zinc-900">CUSTOMER: {customer.name.toUpperCase()}</div>
            <div className="text-zinc-600">PHONE: {customer.phone}</div>
            {customer.nationalIdOrTaxId && (
              <div className="text-zinc-600">ID / TAX PIN: {customer.nationalIdOrTaxId}</div>
            )}
          </div>

          <div className="border-t border-dashed border-zinc-400 my-2"></div>

          {/* Repayment Breakdown */}
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between text-zinc-600">
              <span>Previous Balance:</span>
              <span className="tabular-nums font-semibold">{tenant.currencySymbol} {previousBalance.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-emerald-800 text-xs py-0.5 border-y border-zinc-200">
              <span>AMOUNT RECEIVED:</span>
              <span className="tabular-nums">{tenant.currencySymbol} {transaction.amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-zinc-900 pt-0.5">
              <span>REMAINING BALANCE:</span>
              <span className="tabular-nums">{tenant.currencySymbol} {transaction.runningBalance.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-zinc-500 pt-1">
              <span>Payment Tender:</span>
              <span className="uppercase font-semibold text-zinc-800">
                {(transaction.paymentMethod || 'cash').replace('_', ' ')}
              </span>
            </div>
            {transaction.notes && (
              <div className="text-[10px] text-zinc-600 pt-0.5 italic">
                Note: {transaction.notes}
              </div>
            )}
          </div>

          <div className="border-t border-dashed border-zinc-400 my-2.5"></div>

          <div className="text-center text-[9px] text-zinc-600 leading-tight">
            Thank you for settling your account promptly. Your credit balance has been updated in our system.
          </div>
          <div className="text-center text-[8px] text-zinc-400 mt-2 font-sans">
            Mazao ERP Multi-Tenant Ledger Engine
          </div>
        </div>
      </div>
    </ResponsiveDialog>
  );
};
