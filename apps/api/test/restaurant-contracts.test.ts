import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { COMMAND_CATALOGUE, validateCommandPayload } from '../src/commandCatalogue.js';
import { assertContract } from '../src/contractValidation.js';
import { DomainError, type CommandEnvelope } from '../src/contracts.js';
import { isTerminalOutcome, isTerminalCommandStatus } from '../../../src/services/apiMessages.js';

const id = randomUUID(), related = randomUUID(), commandId = randomUUID();
const definitions: Array<[string, Record<string, unknown>, string, Record<string, unknown>]> = [
  ['restaurant.section.save', { name: 'Dining room', active: true }, 'sectionId', { sectionId: id, version: 1, active: true }],
  ['restaurant.table.save', { name: 'Table one', sectionId: id, seats: 4, active: true }, 'tableId', { tableId: id, version: 1, active: true }],
  ['restaurant.station.save', { name: 'Kitchen', kind: 'KITCHEN', charactersPerLine: 42, active: true }, 'stationId', { stationId: id, version: 1, active: true }],
  ['restaurant.menu.save', { productId: id, stationIds: [related], preparationLabel: 'Steak', instructions: 'No salt', available: true }, 'productId', { productId: id, version: 1 }],
  ['restaurant.station.assign', { deviceId: id, stationIds: [related] }, 'deviceId', { deviceId: id, version: 1 }],
];

for (const [type, payload, idKey, result] of definitions) {
  test(`${type} strict version-one contract and complete recovery confirmation`, () => {
    const envelope: CommandEnvelope = { protocolVersion: 1, commandId, deviceId: randomUUID(), type, occurredAt: new Date().toISOString(), payload, expectedVersions: {} };
    const definition = COMMAND_CATALOGUE[type];
    assert.equal(definition.validation, 'SCHEMA_AND_DOMAIN'); assert.equal(definition.offlineMode, 'ONLINE_ONLY');
    validateCommandPayload(envelope); assertContract(result, definition.outputSchema);
    assert.throws(() => validateCommandPayload({ ...envelope, payload: { ...payload, outletId: related } }), DomainError);
    for (const key of Object.keys(payload)) {
      const incomplete = { ...payload }; delete incomplete[key];
      assert.throws(() => validateCommandPayload({ ...envelope, payload: incomplete }), DomainError);
    }
    const outcome = { commandId, status: 'CONFIRMED', value: result };
    assert.equal(isTerminalOutcome(outcome, commandId, type, payload, {}), true);
    for (const invalid of [{}, { ...result, [idKey]: 'not-a-uuid' }, { ...result, version: 0 }, { ...result, version: 2 }, { ...result, version: '1' }]) {
      assert.equal(isTerminalOutcome({ ...outcome, value: invalid }, commandId, type, payload, {}), false);
    }
    if (Object.hasOwn(payload, idKey)) assert.equal(isTerminalOutcome({ ...outcome, value: { ...result, [idKey]: related } }, commandId, type, payload, {}), false);
    if (Object.hasOwn(result, 'active')) {
      const incomplete = { ...result }; delete incomplete.active;
      assert.equal(isTerminalOutcome({ ...outcome, value: incomplete }, commandId, type, payload, {}), false);
      assert.equal(isTerminalOutcome({ ...outcome, value: { ...result, active: false } }, commandId, type, payload, {}), false);
    }
    assert.equal(isTerminalCommandStatus({ commandId, status: 'CONFIRMED', response: { status: 'CONFIRMED', value: result } }, commandId, type, payload, {}), true);
    assert.equal(isTerminalCommandStatus({ commandId, status: 'CONFIRMED', response: { commandId: related, status: 'CONFIRMED', value: result } }, commandId, type, payload, {}), false);
  });
}

test('updated restaurant acknowledgements must advance the reviewed version of the same record', () => {
  const payload = { sectionId: id, name: 'Updated dining', active: false }, versions = { [`section:${id}`]: 3 };
  const outcome = { commandId, status: 'CONFIRMED', value: { sectionId: id, version: 4, active: false } };
  assert.equal(isTerminalOutcome(outcome, commandId, 'restaurant.section.save', payload, versions), true);
  for (const version of [1, 3, 5]) assert.equal(isTerminalOutcome({ ...outcome, value: { ...outcome.value, version } }, commandId, 'restaurant.section.save', payload, versions), false);
  assert.equal(isTerminalOutcome({ commandId, status: 'REJECTED', code: 'IDEMPOTENCY_MISMATCH' }, commandId, 'restaurant.section.save', payload, versions), false);
});
