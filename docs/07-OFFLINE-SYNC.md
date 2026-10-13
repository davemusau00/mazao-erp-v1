# Offline-first transactional protocol

## Principle
A cached PWA is not automatically an offline-capable ERP. Offline financial operation requires durable local state, authenticated device identity, bounded rights, replay deduplication, reconciliation, storage resilience and clarity about unsettled provider transactions.

## Local stores
IndexedDB stores tenant-scoped local projections, schema version, sync cursor, immutable local commands, local outcome records, pending print jobs, cash shift/ledger, draft orders, offline capability, projection hashes, device counters and backup-export metadata. IndexedDB version migrations must be atomic, staged and tested across active releases. Service Worker caches app assets, not credentials or privileged API responses indiscriminately.

## Offline grant
Online server issues short-lived signed capability binding tenant, outlet, actor, device public key/fingerprint, permitted command types, maximum aggregate cash exposure, per-operation limits, optional order/stock/room allocations, sequence interval and expiration. Verify signature and expiry locally; server fences revoked grants and validates remaining allocations during replay. Define predictable behavior when a grant expires during outage. Online-only operations include provider-verified settlement, unrestricted supplier payment, broad administrative changes, final period close and any unallocated shared-resource reservation.

## Sale lifecycle
`DRAFT → LOCAL_PREPARED → LOCAL_COMMITTED → PENDING_SYNC → SERVER_CONFIRMED | RECONCILIATION_REQUIRED | REJECTED`. Persist local cash evidence before telling cashier local sale is complete. Receipt marked as locally issued until server confirmation and must retain original ID/reference; reprinted copy marked copy. Failed server replay must not silently erase cash collected.

## Sequence and replay
Per-device monotonic sequence with stable command UUID and append-only record. Replay preserves original ordering where dependent, hashes original payload and sends exact original ID. Server returns stored outcome for duplicates and rejects gaps/sequence conflicts as policy requires. Pull feed updates local projections idempotently and cursor advances only after durable apply. `OUTCOME_UNKNOWN` requests status for original ID, never fabricates retry with new ID.

## Multi-device conflict policy
Online: PostgreSQL grants single authoritative settlement; rooms/stock/till lock. Offline: only allocated/reserved resource rights may finalize local operations that compete globally. For v1 allow cash counter sales subject to availability/limit policy, and drafts for other unsafe operations. Inventory counting may persist offline as evidence but authoritative adjustment waits for server conflict review. No claim that an offline room is exclusively reserved without a lease/allocation. Never manufacture M-Pesa success while offline.

## Browser/device loss
Warn against private browsing, storage cleanup and switching browsers. Request persistence where available, monitor storage quota, export encrypted recovery package containing pending local evidence and projections but not reusable authentication secrets. Do not cache long-lived signing secrets in plain storage. Native print bridge is not a duplicate source of financial authority. Optional device escrow/recovery methods must consider revocation and privacy.

## Acceptance
100 permitted offline cash sales, refresh/restart between arbitrary writes, replay 5 times, mixed success/timeouts, local migration interruption, expired/revoked grant, lost IndexedDB, two devices competing, restored export to different enrolled device (fenced until authorized). No unexplained double payments, no invisible loss of locally collected cash.
