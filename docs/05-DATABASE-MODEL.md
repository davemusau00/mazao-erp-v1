# PostgreSQL schema and persistence specification

## Conventions
Primary IDs UUID/ULID (choose one and apply consistently); `tenant_id` on all tenant-owned rows; append-only immutable financial and inventory evidence; `created_at`, `updated_at`, `created_by`, optional `version BIGINT`, strict FK and indexed tenant-scoped lookups. Logical deletion only for non-transactional master data. Use schema migrations, never ad hoc production DDL. Migration checksums are immutable after deployment.

## Core aggregate tables
| Domain | Primary tables |
|---|---|
| Identity | users, organizations, memberships, roles, role_permissions, devices, approval_grants, sessions |
| Organization | outlets, stock_locations, business_settings, feature_entitlements, receipt_profiles |
| Catalog | product_families, product_variants, prices, barcodes, purchase_packages, tax_classes, recipes, recipe_ingredients |
| Inventory | stock_items, stock_balances, stock_movements, stock_reservations, sealed_containers, open_container_balances, stock_counts, count_lines, stock_transfers |
| Commerce | orders, order_lines, tickets, ticket_lines, payments, payment_allocations, refunds, till_sessions, till_movements, receipt_documents |
| Hospitality | room_types, rooms, rate_plans, reservations, stays, guests, folios, folio_entries, housekeeping_tasks, room_blocks |
| Procurement | suppliers, purchase_orders, po_lines, goods_receipts, grn_lines, supplier_invoices, accounts_payable, supplier_settlements |
| Finance | accounts, journal_entries, journal_lines, accounting_periods, expenses, reconciliation_runs |
| Ops | employees, assets, asset_events, maintenance_work_orders, attachments, imports, import_rows |
| System | commands, command_outcomes, change_feed, transactional_outbox, worker_attempts, audit_events, offline_grants, device_sequences |

## Mandatory constraints/indexing
Tenant FK consistency (do not accept cross-tenant referenced IDs), uniqueness `(tenant_id, sku)` and `(tenant_id, barcode)` where active, `(tenant_id, client_command_id)` idempotency, `(tenant_id, outlet_id, business_date)` for daily reports, and `(tenant_id, device_id, sequence)` for local command replay. Prevent duplicate payment provider references within the appropriate merchant/account scope. Journal postings must be balanced per currency and journal entry; validate under serialized posting transaction. Nonnegative quantities where policy forbids negative stock, using locks/version checks rather than naive read-then-write.

## Authorization model
API enforces tenant scope for every query and mutation, plus business permission. Optionally enable PostgreSQL RLS as defense in depth; never rely solely on RLS or assume ORM tenant filters are sufficient. Service credentials cannot reach frontend. Employee membership is not a global business-wide privilege.

## Versioning and migration
Add-only expansion migrations preferred; feature flags for changed behavior; compatibility between N and N-1 deployed client protocols for a defined window. No drop/rename until consumers migrated and verified. DDL tested against empty DB and real-shaped sanitized fixture backup. Large tables: indexes concurrently where supported; document lock impact.

## Recommended schema groups
`identity`, `core`, `catalog`, `inventory`, `sales`, `hospitality`, `procurement`, `finance`, `ops`, `system`. Do not create a giant generic JSON documents table as the primary store for critical financial transactions. JSONB acceptable for noncritical user settings, typed metadata and snapshots alongside relational columns.

## Derived values
Stock on hand and customer balance are derived from immutable evidence, with transactional materialized/current-balance table for fast reads. Reconciliation must recompute balances and prove equality. Historical costs from movements/sale consumption snapshot, not mutable current product cost.
