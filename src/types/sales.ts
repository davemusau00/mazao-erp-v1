import type { CatalogItemKind } from './catalog';
export interface SaleHistoryLine {
  lineId:string;productId:string;sku:string;name:string;quantity:string;unitPriceMinor:string;
  originalSubtotalMinor?:string;discountMinor?:string;discountReason?:string|null;
  costPriceMinor?:string;cogsMinor?:string;taxRateBps:number;subtotalMinor:string;taxMinor:string;refundedQuantity:string;itemKind?:CatalogItemKind;
}
export interface SaleHistoryOrder {
  id:string;orderNumber:string;timestamp:string;cashierName:string;currency:string;
  originalSubtotalMinor?:string;discountMinor?:string;subtotalMinor:number;taxMinor:number;totalMinor:number;paidMinor:number;
  amountDueMinor:number;customerName:string|null;refundedMinor:number;status:'completed'|'partially_refunded'|'refunded';
  paymentMethod:'cash'|'manual_mpesa'|'customer_credit';
  payments?:Array<{method:string;amountMinor:string;reference?:string|null}>;lines:SaleHistoryLine[];
}
export interface SaleHistory {orders:SaleHistoryOrder[];asOf?:string;nextAfter?:string|null}
export interface SaleHistoryQuery {q?:string;after?:string;asOf?:string;limit?:number}
