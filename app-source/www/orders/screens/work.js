/* מסכי העובד של "הזמנות אתר" (שלב 2.6א, פרק 6.2 באפיון): הזמנות חדשות, בדיקת מלאי, תור אריזה, אריזה, משלוחים ואיסופים, וההיסטוריה שלי.
   - כל חישוב וכל החלטה בשרת. כאן רק מציגים את מה שהשרת שמר (order_pricing) ושולחים פעולות. הסכום ליד "יש הכול" הוא הסכום השמור בשרת.
   - אין כאן עלות ורווח בשום מקום: order_costs לא נקרא בכלל. ב"ההיסטוריה שלי" אין שם, כתובת וטלפון (השרת לא מחזיר אותם).
   - "בזמן אמת": הספרייה הארוזה היא firestore-lite (בלי האזנה חיה), ולכן המסך בודק שוב כל 8 שניות; הזמנה חדשה משמיעה צליל.
   - הכפתור הראשי בבדיקת מלאי משתנה לפי מצב ההזמנה, אבל השרת הוא שמחליט מה קורה בלחיצה (חיוב, שליחה לאישור או קישור תשלום). */
import * as api from '../api.js';
import { esc, $, $$, ils, toast, busy, dialog, confirmBox, imageToB64 } from '../ui.js';
import { statusText, showOrderDesign } from './order.js';

const POLL_MS = 8000;
const HOLD = { awaiting_customer_approval: 'ממתינה לאישור הלקוח', payment_retry: 'ממתינה לתשלום הלקוח', pickup_overdue: 'איסוף באיחור' };
const ACTION = {
  claim: 'קלטתי', mark_item: 'סימון שורה', item_mark: 'סימון שורה', item_change: 'תחליף / הורדה', confirm_stock: 'יש הכול (חיוב)', approval_request: 'שלחתי ללקוח לאישור',
  approval_phone: 'אישור בטלפון', approval_site: 'אישור הלקוח באתר', start_packing: 'התחלתי אריזה', finish_packing: 'סיימתי אריזה', load: 'הועמס לרכב',
  deliver: 'נמסר', picked_up: 'נאסף', delivery_failed: 'הלקוח לא נמצא', payment_link: 'קישור תשלום נשלח', status: 'עדכון סטטוס',
  update_estimate: 'שינוי צפי', estimate: 'שינוי צפי', // שלב 2.13
};
const fmtTime = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); };
const localToday = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const ful = (o) => (o.fulfillment === 'delivery' ? 'משלוח' : 'איסוף');
const back = '<button class="btn g s" data-bk>‹ חזרה</button>';

// ---------- צליל להזמנה חדשה (WebAudio, בלי קובץ). נוצר רק אחרי לחיצה של המשתמש, כמו שהדפדפן דורש ----------
let AC = null; let SOUND = true;
function beep() {
  if (!SOUND) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    [0, 0.22].forEach((t, i) => {
      const o = AC.createOscillator(); const g = AC.createGain();
      o.frequency.value = i ? 1175 : 880; o.connect(g); g.connect(AC.destination);
      const at = AC.currentTime + t; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.25, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      o.start(at); o.stop(at + 0.22);
    });
    window.__lpBeeps = (window.__lpBeeps || 0) + 1; // לבדיקות בלבד
  } catch (e) { /* בלי צליל – ההזמנה עדיין מוצגת */ }
}

