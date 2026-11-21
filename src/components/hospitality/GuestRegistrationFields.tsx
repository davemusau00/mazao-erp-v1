import React, { useId } from 'react';
import { GUEST_COUNTRY_CODES } from '../../services/apiClient';
import type { GuestDocumentType, GuestOccupantInput, GuestRegistrationInput, GuestRegistrationPolicy, GuestRegistrationView } from '../../services/apiClient';

export const guestControl = 'mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white disabled:opacity-60';
export const documentLabels: Record<GuestDocumentType, string> = { NATIONAL_ID: 'National ID', PASSPORT: 'Passport', RESIDENT_ID: 'Alien / resident ID', OTHER: 'Other approved ID' };
const countryCodes = GUEST_COUNTRY_CODES;
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countries = countryCodes.map(code => ({ code, name: regionNames.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));

export type GuestFormOccupant = Omit<GuestOccupantInput, 'identity'> & {
  identity: GuestOccupantInput['identity'] & { maskedNumber: string | null; saved: boolean };
};
export type GuestForm = Omit<GuestRegistrationInput, 'occupants'> & { occupants: GuestFormOccupant[]; differentBooker: boolean };

function occupant(kind: 'ADULT' | 'CHILD', primary = false, guardianId: string | null = null): GuestFormOccupant {
  return { id: crypto.randomUUID(), kind, primary, fullName: '', phone: '', email: '', nationality: '', residenceCountry: '', residenceCity: '', dateOfBirth: '', ageBand: '', guardianId,
    identity: { action: 'REMOVE', documentType: 'NATIONAL_ID', number: '', issuingCountry: '', expiresOn: '', verified: false, maskedNumber: null, saved: false } };
}

export function newGuestForm(name = '', contact = ''): GuestForm {
  const lead = occupant('ADULT', true);
  lead.fullName = name;
  return { adultCount: 1, childCount: 0, differentBooker: false,
    booker: { fullName: name, phone: '', email: '', alternativePhone: '', company: '', bookingReference: '', arrivalTime: '', purpose: '', notes: '', noContactReason: '' },
    emergencyContact: { name: '', phone: '', relationship: '' }, occupants: [lead],
    ...(contact ? { booker: { fullName: name, phone: contact.includes('@') ? '' : contact, email: contact.includes('@') ? contact : '', alternativePhone: '', company: '', bookingReference: '', arrivalTime: '', purpose: '', notes: '', noContactReason: '' } } : {}),
  };
}

export function guestFormFromView(view: GuestRegistrationView): GuestForm {
  const primary = view.occupants.find(person => person.primary);
  return { adultCount: view.adultCount, childCount: view.childCount, booker: { ...view.booker }, emergencyContact: { ...view.emergencyContact },
    differentBooker: Boolean(view.booker.fullName && view.booker.fullName !== primary?.fullName),
    occupants: view.occupants.map(person => ({ ...person, identity: { action: person.identity.maskedNumber ? 'KEEP' : 'REMOVE', documentType: person.identity.documentType ?? 'NATIONAL_ID', issuingCountry: person.identity.issuingCountry ?? '', expiresOn: person.identity.expiresOn ?? '', verified: person.identity.verified, number: '', maskedNumber: person.identity.maskedNumber, saved: Boolean(person.identity.maskedNumber) } })),
  };
}

export function privateGuestInput(form: GuestForm): GuestRegistrationInput {
  const lead = form.occupants.find(person => person.primary)!;
  return { adultCount: form.adultCount, childCount: form.childCount,
    booker: { ...form.booker, fullName: form.differentBooker ? form.booker.fullName : lead.fullName },
    emergencyContact: { ...form.emergencyContact },
    occupants: form.occupants.map(({ identity, ...person }) => ({ ...person, identity: identity.action === 'REPLACE'
      ? { action: 'REPLACE', documentType: identity.documentType, number: identity.number, issuingCountry: identity.issuingCountry, expiresOn: identity.expiresOn, verified: identity.verified }
      : { action: identity.action, verified: identity.action === 'KEEP' && identity.verified } })),
  };
}

export function clearGuestPrivateInput(form: GuestForm): GuestForm {
  return { ...form, occupants: form.occupants.map(person => ({ ...person, identity: { ...person.identity, number: '', action: person.identity.saved ? 'KEEP' : 'REMOVE', verified: person.identity.saved && person.identity.verified } })) };
}

export function guestFormErrors(form: GuestForm, arrival: boolean, policy: GuestRegistrationPolicy | null): string[] {
  const errors: string[] = [];
  const adults = form.occupants.filter(person => person.kind === 'ADULT');
  const children = form.occupants.filter(person => person.kind === 'CHILD');
  if (!adults.find(person => person.primary)?.fullName.trim()) errors.push('Enter the primary guest name.');
  if (form.differentBooker && !form.booker.fullName.trim()) errors.push('Enter the booking contact name.');
  if (!form.booker.phone.trim() && !form.booker.email.trim() && !form.booker.noContactReason.trim()) errors.push('Provide a booking phone or email, or explain why no contact is available.');
  if (arrival && !policy?.reviewed) errors.push('An owner or administrator must review the guest registration policy before check-in.');
  if (adults.length !== form.adultCount || children.length !== form.childCount) errors.push('Review the adult and child counts.');
  for (const [index, person] of form.occupants.entries()) {
    const ordinal = person.kind === 'CHILD' ? index - form.adultCount + 1 : index + 1;
    const label = person.primary ? 'Primary guest' : `${person.kind === 'ADULT' ? 'Adult' : 'Child'} ${ordinal}`;
    if (arrival && !person.fullName.trim()) errors.push(`${label}: enter the full name.`);
    if (person.kind === 'CHILD' && arrival && !adults.some(adult => adult.id === person.guardianId)) errors.push(`${label}: choose a responsible adult.`);
    if (arrival && policy?.requireNationality && !person.nationality) errors.push(`${label}: select nationality.`);
    if (arrival && policy?.requireResidence && (!person.residenceCountry || !person.residenceCity.trim())) errors.push(`${label}: enter country and town/city of residence.`);
    const identity = person.identity;
    if (identity.action === 'REPLACE' && (!identity.number?.trim() || !identity.issuingCountry)) errors.push(`${label}: enter the document number and issuing country.`);
    if (arrival && person.kind === 'ADULT') {
      if (identity.action === 'REMOVE' || identity.action === 'KEEP' && !identity.saved) errors.push(`${label}: provide an ID/passport.`);
      if (!identity.verified) errors.push(`${label}: verify the original identity document.`);
      if (policy?.requirePassportExpiry && identity.documentType === 'PASSPORT' && !identity.expiresOn) errors.push(`${label}: enter passport expiry.`);
    }
  }
  if (Boolean(form.emergencyContact.name.trim()) !== Boolean(form.emergencyContact.phone.trim())) errors.push('Provide both the emergency contact name and phone.');
  return errors;
}

export function GuestRegistrationFields({ value, onChange, arrival, policy, disabled = false }: {
  value: GuestForm; onChange: (form: GuestForm) => void; arrival: boolean; policy: GuestRegistrationPolicy | null; disabled?: boolean;
}) {
  const updateBooker = (key: keyof GuestRegistrationInput['booker'], field: string) => onChange({ ...value, booker: { ...value.booker, [key]: field } });
  const updatePerson = (id: string, change: Partial<GuestFormOccupant>) => onChange({ ...value, occupants: value.occupants.map(person => person.id === id ? { ...person, ...change } : person) });
  const resize = (kind: 'ADULT' | 'CHILD', count: number) => {
    if (!Number.isSafeInteger(count) || count < (kind === 'ADULT' ? 1 : 0) || count > 20) return;
    const adults = value.occupants.filter(person => person.kind === 'ADULT');
    const children = value.occupants.filter(person => person.kind === 'CHILD');
    const current = kind === 'ADULT' ? adults : children;
    const next = current.slice(0, count);
    while (next.length < count) next.push(occupant(kind, false, kind === 'CHILD' ? adults[0]?.id ?? null : null));
    const nextAdults = kind === 'ADULT' ? next : adults;
    const nextChildren = (kind === 'CHILD' ? next : children).map(child => ({ ...child, guardianId: nextAdults.some(adult => adult.id === child.guardianId) ? child.guardianId : nextAdults[0]?.id ?? null }));
    onChange({ ...value, adultCount: nextAdults.length, childCount: nextChildren.length, occupants: [...nextAdults, ...nextChildren] });
  };
  return <fieldset disabled={disabled} className="min-w-0 space-y-5">
    <section aria-labelledby="guest-party-title" className="space-y-3">
      <h4 id="guest-party-title" className="font-semibold text-zinc-100">Guests staying</h4>
      <div className="grid grid-cols-2 gap-3">
        <GuestField label="Adults"><input className={guestControl} type="number" min="1" max="20" value={value.adultCount} onChange={event => resize('ADULT', Number(event.target.value))} /></GuestField>
        <GuestField label="Children"><input className={guestControl} type="number" min="0" max="20" value={value.childCount} onChange={event => resize('CHILD', Number(event.target.value))} /></GuestField>
      </div>
      <p className="text-xs text-zinc-400">Every adult needs their own verified ID/passport at check-in. Children are recorded under a responsible adult.</p>
      {value.occupants.map((person, index) => <section key={person.id} aria-label={person.primary ? 'Primary guest details' : `${person.kind === 'ADULT' ? 'Additional adult' : 'Child'} ${person.kind === 'CHILD' ? index - value.adultCount + 1 : index + 1} details`} className="space-y-3 rounded-xl border border-zinc-700 p-3 sm:p-4">
        <h5 className="font-semibold">{person.primary ? 'Primary guest' : `${person.kind === 'ADULT' ? 'Additional adult' : 'Child'} ${person.kind === 'CHILD' ? index - value.adultCount + 1 : index + 1}`}</h5>
        <GuestField label={person.primary ? 'Primary guest full name' : `${person.kind === 'ADULT' ? 'Adult' : 'Child'} ${person.kind === 'CHILD' ? index - value.adultCount + 1 : index + 1} full name`}><input className={guestControl} autoComplete="off" maxLength={160} required={arrival || person.primary} value={person.fullName} onChange={event => updatePerson(person.id, { fullName: event.target.value })} /></GuestField>
        {person.kind === 'CHILD' && <div className="grid gap-3 sm:grid-cols-2"><GuestField label={`Child ${index - value.adultCount + 1} responsible adult`}><select className={guestControl} required={arrival} value={person.guardianId ?? ''} onChange={event => updatePerson(person.id, { guardianId: event.target.value })}><option value="">Choose adult</option>{value.occupants.filter(adult => adult.kind === 'ADULT').map((adult, adultIndex) => <option key={adult.id} value={adult.id}>{adult.fullName || `Adult ${adultIndex + 1}`}</option>)}</select></GuestField><GuestField label={`Child ${index - value.adultCount + 1} age band (optional)`}><input className={guestControl} maxLength={40} value={person.ageBand} onChange={event => updatePerson(person.id, { ageBand: event.target.value })} placeholder="For example, 6–12 years" /></GuestField></div>}
        <details open={arrival && Boolean(policy?.requireNationality || policy?.requireResidence)} className="space-y-3"><summary className="cursor-pointer py-2 text-sm text-blue-200">Contact and residence details</summary><div className="grid gap-3 sm:grid-cols-2">
          <GuestField label={`${person.primary ? 'Primary guest' : `Occupant ${index + 1}`} phone (optional)`}><input className={guestControl} type="tel" autoComplete="off" maxLength={40} value={person.phone} onChange={event => updatePerson(person.id, { phone: event.target.value })} /></GuestField>
          <GuestField label={`${person.primary ? 'Primary guest' : `Occupant ${index + 1}`} email (optional)`}><input className={guestControl} type="email" autoComplete="off" maxLength={254} value={person.email} onChange={event => updatePerson(person.id, { email: event.target.value })} /></GuestField>
          <CountryField label={`${person.primary ? 'Primary guest' : `Occupant ${index + 1}`} nationality${policy?.requireNationality && arrival ? '' : ' (optional)'}`} required={arrival && policy?.requireNationality} value={person.nationality} onChange={nationality => updatePerson(person.id, { nationality })} />
          <CountryField label={`${person.primary ? 'Primary guest' : `Occupant ${index + 1}`} country of residence${policy?.requireResidence && arrival ? '' : ' (optional)'}`} required={arrival && policy?.requireResidence} value={person.residenceCountry} onChange={residenceCountry => updatePerson(person.id, { residenceCountry })} />
          <GuestField label={`${person.primary ? 'Primary guest' : `Occupant ${index + 1}`} town/city${policy?.requireResidence && arrival ? '' : ' (optional)'}`}><input className={guestControl} required={arrival && policy?.requireResidence} maxLength={160} value={person.residenceCity} onChange={event => updatePerson(person.id, { residenceCity: event.target.value })} /></GuestField>
          <GuestField label={`${person.primary ? 'Primary guest' : `Occupant ${index + 1}`} date of birth (when needed)`}><input className={guestControl} type="date" value={person.dateOfBirth} onChange={event => updatePerson(person.id, { dateOfBirth: event.target.value })} /></GuestField>
        </div></details>
        {person.kind === 'ADULT' && <details open={arrival} className="space-y-3"><summary className="cursor-pointer py-2 text-sm text-blue-200">{arrival ? 'Identity verification — required' : 'Identity details — optional before arrival'}</summary>
          {!policy?.reviewed && <p role="status" className="rounded-lg border border-amber-800 p-3 text-xs text-amber-100">An owner or administrator must review the guest privacy notice and retention policy before identity details can be entered.</p>}
          <fieldset disabled={!policy?.reviewed} className="space-y-3">
            {person.identity.saved && <div className="rounded-lg bg-zinc-900 p-3 text-sm"><p>Saved document: <strong>{person.identity.maskedNumber}</strong></p><GuestField label={`Adult ${index + 1} saved identity action`}><select className={guestControl} value={person.identity.action} onChange={event => updatePerson(person.id, { identity: { ...person.identity, action: event.target.value as GuestFormOccupant['identity']['action'], number: '', verified: event.target.value === 'KEEP' && person.identity.verified } })}><option value="KEEP">Keep existing document</option><option value="REPLACE">Replace document</option><option value="REMOVE">Remove document</option></select></GuestField></div>}
            {!person.identity.saved && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={person.identity.action === 'REPLACE'} onChange={event => updatePerson(person.id, { identity: { ...person.identity, action: event.target.checked ? 'REPLACE' : 'REMOVE', verified: false, number: '' } })} />{arrival ? 'Enter identity document' : 'Add identity details now'}</label>}
            {person.identity.action === 'REPLACE' && <div className="grid gap-3 sm:grid-cols-2"><GuestField label={`Adult ${index + 1} document type`}><select className={guestControl} value={person.identity.documentType} onChange={event => updatePerson(person.id, { identity: { ...person.identity, documentType: event.target.value as GuestDocumentType, verified: false } })}>{(policy?.acceptedDocumentTypes ?? ['NATIONAL_ID','PASSPORT','RESIDENT_ID','OTHER'] as GuestDocumentType[]).map(type => <option key={type} value={type}>{documentLabels[type]}</option>)}</select></GuestField>
              <GuestField label={`Adult ${index + 1} ID/passport number`}><input className={guestControl} autoComplete="off" spellCheck={false} maxLength={64} required value={person.identity.number ?? ''} onChange={event => updatePerson(person.id, { identity: { ...person.identity, number: event.target.value, verified: false } })} /></GuestField>
              <CountryField label={`Adult ${index + 1} issuing country`} required value={person.identity.issuingCountry ?? ''} onChange={issuingCountry => updatePerson(person.id, { identity: { ...person.identity, issuingCountry, verified: false } })} />
              <GuestField label={`Adult ${index + 1} document expiry${person.identity.documentType === 'PASSPORT' && policy?.requirePassportExpiry ? '' : ' (when applicable)'}`}><input className={guestControl} type="date" required={person.identity.documentType === 'PASSPORT' && policy?.requirePassportExpiry} value={person.identity.expiresOn ?? ''} onChange={event => updatePerson(person.id, { identity: { ...person.identity, expiresOn: event.target.value, verified: false } })} /></GuestField>
            </div>}
            {person.identity.action !== 'REMOVE' && <label className="flex min-h-11 items-start gap-2 text-sm text-zinc-200"><input className="mt-1" type="checkbox" checked={person.identity.verified} onChange={event => updatePerson(person.id, { identity: { ...person.identity, verified: event.target.checked } })} /><span>I have sighted and verified adult {index + 1}'s original identity document.</span></label>}
          </fieldset>
        </details>}
      </section>)}
    </section>
    <section aria-labelledby="guest-booker-title" className="space-y-3 border-t border-zinc-700 pt-4"><h4 id="guest-booker-title" className="font-semibold">Booking contact</h4>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={value.differentBooker} onChange={event => onChange({ ...value, differentBooker: event.target.checked })} />Someone else is making this booking</label>
      {value.differentBooker && <GuestField label="Booking contact full name"><input className={guestControl} required maxLength={160} value={value.booker.fullName} onChange={event => updateBooker('fullName', event.target.value)} /></GuestField>}
      <div className="grid gap-3 sm:grid-cols-2"><GuestField label="Booking contact phone"><input className={guestControl} type="tel" autoComplete="off" maxLength={40} value={value.booker.phone} onChange={event => updateBooker('phone', event.target.value)} /></GuestField><GuestField label="Booking contact email"><input className={guestControl} type="email" autoComplete="off" maxLength={254} value={value.booker.email} onChange={event => updateBooker('email', event.target.value)} /></GuestField></div>
      <details><summary className="cursor-pointer py-2 text-sm text-blue-200">No phone/email available</summary><GuestField label="Reason no contact is available"><input className={guestControl} maxLength={500} value={value.booker.noContactReason} onChange={event => updateBooker('noContactReason', event.target.value)} /></GuestField></details>
    </section>
    <details className="space-y-3 border-t border-zinc-700 pt-3"><summary className="cursor-pointer py-2 font-semibold">Additional details (optional)</summary><div className="grid gap-3 sm:grid-cols-2">
      <GuestField label="Alternative contact phone"><input className={guestControl} type="tel" maxLength={40} value={value.booker.alternativePhone} onChange={event => updateBooker('alternativePhone', event.target.value)} /></GuestField>
      <GuestField label="Company or agent"><input className={guestControl} maxLength={160} value={value.booker.company} onChange={event => updateBooker('company', event.target.value)} /></GuestField>
      <GuestField label="Booking reference"><input className={guestControl} maxLength={100} value={value.booker.bookingReference} onChange={event => updateBooker('bookingReference', event.target.value)} /></GuestField>
      <GuestField label="Expected arrival time"><input className={guestControl} type="time" value={value.booker.arrivalTime} onChange={event => updateBooker('arrivalTime', event.target.value)} /></GuestField>
      <GuestField label="Visit purpose"><input className={guestControl} maxLength={100} value={value.booker.purpose} onChange={event => updateBooker('purpose', event.target.value)} /></GuestField>
      <GuestField label="Emergency contact name"><input className={guestControl} maxLength={160} value={value.emergencyContact.name} onChange={event => onChange({ ...value, emergencyContact: { ...value.emergencyContact, name: event.target.value } })} /></GuestField>
      <GuestField label="Emergency contact phone"><input className={guestControl} type="tel" maxLength={40} value={value.emergencyContact.phone} onChange={event => onChange({ ...value, emergencyContact: { ...value.emergencyContact, phone: event.target.value } })} /></GuestField>
      <GuestField label="Emergency contact relationship"><input className={guestControl} maxLength={80} value={value.emergencyContact.relationship} onChange={event => onChange({ ...value, emergencyContact: { ...value.emergencyContact, relationship: event.target.value } })} /></GuestField>
    </div><GuestField label="Operational notes"><textarea className={guestControl} maxLength={1000} value={value.booker.notes} onChange={event => updateBooker('notes', event.target.value)} /></GuestField></details>
  </fieldset>;
}

export function GuestField({ label, children }: { label: string; children: React.ReactNode }) {
  const generatedId = useId();
  if (!React.isValidElement<{ id?: string }>(children)) return <div>{children}</div>;
  const id = children.props.id ?? generatedId;
  return <div className="block text-sm text-zinc-300"><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id })}</div>;
}
function CountryField({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <GuestField label={label}><select className={guestControl} required={required} value={value} onChange={event => onChange(event.target.value)}><option value="">Select country</option>{countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</select></GuestField>;
}
