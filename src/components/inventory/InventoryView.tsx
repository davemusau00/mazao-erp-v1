import { BackendInventoryWorkspace } from './BackendInventoryWorkspace';

export function InventoryView({ onOpenReceiving, initialView, onInitialViewConsumed }: { onOpenReceiving: () => void; initialView?: 'inventory'|'import'; onInitialViewConsumed?: () => void }) {
  return <BackendInventoryWorkspace onOpenReceiving={onOpenReceiving} initialView={initialView} onInitialViewConsumed={onInitialViewConsumed} />;
}
