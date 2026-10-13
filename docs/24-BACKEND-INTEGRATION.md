# Backend integration register (v1 foundation)

This document records which product surfaces currently cross the authenticated API boundary. It is intentionally explicit: the local demo store is not a backend, an outbox row is not a remote acknowledgement, and an API command is not a payment-provider confirmation.

## Runtime and operator setup

The API is a Fastify modular-monolith process at `apps/api/src/server.ts`; PostgreSQL is required through `DATABASE_URL`. The Vite development server proxies `/api/v1` to `http://127.0.0.1:4101`. The API binds to loopback by default. Production must terminate TLS and route `/api/v1` to this process; do not expose the development bind address as a public deployment configuration.

1. Start a PostgreSQL instance and provide `DATABASE_URL` (and optionally `DATABASE_SSL=require`, `DB_POOL_SIZE`).
2. Run `npm run db:migrate`. Migration `001_initial` is checksummed; it must not be edited after application. Add a new numbered migration for future changes.
3. Provide `BOOTSTRAP_CONFIRM=CREATE_INITIAL_TENANT`, `TENANT_NAME`, `TENANT_CURRENCY`, `TENANT_TIME_ZONE`, `OUTLET_NAME`, `OUTLET_TIME_ZONE`, `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (12+ characters), and `DEVICE_LABEL`; run `npm run api:bootstrap` once. Bootstrap stores only a scrypt hash and prints generated IDs, never the password.
4. Run `npm run api:dev` and `npm run dev`. Sign in through **Connect backend**. Login requires exactly one active outlet/device assignment for the supplied user.

`APP_ORIGINS` is a comma-separated exact-origin allowlist for unsafe methods; configure it in production. `SESSION_HOURS` defaults to 12. Cookies are HttpOnly for session, SameSite Strict, Secure in production, plus a CSRF cookie/header pair. Session membership, user and device are rechecked against PostgreSQL on each request. Login has an in-memory per-process rate limit; use a shared gateway limiter for multiple API replicas. No secret values belong in source control.

## API and service connections

All routes use `/api/v1`; JSON errors have `{ error: { code, message } }` shape. The browser client is `src/services/apiClient.ts`; backend connection is explicit and demo/local mode remains separate.

| Route | Auth | Current behavior |
| --- | --- | --- |
| `GET /health/live` | no | Process liveness only |
| `GET /health/ready` | no | Checks PostgreSQL connectivity |
| `POST /auth/login` | no | Email/password, unique active membership/device, DB session and CSRF cookies |
| `GET /auth/me` | session | Current server actor, tenant, outlet, device |
| `POST /auth/logout` | session + CSRF | Revokes session and expires cookies |
| `GET /catalog/items` | session + catalog/sell/receive permission | Tenant/outlet product snapshot with integer minor-unit prices and decimal quantity strings |
| `GET /shifts/current` | session + shift permission | Current operator's open shift, if any |
| `POST /commands` | session + CSRF | Idempotent command receipt; domain work/audit/outbox are in a serializable transaction |
| `GET /commands/:commandId` | session | Tenant-scoped authoritative command outcome for unknown-result recovery |

Command envelope: `{ protocolVersion: 1, commandId, tenantId?, deviceId, type, occurredAt, expectedVersions, payload }`. The authenticated session, not body-supplied actor/tenant values, determines authority. Reusing an ID with a different body is rejected. Business errors are retained as `REJECTED` or `CONFLICT`; confirmed response is retained for replay. If a network failure occurs, keep the same command ID and query status before retrying.

| Command | Permission | Payload | Effects |
| --- | --- | --- | --- |
| `catalog.product.create` | `catalog.manage` | `sku,name,baseUnit,currency,sellingPriceMinor,costPriceMinor,taxRateBps` | Product + zero balance, audit event, transactional outbox |
| `inventory.receive` | `inventory.receive` | `lines: [{productId,quantity:string,unitCostMinor}]` | Locks products, adds decimal stock, immutable receipt movement, inventory/accrual balanced journal, audit/outbox |
| `shift.open` | `shift.open` | `openingFloatMinor` | One open shift/operator/outlet, optional balanced opening journal, audit/outbox |
| `shift.close` | `shift.close` | `shiftId,countedCashMinor`; expected version key `shift:<id>` | Version-checked close and variance journal when needed, audit/outbox |
| `sales.order.settle` | `commerce.sell` | `shiftId,lines:[{productId,quantity:string}],tenders:[{method:'CASH',amountMinor,currency}]`; expected key `shift:<id>` | Validates available stock and cash coverage, posts sale/tax/COGS, consumes stock, records cash payment allocations, advances shift, audit/outbox |

Sale tender values express cash handed over; only the amount due is posted as payment and excess is returned as change. Cash is the only confirmed tender today. Card, mobile money and mixed-provider settlement are rejected as online-required until a provider adapter can verify them. The API uses integer minor units, 6-place decimal quantity, tax basis points and tenant currency. Product tax comes from the product's configured rate; tenant/outlet timezone is returned by session.

## UI connection state

- The top bar's **Connect backend** signs into server identity; local demo operator selection and seeded records are not server identities.
- Signed-in POS fetches server catalog and current shift. It blocks non-cash tender and requires an open server shift. Confirmed server sale is rendered in receipt preview and the catalog is refreshed.
- An unknown checkout response retains its command envelope and displays **Check status**. `GET /commands/:id` decides confirmed/rejected/conflict; status lookup is tenant-scoped. A confirmed lookup clears the cart, but this first connector does not yet reconstruct a lost receipt from the stored outcome.
- Signed-in Shifts uses API `shift.open` / `shift.close`; local demo shift controls are shown only without server session.
- Other workspaces continue to use prototype local/demo services and must be labeled accordingly in operator workflows. They are not silently claimed as API-backed.

## Module coverage and gaps

| Module / journey | Integration state | Next service boundary |
| --- | --- | --- |
| Identity, tenant/outlet/device session | Connected | Password reset, MFA, invitation, multiple outlet switching, session administration |
| Catalog and POS cash sale | Connected | Catalog UI management, discounts, customer/guest tenders, receipt retrieval and server sales history |
| Stock receipt | API command exists; UI not yet adapted to API | Supplier/PO workflow and receiving review screens |
| Shift open/close | Connected in signed-in shift workspace | Payout evidence, drawer reconciliation, supervisor approvals and full shift report |
| Refunds | Not connected | Idempotent partial/full refund command, original payment allocation, VAT reversal, stock disposition |
| Card/M-Pesa | Not connected | Provider intents/webhooks, verified settlement/reversal and reconciliation |
| Stock counts/transfers/adjustments | Not connected | Count sessions, blind count, variance review, versioned adjustment and transfer commands |
| Restaurant tables, kitchen/bar tickets, settlement | Not connected | Table/order/ticket command services and kitchen display subscription |
| Hotel availability, reservations, stay/check-in, folios, guest checkout, housekeeping | Not connected | Availability locking, reservation lifecycle, folio charges and evidence-backed settlement/cleaning |
| Customer accounts/repayments | Not connected | Credit policy, repayment receipt, allocations and customer ledger |
| Finance reports/ledger/drill-through | Not connected | Journal query/report endpoints with coverage, freshness and reconciliation metadata |
| Purchasing, supplier invoices, AP | Not connected | Supplier/PO, receipt matching, payable posting and audit |
| Staff roles, permissions, device management, business settings, onboarding | Not connected | Server administration APIs, granular permission grants and approval audit |
| Import/export and conflict center | Not connected | Staged import validation/apply, durable conflict policies and operator review |
| Printing/cash drawer | Local browser/hardware prototype only | Device gateway, printer acknowledgement/status and receipt spool authority |

The transactional outbox is written atomically for connected commands. This release has no outbox worker, external delivery, or remote sync acknowledgement. `/health/ready` verifies the database, not every dependency. There is no API-side offline command replay yet: high-risk commands are online-only. Do not display these operations as remotely synchronized until server acknowledgement exists.

## Integrity and acceptance limitations

The initial schema provides tenant/outlet ownership, active memberships/devices, command idempotency, command results, audit events, versioned shifts/balances, immutable movements, balanced journal constraints, and atomic command transactions. Refund protection/tax reversal, financial report verification, and provider-backed payment evidence are not implemented. Role mapping is coarse and must be replaced by tenant-scoped permission grants before broad production use. API and PWA have compile/build evidence; a running PostgreSQL environment is required to validate the migration, bootstrap, authentication and transaction journeys. No production deployment is included.
