/**
 * Mazao ERP Hardware Service
 * Emulates physical ESC/POS thermal receipt printing, cash drawer kick pulses,
 * and barcode verification.
 */

import { SaleOrder, Shift, TenantProfile, Room } from '../types/erp';
import { escapeHtml, safeRasterImageSource } from '../utils/html';

class HardwareService {
  private audioCtx: AudioContext | null = null;

  /**
   * Play realistic cash drawer kick pulse using Web Audio API
   */
  public triggerCashDrawerKick(): void {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      // Solenoid mechanical impulse (metallic thud + spring ring)
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.08);

      gain.gain.setValueAtTime(0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.12);

      // Bell chime of traditional cash register drawer latch
      const bell = this.audioCtx.createOscillator();
      const bellGain = this.audioCtx.createGain();
      bell.type = 'sine';
      bell.frequency.setValueAtTime(1800, now + 0.04);
      bell.frequency.exponentialRampToValueAtTime(1200, now + 0.25);

      bellGain.gain.setValueAtTime(0.3, now + 0.04);
      bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      bell.connect(bellGain);
      bellGain.connect(this.audioCtx.destination);

      bell.start(now + 0.04);
      bell.stop(now + 0.28);
    } catch {
      // Audio context might be restricted before user gesture
    }
  }

  /**
   * Formats raw ESC/POS monospace text for 80mm / 48 column thermal receipt printer
   */
  public generateThermalReceiptText(order: SaleOrder, tenant: TenantProfile): string {
    const pad = (str: string, len: number, alignRight = false) => {
      if (str.length >= len) return str.slice(0, len);
      return alignRight ? ' '.repeat(len - str.length) + str : str + ' '.repeat(len - str.length);
    };

    const divider = '─'.repeat(42);
    const dblDivider = '═'.repeat(42);

    let slip = `\n${dblDivider}\n`;
    slip += `${tenant.name.toUpperCase().padStart(Math.floor((42 + tenant.name.length) / 2))}\n`;
    slip += `${tenant.tagline.padStart(Math.floor((42 + tenant.tagline.length) / 2))}\n`;
    slip += `${tenant.address.padStart(Math.floor((42 + tenant.address.length) / 2))}\n`;
    slip += `TEL: ${tenant.phone.padStart(Math.floor((42 + tenant.phone.length) / 2))}\n`;
    slip += `${divider}\n`;
    slip += `RECEIPT #: ${order.orderNumber}\n`;
    slip += `DATE/TIME: ${new Date(order.timestamp).toLocaleString()}\n`;
    slip += `CASHIER  : ${order.cashierName}\n`;
    if (order.roomChargeRef) {
      slip += `FOLIO CHG: ROOM ${order.roomChargeRef.roomNumber} (${order.roomChargeRef.guestName})\n`;
    }
    slip += `PAY METHOD: ${order.paymentMethod.toUpperCase().replace('_', ' ')}\n`;
    slip += `${divider}\n`;
    slip += `${pad('ITEM', 22)} ${pad('QTY', 5, true)} ${pad('PRICE', 7, true)} ${pad('TOTAL', 7, true)}\n`;
    slip += `${divider}\n`;

    for (const item of order.items) {
      const lineTotal = (item.quantity * item.unitPrice).toFixed(2);
      slip += `${pad(item.product.name, 22)} ${pad(String(item.quantity), 5, true)} ${pad(item.unitPrice.toFixed(2), 7, true)} ${pad(lineTotal, 7, true)}\n`;
    }

    slip += `${divider}\n`;
    slip += `${pad('SUBTOTAL', 28)} ${pad(`${tenant.currencySymbol} ${order.subtotal.toFixed(2)}`, 14, true)}\n`;
    slip += `${pad(`TAX (${Math.round(tenant.taxRate * 100)}%)`, 28)} ${pad(`${tenant.currencySymbol} ${order.tax.toFixed(2)}`, 14, true)}\n`;
    slip += `${dblDivider}\n`;
    slip += `${pad('TOTAL DUE', 26)} ${pad(`${tenant.currencySymbol} ${order.total.toFixed(2)}`, 16, true)}\n`;
    slip += `${dblDivider}\n`;

    if (order.paymentMethod === 'cash') {
      slip += `${pad('CASH TENDERED', 28)} ${pad(`${tenant.currencySymbol} ${order.amountTendered.toFixed(2)}`, 14, true)}\n`;
      slip += `${pad('CHANGE DUE', 28)} ${pad(`${tenant.currencySymbol} ${order.changeDue.toFixed(2)}`, 14, true)}\n`;
    }

    slip += `\n${tenant.receiptFooter.padStart(Math.floor((42 + tenant.receiptFooter.length) / 2))}\n`;
    slip += `* MAZAO SECURE LEDGER SIGNATURE: ${order.idempotencyKey.slice(0, 16)} *\n`;
    slip += `${dblDivider}\n\n`;

    return slip;
  }

  /**
   * Triggers the direct browser print sequence for the thermal slip
   */
  public executeSilentPrint(order: SaleOrder, tenant: TenantProfile): void {
    // Inject thermal receipt HTML into printable DOM container
    let printContainer = document.getElementById('thermal-receipt-print-area');
    if (!printContainer) {
      printContainer = document.createElement('div');
      printContainer.id = 'thermal-receipt-print-area';
      document.body.appendChild(printContainer);
    }

    const widthStyle = tenant.paperWidth === '58mm' ? 'width: 54mm; max-width: 58mm;' : 'width: 76mm; max-width: 80mm;';
    const logoSource = tenant.logoImage && tenant.showLogoOnReceipt !== false ? safeRasterImageSource(tenant.logoImage) : '';
    const qrSource = tenant.receiptQrImage && tenant.showQrOnReceipt !== false ? safeRasterImageSource(tenant.receiptQrImage) : '';
    printContainer.setAttribute('style', `${widthStyle} padding: 4mm; font-family: 'JetBrains Mono', monospace; font-size: 11px;`);

    printContainer.innerHTML = `
      ${logoSource ? `
        <div style="text-align: center; margin-bottom: 6px;">
          <img src="${logoSource}" style="max-height: 48px; max-width: 140px; filter: grayscale(100%) contrast(150%); display: inline-block;" alt="Logo" />
        </div>
      ` : ''}
      <div style="text-align: center; font-weight: bold; font-size: 14px; margin-bottom: 2px;">
        ${escapeHtml(tenant.name.toUpperCase())}
      </div>
      <div style="text-align: center; font-size: 10px; margin-bottom: 2px;">${escapeHtml(tenant.tagline)}</div>
      <div style="text-align: center; font-size: 10px; margin-bottom: 6px;">${escapeHtml(tenant.address)} · ${escapeHtml(tenant.phone)}</div>
      <div style="border-top: 1px dashed #000; margin: 4px 0;"></div>
      <div style="display: flex; justify-content: space-between; font-size: 10px;">
        <span>REC: ${escapeHtml(order.orderNumber)}</span>
        <span>${new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 4px;">
        <span>STAFF: ${escapeHtml(order.cashierName)}</span>
        <span>${escapeHtml(order.paymentMethod.toUpperCase().replace('_', ' '))}</span>
      </div>
      ${order.roomChargeRef ? `<div style="font-size: 10px; font-weight: bold; background: #eee; padding: 2px;">BILLED TO RM ${escapeHtml(order.roomChargeRef.roomNumber)} (${escapeHtml(order.roomChargeRef.guestName)})</div>` : ''}
      ${order.customerAccountRef ? `<div style="font-size: 10px; font-weight: bold; background: #eee; padding: 2px;">CHARGED TO: ${escapeHtml(order.customerAccountRef.customerName.toUpperCase())}</div>` : ''}
      <div style="border-top: 1px dashed #000; margin: 4px 0;"></div>
      <table style="width: 100%; font-size: 10px; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #000;">
            <th style="text-align: left; padding: 2px 0;">ITEM</th>
            <th style="text-align: right; padding: 2px 0;">QTY</th>
            <th style="text-align: right; padding: 2px 0;">PRICE</th>
            <th style="text-align: right; padding: 2px 0;">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map(item => `
            <tr>
              <td style="padding: 2px 0;">${escapeHtml(item.product.name)}</td>
              <td style="text-align: right; padding: 2px 0;">${escapeHtml(item.quantity)}</td>
              <td style="text-align: right; padding: 2px 0;">${item.unitPrice.toFixed(2)}</td>
              <td style="text-align: right; padding: 2px 0;">${(item.quantity * item.unitPrice).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
      <div style="display: flex; justify-content: space-between; font-size: 10px;">
        <span>SUBTOTAL:</span>
        <span>${escapeHtml(tenant.currencySymbol)} ${order.subtotal.toFixed(2)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 10px;">
        <span>TAX (${Math.round(tenant.taxRate * 100)}%):</span>
        <span>${escapeHtml(tenant.currencySymbol)} ${order.tax.toFixed(2)}</span>
      </div>
      <div style="border-top: 1px solid #000; margin: 4px 0;"></div>
      <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 13px;">
        <span>TOTAL:</span>
        <span>${escapeHtml(tenant.currencySymbol)} ${order.total.toFixed(2)}</span>
      </div>
      ${order.paymentMethod === 'cash' ? `
        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 4px;">
          <span>TENDERED:</span>
          <span>${escapeHtml(tenant.currencySymbol)} ${order.amountTendered.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 10px;">
          <span>CHANGE:</span>
          <span>${escapeHtml(tenant.currencySymbol)} ${order.changeDue.toFixed(2)}</span>
        </div>
      ` : ''}
      ${order.customerAccountRef ? `
        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 4px;">
          <span>NEW ACCOUNT BAL:</span>
          <span>${escapeHtml(tenant.currencySymbol)} ${order.customerAccountRef.newBalance.toFixed(2)}</span>
        </div>
      ` : ''}
      ${qrSource ? `
        <div style="text-align: center; margin: 8px 0 4px 0;">
          <img src="${qrSource}" style="width: 80px; height: 80px; display: inline-block; filter: grayscale(100%);" alt="Payment QR" />
          <div style="font-size: 9px; font-weight: bold; margin-top: 2px;">SCAN TO PAY</div>
          ${tenant.tillNumber ? `<div style="font-size: 9px; font-family: monospace;">TILL NO: ${escapeHtml(tenant.tillNumber)}</div>` : ''}
        </div>
      ` : (tenant.tillNumber ? `
        <div style="text-align: center; margin: 6px 0; font-size: 10px; font-weight: bold;">
          BUY GOODS TILL: ${escapeHtml(tenant.tillNumber)}
        </div>
      ` : '')}
      <div style="border-top: 1px dashed #000; margin: 8px 0 4px 0;"></div>
      <div style="text-align: center; font-size: 9px;">${escapeHtml(tenant.receiptFooter)}</div>
      <div style="text-align: center; font-size: 8px; color: #555; margin-top: 4px; font-family: monospace;">
        AUTH REF: ${escapeHtml(order.idempotencyKey.slice(0, 16))}
      </div>
    `;

    // Trigger browser print dialog
    try {
      window.print();
    } catch {
      console.warn('Silent print blocked by browser security policy');
    }
  }

  /**
   * Generates End-of-Shift Z-Report Monospace Slip
   */
  public generateZReportText(shift: Shift, tenant: TenantProfile): string {
    const divider = '─'.repeat(42);
    const dblDivider = '═'.repeat(42);
    const pad = (str: string, len: number, alignRight = false) => {
      if (str.length >= len) return str.slice(0, len);
      return alignRight ? ' '.repeat(len - str.length) + str : str + ' '.repeat(len - str.length);
    };

    let slip = `\n${dblDivider}\n`;
    slip += `${tenant.name.toUpperCase().padStart(Math.floor((42 + tenant.name.length) / 2))}\n`;
    slip += `OFFICIAL END-OF-SHIFT Z-REPORT\n`.padStart(Math.floor((42 + 30) / 2));
    slip += `${divider}\n`;
    slip += `REPORT REF : ${shift.zReportNumber || 'Z-REP-LIVE'}\n`;
    slip += `CASHIER    : ${shift.cashierName}\n`;
    slip += `SHIFT OPEN : ${new Date(shift.startTime).toLocaleString()}\n`;
    slip += `SHIFT CLOSE: ${shift.endTime ? new Date(shift.endTime).toLocaleString() : 'ACTIVE'}\n`;
    slip += `${divider}\n`;
    slip += `DRAWER RECONCILIATION\n`;
    slip += `${divider}\n`;
    slip += `${pad('OPENING FLOAT (+)', 26)} ${pad(`${tenant.currencySymbol} ${shift.openingFloat.toFixed(2)}`, 16, true)}\n`;
    slip += `${pad('CASH SALES (+)', 26)} ${pad(`${tenant.currencySymbol} ${shift.cashSales.toFixed(2)}`, 16, true)}\n`;
    slip += `${pad('CASH PAYOUTS (-)', 26)} ${pad(`${tenant.currencySymbol} ${shift.cashPayouts.toFixed(2)}`, 16, true)}\n`;
    slip += `${dblDivider}\n`;
    slip += `${pad('EXPECTED CASH IN DRAWER', 26)} ${pad(`${tenant.currencySymbol} ${shift.expectedCash.toFixed(2)}`, 16, true)}\n`;
    if (shift.actualCashCounted !== undefined) {
      slip += `${pad('ACTUAL COUNTED CASH', 26)} ${pad(`${tenant.currencySymbol} ${shift.actualCashCounted.toFixed(2)}`, 16, true)}\n`;
      const diff = shift.discrepancy || 0;
      const diffLabel = diff === 0 ? 'VARIANCE (BALANCED)' : diff > 0 ? 'VARIANCE (OVERAGE)' : 'VARIANCE (SHORTAGE)';
      slip += `${pad(diffLabel, 26)} ${pad(`${tenant.currencySymbol} ${diff.toFixed(2)}`, 16, true)}\n`;
    }
    slip += `${divider}\n`;
    slip += `NON-CASH REVENUE AUDIT\n`;
    slip += `${pad('CARD PAYMENTS', 26)} ${pad(`${tenant.currencySymbol} ${shift.cardSales.toFixed(2)}`, 16, true)}\n`;
    slip += `${pad('MOBILE MONEY', 26)} ${pad(`${tenant.currencySymbol} ${shift.mobileSales.toFixed(2)}`, 16, true)}\n`;
    slip += `${pad('ROOM FOLIO CHARGES', 26)} ${pad(`${tenant.currencySymbol} ${shift.roomChargesTotal.toFixed(2)}`, 16, true)}\n`;
    const grandTotal = shift.cashSales + shift.cardSales + shift.mobileSales + shift.roomChargesTotal;
    slip += `${dblDivider}\n`;
    slip += `${pad('TOTAL SHIFT REVENUE', 26)} ${pad(`${tenant.currencySymbol} ${grandTotal.toFixed(2)}`, 16, true)}\n`;
    slip += `${dblDivider}\n\n`;
    return slip;
  }
}

export const hardware = new HardwareService();
