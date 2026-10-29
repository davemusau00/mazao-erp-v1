import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { assertContract, type ContractSchema, uuidSchema } from '../src/contractValidation.js';
import { DomainError } from '../src/contracts.js';

test('reviewed identifier arrays reject coercion, omissions, duplicates and malformed members', () => {
  const schema: ContractSchema = { type: 'array', items: uuidSchema, minItems: 1, maxItems: 2, uniqueItems: true };
  const first = randomUUID(), second = randomUUID();
  assertContract([first, second], schema);
  for (const value of [null, {}, first, [], [first, first], [first, second, randomUUID()], [first, 1], ['------------------------------------']]) {
    assert.throws(() => assertContract(value, schema), error => error instanceof DomainError && error.code === 'VALIDATION_FAILED');
  }
  const sparse=new Array(2);sparse[0]=first;
  assert.throws(()=>assertContract(sparse,schema),DomainError,'a missing JavaScript array member cannot bypass typed item validation');
  const original = [first, second];
  assertContract(original, schema);
  assert.deepEqual(original, [first, second], 'validation must preserve the original hashed array order');
});

test('array uniqueness compares supported structured values without object-key-order gaps', () => {
  const schema: ContractSchema = { type: 'array', items: { type: 'object', additionalProperties: { type: 'integer' } }, uniqueItems: true };
  assertContract([{ a: 1, b: 2 }, { a: 1, b: 3 }], schema);
  assert.throws(() => assertContract([{ a: 1, b: 2 }, { b: 2, a: 1 }], schema), DomainError);
});
