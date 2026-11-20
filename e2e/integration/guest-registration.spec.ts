import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Locator } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.19' } });
const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
test.afterAll(async () => { await pool.end(); });

async function identity(dialog: Locator, ordinal: number, number: string) {
  const person = dialog.getByRole('region', { name: ordinal === 1 ? 'Primary guest details' : `Additional adult ${ordinal} details`, exact: true });
  await person.getByRole('checkbox', { name: 'Enter identity document', exact: true }).check();
  await dialog.getByLabel(`Adult ${ordinal} ID/passport number`, { exact: true }).fill(number);
  await dialog.getByLabel(`Adult ${ordinal} issuing country`, { exact: true }).selectOption('KE');
  await dialog.getByRole('checkbox', { name: `I have sighted and verified adult ${ordinal}'s original identity document.`, exact: true }).check();
}

for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }]) {
  test(`real private registration and every-adult arrival at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
    const email = `guest-browser-${userId}@example.invalid`, password = `Guest-browser-${randomUUID()}`;
    await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Guest browser business','KES','Africa/Nairobi')", [tenantId]);
    await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Guest browser outlet','Africa/Nairobi')", [outletId, tenantId]);
    await pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'hospitality')", [tenantId]);
    await pool.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,'Guest Browser Operator')", [userId, email, await hashPassword(password)]);
    await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
    await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Guest browser assignment')", [deviceId, tenantId, outletId, userId]);
    const roomId = randomUUID();
    await pool.query("INSERT INTO hospitality.rooms(id,tenant_id,outlet_id,room_number,room_type,nightly_rate_minor,tax_rate_bps,currency,max_adults,max_children,max_occupants) VALUES($1,$2,$3,'101','Family',10000,0,'KES',2,1,3)", [roomId, tenantId, outletId]);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByLabel('Signed in as Guest Browser Operator')).toBeVisible();
    const me = await (await page.request.get('/api/v1/auth/me')).json();
    const policy = await (await page.request.get('/api/v1/hospitality/registration-policy')).json();
    const approved = await page.request.post('/api/v1/commands', { headers: { origin: new URL(page.url()).origin, 'x-csrf-token': me.csrfToken },
      data: { protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'hotel.registration.policy.update', occurredAt: new Date().toISOString(), expectedVersions: { 'guest-policy': policy.policy.version },
        payload: { reviewed: true, acceptedDocumentTypes: ['NATIONAL_ID', 'PASSPORT'], requireNationality: false, requireResidence: false, requirePassportExpiry: false, draftRetentionDays: 2, identityRetentionDays: 30, privacyNotice: 'Disposable guest registration acceptance notice.' } } });
    expect((await approved.json()).status).toBe('CONFIRMED');
    if (viewport.width < 768) {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.locator('.mobile-more-panel').getByRole('button', { name: 'Hotel Limited', exact: true }).click();
    } else await page.getByRole('button', { name: 'Hotel, Limited', exact: true }).click();
    const tasks = page.getByRole('navigation', { name: 'Hotel tasks' });
    await tasks.getByRole('button', { name: 'Reservations', exact: true }).click();
    await page.getByRole('button', { name: 'New reservation', exact: true }).click();
    const booking = page.getByRole('dialog', { name: 'New room reservation', exact: true });
    await booking.getByLabel('Adults', { exact: true }).fill('2');
    await booking.getByLabel('Children', { exact: true }).fill('1');
    await booking.getByLabel('Primary guest full name', { exact: true }).fill('Primary Browser Guest');
    await booking.getByLabel('Adult 2 full name', { exact: true }).fill('Additional Browser Guest');
    await booking.getByLabel('Child 1 full name', { exact: true }).fill('Child Browser Guest');
    await booking.getByLabel('Booking contact phone', { exact: true }).fill('+254711222333');
    await booking.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
    await expect(booking).not.toBeVisible();
    const reserved = page.locator('article').filter({ hasText: 'Primary Browser Guest' });
    await expect(reserved).toBeVisible();
    const state = (await pool.query('SELECT r.status,g.adult_count,g.child_count FROM hospitality.rooms r JOIN hospitality.reservations b ON b.room_id=r.id JOIN hospitality.guest_registrations g ON g.id=b.guest_registration_id WHERE r.id=$1', [roomId])).rows[0];
    expect(state).toEqual({ status: 'READY', adult_count: 2, child_count: 1 });
    await reserved.getByRole('button', { name: 'Check in', exact: true }).click();
    const arrival = page.getByRole('dialog', { name: 'Guest check-in · Room 101', exact: true });
    await expect(arrival.getByLabel('Adult 2 full name', { exact: true })).toHaveValue('Additional Browser Guest');
    await identity(arrival, 1, '0009001122');
    await arrival.getByRole('button', { name: 'Complete check-in', exact: true }).click();
    await expect(arrival.getByRole('alert')).toContainText('Adult 2');
    expect((await pool.query('SELECT count(*)::int n FROM hospitality.stays WHERE tenant_id=$1', [tenantId])).rows[0].n).toBe(0);
    await identity(arrival, 2, '0009003344');
    await page.screenshot({ path: testInfo.outputPath(`guest-registration-${viewport.width}.png`), fullPage: true });
    await arrival.getByRole('button', { name: 'Complete check-in', exact: true }).click();
    await expect(arrival).not.toBeVisible();
    const result = (await pool.query("SELECT r.status,(SELECT count(*)::int FROM hospitality.stays s WHERE s.tenant_id=r.tenant_id) stays,(SELECT count(*)::int FROM hospitality.folios f WHERE f.tenant_id=r.tenant_id) folios,(SELECT count(*)::int FROM hospitality.guest_registration_occupants o JOIN hospitality.guest_registrations g ON g.id=o.registration_id WHERE o.tenant_id=r.tenant_id AND g.status='FINAL' AND o.kind='ADULT' AND o.verified_at IS NOT NULL) verified_adults FROM hospitality.rooms r WHERE r.id=$1", [roomId])).rows[0];
    expect(result).toEqual({ status: 'OCCUPIED', stays: 1, folios: 1, verified_adults: 2 });
    const local = await page.evaluate(async () => {
      const result: unknown[] = [Object.entries(localStorage), Object.entries(sessionStorage)];
      for (const descriptor of await indexedDB.databases()) {
        if (!descriptor.name?.startsWith('mazao')) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(descriptor.name!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        for (const name of Array.from(db.objectStoreNames)) result.push(await new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }));
        db.close();
      }
      return JSON.stringify(result);
    });
    expect(local).not.toContain('0009001122');
    expect(local).not.toContain('0009003344');
    expect((await pool.query('SELECT count(*)::int n FROM finance.journal_entries WHERE tenant_id=$1', [tenantId])).rows[0].n).toBe(0);
  });
}
