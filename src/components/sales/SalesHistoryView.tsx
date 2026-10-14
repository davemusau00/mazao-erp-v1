import { BackendSalesHistoryWorkspace } from './BackendSalesHistoryWorkspace';

export function SalesHistoryView({ onReprintOrder }: { onReprintOrder: (orderId: string) => void }) {
  return <BackendSalesHistoryWorkspace onReprintOrder={onReprintOrder} />;
}
