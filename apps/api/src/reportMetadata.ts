export type AccountClass='ASSET'|'LIABILITY'|'EQUITY'|'REVENUE'|'OTHER_INCOME'|'COST_OF_GOODS_SOLD'|'OTHER_OPERATING_COST';
export const REPORT_ACCOUNTS:Record<string,{name:string;classification:AccountClass}>={
  CASH_TILL:{name:'Cash in tills',classification:'ASSET'},
  MOBILE_MONEY_CONTROL:{name:'M-Pesa receipts awaiting reconciliation',classification:'ASSET'},
  BANK_CONTROL:{name:'Bank balance awaiting reconciliation',classification:'ASSET'},
  ACCOUNTS_PAYABLE:{name:'Supplier balances',classification:'LIABILITY'},
  ACCOUNTS_RECEIVABLE:{name:'Customer balances',classification:'ASSET'},
  INVENTORY:{name:'Inventory',classification:'ASSET'},
  VAT_PAYABLE:{name:'Tax payable',classification:'LIABILITY'},
  GOODS_RECEIVED_NOT_INVOICED:{name:'Goods received awaiting invoice',classification:'LIABILITY'},
  CASH_FLOAT_CLEARING:{name:'Opening float clearing',classification:'LIABILITY'},
  CASH_PAID_IN_CLEARING:{name:'Cash paid-in clearing',classification:'LIABILITY'},
  CASH_PAYOUT_CLEARING:{name:'Cash payout clearing',classification:'ASSET'},
  OPENING_BALANCE_CLEARING:{name:'Opening balance clearing',classification:'EQUITY'},
  SALES_REVENUE:{name:'Item sales revenue',classification:'REVENUE'},
  ROOM_REVENUE:{name:'Room revenue',classification:'REVENUE'},
  INVENTORY_COUNT_GAIN:{name:'Inventory count gains',classification:'OTHER_INCOME'},
  COST_OF_GOODS_SOLD:{name:'Cost of goods sold',classification:'COST_OF_GOODS_SOLD'},
  INVENTORY_COUNT_SHRINKAGE:{name:'Inventory count losses',classification:'OTHER_OPERATING_COST'},
  CASH_OVER_SHORT:{name:'Cash differences',classification:'OTHER_OPERATING_COST'},
  OPERATING_EXPENSE:{name:'Operating expenses',classification:'OTHER_OPERATING_COST'},
  RENT_EXPENSE:{name:'Rent',classification:'OTHER_OPERATING_COST'},
  UTILITIES_EXPENSE:{name:'Utilities',classification:'OTHER_OPERATING_COST'},
};
export function accountMetadata(code:string){return REPORT_ACCOUNTS[code]??{name:'Unclassified account',classification:null};}
const sourceNames:Record<string,string>={SALE:'Sale',SALE_COGS:'Sale cost',SALE_REFUND:'Sale return',SALE_REFUND_COGS:'Returned stock cost',
  CUSTOMER_REPAYMENT:'Customer collection',INVENTORY_RECEIPT:'Stock delivery',INVENTORY_COUNT:'Stock count',
  SHIFT_OPEN:'Opening float',SHIFT_CASH_PAID_IN:'Cash paid-in',SHIFT_CASH_PAYOUT:'Cash payout',SHIFT_CASH_VARIANCE:'Cash-up difference',
  ROOM_CHECKOUT:'Guest checkout',OPENING_PRODUCT_IMPORT:'Opening stock import',
  EXPENSE:'Operating expense',EXPENSE_REVERSAL:'Expense reversal',SUPPLIER_INVOICE:'Supplier invoice',SUPPLIER_INVOICE_REVERSAL:'Supplier invoice reversal',SUPPLIER_PAYMENT:'Supplier payment'};
export function reportSourceName(code:string){return sourceNames[code]??'Recorded adjustment';}
