// תוסף כספית – ניקוי דוח ההיכרות לפני שהוא יוצא מהמחשב (טהור).
// הדוח אמור להכיל רק מבנה: נתיבים עם מצייני מקום, שמות שדות, שמות כותרות, טקסט כפתורים.
// הניקוי הוא שכבת הגנה שנייה: מוחק ערכים של מפתחות רגישים (cookie/authorization/token/password…),
// ומחליף בטקסט: JWT, מחרוזות ארוכות שנראות כמו מפתח, כתובות מייל, טלפונים, ומספרים של 5 ספרות ומעלה (ת"ז, חשבון, כרטיס).
// גודל מרבי: 1MB – אם גדול יותר, מקצרים את הרשימות הארוכות ומסמנים truncated.
(function (root) {
'use strict';
const MAX_BYTES = 1024 * 1024;
const SECRET_KEY = /cookie|authori[sz]|token|passw|secret|session|bearer|api[-_]?key|signature|credential|csrf|xsrf|otp|^pin$|^sid$/i;
const NUM_OK = /^(st|status|sz|size|n|len|count|cnt|i|ms|v|ver|w|h|rows|cols|hi|nth|at|total)$/i;
const STR_MAX = 200;
function scrub(s) {
  let t = String(s);
  t = t.replace(/\bBearer\s+\S+/gi, 'Bearer [x]');
  t = t.replace(/eyJ[\w-]{5,}\.[\w-]{5,}\.?[\w-]*/g, '[tok]');
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]');
  t = t.replace(/(\+?972[\s-]?|\b0)(\d[\s-]?){8,9}\b/g, '[phone]');
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]');
  t = t.replace(/[A-Za-z0-9+/_-]{24,}={0,2}/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? '[tok]' : m));
  t = t.replace(/\d[\d\s-]{3,}\d/g, (m) => (m.replace(/\D/g, '').length >= 5 ? '[n]' : m));
  t = t.replace(/(^|[?&;])([^=&;]{1,40})=([^&;#]*)/g, (m, a, k, v) => (SECRET_KEY.test(k) && v && !/^\{\w+\}$/.test(v) ? `${a}${k}=[x]` : m));
  return t.length > STR_MAX ? t.slice(0, STR_MAX) + '…' : t;
}
function sanitize(v, key, depth) {
  const d = depth || 0;
  if (d > 12) return null;
  if (key && SECRET_KEY.test(key)) return v == null ? v : '[x]';
  if (v == null || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (key && NUM_OK.test(key)) return v;
    return Math.abs(v) >= 10000 ? '[n]' : v;
  }
  if (typeof v === 'string') return scrub(v);
  if (Array.isArray(v)) return v.slice(0, 2000).map((x) => sanitize(x, null, d + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).slice(0, 300)) {
      const sk = scrub(k).slice(0, 60);
      o[sk] = sanitize(v[k], k, d + 1);
    }
    return o;
  }
  return null;
}
const size = (o) => new TextEncoder().encode(JSON.stringify(o)).length;
// מקצר את הרשימה הארוכה ביותר שוב ושוב עד שהדוח קטן מ-max
function limit(rep, max) {
  const M = max || MAX_BYTES;
  let o = JSON.parse(JSON.stringify(rep));
  for (let g = 0; g < 200 && size(o) > M; g++) {
    let best = null;
    const walk = (x) => {
      if (Array.isArray(x)) { if (!best || x.length > best.length) best = x; x.forEach(walk); } else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    };
    walk(o);
    if (!best || best.length < 2) { o = { truncated: true, note: 'report too large' }; break; }
    best.splice(Math.ceil(best.length / 2));
    o.truncated = true;
  }
  return o;
}
const clean = (rep, max) => limit(sanitize(rep), max);
// ---------- קובץ שעות עובד מההיכרות (0.1.10, זרימה empHours; 0.1.11 – גם קובצי לקוחות הקפה וכותרות טבלה בדפי priv) ----------
// שורת הכותרות עלולה להכיל שם עובד, ולכן נשלחת רק דרך רשימה לבנה: תא שכל המילים בו מוכרות (תאריך, כניסה, יציאה, שעות, 125%…)
// נשלח כמו שהוא; כל תא אחר → '?'. מהשורות הראשונות (עד 5) – רק סוג לכל תא (num / time / date / empty / text), בלי ערכים.
const HDR_WORDS = new Set(('תאריך תאריכים יום ימים כניסה כניסות יציאה יציאות שעה שעות שעת רגילות רגיל נוספות נוספת סה"כ סהכ סך הכל כולל ' +
  'הפסקה הפסקות זמן הערות הערה סניף סניפים חנות שם העובד עובד עובדים כרטיס מספר מס\' מס חודש שבוע תעריף שכר עלות משמרת משמרות סוג סטטוס ' +
  'פעולות מקור ידני ידנית ממוצע היעדרות חופש חופשה מחלה אישור מאושר דקות בפועל תקן חוסר עודף שבת חג ערב מחלקה תפקיד נוכחות דיווח ' +
  'התחלה סיום מ עד של ו את ל ב ' +
  // 0.1.11 – לקוחות הקפה ומסמכים (כותרות צפויות: שם לקוח, ח.פ/ע.מ, טלפון, כתובת, יתרה, מספר/סוג מסמך, סכום, מע"מ, קופה, מספר לקוח…)
  'לקוח לקוחות הקפה עסקי עסקיים פרטי פרטיים ח פ ע ז ת ח"פ ע"מ ת"ז עוסק מורשה פטור חברה ח.פ ע.מ טלפון טלפונים טל\' נייד פקס כתובת עיר ישוב רחוב מיקוד ' +
  'דוא"ל מייל אימייל איש קשר יתרה יתרת חוב חובה זכות זכאי אשראי מסגרת תנאי תשלום תשלומים שוטף פירעון מסמך מסמכים חשבונית חשבוניות מס מרכזת מרכזות ' +
  'קבלה קבלות תעודה תעודת תעודות משלוח זיכוי סכום סכומים מע"מ מעמ לפני אחרי קופה קופות קופאי מזהה קוד פריט פריטים כמות מחיר יחידה הנחה ברקוד תיאור ' +
  'שורה שורות פתוח פתוחה פתוחים סגור שולם לא כן אחרון אחרונה קנייה קניות רכישה רכישות מכירה מכירות תקופה שנה חודשי חודשית חיוב אסמכתא ערך מטבע ש"ח ₪ ' +
  'מזומן אמצעי הפקה הנפקה מקורי קבוצה קבוצת הערה סיכום ריכוז פירוט דוח מצב פעיל נטו ברוטו רשימה').split(' '));
const HDR_PCT = /^\d{2,3}(?:\.\d)?%$/;
// תא כותרת → אותו תא (מנורמל) אם כל המילים בו מוכרות (גם עם ו/ה/ב/ל/מ בתחילת מילה), אחרת '?'
function hdrCell(v) {
  const t = String(v == null ? '' : v).replace(/[\u200e\u200f\ufeff]/g, '').replace(/[”“״]/g, '"').replace(/[׳`’]/g, "'").replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length > 40) return '?';
  const words = t.split(/[\s()\-–/.,:]+/).filter(Boolean);
  if (!words.length) return '?';
  const known = (w) => HDR_WORDS.has(w) || HDR_PCT.test(w) || (/^[והבלמש]/.test(w) && w.length > 2 && HDR_WORDS.has(w.slice(1)));
  return words.every(known) ? t : '?';
}
const hdrSafe = (row) => (Array.isArray(row) ? row.slice(0, 40).map(hdrCell) : null);
function cellKind(v) {
  if (v == null) return 'empty';
  if (typeof v === 'number') return Number.isFinite(v) ? 'num' : 'text';
  if (v instanceof Date) return 'date';
  const t = String(v).trim();
  if (!t) return 'empty';
  if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(t)) return 'time';
  // 0.1.11: סכום כמו 1234.50 הוא מספר ולא תאריך – תאריך = יום/חודש(/שנה) או שנה-חודש-יום
  if (/^(?:\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{4}[./-]\d{1,2}[./-]\d{1,2})(?:[ T]\d{1,2}:\d{2}(:\d{2})?)?$/.test(t)) return 'date';
  if (/^-?\d+(?:[.,]\d+)?%?$/.test(t)) return 'num';
  return 'text';
}
// rows (מ-readRows) → { hi, hdr, kinds }: hi = השורה עם הכי הרבה תאים מוכרים (לפחות 2) מבין 10 הראשונות, אחרת -1 (hdr = null)
function fileShape(rows, n) {
  const R = Array.isArray(rows) ? rows : [];
  let hi = -1, best = 1;
  for (let i = 0; i < Math.min(10, R.length); i++) {
    const h = hdrSafe(R[i]) || [];
    const k = h.filter((x) => x && x !== '?').length;
    if (k > best) { best = k; hi = i; }
  }
  return { hi, hdr: hi >= 0 ? hdrSafe(R[hi]) : null, kinds: R.slice(0, n || 5).map((r) => (Array.isArray(r) ? r.slice(0, 40).map(cellKind) : [])) };
}
const api = { MAX_BYTES, SECRET_KEY, scrub, sanitize, limit, clean, size, hdrCell, hdrSafe, cellKind, fileShape };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxSanitize = api;
})(typeof self !== 'undefined' ? self : this);
