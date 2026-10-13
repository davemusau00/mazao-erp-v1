import React from 'react';
import { ArrowUpRight, CircleAlert, Clock3, PackageCheck, ShoppingBag } from 'lucide-react';
import { TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import { WorkspaceHeading, SummaryMetric, NextStepCard } from '../common/WorkspacePrimitives';
import type { WorkspaceId } from '../../types/ui';

export function TodayWorkspace({ tenant, onNavigate }: { tenant: TenantProfile; onNavigate: (workspace: WorkspaceId) => void }) {
  const shift = storage.getActiveShift();
  const timeZone = tenant.timeZone ?? 'Africa/Nairobi';
  const businessDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const orders = storage.getOrders().filter(order => order.tenantId === tenant.id && businessDay(new Date(order.timestamp)) === businessDay(new Date()));
  const products = storage.getProducts();
  const lowStock = products.filter(item => item.stockOnHand <= item.reorderPoint);
  const rooms = storage.getRooms();
  const occupied = rooms.filter(room => room.status === 'occupied').length;
  const total = orders.reduce((sum, order) => sum + order.total, 0);
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: tenant.currency, maximumFractionDigits: 0 });

  return <div className="page-stack">
    <WorkspaceHeading eyebrow="YOUR BUSINESS · TODAY" title={`Good ${localHour < 12 ? 'morning' : localHour < 18 ? 'afternoon' : 'evening'}, ${storage.getActiveStaff().name.split(' ')[0]}`} description={`${tenant.outletName ?? tenant.name} · ${new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}`} action={<span className="local-data-badge"><span /> Local demo data</span>} />
    <div className="metrics-grid">
      <SummaryMetric label="Sales today" value={money.format(total)} detail={`${orders.length} completed ${orders.length === 1 ? 'sale' : 'sales'}`} tone="positive" />
      <SummaryMetric label="Current shift" value={shift ? 'Open' : 'Not open'} detail={shift ? `Started ${new Date(shift.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Open a till to start selling'} tone={shift ? 'positive' : 'warning'} />
      <SummaryMetric label="Items to check" value={lowStock.length} detail="At or below reorder level" tone={lowStock.length ? 'warning' : 'default'} />
      {rooms.length > 0 && <SummaryMetric label="Rooms occupied" value={`${occupied} / ${rooms.length}`} detail="Current room status" />}
    </div>

    {!shift && <div className="attention-banner"><CircleAlert size={18} /><span><strong>No shift is open.</strong> Open a till before completing a sale.</span><button type="button" onClick={() => onNavigate('shifts')}>Open shifts <ArrowUpRight size={15} /></button></div>}
    {shift && lowStock.length > 0 && <div className="attention-banner warning-banner"><PackageCheck size={18} /><span><strong>{lowStock.length} items need attention.</strong> Review stock before the next busy period.</span><button type="button" onClick={() => onNavigate('stock')}>Review stock <ArrowUpRight size={15} /></button></div>}

    <section className="workspace-section"><div className="section-heading"><div><h2>Get something done</h2><p>Shortcuts for the work you do most.</p></div></div>
      <div className="next-step-grid">
        <NextStepCard title="Start a sale" detail="Scan, search, and take payment" label="Sell" onClick={() => onNavigate('sell')} />
        <NextStepCard title="Check stock" detail="Review item levels and movements" label="Stock" onClick={() => onNavigate('stock')} />
        <NextStepCard title="Close your shift" detail="Count cash and review the total" label="Shifts" onClick={() => onNavigate('shifts')} />
        {(tenant.type === 'hospitality' || tenant.type === 'restaurant') && <NextStepCard title="Guest operations" detail="Rooms, arrivals, and guest bills" label="Hotel" onClick={() => onNavigate('hotel')} />}
      </div>
    </section>

    <section className="workspace-section"><div className="section-heading"><div><h2>Recent activity</h2><p>Sales recorded on this device today.</p></div><button type="button" className="text-action" onClick={() => onNavigate('sales')}>View sales <ArrowUpRight size={15} /></button></div>
      {orders.length === 0 ? <div className="activity-empty"><ShoppingBag size={18} /><span>No sales recorded today.</span></div> : <div className="activity-list">{orders.slice(0, 5).map(order => <div className="activity-row" key={order.id}><div className="activity-mark"><ShoppingBag size={15} /></div><div className="activity-main"><strong>{order.orderNumber}</strong><small>{new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {order.cashierName}</small></div><strong className="activity-value">{money.format(order.total)}</strong><span className="mini-status pending">Local preview · not server-confirmed</span></div>)}</div>}
    </section>
    <div className="prototype-footnote"><Clock3 size={14} /><span>Summary uses this device’s local demo data. Totals may not represent a server-confirmed report.</span></div>
  </div>;
}
