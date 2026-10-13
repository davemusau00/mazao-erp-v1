# Mazao ERP

Mazao ERP is a task-first business workspace for retail, food service, and hospitality teams. The current repository contains a React/Vite local preview of the product UI.

## Run the UI preview

**Prerequisite:** Node.js 20 or newer.

```sh
npm install --legacy-peer-deps
npm run dev
```

Open the Vite URL printed in the terminal. `npm run typecheck` checks both the UI and API TypeScript; `npm run test:api` runs API boundary tests; `npm run build` creates the static PWA bundle.

## Run the backend integration slice

The repository now includes a Fastify/PostgreSQL API for authenticated sessions, catalog reads, operator shifts, and cash sale/stock receipt/product commands. For database provisioning, environment variables, initial-tenant bootstrap and the explicit module-by-module integration status, follow [Backend integration register](docs/24-BACKEND-INTEGRATION.md). Start PostgreSQL, apply migrations, and bootstrap an initial operator before running `npm run api:dev`; the UI dev server proxies `/api/v1` to the API.

## Current UI

- **Today:** shift snapshot, local sales activity, and common task shortcuts.
- **Sell and Sales history:** point of sale, receipts, transaction lookup, and the preview's supported return flow.
- **Stock and Purchasing:** item catalogue, stock levels, movement review, count review, and supplier/delivery drafts.
- **Hotel and Tables & kitchen:** room operations, reservation availability preview, guest bills, floor/table orders, and kitchen status preview.
- **Customers and Shifts:** customer accounts, repayments, till activity, and cash-up.
- **Money and Reports:** ledger and operating summaries from preview data.
- **Setup checklist, Manage, and Help:** first-use readiness steps, setup areas, operator guidance, and recovery entry points.

The interface uses an OLED dark theme with blue and emerald semantic accents. Navigation and the main workflows adapt to role, enabled business type, and screen width.

## Integration boundary

Most workspaces still use seeded browser-local data and simulated operator profiles. Signing in connects only the modules listed as connected in the integration register. Other local screens do not become server-authoritative by signing in. Do not use local preview flows to record real business transactions.

The v1 UI service contracts are in `src/types/ui.ts`; the current HTTP adapter is `src/services/apiClient.ts`, and backend domain commands live in `apps/api/`. Contract types for modules without server endpoints remain design boundaries, not implemented services.

## Product specifications

The product requirements, interaction design, domain constraints, and release gates live in `docs/`. Start with `docs/01-PRODUCT-PRD.md`, `docs/02-UX-DESIGN-SYSTEM.md`, and `agents/AGENTS.md` before extending the application.

The current role journey review, prototype gaps, service integration gate, report coverage requirements, and unverified accessibility/viewport matrix are recorded in `docs/23-UI-JOURNEY-REVIEW.md`.
