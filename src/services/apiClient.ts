import {commandJournal,type RecoverableCommand} from './commandJournal';
import {importValidationJournal,type ImportValidationRecovery} from './importValidationJournal';

export interface BackendSession {
  user:{id:string;name:string;email:string;role:string;permissions:string[]};
  tenant:{id:string;name:string;currency:string;timeZone:string;capabilities:string[];taxPolicy?:{calculation:'exclusive';defaultRateBps:number;label:string;reviewed:boolean}};
  outlet:{id:string;name:string;timeZone?:string}; deviceId:string; csrfToken:string;
}
export interface BackendBusinessConfiguration {
  id:string;name:string;currency:string;timeZone:string;version:number;
  legalName:string;registrationNumber:string;taxRegistrationNumber:string;
  address:string;phone:string;email:string;website:string;logoUrl:string;
  receiptHeader:string;receiptFooter:string;
  taxPolicy:{calculation:'exclusive';defaultRateBps:number;label:string;reviewed:boolean};
}
export interface BackendOutletConfiguration {
  id:string;name:string;timeZone:string;version:number;address:string;phone:string;email:string;
  receiptHeader:string;receiptFooter:string;
}
export interface BackendConfiguration {
  business:BackendBusinessConfiguration;outlet:BackendOutletConfiguration;
  capabilities:string[];supportedCapabilities:string[];currencyLocked:boolean;
  readiness:{readyForFirstSale:boolean;checks:Array<{key:string;label:string;complete:boolean;detail:string}>};
}
export type BackendBusinessConfigurationInput=Omit<BackendBusinessConfiguration,'id'|'version'>;
export type BackendOutletConfigurationInput=Omit<BackendOutletConfiguration,'id'|'version'>;
export interface BackendProduct { id:string;sku:string;name:string;unit:string;currency:string;sellingPriceMinor:number;costPriceMinor?:number;inventoryValueMinor?:string;taxRateBps:number;quantity:string;version:number;productVersion?:number;barcode?:string|null;category?:string;reorderLevel?:string }
export type ProductImportField='sku'|'name'|'baseUnit'|'sellingPrice'|'costPrice'|'taxRatePercent'|'currency'|'barcode'|'category'|'reorderLevel'|'openingQuantity'|'openingUnitCost';
export type ProductImportMapping=Partial<Record<ProductImportField,string|null>>;
export type ProductImportMode='CREATE_ONLY'|'UPSERT';
export interface ProductImportIssue { row:number;field:string;code:string;rawValue:string;message:string }
export interface ProductImportNormalized {
  sku:string;name:string;baseUnit:string;currency:string;sellingPriceMinor:number;costPriceMinor:number;taxRateBps:number;
  barcode:string|null;category:string;reorderLevel:string;openingQuantity:string;openingUnitCostMinor:number|null;openingValueMinor:string;
}
export interface ProductImportRow {
  rowNumber:number;action:'CREATE'|'UPDATE'|'UNCHANGED'|'INVALID';sku:string;productId?:string;expectedProductVersion?:number;
  normalized?:ProductImportNormalized;changes:Array<{field:string;before:string|null;after:string}>;
  defaults:{currency:'TENANT_DEFAULT'|'EXISTING'|'CSV';tax:'BUSINESS_DEFAULT'|'EXISTING'|'CSV'};
}
export interface ProductImportSummary {
  rowCount:number;createCount:number;updateCount:number;unchangedCount:number;errorCount:number;warningCount:number;openingQuantityLines:number;openingValueMinor:string;
}
export interface ProductImportBatchSummary {
  id:string;fileName:string;mode:ProductImportMode;status:'READY'|'INVALID'|'APPLIED';version:number;sourceHash:string;sourceBytes:number;
  businessVersion:number;createdAt:string;createdBy:string;appliedAt:string|null;summary:ProductImportSummary;
}
export interface ProductImportBatch extends ProductImportBatchSummary {
  source:{csv:string;mapping:ProductImportMapping};errors:ProductImportIssue[];warnings:ProductImportIssue[];rows:ProductImportRow[];
}
export interface BackendShiftCashMovement { id:string;movementType:'PAID_IN'|'PAYOUT';amountMinor:number;reason:string;reference:string|null;actorName:string;createdAt:string }
export interface BackendShift { id:string;status:'OPEN';openingFloatMinor:number;cashSalesMinor:number;customerCollectionsMinor:number;cashRefundsMinor:number;cashPaidInMinor:number;cashPayoutMinor:number;expectedCashMinor:number;version:number;openedAt:string;cashMovements:BackendShiftCashMovement[] }
export interface BackendShiftCloseReport {id:string;shiftId:string;commandId:string;operatorId:string;operatorName:string;tenantName:string;outletName:string;timeZone:string;businessDate:string;currency:string;shiftVersion:number;openedAt:string;closedAt:string;openingFloatMinor:string;cashSalesMinor:string;customerCollectionsMinor:string;cashRefundsMinor:string;cashPaidInMinor:string;cashPayoutMinor:string;expectedCashMinor:string;countedCashMinor:string;varianceMinor:string}
export interface BackendCustomerAccount {id:string;name:string;phone:string;email:string|null;creditLimitMinor:string;balanceMinor:string;status:'ACTIVE'|'SUSPENDED';version:number;createdAt:string;updatedAt:string}
export interface BackendCustomerStatement {customer:BackendCustomerAccount;entries:Array<{id:string;type:'CHARGE'|'REPAYMENT';amountMinor:string;balanceAfterMinor:string;createdAt:string;reference:string|null;orderId:string|null;receiptNumber:string|null;allocations:Array<{amountMinor:string;receiptNumber:string;orderId:string}>}>;generatedAt:string;currency:string}
export interface BackendInventoryCountLine { productId:string;sku:string;name:string;unit:string;expectedQuantity:string;expectedBalanceVersion:number;countedQuantity:string|null;varianceReason:string|null;countedBy:string|null;countedAt:string|null }
export interface BackendInventoryCount { id:string;status:'OPEN'|'POSTED'|'CANCELLED';areaLabel:string|null;version:number;baselineAt:string;openedAt:string;openedBy:string;postedAt:string|null;postedBy:string|null;lineCount:number;countedLineCount:number;lines:BackendInventoryCountLine[] }
export interface BackendInventoryCountSummary { id:string;status:'OPEN'|'POSTED'|'CANCELLED';areaLabel:string|null;version:number;openedAt:string;openedBy:string;postedAt:string|null;postedBy:string|null;lineCount:number;countedLineCount:number }
export interface BackendRoom {id:string;roomNumber:string;roomType:string;nightlyRateMinor:number;taxRateBps:number;currency:string;status:'READY'|'OCCUPIED'|'DIRTY'|'MAINTENANCE';version:number;activeStay?:{id:string;guestName:string;checkInDate:string;checkOutDate:string;version:number}|null}
export interface BackendReservation {id:string;roomId:string;roomNumber:string;guestName:string;guestContact:string|null;checkInDate:string;checkOutDate:string;nightlyRateMinor:number;taxRateBps:number;currency:string;status:'CONFIRMED';version:number}
export interface BackendStay {id:string;roomId:string;roomNumber:string;roomVersion:number;guestName:string;guestContact:string|null;checkInDate:string;checkOutDate:string;checkedInAt:string;nightlyRateMinor:number;taxRateBps:number;currency:string;status:'CHECKED_IN';version:number;nights:number;estimatedSubtotalMinor:number;estimatedTaxMinor:number;estimatedTotalMinor:number}
export interface BackendCommand { protocolVersion:1;commandId:string;tenantId?:string;deviceId:string;type:string;occurredAt:string;expectedVersions:Record<string,number>;payload:Record<string,unknown> }
export interface BackendReportAccount { accountCode:string;debitMinor:string;creditMinor:string;netDebitMinor:string;netCreditMinor:string }
export interface BackendTrialBalance {
  reportType:'TRIAL_BALANCE';scope:'TENANT';tenantId:string;tenantName:string;currency:string;timeZone:string;asOf:string;generatedAt:string;latestJournalAt:string|null;
  coverage:{status:'POSTED_JOURNAL_ONLY';journalEntryCount:string;emptyJournalEntryCount:string;unbalancedJournalEntryCount:string;sourceTypes:Array<{sourceType:string;entryCount:string}>;explanation:string};
  totals:{debitMinor:string;creditMinor:string;differenceMinor:string;balanced:boolean};accounts:BackendReportAccount[];
}
export interface BackendPartialOperatingSummary {
  reportType:'PARTIAL_OPERATING_SUMMARY';scope:'TENANT';tenantId:string;tenantName:string;currency:string;timeZone:string;from:string;to:string;generatedAt:string;latestJournalAt:string|null;
  coverage:{status:'PARTIAL';journalEntryCount:string;emptyJournalEntryCount:string;unbalancedJournalEntryCount:string;sourceTypes:Array<{sourceType:string;entryCount:string}>;unknownAccountCodes:string[];omittedSources:string[];explanation:string};
  totals:{revenueMinor:string;costOfGoodsSoldMinor:string;grossProfitMinor:string;otherIncomeMinor:string;otherOperatingCostsMinor:string;partialOperatingResultMinor:string};
  lines:Array<{accountCode:string;section:string;amountMinor:string}>;
}
export interface BackendJournalLines {
  scope:'TENANT';accountCode:string;from?:string;to?:string;asOf?:string;limit:number;offset:number;total:string;nextOffset:number|null;
  entries:Array<{journalEntryId:string;sourceType:string;sourceId:string|null;currency:string;postedAt:string;createdBy:string|null;accountCode:string;debitMinor:string;creditMinor:string}>;
}
export interface BackendSaleReceipt {
  status:'CONFIRMED';fiscalDocumentStatus:'NOT_INTEGRATED';receiptId:string;receiptNumber:string;tenantName:string;outletName:string;timeZone:string;
  receiptProfile?:Partial<{legalName:string;registrationNumber:string;taxRegistrationNumber:string;address:string;phone:string;email:string;website:string;logoUrl:string;receiptHeader:string;receiptFooter:string;taxLabel:string;taxCalculation:'exclusive'}>;
  currency:string;createdAt:string;operatorName:string;saleStatus:string;
  lines:Array<{lineId:string;sku:string;name:string;quantity:string;unitPriceMinor:string;taxRateBps:number;subtotalMinor:string;taxMinor:string;totalMinor:string}>;
  payments:Array<{method:string;amountMinor:string;currency:string;status:string}>;
  subtotalMinor:string;taxMinor:string;totalMinor:string;amountPaidMinor:string;customerAccountCharge:{customerId:string;customerName:string;amountDueMinor:string}|null;cashTenderedMinor:string|null;changeMinor:string|null;
}

