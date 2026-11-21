import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { GuestRegistrationSave, GuestRegistrationView } from '../apps/api/src/guestRegistrationTypes';

const roomId = 'a657ab27-e02b-400b-80cb-c1ccff553521';
const policy = { version: 1, reviewed: true, requireIdentityForAllAdults: true, acceptedDocumentTypes: ['NATIONAL_ID','PASSPORT','RESIDENT_ID','OTHER'], requireNationality: false, requireResidence: false, requirePassportExpiry: false, draftRetentionDays: 2, identityRetentionDays: 30, privacyNotice: 'Guest information is used for registration and access is limited to authorized hotel staff.' };
const permissions = ['hotel.frontdesk','hotel.manage','hotel.housekeeping','hotel.guest.reveal','hotel.guest.policy','hotel.guest.retention'];

async function hotel(page: Page, options: { losePrivateResponse?: boolean; loseCheckIn?: boolean; holdSave?: number } = {}) {
  const room = { id: roomId, roomNumber: '101', roomType: 'Family', nightlyRateMinor: 10000, taxRateBps: 0, currency: 'KES', status: 'READY', version: 1, maxAdults: 3, maxChildren: 2, maxOccupants: 4 };
  const bookings: any[] = [], stays: any[] = [], saves: GuestRegistrationSave[] = [], posts: any[] = [];
  const registrations = new Map<string, GuestRegistrationView>();
  const outcomes = new Map<string, any>();
  const numbers = new Map<string, string>();
  let release: (() => void) | undefined;
  let privateLost = false, checkInLost = false;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: { user: { id: 'guest-user', name: 'Guest Owner', email: 'guest@example.invalid', role: 'owner', permissions }, tenant: { id: 'guest-tenant', name: 'Guest Hotel', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['hospitality','commerce','inventory'] }, outlet: { id: 'guest-outlet', name: 'Guest Outlet', timeZone: 'Africa/Nairobi' }, deviceId: 'guest-device', csrfToken: 'guest-csrf' } });
    if (path === '/hospitality/rooms') return route.fulfill({ json: { rooms: [{ ...room }] } });
    if (path === '/hospitality/reservations') return route.fulfill({ json: { reservations: bookings.filter(item => item.status === 'CONFIRMED') } });
    if (path === '/hospitality/stays') return route.fulfill({ json: { stays } });
    if (path === '/hospitality/registration-policy') return route.fulfill({ json: { policy } });
    if (path === '/hospitality/registrations/save') {
      const input = route.request().postDataJSON() as GuestRegistrationSave;
      saves.push(input);
      const old = registrations.get(input.registrationId);
      const booking = bookings.find(item => item.id === input.reservationId);
      if (booking) booking.version++;
      const view: GuestRegistrationView = { ...input.details, id: input.registrationId, version: input.expectedVersion + 1, status: input.kind === 'hotel.registration.correct' ? 'FINAL' : 'DRAFT', policyVersion: 1,
        reservationId: input.reservationId ?? old?.reservationId ?? null, reservationVersion: booking?.version ?? old?.reservationVersion ?? null, stayId: old?.stayId ?? null, missingFields: [], dataErasedAt: null,
        occupants: input.details.occupants.map(person => {
          const previous = old?.occupants.find(item => item.id === person.id)?.identity;
          if (person.identity.action === 'REPLACE') numbers.set(person.id, person.identity.number!);
          return { ...person, identity: person.identity.action === 'KEEP' && previous ? { ...previous, verified: person.identity.verified } : person.identity.action === 'REPLACE'
            ? { documentType: person.identity.documentType!, maskedNumber: '••••' + person.identity.number!.slice(-4), issuingCountry: person.identity.issuingCountry!, expiresOn: person.identity.expiresOn || null, verified: person.identity.verified, verifiedAt: person.identity.verified ? new Date().toISOString() : null }
            : { documentType: null, maskedNumber: null, issuingCountry: null, expiresOn: null, verified: false, verifiedAt: null } };
        }) };
      registrations.set(view.id, view);
      const outcome = { status: 'CONFIRMED', value: { registrationId: view.id, version: view.version, status: view.status, policyVersion: view.policyVersion, reservationId: view.reservationId, reservationVersion: view.reservationVersion } };
      outcomes.set(input.commandId, outcome);
      if (options.holdSave === saves.length) await new Promise<void>(resolve => { release = resolve; });
      if (options.losePrivateResponse && !privateLost) { privateLost = true; return route.abort('failed'); }
      return route.fulfill({ json: { commandId: input.commandId, ...outcome } });
    }
    if (path.startsWith('/hospitality/registrations/') && path.endsWith('/reveal')) {
      const input = route.request().postDataJSON();
      return route.fulfill({ json: { number: numbers.get(input.occupantId) } });
    }
    if (path.startsWith('/hospitality/registrations/')) return route.fulfill({ json: { registration: registrations.get(path.split('/').at(-1)!) } });
    if (path === '/commands') {
      const command = route.request().postDataJSON(); posts.push(command);
      if (command.type === 'hotel.checkin' && options.loseCheckIn && !checkInLost) { checkInLost = true; return route.abort('failed'); }
      if (outcomes.has(command.commandId)) return route.fulfill({ json: { commandId: command.commandId, ...outcomes.get(command.commandId) } });
      const registration = registrations.get(command.payload.registrationId)!;
      let value: any = {};
      if (command.type === 'hotel.reservation.create') {
        const booking = { id: randomUUID(), roomId, roomNumber: '101', guestName: registration.occupants.find(person => person.primary)!.fullName, guestContact: registration.booker.phone || registration.booker.email, checkInDate: command.payload.checkInDate, checkOutDate: command.payload.checkOutDate, nightlyRateMinor: 10000, taxRateBps: 0, currency: 'KES', status: 'CONFIRMED', version: 1, registrationId: registration.id, registrationVersion: ++registration.version };
        registration.reservationId = booking.id; registration.reservationVersion = 1; bookings.push(booking); room.version++;
        value = { reservationId: booking.id, roomId, version: 1, registrationId: registration.id, registrationVersion: registration.version, status: 'CONFIRMED' };
      } else if (command.type === 'hotel.checkin') {
        room.status = 'OCCUPIED'; room.version++;
        registration.status = 'FINAL'; registration.version++; registration.stayId = randomUUID();
        const booking = bookings.find(item => item.id === command.payload.reservationId); if (booking) booking.status = 'CHECKED_IN';
        const stay = { id: registration.stayId, roomId, roomNumber: '101', roomVersion: room.version, guestName: registration.occupants.find(person => person.primary)!.fullName, guestContact: registration.booker.phone, checkInDate: command.payload.checkInDate, checkOutDate: command.payload.checkOutDate, checkedInAt: new Date().toISOString(), nightlyRateMinor: 10000, taxRateBps: 0, currency: 'KES', status: 'CHECKED_IN', version: 1, nights: 1, estimatedSubtotalMinor: 10000, estimatedTaxMinor: 0, estimatedTotalMinor: 10000, registrationId: registration.id, registrationVersion: registration.version };
        stays.push(stay); value = { stayId: stay.id, folioId: randomUUID(), roomId, roomVersion: room.version, registrationId: registration.id, registrationVersion: registration.version, guestName: stay.guestName, checkInDate: stay.checkInDate, checkOutDate: stay.checkOutDate, status: 'CHECKED_IN' };
      }
      const outcome = { status: 'CONFIRMED', value }; outcomes.set(command.commandId, outcome);
      return route.fulfill({ json: { commandId: command.commandId, ...outcome } });
    }
    if (path.startsWith('/commands/')) {
      const id = path.split('/').at(-1)!;
      const response = outcomes.get(id);
      return response ? route.fulfill({ json: { commandId: id, status: response.status, response } }) : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
    }
    if (path === '/catalog/items') return route.fulfill({ json: { items: [] } });
    if (path === '/shifts/current') return route.fulfill({ json: { shift: null } });
    return route.fulfill({ json: {} });
  });
  return { saves, posts, bookings, stays, release: () => release?.() };
}

