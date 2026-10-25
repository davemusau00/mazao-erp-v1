import assert from 'node:assert/strict';
import { test } from 'node:test';

// This suite calls the pure snapshot validator only. The lazy PostgreSQL pool
// is never connected; a placeholder permits importing the domain module.
process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:1/unused_csv_validation';
const { validateProductCsv, canonicalProductImportReport, productImportReportRequiredCapabilities } = await import('../src/productImport.js');
const { pool } = await import('../src/db.js');
test.after(async () => { await pool.end(); });
const configuration = { businessVersion: 1, currency: 'KES', taxRateBps: 1600 };
const encode = (cells: string[][]) => cells.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
const headers = ['SKU', 'Name', 'Unit', 'Price', 'Cost', 'Barcode'];
const mapping = { sku: 'SKU', name: 'Name', baseUnit: 'Unit', sellingPrice: 'Price', costPrice: 'Cost', barcode: 'Barcode' };

test('CSV validation preserves identifier zeros and uses explicit tenant currency and tax defaults', () => {
  const source = encode([headers, ['000001', 'Maziwa 🥛', 'each', '12.34', '2.00', '000012340001']]);
  const report = validateProductCsv(source, mapping, 'CREATE_ONLY', configuration, []);
  assert.deepEqual(report.errors, []);
  assert.equal(report.rows[0].normalized?.sku, '000001');
  assert.equal(report.rows[0].normalized?.barcode, '000012340001');
  assert.equal(report.rows[0].normalized?.sellingPriceMinor, 1234);
  assert.equal(report.rows[0].normalized?.taxRateBps, 1600);
  assert.equal(report.rows[0].normalized?.currency, 'KES');
  assert.deepEqual(report.rows[0].defaults, { currency: 'TENANT_DEFAULT', tax: 'BUSINESS_DEFAULT' });
});

test('CSV validation refuses every ambiguous scientific identifier shape', () => {
  for (const value of ['1.234E+11', '.123e4', '1.e4', '1E-2']) {
    const barcodeReport = validateProductCsv(encode([headers, ['IDENTIFIER', 'Item', 'each', '12.34', '2.00', value]]), mapping, 'CREATE_ONLY', configuration, []);
    assert.ok(barcodeReport.errors.some(error => error.code === 'BARCODE_INVALID'), `Barcode ${value} was accepted`);
    const skuReport = validateProductCsv(encode([headers, [value, 'Item', 'each', '12.34', '2.00', '']]), mapping, 'CREATE_ONLY', configuration, []);
    assert.ok(skuReport.errors.some(error => error.code === 'SKU_INVALID'), `SKU ${value} was accepted`);
  }
});

test('CSV validation detects case-folded SKU and exact barcode collisions across all rows', () => {
  const report = validateProductCsv(encode([headers, ['SKU-A', 'First', 'each', '12.34', '2.00', '00001'], [' sku-a ', 'Second', 'each', '12.34', '2.00', '00001']]), mapping, 'CREATE_ONLY', configuration, []);
  assert.equal(report.rows.length, 2);
  assert.ok(report.rows.every(row => row.action === 'INVALID'));
  assert.equal(report.errors.filter(error => error.code === 'DUPLICATE_SKU').length, 2);
  assert.equal(report.errors.filter(error => error.code === 'DUPLICATE_BARCODE').length, 2);
});

test('CSV mapping cannot silently reuse source columns, select missing headers or invent authority fields', () => {
  const source = encode([headers, ['SKU', 'Item', 'each', '12.34', '2.00', '']]);
  for (const [changes, code] of [[{ name: 'SKU' }, 'MAPPING_DUPLICATE'], [{ sellingPrice: 'price' }, 'MAPPING_HEADER'], [{ tenantId: 'SKU' }, 'MAPPING_FIELD']] as const) {
    const report = validateProductCsv(source, { ...mapping, ...changes }, 'CREATE_ONLY', configuration, []);
    assert.ok(report.errors.some(error => error.code === code));
    assert.equal(report.rows.length, 0, 'invalid mappings cannot create misleading row predictions');
  }
});

