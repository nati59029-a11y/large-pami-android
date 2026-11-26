'use strict';
// בדיקות יחידה לליבת סנכרון כספית (lib/caspit-core.js, שלב A1) – בלי אמולטור. הרצה: node --test tests/caspit-core.unit.test.js
// כל הנתונים מומצאים (אין כאן שורות מהקבצים האמיתיים של העסק).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../functions/lib/caspit-core');
const WWW = path.join(__dirname, '../../app-source/www/caspit-core.js');

const H = ['קוד פריט', 'שם פריט', 'ברקוד', 'צבע', 'מידה', 'ספק', 'תאריך יצירה', 'קטגוריה ראשית', 'קטגוריה משנית', 'מחיר עלות', 'מחיר עלות ללא מעמ', 'מחיר לצרכן', "מחיר בחנות דמה", 'אחוז רווחיות', 'קוד פריט ספק', 'פריט ללא מעמ'];
const row = (c, n, bc, p, o) => { const r = new Array(H.length).fill(''); Object.assign(r, { 0: c, 1: n, 2: bc, 3: (o && o.col) || '', 4: (o && o.sz) || '', 5: (o && o.sup) || 'ללא ספק', 7: (o && o.c1) || '', 8: (o && o.c2) || '', 9: (o && o.cost) || 0, 10: 0, 11: p, 15: (o && o.nv) ? 'כן' : 'לא' }); return r; };
const CAT = [H,
  row('200001', 'כוס נייר לבנה', '7000000000011', 9.9, { cost: 5.9, c1: 'כלים', c2: 'כוסות', sup: 'ספק א' }),
  row('200001', 'כוס נייר לבנה', '7000000000028', 9.9, { cost: 5.9 }), // אותו קוד, ברקוד נוסף
  row('200002', 'צלחת גדולה', 'שגוי!', 12, {}), // ברקוד לא תקין
  row('200003', 'כוס נייר  לבנה', '7000000000035', 9.9, {}), // כפול בשם ובמחיר → מאוחד ל-200001
  row('200004', 'כוס נייר לבנה', '7000000000042', 11, {}), // אותו שם, מחיר שונה → לא מאוחד
  row('1000', 'פריט כללי', '', 0, {}), // קוד מיוחד
  row('200005', '8.9', '', 0, {}), // בלי אותיות
  row('200006', 'חל', '', 0, {}), // שם קצר ומחיר 0
  row('200007', 'ש'.repeat(70), '7000000000011', 5, {}), // שם ארוך + ברקוד של קוד אחר
  row('6954-7', 'מגש עם קוד מקף', '', 4.5, { nv: true }),
  row('200008', 'מחיר שגוי', '', -3, {}),
  row('200009', 'סרט סאטן', '', 5, { col: 'אדום' }), // וריאנט – לא מאוחד עם 200010
  row('200010', 'סרט סאטן', '', 5, { col: 'כחול' }),
  row('200011', 'מגש עגול', '$7000000000059', 8, { cost: 3 }), // ברקוד עם קידומת סורק "$"
  row('200012', 'מגש עגול', '', 8, { cost: 4 }), // מאוחד ל-200011, עלות שונה → אזהרה
];

describe('זיהוי קובץ וקיבוץ', () => {
  it('מזהה קטלוג, דוח מכירות, וקובץ לא מוכר', () => {
    assert.equal(C.detect(CAT).kind, 'cat');
    assert.equal(C.detect([['x'], ['מספר עסקה', 'תאריך', 'פדיון', 'מספר ברקוד']]).kind, 'sales');
    assert.equal(C.detect([['a', 'b']]).kind, null);
  });
  it('קידוד: UTF-8 עם BOM ו-windows-1255', () => {
    const u = Buffer.from('﻿קוד פריט,מחיר לצרכן\n', 'utf8');
    assert.equal(C.decode(u), 'קוד פריט,מחיר לצרכן\n');
    const w = Buffer.from([0xf7, 0xe5, 0xe3]); // "קוד" ב-windows-1255
    assert.equal(C.decode(w), 'קוד');
  });
  it('מספרים: פסיק אלפים, פסיק עשרוני, ₪, מינוס בסוף', () => {
    assert.equal(C.num('1,234.50'), 1234.5); assert.equal(C.num('12,5'), 12.5); assert.equal(C.num('₪ 9.90'), 9.9);
    assert.equal(C.num('5-'), -5); assert.equal(C.num(7), 7); assert.ok(Number.isNaN(C.num('abc'))); assert.ok(Number.isNaN(C.num('')));
    assert.equal(C.num('1,234'), 1234); assert.equal(C.num('12,345,678.9'), 12345678.9);
    for (const x of ['1.234,50', '1,2,3', '12,3456', '1,23,456']) assert.ok(Number.isNaN(C.num(x)), x); // לא מנחשים סכום כסף
  });
  it('קוד אחד = פריט אחד, כל הברקודים נאספים', () => {
    const g = C.groupCat(CAT);
    assert.equal(g.rows, 15);
    assert.equal(g.items.length, 14);
    assert.deepEqual(g.items[0].bcs, ['7000000000011', '7000000000028']);
    assert.equal(g.items[0].cost, 5.9);
  });
});