async function navigateHotel(page: Page) {
  await expect(page.getByLabel('Signed in as Guest Owner')).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 768) { await page.getByRole('button', { name: 'More', exact: true }).click(); await page.locator('.mobile-more-panel').getByRole('button', { name: /^Hotel(?:,? Limited)?$/ }).click(); }
  else await page.getByRole('button', { name: /^Hotel(?:,? Limited)?$/ }).click();
  await expect(page.getByRole('heading', { name: 'Rooms and guest stays' })).toBeVisible();
}

async function newReservation(page: Page) {
  await page.getByRole('navigation', { name: 'Hotel tasks' }).getByRole('button', { name: 'Reservations', exact: true }).click();
  await page.getByRole('button', { name: 'New reservation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New room reservation' });
  await dialog.getByLabel('Primary guest full name', { exact: true }).fill('Amina Guest');
  await dialog.getByLabel('Booking contact phone', { exact: true }).fill('+254711222333');
  return dialog;
}

async function identity(dialog: ReturnType<Page['getByRole']>, adult: number, number: string) {
  await dialog.getByRole('checkbox', { name: 'Enter identity document', exact: true }).nth(adult - 1).check();
  await dialog.getByLabel(`Adult ${adult} ID/passport number`, { exact: true }).fill(number);
  await dialog.getByLabel(`Adult ${adult} issuing country`, { exact: true }).selectOption('KE');
  await dialog.getByRole('checkbox', { name: `I have sighted and verified adult ${adult}'s original identity document.`, exact: true }).check();
}

