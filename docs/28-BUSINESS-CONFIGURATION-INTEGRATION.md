# Business configuration integration

## Operator journey

Sign in with the server account, open **Manage**, review Business, Outlets, receipts, Capabilities, and Setup checklist. Owner/admin can save; a manager has read access. Changes are online only. No browser profile grants authority.

Business settings cover display/legal names, registration and tax identifiers, address/contact, website/HTTPS logo URL, receipt header/footer, ISO currency, tenant reporting time zone and the default tax policy. Outlets can be created, renamed, assigned an operating time zone, given contact/receipt overrides and assigned a reviewed tax default. New items, rooms and CSV imports use the selected outlet's reviewed tax policy; outlets without an override inherit the business default. Blank outlet receipt/contact fields use business defaults for future receipts. Existing item/room tax rates and receipt snapshots remain unchanged.

Tax is exclusive in this release. Its default basis-point rate applies when new item or room commands omit a rate. Explicit overrides remain supported. Changing the default never rewrites existing item rates, room rates, posted tax or receipt snapshots. Currency is locked after products, rooms, shifts, customer accounts or journals exist; prices are never silently reinterpreted.

## Contracts and authority

| Contract | Permission | Version | Persisted effect |
| --- | --- | --- | --- |
| GET `/api/v1/configuration` | `config.view`: owner/admin/manager | Business, current outlet and tenant-scoped outlet directory versions in read response | Consistent PostgreSQL snapshot, supported capabilities, currency lock, effective tax policy and computed setup checks |
| `configuration.business.update` | `config.manage`: owner/admin | `business:<tenantId>` | Business/profile version, audit before/after, transactional outbox and canonical command outcome |
| `configuration.outlet.update` | `config.manage`: owner/admin | `outlet:<outletId>` | Selected tenant outlet/profile version, audit before/after, transactional outbox and canonical command outcome |
| `configuration.outlet.create` | `config.manage`: owner/admin | `business:<tenantId>` | Creates a tenant-scoped outlet from supported fields, increments the business version, and records audit/outbox evidence |
| `configuration.outlet.set_active` | `config.manage`: owner/admin | `outlet:<outletId>` | Versioned activation/deactivation with reason; prevents deactivation while stock, shifts, counts, active stays/reservations or workspace assignments remain, and preserves an owner/admin assignment elsewhere |
| `configuration.capabilities.update` | `config.manage`: owner/admin | `business:<tenantId>` | Tenant capability rows/business version, audit before/after, transactional outbox and canonical command outcome |
| `configuration.go_live.approve` | `config.manage` plus owner role | `business:<tenantId>` | Atomically rechecks the first-sale checklist, records owner/reason/time/command evidence, and transitions this tenant from setup to live once |

Source contracts: `apps/api/src/configuration.ts`, `apps/api/src/contracts.ts`, `src/services/apiClient.ts`. The existing `/commands` kernel enforces session/device/tenant identity, CSRF, canonical input hashing, idempotency and serializable atomic commits. Stale versions return CONFLICT. Reusing an ID with different content is rejected. Applied migration `014_configuration` is additive; no old migration was edited.

Supported capabilities are commerce, inventory, retail and hospitality. Commerce requires inventory; retail and hospitality require commerce. Disabling commerce with open tills, inventory with open counts, or hospitality with active stays/reservations is rejected. Both API reads/mutations and navigation enforce relevant enabled capabilities. Historical financial reports/receipts remain available under their permissions. Restaurant services are not selectable until their authoritative implementation exists.

## Recovery and history

The UI retains exact unconfirmed commands in IndexedDB before sending. It blocks new settings changes while an outcome is unknown, offers status lookup or retry of the original ID/content, and restores recovery after browser restart. A confirmed outcome triggers fresh configuration and session reads. Conflicts preserve the draft until an explicit server reload; unsaved navigation/close has a discard prompt. Failure to read recovery evidence prevents new submissions.

New sales snapshot legal/contact/header/footer/tax-label information into `commerce.orders.receipt_profile_snapshot`. Receipt screen, text download and browser print use that snapshot. Old receipts with empty snapshots do not inherit current business metadata. Browser printing opens the system print dialog; there is no simulated drawer pulse or hardware success claim.

The application entry graph contains no legacy storage or preview workspaces. Old local records are not deleted. Archived prototype files are retained for reference and type compatibility, but their seeded fixtures and browser persistence are disabled. The legitimate command journal remains separate from financial authority.

## Acceptance and limitations

- `npm run typecheck`: client and API contracts.
- Migrated disposable PostgreSQL: `npm run test:api`, including configuration authorization, tenant isolation, malformed fields, current currency lock, stale/concurrent updates, replay/audit once, capability guards, default tax and immutable receipts.
- `npm run test:e2e`: explicit HTTP browser fixtures for UI states, unknown outcomes, original-command retry and permission navigation.
- `MAZAO_E2E_DATABASE_URL=<disposable localhost database> npm run test:integration`: real browser → API → PostgreSQL saves, refresh/session updates, capability navigation, response loss after real commit, restart/status recovery, and all seven specified viewport sizes. The harness refuses non-local or unnamed databases.

The checklist is computed from saved identity, the current outlet's reviewed tax, enabled sales/inventory, active items, positive stock or a service, and operator/device records. A newly bootstrapped tenant remains in persisted `SETUP`; the API limits it to configuration, catalog, initial inventory and identity setup routes and blocks ordinary commerce/finance reads and commands. The business owner must confirm the checklist and give a review reason. The API recomputes readiness inside the command transaction, then records immutable one-time `LIVE` evidence. Existing tenants are backfilled as `LEGACY_ACTIVE` without inventing a historical approval. Tenant status and outlet reads are scoped to the authenticated tenant. Outlet closure is blocked until active records are resolved and workspace assignments are revoked. Physical device enrollment and authenticated outlet context switching remain separate work tracked in the completion register.
