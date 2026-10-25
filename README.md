# Mazao ERP

Mazao ERP is a task-first business workspace for retail, food service, and hospitality teams. The React/Vite application requires an authenticated Fastify/PostgreSQL session in every build. The documented v1 scope is still being completed.

## Run the application

**Prerequisite:** Node.js 20 or newer.

```sh
npm install --legacy-peer-deps
npm run dev
```

Open the Vite URL printed in the terminal. `npm run typecheck` checks both the UI and API TypeScript; `npm run test:api` runs API boundary tests; `npm run build` creates the static PWA bundle.

## Run the backend integration slice

The repository includes a partial Fastify/PostgreSQL API for authenticated sessions, catalog and inventory reads, item setup, reviewed receiving, outlet-wide stock counts, moving weighted-average inventory value, operator shifts and till movements, cash sales/refunds with server-backed receipt lookup, customer credit accounts with receivable posting and cash repayment allocation, tenant-wide trial balance and partial operating reports, and the initial hotel room/reservation/stay workflow. The [Backend integration register](docs/24-BACKEND-INTEGRATION.md) maps each connected screen to its client calls, routes, commands, persistence effects, and unsupported boundaries. Start PostgreSQL, run `npm run db:migrate`, and bootstrap an operator before `npm run api:dev`; the UI dev server proxies `/api/v1` to the API. CI provisions PostgreSQL for migration and API acceptance checks.

Stock now provides **Manage items and categories** for authorized catalog users:
versioned metadata edits, archive/restore and reviewed category rename/merge/archive.
[Catalog maintenance evidence](docs/55-CATALOG-MAINTENANCE.md) records migration 023,
shared CSV validation, stock/count safeguards and recovery checks. This local
continuation has not been deployed; service item types and count conflict recovery
remain in the [execution register](docs/48-CODEBASE-TRUTH-EXECUTION.md).

## Current UI

- **Server-connected:** Today shift state; cash, cashier-confirmed manual M-Pesa or full approved customer-account POS charges; fixed currency amount discounts once per whole item line; sales history/cash refunds with immutable receipt details; item setup, delivery receiving and reviewed full outlet stock counts; optional confirmed stock-shortfall sales with provisional-cost reconciliation; shift cash-up and immutable Z reports; cash customer collections/statements; and the room/reservation/check-in/cash-checkout/housekeeping foundation.
- **Manage:** server business/legal/contact details, current outlet settings, receipt assets/text, tax defaults, supported capabilities and first-sale setup checks. Staff create/edit/deactivate, initial/reset/self passwords, sign-in/session review and logical outlet assignments are connected. Multiple login assignments can be selected; physical terminal enrollment and custom permissions remain open. Configuration edits require `config.manage`.
- **Money:** `finance.view` opens supplier bills, expenses, incoming M-Pesa matching, periods, account display names, controls, trial balance and explicitly partial operating reports with journal drill-through. Manage and Purchasing link directly to supplier bills for authorized users. `finance.manage` records suppliers, expense bills or exactly one delivery's full-value bill, duplicate-protected references, partial bank/M-Pesa payments already made, unpaid-bill reversals, paid operating/rent/utilities expenses and linked corrections. `finance.close` creates and transitions periods; closing/closed dates block ordinary posting and closed periods cannot reopen. Incoming statements match recorded cashier-confirmed M-Pesa only: no provider verification, outgoing/bank reconciliation or statement-completeness claim. These actions record evidence and do not transfer money.
- **Product import:** Stock exposes server-validated UTF-8 CSV upload, column mapping, row errors/download, reviewed create or SKU metadata update, opening stock evidence, history and command recovery. Any error blocks the whole commit. See [Product CSV import integration](docs/29-PRODUCT-CSV-IMPORT-INTEGRATION.md) for exact limits and accounting boundaries.
- **Remaining v1:** multiple outlets and physical device authority, scoped approvals, restaurant operations, PO/partial delivery matching/supplier credits, item editing/packages/service classification/XLSX import, movement-aware counts, full hotel folios, complete supported financial statements, and bounded offline transactions. The [completion register](docs/27-V1-COMPLETION-REGISTER.md) preserves this scope; [CODEBASE-TRUTH.md](CODEBASE-TRUTH.md) defines the prioritized delivery gates. Restaurant and offline financial actions remain unavailable. Archived prototypes are unreachable from the application.
- **Help and recovery:** operator guidance, IndexedDB retention of actual unconfirmed commands, original-command retry and server status lookup. This journal is recovery evidence; it does not authorize offline sales.

The interface uses an OLED dark theme with blue and emerald semantic accents. Navigation and the main workflows adapt to role, enabled business type, and screen width.

## Integration boundary

Every reachable workspace uses the authenticated server context. Browser preview storage no longer initializes, reads or overwrites historical local records. Only modules listed as connected in the integration register are available; missing v1 services remain documented work.

The v1 UI service contracts are in `src/types/ui.ts`; the current HTTP adapter is `src/services/apiClient.ts`, and backend domain commands live in `apps/api/`. Server reports read posted journal evidence tenant-wide. AR/AP/inventory/stock-exception controls and period close are implemented for supported source records; the operating summary remains explicitly partial. Account names are editable display labels, not configurable posting mappings. Deposits, supplier credits, opening balances, depreciation/accruals, complete bank/provider settlement and complete financial statements require further workflows. Contract types for modules without server endpoints remain design boundaries, not implemented services.

## Deployment pilot

The isolated VPS target is `93.127.131.55`, with `https://mazao.davemusau.co.ke` serving the PWA and its same-origin `/api/v1` API. See [the deployment guide](docs/13-INFRA-DEPLOYMENT.md) for the verified shared-host inventory, CI release artifacts, protected services and rollback procedure, and [the backup runbook](infra/BACKUP-RUNBOOK.md) for off-host recovery checkpoints. Deployment health does not expand the server-connected module coverage listed above.

All builds require server sign-in. There is no preview flag or automatic fallback. Settings contracts and acceptance are documented in [Business configuration integration](docs/28-BUSINESS-CONFIGURATION-INTEGRATION.md). [The deployment evidence](docs/25-PILOT-DEPLOYMENT-2026-10-14.md) records release identities and recovery checks.

The latest preserved [19 October release record](docs/47-PRODUCTION-RELEASE-2026-10-19.md) identifies `ce5b8ab` and migrations through 020; audited main `6119ee2` adds migration 021. These are historical source/release records. Current live SHA/schema and production activation of new development are unverified here; the recorded technical performance gate remains open.

## Product specifications

The product requirements, interaction design, domain constraints, and release gates live in `docs/`. Start with `docs/01-PRODUCT-PRD.md`, `docs/02-UX-DESIGN-SYSTEM.md`, and `agents/AGENTS.md` before extending the application.

The current role journey review, prototype gaps, service integration gate, report coverage requirements, and unverified accessibility/viewport matrix are recorded in `docs/23-UI-JOURNEY-REVIEW.md`.
