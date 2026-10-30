/* מסך "מבצעים וקופונים" (מנהל בלבד, שלב 5.2): רשימת מבצעים וקופונים עם מספר השימושים, יצירה ועריכה.
   כל כתיבה עוברת בפונקציות השרת savePromotion ו-saveCoupon (מנהל בלבד; השרת בודק כל ערך ורושם ביומן).
   החישוב של ההנחה נעשה רק בשרת, בקופה. כאן רק מגדירים. */
import * as api from '../api.js';
import { esc, $, $$, toast, busy, numOrText } from '../ui.js';

const KIND = { percent: 'אחוז', fixed: 'שקלים' };
const SCOPE = { product: 'מוצרים', category: 'קטגוריות', site: 'כל האתר' };
const TYPES = [['customer_private', 'לקוח פרטי'], ['customer_wholesale', 'לקוח סיטונאי']];
const dateStr = (t) => { try { const d = t ? new Date(t) : null; return d && !isNaN(d) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : ''; } catch (e) { return ''; } };
const valText = (x) => (x.kind === 'percent' ? `${x.value}%` : `${x.value} ₪`);
const winText = (x) => (x.validFrom || x.validUntil ? ` · ${dateStr(x.validFrom) || '…'} עד ${dateStr(x.validUntil) || '…'}` : '');
const typesText = (x) => ((x.customerTypes && x.customerTypes.length ? x.customerTypes : ['customer_private']).map((t) => (TYPES.find((y) => y[0] === t) || [, t])[1]).join(', '));
const needMgr = (root) => { if (api.isManager()) return true; root.innerHTML = '<div class="card"><p class="err">המסך הזה למנהל בלבד.</p></div>'; return false; };
// תאריך מהשדה ← מחרוזת ISO עם אזור הזמן של המכשיר (השרת דורש תאריך ושעה). "עד" נכלל עד סוף היום.
const iso = (v, end) => (v ? new Date(v + (end ? 'T23:59:59' : 'T00:00:00')).toISOString() : null);
const typeBoxes = (sel) => TYPES.map(([k, l]) => `<label class="ck"><input type="checkbox" name="ct" value="${k}" ${sel.includes(k) ? 'checked' : ''}>${l}</label>`).join('');
const readTypes = (f) => [...f.querySelectorAll('input[name=ct]:checked')].map((e) => e.value);

async function render(root, ctx) {
  if (!needMgr(root)) return;
  const [promos, coupons] = await Promise.all([api.listPromotions(), api.listCoupons()]);
  promos.sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  coupons.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  root.innerHTML = `<h2>מבצעים וקופונים</h2>
    <div class="row" style="margin-bottom:10px"><button class="btn grow" id="addp">＋ מבצע חדש</button><button class="btn g grow" id="addc">＋ קופון חדש</button></div>
    <h3>מבצעים <small class="note">(${promos.length})</small></h3>
    <div id="pl">${promos.map((p) => `<button class="li" data-p="${esc(p.id)}"><div class="m"><b>${esc(p.name || p.id)}</b><small>${esc(valText(p))} · ${esc(SCOPE[p.scope] || '')}${p.scope !== 'site' ? ` (${(p.targetIds || []).length})` : ''} · ${esc(typesText(p))}${esc(winText(p))}</small></div>
      <div>${p.active === false ? '<span class="tag">כבוי</span>' : '<span class="tag ok">פעיל</span>'}${p.isDemo ? ' <span class="tag">דמו</span>' : ''}</div></button>`).join('') || '<p class="note">אין מבצעים.</p>'}</div>
    <h3>קופונים <small class="note">(${coupons.length})</small></h3>
    <div id="cl">${coupons.map((c) => `<button class="li" data-c="${esc(c.id)}"><div class="m"><b dir="ltr">${esc(c.id)}</b><small>${esc(valText(c))} · ${esc(typesText(c))}${esc(winText(c))}${c.minOrderNet != null ? ` · מינימום ${esc(c.minOrderNet)} ₪ לפני מע"מ` : ''}</small></div>
      <div><span class="tag gold">שימושים: ${esc(c.usedCount || 0)}${c.maxUses != null ? ' מתוך ' + esc(c.maxUses) : ''}</span> ${c.active === false ? '<span class="tag">כבוי</span>' : '<span class="tag ok">פעיל</span>'}${c.isDemo ? ' <span class="tag">דמו</span>' : ''}</div></button>`).join('') || '<p class="note">אין קופונים.</p>'}</div>
    <p class="note">הקוד נשלח לשרת בקופה, והשרת מחשב את ההנחה. כל שמירה נרשמת ביומן.</p>`;
  $('#addp').onclick = () => ctx.open((r) => editPromo(r, ctx, null));
  $('#addc').onclick = () => ctx.open((r) => editCoupon(r, ctx, null));
  $$('#pl [data-p]').forEach((b) => { b.onclick = () => ctx.open((r) => editPromo(r, ctx, promos.find((x) => x.id === b.dataset.p))); });
  $$('#cl [data-c]').forEach((b) => { b.onclick = () => ctx.open((r) => editCoupon(r, ctx, coupons.find((x) => x.id === b.dataset.c))); });
}

