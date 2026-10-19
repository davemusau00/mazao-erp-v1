import {randomUUID} from 'node:crypto';
import {inReadSnapshot,pool} from './db.js';
import {DomainError,type ApiSession} from './contracts.js';
import {reportRange,requireOperationalAnalytics} from './operationalAnalyticsPolicy.js';
import {csvExportCell} from './csvParser.js';

type Query={from?:unknown;to?:unknown;limit?:unknown;after?:unknown;asOf?:unknown};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields=['originalSubtotalMinor','discountMinor','revenueMinor','taxMinor','refundSubtotalMinor','refundTaxMinor','refundDiscountMinor','netRevenueMinor','cogsMinor','verifiedCogsMinor','provisionalCogsMinor','cogsAdjustmentMinor','restockedCogsMinor','netCogsMinor','grossProfitMinor'] as const;

/** Return events are selected independently, including returns of older sales. */
const itemCte=`WITH item_events AS (
  SELECT l.product_id,l.sku_snapshot,l.name_snapshot,o.created_at occurred_at,l.id,
    l.quantity quantity,0::numeric returned_quantity,l.line_subtotal_minor+l.discount_minor original_subtotal_minor,
    l.discount_minor,l.line_subtotal_minor revenue_minor,l.line_tax_minor tax_minor,
    0::bigint refund_subtotal_minor,0::bigint refund_tax_minor,0::bigint refund_discount_minor,
    l.cogs_minor,0::bigint restocked_cogs_minor,l.provisional_cogs_minor,0::bigint cogs_adjustment_minor,o.id order_id
  FROM commerce.order_lines l JOIN commerce.orders o ON o.tenant_id=l.tenant_id AND o.outlet_id=l.outlet_id AND o.id=l.order_id
  WHERE l.tenant_id=$1 AND l.outlet_id=$2 AND o.created_at>=($3::date::timestamp AT TIME ZONE $5)
    AND o.created_at<(($4::date+1)::timestamp AT TIME ZONE $5) AND o.created_at<=$6::timestamptz
  UNION ALL
  SELECT l.product_id,l.sku_snapshot,l.name_snapshot,r.created_at,rl.id,
    0::numeric,rl.quantity,0,0,0,0,rl.subtotal_minor,rl.tax_minor,rl.discount_minor,0,
    CASE WHEN rl.restocked THEN rl.cogs_minor ELSE 0 END,0::bigint,0::bigint,NULL::uuid
  FROM commerce.refund_lines rl
  JOIN commerce.refunds r ON r.tenant_id=rl.tenant_id AND r.outlet_id=rl.outlet_id AND r.id=rl.refund_id
  JOIN commerce.order_lines l ON l.tenant_id=rl.tenant_id AND l.outlet_id=rl.outlet_id AND l.id=rl.order_line_id
  WHERE rl.tenant_id=$1 AND rl.outlet_id=$2 AND r.created_at>=($3::date::timestamp AT TIME ZONE $5)
    AND r.created_at<(($4::date+1)::timestamp AT TIME ZONE $5) AND r.created_at<=$6::timestamptz
  UNION ALL
  SELECT s.product_id,l.sku_snapshot,l.name_snapshot,r.created_at,r.id,
    0::numeric,0::numeric,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,
    0::bigint,0::bigint,0::bigint,r.cogs_adjustment_minor,NULL::uuid
  FROM inventory.sale_shortfall_resolutions r
  JOIN inventory.sale_shortfalls s ON s.tenant_id=r.tenant_id AND s.outlet_id=r.outlet_id AND s.id=r.shortfall_id
  JOIN commerce.order_lines l ON l.tenant_id=s.tenant_id AND l.outlet_id=s.outlet_id AND l.id=s.order_line_id
  WHERE r.tenant_id=$1 AND r.outlet_id=$2 AND r.created_at>=($3::date::timestamp AT TIME ZONE $5)
    AND r.created_at<(($4::date+1)::timestamp AT TIME ZONE $5) AND r.created_at<=$6::timestamptz
), items AS (
  SELECT product_id,(array_agg(sku_snapshot ORDER BY occurred_at DESC,id DESC))[1] sku,
    (array_agg(name_snapshot ORDER BY occurred_at DESC,id DESC))[1] name,
    sum(quantity)::text quantity,sum(returned_quantity)::text returned_quantity,
    sum(original_subtotal_minor)::text original_subtotal_minor,sum(discount_minor)::text discount_minor,
    sum(revenue_minor)::text revenue_minor,sum(tax_minor)::text tax_minor,
    sum(refund_subtotal_minor)::text refund_subtotal_minor,sum(refund_tax_minor)::text refund_tax_minor,
    sum(refund_discount_minor)::text refund_discount_minor,
    (sum(revenue_minor)-sum(refund_subtotal_minor))::text net_revenue_minor,
    sum(cogs_minor)::text cogs_minor,(sum(cogs_minor)-sum(provisional_cogs_minor))::text verified_cogs_minor,
    sum(provisional_cogs_minor)::text provisional_cogs_minor,sum(cogs_adjustment_minor)::text cogs_adjustment_minor,
    sum(restocked_cogs_minor)::text restocked_cogs_minor,
    (sum(cogs_minor)-sum(restocked_cogs_minor)+sum(cogs_adjustment_minor))::text net_cogs_minor,
    (sum(revenue_minor)-sum(refund_subtotal_minor)-sum(cogs_minor)+sum(restocked_cogs_minor)-sum(cogs_adjustment_minor))::text gross_profit_minor,
    count(DISTINCT order_id)::text order_count
  FROM item_events GROUP BY product_id
)`;
const sqlField=(field:string)=>field.replace(/[A-Z]/g,letter=>'_'+letter.toLowerCase());
function rowDto(row:Record<string,string>){
  return {productId:row.product_id,sku:row.sku,name:row.name,unit:row.base_unit,quantity:row.quantity,returnedQuantity:row.returned_quantity,
    ...Object.fromEntries(fields.map(field=>[field,row[sqlField(field)]])),orderCount:row.order_count};
}
function input(session:ApiSession,query:Query){
  requireOperationalAnalytics(session);
  const range=reportRange(query.from,query.to);
  const limit=query.limit===undefined?100:Number(query.limit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new DomainError('VALIDATION_FAILED','Choose between 1 and 200 items per page.');
  if(query.after!==undefined&&(typeof query.after!=='string'||!uuid.test(query.after)))throw new DomainError('VALIDATION_FAILED','The item page reference is invalid.');
  let asOf:string|undefined;
  if(query.asOf!==undefined){
    if(typeof query.asOf!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(query.asOf)||!Number.isFinite(Date.parse(query.asOf))||Date.parse(query.asOf)>Date.now()+60_000)throw new DomainError('VALIDATION_FAILED','The report snapshot date is invalid.');
    asOf=new Date(query.asOf).toISOString();
  }
  return {...range,limit,after:query.after??null,asOf};
}
async function readItems(session:ApiSession,query:Query,exportAll=false){
  const parsed=input(session,query);
  return inReadSnapshot(async client=>{
    const stamp=await client.query<{now:Date}>('SELECT statement_timestamp() now');
    const generatedAt=stamp.rows[0].now.toISOString(),asOf=parsed.asOf??generatedAt;
    const params=[session.tenantId,session.outletId,parsed.from,parsed.to,session.timeZone,asOf];
    const summary=await client.query(`${itemCte} SELECT count(*)::text total,${fields.map(field=>`coalesce(sum(${sqlField(field)}::numeric),0)::text ${sqlField(field)}`).join(',')} FROM items`,params);
    const totals=Object.fromEntries(fields.map(field=>[field,summary.rows[0][sqlField(field)]]));
    const total=summary.rows[0].total as string;
    const exceptionCosts=await client.query(`SELECT COALESCE(sum(s.provisional_cogs_minor),0)::text initial_provisional_minor,
        COALESCE(sum(s.provisional_cogs_minor-COALESCE(r.released,0)),0)::text unresolved_provisional_minor
      FROM inventory.sale_shortfalls s JOIN commerce.orders o ON o.tenant_id=s.tenant_id AND o.outlet_id=s.outlet_id AND o.id=s.order_id
      LEFT JOIN LATERAL (SELECT sum(x.provisional_cogs_released_minor) released FROM inventory.sale_shortfall_resolutions x
        WHERE x.tenant_id=s.tenant_id AND x.outlet_id=s.outlet_id AND x.shortfall_id=s.id AND x.created_at<=$6::timestamptz) r ON true
      WHERE s.tenant_id=$1 AND s.outlet_id=$2 AND o.created_at>=($3::date::timestamp AT TIME ZONE $5)
        AND o.created_at<(($4::date+1)::timestamp AT TIME ZONE $5) AND o.created_at<=$6::timestamptz`,params);
    if(exportAll&&BigInt(total)>10_000n)throw new DomainError('EXPORT_TOO_LARGE','This export contains more than 10,000 items. Choose a shorter period; no partial file was produced.',413);
    const rows=await client.query(`${itemCte} SELECT i.*,p.base_unit FROM items i
      JOIN catalog.products p ON p.tenant_id=$1 AND p.outlet_id=$2 AND p.id=i.product_id
      WHERE ($7::uuid IS NULL OR i.product_id>$7::uuid) ORDER BY i.product_id LIMIT $8`,
      [...params,exportAll?null:parsed.after,exportAll?10_001:parsed.limit+1]);
    const hasMore=!exportAll&&rows.rows.length>parsed.limit;
    const page=hasMore?rows.rows.slice(0,parsed.limit):rows.rows;
    return {reportType:'ITEM_PERFORMANCE',scope:'OUTLET',tenantId:session.tenantId,outletId:session.outletId,outletName:session.outletName,
      currency:session.currency,timeZone:session.timeZone,from:parsed.from,to:parsed.to,generatedAt,asOf,total,limit:parsed.limit,
      nextAfter:hasMore?page[page.length-1].product_id:null,items:page.map(rowDto),totals,
      stockExceptionCostCoverage:{initialProvisionalCogsMinor:exceptionCosts.rows[0].initial_provisional_minor,
        unresolvedProvisionalCogsMinor:exceptionCosts.rows[0].unresolved_provisional_minor,asOf,
        marginIncludesUnresolvedEstimate:BigInt(exceptionCosts.rows[0].unresolved_provisional_minor)>0n},
      coverage:{completeTotals:true,namePolicy:'One row per item identity, named from the latest selected sale or returned sale snapshot.',
        returnsPolicy:'Returns use their own dates, including returns of sales from an earlier period. Revenue excludes tax. Only restocked returned cost reverses COGS.',
        costPolicy:'Sale-date COGS includes its provisional portion. Later resolution adjustments are shown on their recorded dates; unresolved provisional cost remains estimated and is not verified margin.',
        snapshotPolicy:'Each response uses one committed read snapshot and the same transaction timestamp cutoff for continuation. Transactions committed late can change a later page; refresh to reconcile. CSV totals and rows use one read snapshot.'}};
  });
}
export async function getItemReport(session:ApiSession,query:Query){return readItems(session,query);}
export async function getItemEvents(session:ApiSession,query:Query&{productId?:unknown}){
  if(typeof query.productId!=='string'||!uuid.test(query.productId))throw new DomainError('VALIDATION_FAILED','Choose a valid item.');
  // An event cursor is distinct from the product-identity cursor used by the item list.
  const parsed=input(session,{...query,after:undefined});
  let cursor:{time:string;id:string;kind:string}|null=null;
  if(query.after!==undefined){
    try{
      if(typeof query.after!=='string'||query.after.length>400)throw new Error();
      const value=JSON.parse(Buffer.from(query.after,'base64url').toString('utf8'));
      if(!value||typeof value.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.time)||!Number.isFinite(Date.parse(value.time))||typeof value.id!=='string'||!uuid.test(value.id)||!['SALE','RETURN'].includes(value.kind))throw new Error();
      cursor={time:value.time,id:value.id,kind:value.kind};
    }catch{throw new DomainError('VALIDATION_FAILED','The item detail page reference is invalid.');}
  }
  return inReadSnapshot(async client=>{
    const stamp=await client.query<{now:Date}>('SELECT statement_timestamp() now');
    const asOf=parsed.asOf??stamp.rows[0].now.toISOString();
    const cte=`WITH events AS (
      SELECT l.id event_id,'SALE'::text kind,o.created_at occurred_at,o.id receipt_id,o.receipt_number,l.name_snapshot,
        l.quantity::text quantity,l.line_subtotal_minor::text subtotal_minor,l.line_tax_minor::text tax_minor,l.discount_minor::text discount_minor,l.cogs_minor::text cogs_minor,false restocked
      FROM commerce.order_lines l JOIN commerce.orders o ON o.tenant_id=l.tenant_id AND o.outlet_id=l.outlet_id AND o.id=l.order_id
      WHERE l.tenant_id=$1 AND l.outlet_id=$2 AND l.product_id=$7 AND o.created_at>=($3::date::timestamp AT TIME ZONE $5)
        AND o.created_at<(($4::date+1)::timestamp AT TIME ZONE $5) AND o.created_at<=$6::timestamptz
      UNION ALL
      SELECT rl.id,'RETURN',r.created_at,o.id,o.receipt_number,l.name_snapshot,rl.quantity::text,rl.subtotal_minor::text,rl.tax_minor::text,rl.discount_minor::text,rl.cogs_minor::text,rl.restocked
      FROM commerce.refund_lines rl JOIN commerce.refunds r ON r.tenant_id=rl.tenant_id AND r.outlet_id=rl.outlet_id AND r.id=rl.refund_id
      JOIN commerce.order_lines l ON l.tenant_id=rl.tenant_id AND l.outlet_id=rl.outlet_id AND l.id=rl.order_line_id
      JOIN commerce.orders o ON o.tenant_id=l.tenant_id AND o.outlet_id=l.outlet_id AND o.id=l.order_id
      WHERE rl.tenant_id=$1 AND rl.outlet_id=$2 AND rl.product_id=$7 AND r.created_at>=($3::date::timestamp AT TIME ZONE $5)
        AND r.created_at<(($4::date+1)::timestamp AT TIME ZONE $5) AND r.created_at<=$6::timestamptz
    )`;
    const params=[session.tenantId,session.outletId,parsed.from,parsed.to,session.timeZone,asOf,query.productId];
    const count=await client.query(`${cte} SELECT count(*)::text total FROM events`,params);
    const page=await client.query(`${cte} SELECT *,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at FROM events
      WHERE ($8::timestamptz IS NULL OR (occurred_at,event_id,kind)<($8::timestamptz,$9::uuid,$10::text))
      ORDER BY occurred_at DESC,event_id DESC,kind DESC LIMIT $11`,[...params,cursor?.time??null,cursor?.id??null,cursor?.kind??null,parsed.limit+1]);
    const hasMore=page.rows.length>parsed.limit,rows=hasMore?page.rows.slice(0,parsed.limit):page.rows,last=rows.at(-1);
    return {scope:'OUTLET',productId:query.productId,from:parsed.from,to:parsed.to,asOf,currency:session.currency,timeZone:session.timeZone,total:count.rows[0].total,
      nextAfter:hasMore?Buffer.from(JSON.stringify({time:last.cursor_at,id:last.event_id,kind:last.kind})).toString('base64url'):null,
      events:rows.map(row=>({eventId:row.event_id,kind:row.kind,occurredAt:row.occurred_at,receiptId:row.receipt_id,receiptNumber:row.receipt_number,name:row.name_snapshot,
        quantity:row.quantity,subtotalMinor:row.subtotal_minor,taxMinor:row.tax_minor,discountMinor:row.discount_minor,cogsMinor:row.cogs_minor,restocked:row.restocked}))};
  });
}
export async function getItemReportCsv(session:ApiSession,query:Query){
  if(query.after!==undefined)throw new DomainError('VALIDATION_FAILED','Export the whole selected report without a page reference.');
  const report=await readItems(session,query,true);
  const columns=['productId','sku','name','unit','quantity','returnedQuantity',...fields,'orderCount'];
  const lines=[['Product reference','SKU','Item','Base unit','Quantity sold','Quantity returned',...fields,'Order count','From','To','Outlet','Currency','Business time zone','As of'].map(csvExportCell).join(',')];
  for(const item of report.items){
    const row=item as Record<string,string>;
    const numeric=new Set(['quantity','returnedQuantity','orderCount',...fields]);
    lines.push([...columns.map(column=>numeric.has(column)?`"${row[column]}"`:csvExportCell(row[column])),
      ...[report.from,report.to,report.outletName,report.currency,report.timeZone,report.asOf].map(csvExportCell)].join(','));
  }
  const csv='\uFEFF'+lines.join('\r\n')+'\r\n';
  if(Buffer.byteLength(csv,'utf8')>5*1024*1024)throw new DomainError('EXPORT_TOO_LARGE','This export exceeds 5 MiB. Choose a shorter period; no partial file was produced.',413);
  // Financial exports are recorded without copying customer details or complete report contents into the audit.
  await pool.query(`INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,event_type,payload)
    VALUES($1,$2,$3,$4,'REPORT_ITEMS_EXPORTED',$5::jsonb)`,[randomUUID(),session.tenantId,session.outletId,session.userId,
    JSON.stringify({from:report.from,to:report.to,asOf:report.asOf,rows:report.total,currency:report.currency})]);
  return csv;
}
