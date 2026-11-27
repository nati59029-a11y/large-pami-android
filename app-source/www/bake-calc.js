// עלות מוצרי אפייה (docs/bakery-cost-plan.md, שלב ב', 26.11.2026). חישוב טהור – בלי Firestore ובלי DOM.
// דפדפן: window.BakeCalc (bake-cost.js). בדיקה: firebase/tests/bake-calc.unit.test.js (module.exports).
// כל הסכומים לפני מע"מ. רשומות (התוכן של j באוסף b/{bizId}/bake):
//   פריט קנייה (t:'i'): {n שם, sup מזהה ספק, sn שם הספק, k 'bake'|'pack', u 'u' יחידות | 'g' גרם, pq כמות באריזה, yq כמות בפועל (תפוקה; ריק = pq),
//                        p מחיר אריזה, d תאריך המחיר, c רכיב מקושר, h היסטוריית מחירים [{p,d,at,by}] (עד 50), off הסתרה}
//   רכיב (t:'c'): {n, u, off}
//   מוצר (t:'p'): {n, sp מחיר מכירה, L שורות רכיבים [{c,q,pin}], K שורות אריזה [{c,q,pin}], off}
// עלות ליחידה של פריט = p ÷ yq. עלות רכיב = הקנייה האחרונה (לפי תאריך המחיר, ואז זמן העדכון) מבין הפריטים הפעילים שמקושרים אליו
// באותה יחידה, או הפריט שנקבע בשורה (pin – "קבע ספק"). רווח = מחיר מכירה − (מוצר + אריזה). שולי רווח % = רווח ÷ מחיר מכירה × 100.
(function (root) {
'use strict';
const H_MAX = 50, L_MAX = 60, N_MAX = 80, BIG = 1e7;
const ID = /^[A-Za-z0-9_-]{1,40}$/, DATE = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// מספר מהמסך (גם עם פסיק עשרוני). ריק / לא מספר / שלילי / ענק = null
function num(v) {
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(x) && x >= 0 && x < BIG ? x : null;
}
const pos = (v) => { const x = num(v); return x != null && x > 0 ? x : null; };
const str = (v, m) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, m || N_MAX);
const idv = (v) => (typeof v === 'string' && ID.test(v) ? v : '');
const unit = (u) => (u === 'g' ? 'g' : 'u');
const kind = (k) => (k === 'pack' ? 'pack' : 'bake');
const atv = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

// סוגי ספק (bt בכרטיס הספק): 'bake' / 'pack' / 'reg'. אין שדה = ['reg'] (הסוג לא נקבע אף פעם)
const BT = ['bake', 'pack', 'reg'];
function supTypes(s) {
  const b = s && Array.isArray(s.bt) ? BT.filter((k) => s.bt.includes(k)) : null;
  return b && b.length ? b : ['reg'];
}
// ספק שלא נכנס לתמחור חשבוניות: כבוי ידנית (prOff), או – כשהתוספת דלוקה – יש לו סוג ואין בו 'reg'
function supNoPr(s, bakeOn) {
  if (!s) return false;
  if (s.prOff) return true;
  return !!bakeOn && Array.isArray(s.bt) && s.bt.length > 0 && !s.bt.includes('reg');
}
// ספק שאפשר לבחור בפריט קנייה: יש לו אפייה או אריזה
const supBake = (s) => { const t = supTypes(s); return t.includes('bake') || t.includes('pack'); };
// סוג הפריט לפי הספק: אחד מהשניים → אוטומטי; שניהם → null (המשתמש בוחר)
function kindsOf(s) { const t = supTypes(s).filter((k) => k !== 'reg'); return t; }

// ---- היסטוריית מחירים ----
function normH(h) {
  if (!Array.isArray(h)) return [];
  const o = [];
  for (const e of h) {
    if (!e || typeof e !== 'object') continue;
    const p = num(e.p); if (p == null || !DATE.test(String(e.d || ''))) continue;
    const x = { p, d: e.d, at: atv(e.at) }; if (idv(e.by)) x.by = e.by;
    if (pos(e.pq)) x.pq = pos(e.pq); if (pos(e.yq)) x.yq = pos(e.yq);
    o.push(x);
  }
  return o;
}
const hKey = (e) => e.d + '|' + e.p + '|' + e.at;
const hCmp = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.at - b.at);
// מיזוג שתי היסטוריות (התנגשות בין מכשירים): כל רשומה נשמרת פעם אחת, מהישן לחדש, 50 האחרונות
function mergeH(a, b) {
  const m = new Map();
  for (const e of normH(a).concat(normH(b))) if (!m.has(hKey(e))) m.set(hKey(e), e);
  return [...m.values()].sort(hCmp).slice(-H_MAX);
}
const last = (h) => (h.length ? h[h.length - 1] : null);
// מחיר נוכחי = הרשומה עם התאריך המאוחר (ואז זמן העדכון)
function withCur(it) {
  const h = mergeH(it.h, []); const c = last(h);
  const o = Object.assign({}, it, { h });
  if (c) { o.p = c.p; o.d = c.d; if (c.pq) o.pq = c.pq; if (c.yq) o.yq = c.yq; }
  return o;
}
// עדכון מחיר: נוספת רשומה להיסטוריה, והמחיר הנוכחי מחושב מחדש (מחיר עם תאריך ישן יותר לא דורס מחיר חדש יותר)
function addPrice(it, e) {
  return withCur(Object.assign({}, it, { h: mergeH(it && it.h, [e]) }));
}

