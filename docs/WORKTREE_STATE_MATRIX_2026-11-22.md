# Worktree state matrix

Captured on 23 November 2026 after assembling this report package and before its report-only commit. Counts are path-level `git status --short --untracked-files=all`; all pre-existing dirty paths were preserved. There are 31 registered worktrees, 10 dirty. Review worktrees include the audit, deployment-doc, and PR #34 print-size candidate, now published as Draft PR #35; no additional worktree was created.

| Worktree path | Branch | HEAD | Tracked dirty paths | Untracked paths |
| --- | --- | --- | ---: | ---: |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp` | feat/hospitality-orders-fire | `3adc220d4fb8c00c273c6c0ae1e6cfd9e7ed58ba` | 13 | 4 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/access-recovery-navigation` | codex/access-recovery-navigation | `a0928f2e5a7ff000634e9c8c081471d0cfa415fe` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/branch-consolidation-review` | review/branch-consolidation-2026-11-22 | `23cc0001d3d14607b2427e61126133bdaa30b359` | 0 | 7 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/credential-recovery` | codex/credential-recovery | `d88b5805f3a09fc86dccd9e71620b46d93b1f7d9` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/deployment-baseline-mainline` | review/deployment-baseline-mainline-2026-11-22 | `055607f2114b3590289af10e57483bee449c70ce` | 1 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/deployment-baseline-refresh` | review/deployment-baseline-refresh-2026-11-22 | `812d1a9e70f8fa1133a51b3b17c207ba1f6aa258` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/guest-registration` | feat/guest-registration | `0de9799aef2486547ed54b3d3a78b0475b11c231` | 30 | 15 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/guest-registration-clean` | codex/guest-registration | `901f84a24f79bbf4450fea13495abb3446cecb56` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/guest-registration-port` | detached | `6436e256728c4bfe1d546c7627f3490a9fa0c1aa` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/hospitality-kds-lifecycle` | feat/hospitality-kds-lifecycle | `5138f118253eb5ac2e70fd1416ef9bc59189154c` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/live-deployment-baseline` | docs/live-deployment-baseline | `1477f818e7b6847add67dd5115788b8139253766` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/mazaoyako-deployment` | deploy/mazaoyako-config | `34298383338df70a8551e8cf4ac91a285438b612` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/pr24-final-review` | codex/pr24-review-cleanup | `ae7109912d36130453782fd72bae1be19c31c97b` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/pr26-repair` | codex/pr26-repair | `01c3566b23ffdc24633e6c8c58826e7bd84afb1b` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/pr34-print-page-size-review` | review/pr34-print-page-size-2026-11-22 | `c6c09f4996d087850c29d8eef0a3f230a1668eda` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/product-import-queue-archive` | feat/product-import-queue-archive | `4d9e446f02fcb50ffc415fe723ae9f315dd0aaa0` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/product-import-resume` | fix/product-import-resume | `0de9799aef2486547ed54b3d3a78b0475b11c231` | 1 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/product-import-resume-clean` | codex/product-import-resume | `7bc5c680170ad7e20e439e04cfd98ebb76391fa2` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/restaurant-print-queue` | feat/restaurant-print-queue | `5138f118253eb5ac2e70fd1416ef9bc59189154c` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/restaurant-print-queue-v1` | codex/restaurant-print-queue | `520deb334411c56c3086ada20d82ffaf7905f98a` | 0 | 0 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/restaurant-ticket-handoff-v1` | codex/restaurant-ticket-handoff-v1 | `520deb334411c56c3086ada20d82ffaf7905f98a` | 17 | 1 |
| `C:/Users/Admin/AppData/Local/Mazao/Worktrees/saas-offline-roadmap` | docs/saas-offline-roadmap | `c137b63302b686518e23cfbf33b8f5e25321e84f` | 0 | 0 |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-account-hardening` | fix/staff-name-evidence | `adde772d592373d513da4de3d965f20a5c00bb1f` | 0 | 0 |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-catalog-maintenance` | feat/catalog-maintenance | `9a4bf8cbca35550f1cf16380f60fd9cbdaa2d9a3` | 6 | 6 |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-count-recovery` | feat/codebase-truth-count-recovery | `f36509061cf0f8a69319b11dea6a5ae920dd4a06` | 34 | 13 |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-csv-import` | fix/catalog-scan-identities | `df1007d9682eed211f7faf4cd71d6fcd54e4f869` | 0 | 0 |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-hotel-dates` | fix/hotel-calendar-dates | `69cbd213069c9d012ca1204bfa39f690a47406f6` | 0 | 0 |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-login-hardening` | fix/credential-operation-fencing | `d46c53451016df21c207293a14c552952a0491d8` | 8 | 7 |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-stock-count` | fix/access-recovery-routing | `264200fa978c7aa8f61e6bd7ee6ab54696ecea4a` | 4 | 5 |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-stock-exceptions` | feat/confirmed-stock-exception-sales | `7373a7464812fabae6bf65d8cfa36cae9091f87d` | 0 | 0 |
| `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-test-isolation` | fix/api-test-isolation | `a883e5a1d649a552e73a4fa6e07d7102fbf44ae6` | 0 | 0 |

## Dirty path inventory

### feat/hospitality-orders-fire - 13 tracked, 4 untracked

Path: `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp`

```
M apps/api/src/app.ts
 M apps/api/src/commandCatalogue.ts
 M apps/api/src/commands.ts
 M apps/api/src/migration.ts
 M apps/api/src/productImport.ts
 M apps/api/test/command-catalogue.test.ts
 M apps/api/test/product-import-security.integration.test.ts
 M apps/api/test/product-import-upgrade.integration.test.ts
 M docs/56-ITEM-KINDS-SERVICE-SALES.md
 M e2e/integration/product-import.spec.ts
 M src/components/inventory/ProductCsvImportWorkspace.tsx
 M src/services/apiClient.ts
 M src/types/history.ts
