import React, { useState } from 'react';
import { storage } from '../../services/storage';
import { SyncConflict } from '../../types/erp';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  X,
  Database,
  ArrowRight,
  GitMerge,
  ShieldCheck,
  AlertTriangle,
  Layers,
  Sparkles,
  CheckCircle2,
  Lock
} from 'lucide-react';

interface SyncCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncCenterModal: React.FC<SyncCenterModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const [activeTab, setActiveTab] = useState<'queue' | 'conflicts'>('queue');
  const [, setTick] = useState(0);

  const isOnline = storage.isOnline();
  const queue = storage.getOutboxQueue();
  const pendingCount = storage.getOutboxCount();
  const conflicts = storage.getConflicts();
  const pendingConflictsCount = conflicts.filter(c => c.status === 'escalation_pending').length;

  const handleToggleOnline = () => {
    storage.toggleNetworkSimulation();
    setTick(t => t + 1);
  };

  const handleManualFlush = () => {
    storage.flushOutboxQueue();
    setTick(t => t + 1);
  };

  const handleClearSynced = () => {
    storage.clearSyncedOutbox();
    setTick(t => t + 1);
  };

  const handleResolve = (conflictId: string, choice: 'accept_client' | 'accept_server' | 'auto_reconcile') => {
    storage.resolveConflict(conflictId, choice);
    setTick(t => t + 1);
  };

  const handleSimulate = (type: 'stock_delta' | 'room_booking' | 'price_override') => {
    storage.simulateNewConflict(type);
    setActiveTab('conflicts');
    setTick(t => t + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg border ${isOnline ? 'bg-emerald-950/60 border-emerald-800/40 text-emerald-400' : 'bg-rose-950/60 border-rose-800/40 text-rose-400'}`}>
              {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-100">
                Offline Durability & Conflict Resolution
              </h3>
              <p className="text-xs text-zinc-400">
                Deterministic CRDT deltas, first-write-wins cascades, and supervisor escalation gates
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Nav Tabs */}
        <div className="flex items-center px-6 pt-3 border-b border-zinc-800 bg-zinc-950/40 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('queue')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'queue'
                ? 'border-blue-500 text-blue-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Outbox Queue ({pendingCount} pending)
          </button>
          <button
            onClick={() => setActiveTab('conflicts')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'conflicts'
                ? 'border-blue-500 text-blue-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <GitMerge className="w-3.5 h-3.5" />
            <span>Conflict Resolution Center</span>
            {pendingConflictsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/20 text-amber-300 font-mono">
                {pendingConflictsCount} review
              </span>
            )}
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: OUTBOX QUEUE */}
          {activeTab === 'queue' && (
            <div className="space-y-6">
              {/* Status KPI Strip */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800">
                  <div className="text-xs text-zinc-400 mb-1">Network State</div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <span className="text-sm font-semibold text-zinc-100">
                      {isOnline ? 'Authoritative Online' : 'Offline / Isolated'}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-2">
                    {isOnline ? 'Direct synchrony to central PostgreSQL' : 'Operating on durable IndexedDB queue'}
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800">
                  <div className="text-xs text-zinc-400 mb-1">Pending Outbox Items</div>
                  <div className="text-2xl font-bold font-mono text-zinc-100 tabular-nums">
                    {pendingCount}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-2">
                    {pendingCount > 0 ? 'Awaiting reconnection flush' : 'All transactions reconciled'}
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800">
                  <div className="text-xs text-zinc-400 mb-1">Transactional Invariant</div>
                  <div className="text-sm font-semibold text-zinc-200">
                    Deterministic Idempotency
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-2">
                    Monotonic UUID keys prevent double billing
                  </p>
                </div>
              </div>

              {/* Network Toggle Simulator */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-zinc-950/60 border border-zinc-850 rounded-lg">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-zinc-200">Simulate Network Failure Condition</div>
                  <div className="text-xs text-zinc-400">
                    Toggle connection drop to test cashiering, local queueing, and automatic replay upon reconnection.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleOnline}
                    className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      isOnline
                        ? 'bg-rose-950 border border-rose-800 text-rose-300 hover:bg-rose-900'
                        : 'bg-emerald-950 border border-emerald-800 text-emerald-300 hover:bg-emerald-900'
                    }`}
                  >
                    {isOnline ? (
                      <>
                        <WifiOff className="w-3.5 h-3.5" />
                        Drop WAN (Go Offline)
                      </>
                    ) : (
                      <>
                        <Wifi className="w-3.5 h-3.5" />
                        Restore WAN (Go Online)
                      </>
                    )}
                  </button>

                  {isOnline && pendingCount > 0 && (
                    <button
                      onClick={handleManualFlush}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Sync Outbox Now
                    </button>
                  )}
                </div>
              </div>

              {/* Queue Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Outbox Journal ({queue.length} events)
                  </h4>
                  {queue.some(q => q.status === 'synced') && (
                    <button
                      onClick={handleClearSynced}
                      className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      Clear Reconciled Records
                    </button>
                  )}
                </div>

                <div className="border border-zinc-800 rounded-lg bg-zinc-950 overflow-hidden max-h-56 overflow-y-auto">
                  {queue.length === 0 ? (
                    <div className="p-8 text-center text-xs text-zinc-500">
                      <Database className="w-6 h-6 mx-auto mb-2 text-zinc-600" />
                      Outbox queue is empty. No pending local changes.
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-900 font-mono text-xs">
                      {queue.map(item => (
                        <div key={item.id} className="p-3 flex items-center justify-between hover:bg-zinc-900/40">
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-medium uppercase ${
                              item.status === 'synced'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-900'
                                : 'bg-amber-950 text-amber-400 border border-amber-900'
                            }`}>
                              {item.status}
                            </span>
                            <div>
                              <span className="font-semibold text-zinc-200 uppercase">{item.entityType}</span>
                              <span className="text-zinc-500 ml-2">ID: {item.id.slice(-8)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-zinc-400 text-[11px]">
                            <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-zinc-600" />
                            <span className="text-zinc-300 font-sans">
                              {item.entityType === 'sale' ? `Order #${item.payload.orderNumber}` :
                               item.entityType === 'room_folio' ? 'Folio Charge' :
                               item.entityType === 'stock' ? `Stock Adjustment` : 'Shift Update'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ADVANCED CONFLICT RESOLUTION STRATEGIES */}
          {activeTab === 'conflicts' && (
            <div className="space-y-6">
              {/* Strategy Architectural Explanation Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-850 space-y-1">
                  <div className="flex items-center gap-1.5 text-blue-400 text-xs font-semibold">
                    <Layers className="w-3.5 h-3.5" />
                    <span>1. Commutative Deltas (CRDTs)</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Used for <strong>Inventory</strong>. Transmits signed quantity deltas (±Δ) rather than state replacements. Orders of sync arrivals do not compromise stock math.
                  </p>
                </div>

                <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-850 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>2. Deterministic Up-Tiering</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Used for <strong>Hospitality Rooms</strong>. Earliest timestamp wins the unit; concurrent offline bookings automatically upgrade to an equivalent suite without dropped folios.
                  </p>
                </div>

                <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-850 space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>3. Supervisor Escalation Gate</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Used for <strong>Price & Monetary Overrides</strong>. Discrepant offline prices trigger a human review gate with manager sign-off rather than arbitrary algorithm guesses.
                  </p>
                </div>
              </div>

              {/* Live Conflict Simulation Triggers */}
              <div className="p-4 rounded-lg bg-zinc-950/60 border border-zinc-850 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-200">Test Multi-Device Conflict Scenarios</h4>
                    <p className="text-[11px] text-zinc-400">Trigger simulated concurrent offline mutations to test automated and manual resolution strategies.</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => handleSimulate('stock_delta')}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-blue-400 font-medium transition-colors"
                  >
                    + Simulate Concurrent Stock Race
                  </button>
                  <button
                    onClick={() => handleSimulate('room_booking')}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-emerald-400 font-medium transition-colors"
                  >
                    + Simulate Double Room Booking
                  </button>
                  <button
                    onClick={() => handleSimulate('price_override')}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-amber-400 font-medium transition-colors"
                  >
                    + Simulate Emergency Price Override
                  </button>
                </div>
              </div>

              {/* Active & Resolved Conflicts List */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Conflict Resolution Ledger ({conflicts.length} cases)
                </h4>

                <div className="space-y-3">
                  {conflicts.map(conf => (
                    <div
                      key={conf.id}
                      className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3 text-xs"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-850 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                            conf.status === 'auto_resolved'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-900'
                              : conf.status === 'escalation_pending'
                              ? 'bg-amber-950 text-amber-300 border border-amber-900'
                              : 'bg-blue-950 text-blue-300 border border-blue-900'
                          }`}>
                            {conf.status.replace(/_/g, ' ')}
                          </span>
                          <span className="font-semibold text-zinc-100">{conf.title}</span>
                        </div>
                        <span className="text-[11px] font-mono text-zinc-500">
                          Strategy: <strong className="text-zinc-300">{conf.conflictStrategy.replace(/_/g, ' ')}</strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] font-mono">
                        <div className="p-2.5 rounded bg-zinc-900 border border-zinc-850 space-y-1">
                          <div className="text-zinc-400 font-sans font-semibold">Server Authoritative State</div>
                          <pre className="text-zinc-300 whitespace-pre-wrap text-[10px]">
                            {JSON.stringify(conf.serverState, null, 2)}
                          </pre>
                        </div>
                        <div className="p-2.5 rounded bg-zinc-900 border border-zinc-850 space-y-1">
                          <div className="text-zinc-400 font-sans font-semibold">Client ({conf.clientDevice}) State</div>
                          <pre className="text-zinc-300 whitespace-pre-wrap text-[10px]">
                            {JSON.stringify(conf.clientState, null, 2)}
                          </pre>
                        </div>
                      </div>

                      <div className="p-2.5 rounded bg-zinc-900/40 border border-zinc-850 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="text-[11px] text-zinc-300">
                          <strong className="text-zinc-400 font-sans">Resolution: </strong>
                          {conf.resolutionDetails}
                        </div>

                        {/* Interactive Manager Escalation Actions if pending */}
                        {conf.status === 'escalation_pending' && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleResolve(conf.id, 'accept_client')}
                              className="px-2.5 py-1 rounded bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/40 text-amber-300 font-medium text-xs transition-colors"
                            >
                              Accept Offline Concession
                            </button>
                            <button
                              onClick={() => handleResolve(conf.id, 'accept_server')}
                              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs transition-colors"
                            >
                              Enforce Server Standard
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-zinc-950/80 border-t border-zinc-800 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            Close Synchronization Center
          </button>
        </div>
      </div>
    </div>
  );
};