// ---- ניקוי רשומות (התוכן בענן לא מאומת בחוקים – מפענחים בזהירות) ----
function normItem(o) {
  if (!o || typeof o !== 'object') return null;
  const n = str(o.n); if (!n) return null;
  const it = { n, sup: idv(o.sup), sn: str(o.sn, 60), k: kind(o.k), u: unit(o.u), pq: pos(o.pq) || 1, yq: pos(o.yq), p: num(o.p), d: DATE.test(String(o.d || '')) ? o.d : '', c: idv(o.c), h: normH(o.h).slice(-H_MAX) };
  if (!it.yq) it.yq = it.pq;
  if (o.off) it.off = 1;
  return it.h.length ? withCur(it) : it;
}
function normComp(o) {
  if (!o || typeof o !== 'object') return null;
  const n = str(o.n); if (!n) return null;
  const c = { n, u: unit(o.u) }; if (o.off) c.off = 1; return c;
}
function normLines(L) {
  if (!Array.isArray(L)) return [];
  const o = [];
  for (const l of L.slice(0, L_MAX)) { if (!l || !idv(l.c)) continue; const q = pos(l.q); if (!q) continue; const x = { c: l.c, q }; if (idv(l.pin)) x.pin = l.pin; o.push(x); }
  return o;
}
function normProd(o) {
  if (!o || typeof o !== 'object') return null;
  const n = str(o.n); if (!n) return null;
  const p = { n, sp: num(o.sp), L: normLines(o.L), K: normLines(o.K) }; if (o.off) p.off = 1; return p;
}
const NORM = { i: normItem, c: normComp, p: normProd };
// פענוח j של מסמך. לא תקין → null (מדלגים בתצוגה, לא מוחקים)
function parse(t, j) {
  if (!NORM[t] || typeof j !== 'string' || j.length < 2 || j.length > 16000) return null;
  try { return NORM[t](JSON.parse(j)); } catch (e) { return null; }
}

