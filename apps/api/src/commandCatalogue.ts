import { DomainError, type ApiPermission, type CommandEnvelope } from './contracts.js';
import { assertContract, type ContractSchema, uuidSchema, versionSchema, versionsSchema } from './contractValidation.js';
import { COMMAND_ENVELOPE_SCHEMA } from './publicInputs.js';
import { RESTAURANT_CONTRACTS } from './restaurantContracts.js';
import { RESTAURANT_ORDER_CONTRACTS } from './restaurantOrderContracts.js';

export interface CommandContract {
  schemaVersion: 1;
  transport: 'commands' | 'credential';
  permissions: readonly ApiPermission[];
  capabilities: readonly string[];
  offlineMode: 'ONLINE_ONLY';
  validation: 'SCHEMA_AND_DOMAIN' | 'DOMAIN_PAYLOAD';
  inputSchema: ContractSchema;
  outputSchema: ContractSchema;
  domainHandler: string;
  effects: readonly string[];
  approval: 'EXISTING_DOMAIN_RULES';
  isolation: 'SERIALIZABLE_WITH_DOMAIN_LOCKS';
  idempotency: 'TENANT_COMMAND_ID_WITH_ACTOR_OUTLET_RECOVERY';
  audit: 'DOMAIN_AUDIT_AND_OUTBOX';
}

const objectResult: ContractSchema = { type: 'object' };
const minorSchema: ContractSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
// Match staff.text(): 1..500 characters after trimming, with no controls in
// the original value. Do not rewrite the value retained in the command hash.
const reasonSchema: ContractSchema = {
  type: 'string', minLength: 1,
  pattern: '^[^\\S\\u0000-\\u001f\\u007f]*[^\\s\\u0000-\\u001f\\u007f](?:[^\\u0000-\\u001f\\u007f]{0,498}[^\\s\\u0000-\\u001f\\u007f])?[^\\S\\u0000-\\u001f\\u007f]*$',
};
const strictObject = (properties: Record<string, ContractSchema>, required = Object.keys(properties)): ContractSchema => ({ type: 'object', properties, required, additionalProperties: false });
function normalizedTextSchema(max: number, allowEmpty = false): ContractSchema {
  const spaces = '[^\\S\\u0000-\\u001f\\u007f]*';
  const content = `[^\\s\\u0000-\\u001f\\u007f](?:[^\\u0000-\\u001f\\u007f]{0,${max-2}}[^\\s\\u0000-\\u001f\\u007f])?`;
  return {type:'string',pattern:`^${spaces}${allowEmpty?`(?:${content})?`:content}${spaces}$`};
}
const catalogueNameSchema = normalizedTextSchema(160);
const categoryNameSchema = normalizedTextSchema(80);
const categoryLabelSchema = normalizedTextSchema(80, true);
const reorderSchema: ContractSchema = {type:'string',pattern:'^[^\\S\\u0000-\\u001f\\u007f]*\\d{1,14}(?:\\.\\d{1,6})?[^\\S\\u0000-\\u001f\\u007f]*$'};
const barcodeSchema: ContractSchema = {type:['string','null'],pattern:'^[^\\S\\u0000-\\u001f\\u007f]*(?:[A-Za-z0-9._/-]{1,64})?[^\\S\\u0000-\\u001f\\u007f]*$'};
const itemKindSchema: ContractSchema = {type:'string',pattern:'^(?:STOCKED_GOOD|SERVICE|PREPARED)$'};
const affectedProductsSchema: ContractSchema = {type:'array',items:uuidSchema,minItems:1,maxItems:5000,uniqueItems:true};

