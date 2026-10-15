# UI parity restoration status

**Stage:** Foundation, customer directory, full-outlet stock count, outlet analytics, and command recovery center (local slices 1–5)  
**Working base:** `e4c2e5004c3cdafd7bcb1ccf6465198a6c045089`  
**Fetched `origin/main`:** `df1007d9682eed211f7faf4cd71d6fcd54e4f869`  
**Release state:** Local implementation only. No merge or deployment.

## Delivered in this slice

- A typed feature registry now drives authorized sidebar/mobile destinations and the management overview. Session permissions and enabled business capabilities determine whether supported destinations can open.
- Manage opens on the original-style administration card grid, using business and outlet identity from the authenticated session. Business, outlet, capability, and first-sale readiness forms continue using their existing server configuration APIs and versioned commands.
- The setup checklist route opens the real readiness screen. Data Import opens the existing reviewed product CSV workflow when `catalog.manage` and inventory capability are present.
- Staff, role editing, device/printer management, and assets remain visible as disabled cards with explanations. Restaurant navigation stays visible but disabled. No preview storage, seeded business data, or fake device state was added to the authenticated entry graph.
- The authenticated customer workspace now restores the original four-card KPI strip, account filters, compact desktop table, mobile account cards, status badges, account dialogs, and statement view while using only the server account list, statement endpoint, and existing commands.
- Portfolio balances, credit limits, available credit, and utilization are calculated from integer minor-unit strings with `BigInt`. Failed list reads show unavailable KPIs rather than treating an error as zero. Account read authorization is shared by the list and statement handlers and has direct role/capability tests.
- The stock-count workspace now puts scan/search first. Barcode suggestions map through the authorized catalog read model to lines already present in the persisted full-outlet baseline and focus their quantity fields. The interface does not add selective items; complete outlet coverage, variance reasons, manager review, saved drafts, version conflicts, and command recovery stay intact.
- Added browser coverage for the mobile manager scan path and cashier navigation restriction. Count drafts, history, post, and conflict still need live database-backed coverage.
- An authenticated read-only operational analytics endpoint now returns outlet-scoped confirmed order, cash payment, customer account charge, refund, daily, and product aggregates from a repeatable-read snapshot. The dashboard reports coverage and excluded provider methods; product totals are explicitly before refunds, and the dashboard does not estimate profit. Trial balance and the explicitly partial operating summary remain available in Money.
- Added analytics role/capability and date-range policy tests, plus browser coverage for outlet scope and provider/coverage disclosures.
- Added customer browser coverage for exact server balance rendering, account filtering, manager setup, cashier read-only access, and no-shift repayment blocking. The latest full browser suite passes with 22 tests.
- The recovery banner opens a command center that lists retained command IDs, checks server status without resubmitting, and links operators to the relevant workspace. Import validation references have a separate path that does not claim the CSV contents are stored. Recovery reads are filtered to the signed-in operator. Offline sync and physical printer acknowledgment remain disabled/unavailable.

## Remaining front-end and backend parity gaps

- **Customers:** Browser flows against real PostgreSQL data are still unverified in this environment. Approved reference screenshot comparison, statement/command recovery under concurrent changes, and role-specific authenticated browser journeys remain open.
- **Stock count:** Real PostgreSQL count creation, draft persistence, posting, history, and conflict recovery could not be exercised here because no disposable database is configured. Approved screenshot parity and count-specific desktop viewport/accessibility review remain open.
- **Analytics:** The new SQL aggregate endpoint has not been exercised against PostgreSQL here. Tenant/outlet isolation, range aggregation, refunds, and payment totals still require the real database integration lane. Approved screenshot parity and analytics-specific viewport/accessibility review remain open.
- **Recovery and receipts:** The command center is connected to retained status records, but import recovery still needs browser coverage for selecting the original source file and reconciling validation status. Receipt snapshot rendering still needs the original receipt typography and layout review; physical printer acknowledgment is unavailable.
- **Other modules:** Restaurant tickets, supplier/AP lifecycle, asset records, full staff/device administration, offline transactions, and provider-confirmed payments need verified server contracts before any action can be enabled. Their visible shells do not imply backend completion.
- **Shared QA:** The `docs/ui-parity/` before/after captures compare the previous settings-first screen with this management overview. Browser acceptance also captures all seven requested viewports as test artifacts. Approved original screenshot assets were not present in this checkout, so exact reference-image parity remains unreviewed. Keyboard/screen-reader, contrast, and reduced-motion review also remains open.
- **Database acceptance:** Local API integration tests and PostgreSQL-backed browser tests require a disposable PostgreSQL database. This environment had no `TEST_DATABASE_URL`, `MAZAO_E2E_DATABASE_URL`, or Docker daemon; those checks must pass in PostgreSQL-enabled CI before this slice is considered fully accepted.

## Next slices

1. Restore receipt presentation from immutable server snapshots and complete browser recovery coverage.
2. Add truthful shells for remaining modules, then complete the viewport, accessibility, and approved-screenshot review.

Do not describe the overall UI parity work as complete until these gaps have evidence and all required PostgreSQL-backed acceptance has passed.
