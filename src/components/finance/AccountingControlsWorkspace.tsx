import React, { useEffect, useRef, useState } from 'react';
import { apiClient, type BackendCommand } from '../../services/apiClient';
import type { AccountingArea, AccountingControls, AccountingRecordKind, AccountingRecordMap, AccountingStatementLine } from '../../types/accounting';
import { moneyInputToMinor, minorToMoneyInput, formatMinorMoneyText } from '../../utils/money';
import { operationLabel } from '../../utils/presentation';
import { ResponsiveDialog } from '../common/ResponsiveDialog';

type Action = 'expense'|'expense-reverse'|'expense-reclassify'|'supplier'|'invoice'|'invoice-pay'|'invoice-reverse'|'statement'|'period'|'period-transition';
type Target = {id:string;version?:number;status?:string;amountMinor?:string;title?:string};
type Field = {key:string;label:string;type?:'date'|'money'|'textarea';options?:Array<{value:string;label:string}>;optional?:boolean;help?:string};
const button='min-h-11 rounded-lg border border-zinc-700 px-3 text-sm disabled:opacity-50';
const input='mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100';
const titles:Record<Action,string>={expense:'Record paid expense','expense-reverse':'Correct an expense','expense-reclassify':'Correct expense category',supplier:'Add supplier',invoice:'Record supplier bill','invoice-pay':'Record supplier payment','invoice-reverse':'Reverse unpaid bill',statement:'Add incoming M-Pesa statement',period:'Create accounting period','period-transition':'Change accounting period'};
const commandTypes:Record<Action,string>={expense:'finance.expense.record','expense-reverse':'finance.expense.reverse','expense-reclassify':'finance.expense.reclassify',supplier:'finance.supplier.create',invoice:'finance.supplier.invoice','invoice-pay':'finance.supplier.payment','invoice-reverse':'finance.supplier.invoice.reverse',statement:'finance.mpesa.statement.record',period:'finance.period.create','period-transition':'finance.period.transition'};

function useRecords<K extends AccountingRecordKind>(kind:K,revision:number) {
  const [rows,setRows]=useState<Array<AccountingRecordMap[K]>>([]),[next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const controller=useRef<AbortController|null>(null),mounted=useRef(true);
  const load=async(more=false)=>{
    controller.current?.abort();const current=new AbortController();controller.current=current;setBusy(true);setError('');
    try{const result=await apiClient.listAccountingRecords(kind,more&&next?{after:next}:{},current.signal);if(mounted.current&&!current.signal.aborted){setRows(previous=>more?[...previous,...result.records]:result.records);setNext(result.pageInfo.nextCursor);}}
    catch(cause){if(mounted.current&&!current.signal.aborted)setError(cause instanceof Error?cause.message:'These records could not be loaded. Try again.');}
    finally{if(mounted.current&&!current.signal.aborted)setBusy(false);}
  };
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;controller.current?.abort();};},[kind,revision]);
  return{rows,next,busy,error,load};
}

