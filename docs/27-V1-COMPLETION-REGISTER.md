# V1 completion register

This preserves the full scope of `01-PRODUCT-PRD.md`, the domain specifications and `15-TESTING-ACCEPTANCE.md`. A deployed slice does not complete v1. No unreachable prototype screen counts as a connected feature.

The next-priority investigation and proposed delivery sequence for customer wording, cashier-confirmed manual M-Pesa, currency amount discounts on individual sale lines, and accounting/reporting improvements is recorded in [the 18 October remediation plan](46-POS-PAYMENTS-REPORTING-REMEDIATION-2026-10-18.md). It records source findings and required acceptance; these additions are not yet implemented or accepted.

| Order | Area | Connected foundation | Required remaining work |
| --- | --- | --- | --- |
| 1 | Business and setup | Server identity, business/outlet profile, receipt metadata, tax defaults, supported capability administration and computed checklist | Additional outlets/switching, locations, persistent reviewed go-live, complete operational settings |
| 1 | Staff, devices, permissions | Server password/session and role/device validation | Operator create/edit/deactivate, outlet assignment, recovery/password change, enrollment/revocation, session review, granular approvals; resolve login's single-assignment constraint |
| 2 | Catalog and import | Item create; reviewed server CSV mapping/validation/error export/create or SKU metadata update/history; base-unit barcode/category/reorder metadata and immutable opening import valuation | Direct edit/archive, category administration, variants, packages/conversions, services/nonstock, XLSX and package-aware import; see docs/29 for CSV limits and acceptance |
| 2 | Inventory | Immutable weighted-average receiving and reviewed full-outlet count | Locations, transfers, waste/adjustments, spot/blind counts, unknown barcodes, zero-baseline value review, reserved/provisional projections and reconciliation |
| 3 | Sales and payments | Cash or full approved customer-account sale, VAT-aware capped cash refunds, immutable receipt snapshots, reconciled till close | Held baskets/tabs, discounts/void approvals, split tender, manually confirmed M-Pesa evidence, guest charges, credit/noncash refunds, tender/Z reporting |
| 4 | Procurement and AP | Reviewed receipt with supplier/reference evidence and inventory accrual | Supplier master, PO/approval/delivery links, invoices/matching/duplicate guard, costs/tax allocations, payable subledger/partial payments/reconciliation |
| 5 | Restaurant | No server workflow yet | Tables/stations/modifiers, persisted order edits/fire, kitchen/bar completion, transfers/splits/voids, recipe/yield/sealed-open consumption policy and exactly-once settlement |
| 6 | Hotel | Room/reservation/walk-in/check-in, booked-night cash checkout, dirty→ready | Types/rates/quotes/availability, deposit liability, service/food folio charges, partial payments/reversals, statements, actual-night/early/late/day rules, extension/move/approved balance and cleaning/inspection/holds |
| 7 | Customers | Credit limit, account charge, FIFO cash repayment and reconciled statement | Credit reversal, split/noncash repayment, aging/export and AR control checks |
| 7 | Finance, assets and reports | Balanced journals, source-reconciled cash close, trial balance and explicitly partial operating summary/drilldown | COA/mapping, expenses, AP/deposits/assets, periods/late-post rejection, complete supported statements, source/subledger/valuation reconciliation and scoped exports |
| 8 | Offline and synchronization | Durable exact-command journal and server status recovery | Signed operator/device grants, bounded allocations/exposure, local projections/drafts/cash evidence, ordered replay/feed/cursors, conflicts, quota/migration/restart/fenced recovery, worker/retry/dead-letter |
| 8 | Printing | Immutable server receipt and browser print/text fallback | Printer profiles/copy/document hash semantics; optional paired print agent and physical acceptance when configured |
| 9 | Final acceptance | Passing slice CI and isolated release/backup controls | Full suites A–H, every required operator workflow, accessibility/scanner/touch/screen-reader matrix, offline races/restarts, exact release evidence and measured performance |

Every new slice needs typed contracts, permissions, transaction/idempotency/audit/version evidence, migration upgrade/fresh/rerun, negative cases, browser acceptance and integration documentation. Deploy only the accepted exact commit and preserve the prior API/static release and forward database history. Protect all unrelated VPS services.

Acceptance must include first-use → first sale → cash close; split/manual tender and replay; package/recipe/count/transfer; restaurant fire→complete→settle; guest deposit→folio→partial settlement→checkout→clean; customer/AP reconciliation; period close; 100 permitted offline sales and repeated replay; tenant/role/device adversarial checks; the seven requested viewports and physical/scanner checks where configured.

Explicitly deferred: automated M-Pesa/eTIMS, loyalty, public booking, advanced payroll, native business applications, AI insights, reseller billing and advanced revenue management. Manual payment confirmation, ordinary hotel/restaurant operations and required offline accounting remain v1 work.
