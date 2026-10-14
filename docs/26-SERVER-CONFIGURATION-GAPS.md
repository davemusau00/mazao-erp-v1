# Server configuration gaps — 14 October 2026

## Investigation target

Checked the live pilot at https://mazao.davemusau.co.ke, release 15aaa9b64690e28d48e32db7ca3290434a61f5a2, against navigation, API routes/commands, migrations, preview settings screens and v1 requirements. The owner's screenshot confirms an authenticated administrator workspace. The live database contains one outlet, one administrator and one assigned device. Enabled tenant capabilities are commerce, inventory and retail.

## Why Manage was missing in release 15aaa9b

This is an implementation gap. AppShell's server navigation explicitly sets manage=false and onboarding=false. App.tsx also renders ManageWorkspace and OnboardingWorkspace only without a backend session. The preview Manage screen reads browser storage and contains local profiles/drafts or static information. Even its business section does not save profile or tax changes.

The API has no administration/configuration query or command handlers. Its permission list has no configuration, staff-administration or device-administration permissions. Revealing the preview screen would expose local records rather than the current server business and would not save configuration to PostgreSQL.

## Missing surface area

| Area | Server implementation | Missing from the deployed product |
| --- | --- | --- |
| Business and outlets | Bootstrap creates name, currency, time zones and initial outlet; session returns some of these fields | View/edit configuration, legal/contact/address fields, branding, additional outlets and outlet switching |
| Taxes, receipts and payments | Per-item/per-room tax rates; cash and customer-account checkout; confirmed receipt snapshots | Business tax policy, receipt legal/contact/footer/branding settings and payment-method configuration; provider and mixed tenders remain unsupported |
| Staff and permissions | Users, memberships, coarse role permissions and assigned devices | Invite/create/update/deactivate staff, role/outlet assignment, password recovery, custom permissions and session administration |
| Devices and printing | Initial device assignment and browser receipt printing/download | Enrollment, pairing, revocation, printer profiles and verified hardware output; multiple active assignments currently make login ambiguous |
| Module configuration | Tenant capability rows created by bootstrap | Audited application-level capability changes and operational configuration/readiness checks |
| Inventory setup/import | Add item, receiving and full outlet counts | Edit/archive items, barcodes/packages, CSV/XLSX import, physical locations, transfers and server manual adjustments |
| Hotel and restaurant | Hotel room/reservation/stay/cash-checkout/housekeeping foundation behind hospitality capability | Hotel is disabled for this tenant; restaurant tables, kitchen and bar tickets have no server implementation and are always hidden |
| Finance administration | Posted-journal trial balance, partial operating report, receivables and shift closing | Chart-of-accounts configuration, period controls, expense/AP policies, complete statements and source reconciliation |
| First-use setup | Initial tenant/operator/device CLI bootstrap | Persistent server setup checklist, imports, staff/device provisioning and validated go-live state |

The current administrator can already use Stock → Add item and Stock → Receive stock. Those create server records. They do not replace business administration or advanced inventory configuration.

## Original implementation order

1. Build a server Manage workspace for owner/admin business and current-outlet settings, with a configuration read endpoint, versioned/audited/idempotent update commands, migration and authoritative form outcomes. Return tenant and outlet time zones explicitly. Preserve posted financial history and receipt snapshots when configuration changes.
2. Add staff/device administration with server permissions, assignments, revocation and local password entry. Resolve the login requirement of exactly one active device/outlet assignment before allowing multiple assignments or outlet switching.
3. Add supported tax, receipt and tender-policy settings with domain validation and snapshots. Show only payment/hardware methods that actually work. Add a persistent setup checklist based on verified configuration.
4. Add staged inventory import/editing/packages and capability administration as separately accepted slices. Enable hotel through a reviewed tenant change; implement restaurant services before exposing restaurant navigation.

Each slice needs tenant isolation, role checks, version conflicts, exact command replay, validation, unknown-save recovery and reload persistence. This investigation did not change tenant capabilities, permissions, currency, tax or business records.

## Configuration slice resolution

The new configuration slice implements item 1 and supported capability/tax/receipt settings from items 3-4. Manage now reads PostgreSQL business/outlet profiles and sends versioned, audited, idempotent commands. It includes computed setup checks and preserves existing receipt/tax snapshots. The server rechecks capabilities for reads/mutations; the browser has no reachable preview workflows or seeded storage initialization.

See [configuration integration and acceptance](28-BUSINESS-CONFIGURATION-INTEGRATION.md) and the [complete remaining v1 register](27-V1-COMPLETION-REGISTER.md). Staff/device administration, extra outlets, tender policies, imports and restaurant operations are still missing. The deployment evidence records the exact activated release; this dated investigation remains a record of the original defect.
