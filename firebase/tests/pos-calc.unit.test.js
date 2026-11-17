'use strict';
// בדיקות יחידה לחישובי הקופה (app-source/www/pos-sale.js – PosCalc, ScanDetector) ולשכבת הנתונים המדומה (pos-data-mock.js).
// בלי אמולטור. הרצה: node --test tests/pos-calc.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const WWW = path.join(__dirname, '../../app-source/www');
const { PosCalc: C, ScanDetector } = require(path.join(WWW, 'pos-sale.js'));
const D = require(path.join(WWW, 'pos-data-mock.js'));

describe('קופה – סכומים באגורות', () => {
  it('parseAmt: שקלים לאגורות, שלמים בלבד', () => {
    assert.equal(C.parseAmt('12'), 1200);
    assert.equal(C.parseAmt('12.5'), 1250);
    assert.equal(C.parseAmt('12.05'), 1205);
    assert.equal(C.parseAmt('₪1,234.50'), 123450);
    assert.equal(C.parseAmt('.5'), 50);
    assert.equal(C.parseAmt('0.1'), 10);
    assert.ok(Number.isNaN(C.parseAmt('abc')));
    assert.ok(Number.isNaN(C.parseAmt('1.234')));
    assert.ok(Number.isNaN(C.parseAmt('-5')));
    assert.ok(Number.isNaN(C.parseAmt('')));
  });
  it('fmt: תצוגה בשקלים עם מפריד אלפים', () => {
    assert.equal(C.fmt(0), '₪0.00');
    assert.equal(C.fmt(5), '₪0.05');
    assert.equal(C.fmt(123450), '₪1,234.50');
    assert.equal(C.fmt(100000000), '₪1,000,000.00');
    assert.equal(C.fmt(-250), '-₪2.50');
  });
  it('0.1+0.2: אין שגיאות נקודה צפה בסכום הסל', () => {
    const t = C.totals([{ price: 10, qty: 1 }, { price: 20, qty: 1 }]);
    assert.equal(t.total, 30);
  });
});

describe('קופה – מע"מ 18% כלול במחיר', () => {
  it('vatOf: החלק של המע"מ מתוך מחיר כולל', () => {
    assert.equal(C.VAT, 18);
    assert.equal(C.vatOf(11800), 1800);
    assert.equal(C.vatOf(100), 15); // 15.25 → 15
    assert.equal(C.vatOf(0), 0);
  });
  it('totals: סכום, פריטים, מע"מ ונטו (נטו + מע"מ = סה"כ)', () => {
    const t = C.totals([{ price: 690, qty: 2 }, { price: 850, qty: 1 }, { price: 1999, qty: 3 }]);
    assert.equal(t.total, 690 * 2 + 850 + 1999 * 3);
    assert.equal(t.items, 6);
    assert.equal(t.vat, Math.round(t.total * 18 / 118));
    assert.equal(t.net + t.vat, t.total);
  });
  it('סל ריק = 0', () => assert.deepEqual(C.totals([]), { items: 0, total: 0, vat: 0, net: 0 }));
});

describe('קופה – סל', () => {
  const p = { id: 'a', name: 'א', barcode: '1', price: 500 };
  it('אותו מוצר פעמיים = שורה אחת עם כמות 2', () => {
    let c = C.addToCart([], p);
    c = C.addToCart(c, p);
    assert.equal(c.length, 1);
    assert.equal(c[0].qty, 2);
  });
  it('setQty: 0 מוחק, כמות חדשה מעדכנת, בלי לשנות את המקור', () => {
    const c = C.addToCart([], p);
    const c2 = C.setQty(c, 'a', 5);
    assert.equal(c2[0].qty, 5);
    assert.equal(c[0].qty, 1);
    assert.equal(C.setQty(c2, 'a', 0).length, 0);
    assert.equal(C.setQty(c2, 'zz', 3).length, 1);
  });
});

describe('קופה – תשלום', () => {
  it('מזומן עם עודף', () => {
    const r = C.addPayment(4370, [], 'cash', 5000);
    assert.ok(r.ok);
    assert.ok(C.isPaid(4370, r.pays));
    assert.equal(C.change(4370, r.pays), 630);
    assert.equal(C.remaining(4370, r.pays), 0);
  });
  it('מזומן מדויק – בלי עודף', () => {
    const r = C.addPayment(4370, [], 'cash', 4370);
    assert.equal(C.change(4370, r.pays), 0);
    assert.ok(C.isPaid(4370, r.pays));
  });
  it('אשראי לא יכול לעבור את היתרה', () => {
    const r = C.addPayment(4370, [], 'credit', 5000);
    assert.equal(r.ok, false);
    assert.ok(C.addPayment(4370, [], 'credit', 4370).ok);
  });
  it('פיצול: אשראי ואז מזומן עם עודף', () => {
    let r = C.addPayment(10000, [], 'credit', 6000);
    assert.ok(r.ok);
    assert.equal(C.remaining(10000, r.pays), 4000);
    assert.equal(C.isPaid(10000, r.pays), false);
    r = C.addPayment(10000, r.pays, 'cash', 5000);
    assert.ok(r.ok);
    assert.equal(C.change(10000, r.pays), 1000);
    assert.equal(C.paid(r.pays), 11000);
  });
  it('פיצול: מזומן ואז אשראי עד היתרה בדיוק', () => {
    let r = C.addPayment(10000, [], 'cash', 2500);
    r = C.addPayment(10000, r.pays, 'credit', 7501);
    assert.equal(r.ok, false);
    const r2 = C.addPayment(10000, [{ m: 'cash', a: 2500 }], 'credit', 7500);
    assert.ok(r2.ok);
    assert.equal(C.change(10000, r2.pays), 0);
  });
  it('אחרי ששולם – אי אפשר להוסיף תשלום', () => {
    assert.equal(C.addPayment(100, [{ m: 'cash', a: 100 }], 'cash', 50).ok, false);
  });
  it('סכום לא תקין נדחה (0, שלילי, שבר אגורה, NaN, אמצעי לא מוכר)', () => {
    for (const a of [0, -1, 1.5, NaN]) assert.equal(C.addPayment(100, [], 'cash', a).ok, false);
    assert.equal(C.addPayment(100, [], 'cheque', 100).ok, false);
  });
  it('סל של 0 אינו "שולם"', () => assert.equal(C.isPaid(0, []), false));
});

