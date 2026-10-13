import React, { useState, useEffect } from 'react';
import { CustomerAccount, CustomerTransaction, TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { RepaymentModal } from './RepaymentModal';
import { RepaymentReceiptModal } from './RepaymentReceiptModal';
import { CustomerStatementModal } from './CustomerStatementModal';
import {
  Users,
  Search,
  Plus,
  CreditCard,
  FileText,
  Edit2,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  ShieldAlert,
  Phone,
  Mail,
  UserCheck,
  UserX,
  X
} from 'lucide-react';

interface CustomerDirectoryViewProps {
  tenant: TenantProfile;
}

type FilterTab = 'all' | 'debtors' | 'good_standing' | 'suspended';

export const CustomerDirectoryView: React.FC<CustomerDirectoryViewProps> = ({ tenant }) => {
  const [customers, setCustomers] = useState<CustomerAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  // Modal States
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState(false);
  const [isEditCustomerOpen, setIsEditCustomerOpen] = useState(false);
  const [isRepaymentOpen, setIsRepaymentOpen] = useState(false);
  const [isStatementOpen, setIsStatementOpen] = useState(false);

  // Selected customer pointers
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerAccount | null>(null);

  // Receipt Modal state after repayment
  const [lastRepaymentTx, setLastRepaymentTx] = useState<CustomerTransaction | null>(null);
  const [lastRepaymentCustomer, setLastRepaymentCustomer] = useState<CustomerAccount | null>(null);
  const [lastRepaymentPrevBal, setLastRepaymentPrevBal] = useState<number>(0);

  // Form states for New / Edit Customer
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formIdOrTax, setFormIdOrTax] = useState('');
  const [formCreditLimit, setFormCreditLimit] = useState('10000');
  const [formStatus, setFormStatus] = useState<'active' | 'suspended'>('active');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = () => {
    setCustomers(storage.getCustomers(tenant.id));
  };

  useEffect(() => {
    loadData();
    const unsub = storage.subscribe(() => {
      loadData();
    });
    return unsub;
  }, [tenant.id]);

  // Calculations for KPI Cards
  const totalReceivables = customers.reduce((sum, c) => sum + c.currentBalance, 0);
  const totalApprovedCredit = customers.reduce((sum, c) => sum + c.creditLimit, 0);
  const debtorCount = customers.filter(c => c.currentBalance > 0).length;
  const suspendedCount = customers.filter(c => c.status === 'suspended').length;
  const creditUtilization = totalApprovedCredit > 0 ? (totalReceivables / totalApprovedCredit) * 100 : 0;

  // Filtered customer list
  const filteredCustomers = customers.filter(c => {
    // Tab filter
    if (activeFilter === 'debtors' && c.currentBalance <= 0) return false;
    if (activeFilter === 'good_standing' && c.currentBalance > 0) return false;
    if (activeFilter === 'suspended' && c.status !== 'suspended') return false;

    // Search query
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.nationalIdOrTaxId && c.nationalIdOrTaxId.toLowerCase().includes(q))
    );
  });

  // Handle open New Customer
  const handleOpenNewCustomer = () => {
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormIdOrTax('');
    setFormCreditLimit('10000');
    setFormStatus('active');
    setFormNotes('');
    setFormError(null);
    setIsNewCustomerOpen(true);
  };

  // Handle open Edit Customer
  const handleOpenEditCustomer = (cust: CustomerAccount) => {
    setSelectedCustomer(cust);
    setFormName(cust.name);
    setFormPhone(cust.phone);
    setFormEmail(cust.email || '');
    setFormIdOrTax(cust.nationalIdOrTaxId || '');
    setFormCreditLimit(String(cust.creditLimit));
    setFormStatus(cust.status);
    setFormNotes(cust.notes || '');
    setFormError(null);
    setIsEditCustomerOpen(true);
  };

  // Save New Customer
  const handleSaveNewCustomer = () => {
    if (!formName.trim()) {
      setFormError('Customer name is required');
      return;
    }
    if (!formPhone.trim()) {
      setFormError('Contact phone number is required');
      return;
    }
    const limit = parseFloat(formCreditLimit) || 0;
    if (limit < 0) {
      setFormError('Credit limit cannot be negative');
      return;
    }

    try {
      storage.createCustomer({
        tenantId: tenant.id,
        name: formName.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim() || undefined,
        nationalIdOrTaxId: formIdOrTax.trim() || undefined,
        creditLimit: limit,
        currentBalance: 0,
        status: formStatus,
        notes: formNotes.trim() || undefined,
      });
      setIsNewCustomerOpen(false);
      loadData();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create customer');
    }
  };

  // Save Edit Customer
  const handleSaveEditCustomer = () => {
    if (!selectedCustomer) return;
    if (!formName.trim()) {
      setFormError('Customer name is required');
      return;
    }
    if (!formPhone.trim()) {
      setFormError('Contact phone number is required');
      return;
    }
    const limit = parseFloat(formCreditLimit) || 0;
    if (limit < 0) {
      setFormError('Credit limit cannot be negative');
      return;
    }

    try {
      storage.updateCustomer({
        ...selectedCustomer,
        name: formName.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim() || undefined,
        nationalIdOrTaxId: formIdOrTax.trim() || undefined,
        creditLimit: limit,
        status: formStatus,
        notes: formNotes.trim() || undefined,
      });
      setIsEditCustomerOpen(false);
      loadData();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to update customer');
    }
  };

  // Open Repayment for specific customer
  const handleOpenRepayment = (cust: CustomerAccount) => {
    setSelectedCustomer(cust);
    setIsRepaymentOpen(true);
  };

  // Open Statement for specific customer
  const handleOpenStatement = (cust: CustomerAccount) => {
    setSelectedCustomer(cust);
    setIsStatementOpen(true);
  };

  // On Repayment completed callback
  const handleRepaymentCompleted = (
    tx: CustomerTransaction,
    cust: CustomerAccount,
    prevBal: number
  ) => {
    loadData();
    setLastRepaymentTx(tx);
    setLastRepaymentCustomer(cust);
    setLastRepaymentPrevBal(prevBal);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-5 lg:p-6 overflow-y-auto bg-[#090b10]">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
              <Users className="w-6 h-6 text-blue-400" />
              <span>Customer Directory & Credit Accounts</span>
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-950/60 text-blue-400 border border-blue-800/60">
              {customers.length} Accounts
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Manage customer credit limits, charge-to-account ledgers, and debt settlement collections.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSelectedCustomer(null);
              setIsRepaymentOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors min-h-[40px] shadow-sm"
          >
            <CreditCard className="w-4 h-4" />
            <span>Record Repayment</span>
          </button>
          <button
            type="button"
            onClick={handleOpenNewCustomer}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors min-h-[40px] shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Customer</span>
          </button>
        </div>
      </div>

      {/* Real-Time Receivables KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 mb-4 shrink-0">
        <div className="p-3 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>Total Receivables</span>
            <DollarSign className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-lg sm:text-2xl font-mono font-bold text-amber-400">
            {tenant.currencySymbol} {totalReceivables.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {debtorCount} customer{debtorCount === 1 ? '' : 's'} with outstanding debt
          </div>
        </div>

        <div className="p-3 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>Approved Credit Line</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-lg sm:text-2xl font-mono font-bold text-zinc-100">
            {tenant.currencySymbol} {totalApprovedCredit.toLocaleString(undefined, { minimumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            Portfolio credit facility cap
          </div>
        </div>

        <div className="p-3 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>Credit Utilization</span>
            <CreditCard className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-lg sm:text-2xl font-mono font-bold text-emerald-400">
            {creditUtilization.toFixed(1)}%
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            Active credit capacity used
          </div>
        </div>

        <div className="p-3 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>Account Risk & Holds</span>
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-lg sm:text-2xl font-mono font-bold text-zinc-100">
            {suspendedCount}
          </div>
          <div className="text-[10px] text-rose-400/80 mt-0.5">
            {suspendedCount > 0 ? 'Accounts suspended from credit' : 'All accounts in good standing'}
          </div>
        </div>
      </div>

      {/* Search Bar & Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search customer by name, phone, email, or tax ID..."
            className="w-full pl-9 pr-8 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 min-h-[40px]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap min-h-[36px] ${
              activeFilter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            All Accounts ({customers.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('debtors')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap min-h-[36px] ${
              activeFilter === 'debtors'
                ? 'bg-amber-600 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            Debtors ({debtorCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('good_standing')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap min-h-[36px] ${
              activeFilter === 'good_standing'
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            Zero Balance ({customers.length - debtorCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('suspended')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap min-h-[36px] ${
              activeFilter === 'suspended'
                ? 'bg-rose-600 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            Suspended ({suspendedCount})
          </button>
        </div>
      </div>

      {/* Customer Directory Table (Desktop) / Cards (Mobile) */}
      {filteredCustomers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-zinc-950/60 rounded-xl border border-zinc-850 text-center">
          <Users className="w-10 h-10 text-zinc-600 mb-2" />
          <h3 className="text-sm font-semibold text-zinc-300">No Customers Found</h3>
          <p className="text-xs text-zinc-500 max-w-sm mt-1">
            {searchQuery
              ? `No customer profiles match "${searchQuery}".`
              : 'No customer credit profiles found under this filter.'}
          </p>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-3 px-3 py-1.5 rounded bg-zinc-850 hover:bg-zinc-800 text-xs text-zinc-200"
            >
              Clear Search
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Desktop Table View (hidden on small screens) */}
          <div className="hidden md:block border border-zinc-850 rounded-xl overflow-hidden bg-zinc-950">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-zinc-900/80 text-zinc-400 text-[10px] uppercase font-semibold border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-3">Customer / Contact</th>
                    <th className="px-4 py-3">Credit Limit</th>
                    <th className="px-4 py-3 text-right">Outstanding Debt</th>
                    <th className="px-4 py-3 text-right">Available Credit</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Quick Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {filteredCustomers.map(cust => {
                    const availableCredit = Math.max(0, cust.creditLimit - cust.currentBalance);
                    const isOverLimit = cust.currentBalance > cust.creditLimit;

                    return (
                      <tr key={cust.id} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-950/60 border border-blue-800/60 flex items-center justify-center font-bold text-xs text-blue-400 shrink-0">
                              {cust.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-zinc-100 flex items-center gap-1.5">
                                <span>{cust.name}</span>
                                {cust.nationalIdOrTaxId && (
                                  <span className="text-[10px] text-zinc-500 font-mono">
                                    [{cust.nationalIdOrTaxId}]
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-zinc-400 flex items-center gap-2 mt-0.5">
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3 h-3 text-zinc-500" />
                                  <span>{cust.phone}</span>
                                </span>
                                {cust.email && (
                                  <span className="flex items-center gap-1 text-zinc-500">
                                    <Mail className="w-3 h-3" />
                                    <span>{cust.email}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3 font-mono text-zinc-200">
                          {tenant.currencySymbol} {cust.creditLimit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>

                        <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                          <span
                            className={
                              cust.currentBalance > 0
                                ? isOverLimit
                                  ? 'text-rose-400'
                                  : 'text-amber-400'
                                : 'text-emerald-400'
                            }
                          >
                            {tenant.currencySymbol} {cust.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              availableCredit > 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {tenant.currencySymbol} {availableCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                              cust.status === 'active'
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                                : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                            }`}
                          >
                            {cust.status === 'active' ? (
                              <UserCheck className="w-3 h-3" />
                            ) : (
                              <UserX className="w-3 h-3" />
                            )}
                            <span>{cust.status}</span>
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {cust.currentBalance > 0 && (
                              <button
                                type="button"
                                onClick={() => handleOpenRepayment(cust)}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium transition-colors flex items-center gap-1 min-h-[34px]"
                                title="Record Debt Repayment"
                              >
                                <CreditCard className="w-3.5 h-3.5" />
                                <span>Repay</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenStatement(cust)}
                              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 text-[11px] font-medium transition-colors flex items-center gap-1 min-h-[34px]"
                              title="View Account Statement & Ledger"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Statement</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenEditCustomer(cust)}
                              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors min-h-[34px] min-w-[34px] flex items-center justify-center"
                              title="Edit Customer Profile"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card List (< md) */}
          <div className="md:hidden space-y-2.5">
            {filteredCustomers.map(cust => {
              const availableCredit = Math.max(0, cust.creditLimit - cust.currentBalance);
              const isOverLimit = cust.currentBalance > cust.creditLimit;

              return (
                <div
                  key={cust.id}
                  className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-850 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-blue-950/60 border border-blue-800/60 flex items-center justify-center font-bold text-xs text-blue-400 shrink-0">
                        {cust.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-xs text-zinc-100">{cust.name}</div>
                        <div className="text-[11px] text-zinc-400 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-zinc-500" />
                          <span>{cust.phone}</span>
                        </div>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                        cust.status === 'active'
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                          : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                      }`}
                    >
                      {cust.status}
                    </span>
                  </div>

                  {/* Financial metrics strip */}
                  <div className="grid grid-cols-2 gap-2 p-2 rounded-lg bg-zinc-900/60 text-xs border border-zinc-850/60 font-mono">
                    <div>
                      <span className="text-[10px] text-zinc-500 block font-sans">Outstanding Debt:</span>
                      <span
                        className={`font-bold ${
                          cust.currentBalance > 0
                            ? isOverLimit
                              ? 'text-rose-400'
                              : 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {tenant.currencySymbol} {cust.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-zinc-500 block font-sans">Available Credit:</span>
                      <span
                        className={`font-bold ${
                          availableCredit > 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {tenant.currencySymbol} {availableCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex items-center gap-2 pt-1">
                    {cust.currentBalance > 0 && (
                      <button
                        type="button"
                        onClick={() => handleOpenRepayment(cust)}
                        className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-1 min-h-[44px]"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>Repay</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenStatement(cust)}
                      className="flex-1 py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-200 border border-zinc-800 font-semibold text-xs flex items-center justify-center gap-1 min-h-[44px]"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Statement</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEditCustomer(cust)}
                      className="p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 border border-zinc-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* New Customer Modal */}
      <ResponsiveDialog
        isOpen={isNewCustomerOpen}
        onClose={() => setIsNewCustomerOpen(false)}
        title="Register New Customer Profile"
        maxWidth="max-w-md"
        footerActions={
          <div className="flex items-center justify-between w-full">
            <button
              type="button"
              onClick={() => setIsNewCustomerOpen(false)}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveNewCustomer}
              className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-sm transition-all min-h-[44px]"
            >
              Save Customer
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {formError && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-xs text-rose-300">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Customer / Company Name *</label>
            <input
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="e.g. Carol Wanjiku or ABC Logistics"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Phone Number *</label>
              <input
                type="text"
                value={formPhone}
                onChange={e => setFormPhone(e.target.value)}
                placeholder="+254 700 000 000"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">National ID / Tax PIN</label>
              <input
                type="text"
                value={formIdOrTax}
                onChange={e => setFormIdOrTax(e.target.value)}
                placeholder="e.g. 28491024 or P051234567Z"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Email Address</label>
            <input
              type="email"
              value={formEmail}
              onChange={e => setFormEmail(e.target.value)}
              placeholder="customer@domain.ke"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Approved Credit Limit</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-zinc-500">
                  {tenant.currencySymbol}
                </span>
                <input
                  type="number"
                  step="any"
                  value={formCreditLimit}
                  onChange={e => setFormCreditLimit(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Account Status</label>
              <select
                value={formStatus}
                onChange={e => setFormStatus(e.target.value as any)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
              >
                <option value="active">Active (Credit Allowed)</option>
                <option value="suspended">Suspended (Credit Blocked)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Account Notes</label>
            <textarea
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              rows={2}
              placeholder="e.g. 30-day payment term agreement"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </ResponsiveDialog>

      {/* Edit Customer Modal */}
      <ResponsiveDialog
        isOpen={isEditCustomerOpen}
        onClose={() => setIsEditCustomerOpen(false)}
        title={`Edit Profile: ${selectedCustomer?.name || ''}`}
        maxWidth="max-w-md"
        footerActions={
          <div className="flex items-center justify-between w-full">
            <button
              type="button"
              onClick={() => setIsEditCustomerOpen(false)}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEditCustomer}
              className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-sm transition-all min-h-[44px]"
            >
              Update Changes
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {formError && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-xs text-rose-300">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Customer / Company Name *</label>
            <input
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Phone Number *</label>
              <input
                type="text"
                value={formPhone}
                onChange={e => setFormPhone(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">National ID / Tax PIN</label>
              <input
                type="text"
                value={formIdOrTax}
                onChange={e => setFormIdOrTax(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Email Address</label>
            <input
              type="email"
              value={formEmail}
              onChange={e => setFormEmail(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Credit Limit</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-zinc-500">
                  {tenant.currencySymbol}
                </span>
                <input
                  type="number"
                  step="any"
                  value={formCreditLimit}
                  onChange={e => setFormCreditLimit(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Account Status</label>
              <select
                value={formStatus}
                onChange={e => setFormStatus(e.target.value as any)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[40px]"
              >
                <option value="active">Active (Credit Allowed)</option>
                <option value="suspended">Suspended (Credit Blocked)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Account Notes</label>
            <textarea
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </ResponsiveDialog>

      {/* Repayment Modal */}
      <RepaymentModal
        isOpen={isRepaymentOpen}
        onClose={() => setIsRepaymentOpen(false)}
        tenant={tenant}
        initialCustomer={selectedCustomer}
        onRepaymentComplete={handleRepaymentCompleted}
      />

      {/* Official Repayment Receipt Modal */}
      <RepaymentReceiptModal
        transaction={lastRepaymentTx}
        customer={lastRepaymentCustomer}
        tenant={tenant}
        previousBalance={lastRepaymentPrevBal}
        onClose={() => {
          setLastRepaymentTx(null);
          setLastRepaymentCustomer(null);
        }}
      />

      {/* Statement Modal */}
      {selectedCustomer && (
        <CustomerStatementModal
          isOpen={isStatementOpen}
          onClose={() => setIsStatementOpen(false)}
          customer={selectedCustomer}
          transactions={storage.getCustomerTransactions(selectedCustomer.id)}
          tenant={tenant}
          onOpenRepay={handleOpenRepayment}
        />
      )}
    </div>
  );
};
