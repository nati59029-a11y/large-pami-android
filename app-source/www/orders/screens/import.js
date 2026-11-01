/* מסך "ייבוא מאקסל" (מנהל): הקובץ נקרא בטלפון בספריית xlsx הקיימת באפליקציה, השורות נשלחות לשרת
   ב-preview (השרת בודק כל שורה ולא כותב כלום), מוצגת תצוגה מקדימה, ורק אחרי אישור – commit, שכותב בדיוק את מה שהוצג. */
import * as api from '../api.js';
import { esc, $, toast, busy, saveFile } from '../ui.js';

// עמודות הקובץ: כותרת בעברית ← שם השדה בשרת. מותר גם לכתוב את שם השדה עצמו (למשל pricePrivate).
export const COLUMNS = [
  ['sku', 'מק"ט', 'חובה. לפיו יודעים איזה מוצר לעדכן'], ['name', 'שם המוצר', 'חובה במוצר חדש'],
  ['categoryId', 'קטגוריה', 'שם הקטגוריה או המזהה שלה. חובה במוצר חדש'], ['pricePrivate', 'מחיר לפרטי', 'כולל מע"מ, לחבילה. חובה במוצר חדש'],
  ['wholesalePrice', 'מחיר סיטונאי', 'בלי מע"מ, לחבילה'], ['cost', 'מחיר עלות (בלי מע"מ)', 'רק המנהל רואה'],
  ['unitsPerPack', 'יחידות בחבילה', ''], ['barcode', 'ברקוד', 'ספרות בלבד'], ['description', 'תיאור', ''],
  ['isBakingProduct', 'מוצר אפייה', 'כן / לא'], ['kashrut', 'כשרות', 'חובה במוצר אפייה'], ['allergens', 'אלרגנים', 'מופרדים בפסיק'],
  ['leadTimeHoursOverride', 'זמן הכנה מיוחד (שעות)', ''], ['deliveryAllowed', 'אפשר משלוח', 'כן / לא'], ['inTableEditor', 'בעורך השולחן', 'כן / לא'],
  ['relatedIds', 'מוצרים קשורים', 'מזהים, מופרדים בפסיק'], ['complementIds', 'מוצרים משלימים', 'מזהים, מופרדים בפסיק'],
  ['active', 'פעיל', 'כן / לא'], ['sortOrder', 'סדר', 'מספר'],
];
const MAX_ROWS = 2000; // כמו בשרת (functions/lib/importer.js)
const norm = (s) => String(s == null ? '' : s).replace(/[״”“]/g, '"').replace(/[׳’]/g, "'").replace(/\s+/g, '').toLowerCase();
const BY_HEADER = new Map(COLUMNS.flatMap(([k, h]) => [[norm(h), k], [norm(k), k]]));
const LABEL = Object.fromEntries(COLUMNS.map(([k, h]) => [k, h]));
const RES = { added: 'חדש', updated: 'עדכון', unchanged: 'ללא שינוי', error: 'שגיאה' };

// טבלה (מערך של שורות) ← { rows: [{שדה: ערך, excelRow}], lines: [מספר שורה באקסל], unknown: [כותרות לא מוכרות] }
// firstRow: מספר השורה באקסל של aoa[0] (שורת הכותרות). כל שורה נשלחת עם excelRow – מספר השורה המקורי בגיליון,
// גם כשמדלגים על שורות ריקות – כדי שמספרי השורות בהודעות של השרת יהיו כמו באקסל (שלב 1.10א/ב).
export function tableToRows(aoa, firstRow) {
  const r0 = Number.isInteger(firstRow) && firstRow >= 1 ? firstRow : 1;
  const head = (aoa[0] || []).map((h) => BY_HEADER.get(norm(h)) || null);
  const unknown = (aoa[0] || []).filter((h, i) => String(h).trim() && !head[i]).map(String);
  const rows = []; const lines = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = {}; let any = false;
    (aoa[i] || []).forEach((v, j) => {
      const k = head[j]; if (!k) return;
      if (v === '' || v == null) return;
      r[k] = typeof v === 'string' ? v.trim() : v; any = true;
    });
    if (any) { r.excelRow = r0 + i; rows.push(r); lines.push(r0 + i); }
  }
  return { rows, lines, unknown, mapped: head.filter(Boolean) };
}

