/**
 * Mazao ERP — Modern Multi-Tenant Business Operating System
 * PWA-First Modular Monolith with Offline Synchronization
 */

import React, { useState, useEffect } from 'react';
import { storage } from './services/storage';
import { SaleOrder } from './types/erp';
import { AppShell, ActiveTab } from './components/layout/AppShell';
import { DiagnosticsDrawer } from './components/layout/DiagnosticsDrawer';
import { PointOfSaleView } from './components/pos/PointOfSaleView';
import { HospitalityView } from './components/hospitality/HospitalityView';
import { InventoryView } from './components/inventory/InventoryView';
import { ShiftManagerView } from './components/shifts/ShiftManagerView';
import { FinanceWorkspace } from './components/finance/FinanceWorkspace';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { CustomerDirectoryView } from './components/customers/CustomerDirectoryView';
import { ReceiptModal } from './components/hardware/ReceiptModal';
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
import { apiClient } from './services/apiClient';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('today');
  const [activeTenant, setActiveTenant] = useState(storage.getActiveTenant());
  const [backendSession, setBackendSession] = useState(apiClient.getSession());
  const [tenants] = useState(storage.getTenants());
  const [, setIsOnline] = useState(storage.isOnline());
  const [, setOutboxCount] = useState(storage.getOutboxCount());

  // Receipt Modal State
  const [completedOrder, setCompletedOrder] = useState<SaleOrder | null>(null);

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

  const handleOrderCompleted = (order: SaleOrder) => {
    setCompletedOrder(order);
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
          <InventoryView tenant={activeTenant} />
        )}

        {activeTab === 'stock-count' && <StockCountWorkspace />}

        {activeTab === 'purchasing' && <ProcurementWorkspace />}

        {activeTab === 'customers' && (
          <CustomerDirectoryView tenant={activeTenant} />
        )}

        {activeTab === 'shifts' && (
          <ShiftManagerView tenant={activeTenant} />
        )}

        {activeTab === 'money' && (
          <FinanceWorkspace tenant={activeTenant} />
        )}

        {activeTab === 'reports' && (
          <AnalyticsView currentTenant={activeTenant} onOpenSales={() => setActiveTab('sales')} />
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
      <ReceiptModal
        order={completedOrder}
        tenant={activeTenant}
        onClose={() => setCompletedOrder(null)}
      />

      {/* Outbox Sync Center & Network Simulator Modal */}
      <SyncCenterModal
        isOpen={isSyncCenterOpen}
        onClose={() => setIsSyncCenterOpen(false)}
      />
    </div>
  );
}