// ---------- רשימת הזמנות לפי סטטוס, עם רענון אוטומטי ----------
function listScreen(cfg) {
  return async function render(root, ctx) {
    let seen = null; let sig = '';
    const draw = (list) => {
      list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const key = JSON.stringify(list.map((o) => [o.id, o.status, o.hold || null]));
      if (key === sig && $('#wl', root)) return;
      sig = key;
      root.innerHTML = `<h2>${esc(cfg.heading)} <small class="note" id="cnt">(${list.length})</small></h2>
        ${cfg.sound ? `<label class="ck"><input type="checkbox" id="snd" ${SOUND ? 'checked' : ''}>צליל כשמגיעה הזמנה חדשה</label>` : ''}
        <div id="wl">${list.length ? list.map((o) => `<button class="li" data-id="${esc(o.id)}"><div class="m"><b>הזמנה ${esc(o.orderNumber || o.id)}</b>
          <small>${esc(fmtTime(o.createdAt))} · ${esc(ful(o))}${cfg.extra ? ' · ' + esc(cfg.extra(o)) : ''}</small></div>
          ${o.hold ? `<span class="tag gold">${esc(HOLD[o.hold] || o.hold)}</span>` : `<span class="tag">${esc(statusText(o.status))}</span>`}</button>`).join('')
          : `<p class="note" id="empty">${esc(cfg.empty)}</p>`}</div>`;
      $$('.li[data-id]', root).forEach((b) => { b.onclick = () => ctx.open((r) => cfg.detail(r, ctx, b.dataset.id)); });
      if ($('#snd', root)) $('#snd', root).onchange = (e) => { SOUND = e.target.checked; if (SOUND) beep(); };
    };
    const load = async (first) => {
      const list = await api.listOrdersByStatus(cfg.statuses);
      if (!root.isConnected) return;
      const ids = new Set(list.map((o) => o.id));
      if (cfg.sound && seen && [...ids].some((id) => !seen.has(id))) beep();
      seen = ids;
      draw(list);
    };
    await load(true);
    const timer = setInterval(async () => {
      if (!root.isConnected) { clearInterval(timer); return; }
      try { await load(false); } catch (e) { /* רענון ברקע: שגיאה זמנית לא מפילה את המסך */ }
    }, POLL_MS);
  };
}

// ---------- עזרי פרטי הזמנה ----------
const linesOf = (o) => (o.items || []).filter((x) => !['removed', 'substituted'].includes(x.stockStatus));
const lineName = (x) => `${esc(x.nameSnapshot || x.productId || '')}${x.colorSnapshot ? ' · ' + esc(x.colorSnapshot) : ''}`;
function bindBack(root, ctx) { const b = $('[data-bk]', root); if (b) b.onclick = () => ctx.back(); }
const itemsHtml = (o) => `<div class="card">${linesOf(o).map((x) => `<div class="sum"><span>${lineName(x)}</span><b>× ${esc(x.packs)}</b></div>`).join('') || '<p class="note">אין שורות</p>'}</div>`;
const holdBanner = (o) => (o.hold && HOLD[o.hold] ? `<div class="res warn" role="status">${esc(HOLD[o.hold])}${o.hold === 'awaiting_customer_approval' && o.customerApproval && o.customerApproval.deadline ? ' · עד ' + esc(fmtTime(o.customerApproval.deadline)) : ''}</div>` : '');