async function render(root) {
  root.innerHTML = `<h2>ייבוא מוצרים מאקסל</h2>
    <div class="card"><p class="note">לכמות גדולה של מוצרים. שורה ראשונה – כותרות. מוצר קיים מזוהה לפי המק"ט. תא ריק לא משנה ערך קיים. שום דבר לא נכתב לפני שתאשר את התצוגה המקדימה.</p>
    <div class="row"><button class="btn g grow" id="tpl">הורדת קובץ לדוגמה</button><label class="btn grow" style="display:flex;align-items:center;justify-content:center;cursor:pointer">בחירת קובץ<input type="file" id="file" accept=".xlsx,.xls,.csv" hidden></label></div></div>
    <div id="res"></div>`;
  $('#tpl').onclick = () => {
    if (typeof XLSX === 'undefined') { toast('ספריית האקסל לא נטענה', true); return; }
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([COLUMNS.map((c) => c[1])]), 'מוצרים');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['עמודה', 'הסבר']].concat(COLUMNS.map((c) => [c[1], c[2]]))), 'הסבר');
    saveFile('products-import-template.xlsx', XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').catch((e) => toast('השמירה נכשלה: ' + (e.message || e), true));
  };
  $('#file').onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    const res = $('#res');
    if (typeof XLSX === 'undefined') { res.innerHTML = '<p class="err">ספריית האקסל לא נטענה באפליקציה</p>'; return; }
    const T = { start: performance.now() };
    res.innerHTML = '<p class="note">קורא את הקובץ…</p>';
    let parsed;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sh = wb.Sheets[wb.SheetNames[0]];
      // sheet_to_json מתחיל מתחילת הטווח של הגיליון. אם הטווח לא מתחיל בשורה 1 – מוסיפים את ההפרש, כדי שהמספור יישאר כמו באקסל
      const start = sh && sh['!ref'] ? XLSX.utils.decode_range(sh['!ref']).s.r + 1 : 1;
      parsed = tableToRows(XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '', blankrows: true }), start);
    } catch (e) { res.innerHTML = '<p class="err">לא הצלחתי לקרוא את הקובץ. ודא שזה קובץ אקסל או CSV תקין.</p>'; return; }
    T.read = performance.now() - T.start;
    if (!parsed.mapped.includes('sku')) { res.innerHTML = '<p class="err">אין בקובץ עמודת מק"ט. הורד את הקובץ לדוגמה וראה את שמות העמודות.</p>'; return; }
    if (!parsed.rows.length) { res.innerHTML = '<p class="err">אין שורות בקובץ</p>'; return; }
    if (parsed.rows.length > MAX_ROWS) { res.innerHTML = `<p class="err">בקובץ ${parsed.rows.length} שורות. אפשר עד ${MAX_ROWS} בבת אחת – חלק לכמה קבצים.</p>`; return; }
    res.innerHTML = `<p class="note">${parsed.rows.length} שורות נשלחות לבדיקה בשרת…</p>`;
    const t1 = performance.now();
    const pv = await busy(null, () => api.importPreview(parsed.rows));
    if (!pv) { res.innerHTML = '<p class="err">הבדיקה נכשלה. נסה שוב.</p>'; return; }
    T.preview = performance.now() - t1;
    showPreview(res, f.name, parsed, pv, T);
  };
}

function changeText(ch) {
  return Object.entries(ch || {}).map(([k, c]) => `${esc(LABEL[k] || k)}: ${esc(fmt(c.before))} ← ${esc(fmt(c.after))}`).join('<br>');
}
const fmt = (v) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : v === true ? 'כן' : v === false ? 'לא' : String(v));

function showPreview(res, fileName, parsed, pv, T) {
  const c = pv.counts || {};
  const toWrite = (c.added || 0) + (c.updated || 0);
  const errs = pv.rows.filter((r) => r.result === 'error');
  const chg = pv.rows.filter((r) => r.result !== 'error');
  // מספר השורה כמו באקסל: השרת מחזיר ב-row את excelRow ששלחנו
  const line = (r) => r.row;
  const LIM = 200;
  const table = (arr, cols) => `<div style="overflow-x:auto"><table><tr><th>שורה*</th><th>מק"ט</th>${cols}</tr>${arr.slice(0, LIM).map((r) => `<tr><td>${line(r)}</td><td dir="ltr">${esc(r.sku || '—')}</td>${r.result === 'error' ? `<td class="err">${esc((r.errors || []).join('\n'))}</td>` : `<td>${RES[r.result]}</td><td>${changeText(r.changes)}</td>`}</tr>`).join('')}</table></div><p class="note">* מספר השורה בקובץ האקסל (שורת הכותרות היא שורה 1).</p>${arr.length > LIM ? `<p class="note">מוצגות ${LIM} מתוך ${arr.length}.</p>` : ''}`;
  window.__lpImport = { counts: c, total: pv.total, times: T, serverMs: pv.ms };
  res.innerHTML = `<div class="card"><h3>תצוגה מקדימה: ${esc(fileName)}</h3>
    <div class="counts" id="counts"><div><b>${c.added || 0}</b>חדשים</div><div><b>${c.updated || 0}</b>עדכונים</div><div><b>${c.unchanged || 0}</b>ללא שינוי</div><div><b>${c.error || 0}</b>שגיאות</div></div>
    <p class="note">נקרא בטלפון ב-${(T.read / 1000).toFixed(1)} שניות, ונבדק בשרת ב-${(T.preview / 1000).toFixed(1)} שניות. ${parsed.unknown.length ? `<br><span class="err">עמודות לא מוכרות, לא ייובאו: ${esc(parsed.unknown.join(', '))}</span>` : ''}</p>
    ${errs.length ? `<p class="note">שורות עם שגיאה לא ייכתבו. אפשר לתקן אותן בקובץ ולייבא שוב.</p>` : ''}
    ${toWrite ? `<button class="btn w" id="commit">אשר וכתוב ${toWrite} שורות</button>` : '<p class="note">אין מה לכתוב.</p>'}
    <p id="cres" role="status"></p></div>
    ${errs.length ? `<h3>שגיאות (${errs.length})</h3>${table(errs, '<th>מה לא תקין</th>')}` : ''}
    ${chg.length ? `<h3>מה ישתנה (${chg.length})</h3>${table(chg, '<th>סוג</th><th>שינוי</th>')}` : ''}`;
  if (!toWrite) return;
  const b = $('#commit');
  b.onclick = async () => {
    const t2 = performance.now();
    const r = await busy(b, () => api.importCommit(parsed.rows, pv.previewHash));
    if (!r) return;
    T.commit = performance.now() - t2;
    window.__lpImport.committed = r.counts; window.__lpImport.written = (r.written || []).length;
    b.remove();
    $('#cres').innerHTML = `<span class="ok">נכתבו ${(r.written || []).length} מוצרים (${r.counts.added} חדשים, ${r.counts.updated} עדכונים) ב-${(T.commit / 1000).toFixed(1)} שניות.</span>`;
    toast('הייבוא הושלם');
  };
}

export default { id: 'import', title: 'ייבוא מאקסל', roles: ['manager'], render };
