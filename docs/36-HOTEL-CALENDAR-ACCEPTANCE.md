# Hotel calendar-date acceptance

Date: **16 October 2026, Africa/Nairobi**. Scope: finishing-audit F03.

## Behavior and contract

Reservation and stay calendar fields are returned as `YYYY-MM-DD`, independent of the API host's time zone and PostgreSQL driver's DATE parser. They are calendar days, not UTC instants. Command reads and list projections explicitly format PostgreSQL dates before the driver sees them. Instant fields such as `checkedInAt` retain their timestamp semantics.

Previously raw PostgreSQL DATE results became JavaScript `Date` objects while their TypeScript declarations said string. Comparisons with the outlet's `YYYY-MM-DD` business date evaluated incorrectly. Reservation check-in now enforces arrival on/before today and departure after today. Checkout remains available from the booked departure day; this fix does not introduce early-departure billing or full folios.

The version-1 commands and their tenant/outlet/role/capability checks, optimistic revisions, serializable unit of work, canonical replay, audit/outbox and accounting rules remain in force. Rejected dates retain their deterministic command outcome without creating stays, folio entries, stock effects or journals. No migration or historical-record change is required.

## Evidence

- `apps/api/test/hotel-calendar.integration.test.ts`: **3 passed, 0 failed, 0 skipped** against task-owned PostgreSQL 16. Runtime/outlet combinations cover UTC/Nairobi, Nairobi/Kiritimati and Los Angeles/Adak. Tests exercise actual authenticated HTTP commands, future and expired arrivals, stable rejected replay, exact reservation/stay/room dates, successful arrival replay, early-checkout rejection without postings, and due checkout with one balanced journal and one cash effect after replay. A separate historical test fixture supplies the already-arrived guest for due checkout; no application clock or live record is rewritten.
- `e2e/integration/hotel-calendar.spec.ts`: **2 passed**, 16.5 seconds, actual browser/API/PostgreSQL at **1024x600 and 390x844**. Today's arrival can check in; tomorrow's cannot. The browser receives calendar text, shows the checked-in stay, disables early checkout, and a forged early-checkout request is also rejected server-side with no folio mutation.
- `npm run typecheck`: passed UI/API TypeScript. `npm run build`: passed, including generated PWA worker.
- Task-owned PostgreSQL 16 on loopback port 55436 passed fresh migrations 001-016 and checksum-safe rerun. Temporary browser ports 3005/4105 kept this test independent of other agents' services.
- The first mobile browser attempt used the desktop navigation button's accessible name and timed out. The test now addresses the actual mobile More-menu control. Both final browser journeys passed.

Screenshots are test artifacts under `test-results/hotel-calendar-*/arrivals-*.png` and `stay-*.png`. Mobile arrival and compact-terminal stay captures were inspected: existing OLED surfaces, blue/emerald actions, readable calendar dates and disabled states remain. No screen composition or styling was changed. Approved-original image comparison, full seven-viewport hotel accessibility and physical-device acceptance remain open.

No deployment, hosted database, physical printer/scanner or offline transaction was used. Production activation still requires its separate release/backup/approval gate.
