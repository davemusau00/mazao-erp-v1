import React from 'react';
import { AlertCircle, CheckCircle2, Download, Printer, RefreshCw, X } from 'lucide-react';
import type { BackendSaleReceipt } from '../../services/apiClient';

function money(minorText: string, currency: string) {
  const amount = BigInt(minorText);
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(digits);
  const absolute = amount < 0n ? -amount : amount;
  const major = absolute / scale;
  const fraction = absolute % scale;
  const formattedMajor = new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(major);
  return `${amount < 0n ? '-' : ''}${currency} ${formattedMajor}${digits ? `.${fraction.toString().padStart(digits, '0')}` : ''}`;
}

function formatDate(value: string, timeZone: string) {
  try { return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return value; }
}

function textReceipt(receipt: BackendSaleReceipt) {
  return [
    receipt.tenantName,
    receipt.outletName,
    `Receipt: ${receipt.receiptNumber}`,
    `Date: ${formatDate(receipt.createdAt, receipt.timeZone)}`,
    `Operator: ${receipt.operatorName}`,
    '',
    ...receipt.lines.map(line => `${line.name} | ${line.quantity} x ${money(line.unitPriceMinor, receipt.currency)} | tax ${(line.taxRateBps / 100).toFixed(2)}% ${money(line.taxMinor, receipt.currency)} | total ${money(line.totalMinor, receipt.currency)}`),
    '',
    `Subtotal: ${money(receipt.subtotalMinor, receipt.currency)}`,
    `Tax: ${money(receipt.taxMinor, receipt.currency)}`,
    `Total: ${money(receipt.totalMinor, receipt.currency)}`,
    `Paid: ${money(receipt.amountPaidMinor, receipt.currency)}`,
    ...(receipt.customerAccountCharge ? [`Charged to account: ${receipt.customerAccountCharge.customerName}`, `Amount due: ${money(receipt.customerAccountCharge.amountDueMinor, receipt.currency)}`] : []),
    ...(receipt.cashTenderedMinor === null ? [] : [`Cash received: ${money(receipt.cashTenderedMinor, receipt.currency)}`, `Change: ${money(receipt.changeMinor ?? '0', receipt.currency)}`]),
    '',
    'Sale receipt. Electronic tax invoice integration is not connected.',
  ].join('\n');
}

