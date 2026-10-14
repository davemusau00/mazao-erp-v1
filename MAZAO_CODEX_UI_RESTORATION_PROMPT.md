# Codex implementation handoff: Restore Mazao UI fidelity and keep all modules discoverable

You are working on `davemusau00/mazao-erp-v1`. Read `MAZAO_UI_PARITY_RESTORATION_SPEC.md` supplied alongside this prompt. The last inspected baseline was `df1007d`; **re-fetch actual main HEAD and current CI before editing**. The repo may have changed.

Your mission is to **restore the approved original Mazao design in the authenticated server application**, not redesign it, and **keep unfinished modules visible in an honest disabled state**. Do not confuse cosmetic feature discovery with backend completion.

## Non-negotiables

- Original screenshots and preserved legacy components (`CustomerDirectoryView`, `AnalyticsView`, `StockCountWorkspace`, `ManageWorkspace`, `SyncCenterModal`, `ReceiptModal`) are reference designs; current `Backend*` components hold valuable real server state and command-recovery logic. Merge the strengths, not their data models.
- Never import local `storage` or seeded demo financial records into authenticated production components.
- Never loosen server permission checks or invent success, zero balances, synchronization, print/device acknowledgment, operational profit or payment-provider confirmation.
- Existing PostgreSQL command contracts, identity/tenant scope, auth cookies/CSRF, integer minor money units, decimal quantities, weighted-average stock valuation, journals, immutable receipts, idempotency and unknown-result recovery must remain intact.
- Every existing module must appear in the authorized product navigation or administration hub. Unsupported actions remain visibly disabled with accurate tooltips/help text, not hidden, dead or clickable fake actions.
- Retain original Mazao fonts, CSS custom properties, component proportions, left navigation, active blue, dark panels, 4-up KPI cards, condensed data tables, search/scan, dialog treatment and receipt print aesthetics. SERVEOS is a separate product, not a direct theme to copy.
- Preserve and extend passing CI, create before/after screenshots and actual Postgres-backed browser acceptance. No production deployment without explicit approval and verified latest-backup recovery.

## Execute in PRs, each with full tests

1. **Foundation:** Create one typed feature registry and availability mechanism. Use it in `AppShell` sidebar/mobile menu and `BackendManageWorkspace`. Show the complete administration card grid as default, connected links for Business/Outlet/Capabilities/Readiness/Stock CSV Import and disabled Staff/Permissions/Devices/Assets. Restore Setup checklist navigation to the real server readiness screen. Keep disallowed reads private. Add browser assertions for disabled navigation and status. Preserve current setting forms/tests.
2. **Customers:** Restore original KPI cards, filters, table, status badges, dialogs and responsive hierarchy in `BackendCustomerWorkspace`. Use `GET /customers`, statement endpoint and existing commands; money arithmetic must be exact with `BigInt`. Add tests for arithmetic and permission restrictions.
3. **Stock count:** Restore original scan-first count layout and autocomplete, using actual server count session baseline. Barcode comes from authorized catalog/line read model. Full-outlet completeness and manager authorization remain mandatory. Support saved drafts, variance preview, history, conflict recovery. Never allow selective posting unless an authoritative spot-count feature exists.
4. **Analytics:** Restore operational dashboard cards/charts and tender/product charts, but implement explicit read-only aggregate APIs, scoped reports and coverage metadata. Cash/account credit only until provider methods exist. Do not use local report estimates or fabricated values. Keep accounting trial-balance/partial-P&L workspace.
5. **Recovery and printing:** Restore original sync-center layout as a server-command recovery center, with future offline features disabled. No fake sync queue. Bring receipt aesthetics in line with the original using server snapshots; physical printing remains unverified until tested.
6. **All remaining modules:** Show restaurant, hotel partial features, suppliers/AP, assets, staff/devices, offline and advanced payments in the same original UI system. Connect only operations already proven by backend contracts. Unsupported actions remain visible but impossible to submit.
7. **QA:** Run typecheck, API unit/integration, real API/PostgreSQL Playwright flows, visual snapshots at 390x844, 800x1280, 1024x600, 1280x720, 1280x800, 1366x768, 1920x1080, plus keyboard/aria/contrast/reduced-motion checks. Demand approved screenshot parity as well as green tests.

## Initial delivery acceptance

Your first PR should have working code for the visual feature registry, restored management grid, visible-but-disabled legacy modules and a real connected readiness page. Demonstrate admin, manager, cashier, and unauthorized sessions, and preserve the existing configuration routes and all tests. Document precise remaining front/back parity gaps before subsequent PRs.

Do not claim a complete UI parity fix until all seven PR stages above have evidence. Never auto-merge or deploy. At each checkpoint report exact HEAD, files, tests, screenshots, connected/disabled features and remaining blockers.