test('CSV validation exposes ignored package semantics and never infers conversion or opening value', () => {
  const extended = [...headers, 'caseSize'];
  const report = validateProductCsv(encode([extended, ['SKU', 'Can', 'each', '12.34', '2.00', '', '24']]), mapping, 'CREATE_ONLY', configuration, []);
  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.some(warning => warning.code === 'UNSUPPORTED_PACKAGE_COLUMN'));
  assert.equal(report.rows[0].normalized?.openingQuantity, '0');
  assert.equal(report.rows[0].normalized?.openingValueMinor, '0');
});

test('CSV upsert predictions retain omitted prices, currency, tax, barcode and unit without mutating source snapshots', () => {
  const existing = { id: '4b830872-30f9-4f15-a759-dcfb723bc99b', sku: 'Existing-SKU', name: 'Original item', base_unit: 'kg', currency: 'KES', selling_price_minor: '1234', cost_price_minor: '275', tax_rate_bps: 800, barcode: '000012340001', category: 'Pantry', reorder_level: '0.250000', version: '7', active: true };
  const before = structuredClone(existing);
  const report = validateProductCsv('SKU,Name\nexisting-sku,Updated item', { sku: 'SKU', name: 'Name' }, 'UPSERT', configuration, [existing]);
  assert.deepEqual(report.errors, []);
  assert.equal(report.rows[0].action, 'UPDATE');
  assert.equal(report.rows[0].expectedProductVersion, 7);
  assert.equal(report.rows[0].normalized?.sku, existing.sku);
  assert.equal(report.rows[0].normalized?.baseUnit, 'kg');
  assert.equal(report.rows[0].normalized?.currency, 'KES');
  assert.equal(report.rows[0].normalized?.sellingPriceMinor, 1234);
  assert.equal(report.rows[0].normalized?.costPriceMinor, 275);
  assert.equal(report.rows[0].normalized?.taxRateBps, 800);
  assert.equal(report.rows[0].normalized?.barcode, existing.barcode);
  assert.deepEqual(existing, before, 'the validator cannot mutate its catalog snapshot');
  assert.ok(report.rows[0].changes.every(change => change.field === 'name'));
});

test('CSV upsert refuses archived and ambiguous legacy SKU identities', () => {
  const existing = { id: '4b830872-30f9-4f15-a759-dcfb723bc99b', sku: 'Existing-SKU', name: 'Original item', base_unit: 'kg', currency: 'KES', selling_price_minor: '1234', cost_price_minor: '275', tax_rate_bps: 800, barcode: null, category: '', reorder_level: '0', version: '1', active: true };
  const source = 'SKU,Name\nexisting-sku,Updated item';
  const archived = validateProductCsv(source, { sku: 'SKU', name: 'Name' }, 'UPSERT', configuration, [{ ...existing, active: false }]);
  assert.ok(archived.errors.some(error => error.code === 'ITEM_ARCHIVED'));
  const ambiguous = validateProductCsv(source, { sku: 'SKU', name: 'Name' }, 'UPSERT', configuration, [existing, { ...existing, id: '16239116-dc31-4c43-9fb6-1a6109b4a908', sku: 'EXISTING-sku' }]);
  assert.ok(ambiguous.errors.some(error => error.code === 'SKU_AMBIGUOUS'));
});

test('service and prepared CSV rows carry explicit kind without stock costs or reference-cost warnings',()=>{
  const typedHeaders=['SKU','Name','Unit','Kind','Price','Cost','Opening','Opening cost'];
  const typedMapping={sku:'SKU',name:'Name',baseUnit:'Unit',itemKind:'Kind',sellingPrice:'Price',costPrice:'Cost',openingQuantity:'Opening',openingUnitCost:'Opening cost'};
  for(const kind of ['SERVICE','PREPARED']){
    const report=validateProductCsv(encode([typedHeaders,['KIND-1','Consultation','hour',kind,'2500','0','0','']]),typedMapping,'CREATE_ONLY',configuration,[]);
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);
    assert.equal(report.rows[0].normalized?.itemKind,kind);
    assert.equal(report.rows[0].normalized?.openingQuantity,'0');
    assert.equal(report.rows[0].normalized?.openingUnitCostMinor,null);
    assert.deepEqual(productImportReportRequiredCapabilities(report),['commerce']);
    for(const [opening,cost] of [['1',''],['0','0'],['0','2.50']]){
      const invalid=validateProductCsv(encode([typedHeaders,['KIND-1','Consultation','hour',kind,'2500','0',opening,cost]]),typedMapping,'CREATE_ONLY',configuration,[]);
      assert.ok(invalid.errors.some(error=>error.code==='NON_STOCK_OPENING_INVENTORY'),`${kind}: opening=${opening},cost=${cost}`);
      assert.equal(invalid.rows[0].action,'INVALID');
    }
  }
  const legacy=validateProductCsv(encode([headers,['DEFAULT-1','Stocked item','each','5','0','']]),mapping,'CREATE_ONLY',configuration,[]);
  assert.equal(legacy.rows[0].normalized?.itemKind,'STOCKED_GOOD');
  assert.ok(legacy.warnings.some(warning=>warning.code==='ZERO_REFERENCE_COST'));
  assert.deepEqual(productImportReportRequiredCapabilities(legacy),['inventory']);
});

