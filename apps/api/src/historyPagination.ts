import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, type ApiSession } from './contracts.js';
import { assertContract } from './contractValidation.js';

export type HistoryQuery = { after?: string; limit?: string; q?: string };
export interface HistoryPage {
  nextCursor: string | null; asOf: string; totalCount: number; hasMore: boolean; limit: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/;
function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || !timestamp.test(value) || value.startsWith('0000-')) return false;
  try { assertContract(value,{type:'string',format:'date-time'});return true; }
  catch { return false; }
}

export function parseHistoryQuery(session: ApiSession, resource: string, query: HistoryQuery = {}, defaultLimit = 50) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !['after','limit','q'].includes(key)))
    throw new DomainError('VALIDATION_FAILED', 'History filters are invalid.');
  const limit = query.limit === undefined ? defaultLimit : typeof query.limit === 'string' && /^\d{1,3}$/.test(query.limit) ? Number(query.limit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new DomainError('VALIDATION_FAILED', 'Choose a page size between 1 and 250.');
  if (query.q !== undefined && typeof query.q !== 'string') throw new DomainError('VALIDATION_FAILED', 'Search text is invalid.');
  if (query.q !== undefined && /[\u0000-\u001f\u007f]/.test(query.q)) throw new DomainError('VALIDATION_FAILED', 'Search text cannot contain control characters.');
  const search = (query.q ?? '').trim();
  if (search.length > 128) throw new DomainError('VALIDATION_FAILED', 'Search text is too long.');
  const scope = createHash('sha256').update(JSON.stringify([session.tenantId,session.outletId,session.userId,resource,search])).digest('hex');
  let asOf = new Date().toISOString(), afterTime: string | null = null, afterId: string | null = null;
  if (query.after !== undefined) {
    try {
      if (typeof query.after !== 'string' || query.after.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(query.after)) throw new Error();
      const cursor = JSON.parse(Buffer.from(query.after,'base64url').toString('utf8'));
      if (!Array.isArray(cursor) || cursor.length !== 5 || cursor[0] !== scope || !validTime(cursor[1]) || !validTime(cursor[2]) || typeof cursor[3] !== 'string' || !uuid.test(cursor[3]) || cursor[4] !== 1 || Date.parse(cursor[1]) > Date.now()+5000 || Date.parse(cursor[2]) > Date.parse(cursor[1])) throw new Error();
      [,asOf,afterTime,afterId] = cursor;
    } catch { throw new DomainError('VALIDATION_FAILED', 'The next-page reference is invalid for this history and filter. Refresh the history.'); }
  }
  const pattern = search ? `%${search.replace(/[\\%_]/g,'\\$&')}%` : null;
  return { limit, search, pattern, scope, asOf, afterTime, afterId };
}

/** Source SQL is repository-owned and exposes id, sort_at and search_text.
 * Window balances belong in source SQL, before search or continuation filtering.
 * Call inside inReadSnapshot so page and filter totals describe one snapshot.
 */
export async function readHistoryPage(client: PoolClient, session: ApiSession, resource: string, query: HistoryQuery,
  sourceSql: string, values: unknown[], defaultLimit = 50) {
  const parsed = parseHistoryQuery(session,resource,query,defaultLimit), index = values.length;
  const filters = `sort_at <= $${index+1}::timestamptz AND ($${index+2}::text IS NULL OR search_text ILIKE $${index+2})`;
  const parameters = [...values,parsed.asOf,parsed.pattern];
  const total = await client.query(`WITH source AS (${sourceSql}) SELECT count(*)::text total FROM source WHERE ${filters}`,parameters);
  const result = await client.query(`WITH source AS (${sourceSql}) SELECT *,to_char(sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_time
    FROM source WHERE ${filters} AND ($${index+3}::timestamptz IS NULL OR (sort_at,id)<($${index+3}::timestamptz,$${index+4}::uuid))
    ORDER BY sort_at DESC,id DESC LIMIT $${index+5}`,[...parameters,parsed.afterTime,parsed.afterId,parsed.limit+1]);
  const hasMore = result.rows.length > parsed.limit, rows = result.rows.slice(0,parsed.limit), last = rows.at(-1);
  const page: HistoryPage = { asOf: parsed.asOf, totalCount: Number(total.rows[0].total), hasMore, limit: parsed.limit,
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify([parsed.scope,parsed.asOf,last.cursor_time,last.id,1])).toString('base64url') : null };
  return { rows, page };
}
