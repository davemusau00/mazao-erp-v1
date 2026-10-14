import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { apiClient, type BackendCommand, type ProductImportBatch, type ProductImportBatchSummary, type ProductImportField, type ProductImportIssue, type ProductImportMapping, type ProductImportMode, type ProductImportRow } from '../../services/apiClient';
import { CsvColumnMapper, type CsvMappingField } from '../common/CsvColumnMapper';
import { readCsvHeaders, safeCsvCell } from '../../utils/csv';
import { downloadCsv } from '../../utils/csvDownload';
import { currencyMinorDigits, formatMinorMoneyText, minorToMoneyInput } from '../../utils/money';

const fields:CsvMappingField[]=[
  {key:'sku',label:'SKU',required:true,detail:'Matches existing items in update mode.'},
  {key:'name',label:'Item name',detail:'Required for each new item.'},
  {key:'baseUnit',label:'Base unit',detail:'Each, can, kg, litre or another individual unit. Required for new items.'},
  {key:'sellingPrice',label:'Selling price',detail:'Price per base unit, excluding tax. Required for new items.'},
  {key:'costPrice',label:'Reference cost',detail:'Cost per base unit. Required for new items; opening stock uses its explicit unit cost.'},
  {key:'taxRatePercent',label:'Tax rate (%)',detail:'Omitted columns use the business default for new items and preserve existing rates.'},
  {key:'currency',label:'Currency',detail:'New items use the business currency when not mapped.'},
  {key:'barcode',label:'Barcode',detail:'Keep barcodes as text to preserve leading zeros.'},
  {key:'category',label:'Category'},
  {key:'reorderLevel',label:'Reorder level',detail:'Non-negative quantity in base units.'},
  {key:'openingQuantity',label:'Opening quantity',detail:'Only for new items; does not replace existing stock.'},
  {key:'openingUnitCost',label:'Opening unit cost',detail:'Required when a new item has positive opening quantity; cost per base unit.'},
];
const aliases:Record<ProductImportField,string[]>={sku:['sku','itemcode','productcode'],name:['name','itemname','productname'],baseUnit:['baseunit','unit'],sellingPrice:['sellingprice','sellprice','price'],costPrice:['costprice','referencecost','cost'],taxRatePercent:['taxratepercent','taxrate','tax','vat','vatrate'],currency:['currency'],barcode:['barcode','ean'],category:['category'],reorderLevel:['reorderlevel','reorderpoint'],openingQuantity:['openingquantity','openingqty','openingstock'],openingUnitCost:['openingunitcost','openingcost']};
function emptyMapping():ProductImportMapping{return Object.fromEntries(fields.map(field=>[field.key,null])) as ProductImportMapping;}
function guessMapping(headers:string[]):ProductImportMapping {
  return Object.fromEntries(fields.map(field=>[field.key,headers.find(header=>aliases[field.key as ProductImportField].includes(header.toLowerCase().replace(/[^a-z0-9]/g,'')))??null])) as ProductImportMapping;
}
const button='inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50';
const terminal=(status:string)=>['CONFIRMED','REJECTED','CONFLICT'].includes(status);
const fieldLabel=(field:string)=>fields.find(item=>item.key===field)?.label??field;
async function sourceHash(source:string):Promise<string>{const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}

