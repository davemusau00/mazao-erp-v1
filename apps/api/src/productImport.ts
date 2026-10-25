import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, inReadSnapshot } from './db.js';
import { readHistoryPage, type HistoryQuery } from './historyPagination.js';
import { DomainError, ROLE_PERMISSIONS, type ApiSession, type CommandEnvelope } from './contracts.js';
import { requireCommandAuthority } from './commandAuthorization.js';
import { readBusinessProfile } from './configuration.js';
import { stableStringify } from './security.js';
import { CSV_LIMITS, CsvParseError, csvExportCell, parseCsv } from './csvParser.js';
import { resolveCatalogCategory } from './catalogMaintenance.js';
import { normalizeItemKind, isStockTracked, requireCatalogCapability, requireItemKindCapability, type ItemKind } from './itemKinds.js';
import { normalizeCatalogSku, normalizeCatalogName, normalizeCatalogBaseUnit, normalizeCatalogCategoryName, normalizeCatalogBarcode,
  normalizeCatalogQuantity as quantity, catalogMinorFromDecimal as minor, catalogTaxFromPercent as percentage } from './catalogValidation.js';
export { normalizeCatalogMetadata as validateCatalogMetadata } from './catalogValidation.js';

export const PRODUCT_IMPORT_FIELDS = ['sku','name','baseUnit','itemKind','sellingPrice','costPrice','taxRatePercent','currency','barcode','category','reorderLevel','openingQuantity','openingUnitCost'] as const;
type Field = typeof PRODUCT_IMPORT_FIELDS[number];
export type ProductImportMapping = Partial<Record<Field, string | null>>;
export interface ProductImportValidateInput {fileName:string;csv:string;mapping:ProductImportMapping;mode:'CREATE_ONLY'|'UPSERT'}
export interface ProductImportApplyInput {batchId:string;reviewed:boolean;acknowledgedWarnings:boolean}
export interface ImportIssue { row: number; field: string; code: string; rawValue: string; message: string }
export interface ImportNormalized {
  sku: string; name: string; baseUnit: string; currency: string; sellingPriceMinor: number; costPriceMinor: number; taxRateBps: number;
  /** Older stored validation reports omitted this field and mean STOCKED_GOOD. */
  itemKind?: ItemKind;
  barcode: string | null; category: string; reorderLevel: string; openingQuantity: string; openingUnitCostMinor: number | null; openingValueMinor: string;
}
export interface ImportPreviewRow {
  rowNumber: number; action: 'CREATE'|'UPDATE'|'UNCHANGED'|'INVALID'; sku: string; productId?: string; expectedProductVersion?: number;
  normalized?: ImportNormalized; changes: Array<{field:string;before:string|null;after:string}>;
  defaults: {currency:'TENANT_DEFAULT'|'EXISTING'|'CSV';tax:'BUSINESS_DEFAULT'|'EXISTING'|'CSV'};
  errors: ImportIssue[]; warnings: ImportIssue[];
}
interface ConfigurationSnapshot { businessVersion: number; currency: string; taxRateBps: number }
interface ExistingProduct {
  id:string;sku:string;name:string;base_unit:string;currency:string;selling_price_minor:string;cost_price_minor:string;tax_rate_bps:number;
  barcode:string|null;category:string;reorder_level:string;version:string;active:boolean;item_kind?:ItemKind;
}
export interface ImportSummary { rowCount:number;createCount:number;updateCount:number;unchangedCount:number;errorCount:number;warningCount:number;openingQuantityLines:number;openingValueMinor:string }
export interface ImportReport { rows:ImportPreviewRow[];errors:ImportIssue[];warnings:ImportIssue[];summary:ImportSummary }
const scale=1_000_000n;
const maxMinor=BigInt(Number.MAX_SAFE_INTEGER);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const skuKey=(value:string)=>value.trim().toUpperCase();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function requireProductImportAccess(session:ApiSession) {
  requireCommandAuthority(session,'catalog.import.validate');
  requireCatalogCapability(session);
}
function micros(value:string):bigint { const [whole,fraction='']=value.split('.');return BigInt(whole)*scale+BigInt(fraction.padEnd(6,'0')); }
function issue(row:number,field:string,code:string,rawValue:string,message:string):ImportIssue{return {row,field,code,rawValue,message};}
function emptyReport(errors:ImportIssue[]):ImportReport{return {rows:[],errors,warnings:[],summary:{rowCount:0,createCount:0,updateCount:0,unchangedCount:0,errorCount:errors.length,warningCount:0,openingQuantityLines:0,openingValueMinor:'0'}};}

