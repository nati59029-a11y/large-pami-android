/* מסך "תמונות": העלאת הרבה צילומים בבת אחת (עובד ומנהל), ושיוך של כל תמונה מעובדת למוצר ולצבע (רק מנהל).
   כשהשם של הקובץ לפי המק"ט (מק"ט_קוד-צבע_זווית_מספר.jpg) השרת מציע שיוך, והמנהל רק מאשר (תוספת 3).
   בחירת הקבצים נעשית בבורר הקבצים הרגיל של הטלפון – בלי הרשאה חדשה ובלי תוסף חדש. */
import * as api from '../api.js';
import { esc, $, $$, toast, busy, confirmBox } from '../ui.js';

const ST = { ready_for_review: ['ממתין לשיוך', 'gold'], approved: ['שויך', 'ok'], rejected: ['נדחה', 'bad'], processing: ['בעיבוד', ''] };
let PRODUCTS = null;

async function render(root, ctx) {
  const mgr = api.isManager();
  PRODUCTS = null; // רשימה עדכנית בכל כניסה למסך
  root.innerHTML = `<h2>תמונות מוצרים</h2>
    <div class="card"><h3 style="margin-top:0">העלאה בכמות</h3>
    <p class="note">בוחרים כמה צילומים בבת אחת. כל צילום נשמר כמו שהוא (המקור לא נמחק), ומוקטן ל-3 גדלים. הסרת רקע – במצב דמה בשלב הזה.</p>
    <label class="btn w" style="display:flex;align-items:center;justify-content:center;cursor:pointer">בחירת צילומים<input type="file" id="pick" accept="image/jpeg,image/png,image/webp" multiple hidden></label>
    <div id="up"></div></div>
    <h3>${mgr ? 'תמונות שממתינות לשיוך' : 'הצילומים שהעליתי'}</h3><div id="jobs"><p class="note">טוען…</p></div>`;
  $('#pick').onchange = (ev) => { const files = [...ev.target.files]; ev.target.value = ''; if (files.length) upload(files, ctx); };
  await drawJobs(ctx);
}

async function upload(files, ctx) {
  const up = $('#up');
  const res = { ok: 0, bad: [], suggested: 0 };
  up.innerHTML = `<div class="prog"><i id="pg" style="width:0"></i></div><p class="note" id="pt">0 מתוך ${files.length}</p><div id="perr" class="err"></div>`;
  let done = 0;
  const one = async (f, i) => {
    try {
      const path = await api.uploadRawPhoto(f, i);
      const r = await api.processProductPhoto(path, f.name);
      res.ok++; if (r.suggestedProductId) res.suggested++;
    } catch (e) { res.bad.push(`${f.name}: ${e.message}`); }
    done++;
    if ($('#pg')) { $('#pg').style.width = Math.round(done / files.length * 100) + '%'; $('#pt').textContent = `${done} מתוך ${files.length}`; $('#perr').textContent = res.bad.join('\n'); }
  };
  // 3 במקביל – מהיר יותר, בלי להעמיס על הטלפון
  let next = 0;
  await Promise.all([0, 1, 2].map(async () => { while (next < files.length) { const i = next++; await one(files[i], i); } }));
  window.__lpUpload = res;
  if ($('#pt')) $('#pt').textContent = `הועלו ${res.ok} מתוך ${files.length}. ${res.suggested} עם הצעת שיוך לפי המק"ט.`;
  toast(res.bad.length ? `הועלו ${res.ok}, נכשלו ${res.bad.length}` : `הועלו ${res.ok} צילומים`, !!res.bad.length);
  await drawJobs(ctx);
}