describe('ניקוי ואיחוד', () => {
  const r = C.clean(C.groupCat(CAT).items);
  const w = (c, k) => r.warn.some((x) => x.c === c && x.w === k);
  it('מסוננים לפי סיבה', () => {
    assert.deepEqual(Object.fromEntries(r.filt.map((f) => [f.c, f.why])), { 1000: 'skip', 200005: 'noname', 200006: 'junk', 200008: 'price' });
    assert.deepEqual(r.cnt.by, { skip: 1, noname: 1, junk: 1, price: 1 });
  });
  it('שם ומחיר זהים → מאוחדים, וכל הברקודים עוברים לראשי; מחיר שונה – לא מאוחד (אזהרה)', () => {
    assert.deepEqual(r.merged.map((m) => [m.c, m.to]), [['200003', '200001'], ['200012', '200011']]);
    const a = r.keep.find((x) => x.c === '200001');
    assert.deepEqual(a.m, ['200003']);
    assert.equal(a.bc, '7000000000011');
    assert.deepEqual(a.bx, ['7000000000028', '7000000000035']);
    assert.ok(r.keep.some((x) => x.c === '200004'));
    assert.ok(w('200004', 'same'));
  });
  it('ברקוד לא תקין לא נשמר אבל המוצר נשאר; ברקוד של קוד אחר נשאר רק בראשון', () => {
    const b = r.keep.find((x) => x.c === '200002');
    assert.equal(b.bc, ''); assert.ok(w('200002', 'badbc'));
    const l = r.keep.find((x) => x.c === '200007');
    assert.equal(l.bc, ''); assert.ok(w('200007', 'dupbc'));
  });
  it('שם מעל 60 תווים מקוצר עם סימן', () => {
    const l = r.keep.find((x) => x.c === '200007');
    assert.equal(l.n.length, 60); assert.ok(l.n.endsWith('…')); assert.ok(w('200007', 'long'));
  });
  it('קוד עם מקף נשמר; פריט ללא מע"מ; "ללא ספק" לא נשמר כספק', () => {
    const m = r.keep.find((x) => x.c === '6954-7');
    assert.ok(m && m.nv === true);
    assert.equal(r.keep.find((x) => x.c === '200002').sup, undefined);
    assert.equal(r.keep.find((x) => x.c === '200001').sup, 'ספק א');
  });
  it('רשימת קודים מיוחדים מההגדרות', () => {
    const r2 = C.clean(C.groupCat(CAT).items, { skip: ['6954-7'] });
    assert.ok(r2.filt.some((f) => f.c === '6954-7' && f.why === 'skip'));
    assert.ok(r2.keep.some((x) => x.c === '1000')); // 1000 כבר לא ברשימה המיוחדת → נקלט (מחיר 0, אזהרה)
    assert.ok(r2.warn.some((x) => x.c === '1000' && x.w === 'p0'));
  });
  it('ספירה: 14 קודים = 8 נקלטים + 2 מאוחדים + 4 מסוננים', () => {
    assert.deepEqual([r.cnt.codes, r.cnt.keep, r.cnt.merged, r.cnt.filt], [14, 8, 2, 4]);
  });
  it('וריאנט (צבע אחר) – מוצר נפרד; שם זהה – מסומן dn בשני המוצרים (החלטה 10)', () => {
    const a = r.keep.find((x) => x.c === '200009'), b = r.keep.find((x) => x.c === '200010');
    assert.ok(a && b); assert.equal(a.dn, true); assert.equal(b.dn, true);
    assert.deepEqual(a.col, ['אדום']);
    assert.equal(r.keep.find((x) => x.c === '200001').dn, true); // 200004 – אותו שם במחיר אחר
    assert.equal(r.keep.find((x) => x.c === '200002').dn, undefined);
  });
  it('איחוד עם עלות שונה – אזהרה mcost (לא נזרק בשקט)', () => {
    assert.ok(w('200012', 'mcost'));
    assert.equal(r.keep.find((x) => x.c === '200011').cost, 3);
  });
  it('ברקוד עם "$" נשמר בלי הקידומת; אין תקרה למספר הברקודים', () => {
    assert.equal(r.keep.find((x) => x.c === '200011').bc, '7000000000059');
    const many = [H].concat(Array.from({ length: 35 }, (_, i) => row('500001', 'מוצר רב ברקודים', String(7400000000000 + i), 3)));
    const k = C.clean(C.groupCat(many).items).keep[0];
    assert.equal(1 + k.bx.length, 35);
  });
});

describe('החלטת מחיר (המטריצה)', () => {
  const d = (f, a, s) => C.decide(f, a, s).act;
  it('סנכרון ראשון', () => {
    assert.equal(d(10, 10), 'base');
    assert.equal(d(10, 12), 'first');
    assert.equal(d(10, null), 'in');
    assert.equal(d(null, 12), 'out');
    assert.equal(d(null, null), 'same');
  });
  const s = { fb: 10, ab: 10 };
  it('רק כספית השתנתה → לאפליקציה; רק האפליקציה → לכספית; שתיהן → קונפליקט, האפליקציה מנצחת', () => {
    assert.deepEqual(C.decide(11, 10, s), { act: 'in', v: 11 });
    assert.deepEqual(C.decide(10, 12, s), { act: 'out', v: 12 });
    assert.deepEqual(C.decide(11, 12, s), { act: 'conf', v: 12, f: 11 });
    assert.equal(d(10, 10, s), 'base');
    assert.equal(d(11, 11, s), 'base');
  });
  it('נשלח לכספית (pd): נקלט → ack; טרם נקלט → יוצא שוב; כספית שינתה אחרת → קונפליקט', () => {
    const p = { fb: 10, ab: 12, pd: 12 };
    assert.equal(d(12, 12, p), 'ack');
    assert.equal(d(10, 12, p), 'out');
    assert.equal(d(12, 13, p), 'out'); // נקלט, והאפליקציה השתנתה שוב
    assert.equal(d(11, 12, p), 'conf');
  });
  it('after: נקודת ההשוואה הבאה', () => {
    assert.deepEqual(C.after(C.decide(11, 10, s), 11, 10), { fb: 11, ab: 11 });
    assert.deepEqual(C.after(C.decide(10, 12, s), 10, 12), { fb: 10, ab: 12, pd: 12 });
    assert.deepEqual(C.after(C.decide(10, 12), 10, 12, 'cx'), { fb: 10, ab: 10 });
    assert.deepEqual(C.after(C.decide(10, 12), 10, 12, 'app'), { fb: 10, ab: 12, pd: 12 });
    // סבב מלא: נשלח → כספית קלטה → מסונכרן
    const st = C.after(C.decide(10, 12, s), 10, 12);
    assert.equal(C.decide(12, 12, st).act, 'ack');
  });
});

