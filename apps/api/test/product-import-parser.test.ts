import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CsvParseError, csvExportCell, parseCsv } from '../src/csvParser.js';

function rejected(source: string, code: string) {
  assert.throws(() => parseCsv(source), error => error instanceof CsvParseError && error.code === code);
}

test('product CSV parser preserves text, escaped quotes, CRLF and quoted physical lines', () => {
  const source = '\uFEFFsku,name,barcode,notes\r\n001,"Cans, six-pack",000012340001,"First line\r\nSecond ""quoted"" line"\r\n002,Plain item,000012340002,\r\n';
  const parsed = parseCsv(source);
  assert.deepEqual(parsed.headers, ['sku', 'name', 'barcode', 'notes']);
  assert.deepEqual(parsed.rows.map(row => row.cells), [
    ['001', 'Cans, six-pack', '000012340001', 'First line\nSecond "quoted" line'],
    ['002', 'Plain item', '000012340002', ''],
  ]);
  assert.equal(parsed.rows[0].rowNumber, 2, 'row number identifies the first source line, not a zero-based array index');
  assert.equal(parsed.rows[1].rowNumber, 4, 'quoted newlines count as physical source lines');
});

test('product CSV parser treats quoted empty cells and terminal delimiters as real cells', () => {
  const parsed = parseCsv('a,b,c\n"",value,\nlast,"",tail');
  assert.deepEqual(parsed.rows.map(row => row.cells), [['', 'value', ''], ['last', '', 'tail']]);
  assert.equal(parsed.rows.length, 2, 'no final newline is required');
});

test('product CSV parser rejects malformed quoting instead of silently shifting columns', () => {
  for (const source of ['sku,name\nA,"unterminated', 'sku,name\nA,unquoted"quote', 'sku,name\nA,"closed"junk']) {
    rejected(source, 'CSV_QUOTE');
  }
});

test('product CSV parser enforces byte, row, column and decoded-cell limits', () => {
  const cases = [
    ['CSV_BYTES_LIMIT', 'sku,name\nA,"' + 'é'.repeat(262_145) + '"'],
    ['CSV_ROWS_LIMIT', 'sku\n' + Array.from({ length: 1001 }, (_, index) => `SKU-${index}`).join('\n')],
    ['CSV_COLUMNS_LIMIT', Array.from({ length: 51 }, (_, index) => `column-${index}`).join(',') + '\n' + Array(51).fill('value').join(',')],
    ['CSV_CELL_LIMIT', 'sku,name\nA,' + 'x'.repeat(2049)],
  ];
  for (const [code, source] of cases) rejected(source, code);
  const atLimits = parseCsv('sku,name\n' + Array.from({ length: 1000 }, (_, index) => `SKU-${index},${index === 999 ? 'x'.repeat(2048) : 'Valid item'}`).join('\n'));
  assert.equal(atLimits.rows.length, 1000);
  assert.equal(atLimits.rows[999].cells[1].length, 2048);
});

test('product CSV parser rejects invalid Unicode and dangerous control bytes', () => {
  for (const source of ['sku,name\nA,bad\u0000name', 'sku,name\nA,bad\uFFFDname', 'sku,name\nA,bad\uD800name']) {
    rejected(source, 'CSV_ENCODING');
  }
  assert.equal(parseCsv('sku,name\nA,"Maziwa 🥛"').rows[0].cells[1], 'Maziwa 🥛');
});

test('product CSV parser rejects missing, ambiguous headers and incorrect row widths', () => {
  rejected('', 'CSV_EMPTY');
  rejected('sku,,name\nA,ignored,Item', 'CSV_HEADER');
  rejected('SKU, sku ,name\nA,B,Item', 'CSV_HEADER');
  rejected('sku,name\nA', 'CSV_ROW_WIDTH');
  rejected('sku,name\nA,Item,extra', 'CSV_ROW_WIDTH');
  assert.deepEqual(parseCsv(' SKU , Name \nA,Item').headers, ['SKU', 'Name']);
});

test('CSV error export neutralizes spreadsheet formulas and quotes hostile raw values', () => {
  for (const input of ['=HYPERLINK("https://example.invalid","link")', '+SUM(1,2)', '-1+2', '@SUM(1)', ' \t=1+1', '\r\n@formula']) {
    const cell = csvExportCell(input);
    assert.equal(cell[0], '"'); assert.equal(cell[cell.length - 1], '"');
    assert.ok(cell.startsWith('"\''), 'an apostrophe must precede formula/control prefixes inside the quoted field');
    assert.equal(cell.slice(2, -1).replaceAll('""', '"'), input, 'raw error evidence survives the spreadsheet-safe representation');
  }
  assert.equal(csvExportCell('000012340001'), '"000012340001"', 'barcodes retain their leading zeros');
  assert.equal(csvExportCell('Comma, "quote"\nline'), '"Comma, ""quote""\nline"');
});