// =====================================================================================
// שלב 2.13: "שינוי צפי" אחרי "קלטתי" – צפי אספקה חדש, ובאיסוף גם זמן איסוף (פרק 5.2, טבלה 7.2 שורה 13).
// כאן רק טופס. השרת (changeStatus, action = update_estimate) בודק סטטוס, תאריך והרשאה, רושם ביומן ושולח ללקוח הודעה ומייל.
// =====================================================================================
const ESTIMATE_STATUSES = ['stock_check', 'awaiting_packing', 'packing', 'ready', 'out_for_delivery'];
const estimateBtn = (o) => (ESTIMATE_STATUSES.includes(o.status) && !['awaiting_customer_approval', 'payment_retry'].includes(o.hold) ? '<button class="btn s g" id="estchg">שינוי צפי</button>' : '');
function bindEstimate(root, o, id, again) {
  const b = $('#estchg', root);
  if (!b) return;
  b.onclick = async () => {
    const today = localToday(); const pickup = o.fulfillment === 'pickup'; const s = o.pickupSlot || {};
    const r = await dialog(`<h3 style="margin-top:0">שינוי צפי</h3>
      <label class="f"><span>צפי אספקה</span><input type="date" id="ne" min="${today}" value="${esc(o.estimatedDate || '')}" dir="ltr"></label>
      ${pickup ? `<div class="grid2"><label class="f"><span>יום איסוף</span><input type="date" id="npd" min="${today}" value="${esc(s.date || '')}" dir="ltr"></label><label class="f"><span>שעה</span><input type="time" id="nps" value="${esc(s.start || '')}" dir="ltr"></label></div>` : ''}
      <p class="note">הלקוח יקבל הודעה באזור האישי ובמייל.</p>`, [['ok', 'שמור']],
    (m) => ({ e: m.querySelector('#ne').value, d: pickup ? m.querySelector('#npd').value : '', t: pickup ? m.querySelector('#nps').value : '' }));
    if (!r) return;
    const input = { orderId: id, action: 'update_estimate' };
    if (r.data.e && r.data.e !== (o.estimatedDate || '')) input.estimatedDate = r.data.e;
    if (r.data.d || r.data.t) {
      if (!r.data.d || !r.data.t) { toast('זמן איסוף: צריך גם יום וגם שעה', true); return; }
      if (r.data.d !== s.date || r.data.t !== s.start) input.pickupSlot = { date: r.data.d, start: r.data.t };
    }
    if (!input.estimatedDate && !input.pickupSlot) { toast('לא שונה דבר', true); return; }
    const res = await busy(b, () => api.changeStatus(input), 'הצפי עודכן, והלקוח יקבל הודעה');
    if (res) again();
  };
}

// =====================================================================================
// 1. הזמנות חדשות: "קלטתי" = צפי אספקה (חובה), מחיר משלוח ידני (אזור שמחירו ידני), וזמן איסוף (אופציונלי)
// =====================================================================================
async function claimView(root, ctx, id) {
  const o = await api.getOrder(id);
  if (!root.isConnected) return;
  if (!o) { root.innerHTML = `${back}<p class="err">ההזמנה לא נמצאה</p>`; bindBack(root, ctx); return; }
  const pr = o.pricing || {};
  const manual = o.fulfillment === 'delivery' && pr.shippingFee === null;
  const pickup = o.fulfillment === 'pickup';
  const today = localToday();
  const early = o.earliestDate && o.earliestDate >= today ? o.earliestDate : today;
  root.innerHTML = `${back}<h2>הזמנה ${esc(o.orderNumber || o.id)}</h2>${holdBanner(o)}
    <div class="card"><p class="note">${esc(ful(o))} · ${esc(fmtTime(o.createdAt))}${o.earliestDate ? ' · מוקדם ביותר: ' + esc(o.earliestDate) : ''}</p></div>
    ${itemsHtml(o)}
    <form class="card" id="cf" onsubmit="return false">
    <label class="f"><span>צפי אספקה (חובה)</span><input type="date" name="est" min="${today}" value="${esc(early)}" required dir="ltr"></label>
    ${manual ? '<label class="f"><span>מחיר משלוח (₪) – האזור הזה נקבע ידנית</span><input name="fee" inputmode="decimal" dir="ltr" required></label><p class="note">מחיר משלוח שנקבע ידנית נשלח ללקוח לאישור לפני החיוב.</p>' : ''}
    ${pickup ? '<div class="grid2"><label class="f"><span>יום איסוף (לא חובה)</span><input type="date" name="pd" min="' + today + '" dir="ltr"></label><label class="f"><span>שעה</span><input type="time" name="ps" dir="ltr"></label></div>' : ''}
    </form>
    <button class="btn w" id="claim" ${o.status === 'received' ? '' : 'disabled'}>קלטתי</button>
    ${o.status === 'received' ? '' : '<p class="note">ההזמנה כבר לא במצב "התקבלה" (' + esc(statusText(o.status)) + ').</p>'}`;
  bindBack(root, ctx);
  $('#claim', root).onclick = async (ev) => {
    const f = $('#cf', root).elements;
    const input = { orderId: id, estimatedDate: f.est.value };
    if (!input.estimatedDate) { toast('צריך לבחור צפי אספקה', true); return; }
    if (manual) { const v = String(f.fee.value).trim().replace(',', '.'); if (!v) { toast('צריך לקבוע מחיר משלוח', true); return; } input.shippingFee = v; }
    if (pickup && (f.pd.value || f.ps.value)) {
      if (!f.pd.value || !f.ps.value) { toast('זמן איסוף: צריך גם יום וגם שעה', true); return; }
      input.pickupSlot = { date: f.pd.value, start: f.ps.value };
    }
    const r = await busy(ev.target, () => api.claimOrder(input), 'ההזמנה נקלטה ועברה לבדיקת מלאי');
    if (r) ctx.back();
  };
}

