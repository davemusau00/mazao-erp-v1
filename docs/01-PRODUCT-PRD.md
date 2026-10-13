# Product requirements document

## Mission and product promise
Mazao ERP helps businesses operate with less training, fewer mistakes and trustworthy real-time understanding. Its tagline: **Run your business. Not your software.** This is an independent new brand/product, initially optimized for Kenya and East Africa, internationalizable from the start. Core verticals: retail counters, restaurants/cafes, bars/lounges, hotels/guest houses, resorts and mixed sites.

## Product design laws
1. Show actions, not database entities. 2. Advanced controls are progressive, never mandatory for elementary work. 3. No silent double-posting or deceptive success state. 4. Every important total can be traced to source records. 5. Offline is visible and bounded. 6. Physical operator actions should match physical goods. 7. Support actual constrained terminals. 8. Permission-aware, capability-aware navigation. 9. Accessible without assuming perfect literacy or broadband. 10. Immutable business evidence with authorized reversals.

## Personas/jobs to be done
| Persona | Landing tasks | Success criterion |
| --- | --- | --- |
| Cashier | Sell, tabs, pay, reprint, shift | Fast unambiguous checkout, no duplicate tender |
| Waiter | Tables, orders, fire ticket | Correct station receives each order exactly once |
| Cook/Bartender | Tickets, preparation, ready | Clear route, timestamps and modifications |
| Storekeeper | Receive, count, move, waste | Quantities and discrepancies explained |
| Receptionist | Arrivals, availability, checkout | No overlapping room allocations |
| Housekeeper | Clean, inspect, defects | Rooms transition through controlled statuses |
| Accountant | Payments, tills, journals, periods | Balanced books, source traceability |
| Owner | Today, trends, margin, exceptions | Correct figures and timely alerts |
| Administrator | Configure, staff, devices, imports | First-use setup without developer intervention |

## Business capability packs
**Commerce:** catalog, baskets, discounts, taxes, payments, customers, credit, returns, receipt. **Food service:** tables, tabs, modifiers, tickets, recipes, routing, kitchen. **Inventory:** units/packages, locations, movements, sealed/open containers, physical counts. **Purchasing:** suppliers, PO, deliveries, invoices, payable, asset acquisition. **Hospitality:** rooms, availability, reservations, stay, folio, deposits, services, housekeeping. **Finance:** journals, chart of accounts, expenses, closing, reconciliation, P&L. **Operations:** staff, shifts, assets, maintenance, audit, reports, exports. Advanced capabilities hidden when disabled.

## In-scope v1 / deliberately deferred
**v1:** one tenant can have several outlets, roles/devices; online POS, confirmed/manual M-Pesa, cash, receipts, product import, stock movements, purchasing essentials, room walk-ins/reservations, guest billing, shift cash-up, basic accurate finance and operator-specific reporting, offline cash with safe capability model where accepted. **Later:** automated M-Pesa integrations, eTIMS integrations subject to verification, loyalty, public booking engine, advanced payroll, native apps, AI insights, reseller billing, sophisticated revenue management. All future modules must fit existing core boundaries without expanding the v1 release gate.

## Workflow-level acceptance
- Fresh tenant: admin account → business/outlet → settings → stock items/import → staff/permissions → test sale → opening shift → go live.
- Counter: select item → total → tender → confirmed receipt; refresh/retry cannot make a second payment.
- Restaurant: table → order → fire items → station ticket → complete → split or settle; stock and accounts post only at documented event boundaries.
- Stock: receive 4 six-packs → 24 cans counted; scan barcode → stock count draft survives reboot → signed variance posting.
- Hotel: walk-in → room occupancy locks → add food to room → partial payment → checkout reconciles guest balance → room enters cleaning queue.
- Finance: money movement balances, period report shows completeness/freshness, drill-through source.
- Offline: valid pre-issued grant and device persistence allow allowed local cash operations; reconnection replays original IDs, never duplicate.

## Business success metrics
Time-to-first-sale, new staff time-to-first-completed checkout, sale tap latency p95, count completion time, payment recovery success, closing discrepancy rate, daily support requests per outlet, offline replay duplicate count (target zero), tenant provisioning time, restore rehearsal success. Instrument without leaking cardholder or sensitive personal data.
