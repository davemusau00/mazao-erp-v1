const names:Record<string,string>={SALE:'Sale',SALE_COGS:'Sale cost',SALE_REFUND:'Sale return',SALE_REFUND_COGS:'Returned stock cost',
  CUSTOMER_REPAYMENT:'Customer collection',INVENTORY_RECEIPT:'Stock delivery',INVENTORY_COUNT:'Stock count',SHIFT_OPEN:'Opening float',
  SHIFT_CASH_PAID_IN:'Cash paid-in',SHIFT_CASH_PAYOUT:'Cash payout',SHIFT_CASH_VARIANCE:'Cash-up difference',ROOM_CHECKOUT:'Guest checkout',
  OPENING_PRODUCT_IMPORT:'Opening stock import',EXPENSE:'Operating expense',EXPENSE_REVERSAL:'Expense reversal',
  SUPPLIER_INVOICE:'Supplier invoice',SUPPLIER_INVOICE_REVERSAL:'Supplier invoice reversal',SUPPLIER_PAYMENT:'Supplier payment'};
export function sourceLabel(code:string){return names[code]??'Recorded adjustment';}
export function downloadReportCsv(name:string,csv:string){
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