// =====================================================================================
// 2. בדיקת מלאי: סימון שורות, תחליף/הורדה, ו"יש הכול" / "שלח ללקוח לאישור" / "אישר בטלפון" / "חייב" / "אשר והמשך"
// =====================================================================================
const STOCK_TAG = { ok: ['ok', 'יש'], missing: ['bad', 'חסר'], substituted: ['gold', 'הוחלף'], removed: ['', 'הורד'], pending: ['', 'לא נבדק'] };

function mainAction(o, pr) {
  // רמז לתצוגה בלבד – השרת בודק הכול מחדש בלחיצה (אותם כללים כמו changeOf בשרת). אין כאן חישוב סכום.
  if (o.paymentTerms === 'deferred') return { label: 'אשר והמשך', kind: 'go' };
  if (o.hold === 'awaiting_customer_approval') return { kind: 'wait-approval' };
  if (o.hold === 'payment_retry') return { kind: 'wait-payment' };
  const paid = !!(o.paymentRetry && o.paymentRetry.paidAt);
  const approved = !!(pr.customerApproval && pr.customerApproval.answer === 'approved');
  const changed = (pr.items || []).some((x) => x.removed === true) || (pr.shippingFeeSetBy && pr.shippingFeeSetBy !== 'auto')
    || (pr.authorizedAmount != null && Number(pr.total) > Number(pr.authorizedAmount));
  if (paid || (changed && approved)) return { label: 'חייב', kind: 'go' };
  if (changed) return { label: 'שלח ללקוח לאישור', kind: 'ask', phone: true };
  return { label: 'יש הכול', kind: 'go' };
}