async function durableStorage(page: Page) {
  return page.evaluate(async () => {
    const data: unknown[] = [];
    for (const descriptor of await indexedDB.databases()) {
      if (!descriptor.name?.startsWith('mazao-')) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(descriptor.name!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      for (const store of Array.from(db.objectStoreNames)) data.push(await new Promise(resolve => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); }));
      db.close();
    }
    return JSON.stringify({ indexedDB: data, localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage } });
  });
}

for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }]) {
  test(`reservation and arrival verify every adult without durable IDs at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); const state = await hotel(page, { holdSave: 2 }); await page.goto('/'); await navigateHotel(page);
    let dialog = await newReservation(page);
    await dialog.getByLabel('Adults', { exact: true }).fill('2');
    await dialog.getByLabel('Children', { exact: true }).fill('1');
    await dialog.getByLabel('Adult 2 full name', { exact: true }).fill('David Guest');
    await dialog.getByLabel('Child 1 full name', { exact: true }).fill('Child Guest');
    await dialog.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
    await expect(dialog).not.toBeVisible(); expect(state.posts).toHaveLength(1);
    expect(state.posts[0].payload).toEqual(expect.objectContaining({ registrationId: state.saves[0].registrationId, roomId }));
    expect(JSON.stringify(state.posts)).not.toContain('Amina Guest'); expect(JSON.stringify(state.posts)).not.toContain('+254711222333');
    const booking = page.locator('article').filter({ hasText: 'Amina Guest' });
    await booking.getByRole('button', { name: 'Check in', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Guest check-in · Room 101' });
    await expect(dialog.getByLabel('Primary guest full name')).toHaveValue('Amina Guest'); expect(state.stays).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Complete check-in', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('provide an ID/passport');
    await identity(dialog, 1, '00000789');
    await dialog.getByRole('button', { name: 'Complete check-in', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Adult 2: provide an ID/passport'); expect(state.saves).toHaveLength(1);
    await identity(dialog, 2, 'P00123456');
    await dialog.getByRole('button', { name: 'Complete check-in', exact: true }).click();
    await expect.poll(() => state.saves.length).toBe(2);
    const storage = await durableStorage(page);
    expect(storage).not.toContain('00000789'); expect(storage).not.toContain('P00123456'); expect(storage).not.toContain('+254711222333');
    expect(storage).toContain('hotel.registration.save');
    state.release();
    await expect(page.getByRole('status').filter({ hasText: 'Guest checked in' })).toBeVisible();
    expect(state.stays).toHaveLength(1); expect(state.posts).toHaveLength(2);
    expect(state.posts[1].type).toBe('hotel.checkin'); expect(JSON.stringify(state.posts)).not.toContain('00000789'); expect(JSON.stringify(state.posts)).not.toContain('P00123456');
    expect(await durableStorage(page)).not.toContain('P00123456');
  });
}

test('lost private response recovers a masked registration after reload without resending identity', async ({ page }) => {
  const state = await hotel(page, { losePrivateResponse: true }); await page.goto('/'); await navigateHotel(page);
  let dialog = await newReservation(page);
  await dialog.getByText('Identity details — optional before arrival', { exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Add identity details now' }).check();
  await dialog.getByLabel('Adult 1 ID/passport number').fill('00000999');
  await dialog.getByLabel('Adult 1 issuing country').selectOption('KE');
  await dialog.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Guest details need status recovery' })).toBeVisible();
  expect(state.posts).toHaveLength(0); expect(await durableStorage(page)).not.toContain('00000999');
  await page.reload(); await navigateHotel(page);
  await page.getByRole('button', { name: 'Check guest save status' }).click();
  await page.getByRole('button', { name: 'Continue saved guest details' }).click();
  dialog = page.getByRole('dialog', { name: 'New room reservation' });
  await dialog.getByText('Identity details — optional before arrival', { exact: true }).click();
  await expect(dialog).toContainText('••••0999');
  await expect(dialog.getByLabel('Adult 1 ID/passport number')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(state.bookings).toHaveLength(1);
  expect(state.saves[1].details.occupants[0].identity).toEqual({ action: 'KEEP', verified: false });
  expect(await durableStorage(page)).not.toContain('00000999');
});

test('private metadata storage failure prevents submission and closing clears entered identity', async ({ page }) => {
  const state = await hotel(page); await page.goto('/'); await navigateHotel(page); let dialog = await newReservation(page);
  await dialog.getByText('Identity details — optional before arrival', { exact: true }).click(); await dialog.getByRole('checkbox', { name: 'Add identity details now' }).check();
  await dialog.getByLabel('Adult 1 ID/passport number').fill('00000666'); await dialog.getByLabel('Adult 1 issuing country').selectOption('KE');
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) { if (this.transaction.db.name === 'mazao-v1-guest-registration-operations') throw new DOMException('Disposable storage failure', 'QuotaExceededError'); return put.apply(this,args); }; });
  await dialog.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('were not sent because recovery metadata could not be saved');
  expect(state.saves).toHaveLength(0); expect(state.posts).toHaveLength(0); expect(await durableStorage(page)).not.toContain('00000666');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  dialog = await newReservation(page); await expect(dialog.getByLabel('Primary guest full name')).toHaveValue('Amina Guest');
  expect(await dialog.locator('input').evaluateAll(inputs => inputs.some(input => (input as HTMLInputElement).value === '00000666'))).toBe(false);
});

test('unknown walk-in check-in keeps the exact reference command and retries once through status recovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const state = await hotel(page, { loseCheckIn: true }); await page.goto('/'); await navigateHotel(page);
  await page.getByRole('button', { name: 'Walk-in check-in' }).click();
  const dialog = page.getByRole('dialog', { name: 'Guest check-in · Room 101' });
  await dialog.getByLabel('Primary guest full name').fill('Amina Guest'); await dialog.getByLabel('Booking contact phone', { exact: true }).fill('+254711222333'); await identity(dialog, 1, '00000444');
  await dialog.getByRole('button', { name: 'Complete check-in' }).click();
  await expect(dialog.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Complete check-in' })).toBeDisabled();
  const storage = await durableStorage(page); expect(storage).not.toContain('00000444'); expect(storage).toContain('hotel.checkin');
  await dialog.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Guest checked in' })).toBeVisible();
  expect(state.posts).toHaveLength(2); expect(state.posts[1]).toEqual(state.posts[0]); expect(state.stays).toHaveLength(1);
});
