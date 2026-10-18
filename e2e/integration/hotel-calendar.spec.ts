import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

// Keep this spec's sign-ins separate from the shared integration API rate-limit bucket.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.7' } });

const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
test.afterAll(async () => { await pool.end(); });

for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }]) {
  test(`real hotel arrivals and early checkout honor calendar dates at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
    const email = `hotel-browser-${userId}@example.invalid`, password = `Disposable-hotel-${randomUUID()}`;
    await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Calendar browser business','KES','Africa/Nairobi')", [tenantId]);
    await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Calendar browser outlet','Africa/Nairobi')", [outletId, tenantId]);
    for (const capability of ['hospitality', 'commerce', 'inventory']) await pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)', [tenantId, capability]);
    await pool.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,'Calendar Browser Operator')", [userId, email, await hashPassword(password)]);
    await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
    await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Calendar browser assignment')", [deviceId, tenantId, outletId, userId]);
    for (const [label, offset] of [['Arrival Today', 0], ['Future Arrival', 1]] as const) {
      const roomId = randomUUID();
      await pool.query("INSERT INTO hospitality.rooms(id,tenant_id,outlet_id,room_number,room_type,nightly_rate_minor,tax_rate_bps,currency,version) VALUES($1,$2,$3,$4,'Standard',10000,0,'KES',2)", [roomId, tenantId, outletId, String(offset + 1)]);
      await pool.query(`INSERT INTO hospitality.reservations(id,tenant_id,outlet_id,room_id,guest_name,check_in_date,check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by)
        VALUES($1,$2,$3,$4,$5,(now() AT TIME ZONE 'Africa/Nairobi')::date+$6::int,(now() AT TIME ZONE 'Africa/Nairobi')::date+$6::int+1,10000,0,'KES','CONFIRMED',$7)`, [randomUUID(), tenantId, outletId, roomId, label, offset, userId]);
    }
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByLabel('Signed in as Calendar Browser Operator')).toBeVisible();
    if (viewport.width < 768) {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.locator('.mobile-more-panel').getByRole('button', { name: 'Hotel Partial', exact: true }).click();
    } else await page.getByRole('button', { name: 'Hotel, Partial', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rooms and guest stays' })).toBeVisible();
    const tasks = page.getByRole('navigation', { name: 'Hotel tasks' });
    await tasks.getByRole('button', { name: 'Reservations', exact: true }).click();
    const current = page.locator('article').filter({ hasText: 'Arrival Today' });
    const future = page.locator('article').filter({ hasText: 'Future Arrival' });
    await expect(current.getByRole('button', { name: 'Check in', exact: true })).toBeEnabled();
    await expect(future.getByRole('button', { name: 'Check in', exact: true })).toBeDisabled();
    await expect(current).not.toContainText('T00:00');
    await page.screenshot({ path: testInfo.outputPath(`arrivals-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await current.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Guest checked in' })).toBeVisible();
    await tasks.getByRole('button', { name: 'Checked-in guests', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review bill and check out', exact: true })).toBeDisabled();
    await expect(page.locator('article').filter({ hasText: 'Arrival Today' })).toContainText('1 booked nights');

    const me = await (await page.request.get('/api/v1/auth/me')).json();
    const active = await (await page.request.get('/api/v1/hospitality/stays')).json();
    const stay = active.stays[0];
    expect(stay.checkInDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stay.checkOutDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const commandId = randomUUID();
    const early = await page.request.post('/api/v1/commands', {
      headers: { origin: new URL(page.url()).origin, 'x-csrf-token': me.csrfToken },
      data: { protocolVersion: 1, commandId, tenantId, deviceId, type: 'hotel.checkout', occurredAt: new Date().toISOString(),
        expectedVersions: { [`stay:${stay.id}`]: stay.version, [`room:${stay.roomId}`]: stay.roomVersion },
        payload: { stayId: stay.id, tenderedMinor: 10000, currency: 'KES' } },
    });
    const outcome = await early.json();
    expect(outcome.status).toBe('REJECTED'); expect(outcome.details.bookedDepartureDate).toBe(stay.checkOutDate);
    expect((await pool.query('SELECT 1 FROM hospitality.folio_entries WHERE tenant_id=$1 AND command_id=$2', [tenantId, commandId])).rowCount).toBe(0);
    expect((await pool.query('SELECT status FROM hospitality.stays WHERE tenant_id=$1 AND id=$2', [tenantId, stay.id])).rows[0].status).toBe('CHECKED_IN');
    await page.screenshot({ path: testInfo.outputPath(`stay-${viewport.width}x${viewport.height}.png`), fullPage: true });
  });
}
