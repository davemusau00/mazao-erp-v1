# Rooms and guest operations

## Core entities
Room type, room, rate plan with effective dates, reservation, rate quote, guest, stay, guest bill/folio, guest payment/deposit, housekeeping task, room block and maintenance. A stay can have minimal guest identity per local/legal policy; booking website account is never mandatory for walk-in. Room pricing is a server-side snapshot with effective rate, tax policy and duration rules.

## Flows
**Walk-in:** availability → choose room/rate/dates → optional guest details per law/policy → check in atomically → create guest bill → room becomes occupied. **Reservation:** quote availability → hold/reserve with expiry and concurrency → confirm/deposit → no overlapping occupancy. **During stay:** post service/room charge, transfer eligible POS charges once, receive deposit/payment, move room with traceability, extend if available. **Checkout:** show all charges/payments/refunds → settle or record approved remaining balance → close guest bill → mark room dirty/cleaning needed → produce guest statement. **Housekeeping:** dirty→cleaning→inspected→ready; maintenance hold prevents assignment.

## Key invariants
A room cannot be assigned to overlapping active stays; race-safe transaction with exclusion strategy or locks; event boundaries and timezone semantics explicit; a room move changes allocation not historical bill identity; folio reversals link to original entry and do not erase history; deposits vs earned room revenue distinguished; guest bill and journal postings reconcile.

## Dashboard
Arrivals, departures, checked-in guests, available/occupied/dirty/out-of-service, room blocks, unsettled balances and today's occupancy. Managers have rate/room setup; front desk sees operational tasks only.

## Acceptance matrix
Same room race across two devices, cancellation vs check-in race, early/late checkout, day stay, rate-plan validity and tax, move between rooms, multiple payment methods, offline draft while occupancy cannot be safely asserted, refund and reopen policy, room maintenance hold, hotel-only tenant with POS disabled.
