import React, { useState } from 'react';
import { Room, RoomStatus, TenantProfile, FolioCharge, PaymentMethod } from '../../types/erp';
import { storage } from '../../services/storage';
import {
  Hotel,
  UserCheck,
  Sparkles,
  Receipt,
  Plus,
  X,
  CreditCard,
  Phone,
  Calendar,
  AlertTriangle
} from 'lucide-react';

interface HospitalityViewProps {
  tenant: TenantProfile;
}

export const HospitalityView: React.FC<HospitalityViewProps> = ({ tenant }) => {
  const canCheckIn = storage.hasPermission('rooms.checkin');
  const canCheckout = storage.hasPermission('rooms.checkout');
  const canManageFolio = storage.hasPermission('rooms.manage_folios');
  const canHousekeep = storage.hasPermission('hotel.housekeeping');
  const [rooms, setRooms] = useState<Room[]>(storage.getRooms());
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  // Check-In modal state
  const [checkInModalRoom, setCheckInModalRoom] = useState<Room | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [nights, setNights] = useState(2);

  // Manual Folio charge modal state
  const [isAddChargeOpen, setIsAddChargeOpen] = useState(false);
  const [chargeDescription, setChargeDescription] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeCategory, setChargeCategory] = useState<FolioCharge['category']>('dining');
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementMethod, setSettlementMethod] = useState<PaymentMethod>('cash');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Checkout invoice preview state
  const [checkoutSlip, setCheckoutSlip] = useState<{ room: Room; charges: FolioCharge[]; total: number } | null>(null);

  const refreshRooms = () => {
    setRooms([...storage.getRooms()]);
    if (selectedRoom) {
      const updated = storage.getRooms().find(r => r.id === selectedRoom.id);
      setSelectedRoom(updated || null);
    }
  };

  const filteredRooms = rooms.filter(r => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  const getStatusBadge = (status: RoomStatus) => {
    switch (status) {
      case 'occupied':
        return { label: 'Occupied', bg: 'bg-emerald-950/80', text: 'text-emerald-400', border: 'border-emerald-800/60' };
      case 'vacant_clean':
        return { label: 'Vacant Clean', bg: 'bg-blue-950/80', text: 'text-blue-400', border: 'border-blue-800/60' };
      case 'vacant_dirty':
        return { label: 'Dirty (Housekeeping)', bg: 'bg-amber-950/80', text: 'text-amber-400', border: 'border-amber-800/60' };
      case 'reserved':
        return { label: 'Reserved', bg: 'bg-purple-950/80', text: 'text-purple-400', border: 'border-purple-800/60' };
      case 'maintenance':
        return { label: 'Maintenance', bg: 'bg-rose-950/80', text: 'text-rose-400', border: 'border-rose-800/60' };
    }
  };

  // Check-in action
  const handleConfirmCheckIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCheckIn) return;
    if (!checkInModalRoom || !guestName.trim()) return;

    storage.checkInGuest(checkInModalRoom.id, guestName.trim(), guestPhone.trim(), nights);
    setCheckInModalRoom(null);
    setGuestName('');
    setGuestPhone('');
    setNights(2);
    refreshRooms();
  };

  // Add charge to folio
  const handleAddFolioCharge = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageFolio) return;
    if (!selectedRoom || !chargeAmount) return;

    storage.addFolioCharge(selectedRoom.id, {
      description: chargeDescription || 'Incidental Service Charge',
      category: chargeCategory,
      amount: parseFloat(chargeAmount) || 0,
    });

    setIsAddChargeOpen(false);
    setChargeDescription('');
    setChargeAmount('');
    refreshRooms();
  };

  // Checkout action
  const handleCheckout = (room: Room) => {
    if (!canCheckout) return;
    const total = room.folioCharges.reduce((acc, c) => acc + c.amount, 0);
    const tendered = settlementAmount.trim() ? Number(settlementAmount) : 0;
    if (!Number.isFinite(tendered) || tendered < total) {
      setCheckoutError(`Enter at least ${tenant.currencySymbol} ${total.toFixed(2)} received before checkout.`);
      return;
    }
    try {
      const result = storage.settleRoomFolio(room.id, settlementMethod, Number.isFinite(tendered) ? tendered : 0);
      setCheckoutSlip({ room, charges: result.charges, total: result.totalPaid });
      setSelectedRoom(null);
      setSettlementAmount('');
      setCheckoutError(null);
      refreshRooms();
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Checkout could not be completed.');
    }
  };

  // Quick Housekeeping status toggle
  const handleHousekeepingToggle = (roomId: string, newStatus: RoomStatus, e?: React.MouseEvent) => {
    if (!canHousekeep) return;
    if (e) e.stopPropagation();
    storage.updateRoomHousekeeping(roomId, newStatus);
    refreshRooms();
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-[#090b10] space-y-6">
      {/* Hospitality Overview Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-zinc-950 border border-zinc-850">
        <div>
          <div className="flex items-center gap-2">
            <Hotel className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold text-zinc-100">Guest Accommodations & Room Rack</h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time room occupancy, guest folio settlement, and cross-terminal dining charges
          </p>
        </div>

        {/* Quick status summary counts */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <span className="text-zinc-400 text-[11px] font-sans">Occupied:</span>{' '}
            <span className="text-emerald-400 font-bold tabular-nums">
              {rooms.filter(r => r.status === 'occupied').length}
            </span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <span className="text-zinc-400 text-[11px] font-sans">Ready Clean:</span>{' '}
            <span className="text-blue-400 font-bold tabular-nums">
              {rooms.filter(r => r.status === 'vacant_clean').length}
            </span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <span className="text-zinc-400 text-[11px] font-sans">Needs Cleaning:</span>{' '}
            <span className="text-amber-400 font-bold tabular-nums">
              {rooms.filter(r => r.status === 'vacant_dirty').length}
            </span>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {['all', 'occupied', 'vacant_clean', 'vacant_dirty', 'reserved'].map(st => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              statusFilter === st
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            {st.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Room Grid Matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredRooms.map(room => {
          const badge = getStatusBadge(room.status);
          const folioTotal = room.folioCharges.reduce((a, b) => a + b.amount, 0);

          return (
            <div
              key={room.id}
              onClick={() => canManageFolio && setSelectedRoom(room)}
              onKeyDown={event => { if (canManageFolio && (event.key === 'Enter' || event.key === ' ')) setSelectedRoom(room); }}
              role={canManageFolio ? 'button' : undefined}
              tabIndex={canManageFolio ? 0 : undefined}
              className="p-4 rounded-xl bg-zinc-950 border border-zinc-850 hover:border-zinc-700 hover:bg-zinc-900/60 cursor-pointer transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold font-mono text-zinc-100 tabular-nums">
                      {room.number}
                    </span>
                    <span className="text-xs text-zinc-400">· {room.type}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${badge.bg} ${badge.text} ${badge.border}`}>
                    {badge.label}
                  </span>
                </div>

                {room.status === 'occupied' ? (
                  <div className="space-y-1.5 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 mb-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Guest:</span>
                      <span className="font-semibold text-zinc-200">{room.guestName}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span>Folio Total:</span>
                      <span className="font-mono font-bold text-emerald-400 tabular-nums">
                        ${folioTotal.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono">
                      Stay: {room.checkInDate} → {room.checkOutDate}
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-zinc-900/50 border border-zinc-850 mb-3 text-xs text-zinc-400 flex items-center justify-between">
                    <span>Nightly Rate:</span>
                    <span className="font-mono font-semibold text-zinc-200">${room.ratePerNight}/nt</span>
                  </div>
                )}
              </div>

              {/* Action Buttons depending on state */}
              <div className="pt-2 border-t border-zinc-850 flex items-center justify-between text-xs">
                {room.status === 'vacant_clean' && canCheckIn && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setCheckInModalRoom(room);
                    }}
                    className="w-full py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/30 font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Check In Guest</span>
                  </button>
                )}

                {room.status === 'vacant_dirty' && canHousekeep && (
                  <button
                    onClick={e => handleHousekeepingToggle(room.id, 'vacant_clean', e)}
                    className="w-full py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/30 font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Mark Clean (Housekeeping)</span>
                  </button>
                )}

                {room.status === 'occupied' && canManageFolio && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedRoom(room);
                    }}
                    className="w-full py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    <span>Manage Folio (${folioTotal.toFixed(0)})</span>
                  </button>
                )}

                {room.status === 'reserved' && canCheckIn && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setCheckInModalRoom(room);
                    }}
                    className="w-full py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-600/30 font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>Check In ({room.guestName?.slice(0, 12)})</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Guest Check-In Modal */}
      {checkInModalRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-100">
                  Guest Check-In — Room {checkInModalRoom.number}
                </h3>
                <p className="text-xs text-zinc-400 font-mono">
                  {checkInModalRoom.type} · ${checkInModalRoom.ratePerNight} / night
                </p>
              </div>
              <button
                onClick={() => setCheckInModalRoom(null)}
                className="p-1 text-zinc-400 hover:text-zinc-200 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmCheckIn} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1">Guest Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Captain James Cook"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Contact Phone / Passport</label>
                <input
                  type="text"
                  placeholder="+1 (555) 019-2831"
                  value={guestPhone}
                  onChange={e => setGuestPhone(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Number of Nights</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={nights}
                  onChange={e => setNights(parseInt(e.target.value) || 1)}
                  className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono tabular-nums focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex justify-between items-center text-xs">
                <span className="text-zinc-400">Estimated Accommodation:</span>
                <span className="font-mono font-bold text-emerald-400 tabular-nums">
                  ${(checkInModalRoom.ratePerNight * nights).toFixed(2)}
                </span>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCheckInModalRoom(null)}
                  className="px-4 py-2 text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
                >
                  Confirm Check-In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Room Folio Details Modal */}
      {selectedRoom && selectedRoom.status === 'occupied' && canManageFolio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/70">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-zinc-100">
                    Room {selectedRoom.number} Folio
                  </span>
                  <span className="text-xs text-zinc-400">· {selectedRoom.type}</span>
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Guest: <strong className="text-zinc-200">{selectedRoom.guestName}</strong> · Phone: {selectedRoom.guestPhone || 'N/A'}
                </div>
              </div>
              <button
                onClick={() => setSelectedRoom(null)}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Folio Items */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Itemized Charges ({selectedRoom.folioCharges.length})
                </h4>
                {canManageFolio && <button
                  onClick={() => setIsAddChargeOpen(true)}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Manual Charge
                </button>}
              </div>

              {/* Add Charge inline form */}
              {isAddChargeOpen && (
                <form onSubmit={handleAddFolioCharge} className="p-3.5 rounded-lg bg-zinc-950 border border-blue-900/60 space-y-3 text-xs">
                  <div className="font-semibold text-blue-300">New Folio Line Item</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Description (e.g. Laundry)"
                      value={chargeDescription}
                      onChange={e => setChargeDescription(e.target.value)}
                      className="p-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-100"
                    />
                    <select
                      value={chargeCategory}
                      onChange={e => setChargeCategory(e.target.value as any)}
                      className="p-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-100"
                    >
                      <option value="dining">Dining / F&B</option>
                      <option value="laundry">Laundry</option>
                      <option value="spa">Spa / Activity</option>
                      <option value="retail">Retail</option>
                    </select>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="Amount ($)"
                      value={chargeAmount}
                      onChange={e => setChargeAmount(e.target.value)}
                      className="p-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-100 font-mono"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddChargeOpen(false)}
                      className="px-3 py-1 text-zinc-400"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 rounded bg-blue-600 text-white font-medium"
                    >
                      Post Charge
                    </button>
                  </div>
                </form>
              )}

              {/* Charges Table */}
              <div className="border border-zinc-800 rounded-lg bg-zinc-950 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-850 text-zinc-500 font-mono text-[11px]">
                      <th className="text-left p-3">DATE/TIME</th>
                      <th className="text-left p-3">DESCRIPTION</th>
                      <th className="text-left p-3">CATEGORY</th>
                      <th className="text-right p-3">AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {selectedRoom.folioCharges.map(chg => (
                      <tr key={chg.id} className="hover:bg-zinc-900/30">
                        <td className="p-3 font-mono text-zinc-400 text-[11px]">
                          {new Date(chg.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-3 text-zinc-200 font-medium">
                          {chg.description}
                          {chg.referenceOrderNumber && (
                            <span className="ml-2 font-mono text-[10px] text-blue-400">
                              (POS #{chg.referenceOrderNumber})
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono bg-zinc-900 border border-zinc-800 text-zinc-400">
                            {chg.category}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-zinc-100 tabular-nums">
                          ${chg.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary box */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex justify-between items-center text-sm font-bold">
                <span className="text-zinc-300">Total Outstanding Folio Balance:</span>
                <span className="font-mono text-emerald-400 text-lg tabular-nums">
                  ${selectedRoom.folioCharges.reduce((a, b) => a + b.amount, 0).toFixed(2)}
                </span>
              </div>
              {canCheckout && <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs text-amber-200">Local demo checkout requires full payment. This does not verify a provider payment or create a production guest settlement.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-xs text-zinc-300">Amount received ({tenant.currency})<input aria-label="Amount received" type="number" min="0" step="0.01" inputMode="decimal" value={settlementAmount} onChange={event => { setSettlementAmount(event.target.value); setCheckoutError(null); }} className="mt-1 w-full min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-3 font-mono text-zinc-100" placeholder="Enter amount received" /></label>
                  <label className="block text-xs text-zinc-300">Method<select value={settlementMethod} onChange={event => setSettlementMethod(event.target.value as PaymentMethod)} className="mt-1 w-full min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-zinc-100"><option value="cash">Cash</option><option value="card">Card</option><option value="mobile_money">Mobile money</option></select></label>
                </div>
                {checkoutError && <p className="text-xs text-rose-300" role="alert">{checkoutError}</p>}
              </div>}
              {canCheckout && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <label className="block text-xs text-zinc-300">Payment received ({tenant.currency})<input aria-label="Payment received" type="number" min="0" step="0.01" inputMode="decimal" value={settlementAmount} onChange={event => { setSettlementAmount(event.target.value); setCheckoutError(null); }} className="mt-1 w-full min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-3 font-mono text-zinc-100" placeholder="Enter amount received" /></label>
                <label className="block text-xs text-zinc-300">Payment method<select value={settlementMethod} onChange={event => setSettlementMethod(event.target.value as PaymentMethod)} className="mt-1 w-full min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-zinc-100"><option value="cash">Cash</option><option value="card">Card</option><option value="mobile_money">Mobile money</option></select></label>
                <p className="sm:col-span-2 text-xs text-amber-200">Local demo only: enter the amount actually received. Guest balance approval and provider confirmation are not supported.</p>
                {checkoutError && <p className="sm:col-span-2 text-xs text-rose-300" role="alert">{checkoutError}</p>}
              </div>}
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
              <button
                onClick={() => setSelectedRoom(null)}
                className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200"
              >
                Close Window
              </button>

              {canCheckout && <button
                onClick={() => handleCheckout(selectedRoom)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-sm transition-all"
              >
                <CreditCard className="w-4 h-4" />
                <span>Record demo payment & check out</span>
              </button>}
            </div>
          </div>
        </div>
      )}

      {/* Checkout Statement Slip Modal */}
      {checkoutSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Local folio preview completed</h3>
                <p className="text-xs text-zinc-400 font-mono">Room {checkoutSlip.room.number} marked Vacant Dirty for housekeeping</p>
              </div>
              <button onClick={() => setCheckoutSlip(null)} className="p-1 text-zinc-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-white text-zinc-950 rounded font-mono text-xs space-y-2">
              <div className="text-center font-bold">{tenant.name.toUpperCase()}</div>
              <div className="text-center text-[10px] text-zinc-600">GUEST CHECKOUT STATEMENT</div>
              <div className="border-t border-dashed border-zinc-400 my-2"></div>
              <div>ROOM: {checkoutSlip.room.number} ({checkoutSlip.room.type})</div>
              <div>GUEST: {checkoutSlip.room.guestName}</div>
              <div className="border-t border-dashed border-zinc-400 my-2"></div>
              {checkoutSlip.charges.map((c, i) => (
                <div key={i} className="flex justify-between text-[11px]">
                  <span className="truncate max-w-[200px]">{c.description}</span>
                  <span className="tabular-nums">${c.amount.toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t border-zinc-800 pt-1 flex justify-between font-bold text-sm">
                <span>TOTAL FOLIO CHARGES:</span>
                <span className="tabular-nums">${checkoutSlip.total.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCheckoutSlip(null)}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
