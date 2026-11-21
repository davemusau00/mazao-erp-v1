import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BedDouble, Check, RefreshCw, UserRound } from 'lucide-react';
import {
  apiClient,
  type BackendCommand,
  type BackendReservation,
  type BackendRoom,
  type BackendStay,
  type GuestRegistrationPolicy,
} from '../../services/apiClient';
import { formatBasisPoints, formatMinorMoney, minorToMoneyInput, moneyInputToMinor } from '../../utils/money';
import { useCommandRecoveryReadiness } from '../../hooks/useCommandRecoveryReadiness';
import { CommandRecoveryReadiness } from '../common/CommandRecoveryReadiness';
import { HistoryNavigation } from '../common/HistoryNavigation';
import type { HistoryPage, HistoryOptions } from '../../types/history';
import type { GuestRegistrationRecovery } from '../../services/guestRegistrationJournal';
import { GuestRegistrationDialog, type GuestDialogMode } from './GuestRegistrationDialog';
import { HotelRegistrationSettings } from './HotelRegistrationSettings';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { guestControl, GuestField } from './GuestRegistrationFields';

type HotelView = 'rooms' | 'reservations' | 'stays' | 'housekeeping' | 'settings';
type DialogState =
  | { type: 'room' }
  | { type: 'checkout'; stay: BackendStay }
  | { type: 'guest'; mode: GuestDialogMode; room?: BackendRoom; reservation?: BackendReservation; stay?: BackendStay; registrationId?: string | null }
  | { type: 'capacity'; room: BackendRoom }
  | null;

const controlClass = 'mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white';

