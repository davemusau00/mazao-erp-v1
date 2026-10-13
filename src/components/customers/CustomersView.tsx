import React, { useState } from 'react';
import { CustomerAccount, CustomerTransaction, PaymentMethod, TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import {
  Users,
  Search,
  Plus,
  CreditCard,
  Banknote,
  Smartphone,
  FileText,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Phone,
  Mail,
  UserCheck,
  UserX,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Filter,
  Receipt
} from 'lucide-react';

interface CustomersViewProps {
  tenant: TenantProfile;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ tenant }) => {
  const [customers, setCustomers] = useState<CustomerAccount[]>(storage.getCustomers());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'with_balance' | 'active' | 'suspended'>('all');

  // Customer Detail / Statement Drawer Modal
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerAccount | null>(null);
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);

  // Add / Edit Customer Modal
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerAccount | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formTaxId, setFormTaxId] = useState('');
  const [formCreditLimit, setFormCreditLimit] = useState('10000');
  const [formNotes, setFormNotes] = useState('');
  const [formStatus, setFormStatus] = useState<'active' | 'suspended'>('active');

  // Receive Payment / Settle Balance Modal
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentCustomer, setPaymentCustomer] = useState<CustomerAccount | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mobile_money');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [lastPaymentSlip, setLastPaymentSlip] = useState<{
    tx: CustomerTransaction;
    customer: CustomerAccount;
  } | null>(null);

  const refreshData = () => {
    const list = storage.getCustomers();
    setCustomers(list);
    if (selectedCustomer) {
      const refreshed = list.find(c => c.id === selectedCustomer.id);
      if (refreshed) {
        setSelectedCustomer(refreshed);
        setTransactions(storage.getCustomerTransactions(refreshed.id));
      }
    }
  };

  // Filtered customer list
  const filteredCustomers = customers.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery) ||
      (c.email && c.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.nationalIdOrTaxId && c.nationalIdOrTaxId.includes(searchQuery));

    if (!matchesSearch) return false;

    if (statusFilter === 'with_balance') return c.currentBalance > 0;
    if (statusFilter === 'active') return c.status === 'active';
    if (statusFilter === 'suspended') return c.status === 'suspended';
    return true;
  });

  // KPI Calculations
  const totalOutstanding = customers.reduce((acc, c) => acc + c.currentBalance, 0);
  const totalCreditLimit = customers.reduce((acc, c) => acc + c.creditLimit, 0);
  const activeDebtorsCount = customers.filter(c => c.currentBalance > 0).length;
  const suspendedCount = customers.filter(c => c.status === 'suspended').length;

  const handleOpenAddCustomer = () => {
    setEditingCustomer(null);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormTaxId('');
    setFormCreditLimit('10000');
    setFormNotes('');
    setFormStatus('active');
    setIsCustomerModalOpen(true);
  };

  const handleOpenEditCustomer = (cust: CustomerAccount) => {
    setEditingCustomer(cust);
    setFormName(cust.name);
    setFormPhone(cust.phone);
    setFormEmail(cust.email || '');
    setFormTaxId(cust.nationalIdOrTaxId || '');
    setFormCreditLimit(cust.creditLimit.toString());
    setFormNotes(cust.notes || '');
    setFormStatus(cust.status);
    setIsCustomerModalOpen(true);
  };

  const handleSaveCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formPhone.trim()) return;

    const limit = parseFloat(formCreditLimit) || 0;

    if (editingCustomer) {
      storage.updateCustomer({
        ...editingCustomer,
        name: formName.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim() || undefined,
        nationalIdOrTaxId: formTaxId.trim() || undefined,
        creditLimit: limit,
        notes: formNotes.trim() || undefined,
        status: formStatus,
      });
    } else {
      storage.createCustomer({
        tenantId: tenant.id,
        name: formName.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim() || undefined,
        nationalIdOrTaxId: formTaxId.trim() || undefined,
        creditLimit: limit,
        currentBalance: 0,
        status: formStatus,
        notes: formNotes.trim() || undefined,
      });
    }

    setIsCustomerModalOpen(false);
    refreshData();
  };

  const handleOpenStatement = (cust: CustomerAccount) => {
    setSelectedCustomer(cust);
    setTransactions(storage.getCustomerTransactions(cust.id));
  };

  const handleOpenPaymentModal = (cust: CustomerAccount) => {
    setPaymentCustomer(cust);
    setPaymentAmount(cust.currentBalance.toString());
    setPaymentMethod('mobile_money');
    setPaymentReference('PAY-' + Math.floor(10000 + Math.random() * 90000));
    setPaymentNotes('');
    setIsPaymentModalOpen(true);
  };

  const handleConfirmPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentCustomer) return;

    const amt = parseFloat(paymentAmount) || 0;
    if (amt <= 0) return;

    const tx = storage.settleCustomerAccount(
      paymentCustomer.id,
      amt,
      paymentMethod,
      paymentReference || 'PAY-' + Date.now(),
      paymentNotes
    );

    setLastPaymentSlip({ tx, customer: paymentCustomer });
    setIsPaymentModalOpen(false);
    refreshData();
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-[#090b10] space-y-6 pb-20 lg:pb-6">
      {/* Header & KPI Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl bg-zinc-950 border border-zinc-850">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold text-zinc-100">Customer Directory & Credit Accounts</h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Manage credit limits, charge-to-account authorizations, and settle customer balances
          </p>
        </div>

        <button
          onClick={handleOpenAddCustomer}
          className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-sm transition-colors min-h-[40px] shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Customer Account</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Total Outstanding Credit</div>
          <div className="text-lg sm:text-2xl font-bold font-mono text-amber-400 tabular-nums truncate">
            {tenant.currencySymbol} {totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">
            Across {activeDebtorsCount} customer account{activeDebtorsCount === 1 ? '' : 's'}
          </div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Total Credit Line Offered</div>
          <div className="text-lg sm:text-2xl font-bold font-mono text-zinc-100 tabular-nums truncate">
            {tenant.currencySymbol} {totalCreditLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">
            Authorized store credit limits
          </div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Active Accounts</div>
          <div className="text-lg sm:text-2xl font-bold font-mono text-emerald-400 tabular-nums">
            {customers.filter(c => c.status === 'active').length}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">
            In good standing
          </div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Suspended / On Hold</div>
          <div className="text-lg sm:text-2xl font-bold font-mono text-rose-400 tabular-nums">
            {suspendedCount}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">
            Credit limits locked
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search customer name, phone, national ID, or email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-zinc-950 border border-zinc-850 rounded-lg text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 transition-colors min-h-[40px]"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto shrink-0 pb-1 sm:pb-0 scrollbar-none">
          {(['all', 'with_balance', 'active', 'suspended'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap capitalize transition-colors min-h-[36px] ${
                statusFilter === tab
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : 'bg-zinc-900 border border-zinc-850 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Directory Table (Desktop) / Cards (Mobile) */}
      <div className="border border-zinc-850 rounded-xl bg-zinc-950 overflow-hidden shadow-sm">
        {filteredCustomers.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 text-xs">
            No customers match the current search or status filter.
          </div>
        ) : (
          <>
            {/* Desktop Table View (≥ md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-zinc-850 font-mono text-[11px] text-zinc-500 bg-zinc-900/40">
                    <th className="p-3.5">CUSTOMER</th>
                    <th className="p-3.5">CONTACT</th>
                    <th className="p-3.5 text-right">CREDIT LIMIT</th>
                    <th className="p-3.5 text-right">OUTSTANDING</th>
                    <th className="p-3.5 text-right">AVAILABLE CREDIT</th>
                    <th className="p-3.5 text-center">STATUS</th>
                    <th className="p-3.5 text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {filteredCustomers.map(cust => {
                    const availableCredit = Math.max(0, cust.creditLimit - cust.currentBalance);
                    const usagePercent = cust.creditLimit > 0 ? Math.min(100, Math.round((cust.currentBalance / cust.creditLimit) * 100)) : 0;

                    return (
                      <tr key={cust.id} className="hover:bg-zinc-900/50 transition-colors">
                        <td className="p-3.5">
                          <div className="font-semibold text-zinc-200">{cust.name}</div>
                          {cust.notes && (
                            <div className="text-[10px] text-zinc-500 truncate max-w-[200px]">{cust.notes}</div>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-zinc-400">
                          <div>{cust.phone}</div>
                          {cust.email && <div className="text-[10px] text-zinc-500">{cust.email}</div>}
                        </td>
                        <td className="p-3.5 text-right font-mono text-zinc-300 tabular-nums">
                          {tenant.currencySymbol} {cust.creditLimit.toLocaleString()}
                        </td>
                        <td className="p-3.5 text-right font-mono font-bold tabular-nums">
                          <span className={cust.currentBalance > 0 ? 'text-amber-400' : 'text-zinc-500'}>
                            {tenant.currencySymbol} {cust.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td className="p-3.5 text-right font-mono tabular-nums">
                          <div className="text-zinc-200">{tenant.currencySymbol} {availableCredit.toLocaleString()}</div>
                          <div className="w-24 bg-zinc-850 h-1.5 rounded-full ml-auto mt-1 overflow-hidden">
                            <div
                              className={`h-full ${usagePercent >= 90 ? 'bg-rose-500' : usagePercent >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${usagePercent}%` }}
                            />
                          </div>
                        </td>
                        <td className="p-3.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                              cust.status === 'active'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-900'
                                : 'bg-rose-950 text-rose-400 border border-rose-900'
                            }`}
                          >
                            {cust.status}
                          </span>
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {cust.currentBalance > 0 && (
                              <button
                                onClick={() => handleOpenPaymentModal(cust)}
                                className="px-2.5 py-1 rounded bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors"
                                title="Record payment settlement"
                              >
                                Settle
                              </button>
                            )}
                            <button
                              onClick={() => handleOpenStatement(cust)}
                              className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 text-xs font-medium transition-colors"
                              title="View account ledger statement"
                            >
                              Statement
                            </button>
                            <button
                              onClick={() => handleOpenEditCustomer(cust)}
                              className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View (< md) */}
            <div className="md:hidden divide-y divide-zinc-900">
              {filteredCustomers.map(cust => {
                const availableCredit = Math.max(0, cust.creditLimit - cust.currentBalance);
                return (
                  <div key={cust.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-zinc-100">{cust.name}</div>
                        <div className="text-xs text-zinc-400 font-mono">{cust.phone}</div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold shrink-0 ${
                          cust.status === 'active'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-900'
                            : 'bg-rose-950 text-rose-400 border border-rose-900'
                        }`}
                      >
                        {cust.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-850/80 text-xs">
                      <div>
                        <div className="text-[10px] text-zinc-500">Balance Due</div>
                        <div className="font-mono font-bold text-amber-400 text-sm">
                          {tenant.currencySymbol} {cust.currentBalance.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-zinc-500">Available Credit</div>
                        <div className="font-mono text-zinc-200 text-sm">
                          {tenant.currencySymbol} {availableCredit.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      {cust.currentBalance > 0 && (
                        <button
                          onClick={() => handleOpenPaymentModal(cust)}
                          className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                        >
                          <DollarSign className="w-3.5 h-3.5" />
                          <span>Receive Payment</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleOpenStatement(cust)}
                        className="flex-1 py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-200 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Statement</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 1. ADD / EDIT CUSTOMER DIALOG */}
      <ResponsiveDialog
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        title={editingCustomer ? 'Edit Customer Terms & Details' : 'New Customer Account'}
        subtitle="Configure credit limit, account terms, and customer contacts"
        icon={<Users className="w-5 h-5 text-blue-400" />}
        footerActions={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => setIsCustomerModalOpen(false)}
              className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              form="customer-form"
              type="submit"
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm"
            >
              {editingCustomer ? 'Save Terms' : 'Create Account'}
            </button>
          </div>
        }
      >
        <form id="customer-form" onSubmit={handleSaveCustomer} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Customer or Company Name *</label>
            <input
              type="text"
              required
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="e.g. Carol Wanjiku / Tech Solutions Ltd"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-300">Phone Number *</label>
              <input
                type="text"
                required
                value={formPhone}
                onChange={e => setFormPhone(e.target.value)}
                placeholder="+254 700 000 000"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-300">Email Address (Optional)</label>
              <input
                type="email"
                value={formEmail}
                onChange={e => setFormEmail(e.target.value)}
                placeholder="customer@domain.com"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-300">Credit Limit ({tenant.currencySymbol}) *</label>
              <input
                type="number"
                required
                min="0"
                step="100"
                value={formCreditLimit}
                onChange={e => setFormCreditLimit(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-300">National ID / Tax KRA PIN</label>
              <input
                type="text"
                value={formTaxId}
                onChange={e => setFormTaxId(e.target.value)}
                placeholder="National ID or Tax Pin"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Account Status</label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                <input
                  type="radio"
                  name="status"
                  checked={formStatus === 'active'}
                  onChange={() => setFormStatus('active')}
                  className="text-blue-600 bg-zinc-900 border-zinc-800"
                />
                <span>Active (Authorized to charge)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                <input
                  type="radio"
                  name="status"
                  checked={formStatus === 'suspended'}
                  onChange={() => setFormStatus('suspended')}
                  className="text-rose-600 bg-zinc-900 border-zinc-800"
                />
                <span>Suspended (Credit blocked)</span>
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Account Notes & Agreement Terms</label>
            <textarea
              rows={2}
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              placeholder="e.g. 30-day net payment terms. Authorized buyer for office pantry."
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </form>
      </ResponsiveDialog>

      {/* 2. RECEIVE PAYMENT / SETTLE CREDIT MODAL */}
      <ResponsiveDialog
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        title="Receive Credit Repayment"
        subtitle={paymentCustomer ? `Customer: ${paymentCustomer.name} · Current Balance: ${tenant.currencySymbol} ${paymentCustomer.currentBalance.toFixed(2)}` : ''}
        icon={<DollarSign className="w-5 h-5 text-emerald-400" />}
        footerActions={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => setIsPaymentModalOpen(false)}
              className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-300 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              form="settle-form"
              type="submit"
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm"
            >
              Confirm Settlement
            </button>
          </div>
        }
      >
        <form id="settle-form" onSubmit={handleConfirmPayment} className="space-y-4">
          <div className="p-3.5 rounded-lg bg-zinc-900/80 border border-zinc-800 flex justify-between items-center">
            <div>
              <div className="text-[11px] text-zinc-400">Total Outstanding Balance</div>
              <div className="text-lg font-bold font-mono text-amber-400">
                {tenant.currencySymbol} {paymentCustomer?.currentBalance.toFixed(2)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPaymentAmount(paymentCustomer ? paymentCustomer.currentBalance.toString() : '0')}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-xs font-medium"
            >
              Pay Full Balance
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Payment Amount ({tenant.currencySymbol}) *</label>
            <input
              type="number"
              required
              min="1"
              step="any"
              max={paymentCustomer?.currentBalance}
              value={paymentAmount}
              onChange={e => setPaymentAmount(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-100 font-mono font-bold focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Settlement Tender Method *</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'mobile_money', label: 'M-Pesa Till', icon: <Smartphone className="w-4 h-4 text-emerald-400" /> },
                { id: 'cash', label: 'Cash Drawer', icon: <Banknote className="w-4 h-4 text-amber-400" /> },
                { id: 'card', label: 'Bank Card', icon: <CreditCard className="w-4 h-4 text-blue-400" /> },
              ].map(method => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => setPaymentMethod(method.id as PaymentMethod)}
                  className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1.5 transition-colors ${
                    paymentMethod === method.id
                      ? 'bg-blue-600/15 border-blue-500 text-blue-300'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-850'
                  }`}
                >
                  {method.icon}
                  <span>{method.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Transaction Reference #</label>
            <input
              type="text"
              value={paymentReference}
              onChange={e => setPaymentReference(e.target.value)}
              placeholder="e.g. M-Pesa Code QXT81928"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Settlement Notes (Optional)</label>
            <input
              type="text"
              value={paymentNotes}
              onChange={e => setPaymentNotes(e.target.value)}
              placeholder="e.g. Partial repayment for invoice ORD-84102"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </form>
      </ResponsiveDialog>

      {/* 3. CUSTOMER ACCOUNT STATEMENT MODAL */}
      <ResponsiveDialog
        isOpen={selectedCustomer !== null}
        onClose={() => setSelectedCustomer(null)}
        title={`Account Statement: ${selectedCustomer?.name || ''}`}
        subtitle={`Phone: ${selectedCustomer?.phone || ''} · Limit: ${tenant.currencySymbol} ${selectedCustomer?.creditLimit.toLocaleString()}`}
        icon={<FileText className="w-5 h-5 text-blue-400" />}
        maxWidth="2xl"
        footerActions={
          <div className="flex items-center justify-between w-full">
            <div className="text-xs font-mono text-zinc-400">
              Current Balance: <span className="text-amber-400 font-bold">{tenant.currencySymbol} {selectedCustomer?.currentBalance.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              {selectedCustomer && selectedCustomer.currentBalance > 0 && (
                <button
                  onClick={() => {
                    const c = selectedCustomer;
                    setSelectedCustomer(null);
                    handleOpenPaymentModal(c);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                >
                  Settle Balance
                </button>
              )}
              <button
                onClick={() => setSelectedCustomer(null)}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold"
              >
                Close Statement
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 p-3 bg-zinc-900 rounded-lg border border-zinc-850 text-xs">
            <div>
              <div className="text-[10px] text-zinc-500 uppercase font-mono">Credit Limit</div>
              <div className="font-mono font-bold text-zinc-200">
                {tenant.currencySymbol} {selectedCustomer?.creditLimit.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase font-mono">Current Balance</div>
              <div className="font-mono font-bold text-amber-400">
                {tenant.currencySymbol} {selectedCustomer?.currentBalance.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase font-mono">Available Credit</div>
              <div className="font-mono font-bold text-emerald-400">
                {tenant.currencySymbol} {selectedCustomer ? Math.max(0, selectedCustomer.creditLimit - selectedCustomer.currentBalance).toFixed(2) : 0}
              </div>
            </div>
          </div>

          <div className="border border-zinc-850 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-zinc-900/60 border-b border-zinc-850 text-[11px] font-mono text-zinc-400 font-semibold uppercase">
              Transaction History Statement ({transactions.length} entries)
            </div>

            {transactions.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">
                No charges or payment settlements recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-zinc-900 max-h-72 overflow-y-auto">
                {transactions.map(tx => (
                  <div key={tx.id} className="p-3 text-xs flex items-center justify-between hover:bg-zinc-900/40">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-1.5 rounded-lg ${tx.type === 'payment' ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-amber-950 text-amber-400 border border-amber-900'}`}>
                        {tx.type === 'payment' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="font-medium text-zinc-200 flex items-center gap-1.5">
                          <span>{tx.type === 'payment' ? 'Credit Repayment' : 'POS Charge'}</span>
                          <span className="font-mono text-[10px] text-zinc-500">({tx.reference})</span>
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {new Date(tx.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · By {tx.cashierName}
                          {tx.notes && ` · ${tx.notes}`}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className={`font-mono font-bold ${tx.type === 'payment' ? 'text-emerald-400' : 'text-zinc-200'}`}>
                        {tx.type === 'payment' ? '-' : '+'} {tenant.currencySymbol} {tx.amount.toFixed(2)}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-500">
                        Bal: {tenant.currencySymbol} {tx.runningBalance.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ResponsiveDialog>

      {/* 4. PAYMENT RECEIPT SLIP POPUP */}
      {lastPaymentSlip && (
        <ResponsiveDialog
          isOpen={true}
          onClose={() => setLastPaymentSlip(null)}
          title="Payment Settlement Receipt"
          subtitle={`Repayment receipt for ${lastPaymentSlip.customer.name}`}
          icon={<Receipt className="w-5 h-5 text-emerald-400" />}
          footerActions={
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                onClick={() => setLastPaymentSlip(null)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg"
              >
                Done
              </button>
            </div>
          }
        >
          <div className="p-4 bg-white text-zinc-950 rounded font-mono text-xs space-y-2 select-all border border-zinc-300">
            <div className="text-center font-bold">{tenant.name.toUpperCase()}</div>
            <div className="text-center text-[10px] text-zinc-600">OFFICIAL CREDIT SETTLEMENT RECEIPT</div>
            <div className="border-t border-dashed border-zinc-400 my-2"></div>
            <div className="flex justify-between">
              <span>CUSTOMER:</span>
              <span className="font-bold">{lastPaymentSlip.customer.name}</span>
            </div>
            <div className="flex justify-between">
              <span>PHONE:</span>
              <span>{lastPaymentSlip.customer.phone}</span>
            </div>
            <div className="flex justify-between">
              <span>REF CODE:</span>
              <span>{lastPaymentSlip.tx.reference}</span>
            </div>
            <div className="flex justify-between">
              <span>DATE/TIME:</span>
              <span>{new Date(lastPaymentSlip.tx.timestamp).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>METHOD:</span>
              <span className="uppercase">{lastPaymentSlip.tx.paymentMethod?.replace('_', ' ')}</span>
            </div>
            <div className="border-t border-dashed border-zinc-400 my-2"></div>
            <div className="flex justify-between text-sm font-bold">
              <span>AMOUNT PAID:</span>
              <span>{tenant.currencySymbol} {lastPaymentSlip.tx.amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-zinc-700">
              <span>REMAINING BAL:</span>
              <span>{tenant.currencySymbol} {lastPaymentSlip.tx.runningBalance.toFixed(2)}</span>
            </div>
            <div className="border-t border-dashed border-zinc-400 my-2"></div>
            <div className="text-center text-[9px] text-zinc-600">
              {tenant.receiptFooter}
            </div>
          </div>
        </ResponsiveDialog>
      )}
    </div>
  );
};
