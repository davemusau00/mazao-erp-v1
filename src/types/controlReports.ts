export interface CustomerBalanceReport {
  reportType:'CUSTOMER_BALANCES';scope:'TENANT';tenantName:string;currency:string;timeZone:string;asOf:string;generatedAt:string;
  total:string;nextAfter:string|null;limit:number;
  totals:{chargesMinor:string;collectionsMinor:string;outstandingMinor:string;ledgerBalanceMinor:string;differenceMinor:string;unallocatedCollectionsMinor:string;negativeChargeCount:string;
    age0To30Minor:string;age31To60Minor:string;age61To90Minor:string;ageOver90Minor:string};
  accounts:Array<{customerId:string;name:string;status:string;outstandingMinor:string;age0To30Minor:string;age31To60Minor:string;age61To90Minor:string;ageOver90Minor:string}>;
  coverage:{ageingBasis:'CHARGE_AGE_NOT_OVERDUE';missingDueDates:true;explanation:string;balanced:boolean};
}
export interface CustomerBalanceQuery {asOf:string;limit?:number;after?:string}
export interface InventoryValueReport {
  reportType:'INVENTORY_VALUE';scope:'OUTLET';tenantName:string;outletName:string;currency:string;generatedAt:string;total:string;nextAfter:string|null;limit:number;revision:string;
  outlet:{carryingValueMinor:string;movementMismatchCount:string};
  control:{scope:'TENANT';carryingValueMinor:string;ledgerValueMinor:string;differenceMinor:string;movementMismatchCount:string;missingBalanceCount:string;totalsAgree:boolean};
  items:Array<{productId:string;sku:string;name:string;unit:string;active:boolean;quantity:string;carryingValueMinor:string;movementQuantity:string;movementValueMinor:string;quantityDifference:string;valueDifferenceMinor:string}>;
  coverage:{valuationBasis:'RECORDED_CARRYING_VALUE';estimateProvenance:'NOT_RECORDED';explanation:string};
}
export interface InventoryValueQuery {limit?:number;after?:string;revision?:string}
