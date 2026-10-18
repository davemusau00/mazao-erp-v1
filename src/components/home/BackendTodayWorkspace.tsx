import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock3, Hotel, Package, ShoppingCart, Truck } from 'lucide-react';
import type { ActiveTab } from '../layout/AppShell';
import { apiClient, type BackendShift } from '../../services/apiClient';
import { formatMinorMoney } from '../../utils/money';

type Shortcut = { id: ActiveTab; title: string; detail: string; icon: React.ReactNode };

export function BackendTodayWorkspace({ onNavigate }: { onNavigate: (tab: ActiveTab) => void }) {
  const session = apiClient.getSession()!;
  const permissions = session.user.permissions;
  const has = (...requested: string[]) => requested.some(permission => permissions.includes(permission));
  const canSell = has('commerce.sell');
  const canShift = has('shift.open', 'shift.close');
  const hasStock = has('catalog.manage', 'inventory.receive');
  const hasHotel = session.tenant.capabilities.includes('hospitality')
    && has('hotel.frontdesk', 'hotel.manage', 'hotel.housekeeping');
  const canReceive = has('inventory.receive');
  const [shift, setShift] = useState<BackendShift | null>(null);
  const [loading, setLoading] = useState(canShift);
  const [error, setError] = useState('');
  const loadGeneration=useRef(0);
  const loadController=useRef<AbortController|null>(null);

  const loadShift=async()=>{
    loadController.current?.abort();
    const requestController=new AbortController();loadController.current=requestController;
    const generation=++loadGeneration.current;
    setLoading(true);setError('');
    try {
      const result=await apiClient.getCurrentShift(requestController.signal);
      if(generation===loadGeneration.current)setShift(result.shift);
    } catch(cause) {
      if(generation===loadGeneration.current&&(cause as {code?:string}).code!=='REQUEST_CANCELLED')setError(cause instanceof Error ? cause.message : 'Shift status could not be loaded.');
    } finally {
      if(generation===loadGeneration.current)setLoading(false);
      if(loadController.current===requestController)loadController.current=null;
    }
  };
  useEffect(() => {
    if (!canShift) return;
    void loadShift();
    return () => {loadGeneration.current++;loadController.current?.abort();};
  }, [canShift]);

  const shortcuts: Shortcut[] = [
    ...(canSell ? [{ id: 'sell' as const, title: 'Start a sale', detail: 'Choose items and take payment.', icon: <ShoppingCart size={18} /> }] : []),
    ...(hasStock ? [{ id: 'stock' as const, title: 'Review stock', detail: 'Check the item catalogue and movement history.', icon: <Package size={18} /> }] : []),
    ...(canReceive ? [{ id: 'purchasing' as const, title: 'Receive delivery', detail: 'Review a delivery before posting stock.', icon: <Truck size={18} /> }] : []),
    ...(hasHotel ? [{ id: 'hotel' as const, title: 'Open hotel tasks', detail: 'Rooms, guest stays and housekeeping.', icon: <Hotel size={18} /> }] : []),
    ...(canShift ? [{ id: 'shifts' as const, title: 'Cash-up and shifts', detail: 'Open your till or complete cash-up.', icon: <Clock3 size={18} /> }] : []),
  ];

  return <main className="min-h-full space-y-6 overflow-y-auto p-4 pb-24 text-zinc-100 sm:p-6">
    <header>
      <p className="text-xs tracking-[.18em] text-blue-300">TODAY · {session.outlet.name.toUpperCase()}</p>
      <h1 className="mt-2 text-3xl font-bold">Good day, {session.user.name.split(' ')[0]}</h1>
      <p className="mt-2 text-sm text-zinc-400">{session.tenant.name} · {session.tenant.currency} · {(session.outlet.timeZone ?? session.tenant.timeZone)}</p>
    </header>

    {canShift && <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5" aria-labelledby="today-shift-title">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-zinc-500">Till status</p><h2 id="today-shift-title" className="mt-1 text-xl font-semibold">{loading ? 'Checking your shift…' : shift ? 'Your shift is open' : 'No open shift'}</h2><p className="mt-1 text-sm text-zinc-400">{shift ? `Opened ${new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: (session.outlet.timeZone ?? session.tenant.timeZone) })}` : 'Open a shift before taking cash payments.'}</p></div><button onClick={() => onNavigate('shifts')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold">{shift ? 'Review shift' : 'Open a shift'}<ArrowRight size={16} /></button></div>
      {shift && <div className="mt-5 grid gap-3 sm:grid-cols-3"><Metric label="Opening float" value={formatMinorMoney(shift.openingFloatMinor, session.tenant.currency)} /><Metric label="Cash sales" value={formatMinorMoney(shift.cashSalesMinor, session.tenant.currency)} /><Metric label="Expected cash" value={formatMinorMoney(shift.expectedCashMinor, session.tenant.currency)} /></div>}
      {error && <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-rose-300"><span>{error}</span><button type="button" disabled={loading} onClick={()=>void loadShift()} className="min-h-11 underline">Retry shift status</button></div>}
    </section>}

    <section aria-labelledby="today-actions-title"><div className="mb-3"><p className="text-xs uppercase tracking-widest text-zinc-500">Your work</p><h2 id="today-actions-title" className="mt-1 text-xl font-semibold">Common tasks</h2></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shortcuts.map(item => <button key={item.id} onClick={() => onNavigate(item.id)} className="flex min-h-28 items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-left transition hover:border-blue-700 hover:bg-zinc-900"><span className="rounded-xl bg-zinc-900 p-3 text-blue-300">{item.icon}</span><span className="flex-1"><strong className="block">{item.title}</strong><small className="mt-1 block text-sm text-zinc-400">{item.detail}</small></span><ArrowRight size={16} className="mt-1 shrink-0 text-zinc-500" /></button>)}</div></section>

    <p className="rounded-xl border border-emerald-900/70 bg-emerald-950/20 p-3 text-sm text-emerald-200">Check the outlet shown above before starting work.</p>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"><p className="text-xs text-zinc-400">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>;
}
