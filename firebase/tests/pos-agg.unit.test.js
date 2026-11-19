'use strict';
// קופה ש5 – lib/pos-agg.js (בדיקות יחידה, בלי אמולטור): PIN ונעילה, אישור הנחה, מזומן ותקרה, Z מדויק לאגורה, שעון נוכחות.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const AG = require('../functions/lib/pos-agg');

describe('pos-agg – PIN', () => {
  it('קוד חדש: 4–6 ספרות, לא פשוט מדי', () => {
    for (const p of ['2580', '97531', '864209']) assert.equal(AG.pinCheckNew(p), p);
    for (const [p, r] of [['123', 'bad-pin'], ['1234567', 'bad-pin'], ['12a4', 'bad-pin'], [1234, 'bad-pin'], ['1234', 'weak-pin'], ['0000', 'weak-pin'], ['111111', 'weak-pin']]) {
      assert.throws(() => AG.pinCheckNew(p), (e) => e.reason === r, String(p));
    }
  });
  it('גיבוב עם מלח: אותו קוד – גיבוב שונה; רק הקוד הנכון מתאים', () => {
    const a = AG.pinHash('2580'), b = AG.pinHash('2580');
    assert.notEqual(a.h, b.h);
    assert.ok(AG.pinMatch('2580', a));
    assert.ok(!AG.pinMatch('2581', a));
    assert.ok(!AG.pinMatch('2580', null));
    assert.ok(!AG.pinMatch('2580', { h: a.h }));
  });
  it('5 שגויים ברצף = נעילה ל-30 שניות + התראה; אחרי 30 שניות – פתוח; הצלחה מאפסת', () => {
    let rec = {}; const t0 = 1_800_000_000_000;
    for (let i = 1; i <= 4; i++) { const n = AG.pinAfter(rec, false, t0); assert.equal(n.fails, i); assert.equal(n.alert, false); rec = n; }
    const n5 = AG.pinAfter(rec, false, t0);
    assert.equal(n5.alert, true); assert.equal(n5.lockUntil, t0 + 30000); assert.equal(n5.fails, 0);
    assert.deepEqual(AG.lockState(n5, t0 + 1), { locked: true, wait: 30 });
    assert.equal(AG.lockState(n5, t0 + 29999).locked, true);
    assert.equal(AG.lockState(n5, t0 + 30000).locked, false);
    assert.deepEqual(AG.pinAfter({ fails: 3 }, true, t0), { fails: 0, lockUntil: 0, alert: false });
  });
});

describe('pos-agg – אישור אחראי', () => {
  // POS:W2 סבב 2 (ליקוי 6): discMax.cashier חל רק כש-discRoles מתיר לקופאי ('cashier'), בדיוק כמו בשרת המכירה
  const cfg = { discMax: { cashier: 5, lead: 15 }, discRoles: 'cashier' };
  it('הנחה: עד 5% בלי אישור; אחראי עד 10% (גם כשההגדרה 15); מעל 10% – מנהל', () => {
    assert.equal(AG.discNeed(3, { discMax: { cashier: 5, lead: 15 } }), 'lead', 'discRoles ברירת מחדל (lead) – קופאי לא נותן הנחה לבד');
    assert.equal(AG.discNeed(0, cfg), null);
    assert.equal(AG.discNeed(5, cfg), null);
    assert.equal(AG.discNeed(5.01, cfg), 'lead');
    assert.equal(AG.discNeed(10, cfg), 'lead');
    assert.equal(AG.discNeed(10.01, cfg), 'manager');
    assert.equal(AG.discNeed(8, { discMax: { cashier: 5, lead: 7 }, discRoles: 'cashier' }), 'manager'); // הגדרה נמוכה מ-10 – גוברת
    assert.throws(() => AG.discNeed(101, cfg), (e) => e.reason === 'bad-disc');
    assert.throws(() => AG.discNeed('5', cfg), (e) => e.reason === 'bad-disc');
  });
  it('מי מאשר: אחראי – רק "lead"; מנהל – הכול; קופאי – כלום', () => {
    assert.ok(AG.canApprove('lead', 'lead'));
    assert.ok(!AG.canApprove('lead', 'manager'));
    assert.ok(AG.canApprove('manager', 'manager'));
    assert.ok(!AG.canApprove('cashier', 'lead'));
  });
});

