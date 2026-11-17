/* POS:M3 – קופה, גל 2 (ש3): קטלוג וחיפוש מהיר במוצרים (5,000+). פונקציות טהורות, בלי Firestore ובלי DOM.
   אותו קובץ בדיוק בדפדפן (window.PosCatalog) ובבדיקות Node (module.exports) – firebase/tests/pos-catalog.unit.test.js.

   build(products) → קטלוג. מוצר: { id, name, barcode?, sku?, al?: [כינויים], price (אגורות) }. מוצר בלי id או בלי שם – לא נכנס.
   cat.search(q, limit=50) → [מוצר]   (הסדר: ברקוד/מק"ט מדויק ← ברקוד/מק"ט חלקי ← שם/כינוי לפי ציון ← שם)
   cat.byCode(code)        → מוצר או null (ברקוד או מק"ט מדויק)
   cat.explain(q, limit)   → [{ p, s (ציון), k: 'bc'|'sku'|'bc~'|'sku~'|'name'|'al', n (השם שהתאים) }]  – לבדיקות ולתצוגת "נמצא לפי כינוי"
   norm(s)                 → נרמול עברית (כמו prod-match: בלי ניקוד וגרשיים, סופיות → רגילות, ספרות נפרדות מאותיות)

   סלחני לשגיאות: לכל מילה בחיפוש – זהה (1) / צורה בלי ריבוי (0.95) / תחילת מילה (0.9) / שלד בלי ו,י (0.85) /
     מרחק עריכה (מילה של 4–7 אותיות: שגיאה אחת, 8+: שתיים; 0.8 פחות 0.1 לשגיאה) / מוכל בתוך מילה (3+ אותיות, 0.7).
   ציון מוצר = ממוצע המילים (כל מילה – ההתאמה הטובה ביותר בשם או בכינוי אחד). קודם מוצרים שכל המילים נמצאו בהם,
     ורק אם חסר – גם מוצרים שחסרה בהם מילה אחת (מתוך 3+ מילים).
   ברקוד חלקי: 3+ ספרות – סוף הברקוד קודם (קופאי מקליד את הספרות האחרונות), אחר כך תחילתו, אחר כך באמצע.
   מהירות: אוצר המילים (כל מילה שונה בקטלוג) נבדק פעם אחת לכל מילת חיפוש, ומשם אינדקס הפוך – מילה → מוצרים.
     תוצאה של מילה נשמרת (מטמון) – הקלדה אות אחרי אות לא מחשבת מחדש את מה שכבר חושב. */
