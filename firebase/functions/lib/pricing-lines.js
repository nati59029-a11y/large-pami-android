// תמחור מחשבונית ספק, שלב 2 (משימה 2026-11-12_תמחור-חשבונית-ספק): פענוח התשובה של scanDocument kind:'invlines' (הנחיה INVL_P ב-index.html)
// לשורות במבנה ש-piCreate מצפה לו (firebase/functions/pricing.js, LINE_KEYS). פונקציה טהורה – בלי רשת ובלי DOM. אף פעם לא זורקת:
// תשובה פגומה / חסרה = { lines: [] } ושאר השדות ריקים.
//
//   invLines(data, vat?) → { sup, inv, date, lines:[{ n, bc?, sku?, qty, unit, pk?, ct?, cost?, raw?, chk? }], chk:[סיבה|''], bad }
//     qty  = כמות ביחידות מלאי (מארזים; החלטה 3) – זה מה ש-piFinish מוסיף למלאי. שורת קרטונים: קרטונים × ct.
//            שורת קרטונים בלי ct: qty = מספר הקרטונים (לא הומר) והשורה "לבדיקה" – כשממלאים ct במסך, הכמות = קרטונים × ct.
//     unit = היחידה שבחשבונית (u / pk / ct), להצגה בלבד.
//     cost = עלות ליחידת מלאי לפני מע"מ, אחרי הנחה בשורה. מחיר לקרטון – מחולק ב-ct (PricingCalc.unitCost).
//     raw  = מה שהיה כתוב בשורה (כמות, יחידה, מחיר, הנחה, סה"כ).
//     chk  = בשורה: הסיבה לבדיקה (רק כשיש), נשמרת בחשבונית (piCreate) – כך גם עובד אחר רואה את הסימון.
//            גם out.chk – לכל שורה (אותו אינדקס) הסיבה או '' – למסך התמחור.
//     n    = עד 60 תווים, כמו שם מוצר במלאי (saveProduct).
//     bad  = כמה שורות נזרקו (בלי שם ובלי ברקוד, או לא אובייקט).
// "לבדיקה": סה"כ השורה לא מתאים לכמות × מחיר (אחרי הנחה), חסרה כמות / עלות, או שורת קרטונים בלי כמות בקרטון.

(function (root) {
'use strict';
const PC = typeof module === 'object' && module.exports ? require('./pricing-calc') : root.PricingCalc;
const MAX_LINES = 100; // כמו בשרת
const BC_RE = /^[0-9A-Za-z-]{3,30}$/;
const DATE_RE = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UNITS = ['u', 'pk', 'ct'];
const UNIT_NAME = { u: 'יח׳', pk: 'מארז', ct: 'קרטון' };
// טקסט: בלי תווי בקרה ורווחים כפולים
const txt = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
// מספר מהזיהוי: גם "1,234.50" (פסיק אלפים) וגם "12,5" (פסיק עשרוני). שלילי / לא מספר = null
function nm(v) {
  if (typeof v === 'string' && v.includes(',') && v.includes('.')) v = v.replace(/,/g, '');
  return PC.num(v);
}
const int = (v) => { const n = nm(v); return n != null && n > 0 && n <= 100000 && Number.isInteger(n) ? n : null; };
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const fmt = (x) => String(r2(x));

function line(o, vat, inclVat) {
  const n = txt(o.name, 60);
  let bc = txt(o.barcode, 30).replace(/\s/g, '');
  if (!BC_RE.test(bc)) bc = '';
  if (!n && !bc) return null;
  const unit = UNITS.includes(o.unit) ? o.unit : 'u';
  const q0 = nm(o.qty), pk = int(o.pack_qty), ct = int(o.carton_qty);
  let price = nm(o.price), tot = nm(o.total);
  const dsc0 = nm(o.discount), dsc = dsc0 != null && dsc0 > 0 && dsc0 < 100 ? dsc0 : null;
  const why = [];
  if (inclVat) { price = PC.noVat(price, vat); tot = PC.noVat(tot, vat); }
  // מחיר ליחידה אחרי הנחה; בלי מחיר – מסה"כ השורה
  let eff = price != null ? price * (1 - (dsc || 0) / 100) : null;
  if (q0 == null || q0 === 0) why.push('חסרה כמות');
  else if (eff == null && tot != null) eff = tot / q0;
  else if (eff != null && tot != null) {
    const exp = q0 * eff, d = Math.abs(exp - tot);
    if (d > Math.max(0.1, tot * 0.005)) why.push(`סה"כ שורה ${fmt(tot)} ולא ${fmt(exp)} (כמות × מחיר)`);
  }
  if (unit === 'ct' && !ct) why.push('חסרה כמות בקרטון');
  const cost = eff == null ? null : PC.unitCost(Math.round(eff * 10000) / 10000, unit, ct);
  if (cost == null && !why.includes('חסרה כמות בקרטון')) why.push('חסרה עלות');
  // כמות ביחידות מלאי (מארזים): קרטונים × מארזים בקרטון
  let qty = q0 || 0;
  if (unit === 'ct' && ct) qty = qty * ct;
  qty = qty <= 100000 ? r3(qty) : 0;
  if (!qty && q0) why.push('כמות לא סבירה');
  const l = { n, qty, unit };
  if (bc) l.bc = bc;
  const sku = txt(o.sku, 30);
  if (sku) l.sku = sku;
  if (pk) l.pk = pk;
  if (ct) l.ct = ct;
  if (cost != null && cost <= 1000000) l.cost = cost;
  const was = [q0 != null ? fmt(q0) + ' ' + UNIT_NAME[unit] : '', price != null ? '× ' + fmt(price) : '', dsc ? 'הנחה ' + fmt(dsc) + '%' : '', tot != null ? '= ' + fmt(tot) : '', inclVat ? '(לפני מע"מ)' : ''].filter(Boolean).join(' ');
  const c = why.join('; ');
  const raw = was.trim().slice(0, 200);
  if (raw) l.raw = raw;
  if (c) l.chk = c.slice(0, 120);
  return { l, c };
}

function invLines(data, vat) {
  const out = { sup: '', inv: '', date: '', lines: [], chk: [], bad: 0 };
  try {
    if (typeof data === 'string') { try { data = JSON.parse(data.replace(/```json|```/g, '').trim()); } catch (e) { return out; } }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
    out.sup = txt(data.supplier, 60);
    out.inv = txt(data.number, 30);
    const d = txt(data.date, 10);
    out.date = DATE_RE.test(d) ? d : '';
    const L = Array.isArray(data.lines) ? data.lines : [];
    const inclVat = data.prices_include_vat === true;
    for (const o of L) {
      if (out.lines.length >= MAX_LINES) { out.bad++; continue; }
      let r = null;
      try { r = o && typeof o === 'object' && !Array.isArray(o) ? line(o, vat, inclVat) : null; } catch (e) { r = null; }
      if (!r) { out.bad++; continue; }
      out.lines.push(r.l); out.chk.push(r.c);
    }
  } catch (e) { /* תשובה פגומה – מה שנאסף עד עכשיו */ }
  return out;
}

const api = { invLines };
// דפדפן: window.PricingLines (צריך את pricing-calc.js לפני). Node (בדיקות): module.exports
if (typeof module === 'object' && module.exports) module.exports = api; else root.PricingLines = api;
})(typeof self !== 'undefined' ? self : this);
