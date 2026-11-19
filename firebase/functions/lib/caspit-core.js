// סנכרון כספית – ליבה טהורה (17.11.2026, שלב A1). בלי Firestore ובלי DOM.
// אותו קובץ בדיוק: app-source/www/caspit-core.js ו-firebase/functions/lib/caspit-core.js (בדיקה ב-caspit-core.unit.test.js).
// הטלפון קורא את הקובץ (Excel/CSV) ומקבץ לפי קוד פריט (detect + groupCat); השרת מנקה (clean), מחליט (decide) ומפיק CSV (csvNew/csvPrice).
// כך גם "רובוט" עתידי בשרת ישתמש באותם כללים.
//
// ניקוי הקטלוג (החלטות בעל העסק 17.11.2026):
//   מוצר אחד לכל קוד פריט; כל הברקודים של הקוד נשמרים (הראשון התקין = ברקוד ראשי, השאר = bx).
//   מסוננים: קודים מיוחדים (skip: 1000, 9999, 6666, 5555, 8888 – ניתן לשינוי בהגדרות), קוד לא תקין, שם ריק או בלי אף אות,
//   מחיר חסר/שלילי, ומחיר 0 עם שם של פחות מ-4 תווים (שורות זבל, למשל "חל").
//   כפולים: אותו שם (אחרי נרמול רווחים ואותיות), אותו מחיר ואותם צבע/מידה → מאוחדים למוצר אחד (הקוד הראשון בקובץ), וכל הקודים מקושרים אליו.
//   עלות שונה בקוד שאוחד – אזהרה (mcost). וריאנט (צבע/מידה אחרים) – מוצר נפרד.
//   אותו שם ומחיר/וריאנט שונה – לא מאוחדים: אזהרה + dn ("שם כפול – לבדוק" באפליקציה, החלטה 10). שם מעל 60 תווים מקוצר ל-59 + "…" (אזהרה).
//   ברקוד: קידומת סורק "$"/"*" מוסרת. ברקוד לא תקין (/^[0-9A-Za-z-]{3,30}$/) – לא נשמר, המוצר נשאר (אזהרה). ברקוד שכבר שייך לקוד אחר – נשאר רק בראשון (אזהרה).
//
// החלטת מחיר/עלות (decide) – f = הערך בכספית עכשיו, a = הערך באפליקציה עכשיו, s = { fb, ab, pd } מהסנכרון הקודם
//   (fb = כספית, ab = אפליקציה, pd = ערך שנשלח לכספית בקובץ וטרם נקלט). null = אין ערך (עלות 0 בכספית = אין עלות).
//   act: same (שניהם ריקים) · base (שווים – רק מעדכנים את נקודת ההשוואה) · ack (כספית קלטה את הקובץ) · in (מכספית לאפליקציה)
//        out (מהאפליקציה לכספית) · conf (שניהם השתנו – האפליקציה מנצחת, יוצא לכספית) · first (סנכרון ראשון ושונים – בעל העסק בוחר, ברירת מחדל האפליקציה)
(function (root) {
'use strict';
const SKIP = ['1000', '9999', '6666', '5555', '8888'];
const NAME_MAX = 60;
const BC_RE = /^[0-9A-Za-z-]{3,30}$/;
const CODE_RE = /^[0-9A-Za-z_-]{1,30}$/;
const NEW_FROM = 900000; // קוד כספית לפריט חדש מהאפליקציה (החלטה 2)
const PART = 1500; // פריטים בכל חלק שנשלח לשרת
// כותרות התבניות של כספית – בדיוק כמו בקבצים לדוגמה (UTF-8 עם BOM, פסיקים, LF)
const HDR_NEW = ['קוד פריט', 'ברקוד', 'שם פריט', 'צבע', 'מידה', 'מחיר לצרכן כולל מעמ', 'מחיר בחנות', 'מחיר עלות אחרי הנחות לא כולל מעמ', 'מחיר עלות אחרי הנחות כולל מעמ', 'אפשר מחיר אפס', 'כמות במלאי', 'פריט ללא מעמ', 'שם קטגוריה ראשית', 'שם קטגוריה משנית', 'פריט תוספת', 'פריט אב', 'פריט שקיל', 'הצג בתפריט ראשי', 'אל תציג בתפריט', 'שם ספק', 'קוד פריט ספק', 'מותג', 'משפחה', 'עונה', 'מגוון תפריט', 'שם תפריט תצוגה', 'שם תפריט משני תצוגה', 'שם תפריט תצוגה שלישי', 'קבוצה', 'תת קבוצה', 'הוראות הכנה', 'הוראות הכנה שירות עצמי', 'פתיחת חלון הוראות הכנה שירות עצמי אוטומטית', 'פתיחת חלון הוראות הכנה אוטומטית', 'מדפסות בונים', 'תיאור פריט מורחב', 'מידה מוצהרת של הפריט', 'יחידת מידה מוצהרת לפריט', 'יחידת מידה להצגה', 'פריט נעול', 'מנהל מלאי', 'פריט אחוזים', 'פריט אינו צובר נקודות', 'דורש סיסמת מנהל', 'חייב מע”מ תמיד', 'שינוי שם לפריט כללי', 'פריט לא יכול לקבל הנחה', 'לא זמין למכירה בקופה', 'חלק מאריזה', 'תיאור פריט קצר', 'פריט לא נשלח לאתר אינטרנט', 'מחיר לאחר הנחה באתר', 'מלל נוסף שיודפס ב-בון', 'הודעה בעת הוספת פריט', 'שובר הדפסה לפריט', 'זמינות בוולט לפי מלאי', 'שורה אחת בלבד לפריט בחשבון', 'מחיר לפי מדרגת משקל', 'מדרגות מחיר לפי משקל'];
const HDR_PRICE = ['קוד פריט', 'מחיר לצרכן כולל מעמ', 'מחיר עלות אחרי הנחות לא כולל מעמ', 'מחיר עלות אחרי הנחות כולל מעמ'];
// עמודות הקטלוג (ייצוא "קטלוג פריטים" מכספית). המחיר = "מחיר לצרכן" (לא "מחיר בחנות" – החלטה 4). עלות = "מחיר עלות" (כולל מע"מ, כמו באפליקציה)
const CAT = { c: 'קוד פריט', n: 'שם פריט', bc: 'ברקוד', col: 'צבע', sz: 'מידה', sup: 'ספק', c1: 'קטגוריה ראשית', c2: 'קטגוריה משנית', cost: 'מחיר עלות', p: 'מחיר לצרכן', nv: 'פריט ללא מעמ' };
const SALES = ['מספר עסקה', 'פדיון', 'מספר ברקוד']; // דוח מכירות – זיהוי (הקליטה – parseSales, A2)
// עמודות "דוח מכירות לפריטים" מכספית. "מספר ברקוד" = קוד הפריט בכספית. אין עמודת כמות – הכמות מחושבת (qtyOf)
const SAL = { d: 'תאריך מכירה', n: 'שם פריט', c: 'מספר ברקוד', tx: 'מספר עסקה', bn: 'שם סניף', bno: 'מספר סניף', w: 'משקל', ds: 'הנחה', a: 'פדיון' };
const WHY = { skip: 'קוד מיוחד', code: 'קוד פריט לא תקין', noname: 'בלי שם', junk: 'שם קצר ומחיר 0', price: 'מחיר חסר או שלילי' };
const WARN = { long: 'שם ארוך – קוצר', badbc: 'ברקוד לא תקין – לא נשמר', dupbc: 'ברקוד של קוד אחר – לא נשמר', p0: 'מחיר 0', same: 'שם זהה לקוד אחר (מחיר/צבע/מידה שונים) – לא אוחד, מסומן "שם כפול – לבדוק"', mcost: 'אוחד, אבל העלות שלו שונה מהקוד הראשי – נשמרה העלות של הראשי', sku: 'קוד פריט אחר באפליקציה – לא נדרס' };

const str = (v) => (v == null ? '' : String(v)).replace(/^﻿/, '').trim();
const hk = (s) => str(s).replace(/[”“״"]/g, '"').replace(/\s+/g, ' ');
// מספר מהקובץ: 12.5, "1,234.50", "12,5", "₪ 9.90", "5-" (מינוס בסוף). לא מספר → NaN
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = str(v).replace(/[₪\s‎‏]/g, '');
  if (!s) return NaN;
  if (/^-?\d+(\.\d+)?e[-+]?\d{1,3}$/i.test(s)) return +s; // כתיב מדעי מכספית (למשל הנחה 1.7763568394002505e-15 = 0)
  let neg = false;
  if (/^-/.test(s)) { neg = true; s = s.slice(1); } else if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  // פסיק: עשרוני ("12,5") או מפריד אלפים תקין ("1,234" / "1,234.50") בלבד. "1.234,50" / "1,2,3" – לא ברור → NaN (לא מנחשים סכום כסף)
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else if (s.includes(',')) { if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return NaN; s = s.replace(/,/g, ''); }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return NaN;
  const n = +s;
  return neg ? -n : n;
}
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const eq = (x, y) => (x == null && y == null) || (x != null && y != null && Math.abs(x - y) < 0.005);
// מפתח לשם (איחוד כפולים): רווחים מנורמלים, אותיות קטנות, מירכאות אחידות
const nameKey = (s) => hk(s).toLowerCase().replace(/['׳`]/g, "'");
const hasLetter = (s) => /\p{L}/u.test(s);
// ברקוד: בלי קידומת של סורק ("$6923538223502" → "6923538223502")
const bcNorm = (b) => str(b).replace(/^[$*]+/, '');
const vk = (a) => (Array.isArray(a) ? a.map(hk).filter(Boolean).sort().join('/') : '');

// ---------- זיהוי הקובץ ----------
// rows = מערך שורות (כל שורה מערך תאים), כמו readTable באפליקציה. הכותרת – באחת מ-10 השורות הראשונות.
function detect(rows) {
  const R = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < Math.min(10, R.length); i++) {
    const h = (Array.isArray(R[i]) ? R[i] : []).map(hk);
    const at = (name) => h.indexOf(hk(name));
    if (at(CAT.c) >= 0 && at(CAT.p) >= 0) {
      const map = {};
      for (const [k, v] of Object.entries(CAT)) map[k] = at(v);
      return { kind: 'cat', hi: i, map };
    }
    if (SALES.every((x) => at(x) >= 0)) {
      const map = {};
      for (const [k, v] of Object.entries(SAL)) map[k] = at(v);
      return { kind: 'sales', hi: i, map };
    }
  }
  return { kind: null };
}
// קידוד CSV: קודם UTF-8 קפדני, ואם נכשל – windows-1255 (כמו decText באפליקציה)
function decode(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u).replace(/^﻿/, ''); } catch (e) { /* לא UTF-8 */ }
  return new TextDecoder('windows-1255').decode(u);
}

// ---------- קיבוץ הקטלוג לפי קוד ----------
// → { items:[{ c, n, bcs:[], p, cost, nv, c1, c2, sup }], rows, noCode, pdiff:[קודים שבהם המחיר שונה בין השורות] }
function groupCat(rows, det) {
  const d = det || detect(rows);
  if (d.kind !== 'cat') throw new Error('זה לא קובץ קטלוג של כספית');
  const m = d.map, get = (r, k) => (m[k] >= 0 ? r[m[k]] : '');
  const by = new Map(); let n = 0, noCode = 0; const pdiff = [];
  for (let i = d.hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.every((x) => str(x) === '')) continue;
    n++;
    const c = str(get(r, 'c'));
    if (!c) { noCode++; continue; }
    const bc = str(get(r, 'bc'));
    let it = by.get(c);
    if (!it) {
      const cost = num(get(r, 'cost'));
      it = { c, n: str(get(r, 'n')), bcs: [], col: [], sz: [], p: num(get(r, 'p')), cost: cost > 0 ? r2(cost) : null, nv: str(get(r, 'nv')) === 'כן',
        c1: str(get(r, 'c1')), c2: str(get(r, 'c2')), sup: str(get(r, 'sup')) };
      by.set(c, it);
    } else {
      if (!it.n) it.n = str(get(r, 'n'));
      const p = num(get(r, 'p'));
      if (!Number.isNaN(p) && !eq(p, it.p) && !pdiff.includes(c)) pdiff.push(c);
    }
    if (bc && !it.bcs.includes(bc)) it.bcs.push(bc);
    for (const [k, a] of [['col', it.col], ['sz', it.sz]]) { const v = hk(get(r, k)); if (v && !a.includes(v)) a.push(v); } // וריאנטים (צבע/מידה) – חלק ממפתח האיחוד
  }
  return { items: [...by.values()], rows: n, noCode, pdiff };
}

// ---------- ניקוי, איחוד כפולים, ברקודים ----------
// items = מ-groupCat (או מהשרת אחרי ניקוי הקלט). opt.skip = קודים מיוחדים.
// → { keep:[{ c, n, bc, bx:[], p, cost, nv, c1, c2, sup, m:[קודים שאוחדו אליו] }], merged:[{ c, to, n }], filt:[{ c, n, why }], warn:[{ c, w, v? }], cnt }
function clean(items, opt) {
  const skip = new Set(((opt && opt.skip) || SKIP).map(String));
  const keep = [], merged = [], filt = [], warn = [];
  const byKey = new Map();
  for (const x of items || []) {
    const c = str(x.c), n0 = hk(x.n), p = typeof x.p === 'number' ? x.p : num(x.p);
    if (skip.has(c)) { filt.push({ c, n: n0, why: 'skip' }); continue; }
    if (!CODE_RE.test(c) || /^__.*__$/.test(c)) { filt.push({ c, n: n0, why: 'code' }); continue; }
    if (!n0 || !hasLetter(n0)) { filt.push({ c, n: n0, why: 'noname' }); continue; }
    if (Number.isNaN(p) || p < 0 || p > 1000000) { filt.push({ c, n: n0, why: 'price' }); continue; }
    if (p === 0 && n0.replace(/\s/g, '').length < 4) { filt.push({ c, n: n0, why: 'junk' }); continue; }
    // מפתח איחוד: שם + מחיר + צבעים + מידות (וריאנט אחר = מוצר אחר)
    const k = [nameKey(n0), r2(p), vk(x.col), vk(x.sz)].join('|');
    const prim = byKey.get(k);
    if (prim) {
      merged.push({ c, to: prim.c, n: n0 });
      prim.m.push(c);
      for (const b of (x.bcs || []).map(bcNorm)) if (b && !prim.raw.includes(b)) prim.raw.push(b);
      if (prim.cost == null && x.cost > 0) prim.cost = r2(x.cost);
      else if (x.cost > 0 && !eq(r2(x.cost), prim.cost)) warn.push({ c, w: 'mcost', v: `${r2(x.cost)} ≠ ${prim.cost} (קוד ${prim.c})` });
      continue;
    }
    const it = { c, n: n0, col: (x.col || []).slice(), sz: (x.sz || []).slice(), p: r2(p), cost: x.cost > 0 ? r2(x.cost) : null, nv: x.nv === true, c1: hk(x.c1).slice(0, 40), c2: hk(x.c2).slice(0, 40), sup: hk(x.sup).slice(0, 60), m: [], raw: (x.bcs || []).map(bcNorm).filter(Boolean) };
    byKey.set(k, it); keep.push(it);
  }
  // שם זהה במחיר שונה – אזהרה בלבד
  const names = new Map();
  for (const it of keep) { const k = nameKey(it.n); if (names.has(k)) { warn.push({ c: it.c, w: 'same', v: names.get(k).c }); it.dn = true; names.get(k).dn = true; } else names.set(k, it); } // dn = "שם כפול – לבדוק" (החלטה 10)
  const used = new Map();
  for (const it of keep) {
    if (it.n.length > NAME_MAX) { warn.push({ c: it.c, w: 'long', v: it.n }); it.n = it.n.slice(0, NAME_MAX - 1).trim() + '…'; }
    if (it.p === 0) warn.push({ c: it.c, w: 'p0' });
    const ok = [];
    for (const b of it.raw) {
      if (!BC_RE.test(b)) { warn.push({ c: it.c, w: 'badbc', v: b.slice(0, 40) }); continue; }
      if (used.has(b) && used.get(b) !== it.c) { warn.push({ c: it.c, w: 'dupbc', v: b }); continue; }
      used.set(b, it.c); if (!ok.includes(b)) ok.push(b);
    }
    it.bc = ok[0] || ''; it.bx = ok.slice(1); // כל הברקודים נשמרים (בלי תקרה)
    delete it.raw;
    if (!it.c1) delete it.c1;
    if (!it.c2 || !it.c1) delete it.c2;
    if (!it.sup || it.sup === 'ללא ספק') delete it.sup;
    if (!it.nv) delete it.nv;
    if (!it.col.length) delete it.col;
    if (!it.sz.length) delete it.sz;
  }
  const by = {}; for (const f of filt) by[f.why] = (by[f.why] || 0) + 1;
  return { keep, merged, filt, warn, cnt: { codes: (items || []).length, keep: keep.length, merged: merged.length, filt: filt.length, by } };
}

// ---------- החלטת מחיר / עלות ----------
function decide(f, a, s) {
  const st = s || {};
  if (f == null && a == null) return { act: 'same' };
  if (st.pd != null && eq(f, st.pd)) return eq(a, st.pd) ? { act: 'ack', v: a } : { act: 'out', v: a };
  if (eq(f, a)) return { act: 'base', v: a };
  if (st.fb === undefined) { // אין סנכרון קודם
    if (a == null) return { act: 'in', v: f };
    if (f == null) return { act: 'out', v: a };
    return { act: 'first', v: a, f };
  }
  const fc = !eq(f, st.fb), ac = !eq(a, st.ab) || st.pd != null; // נשלח וטרם נקלט = האפליקציה עדיין "השתנתה"
  if (fc && !ac) return f == null ? { act: 'out', v: a } : { act: 'in', v: f };
  if (fc && ac) return a == null ? { act: 'in', v: f } : { act: 'conf', v: a, f };
  return a == null ? { act: 'in', v: f } : { act: 'out', v: a }; // האפליקציה השתנתה, או שנשלח בעבר וטרם נקלט – יוצא שוב
}
// מה נשמר בסוף (נקודת ההשוואה הבאה): { fb, ab, pd? }. take = 'app' | 'cx' (בהבדל ראשון/קונפליקט)
function after(d, f, a, take) {
  const x = d.act;
  if (x === 'same') return { fb: null, ab: null };
  if (x === 'base' || x === 'ack') return { fb: d.v, ab: d.v };
  if (x === 'in' || (x === 'first' && take === 'cx')) return { fb: f, ab: f };
  return { fb: f == null ? null : f, ab: a, pd: a }; // out / conf / first (האפליקציה) – ממתין לקליטה בכספית
}

// ---------- CSV לכספית ----------
// תא: מירכאות כשיש פסיק/מירכאות/שורה חדשה; ערך שמתחיל ב- = + - @ (ולא מספר) מקבל גרש בהתחלה (הגנה מנוסחאות)
function cell(v) {
  if (v == null) return '';
  let s = typeof v === 'number' ? String(r2(v)) : String(v).replace(/[\r\n]+/g, ' ');
  if (typeof v !== 'number' && /^[=+\-@\t]/.test(s)) s = "'" + s;
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csv = (hdr, rows) => '﻿' + [hdr].concat(rows).map((r) => r.map(cell).join(',')).join('\n') + '\n';
const exVat = (c, vat, nv) => (c == null ? null : nv ? c : r2(c / (1 + (vat == null ? 18 : vat) / 100)));
// rows: [{ c, bc, n, p, cost, nv, c1, c2, sup }] – עמודות שלא ידועות נשארות ריקות (כולל "כמות במלאי" ו"מחיר בחנות")
function csvNew(rows, vat) {
  const ix = (h) => HDR_NEW.indexOf(h);
  return csv(HDR_NEW, (rows || []).map((r) => {
    const a = new Array(HDR_NEW.length).fill('');
    a[ix('קוד פריט')] = r.c; a[ix('ברקוד')] = r.bc || ''; a[ix('שם פריט')] = r.n;
    a[ix('מחיר לצרכן כולל מעמ')] = r.p;
    if (r.cost != null) { a[ix('מחיר עלות אחרי הנחות לא כולל מעמ')] = exVat(r.cost, vat, r.nv); a[ix('מחיר עלות אחרי הנחות כולל מעמ')] = r.cost; }
    a[ix('שם קטגוריה ראשית')] = r.c1 || ''; a[ix('שם קטגוריה משנית')] = r.c2 || ''; a[ix('שם ספק')] = r.sup || '';
    return a;
  }));
}
// rows: [{ c, p, cost, nv }] – מחיר תמיד; עלות רק כשיש באפליקציה (ריק = לא ידוע אם כספית משאירה או מאפסת – לא מאומת)
const csvPrice = (rows, vat) => csv(HDR_PRICE, (rows || []).map((r) => [r.c, r.p, r.cost != null ? exVat(r.cost, vat, r.nv) : '', r.cost != null ? r.cost : '']));
// קוד לפריט חדש: הבא מ-900000 ומעלה שלא תפוס
function nextCode(from, taken) {
  let n = Math.max(NEW_FROM, Number.isInteger(from) ? from : 0);
  while (taken.has(String(n))) n++;
  return n;
}
const parts = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n || PART) out.push(a.slice(i, i + (n || PART))); return out; };


