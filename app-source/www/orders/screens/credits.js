/* זיכויים (מנהל בלבד, שלב 5.3; ב15):
   - בכרטיס הלקוח (creditSection): היתרה, רשימת הזיכויים (סכום, יתרה, תוקף, מצב), מתן זיכוי וביטול יתרה.
   - מסך "זיכויים": תבניות (credit_rules – סכום או אחוז, ותוקף), וחיפוש לקוח לפי מייל – גם לקוח פרטי, שאין לו כרטיס ברשימת הסיטונאים.
   כל כתיבה עוברת בפונקציות השרת grantCredit, revokeCredit ו-saveCreditRule (מנהל בלבד; השרת בודק כל ערך ורושם ביומן).
   **אין הענקה אוטומטית:** תבנית לא נותנת כלום לבד – זיכוי ניתן רק בלחיצה כאן. השימוש בזיכוי – רק בקופה באתר, והחישוב בשרת. */
import * as api from '../api.js';
import { esc, $, $$, ils, toast, busy, numOrText } from '../ui.js';
import { statusText } from './order.js';

const KIND = { amount: 'סכום (₪)', percent: 'אחוז מהמוצרים בהזמנה' };
const STATUS = { active: ['בתוקף', 'ok'], used: ['נוצל', ''], expired: ['פג תוקף', 'bad'], revoked: ['בוטל', 'bad'] };
const day = (t) => String(t || '').slice(0, 10).split('-').reverse().join('.');
const usable = (c) => c.status === 'active' && Number(c.remaining) > 0 && Date.parse(c.expiresAt || '') > Date.now();
const ruleText = (r) => `${r.kind === 'percent' ? `${r.value}% מהמוצרים` : ils(r.value)} · תוקף ${r.validityDays ? r.validityDays + ' יום' : 'ברירת המחדל'}`;
const needMgr = (root) => { if (api.isManager()) return true; root.innerHTML = '<div class="card"><p class="err">המסך הזה למנהל בלבד.</p></div>'; return false; };