?? MAZAO_ERP_P0-P4_MASTER_DEVELOPMENT_INSTRUCTION_2026-10-29.md
?? apps/api/migrations/031_product_import_queue_archive.sql
?? docs/GUEST-REGISTRATION-AND-CHECK-IN-PLAN.md
?? docs/MAZAO_ERP_FULL_FUNCTIONALITY_SAAS_OFFLINE_MASTER_PLAN_2026-11-08.md
```

### review/branch-consolidation-2026-11-22 - 0 tracked, 7 untracked

Path: `C:/Users/Admin/AppData/Local/Mazao/Worktrees/branch-consolidation-review`

```
?? docs/BRANCH_CLEANUP_PROPOSAL_2026-11-22.md
?? docs/BRANCH_CONSOLIDATION_AUDIT_2026-11-22.md
?? docs/BRANCH_REF_MATRIX_2026-11-22.md
?? docs/BRANCH_UNIQUE_CHANGE_INVENTORY_2026-11-22.md
?? docs/DIRTY_OVERLAY_CONTENT_MATRIX_2026-11-22.md
?? docs/WORKTREE_STATE_MATRIX_2026-11-22.md
?? docs/BRANCH_REF_MATRIX_2026-11-22.zip
```

### review/deployment-baseline-mainline-2026-11-22 - 1 tracked, 0 untracked

Path: `C:/Users/Admin/AppData/Local/Mazao/Worktrees/deployment-baseline-mainline`

```
M docs/MAZAO_ERP_FULL_FUNCTIONALITY_SAAS_OFFLINE_MASTER_PLAN_2026-11-08.md
```

### feat/guest-registration - 30 tracked, 15 untracked

Path: `C:/Users/Admin/AppData/Local/Mazao/Worktrees/guest-registration`

```
M .env.example
 M .github/workflows/ci.yml
 M README.md
 M apps/api/src/app.ts
 M apps/api/src/commandCatalogue.ts
 M apps/api/src/commands.ts
 M apps/api/src/contracts.ts
 M apps/api/src/hospitalityDirectory.ts
 M apps/api/src/migration.ts
 M apps/api/src/publicInputs.ts
 M apps/api/test/hotel-calendar.integration.test.ts
 M apps/api/test/postgres.integration.test.ts
 M apps/api/test/public-inputs.test.ts
 M docs/08-AUTH-SECURITY.md
 M docs/11-HOSPITALITY.md
 M docs/24-BACKEND-INTEGRATION.md
 M docs/27-V1-COMPLETION-REGISTER.md
 M e2e/integration/hotel-calendar.spec.ts
 M e2e/workspace-recovery-readiness.spec.ts
 M infra/docker-compose.example.yml
 M infra/mazaoyako/.env.example
 M infra/mazaoyako/README.md
 M infra/mazaoyako/compose.yml
 M infra/mazaoyako/prepare-host.sh
 M playwright.browser-matrix.config.ts
 M playwright.integration.config.ts
 M src/components/hospitality/BackendHotelWorkspace.tsx
 M src/components/layout/AppShell.tsx
 M src/services/apiClient.ts
 M src/services/apiMessages.ts
