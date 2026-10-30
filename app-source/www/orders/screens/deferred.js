/* לשונית "שוטף" בכרטיס סיטונאי (שלב 2.6ב, פרק 6.5): מצב החשבון (תקין / חסום), יתרה לתשלום, חשבוניות פתוחות,
   "התקבל תשלום" והשבתה/החזרה של הסיטונאי. מנהל בלבד.
   היתרה והחסימה באות מהשרת (wholesale_terms, customers.orderBlock) – אותם נתונים שמוצגים בדוח "שוטף". אין חישוב כספי כאן. */
import * as api from '../api.js';
import { esc, $, $$, ils, toast, busy, dialog, confirmBox } from '../ui.js';
import { invNo, PAY_LABEL, stateTag, isBlocked, fmtDate } from './money.js';

const METHODS = [['transfer', 'העברה בנקאית'], ['check', 'צ׳ק'], ['cash', 'מזומן'], ['other', 'אחר']];
const today = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

// box: תיבה לציור. c: כרטיס הלקוח. invoices: החשבוניות שכבר נטענו. reload: ציור מחדש של כל הכרטיס.
export async function deferredSection(box, c, invoices, reload) {
  if (!api.isManager()) return;
  const [terms, fresh] = await Promise.all([api.getTerms(c.id), api.getCustomer(c.id)]);
  if (!box.isConnected) return;
  const cust = fresh || c;
  const t = terms || {};
  const open = invoices.filter((v) => v.docType === 'tax_invoice' && (v.paymentStatus === 'open' || v.paymentStatus === 'to_collect')).sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
  const isDeferred = t.paymentTerms === 'deferred';
  box.innerHTML = `<h3>שוטף – מצב החשבון</h3><div class="card" id="dfcard">
    <p>מצב: <span id="dfstate">${stateTag(cust)}</span> ${cust.active === false ? '<span class="tag bad">מושבת</span>' : ''}${isDeferred ? '' : ' <span class="note">(הלקוח בכרטיס אשראי, לא בשוטף)</span>'}</p>
    <div class="sum"><span>יתרה לתשלום</span><b id="dfopen">${ils(t.openBalance == null ? 0 : t.openBalance)}</b></div>
    <div class="sum"><span>מתוכה באיחור</span><b id="dfover">${ils(t.overdueBalance == null ? 0 : t.overdueBalance)}</b></div>
    <p class="note">${t.nextDueDate ? 'המועד הקרוב: ' + esc(t.nextDueDate) : 'אין חשבונית פתוחה'}${t.creditLimit != null ? ' · תקרת חוב ' + ils(t.creditLimit) : ''}</p>
    ${open.length ? `<table id="dfinv"><tr><th>חשבונית</th><th>לתשלום עד</th><th>סכום</th><th></th></tr>${open.map((v) => `<tr data-inv="${esc(v.id)}" data-order="${esc(v.orderId || '')}"><td>${esc(invNo(v))}</td><td>${esc(v.dueDate || '')}</td><td>${ils(v.total)}</td><td><span class="tag ${v.paymentStatus === 'to_collect' ? 'bad' : ''}">${esc(PAY_LABEL[v.paymentStatus])}</span> <button class="btn s" data-paid>התקבל תשלום</button></td></tr>`).join('')}</table>` : '<p class="note" id="dfnone">אין חשבוניות פתוחות.</p>'}
    ${cust.active === false ? '<button class="btn w" id="dfon">החזרת הסיטונאי לפעילות</button>' : '<button class="btn bad w" id="dfoff">השבתת הסיטונאי</button>'}
    <p class="note">מושבת: רואה מחירים ומשתמש בעגלה, אבל לא שולח הזמנה.</p></div>`;
  $$('[data-paid]', box).forEach((b) => { b.onclick = async () => {
    const tr = b.closest('tr'); const v = open.find((x) => x.id === tr.dataset.inv);
    if (!v.orderId) { toast('לחשבונית אין הזמנה מקושרת', true); return; }
    const d = await dialog(`<h3 style="margin-top:0">התקבל תשלום – ${esc(invNo(v))}</h3><p>הסכום המלא: <b>${ils(v.total)}</b>. תשלום חלקי לא נתמך.</p>
      <div class="grid2"><label class="f"><span>תאריך התשלום</span><input type="date" name="d" value="${today()}" max="${today()}"></label>
      <label class="f"><span>אמצעי תשלום</span><select name="m">${METHODS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label></div>`,
    [['ok', 'סמן כשולם']], (m) => ({ d: m.querySelector('[name=d]').value, m: m.querySelector('[name=m]').value }));
    if (!d) return;
    const r = await busy(b, () => api.markDeferredPaid({ orderId: v.orderId, paidAt: d.data.d, paidMethod: d.data.m }), (x) => (x.alreadyPaid ? 'כבר סומן כשולם' : 'התשלום נרשם, והופקה קבלה'));
    if (r) reload();
  }; });
  const setActive = (btn, active, msg) => async () => {
    if (!await confirmBox(msg, 'אישור')) return;
    const r = await busy(btn, () => api.setCustomerActive({ customerUid: c.id, active }), active ? 'הסיטונאי הוחזר לפעילות' : 'הסיטונאי הושבת');
    if (r) reload();
  };
  if ($('#dfoff', box)) $('#dfoff', box).onclick = (e) => setActive(e.target, false, `להשבית את ${c.companyName || c.name}? הוא לא יוכל לשלוח הזמנות חדשות.`)();
  if ($('#dfon', box)) $('#dfon', box).onclick = (e) => setActive(e.target, true, `להחזיר את ${c.companyName || c.name} לפעילות?`)();
}
export { isBlocked, fmtDate };
