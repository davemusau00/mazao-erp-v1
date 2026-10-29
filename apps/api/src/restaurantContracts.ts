import { type ContractSchema, uuidSchema, versionSchema } from './contractValidation.js';

const object = (properties: Record<string, ContractSchema>, required = Object.keys(properties)): ContractSchema => ({type:'object',properties,required,additionalProperties:false});
const name: ContractSchema = {type:'string',minLength:1,maxLength:100,pattern:'^[^\\u0000-\\u001f\\u007f]*\\S[^\\u0000-\\u001f\\u007f]*$'};
const stationIds = (minimum: number): ContractSchema => ({type:'array',items:uuidSchema,minItems:minimum,maxItems:8,uniqueItems:true});
const active: ContractSchema = {type:'boolean'};
const result = (key: string, lifecycle = false) => object({[key]:uuidSchema,version:versionSchema,...(lifecycle?{active}: {})});
export const RESTAURANT_CONTRACTS: Record<string,{payload:ContractSchema;output:ContractSchema}> = {
  'restaurant.section.save': {payload:object({sectionId:uuidSchema,name,active},['name','active']),output:result('sectionId',true)},
  'restaurant.table.save': {payload:object({tableId:uuidSchema,name,sectionId:{type:['string','null'],format:'uuid'},seats:{type:'integer',minimum:1,maximum:100},active},['name','sectionId','seats','active']),output:result('tableId',true)},
  'restaurant.station.save': {payload:object({stationId:uuidSchema,name,kind:{type:'string',pattern:'^(?:KITCHEN|BAR|EXPO)$'},charactersPerLine:{type:'integer',minimum:32,maximum:64},active},['name','kind','charactersPerLine','active']),output:result('stationId',true)},
  'restaurant.menu.save': {payload:object({productId:uuidSchema,stationIds:stationIds(1),preparationLabel:name,instructions:{type:'string',maxLength:500,pattern:'^[^\\u0000-\\u001f\\u007f]*$'},available:active}),output:result('productId')},
  'restaurant.station.assign': {payload:object({deviceId:uuidSchema,stationIds:stationIds(0)}),output:result('deviceId')},
};

export const RESTAURANT_LIMITS = {sections:100,tables:500,stations:100,menuRoutes:2000} as const;
export const RESTAURANT_AVAILABILITY = {ordering:false,fire:false,kds:false,printing:false,roomCharge:false,recipeConsumption:false} as const;
