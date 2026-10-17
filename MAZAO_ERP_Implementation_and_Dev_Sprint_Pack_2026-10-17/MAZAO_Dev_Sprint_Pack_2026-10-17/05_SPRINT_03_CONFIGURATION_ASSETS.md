# Sprint 03 | Configuration PNG assets, schema 017 and receipt compatibility

**Priority:** P0 for data integrity, P1 for optimization · **Suggested effort:** 2–4 focused days including upgrade tests · **Depends on:** Sprint 00 green + Sprint 02 instrumentation.  
**Status:** PR #18 contains `apps/api/migrations/017_configuration_assets.sql`, `configuration.ts` staged PNG handling and authenticated asset routes. This is **candidate** code. Deployed `main` is still at migrations 001–016.

## Problem and required outcomes

Current deployed configuration may carry base64 PNG data inline with every business settings response. The operator observed a **683,935-byte** successful JSON body, a prior malformed body and a >10-second configuration read. This creates avoidable transfer/memory costs; it does not prove why a specific response stalls.

A robust design returns **small settings metadata** and serves image bytes by separate authenticated URLs. **All existing stored images must continue to render; reprints of historical receipts must preserve original evidence after edits.**

## Current candidate architecture

- `017_configuration_assets.sql` introduces `core.configuration_assets` with `tenant_id`, `kind` (`logo|receipt_qr`), `draft_id`, bytea `content`, SHA-256, byte length, `PENDING|ACTIVE|RETIRED`, timestamps, uniqueness of active asset by tenant+kind and deduplicated draft IDs.
- `POST /api/v1/configuration/assets` stages PNG bytes with protected session and CSRF. Same draft ID + same content is an idempotent success; same draft ID + different content is a conflict.
- `GET /api/v1/configuration/assets/:assetId` serves authenticated `image/png` by tenant scope with `Cache-Control: private, no-store`. `GET .../assets/legacy/logo` and `/legacy/receipt_qr` are supported in the candidate backend for existing inline data.
- `GET /api/v1/configuration` removes large legacy image fields from the SQL-projected JSON, returning reference URLs and essential business/outlet/capability/readiness metadata.
- `configuration.business.update` supports explicit `imageActions.logo|receiptQr` of `keep|remove|replace`, staging and active/retired transitions in a transaction. It must never remove stored images when unrelated business fields are saved.

## Required implementation review

### Schema and compatibility

- Test **fresh install**, upgrade from schema 016 with a representative active business and inline PNGs, and **idempotent migration rerun**. Applied 001–016 checksums must remain unchanged.
- Reconcile migration 017 against separate credential-operation fencing work. Neither `017_configuration_assets.sql` nor a future `017_*` can coexist under the runner's list as applied duplicates. Choose distinct numbers **before either is applied in production**; do not rename an already applied migration.
- Ensure tenant-scoped asset foreign keys and access checks; prevent cross-tenant image retrieval and stage draft reuse. Review whether lower-privilege users may read receipt QR and logo, aligned with legitimate receipt usage.
- Confirm authorized `config.manage` is required to stage/upload and activate/remove assets. Audit decisions are tenant and actor specific.
- Avoid materializing base64 images into response logs/audit/outbox; use asset IDs, hashes and changes of state only.
- Set retention/GC rules only after confirming no historical document or active configuration references an asset. Never delete `ACTIVE` or receipt-referenced assets as routine orphan cleanup.

### Image validation and performance

- Validate proper PNG signature, chunk structure/CRC, dimensions, byte upper bound **512 KiB**, and safe decompression ceiling. Reject invalid/truncated payload, SVG masquerade and decompression bombs.
- Check base64 transfer expands payload to ~4/3; ensure route-specific body limits and supported form behaviors under PNG max size.
- Browser upload must use draft UUID and must show staged/upload failed/unknown/saved status, not silently drop image. Validate an asset is staged for the **same tenant and kind**.
- `keep` + empty non-image fields must not remove image refs; `remove` must be deliberate, separately reviewable and version-checked. Concurrent editors should receive version conflict, not overwrite each other silently.
- Test external HTTPS logo URL behavior separately from uploaded PNG. Do not allow `javascript:`/HTML/SVG injection via URL fields.
- Return compact metadata to browser and load image bytes lazily. Keep all existing business settings forms and visual layout stable.

### Immutable receipt evidence

- The sales/receipt projection may snapshot logo/QR identity and tax configuration. Test a receipt created with logo/QR A, then replace with B or remove current settings, then reprint prior sale. Original identity/QR representation must remain identical or an explicitly documented immutable reference must resolve.
- Verify current receipt images render in browser and printer preview, without re-embedding megabytes in common settings responses.
- Never rewrite posted receipts, shift close reports or financial evidence to make migration easier.

## End-to-end acceptance scenarios

1. Existing production-shaped tenant on 016 has inline logo and QR. Apply 017 to cloned disposable DB; GET metadata references `legacy` routes; both bytes/digests match previous PNGs.
2. Stage maximum allowed PNG logo/QR separately. Same draft id+same bytes returns same stage; altered bytes with same ID returns 409; wrong tenant denied.
3. Save `replace` both images as explicit business command; GET metadata **<32 KiB**, URLs resolve and images render; checksum/hash checked.
4. Update phone/tax/receipt footer with `keep` actions; images remain intact.
5. Remove only QR with explicit `remove`; logo remains; historical receipt QR still resolves.
6. Concurrent business changes obey versions; rejected edits do not activate uncommitted assets.
7. Two simulated staff roles receive only authorized business/asset reads, no mutation access when unauthorized.
8. Interrupted staging response retried with **same** draft ID; never create contradictory active assets or expose base64 in logs.
9. Route through actual Bun API container and Nginx for body-length/timing measurements with Unicode and PNG fixtures.
10. Upgrade→rollback-app compatibility assessed: older API may not understand new asset references, even if schema migration is additive. Define compatibility behavior before production cutover.

## Evidence gates

- [ ] Upgrade/fresh/rerun migration checksum tests green (001–017 or uniquely renumbered manifest).
- [ ] `configuration-assets.integration.test.ts` and `configuration.integration.test.ts` cover max PNG, keep/replace/remove, legacy, audits, role/tenant, receipt snapshots.
- [ ] Compact settings response measured, slow-repro trace compared against old implementation.
- [ ] No business logo/QR lost; no financial document rewritten.
- [ ] API smoke + real browser image checks green in CI before publication.
- [ ] Migration/rollback readiness recorded; no live DB modifications without fresh restore-verified off-host backup.
