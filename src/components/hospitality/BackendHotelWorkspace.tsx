import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BedDouble, Check, RefreshCw, UserRound } from 'lucide-react';
import {
  apiClient,
  type BackendCommand,
  type BackendReservation,
  type BackendRoom,
  type BackendStay,
} from '../../services/apiClient';
import { formatMinorMoney, moneyInputToMinor } from '../../utils/money';

type HotelView = 'rooms' | 'reservations' | 'stays' | 'housekeeping';
type DialogState =
  | { type: 'room' }
  | { type: 'reservation' }
  | { type: 'walkin'; room: BackendRoom }
  | { type: 'checkout'; stay: BackendStay }
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
  const today = todayLocal(session.tenant.timeZone);

  const [view, setView] = useState<HotelView>(initialView);
  const [rooms, setRooms] = useState<BackendRoom[]>([]);
  const [reservations, setReservations] = useState<BackendReservation[]>([]);
  const [stays, setStays] = useState<BackendStay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [unknownId, setUnknownId] = useState('');
  const pending = useRef<BackendCommand | null>(null);

  const [roomNumber, setRoomNumber] = useState('');
  const [roomType, setRoomType] = useState('Standard');
  const [nightlyRate, setNightlyRate] = useState('');
  const [roomTax, setRoomTax] = useState('0');
  const [guestName, setGuestName] = useState('');
  const [guestContact, setGuestContact] = useState('');
  const [roomId, setRoomId] = useState('');
  const [checkInDate, setCheckInDate] = useState(today);
  const [checkOutDate, setCheckOutDate] = useState(addDays(today, 1));
  const [tendered, setTendered] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const roomResult = await apiClient.listHotelRooms();
      setRooms(roomResult.rooms);
      if (canFrontdesk) {
        const [reservationResult, stayResult] = await Promise.all([
          apiClient.listHotelReservations(), apiClient.listHotelStays(),
        ]);
        setReservations(reservationResult.reservations);
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
  }, [canFrontdesk]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await refresh();
      if (!active) return;
      const recoverable = await apiClient.listRecoverableCommands(session.tenant.id);
      const record = recoverable.find(row => row.command.type.startsWith('hotel.'));
      if (record && active) {
        pending.current = record.command;
        setUnknownId(record.command.commandId);
        setNotice('An unresolved hotel command was restored. Check its server status before starting another action.');
      }
    })();
    return () => { active = false; };
  }, [refresh, session.tenant.id]);

  const confirmation = (type: string, value: Record<string, unknown>) => {
    if (type === 'hotel.checkout') {
      return `Guest checkout confirmed. Cash received ${formatMinorMoney(Number(value.tenderedMinor ?? 0), session.tenant.currency)}; room is dirty and queued for cleaning.`;
    }
    if (type === 'hotel.checkin') return `Guest checked in. Stay ${String(value.stayId ?? '').slice(0, 8)} is server-confirmed.`;
    if (type === 'hotel.reservation.create') return 'Reservation confirmed and held by the server.';
    if (type === 'hotel.reservation.cancel') return 'Reservation cancelled on the server.';
    if (type === 'hotel.room.mark_ready') return 'Room marked ready for the next guest.';
    if (type === 'hotel.room.create') return 'Room created on the server.';
    return 'Hotel action confirmed on the server.';
  };

  const send = async (command: BackendCommand) => {
    pending.current = command;
    setBusy(true);
    setNotice('');
    try {
      const outcome = await apiClient.submitCommand(command);
      if (outcome.status === 'CONFIRMED') {
        pending.current = null;
        setUnknownId('');
        setNotice(confirmation(command.type, outcome.value ?? {}));
        setDialog(null);
        await refresh();
      } else {
        pending.current = null;
        setUnknownId('');
        setNotice(outcome.message ?? `Hotel action ${outcome.status.toLowerCase()}.`);
      }
    } catch (cause) {
      setUnknownId(command.commandId);
      setNotice(cause instanceof Error ? cause.message : 'Hotel command outcome is unknown. Check status before retrying.');
    } finally {
      setBusy(false);
    }
  };

  const run = (type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}) => {
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
    return send(command);
  };

  const checkStatus = async () => {
    if (!unknownId) return;
    const original = pending.current;
    try {
      const result = await apiClient.checkCommandStatus(unknownId);
      const body = result.response as { status?: string; value?: Record<string, unknown>; message?: string };
      if (body.status === 'CONFIRMED') {
        pending.current = null;
        setUnknownId('');
        setNotice(confirmation(original?.type ?? '', body.value ?? {}));
        setDialog(null);
        await refresh();
      } else if (body.status === 'REJECTED' || body.status === 'CONFLICT') {
        pending.current = null;
        setUnknownId('');
        setNotice(body.message ?? `Hotel action ${body.status.toLowerCase()}.`);
      } else {
        setNotice(`Command status: ${result.status}. Check again shortly.`);
      }
    } catch (cause) {
      if ((cause as { status?: number }).status === 404 && original) {
        await send(original);
        return;
      }
      setNotice(cause instanceof Error ? cause.message : 'Unable to check hotel command status.');
    }
  };

  const createRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await run('hotel.room.create', {
        roomNumber: roomNumber.trim(), roomType: roomType.trim(),
        nightlyRateMinor: moneyInputToMinor(nightlyRate), taxRateBps: percentToBps(roomTax),
      });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Room details are invalid.');
    }
  };

  const createReservation = async (event: React.FormEvent) => {
    event.preventDefault();
    const room = rooms.find(item => item.id === roomId);
    if (!room) return;
    await run('hotel.reservation.create', {
      roomId, guestName: guestName.trim(), guestContact: guestContact.trim(), checkInDate, checkOutDate,
    }, { [`room:${room.id}`]: room.version });
  };

  const checkIn = (room: BackendRoom, reservation?: BackendReservation) => {
    const expectedVersions: Record<string, number> = { [`room:${room.id}`]: room.version };
    const payload: Record<string, unknown> = { roomId: room.id };
    if (reservation) {
      expectedVersions[`reservation:${reservation.id}`] = reservation.version;
      payload.reservationId = reservation.id;
    } else {
      payload.guestName = guestName.trim();
      payload.guestContact = guestContact.trim();
      payload.checkInDate = checkInDate;
      payload.checkOutDate = checkOutDate;
    }
    return run('hotel.checkin', payload, expectedVersions);
  };

  const openWalkin = (room: BackendRoom) => {
    setGuestName('');
    setGuestContact('');
    setCheckInDate(today);
    setCheckOutDate(addDays(today, 1));
    setDialog({ type: 'walkin', room });
  };

  const openCheckout = (stay: BackendStay) => {
    setTendered((stay.estimatedTotalMinor / 100).toFixed(2));
    setDialog({ type: 'checkout', stay });
  };

  const checkout = async (event: React.FormEvent, stay: BackendStay) => {
    event.preventDefault();
    try {
      const amount = moneyInputToMinor(tendered);
      const shift = (await apiClient.getCurrentShift()).shift;
      if (!shift) throw new Error('Open a server shift before taking hotel checkout payment.');
      await run('hotel.checkout', {
        stayId: stay.id, shiftId: shift.id, tenderedMinor: amount, currency: session.tenant.currency,
      }, {
        [`stay:${stay.id}`]: stay.version,
        [`room:${stay.roomId}`]: stay.roomVersion,
        [`shift:${shift.id}`]: shift.version,
      });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Checkout details are invalid.');
    }
  };

  const cancelReservation = (reservation: BackendReservation) => run(
    'hotel.reservation.cancel', { reservationId: reservation.id },
    { [`reservation:${reservation.id}`]: reservation.version },
  );
  const markReady = (room: BackendRoom) => run(
    'hotel.room.mark_ready', { roomId: room.id }, { [`room:${room.id}`]: room.version },
  );

  const tabs: Array<[HotelView, string]> = [
    ['rooms', 'Rooms'],
    ...(canFrontdesk ? [['reservations', 'Reservations'], ['stays', 'Checked-in guests']] as Array<[HotelView, string]> : []),
    ...(canHousekeep ? [['housekeeping', 'Housekeeping']] as Array<[HotelView, string]> : []),
  ];

  return <main className="min-h-full space-y-5 overflow-y-auto p-4 pb-24 text-zinc-100 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs tracking-[.18em] text-blue-300">SERVER HOTEL · {session.outlet.name.toUpperCase()}</p>
        <h1 className="mt-2 text-3xl font-bold">Rooms and guest stays</h1>
        <p className="mt-2 text-sm text-zinc-400">Room availability, check-in, cash checkout and cleaning status are server controlled.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4">
          <RefreshCw size={15} />Refresh
        </button>
        {canManage && view === 'rooms' && <button onClick={() => setDialog({ type: 'room' })} disabled={!!unknownId || busy} className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold">Add room</button>}
      </div>
    </header>

    {error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
    {notice && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-800 bg-blue-950/40 p-3 text-sm text-blue-200"><span>{notice}</span>{unknownId && <button onClick={() => void checkStatus()} disabled={busy} className="min-h-10 underline">Check command status</button>}</div>}

    <nav className="flex gap-2 overflow-x-auto border-b border-zinc-800 pb-2" aria-label="Hotel tasks">
      {tabs.map(([id, label]) => <button key={id} onClick={() => setView(id)} className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm ${view === id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-900'}`} aria-current={view === id ? 'page' : undefined}>{label}</button>)}
    </nav>

    {loading ? <p className="p-8 text-center text-sm text-zinc-400">Loading hotel records…</p> : view === 'rooms' ?
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rooms.length === 0 ? <Empty title="No rooms configured" detail={canManage ? 'Add rooms before taking reservations or walk-ins.' : 'Ask a manager to configure this outlet.'} /> : rooms.map(room => <article key={room.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-zinc-500">{room.roomType}</p><h2 className="mt-1 text-2xl font-bold">Room {room.roomNumber}</h2></div><span className={`rounded-full px-2.5 py-1 text-xs ${room.status === 'READY' ? 'bg-emerald-950 text-emerald-300' : room.status === 'OCCUPIED' ? 'bg-blue-950 text-blue-300' : room.status === 'DIRTY' ? 'bg-amber-950 text-amber-300' : 'bg-rose-950 text-rose-300'}`}>{room.status.toLowerCase()}</span></div>
          <p className="mt-4 text-sm text-zinc-300">{formatMinorMoney(room.nightlyRateMinor, room.currency)} / night <span className="ml-2 text-xs text-zinc-500">VAT {(room.taxRateBps / 100).toFixed(2)}%</span></p>
          {room.activeStay && <p className="mt-2 flex items-center gap-2 text-sm text-blue-200"><UserRound size={15} />{room.activeStay.guestName}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">{canFrontdesk && room.status === 'READY' && <button onClick={() => openWalkin(room)} disabled={!!unknownId || busy} className="min-h-11 rounded-lg bg-emerald-700 px-3 text-xs font-semibold">Walk-in check-in</button>}{canHousekeep && room.status === 'DIRTY' && <button onClick={() => void markReady(room)} disabled={!!unknownId || busy} className="min-h-11 rounded-lg border border-emerald-800 px-3 text-xs text-emerald-200">Mark room ready</button>}</div>
        </article>)}</section> : view === 'reservations' ?
      <section className="space-y-4">
        <div className="flex justify-end"><button onClick={() => { setGuestName(''); setGuestContact(''); setRoomId(rooms.find(room => room.status !== 'MAINTENANCE')?.id ?? ''); setCheckInDate(today); setCheckOutDate(addDays(today, 1)); setDialog({ type: 'reservation' }); }} disabled={!!unknownId || busy} className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold">New reservation</button></div>
        {reservations.length === 0 ? <Empty title="No confirmed reservations" detail="Create a reservation to hold a room across the requested dates." /> : <div className="divide-y divide-zinc-800 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">{reservations.map(reservation => {
          const room = rooms.find(item => item.id === reservation.roomId);
          const arrivalReady = reservation.checkInDate <= today && reservation.checkOutDate > today;
          return <article key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="font-semibold">{reservation.guestName} · Room {reservation.roomNumber}</h2><p className="mt-1 text-sm text-zinc-400">{reservation.checkInDate} → {reservation.checkOutDate} · {formatMinorMoney(reservation.nightlyRateMinor, reservation.currency)} / night</p></div><div className="flex gap-2"><button onClick={() => { if (room) void checkIn(room, reservation); }} disabled={!room || !arrivalReady || room?.status !== 'READY' || !!unknownId || busy} title={!arrivalReady ? 'Check-in is available on the arrival date.' : undefined} className="min-h-11 rounded-lg bg-emerald-700 px-3 text-xs disabled:opacity-40">Check in</button><button onClick={() => void cancelReservation(reservation)} disabled={!!unknownId || busy} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-xs">Cancel</button></div></article>;
        })}</div>}
      </section> : view === 'stays' ?
      <section className="space-y-3">{stays.length === 0 ? <Empty title="No current guest stays" detail="Walk-ins and reservation arrivals appear here after server confirmation." /> : stays.map(stay => <article key={stay.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"><div><h2 className="font-semibold">{stay.guestName} · Room {stay.roomNumber}</h2><p className="mt-1 text-sm text-zinc-400">{stay.checkInDate} → {stay.checkOutDate} · {stay.nights} booked nights · estimated bill {formatMinorMoney(stay.estimatedTotalMinor, stay.currency)}</p></div><button onClick={() => openCheckout(stay)} disabled={!!unknownId || busy || stay.checkOutDate > today} title={stay.checkOutDate > today ? 'Checkout is available from the booked departure date in this release.' : undefined} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold disabled:opacity-40">Review bill and check out</button></article>)}</section> :
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rooms.filter(room => room.status === 'DIRTY').length === 0 ? <Empty title="No rooms waiting for cleaning" detail="Checked-out rooms will appear here until housekeeping marks them ready." /> : rooms.filter(room => room.status === 'DIRTY').map(room => <article key={room.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4"><p className="text-xs uppercase tracking-widest text-amber-300">Cleaning required</p><h2 className="mt-1 text-2xl font-bold">Room {room.roomNumber}</h2><p className="mt-1 text-sm text-zinc-400">{room.roomType}</p><button onClick={() => void markReady(room)} disabled={!!unknownId || busy} className="mt-4 min-h-11 w-full rounded-xl bg-emerald-700 font-semibold">Mark clean and ready</button></article>)}</section>}

    {dialog?.type === 'room' && <Modal title="Add room"><form onSubmit={createRoom} className="space-y-3"><Field label="Room number"><input required maxLength={24} value={roomNumber} onChange={event => setRoomNumber(event.target.value)} className={controlClass} /></Field><Field label="Room type"><input required maxLength={80} value={roomType} onChange={event => setRoomType(event.target.value)} className={controlClass} /></Field><Field label={`Nightly rate (${session.tenant.currency})`}><input required inputMode="decimal" value={nightlyRate} onChange={event => setNightlyRate(event.target.value)} className={controlClass} /></Field><Field label="Tax rate (%)"><input required inputMode="decimal" value={roomTax} onChange={event => setRoomTax(event.target.value)} className={controlClass} /></Field><Actions busy={busy || !!unknownId} close={() => setDialog(null)} action="Create room" /></form></Modal>}
    {dialog?.type === 'reservation' && <Modal title="New room reservation"><form onSubmit={createReservation} className="space-y-3"><Field label="Room"><select required value={roomId} onChange={event => setRoomId(event.target.value)} className={controlClass}>{rooms.filter(room => room.status !== 'MAINTENANCE').map(room => <option key={room.id} value={room.id}>Room {room.roomNumber} · {room.roomType} · {room.status.toLowerCase()}</option>)}</select></Field><Field label="Guest name"><input required maxLength={160} value={guestName} onChange={event => setGuestName(event.target.value)} className={controlClass} /></Field><Field label="Guest contact (optional)"><input maxLength={80} value={guestContact} onChange={event => setGuestContact(event.target.value)} className={controlClass} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Check in"><input required type="date" min={today} value={checkInDate} onChange={event => setCheckInDate(event.target.value)} className={controlClass} /></Field><Field label="Check out"><input required type="date" min={addDays(checkInDate || today, 1)} value={checkOutDate} onChange={event => setCheckOutDate(event.target.value)} className={controlClass} /></Field></div><Actions busy={busy || !!unknownId} close={() => setDialog(null)} action="Confirm reservation" /></form></Modal>}
    {dialog?.type === 'walkin' && <Modal title={`Walk-in · Room ${dialog.room.roomNumber}`}><form onSubmit={event => { event.preventDefault(); void checkIn(dialog.room); }} className="space-y-3"><Field label="Guest name"><input required maxLength={160} value={guestName} onChange={event => setGuestName(event.target.value)} className={controlClass} /></Field><Field label="Guest contact (optional)"><input maxLength={80} value={guestContact} onChange={event => setGuestContact(event.target.value)} className={controlClass} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Arrival"><input type="date" required min={today} value={checkInDate} onChange={event => setCheckInDate(event.target.value)} className={controlClass} /></Field><Field label="Expected departure"><input type="date" required min={addDays(checkInDate || today, 1)} value={checkOutDate} onChange={event => setCheckOutDate(event.target.value)} className={controlClass} /></Field></div><Actions busy={busy || !!unknownId} close={() => setDialog(null)} action="Check in guest" /></form></Modal>}
    {dialog?.type === 'checkout' && <Modal title={`Checkout · Room ${dialog.stay.roomNumber}`}><form onSubmit={event => void checkout(event, dialog.stay)} className="space-y-3"><div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3"><p className="font-semibold">{dialog.stay.guestName}</p><p className="mt-1 text-sm text-zinc-400">{dialog.stay.nights} booked nights · room revenue {formatMinorMoney(dialog.stay.estimatedSubtotalMinor, dialog.stay.currency)} · tax {formatMinorMoney(dialog.stay.estimatedTaxMinor, dialog.stay.currency)}</p><p className="mt-2 text-lg font-bold">Amount due {formatMinorMoney(dialog.stay.estimatedTotalMinor, dialog.stay.currency)}</p></div><Field label={`Cash received (${session.tenant.currency})`}><input required inputMode="decimal" value={tendered} onChange={event => setTendered(event.target.value)} className={controlClass} /></Field><p className="text-xs text-amber-200">This release settles the booked room nights in full by cash. A cashier shift must be open. Deposits, extras, partial balances and early departure recalculation are not enabled.</p><Actions busy={busy || !!unknownId} close={() => setDialog(null)} action="Take cash and checkout" /></form></Modal>}
  </main>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="col-span-full rounded-2xl border border-dashed border-zinc-800 p-8 text-center"><BedDouble className="mx-auto text-zinc-600" /><h2 className="mt-3 font-semibold">{title}</h2><p className="mt-1 text-sm text-zinc-400">{detail}</p></div>;
}

function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4" role="presentation"><section className="my-auto w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label={title}><header className="mb-5 flex items-center gap-3"><BedDouble size={19} className="text-blue-300" /><h2 className="text-xl font-bold">{title}</h2></header>{children}</section></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm text-zinc-300">{label}{children}</label>;
}

function Actions({ busy, close, action }: { busy: boolean; close: () => void; action: string }) {
  return <div className="flex justify-end gap-2 pt-2"><button type="button" disabled={busy} onClick={close} className="min-h-11 rounded-xl border border-zinc-700 px-4">Cancel</button><button disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold disabled:opacity-50">{busy ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}{busy ? 'Working…' : action}</button></div>;
}
