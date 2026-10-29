import type { RestaurantOrderTicket } from '../../types/restaurantOrders';
import { formatDecimalQuantity } from '../../utils/money';

export function RestaurantTicketCards({tickets,timeZone}:{tickets:RestaurantOrderTicket[];timeZone:string}){
  return <div className="grid gap-3 lg:grid-cols-2">{tickets.map(ticket=><article key={ticket.id} className="min-w-0 space-y-3 rounded-xl border border-zinc-700 bg-zinc-950 p-4">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-300">{ticket.type==='ADD_ON'?'Add-on':'New'} {ticket.stationKind==='BAR'?'bar':'kitchen'} ticket</p><h3 className="mt-1 break-words text-lg font-semibold">{ticket.stationName}</h3><p className="mt-1 text-sm text-zinc-300">{ticket.snapshot.tableName??'Takeaway / counter'} · {ticket.snapshot.serviceLabel}</p><p className="mt-1 text-xs text-zinc-400">{new Date(ticket.snapshot.firedAt).toLocaleString(undefined,{timeZone})} · {ticket.snapshot.waiter.name}</p></div>
    {ticket.snapshot.orderInstructions&&<p className="break-words rounded-lg border border-amber-900 p-2 text-sm text-amber-100">{ticket.snapshot.orderInstructions}</p>}
    <ul className="space-y-3">{ticket.snapshot.lines.map(line=><li key={line.lineId} className="border-t border-zinc-800 pt-3"><p className="break-words font-semibold">{formatDecimalQuantity(line.quantity)} × {line.preparationLabel||line.name}</p>{line.preparationInstructions&&<p className="mt-1 break-words text-sm text-zinc-300">{line.preparationInstructions}</p>}{line.modifiers.length>0&&<p className="mt-1 break-words text-sm text-amber-100">{line.modifiers.join(' · ')}</p>}{line.instructions&&<p className="mt-1 break-words text-sm text-amber-100">{line.instructions}</p>}</li>)}</ul>
    <p className="text-xs text-zinc-400">Saved ticket. Delivery, paper output and preparation are unconfirmed.</p>
    <details className="text-xs text-zinc-500"><summary className="min-h-11 cursor-pointer py-3">Ticket support references</summary><p className="break-all">Ticket: {ticket.id}</p><p className="mt-1 break-all">Batch: {ticket.batchId}</p><p className="mt-1 break-all">Document hash: {ticket.documentHash}</p></details>
  </article>)}</div>;
}
