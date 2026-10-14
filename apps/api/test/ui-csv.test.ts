import assert from 'node:assert/strict';
import test from 'node:test';
import { readCsvHeaders, safeCsvCell } from '../../../src/utils/csv.js';

test('column selection reads trimmed exact headers with BOM, quotes and embedded separators',()=>{
  assert.deepEqual(readCsvHeaders('\uFEFF sku ,"Item, name",sellingPrice\r\nA,Milk,10\r\n'),['sku','Item, name','sellingPrice']);
  assert.deepEqual(readCsvHeaders('sku,"A ""quoted"" header",costPrice\n'),['sku','A "quoted" header','costPrice']);
  assert.deepEqual(readCsvHeaders('sku,"Multi\nline",baseUnit\n'),['sku','Multi\nline','baseUnit']);
  assert.throws(()=>readCsvHeaders('sku,"unfinished'),/unclosed/);
});

test('CSV source decoding preserves the original BOM for canonical source hashing',()=>{
  const source='\uFEFFsku,name\r\nA,Milk\r\n';
  const bytes=new TextEncoder().encode(source);
  assert.equal(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),source);
  assert.throws(()=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new Uint8Array([0xc3,0x28])));
});

test('downloaded CSV cells cannot begin spreadsheet formulas and retain escaped source values',()=>{
  for(const value of ['=1+1','+CMD','-1','@SUM(A1)','  =SUM(A1)','\t=1','\r=1','\n=1','\uFEFF=1']){
    const encoded=safeCsvCell(value);
    assert.ok(encoded.startsWith("'")||encoded.startsWith('"\''));
  }
  assert.equal(safeCsvCell('Normal item'),'Normal item');
  assert.equal(safeCsvCell('001234'),'001234');
  assert.equal(safeCsvCell('Milk, 1L'),'"Milk, 1L"');
  assert.equal(safeCsvCell('A "quoted" value'),'"A ""quoted"" value"');
});
