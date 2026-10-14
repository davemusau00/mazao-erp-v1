/**
 * Mazao ERP — Modern Multi-Tenant Business Operating System
 * PWA-First Modular Monolith with Offline Synchronization
 */

import React, { useState, useEffect, useRef } from 'react';
import { storage } from './services/storage';
import { SaleOrder } from './types/erp';
import { AppShell, ActiveTab } from './components/layout/AppShell';
import { DiagnosticsDrawer } from './components/layout/DiagnosticsDrawer';
import { PointOfSaleView } from './components/pos/PointOfSaleView';
import { HospitalityView } from './components/hospitality/HospitalityView';
import { InventoryView } from './components/inventory/InventoryView';
import { ShiftManagerView } from './components/shifts/ShiftManagerView';
import { FinanceWorkspace } from './components/finance/FinanceWorkspace';
import { BackendFinancialReportsWorkspace } from './components/finance/BackendFinancialReportsWorkspace';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { CustomerDirectoryView } from './components/customers/CustomerDirectoryView';
import { ReceiptModal } from './components/hardware/ReceiptModal';
import { BackendReceiptModal } from './components/hardware/BackendReceiptModal';
import { SyncCenterModal } from './components/sync/SyncCenterModal';
import { SalesHistoryView } from './components/sales/SalesHistoryView';
import { TodayWorkspace } from './components/home/TodayWorkspace';
import { ManageWorkspace } from './components/manage/ManageWorkspace';
import { HelpWorkspace } from './components/help/HelpWorkspace';
import { FoodServiceWorkspace } from './components/service/FoodServiceWorkspace';
import { ProcurementWorkspace } from './components/procurement/ProcurementWorkspace';
import { OnboardingWorkspace } from './components/onboarding/OnboardingWorkspace';
import { ReservationWorkspace } from './components/hospitality/ReservationWorkspace';
import { BackendHotelWorkspace } from './components/hospitality/BackendHotelWorkspace';
import { BackendTodayWorkspace } from './components/home/BackendTodayWorkspace';
import { StockCountWorkspace } from './components/inventory/StockCountWorkspace';
import { BackendStockCountWorkspace } from './components/inventory/BackendStockCountWorkspace';
import { apiClient } from './services/apiClient';
import type { BackendSaleReceipt } from './services/apiClient';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('today');
  const [purchaseStartTab, setPurchaseStartTab] = useState<'orders' | 'receive'>('orders');
  const [activeTenant, setActiveTenant] = useState(storage.getActiveTenant());
  const [backendSession, setBackendSession] = useState(apiClient.getSession());
  const [tenants] = useState(storage.getTenants());
  const [, setIsOnline] = useState(storage.isOnline());
  const [, setOutboxCount] = useState(storage.getOutboxCount());

  // Receipt Modal State
  const [completedOrder, setCompletedOrder] = useState<SaleOrder | null>(null);
  const [backendReceipt, setBackendReceipt] = useState<BackendSaleReceipt | null>(null);
  const [backendReceiptLoading, setBackendReceiptLoading] = useState(false);
  const [backendReceiptError, setBackendReceiptError] = useState('');
  const backendReceiptRequest = useRef(0);

  // Sync Center Modal State
  const [isSyncCenterOpen, setIsSyncCenterOpen] = useState(false);

  // Diagnostics Drawer State
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [diagnosticsBarcode, setDiagnosticsBarcode] = useState<string | null>(null);

  // Subscribe to reactive storage changes
  useEffect(() => {
    const unsubscribeBackend = apiClient.subscribe(setBackendSession);
    void apiClient.restore();
    const unsubscribe = storage.subscribe(() => {
      setActiveTenant(storage.getActiveTenant());
      setIsOnline(storage.isOnline());
      setOutboxCount(storage.getOutboxCount());
    });
    return () => {
      unsubscribe();
      unsubscribeBackend();
    };
  }, []);

  const handleTenantChange = (newTenantId: string) => {
    storage.switchTenant(newTenantId);
    setActiveTenant(storage.getActiveTenant());
  };

  const loadBackendReceipt = (orderId: string) => {
    const requestId = ++backendReceiptRequest.current;
    setBackendReceipt(null);
    setBackendReceiptLoading(true);
    setBackendReceiptError('');
    void apiClient.getSaleReceipt(orderId).then(receipt => {
      if (backendReceiptRequest.current === requestId) setBackendReceipt(receipt);
    }).catch(error => {
      if (backendReceiptRequest.current === requestId) setBackendReceiptError(error instanceof Error ? error.message : 'Receipt lookup failed.');
    }).finally(() => {
      if (backendReceiptRequest.current === requestId) setBackendReceiptLoading(false);
    });
  };

  const handleOrderCompleted = (order: SaleOrder) => {
    setCompletedOrder(order);
    if (apiClient.getSession()) loadBackendReceipt(order.id);
    else { ++backendReceiptRequest.current; setBackendReceipt(null); setBackendReceiptLoading(false); setBackendReceiptError(''); }
  };

  const closeReceipt = () => {
    ++backendReceiptRequest.current;
    setCompletedOrder(null);
    setBackendReceipt(null);
    setBackendReceiptLoading(false);
    setBackendReceiptError('');
  };

  const handleBarcodeFromDiagnostics = (barcode: string) => {
    setDiagnosticsBarcode(barcode);
    setActiveTab('sell');
  };

  return (
    <div className="h-dvh w-screen overflow-hidden bg-[#090b10] text-zinc-100 flex flex-col font-sans select-none antialiased">
      <AppShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeTenant={activeTenant}
        tenants={tenants}
        onTenantChange={handleTenantChange}
        onOpenSyncCenter={() => setIsSyncCenterOpen(true)}
        onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
      >
        {activeTab === 'today' && (backendSession
          ? <BackendTodayWorkspace onNavigate={setActiveTab} />
          : <TodayWorkspace tenant={activeTenant} onNavigate={setActiveTab} />)}

        {activeTab === 'sell' && (
          <PointOfSaleView
            tenant={activeTenant}
            onOrderCompleted={handleOrderCompleted}
            scannedBarcodeFromDiagnostics={diagnosticsBarcode}
            onClearScannedBarcode={() => setDiagnosticsBarcode(null)}
          />
        )}

        {activeTab === 'sales' && (
          <SalesHistoryView tenant={activeTenant} onReprintOrder={handleOrderCompleted} />
        )}

        {activeTab === 'service' && <FoodServiceWorkspace />}

        {activeTab === 'hotel' && (backendSession
          ? <BackendHotelWorkspace />
          : <HospitalityView tenant={activeTenant} />)}

        {activeTab === 'reservations' && (backendSession
          ? <BackendHotelWorkspace initialView="reservations" />
          : <ReservationWorkspace tenant={activeTenant} />)}

        {activeTab === 'stock' && (
          <InventoryView tenant={activeTenant} onOpenReceiving={() => { setPurchaseStartTab('receive'); setActiveTab('purchasing'); }} />
        )}

        {activeTab === 'stock-count' && (backendSession ? <BackendStockCountWorkspace /> : <StockCountWorkspace />)}

        {activeTab === 'purchasing' && <ProcurementWorkspace initialTab={purchaseStartTab} onInitialTabConsumed={() => setPurchaseStartTab('orders')} />}

        {activeTab === 'customers' && (
          <CustomerDirectoryView tenant={activeTenant} />
        )}

        {activeTab === 'shifts' && (
          <ShiftManagerView tenant={activeTenant} />
        )}

        {activeTab === 'money' && (
          backendSession
            ? <BackendFinancialReportsWorkspace initialView="trial-balance" />
            : <FinanceWorkspace tenant={activeTenant} />
        )}

        {activeTab === 'reports' && (
          backendSession
            ? <BackendFinancialReportsWorkspace initialView="operating-summary" />
            : <AnalyticsView currentTenant={activeTenant} onOpenSales={() => setActiveTab('sales')} />
        )}

        {activeTab === 'manage' && <ManageWorkspace tenant={activeTenant} onNavigate={setActiveTab} />}

        {activeTab === 'onboarding' && <OnboardingWorkspace tenant={activeTenant} />}

        {activeTab === 'help' && <HelpWorkspace onNavigate={setActiveTab} onOpenSyncCenter={() => setIsSyncCenterOpen(true)} />}
      </AppShell>

      {/* Diagnostics & Simulator Console Drawer */}
      <DiagnosticsDrawer
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        onScanBarcode={handleBarcodeFromDiagnostics}
        onOpenSyncCenter={() => setIsSyncCenterOpen(true)}
      />

      {/* Receipt Preview & ESC/POS Print Modal */}
      {completedOrder && (backendSession
        ? <BackendReceiptModal receipt={backendReceipt} loading={backendReceiptLoading} error={backendReceiptError} onRetry={() => loadBackendReceipt(completedOrder.id)} onClose={closeReceipt} />
        : <ReceiptModal order={completedOrder} tenant={activeTenant} onClose={closeReceipt} />)}

      {/* Outbox Sync Center & Network Simulator Modal */}
      <SyncCenterModal
        isOpen={isSyncCenterOpen}
        onClose={() => setIsSyncCenterOpen(false)}
      />
    </div>
  );
}
