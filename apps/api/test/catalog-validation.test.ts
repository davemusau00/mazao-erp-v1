import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError } from '../src/contracts.js';
import { normalizeCatalogProductCreate, normalizeCatalogProductUpdate, normalizeCatalogCategoryName,
  normalizeCatalogMetadata, normalizeCatalogQuantity, catalogMinorFromDecimal } from '../src/catalogValidation.js';

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:1/unused_catalog_validation';
const { validateProductCsv } = await import('../src/productImport.js');
const defaults = {currency:'KES',taxRateBps:1600};
const payload = () => ({sku:'00001',name:'Tea',baseUnit:'each',currency:'KES',sellingPriceMinor:1234,costPriceMinor:275});
const rejected = (error:unknown) => error instanceof DomainError && error.code === 'VALIDATION_FAILED';
const csv = (rows:string[][]) => rows.map(row=>row.map(cell=>`"${cell.replaceAll('"','""')}"`).join(',')).join('\n');

test('direct create and CSV share normalized metadata, leading zeros and tenant defaults',()=>{
  const direct=normalizeCatalogProductCreate({...payload(),name:' Tea ',currency:'kes',category:' Pantry ',barcode:'0000123',reorderLevel:'000.250000'},defaults);
  const headers=['sku','name','baseUnit','sellingPrice','costPrice','currency','category','barcode','reorderLevel'];
  const report=validateProductCsv(csv([headers,['00001',' Tea ','each','12.34','2.75','kes',' Pantry ','0000123','000.250000']]),Object.fromEntries(headers.map(field=>[field,field])),'CREATE_ONLY',{businessVersion:1,...defaults},[]);
  assert.deepEqual(report.errors,[]);
  const {openingQuantity,openingUnitCostMinor,openingValueMinor,...normalized}=report.rows[0].normalized!;
  assert.deepEqual(normalized,direct);
  assert.equal(openingQuantity,'0');assert.equal(openingUnitCostMinor,null);assert.equal(openingValueMinor,'0');
  assert.deepEqual(normalizeCatalogMetadata({}),{category:'',barcode:null,reorderLevel:'0'});
  const minimal=normalizeCatalogProductCreate(payload(),defaults);
  assert.equal(minimal.taxRateBps,1600);assert.equal(minimal.category,'');assert.equal(minimal.barcode,null);assert.equal(minimal.reorderLevel,'0');
  assert.equal(minimal.itemKind,'STOCKED_GOOD');
});

test('direct create rejects malformed text, scientific identifiers and unsafe minor amounts',()=>{
  for(const sku of ['1.234E+11','.123e4','1.e4','1E-2'])assert.throws(()=>normalizeCatalogProductCreate({...payload(),sku},defaults),rejected);
  for(const changes of [
    {name:'Tea\nname'},{category:'Pantry\t'},{barcode:'\t00001'},{barcode:'1.234E+11'},{baseUnit:'each\n'},
    {name:null},{name:123},{name:[]},{sellingPriceMinor:'1234'},{sellingPriceMinor:1.5},{costPriceMinor:-1},
    {sellingPriceMinor:Number.MAX_SAFE_INTEGER+1},{taxRateBps:10_001},{taxRateBps:'1600'},{currency:'USD'},
    {reorderLevel:'1e3'},{reorderLevel:'1,000'},{reorderLevel:'0.0000001'},{reorderLevel:-1},
  ])assert.throws(()=>normalizeCatalogProductCreate({...payload(),...changes},defaults),rejected,JSON.stringify(changes));
});

test('CSV controls are rejected before trimming and cannot bypass direct metadata validation',()=>{
  const headers=['sku','name','baseUnit','sellingPrice','costPrice','category','barcode','reorderLevel'];
  const mapping=Object.fromEntries(headers.map(field=>[field,field]));
  for(const [column,value] of [[0,'SKU\t'],[1,'Tea\nname'],[2,'each\t'],[3,'12.34\t'],[5,'Pantry\n'],[6,'0000123\t'],[7,'0.25\t']] as const){
    const row=['SKU','Tea','each','12.34','2.75','Pantry','0000123','0.25'];row[column]=value;
    const report=validateProductCsv(csv([headers,row]),mapping,'CREATE_ONLY',{businessVersion:1,...defaults},[]);
    assert.ok(report.errors.length,`column ${column} accepted controls`);assert.equal(report.rows[0]?.action,'INVALID');
  }
});

test('complete updates preserve immutable identities and exact case-sensitive category labels',()=>{
  const update={productId:'00000000-0000-4000-8000-000000000001',reason:'Reviewed metadata',name:'Tea',sellingPriceMinor:100,costPriceMinor:50,taxRateBps:0,category:'Pantry',barcode:null,reorderLevel:'0'};
  const before=structuredClone(update);assert.equal(normalizeCatalogProductUpdate(update).barcode,null);assert.deepEqual(update,before);
  for(const key of ['name','sellingPriceMinor','costPriceMinor','taxRateBps','category','barcode','reorderLevel']){
    const missing:Record<string,unknown>={...update};delete missing[key];assert.throws(()=>normalizeCatalogProductUpdate(missing),rejected,key);
  }
  for(const immutable of [{sku:'CHANGED'},{baseUnit:'kg'},{currency:'USD'},{itemKind:'SERVICE'},{unknownIntent:true}])assert.throws(()=>normalizeCatalogProductUpdate({...update,...immutable}),rejected);
  assert.equal(normalizeCatalogCategoryName(' Pantry '),'Pantry');assert.equal(normalizeCatalogCategoryName('pantry'),'pantry');
  assert.notEqual(normalizeCatalogCategoryName('Pantry'),normalizeCatalogCategoryName('pantry'));
});

test('item creation accepts only explicit supported kinds and never changes update kind implicitly',()=>{
  for(const itemKind of ['STOCKED_GOOD','SERVICE','PREPARED'])assert.equal(normalizeCatalogProductCreate({...payload(),itemKind},defaults).itemKind,itemKind);
  for(const itemKind of [null,'','service',' SERVICE ',0,true,[],{},'DIGITAL'])assert.throws(()=>normalizeCatalogProductCreate({...payload(),itemKind},defaults),rejected,JSON.stringify(itemKind));
});

test('decimal quantities and currency prices remain exact at their supported boundaries',()=>{
  assert.equal(normalizeCatalogQuantity('0001.250000'),'1.25');
  assert.equal(normalizeCatalogQuantity('99999999999999.999999'),'99999999999999.999999');
  assert.throws(()=>normalizeCatalogQuantity('100000000000000'),rejected);
  assert.equal(catalogMinorFromDecimal('90071992547409.91','KES'),Number.MAX_SAFE_INTEGER);
  for(const value of ['90071992547409.92','1e3','1,000','0.001','-1'])assert.throws(()=>catalogMinorFromDecimal(value,'KES'),rejected,value);
  assert.equal(catalogMinorFromDecimal('12','JPY'),12);assert.equal(catalogMinorFromDecimal('12.345','KWD'),12345);
});