function todayLocal(timeZone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function percentToBps(value: string) {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a tax rate from 0% to 100%, with at most two decimals.');
  const result = Number(BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0'));
  if (result > 10_000) throw new Error('Tax rate cannot exceed 100%.');
  return result;
}

export function BackendHotelWorkspace({ initialView = 'rooms' }: { initialView?: HotelView }) {
  const session = apiClient.getSession()!;
  const permissions = session.user.permissions;
  const canFrontdesk = permissions.includes('hotel.frontdesk');
  const canManage = permissions.includes('hotel.manage');
  const canHousekeep = permissions.includes('hotel.housekeeping');
  const canGuestPolicy = permissions.includes('hotel.guest.policy');
  const today = todayLocal((session.outlet.timeZone ?? session.tenant.timeZone));

  const [view, setView] = useState<HotelView>(initialView);
  const [rooms, setRooms] = useState<BackendRoom[]>([]);
  const [reservations, setReservations] = useState<BackendReservation[]>([]);
  const [reservationPage, setReservationPage] = useState<HistoryPage>();
  const [reservationsBusy, setReservationsBusy] = useState(false);
  const reservationSearch = useRef('');
  const reservationGeneration = useRef(0);
  const [stays, setStays] = useState<BackendStay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [unknownId, setUnknownId] = useState('');
  const [guestPolicy, setGuestPolicy] = useState<GuestRegistrationPolicy | null>(null);
  const [guestRecovery, setGuestRecovery] = useState<GuestRegistrationRecovery[]>([]);
  const [guestRecoveryReady, setGuestRecoveryReady] = useState(false);
  const [guestRecoveryError, setGuestRecoveryError] = useState('');
  const [missingGuestOperation, setMissingGuestOperation] = useState('');
  const [recoveredRegistrationId, setRecoveredRegistrationId] = useState('');
  const pending = useRef<BackendCommand | null>(null);
  const recovery = useCommandRecoveryReadiness('hotel.', command => {
    pending.current = command; setUnknownId(command.commandId);
    setNotice('A guest or room action needs review. Check its status before starting another action.');
  });
  const locked = loading || !!error || !recovery.ready || !guestRecoveryReady || busy || !!unknownId || guestRecovery.length > 0;

  const [roomNumber, setRoomNumber] = useState('');
  const [roomType, setRoomType] = useState('Standard');
  const [nightlyRate, setNightlyRate] = useState('');
  const [roomTax, setRoomTax] = useState('');
  const [tendered, setTendered] = useState('');
  const [maxAdults, setMaxAdults] = useState('');
  const [maxChildren, setMaxChildren] = useState('');
  const [maxOccupants, setMaxOccupants] = useState('');
  const [capacityReason, setCapacityReason] = useState('');
  const [capacityTransitionReason, setCapacityTransitionReason] = useState('');

  const inspectGuestRecovery = useCallback(async () => {
    setGuestRecoveryReady(false); setGuestRecoveryError('');
    try { setGuestRecovery(await apiClient.listGuestRegistrationRecovery()); setGuestRecoveryReady(true); }
    catch (cause) { setGuestRecoveryError(cause instanceof Error ? cause.message : 'Guest recovery could not be checked.'); }
  }, [session.tenant.id, session.user.id, session.deviceId, session.outlet.id]);
  useEffect(() => {
    void inspectGuestRecovery();
    return apiClient.subscribeGuestRegistrationRecovery(records => { setGuestRecovery(records); setGuestRecoveryReady(true); setGuestRecoveryError(''); });
  }, [inspectGuestRecovery]);

  const refresh = useCallback(async () => {
    const reservationRequest = ++reservationGeneration.current;
    setLoading(true);
    setError('');
    try {
      const roomResult = await apiClient.listHotelRooms();
      setRooms(roomResult.rooms);
      if (canFrontdesk || canManage) setGuestPolicy((await apiClient.getGuestRegistrationPolicy()).policy);
      if (canFrontdesk) {
        const [reservationResult, stayResult] = await Promise.all([
          apiClient.listHotelReservations(undefined,{q:reservationSearch.current}), apiClient.listHotelStays(),
        ]);
        if (reservationRequest === reservationGeneration.current) {
          setReservations(reservationResult.reservations);
          setReservationPage(reservationResult.page);
        }
        setStays(stayResult.stays);
      } else {
        setReservations([]);
        setStays([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hotel workspace could not load.');
    } finally {
      setLoading(false);
    }
  }, [canFrontdesk, canManage]);

  useEffect(() => { void refresh(); }, [refresh, session.tenant.id]);

  const loadReservations = async (options: HistoryOptions, append = false) => {
    const generation = ++reservationGeneration.current;
    setReservationsBusy(true); setError('');
    try {
      const result = await apiClient.listHotelReservations(undefined, options);
      if (generation !== reservationGeneration.current) return;
      reservationSearch.current = options.q ?? '';
      setReservationPage(result.page);
      setReservations(current => append ? [...current,...result.reservations.filter(row=>!current.some(item=>item.id===row.id))] : result.reservations);
    } catch (cause) {
      if (generation === reservationGeneration.current) setError(cause instanceof Error ? cause.message : 'Reservations could not be loaded. Retry the read.');
    } finally { if (generation === reservationGeneration.current) setReservationsBusy(false); }
  };
  useEffect(()=>()=>{++reservationGeneration.current;},[]);

  const confirmation = (type: string, value: Record<string, unknown>) => {
    if (type === 'hotel.checkout') {
      return `Guest checkout confirmed. Cash received ${formatMinorMoney(Number(value.tenderedMinor ?? 0), session.tenant.currency)}; room is dirty and queued for cleaning.`;
    }
    if (type === 'hotel.checkin') return `Guest checked in. Stay ${String(value.stayId ?? '').slice(0, 8)} is confirmed.`;
    if (type === 'hotel.reservation.create') return 'Reservation confirmed.';
    if (type === 'hotel.reservation.cancel') return 'Reservation cancelled.';
    if (type === 'hotel.room.mark_ready') return 'Room marked ready for the next guest.';
    if (type === 'hotel.room.create') return 'Room created.';
    if (type === 'hotel.room.capacity.update') return 'Room capacity updated.';
    if (type === 'hotel.registration.policy.update') return 'Guest registration policy reviewed and saved.';
    if (type === 'hotel.registration.retention.run') return 'Approved retention completed for eligible expired guest details.';
    return 'Hotel action completed.';
  };

  const acknowledge = async (command: BackendCommand, outcome: { status?: string; value?: Record<string, unknown>; message?: string }) => {
    if (outcome.status === 'CONFIRMED') {
      pending.current = null; setUnknownId('');
      setNotice(confirmation(command.type, outcome.value ?? {})); setDialog(null);
      await refresh();
    } else if (outcome.status === 'REJECTED' || outcome.status === 'CONFLICT') {
      pending.current = null; setUnknownId('');
      setNotice(outcome.message ?? `Hotel action ${outcome.status.toLowerCase()}.`);
    } else {
      setUnknownId(command.commandId);
      setNotice('We could not confirm this guest or room action. Check its status before trying again.');
    }
    if (['CONFIRMED', 'REJECTED', 'CONFLICT'].includes(outcome.status ?? '')) await recovery.inspect();
  };

  const send = async (command: BackendCommand, alreadyLocked = false) => {
    if (pending.current || (!alreadyLocked && (loading || !!error || !recovery.begin()))) return;
    pending.current = command;
    setBusy(true);
    setNotice('');
    try {
      await acknowledge(command, await apiClient.submitCommand(command));
    } catch (cause) {
      setUnknownId(command.commandId);
      setNotice(cause instanceof Error ? cause.message : 'We could not confirm this guest or room action. Check status before trying again.');
    } finally {
      if (!alreadyLocked) { recovery.finish(); setBusy(false); }
    }
  };

  const run = (type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}, alreadyLocked = false) => {
    const command: BackendCommand = {
      protocolVersion: 1,
      commandId: crypto.randomUUID(),
      tenantId: session.tenant.id,
      deviceId: session.deviceId,
      type,
      occurredAt: new Date().toISOString(),
      expectedVersions,
      payload,
    };
    return send(command, alreadyLocked);
  };

  const checkStatus = async () => {
    if (!unknownId || !pending.current || !recovery.begin()) return;
    const original = pending.current;
    setBusy(true);
    try {
      const result = await apiClient.checkCommandStatus(unknownId);
      await acknowledge(original, result.response);
    } catch (cause) {
      try {
        if ((cause as { status?: number }).status !== 404) throw cause;
        await acknowledge(original, await apiClient.submitCommand(original));
      } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'We could not check this guest or room action. Try again.'); }
    } finally { recovery.finish(); setBusy(false); }
  };

  const createRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await run('hotel.room.create', {
        roomNumber: roomNumber.trim(), roomType: roomType.trim(),
        nightlyRateMinor: moneyInputToMinor(nightlyRate, session.tenant.currency), ...(roomTax.trim() ? { taxRateBps: percentToBps(roomTax) } : {}),
        maxAdults: capacityNumber(maxAdults, 'adult'), maxChildren: capacityNumber(maxChildren, 'child', true), maxOccupants: capacityNumber(maxOccupants, 'total'),
      });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Room details are invalid.');
    }
  };

  const openWalkin = (room: BackendRoom) => {
    setDialog({ type: 'guest', mode: 'arrival', room });
  };

  const openCapacity = (room: BackendRoom) => {
    setMaxAdults(room.maxAdults == null ? '' : String(room.maxAdults)); setMaxChildren(room.maxChildren == null ? '' : String(room.maxChildren));
    setMaxOccupants(room.maxOccupants == null ? '' : String(room.maxOccupants)); setCapacityReason(''); setCapacityTransitionReason(''); setDialog({ type: 'capacity', room });
  };
  const saveCapacity = async (event: React.FormEvent) => {
    event.preventDefault(); if (dialog?.type !== 'capacity') return;
    try { await run('hotel.room.capacity.update', { roomId: dialog.room.id, maxAdults: capacityNumber(maxAdults, 'adult'), maxChildren: capacityNumber(maxChildren, 'child', true), maxOccupants: capacityNumber(maxOccupants, 'total'), reason: capacityReason.trim(), ...(capacityTransitionReason.trim() ? { legacyTransitionReason: capacityTransitionReason.trim() } : {}) }, { [`room:${dialog.room.id}`]: dialog.room.version }); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Room capacity needs review.'); }
  };
  const recoverGuest = async (operation: GuestRegistrationRecovery, fence = false) => {
    if (busy) return;
    setBusy(true); setNotice('');
    try {
      const result = fence ? await apiClient.reconcileGuestRegistration(operation) : await apiClient.checkGuestRegistrationStatus(operation);
      setMissingGuestOperation(''); setDialog(null);
      if (result.status === 'CONFIRMED') { setRecoveredRegistrationId(operation.registrationId); setNotice('Guest details were saved. Review them before continuing the reservation or check-in.'); }
      else setNotice(String(result.response.message ?? 'The original guest save is resolved. Re-enter any details needed for a new attempt.'));
    } catch (cause) {
      if ((cause as {status?: number}).status === 404) { setMissingGuestOperation(operation.commandId); setNotice('The guest save is not yet recorded. Safely stop the original request before re-entering private details.'); }
      else setNotice(cause instanceof Error ? cause.message : 'Guest details still need status recovery.');
    } finally { await inspectGuestRecovery(); setBusy(false); }
  };
  const continueRecoveredGuest = async () => {
    setBusy(true);
    try {
      const { registration } = await apiClient.getGuestRegistration(recoveredRegistrationId);
      if (registration.stayId && registration.status === 'FINAL') {
        const stay = stays.find(item => item.id === registration.stayId);
        if (!stay) throw new Error('Refresh the current guest stays before reviewing this registration.');
        setDialog({ type: 'guest', mode: 'correction', stay, registrationId: registration.id });
      } else if (registration.reservationId) {
        const booking = reservations.find(item => item.id === registration.reservationId);
        if (!booking) throw new Error('The original reservation is no longer in active arrivals. Refresh its records before continuing.');
        setDialog({ type: 'guest', mode: 'edit', reservation: booking, room: rooms.find(item => item.id === booking.roomId), registrationId: registration.id });
      } else setDialog({ type: 'guest', mode: 'booking', registrationId: registration.id });
      setRecoveredRegistrationId('');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Saved guest details could not be reopened.'); }
    finally { setBusy(false); }
  };

  const openCheckout = (stay: BackendStay) => {
    setTendered(minorToMoneyInput(stay.estimatedTotalMinor, stay.currency));
    setDialog({ type: 'checkout', stay });
  };

  const checkout = async (event: React.FormEvent, stay: BackendStay) => {
    event.preventDefault();
    if (locked || pending.current || !recovery.begin()) return;
    setBusy(true);
    try {
      const amount = moneyInputToMinor(tendered, session.tenant.currency);
      const shift = (await apiClient.getCurrentShift()).shift;
      if (!shift) throw new Error('Open a till before taking checkout payment.');
      await run('hotel.checkout', {
        stayId: stay.id, shiftId: shift.id, tenderedMinor: amount, currency: session.tenant.currency,
      }, {
        [`stay:${stay.id}`]: stay.version,
        [`room:${stay.roomId}`]: stay.roomVersion,
        [`shift:${shift.id}`]: shift.version,
      }, true);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Checkout details are invalid.');
    } finally { recovery.finish(); setBusy(false); }
  };

  const cancelReservation = (reservation: BackendReservation) => run(
    'hotel.reservation.cancel', { reservationId: reservation.id },
    { [`reservation:${reservation.id}`]: reservation.version },
  );
  const markReady = (room: BackendRoom) => run(
    'hotel.room.mark_ready', { roomId: room.id }, { [`room:${room.id}`]: room.version },
  );

  const recoveryMessage = unknownId && <div role="alert" className="mb-4 rounded-lg border border-amber-800 p-3 text-sm text-amber-100">{notice}<button type="button" disabled={busy || !recovery.ready} onClick={() => void checkStatus()} className="mt-2 min-h-11 rounded-lg border border-amber-700 px-4 underline">Check status</button></div>;
  const privateRecoveryPanel = guestRecovery.length > 0 && <section aria-label="Guest registration recovery" className="space-y-2 rounded-xl border border-amber-800 p-3 text-sm text-amber-100"><h2 className="font-semibold">Guest details need status recovery</h2><p>Private input is not stored on this device. Check the original save before starting another guest action.</p>{guestRecovery.map(operation => <div key={operation.commandId} className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void recoverGuest(operation)} className="min-h-11 rounded-lg border border-amber-700 px-3">Check guest save status</button>{missingGuestOperation === operation.commandId && <button type="button" disabled={busy} onClick={() => void recoverGuest(operation, true)} className="min-h-11 rounded-lg border border-amber-700 px-3">Safely stop original guest save</button>}</div>)}</section>;

  const tabs: Array<[HotelView, string]> = [
    ['rooms', 'Rooms'],
    ...(canFrontdesk ? [['reservations', 'Reservations'], ['stays', 'Checked-in guests']] as Array<[HotelView, string]> : []),
    ...(canHousekeep ? [['housekeeping', 'Housekeeping']] as Array<[HotelView, string]> : []),
    ...(canGuestPolicy ? [['settings', 'Guest registration policy']] as Array<[HotelView, string]> : []),
  ];

  return <main className="min-h-full space-y-5 overflow-y-auto p-4 pb-24 text-zinc-100 sm:p-6">
    <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} />
    {!guestRecoveryReady && <div role="alert" className="rounded-lg border border-amber-800 p-3 text-sm text-amber-100">{guestRecoveryError || 'Checking private guest registration recovery…'}<button type="button" onClick={() => void inspectGuestRecovery()} className="ml-2 min-h-11 underline">Retry guest recovery</button></div>}
    {dialog?.type !== 'guest' && privateRecoveryPanel}
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs tracking-[.18em] text-blue-300">HOTEL · {session.outlet.name.toUpperCase()}</p>
        <h1 className="mt-2 text-3xl font-bold">Rooms and guest stays</h1>
        <p className="mt-2 text-sm text-zinc-400">Manage room availability, guest arrivals, cash checkout and cleaning.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4">
          <RefreshCw size={15} />Refresh
        </button>
        {canManage && view === 'rooms' && <button onClick={() => setDialog({ type: 'room' })} disabled={locked} className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold">Add room</button>}
      </div>
    </header>

    {error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
    {notice && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-800 bg-blue-950/40 p-3 text-sm text-blue-200"><span>{notice}</span>{unknownId && <button onClick={() => void checkStatus()} disabled={busy || !recovery.ready} className="min-h-11 underline">Check status</button>}</div>}
    {recoveredRegistrationId && <button type="button" onClick={() => void continueRecoveredGuest()} disabled={locked} className="min-h-11 rounded-lg border border-blue-700 px-4 text-blue-200">Continue saved guest details</button>}

    <nav className="flex gap-2 overflow-x-auto border-b border-zinc-800 pb-2" aria-label="Hotel tasks">
      {tabs.map(([id, label]) => <button key={id} onClick={() => setView(id)} className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm ${view === id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-900'}`} aria-current={view === id ? 'page' : undefined}>{label}</button>)}
    </nav>

    {loading ? <p className="p-8 text-center text-sm text-zinc-400">Loading hotel records…</p> : view === 'rooms' ?
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rooms.length === 0 ? <Empty title="No rooms configured" detail={canManage ? 'Add rooms before taking reservations or walk-ins.' : 'Ask a manager to configure this outlet.'} /> : rooms.map(room => <article key={room.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-zinc-500">{room.roomType}</p><h2 className="mt-1 text-2xl font-bold">Room {room.roomNumber}</h2></div><span className={`rounded-full px-2.5 py-1 text-xs ${room.status === 'READY' ? 'bg-emerald-950 text-emerald-300' : room.status === 'OCCUPIED' ? 'bg-blue-950 text-blue-300' : room.status === 'DIRTY' ? 'bg-amber-950 text-amber-300' : 'bg-rose-950 text-rose-300'}`}>{room.status.toLowerCase()}</span></div>
          <p className="mt-4 text-sm text-zinc-300">{formatMinorMoney(room.nightlyRateMinor, room.currency)} / night <span className="ml-2 text-xs text-zinc-500">Tax {formatBasisPoints(room.taxRateBps)}%</span></p>
          {room.activeStay && <p className="mt-2 flex items-center gap-2 text-sm text-blue-200"><UserRound size={15} />{room.activeStay.guestName}</p>}
          <p className="mt-2 text-xs text-zinc-500">{room.maxOccupants == null ? 'Capacity not configured' : String(room.maxAdults)+' adults · '+String(room.maxChildren)+' children · '+String(room.maxOccupants)+' total'}</p><div className="mt-4 flex flex-wrap justify-end gap-2">{canManage && <button type="button" onClick={() => openCapacity(room)} disabled={locked} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-xs">Set capacity</button>}{canFrontdesk && room.status === 'READY' && <button onClick={() => openWalkin(room)} disabled={locked} className="min-h-11 rounded-lg bg-emerald-700 px-3 text-xs font-semibold">Walk-in check-in</button>}{canHousekeep && room.status === 'DIRTY' && <button onClick={() => void markReady(room)} disabled={locked} className="min-h-11 rounded-lg border border-emerald-800 px-3 text-xs text-emerald-200">Mark room ready</button>}</div>
        </article>)}</section> : view === 'reservations' ?
      <section className="space-y-4">
        <HistoryNavigation page={reservationPage} loaded={reservations.length} busy={reservationsBusy||loading} label="reservations" onMore={()=>void loadReservations({q:reservationSearch.current,after:reservationPage?.nextCursor??undefined},true)} onSearch={q=>void loadReservations({q})}/>
        <div className="flex justify-end"><button onClick={() => setDialog({ type: 'guest', mode: 'booking' })} disabled={locked} className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold">New reservation</button></div>
        {reservations.length === 0 ? <Empty title="No confirmed reservations" detail="Create a reservation to hold a room across the requested dates." /> : <div className="divide-y divide-zinc-800 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">{reservations.map(reservation => {
          const room = rooms.find(item => item.id === reservation.roomId);
          const arrivalReady = reservation.checkInDate <= today && reservation.checkOutDate > today;
          return <article key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="font-semibold">{reservation.guestName} · Room {reservation.roomNumber}</h2><p className="mt-1 text-sm text-zinc-400">{reservation.checkInDate} → {reservation.checkOutDate} · {formatMinorMoney(reservation.nightlyRateMinor, reservation.currency)} / night</p><p className="mt-1 text-xs text-zinc-500">{reservation.registrationId ? 'Guest registration saved · review identity before arrival' : 'Arrival registration pending'}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setDialog({ type: 'guest', mode: 'edit', room, reservation, registrationId: reservation.registrationId })} disabled={locked} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-xs">Review guest details</button><button onClick={() => { if (room) setDialog({ type: 'guest', mode: 'arrival', room, reservation, registrationId: reservation.registrationId }); }} disabled={!room || !arrivalReady || room?.status !== 'READY' || locked} title={!arrivalReady ? 'Check-in is available on the arrival date.' : undefined} className="min-h-11 rounded-lg bg-emerald-700 px-3 text-xs disabled:opacity-40">Check in</button><button onClick={() => void cancelReservation(reservation)} disabled={locked} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-xs">Cancel</button></div></article>;
        })}</div>}
      </section> : view === 'stays' ?
      <section className="space-y-3">{stays.length === 0 ? <Empty title="No current guest stays" detail="Guests appear here after check-in is confirmed." /> : stays.map(stay => <article key={stay.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"><div><h2 className="font-semibold">{stay.guestName} · Room {stay.roomNumber}</h2><p className="mt-1 text-sm text-zinc-400">{stay.checkInDate} → {stay.checkOutDate} · {stay.nights} booked nights · estimated bill {formatMinorMoney(stay.estimatedTotalMinor, stay.currency)}</p></div><div className="flex flex-wrap gap-2">{stay.registrationId && <button type="button" onClick={() => setDialog({ type: 'guest', mode: 'correction', stay, registrationId: stay.registrationId })} disabled={locked} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm">Guest details</button>}<button onClick={() => openCheckout(stay)} disabled={locked || stay.checkOutDate > today} title={stay.checkOutDate > today ? 'Checkout is available from the booked departure date.' : undefined} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold disabled:opacity-40">Review bill and check out</button></div></article>)}</section> : view === 'settings' ? <HotelRegistrationSettings policy={guestPolicy} blocked={locked} onRun={run} /> :
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rooms.filter(room => room.status === 'DIRTY').length === 0 ? <Empty title="No rooms waiting for cleaning" detail="Checked-out rooms will appear here until housekeeping marks them ready." /> : rooms.filter(room => room.status === 'DIRTY').map(room => <article key={room.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4"><p className="text-xs uppercase tracking-widest text-amber-300">Cleaning required</p><h2 className="mt-1 text-2xl font-bold">Room {room.roomNumber}</h2><p className="mt-1 text-sm text-zinc-400">{room.roomType}</p><button onClick={() => void markReady(room)} disabled={locked} className="mt-4 min-h-11 w-full rounded-xl bg-emerald-700 font-semibold">Mark clean and ready</button></article>)}</section>}

    {dialog?.type === 'room' && <Modal close={() => setDialog(null)} recovery={<><CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} />{recoveryMessage}</>} title="Add room"><form onSubmit={createRoom} className="space-y-3"><fieldset disabled={locked} className="space-y-3"><Field label="Room number"><input required maxLength={24} value={roomNumber} onChange={event => setRoomNumber(event.target.value)} className={controlClass} /></Field><Field label="Room type"><input required maxLength={80} value={roomType} onChange={event => setRoomType(event.target.value)} className={controlClass} /></Field><Field label={`Nightly rate (${session.tenant.currency})`}><input required inputMode="decimal" value={nightlyRate} onChange={event => setNightlyRate(event.target.value)} className={controlClass} /></Field><Field label="Tax rate (%) ? optional override"><input placeholder="Use configured business default" inputMode="decimal" value={roomTax} onChange={event => setRoomTax(event.target.value)} className={controlClass} /></Field><div className="grid grid-cols-3 gap-2"><Field label="Maximum adults"><input className={controlClass} required type="number" min="1" value={maxAdults} onChange={event => setMaxAdults(event.target.value)} /></Field><Field label="Maximum children"><input className={controlClass} required type="number" min="0" value={maxChildren} onChange={event => setMaxChildren(event.target.value)} /></Field><Field label="Maximum occupants"><input className={controlClass} required type="number" min="1" value={maxOccupants} onChange={event => setMaxOccupants(event.target.value)} /></Field></div><Actions busy={busy} close={() => setDialog(null)} action="Create room" /></fieldset></form></Modal>}
    {dialog?.type === 'guest' && <GuestRegistrationDialog key={[dialog.mode,dialog.registrationId ?? dialog.reservation?.id ?? dialog.stay?.id ?? dialog.room?.id ?? 'new'].join('-')} mode={dialog.mode} registrationId={dialog.registrationId} room={dialog.room} reservation={dialog.reservation} stay={dialog.stay} rooms={rooms} policy={guestPolicy} today={today} blocked={locked} recovery={<>{recoveryMessage}{privateRecoveryPanel}</>} onClose={() => setDialog(null)} onBusy={setBusy} onSend={send} onSaved={async message => { setNotice(message); setDialog(null); await refresh(); }} />}
    {dialog?.type === 'capacity' && <ResponsiveDialog isOpen title={'Room '+dialog.room.roomNumber+' capacity'} onClose={() => setDialog(null)} closeDisabled={busy} maxWidth="lg" footerActions={<><button type="button" className="min-h-11 rounded-lg border border-zinc-700 px-3" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button type="submit" form="room-capacity-form" className="min-h-11 rounded-lg bg-blue-600 px-3 font-semibold disabled:opacity-50" disabled={locked}>Save room capacity</button></>}><form id="room-capacity-form" onSubmit={event => void saveCapacity(event)} className="space-y-3"><fieldset disabled={locked} className="space-y-3"><div className="grid grid-cols-3 gap-2"><GuestField label="Maximum adults"><input className={guestControl} required type="number" min="1" value={maxAdults} onChange={event => setMaxAdults(event.target.value)} /></GuestField><GuestField label="Maximum children"><input className={guestControl} required type="number" min="0" value={maxChildren} onChange={event => setMaxChildren(event.target.value)} /></GuestField><GuestField label="Maximum occupants"><input className={guestControl} required type="number" min="1" value={maxOccupants} onChange={event => setMaxOccupants(event.target.value)} /></GuestField></div><GuestField label="Reason for capacity change"><textarea className={guestControl} required maxLength={500} value={capacityReason} onChange={event => setCapacityReason(event.target.value)} /></GuestField><details><summary className="cursor-pointer py-2 text-sm text-blue-200">Existing bookings with unrecorded party counts</summary><GuestField label="Legacy party review and transition reason"><textarea className={guestControl} maxLength={500} value={capacityTransitionReason} onChange={event => setCapacityTransitionReason(event.target.value)} /></GuestField><p className="mt-2 text-xs text-zinc-400">Record the actual party review when older bookings have no counts. Existing guests and reservations are preserved.</p></details></fieldset></form></ResponsiveDialog>}
    {dialog?.type === 'checkout' && <Modal close={() => setDialog(null)} recovery={<><CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={() => void recovery.inspect()} />{recoveryMessage}</>} title={`Checkout · Room ${dialog.stay.roomNumber}`}><form onSubmit={event => void checkout(event, dialog.stay)} className="space-y-3"><fieldset disabled={locked} className="space-y-3"><div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3"><p className="font-semibold">{dialog.stay.guestName}</p><p className="mt-1 text-sm text-zinc-400">{dialog.stay.nights} booked nights · room revenue {formatMinorMoney(dialog.stay.estimatedSubtotalMinor, dialog.stay.currency)} · tax {formatMinorMoney(dialog.stay.estimatedTaxMinor, dialog.stay.currency)}</p><p className="mt-2 text-lg font-bold">Amount due {formatMinorMoney(dialog.stay.estimatedTotalMinor, dialog.stay.currency)}</p></div><Field label={`Cash received (${session.tenant.currency})`}><input required inputMode="decimal" value={tendered} onChange={event => setTendered(event.target.value)} className={controlClass} /></Field><p className="text-xs text-amber-200">Checkout takes full cash payment for booked nights. Open a till first. Deposits, extras, partial payments and early departure adjustments are unavailable here.</p><Actions busy={busy} close={() => setDialog(null)} action="Take cash and checkout" /></fieldset></form></Modal>}
  </main>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="col-span-full rounded-2xl border border-dashed border-zinc-800 p-8 text-center"><BedDouble className="mx-auto text-zinc-600" /><h2 className="mt-3 font-semibold">{title}</h2><p className="mt-1 text-sm text-zinc-400">{detail}</p></div>;
}

function Modal({ title, children, recovery, close }: { title: string; children: React.ReactNode; recovery?: React.ReactNode; close: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4" role="presentation"><section className="my-auto w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label={title}><header className="mb-5 flex items-center gap-3"><BedDouble size={19} className="text-blue-300" /><h2 className="text-xl font-bold">{title}</h2><button type="button" onClick={close} aria-label="Close hotel dialog" className="ml-auto min-h-11 rounded-lg border border-zinc-700 px-3 text-sm">Close</button></header>{recovery}{children}</section></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm text-zinc-300">{label}{children}</label>;
}

function Actions({ busy, close, action }: { busy: boolean; close: () => void; action: string }) {
  return <div className="flex justify-end gap-2 pt-2"><button type="button" disabled={busy} onClick={close} className="min-h-11 rounded-xl border border-zinc-700 px-4">Cancel</button><button disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold disabled:opacity-50">{busy ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}{busy ? 'Working…' : action}</button></div>;
}

function capacityNumber(value: string, label: string, allowZero = false) { const number = Number(value); if (!value.trim() || !Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) throw new Error('Enter the room '+label+' capacity as a whole number.'); return number; }
