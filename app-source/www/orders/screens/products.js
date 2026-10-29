/* מסך "מוצרים": רשימה, הוספה ועריכה של כל שדה, צבעים, "אזל" / "המלאי התחדש",
   ומחיר עלות (בלי מע"מ, ולידו הסכום עם מע"מ) ומחיר סיטונאי – רק למנהל. עובד רואה רשימה ופרטים לקריאה בלבד. */
import * as api from '../api.js';
import { esc, $, $$, ils, withVat, toast, busy, val, numOrText, confirmBox, dialog } from '../ui.js';

const FIELDS = [
  // [שדה, תווית, סוג]
  ['name', 'שם המוצר', 'text'], ['sku', 'מק"ט', 'text'], ['categoryId', 'קטגוריה', 'cat'], ['pricePrivate', 'מחיר לפרטי (כולל מע"מ, לחבילה)', 'num'],
  ['unitsPerPack', 'יחידות בחבילה', 'num'], ['barcode', 'ברקוד', 'text'], ['description', 'תיאור', 'area'],
  ['isBakingProduct', 'מוצר אפייה', 'bool'], ['kashrut', 'כשרות (חובה במוצר אפייה)', 'text'], ['allergens', 'אלרגנים (מופרדים בפסיק)', 'list'],
  ['leadTimeHoursOverride', 'זמן הכנה מיוחד (שעות, ריק = רגיל)', 'num'], ['deliveryAllowed', 'אפשר משלוח', 'bool'], ['inTableEditor', 'בעורך השולחן', 'bool'],
  ['relatedIds', 'מוצרים קשורים (מזהים, מופרדים בפסיק)', 'list'], ['complementIds', 'מוצרים משלימים (מזהים, מופרדים בפסיק)', 'list'],
  ['active', 'פעיל (מוצג באתר)', 'bool'], ['sortOrder', 'סדר בתצוגה', 'num'],
];
let CATS = null; let VAT = undefined;
async function loadCats() { CATS = (await api.listCategories()).sort((a, b) => (a.order || 0) - (b.order || 0)); return CATS; }
async function loadVat() { const s = await api.getSettings('private'); const v = s && s.invoices && s.invoices.vatRate; VAT = Number.isFinite(Number(v)) && v !== null ? Number(v) : null; return VAT; }
const catName = (id) => { const c = (CATS || []).find((x) => x.id === id); return c ? c.name : '—'; };
const swatches = (p) => (p.colorSummary || []).slice(0, 8).map((h) => `<span class="sw" style="background:${esc(h)}"></span>`).join(' ');

async function list(root, ctx) {
  const [items] = await Promise.all([api.listProducts(), loadCats()]);
  items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name).localeCompare(String(b.name), 'he'));
  const mgr = api.isManager();
  root.innerHTML = `<h2>מוצרים <small class="note">(${items.length})</small></h2>
    <div class="row" style="margin-bottom:10px"><input class="grow" id="q" type="search" placeholder="חיפוש לפי שם או מק״ט">${mgr ? '<button class="btn" id="add">＋ מוצר חדש</button>' : ''}</div>
    ${mgr ? '' : '<p class="note">תצוגה לקריאה בלבד. שינויים במוצרים עושה המנהל.</p>'}
    <div id="lst"></div>`;
  const draw = () => {
    const t = $('#q').value.trim().toLowerCase();
    const f = t ? items.filter((p) => String(p.name || '').toLowerCase().includes(t) || String(p.sku || '').toLowerCase().includes(t)) : items;
    $('#lst').innerHTML = f.slice(0, 300).map((p) => `<button class="li" data-id="${esc(p.id)}"><div class="m"><b>${esc(p.name)}</b><small>מק״ט ${esc(p.sku)} · ${esc(catName(p.categoryId))} · ${ils(p.pricePrivate)}</small><div>${swatches(p)}</div></div>
      ${p.active === false ? '<span class="tag">לא פעיל</span>' : ''}${p.soldOutAll ? '<span class="tag bad">אזל</span>' : ''}${p.isDemo ? '<span class="tag gold">דמו</span>' : ''}</button>`).join('')
      + (f.length > 300 ? `<p class="note">מוצגים 300 מתוך ${f.length}. צמצם בחיפוש.</p>` : '') + (f.length ? '' : '<p class="note">אין מוצרים.</p>');
    $$('#lst .li').forEach((b) => { b.onclick = () => ctx.open((r) => edit(r, ctx, b.dataset.id)); });
  };
  $('#q').oninput = draw; draw();
  if (mgr) $('#add').onclick = () => ctx.open((r) => edit(r, ctx, null));
}