describe('CSV לכספית', () => {
  it('פריטים חדשים: 59 עמודות בדיוק כמו התבנית, BOM, LF, עמודות לא ידועות ריקות', () => {
    const t = C.csvNew([{ c: '900000', bc: '7000000000097', n: 'מגש, "גדול"', p: 19.9, cost: 11.8, c1: 'כלים' }], 18);
    assert.ok(t.startsWith('﻿'));
    assert.ok(!t.includes('\r'));
    const L = t.slice(1).split('\n');
    assert.equal(L[0], C.HDR_NEW.join(','));
    assert.equal(C.HDR_NEW.length, 59);
    assert.equal(L[2], '');
    assert.ok(L[1].startsWith('900000,7000000000097,"מגש, ""גדול""",,,19.9,,10,11.8,,,,כלים,'));
  });
  it('עדכון מחיר: 4 עמודות; פריט ללא מע"מ – עלות זהה; בלי עלות – ריק', () => {
    const t = C.csvPrice([{ c: '6954-7', p: 4.5, cost: 2, nv: true }, { c: '200002', p: 12, cost: null }], 18);
    assert.equal(t, '﻿' + C.HDR_PRICE.join(',') + '\n6954-7,4.5,2,2\n200002,12,,\n');
  });
  it('הגנה מנוסחאות: ערך טקסט שמתחיל ב- = + - @ מקבל גרש; מספר שלילי וקוד עם מקף באמצע – לא', () => {
    assert.equal(C.cell('=1+2'), "'=1+2");
    assert.equal(C.cell('@x'), "'@x");
    assert.equal(C.cell('-x'), "'-x");
    assert.equal(C.cell('6954-7'), '6954-7');
    assert.equal(C.cell(-5), '-5');
  });
  it('קוד לפריט חדש: מ-900000, מדלג על קוד תפוס', () => {
    assert.equal(C.nextCode(0, new Set()), 900000);
    assert.equal(C.nextCode(900000, new Set(['900000', '900001'])), 900002);
  });
});

it('שני העותקים (שרת ואפליקציה) זהים, והעותק באפליקציה עובד בדפדפן מדומה', () => {
  const a = fs.readFileSync(WWW, 'utf8'), b = fs.readFileSync(path.join(__dirname, '../functions/lib/caspit-core.js'), 'utf8');
  assert.equal(a, b);
  const ctx = { self: {}, TextDecoder }; vm.createContext(ctx); vm.runInContext(a, ctx);
  const X = ctx.self.CaspitCore; assert.ok(X && typeof X.clean === 'function');
  assert.equal(X.clean(X.groupCat(CAT).items).cnt.keep, 8);
});

it('ביצועים: 9,000 קודים (11,000 שורות) – קיבוץ וניקוי מתחת לשנייה', () => {
  const R = [H];
  for (let i = 0; i < 9000; i++) { R.push(row(String(300000 + i), 'מוצר ' + i, String(7100000000000 + i), 1 + (i % 50))); if (i % 4 === 0) R.push(row(String(300000 + i), 'מוצר ' + i, String(7200000000000 + i), 1 + (i % 50))); }
  const t0 = Date.now();
  const r = C.clean(C.groupCat(R).items);
  assert.equal(r.cnt.keep, 9000);
  assert.ok(Date.now() - t0 < 1000, 'זמן: ' + (Date.now() - t0));
});

