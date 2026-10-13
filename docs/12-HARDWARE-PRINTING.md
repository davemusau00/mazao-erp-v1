# Printing, scanners and hardware

## Modes
1. Universal HTML/CSS print dialog with explicit 80mm print profile and preview. 2. Dedicated kiosk-browser printing for verified controlled hardware. 3. Optional paired local Mazao Print Agent for silent/RAW ESC/POS and local queue recovery. The print agent is not an inventory, order or payment server.

## Print job contract
`jobId`, `tenant`, `device`, `documentId`, immutable document version, printer profile, copy type, content hash, issue time and expiry, signature/auth context. Agent listens on localhost or narrowly scoped TLS LAN endpoint, verifies allowed origin, bound device and job authorization. No arbitrary shell commands or unrestricted RAW byte submission from browser; render validated structured receipt or bounded image asset.

## Print lifecycle
`CREATED → QUEUED → SENDING → SENT_TO_SPOOLER → CONFIRMED_BY_DEVICE (if hardware supports) | DELIVERY_UNCERTAIN | FAILED | CANCELLED`. Spool acceptance is NOT proof of physical paper. On ambiguous interrupted send, require staff acknowledgment before reprint; mark duplicate/copy. Jobs stable ID and de-duplicated when known unsent.

## Receipt content
Merchant/trading details, outlet, operator where allowed, immutable order/receipt reference, timestamp/timezone, rows, quantities, tax and tender breakdown, paid/remaining/change, logo, optional M-Pesa till QR immediately before footer, footer branding, customer/business copy marker. Thermal profile honors printable width and margins; support 58mm and 80mm independently after device acceptance. Logos and customer-provided QR PNGs share bounded image resize/monochrome raster path, but validate scannability before acceptance; never claim QR is verified just because raster generated.

## Peripheral acceptance
USB HID keyboard wedge scanner scan-to-search and count; unknown barcode; repeat burst scans. Ethernet/USB 80mm thermal test on Windows, print queue interruption, driver restart, cutter, partial roll, QR margins; tablet browser print fallback. Cash drawer kick only through explicit authorized command, and only when hardware physically supported.