export function BackendReceiptModal({ receipt, loading, error, onRetry, onClose }: {
  receipt: BackendSaleReceipt | null; loading: boolean; error: string; onRetry: () => void; onClose: () => void;
}) {
  const download = () => {
    if (!receipt) return;
    const url = URL.createObjectURL(new Blob([textReceipt(receipt)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${receipt.receiptNumber}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="backend-receipt-title">
    <style>{`@media print { body * { visibility: hidden !important; } #backend-receipt-paper, #backend-receipt-paper * { visibility: visible !important; } #backend-receipt-paper { position: absolute; inset: 0 auto auto 0; width: 76mm; max-width: 76mm; border: 0; color: #111 !important; background: #fff !important; box-shadow: none !important; } #backend-receipt-actions, #backend-receipt-header { display: none !important; } }`}</style>
    <div className="my-6 flex max-h-[calc(100dvh-3rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
      <header id="backend-receipt-header" className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/70 px-5 py-4">
        <div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-400" size={20} /><div><h2 id="backend-receipt-title" className="font-semibold text-zinc-100">Sale confirmed</h2><p className="text-xs text-zinc-400">Receipt detail is loaded from the server record.</p></div></div>
        <button type="button" onClick={onClose} aria-label="Close receipt" className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"><X size={18} /></button>
      </header>

      <div className="overflow-y-auto bg-zinc-950 p-4 sm:p-6">
        {loading && <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-zinc-400"><RefreshCw className="animate-spin" size={17} />Loading confirmed receipt...</div>}
        {error && <div role="alert" className="mx-auto max-w-md rounded-xl border border-rose-900/70 bg-rose-950/40 p-4 text-sm text-rose-100"><div className="flex items-start gap-2"><AlertCircle className="mt-0.5 shrink-0" size={17} /><p>The sale is confirmed, but the server receipt could not be retrieved. The local basket is not used as a receipt record. {error}</p></div><button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-lg border border-rose-700 px-3 font-medium hover:bg-rose-900/50">Retry receipt lookup</button></div>}
        {receipt && !loading && <article id="backend-receipt-paper" className="mx-auto max-w-sm rounded-sm border-t-4 border-dashed border-zinc-400 bg-white p-5 font-mono text-[11px] leading-relaxed text-zinc-950 shadow-xl">
          <div className="text-center text-xs font-bold uppercase tracking-wide">{receipt.tenantName}</div>
          <div className="text-center text-[10px] text-zinc-700">{receipt.outletName}</div>
          <div className="text-center text-[9px] text-zinc-500">{receipt.currency} · {receipt.timeZone}</div>
          <div className="my-3 border-t border-dashed border-zinc-400" />
          <div className="flex justify-between gap-2"><span>RECEIPT</span><span className="break-all text-right">{receipt.receiptNumber}</span></div>
          <div className="mt-1 flex justify-between gap-2"><span>DATE</span><time dateTime={receipt.createdAt} className="text-right">{formatDate(receipt.createdAt, receipt.timeZone)}</time></div>
          <div className="mt-1 flex justify-between gap-2"><span>STAFF</span><span className="text-right">{receipt.operatorName}</span></div>
          <div className="my-3 border-t border-dashed border-zinc-400" />
          <div className="space-y-3">
            {receipt.lines.map(line => <div key={line.lineId} className="border-b border-dotted border-zinc-300 pb-2">
              <div className="font-bold">{line.name}</div><div className="text-[9px] text-zinc-600">{line.sku}</div>
              <div className="mt-1 flex justify-between gap-2"><span>{line.quantity} x {money(line.unitPriceMinor, receipt.currency)}</span><span>{money(line.subtotalMinor, receipt.currency)}</span></div>
              <div className="flex justify-between gap-2 text-zinc-600"><span>Tax {(line.taxRateBps / 100).toFixed(2)}%</span><span>{money(line.taxMinor, receipt.currency)}</span></div>
              <div className="flex justify-between gap-2 font-semibold"><span>Line total</span><span>{money(line.totalMinor, receipt.currency)}</span></div>
            </div>)}
          </div>
          <div className="my-2 border-t border-dashed border-zinc-400" />
          <dl className="space-y-1">
            <div className="flex justify-between gap-2"><dt>Subtotal</dt><dd>{money(receipt.subtotalMinor, receipt.currency)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Tax total</dt><dd>{money(receipt.taxMinor, receipt.currency)}</dd></div>
            <div className="flex justify-between gap-2 border-t border-zinc-300 pt-1 text-xs font-bold"><dt>TOTAL</dt><dd>{money(receipt.totalMinor, receipt.currency)}</dd></div>
            <div className="flex justify-between gap-2 pt-1"><dt>Paid</dt><dd>{money(receipt.amountPaidMinor, receipt.currency)}</dd></div>
            {receipt.customerAccountCharge && <><div className="flex justify-between gap-2"><dt>Customer account</dt><dd className="text-right">{receipt.customerAccountCharge.customerName}</dd></div><div className="flex justify-between gap-2 font-semibold"><dt>Account amount due</dt><dd>{money(receipt.customerAccountCharge.amountDueMinor, receipt.currency)}</dd></div></>}
            {receipt.cashTenderedMinor !== null && <><div className="flex justify-between gap-2"><dt>Cash received</dt><dd>{money(receipt.cashTenderedMinor, receipt.currency)}</dd></div><div className="flex justify-between gap-2"><dt>Change</dt><dd>{money(receipt.changeMinor ?? '0', receipt.currency)}</dd></div></>}
          </dl>
          <div className="my-3 border-t border-dashed border-zinc-400" />
          <div className="text-center text-[9px] text-zinc-600">SALE RECEIPT · ELECTRONIC TAX INVOICE INTEGRATION IS NOT CONNECTED</div>
          <div className="mt-2 break-all text-center text-[8px] text-zinc-400">Sale reference: {receipt.receiptId}</div>
        </article>}
      </div>

      <footer id="backend-receipt-actions" className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-900 p-4">
        <button type="button" onClick={download} disabled={!receipt || loading} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><Download className="mr-2 inline" size={15} />Download text</button>
        <div className="flex gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-lg px-3 text-sm text-zinc-300 hover:bg-zinc-800">Done</button><button type="button" onClick={() => window.print()} disabled={!receipt || loading} className="min-h-11 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:opacity-50"><Printer className="mr-2 inline" size={15} />Open print dialog</button></div>
      </footer>
      {receipt && <p className="px-4 pb-3 text-center text-[11px] text-zinc-500">Browser printing is not printer-device acknowledgement.</p>}
    </div>
  </div>;
}
