import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { pool } from '../src/db.js';
import { hashPassword } from '../src/security.js';

const confirmation = 'SEED_DISPOSABLE_PERFORMANCE_DATABASE';
const databaseUrl = process.env.DATABASE_URL;
if (process.env.MAZAO_PERF_CONFIRM !== confirmation) throw new Error(`Set MAZAO_PERF_CONFIRM=${confirmation} to seed a performance fixture.`);
if (!databaseUrl) throw new Error('DATABASE_URL must point to a disposable local performance database.');
const database = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) || !/^\/mazao_perf_/.test(database.pathname)) {
  throw new Error('Performance fixtures may only be seeded into a mazao_perf_* database on localhost.');
}

const counts = { products: 5000, orders: 5000, staff: 500, customers: 5000, movements: 40000, rooms: 300, reservations: 1200 };
const tenantId = uuid('tenant');
const outletId = uuid('outlet');
const operatorId = uuid('operator');
const deviceId = uuid('device');
const shiftId = uuid('open-shift');
const countId = uuid('open-count');
const receiptLogo = maximumPng(65);
const receiptQr = maximumPng(66);
const logoAssetId = uuid('asset:logo');
const qrAssetId = uuid('asset:receipt_qr');

function uuid(value: string) {
  const digest = createHash('md5').update(`mazao-performance:${value}`).digest('hex');
  const hex = `${digest.slice(0, 12)}4${digest.slice(13, 16)}${'89ab'[Number.parseInt(digest[16], 16) & 3]}${digest.slice(17)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function crc32(value: Buffer) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); typeBytes.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function maximumPng(marker: number) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const header = pngChunk('IHDR', ihdr);
  const data = pngChunk('IDAT', deflateSync(Buffer.from([0, 20, 40, 60, 255])));
  const end = pngChunk('IEND', Buffer.alloc(0));
  const metadataLength = 512 * 1024 - signature.length - header.length - data.length - end.length - 12;
  const label = Buffer.from('Description\0', 'ascii');
  const metadata = Buffer.concat([label, Buffer.alloc(metadataLength - label.length, marker)]);
  const content = Buffer.concat([signature, header, data, pngChunk('tEXt', metadata), end]);
  if (content.length !== 512 * 1024) throw new Error('Performance PNG fixture must be exactly 512 KiB.');
  return content;
}

const snapshotLogo = `data:image/png;base64,${receiptLogo.toString('base64')}`;
const snapshotQr = `data:image/png;base64,${receiptQr.toString('base64')}`;
const profile = {
  legalName: 'Performance Fixture Hospitality Limited', registrationNumber: 'PERF-2026-001', taxRegistrationNumber: 'P051234567X',
  address: 'Westlands, Nairobi, Kenya', phone: '+254700000001', email: 'accounts@mazao-perf.invalid', website: 'https://mazao-perf.invalid',
  logoUrl: `/api/v1/configuration/assets/${logoAssetId}`, receiptQrImage: `/api/v1/configuration/assets/${qrAssetId}`, showQrOnReceipt: true,
  receiptHeader: 'Thank you for your business', receiptFooter: 'Performance fixture',
  taxPolicy: { calculation: 'exclusive', defaultRateBps: 0, label: 'VAT', reviewed: true },
};

const existing = await pool.query<{ count: string }>('SELECT count(*)::text count FROM core.tenants');
if (existing.rows[0]?.count !== '0') throw new Error('Refusing to seed a non-empty performance database. Recreate the disposable mazao_perf_* database first.');

const client = await pool.connect();
try {
  await client.query(`CREATE FUNCTION pg_temp.performance_uuid(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $function$
    SELECT substr(hash,1,8)||'-'||substr(hash,9,4)||'-4'||substr(hash,14,3)||'-'||
      substr('89ab',((strpos('0123456789abcdef',substr(hash,17,1))-1)&3)+1,1)||substr(hash,18,3)||'-'||substr(hash,21,12)
    FROM (SELECT pg_catalog.md5(value) hash) source
  $function$`);
  await client.query('BEGIN');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  await client.query('INSERT INTO core.tenants(id,name,currency,time_zone,business_profile) VALUES($1,$2,\'KES\',\'Africa/Nairobi\',$3::jsonb)', [tenantId, 'Mazao Production-Shaped Performance Fixture', JSON.stringify(profile)]);
  await client.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone,outlet_profile) VALUES($1,$2,$3,\'Africa/Nairobi\',$4::jsonb)', [outletId, tenantId, 'Performance Fixture Main Outlet', JSON.stringify({ address: 'Westlands, Nairobi', phone: '+254700000001', email: 'outlet@mazao-perf.invalid' })]);
  await client.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory'),($1,'hospitality'),($1,'retail')", [tenantId]);

  const passwordHash = await hashPassword('PerfPass-2026!');
  await client.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [operatorId, 'performance-operator@mazao-perf.invalid', passwordHash, 'Performance Operator']);
  await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, operatorId]);
  await client.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, operatorId, 'Performance Fixture Till']);
  await client.query(`INSERT INTO identity.users(id,email,password_hash,full_name)
    SELECT pg_temp.performance_uuid('mazao-performance:staff:'||n)::uuid,'performance-staff-'||n||'@mazao-perf.invalid',NULL,'Staff Operator '||lpad(n::text,4,'0')
    FROM generate_series(1,$1::int) n`, [counts.staff]);
  await client.query(`INSERT INTO identity.memberships(tenant_id,user_id,role,display_name)
    SELECT $1,pg_temp.performance_uuid('mazao-performance:staff:'||n)::uuid,'cashier','Staff Operator '||lpad(n::text,4,'0') FROM generate_series(1,$2::int) n`, [tenantId, counts.staff]);
  await client.query(`INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label)
    SELECT pg_temp.performance_uuid('mazao-performance:device:staff:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:staff:'||n)::uuid,'Till '||lpad(n::text,4,'0') FROM generate_series(1,$3::int) n`, [tenantId, outletId, counts.staff]);

  await client.query(`INSERT INTO core.configuration_assets(id,tenant_id,kind,draft_id,uploaded_by,content,sha256,byte_length,status,activated_at)
    VALUES($1,$2,'logo',$3,$4,$5,$6,$7,'ACTIVE',now()),($8,$2,'receipt_qr',$9,$4,$10,$11,$12,'ACTIVE',now())`, [
    logoAssetId, tenantId, uuid('asset:draft:logo'), operatorId, receiptLogo, createHash('sha256').update(receiptLogo).digest(), receiptLogo.length,
    qrAssetId, uuid('asset:draft:receipt_qr'), receiptQr, createHash('sha256').update(receiptQr).digest(), receiptQr.length,
  ]);

  await client.query(`INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps)
    SELECT pg_temp.performance_uuid('mazao-performance:product:'||n)::uuid,$1,$2,'PERF-'||lpad(n::text,6,'0'),'Fixture Product '||lpad(n::text,5,'0'),'each','KES',25000,10000,0
    FROM generate_series(1,$3::int) n`, [tenantId, outletId, counts.products]);
  await client.query(`INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,version,inventory_value_minor)
    SELECT $1,$2,pg_temp.performance_uuid('mazao-performance:product:'||n)::uuid,8,31,80000 FROM generate_series(1,$3::int) n`, [tenantId, outletId, counts.products]);

  const openSalesMinor = 225000000n;
  await client.query(`INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,cash_sales_minor,expected_cash_minor)
    VALUES($1,$2,$3,$4,'OPEN',10000,$5::bigint,$5::bigint+10000)`, [shiftId, tenantId, outletId, operatorId, openSalesMinor.toString()]);
  await client.query(`INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,cash_sales_minor,expected_cash_minor,counted_cash_minor,variance_minor,version,opened_at,closed_at)
    SELECT pg_temp.performance_uuid('mazao-performance:closed-shift:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:staff:'||n)::uuid,'CLOSED',0,0,0,0,0,2,now()-(n||' hours')::interval-interval '8 hours',now()-(n||' hours')::interval
    FROM generate_series(1,$3::int) n`, [tenantId, outletId, counts.staff]);
  await client.query(`INSERT INTO commerce.shift_close_reports(id,tenant_id,outlet_id,shift_id,command_id,operator_id,tenant_name_snapshot,outlet_name_snapshot,operator_name_snapshot,time_zone_snapshot,business_date,currency,shift_version,opened_at,closed_at,opening_float_minor,cash_sales_minor,customer_collections_minor,cash_refunds_minor,cash_paid_in_minor,cash_payout_minor,expected_cash_minor,counted_cash_minor,variance_minor)
    SELECT pg_temp.performance_uuid('mazao-performance:close-report:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:closed-shift:'||n)::uuid,pg_temp.performance_uuid('mazao-performance:close-command:'||n)::uuid,pg_temp.performance_uuid('mazao-performance:staff:'||n)::uuid,'Mazao Production-Shaped Performance Fixture','Performance Fixture Main Outlet','Staff Operator '||lpad(n::text,4,'0'),'Africa/Nairobi',current_date,'KES',2,now()-(n||' hours')::interval-interval '8 hours',now()-(n||' hours')::interval,0,0,0,0,0,0,0,0,0
    FROM generate_series(1,$3::int) n`, [tenantId, outletId, counts.staff]);

  await client.query(`INSERT INTO finance.customer_accounts(id,tenant_id,display_name,phone,email,credit_limit_minor,balance_minor)
    SELECT pg_temp.performance_uuid('mazao-performance:customer:'||n)::uuid,$1,'Account '||lpad(n::text,5,'0'),'0700'||lpad(n::text,6,'0'),'customer-'||n||'@mazao-perf.invalid',100000,CASE WHEN n<=500 THEN 50000 ELSE 0 END
    FROM generate_series(1,$2::int) n`, [tenantId, counts.customers]);

  await client.query(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,created_at,receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot,cash_tendered_minor,change_minor,customer_account_id,customer_name_snapshot,customer_amount_due_minor,receipt_profile_snapshot,operator_name_snapshot)
    SELECT pg_temp.performance_uuid('mazao-performance:order:'||n)::uuid,$1,$2,$3,$4,'KES',50000,0,50000,'CONFIRMED',now()-((5001-n)||' hours')::interval,'PERF-'||lpad(n::text,6,'0'),'Mazao Production-Shaped Performance Fixture','Performance Fixture Main Outlet','Africa/Nairobi',CASE WHEN n>500 THEN 50000 ELSE NULL END,CASE WHEN n>500 THEN 0 ELSE NULL END,CASE WHEN n<=500 THEN pg_temp.performance_uuid('mazao-performance:customer:'||n)::uuid ELSE NULL END,CASE WHEN n<=500 THEN 'Account '||lpad(n::text,5,'0') ELSE NULL END,CASE WHEN n<=500 THEN 50000 ELSE 0 END,
      CASE WHEN n=1 THEN jsonb_build_object('legalName','Historical Performance Fixture','logoUrl',$5::text,'receiptQrImage',$6::text,'showQrOnReceipt',true,'receiptFooter','Historical receipt snapshot','taxLabel','VAT') ELSE '{}'::jsonb END,'Performance Operator'
    FROM generate_series(1,$7::int) n`, [tenantId, outletId, shiftId, operatorId, snapshotLogo, snapshotQr, counts.orders]);
  await client.query(`INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor,cogs_minor)
    SELECT pg_temp.performance_uuid('mazao-performance:order-line:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:order:'||((n+1)/2))::uuid,pg_temp.performance_uuid('mazao-performance:product:'||(((n-1)%$3::int)+1))::uuid,'PERF-LINE-'||n,'Fixture Product '||lpad((((n-1)%$3::int)+1)::text,5,'0'),1,25000,10000,0,25000,0,10000
    FROM generate_series(1,$4::int) n`, [tenantId, outletId, counts.products, counts.orders * 2]);
  await client.query(`INSERT INTO commerce.payments(id,tenant_id,outlet_id,order_id,method,amount_minor,currency,status,created_at)
    SELECT pg_temp.performance_uuid('mazao-performance:payment:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:order:'||n)::uuid,'CASH',50000,'KES','CONFIRMED',now()-((5001-n)||' hours')::interval
    FROM generate_series(501,$3::int) n`, [tenantId, outletId, counts.orders]);
  await client.query(`INSERT INTO finance.customer_charges(id,tenant_id,outlet_id,customer_account_id,order_id,amount_minor,currency,created_at)
    SELECT pg_temp.performance_uuid('mazao-performance:charge:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:customer:'||n)::uuid,pg_temp.performance_uuid('mazao-performance:order:'||n)::uuid,50000,'KES',now()-((5001-n)||' hours')::interval
    FROM generate_series(1,500) n`, [tenantId, outletId]);

  await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,document_reference,created_at)
    SELECT pg_temp.performance_uuid('mazao-performance:movement:opening:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:product:'||n)::uuid,pg_temp.performance_uuid('mazao-performance:command:opening:'||n)::uuid,'OPENING',5,10000,50000,'Opening balance',now()-interval '2 years'
    FROM generate_series(1,$3::int) n`, [tenantId, outletId, counts.products]);
  await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,document_reference,created_at)
    SELECT pg_temp.performance_uuid('mazao-performance:movement:receipt:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:product:'||(((n-1)%$3::int)+1))::uuid,pg_temp.performance_uuid('mazao-performance:command:receipt:'||n)::uuid,'RECEIPT',1,10000,10000,'Performance delivery '||n,now()-((n%700)||' days')::interval
    FROM generate_series(1,$4::int) n`, [tenantId, outletId, counts.products, counts.products * 5]);
  await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id,document_reference,created_at)
    SELECT pg_temp.performance_uuid('mazao-performance:movement:sale:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:product:'||(((n-1)%$3::int)+1))::uuid,pg_temp.performance_uuid('mazao-performance:command:sale:'||((n+1)/2))::uuid,'SALE',-1,10000,10000,pg_temp.performance_uuid('mazao-performance:order:'||((n+1)/2))::uuid,'Performance sale',now()-((5001-((n+1)/2))||' hours')::interval
    FROM generate_series(1,$4::int) n`, [tenantId, outletId, counts.products, counts.orders * 2]);

  await client.query(`INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,posted_at,created_by)
    SELECT pg_temp.performance_uuid('mazao-performance:journal:'||n)::uuid,$1,'PERFORMANCE_SALE',pg_temp.performance_uuid('mazao-performance:order:'||n)::uuid,'KES',now()-((5001-n)||' hours')::interval,$2
    FROM generate_series(1,$3::int) n`, [tenantId, operatorId, counts.orders]);
  await client.query(`INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor)
    SELECT pg_temp.performance_uuid('mazao-performance:journal-line:'||n||':1')::uuid,$1::uuid,pg_temp.performance_uuid('mazao-performance:journal:'||n)::uuid,CASE WHEN n<=500 THEN 'ACCOUNTS_RECEIVABLE' ELSE 'CASH_TILL' END,50000,0 FROM generate_series(1,$2::int) n
    UNION ALL SELECT pg_temp.performance_uuid('mazao-performance:journal-line:'||n||':2')::uuid,$1::uuid,pg_temp.performance_uuid('mazao-performance:journal:'||n)::uuid,'SALES_REVENUE',0,50000 FROM generate_series(1,$2::int) n
    UNION ALL SELECT pg_temp.performance_uuid('mazao-performance:journal-line:'||n||':3')::uuid,$1::uuid,pg_temp.performance_uuid('mazao-performance:journal:'||n)::uuid,'COST_OF_GOODS_SOLD',20000,0 FROM generate_series(1,$2::int) n
    UNION ALL SELECT pg_temp.performance_uuid('mazao-performance:journal-line:'||n||':4')::uuid,$1::uuid,pg_temp.performance_uuid('mazao-performance:journal:'||n)::uuid,'INVENTORY',0,20000 FROM generate_series(1,$2::int) n`, [tenantId, counts.orders]);

  await client.query(`INSERT INTO inventory.stock_counts(id,tenant_id,outlet_id,status,area_label,opened_by,opened_at)
    VALUES($1,$2,$3,'OPEN','Full performance fixture outlet',$4,now())`, [countId, tenantId, outletId, operatorId]);
  await client.query(`INSERT INTO inventory.stock_count_lines(tenant_id,outlet_id,count_id,product_id,sku_snapshot,name_snapshot,base_unit_snapshot,baseline_quantity,baseline_balance_version,baseline_unit_cost_minor,baseline_inventory_value_minor)
    SELECT $1,$2,$3,p.id,p.sku,p.name,p.base_unit,b.quantity,b.version,p.cost_price_minor,b.inventory_value_minor
    FROM catalog.products p JOIN inventory.balances b ON b.tenant_id=p.tenant_id AND b.outlet_id=p.outlet_id AND b.product_id=p.id
    WHERE p.tenant_id=$1 AND p.outlet_id=$2`, [tenantId, outletId, countId]);

  await client.query(`INSERT INTO hospitality.rooms(id,tenant_id,outlet_id,room_number,room_type,nightly_rate_minor,tax_rate_bps,currency,status)
    SELECT pg_temp.performance_uuid('mazao-performance:room:'||n)::uuid,$1,$2,'R-'||lpad(n::text,4,'0'),CASE WHEN n%3=0 THEN 'Deluxe' WHEN n%3=1 THEN 'Standard' ELSE 'Family' END,120000,1600,'KES',CASE WHEN n<=50 THEN 'OCCUPIED' ELSE 'READY' END
    FROM generate_series(1,$3::int) n`, [tenantId, outletId, counts.rooms]);
  await client.query(`INSERT INTO hospitality.reservations(id,tenant_id,outlet_id,room_id,guest_name,guest_contact,check_in_date,check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by)
    SELECT pg_temp.performance_uuid('mazao-performance:reservation:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:room:'||(((n-1)%$3::int)+1))::uuid,'Fixture Guest '||lpad(n::text,5,'0'),'+254700000002',date '2030-01-01'+(((n-1)/$3::int)*10),date '2030-01-03'+(((n-1)/$3::int)*10),120000,1600,'KES','CONFIRMED',$4
    FROM generate_series(1,$5::int) n`, [tenantId, outletId, counts.rooms, operatorId, counts.reservations]);
  await client.query(`INSERT INTO hospitality.stays(id,tenant_id,outlet_id,room_id,guest_name,guest_contact,check_in_date,expected_check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by)
    SELECT pg_temp.performance_uuid('mazao-performance:stay:'||n)::uuid,$1,$2,pg_temp.performance_uuid('mazao-performance:room:'||n)::uuid,'In-house Fixture Guest '||n,'+254700000003',current_date,current_date+2,120000,1600,'KES','CHECKED_IN',$3 FROM generate_series(1,50) n`, [tenantId, outletId, operatorId]);

  await client.query('COMMIT');
  await client.query('ANALYZE');
  process.stdout.write(JSON.stringify({ status: 'seeded', tenant: 'production-shaped disposable fixture', ...counts, pngAssetBytes: receiptLogo.length, embeddedHistoricalReceiptImageBytes: receiptLogo.length + receiptQr.length }) + '\n');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
