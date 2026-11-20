import React, { useEffect, useRef, useState } from 'react';
import { BedDouble, Check, RefreshCw } from 'lucide-react';
import { apiClient, type BackendCommand, type BackendReservation, type BackendRoom, type BackendStay, type GuestRegistrationPolicy, type GuestRegistrationView } from '../../services/apiClient';
import type { GuestRegistrationRecovery } from '../../services/guestRegistrationJournal';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { formatMinorMoney } from '../../utils/money';
import { clearGuestPrivateInput, guestControl, GuestField, GuestRegistrationFields, guestFormErrors, guestFormFromView, newGuestForm } from './GuestRegistrationFields';

export type GuestDialogMode = 'booking' | 'arrival' | 'edit' | 'correction';
export function GuestRegistrationDialog({ mode, registrationId: initialId, room, reservation, stay, rooms, policy, today, blocked, recovery, onClose, onBusy, onSend, onSaved }: {
  mode: GuestDialogMode; registrationId?: string | null; room?: BackendRoom; reservation?: BackendReservation; stay?: BackendStay;
  rooms: BackendRoom[]; policy: GuestRegistrationPolicy | null; today: string; blocked: boolean;
  recovery?: React.ReactNode;
  onClose: () => void; onBusy: (busy: boolean) => void; onSend: (command: BackendCommand) => Promise<unknown>;
  onSaved: (message: string) => Promise<void>;
}) {
  const session = apiClient.getSession()!;
  const capturedScope = useRef({ tenantId: session.tenant.id, actorId: session.user.id, outletId: session.outlet.id, deviceId: session.deviceId });
  const scopeChanged = capturedScope.current.tenantId !== session.tenant.id || capturedScope.current.actorId !== session.user.id || capturedScope.current.outletId !== session.outlet.id || capturedScope.current.deviceId !== session.deviceId;
  const [form, setForm] = useState(() => newGuestForm(reservation?.guestName ?? stay?.guestName ?? '', reservation?.guestContact ?? stay?.guestContact ?? ''));
  const [registrationId, setRegistrationId] = useState(() => initialId ?? crypto.randomUUID());
  const [version, setVersion] = useState(0);
  const [reservationVersion, setReservationVersion] = useState(reservation?.version);
  const [boundReservationId, setBoundReservationId] = useState<string | null>(reservation?.id ?? null);
  const [selectedRoom, setSelectedRoom] = useState(room?.id ?? reservation?.roomId ?? rooms.find(item => item.status !== 'MAINTENANCE')?.id ?? '');
  const [arrivalDate, setArrivalDate] = useState(reservation?.checkInDate ?? stay?.checkInDate ?? today);
  const [departureDate, setDepartureDate] = useState(reservation?.checkOutDate ?? stay?.checkOutDate ?? nextDate(today));
  const [loading, setLoading] = useState(Boolean(initialId));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(mode !== 'correction');
  const [revealReason, setRevealReason] = useState('');
  const [revealed, setRevealed] = useState<{ occupantId: string; number: string } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const mounted = useRef(true);
  const currentRoom = rooms.find(item => item.id === selectedRoom) ?? room;
  const arrival = mode === 'arrival';
  const title = mode === 'booking' ? 'New room reservation' : mode === 'arrival' ? `Guest check-in · Room ${currentRoom?.roomNumber ?? ''}` : mode === 'correction' ? 'Guest registration details' : 'Review reservation guest details';

  function applyView(view: GuestRegistrationView) {
    setRegistrationId(view.id); setVersion(view.version); setForm(guestFormFromView(view));
    setBoundReservationId(view.reservationId);
    if (view.reservationVersion !== null) setReservationVersion(view.reservationVersion);
  }
  const load = async () => {
    if (!initialId && version === 0) return;
    setLoading(true); setErrors([]); setLoadFailed(false);
    try { const result = await apiClient.getGuestRegistration(initialId ?? registrationId); if (mounted.current) applyView(result.registration); }
    catch (cause) { if (mounted.current) { setLoadFailed(true); setErrors([cause instanceof Error ? cause.message : 'Guest details could not be loaded.']); } }
    finally { if (mounted.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; };
  }, [initialId]);
  useEffect(() => {
    if (!scopeChanged) return;
    setForm(newGuestForm()); setRevealed(null); onClose();
  }, [scopeChanged]);

  const save = async (intent: 'complete' | 'save') => {
    if (saving || loading || blocked || loadFailed || !editing || scopeChanged) return;
    const failures = guestFormErrors(form, arrival && intent === 'complete' || mode === 'correction', policy);
    if (mode === 'correction' && !reason.trim()) failures.push('Enter a reason for this guest registration correction.');
    if ((mode === 'booking' || mode === 'arrival') && (!currentRoom || !arrivalDate || !departureDate || departureDate <= arrivalDate)) failures.push('Choose a room and valid arrival/departure dates.');
    if (currentRoom?.maxOccupants != null && form.adultCount + form.childCount > currentRoom.maxOccupants) failures.push(`This room allows at most ${currentRoom.maxOccupants} occupants.`);
    if (currentRoom?.maxAdults != null && form.adultCount > currentRoom.maxAdults) failures.push(`This room allows at most ${currentRoom.maxAdults} adults.`);
    if (currentRoom?.maxChildren != null && form.childCount > currentRoom.maxChildren) failures.push(`This room allows at most ${currentRoom.maxChildren} children.`);
    setErrors(failures);
    if (failures.length) { requestAnimationFrame(() => document.getElementById('guest-form-errors')?.focus()); return; }
    setSaving(true); onBusy(true);
    const operation: GuestRegistrationRecovery = { protocolVersion: 1, commandId: crypto.randomUUID(), registrationId, expectedVersion: version,
      scope: { ...capturedScope.current },
      kind: mode === 'correction' ? 'hotel.registration.correct' : 'hotel.registration.save',
      ...(boundReservationId ? { reservationId: boundReservationId, expectedReservationVersion: reservationVersion } : {}),
      ...capturedScope.current, state: 'sending', savedAt: new Date().toISOString() };
    const details = privateInput();
    let sent = true;
    try {
      const outcome = await apiClient.submitGuestRegistration(operation, details, reason.trim() || undefined);
      if (!mounted.current) return;
      setForm(current => clearGuestPrivateInput(current));
      if (outcome.status !== 'CONFIRMED' || !outcome.value) { if (outcome.status === 'CONFLICT') setLoadFailed(true); setErrors([outcome.message ?? 'Guest details were not confirmed. Review the details and retry.']); return; }
      const savedVersion = Number(outcome.value.version);
      const savedReservationVersion = typeof outcome.value.reservationVersion === 'number' ? outcome.value.reservationVersion : reservationVersion;
      setVersion(savedVersion); setReservationVersion(savedReservationVersion);
      try { const fresh = await apiClient.getGuestRegistration(registrationId); if (mounted.current) applyView(fresh.registration); }
      catch (cause) { if (mounted.current) setLoadFailed(true); throw cause; }
      if (intent === 'save' || mode === 'edit' || mode === 'correction') {
        await onSaved(mode === 'correction' ? 'Guest registration correction confirmed. The original stay and bill evidence are preserved.' : 'Guest details saved. The room has not been checked in.');
        return;
      }
      const expectedVersions: Record<string, number> = { [`room:${currentRoom!.id}`]: currentRoom!.version, [`registration:${registrationId}`]: savedVersion };
      if (reservation) expectedVersions[`reservation:${reservation.id}`] = savedReservationVersion ?? reservation.version;
      const command: BackendCommand = { protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId,
        type: mode === 'booking' ? 'hotel.reservation.create' : 'hotel.checkin', occurredAt: new Date().toISOString(), expectedVersions,
        payload: { roomId: currentRoom!.id, registrationId, checkInDate: arrivalDate, checkOutDate: departureDate, ...(reservation ? { reservationId: reservation.id } : {}) } };
      await onSend(command);
    } catch (cause) {
      sent = (cause as { code?: string }).code !== 'COMMAND_NOT_SENT';
      if (mounted.current) setErrors([cause instanceof Error ? cause.message : 'Guest details need status recovery before continuing.']);
    } finally {
      // The private payload is never retained for replay. Recovery uses only its descriptor.
      details.occupants.forEach(person => { delete person.identity.number; });
      if (mounted.current) { if (sent) setForm(current => clearGuestPrivateInput(current)); setSaving(false); }
      onBusy(false);
    }
  };
  function privateInput() {
    const { differentBooker: _different, ...details } = form;
    return { ...details, booker: { ...details.booker, fullName: form.differentBooker ? details.booker.fullName : details.occupants.find(person => person.primary)?.fullName ?? '' },
      occupants: details.occupants.map(({ identity, ...person }) => ({ ...person, identity: identity.action === 'REPLACE'
        ? { action: 'REPLACE' as const, documentType: identity.documentType, number: identity.number, issuingCountry: identity.issuingCountry, expiresOn: identity.expiresOn, verified: identity.verified }
        : { action: identity.action, verified: identity.action === 'KEEP' && identity.verified } })) };
  }
  const reveal = async (occupantId: string) => {
    if (revealing || !revealReason.trim()) return;
    setRevealing(true); setRevealed(null);
    try { const result = await apiClient.revealGuestIdentity(registrationId, occupantId, revealReason.trim()); if (mounted.current) setRevealed({ occupantId, number: result.number }); }
    catch (cause) { if (mounted.current) setErrors([cause instanceof Error ? cause.message : 'The identity could not be revealed.']); }
    finally { if (mounted.current) setRevealing(false); }
  };
  const close = () => { if (saving) return; setRevealed(null); setForm(newGuestForm()); onClose(); };
  const disabled = saving || loading || blocked || loadFailed;
  const action = mode === 'booking' ? 'Confirm reservation' : arrival ? 'Complete check-in' : mode === 'correction' ? 'Confirm correction' : 'Save guest details';
  if (scopeChanged) return null;
  return <ResponsiveDialog isOpen onClose={close} closeDisabled={saving} title={title} icon={<BedDouble size={19} />} maxWidth="2xl" footerActions={<>
    <button type="button" className="min-h-11 rounded-lg border border-zinc-700 px-3" disabled={saving} onClick={close}>Cancel</button>
    {mode === 'correction' && !editing ? <button type="button" className="min-h-11 rounded-lg bg-blue-600 px-3 font-semibold" disabled={disabled} onClick={() => { setRevealed(null); setEditing(true); }}>Correct guest details</button> : <>
      {arrival && <button type="button" className="min-h-11 rounded-lg border border-blue-700 px-3 text-blue-100" disabled={disabled} onClick={() => void save('save')}>Save arrival details</button>}
      <button type="submit" form="guest-registration-form" disabled={disabled || arrival && !policy?.reviewed} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 font-semibold disabled:opacity-50">{saving ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}{saving ? 'Saving…' : action}</button>
    </>}
  </>}>
    {recovery}
    {errors.length > 0 && <div id="guest-form-errors" role="alert" tabIndex={-1} className="rounded-xl border border-rose-800 p-3 text-sm text-rose-100"><p className="font-semibold">Review guest details</p><ul className="mt-2 list-inside list-disc space-y-1">{errors.map((message, index) => <li key={index}>{message}</li>)}</ul>{loadFailed && <button type="button" className="mt-2 min-h-11 underline" onClick={() => void load()}>Retry guest details</button>}</div>}
    {loading ? <p role="status">Loading protected guest details…</p> : <form id="guest-registration-form" onSubmit={event => { event.preventDefault(); void save('complete'); }} className="space-y-5" autoComplete="off">
      {(mode === 'booking' || arrival) && <section className="space-y-3 rounded-xl border border-zinc-700 p-3 sm:p-4"><h4 className="font-semibold">Stay</h4><fieldset disabled={disabled || Boolean(reservation)} className="space-y-3">
        <GuestField label="Room"><select className={guestControl} required value={selectedRoom} onChange={event => setSelectedRoom(event.target.value)}>{rooms.filter(item => item.status !== 'MAINTENANCE').map(item => <option key={item.id} value={item.id}>Room {item.roomNumber} · {item.roomType} · {item.status.toLowerCase()}</option>)}</select></GuestField>
        <div className="grid grid-cols-2 gap-3"><GuestField label="Check in"><input className={guestControl} required type="date" min={mode === 'booking' ? today : undefined} value={arrivalDate} onChange={event => setArrivalDate(event.target.value)} /></GuestField><GuestField label="Check out"><input className={guestControl} required type="date" min={nextDate(arrivalDate || today)} value={departureDate} onChange={event => setDepartureDate(event.target.value)} /></GuestField></div>
      </fieldset>{currentRoom && <p className="text-sm text-zinc-300">{formatMinorMoney(reservation?.nightlyRateMinor ?? currentRoom.nightlyRateMinor, currentRoom.currency)} / night · {form.adultCount} adults · {form.childCount} children</p>}
      {currentRoom?.maxOccupants == null && <p className="text-xs text-amber-200">Capacity is not configured for this existing room. Confirm the room suits this party; a manager can record its capacity.</p>}
      </section>}
      {policy?.privacyNotice && <aside className="rounded-lg border border-blue-900 bg-blue-950/20 p-3 text-xs text-blue-100"><p className="font-semibold">Guest privacy notice</p><p className="mt-1 whitespace-pre-wrap">{policy.privacyNotice}</p></aside>}
      <GuestRegistrationFields value={form} onChange={setForm} arrival={arrival || mode === 'correction'} policy={policy} disabled={disabled || !editing} />
      {version > 0 && session.user.permissions.includes('hotel.guest.reveal') && form.occupants.some(person => person.identity.saved) && <section className="space-y-3 rounded-xl border border-amber-900 p-3"><h4 className="font-semibold">Authorized identity review</h4><p className="text-xs text-zinc-400">Revealing a full document number is audited. Hide it when the review is complete.</p><GuestField label="Reason to reveal identity"><select className={guestControl} disabled={disabled || revealing} value={revealReason} onChange={event => { setRevealReason(event.target.value); setRevealed(null); }}><option value="">Choose review purpose</option><option value="VERIFY_DOCUMENT">Verify original document</option><option value="CORRECT_REGISTRATION">Correct guest registration</option><option value="GUEST_REQUEST">Guest's request</option><option value="INCIDENT_REVIEW">Review a recorded incident</option></select></GuestField>{form.occupants.filter(person => person.identity.saved).map(person => <div key={person.id} className="flex flex-wrap items-center gap-2"><span className="text-sm">{person.fullName} · {person.identity.maskedNumber}</span><button type="button" disabled={disabled || revealing || !revealReason.trim()} onClick={() => void reveal(person.id)} className="min-h-11 rounded-lg border border-amber-800 px-3 text-sm">Reveal {person.primary ? 'primary guest' : person.fullName || 'occupant'} ID</button>{revealed?.occupantId === person.id && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-900 p-2"><output aria-label="Revealed identity document number" className="font-mono">{revealed.number}</output><button type="button" className="min-h-11 px-3 underline" onClick={() => setRevealed(null)}>Hide identity</button></div>}</div>)}</section>}
      {mode === 'correction' && editing && <GuestField label="Reason for guest registration correction"><textarea className={guestControl} required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></GuestField>}
      <p className="text-xs text-zinc-400">Saved document numbers are masked. Full identity values are sent privately and are not stored in browser recovery drafts.</p>
    </form>}
  </ResponsiveDialog>;
}

function nextDate(value: string) { const date = new Date(`${value}T00:00:00Z`); if (!Number.isFinite(date.getTime())) return ''; date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
