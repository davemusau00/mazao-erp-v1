import { inReadSnapshot, pool } from './db.js';
import type { ApiSession } from './contracts.js';
import { DomainError } from './contracts.js';
import { requireCustomerView } from './customerPolicy.js';

function customerId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new DomainError('VALIDATION_FAILED', 'customerId must be a valid account identifier.');
  }
  return value;
}

export async function listCustomerAccounts(session: ApiSession) {
  requireCustomerView(session);
  const result = await pool.query(`SELECT id,display_name,phone,email,credit_limit_minor::text,balance_minor::text,status,version,created_at,updated_at
    FROM finance.customer_accounts WHERE tenant_id=$1 ORDER BY lower(display_name),id LIMIT 500`, [session.tenantId]);
  return { customers: result.rows.map(row => ({
    id: row.id,
    name: row.display_name,
    phone: row.phone,
    email: row.email,
    creditLimitMinor: row.credit_limit_minor,
    balanceMinor: row.balance_minor,
    status: row.status as 'ACTIVE' | 'SUSPENDED',
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })) };
}

export async function getCustomerStatement(session: ApiSession, idValue: unknown) {
  requireCustomerView(session);
  const id = customerId(idValue);
  return inReadSnapshot(async client => {
    const accountResult = await client.query(`SELECT id,display_name,phone,email,credit_limit_minor::text,balance_minor::text,status,version
      FROM finance.customer_accounts WHERE id=$1 AND tenant_id=$2`, [id, session.tenantId]);
    if (!accountResult.rowCount) throw new DomainError('NOT_FOUND', 'Customer account was not found.', 404);

    const eventResult = await client.query(`SELECT event_id,event_type,created_at,amount_minor::text,reference,order_id,receipt_number,allocations
      FROM (
        SELECT c.id event_id,'CHARGE'::text event_type,c.created_at,c.amount_minor,
          NULL::text reference,o.id order_id,o.receipt_number,
          '[]'::jsonb allocations
        FROM finance.customer_charges c
        JOIN commerce.orders o ON o.id=c.order_id AND o.tenant_id=c.tenant_id AND o.outlet_id=c.outlet_id
        WHERE c.tenant_id=$1 AND c.customer_account_id=$2
        UNION ALL
        SELECT r.id event_id,'REPAYMENT'::text event_type,r.created_at,r.amount_minor,
          r.reference,NULL::uuid order_id,NULL::text receipt_number,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('amountMinor',a.amount_minor::text,'receiptNumber',o.receipt_number,'orderId',o.id) ORDER BY o.created_at,o.id)
            FROM finance.customer_repayment_allocations a
            JOIN finance.customer_charges c ON c.tenant_id=a.tenant_id AND c.id=a.charge_id
            JOIN commerce.orders o ON o.tenant_id=c.tenant_id AND o.outlet_id=c.outlet_id AND o.id=c.order_id
            WHERE a.tenant_id=r.tenant_id AND a.repayment_id=r.id),'[]'::jsonb) allocations
        FROM finance.customer_repayments r
        WHERE r.tenant_id=$1 AND r.customer_account_id=$2
      ) statement ORDER BY created_at,event_id`, [session.tenantId, id]);

    let balance = 0n;
    const entries = eventResult.rows.map(row => {
      const amount = BigInt(row.amount_minor);
      const debit = row.event_type === 'CHARGE';
      const allocations = row.allocations as Array<{ amountMinor: string; receiptNumber: string; orderId: string }>;
      if (!debit) {
        const allocatedAmount = allocations.reduce((sum, allocation) => sum + BigInt(allocation.amountMinor), 0n);
        if (allocatedAmount !== amount) {
          throw new DomainError('CUSTOMER_LEDGER_INTEGRITY_FAILED', 'Customer repayment allocations do not match the recorded collection.', 500);
        }
      }
      balance += debit ? amount : -amount;
      if (balance < 0n) throw new DomainError('CUSTOMER_LEDGER_INTEGRITY_FAILED', 'Customer statement balance is inconsistent.', 500);
      return {
        id: row.event_id,
        type: row.event_type as 'CHARGE' | 'REPAYMENT',
        amountMinor: amount.toString(),
        balanceAfterMinor: balance.toString(),
        createdAt: row.created_at,
        reference: row.reference,
        orderId: row.order_id,
        receiptNumber: row.receipt_number,
        allocations,
      };
    });
    const account = accountResult.rows[0];
    if (balance !== BigInt(account.balance_minor)) {
      throw new DomainError('CUSTOMER_LEDGER_INTEGRITY_FAILED', 'Customer statement does not reconcile to the account balance.', 500);
    }
    return {
      customer: {
        id: account.id,
        name: account.display_name,
        phone: account.phone,
        email: account.email,
        creditLimitMinor: account.credit_limit_minor,
        balanceMinor: account.balance_minor,
        status: account.status,
        version: Number(account.version),
      },
      entries,
      generatedAt: new Date().toISOString(),
      currency: session.currency,
    };
  });
}