(function (root) {
'use strict';
const FIN = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const HEB = /[א-ת]/;
function norm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[֑-ׇ]/g, (c) => (c === '־' ? ' ' : ''))
    .replace(/["'`׳״‘’“”„]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FIN[c])
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\.(?!\d)|(?<!\d)\./g, ' ')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2').replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/\s+/g, ' ').trim();
}
const words = (s) => { const n = norm(s); return n ? n.split(' ') : []; };
const isNum = (t) => /^\d+(\.\d+)?$/.test(t);
const digits = (s) => String(s == null ? '' : s).replace(/[\s-]/g, '').toLowerCase();
function stem(t) {
  if (!HEB.test(t)) return t;
  if (t.length >= 5 && /(ימ|ות)$/.test(t)) return t.slice(0, -2);
  if (t.length >= 4 && /[הת]$/.test(t)) return t.slice(0, -1);
  if (t.length >= 3 && /א$/.test(t)) return t.slice(0, -1);
  return t;
}
const skel = (t) => (HEB.test(t) && t.length >= 4 ? t[0] + t.slice(1).replace(/[וי]/g, '') : t);
const editMax = (n) => (n < 4 ? 0 : n < 8 ? 1 : 2);
// מרחק עריכה עם החלפת שתי אותיות סמוכות כשגיאה אחת ("חלב" ↔ "חבל"). מעל התקרה (max) – מחזיר max+1
function lev(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let pp = null, prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let lo = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (pp && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
      cur[j] = v; if (v < lo) lo = v;
    }
    if (lo > max) return max + 1;
    pp = prev; prev = cur;
  }
  return prev[b.length];
}
// ציון מילת חיפוש q מול מילה מהקטלוג w (שתיהן מנורמלות)
function score(q, w, qs, ws) {
  if (q === w) return 1;
  const qn = isNum(q), wn = isNum(w);
  if (qn || wn) return qn && wn && w.startsWith(q) && q.length >= 2 ? 0.6 : 0;
  if (qs.length >= 2 && qs === ws) return 0.95;
  if (w.startsWith(q)) return 0.9;
  if (q.length >= 3 && skel(qs) === skel(ws) && skel(qs).length >= 3) return 0.85;
  let best = 0;
  const m = editMax(q.length);
  if (m) {
    const d = Math.min(lev(q, w, m), lev(qs, ws, m), w.length > q.length ? lev(q, w.slice(0, q.length), m) + 0.5 : m + 1);
    if (d <= m) best = 0.8 - 0.1 * Math.ceil(d);
  }
  if (q.length >= 3 && w.includes(q)) best = Math.max(best, 0.7);
  // מילה קצרה (3 אותיות) – רק אותן אותיות בסדר אחר של שתיים סמוכות ("חבל" ↔ "חלב")
  if (!best && q.length === 3 && w.length === 3 && lev(q, w, 1) <= 1 && [...q].sort().join('') === [...w].sort().join('')) best = 0.6;
  return best;
}

