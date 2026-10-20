import React from 'react';
import { AlertCircle, CheckCircle2, Download, Printer, RefreshCw, X } from 'lucide-react';
import type { BackendSaleReceipt } from '../../services/apiClient';
import { safeRasterImageSource } from '../../utils/html';
import { formatDecimalQuantity, formatMinorMoneyText } from '../../utils/money';
import { displayOrderNumber, formatReceiptDate, textReceipt } from '../../utils/receipt';

const money = formatMinorMoneyText;

export function BackendReceiptModal({ receipt, loading, error, onRetry, onClose }: {
  receipt: BackendSaleReceipt | null; loading: boolean; error: string; onRetry: () => void; onClose: () => void;
}) {
  // Existing receipts with an empty snapshot retain their historical content.
  const profile = receipt?.receiptProfile ?? {};
  // JSX performs HTML escaping. Use the shared validator as a gate, then pass the
  // original URL to React to avoid encoding a URL twice.
  const logoUrl = typeof profile.logoUrl === 'string' && safeRasterImageSource(profile.logoUrl) ? profile.logoUrl.trim() : '';
  const qrImage = profile.showQrOnReceipt !== false && typeof profile.receiptQrImage === 'string' && safeRasterImageSource(profile.receiptQrImage) ? profile.receiptQrImage.trim() : '';
  const download = () => {
    if (!receipt) return;
    const url = URL.createObjectURL(new Blob([textReceipt(receipt)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `ORDER-${displayOrderNumber(receipt)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="backend-receipt-title">
    <style>{`@page { size: 76mm auto; margin: 3mm; } @media print { body * { visibility: hidden !important; } #backend-receipt-paper, #backend-receipt-paper * { visibility: visible !important; } #backend-receipt-paper { position: absolute; inset: 0 auto auto 0; width: 76mm; max-width: 76mm; box-sizing: border-box; border: 0; color: #111 !important; background: #fff !important; box-shadow: none !important; padding: 3mm !important; } #backend-receipt-actions, #backend-receipt-header, #backend-receipt-print-note { display: none !important; } }`}</style>
    <div className="my-6 flex max-h-[calc(100dvh-3rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
      <header id="backend-receipt-header" className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/70 px-5 py-4">
        <div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-400" size={20} /><div><h2 id="backend-receipt-title" className="font-semibold text-zinc-100">Sale confirmed</h2><p className="text-xs text-zinc-400">Review, download or print your receipt.</p></div></div>
        <button type="button" onClick={onClose} aria-label="Close receipt" className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"><X size={18} /></button>
      </header>

      <div className="overflow-y-auto bg-zinc-950 p-4 sm:p-6">
        {loading && <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-zinc-400"><RefreshCw className="animate-spin" size={17} />Loading confirmed receipt...</div>}
        {error && <div role="alert" className="mx-auto max-w-md rounded-xl border border-rose-900/70 bg-rose-950/40 p-4 text-sm text-rose-100"><div className="flex items-start gap-2"><AlertCircle className="mt-0.5 shrink-0" size={17} /><p>Your sale is confirmed, but we could not load its receipt. Do not take payment again. {error}</p></div><button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-lg border border-rose-700 px-3 font-medium hover:bg-rose-900/50">Try again</button></div>}
        {receipt && !loading && <article id="backend-receipt-paper" className="mx-auto w-full max-w-[320px] border-x border-dashed border-zinc-300 border-t-4 bg-white px-4 py-5 font-mono text-[11px] leading-relaxed text-zinc-950 shadow-xl">
          {logoUrl && <img src={logoUrl} alt={`${receipt.tenantName} logo`} referrerPolicy="no-referrer" className="mx-auto mb-2 max-h-16 max-w-40 object-contain" />}
          <div className="text-center text-xs font-bold uppercase tracking-wide">{receipt.tenantName}</div>
          <div className="text-center text-[10px] text-zinc-700">{receipt.outletName}</div>
          {profile.legalName && <div className="text-center text-[10px]">{profile.legalName}</div>}
          {profile.registrationNumber && <div className="text-center text-[9px]">Registration: {profile.registrationNumber}</div>}
          {profile.taxRegistrationNumber && <div className="text-center text-[9px]">Tax registration: {profile.taxRegistrationNumber}</div>}
          {profile.address && <div className="whitespace-pre-line text-center text-[9px]">{profile.address}</div>}
          {[profile.phone, profile.email, profile.website].filter(Boolean).map((value, index) => <div key={index} className="break-words text-center text-[9px]">{value}</div>)}
          {profile.receiptHeader && <div className="mt-2 whitespace-pre-line text-center text-[10px]">{profile.receiptHeader}</div>}
          <div className="text-center text-[9px] text-zinc-500">{receipt.currency} · {receipt.timeZone}</div>
          <div className="my-3 border-t-2 border-dashed border-zinc-500" />
          <div className="flex justify-between gap-2">
            <span>ORDER</span>
            <span className="font-bold">#{displayOrderNumber(receipt)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-2"><span>DATE</span><time dateTime={receipt.createdAt} className="text-right">{formatReceiptDate(receipt.createdAt, receipt.timeZone)}</time></div>
          <div className="mt-1 flex justify-between gap-2"><span>CASHIER</span><span className="text-right">{receipt.operatorName}</span></div>
          <div className="my-3 border-t border-dashed border-zinc-400" />
          <div className="space-y-2">
            {receipt.lines.map(line => (
              <div key={line.lineId} className="border-b border-dotted border-zinc-300 py-1.5">
                <div className="break-words font-semibold">{line.name}</div>
                <div className="mt-0.5 flex justify-between gap-2 tabular-nums">
                  <span>{formatDecimalQuantity(line.quantity)}{' × '}{money(line.unitPriceMinor, receipt.currency)}</span>
                  <span className="shrink-0 text-right font-medium">{money(line.subtotalMinor, receipt.currency)}</span>
                </div>
                {line.unrecordedQuantity&&line.unrecordedQuantity!=='0'&&<div className="mt-1 text-[10px] text-amber-800">Recorded stock was short by {formatDecimalQuantity(line.unrecordedQuantity)}; physical availability was confirmed.</div>}
                {BigInt(line.discountMinor ?? '0') > 0n && <div className="mt-1 text-[10px] text-zinc-600"><div>Original value {money(line.originalSubtotalMinor ?? (BigInt(line.subtotalMinor) + BigInt(line.discountMinor ?? '0')).toString(), receipt.currency)}</div><div>Item discount {money(line.discountMinor!, receipt.currency)}{line.discountReason ? ` · ${line.discountReason}` : ''}</div></div>}
              </div>
            ))}
          </div>
          <div className="my-2 border-t border-dashed border-zinc-400" />
          <dl className="space-y-1">
            {BigInt(receipt.discountMinor ?? '0') > 0n && <><div className="flex justify-between gap-2"><dt>Items before discounts</dt><dd>{money(receipt.originalSubtotalMinor ?? (BigInt(receipt.subtotalMinor) + BigInt(receipt.discountMinor ?? '0')).toString(), receipt.currency)}</dd></div><div className="flex justify-between gap-2"><dt>Item discounts</dt><dd>−{money(receipt.discountMinor!, receipt.currency)}</dd></div></>}
            <div className="flex justify-between gap-2"><dt>Subtotal</dt><dd>{money(receipt.subtotalMinor, receipt.currency)}</dd></div>
            <div className="flex justify-between gap-2"><dt>{profile.taxLabel || 'Tax'} total</dt><dd>{money(receipt.taxMinor, receipt.currency)}</dd></div>
            <div className="flex justify-between gap-2 border-t border-zinc-500 pt-2 text-sm font-bold"><dt>TOTAL</dt><dd>{money(receipt.totalMinor, receipt.currency)}</dd></div>
            <div className="flex justify-between gap-2 pt-1"><dt>Paid</dt><dd>{money(receipt.amountPaidMinor, receipt.currency)}</dd></div>
            {receipt.payments.map((payment, index) => <React.Fragment key={index}><div className="flex justify-between gap-2"><dt>{payment.method === 'MANUAL_MPESA' ? 'M-Pesa' : payment.method.toUpperCase() === 'CASH' ? 'Cash' : 'Payment'}</dt><dd>{money(payment.amountMinor, payment.currency)}</dd></div>{payment.method === 'MANUAL_MPESA' && <><div className="text-[10px]">Cashier confirmed</div>{payment.reference && <div className="break-all text-[10px]">Reference: {payment.reference}</div>}</>}</React.Fragment>)}
            {receipt.customerAccountCharge && <><div className="flex justify-between gap-2"><dt>Customer account</dt><dd className="text-right">{receipt.customerAccountCharge.customerName}</dd></div><div className="flex justify-between gap-2 font-semibold"><dt>Account amount due</dt><dd>{money(receipt.customerAccountCharge.amountDueMinor, receipt.currency)}</dd></div></>}
            {receipt.cashTenderedMinor !== null && <><div className="flex justify-between gap-2"><dt>Cash received</dt><dd>{money(receipt.cashTenderedMinor, receipt.currency)}</dd></div><div className="flex justify-between gap-2"><dt>Change</dt><dd>{money(receipt.changeMinor ?? '0', receipt.currency)}</dd></div></>}
          </dl>
          <div className="my-3 border-t border-dashed border-zinc-400" />
          {profile.receiptFooter && <div className="mb-2 whitespace-pre-line text-center text-[10px]">{profile.receiptFooter}</div>}
          <p className="my-2 text-center text-[9px] text-zinc-600">Sale receipt. This is not an electronic tax invoice.</p>
          {qrImage && <div className="my-3 text-center"><img src={qrImage} alt="Payment QR code" className="mx-auto max-h-24 max-w-24 object-contain"/><div className="mt-1 text-[9px]">Scan to pay</div></div>}
          <div className="text-center text-[9px] text-zinc-600">DEVELOPED BY KINGS FORGE 0746157440</div>
        </article>}
      </div>

      <footer id="backend-receipt-actions" className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-900 p-4">
        <button type="button" onClick={download} disabled={!receipt || loading} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><Download className="mr-2 inline" size={15} />Download text</button>
        <div className="flex gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-lg px-3 text-sm text-zinc-300 hover:bg-zinc-800">Done</button><button type="button" onClick={() => window.print()} disabled={!receipt || loading} className="min-h-11 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:opacity-50"><Printer className="mr-2 inline" size={15} />Open print dialog</button></div>
      </footer>
      {receipt && <p id="backend-receipt-print-note" className="px-4 pb-3 text-center text-[11px] text-zinc-500">Check your printer after closing the print dialog.</p>}
    </div>
  </div>;
}
