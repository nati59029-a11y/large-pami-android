/* מסך "קטגוריות" (מנהל): הוספה, שינוי שם, שינוי סדר, קטגוריית אב, פעילה / לא, מוצרי אפייה, ותמונה. */
import * as api from '../api.js';
import { esc, $, $$, toast, busy, imageToB64 } from '../ui.js';

async function render(root, ctx) {
  const cats = (await api.listCategories()).sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name), 'he'));
  root.innerHTML = `<h2>קטגוריות <small class="note">(${cats.length})</small></h2>
    <button class="btn w" id="add" style="margin-bottom:10px">＋ קטגוריה חדשה</button>
    <div id="lst">${cats.map((c, i) => `<div class="li" style="cursor:default" data-id="${esc(c.id)}">
      ${c.imagePath ? `<img class="thumb" alt="" loading="lazy" src="${esc(api.publicImageUrl(c.imagePath))}">` : '<span class="thumb"></span>'}
      <div class="m"><b>${esc(c.name)}</b><small>סדר ${esc(c.order != null ? c.order : 0)}${c.parentId ? ' · בתוך: ' + esc((cats.find((x) => x.id === c.parentId) || {}).name || c.parentId) : ''}</small>
      <div>${c.active === false ? '<span class="tag">לא פעילה</span>' : '<span class="tag ok">פעילה</span>'} ${c.isBakingProduct ? '<span class="tag gold">אפייה</span>' : ''} ${c.isDemo ? '<span class="tag gold">דמו</span>' : ''}</div></div>
      <div style="display:flex;flex-direction:column;gap:4px"><button class="btn g s" data-up ${i === 0 ? 'disabled' : ''} aria-label="למעלה">▲</button><button class="btn g s" data-dn ${i === cats.length - 1 ? 'disabled' : ''} aria-label="למטה">▼</button></div>
      <button class="btn s" data-ed>עריכה</button></div>`).join('') || '<p class="note">אין קטגוריות.</p>'}</div>`;
  $('#add').onclick = () => ctx.open((r) => edit(r, ctx, null, cats));
  $$('#lst [data-ed]').forEach((b) => { b.onclick = () => ctx.open((r) => edit(r, ctx, cats.find((c) => c.id === b.closest('[data-id]').dataset.id), cats)); });
  // שינוי סדר: מחליפים את המספרים של שתי קטגוריות סמוכות. אם המספרים שווים – ממספרים מחדש 10, 20, 30…
  const move = async (b, dir) => {
    const i = cats.findIndex((c) => c.id === b.closest('[data-id]').dataset.id); const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    const order = cats.map((c, k) => (c.order != null ? c.order : 0));
    const distinct = new Set(order).size === order.length;
    const next = distinct ? order.slice() : cats.map((c, k) => (k + 1) * 10);
    [next[i], next[j]] = [next[j], next[i]];
    const ok = await busy(b, async () => { for (let k = 0; k < cats.length; k++) if (next[k] !== order[k]) await api.saveCategory(cats[k].id, { order: next[k] }); return true; }, 'הסדר עודכן');
    if (ok) ctx.refresh();
  };
  $$('#lst [data-up]').forEach((b) => { b.onclick = () => move(b, -1); });
  $$('#lst [data-dn]').forEach((b) => { b.onclick = () => move(b, 1); });
}

async function edit(root, ctx, c, cats) {
  const n = c || { active: true, isBakingProduct: false, order: ((cats[cats.length - 1] || {}).order || 0) + 10 };
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${c ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}</h2>
    <form id="cf" class="card">
    <label class="f"><span>שם</span><input name="name" value="${esc(n.name || '')}" required></label>
    <label class="f"><span>קטגוריית אב (לא חובה)</span><select name="parentId"><option value="">ללא</option>${cats.filter((x) => !c || x.id !== c.id).map((x) => `<option value="${esc(x.id)}" ${x.id === n.parentId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="f"><span>סדר</span><input name="order" inputmode="numeric" value="${esc(n.order != null ? n.order : 0)}"></label>
    <label class="ck"><input type="checkbox" name="active" ${n.active !== false ? 'checked' : ''}>פעילה (מוצגת באתר)</label>
    <label class="ck"><input type="checkbox" name="isBakingProduct" ${n.isBakingProduct ? 'checked' : ''}>מוצרי אפייה (מוצר חדש בקטגוריה יחייב כשרות)</label>
    <label class="f"><span>תמונה (לא חובה)</span><input type="file" name="img" accept="image/jpeg,image/png,image/webp"></label>
    ${n.imagePath ? `<img class="thumb" style="width:120px;height:120px" alt="התמונה הנוכחית" src="${esc(api.publicImageUrl(n.imagePath))}">` : ''}
    </form><button class="btn w" id="save">שמור</button>`;
  $('#bk').onclick = () => ctx.back();
  $('#save').onclick = async (ev) => {
    const f = $('#cf');
    const v = { name: f.name.value.trim(), parentId: f.parentId.value || null, order: /^\d+$/.test(f.order.value.trim()) ? Number(f.order.value.trim()) : f.order.value.trim(), active: f.active.checked, isBakingProduct: f.isBakingProduct.checked };
    const out = {};
    for (const k of Object.keys(v)) if (!c || JSON.stringify(v[k]) !== JSON.stringify(c[k] == null ? null : c[k])) out[k] = v[k];
    const file = f.img.files[0];
    if (c && !Object.keys(out).length && !file) { toast('אין שינויים לשמירה'); return; }
    const r = await busy(ev.target, async () => api.saveCategory(c ? c.id : null, out, file ? await imageToB64(file, 1600) : null), 'הקטגוריה נשמרה');
    if (r) ctx.back();
  };
}

export default { id: 'categories', title: 'קטגוריות', roles: ['manager'], render };
