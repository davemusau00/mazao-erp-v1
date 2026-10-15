# Product CSV import integration

## Operator journey

From **Stock → Import products**, download the template or choose a UTF-8 CSV. Map the source columns, choose whether matching SKUs may receive metadata updates, and validate every row. Validation stages a tenant/outlet-scoped review batch. It does not create products, stock movements or financial journal entries.

Review the row errors, warning explanations, normalized values and proposed create/update/unchanged changes. Download errors as CSV, correct the source and validate again. Any validation error blocks the whole import. A successful validation still requires explicit review and warning acknowledgment before applying the batch. The server rechecks permissions, business policy, catalog versions and concurrent stock counts during the atomic commit.

An interrupted request is an **unknown outcome**. Preserve its command ID and use status lookup or retry the original command. Do not upload and apply a second batch to resolve uncertainty. Confirmed imports remain accessible in import history after refresh.

History lists the latest 50 batches; all batch evidence remains on the server. Review totals use the currency and tax default captured by server validation, including when another operator changed configuration after this session signed in.

## CSV boundary

- UTF-8 CSV only for this slice; limits are 512 KiB, 1,000 data rows, 50 columns and 2,048 characters per cell.
- Quoted commas/newlines, doubled quotes, UTF-8 BOM and CRLF are supported. Structural errors, duplicate headers and invalid mapping must be resolved before row validation.
- SKU identifies a product within the current outlet. File duplicates, ambiguous matches, archived products and conflicting barcodes are reported explicitly.
- Prices and costs are decimal amounts in the tenant currency, converted to integer minor units with its configured decimal precision. Exponents, negative values, overprecision and overflow are rejected. Quantity/reorder values are nonnegative decimal strings with at most six decimal places.
- Barcode is text: preserve leading zeroes and avoid spreadsheet scientific notation. This slice supports a base-unit barcode; package barcode factors and package conversions need the later packaging workflow.
- New products need a name, base unit, selling price and reference cost. Unmapped currency/tax use the displayed business defaults. Existing products retain unmapped metadata. Existing base unit and currency cannot be changed by import.
- Category, barcode and reorder level are catalog metadata. Import updates do not recalculate historical sale prices, tax snapshots, receipt identity, carrying value or quantities.
- Checkout submits the displayed catalog revisions. A later price/tax metadata import makes the older basket conflict before charging; the operator refreshes and reviews the new total. Earlier clients without a product revision may only settle unchanged revision-one products.
- Error CSV fields are quoted and formula-leading cells are neutralized for spreadsheet use. The report names the source row, field, issue code, original value and corrective message.

## Opening stock and accounting

Opening quantity applies only to a newly created product, in its base unit, with an explicit opening unit cost. Existing-product opening quantities are rejected; use receiving or reviewed counts to change stock. Explicit zero opening cost requires acknowledging its valuation warning.

For nonzero new opening stock, the transaction creates an immutable `OPENING_IMPORT` movement, exact quantity/carrying value and a balanced `OPENING_PRODUCT_IMPORT` journal: debit `INVENTORY`, credit `OPENING_BALANCE_CLEARING`. It does not represent supplier receiving, a payable or cash collected. Extended values round half-up to currency minor units under ADR 0006. Zero-value stock has movement evidence but does not create an empty journal.

The batch retains its source hash, mapped validation snapshot, actor and commit references. Repeating a confirmed apply returns the original result and does not repeat stock or journal posting. A stale review fails without partial changes and requires a new validation and review.

## Application and service contracts

| Surface | Contract | Authority |
| --- | --- | --- |
| Validate source and mapping | `catalog.import.validate` | Authenticated `catalog.manage`, inventory capability, current tenant/outlet; creates a staged validation batch only |
| Revalidate stored source | `catalog.import.revalidate` with batch/version | Creates a new review under the current operator and current business/catalog records; does not reuse the old approval |
| Apply reviewed batch | `catalog.import.apply` with batch/version, review and warning acknowledgment | Server revalidation, transaction, idempotency, audit/outbox; opening stock additionally requires `inventory.receive` |
| History and reviewed batch | `GET /api/v1/catalog/imports`, `GET /api/v1/catalog/imports/:id` | Tenant/outlet and catalog permission scoped; durable server records |
| Error report | `GET /api/v1/catalog/imports/:id/errors.csv` | Same scope and permission; formula-safe CSV |
| Catalog and scanning | `GET /api/v1/catalog/items` | Product metadata plus product revision; stock balance revision remains separate |
| Recovery | Command submit/status routes and IndexedDB exact-command journal | Status confirmation from server; browser journal does not authorize offline import |

The exact wire types and validators live in the API import module/contracts and `src/services/apiClient.ts`. Migration `015_product_import.sql` is additive: catalog metadata, scoped uniqueness and import evidence. Applied migration checksums remain unchanged. Runtime rollback uses the previous API/PWA; it does not reverse database migrations or delete imported business data.

## Acceptance and release evidence

Implementation acceptance must cover parser limits/hostile CSV, authorization and tenant isolation, invalid-preview zero writes, metadata preservation, warning acknowledgment, stale review and full-count conflict, opening quantity/value/journal reconciliation, repeat apply, real browser mapping/error correction/commit/history, lost response and reload, and the seven required viewports. Tests use disposable local/CI PostgreSQL fixtures; no test products or paid transactions are inserted into the live business.

### Accepted and deployed on 14 October 2026

Main release **79dcf3d1b2d25ad02d5715d4eb9620216623ba61**, [CI run 38598421665](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38598421665), passed client/API TypeScript, fresh/rerun migrations 001–015, populated upgrade preservation, **49 API/unit/PostgreSQL tests (zero failed/skipped)**, **14 browser state tests**, **8 real browser → API → PostgreSQL journeys**, and matching Bun image migration/readiness checks. The bounded 1,000-row test measured validation **160.0 ms** and apply **737.0 ms** on that CI runner; this is one measured acceptance case, not a production p95 guarantee.

The CSV browser journey covers unsafe-source rejection, precise row errors and safe download, invalid-preview zero authority writes, corrected opening stock, metadata update/history/refresh, barcode sale, VAT receipt and zero-variance cash-up. Separate cases cover lost validation and apply responses/restart/status, metadata-only source recovery, browser storage failure before sending, business-version conflict/revalidation and all seven required viewports. Physical scanner, printer and screen-reader acceptance is not claimed by these browser checks.

The exact CI API/PWA artifacts were activated at **https://mazao.davemusau.co.ke**. Migration 015 applied once and all fifteen checksums matched on rerun. Live Bun **1.4.3** also passed pure CSV parsing/precision/barcode/tax/invalid-money checks with **zero database writes**. Public desktop/mobile Chromium verified HTTPS app and health responses, exact artifact JS hash, visible 48px sign-in actions, no preview records and no uncaught errors. These public checks use signed-out sessions; authenticated operator journeys use disposable CI fixtures.

Shared-host protection, encrypted backup checkpoint, retained rollback and the still-open latest-backup restore exception are recorded in [deployment evidence](25-PILOT-DEPLOYMENT-2026-10-14.md). XLSX, variants, package conversion, direct item archive/edit forms, locations and restaurant recipes remain in the v1 completion register.
