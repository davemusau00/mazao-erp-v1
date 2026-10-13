# Mazao ERP coding-agent instructions

You are implementing a *new* product. Do not import, reference, migrate or depend on SERVEOS repositories, schemas, runtime or secrets. Read `README.md`, `docs/01-PRODUCT-PRD.md`, `docs/03-PLATFORM-ARCHITECTURE.md`, the domain spec and relevant ADR before coding.

## Rules
1. Deliver one end-to-end tested vertical slice per PR, not disconnected UI or empty API stubs.
2. Every command must have canonical input/output schema, RBAC/ABAC, idempotency, atomic transaction, audit, versions, error outcome and tests.
3. No direct API route logic updating finance/stock without domain service and Unit of Work.
4. Money integer minor units and quantities decimal-safe. No floating-point financial arithmetic.
5. Never silently replace financial/stock history; reverse/correct with linked immutable evidence.
6. Never tell an operator "saved" for request with unknown outcome; support status lookup.
7. Offline capability is explicit; default risky new operations ONLINE_ONLY.
8. Frontend task-first; reusable accessible design primitives, resilient 1024x600 and mobile.
9. Update migrations, docs and acceptance tests in same PR. Do not edit applied migrations.
10. No hardcoded tenant IDs, operator secrets, test paid orders or placeholder production data.
11. Do not deploy outside isolated dev/staging without explicit approval and verified rollback/backup.
12. Prefer proven minimal libraries; pin versions after compatibility checks, don't guess latest package versions.

## Agent execution loop
Read context → report targeted files/tests → implement schema/contracts → migration/domain → API → UI → negative cases → acceptance → docs → measured performance → review changed files. Before closing, output verified commands and exact observed results plus remaining gaps. Never claim unavailable physical device tests as passed.

## PR checklist
- [ ] Operator job documented; no unnecessary form steps
- [ ] Contract versioned/generated; schema/validation
- [ ] Tenant and role security checked
- [ ] Domain invariants, concurrency and replay tested
- [ ] Money/stock/audit effects correct
- [ ] Offline mode classified and recovery defined
- [ ] Accessibility and viewport tests passed
- [ ] Trace/monitoring and docs updated
- [ ] Database migration/rollback risk documented
- [ ] CI acceptance evidence from exact commit
