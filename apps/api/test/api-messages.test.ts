import assert from 'node:assert/strict';
import test from 'node:test';
import { apiErrorMessage, isTerminalOutcome, presentOutcome, unconfirmedActionMessage } from '../../../src/services/apiMessages.js';

test('uncertain changes direct the operator to status recovery without implying failure', () => {
  const message = unconfirmedActionMessage('/commands');
  assert.match(message, /Check its status before repeating/);
  assert.doesNotMatch(message, /no data|retry this read|command ID|server/i);
  assert.match(unconfirmedActionMessage('/auth/login'), /sign-in/);
});

test('incomplete financial acknowledgements cannot clear original recovery records', () => {
  assert.equal(isTerminalOutcome({commandId:'original',status:'CONFIRMED'},'original','sales.order.settle'),false);
  assert.equal(isTerminalOutcome({commandId:'original',status:'CONFIRMED',value:{}},'original','sales.order.settle'),false);
  assert.equal(isTerminalOutcome({commandId:'different',status:'CONFIRMED',value:{saleId:'sale'}},'original','sales.order.settle'),false);
  assert.equal(isTerminalOutcome({commandId:'original',status:'CONFIRMED',value:{saleId:'sale'}},'original','sales.order.settle'),true);
  assert.equal(isTerminalOutcome({commandId:'original',status:'REJECTED',code:'VALIDATION_FAILED'},'original'),true);
});

test('remote diagnostic messages are replaced while codes and result details remain available', () => {
  const source = { status: 'REJECTED', code: 'INTERNAL_ERROR', message: 'SELECT secret FROM database', details: { reference: 'preserved' } };
  const result = presentOutcome(source);
  assert.notEqual(result.message, source.message);
  assert.deepEqual(result.details, source.details);
  assert.equal(result.code, source.code);
  for (const status of [401, 403, 429, 500]) assert.doesNotMatch(apiErrorMessage('UNRECOGNIZED', status), /SQL|payload|command|server/i);
  assert.match(apiErrorMessage('INSUFFICIENT_STOCK'), /stock/);
  assert.match(apiErrorMessage('HTTP_429', 429), /Wait/);
});
