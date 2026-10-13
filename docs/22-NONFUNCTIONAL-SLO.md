# NFRs, service objectives and scale gates

## Proposed budgets, not achieved data
Cashier product-to-basket feedback p95 <= 100 ms on accepted 8GB/Celeron-class terminal; local catalog search <= 75 ms; warm POS load <= 2 sec after cached worker; API standard command server processing p95 <= 300 ms excluding network/provider/worker, with transactional reporting distinct. First use configured outlet to initial sale <= 30 minutes with a clean source data file (research target). Accessibility WCAG 2.2 AA target, verified via automated + manual tests.

## Resilience
Confirmed payment/posted journal/stock movement loss tolerance zero in durability and recovery tests. Crash-consistent local offline journal, monotonic server cursor, no duplicate replay. Production availability 99.9% monthly target after GA. RPO <= 15 min and RTO <= 4h only if backup design and drills prove them.

## Scale stages
Stage A: one tenant, 1-5 devices, 1000 products, ordinary business shift. Stage B: 100 tenants with multiple outlets and devices, cross-tenant isolation stress. Stage C: larger installations/analytics and DB partitioning only after measured need. Load with concurrent checkout/stock/reports and real payment callback burst, monitor p99 and resource use. No untested claims of millions of transactions.

## Operational safety
Structured event auditing, traceability by command ID, tamper-evident export optional, backups and restore evidence. Security baseline aligns with current OWASP guidance after specific version verification. Document storage retention and delete policy respecting applicable Kenyan privacy requirements, assessed by counsel before production.
