/* מסך "השראות" (מנהל בלבד, שלב 3.4): יצירה ועריכה של השראת שולחן, העלאה מודרכת של סדרות צילומים, סימון מוצרים על הצילום,
   הצעות זיהוי (אם הספק דלוק – תמיד רק הצעה, והמנהל מאשר), פרסום, ומסכים קטנים לסוגי אירועים ולכללי כמות.
   כל כתיבה עוברת בפונקציות השרת (מנהל בלבד). בחירת הצילומים – בבורר הקבצים הרגיל של הטלפון, בלי הרשאה חדשה ובלי תוסף. */
import * as api from '../api.js';
import { esc, $, $$, toast, busy, confirmBox, dialog } from '../ui.js';

const ANG = [['side', 'מהצד', 36], ['seat', 'מגובה האורח', 12], ['top', 'מלמעלה', 2]];
const REASON = { missing: 'המוצר לא קיים', inactive: 'המוצר לא פעיל', 'variant-missing': 'הצבע לא קיים', 'no-items': 'אין פריטים בהשראה' };
const RULE_TYPES = { per_guest: 'לסועד', per_table: 'לשולחן (יחידה לכל כמה סועדים)', fixed: 'כמות קבועה' };
let PRODUCTS = null; // רשימה עדכנית בכל כניסה למסך
const VCACHE = {};
const pById = (id) => (PRODUCTS || []).find((p) => p.id === id);
const dateStr = (t) => { try { const d = t && t.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? d.toISOString().slice(0, 10) : ''; } catch (e) { return ''; } };
async function variantsOf(pid) { if (!VCACHE[pid]) VCACHE[pid] = await api.listVariants(pid); return VCACHE[pid]; }
async function loadProducts() { if (!PRODUCTS) PRODUCTS = await api.listProducts(); }
function productSelect(filter, selected) {
  const t = String(filter || '').trim().toLowerCase();
  const list = (PRODUCTS || []).filter((p) => !t || String(p.name).toLowerCase().includes(t) || String(p.sku).toLowerCase().includes(t)).slice(0, 60);
  if (selected && !list.some((p) => p.id === selected) && pById(selected)) list.unshift(pById(selected));
  return '<option value="">בחר מוצר</option>' + list.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${esc(p.sku)}</option>`).join('');
}
const needMgr = (root) => { if (api.isManager()) return true; root.innerHTML = '<div class="card"><p class="err">המסך הזה למנהל בלבד.</p></div>'; return false; };

// ---------- רשימת ההשראות ----------
async function render(root, ctx) {
  if (!needMgr(root)) return;
  PRODUCTS = null;
  const list = (await api.listInspirations()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  root.innerHTML = `<h2>השראות <small class="note">(${list.length})</small></h2>
    <div class="row" style="margin-bottom:10px"><button class="btn grow" id="add">＋ השראה חדשה</button><button class="btn g grow" id="ev">סוגי אירועים</button><button class="btn g grow" id="qr">כללי כמות</button></div>
    <div id="lst">${list.map((x) => {
      const fr = (x.frames && x.frames.side ? x.frames.side : []).length; const hs = Object.values(x.hotspots || {}).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
      return `<button class="li" data-id="${esc(x.id)}"><div class="m"><b>${esc(x.name || x.id)}</b><small>${(x.items || []).length} פריטים · ${fr} צילומים מהצד · ${hs} נקודות${x.isHoliday ? ' · ' + esc(dateStr(x.showFrom)) + ' עד ' + esc(dateStr(x.showUntil)) : ''}</small>
      <div>${x.active === true ? '<span class="tag ok">מפורסמת</span>' : '<span class="tag">טיוטה</span>'} ${x.hidden === true ? '<span class="tag bad">הוסתרה</span>' : ''} ${x.isHoliday ? '<span class="tag gold">שולחן חג</span>' : ''} ${x.isDemo ? '<span class="tag gold">דמו</span>' : ''}</div></div><span>‹</span></button>`;
    }).join('') || '<p class="note">אין עדיין השראות.</p>'}</div>`;
  $('#add').onclick = () => ctx.open((r) => edit(r, ctx, null));
  $('#ev').onclick = () => ctx.open((r) => eventTypes(r, ctx));
  $('#qr').onclick = () => ctx.open((r) => quantityRules(r, ctx));
  $$('#lst [data-id]').forEach((b) => { b.onclick = () => ctx.open((r) => edit(r, ctx, b.dataset.id)); });
}

// ---------- יצירה ועריכה ----------
async function edit(root, ctx, id) {
  if (!needMgr(root)) return;
  const [insp, types] = await Promise.all([id ? api.getInspiration(id) : null, api.listEventTypes(), loadProducts()]);
  if (id && !insp) throw new Error('ההשראה לא נמצאה');
  types.sort((a, b) => (a.order || 0) - (b.order || 0));
  const S = { id, insp: insp || { items: [], frames: {}, hotspots: {} }, items: ((insp && insp.items) || []).map((i) => ({ productId: i.productId, variantId: i.variantId || null })), pts: {}, sug: {}, angle: 'side', jobId: {} };
  const n = S.insp;
  const itemName = (it) => { const p = pById(it.productId); const v = (VCACHE[it.productId] || []).find((x) => x.id === it.variantId); return (p ? p.name : it.productId) + (it.variantId ? ' · ' + (v ? v.colorName : it.variantId) : ''); };
  await Promise.all([...new Set(S.items.filter((i) => i.variantId).map((i) => i.productId))].map((p) => variantsOf(p).catch(() => [])));
  const getPts = (a) => (S.pts[a] = S.pts[a] || (((S.insp.hotspots || {})[a]) || []).map((h) => ({ productId: h.productId, variantId: h.variantId || null, x: h.x, y: h.y })));
  const num = (h) => S.items.findIndex((i) => i.productId === h.productId && (!h.variantId || !i.variantId || i.variantId === h.variantId)) + 1;

  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${id ? 'עריכת השראה' : 'השראה חדשה'}</h2>
    <form id="f" class="card" onsubmit="return false">
    <label class="f"><span>שם ההשראה</span><input name="name" value="${esc(n.name || '')}" maxlength="120" required></label>
    <div class="grid2"><label class="f"><span>סוג אירוע</span><select name="eventTypeId"><option value="">בחר סוג אירוע</option>${types.map((t) => `<option value="${esc(t.id)}" ${t.id === n.eventTypeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    <label class="f"><span>מספר מקומות בצילום</span><input name="baseGuests" inputmode="numeric" value="${esc(n.baseGuests != null ? n.baseGuests : 10)}"></label></div>
    ${types.length ? '' : '<p class="note">אין סוגי אירועים. הוסיפו קודם במסך "סוגי אירועים".</p>'}
    <label class="ck"><input type="checkbox" name="isHoliday" ${n.isHoliday ? 'checked' : ''}>שולחן חג (מוצג רק בין שני תאריכים)</label>
    <div class="grid2" id="dates" ${n.isHoliday ? '' : 'hidden'}><label class="f"><span>מוצג מתאריך</span><input type="date" name="showFrom" value="${n.isHoliday ? esc(dateStr(n.showFrom)) : ''}"></label>
    <label class="f"><span>מוצג עד תאריך</span><input type="date" name="showUntil" value="${n.isHoliday ? esc(dateStr(n.showUntil)) : ''}"></label></div>
    <h3>הפריטים בשולחן (המספרים על הצילום)</h3><div id="items"></div>
    <label class="f"><span>הוספת פריט</span><input id="q" placeholder="חיפוש מוצר לפי שם או מק״ט"><select id="ps"></select></label>
    <div class="row"><label class="f grow"><span>צבע</span><select id="vs"><option value="">בחר מוצר קודם</option></select></label><button class="btn g" id="addItem" type="button">הוסף</button></div>
    </form><button class="btn w" id="save">${id ? 'שמור שינויים' : 'שמור כטיוטה'}</button>
    <div id="more"></div>`;
  $('#bk').onclick = () => ctx.back();
  const f = $('#f');
  f.isHoliday.onchange = () => { $('#dates').hidden = !f.isHoliday.checked; };
  const drawItems = () => {
    $('#items').innerHTML = S.items.map((it, i) => `<div class="li" style="cursor:default" data-i="${i}"><b style="min-width:26px">${i + 1}</b><div class="m"><b>${esc(itemName(it))}</b>${pById(it.productId) && pById(it.productId).active === false ? '<small class="err">המוצר לא פעיל</small>' : ''}</div>
      <button class="btn g s" data-up type="button" aria-label="למעלה" ${i === 0 ? 'disabled' : ''}>▲</button><button class="btn g s" data-dn type="button" aria-label="למטה" ${i === S.items.length - 1 ? 'disabled' : ''}>▼</button><button class="btn bad s" data-rm type="button" aria-label="הסר">✕</button></div>`).join('') || '<p class="note">עוד אין פריטים. הוסיפו מוצר וצבע.</p>';
    $$('#items [data-i]').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector('[data-up]').onclick = () => { [S.items[i - 1], S.items[i]] = [S.items[i], S.items[i - 1]]; drawItems(); };
      row.querySelector('[data-dn]').onclick = () => { [S.items[i + 1], S.items[i]] = [S.items[i], S.items[i + 1]]; drawItems(); };
      row.querySelector('[data-rm]').onclick = () => { S.items.splice(i, 1); drawItems(); };
    });
  };
  drawItems();
  const ps = $('#ps'), vs = $('#vs');
  ps.innerHTML = productSelect('', '');
  $('#q').oninput = (ev) => { ps.innerHTML = productSelect(ev.target.value, ps.value); };
  ps.onchange = async () => {
    if (!ps.value) { vs.innerHTML = '<option value="">בחר מוצר קודם</option>'; return; }
    vs.innerHTML = '<option value="">טוען…</option>';
    try { const v = await variantsOf(ps.value); vs.innerHTML = '<option value="">ללא צבע מסוים</option>' + v.map((x) => `<option value="${esc(x.id)}">${esc(x.colorName)}</option>`).join(''); } catch (e) { vs.innerHTML = `<option value="">${esc(e.message)}</option>`; }
  };
  $('#addItem').onclick = () => {
    if (!ps.value) { toast('בחר מוצר', true); return; }
    if (S.items.some((i) => i.productId === ps.value && (i.variantId || '') === vs.value)) { toast('הפריט כבר ברשימה', true); return; }
    S.items.push({ productId: ps.value, variantId: vs.value || null }); drawItems();
  };
  $('#save').onclick = async (ev) => {
    const input = { name: f.name.value.trim(), eventTypeId: f.eventTypeId.value, items: S.items, isHoliday: f.isHoliday.checked };
    if (!input.eventTypeId) { toast('בחר סוג אירוע', true); return; }
    const g = f.baseGuests.value.trim(); if (g) input.baseGuests = /^\d+$/.test(g) ? Number(g) : g;
    if (input.isHoliday) { if (f.showFrom.value) input.showFrom = f.showFrom.value; if (f.showUntil.value) input.showUntil = f.showUntil.value + 'T23:59:59'; }
    if (S.id) input.inspirationId = S.id;
    const r = await busy(ev.target, () => api.saveInspiration(input), (x) => (x.unpublished ? 'נשמר. הפריטים השתנו, ולכן ההשראה חזרה לטיוטה – פרסמו שוב' : 'ההשראה נשמרה'));
    if (!r) return;
    ctx.replace((rt) => edit(rt, ctx, r.inspirationId));
  };
  if (!id) { $('#more').innerHTML = '<p class="note">אחרי השמירה אפשר להעלות צילומים, לסמן מוצרים ולפרסם.</p>'; return; }

  // ----- צילומים -----
  const frames = (a) => ((S.insp.frames || {})[a]) || [];
  const reload = async () => { S.insp = (await api.getInspiration(id)) || S.insp; };
  $('#more').innerHTML = `<h3>צילומים</h3><div id="fr"></div><h3>סימון מוצרים על הצילום</h3><div id="hs"></div><h3>פרסום</h3><div id="pub"></div>`;
  const drawFrames = () => {
    $('#fr').innerHTML = ANG.map(([a, label, max]) => `<div class="card" data-a="${a}"><b>${label}</b> <span class="tag">${frames(a).length} מתוך ${max}</span>
      <p class="note" data-msg>${frames(a).length >= max ? 'הסדרה מלאה.' : `הצילום הבא: ${frames(a).length + 1} מתוך ${max}`}</p><div class="prog" hidden><i style="width:0"></i></div>
      <div class="row"><label class="btn grow" style="display:flex;align-items:center;justify-content:center;cursor:pointer">צלם<input type="file" accept="image/*" capture="environment" data-cam hidden></label>
      <label class="btn g grow" style="display:flex;align-items:center;justify-content:center;cursor:pointer">בחירה מהגלריה<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-gal hidden></label></div></div>`).join('');
    $$('#fr [data-a]').forEach((card) => {
      const a = card.dataset.a; const max = ANG.find((x) => x[0] === a)[2];
      const go = (ev) => { const files = [...ev.target.files]; ev.target.value = ''; if (files.length) uploadFrames(card, a, max, files); };
      card.querySelector('[data-cam]').onchange = go; card.querySelector('[data-gal]').onchange = go;
    });
  };
  async function uploadFrames(card, a, max, files) {
    const msg = card.querySelector('[data-msg]'); const bar = card.querySelector('.prog'); const bi = bar.querySelector('i');
    let idx = frames(a).length; let ok = 0; const bad = [];
    bar.hidden = false;
    for (let k = 0; k < files.length; k++) {
      if (idx >= max) { bad.push(`${files[k].name}: הסדרה מלאה (${max})`); break; }
      msg.textContent = `מעלה צילום ${idx + 1} מתוך ${max}…`; bi.style.width = Math.round(k / files.length * 100) + '%';
      try {
        const path = await api.uploadInspirationRaw(id, files[k], idx);
        await api.processInspirationFrames({ inspirationId: id, rawPath: path, angle: a, index: idx });
        ok++; idx++;
        msg.textContent = idx >= max ? `צילום ${idx} מתוך ${max} נשמר. הסדרה מלאה.` : `צילום ${idx} מתוך ${max} נשמר – זוזו לסימון הבא`;
      } catch (e) { bad.push(`${files[k].name || 'צילום'}: ${e.message}`); }
    }
    bi.style.width = '100%';
    await reload();
    if (!card.isConnected) return;
    toast(bad.length ? `נשמרו ${ok}, נכשלו ${bad.length}: ${bad[0]}` : `נשמרו ${ok} צילומים`, !!bad.length);
    drawFrames(); drawHs();
    const c2 = $(`#fr [data-a="${a}"] [data-msg]`); if (c2 && ok) c2.textContent = idx >= max ? `צילום ${idx} מתוך ${max} נשמר. הסדרה מלאה.` : `צילום ${idx} מתוך ${max} נשמר – זוזו לסימון הבא`;
  }

  // ----- סימון מוצרים על הצילום (הצילום הראשון בכל סדרה) -----
  async function drawHs() {
    const have = ANG.filter(([a]) => frames(a).length);
    if (!have.length) { $('#hs').innerHTML = '<p class="note">אחרי העלאת צילום אפשר ללחוץ עליו ולסמן מוצרים.</p>'; return; }
    if (!have.some(([a]) => a === S.angle)) S.angle = have[0][0];
    const a = S.angle; const pts = getPts(a); const sg = S.sug[a] || [];
    $('#hs').innerHTML = `<div class="row" style="margin-bottom:8px">${have.map(([k, l]) => `<button class="btn ${k === a ? '' : 'g'} s" data-ang="${k}" type="button">${l}</button>`).join('')}</div>
      <p class="note">לחצו על הצילום במקום של מוצר ובחרו אותו מהרשימה. רק נקודות שתאשרו נשמרות.</p>
      <div id="stage" style="position:relative;direction:ltr;line-height:0"><img id="fimg" alt="הצילום הראשון בסדרה" style="width:100%;border-radius:12px;border:1px solid var(--line);background:var(--card2);min-height:120px">
      ${pts.map((h, i) => `<span class="hs" style="left:${h.x * 100}%;top:${h.y * 100}%">${num(h) || '?'}</span>`).join('')}
      ${sg.map((d, i) => `<button class="hs sg" type="button" data-sg="${i}" style="left:${d.x * 100}%;top:${d.y * 100}%" aria-label="הצעת זיהוי">?</button>`).join('')}</div>
      <div id="plist">${pts.map((h, i) => `<div class="li" style="cursor:default"><b style="min-width:26px">${num(h) || '?'}</b><div class="m"><b>${esc(itemName(h))}</b></div><button class="btn bad s" data-del="${i}" type="button">הסר</button></div>`).join('')}</div>
      <div class="row"><button class="btn grow" id="hsave" type="button">שמור ${pts.length} נקודות</button><button class="btn g" id="hrec" type="button">הצע זיהוי</button></div>`;
    $('#fimg').src = '';
    api.publicImageUrl && ($('#fimg').src = api.publicImageUrl(frames(a)[0]));
    $$('#hs [data-ang]').forEach((b) => { b.onclick = () => { S.angle = b.dataset.ang; drawHs(); }; });
    const ask = async (x, y, pre) => {
      if (!S.items.length) { toast('הוסיפו פריטים לרשימה ושמרו, ואז סמנו', true); return; }
      const r = await dialog(`<h3 style="margin-top:0">איזה מוצר זה?</h3><select id="hp" size="5">${S.items.map((it, i) => `<option value="${i}" ${i === pre ? 'selected' : ''}>${i + 1}. ${esc(itemName(it))}</option>`).join('')}</select>`, [['ok', 'אשר נקודה']], (m) => m.querySelector('#hp').value);
      if (!r || r.data === '' || r.data == null) return;
      const it = S.items[Number(r.data)]; pts.push({ productId: it.productId, variantId: it.variantId, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }); drawHs();
    };
    $('#fimg').onclick = (ev) => { const b = ev.target.getBoundingClientRect(); ask(Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height))); };
    $$('#hs [data-sg]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); const d = sg[Number(b.dataset.sg)]; const pre = S.items.findIndex((i) => d.suggestions && i.productId === d.suggestions[0]); S.sug[a] = sg.filter((x) => x !== d); ask(d.x, d.y, pre < 0 ? undefined : pre); }; });
    $$('#plist [data-del]').forEach((b) => { b.onclick = () => { pts.splice(Number(b.dataset.del), 1); drawHs(); }; });
    $('#hsave').onclick = async (ev) => {
      const input = { inspirationId: id, angle: a, hotspots: pts.map((h) => ({ productId: h.productId, variantId: h.variantId, x: h.x, y: h.y, approved: true })) };
      if (S.jobId[a]) input.recognitionJobId = S.jobId[a];
      const r = await busy(ev.target, () => api.setInspirationHotspots(input), (x) => `נשמרו ${x.saved} נקודות`);
      if (r) { await reload(); S.pts[a] = null; S.sug[a] = []; drawHs(); }
    };
    $('#hrec').onclick = async (ev) => {
      const r = await busy(ev.target, () => api.recognizeTableProducts({ inspirationId: id, angle: a }));
      if (!r) return;
      if (r.enabled === false) { toast(r.message || 'הזיהוי האוטומטי כבוי – סמנו ידנית'); return; }
      S.sug[a] = r.detections || []; S.jobId[a] = r.recognitionJobId; drawHs();
    };
  }
  // ----- פרסום -----
  const drawPub = () => {
    const live = S.insp.active === true;
    $('#pub').innerHTML = `<div class="card"><p>מצב: ${live ? '<span class="tag ok">מפורסמת באתר</span>' : '<span class="tag">טיוטה</span>'} ${S.insp.hidden === true ? '<span class="tag bad">הוסתרה (מוצר הושבת)</span>' : ''}</p>
      <div id="perr" class="err"></div><div class="row"><button class="btn grow" id="pb" type="button">${live ? 'פרסם שוב' : 'פרסם'}</button>${live ? '<button class="btn bad" id="pu" type="button">הורד מהאתר</button>' : ''}</div></div>`;
    const run = (publish) => async (ev) => {
      $('#perr').textContent = '';
      try {
        const r = await busy(ev.target, async () => { try { return await api.publishInspiration({ inspirationId: id, publish }); } catch (e) { e.__pub = true; throw e; } });
        if (r) { toast(publish ? (r.soldOut && r.soldOut.length ? `פורסם. ${r.soldOut.length} פריטים אזלו` : 'ההשראה פורסמה') : 'ההשראה ירדה מהאתר'); await reload(); drawPub(); }
      } catch (e) { /* busy כבר הציג */ }
    };
    $('#pb').onclick = async (ev) => {
      $('#perr').textContent = '';
      const btn = ev.target; btn.disabled = true;
      try { const r = await api.publishInspiration({ inspirationId: id, publish: true }); toast(r.soldOut && r.soldOut.length ? `פורסם. ${r.soldOut.length} פריטים אזלו` : 'ההשראה פורסמה'); await reload(); drawPub(); }
      catch (e) {
        const items = e.details && Array.isArray(e.details.items) ? e.details.items : [];
        $('#perr').textContent = items.length ? `אי אפשר לפרסם. לתקן:\n` + items.map((b) => `${b.index || ''}. ${b.name || b.productId || ''} – ${REASON[b.reason] || b.reason}`).join('\n') : e.message;
        btn.disabled = false;
      }
    };
    if ($('#pu')) $('#pu').onclick = async (ev) => { if (!(await confirmBox('להוריד את ההשראה מהאתר? היא תחזור לטיוטה.', 'הורד'))) return; const r = await busy(ev.target, () => api.publishInspiration({ inspirationId: id, publish: false }), 'ההשראה ירדה מהאתר'); if (r) { await reload(); drawPub(); } };
  };
  drawFrames(); drawHs(); drawPub();
}

