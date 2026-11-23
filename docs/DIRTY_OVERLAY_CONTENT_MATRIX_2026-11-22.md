# Dirty overlay content matrix

Read-only comparison of every dirty path in each worktree against the same path at `origin/main` on 22 November 2026, rechecked on 23 November; no source overlay paths changed. CRLF/LF differences are normalized. `CONTENT DIFFERS` is file-level only and does not mean a change should be ported. The per-path inventory lists every dirty path, including these reports and their ZIP package.

## Per-worktree counts

| Branch | Worktree | Dirty paths | Same content | Content differs | New paths | Deleted |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| feat/hospitality-orders-fire | C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp | 17 | 2 | 13 | 2 | 0 |
| review/branch-consolidation-2026-11-22 | C:/Users/Admin/AppData/Local/Mazao/Worktrees/branch-consolidation-review | 7 | 0 | 0 | 7 | 0 |
| review/deployment-baseline-mainline-2026-11-22 | C:/Users/Admin/AppData/Local/Mazao/Worktrees/deployment-baseline-mainline | 1 | 0 | 1 | 0 | 0 |
| feat/guest-registration | C:/Users/Admin/AppData/Local/Mazao/Worktrees/guest-registration | 45 | 32 | 13 | 0 | 0 |
| fix/product-import-resume | C:/Users/Admin/AppData/Local/Mazao/Worktrees/product-import-resume | 1 | 0 | 1 | 0 | 0 |
| codex/restaurant-ticket-handoff-v1 | C:/Users/Admin/AppData/Local/Mazao/Worktrees/restaurant-ticket-handoff-v1 | 18 | 0 | 17 | 1 | 0 |
| feat/catalog-maintenance | C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-catalog-maintenance | 12 | 0 | 9 | 3 | 0 |
| feat/codebase-truth-count-recovery | C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-count-recovery | 47 | 15 | 32 | 0 | 0 |
| fix/credential-operation-fencing | C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-login-hardening | 15 | 0 | 9 | 6 | 0 |
| fix/access-recovery-routing | C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-stock-count | 9 | 1 | 7 | 1 | 0 |

## Per-path inventory