/** Compare legacy reports without rewriting the stored report or its hash. */
export function canonicalProductImportReport(report:ImportReport):ImportReport {
  return {...report,rows:report.rows.map(row=>({...row,...(row.normalized?{normalized:{...row.normalized,itemKind:normalizeItemKind(row.normalized.itemKind)}}:{})}))};
}

/** Current referenced kinds cannot downgrade the reviewed batch requirements. */
export function productImportReportRequiredCapabilities(report:ImportReport,products:ReadonlyArray<Pick<ExistingProduct,'id'|'item_kind'>>=[]):string[]{
  const kinds=report.rows.flatMap(row=>row.normalized?[normalizeItemKind(row.normalized.itemKind)]:[]);
  const referenced=new Set(report.rows.flatMap(row=>row.productId?[row.productId]:[]));
  for(const product of products)if(referenced.has(product.id))kinds.push(normalizeItemKind(product.item_kind));
  return [...new Set(kinds.map(kind=>isStockTracked(kind)?'inventory':'commerce'))].sort();
}

function requireReportKinds(session:ApiSession,report:ImportReport,products:ReadonlyArray<Pick<ExistingProduct,'id'|'item_kind'>>=[]){
  for(const capability of productImportReportRequiredCapabilities(report,products))requireItemKindCapability(session,capability==='inventory'?'STOCKED_GOOD':'SERVICE');
}

function importSourceInput(payload:Record<string,unknown>):ProductImportValidateInput{
  const {fileName,csv,mapping,mode}=payload;
  if(typeof fileName!=='string'||!fileName.trim()||fileName.trim().length>160||/[\u0000-\u001f\u007f]/.test(fileName)||typeof csv!=='string'||!mapping||typeof mapping!=='object'||Array.isArray(mapping)||typeof mode!=='string'||!['CREATE_ONLY','UPSERT'].includes(mode))throw new DomainError('VALIDATION_FAILED','Provide a file name, UTF-8 CSV text, supported mapping and import mode.');
  return {fileName,csv,mapping:mapping as ProductImportMapping,mode:mode as ProductImportValidateInput['mode']};
}

/** Called under the planner's outlet lock, before the business savepoint. */
export async function productImportRequiredCapabilities(client:PoolClient,session:ApiSession,envelope:CommandEnvelope):Promise<string[]>{
  requireProductImportAccess(session);
  const batch=envelope.type==='catalog.import.validate'?undefined:await findBatch(client,session,envelope.payload.batchId);
  const input=importSourceInput(batch?{fileName:batch.file_name,csv:batch.raw_source,mapping:batch.column_mapping,mode:batch.import_mode}:envelope.payload);
  assertImportSourceSafe({...envelope,type:'catalog.import.validate',payload:{...input}});
  const config=await configuration(client,session),products=await catalogSnapshot(client,session);
  const report=validateProductCsv(input.csv,input.mapping,input.mode,config,products);
  const capabilities=new Set(productImportReportRequiredCapabilities(report,products));
  if(batch)for(const capability of productImportReportRequiredCapabilities(batch.validation_report as ImportReport,products))capabilities.add(capability);
  return [...capabilities].sort();
}

