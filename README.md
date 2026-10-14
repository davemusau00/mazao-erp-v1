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

## Current UI

- **Server-connected:** Today shift state, cash and approved customer-account POS charges, sales history/cash refunds with server-sourced receipt identity/tax/tender details, item setup, delivery receiving, full outlet stock counts with reviewed posting, reconciled shift cash-up with immutable server Z reports, customer repayment collection evidence and statements, room/reservation/check-in/checkout/housekeeping foundation, and `finance.view`-gated trial balance plus partial operating-summary reports with journal drill-through.
- **Manage:** server business/legal/contact details, current outlet settings, receipt headers/footers, tax defaults, supported capabilities and first-sale setup checks. Owner/admin can edit; managers can review.
- **Remaining v1:** staff/device administration, multiple outlets, restaurant operations, supplier/PO/AP workflows, item editing/packages/import, full hotel folios, financial periods and bounded offline transactions. The [completion register](docs/27-V1-COMPLETION-REGISTER.md) preserves this scope. Archived prototype components are unreachable from the application.
- **Help and recovery:** operator guidance, IndexedDB retention of actual unconfirmed commands, original-command retry and server status lookup. This journal is recovery evidence; it does not authorize offline sales.

The interface uses an OLED dark theme with blue and emerald semantic accents. Navigation and the main workflows adapt to role, enabled business type, and screen width.

## Integration boundary

Every reachable workspace uses the authenticated server context. Browser preview storage no longer initializes, reads or overwrites historical local records. Only modules listed as connected in the integration register are available; missing v1 services remain documented work.

The v1 UI service contracts are in `src/types/ui.ts`; the current HTTP adapter is `src/services/apiClient.ts`, and backend domain commands live in `apps/api/`. Server reports read posted journal evidence tenant-wide; the operating summary is explicitly partial. Customer receivables are now represented in the journal and account subledger, but supplier AP, period controls, full source reconciliation and complete financial statements are not implemented. Contract types for modules without server endpoints remain design boundaries, not implemented services.

## Deployment pilot

The isolated VPS target is `93.127.131.55`, with `https://mazao.davemusau.co.ke` serving the PWA and its same-origin `/api/v1` API. See [the deployment guide](docs/13-INFRA-DEPLOYMENT.md) for the verified shared-host inventory, CI release artifacts, protected services and rollback procedure, and [the backup runbook](infra/BACKUP-RUNBOOK.md) for off-host recovery checkpoints. Deployment health does not expand the server-connected module coverage listed above.

All builds require server sign-in. There is no preview flag or automatic fallback. Settings contracts and acceptance are documented in [Business configuration integration](docs/28-BUSINESS-CONFIGURATION-INTEGRATION.md). [The deployment evidence](docs/25-PILOT-DEPLOYMENT-2026-10-14.md) records release identities and recovery checks.

## Product specifications

The product requirements, interaction design, domain constraints, and release gates live in `docs/`. Start with `docs/01-PRODUCT-PRD.md`, `docs/02-UX-DESIGN-SYSTEM.md`, and `agents/AGENTS.md` before extending the application.

The current role journey review, prototype gaps, service integration gate, report coverage requirements, and unverified accessibility/viewport matrix are recorded in `docs/23-UI-JOURNEY-REVIEW.md`.
