import React, { useState } from 'react';
import { ProductItem, StockMovement, TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { moneyInputToMinor } from '../../utils/money';
import { sumDecimalStrings } from '../../utils/decimal';
import {
  Package,
  AlertTriangle,
  History,
  Sliders,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  X,
  Search
} from 'lucide-react';
import {apiClient} from '../../services/apiClient';
import {BackendInventoryWorkspace} from './BackendInventoryWorkspace';

interface InventoryViewProps {
  tenant: TenantProfile;
}

function stockDeltaText(value: string, type: StockMovement['type']): string | null {
  const normalized = value.trim();
  const pattern = type === 'adjustment' ? /^-?\d+(?:\.\d{1,6})?$/ : /^\d+(?:\.\d{1,6})?$/;
  if (!pattern.test(normalized) || Number(normalized) === 0) return null;
  if (type === 'damage') return `-${normalized}`;
  return normalized;
}

export const InventoryView: React.FC<InventoryViewProps> = ({ tenant }) => {
  const [products, setProducts] = useState<ProductItem[]>(storage.getProducts());
  const [movements, setMovements] = useState<StockMovement[]>(storage.getStockMovements());
  const [activeTab, setActiveTab] = useState<'catalogue' | 'movements'>('catalogue');
  const [searchQuery, setSearchQuery] = useState('');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSku, setNewSku] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [newCategory, setNewCategory] = useState('GENERAL');
  const [newUnit, setNewUnit] = useState('each');
  const [newCostPrice, setNewCostPrice] = useState('');
  const [newSellingPrice, setNewSellingPrice] = useState('');
  const [newReorderPoint, setNewReorderPoint] = useState('0');
  const [addItemError, setAddItemError] = useState('');
  const canCreateProduct = storage.hasPermission('products.manage');

  // Adjustment Modal
  const [adjustingProduct, setAdjustingProduct] = useState<ProductItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('10');
  const [adjustType, setAdjustType] = useState<StockMovement['type']>('restock');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustError, setAdjustError] = useState('');

  const refreshData = () => {
    setProducts([...storage.getProducts()]);
    setMovements([...storage.getStockMovements()]);
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcode.includes(searchQuery);
    const matchesLowStock = !showLowStockOnly || p.stockOnHand <= p.reorderPoint;
    return matchesSearch && matchesLowStock;
  });

  const lowStockCount = products.filter(p => p.stockOnHand <= p.reorderPoint).length;
  const totalStockValue = products.reduce((acc, p) => acc + p.stockOnHand * p.costPrice, 0);
  const totalRetailValue = products.reduce((acc, p) => acc + p.stockOnHand * p.sellingPrice, 0);

  const handleApplyAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingProduct) return;
    try {
      const deltaText = stockDeltaText(adjustDelta, adjustType);
      if (!deltaText) throw new Error(adjustType === 'adjustment'
        ? 'Enter a non-zero signed quantity with up to six decimal places.'
        : 'Enter a positive quantity with up to six decimal places.');
      const balanceAfter = sumDecimalStrings([String(adjustingProduct.stockOnHand), deltaText]);
      if (balanceAfter.startsWith('-')) throw new Error('This change cannot reduce stock below zero.');
      const delta = Number(deltaText);
      if (!Number.isFinite(delta)) throw new Error('Enter a valid stock quantity.');
      storage.adjustStock(adjustingProduct.id, delta, adjustType, adjustNote || `${adjustType.toUpperCase()} manual adjustment`);
      setAdjustingProduct(null);
      setAdjustNote('');
      setAdjustError('');
      refreshData();
    } catch (error) {
      setAdjustError(error instanceof Error ? error.message : 'Could not update stock.');
    }
  };

  const handleCreateProduct = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateProduct) return;
    try {
      const name = newName.trim();
      const sku = newSku.trim();
      const barcode = newBarcode.trim();
      const unit = newUnit.trim();
      const reorderValid = /^\d+(?:\.\d{1,6})?$/.test(newReorderPoint.trim());
      if (!name || !sku || !unit) throw new Error('Enter an item name, SKU and unit.');
      if (!reorderValid) throw new Error('Enter a reorder point with up to six decimal places.');
      if (products.some(product => product.sku.toLowerCase() === sku.toLowerCase())) throw new Error('That SKU already exists.');
      if (barcode && products.some(product => product.barcode === barcode)) throw new Error('That barcode already exists.');
      const costMinor = moneyInputToMinor(newCostPrice || '0');
      const sellingMinor = moneyInputToMinor(newSellingPrice);
      if (sellingMinor <= 0) throw new Error('Selling price must be greater than zero.');

      storage.createProduct({
        name,
        sku,
        barcode,
        category: newCategory.trim() || 'GENERAL',
        unit,
        costPrice: costMinor / 100,
        sellingPrice: sellingMinor / 100,
        stockOnHand: 0,
        reorderPoint: Number(newReorderPoint),
      });
      refreshData();
      setAddItemOpen(false);
      setNewName(''); setNewSku(''); setNewBarcode(''); setNewCategory('GENERAL');
      setNewUnit('each'); setNewCostPrice(''); setNewSellingPrice(''); setNewReorderPoint('0');
      setAddItemError('');
    } catch (error) {
      setAddItemError(error instanceof Error ? error.message : 'Could not add this item.');
    }
  };

  if(apiClient.getSession()) return <BackendInventoryWorkspace tenant={tenant}/>;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-[#090b10] space-y-6 pb-20 lg:pb-6">
      {/* Inventory KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Active SKUs</div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-zinc-100 tabular-nums">
            {products.length}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Catalogue items</div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Stock Valuation (Cost)</div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-zinc-100 tabular-nums truncate">
            {tenant.currencySymbol} {totalStockValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">Acquisition asset value</div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Retail Valuation</div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-zinc-100 tabular-nums truncate">
            {tenant.currencySymbol} {totalRetailValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-emerald-400 mt-1">
            Margin: {totalStockValue > 0 ? `${Math.round(((totalRetailValue - totalStockValue) / totalRetailValue) * 100)}%` : '0%'}
          </div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="text-xs text-zinc-400 mb-1">Low-Stock Warnings</div>
          <div className={`text-xl sm:text-2xl font-bold font-mono tabular-nums ${lowStockCount > 0 ? 'text-amber-400' : 'text-zinc-100'}`}>
            {lowStockCount}
          </div>
          <div className="text-[10px] sm:text-[11px] text-zinc-500 mt-1">At/below reorder threshold</div>
        </div>
      </div>

      {/* Tabs and Search Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveTab('catalogue')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-h-[38px] ${
              activeTab === 'catalogue' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            SKU Catalogue ({products.length})
          </button>
          <button
            onClick={() => setActiveTab('movements')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-h-[38px] ${
              activeTab === 'movements' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Audit Movements ({movements.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canCreateProduct && activeTab === 'catalogue' && (
            <button
              type="button"
              onClick={() => { setAddItemError(''); setAddItemOpen(true); }}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
            >
              <Plus className="h-3.5 w-3.5" /> Add item
            </button>
          )}
          {activeTab === 'catalogue' && (
            <button
              onClick={() => setShowLowStockOnly(!showLowStockOnly)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors min-h-[38px] ${
                showLowStockOnly
                  ? 'bg-amber-950 border-amber-800 text-amber-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Low Stock ({lowStockCount})</span>
            </button>
          )}

          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search catalogue..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full sm:w-56 pl-9 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 min-h-[38px]"
            />
          </div>
        </div>
      </div>

      {addItemOpen && (
        <ResponsiveDialog
          isOpen={addItemOpen}
          onClose={() => setAddItemOpen(false)}
          title="Add catalogue item"
          subtitle="New items start with zero stock"
          icon={<Package className="h-5 w-5 text-blue-400" />}
          maxWidth="lg"
          footerActions={
            <>
              <button type="button" onClick={() => setAddItemOpen(false)} className="min-h-11 rounded-lg px-4 text-zinc-300 hover:bg-zinc-800">Cancel</button>
              <button type="submit" form="add-inventory-item-form" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500">
                <Plus className="h-4 w-4" /> Add item
              </button>
            </>
          }
        >
          <form id="add-inventory-item-form" onSubmit={handleCreateProduct} className="space-y-4">
            <p className="rounded-lg border border-blue-900/70 bg-blue-950/30 p-3 text-xs leading-relaxed text-blue-100">
              Add the item details here. To add quantity in this local preview, save the item and use <strong>Add stock / adjust</strong>. When connected to the backend, use Purchasing → Receive delivery for server-recorded stock.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-zinc-300">Item name<input required maxLength={160} autoFocus value={newName} onChange={event => setNewName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white" placeholder="e.g. Fresh Whole Milk 1L" /></label>
              <label className="block text-xs text-zinc-300">SKU<input required maxLength={64} value={newSku} onChange={event => setNewSku(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white" placeholder="e.g. RET-MILK-1L" /></label>
              <label className="block text-xs text-zinc-300">Barcode <span className="text-zinc-500">(optional)</span><input maxLength={64} value={newBarcode} onChange={event => setNewBarcode(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white" placeholder="Scan or enter barcode" /></label>
              <label className="block text-xs text-zinc-300">Category<input maxLength={80} value={newCategory} onChange={event => setNewCategory(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white" /></label>
              <label className="block text-xs text-zinc-300">Stock unit<input required maxLength={24} value={newUnit} onChange={event => setNewUnit(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white" placeholder="each, kg, litre" /></label>
              <label className="block text-xs text-zinc-300">Reorder point<input required inputMode="decimal" value={newReorderPoint} onChange={event => setNewReorderPoint(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white" /></label>
              <label className="block text-xs text-zinc-300">Unit cost ({tenant.currency})<input inputMode="decimal" value={newCostPrice} onChange={event => setNewCostPrice(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white" placeholder="0.00" /></label>
              <label className="block text-xs text-zinc-300">Selling price ({tenant.currency})<input required inputMode="decimal" value={newSellingPrice} onChange={event => setNewSellingPrice(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white" placeholder="0.00" /></label>
            </div>
            {addItemError && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{addItemError}</p>}
          </form>
        </ResponsiveDialog>
      )}

      {/* Main Content: Responsive Card View on Mobile, Table on Desktop */}
      {activeTab === 'catalogue' ? (
        <>
          {filteredProducts.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/70 p-6 text-center">
              <Package className="mx-auto h-8 w-8 text-zinc-500" />
              <h2 className="mt-3 text-sm font-semibold text-zinc-100">{products.length === 0 ? 'No inventory items yet' : 'No items match these filters'}</h2>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-400">{products.length === 0 ? 'Add a catalogue item to start. It begins at zero stock; use Add stock / adjust or Purchasing to record quantity.' : 'Clear the search or low-stock filter to see the catalogue again.'}</p>
              {products.length === 0 && canCreateProduct && <button type="button" onClick={() => { setAddItemError(''); setAddItemOpen(true); }} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500"><Plus className="h-4 w-4" /> Add first item</button>}
            </div>
          )}
          {/* MOBILE / NARROW TERMINAL VIEW (< md): Responsive Compact Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:hidden">
            {filteredProducts.map(p => {
              const isLow = p.stockOnHand <= p.reorderPoint;
              const marginPct = Math.round(((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100);

              return (
                <div
                  key={p.id}
                  className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-850 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-zinc-100 text-xs sm:text-sm truncate">
                        {p.name}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-500">
                        {p.sku} · {p.barcode}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${
                      isLow
                        ? 'bg-amber-950 text-amber-300 border border-amber-800'
                        : 'bg-zinc-900 text-zinc-300'
                    }`}>
                      {p.stockOnHand} {p.unit}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-zinc-900">
                    <div>
                      <span className="text-[10px] text-zinc-500 font-sans">Price: </span>
                      <span className="font-bold text-zinc-100 tabular-nums">
                        {tenant.currencySymbol} {p.sellingPrice.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 font-sans">Margin: </span>
                      <span className="text-emerald-400 tabular-nums">{marginPct}%</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setAdjustingProduct(p);
                      setAdjustDelta('10');
                      setAdjustType('restock');
                      setAdjustError('');
                    }}
                    className="w-full py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-blue-400 font-medium text-xs transition-colors min-h-[40px] flex items-center justify-center gap-1.5"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Add stock / adjust</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* DESKTOP VIEW (≥ md): Full Data Table */}
          <div className="hidden md:block border border-zinc-850 rounded-xl bg-zinc-950 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-zinc-850 text-zinc-500 font-mono text-[11px] bg-zinc-950/80">
                    <th className="p-3.5">SKU / BARCODE</th>
                    <th className="p-3.5">NAME & CATEGORY</th>
                    <th className="p-3.5 text-right">COST</th>
                    <th className="p-3.5 text-right">PRICE</th>
                    <th className="p-3.5 text-right">MARGIN</th>
                    <th className="p-3.5 text-right">ON HAND</th>
                    <th className="p-3.5 text-right">REORDER</th>
                    <th className="p-3.5 text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {filteredProducts.map(p => {
                    const isLow = p.stockOnHand <= p.reorderPoint;
                    const marginPct = Math.round(((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100);

                    return (
                      <tr key={p.id} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="p-3.5 font-mono">
                          <div className="font-semibold text-zinc-200">{p.sku}</div>
                          <div className="text-[10px] text-zinc-500">{p.barcode}</div>
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-zinc-100">{p.name}</div>
                          <div className="text-[10px] text-zinc-500 uppercase">{p.category}</div>
                        </td>
                        <td className="p-3.5 text-right font-mono text-zinc-400 tabular-nums">
                          {tenant.currencySymbol} {p.costPrice.toFixed(2)}
                        </td>
                        <td className="p-3.5 text-right font-mono font-bold text-zinc-100 tabular-nums">
                          {tenant.currencySymbol} {p.sellingPrice.toFixed(2)}
                        </td>
                        <td className="p-3.5 text-right font-mono text-emerald-400 tabular-nums">
                          {marginPct}%
                        </td>
                        <td className="p-3.5 text-right font-mono tabular-nums">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            isLow
                              ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                              : 'text-zinc-200'
                          }`}>
                            {p.stockOnHand} {p.unit}
                          </span>
                        </td>
                        <td className="p-3.5 text-right font-mono text-zinc-500 tabular-nums">
                          {p.reorderPoint} {p.unit}
                        </td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => {
                              setAdjustingProduct(p);
                              setAdjustDelta('10');
                              setAdjustType('restock');
                              setAdjustError('');
                            }}
                            className="px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-blue-400 hover:text-blue-300 font-medium transition-colors min-h-[32px]"
                          >
                            Add stock / adjust
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Movements Tab */
        <div className="border border-zinc-850 rounded-xl bg-zinc-950 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-zinc-850 text-zinc-500 font-mono text-[11px] bg-zinc-950/80">
                  <th className="p-3.5">TIMESTAMP</th>
                  <th className="p-3.5">PRODUCT</th>
                  <th className="p-3.5">TYPE</th>
                  <th className="p-3.5 text-right">QTY MOVED</th>
                  <th className="p-3.5 text-right">BALANCE AFTER</th>
                  <th className="p-3.5">AUDIT NOTE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-zinc-500">
                      No stock movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  movements.map(m => (
                    <tr key={m.id} className="hover:bg-zinc-900/40">
                      <td className="p-3.5 font-mono text-zinc-400 text-[11px] whitespace-nowrap">
                        {new Date(m.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-zinc-200">{m.productName}</div>
                        <div className="font-mono text-[10px] text-zinc-500">{m.sku}</div>
                      </td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          m.type === 'restock'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : m.type === 'sale'
                            ? 'bg-blue-950 text-blue-400 border border-blue-800'
                            : 'bg-amber-950 text-amber-400 border border-amber-800'
                        }`}>
                          {m.type}
                        </span>
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold tabular-nums">
                        <span className={m.quantity > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </span>
                      </td>
                      <td className="p-3.5 text-right font-mono text-zinc-200 tabular-nums">
                        {m.balanceAfter}
                      </td>
                      <td className="p-3.5 text-zinc-400">{m.note}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Responsive Adjust Stock Modal */}
      {adjustingProduct && (
        <ResponsiveDialog
          isOpen={!!adjustingProduct}
          onClose={() => setAdjustingProduct(null)}
          title="Adjust Stock Level"
          subtitle={`${adjustingProduct.name} (${adjustingProduct.sku})`}
          icon={<Sliders className="w-5 h-5 text-blue-400" />}
          footerActions={
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                type="button"
                onClick={() => setAdjustingProduct(null)}
                className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-xs min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyAdjustment}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-sm transition-colors min-h-[44px]"
              >
                Apply Stock Update
              </button>
            </div>
          }
        >
          <form onSubmit={handleApplyAdjustment} className="space-y-4">
            <div>
              <label className="block text-zinc-400 mb-1.5 text-xs">Adjustment Reason / Type</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustType('restock')}
                  className={`p-2.5 rounded-lg border text-center transition-colors min-h-[44px] ${
                    adjustType === 'restock'
                      ? 'bg-emerald-950 border-emerald-600 text-emerald-300 font-semibold'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  Restock (+)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustType('adjustment')}
                  className={`p-2.5 rounded-lg border text-center transition-colors min-h-[44px] ${
                    adjustType === 'adjustment'
                      ? 'bg-blue-950 border-blue-600 text-blue-300 font-semibold'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  Count Audit (±)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustType('damage')}
                  className={`p-2.5 rounded-lg border text-center transition-colors min-h-[44px] ${
                    adjustType === 'damage'
                      ? 'bg-rose-950 border-rose-600 text-rose-300 font-semibold'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  Damaged (-)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1 text-xs">
                Quantity ({adjustingProduct.unit})
              </label>
              <input
                type="text"
                inputMode="decimal"
                required
                value={adjustDelta}
                onChange={e => { setAdjustDelta(e.target.value); setAdjustError(''); }}
                placeholder={adjustType === 'adjustment' ? 'e.g. 2.5 or -1' : 'e.g. 2.5'}
                className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono text-base tabular-nums focus:outline-none focus:border-blue-500 min-h-[44px]"
              />
              <p className="mt-1 text-[11px] text-zinc-500">{adjustType === 'adjustment' ? 'Use a positive or negative change.' : 'Enter a positive quantity; up to six decimal places.'}</p>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1 text-xs">Audit Note / PO Reference</label>
              <input
                type="text"
                placeholder="e.g. Supplier Invoice #PO-9918"
                value={adjustNote}
                onChange={e => setAdjustNote(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-blue-500 min-h-[44px] text-xs"
              />
            </div>

            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex justify-between items-center text-xs">
              <span className="text-zinc-400">Current: {adjustingProduct.stockOnHand} {adjustingProduct.unit}</span>
              <span className="text-zinc-200 font-mono font-bold">
                New Balance: {sumDecimalStrings([String(adjustingProduct.stockOnHand), stockDeltaText(adjustDelta, adjustType) ?? '0'])} {adjustingProduct.unit}
              </span>
            </div>
            {adjustError && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{adjustError}</p>}
          </form>
        </ResponsiveDialog>
      )}
    </div>
  );
};
