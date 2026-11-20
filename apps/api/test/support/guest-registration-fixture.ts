import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CommandEnvelope } from '../../src/contracts.js';
import type { GuestRegistrationInput, GuestRegistrationOperation, GuestRegistrationPolicyInput, GuestRegistrationSave, GuestRegistrationView } from '../../src/guestRegistrationTypes.js';

export interface GuestTestActor {
  tenantId: string;
  outletId: string;
  userId: string;
  deviceId: string;
  headers: Record<string, string>;
}

export const disposableGuestPolicy: GuestRegistrationPolicyInput = {
  reviewed: true,
  acceptedDocumentTypes: ['NATIONAL_ID', 'PASSPORT', 'RESIDENT_ID', 'OTHER'],
  requireNationality: false,
  requireResidence: false,
  requirePassportExpiry: false,
  draftRetentionDays: 1,
  identityRetentionDays: 30,
  privacyNotice: 'Disposable test property uses guest details for arrival registration, identity verification and stay administration.',
};

export function guestCommand(actor: GuestTestActor, type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope {
  return { protocolVersion: 1, commandId: randomUUID(), tenantId: actor.tenantId, deviceId: actor.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload };
}

export function guestDetails(adultCount = 1, childCount = 0, verified = true): GuestRegistrationInput {
  const adults = Array.from({ length: adultCount }, (_, index) => ({
    id: randomUUID(), kind: 'ADULT' as const, primary: index === 0, fullName: `Disposable Guest ${index + 1}`,
    phone: index === 0 ? '+254700000001' : '', email: '', nationality: 'KE', residenceCountry: 'KE', residenceCity: 'Mwingi',
    dateOfBirth: '', ageBand: '', guardianId: null,
    identity: verified
      ? { action: 'REPLACE' as const, documentType: 'NATIONAL_ID' as const, number: `001234567${index}`, issuingCountry: 'KE', verified: true }
      : { action: 'REMOVE' as const, verified: false },
  }));
  const children = Array.from({ length: childCount }, (_, index) => ({
    id: randomUUID(), kind: 'CHILD' as const, primary: false, fullName: `Disposable Child ${index + 1}`,
    phone: '', email: '', nationality: '', residenceCountry: '', residenceCity: '', dateOfBirth: '', ageBand: '6-12', guardianId: adults[0].id,
    identity: { action: 'REMOVE' as const, verified: false },
  }));
  return {
    adultCount, childCount,
    booker: { fullName: 'Disposable Booker', phone: '+254700000002', email: 'booker@example.invalid', alternativePhone: '', company: '', bookingReference: '', arrivalTime: '', purpose: '', notes: '', noContactReason: '' },
    emergencyContact: { name: '', phone: '', relationship: '' },
    occupants: [...adults, ...children],
  };
}

export function guestOperation(actor: GuestTestActor, registrationId: string = randomUUID(), expectedVersion = 0, kind: GuestRegistrationOperation['kind'] = 'hotel.registration.save'): GuestRegistrationOperation {
  return { protocolVersion: 1, commandId: randomUUID(), registrationId, expectedVersion, kind, scope: { tenantId: actor.tenantId, actorId: actor.userId, outletId: actor.outletId, deviceId: actor.deviceId } };
}

export function submitGuestPrivateSave(app: FastifyInstance, actor: GuestTestActor, input: GuestRegistrationSave) {
  return app.inject({ method: 'POST', url: '/api/v1/hospitality/registrations/save', headers: actor.headers, payload: input });
}

export async function readGuestRegistration(app: FastifyInstance, actor: GuestTestActor, id: string): Promise<GuestRegistrationView> {
  const response = await app.inject({ url: `/api/v1/hospitality/registrations/${id}`, headers: actor.headers });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().registration;
}

export async function reviewGuestPolicy(app: FastifyInstance, actor: GuestTestActor, overrides: Partial<GuestRegistrationPolicyInput> = {}) {
  const before = await app.inject({ url: '/api/v1/hospitality/registration-policy', headers: actor.headers });
  assert.equal(before.statusCode, 200, before.body);
  const command = guestCommand(actor, 'hotel.registration.policy.update', { ...disposableGuestPolicy, ...overrides }, { 'guest-policy': before.json().policy.version });
  const saved = await app.inject({ method: 'POST', url: '/api/v1/commands', headers: actor.headers, payload: command });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().status, 'CONFIRMED', saved.body);
  const after = await app.inject({ url: '/api/v1/hospitality/registration-policy', headers: actor.headers });
  assert.equal(after.statusCode, 200, after.body);
  assert.equal(after.json().policy.requireIdentityForAllAdults, true);
  return after.json().policy;
}

export async function createGuestRegistration(app: FastifyInstance, actor: GuestTestActor, details: GuestRegistrationInput = guestDetails()) {
  const operation = guestOperation(actor);
  const input: GuestRegistrationSave = { ...operation, details };
  const response = await submitGuestPrivateSave(app, actor, input);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, 'CONFIRMED', response.body);
  return { input, response: response.json(), registration: await readGuestRegistration(app, actor, operation.registrationId) };
}
