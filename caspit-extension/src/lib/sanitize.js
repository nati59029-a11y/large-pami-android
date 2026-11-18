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
const api = { MAX_BYTES, SECRET_KEY, scrub, sanitize, limit, clean, size };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxSanitize = api;
})(typeof self !== 'undefined' ? self : this);
