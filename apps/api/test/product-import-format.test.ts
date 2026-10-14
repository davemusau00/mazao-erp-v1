import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCsvHeaders, safeCsvCell } from '../../../src/utils/csv.js';

// Validation is pure; this URL only allows the module to construct its unused pool.
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@127.0.0.1:1/mazao_test';
const { validateProductCsv } = await import('../src/productImport.js');
const { pool } = await import('../src/db.js');
const mapping = { sku:'sku',name:'name',baseUnit:'unit',sellingPrice:'price',costPrice:'cost',taxRatePercent:'tax',openingQuantity:'qty',openingUnitCost:'openingCost' };
const source=(price:string,cost:string,qty='0',openingCost='',tax='16.00')=>`sku,name,unit,price,cost,tax,qty,openingCost\nTEXT-001,Item,kg,${price},${cost},${tax},${qty},${openingCost}`;
test.after(async()=>{await pool.end();});

test('CSV product money follows currency precision and exact minor-unit rounding',()=>{
  for(const [currency,price,cost,expected] of [['KES','12.34','2.33',1234],['JPY','1234','233',1234],['BHD','1.234','0.233',1234]] as const){
    const result=validateProductCsv(source(price,cost),mapping,'CREATE_ONLY',{businessVersion:1,currency,taxRateBps:0},[]);
    assert.equal(result.errors.length,0); assert.equal(result.rows[0].normalized!.sellingPriceMinor,expected);
    assert.equal(result.rows[0].normalized!.taxRateBps,1600);
  }
  const half=validateProductCsv(source('1.00','0.01','0.5','0.01'),mapping,'CREATE_ONLY',{businessVersion:1,currency:'KES',taxRateBps:0},[]);
  assert.equal(half.summary.openingValueMinor,'1');
  const zero=validateProductCsv(source('1.00','0','2.000001','0'),mapping,'CREATE_ONLY',{businessVersion:1,currency:'KES',taxRateBps:0},[]);
  assert.equal(zero.errors.length,0); assert.equal(zero.summary.openingValueMinor,'0');
  assert.ok(zero.warnings.some(issue=>issue.code==='ZERO_OPENING_VALUE'));
  const limit=validateProductCsv(source('90071992547409.91','0'),mapping,'CREATE_ONLY',{businessVersion:1,currency:'KES',taxRateBps:0},[]);
  assert.equal(limit.rows[0].normalized!.sellingPriceMinor,Number.MAX_SAFE_INTEGER);
  const overflow=validateProductCsv(source('90071992547409.92','0'),mapping,'CREATE_ONLY',{businessVersion:1,currency:'KES',taxRateBps:0},[]);
  assert.ok(overflow.errors.some(issue=>issue.code==='MONEY_INVALID'));
});

test('CSV header mapping and browser exports preserve quoted identifiers and suppress formulas',()=>{
  assert.deepEqual(readCsvHeaders('\uFEFF"Item, code",Name,Barcode\r\nA,Item,001'),['Item, code','Name','Barcode']);
  assert.deepEqual(readCsvHeaders('sku,"Tax ""percentage"""\nA,16'),['sku','Tax "percentage"']);
  for(const formula of ['=1+1',' \t@SUM(1)','+1','-1','\tformula']) assert.ok(safeCsvCell(formula).includes("'"));
  assert.equal(safeCsvCell('001234'),'001234');
  assert.equal(safeCsvCell('Comma, "quote"'),'"Comma, ""quote"""');
});
