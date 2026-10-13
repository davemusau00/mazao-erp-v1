# UX, UI and interaction specification

## Information architecture
Top-level actions by context: **Today**, **Sell**, **Stock**, **Hotel** (only enabled), **Money**, **Manage**, **Help**. Avoid cross-domain maze. Context menu changes for cashier, waiter, kitchen, storekeeper, receptionist, housekeeper, finance, manager, owner and admin. Roles enforce server permissions; frontend hiding is only visual, not security.

## Layouts
POS terminal 1024x600 / 1280x720: search + category/product grid + pinned basket + pinned payment CTA, keyboard shortcuts and scanner focus. Tablet landscape 1280x800; portrait 800x1280; management 1366x768 and 1920x1080; phone 390x844 with stack/navigation. Zero horizontal clipping on primary tasks. Keep primary action visible on small heights. Respect reduced motion and high contrast.

## Visual direction
Use the selected OLED dark direction across the product: near-black application shell, elevated slate surfaces, clear blue actions, and emerald success states. Keep semantic surface/text/border/accent/warning/success/danger tokens so contrast and future themes remain centrally managed. High-legibility typography, 8pt spacing rhythm, minimum 44px touch targets where appropriate, clear visual state. Spacing tokens 4/8/12/16/24/32; radii 6/10/16; elevations minimal. No meaning is conveyed by color alone. Validate contrast in default and high-contrast modes.

## Shared component catalogue
AppShell, WorkspaceNav, QuickAction, SearchCommand, ProductTile, BasketLine, PaymentSheet, MoneyInput, DataTable, FilterBar, SummaryMetric, ChartWithDrilldown, SmartItemWizard, PackagingEditor, StockCountSession, ApprovalSheet, PermissionGate, StatusNotice, ErrorRecoveryPanel, OnlineStatus, ConfirmDialog, UnsavedChangesGuard, EmptyState, Skeleton, PrintPreview, ImportColumnMapper, ConflictDiff, HelpDrawer. Storybook or equivalent documented visual catalog and semantic tests for each component.

## Critical interaction states
`IDLE → EDITING → VALIDATING → SENDING → CONFIRMED | REJECTED | OUTCOME_UNKNOWN | LOCAL_ONLY | CONFLICT`. Unknown outcomes never clear the form or create a new command ID. Recovery dialog supports `Check status`, `Review activity`, `Edit after explicit rejection`; not an unreachable button behind the overlay. Offline states distinguish **Saved draft**, **Locally committed**, **Pending sync**, **Server confirmed**.

## Microcopy and terminology
Prefer Item (not stock master), Count stock (not inventory.countLocation), Guest bill (not folio in basic UX), Receive delivery (not GRN as only action), Checking save status (not OUTCOME_UNKNOWN), This changed on another device (not conflict 409). Use Kiswahili localization later via i18n catalog; do not embed copy into domain logic.

## Task-oriented walkthroughs
Contextual help answers "I want to sell", "How to add a product", "Why is payment pending?". First-use walkthroughs do not block action. For risky actions, explain consequence in plain language and require authorization when configured.

## Research and sign-off
Prototype with at least cashier, storekeeper, receptionist, owner. For every critical journey measure screens, taps, mistaken paths, recovery clarity and elapsed task time. Use a11y automated + manual screen reader, keyboard and touch tests. Visual snapshot across required viewport matrix.