const pName = (id) => { const p = (PRODUCTS || []).find((x) => x.id === id); return p ? `${p.name} (${p.sku})` : ''; };
function productOptions(filter, selected) {
  const t = filter.trim().toLowerCase();
  let list = (PRODUCTS || []).filter((p) => !t || String(p.name).toLowerCase().includes(t) || String(p.sku).toLowerCase().includes(t)).slice(0, 60);
  if (selected && !list.some((p) => p.id === selected)) { const s = PRODUCTS.find((p) => p.id === selected); if (s) list = [s].concat(list); }
  return '<option value="">בחר מוצר</option>' + list.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${esc(p.sku)}</option>`).join('');
}

async function drawJobs(ctx) {
  const mgr = api.isManager();
  const box = $('#jobs'); if (!box) return;
  const [jobs] = await Promise.all([api.listPhotoJobs(), mgr && !PRODUCTS ? api.listProducts().then((p) => { PRODUCTS = p; }) : null]);
  const list = (mgr ? jobs.filter((j) => j.status === 'ready_for_review') : jobs).sort((a, b) => String(a.fileName).localeCompare(String(b.fileName)));
  if (!list.length) { box.innerHTML = `<p class="note">${mgr ? 'אין תמונות שממתינות לשיוך.' : 'עוד לא העלית צילומים.'}</p>`; return; }
  box.innerHTML = list.slice(0, 100).map((j) => `<div class="card" data-job="${esc(j.id)}">
    <div class="row"><img class="thumb" alt="" data-src="${esc((j.processedPaths || []).find((p) => /small\.webp$/.test(p)) || '')}"><div class="grow"><b dir="ltr" style="display:block;text-align:right">${esc(j.fileName || '')}</b>
    <span class="tag ${ST[j.status] ? ST[j.status][1] : ''}">${esc(ST[j.status] ? ST[j.status][0] : j.status)}</span>
    ${j.suggestedProductId ? ' <span class="tag gold">הוצע לפי המק"ט</span>' : ' <span class="tag">לא משויך</span>'}</div></div>
    ${mgr ? `<label class="f" style="margin-top:8px"><span>מוצר</span><input data-q placeholder="חיפוש מוצר לפי שם או מק״ט"><select data-p>${productOptions('', j.suggestedProductId)}</select></label>
    <div class="grid2"><label class="f"><span>צבע</span><select data-v><option value="">בחר מוצר קודם</option></select></label>
    <label class="f"><span>זווית</span><select data-a><option value="">לפי שם הקובץ (או מקדימה)</option>${api.ANGLES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label></div>
    <label class="ck"><input type="checkbox" data-main>תמונה ראשית של הצבע</label>
    <div class="row"><button class="btn grow" data-ok>אשר שיוך</button><button class="btn bad" data-no>דחה</button></div>` : ''}
  </div>`).join('') + (list.length > 100 ? `<p class="note">מוצגות 100 מתוך ${list.length}.</p>` : '');
  // תמונות פנימיות נטענות עם הזיהוי של המשתמש
  $$('#jobs img[data-src]').forEach((img) => { if (img.dataset.src) api.privateImageUrl(img.dataset.src).then((u) => { img.src = u; }).catch(() => { img.alt = 'לא נטענה'; }); });
  if (!mgr) return;
  $$('#jobs [data-job]').forEach(async (card) => {
    const j = list.find((x) => x.id === card.dataset.job);
    const sel = card.querySelector('[data-p]'); const vs = card.querySelector('[data-v]');
    const loadV = async (pre) => {
      vs.innerHTML = '<option value="">טוען…</option>';
      if (!sel.value) { vs.innerHTML = '<option value="">בחר מוצר קודם</option>'; return; }
      try {
        const v = await api.listVariants(sel.value);
        vs.innerHTML = v.length ? v.map((x) => `<option value="${esc(x.id)}" ${x.id === pre ? 'selected' : ''}>${esc(x.colorName)}</option>`).join('') : '<option value="">למוצר אין צבעים – הוסף צבע במסך המוצר</option>';
      } catch (e) { vs.innerHTML = `<option value="">${esc(e.message)}</option>`; }
    };
    card.querySelector('[data-q]').oninput = (ev) => { const cur = sel.value; sel.innerHTML = productOptions(ev.target.value, cur); };
    sel.onchange = () => loadV(null);
    if (sel.value) loadV(j.suggestedVariantId);
    card.querySelector('[data-ok]').onclick = async (ev) => {
      if (!sel.value || !vs.value) { toast('בחר מוצר וצבע', true); return; }
      const input = { jobId: j.id, decision: 'approve', productId: sel.value, variantId: vs.value };
      const a = card.querySelector('[data-a]').value; if (a) input.angle = a;
      if (card.querySelector('[data-main]').checked) input.isMain = true;
      const r = await busy(ev.target, () => api.assignProductPhoto(input), `שויך ל: ${pName(sel.value)}`);
      if (r) card.remove();
    };
    card.querySelector('[data-no]').onclick = async (ev) => {
      if (!(await confirmBox('לדחות את התמונה? הצילום המקורי נשמר, אבל התמונה לא תשויך.', 'דחה'))) return;
      const r = await busy(ev.target, () => api.assignProductPhoto({ jobId: j.id, decision: 'reject' }), 'התמונה נדחתה');
      if (r) card.remove();
    };
  });
}

export default { id: 'photos', title: 'תמונות', roles: ['manager', 'employee'], render };