describe('קופה – החזרה', () => {
  it('maxReturn: לא יותר ממה שנמכר פחות מה שהוחזר', () => {
    assert.equal(C.maxReturn(3, 0), 3);
    assert.equal(C.maxReturn(3, 2), 1);
    assert.equal(C.maxReturn(3, 5), 0);
    assert.equal(C.maxReturn(2, undefined), 2);
  });
  it('refund: סכום ומע"מ של השורות שנבחרו בלבד', () => {
    const r = C.refund([{ price: 1180, qty: 2 }, { price: 500, qty: 0 }]);
    assert.equal(r.total, 2360);
    assert.equal(r.vat, 360);
  });
});

describe('קופה – סורק כמקלדת', () => {
  const typeSeq = (sd, s, t0, gap, enterGap) => {
    let t = t0;
    for (const ch of s) { sd.feed(ch, t); t += gap; }
    return sd.feed('Enter', t - gap + (enterGap ?? gap));
  };
  it('הקלדה מהירה + Enter = ברקוד', () => {
    assert.equal(typeSeq(ScanDetector(), '7290000000015', 1000, 8), '7290000000015');
  });
  it('הקלדה איטית של אדם = לא סריקה', () => {
    assert.equal(typeSeq(ScanDetector(), '7290000000015', 1000, 180), null);
  });
  it('קצר מדי = לא סריקה', () => {
    assert.equal(typeSeq(ScanDetector(), '12', 1000, 5), null);
  });
  it('הקלדה איטית ואחריה סריקה – רק הסריקה נתפסת', () => {
    const sd = ScanDetector();
    sd.feed('a', 0); sd.feed('b', 400);
    assert.equal(typeSeq(sd, '12345678', 1000, 10), '12345678');
  });
  it('Enter שמגיע הרבה אחרי התו האחרון = לא סריקה', () => {
    assert.equal(typeSeq(ScanDetector(), '12345678', 0, 10, 900), null);
  });
  it('מקשים מיוחדים (Shift) לא שוברים את הרצף', () => {
    const sd = ScanDetector();
    sd.feed('Shift', 0); sd.feed('A', 1); sd.feed('B', 5); sd.feed('Shift', 7); sd.feed('C', 9); sd.feed('D', 13);
    assert.equal(sd.feed('Enter', 20), 'ABCD');
  });
});

describe('קופה – שכבת נתונים מדומה (5,000+ מוצרים)', () => {
  it('לפחות 5,000 מוצרים, ברקודים ייחודיים, מחירים באגורות שלמות', async () => {
    const P = await D.getProducts();
    assert.ok(P.length >= 5000, String(P.length));
    assert.equal(new Set(P.map((p) => p.barcode)).size, P.length);
    for (const p of P) assert.ok(Number.isInteger(p.price) && p.price > 0, p.name);
  });
  it('byBarcode מוצא מוצר קבוע', async () => {
    const p = await D.byBarcode('7290000000015');
    assert.equal(p && p.name, 'חלב תנובה 3% 1 ליטר');
    assert.equal(await D.byBarcode('0000'), null);
  });
  it('search: ברקוד מדויק ראשון, כל המילים, אותיות סופיות', async () => {
    const r = await D.search('7290000000022');
    assert.equal(r[0].barcode, '7290000000022');
    const r2 = await D.search('חלב תנובה');
    assert.ok(r2.some((p) => p.id === 'p0'));
    const r3 = await D.search('לחמ'); // "לחם" עם מ' רגילה
    assert.ok(r3.some((p) => p.id === 'p00'));
    assert.ok((await D.search('שוקולד', 50)).length <= 50);
    assert.equal((await D.search('אין-מוצר-כזה-בכלל')).length, 0);
  });
  it('מהירות: 200 חיפושים על 6,000 מוצרים – פחות מ-15 מ"ש בממוצע', async () => {
    await D.getProducts();
    const Q = ['ח', 'חל', 'חלב', 'שוקולד הזהב', 'אורז', '7291', 'מארז 6', 'נרות', 'קפה מהדרין', 'zz'];
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) await D.search(Q[i % Q.length], 500);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
    assert.ok(ms < 15, ms.toFixed(2) + 'ms');
  });
  it('saveSale / getSale / returnedQty / saveReturn / dayStats', async () => {
    D._reset();
    const s = await D.saveSale({ lines: [{ pid: 'p0', price: 690, qty: 2, total: 1380 }], total: 1380, vat: 211, payments: [{ m: 'cash', a: 2000 }], change: 620 });
    assert.equal(s.no, 1);
    const got = await D.getSale(1);
    assert.equal(got.total, 1380);
    await D.saveReturn({ saleNo: 1, lines: [{ pid: 'p0', price: 690, qty: 1, total: 690 }], total: 690, vat: 105, method: 'cash' });
    assert.deepEqual(await D.returnedQty(1), { p0: 1 });
    const st = await D.dayStats();
    assert.deepEqual(st, { sales: 1, total: 1380, returns: 1, returnsTotal: 690 });
    assert.equal((await D.getSales({})).length, 1);
  });
});
