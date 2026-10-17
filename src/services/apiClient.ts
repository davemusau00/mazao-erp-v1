import {commandJournal,type RecoverableCommand} from './commandJournal';
import {importValidationJournal,type ImportValidationRecovery} from './importValidationJournal';
import {secretOperationJournal,type SecretOperationRecovery} from './secretOperationJournal';

export interface BackendSession {
  user:{id:string;name:string;email:string;role:string;permissions:string[];credentialVersion?:number};
  tenant:{id:string;name:string;currency:string;timeZone:string;capabilities:string[];taxPolicy?:{calculation:'exclusive';defaultRateBps:number;label:string;reviewed:boolean}};
  outlet:{id:string;name:string;timeZone?:string}; deviceId:string; csrfToken:string;
}
export interface BackendAssignmentChoice {deviceId:string;deviceLabel:string;tenantId:string;tenantName:string;outletId:string;outletName:string}
export interface BackendAssignmentSelection {status:'ASSIGNMENT_REQUIRED';assignments:BackendAssignmentChoice[]}
export interface BackendStaffMember {userId:string;displayName:string;email:string;role:string;active:boolean;version:number;credentialVersion:number;hasCredential:boolean;assignmentCount:number;activeSessionCount:number}
export interface BackendStaffDirectory {staff:BackendStaffMember[];roles:Array<{role:string;label:string;permissions:string[];assignable:boolean}>;outlets:Array<{id:string;name:string;timeZone:string;active:boolean}>;authorizationModel:'COARSE_ROLE_MAP'}
export interface BackendWorkspaceAssignment {id:string;kind:'WORKSPACE_ASSIGNMENT';label:string;outletId:string;outletName:string;assignedUserId:string;assignedUserName:string;active:boolean;version:number;createdAt:string;revokedAt:string|null}
export interface BackendOperatorSession {id:string;deviceId:string;deviceLabel:string;outletId:string;outletName:string;createdAt:string;expiresAt:string;revokedAt:string|null;version:number;current:boolean}
export interface BackendOperatorSessions {userId:string;credentialVersion:number;sessions:BackendOperatorSession[]}
export interface BackendCommandResult {commandId:string;status:string;value?:Record<string,unknown>;code?:string;message?:string;details?:unknown}
export interface BackendBusinessConfiguration {
  id:string;name:string;currency:string;timeZone:string;version:number;
  legalName:string;registrationNumber:string;taxRegistrationNumber:string;
  address:string;phone:string;email:string;website:string;logoUrl:string;receiptQrImage:string;showQrOnReceipt:boolean;
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
  businessVersion:number;currency:string;defaultTaxRateBps:number;createdAt:string;createdBy:string;appliedAt:string|null;summary:ProductImportSummary;
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
export interface BackendOperationalAnalytics {
  reportType:'OUTLET_OPERATIONAL_ANALYTICS'; scope:'OUTLET'; tenantId:string; outletId:string; currency:string; timeZone:string;
  from:string; to:string; generatedAt:string;
  totals:{grossSalesMinor:string;subtotalMinor:string;taxMinor:string;refundsMinor:string;cashCollectedMinor:string;accountCreditMinor:string};
  daily:Array<{date:string;grossMinor:string;orderCount:string;refundMinor:string;refundCount:string}>;
  topProducts:Array<{productId:string;sku:string;name:string;quantity:string;revenueMinor:string;orderCount:string}>;
  coverage:{status:'CONFIRMED_CASH_AND_ACCOUNT_CREDIT';orderCount:string;refundCount:string;cashPaymentCount:string;accountChargeCount:string;scope:string;excludedMethods:string[];excludedSources:string[]};
}
export interface BackendJournalLines {
  scope:'TENANT';accountCode:string;from?:string;to?:string;asOf?:string;limit:number;offset:number;total:string;nextOffset:number|null;
  entries:Array<{journalEntryId:string;sourceType:string;sourceId:string|null;currency:string;postedAt:string;createdBy:string|null;accountCode:string;debitMinor:string;creditMinor:string}>;
}
export interface BackendSaleReceipt {
  status:'CONFIRMED';fiscalDocumentStatus:'NOT_INTEGRATED';receiptId:string;receiptNumber:string;tenantName:string;outletName:string;timeZone:string;
  receiptProfile?:Partial<{legalName:string;registrationNumber:string;taxRegistrationNumber:string;address:string;phone:string;email:string;website:string;logoUrl:string;receiptQrImage:string;showQrOnReceipt:boolean;receiptHeader:string;receiptFooter:string;taxLabel:string;taxCalculation:'exclusive'}>;
  currency:string;createdAt:string;operatorName:string;saleStatus:string;
  lines:Array<{lineId:string;sku:string;name:string;quantity:string;unitPriceMinor:string;taxRateBps:number;subtotalMinor:string;taxMinor:string;totalMinor:string}>;
  payments:Array<{method:string;amountMinor:string;currency:string;status:string}>;
  subtotalMinor:string;taxMinor:string;totalMinor:string;amountPaidMinor:string;customerAccountCharge:{customerId:string;customerName:string;amountDueMinor:string}|null;cashTenderedMinor:string|null;changeMinor:string|null;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const READ_TIMEOUT_MS = 20_000;
const READ_SLOW_WARNING_MS = 10_000;
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function requestIdentifier(): string {
  return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}
function requestRoute(path: string): string {
  return path.split('?', 1)[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');
}
function assertBackendSession(value: unknown): asserts value is BackendSession {
  if(!isRecord(value)||!isRecord(value.user)||!isRecord(value.tenant)||!isRecord(value.outlet)
    ||typeof value.user.id!=='string'||typeof value.user.name!=='string'||typeof value.user.role!=='string'||!Array.isArray(value.user.permissions)
    ||typeof value.tenant.id!=='string'||typeof value.tenant.name!=='string'||typeof value.tenant.currency!=='string'||typeof value.tenant.timeZone!=='string'||!Array.isArray(value.tenant.capabilities)
    ||typeof value.outlet.id!=='string'||typeof value.outlet.name!=='string'||typeof value.deviceId!=='string'||typeof value.csrfToken!=='string')
    throw new ApiClientError('The server session response is incomplete. Retry sign-in or session restore.','INVALID_SERVER_RESPONSE',200);
}

class ApiClient {
  private csrf=''; private session:BackendSession|null=null; private listeners=new Set<(session:BackendSession|null)=>void>();private recoveryListeners=new Set<(records:RecoverableCommand[])=>void>();
  private importRecoveryListeners=new Set<(records:ImportValidationRecovery[])=>void>();
  private secretRecoveryListeners=new Set<(records:SecretOperationRecovery[])=>void>();
  private pendingReadControllers = new Set<AbortController>();
  subscribe(listener:(session:BackendSession|null)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  subscribeRecovery(listener:(records:RecoverableCommand[])=>void){this.recoveryListeners.add(listener);return()=>{this.recoveryListeners.delete(listener)}}
  subscribeImportRecovery(listener:(records:ImportValidationRecovery[])=>void){this.importRecoveryListeners.add(listener);return()=>{this.importRecoveryListeners.delete(listener)}}
  subscribeSecretRecovery(listener:(records:SecretOperationRecovery[])=>void){this.secretRecoveryListeners.add(listener);return()=>{this.secretRecoveryListeners.delete(listener)}}
  getSession(){return this.session}
  private publish(session:BackendSession|null){this.session=session;this.listeners.forEach(listener=>listener(session))}
  cancelPendingReads(){for(const controller of this.pendingReadControllers)controller.abort('navigation');}
  private async request<T>(path:string,init:RequestInit={}):Promise<T>{
    const started=performance.now();
    try{return await this.performRequest<T>(path,init)}
    catch(cause){this.reportRequestFailure(path,cause,performance.now()-started);throw cause;}
  }
  private reportRequestFailure(path:string,cause:unknown,durationMs:number){
    if(!(cause instanceof ApiClientError)||cause.code==='REQUEST_CANCELLED'||typeof window==='undefined')return;
    const requestId=(cause.requestId??'').replace(/[^A-Za-z0-9._:-]/g,'').slice(0,128);
    if(!requestId)return;
    window.dispatchEvent(new CustomEvent('mazao:api-request-failed',{detail:{requestId,route:requestRoute(path),code:cause.code,status:cause.status,durationMs:Math.round(durationMs)}}));
  }
  private reportRequestCompletion(path:string,response:Response,headersMs:number,bodyMs:number,responseBytes:number){
    if(typeof window==='undefined')return;
    const requestId=(response.headers.get('x-request-id')??'').replace(/[^A-Za-z0-9._:-]/g,'').slice(0,128);
    if(!requestId)return;
    const timing=response.headers.get('server-timing')??'';
    const serverAppMs=/\bapp;dur=(\d+(?:\.\d+)?)/.exec(timing)?.[1];
    window.dispatchEvent(new CustomEvent('mazao:api-request-completed',{detail:{requestId,route:requestRoute(path),status:response.status,headersMs:Math.round(headersMs),bodyMs:Math.round(bodyMs),responseBytes,...(serverAppMs?{serverAppMs:Number(serverAppMs)}:{})}}));
  }
  private async performRequest<T>(path:string,init:RequestInit={}):Promise<T>{
    const method=(init.method??'GET').toUpperCase();const isRead=method==='GET';
    const boundedMutation=method==='POST';const bounded=isRead||boundedMutation;const timeoutMs=isRead?READ_TIMEOUT_MS:30_000;
    const headers=new Headers(init.headers); if(init.body)headers.set('content-type','application/json');
    const requestId=requestIdentifier();headers.set('x-request-id',requestId);
    if(['POST','PUT','PATCH','DELETE'].includes(method)&&this.csrf)headers.set('x-csrf-token',this.csrf);
    const controller=bounded?new AbortController():undefined;const externalSignal=init.signal;
    let slowWarningSent=false;let cleaned=false;let hardTimer:ReturnType<typeof setTimeout>|undefined;let slowTimer:ReturnType<typeof setTimeout>|undefined;
    const abortFromCaller=()=>controller?.abort('caller');
    const cleanup=()=>{
      if(cleaned)return;cleaned=true;
      if(hardTimer!==undefined)clearTimeout(hardTimer);if(slowTimer!==undefined)clearTimeout(slowTimer);
      externalSignal?.removeEventListener('abort',abortFromCaller);
      if(controller&&isRead)this.pendingReadControllers.delete(controller);
      if(slowWarningSent&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('mazao:api-request-finished',{detail:{requestId}}));
    };
    if(controller){
      if(isRead){
        this.pendingReadControllers.add(controller);
        if(externalSignal?.aborted)controller.abort('caller');else externalSignal?.addEventListener('abort',abortFromCaller,{once:true});
        slowTimer=setTimeout(()=>{
          slowWarningSent=true;
          if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('mazao:api-request-slow',{detail:{requestId,route:requestRoute(path)}}));
        },READ_SLOW_WARNING_MS);
      }
      hardTimer=setTimeout(()=>controller.abort('timeout'),timeoutMs);
    }
    let response:Response;const requestStartedAt=performance.now();let responseHeadersAt=0;
    try {
      response=await fetch(`/api/v1${path}`,{...init,headers,credentials:'include',...(controller?{signal:controller.signal}:{})});
      responseHeadersAt=performance.now();
    } catch {
      if(controller?.signal.aborted){
        cleanup();
        if(controller.signal.reason==='timeout')throw new ApiClientError(isRead?`This request took longer than ${READ_TIMEOUT_MS/1000} seconds. Retry the read when the server is available.`:'The server did not confirm this change before the request timed out. Keep its original command ID and check status before retrying.',isRead?'REQUEST_TIMED_OUT':'OUTCOME_UNKNOWN',undefined,requestId);
        if(controller.signal.reason==='caller')throw new ApiClientError('This read was cancelled because its view is no longer active.','REQUEST_CANCELLED',undefined,requestId);
        throw new ApiClientError('This read was cancelled because its view is no longer active.','REQUEST_CANCELLED',undefined,requestId);
      }
      cleanup();
      if(isRead){const offline=typeof navigator!=='undefined'&&!navigator.onLine;throw new ApiClientError(offline?'You are offline. Reconnect and retry this read.':'The connection could not be completed. Retry this read.','CONNECTION_FAILED',undefined,requestId);}
      throw new ApiClientError('Connection outcome is unknown. Keep the command ID and check its status before retrying.','OUTCOME_UNKNOWN',undefined,requestId);
    }
    try {
      let bodyText:string;
      try { bodyText=await response.text(); }
      catch {
        if(controller?.signal.aborted&&controller.signal.reason==='timeout')throw new ApiClientError(isRead?`The response body did not finish within ${READ_TIMEOUT_MS/1000} seconds. Retry this read.`:'The server did not confirm this change before the response timed out. Keep its original command ID and check status before retrying.',isRead?'REQUEST_TIMED_OUT':'OUTCOME_UNKNOWN',response.status,response.headers.get('x-request-id')??requestId);
        if(controller?.signal.aborted)throw new ApiClientError('This read was cancelled because its view is no longer active.','REQUEST_CANCELLED',response.status,response.headers.get('x-request-id')??requestId);
        throw new ApiClientError(response.ok?'The server response ended before its body was complete. Retry this read.':`Request failed (${response.status}) and its error response was incomplete.`,'INVALID_SERVER_RESPONSE',response.status,response.headers.get('x-request-id')??requestId);
      }
      let body:unknown;
      try { body=JSON.parse(bodyText); }
      catch {
        if(response.ok)throw new ApiClientError('The server returned an unreadable response. Retry this read; no data was accepted.','INVALID_SERVER_RESPONSE',response.status,response.headers.get('x-request-id')??requestId);
        body=undefined;
      }
      if(!response.ok){
        if(response.status===401&&path!=='/auth/login'){this.csrf='';this.publish(null)}
        const error=isRecord(body)&&isRecord(body.error)?body.error:{};
        throw Object.assign(new ApiClientError(typeof error.message==='string'?error.message:`Request failed (${response.status}).`,typeof error.code==='string'?error.code:`HTTP_${response.status}`,response.status,response.headers.get('x-request-id')??requestId),{details:error.details});
      }
      if(!isRecord(body))throw new ApiClientError('The server returned an unexpected response shape. Retry this read.','INVALID_SERVER_RESPONSE',response.status,response.headers.get('x-request-id')??requestId);
      this.reportRequestCompletion(path,response,responseHeadersAt-requestStartedAt,performance.now()-responseHeadersAt,new TextEncoder().encode(bodyText).length);
      return body as T;
    } finally {cleanup();}
  }
  private async requestText(path:string):Promise<string>{
    const started=performance.now();
    try{return await this.performRequestText(path)}
    catch(cause){this.reportRequestFailure(path,cause,performance.now()-started);throw cause;}
  }
  private async performRequestText(path:string):Promise<string>{
    const requestId=requestIdentifier();const controller=new AbortController();this.pendingReadControllers.add(controller);
    let slowWarningSent=false;let cleaned=false;let timedOut=false;
    let hardTimer:ReturnType<typeof setTimeout>|undefined;let slowTimer:ReturnType<typeof setTimeout>|undefined;
    const cleanup=()=>{if(cleaned)return;cleaned=true;if(hardTimer!==undefined)clearTimeout(hardTimer);if(slowTimer!==undefined)clearTimeout(slowTimer);this.pendingReadControllers.delete(controller);if(slowWarningSent&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('mazao:api-request-finished',{detail:{requestId}}));};
    const headers=new Headers({'x-request-id':requestId});
    slowTimer=setTimeout(()=>{slowWarningSent=true;if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('mazao:api-request-slow',{detail:{requestId,route:requestRoute(path)}}));},READ_SLOW_WARNING_MS);
    hardTimer=setTimeout(()=>{timedOut=true;controller.abort('timeout');},READ_TIMEOUT_MS);
    const requestStartedAt=performance.now();let responseHeadersAt=0;
    try{
      const response=await fetch(`/api/v1${path}`,{headers,credentials:'include',signal:controller.signal});
      responseHeadersAt=performance.now();
      let text:string;try{text=await response.text();}catch{
        if(timedOut)throw new ApiClientError(`This download did not finish within ${READ_TIMEOUT_MS/1000} seconds. Retry the download.`,'REQUEST_TIMED_OUT',response.status,response.headers.get('x-request-id')??requestId);
        throw new ApiClientError('The download response ended before its body was complete. Retry the download.','INVALID_SERVER_RESPONSE',response.status,response.headers.get('x-request-id')??requestId);
      }
      if(!response.ok){
        let message=`Request failed (${response.status}).`;let code=`HTTP_${response.status}`;
        try{const body=JSON.parse(text);if(isRecord(body)&&isRecord(body.error)){if(typeof body.error.message==='string')message=body.error.message;if(typeof body.error.code==='string')code=body.error.code;}}catch{}
        if(response.status===401){this.csrf='';this.publish(null);}
        throw new ApiClientError(message,code,response.status,response.headers.get('x-request-id')??requestId);
      }
      this.reportRequestCompletion(path,response,responseHeadersAt-requestStartedAt,performance.now()-responseHeadersAt,new TextEncoder().encode(text).length);
      return text;
    }catch(cause){
      if(cause instanceof ApiClientError)throw cause;
      if(timedOut)throw new ApiClientError(`This download took longer than ${READ_TIMEOUT_MS/1000} seconds. Retry it when the server is available.`,'REQUEST_TIMED_OUT',undefined,requestId);
      const offline=typeof navigator!=='undefined'&&!navigator.onLine;
      throw new ApiClientError(offline?'You are offline. Reconnect and retry this download.':'The download could not be completed. Retry it.','CONNECTION_FAILED',undefined,requestId);
    }finally{cleanup();}
  }
  private async requestArray<T extends object>(path:string,field:keyof T & string,signal?:AbortSignal):Promise<T>{
    const result=await this.request<unknown>(path,{signal});
    if(!isRecord(result)||!Array.isArray(result[field as string]))throw new ApiClientError(`The server response is missing the required ${field} list. Retry this read.`,'INVALID_SERVER_RESPONSE',200);
    return result as T;
  }
  private async requestRecord<T extends object>(path:string,field:keyof T & string,signal?:AbortSignal):Promise<T>{
    const result=await this.request<unknown>(path,{signal});
    if(!isRecord(result)||!isRecord(result[field as string]))throw new ApiClientError(`The server response is missing the required ${field} record. Retry this read.`,'INVALID_SERVER_RESPONSE',200);
    return result as T;
  }
  async login(email:string,password:string,deviceId?:string):Promise<BackendSession|BackendAssignmentSelection>{
    try{const s=await this.request<unknown>('/auth/login',{method:'POST',body:JSON.stringify({email,password,...(deviceId?{deviceId}:{})})});assertBackendSession(s);this.csrf=s.csrfToken;this.publish(s);return s;}
    catch(cause){const error=cause as {code?:string;details?:{assignments?:BackendAssignmentChoice[]}};if(error.code==='ASSIGNMENT_REQUIRED'&&Array.isArray(error.details?.assignments))return {status:'ASSIGNMENT_REQUIRED',assignments:error.details.assignments};throw cause;}
    finally{password='';}
  }
  async restore(){try{const s=await this.request<unknown>('/auth/me');assertBackendSession(s);this.csrf=s.csrfToken;this.publish(s);return s}catch(error){if((error as {status?:number}).status!==401)throw error;this.csrf='';this.publish(null);return null}}
  async logout(){await this.request('/auth/logout',{method:'POST'});this.csrf='';this.publish(null)}
  clearAuthenticatedSession(){this.csrf='';this.publish(null);}
  async listStaff(signal?:AbortSignal){
    const result=await this.request<BackendStaffDirectory>('/staff',{signal});
    if(!Array.isArray(result.staff)||!Array.isArray(result.roles)||!Array.isArray(result.outlets)||result.authorizationModel!=='COARSE_ROLE_MAP')
      throw new ApiClientError('The staff directory response is incomplete. Retry the staff read.','INVALID_SERVER_RESPONSE',200);
    return result;
  }
  async listWorkspaceAssignments(signal?:AbortSignal){
    const result=await this.request<{devices:BackendWorkspaceAssignment[]}>('/devices',{signal});
    if(!Array.isArray(result.devices))throw new ApiClientError('The workspace assignment response is incomplete. Retry the assignments read.','INVALID_SERVER_RESPONSE',200);
    return result;
  }
  async getOwnSessions(signal?:AbortSignal){const result=await this.requestArray<BackendOperatorSessions>('/auth/sessions','sessions',signal);if(typeof result.userId!=='string'||typeof result.credentialVersion!=='number')throw new ApiClientError('The session response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getStaffSessions(userId:string,signal?:AbortSignal){const result=await this.requestArray<BackendOperatorSessions>('/staff/'+encodeURIComponent(userId)+'/sessions','sessions',signal);if(typeof result.userId!=='string'||typeof result.credentialVersion!=='number')throw new ApiClientError('The session response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getConfiguration(signal?:AbortSignal){
    const result=await this.request<{configuration:BackendConfiguration}>('/configuration',{signal});
    const configuration=result.configuration as unknown;
    if(!isRecord(configuration)||!isRecord(configuration.business)||!isRecord(configuration.outlet)||!Array.isArray(configuration.capabilities)||!Array.isArray(configuration.supportedCapabilities)||!isRecord(configuration.readiness)||!Array.isArray(configuration.readiness.checks))
      throw new ApiClientError('Business settings were returned without the required business, outlet, capability, or readiness data. Retry this read.','INVALID_SERVER_RESPONSE',200);
    for(const [name,record] of [['business',configuration.business],['outlet',configuration.outlet]] as const){
      if(typeof record.id!=='string'||typeof record.name!=='string'||typeof record.version!=='number'||!Number.isSafeInteger(record.version))
        throw new ApiClientError(`Business settings are missing required ${name} fields. Retry this read.`,'INVALID_SERVER_RESPONSE',200);
    }
    return result;
  }
  async stageConfigurationAsset(kind:'logo'|'receipt_qr',draftId:string,dataUrl:string){
    const result=await this.request<{asset:{id:string;kind:string;sha256:string;byteLength:number}}>('/configuration/assets',{method:'POST',body:JSON.stringify({kind,draftId,dataUrl})});
    if(!isRecord(result.asset)||typeof result.asset.id!=='string'||result.asset.kind!==kind||typeof result.asset.sha256!=='string'||typeof result.asset.byteLength!=='number')
      throw new ApiClientError('The image upload response was incomplete. Retry with the same image draft ID.','INVALID_SERVER_RESPONSE',200);
    return result.asset;
  }
  updateBusinessConfiguration(input:BackendBusinessConfigurationInput,version:number,commandId:string){
    const session=this.session;if(!session)throw new Error('Sign in before changing business settings.');
    return this.submitCommand({protocolVersion:1,commandId,tenantId:session.tenant.id,deviceId:session.deviceId,type:'configuration.business.update',occurredAt:new Date().toISOString(),expectedVersions:{['business:'+session.tenant.id]:version},payload:input});
  }
  updateOutletConfiguration(input:BackendOutletConfigurationInput,version:number,commandId:string){
    const session=this.session;if(!session)throw new Error('Sign in before changing outlet settings.');
    return this.submitCommand({protocolVersion:1,commandId,tenantId:session.tenant.id,deviceId:session.deviceId,type:'configuration.outlet.update',occurredAt:new Date().toISOString(),expectedVersions:{['outlet:'+session.outlet.id]:version},payload:input});
  }
  listCatalog(signal?:AbortSignal){return this.requestArray<{items:BackendProduct[]}>('/catalog/items','items',signal)}
  listProductImports(signal?:AbortSignal){return this.requestArray<{batches:ProductImportBatchSummary[]}>('/catalog/imports','batches',signal)}
  getProductImport(batchId:string,signal?:AbortSignal){return this.requestRecord<{batch:ProductImportBatch}>('/catalog/imports/'+encodeURIComponent(batchId),'batch',signal)}
  async getProductImportErrorsCsv(batchId:string):Promise<string>{
    return this.requestText('/catalog/imports/'+encodeURIComponent(batchId)+'/errors.csv');
  }
  listCustomerAccounts(signal?:AbortSignal){return this.requestArray<{customers:BackendCustomerAccount[]}>('/customers','customers',signal)}
  async getCustomerStatement(customerId:string,signal?:AbortSignal){const result=await this.request<BackendCustomerStatement>('/customers/'+encodeURIComponent(customerId)+'/statement',{signal});if(!isRecord(result.customer)||!Array.isArray(result.entries))throw new ApiClientError('The customer statement response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  listInventoryMovements(signal?:AbortSignal){return this.requestArray<{movements:Array<{id:string;timestamp:string;sku:string;productName:string;type:'sale'|'restock'|'adjustment';quantity:string;balanceAfter:string;note:string;reference?:string;valueMinor?:string}>}>('/inventory/movements','movements',signal)}
  listInventoryCounts(signal?:AbortSignal){return this.requestArray<{counts:BackendInventoryCountSummary[]}>('/inventory/counts','counts',signal)}
  async getCurrentInventoryCount(signal?:AbortSignal){const result=await this.request<unknown>('/inventory/counts/current',{signal});if(!isRecord(result)||!Object.hasOwn(result,'count')||(result.count!==null&&!isRecord(result.count)))throw new ApiClientError('The current stock count response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result as {count:BackendInventoryCount|null};}
  getInventoryCount(countId:string,signal?:AbortSignal){return this.requestRecord<{count:BackendInventoryCount}>('/inventory/counts/'+encodeURIComponent(countId),'count',signal)}
  async getCurrentShift(signal?:AbortSignal){const result=await this.request<unknown>('/shifts/current',{signal});if(!isRecord(result)||!Object.hasOwn(result,'shift')||(result.shift!==null&&!isRecord(result.shift)))throw new ApiClientError('The current shift response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result as {shift:BackendShift|null};}
  listShiftCloseReports(signal?:AbortSignal){return this.requestArray<{reports:BackendShiftCloseReport[]}>('/shifts/close-reports','reports',signal)}
  listSalesOrders(signal?:AbortSignal){return this.requestArray<{orders:Array<{id:string;orderNumber:string;timestamp:string;cashierName:string;currency:string;subtotalMinor:number;taxMinor:number;totalMinor:number;paidMinor:number;amountDueMinor:number;customerName:string|null;refundedMinor:number;status:'completed'|'partially_refunded'|'refunded';paymentMethod:'cash'|'customer_credit';lines:Array<{lineId:string;productId:string;sku:string;name:string;quantity:string;unitPriceMinor:string;costPriceMinor?:string;cogsMinor?:string;taxRateBps:number;subtotalMinor:string;taxMinor:string;refundedQuantity:string}>}>}>('/sales/orders','orders',signal)}
  async getSaleReceipt(orderId:string,signal?:AbortSignal){const result=await this.request<BackendSaleReceipt>('/sales/orders/'+encodeURIComponent(orderId)+'/receipt',{signal});if(result.status!=='CONFIRMED'||!Array.isArray(result.lines)||!Array.isArray(result.payments)||typeof result.receiptNumber!=='string')throw new ApiClientError('The sale receipt response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getTrialBalance(asOf:string,signal?:AbortSignal){const result=await this.request<BackendTrialBalance>('/reports/trial-balance?'+new URLSearchParams({asOf}),{signal});if(!isRecord(result.totals)||!Array.isArray(result.accounts)||!isRecord(result.coverage))throw new ApiClientError('The trial balance response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getProfitLoss(from:string,to:string,signal?:AbortSignal){const result=await this.request<BackendPartialOperatingSummary>('/reports/profit-loss?'+new URLSearchParams({from,to}),{signal});if(!isRecord(result.totals)||!Array.isArray(result.lines)||!isRecord(result.coverage))throw new ApiClientError('The operating summary response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getOperationalAnalytics(from:string,to:string,signal?:AbortSignal){const result=await this.request<BackendOperationalAnalytics>('/reports/operational-analytics?'+new URLSearchParams({from,to}),{signal});if(!isRecord(result.totals)||!Array.isArray(result.daily)||!Array.isArray(result.topProducts)||!isRecord(result.coverage))throw new ApiClientError('The operating analytics response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getJournalLines(query:{accountCode:string;from?:string;to?:string;asOf?:string;limit?:number;offset?:number},signal?:AbortSignal){const result=await this.request<BackendJournalLines>('/reports/journal-lines?'+new URLSearchParams(Object.fromEntries(Object.entries(query).filter((entry):entry is [string,string|number]=>entry[1]!==undefined).map(([key,value])=>[key,String(value)])) ),{signal});if(!Array.isArray(result.entries)||typeof result.total!=='string'||typeof result.limit!=='number')throw new ApiClientError('The journal lines response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  listHotelRooms(signal?:AbortSignal){return this.requestArray<{rooms:BackendRoom[]}>('/hospitality/rooms','rooms',signal)}
  listHotelReservations(signal?:AbortSignal){return this.requestArray<{reservations:BackendReservation[]}>('/hospitality/reservations','reservations',signal)}
  listHotelStays(signal?:AbortSignal){return this.requestArray<{stays:BackendStay[]}>('/hospitality/stays','stays',signal)}
  async submitCommand(command:BackendCommand){
    const hasSecret=(value:unknown):boolean=>Array.isArray(value)?value.some(hasSecret):!!value&&typeof value==='object'&&Object.entries(value).some(([key,entry])=>/password|credentialhash|passwordhash/i.test(key)||hasSecret(entry));
    if(hasSecret(command.payload))throw Object.assign(new Error('Credentials must use the private password endpoint.'),{code:'COMMAND_NOT_SENT'});
    if(command.type==='catalog.import.validate'||command.type==='catalog.import.revalidate')throw new Error('Use import validation transport; CSV source must not enter the command journal.');
    const actorId=this.session?.user.id;
    try{await commandJournal.save(command,'sending',actorId);}
    catch{throw Object.assign(new Error('The command was not sent because recovery data could not be saved. Restore browser storage before retrying.'),{code:'COMMAND_NOT_SENT'});}
    await this.emitRecovery();
    try{const result=await this.request<{commandId:string;status:string;value?:Record<string,unknown>;message?:string;code?:string}>('/commands',{method:'POST',body:JSON.stringify(command)});if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status))await commandJournal.remove(command.commandId);else await commandJournal.save(command,'outcome_unknown');await this.emitRecovery();return result}
    catch(error){await commandJournal.save(command,'outcome_unknown',actorId);await this.emitRecovery();throw error}
  }
  async submitPasswordOperation(operation:SecretOperationRecovery,newPassword:string,currentPassword?:string):Promise<BackendCommandResult>{
    const session=this.session;
    if(!session||operation.actorId!==session.user.id||operation.tenantId!==session.tenant.id)throw Object.assign(new Error('Sign in with the account that owns this password operation.'),{code:'COMMAND_NOT_SENT'});
    try{await secretOperationJournal.save({...operation,state:'sending'});}
    catch{throw Object.assign(new Error('Password change was not sent because recovery metadata could not be saved.'),{code:'COMMAND_NOT_SENT'});}
    await this.emitSecretRecovery();
    try{
      const path=operation.kind==='auth.password.change'?'/auth/password':'/staff/'+encodeURIComponent(operation.targetUserId)+'/password';
      const result=await this.request<BackendCommandResult>(path,{method:'POST',body:JSON.stringify({protocolVersion:1,commandId:operation.commandId,expectedVersions:{['credential:'+operation.targetUserId]:operation.expectedCredentialVersion},newPassword,...(operation.kind==='auth.password.change'?{currentPassword}: {})})});
      if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status))await secretOperationJournal.remove(operation.commandId);else await secretOperationJournal.save({...operation,state:'outcome_unknown'});
      await this.emitSecretRecovery();return result;
    }catch(cause){
      const status=(cause as {status?:number}).status;
      if(status&&status>=400&&status<500){await secretOperationJournal.remove(operation.commandId);await this.emitSecretRecovery();throw Object.assign(new Error(cause instanceof Error?cause.message:'The server rejected the password request.'),{code:'COMMAND_NOT_SENT',status});}
      await secretOperationJournal.save({...operation,state:'outcome_unknown'});await this.emitSecretRecovery();throw cause;
    }finally{newPassword='';currentPassword='';}
  }
  listSecretOperationRecovery():Promise<SecretOperationRecovery[]>{const session=this.session;return session?secretOperationJournal.list(session.tenant.id,session.user.id):Promise.resolve([]);}
  async checkSecretOperationStatus(commandId:string){const result=await this.request<{commandId:string;status:string;response:Record<string,unknown>}>('/commands/'+encodeURIComponent(commandId));if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status)){await secretOperationJournal.remove(commandId);await this.emitSecretRecovery();}return result;}
  private async emitSecretRecovery(){const records=await this.listSecretOperationRecovery();this.secretRecoveryListeners.forEach(listener=>listener(records));}
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
  async listRecoverableCommands(tenantId?:string):Promise<RecoverableCommand[]>{const actorId=this.session?.user.id;const records=await commandJournal.list(tenantId);return actorId?records.filter(record=>record.actorId===actorId):[]}
  private async emitRecovery(){const records=await commandJournal.list(this.session?.tenant.id);this.recoveryListeners.forEach(listener=>listener(records))}
}
export const apiClient=new ApiClient();
