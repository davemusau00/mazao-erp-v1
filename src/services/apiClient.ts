import {historyUrl,type HistoryOptions,type HistoryPage} from '../types/history';
import {commandJournal,type RecoverableCommand} from './commandJournal';
import {importValidationJournal,type ImportValidationRecovery} from './importValidationJournal';
import {secretOperationJournal,type SecretOperationRecovery} from './secretOperationJournal';
import {countDraftStore} from './countDraftStore';
import { apiErrorMessage, isTerminalCommandStatus, isTerminalOutcome, presentOutcome, unconfirmedActionMessage } from './apiMessages';
import type { CountEvidenceCoverage, CountEvidenceDetail, CountEvidenceEvent, CountMovementPage, CountReview, CountReviewMovement } from '../types/countRecovery';
import { isCountEvidenceEvent, isCountEventPage, isCountLineEvidence, isCountMovementPage, isCountReview, isCountReviewMovement } from '../utils/countRecovery';
import type { BackendOperationalAnalytics, BackendItemReport, ItemReportQuery, BackendJournalSource, BackendItemEvents, ItemEventsQuery } from '../types/reporting';
export type { BackendOperationalAnalytics, BackendItemReport, ItemReportQuery, BackendJournalSource, BackendItemEvents, ItemEventsQuery } from '../types/reporting';
import type { SaleHistory, SaleHistoryQuery } from '../types/sales';
import type { AccountingControls, AccountingRecordKind, AccountingRecordPage } from '../types/accounting';
import type { CustomerBalanceReport, CustomerBalanceQuery, InventoryValueReport, InventoryValueQuery } from '../types/controlReports';
export type { CustomerBalanceReport, CustomerBalanceQuery, InventoryValueReport, InventoryValueQuery } from '../types/controlReports';
import type { AccountCatalog } from '../types/accountCatalog';
import type { CatalogItemKind } from '../types/catalog';
export type { CatalogItemKind } from '../types/catalog';

