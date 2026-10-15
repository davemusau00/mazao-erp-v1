# UI parity restoration status

**Stage:** Foundation, customer directory, full-outlet stock count, outlet analytics, command recovery center, receipt presentation, and remaining-module discovery (local slices 1–6, partial)
**Working base at this checkpoint:** `0c4f0a12d7a497e54a780227567da1d86b317752`
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
- Receipt preview keeps the server snapshot as its only source, restores a narrow thermal-slip layout and print page sizing, and retains exact minor-unit amounts and explicit cash/change or account-charge evidence. A mocked-API browser journey verifies receipt contents and states that browser printing does not acknowledge a physical printer.
- Management now also exposes disabled supplier payable, offline sales/sync, and external payment provider cards with reasons. Hotel and reservations remain visibly partial, purchasing remains limited to supported delivery workflows, and restaurant service remains visibly disabled. This is module discovery only.
- Latest verification at this checkpoint: `npm run typecheck` passed; `npm run test:api` passed 38 tests with 8 PostgreSQL-dependent skips; `npm run test:e2e` passed all 24 tests, including the discovery cards and server receipt view. `npm run build` passed, splitting the 479.41 kB main bundle from the management and analytics chunks.

## Remaining front-end and backend parity gaps

- **Customers:** Browser flows against real PostgreSQL data are still unverified in this environment. Approved reference screenshot comparison, statement/command recovery under concurrent changes, and role-specific authenticated browser journeys remain open.
- **Stock count:** Real PostgreSQL count creation, draft persistence, posting, history, and conflict recovery could not be exercised here because no disposable database is configured. Approved screenshot parity and count-specific desktop viewport/accessibility review remain open.
- **Analytics:** The new SQL aggregate endpoint has not been exercised against PostgreSQL here. Tenant/outlet isolation, range aggregation, refunds, and payment totals still require the real database integration lane. Approved screenshot parity and analytics-specific viewport/accessibility review remain open.
- **Recovery and receipts:** The command center is connected to retained status records, but import recovery still needs browser coverage for selecting the original source file and reconciling validation status. Receipt snapshot layout has a browser flow, but approved original screenshot comparison and cross-printer print preview remain open; physical printer acknowledgment is unavailable.
- **Other modules:** Discovery cards now identify supplier/AP, assets, staff/roles/devices, offline, and advanced payment areas as unavailable. Restaurant tickets, supplier/AP lifecycle, asset records, full staff/device administration, offline transactions, and provider-confirmed payments need verified server contracts before any action can be enabled. Their visible shells do not imply backend completion.
- **Shared QA:** The `docs/ui-parity/` before/after captures compare the previous settings-first screen with this management overview. Browser acceptance also captures all seven requested viewports as test artifacts. Approved original screenshot assets were not present in this checkout, so exact reference-image parity remains unreviewed. Keyboard/screen-reader, contrast, and reduced-motion review also remains open.
- **Database acceptance:** Local API integration tests and PostgreSQL-backed browser tests require a disposable PostgreSQL database. This environment had no `TEST_DATABASE_URL`, `MAZAO_E2E_DATABASE_URL`, or Docker daemon; those checks must pass in PostgreSQL-enabled CI before this slice is considered fully accepted.

## Next slices

1. Complete import recovery coverage, then obtain approved reference images and compare all restored views.
2. Complete real PostgreSQL-backed API and browser acceptance, keyboard/ARIA/contrast/reduced-motion review, and required viewport screenshots.
3. Implement additional module behavior only after authoritative backend contracts are available.

Do not describe the overall UI parity work as complete until these gaps have evidence and all required PostgreSQL-backed acceptance has passed.

## Staff access checkpoint — 2026-10-15

**Branch:** `feat/staff-workspace-access`, based on freshly fetched `origin/main` and merged locally into this feature branch. The tested source HEAD for this checkpoint is recorded in the accompanying delivery report. **PR #8 is already merged** (`09e58f30e3a1e0bb1d17e2b2d58dc8fb097e6874`, merge commit `8859078de4b36b8acd7c4040484520e376b6df2f`) and its original check failed. This checkpoint does not merge to main or deploy.

