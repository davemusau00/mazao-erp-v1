import { BackendInventoryWorkspace } from './BackendInventoryWorkspace';

export function InventoryView({ onOpenReceiving }: { onOpenReceiving: () => void }) {
  return <BackendInventoryWorkspace onOpenReceiving={onOpenReceiving} />;
}