export interface BackendSession {
  user:{id:string;name:string;email:string;role:string;permissions:string[];credentialVersion?:number};
  tenant:{id:string;name:string;currency:string;timeZone:string;capabilities:string[];taxPolicy?:{calculation:'exclusive';defaultRateBps:number;label:string;reviewed:boolean}};
  outlet:{id:string;name:string;timeZone?:string}; deviceId:string; csrfToken:string;
  onboardingStatus?:'SETUP'|'LIVE'|'LEGACY_ACTIVE';
}
export interface BackendAssignmentChoice {deviceId:string;deviceLabel:string;tenantId:string;tenantName:string;outletId:string;outletName:string}
export interface BackendContextSwitchBlockers {commands:number;imports:number;credentialChanges:number;ownPasswordChanges:number;staffPasswordChanges:number;countDrafts:number}
export interface BackendAssignmentSelection {status:'ASSIGNMENT_REQUIRED';assignments:BackendAssignmentChoice[]}
export interface BackendStaffMember {userId:string;displayName:string;email:string;role:string;active:boolean;version:number;credentialVersion:number;hasCredential:boolean;assignmentCount:number;activeSessionCount:number}
export interface BackendStaffDirectory {page?:HistoryPage;staff:BackendStaffMember[];roles:Array<{role:string;label:string;permissions:string[];assignable:boolean}>;outlets:Array<{id:string;name:string;timeZone:string;active:boolean}>;authorizationModel:'COARSE_ROLE_MAP'}
export interface BackendWorkspaceAssignment {id:string;kind:'WORKSPACE_ASSIGNMENT';label:string;outletId:string;outletName:string;assignedUserId:string;assignedUserName:string;active:boolean;version:number;createdAt:string;revokedAt:string|null}
export interface BackendOperatorSession {id:string;deviceId:string;deviceLabel:string;outletId:string;outletName:string;createdAt:string;expiresAt:string;revokedAt:string|null;version:number;current:boolean}
export interface BackendOperatorSessions {page?:HistoryPage;userId:string;credentialVersion:number;sessions:BackendOperatorSession[]}
export interface BackendCommandResult {commandId:string;status:string;value?:Record<string,unknown>;code?:string;message?:string;details?:unknown}
export interface BackendBusinessConfiguration {
  id:string;name:string;currency:string;timeZone:string;version:number;
  legalName:string;registrationNumber:string;taxRegistrationNumber:string;
  address:string;phone:string;email:string;website:string;logoUrl:string;receiptQrImage:string;showQrOnReceipt:boolean;
  receiptHeader:string;receiptFooter:string;
  taxPolicy:{calculation:'exclusive';defaultRateBps:number;label:string;reviewed:boolean};
}
export interface BackendOutletConfiguration {
  id:string;name:string;timeZone:string;version:number;active:boolean;address:string;phone:string;email:string;
  receiptHeader:string;receiptFooter:string;
  taxPolicy:{defaultRateBps:number;label:string;reviewed:boolean}|null;
}
export interface BackendConfiguration {
  business:BackendBusinessConfiguration;outlet:BackendOutletConfiguration;outlets:BackendOutletConfiguration[];
  capabilities:string[];supportedCapabilities:string[];currencyLocked:boolean;
  onboarding?:{status:'SETUP'|'LIVE'|'LEGACY_ACTIVE';reviewedAt:string|null;reviewedByName:string|null;reviewReason:string|null};
  readiness:{readyForFirstSale:boolean;checks:Array<{key:string;label:string;complete:boolean;detail:string}>};
}
export type BackendBusinessConfigurationInput=Omit<BackendBusinessConfiguration,'id'|'version'>;
export type BackendOutletConfigurationInput=Omit<BackendOutletConfiguration,'id'|'version'|'active'>;
export interface BackendProduct { id:string;sku:string;name:string;unit:string;currency:string;sellingPriceMinor:number;costPriceMinor?:number;inventoryValueMinor?:string|null;taxRateBps:number;quantity:string|null;version:number|null;balanceVersion?:number|null;productVersion?:number;barcode?:string|null;category?:string;categoryId?:string|null;reorderLevel?:string;active?:boolean;itemKind?:CatalogItemKind;stockTracked?:boolean }
export interface BackendCatalogCategory {id:string;name:string;active:boolean;version:number;mergedInto?:string|null;productCount:number;activeProductCount:number}
export interface BackendCatalogReadOptions {includeArchived?:boolean}
export interface BackendCatalogProductUpdate {productId:string;name:string;sellingPriceMinor:number;costPriceMinor:number;taxRateBps:number;category:string;barcode:string|null;reorderLevel:string;reason:string}
export type ProductImportField='sku'|'name'|'baseUnit'|'sellingPrice'|'costPrice'|'taxRatePercent'|'currency'|'barcode'|'category'|'reorderLevel'|'openingQuantity'|'openingUnitCost'|'itemKind';
export type ProductImportMapping=Partial<Record<ProductImportField,string|null>>;
export type ProductImportMode='CREATE_ONLY'|'UPSERT';
export interface ProductImportIssue { row:number;field:string;code:string;rawValue:string;message:string }
export interface ProductImportNormalized {
  sku:string;name:string;baseUnit:string;currency:string;sellingPriceMinor:number;costPriceMinor:number;taxRateBps:number;
  barcode:string|null;category:string;reorderLevel:string;openingQuantity:string;openingUnitCostMinor:number|null;openingValueMinor:string;itemKind?:CatalogItemKind;
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
export interface BackendShift { id:string;status:'OPEN';openingFloatMinor:number;cashSalesMinor:number;mpesaSalesMinor?:string|number;customerCollectionsMinor:number;cashRefundsMinor:number;cashPaidInMinor:number;cashPayoutMinor:number;expectedCashMinor:number;version:number;openedAt:string;cashMovements:BackendShiftCashMovement[];cashMovementPage?:HistoryPage }
export interface BackendShiftCloseReport {id:string;shiftId:string;commandId:string;operatorId:string;operatorName:string;tenantName:string;outletName:string;timeZone:string;businessDate:string;currency:string;shiftVersion:number;openedAt:string;closedAt:string;openingFloatMinor:string;cashSalesMinor:string;mpesaSalesMinor?:string;customerCollectionsMinor:string;cashRefundsMinor:string;cashPaidInMinor:string;cashPayoutMinor:string;expectedCashMinor:string;countedCashMinor:string;varianceMinor:string;stockExceptionSalesCount?:number}
export interface BackendStockSalePolicy {enabled:boolean;requirePhysicalConfirmation:true;requireReason:true;allowZeroReferenceCost:boolean;version:number;updatedBy:string|null;updatedByName:string|null;updatedAt:string|null}
export interface BackendStockShortfall {
  id:string;createdAt:string;orderId:string;receiptNumber:string;orderLineId:string;productId:string;sku:string;productName:string;
  operatorId:string;operatorName:string;quantity:string;resolvedQuantity:string;remainingQuantity:string;requestedQuantity:string;
  recordedQuantityBefore:string;reasonCode:'SUSPECTED_UNRECORDED_DELIVERY'|'SUSPECTED_OUTDATED_COUNT'|'UNKNOWN';reasonNote:string|null;
  status:'OPEN'|'PARTIALLY_RESOLVED'|'RESOLVED';version:number;recordedCogsMinor?:string;provisionalCogsMinor?:string;
  unresolvedCogsMinor?:string;actualCogsMinor?:string;cogsAdjustmentMinor?:string;
}
export interface BackendStockShortfallPage {scope:'OUTLET';outletId:string;asOf:string;limit:number;nextAfter:string|null;totalOnPage:number;items:BackendStockShortfall[]}
export interface BackendStockShortfallEvidence {id:string;createdAt:string;type:'RECEIPT'|'COUNT_ADJUSTMENT';quantity:string;availableQuantity:string;documentReference:string|null}
export interface BackendStockExceptionReport {
  scope:'OUTLET';outletId:string;outletName:string;currency:string;timeZone:string;from:string;to:string;generatedAt:string;
  totals:{createdEvents:string;createdQuantity:string;affectedSales:string;affectedProducts:string;unresolvedQuantityNow:string;oldestOpenAt:string|null;
    resolutionsInPeriod:string;resolvedQuantityInPeriod:string;estimatedUnresolvedCogsMinor?:string;unresolvedCogsMinor?:string;
    unresolvedCogsFromSelectedCreationPeriodMinor?:string;actualCogsResolvedInPeriodMinor?:string;cogsAdjustmentInPeriodMinor?:string};
  byOperator:Array<{operatorId:string;operatorName:string;eventCount:string;quantity:string}>;
  byProduct:Array<{productId:string;sku:string;name:string;eventCount:string;quantity:string}>;
  coverage:{completeTotals:boolean;costVisible:boolean;policy:string};
}
export interface BackendCustomerAccount {id:string;name:string;phone:string;email:string|null;creditLimitMinor:string;balanceMinor:string;status:'ACTIVE'|'SUSPENDED';version:number;createdAt:string;updatedAt:string}
export interface BackendCustomerStatement {customer:BackendCustomerAccount;entries:Array<{id:string;type:'CHARGE'|'REPAYMENT';amountMinor:string;balanceAfterMinor:string;createdAt:string;reference:string|null;orderId:string|null;receiptNumber:string|null;allocations:Array<{amountMinor:string;receiptNumber:string;orderId:string}>}>;generatedAt:string;currency:string}
export interface BackendInventoryCountLine { productId:string;sku:string;name:string;unit:string;expectedQuantity:string|null;expectedBalanceVersion:number;countedQuantity:string|null;varianceReason:string|null;countedBy:string|null;countedAt:string|null;baselineRevision?:number;countedRevision?:number|null;requiresRecount?:boolean;referenceCostMinor?:string;inventoryValueMinor?:string }
export interface BackendInventoryCount { id:string;status:'OPEN'|'POSTED'|'CANCELLED';areaLabel:string|null;scope:'FULL'|'SELECTED';blind:boolean;version:number;baselineAt:string;openedAt:string;openedBy:string;postedAt:string|null;postedBy:string|null;lineCount:number;countedLineCount:number;lines:BackendInventoryCountLine[];revision?:number;coverage?:CountEvidenceCoverage }
export interface BackendInventoryCountSummary { id:string;status:'OPEN'|'POSTED'|'CANCELLED';areaLabel:string|null;scope:'FULL'|'SELECTED';blind:boolean;version:number;openedAt:string;openedBy:string;postedAt:string|null;postedBy:string|null;lineCount:number;countedLineCount:number }
export interface BackendRoom {id:string;roomNumber:string;roomType:string;nightlyRateMinor:number;taxRateBps:number;currency:string;status:'READY'|'OCCUPIED'|'DIRTY'|'MAINTENANCE';version:number;activeStay?:{id:string;guestName:string;checkInDate:string;checkOutDate:string;version:number}|null}
export interface BackendReservation {id:string;roomId:string;roomNumber:string;guestName:string;guestContact:string|null;checkInDate:string;checkOutDate:string;nightlyRateMinor:number;taxRateBps:number;currency:string;status:'CONFIRMED';version:number}
export interface BackendStay {id:string;roomId:string;roomNumber:string;roomVersion:number;guestName:string;guestContact:string|null;checkInDate:string;checkOutDate:string;checkedInAt:string;nightlyRateMinor:number;taxRateBps:number;currency:string;status:'CHECKED_IN';version:number;nights:number;estimatedSubtotalMinor:number;estimatedTaxMinor:number;estimatedTotalMinor:number}
export interface BackendCommand { protocolVersion:1;commandId:string;tenantId?:string;deviceId:string;type:string;occurredAt:string;expectedVersions:Record<string,number>;payload:Record<string,unknown> }
export interface BackendReportAccount { accountCode:string;accountName?:string;classification?:string;debitMinor:string;creditMinor:string;netDebitMinor:string;netCreditMinor:string }
export interface BackendTrialBalance {
  reportType:'TRIAL_BALANCE';scope:'TENANT';tenantId:string;tenantName:string;currency:string;timeZone:string;asOf:string;generatedAt:string;latestJournalAt:string|null;
  coverage:{status:'POSTED_JOURNAL_ONLY';journalEntryCount:string;emptyJournalEntryCount:string;unbalancedJournalEntryCount:string;sourceTypes:Array<{sourceType:string;entryCount:string}>;explanation:string};
  totals:{debitMinor:string;creditMinor:string;differenceMinor:string;balanced:boolean};accounts:BackendReportAccount[];
}
export interface BackendPartialOperatingSummary {
  reportType:'PARTIAL_OPERATING_SUMMARY';scope:'TENANT';tenantId:string;tenantName:string;currency:string;timeZone:string;from:string;to:string;generatedAt:string;latestJournalAt:string|null;
  coverage:{status:'PARTIAL';journalEntryCount:string;emptyJournalEntryCount:string;unbalancedJournalEntryCount:string;sourceTypes:Array<{sourceType:string;entryCount:string}>;unknownAccountCodes:string[];omittedSources:string[];explanation:string};
  totals:{revenueMinor:string;costOfGoodsSoldMinor:string;grossProfitMinor:string;otherIncomeMinor:string;otherOperatingCostsMinor:string;partialOperatingResultMinor:string};
  lines:Array<{accountCode:string;accountName?:string;classification?:string;section:string;amountMinor:string}>;
}
export interface BackendJournalLines {
  scope:'TENANT';accountCode:string;timeZone?:string;from?:string;to?:string;asOf?:string;limit:number;offset:number;total:string;nextOffset:number|null;
  entries:Array<{journalLineId?:string;journalEntryId:string;sourceType:string;sourceName?:string;sourceId:string|null;currency:string;postedAt:string;createdBy:string|null;accountCode:string;accountName?:string;debitMinor:string;creditMinor:string}>;
}
export interface BackendSaleReceipt {
  status:'CONFIRMED';fiscalDocumentStatus:'NOT_INTEGRATED';receiptId:string;receiptNumber:string;tenantName:string;outletName:string;timeZone:string;
  receiptProfile?:Partial<{legalName:string;registrationNumber:string;taxRegistrationNumber:string;address:string;phone:string;email:string;website:string;logoUrl:string;receiptQrImage:string;showQrOnReceipt:boolean;receiptHeader:string;receiptFooter:string;taxLabel:string;taxCalculation:'exclusive'}>;
  currency:string;createdAt:string;operatorName:string;saleStatus:string;
  lines:Array<{lineId:string;sku:string;name:string;quantity:string;itemKind?:CatalogItemKind;unrecordedQuantity?:string;provisionalCogsMinor?:string;unitPriceMinor:string;originalSubtotalMinor?:string;discountMinor?:string;discountReason?:string|null;taxRateBps:number;subtotalMinor:string;taxMinor:string;totalMinor:string}>;
  payments:Array<{method:string;amountMinor:string;currency:string;status:string;reference?:string|null;confirmation?:string;confirmedBy?:string|null;confirmedAt?:string|null}>;
  originalSubtotalMinor?:string;discountMinor?:string;subtotalMinor:string;taxMinor:string;totalMinor:string;amountPaidMinor:string;customerAccountCharge:{customerId:string;customerName:string;amountDueMinor:string}|null;cashTenderedMinor:string|null;changeMinor:string|null;
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
function isTerminalCredentialOutcome(result:unknown,operation:SecretOperationRecovery):boolean{
  if(!isTerminalOutcome(result,operation.commandId,operation.kind)||!isRecord(result))return false;
  if(result.status!=='CONFIRMED')return typeof result.code==='string'&&result.code.trim().length>0&&result.code!=='IDEMPOTENCY_MISMATCH';
  const value=result.value;
  return isRecord(value)&&value.userId===operation.targetUserId&&Number.isSafeInteger(value.credentialVersion)&&Number(value.credentialVersion)>=1&&Number.isSafeInteger(value.sessionsRevoked)&&Number(value.sessionsRevoked)>=0&&typeof value.reauthenticate==='boolean'&&value.reauthenticate===(operation.kind==='auth.password.change');
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
    throw new ApiClientError('We couldn’t check your sign-in. Try signing in again.','INVALID_SERVER_RESPONSE',200);
}

class ApiClient {
  private csrf=''; private session:BackendSession|null=null; private listeners=new Set<(session:BackendSession|null)=>void>();private recoveryListeners=new Set<(records:RecoverableCommand[])=>void>();
  private importRecoveryListeners=new Set<(records:ImportValidationRecovery[])=>void>();
  private secretRecoveryListeners=new Set<(records:SecretOperationRecovery[])=>void>();
  private pendingReadControllers = new Set<AbortController>();
  private contextChannel:BroadcastChannel|null=null;
  private pendingContextUserId:string|null=null;
  constructor(){
    if(typeof BroadcastChannel==='undefined')return;
    this.contextChannel=new BroadcastChannel('mazao-auth-context-v1');
    this.contextChannel.onmessage=event=>{
      const message=event.data;
      if(!isRecord(message)||typeof message.userId!=='string')return;
      if(message.type==='context-switch-pending'){
        if(this.session?.user.id!==message.userId)return;
        this.pendingContextUserId=message.userId;this.cancelPendingReads();this.csrf='';this.publish(null);return;
      }
      if(message.type==='context-switch-finished'){
        if(this.pendingContextUserId!==message.userId&&this.session?.user.id!==message.userId)return;
        this.pendingContextUserId=null;this.cancelPendingReads();this.csrf='';this.publish(null);
        void this.restore().catch(()=>{this.csrf='';this.publish(null);});
      }
    };
  }
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
  private reportRequestCompletion(path:string,response:Response,headersMs:number,bodyMs:number,parseMs:number,responseBytes:number|null,outcome:string){
    if(typeof window==='undefined')return;
    const requestId=(response.headers.get('x-request-id')??'').replace(/[^A-Za-z0-9._:-]/g,'').slice(0,128);
    if(!requestId)return;
    const timing=response.headers.get('server-timing')??'';
    const duration=(name:string)=>new RegExp(`(?:^|,\\s*)${name};dur=(\\d+(?:\\.\\d+)?)`).exec(timing)?.[1];
    const queryCount=/\bdbqueries;desc=(\d+)\b/.exec(timing)?.[1];
    const serverAppMs=duration('app');const serverHandlerMs=duration('handler');const serverDbMs=duration('db');
    const serverDbPoolMs=duration('dbpool');const serverSerializationMs=duration('serialize');
    const serverNginxMs=duration('nginx');
    window.dispatchEvent(new CustomEvent('mazao:api-request-completed',{detail:{requestId,route:requestRoute(path),status:response.status,outcome,headersMs:Math.round(headersMs),bodyMs:Math.round(bodyMs),parseMs:Math.round(parseMs),responseBytes,...(serverAppMs?{serverAppMs:Number(serverAppMs)}:{}),...(serverHandlerMs?{serverHandlerMs:Number(serverHandlerMs)}:{}),...(serverDbMs?{serverDbMs:Number(serverDbMs)}:{}),...(serverDbPoolMs?{serverDbPoolMs:Number(serverDbPoolMs)}:{}),...(serverSerializationMs?{serverSerializationMs:Number(serverSerializationMs)}:{}),...(serverNginxMs?{serverNginxMs:Number(serverNginxMs)}:{}),...(queryCount?{serverDbQueryCount:Number(queryCount)}:{})}}));
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
        if(controller.signal.reason==='timeout')throw new ApiClientError(isRead?apiErrorMessage('REQUEST_TIMED_OUT'):unconfirmedActionMessage(path),isRead?'REQUEST_TIMED_OUT':'OUTCOME_UNKNOWN',undefined,requestId);
        if(controller.signal.reason==='caller')throw new ApiClientError('This read was cancelled because its view is no longer active.','REQUEST_CANCELLED',undefined,requestId);
        throw new ApiClientError('This read was cancelled because its view is no longer active.','REQUEST_CANCELLED',undefined,requestId);
      }
      cleanup();
      if(isRead){const offline=typeof navigator!=='undefined'&&!navigator.onLine;throw new ApiClientError(offline?'You are offline. Reconnect and retry this read.':'The connection could not be completed. Retry this read.','CONNECTION_FAILED',undefined,requestId);}
      throw new ApiClientError(unconfirmedActionMessage(path),'OUTCOME_UNKNOWN',undefined,requestId);
    }
    try {
      let bodyText:string;
      try { bodyText=await response.text(); }
      catch {
        this.reportRequestCompletion(path,response,responseHeadersAt-requestStartedAt,performance.now()-responseHeadersAt,0,null,'incomplete_body');
        if(controller?.signal.aborted&&controller.signal.reason==='timeout')throw new ApiClientError(isRead?apiErrorMessage('REQUEST_TIMED_OUT'):unconfirmedActionMessage(path),isRead?'REQUEST_TIMED_OUT':'OUTCOME_UNKNOWN',response.status,response.headers.get('x-request-id')??requestId);
        if(controller?.signal.aborted)throw new ApiClientError('This read was cancelled because its view is no longer active.','REQUEST_CANCELLED',response.status,response.headers.get('x-request-id')??requestId);
        throw new ApiClientError(isRead?apiErrorMessage('INVALID_SERVER_RESPONSE',response.status):unconfirmedActionMessage(path),isRead?'INVALID_SERVER_RESPONSE':'OUTCOME_UNKNOWN',response.status,response.headers.get('x-request-id')??requestId);
      }
      let body:unknown;let parseMs=0;let invalidJson=false;
      const parseStartedAt=performance.now();
      try { body=JSON.parse(bodyText); }
      catch {
        invalidJson=true;
        body=undefined;
      }
      parseMs=performance.now()-parseStartedAt;
      const receivedBytes=new TextEncoder().encode(bodyText).length;
      this.reportRequestCompletion(path,response,responseHeadersAt-requestStartedAt,performance.now()-responseHeadersAt,parseMs,receivedBytes,invalidJson?(response.ok?'invalid_json':'invalid_error_json'):(response.ok?'success':'http_error'));
      if(invalidJson&&response.ok)throw new ApiClientError(isRead?apiErrorMessage('INVALID_SERVER_RESPONSE'):unconfirmedActionMessage(path),isRead?'INVALID_SERVER_RESPONSE':'OUTCOME_UNKNOWN',response.status,response.headers.get('x-request-id')??requestId);
      if(!response.ok){
        if(response.status===401&&path!=='/auth/login'){this.csrf='';this.publish(null)}
        const error=isRecord(body)&&isRecord(body.error)?body.error:{};
        const code=typeof error.code==='string'?error.code:`HTTP_${response.status}`;
        throw Object.assign(new ApiClientError(apiErrorMessage(code,response.status),code,response.status,response.headers.get('x-request-id')??requestId),{details:error.details});
      }
      if(!isRecord(body))throw new ApiClientError(isRead?apiErrorMessage('INVALID_SERVER_RESPONSE'):unconfirmedActionMessage(path),isRead?'INVALID_SERVER_RESPONSE':'OUTCOME_UNKNOWN',response.status,response.headers.get('x-request-id')??requestId);
      return body as T;
    } finally {cleanup();}
  }
  private async requestText(path:string,signal?:AbortSignal):Promise<string>{
    const started=performance.now();
    try{return await this.performRequestText(path,signal)}
    catch(cause){this.reportRequestFailure(path,cause,performance.now()-started);throw cause;}
  }
  private async performRequestText(path:string,signal?:AbortSignal):Promise<string>{
    const requestId=requestIdentifier();const controller=new AbortController();this.pendingReadControllers.add(controller);
    let slowWarningSent=false;let cleaned=false;let timedOut=false;
    let hardTimer:ReturnType<typeof setTimeout>|undefined;let slowTimer:ReturnType<typeof setTimeout>|undefined;
    const abortFromCaller=()=>controller.abort('caller');
    if(signal?.aborted)controller.abort('caller');else signal?.addEventListener('abort',abortFromCaller,{once:true});
    const cleanup=()=>{if(cleaned)return;cleaned=true;if(hardTimer!==undefined)clearTimeout(hardTimer);if(slowTimer!==undefined)clearTimeout(slowTimer);signal?.removeEventListener('abort',abortFromCaller);this.pendingReadControllers.delete(controller);if(slowWarningSent&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('mazao:api-request-finished',{detail:{requestId}}));};
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
        throw new ApiClientError(apiErrorMessage(code,response.status),code,response.status,response.headers.get('x-request-id')??requestId);
      }
      this.reportRequestCompletion(path,response,responseHeadersAt-requestStartedAt,performance.now()-responseHeadersAt,0,new TextEncoder().encode(text).length,'success');
      return text;
    }catch(cause){
      if(cause instanceof ApiClientError)throw cause;
      if(timedOut)throw new ApiClientError('This download took longer than expected. Try again.','REQUEST_TIMED_OUT',undefined,requestId);
      if(controller.signal.aborted)throw new ApiClientError('Download cancelled.','REQUEST_CANCELLED',undefined,requestId);
      const offline=typeof navigator!=='undefined'&&!navigator.onLine;
      throw new ApiClientError(offline?'You are offline. Reconnect and retry this download.':'The download could not be completed. Retry it.','CONNECTION_FAILED',undefined,requestId);
    }finally{cleanup();}
  }
  private async requestArray<T extends object>(path:string,field:keyof T & string,signal?:AbortSignal):Promise<T>{
    const result=await this.request<unknown>(path,{signal});
    if(!isRecord(result)||!Array.isArray(result[field as string]))throw new ApiClientError(apiErrorMessage('INVALID_SERVER_RESPONSE'),'INVALID_SERVER_RESPONSE',200);
    return result as T;
  }
  private async requestRecord<T extends object>(path:string,field:keyof T & string,signal?:AbortSignal):Promise<T>{
    const result=await this.request<unknown>(path,{signal});
    if(!isRecord(result)||!isRecord(result[field as string]))throw new ApiClientError(apiErrorMessage('INVALID_SERVER_RESPONSE'),'INVALID_SERVER_RESPONSE',200);
    return result as T;
  }
  async login(email:string,password:string,deviceId?:string):Promise<BackendSession|BackendAssignmentSelection>{
    try{const s=await this.request<unknown>('/auth/login',{method:'POST',body:JSON.stringify({email,password,...(deviceId?{deviceId}:{})})});assertBackendSession(s);this.csrf=s.csrfToken;this.publish(s);return s;}
    catch(cause){const error=cause as {code?:string;details?:{assignments?:BackendAssignmentChoice[]}};if(error.code==='ASSIGNMENT_REQUIRED'&&Array.isArray(error.details?.assignments))return {status:'ASSIGNMENT_REQUIRED',assignments:error.details.assignments};throw cause;}
    finally{password='';}
  }
  async listContextAssignments(signal?:AbortSignal):Promise<BackendAssignmentChoice[]>{
    const result=await this.request<{assignments:BackendAssignmentChoice[]}>('/auth/assignments',{signal});
    if(!Array.isArray(result.assignments)||result.assignments.some(item=>!isRecord(item)||typeof item.deviceId!=='string'||typeof item.deviceLabel!=='string'||typeof item.tenantId!=='string'||typeof item.tenantName!=='string'||typeof item.outletId!=='string'||typeof item.outletName!=='string'))
      throw new ApiClientError('The workspace assignment choices are incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);
    return result.assignments;
  }
  async inspectContextSwitchBlockers():Promise<BackendContextSwitchBlockers>{
    const session=this.session;
    if(!session)throw new ApiClientError('Sign in again before changing workspaces.','UNAUTHENTICATED',401);
    try{
      const [commands,imports,credentialChanges,countDrafts]=await Promise.all([
        this.listRecoverableCommands(session.tenant.id),this.listImportValidationRecovery(),this.listSecretOperationRecovery(),
        countDraftStore.listForScope({tenantId:session.tenant.id,actorId:session.user.id,outletId:session.outlet.id}),
      ]);
      return {commands:commands.filter(record=>record.command.deviceId===session.deviceId).length,imports:imports.length,credentialChanges:credentialChanges.length,
        ownPasswordChanges:credentialChanges.filter(record=>record.kind==='auth.password.change').length,
        staffPasswordChanges:credentialChanges.filter(record=>record.kind==='staff.password.set').length,countDrafts:countDrafts.length};
    }catch(cause){
      if(cause instanceof ApiClientError&&cause.code==='RECOVERY_STORAGE_UNAVAILABLE')throw cause;
      throw new ApiClientError('Local recovery storage could not be checked. Resolve the storage problem before changing workspaces.','RECOVERY_STORAGE_UNAVAILABLE');
    }
  }
  async switchContext(deviceId:string):Promise<BackendSession>{
    const previous=this.session;
    if(!previous)throw new ApiClientError('Sign in again before changing workspaces.','UNAUTHENTICATED',401);
    if(deviceId===previous.deviceId)return previous;
    this.cancelPendingReads();
    const transitionId=requestIdentifier();
    this.contextChannel?.postMessage({type:'context-switch-pending',userId:previous.user.id,transitionId});
    const finishTransition=()=>this.contextChannel?.postMessage({type:'context-switch-finished',userId:previous.user.id,transitionId});
    try{
      const next=await this.request<unknown>('/auth/context',{method:'POST',body:JSON.stringify({deviceId})});
      assertBackendSession(next);this.csrf=next.csrfToken;this.publish(next);
      finishTransition();
      return next;
    }catch(cause){
      const failure=cause as {code?:string;status?:number};
      const uncertain=['OUTCOME_UNKNOWN','CONNECTION_FAILED','REQUEST_TIMED_OUT','INVALID_SERVER_RESPONSE'].includes(failure.code??'')||(failure.status??0)>=500;
      if(!uncertain){finishTransition();throw cause;}
      try{
        const actual=await this.restore();
        if(actual?.user.id===previous.user.id&&actual.deviceId===deviceId){finishTransition();return actual;}
        if(actual){finishTransition();throw cause;}
      }catch(restoreFailure){
        if(restoreFailure===cause)throw cause;
        this.csrf='';this.publish(null);
        finishTransition();
        throw new ApiClientError('The workspace change could not be confirmed. Sign in again to load the active workspace.','SESSION_CONTEXT_UNKNOWN');
      }
      this.csrf='';this.publish(null);
      finishTransition();
      throw new ApiClientError('The workspace change could not be confirmed. Sign in again to load the active workspace.','SESSION_CONTEXT_UNKNOWN');
    }
  }
  async restore(){try{const s=await this.request<unknown>('/auth/me');assertBackendSession(s);this.csrf=s.csrfToken;this.publish(s);return s}catch(error){if((error as {status?:number}).status!==401)throw error;this.csrf='';this.publish(null);return null}}
  async logout(){await this.request('/auth/logout',{method:'POST'});this.csrf='';this.publish(null)}
  clearAuthenticatedSession(){this.csrf='';this.publish(null);}
  async listStaff(signal?:AbortSignal,options:HistoryOptions={}){
    const result=await this.request<BackendStaffDirectory>(historyUrl('/staff',options),{signal});
    if(!Array.isArray(result.staff)||!Array.isArray(result.roles)||!Array.isArray(result.outlets)||result.authorizationModel!=='COARSE_ROLE_MAP')
      throw new ApiClientError('The staff directory response is incomplete. Retry the staff read.','INVALID_SERVER_RESPONSE',200);
    return result;
  }
  async listWorkspaceAssignments(signal?:AbortSignal,options:HistoryOptions={}){
    const result=await this.request<{devices:BackendWorkspaceAssignment[];page?:HistoryPage}>(historyUrl('/devices',options),{signal});
    if(!Array.isArray(result.devices))throw new ApiClientError('The workspace assignment response is incomplete. Retry the assignments read.','INVALID_SERVER_RESPONSE',200);
    return result;
  }
  async getOwnSessions(signal?:AbortSignal,options:HistoryOptions={}){const result=await this.requestArray<BackendOperatorSessions>(historyUrl('/auth/sessions',options),'sessions',signal);if(typeof result.userId!=='string'||typeof result.credentialVersion!=='number')throw new ApiClientError('The session response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getStaffSessions(userId:string,signal?:AbortSignal,options:HistoryOptions={}){const result=await this.requestArray<BackendOperatorSessions>(historyUrl('/staff/'+encodeURIComponent(userId)+'/sessions',options),'sessions',signal);if(typeof result.userId!=='string'||typeof result.credentialVersion!=='number')throw new ApiClientError('The session response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getConfiguration(signal?:AbortSignal){
    const result=await this.request<{configuration:BackendConfiguration}>('/configuration',{signal});
    const configuration=result.configuration as unknown as Record<string,unknown>;
    if(!isRecord(configuration)||!isRecord(configuration.business)||!isRecord(configuration.outlet)||!Array.isArray(configuration.capabilities)||!Array.isArray(configuration.supportedCapabilities)||!isRecord(configuration.readiness)||!Array.isArray(configuration.readiness.checks))
      throw new ApiClientError('Business settings were returned without the required business, outlet, capability, or readiness data. Retry this read.','INVALID_SERVER_RESPONSE',200);
    for(const [name,record] of [['business',configuration.business],['outlet',configuration.outlet]] as const){
      if(typeof record.id!=='string'||typeof record.name!=='string'||typeof record.version!=='number'||!Number.isSafeInteger(record.version))
        throw new ApiClientError(`Business settings are missing required ${name} fields. Retry this read.`,'INVALID_SERVER_RESPONSE',200);
    }
    const currentOutlet=configuration.outlet as Record<string,unknown>;
    const rawOutlets:unknown[]=Array.isArray(configuration.outlets)?configuration.outlets:[{...currentOutlet,active:true}];
    const normalizedOutlets=rawOutlets.map(item=>{
      if(!isRecord(item)||typeof item.id!=='string'||typeof item.name!=='string'||typeof item.timeZone!=='string'||typeof item.version!=='number'||!Number.isSafeInteger(item.version))
        throw new ApiClientError('The outlet directory response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);
      const taxPolicy=isRecord(item.taxPolicy)&&typeof item.taxPolicy.defaultRateBps==='number'&&typeof item.taxPolicy.label==='string'&&typeof item.taxPolicy.reviewed==='boolean'?item.taxPolicy:null;
      return {...item,active:typeof item.active==='boolean'?item.active:true,taxPolicy} as Record<string,unknown>;
    });
    if(!normalizedOutlets.some(item=>item.id===currentOutlet.id))throw new ApiClientError('The current outlet is missing from the business outlet directory. Retry this read.','INVALID_SERVER_RESPONSE',200);
    configuration.outlets=normalizedOutlets;
    const currentTaxPolicy=isRecord(currentOutlet.taxPolicy)&&typeof currentOutlet.taxPolicy.defaultRateBps==='number'&&typeof currentOutlet.taxPolicy.label==='string'&&typeof currentOutlet.taxPolicy.reviewed==='boolean'?currentOutlet.taxPolicy:null;
    configuration.outlet={...currentOutlet,active:typeof currentOutlet.active==='boolean'?currentOutlet.active:true,taxPolicy:currentTaxPolicy};
    return result;
  }
  async getStockSalePolicy(signal?:AbortSignal){
    const result=await this.request<{policy:BackendStockSalePolicy}>('/configuration/stock-sale-policy',{signal});
    if(!isRecord(result.policy)||typeof result.policy.enabled!=='boolean'||typeof result.policy.version!=='number'||result.policy.requirePhysicalConfirmation!==true||result.policy.requireReason!==true)
      throw new ApiClientError('The stock sale policy response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);
    return result;
  }
  updateStockSalePolicy(enabled:boolean,allowZeroReferenceCost:boolean,version:number,commandId:string){
    const session=this.session;if(!session)throw new Error('Sign in before changing outlet policy.');
    return this.submitCommand({protocolVersion:1,commandId,tenantId:session.tenant.id,deviceId:session.deviceId,type:'configuration.stock_exception_policy.update',occurredAt:new Date().toISOString(),expectedVersions:{['stock-sale-policy:'+session.outlet.id]:version},payload:{enabled,allowZeroReferenceCost}});
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
  listCatalog(signal?:AbortSignal,options:BackendCatalogReadOptions={}){return this.requestArray<{items:BackendProduct[]}>('/catalog/items'+(options.includeArchived?'?includeArchived=true':''),'items',signal)}
  listCatalogCategories(signal?:AbortSignal,options:BackendCatalogReadOptions={}){return this.requestArray<{categories:BackendCatalogCategory[]}>('/catalog/categories'+(options.includeArchived?'?includeArchived=true':''),'categories',signal)}
  private catalogCommand(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>,commandId:string){
    const session=this.session;if(!session)throw new Error('Sign in before changing the catalogue.');
    return this.submitCommand({protocolVersion:1,commandId,tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
  }
  updateCatalogProduct(input:BackendCatalogProductUpdate,version:number,commandId:string){return this.catalogCommand('catalog.product.update',{...input},{['product:'+input.productId]:version},commandId)}
  setCatalogProductActive(productId:string,active:boolean,reason:string,version:number,commandId:string){return this.catalogCommand('catalog.product.set_active',{productId,active,reason},{['product:'+productId]:version},commandId)}
  changeCatalogProductKind(productId:string,itemKind:CatalogItemKind,reason:string,productVersion:number,balanceVersion:number|null,commandId:string){return this.catalogCommand('catalog.product.change_kind',{productId,itemKind,reason},{['product:'+productId]:productVersion,...(balanceVersion===null?{}:{['balance:'+productId]:balanceVersion})},commandId)}
  createCatalogCategory(name:string,commandId:string){return this.catalogCommand('catalog.category.create',{name},{},commandId)}
  updateCatalogCategory(categoryId:string,name:string,reason:string,version:number,commandId:string){return this.catalogCommand('catalog.category.update',{categoryId,name,reason},{['category:'+categoryId]:version},commandId)}
  setCatalogCategoryActive(categoryId:string,active:boolean,reason:string,version:number,commandId:string){return this.catalogCommand('catalog.category.set_active',{categoryId,active,reason},{['category:'+categoryId]:version},commandId)}
  mergeCatalogCategories(sourceCategoryId:string,targetCategoryId:string,reason:string,sourceVersion:number,targetVersion:number,commandId:string){return this.catalogCommand('catalog.category.merge',{sourceCategoryId,targetCategoryId,reason},{['category:'+sourceCategoryId]:sourceVersion,['category:'+targetCategoryId]:targetVersion},commandId)}
  listProductImports(signal?:AbortSignal,options:HistoryOptions={}){return this.requestArray<{batches:ProductImportBatchSummary[];page?:HistoryPage}>(historyUrl('/catalog/imports',options),'batches',signal)}
  getProductImport(batchId:string,signal?:AbortSignal){return this.requestRecord<{batch:ProductImportBatch}>('/catalog/imports/'+encodeURIComponent(batchId),'batch',signal)}
  async getProductImportErrorsCsv(batchId:string):Promise<string>{
    return this.requestText('/catalog/imports/'+encodeURIComponent(batchId)+'/errors.csv');
  }
  listCustomerAccounts(signal?:AbortSignal,options:HistoryOptions={}){return this.requestArray<{customers:BackendCustomerAccount[];page?:HistoryPage;summary?:{totalBalanceMinor:string;totalCreditLimitMinor:string;accountCount:number;debtors:number;suspended:number}}>(historyUrl('/customers',options),'customers',signal)}
  async getCustomerStatement(customerId:string,signal?:AbortSignal){const result=await this.request<BackendCustomerStatement>('/customers/'+encodeURIComponent(customerId)+'/statement',{signal});if(!isRecord(result.customer)||!Array.isArray(result.entries))throw new ApiClientError('The customer statement response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  listInventoryMovements(signal?:AbortSignal,options:HistoryOptions={}){return this.requestArray<{page?:HistoryPage;movements:Array<{id:string;timestamp:string;sku:string;productName:string;type:'sale'|'restock'|'adjustment';quantity:string;balanceAfter:string;note:string;reference?:string;valueMinor?:string}>}>(historyUrl('/inventory/movements',options),'movements',signal)}
  async listStockShortfalls(query:{from?:string;to?:string;status?:string;productId?:string;operatorId?:string;outletId?:string;reasonCode?:string;limit?:number;after?:string}={},signal?:AbortSignal){
    const result=await this.request<BackendStockShortfallPage>('/inventory/shortfalls?'+this.reportQuery(query),{signal});
    if(!Array.isArray(result.items)||typeof result.limit!=='number'||!Object.hasOwn(result,'nextAfter'))throw new ApiClientError('The stock exception list is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);
    return result;
  }
  getStockShortfallDetail(shortfallId:string,signal?:AbortSignal){return this.request<{exception:Record<string,unknown>}>('/inventory/shortfalls/'+encodeURIComponent(shortfallId),{signal});}
  getStockShortfallEvidence(shortfallId:string,signal?:AbortSignal,options:HistoryOptions={}){return this.request<{evidence:BackendStockShortfallEvidence[];page?:HistoryPage}>(historyUrl('/inventory/shortfalls/'+encodeURIComponent(shortfallId)+'/evidence',options),{signal});}
  async getStockExceptionReport(from:string,to:string,signal?:AbortSignal){
    const result=await this.request<BackendStockExceptionReport>('/reports/stock-exceptions?'+new URLSearchParams({from,to}),{signal});
    if(!isRecord(result.totals)||!Array.isArray(result.byOperator)||!Array.isArray(result.byProduct)||!isRecord(result.coverage))throw new ApiClientError('The stock exception report is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);
    return result;
  }
  getStockShortfallsCsv(query:{from:string;to:string;status?:string;productId?:string;operatorId?:string;outletId?:string;reasonCode?:string;limit?:number}={from:'',to:''},signal?:AbortSignal){return this.requestText('/reports/stock-exceptions.csv?'+this.reportQuery(query),signal);}
  resolveStockShortfall(input:{shortfallId:string;quantity:string;resolutionType:'OMITTED_RECEIPT'|'VERIFIED_COUNT_ADJUSTMENT';supportingMovementId:string;supportingDocumentReference?:string;reason:string},shortfallVersion:number,balanceVersion:number,productId:string,commandId:string){
    const session=this.session;if(!session)throw new Error('Sign in before resolving a stock exception.');
    return this.submitCommand({protocolVersion:1,commandId,tenantId:session.tenant.id,deviceId:session.deviceId,type:'inventory.sale_shortfall.resolve',occurredAt:new Date().toISOString(),expectedVersions:{['shortfall:'+input.shortfallId]:shortfallVersion,['balance:'+productId]:balanceVersion},payload:input});
  }
  listInventoryCounts(signal?:AbortSignal,options:HistoryOptions={}){return this.requestArray<{counts:BackendInventoryCountSummary[];page?:HistoryPage}>(historyUrl('/inventory/counts',options),'counts',signal)}
  async getCurrentInventoryCount(signal?:AbortSignal){const result=await this.request<unknown>('/inventory/counts/current',{signal});if(!isRecord(result)||!Object.hasOwn(result,'count')||(result.count!==null&&!isRecord(result.count)))throw new ApiClientError('The current stock count response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result as {count:BackendInventoryCount|null};}
  getInventoryCount(countId:string,signal?:AbortSignal){return this.requestRecord<{count:BackendInventoryCount}>('/inventory/counts/'+encodeURIComponent(countId),'count',signal)}
  async getInventoryCountReview(countId:string,signal?:AbortSignal){
    const result=await this.request<unknown>('/inventory/counts/'+encodeURIComponent(countId)+'/review',{signal});
    if(!isRecord(result)||!isCountReview(result.review,countId))throw new ApiClientError('The changed-item review is incomplete. Your count entries remain available. Retry the review.','INVALID_SERVER_RESPONSE',200);
    return result as {review:CountReview};
  }
  async getInventoryCountReviewMovements(countId:string,after:string,signal?:AbortSignal){
    const result=await this.request<unknown>('/inventory/counts/'+encodeURIComponent(countId)+'/review/movements?'+new URLSearchParams({after}),{signal});
    if(!isRecord(result)||typeof result.productId!=='string'||!Array.isArray(result.movements)||!result.movements.every(isCountReviewMovement)||!isCountMovementPage(result.page))throw new ApiClientError('The changed-item movements are incomplete. Retry this page.','INVALID_SERVER_RESPONSE',200);
    const page=result.page;
    if(result.movements.length>page.limit||result.movements.length>page.totalCount||page.hasMore&&result.movements.length===0||new Set(result.movements.map(item=>item.id)).size!==result.movements.length||result.movements.some(item=>BigInt(item.sequence)<=BigInt(page.lowerExclusive)||BigInt(item.sequence)>BigInt(page.upperInclusive)))throw new ApiClientError('The changed-item movements do not match this review range. Retry this page.','INVALID_SERVER_RESPONSE',200);
    return result as {productId:string;movements:CountReviewMovement[];page:CountMovementPage};
  }
  async listInventoryCountEvents(countId:string,signal?:AbortSignal,options:HistoryOptions={}){
    const result=await this.requestArray<{events:CountEvidenceEvent[];page:HistoryPage}>(historyUrl('/inventory/counts/'+encodeURIComponent(countId)+'/events',options),'events',signal);
    if(!result.events.every(isCountEvidenceEvent)||!isCountEventPage(result.page))throw new ApiClientError('The count evidence history is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);
    return result;
  }
  async getInventoryCountEvent(countId:string,eventId:string,signal?:AbortSignal){
    const result=await this.request<CountEvidenceDetail>('/inventory/counts/'+encodeURIComponent(countId)+'/events/'+encodeURIComponent(eventId),{signal});
    if(!isCountEvidenceEvent(result.event)||result.event.id!==eventId||!Array.isArray(result.lines)||!result.lines.every(line=>isRecord(line)&&isCountLineEvidence(line.after)&&(line.before===null||isCountLineEvidence(line.before))&&line.productId===line.after.productId&&(line.before===null||line.before.productId===line.productId)))throw new ApiClientError('This count history entry is incomplete. Retry the entry.','INVALID_SERVER_RESPONSE',200);
    return result;
  }
  async getCurrentShift(signal?:AbortSignal){const result=await this.request<unknown>('/shifts/current',{signal});if(!isRecord(result)||!Object.hasOwn(result,'shift')||(result.shift!==null&&!isRecord(result.shift)))throw new ApiClientError('The current shift response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result as {shift:BackendShift|null};}
  listShiftCashMovements(shiftId:string,signal?:AbortSignal,options:HistoryOptions={}){return this.requestArray<{movements:BackendShiftCashMovement[];page?:HistoryPage}>(historyUrl('/shifts/'+encodeURIComponent(shiftId)+'/cash-movements',options),'movements',signal)}
  listShiftCloseReports(signal?:AbortSignal,options:HistoryOptions={}){return this.requestArray<{reports:BackendShiftCloseReport[];page?:HistoryPage}>(historyUrl('/shifts/close-reports',options),'reports',signal)}
  listSalesOrders(signal?:AbortSignal,query:SaleHistoryQuery={}){const search=this.reportQuery(query).toString();return this.requestArray<SaleHistory>('/sales/orders'+(search?'?'+search:''),'orders',signal);}
  async getSaleReceipt(orderId:string,signal?:AbortSignal){const result=await this.request<BackendSaleReceipt>('/sales/orders/'+encodeURIComponent(orderId)+'/receipt',{signal});if(result.status!=='CONFIRMED'||!Array.isArray(result.lines)||!Array.isArray(result.payments)||typeof result.receiptNumber!=='string')throw new ApiClientError('The sale receipt response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getTrialBalance(asOf:string,signal?:AbortSignal){const result=await this.request<BackendTrialBalance>('/reports/trial-balance?'+new URLSearchParams({asOf}),{signal});if(!isRecord(result.totals)||!Array.isArray(result.accounts)||!isRecord(result.coverage))throw new ApiClientError('The trial balance response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getProfitLoss(from:string,to:string,signal?:AbortSignal){const result=await this.request<BackendPartialOperatingSummary>('/reports/profit-loss?'+new URLSearchParams({from,to}),{signal});if(!isRecord(result.totals)||!Array.isArray(result.lines)||!isRecord(result.coverage))throw new ApiClientError('The operating summary response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getOperationalAnalytics(from:string,to:string,signal?:AbortSignal){const result=await this.request<BackendOperationalAnalytics>('/reports/operational-analytics?'+new URLSearchParams({from,to}),{signal});if(!isRecord(result.totals)||!Array.isArray(result.daily)||!Array.isArray(result.topProducts)||!isRecord(result.coverage))throw new ApiClientError('The operating analytics response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  async getJournalLines(query:{accountCode:string;from?:string;to?:string;asOf?:string;limit?:number;offset?:number},signal?:AbortSignal){const result=await this.request<BackendJournalLines>('/reports/journal-lines?'+new URLSearchParams(Object.fromEntries(Object.entries(query).filter((entry):entry is [string,string|number]=>entry[1]!==undefined).map(([key,value])=>[key,String(value)])) ),{signal});if(!Array.isArray(result.entries)||typeof result.total!=='string'||typeof result.limit!=='number')throw new ApiClientError('The journal lines response is incomplete. Retry this read.','INVALID_SERVER_RESPONSE',200);return result;}
  getItemReport(query:ItemReportQuery,signal?:AbortSignal){return this.request<BackendItemReport>('/reports/items?'+this.reportQuery(query),{signal});}
  getItemEvents(query:ItemEventsQuery,signal?:AbortSignal){return this.request<BackendItemEvents>('/reports/item-events?'+this.reportQuery(query),{signal});}
  getItemReportCsv(query:ItemReportQuery,signal?:AbortSignal){return this.requestText('/reports/items.csv?'+this.reportQuery(query),signal);}
  getJournalSource(journalEntryId:string,signal?:AbortSignal){return this.request<BackendJournalSource>('/reports/journal-source/'+encodeURIComponent(journalEntryId),{signal});}
  getAccountingControls(signal?:AbortSignal){return this.request<AccountingControls>('/finance/controls',{signal});}
  getAccountCatalog(signal?:AbortSignal){return this.request<AccountCatalog>('/reports/account-catalog',{signal});}
  getCustomerBalanceReport(query:CustomerBalanceQuery,signal?:AbortSignal){return this.request<CustomerBalanceReport>('/reports/customer-balances?'+this.reportQuery(query),{signal});}
  getInventoryValueReport(query:InventoryValueQuery={},signal?:AbortSignal){return this.request<InventoryValueReport>('/reports/inventory-value?'+this.reportQuery(query),{signal});}
  listAccountingRecords<K extends AccountingRecordKind>(kind:K,query:{after?:string;limit?:number;reference?:string}={},signal?:AbortSignal){return this.request<AccountingRecordPage<K>>('/finance/records/'+encodeURIComponent(kind)+'?'+this.reportQuery(query),{signal});}
  private reportQuery(query:object){return new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined).map(([key,value]):[string,string]=>[key,String(value)]));}
  listHotelRooms(signal?:AbortSignal){return this.requestArray<{rooms:BackendRoom[]}>('/hospitality/rooms','rooms',signal)}
  listHotelReservations(signal?:AbortSignal,options:HistoryOptions={}){return this.requestArray<{reservations:BackendReservation[];page?:HistoryPage}>(historyUrl('/hospitality/reservations',options),'reservations',signal)}
  listHotelStays(signal?:AbortSignal){return this.requestArray<{stays:BackendStay[]}>('/hospitality/stays','stays',signal)}
  async submitCommand(command:BackendCommand){
    const hasSecret=(value:unknown):boolean=>Array.isArray(value)?value.some(hasSecret):!!value&&typeof value==='object'&&Object.entries(value).some(([key,entry])=>/password|credentialhash|passwordhash/i.test(key)||hasSecret(entry));
    if(hasSecret(command.payload))throw Object.assign(new Error('Credentials must use the private password endpoint.'),{code:'COMMAND_NOT_SENT'});
    if(command.type==='catalog.import.validate'||command.type==='catalog.import.revalidate')throw new Error('Use import validation transport; CSV source must not enter the command journal.');
    const actorId=this.session?.user.id;
    try{await commandJournal.save(command,'sending',actorId);}
    catch{throw Object.assign(new Error('This action was not sent because recovery details could not be saved on this device. Enable browser storage and try again.'),{code:'COMMAND_NOT_SENT'});}
    await this.emitRecovery();
    try{const result=await this.request<{commandId:string;status:string;value?:Record<string,unknown>;message?:string;code?:string}>('/commands',{method:'POST',body:JSON.stringify(command)});if(!isTerminalOutcome(result,command.commandId,command.type,command.payload,command.expectedVersions))throw new ApiClientError(unconfirmedActionMessage('/commands'),'OUTCOME_UNKNOWN');await commandJournal.remove(command.commandId);await this.emitRecovery();return presentOutcome(result)}
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
      if(!isTerminalCredentialOutcome(result,operation))throw new ApiClientError(unconfirmedActionMessage(path),'OUTCOME_UNKNOWN');
      await secretOperationJournal.remove(operation.commandId);
      await this.emitSecretRecovery();return presentOutcome(result);
    }catch(cause){
      // HTTP rejection alone is not a canonical outcome for the original ID.
      // Keep metadata until status/reconciliation proves completion or fencing.
      await secretOperationJournal.save({...operation,state:'outcome_unknown'});await this.emitSecretRecovery();throw cause;
    }finally{newPassword='';currentPassword='';}
  }
  async listSecretOperationRecovery():Promise<SecretOperationRecovery[]>{const session=this.session;try{return session?await secretOperationJournal.list(session.tenant.id,session.user.id):[];}catch{throw new ApiClientError(apiErrorMessage('RECOVERY_STORAGE_UNAVAILABLE'),'RECOVERY_STORAGE_UNAVAILABLE');}}
  private async finishSecretRecovery(operation:SecretOperationRecovery,result:{commandId:string;status:string;response:Record<string,unknown>}){
    if(!isRecord(result)||result.commandId!==operation.commandId||!isRecord(result.response)||result.response.status!==result.status||(result.response.commandId!==undefined&&result.response.commandId!==operation.commandId)||!isTerminalCredentialOutcome({...result.response,commandId:result.commandId},operation))throw new ApiClientError(unconfirmedActionMessage('/auth/password'),'INVALID_SERVER_RESPONSE');
    await secretOperationJournal.remove(operation.commandId);await this.emitSecretRecovery();return {...result,response:presentOutcome(result.response)};
  }
  async checkSecretOperationStatus(commandId:string){const operation=(await this.listSecretOperationRecovery()).find(record=>record.commandId===commandId);if(!operation)throw new ApiClientError('The original password recovery metadata could not be found.','RECOVERY_STORAGE_UNAVAILABLE');const result=await this.request<{commandId:string;status:string;response:Record<string,unknown>}>('/commands/'+encodeURIComponent(commandId));return this.finishSecretRecovery(operation,result);}
  async reconcileSecretOperation(operation:SecretOperationRecovery){
    const session=this.session;
    if(!session||operation.actorId!==session.user.id||operation.tenantId!==session.tenant.id)throw new ApiClientError('Sign in with the account that owns this password operation.','FORBIDDEN',403);
    const result=await this.request<{commandId:string;status:string;response:Record<string,unknown>}>('/auth/password/reconcile',{method:'POST',body:JSON.stringify({protocolVersion:1,commandId:operation.commandId,kind:operation.kind,targetUserId:operation.targetUserId,expectedCredentialVersion:operation.expectedCredentialVersion})});
    return this.finishSecretRecovery(operation,result);
  }
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
  async listImportValidationRecovery():Promise<ImportValidationRecovery[]>{const session=this.session;try{return session?await importValidationJournal.list(session.tenant.id,session.deviceId,session.user.id):[];}catch{throw new ApiClientError(apiErrorMessage('RECOVERY_STORAGE_UNAVAILABLE'),'RECOVERY_STORAGE_UNAVAILABLE');}}
  async discardUnconfirmedValidation(commandId:string){await importValidationJournal.remove(commandId);await this.emitImportRecovery();}
  private async emitImportRecovery(){const records=await this.listImportValidationRecovery();this.importRecoveryListeners.forEach(listener=>listener(records));}
  async checkCommandStatus(commandId:string){
    const result=await this.request<unknown>('/commands/'+encodeURIComponent(commandId));
    const stored=(await this.listRecoverableCommands(this.session?.tenant.id)).find(record=>record.command.commandId===commandId);
    if(!isTerminalCommandStatus(result,commandId,stored?.command.type,stored?.command.payload,stored?.command.expectedVersions))throw new ApiClientError(unconfirmedActionMessage('/commands'),'INVALID_SERVER_RESPONSE');
    await commandJournal.remove(commandId);await this.emitRecovery();return {...result,response:presentOutcome(result.response)};
  }
  async listRecoverableCommands(tenantId?:string):Promise<RecoverableCommand[]>{try{const actorId=this.session?.user.id;const records=await commandJournal.list(tenantId);return actorId?records.filter(record=>record.actorId===actorId):[]}catch{throw new ApiClientError(apiErrorMessage('RECOVERY_STORAGE_UNAVAILABLE'),'RECOVERY_STORAGE_UNAVAILABLE');}}
  private async emitRecovery(){const records=await commandJournal.list(this.session?.tenant.id);this.recoveryListeners.forEach(listener=>listener(records))}
}
export const apiClient=new ApiClient();
