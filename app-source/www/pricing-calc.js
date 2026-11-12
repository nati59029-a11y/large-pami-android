// תמחור מחשבונית ספק (משימה 2026-11-12_תמחור-חשבונית-ספק, שלב 0; החלטות המשתמש 12.11.2026).
// פונקציות טהורות – בלי Firestore, כדי שמסך התמחור והשרת יחשבו בדיוק אותו דבר. כל החישוב באגורות (שלמים).
// ערך ריק / לא מספר / שלילי = null (אין חישוב). 0 = 0.
//
// החלטה 1 – עיגול מחיר סיטונאי: תמיד למעלה לסיום ‎.0 / ‎.5 / ‎.9 בכל טווח המחירים
//   (1.3→1.5, 1.6→1.9, 1.91→2, 10.3→10.5, 10.6→10.9, 10.91→11).
// החלטה 2 – סיטונאי ברירת מחדל = עלות לפני מע"מ × 1.5 ואז עיגול. סיטונאי – בלי מע"מ.
//   אחוז רווח = (מחיר בלי מע"מ − עלות בלי מע"מ) ÷ עלות בלי מע"מ × 100 ("תוספת על העלות").
//   מחיר לצרכן כולל מע"מ – מוריד מע"מ לפני החישוב (marginInc). העלות במלאי (prod/{id}/p/cost) נשמרת כולל מע"מ כמו היום.
// החלטה 3 – יחידת המלאי = מארז; ct = מספר המארזים בקרטון. עלות מארז = מחיר קרטון ÷ ct; מחיר קרטון = מחיר מארז × ct.

(function (root) {
'use strict';
const WS_MUL = 1.5; // החלטה 2
const VAT0 = 18; // ברירת המחדל כמו ordcfg/main.vat
// מספר מקלט (גם מחרוזת מהמסך, עם פסיק עשרוני). ריק / לא מספר / שלילי = null
const num = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, '.').replace(/[₪\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const vatOf = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : VAT0);
// לאגורות: עיגול רגיל (חצי למעלה). 1.005 → 101 (לא 100 בגלל ייצוג עשרוני)
const ag = (x) => Math.round(Math.round(x * 10000) / 100);
const sh = (a) => a / 100;
// עיגול סיטונאי באגורות (שלם): מעגלים למעלה לסיום 00 / 50 / 90
function roundWsAg(a) {
  if (a <= 0) return 0;
  const s = Math.floor(a / 100) * 100, r = a - s;
  return r === 0 ? a : r <= 50 ? s + 50 : r <= 90 ? s + 90 : s + 100;
}
// עיגול סיטונאי לסכום בשקלים. שבר של אגורה (מכפלה × 1.5) – למעלה לאגורה ואז לסיומת
function roundWs(v) {
  const n = num(v);
  if (n == null) return null;
  return sh(roundWsAg(Math.ceil(Math.round(n * 10000) / 100)));
}
// סיטונאי ברירת מחדל מעלות לפני מע"מ: × 1.5 ואז עיגול
function wsDefault(costEx) {
  const n = num(costEx);
  if (n == null) return null;
  return sh(roundWsAg(Math.ceil(ag(n) * WS_MUL)));
}
// המרות מע"מ (באגורות, עיגול רגיל)
function withVat(ex, vat) { const n = num(ex); return n == null ? null : sh(Math.round(ag(n) * (100 + vatOf(vat)) / 100)); }
function noVat(inc, vat) { const n = num(inc); return n == null ? null : sh(Math.round(ag(n) * 100 / (100 + vatOf(vat)))); }
// אחוז רווח על העלות, שני הצדדים בלי מע"מ. עלות 0 / חסרה – null. אחוז עם ספרה אחת אחרי הנקודה (יכול להיות שלילי)
function margin(priceEx, costEx) {
  const p = num(priceEx), c = num(costEx);
  if (p == null || c == null || ag(c) === 0) return null;
  return Math.round((ag(p) - ag(c)) * 1000 / ag(c)) / 10;
}
// אחוז רווח למחיר לצרכן כולל מע"מ (מוריד מע"מ ואז margin)
function marginInc(priceInc, costEx, vat) { return margin(noVat(priceInc, vat), costEx); }
// החלטה 3: עלות מארז ממחיר קרטון (ct = מספר מארזים בקרטון, שלם וחיובי), ומחיר קרטון ממחיר מארז
const ctOk = (ct) => { const n = num(ct); return n != null && n > 0 && Number.isInteger(n) ? n : null; };
function packCost(cartonPrice, ct) { const p = num(cartonPrice), k = ctOk(ct); return p == null || k == null ? null : sh(Math.round(ag(p) / k)); }
function cartonPrice(packPrice, ct) { const p = num(packPrice), k = ctOk(ct); return p == null || k == null ? null : sh(ag(p) * k); }
// עלות ליחידת מלאי (מארז) לפי היחידה שבחשבונית: 'ct' = המחיר לקרטון (מחולק ב-ct); 'u' / 'pk' = כבר ליחידת המלאי
function unitCost(cost, unit, ct) { return unit === 'ct' ? packCost(cost, ct) : (num(cost) == null ? null : sh(ag(num(cost)))); }
// שינוי עלות (תוספת ב'): עלות חדשה מול קודמת, שתיהן לפני מע"מ, באגורות. 'up' | 'down' | '' (זהה / חסר)
function costChange(newEx, oldEx) {
  const a = num(newEx), b = num(oldEx);
  if (a == null || b == null) return '';
  const d = ag(a) - ag(b);
  return d > 0 ? 'up' : d < 0 ? 'down' : '';
}

const api = { num, ag, roundWs, wsDefault, withVat, noVat, margin, marginInc, packCost, cartonPrice, unitCost, costChange, WS_MUL, VAT0 };
// שרת (Node) – module.exports; מסך התמחור (דפדפן) – window.PricingCalc. אותו קובץ בדיוק: app-source/www/pricing-calc.js (בדיקה ב-pricing-calc.unit.test.js)
if (typeof module === 'object' && module.exports) module.exports = api; else root.PricingCalc = api;
})(typeof self !== 'undefined' ? self : this);