function fieldHtml([k, label, type], p, ro) {
  const v = p[k];
  const dis = ro ? 'disabled' : '';
  if (type === 'bool') return `<label class="ck"><input type="checkbox" name="${k}" ${v ? 'checked' : ''} ${dis}>${esc(label)}</label>`;
  if (type === 'cat') return `<label class="f"><span>${esc(label)}</span><select name="${k}" ${dis}><option value="">בחר קטגוריה</option>${(CATS || []).map((c) => `<option value="${esc(c.id)}" ${c.id === v ? 'selected' : ''}>${esc(c.name)}${c.active === false ? ' (לא פעילה)' : ''}${c.isBakingProduct ? ' · אפייה' : ''}</option>`).join('')}</select></label>`;
  if (type === 'area') return `<label class="f"><span>${esc(label)}</span><textarea name="${k}" ${dis}>${esc(v || '')}</textarea></label>`;
  const shown = Array.isArray(v) ? v.join(', ') : (v == null ? '' : v);
  return `<label class="f"><span>${esc(label)}</span><input name="${k}" value="${esc(shown)}" ${type === 'num' ? 'inputmode="decimal"' : ''} ${k === 'sku' || k === 'barcode' || type === 'list' && k !== 'allergens' ? 'dir="ltr"' : ''} ${dis}></label>`;
}
// הערך מהטופס, בצורה שהשרת מקבל
function formValue(form, [k, , type]) {
  const v = val(form, k);
  if (type === 'bool') return v;
  if (type === 'list') return v === '' ? [] : v.split(',').map((x) => x.trim()).filter(Boolean);
  if (type === 'num') return numOrText(v);
  if (type === 'cat') return v === '' ? null : v;
  return v === '' ? null : v;
}
const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

function variantRow(v, i, ro) {
  const hex = v.colorHex || '#FFFFFF';
  return `<div class="card" data-vi="${i}" ${v.id ? `data-vid="${esc(v.id)}"` : ''} style="background:var(--card2)">
    <div class="row"><input type="color" name="hex" value="${esc(hex)}" ${ro ? 'disabled' : ''} aria-label="קוד צבע"><input class="grow" name="cname" value="${esc(v.colorName || '')}" placeholder="שם הצבע" ${ro ? 'disabled' : ''}>
    ${v.id ? `<span class="tag ${v.soldOut ? 'bad' : 'ok'}">${v.soldOut ? 'אזל' : 'במלאי'}</span>` : '<span class="tag gold">חדש</span>'}</div>
    ${v.id ? `<div class="row" style="margin-top:6px"><small class="note">${(v.images || []).length} תמונות${v.placeholder ? ' · אין עדיין תמונה' : ''}</small>
      ${ro ? '' : `<button type="button" class="btn s ${v.soldOut ? '' : 'bad'}" data-so="${v.soldOut ? '0' : '1'}">${v.soldOut ? 'המלאי התחדש' : 'סמן "אזל"'}</button>`}</div>
      <div class="row" style="margin-top:6px">${(v.images || []).slice(0, 6).map((im) => `<img class="thumb" alt="" loading="lazy" src="${esc(api.publicImageUrl(String(im.path).replace(/\.webp$/, '_small.webp')))}">`).join('')}</div>` : ''}
  </div>`;
}