| Branch | Git status | Path | Relation to main |
| --- | --- | --- | --- |
| feat/hospitality-orders-fire |  M | `apps/api/src/app.ts` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `apps/api/src/commandCatalogue.ts` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `apps/api/src/commands.ts` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `apps/api/src/migration.ts` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `apps/api/src/productImport.ts` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `apps/api/test/command-catalogue.test.ts` | SAME CONTENT |
| feat/hospitality-orders-fire |  M | `apps/api/test/product-import-security.integration.test.ts` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `apps/api/test/product-import-upgrade.integration.test.ts` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `docs/56-ITEM-KINDS-SERVICE-SALES.md` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `e2e/integration/product-import.spec.ts` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `src/components/inventory/ProductCsvImportWorkspace.tsx` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `src/services/apiClient.ts` | CONTENT DIFFERS |
| feat/hospitality-orders-fire |  M | `src/types/history.ts` | SAME CONTENT |
| feat/hospitality-orders-fire | ?? | `MAZAO_ERP_P0-P4_MASTER_DEVELOPMENT_INSTRUCTION_2026-10-29.md` | NEW PATH |
| feat/hospitality-orders-fire | ?? | `apps/api/migrations/031_product_import_queue_archive.sql` | NEW PATH |
| feat/hospitality-orders-fire | ?? | `docs/GUEST-REGISTRATION-AND-CHECK-IN-PLAN.md` | CONTENT DIFFERS |
| feat/hospitality-orders-fire | ?? | `docs/MAZAO_ERP_FULL_FUNCTIONALITY_SAAS_OFFLINE_MASTER_PLAN_2026-11-08.md` | CONTENT DIFFERS |
| review/branch-consolidation-2026-11-22 | ?? | `docs/BRANCH_CLEANUP_PROPOSAL_2026-11-22.md` | NEW PATH |
| review/branch-consolidation-2026-11-22 | ?? | `docs/BRANCH_CONSOLIDATION_AUDIT_2026-11-22.md` | NEW PATH |
| review/branch-consolidation-2026-11-22 | ?? | `docs/BRANCH_REF_MATRIX_2026-11-22.md` | NEW PATH |
| review/branch-consolidation-2026-11-22 | ?? | `docs/BRANCH_UNIQUE_CHANGE_INVENTORY_2026-11-22.md` | NEW PATH |
| review/branch-consolidation-2026-11-22 | ?? | `docs/DIRTY_OVERLAY_CONTENT_MATRIX_2026-11-22.md` | NEW PATH |
| review/branch-consolidation-2026-11-22 | ?? | `docs/WORKTREE_STATE_MATRIX_2026-11-22.md` | NEW PATH |
| review/branch-consolidation-2026-11-22 | ?? | `docs/BRANCH_REF_MATRIX_2026-11-22.zip` | NEW PACKAGE |
| review/deployment-baseline-mainline-2026-11-22 |  M | `docs/MAZAO_ERP_FULL_FUNCTIONALITY_SAAS_OFFLINE_MASTER_PLAN_2026-11-08.md` | CONTENT DIFFERS |
| feat/guest-registration |  M | `.env.example` | SAME CONTENT |
| feat/guest-registration |  M | `.github/workflows/ci.yml` | SAME CONTENT |
| feat/guest-registration |  M | `README.md` | CONTENT DIFFERS |
| feat/guest-registration |  M | `apps/api/src/app.ts` | CONTENT DIFFERS |
| feat/guest-registration |  M | `apps/api/src/commandCatalogue.ts` | CONTENT DIFFERS |
| feat/guest-registration |  M | `apps/api/src/commands.ts` | CONTENT DIFFERS |
| feat/guest-registration |  M | `apps/api/src/contracts.ts` | CONTENT DIFFERS |
| feat/guest-registration |  M | `apps/api/src/hospitalityDirectory.ts` | SAME CONTENT |
| feat/guest-registration |  M | `apps/api/src/migration.ts` | CONTENT DIFFERS |
| feat/guest-registration |  M | `apps/api/src/publicInputs.ts` | CONTENT DIFFERS |
| feat/guest-registration |  M | `apps/api/test/hotel-calendar.integration.test.ts` | SAME CONTENT |
| feat/guest-registration |  M | `apps/api/test/postgres.integration.test.ts` | SAME CONTENT |
| feat/guest-registration |  M | `apps/api/test/public-inputs.test.ts` | SAME CONTENT |
| feat/guest-registration |  M | `docs/08-AUTH-SECURITY.md` | SAME CONTENT |
| feat/guest-registration |  M | `docs/11-HOSPITALITY.md` | SAME CONTENT |
| feat/guest-registration |  M | `docs/24-BACKEND-INTEGRATION.md` | CONTENT DIFFERS |
| feat/guest-registration |  M | `docs/27-V1-COMPLETION-REGISTER.md` | CONTENT DIFFERS |
| feat/guest-registration |  M | `e2e/integration/hotel-calendar.spec.ts` | SAME CONTENT |
| feat/guest-registration |  M | `e2e/workspace-recovery-readiness.spec.ts` | SAME CONTENT |
| feat/guest-registration |  M | `infra/docker-compose.example.yml` | SAME CONTENT |
| feat/guest-registration |  M | `infra/mazaoyako/.env.example` | SAME CONTENT |
| feat/guest-registration |  M | `infra/mazaoyako/README.md` | SAME CONTENT |
| feat/guest-registration |  M | `infra/mazaoyako/compose.yml` | SAME CONTENT |
| feat/guest-registration |  M | `infra/mazaoyako/prepare-host.sh` | SAME CONTENT |
| feat/guest-registration |  M | `playwright.browser-matrix.config.ts` | CONTENT DIFFERS |
| feat/guest-registration |  M | `playwright.integration.config.ts` | SAME CONTENT |
| feat/guest-registration |  M | `src/components/hospitality/BackendHotelWorkspace.tsx` | SAME CONTENT |
| feat/guest-registration |  M | `src/components/layout/AppShell.tsx` | CONTENT DIFFERS |
| feat/guest-registration |  M | `src/services/apiClient.ts` | CONTENT DIFFERS |
| feat/guest-registration |  M | `src/services/apiMessages.ts` | CONTENT DIFFERS |
| feat/guest-registration | ?? | `apps/api/migrations/030_guest_registration.sql` | SAME CONTENT |
| feat/guest-registration | ?? | `apps/api/src/guestRegistration.ts` | SAME CONTENT |
| feat/guest-registration | ?? | `apps/api/src/guestRegistrationContracts.ts` | SAME CONTENT |
| feat/guest-registration | ?? | `apps/api/src/guestRegistrationTypes.ts` | SAME CONTENT |
| feat/guest-registration | ?? | `apps/api/test/guest-registration-upgrade.integration.test.ts` | SAME CONTENT |
| feat/guest-registration | ?? | `apps/api/test/guest-registration.integration.test.ts` | SAME CONTENT |
| feat/guest-registration | ?? | `apps/api/test/support/guest-registration-fixture.ts` | SAME CONTENT |
| feat/guest-registration | ?? | `docs/GUEST-REGISTRATION-AND-CHECK-IN-PLAN.md` | SAME CONTENT |
| feat/guest-registration | ?? | `docs/GUEST-REGISTRATION-IMPLEMENTATION.md` | SAME CONTENT |
| feat/guest-registration | ?? | `e2e/hotel-guest-registration.spec.ts` | SAME CONTENT |
| feat/guest-registration | ?? | `e2e/integration/guest-registration.spec.ts` | SAME CONTENT |
| feat/guest-registration | ?? | `src/components/hospitality/GuestRegistrationDialog.tsx` | SAME CONTENT |
| feat/guest-registration | ?? | `src/components/hospitality/GuestRegistrationFields.tsx` | SAME CONTENT |
| feat/guest-registration | ?? | `src/components/hospitality/HotelRegistrationSettings.tsx` | SAME CONTENT |
| feat/guest-registration | ?? | `src/services/guestRegistrationJournal.ts` | SAME CONTENT |
| fix/product-import-resume |  M | `src/components/inventory/ProductCsvImportWorkspace.tsx` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `apps/api/src/commandCatalogue.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `apps/api/src/commands.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `apps/api/src/migration.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `apps/api/src/restaurantOrderContracts.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `apps/api/src/restaurantOrders.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `apps/api/test/api-messages.test.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `apps/api/test/restaurant-order-contracts.test.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `apps/api/test/restaurant-orders-upgrade.integration.test.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `apps/api/test/restaurant-orders.integration.test.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `e2e/restaurant-orders.spec.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `src/app/commandRecoveryRouting.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `src/components/service/BackendRestaurantOrdersWorkspace.tsx` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `src/components/service/RestaurantStationTicketsWorkspace.tsx` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `src/components/service/RestaurantTicketCards.tsx` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `src/services/apiClient.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `src/services/apiMessages.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 |  M | `src/types/restaurantOrders.ts` | CONTENT DIFFERS |
| codex/restaurant-ticket-handoff-v1 | ?? | `apps/api/migrations/035_restaurant_ticket_handoff.sql` | NEW PATH |
| feat/catalog-maintenance |  M | `apps/api/src/app.ts` | CONTENT DIFFERS |
| feat/catalog-maintenance |  M | `apps/api/src/commandAuthorization.ts` | CONTENT DIFFERS |
| feat/catalog-maintenance |  M | `apps/api/src/commands.ts` | CONTENT DIFFERS |
| feat/catalog-maintenance |  M | `e2e/workspace-recovery-readiness.spec.ts` | CONTENT DIFFERS |
| feat/catalog-maintenance |  M | `src/components/inventory/BackendInventoryWorkspace.tsx` | CONTENT DIFFERS |
| feat/catalog-maintenance |  M | `src/services/apiClient.ts` | CONTENT DIFFERS |
| feat/catalog-maintenance | ?? | `apps/api/src/catalogMaintenance.ts` | CONTENT DIFFERS |
| feat/catalog-maintenance | ?? | `apps/api/test/catalog-maintenance.integration.test.ts` | CONTENT DIFFERS |
| feat/catalog-maintenance | ?? | `docs/44-CATALOG-MAINTENANCE.md` | NEW PATH |
| feat/catalog-maintenance | ?? | `e2e/integration/catalog-maintenance.spec.ts` | CONTENT DIFFERS |
| feat/catalog-maintenance | ?? | `playwright.catalog-local.config.ts` | NEW PATH |
| feat/catalog-maintenance | ?? | `src/components/inventory/CatalogItemEditor.tsx` | NEW PATH |
| feat/codebase-truth-count-recovery |  M | `.gitattributes` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/src/app.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/src/commandCatalogue.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/src/commands.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/src/contractValidation.ts` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `apps/api/src/migration.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/src/publicInputs.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/api-messages.test.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/catalog-maintenance-upgrade.integration.test.ts` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/command-catalogue.test.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/command-recovery.integration.test.ts` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/configuration.integration.test.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/item-kinds-upgrade.integration.test.ts` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/postgres.integration.test.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/product-import-security.integration.test.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/product-import-upgrade.integration.test.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `apps/api/test/public-inputs.test.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `docs/48-CODEBASE-TRUTH-EXECUTION.md` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `docs/56-ITEM-KINDS-SERVICE-SALES.md` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `e2e/catalog-item-kinds.spec.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `e2e/catalog-recovery-response.spec.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `e2e/configuration.spec.ts` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `e2e/integration/service-sales.spec.ts` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `index.html` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `playwright.integration.config.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `src/components/common/ResponsiveDialog.tsx` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `src/components/inventory/BackendStockCountWorkspace.tsx` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `src/components/manage/BackendManageWorkspace.tsx` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `src/components/sales/BackendSalesHistoryWorkspace.tsx` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `src/index.css` | SAME CONTENT |
| feat/codebase-truth-count-recovery |  M | `src/services/apiClient.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `src/services/apiMessages.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `src/services/hardware.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery |  M | `src/utils/presentation.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery | ?? | `apps/api/migrations/026_count_recovery.sql` | SAME CONTENT |
| feat/codebase-truth-count-recovery | ?? | `apps/api/src/countRecovery.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery | ?? | `apps/api/test/contract-arrays.test.ts` | SAME CONTENT |
| feat/codebase-truth-count-recovery | ?? | `apps/api/test/count-recovery-upgrade.integration.test.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery | ?? | `apps/api/test/count-recovery-validation.test.ts` | SAME CONTENT |
| feat/codebase-truth-count-recovery | ?? | `apps/api/test/count-recovery.integration.test.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery | ?? | `docs/57-COUNT-RECOVERY.md` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery | ?? | `e2e/count-changes-review.spec.ts` | SAME CONTENT |
| feat/codebase-truth-count-recovery | ?? | `e2e/integration/count-changes-review.spec.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery | ?? | `src/components/inventory/CountChangesReviewDialog.tsx` | SAME CONTENT |
| feat/codebase-truth-count-recovery | ?? | `src/components/inventory/CountEvidenceHistory.tsx` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery | ?? | `src/types/countRecovery.ts` | CONTENT DIFFERS |
| feat/codebase-truth-count-recovery | ?? | `src/utils/countRecovery.ts` | CONTENT DIFFERS |
| fix/credential-operation-fencing |  M | `apps/api/src/app.ts` | CONTENT DIFFERS |
| fix/credential-operation-fencing |  M | `apps/api/src/credentials.ts` | CONTENT DIFFERS |
| fix/credential-operation-fencing |  M | `apps/api/src/migration.ts` | CONTENT DIFFERS |
| fix/credential-operation-fencing |  M | `apps/api/test/product-import-upgrade.integration.test.ts` | CONTENT DIFFERS |
| fix/credential-operation-fencing |  M | `e2e/account-access.spec.ts` | CONTENT DIFFERS |
| fix/credential-operation-fencing |  M | `src/components/auth/PasswordOperationPanel.tsx` | CONTENT DIFFERS |
| fix/credential-operation-fencing |  M | `src/services/apiClient.ts` | CONTENT DIFFERS |
| fix/credential-operation-fencing |  M | `src/services/secretOperationJournal.ts` | CONTENT DIFFERS |
| fix/credential-operation-fencing | ?? | `apps/api/migrations/017_credential_operation_fences.sql` | NEW PATH |
| fix/credential-operation-fencing | ?? | `apps/api/test/credential-fencing-upgrade.integration.test.ts` | NEW PATH |
| fix/credential-operation-fencing | ?? | `apps/api/test/credential-fencing.integration.test.ts` | CONTENT DIFFERS |
| fix/credential-operation-fencing | ?? | `docs/45-CREDENTIAL-OPERATION-FENCING.md` | NEW PATH |
| fix/credential-operation-fencing | ?? | `e2e/integration/credential-fencing.spec.ts` | NEW PATH |
| fix/credential-operation-fencing | ?? | `playwright.credential-fence.local.config.ts` | NEW PATH |
| fix/credential-operation-fencing | ?? | `playwright.credential-mock.local.config.ts` | NEW PATH |
| fix/access-recovery-routing |  M | `src/components/layout/AppShell.tsx` | CONTENT DIFFERS |
| fix/access-recovery-routing |  M | `src/components/manage/BackendManageWorkspace.tsx` | CONTENT DIFFERS |
| fix/access-recovery-routing |  M | `src/components/manage/StaffAccessWorkspace.tsx` | CONTENT DIFFERS |
| fix/access-recovery-routing |  M | `src/components/manage/identityUi.tsx` | CONTENT DIFFERS |
| fix/access-recovery-routing | ?? | `docs/43-ACCESS-RECOVERY-ROUTING.md` | CONTENT DIFFERS |
| fix/access-recovery-routing | ?? | `e2e/recovery-routing.spec.ts` | CONTENT DIFFERS |
| fix/access-recovery-routing | ?? | `playwright.recovery-routing.local.config.ts` | NEW PATH |
| fix/access-recovery-routing | ?? | `src/app/CommandRecoveryNavigation.tsx` | SAME CONTENT |
| fix/access-recovery-routing | ?? | `src/app/commandRecoveryRouting.ts` | CONTENT DIFFERS |
