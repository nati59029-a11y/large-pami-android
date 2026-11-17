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
const SALES = ['מספר עסקה', 'פדיון', 'מספר ברקוד']; // דוח מכירות – זיהוי בלבד בשלב A1 (הקליטה – A2)
const WHY = { skip: 'קוד מיוחד', code: 'קוד פריט לא תקין', noname: 'בלי שם', junk: 'שם קצר ומחיר 0', price: 'מחיר חסר או שלילי' };
const WARN = { long: 'שם ארוך – קוצר', badbc: 'ברקוד לא תקין – לא נשמר', dupbc: 'ברקוד של קוד אחר – לא נשמר', p0: 'מחיר 0', same: 'שם זהה לקוד אחר (מחיר/צבע/מידה שונים) – לא אוחד, מסומן "שם כפול – לבדוק"', mcost: 'אוחד, אבל העלות שלו שונה מהקוד הראשי – נשמרה העלות של הראשי', sku: 'קוד פריט אחר באפליקציה – לא נדרס' };

const str = (v) => (v == null ? '' : String(v)).replace(/^﻿/, '').trim();
const hk = (s) => str(s).replace(/[”“״"]/g, '"').replace(/\s+/g, ' ');
// מספר מהקובץ: 12.5, "1,234.50", "12,5", "₪ 9.90", "5-" (מינוס בסוף). לא מספר → NaN
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = str(v).replace(/[₪\s‎‏]/g, '');
  if (!s) return NaN;
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
    if (SALES.every((x) => at(x) >= 0)) return { kind: 'sales', hi: i, map: {} };
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

const api = { bcNorm, SKIP, NAME_MAX, BC_RE, CODE_RE, NEW_FROM, PART, HDR_NEW, HDR_PRICE, CAT, WHY, WARN, num, eq, r2, str, nameKey, detect, decode, groupCat, clean, decide, after, cell, csvNew, csvPrice, exVat, nextCode, parts };
// שרת (Node) – module.exports; דפדפן – window.CaspitCore. אותו קובץ בדיוק: app-source/www/caspit-core.js
if (typeof module === 'object' && module.exports) module.exports = api; else root.CaspitCore = api;
})(typeof self !== 'undefined' ? self : this);
