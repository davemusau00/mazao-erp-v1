import { type ContractSchema, uuidSchema, versionSchema } from './contractValidation.js';
import { DomainError } from './contracts.js';
const object=(properties:Record<string,ContractSchema>,required=Object.keys(properties)):ContractSchema=>({type:'object',properties,required,additionalProperties:false});
const text=(maximum:number,required=false):ContractSchema=>({type:'string',maxLength:maximum,minLength:required?1:0,pattern:required?'^[^\\u0000-\\u001f\\u007f]*[^\\s\\u0000-\\u001f\\u007f][^\\u0000-\\u001f\\u007f]*$':'^[^\\u0000-\\u001f\\u007f]*$'});
const properties:Record<string,ContractSchema>={orderId:uuidSchema,version:versionSchema,status:{type:'string',pattern:'^(?:DRAFT|FIRED|CANCELLED)$'},held:{type:'boolean'},fireRevision:{type:'integer',minimum:0,maximum:100}};
const draftOutput=object({...properties,status:{type:'string',const:'DRAFT'},held:{type:'boolean',const:false},fireRevision:{type:'integer',const:0}});
const cancelledOutput=object({...properties,status:{type:'string',const:'CANCELLED'},held:{type:'boolean',const:false},fireRevision:{type:'integer',const:0}});
export const RESTAURANT_ORDER_CONTRACTS:Record<string,{payload:ContractSchema;output:ContractSchema}>={
  'restaurant.order.create':{payload:object({tableId:{type:['string','null'],format:'uuid'},serviceLabel:text(100,true)}),output:draftOutput},
  'restaurant.order.save':{payload:object({orderId:uuidSchema,instructions:text(500),lines:{type:'array',maxItems:100,items:object({lineId:uuidSchema,productId:uuidSchema,quantity:{type:'string',pattern:'^\\d{1,14}(?:\\.\\d{1,6})?$'},modifiers:{type:'array',items:text(100,true),maxItems:8,uniqueItems:true},instructions:text(500)},['productId','quantity','modifiers','instructions'])}}),output:object(properties)},
  'restaurant.order.hold':{payload:object({orderId:uuidSchema,held:{type:'boolean'},reason:text(500,true)}),output:object(properties)},
  'restaurant.order.cancel':{payload:object({orderId:uuidSchema,reason:text(500,true)}),output:cancelledOutput},
  'restaurant.order.fire':{payload:object({orderId:uuidSchema}),output:object({...properties,status:{type:'string',const:'FIRED'},held:{type:'boolean',const:false},fireRevision:{type:'integer',minimum:1,maximum:100},batchId:uuidSchema,ticketIds:{type:'array',items:uuidSchema,minItems:1,maxItems:100,uniqueItems:true},ticketType:{type:'string',pattern:'^(?:NEW|ADD_ON)$'}})},
};
export const RESTAURANT_ORDER_LIMITS={openOrders:200,linesPerOrder:100,historicalLinesPerOrder:500} as const;

export function normalizeRestaurantModifiers(value:unknown):string[] {
  if(!Array.isArray(value)||value.length>8)throw new DomainError('VALIDATION_FAILED','Use at most eight preparation choices.');
  const normalized=value.map(item=>{
    if(typeof item!=='string'||!item.trim()||item.trim().length>100||/[\u0000-\u001f\u007f]/.test(item))throw new DomainError('VALIDATION_FAILED','Preparation choices require 1 to 100 characters without control characters.');
    return item.trim();
  });
  if(new Set(normalized).size!==normalized.length)throw new DomainError('VALIDATION_FAILED','Each preparation choice can appear only once after trimming.');
  return normalized;
}
