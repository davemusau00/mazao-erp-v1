# Customer statement snapshot consistency

Date: 2026-10-16. Addresses audit finding F09.

Previously, `GET /api/v1/customers/:customerId/statement` read the account through one pooled query and its charges, repayments and allocations through another. A legitimate sale or repayment committed between those queries could combine an older account balance with newer activity. The existing reconciliation check then reported ledger corruption even though both committed database states were valid.

The statement now acquires one connection and reads all account/activity evidence inside `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. Its reconciliation therefore compares values from the same committed PostgreSQL snapshot. A sale or repayment committed after the first read appears in a subsequent statement request. There is no financial mutation, cache, retry that hides an integrity error, or change to transaction posting.

The shared `inReadSnapshot` helper commits a successful read, rolls back an unsuccessful read, and releases its connection exactly once. If rollback fails, it discards that connection and preserves the original failure. Existing command transactions continue to use their existing serializable helper.

The API contract, permission/capability checks, tenant filters, statement ordering, allocation checks, exact integer-minor strings and BigInt running-balance reconciliation remain in place. Genuine account or repayment-allocation corruption still returns `CUSTOMER_LEDGER_INTEGRITY_FAILED`. No schema migration, app route, command handler, or UI change is required.

## Acceptance evidence

`apps/api/test/customer-statement-snapshot.integration.test.ts` passes six PostgreSQL tests:

- It deterministically commits a real domain credit sale after the account query and before the activity query. The current statement remains at the prior reconciled state; the next request includes the charge.
- It interleaves a real FIFO cash repayment in the same position and checks the prior snapshot, later balance, and repayment allocations.
- It verifies that deliberately corrupted disposable account balances and repayment allocations still fail reconciliation.
- It verifies exact `9007199254740993` minor-unit text without Number conversion, foreign-tenant 404, unauthorized-role 403, and disabled-commerce 403.
- It verifies PostgreSQL rejects writes in the read-only helper and that later reads still succeed after rollback.
- It verifies a failed rollback discards the connection while preserving the original read error.

The test interleaving wraps the test process's Pool/PoolClient queries. Production has no test hook, delay, or optional concurrency bypass. Fixtures use unique disposable tenants; no production data is involved.

`e2e/integration/customer-statement.spec.ts` passes one real PostgreSQL/browser journey using the existing Customer workspace. It shows a credit charge of 117 minor units, records a 16-minor-unit cash repayment through the UI, verifies the 101-minor-unit statement balance and allocation in PostgreSQL, and confirms them after refresh. It saves a 1280×720 screenshot; the interface was not redesigned.

`npm run typecheck` and `npm run build` pass. Focused API acceptance ran against the task-owned local `mazao_customer_test` database with migrations 001–016. Browser acceptance used the existing allowlisted disposable `mazao_test` database with independent fixtures.

The broader API suite passes **69/69** with both `DATABASE_URL` and `TEST_DATABASE_URL` supplied and `npx tsx --test --test-concurrency=1 apps/api/test/*.test.ts`. A preceding parallel run passed 67/69: the analytics fixture required `DATABASE_URL` at module-import time, and a configuration sale exhausted the existing serializable retry limit under concurrent test-file writes. Those harness/environment limits are not changed by this read-only slice; the serial run is not a claim that the default parallel command passed.

## Boundaries

This guarantees consistency within one statement response. Separate directory, statement, dashboard and subsequent requests can reflect different valid snapshots. `generatedAt` remains the response-generation marker; it is not a historical statement-date parameter or proof of a shared snapshot across multiple HTTP responses. Pagination, customer aging, credit reversals, noncash repayment, broader AR reconciliation, physical acceptance and deployment remain separate work.