function build(products) {
  const P = [], V = [], VS = [], vid = new Map(), post = [], bc = new Map(), sku = new Map(), codes = [];
  const put = (m, k, i) => { if (!m.has(k)) m.set(k, i); };
  for (const x of Array.isArray(products) ? products : []) {
    if (!x || x.id == null || !x.name) continue;
    const i = P.length, names = [], seen = new Set();
    const list = [[x.name, 'name']].concat((Array.isArray(x.al) ? x.al : []).map((a) => [a, 'al']));
    for (const [n, k] of list) {
      const ws = words(n), key = ws.join(' ');
      if (!ws.length || seen.has(key)) continue;
      seen.add(key);
      const ids = [];
      for (const w of ws) {
        let v = vid.get(w);
        if (v === undefined) { v = V.length; vid.set(w, v); V.push(w); VS.push(stem(w)); post.push([]); }
        if (!ids.includes(v)) ids.push(v);
        const pl = post[v]; if (pl[pl.length - 1] !== i) pl.push(i);
      }
      names.push({ k, n: String(n), ids });
    }
    if (!names.length) continue;
    P.push({ p: x, names, nm: norm(x.name) });
    const b = digits(x.barcode), s = digits(norm(x.sku));
    if (b) put(bc, b, i);
    if (s) put(sku, s, i);
    codes.push([b, s]);
  }
  const cache = new Map(); // מילת חיפוש → Map(מזהה מילה → ציון)
  function vocab(q) {
    let r = cache.get(q);
    if (r) return r;
    r = new Map();
    const qs = stem(q);
    // מטמון של הקידומת: כל מילה שמתאימה ל-"חלב" מתאימה גם ל-"חל" – אבל לא להפך, ולכן סורקים את כל אוצר המילים (מהיר: אלפי מילים)
    for (let v = 0; v < V.length; v++) { const s = score(q, V[v], qs, VS[v]); if (s > 0) r.set(v, s); }
    if (cache.size > 400) cache.clear();
    cache.set(q, r);
    return r;
  }
  function explain(q, limit) {
    limit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const raw = String(q == null ? '' : q).trim();
    if (!raw) return P.slice(0, limit).map((x) => ({ p: x.p, s: 0, k: 'name', n: x.p.name }));
    const R = new Map();
    const hit = (i, s, k, n) => { const r = R.get(i); if (!r || s > r.s) R.set(i, { i, s, k, n }); };
    const d = digits(raw);
    // בלי רווחים, או ברקוד שהוקלד עם רווחים / מקפים ("7290 0000 00015")
    if (!/\s/.test(raw) || /^[\d\s-]+$/.test(raw)) {
      if (bc.has(d)) hit(bc.get(d), 3, 'bc', raw);
      const ds = digits(norm(raw));
      if (sku.has(ds)) hit(sku.get(ds), 3, 'sku', raw);
      // ברקוד / מק"ט חלקי: 3+ תווים בלי רווח שיש בהם ספרה
      if (d.length >= 3 && /\d/.test(d)) {
        for (let i = 0; i < codes.length; i++) {
          const [b, s] = codes[i];
          if (b && b !== d) { const at = b.indexOf(d); if (at >= 0) hit(i, b.endsWith(d) ? 2.5 : at === 0 ? 2.4 : 2.2, 'bc~', b); }
          if (s && s !== d) { const at = s.indexOf(d); if (at >= 0) hit(i, at === 0 ? 2.45 : 2.2, 'sku~', s); }
        }
      }
    }
    const Q = [...new Set(words(raw))];
    if (Q.length) {
      const S = Q.map(vocab);
      // מועמדים: כל מוצר שיש בו לפחות מילה אחת שמתאימה (אינדקס הפוך)
      const cnt = new Map();
      S.forEach((m, qi) => { const seenP = new Set(); for (const v of m.keys()) for (const i of post[v]) if (!seenP.has(i)) { seenP.add(i); cnt.set(i, (cnt.get(i) || 0) + 1); } });
      const need = Q.length >= 3 ? Q.length - 1 : Q.length;
      for (const [i, c] of cnt) {
        if (c < need) continue;
        let best = 0, bk = 'name', bn = '';
        for (const nm of P[i].names) {
          let sum = 0, found = 0;
          for (const m of S) { let b = 0; for (const v of nm.ids) { const s = m.get(v); if (s > b) b = s; } sum += b; if (b > 0) found++; }
          if (found < need) continue;
          // מילים מלאות שהתאימו (חלק מהשם) – תוספת קטנה, כדי ששם קצר שמתאים כולו יעלה
          let cover = 0; for (const v of nm.ids) { for (const m of S) if ((m.get(v) || 0) >= 0.9) { cover++; break; } }
          const s = (sum / S.length) * (found === S.length ? 1 : 0.8) + 0.1 * (cover / nm.ids.length);
          if (s > best) { best = s; bk = nm.k; bn = nm.n; }
        }
        if (best >= 0.45) hit(i, best, bk, bn);
      }
    }
    const out = [...R.values()];
    out.sort((a, b) => (b.s - a.s) || (P[a.i].nm.length - P[b.i].nm.length) || (P[a.i].nm < P[b.i].nm ? -1 : 1));
    return out.slice(0, limit).map((r) => ({ p: P[r.i].p, s: Math.round(r.s * 1000) / 1000, k: r.k, n: r.n }));
  }
  return {
    size: P.length,
    all: () => P.map((x) => x.p),
    search: (q, limit) => explain(q, limit).map((r) => r.p),
    explain,
    byCode: (code) => { const d = digits(code); if (!d) return null; const i = bc.has(d) ? bc.get(d) : sku.has(digits(norm(code))) ? sku.get(digits(norm(code))) : -1; return i >= 0 ? P[i].p : null; },
  };
}

const api = { build, norm, words, lev: (a, b, m) => lev(a, b, m == null ? 2 : m), score: (q, w) => score(norm(q), norm(w), stem(norm(q)), stem(norm(w))) };
if (typeof module === 'object' && module.exports) module.exports = api;
if (root) root.PosCatalog = api;
})(typeof window !== 'undefined' ? window : null);
/* /POS:M3 */
