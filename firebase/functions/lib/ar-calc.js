// לקוח עסקי ומחירים (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 1). פונקציות טהורות – בלי Firestore,
// כדי שמסך ההזמנה והשרת יחשבו בדיוק אותו דבר. כל החישוב באגורות (שלמים). אותו קובץ בדיוק: app-source/www/ar-calc.js
// (בדיקה ב-ar-calc.unit.test.js). שלבים 3–5 מוסיפים כאן (תוספות בלבד).
//
// יחידות: עלות המוצר (prod/{id}/p/cost) – כולל מע"מ; מחיר סיטונאי (p/ws) – לפני מע"מ; מחיר רגיל – כולל מע"מ.
// vm = אופן המחירים בהזמנה: 'ex' (לקוח עסקי – לפני מע"מ) | 'inc' (לקוח פרטי – כולל מע"מ). ההשוואה תמיד באותה יחידה.
// מחיר ברירת מחדל: מחיר קבוע ללקוח ← סיטונאי ← רגיל (ללקוח עסקי: רגיל ÷ (1+מע"מ), החלטה 7).
// מינימום (16–21): עלות × (1+X%), עיגול כלפי מעלה לאגורה שלמה. X לפי ordcfg/price: עסקי – cat[תת] ?? cat[קטגוריה] ?? pct;
// פרטי – pp (מגבלה נפרדת, הבהרה 28); pp ריק = כמו עסקי. X חסר = 0 (רק "לא מתחת לעלות").
(function (root) {
'use strict';
const VAT0 = 18; // ברירת המחדל כמו ordcfg/main.vat
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const vatOf = (v) => (isNum(v) && v >= 0 && v <= 100 ? v : VAT0);
// לאגורות: עיגול רגיל (חצי למעלה), כמו pricing-calc. 1.005 → 101
const ag = (x) => Math.round(Math.round(x * 10000) / 100);
// לאגורות, עיגול כלפי מעלה (מינימום). רעש של נקודה צפה (10.000000001) לא מעגל לאגורה הבאה
const agUp = (x) => Math.ceil(Math.round(x * 1e6) / 1e4 - 1e-6);
// עיגול חצי כלפי מעלה לפי ערך מוחלט (סכום שלילי מתעגל סימטרית)
const rnd = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
const sh = (a) => a / 100;
// מחיר כולל מע"מ → לפני מע"מ (עיגול רגיל לאגורה)
function exVat(inc, vat) { return isNum(inc) ? sh(Math.round(ag(inc) * 100 / (100 + vatOf(vat)))) : null; }
// עלות ביחידת ההזמנה, מדויקת (לא מעוגלת) – בשקלים
function costIn(cost, vm, vat) { return !isNum(cost) || cost < 0 ? null : vm === 'ex' ? cost * 100 / (100 + vatOf(vat)) : cost; }
// אחוז המינימום למוצר. cfg = ordcfg/price (או null = אין מגבלה). biz = לקוח עסקי
function pctFor(cfg, biz, cat, sub) {
  if (!cfg || typeof cfg !== 'object') return null;
  if (!biz && isNum(cfg.pp)) return cfg.pp;
  const m = cfg.cat && typeof cfg.cat === 'object' ? cfg.cat : {};
  if (sub && isNum(m[sub])) return m[sub];
  if (cat && isNum(m[cat])) return m[cat];
  return isNum(cfg.pct) ? cfg.pct : null;
}
// מחיר מינימלי (שקלים) לפי עלות ואחוז. עלות חסרה – null
function floorOf(cost, vm, vat, pct) {
  const c = costIn(cost, vm, vat);
  if (c == null) return null;
  const p = isNum(pct) && pct > 0 ? pct : 0;
  return sh(Math.max(agUp(c), agUp(c * (100 + p) / 100)));
}
// מחיר ברירת המחדל של הלקוח: cp = מחיר קבוע, wp = סיטונאי, price = מחיר רגיל (של הסניף)
function defPrice(o) {
  if (isNum(o.cp)) return o.cp;
  if (o.vm === 'ex') return isNum(o.wp) ? o.wp : exVat(isNum(o.price) ? o.price : 0, o.vat);
  return isNum(o.price) ? o.price : 0;
}
// בדיקת מחיר של עובד. { price, def, cost, vm, vat, pct } → { ok, min?, why? }
// מחיר ≥ ברירת המחדל – תמיד מותר. מתחת: צריך עלות (בלי עלות – לא מורידים מתחת לברירת המחדל), ומחיר ≥ מינימום.
function priceOk(o) {
  const p = ag(o.price), d = ag(isNum(o.def) ? o.def : 0);
  if (p >= d) return { ok: true };
  const min = floorOf(o.cost, o.vm, o.vat, o.pct);
  if (min == null) return { ok: false, min: sh(d), why: 'no-cost' };
  if (p >= ag(min)) return { ok: true, min };
  const c = costIn(o.cost, o.vm, o.vat);
  return { ok: false, min, why: p < agUp(c) ? 'below-cost' : 'floor' };
}
// בדיקת מחיר של עובד בהזמנה / במחיר קבוע (סבב 2). base = ברירת המחדל *בלי* מחיר קבוע (סיטונאי / רגיל) – מחיר קבוע לא מכשיר את עצמו.
// on = מגבלת המחיר פעילה (ordcfg/price). biz = לקוח עסקי: מתחת לעלות חסום תמיד, גם בלי מגבלה. לקוח פרטי בלי מגבלה – בלי בדיקה (כמו קודם).
// סבב 3 (החלטה 8): mcp = מחיר קבוע ש*מנהל* שמר ללקוח (ביחידת ההזמנה) – מאושר לעובד גם מתחת למינימום / לעלות, וכך גם מחיר גבוה ממנו.
// מחיר קבוע שעובד שמר (או רשומה ישנה בלי סימון) – לא נשלח כ-mcp ונבדק כרגיל. לקוח עסקי: מחיר 0 חסום לעובד כשברירת המחדל גדולה מ-0 (גם למוצר בלי עלות).
function staffOk(o) {
  if (isNum(o.mcp) && ag(o.price) >= ag(o.mcp)) return { ok: true, mgr: true };
  if (o.biz && ag(o.price) <= 0 && ag(isNum(o.base) ? o.base : 0) > 0) return { ok: false, min: o.base, why: 'zero' };
  const c = costIn(o.cost, o.vm, o.vat);
  if ((o.on || o.biz) && c != null && ag(o.price) < agUp(c)) return { ok: false, min: floorOf(o.cost, o.vm, o.vat, o.on ? o.pct : 0), why: 'below-cost' };
  if (!o.on) return { ok: true };
  return priceOk({ price: o.price, def: o.base, cost: o.cost, vm: o.vm, vat: o.vat, pct: o.pct });
}
// סכומי הזמנה מסכום השורות (total בשקלים, כמו ord.total). disc = אחוז הנחה כללית (רשות).
// ex: net = בסיס, vat = round(net×r/100), gross = net + vat. inc: gross = בסיס, vat = round(gross×r/(100+r)), net = gross − vat.
function totals(total, vm, vat, disc) {
  const r = vatOf(vat), sum = ag(isNum(total) ? total : 0);
  const d = isNum(disc) && disc > 0 ? rnd(sum * disc / 100) : 0;
  const base = sum - d;
  let net, v, gross;
  if (vm === 'ex') { net = base; v = rnd(net * r / 100); gross = net + v; } else { gross = base; v = rnd(gross * r / (100 + r)); net = gross - v; }
  const o = { net: sh(net), vat: sh(v), gross: sh(gross) };
  if (d) o.dsc = sh(d);
  return o;
}
// תנאי תשלום ללקוח: { b:'imm'|'eom'|'inv', d } (כמו בספקים: מיידי / שוטף+d / d ימים מהחשבונית).
// לקוח ישן בלי terms – לפי pay: n30/60/90 = שוטף+30/60/90; cash/credit/transfer = מיידי; other = מיידי עם אזהרה (warn) ו-payTxt. pay לא נמחק.
const TB = ['imm', 'eom', 'inv'];
function termsOk(t) { return !!t && typeof t === 'object' && TB.includes(t.b) && Number.isInteger(t.d) && t.d >= 0 && t.d <= 365 && (t.b !== 'imm' || t.d === 0); }
function termsOfCust(c) {
  c = c || {};
  if (termsOk(c.terms)) return { b: c.terms.b, d: c.terms.d };
  const m = /^n(30|60|90)$/.exec(c.pay || '');
  if (m) return { b: 'eom', d: +m[1] };
  if (c.pay === 'other') return { b: 'imm', d: 0, warn: true, txt: String(c.payTxt || '') };
  return { b: 'imm', d: 0 };
}
// מחיר קבוע ללקוח שנשמר ביחידה אחת (cprice.vm) ונקרא בהזמנה ביחידה אחרת (הלקוח הפך מפרטי לעסקי או להפך) – המרה לפי אחוז המע"מ, באגורות
function cpConv(p, from, to, vat) {
  if (!isNum(p)) return null;
  if (!from || from === to) return p;
  return to === 'ex' ? exVat(p, vat) : sh(Math.round(ag(p) * (100 + vatOf(vat)) / 100));
}
// הסכום לתשלום של הזמנה: gross בהזמנה עם vm (כולל מע"מ, אחרי הנחה); הזמנה ישנה – total, כמו קודם
function payOf(o) { return o && (o.vm === 'ex' || o.vm === 'inc') && isNum(o.gross) ? o.gross : (o && isNum(o.total) ? o.total : 0); }
function termsTxt(t) { if (!t) return ''; return t.b === 'eom' ? 'שוטף+' + t.d : t.b === 'inv' ? t.d + ' ימים מהחשבונית' : 'מיידי'; }

// ---------- שלב 4: חשבוניות, קבלות וזיכויים ----------
// סכומי מסמך באגורות (שלמים) משורות [{q,p}] (p בשקלים ביחידת המסמך). אותו חישוב כמו totals ו-ar-pdf.calc:
// ex: net = Σround(q×p×100), vat = round(net×r/100) פעם אחת ברמת המסמך, gross = net + vat. inc: gross = Σשורות, vat = round(gross×r/(100+r)), net = gross − vat.
// פטור (r = 0): vat = 0. המע"מ וההנחה – עיגול חצי כלפי מעלה לפי ערך מוחלט (rnd, סימטרי גם לסכום שלילי). → { sum, dsc, net, vat, gross } באגורות
function docSums(lines, vm, rate, disc) {
  // שורה = Math.round(q×p×100) – בדיוק כמו ar-pdf.calc ו-linesOf (ar.js), כדי שהסכום השמור יהיה הסכום המודפס
  const sum = (Array.isArray(lines) ? lines : []).reduce((s, l) => s + Math.round(Number(l.q) * Number(l.p) * 100), 0);
  const t = totals(sum / 100, vm, rate, disc);
  return { sum, dsc: t.dsc ? ag(t.dsc) : 0, net: ag(t.net), vat: ag(t.vat), gross: ag(t.gross) };
}
// תאריכים 'YYYY-MM-DD' (בלי אזור זמן – חישוב לוח שנה בלבד)
const p2 = (n) => String(n).padStart(2, '0');
const ymdOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymdAdd(s, 0) === s;
function ymdAdd(s, k) { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + k)); return t.getUTCFullYear() + '-' + p2(t.getUTCMonth() + 1) + '-' + p2(t.getUTCDate()); }
function monEnd(y, m0) { const t = new Date(Date.UTC(y, m0 + 1, 0)); return t.getUTCFullYear() + '-' + p2(t.getUTCMonth() + 1) + '-' + p2(t.getUTCDate()); }
// מועד תשלום לחשבונית (77–81, החלטה 10): terms = { b:'imm'|'eom'|'inv', d }, d = תאריך החשבונית. זהה ל-dueCalc של הספקים באפליקציה:
// מיידי = d; ימים מהחשבונית = d + N; שוטף + כפולה של 30 = סוף החודש + N/30 חודשים (שוטף+60 על נובמבר = 31.1); שוטף+N אחר = סוף החודש + N ימים.
// אחר כך: מועד שנופל ביום שאינו יום עסקים (isBiz('YYYY-MM-DD') = false: שישי, שבת, חג) עובר ליום העסקים הבא. isBiz חסר = בלי דחייה.
function dueOf(terms, d, isBiz) {
  if (!ymdOk(d)) return '';
  const t = termsOk(terms) ? terms : { b: 'imm', d: 0 };
  let r;
  if (t.b === 'inv') r = ymdAdd(d, t.d);
  else if (t.b === 'eom') { const [y, m] = d.split('-').map(Number); r = t.d % 30 === 0 ? monEnd(y, m - 1 + t.d / 30) : ymdAdd(monEnd(y, m - 1), t.d); }
  else r = d;
  if (typeof isBiz === 'function') for (let i = 0; i < 60 && !isBiz(r); i++) r = ymdAdd(r, 1);
  return r;
}
// המספר הבא בסדרה: n = המונה (המספר האחרון שהופק, או null כשאין עדיין מסמך בסדרה); start = מספר ההתחלה שמנהל־העל קבע (סדרה רשמית בלבד)
function nextNo(n, start) { const s = Number.isInteger(start) && start > 0 ? start : 1; return Number.isInteger(n) && n > 0 ? Math.max(n + 1, s) : s; }

