import React, { useEffect, useState } from 'react';
import { ArrowRight, Clock3, Hotel, Package, ShoppingCart, Truck } from 'lucide-react';
import type { ActiveTab } from '../layout/AppShell';
import { apiClient, type BackendShift } from '../../services/apiClient';
import { formatMinorMoney } from '../../utils/money';

type Shortcut = { id: ActiveTab; title: string; detail: string; icon: React.ReactNode };

export function BackendTodayWorkspace({ onNavigate }: { onNavigate: (tab: ActiveTab) => void }) {
  const session = apiClient.getSession()!;
  const role = session.user.role;
  const canSell = ['admin', 'owner', 'manager', 'cashier'].includes(role);
  const canShift = ['admin', 'owner', 'manager', 'cashier', 'receptionist'].includes(role);
  const hasStock = ['admin', 'owner', 'manager', 'storekeeper'].includes(role);
  const hasHotel = session.tenant.capabilities.includes('hospitality')
    && ['admin', 'owner', 'manager', 'receptionist', 'housekeeper'].includes(role);
  const [shift, setShift] = useState<BackendShift | null>(null);
  const [loading, setLoading] = useState(canShift);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canShift) return;
    let active = true;
    void apiClient.getCurrentShift().then(result => {
      if (active) setShift(result.shift);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Shift status could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [canShift]);

  const shortcuts: Shortcut[] = [
    ...(canSell ? [{ id: 'sell' as const, title: 'Start a sale', detail: 'Open the server catalog and current till.', icon: <ShoppingCart size={18} /> }] : []),
    ...(hasStock ? [{ id: 'stock' as const, title: 'Review stock', detail: 'Check the item catalogue and movement history.', icon: <Package size={18} /> }] : []),
    ...(role === 'admin' || role === 'owner' || role === 'manager' || role === 'storekeeper' ? [{ id: 'purchasing' as const, title: 'Receive delivery', detail: 'Review a delivery before posting stock.', icon: <Truck size={18} /> }] : []),
    ...(hasHotel ? [{ id: 'hotel' as const, title: 'Open hotel tasks', detail: 'Rooms, guest stays and housekeeping.', icon: <Hotel size={18} /> }] : []),
    ...(canShift ? [{ id: 'shifts' as const, title: 'Cash-up and shifts', detail: 'Open or close your server till.', icon: <Clock3 size={18} /> }] : []),
  ];

  return <main className="min-h-full space-y-6 overflow-y-auto p-4 pb-24 text-zinc-100 sm:p-6">
    <header>
      <p className="text-xs tracking-[.18em] text-blue-300">SERVER TODAY · {session.outlet.name.toUpperCase()}</p>
      <h1 className="mt-2 text-3xl font-bold">Good day, {session.user.name.split(' ')[0]}</h1>
      <p className="mt-2 text-sm text-zinc-400">{session.tenant.name} · {session.tenant.currency} · {session.tenant.timeZone}</p>
    </header>

    {canShift && <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5" aria-labelledby="today-shift-title">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-zinc-500">Till status</p><h2 id="today-shift-title" className="mt-1 text-xl font-semibold">{loading ? 'Checking your shift…' : shift ? 'Your shift is open' : 'No open shift'}</h2><p className="mt-1 text-sm text-zinc-400">{shift ? `Opened ${new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: session.tenant.timeZone })}` : 'Open a shift before taking cash payments.'}</p></div><button onClick={() => onNavigate('shifts')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold">{shift ? 'Review shift' : 'Open a shift'}<ArrowRight size={16} /></button></div>
      {shift && <div className="mt-5 grid gap-3 sm:grid-cols-3"><Metric label="Opening float" value={formatMinorMoney(shift.openingFloatMinor, session.tenant.currency)} /><Metric label="Cash sales" value={formatMinorMoney(shift.cashSalesMinor, session.tenant.currency)} /><Metric label="Expected cash" value={formatMinorMoney(shift.expectedCashMinor, session.tenant.currency)} /></div>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    </section>}

    <section aria-labelledby="today-actions-title"><div className="mb-3"><p className="text-xs uppercase tracking-widest text-zinc-500">Your work</p><h2 id="today-actions-title" className="mt-1 text-xl font-semibold">Common tasks</h2></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shortcuts.map(item => <button key={item.id} onClick={() => onNavigate(item.id)} className="flex min-h-28 items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-left transition hover:border-blue-700 hover:bg-zinc-900"><span className="rounded-xl bg-zinc-900 p-3 text-blue-300">{item.icon}</span><span className="flex-1"><strong className="block">{item.title}</strong><small className="mt-1 block text-sm text-zinc-400">{item.detail}</small></span><ArrowRight size={16} className="mt-1 shrink-0 text-zinc-500" /></button>)}</div></section>

    <p className="rounded-xl border border-emerald-900/70 bg-emerald-950/20 p-3 text-sm text-emerald-200">This workspace is using the authenticated server outlet. Only confirmed API results are shown here; local demo records are not included.</p>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"><p className="text-xs text-zinc-400">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>;
}