async function edit(root, ctx, id) {
  const mgr = api.isManager();
  const ro = !mgr;
  await Promise.all([CATS ? null : loadCats(), VAT === undefined ? loadVat() : null]);
  const p = id ? await api.getProduct(id) : { active: true, deliveryAllowed: true, unitsPerPack: 1, sortOrder: 0 };
  if (!p) { root.innerHTML = '<p class="err">המוצר לא נמצא</p>'; return; }
  const variants = id ? await api.listVariants(id) : [];
  // מחיר עלות ומחיר סיטונאי נטענים רק אצל מנהל
  const cost = mgr && id ? await api.getCost(id) : null;
  const ws = mgr && id ? await api.getWholesalePrice(id) : null;
  const newV = [];
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה לרשימה</button>
    <h2>${id ? esc(p.name) : 'מוצר חדש'}</h2>${p.isDemo ? '<p class="note">מוצר דמו (isDemo)</p>' : ''}
    <form id="pf" class="card">${FIELDS.map((f) => fieldHtml(f, p, ro)).join('')}</form>
    <h3>צבעים</h3><div id="vars">${variants.map((v, i) => variantRow(v, i, ro)).join('')}</div>
    ${ro ? '' : '<button class="btn g w" id="addv" type="button">＋ צבע</button>'}
    ${mgr ? `<h3>מחירים פנימיים – רק מנהל</h3><div class="card cost">
      <label class="f"><span>מחיר עלות לחבילה, בלי מע"מ</span><input id="cost" inputmode="decimal" value="${esc(cost && cost.cost != null ? cost.cost : '')}" dir="ltr"></label>
      <div class="vat" id="vatl"></div>
      <label class="f"><span>עדיפות לעוזר (0 עד 3)</span><select id="prio">${[0, 1, 2, 3].map((n) => `<option ${cost && cost.assistantPriority === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${cost && cost.marginScore != null ? `<p class="note">ציון רווחיות (מחושב בשרת): ${esc(cost.marginScore)}</p>` : ''}
      <label class="f"><span>מחיר סיטונאי בסיסי לחבילה (בלי מע"מ, ריק = אין)</span><input id="wsp" inputmode="decimal" value="${esc(ws && ws.price != null ? ws.price : '')}" dir="ltr"></label>
    </div>` : ''}
    ${ro ? '' : '<button class="btn w" id="save">שמור</button><p class="err" id="perr" role="alert"></p>'}`;
  $('#bk').onclick = () => ctx.back();
  if (ro) return;
  const vatLine = () => {
    const c = $('#cost').value.trim();
    const w = withVat(c, VAT);
    $('#vatl').textContent = VAT == null ? 'אחוז המע"מ לא הוגדר (הגדרות האתר ← מע"מ), ולכן לא מוצג סכום עם מע"מ' : (c === '' ? `מע"מ ${VAT}%` : (w == null ? '' : `עם מע"מ (${VAT}%): ${ils(w)}`));
  };
  $('#cost').oninput = vatLine; vatLine();
  $('#addv').onclick = () => {
    const i = variants.length + newV.length; newV.push({});
    $('#vars').insertAdjacentHTML('beforeend', variantRow({}, i, false));
  };
  $$('#vars [data-so]').forEach((b) => {
    b.onclick = async () => {
      const vid = b.closest('[data-vid]').dataset.vid; const so = b.dataset.so === '1';
      if (so && !(await confirmBox('לסמן את הצבע הזה "אזל"? הוא יוצג באתר כלא זמין.', 'סמן "אזל"'))) return;
      const r = await busy(b, () => api.setVariantSoldOut(id, vid, so), so ? 'סומן "אזל"' : 'סומן "המלאי התחדש"');
      if (r) ctx.replace((rt) => edit(rt, ctx, id));
    };
  });
  $('#save').onclick = async () => {
    const form = $('#pf'); const out = {};
    for (const f of FIELDS) { const v = formValue(form, f); if (!id ? (v !== null && !(Array.isArray(v) && !v.length)) : !same(v, p[f[0]])) out[f[0]] = v; }
    const vs = [];
    $$('#vars [data-vi]').forEach((card) => {
      const colorName = card.querySelector('[name=cname]').value.trim(); const colorHex = card.querySelector('[name=hex]').value.toUpperCase();
      const vid = card.dataset.vid;
      if (vid) { const old = variants.find((v) => v.id === vid); if (old.colorName !== colorName || String(old.colorHex || '').toUpperCase() !== colorHex) vs.push({ variantId: vid, colorName, colorHex }); } else if (colorName) vs.push({ colorName, colorHex });
    });
    const costIn = $('#cost').value.trim(); const prio = Number($('#prio').value); const wsIn = $('#wsp').value.trim();
    const costChanged = !same(numOrText(costIn), cost ? cost.cost : null) || (cost ? cost.assistantPriority !== prio : (prio !== 0 && costIn !== ''));
    const wsChanged = !same(numOrText(wsIn), ws ? ws.price : null);
    if (!Object.keys(out).length && !vs.length && !costChanged && !wsChanged) { toast('אין שינויים לשמירה'); return; }
    $('#perr').textContent = '';
    const b = $('#save'); let created = null;
    // שינוי כללי של מחיר סיטונאי במוצר קיים – שלב 1: השרת מחזיר את הלקוחות עם מחיר קבוע למוצר, והמנהל מחליט לכל אחד
    let fixedPrices = [];
    if (wsChanged && id) {
      const pv = await busy(b, () => api.previewWholesalePrices([{ productId: id, price: numOrText(wsIn) }]));
      if (!pv) return;
      const list = pv.fixedPriceCustomers || [];
      if (list.length) {
        const pick = await fixedDecisions(list, ws ? ws.price : null, numOrText(wsIn));
        if (!pick) { toast('השמירה בוטלה. שום דבר לא נשמר.'); return; }
        fixedPrices = pick;
      }
    }
    const r = await busy(b, async () => {
      let pid = id; const done = [];
      if (Object.keys(out).length || vs.length || !id) { const s = await api.saveProduct(id, out, vs); pid = s.productId; if (!id) created = pid; done.push('פרטי המוצר'); }
      try {
        if (costChanged) { await api.setProductCost(pid, numOrText(costIn), prio); done.push('מחיר העלות'); }
        if (wsChanged) { const w = await api.commitWholesalePrices([{ productId: pid, price: numOrText(wsIn) }], fixedPrices); done.push('המחיר הסיטונאי' + (w && w.fixedChanged ? ` (ו-${w.fixedChanged} מחירים קבועים של לקוחות)` : '')); }
      } catch (e) { e.message = (done.length ? `נשמרו: ${done.join(', ')}. לא נשמר: ` : '') + e.message; throw e; }
      return { pid, done };
    }, (x) => 'נשמר: ' + x.done.join(', '));
    // מוצר חדש שנשמר, גם אם העלות לא נשמרה: עוברים לעריכה שלו, כדי שלחיצה נוספת לא תיצור מוצר כפול
    if (r || created) { CATS = null; ctx.replace((rt) => edit(rt, ctx, r ? r.pid : created)); }
  };
}

// שלב 2 של שינוי כללי: לכל לקוח עם מחיר קבוע – להשאיר, להעלות באותו אחוז, או לקבוע סכום. מחזיר fixedPrices, או null בביטול.
async function fixedDecisions(list, oldBase, newBase) {
  const canPct = Number(oldBase) > 0 && Number(newBase) > 0;
  const pct = (price) => Math.round((Math.round(price * 100) * Math.round(newBase * 100)) / Math.round(oldBase * 100)) / 100; // כמו בשרת, באגורות
  const html = `<p><b>ללקוחות האלה יש מחיר קבוע למוצר הזה.</b></p><p class="note">המחיר הבסיסי משתנה מ-${ils(oldBase)} ל-${ils(newBase)} (בלי מע"מ). מה לעשות במחיר הקבוע של כל אחד?</p>
    ${list.map((f, i) => `<div class="card" data-fx="${i}" style="background:var(--card2)"><b>${esc(f.customerName || f.customerUid)}</b><p class="note">המחיר הקבוע היום: ${ils(f.price)}</p>
      <label class="ck"><input type="radio" name="fx${i}" value="keep" checked>להשאיר: ${ils(f.price)}</label>
      <label class="ck"><input type="radio" name="fx${i}" value="same_percent" ${canPct ? '' : 'disabled'}>להעלות באותו אחוז${canPct ? ': ' + ils(pct(f.price)) : ' (אין מחיר ישן או חדש)'}</label>
      <label class="ck"><input type="radio" name="fx${i}" value="set">לקבוע סכום:</label><input data-set inputmode="decimal" dir="ltr" placeholder="מחיר בלי מע&quot;מ"></div>`).join('')}`;
  const r = await dialog(html, [[true, 'המשך ושמור']], (box) => list.map((f, i) => {
    const card = box.querySelector(`[data-fx="${i}"]`);
    const action = card.querySelector(`input[name=fx${i}]:checked`).value;
    const o = { customerUid: f.customerUid, productId: f.productId, action };
    if (action === 'set') o.price = numOrText(card.querySelector('[data-set]').value.trim());
    return o;
  }));
  return r ? r.data : null;
}

export default { id: 'products', title: 'מוצרים', roles: ['manager', 'employee'], render: list };
