/* מסך "הגדרות האתר" (מנהל, בסיס – תוספת 6): באנרים וטקסטים בעמוד הבית, פרטי החנות, שעות, טלפון, וואטסאפ,
   אזורי משלוח ומחירים, וכיתובים. וגם אחוז המע"מ (settings/private.invoices.vatRate), שלפיו מוצג מחיר העלות עם מע"מ.
   כל שמירה עוברת דרך updateSiteSettings: השרת בודק כל ערך ורושם ביומן. נשלחים רק השדות שהשתנו. */
import * as api from '../api.js';
import { esc, $, $$, toast, busy, imageToB64, numOrText } from '../ui.js';

const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const SIMPLE = [
  ['store.address', 'כתובת החנות', 'text'], ['support.phone', 'טלפון', 'tel'], ['support.whatsapp', 'וואטסאפ', 'tel'],
  ['support.email', 'מייל לשירות', 'email'], ['support.hours', 'שעות פעילות (טקסט חופשי)', 'area'],
];
const HOURS = [['sunThu', 'ראשון עד חמישי'], ['friWinter', 'שישי (חורף)'], ['friSummer', 'שישי (קיץ)']];
const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

async function render(root, ctx) {
  const [pub0, priv0] = await Promise.all([api.getSettings('public'), api.getSettings('private')]);
  const pub = pub0 || {}; const priv = priv0 || {};
  const S = { zones: JSON.parse(JSON.stringify(get(pub, 'shipping.zones') || [])), banners: JSON.parse(JSON.stringify(get(pub, 'home.banners') || [])) };
  const kv = (name, obj) => Object.entries(obj || {}).map(([k, v]) => kvRow(name, k, v)).join('');
  root.innerHTML = `<h2>הגדרות האתר</h2>
    <p class="note">מצב האתר: <span class="tag gold">${pub.siteMode === 'live' ? 'פעיל' : 'דמו'}</span>. כל שינוי נרשם ביומן.</p>
    <form id="sf" onsubmit="return false">
    <div class="card"><h3 style="margin-top:0">פרטי החנות</h3>${SIMPLE.map(([p, l, t]) => t === 'area' ? `<label class="f"><span>${l}</span><textarea name="${p}">${esc(get(pub, p) || '')}</textarea></label>` : `<label class="f"><span>${l}</span><input name="${p}" type="${t}" value="${esc(get(pub, p) || '')}" ${t !== 'text' ? 'dir="ltr"' : ''}></label>`).join('')}
    <h3>שעות איסוף</h3>${HOURS.map(([k, l]) => `<div class="grid2"><label class="f"><span>${l} – פתיחה</span><input type="time" name="pickup.hours.${k}.open" value="${esc(get(pub, `pickup.hours.${k}.open`) || '')}"></label><label class="f"><span>${l} – סגירה</span><input type="time" name="pickup.hours.${k}.close" value="${esc(get(pub, `pickup.hours.${k}.close`) || '')}"></label></div>`).join('')}</div>
    <div class="card"><h3 style="margin-top:0">אזורי משלוח ומחירים</h3><div id="zones"></div><button type="button" class="btn g w" id="addz">＋ אזור</button></div>
    <div class="card"><h3 style="margin-top:0">באנרים בעמוד הבית</h3><div id="banners"></div>
      <label class="btn g w" style="display:flex;align-items:center;justify-content:center;cursor:pointer">＋ העלאת באנר<input type="file" id="bfile" accept="image/jpeg,image/png,image/webp" hidden></label></div>
    <div class="card"><h3 style="margin-top:0">טקסטים בעמוד הבית</h3><p class="note">לכל טקסט יש שם קבוע באנגלית (למשל heroTitle), שלפיו האתר יודע איפה להציג אותו.</p><div data-kv="home.texts">${kv('home.texts', get(pub, 'home.texts'))}</div><button type="button" class="btn g s" data-addkv="home.texts">＋ טקסט</button></div>
    <div class="card"><h3 style="margin-top:0">כיתובים שיווקיים</h3><div data-kv="copy">${kv('copy', pub.copy)}</div><button type="button" class="btn g s" data-addkv="copy">＋ כיתוב</button></div>
    <div class="card cost"><h3 style="margin-top:0">מע"מ</h3><label class="f"><span>אחוז מע"מ (לתצוגת מחיר העלות עם מע"מ)</span><input name="vat" inputmode="decimal" dir="ltr" value="${esc(get(priv, 'invoices.vatRate') != null ? get(priv, 'invoices.vatRate') : '')}"></label></div>
    </form><button class="btn w" id="save">שמור הגדרות</button><p class="err" id="serr" role="alert"></p>`;

  const drawZones = () => {
    $('#zones').innerHTML = S.zones.map((z, i) => `<div class="card" style="background:var(--card2)" data-z="${i}">
      <div class="grid2"><label class="f"><span>שם האזור</span><input data-k="name" value="${esc(z.name || '')}"></label><label class="f"><span>מזהה (אנגלית קטנה)</span><input data-k="id" dir="ltr" value="${esc(z.id || '')}"></label>
      <label class="f"><span>דמי משלוח (₪)</span><input data-k="fee" inputmode="decimal" dir="ltr" value="${esc(z.fee != null ? z.fee : '')}"></label><label class="f"><span>משלוח חינם מסכום (₪)</span><input data-k="freeFrom" inputmode="decimal" dir="ltr" value="${esc(z.freeFrom != null ? z.freeFrom : '')}"></label></div>
      <label class="ck"><input type="checkbox" data-k="manualFee" ${z.manualFee ? 'checked' : ''}>העובד קובע את דמי המשלוח</label><label class="ck"><input type="checkbox" data-k="pickupOnly" ${z.pickupOnly ? 'checked' : ''}>איסוף בלבד</label>
      <button type="button" class="btn bad s" data-rmz>הסר אזור</button></div>`).join('') || '<p class="note">אין אזורים.</p>';
    $$('#zones [data-rmz]').forEach((b) => { b.onclick = () => { readZones(); S.zones.splice(Number(b.closest('[data-z]').dataset.z), 1); drawZones(); }; });
  };
  const readZones = () => {
    $$('#zones [data-z]').forEach((c) => {
      const z = S.zones[Number(c.dataset.z)];
      c.querySelectorAll('[data-k]').forEach((e) => { const k = e.dataset.k; z[k] = e.type === 'checkbox' ? e.checked : (k === 'fee' || k === 'freeFrom' ? numOrText(e.value.trim()) : e.value.trim()); });
    });
  };
  const drawBanners = () => {
    $('#banners').innerHTML = S.banners.map((b, i) => `<div class="card" style="background:var(--card2)" data-b="${i}"><div class="row"><img class="thumb" style="width:120px" alt="" src="${esc(api.publicImageUrl(b.imagePath))}"><div class="grow">
      <label class="f"><span>כותרת</span><input data-k="title" value="${esc(b.title || '')}"></label><label class="f"><span>קישור (מתחיל ב-/ או https://)</span><input data-k="link" dir="ltr" value="${esc(b.link || '')}"></label></div></div>
      <div class="row"><label class="ck grow"><input type="checkbox" data-k="active" ${b.active !== false ? 'checked' : ''}>מוצג</label><button type="button" class="btn g s" data-bup ${i === 0 ? 'disabled' : ''}>▲</button><button type="button" class="btn g s" data-bdn ${i === S.banners.length - 1 ? 'disabled' : ''}>▼</button><button type="button" class="btn bad s" data-brm>הסר</button></div></div>`).join('') || '<p class="note">אין באנרים.</p>';
    const idx = (b) => Number(b.closest('[data-b]').dataset.b);
    $$('#banners [data-brm]').forEach((b) => { b.onclick = () => { readBanners(); S.banners.splice(idx(b), 1); drawBanners(); }; });
    $$('#banners [data-bup],#banners [data-bdn]').forEach((b) => { b.onclick = () => { readBanners(); const i = idx(b); const j = i + (b.hasAttribute('data-bup') ? -1 : 1); [S.banners[i], S.banners[j]] = [S.banners[j], S.banners[i]]; drawBanners(); }; });
  };
  const readBanners = () => {
    $$('#banners [data-b]').forEach((c) => { const b = S.banners[Number(c.dataset.b)]; c.querySelectorAll('[data-k]').forEach((e) => { b[e.dataset.k] = e.type === 'checkbox' ? e.checked : (e.value.trim() || null); }); });
    S.banners.forEach((b, i) => { b.order = i + 1; });
  };
  drawZones(); drawBanners();
  $('#addz').onclick = () => { readZones(); S.zones.push({ id: '', name: '', fee: null, freeFrom: null, manualFee: false, pickupOnly: false }); drawZones(); };
  $$('[data-addkv]').forEach((b) => { b.onclick = () => { $(`[data-kv="${b.dataset.addkv}"]`).insertAdjacentHTML('beforeend', kvRow(b.dataset.addkv, '', '')); bindKv(); }; });
  const bindKv = () => $$('[data-rmkv]').forEach((b) => { b.onclick = () => b.closest('[data-kvrow]').remove(); });
  bindKv();
  $('#bfile').onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    readBanners();
    const r = await busy(null, async () => api.updateSiteSettings('public', null, await imageToB64(f, 2400)), 'הבאנר הועלה. לחץ "שמור הגדרות" כדי שיוצג');
    if (r && r.bannerPath) { S.banners.push({ imagePath: r.bannerPath, title: null, link: null, active: true, order: S.banners.length + 1 }); drawBanners(); }
  };
  const readKv = (name) => {
    const o = {}; $$(`[data-kv="${name}"] [data-kvrow]`).forEach((r) => { const k = r.querySelector('[data-kk]').value.trim(); const v = r.querySelector('[data-kvv]').value; if (k || v.trim()) o[k] = v; });
    return o;
  };
  $('#save').onclick = async (ev) => {
    readZones(); readBanners();
    const f = $('#sf'); const values = {};
    const put = (path, v, old) => { if (!same(v, old)) values[path] = v; };
    for (const [p] of SIMPLE) put(p, f.elements[p].value.trim() || null, get(pub, p));
    for (const [k] of HOURS) for (const e of ['open', 'close']) { const p = `pickup.hours.${k}.${e}`; const v = f.elements[p].value; if (v || get(pub, p) != null) put(p, v || null, get(pub, p)); }
    const zones = S.zones.map((z) => ({ id: z.id, name: z.name, fee: z.fee, freeFrom: z.freeFrom, manualFee: !!z.manualFee, pickupOnly: !!z.pickupOnly }));
    if (zones.length || get(pub, 'shipping.zones')) put('shipping.zones', zones, get(pub, 'shipping.zones'));
    const banners = S.banners.map((b) => ({ imagePath: b.imagePath, title: b.title || null, link: b.link || null, active: b.active !== false, order: b.order }));
    put('home.banners', banners, get(pub, 'home.banners') || []);
    const texts = readKv('home.texts'); put('home.texts', texts, get(pub, 'home.texts') || {});
    const copy = readKv('copy'); put('copy', copy, pub.copy || {});
    const vatIn = f.vat.value.trim(); const vatOld = get(priv, 'invoices.vatRate');
    const vatChanged = vatIn !== '' && !same(numOrText(vatIn), vatOld);
    if (!Object.keys(values).length && !vatChanged) { toast('אין שינויים לשמירה'); return; }
    $('#serr').textContent = '';
    const r = await busy(ev.target, async () => {
      let n = 0;
      if (Object.keys(values).length) n += (await api.updateSiteSettings('public', values)).changed;
      if (vatChanged) n += (await api.updateSiteSettings('private', { 'invoices.vatRate': numOrText(vatIn) })).changed;
      return n;
    }, (n) => `ההגדרות נשמרו (${n} שינויים)`);
    if (r !== undefined) ctx.refresh();
  };
}
function kvRow(name, k, v) {
  return `<div class="card" style="background:var(--card2)" data-kvrow><label class="f"><span>שם</span><input data-kk dir="ltr" value="${esc(k)}" placeholder="למשל heroTitle"></label>
    <label class="f"><span>הטקסט</span><textarea data-kvv>${esc(v)}</textarea></label><button type="button" class="btn bad s" data-rmkv>הסר</button></div>`;
}

export default { id: 'settings', title: 'הגדרות האתר', roles: ['manager'], render };
