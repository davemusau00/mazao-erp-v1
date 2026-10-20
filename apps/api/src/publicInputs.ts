import type { CommandEnvelope } from './contracts.js';
import { assertContract, type ContractSchema, uuidSchema, versionsSchema } from './contractValidation.js';
import { DomainError } from './contracts.js';

export const UUID_ROUTE_PARAMETERS = ['userId','assetId','batchId','shortfallId','countId','shiftId','orderId','customerId','journalEntryId','commandId'] as const;

export function validateRequestIdentifiers(params: unknown, query: unknown): void {
  // Router parameter/query containers may use Fastify's internal prototypes;
  // the stricter plain-object requirement belongs to client JSON bodies.
  if (params !== null && typeof params === 'object' && !Array.isArray(params)) {
    const fields = params as Record<string, unknown>;
    for (const key of UUID_ROUTE_PARAMETERS) if (Object.hasOwn(fields, key)) assertContract(fields[key], uuidSchema, key);
  }
  // Every current query contract uses scalar strings. Fastify represents repeated
  // parameters as arrays; accepting them would bypass TypeScript at runtime.
  if (query !== undefined && (query === null || typeof query !== 'object' || Array.isArray(query) || Object.values(query).some(value => typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)))) {
    throw new DomainError('VALIDATION_FAILED', 'Query fields must contain one text value each without control characters.');
  }
}

export const LOGIN_SCHEMA: ContractSchema = {
  type: 'object', required: ['email', 'password'], additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 3, maxLength: 254, format: 'email' },
    password: { type: 'string', minLength: 1, maxLength: 256 },
    deviceId: uuidSchema,
  },
};

export const COMMAND_ENVELOPE_SCHEMA: ContractSchema = {
  type: 'object',
  required: ['protocolVersion', 'commandId', 'deviceId', 'type', 'occurredAt', 'expectedVersions', 'payload'],
  additionalProperties: false,
  properties: {
    protocolVersion: { type: 'integer', const: 1 }, commandId: uuidSchema, tenantId: uuidSchema, deviceId: uuidSchema,
    type: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$' },
    occurredAt: { type: 'string', maxLength: 40, format: 'date-time' },
    expectedVersions: versionsSchema,
    payload: { type: 'object' },
  },
};

export function parseLoginInput(input: unknown): { email: string; password: string; deviceId?: string } {
  assertContract(input, LOGIN_SCHEMA, 'Sign-in fields');
  const value = input as { email: string; password: string; deviceId?: string };
  return { ...value, email: value.email.trim().toLowerCase() };
}

export function parseCommandEnvelope(input: unknown): CommandEnvelope {
  assertContract(input, COMMAND_ENVELOPE_SCHEMA, 'Command envelope');
  return input as CommandEnvelope;
}
