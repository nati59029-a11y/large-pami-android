/* הזמנה של לקוח סיטונאי (שלב 1.10ב): צפייה, שינוי מחיר, "סמן כשולם", והזמנה חדשה בשם הלקוח.
   - עובד ומנהל רואים מחיר בכל שורה, סכום כולל ודמי משלוח. עלות ורווח – רק מנהל (order_costs). לעובד הם לא נטענים בכלל.
   - שינוי מחיר עובר דרך השרת (setOrderPricing). בכל שינוי שואלים אם לחשב מחדש את דמי המשלוח.
   - לעובד מוצגת רק התשובה: "מותר", "מותר עם התראה" או "אסור". בלי עלות, בלי רווח ובלי אחוזים.
   - בהזמנה של סיטונאי המחירים בשורות בלי מע"מ; בהזמנה של לקוח פרטי – כולל מע"מ (כמו בשרת). */
import * as api from '../api.js';
import { esc, $, $$, ils, toast, busy, numOrText, dialog } from '../ui.js';

export const STATUS = {
  pending_payment: 'ממתינה לתשלום', received: 'התקבלה', stock_check: 'בדיקת מלאי', awaiting_packing: 'ממתינה לאריזה', packing: 'באריזה',
  ready: 'מוכנה', out_for_delivery: 'יצאה למשלוח', delivered: 'נמסרה', cancelled: 'בוטלה', completed: 'הושלמה',
};
export const statusText = (s) => STATUS[s] || s || '—';
const PAID_METHODS = [['transfer', 'העברה בנקאית'], ['check', 'צ׳ק'], ['cash', 'מזומן'], ['other', 'אחר']];
// התשובה של השרת לשינוי מחיר – במילים, בלי מספרים
const RESULT = {
  allowed: ['ok', 'מותר – השינוי נשמר'],
  warn: ['warn', 'מותר עם התראה – השינוי נשמר, והמנהל יקבל התראה'],
  denied: ['bad', 'אסור – השינוי לא נשמר'],
};
const today = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const sameNum = (a, b) => Number(a) === Number(b);

// ---------- שלב 4.7: העיצוב שהצטרף להזמנה (תמונה + שורת סידור מקום). אם אין עיצוב – לא מוסיפים כלום ----------
// הטקסט נכנס רק דרך textContent. תמונה חסרה (או שלא נטענה) – רק שורת סידור המקום, בלי שגיאה.
export async function showOrderDesign(root, orderId, after) {
  let d = null;
  try { d = await api.getOrderDesign(orderId); } catch (e) { d = null; }
  if (!d || !root.isConnected || (!d.text && !d.url)) { if (d && d.url) URL.revokeObjectURL(d.url); return; }
  const card = document.createElement('div'); card.className = 'card'; card.id = 'odesign';
  const h = document.createElement('h3'); h.style.marginTop = '0'; h.textContent = 'עיצוב השולחן'; card.appendChild(h);
  if (d.text) { const p = document.createElement('p'); p.id = 'odesign-text'; p.textContent = d.text; card.appendChild(p); }
  if (d.url) {
    const img = document.createElement('img'); img.id = 'odesign-img'; img.alt = 'תמונת העיצוב'; img.style.cssText = 'max-width:100%;height:auto;border-radius:12px;display:block';
    img.onerror = () => img.remove();
    img.onload = () => URL.revokeObjectURL(d.url);
    img.src = d.url; card.appendChild(img);
  }
  const ref = after && root.contains(after) ? after : null;
  if (ref) ref.insertAdjacentElement('afterend', card); else root.appendChild(card);
}