// ---------- A2/A3: דוח מכירות, כמות, מניעת כפילות, סיכום תקופה, התאמה מול סגירת קופה ----------
const SH = ['תאריך מכירה', 'שם פריט', 'מספר ברקוד', 'מספר עסקה', 'שם סניף', 'מספר סניף', 'משקל', 'הנחה', 'פדיון'];
const sl = (d, c, tx, a, ds, br, w) => [d, 'פריט ' + c, c, tx, (br || ['סניף א', '6200'])[0], (br || ['סניף א', '6200'])[1], w || '', ds == null ? '0.0' : ds, a];
describe('דוח מכירות (A2)', () => {
  it('תאריכים: dd/mm/yyyy, dd.mm.yy, ISO, מספר Excel; לא תקין → ריק', () => {
    assert.equal(C.dateOf('16/11/2026'), '2026-11-16');
    assert.equal(C.dateOf('6.1.26'), '2026-01-06');
    assert.equal(C.dateOf('2026-11-16'), '2026-11-16');
    assert.equal(C.dateOf(46342), '2026-11-16');
    assert.equal(C.dateOf('31/02/2026'), '');
    assert.equal(C.dateOf('x'), '');
  });
  it('מספר בכתיב מדעי (הנחה 1.77e-15) = כמעט 0, לא נדחה', () => {
    assert.ok(Math.abs(C.num('1.7763568394002505e-15')) < 1e-9);
    assert.ok(Math.abs(C.num('-8.881784197001252e-16')) < 1e-9);
  });
  it('windows-1255: קידוד מזוהה, הדוח מזוהה ומפוענח (שורות, סניף, החזרה, שורה פגומה)', () => {
    const txt = [SH, sl('16/11/2026', '300001', '5001', '29.700000000000003', '0.0'), sl('16/11/2026', '300002', '5001', '-4.5'), sl('xx', '300003', '5002', '1')].map((r) => r.join(',')).join('\r\n');
    const enc = new TextEncoder().encode(txt); // UTF-8 → מדמים windows-1255 בטבלת המרה פשוטה לאותיות עבריות
    const w1255 = []; for (const ch of txt) { const cp = ch.codePointAt(0); w1255.push(cp >= 0x5d0 && cp <= 0x5ea ? cp - 0x5d0 + 0xe0 : cp); }
    const dec = C.decode(Uint8Array.from(w1255));
    assert.ok(enc.length > w1255.length);
    assert.ok(dec.startsWith('תאריך מכירה'));
    const rows = dec.split(/\r?\n/).map((l) => l.split(','));
    assert.equal(C.detect(rows).kind, 'sales');
    const p = C.parseSales(rows);
    assert.equal(p.rows, 3); assert.equal(p.lines.length, 2); assert.deepEqual(p.bad, [{ r: 4, why: 'date' }]);
    assert.deepEqual(p.lines[0], { d: '2026-11-16', c: '300001', n: 'פריט 300001', tx: '5001', bk: '6200', bn: 'סניף א', w: null, ds: 0, a: 29.7, tm: { y: 0, n: 2, p: 'dd/dd/dddd', q: '' } }); // tm (C2) – רק בשורה הראשונה של כל תאריך
    assert.equal(p.lines[1].a, -4.5);
  });
  it('מפתח סניף: מספר, ואם אין – השם בלי סימנים', () => {
    assert.equal(C.brKey('6200', 'x'), '6200');
    assert.equal(C.brKey('', "סניף נחל/לכיש"), 'סניף-נחל-לכיש');
  });
  it('מניעת כפילות: מפתח = קוד|פדיון|הנחה|מופע – לא תלוי בסדר השורות; שורות זהות באותה עסקה נספרות בנפרד', () => {
    const rows = [SH, sl('16/11/2026', '1', '9', '10'), sl('16/11/2026', '1', '9', '10'), sl('16/11/2026', '2', '9', '5'), sl('16/11/2026', '1', '8', '10')];
    const k = (rs) => C.salesGroup(C.parseSales(rs).lines).flatMap((g) => g.L.map((l) => g.id + '#' + l.k)).sort();
    const a = k(rows), b = k([SH].concat(rows.slice(1).reverse()));
    assert.deepEqual(a, b);
    assert.deepEqual(a, ['6200_20261116_8#1|10|0|0', '6200_20261116_9#1|10|0|0', '6200_20261116_9#1|10|0|1', '6200_20261116_9#2|5|0|0']);
  });
  it('כמות: בטוח, לפי הנחה, החזרה, לא בטוח (שבר / אין מחיר / שקיל)', () => {
    assert.deepEqual(C.qtyOf(29.700000000000003, 0, 9.9), { q: 3, qs: 'sure' });
    assert.deepEqual(C.qtyOf(7, 3, 10), { q: 1, qs: 'disc' });
    assert.deepEqual(C.qtyOf(-10.9, 0, 10.9), { q: -1, qs: 'sure' });
    assert.deepEqual(C.qtyOf(13, 0, 10), { q: 1, qs: 'unsure', why: 'frac' });
    assert.deepEqual(C.qtyOf(26, 0, 10), { q: 3, qs: 'unsure', why: 'frac' });
    assert.deepEqual(C.qtyOf(-13, 0, 10), { q: -1, qs: 'unsure', why: 'frac' });
    assert.deepEqual(C.qtyOf(8, 0, null), { q: 1, qs: 'unsure', why: 'noprice' });
    assert.deepEqual(C.qtyOf(12, 0, 10, 1.2), { q: 1.2, qs: 'unsure', why: 'weight' });
    assert.ok(C.stockQ({ qs: 'sure', pid: 'p', q: 1 }) && !C.stockQ({ qs: 'skip', q: null }) && !C.stockQ({ qs: 'unsure', q: 1 }));
  });
});
describe('סיכום תקופה והתאמה (A3)', () => {
  const DAYS = [
    { d: '2026-11-16', bk: '6200', bn: 'א', gross: 100, ret: 10, disc: 5, ntx: 3, nl: 5, sp: 20, un: 1, it: { 300001: { n: 'מוצר א', cat: 'k1', q: 3, r: 1, a: 40, ds: 5, u: 1 }, 1000: { n: 'כללי', cat: '', q: 0, r: 0, a: 20, ds: 0, u: 0, sp: true } } },
    { d: '2026-11-16', bk: '7700', bn: 'ב', gross: 50, ret: 0, disc: 0, ntx: 1, nl: 1, sp: 0, un: 0, it: { 300002: { n: 'מוצר ב', cat: 'k1', q: 5, r: 0, a: 50, ds: 0, u: 0 } } },
    { d: '2026-11-17', bk: '6200', bn: 'א', gross: 30, ret: 0, disc: 0, ntx: 1, nl: 1, sp: 0, un: 0, it: { 300001: { n: 'מוצר א', cat: 'k1', q: 2, r: 0, a: 30, ds: 0, u: 0 } } },
  ];
  it('aggDays: סכומים (נטו = פדיון − החזרות − הנחות), מוצרים לפי יום, סניפים, קטגוריות, סינון לפי סניף', () => {
    const T = C.aggDays(DAYS);
    assert.deepEqual([T.gross, T.ret, T.disc, T.net, T.ntx, T.un, T.sp], [180, 10, 5, 165, 5, 1, 20]);
    const a = T.items.find((x) => x.c === '300001');
    assert.deepEqual([a.q, a.r, a.a, a.u, Object.keys(a.days).sort()], [5, 1, 65, 1, ['2026-11-16', '2026-11-17']]);
    assert.deepEqual([T.br['6200'].net, T.br['7700'].net], [115, 50]);
    assert.deepEqual([T.cats.k1.a, T.cats.k1.q, T.cats[''].a], [115, 9, 20]);
    assert.deepEqual(T.days.map((d) => [d.d, d.net]), [['2026-11-17', 30], ['2026-11-16', 135]]);
    assert.equal(C.aggDays(DAYS, { bk: '7700' }).net, 50);
  });
  it('itemList: מיון לפי כמות / פדיון, חיפוש בשם ובקוד', () => {
    const T = C.aggDays(DAYS);
    assert.deepEqual(C.itemList(T.items, 'q').map((x) => x.c), ['300001', '300002', '1000']);
    assert.deepEqual(C.itemList(T.items, 'a').map((x) => x.c), ['300001', '300002', '1000']);
    assert.deepEqual(C.itemList(T.items, 'q', 'מוצר ב').map((x) => x.c), ['300002']);
    assert.deepEqual(C.itemList(T.items, 'q', '1000').map((x) => x.c), ['1000']);
  });
  it('recon: תואם, פער מתחת/מעל הסף, אין סגירה, סניף לא ממופה, סך יומי', () => {
    const reg = { 6200: 'i_yh', 7700: 'i_nl' };
    const zc = [{ id: 'z1', reg: 'i_yh', d: '2026-11-16', od: '2026-11-16', amt: 85 }, { id: 'z2', reg: 'i_nl', d: '2026-11-16', od: '', amt: 30 }, { id: 'z3', reg: 'i_yh', d: '2026-11-17', od: '2026-11-17', amt: 25 }]; // סגירה שחוצה ימים – בבדיקות של תיקון סבב 1
    const R = C.recon(DAYS, reg, zc, 10, ['i_yh', 'i_nl']);
    assert.deepEqual(R.map((x) => x.d), ['2026-11-17', '2026-11-16']);
    const d16 = R[1];
    assert.deepEqual(d16.regs.map((c) => [c.reg, c.cx, c.z, c.st, c.gap]), [['i_yh', 85, 85, 'ok', 0], ['i_nl', 50, 30, 'over', 20]]);
    assert.deepEqual([d16.tot.cx, d16.tot.z, d16.tot.st, d16.tot.gap], [135, 115, 'over', 20]);
    assert.deepEqual(R[0].regs.map((c) => [c.st, c.gap]), [['gap', 5], ['none', null]]);
    assert.equal(R[0].tot.st, 'gap');
    assert.equal(C.recon(DAYS, reg, zc, 0, ['i_yh', 'i_nl'])[1].regs[1].st, 'gap'); // בלי סף – פער רגיל
    const u = C.recon(DAYS, { 6200: 'i_yh' }, [], 0, ['i_yh', 'i_nl']);
    assert.deepEqual(u[1].un, [{ bk: '7700', bn: 'ב', net: 50 }]);
    assert.equal(u[1].regs[0].st, 'noz');
  });
  it('recon: סגירה במבנה של סבב 4 (#123: ספירת שטרות cnt, cash, co) – אותה התאמה בדיוק', () => {
    const reg = { 6200: 'i_yh', 7700: 'i_nl' };
    const zc = [{ id: 'z1', reg: 'i_yh', d: '2026-11-16', od: '2026-11-16', amt: 85 }, { id: 'z2', reg: 'i_nl', d: '2026-11-16', od: '', amt: 30 }];
    const zc4 = zc.map((z) => Object.assign({ cnt: { 200: '1', 0.5: '3' }, cash: { c: 300, o: 301, a: 0, p: 0 }, co: { z: 1, s: 1, ids: ['x'], ok: 1, done: 0 }, dk: -2 }, z));
    assert.deepEqual(C.recon(DAYS, reg, zc4, 10, ['i_yh', 'i_nl']), C.recon(DAYS, reg, zc, 10, ['i_yh', 'i_nl']).map((d) => Object.assign(d, { regs: d.regs.map((c) => Object.assign(c, { zs: c.zs.map((z) => zc4.find((y) => y.id === z.id)) })) })));
  });
  it('ביצועים: 30 ימים × 2 סניפים × 600 מוצרים – סיכום מתחת ל-300ms', () => {
    const D = [];
    for (let d = 1; d <= 30; d++) for (const bk of ['6200', '7700']) { const it = {}; for (let i = 0; i < 600; i++) it[String(300000 + i)] = { n: 'מוצר ' + i, cat: 'k' + (i % 20), q: 2, r: 0, a: 20, ds: 0, u: 0 }; D.push({ d: '2026-11-' + String(d).padStart(2, '0'), bk, bn: bk, gross: 12000, ret: 0, disc: 0, ntx: 100, nl: 600, sp: 0, un: 0, it }); }
    const t0 = Date.now();
    const T = C.aggDays(D); const L = C.itemList(T.items, 'a', 'מוצר 5');
    assert.equal(T.items.length, 600); assert.ok(L.length > 0);
    assert.ok(Date.now() - t0 < 300, 'זמן: ' + (Date.now() - t0));
  });
});