// Each migrated schema is used at execution. Remaining entries deliberately
// describe only the object boundary; their referenced domain validator remains
// authoritative until that command receives a reviewed schema migration.
const migrated: Record<string, { payload: ContractSchema; output: ContractSchema }> = {
  ...RESTAURANT_CONTRACTS,
  ...RESTAURANT_ORDER_CONTRACTS,
  'inventory.count.post': {
    payload: strictObject({countId:uuidSchema,valuationReason:reasonSchema}, ['countId']),
    output: objectResult,
  },
  'inventory.count.open': {
    payload: strictObject({
      areaLabel: normalizedTextSchema(100, true),
      scope: {type:'string',pattern:'^(?:FULL|SELECTED)$'},
      productIds: {type:'array',items:uuidSchema,minItems:1,maxItems:5000,uniqueItems:true},
      blind: {type:'boolean'},
    }, []),
    output: strictObject({countId:uuidSchema,status:{type:'string',const:'OPEN'},scope:{type:'string',pattern:'^(?:FULL|SELECTED)$'},blind:{type:'boolean'},lineCount:minorSchema,version:versionSchema,baselineAt:{type:'string',format:'date-time'}}),
  },
  'inventory.count.review': {
    payload: strictObject({countId:uuidSchema,reason:reasonSchema,reviewFingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},affectedProductIds:affectedProductsSchema}),
    output: strictObject({countId:uuidSchema,version:versionSchema,reviewId:uuidSchema,revision:versionSchema,affectedProductIds:affectedProductsSchema}),
  },
  'configuration.go_live.approve': {
    payload: strictObject({reason:reasonSchema}),
    output: strictObject({tenantId:uuidSchema,status:{type:'string',const:'LIVE'},reviewedAt:{type:'string',format:'date-time'}}),
  },
  'configuration.outlet.create': {
    payload: strictObject({name:normalizedTextSchema(160),timeZone:normalizedTextSchema(100),address:normalizedTextSchema(500,true),phone:normalizedTextSchema(40,true),email:normalizedTextSchema(254,true),receiptHeader:normalizedTextSchema(500,true),receiptFooter:normalizedTextSchema(500,true),taxPolicy:{type:['object','null'],properties:{calculation:{type:'string',const:'exclusive'},defaultRateBps:{type:'integer',minimum:0,maximum:10000},label:normalizedTextSchema(40),reviewed:{type:'boolean'}},required:['defaultRateBps','label','reviewed'],additionalProperties:false}},['name','timeZone','address','phone','email','receiptHeader','receiptFooter']),
    output: strictObject({outletId:uuidSchema,version:versionSchema,active:{type:'boolean'},businessVersion:versionSchema}),
  },
  'configuration.outlet.set_active': {
    payload: strictObject({outletId:uuidSchema,active:{type:'boolean'},reason:reasonSchema}),
    output: strictObject({outletId:uuidSchema,version:versionSchema,active:{type:'boolean'}}),
  },
  'configuration.outlet.update': {
    payload: strictObject({outletId:uuidSchema,id:uuidSchema,version:versionSchema,active:{type:'boolean'},name:normalizedTextSchema(160),timeZone:normalizedTextSchema(100),address:normalizedTextSchema(500,true),phone:normalizedTextSchema(40,true),email:normalizedTextSchema(254,true),receiptHeader:normalizedTextSchema(500,true),receiptFooter:normalizedTextSchema(500,true),taxPolicy:{type:['object','null'],properties:{calculation:{type:'string',const:'exclusive'},defaultRateBps:{type:'integer',minimum:0,maximum:10000},label:normalizedTextSchema(40),reviewed:{type:'boolean'}},required:['defaultRateBps','label','reviewed'],additionalProperties:false}},['name','timeZone','address','phone','email','receiptHeader','receiptFooter']),
    output: strictObject({outletId:uuidSchema,version:versionSchema}),
  },
  'catalog.product.change_kind': {
    payload: strictObject({productId:uuidSchema,itemKind:itemKindSchema,reason:reasonSchema}),
    output: strictObject({productId:uuidSchema,itemKind:itemKindSchema,version:versionSchema,stockTracked:{type:'boolean'}}),
  },
  'catalog.product.update': {
    payload: strictObject({productId:uuidSchema,name:catalogueNameSchema,sellingPriceMinor:minorSchema,costPriceMinor:minorSchema,
      taxRateBps:{type:'integer',minimum:0,maximum:10_000},category:categoryLabelSchema,barcode:barcodeSchema,reorderLevel:reorderSchema,reason:reasonSchema}),
    output: strictObject({productId:uuidSchema,version:versionSchema,active:{type:'boolean'}}),
  },
  'catalog.product.set_active': {
    payload: strictObject({productId:uuidSchema,active:{type:'boolean'},reason:reasonSchema}),
    output: strictObject({productId:uuidSchema,version:versionSchema,active:{type:'boolean'}}),
  },
  'catalog.category.create': {
    payload: strictObject({name:categoryNameSchema}),
    output: strictObject({categoryId:uuidSchema,version:versionSchema,active:{type:'boolean'}}),
  },
  'catalog.category.update': {
    payload: strictObject({categoryId:uuidSchema,name:categoryNameSchema,reason:reasonSchema}),
    output: strictObject({categoryId:uuidSchema,version:versionSchema,active:{type:'boolean'}}),
  },
  'catalog.category.set_active': {
    payload: strictObject({categoryId:uuidSchema,active:{type:'boolean'},reason:reasonSchema}),
    output: strictObject({categoryId:uuidSchema,version:versionSchema,active:{type:'boolean'}}),
  },
  'catalog.category.merge': {
    payload: strictObject({sourceCategoryId:uuidSchema,targetCategoryId:uuidSchema,reason:reasonSchema}),
    output: strictObject({sourceCategoryId:uuidSchema,targetCategoryId:uuidSchema,sourceVersion:versionSchema,targetVersion:versionSchema,updatedProducts:minorSchema}),
  },
  'shift.open': {
    payload: strictObject({ openingFloatMinor: minorSchema }),
    output: strictObject({ shiftId: uuidSchema, version: versionSchema, openingFloatMinor: minorSchema }),
  },
  'hotel.room.mark_ready': {
    payload: strictObject({ roomId: uuidSchema }),
    output: strictObject({ roomId: uuidSchema, status: { type: 'string', const: 'READY' }, version: versionSchema }),
  },
  'auth.session.revoke': {
    payload: strictObject({ sessionId: uuidSchema, reason: reasonSchema }),
    output: strictObject({ sessionId: uuidSchema, version: versionSchema, reauthenticate: { type: 'boolean' } }),
  },
  'staff.sessions.revoke': {
    payload: strictObject({ userId: uuidSchema, sessionId: uuidSchema, reason: reasonSchema }),
    output: strictObject({ sessionId: uuidSchema, version: versionSchema, reauthenticate: { type: 'boolean' } }),
  },
};