// ---------- בכרטיס הלקוח ----------
export async function creditSection(box, ctx, c, reload) {
  if (!api.isManager() || !box) return;
  const [list, rules, orders] = await Promise.all([api.listCustomerCredits(c.id), api.listCreditRules().catch(() => []), api.listCustomerOrders(c.id).catch(() => [])]);
  if (!box.isConnected) return; // המסך התחלף בזמן הטעינה
  list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const active = rules.filter((r) => r.active !== false);
  const balance = list.filter(usable).reduce((s, x) => s + Math.round(Number(x.remaining) * 100), 0) / 100;
  box.innerHTML = `<h3>זיכויים – רק מנהל</h3>
    <div class="card" id="crBox"><p class="row"><b>יתרה לשימוש</b> <span class="tag gold" id="crBal">${ils(balance)}</span></p>
    ${list.length ? `<table><tr><th>סיבה</th><th>סכום</th><th>יתרה</th><th>תוקף</th><th></th></tr>${list.map((x) => {
      const st = usable(x) ? STATUS.active : (x.status === 'active' ? STATUS.expired : (STATUS[x.status] || [x.status, '']));
      return `<tr data-cr="${esc(x.id)}"><td>${esc(x.reason || '')}${x.isDemo ? ' <span class="tag">דמו</span>' : ''}</td><td>${ils(x.amount)}</td><td>${ils(x.remaining)}</td><td>${esc(day(x.expiresAt))}</td>
        <td><span class="tag ${st[1]}">${esc(st[0])}</span>${usable(x) ? ' <button class="btn bad s" data-rv>בטל יתרה</button>' : ''}</td></tr>`;
    }).join('')}</table>` : '<p class="note">אין זיכויים ללקוח הזה.</p>'}
    <p class="note">הלקוח משתמש ביתרה בקופה באתר ("השתמשו ביתרת זיכוי"). היתרה משלמת על המוצרים, לא על דמי המשלוח. ביטול הזמנה מחזיר ליתרה את מה שנוצל בה.</p></div>
    <div class="card"><h3 style="margin-top:0">מתן זיכוי</h3>
    <form id="gf" onsubmit="return false">
    <label class="f"><span>איך</span><select name="how"><option value="amount">סכום שאני קובע</option>${active.length ? '<option value="rule">לפי תבנית</option>' : ''}</select></label>
    <label class="f" id="gAmt"><span>סכום (₪)</span><input name="amount" inputmode="decimal" dir="ltr"></label>
    <label class="f" id="gRule" hidden><span>תבנית</span><select name="rule">${active.map((r) => `<option value="${esc(r.id)}" data-kind="${esc(r.kind)}">${esc(r.name)} · ${esc(ruleText(r))}</option>`).join('')}</select></label>
    <label class="f" id="gOrd" hidden><span>הזמנה (בסיס האחוז – סכום המוצרים, בלי משלוח)</span><select name="order">${orders.map((o) => `<option value="${esc(o.id)}">${esc(o.orderNumber || o.id)} · ${esc(String(o.createdAt || '').slice(0, 10))} · ${esc(statusText(o.status))}</option>`).join('')}</select></label>
    <label class="f"><span>סיבה (הלקוח רואה אותה באזור האישי)</span><input name="reason" maxlength="200" required></label>
    <label class="f"><span>תוקף בימים (ריק = מהתבנית, או ברירת המחדל של ההגדרות – 365)</span><input name="days" inputmode="numeric" dir="ltr"></label>
    </form><button class="btn w" id="grant">תן זיכוי</button></div>`;
  const f = $('#gf', box);
  const reqId = 'app-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  const sync = () => {
    const rule = f.how.value === 'rule';
    // style.display ולא hidden: לתוויות .f יש display ב-CSS, שגובר על hidden
    const show = (el, on) => { el.hidden = !on; el.style.display = on ? '' : 'none'; };
    show($('#gAmt', box), !rule); show($('#gRule', box), rule);
    const opt = f.rule && f.rule.selectedOptions[0];
    show($('#gOrd', box), !!(rule && opt && opt.dataset.kind === 'percent'));
  };
  f.how.onchange = sync; if (f.rule) f.rule.onchange = sync; sync();
  $('#grant', box).onclick = async (ev) => {
    // מזהה בקשה אחד לטופס (סבב 2): לחיצה כפולה או בקשה שהרשת חזרה עליה ← אותו זיכוי בשרת, ולא שניים
    const input = { customerUid: c.id, reason: f.reason.value.trim(), requestId: reqId };
    if (f.how.value === 'rule') {
      input.ruleId = f.rule.value;
      if ($('#gOrd', box).style.display !== 'none') { if (!f.order.value) { toast('בחרו הזמנה', true); return; } input.orderId = f.order.value; }
    } else input.amount = numOrText(f.amount.value.trim());
    if (f.days.value.trim()) input.validityDays = /^\d+$/.test(f.days.value.trim()) ? Number(f.days.value.trim()) : f.days.value.trim();
    if (!input.reason) { toast('כתבו סיבה', true); return; }
    const r = await busy(ev.target, () => api.grantCredit(input), (x) => `ניתן זיכוי של ${ils(x.amount)}, בתוקף עד ${day(x.expiresAt)}`);
    if (r) reload();
  };
  $$('[data-rv]', box).forEach((b) => {
    b.onclick = async () => {
      const id = b.closest('[data-cr]').dataset.cr;
      const reason = (window.prompt('סיבת הביטול (נרשמת ביומן):') || '').trim();
      if (!reason) return;
      const r = await busy(b, () => api.revokeCredit({ creditId: id, reason }), (x) => `בוטלה יתרה של ${ils(x.revokedAmount)}`);
      if (r) reload();
    };
  });
}

