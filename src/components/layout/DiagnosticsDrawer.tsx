import React from 'react';
import { storage } from '../../services/storage';
import { hardware } from '../../services/hardware';
import { ProductItem } from '../../types/erp';
import {
  Wrench,
  X,
  Wifi,
  WifiOff,
  Barcode,
  Volume2,
  GitMerge,
  Database,
  ArrowRight
} from 'lucide-react';

interface DiagnosticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onScanBarcode?: (barcode: string) => void;
  onOpenSyncCenter: () => void;
}

export const DiagnosticsDrawer: React.FC<DiagnosticsDrawerProps> = ({
  isOpen,
  onClose,
  onScanBarcode,
  onOpenSyncCenter,
}) => {
  if (!isOpen) return null;

  const isOnline = storage.isOnline();
  const pendingCount = storage.getOutboxCount();
  const products = storage.getProducts();

  const handleToggleNetwork = () => {
    storage.toggleNetworkSimulation();
  };

  const handleTestDrawerKick = () => {
    hardware.triggerCashDrawerKick();
  };

  const handleTriggerConflict = (type: 'stock_delta' | 'room_booking' | 'price_override') => {
    storage.simulateNewConflict(type);
    onOpenSyncCenter();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm sm:max-w-md h-full bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-850 bg-zinc-900/40 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-950 border border-blue-800/60 text-blue-400">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Diagnostics & Simulation</h3>
              <p className="text-[11px] text-zinc-500 font-mono">Edge testing console</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close diagnostics"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
          {/* Section 1: Network Simulator */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-850 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <Wifi className="w-4 h-4 text-emerald-400" />
                ) : (
                  <WifiOff className="w-4 h-4 text-rose-400" />
                )}
                <span className="font-semibold text-zinc-200">Network Simulation</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${isOnline ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-rose-950 text-rose-400 border border-rose-900'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>

            <p className="text-[11px] text-zinc-400 leading-snug">
              Toggle network isolation to verify offline POS sales, local outbox queueing, and conflict-free reconnection replay.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleToggleNetwork}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  isOnline
                    ? 'bg-rose-950 border border-rose-800 text-rose-300 hover:bg-rose-900'
                    : 'bg-emerald-950 border border-emerald-800 text-emerald-300 hover:bg-emerald-900'
                }`}
              >
                {isOnline ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
                <span>{isOnline ? 'Simulate Offline' : 'Restore Online'}</span>
              </button>

              <button
                onClick={() => {
                  onOpenSyncCenter();
                  onClose();
                }}
                className="py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium flex items-center gap-1.5"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Outbox ({pendingCount})</span>
              </button>
            </div>
          </div>

          {/* Section 2: Barcode Scanner Simulation */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-850 space-y-3">
            <div className="flex items-center gap-2">
              <Barcode className="w-4 h-4 text-blue-400" />
              <span className="font-semibold text-zinc-200">Barcode Scanner Simulation</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-snug">
              Emulate physical laser hardware barcode triggers directly into the active sales register:
            </p>

            <div className="grid grid-cols-1 gap-2 pt-1">
              {products.slice(0, 5).map(prod => (
                <button
                  key={prod.id}
                  onClick={() => {
                    if (onScanBarcode) onScanBarcode(prod.barcode);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-left transition-colors group"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-medium text-zinc-200 truncate">{prod.name}</div>
                    <div className="font-mono text-[10px] text-blue-400">{prod.barcode}</div>
                  </div>
                  <span className="px-2 py-1 rounded bg-zinc-900 text-[10px] font-mono text-zinc-400 group-hover:text-white shrink-0">
                    Scan +
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Section 3: Hardware Peripheral Tests */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-850 space-y-3">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-amber-400" />
              <span className="font-semibold text-zinc-200">Hardware Peripheral Verification</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-snug">
              Test low-level cash drawer solenoid trigger pulses via Web Audio API:
            </p>

            <button
              onClick={handleTestDrawerKick}
              className="w-full py-2.5 px-3 rounded-lg bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-zinc-200 font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <Volume2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Fire Cash Drawer Kick Solenoid</span>
            </button>
          </div>

          {/* Section 4: Multi-Device Conflict Injection */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-850 space-y-3">
            <div className="flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-purple-400" />
              <span className="font-semibold text-zinc-200">Simulate Offline Data Conflict</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-snug">
              Inject concurrent mutations from simulated offline devices to verify resolution strategies:
            </p>

            <div className="space-y-2 pt-1">
              <button
                onClick={() => handleTriggerConflict('stock_delta')}
                className="w-full text-left p-2.5 rounded-lg bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-blue-300 transition-colors"
              >
                <div className="font-semibold">Concurrent Stock Delta Race</div>
                <div className="text-[10px] text-zinc-500 font-mono">Tests CRDT Commutative Arithmetic</div>
              </button>

              <button
                onClick={() => handleTriggerConflict('room_booking')}
                className="w-full text-left p-2.5 rounded-lg bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-emerald-300 transition-colors"
              >
                <div className="font-semibold">Double Room Booking Conflict</div>
                <div className="text-[10px] text-zinc-500 font-mono">Tests First-Write-Wins Up-Tiering</div>
              </button>

              <button
                onClick={() => handleTriggerConflict('price_override')}
                className="w-full text-left p-2.5 rounded-lg bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-amber-300 transition-colors"
              >
                <div className="font-semibold">Offline Emergency Price Override</div>
                <div className="text-[10px] text-zinc-500 font-mono">Tests Supervisor Escalation Gate</div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-850 bg-zinc-900/30 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors"
          >
            Close Diagnostics
          </button>
        </div>
      </div>
    </div>
  );
};
