/** Money is an exact integer minor-unit string. Quantities remain decimal strings. */
export interface ItemReportRow {
  productId:string;sku:string;name:string;unit:string;quantity:string;returnedQuantity:string;
  originalSubtotalMinor:string;discountMinor:string;revenueMinor:string;taxMinor:string;
  refundSubtotalMinor:string;refundTaxMinor:string;refundDiscountMinor:string;
  netRevenueMinor:string;cogsMinor:string;restockedCogsMinor:string;netCogsMinor:string;grossProfitMinor:string;orderCount:string;
}
export type ItemReportTotals=Pick<ItemReportRow,'originalSubtotalMinor'|'discountMinor'|'revenueMinor'|'taxMinor'|'refundSubtotalMinor'|'refundTaxMinor'|'refundDiscountMinor'|'netRevenueMinor'|'cogsMinor'|'restockedCogsMinor'|'netCogsMinor'|'grossProfitMinor'>;
export interface BackendItemReport {
  reportType:'ITEM_PERFORMANCE';scope:'OUTLET';tenantId:string;outletId:string;outletName:string;
  currency:string;timeZone:string;from:string;to:string;generatedAt:string;asOf:string;
  total:string;limit:number;nextAfter:string|null;items:ItemReportRow[];totals:ItemReportTotals;
  coverage:{completeTotals:true;namePolicy:string;returnsPolicy:string;snapshotPolicy:string};
}
export interface ItemReportQuery {from:string;to:string;limit?:number;after?:string;asOf?:string}
export interface ItemEventsQuery extends ItemReportQuery {productId:string}
export interface BackendItemEvents {
  scope:'OUTLET';productId:string;from:string;to:string;asOf:string;currency:string;timeZone:string;total:string;nextAfter:string|null;
  events:Array<{eventId:string;kind:'SALE'|'RETURN';occurredAt:string;receiptId:string;receiptNumber:string;name:string;quantity:string;
    subtotalMinor:string;taxMinor:string;discountMinor:string;cogsMinor:string;restocked:boolean}>;
}
export interface BackendOperationalAnalytics {
  reportType:'OUTLET_OPERATIONAL_ANALYTICS';scope:'OUTLET';tenantId:string;outletId:string;outletName:string;currency:string;timeZone:string;
  from:string;to:string;generatedAt:string;
  totals:{grossSalesMinor:string;subtotalMinor:string;taxMinor:string;refundsMinor:string;cashCollectedMinor:string;accountCreditMinor:string;
    originalSubtotalMinor:string;discountMinor:string;refundSubtotalMinor:string;refundTaxMinor:string;netRevenueMinor:string;
    manualMpesaMinor:string;customerCollectionsMinor:string;cashRefundsMinor:string;cashPaidInMinor:string;cashPayoutMinor:string;
    netDrawerMovementMinor:string;roomCashCollectionsMinor:string;totalCashCollectionsMinor:string;netTaxMinor:string;netInvoiceMinor:string};
  daily:Array<{date:string;grossMinor:string;orderCount:string;refundMinor:string;refundCount:string}>;
  topProducts:Array<{productId:string;sku:string;name:string;quantity:string;revenueMinor:string;orderCount:string}>;
  coverage:{status:'CONFIRMED_SALES_AND_COLLECTIONS';orderCount:string;refundCount:string;cashPaymentCount:string;accountChargeCount:string;
    manualMpesaPaymentCount:string;customerCollectionCount:string;roomCashPaymentCount:string;productCount:string;topProductsComplete:boolean;
    scope:string;excludedMethods:string[];excludedSources:string[];drawerMovementExplanation:string};
}
export interface BackendJournalSource {
  journalEntryId:string;sourceType:string;sourceName:string;currency:string;postedAt:string;businessDate:string;
  document:{kind:string;title:string;reference:string;receiptId?:string;fields:Array<{label:string;value:string}>;
    rows:Array<{label:string;quantity?:string;amountMinor:string;taxMinor?:string;discountMinor?:string}>};
  lines:Array<{id:string;accountCode:string;accountName:string;debitMinor:string;creditMinor:string}>;
}
