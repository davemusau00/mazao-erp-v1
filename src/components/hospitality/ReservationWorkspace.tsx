import React, { useMemo, useState } from 'react';
import { CalendarDays, CircleAlert, DoorOpen, SearchCheck } from 'lucide-react';
import type { Room, TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import { EmptyState, WorkspaceHeading } from '../common/WorkspacePrimitives';

export function ReservationWorkspace({ tenant }: { tenant: TenantProfile }) {
  const [arrival, setArrival] = useState('');
  const [departure, setDeparture] = useState('');
  const [guestCount, setGuestCount] = useState('1');
  const [guestName, setGuestName] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [review, setReview] = useState(false);
  const rooms = storage.getRooms();
  const validDates = Boolean(arrival && departure && departure > arrival);
  const availableRooms = useMemo(() => rooms.filter(room => {
    if (room.status !== 'vacant_clean' || Number(guestCount) > room.maxGuests) return false;
    const hasDates = room.checkInDate && room.checkOutDate;
    if (!validDates || !hasDates) return true;
    return !(arrival < room.checkOutDate! && departure > room.checkInDate!);
  }), [rooms, guestCount, arrival, departure, validDates]);
  const selectedRoom = rooms.find(room => room.id === selectedRoomId);
  const nights = validDates ? Math.max(1, Math.round((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86400000)) : 0;
  const estimate = selectedRoom ? selectedRoom.ratePerNight * nights : 0;
  const formatMoney = (amount: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: tenant.currency }).format(amount);

  return <div className="page-stack">
    <WorkspaceHeading eyebrow="HOTEL · BOOKINGS" title="Find a room" description="Check the local preview calendar, then review a reservation request." action={<span className="local-data-badge"><span /> Availability preview</span>} />
    <div className="preview-notice"><CircleAlert size={16} /><span>Availability comes from browser demo data and cannot lock a room. No booking or deposit is created from this screen.</span></div>
    <div className="reservation-layout"><section className="workflow-panel"><div className="panel-heading"><div><h2>Stay details</h2><p>Choose dates and guest count to search the current room preview.</p></div><CalendarDays size={18} /></div>
      <div className="form-grid"><label className="form-field"><span>Arrival</span><input type="date" value={arrival} onChange={event => setArrival(event.target.value)} /></label><label className="form-field"><span>Departure</span><input type="date" min={arrival || undefined} value={departure} onChange={event => setDeparture(event.target.value)} /></label><label className="form-field"><span>Guests</span><input type="number" min="1" max="12" value={guestCount} onChange={event => setGuestCount(event.target.value)} /></label><label className="form-field"><span>Guest name · optional</span><input value={guestName} onChange={event => setGuestName(event.target.value)} placeholder="Add after availability" /></label></div>
      {!validDates && (arrival || departure) && <small className="field-error">Departure must be after arrival.</small>}
      <div className="panel-heading results-heading"><div><h2>{validDates ? `${availableRooms.length} room options` : 'Room options'}</h2><p>{validDates ? `${nights} ${nights === 1 ? 'night' : 'nights'} · preview only` : 'Enter valid dates to review the local room snapshot.'}</p></div><SearchCheck size={18} /></div>
      {validDates && availableRooms.length ? <div className="available-room-list">{availableRooms.map(room => <button type="button" className={selectedRoomId === room.id ? 'selected' : ''} key={room.id} onClick={() => setSelectedRoomId(room.id)}><span className="room-option-icon"><DoorOpen size={17} /></span><span className="room-option-main"><strong>Room {room.number} · {room.type}</strong><small>Up to {room.maxGuests} guests · {room.tier}</small></span><span className="room-option-price"><strong>{formatMoney(room.ratePerNight)}</strong><small>per night</small></span></button>)}</div> : validDates ? <EmptyState title="No preview rooms match" detail="Try another date range or reduce the guest count. This is not a live availability check." /> : null}
      <div className="reservation-footer"><span>{selectedRoom ? `${nights} nights · ${formatMoney(estimate)} estimated` : 'Select a room option to review the request.'}</span><button className="primary-action" type="button" disabled={!selectedRoom || !guestName.trim() || !validDates} onClick={() => setReview(true)}>Review request</button></div>
    </section>
      <aside className="workflow-panel booking-guidance"><h2>Before confirming a stay</h2><ul className="check-list"><li>Server must verify the room is still available.</li><li>Rate and tax must be confirmed for the dates.</li><li>Any deposit must be recorded separately from earned revenue.</li><li>Walk-in guests do not need a marketing profile.</li></ul><p className="muted-copy">A review draft is not a reservation and does not block another booking.</p></aside>
    </div>
    {review && selectedRoom && <div className="review-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setReview(false); }}><section className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="reservation-review-title"><div className="panel-heading"><div><span className="eyebrow">LOCAL PREVIEW</span><h2 id="reservation-review-title">Review reservation request</h2></div><button className="quiet-action" type="button" onClick={() => setReview(false)}>Close</button></div><div className="reservation-review-card"><strong>{guestName}</strong><span>Room {selectedRoom.number} · {selectedRoom.type}</span><span>{arrival} → {departure} · {nights} nights</span><strong>{formatMoney(estimate)} estimated room charge</strong></div><div className="preview-notice"><CircleAlert size={16} /><span>Request not sent. Availability has not been locked, and no deposit or guest bill has been created.</span></div><button className="primary-action" type="button" onClick={() => setReview(false)}>Back to availability</button></section></div>}
  </div>;
}