describe('תיקון סבב 1 (A2/A3)', () => {
  it('recon: סגירה שנפתחה ב-16 ונסגרה ב-17 → גם יום 16 (יום הפתיחה) "לא ניתן להשוות", לא פער מזויף (התרחיש של הבודק)', () => {
    const days = [{ d: '2026-11-16', bk: '6200', gross: 1000, ret: 0, disc: 0 }];
    const zc = [{ id: 'A', reg: 'i_yh', d: '2026-11-16', od: '2026-11-16', amt: 600 }, { id: 'B', reg: 'i_yh', d: '2026-11-17', od: '2026-11-16', amt: 900 }];
    const R = C.recon(days, { 6200: 'i_yh' }, zc, 10, ['i_yh', 'i_nl']);
    const d16 = R.find((x) => x.d === '2026-11-16'), d17 = R.find((x) => x.d === '2026-11-17');
    assert.equal(d16.regs[0].st, 'span'); assert.equal(d16.regs[0].gap, null); assert.equal(d16.tot.st, 'part');
    assert.deepEqual(d16.regs[0].sx.map((z) => z.id), ['B']);
    assert.equal(d17.regs[0].st, 'span');
    assert.equal(d16.regs[1].st, 'none'); // רק הקופה של הסגירה מושפעת
  });
  it('recon: סגירה שחוצה כמה ימים – כל יום שבין הפתיחה לסגירה "לא ניתן להשוות"', () => {
    const R = C.recon([{ d: '2026-11-15', bk: '1', gross: 50 }], { 1: 'i_nl' }, [{ id: 'C', reg: 'i_nl', d: '2026-11-17', od: '2026-11-14', amt: 10 }], 0, ['i_yh', 'i_nl']);
    assert.deepEqual(R.map((x) => [x.d, x.regs[1].st]), [['2026-11-17', 'span'], ['2026-11-16', 'span'], ['2026-11-15', 'span'], ['2026-11-14', 'span']]);
  });
  it('packDays/unpackDays: אותו סיכום אחרי דחיסה; chunks של עד 92 ימים', () => {
    const D = [{ d: '2026-11-16', bk: '1', bn: 'א', gross: 30, ret: 5, disc: 1, ntx: 2, nl: 3, sp: 0, un: 1, it: { 10: { n: 'x', cat: 'k', q: 3, r: 1, a: 25, ds: 1, u: 1 }, 1000: { n: 'כללי', cat: '', q: 0, r: 0, a: 0, ds: 0, u: 0, sp: true } } }];
    const p = C.packDays(D);
    assert.ok(!p.days[0].it);
    assert.deepEqual(C.aggDays(C.unpackDays(JSON.parse(JSON.stringify(p)))), C.aggDays(D));
    assert.deepEqual(C.chunks('2026-01-01', '2026-01-01', 92), [['2026-01-01', '2026-01-01']]);
    const ch = C.chunks('2026-01-01', '2026-12-31', 92);
    assert.equal(ch.length, 4); assert.equal(ch[0][1], '2026-04-02'); assert.equal(ch[3][1], '2026-12-31');
  });
  it('parseSales: אותם גבולות כמו בשרת (הנחה/משקל) → שורה פגומה; בלי מספר סניף → bkn', () => {
    const p = C.parseSales([SH, sl('16/11/2026', '1', '9', '10', '2000000'), sl('16/11/2026', '1', '9', '10', '0', ['סניף א', ''])]);
    assert.deepEqual(p.bad, [{ r: 2, why: 'disc' }]);
    assert.equal(p.lines[0].bkn, true); assert.equal(p.lines[0].bk, 'סניף-א');
  });
  it('qSignOk: מכירה – חיובי או 0, החזרה – שלילי או 0', () => {
    assert.ok(C.qSignOk(10, 2) && C.qSignOk(10, 0) && C.qSignOk(-10, -1) && C.qSignOk(-10, 0));
    assert.ok(!C.qSignOk(10, -1) && !C.qSignOk(-10, 1));
  });
});