// ---- חישוב ----
// עלות ליחידה (גרם / יחידה) של פריט קנייה
function unitCost(it) {
  if (!it) return null; const p = num(it.p), y = pos(it.yq) || pos(it.pq);
  return p == null || !y ? null : p / y;
}
const newer = (a, b) => (a.d !== b.d ? a.d > b.d : (a.at || 0) > (b.at || 0));
// עלות רכיב: items = [{id, o (פריט מנוקה), at}]. pin – פריט שנקבע בשורה. מחזיר {uc, it (הרשומה), pinned, why}
function compCost(cid, comp, items, pin) {
  const u = comp ? comp.u : null;
  const ok = (r) => r && r.o && r.o.c === cid && unitCost(r.o) != null && (!u || r.o.u === u);
  if (pin) {
    const r = items.find((x) => x.id === pin);
    if (ok(r)) return { uc: unitCost(r.o), it: r, pinned: true };
  }
  let best = null;
  for (const r of items) if (ok(r) && !r.o.off && (!best || newer({ d: r.o.d, at: r.at }, { d: best.o.d, at: best.at }))) best = r;
  if (!best) return { uc: null, it: null, pinned: false, why: comp ? 'אין פריט קנייה עם מחיר' : 'הרכיב לא נמצא' };
  return { uc: unitCost(best.o), it: best, pinned: false, why: pin ? 'הספק שנקבע לא זמין – לפי הקנייה האחרונה' : '' };
}
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
// עלות מוצר: comps = Map/אובייקט id → רכיב מנוקה; items – כמו ב-compCost
function prodCost(p, comps, items) {
  const get = (id) => (comps instanceof Map ? comps.get(id) : comps[id]) || null;
  const line = (l) => {
    const c = get(l.c), r = compCost(l.c, c, items, l.pin);
    return { c: l.c, n: c ? c.n : '', u: c ? c.u : 'u', q: l.q, pin: l.pin || '', uc: r.uc, cost: r.uc == null ? null : r.uc * l.q,
      src: r.it ? { id: r.it.id, n: r.it.o.n, sn: r.it.o.sn, d: r.it.o.d } : null, pinned: r.pinned, why: r.why || '' };
  };
  const L = (p.L || []).map(line), K = (p.K || []).map(line);
  const tot = (a) => a.reduce((s, x) => s + (x.cost || 0), 0);
  const prod = tot(L), pack = tot(K), total = prod + pack, sp = num(p.sp);
  const profit = sp == null ? null : sp - total;
  return { L, K, prod: r2(prod), pack: r2(pack), total: r2(total), sp, profit: profit == null ? null : r2(profit),
    margin: sp ? Math.round((profit / sp) * 1000) / 10 : null, miss: L.concat(K).filter((x) => x.cost == null).length };
}

// ---- התנגשות (ה2): local/remote = {o, at}. פריט קנייה: היסטוריית המחירים תמיד ממוזגת; שאר השדות – at המאוחר גובר.
//      רכיב / מוצר: at המאוחר גובר. lost = השינוי המקומי (לא מחיר) הפסיד מול עריכה מאוחרת יותר; same = התוצאה זהה לענן ----
// השדות של עדכון מחיר (מחיר, תאריך, כמות באריזה ותפוקה) נשמרים בהיסטוריה וממוזגים – לא נחשבים "עריכה אחרת"
const strip = (o) => { const x = Object.assign({}, o); delete x.h; delete x.p; delete x.d; delete x.pq; delete x.yq; return JSON.stringify(x); };
function resolve(t, local, remote, priceOnly) {
  // עדכון מחיר בלבד (priceOnly) בפריט קנייה: שאר השדות תמיד מהענן, וההיסטוריה ממוזגת – אף צד לא מפסיד
  const po = t === 'i' && !!priceOnly, lw = !po && (local.at || 0) >= (remote.at || 0);
  let o;
  if (t === 'i') o = withCur(Object.assign({}, lw ? local.o : remote.o, { h: mergeH(local.o.h, remote.o.h) }));
  else o = lw ? local.o : remote.o;
  const lost = !po && !lw && (t === 'i' ? strip(local.o) !== strip(remote.o) : JSON.stringify(local.o) !== JSON.stringify(remote.o));
  return { o, at: Math.max(local.at || 0, remote.at || 0), lost, same: JSON.stringify(o) === JSON.stringify(remote.o) };
}

const api = { num, pos, str, supTypes, supNoPr, supBake, kindsOf, normH, mergeH, addPrice, withCur, normItem, normComp, normProd, parse, unitCost, compCost, prodCost, resolve, H_MAX, L_MAX, BT };
if (typeof module === 'object' && module.exports) module.exports = api; else root.BakeCalc = api;
})(typeof self !== 'undefined' ? self : this);
