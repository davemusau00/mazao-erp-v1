import React, { useState } from 'react';
import { ProductItem, StockMovement, TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
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

interface InventoryViewProps {
  tenant: TenantProfile;
}

export const InventoryView: React.FC<InventoryViewProps> = ({ tenant }) => {
  const [products, setProducts] = useState<ProductItem[]>(storage.getProducts());
  const [movements, setMovements] = useState<StockMovement[]>(storage.getStockMovements());
  const [activeTab, setActiveTab] = useState<'catalogue' | 'movements'>('catalogue');
  const [searchQuery, setSearchQuery] = useState('');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  // Adjustment Modal
  const [adjustingProduct, setAdjustingProduct] = useState<ProductItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<number>(10);
  const [adjustType, setAdjustType] = useState<StockMovement['type']>('restock');
  const [adjustNote, setAdjustNote] = useState('');

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

    const delta = adjustType === 'damage' ? -Math.abs(adjustDelta) : adjustDelta;
    storage.adjustStock(
      adjustingProduct.id,
      delta,
      adjustType,
      adjustNote || `${adjustType.toUpperCase()} manual adjustment`
    );

    setAdjustingProduct(null);
    setAdjustNote('');
    refreshData();
  };

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

        <div className="flex items-center gap-2.5">
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

      {/* Main Content: Responsive Card View on Mobile, Table on Desktop */}
      {activeTab === 'catalogue' ? (
        <>
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
                      setAdjustDelta(10);
                      setAdjustType('restock');
                    }}
                    className="w-full py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-blue-400 font-medium text-xs transition-colors min-h-[40px] flex items-center justify-center gap-1.5"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Adjust Stock Balance</span>
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
                              setAdjustDelta(10);
                              setAdjustType('restock');
                            }}
                            className="px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-blue-400 hover:text-blue-300 font-medium transition-colors min-h-[32px]"
                          >
                            Adjust
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
                type="number"
                step="1"
                required
                value={adjustDelta}
                onChange={e => setAdjustDelta(parseInt(e.target.value) || 0)}
                className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono text-base tabular-nums focus:outline-none focus:border-blue-500 min-h-[44px]"
              />
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
                New Balance: {adjustType === 'damage' ? adjustingProduct.stockOnHand - Math.abs(adjustDelta) : adjustingProduct.stockOnHand + adjustDelta} {adjustingProduct.unit}
              </span>
            </div>
          </form>
        </ResponsiveDialog>
      )}
    </div>
  );
};
