'use strict';
// המזכירה – שלב ג, שלב 1: בדיקות יחידה ל-lib/sec-ord.js (בלי אמולטור ובלי רשת).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../functions/lib/sec-ord.js');

const P = [
  { id: 'p1', name: 'צלחת פלסטיק לבנה', price: 12.9, on: true, sku: 'PL-100', barcode: '7290001' },
  { id: 'p2', name: 'צלחת עמוקה', price: 15, on: true },
  { id: 'p3', name: 'צלחת נייר', price: 9.9, on: true },
  { id: 'p4', name: 'צלחת קינוח', price: 8, on: true },
  { id: 'p5', name: 'כוסות חד פעמיות', price: 7.5, on: true, bp: { b1: 6.9 }, wp: 5.1 },
  { id: 'p6', name: 'מגבונים לחים', price: 4.9, on: true, cto: true, ct: 12, wp: 3.3, q: { b1: 10, b2: 0 } },
  { id: 'p7', name: 'מפיות זהב', price: 11, on: false },
  { id: 'p8', name: 'סכין חד פעמי', price: 0.1, on: true, q: 0 },
];
const RUN = { cust: { wholesale: false }, br: 'b1' };
const WS = { cust: { wholesale: true }, br: 'b1' };
const L = (txt, qty, ctx) => O.line({ txt, qty, unit: '' }, P, ctx || RUN);

describe('sec-ord: התאמה לקטלוג', () => {
  it('"צלחות" מול כמה מוצרים דומים → pick עם עד 3 אפשרויות, חוסם', () => {
    const l = L('צלחות', 10);
    assert.equal(l.st, 'pick');
    assert.ok(l.opts.length >= 2 && l.opts.length <= O.MAX_OPTS);
    assert.ok(l.opts.every((o) => ['p1', 'p2', 'p3', 'p4'].includes(o.id)));
    assert.equal(l.block, true);
    assert.equal(l.sum, undefined);
  });
  it('התאמה יחידה (רבים ↔ יחיד, ניקוד וגרשיים) → ok', () => {
    const l = L('כּוֹס חד-פעמית', 3);
    assert.equal(l.st, 'ok'); assert.equal(l.id, 'p5'); assert.equal(l.block, false);
    assert.equal(L('"צלחת עמוקה"', 2).id, 'p2');
    assert.equal(L('  צלחות   עמוקות ', 2).st, 'ok');
  });
  it('מוצר כבוי (on:false) לא נכלל – גם לא באפשרויות', () => {
    const l = L('מפיות זהב', 5);
    assert.equal(l.st, 'ask');
    assert.ok(!JSON.stringify(l).includes('p7'));
  });
  it('0 התאמות → ask ("לבירור"), חוסם', () => {
    const l = L('מטריה כחולה', 1);
    assert.equal(l.st, 'ask'); assert.equal(l.why, 'none'); assert.deepEqual(l.opts, []); assert.equal(l.block, true);
    assert.equal(L('', 1).st, 'ask');
  });
  it('שגיאת כתיב קלה → עדיין ok', () => {
    const l = L('מגבונם לחים', 12);
    assert.equal(l.st, 'ok'); assert.equal(l.id, 'p6');
    assert.equal(L('צלחת עמוקקה', 1).id, 'p2');
  });
  it('sku / ברקוד מדויק גובר על שם', () => {
    assert.equal(L('PL-100', 1).id, 'p1');
    assert.equal(L('pl-100', 1).st, 'ok');
    assert.equal(L('ברקוד 7290001', 1).id, 'p1');
    assert.equal(L('PL-10', 1).st, 'ask');
  });
});

