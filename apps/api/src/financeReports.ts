import type { PoolClient } from 'pg';
import { pool } from './db.js';
import type { ApiSession } from './contracts.js';
import { DomainError, ROLE_PERMISSIONS } from './contracts.js';

type AccountTotal = { accountCode: string; debitMinor: string; creditMinor: string };
type Snapshot = {
  accounts: AccountTotal[];
  journalEntryCount: string;
  emptyJournalEntryCount: string;
  unbalancedJournalEntryCount: string;
  latestJournalAt: Date | null;
  generatedAt: Date;
  sourceTypes: Array<{ sourceType: string; entryCount: string }>;
};

const revenueCodes = new Set(['SALES_REVENUE', 'ROOM_REVENUE']);
const otherIncomeCodes = new Set(['INVENTORY_COUNT_GAIN']);
const expenseCodes = new Set(['COST_OF_GOODS_SOLD', 'INVENTORY_COUNT_SHRINKAGE', 'CASH_OVER_SHORT']);
const knownBalanceSheetCodes = new Set([
  'CASH_TILL', 'CASH_FLOAT_CLEARING', 'CASH_PAID_IN_CLEARING', 'CASH_PAYOUT_CLEARING',
  'GOODS_RECEIVED_NOT_INVOICED', 'INVENTORY', 'VAT_PAYABLE',
]);

function requireFinanceView(session: ApiSession) {
  if (!ROLE_PERMISSIONS[session.role].includes('finance.view')) {
    throw new DomainError('FORBIDDEN', 'Your role cannot access financial reports.', 403);
  }
}

