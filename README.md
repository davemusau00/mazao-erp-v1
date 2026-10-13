# Mazao ERP

Mazao ERP is a task-first business workspace for retail, food service, and hospitality teams. The current repository contains a React/Vite local preview of the product UI.

## Run locally

**Prerequisite:** Node.js 20 or newer.

```sh
npm install --legacy-peer-deps
npm run dev
```

Open the Vite URL printed in the terminal. `npm run lint` runs the TypeScript check and `npm run build` creates the static PWA bundle.

## Current UI

- **Today:** shift snapshot, local sales activity, and common task shortcuts.
- **Sell and Sales history:** point of sale, receipts, transaction lookup, and the preview's supported return flow.
- **Stock and Purchasing:** item catalogue, stock levels, movement review, count review, and supplier/delivery drafts.
- **Hotel and Tables & kitchen:** room operations, reservation availability preview, guest bills, floor/table orders, and kitchen status preview.
- **Customers and Shifts:** customer accounts, repayments, till activity, and cash-up.
- **Money and Reports:** ledger and operating summaries from preview data.
- **Setup checklist, Manage, and Help:** first-use readiness steps, setup areas, operator guidance, and recovery entry points.

The interface uses an OLED dark theme with blue and emerald semantic accents. Navigation and the main workflows adapt to role, enabled business type, and screen width.

## Prototype boundary

This build uses seeded browser-local data and simulated operator profiles. It has no authenticated API, shared database, production tenant isolation, or server-enforced authorization. UI status labels therefore distinguish local preview data from server confirmation. Manage sections are informative and do not save configuration. Do not use this preview to record real business transactions.

The v1 service contracts are in `src/types/ui.ts`. They define typed boundaries for command outcomes, sales, stock counts, room stays, shift cash-up, repayments, and reports. They do not imply that backend implementations exist.

## Product specifications

The product requirements, interaction design, domain constraints, and release gates live in `docs/`. Start with `docs/01-PRODUCT-PRD.md`, `docs/02-UX-DESIGN-SYSTEM.md`, and `agents/AGENTS.md` before extending the application.

The current role journey review, prototype gaps, service integration gate, report coverage requirements, and unverified accessibility/viewport matrix are recorded in `docs/23-UI-JOURNEY-REVIEW.md`.
