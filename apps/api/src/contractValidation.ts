import { DomainError } from './contracts.js';

/** The deliberately small JSON Schema vocabulary used by the first migrated
 * contracts. No coercion, default insertion, or removal of unknown properties. */
type ContractType = 'object' | 'array' | 'string' | 'integer' | 'boolean' | 'null';
export interface ContractSchema {
  type: ContractType | readonly ContractType[];
  properties?: Readonly<Record<string, ContractSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean | ContractSchema;
  items?: ContractSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'uuid' | 'date-time' | 'email';
  minimum?: number;
  maximum?: number;
  const?: string | number | boolean;
}

export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const uuidSchema: ContractSchema = { type: 'string', format: 'uuid' };
export const versionSchema: ContractSchema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
export const versionsSchema: ContractSchema = { type: 'object', additionalProperties: versionSchema };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validDateTime(value: string) {
  // Date.parse accepts numbers, date-only values, and impossible calendar dates.
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1];
}

export function assertContract(value: unknown, schema: ContractSchema, field = 'Request'): void {
  const invalid = () => { throw new DomainError('VALIDATION_FAILED', `${field} is invalid.`); };
  if (Array.isArray(schema.type)) {
    for (const type of schema.type) {
      try { assertContract(value, { ...schema, type }, field); return; }
      catch (error) { if (!(error instanceof DomainError) || error.code !== 'VALIDATION_FAILED') throw error; }
    }
    return invalid();
  }
  if (schema.const !== undefined && value !== schema.const) invalid();
  if (schema.type === 'null') { if (value !== null) invalid(); return; }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return invalid();
    if (schema.minItems !== undefined && value.length < schema.minItems) invalid();
    if (schema.maxItems !== undefined && value.length > schema.maxItems) invalid();
    if (schema.items) for (const [index,item] of value.entries()) assertContract(item, schema.items, `${field}[${index}]`);
    if (schema.uniqueItems) {
      // Canonicalize object key order too, so uniqueness has the same meaning
      // for every supported JSON item type rather than depending on insertion.
      const canonical = (item: unknown): string => {
        if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
        if (isRecord(item)) return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
        return JSON.stringify(item);
      };
      if (new Set(value.map(canonical)).size !== value.length) invalid();
    }
    return;
  }
  if (schema.type === 'object') {
    if (!isRecord(value)) return invalid();
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) invalid();
    for (const [key, item] of Object.entries(value)) {
      // Never accept prototype-related fields even in legacy object contracts.
      if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid();
      const property = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
      if (property) assertContract(item, property, `${field}.${key}`);
      else if (schema.additionalProperties === false) invalid();
      else if (typeof schema.additionalProperties === 'object') assertContract(item, schema.additionalProperties, `${field}.${key}`);
    }
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return invalid();
    if (schema.minLength !== undefined && value.length < schema.minLength) invalid();
    if (schema.maxLength !== undefined && value.length > schema.maxLength) invalid();
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) invalid();
    if (schema.format === 'uuid' && !new RegExp(UUID_PATTERN, 'i').test(value)) invalid();
    if (schema.format === 'date-time' && !validDateTime(value)) invalid();
    if (schema.format === 'email' && !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(value.trim())) invalid();
    return;
  }
  if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return invalid();
    if (schema.minimum !== undefined && value < schema.minimum) invalid();
    if (schema.maximum !== undefined && value > schema.maximum) invalid();
    return;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') invalid();
}