async function pickSubstitute(itemId, o) {
  // בחירת מוצר וצבע לתחליף. המחיר לא מוצג ולא מחושב כאן – השרת מחשב אותו וגם בודק שהמוצר פעיל ולא אזל.
  const products = (await api.listProducts()).filter((p) => p.active !== false && p.soldOutAll !== true).sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  const p = dialog(`<h3 style="margin-top:0">תחליף לשורה</h3>
    <label class="f"><span>חיפוש מוצר (שם או מק"ט)</span><input id="sq" autocomplete="off"></label>
    <label class="f"><span>מוצר</span><select id="sp" size="5"></select></label>
    <label class="f"><span>צבע</span><select id="sv"><option value="">—</option></select></label>
    <label class="f"><span>חבילות (ריק = כמו בשורה המקורית)</span><input id="sk" inputmode="numeric" dir="ltr"></label>`,
  [['ok', 'בחר תחליף']], (m) => ({ productId: m.querySelector('#sp').value, variantId: m.querySelector('#sv').value, packs: m.querySelector('#sk').value.trim() }));
  const m = document.querySelector('.modal');
  const fill = (q) => { const s = q.trim().toLowerCase(); $('#sp', m).innerHTML = products.filter((x) => !s || String(x.name).toLowerCase().includes(s) || String(x.sku || '').toLowerCase().includes(s)).slice(0, 60).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.sku ? ' · ' + esc(x.sku) : ''}</option>`).join(''); };
  fill('');
  $('#sq', m).oninput = (e) => fill(e.target.value);
  $('#sp', m).onchange = async (e) => {
    const vs = (await api.listVariants(e.target.value)).filter((v) => v.soldOut !== true);
    $('#sv', m).innerHTML = vs.length ? '<option value="">בחר צבע</option>' + vs.map((v) => `<option value="${esc(v.id)}">${esc(v.colorName || v.id)}</option>`).join('') : '<option value="">אין צבעים (מוצר בלי צבע)</option>';
  };
  const r = await p;
  if (!r) return null;
  if (!r.data.productId) { toast('צריך לבחור מוצר', true); return null; }
  const input = { orderId: o.id, itemId, mark: 'substitute', productId: r.data.productId };
  if (r.data.variantId) input.variantId = r.data.variantId;
  if (r.data.packs) input.packs = Number(r.data.packs);
  return input;
}

async function stockView(root, ctx, id, banner) {
  const o = await api.getOrder(id);
  if (!root.isConnected) return;
  if (!o) { root.innerHTML = `${back}<p class="err">ההזמנה לא נמצאה</p>`; bindBack(root, ctx); return; }
  const pr = o.pricing || {};
  const blocked = !!o.hold && ['awaiting_customer_approval', 'payment_retry'].includes(o.hold);
  const act = mainAction(o, pr);
  const total = pr.total;
  const missing = (o.items || []).some((x) => x.stockStatus === 'missing');
  const rows = (o.items || []).map((x) => {
    const st = x.stockStatus || 'pending'; const tg = STOCK_TAG[st] || ['', st];
    const live = !['removed', 'substituted'].includes(st);
    return `<div class="card" data-item="${esc(x.id)}" data-st="${esc(st)}"><div class="sum"><span ${live ? '' : 'style="text-decoration:line-through"'}>${lineName(x)}</span><b>× ${esc(x.packs)}</b></div>
      <div class="row"><span class="tag ${tg[0]}">${esc(tg[1])}</span>
      ${live && !blocked ? `<button class="btn s g" data-mark="ok">יש</button><button class="btn s bad" data-mark="missing">חסר</button>` : ''}
      ${st === 'missing' && !blocked ? '<button class="btn s" data-sub>תחליף</button><button class="btn s g" data-rm>הורד</button>' : ''}</div></div>`;
  }).join('');
  root.innerHTML = `${back}<h2>הזמנה ${esc(o.orderNumber || o.id)} · בדיקת מלאי</h2>
    ${banner ? `<div class="res ${banner.cls}" id="sres" role="status">${esc(banner.text)}</div>` : ''}${holdBanner(o)}
    <p class="note">${esc(ful(o))}${o.estimatedDate ? ' · צפי אספקה ' + esc(o.estimatedDate) : ''}${o.paymentTerms === 'deferred' ? ' · בשוטף (בלי חיוב עכשיו)' : ''}</p>${estimateBtn(o)}
    ${rows}
    <div class="card" id="mainbox">
      <div class="sum tot"><span>סכום ההזמנה (כפי שהשרת שמר)</span><b id="tot" data-total="${esc(total == null ? '' : total)}">${ils(total)}</b></div>
      ${act.kind === 'go' || act.kind === 'ask' ? `<button class="btn w" id="confirm" ${missing ? 'disabled' : ''}>${esc(act.label)} · <span id="mamt" dir="ltr">${ils(total)}</span></button>` : ''}
      ${missing ? '<p class="note">יש שורה שסומנה "חסר". צריך לבחור לה תחליף או להוריד אותה.</p>' : ''}
      ${act.kind === 'wait-payment' ? '<p class="note">נשלח ללקוח קישור לתשלום. כשהלקוח ישלם, יופיע כאן "חייב".</p>' : ''}
      ${act.kind === 'wait-approval' || act.phone ? `<hr style="border-color:var(--line)"><label class="ck"><input type="checkbox" id="pok">הלקוח אישר בשיחה טלפונית את הסכום ${ils(total)}</label>
        <button class="btn g w" id="phone">אישר בטלפון</button>` : ''}
    </div>`;
  bindBack(root, ctx);
  const again = (b) => ctx.replace((r) => stockView(r, ctx, id, b));
  bindEstimate(root, o, id, () => again()); // שלב 2.13
  $$('[data-mark]', root).forEach((b) => { b.onclick = async () => {
    const itemId = b.closest('[data-item]').dataset.item;
    const r = await busy(b, () => api.markItem({ orderId: id, itemId, mark: b.dataset.mark }));
    if (r) again();
  }; });
  $$('[data-sub]', root).forEach((b) => { b.onclick = async () => {
    const input = await pickSubstitute(b.closest('[data-item]').dataset.item, o);
    if (!input) return;
    const r = await busy(b, () => api.markItem(input), 'התחליף נשמר');
    if (r) again({ cls: 'warn', text: 'בוצע שינוי בהזמנה. הסכום עודכן, והלקוח יתבקש לאשר אותו לפני החיוב.' });
  }; });
  $$('[data-rm]', root).forEach((b) => { b.onclick = async () => {
    const itemId = b.closest('[data-item]').dataset.item;
    if (!(await confirmBox('להוריד את השורה מההזמנה? הלקוח יתבקש לאשר את הסכום החדש.', 'הורד'))) return;
    const r = await busy(b, () => api.markItem({ orderId: id, itemId, mark: 'remove' }), 'השורה הורדה');
    if (r) again({ cls: 'warn', text: 'בוצע שינוי בהזמנה. הסכום עודכן, והלקוח יתבקש לאשר אותו לפני החיוב.' });
  }; });
  if ($('#confirm', root)) $('#confirm', root).onclick = async (ev) => {
    const r = await busy(ev.currentTarget, () => api.confirmStock({ orderId: id, expectedTotal: total }));
    if (!r) { ctx.replace((rt) => stockView(rt, ctx, id)); return; } // למשל "הסכום השתנה" – מרעננים
    window.__lpLastConfirm = r; // לבדיקות בלבד
    if (r.result === 'charged') { toast(`חויב ${ils(r.chargedAmount)}. ההזמנה עברה לאריזה`); ctx.back(); }
    else if (r.result === 'confirmed_deferred') { toast('אושר בשוטף. ההזמנה עברה לאריזה'); ctx.back(); }
    else if (r.result === 'approval_requested') again({ cls: 'warn', text: 'נשלחה ללקוח בקשה לאשר את הסכום החדש. ההזמנה ממתינה לתשובה.' });
    else again({ cls: 'bad', text: 'החיוב לא עבר. נשלח ללקוח קישור לתשלום, וההזמנה ממתינה לו.' });
  };
  if ($('#phone', root)) $('#phone', root).onclick = async (ev) => {
    if (!$('#pok', root).checked) { toast('צריך לסמן שהלקוח אישר בשיחה את הסכום', true); return; }
    const r = await busy(ev.currentTarget, () => api.confirmPhoneApproval({ orderId: id, confirmed: true, amount: total }), 'אישור הלקוח בטלפון נרשם');
    if (r) again({ cls: 'ok', text: 'הלקוח אישר בטלפון. עכשיו אפשר ללחוץ "חייב".' });
    else ctx.replace((rt) => stockView(rt, ctx, id));
  };
}

// =====================================================================================
// 3-4. תור אריזה ואריזה
// =====================================================================================
function packView(startStatus) {
  const isStart = startStatus === 'awaiting_packing';
  return async function view(root, ctx, id) {
    const o = await api.getOrder(id);
    if (!root.isConnected) return;
    if (!o) { root.innerHTML = `${back}<p class="err">ההזמנה לא נמצאה</p>`; bindBack(root, ctx); return; }
    const ok = o.status === startStatus;
    root.innerHTML = `${back}<h2>הזמנה ${esc(o.orderNumber || o.id)} · ${isStart ? 'ממתינה לאריזה' : 'באריזה'}</h2>${holdBanner(o)}
      <p class="note">${esc(ful(o))}${o.estimatedDate ? ' · צפי אספקה ' + esc(o.estimatedDate) : ''}</p>${estimateBtn(o)}${itemsHtml(o)}
      <button class="btn w" id="go" ${ok ? '' : 'disabled'}>${isStart ? 'התחלתי אריזה' : 'סיימתי אריזה'}</button>
      ${ok ? '' : '<p class="note">ההזמנה כבר לא במצב הזה (' + esc(statusText(o.status)) + ').</p>'}`;
    bindBack(root, ctx);
    bindEstimate(root, o, id, () => ctx.replace((r) => view(r, ctx, id))); // שלב 2.13
    showOrderDesign(root, id, $('.card', root)); // שלב 4.7
    $('#go', root).onclick = async (ev) => {
      const r = await busy(ev.target, () => api.changeStatus({ orderId: id, action: isStart ? 'start_packing' : 'finish_packing' }), isStart ? 'האריזה התחילה' : 'ההזמנה מוכנה');
      if (r) ctx.back();
    };
  };
}

// =====================================================================================
// 5. משלוחים ואיסופים: הועמס, נמסר (עם צילום), הלקוח לא נמצא, נאסף. ניווט ב-Waze.
// =====================================================================================
const wazeUrl = (a) => 'https://waze.com/ul?q=' + encodeURIComponent([a.street, a.city].filter(Boolean).join(' ')) + '&navigate=yes';
async function shipView(root, ctx, id) {
  const o = await api.getOrder(id);
  if (!root.isConnected) return;
  if (!o) { root.innerHTML = `${back}<p class="err">ההזמנה לא נמצאה</p>`; bindBack(root, ctx); return; }
  const c = o.contact || {}; const a = o.address || null; const delivery = o.fulfillment === 'delivery';
  const addr = a ? [a.street, a.city].filter(Boolean).join(', ') : '';
  let btns = '';
  if (o.status === 'ready' && delivery) btns = '<button class="btn w" id="load">הועמס לרכב</button>';
  else if (o.status === 'ready') btns = '<button class="btn w" id="pick">נאסף</button>';
  else if (o.status === 'out_for_delivery') btns = `<div class="card"><label class="f"><span>צילום מסירה (חובה)</span><input type="file" id="ph" accept="image/*" capture="environment"></label>
      <button class="btn w" id="deliver">נמסר</button></div><button class="btn bad w" id="fail">הלקוח לא נמצא</button>`;
  root.innerHTML = `${back}<h2>הזמנה ${esc(o.orderNumber || o.id)} · ${delivery ? 'משלוח' : 'איסוף'}</h2>${holdBanner(o)}
    <div class="card"><b>${esc(c.name || '')}</b>
      ${c.phone ? `<p><a href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}" dir="ltr" id="tel">${esc(c.phone)}</a></p>` : ''}
      ${delivery && addr ? `<p id="addr">${esc(addr)}${a.notes ? '<br><small class="note">' + esc(a.notes) + '</small>' : ''}</p>
        <a class="btn s" id="waze" href="${esc(wazeUrl(a))}" target="_blank" rel="noopener">ניווט ב-Waze</a>` : ''}
      ${!delivery && o.pickupSlot ? `<p class="note">זמן איסוף: ${esc(o.pickupSlot.date)} ${esc(o.pickupSlot.start)}</p>` : ''}
      ${o.estimatedDate ? `<p class="note">צפי אספקה: ${esc(o.estimatedDate)}</p>` : ''}${estimateBtn(o)}
    </div>${itemsHtml(o)}${btns || '<p class="note">אין פעולה להזמנה במצב הזה (' + esc(statusText(o.status)) + ').</p>'}`;
  bindBack(root, ctx);
  bindEstimate(root, o, id, () => ctx.replace((r) => shipView(r, ctx, id))); // שלב 2.13
  const doIt = (b, input, msg) => async () => { const r = await busy(b, () => api.changeStatus(Object.assign({ orderId: id }, input)), msg); if (r) ctx.back(); };
  if ($('#load', root)) $('#load', root).onclick = (e) => doIt(e.currentTarget, { action: 'load' }, 'ההזמנה יצאה למשלוח')();
  if ($('#pick', root)) $('#pick', root).onclick = (e) => doIt(e.currentTarget, { action: 'picked_up' }, 'ההזמנה נמסרה ללקוח')();
  if ($('#fail', root)) $('#fail', root).onclick = async (e) => {
    const r = await dialog('<h3 style="margin-top:0">הלקוח לא נמצא</h3><label class="f"><span>הערה (לא חובה)</span><textarea id="fn" maxlength="500"></textarea></label><p class="note">ההזמנה תחזור ל"מוכנה" ותתואם מסירה חוזרת.</p>', [['ok', 'אישור', 'bad']], (m) => m.querySelector('#fn').value.trim());
    if (!r) return;
    doIt(e.currentTarget, r.data ? { action: 'delivery_failed', note: r.data } : { action: 'delivery_failed' }, 'נרשם שהלקוח לא נמצא')();
  };
  if ($('#deliver', root)) $('#deliver', root).onclick = async (e) => {
    const f = $('#ph', root).files[0];
    if (!f) { toast('צריך לצלם את המסירה לפני "נמסר"', true); return; }
    const r = await busy(e.currentTarget, async () => {
      const b64 = await imageToB64(f, 1600);
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const path = await api.uploadDeliveryPhoto(id, new Blob([u], { type: 'image/jpeg' }));
      return api.changeStatus({ orderId: id, action: 'deliver', photoPath: path });
    }, 'ההזמנה נמסרה');
    if (r) ctx.back();
  };
}

// =====================================================================================
// 6. ההיסטוריה שלי: רק מה שהשרת מחזיר (מספר הזמנה, תאריך, סטטוס, ופעולות). בלי שם, כתובת, טלפון וסכומים.
// =====================================================================================
async function historyRender(root) {
  const h = await api.getMyHistory(50);
  if (!root.isConnected) return;
  const list = (h && h.orders) || [];
  root.innerHTML = `<h2>ההיסטוריה שלי <small class="note">(${list.length})</small></h2>
    ${list.length ? list.map((o) => `<div class="card" data-order="${esc(o.orderId)}"><div class="sum"><b>הזמנה ${esc(o.orderNumber || o.orderId)}</b><span class="tag">${esc(statusText(o.status))}</span></div>
      <p class="note">${esc(o.date || '')}</p>
      ${(o.actions || []).map((x) => `<div class="sum"><span>${esc(ACTION[x.action] || 'פעולה')}</span><small class="note">${esc(fmtTime(x.at))}</small></div>`).join('')}</div>`).join('')
    : '<p class="note" id="empty">עוד לא טיפלת בהזמנות.</p>'}`;
}

const W = ['employee', 'manager'];
export default [
  { id: 'w-new', title: 'חדשות', work: true, roles: W, render: listScreen({ heading: 'הזמנות חדשות', statuses: ['received'], sound: true, empty: 'אין הזמנות חדשות', detail: claimView }) },
  { id: 'w-stock', title: 'בדיקת מלאי', work: true, roles: W, render: listScreen({ heading: 'בדיקת מלאי', statuses: ['stock_check'], empty: 'אין הזמנות בבדיקת מלאי', detail: stockView }) },
  { id: 'w-packq', title: 'תור אריזה', work: true, roles: W, render: listScreen({ heading: 'תור אריזה', statuses: ['awaiting_packing'], empty: 'אין הזמנות שממתינות לאריזה', detail: packView('awaiting_packing') }) },
  { id: 'w-pack', title: 'אריזה', work: true, roles: W, render: listScreen({ heading: 'באריזה', statuses: ['packing'], empty: 'אין הזמנות באריזה', detail: packView('packing') }) },
  { id: 'w-ship', title: 'משלוחים ואיסופים', work: true, roles: W, render: listScreen({ heading: 'משלוחים ואיסופים', statuses: ['ready', 'out_for_delivery'], empty: 'אין משלוחים או איסופים', detail: shipView,
    extra: (o) => (o.status === 'out_for_delivery' ? 'יצאה למשלוח' : 'מוכנה') }) },
  { id: 'w-hist', title: 'ההיסטוריה שלי', work: true, roles: W, render: historyRender },
];
