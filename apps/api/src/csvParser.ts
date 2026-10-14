export const CSV_LIMITS = { bytes: 512 * 1024, rows: 1000, columns: 50, cellLength: 2048 } as const;
export class CsvParseError extends Error {
  constructor(readonly code: string, readonly row: number, readonly column: number, message: string) { super(message); }
}
export interface ParsedCsv { headers: string[]; rows: Array<{ rowNumber: number; cells: string[] }> }

/** Strict, bounded RFC 4180 parser. Row positions refer to physical source lines. */
export function parseCsv(source: string): ParsedCsv {
  if (typeof source !== 'string') throw new CsvParseError('CSV_ENCODING', 1, 1, 'Upload UTF-8 CSV text.');
  if (Buffer.byteLength(source, 'utf8') > CSV_LIMITS.bytes) throw new CsvParseError('CSV_BYTES_LIMIT', 1, 1, 'The CSV file exceeds 512 KiB.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(source)) throw new CsvParseError('CSV_ENCODING', 1, 1, 'CSV contains unsupported control characters or invalid UTF-8 replacement characters.');
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = source.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CsvParseError('CSV_ENCODING', 1, 1, 'CSV contains an unpaired Unicode surrogate.');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new CsvParseError('CSV_ENCODING', 1, 1, 'CSV contains an unpaired Unicode surrogate.');
  }
  const input = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const records: Array<{ rowNumber: number; cells: string[] }> = [];
  let cells: string[] = []; let cell = ''; let state: 'bare' | 'quoted' | 'closed' = 'bare';
  let line = 1; let rowStart = 1;
  const fail = (code: string, message: string): never => { throw new CsvParseError(code, rowStart, cells.length + 1, message); };
  const finishCell = () => {
    if (cell.length > CSV_LIMITS.cellLength) fail('CSV_CELL_LIMIT', 'A CSV cell exceeds 2048 characters.');
    cells.push(cell); cell = ''; state = 'bare';
    if (cells.length > CSV_LIMITS.columns) fail('CSV_COLUMNS_LIMIT', 'A CSV row exceeds 50 columns.');
  };
  const finishRow = () => {
    finishCell();
    if (!(cells.length === 1 && cells[0] === '')) records.push({ rowNumber: rowStart, cells });
    cells = [];
    if (records.length > CSV_LIMITS.rows + 1) fail('CSV_ROWS_LIMIT', 'The CSV exceeds 1000 data rows.');
  };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (state === 'quoted') {
      if (char === '"') { if (input[i + 1] === '"') { cell += '"'; i += 1; } else state = 'closed'; }
      else if (char === '\r' || char === '\n') {
        if (char === '\r' && input[i + 1] === '\n') i += 1;
        cell += '\n'; line += 1;
      } else cell += char;
    } else if (char === ',') finishCell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      finishRow(); line += 1; rowStart = line;
    } else if (char === '"') {
      if (state !== 'bare' || cell !== '') fail('CSV_QUOTE', 'A quote may only begin an empty CSV field.');
      state = 'quoted';
    } else {
      if (state === 'closed') fail('CSV_QUOTE', 'Only a delimiter or line ending may follow a quoted field.');
      cell += char;
    }
    if (cell.length > CSV_LIMITS.cellLength) fail('CSV_CELL_LIMIT', 'A CSV cell exceeds 2048 characters.');
  }
  if (state === 'quoted') fail('CSV_QUOTE', 'A quoted CSV field is not closed.');
  if (cell !== '' || cells.length > 0 || state === 'closed') finishRow();
  if (!records.length) throw new CsvParseError('CSV_EMPTY', 1, 1, 'CSV must contain headers and at least one product row.');
  const headers = records.shift()!.cells.map(value => value.trim());
  if (headers.some(value => !value) || new Set(headers.map(value => value.toLowerCase())).size !== headers.length) throw new CsvParseError('CSV_HEADER', 1, 1, 'Headers must be non-empty and unique, ignoring case and surrounding spaces.');
  if (!records.length) throw new CsvParseError('CSV_EMPTY', 1, 1, 'CSV must contain at least one product row.');
  for (const row of records) if (row.cells.length !== headers.length) throw new CsvParseError('CSV_ROW_WIDTH', row.rowNumber, row.cells.length, 'Each data row must have exactly as many fields as the header.');
  return { headers, rows: records };
}

/** Neutralize spreadsheet formulas while retaining exact quoted error text. */
export function csvExportCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