?? apps/api/migrations/030_guest_registration.sql
?? apps/api/src/guestRegistration.ts
?? apps/api/src/guestRegistrationContracts.ts
?? apps/api/src/guestRegistrationTypes.ts
?? apps/api/test/guest-registration-upgrade.integration.test.ts
?? apps/api/test/guest-registration.integration.test.ts
?? apps/api/test/support/guest-registration-fixture.ts
?? docs/GUEST-REGISTRATION-AND-CHECK-IN-PLAN.md
?? docs/GUEST-REGISTRATION-IMPLEMENTATION.md
?? e2e/hotel-guest-registration.spec.ts
?? e2e/integration/guest-registration.spec.ts
?? src/components/hospitality/GuestRegistrationDialog.tsx
?? src/components/hospitality/GuestRegistrationFields.tsx
?? src/components/hospitality/HotelRegistrationSettings.tsx
?? src/services/guestRegistrationJournal.ts
```

### fix/product-import-resume - 1 tracked, 0 untracked

Path: `C:/Users/Admin/AppData/Local/Mazao/Worktrees/product-import-resume`

```
M src/components/inventory/ProductCsvImportWorkspace.tsx
```

### codex/restaurant-ticket-handoff-v1 - 17 tracked, 1 untracked

Path: `C:/Users/Admin/AppData/Local/Mazao/Worktrees/restaurant-ticket-handoff-v1`

```
M apps/api/src/commandCatalogue.ts
 M apps/api/src/commands.ts
 M apps/api/src/migration.ts
 M apps/api/src/restaurantOrderContracts.ts
 M apps/api/src/restaurantOrders.ts
 M apps/api/test/api-messages.test.ts
 M apps/api/test/restaurant-order-contracts.test.ts
 M apps/api/test/restaurant-orders-upgrade.integration.test.ts
 M apps/api/test/restaurant-orders.integration.test.ts
 M e2e/restaurant-orders.spec.ts
 M src/app/commandRecoveryRouting.ts
 M src/components/service/BackendRestaurantOrdersWorkspace.tsx
 M src/components/service/RestaurantStationTicketsWorkspace.tsx
 M src/components/service/RestaurantTicketCards.tsx
 M src/services/apiClient.ts
 M src/services/apiMessages.ts
 M src/types/restaurantOrders.ts
?? apps/api/migrations/035_restaurant_ticket_handoff.sql
```

### feat/catalog-maintenance - 6 tracked, 6 untracked

Path: `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-catalog-maintenance`

```
M apps/api/src/app.ts
 M apps/api/src/commandAuthorization.ts
 M apps/api/src/commands.ts
 M e2e/workspace-recovery-readiness.spec.ts
 M src/components/inventory/BackendInventoryWorkspace.tsx
 M src/services/apiClient.ts