/** Validation operates only on supplied snapshots; it cannot write business state. */
export function validateProductCsv(source:string,mapping:ProductImportMapping,mode:'CREATE_ONLY'|'UPSERT',config:ConfigurationSnapshot,products:ExistingProduct[]):ImportReport {
  let parsed:ReturnType<typeof parseCsv>;
  try{parsed=parseCsv(source);}catch(error){if(!(error instanceof CsvParseError))throw error;return emptyReport([issue(error.row,'file',error.code,'',error.message)]);}
  const mapped=new Map<Field,number>(); const errors:ImportIssue[]=[];const warnings:ImportIssue[]=[];
  const used=new Set<string>();
  for(const [field,header] of Object.entries(mapping)){
    if(!(PRODUCT_IMPORT_FIELDS as readonly string[]).includes(field)){errors.push(issue(0,'mapping','MAPPING_FIELD',field,'This target field is not supported.'));continue;}
    if(header===null||header==='')continue;
    if(typeof header!=='string'||!parsed.headers.includes(header.trim())){errors.push(issue(0,'mapping','MAPPING_HEADER',String(header),'A mapped column does not exist in the CSV header.'));continue;}
    if(used.has(header.trim())){errors.push(issue(0,'mapping','MAPPING_DUPLICATE',header,'A CSV column cannot map to more than one field.'));continue;}
    used.add(header.trim());mapped.set(field as Field,parsed.headers.indexOf(header.trim()));
  }
  if(!mapped.has('sku'))errors.push(issue(0,'sku','MAPPING_REQUIRED','','Map a SKU column before validation.'));
  if(errors.length)return emptyReport(errors);
  for(const header of parsed.headers.filter(header=>!used.has(header))){
    const packages=/pack|case.?size|multiplier|conversion|bottle.?volume/i.test(header);
    warnings.push(issue(0,header,packages?'UNSUPPORTED_PACKAGE_COLUMN':'UNMAPPED_COLUMN',header,packages?'This package column is ignored. Opening quantities must already be in the declared base unit; no conversion is inferred.':'This unmapped source column will be ignored.'));
  }
  const bySku=new Map<string,ExistingProduct[]>();const byBarcode=new Map<string,ExistingProduct[]>();
  for(const product of products){const key=skuKey(product.sku);bySku.set(key,[...(bySku.get(key)??[]),product]);if(product.barcode)byBarcode.set(product.barcode,[...(byBarcode.get(product.barcode)??[]),product]);}
  const rows:ImportPreviewRow[]=[];const fileSkus=new Map<string,ImportPreviewRow[]>();const fileBarcodes=new Map<string,ImportPreviewRow[]>();let totalOpening=0n;
  for(const raw of parsed.rows){
    const value=(field:Field)=>{const index=mapped.get(field);return index===undefined?undefined:raw.cells[index].trim();};
    const rawValue=(field:Field)=>{const index=mapped.get(field);return index===undefined?'':raw.cells[index];};
    const inputSku=value('sku')??'';const existingMatches=bySku.get(skuKey(inputSku))??[];const existing=existingMatches.length===1?existingMatches[0]:undefined;
    const row:ImportPreviewRow={rowNumber:raw.rowNumber,action:existing?'UNCHANGED':'CREATE',sku:existing?.sku??inputSku,changes:[],defaults:{currency:mapped.has('currency')?'CSV':existing?'EXISTING':'TENANT_DEFAULT',tax:mapped.has('taxRatePercent')?'CSV':existing?'EXISTING':'BUSINESS_DEFAULT'},errors:[],warnings:[]};
    const add=(field:Field,code:string,message:string)=>row.errors.push(issue(raw.rowNumber,field,code,rawValue(field),message));
    for(const field of mapped.keys())if(/[\u0000-\u001f\u007f]/.test(rawValue(field)))add(field,'FIELD_INVALID','Control characters are not supported in catalogue fields.');
    try{normalizeCatalogSku(rawValue('sku'));}catch(error){add('sku','SKU_INVALID',(error as Error).message);}
    if(existingMatches.length>1)add('sku','SKU_AMBIGUOUS','Multiple existing items match this SKU ignoring case. Resolve their identities before importing.');
    if(existing&&!existing.active)add('sku','ITEM_ARCHIVED','This SKU belongs to an archived item. Import cannot reactivate or replace its history.');
    if(existing&&mode==='CREATE_ONLY')add('sku','SKU_EXISTS','This SKU already exists. Select reviewed upsert mode for metadata changes.');
    if(existing){row.productId=existing.id;row.expectedProductVersion=Number(existing.version);}
    const required=(field:Field,fallback:string|undefined,normalize:(input:unknown)=>string)=>{
      const input=mapped.has(field)?rawValue(field):fallback;
      try{return normalize(input);}catch(error){add(field,'FIELD_INVALID',(error as Error).message);return typeof input==='string'?input.trim():'';}
    };
    const name=required('name',existing?.name,normalizeCatalogName);const baseUnit=required('baseUnit',existing?.base_unit,normalizeCatalogBaseUnit);
    const existingKind=normalizeItemKind(existing?.item_kind);
    let itemKind=existingKind;
    try{itemKind=normalizeItemKind(mapped.has('itemKind')?value('itemKind'):existing?.item_kind);}catch(error){add('itemKind','ITEM_KIND_INVALID',(error as Error).message);}
    if(existing&&itemKind!==existingKind)add('itemKind','ITEM_KIND_CHANGE_REQUIRES_REVIEW','Existing item kinds require the reviewed change-kind command; CSV cannot change stock tracking.');
    if(existing&&baseUnit!==existing.base_unit)add('baseUnit','UNIT_IMMUTABLE','Existing base units cannot be changed by import.');
    const currency=(value('currency')??existing?.currency??config.currency).toUpperCase();
    if(currency!==config.currency)add('currency','CURRENCY_MISMATCH','Currency must match the tenant currency; existing monetary history cannot be converted.');
    if(existing&&currency!==existing.currency)add('currency','CURRENCY_IMMUTABLE','Existing item currency cannot be changed by import.');
    const safeCurrency=/^[A-Z]{3}$/.test(currency)?currency:config.currency;
    const moneyField=(field:Field,fallback:number|undefined)=>{
      const text=value(field);
      if(text===undefined&&fallback!==undefined){if(Number.isSafeInteger(fallback)&&fallback>=0)return fallback;add(field,'MONEY_INVALID','Existing monetary values exceed the supported safe minor-unit range.');return 0;}
      try{return minor(text??'',safeCurrency);}catch(error){add(field,'MONEY_INVALID',(error as Error).message);return 0;}
    };
    const sellingPriceMinor=moneyField('sellingPrice',existing?Number(existing.selling_price_minor):undefined);
    const costPriceMinor=moneyField('costPrice',existing?Number(existing.cost_price_minor):undefined);
    let taxRateBps=existing?.tax_rate_bps??config.taxRateBps;
    if(mapped.has('taxRatePercent'))try{taxRateBps=percentage(value('taxRatePercent')??'');}catch(error){add('taxRatePercent','TAX_INVALID',(error as Error).message);}
    let category=value('category')??existing?.category??'';
    try{category=normalizeCatalogCategoryName(category,true);}catch(error){add('category','CATEGORY_INVALID',(error as Error).message);}
    let barcode=(value('barcode')??existing?.barcode??'')||null;
    try{barcode=normalizeCatalogBarcode(barcode);}catch(error){add('barcode','BARCODE_INVALID',(error as Error).message);}
    if(barcode&&(byBarcode.get(barcode)??[]).some(item=>item.id!==existing?.id))add('barcode','BARCODE_EXISTS','This barcode belongs to another existing item at this outlet.');
    let reorderLevel='0';try{reorderLevel=quantity(value('reorderLevel')??(existing?quantity(existing.reorder_level):'0'));}catch(error){add('reorderLevel','QUANTITY_INVALID',(error as Error).message);}
    let openingQuantity='0';try{openingQuantity=quantity(value('openingQuantity')||'0');}catch(error){add('openingQuantity','QUANTITY_INVALID',(error as Error).message);}
    if(existing&&micros(openingQuantity)>0n)add('openingQuantity','OPENING_STOCK_EXISTING','Opening quantity is only for new items. Use receiving or a reviewed count for existing stock.');
    let openingUnitCostMinor:number|null=null;let openingValue=0n;
    if(value('openingUnitCost'))openingUnitCostMinor=moneyField('openingUnitCost',undefined);
    if(!isStockTracked(itemKind)){
      if(micros(openingQuantity)>0n)add('openingQuantity','NON_STOCK_OPENING_INVENTORY','Services and prepared items cannot carry opening inventory.');
      if(value('openingUnitCost'))add('openingUnitCost','NON_STOCK_OPENING_INVENTORY','Services and prepared items cannot carry an explicit opening inventory cost.');
    }
    if(micros(openingQuantity)>0n){
      if(openingUnitCostMinor===null){add('openingUnitCost','OPENING_COST_REQUIRED','An explicit evidenced unit cost, including an acknowledged zero, is required for opening stock.');openingUnitCostMinor=0;}
      openingValue=(BigInt(openingUnitCostMinor)*micros(openingQuantity)+scale/2n)/scale;
      if(openingValue>maxMinor)add('openingUnitCost','OPENING_VALUE_INVALID','Opening stock value exceeds the supported minor-unit range.');
      if(openingValue===0n)row.warnings.push(issue(raw.rowNumber,'openingUnitCost','ZERO_OPENING_VALUE',rawValue('openingUnitCost'),'Opening stock carries zero minor-unit value. Confirm this explicit cost evidence before importing; a zero-value opening journal will not be posted.'));
    }
    if(isStockTracked(itemKind)&&costPriceMinor===0)row.warnings.push(issue(raw.rowNumber,'costPrice','ZERO_REFERENCE_COST',rawValue('costPrice'),'The item reference cost is zero. Future zero-stock count gains cannot obtain an evidenced value from this reference; acknowledge before importing.'));
    const normalized:ImportNormalized={sku:row.sku,name,baseUnit,itemKind,currency,sellingPriceMinor,costPriceMinor,taxRateBps,barcode,category,reorderLevel,openingQuantity,openingUnitCostMinor,openingValueMinor:openingValue.toString()};
    row.normalized=normalized;
    const before:Record<string,string|null>=existing?{name:existing.name,sellingPriceMinor:existing.selling_price_minor,costPriceMinor:existing.cost_price_minor,taxRateBps:String(existing.tax_rate_bps),barcode:existing.barcode,category:existing.category,reorderLevel:quantity(existing.reorder_level)}:{};
    for(const field of ['name','sellingPriceMinor','costPriceMinor','taxRateBps','barcode','category','reorderLevel'] as const){
      const after=normalized[field]===null?'':String(normalized[field]);
      if(!existing||String(before[field]??'')!==after)row.changes.push({field,before:existing?before[field]:null,after});
    }
    if(existing&&row.changes.length)row.action='UPDATE';
    if(row.errors.length)row.action='INVALID';
    fileSkus.set(skuKey(inputSku),[...(fileSkus.get(skuKey(inputSku))??[]),row]);
    if(barcode)fileBarcodes.set(barcode,[...(fileBarcodes.get(barcode)??[]),row]);
    rows.push(row);totalOpening+=openingValue;
  }
  for(const duplicates of fileSkus.values())if(duplicates.length>1)for(const row of duplicates){row.errors.push(issue(row.rowNumber,'sku','DUPLICATE_SKU',row.sku,'This SKU appears more than once in the file, ignoring case.'));row.action='INVALID';}
  for(const [barcode,duplicates] of fileBarcodes)if(duplicates.length>1)for(const row of duplicates){row.errors.push(issue(row.rowNumber,'barcode','DUPLICATE_BARCODE',barcode,'This barcode appears on more than one source row.'));row.action='INVALID';}
  if(totalOpening>maxMinor)errors.push(issue(0,'openingQuantity','OPENING_TOTAL_INVALID','','Total opening value exceeds the supported safe minor-unit range.'));
  errors.push(...rows.flatMap(row=>row.errors));warnings.push(...rows.flatMap(row=>row.warnings));
  return {rows,errors,warnings,summary:{rowCount:rows.length,createCount:rows.filter(row=>row.action==='CREATE').length,updateCount:rows.filter(row=>row.action==='UPDATE').length,unchangedCount:rows.filter(row=>row.action==='UNCHANGED').length,errorCount:errors.length,warningCount:warnings.length,openingQuantityLines:rows.filter(row=>row.action==='CREATE'&&micros(row.normalized!.openingQuantity)>0n).length,openingValueMinor:totalOpening.toString()}};
}

