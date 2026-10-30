import {inReadSnapshot} from './db.js';
import {DomainError,type ApiSession} from './contracts.js';
import {requireFinanceView,tenantReportTimeZone} from './financeReports.js';
import {reportRange} from './operationalAnalyticsPolicy.js';

function page(query:{limit?:unknown;after?:unknown}){
  const limit=query.limit===undefined?100:Number(query.limit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new DomainError('VALIDATION_FAILED','Choose between 1 and 200 records per page.');
  if(query.after!==undefined&&(typeof query.after!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.after)))throw new DomainError('VALIDATION_FAILED','The report page reference is invalid.');
  return{limit,after:query.after??null};
}
const arCte=`WITH charges AS (
  SELECT c.id,c.customer_account_id,c.amount_minor,(c.created_at AT TIME ZONE $3)::date charge_date FROM finance.customer_charges c
  WHERE c.tenant_id=$1 AND c.created_at<(($2::date+1)::timestamp AT TIME ZONE $3)
), repayments AS (
  SELECT id,amount_minor FROM finance.customer_repayments WHERE tenant_id=$1 AND created_at<(($2::date+1)::timestamp AT TIME ZONE $3)
), allocations AS (
  SELECT a.charge_id,sum(a.amount_minor) amount_minor FROM finance.customer_repayment_allocations a JOIN repayments r ON r.id=a.repayment_id
  WHERE a.tenant_id=$1 GROUP BY a.charge_id
), open_charges AS (
  SELECT c.*,c.amount_minor-coalesce(a.amount_minor,0) outstanding_minor,$2::date-c.charge_date age_days
  FROM charges c LEFT JOIN allocations a ON a.charge_id=c.id
), balances AS (
  SELECT customer_account_id,sum(outstanding_minor)::text outstanding_minor,
    sum(CASE WHEN age_days<=30 THEN outstanding_minor ELSE 0 END)::text age_0_30,
    sum(CASE WHEN age_days BETWEEN 31 AND 60 THEN outstanding_minor ELSE 0 END)::text age_31_60,
    sum(CASE WHEN age_days BETWEEN 61 AND 90 THEN outstanding_minor ELSE 0 END)::text age_61_90,
    sum(CASE WHEN age_days>90 THEN outstanding_minor ELSE 0 END)::text age_over_90
  FROM open_charges GROUP BY customer_account_id
)`;
export async function getCustomerBalanceReport(session:ApiSession,query:{asOf?:unknown;limit?:unknown;after?:unknown}){
  requireFinanceView(session);
  const{from:asOf}=reportRange(query.asOf,query.asOf),pagination=page(query);
  return inReadSnapshot(async client=>{
    const timeZone=await tenantReportTimeZone(client,session),params=[session.tenantId,asOf,timeZone];
    const summary=await client.query(`${arCte} SELECT
      (SELECT count(*)::text FROM balances WHERE outstanding_minor::numeric<>0) total,
      coalesce((SELECT sum(amount_minor)::text FROM charges),'0') charges_minor,
      coalesce((SELECT sum(amount_minor)::text FROM repayments),'0') collections_minor,
      coalesce((SELECT sum(outstanding_minor)::text FROM open_charges),'0') outstanding_minor,
      (coalesce((SELECT sum(amount_minor) FROM repayments),0)-coalesce((SELECT sum(amount_minor) FROM allocations),0))::text unallocated_minor,
      (SELECT count(*)::text FROM open_charges WHERE outstanding_minor<0) negative_charge_count,
      coalesce((SELECT sum(age_0_30::numeric)::text FROM balances),'0') age_0_30,
      coalesce((SELECT sum(age_31_60::numeric)::text FROM balances),'0') age_31_60,
      coalesce((SELECT sum(age_61_90::numeric)::text FROM balances),'0') age_61_90,
      coalesce((SELECT sum(age_over_90::numeric)::text FROM balances),'0') age_over_90,
      (SELECT coalesce(sum(l.debit_minor-l.credit_minor),0)::text FROM finance.journal_lines l
        JOIN finance.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.journal_entry_id
        WHERE l.tenant_id=$1 AND l.account_code='ACCOUNTS_RECEIVABLE' AND coalesce(e.effective_date,(e.posted_at AT TIME ZONE $3)::date)<=$2::date) ledger_minor,
      statement_timestamp() generated_at`,params);
    const rows=await client.query(`${arCte} SELECT a.id,a.display_name,a.status,b.* FROM balances b
      JOIN finance.customer_accounts a ON a.tenant_id=$1 AND a.id=b.customer_account_id
      WHERE b.outstanding_minor::numeric<>0 AND ($4::uuid IS NULL OR a.id>$4::uuid) ORDER BY a.id LIMIT $5`,[...params,pagination.after,pagination.limit+1]);
    const hasMore=rows.rows.length>pagination.limit,accounts=hasMore?rows.rows.slice(0,pagination.limit):rows.rows,r=summary.rows[0];
    const difference=(BigInt(r.ledger_minor)-BigInt(r.outstanding_minor)).toString();
    return{reportType:'CUSTOMER_BALANCES',scope:'TENANT',tenantName:session.tenantName,currency:session.currency,timeZone,asOf,generatedAt:r.generated_at,
      total:r.total,limit:pagination.limit,nextAfter:hasMore?accounts.at(-1).id:null,
      totals:{chargesMinor:r.charges_minor,collectionsMinor:r.collections_minor,outstandingMinor:r.outstanding_minor,ledgerBalanceMinor:r.ledger_minor,differenceMinor:difference,
        unallocatedCollectionsMinor:r.unallocated_minor,negativeChargeCount:r.negative_charge_count,age0To30Minor:r.age_0_30,age31To60Minor:r.age_31_60,age61To90Minor:r.age_61_90,ageOver90Minor:r.age_over_90},
      accounts:accounts.map(row=>({customerId:row.id,name:row.display_name,status:row.status,outstandingMinor:row.outstanding_minor,age0To30Minor:row.age_0_30,age31To60Minor:row.age_31_60,age61To90Minor:row.age_61_90,ageOver90Minor:row.age_over_90})),
      coverage:{ageingBasis:'CHARGE_AGE_NOT_OVERDUE',missingDueDates:true,balanced:difference==='0'&&r.unallocated_minor==='0'&&r.negative_charge_count==='0',
        explanation:'All business outlets. Open charge balances are compared with the receivables control account through the selected business date. Age bands measure time since charge, not overdue debt: payment due dates are not recorded. Customer names and status are current. Each page is a new read snapshot; refresh after concurrent activity.'}};
  });
}
const stockCte=`WITH movements AS (
  SELECT outlet_id,product_id,sum(quantity_delta) quantity,
    sum(CASE WHEN quantity_delta<0 THEN -value_minor ELSE value_minor END) value_minor
  FROM inventory.movements WHERE tenant_id=$1 GROUP BY outlet_id,product_id
), balances AS (
  SELECT b.*,p.item_kind,coalesce(m.quantity,0) movement_quantity,coalesce(m.value_minor,0) movement_value_minor,
    b.quantity-coalesce(m.quantity,0) quantity_difference,b.inventory_value_minor-coalesce(m.value_minor,0) value_difference
  FROM inventory.balances b JOIN catalog.products p ON p.tenant_id=b.tenant_id AND p.outlet_id=b.outlet_id AND p.id=b.product_id
  LEFT JOIN movements m ON m.outlet_id=b.outlet_id AND m.product_id=b.product_id WHERE b.tenant_id=$1
)`;
export async function getInventoryValueReport(session:ApiSession,query:{limit?:unknown;after?:unknown;revision?:unknown}={}){
  requireFinanceView(session);const pagination=page(query);
  if(query.revision!==undefined&&(typeof query.revision!=='string'||!/^[0-9a-f]{32}$/.test(query.revision)))throw new DomainError('VALIDATION_FAILED','The stock report revision is invalid.');
  if(pagination.after&&!query.revision)throw new DomainError('VALIDATION_FAILED','Refresh the stock report before continuing to another page.');
  return inReadSnapshot(async client=>{
    const totals=await client.query(`${stockCte} SELECT
      (SELECT count(*)::text FROM balances WHERE outlet_id=$2 AND item_kind='STOCKED_GOOD') total,
      coalesce((SELECT sum(inventory_value_minor)::text FROM balances WHERE outlet_id=$2),'0') outlet_value_minor,
      (SELECT count(*)::text FROM balances WHERE outlet_id=$2 AND (quantity_difference<>0 OR value_difference<>0)) outlet_mismatch_count,
      coalesce((SELECT sum(inventory_value_minor)::text FROM balances),'0') tenant_value_minor,
      (SELECT count(*)::text FROM balances WHERE quantity_difference<>0 OR value_difference<>0) tenant_mismatch_count,
      (SELECT count(*)::text FROM movements m LEFT JOIN inventory.balances b ON b.tenant_id=$1 AND b.outlet_id=m.outlet_id AND b.product_id=m.product_id WHERE b.product_id IS NULL AND (m.quantity<>0 OR m.value_minor<>0)) missing_balance_count,
      md5(concat_ws(':',(SELECT count(*) FROM balances),(SELECT coalesce(sum(version),0) FROM balances),
        (SELECT count(*) FROM catalog.products WHERE tenant_id=$1),(SELECT coalesce(sum(version),0) FROM catalog.products WHERE tenant_id=$1),
        (SELECT count(*) FROM inventory.movements WHERE tenant_id=$1),
        (SELECT coalesce(sum(l.debit_minor+l.credit_minor),0) FROM finance.journal_lines l WHERE l.tenant_id=$1 AND l.account_code='INVENTORY'))) revision,
      (SELECT coalesce(sum(l.debit_minor-l.credit_minor),0)::text FROM finance.journal_lines l
        JOIN finance.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.journal_entry_id
        WHERE l.tenant_id=$1 AND l.account_code='INVENTORY') ledger_value_minor,statement_timestamp() generated_at`,[session.tenantId,session.outletId]);
    if(query.revision!==undefined&&query.revision!==totals.rows[0].revision)throw new DomainError('REPORT_CHANGED','Stock changed while this report was being read. Refresh the report to review consistent pages.',409);
    const pageResult=await client.query(`${stockCte} SELECT p.id,p.sku,p.name,p.base_unit,p.active,b.quantity::text,b.inventory_value_minor::text,
      b.movement_quantity::text,b.movement_value_minor::text,b.quantity_difference::text,b.value_difference::text
      FROM balances b JOIN catalog.products p ON p.tenant_id=b.tenant_id AND p.outlet_id=b.outlet_id AND p.id=b.product_id
      WHERE b.outlet_id=$2 AND p.item_kind='STOCKED_GOOD' AND ($3::uuid IS NULL OR p.id>$3::uuid) ORDER BY p.id LIMIT $4`,[session.tenantId,session.outletId,pagination.after,pagination.limit+1]);
    const r=totals.rows[0],hasMore=pageResult.rows.length>pagination.limit,items=hasMore?pageResult.rows.slice(0,pagination.limit):pageResult.rows;
    const difference=(BigInt(r.ledger_value_minor)-BigInt(r.tenant_value_minor)).toString();
    return{reportType:'INVENTORY_VALUE',scope:'OUTLET',tenantName:session.tenantName,outletName:session.outletName,currency:session.currency,generatedAt:r.generated_at,
      total:r.total,limit:pagination.limit,nextAfter:hasMore?items.at(-1).id:null,revision:r.revision,
      outlet:{carryingValueMinor:r.outlet_value_minor,movementMismatchCount:r.outlet_mismatch_count},
      control:{scope:'TENANT',carryingValueMinor:r.tenant_value_minor,ledgerValueMinor:r.ledger_value_minor,differenceMinor:difference,movementMismatchCount:r.tenant_mismatch_count,missingBalanceCount:r.missing_balance_count,totalsAgree:difference==='0'&&r.tenant_mismatch_count==='0'&&r.missing_balance_count==='0'},
      items:items.map(row=>({productId:row.id,sku:row.sku,name:row.name,unit:row.base_unit,active:row.active,quantity:row.quantity,carryingValueMinor:row.inventory_value_minor,
        movementQuantity:row.movement_quantity,movementValueMinor:row.movement_value_minor,quantityDifference:row.quantity_difference,valueDifferenceMinor:row.value_difference})),
      coverage:{valuationBasis:'RECORDED_CARRYING_VALUE',estimateProvenance:'NOT_RECORDED',
        explanation:'Current recorded carrying value, including archived stock. Outlet quantities and values are checked against recorded movements. The inventory ledger control is business-wide because historical journals do not identify outlets reliably. Original estimated-cost provenance was not retained for every legacy balance; agreeing totals do not verify source cost evidence. Continuation checks the stock revision and requires a fresh report after concurrent changes.'}};
  });
}