?? apps/api/src/catalogMaintenance.ts
?? apps/api/test/catalog-maintenance.integration.test.ts
?? docs/44-CATALOG-MAINTENANCE.md
?? e2e/integration/catalog-maintenance.spec.ts
?? playwright.catalog-local.config.ts
?? src/components/inventory/CatalogItemEditor.tsx
```

### feat/codebase-truth-count-recovery - 34 tracked, 13 untracked

Path: `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-count-recovery`

```
M .gitattributes
 M apps/api/src/app.ts
 M apps/api/src/commandCatalogue.ts
 M apps/api/src/commands.ts
 M apps/api/src/contractValidation.ts
 M apps/api/src/migration.ts
 M apps/api/src/publicInputs.ts
 M apps/api/test/api-messages.test.ts
 M apps/api/test/catalog-maintenance-upgrade.integration.test.ts
 M apps/api/test/command-catalogue.test.ts
 M apps/api/test/command-recovery.integration.test.ts
 M apps/api/test/configuration.integration.test.ts
 M apps/api/test/item-kinds-upgrade.integration.test.ts
 M apps/api/test/postgres.integration.test.ts
 M apps/api/test/product-import-security.integration.test.ts
 M apps/api/test/product-import-upgrade.integration.test.ts
 M apps/api/test/public-inputs.test.ts
 M docs/48-CODEBASE-TRUTH-EXECUTION.md
 M docs/56-ITEM-KINDS-SERVICE-SALES.md
 M e2e/catalog-item-kinds.spec.ts
 M e2e/catalog-recovery-response.spec.ts
 M e2e/configuration.spec.ts
 M e2e/integration/service-sales.spec.ts
 M index.html
 M playwright.integration.config.ts
 M src/components/common/ResponsiveDialog.tsx
 M src/components/inventory/BackendStockCountWorkspace.tsx
 M src/components/manage/BackendManageWorkspace.tsx
 M src/components/sales/BackendSalesHistoryWorkspace.tsx
 M src/index.css
 M src/services/apiClient.ts
 M src/services/apiMessages.ts
 M src/services/hardware.ts
 M src/utils/presentation.ts
?? apps/api/migrations/026_count_recovery.sql
?? apps/api/src/countRecovery.ts
?? apps/api/test/contract-arrays.test.ts
?? apps/api/test/count-recovery-upgrade.integration.test.ts
?? apps/api/test/count-recovery-validation.test.ts
?? apps/api/test/count-recovery.integration.test.ts
?? docs/57-COUNT-RECOVERY.md
?? e2e/count-changes-review.spec.ts
?? e2e/integration/count-changes-review.spec.ts
?? src/components/inventory/CountChangesReviewDialog.tsx
?? src/components/inventory/CountEvidenceHistory.tsx
?? src/types/countRecovery.ts
?? src/utils/countRecovery.ts
```

### fix/credential-operation-fencing - 8 tracked, 7 untracked

Path: `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-login-hardening`

```
M apps/api/src/app.ts
 M apps/api/src/credentials.ts
 M apps/api/src/migration.ts
 M apps/api/test/product-import-upgrade.integration.test.ts
 M e2e/account-access.spec.ts
 M src/components/auth/PasswordOperationPanel.tsx
 M src/services/apiClient.ts
 M src/services/secretOperationJournal.ts
?? apps/api/migrations/017_credential_operation_fences.sql
?? apps/api/test/credential-fencing-upgrade.integration.test.ts
?? apps/api/test/credential-fencing.integration.test.ts
?? docs/45-CREDENTIAL-OPERATION-FENCING.md
?? e2e/integration/credential-fencing.spec.ts
?? playwright.credential-fence.local.config.ts
?? playwright.credential-mock.local.config.ts
```

### fix/access-recovery-routing - 4 tracked, 5 untracked

Path: `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-stock-count`

```
M src/components/layout/AppShell.tsx
 M src/components/manage/BackendManageWorkspace.tsx
 M src/components/manage/StaffAccessWorkspace.tsx
 M src/components/manage/identityUi.tsx
?? docs/43-ACCESS-RECOVERY-ROUTING.md
?? e2e/recovery-routing.spec.ts
?? playwright.recovery-routing.local.config.ts
?? src/app/CommandRecoveryNavigation.tsx
?? src/app/commandRecoveryRouting.ts
```
