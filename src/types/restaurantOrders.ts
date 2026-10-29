import type { CatalogItemKind } from './catalog';
import type { HistoryPage } from './history';

export interface RestaurantOrderStation {id:string;name:string;kind:'KITCHEN'|'BAR'|'EXPO';version:number;charactersPerLine:number}
export interface RestaurantMenuItem {
  productId:string;productName:string;sku:string;itemKind:CatalogItemKind;baseUnit:string;currency:string;
  sellingPriceMinor:number;taxRateBps:number;productVersion:number;menuVersion:number;
  preparationLabel:string;instructions:string;stationIds:string[];stations:RestaurantOrderStation[];effectiveAvailable:boolean;
}
export interface RestaurantOrderSummary {
  id:string;tableId:string|null;tableName:string|null;serviceLabel:string;ownerId:string;ownerName:string;currency:string;
  status:'DRAFT'|'FIRED'|'CANCELLED';held:boolean;version:number;fireRevision:number;lineCount:number;draftLineCount:number;
  subtotalMinor:number;taxMinor:number;totalMinor:number;createdAt:string;updatedAt:string;
}
export interface RestaurantOrderLine {
  id:string;productId:string;sku:string;name:string;itemKind:CatalogItemKind;baseUnit:string;quantity:string;
  unitPriceMinor:number;taxRateBps:number;lineSubtotalMinor:number;lineTaxMinor:number;currency:string;
  productVersion:number;menuVersion:number;preparationLabel:string;preparationInstructions:string;
  modifiers:string[];instructions:string;stations:RestaurantOrderStation[];fireRevision:number|null;createdAt:string;
}
export interface RestaurantOrder extends RestaurantOrderSummary {instructions:string;lines:RestaurantOrderLine[]}
export interface RestaurantTicketLine {lineId:string;productId:string;sku:string;name:string;itemKind:CatalogItemKind;baseUnit:string;quantity:string;preparationLabel:string;preparationInstructions:string;modifiers:string[];instructions:string}
export interface RestaurantOrderTicket {
  id:string;orderId:string;batchId:string;fireRevision:number;type:'NEW'|'ADD_ON';stationId:string;stationName:string;
  stationKind:'KITCHEN'|'BAR'|'EXPO';createdAt:string;documentHash:string;
  snapshot:{schemaVersion:1;ticketId:string;batchId:string;orderId:string;fireRevision:number;type:'NEW'|'ADD_ON';
    station:{id:string;name:string;kind:'KITCHEN'|'BAR'|'EXPO';charactersPerLine:number};
    tableId:string|null;tableName:string|null;serviceLabel:string;orderInstructions:string;
    waiter:{id:string;name:string};firedBy:{id:string;name:string};deviceId:string;firedAt:string;originalBatchId:string|null;lines:RestaurantTicketLine[]};
}
export interface RestaurantOrderDetail {order:RestaurantOrder;tickets:RestaurantOrderTicket[];ticketPage:HistoryPage;currentQuotes:RestaurantMenuItem[]}
