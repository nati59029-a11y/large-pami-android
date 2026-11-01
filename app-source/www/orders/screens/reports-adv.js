/* שלב 5.4: דוחות מתקדמים – לשוניות חדשות בתוך מסך "דוחות" הקיים (admin.js). מנהל בלבד (המסך כולו עטוף ב-mgrOnly, והשרת חוסם).
   - כל מספר מגיע מהשרת (getReports). אין כאן שום חישוב כספי – רק תצוגה.
   - כל טקסט נכנס דרך textContent (בלי innerHTML), כולל שמות מוצרים, קטגוריות ולקוחות.
   - הדוחות הקיימים של 2.4 (מכירות, מוצרים מובילים, זמני טיפול, שוטף) לא השתנו. */
import * as api from '../api.js';
import { ils, busy, saveFile } from '../ui.js';

const PROFIT_COLS = [['packs', 'חבילות'], ['orders', 'הזמנות'], ['revenue', 'הכנסה', 1], ['cost', 'עלות', 1], ['profit', 'רווח', 1], ['profitPercent', 'רווח %', 2], ['missingCostLines', 'בלי עלות']];
// [מפתח, כותרת, שם הלשונית, עמודות, הערה]. בעמודה: 1 = סכום בשקלים, 2 = אחוז
const TABS = [
  ['profit', 'רווח', [['name', 'מוצר'], ...PROFIT_COLS], 'בלי מע"מ, אחרי הנחות. עלות – מרגע ההזמנה. שורה בלי עלות נספרת בהכנסה ולא ברווח.'],
  ['customer_types', 'סוג לקוח', [['label', 'סוג'], ['orders', 'הזמנות'], ['total', 'סה"כ', 1], ['discounts', 'הנחות', 1], ['creditUsed', 'מיתרת זיכוי', 1], ['paid', 'שולם', 1], ['avgOrder', 'ממוצע', 1]], 'כולל מע"מ. יתרת זיכוי היא אמצעי תשלום ולא הנחה.'],
  ['promotions', 'מבצעים וקופונים', [['label', 'סוג'], ['name', 'שם / קוד'], ['orders', 'הזמנות'], ['discount', 'הנחה', 1], ['ordersTotal', 'סכום ההזמנות', 1], ['usedCount', 'שימושים']], 'הנחה כולל מע"מ. "שימושים" – כפי שנספרו בקופון (שימוש לא חוזר בביטול).'],
  ['inspirations', 'השראות', [['name', 'השראה'], ['orders', 'הזמנות'], ['total', 'סכום', 1]], 'השראה מזוהה רק כשההזמנה הגיעה מעיצוב שמור. אחרת – "השראה לא מזוהה".'],
  ['tools_usage', 'רשימה ועוזר', [['label', 'מקור'], ['orders', 'הזמנות'], ['ordersPercent', 'מכלל ההזמנות', 2], ['total', 'סכום', 1], ['conversations', 'שיחות'], ['customerMessages', 'הודעות'], ['flaggedConversations', 'מסומנות']], 'ב"רשימה לעגלה" לא נשמר מספר השימושים – מוצגות רק ההזמנות שהגיעו ממנה.'],
  ['deferred_aging', 'גיל חוב', [['name', 'לקוח'], ['notDue', 'לא הגיע מועד', 1], ['d1_30', '1–30', 1], ['d31_60', '31–60', 1], ['d61_90', '61–90', 1], ['d90plus', '90+', 1], ['noDueDate', 'בלי מועד', 1], ['total', 'סה"כ', 1]], 'חשבוניות מס פתוחות של סיטונאים, לפי ימים מהמועד לתשלום.'],
];
const CAT_COLS = [['name', 'קטגוריה'], ...PROFIT_COLS];

