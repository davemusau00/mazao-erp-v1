# API and command protocol

## Transport
HTTPS JSON REST + incremental change feed; OpenAPI generated from source-checked schemas. Prefix `/api/v1`; no browser direct SQL/RPC, no public internal admin endpoints. All write paths accept stable client idempotency identifier. Support SSE/WebSocket notification as optional wake-up only; authoritative changes are pulled by cursor.

## Canonical envelope
```json
{
  "commandId":"018f...", "protocolVersion":1, "tenantId":"...", "deviceId":"...",
  "type":"sales.order.settle", "expectedVersions":{"order:...":7},
  "occurredAt":"2026-10-13T16:00:00.000Z", "payload":{"orderId":"...","tenders":[{"method":"CASH","amountMinor":170000,"currency":"KES"}]}
}
```
`tenantId` in body is advisory only and must match authenticated context; never accept as authorization. Server transaction inserts command record with unique `(tenant_id,command_id)` and request hash, refuses replay with same ID/different payload, executes once, persists deterministic outcome and feed event. Retrying exact ID returns original outcome without reposting. Scoped optimistic `expectedVersions` only for resources actually touched.

## Response
```json
{"commandId":"018f...","status":"CONFIRMED","serverSequence":1234,"result":{"orderId":"...","receiptId":"..."},"changed":[{"collection":"orders","id":"...","version":8}]}
```
Statuses: `CONFIRMED`, `REJECTED`, `CONFLICT`, `OUTCOME_UNKNOWN` (client-local interpretation when response lost), `REQUIRES_ONLINE`, `REQUIRES_APPROVAL`. Error taxonomy: `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VERSION_CONFLICT`, `INSUFFICIENT_STOCK`, `RESOURCE_OCCUPIED`, `LIMIT_EXCEEDED`, `CAPABILITY_EXPIRED`, `IDEMPOTENCY_MISMATCH`, `PROVIDER_PENDING`, `INTERNAL_ERROR`. Human-facing mapping belongs in UI.

## Endpoints
- `POST /api/v1/auth/login` (or OIDC completion), `/auth/refresh`, `/auth/logout`, `/auth/me`.
- `POST /api/v1/commands` server-authoritative domain mutation.
- `GET /api/v1/commands/:id` status check, permission scoped.
- `GET /api/v1/sync/changes?cursor=...&limit=...` ordered tenant/device-authorized feed; opaque monotonic cursor, paginated.
- `GET /api/v1/bootstrap` initial scope snapshots with checksum, schema version, cursor; large bootstrap streamed/chunked.
- `GET /api/v1/catalog/items`, `/orders/:id`, `/inventory/locations/:id`, `/hospitality/rooms`, `/reports/*` focused read projections.
- `POST /api/v1/devices/enroll`, `/devices/:id/revoke`, `/offline/grants`, `/imports/validate`, `/imports/apply`.
- `GET /health/live`, `GET /health/ready`, `/metrics` only on protected/private network for internals.

## API safety
Pagination, bounded payload, rate limiting, schema validation, permission on every handler, opaque cursors, request IDs. Do not leak stack traces or personal data. API responses include `ETag` where suitable, stable error codes, as-of metadata. Breaking changes require new contract version and consumer matrix.

## Command tests
Replay exact ID, same ID/different hash, concurrent sale of last item, concurrent room claim, user unauthorized, device revoked, manager approval consumed twice, server committed/request timed out, stale expected version, same cash settlement repeated after restart. All must be deterministic.
