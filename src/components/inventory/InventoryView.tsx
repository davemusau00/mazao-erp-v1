import { BackendInventoryWorkspace } from './BackendInventoryWorkspace';

export function InventoryView({ onOpenReceiving, onOpenStockExceptions, initialView, onInitialViewConsumed }: { onOpenReceiving: () => void; onOpenStockExceptions: () => void; initialView?: 'inventory'|'import'; onInitialViewConsumed?: () => void }) {
  return <BackendInventoryWorkspace onOpenReceiving={onOpenReceiving} onOpenStockExceptions={onOpenStockExceptions} initialView={initialView} onInitialViewConsumed={onInitialViewConsumed} />;
}
