/* מסך "לקוחות סיטונאים": רשימה, וכרטיס לכל לקוח (שלב 1.10ב) – הזמנות, חשבוניות (רשימה; החשבוניות נבנות בשלב 2)
   והזמנה חדשה בשם הלקוח. מנהל ועובד פעיל. עובד רואה רק הזמנות פתוחות, ולא רואה תנאים, מחירים אישיים או עלות.
   רק מנהל: פתיחת כרטיס סיטונאי עם תנאים, תנאי תשלום ותזכורות (setPaymentTerms), ומחירים סיטונאיים אישיים.
   הסיטונאי מקבל מייל עם קישור להגדרת סיסמה (בשלב 1 – רק ליומן מקומי בשרת). המנהל לא רואה את הקישור ולא את הסיסמה.
   המחיר הסיטונאי הבסיסי של כל מוצר נקבע במסך המוצר. */
import * as api from '../api.js';
import { esc, $, $$, ils, toast, busy, val, numOrText } from '../ui.js';
import { orderView, newOrder, statusText } from './order.js';
import { deferredSection } from './deferred.js';
import { invNo, stateTag } from './money.js';

async function render(root, ctx) {
  const list = (await api.listWholesaleCustomers()).sort((a, b) => String(a.companyName).localeCompare(String(b.companyName), 'he'));
  if (!root.isConnected) return;
  root.innerHTML = `<h2>לקוחות סיטונאים <small class="note">(${list.length})</small></h2>
    ${api.isManager() ? '<button class="btn w" id="add" style="margin-bottom:10px">＋ פתיחת סיטונאי</button>' : ''}
    ${list.map((c) => `<button class="li" data-id="${esc(c.id)}"><div class="m"><b>${esc(c.companyName || '')}</b><small>${esc(c.name || '')} · <span dir="ltr">${esc(c.email || '')}</span></small></div>${c.active === false ? '<span class="tag bad">מושבת</span>' : ''}${api.isManager() ? stateTag(c) : ''}${c.isDemo ? '<span class="tag gold">דמו</span>' : ''}</button>`).join('') || '<p class="note">אין עדיין סיטונאים.</p>'}`;
  if ($('#add', root)) $('#add', root).onclick = () => ctx.open((r) => create(r, ctx));
  $$('.li[data-id]', root).forEach((b) => { b.onclick = () => ctx.open((r) => detail(r, ctx, list.find((c) => c.id === b.dataset.id))); });
}