function dateOnly(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainError('VALIDATION_FAILED', `${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError('VALIDATION_FAILED', `${field} must be a real calendar date.`);
  }
  return value;
}

function dateRange(fromValue: unknown, toValue: unknown) {
  const from = dateOnly(fromValue, 'from');
  const to = dateOnly(toValue, 'to');
  const days = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
  if (days < 0) throw new DomainError('VALIDATION_FAILED', 'from must be on or before to.');
  if (days > 366) throw new DomainError('VALIDATION_FAILED', 'Report ranges are limited to 367 calendar days.');
  return { from, to };
}

function ensureTimeZone(timeZone: string) {
  try { new Intl.DateTimeFormat('en', { timeZone }); }
  catch { throw new DomainError('INVALID_OUTLET_TIME_ZONE', 'The outlet time zone is invalid; reports cannot calculate business dates.', 500); }
}

async function inReadSnapshot<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* release the failed connection */ }
    throw error;
  } finally {
    client.release();
  }
}

async function readSnapshot(client: PoolClient, session: ApiSession, start: string | null, end: string) {
  ensureTimeZone(session.timeZone);

  const result = await client.query<{
    accounts: AccountTotal[] | null;
    journal_entry_count: string;
    empty_journal_entry_count: string;
    unbalanced_journal_entry_count: string;
    latest_journal_at: Date | null;
    generated_at: Date;
    source_types: Snapshot['sourceTypes'] | null;
  }>(`WITH scoped_entries AS (
        SELECT id,source_type,posted_at
        FROM finance.journal_entries
        WHERE tenant_id=$1
          AND ($2::date IS NULL OR posted_at >= ($2::date::timestamp AT TIME ZONE $4))
          AND posted_at < (($3::date + 1)::timestamp AT TIME ZONE $4)
      ), entry_balances AS (
        SELECT e.id,e.posted_at,coalesce(sum(l.debit_minor),0) debit_minor,coalesce(sum(l.credit_minor),0) credit_minor
        FROM scoped_entries e
        LEFT JOIN finance.journal_lines l ON l.tenant_id=$1 AND l.journal_entry_id=e.id
        GROUP BY e.id,e.posted_at
      ), account_totals AS (
        SELECT l.account_code,sum(l.debit_minor)::text debit_minor,sum(l.credit_minor)::text credit_minor
        FROM scoped_entries e
        JOIN finance.journal_lines l ON l.tenant_id=$1 AND l.journal_entry_id=e.id
        GROUP BY l.account_code
      ), source_counts AS (
        SELECT source_type,count(*)::text entry_count FROM scoped_entries GROUP BY source_type
      )
      SELECT
        coalesce((SELECT jsonb_agg(jsonb_build_object('accountCode',account_code,'debitMinor',debit_minor,'creditMinor',credit_minor) ORDER BY account_code) FROM account_totals),'[]'::jsonb) accounts,
        (SELECT count(*)::text FROM scoped_entries) journal_entry_count,
        (SELECT count(*)::text FROM entry_balances WHERE debit_minor=0 AND credit_minor=0) empty_journal_entry_count,
        (SELECT count(*)::text FROM entry_balances WHERE debit_minor<>credit_minor) unbalanced_journal_entry_count,
        (SELECT max(posted_at) FROM scoped_entries) latest_journal_at,
        statement_timestamp() generated_at,
        coalesce((SELECT jsonb_agg(jsonb_build_object('sourceType',source_type,'entryCount',entry_count) ORDER BY source_type) FROM source_counts),'[]'::jsonb) source_types`,
  [session.tenantId, start, end, session.timeZone]);

  const row = result.rows[0];
  return {
    accounts: row.accounts ?? [],
    journalEntryCount: row.journal_entry_count,
    emptyJournalEntryCount: row.empty_journal_entry_count,
    unbalancedJournalEntryCount: row.unbalanced_journal_entry_count,
    latestJournalAt: row.latest_journal_at,
    generatedAt: row.generated_at,
    sourceTypes: row.source_types ?? [],
  } satisfies Snapshot;
}

function accountBalanceRows(rows: AccountTotal[]) {
  return rows.map(account => {
    const debit = BigInt(account.debitMinor);
    const credit = BigInt(account.creditMinor);
    const net = debit - credit;
    return {
      accountCode: account.accountCode,
      debitMinor: debit.toString(),
      creditMinor: credit.toString(),
      netDebitMinor: net > 0n ? net.toString() : '0',
      netCreditMinor: net < 0n ? (-net).toString() : '0',
    };
  });
}

export async function getTrialBalance(session: ApiSession, asOfValue: unknown) {
  requireFinanceView(session);
  const asOf = dateOnly(asOfValue, 'asOf');
  return inReadSnapshot(async client => {
    const snapshot = await readSnapshot(client, session, null, asOf);
    const accounts = accountBalanceRows(snapshot.accounts);
    const totalDebit = accounts.reduce((sum, account) => sum + BigInt(account.debitMinor), 0n);
    const totalCredit = accounts.reduce((sum, account) => sum + BigInt(account.creditMinor), 0n);
    const difference = totalDebit - totalCredit;
    return {
      reportType: 'TRIAL_BALANCE',
      scope: 'TENANT',
      tenantId: session.tenantId,
      tenantName: session.tenantName,
      currency: session.currency,
      timeZone: session.timeZone,
      asOf,
      generatedAt: snapshot.generatedAt,
      latestJournalAt: snapshot.latestJournalAt,
      coverage: {
        status: 'POSTED_JOURNAL_ONLY',
        journalEntryCount: snapshot.journalEntryCount,
        emptyJournalEntryCount: snapshot.emptyJournalEntryCount,
        unbalancedJournalEntryCount: snapshot.unbalancedJournalEntryCount,
        sourceTypes: snapshot.sourceTypes,
        explanation: 'This is a tenant-wide view of posted journal lines through the selected business date. It does not prove that cash, stock, receivables, payables, or external statements have been reconciled.',
      },
      totals: {
        debitMinor: totalDebit.toString(),
        creditMinor: totalCredit.toString(),
        differenceMinor: difference.toString(),
        balanced: difference === 0n && snapshot.emptyJournalEntryCount === '0' && snapshot.unbalancedJournalEntryCount === '0',
      },
      accounts,
    };
  });
}

export async function getProfitLoss(session: ApiSession, fromValue: unknown, toValue: unknown) {
  requireFinanceView(session);
  const { from, to } = dateRange(fromValue, toValue);
  return inReadSnapshot(async client => {
    const snapshot = await readSnapshot(client, session, from, to);
    const accountRows = accountBalanceRows(snapshot.accounts);
    let revenue = 0n;
    let costOfGoodsSold = 0n;
    let otherIncome = 0n;
    let otherOperatingCosts = 0n;
    const unknownAccountCodes: string[] = [];
    const lines = accountRows.map(account => {
      const debit = BigInt(account.debitMinor);
      const credit = BigInt(account.creditMinor);
      if (revenueCodes.has(account.accountCode)) {
        const value = credit - debit;
        revenue += value;
        return { accountCode: account.accountCode, section: 'REVENUE', amountMinor: value.toString() };
      }
      if (otherIncomeCodes.has(account.accountCode)) {
        const value = credit - debit;
        otherIncome += value;
        return { accountCode: account.accountCode, section: 'OTHER_INCOME', amountMinor: value.toString() };
      }
      if (expenseCodes.has(account.accountCode)) {
        const value = debit - credit;
        if (account.accountCode === 'COST_OF_GOODS_SOLD') costOfGoodsSold += value;
        else otherOperatingCosts += value;
        return { accountCode: account.accountCode, section: account.accountCode === 'COST_OF_GOODS_SOLD' ? 'COST_OF_GOODS_SOLD' : 'OTHER_OPERATING_COST', amountMinor: value.toString() };
      }
      if (!knownBalanceSheetCodes.has(account.accountCode)) unknownAccountCodes.push(account.accountCode);
      return null;
    }).filter((line): line is NonNullable<typeof line> => line !== null);
    const grossProfit = revenue - costOfGoodsSold;
    const partialOperatingResult = grossProfit + otherIncome - otherOperatingCosts;
    return {
      reportType: 'PARTIAL_OPERATING_SUMMARY',
      scope: 'TENANT',
      tenantId: session.tenantId,
      tenantName: session.tenantName,
      currency: session.currency,
      timeZone: session.timeZone,
      from,
      to,
      generatedAt: snapshot.generatedAt,
      latestJournalAt: snapshot.latestJournalAt,
      coverage: {
        status: 'PARTIAL',
        journalEntryCount: snapshot.journalEntryCount,
        emptyJournalEntryCount: snapshot.emptyJournalEntryCount,
        unbalancedJournalEntryCount: snapshot.unbalancedJournalEntryCount,
        sourceTypes: snapshot.sourceTypes,
        unknownAccountCodes,
        omittedSources: ['supplier invoices and AP', 'customer credit and repayments', 'operating expense postings', 'payroll and accruals', 'depreciation', 'payment-provider settlement', 'period adjustments and close'],
        explanation: 'This operating summary covers only recognized account codes in posted journal entries. It is partial and must not be presented as net profit or a complete P&L.',
      },
      totals: {
        revenueMinor: revenue.toString(),
        costOfGoodsSoldMinor: costOfGoodsSold.toString(),
        grossProfitMinor: grossProfit.toString(),
        otherIncomeMinor: otherIncome.toString(),
        otherOperatingCostsMinor: otherOperatingCosts.toString(),
        partialOperatingResultMinor: partialOperatingResult.toString(),
      },
      lines,
    };
  });
}

export async function getJournalLines(session: ApiSession, query: { accountCode: unknown; from?: unknown; to?: unknown; asOf?: unknown; limit: unknown; offset: unknown }) {
  requireFinanceView(session);
  ensureTimeZone(session.timeZone);
  if (typeof query.accountCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(query.accountCode)) {
    throw new DomainError('VALIDATION_FAILED', 'accountCode must be a valid account code.');
  }
  const asOf = query.asOf === undefined ? null : dateOnly(query.asOf, 'asOf');
  if (asOf && (query.from !== undefined || query.to !== undefined)) {
    throw new DomainError('VALIDATION_FAILED', 'Use either asOf or the from/to date range.');
  }
  const range = asOf ? null : dateRange(query.from, query.to);
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new DomainError('VALIDATION_FAILED', 'limit must be an integer from 1 to 200.');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new DomainError('VALIDATION_FAILED', 'offset must be an integer from 0 to 100000.');

  return inReadSnapshot(async client => {
    const start = range?.from ?? null;
    const end = asOf ?? range!.to;
    const countResult = await client.query<{ total: string }>(`SELECT count(*)::text total
      FROM finance.journal_entries je
      JOIN finance.journal_lines jl ON jl.tenant_id=je.tenant_id AND jl.journal_entry_id=je.id
      WHERE je.tenant_id=$1 AND jl.account_code=$2
        AND ($3::date IS NULL OR je.posted_at >= ($3::date::timestamp AT TIME ZONE $5))
        AND je.posted_at < (($4::date + 1)::timestamp AT TIME ZONE $5)`,
    [session.tenantId, query.accountCode, start, end, session.timeZone]);
    const entriesResult = await client.query(`SELECT je.id journal_entry_id,je.source_type,je.source_id,je.currency,je.posted_at,je.created_by,
        jl.account_code,jl.debit_minor::text debit_minor,jl.credit_minor::text credit_minor
      FROM finance.journal_entries je
      JOIN finance.journal_lines jl ON jl.tenant_id=je.tenant_id AND jl.journal_entry_id=je.id
      WHERE je.tenant_id=$1 AND jl.account_code=$2
        AND ($3::date IS NULL OR je.posted_at >= ($3::date::timestamp AT TIME ZONE $6))
        AND je.posted_at < (($4::date + 1)::timestamp AT TIME ZONE $6)
      ORDER BY je.posted_at DESC,je.id DESC,jl.id
      LIMIT $5 OFFSET $7`,
    [session.tenantId, query.accountCode, start, end, limit, session.timeZone, offset]);
    const total = BigInt(countResult.rows[0].total);
    const returned = BigInt(entriesResult.rowCount ?? 0);
    const next = BigInt(offset) + returned;
    return {
      scope: 'TENANT', accountCode: query.accountCode, ...(asOf ? { asOf } : { from: range!.from, to: range!.to }), limit, offset, total: total.toString(),
      nextOffset: next < total ? Number(next) : null,
      entries: entriesResult.rows.map(row => ({
        journalEntryId: row.journal_entry_id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        currency: row.currency,
        postedAt: row.posted_at,
        createdBy: row.created_by,
        accountCode: row.account_code,
        debitMinor: row.debit_minor,
        creditMinor: row.credit_minor,
      })),
    };
  });
}
