import React, { useEffect, useState } from 'react';
import { Shift, TenantProfile, ShiftAuditLog, ShiftAuditAction } from '../../types/erp';
import { storage } from '../../services/storage';
import { hardware } from '../../services/hardware';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { apiClient, type BackendShift } from '../../services/apiClient';
import { moneyInputToMinor } from '../../utils/money';
import {
  Clock,
  Banknote,
  DollarSign,
  Printer,
  PlusCircle,
  MinusCircle,
  FileText,
  AlertCircle,
  CheckCircle2,
  X,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Search,
  Sliders,
  AlertTriangle
} from 'lucide-react';

interface ShiftManagerViewProps {
  tenant: TenantProfile;
}

export const ShiftManagerView: React.FC<ShiftManagerViewProps> = ({ tenant }) => {
  const [activeShift, setActiveShift] = useState<Shift | null>(storage.getActiveShift());
  const [shiftsHistory, setShiftsHistory] = useState<Shift[]>(storage.getShiftsHistory());
  const [auditLogs, setAuditLogs] = useState<ShiftAuditLog[]>(storage.getAuditLogs());
  const [viewTab, setViewTab] = useState<'current' | 'audit' | 'history'>('current');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('all');
  const [auditSearchQuery, setAuditSearchQuery] = useState('');

  // Close shift modal state
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [actualCashCounted, setActualCashCounted] = useState<string>('');
  const [closeNotes, setCloseNotes] = useState('');

  // Cash payout modal state
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutReason, setPayoutReason] = useState('');

  // Open shift modal state
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState(false);
  const [newCashierName, setNewCashierName] = useState('Jane Mwangi');
  const [newOpeningFloat, setNewOpeningFloat] = useState('1500');

  // New Mid-Shift Override Modal
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [overrideAction, setOverrideAction] = useState<ShiftAuditAction>('price_override');
  const [overrideDetails, setOverrideDetails] = useState('');
  const [overrideAmount, setOverrideAmount] = useState('');
  const [managerPinInput, setManagerPinInput] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // Z-Report Preview modal
  const [zReportSlip, setZReportSlip] = useState<{ shift: Shift; text: string } | null>(null);

  const activeStaff = storage.getActiveStaff();

  if (apiClient.getSession()) return <BackendShiftWorkspace tenant={tenant} />;

  const refreshData = () => {
    setActiveShift(storage.getActiveShift());
    setShiftsHistory([...storage.getShiftsHistory()]);
    setAuditLogs([...storage.getAuditLogs()]);
  };

  const handleOpenCloseModal = () => {
    if (!activeShift) return;
    setActualCashCounted(activeShift.expectedCash.toFixed(2));
    setIsCloseModalOpen(true);
  };

  const handleConfirmCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;

    const counted = parseFloat(actualCashCounted) || 0;
    const closed = storage.closeShift(counted, closeNotes);
    const slipText = hardware.generateZReportText(closed, tenant);

    setIsCloseModalOpen(false);
    refreshData();
    setZReportSlip({ shift: closed, text: slipText });
  };

  const handleConfirmPayout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift || !payoutAmount) return;

    const amt = parseFloat(payoutAmount) || 0;
    storage.recordCashPayout(amt, payoutReason || 'Store petty cash expense');
    setIsPayoutModalOpen(false);
    setPayoutAmount('');
    setPayoutReason('');
    refreshData();
  };

  const handleConfirmOpenShift = (e: React.FormEvent) => {
    e.preventDefault();
    const flt = parseFloat(newOpeningFloat) || 0;
    storage.openNewShift(newCashierName.trim() || 'Cashier', flt);
    setIsOpenShiftModalOpen(false);
    refreshData();
  };

  const handleCreateOverride = (e: React.FormEvent) => {
    e.preventDefault();
    const approvingManager = activeStaff.role === 'cashier'
      ? storage.getStaffUsers().find(user => (user.role === 'manager' || user.role === 'admin') && user.pin === managerPinInput.trim())
      : undefined;
    if (activeStaff.role === 'cashier' && !approvingManager) {
      setOverrideError('Enter the PIN for an authorized manager profile in this local demo.');
      return;
    }

    const amt = parseFloat(overrideAmount) || undefined;
    storage.recordAuditLog({
      action: overrideAction,
      details: overrideDetails || `Staff requested mid-shift ${overrideAction.replace('_', ' ')}`,
      amount: amt,
      authorizedBy: activeStaff.role !== 'cashier' ? `${activeStaff.name} (${activeStaff.title})` : `${approvingManager?.name} (${approvingManager?.title}; local demo approval)`,
      flagSeverity: overrideAction === 'emergency_drawer_kick' ? 'alert' : 'warning',
    });

    if (overrideAction === 'emergency_drawer_kick') {
      hardware.triggerCashDrawerKick();
    }

    setIsOverrideModalOpen(false);
    setOverrideDetails('');
    setOverrideAmount('');
    setManagerPinInput('');
    setOverrideError(null);
    refreshData();
  };

  const handlePrintZReport = (shift: Shift) => {
    const text = hardware.generateZReportText(shift, tenant);
    setZReportSlip({ shift, text });
  };

  const filteredAuditLogs = auditLogs.filter(log => {
    const matchesAction = auditActionFilter === 'all' || log.action === auditActionFilter;
    const matchesSearch =
      log.details.toLowerCase().includes(auditSearchQuery.toLowerCase()) ||
      log.staffName.toLowerCase().includes(auditSearchQuery.toLowerCase()) ||
      log.authorizedBy?.toLowerCase().includes(auditSearchQuery.toLowerCase());
    return matchesAction && matchesSearch;
  });

  const totalShiftRevenue = activeShift
    ? activeShift.cashSales + activeShift.cardSales + activeShift.mobileSales + activeShift.roomChargesTotal
    : 0;

  const countedNum = parseFloat(actualCashCounted) || 0;
  const variance = activeShift ? countedNum - activeShift.expectedCash : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-[#090b10] space-y-6 pb-20 lg:pb-6">
      {/* Top Tabs Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-850 pb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setViewTab('current')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-h-[40px] ${
              viewTab === 'current'
                ? 'bg-zinc-800 text-zinc-100 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Active Drawer Balancing
          </button>
          <button
            onClick={() => setViewTab('audit')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-h-[40px] ${
              viewTab === 'audit'
                ? 'bg-zinc-800 text-zinc-100 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>Audit Trail & Overrides</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-zinc-900 text-zinc-300">
              {auditLogs.length}
            </span>
          </button>
          <button
            onClick={() => setViewTab('history')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-h-[40px] ${
              viewTab === 'history'
                ? 'bg-zinc-800 text-zinc-100 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Z-Reports Archive ({shiftsHistory.length})
          </button>
        </div>

        {/* Current Operator RBAC Badge */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500 text-[11px]">Active Operator:</span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200 font-mono">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="font-semibold">{activeStaff.name}</span>
            <span className="text-[10px] uppercase text-blue-400">({activeStaff.role})</span>
          </div>
        </div>
      </div>

      {/* TAB 1: CURRENT ACTIVE SHIFT VIEW */}
      {viewTab === 'current' && (
        <div className="space-y-6">
          {activeShift ? (
            <div className="rounded-xl bg-zinc-950 border border-zinc-850 p-4 sm:p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-850 pb-5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-800/40 text-emerald-400 shrink-0">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm sm:text-base font-bold text-zinc-100">Active Trading Shift</h2>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-900 uppercase">
                        Open
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Cashier: <strong className="text-zinc-200">{activeShift.cashierName}</strong> · Started at {new Date(activeShift.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setIsPayoutModalOpen(true)}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-xs font-medium text-zinc-200 transition-colors min-h-[44px]"
                  >
                    <MinusCircle className="w-3.5 h-3.5 text-rose-400" />
                    <span>Record Payout</span>
                  </button>

                  <button
                    onClick={handleOpenCloseModal}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-sm transition-colors min-h-[44px]"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Close Shift & Balance</span>
                  </button>
                </div>
              </div>

              {/* Drawer Reconciliation Metrics */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="p-3.5 sm:p-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
                  <div className="text-xs text-zinc-400">Opening Float (+)</div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-zinc-200 tabular-nums mt-1">
                    {tenant.currencySymbol} {activeShift.openingFloat.toFixed(2)}
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Starting cash float</div>
                </div>

                <div className="p-3.5 sm:p-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
                  <div className="text-xs text-zinc-400">Cash Sales (+)</div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-emerald-400 tabular-nums mt-1">
                    {tenant.currencySymbol} {activeShift.cashSales.toFixed(2)}
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Till intake</div>
                </div>

                <div className="p-3.5 sm:p-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
                  <div className="text-xs text-zinc-400">Payouts (-)</div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-rose-400 tabular-nums mt-1">
                    {tenant.currencySymbol} {activeShift.cashPayouts.toFixed(2)}
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Petty disbursements</div>
                </div>

                <div className="p-3.5 sm:p-4 rounded-lg bg-blue-950/20 border border-blue-900/40">
                  <div className="text-xs text-blue-300 font-semibold">Expected Cash (=)</div>
                  <div className="text-xl sm:text-2xl font-bold font-mono text-blue-400 tabular-nums mt-1">
                    {tenant.currencySymbol} {activeShift.expectedCash.toFixed(2)}
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-zinc-400 mt-1">Target drawer balance</div>
                </div>
              </div>

              {/* Non-Cash Revenue Audit Grid */}
              <div className="p-3.5 sm:p-4 rounded-lg bg-zinc-900/40 border border-zinc-850 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                  <span className="font-semibold text-zinc-300 uppercase tracking-wider text-[11px]">
                    Electronic & Room Revenue Audit
                  </span>
                  <span className="text-zinc-400">
                    Gross Shift: <strong className="font-mono text-zinc-100 text-sm tabular-nums">{tenant.currencySymbol} {totalShiftRevenue.toFixed(2)}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                  <div className="p-2.5 sm:p-3 rounded bg-zinc-950 border border-zinc-800">
                    <span className="text-zinc-500 text-[11px] font-sans">Card POS:</span>
                    <div className="font-bold text-zinc-200 mt-0.5 tabular-nums">
                      {tenant.currencySymbol} {activeShift.cardSales.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-2.5 sm:p-3 rounded bg-zinc-950 border border-zinc-800">
                    <span className="text-zinc-500 text-[11px] font-sans">Mobile Money:</span>
                    <div className="font-bold text-zinc-200 mt-0.5 tabular-nums">
                      {tenant.currencySymbol} {activeShift.mobileSales.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-2.5 sm:p-3 rounded bg-zinc-950 border border-zinc-800">
                    <span className="text-zinc-500 text-[11px] font-sans">Room Folios:</span>
                    <div className="font-bold text-zinc-200 mt-0.5 tabular-nums">
                      {tenant.currencySymbol} {activeShift.roomChargesTotal.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-xl bg-zinc-950 border border-zinc-850 text-center space-y-3">
              <Clock className="w-10 h-10 mx-auto text-zinc-600" />
              <h3 className="text-base font-semibold text-zinc-200">No Shift Currently Open</h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Assign an active cashier and initialize the opening cash till float to begin operations.
              </p>
              <button
                onClick={() => setIsOpenShiftModalOpen(true)}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-sm transition-colors min-h-[44px]"
              >
                Start New Trading Shift
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: GRANULAR AUDIT TRAIL TAB */}
      {viewTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl bg-zinc-950 border border-zinc-850">
            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                <h3 className="text-sm sm:text-base font-bold text-zinc-100">
                  Granular Shift Audit Trail & Staff Overrides
                </h3>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Read-only immutable log of cash adjustments, voided items, price overrides, and supervisor authorizations
              </p>
            </div>

            <button
              onClick={() => setIsOverrideModalOpen(true)}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-sm transition-colors shrink-0 min-h-[44px]"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Record Supervisor Override</span>
            </button>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs">
              {[
                { id: 'all', label: 'All' },
                { id: 'opening_float', label: 'Float' },
                { id: 'cash_payout', label: 'Payouts' },
                { id: 'void_line_item', label: 'Voids' },
                { id: 'price_override', label: 'Price Overrides' },
                { id: 'emergency_drawer_kick', label: 'Drawer Release' },
                { id: 'shift_close_variance', label: 'Variance' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setAuditActionFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-h-[38px] ${
                    auditActionFilter === f.id
                      ? 'bg-zinc-800 text-zinc-100 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Search audit trail..."
                value={auditSearchQuery}
                onChange={e => setAuditSearchQuery(e.target.value)}
                className="w-full sm:w-56 pl-9 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 min-h-[38px]"
              />
            </div>
          </div>

          {/* MOBILE VIEW (< md): Responsive Audit Event Cards */}
          <div className="grid grid-cols-1 gap-2.5 md:hidden">
            {filteredAuditLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500 rounded-xl bg-zinc-950 border border-zinc-850">
                No audit events matching criteria.
              </div>
            ) : (
              filteredAuditLogs.map(log => (
                <div
                  key={log.id}
                  className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-850 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                      log.action === 'void_line_item' || log.action === 'price_override'
                        ? 'bg-amber-950 text-amber-300 border border-amber-900'
                        : log.action === 'emergency_drawer_kick' || log.action === 'shift_close_variance'
                        ? 'bg-rose-950 text-rose-300 border border-rose-900'
                        : 'bg-blue-950 text-blue-300 border border-blue-900'
                    }`}>
                      {log.action.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-zinc-500 text-[10px]">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-zinc-200 font-medium">{log.details}</p>

                  <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-zinc-900">
                    <div className="text-zinc-400">
                      Staff: <strong className="text-zinc-300">{log.staffName}</strong> ({log.staffRole})
                    </div>
                    {log.amount !== undefined && (
                      <div className="font-mono font-bold text-zinc-100 tabular-nums">
                        {tenant.currencySymbol} {log.amount.toFixed(2)}
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-zinc-500">
                    Sign-off: {log.authorizedBy}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* DESKTOP VIEW (≥ md): Full Granular Audit Table */}
          <div className="hidden md:block border border-zinc-850 rounded-xl bg-zinc-950 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-zinc-850 text-zinc-500 font-mono text-[11px] bg-zinc-950/80">
                    <th className="p-3.5">TIMESTAMP</th>
                    <th className="p-3.5">OPERATOR & ROLE</th>
                    <th className="p-3.5">ACTION EVENT</th>
                    <th className="p-3.5">DETAILS & REASON</th>
                    <th className="p-3.5 text-right">AMOUNT IMPACT</th>
                    <th className="p-3.5">SUPERVISOR SIGN-OFF</th>
                    <th className="p-3.5 text-center">FLAG</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {filteredAuditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="p-3.5 font-mono text-zinc-400 text-[11px] whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-zinc-200">{log.staffName}</div>
                        <div className="text-[10px] uppercase font-mono text-zinc-500">
                          {log.staffRole}
                        </div>
                      </td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          log.action === 'void_line_item' || log.action === 'price_override'
                            ? 'bg-amber-950 text-amber-300 border border-amber-900'
                            : log.action === 'emergency_drawer_kick' || log.action === 'shift_close_variance'
                            ? 'bg-rose-950 text-rose-300 border border-rose-900'
                            : 'bg-blue-950 text-blue-300 border border-blue-900'
                        }`}>
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p-3.5 text-zinc-300 max-w-sm">{log.details}</td>
                      <td className="p-3.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                        {log.amount !== undefined ? (
                          <span className="text-zinc-100">
                            {tenant.currencySymbol} {log.amount.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="p-3.5 font-mono text-[11px] text-zinc-400">
                        {log.authorizedBy || 'System Verified'}
                      </td>
                      <td className="p-3.5 text-center">
                        <span className={`inline-block w-2 h-2 rounded-full ${
                          log.flagSeverity === 'alert'
                            ? 'bg-rose-500'
                            : log.flagSeverity === 'warning'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Z-REPORTS ARCHIVE */}
      {viewTab === 'history' && (
        <div className="space-y-3">
          <div className="border border-zinc-850 rounded-xl bg-zinc-950 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-zinc-850 text-zinc-500 font-mono text-[11px] bg-zinc-950/80">
                    <th className="p-3.5">Z-REPORT #</th>
                    <th className="p-3.5">CASHIER</th>
                    <th className="p-3.5">SHIFT WINDOW</th>
                    <th className="p-3.5 text-right">EXPECTED</th>
                    <th className="p-3.5 text-right">COUNTED</th>
                    <th className="p-3.5 text-right">VARIANCE</th>
                    <th className="p-3.5 text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {shiftsHistory.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-zinc-500">
                        No closed shifts archived yet.
                      </td>
                    </tr>
                  ) : (
                    shiftsHistory.map(s => {
                      const varDiff = s.discrepancy || 0;
                      return (
                        <tr key={s.id} className="hover:bg-zinc-900/40">
                          <td className="p-3.5 font-mono font-bold text-zinc-200">
                            {s.zReportNumber || 'Z-REP'}
                          </td>
                          <td className="p-3.5 text-zinc-300 font-medium">{s.cashierName}</td>
                          <td className="p-3.5 font-mono text-zinc-400 text-[11px]">
                            {new Date(s.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → {s.endTime ? new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'CLOSED'}
                          </td>
                          <td className="p-3.5 text-right font-mono text-zinc-300 tabular-nums">
                            {tenant.currencySymbol} {s.expectedCash.toFixed(2)}
                          </td>
                          <td className="p-3.5 text-right font-mono text-zinc-100 font-bold tabular-nums">
                            {tenant.currencySymbol} {(s.actualCashCounted || 0).toFixed(2)}
                          </td>
                          <td className="p-3.5 text-right font-mono font-semibold tabular-nums">
                            <span className={varDiff === 0 ? 'text-emerald-400' : varDiff > 0 ? 'text-blue-400' : 'text-rose-400'}>
                              {varDiff === 0 ? 'Balanced' : `${varDiff > 0 ? '+' : ''}${varDiff.toFixed(2)}`}
                            </span>
                          </td>
                          <td className="p-3.5 text-right">
                            <button
                              onClick={() => handlePrintZReport(s)}
                              className="flex items-center gap-1 ml-auto px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 text-xs transition-colors min-h-[36px]"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Z-Report</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Responsive Mid-Shift Override Modal */}
      <ResponsiveDialog
        isOpen={isOverrideModalOpen}
        onClose={() => setIsOverrideModalOpen(false)}
        title="Record Mid-Shift Supervisor Override"
        subtitle="Supervisor authorization & immutable audit entry"
        icon={<Lock className="w-5 h-5 text-amber-400" />}
        footerActions={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => setIsOverrideModalOpen(false)}
              className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-xs min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateOverride}
              className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors min-h-[44px]"
            >
              Authorize & Log Entry
            </button>
          </div>
        }
      >
        <form onSubmit={handleCreateOverride} className="space-y-4">
          <div>
            <label className="block text-zinc-400 mb-1 text-xs">Override Action Type</label>
            <select
              value={overrideAction}
              onChange={e => setOverrideAction(e.target.value as any)}
              className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 min-h-[44px] text-xs"
            >
              <option value="price_override">Price Override / Concession</option>
              <option value="void_line_item">Voided Item Prior to Payment</option>
              <option value="manual_discount">Manual Manager Discount %</option>
              <option value="emergency_drawer_kick">Emergency Physical Drawer Kick</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1 text-xs">Operational Justification / Reason</label>
            <textarea
              required
              rows={2}
              placeholder="e.g. Damaged packaging discount / Customer cancelled line item"
              value={overrideDetails}
              onChange={e => setOverrideDetails(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-blue-500 text-xs"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1 text-xs">Amount Impact ({tenant.currencySymbol})</label>
            <input
              type="number"
              step="any"
              placeholder="e.g. 50"
              value={overrideAmount}
              onChange={e => setOverrideAmount(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono text-base tabular-nums focus:outline-none focus:border-blue-500 min-h-[44px]"
            />
          </div>

          {activeStaff.role === 'cashier' && (
            <div className="p-3 rounded-lg bg-zinc-950 border border-amber-900/60 space-y-2">
              <div className="flex items-center gap-1.5 text-amber-300 font-semibold text-xs">
                <Lock className="w-3.5 h-3.5" />
                <span>Manager PIN Authorization Required</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Cashier role requires a manager profile PIN in this local demo. Production approval must be verified by the server.
              </p>
              <input
                type="password"
                maxLength={4}
                required
                placeholder="Enter manager profile PIN..."
                value={managerPinInput}
                onChange={e => setManagerPinInput(e.target.value)}
                className="w-full p-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-100 font-mono tracking-widest text-center min-h-[40px]"
              />
              {overrideError && (
                <div className="text-[11px] text-rose-400 font-medium">{overrideError}</div>
              )}
            </div>
          )}
        </form>
      </ResponsiveDialog>

      {/* Responsive Close Shift Modal */}
      {isCloseModalOpen && activeShift && (
        <ResponsiveDialog
          isOpen={isCloseModalOpen}
          onClose={() => setIsCloseModalOpen(false)}
          title="End-of-Shift Reconciliation"
          subtitle="Cash drawer audit & official Z-Report generator"
          icon={<CheckCircle2 className="w-5 h-5 text-blue-400" />}
          footerActions={
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                type="button"
                onClick={() => setIsCloseModalOpen(false)}
                className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-xs min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCloseShift}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors min-h-[44px]"
              >
                Generate Z-Report & Close Shift
              </button>
            </div>
          }
        >
          <form onSubmit={handleConfirmCloseShift} className="space-y-4">
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex justify-between items-center text-xs">
              <span className="text-zinc-400">Expected Physical Cash:</span>
              <span className="font-mono text-sm font-bold text-blue-400 tabular-nums">
                {tenant.currencySymbol} {activeShift.expectedCash.toFixed(2)}
              </span>
            </div>

            <div>
              <label className="block text-zinc-300 mb-1 font-semibold text-xs">
                Actual Physical Cash Counted in Till
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-zinc-500">
                  {tenant.currencySymbol}
                </span>
                <input
                  type="number"
                  step="any"
                  required
                  value={actualCashCounted}
                  onChange={e => setActualCashCounted(e.target.value)}
                  className="w-full pl-12 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-lg font-mono font-bold text-zinc-100 focus:outline-none focus:border-blue-500 tabular-nums min-h-[44px]"
                />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex justify-between items-center text-xs">
              <span className="text-zinc-400">Calculated Variance:</span>
              <span className={`font-mono font-bold text-sm tabular-nums ${variance === 0 ? 'text-emerald-400' : variance > 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                {variance === 0 ? 'Balanced' : `${variance > 0 ? '+ Overage' : '- Shortage'}: ${tenant.currencySymbol} ${Math.abs(variance).toFixed(2)}`}
              </span>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1 text-xs">Supervisor Audit Note</label>
              <input
                type="text"
                placeholder="e.g. Verified by Lead Shift Supervisor"
                value={closeNotes}
                onChange={e => setCloseNotes(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[44px] text-xs"
              />
            </div>
          </form>
        </ResponsiveDialog>
      )}

      {/* Responsive Payout Modal */}
      {isPayoutModalOpen && (
        <ResponsiveDialog
          isOpen={isPayoutModalOpen}
          onClose={() => setIsPayoutModalOpen(false)}
          title="Record Till Cash Payout"
          subtitle="Petty cash disbursement with audit logging"
          icon={<MinusCircle className="w-5 h-5 text-rose-400" />}
          footerActions={
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                type="button"
                onClick={() => setIsPayoutModalOpen(false)}
                className="px-4 py-2 text-zinc-400 min-h-[44px] text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPayout}
                className="px-5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs min-h-[44px]"
              >
                Disburse & Deduct Till
              </button>
            </div>
          }
        >
          <form onSubmit={handleConfirmPayout} className="space-y-4">
            <div>
              <label className="block text-zinc-400 mb-1 text-xs">Payout Amount ({tenant.currencySymbol})</label>
              <input
                type="number"
                step="any"
                required
                placeholder="e.g. 250"
                value={payoutAmount}
                onChange={e => setPayoutAmount(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono text-base tabular-nums focus:outline-none focus:border-blue-500 min-h-[44px]"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1 text-xs">Reason / Expense Description</label>
              <input
                type="text"
                required
                placeholder="e.g. Courier dispatch / Ice block delivery"
                value={payoutReason}
                onChange={e => setPayoutReason(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[44px] text-xs"
              />
            </div>
          </form>
        </ResponsiveDialog>
      )}

      {/* Responsive Open Shift Modal */}
      {isOpenShiftModalOpen && (
        <ResponsiveDialog
          isOpen={isOpenShiftModalOpen}
          onClose={() => setIsOpenShiftModalOpen(false)}
          title="Start New Trading Shift"
          subtitle="Assign cashier and set opening float"
          icon={<Clock className="w-5 h-5 text-blue-400" />}
          footerActions={
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                type="button"
                onClick={() => setIsOpenShiftModalOpen(false)}
                className="px-4 py-2 text-zinc-400 min-h-[44px] text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmOpenShift}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs min-h-[44px]"
              >
                Open Till & Begin Shift
              </button>
            </div>
          }
        >
          <form onSubmit={handleConfirmOpenShift} className="space-y-4">
            <div>
              <label className="block text-zinc-400 mb-1 text-xs">Cashier Staff Member</label>
              <input
                type="text"
                required
                value={newCashierName}
                onChange={e => setNewCashierName(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[44px] text-xs"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1 text-xs">Opening Cash Till Float ({tenant.currencySymbol})</label>
              <input
                type="number"
                step="any"
                required
                value={newOpeningFloat}
                onChange={e => setNewOpeningFloat(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono text-base tabular-nums focus:outline-none focus:border-blue-500 min-h-[44px]"
              />
            </div>
          </form>
        </ResponsiveDialog>
      )}

      {/* Z-Report Slip Modal */}
      {zReportSlip && (
        <ResponsiveDialog
          isOpen={!!zReportSlip}
          onClose={() => setZReportSlip(null)}
          title="Official End-of-Shift Z-Report"
          subtitle={`Ref: ${zReportSlip.shift.zReportNumber}`}
          icon={<Printer className="w-5 h-5 text-blue-400" />}
          footerActions={
            <div className="flex items-center justify-between gap-2 w-full">
              <button
                onClick={() => {
                  try {
                    window.print();
                  } catch {}
                }}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg min-h-[44px]"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Z-Report</span>
              </button>
              <button
                onClick={() => setZReportSlip(null)}
                className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-xs min-h-[44px]"
              >
                Done
              </button>
            </div>
          }
        >
          <div className="p-4 bg-white text-zinc-950 rounded font-mono text-[11px] leading-snug whitespace-pre select-all max-h-96 overflow-y-auto">
            {zReportSlip.text}
          </div>
        </ResponsiveDialog>
      )}
    </div>
  );
};

const BackendShiftWorkspace: React.FC<{tenant:TenantProfile}> = ({tenant}) => {
  const session=apiClient.getSession()!; const [shift,setShift]=useState<BackendShift|null>(null); const [float,setFloat]=useState('0'); const [counted,setCounted]=useState('0'); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [unknownCommandId,setUnknownCommandId]=useState<string|null>(null);
  const currencySymbol=new Intl.NumberFormat(undefined,{style:'currency',currency:session.tenant.currency}).formatToParts(0).find(part=>part.type==='currency')?.value??session.tenant.currency;
  const refresh=async()=>{try{setShift((await apiClient.getCurrentShift()).shift)}catch(e){setMessage(e instanceof Error?e.message:'Unable to load server shift.')}};
  useEffect(()=>{void refresh()},[]);
  const submit=async(type:'shift.open'|'shift.close')=>{setBusy(true);setMessage(''); let amountMinor:number;try{amountMinor=moneyInputToMinor(type==='shift.open'?(float||'0'):(counted||'0'))}catch(e){setMessage(e instanceof Error?e.message:'Enter a valid amount.');setBusy(false);return} const commandId=crypto.randomUUID();
    try { const outcome=await apiClient.submitCommand({protocolVersion:1,commandId,tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions:shift?{[`shift:${shift.id}`]:shift.version}:{},payload:type==='shift.open'?{openingFloatMinor:amountMinor}:{shiftId:shift!.id,countedCashMinor:amountMinor}});
      if(outcome.status!=='CONFIRMED'){setMessage(outcome.message??'Shift command was not confirmed.');setUnknownCommandId(null)} else {setMessage(type==='shift.open'?'Server shift opened.':'Server shift closed.');setUnknownCommandId(null)} await refresh();
    }catch(e){setUnknownCommandId(commandId);setMessage(e instanceof Error?e.message:'Shift command outcome is unknown; check command status before retrying.')}finally{setBusy(false)}
  };
  const checkUnknown=async()=>{if(!unknownCommandId)return;try{const result=await apiClient.checkCommandStatus(unknownCommandId);const response=result.response as {status?:string;message?:string};if(response.status==='CONFIRMED'){setUnknownCommandId(null);setMessage('Server confirmed the shift action.');await refresh()}else if(response.status==='REJECTED'||response.status==='CONFLICT'){setUnknownCommandId(null);setMessage(response.message??`Shift action ${response.status.toLowerCase()}.`)}else setMessage(`Command status: ${result.status}. Check again shortly.`)}catch(e){setMessage(e instanceof Error?e.message:'Unable to check shift command status.')}};
  return <section className="mx-auto max-w-4xl p-4 sm:p-8"><header><p className="text-xs uppercase tracking-widest text-blue-300">Server-backed shift</p><h1 className="mt-2 text-3xl font-bold">Cash control</h1><p className="mt-2 text-zinc-400">{session.outlet.name} · {session.user.name} · {session.tenant.currency}</p></header><div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">{shift?<><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm text-emerald-300">Shift open</p><h2 className="mt-1 text-xl font-semibold">Expected cash {currencySymbol} {(shift.expectedCashMinor/100).toFixed(2)}</h2><p className="mt-1 text-sm text-zinc-400">Version {shift.version} · opened {new Date(shift.openedAt).toLocaleString()}</p></div><div className="flex items-end gap-2"><label className="text-xs text-zinc-400">Counted cash<input type="number" min="0" step="0.01" value={counted} onChange={e=>setCounted(e.target.value)} className="mt-1 block w-36 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white"/></label><button disabled={busy} onClick={()=>void submit('shift.close')} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold">{busy?'Working…':'Close shift'}</button></div></div></>:<div className="flex flex-wrap items-end gap-3"><div className="flex-1"><h2 className="text-lg font-semibold">No server shift is open</h2><p className="mt-1 text-sm text-zinc-400">Open a till before server-backed checkout.</p></div><label className="text-xs text-zinc-400">Opening float<input type="number" min="0" step="0.01" value={float} onChange={e=>setFloat(e.target.value)} className="mt-1 block w-36 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white"/></label><button disabled={busy} onClick={()=>void submit('shift.open')} className="min-h-11 rounded-lg bg-emerald-600 px-4 font-semibold">{busy?'Working…':'Open shift'}</button></div>}{message&&<div role="status" className="mt-4 flex items-center gap-3 text-sm text-amber-300"><span>{message}</span>{unknownCommandId&&<button onClick={()=>void checkUnknown()} className="underline">Check status</button>}</div>}</div></section>;
};