describe('C1: שעת מכירה ופילוח לפי שעה', () => {
  it('timeOf: תאריך+שעה (dd/mm/yyyy, ISO, שניות), מספר Excel עם שבר; תאריך בלבד / לא תקין → -1', () => {
    assert.equal(C.timeOf('16/11/2026 14:32'), 14 * 60 + 32);
    assert.equal(C.timeOf('16/11/2026 9:05:59'), 9 * 60 + 5);
    assert.equal(C.timeOf('16.11.26 23:59'), 1439);
    assert.equal(C.timeOf('2026-11-16 14:32'), 872);
    assert.equal(C.timeOf('2026-11-16T14:32:05.123'), 872);
    assert.equal(C.timeOf(46342 + 0.5), 720);
    assert.equal(C.timeOf(46342 + (14 * 60 + 32) / 1440), 872);
    assert.equal(C.timeOf(new Date(2026, 10, 16, 8, 15)), 495);
    for (const v of ['16/11/2026', '2026-11-16', 46342, new Date(2026, 10, 16), '', null, 'x', '31/02/2026 10:00', '16/11/2026 24:00', '16/11/2026 10:60', '2026-11-16T14:32:05Z', '2026-11-16T14:32+02:00', '16/11/2026 14:32 PM'])
      assert.equal(C.timeOf(v), -1, String(v));
    // dateOf לא השתנה: תאריך עם שעה → אותו יום
    assert.equal(C.dateOf('16/11/2026 23:59'), '2026-11-16');
    assert.equal(C.dateOf(46342.99999), '2026-11-16');
  });
  it('חצות: 00:00 = שעה 00 (לא "בלי שעה"); 23:59:59 נשאר באותו יום', () => {
    assert.equal(C.timeOf('17/11/2026 00:00'), 0);
    assert.equal(C.hourKey(C.timeOf('17/11/2026 00:00')), '00');
    assert.equal(C.timeOf('16/11/2026 23:59:59'), 1439);
    assert.equal(C.hourKey(1439), '23');
    const ms = 46342 + 86399 / 86400; // 23:59:59 כמספר Excel
    assert.equal(C.dateOf(ms), '2026-11-16'); assert.equal(C.timeOf(ms), 1439);
    assert.deepEqual([C.hourKey(-1), C.hourKey(undefined), C.hourKey(1440), C.hourKey(61)], ['na', 'na', 'na', '01']);
  });
  it('parseSales: t רק כשיש שעה; לא חלק ממפתח השורה (אותה מכירה עם/בלי שעה = אותו k)', () => {
    const rows = [SH, sl('16/11/2026 14:32', '1', '9', '10'), sl('16/11/2026', '2', '9', '5'), sl('17/11/2026 00:00', '1', '8', '10')];
    const p = C.parseSales(rows);
    assert.deepEqual(p.lines.map((l) => [l.d, l.t]), [['2026-11-16', 872], ['2026-11-16', undefined], ['2026-11-17', 0]]);
    assert.ok(!('t' in p.lines[1]));
    const k = (rs) => C.salesGroup(C.parseSales(rs).lines).flatMap((g) => g.L.map((l) => g.id + '#' + l.k));
    assert.deepEqual(k([SH, sl('16/11/2026 14:32', '1', '9', '10')]), k([SH, sl('16/11/2026', '1', '9', '10')]));
  });
  it('salesHours: לפי יום ושעה, כל הסניפים או סניף אחד; בלי שעה → na; יום ישן בלי h → {}; פילוח חלקי → ההפרש ל-na', () => {
    const days = [
      { d: '2026-11-16', bk: '6200', gross: 100, ret: 10, disc: 5, h: { 10: 50, 14: 30, na: 5 } },
      { d: '2026-11-16', bk: '7700', gross: 40, ret: 0, disc: 0, h: { 14: 40 } },
      { d: '2026-11-15', bk: '6200', gross: 70, ret: 0, disc: 0 }, // נתונים ישנים – בלי פילוח
      { d: '2026-11-17', bk: '6200', gross: 60, ret: 0, disc: 0, h: { '00': 20 } }, // חלקי: 40 נקלטו לפני הפילוח
      { d: '2026-11-18', bk: '6200', gross: 10, ret: 0, disc: 0, h: { 99: 5, x: 5, 12: 'abc' } }, // מפתחות לא תקינים – מתעלמים
    ];
    const all = C.salesHours(days);
    assert.deepEqual(all.day, { '2026-11-16': 125, '2026-11-15': 70, '2026-11-17': 60, '2026-11-18': 10 });
    assert.deepEqual(all.hours['2026-11-16'], { 10: 50, 14: 70, na: 5 });
    assert.deepEqual(all.hours['2026-11-15'], {});
    assert.deepEqual(all.hours['2026-11-17'], { '00': 20, na: 40 });
    assert.deepEqual(all.hours['2026-11-18'], {});
    const one = C.salesHours(days, '7700');
    assert.deepEqual(one, { day: { '2026-11-16': 40 }, hours: { '2026-11-16': { 14: 40 } } });
    // יום עם סניף חדש (עם h) וסניף ישן (בלי h): הישן נכנס ל-na, סכום השעות = הסך היומי
    const mix = C.salesHours([{ d: '2026-11-19', bk: 'a', gross: 30, h: { 11: 30 } }, { d: '2026-11-19', bk: 'b', gross: 12.5 }]);
    assert.deepEqual(mix.hours['2026-11-19'], { 11: 30, na: 12.5 });
    assert.deepEqual(C.salesHours([]), { day: {}, hours: {} });
    // קובץ בלי שעות: הכול ב-na → יום בלי שעות
    assert.deepEqual(C.salesHours([{ d: '2026-11-20', bk: 'a', gross: 9, h: { na: 9 } }]), { day: { '2026-11-20': 9 }, hours: { '2026-11-20': {} } });
  });
  it('C2 – AM/PM: timeOf ו-clockOf; 12 AM = 00, 12 PM = 12; שעה מעל 12 עם AM/PM → -1', () => {
    assert.equal(C.timeOf('16/11/2026 2:30 PM'), 14 * 60 + 30);
    assert.equal(C.timeOf('16/11/2026 02:30:59 pm'), 14 * 60 + 30);
    assert.equal(C.timeOf('16/11/2026 2:30 P.M.'), 14 * 60 + 30);
    assert.equal(C.timeOf('16/11/2026 2:30PM'), 14 * 60 + 30);
    assert.equal(C.timeOf('16/11/2026 9:05 AM'), 9 * 60 + 5);
    assert.equal(C.timeOf('16/11/2026 12:10 AM'), 10);
    assert.equal(C.timeOf('16/11/2026 12:10 PM'), 12 * 60 + 10);
    assert.equal(C.timeOf('2026-11-16 11:59 PM'), 1439);
    for (const v of ['16/11/2026 0:30 AM', '16/11/2026 13:00 PM', '16/11/2026 14:32 PM', '16/11/2026 2:30 XM']) assert.equal(C.timeOf(v), -1, v);
    assert.equal(C.dateOf('16/11/2026 2:30 PM'), '2026-11-16'); // dateOf לא השתנה
    assert.equal(C.clockOf('14:32'), 872); assert.equal(C.clockOf('2:32 pm'), 872); assert.equal(C.clockOf('14:32:05'), 872);
    assert.equal(C.clockOf(0.5), 720); assert.equal(C.clockOf(0), 0); assert.equal(C.clockOf('16/11/2026 14:32'), 872);
    for (const v of ['', null, 'x', '24:00', '13:00 PM', -0.1, 1.5]) assert.equal(C.clockOf(v), -1, String(v));
  });
  it('C2 – parseSales מחזיר tm { y, n, p, q }: דפוס מוסווה בלי ספרות ובלי אותיות אמיתיות; עותק בשורה הראשונה של כל תאריך', () => {
    const p = C.parseSales([SH, sl('16/11/2026', '1', '9', '10'), sl('16/11/2026 2:30 PM', '2', '9', '5'), sl('17/11/2026 Mon', '1', '8', '10'), sl('xx', '1', '7', '1')]);
    assert.deepEqual(p.tm, { y: 1, n: 2, p: 'dd/dd/dddd', q: 'dd/dd/dddd d:dd aa' });
    assert.equal(p.bad.length, 1);
    assert.deepEqual(p.lines.map((l) => !!l.tm), [true, false, true]); // 16.11 – הראשונה; 17.11 – הראשונה
    assert.deepEqual(p.lines[0].tm, p.tm); assert.notEqual(p.lines[0].tm, p.tm); // עותק
    assert.equal(p.lines[1].t, 870);
    // הסוואה: אין ספרות ואין אותיות אמיתיות בדפוס; עברית → h; מספר Excel → #; Date → @; עד 30 תווים
    assert.equal(C.tmMask('יום ב 14:00'), 'hhh h dd:dd');
    assert.equal(C.tmMask(46342.75), '#ddddd.dd');
    assert.equal(C.tmMask(new Date(2026, 10, 16)), '@');
    assert.equal(C.tmMask('16/11/2026 14:32:05 GMT+0200 (שעון ישראל)'), 'dd/dd/dddd dd:dd:dd aaa+dddd (hhhh hhhhh)'.slice(0, 30));
    assert.equal(C.tmMask('a\u200f€\tb'), 'a?? a');
    for (const v of ['16/11/2026 14:32', 'Nov 16, 2026 2:32:00 PM', '2026-11-16T14:32:05Z']) assert.ok(/^[dah #@:/.,+\-()'"_|?]*$/.test(C.tmMask(v)) && !/[0-9]/.test(C.tmMask(v)), v);
    // תאריך פגום לגמרי (כל השורות נדחו) – הדפוס עדיין מגיע
    const q = C.parseSales([SH, sl('11/16/2026 2:30 PM', '1', '9', '10')]);
    assert.equal(q.lines.length, 0); assert.deepEqual(q.tm, { y: 0, n: 0, p: 'dd/dd/dddd d:dd aa', q: '' });
  });
  it('C2 – עמודת שעה נפרדת ("שעת מכירה" או "שעה"): רשות, לא שוברת זיהוי; עדיפות לעמודה, ואם ריקה – מתוך התאריך', () => {
    for (const hn of ['שעת מכירה', 'שעה']) {
      const H = SH.concat([hn]), row = (d, t, c) => sl(d, c, '9', '10').concat([t]);
      const det = C.detect([H]);
      assert.equal(det.kind, 'sales'); assert.equal(det.map.h, 9);
      const p = C.parseSales([H, row('16/11/2026', '14:05', '1'), row('16/11/2026 09:00', '', '2'), row('16/11/2026', '2:30 PM', '3'), row('16/11/2026', 0.25, '4'), row('16/11/2026', '', '5')]);
      assert.deepEqual(p.lines.map((l) => l.t), [845, 540, 870, 360, undefined], hn);
      assert.deepEqual(p.tm, { y: 4, n: 1, p: 'dd/dd/dddd|', q: 'dd/dd/dddd|dd:dd' });
    }
    // בלי העמודה: map.h = -1, הזיהוי והשורות כמו קודם
    const d0 = C.detect([SH]); assert.equal(d0.kind, 'sales'); assert.equal(d0.map.h, -1);
    assert.equal(C.SAL.h, 'שעת מכירה');
  });
  it('packDays/unpackDays מעבירים את h (תשובת cxSales)', () => {
    const D = C.unpackDays(C.packDays([{ d: '2026-11-16', bk: '6200', gross: 10, h: { 14: 10 }, it: { 1: { n: 'x', q: 1, a: 10 } } }]));
    assert.deepEqual(D[0].h, { 14: 10 });
    assert.deepEqual(C.salesHours(D).hours, { '2026-11-16': { 14: 10 } });
  });
});

// 26.11.2026: שם / ברקוד ראשי / קטגוריה – decideF / afterF (טקסט, מעבר בטוח)
describe('decideF / afterF – שדות טקסט', () => {
  it('מעבר בטוח: בלי ab → base0, רק רישום בסיס (בלי שינוי בשום צד)', () => {
    for (const s of [undefined, null, {}, { fb: 'א' }]) assert.equal(C.decideF('שם בכספית', 'שם באפליקציה', s).act, 'base0');
    assert.deepEqual(C.afterF({ act: 'base0' }, ' שם  בכספית ', '', 'app'), { fb: 'שם בכספית', ab: null });
  });
  it('keep: שונים ואף צד לא השתנה – לא נוגעים; base: שווים (רווחים לא משנים)', () => {
    const s = { fb: 'עט', ab: 'עט כחול' };
    assert.equal(C.decideF('עט', 'עט כחול', s).act, 'keep');
    assert.equal(C.afterF({ act: 'keep' }, 'עט', 'עט כחול'), null);
    assert.equal(C.decideF('עט  כחול', 'עט כחול', s).act, 'base');
  });
  it('in / out / conf / ack', () => {
    const s = { fb: 'א', ab: 'א' };
    assert.deepEqual(C.decideF('ב', 'א', s), { act: 'in', v: 'ב' });
    assert.deepEqual(C.decideF('א', 'ג', s), { act: 'out', v: 'ג' });
    assert.deepEqual(C.decideF('ב', 'ג', s), { act: 'conf', v: 'ג', f: 'ב' });
    assert.deepEqual(C.afterF(C.decideF('ב', 'ג', s), 'ב', 'ג', 'app'), { fb: 'ב', ab: 'ג', pd: 'ג' });
    assert.equal(C.decideF('ג', 'ג', { fb: 'א', ab: 'ג', pd: 'ג' }).act, 'ack');
    assert.equal(C.decideF('', 'ג', { fb: null, ab: 'ג', pd: 'ג' }).act, 'out', 'נשלח וטרם נקלט – יוצא שוב');
  });
  it('קטגוריה: ctOf / ctSplit; משנית בלי ראשית – אין קטגוריה', () => {
    assert.equal(C.ctOf('כלים', 'צלחות'), 'כלים›צלחות');
    assert.equal(C.ctOf('', 'צלחות'), null);
    assert.deepEqual(C.ctSplit('כלים›צלחות'), ['כלים', 'צלחות']);
    assert.deepEqual(C.ctSplit('כלים'), ['כלים', '']);
    assert.deepEqual(C.ctSplit(null), ['', '']);
  });
  it('decide למספרים לא השתנה (q ברירת מחדל)', () => {
    assert.deepEqual(C.decide(10, 12, { fb: 10, ab: 10 }), { act: 'out', v: 12 });
    assert.deepEqual(C.decide(10.001, 10, {}), { act: 'base', v: 10 });
  });
});