// החלטה 32 (חלק א, חיוב אחרי ליקוט): מסגרת = סכום ההזמנה × (1 + מרווח%), מעוגלת לשקל שלם כלפי מעלה. מרווח לא תקין / חסר = 10%
const MG0 = 10;
const mgOf = (m) => (isNum(m) && m >= 0 && m <= 50 ? m : MG0);
function frameOf(amt, mg) { const c = ag(isNum(amt) && amt > 0 ? amt : 0); return Math.max(0, Math.ceil(Math.round(c * Math.round((100 + mgOf(mg)) * 100)) / 1e6 - 1e-9)); }

// שלב 5 (תזכורות תשלום, 86–90): אילו תזכורות כבר הגיע זמנן לחשבונית אחת. due = מועד התשלום (dueX || due), d = תאריך החשבונית, today = היום (YYYY-MM-DD).
// rc = { b: ימים לפני המועד (ברירת מחדל 3; 0 = בלי), steps: ימים אחרי המועד (ברירת מחדל [0,3,7,30]; 0 = ביום המועד), mon: אחר כך כל X ימים עד התשלום (30; 0 = בלי) }.
// שלב שנופל ביום שאינו יום עסקים (isBiz – שישי, שבת, חג) עובר ליום העסקים הבא. שלב ביום ההפקה או לפניו – לא נשלח.
// מחזיר את השלבים שהגיע זמנם (עד היום), לפי הסדר: [{ k:'b'|'a0'|'a3'|…|'m1'|'m2'…, day }]. השרת שולח רק את האחרון, ורק אם עוד לא נשלח.
const REM0 = { b: 3, steps: [0, 3, 7, 30], mon: 30 };
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function remCfg(x) {
  x = x && typeof x === 'object' ? x : {};
  const st = Array.isArray(x.steps) && x.steps.length <= 8 && x.steps.every((v) => intIn(v, 0, 365)) ? [...new Set(x.steps)].sort((a, b) => a - b) : REM0.steps.slice();
  return { b: intIn(x.b, 0, 60) ? x.b : REM0.b, steps: st, mon: x.mon === 0 || intIn(x.mon, 7, 90) ? x.mon : REM0.mon };
}
function remStages(due, d, today, rc, isBiz) {
  if (!ymdOk(due) || !ymdOk(today)) return [];
  const c = remCfg(rc);
  const nb = (s) => { if (typeof isBiz === 'function') for (let i = 0; i < 60 && !isBiz(s); i++) s = ymdAdd(s, 1); return s; };
  const out = [];
  const add = (k, n) => { const day = nb(n); if (day <= today && (!ymdOk(d) || day > d)) out.push({ k, day }); };
  if (c.b > 0) add('b', ymdAdd(due, -c.b));
  for (const s of c.steps) add('a' + s, ymdAdd(due, s));
  if (c.mon > 0) {
    const last = c.steps.length ? c.steps[c.steps.length - 1] : 0;
    for (let k = 1; k <= 200; k++) { const n = ymdAdd(due, last + c.mon * k); if (n > today) break; add('m' + k, n); }
  }
  return out.map((x, i) => [x, i]).sort((a, b) => (a[0].day < b[0].day ? -1 : a[0].day > b[0].day ? 1 : a[1] - b[1])).map((x) => x[0]);
}

