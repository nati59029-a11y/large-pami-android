// קופה (POS), שלב 0 – ספריית חישוב באגורות. פונקציות טהורות (בלי Firestore), כדי שהקופה והשרת יחשבו בדיוק אותו דבר –
// גם בלי רשת (שלב 2). אותו קובץ בדיוק: app-source/www/pos-calc.js (בדיקה ב-pos-calc.unit.test.js).
//
// יחידות: כל הסכומים באגורות, מספרים שלמים. מחיר מוצר ב-prod.price הוא בשקלים, כולל מע"מ – toAg ממיר (×100, עיגול).
// vm = אופן המחירים במכירה: 'inc' (פרטי – כולל מע"מ, ברירת המחדל בקופה) | 'ex' (לקוח עסקי – לפני מע"מ).
// כללי עיגול קבועים:
//   - עיגול רגיל = חצי כלפי מעלה לפי ערך מוחלט (rnd, סימטרי גם לסכום שלילי, כמו ar-calc).
//   - שורה: base = rnd(unit × qty); הנחת שורה (אגורות או אחוז מ-base); tot = base − disc.
//   - הנחה ברמת המכירה מתחלקת בין השורות לפי משקל (שארית גדולה ראשונה), כך שסכום השורות אחרי הנחה = הסה"כ בדיוק.
//   - inc: gross = Σשורות; vat = rnd(gross × r / (100 + r)); net = gross − vat (כמו ar-calc.docSums, ולכן אותו מסמך ardoc).
//     בדוגמה בתוכנית: 9980 → net 8458, vat 1522.
//   - ex: net = Σשורות; vat = rnd(net × r / 100); gross = net + vat.
//   - עיגול מזומן (cashRound): הסכום לתשלום במזומן מעוגל לכפולה של step אגורות (ברירת מחדל 10), חצי כלפי מעלה. ההפרש נרשם בנפרד.
// קלט לא תקין – Error עם reason (bad-line, bad-qty, bad-unit, bad-disc, bad-rate, bad-vm, bad-amt, bad-step).
(function (root) {
'use strict';
const VAT0 = 18;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isAg = (v) => Number.isInteger(v);
// עיגול חצי כלפי מעלה לפי ערך מוחלט. רעש של נקודה צפה (0.49999999) מנוקה לפני העיגול
const clean = (x) => Math.round(x * 1e6) / 1e6;
const rnd = (x) => { const c = clean(x); return c < 0 ? -Math.round(-c) : Math.round(c); };
// שקלים → אגורות (מחיר מוצר ב-prod.price)
const toAg = (sh) => (isNum(sh) ? rnd(Math.round(sh * 10000) / 100) : null);
const fail = (reason, msg) => { const e = new Error(msg || reason); e.reason = reason; return e; };
const rateOf = (r) => {
  if (r == null) return VAT0;
  if (!isNum(r) || r < 0 || r > 100) throw fail('bad-rate', 'שיעור מע"מ לא תקין');
  return r;
};
// אחוז מסכום (הנחה באחוזים). pct עד 2 ספרות אחרי הנקודה
function pctOf(amt, pct) {
  if (!isAg(amt)) throw fail('bad-amt', 'סכום לא תקין');
  if (!isNum(pct) || pct < 0 || pct > 100) throw fail('bad-disc', 'אחוז הנחה לא תקין');
  return rnd(amt * Math.round(pct * 100) / 10000);
}
// פיצול מע"מ מסכום כולל מע"מ
function vatIn(gross, rate) {
  if (!isAg(gross)) throw fail('bad-amt', 'סכום לא תקין');
  const r = rateOf(rate);
  const vat = r === 0 ? 0 : rnd(gross * r / (100 + r));
  return { net: gross - vat, vat, gross, rate: r };
}
// מע"מ על סכום לפני מע"מ
function vatEx(net, rate) {
  if (!isAg(net)) throw fail('bad-amt', 'סכום לא תקין');
  const r = rateOf(rate);
  const vat = r === 0 ? 0 : rnd(net * r / 100);
  return { net, vat, gross: net + vat, rate: r };
}
// חלוקת total (אגורות) לפי משקלים, בשיטת השארית הגדולה. סכום החלקים = total בדיוק. משקלים 0 – חלק 0.
// שוויון בשארית – לפי הסדר (השורה הראשונה קודם), כדי שהתוצאה תהיה זהה בכל מכשיר.
function spread(total, weights) {
  if (!isAg(total)) throw fail('bad-amt', 'סכום לא תקין');
  const w = (Array.isArray(weights) ? weights : []).map((x) => (isNum(x) && x > 0 ? x : 0));
  const sum = w.reduce((s, x) => s + x, 0);
  if (!w.length) { if (total !== 0) throw fail('bad-amt', 'אין שורות לחלוקה'); return []; }
  if (sum === 0) { if (total !== 0) throw fail('bad-amt', 'אין שורות לחלוקה'); return w.map(() => 0); }
  const sg = total < 0 ? -1 : 1, T = Math.abs(total);
  const raw = w.map((x) => T * x / sum);
  const out = raw.map((x) => Math.floor(clean(x)));
  let left = T - out.reduce((s, x) => s + x, 0);
  const ord = raw.map((x, i) => ({ i, f: clean(x - Math.floor(clean(x))) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && k < ord.length; k++) { if (w[ord[k].i] > 0) { out[ord[k].i] += 1; left -= 1; } }
  return out.map((x) => sg * x);
}
// שורה אחת: { unit (אגורות, ≥0), qty (>0, עד 3 ספרות אחרי הנקודה – משקל), disc? (אגורות) | dpct? (אחוז) }
function line(l) {
  if (!l || typeof l !== 'object') throw fail('bad-line', 'שורה לא תקינה');
  if (!isAg(l.unit) || l.unit < 0) throw fail('bad-unit', 'מחיר יחידה לא תקין');
  if (!isNum(l.qty) || l.qty <= 0 || l.qty > 100000 || Math.abs(Math.round(l.qty * 1000) - l.qty * 1000) > 1e-6) throw fail('bad-qty', 'כמות לא תקינה');
  const base = rnd(l.unit * Math.round(l.qty * 1000) / 1000);
  let disc = 0;
  if (l.disc != null && l.dpct != null) throw fail('bad-disc', 'הנחה בסכום או באחוז – לא שניהם');
  if (l.disc != null) { if (!isAg(l.disc) || l.disc < 0) throw fail('bad-disc', 'הנחה לא תקינה'); disc = l.disc; }
  if (l.dpct != null) disc = pctOf(base, l.dpct);
  if (disc > base) throw fail('bad-disc', 'ההנחה גדולה מסכום השורה');
  return { base, disc, tot: base - disc };
}
// מכירה שלמה. lines – כמו line(); o = { disc? (אגורות) | dpct? – הנחה על כל המכירה; rate?; vm? ('inc' ברירת מחדל) }
// → { lines:[{ base, disc, tot, sd, fin }], sub, ldisc, sdisc, disc, net, vat, gross, rate, vm }
//   sub = Σbase; ldisc = Σהנחות שורה; sdisc = הנחת מכירה; disc = ldisc + sdisc; fin = tot − sd (החלק של השורה בסה"כ).
//   inc: Σfin = gross. ex: Σfin = net.
function sale(lines, o) {
  o = o || {};
  if (!Array.isArray(lines) || !lines.length) throw fail('bad-line', 'אין שורות');
  const vm = o.vm == null ? 'inc' : o.vm;
  if (vm !== 'inc' && vm !== 'ex') throw fail('bad-vm', 'אופן מחיר לא תקין');
  const rate = rateOf(o.rate);
  const L = lines.map(line);
  const after = L.reduce((s, x) => s + x.tot, 0);
  let sdisc = 0;
  if (o.disc != null && o.dpct != null) throw fail('bad-disc', 'הנחה בסכום או באחוז – לא שניהם');
  if (o.disc != null) { if (!isAg(o.disc) || o.disc < 0) throw fail('bad-disc', 'הנחה לא תקינה'); sdisc = o.disc; }
  if (o.dpct != null) sdisc = pctOf(after, o.dpct);
  if (sdisc > after) throw fail('bad-disc', 'ההנחה גדולה מסכום המכירה');
  const sd = spread(sdisc, L.map((x) => x.tot));
  const out = L.map((x, i) => ({ base: x.base, disc: x.disc, tot: x.tot, sd: sd[i], fin: x.tot - sd[i] }));
  const sum = after - sdisc;
  const v = vm === 'inc' ? vatIn(sum, rate) : vatEx(sum, rate);
  const sub = L.reduce((s, x) => s + x.base, 0), ldisc = L.reduce((s, x) => s + x.disc, 0);
  return { lines: out, sub, ldisc, sdisc, disc: ldisc + sdisc, net: v.net, vat: v.vat, gross: v.gross, rate, vm };
}
// עיגול מזומן: amt (אגורות) לכפולה של step. → { amt, diff } (diff = amt המעוגל − המקורי)
function cashRound(amt, step) {
  if (!isAg(amt)) throw fail('bad-amt', 'סכום לא תקין');
  const s = step == null ? 10 : step;
  if (!isAg(s) || s < 1 || s > 1000) throw fail('bad-step', 'יחידת עיגול לא תקינה');
  const r = rnd(amt / s) * s;
  return { amt: r, diff: r - amt };
}
// עודף במזומן: given (אגורות שהתקבלו) מול due (לתשלום, אחרי עיגול) → עודף (≥0) או null אם חסר
function change(given, due) {
  if (!isAg(given) || !isAg(due)) throw fail('bad-amt', 'סכום לא תקין');
  return given >= due ? given - due : null;
}
const api = { VAT0, isAg, rnd, toAg, pctOf, vatIn, vatEx, spread, line, sale, cashRound, change };
// שרת (Node) – module.exports; קופה (דפדפן) – window.PosCalc
if (typeof module === 'object' && module.exports) module.exports = api; else root.PosCalc = api;
})(typeof self !== 'undefined' ? self : this);