// ---------- צפייה ושינוי מחיר ----------
export async function orderView(root, ctx, id, banner) {
  const mgr = api.isManager();
  const o = await api.getOrder(id);
  if (!root.isConnected) return; // המסך התחלף בזמן הטעינה
  if (!o) { root.innerHTML = '<button class="btn g s" id="bk">‹ חזרה</button><p class="err">ההזמנה לא נמצאה, או שאין לך הרשאה לראות אותה (עובד רואה רק הזמנות פתוחות).</p>'; $('#bk').onclick = () => ctx.back(); return; }
  // עלות ורווח: רק מנהל, ורק כאן. לעובד – אין קריאה בכלל.
  const costs = mgr ? await api.getOrderCosts(id).catch(() => null) : null;
  if (!root.isConnected) return;
  const pr = o.pricing || {};
  const ws = o.customerType === 'customer_wholesale';
  const exVat = pr.pricesIncludeVat === false;
  const editable = api.EDITABLE_STATUSES.includes(o.status) && (mgr || ws) && !!o.pricing;
  const byId = new Map((o.items || []).map((x) => [x.id, x]));
  const lines = (pr.items || []).map((p) => Object.assign({}, byId.get(p.itemId) || {}, p));
  const deferred = o.paymentTerms === 'deferred';
  const unitLbl = exVat ? 'מחיר לחבילה (בלי מע"מ)' : 'מחיר לחבילה (כולל מע"מ)';
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button>
    <h2>הזמנה ${esc(o.orderNumber || o.id)}</h2>
    ${banner ? `<div class="res ${banner.cls}" id="pres" role="status">${esc(banner.text)}</div>` : ''}
    <div class="card"><p>${esc((o.contact && o.contact.name) || '')} · ${esc(statusText(o.status))}${o.createdAt ? ' · ' + esc(String(o.createdAt).slice(0, 10)) : ''}</p>
    <p class="note">${o.fulfillment === 'delivery' ? 'משלוח' + (o.address ? ': ' + esc([o.address.street, o.address.city].filter(Boolean).join(', ')) : '') : 'איסוף מהחנות'}${o.source === 'staff' ? ' · נפתחה על ידי הצוות' : ''}${deferred ? ` · שוטף – <b id="pay">${o.paymentStatus === 'paid' ? 'שולם' : 'לא שולם'}</b>` : ''}</p></div>
    <div class="card" style="overflow-x:auto"><table id="olines"><tr><th>מוצר</th><th>חבילות</th><th>${unitLbl}</th><th>סה"כ שורה</th></tr>
    ${lines.map((l) => `<tr data-item="${esc(l.itemId)}"><td>${esc(l.nameSnapshot || l.productId || '')}${l.colorSnapshot ? ' · ' + esc(l.colorSnapshot) : ''}${l.priceSource === 'manual' ? ' <span class="tag gold">שונה ידנית</span>' : ''}</td><td>${esc(l.packs)}</td>
      <td>${editable ? `<input data-price inputmode="decimal" dir="ltr" value="${esc(l.unitPrice)}" aria-label="מחיר לחבילה">` : ils(l.unitPrice)}</td><td>${ils(l.lineTotal)}</td></tr>`).join('')}</table>
    <div style="margin-top:8px">
      ${pr.subtotalExVat != null ? `<div class="sum"><span>סה"כ בלי מע"מ</span><b id="sx">${ils(pr.subtotalExVat)}</b></div>` : ''}
      ${pr.vatAmount != null ? `<div class="sum"><span>מע"מ${pr.vatPercent != null ? ' (' + esc(pr.vatPercent) + '%)' : ''}</span><b>${ils(pr.vatAmount)}</b></div>` : ''}
      <div class="sum"><span>דמי משלוח</span><b id="ship">${pr.shippingFee == null ? (o.fulfillment === 'delivery' ? 'ייקבעו ידנית' : '—') : ils(pr.shippingFee)}</b></div>
      <div class="sum tot"><span>סכום כולל${pr.totalOverride != null ? ' (נקבע ידנית)' : ''}</span><b id="tot">${ils(pr.total)}</b></div>
    </div></div>
    ${mgr && costs ? `<div class="card cost"><b>רק מנהל:</b> רווח ${ils(costs.profit)}${costs.profitPercent != null ? ' (' + esc(costs.profitPercent) + '%)' : ''}${(costs.costMissing || []).length ? ' · חסרה עלות בחלק מהמוצרים' : ''}</div>` : ''}
    ${editable ? `<div class="card"><h3 style="margin-top:0">שינוי מחיר</h3>
      <p class="note">משנים את המחיר בשורה ולוחצים "שמור". ${mgr ? '' : 'השרת בודק את השינוי ועונה "מותר", "מותר עם התראה" או "אסור".'}</p>
      ${ws && o.customerUid ? '<label class="ck"><input type="checkbox" id="fixed">שמור כמחיר קבוע ללקוח</label>' : ''}
      ${mgr ? `<label class="f"><span>סכום כולל ידני (ריק = לפי השורות)</span><input id="mtot" inputmode="decimal" dir="ltr" value="${esc(pr.totalOverride == null ? '' : pr.totalOverride)}"></label>` : ''}
      <button class="btn w" id="savep">שמור שינוי מחיר</button></div>`
    : `<p class="note">${api.EDITABLE_STATUSES.includes(o.status) ? '' : 'אי אפשר לשנות מחיר אחרי החיוב או בהזמנה סגורה.'}</p>`}
    ${mgr && deferred && o.paymentStatus !== 'paid' && o.status !== 'cancelled' ? `<div class="card"><h3 style="margin-top:0">התקבל תשלום (שוטף)</h3>
      <div class="grid2"><label class="f"><span>תאריך התשלום</span><input type="date" id="pdate" value="${today()}" max="${today()}"></label>
      <label class="f"><span>אמצעי תשלום</span><select id="pmeth">${PAID_METHODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label></div>
      <p class="note">הסימון עוצר את תזכורות התשלום ללקוח. הקבלה והסכום – בשלב 2.</p>
      <button class="btn w" id="paid">סמן כשולם</button></div>` : ''}
    ${deferred && o.paymentStatus === 'paid' ? `<p class="note">שולם${o.paidAt ? ' ב-' + esc(o.paidAt) : ''}${o.paidMethod ? ' · ' + esc((PAID_METHODS.find((m) => m[0] === o.paidMethod) || [, o.paidMethod])[1]) : ''}</p>` : ''}`;
  $('#bk').onclick = () => ctx.back();
  showOrderDesign(root, id, $('#olines').closest('.card'));
  if (editable) $('#savep').onclick = async (ev) => {
    const changed = [];
    $$('#olines [data-item]').forEach((tr) => {
      const inp = tr.querySelector('[data-price]'); const l = lines.find((x) => x.itemId === tr.dataset.item);
      const v = numOrText(inp.value.trim());
      if (!sameNum(v, l.unitPrice)) changed.push({ itemId: l.itemId, unitPrice: v });
    });
    const input = { orderId: id };
    if (changed.length) input.lines = changed;
    if (mgr) {
      const t = $('#mtot').value.trim(); const cur = pr.totalOverride == null ? '' : String(pr.totalOverride);
      if (t !== cur && !(t !== '' && cur !== '' && sameNum(numOrText(t), cur))) input.total = t === '' ? null : numOrText(t);
    }
    if (!input.lines && !Object.prototype.hasOwnProperty.call(input, 'total')) { toast('לא שונה שום מחיר'); return; }
    if ($('#fixed') && $('#fixed').checked) {
      if (!input.lines) { toast('"שמור כמחיר קבוע" חל על מחיר בשורה. שנה מחיר בשורה, או בטל את הסימון.', true); return; }
      input.saveAsFixed = true;
    }
    // בכל שינוי – שואלים אם לחשב מחדש את דמי המשלוח (החלטת המשתמש)
    const ask = await dialog(`<p><b>לחשב מחדש את דמי המשלוח?</b></p><p class="note">דמי המשלוח עכשיו: ${pr.shippingFee == null ? 'נקבעים ידנית' : ils(pr.shippingFee)}. בחישוב מחדש הם נקבעים לפי הסכום החדש ולפי כללי המשלוח.</p>`,
      [[true, 'כן, לחשב מחדש'], [false, 'לא, להשאיר', 'g']]);
    if (!ask) return;
    input.recalcShipping = ask.value;
    const r = await busy(ev.target, () => api.setOrderPricing(input));
    if (!r) return;
    const [cls, text] = RESULT[r.result] || ['bad', 'תשובה לא מוכרת מהשרת'];
    let msg = mgr && r.result !== 'denied' ? 'השינוי נשמר' : text;
    if (r.result !== 'denied') msg += r.shippingRecalculated ? ' · דמי המשלוח חושבו מחדש' : ' · דמי המשלוח לא השתנו';
    if (r.savedAsFixed) msg += ' · נשמר כמחיר קבוע ללקוח';
    ctx.replace((rt) => orderView(rt, ctx, id, { cls, text: msg }));
  };
  if ($('#paid')) $('#paid').onclick = async (ev) => {
    const r = await busy(ev.target, () => api.markDeferredPaid({ orderId: id, paidAt: $('#pdate').value, paidMethod: $('#pmeth').value }));
    if (r) ctx.replace((rt) => orderView(rt, ctx, id, { cls: 'ok', text: r.alreadyPaid ? 'ההזמנה כבר סומנה כשולמה' : 'סומן כשולם. תזכורות התשלום נעצרו.' }));
  };
}

// ---------- הזמנה חדשה בשם לקוח סיטונאי ----------
export async function newOrder(root, ctx, c) {
  const [products, pub] = await Promise.all([api.listProducts(), api.getSettings('public')]);
  if (!root.isConnected) return;
  const prods = products.filter((p) => p.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  const zones = ((pub && pub.shipping && pub.shipping.zones) || []).filter((z) => z && z.id && z.pickupOnly !== true);
  const items = []; // { productId, variantId, packs, name, color }
  let quoteOk = false;
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>הזמנה חדשה: ${esc(c.companyName || c.name || '')}</h2>
    <div class="card"><h3 style="margin-top:0">מוצרים</h3>
    <label class="f"><span>מוצר</span><input id="nq" placeholder="חיפוש לפי שם או מק״ט"><select id="np"></select></label>
    <div class="grid2"><label class="f"><span>צבע</span><select id="nv"><option value="">—</option></select></label>
    <label class="f"><span>חבילות</span><input id="nk" inputmode="numeric" dir="ltr" value="1"></label></div>
    <button class="btn g w" id="nadd">＋ הוסף לשורות</button>
    <div id="nlines" style="margin-top:10px"></div></div>
    <div class="card"><h3 style="margin-top:0">אספקה</h3>
    <label class="f"><span>אספקה</span><select id="nf"><option value="pickup">איסוף מהחנות</option>${zones.length ? '<option value="delivery">משלוח</option>' : ''}</select></label>
    <div id="ndel" hidden><label class="f"><span>אזור משלוח</span><select id="nz">${zones.map((z) => `<option value="${esc(z.id)}">${esc(z.name || z.id)}</option>`).join('')}</select></label>
    <div class="grid2"><label class="f"><span>רחוב ומספר</span><input id="ns"></label><label class="f"><span>עיר</span><input id="nc"></label></div>
    <label class="f"><span>הערות לכתובת</span><input id="nn"></label></div></div>
    <button class="btn w" id="nprev">תצוגה מקדימה</button>
    <div id="nquote" style="margin-top:12px"></div>`;
  $('#bk').onclick = () => ctx.back();
  const pName = (id) => { const p = prods.find((x) => x.id === id); return p ? p.name : id; };
  const resetQuote = () => { quoteOk = false; $('#nquote').innerHTML = ''; };
  const opts = (q) => { const s = q.trim().toLowerCase(); $('#np').innerHTML = '<option value="">בחר מוצר</option>' + prods.filter((p) => !s || String(p.name).toLowerCase().includes(s) || String(p.sku).toLowerCase().includes(s)).slice(0, 80).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.sku)}</option>`).join(''); };
  opts(''); $('#nq').oninput = (e) => opts(e.target.value);
  $('#np').onchange = async () => {
    const pid = $('#np').value; $('#nv').innerHTML = '<option value="">—</option>';
    if (!pid) return;
    const vs = await api.listVariants(pid).catch(() => []);
    $('#nv').innerHTML = vs.length ? vs.map((v) => `<option value="${esc(v.id)}" ${v.soldOut ? 'disabled' : ''}>${esc(v.colorName || v.id)}${v.soldOut ? ' (אזל)' : ''}</option>`).join('') : '<option value="">בלי צבע</option>';
  };
  const drawLines = () => {
    $('#nlines').innerHTML = items.length ? `<table><tr><th>מוצר</th><th>חבילות</th><th></th></tr>${items.map((it, i) => `<tr><td>${esc(it.name)}${it.color ? ' · ' + esc(it.color) : ''}</td><td>${esc(it.packs)}</td><td><button class="btn bad s" data-rm="${i}">הסר</button></td></tr>`).join('')}</table>` : '<p class="note">עוד לא נוספו מוצרים.</p>';
    $$('#nlines [data-rm]').forEach((b) => { b.onclick = () => { items.splice(Number(b.dataset.rm), 1); resetQuote(); drawLines(); }; });
  };
  drawLines();
  $('#nadd').onclick = () => {
    const pid = $('#np').value; const packs = Number($('#nk').value.trim());
    if (!pid) { toast('בחר מוצר', true); return; }
    if (!Number.isInteger(packs) || packs < 1) { toast('מספר חבילות: מספר שלם מ-1', true); return; }
    const vSel = $('#nv'); const vid = vSel.value || null;
    items.push({ productId: pid, variantId: vid, packs, name: pName(pid), color: vid ? vSel.options[vSel.selectedIndex].text : '' });
    resetQuote(); drawLines();
  };
  $('#nf').onchange = () => { $('#ndel').hidden = $('#nf').value !== 'delivery'; resetQuote(); };
  ['#nz', '#ns', '#nc', '#nn'].forEach((s) => { $(s).oninput = resetQuote; $(s).onchange = resetQuote; });
  const input = (preview) => {
    const f = $('#nf').value;
    const x = { customerUid: c.id, items: items.map((it) => Object.assign({ productId: it.productId, packs: it.packs }, it.variantId ? { variantId: it.variantId } : {})), fulfillment: f };
    if (f === 'delivery') { x.zoneId = $('#nz').value; x.address = { street: $('#ns').value.trim(), city: $('#nc').value.trim(), notes: $('#nn').value.trim() }; }
    if (preview) x.preview = true;
    return x;
  };
  $('#nprev').onclick = async (ev) => {
    if (!items.length) { toast('הוסף לפחות מוצר אחד', true); return; }
    const r = await busy(ev.target, () => api.createOrderForCustomer(input(true)));
    if (!r || !r.quote) return;
    const q = r.quote; const ex = q.pricesIncludeVat === false;
    const name = (l) => { const it = items.find((x) => x.productId === l.productId && (x.variantId || null) === (l.variantId || null)); return it ? it.name + (it.color ? ' · ' + it.color : '') : pName(l.productId); };
    $('#nquote').innerHTML = `<div class="card" id="qcard"><h3 style="margin-top:0">תצוגה מקדימה – עוד לא נשלח</h3>
      <div style="overflow-x:auto"><table><tr><th>מוצר</th><th>חבילות</th><th>${ex ? 'מחיר (בלי מע"מ)' : 'מחיר'}</th><th>סה"כ</th></tr>
      ${q.lines.map((l) => `<tr><td>${esc(name(l))}</td><td>${esc(l.packs)}</td><td>${ils(l.unitPrice)}</td><td>${ils(l.lineTotal)}</td></tr>`).join('')}</table></div>
      ${q.subtotalExVat != null ? `<div class="sum"><span>סה"כ בלי מע"מ</span><b>${ils(q.subtotalExVat)}</b></div>` : ''}
      ${q.vatAmount != null ? `<div class="sum"><span>מע"מ</span><b>${ils(q.vatAmount)}</b></div>` : ''}
      <div class="sum"><span>דמי משלוח</span><b>${q.shippingFee == null ? (input(false).fulfillment === 'delivery' ? 'ייקבעו ידנית' : '—') : ils(q.shippingFee)}</b></div>
      <div class="sum tot"><span>סכום כולל</span><b id="qtot">${ils(q.total)}</b></div>
      ${q.belowMinimum ? `<p class="err">ההזמנה מתחת למינימום של הלקוח (${ils(q.minOrderAmount)} בלי מע"מ). אי אפשר לשלוח.</p>` : ''}
      <p class="note">${q.paymentTerms === 'deferred' ? 'הלקוח בשוטף: ההזמנה תיכנס ישר לכרטיס שלו, בלי תשלום עכשיו. הלקוח יקבל מייל שההזמנה בוצעה.' : 'הלקוח משלם בכרטיס אשראי: קישור לתשלום יישלח רק למייל של הלקוח, וגם מייל שההזמנה בוצעה.'}</p>
      ${q.belowMinimum ? '' : '<button class="btn w" id="nsend">שלח הזמנה</button>'}</div>`;
    quoteOk = true;
    if (!$('#nsend')) return;
    $('#nsend').onclick = async (e2) => {
      if (!quoteOk) { toast('משהו השתנה. הצג תצוגה מקדימה שוב.', true); return; }
      const res = await busy(e2.target, () => api.createOrderForCustomer(input(false)));
      if (!res) return;
      toast(`ההזמנה ${res.orderNumber} נוצרה${res.placedMailSent ? '. נשלח מייל ללקוח' : ''}${res.paymentLinkSent ? ', עם קישור לתשלום' : ''}`);
      ctx.replace((rt) => orderView(rt, ctx, res.orderId));
    };
  };
}