const credentialProperties: Record<string, ContractSchema> = {
  protocolVersion: { type: 'integer', const: 1 }, commandId: uuidSchema, expectedVersions: versionsSchema,
  newPassword: { type: 'string', minLength: 12, maxLength: 256 },
};

function contract(name: string, permissions: readonly ApiPermission[], capabilities: readonly string[], domainHandler: string, effects: readonly string[], transport: CommandContract['transport'] = 'commands'): CommandContract {
  const schema = migrated[name];
  return {
    schemaVersion: 1, transport, permissions, capabilities, offlineMode: 'ONLINE_ONLY',
    validation: schema ? 'SCHEMA_AND_DOMAIN' : 'DOMAIN_PAYLOAD',
    inputSchema: transport === 'credential' ? strictObject({
      ...credentialProperties,
      ...(name === 'auth.password.change' ? { currentPassword: { type: 'string' as const, maxLength: 256 } } : {}),
    }) : {
      ...COMMAND_ENVELOPE_SCHEMA,
      properties: { ...COMMAND_ENVELOPE_SCHEMA.properties, type: { type: 'string', const: name }, payload: schema?.payload ?? { type: 'object' } },
    },
    outputSchema: schema?.output ?? objectResult,
    domainHandler, effects, approval: 'EXISTING_DOMAIN_RULES',
    isolation: 'SERIALIZABLE_WITH_DOMAIN_LOCKS', idempotency: 'TENANT_COMMAND_ID_WITH_ACTOR_OUTLET_RECOVERY', audit: 'DOMAIN_AUDIT_AND_OUTBOX',
  };
}

/** Version 1 catalogue: one entry for every executable/recoverable command.
 * Payload-dependent permissions (discount, credit, exception approval) remain
 * in the domain handler and cannot be granted by this baseline. */