class ApiClient {
  private csrf=''; private session:BackendSession|null=null; private listeners=new Set<(session:BackendSession|null)=>void>();private recoveryListeners=new Set<(records:RecoverableCommand[])=>void>();
  private importRecoveryListeners=new Set<(records:ImportValidationRecovery[])=>void>();
  subscribe(listener:(session:BackendSession|null)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  subscribeRecovery(listener:(records:RecoverableCommand[])=>void){this.recoveryListeners.add(listener);return()=>{this.recoveryListeners.delete(listener)}}
  subscribeImportRecovery(listener:(records:ImportValidationRecovery[])=>void){this.importRecoveryListeners.add(listener);return()=>{this.importRecoveryListeners.delete(listener)}}
  getSession(){return this.session}
  private publish(session:BackendSession|null){this.session=session;this.listeners.forEach(listener=>listener(session))}
  private async request<T>(path:string,init:RequestInit={}):Promise<T>{
    const headers=new Headers(init.headers); if(init.body)headers.set('content-type','application/json');
    if(['POST','PUT','PATCH','DELETE'].includes(init.method??'GET')&&this.csrf)headers.set('x-csrf-token',this.csrf);
    let response:Response; try { response=await fetch(`/api/v1${path}`,{...init,headers,credentials:'include'}); }
    catch { throw new Error('Connection outcome is unknown. Keep the command ID and check its status before retrying.'); }
    const body=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===401&&path!=='/auth/login'){this.csrf='';this.publish(null)}
      throw Object.assign(new Error(body?.error?.message??`Request failed (${response.status}).`),{status:response.status,code:body?.error?.code,details:body?.error?.details});
    }
    return body as T;
  }
  async login(email:string,password:string){const s=await this.request<BackendSession>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});this.csrf=s.csrfToken;this.publish(s);return s}
  async restore(){try{const s=await this.request<BackendSession>('/auth/me');this.csrf=s.csrfToken;this.publish(s);return s}catch(error){if((error as {status?:number}).status!==401)throw error;this.csrf='';this.publish(null);return null}}
  async logout(){await this.request('/auth/logout',{method:'POST'});this.csrf='';this.publish(null)}
  getConfiguration(){return this.request<{configuration:BackendConfiguration}>('/configuration')}
  updateBusinessConfiguration(input:BackendBusinessConfigurationInput,version:number,commandId:string){
    const session=this.session;if(!session)throw new Error('Sign in before changing business settings.');
    return this.submitCommand({protocolVersion:1,commandId,tenantId:session.tenant.id,deviceId:session.deviceId,type:'configuration.business.update',occurredAt:new Date().toISOString(),expectedVersions:{['business:'+session.tenant.id]:version},payload:input});
  }
  updateOutletConfiguration(input:BackendOutletConfigurationInput,version:number,commandId:string){
    const session=this.session;if(!session)throw new Error('Sign in before changing outlet settings.');
    return this.submitCommand({protocolVersion:1,commandId,tenantId:session.tenant.id,deviceId:session.deviceId,type:'configuration.outlet.update',occurredAt:new Date().toISOString(),expectedVersions:{['outlet:'+session.outlet.id]:version},payload:input});
  }
  listCatalog(){return this.request<{items:BackendProduct[]}>('/catalog/items')}
  listProductImports(){return this.request<{batches:ProductImportBatchSummary[]}>('/catalog/imports')}
  getProductImport(batchId:string){return this.request<{batch:ProductImportBatch}>('/catalog/imports/'+encodeURIComponent(batchId))}
  async getProductImportErrorsCsv(batchId:string):Promise<string>{
    let response:Response;
    try{response=await fetch('/api/v1/catalog/imports/'+encodeURIComponent(batchId)+'/errors.csv',{credentials:'include'});}
    catch{throw new Error('The error report could not be downloaded. Check the connection and try again.');}
    if(!response.ok){const body=await response.json().catch(()=>({}));if(response.status===401){this.csrf='';this.publish(null);}throw new Error(body?.error?.message??'The error report could not be downloaded.');}
    return response.text();
  }
  listCustomerAccounts(){return this.request<{customers:BackendCustomerAccount[]}>('/customers')}
  getCustomerStatement(customerId:string){return this.request<BackendCustomerStatement>('/customers/'+encodeURIComponent(customerId)+'/statement')}
  listInventoryMovements(){return this.request<{movements:Array<{id:string;timestamp:string;sku:string;productName:string;type:'sale'|'restock'|'adjustment';quantity:string;balanceAfter:string;note:string;reference?:string;valueMinor?:string}>}>('/inventory/movements')}
  listInventoryCounts(){return this.request<{counts:BackendInventoryCountSummary[]}>('/inventory/counts')}
  getCurrentInventoryCount(){return this.request<{count:BackendInventoryCount|null}>('/inventory/counts/current')}
  getInventoryCount(countId:string){return this.request<{count:BackendInventoryCount}>('/inventory/counts/'+encodeURIComponent(countId))}
  getCurrentShift(){return this.request<{shift:BackendShift|null}>('/shifts/current')}
  listShiftCloseReports(){return this.request<{reports:BackendShiftCloseReport[]}>('/shifts/close-reports')}
  listSalesOrders(){return this.request<{orders:Array<{id:string;orderNumber:string;timestamp:string;cashierName:string;currency:string;subtotalMinor:number;taxMinor:number;totalMinor:number;paidMinor:number;amountDueMinor:number;customerName:string|null;refundedMinor:number;status:'completed'|'partially_refunded'|'refunded';paymentMethod:'cash'|'customer_credit';lines:Array<{lineId:string;productId:string;sku:string;name:string;quantity:string;unitPriceMinor:string;costPriceMinor?:string;cogsMinor?:string;taxRateBps:number;subtotalMinor:string;taxMinor:string;refundedQuantity:string}>}>}>('/sales/orders')}
  getSaleReceipt(orderId:string){return this.request<BackendSaleReceipt>('/sales/orders/'+encodeURIComponent(orderId)+'/receipt')}
  getTrialBalance(asOf:string){return this.request<BackendTrialBalance>('/reports/trial-balance?'+new URLSearchParams({asOf}))}
  getProfitLoss(from:string,to:string){return this.request<BackendPartialOperatingSummary>('/reports/profit-loss?'+new URLSearchParams({from,to}))}
  getJournalLines(query:{accountCode:string;from?:string;to?:string;asOf?:string;limit?:number;offset?:number}){return this.request<BackendJournalLines>('/reports/journal-lines?'+new URLSearchParams(Object.fromEntries(Object.entries(query).filter((entry):entry is [string,string|number]=>entry[1]!==undefined).map(([key,value])=>[key,String(value)])) ))}
  listHotelRooms(){return this.request<{rooms:BackendRoom[]}>('/hospitality/rooms')}
  listHotelReservations(){return this.request<{reservations:BackendReservation[]}>('/hospitality/reservations')}
  listHotelStays(){return this.request<{stays:BackendStay[]}>('/hospitality/stays')}
  async submitCommand(command:BackendCommand){
    if(command.type==='catalog.import.validate'||command.type==='catalog.import.revalidate')throw new Error('Use import validation transport; CSV source must not enter the command journal.');
    try{await commandJournal.save(command,'sending');}
    catch{throw Object.assign(new Error('The command was not sent because recovery data could not be saved. Restore browser storage before retrying.'),{code:'COMMAND_NOT_SENT'});}
    await this.emitRecovery();
    try{const result=await this.request<{commandId:string;status:string;value?:Record<string,unknown>;message?:string;code?:string}>('/commands',{method:'POST',body:JSON.stringify(command)});if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status))await commandJournal.remove(command.commandId);else await commandJournal.save(command,'outcome_unknown');await this.emitRecovery();return result}
    catch(error){await commandJournal.save(command,'outcome_unknown');await this.emitRecovery();throw error}
  }
  async submitImportValidation(command:BackendCommand,fileName:string,sourceHash:string){
    const session=this.session;if(!session)throw new Error('Sign in before validating an import.');
    if(command.type!=='catalog.import.validate'&&command.type!=='catalog.import.revalidate')throw new Error('Unsupported import validation request.');
    const metadata:ImportValidationRecovery={commandId:command.commandId,type:command.type,tenantId:session.tenant.id,deviceId:session.deviceId,actorId:session.user.id,fileName,sourceHash,state:'sending',savedAt:new Date().toISOString()};
    try{await importValidationJournal.save(metadata);}
    catch{throw Object.assign(new Error('Validation was not sent because recovery metadata could not be saved. Retry after restoring browser storage.'),{code:'IMPORT_NOT_SENT'});}
    await this.emitImportRecovery();
    try{
      const result=await this.request<{commandId:string;status:string;value?:Record<string,unknown>;message?:string;code?:string}>('/commands',{method:'POST',body:JSON.stringify(command)});
      if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status))await importValidationJournal.remove(command.commandId);
      else await importValidationJournal.save({...metadata,state:'outcome_unknown'});
      await this.emitImportRecovery();return result;
    }catch(error){
      const failure=error as {status?:number;details?:unknown};
      if(typeof failure.status==='number'&&failure.status>=400&&failure.status<500){
        await importValidationJournal.remove(command.commandId);await this.emitImportRecovery();
        throw Object.assign(new Error(error instanceof Error?error.message:'The server rejected this file before validation.'),{code:'IMPORT_NOT_SENT',status:failure.status,details:failure.details});
      }
      await importValidationJournal.save({...metadata,state:'outcome_unknown'});await this.emitImportRecovery();throw error;
    }
  }
  async checkImportValidationStatus(commandId:string){
    const result=await this.request<{commandId:string;status:string;response:Record<string,unknown>}>('/commands/'+encodeURIComponent(commandId));
    if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status)){await importValidationJournal.remove(commandId);await this.emitImportRecovery();}
    return result;
  }
  listImportValidationRecovery():Promise<ImportValidationRecovery[]>{const session=this.session;return session?importValidationJournal.list(session.tenant.id,session.deviceId,session.user.id):Promise.resolve([]);}
  async discardUnconfirmedValidation(commandId:string){await importValidationJournal.remove(commandId);await this.emitImportRecovery();}
  private async emitImportRecovery(){const records=await this.listImportValidationRecovery();this.importRecoveryListeners.forEach(listener=>listener(records));}
  async checkCommandStatus(commandId:string){const result=await this.request<{commandId:string;status:string;response:Record<string,unknown>}>('/commands/'+encodeURIComponent(commandId));if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status)){await commandJournal.remove(commandId);await this.emitRecovery()}return result}
  listRecoverableCommands(tenantId?:string):Promise<RecoverableCommand[]>{return commandJournal.list(tenantId)}
  private async emitRecovery(){const records=await commandJournal.list(this.session?.tenant.id);this.recoveryListeners.forEach(listener=>listener(records))}
}
export const apiClient=new ApiClient();