async function create(root, ctx) {
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>פתיחת סיטונאי</h2>
    <form id="cf" class="card" onsubmit="return false">
    <label class="f"><span>מייל (לכניסה לאתר)</span><input name="email" type="email" dir="ltr" required></label>
    <label class="f"><span>שם איש הקשר</span><input name="name" required></label>
    <label class="f"><span>שם החברה</span><input name="companyName" required></label>
    <div class="grid2"><label class="f"><span>ח"פ / עוסק</span><input name="companyId" inputmode="numeric" dir="ltr"></label><label class="f"><span>טלפון</span><input name="phone" type="tel" dir="ltr"></label></div>
    <h3>תנאים</h3>
    <div class="grid2"><label class="f"><span>הנחה אישית (%)</span><input name="discountPercent" inputmode="decimal" dir="ltr"></label>
    <label class="f"><span>תנאי תשלום</span><select name="paymentTerms"><option value="card">כרטיס אשראי</option><option value="deferred">שוטף</option></select></label>
    <label class="f"><span>ימי שוטף (בשוטף בלבד)</span><input name="deferredDays" inputmode="numeric" dir="ltr"></label>
    <label class="f"><span>מספר תשלומים מרבי (ריק = רגיל)</span><input name="maxInstallmentsOverride" inputmode="numeric" dir="ltr"></label>
    <label class="f"><span>מינימום הזמנה (₪)</span><input name="minOrderAmount" inputmode="decimal" dir="ltr"></label>
    <label class="f"><span>דמי משלוח מיוחדים (₪)</span><input name="shipFee" inputmode="decimal" dir="ltr"></label>
    <label class="f"><span>משלוח חינם מסכום מיוחד (₪)</span><input name="shipFree" inputmode="decimal" dir="ltr"></label></div>
    </form><button class="btn w" id="save">פתח כרטיס ושלח קישור להגדרת סיסמה</button>`;
  $('#bk').onclick = () => ctx.back();
  $('#save').onclick = async (ev) => {
    const f = $('#cf'); const n = (k) => numOrText(val(f, k));
    const terms = { discountPercent: n('discountPercent'), paymentTerms: val(f, 'paymentTerms'), deferredDays: n('deferredDays'), maxInstallmentsOverride: n('maxInstallmentsOverride'), minOrderAmount: n('minOrderAmount') };
    if (val(f, 'shipFee') !== '' || val(f, 'shipFree') !== '') terms.shippingOverride = { fee: n('shipFee'), freeFrom: n('shipFree') };
    const input = { email: val(f, 'email'), name: val(f, 'name'), companyName: val(f, 'companyName'), terms };
    if (val(f, 'companyId')) input.companyId = val(f, 'companyId');
    if (val(f, 'phone')) input.phone = val(f, 'phone');
    const r = await busy(ev.target, () => api.createWholesaleCustomer(input), (x) => (x.mailSent ? 'הכרטיס נפתח, ונשלח מייל להגדרת סיסמה' : 'הכרטיס נפתח, אבל המייל לא נשלח'));
    if (r) ctx.replace((rt) => render(rt, ctx));
  };
}

// תזכורות תשלום של לקוח: null = לפי ההגדרה הכללית, { enabled: false } = כבוי, { enabled: true, days } = זמנים משלו
const remText = (r) => (r == null ? 'לפי ההגדרה הכללית' : r.enabled === false ? 'כבויות' : 'זמנים משלו: ' + (r.days || []).join(', ') + ' ימים');
const remMode = (r) => (r == null ? 'default' : r.enabled === false ? 'off' : 'custom');
const parseDays = (t) => t.split(/[,\s]+/).filter(Boolean).map((x) => Number(x));

async function detail(root, ctx, c) {
  const mgr = api.isManager();
  const [orders, invoices] = await Promise.all([api.listCustomerOrders(c.id), api.listCustomerInvoices(c.id)]);
  orders.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const pricing = await Promise.all(orders.slice(0, 60).map((o) => api.getOrderPricing(o.id).catch(() => null)));
  if (!root.isConnected) return; // המסך התחלף בזמן הטעינה
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${esc(c.companyName || c.name || '')}</h2>
    <div class="card"><p>${esc(c.name || '')} · <span dir="ltr">${esc(c.email || '')}</span>${c.phone ? ' · <span dir="ltr">' + esc(c.phone) + '</span>' : ''}${c.active === false ? ' <span class="tag bad">מושבת</span>' : ''}</p></div>
    <button class="btn w" id="neworder" style="margin-bottom:12px">＋ הזמנה חדשה ללקוח</button>
    <h3>הזמנות (${orders.length})</h3>${mgr ? '' : '<p class="note">מוצגות רק הזמנות פתוחות.</p>'}
    <div id="orders">${orders.map((o, i) => `<button class="li" data-oid="${esc(o.id)}"><div class="m"><b>${esc(o.orderNumber || o.id)}</b><small>${esc(String(o.createdAt || '').slice(0, 10))} · ${esc(statusText(o.status))}${pricing[i] ? ' · ' + ils(pricing[i].total) : ''}</small></div>${o.paymentTerms === 'deferred' ? `<span class="tag ${o.paymentStatus === 'paid' ? 'ok' : 'gold'}">${o.paymentStatus === 'paid' ? 'שולם' : 'שוטף – לא שולם'}</span>` : ''}${o.source === 'staff' ? '<span class="tag">צוות</span>' : ''}</button>`).join('') || '<p class="note">אין הזמנות.</p>'}</div>
    <h3>חשבוניות (${invoices.length})</h3>
    <div class="card" id="invoices">${invoices.length ? `<table><tr><th>מספר</th><th>תאריך</th><th>סכום</th></tr>${invoices.map((v) => `<tr><td>${esc(invNo(v))}</td><td>${esc(String(v.issuedAt || v.date || v.createdAt || '').slice(0, 10))}</td><td>${ils(v.total)}</td></tr>`).join('')}</table>` : '<p class="note">אין עדיין חשבוניות. הפקת החשבוניות תיבנה בשלב 2.</p>'}</div>
    <div id="dfPart"></div><div id="mgrPart"></div>`;
  $('#bk', root).onclick = () => ctx.back();
  $('#neworder', root).onclick = () => ctx.open((r) => newOrder(r, ctx, c));
  $$('#orders [data-oid]', root).forEach((b) => { b.onclick = () => ctx.open((r) => orderView(r, ctx, b.dataset.oid)); });
  if (mgr) {
    await deferredSection($('#dfPart', root), c, invoices, async () => { const fr = await api.getCustomer(c.id).catch(() => null); ctx.replace((rt) => detail(rt, ctx, fr || c)); });
    await managerPart($('#mgrPart', root), ctx, c);
  }
}