export function AccountingControlsWorkspace({initialArea='overview'}:{initialArea?:AccountingArea}) {
  const session=apiClient.getSession()!;
  const [tab,setTab]=useState<AccountingArea>(initialArea);
  const [revision,setRevision]=useState(0),[controls,setControls]=useState<AccountingControls|null>(null),[controlsError,setControlsError]=useState(''),[controlsBusy,setControlsBusy]=useState(true);
  const [action,setAction]=useState<Action|null>(null),[target,setTarget]=useState<Target|null>(null),[values,setValues]=useState<Record<string,string>>({}),[confirmed,setConfirmed]=useState(false);
  const [notice,setNotice]=useState(''),[sending,setSending]=useState(false),[unknown,setUnknown]=useState<BackendCommand|null>(null),[recoveryReady,setRecoveryReady]=useState(false);
  const [matching,setMatching]=useState<AccountingStatementLine|null>(null),[candidates,setCandidates]=useState<AccountingRecordMap['mpesa-payments'][]>([]),[finding,setFinding]=useState(false);
  const inFlight=useRef(false),mounted=useRef(true),paymentLookup=useRef<AbortController|null>(null);
  const suppliers=useRecords('suppliers',revision),receipts=useRecords('receipts',revision);
  const currency=controls?.currency??session.tenant.currency;
  const money=(minor:string)=>formatMinorMoneyText(minor,currency);
  const today=controls?.businessDate??new Intl.DateTimeFormat('en-CA',{timeZone:session.tenant.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const canManage=controls?.permissions.manage===true, canClose=controls?.permissions.close===true;
  useEffect(()=>{
    const controller=new AbortController();setControlsBusy(true);setControlsError('');
    void apiClient.getAccountingControls(controller.signal).then(result=>{if(!controller.signal.aborted)setControls(result);}).catch(cause=>{if(!controller.signal.aborted)setControlsError(cause instanceof Error?cause.message:'Account checks could not be loaded.');}).finally(()=>{if(!controller.signal.aborted)setControlsBusy(false);});
    return()=>controller.abort();
  },[revision]);
  useEffect(()=>{
    mounted.current=true;
    void apiClient.listRecoverableCommands(session.tenant.id).then(records=>{if(!mounted.current)return;const record=records.find(row=>row.command.type.startsWith('finance.')&&row.command.deviceId===session.deviceId);if(record){setUnknown(record.command);setNotice('An accounting action needs review. Check its status before recording another action.');}setRecoveryReady(true);}).catch(()=>{if(mounted.current)setNotice('Saved accounting actions could not be checked. Enable browser storage and reopen Money.');});
    return()=>{mounted.current=false;paymentLookup.current?.abort();};
  },[session.tenant.id,session.deviceId]);
  const locked=sending||!!unknown||!recoveryReady;
  const open=(next:Action,row:Target|null=null)=>{
    if(locked)return;
    setAction(next);setTarget(row);setConfirmed(false);setNotice('');
    setValues({effectiveDate:today,invoiceDate:today,dueDate:today,from:today,to:today,category:'OPERATING_EXPENSE',paymentAccount:'MOBILE_MONEY_CONTROL',kind:'EXPENSE',amount:row?.amountMinor?minorToMoneyInput(row.amountMinor,currency):'',status:row?.status==='OPEN'?'CLOSING':'CLOSED'});
  };
  const fields:Field[]=action==='supplier'?[{key:'name',label:'Supplier name'},{key:'phone',label:'Phone',optional:true}]
    :action==='period'?[{key:'from',label:'Period starts',type:'date'},{key:'to',label:'Period ends',type:'date'}]
    :action==='period-transition'?[{key:'status',label:'Next state',options:(target?.status==='OPEN'?[{value:'CLOSING',label:'Begin closing'}]:[{value:'CLOSED',label:'Complete close'},{value:'OPEN',label:'Reopen for review'}])},{key:'reason',label:'Reason',type:'textarea'}]
    :action==='expense-reclassify'?[{key:'effectiveDate',label:'Correction date',type:'date'},{key:'category',label:'Correct category',options:controls?.categories.map(row=>({value:row.code,label:row.label}))??[]},{key:'reason',label:'Reason for category correction',type:'textarea'}]
    :action==='expense-reverse'||action==='invoice-reverse'?[{key:'effectiveDate',label:'Correction date',type:'date'},{key:'reason',label:'Reason',type:'textarea'}]
    :action==='statement'?[{key:'reference',label:'Statement reference'},{key:'from',label:'From',type:'date'},{key:'to',label:'Through',type:'date'},{key:'transactions',label:'Incoming transactions',type:'textarea',help:'Paste one transaction per line: reference,date,amount. Example: ABC12345,2026-10-18,197.20. Amounts use the currency shown, without thousands separators. A header row Reference,Date,Amount is optional.'}]
    :action==='invoice'?[{key:'supplierId',label:'Supplier',options:suppliers.rows.map(row=>({value:row.id,label:row.name}))},{key:'kind',label:'Bill covers',options:[{value:'EXPENSE',label:'Unpaid operating expense'},{value:'RECEIPT',label:'Previously received stock'}]},...(values.kind==='RECEIPT'?[{key:'receiptCommandId',label:'Stock delivery',options:receipts.rows.map(row=>({value:row.id,label:`${row.reference??'Delivery'} · ${row.outletName} · ${money(row.amountMinor)}`}))}]:[{key:'category',label:'Category',options:controls?.categories.map(row=>({value:row.code,label:row.label}))??[]}]),{key:'reference',label:'Supplier bill reference'},{key:'invoiceDate',label:'Invoice date',type:'date'},{key:'dueDate',label:'Due date',type:'date'},{key:'amount',label:`Bill amount (${currency})`,type:'money'},{key:'description',label:'Description',type:'textarea'}]
    :action==='expense'?[{key:'effectiveDate',label:'Expense date',type:'date'},{key:'amount',label:`Amount paid (${currency})`,type:'money'},{key:'category',label:'Category',options:controls?.categories.map(row=>({value:row.code,label:row.label}))??[]},{key:'description',label:'What was paid for?',type:'textarea'},{key:'payee',label:'Paid to',optional:true},{key:'paymentAccount',label:'Paid from',options:controls?.paymentAccounts.map(row=>({value:row.code,label:row.label}))??[]},{key:'reference',label:'Payment transaction reference'}]
    :action==='invoice-pay'?[{key:'effectiveDate',label:'Payment date',type:'date'},{key:'amount',label:`Amount paid (${currency})`,type:'money'},{key:'paymentAccount',label:'Paid from',options:controls?.paymentAccounts.map(row=>({value:row.code,label:row.label}))??[]},{key:'reference',label:'Payment transaction reference'}]:[];
  const payload=():Record<string,unknown>=>{
    const trimmed=(key:string)=>values[key]?.trim()??'';
    if(action==='supplier')return{name:trimmed('name'),...(trimmed('phone')?{phone:trimmed('phone')}:{})};
    if(action==='period')return{from:values.from,to:values.to};
    if(action==='period-transition')return{periodId:target!.id,status:values.status,reason:trimmed('reason')};
    if(action==='expense-reclassify')return{expenseId:target!.id,effectiveDate:values.effectiveDate,category:values.category,reason:trimmed('reason')};
    if(action==='expense-reverse'||action==='invoice-reverse')return{[action==='expense-reverse'?'expenseId':'invoiceId']:target!.id,effectiveDate:values.effectiveDate,reason:trimmed('reason')};
    if(action==='statement'){
      const text=trimmed('transactions').replace(/^\uFEFF/,'');
      const rows=text.split(/\r?\n/).filter(row=>row.trim()).filter((row,index)=>index!==0||!/^reference\s*,\s*date\s*,\s*amount$/i.test(row.trim()));
      if(rows.length<1||rows.length>2000)throw new Error('Enter between 1 and 2,000 incoming transactions.');
      const lines=rows.map((row,index)=>{const cells=row.split(',').map(cell=>cell.trim());if(cells.length!==3)throw new Error(`Transaction ${index+1} needs reference,date,amount.`);return{reference:cells[0].toUpperCase(),occurredOn:cells[1],amountMinor:moneyInputToMinor(cells[2],currency)};});
      return{reference:trimmed('reference'),from:values.from,to:values.to,currency,lines};
    }
    if(action==='invoice')return{supplierId:values.supplierId,reference:trimmed('reference'),invoiceDate:values.invoiceDate,dueDate:values.dueDate,amountMinor:moneyInputToMinor(values.amount??'',currency),currency,description:trimmed('description'),kind:values.kind,...(values.kind==='RECEIPT'?{receiptCommandId:values.receiptCommandId}:{category:values.category})};
    return{...(action==='invoice-pay'?{invoiceId:target!.id}:{category:values.category,description:trimmed('description'),...(trimmed('payee')?{payee:trimmed('payee')}:{})}),effectiveDate:values.effectiveDate,amountMinor:moneyInputToMinor(values.amount??'',currency),currency,paymentAccount:values.paymentAccount,reference:trimmed('reference'),manuallyConfirmed:confirmed};
  };
  const acknowledge=(result:{status?:unknown;message?:unknown})=>{
    if(!mounted.current)return;
    if(result.status==='CONFIRMED'){setUnknown(null);setAction(null);setMatching(null);setNotice('Action recorded. Updated totals and records are loading.');setRevision(value=>value+1);}
    else if(result.status==='REJECTED'||result.status==='CONFLICT'){setUnknown(null);setNotice(typeof result.message==='string'?result.message:'The action was not completed. Review the details.');}
    else setNotice('This action has not been confirmed. Check its status before repeating it.');
  };
  const send=async(command:BackendCommand)=>{
    if(inFlight.current)return;inFlight.current=true;setSending(true);setUnknown(command);setNotice('');
    try{acknowledge(await apiClient.submitCommand(command));}
    catch(cause){if(mounted.current){if((cause as{code?:string}).code==='COMMAND_NOT_SENT')setUnknown(null);setNotice(cause instanceof Error?cause.message:'We could not confirm this action. Check its status.');}}
    finally{inFlight.current=false;if(mounted.current)setSending(false);}
  };
  const submit=(event:React.FormEvent)=>{
    event.preventDefault();if(!action||locked)return;
    try{const expectedVersions:Record<string,number>={};if(action==='period-transition')expectedVersions[`period:${target!.id}`]=target!.version!;if(action==='invoice-pay'||action==='invoice-reverse')expectedVersions[`invoice:${target!.id}`]=target!.version!;if(action==='expense-reclassify'||action==='expense-reverse')expectedVersions[`expense:${target!.id}`]=target!.version!;
      void send({protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type:commandTypes[action],occurredAt:new Date().toISOString(),expectedVersions,payload:payload()});
    }catch(cause){setNotice(cause instanceof Error?cause.message:'Review the required details.');}
  };
  const recover=async()=>{
    if(!unknown||inFlight.current)return;inFlight.current=true;setSending(true);const command=unknown;
    try{try{acknowledge((await apiClient.checkCommandStatus(command.commandId)).response);}catch(cause){if((cause as{status?:number}).status!==404)throw cause;acknowledge(await apiClient.submitCommand(command));}}
    catch(cause){if(mounted.current)setNotice(cause instanceof Error?cause.message:'Status could not be checked. Try again.');}
    finally{inFlight.current=false;if(mounted.current)setSending(false);}
  };
  const findPayment=async(line:AccountingStatementLine)=>{
    paymentLookup.current?.abort();const controller=new AbortController();paymentLookup.current=controller;
    setMatching(line);setFinding(true);setCandidates([]);setNotice('');
    try{const result=await apiClient.listAccountingRecords('mpesa-payments',{reference:line.reference},controller.signal);if(mounted.current&&!controller.signal.aborted)setCandidates(result.records);}
    catch(cause){if(mounted.current&&!controller.signal.aborted)setNotice(cause instanceof Error?cause.message:'Recorded payments could not be loaded.');}
    finally{if(mounted.current&&!controller.signal.aborted)setFinding(false);}
  };
  const match=(paymentId:string)=>{if(!matching||locked)return;void send({protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type:'finance.mpesa.statement.match',occurredAt:new Date().toISOString(),expectedVersions:{},payload:{lineId:matching.id,paymentId}});};
  const paymentConfirmation=action==='expense'||action==='invoice-pay';
  return <section className="space-y-4 p-4 pb-24 text-zinc-100 sm:p-6">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-semibold">Accounting and reconciliation</h1><p className="mt-1 text-sm text-zinc-400">{session.tenant.name} · all outlets · {currency} · {controls?.timeZone??session.tenant.timeZone}</p></div><button type="button" disabled={controlsBusy||sending} onClick={()=>setRevision(value=>value+1)} className={button}>Refresh accounts</button></header>
    <nav aria-label="Accounting area" className="flex flex-wrap gap-2">{([['overview','Account checks'],['expenses','Expenses'],['suppliers','Supplier bills'],['mpesa','M-Pesa matching'],['periods','Periods']] as const).map(([id,label])=><button key={id} type="button" onClick={()=>setTab(id)} aria-pressed={tab===id} className={`${button} ${tab===id?'border-blue-500 bg-blue-950':''}`}>{label}</button>)}</nav>
    {!recoveryReady&&<p role="status" className="text-amber-300">Checking saved accounting actions…</p>}
    {notice&&<div role={unknown?'alert':'status'} className="rounded-lg border border-blue-800 p-3 text-sm">{notice}{unknown&&<button type="button" disabled={sending} onClick={()=>void recover()} className="ml-3 min-h-11 underline">Check action status</button>}</div>}
    {unknown&&<p className="text-sm text-amber-200">{operationLabel(unknown.type)} needs review. New accounting actions are unavailable until its status is known.</p>}
    {controlsError&&<p role="alert" className="text-rose-300">{controlsError}<button type="button" onClick={()=>setRevision(value=>value+1)} className="ml-2 min-h-11 underline">Try again</button></p>}
    {controlsBusy&&<p role="status" className="text-sm text-zinc-400">{controls?'Refreshing account checks… Earlier results remain visible.':'Loading account checks…'}</p>}
    {tab==='overview'&&controls&&<><div className="grid gap-3 sm:grid-cols-3">{([['receivables','Customer balances'],['inventory','Inventory value'],['payables','Supplier balances']] as const).map(([key,label])=>{const check=controls.controls[key];return <article key={key} className="rounded-xl border border-zinc-800 p-4"><h2 className="font-medium">{label}</h2><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><dt>Accounting balance</dt><dd>{money(check.ledgerMinor)}</dd></div><div className="flex justify-between"><dt>Detailed records</dt><dd>{money(check.subledgerMinor)}</dd></div><div className="flex justify-between"><dt>Difference</dt><dd className={check.balanced?'text-emerald-300':'text-rose-300'}>{money(check.differenceMinor)} · {check.balanced?'Agrees':'Needs review'}</dd></div></dl></article>;})}</div><Coverage controls={controls}/><RecordPanel kind="payments" revision={revision} currency={currency}/></>}
    {tab==='expenses'&&<><button type="button" disabled={!canManage||locked} onClick={()=>open('expense')} className={button}>Record paid expense</button><p className="text-sm text-zinc-400">Record operating, rent or utilities payments already made by bank or M-Pesa. Linked category corrections and reversals preserve the original record. Stock purchases, supplier bill payments and till cash movements have separate workflows. This does not send money.</p><RecordPanel kind="expenses" revision={revision} currency={currency} actions={row=>canManage&&!row.reversal?<div className="flex flex-wrap gap-2"><button type="button" disabled={locked} onClick={()=>open('expense-reclassify',{id:row.id,version:row.version,title:row.description})} className={button}>Correct category</button><button type="button" disabled={locked} onClick={()=>open('expense-reverse',{id:row.id,version:row.version,title:row.description})} className={button}>Correct expense</button></div>:null}/></>}
    {tab==='suppliers'&&<><div className="flex flex-wrap gap-2"><button type="button" disabled={!canManage||locked} onClick={()=>open('supplier')} className={button}>Add supplier</button><button type="button" disabled={!canManage||locked} onClick={()=>open('invoice')} className={button}>Record supplier bill</button></div><p className="text-sm text-zinc-400">Record unpaid expense bills or match a bill to the full value of one existing stock delivery. Record partial bank or M-Pesa payments already made against the bill. Unpaid bills can be reversed. Purchase orders, partial delivery matching and supplier credits are unavailable; this does not send money.</p><RecordPanel kind="invoices" revision={revision} currency={currency} actions={row=>canManage&&row.status==='OPEN'?<div className="flex flex-wrap gap-2">{BigInt(row.remainingMinor)>0n&&<button type="button" disabled={locked} onClick={()=>open('invoice-pay',{id:row.id,version:row.version,amountMinor:row.remainingMinor,title:`${row.supplierName} · ${row.reference}`})} className={button}>Record payment</button>}{row.paidMinor==='0'&&<button type="button" disabled={locked} onClick={()=>open('invoice-reverse',{id:row.id,version:row.version,title:row.reference})} className={button}>Reverse unpaid bill</button>}</div>:null}/><RecordPanel kind="suppliers" revision={revision} currency={currency}/></>}
    {tab==='mpesa'&&<><button type="button" disabled={!canManage||locked} onClick={()=>open('statement')} className={button}>Add incoming statement</button>{controls&&<p className="text-sm text-zinc-300">Recorded receipts {money(controls.incomingMpesa.recordedMinor)} · matched {money(controls.incomingMpesa.matchedMinor)} · awaiting match {money(controls.incomingMpesa.unmatchedMinor)}. Statement transactions awaiting match: {controls.incomingMpesa.unmatchedStatementCount}.</p>}<p className="text-sm text-zinc-400">This matches incoming cashier-confirmed M-Pesa receipts only. Statements accept 1 to 2,000 transactions over up to 367 days. Matching does not move money, verify with the provider, reconcile outgoing payments or prove statement completeness.</p><RecordPanel kind="statement-lines" revision={revision} currency={currency} actions={row=>canManage&&!row.paymentId?<button type="button" disabled={locked} onClick={()=>void findPayment(row)} className={button}>Find recorded payment</button>:null}/></>}
    {tab==='periods'&&<><button type="button" disabled={!canClose||locked} onClick={()=>open('period')} className={button}>Create accounting period</button><p className="text-sm text-zinc-400">Periods cover up to 367 days and cannot overlap. Closing or closed dates block ordinary posting. Complete close requires balanced account checks, matched incoming M-Pesa evidence and resolved stock exceptions. A closed period cannot be reopened; corrections need an open date. Creating or changing periods requires financial close access.</p><RecordPanel kind="periods" revision={revision} currency={currency} actions={row=>canClose&&row.status!=='CLOSED'?<button type="button" disabled={locked} onClick={()=>open('period-transition',{id:row.id,version:row.version,status:row.status,title:`${row.from} – ${row.to}`})} className={button}>{row.status==='OPEN'?'Begin closing':'Review close'}</button>:null}/></>}
    <ResponsiveDialog isOpen={!!action} closeDisabled={locked} onClose={()=>{if(!locked)setAction(null);}} title={action?titles[action]:''} subtitle={target?.title??currency}>
      <form onSubmit={submit} className="space-y-3">{paymentConfirmation&&<p className="text-sm text-amber-200">This records a payment already made. It does not send money.</p>}{(action==='expense-reverse'||action==='invoice-reverse')&&<p className="text-sm text-amber-200">This adds a linked accounting correction and keeps the original record. It does not return money.</p>}
        {fields.map(field=><label key={field.key} className="block text-sm">{field.label}{field.optional?' (optional)':''}{field.options?<select required={!field.optional} disabled={locked} value={values[field.key]??''} onChange={event=>setValues(previous=>({...previous,[field.key]:event.target.value}))} className={input}><option value="">Choose…</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:field.type==='textarea'?<textarea required={!field.optional} disabled={locked} value={values[field.key]??''} rows={field.key==='transactions'?7:3} maxLength={field.key==='transactions'?200000:500} onChange={event=>setValues(previous=>({...previous,[field.key]:event.target.value}))} className={`${input} py-2`}/>:<input required={!field.optional} disabled={locked} type={field.type==='date'?'date':'text'} inputMode={field.type==='money'?'decimal':undefined} maxLength={field.type==='money'?30:160} value={values[field.key]??''} onChange={event=>setValues(previous=>({...previous,[field.key]:event.target.value}))} className={input}/>} {field.help&&<span className="mt-1 block text-xs text-zinc-400">{field.help}</span>}</label>)}
        {action==='invoice'&&<div className="space-y-2 text-xs text-zinc-400">{suppliers.error&&<p role="alert">{suppliers.error}<button type="button" className="ml-2 underline" onClick={()=>void suppliers.load()}>Retry suppliers</button></p>}{suppliers.next&&<button type="button" disabled={suppliers.busy} onClick={()=>void suppliers.load(true)} className={button}>Load more suppliers</button>}{values.kind==='RECEIPT'&&<>{receipts.error&&<p role="alert">{receipts.error}<button type="button" className="ml-2 underline" onClick={()=>void receipts.load()}>Retry deliveries</button></p>}{receipts.next&&<button type="button" disabled={receipts.busy} onClick={()=>void receipts.load(true)} className={button}>Load more deliveries</button>}<p>A stock bill must match the full recorded delivery value. This moves the amount from goods awaiting invoice to the supplier balance; it does not receive stock again.</p></>}</div>}
        {paymentConfirmation&&<label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" required disabled={locked} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I have checked that this payment was made.</label>}
        {notice&&<p role={unknown?'alert':'status'} className="text-sm text-amber-200">{notice}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={locked} onClick={()=>setAction(null)} className={button}>Cancel</button>{unknown?<button type="button" disabled={sending} onClick={()=>void recover()} className={button}>Check action status</button>:<button type="submit" disabled={locked} className={`${button} bg-blue-600`}>{sending?'Recording…':'Record action'}</button>}</div>
      </form>
    </ResponsiveDialog>
    <ResponsiveDialog isOpen={!!matching} closeDisabled={locked} onClose={()=>{if(!locked)setMatching(null);}} title="Match incoming M-Pesa receipt" subtitle={matching?`${matching.reference} · ${money(matching.amountMinor)}`:''}>
      {finding?<p role="status">Finding recorded payments…</p>:candidates.length?candidates.map(payment=><article key={payment.id} className="space-y-2 rounded-lg border border-zinc-700 p-3"><p>{payment.reference} · {money(payment.amountMinor)} · {payment.outletName}</p><p className="text-sm text-zinc-400">Recorded by {payment.operatorName}. {payment.matched?'Already matched.':'Awaiting statement match.'}</p><button type="button" disabled={locked||payment.matched||payment.currency!==matching?.currency||payment.amountMinor!==matching?.amountMinor} onClick={()=>match(payment.id)} className={button}>Confirm match</button></article>):<p>No recorded M-Pesa receipt matches this reference. Check the statement details and the original receipt.</p>}
      {notice&&<p role={unknown?'alert':'status'} className="mt-3 text-sm text-amber-200">{notice}</p>}{unknown&&<button type="button" disabled={sending} onClick={()=>void recover()} className={button}>Check action status</button>}
    </ResponsiveDialog>
  </section>;
}

function Coverage({controls}:{controls:AccountingControls}){return <details className="rounded-xl border border-amber-900 p-4 text-sm"><summary className="min-h-11 cursor-pointer">Accounting coverage and items needing review</summary><p className="mt-2 text-zinc-400">These checks cover the recorded sources. They do not establish complete financial statements or bank reconciliation.</p><ul className="mt-2 list-inside list-disc text-zinc-300">{controls.coverage.exclusions.map(item=><li key={item}>{item}</li>)}</ul>{controls.coverage.negativeNoncashAccounts.map(row=><p key={row.accountCode} className="mt-2 text-amber-300">{row.accountCode==='BANK_CONTROL'?'Bank':'M-Pesa'} recorded balance is negative: {formatMinorMoneyText(row.balanceMinor,controls.currency)}. Review opening balances and missing transactions.</p>)}</details>;}

function RecordPanel<K extends AccountingRecordKind>({kind,revision,currency,actions}:{kind:K;revision:number;currency:string;actions?:(record:AccountingRecordMap[K])=>React.ReactNode}){
  const page=useRecords(kind,revision);
  const labels:Record<AccountingRecordKind,string>={expenses:'Recorded expenses',suppliers:'Suppliers',invoices:'Supplier bills',payments:'Recorded outgoing payments',periods:'Accounting periods',statements:'Incoming statements','statement-lines':'Statement transactions',receipts:'Stock deliveries','mpesa-payments':'Recorded M-Pesa receipts'};
  return <section className="rounded-xl border border-zinc-800 p-4"><h2 className="font-semibold">{labels[kind]}</h2>{page.busy&&<p role="status" className="mt-3 text-sm text-zinc-400">Loading records…</p>}{page.error&&<p role="alert" className="mt-3 text-sm text-rose-300">{page.error}<button type="button" onClick={()=>void page.load()} className="ml-2 min-h-11 underline">Try again</button></p>}{!page.busy&&!page.error&&!page.rows.length&&<p className="mt-3 text-sm text-zinc-400">No records yet.</p>}<div className="mt-3 divide-y divide-zinc-800">{page.rows.map(row=><article key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><RecordDescription kind={kind} row={row} currency={currency}/>{actions?.(row)}</article>)}</div>{page.next&&<button type="button" disabled={page.busy} onClick={()=>void page.load(true)} className={button}>Load more records</button>}</section>;
}
function RecordDescription({kind,row,currency}:{kind:AccountingRecordKind;row:AccountingRecordMap[AccountingRecordKind];currency:string}){
  const money=(value:string)=>formatMinorMoneyText(value,currency);
  if(kind==='expenses'){const r=row as AccountingRecordMap['expenses'];return <div><strong>{r.description}</strong><p className="mt-1 text-sm">{money(r.amountMinor)} · {r.effectiveDate} · {r.currentCategory.replaceAll('_',' ').toLowerCase()} · {r.payee??'Expense'} · {r.reference}</p><p className="text-xs text-zinc-400">Recorded by {r.operatorName}{r.reclassification?` · category corrected on ${r.reclassification.effectiveDate}: ${r.reclassification.reason}`:''}{r.reversal?` · corrected on ${r.reversal.effectiveDate}: ${r.reversal.reason}`:''}</p></div>;}
  if(kind==='invoices'){const r=row as AccountingRecordMap['invoices'];return <div><strong>{r.supplierName} · {r.reference}</strong><p className="mt-1 text-sm">{money(r.amountMinor)} · paid {money(r.paidMinor)} · outstanding {money(r.remainingMinor)}</p><p className="text-xs text-zinc-400">Invoice {r.invoiceDate} · due {r.dueDate} · {r.kind==='RECEIPT'?'Stock delivery bill':'Operating expense bill'} · {r.status==='REVERSED'?'Reversed':'Recorded'}</p></div>;}
  if(kind==='periods'){const r=row as AccountingRecordMap['periods'];return <div><strong>{r.from} – {r.to}</strong><p className="mt-1 text-sm">{r.status==='OPEN'?'Open':r.status==='CLOSING'?'Closing':'Closed'}</p><p className="text-xs text-zinc-400">{r.reason} · {r.operatorName}</p></div>;}
  if(kind==='statement-lines'){const r=row as AccountingRecordMap['statement-lines'];return <div><strong>{r.reference} · {money(r.amountMinor)}</strong><p className="mt-1 text-sm">{r.occurredOn} · statement {r.statementReference}</p><p className="text-xs text-zinc-400">{r.paymentId?'Matched to recorded receipt':'Awaiting match'}</p></div>;}
  if(kind==='suppliers'){const r=row as AccountingRecordMap['suppliers'];return <div><strong>{r.name}</strong><p className="text-sm text-zinc-400">{r.phone}</p></div>;}
  if(kind==='payments'){const r=row as AccountingRecordMap['payments'];return <div><strong>{r.description} · {money(r.amountMinor)}</strong><p className="mt-1 text-sm">{r.effectiveDate} · {r.reference} · {r.paymentAccount==='BANK_CONTROL'?'Bank':'M-Pesa'}</p><p className="text-xs text-zinc-400">Recorded by {r.operatorName} · {r.kind==='EXPENSE'?'Paid expense':'Supplier payment'}</p></div>;}
  return <p className="text-sm">Recorded business document</p>;
}
