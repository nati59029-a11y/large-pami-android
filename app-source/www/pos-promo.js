// קופה (POS), גל 2 – ש2: מנוע מבצעים וקופונים. פונקציות טהורות (בלי Firestore), אותו קובץ בדיוק במכשיר ובשרת:
//   app-source/www/pos-promo.js ↔ firebase/functions/lib/pos-promo.js (בדיקה ב-pos-sale-promo.unit.test.js).
// הקופה מחשבת את העגלה עם PosPromo.apply, והשרת מחשב מחדש עם אותו קוד בדיוק (posSale) – לכן אותה תוצאה באגורה.
//
// סכומים באגורות, מספרים שלמים. עיגול – PosCalc.rnd (חצי כלפי מעלה). חלוקת הנחה בין שורות – PosCalc.spread.
// promo (אוסף promo, אפיון ב 4): { id, type, on, from?, to?, pids?[], cats?[], clubOnly?, custGrp?, maxPerCust?, prio? + שדות לפי הסוג }
//   'pct'      { pct }                    – אחוז הנחה על השורות שבתחום (pids / cats; בלי תחום = כל המוצרים). מבצע על קטגוריה = cats.
//   'amt'      { amt }                    – הנחה בסכום ליחידה (לא יותר ממחיר היחידה).
//   'fixed'    { price }                  – מחיר קבוע ליחידה.
//   'nForX'    { n, price }               – N יחידות (מתוך התחום, גם משורות שונות) במחיר price. היחידות היקרות קודם – הכי משתלם ללקוח.
//   'bxgy'     { buy[], get[], bn?, gn?, getPct? } – קנה bn מ-buy, קבל gn מ-get ב-getPct% הנחה (ברירת מחדל 1, 1, 100 = חינם). 1+1: buy = get.
//                                          היחידות הזולות מקבלות את ההנחה.
//   'bundle'   { pids[], need?{pid:n}, price } – חבילה: יחידה (או need) מכל מוצר במחיר אחד.
//   'basket'   { minAmt, pct | amt }      – הנחה על סכום הקנייה הכולל (אחרי מבצעי המוצרים), מתחלקת בין השורות.
//   'basketGift' { minAmt, giftPid }      – מתנה בקנייה מעל סכום: יחידה אחת של giftPid שבעגלה – חינם.
// פעיל רק אם on === true, והתאריך בטווח from–to ('YYYY-MM-DD' לפי שעון ישראל, או ms). clubOnly – רק עם ctx.club. custGrp – רק ל-ctx.grp זהה.
// maxPerCust – הגבלת יחידות במבצע לקונה, במכירה הזו (ההגבלה בין מכירות – בעתיד, עם המועדון).
//
// apply(lines, promos, ctx) → { lines:[{ pdisc, promo?, bp?, cpn? }], applied:[{ id, disc }], cpns:[{ code, disc, ok, why? }], gifts:[pid] }
//   lines: [{ pid?, cat?, qty, unit, noPromo? }] – unit באגורות לפני הנחה. noPromo – שורה בלי מבצעים (סכום חופשי, מבצע שבוטל ע"י אחראי).
//   ctx: { at (ms), club?, grp?, stack? ('best'|'both'|'first'|'worst' = promoStack), off?[] (מבצעים שבוטלו בעגלה),
//          cpns?[{ code, promo:{ type:'pct'|'amt', pct?, amt?, pids?, cats? } }], cpnStack?, cpnOnPromo? }
//   pdisc לשורה = הנחת מבצע מוצר + חלק ממבצע סכום כולל + קופון. לעולם לא יותר מ-base של השורה.
(function (root) {
'use strict';
const C = typeof module === 'object' && module.exports ? require('./pos-calc') : root.PosCalc;
const TYPES = ['pct', 'amt', 'fixed', 'nForX', 'bxgy', 'bundle', 'basket', 'basketGift'];
const ITEM = ['pct', 'amt', 'fixed', 'nForX', 'bxgy', 'bundle'];
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const dayOf = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

// בתחום התאריכים: מחרוזת 'YYYY-MM-DD' (כולל היום עצמו) או ms
function inDates(p, at) {
  const d = dayOf(at);
  const ok = (v, ge) => {
    if (v == null || v === '') return true;
    if (typeof v === 'string') return ge ? d >= v : d <= v;
    if (isNum(v)) return ge ? at >= v : at <= v;
    return false;
  };
  return ok(p.from, true) && ok(p.to, false);
}
function active(p, ctx) {
  if (!p || p.on !== true || !TYPES.includes(p.type)) return false;
  if (!inDates(p, ctx.at)) return false;
  if (p.clubOnly === true && !ctx.club) return false;
  if (p.custGrp && p.custGrp !== ctx.grp) return false;
  if (arr(ctx.off).includes(p.id)) return false;
  return true;
}
const scoped = (p, l) => {
  if (!l.pid || l.noPromo) return false;
  const pids = arr(p.pids), cats = arr(p.cats);
  if (!pids.length && !cats.length) return true;
  return pids.includes(l.pid) || (!!l.cat && cats.includes(l.cat));
};
const isUnits = (l) => isInt(l.qty) && l.qty > 0;
const base = (l) => C.rnd(l.unit * Math.round(l.qty * 1000) / 1000);
const maxU = (p) => (isInt(p.maxPerCust) && p.maxPerCust > 0 ? p.maxPerCust : Infinity);

// יחידות בודדות מהשורות שבתחום: [{ i (שורה), u (מחיר) }]. רק כמות שלמה. נחתך ב-maxPerCust (היקרות קודם)
function units(lines, pick, p) {
  const out = [];
  lines.forEach((l, i) => { if (pick(l) && isUnits(l)) for (let k = 0; k < l.qty; k++) out.push({ i, u: l.unit }); });
  out.sort((a, b) => b.u - a.u || a.i - b.i);
  return out.slice(0, maxU(p));
}
// סכום לכל שורה מתוך רשימת יחידות שקיבלו הנחה
function byLine(n, list) { const d = new Array(n).fill(0); for (const x of list) d[x.i] += x.d; return d; }
// הנחה כוללת שמתחלקת בין השורות לפי משקל (weights לפי שורה)
function spreadTo(n, total, w) { if (total <= 0) return new Array(n).fill(0); return C.spread(total, w); }

// הנחה לכל שורה ממבצע מוצר אחד (מערך באורך השורות; 0 = לא נוגע)
function evalItem(p, lines) {
  const n = lines.length, z = new Array(n).fill(0);
  const pick = (l) => scoped(p, l);
  switch (p.type) {
    case 'pct': case 'amt': case 'fixed': {
      let left = maxU(p);
      return lines.map((l) => {
        if (!pick(l) || left <= 0) return 0;
        const q = isUnits(l) ? Math.min(l.qty, left) : l.qty;
        if (isUnits(l)) left -= q; else if (left !== Infinity) return 0; // משקל + הגבלת יחידות – לא חל
        const b = C.rnd(l.unit * Math.round(q * 1000) / 1000);
        let d = 0;
        if (p.type === 'pct') d = isNum(p.pct) && p.pct > 0 && p.pct <= 100 ? C.pctOf(b, p.pct) : 0;
        else if (p.type === 'amt') d = isInt(p.amt) && p.amt > 0 ? Math.min(b, C.rnd(Math.min(p.amt, l.unit) * Math.round(q * 1000) / 1000)) : 0;
        else d = isInt(p.price) && p.price >= 0 ? Math.max(0, b - C.rnd(p.price * Math.round(q * 1000) / 1000)) : 0;
        return Math.min(d, base(l));
      });
    }
    case 'nForX': {
      if (!isInt(p.n) || p.n < 2 || !isInt(p.price) || p.price < 0) return z;
      const u = units(lines, pick, p);
      const g = Math.floor(u.length / p.n);
      if (!g) return z;
      const grp = u.slice(0, g * p.n);
      const full = grp.reduce((s, x) => s + x.u, 0);
      const disc = full - g * p.price;
      if (disc <= 0) return z;
      const w = byLine(n, grp.map((x) => ({ i: x.i, d: x.u })));
      return spreadTo(n, disc, w);
    }
    case 'bxgy': {
      const buy = arr(p.buy), get = arr(p.get);
      const bn = isInt(p.bn) && p.bn > 0 ? p.bn : 1, gn = isInt(p.gn) && p.gn > 0 ? p.gn : 1;
      const pct = isNum(p.getPct) && p.getPct > 0 && p.getPct <= 100 ? p.getPct : 100;
      if (!buy.length || !get.length) return z;
      const inB = (l) => !!l.pid && !l.noPromo && buy.includes(l.pid), inG = (l) => !!l.pid && !l.noPromo && get.includes(l.pid);
      const overlap = buy.some((x) => get.includes(x));
      let free;
      if (overlap) {
        const u = units(lines, (l) => inB(l) || inG(l), p);
        const g = Math.floor(u.length / (bn + gn));
        // היחידות הזולות ביותר (מתוך get) מקבלות את ההנחה
        free = u.filter((x) => get.includes(lines[x.i].pid)).sort((a, b) => a.u - b.u || a.i - b.i).slice(0, g * gn);
      } else {
        const ub = units(lines, inB, p), ug = units(lines, inG, { maxPerCust: Infinity });
        const g = Math.min(Math.floor(ub.length / bn), Math.floor(ug.length / gn));
        free = ug.sort((a, b) => a.u - b.u || a.i - b.i).slice(0, g * gn);
      }
      return byLine(n, free.map((x) => ({ i: x.i, d: C.pctOf(x.u, pct) })));
    }
    case 'bundle': {
      const pids = arr(p.pids);
      if (!pids.length || !isInt(p.price) || p.price < 0) return z;
      const need = (pid) => (p.need && isInt(p.need[pid]) && p.need[pid] > 0 ? p.need[pid] : 1);
      const qty = {}, unit = {};
      lines.forEach((l) => { if (l.pid && !l.noPromo && pids.includes(l.pid) && isUnits(l)) { qty[l.pid] = (qty[l.pid] || 0) + l.qty; unit[l.pid] = unit[l.pid] == null ? l.unit : Math.max(unit[l.pid], l.unit); } });
      let g = Infinity;
      for (const pid of pids) g = Math.min(g, Math.floor((qty[pid] || 0) / need(pid)));
      g = Math.min(g, maxU(p));
      if (!g || g === Infinity) return z;
      // משקל לכל שורה: היחידות שנכנסו לחבילות, לפי הסדר
      const left = {}; for (const pid of pids) left[pid] = g * need(pid);
      const w = lines.map((l) => { if (!l.pid || l.noPromo || !pids.includes(l.pid) || !isUnits(l)) return 0; const q = Math.min(l.qty, left[l.pid]); left[l.pid] -= q; return q * l.unit; });
      const full = w.reduce((s, x) => s + x, 0);
      const disc = full - g * p.price;
      return disc > 0 ? spreadTo(n, disc, w) : z;
    }
    default: return z;
  }
}
const sum = (a) => a.reduce((s, x) => s + x, 0);

function apply(lines, promos, ctx) {
  ctx = ctx || {};
  if (!Array.isArray(lines)) throw new Error('pos-promo: bad lines');
  const at = isNum(ctx.at) ? ctx.at : Date.now();
  const cx = Object.assign({}, ctx, { at });
  const n = lines.length;
  const B = lines.map((l) => (isInt(l.unit) && l.unit >= 0 && isNum(l.qty) && l.qty > 0 ? base(l) : 0));
  const out = lines.map(() => ({ pdisc: 0 }));
  const applied = [];
  const act = arr(promos).filter((p) => p && typeof p.id === 'string' && active(p, cx));
  // ---- 1. מבצעי מוצר: לכל שורה מבצע אחד (promoStack) ----
  const stack = ['best', 'both', 'first', 'worst'].includes(cx.stack) ? cx.stack : 'best';
  const ev = act.filter((p) => ITEM.includes(p.type)).map((p) => { const d = evalItem(p, lines).map((x, i) => Math.min(x, B[i])); return { p, d, t: sum(d) }; }).filter((x) => x.t > 0);
  if (stack === 'both') {
    for (const x of ev) x.d.forEach((v, i) => { if (v > 0) { const add = Math.min(v, B[i] - out[i].pdisc); if (add > 0) { out[i].pdisc += add; out[i].promo = out[i].promo || x.p.id; } } });
    for (const x of ev) applied.push({ id: x.p.id, disc: x.t });
  } else {
    const prio = (p) => (isInt(p.prio) ? p.prio : 0);
    ev.sort(stack === 'best' ? (a, b) => b.t - a.t || String(a.p.id).localeCompare(String(b.p.id))
      : stack === 'worst' ? (a, b) => a.t - b.t || String(a.p.id).localeCompare(String(b.p.id))
        : (a, b) => prio(a.p) - prio(b.p) || String(a.p.id).localeCompare(String(b.p.id)));
    const taken = new Array(n).fill(false);
    for (const x of ev) {
      const touch = x.d.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
      if (touch.some((i) => taken[i])) continue; // מבצע אחד לשורה – הראשון בסדר זוכה
      for (const i of touch) { taken[i] = true; out[i].pdisc = x.d[i]; out[i].promo = x.p.id; }
      applied.push({ id: x.p.id, disc: x.t });
    }
  }
  // ---- 2. מבצעי סכום כולל (אחרי מבצעי המוצרים) ----
  const after = () => lines.map((l, i) => B[i] - out[i].pdisc);
  for (const p of act.filter((q) => q.type === 'basket' || q.type === 'basketGift').sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const tot = sum(after());
    if (!isInt(p.minAmt) || p.minAmt < 0 || tot < p.minAmt) continue;
    if (p.type === 'basket') {
      let d = 0;
      if (isNum(p.pct) && p.pct > 0 && p.pct <= 100) d = C.pctOf(tot, p.pct);
      else if (isInt(p.amt) && p.amt > 0) d = Math.min(p.amt, tot);
      if (d <= 0) continue;
      const w = after().map((v, i) => (lines[i].noPromo ? 0 : v));
      if (sum(w) < d) continue;
      const sh = spreadTo(n, d, w);
      sh.forEach((v, i) => { if (v > 0) { out[i].pdisc += v; out[i].bp = p.id; } });
      applied.push({ id: p.id, disc: d });
    } else {
      // מתנה: יחידה אחת של giftPid (הזולה) – חינם
      let best = -1;
      lines.forEach((l, i) => { if (l.pid === p.giftPid && isUnits(l) && B[i] - out[i].pdisc >= l.unit && (best < 0 || l.unit < lines[best].unit)) best = i; });
      if (best < 0) continue;
      const d = lines[best].unit;
      if (d <= 0) continue;
      out[best].pdisc += d; out[best].bp = p.id;
      applied.push({ id: p.id, disc: d });
    }
  }
  // ---- 3. קופונים (cpnStack: כמה יחד; cpnOnPromo: גם על שורה במבצע) ----
  const cpns = [];
  let used = 0;
  for (const c of arr(cx.cpns)) {
    const code = c && c.code, q = c && c.promo;
    if (!code || !q || (q.type !== 'pct' && q.type !== 'amt')) { cpns.push({ code, disc: 0, ok: false, why: 'bad-cpn' }); continue; }
    if (used && cx.cpnStack === false) { cpns.push({ code, disc: 0, ok: false, why: 'no-stack' }); continue; }
    const elig = lines.map((l, i) => !!l.pid && !l.noPromo && scoped(q, l) && (cx.cpnOnPromo === true || (!out[i].promo && !out[i].bp)));
    const w = after().map((v, i) => (elig[i] ? v : 0));
    const tot = sum(w);
    if (tot <= 0) { cpns.push({ code, disc: 0, ok: false, why: 'cpn-no-line' }); continue; }
    let d = 0;
    if (q.type === 'pct' && isNum(q.pct) && q.pct > 0 && q.pct <= 100) d = sum(w.map((v) => (v > 0 ? C.pctOf(v, q.pct) : 0)));
    else if (q.type === 'amt' && isInt(q.amt) && q.amt > 0) d = Math.min(q.amt, tot);
    if (d <= 0) { cpns.push({ code, disc: 0, ok: false, why: 'bad-cpn' }); continue; }
    const sh = q.type === 'pct' ? w.map((v) => (v > 0 ? C.pctOf(v, q.pct) : 0)) : spreadTo(n, d, w);
    sh.forEach((v, i) => { if (v > 0) { out[i].pdisc += v; out[i].cpn = code; } });
    cpns.push({ code, disc: d, ok: true });
    used++;
  }
  for (let i = 0; i < n; i++) if (out[i].pdisc > B[i]) out[i].pdisc = B[i];
  const gifts = applied.map((a) => act.find((p) => p.id === a.id)).filter((p) => p && p.type === 'basketGift').map((p) => p.giftPid);
  return { lines: out, applied, cpns, gifts };
}
// מבצע תקין לשמירה (posPromo בשרת, מסך הניהול) → null או reason
function check(p) {
  if (!p || typeof p !== 'object') return 'bad-promo';
  if (!TYPES.includes(p.type)) return 'bad-type';
  const pos = (v) => isInt(v) && v >= 0;
  switch (p.type) {
    case 'pct': return isNum(p.pct) && p.pct > 0 && p.pct <= 100 ? null : 'bad-pct';
    case 'amt': return isInt(p.amt) && p.amt > 0 ? null : 'bad-amt';
    case 'fixed': return pos(p.price) ? null : 'bad-price';
    case 'nForX': return isInt(p.n) && p.n >= 2 && pos(p.price) ? null : 'bad-n';
    case 'bxgy': return arr(p.buy).length && arr(p.get).length ? null : 'bad-bxgy';
    case 'bundle': return arr(p.pids).length >= 2 && pos(p.price) ? null : 'bad-bundle';
    case 'basket': return pos(p.minAmt) && ((isNum(p.pct) && p.pct > 0 && p.pct <= 100) || (isInt(p.amt) && p.amt > 0)) ? null : 'bad-basket';
    case 'basketGift': return pos(p.minAmt) && typeof p.giftPid === 'string' && p.giftPid ? null : 'bad-gift';
    default: return 'bad-type';
  }
}
const api = { TYPES, ITEM, apply, active, check, evalItem, dayOf };
if (typeof module === 'object' && module.exports) module.exports = api; else root.PosPromo = api;
})(typeof self !== 'undefined' ? self : this);
