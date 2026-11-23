import type { RestaurantPrintJob } from '../../types/restaurantOrders';
import { formatDecimalQuantity } from '../../utils/money';

export function RestaurantPrintDocument({job,timeZone}:{job:RestaurantPrintJob;timeZone:string}){
  const ticket=job.documentSnapshot,copy=job.jobType==='COPY';
  const label=copy?`REPRINT COPY ${job.copyNumber}`:job.jobType==='ADD_ON'?'ADD-ON TICKET':'NEW ORDER';
  const printedAt=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone}).format(new Date(ticket.firedAt));
  const fontSize=ticket.station.charactersPerLine>=58?'8pt':ticket.station.charactersPerLine>=48?'9pt':'10pt';
  return <>
    <style>{`
      #restaurant-print-document { display:none; }
      @page { margin:2mm; }
      @media print {
        body * { visibility:hidden !important; }
        #restaurant-print-document,#restaurant-print-document * { visibility:visible !important; }
        #restaurant-print-document { display:block !important; position:absolute; inset:0 auto auto 0; width:76mm; margin:0; padding:0; color:#000; background:#fff; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:${fontSize}; line-height:1.25; overflow-wrap:anywhere; }
        #restaurant-print-document h1 { font-size:14pt; text-align:center; margin:0 0 4mm; }
        #restaurant-print-document .rule { border-top:1px dashed #000; margin:2mm 0; }
        #restaurant-print-document .line { break-inside:avoid; padding:1mm 0; }
      }
    `}</style>
    <article id="restaurant-print-document" aria-label="80 mm restaurant ticket print preview" data-testid="restaurant-print-document" style={{fontSize}}>
      <h1>{label}</h1>
      <p><strong>{ticket.station.kind} · {ticket.station.name}</strong></p>
      <p>{ticket.tableName??'Takeaway / counter'} · {ticket.serviceLabel}</p>
      <p>Ticket {ticket.ticketId.slice(0,8).toUpperCase()} · {printedAt}</p>
      <p>Waiter: {ticket.waiter.name}</p>
      {ticket.orderInstructions&&<p>Order note: {ticket.orderInstructions}</p>}
      <div className="rule"/>
      {ticket.lines.map(line=><section className="line" key={line.lineId}>
        <p><strong>{formatDecimalQuantity(line.quantity)} × {line.preparationLabel||line.name}</strong></p>
        {line.preparationInstructions&&<p>{line.preparationInstructions}</p>}
        {line.modifiers.map(modifier=><p key={modifier}>• {modifier}</p>)}
        {line.instructions&&<p>Note: {line.instructions}</p>}
      </section>)}
      <div className="rule"/>
      <p>Paper output must be checked by the operator.</p>
      {copy&&<p>Original ticket hash: {job.documentHash}</p>}
    </article>
  </>;
}