### Verified in the disposable PostgreSQL environment

- `npm run typecheck` passed after the API and staff workspace implementation.
- `npm run test:api` passed **62/62** with PostgreSQL enabled, including tenant/role restrictions, assignment selection only after correct credentials, staff command idempotency, credential/session protections, and migration 016's historical-upgrade acceptance.
- Migration 016 acceptance now compares the entire prior receipt/order evidence with only the additive `operator_name_snapshot` excluded, and checks the new snapshot separately. Existing immutable evidence is not relaxed or rewritten.
- `npm run test:e2e` passed **24/24**, including connected Staff and Workspace assignments cards for authorized sessions, disabled unsupported management cards, and cashier navigation restrictions. Existing screenshot tests cover the currently configured responsive browser sizes.
- `npm run test:integration` passed **9/9** against Docker PostgreSQL. The new real browser journey provisions a staff membership, confirms the first credential through the protected password operation, creates an outlet assignment, and verifies each persisted row. Existing configuration, sales and CSV import database journeys also passed.
- The test database was the local disposable PostgreSQL 16 container `mazao-staff-ci-e935f6c455e8` on loopback port `65264`; it contains no production data.

### Staff, credential, assignment and navigation state

- Authenticated staff, device assignment, operator session, and password endpoints now use existing tenant-scoped read/credential services and permission checks.
- Staff and assignment commands dispatch through the existing transaction, audit/outbox, and idempotency path. Replaying an access command revalidates the active operator and current server permission before returning stored outcome data.
- Login verifies credentials before returning an assignment-choice response; choices include only that identity's active authorized assignments. Wrong-password responses do not enumerate assignments.
- Manage now connects the Staff and Workspace assignments cards to server-backed directory, membership, credential/session, and assignment operations. Staff and assignment features are enabled only for sessions with their server read permission. Role grant editing, physical device/printer state, and printing acknowledgment remain unavailable and visibly disclosed.
- Existing Business, Outlet, Capabilities, Readiness, and CSV Import routes remain in place. Other unsupported staff, asset, supplier/AP, offline and payment-provider operations remain disabled.

### Remaining gates

- GitHub PR #8 cannot be updated because it is closed as merged; its historical failure is not evidence about the corrected HEAD. Follow-up PR #9 is open. Its first run (`38751931424`) passed migration application and checksum rerun, typecheck, and all API tests, then failed during Vite build because this workspace file had invalid UTF-8 middle-dot bytes. The file was repaired, `npm run build` passed, and `npm run test:e2e` passed 24/24 after the repair. Hosted run `38752514181` on `33f32704506ca4d15c4b0b8e1e960c587367fe9c` then passed migration application/rerun, typecheck, API, browser, real PostgreSQL browser integration, and production-container readiness. Its image-publish steps were skipped because this was a PR run. Do not merge while the current PR head has any required check red, and do not deploy.
- No approved original reference screenshot set has been compared in this checkpoint. The seven-size screenshot matrix, accessibility/contrast/reduced-motion audit, manager-role authenticated browser journey, and multi-session unauthorized browser demonstration remain outstanding. The local real browser suite demonstrates an admin session and the existing cashier/unauthorized restrictions; API tests cover role and tenant isolation.
- All unrelated UI parity gaps listed above remain open. This staff-access checkpoint is not a claim that the seven-stage parity restoration is complete.

## Live deployment checkpoint - 2026-10-15