const el = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};
const fmt = (v, kind) => {
  if (v == null || v === '') return '—';
  if (kind === 1) return ils(v);
  if (kind === 2) return Number(v).toLocaleString('he-IL', { maximumFractionDigits: 2 }) + '%';
  return String(v);
};
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function mountAdvancedReports(root) {
  let cur = TABS[0][0];
  const tabs = el('div', { class: 'tabs', role: 'tablist', id: 'xtabs' });
  const from = el('input', { type: 'date', id: 'xf', value: isoDay(new Date(Date.now() - 29 * 86400000)) });
  const to = el('input', { type: 'date', id: 'xt', value: isoDay(new Date()) });
  const toLbl = el('span', { text: 'עד תאריך' });
  const fromBox = el('label', { class: 'f' }, el('span', { text: 'מתאריך' }), from);
  const grp = el('select', { id: 'xg' }, el('option', { value: 'product', text: 'לפי מוצר' }), el('option', { value: 'category', text: 'לפי קטגוריה' }));
  const grpBox = el('label', { class: 'f' }, el('span', { text: 'קיבוץ' }), grp);
  const note = el('p', { class: 'note', id: 'xnote' });
  const show = el('button', { class: 'btn', id: 'xshow', text: 'הצג' });
  const csv = el('button', { class: 'btn g', id: 'xcsv', text: 'ייצוא לאקסל' });
  const out = el('div', { id: 'xout' });
  const card = el('div', { class: 'card' }, el('div', { class: 'grid2' }, fromBox, el('label', { class: 'f' }, toLbl, to)), grpBox, note, el('div', { class: 'row' }, show, csv));
  const sec = el('section', { id: 'radv' }, el('h2', { text: 'דוחות מתקדמים' }), tabs, card, out);
  root.append(sec);

  const def = () => TABS.find((t) => t[0] === cur);
  const sync = () => {
    for (const b of tabs.children) { if (b.dataset.k === cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); b.setAttribute('aria-selected', String(b.dataset.k === cur)); }
    const aging = cur === 'deferred_aging';
    fromBox.hidden = aging; toLbl.textContent = aging ? 'נכון לתאריך' : 'עד תאריך';
    grpBox.hidden = cur !== 'profit';
    note.textContent = def()[3];
    out.replaceChildren();
  };
  for (const [k, label] of TABS) {
    const b = el('button', { type: 'button', role: 'tab', text: label });
    b.dataset.k = k;
    b.onclick = () => { cur = k; sync(); };
    tabs.append(b);
  }
  sync();

  const input = (format) => {
    const i = { report: cur, format };
    if (cur === 'deferred_aging') { if (to.value) i.to = to.value; } else { i.from = from.value; i.to = to.value; }
    if (cur === 'profit') i.groupBy = grp.value;
    return i;
  };
  show.onclick = async () => {
    const k = cur; const g = grp.value;
    const r = await busy(show, () => api.getReports(input('json')));
    if (!r || k !== cur) return;
    const cols = k === 'profit' && g === 'category' ? CAT_COLS : def()[2];
    const box = el('div', { class: 'card', style: 'overflow-x:auto' });
    if (r.isDemo) box.append(el('p', { class: 'note' }, el('span', { class: 'tag gold', text: 'דמו' }), ' נתוני בדיקה – לא נתוני העסק'));
    if (r.asOf) box.append(el('p', { class: 'note', text: 'נכון ל-' + r.asOf }));
    if (!r.rows.length) box.append(el('p', { class: 'note', id: 'xempty', text: 'אין נתונים בטווח.' }));
    else {
      const t = el('table', { id: 'xtab' });
      t.append(el('tr', {}, ...cols.map((c) => el('th', { text: c[1] }))));
      for (const row of r.rows) t.append(el('tr', {}, ...cols.map((c) => el('td', { text: c[0] === 'name' && row.name == null ? (row.productId || row.categoryId || row.customerUid || '—') : fmt(row[c[0]], c[2]) }))));
      if (r.totals) t.append(el('tr', { class: 'tot', id: 'xtot' }, ...cols.map((c, i) => el('th', { text: i === 0 ? 'סה"כ' : Object.prototype.hasOwnProperty.call(r.totals, c[0]) ? fmt(r.totals[c[0]], c[2]) : '' }))));
      box.append(t);
    }
    out.replaceChildren(box);
  };
  csv.onclick = async () => {
    const r = await busy(csv, () => api.getReports(input('csv')), 'הקובץ נשמר');
    if (r && r.csv != null) await saveFile(r.filename || 'report.csv', new TextEncoder().encode(r.csv), 'text/csv');
  };
}
