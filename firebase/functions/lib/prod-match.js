// התאמת מוצרים לפי טקסט חופשי (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 2 חלק א').
// פונקציות טהורות – בלי Firestore. אותו קובץ בדיוק: app-source/www/prod-match.js (בדיקה ב-prod-match.unit.test.js).
//
// נרמול עברית (norm): אותיות קטנות, בלי ניקוד וטעמים, בלי גרש/גרשיים/מירכאות (מק"ט = מקט), אותיות סופיות → רגילות,
//   פיסוק = רווח, ספרות נפרדות מאותיות ("80גרם" → "80 גרם"), מספר עשרוני נשמר ("1.5").
// צורות של מילה (forms): המילה, בלי ריבוי/נקבה (ים/ות/ה/ת – "צלחות" ו"צלחת" → "צלח"), בלי ה/ו בתחילת מילה ארוכה,
//   א בסוף = ה ("קופסא" = "קופסה"), ו"שלד" בלי ו/י באמצע (כתיב מלא/חסר: "שקיות" = "שקית").
// ציון למילה מהחיפוש מול מילה של מוצר (0..1): זהה 1; צורה זהה 0.95; קידומת 0.9; שלד זהה 0.85;
//   מרחק עריכה לפי אורך מילת החיפוש (1–4 אותיות: 0, 5–8: עד 1, מעל 8: עד 2) 0.8 פחות 0.1 לכל שינוי; הכלה (3+ אותיות) 0.7;
//   דמיון זוגות אותיות (Dice) – 0.6 × הדמיון, רק מ-0.5 ומעלה. מספרים – רק זהים.
// ציון מוצר: לכל שם (הראשי וכל כינוי, al) – 0.8 × ממוצע המילים מהחיפוש + 0.2 × החלק של מילות השם שנמצאו; הגבוה מבין השמות.
//   ברקוד או מק"ט מדויקים (כל הטקסט) מנצחים – ציון 2. דירוג: ברקוד/מק"ט ← קנה בעבר (bought) ← ציון ← שם.
// ביצועים: index() נבנה פעם אחת לכל טעינה של רשימת המוצרים. כל מילה שונה בקטלוג מחושבת פעם אחת לכל חיפוש (אוצר מילים),
//   והציון של מוצר הוא רק סכום של ערכים מוכנים.
// כמות בשורה (qtyOf): ספרות או מילים ("חמישה", "תריסר", "חצי"), "x5"/"5×", קרטון/ארגז → ct, מארז/חבילה → pk.
//   מספר שאחריו יחידת מידה (גרם, מ"ל, ליטר, ק"ג, ס"מ…) הוא חלק מהשם ולא כמות.

