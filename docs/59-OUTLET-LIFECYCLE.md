# Outlet lifecycle and local operating defaults

## Behavior

The Manage outlet screen now lists every outlet in the authenticated tenant and lets an owner/admin create an outlet, edit its identity and time zone, set outlet contact/receipt defaults, and activate or deactivate it. Managers can read the directory and settings. Every edit is versioned and recorded through the command journal, audit event and transactional outbox.

The tenant reporting time zone and business identity remain tenant-wide. A new outlet inherits the business tax default. An owner/admin may set a reviewed exclusive-tax rate and label for one outlet. The selected outlet policy applies to newly created catalog products, hotel rooms and CSV imports. It does not rewrite existing item/room rates or posted receipt snapshots. Outlet contact and receipt fields continue to fall back to business defaults when blank.

Outlet closure requires a reason and current outlet version. The server refuses to deactivate an outlet while it has an open shift or stock count, nonzero stock quantity/value, a checked-in stay, a confirmed reservation or an active workspace assignment. It also requires an active owner/admin workspace assignment in another active outlet. Operators resolve those records and revoke workspace assignments before retrying. Historical data remains tenant-scoped and retained; closure is not deletion.

Outlet create/edit/deactivate uses `core.outlets` and its existing versioned `outlet_profile` JSONB field, so this slice adds no schema migration. It does not enroll a physical terminal. Assigning a user to the new outlet is available through the existing workspace-assignment flow; authenticated context switching is implemented separately in [context switching](60-CONTEXT-SWITCHING.md), with database/browser acceptance pending.

## Acceptance state

The API command schemas, permission checks, tenant scoping, concurrency versions, audit/outbox evidence, closure guards, Manage UI, API response normalization, and outlet-aware tax defaults are implemented. `npm run typecheck` passed. The production PWA bundle built for this slice as `index-Ch6bpAI1.js` (538.07 kB / 146.12 kB gzip) with 22 precache entries (904.61 KiB). The database integration acceptance has not run because the disposable PostgreSQL service is unavailable. Exact-head hosted CI, migration/runtime checks, browser acceptance of outlet lifecycle and context switching, physical-device acceptance and production release evidence remain open.
