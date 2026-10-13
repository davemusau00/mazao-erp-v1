# Verification matrix and release acceptance

## Test pyramid
Unit tests for pure conversion, money/tax rounding, rates, commands; property-based invariants for quantity/money; contract tests generated from operations manifest; Postgres integration transaction/race tests; HTTP permission and tenancy tests; Playwright end-to-end across role and viewport; optional hardware-in-loop; backup/restore and rollout drills.

## Critical acceptance suites
A. First use: empty database tenant creation, import, outlet, staff, stock, first sale, print, close shift. B. POS: rapid 50-product scan, split tender, mixed tax, void and refund, failed network response, duplicate replay, kiosk browser restart. C. Inventory: multi-level packaging, sealed/open, count draft persistence, unknown barcode, count vs sale concurrency, transfer/waste. D. Hotel: competing same-room requests, walk-in, deposit, service room charge, partial checkout, housekeeping. E. Finance: every journal balances, source reports reconcile, refund and supplier partial pay, period closure and late entries. F. Security: tenant ID swap, role escalation, lost device, forgery/revocation of grant, malicious CSV, approval replay. G. Offline: 100 permitted cash sales with interrupted sync, local migration, double replay, multiple devices. H. Infrastructure: first deploy, rolling API rollback, DB upgrade, offsite restore.

## Gate definitions
`GREEN` means all mandatory tests pass on exact commit/build SHA; `HARDWARE_PENDING` documents untested printer but does not describe physical printing as accepted. No false claims about M-Pesa provider authorization, tax certification, or financial reporting where data incomplete. Physical production acceptance signed per specific printer/scanner/terminal profile and business scenario.

## UI matrix
1024x600; 1280x720; 1280x800; 800x1280; 1366x768; 1920x1080; 390x844. Test keyboard, screen reader, touch, scanner and reduced motion. Click `Confirm` must remain reachable under 600px height.

## Release evidence record
SHA, build digest, migration checksums, tests, database baseline version, environment, device matrix, unresolved known limitations, printed physical slips/photo references, backup confirmation, rollback decision and signed business acceptance. Feature flags used only with explicit cohort and removal criteria.
