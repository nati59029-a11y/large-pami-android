/* מסכי המנהל של "הזמנות אתר" (שלב 2.6ב, פרק 6.2 באפיון): לוח בקרה, כל ההזמנות, ארכיון חשבוניות, דוחות,
   בקשות למוצרים, שירות לקוחות והתראות אבטחה. ("לקוחות" ו"שוטף" – ב-customers.js ו-deferred.js.)
   - מנהל בלבד: כל מסך נעטף ב-mgrOnly (עובד שמגיע אליו ישירות רואה הודעה ולא נשלחת בקשת נתונים), וגם הכללים בשרת חוסמים אותו.
   - אין חישוב כספי בדפדפן: כל סכום, יתרה ומספר חשבונית מוצגים כפי שהשרת שמר או החזיר. סיכומים – רק מה שהשרת החזיר.
   - ביטול וזיכוי: סיבה חובה + חלון אישור. השרת מבטל/מזכה ומפיק חשבונית זיכוי. */
import * as api from '../api.js';
import { esc, $, $$, ils, toast, busy, dialog, confirmBox, saveFile } from '../ui.js';
import { statusText, orderView } from './order.js';
import { invNo, invNoById, DOC_LABEL, PAY_LABEL, fmtTime, fmtDate, waLink } from './money.js';

const DENY = '<div class="card"><p class="err" role="alert">המסך הזה למנהל בלבד.</p></div>';
const mgrOnly = (fn) => async (root, ctx, ...a) => { if (!api.isManager()) { root.innerHTML = DENY; return undefined; } return fn(root, ctx, ...a); };
const back = '<button class="btn g s" data-bk>‹ חזרה</button>';
const HOLD = { awaiting_customer_approval: 'ממתינה לאישור הלקוח', payment_retry: 'ממתינה לתשלום בקישור', pickup_overdue: 'איסוף באיחור' };
const ACTION = {
  claim: 'קלטתי', item_mark: 'סימון שורה', item_change: 'תחליף / הורדה', confirm_stock: 'יש הכול (חיוב)', approval_request: 'נשלח ללקוח לאישור', approval_phone: 'אישור בטלפון',
  approval_site: 'אישור הלקוח באתר', start_packing: 'התחלת אריזה', finish_packing: 'סיום אריזה', load: 'הועמס לרכב', deliver: 'נמסר', picked_up: 'נאסף', delivery_failed: 'הלקוח לא נמצא',
  payment_link: 'קישור תשלום נשלח', cancel: 'בוטלה', refund: 'זיכוי', deferred_paid: 'התקבל תשלום', to_collect: 'לגבות', status: 'עדכון סטטוס',
};
const REASON = { customer_request: 'לבקשת הלקוח', manager_decision: 'החלטת המנהל' };
const li = (id, title, sub, tags) => `<button class="li" data-id="${esc(id)}"><div class="m"><b>${title}</b><small>${sub}</small></div>${tags || ''}</button>`;
const orderTags = (o) => (o.hold ? `<span class="tag gold">${esc(HOLD[o.hold] || o.hold)}</span>` : '') + `<span class="tag ${o.status === 'cancelled' ? 'bad' : ''}">${esc(statusText(o.status))}</span>`;
const orderLi = (o) => li(o.id, 'הזמנה ' + esc(o.orderNumber || o.id), `${esc(fmtTime(o.createdAt))} · ${esc((o.contact && o.contact.name) || '')}${o.paymentTerms === 'deferred' ? ' · שוטף' : ''}`, orderTags(o));
const openOrderOnClick = (root, ctx, sel) => $$(sel || '.li[data-id]', root).forEach((b) => { b.onclick = () => ctx.open((r) => adminOrder(r, ctx, b.dataset.id)); });
const bk = (root, ctx) => { const b = $('[data-bk]', root); if (b) b.onclick = () => ctx.back(); };