// ---------- דוח מכירות → מלאי (A2) ----------
// כללים (תוכנית סעיף 4 + החלטות 4, 9, 12, 13):
//   כמות = פדיון / מחיר לצרכן (מחיר המוצר באפליקציה, ואם אין – המחיר האחרון מכספית). מספר שלם (סטייה עד 1 אגורה) → "בטוח".
//   אחרת (פדיון ± הנחה) / מחיר → "בטוח (הנחה)".
//   בדוח האמיתי (17.11) "פדיון" הוא לפני ההנחה (כל 112 השורות עם הנחה – פדיון = מחיר × כמות). לכן הסכום לתשלום = פדיון − הנחה (net). (לא מאומת מול כספית) אחרת → "לא בטוח": כמות מוצעת (מעוגלת, לפחות 1) שבעל העסק מאשר או מתקן. לא עוצר את שאר השורות.
//   פדיון שלילי = החזרה: כמות שלילית, המלאי עולה. קודים מיוחדים (skip) וקודים לא מוכרים – לא נוגעים במלאי, אבל נספרים בסיכומי המכירות.
//   שתי ה"קופות" בכספית (יהודה הנשיא 6265, נחל לכיש) = אותו מלאי (cxcfg.br). לכל שורה נשמר הסניף בכספית (bk) – להתאמה מול סגירת הקופה.
// מניעת ספירה כפולה (אין מזהה שורה בדוח): עסקה = סניף + תאריך + מספר עסקה. בכל עסקה, מפתח שורה = קוד|פדיון|הנחה|מופע,
//   כש"מופע" הוא המספר הסידורי בין שורות זהות לגמרי באותה עסקה. כך המפתח לא תלוי בסדר השורות בדוח (= הפרש אוספים עם חזרות),
//   והעלאה חוזרת או דוח חופף מוסיפים רק שורות שעוד לא נשמרו.
const SURE_TOL = 0.011; // סטייה מותרת: אגורה (שגיאות עיגול של כספית, למשל 14.700000000000001)
const p2 = (n) => String(n).padStart(2, '0');
// תאריך מהדוח: "16/11/2026", "16.11.26", "2026-11-16", מספר סידורי של Excel, או Date → "YYYY-MM-DD" ('' = לא תקין)
function dateOf(v) {
  const ok = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 2000 && y < 2100 ? `${y}-${p2(m)}-${p2(d)}` : ''; };
  if (v instanceof Date && !Number.isNaN(v.getTime())) return ok(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number' && Number.isFinite(v) && v > 30000 && v < 80000) { const t = new Date(Math.round((v - 25569) * 864e5)); return ok(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  const s = str(v);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(\s|$)/.exec(s);
  if (m) return ok(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return '';
}
// שעת המכירה מאותו תא "תאריך מכירה" (C1, 19.11.2026): "16/11/2026 14:32", "16/11/2026 14:32:05", "2026-11-16 14:32" / "2026-11-16T14:32:05",
//   מספר Excel עם שבר (46342.6055…), או Date. → דקות מתחילת היום (0–1439), או -1 = אין שעה (תאריך בלבד / לא תקין).
//   תאריך לא תקין → -1. אזור זמן מפורש (Z / +02:00) → -1 (לא ידוע אם זו שעת החנות). מספר Excel שלם / Date בדיוק בחצות = תאריך בלבד → -1.
//   dateOf לא משתנה (תאימות): הוא כבר מקבל תאריך ואחריו רווח ושעה.
function timeOf(v) {
  const hm = (h, m, sec) => (h >= 0 && h < 24 && m >= 0 && m < 60 && (sec == null || (sec >= 0 && sec < 60)) ? h * 60 + m : -1);
  if (v instanceof Date) { if (Number.isNaN(v.getTime()) || !dateOf(v)) return -1; return v.getHours() || v.getMinutes() || v.getSeconds() || v.getMilliseconds() ? hm(v.getHours(), v.getMinutes()) : -1; }
  if (typeof v === 'number') {
    if (!dateOf(v)) return -1;
    const ms = Math.round((v - 25569) * 864e5), r = ((ms % 864e5) + 864e5) % 864e5; // אותו עיגול כמו dateOf – השעה תמיד באותו יום
    return r ? Math.floor(r / 6e4) : -1;
  }
  const s = str(v);
  if (!dateOf(s)) return -1;
  const m = /^\d{4}-\d{1,2}-\d{1,2}(?:T|\s+)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/.exec(s) || /^\d{1,2}[/.-]\d{1,2}[/.-](?:\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  return m ? hm(+m[1], +m[2], m[3] == null ? null : +m[3]) : -1;
}
// סל שעה לפילוח: '00'–'23', ובלי שעה – 'na'
const HOUR_NA = 'na';
const hourKey = (t) => (Number.isInteger(t) && t >= 0 && t < 1440 ? p2(Math.floor(t / 60)) : HOUR_NA);
const HOUR_RE = /^(?:[01]\d|2[0-3]|na)$/;
// מפתח סניף בכספית: מספר הסניף (ספרות), ואם אין – השם בלי סימנים. משמש במזהי מסמכים (בלי "/")
function brKey(bno, bn) {
  const d = str(bno).replace(/\D/g, '').slice(0, 12);
  if (d) return d;
  const n = nameKey(bn).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return n || 'x';
}
const d8 = (d) => String(d).replace(/-/g, '');
const dayId = (bk, d) => `${bk}_${d8(d)}`;
const txKey = (tx) => str(tx).replace(/[^0-9A-Za-z-]/g, '').slice(0, 30);
const txId = (bk, d, tx) => `${dayId(bk, d)}_${txKey(tx)}`;
// rows = מ-readTable / parseCsv. → { lines:[{ d, c, n, tx, bk, bn, w, ds, a, t? }], bad:[{ r, why }], rows }
function parseSales(rows, det) {
  const dd = det || detect(rows);
  if (dd.kind !== 'sales') throw new Error('זה לא דוח מכירות של כספית');
  const m = dd.map, get = (r, k) => (m[k] >= 0 ? r[m[k]] : '');
  const lines = [], bad = []; let n = 0;
  for (let i = dd.hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.every((x) => str(x) === '')) continue;
    n++;
    const d = dateOf(get(r, 'd')), c = str(get(r, 'c')).slice(0, 40), tx = txKey(get(r, 'tx'));
    const a = num(get(r, 'a')), ds0 = str(get(r, 'ds')) === '' ? 0 : num(get(r, 'ds')), w0 = str(get(r, 'w')) === '' ? null : num(get(r, 'w'));
    // אותם גבולות כמו בשרת (cleanLine): שורה פגומה מסומנת כאן ולא מכשילה חלק שלם של 1,000 שורות
    const why = !d ? 'date' : !tx ? 'tx' : !c ? 'code' : Number.isNaN(a) || Math.abs(a) > 1000000 ? 'amount' : Number.isNaN(ds0) || Math.abs(ds0) > 1000000 ? 'disc' : w0 != null && !Number.isNaN(w0) && w0 > 100000 ? 'weight' : '';
    if (why) { bad.push({ r: i + 1, why }); continue; }
    const bn = hk(get(r, 'bn')).slice(0, 60), bno = str(get(r, 'bno')).replace(/\D/g, ''), bk = brKey(bno, bn);
    const o = { d, c, n: hk(get(r, 'n')).slice(0, 80), tx, bk, bn, w: w0 != null && !Number.isNaN(w0) && w0 > 0 ? Math.round(w0 * 1000) / 1000 : null, ds: r2(ds0), a: r2(a) };
    const t = timeOf(get(r, 'd')); if (t >= 0) o.t = t; // C1: שעת המכירה (דקות מתחילת היום) – רק כשיש בקובץ. לא חלק ממפתח השורה (k)
    if (!bno) o.bkn = true; // אין מספר סניף – המפתח לפי השם; השרת ממיר למספר הסניף המוכר (cxcfg.bkn), כדי שאותה מכירה לא תקבל מזהה אחר
    lines.push(o);
  }
  return { lines, bad, rows: n };
}
const SBAD = { date: 'תאריך לא תקין', tx: 'בלי מספר עסקה', code: 'בלי קוד פריט', amount: 'פדיון לא תקין', disc: 'הנחה לא תקינה', weight: 'משקל לא תקין' };
// כמות שסימנה הפוך לפדיון (מכירה עם כמות שלילית / החזרה עם כמות חיובית) – נדחית. 0 = בלי תנועת מלאי (מותר)
const qSignOk = (a, q) => !(q > 0 && a < 0) && !(q < 0 && a > 0);
// קיבוץ לעסקאות + מפתח שורה (קוד|פדיון|הנחה|מופע). → [{ id, bk, bn, d, tx, L:[{ ...line, k }] }] (לפי סדר ההופעה)
function salesGroup(lines) {
  const by = new Map();
  for (const l of lines || []) {
    const id = txId(l.bk, l.d, l.tx);
    let g = by.get(id);
    if (!g) { g = { id, bk: l.bk, bn: l.bn, d: l.d, tx: l.tx, L: [], occ: new Map() }; by.set(id, g); }
    const base = `${l.c}|${r2(l.a)}|${r2(l.ds || 0)}`;
    const o = g.occ.get(base) || 0; g.occ.set(base, o + 1);
    g.L.push(Object.assign({}, l, { k: `${base}|${o}` }));
  }
  return [...by.values()].map((g) => { delete g.occ; return g; });
}
// כמות לשורה. P = מחיר לצרכן; w = משקל (פריט שקיל). → { q, qs:'sure'|'disc'|'unsure', why? }
function qtyOf(a, ds, P, w) {
  const sg = a < 0 ? -1 : 1, dsa = Math.abs(ds || 0);
  const whole = (x) => { const q = Math.round(x / P); return q !== 0 && Math.abs(x - q * P) <= SURE_TOL ? q : null; };
  if (w != null && w > 0) return { q: sg * w, qs: 'unsure', why: 'weight' };
  if (!(P > 0)) return { q: sg, qs: 'unsure', why: 'noprice' };
  if (a !== 0) { const q = whole(a); if (q != null) return { q, qs: 'sure' }; }
  if (dsa > 0) for (const x of [a + sg * dsa, a - sg * dsa]) { const q = whole(x); if (q != null && Math.sign(q) === sg) return { q, qs: 'disc' }; }
  const sug = Math.max(1, Math.round(Math.abs(a + (a ? sg * dsa : dsa)) / P));
  return { q: sg * sug, qs: 'unsure', why: 'frac' };
}
const QS = { sure: 'בטוח', disc: 'בטוח (לפי ההנחה)', unsure: 'לא בטוח', skip: 'קוד מיוחד – בלי מלאי', nolink: 'קוד לא מוכר – בלי מלאי', own: 'תוקן ידנית', ok: 'אושר ידנית' };
const UNSURE_WHY = { weight: 'פריט שקיל', noprice: 'אין מחיר למוצר', frac: 'הפדיון לא מתחלק במחיר' };
const stockQ = (l) => ['sure', 'disc', 'unsure', 'own', 'ok'].includes(l.qs) && l.pid && typeof l.q === 'number'; // שורה שמשנה מלאי

// ---------- סיכום תקופה (A3) ----------
// days = מסמכי cxDay: { d, bk, bn, gross, ret, disc, ntx, nl, sp, un, it:{ קוד:{ n, q, r, a, u, cat, sp? } } }
// opt: { bk?: רק סניף אחד, cat?: רק קטגוריה }. → { gross, ret, net, disc, ntx, nl, sp, un, items:[…], br:{…}, cats:{…}, days:[…] }
function aggDays(days, opt) {
  const o = opt || {};
  const T = { gross: 0, ret: 0, net: 0, disc: 0, ntx: 0, nl: 0, sp: 0, un: 0, items: new Map(), br: {}, cats: {}, days: new Map() };
  for (const x of days || []) {
    if (!x || (o.bk && x.bk !== o.bk)) continue;
    const g = +x.gross || 0, rt = +x.ret || 0; // gross = פדיון מכירות, ret = פדיון החזרות (חיובי), disc = הנחות. net = gross − ret − disc
    T.gross += g; T.ret += rt; T.disc += +x.disc || 0; T.ntx += +x.ntx || 0; T.nl += +x.nl || 0; T.sp += +x.sp || 0; T.un += +x.un || 0;
    const b = T.br[x.bk] || (T.br[x.bk] = { bk: x.bk, bn: x.bn || x.bk, gross: 0, ret: 0, ntx: 0, disc: 0 });
    b.gross += g; b.ret += rt; b.ntx += +x.ntx || 0; b.disc += +x.disc || 0; if (x.bn) b.bn = x.bn;
    const dy = T.days.get(x.d) || { d: x.d, gross: 0, ret: 0, disc: 0, ntx: 0 };
    dy.gross += g; dy.ret += rt; dy.disc += +x.disc || 0; dy.ntx += +x.ntx || 0; T.days.set(x.d, dy);
    for (const [c, v] of Object.entries(x.it || {})) {
      if (!v) continue;
      const cat = v.cat || '';
      if (o.cat != null && cat !== o.cat) continue;
      let it = T.items.get(c);
      if (!it) { it = { c, n: v.n || '', q: 0, r: 0, a: 0, u: 0, cat, sp: !!v.sp, days: {} }; T.items.set(c, it); }
      if (v.n) it.n = v.n;
      if (v.cat) it.cat = v.cat;
      const na = (+v.a || 0) - (+v.ds || 0); // פדיון המוצר אחרי הנחה (החזרות במינוס)
      it.q += +v.q || 0; it.r += +v.r || 0; it.a += na; it.u += +v.u || 0;
      const dd = it.days[x.d] || (it.days[x.d] = { q: 0, r: 0, a: 0, u: 0 });
      dd.q += +v.q || 0; dd.r += +v.r || 0; dd.a += na; dd.u += +v.u || 0;
      const k = T.cats[cat] || (T.cats[cat] = { cat, a: 0, q: 0, n: 0 });
      k.a += na; k.q += (+v.q || 0) - (+v.r || 0);
    }
  }
  const R = (v) => r2(v), Q = (v) => Math.round(v * 1000) / 1000;
  const items = [...T.items.values()].map((it) => { for (const v of Object.values(it.days)) { v.a = R(v.a); v.q = Q(v.q); v.r = Q(v.r); } return Object.assign(it, { q: Q(it.q), r: Q(it.r), a: R(it.a) }); });
  for (const k of Object.values(T.cats)) { k.a = R(k.a); k.q = Q(k.q); k.n = items.filter((i) => i.cat === k.cat).length; }
  for (const b of Object.values(T.br)) { b.gross = R(b.gross); b.ret = R(b.ret); b.net = R(b.gross - b.ret - b.disc); b.disc = R(b.disc); }
  const dl = [...T.days.values()].map((d) => Object.assign(d, { gross: R(d.gross), ret: R(d.ret), net: R(d.gross - d.ret - d.disc), disc: R(d.disc) })).sort((a, b) => (a.d < b.d ? 1 : -1));
  return { gross: R(T.gross), ret: R(T.ret), net: R(T.gross - T.ret - T.disc), disc: R(T.disc), ntx: T.ntx, nl: T.nl, sp: R(T.sp), un: T.un, items, br: T.br, cats: T.cats, days: dl };
}
// מכירות לפי יום ולפי שעה (C1 – לבונוסי מכירות בשכר). days = מסמכי cxDay (cxSales + unpackDays); bk = רק סניף כספית אחד (אופציונלי).
//   cxDay.h = { 'HH'|'na': פדיון נטו (אחרי הנחה, החזרות במינוס) } – נשמר בשרת משורות המכירה (מ-19.11.2026).
//   → { day:{ 'YYYY-MM-DD': נטו }, hours:{ 'YYYY-MM-DD': { 'HH': ש"ח, na?: ש"ח } } }
//   יום שאין לו אף שעה ידועה (נתונים ישנים בלי h, או רק 'na' – קובץ בלי שעות) → hours[d] = {} (הקורא מחליט, למשל הערכה לפי יום).
//   יום עם פילוח חלקי (סניף/שורות שנקלטו לפני הפילוח) – ההפרש מהסך היומי נכנס ל-'na', כך שסכום השעות = הסך היומי.
function salesHours(days, bk) {
  const day = {}, hours = {}, has = {};
  for (const x of days || []) {
    if (!x || typeof x.d !== 'string' || (bk && x.bk !== bk)) continue;
    const net = (+x.gross || 0) - (+x.ret || 0) - (+x.disc || 0);
    day[x.d] = (day[x.d] || 0) + net;
    const H = hours[x.d] || (hours[x.d] = {});
    let sum = 0;
    if (x.h && typeof x.h === 'object' && !Array.isArray(x.h)) {
      for (const [k, v] of Object.entries(x.h)) { const a = +v; if (!HOUR_RE.test(k) || !Number.isFinite(a)) continue; H[k] = (H[k] || 0) + a; sum += a; if (k !== HOUR_NA) has[x.d] = true; }
    }
    if (Math.abs(net - sum) >= 0.005) H[HOUR_NA] = (H[HOUR_NA] || 0) + net - sum;
  }
  for (const d of Object.keys(day)) {
    day[d] = r2(day[d]);
    if (!has[d]) { hours[d] = {}; continue; }
    const H = hours[d];
    for (const k of Object.keys(H)) { H[k] = r2(H[k]); if (k === HOUR_NA && Math.abs(H[k]) < 0.005) delete H[k]; }
  }
  return { day, hours };
}
// מיון ורשימת מוצרים: by = 'q' (הכי נמכר) | 'a' (הכי הרבה פדיון). s = חיפוש (שם או קוד)
function itemList(items, by, s) {
  const k = nameKey(s || '');
  const L = k ? items.filter((i) => nameKey(i.n).includes(k) || String(i.c).includes(k)) : items.slice();
  return L.sort((x, y) => (by === 'a' ? y.a - x.a : y.q - x.q) || y.a - x.a || (x.c < y.c ? -1 : 1));
}

// ---------- התאמה מול סגירת קופה (A3) ----------
// days = cxDay (הסכום בכספית = פדיון − החזרות − הנחות); reg = { bk: קופה באפליקציה } (מיפוי חד-פעמי בהגדרות); zc = [{ id, reg, d, od, no, amt }] – סגירות קופה מהמכשיר (סכום ההכנסות שנכנסו מכל סגירה).
// th = סף הפער (0 = ללא סף). לכל יום ולכל קופה: כספית מול סגירה. סגירה שנפתחה בתאריך אחר (od ≠ d) = "לא ניתן להשוות".
// st: ok (תואם) · gap (פער עד הסף / אין סף) · over (פער מעל הסף) · noz (אין סגירה) · nocx (אין נתוני כספית) · span (לא ניתן להשוות)
function recon(days, reg, zc, th, regs) {
  const R = regs && regs.length ? regs.slice() : [...new Set(Object.values(reg || {}).concat((zc || []).map((z) => z.reg)))].filter(Boolean);
  const by = new Map(), un = new Map();
  const cell = (d, rg) => { const k = d + '|' + rg; if (!by.has(k)) by.set(k, { d, reg: rg, cx: 0, hasCx: false, bks: [], z: 0, zs: [], span: false }); return by.get(k); };
  for (const x of days || []) {
    const net = r2((+x.gross || 0) - (+x.ret || 0) - (+x.disc || 0)), rg = reg && reg[x.bk];
    if (!rg) { const u = un.get(x.d) || []; u.push({ bk: x.bk, bn: x.bn || x.bk, net }); un.set(x.d, u); continue; }
    const c = cell(x.d, rg); c.cx = r2(c.cx + net); c.hasCx = true; if (!c.bks.includes(x.bk)) c.bks.push(x.bk);
    c.sp = r2((c.sp || 0) + (+x.sp || 0));
  }
  for (const z of zc || []) {
    if (!z || !z.d || !z.reg) continue;
    const c = cell(z.d, z.reg); c.z = r2(c.z + (+z.amt || 0)); c.zs.push(z);
    if (z.od && z.od !== z.d) {
      c.span = true;
      // תיקון סבב 1: סגירה שנפתחה ביום אחר – גם יום הפתיחה וכל יום שבין הפתיחה לסגירה (לאותה קופה) "לא ניתן להשוות",
      // כי חלק מהכסף של הימים האלה נמצא בסגירה של יום אחר (עד 31 ימים אחורה)
      if (z.od < z.d) for (let d = z.od, k = 0; d < z.d && k < 31; d = addDay(d, 1), k++) { const s = cell(d, z.reg); s.span = true; (s.sx || (s.sx = [])).push(z); }
    }
  }
  const dset = [...new Set([...by.values()].map((c) => c.d).concat([...un.keys()]))].sort().reverse();
  const stOf = (c) => {
    if (c.span) return 'span';
    if (!c.zs.length) return c.hasCx ? 'noz' : 'none';
    if (!c.hasCx) return 'nocx';
    const g = r2(c.cx - c.z);
    if (Math.abs(g) < 0.01) return 'ok';
    return th > 0 && Math.abs(g) > th + 1e-9 ? 'over' : 'gap';
  };
  return dset.map((d) => {
    const regsD = R.map((rg) => { const c = by.get(d + '|' + rg) || { d, reg: rg, cx: 0, hasCx: false, bks: [], z: 0, zs: [], span: false }; const st = stOf(c); return Object.assign(c, { st, gap: ['ok', 'gap', 'over'].includes(st) ? r2(c.cx - c.z) : null }); })
      .concat([...by.values()].filter((c) => c.d === d && !R.includes(c.reg)).map((c) => Object.assign(c, { st: stOf(c), gap: null })));
    const live = regsD.filter((c) => c.st !== 'none');
    const tot = { cx: r2(live.reduce((s, c) => s + c.cx, 0)), z: r2(live.reduce((s, c) => s + c.z, 0)) };
    const bad = live.some((c) => c.st === 'span' || c.st === 'noz' || c.st === 'nocx');
    tot.st = !live.length ? 'none' : bad ? 'part' : (() => { const g = r2(tot.cx - tot.z); return Math.abs(g) < 0.01 ? 'ok' : th > 0 && Math.abs(g) > th + 1e-9 ? 'over' : 'gap'; })();
    tot.gap = ['ok', 'gap', 'over'].includes(tot.st) ? r2(tot.cx - tot.z) : null;
    return { d, regs: regsD, tot, un: un.get(d) || [] };
  });
}
function addDay(d, n) { const t = new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5); return t.toISOString().slice(0, 10); }
// תשובת cxSales בצורה קומפקטית (תיקון סבב 1 – גודל): days בלי it, ו-items: { קוד:{ n, cat, sp?, v:{ <מספר יום ברשימה>: [q, r, a, ds, u] } } }.
// packDays בשרת, unpackDays בטלפון (מחזיר מסמכי cxDay רגילים ל-aggDays/recon).
function packDays(docs) {
  const days = [], items = {};
  (docs || []).forEach((x, i) => {
    const { it, ...rest } = x; days.push(rest);
    for (const [c, v] of Object.entries(it || {})) {
      if (!v) continue;
      const o = items[c] || (items[c] = { n: v.n || '', cat: v.cat || '', v: {} });
      if (v.n) o.n = v.n; if (v.cat) o.cat = v.cat; if (v.sp) o.sp = true;
      o.v[i] = [+v.q || 0, +v.r || 0, +v.a || 0, +v.ds || 0, +v.u || 0];
    }
  });
  return { days, items };
}
function unpackDays(p) {
  const D = ((p && p.days) || []).map((x) => Object.assign({}, x, { it: {} }));
  for (const [c, o] of Object.entries((p && p.items) || {})) for (const [i, a] of Object.entries(o.v || {})) {
    const x = D[+i]; if (!x) continue;
    x.it[c] = Object.assign({ n: o.n, cat: o.cat, q: a[0], r: a[1], a: a[2], ds: a[3], u: a[4] }, o.sp ? { sp: true } : {});
  }
  return D;
}
// טווח תאריכים לחלקים של עד n ימים (cxSales מקבל עד 92 ימים בבקשה)
function chunks(from, to, n) { const out = []; let a = from; while (a <= to) { let b = addDay(a, (n || 92) - 1); if (b > to) b = to; out.push([a, b]); a = addDay(b, 1); } return out; }
const RST = { ok: 'תואם', gap: 'פער', over: 'פער מעל הסף', noz: 'אין סגירת קופה', nocx: 'אין נתוני כספית', span: 'לא ניתן להשוות – הסגירה נפתחה ביום אחר', part: 'לא ניתן להשוות את הסך היומי', none: '—' };

const api = { qSignOk, addDay, packDays, unpackDays, chunks, SAL, SBAD, QS, UNSURE_WHY, RST, SURE_TOL, dateOf, timeOf, hourKey, HOUR_NA, HOUR_RE, salesHours, brKey, dayId, txId, txKey, d8, parseSales, salesGroup, qtyOf, stockQ, aggDays, itemList, recon, bcNorm, SKIP, NAME_MAX, BC_RE, CODE_RE, NEW_FROM, PART, HDR_NEW, HDR_PRICE, CAT, WHY, WARN, num, eq, r2, str, nameKey, detect, decode, groupCat, clean, decide, after, cell, csvNew, csvPrice, exVat, nextCode, parts };
// שרת (Node) – module.exports; דפדפן – window.CaspitCore. אותו קובץ בדיוק: app-source/www/caspit-core.js
if (typeof module === 'object' && module.exports) module.exports = api; else root.CaspitCore = api;
})(typeof self !== 'undefined' ? self : this);