async function editPromo(root, ctx, p) {
  if (!needMgr(root)) return;
  const [prods, cats] = await Promise.all([api.listProducts(), api.listCategories()]);
  const n = p || { kind: 'percent', scope: 'product', targetIds: [], customerTypes: ['customer_private'], active: true };
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${p ? 'עריכת מבצע' : 'מבצע חדש'}</h2>
    <form id="f" class="card" onsubmit="return false">
    <label class="f"><span>שם המבצע</span><input name="name" maxlength="100" value="${esc(n.name || '')}" required></label>
    <div class="grid2"><label class="f"><span>סוג ההנחה</span><select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${n.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>גודל ההנחה</span><input name="value" inputmode="decimal" dir="ltr" value="${esc(n.value != null ? n.value : '')}" required></label></div>
    <label class="f"><span>על מה חל המבצע</span><select name="scope">${Object.entries(SCOPE).map(([k, l]) => `<option value="${k}" ${n.scope === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f" id="tw"><span id="tl"></span><select name="targets" multiple size="8"></select></label>
    <p class="note" id="sitenote" hidden>מבצע על כל האתר מוגדר באחוזים בלבד. הנחה בשקלים לכל האתר – דרך קופון.</p>
    <div class="f"><span>למי</span>${typeBoxes(n.customerTypes || ['customer_private'])}</div>
    <div class="grid2"><label class="f"><span>מתאריך (לא חובה)</span><input type="date" name="from" value="${esc(dateStr(n.validFrom))}"></label>
    <label class="f"><span>עד תאריך (לא חובה, כולל)</span><input type="date" name="until" value="${esc(dateStr(n.validUntil))}"></label></div>
    <label class="ck"><input type="checkbox" name="active" ${n.active !== false ? 'checked' : ''}>המבצע פעיל</label>
    </form><button class="btn w" id="save">${p ? 'שמור שינויים' : 'צור מבצע'}</button>`;
  $('#bk').onclick = () => ctx.back();
  const f = $('#f');
  const drawTargets = () => {
    const sc = f.scope.value;
    $('#tw').hidden = sc === 'site'; $('#sitenote').hidden = sc !== 'site';
    $('#tl').textContent = sc === 'product' ? 'המוצרים (לחיצה ארוכה או Ctrl לבחירה של כמה)' : 'הקטגוריות';
    const keep = new Set(n.scope === sc ? n.targetIds : []);
    const cur = new Set([...f.targets.selectedOptions].map((o) => o.value)); const sel = cur.size ? cur : keep;
    const list = sc === 'product' ? prods.map((x) => [x.id, `${x.name} · ${x.sku || ''}`]) : cats.map((x) => [x.id, x.name]);
    f.targets.innerHTML = list.map(([id, l]) => `<option value="${esc(id)}" ${sel.has(id) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  };
  f.scope.onchange = () => { n.scope = null; drawTargets(); };
  drawTargets();
  $('#save').onclick = async (ev) => {
    const v = numOrText(f.value.value.trim());
    const input = { name: f.name.value.trim(), kind: f.kind.value, value: v, scope: f.scope.value, customerTypes: readTypes(f), validFrom: iso(f.from.value), validUntil: iso(f.until.value, true), active: f.active.checked };
    if (input.scope !== 'site') input.targetIds = [...f.targets.selectedOptions].map((o) => o.value);
    if (p) input.promotionId = p.id;
    if (!input.customerTypes.length) { toast('בחרו למי המבצע', true); return; }
    const r = await busy(ev.target, () => api.savePromotion(input), (x) => (x.warnings && x.warnings.length ? `נשמר. שימו לב: הרווח אחרי ההנחה נמוך מ-20% ב-${x.warnings.length} מוצרים` : 'נשמר'));
    if (!r) return;
    if (r.warnings && r.warnings.length) toast(r.warnings.slice(0, 3).map((w) => `${w.name || w.productId}: ${w.profitPercent}%`).join(' · '), true);
    ctx.back();
  };
}

async function editCoupon(root, ctx, c) {
  if (!needMgr(root)) return;
  const n = c || { kind: 'percent', customerTypes: ['customer_private'], active: true };
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${c ? 'עריכת קופון' : 'קופון חדש'}</h2>
    <form id="f" class="card" onsubmit="return false">
    <label class="f"><span>קוד הקופון (אנגלית, ספרות, מקף; 3 עד 32 תווים)</span><input name="code" dir="ltr" maxlength="32" value="${esc(c ? c.id : '')}" ${c ? 'readonly' : ''} required></label>
    ${c ? `<p class="note">נוצל ${esc(c.usedCount || 0)} פעמים${c.maxUses != null ? ' מתוך ' + esc(c.maxUses) : ''}. עדכון הקופון לא מאפס את המספר.</p>` : ''}
    <div class="grid2"><label class="f"><span>סוג ההנחה</span><select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${n.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>גודל ההנחה</span><input name="value" inputmode="decimal" dir="ltr" value="${esc(n.value != null ? n.value : '')}" required></label></div>
    <div class="grid2"><label class="f"><span>מספר שימושים מקסימלי (ריק = בלי הגבלה)</span><input name="maxUses" inputmode="numeric" dir="ltr" value="${esc(n.maxUses != null ? n.maxUses : '')}"></label>
    <label class="f"><span>מינימום הזמנה ₪ לפני מע"מ (לא חובה)</span><input name="min" inputmode="decimal" dir="ltr" value="${esc(n.minOrderNet != null ? n.minOrderNet : '')}"></label></div>
    <div class="f"><span>למי</span>${typeBoxes(n.customerTypes || ['customer_private'])}</div>
    <div class="grid2"><label class="f"><span>מתאריך (לא חובה)</span><input type="date" name="from" value="${esc(dateStr(n.validFrom))}"></label>
    <label class="f"><span>עד תאריך (לא חובה, כולל)</span><input type="date" name="until" value="${esc(dateStr(n.validUntil))}"></label></div>
    <label class="ck"><input type="checkbox" name="active" ${n.active !== false ? 'checked' : ''}>הקופון פעיל</label>
    </form><button class="btn w" id="save">${c ? 'שמור שינויים' : 'צור קופון'}</button>`;
  $('#bk').onclick = () => ctx.back();
  const f = $('#f');
  $('#save').onclick = async (ev) => {
    const mu = f.maxUses.value.trim();
    const input = { code: f.code.value.trim(), kind: f.kind.value, value: numOrText(f.value.value.trim()), customerTypes: readTypes(f), validFrom: iso(f.from.value), validUntil: iso(f.until.value, true), active: f.active.checked,
      maxUses: mu ? (/^\d+$/.test(mu) ? Number(mu) : mu) : null, minOrderNet: f.min.value.trim() ? numOrText(f.min.value.trim()) : null };
    if (!input.customerTypes.length) { toast('בחרו למי הקופון', true); return; }
    const r = await busy(ev.target, () => api.saveCoupon(input), (x) => (x.created ? 'הקופון נוצר: ' + x.code : 'נשמר'));
    if (r) ctx.back();
  };
}

export default { id: 'promotions', title: 'מבצעים', roles: ['manager'], render };