test('CSV upsert preserves its current kind and refuses explicit stock-tracking changes',()=>{
  const existing={id:'4b830872-30f9-4f15-a759-dcfb723bc99b',sku:'SERVICE-1',name:'Original consultation',base_unit:'hour',item_kind:'SERVICE' as const,currency:'KES',selling_price_minor:'1234',cost_price_minor:'0',tax_rate_bps:0,barcode:null,category:'',reorder_level:'0',version:'7',active:true};
  const preserved=validateProductCsv('SKU,Name\nservice-1,Reviewed consultation',{sku:'SKU',name:'Name'},'UPSERT',configuration,[existing]);
  assert.deepEqual(preserved.errors,[]);assert.equal(preserved.rows[0].normalized?.itemKind,'SERVICE');
  assert.deepEqual(preserved.rows[0].changes.map(change=>change.field),['name']);
  for(const itemKind of ['STOCKED_GOOD','PREPARED']){
    const changed=validateProductCsv(`SKU,Kind\nservice-1,${itemKind}`,{sku:'SKU',itemKind:'Kind'},'UPSERT',configuration,[existing]);
    assert.ok(changed.errors.some(error=>error.code==='ITEM_KIND_CHANGE_REQUIRES_REVIEW'));
    assert.equal(changed.rows[0].action,'INVALID');
  }
  const same=validateProductCsv('SKU,Kind\nservice-1,SERVICE',{sku:'SKU',itemKind:'Kind'},'UPSERT',configuration,[existing]);
  assert.deepEqual(same.errors,[]);assert.equal(same.rows[0].action,'UNCHANGED');
  for(const itemKind of ['','service','DIGITAL']){
    const invalid=validateProductCsv(`SKU,Kind\nservice-1,${itemKind}`,{sku:'SKU',itemKind:'Kind'},'UPSERT',configuration,[existing]);
    assert.ok(invalid.errors.some(error=>error.code==='ITEM_KIND_INVALID'));
  }
});

test('legacy stored reports compare with stocked defaults without changing historical bytes or downgrading authority',()=>{
  const current=validateProductCsv(encode([headers,['LEGACY-1','Legacy item','each','5','2','']]),mapping,'CREATE_ONLY',configuration,[]);
  const legacy=structuredClone(current);delete legacy.rows[0].normalized!.itemKind;
  const before=JSON.stringify(legacy);
  assert.deepEqual(canonicalProductImportReport(legacy),canonicalProductImportReport(current));
  assert.equal(JSON.stringify(legacy),before,'comparison leaves the original stored report and hash source untouched');
  const changed=structuredClone(current);changed.rows[0].normalized!.itemKind='SERVICE';
  assert.notDeepEqual(canonicalProductImportReport(legacy),canonicalProductImportReport(changed));
  legacy.rows[0].productId='reviewed-product';
  assert.deepEqual(productImportReportRequiredCapabilities(legacy,[{id:'reviewed-product',item_kind:'SERVICE'},{id:'unrelated-product',item_kind:'STOCKED_GOOD'}]),['commerce','inventory']);
  assert.deepEqual(productImportReportRequiredCapabilities(changed,[{id:'unrelated-product',item_kind:'STOCKED_GOOD'}]),['commerce']);
});
