# First 20 executable engineering tickets

1. Create standalone `mazao-erp` monorepo with pnpm workspaces, TypeScript project references, codeowners, protected branch instructions. Accept: clean install/build/lint.
2. Add PWA app skeleton and basic semantic tokens/typography. Accept: 1024x600/390x844 no clipping.
3. Add Fastify API with versioned `/api/v1`, health/readiness, test harness and OpenAPI generator. Accept: contract test passes.
4. Add PostgreSQL migrations, isolation test DB and migration checksum registry. Accept: fresh + incremental migrate.
5. Introduce core idempotent command envelope, transaction wrapper and status endpoint. Accept: same-ID retry executes once.
6. Create tenant/org/outlet schema and server-derived tenant middleware. Accept: cross-tenant ID attack denied.
7. Implement user identity, session rotation, roles/permissions, device enrollment. Accept: authorization matrix.
8. Add append-only audit and transactional outbox + worker. Accept: at-least-once worker attempts no duplicate domain effect.
9. Build shared AppShell and role-aware navigation; cashier shell first. Accept: complete keyboard path.
10. Implement catalog item/package/variant and stock initialization with single wizard. Accept: 4x6 pack math and atomic stock.
11. Implement stock movement ledger/balances + scoped locks. Accept: race on last unit deterministic.
12. Implement order draft, line snapshot, totals and sales command. Accept: fast local basket feedback + persisted server order.
13. Implement tenders/payment allocations and balanced journal posting. Accept: cash settlement idempotent and accounting balanced.
14. Implement immutable receipt document, preview and browser print 80mm. Accept: thermal layout snapshot.
15. Implement till open/cash-up/close and shift report. Accept: complete first shift acceptance.
16. Implement controlled CSV import mapping/dry-run/apply. Accept: row-level errors and replay-safe import.
17. Implement IndexedDB schema, durable command journal and guarded SW updates. Accept: PWA reopen preserves local draft.
18. Implement signed offline grants + bounded cash and replay. Accept: 100-sales interrupted sync test.
19. Implement print agent skeleton with secure pairing and signed jobs. Accept: spool simulator and unsafe-origin rejection, then physical acceptance separately.
20. Stage deploy, encrypted offsite backups and isolated restore; produce signed/immutable release manifest. Accept: rehearsal can restore and rollback without cross-app disruption.

Each ticket should be refined into child tasks with file paths after scaffold exists. Do not implement every backend service in one giant PR. Tranche 1-8 is platform; 9-16 first usable shift; 17-20 resilience and hardware.
