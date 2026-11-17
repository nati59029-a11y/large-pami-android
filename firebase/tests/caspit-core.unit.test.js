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
