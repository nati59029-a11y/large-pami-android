/* מסך "השלמה להמחשה" (מנהל בלבד, שלב 3.8): פריטי השלמה (בקבוקי שתייה, לחמניות, סלטים) ובסיסי שולחן (צילום שולחן ריק ל-5 צורות × 3 זוויות).
   פריט השלמה הוא לא מוצר: אין לו מחיר, והוא לא נכנס לעגלה, להזמנה או לרשימת הליקוט. הוא רק מופיע בהמחשה באתר.
   כל כתיבה עוברת בפונקציות השרת saveStagingItem ו-saveTableBase (מנהל בלבד; השרת בודק שקיפות, רישיון, פינות ומידות).
   בחירת התמונה – בבורר הקבצים הרגיל של הטלפון, בלי הרשאה חדשה ובלי תוסף. הסרת רקע אוטומטית לא קיימת (מצב דמה): מעלים תמונה שכבר בלי רקע. */
import * as api from '../api.js';
import { esc, $, $$, toast, busy, imageToB64 } from '../ui.js';

const KIND = { drink_bottle: 'בקבוק שתייה', roll: 'לחמנייה', salad: 'סלט' };
const PLACE = { per_seat: 'לכל מקום', per_table: 'לכל שולחן', in_vessel: 'בתוך כלי' };
const VESSEL = { plate: 'צלחת', pickle_dish: 'לפתנית', oval: 'אובל', glass: 'כוס' };
const DEFAULTS = { drink_bottle: ['per_table', ['glass']], roll: ['in_vessel', ['plate']], salad: ['in_vessel', ['pickle_dish', 'oval']] };
const SHAPE = { rect: 'מלבני', round: 'עגול', het3: "ח'", t: 'T', l: 'L' };
const ANGLE = { side: 'מהצד', seat: 'מגובה האורח', top: 'מלמעלה' };
const CORNER = ['שמאל-עליון', 'ימין-עליון', 'ימין-תחתון', 'שמאל-תחתון'];
const needMgr = (root) => { if (api.isManager()) return true; root.innerHTML = '<div class="card"><p class="err">המסך הזה למנהל בלבד.</p></div>'; return false; };
const opt = (obj, sel) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');

// תמונה עם שקיפות: קובץ PNG או WebP עד 3MB נשלח כמו שהוא; גדול יותר מוקטן ל-PNG (שומר שקיפות). JPG לא נשמר עם שקיפות, והשרת ידחה אותו בהודעה.
async function fileToB64KeepAlpha(file) {
  const b64 = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => no(new Error('הקובץ אינו תמונה שאפשר לקרוא')); r.readAsDataURL(blob); });
  if (/^image\/(png|webp)$/.test(file.type) && file.size <= 3 * 1024 * 1024) return b64(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('הקובץ אינו תמונה שאפשר לקרוא')); i.src = url; });
    const k = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png').split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}

async function render(root, ctx) {
  if (!needMgr(root)) return;
  const [items, shapes] = await Promise.all([api.listStagingItems(), api.listTableShapes().catch(() => ({ shapes: {} }))]);
  const have = (shapes && shapes.shapes) || {};
  items.sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  root.innerHTML = `<h2>השלמה להמחשה</h2>
    <p class="note">פריטים שמופיעים בהמחשת השולחן באתר (שתייה, לחמניות, סלטים). הם לא מוצרים: אין להם מחיר והם לא נכנסים להזמנה.</p>
    <button class="btn w" id="add" style="margin-bottom:10px">＋ פריט השלמה חדש</button>
    <div id="il">${items.map((x) => `<button class="li" data-id="${esc(x.id)}">${x.imagePath ? `<img class="thumb" alt="" src="${esc(api.publicImageUrl(x.imagePath))}">` : '<span class="thumb"></span>'}
      <div class="m"><b>${esc(x.name || x.id)}</b><small>${esc(KIND[x.kind] || '')} · ${esc(PLACE[x.placement] || '')}</small></div>
      <div>${x.active === false ? '<span class="tag">כבוי</span>' : '<span class="tag ok">פעיל</span>'}${x.source === 'licensed' ? ' <span class="tag gold">ברישיון</span>' : ''}${x.isDemo ? ' <span class="tag">דמו</span>' : ''}</div></button>`).join('') || '<p class="note">אין פריטי השלמה.</p>'}</div>
    <h3>בסיסי שולחן</h3>
    <p class="note">צילום של שולחן ריק, לכל צורה ולכל זווית. "יש" = קיים בסיס פעיל. לחצו כדי להעלות או להחליף.</p>
    ${Object.entries(SHAPE).map(([s, sl]) => `<div class="card" style="padding:10px"><b>${esc(sl)}</b><div class="row" style="margin-top:6px">${Object.entries(ANGLE).map(([a, al]) => `<button class="btn ${(have[s] || []).includes(a) ? '' : 'g'} s grow" data-s="${s}" data-a="${a}">${esc(al)}: ${(have[s] || []).includes(a) ? 'יש' : 'אין'}</button>`).join('')}</div></div>`).join('')}`;
  $('#add').onclick = () => ctx.open((r) => editItem(r, ctx, null));
  $$('#il [data-id]').forEach((b) => { b.onclick = () => ctx.open((r) => editItem(r, ctx, items.find((x) => x.id === b.dataset.id))); });
  $$('[data-s]').forEach((b) => { b.onclick = () => ctx.open((r) => editBase(r, ctx, b.dataset.s, b.dataset.a, (have[b.dataset.s] || []).includes(b.dataset.a))); });
}

