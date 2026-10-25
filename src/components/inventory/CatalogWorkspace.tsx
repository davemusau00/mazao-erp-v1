import { useEffect, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { CatalogMaintenanceWorkspace } from './CatalogMaintenanceWorkspace';
import { ProductCsvImportWorkspace } from './ProductCsvImportWorkspace';

/** Catalog access also serves businesses that sell services without inventory. */
export function CatalogWorkspace({ onBack, initialImport = false, onInitialImportConsumed }: { onBack: () => void; initialImport?: boolean; onInitialImportConsumed?: () => void }) {
  const session = apiClient.getSession()!;
  const [importOpen, setImportOpen] = useState(initialImport);
  useEffect(() => { if (initialImport) onInitialImportConsumed?.(); }, []);
  useEffect(() => {
    let mounted = true;
    const inspect = (records: Awaited<ReturnType<typeof apiClient.listRecoverableCommands>>) => {
      if (mounted && records.some(record => record.command.type.startsWith('catalog.import.') && record.command.deviceId === session.deviceId && record.actorId === session.user.id)) setImportOpen(true);
    };
    void apiClient.listRecoverableCommands(session.tenant.id).then(inspect).catch(() => undefined);
    void apiClient.listImportValidationRecovery().then(records => { if (mounted && records.length) setImportOpen(true); }).catch(() => undefined);
    const unsubscribe = apiClient.subscribeRecovery(inspect);
    const unsubscribeValidation = apiClient.subscribeImportRecovery(records => { if (mounted && records.length) setImportOpen(true); });
    return () => { mounted = false; unsubscribe(); unsubscribeValidation(); };
  }, [session.tenant.id, session.user.id, session.deviceId]);
  if (importOpen) return <ProductCsvImportWorkspace onBack={() => setImportOpen(false)} backLabel="Back to items and services" />;
  return <CatalogMaintenanceWorkspace onBack={onBack} backLabel="Back to today" onImport={() => setImportOpen(true)} />;
}