describe('pos-agg – מזומן ו-Z', () => {
  it('תנועה: סוג, סכום שלם חיובי, הוצאה חייבת הערה', () => {
    assert.deepEqual(AG.mvIn('drop', 10000), { k: 'drop', a: 10000, note: '' });
    assert.throws(() => AG.mvIn('out', 500, ''), (e) => e.reason === 'bad-note');
    assert.throws(() => AG.mvIn('in', 0), (e) => e.reason === 'bad-amt');
    assert.throws(() => AG.mvIn('in', 10.5), (e) => e.reason === 'bad-amt');
    assert.throws(() => AG.mvIn('steal', 10), (e) => e.reason === 'bad-op');
  });
  it('Z = מכירות פחות החזרות, מדויק לאגורה (אלפי סכומים שבריים בשקלים)', () => {
    const sales = [], rets = [];
    let s = 0, r = 0, x = 7;
    for (let i = 0; i < 5000; i++) { x = (x * 48271) % 2147483647; const g = (x % 99999) + 1; sales.push({ id: 's' + i, gross: g }); s += g; }
    for (let i = 0; i < 700; i++) { x = (x * 48271) % 2147483647; const g = (x % 5000) + 1; rets.push({ gross: g, m: 'cash' }); r += g; }
    sales.push({ id: 'v', gross: 123456, st: 'void' });
    const a = AG.zAgg(sales, [], rets);
    assert.equal(a.sales, s); assert.equal(a.rets, r); assert.equal(a.z, s - r); assert.equal(a.voids, 1); assert.equal(a.n, 5000);
    assert.ok(Number.isInteger(a.z));
    // 0.10 + 0.20 בשקלים ≠ 0.30 בנקודה צפה – באגורות תמיד מדויק
    assert.equal(AG.zAgg([{ gross: 10 }, { gross: 20 }], [], []).z, 30);
  });
  it('סכום לא שלם / חסר – לא נספר ומסומן ב-bad', () => {
    const a = AG.zAgg([{ gross: 1000 }, { gross: 10.5 }, {}], [{ m: 'cash', a: 1.2 }], [{ gross: -5 }]);
    assert.equal(a.z, 1000); assert.equal(a.bad, 4);
  });
  it('מזומן צפוי: פתיחה + הכנסה + מכירות במזומן (נטו מעודף) − החזרים − הוצאה − הפקדה; תשלום של מכירה מבוטלת לא נספר', () => {
    const agg = AG.zAgg([{ id: 'a', gross: 5000 }, { id: 'b', gross: 3000 }, { id: 'c', gross: 999, st: 'void' }],
      [{ sale: 'a', m: 'cash', a: 10000, chg: 5000 }, { sale: 'b', m: 'card', a: 3000 }, { sale: 'c', m: 'cash', a: 999 }], [{ gross: 700, m: 'cash' }, { gross: 300, m: 'card' }]);
    assert.deepEqual(agg.pay, { cash: 5000, card: 3000 });
    const c = AG.cashExpected({ open: 50000, mv: [{ k: 'in', a: 2000 }, { k: 'out', a: 1500 }, { k: 'drop', a: 20000 }] }, agg);
    assert.equal(c.expected, 50000 + 2000 + 5000 - 700 - 1500 - 20000);
    const rep = AG.zReport({ open: 50000, mv: [] }, agg, 54000);
    assert.equal(rep.z, 8000 - 1000); assert.equal(rep.cash.expected, 54300); assert.equal(rep.diff, -300);
  });
  it('תקרת מזומן: מעל – אזהרה; אחרי אישור בסכום הזה – אין אזהרה עד שהסכום עולה; 0 = בלי תקרה', () => {
    assert.deepEqual(AG.overCap(600000, 600000, 0), { over: false, warn: false, by: 0 });
    assert.deepEqual(AG.overCap(600001, 600000, 0), { over: true, warn: true, by: 1 });
    assert.equal(AG.overCap(650000, 600000, 650000).warn, false);
    assert.equal(AG.overCap(650001, 600000, 650000).warn, true);
    assert.equal(AG.overCap(9e9, 0, 0).warn, false);
  });
});

describe('pos-agg – שעון נוכחות', () => {
  it('דקות, משמרת פתוחה, יותר מ-16 שעות נחתך; סיכום לכל עובד; יום לפי שעון ישראל', () => {
    const t = Date.UTC(2026, 10, 17, 6, 0, 0);
    assert.deepEqual(AG.clockMin({ in: t, out: t + 90 * 60000 + 59000 }, 0), { min: 90, open: false, long: false });
    assert.deepEqual(AG.clockMin({ in: t, out: null }, t + 30 * 60000), { min: 30, open: true, long: false });
    assert.deepEqual(AG.clockMin({ in: t, out: t + 20 * 3600000 }, 0), { min: 960, open: false, long: true });
    const s = AG.clockSum([{ who: 'a', in: t, out: t + 60000 * 60 }, { who: 'a', in: t + 7200000, out: t + 7200000 + 60000 * 30 }, { who: 'b', in: t, out: null }], t + 600000);
    assert.equal(s.a.min, 90); assert.equal(s.a.n, 2); assert.equal(s.b.open, true); assert.equal(s.b.min, 10);
    assert.equal(AG.dayOf(Date.UTC(2026, 10, 17, 22, 30)), '20261118'); // 00:30 בישראל
  });
});
