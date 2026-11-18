// חוסרים (שלב 1, 18.11.2026) – פונקציות טהורות, בלי Firestore ובלי מסך. נטען לפני hs.js; בדיקות: firebase/tests/hs-core.unit.test.js.
// חוזה הנתונים (hsr/{id}): n שם (1..80), nk מפתח מנורמל, gen פריט כללי, sups/supN מזהי ושמות ספקים (עד 10), why store|order|both,
//   q כמות (רשות, >0 עד 100000), cust {nm, ph, cid?} (רשות), ord {id, no} (רשות), np 0/1 (יש תמונה), st open|arr|del,
//   by/byN/t – מי הוסיף ומתי, ub/ut – עדכון אחרון, h – היסטוריה (עד 30).
(function (root) {
'use strict';
const WHY = ['store', 'order', 'both'];
const WHY_L = { store: 'לחנות', order: 'להזמנה', both: 'לחנות ולהזמנה' };
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAXN = 80, MAXS = 10, MAXH = 30, MAXQ = 100000;
const clean = (v, m) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, m || 1000);
const digits = (p) => String(p == null ? '' : p).replace(/\D/g, '');
// טלפון ישראלי (05x / 0x / 972…) → פורמט בינלאומי ל-wa.me; אחר – הספרות כמו שהן
const intl = (p) => { const d = digits(p); return /^0\d{8,9}$/.test(d) ? '972' + d.slice(1) : d; };
const phOk = (p) => { const d = digits(p); return /^0\d{8,9}$/.test(d) || /^972\d{8,9}$/.test(d); };
const keyOf = (n, PM) => { try { if (PM && typeof PM.key === 'function') return PM.key(n); } catch (e) { /* */ } return clean(n).toLowerCase(); };
// מזהה מסמך יציב לשם ספק חופשי (ספק מ"להזמין מספקים" שאין לו מזהה) – לשמירת הטלפון שלו
const nameId = (s) => { const k = clean(s).toLowerCase(); let h = 5381; for (let i = 0; i < k.length; i++) h = ((h * 33) ^ k.charCodeAt(i)) >>> 0; return 'x' + h.toString(36); };
const fmtQ = (q) => (typeof q === 'number' && isFinite(q) ? String(Math.round(q * 1000) / 1000) : '');

// build(x, PM) → { ok: true, d } | { ok: false, err }. x – מה שהמשתמש מילא. d – השדות לשמירה (בלי by/t/st – אלה נקבעים בשמירה)
function build(x, PM) {
  x = x || {};
  const n = clean(x.n, 1000);
  if (!n) return { ok: false, err: 'כתבו שם מוצר' };
  if (n.length > MAXN) return { ok: false, err: 'שם המוצר ארוך מדי (עד ' + MAXN + ' תווים)' };
  const ids = [], names = [];
  (Array.isArray(x.sups) ? x.sups : []).forEach((s) => {
    const id = s && typeof s === 'object' ? s.id : s, nm = s && typeof s === 'object' ? s.name : '';
    if (typeof id === 'string' && ID.test(id) && !ids.includes(id)) { ids.push(id); names.push(clean(nm, 60)); }
  });
  if (ids.length > MAXS) return { ok: false, err: 'אפשר עד ' + MAXS + ' ספקים למוצר' };
  const gen = !!x.gen || !ids.length; // לא נבחר ספק = פריט כללי (מופיע לכל הספקים)
  const why = WHY.includes(x.why) ? x.why : '';
  if (!why) return { ok: false, err: 'בחרו מטרה: לחנות, להזמנה או שניהם' };
  const d = { n, nk: keyOf(n, PM).slice(0, 200), gen, sups: gen ? [] : ids, supN: gen ? [] : names, why };
  const qs = String(x.q == null ? '' : x.q).trim().replace(',', '.');
  if (qs !== '') {
    const q = Number(qs);
    if (!isFinite(q) || q <= 0 || q > MAXQ) return { ok: false, err: 'כמות לא תקינה (מספר חיובי עד ' + MAXQ + ')' };
    d.q = Math.round(q * 1000) / 1000;
  }
  const c = x.cust && typeof x.cust === 'object' ? x.cust : null;
  if (c && (clean(c.nm) || digits(c.ph))) {
    const nm = clean(c.nm, 60), ph = digits(c.ph);
    if (ph && !phOk(ph)) return { ok: false, err: 'טלפון הלקוח לא תקין' };
    if (!nm && !ph) return { ok: false, err: 'פרטי לקוח חסרים' };
    d.cust = { nm, ph };
    if (typeof c.cid === 'string' && ID.test(c.cid)) d.cust.cid = c.cid;
  }
  const o = x.ord && typeof x.ord === 'object' ? x.ord : null;
  if (o && typeof o.id === 'string' && ID.test(o.id)) d.ord = { id: o.id, no: Number.isInteger(+o.no) ? +o.no : 0 };
  return { ok: true, d };
}
// היסטוריה: מוסיף רשומה ושומר רק את 30 האחרונות
function hAdd(h, e) { const a = (Array.isArray(h) ? h : []).concat([e]); return a.slice(-MAXH); }

// forSup(items, supId) → הפריטים הפתוחים של הספק: המשויכים אליו ואחריהם כל הפריטים הכלליים (all: true = "מופיע לכל הספקים")
function forSup(items, supId) {
  const L = (Array.isArray(items) ? items : []).filter((x) => x && x.st === 'open');
  if (!ID.test(String(supId || ''))) return [];
  const own = L.filter((x) => !x.gen && Array.isArray(x.sups) && x.sups.includes(supId)).map((it) => ({ it, all: false }));
  const gen = L.filter((x) => x.gen).map((it) => ({ it, all: true }));
  return own.concat(gen);
}
// groups(items, sups, so, PM) → קבוצות לתצוגה לפי ספק. sups: [{id,name}] (ספקי העסק), so: שורות "להזמין מספקים" ({sup (שם), …}).
// ספק מופיע אם יש לו פריט משויך או שורה מ"להזמין מספקים". שורת so משויכת לספק לפי שם מנורמל; אחרת – קבוצה משלה (id לפי השם).
// כל קבוצה: { id, name, known, L: [{it, all}], O: [שורות so] }. הפריטים הכלליים בכל קבוצה (L עם all).
function groups(items, sups, so, PM) {
  const S = (Array.isArray(sups) ? sups : []).filter((s) => s && ID.test(String(s.id || '')));
  const byKey = new Map(S.map((s) => [keyOf(s.name, PM), s]));
  const G = new Map();
  const get = (id, name, known) => { if (!G.has(id)) G.set(id, { id, name, known, L: [], O: [] }); return G.get(id); };
  const open = (Array.isArray(items) ? items : []).filter((x) => x && x.st === 'open');
  // מזהה ספק מהענן נכנס לנתיב (hsph/{id}) – רק מזהה בתבנית מותרת
  open.forEach((x) => { if (x.gen || !Array.isArray(x.sups)) return; x.sups.forEach((id, i) => { if (typeof id !== 'string' || !ID.test(id)) return; const s = S.find((y) => y.id === id); get(id, s ? s.name : clean((x.supN || [])[i], 60) || id, !!s); }); });
  (Array.isArray(so) ? so : []).forEach((r) => { const nm = clean(r && r.sup, 60); if (!nm) return; const s = byKey.get(keyOf(nm, PM)); (s ? get(s.id, s.name, true) : get(nameId(nm), nm, false)).O.push(r); });
  const out = [...G.values()];
  out.forEach((g) => { g.L = forSup(open, g.id); });
  return out.filter((g) => ID.test(g.id)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
}

// הצעת ספקים לשם מוצר. ctx: { idx: אינדקס של xIndex (שמות מוצרים מחשבוניות), items: פריטי חוסרים קיימים (כל מצב),
//   prods: מוצרי הקטלוג [{name, sup}], sups: [{id,name}] }. מחזיר עד 5: [{ id, name, src: 'prev'|'inv'|'cat', s }]
const MIN = 0.7;
function xIndex(hsx, PM) {
  const P = [];
  (Array.isArray(hsx) ? hsx : []).forEach((d) => { if (!d || !ID.test(String(d.id || ''))) return; (Array.isArray(d.it) ? d.it : []).forEach((k, i) => { if (typeof k === 'string' && k) P.push({ id: d.id + '#' + i, name: k, sup: d.id }); }); });
  return PM && P.length ? PM.index(P) : null;
}
// אינדקס של מוצרי הקטלוג (prod.sup = שם ספק חופשי) – רק מוצרים שהספק שלהם הוא אחד מספקי העסק (לפי שם מנורמל)
function catIndex(prods, sups, PM) {
  if (!PM || !Array.isArray(prods) || !prods.length) return null;
  const byKey = new Map((Array.isArray(sups) ? sups : []).filter((s) => s && ID.test(String(s.id || ''))).map((s) => [keyOf(s.name, PM), s.id]));
  const P = prods.filter((p) => p && p.name && typeof p.sup === 'string' && byKey.has(keyOf(p.sup, PM))).map((p, i) => ({ id: 'c' + i, name: p.name, al: p.al, sup: byKey.get(keyOf(p.sup, PM)) }));
  return P.length ? PM.index(P) : null;
}
function suggest(name, ctx, PM) {
  const n = clean(name, 200); if (n.length < 2) return [];
  ctx = ctx || {};
  const S = (Array.isArray(ctx.sups) ? ctx.sups : []).filter((s) => s && ID.test(String(s.id || '')));
  const nameOf = (id) => { const s = S.find((y) => y.id === id); return s ? s.name : ''; };
  const R = new Map();
  const put = (id, src, s) => { const nm = nameOf(id); if (!nm) return; const r = R.get(id); if (!r || s > r.s) R.set(id, { id, name: nm, src, s }); };
  const nk = keyOf(n, PM);
  (Array.isArray(ctx.items) ? ctx.items : []).forEach((x) => { if (x && !x.gen && x.nk === nk && Array.isArray(x.sups)) x.sups.forEach((id) => { if (typeof id === 'string' && ID.test(id)) put(id, 'prev', 3); }); });
  if (PM && ctx.idx) PM.search(ctx.idx, n, { limit: 40, min: MIN }).forEach((h) => put(h.p.sup, 'inv', h.s));
  const cidx = ctx.cidx || (Array.isArray(ctx.prods) ? catIndex(ctx.prods, S, PM) : null);
  if (PM && cidx) PM.search(cidx, n, { limit: 20, min: MIN }).forEach((h) => put(h.p.sup, 'cat', h.s));
  return [...R.values()].sort((a, b) => b.s - a.s || String(a.name).localeCompare(String(b.name), 'he')).slice(0, 5);
}

// הודעת וואטסאפ לספק: הפריטים שלו, הכלליים ושורות "להזמין מספקים" – שם וכמות בלבד (בלי פרטי לקוחות)
function waText(g, biz) {
  const L = [];
  (g && g.L || []).forEach((r) => L.push('• ' + r.it.n + (r.it.q ? ' – כמות ' + fmtQ(r.it.q) : '')));
  (g && g.O || []).forEach((r) => L.push('• ' + clean(r.n, 120) + (typeof r.qty === 'number' ? ' – כמות ' + fmtQ(r.qty) : '')));
  return 'שלום' + (g && g.name ? ' ' + g.name : '') + ',\n' + (biz ? 'מ' + biz + '. ' : '') + 'אנחנו צריכים:\n' + L.join('\n') + '\nתודה!';
}
// הודעה ללקוח שהמוצר הגיע
function custText(it, biz) {
  const nm = it && it.cust && it.cust.nm ? ' ' + it.cust.nm : '';
  return 'שלום' + nm + ',\nהמוצר "' + (it && it.n || '') + '" שביקשת הגיע' + (biz ? ' ל' + biz : ' לחנות') + '.\nאפשר לבוא לאסוף. תודה!';
}

// ---------- שלב 2: הורדה אוטומטית בקליטת חשבונית ספק ----------
// matchInv(items, inv, PM) → [{ id, it, k: 'inv' (הגיע כולו) | 'part' (חלקי, נשאר ההפרש), got, q0?, q?, ln: [שמות השורות] }]
// inv: { id ('i'+בקשה), sup, supId?, inv, at? (מ"ש), lines: [{ n, qty }] }. סף מחמיר – עדיף לפספס מאשר להוריד בטעות:
//  • רק פריט פתוח, שנוסף לפני החשבונית (t ≤ at), שלא טופל כבר באותה חשבונית (h עם pinv), ושספק החשבונית הוא אחד מספקיו
//    (לפי supId; אין supId – לפי שם מנורמל) או פריט כללי.
//  • כל מילה בשם הפריט נמצאת בשורה: זהה, אותה צורה (יחיד/רבים) או אותו שלד (כתיב מלא/חסר); מספרים – רק זהים; בלי קידומת.
//    לפחות מילה אחת (לא מספר) זהה בדיוק – "חלב" לא יורד מ"חלבה".
//  • שורה שמתאימה לכמה פריטים נזקפת רק לפריט/ים הספציפי ביותר (הכי הרבה ממילות השורה).
//  • פריט (בכל מצב) שכבר טופל באותה חשבונית "תופס" את השורות שלו: שורה שהוא בין המתאימים ביותר לה לא נזקפת לאף פריט אחר –
//    כך עיבוד חוזר (במכשיר אחר / אחרי ביטול) לא מוריד פריט כללי יותר במקום פריט שכבר ירד. לכן כדאי להעביר גם פריטים שהגיעו.
//  • כמות: פריט בלי כמות – יורד כולו. עם כמות – סכום הכמויות בשורות; פחות מהנדרש = חלקי; אין כמות ידועה בשורות – לא יורד.
const r3 = (v) => Math.round(v * 1000) / 1000;
function wScore(PM, a, b) { try { return PM.tokScore(a, b); } catch (e) { return 0; } }
const isNum = (t) => /^\d+(\.\d+)?$/.test(t);
// ציון שם פריט מול שורה: null אם לא מתאים; אחרת { c: חלק ממילות השורה שכוסו, s: ממוצע ציוני המילים }
function lineFit(PM, iw, lw) {
  if (!iw.length || !lw.length) return null;
  let ex = 0, sum = 0; const used = new Set();
  for (const a of iw) {
    let b = 0, bi = -1;
    lw.forEach((w, i) => { const s = a === w ? 1 : wScore(PM, a, w); if (s > b) { b = s; bi = i; } });
    const ok = b >= 0.95 || (b >= 0.85 && b < 0.9); // זהה / צורה / שלד – לא קידומת (0.9) ולא מרחק עריכה
    if (!ok) return null;
    if (b === 1 && !isNum(a)) ex++;
    sum += b; used.add(bi);
  }
  if (!ex) return null;
  return { c: used.size / lw.length, s: sum / iw.length };
}
function matchInv(items, inv, PM) {
  if (!PM || typeof PM.words !== 'function' || typeof PM.tokScore !== 'function') return [];
  inv = inv || {};
  const pid = String(inv.id || ''); if (!ID.test(pid)) return [];
  const sid = typeof inv.supId === 'string' && ID.test(inv.supId) ? inv.supId : '';
  const sk = clean(inv.sup, 60) ? keyOf(clean(inv.sup, 60), PM) : '';
  const at = typeof inv.at === 'number' && isFinite(inv.at) ? inv.at : Date.now();
  const lines = (Array.isArray(inv.lines) ? inv.lines : []).slice(0, 200).map((l) => ({ n: clean(l && l.n, 300), qty: l && typeof l.qty === 'number' && isFinite(l.qty) && l.qty > 0 ? l.qty : 0 }))
    .map((l) => Object.assign(l, { w: [...new Set(PM.words(l.n))] })).filter((l) => l.w.length);
  if (!lines.length) return [];
  const supOk = (x) => x.gen || (Array.isArray(x.sups) && (sid ? x.sups.includes(sid) : !!sk && (Array.isArray(x.supN) ? x.supN : []).some((n) => clean(n) && keyOf(clean(n, 60), PM) === sk)));
  const done = (x) => Array.isArray(x.h) && x.h.some((e) => e && e.pinv === pid);
  const C = (Array.isArray(items) ? items : []).filter((x) => x && typeof x.id === 'string' && ID.test(x.id) && typeof x.n === 'string'
    && (done(x) || (x.st === 'open' && typeof x.t === 'number' && x.t <= at && supOk(x))))
    .map((x) => ({ x, w: [...new Set(PM.words(x.n))], cl: done(x) })).filter((c) => c.w.some((t) => !isNum(t)));
  if (!C.some((c) => !c.cl)) return [];
  const got = new Map(); // id → { q, unk, ln }
  lines.forEach((l) => {
    let best = null, B = [];
    C.forEach((c) => { const f = lineFit(PM, c.w, l.w); if (!f) return;
      const cmp = best ? (f.c - best.c) || (f.s - best.s) : 1;
      if (cmp > 1e-9) { best = f; B = [c]; } else if (Math.abs(cmp) <= 1e-9) B.push(c); });
    if (B.some((c) => c.cl)) return; // השורה כבר נזקפה בעבר באותה חשבונית
    B.forEach((c) => { const g = got.get(c.x.id) || { q: 0, unk: 0, ln: [] }; if (l.qty) g.q += l.qty; else g.unk++; if (g.ln.length < 5) g.ln.push(l.n); got.set(c.x.id, g); });
  });
  const out = [];
  C.forEach(({ x, cl }) => { const g = got.get(x.id); if (!g || cl) return;
    const base = { id: x.id, it: x, got: r3(g.q), ln: g.ln };
    if (!(typeof x.q === 'number' && x.q > 0)) { out.push(Object.assign(base, { k: 'inv' })); return; }
    if (!(g.q > 0)) return; // יש כמות נדרשת ואין כמות ידועה בחשבונית – לא מורידים
    const nq = r3(x.q - g.q);
    if (nq <= 0) out.push(Object.assign(base, { k: 'inv' }));
    else if (nq < x.q) out.push(Object.assign(base, { k: 'part', q0: x.q, q: nq }));
  });
  return out;
}
// רשומת היסטוריה להורדה מחשבונית (החוזה בכללים): { k: 'inv'|'part', t, byN, u, pinv, inv, sup, q0?, q? }
function invEntry(r, inv, t, byN, u) {
  const e = { k: r.k, t, byN, u, pinv: String(inv && inv.id || ''), inv: clean(inv && inv.inv, 30), sup: clean(inv && inv.sup, 60) };
  if (r.k === 'part') { e.q0 = r.q0; e.q = r.q; }
  return e;
}
// ביטול הגעה חלקית: רק אם הרשומה האחרונה היא 'part' והכמות עדיין כמו שהשאירה. מחזיר את הכמות לשחזור, או null
function unpartQ(x) {
  const h = x && Array.isArray(x.h) ? x.h : [], e = h[h.length - 1];
  return x && x.st === 'open' && e && e.k === 'part' && typeof e.q0 === 'number' && e.q === x.q ? e.q0 : null;
}

const api = { ID, WHY, WHY_L, MAXN, MAXS, MAXH, build, hAdd, forSup, groups, xIndex, catIndex, suggest, waText, custText, intl, phOk, nameId, keyOf, fmtQ, matchInv, invEntry, unpartQ };
if (typeof module === 'object' && module.exports) module.exports = api; else root.HsCore = api;
})(typeof self !== 'undefined' ? self : this);
