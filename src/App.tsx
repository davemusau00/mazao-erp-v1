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
import { BackendCustomerWorkspace } from './components/customers/BackendCustomerWorkspace';
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
import { SignInForm } from './components/auth/SignInForm';

const allowLocalPreview = import.meta.env.DEV || import.meta.env.VITE_ALLOW_LOCAL_PREVIEW === 'true';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('today');
  const [purchaseStartTab, setPurchaseStartTab] = useState<'orders' | 'receive'>('orders');
  const [activeTenant, setActiveTenant] = useState(storage.getActiveTenant());
  const [backendSession, setBackendSession] = useState(apiClient.getSession());
  const [sessionBootstrap, setSessionBootstrap] = useState<'checking'|'ready'|'error'>('checking');
  const [restoreError, setRestoreError] = useState('');
  const [explicitLocalPreview, setExplicitLocalPreview] = useState(false);
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
    let mounted = true;
    const restoreSession = async () => {
      setSessionBootstrap('checking');
      setRestoreError('');
      setExplicitLocalPreview(false);
      try {
        await apiClient.restore();
        if (mounted) setSessionBootstrap('ready');
      } catch (error) {
        if (!mounted) return;
        setRestoreError(error instanceof Error ? error.message : 'The server session could not be verified.');
        setSessionBootstrap('error');
      }
    };
    void restoreSession();
    const unsubscribe = storage.subscribe(() => {
      setActiveTenant(storage.getActiveTenant());
      setIsOnline(storage.isOnline());
      setOutboxCount(storage.getOutboxCount());
    });
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeBackend();
    };
  }, []);

  useEffect(() => {
    if (!backendSession) return;
    setCompletedOrder(null);
    setBackendReceipt(null);
    setBackendReceiptLoading(false);
    setBackendReceiptError('');
    setIsSyncCenterOpen(false);
    setIsDiagnosticsOpen(false);
    setDiagnosticsBarcode(null);
  }, [backendSession?.user.id]);

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

  if (sessionBootstrap === 'checking') return <SessionBootstrapScreen status="checking" />;
  if (sessionBootstrap === 'error' && !explicitLocalPreview) return <SessionBootstrapScreen
    status="error"
    message={restoreError}
    onRetry={() => {
      setSessionBootstrap('checking');
      setRestoreError('');
      void apiClient.restore().then(() => setSessionBootstrap('ready')).catch(error => {
        setRestoreError(error instanceof Error ? error.message : 'The server session could not be verified.');
        setSessionBootstrap('error');
      });
    }}
    onOpenLocalPreview={allowLocalPreview ? () => setExplicitLocalPreview(true) : undefined}
  />;

  if (!backendSession && !allowLocalPreview) return <main className="flex min-h-dvh items-center justify-center bg-[#090b10] p-5 text-zinc-100">
    <SignInForm />
  </main>;

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

        {activeTab === 'service' && !backendSession && <FoodServiceWorkspace />}

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

        {activeTab === 'customers' && (backendSession
          ? <BackendCustomerWorkspace onNavigate={tab => setActiveTab(tab)} />
          : <CustomerDirectoryView tenant={activeTenant} />)}

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

        {activeTab === 'manage' && !backendSession && <ManageWorkspace tenant={activeTenant} onNavigate={setActiveTab} />}

        {activeTab === 'onboarding' && !backendSession && <OnboardingWorkspace tenant={activeTenant} />}

      {activeTab === 'help' && <HelpWorkspace onNavigate={setActiveTab} onOpenSyncCenter={() => setIsSyncCenterOpen(true)} />}
      </AppShell>

      {/* Diagnostics & Simulator Console Drawer */}
      {!backendSession && <DiagnosticsDrawer
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        onScanBarcode={handleBarcodeFromDiagnostics}
        onOpenSyncCenter={() => setIsSyncCenterOpen(true)}
      />}

      {/* Receipt Preview & ESC/POS Print Modal */}
      {completedOrder && (backendSession
        ? <BackendReceiptModal receipt={backendReceipt} loading={backendReceiptLoading} error={backendReceiptError} onRetry={() => loadBackendReceipt(completedOrder.id)} onClose={closeReceipt} />
        : <ReceiptModal order={completedOrder} tenant={activeTenant} onClose={closeReceipt} />)}

      {/* Outbox Sync Center & Network Simulator Modal */}
      {!backendSession && <SyncCenterModal
        isOpen={isSyncCenterOpen}
        onClose={() => setIsSyncCenterOpen(false)}
      />}
    </div>
  );
}

function SessionBootstrapScreen({
  status,
  message,
  onRetry,
  onOpenLocalPreview,
}: {
  status: 'checking'|'error';
  message?: string;
  onRetry?: () => void;
  onOpenLocalPreview?: () => void;
}) {
  return <main className="flex min-h-dvh items-center justify-center bg-[#090b10] p-5 text-zinc-100">
    <section className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl" aria-labelledby="session-bootstrap-title">
      <p className="text-xs uppercase tracking-[.18em] text-blue-300">Mazao workspace</p>
      <h1 id="session-bootstrap-title" className="mt-2 text-2xl font-bold">{status === 'checking' ? 'Checking saved server session' : 'Server session could not be verified'}</h1>
      <p role={status === 'error' ? 'alert' : 'status'} className="mt-3 text-sm leading-6 text-zinc-300">
        {status === 'checking' ? 'Wait while Mazao checks whether this browser has an authenticated operator session.' : `${message ?? 'The server is unavailable.'} No business workspace has been opened.`}
      </p>
      {status === 'error' && <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={onRetry} className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold">Retry server check</button>
        {onOpenLocalPreview && <button type="button" onClick={onOpenLocalPreview} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-zinc-200">Open local preview only</button>}
      </div>}
      {status === 'error' && onOpenLocalPreview && <p className="mt-4 text-xs leading-5 text-amber-200">The local preview uses separate browser demo records. Do not use it to record real business transactions.</p>}
    </section>
  </main>;
}