(function (root) {
'use strict';
const FIN = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const W = {
  min: 0.4, // ציון מינימלי להצעה
  exact: 1, form: 0.95, prefix: 0.9, skel: 0.85, edit: 0.8, editStep: 0.1, contain: 0.7, dice: 0.6, diceMin: 0.5,
  q: 0.8, p: 0.2, code: 2,
};
// ---------- נרמול ----------
function norm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[֑-ׇ]/g, (c) => (c === '־' ? ' ' : '')) // ניקוד וטעמים (מקף עברי = רווח)
    .replace(/["'`׳״‘’“”„]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FIN[c])
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\.(?!\d)|(?<!\d)\./g, ' ')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2').replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/\s+/g, ' ').trim();
}
const words = (s) => { const n = norm(s); return n ? n.split(' ') : []; };
const isNumTok = (t) => /^\d+(\.\d+)?$/.test(t);
const HEB = /[א-ת]/;
// בלי ריבוי / נקבה. האותיות כבר בלי סופיות (ים = "ימ")
function stem(t) {
  if (!HEB.test(t) || t.length < 3) return t;
  let s = t;
  if (s.length >= 5 && /(ימ|ות)$/.test(s)) s = s.slice(0, -2);
  else if (s.length >= 4 && /[הת]$/.test(s)) s = s.slice(0, -1);
  else if (s.length >= 3 && /א$/.test(s)) s = s.slice(0, -1);
  return s;
}
// שלד: אות ראשונה + השאר בלי ו/י (כתיב מלא / חסר)
const skelOf = (t) => (HEB.test(t) && t.length >= 4 ? t[0] + t.slice(1).replace(/[וי]/g, '') : t);
function forms(t) {
  const F = new Set([t, stem(t)]);
  if (HEB.test(t) && t.length >= 4 && /^[הו]/.test(t)) { F.add(t.slice(1)); F.add(stem(t.slice(1))); }
  return [...F];
}
function bigrams(t) { const B = new Set(); for (let i = 0; i < t.length - 1; i++) B.add(t.slice(i, i + 2)); return B; }
function dice(A, B) { if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return (2 * n) / (A.size + B.size); }
// מרחק עריכה עם תקרה (max): מעל התקרה מחזיר max+1
function lev(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1); for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let lo = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < lo) lo = cur[j];
    }
    if (lo > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const editMax = (n) => (n <= 4 ? 0 : n <= 8 ? 1 : 2);
// מילה מוכנה להשוואה
function tok(t) { const f = forms(t); return { t, num: isNumTok(t), f, sk: skelOf(stem(t)), bg: bigrams(stem(t)) }; }
// ציון מילת חיפוש (q) מול מילת מוצר (p), שתיהן אחרי tok()
function tokScore(q, p) {
  if (q.t === p.t) return W.exact;
  if (q.num || p.num) return 0;
  let best = 0;
  for (const a of q.f) for (const b of p.f) if (a === b && a.length >= 2) best = W.form;
  if (best) return best;
  if (q.t.length >= 2 && (p.t.startsWith(q.t) || q.f.some((a) => a.length >= 2 && p.f.some((b) => b.startsWith(a))))) return W.prefix;
  if (q.sk.length >= 3 && q.sk === p.sk) return W.skel;
  const qs = q.f[1] || q.t, ps = p.f[1] || p.t, m = editMax(qs.length);
  if (m) { const d = Math.min(lev(qs, ps, m), lev(q.t, p.t, m)); if (d <= m) best = W.edit - W.editStep * d; }
  if (q.t.length >= 3 && p.t.includes(q.t)) best = Math.max(best, W.contain);
  const dc = dice(q.bg, p.bg);
  if (dc >= W.diceMin) best = Math.max(best, W.dice * dc);
  return best;
}
// ---------- אינדקס ----------
// products: [{ id, name, al?: [], barcode?, sku?, ...}]. מחזיר אובייקט לשימוש ב-search. מוצר בלי id / בלי שם – לא נכנס
function index(products) {
  const V = [], vid = new Map(), P = [], bc = new Map(), sku = new Map();
  const tid = (t) => { let k = vid.get(t); if (k === undefined) { k = V.length; vid.set(t, k); V.push(tok(t)); } return k; };
  const put = (m, k, i) => { if (!m.has(k)) m.set(k, []); m.get(k).push(i); };
  for (const x of Array.isArray(products) ? products : []) {
    if (!x || x.id == null || !x.name) continue;
    const i = P.length, names = [];
    const seen = new Set();
    for (const [n, k] of [[x.name, 'name']].concat((Array.isArray(x.al) ? x.al : []).map((a) => [a, 'al']))) {
      const ws = words(n), key = ws.join(' ');
      if (!ws.length || seen.has(key)) continue;
      seen.add(key);
      names.push({ k, n: String(n), ids: [...new Set(ws.map(tid))] });
    }
    if (!names.length) continue;
    P.push({ id: x.id, p: x, names });
    const b = String(x.barcode || '').trim(); if (b) put(bc, b.toLowerCase(), i);
    const s = norm(x.sku).replace(/\s+/g, ''); if (s) put(sku, s, i);
  }
  return { V, P, bc, sku };
}
// ---------- חיפוש ----------
// search(idx, text, { limit=8, bought: Set|Map|Array של מזהים, min }) → [{ id, p (המוצר), s (ציון), k: 'bc'|'sku'|'name'|'al', n (השם שהתאים), b (קנה בעבר) }]
function search(idx, text, opt) {
  const o = opt || {};
  const limit = Number.isInteger(o.limit) && o.limit > 0 ? o.limit : 8;
  const min = typeof o.min === 'number' ? o.min : W.min;
  const bt = o.bought instanceof Set || o.bought instanceof Map ? o.bought : new Set(Array.isArray(o.bought) ? o.bought : []);
  if (!idx || !Array.isArray(idx.P)) return [];
  const raw = String(text == null ? '' : text).trim();
  const R = new Map();
  const hit = (i, s, k, n) => { const r = R.get(i); if (!r || s > r.s) R.set(i, { i, s, k, n }); };
  if (raw && !/\s/.test(raw)) {
    for (const i of idx.bc.get(raw.toLowerCase()) || []) hit(i, W.code, 'bc', raw);
    const s = norm(raw).replace(/\s+/g, '');
    for (const i of (s && idx.sku.get(s)) || []) hit(i, W.code, 'sku', raw);
  }
  const Q = [...new Set(words(raw))].map(tok);
  if (Q.length) {
    // ציון כל מילת חיפוש מול כל מילה באוצר המילים – פעם אחת
    const S = Q.map((q) => { const a = new Float32Array(idx.V.length); for (let v = 0; v < idx.V.length; v++) a[v] = tokScore(q, idx.V[v]); return a; });
    for (let i = 0; i < idx.P.length; i++) {
      for (const nm of idx.P[i].names) {
        let sq = 0, pc = 0;
        for (const a of S) { let b = 0; for (const v of nm.ids) if (a[v] > b) b = a[v]; sq += b; }
        for (const v of nm.ids) { let b = 0; for (const a of S) if (a[v] > b) b = a[v]; if (b >= W.contain) pc++; }
        const s = W.q * (sq / S.length) + W.p * (pc / nm.ids.length);
        if (s >= min) hit(i, s, nm.k, nm.n);
      }
    }
  }
  const out = [...R.values()].map((r) => { const x = idx.P[r.i]; return { id: x.id, p: x.p, s: Math.round(r.s * 1000) / 1000, k: r.k, n: r.n, b: bt.has(x.id) }; });
  out.sort((a, b) => ((b.s >= W.code) - (a.s >= W.code)) || (b.b - a.b) || (b.s - a.s) || String(a.p.name).localeCompare(String(b.p.name), 'he'));
  return out.slice(0, limit);
}
// ---------- כמות בשורה ----------
const NUMW = { 'אחד': 1, 'אחת': 1, 'שניים': 2, 'שנים': 2, 'שתיים': 2, 'שתים': 2, 'שני': 2, 'שתי': 2, 'זוג': 2, 'שלוש': 3, 'שלושה': 3, 'שלשה': 3, 'ארבע': 4, 'ארבעה': 4,
  'חמש': 5, 'חמישה': 5, 'חמשה': 5, 'שש': 6, 'שישה': 6, 'ששה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9, 'עשר': 10, 'עשרה': 10,
  'תריסר': 12, 'עשרימ': 20, 'שלושימ': 30, 'ארבעימ': 40, 'חמישימ': 50, 'מאה': 100, 'חצי': 0.5 };
const CT_W = new Set(['קרטונ', 'קרטונימ', 'קרט', 'קר', 'ארגז', 'ארגזימ']);
const PK_W = new Set(['מארז', 'מארזימ', 'חבילה', 'חבילות', 'חב', 'שרינק', 'שרינקימ']);
const U_W = new Set(['יח', 'יחידה', 'יחידות', 'יחי', 'פריטימ', 'פריט', 'פעמ']);
const MEAS = new Set(['גרמ', 'גר', 'ג', 'גרמימ', 'קג', 'קילו', 'ליטר', 'ל', 'ליטרימ', 'מל', 'סמ', 'ממ', 'מטר', 'מ', 'אינצ', 'וואט', 'w', 'ml', 'g', 'kg', 'l', 'cm', 'mm', 'מגה', 'גיגה', 'v', 'mah', 'אחוז']);
const MUL = new Set(['x', '×', '*', 'כפול']);
// qtyOf(line) → { name, qty: מספר | null, unit: 'ct' | 'pk' | 'u' | '' }. name – השורה בלי הכמות ומילות היחידה (כמו שנכתבה)
function qtyOf(line) {
  let s = String(line == null ? '' : line).replace(/^[\s\-–—•*·.\d]*?[).]\s+/, (m) => (/^\s*\d+[).]\s+$/.test(m) ? '' : m)) // מספור "1." / "2)" בתחילת שורה
    .replace(/^[\s\-–—•*·]+/, '').trim();
  s = s.replace(/(\d)\s*([x×*])(?=\s|$)/gi, '$1 $2').replace(/(^|\s)([x×*])\s*(\d)/gi, '$1$2 $3');
  const T = s.split(/\s+/).filter(Boolean);
  const nk = T.map((t) => norm(t).replace(/\s+/g, ''));
  const used = new Array(T.length).fill(false);
  let qty = null, unit = '';
  const numAt = (i) => {
    if (i < 0 || i >= T.length || used[i]) return null;
    const k = nk[i];
    if (/^\d+(\.\d+)?$/.test(k)) return parseFloat(k);
    if (Object.prototype.hasOwnProperty.call(NUMW, k)) return NUMW[k];
    const k2 = k.replace(/^ו/, ''); if (k2 !== k && Object.prototype.hasOwnProperty.call(NUMW, k2)) return NUMW[k2];
    return null;
  };
  const isMeas = (i) => i >= 0 && i < T.length && MEAS.has(nk[i]);
  const unitAt = (i) => (i < 0 || i >= T.length ? '' : CT_W.has(nk[i]) ? 'ct' : PK_W.has(nk[i]) ? 'pk' : U_W.has(nk[i]) ? 'u' : '');
  const take = (i, v) => { qty = v; used[i] = true; };
  // 1. מספר + מילת יחידה ("5 קרטונים", "קרטון 5" אחרי מילת היחידה), או סימן כפל ("x5", "5 x")
  for (let i = 0; i < T.length && qty == null; i++) {
    const u = unitAt(i);
    if (u) {
      const a = numAt(i - 1), b = numAt(i + 1);
      if (a != null && !isMeas(i - 1)) { take(i - 1, a); } else if (b != null && !isMeas(i + 2)) { take(i + 1, b); }
      if (qty != null || u !== 'u') { unit = u; used[i] = true; }
    } else if (MUL.has(nk[i]) || MUL.has(T[i])) {
      const b = numAt(i + 1), a = numAt(i - 1);
      if (b != null) { take(i + 1, b); used[i] = true; } else if (a != null) { take(i - 1, a); used[i] = true; }
    }
  }
  if (unit && qty == null) qty = 1; // "קרטון כוסות" – קרטון אחד
  // 2. מספר בתחילת השורה או בסוף, שאחריו אין יחידת מידה
  if (qty == null) {
    const a = numAt(0);
    if (a != null && T.length > 1 && !isMeas(1)) take(0, a);
    else { const e = T.length - 1, b = numAt(e); if (b != null && e > 0 && !isMeas(e + 1)) take(e, b); }
  }
  // מילת יחידה בלי מספר ("יח'") שנשארה בסוף – לא חלק מהשם
  for (let i = 0; i < T.length; i++) if (!used[i] && unitAt(i) && qty != null && (i === 0 || i === T.length - 1 || used[i - 1] || used[i + 1])) { used[i] = true; if (!unit) unit = unitAt(i); }
  const name = T.filter((t, i) => !used[i]).join(' ').replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, '').trim();
  return { name, qty, unit: qty == null ? '' : (unit || 'u') };
}
// מפתח השוואה מדויקת אחרי נרמול (לכינויים בשרת: "אותו שם")
const key = (s) => words(s).join(' ');

const api = { norm, words, stem, forms, lev, tokScore: (a, b) => tokScore(tok(norm(a)), tok(norm(b))), index, search, qtyOf, key, W };
// שרת (Node) – module.exports; דפדפן – window.ProdMatch. אותו קובץ בדיוק: app-source/www/prod-match.js
if (typeof module === 'object' && module.exports) module.exports = api; else root.ProdMatch = api;
})(typeof self !== 'undefined' ? self : this);
