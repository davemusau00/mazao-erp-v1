import {inReadSnapshot} from './db.js';
import {DomainError,type ApiSession} from './contracts.js';
import {requireFinanceView} from './financeReports.js';
import {accountMetadata,reportSourceName} from './reportMetadata.js';
import {readAccountLabels} from './accountCatalog.js';

type Document={kind:string;title:string;reference:string;receiptId?:string;fields:Array<{label:string;value:string}>;
  rows:Array<{label:string;quantity?:string;amountMinor:string;taxMinor?:string;discountMinor?:string}>};
/** Source documents deliberately use current-outlet authorization even for tenant-wide account totals. */
export async function getJournalSource(session:ApiSession,idValue:unknown){
  requireFinanceView(session);
  if(typeof idValue!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idValue))throw new DomainError('VALIDATION_FAILED','Choose a valid journal entry.');
  return inReadSnapshot(async client=>{
    const found=await client.query(`SELECT e.id,e.source_type,e.source_id,e.currency,e.posted_at,
      coalesce(e.effective_date,(e.posted_at AT TIME ZONE t.time_zone)::date)::text business_date
      FROM finance.journal_entries e JOIN core.tenants t ON t.id=e.tenant_id WHERE e.tenant_id=$1 AND e.id=$2`,[session.tenantId,idValue]);
    if(!found.rowCount)throw new DomainError('NOT_FOUND','The accounting entry was not found.',404);
    const entry=found.rows[0],source=entry.source_id;
    const params=[session.tenantId,session.outletId,source];
    let document:Document|null=null;
    if(entry.source_type==='EXPENSE'||entry.source_type==='EXPENSE_REVERSAL'){
      const reversal=entry.source_type==='EXPENSE_REVERSAL';
      const expense=await client.query(`SELECT e.id,e.description,e.payee,e.category,e.amount_minor::text,e.operator_name_snapshot,
        p.reference,p.payment_account,${reversal?'r.reason,r.effective_date::text':'e.effective_date::text,NULL::text reason'}
        FROM finance.expenses e JOIN finance.outgoing_payments p ON p.tenant_id=e.tenant_id AND p.id=e.payment_id
        ${reversal?'JOIN finance.expense_reversals r ON r.tenant_id=e.tenant_id AND r.expense_id=e.id':''}
        WHERE e.tenant_id=$1 AND e.outlet_id=$2 AND p.outlet_id=$2 AND ${reversal?'r.command_id':'e.command_id'}=$3`,params);
      if(expense.rowCount){const r=expense.rows[0];document={kind:reversal?'EXPENSE_REVERSAL':'EXPENSE',title:reversal?'Expense reversal':'Operating expense',reference:r.reference,
        fields:[{label:'Description',value:r.description},{label:'Category',value:accountMetadata(r.category).name},{label:'Payment account',value:accountMetadata(r.payment_account).name},{label:'Recorded by',value:r.operator_name_snapshot},{label:'Accounting date',value:r.effective_date},...(r.payee?[{label:'Payee',value:r.payee}]:[]),...(r.reason?[{label:'Reversal reason',value:r.reason}]:[])],rows:[{label:reversal?'Reversed expense':'Expense amount',amountMinor:r.amount_minor}]};}
    }else if(entry.source_type==='SUPPLIER_INVOICE'||entry.source_type==='SUPPLIER_INVOICE_REVERSAL'){
      const reversal=entry.source_type==='SUPPLIER_INVOICE_REVERSAL';
      const invoice=await client.query(`SELECT i.id,i.reference,i.supplier_name_snapshot,i.description,i.amount_minor::text,i.kind,i.due_date::text,i.invoice_date::text,
        ${reversal?'r.reason,r.effective_date::text':'NULL::text reason,i.invoice_date::text effective_date'}
        FROM finance.supplier_invoices i ${reversal?'JOIN finance.supplier_invoice_reversals r ON r.tenant_id=i.tenant_id AND r.invoice_id=i.id':''}
        WHERE i.tenant_id=$1 AND i.outlet_id=$2 AND ${reversal?'r.command_id':'i.command_id'}=$3`,params);
      if(invoice.rowCount){const r=invoice.rows[0];document={kind:reversal?'SUPPLIER_INVOICE_REVERSAL':'SUPPLIER_INVOICE',title:reversal?'Supplier invoice reversal':'Supplier invoice',reference:r.reference,
        fields:[{label:'Supplier',value:r.supplier_name_snapshot},{label:'Description',value:r.description},{label:'Invoice date',value:r.invoice_date},{label:'Due date',value:r.due_date},{label:'Accounting date',value:r.effective_date},{label:'Source',value:r.kind==='RECEIPT'?'Received stock':'Operating expense'},...(r.reason?[{label:'Reversal reason',value:r.reason}]:[])],rows:[{label:reversal?'Reversed invoice':'Invoice amount',amountMinor:r.amount_minor}]};}
    }else if(entry.source_type==='SUPPLIER_PAYMENT'){
      const paid=await client.query(`SELECT i.supplier_name_snapshot,i.reference invoice_reference,p.reference,p.payment_account,p.operator_name_snapshot,
        s.amount_minor::text,s.effective_date::text FROM finance.supplier_payments s
        JOIN finance.supplier_invoices i ON i.tenant_id=s.tenant_id AND i.id=s.invoice_id
        JOIN finance.outgoing_payments p ON p.tenant_id=s.tenant_id AND p.id=s.payment_id
        WHERE s.tenant_id=$1 AND i.outlet_id=$2 AND p.outlet_id=$2 AND s.command_id=$3`,params);
      if(paid.rowCount){const r=paid.rows[0];document={kind:'SUPPLIER_PAYMENT',title:'Supplier payment',reference:r.reference,fields:[{label:'Supplier',value:r.supplier_name_snapshot},{label:'Invoice',value:r.invoice_reference},{label:'Payment account',value:accountMetadata(r.payment_account).name},{label:'Recorded by',value:r.operator_name_snapshot},{label:'Accounting date',value:r.effective_date}],rows:[{label:'Amount paid toward invoice',amountMinor:r.amount_minor}]};}
    }else if(entry.source_type==='SALE'||entry.source_type==='SALE_COGS'){
      const sale=await client.query(`SELECT o.id,o.receipt_number,o.operator_name_snapshot,o.customer_name_snapshot,
        o.subtotal_minor::text,o.tax_minor::text,o.total_minor::text,
        coalesce((SELECT jsonb_agg(jsonb_build_object('label',l.name_snapshot,'quantity',l.quantity::text,'amountMinor',l.line_subtotal_minor::text,'taxMinor',l.line_tax_minor::text,'discountMinor',l.discount_minor::text) ORDER BY l.id)
          FROM commerce.order_lines l WHERE l.tenant_id=o.tenant_id AND l.outlet_id=o.outlet_id AND l.order_id=o.id),'[]'::jsonb) rows,
        coalesce((SELECT string_agg(CASE p.method WHEN 'MANUAL_MPESA' THEN 'M-Pesa (cashier confirmed)' ELSE 'Cash' END,', ' ORDER BY p.id)
          FROM commerce.payments p WHERE p.tenant_id=o.tenant_id AND p.outlet_id=o.outlet_id AND p.order_id=o.id AND p.status='CONFIRMED'),'Customer account') methods
        FROM commerce.orders o JOIN system.commands c ON c.tenant_id=o.tenant_id AND o.id::text=c.response->'value'->>'saleId'
        WHERE o.tenant_id=$1 AND o.outlet_id=$2 AND c.command_id=$3`,params);
      if(sale.rowCount){const r=sale.rows[0];document={kind:'SALE',title:'Sale receipt',reference:r.receipt_number,receiptId:r.id,
        fields:[{label:'Cashier',value:r.operator_name_snapshot},{label:'Payment',value:r.methods},...(r.customer_name_snapshot?[{label:'Customer',value:r.customer_name_snapshot}]:[])],rows:r.rows};}
    }else if(entry.source_type==='SALE_REFUND'||entry.source_type==='SALE_REFUND_COGS'){
      const refund=await client.query(`SELECT r.id,r.reason,o.receipt_number,
        coalesce((SELECT jsonb_agg(jsonb_build_object('label',l.name_snapshot,'quantity',rl.quantity::text,'amountMinor',rl.subtotal_minor::text,'taxMinor',rl.tax_minor::text,'discountMinor',rl.discount_minor::text) ORDER BY rl.id)
          FROM commerce.refund_lines rl JOIN commerce.order_lines l ON l.tenant_id=rl.tenant_id AND l.outlet_id=rl.outlet_id AND l.id=rl.order_line_id
          WHERE rl.tenant_id=r.tenant_id AND rl.outlet_id=r.outlet_id AND rl.refund_id=r.id),'[]'::jsonb) rows
        FROM commerce.refunds r JOIN commerce.orders o ON o.tenant_id=r.tenant_id AND o.outlet_id=r.outlet_id AND o.id=r.order_id
        WHERE r.tenant_id=$1 AND r.outlet_id=$2 AND r.command_id=$3`,params);
      if(refund.rowCount){const r=refund.rows[0];document={kind:'RETURN',title:'Cash return',reference:r.id.slice(0,8).toUpperCase(),fields:[{label:'Original receipt',value:r.receipt_number},{label:'Reason',value:r.reason}],rows:r.rows};}
    }else if(entry.source_type==='CUSTOMER_REPAYMENT'){
      const paid=await client.query(`SELECT r.id,r.reference,r.amount_minor::text,a.display_name FROM finance.customer_repayments r
        JOIN finance.customer_accounts a ON a.tenant_id=r.tenant_id AND a.id=r.customer_account_id
        WHERE r.tenant_id=$1 AND r.outlet_id=$2 AND r.command_id=$3`,params);
      if(paid.rowCount){const r=paid.rows[0];document={kind:'COLLECTION',title:'Customer cash collection',reference:r.reference??r.id.slice(0,8).toUpperCase(),fields:[{label:'Customer',value:r.display_name}],rows:[{label:'Cash collected',amountMinor:r.amount_minor}]};}
    }else if(entry.source_type==='SHIFT_CASH_PAID_IN'||entry.source_type==='SHIFT_CASH_PAYOUT'){
      const cash=await client.query('SELECT id,reason,reference,amount_minor::text FROM commerce.shift_cash_movements WHERE tenant_id=$1 AND outlet_id=$2 AND command_id=$3',params);
      if(cash.rowCount){const r=cash.rows[0];document={kind:'CASH_MOVEMENT',title:reportSourceName(entry.source_type),reference:r.reference??r.id.slice(0,8).toUpperCase(),fields:[{label:'Reason',value:r.reason}],rows:[{label:'Amount',amountMinor:r.amount_minor}]};}
    }else if(entry.source_type==='SHIFT_CASH_VARIANCE'){
      const cash=await client.query('SELECT id,operator_name_snapshot,business_date::text,expected_cash_minor::text,counted_cash_minor::text,variance_minor::text FROM commerce.shift_close_reports WHERE tenant_id=$1 AND outlet_id=$2 AND command_id=$3',params);
      if(cash.rowCount){const r=cash.rows[0];document={kind:'CASH_UP',title:'Cash-up difference',reference:r.id.slice(0,8).toUpperCase(),fields:[{label:'Operator',value:r.operator_name_snapshot},{label:'Business date',value:r.business_date}],rows:[{label:'Expected cash',amountMinor:r.expected_cash_minor},{label:'Counted cash',amountMinor:r.counted_cash_minor},{label:'Difference',amountMinor:r.variance_minor}]};}
    }else if(entry.source_type==='SHIFT_OPEN'){
      const shift=await client.query(`SELECT s.id,s.opening_float_minor::text FROM commerce.shifts s JOIN system.commands c
        ON c.tenant_id=s.tenant_id AND s.id::text=c.response->'value'->>'shiftId'
        WHERE s.tenant_id=$1 AND s.outlet_id=$2 AND c.command_id=$3`,params);
      if(shift.rowCount){const r=shift.rows[0];document={kind:'OPENING_FLOAT',title:'Opening float',reference:r.id.slice(0,8).toUpperCase(),fields:[],rows:[{label:'Cash added as opening float',amountMinor:r.opening_float_minor}]};}
    }else if(entry.source_type==='ROOM_CHECKOUT'){
      const guest=await client.query(`SELECT f.id,s.guest_name,sum(e.amount_minor)::text amount_minor FROM hospitality.folio_entries e
        JOIN hospitality.folios f ON f.tenant_id=e.tenant_id AND f.outlet_id=e.outlet_id AND f.id=e.folio_id
        JOIN hospitality.stays s ON s.tenant_id=f.tenant_id AND s.outlet_id=f.outlet_id AND s.id=f.stay_id
        WHERE e.tenant_id=$1 AND e.outlet_id=$2 AND e.command_id=$3 AND e.entry_type='CASH_PAYMENT' GROUP BY f.id,s.guest_name`,params);
      if(guest.rowCount){const r=guest.rows[0];document={kind:'ROOM_CHECKOUT',title:'Guest checkout',reference:r.id.slice(0,8).toUpperCase(),fields:[{label:'Guest',value:r.guest_name}],rows:[{label:'Cash collected including tax',amountMinor:r.amount_minor}]};}
    }else if(entry.source_type==='OPENING_PRODUCT_IMPORT'){
      const batch=await client.query('SELECT id,file_name,applied_at,validation_report FROM catalog.product_import_batches WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',params);
      if(batch.rowCount){const r=batch.rows[0];document={kind:'OPENING_IMPORT',title:'Opening stock import',reference:r.id.slice(0,8).toUpperCase(),fields:[{label:'File',value:r.file_name}],rows:[{label:'Opening stock value',amountMinor:String(r.validation_report.summary.openingValueMinor)}]};}
    }else if(entry.source_type==='INVENTORY_RECEIPT'||entry.source_type==='INVENTORY_COUNT'){
      const moves=await client.query(`SELECT m.document_reference,m.quantity_delta::text,m.value_minor::text,p.name FROM inventory.movements m
        JOIN catalog.products p ON p.tenant_id=m.tenant_id AND p.outlet_id=m.outlet_id AND p.id=m.product_id
        WHERE m.tenant_id=$1 AND m.outlet_id=$2 AND m.command_id=$3 ORDER BY m.id LIMIT 201`,params);
      if(moves.rowCount){
        if(moves.rows.length>200)throw new DomainError('SOURCE_TOO_LARGE','This document has more than 200 stock lines. Review its stock movement history; no lines were omitted from this response.',413);
        document={kind:'STOCK_MOVEMENT',title:reportSourceName(entry.source_type),reference:moves.rows[0].document_reference??source.slice(0,8).toUpperCase(),
          fields:[{label:'Item names',value:'Current item names; quantities and values are the recorded movements.'}],rows:moves.rows.map(r=>({label:r.name,quantity:r.quantity_delta,amountMinor:r.value_minor}))};
      }
    }
    if(!document)throw new DomainError('SOURCE_UNAVAILABLE','This document is not available in the selected outlet. Choose its outlet or review the accounting lines.',404);
    const lines=await client.query('SELECT id,account_code,debit_minor::text,credit_minor::text FROM finance.journal_lines WHERE tenant_id=$1 AND journal_entry_id=$2 ORDER BY id',[session.tenantId,entry.id]);
    const catalog=await readAccountLabels(client,session.tenantId);
    return {journalEntryId:entry.id,sourceType:entry.source_type,sourceName:reportSourceName(entry.source_type),currency:entry.currency,postedAt:entry.posted_at,businessDate:entry.business_date,document,
      accountCatalogVersion:catalog.version,lines:lines.rows.map(row=>({id:row.id,accountCode:row.account_code,accountName:catalog.labels.get(row.account_code)??accountMetadata(row.account_code).name,debitMinor:row.debit_minor,creditMinor:row.credit_minor}))};
  });
}
