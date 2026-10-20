import { expect, test, type Page } from '@playwright/test';

const pageInfo = (totalCount: number, nextCursor: string | null) => ({ totalCount, nextCursor, hasMore: !!nextCursor, limit: 1, asOf: '2026-10-20T08:00:00.000Z' });
const customer = (index: number) => ({ id: `customer-${index}`, name: index === 501 ? 'Oldest Customer 501' : 'Recent Customer 1', phone: '0712000000', email: null, creditLimitMinor: '100000', balanceMinor: '0', status: 'ACTIVE', version: 1, createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z' });
const reservation = (index: number) => ({ id: `reservation-${index}`, roomId: 'room-1', roomNumber: '101', guestName: index === 251 ? 'Oldest Guest 251' : 'Recent Guest 1', guestContact: null, checkInDate: '2030-01-01', checkOutDate: '2030-01-02', nightlyRateMinor: 1000, taxRateBps: 0, currency: 'KES', status: 'CONFIRMED', version: 1 });

async function fixture(page: Page, calls: string[]) {
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: { user: { id: 'directory-user', name: 'Directory owner', email: 'owner@example.invalid', role: 'owner', permissions: ['customers.view','customers.manage','customers.charge','commerce.sell','hotel.frontdesk','hotel.manage'] }, tenant: { id: 'directory-tenant', name: 'Directory business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['commerce','inventory','hospitality'] }, outlet: { id: 'directory-outlet', name: 'Main outlet', timeZone: 'Africa/Nairobi' }, deviceId: 'directory-device', csrfToken: 'directory-csrf' } });
    if (path === '/customers') {
      calls.push(path + url.search); const searched = url.searchParams.has('q'), older = url.searchParams.has('after');
      return route.fulfill({ json: { customers: [customer(searched || older ? 501 : 1)], page: pageInfo(searched ? 1 : 501, searched || older ? null : 'older-customers'), summary: { accountCount: 501, totalBalanceMinor: '900000', totalCreditLimitMinor: '50100000', debtors: 9, suspended: 0 } } });
    }
    if (/^\/customers\/[^/]+\/statement$/.test(path)) return route.fulfill({ json: { customer: customer(path.includes('501') ? 501 : 1), currency: 'KES', generatedAt: '2026-10-20T08:00:00Z', entries: [] } });
    if (path === '/catalog/items') return route.fulfill({ json: { items: [{ id:'tea',sku:'TEA',name:'Tea',unit:'each',currency:'KES',sellingPriceMinor:100,taxRateBps:0,quantity:'10',version:1,productVersion:1 }] } });
    if (path === '/configuration/stock-sale-policy') return route.fulfill({ json: { policy: { enabled:false,requirePhysicalConfirmation:true,requireReason:true,allowZeroReferenceCost:true,version:1 } } });
    if (path === '/shifts/current') return route.fulfill({ json: { shift: { id:'shift-1',status:'OPEN',openingFloatMinor:0,cashSalesMinor:0,customerCollectionsMinor:0,cashRefundsMinor:0,cashPaidInMinor:0,cashPayoutMinor:0,expectedCashMinor:0,version:1,openedAt:'2026-10-20T08:00:00Z',cashMovements:[] } } });
    if (path === '/hospitality/rooms') return route.fulfill({ json: { rooms: [] } });
    if (path === '/hospitality/stays') return route.fulfill({ json: { stays: [] } });
    if (path === '/hospitality/reservations') {
      calls.push(path + url.search); const searched = url.searchParams.has('q'), older = url.searchParams.has('after');
      return route.fulfill({ json: { reservations: [reservation(searched || older ? 251 : 1)], page: pageInfo(searched ? 1 : 251, searched || older ? null : 'older-reservations') } });
    }
    return route.fulfill({ status:404,json:{error:{code:'NOT_FOUND',message:path}} });
  });
}

test('customer directory appends older accounts, searches the server and retains full portfolio totals', async ({ page }) => {
  const calls: string[] = []; await fixture(page, calls); await page.goto('/');
  await page.getByRole('button', { name:/^Customers/ }).click();
  await expect(page.getByText('501 Accounts',{exact:true})).toBeVisible();
  await expect(page.getByText(/^KES\s9,000$/)).toBeVisible();
  await page.getByRole('button',{name:'Load older records'}).click();
  await expect(page.getByRole('row',{name:/Recent Customer 1/})).toBeVisible();
  await expect(page.getByRole('row',{name:/Oldest Customer 501/})).toBeVisible();
  await page.getByLabel('Search customer accounts').fill('Oldest');
  await expect.poll(()=>calls.includes('/customers?q=Oldest')).toBe(true);
  await expect(page.getByRole('status').filter({hasText:'1 shown of 1 matching records'})).toBeVisible();
  await expect(page.getByRole('row',{name:/Recent Customer 1/})).toHaveCount(0);
  await expect(page.getByText(/^KES\s9,000$/)).toBeVisible();
});

test('POS can select a customer beyond the first page using a server search', async ({ page }) => {
  const calls: string[] = []; await fixture(page, calls); await page.goto('/');
  await page.getByRole('button',{name:/^Sell/}).click(); await page.getByRole('button',{name:/Tea/}).click();
  await page.getByRole('button',{name:'Take payment',exact:true}).click();
  const dialog=page.getByRole('dialog'); await dialog.getByRole('button',{name:'Customer account',exact:true}).click();
  await dialog.getByLabel('Find a customer').fill('Oldest');
  await expect.poll(()=>calls.includes('/customers?q=Oldest')).toBe(true);
  await dialog.getByRole('button',{name:/Oldest Customer 501/}).click();
  await expect(dialog.getByRole('button',{name:'Confirm payment',exact:true})).toBeEnabled();
});

test('reservation navigation appends older guests and searches the complete server list', async ({ page }) => {
  const calls: string[] = []; await fixture(page, calls); await page.goto('/');
  await page.getByRole('button',{name:/^Reservations/}).first().click();
  await page.getByRole('button',{name:'Load older records'}).click();
  await expect(page.getByRole('heading',{name:/Recent Guest 1/})).toBeVisible();
  await expect(page.getByRole('heading',{name:/Oldest Guest 251/})).toBeVisible();
  await page.getByLabel('Search reservations').fill('Oldest'); await page.getByRole('button',{name:'Search records'}).click();
  await expect.poll(()=>calls.includes('/hospitality/reservations?q=Oldest')).toBe(true);
  await expect(page.getByRole('heading',{name:/Recent Guest 1/})).toHaveCount(0);
  await expect(page.getByText('1 shown of 1 matching records',{exact:true})).toBeVisible();
});