// כרטסת (104): שורות חובה / זכות ויתרה מצטברת ממסמכי הלקוח (ardoc), באגורות – אותו חישוב כמו cust.ar.bal (lib/ar-doc.js):
// חובה: חשבונית מס, חשבונית מס קבלה, החזר כסף בזיכוי (rf). זכות: קבלה שלא בוטלה, חשבונית מס קבלה, זיכוי. מיובא (ob/old, שלב 6) – לפי k.
// from / to (YYYY-MM-DD, רשות): השורות שבטווח; open = היתרה לפני from. bal = היתרה אחרי כל המסמכים (בלי קשר לטווח).
function ledger(docs, from, to) {
  // שלב 6: מסמך מיובא (ob יתרת פתיחה / old מסמך ישן) – חובה או זכות לפי k; מבוטל (ביטול קבוצה) לא נספר – כמו cust.ar.bal
  const imp = (x) => x.t === 'ob' || x.t === 'old';
  const L = (Array.isArray(docs) ? docs : []).filter((x) => x && (['inv', 'ir', 'rc', 'cr'].includes(x.t) || (imp(x) && !x.void)) && Number.isInteger(x.gross) && !(x.t === 'rc' && x.void))
    .map((x) => Object.assign({ id: x.id || '', t: x.t, no: x.no, d: String(x.d || ''), at: isNum(x.at) ? x.at : 0,
      dr: imp(x) ? (x.k === 'dr' ? x.gross : 0) : x.t === 'inv' || x.t === 'ir' ? x.gross : x.t === 'cr' && x.rf && Number.isInteger(x.rf.amt) ? x.rf.amt : 0,
      cr: imp(x) ? (x.k === 'cr' ? x.gross : 0) : x.t === 'inv' ? 0 : x.gross }, x.ot ? { ot: x.ot } : {}))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.at - b.at || (a.no || 0) - (b.no || 0)));
  let bal = 0, open = 0, dr = 0, cr = 0;
  const rows = [];
  for (const r of L) {
    bal += r.dr - r.cr; r.bal = bal;
    if (from && r.d < from) { open = bal; continue; }
    if (to && r.d > to) continue;
    dr += r.dr; cr += r.cr; rows.push(r);
  }
  return { open, rows, dr, cr, end: rows.length ? rows[rows.length - 1].bal : open, bal };
}
const api = { VAT0, ag, agUp, exVat, costIn, pctFor, floorOf, defPrice, priceOk, totals, termsOk, termsOfCust, termsTxt, cpConv, payOf, staffOk, docSums, dueOf, ymdOk, ymdAdd, nextNo, MG0, mgOf, frameOf, REM0, remCfg, remStages, ledger };
// שרת (Node) – module.exports; מסך ההזמנה (דפדפן) – window.ArCalc
if (typeof module === 'object' && module.exports) module.exports = api; else root.ArCalc = api;
})(typeof self !== 'undefined' ? self : this);
