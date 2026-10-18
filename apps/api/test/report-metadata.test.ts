import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountMetadata,reportSourceName} from '../src/reportMetadata.js';

test('report mapping recognizes supported control accounts without counting them as revenue',()=>{
  for(const code of ['ACCOUNTS_RECEIVABLE','MOBILE_MONEY_CONTROL','BANK_CONTROL','INVENTORY'])assert.equal(accountMetadata(code).classification,'ASSET');
  assert.equal(accountMetadata('OPENING_BALANCE_CLEARING').classification,'EQUITY');
  assert.equal(accountMetadata('ACCOUNTS_PAYABLE').classification,'LIABILITY');
  for(const code of ['OPERATING_EXPENSE','RENT_EXPENSE','UTILITIES_EXPENSE'])assert.equal(accountMetadata(code).classification,'OTHER_OPERATING_COST');
  assert.equal(accountMetadata('UNREVIEWED_CODE').classification,null);
  assert.equal(reportSourceName('OPENING_PRODUCT_IMPORT'),'Opening stock import');
});