// ---------- ביטול וזיכוי: סיבה חובה, ואישור במסך. השרת עושה את העבודה ומפיק חשבונית זיכוי ----------
export async function cancelFlow(orderId, orderNumber, defReason, refund) {
  const what = refund ? 'זיכוי' : 'ביטול';
  const d = await dialog(`<h3 style="margin-top:0">${what} הזמנה ${esc(orderNumber || orderId)}</h3>
    <label class="f"><span>סיבה (חובה)</span><select name="reason"><option value="">בחר סיבה</option>${Object.entries(REASON).map(([v, l]) => `<option value="${v}" ${v === defReason ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>הערה (לא חובה)</span><textarea name="note" rows="2" maxlength="300"></textarea></label>`,
  [['go', 'המשך לאישור', 'bad']], (m) => ({ reason: m.querySelector('[name=reason]').value, note: m.querySelector('[name=note]').value.trim() }));
  if (!d) return null;
  if (!d.data.reason) { toast('חובה לבחור סיבה', true); return null; }
  const ok = await confirmBox(`${refund ? 'לזכות' : 'לבטל'} את הזמנה ${orderNumber || orderId}? (${REASON[d.data.reason]}). אם הלקוח כבר חויבה – הכרטיס יזוכה במלואו ותופק חשבונית זיכוי. אי אפשר לבטל את הפעולה.`, `כן, ${refund ? 'זכה' : 'בטל'}`);
  if (!ok) return null;
  const input = { orderId, reason: d.data.reason };
  if (d.data.note) input.note = d.data.note;
  return { input };
}
const doneText = (r) => `ההזמנה ${r.status === 'cancelled' ? 'בוטלה' : 'טופלה'}${r.creditInvoiceId ? '. הופקה ' + invNoById(r.creditInvoiceId) : ''}${r.invoiceError ? ' (חשבונית הזיכוי נכשלה – ראו התראה)' : ''}`;

// ---------- כרטיס הזמנה למנהל: פעולות, חשבוניות, פירוט (הקיים) ויומן מלא ----------
async function adminOrder(root, ctx, id) {
  const [o, events] = await Promise.all([api.getOrder(id), api.listOrderEvents(id).catch(() => [])]);
  if (!root.isConnected) return;
  if (!o) { root.innerHTML = back + '<p class="err">ההזמנה לא נמצאה.</p>'; bk(root, ctx); return; }
  const inv = (await Promise.all((o.invoiceIds || []).map((x) => api.getInvoice(x).catch(() => null)))).filter(Boolean);
  if (!root.isConnected) return;
  const closed = o.status === 'cancelled';
  const canRefund = !closed && o.status === 'completed' && o.pricing && o.pricing.chargedAmount && !o.pricing.refundedAmount;
  const canCancel = !closed && o.status !== 'completed';
  root.innerHTML = `<div id="ahead" class="card"><p><b>הזמנה ${esc(o.orderNumber || o.id)}</b> · <span id="ast">${esc(statusText(o.status))}</span>${o.hold ? ` · <span class="tag gold">${esc(HOLD[o.hold] || o.hold)}</span>` : ''}${o.cancelReason ? ` · סיבה: ${esc(REASON[o.cancelReason] || o.cancelReason)}` : ''}</p>
    <p class="note">${esc((o.contact && o.contact.name) || '')} · ${esc(o.paymentTerms === 'deferred' ? 'שוטף' : 'כרטיס אשראי')}${o.pricing && o.pricing.refundedAmount ? ' · זוכתה ' + ils(o.pricing.refundedAmount) : ''}</p>
    <div id="ainv">${inv.length ? '<table><tr><th>מסמך</th><th>סכום</th><th>מצב</th></tr>' + inv.map((v) => `<tr data-inv="${esc(v.id)}"><td>${esc(invNo(v))}</td><td>${ils(v.total)}</td><td>${esc(PAY_LABEL[v.paymentStatus] || '')}</td></tr>`).join('') + '</table>' : '<p class="note">עוד לא הופקו חשבוניות להזמנה.</p>'}</div>
    <div class="row" style="margin-top:8px">${canCancel ? '<button class="btn bad" id="acancel">ביטול הזמנה</button>' : ''}${canRefund ? '<button class="btn bad" id="arefund">זיכוי הזמנה</button>' : ''}${o.hold === 'payment_retry' ? '<button class="btn g" id="alink">שלח קישור תשלום מחדש</button>' : ''}</div></div>
    <div id="aorder"></div>
    <h3>יומן מלא (${events.length})</h3><div class="card" id="alog" style="overflow-x:auto">${events.length ? '<table><tr><th>זמן</th><th>פעולה</th><th>מי</th><th>גלוי ל</th></tr>' + events.sort((a, b) => String(a.at).localeCompare(String(b.at))).map((e) =>
      `<tr><td>${esc(fmtTime(e.at))}</td><td>${esc(ACTION[e.action] || e.action || e.type || '')}${e.toStatus && e.fromStatus !== e.toStatus ? ' → ' + esc(statusText(e.toStatus)) : ''}</td><td>${esc(e.actorRole || '')}${e.actorUid ? ' · <span dir="ltr">' + esc(String(e.actorUid).slice(-6)) + '</span>' : ''}</td><td>${esc({ customer: 'לקוח', staff: 'צוות', manager: 'מנהל' }[e.visibility] || e.visibility || '')}</td></tr>`).join('') + '</table>' : '<p class="note">אין אירועים.</p>'}</div>`;
  const inner = $('#aorder', root);
  const sub = document.createElement('div'); inner.append(sub);
  // הפירוט הקיים מצויר בתוך תיבה משלו; "החלף" אצלו מצייר מחדש רק אותה (הכותרת והיומן נטענים מחדש בכניסה הבאה למסך)
  const inCtx = { back: () => ctx.back(), open: ctx.open, replace: (fn) => fn(sub, inCtx), refresh: () => orderView(sub, inCtx, id) };
  await orderView(sub, inCtx, id);
  const redo = () => ctx.replace((r) => adminOrder(r, ctx, id));
  const act = (sel, refund) => { const b = $(sel, root); if (!b) return; b.onclick = async () => {
    const f = await cancelFlow(id, o.orderNumber, o.paymentTerms === 'deferred' ? 'customer_request' : '', refund);
    if (!f) return;
    const r = await busy(b, () => (refund ? api.refundOrder(f.input) : api.cancelOrder(f.input)), doneText);
    if (r) redo();
  }; };
  act('#acancel', false); act('#arefund', true);
  if ($('#alink', root)) $('#alink', root).onclick = async (ev) => { const r = await busy(ev.target, () => api.sendPaymentLink({ orderId: id }), 'הקישור נשלח'); if (r) redo(); };
}

// ---------- כל ההזמנות ----------
const allOrders = mgrOnly(async (root, ctx) => {
  const list = await api.listAllOrders(300);
  if (!root.isConnected) return;
  root.innerHTML = `<h2>כל ההזמנות <small class="note">(${list.length} אחרונות)</small></h2>
    <div class="grid2"><label class="f"><span>חיפוש (מספר, שם, מייל, טלפון)</span><input id="q" autocomplete="off"></label>
    <label class="f"><span>סטטוס</span><select id="fs"><option value="">הכול</option>${Object.keys(api_STATUS()).map((s) => `<option value="${s}">${esc(statusText(s))}</option>`).join('')}</select></label></div>
    <div id="ol"></div>`;
  const draw = async () => {
    const q = $('#q', root).value.trim().toLowerCase(); const st = $('#fs', root).value;
    let rows = list.filter((o) => (!st || o.status === st) && (!q || [o.orderNumber, o.id, o.contact && o.contact.name, o.contact && o.contact.email, o.contact && o.contact.phone].some((x) => String(x || '').toLowerCase().includes(q))));
    if (!rows.length && q && !st) rows = await api.listOrdersByNumber($('#q', root).value.trim()).catch(() => []);
    if (!root.isConnected) return;
    $('#ol', root).innerHTML = rows.map(orderLi).join('') || '<p class="note" id="empty">לא נמצאו הזמנות.</p>';
    openOrderOnClick(root, ctx, '#ol .li[data-id]');
  };
  $('#q', root).oninput = draw; $('#fs', root).onchange = draw;
  await draw();
});
const api_STATUS = () => ({ pending_payment: 1, received: 1, stock_check: 1, awaiting_packing: 1, packing: 1, ready: 1, out_for_delivery: 1, delivered: 1, cancelled: 1, completed: 1 });

// ---------- לוח בקרה ----------
const HOURS = 3600000;
const dashboard = mgrOnly(async (root, ctx) => {
  const [open, days, pays, priv] = await Promise.all([api.listOrdersByStatus(api.OPEN_STATUSES), api.listIncomeDays(7).catch(() => []), api.listAuthorizedPayments().catch(() => []), api.getSettings('private').catch(() => null)]);
  if (!root.isConnected) return;
  const now = Date.now();
  const counts = {}; open.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  const old = (o) => { const t = Date.parse(o.receivedAt || o.createdAt || ''); return Number.isFinite(t) && now - t > 24 * HOURS; };
  const oById = new Map(open.map((o) => [o.id, o]));
  const validity = priv && priv.payments && Number(priv.payments.authValidityHours); const warn = (priv && priv.payments && priv.payments.authExpiryWarnPercent) || 25;
  const expiring = validity ? pays.filter((p) => { const t = Date.parse(p.createdAt || ''); const left = t + validity * HOURS - now; return Number.isFinite(t) && left <= validity * HOURS * warn / 100 && oById.has(p.orderId); }) : [];
  const groups = [
    ['לא נבדקו יותר מ-24 שעות', open.filter((o) => o.status === 'stock_check' && old(o))],
    ['מחכות לאישור הלקוח', open.filter((o) => o.hold === 'awaiting_customer_approval')],
    ['ממתינות לתשלום בקישור', open.filter((o) => o.hold === 'payment_retry')],
    ['לא נאספו בזמן', open.filter((o) => o.hold === 'pickup_overdue')],
    [validity ? 'מסגרת אשראי שעומדת לפוג' : 'מסגרת אשראי שעומדת לפוג (לא הוגדר תוקף מסגרת בהגדרות)', expiring.map((p) => oById.get(p.orderId))],
  ];
  root.innerHTML = `<h2>לוח בקרה</h2>
    <div class="card"><h3 style="margin-top:0">הזמנות פתוחות (${open.length})</h3><div id="dcnt" class="grid2">${api.OPEN_STATUSES.map((s) => `<div class="sum"><span>${esc(statusText(s))}</span><b data-st="${s}">${counts[s] || 0}</b></div>`).join('')}</div></div>
    <h3>הזמנות תקועות</h3><div id="dstuck">${groups.map(([t, l]) => `<div class="card"><b>${esc(t)}</b> <span class="tag ${l.length ? 'gold' : ''}" data-n>${l.length}</span>${l.map(orderLi).join('')}</div>`).join('')}</div>
    <h3>הכנסות מהאתר – 7 ימים אחרונים</h3><div class="card" id="dinc">${days.length ? '<table><tr><th>יום</th><th>נטו</th><th>זיכויים</th><th>הזמנות</th></tr>' + days.sort((a, b) => String(b.date).localeCompare(String(a.date))).map((d) => `<tr><td>${esc(d.date)}${d.isDemo ? ' <span class="tag gold">דמו</span>' : ''}</td><td>${ils(d.total)}</td><td>${ils(d.refunds)}</td><td>${esc(d.ordersCount == null ? '' : d.ordersCount)}</td></tr>`).join('') + '</table>' : '<p class="note">אין עדיין סיכום יומי.</p>'}</div>`;
  openOrderOnClick(root, ctx, '#dstuck .li[data-id]');
});

// ---------- ארכיון חשבוניות ----------
const invoices = mgrOnly(async (root, ctx) => {
  const [list, priv] = await Promise.all([api.listAllInvoices(500), api.getSettings('private').catch(() => null)]);
  if (!root.isConnected) return;
  const thr = priv && priv.invoices && typeof priv.invoices.allocationThreshold === 'number' ? priv.invoices.allocationThreshold : null;
  const months = [...new Set(list.map((v) => String(v.issuedAt || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const nowMonth = new Date().toISOString().slice(0, 7);
  root.innerHTML = `<h2>חשבוניות – ארכיון <small class="note">(${list.length} אחרונות)</small></h2>
    <label class="f"><span>חיפוש (מספר, לקוח, סכום, הזמנה)</span><input id="iq" autocomplete="off"></label>
    <div class="grid2"><label class="f"><span>חודש</span><select id="im"><option value="">הכול</option>${months.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
    <label class="f"><span>סוג</span><select id="it"><option value="">הכול</option>${Object.entries(DOC_LABEL).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label></div>
    <div id="il"></div>
    <div class="card"><h3 style="margin-top:0">ייצוא לרואה החשבון</h3>
      <div class="grid2"><label class="f"><span>חודש</span><input type="month" id="xm" value="${esc(months[0] || nowMonth)}"></label>
      <label class="f"><span>קובץ</span><select id="xf"><option value="csv">אקסל (CSV)</option><option value="pdf">PDF מרוכז</option></select></label></div>
      <button class="btn w" id="xgo">ייצא</button></div>`;
  const draw = () => {
    const q = $('#iq', root).value.trim().toLowerCase(); const m = $('#im', root).value; const t = $('#it', root).value;
    const rows = list.filter((v) => (!m || String(v.issuedAt).startsWith(m)) && (!t || v.docType === t) && (!q || [invNo(v), v.number, v.buyer && v.buyer.name, v.buyer && v.buyer.email, v.orderNumber, v.total].some((x) => String(x == null ? '' : x).toLowerCase().includes(q))));
    $('#il', root).innerHTML = rows.map((v) => li(v.id, esc(invNo(v)), `${esc(fmtDate(v.issuedAt))} · ${esc((v.buyer && v.buyer.name) || '')} · ${ils(v.total)}${v.orderNumber ? ' · הזמנה ' + esc(v.orderNumber) : ''}`,
      (v.docType !== 'receipt' && v.allocationNumber == null && thr != null && Math.abs(Number(v.total)) >= thr ? '<span class="tag gold">דרוש מספר הקצאה</span>' : '') + (v.paymentStatus ? `<span class="tag ${v.paymentStatus === 'to_collect' ? 'bad' : v.paymentStatus === 'paid' ? 'ok' : ''}">${esc(PAY_LABEL[v.paymentStatus] || v.paymentStatus)}</span>` : '') + (v.isDemo ? '<span class="tag gold">דמו</span>' : ''))).join('') || '<p class="note" id="empty">לא נמצאו חשבוניות.</p>';
    $$('#il .li[data-id]', root).forEach((b) => { b.onclick = () => ctx.open((r) => invoiceView(r, ctx, b.dataset.id, thr)); });
  };
  $('#iq', root).oninput = draw; $('#im', root).onchange = draw; $('#it', root).onchange = draw; draw();
  $('#xgo', root).onclick = async (ev) => {
    const month = $('#xm', root).value; const format = $('#xf', root).value;
    if (!/^\d{4}-\d{2}$/.test(month)) { toast('בחר חודש', true); return; }
    const r = await busy(ev.target, () => api.exportInvoices({ month, format }), (x) => `יוצאו ${x.count} חשבוניות`);
    if (!r) return;
    if (r.csv != null) await saveFile(r.filename, new TextEncoder().encode(r.csv), 'text/csv');
    else if (r.pdfBase64) { const bin = atob(r.pdfBase64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await saveFile(r.filename, u, 'application/pdf'); }
  };
});
async function invoiceView(root, ctx, id, thr) {
  const v = await api.getInvoice(id);
  if (!root.isConnected) return;
  if (!v) { root.innerHTML = back + '<p class="err">החשבונית לא נמצאה.</p>'; bk(root, ctx); return; }
  const canAlloc = v.docType !== 'receipt' && v.allocationNumber == null;
  root.innerHTML = `${back}<h2>${esc(invNo(v))}</h2>
    <div class="card"><p>${esc(fmtDate(v.issuedAt))} · ${esc((v.buyer && v.buyer.name) || '')}${v.buyer && v.buyer.email ? ' · <span dir="ltr">' + esc(v.buyer.email) + '</span>' : ''}</p>
    <div class="sum tot"><span>סכום</span><b id="vtot">${ils(v.total)}</b></div>
    <p class="note">${v.orderNumber ? 'הזמנה ' + esc(v.orderNumber) : ''}${v.relatedInvoiceId ? ' · מתייחסת ל' + esc(invNoById(v.relatedInvoiceId)) : ''}${v.dueDate ? ' · לתשלום עד ' + esc(v.dueDate) : ''}${v.paymentStatus ? ' · ' + esc(PAY_LABEL[v.paymentStatus] || v.paymentStatus) : ''}</p>
    <p id="valloc">מספר הקצאה: ${v.allocationNumber != null ? `<b dir="ltr">${esc(v.allocationNumber)}</b>` : (v.docType === 'receipt' ? 'לא נדרש בקבלה' : 'עוד לא הוזן' + (thr != null && Math.abs(Number(v.total)) >= thr ? ' (נדרש בסכום הזה)' : ''))}</p></div>
    ${canAlloc ? `<div class="card"><label class="f"><span>הזנת מספר הקצאה (פעם אחת, ספרות בלבד – אי אפשר לשנות אחר כך)</span><input id="valn" inputmode="numeric" dir="ltr" maxlength="20"></label><button class="btn w" id="valsave">שמור מספר הקצאה</button></div>` : ''}
    <button class="btn g w" id="vresend">שליחה חוזרת ללקוח במייל</button>
    ${v.orderId ? '<button class="btn g w" id="vorder" style="margin-top:8px">פתיחת ההזמנה</button>' : ''}`;
  bk(root, ctx);
  if (canAlloc) $('#valsave', root).onclick = async (ev) => {
    const n = $('#valn', root).value.trim();
    if (!/^\d{1,20}$/.test(n)) { toast('מספר הקצאה: ספרות בלבד (עד 20)', true); return; }
    if (!await confirmBox(`לשמור מספר הקצאה ${n} ל${invNo(v)}? אפשר להזין פעם אחת בלבד.`, 'שמור')) return;
    const r = await busy(ev.target, () => api.setAllocationNumber({ invoiceId: id, allocationNumber: n }), 'מספר ההקצאה נשמר');
    if (r) ctx.replace((rt) => invoiceView(rt, ctx, id, thr));
  };
  $('#vresend', root).onclick = async (ev) => { if (await confirmBox(`לשלוח שוב את ${invNo(v)} למייל של הלקוח?`, 'שלח')) await busy(ev.target, () => api.resendInvoice({ invoiceId: id }), 'החשבונית הוכנסה לתור השליחה'); };
  if ($('#vorder', root)) $('#vorder', root).onclick = () => ctx.open((r) => adminOrder(r, ctx, v.orderId));
}

// ---------- דוחות (כל המספרים מהשרת) ----------
const REPORTS = {
  sales: ['מכירות', [['period', 'תקופה'], ['charges', 'חיובים'], ['refunds', 'זיכויים'], ['total', 'נטו'], ['ordersCount', 'הזמנות']], ['charges', 'refunds', 'total']],
  top_products: ['מוצרים מובילים', [['rank', '#'], ['name', 'מוצר'], ['packs', 'חבילות'], ['orders', 'הזמנות'], ['revenue', 'הכנסה']], ['revenue']],
  staff_times: ['זמני טיפול לעובד', [['name', 'עובד'], ['actions', 'פעולות'], ['orders', 'הזמנות'], ['avgStockCheckMinutes', 'מלאי (דק׳)'], ['avgPackingMinutes', 'אריזה (דק׳)'], ['avgDeliveryMinutes', 'מסירה (דק׳)']], []],
  deferred: ['שוטף – יתרות', [['name', 'לקוח'], ['openBalance', 'יתרה לתשלום'], ['overdueBalance', 'באיחור'], ['nextDueDate', 'מועד קרוב'], ['state', 'מצב']], ['openBalance', 'overdueBalance']],
};
const STATE_HE = { ok: 'תקין', blocked: 'חסום', overdue: 'באיחור', to_collect: 'לגבות' };
const reports = mgrOnly(async (root) => {
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const to = iso(new Date()); const from = iso(new Date(Date.now() - 29 * 86400000));
  root.innerHTML = `<h2>דוחות</h2><div class="card">
    <label class="f"><span>דוח</span><select id="rr">${Object.entries(REPORTS).map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join('')}</select></label>
    <div class="grid2" id="rdates"><label class="f"><span>מתאריך</span><input type="date" id="rf" value="${from}"></label><label class="f"><span>עד תאריך</span><input type="date" id="rt" value="${to}"></label></div>
    <label class="f" id="rgl"><span>קיבוץ</span><select id="rg"><option value="day">לפי יום</option><option value="month">לפי חודש</option></select></label>
    <div class="row"><button class="btn" id="rshow">הצג</button><button class="btn g" id="rcsv">ייצוא לאקסל</button></div></div><div id="rout"></div>`;
  const sync = () => { const k = $('#rr', root).value; $('#rdates', root).hidden = k === 'deferred'; $('#rgl', root).hidden = k !== 'sales'; };
  $('#rr', root).onchange = sync; sync();
  const input = (format) => { const k = $('#rr', root).value; const i = { report: k, format }; if (k !== 'deferred') { i.from = $('#rf', root).value; i.to = $('#rt', root).value; } if (k === 'sales') i.groupBy = $('#rg', root).value; return i; };
  $('#rshow', root).onclick = async (ev) => {
    const k = $('#rr', root).value; const [, cols, money] = REPORTS[k];
    const r = await busy(ev.target, () => api.getReports(input('json')));
    if (!r) return;
    const cell = (row, c) => { const v = row[c]; if (c === 'state') return esc(STATE_HE[v] || v || ''); return money.includes(c) ? ils(v) : esc(v == null ? '' : v); };
    $('#rout', root).innerHTML = `<div class="card" style="overflow-x:auto">${r.isDemo ? '<p class="note"><span class="tag gold">דמו</span> נתוני בדיקה – לא נתוני העסק</p>' : ''}${r.rows.length ? `<table id="rtab"><tr>${cols.map((c) => `<th>${esc(c[1])}</th>`).join('')}</tr>${r.rows.map((row) => `<tr>${cols.map((c) => `<td>${cell(row, c[0])}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="note" id="rempty">אין נתונים בטווח.</p>'}${r.totals ? `<div class="sum tot"><span>סה"כ נטו</span><b id="rtot">${ils(r.totals.total)}</b></div>` : ''}</div>`;
  };
  $('#rcsv', root).onclick = async (ev) => {
    const r = await busy(ev.target, () => api.getReports(input('csv')), 'הקובץ נשמר');
    if (r && r.csv != null) await saveFile(r.filename || 'report.csv', new TextEncoder().encode(r.csv), 'text/csv');
  };
});

// ---------- בקשות למוצרים ----------
const REQ_STATUS = { new: 'חדשה', added_to_order: 'נוספה להזמנה', closed: 'נסגרה' };
const requests = mgrOnly(async (root, ctx) => {
  const list = await api.listProductRequests();
  if (!root.isConnected) return;
  root.innerHTML = `<h2>בקשות למוצרים <small class="note">(${list.length})</small></h2>${list.map((r) => li(r.id, esc(r.text || ''), `${esc(fmtTime(r.createdAt))} · כמות ${esc(r.qty || 1)} · ${esc((r.contact && (r.contact.name || r.contact.email)) || (r.customerUid ? 'לקוח רשום' : ''))}`,
    `<span class="tag ${r.status === 'new' ? 'gold' : 'ok'}">${esc(REQ_STATUS[r.status] || r.status)}</span>${r.isDemo ? '<span class="tag gold">דמו</span>' : ''}`)).join('') || '<p class="note" id="empty">אין בקשות.</p>'}`;
  $$('.li[data-id]', root).forEach((b) => { b.onclick = () => ctx.open((rt) => requestView(rt, ctx, list.find((x) => x.id === b.dataset.id))); });
});
async function requestView(root, ctx, r) {
  const orders = r.customerUid && r.status === 'new' ? (await api.listCustomerOrders(r.customerUid)).filter((o) => o.status === 'stock_check') : [];
  if (!root.isConnected) return;
  root.innerHTML = `${back}<h2>בקשה: ${esc(r.text)}</h2><div class="card"><p>כמות ${esc(r.qty || 1)} · ${esc(REQ_STATUS[r.status] || r.status)}</p>
    ${r.details ? `<p>${esc(r.details)}</p>` : ''}${r.link ? `<p class="note" dir="ltr">${esc(r.link)}</p>` : ''}
    <p class="note">${r.contact ? esc([r.contact.name, r.contact.email, r.contact.phone].filter(Boolean).join(' · ')) : 'לקוח רשום'}${r.price != null ? ' · מחיר שנקבע ' + ils(r.price) : ''}</p></div>
    ${r.status !== 'new' ? '' : orders.length ? `<div class="card"><h3 style="margin-top:0">הוספה להזמנה</h3><p class="note">אפשר להוסיף רק להזמנה של הלקוח שבבדיקת מלאי ועוד לא חויבה. הלקוח יקבל בקשת אישור.</p>
      <label class="f"><span>הזמנה</span><select id="rqo">${orders.map((o) => `<option value="${esc(o.id)}">${esc(o.orderNumber || o.id)}</option>`).join('')}</select></label>
      <label class="f"><span>מחיר לחבילה (לפי סוג הלקוח: כולל מע"מ לפרטי, לפני מע"מ לסיטונאי)</span><input id="rqp" inputmode="decimal" dir="ltr"></label>
      <button class="btn w" id="rqadd">הוסף להזמנה ושלח לאישור</button></div>` : '<p class="note" id="rqno">אין הזמנה של הלקוח בבדיקת מלאי שאפשר להוסיף לה.</p>'}`;
  bk(root, ctx);
  if ($('#rqadd', root)) $('#rqadd', root).onclick = async (ev) => {
    const price = $('#rqp', root).value.trim().replace(/^(\d+),(\d{1,2})$/, '$1.$2');
    if (!price) { toast('חובה להזין מחיר', true); return; }
    const res = await busy(ev.target, () => api.addRequestedItemToOrder({ requestId: r.id, orderId: $('#rqo', root).value, unitPrice: /^\d+(\.\d+)?$/.test(price) ? Number(price) : price }), 'המוצר נוסף, ונשלחה ללקוח בקשת אישור');
    if (res) ctx.back();
  };
}

// ---------- שירות לקוחות: ביטול לבקשת לקוח, וקישור לוואטסאפ ----------
const service = mgrOnly(async (root, ctx) => {
  root.innerHTML = `<h2>שירות לקוחות</h2><div class="card"><label class="f"><span>מספר הזמנה</span><input id="sq" autocomplete="off" dir="ltr"></label><button class="btn w" id="sgo">חפש</button></div><div id="sres"></div>`;
  const find = async (ev) => {
    const num = $('#sq', root).value.trim();
    if (!num) { toast('הקלד מספר הזמנה', true); return; }
    const rows = await busy(ev && ev.target, () => api.listOrdersByNumber(num));
    if (!rows || !root.isConnected) return;
    const box = $('#sres', root);
    if (!rows.length) { box.innerHTML = '<p class="note" id="sempty">לא נמצאה הזמנה במספר הזה.</p>'; return; }
    box.innerHTML = rows.map((o) => { const wa = waLink(o.contact && o.contact.phone); return `<div class="card" data-oid="${esc(o.id)}"><p><b>הזמנה ${esc(o.orderNumber)}</b> · ${esc(statusText(o.status))}</p>
      <p>${esc((o.contact && o.contact.name) || '')} · <span dir="ltr">${esc((o.contact && o.contact.phone) || '')}</span></p>
      <div class="row">${wa ? `<a class="btn g" data-wa href="${esc(wa)}" target="_blank" rel="noopener">וואטסאפ ללקוח</a>` : ''}
      ${o.status !== 'cancelled' && o.status !== 'completed' ? '<button class="btn bad" data-cancel>ביטול לבקשת הלקוח</button>' : ''}<button class="btn g" data-open>פתיחת ההזמנה</button></div></div>`; }).join('');
    $$('[data-open]', box).forEach((b) => { b.onclick = () => ctx.open((r) => adminOrder(r, ctx, b.closest('[data-oid]').dataset.oid)); });
    $$('[data-cancel]', box).forEach((b) => { b.onclick = async () => {
      const o = rows.find((x) => x.id === b.closest('[data-oid]').dataset.oid);
      const f = await cancelFlow(o.id, o.orderNumber, 'customer_request', false);
      if (!f) return;
      const r = await busy(b, () => api.cancelOrder(f.input), doneText);
      if (r) find();
    }; });
  };
  $('#sgo', root).onclick = find;
});

// ---------- התראות אבטחה ----------
const ALERT_HE = { staff_change: 'שינוי בהרשאות הצוות', staff_new_device: 'כניסת צוות ממכשיר חדש', failed_logins: 'כניסות כושלות', price_change: 'שינוי מחירים', money_out: 'זיכוי / ביטול / חיוב גבוה', deferred_payment: 'שוטף: התקבל תשלום / לגבות', failed_payments: 'תשלומים שנכשלו', employee_orders: 'עובד פתח הרבה הזמנות', app_check: 'חסימות App Check' };
const alerts = mgrOnly(async (root) => {
  const list = (await api.listSecurityAlerts()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!root.isConnected) return;
  root.innerHTML = `<h2>התראות אבטחה <small class="note">(${list.length})</small></h2>${list.map((a) => `<div class="card"><b>${esc(a.title || ALERT_HE[a.alertType] || a.alertType)}</b>${a.isDemo ? ' <span class="tag gold">דמו</span>' : ''}<p class="note">${esc(fmtTime(a.createdAt))} · ${esc(ALERT_HE[a.alertType] || a.alertType || '')}</p></div>`).join('') || '<p class="note" id="empty">אין התראות.</p>'}`;
});

const scr = (id, title, render) => ({ id, title, roles: ['manager'], render });
export default [
  scr('a-dash', 'לוח בקרה', dashboard), scr('a-orders', 'כל ההזמנות', allOrders), scr('a-inv', 'חשבוניות', invoices), scr('a-rep', 'דוחות', reports),
  scr('a-req', 'בקשות מוצרים', requests), scr('a-svc', 'שירות לקוחות', service), scr('a-alerts', 'התראות אבטחה', alerts),
];