// רק מנהל: תנאי תשלום ותזכורות, ומחירים אישיים
async function managerPart(box, ctx, c) {
  const [terms, prices, products] = await Promise.all([api.getTerms(c.id), api.listPersonalPrices(c.id), api.listProducts()]);
  if (!box.isConnected) return; // המסך התחלף בזמן הטעינה
  const t = terms || {};
  const pn = (id) => { const p = products.find((x) => x.id === id); return p ? `${p.name} · ${p.sku}` : id; };
  const rm = remMode(t.paymentReminders);
  box.innerHTML = `<h3>תנאים – רק מנהל</h3>
    <div class="card"><p class="note">הנחה אישית: ${t.discountPercent != null ? esc(t.discountPercent) + '%' : 'אין'} · תשלום: ${t.paymentTerms === 'deferred' ? 'שוטף ' + esc(t.deferredDays || '') + ' ימים' : 'כרטיס אשראי'}${t.minOrderAmount != null ? ' · מינימום ' + ils(t.minOrderAmount) + ' (בלי מע"מ)' : ''} · תזכורות: ${esc(remText(t.paymentReminders))}</p>
    <form id="tf" onsubmit="return false"><div class="grid2"><label class="f"><span>תנאי תשלום</span><select name="paymentTerms"><option value="card" ${t.paymentTerms !== 'deferred' ? 'selected' : ''}>כרטיס אשראי</option><option value="deferred" ${t.paymentTerms === 'deferred' ? 'selected' : ''}>שוטף</option></select></label>
    <label class="f"><span>ימי שוטף</span><input name="deferredDays" inputmode="numeric" dir="ltr" value="${esc(t.deferredDays == null ? '' : t.deferredDays)}"></label></div>
    <label class="f"><span>תזכורות תשלום (בשוטף)</span><select name="rmode"><option value="default" ${rm === 'default' ? 'selected' : ''}>לפי ההגדרה הכללית</option><option value="off" ${rm === 'off' ? 'selected' : ''}>כבויות ללקוח הזה</option><option value="custom" ${rm === 'custom' ? 'selected' : ''}>זמנים משלו</option></select></label>
    <label class="f"><span>תקרת חוב בשוטף (₪, ריק = בלי תקרה)</span><input name="creditLimit" inputmode="decimal" dir="ltr" value="${esc(t.creditLimit == null ? '' : t.creditLimit)}"></label>
    <label class="f" id="rdl" ${rm === 'custom' ? '' : 'hidden'}><span>ימים יחסית למועד התשלום (שלילי = לפני), מופרדים בפסיק</span><input name="rdays" dir="ltr" value="${esc(rm === 'custom' ? (t.paymentReminders.days || []).join(', ') : '-3, 0, 7')}"></label>
    <button class="btn w" id="savet">שמור תנאי תשלום</button></form></div>
    <h3>מחירים אישיים (${prices.length})</h3>
    <div class="card">${prices.length ? `<table><tr><th>מוצר</th><th>מחיר (בלי מע"מ)</th><th></th></tr>${prices.map((p) => `<tr data-pid="${esc(p.id)}"><td>${esc(pn(p.id))}</td><td>${ils(p.price)}</td><td><button class="btn bad s" data-rm>הסר</button></td></tr>`).join('')}</table>` : '<p class="note">אין מחירים אישיים. הסיטונאי מקבל את המחיר הסיטונאי הבסיסי (פחות ההנחה האישית, אם יש).</p>'}</div>
    <div class="card"><h3 style="margin-top:0">הוספה או שינוי של מחיר אישי</h3>
    <label class="f"><span>מוצר</span><input id="pq" placeholder="חיפוש לפי שם או מק״ט"><select id="ps"></select></label>
    <label class="f"><span>מחיר אישי לחבילה (בלי מע"מ)</span><input id="pp" inputmode="decimal" dir="ltr"></label>
    <button class="btn w" id="padd">שמור מחיר</button></div>`;
  const f = $('#tf', box);
  f.elements.rmode.onchange = () => { $('#rdl', box).hidden = f.elements.rmode.value !== 'custom'; };
  $('#savet', box).onclick = async (ev) => {
    const mode = f.elements.rmode.value;
    const input = { customerUid: c.id, paymentTerms: f.elements.paymentTerms.value, deferredDays: f.elements.paymentTerms.value === 'deferred' ? numOrText(val(f, 'deferredDays')) : null,
      paymentReminders: mode === 'default' ? null : mode === 'off' ? { enabled: false } : { enabled: true, days: parseDays(val(f, 'rdays')) } };
    if (val(f, 'creditLimit') !== String(t.creditLimit == null ? '' : t.creditLimit)) input.creditLimit = numOrText(val(f, 'creditLimit')); // נשלח רק אם שונה
    const r = await busy(ev.target, () => api.setPaymentTerms(input), (x) => (x.changed ? 'תנאי התשלום נשמרו' : 'לא היה מה לשנות'));
    if (r) ctx.replace((rt) => detail(rt, ctx, c));
  };
  const opts = (q) => { const s = q.trim().toLowerCase(); $('#ps', box).innerHTML = '<option value="">בחר מוצר</option>' + products.filter((p) => !s || String(p.name).toLowerCase().includes(s) || String(p.sku).toLowerCase().includes(s)).slice(0, 60).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.sku)}</option>`).join(''); };
  opts(''); $('#pq', box).oninput = (e) => opts(e.target.value);
  $('#padd', box).onclick = async (ev) => {
    if (!$('#ps', box).value) { toast('בחר מוצר', true); return; }
    const r = await busy(ev.target, () => api.setWholesalePrices([{ productId: $('#ps', box).value, price: numOrText($('#pp', box).value.trim()) }], c.id), 'המחיר האישי נשמר');
    if (r) ctx.replace((rt) => detail(rt, ctx, c));
  };
  $$('[data-rm]', box).forEach((b) => { b.onclick = async () => { const r = await busy(b, () => api.setWholesalePrices([{ productId: b.closest('[data-pid]').dataset.pid, price: null }], c.id), 'המחיר האישי הוסר'); if (r) ctx.replace((rt) => detail(rt, ctx, c)); }; });
}

export default { id: 'customers', title: 'לקוחות', roles: ['manager', 'employee'], render };