export const COMMAND_CATALOGUE: Readonly<Record<string, CommandContract>> = {
  'restaurant.order.create': contract('restaurant.order.create', ['restaurant.order'], ['restaurant','commerce'], 'restaurantOrders.ts#executeRestaurantOrderCommand', ['restaurant_order']),
  'restaurant.order.save': contract('restaurant.order.save', ['restaurant.order'], ['restaurant','commerce'], 'restaurantOrders.ts#executeRestaurantOrderCommand', ['restaurant_order','restaurant_draft_quote']),
  'restaurant.order.hold': contract('restaurant.order.hold', ['restaurant.order'], ['restaurant','commerce'], 'restaurantOrders.ts#executeRestaurantOrderCommand', ['restaurant_order']),
  'restaurant.order.cancel': contract('restaurant.order.cancel', ['restaurant.order'], ['restaurant','commerce'], 'restaurantOrders.ts#executeRestaurantOrderCommand', ['restaurant_order']),
  'restaurant.order.fire': contract('restaurant.order.fire', ['restaurant.order'], ['restaurant','commerce'], 'restaurantOrders.ts#executeRestaurantOrderCommand', ['restaurant_order','immutable_ticket_batch']),
  'restaurant.ticket.advance': contract('restaurant.ticket.advance', ['restaurant.ticket.work'], ['restaurant','commerce'], 'restaurantOrders.ts#executeRestaurantOrderCommand', ['immutable_ticket_state_event']),
  'restaurant.section.save': contract('restaurant.section.save', ['restaurant.manage'], ['restaurant','commerce'], 'restaurant.ts#executeRestaurantCommand', ['restaurant_configuration']),
  'restaurant.table.save': contract('restaurant.table.save', ['restaurant.manage'], ['restaurant','commerce'], 'restaurant.ts#executeRestaurantCommand', ['restaurant_configuration']),
  'restaurant.station.save': contract('restaurant.station.save', ['restaurant.manage'], ['restaurant','commerce'], 'restaurant.ts#executeRestaurantCommand', ['restaurant_configuration']),
  'restaurant.menu.save': contract('restaurant.menu.save', ['restaurant.manage'], ['restaurant','commerce'], 'restaurant.ts#executeRestaurantCommand', ['restaurant_configuration']),
  'restaurant.station.assign': contract('restaurant.station.assign', ['restaurant.manage','devices.manage'], ['restaurant','commerce'], 'restaurant.ts#executeRestaurantCommand', ['restaurant_configuration','logical_station_assignment']),
  'catalog.product.create': contract('catalog.product.create', ['catalog.manage'], [], 'commands.ts#createProduct', ['catalogue']),
  'catalog.product.update': contract('catalog.product.update', ['catalog.manage'], [], 'catalogMaintenance.ts#executeCatalogMaintenanceCommand', ['catalogue']),
  'catalog.product.set_active': contract('catalog.product.set_active', ['catalog.manage'], [], 'catalogMaintenance.ts#executeCatalogMaintenanceCommand', ['catalogue']),
  'catalog.product.change_kind': contract('catalog.product.change_kind', ['catalog.manage'], [], 'catalogMaintenance.ts#executeCatalogMaintenanceCommand', ['catalogue','stock_tracking']),
  'catalog.category.create': contract('catalog.category.create', ['catalog.manage'], [], 'catalogMaintenance.ts#executeCatalogMaintenanceCommand', ['category']),
  'catalog.category.update': contract('catalog.category.update', ['catalog.manage'], [], 'catalogMaintenance.ts#executeCatalogMaintenanceCommand', ['category','catalogue']),
  'catalog.category.set_active': contract('catalog.category.set_active', ['catalog.manage'], [], 'catalogMaintenance.ts#executeCatalogMaintenanceCommand', ['category']),
  'catalog.category.merge': contract('catalog.category.merge', ['catalog.manage'], [], 'catalogMaintenance.ts#executeCatalogMaintenanceCommand', ['category','catalogue']),
  'catalog.import.validate': contract('catalog.import.validate', ['catalog.manage'], [], 'productImport.ts#executeProductImportCommand', ['import_draft']),
  'catalog.import.revalidate': contract('catalog.import.revalidate', ['catalog.manage'], [], 'productImport.ts#executeProductImportCommand', ['import_draft']),
  'catalog.import.apply': contract('catalog.import.apply', ['catalog.manage'], [], 'productImport.ts#executeProductImportCommand', ['catalogue', 'stock', 'journal']),
  'inventory.receive': contract('inventory.receive', ['inventory.receive'], ['inventory'], 'commands.ts#receiveInventory', ['stock', 'journal']),
  'inventory.count.open': contract('inventory.count.open', ['inventory.count'], ['inventory'], 'commands.ts#openStockCount', ['stock_count']),
  'inventory.count.save': contract('inventory.count.save', ['inventory.count'], ['inventory'], 'commands.ts#saveStockCount', ['stock_count']),
  'inventory.count.review': contract('inventory.count.review', ['inventory.count.approve'], ['inventory'], 'countRecovery.ts#reviewStockCount', ['stock_count','count_evidence']),
  'inventory.count.post': contract('inventory.count.post', ['inventory.count.approve'], ['inventory'], 'commands.ts#postStockCount', ['stock_count', 'count_evidence', 'stock', 'journal']),
  'inventory.count.cancel': contract('inventory.count.cancel', ['inventory.count.approve'], ['inventory'], 'commands.ts#cancelStockCount', ['stock_count']),
  'inventory.sale_shortfall.resolve': contract('inventory.sale_shortfall.resolve', ['inventory.shortfall.resolve'], ['inventory'], 'stockShortfalls.ts#executeStockExceptionCommand', ['stock_exception', 'stock', 'journal']),
  'shift.open': contract('shift.open', ['shift.open'], ['commerce'], 'commands.ts#openShift', ['shift', 'journal']),
  'shift.cash.movement': contract('shift.cash.movement', ['shift.payout'], ['commerce'], 'commands.ts#recordShiftCashMovement', ['shift', 'journal']),
  'shift.close': contract('shift.close', ['shift.close'], ['commerce'], 'commands.ts#closeShift', ['shift', 'close_report', 'journal']),
  'sales.order.settle': contract('sales.order.settle', ['commerce.sell'], ['commerce'], 'commands.ts#settleSale', ['sale', 'receipt', 'tender', 'customer_account', 'stock', 'journal']),
  'sales.order.refund': contract('sales.order.refund', ['commerce.refund'], ['commerce'], 'commands.ts#refundSale', ['refund', 'tender', 'stock', 'journal']),
  'finance.expense.record': contract('finance.expense.record', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['expense', 'journal']),
  'finance.account.label': contract('finance.account.label', ['finance.manage'], [], 'accountCatalog.ts#executeAccountCatalogCommand', ['account_label']),
  'finance.expense.reverse': contract('finance.expense.reverse', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['expense', 'journal']),
  'finance.expense.reclassify': contract('finance.expense.reclassify', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['expense', 'journal']),
  'finance.supplier.create': contract('finance.supplier.create', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['supplier']),
  'finance.supplier.invoice': contract('finance.supplier.invoice', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['supplier_invoice', 'journal']),
  'finance.supplier.invoice.reverse': contract('finance.supplier.invoice.reverse', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['supplier_invoice', 'journal']),
  'finance.supplier.payment': contract('finance.supplier.payment', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['supplier_payment', 'journal']),
  'finance.mpesa.statement.record': contract('finance.mpesa.statement.record', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['mpesa_statement']),
  'finance.mpesa.statement.match': contract('finance.mpesa.statement.match', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['mpesa_statement', 'settlement', 'journal']),
  'finance.mpesa.statement.correct': contract('finance.mpesa.statement.correct', ['finance.manage'], [], 'accounting.ts#executeAccountingCommand', ['mpesa_statement', 'settlement', 'journal']),
  'finance.period.create': contract('finance.period.create', ['finance.close'], [], 'accounting.ts#executeAccountingCommand', ['financial_period']),
  'finance.period.transition': contract('finance.period.transition', ['finance.close'], [], 'accounting.ts#executeAccountingCommand', ['financial_period']),
  'customers.account.create': contract('customers.account.create', ['customers.manage'], ['commerce'], 'commands.ts#createCustomerAccount', ['customer_account']),
  'customers.account.update': contract('customers.account.update', ['customers.manage'], ['commerce'], 'commands.ts#updateCustomerAccount', ['customer_account']),
  'customers.repayment': contract('customers.repayment', ['customers.settle'], ['commerce'], 'commands.ts#recordCustomerRepayment', ['customer_account', 'tender', 'shift', 'journal']),
  'hotel.room.create': contract('hotel.room.create', ['hotel.manage'], ['hospitality'], 'commands.ts#createHotelRoom', ['room']),
  'hotel.reservation.create': contract('hotel.reservation.create', ['hotel.frontdesk'], ['hospitality'], 'commands.ts#createReservation', ['reservation', 'room']),
  'hotel.reservation.cancel': contract('hotel.reservation.cancel', ['hotel.frontdesk'], ['hospitality'], 'commands.ts#cancelReservation', ['reservation', 'room']),
  'hotel.checkin': contract('hotel.checkin', ['hotel.frontdesk'], ['hospitality'], 'commands.ts#checkInGuest', ['reservation', 'stay', 'room']),
  'hotel.checkout': contract('hotel.checkout', ['hotel.frontdesk'], ['hospitality'], 'commands.ts#checkOutGuest', ['stay', 'room', 'tender', 'shift', 'journal']),
  'hotel.room.mark_ready': contract('hotel.room.mark_ready', ['hotel.housekeeping'], ['hospitality'], 'commands.ts#markRoomReady', ['room', 'housekeeping']),
  'configuration.business.update': contract('configuration.business.update', ['config.manage'], [], 'configuration.ts#executeConfigurationCommand', ['configuration']),
  'configuration.outlet.update': contract('configuration.outlet.update', ['config.manage'], [], 'configuration.ts#executeConfigurationCommand', ['configuration']),
  'configuration.outlet.create': contract('configuration.outlet.create', ['config.manage'], [], 'configuration.ts#executeConfigurationCommand', ['configuration','outlet']),
  'configuration.outlet.set_active': contract('configuration.outlet.set_active', ['config.manage'], [], 'configuration.ts#executeConfigurationCommand', ['configuration','outlet','session_revocation']),
  'configuration.capabilities.update': contract('configuration.capabilities.update', ['config.manage'], [], 'configuration.ts#executeConfigurationCommand', ['configuration']),
  'configuration.go_live.approve': contract('configuration.go_live.approve', ['config.manage'], [], 'configuration.ts#executeConfigurationCommand', ['configuration', 'go_live_review']),
  'configuration.stock_exception_policy.update': contract('configuration.stock_exception_policy.update', ['inventory.shortfall.configure'], ['inventory'], 'stockShortfalls.ts#executeStockExceptionCommand', ['configuration', 'stock_exception_policy']),
  'staff.member.create': contract('staff.member.create', ['staff.manage'], [], 'staff.ts#executeStaffCommand', ['identity', 'membership']),
  'staff.member.update': contract('staff.member.update', ['staff.manage'], [], 'staff.ts#executeStaffCommand', ['membership', 'session_revocation']),
  'staff.member.set_active': contract('staff.member.set_active', ['staff.manage'], [], 'staff.ts#executeStaffCommand', ['membership', 'session_revocation']),
  'staff.sessions.revoke': contract('staff.sessions.revoke', ['staff.manage'], [], 'staff.ts#executeStaffCommand', ['session_revocation']),
  'devices.assignment.create': contract('devices.assignment.create', ['devices.manage'], [], 'staff.ts#executeStaffCommand', ['workspace_assignment']),
  'devices.assignment.update': contract('devices.assignment.update', ['devices.manage'], [], 'staff.ts#executeStaffCommand', ['workspace_assignment', 'session_revocation']),
  'devices.assignment.revoke': contract('devices.assignment.revoke', ['devices.manage'], [], 'staff.ts#executeStaffCommand', ['workspace_assignment', 'session_revocation']),
  'auth.session.revoke': contract('auth.session.revoke', [], [], 'staff.ts#executeStaffCommand', ['session_revocation']),
  'staff.password.set': contract('staff.password.set', ['staff.manage'], [], 'credentials.ts#changeCredential', ['credential', 'session_revocation'], 'credential'),
  'auth.password.change': contract('auth.password.change', [], [], 'credentials.ts#changeCredential', ['credential', 'session_revocation'], 'credential'),
};

export function validateCommandPayload(envelope: CommandEnvelope): void {
  const entry = Object.hasOwn(COMMAND_CATALOGUE, envelope.type) ? COMMAND_CATALOGUE[envelope.type] : undefined;
  // Unknown command types retain the controlled domain rejection and recovery
  // checks. Dedicated credential operations never execute through this route.
  if (!entry || entry.transport !== 'commands') return;
  const schema = entry.inputSchema.properties?.payload;
  if (!schema) throw new DomainError('INTERNAL_ERROR', 'Command contract is unavailable.', 500);
  assertContract(envelope.payload, schema, 'Command payload');
}
