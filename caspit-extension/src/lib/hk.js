// תוסף כספית – "יתרות הקפה" (0.1.20): פענוח קובץ "יצוא לאקסל" של מסך לקוחות הקפה (#/hakafa-customers). טהור, בלי chrome.*.
// מכספית האמיתית (דוח היכרות 24.11): xlsx, 22 עמודות, שורת הכותרות היא הראשונה. מיפוי לפי טקסט הכותרת (לא לפי מיקום):
//   xc ← "מספר לקוח", tz ← "ת.ז" (או ח.פ / ע.מ), name ← "שם פרטי" + "שם משפחה" (אם יש; אחרת "שם לקוח" / "שם"),
//   ph ← "טלפון" (אחרת "נייד"), addr ← "כתובת", bal ← "יתרה" באגורות (מספר שלם; "1,234.50", "-88.2", "(88.20)", "88.20-").
// שורה ריקה / שורת סיכום (בלי מספר לקוח, או "סה"כ") – מדלגים. שורה עם יתרה לא מובנת – לא נשלחת (נספרת ב-bad).
// פרטיות: מחזירים רק את 6 השדות האלה – שום עמודה אחרת (אימייל, הערות, אחוז הנחה, מספר עובד, קבוצה…) לא יוצאת מכאן.
(function (root) {
'use strict';
const MAX_ROWS = 5000; // לקוחות בתמונה אחת (כיום 243)
const norm = (v) => String(v == null ? '' : v).replace(/[‎‏‪-‮⁦-⁩﻿]/g, '').replace(/ /g, ' ').replace(/[”“״]/g, '"').replace(/\s+/g, ' ').trim();
const key = (v) => norm(v).replace(/[\s."'׳`:]/g, ''); // "ת.ז." / "ת"ז" / "ת ז" → "תז"
const SUM_RE = /^(סה"כ|סה''כ|סהכ|סך הכל|סך הכול|total)/i;
// אגורות (מספר שלם) או null. ריק → 0
function agorot(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  let t = norm(v).replace(/[₪\s]/g, '').replace(/[−–]/g, '-');
  if (!t) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }
  if (/^-/.test(t)) { neg = !neg; t = t.slice(1); }
  t = t.replace(/,(?=\d{3}(?:\D|$))/g, ''); // מפריד אלפים
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const a = Math.round(parseFloat(t) * 100);
  return neg && a ? -a : a;
}
// מספר לקוח: ספרות (גם 1001.0 מאקסל)
function custNo(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? String(v) : null;
  const t = norm(v).replace(/\.0+$/, '');
  return /^\d{1,15}$/.test(t) ? t : null;
}
const txt = (v, n) => (typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : norm(v)).slice(0, n);
// עמודות לפי כותרת: קודם התאמה מדויקת (אחרי key), אחר כך מוכלת
function cols(hdr) {
  const K = hdr.map(key);
  const ex = (...ws) => { for (const w of ws) { const i = K.indexOf(key(w)); if (i >= 0) return i; } return -1; };
  const has = (re) => K.findIndex((k) => re.test(k));
  const c = {
    xc: ex('מספר לקוח', 'מס לקוח', 'קוד לקוח'),
    tz: ex('ת.ז', 'ת.ז/ח.פ', 'ת.ז./ח.פ.', 'ח.פ/ע.מ', 'ח.פ', 'ע.מ', 'תעודת זהות'),
    first: ex('שם פרטי'),
    last: ex('שם משפחה'),
    name: ex('שם לקוח', 'שם'),
    ph: ex('טלפון', 'טלפון 1', 'טלפון נייד', 'נייד'),
    addr: ex('כתובת'),
    bal: ex('יתרה', 'יתרה כוללת', 'יתרת חוב'),
  };
  if (c.tz < 0) c.tz = has(/^(תז|חפ|עמ)/);
  if (c.last < 0) c.last = has(/משפחה/);
  if (c.ph < 0) c.ph = has(/טלפון|נייד/);
  if (c.addr < 0) c.addr = has(/^כתובת/);
  return c;
}
// שורות (מ-readRows) → { ok:true, rows:[{ xc, tz, name, ph, addr, bal }], hi, skip, bad, dup } | { ok:false, why, hi }
function parse(R) {
  const rows = Array.isArray(R) ? R : [];
  let hi = -1, c = null;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = Array.isArray(rows[i]) ? rows[i] : [];
    const x = cols(h);
    if (x.xc >= 0 && x.bal >= 0) { hi = i; c = x; break; }
  }
  if (hi < 0) return { ok: false, why: 'hdr', hi: -1 };
  if (c.first < 0 && c.name < 0) return { ok: false, why: 'name', hi };
  const out = [], seen = new Set();
  let skip = 0, bad = 0, dup = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = Array.isArray(rows[i]) ? rows[i] : [];
    const at = (k) => (c[k] >= 0 ? r[c[k]] : '');
    if (!r.some((v) => norm(v))) { skip++; continue; } // שורה ריקה
    const xc = custNo(at('xc'));
    if (!xc || r.some((v) => SUM_RE.test(norm(v)))) { skip++; continue; } // שורת סיכום / בלי מספר לקוח
    const bal = agorot(at('bal'));
    if (bal === null) { bad++; continue; }
    if (seen.has(xc)) { dup++; continue; }
    seen.add(xc);
    const name = (c.first >= 0 ? [txt(at('first'), 60), txt(at('last'), 60)].filter(Boolean).join(' ') : txt(at('name'), 120)).slice(0, 120);
    out.push({ xc, tz: txt(at('tz'), 20), name, ph: txt(at('ph'), 30), addr: txt(at('addr'), 200), bal });
  }
  return { ok: true, rows: out, hi, skip, bad, dup };
}
const api = { MAX_ROWS, parse, agorot, custNo, cols };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxHk = api;
})(typeof self !== 'undefined' ? self : this);
