import React, { useState } from 'react';
import { SaleOrder, TenantProfile, PaymentMethod } from '../../types/erp';
import { storage } from '../../services/storage';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import {
  History,
  Search,
  Printer,
  RotateCcw,
  Download,
  Filter,
  Calendar,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Banknote,
  Smartphone,
  Hotel,
  Users,
  ChevronDown,
  ArrowRight
} from 'lucide-react';

interface SalesHistoryViewProps {
  tenant: TenantProfile;
  onReprintOrder: (order: SaleOrder) => void;
}

export const SalesHistoryView: React.FC<SalesHistoryViewProps> = ({
  tenant,
  onReprintOrder,
}) => {
  const [orders, setOrders] = useState<SaleOrder[]>(storage.getOrders());
  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'refunded'>('all');

  // Selected Order Detail Inspection
  const [inspectOrder, setInspectOrder] = useState<SaleOrder | null>(null);

  // Refund Order Modal
  const [refundOrderTarget, setRefundOrderTarget] = useState<SaleOrder | null>(null);
  const [refundReason, setRefundReason] = useState('Customer returned undamaged merchandise');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  const refreshData = () => {
    setOrders([...storage.getOrders()]);
  };

  const showToast = (msg: string) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(null), 3000);
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch =
      order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.cashierName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (order.customerAccountRef && order.customerAccountRef.customerName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (order.roomChargeRef && order.roomChargeRef.roomNumber.includes(searchQuery));

    if (!matchesSearch) return false;

    if (methodFilter !== 'all' && order.paymentMethod !== methodFilter) return false;
    if (statusFilter !== 'all') {
      const isRefunded = order.status === 'refunded';
      if (statusFilter === 'refunded' && !isRefunded) return false;
      if (statusFilter === 'completed' && isRefunded) return false;
    }

    return true;
  });

  const totalSalesRevenue = filteredOrders
    .filter(o => o.status !== 'refunded')
    .reduce((acc, o) => acc + o.total, 0);

  const totalRefundedRevenue = filteredOrders
    .filter(o => o.status === 'refunded')
    .reduce((acc, o) => acc + o.total, 0);

  const handleConfirmRefund = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundOrderTarget) return;

    try {
      storage.refundOrder(refundOrderTarget.id, refundReason, refundMethod);
      showToast(`Order #${refundOrderTarget.orderNumber} successfully refunded & inventory restored.`);
      setRefundOrderTarget(null);
      refreshData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Refund was not completed. Check the local record before retrying.');
    }
  };

  const handleExportCSV = () => {
    const headers = ['OrderNumber,Timestamp,Cashier,Total,Subtotal,Tax,PaymentMethod,Status,ItemsCount'];
    const rows = filteredOrders.map(o =>
      `"${o.orderNumber}","${o.timestamp}","${o.cashierName}",${o.total},${o.subtotal},${o.tax},"${o.paymentMethod}","${o.status || 'completed'}",${o.items.length}`
    );
    const csv = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csv);
    link.download = `Mazao_Sales_History_${tenant.id}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getMethodBadge = (method: PaymentMethod) => {
    switch (method) {
      case 'cash':
        return <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-mono"><Banknote className="w-3 h-3" /> Cash</span>;
      case 'card':
        return <span className="inline-flex items-center gap-1 text-[10px] text-blue-400 font-mono"><CreditCard className="w-3 h-3" /> Card</span>;
      case 'mobile_money':
        return <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-mono"><Smartphone className="w-3 h-3" /> M-Pesa</span>;
      case 'room_folio':
        return <span className="inline-flex items-center gap-1 text-[10px] text-purple-400 font-mono"><Hotel className="w-3 h-3" /> Folio</span>;
      case 'customer_credit':
        return <span className="inline-flex items-center gap-1 text-[10px] text-cyan-400 font-mono"><Users className="w-3 h-3" /> Credit</span>;
      default:
        return <span className="text-[10px] font-mono text-zinc-400">{method}</span>;
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-[#090b10] space-y-6 pb-20 lg:pb-6">
      {/* Toast Feedback */}
      {feedbackToast && (
        <div className="fixed top-16 right-4 z-50 p-3 rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs shadow-xl flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedbackToast}</span>
        </div>
      )}

      {/* Header & Export Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl bg-zinc-950 border border-zinc-850">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold text-zinc-100">Sales Transactions & Receipt Lookup</h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Search orders by receipt number, cashier, customer account, reprint thermal slips, or execute returns
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-200 font-semibold text-xs transition-colors min-h-[40px] shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>Export Transactions CSV</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Total Sales Revenue</div>
          <div className="text-lg sm:text-2xl font-bold font-mono text-emerald-400 tabular-nums truncate">
            {tenant.currencySymbol} {totalSalesRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Completed orders in view</div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Orders Count</div>
          <div className="text-lg sm:text-2xl font-bold font-mono text-zinc-100 tabular-nums">
            {filteredOrders.length}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Receipted transactions</div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Average Order Value</div>
          <div className="text-lg sm:text-2xl font-bold font-mono text-blue-400 tabular-nums truncate">
            {tenant.currencySymbol} {filteredOrders.length > 0 ? (totalSalesRevenue / filteredOrders.length).toFixed(2) : '0.00'}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Per transaction ticket</div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Refunded / Returns</div>
          <div className="text-lg sm:text-2xl font-bold font-mono text-rose-400 tabular-nums truncate">
            {tenant.currencySymbol} {totalRefundedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Reversals & void lines</div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search receipt #, cashier name, customer account, or room number..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-zinc-950 border border-zinc-850 rounded-lg text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 transition-colors min-h-[40px]"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
          <select
            value={methodFilter}
            onChange={e => setMethodFilter(e.target.value)}
            className="px-3 py-2 bg-zinc-950 border border-zinc-850 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-blue-500 min-h-[40px]"
          >
            <option value="all">All Payment Tenders</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="mobile_money">M-Pesa</option>
            <option value="customer_credit">Charge to Account</option>
            <option value="room_folio">Room Folio</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 bg-zinc-950 border border-zinc-850 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-blue-500 min-h-[40px]"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
      </div>

      {/* Orders Table & Mobile Cards */}
      <div className="border border-zinc-850 rounded-xl bg-zinc-950 overflow-hidden shadow-sm">
        {filteredOrders.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 text-xs">
            No sales orders match your current search query or filter.
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-zinc-850 font-mono text-[11px] text-zinc-500 bg-zinc-900/40">
                    <th className="p-3.5">RECEIPT #</th>
                    <th className="p-3.5">DATE & TIME</th>
                    <th className="p-3.5">CASHIER</th>
                    <th className="p-3.5">REFERENCE / ACCOUNT</th>
                    <th className="p-3.5 text-center">TENDER</th>
                    <th className="p-3.5 text-right">TOTAL</th>
                    <th className="p-3.5 text-center">STATUS</th>
                    <th className="p-3.5 text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {filteredOrders.map(order => {
                    const isRefunded = order.status === 'refunded';
                    return (
                      <tr key={order.id} className="hover:bg-zinc-900/50 transition-colors">
                        <td className="p-3.5 font-mono font-bold text-zinc-200">
                          {order.orderNumber}
                        </td>
                        <td className="p-3.5 font-mono text-zinc-400 text-[11px]">
                          {new Date(order.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="p-3.5 text-zinc-300">
                          {order.cashierName}
                        </td>
                        <td className="p-3.5">
                          {order.customerAccountRef ? (
                            <span className="text-[11px] text-cyan-400 font-medium">
                              Customer: {order.customerAccountRef.customerName}
                            </span>
                          ) : order.roomChargeRef ? (
                            <span className="text-[11px] text-purple-400 font-medium">
                              Room {order.roomChargeRef.roomNumber} ({order.roomChargeRef.guestName})
                            </span>
                          ) : (
                            <span className="text-zinc-500 text-[11px]">Counter Direct</span>
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          {getMethodBadge(order.paymentMethod)}
                        </td>
                        <td className="p-3.5 text-right font-mono font-bold tabular-nums">
                          <span className={isRefunded ? 'line-through text-rose-400' : 'text-zinc-100'}>
                            {tenant.currencySymbol} {order.total.toFixed(2)}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                              isRefunded
                                ? 'bg-rose-950 text-rose-400 border border-rose-900'
                                : 'bg-emerald-950 text-emerald-400 border border-emerald-900'
                            }`}
                          >
                            {order.status || 'completed'}
                          </span>
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => onReprintOrder(order)}
                              className="px-2.5 py-1 rounded bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-blue-400 text-xs font-semibold flex items-center gap-1 transition-colors"
                              title="Reprint 80mm receipt"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Reprint</span>
                            </button>
                            <button
                              onClick={() => setInspectOrder(order)}
                              className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 text-xs font-medium transition-colors"
                            >
                              Details
                            </button>
                            {!isRefunded && (
                              <button
                                onClick={() => setRefundOrderTarget(order)}
                                className="px-2 py-1 rounded bg-zinc-900 hover:bg-rose-950/60 border border-zinc-800 hover:border-rose-800 text-zinc-400 hover:text-rose-300 text-xs transition-colors"
                                title="Issue refund / return"
                              >
                                Refund
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-zinc-900">
              {filteredOrders.map(order => {
                const isRefunded = order.status === 'refunded';
                return (
                  <div key={order.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-mono font-bold text-zinc-100">{order.orderNumber}</div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          {new Date(order.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · By {order.cashierName}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-bold text-sm ${isRefunded ? 'line-through text-rose-400' : 'text-zinc-100'}`}>
                          {tenant.currencySymbol} {order.total.toFixed(2)}
                        </div>
                        <div className="mt-0.5">{getMethodBadge(order.paymentMethod)}</div>
                      </div>
                    </div>

                    {order.customerAccountRef && (
                      <div className="text-xs text-cyan-400 font-medium">
                        Charged to: {order.customerAccountRef.customerName}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => onReprintOrder(order)}
                        className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Reprint Receipt</span>
                      </button>
                      <button
                        onClick={() => setInspectOrder(order)}
                        className="flex-1 py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <span>Inspect Items</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 1. ORDER INSPECTION MODAL */}
      <ResponsiveDialog
        isOpen={inspectOrder !== null}
        onClose={() => setInspectOrder(null)}
        title={inspectOrder ? `Order Details: #${inspectOrder.orderNumber}` : ''}
        subtitle={inspectOrder ? `Completed at ${new Date(inspectOrder.timestamp).toLocaleString()} by ${inspectOrder.cashierName}` : ''}
        icon={<History className="w-5 h-5 text-blue-400" />}
        footerActions={
          <div className="flex items-center justify-between w-full">
            <button
              onClick={() => {
                if (inspectOrder) onReprintOrder(inspectOrder);
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              <span>Reprint Receipt</span>
            </button>
            <button
              onClick={() => setInspectOrder(null)}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-xs font-semibold rounded-lg"
            >
              Close
            </button>
          </div>
        }
      >
        {inspectOrder && (
          <div className="space-y-4">
            <div className="border border-zinc-850 rounded-lg overflow-hidden bg-zinc-950">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-zinc-850 text-zinc-500 bg-zinc-900/50 font-mono text-[11px]">
                    <th className="p-3">LINE ITEM</th>
                    <th className="p-3 text-right">QTY</th>
                    <th className="p-3 text-right">UNIT PRICE</th>
                    <th className="p-3 text-right">LINE TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 font-mono">
                  {inspectOrder.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="p-3 font-sans text-zinc-200">{item.product.name}</td>
                      <td className="p-3 text-right">{item.quantity}</td>
                      <td className="p-3 text-right">{tenant.currencySymbol} {item.unitPrice.toFixed(2)}</td>
                      <td className="p-3 text-right font-bold text-zinc-100">
                        {tenant.currencySymbol} {(item.quantity * item.unitPrice).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-zinc-900 rounded-lg space-y-1.5 text-xs font-mono">
              <div className="flex justify-between text-zinc-400">
                <span>Subtotal:</span>
                <span>{tenant.currencySymbol} {inspectOrder.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Tax ({Math.round(tenant.taxRate * 100)}%):</span>
                <span>{tenant.currencySymbol} {inspectOrder.tax.toFixed(2)}</span>
              </div>
              <div className="border-t border-zinc-800 pt-1.5 flex justify-between font-bold text-sm text-zinc-100">
                <span>Total Due:</span>
                <span className="text-blue-400">{tenant.currencySymbol} {inspectOrder.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}
      </ResponsiveDialog>

      {/* 2. ORDER REFUND & RETURN MODAL */}
      <ResponsiveDialog
        isOpen={refundOrderTarget !== null}
        onClose={() => setRefundOrderTarget(null)}
        title="Execute Order Return & Refund"
        subtitle={refundOrderTarget ? `Refunding Order #${refundOrderTarget.orderNumber} (${tenant.currencySymbol} ${refundOrderTarget.total.toFixed(2)})` : ''}
        icon={<RotateCcw className="w-5 h-5 text-rose-400" />}
        footerActions={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              onClick={() => setRefundOrderTarget(null)}
              className="px-4 py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 text-xs font-semibold rounded-lg"
            >
              Cancel
            </button>
            <button
              form="refund-form"
              type="submit"
              className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg shadow-sm"
            >
              Confirm Reversal & Refund
            </button>
          </div>
        }
      >
        <form id="refund-form" onSubmit={handleConfirmRefund} className="space-y-4">
          <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 leading-relaxed">
            Local preview only: this records a full refund, separates the revenue and VAT reversals, restores stock, and adds a local audit entry. It is not an authoritative payment refund.
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Reason for Return *</label>
            <select
              value={refundReason}
              onChange={e => setRefundReason(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-rose-500"
            >
              <option value="Customer returned undamaged merchandise">Customer returned undamaged merchandise</option>
              <option value="Damaged or defective goods detected">Damaged or defective goods detected</option>
              <option value="Incorrect ring-up / Cashier error">Incorrect ring-up / Cashier error</option>
              <option value="Customer change of mind before departure">Customer change of mind before departure</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Refund Disbursement Method *</label>
            <select
              value={refundMethod}
              onChange={e => setRefundMethod(e.target.value as any)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-rose-500"
            >
              <option value="cash">Cash Out of Till Drawer</option>
              <option value="mobile_money">M-Pesa Disbursal</option>
              <option value="card">Card Payment Reversal</option>
            </select>
          </div>
        </form>
      </ResponsiveDialog>
    </div>
  );
};
