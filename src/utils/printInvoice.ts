import type { Order } from '../types';
import { formatPrice } from './shopLogic';

type Language = 'en' | 'ar';

/** An order whose invoice has been issued, so its permanent number and issue date exist. */
type IssuedOrder = Order & { invoiceNumber: string; invoiceIssuedAt: string };

const LABELS = {
  en: {
    title: 'Invoice',
    number: 'Invoice No.',
    order: 'Order No.',
    date: 'Date',
    billTo: 'Billed / Delivered to',
    payment: 'Payment',
    cod: 'Cash on delivery',
    paid: 'Paid',
    unpaid: 'Unpaid',
    item: 'Item',
    unit: 'Unit price',
    qty: 'Qty',
    amount: 'Amount',
    subtotal: 'Subtotal',
    discount: 'Discount',
    noDiscount: 'No discount',
    delivery: 'Delivery fee',
    free: 'Free',
    total: 'Total',
    thanks: 'Thank you for shopping with Dr Cosmetics.',
    notes: 'Delivery notes',
  },
  ar: {
    title: 'فاتورة',
    number: 'رقم الفاتورة',
    order: 'رقم الطلب',
    date: 'التاريخ',
    billTo: 'العميل / عنوان التوصيل',
    payment: 'الدفع',
    cod: 'الدفع عند الاستلام',
    paid: 'مدفوع',
    unpaid: 'غير مدفوع',
    item: 'المنتج',
    unit: 'سعر الوحدة',
    qty: 'الكمية',
    amount: 'المبلغ',
    subtotal: 'المجموع الفرعي',
    discount: 'الخصم',
    noDiscount: 'لا يوجد خصم',
    delivery: 'رسوم التوصيل',
    free: 'مجاني',
    total: 'الإجمالي النهائي',
    thanks: 'شكراً لتسوقكم من دكتور كوزمتكس.',
    notes: 'ملاحظات التوصيل',
  },
} as const;

function esc(value: string | number | undefined | null): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

export function buildInvoiceHtml(order: IssuedOrder, language: Language): string {
  const L = LABELS[language];
  const money = (n: number) => esc(formatPrice(n, language));
  const pick = (s?: { en: string; ar: string } | null) => (s ? s[language] || s.en : '');
  const locale = language === 'ar' ? 'ar-EG' : 'en-GB';
  const date = new Date(order.invoiceIssuedAt).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const a = order.shippingAddress;
  const collected = order.paymentStatus === 'Collected';

  const rows = order.items
    .map((it) => {
      const meta = [pick(it.shadeName), it.size].filter(Boolean).join(' • ');
      return `<tr>
        <td>${esc(pick(it.productName))}${it.brand ? `<div class="meta">${esc(it.brand)}</div>` : ''}${
          meta ? `<div class="meta">${esc(meta)}</div>` : ''
        }<div class="meta" dir="ltr">${esc(it.variantSku)}</div></td>
        <td class="num">${money(it.unitPrice)}</td>
        <td class="num">${esc(it.quantity)}</td>
        <td class="num">${money(it.unitPrice * it.quantity)}</td>
      </tr>`;
    })
    .join('');

  const discountRow =
    order.discountAmount > 0
      ? `<tr class="disc"><td>${L.discount}${order.discountCode ? ` (${esc(order.discountCode)})` : ''}</td><td class="num">-${money(order.discountAmount)}</td></tr>`
      : `<tr><td>${L.discount}</td><td class="num">${L.noDiscount}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${esc(order.invoiceNumber)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #2D1E2F; font-size: 13px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #3B2332; padding-bottom: 12px; }
  .brand { font-family: Georgia, serif; font-size: 28px; font-weight: 700; color: #3B2332; }
  .title { text-align: end; }
  .title h1 { margin: 0; font-size: 24px; letter-spacing: 2px; text-transform: uppercase; color: #8B263E; }
  .title div { margin-top: 4px; }
  .grid { display: flex; justify-content: space-between; gap: 24px; margin: 18px 0; }
  .box { flex: 1; }
  .box h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #8B6E7E; }
  .box p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; }
  .items th { background: #F3E7E4; text-align: start; padding: 8px; font-size: 11px; text-transform: uppercase; }
  .items td { padding: 8px; border-bottom: 1px solid #E8D6D1; vertical-align: top; }
  .meta { font-size: 11px; color: #6b5560; margin-top: 2px; }
  .num { text-align: end; white-space: nowrap; }
  .items th.num { text-align: end; }
  .totals { width: 55%; margin-inline-start: auto; margin-top: 14px; }
  .totals td { padding: 5px 8px; }
  .disc td { color: #047857; }
  .grand td { border-top: 2px solid #3B2332; font-size: 16px; font-weight: 700; padding-top: 8px; }
  .foot { margin-top: 32px; text-align: center; font-size: 11px; color: #8B6E7E; }
  tr { page-break-inside: avoid; }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">Dr Cosmetics</div>
    <div class="title">
      <h1>${L.title}</h1>
      <div><strong>${L.number}:</strong> <span dir="ltr">${esc(order.invoiceNumber)}</span></div>
      <div><strong>${L.date}:</strong> ${esc(date)}</div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>${L.billTo}</h3>
      <p><strong>${esc(a.fullName)}</strong></p>
      <p dir="ltr" style="text-align:start">${esc(a.mobileNumber)}</p>
      <p>${esc(a.streetAddress)}${a.buildingApt ? `, ${esc(a.buildingApt)}` : ''}</p>
      <p>${esc(a.city)}, ${esc(a.governorate)}</p>
      ${a.deliveryNotes ? `<p class="meta">${L.notes}: ${esc(a.deliveryNotes)}</p>` : ''}
    </div>
    <div class="box">
      <h3>${L.order}</h3>
      <p dir="ltr" style="text-align:start">${esc(order.orderNumber)}</p>
      <h3 style="margin-top:10px">${L.payment}</h3>
      <p>${L.cod} — ${collected ? L.paid : L.unpaid}</p>
    </div>
  </div>

  <table class="items">
    <thead><tr><th>${L.item}</th><th class="num">${L.unit}</th><th class="num">${L.qty}</th><th class="num">${L.amount}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr><td>${L.subtotal}</td><td class="num">${money(order.subtotal)}</td></tr>
    ${discountRow}
    <tr><td>${L.delivery}</td><td class="num">${order.deliveryFee === 0 ? L.free : money(order.deliveryFee)}</td></tr>
    <tr class="grand"><td>${L.total}</td><td class="num">${money(order.total)}</td></tr>
  </table>

  <div class="foot">${L.thanks}</div>
</body>
</html>`;
}

/**
 * Issues the order's invoice (the server numbers it once and returns the same number on every later call), then
 * renders it in a hidden iframe and opens the browser print dialog. Returns the order carrying its invoice number so
 * the caller can show it. Rejects, printing nothing, if the invoice cannot be issued.
 */
export async function issueAndPrintInvoice(
  order: Order,
  language: Language,
  issue: (orderId: string) => Promise<Order>,
): Promise<Order> {
  const issued = order.invoiceNumber && order.invoiceIssuedAt ? order : await issue(order.id);
  if (!issued.invoiceNumber || !issued.invoiceIssuedAt) {
    throw new Error('The server did not return an invoice number.');
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.onafterprint = cleanup;
    win.focus();
    win.print();
  };
  frame.srcdoc = buildInvoiceHtml(issued as IssuedOrder, language);
  document.body.appendChild(frame);
  return issued;
}
