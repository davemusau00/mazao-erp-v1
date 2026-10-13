# Tenant onboarding and controlled import

## Intake wizard
Account/business identity → business type/capabilities → outlet(s) → operational locations → taxes/payment methods → branding/receipt assets → staff & devices → product list/stock or manual items → test sale → signed go-live readiness. Save after each step; never require all optional hotel, asset or finance settings for a simple bar.

## Import pipeline
Upload CSV/XLSX within size/row limits → encoding/schema detection → column mapping preview → per-row validation with exact errors → normalization/unit/package interpretations → duplicate detection → dry-run predicted changes → review/approval → chunked idempotent apply → reconciliation and audit. Imported rows retain source hash and import batch reference. Reject duplicate SKU/barcode and invalid tax without corrupting valid rows; support correction and revalidate.

## Example semantics
User imports whisky 750mL as closed/sealed bottles with price/cost: define sealed stock/variant automatically; no requirement to manually link stock master. Packaged soft drinks with 6-pack quantities infer count conversion after explicit confirmation. Opening stock causes opening movement and valuation source; never silently rewrite recorded stock on reimport.

## Ownership and support
Data export in understandable CSV with financial consistency; no hidden lock-in. Admin can rerun dry-run and view differences. Go-live checklist checks printer profile but permits documented manual printing fallback. Staging/demo business may be provisioned independently from real tenant to avoid synthetic paid orders contaminating reports.
