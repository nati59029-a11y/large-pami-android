/* מסך "לקוחות סיטונאים" (מנהל): פתיחת כרטיס סיטונאי עם תנאים, ומחירים סיטונאיים אישיים.
   הסיטונאי מקבל מייל עם קישור להגדרת סיסמה (בשלב 1 – רק ליומן מקומי בשרת). המנהל לא רואה את הקישור ולא את הסיסמה.
   המחיר הסיטונאי הבסיסי של כל מוצר נקבע במסך המוצר. */
import * as api from '../api.js';
import { esc, $, $$, ils, toast, busy, val, numOrText } from '../ui.js';

async function render(root, ctx) {
  const list = (await api.listWholesaleCustomers()).sort((a, b) => String(a.companyName).localeCompare(String(b.companyName), 'he'));
  root.innerHTML = `<h2>לקוחות סיטונאים <small class="note">(${list.length})</small></h2>
    <button class="btn w" id="add" style="margin-bottom:10px">＋ פתיחת סיטונאי</button>
    ${list.map((c) => `<button class="li" data-id="${esc(c.id)}"><div class="m"><b>${esc(c.companyName || '')}</b><small>${esc(c.name || '')} · <span dir="ltr">${esc(c.email || '')}</span></small></div>${c.active === false ? '<span class="tag bad">מושבת</span>' : ''}${c.isDemo ? '<span class="tag gold">דמו</span>' : ''}</button>`).join('') || '<p class="note">אין עדיין סיטונאים.</p>'}`;
  $('#add').onclick = () => ctx.open((r) => create(r, ctx));
  $$('.li[data-id]').forEach((b) => { b.onclick = () => ctx.open((r) => detail(r, ctx, list.find((c) => c.id === b.dataset.id))); });
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

async function detail(root, ctx, c) {
  const [terms, prices, products] = await Promise.all([api.getTerms(c.id), api.listPersonalPrices(c.id), api.listProducts()]);
  const t = terms || {};
  const pn = (id) => { const p = products.find((x) => x.id === id); return p ? `${p.name} · ${p.sku}` : id; };
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${esc(c.companyName || '')}</h2>
    <div class="card"><p>${esc(c.name || '')} · <span dir="ltr">${esc(c.email || '')}</span>${c.phone ? ' · <span dir="ltr">' + esc(c.phone) + '</span>' : ''}</p>
    <p class="note">הנחה אישית: ${t.discountPercent != null ? esc(t.discountPercent) + '%' : 'אין'} · תשלום: ${t.paymentTerms === 'deferred' ? 'שוטף ' + esc(t.deferredDays || '') + ' ימים' : 'כרטיס אשראי'}${t.minOrderAmount != null ? ' · מינימום ' + ils(t.minOrderAmount) : ''}</p></div>
    <h3>מחירים אישיים (${prices.length})</h3>
    <div class="card">${prices.length ? `<table><tr><th>מוצר</th><th>מחיר</th><th></th></tr>${prices.map((p) => `<tr data-pid="${esc(p.id)}"><td>${esc(pn(p.id))}</td><td>${ils(p.price)}</td><td><button class="btn bad s" data-rm>הסר</button></td></tr>`).join('')}</table>` : '<p class="note">אין מחירים אישיים. הסיטונאי מקבל את המחיר הסיטונאי הבסיסי (פחות ההנחה האישית, אם יש).</p>'}</div>
    <div class="card"><h3 style="margin-top:0">הוספה או שינוי של מחיר אישי</h3>
    <label class="f"><span>מוצר</span><input id="pq" placeholder="חיפוש לפי שם או מק״ט"><select id="ps"></select></label>
    <label class="f"><span>מחיר אישי לחבילה (כולל מע"מ)</span><input id="pp" inputmode="decimal" dir="ltr"></label>
    <button class="btn w" id="padd">שמור מחיר</button></div>`;
  $('#bk').onclick = () => ctx.back();
  const opts = (q) => { const s = q.trim().toLowerCase(); $('#ps').innerHTML = '<option value="">בחר מוצר</option>' + products.filter((p) => !s || String(p.name).toLowerCase().includes(s) || String(p.sku).toLowerCase().includes(s)).slice(0, 60).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.sku)}</option>`).join(''); };
  opts(''); $('#pq').oninput = (e) => opts(e.target.value);
  $('#padd').onclick = async (ev) => {
    if (!$('#ps').value) { toast('בחר מוצר', true); return; }
    const r = await busy(ev.target, () => api.setWholesalePrices([{ productId: $('#ps').value, price: numOrText($('#pp').value.trim()) }], c.id), 'המחיר האישי נשמר');
    if (r) ctx.replace((rt) => detail(rt, ctx, c));
  };
  $$('[data-rm]').forEach((b) => { b.onclick = async () => { const r = await busy(b, () => api.setWholesalePrices([{ productId: b.closest('[data-pid]').dataset.pid, price: null }], c.id), 'המחיר האישי הוסר'); if (r) ctx.replace((rt) => detail(rt, ctx, c)); }; });
}

export default { id: 'customers', title: 'לקוחות', roles: ['manager'], render };
