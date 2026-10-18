import assert from 'node:assert/strict';
import test from 'node:test';
import { currencyMinorDigits, formatBasisPoints, formatDecimalQuantity, formatMinorMoneyText, minorToMoneyInput, moneyInputToMinor, parseMoneyToMinor } from '../../../src/utils/money.js';

test('UI amount inputs use ISO currency precision for KES, JPY and BHD', () => {
  assert.equal(currencyMinorDigits('KES'), 2);
  assert.equal(currencyMinorDigits('JPY'), 0);
  assert.equal(currencyMinorDigits('BHD'), 3);
  assert.equal(moneyInputToMinor('123.45', 'KES'), 12345);
  assert.equal(moneyInputToMinor('123', 'JPY'), 123);
  assert.equal(moneyInputToMinor('123.456', 'BHD'), 123456);
  assert.equal(moneyInputToMinor('0.001', 'BHD'), 1);
  assert.equal(moneyInputToMinor('123.00', 'JPY'), 123);
  assert.equal(moneyInputToMinor('123.4500', 'KES'), 12345);
  assert.throws(() => moneyInputToMinor('123.45', 'JPY'), /0 decimal places/);
  assert.throws(() => moneyInputToMinor('123.456', 'KES'), /2 decimal places/);
  assert.throws(() => moneyInputToMinor('123.4567', 'BHD'), /3 decimal places/);
});

test('UI amount input parsing retains exact safe integers and rejects excess amounts', () => {
  assert.equal(moneyInputToMinor('90071992547409.91', 'KES'), Number.MAX_SAFE_INTEGER);
  assert.equal(moneyInputToMinor('9007199254740.991', 'BHD'), Number.MAX_SAFE_INTEGER);
  assert.equal(moneyInputToMinor('9007199254740991', 'JPY'), Number.MAX_SAFE_INTEGER);
  assert.throws(() => moneyInputToMinor('90071992547409.92', 'KES'), /supported limit/);
  assert.throws(() => moneyInputToMinor('9007199254740.992', 'BHD'), /supported limit/);
  assert.throws(() => moneyInputToMinor('9007199254740992', 'JPY'), /supported limit/);
  for (const invalid of ['-1', '1e2', 'NaN', 'Infinity', '']) assert.throws(() => moneyInputToMinor(invalid, 'KES'));
});

test('customer monetary parser applies the selected tenant currency', () => {
  assert.equal(parseMoneyToMinor('1,234.56', 'KES'), 123456);
  assert.equal(parseMoneyToMinor('1234', 'JPY'), 1234);
  assert.equal(parseMoneyToMinor('1,234.567', 'BHD'), 1234567);
  assert.equal(parseMoneyToMinor('1234.56', 'JPY'), null);
  assert.equal(parseMoneyToMinor('1234.5678', 'BHD'), null);
});

test('minor-unit input formatting produces exact decimal strings including signed and large amounts', () => {
  assert.equal(minorToMoneyInput('12345', 'KES'), '123.45');
  assert.equal(minorToMoneyInput('12345', 'JPY'), '12345');
  assert.equal(minorToMoneyInput('12345', 'BHD'), '12.345');
  assert.equal(minorToMoneyInput(1, 'BHD'), '0.001');
  assert.equal(minorToMoneyInput(0n, 'KES'), '0.00');
  assert.equal(minorToMoneyInput(0n, 'JPY'), '0');
  assert.equal(minorToMoneyInput(-1n, 'BHD'), '-0.001');
  assert.equal(minorToMoneyInput('-100', 'JPY'), '-100');
  assert.equal(minorToMoneyInput('9007199254740991123', 'BHD'), '9007199254740991.123');
  assert.equal(minorToMoneyInput('-9007199254740991123', 'BHD'), '-9007199254740991.123');
  assert.throws(() => minorToMoneyInput(1.5, 'KES'), /safe integer/);
  assert.throws(() => minorToMoneyInput(Number.MAX_SAFE_INTEGER + 1, 'KES'), /safe integer/);
  for (const invalid of ['1.5', '1e2', '0x10', 'NaN', '']) assert.throws(() => minorToMoneyInput(invalid, 'KES'), /integer string/);
});

test('exact input formatting round trips safe integer amounts in each supported precision', () => {
  for (const currency of ['KES', 'JPY', 'BHD']) {
    for (const minor of [0, 1, 12345, Number.MAX_SAFE_INTEGER]) {
      assert.equal(moneyInputToMinor(minorToMoneyInput(minor, currency), currency), minor);
    }
  }
});

test('display formatter preserves string minor-unit evidence beyond JavaScript safe integer size', () => {
  assert.equal(formatMinorMoneyText('9007199254740991123', 'BHD', 'en-US'), 'BHD\u00a09,007,199,254,740,991.123');
  assert.equal(formatMinorMoneyText('-1', 'BHD', 'en-US'), '-BHD\u00a00.001');
  assert.equal(formatMinorMoneyText('12345', 'KES', 'en-US'), 'KES\u00a0123.45');
  assert.match(formatMinorMoneyText('12345', 'JPY', 'en-US'), /12,345$/);
});

test('money display omits only an entirely zero fraction and retains exact nonzero currency precision', () => {
  assert.equal(formatMinorMoneyText('120000', 'KES', 'en-US'), 'KES\u00a01,200');
  assert.equal(formatMinorMoneyText('120050', 'KES', 'en-US'), 'KES\u00a01,200.50');
  assert.equal(formatMinorMoneyText('120005', 'KES', 'en-US'), 'KES\u00a01,200.05');
  assert.equal(formatMinorMoneyText('-120000', 'KES', 'en-US'), '-KES\u00a01,200');
  assert.equal(formatMinorMoneyText('-120050', 'KES', 'en-US'), '-KES\u00a01,200.50');
  assert.equal(formatMinorMoneyText('0', 'KES', 'en-US'), 'KES\u00a00');
  assert.equal(formatMinorMoneyText('1000', 'BHD', 'en-US'), 'BHD\u00a01');
  assert.equal(formatMinorMoneyText('1500', 'BHD', 'en-US'), 'BHD\u00a01.500');
  assert.match(formatMinorMoneyText('1200', 'JPY', 'en-US'), /1,200$/);
  assert.equal(formatMinorMoneyText('120050', 'KES', 'de-DE'), 'KES\u00a01.200,50');
  assert.equal(formatMinorMoneyText('9007199254740991000', 'BHD', 'en-US'), 'BHD\u00a09,007,199,254,740,991');
});

test('quantities and tax percentages trim insignificant zeros without floating point conversion', () => {
  const values = { '12.000000': '12', '1.250000': '1.25', '0.000001': '0.000001',
    '-1.250000': '-1.25', '-0.000000': '0', '00012.010000': '12.01',
    '9007199254740991234.000001': '9007199254740991234.000001' };
  for (const [value, expected] of Object.entries(values)) assert.equal(formatDecimalQuantity(value), expected);
  assert.equal(formatDecimalQuantity('not a quantity'), 'not a quantity');
  assert.equal(formatBasisPoints(1600), '16');
  assert.equal(formatBasisPoints(1625), '16.25');
  assert.equal(formatBasisPoints(1650), '16.5');
  assert.equal(formatBasisPoints(0), '0');
});
