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

const api = { VAT0, ag, agUp, exVat, costIn, pctFor, floorOf, defPrice, priceOk, totals, termsOk, termsOfCust, termsTxt, cpConv, payOf, staffOk };
// שרת (Node) – module.exports; מסך ההזמנה (דפדפן) – window.ArCalc
if (typeof module === 'object' && module.exports) module.exports = api; else root.ArCalc = api;
})(typeof self !== 'undefined' ? self : this);
