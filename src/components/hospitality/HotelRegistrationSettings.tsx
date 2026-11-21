import React, { useEffect, useState } from 'react';
import type { GuestDocumentType, GuestRegistrationPolicy, GuestRegistrationPolicyInput } from '../../services/apiClient';
import { documentLabels, guestControl, GuestField } from './GuestRegistrationFields';

export function HotelRegistrationSettings({ policy, blocked, onRun }: {
  policy: GuestRegistrationPolicy | null; blocked: boolean;
  onRun: (type: string, payload: Record<string, unknown>, versions: Record<string, number>) => Promise<unknown>;
}) {
  const [privacyNotice, setPrivacyNotice] = useState('');
  const [identityDays, setIdentityDays] = useState('');
  const [draftDays, setDraftDays] = useState('');
  const [accepted, setAccepted] = useState<GuestDocumentType[]>([]);
  const [nationality, setNationality] = useState(false);
  const [residence, setResidence] = useState(false);
  const [passportExpiry, setPassportExpiry] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [retentionReason, setRetentionReason] = useState('');
  const [retentionReviewed, setRetentionReviewed] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!policy) return;
    setPrivacyNotice(policy.privacyNotice); setIdentityDays(policy.identityRetentionDays === null ? '' : String(policy.identityRetentionDays));
    setDraftDays(String(policy.draftRetentionDays)); setAccepted(policy.acceptedDocumentTypes); setNationality(policy.requireNationality);
    setResidence(policy.requireResidence); setPassportExpiry(policy.requirePassportExpiry); setReviewed(false);
  }, [policy?.version]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!policy || !reviewed || !privacyNotice.trim() || !accepted.length || !Number.isSafeInteger(Number(identityDays)) || Number(identityDays) < 1 || !Number.isSafeInteger(Number(draftDays)) || Number(draftDays) < 1) {
      setError('Review the privacy notice, accepted documents and positive retention periods, then confirm the policy review.'); return;
    }
    const input: GuestRegistrationPolicyInput = { reviewed: true, privacyNotice: privacyNotice.trim(), acceptedDocumentTypes: accepted,
      requireNationality: nationality, requireResidence: residence, requirePassportExpiry: passportExpiry,
      draftRetentionDays: Number(draftDays), identityRetentionDays: Number(identityDays) };
    await onRun('hotel.registration.policy.update', { ...input }, { 'guest-policy': policy.version });
  };
  return <section className="space-y-5">
    <header><h2 className="text-xl font-semibold">Guest registration policy</h2><p className="mt-1 text-sm text-zinc-400">Review the property's guest information purpose, accepted identification and retention periods before collecting ID details.</p></header>
    {!policy ? <p role="alert">Guest registration policy could not be loaded. Refresh the hotel workspace.</p> : <>
      <p className={`rounded-xl border p-3 text-sm ${policy.reviewed ? 'border-emerald-900 text-emerald-200' : 'border-amber-800 text-amber-100'}`}>{policy.reviewed ? `Reviewed policy · version ${policy.version}` : 'Policy review required before identity capture and guest check-in.'}</p>
      {error && <p role="alert" className="rounded-lg border border-rose-800 p-3 text-rose-100">{error}</p>}
      <form onSubmit={event => void submit(event)} className="max-w-3xl space-y-4 rounded-xl border border-zinc-700 p-4"><fieldset disabled={blocked} className="space-y-4">
        <p className="rounded-lg bg-zinc-900 p-3 text-sm font-semibold">Every adult occupant must have their own ID/passport recorded and verified before check-in. Children are linked to a responsible adult.</p>
        <GuestField label="Guest privacy notice"><textarea className={guestControl} required rows={5} maxLength={2000} value={privacyNotice} onChange={event => setPrivacyNotice(event.target.value)} placeholder="Explain why guest details are collected, who may access them and how guests can request assistance." /></GuestField>
        <fieldset><legend className="text-sm text-zinc-300">Accepted identity documents</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{(Object.keys(documentLabels) as GuestDocumentType[]).map(type => <label key={type} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={accepted.includes(type)} onChange={event => setAccepted(current => event.target.checked ? [...current, type] : current.filter(value => value !== type))} />{documentLabels[type]}</label>)}</div></fieldset>
        <div className="space-y-1"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={nationality} onChange={event => setNationality(event.target.checked)} />Require nationality at check-in</label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={residence} onChange={event => setResidence(event.target.checked)} />Require country and town/city of residence</label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={passportExpiry} onChange={event => setPassportExpiry(event.target.checked)} />Require expiry date for passports</label></div>
        <div className="grid gap-3 sm:grid-cols-2"><GuestField label="Private draft retention (days)"><input className={guestControl} required type="number" min="1" value={draftDays} onChange={event => setDraftDays(event.target.value)} /></GuestField><GuestField label="Identity retention after departure (days)"><input className={guestControl} required type="number" min="1" value={identityDays} onChange={event => setIdentityDays(event.target.value)} /></GuestField></div>
        <p className="text-xs text-zinc-400">Use the periods approved for this property. Active stays remain protected. Expired private data is erased while the required stay and accounting references remain.</p>
        <label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /><span>I have reviewed the collection purpose, accepted documents and retention periods for this property.</span></label>
        <button className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold disabled:opacity-50" disabled={blocked || !reviewed}>Save reviewed policy</button>
      </fieldset></form>
      <section className="max-w-3xl space-y-3 rounded-xl border border-zinc-700 p-4"><h3 className="font-semibold">Apply approved retention</h3><p className="text-sm text-zinc-400">Erase eligible expired private registration details using the reviewed policy. This action does not erase stays, folios or accounting history.</p><fieldset disabled={blocked || !policy.reviewed} className="space-y-3"><GuestField label="Reason for running guest retention"><input className={guestControl} maxLength={500} value={retentionReason} onChange={event => setRetentionReason(event.target.value)} /></GuestField><label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={retentionReviewed} onChange={event => setRetentionReviewed(event.target.checked)} /><span>Apply the approved retention periods to eligible expired guest details.</span></label><button type="button" className="min-h-11 rounded-lg border border-amber-700 px-4 text-amber-100 disabled:opacity-50" disabled={blocked || !retentionReviewed || !retentionReason.trim()} onClick={() => void onRun('hotel.registration.retention.run', { reason: retentionReason.trim() }, { 'guest-policy': policy.version })}>Run approved retention</button></fieldset></section>
    </>}
  </section>;
}
