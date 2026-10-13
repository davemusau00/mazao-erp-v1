import React, { useState } from 'react';
import { TenantProfile, ProductItem } from '../../types/erp';
import { storage } from '../../services/storage';
import { businessDateKey, formatBusinessDateLabel, shiftBusinessDate } from '../../utils/businessDate';
import {
  TrendingUp,
  BarChart3,
  DollarSign,
  Package,
  Layers,
  Flame,
  CircleHelp
} from 'lucide-react';

interface AnalyticsViewProps {
  currentTenant: TenantProfile;
  onOpenSales?: () => void;
}

type DateRangeFilter = 'today' | 'yesterday' | 'last7' | 'month' | 'all';

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ currentTenant, onOpenSales }) => {
  const [dateRange, setDateRange] = useState<DateRangeFilter>('last7');
  const orders = storage.getOrders();
  const products = storage.getProducts();

  const timeZone = currentTenant.timeZone ?? 'Africa/Nairobi';
  const todayKey = businessDateKey(new Date(), timeZone);
  const yesterdayKey = shiftBusinessDate(todayKey, -1);
  const monthPrefix = todayKey.slice(0, 7);
  const filteredOrders = orders.filter(order => {
    if (order.tenantId !== currentTenant.id || order.status === 'refunded') return false;
    const key = businessDateKey(order.timestamp, timeZone);
    if (dateRange === 'today') return key === todayKey;
    if (dateRange === 'yesterday') return key === yesterdayKey;
    if (dateRange === 'last7') return key >= shiftBusinessDate(todayKey, -6) && key <= todayKey;
    if (dateRange === 'month') return key.startsWith(monthPrefix);
    return true;
  });

  // Metrics Calculations
  const grossSales = filteredOrders.reduce((acc, o) => acc + o.total, 0);
  const netRevenue = filteredOrders.reduce((acc, o) => acc + o.subtotal, 0);
  const totalTax = filteredOrders.reduce((acc, o) => acc + o.tax, 0);

  // Approximate COGS from cart items
  const totalCogs = filteredOrders.reduce((acc, o) => {
    return (
      acc +
      o.items.reduce((itemAcc, item) => itemAcc + item.quantity * item.product.costPrice, 0)
    );
  }, 0);

  const grossProfit = netRevenue - totalCogs;
  const marginPercent = netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 100) : 0;
  const avgOrderValue = filteredOrders.length > 0 ? grossSales / filteredOrders.length : 0;

  // Inventory Turnover Rate
  const totalStockValuationCost = products.reduce((acc, p) => acc + p.stockOnHand * p.costPrice, 0);
  // Annualized turnover = (COGS for period / Avg Inventory) * (365 / daysInPeriod)
  const daysInPeriod = dateRange === 'today' || dateRange === 'yesterday' ? 1 : dateRange === 'last7' ? 7 : 30;
  const turnoverRatio = totalStockValuationCost > 0
    ? ((totalCogs / totalStockValuationCost) * (365 / daysInPeriod)).toFixed(1)
    : '0.0';

  // Group Sales by Day for Chart
  const salesByDay: Record<string, { label: string; total: number; orderCount: number }> = {};
  const dayBuckets = 7;
  for (let i = dayBuckets - 1; i >= 0; i--) {
    const key = shiftBusinessDate(todayKey, -i);
    const label = formatBusinessDateLabel(key, timeZone);
    salesByDay[key] = { label, total: 0, orderCount: 0 };
  }

  filteredOrders.forEach(o => {
    const key = businessDateKey(o.timestamp, timeZone);
    if (salesByDay[key]) {
      salesByDay[key].total += o.total;
      salesByDay[key].orderCount += 1;
    }
  });

  const chartData = Object.values(salesByDay);
  const maxDayTotal = Math.max(...chartData.map(d => d.total), 1);

  // Popular / Best Selling Products Aggregation
  const productSalesMap: Record<string, { product: ProductItem; units: number; revenue: number }> = {};
  filteredOrders.forEach(o => {
    o.items.forEach(item => {
      const pId = item.product.id;
      if (!productSalesMap[pId]) {
        productSalesMap[pId] = { product: item.product, units: 0, revenue: 0 };
      }
      productSalesMap[pId].units += item.quantity;
      productSalesMap[pId].revenue += item.quantity * item.unitPrice;
    });
  });

  const topProducts = Object.values(productSalesMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const maxProductRevenue = Math.max(...topProducts.map(p => p.revenue), 1);

  // Payment Breakdown
  const paymentSplits = filteredOrders.reduce((acc, o) => {
    acc[o.paymentMethod] = (acc[o.paymentMethod] || 0) + o.total;
    return acc;
  }, {} as Record<string, number>);

  const targetCurrency = currentTenant.currencySymbol;

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-[#090b10] space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-zinc-950 border border-zinc-850">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold text-zinc-100">
              Sales & Operations Overview
            </h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Local demo records for the selected period. Values may not represent a posted financial report.
          </p>
        </div>

        {/* Global Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Range Selector */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 text-xs">
            {[
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: 'last7', label: 'Last 7 Days' },
              { id: 'month', label: 'This Month' },
              { id: 'all', label: 'All Time' },
            ].map(r => (
              <button
                key={r.id}
                onClick={() => setDateRange(r.id as any)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors min-h-11 ${
                  dateRange === r.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-blue-900/60 bg-blue-950/30 px-4 py-3 text-xs text-blue-100 flex flex-wrap items-center justify-between gap-3">
        <span>Outlet day: {timeZone} · coverage: {filteredOrders.length} local sales records · COGS estimate uses stored item costs · ledger reconciliation is unavailable.</span>
        {onOpenSales && <button type="button" onClick={onOpenSales} className="min-h-11 rounded-lg border border-blue-800 px-3 font-semibold hover:bg-blue-900/50">Review sales history</button>}
      </div>

      {/* KPI Headline Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>Gross Sales Revenue</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100 tabular-nums">
            {targetCurrency} {grossSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
            <span className="text-emerald-400 font-semibold">{filteredOrders.length}</span> orders settled
          </div>
        </div>

        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>Estimated Gross Profit</span>
            <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-blue-400 tabular-nums">
            {targetCurrency} {grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1">
            Margin: <strong className="text-emerald-400 font-mono">{marginPercent}%</strong> of net revenue
          </div>
        </div>

        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>Estimated Turnover</span>
            <Package className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100 tabular-nums">
            {turnoverRatio}x <span className="text-xs font-normal text-zinc-500">/ yr</span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Estimate from current product costs
          </div>
        </div>

        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-850">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>Average Recorded Sale</span>
            <Layers className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100 tabular-nums">
            {targetCurrency} {avgOrderValue.toFixed(2)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Per basket average ticket size
          </div>
        </div>
      </div>

      {/* Visualizations Section: Daily Sales Bar Chart & Payment Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Sales Bar Chart (2 columns) */}
        <div className="lg:col-span-2 p-5 rounded-xl bg-zinc-950 border border-zinc-850 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Daily Sales Revenue Velocity</h3>
              <p className="text-xs text-zinc-500">Trailing day-by-day revenue intake across terminals</p>
            </div>
            <span className="text-xs font-mono text-zinc-400">
              Peak: {targetCurrency} {maxDayTotal.toFixed(0)}
            </span>
          </div>

          {/* SVG / Flex Bar Chart */}
          <div className="h-56 flex items-end justify-between gap-3 pt-6 pb-2 border-b border-zinc-850" role="img" aria-label={`Seven day local sales chart. ${chartData.map(day => `${day.label}: ${targetCurrency} ${day.total.toFixed(2)}`).join('; ')}`}>
            {chartData.map((d, idx) => {
              const heightPct = Math.max(8, Math.round((d.total / maxDayTotal) * 100));
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                  {/* Tooltip value */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-blue-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 whitespace-nowrap">
                    {targetCurrency} {d.total.toFixed(0)}
                  </div>
                  {/* Bar */}
                  <div
                    style={{ height: `${heightPct}%` }}
                    aria-hidden="true"
                    className="w-full max-w-[42px] rounded-t-md bg-blue-600/80 hover:bg-blue-500 transition-all relative"
                  />
                  {/* Date label */}
                  <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[48px] text-center">
                    {d.label.slice(0, 3)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-zinc-500 pt-1 font-mono">
            <span>7-Day Trading Total: {targetCurrency} {chartData.reduce((a, b) => a + b.total, 0).toFixed(2)}</span>
            <span>Tax Collected: {targetCurrency} {totalTax.toFixed(2)}</span>
          </div>
        </div>

        {/* Payment Channels & Margin Breakdown (1 column) */}
        <div className="p-5 rounded-xl bg-zinc-950 border border-zinc-850 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Tender & Revenue Split</h3>
            <p className="text-xs text-zinc-500">Cash vs Card vs Mobile vs Folios</p>
          </div>

          <div className="space-y-3">
            {[
              { id: 'cash', label: 'Cash Currency Till', color: 'bg-emerald-500' },
              { id: 'card', label: 'Card Merchant POS', color: 'bg-blue-500' },
              { id: 'mobile_money', label: 'Mobile Money Till', color: 'bg-purple-500' },
              { id: 'room_folio', label: 'Room Folios Billed', color: 'bg-amber-500' },
            ].map(channel => {
              const channelTotal = paymentSplits[channel.id] || 0;
              const pct = grossSales > 0 ? Math.round((channelTotal / grossSales) * 100) : 0;

              return (
                <div key={channel.id} className="space-y-1 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-300 flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${channel.color}`} />
                      {channel.label}
                    </span>
                    <span className="font-mono font-bold text-zinc-100 tabular-nums">
                      {targetCurrency} {channelTotal.toFixed(0)} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                    <div
                      style={{ width: `${pct}%` }}
                      className={`h-full rounded-full ${channel.color}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* COGS vs Profit split card */}
          <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 space-y-2 text-xs">
            <div className="flex justify-between text-zinc-400">
              <span>Cost of Goods Sold (COGS):</span>
              <span className="font-mono tabular-nums text-zinc-300">
                {targetCurrency} {totalCogs.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between font-semibold text-zinc-100">
              <span>Gross Margin Contribution:</span>
              <span className="font-mono text-emerald-400 tabular-nums">
                {targetCurrency} {grossProfit.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Popular Products & Inventory Turnover Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Popular Best-Selling Products */}
        <div className="p-5 rounded-xl bg-zinc-950 border border-zinc-850 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-zinc-100">Top Revenue-Generating SKUs</h3>
            </div>
            <span className="text-xs text-zinc-500 font-mono">Ranked by Gross Volume</span>
          </div>

          <div className="space-y-3">
            {topProducts.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">
                No product transactions recorded for selected period.
              </div>
            ) : (
              topProducts.map((item, idx) => {
                const widthPct = Math.round((item.revenue / maxProductRevenue) * 100);
                const margin = Math.round(((item.product.sellingPrice - item.product.costPrice) / item.product.sellingPrice) * 100);

                return (
                  <div key={item.product.id} className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-850 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-4 text-center font-mono text-zinc-500 text-[11px] font-bold">
                          #{idx + 1}
                        </span>
                        <div>
                          <span className="font-semibold text-zinc-200">{item.product.name}</span>
                          <span className="text-zinc-500 text-[10px] ml-2 font-mono">{item.product.sku}</span>
                        </div>
                      </div>
                      <div className="font-mono font-bold text-zinc-100 tabular-nums text-right">
                        {targetCurrency} {item.revenue.toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span>{item.units} {item.product.unit} sold · estimated {margin}% margin</span>
                      <span className="font-mono text-emerald-400">
                        Est.: {targetCurrency} {(item.units * (item.product.sellingPrice - item.product.costPrice)).toFixed(2)}
                      </span>
                    </div>

                    <div className="w-full h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                      <div
                        style={{ width: `${widthPct}%` }}
                        className="h-full rounded-full bg-blue-500"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Inventory Velocity & Stock Turnover Classification */}
        <div className="p-5 rounded-xl bg-zinc-950 border border-zinc-850 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100">Current Stock Snapshot</h3>
            <span className="text-xs text-zinc-500 font-mono">Catalog levels</span>
          </div>

          <div className="space-y-2 text-xs">
            {products.filter(product => product.stockOnHand <= product.reorderPoint).slice(0, 6).map(product => (
              <div key={product.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                <span className="truncate text-zinc-200">{product.name}</span>
                <span className="shrink-0 font-mono text-amber-300">{product.stockOnHand} {product.unit} · reorder {product.reorderPoint}</span>
              </div>
            ))}
            {products.filter(product => product.stockOnHand <= product.reorderPoint).length === 0 && <p className="rounded-lg bg-zinc-900/50 p-4 text-zinc-400">No products are at or below their configured reorder level.</p>}
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-900/40 border border-zinc-850 flex items-center justify-between text-xs">
            <div>
              <div className="font-semibold text-zinc-200">Report source status</div>
              <div className="text-[11px] text-zinc-500">Ledger coverage is not provided by local demo records</div>
            </div>
            <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[11px]">
              <CircleHelp className="w-4 h-4" />
              <span>Unavailable</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