export function ProductCsvImportWorkspace({onBack}:{onBack:()=>void}) {
  const session=apiClient.getSession()!;
  const canImport=session.user.permissions.includes('catalog.manage');
  const id=useId();
  const [csv,setCsv]=useState('');const [fileName,setFileName]=useState('');const [headers,setHeaders]=useState<string[]>([]);
  const [mapping,setMapping]=useState<ProductImportMapping>(emptyMapping);const [mode,setMode]=useState<ProductImportMode>('CREATE_ONLY');
  const [batch,setBatch]=useState<ProductImportBatch|null>(null);const [selectedBatchId,setSelectedBatchId]=useState('');
  const [history,setHistory]=useState<ProductImportBatchSummary[]>([]);const [historyLoading,setHistoryLoading]=useState(true);const [historyError,setHistoryError]=useState('');
  const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(false);const [readingFile,setReadingFile]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [recoveryReady,setRecoveryReady]=useState(false);const [recoveryError,setRecoveryError]=useState('');
  const [unknownId,setUnknownId]=useState('');const [unknownType,setUnknownType]=useState('');const [validationMissing,setValidationMissing]=useState(false);
  const [dirty,setDirty]=useState(false);const [stale,setStale]=useState(false);const [reviewed,setReviewed]=useState(false);const [warningsAcknowledged,setWarningsAcknowledged]=useState(false);
  const [rowFilter,setRowFilter]=useState('ALL');const [rowPage,setRowPage]=useState(0);
  const pending=useRef<BackendCommand|null>(null);const inFlight=useRef(false);const fileInput=useRef<HTMLInputElement>(null);const heading=useRef<HTMLHeadingElement>(null);
  const blockEdits=!recoveryReady||busy||loading||readingFile||Boolean(unknownId);
  const zone=session.outlet.timeZone??session.tenant.timeZone;
  const canApply=!!batch&&batch.status==='READY'&&batch.summary.errorCount===0&&!stale&&!dirty&&!blockEdits&&reviewed&&(batch.summary.warningCount===0||warningsAcknowledged)&&batch.createdBy===session.user.id;
  const resetReview=()=>{setReviewed(false);setWarningsAcknowledged(false);setStale(false);setRowPage(0);setRowFilter('ALL');};

  const loadHistory=async()=>{
    setHistoryLoading(true);setHistoryError('');
    try{setHistory((await apiClient.listProductImports()).batches);}
    catch(cause){setHistoryError(cause instanceof Error?cause.message:'Import history could not be loaded.');}
    finally{setHistoryLoading(false);}
  };
  const loadBatch=async(batchId:string)=>{
    setSelectedBatchId(batchId);setLoading(true);setError('');setBatch(null);resetReview();
    try{
      const result=await apiClient.getProductImport(batchId);setBatch(result.batch);
      setCsv(result.batch.source.csv);setFileName(result.batch.fileName);setMapping(result.batch.source.mapping);setMode(result.batch.mode);
      try{setHeaders(readCsvHeaders(result.batch.source.csv));}catch{setHeaders([]);}
      setDirty(false);heading.current?.focus();
    }catch(cause){setError(cause instanceof Error?cause.message:'The saved import could not be loaded.');}
    finally{setLoading(false);}
  };
  const loadRecovery=async()=>{
    setRecoveryReady(false);setRecoveryError('');
    try {
      const [commands,validations]=await Promise.all([apiClient.listRecoverableCommands(session.tenant.id),apiClient.listImportValidationRecovery()]);
      const apply=commands.find(record=>record.command.type==='catalog.import.apply'&&record.command.deviceId===session.deviceId);
      if(apply){pending.current=apply.command;setUnknownId(apply.command.commandId);setUnknownType(apply.command.type);await loadBatch(String(apply.command.payload.batchId));setNotice('An import apply command is awaiting confirmation. Check its original status before applying anything else.');}
      else if(validations[0]){pending.current=null;setUnknownId(validations[0].commandId);setUnknownType(validations[0].type);setFileName(validations[0].fileName);setNotice('A validation command is awaiting confirmation. Its ID and source hash are retained; CSV contents are not stored in the browser journal.');}
      setRecoveryReady(true);
    }catch(cause){setRecoveryError(cause instanceof Error?cause.message:'Import command recovery could not be checked.');}
  };
  useEffect(()=>{if(canImport){void loadHistory();void loadRecovery();heading.current?.focus();}},[]);
  useEffect(()=>{
    const unload=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};
    const leave=(event:Event)=>{if(dirty&&!window.confirm('Discard the CSV and column mapping that have not been validated on the server?'))event.preventDefault();};
    window.addEventListener('beforeunload',unload);window.addEventListener('mazao:before-navigate',leave);
    return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('mazao:before-navigate',leave);};
  },[dirty]);

  const selectFile=async(file:File|undefined)=>{
    if(!file||blockEdits)return;
    setError('');setNotice('');setBatch(null);setSelectedBatchId('');resetReview();setDirty(true);
    setCsv('');setHeaders([]);setMapping(emptyMapping());setFileName(file.name);setReadingFile(true);
    try {
      if(!/\.csv$/i.test(file.name))throw new Error('Choose a .csv file saved as UTF-8.');
      if(file.size>512*1024)throw new Error('The CSV must be 512 KiB or smaller. Split larger files before importing.');
      const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
      const columns=readCsvHeaders(text);
      setCsv(text);setFileName(file.name);setHeaders(columns);setMapping(guessMapping(columns));
    }catch(cause){setCsv('');setFileName(file.name);setHeaders([]);setMapping(emptyMapping());setError(cause instanceof Error?cause.message:'The file is not valid UTF-8. Save it as UTF-8 CSV and try again.');}
    finally{setReadingFile(false);}
  };
  const makeCommand=(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):BackendCommand=>({protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
  const finish=async(result:{status:string;code?:string;message?:string;value?:Record<string,unknown>},type:string)=>{
    if(terminal(result.status)){pending.current=null;setUnknownId('');setUnknownType('');setValidationMissing(false);}
    if(result.status==='CONFIRMED'){
      const batchId=result.value?.batchId;
      if(typeof batchId!=='string'){setError('The command was confirmed but did not return an import reference. Review import history before continuing.');await loadHistory();return;}
      await loadBatch(batchId);await loadHistory();
      setNotice(type==='catalog.import.apply'?'The server confirmed the import. All approved item and opening stock changes were applied together.':'The server validated all rows. Review errors, warnings and proposed changes before applying.');
    }else if(terminal(result.status)){
      setError(result.message??'The server did not accept this import command.');
      if(type==='catalog.import.apply'&&(result.status==='CONFLICT'||['IMPORT_STALE','VERSION_CONFLICT','OPEN_COUNT_CONFLICT'].includes(result.code??'')))setStale(true);
    }else{setUnknownId(pending.current?.commandId??unknownId);setUnknownType(type);setNotice('The command outcome is unknown. Check its original server status before submitting another import action.');}
  };
  const send=async(command:BackendCommand)=>{
    if(inFlight.current||!canImport)return;
    inFlight.current=true;pending.current=command;setBusy(true);setError('');setNotice('');
    try {
      const validation=command.type!=='catalog.import.apply';
      const hash=validation?await sourceHash(command.type==='catalog.import.validate'?String(command.payload.csv):batch?.source.csv??''):'';
      const result=validation?await apiClient.submitImportValidation(command,fileName,hash):await apiClient.submitCommand(command);
      await finish(result,command.type);
    }catch(cause){
      if(['IMPORT_NOT_SENT','COMMAND_NOT_SENT'].includes((cause as {code?:string}).code??'')){pending.current=null;setUnknownId('');setUnknownType('');setError(cause instanceof Error?cause.message:'The command was not sent.');}
      else{setUnknownId(command.commandId);setUnknownType(command.type);setNotice(cause instanceof Error?cause.message:'The import outcome is unknown. Keep the original command and check its status.');}
    }finally{inFlight.current=false;setBusy(false);}
  };
  const validate=()=>{
    if(blockEdits||!csv||!mapping.sku)return;
    void send(makeCommand('catalog.import.validate',{fileName,csv,mapping,mode}));
  };
  const revalidate=()=>{
    if(blockEdits||!batch)return;
    void send(makeCommand('catalog.import.revalidate',{batchId:batch.id},{['import:'+batch.id]:batch.version}));
  };
  const apply=()=>{if(canApply&&batch)void send(makeCommand('catalog.import.apply',{batchId:batch.id,reviewed:true,acknowledgedWarnings:warningsAcknowledged},{['import:'+batch.id]:batch.version}));};
  const checkStatus=async()=>{
    if(inFlight.current||!unknownId)return;
    inFlight.current=true;setBusy(true);setError('');
    try{
      const result=unknownType==='catalog.import.apply'?await apiClient.checkCommandStatus(unknownId):await apiClient.checkImportValidationStatus(unknownId);
      await finish({status:result.status,...result.response},unknownType);
    }catch(cause){
      if((cause as {status?:number}).status===404&&unknownType!=='catalog.import.apply'){setValidationMissing(true);setNotice('No completed validation was found. Validation cannot change items or stock. You can check again or choose the CSV again to start another validation.');}
      else setError(cause instanceof Error?cause.message:'Command status could not be checked. The original command remains retained.');
    }finally{inFlight.current=false;setBusy(false);}
  };
  const clearSource=()=>{setBatch(null);setSelectedBatchId('');setCsv('');setHeaders([]);setFileName('');setMapping(emptyMapping());setDirty(false);setError('');setNotice('');resetReview();if(fileInput.current)fileInput.current.value='';};
  const editMapping=()=>{setBatch(null);setSelectedBatchId('');setDirty(true);setError('');setNotice('');resetReview();};
  const abandonMissingValidation=async()=>{if(!validationMissing||unknownType==='catalog.import.apply')return;await apiClient.discardUnconfirmedValidation(unknownId);pending.current=null;setUnknownId('');setUnknownType('');setValidationMissing(false);clearSource();};
  const downloadErrors=async()=>{if(!batch)return;try{downloadCsv(batch.fileName.replace(/\.csv$/i,'')+'-errors.csv',await apiClient.getProductImportErrorsCsv(batch.id));}catch(cause){setError(cause instanceof Error?cause.message:'The error report could not be downloaded.');}};
  const template=()=>{
    const digits=currencyMinorDigits(session.tenant.currency),scale=10n**BigInt(digits),bps=session.tenant.taxPolicy?.defaultRateBps??0;
    const values=['EXAMPLE-001','Example item - replace or delete this row','each',minorToMoneyInput(125n*scale,session.tenant.currency),minorToMoneyInput(90n*scale,session.tenant.currency),`${Math.floor(bps/100)}.${String(bps%100).padStart(2,'0')}`,session.tenant.currency,'','General','5','0',''];
    downloadCsv('mazao-product-import-template.csv',fields.map(field=>field.key).join(',')+'\r\n'+values.map(safeCsvCell).join(',')+'\r\n');
  };
  const visibleRows=batch?.rows.filter(row=>rowFilter==='ALL'||row.action===rowFilter)??[];
  const date=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:zone});

  if(!canImport)return <p role="alert" className="p-6 text-amber-200">Your account cannot import products. Ask an administrator with catalog access.</p>;
  return <section className="min-h-full space-y-5 p-4 pb-24 text-zinc-100 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs tracking-[.18em] text-blue-300">CATALOG IMPORT · {session.outlet.name}</p><h1 ref={heading} tabIndex={-1} className="mt-2 text-2xl font-bold focus-visible:outline-blue-400">Import products from CSV</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Upload, match columns, validate every row, then apply an error-free review. Validation stages a server record; item and stock changes happen only after confirmation.</p></div><button type="button" className={button} disabled={busy} onClick={()=>{if(!dirty||window.confirm('Discard the CSV and column mapping that have not been validated?'))onBack();}}><ArrowLeft size={16}/>Back to stock</button></header>
    <div className="rounded-xl border border-blue-900 bg-blue-950/20 p-4 text-sm leading-6 text-blue-100"><strong>{session.tenant.currency}</strong> · {currencyMinorDigits(session.tenant.currency)} decimal place{currencyMinorDigits(session.tenant.currency)===1?'':'s'} · prices and costs per base unit · tax added to prices. New items use the configured default tax when its column is omitted. Expand packs into individual base units before upload. Existing unit, currency and stock balances cannot be overwritten.{session.tenant.taxPolicy&&<p className="mt-2">Tax policy: {session.tenant.taxPolicy.label} ? default {Math.floor(session.tenant.taxPolicy.defaultRateBps/100)}.{String(session.tenant.taxPolicy.defaultRateBps%100).padStart(2,'0')}% ? {session.tenant.taxPolicy.calculation}</p>}</div>
    {recoveryError&&<div role="alert" className="rounded-xl border border-rose-800 p-4 text-sm text-rose-200">{recoveryError} New import actions are blocked until recovery can be checked.<button type="button" className={button+' ml-2 mt-2'} onClick={()=>void loadRecovery()}>Retry recovery check</button></div>}
    {error&&<div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/20 p-4 text-sm text-rose-200">{error}{selectedBatchId&&!batch&&<button type="button" className={button+' ml-2'} onClick={()=>void loadBatch(selectedBatchId)}>Retry batch details</button>}</div>}
    {notice&&<p role="status" aria-live="polite" className="rounded-xl border border-blue-800 bg-blue-950/20 p-4 text-sm leading-6 text-blue-200">{notice}</p>}
    {unknownId&&<section aria-label="Import command recovery" className="rounded-xl border border-amber-800 bg-amber-950/20 p-4"><h2 className="text-lg font-semibold">Check import command status</h2><p className="mt-2 text-sm text-amber-100">An outcome is still unknown. New validations and imports stay locked until it is resolved.</p><p className="mt-2 break-all font-mono text-xs text-zinc-400">Command {unknownId}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>void checkStatus()}>Check command status</button>{pending.current&&<button type="button" className={button} disabled={busy} onClick={()=>pending.current&&void send(pending.current)}>Retry original command</button>}{validationMissing&&<button type="button" className={button} disabled={busy} onClick={()=>void abandonMissingValidation()}>Choose CSV again</button>}</div></section>}
    {loading&&<p role="status" className="p-4 text-zinc-300">Loading saved server validation…</p>}
    {readingFile&&<p role="status" className="p-4 text-zinc-300">Reading UTF-8 CSV…</p>}
    {!batch&&<section className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5" aria-labelledby={id+'-upload'}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id={id+'-upload'} className="text-lg font-semibold">Choose your CSV</h2><p className="mt-1 text-sm text-zinc-400">UTF-8 CSV · up to 512 KiB, 1,000 rows and 50 columns.</p></div><button type="button" className={button} onClick={template}><Download size={16}/>Download CSV template</button></div><p className="text-xs leading-5 text-zinc-400">The template contains an explicitly labelled example row. Replace or remove it before uploading your business data.</p><label className="block text-sm text-zinc-300">Product CSV file<input ref={fileInput} type="file" accept=".csv,text/csv" disabled={blockEdits} onChange={event=>void selectFile(event.target.files?.[0])} className="mt-2 block min-h-11 w-full rounded-lg border border-zinc-700 p-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white disabled:opacity-50"/></label>{fileName&&<p className="break-all text-sm text-zinc-300">Selected: {fileName}</p>}<label className="block max-w-lg text-sm text-zinc-300">Import mode<select disabled={blockEdits} value={mode} onChange={event=>{setMode(event.target.value as ProductImportMode);setDirty(true);resetReview();}} className="mt-2 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3"><option value="CREATE_ONLY">Create new items only</option><option value="UPSERT">Create new or update matching SKUs</option></select></label>{headers.length>0&&<><CsvColumnMapper headers={headers} fields={fields} mapping={mapping} disabled={blockEdits} onChange={(field,column)=>{setMapping(previous=>({...previous,[field]:column}));setDirty(true);resetReview();}}/><div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4"><p className="text-sm text-zinc-400">Omitted columns preserve existing items in update mode.</p><button type="button" className={button+' border-blue-600 bg-blue-600 font-semibold text-white'} disabled={blockEdits||!csv||!mapping.sku} onClick={validate}><Upload size={16}/>{busy?'Validating…':'Validate all rows'}</button></div></>}</section>}
    {batch&&<>
      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5" aria-label="Server import review"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{batch.status==='APPLIED'?'Import applied':batch.status==='INVALID'?'Fix CSV errors before importing':'Review validated import'}</h2><p className="mt-1 break-all text-sm text-zinc-400">{batch.fileName} · {batch.mode==='UPSERT'?'Create or update':'Create only'} · {date(batch.createdAt)}</p>{batch.appliedAt&&<p className="mt-1 text-sm text-emerald-300">Applied {date(batch.appliedAt)}</p>}</div>{batch.status==='APPLIED'&&<CheckCircle2 className="text-emerald-300" size={24}/>}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Rows validated" value={String(batch.summary.rowCount)}/><Metric label="New / updated / unchanged" value={`${batch.summary.createCount} / ${batch.summary.updateCount} / ${batch.summary.unchangedCount}`}/><Metric label="Errors / warnings" value={`${batch.summary.errorCount} / ${batch.summary.warningCount}`}/><Metric label="Opening stock value" value={formatMinorMoneyText(batch.summary.openingValueMinor,batch.currency)}/></div><p className="text-xs leading-5 text-zinc-400">Validated policy: {batch.currency} · default tax {batch.defaultTaxRateBps/100}% added to prices. {batch.summary.openingQuantityLines} new-item opening stock line{batch.summary.openingQuantityLines===1?'':'s'}. Quantities are base units; the server computes exact carrying values and a balanced opening stock journal.</p><p className="break-all font-mono text-[11px] text-zinc-500">Source SHA-256: {batch.sourceHash} · business version {batch.businessVersion} · validation version {batch.version}</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={blockEdits} onClick={()=>{if(!dirty||window.confirm('Discard unvalidated changes?'))clearSource();}}>Choose another CSV</button><button type="button" className={button} disabled={blockEdits} onClick={editMapping}>Edit column mapping</button><button type="button" className={button} disabled={blockEdits} onClick={revalidate}><RefreshCw size={16}/>Revalidate against current records</button>{batch.errors.length>0&&<button type="button" className={button} disabled={busy} onClick={()=>void downloadErrors()}><Download size={16}/>Download errors CSV</button>}</div>{stale&&<p role="alert" className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">This validation is stale. Revalidate against current records and review the new batch before applying.</p>}{batch.createdBy!==session.user.id&&batch.status!=='APPLIED'&&<p className="text-sm text-amber-200">Another operator created this review. Revalidate to create a review owned by your account.</p>}</section>
      {batch.errors.length>0&&<IssueList title="Validation errors" issues={batch.errors} total={batch.summary.errorCount} detail="Correct these values in your CSV, choose the corrected file, and validate again. No items or stock have changed."/>}
      {batch.warnings.length>0&&<IssueList title="Import warnings" issues={batch.warnings} total={batch.summary.warningCount} detail="Review every warning before confirming this import."/>}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Proposed changes</h2><label className="text-sm text-zinc-300">Show rows<select value={rowFilter} onChange={event=>{setRowFilter(event.target.value);setRowPage(0);}} className="ml-2 min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-2"><option value="ALL">All actions</option><option value="CREATE">Create</option><option value="UPDATE">Update</option><option value="UNCHANGED">Unchanged</option><option value="INVALID">Invalid</option></select></label></div><div className="mt-4 grid gap-3">{visibleRows.slice(rowPage*50,(rowPage+1)*50).map(row=><ImportRow key={row.rowNumber+'-'+row.sku} row={row}/>)}{visibleRows.length===0&&<p className="p-4 text-sm text-zinc-400">No rows match this filter.</p>}</div><Pagination page={rowPage} count={visibleRows.length} onChange={setRowPage}/></section>
      {batch.status!=='APPLIED'&&<section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5"><h2 className="text-lg font-semibold">Confirm the complete import</h2><p className="text-sm leading-6 text-zinc-400">All rows apply together. Any validation error or changed baseline blocks the complete import. Updates preserve existing stock and cannot change base units or currency.</p><label className="flex min-h-11 items-start gap-3 text-sm text-zinc-300"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-blue-500" checked={reviewed} disabled={blockEdits||batch.status!=='READY'||stale} onChange={event=>setReviewed(event.target.checked)}/><span>I reviewed every proposed change and opening stock value</span></label>{batch.summary.warningCount>0&&<label className="flex min-h-11 items-start gap-3 text-sm text-zinc-300"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-blue-500" checked={warningsAcknowledged} disabled={blockEdits||batch.status!=='READY'||stale} onChange={event=>setWarningsAcknowledged(event.target.checked)}/><span>I acknowledge all import warnings</span></label>}<div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4"><span className="text-sm text-zinc-400">{batch.summary.errorCount>0?'Apply is blocked until all errors are corrected.':'Reviewed confirmation is required.'}</span><button type="button" className={button+' border-blue-600 bg-blue-600 font-semibold text-white'} disabled={!canApply} onClick={apply}>{busy?'Applying…':'Apply reviewed import'}</button></div></section>}
    </>}
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Import history</h2><p className="mt-1 text-xs text-zinc-400">Latest 50 server validations</p></div><button type="button" className={button} disabled={busy||historyLoading} onClick={()=>void loadHistory()}><RefreshCw size={15}/>Refresh history</button></div>{historyError&&<p role="alert" className="mt-3 text-sm text-rose-300">{historyError}</p>}{historyLoading?<p role="status" className="py-5 text-zinc-400">Loading import history…</p>:history.length===0?<p className="py-5 text-sm text-zinc-400">No server import validations have been recorded.</p>:<div className="mt-3 space-y-2">{history.map(item=><article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 p-3"><div className="min-w-0"><h3 className="break-all text-sm font-semibold">{item.fileName}</h3><p className="mt-1 text-xs text-zinc-400">{item.status} · {item.summary.rowCount} rows · {item.summary.errorCount} errors · {date(item.createdAt)}</p></div><button type="button" className={button} disabled={blockEdits} aria-label={'Review import '+item.fileName} onClick={()=>{if(!dirty||window.confirm('Discard the CSV changes that have not been validated?'))void loadBatch(item.id);}}>Review import</button></article>)}</div>}</section>
  </section>;
}

function Metric({label,value}:{label:string;value:string}){return <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900 p-3"><p className="text-xs text-zinc-400">{label}</p><p className="mt-2 break-words font-semibold">{value}</p></div>;}
function Pagination({page,count,onChange}:{page:number;count:number;onChange:(page:number)=>void}) {
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-zinc-400">{count?`${page*50+1}–${Math.min((page+1)*50,count)} of ${count}`:'0 rows'}</p>{count>50&&<div className="flex gap-2"><button type="button" className={button} disabled={page===0} onClick={()=>onChange(page-1)}>Previous 50</button><button type="button" className={button} disabled={(page+1)*50>=count} onClick={()=>onChange(page+1)}>Next 50</button></div>}</div>;
}
function IssueList({title,issues,total,detail}:{title:string;issues:ProductImportIssue[];total:number;detail:string}) {
  const [page,setPage]=useState(0);
  useEffect(()=>setPage(0),[issues]);
  return <section className="rounded-2xl border border-amber-900 bg-zinc-950 p-4 sm:p-5"><h2 className="text-lg font-semibold">{title} ({total})</h2><p className="mt-1 text-sm leading-6 text-zinc-400">{detail}</p><div className="mt-4 space-y-3">{issues.slice(page*50,(page+1)*50).map((issue,index)=><article key={page*50+index} className="min-w-0 rounded-xl border border-zinc-800 p-3"><p className="text-sm font-semibold">Row {issue.row} · {fieldLabel(issue.field)}</p><p className="mt-1 break-words text-sm text-amber-200">{issue.message}</p><p className="mt-2 break-all font-mono text-xs text-zinc-400">{issue.code} · value: <span className="whitespace-pre-wrap">{issue.rawValue||'(empty)'}</span></p></article>)}</div><Pagination page={page} count={issues.length} onChange={setPage}/></section>;
}
function ImportRow({row}:{row:ProductImportRow}) {
  const item=row.normalized;
  return <article className="min-w-0 rounded-xl border border-zinc-800 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="break-all text-sm font-semibold">Row {row.rowNumber} · {row.sku||'Missing SKU'}</h3>{item&&<p className="mt-1 break-words text-sm text-zinc-300">{item.name} · base unit {item.baseUnit}</p>}</div><span className="rounded-md border border-zinc-700 px-2 py-1 text-xs">{row.action}</span></div>{item&&row.action!=='INVALID'&&<div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2"><p>Selling price {formatMinorMoneyText(BigInt(item.sellingPriceMinor),item.currency)} / {item.baseUnit}</p><p>Reference cost {formatMinorMoneyText(BigInt(item.costPriceMinor),item.currency)} / {item.baseUnit}</p><p>Tax {Math.floor(item.taxRateBps/100)}.{String(item.taxRateBps%100).padStart(2,'0')}% · {row.defaults.tax.replaceAll('_',' ').toLowerCase()}</p><p>Currency {item.currency} · {row.defaults.currency.replaceAll('_',' ').toLowerCase()}</p>{row.action==='CREATE'&&<><p>Opening quantity {item.openingQuantity} {item.baseUnit}</p><p>Opening value {formatMinorMoneyText(item.openingValueMinor,item.currency)}</p></>}</div>}{row.changes.length>0&&<dl className="mt-3 space-y-2 border-t border-zinc-800 pt-3">{row.changes.map(change=><div key={change.field} className="grid gap-1 text-xs sm:grid-cols-[150px_minmax(0,1fr)]"><dt className="text-zinc-400">{fieldLabel(change.field)}</dt><dd className="min-w-0 break-all text-zinc-300"><span className="text-zinc-500">{change.before??'(new)'}</span><span aria-label=" changes to "> → </span>{change.after}</dd></div>)}</dl>}</article>;
}
function changeLabel(field:string):string {
  const labels:Record<string,string>={sellingPriceMinor:'Selling price per base unit',costPriceMinor:'Reference cost per base unit',openingUnitCostMinor:'Opening cost per base unit',openingValueMinor:'Opening stock value',taxRateBps:'Tax rate (%)'};
  return labels[field]??fieldLabel(field);
}
function changeValue(field:string,value:string,row:ProductImportRow):string {
  if(row.action==='INVALID'||!row.normalized)return value;
  if(['sellingPriceMinor','costPriceMinor','openingUnitCostMinor','openingValueMinor'].includes(field)&&/^-?\d+$/.test(value)){
    try{return formatMinorMoneyText(value,row.normalized.currency);}catch{return value;}
  }
  if(field==='taxRateBps'&&/^\d+$/.test(value))return `${BigInt(value)/100n}.${(BigInt(value)%100n).toString().padStart(2,'0')}%`;
  return value;
}