describe('sec-ord: מחיר, קרטונים, מלאי', () => {
  it('מחיר סניף bp[br] גובר על price; בלי סניף מתאים → price; באגורות שלמות', () => {
    assert.equal(L('כוסות חד פעמיות', 1).pr, 690);
    assert.equal(L('כוסות חד פעמיות', 1, { cust: {}, br: 'b9' }).pr, 750);
    assert.equal(O.priceOf(P[0], {}, 'b1'), 1290);
  });
  it('סיטונאי עם wp → wp; סיטונאי בלי wp → כמו רגיל', () => {
    assert.equal(L('כוסות חד פעמיות', 1, WS).pr, 510);
    assert.equal(L('צלחת עמוקה', 1, WS).pr, 1500);
  });
  it('לא-סיטונאי לא רואה wp – לא במחיר, לא באפשרויות, לא בתצוגה', () => {
    const d = O.build([{ txt: 'כוסות חד פעמיות', qty: 2 }, { txt: 'מגבונים', qty: 1 }, { txt: 'צלחות', qty: 1 }], P, RUN);
    const s = JSON.stringify(d) + JSON.stringify(O.safeView(d));
    assert.ok(!s.includes('510') && !s.includes('330') && !s.includes('"wp"'));
    assert.equal(O.priceOf(P[4], { wholesale: 'true' }, ''), 750); // רק wholesale === true
  });
  it('המחיר תמיד מהמוצר, לא מהטקסט', () => {
    assert.equal(O.line({ txt: 'צלחת עמוקה', qty: 1, price: 1, pr: 100 }, P, RUN).pr, 1500);
    const l = O.line({ txt: 'צלחת עמוקה ב-1 ש"ח', qty: 1 }, P, RUN); // מילים נוספות → לא בטוח, אבל המחיר באפשרות מהקטלוג
    assert.equal(l.st, 'pick');
    assert.equal(l.opts.find((o) => o.id === 'p2').pr, 1500);
  });
  it('קרטונים: סיטונאי + cto + כמות לא כפולה של ct → אזהרה וחסימה, הכמות לא משתנה', () => {
    const l = L('מגבונים לחים', 13, WS);
    assert.equal(l.ctw, 12); assert.equal(l.qty, 13); assert.equal(l.st, 'ok'); assert.equal(l.block, true);
    const d = O.build([{ txt: 'מגבונים לחים', qty: 13 }], P, WS);
    assert.equal(d.block, true); assert.equal(d.nBlock, 1);
    const ok = L('מגבונים לחים', 24, WS);
    assert.equal(ok.ctw, undefined); assert.equal(ok.block, false);
    assert.equal(L('מגבונים לחים', 13, RUN).ctw, undefined); // לקוח רגיל – כמו orders.js
    assert.equal(L('מגבונים לחים', 13, RUN).block, false);
  });
  it('מחיר 0 (price:0 או wp:0) → לבירור (price0), חוסם, לא נשלח ללקוח', () => {
    const PZ = [{ id: 'z1', name: 'שקית', price: 0, on: true }, { id: 'z2', name: 'קופסה', price: 5, wp: 0, on: true }, { id: 'z3', name: 'קופסה גדולה', price: 0, on: true }];
    for (const [t, c] of [['שקית', RUN], ['קופסה', WS]]) {
      const l = O.line({ txt: t, qty: 1 }, PZ, c);
      assert.equal(l.st, 'ask'); assert.equal(l.why, 'price0'); assert.equal(l.block, true); assert.equal(l.pr, undefined);
    }
    assert.equal(O.line({ txt: 'קופסה', qty: 1 }, PZ, RUN).pr, 500);
    const d = O.build([{ txt: 'קופסה', qty: 1 }], [PZ[2], { id: 'z4', name: 'קופסה קטנה', price: 3, on: true }], RUN); // pick: גדולה / קטנה
    assert.equal(d.lines[0].st, 'pick');
    assert.equal(d.lines[0].opts.find((o) => o.id === 'z3').pr, null);
    assert.ok(!/"pr":0/.test(JSON.stringify(O.safeView(d))));
  });
  it('אזל: q ≤ 0 → out:true, חוסם, בלי כמות בפלט ללקוח, לא נכנס לסה"כ', () => {
    const d = O.build([{ txt: 'מגבונים לחים', qty: 1 }], P, { cust: {}, br: 'b2' });
    assert.equal(d.lines[0].out, true); assert.equal(d.total, 0);
    assert.equal(d.lines[0].block, true); assert.equal(d.block, true); assert.equal(d.nBlock, 1); // טיוטה עם פריט שאזל בלבד – חסומה
    assert.equal(L('מגבונים לחים', 1, { cust: {}, br: 'b9' }).out, true); // סניף שלא מופיע ב-q = 0 (כמו qOf)
    assert.equal(L('מגבונים לחים', 1, { cust: {}, br: '_' }).out, true);
    assert.equal(L('סכין חד פעמי', 1).out, true);
    assert.equal(L('מגבונים לחים', 1).out, undefined); // b1: 10
    assert.equal(L('צלחת עמוקה', 1).out, undefined); // בלי q – לא נבדק
    assert.ok(!/"q"|10/.test(JSON.stringify(O.safeView(d))));
  });
});

describe('sec-ord: סה"כ, כמות, תצוגה', () => {
  it('סה"כ באגורות רק על ok שלא אזלו, בלי שגיאות נקודה צפה', () => {
    const P2 = [{ id: 'a', name: 'חלב', price: 0.1, on: true }, { id: 'b', name: 'לחם', price: 0.2, on: true }, { id: 'c', name: 'ביצים', price: 19.99, on: true }];
    const d = O.build([{ txt: 'חלב', qty: 3 }, { txt: 'לחם', qty: 1 }, { txt: 'ביצים', qty: 3 }, { txt: 'שוקולד', qty: 1 }], P2, RUN);
    assert.equal(d.total, 30 + 20 + 5997);
    assert.ok(Number.isInteger(d.total));
    assert.equal(d.block, true); assert.equal(d.nBlock, 1);
    const ok = O.build([{ txt: 'חלב', qty: 3 }], P2, RUN);
    assert.equal(ok.total, 30); assert.equal(ok.block, false);
  });
  it('כמות 0 / שלילית / לא מספר → נדחית (ask, why=qty)', () => {
    for (const q of [0, -2, 'abc', NaN, Infinity, null, undefined, '', 100001, {}, 0.0004, '0.0001']) {
      const l = L('צלחת עמוקה', q);
      assert.equal(l.st, 'ask', String(q)); assert.equal(l.why, 'qty'); assert.equal(l.block, true); assert.equal(l.sum, undefined);
      assert.equal(l.qty, null);
      assert.equal(O.safeView({ lines: [l] }).lines[0].qty, null);
    }
    assert.equal(O.qtyOk(0.0005), 0.001);
    assert.equal(L('צלחת עמוקה', '2').qty, 2);
    assert.equal(L('צלחת עמוקה', 1.5).sum, 2250);
  });
  it('safeView: רשימה לבנה בלבד', () => {
    const d = O.build([{ txt: 'כוסות חד פעמיות', qty: 2 }, { txt: 'צלחות', qty: 1 }], P, WS);
    d.lines[0].wp = 1; d.lines[0].q = 5; d.lines[0].cost = 3; d.lines[1].opts[0].cost = 2;
    const v = O.safeView(d);
    const s = JSON.stringify(v);
    assert.ok(!/"(wp|q|cost|id)"/.test(s));
    assert.equal(v.total, 1020); assert.equal(v.block, true);
  });
});