async function editItem(root, ctx, x) {
  if (!needMgr(root)) return;
  const n = x || { kind: 'roll', placement: 'in_vessel', fitsVessels: ['plate'], source: 'own_photo', active: true, matchColors: [] };
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${x ? 'עריכת פריט' : 'פריט השלמה חדש'}</h2>
    <form id="f" class="card" onsubmit="return false">
    <label class="f"><span>שם הפריט</span><input name="name" maxlength="120" value="${esc(n.name || '')}" required></label>
    <div class="grid2"><label class="f"><span>סוג</span><select name="kind">${opt(KIND, n.kind)}</select></label>
    <label class="f"><span>איך מסדרים</span><select name="placement">${opt(PLACE, n.placement)}</select></label></div>
    <div class="f"><span>על אילו כלים הוא מונח</span>${Object.entries(VESSEL).map(([k, l]) => `<label class="ck"><input type="checkbox" name="vs" value="${k}" ${(n.fitsVessels || []).includes(k) ? 'checked' : ''}>${l}</label>`).join('')}</div>
    <label class="f"><span>צבעים שהוא מתאים להם (קודים כמו #C9A227, מופרדים ברווח; ריק = מתאים לכולם)</span><input name="colors" dir="ltr" value="${esc((n.matchColors || []).join(' '))}"></label>
    <label class="f"><span>מקור התמונה</span><select name="source"><option value="own_photo" ${n.source !== 'licensed' ? 'selected' : ''}>צילום שלנו</option><option value="licensed" ${n.source === 'licensed' ? 'selected' : ''}>ברישיון</option></select></label>
    <label class="f" id="lw"><span>פרטי הרישיון (מאיפה התמונה, באיזה רישיון; חובה כשהתמונה ברישיון)</span><textarea name="note" rows="2" maxlength="500">${esc(n.licenseNote || '')}</textarea></label>
    <label class="f"><span>תמונה עם רקע שקוף (PNG או WebP)${x ? ' – ריק = משאירים את הקיימת' : ''}</span><input type="file" name="img" accept="image/png,image/webp,image/*"></label>
    <div id="pv" style="background:repeating-conic-gradient(#333 0 25%,#444 0 50%) 0 0/16px 16px;border-radius:12px;min-height:40px;text-align:center" ${x && x.imagePath ? '' : 'hidden'}>${x && x.imagePath ? `<img alt="התמונה הקיימת" style="max-width:100%;max-height:160px" src="${esc(api.publicImageUrl(x.imagePath))}">` : ''}</div>
    <p class="note">הסרת רקע אוטומטית עוד לא קיימת. תמונה בלי שקיפות תידחה.</p>
    <label class="ck"><input type="checkbox" name="active" ${n.active !== false ? 'checked' : ''}>הפריט פעיל</label>
    </form><button class="btn w" id="save">${x ? 'שמור שינויים' : 'הוסף פריט'}</button>`;
  $('#bk').onclick = () => ctx.back();
  const f = $('#f');
  const lic = () => { $('#lw').hidden = f.source.value !== 'licensed'; };
  f.source.onchange = lic; lic();
  f.kind.onchange = () => { // ברירות מחדל לפי סוג – רק בפריט חדש
    if (x) return; const d = DEFAULTS[f.kind.value]; f.placement.value = d[0]; $$('input[name=vs]', f).forEach((c) => { c.checked = d[1].includes(c.value); });
  };
  f.img.onchange = () => {
    const file = f.img.files[0]; if (!file) return;
    const u = URL.createObjectURL(file); $('#pv').hidden = false; $('#pv').innerHTML = `<img alt="התמונה שנבחרה" style="max-width:100%;max-height:160px" src="${u}">`;
  };
  $('#save').onclick = async (ev) => {
    const name = f.name.value.trim();
    if (!name) { toast('כתבו שם לפריט', true); return; }
    const colors = f.colors.value.split(/[\s,]+/).filter(Boolean);
    if (colors.some((c) => !/^#[0-9a-fA-F]{6}$/.test(c))) { toast('קוד צבע צריך להיות בצורה #RRGGBB', true); return; }
    const src = f.source.value; const note = f.note.value.trim();
    if (src === 'licensed' && note.length < 3) { toast('תמונה ברישיון: כתבו את פרטי הרישיון (מאיפה התמונה, באיזה רישיון)', true); return; }
    const file = f.img.files[0];
    if (!x && !file) { toast('פריט חדש: בחרו תמונה עם רקע שקוף', true); return; }
    const vs = $$('input[name=vs]:checked', f).map((c) => c.value);
    const item = { kind: f.kind.value, name, matchColors: colors, fitsVessels: vs, placement: f.placement.value, source: src, licenseNote: src === 'licensed' ? note : '', active: f.active.checked };
    const r = await busy(ev.target, async () => {
      const input = Object.assign({ item }, x ? { stagingId: x.id } : {});
      if (file) input.image = { data: await fileToB64KeepAlpha(file) };
      return api.saveStagingItem(input);
    }, 'נשמר');
    if (r) ctx.back();
  };
}

async function editBase(root, ctx, shape, angle, exists) {
  if (!needMgr(root)) return;
  const pts = [];
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>בסיס שולחן: ${esc(SHAPE[shape])}, ${esc(ANGLE[angle])}</h2>
    <p class="note">${exists ? 'כבר יש בסיס. כל מה שתשאירו ריק נשאר כמו שהיה.' : 'בסיס חדש: חובה צילום, מידות וארבע פינות.'}</p>
    <form id="f" class="card" onsubmit="return false">
    <label class="f"><span>צילום של השולחן הריק</span><input type="file" name="img" accept="image/*"></label>
    <div id="ph" hidden><p class="note" id="hint"></p>
      <div id="stage" style="position:relative;direction:ltr;line-height:0"><img id="bimg" alt="צילום השולחן הריק" style="width:100%;border-radius:12px;border:1px solid var(--line)"><span id="pins"></span></div>
      <button class="btn g s" id="rst" type="button" style="margin-top:6px">נקה פינות</button></div>
    <div class="grid2"><label class="f"><span>רוחב השולחן (ס"מ)</span><input name="w" inputmode="decimal" dir="ltr"></label>
    <label class="f"><span>עומק השולחן (ס"מ)</span><input name="d" inputmode="decimal" dir="ltr"></label></div>
    <label class="ck"><input type="checkbox" name="active" checked>הבסיס פעיל</label>
    </form><button class="btn w" id="save">שמור</button>`;
  $('#bk').onclick = () => ctx.back();
  const f = $('#f');
  const draw = () => {
    $('#pins').innerHTML = pts.map((p, i) => `<span class="hs" style="left:${p.x * 100}%;top:${p.y * 100}%">${i + 1}</span>`).join('');
    $('#hint').textContent = pts.length < 4 ? `לחצו על הצילום בפינה ${pts.length + 1} מתוך 4: ${CORNER[pts.length]} של משטח השולחן.` : 'סומנו 4 פינות.';
  };
  f.img.onchange = () => {
    const file = f.img.files[0]; pts.length = 0; if (!file) { $('#ph').hidden = true; return; }
    $('#bimg').src = URL.createObjectURL(file); $('#ph').hidden = false; draw();
  };
  $('#bimg').onclick = (ev) => {
    if (pts.length >= 4) return;
    const b = ev.target.getBoundingClientRect();
    pts.push({ x: Math.round(Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)) * 10000) / 10000, y: Math.round(Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height)) * 10000) / 10000 }); draw();
  };
  $('#rst').onclick = () => { pts.length = 0; draw(); };
  $('#save').onclick = async (ev) => {
    const file = f.img.files[0]; const w = f.w.value.trim().replace(',', '.'); const d = f.d.value.trim().replace(',', '.');
    const base = { active: f.active.checked };
    if (w) { if (!Number.isFinite(Number(w))) { toast('הרוחב צריך להיות מספר', true); return; } base.widthCm = Number(w); }
    if (d) { if (!Number.isFinite(Number(d))) { toast('העומק צריך להיות מספר', true); return; } base.depthCm = Number(d); }
    if (pts.length) { if (pts.length !== 4) { toast('סמנו בדיוק 4 פינות (או נקו והשאירו ריק)', true); return; } base.corners = pts.map((p) => ({ x: p.x, y: p.y })); }
    if (!exists) {
      if (!file) { toast('בסיס חדש: בחרו צילום של השולחן הריק', true); return; }
      if (!w || !d || pts.length !== 4) { toast('בסיס חדש: חובה רוחב, עומק וארבע פינות', true); return; }
    }
    if (file && !pts.length && exists) { /* החלפת צילום בלי פינות חדשות: הפינות הקודמות נשמרות, אבל כדאי לסמן מחדש אם המצלמה זזה */ }
    const r = await busy(ev.target, async () => {
      const input = { shape, angle, base };
      if (file) input.image = { data: await imageToB64(file, 1600) };
      return api.saveTableBase(input);
    }, 'נשמר');
    if (r) ctx.back();
  };
}

export default { id: 'staging', title: 'השלמה להמחשה', roles: ['manager'], render };
