# Illustrative API, schema and command examples

These are reference skeletons for agents; not deployed code.

## Typed command contract
```ts
export type CommandEnvelope<T extends string, P> = {
  commandId: string; protocolVersion: 1; type: T;
  deviceId: string; occurredAt: string;
  expectedVersions: Record<string, number>;
  payload: P;
};
export type Result<T> =
  | { status: 'CONFIRMED'; commandId: string; result: T; serverSequence: number }
  | { status: 'REJECTED'|'CONFLICT'|'REQUIRES_ONLINE'; commandId: string; error: { code: string; message: string } };
```

## Idempotency SQL skeleton
```sql
CREATE TABLE system.commands (
  tenant_id uuid NOT NULL,
  command_id uuid NOT NULL,
  request_hash bytea NOT NULL,
  command_type text NOT NULL,
  status text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,command_id)
);
```
Do not interpret uniqueness alone as complete exactly-once execution. It must be in one DB transaction with operation and recorded outcome, with per-command locking on duplicate concurrent arrival.

## Financial tables skeleton
```sql
CREATE TABLE finance.journal_entries (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  source_type text NOT NULL, source_id uuid NOT NULL,
  posted_at timestamptz NOT NULL, currency char(3) NOT NULL,
  UNIQUE (tenant_id,source_type,source_id)
);
CREATE TABLE finance.journal_lines (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES finance.journal_entries(id),
  account_id uuid NOT NULL, debit_minor bigint NOT NULL DEFAULT 0,
  credit_minor bigint NOT NULL DEFAULT 0,
  CHECK(debit_minor>=0 AND credit_minor>=0 AND NOT(debit_minor>0 AND credit_minor>0))
);
```
Application posting routine verifies sum debits == sum credits under transaction and refuses empty/all-zero journals; add tenant consistency FK and tenant-aware constraints in implementation.

## Inventory movement contract
```json
{"type":"inventory.receive","payload":{"purchaseOrderId":"...","locationId":"...","lines":[{"stockItemId":"...","packageId":"...","packageCount":"4","packageCostMinor":90000}]}}
```
Integer money minor units mean KES 900 is `90000`. Decimal quantities are strings in JSON to avoid float drift. Client preview displays 24 cans for 4 packs x 6.

## OpenAPI example fragment
```yaml
openapi: 3.1.0
info: {title: Mazao ERP API, version: 1.0.0}
paths:
  /api/v1/commands:
    post:
      operationId: submitBusinessCommand
      summary: Submit an idempotent authenticated business command
      responses:
        '200': {description: Original or newly confirmed outcome}
        '409': {description: Stale version or mismatched replay payload}
```