// ---------- סוגי אירועים ----------
async function eventTypes(root, ctx) {
  if (!needMgr(root)) return;
  const list = (await api.listEventTypes()).sort((a, b) => (a.order || 0) - (b.order || 0));
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>סוגי אירועים <small class="note">(${list.length})</small></h2><button class="btn w" id="add" style="margin-bottom:10px">＋ סוג אירוע חדש</button>
    ${list.map((t) => `<div class="li" style="cursor:default" data-id="${esc(t.id)}"><div class="m"><b>${esc(t.name)}</b><small>סדר ${esc(t.order != null ? t.order : 0)}${t.seasonal ? ' · עונתי' : ''}</small></div><button class="btn s" data-ed>עריכה</button></div>`).join('') || '<p class="note">אין סוגי אירועים.</p>'}`;
  $('#bk').onclick = () => ctx.back();
  const ed = async (t) => {
    const r = await dialog(`<h3 style="margin-top:0">${t ? 'עריכת סוג אירוע' : 'סוג אירוע חדש'}</h3><label class="f"><span>שם</span><input id="en" maxlength="60" value="${esc(t ? t.name : '')}"></label>
      <label class="f"><span>סדר</span><input id="eo" inputmode="numeric" value="${esc(t && t.order != null ? t.order : (list.length + 1) * 10)}"></label><label class="ck"><input type="checkbox" id="es" ${t && t.seasonal ? 'checked' : ''}>עונתי</label>`,
      [['ok', 'שמור']], (m) => ({ name: m.querySelector('#en').value.trim(), order: m.querySelector('#eo').value.trim(), seasonal: m.querySelector('#es').checked }));
    if (!r) return;
    const d = r.data; const input = { name: d.name, order: /^\d+$/.test(d.order) ? Number(d.order) : d.order, seasonal: d.seasonal };
    if (t) input.eventTypeId = t.id;
    const ok = await busy(null, () => api.saveEventType(input), 'סוג האירוע נשמר');
    if (ok) ctx.refresh();
  };
  $('#add').onclick = () => ed(null);
  $$('[data-ed]').forEach((b) => { b.onclick = () => ed(list.find((t) => t.id === b.closest('[data-id]').dataset.id)); });
}

// ---------- כללי כמות ----------
async function quantityRules(root, ctx) {
  if (!needMgr(root)) return;
  const [rules] = await Promise.all([api.listQuantityRules(), loadProducts()]);
  const rtext = (r) => `${RULE_TYPES[r.ruleType] || r.ruleType}: ${r.amount}${r.safetyMarginPercent != null ? ' · מרווח ' + r.safetyMarginPercent + '%' : ' · מרווח לפי ברירת המחדל'}`;
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>כללי כמות <small class="note">(${rules.length})</small></h2>
    <p class="note">כמה יחידות מהמוצר נכנסות לשולחן. מוצר בלי כלל נכנס כחבילה אחת. חיפוש מוצר להוספה או לעריכה:</p>
    <input id="q" placeholder="חיפוש מוצר לפי שם או מק״ט" style="margin-bottom:10px"><div id="lst"></div>`;
  $('#bk').onclick = () => ctx.back();
  const ed = async (p, rule) => {
    const r = await dialog(`<h3 style="margin-top:0">${esc(p.name)}</h3><label class="f"><span>סוג כלל</span><select id="rt">${Object.entries(RULE_TYPES).map(([k, l]) => `<option value="${k}" ${rule && rule.ruleType === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f"><span>כמות</span><input id="ra" inputmode="decimal" value="${esc(rule ? rule.amount : '')}"></label><label class="f"><span>מרווח ביטחון באחוזים (ריק = ברירת המחדל)</span><input id="rm" inputmode="numeric" value="${esc(rule && rule.safetyMarginPercent != null ? rule.safetyMarginPercent : '')}"></label>`,
      [['ok', 'שמור']], (m) => ({ t: m.querySelector('#rt').value, a: m.querySelector('#ra').value.trim(), m: m.querySelector('#rm').value.trim() }));
    if (!r) return;
    const input = { productId: p.id, ruleType: r.data.t, amount: Number(r.data.a) };
    if (r.data.m !== '') input.safetyMarginPercent = Number(r.data.m);
    const ok = await busy(null, () => api.saveQuantityRule(input), 'הכלל נשמר');
    if (ok) ctx.refresh();
  };
  const draw = (t) => {
    const q = t.trim().toLowerCase();
    const rs = (id) => rules.find((x) => x.id === id);
    const shown = (PRODUCTS || []).filter((p) => (q ? String(p.name).toLowerCase().includes(q) || String(p.sku).toLowerCase().includes(q) : !!rs(p.id))).slice(0, 40);
    $('#lst').innerHTML = shown.map((p) => `<div class="li" style="cursor:default" data-id="${esc(p.id)}"><div class="m"><b>${esc(p.name)}</b><small>${rs(p.id) ? esc(rtext(rs(p.id))) : 'אין כלל (חבילה אחת)'}</small></div><button class="btn s" data-ed>${rs(p.id) ? 'עריכה' : 'הוסף כלל'}</button></div>`).join('') || `<p class="note">${q ? 'לא נמצא מוצר.' : 'אין עדיין כללים.'}</p>`;
    $$('#lst [data-ed]').forEach((b) => { b.onclick = () => { const id = b.closest('[data-id]').dataset.id; ed(pById(id), rs(id)); }; });
  };
  $('#q').oninput = (ev) => draw(ev.target.value);
  draw('');
}

export default { id: 'inspirations', title: 'השראות', roles: ['manager'], render };
