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

The repository includes a partial Fastify/PostgreSQL API for authenticated sessions, catalog and inventory reads, item setup, reviewed receiving, operator shifts, cash sales/refunds, and the initial hotel room/reservation/stay workflow. The [Backend integration register](docs/24-BACKEND-INTEGRATION.md) maps each connected screen to its client calls, routes, commands, persistence effects, and unsupported boundaries. Start PostgreSQL, run `npm run db:migrate`, and bootstrap an operator before `npm run api:dev`; the UI dev server proxies `/api/v1` to the API. CI provisions PostgreSQL for migration and API acceptance checks.

## Current UI

- **Server-connected:** Today shift state, cash POS, sales history/cash refunds, item setup, delivery receiving, shift cash-up, room/reservation/check-in/checkout/housekeeping foundation.
- **Local preview only:** stock counts, restaurant tables/kitchen, customer accounts, finance/reporting, staff/device management, onboarding, and settings. These are hidden while connected to the backend.
- **Help and recovery:** operator guidance, IndexedDB retention for unknown server commands, status lookup, and demo-only sync tools remain clearly separated.

The interface uses an OLED dark theme with blue and emerald semantic accents. Navigation and the main workflows adapt to role, enabled business type, and screen width.

## Integration boundary

The app has both seeded browser-local preview data and authenticated server-backed journeys. Signing in connects only modules listed as connected in the integration register. Unsupported local mutation screens are hidden in server mode; local preview success does not represent a server transaction. Do not use local preview flows to record real business transactions.

The v1 UI service contracts are in `src/types/ui.ts`; the current HTTP adapter is `src/services/apiClient.ts`, and backend domain commands live in `apps/api/`. Contract types for modules without server endpoints remain design boundaries, not implemented services.

## Product specifications

The product requirements, interaction design, domain constraints, and release gates live in `docs/`. Start with `docs/01-PRODUCT-PRD.md`, `docs/02-UX-DESIGN-SYSTEM.md`, and `agents/AGENTS.md` before extending the application.

The current role journey review, prototype gaps, service integration gate, report coverage requirements, and unverified accessibility/viewport matrix are recorded in `docs/23-UI-JOURNEY-REVIEW.md`.
