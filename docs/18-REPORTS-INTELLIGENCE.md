# Reporting and decision intelligence

## Design
A report is a versioned, permission-scoped, reproducible calculation with `from/to`, outlet/location scope, accounting policy, data freshness, record coverage and source drilldown. No ungrounded charts or zero values where source missing. Defaults: Today, previous day, seven days, month and custom local business day.

## Dataset catalogue
Sales & tenders; refunds/discounts; cashier shifts and variances; inventory quantity and valuation; purchases/AP; recipes/margins; rooms occupancy/ADR/RevPAR; guest balances; revenue, COGS, operating expenses, P&L, trial balance; exceptions and audits; assets and maintenance. Use materialized projections for performance while allowing transactional control-total reconciliation.

## Architecture
Queries filter `tenant_id`, authorized outlets, half-open UTC interval derived from local business time; server computes totals using integer minor money; currency conversions explicit if later needed. Snapshot historical price/tax/COGS at transaction time. Heavy exports run worker job with signed short-lived access URL and audit.

## Intelligence maturity
Stage 1 rule alerts: stock low, cash shift unclosed, unpaid guest, stale supplier invoice. Stage 2 explainable comparisons with confidence/coverage. Stage 3 advisory AI with source-backed narratives and human approval, never autonomous payment/refund/stock posting. Alert drilldown links to original evidence, not AI hallucinated totals.