**Deployed source:** `cee759ef9408528e8fbf1fc8d4888e5a848f2f1f` (merged `main`; PR #9). **GitHub Actions:** run [38753457824](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38753457824) succeeded on this exact SHA, including typecheck, API, e2e, real PostgreSQL browser integration, image build/migrations/readiness, and release artifact publishing.

- Before activation, a fresh encrypted off-host backup was restored in an isolated PostgreSQL 16 container. Backup `20261015T174526-81eefc4207974f48895f913be60cf75f.dump.dpapi`, SHA256 `001A6E071B9F7DEBC96D8E2D681EC39C08AC7672CED19A235B644B2191A61993`; restore verification recorded 15 prior migrations, one tenant, 13 orders, 43 journal entries, and zero unbalanced journals.
- The deployed API image carries revision label `cee759ef9408528e8fbf1fc8d4888e5a848f2f1f` and matches CI-published GHCR digest `sha256:d82e98d4900b0d70470353c94cb444141a6ebcf28a9cfaafe5ec5fd7ee9e4a8c`. The PWA GitHub artifact SHA256 was verified as `8f918c3d5febc9efa22d853e070bdf02f5ef1574a49e63069b8f3d269abc6ac4`; transferred release archive SHA256 was `d0fa61df00a3be834fb98b75b3f44ddcb627908d9f3b71403f07bbefa4fe8fd5`.
- The release activation applied migration 016 and immediately reran all migrations with matching checksums. Post-deploy live database totals: 16 migrations, one tenant, one outlet, 13 orders, 43 journal entries, zero unbalanced journals. No acceptance transactions were created.
- API readiness returned `{"status":"ready","database":"available"}` from the server and through the public HTTPS origin. The static `current` symlink resolves to `/var/www/mazao/releases/cee759ef9408528e8fbf1fc8d4888e5a848f2f1f`.
- The existing Mazao PostgreSQL container ID remained `550e4715bd457a29e2dee38bca30b89cceced6f0ff2651ace4d09fa21b39144e`. The API alone was recreated. All unrelated running container IDs and images matched the captured pre-deploy inventory. Nginx configuration passed `nginx -t`; all seven checked Nginx configuration hashes matched pre-deploy values.
- This release checkpoint supersedes the earlier note that PR #9 was open and that the latest backup lacked restore verification. Overall UI parity is still incomplete: approved original screenshot comparison, the full seven-viewport visual matrix, accessibility/contrast/reduced-motion audit, authenticated manager browser journey, and broader module parity remain open. Deployment does not claim those gates passed.

## Staff credential configuration deployment - 2026-10-15

**Release:** `34049906b76f908995732c5bcc9c2b550e566a3a` (PR #10, merged after green CI). The live API previously lacked `CREDENTIAL_FINGERPRINT_KEY`, so protected initial-password operations could not be completed. The key is now generated once, stored in `/srv/mazao/.env` with mode 0600, and passed only to the Mazao API container by the required Compose setting. Its value is intentionally excluded from logs and this document.

- Main CI run [38761089745](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38761089745) passed on the merge SHA, including migration/checksum validation, typecheck, API tests, browser tests, PostgreSQL browser integration, API image readiness, and artifact publishing. Published API digest: `sha256:d6f13e2c226c1c7198fb2374581ddad756e0ae952495ec42f5fc3f174f6acdcc`. The PWA artifact SHA256 was `239c912b4b87c9629bc180fd852dd2257ad394699fb5b8a135d65d7b34faf9ee`; transferred archive SHA256 was `d0722b3d4ed5c0fbe600786d09c44378e7aeebad758295d5a7baae3abb948889`.
- Immediately before deployment, encrypted backup `20261015T182622-03dfabc4d5ab49eb96e76dc5f6d7e515.dump.dpapi` was restored in an isolated PostgreSQL 16 container. SHA256 `416A01E1CCC8D0C278FF2FBC1A28BDD06800EF8BBA4413E6E5B98B497BB2A480`; restore verified: 16 migrations, one tenant, 13 orders, 43 journal entries, and zero unbalanced journals.
- Migration 016 matched checksums on both activation passes. The API container received the valid configured key; server and public HTTPS readiness returned `ready`, and the public application returned HTTP 200. Nginx configuration passed validation.
- Only the Mazao API container was recreated. The PostgreSQL container ID, all unrelated running container IDs/images, and all seven checked Nginx configuration hashes remained unchanged. No live staff account, order, or payment was created for this deployment.
- The real PostgreSQL/browser CI journey exercised staff creation, initial credential setup, assignment creation, and persisted rows. No live authenticated operator credential was used in deployment verification. Physical workstation pairing and automatic first-login password expiry remain unimplemented; broader UI parity gates listed above are still open.