// ---------- מסך "זיכויים" ----------
async function render(root, ctx) {
  if (!needMgr(root)) return;
  const rules = await api.listCreditRules();
  if (!root.isConnected) return;
  rules.sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  root.innerHTML = `<h2>זיכויים</h2>
    <div class="card"><h3 style="margin-top:0">לקוח</h3>
    <form id="sf" onsubmit="return false"><label class="f"><span>מייל הלקוח</span><input name="email" type="email" dir="ltr"></label></form>
    <button class="btn w" id="find">חפש לקוח</button><div id="found"></div></div>
    <h3>תבניות <small class="note">(${rules.length})</small></h3>
    <button class="btn g w" id="addr" style="margin-bottom:10px">＋ תבנית חדשה</button>
    <div id="rl">${rules.map((r) => `<button class="li" data-r="${esc(r.id)}"><div class="m"><b>${esc(r.name || r.id)}</b><small>${esc(ruleText(r))}</small></div>
      <div>${r.active === false ? '<span class="tag">כבויה</span>' : '<span class="tag ok">פעילה</span>'}${r.isDemo ? ' <span class="tag">דמו</span>' : ''}</div></button>`).join('') || '<p class="note">אין תבניות.</p>'}</div>
    <p class="note">תבנית היא רק קיצור למתן זיכוי. היא לא נותנת זיכוי לבד – אין הענקה אוטומטית.</p>`;
  $('#addr', root).onclick = () => ctx.open((r) => editRule(r, ctx, null));
  $$('#rl [data-r]', root).forEach((b) => { b.onclick = () => ctx.open((r) => editRule(r, ctx, rules.find((x) => x.id === b.dataset.r))); });
  $('#find', root).onclick = async (ev) => {
    const email = $('#sf', root).email.value.trim();
    if (!email) { toast('כתבו מייל', true); return; }
    const found = await busy(ev.target, () => api.findCustomersByEmail(email));
    if (!found) return;
    $('#found', root).innerHTML = found.length ? found.map((c) => `<button class="li" data-c="${esc(c.id)}"><div class="m"><b>${esc(c.companyName || c.name || '')}</b><small dir="ltr">${esc(c.email || '')}</small></div><span class="tag">${c.type === 'customer_wholesale' ? 'סיטונאי' : 'פרטי'}</span></button>`).join('') : '<p class="note">לא נמצא לקוח עם המייל הזה.</p>';
    $$('#found [data-c]', root).forEach((b) => { b.onclick = () => ctx.open((r) => customerCredits(r, ctx, found.find((x) => x.id === b.dataset.c))); });
  };
}

async function customerCredits(root, ctx, c) {
  if (!needMgr(root)) return;
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${esc(c.companyName || c.name || '')}</h2>
    <div class="card"><p>${esc(c.name || '')} · <span dir="ltr">${esc(c.email || '')}</span> · ${c.type === 'customer_wholesale' ? 'סיטונאי' : 'לקוח פרטי'}</p></div><div id="crPart"></div>`;
  $('#bk', root).onclick = () => ctx.back();
  await creditSection($('#crPart', root), ctx, c, () => ctx.replace((rt) => customerCredits(rt, ctx, c)));
}

async function editRule(root, ctx, r) {
  if (!needMgr(root)) return;
  const n = r || { kind: 'amount', active: true };
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${r ? 'עריכת תבנית' : 'תבנית חדשה'}</h2>
    <form id="f" class="card" onsubmit="return false">
    <label class="f"><span>שם התבנית</span><input name="name" maxlength="100" value="${esc(n.name || '')}" required></label>
    <div class="grid2"><label class="f"><span>סוג</span><select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${n.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>ערך</span><input name="value" inputmode="decimal" dir="ltr" value="${esc(n.value != null ? n.value : '')}" required></label></div>
    <label class="f"><span>תוקף בימים (ריק = ברירת המחדל של ההגדרות)</span><input name="days" inputmode="numeric" dir="ltr" value="${esc(n.validityDays != null ? n.validityDays : '')}"></label>
    <label class="ck"><input type="checkbox" name="active" ${n.active !== false ? 'checked' : ''}>התבנית פעילה</label>
    </form><button class="btn w" id="save">${r ? 'שמור שינויים' : 'צור תבנית'}</button>`;
  $('#bk', root).onclick = () => ctx.back();
  const f = $('#f', root);
  $('#save', root).onclick = async (ev) => {
    const d = f.days.value.trim();
    const input = { name: f.name.value.trim(), kind: f.kind.value, value: numOrText(f.value.value.trim()), active: f.active.checked, validityDays: d ? (/^\d+$/.test(d) ? Number(d) : d) : null };
    if (r) input.ruleId = r.id;
    const x = await busy(ev.target, () => api.saveCreditRule(input), 'נשמר');
    if (x) ctx.back();
  };
}

export default { id: 'credits', title: 'זיכויים', roles: ['manager'], render };