async function configuration(client:PoolClient,session:ApiSession,lock=false):Promise<ConfigurationSnapshot>{
  const result=await client.query<{version:string;currency:string;business_profile:unknown}>(`SELECT version,currency,business_profile FROM core.tenants WHERE id=$1${lock?' FOR SHARE':''}`,[session.tenantId]);
  if(!result.rowCount)throw new DomainError('NOT_FOUND','Tenant was not found.',404);
  return {businessVersion:Number(result.rows[0].version),currency:result.rows[0].currency,taxRateBps:readBusinessProfile(result.rows[0].business_profile).taxPolicy.defaultRateBps};
}
async function catalogSnapshot(client:PoolClient,session:ApiSession,lock=false):Promise<ExistingProduct[]>{
  const result=await client.query<ExistingProduct>(`SELECT id,sku,name,base_unit,item_kind,currency,selling_price_minor::text,cost_price_minor::text,tax_rate_bps,barcode,category,reorder_level::text,version::text,active FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 ORDER BY id${lock?' FOR UPDATE':''}`,[session.tenantId,session.outletId]);
  return result.rows;
}
async function evidence(client:PoolClient,session:ApiSession,envelope:CommandEnvelope,value:unknown){
  // Source text, cells and per-row prices remain confined to the scoped batch.
  const json=JSON.stringify(value);
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[randomUUID(),session.tenantId,session.outletId,session.userId,envelope.commandId,envelope.type,json]);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)',[randomUUID(),session.tenantId,envelope.commandId,envelope.type,json]);
}
function batchExpected(envelope:CommandEnvelope,batchId:string):number{
  const expected=envelope.expectedVersions[`import:${batchId}`];
  if(!Number.isSafeInteger(expected)||expected<1)throw new DomainError('VALIDATION_FAILED','Expected import batch version is required.');
  return expected;
}
async function findBatch(client:PoolClient,session:ApiSession,id:unknown,lock=false){
  if(typeof id!=='string'||!uuid.test(id))throw new DomainError('VALIDATION_FAILED','A valid import batch ID is required.');
  const result=await client.query(`SELECT * FROM catalog.product_import_batches WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3${lock?' FOR UPDATE':''}`,[id,session.tenantId,session.outletId]);
  if(!result.rowCount)throw new DomainError('NOT_FOUND','Import batch was not found at this outlet.',404);
  return result.rows[0];
}
async function validateBatch(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  assertImportSourceSafe(envelope);
  const {fileName,csv,mapping,mode}=importSourceInput(envelope.payload);
  const sourceBytes=Buffer.byteLength(csv,'utf8');
  if(sourceBytes>CSV_LIMITS.bytes)throw new DomainError('VALIDATION_FAILED','CSV exceeds the 512 KiB upload limit.',400,{code:'CSV_BYTES_LIMIT'});
  const config=await configuration(client,session);
  const report=validateProductCsv(csv,mapping as ProductImportMapping,mode as 'CREATE_ONLY'|'UPSERT',config,await catalogSnapshot(client,session));
  requireReportKinds(session,report);
  if(report.summary.openingQuantityLines>0&&!ROLE_PERMISSIONS[session.role].includes('inventory.receive'))throw new DomainError('FORBIDDEN','Opening inventory requires stock-receiving permission.',403);
  const id=randomUUID();const sourceHash=hash(csv);const status=report.errors.length?'INVALID':'READY';
  await client.query(`INSERT INTO catalog.product_import_batches(id,tenant_id,outlet_id,created_by,file_name,raw_source,source_sha256,source_bytes,column_mapping,import_mode,status,configuration_snapshot,validation_report,validation_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb,$14)`,[id,session.tenantId,session.outletId,session.userId,fileName.trim(),csv,sourceHash,sourceBytes,JSON.stringify(mapping),mode,status,JSON.stringify(config),JSON.stringify(report),hash(stableStringify(report))]);
  const value={batchId:id,version:1,status,errorCount:report.errors.length,warningCount:report.warnings.length,sourceHash};
  await evidence(client,session,envelope,value);return value;
}
export async function executeProductImportCommand(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  try{return await executeImport(client,session,envelope);}
  catch(error){
    const databaseError=error as {code?:string;constraint?:string};
    if(envelope.type==='catalog.import.apply'&&databaseError.code==='23505'&&['products_tenant_id_outlet_id_sku_key','products_outlet_normalized_sku_unique','products_outlet_barcode_unique'].includes(databaseError.constraint??'')){
      throw new DomainError('IMPORT_STALE','Another catalogue command claimed a SKU or barcode after validation. Revalidate the complete batch.',409,{reason:'catalog'});
    }
    throw error;
  }
}
async function executeImport(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  requireProductImportAccess(session);
  const allowed=envelope.type==='catalog.import.validate'?['fileName','csv','mapping','mode']:envelope.type==='catalog.import.apply'?['batchId','reviewed','acknowledgedWarnings']:['batchId'];
  if(Object.keys(envelope.payload).some(key=>!allowed.includes(key)))throw new DomainError('VALIDATION_FAILED','Import input contains an unsupported field. The server applies its stored validated rows only.');
  if(envelope.type==='catalog.import.validate')return validateBatch(client,session,envelope);
  const batch=await findBatch(client,session,envelope.payload.batchId,true);
  const expected=batchExpected(envelope,batch.id);
  if(Number(batch.version)!==expected)throw new DomainError('VERSION_CONFLICT','Import batch changed. Reload its server state before proceeding.',409,{currentVersion:Number(batch.version)});
  if(envelope.type==='catalog.import.revalidate'){
    requireReportKinds(session,batch.validation_report as ImportReport);
    return validateBatch(client,session,{...envelope,payload:{fileName:batch.file_name,csv:batch.raw_source,mapping:batch.column_mapping,mode:batch.import_mode}});
  }
  if(envelope.type!=='catalog.import.apply')throw new DomainError('VALIDATION_FAILED','Unsupported import operation.');
  if(batch.created_by!==session.userId)throw new DomainError('FORBIDDEN','Revalidate this batch under your account before applying it.',403);
  if(batch.status==='APPLIED'){await evidence(client,session,envelope,{batchId:batch.id,sourceHash:batch.source_sha256,status:'ALREADY_APPLIED'});return batch.apply_result;}
  if(batch.status!=='READY')throw new DomainError('IMPORT_INVALID','Correct the source errors and validate a new batch before applying.',409);
  if(envelope.payload.reviewed!==true)throw new DomainError('REVIEW_REQUIRED','Review the predicted changes and opening inventory value before applying.',409);
  const original=batch.validation_report as ImportReport;
  requireReportKinds(session,original);
  if(original.warnings.length&&envelope.payload.acknowledgedWarnings!==true)throw new DomainError('WARNINGS_NOT_ACKNOWLEDGED','Acknowledge every import warning before applying.',409);
  if(original.summary.openingQuantityLines&&!ROLE_PERMISSIONS[session.role].includes('inventory.receive'))throw new DomainError('FORBIDDEN','Opening inventory requires stock-receiving permission.',403);
  if(original.rows.some(row=>row.normalized&&isStockTracked(normalizeItemKind(row.normalized.itemKind)))){
    const activeCount=await client.query('SELECT id FROM inventory.stock_counts WHERE tenant_id=$1 AND outlet_id=$2 AND status=\'OPEN\' LIMIT 1',[session.tenantId,session.outletId]);
    if(activeCount.rowCount)throw new DomainError('OPEN_COUNT_CONFLICT','Finish or cancel the open outlet stock count before importing catalogue changes.',409,{countId:activeCount.rows[0].id});
  }
  const config=await configuration(client,session,true);
  if(stableStringify(config)!==stableStringify(batch.configuration_snapshot))throw new DomainError('IMPORT_STALE','Business defaults changed after validation. Revalidate the import.',409,{reason:'business',currentBusinessVersion:config.businessVersion});
  if(hash(batch.raw_source)!==batch.source_sha256||hash(stableStringify(original))!==batch.validation_sha256)throw new DomainError('IMPORT_STALE','Stored import evidence does not match its validation hash. Revalidate the source.',409,{reason:'source'});
  const products=await catalogSnapshot(client,session,true);
  const current=validateProductCsv(batch.raw_source,batch.column_mapping,batch.import_mode,config,products);
  requireReportKinds(session,current,products);
  if(stableStringify(canonicalProductImportReport(current))!==stableStringify(canonicalProductImportReport(original)))throw new DomainError('IMPORT_STALE','Catalogue identities, metadata or versions changed after validation. Revalidate the import.',409,{reason:'catalog'});
  const appliedRows:Array<{rowNumber:number;productId:string;action:string}>=[];
  for(const row of original.rows){
    const value=row.normalized!,itemKind=normalizeItemKind(value.itemKind);let productId=row.productId;
    if(row.action==='CREATE'){
      productId=randomUUID();
      const categoryId=await resolveCatalogCategory(client,session,value.category,envelope.commandId);
      await client.query(`INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,category,barcode,reorder_level,last_import_batch_id,category_id,item_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::numeric,$14,$15,$16)`,[productId,session.tenantId,session.outletId,value.sku,value.name,value.baseUnit,value.currency,value.sellingPriceMinor,value.costPriceMinor,value.taxRateBps,value.category,value.barcode,value.reorderLevel,batch.id,categoryId,itemKind]);
      if(isStockTracked(itemKind)){
        await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,$4::numeric,$5)',[session.tenantId,session.outletId,productId,value.openingQuantity,value.openingValueMinor]);
        if(micros(value.openingQuantity)>0n)await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id,document_reference) VALUES($1,$2,$3,$4,$5,'OPENING_IMPORT',$6::numeric,$7,$8,$9,$10)`,[randomUUID(),session.tenantId,session.outletId,productId,envelope.commandId,value.openingQuantity,value.openingUnitCostMinor,value.openingValueMinor,batch.id,`Import ${batch.id}`]);
      }
    }else if(row.action==='UPDATE'){
      const categoryId=await resolveCatalogCategory(client,session,value.category,envelope.commandId);
      const result=await client.query(`UPDATE catalog.products SET name=$4,selling_price_minor=$5,cost_price_minor=$6,tax_rate_bps=$7,category=$8,barcode=$9,reorder_level=$10::numeric,last_import_batch_id=$11,category_id=$13,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 AND version=$12 AND item_kind=$14 AND active RETURNING id`,[session.tenantId,session.outletId,productId,value.name,value.sellingPriceMinor,value.costPriceMinor,value.taxRateBps,value.category,value.barcode,value.reorderLevel,batch.id,row.expectedProductVersion,categoryId,itemKind]);
      if(!result.rowCount)throw new DomainError('IMPORT_STALE','An item changed during import. Revalidate all rows.',409,{reason:'product'});
    }
    appliedRows.push({rowNumber:row.rowNumber,productId:productId!,action:row.action});
  }
  const openingValue=BigInt(original.summary.openingValueMinor);
  if(openingValue>0n){
    const entryId=randomUUID();
    await client.query('INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,\'OPENING_PRODUCT_IMPORT\',$3,$4,$5)',[entryId,session.tenantId,batch.id,config.currency,session.userId]);
    await client.query(`INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,'INVENTORY',$4,0),($5,$2,$3,'OPENING_BALANCE_CLEARING',0,$4)`,[randomUUID(),session.tenantId,entryId,openingValue.toString(),randomUUID()]);
  }
  const value={batchId:batch.id,version:expected+1,status:'APPLIED',createdCount:original.summary.createCount,updatedCount:original.summary.updateCount,unchangedCount:original.summary.unchangedCount,openingValueMinor:openingValue.toString(),rows:appliedRows};
  await client.query('UPDATE catalog.product_import_batches SET status=\'APPLIED\',version=version+1,applied_at=now(),applied_by=$4,apply_result=$5::jsonb WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,batch.id,session.userId,JSON.stringify(value)]);
  await evidence(client,session,envelope,{batchId:batch.id,sourceHash:batch.source_sha256,createdCount:value.createdCount,updatedCount:value.updatedCount,unchangedCount:value.unchangedCount,openingValueMinor:value.openingValueMinor});
  return value;
}
function batchMetadata(row:Record<string,any>){
  return {id:row.id,fileName:row.file_name,mode:row.import_mode,status:row.status,version:Number(row.version),sourceHash:row.source_sha256,sourceBytes:row.source_bytes,businessVersion:row.configuration_snapshot.businessVersion,currency:row.configuration_snapshot.currency,defaultTaxRateBps:row.configuration_snapshot.taxRateBps,createdAt:row.created_at,createdBy:row.created_by,appliedAt:row.applied_at,summary:row.validation_report.summary};
}
export async function listProductImports(session:ApiSession,query:HistoryQuery={}){
  requireProductImportAccess(session);
  return inReadSnapshot(async client=>{
  const result=await readHistoryPage(client,session,'catalog.imports',query,`SELECT id,created_at sort_at,concat_ws(' ',file_name,import_mode,status,id::text) search_text,file_name,import_mode,status,version,source_sha256,source_bytes,configuration_snapshot,created_at,created_by,applied_at,
    jsonb_build_object('summary',validation_report->'summary') validation_report FROM catalog.product_import_batches
    WHERE tenant_id=$1 AND outlet_id=$2
      AND ($3::boolean OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(validation_report->'rows') evidence_row
        WHERE jsonb_typeof(evidence_row->'normalized')='object' AND COALESCE(evidence_row->'normalized'->>'itemKind','STOCKED_GOOD')='STOCKED_GOOD'))
      AND ($4::boolean OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(validation_report->'rows') evidence_row
        WHERE jsonb_typeof(evidence_row->'normalized')='object' AND COALESCE(evidence_row->'normalized'->>'itemKind','STOCKED_GOOD') IN ('SERVICE','PREPARED')))`,
    [session.tenantId,session.outletId,session.capabilities.includes('inventory'),session.capabilities.includes('commerce')]);
  return {batches:result.rows.map(batchMetadata),page:result.page};
  });
}
export async function getProductImport(session:ApiSession,id:unknown){
  requireProductImportAccess(session);const client=await pool.connect();
  try{const row=await findBatch(client,session,id);requireReportKinds(session,row.validation_report as ImportReport);return {batch:{...batchMetadata(row),...row.validation_report,source:{csv:row.raw_source,mapping:row.column_mapping},appliedResult:row.apply_result}};}finally{client.release();}
}
export async function productImportErrorsCsv(session:ApiSession,id:unknown){
  const {batch}=await getProductImport(session,id);
  return [['row','field','code','rawValue','message'],...batch.errors.map((error:ImportIssue)=>[error.row,error.field,error.code,error.rawValue,error.message])].map(row=>row.map(csvExportCell).join(',')).join('\r\n')+'\r\n';
}

/** Reject text PostgreSQL cannot preserve before recording a staging command. */
export function assertImportSourceSafe(envelope:CommandEnvelope){
  if(envelope.type!=='catalog.import.validate')return;
  const source=envelope.payload.csv;
  if(typeof source!=='string')throw new DomainError('VALIDATION_FAILED','Provide UTF-8 CSV source text.');
  if(Buffer.byteLength(source,'utf8')>CSV_LIMITS.bytes)throw new DomainError('VALIDATION_FAILED','CSV exceeds the 512 KiB upload limit.',400,{code:'CSV_BYTES_LIMIT',row:1,field:'file',message:'CSV exceeds the 512 KiB upload limit.'});
  try{parseCsv(source);}catch(error){if(error instanceof CsvParseError&&error.code==='CSV_ENCODING')throw new DomainError('VALIDATION_FAILED',error.message,400,{code:error.code,row:error.row,field:'file',message:error.message});}
}
