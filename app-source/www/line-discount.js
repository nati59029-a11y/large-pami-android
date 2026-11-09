// חבילות ניוד ומבצעים – פישוט (משימה 2026-11-09_חבילות-ניוד, שלב 5; החלטות 9.11 22:27 ו-22:35).
// פונקציה טהורה – בלי Firestore, כדי שהטופס יריץ בדיוק אותה נוסחה. כל החישוב באגורות (שלמים). קלט כבר מאומת (השרת מנקה).
//
// חבילה (lineplan): ship/sim = { amt (₪), pay: 'store' | 'carrier' }, monthly (₪, מוצג בלבד).
//   "לחנות" נוסף לסכום ההזמנה; "לחברה" ועלות חודשית – מוצגים בלבד.
// מבצע של חבילה (lineplan.promo, רשות): { disc?: ₪ הנחה לכל קו בחבילה, gifts?: [{pid, price}] (אחת = אוטומטית; כמה = בוחרים אחת),
//   qty?: { n: מספר קווים, amt: ₪ הנחה (פעם אחת), scope: 'plan' | 'carrier' | 'all' }, from?, to? ('YYYY-MM-DD', כולל) }.
//   מתנות לא מחושבות כאן – הטופס מוסיף אותן כשורות מוצר (יורדות מהמלאי כמו כל מוצר).
//
// כללים:
//   1. הנחה מוצעת = סכום disc של כל קו שהחבילה שלו במבצע פעיל + לכל חבילה עם מבצע כמות שהתקיים – amt פעם אחת.
//      מבצע כמות: נספרים הקווים לפי scope ביחס לחבילה – אותה חבילה / אותה חברה / כל קו בהזמנה.
//   2. בהזמנה יש משבצת אחת "סה"כ הנחה": העובד משנה בחופשיות (גם למעלה; 0 = בלי הנחה). man = הסכום שהעובד הזין (₪) או null = המוצע.
//   3. ההנחה יורדת מכל הסכום לחנות (פריטים + משלוח/סים לחנות), ולא מתחת ל-0.
//   4. המלצה (שורה אחת): כשעוד קו אחד יזכה במבצע כמות.

(function (root) {
'use strict';
const ag = (x) => Math.round(Number(x || 0) * 100);
const fee = (f, pay) => (f && typeof f.amt === 'number' && f.amt > 0 && (f.pay || 'store') === pay ? ag(f.amt) : 0);
const live = (pr, today) => !!pr && typeof pr === 'object' && (!pr.from || today >= pr.from) && (!pr.to || today <= pr.to);
const SCOPE = { plan: 'באותה חבילה', carrier: 'באותה חברה', all: 'בהזמנה' };

// תאריך היום בישראל 'YYYY-MM-DD' (Asia/Jerusalem – חורף ‎+2, קיץ ‎+3) – לתאריכי מבצע
const IL_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
const ilDay = (ms) => IL_FMT.format(new Date(ms == null ? Date.now() : ms));

// lines: [{ carrier?, plan? }] ; plans: Map id→lineplan ; man: ₪ שהעובד הזין או null ; opt: { itemsAg, today }
function calcCell(lines, plans, man, opt) {
  opt = opt || {};
  const today = opt.today || '';
  const L = lines.map((l) => {
    const pl = (l.plan && plans.get(l.plan)) || null;
    const c = (pl && pl.carrier) || l.carrier || '';
    const pr = pl && live(pl.promo, today) ? pl.promo : null;
    return {
      plan: (pl && l.plan) || '', c, pr,
      store: fee(pl && pl.ship, 'store') + fee(pl && pl.sim, 'store'),
      ext: fee(pl && pl.ship, 'carrier') + fee(pl && pl.sim, 'carrier'),
      monthly: pl && typeof pl.monthly === 'number' ? ag(pl.monthly) : 0,
      disc: pr && typeof pr.disc === 'number' && pr.disc > 0 ? ag(pr.disc) : 0,
    };
  });
  const cnt = (q, l) => L.filter((x) => (q.scope === 'all' ? true : q.scope === 'carrier' ? !!l.c && x.c === l.c : x.plan === l.plan)).length;
  let sug = L.reduce((s, l) => s + l.disc, 0);
  const qty = []; // מבצעי כמות שהתקיימו (פעם אחת לכל חבילה)
  let hint = null;
  const seen = new Set();
  for (const l of L) {
    const q = l.pr && l.pr.qty;
    if (!q || !l.plan || seen.has(l.plan)) continue;
    seen.add(l.plan);
    const n = cnt(q, l);
    if (n >= q.n) { sug += ag(q.amt); qty.push({ plan: l.plan, n: q.n, amt: q.amt }); }
    else if (n === q.n - 1 && (!hint || q.amt > hint.amt)) hint = { plan: l.plan, n: q.n, amt: q.amt, scope: q.scope };
  }
  const storeAg = L.reduce((s, l) => s + l.store, 0);
  const room = Math.max(0, (opt.itemsAg || 0) + storeAg);
  let disc = man == null ? sug : Math.max(0, ag(man));
  if (disc > room) disc = room; // לא מתחת ל-0
  if (hint) hint.msg = `עוד קו אחד ${SCOPE[hint.scope] || ''} יזכה בהנחה של ₪${hint.amt} (מבצע ${hint.n} קווים)`;
  return {
    store: storeAg / 100, sug: sug / 100, disc: disc / 100, net: (room - disc) / 100,
    ext: L.reduce((s, l) => s + l.ext, 0) / 100, monthly: L.reduce((s, l) => s + l.monthly, 0) / 100,
    man: man == null ? null : disc / 100, qty, hint,
  };
}

const api = { calcCell, ilDay, live };
// שרת (Node) – module.exports; טופס ההזמנה (דפדפן) – window.LineDisc. אותו קובץ בדיוק: app-source/www/line-discount.js (בדיקה ב-ui-ord-lines.js)
if (typeof module === 'object' && module.exports) module.exports = api; else root.LineDisc = api;
})(typeof self !== 'undefined' ? self : this);
