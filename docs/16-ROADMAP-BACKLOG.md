# Greenfield development roadmap

No calendar dates are promised; progression is gated by evidence rather than optimistic percentages.

## Phase 0 · Discovery and founding specification
Artifacts: user journeys, UX research, product capability matrix, ADRs, financial posting policy, tax/integration assumptions. Exit: five core operator journeys approved, naming and tenant policy frozen.

## Phase 1 · Repository and platform foundation
Mono-repo, pinned versions, CI, container API, health checks, PostgreSQL migrations, contract generator, logging, identity, tenancy isolation, permissions, design tokens, PWA skeleton. Exit: isolated empty tenants and protected API paths with tests, staging deploy and restore rehearsal.

## Phase 2 · First-operational vertical slice
Item Wizard, basic catalog/stock, cashier sales, cash and manual M-Pesa evidence, till, receipt documents, fast POS, audit and elementary sales report. Exit: fresh-business full shift online and exact-ID retry pass.

## Phase 3 · Stock and foodservice
Purchase packaging, receiving, counts, sealed/open, recipes, floor/tables/tickets, returns, kitchen/bar route, suppliers/PO/AP. Exit: full restaurant shift and receiving/counting concurrency pass.

## Phase 4 · Rooms and hotel
Rate policies, availability, reservations, walk-in, stay, charges, deposit, checkout and housekeeping; room race accepted. Exit: receptionist end-to-end room lifecycle plus bookkeeper reconciliation.

## Phase 5 · Finance and reports
COA, ledger, historical COGS, P&L, cash/reconciliation, periods, hospitality revenue policy, multidimensional reports, CSV exports, role visibility. Exit: trial balance, P&L completeness and report-to-source drilldown.

## Phase 6 · Offline and hardware production hardening
Signed device grants, IndexedDB migrations, offline cash, sync, print agent, browser upgrade, actual 80mm/hardware test, restore. Exit: 100-sale replay and full blackout shift physical acceptance.

## Phase 7 · Repeatable SaaS onboarding
Self-service tenant provisioning, subscription entitlement (later payment), staff devices, isolation at scale, customer support diagnostics, alerting, billing console isolated from operators. Exit: multiple distinct businesses onboarded without bespoke deployment.

## Work tracking rules
Each epic broken into a vertical slice: workflow, contract, DB, domain service, UI, tests, offline matrix, docs, observability. Define tests before implementation. Prioritize failure paths. Old code not reused by default. Never create fake persisted business data to satisfy demo acceptance.
