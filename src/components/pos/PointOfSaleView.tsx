import React, { useState, useEffect, useRef } from 'react';
import { ProductItem, CartItem, PaymentMethod, TenantProfile, SaleOrder, CustomerAccount } from '../../types/erp';
import { storage } from '../../services/storage';
import { hardware } from '../../services/hardware';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { apiClient, type BackendShift } from '../../services/apiClient';
import {
  Barcode,
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  Smartphone,
  Hotel,
  Printer,
  CheckCircle2,
  AlertCircle,
  ChevronUp,
  X,
  UserCheck,
  KeyRound,
  ShieldAlert,
  Users
} from 'lucide-react';

interface PointOfSaleViewProps {
  tenant: TenantProfile;
  onOrderCompleted: (order: SaleOrder) => void;
  scannedBarcodeFromDiagnostics?: string | null;
  onClearScannedBarcode?: () => void;
}

export const PointOfSaleView: React.FC<PointOfSaleViewProps> = ({
  tenant,
  onOrderCompleted,
  scannedBarcodeFromDiagnostics,
  onClearScannedBarcode,
}) => {
  const [products, setProducts] = useState<ProductItem[]>(storage.getProducts());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [barcodeInput, setBarcodeInput] = useState('');

  // Mobile Checkout Sheet State
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

  // Payment Tender Modal State
  const [isTenderModalOpen, setIsTenderModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountTendered, setAmountTendered] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [silentPrintEnabled, setSilentPrintEnabled] = useState(true);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [serverShift, setServerShift] = useState<BackendShift | null>(null);
  const [backendCatalog, setBackendCatalog] = useState(false);
  const [backendTaxRates, setBackendTaxRates] = useState<Record<string,number>>({});
  const [unknownCommandId, setUnknownCommandId] = useState<string | null>(null);
  const pendingCommand = useRef<import('../../services/apiClient').BackendCommand | null>(null);

  // Customer Credit Tender State
  const [customers, setCustomers] = useState<CustomerAccount[]>(storage.getCustomers(tenant.id));
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [isOverrideAuthorized, setIsOverrideAuthorized] = useState(false);
  const [overrideAuthorizedBy, setOverrideAuthorizedBy] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Sync products and customers when tenant changes
  useEffect(() => {
    setProducts(storage.getProducts());
    const tenantCusts = storage.getCustomers(tenant.id);
    setCustomers(tenantCusts);
    if (tenantCusts.length > 0) {
      setSelectedCustomerId(tenantCusts[0].id);
    }
    setCart([]);
  }, [tenant.id]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const session = apiClient.getSession();
      if (!session) { if (alive) { setBackendCatalog(false); setServerShift(null); setProducts(storage.getProducts()); } return; }
      try {
        const [catalog, shift] = await Promise.all([apiClient.listCatalog(), apiClient.getCurrentShift()]);
        if (!alive) return;
        setBackendCatalog(true); setServerShift(shift.shift);
        setBackendTaxRates(Object.fromEntries(catalog.items.map(item=>[item.id,item.taxRateBps])));
        setProducts(catalog.items.map(item => ({ id:item.id,sku:item.sku,barcode:'',name:item.name,category:'server catalog',costPrice:item.costPriceMinor/100,sellingPrice:item.sellingPriceMinor/100,stockOnHand:Number(item.quantity),reorderPoint:0,unit:item.unit })));
      } catch (error) { if (alive) showNotice(error instanceof Error ? error.message : 'Server catalog unavailable.'); }
    };
    void load();
    return apiClient.subscribe(() => { void load(); });
  }, []);

  // Subscribe to reactive customer balance updates
  useEffect(() => {
    const unsub = storage.subscribe(() => {
      setCustomers(storage.getCustomers(tenant.id));
    });
    return unsub;
  }, [tenant.id]);

  // Handle external barcode scan from Diagnostics Drawer
  useEffect(() => {
    if (scannedBarcodeFromDiagnostics) {
      const found = products.find(
        p => p.barcode === scannedBarcodeFromDiagnostics || p.sku.toLowerCase() === scannedBarcodeFromDiagnostics.toLowerCase()
      );
      if (found) {
        handleAddToCart(found);
        showNotice(`Scanned via Diagnostics: ${found.name}`);
      }
      if (onClearScannedBarcode) onClearScannedBarcode();
    }
  }, [scannedBarcodeFromDiagnostics, products]);

  // Occupied rooms for cross-module folio billing
  const occupiedRooms = storage.getOccupiedRoomsWithGuests();

  // Categories
  const categories = ['all', ...Array.from(new Set(products.map(p => p.category)))];

  // Filtered products
  const filteredProducts = products.filter(p => {
    const matchesCat = selectedCategory === 'all' || p.category === selectedCategory;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcode.includes(searchQuery) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  // Cart calculations
  const totalItemCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const subtotal = backendCatalog ? cart.reduce((acc,item)=>acc+Math.round(item.unitPrice*100)*item.quantity,0)/100 : cart.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0);
  const tax = backendCatalog ? cart.reduce((acc,item)=>{const base=Math.round(item.unitPrice*100)*item.quantity;return acc+Math.floor((base*(backendTaxRates[item.product.id]??0)+5000)/10000)},0)/100 : subtotal * tenant.taxRate;
  const total = subtotal + tax;
  const tenderedNum = parseFloat(amountTendered) || 0;
  const changeDue = Math.max(0, tenderedNum - total);

  // Customer Credit Calculations & Real-time Validation
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const projectedCustomerBalance = selectedCustomer ? selectedCustomer.currentBalance + total : 0;
  const isCreditLimitExceeded = selectedCustomer ? projectedCustomerBalance > selectedCustomer.creditLimit : false;
  const isCustomerSuspended = selectedCustomer?.status === 'suspended';
  const creditOverage = selectedCustomer ? Math.max(0, projectedCustomerBalance - selectedCustomer.creditLimit) : 0;
  const availableCredit = selectedCustomer ? Math.max(0, selectedCustomer.creditLimit - selectedCustomer.currentBalance) : 0;

  // Filtered customer list for instant search
  const filteredCreditCustomers = customers.filter(c => {
    if (!customerSearchQuery.trim()) return true;
    const q = customerSearchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.nationalIdOrTaxId && c.nationalIdOrTaxId.toLowerCase().includes(q))
    );
  });

  // Add item to cart
  const handleAddToCart = (product: ProductItem) => {
    if (product.stockOnHand <= 0) {
      showNotice(`Warning: ${product.name} is out of stock!`);
    }

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1, unitPrice: product.sellingPrice }];
    });
  };

  // Adjust cart quantity
  const handleUpdateQty = (productId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(item => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const handleRemoveItem = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const handleClearCart = () => {
    setCart([]);
  };

  // Barcode scanner submission
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const found = products.find(
      p => p.barcode === barcodeInput.trim() || p.sku.toLowerCase() === barcodeInput.trim().toLowerCase()
    );

    if (found) {
      handleAddToCart(found);
      setBarcodeInput('');
      showNotice(`Added: ${found.name}`);
    } else {
      showNotice(`Barcode "${barcodeInput}" not found in catalogue`);
    }
  };

  // Unified mobile search / barcode submission
  const handleUnifiedSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    // Check for exact barcode or SKU or exact name match
    const found = products.find(
      p =>
        p.barcode === query ||
        p.sku.toLowerCase() === query.toLowerCase() ||
        p.name.toLowerCase() === query.toLowerCase()
    );

    if (found) {
      handleAddToCart(found);
      setSearchQuery('');
      showNotice(`Added: ${found.name}`);
    } else if (filteredProducts.length === 1) {
      handleAddToCart(filteredProducts[0]);
      setSearchQuery('');
      showNotice(`Added: ${filteredProducts[0].name}`);
    } else if (filteredProducts.length === 0) {
      showNotice(`No products match "${query}"`);
    }
  };

  const showNotice = (msg: string) => {
    setFeedbackNotice(msg);
    setTimeout(() => setFeedbackNotice(null), 3000);
  };

  // Handle Manager Security Override for Credit Overages
  const handleAuthorizeManagerOverride = () => {
    setOverrideError(null);
    if (!managerPin.trim()) {
      setOverrideError('Please enter manager security PIN');
      return;
    }
    const staffList = storage.getStaffUsers();
    const matchedStaff = staffList.find(
      s => (s.role === 'manager' || s.role === 'admin') && s.pin === managerPin.trim()
    );

    // This lookup is only a local preview convenience; authorization must move to the server.
    if (matchedStaff) {
      const authTitle = `${matchedStaff.name} (${matchedStaff.title})`;
      setIsOverrideAuthorized(true);
      setOverrideAuthorizedBy(authTitle);
      setOverrideError(null);
      showNotice(`Credit override authorized by ${authTitle}`);
    } else {
      setOverrideError('Invalid PIN. Only authorized managers or administrators can approve credit extensions.');
    }
  };

  // Open Tender modal
  const handleOpenTender = () => {
    if (cart.length === 0) return;
    setAmountTendered(total.toFixed(2));
    if (occupiedRooms.length > 0) {
      setSelectedRoomId(occupiedRooms[0].id);
    }
    const tenantCusts = storage.getCustomers(tenant.id);
    setCustomers(tenantCusts);
    if (tenantCusts.length > 0 && !selectedCustomerId) {
      setSelectedCustomerId(tenantCusts[0].id);
    }
    setCustomerSearchQuery('');
    setManagerPin('');
    setIsOverrideAuthorized(false);
    setOverrideAuthorizedBy('');
    setOverrideError(null);
    setIsTenderModalOpen(true);
  };

  // Complete sale
  const handleFinalizeSale = async () => {
    if (cart.length === 0) return;

    const backendSession = apiClient.getSession();
    if (backendSession && backendCatalog) {
      if (paymentMethod !== 'cash') { showNotice('Server checkout currently accepts verified cash tender only. Other tenders are blocked until their providers are connected.'); return; }
      if (!serverShift) { showNotice('Open a server shift before taking a sale.'); return; }
      const toMinor = (value:number) => Math.round((value + Number.EPSILON) * 100);
      const command = pendingCommand.current ?? {
        protocolVersion:1 as const, commandId:crypto.randomUUID(), tenantId:backendSession.tenant.id, deviceId:backendSession.deviceId,
        type:'sales.order.settle', occurredAt:new Date().toISOString(), expectedVersions:{[`shift:${serverShift.id}`]:serverShift.version},
        payload:{shiftId:serverShift.id,lines:cart.map(item=>({productId:item.product.id,quantity:String(item.quantity)})),tenders:[{method:'CASH',amountMinor:toMinor(tenderedNum || total),currency:backendSession.tenant.currency}]},
      };
      pendingCommand.current=command;
      try {
        const outcome=await apiClient.submitCommand(command);
        if(outcome.status==='CONFIRMED' && outcome.value) {
          const value=outcome.value; const saleOrder:SaleOrder={id:String(value.saleId),idempotencyKey:command.commandId,orderNumber:String(value.saleId).slice(0,8).toUpperCase(),shiftId:serverShift.id,cashierName:backendSession.user.name,tenantId:backendSession.tenant.id,items:[...cart],subtotal:Number(value.subtotalMinor)/100,tax:Number(value.taxMinor)/100,discount:0,total:Number(value.totalMinor)/100,paymentMethod:'cash',amountTendered:Number(value.tenderedMinor)/100,changeDue:Number(value.changeMinor)/100,timestamp:new Date().toISOString(),syncStatus:'synced_server',status:'completed'};
          pendingCommand.current=null; setUnknownCommandId(null); setCart([]); setIsTenderModalOpen(false); setIsMobileCartOpen(false); setServerShift({...serverShift,version:Number(value.shiftVersion),cashSalesMinor:serverShift.cashSalesMinor+Number(value.totalMinor),expectedCashMinor:serverShift.expectedCashMinor+Number(value.totalMinor)}); onOrderCompleted(saleOrder); void apiClient.listCatalog().then(c=>setProducts(c.items.map(i=>({id:i.id,sku:i.sku,barcode:'',name:i.name,category:'server catalog',costPrice:i.costPriceMinor/100,sellingPrice:i.sellingPriceMinor/100,stockOnHand:Number(i.quantity),reorderPoint:0,unit:i.unit})))); return;
        }
        if(outcome.status==='CONFLICT'||outcome.status==='REJECTED') { pendingCommand.current=null; setUnknownCommandId(null); showNotice(outcome.message??`Sale ${outcome.status.toLowerCase()}: ${outcome.code??''}`); return; }
        setUnknownCommandId(command.commandId); showNotice('Sale outcome is not confirmed. Check command status before any retry.');
      } catch(error) { setUnknownCommandId(command.commandId); showNotice(error instanceof Error?error.message:'Sale outcome is unknown.'); }
      return;
    }

    const activeShift = storage.getActiveShift();
    if (!activeShift) {
      showNotice('No active shift! Please open a cashier shift first.');
      return;
    }

    let roomChargeRef = undefined;
    let customerAccountRef = undefined;

    if (paymentMethod === 'room_folio') {
      const room = occupiedRooms.find(r => r.id === selectedRoomId);
      if (!room) {
        showNotice('Please select an active hotel guest room for folio charge');
        return;
      }
      roomChargeRef = {
        roomId: room.id,
        roomNumber: room.number,
        guestName: room.guestName || 'Valued Guest',
      };
    } else if (paymentMethod === 'customer_credit') {
      if (!selectedCustomer) {
        showNotice('Please select a customer credit account');
        return;
      }
      if ((isCreditLimitExceeded || isCustomerSuspended) && !isOverrideAuthorized) {
        showNotice('Credit limit exceeded! Manager authorization PIN required.');
        return;
      }

      customerAccountRef = {
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        previousBalance: selectedCustomer.currentBalance,
        newBalance: selectedCustomer.currentBalance + total,
        managerOverride: isOverrideAuthorized
          ? {
              authorizedBy: overrideAuthorizedBy || 'Manager Authorization',
              reason: isCreditLimitExceeded
                ? `Credit limit exceeded by ${tenant.currencySymbol} ${creditOverage.toFixed(2)}`
                : 'Account suspension override',
              timestamp: new Date().toISOString(),
            }
          : undefined,
      };

      if (isOverrideAuthorized) {
        storage.recordAuditLog({
          action: 'price_override',
          details: `Manager credit limit override approved for ${selectedCustomer.name}: Sale total ${tenant.currencySymbol} ${total.toFixed(2)} (Previous bal: ${selectedCustomer.currentBalance}, New bal: ${customerAccountRef.newBalance}, Limit: ${selectedCustomer.creditLimit})`,
          amount: total,
          authorizedBy: overrideAuthorizedBy,
          flagSeverity: 'warning',
        });
      }
    }

    const orderNumber = 'ORD-' + Math.floor(100000 + Math.random() * 900000);

    const saleOrder = storage.processSale({
      orderNumber,
      shiftId: activeShift.id,
      cashierName: activeShift.cashierName,
      tenantId: tenant.id,
      items: [...cart],
      subtotal,
      tax,
      discount: 0,
      total,
      paymentMethod,
      amountTendered: paymentMethod === 'cash' ? (tenderedNum || total) : total,
      changeDue: paymentMethod === 'cash' ? changeDue : 0,
      roomChargeRef,
      customerAccountRef,
    });

    if (paymentMethod === 'cash') {
      hardware.triggerCashDrawerKick();
    }

    if (silentPrintEnabled) {
      hardware.executeSilentPrint(saleOrder, tenant);
    }

    setCart([]);
    setIsTenderModalOpen(false);
    setIsMobileCartOpen(false);
    onOrderCompleted(saleOrder);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden bg-[#090b10]">
      {/* LEFT: Product Catalogue & Scanner Area (min-h-0 flex-1) */}
      <div className="flex-1 min-h-0 flex flex-col p-2.5 sm:p-4 lg:p-6 overflow-hidden">
        {/* Search & Barcode input area */}
        <div className="mb-2 sm:mb-3 shrink-0">
          {/* Mobile Single Smart Search & Barcode Scanner (< sm) */}
          <form onSubmit={handleUnifiedSearchSubmit} className="sm:hidden relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
            <input
              type="text"
              placeholder="Search or scan barcode (Enter)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-9 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 font-mono transition-colors min-h-[38px]"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 p-1"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none">
                <Barcode className="w-4 h-4" />
              </div>
            )}
          </form>

          {/* Desktop Dual Barcode & Search Inputs (≥ sm) */}
          <div className="hidden sm:flex items-center gap-2.5">
            <form onSubmit={handleBarcodeSubmit} className="relative flex-1 w-full">
              <Barcode className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
              <input
                ref={barcodeInputRef}
                type="text"
                placeholder="Scan Barcode or SKU (Enter)..."
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 font-mono transition-colors min-h-[40px]"
              />
            </form>

            <div className="relative flex-1 w-full sm:max-w-xs">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 transition-colors min-h-[40px]"
              />
            </div>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 mb-2 scrollbar-none shrink-0">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium whitespace-nowrap capitalize transition-colors min-h-[32px] sm:min-h-[36px] ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : 'bg-zinc-900 border border-zinc-800/80 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {cat.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Feedback notice toast */}
        {feedbackNotice && (
          <div className="mb-2 p-2 rounded-lg bg-blue-950/80 border border-blue-800 text-xs text-blue-300 flex items-center gap-2 shrink-0 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate">{feedbackNotice}</span>
            {unknownCommandId && <button type="button" className="ml-auto underline whitespace-nowrap" onClick={async()=>{try{const status=await apiClient.checkCommandStatus(unknownCommandId);const response=status.response as {status?:string;value?:Record<string,unknown>;message?:string};if(response.status==='CONFIRMED'){showNotice('Server confirms this command. Refresh server catalog and review the sale in sales history.');setUnknownCommandId(null);pendingCommand.current=null;setCart([]);}else if(response.status==='REJECTED'||response.status==='CONFLICT'){showNotice(response.message??`Command ${response.status.toLowerCase()}.`);setUnknownCommandId(null);pendingCommand.current=null;}else showNotice(`Command status: ${status.status}. Retry status check shortly.`)}catch(e){showNotice(e instanceof Error?e.message:'Unable to check command status.')}}}>Check status</button>}
          </div>
        )}

        {/* Product Grid: Independently scrollable with top & bottom breathing room */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3.5 pb-4 pt-1.5">
          {filteredProducts.map(product => {
            const isLowStock = product.stockOnHand <= product.reorderPoint;
            return (
              <button
                key={product.id}
                onClick={() => handleAddToCart(product)}
                className="group flex flex-col justify-between p-2.5 sm:p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850 text-left transition-all active:scale-[0.98] min-h-[95px] sm:min-h-[110px]"
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wide truncate flex-1 pr-1">
                      {product.category.replace('_', ' ')}
                    </span>
                    <span className={`text-[10px] font-mono tabular-nums shrink-0 ${isLowStock ? 'text-amber-400 font-semibold' : 'text-zinc-500'}`}>
                      {product.stockOnHand} {product.unit}
                    </span>
                  </div>
                  <h4 className="text-xs sm:text-sm font-semibold text-zinc-200 group-hover:text-white line-clamp-2 leading-snug">
                    {product.name}
                  </h4>
                </div>

                <div className="mt-2 pt-1.5 border-t border-zinc-800/80 flex items-center justify-between">
                  <span className="text-xs sm:text-sm font-bold font-mono text-zinc-100 tabular-nums">
                    {tenant.currencySymbol} {product.sellingPrice.toFixed(2)}
                  </span>
                  <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-zinc-800 group-hover:bg-blue-600 flex items-center justify-center text-zinc-400 group-hover:text-white transition-colors">
                    <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* MOBILE PERSISTENT BOTTOM BASKET STRIP (< lg): Natural flex element, sits cleanly directly above navigation bar */}
      <div className="lg:hidden shrink-0 px-3 py-2 bg-zinc-950 border-t border-zinc-850 z-20">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-blue-600/15 border border-blue-500/30 text-[10px] sm:text-xs font-mono text-blue-400 font-bold">
                {totalItemCount} {totalItemCount === 1 ? 'item' : 'items'}
              </span>
              <span className="text-xs sm:text-sm font-bold font-mono text-zinc-100 tabular-nums">
                {tenant.currencySymbol} {total.toFixed(2)}
              </span>
            </div>
          </div>

          <button
            onClick={() => setIsMobileCartOpen(true)}
            disabled={cart.length === 0}
            className="px-3.5 py-1.5 sm:py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold text-xs shadow-sm flex items-center gap-1.5 min-h-[38px] shrink-0 transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>View Basket / Pay</span>
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* RIGHT: DESKTOP CART PANEL (Hidden on < lg, fixed side panel on ≥ lg) */}
      <div className="hidden lg:flex w-88 xl:w-96 flex-col bg-zinc-950 border-l border-zinc-850 h-full shrink-0">
        {/* Cart Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-850 bg-zinc-950/60 shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-zinc-200">Current Order</h3>
            <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-900 text-zinc-400 font-mono">
              {totalItemCount} items
            </span>
          </div>
          {cart.length > 0 && (
            <button
              onClick={handleClearCart}
              className="text-xs text-rose-400 hover:text-rose-300 transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>

        {/* Cart Items List: Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
              <ShoppingCart className="w-10 h-10 stroke-1 mb-2 text-zinc-700" />
              <p className="text-xs">Cart is empty</p>
              <p className="text-[11px] text-zinc-600 mt-1">Scan a barcode or tap products to add</p>
            </div>
          ) : (
            cart.map(item => (
              <div
                key={item.product.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-zinc-800/80"
              >
                <div className="flex-1 min-w-0 pr-3">
                  <h5 className="text-xs font-medium text-zinc-200 truncate">{item.product.name}</h5>
                  <div className="text-[11px] font-mono text-zinc-500 tabular-nums">
                    {tenant.currencySymbol} {item.unitPrice.toFixed(2)} × {item.quantity} = {tenant.currencySymbol} {(item.quantity * item.unitPrice).toFixed(2)}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleUpdateQty(item.product.id, -1)}
                    className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 min-h-[28px] min-w-[28px]"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-6 text-center font-mono text-xs font-bold text-zinc-200 tabular-nums">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => handleUpdateQty(item.product.id, 1)}
                    className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 min-h-[28px] min-w-[28px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleRemoveItem(item.product.id)}
                    className="p-1.5 text-zinc-600 hover:text-rose-400 ml-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Cart Totals & Checkout Button */}
        <div className="p-4 border-t border-zinc-850 bg-zinc-950/90 space-y-3 shrink-0">
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-zinc-400">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">{tenant.currencySymbol} {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Tax ({Math.round(tenant.taxRate * 100)}% VAT)</span>
              <span className="font-mono tabular-nums">{tenant.currencySymbol} {tax.toFixed(2)}</span>
            </div>
            <div className="border-t border-zinc-800 pt-2 flex justify-between text-base font-bold text-zinc-100">
              <span>Total Due</span>
              <span className="font-mono text-blue-400 tabular-nums">
                {tenant.currencySymbol} {total.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-zinc-400 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={silentPrintEnabled}
                onChange={e => setSilentPrintEnabled(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 text-blue-600 focus:ring-0"
              />
              <span className="flex items-center gap-1 text-[11px]">
                <Printer className="w-3.5 h-3.5 text-zinc-400" />
                Silent Print Thermal Slip
              </span>
            </label>
          </div>

          <button
            onClick={handleOpenTender}
            disabled={cart.length === 0}
            className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold text-sm shadow-sm transition-all flex items-center justify-center gap-2 min-h-[44px]"
          >
            <span>Tender {tenant.currencySymbol} {total.toFixed(2)}</span>
          </button>
        </div>
      </div>


      {/* MOBILE BASKET & CHECKOUT SLIDE-UP SHEET */}
      <ResponsiveDialog
        isOpen={isMobileCartOpen}
        onClose={() => setIsMobileCartOpen(false)}
        title="Active Sales Order Basket"
        subtitle={`${totalItemCount} items · Total: ${tenant.currencySymbol} ${total.toFixed(2)}`}
        icon={<ShoppingCart className="w-5 h-5 text-blue-400" />}
        footerActions={
          <div className="w-full flex items-center justify-between gap-3">
            <button
              onClick={handleClearCart}
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 min-h-[44px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
            <button
              onClick={() => {
                setIsMobileCartOpen(false);
                handleOpenTender();
              }}
              disabled={cart.length === 0}
              className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold text-xs shadow-sm min-h-[44px] flex items-center gap-1.5"
            >
              <span>Proceed to Payment</span>
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {cart.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              Basket is currently empty.
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map(item => (
                <div
                  key={item.product.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold text-zinc-200 truncate">{item.product.name}</div>
                    <div className="text-[11px] font-mono text-zinc-500">
                      {tenant.currencySymbol} {item.unitPrice.toFixed(2)} × {item.quantity}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleUpdateQty(item.product.id, -1)}
                      className="w-8 h-8 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-center text-zinc-300 min-h-[36px] min-w-[36px]"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-6 text-center font-mono font-bold text-xs text-zinc-100 tabular-nums">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleUpdateQty(item.product.id, 1)}
                      className="w-8 h-8 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-center text-zinc-300 min-h-[36px] min-w-[36px]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-850 space-y-1.5 text-xs">
                <div className="flex justify-between text-zinc-400">
                  <span>Subtotal:</span>
                  <span className="font-mono tabular-nums">{tenant.currencySymbol} {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Tax ({Math.round(tenant.taxRate * 100)}%):</span>
                  <span className="font-mono tabular-nums">{tenant.currencySymbol} {tax.toFixed(2)}</span>
                </div>
                <div className="border-t border-zinc-800 pt-1.5 flex justify-between font-bold text-sm text-zinc-100">
                  <span>Total Due:</span>
                  <span className="font-mono text-blue-400 tabular-nums">{tenant.currencySymbol} {total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ResponsiveDialog>

      {/* RESPONSIVE TENDER & PAYMENT DIALOG */}
      <ResponsiveDialog
        isOpen={isTenderModalOpen}
        onClose={() => setIsTenderModalOpen(false)}
        title="Settle Order Payment"
        subtitle={`Amount Due: ${tenant.currencySymbol} ${total.toFixed(2)}`}
        icon={<Banknote className="w-5 h-5 text-emerald-400" />}
        footerActions={
          <div className="w-full flex items-center justify-between gap-2">
            <button
              onClick={() => setIsTenderModalOpen(false)}
              className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 min-h-[44px]"
            >
              Back
            </button>
            <button
              onClick={handleFinalizeSale}
              disabled={
                (paymentMethod === 'cash' && tenderedNum < total) ||
                (paymentMethod === 'room_folio' && occupiedRooms.length === 0) ||
                (paymentMethod === 'customer_credit' &&
                  (!selectedCustomer ||
                    ((isCreditLimitExceeded || isCustomerSuspended) && !isOverrideAuthorized)))
              }
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold text-xs shadow-sm transition-all min-h-[44px]"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Confirm & Print Receipt</span>
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Method selector buttons with min-h 44px */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className={`p-2.5 sm:p-3 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all min-h-[50px] ${
                paymentMethod === 'cash'
                  ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-300'
              }`}
            >
              <Banknote className="w-5 h-5" />
              <span>Cash</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className={`p-2.5 sm:p-3 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all min-h-[50px] ${
                paymentMethod === 'card'
                  ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-300'
              }`}
            >
              <CreditCard className="w-5 h-5" />
              <span>Card POS</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('mobile_money')}
              className={`p-2.5 sm:p-3 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all min-h-[50px] ${
                paymentMethod === 'mobile_money'
                  ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-300'
              }`}
            >
              <Smartphone className="w-5 h-5" />
              <span>M-Pesa</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('room_folio')}
              className={`p-2.5 sm:p-3 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all min-h-[50px] ${
                paymentMethod === 'room_folio'
                  ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-300'
              }`}
            >
              <Hotel className="w-5 h-5" />
              <span>Room Folio</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('customer_credit')}
              className={`p-2.5 sm:p-3 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all min-h-[50px] ${
                paymentMethod === 'customer_credit'
                  ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-300'
              }`}
            >
              <UserCheck className="w-5 h-5" />
              <span>Charge Account</span>
            </button>
          </div>

          {/* Cash Details */}
          {paymentMethod === 'cash' && (
            <div className="space-y-3 p-3.5 sm:p-4 rounded-lg bg-zinc-950 border border-zinc-800">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Cash Tendered</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-zinc-500">
                    {tenant.currencySymbol}
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={amountTendered}
                    onChange={e => setAmountTendered(e.target.value)}
                    className="w-full pl-12 pr-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-lg font-mono font-bold text-zinc-100 focus:outline-none focus:border-blue-500 tabular-nums min-h-[44px]"
                  />
                </div>
              </div>

              {/* Fast Bills */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setAmountTendered(total.toFixed(2))}
                  className="px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-xs font-mono text-zinc-200 min-h-[36px]"
                >
                  Exact ({tenant.currencySymbol} {total.toFixed(0)})
                </button>
                {[100, 200, 500, 1000, 2000, 5000].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmountTendered(String(val))}
                    className="px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-xs font-mono text-zinc-200 min-h-[36px]"
                  >
                    +{val}
                  </button>
                ))}
              </div>

              {/* Change summary */}
              <div className="pt-2 border-t border-zinc-850 flex items-center justify-between">
                <span className="text-xs text-zinc-400">Change Due:</span>
                <span className={`text-base font-mono font-bold tabular-nums ${tenderedNum >= total ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {tenant.currencySymbol} {changeDue.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Room Folio Details */}
          {paymentMethod === 'room_folio' && (
            <div className="p-3.5 sm:p-4 rounded-lg bg-zinc-950 border border-zinc-800 space-y-2">
              <div className="text-xs font-semibold text-zinc-300">
                Charge Order Directly to Occupied Room Folio
              </div>
              {occupiedRooms.length === 0 ? (
                <div className="p-3 bg-amber-950/40 border border-amber-900/60 rounded text-xs text-amber-300">
                  No guests currently checked into rooms. Check in a guest under the "Rooms" tab.
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Select Guest Room</label>
                  <select
                    value={selectedRoomId}
                    onChange={e => setSelectedRoomId(e.target.value)}
                    className="w-full p-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-100 min-h-[44px]"
                  >
                    {occupiedRooms.map(r => (
                      <option key={r.id} value={r.id}>
                        Room {r.number} — {r.guestName} ({r.type})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Customer Credit / Charge to Account Details */}
          {paymentMethod === 'customer_credit' && (
            <div className="p-3.5 sm:p-4 rounded-lg bg-zinc-950 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-blue-400" />
                  <span>Charge to Customer Credit Account</span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">
                  {customers.length} registered accounts
                </span>
              </div>

              {/* Instant Search Bar with Live Badges */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                  <input
                    type="text"
                    value={customerSearchQuery}
                    onChange={e => setCustomerSearchQuery(e.target.value)}
                    placeholder="Search by customer name, phone, or ID..."
                    className="w-full pl-8 pr-8 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 min-h-[38px]"
                  />
                  {customerSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCustomerSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filtered Customer Selection List (Max 3 visible / scrollable) */}
                <div className="max-h-36 overflow-y-auto space-y-1.5 scrollbar-none pr-0.5">
                  {filteredCreditCustomers.length === 0 ? (
                    <div className="p-3 text-center text-xs text-zinc-500 bg-zinc-900/50 rounded-lg">
                      No matching customer accounts found.
                    </div>
                  ) : (
                    filteredCreditCustomers.map(c => {
                      const avail = Math.max(0, c.creditLimit - c.currentBalance);
                      const isSelected = c.id === selectedCustomerId;

                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            setSelectedCustomerId(c.id);
                            setIsOverrideAuthorized(false);
                            setOverrideError(null);
                          }}
                          className={`p-2.5 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-blue-600/15 border-blue-500 text-zinc-100'
                              : 'bg-zinc-900 hover:bg-zinc-850 border-zinc-800 text-zinc-300'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-semibold text-xs truncate flex items-center gap-1.5">
                              <span>{c.name}</span>
                              {c.status === 'suspended' && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] bg-rose-950 text-rose-400 border border-rose-800">
                                  Suspended
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              {c.phone} {c.nationalIdOrTaxId && `· ${c.nationalIdOrTaxId}`}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-[10px] text-zinc-400 font-mono">
                              Debt: <span className="text-amber-400 font-semibold">{tenant.currencySymbol} {c.currentBalance.toLocaleString()}</span>
                            </div>
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                                avail >= total
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                                  : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                              }`}
                            >
                              Avail: {tenant.currencySymbol} {avail.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Selected Customer Real-Time Credit Preview */}
              {selectedCustomer && (
                <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs border-b border-zinc-800 pb-2">
                    <span className="font-semibold text-zinc-200">{selectedCustomer.name}</span>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      Credit Limit: {tenant.currencySymbol} {selectedCustomer.creditLimit.toLocaleString()}
                    </span>
                  </div>

                  {/* Balance Dynamics Summary */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
                    <div className="p-2 rounded bg-zinc-950/60 border border-zinc-850">
                      <span className="text-[10px] text-zinc-500 block font-sans">Current Debt</span>
                      <span className="font-bold text-amber-400">
                        {tenant.currencySymbol} {selectedCustomer.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="p-2 rounded bg-zinc-950/60 border border-zinc-850">
                      <span className="text-[10px] text-zinc-500 block font-sans">Current Sale</span>
                      <span className="font-bold text-blue-400">
                        +{tenant.currencySymbol} {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="p-2 rounded bg-zinc-950/60 border border-zinc-850">
                      <span className="text-[10px] text-zinc-500 block font-sans">Balance After</span>
                      <span
                        className={`font-bold ${
                          isCreditLimitExceeded ? 'text-rose-400' : 'text-zinc-100'
                        }`}
                      >
                        {tenant.currencySymbol} {projectedCustomerBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Credit Limit Status Banner */}
                  {!isCreditLimitExceeded && !isCustomerSuspended ? (
                    <div className="p-2.5 bg-emerald-950/30 border border-emerald-800/50 rounded-lg flex items-center gap-2 text-xs text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        Charge is within customer's credit limit. Remaining credit after sale:{' '}
                        <strong className="font-mono">
                          {tenant.currencySymbol} {(selectedCustomer.creditLimit - projectedCustomerBalance).toLocaleString()}
                        </strong>.
                      </span>
                    </div>
                  ) : (
                    /* Strict Credit Block with Manager Override PIN Prompt */
                    <div className="space-y-2">
                      <div className="p-2.5 bg-rose-950/40 border border-rose-800/60 rounded-lg flex items-start gap-2 text-xs text-rose-300">
                        <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <strong className="block font-semibold">Strict Credit Limit Enforcement</strong>
                          {isCreditLimitExceeded && (
                            <span>
                              Sale exceeds customer credit limit by{' '}
                              <strong className="font-mono text-rose-200">
                                {tenant.currencySymbol} {creditOverage.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </strong>.
                            </span>
                          )}
                          {isCustomerSuspended && (
                            <span className="block mt-0.5 text-rose-200">
                              Account status is currently Suspended.
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Manager PIN Override Controls */}
                      {!isOverrideAuthorized ? (
                        <div className="p-3 bg-zinc-950 border border-amber-900/60 rounded-lg space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>Manager Override Required</span>
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              Local demo approval
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              maxLength={8}
                              value={managerPin}
                              onChange={e => setManagerPin(e.target.value)}
                              placeholder="Enter demo manager PIN..."
                              className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 min-h-[38px]"
                            />
                            <button
                              type="button"
                              onClick={handleAuthorizeManagerOverride}
                              className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition-colors shrink-0 min-h-[38px]"
                            >
                              Authorize
                            </button>
                          </div>

                          {overrideError && (
                            <div className="text-[11px] text-rose-400">{overrideError}</div>
                          )}
                        </div>
                      ) : (
                        <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-lg flex items-center justify-between text-xs text-emerald-300">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span>
                              Override Approved by <strong>{overrideAuthorizedBy}</strong>
                            </span>
                          </div>
                          <span className="text-[10px] text-emerald-400/80 font-mono uppercase">Authorized</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Mobile Money Till */}
          {paymentMethod === 'mobile_money' && (
            <div className="p-3.5 sm:p-4 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 space-y-1">
              <div className="font-semibold text-emerald-400">Mobile Money Till Ready</div>
              <p className="text-zinc-400">
                Customer should pay <span className="font-mono font-bold text-zinc-100">{tenant.currencySymbol} {total.toFixed(2)}</span> to Buy Goods Till #{tenant.tillNumber || '884129'}.
              </p>
            </div>
          )}

          {/* Card Terminal */}
          {paymentMethod === 'card' && (
            <div className="p-3.5 sm:p-4 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 space-y-1">
              <div className="font-semibold text-blue-400">Card Payment Terminal</div>
              <p className="text-zinc-400">
                Ready for contactless tap or EMV insertion on connected payment hardware.
              </p>
            </div>
          )}
        </div>
      </ResponsiveDialog>
    </div>
  );
};
