'use strict';
// בדיקות יחידה לחישובי עלות מוצרי אפייה (app-source/www/bake-calc.js) – בלי אמולטור. הרצה: node --test tests/bake-calc.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../app-source/www/bake-calc.js');

const it1 = (id, o, at) => ({ id, o: B.normItem(o), at: at || 1 });

describe('עלות מוצרי אפייה – חישובים טהורים', () => {
  it('סוגי ספק: בלי bt = רגיל; supNoPr רק כשהתוספת דלוקה ואין "רגיל"', () => {
    assert.deepEqual(B.supTypes({}), ['reg']);
    assert.deepEqual(B.supTypes({ bt: [] }), ['reg']);
    assert.deepEqual(B.supTypes({ bt: ['pack', 'x', 'bake'] }), ['bake', 'pack']);
    assert.equal(B.supNoPr({ bt: ['bake'] }, true), true);
    assert.equal(B.supNoPr({ bt: ['bake'] }, false), false, 'תוספת כבויה – כמו היום');
    assert.equal(B.supNoPr({ bt: ['bake', 'reg'] }, true), false, 'ספק מעורב נשאר בתמחור');
    assert.equal(B.supNoPr({}, true), false);
    assert.equal(B.supNoPr({ prOff: 1 }, false), true);
    assert.equal(B.supNoPr(null, true), false);
    assert.equal(B.supBake({ bt: ['reg'] }), false);
    assert.equal(B.supBake({ bt: ['pack'] }), true);
    assert.deepEqual(B.kindsOf({ bt: ['bake', 'pack', 'reg'] }), ['bake', 'pack']);
  });
  it('עלות ליחידה = מחיר ÷ תפוקה (ברירת מחדל: כמות באריזה): 50 ₪ / 800 גרם = 0.0625', () => {
    const a = B.normItem({ n: 'קמח', u: 'g', pq: 800, p: 50, d: '2026-11-01' });
    assert.equal(a.yq, 800);
    assert.equal(B.unitCost(a), 0.0625);
    const b = B.normItem({ n: 'פירות', u: 'g', pq: 1000, yq: 800, p: 40, d: '2026-11-01' });
    assert.equal(B.unitCost(b), 0.05);
    assert.equal(B.unitCost(B.normItem({ n: 'x', pq: 1 })), null, 'בלי מחיר – אין עלות');
  });
  it('מספרים מהמסך: פסיק עשרוני, שלילי/ריק/ענק = null', () => {
    assert.equal(B.num('12,5'), 12.5);
    assert.equal(B.num(''), null);
    assert.equal(B.num('-3'), null);
    assert.equal(B.num(1e8), null);
    assert.equal(B.pos(0), null);
  });
  it('עדכון מחיר: נשמר בהיסטוריה, התאריך המאוחר הוא הנוכחי, עד 50 רשומות', () => {
    let a = B.normItem({ n: 'חמאה', u: 'g', pq: 200, p: 10, d: '2026-11-01', h: [{ p: 10, d: '2026-11-01', at: 1 }] });
    a = B.addPrice(a, { p: 12, d: '2026-11-10', at: 2 });
    assert.equal(a.p, 12); assert.equal(a.d, '2026-11-10'); assert.equal(a.h.length, 2);
    a = B.addPrice(a, { p: 9, d: '2026-10-01', at: 3 }); // מחיר ישן שהוזן מאוחר – לא דורס
    assert.equal(a.p, 12); assert.equal(a.h.length, 3); assert.equal(a.h[0].p, 9);
    a = B.addPrice(a, { p: 14, d: '2026-11-20', at: 4, pq: 250 });
    assert.equal(a.pq, 250);
    for (let i = 0; i < 60; i++) a = B.addPrice(a, { p: 1 + i, d: '2026-12-01', at: 100 + i });
    assert.equal(a.h.length, 50); assert.equal(a.p, 60);
  });
  it('mergeH: שתי היסטוריות מתמזגות בלי כפילויות', () => {
    const x = [{ p: 1, d: '2026-01-01', at: 1 }, { p: 2, d: '2026-02-01', at: 2 }];
    const y = [{ p: 2, d: '2026-02-01', at: 2 }, { p: 3, d: '2026-01-15', at: 3 }, { p: 'x', d: 'bad' }];
    assert.deepEqual(B.mergeH(x, y).map((e) => e.p), [1, 3, 2]);
  });
  it('רכיב: ברירת מחדל = הקנייה האחרונה; pin קובע ספק; יחידה שונה / מוסתר – לא נספרים', () => {
    const comp = { n: 'קמח', u: 'g' };
    const items = [
      it1('a', { n: 'קמח א', sn: 'ספק א', u: 'g', pq: 1000, p: 5, d: '2026-11-01', c: 'k1' }),
      it1('b', { n: 'קמח ב', sn: 'ספק ב', u: 'g', pq: 1000, p: 6, d: '2026-11-05', c: 'k1' }),
      it1('c', { n: 'קמח ג', u: 'u', pq: 1, p: 1, d: '2026-11-09', c: 'k1' }),
      it1('d', { n: 'קמח ד', u: 'g', pq: 1000, p: 9, d: '2026-11-20', c: 'k1', off: 1 }),
    ];
    let r = B.compCost('k1', comp, items);
    assert.equal(r.it.id, 'b'); assert.equal(r.uc, 0.006);
    r = B.compCost('k1', comp, items, 'a');
    assert.equal(r.it.id, 'a'); assert.equal(r.pinned, true);
    r = B.compCost('k1', comp, items, 'zz');
    assert.equal(r.it.id, 'b'); assert.ok(r.why);
    assert.equal(B.compCost('k2', null, items).uc, null);
  });
  it('מוצר: עלות, אריזה, סה"כ, רווח ושולי רווח (רווח ÷ מחיר מכירה); רכיב אחד לכמה מוצרים', () => {
    const comps = { k1: { n: 'בצק', u: 'g' }, box: { n: 'קופסה', u: 'u' } };
    const items = [it1('a', { n: 'בצק', u: 'g', pq: 800, p: 50, d: '2026-11-01', c: 'k1' }), it1('bx', { n: 'קופסה', k: 'pack', u: 'u', pq: 100, p: 30, d: '2026-11-01', c: 'box' })];
    const p100 = B.prodCost(B.normProd({ n: '100 גרם', sp: 20, L: [{ c: 'k1', q: 100 }], K: [{ c: 'box', q: 1 }] }), comps, items);
    assert.equal(p100.prod, 6.25); assert.equal(p100.pack, 0.3); assert.equal(p100.total, 6.55);
    assert.equal(p100.profit, 13.45); assert.equal(p100.margin, 67.3);
    assert.equal(p100.L[0].src.id, 'a'); assert.equal(p100.L[0].src.d, '2026-11-01');
    const p200 = B.prodCost(B.normProd({ n: '200 גרם', sp: 35, L: [{ c: 'k1', q: 200 }] }), comps, items);
    assert.equal(p200.total, 12.5); assert.equal(p200.margin, 64.3);
    // מחיר קנייה חדש – כל המוצרים מתעדכנים
    items[0].o = B.addPrice(items[0].o, { p: 64, d: '2026-11-20', at: 5 });
    assert.equal(B.prodCost(B.normProd({ n: 'x', sp: 20, L: [{ c: 'k1', q: 100 }] }), comps, items).prod, 8);
    // חסר מחיר / בלי מחיר מכירה
    const m = B.prodCost(B.normProd({ n: 'y', L: [{ c: 'nope', q: 1 }] }), comps, items);
    assert.equal(m.miss, 1); assert.equal(m.profit, null); assert.equal(m.margin, null);
  });
  it('parse: JSON לא תקין / סוג לא מוכר / שם ריק – null; שדות זרים נזרקים', () => {
    assert.equal(B.parse('i', '{bad'), null);
    assert.equal(B.parse('x', '{"n":"a"}'), null);
    assert.equal(B.parse('c', '{"n":""}'), null);
    assert.deepEqual(B.parse('c', '{"n":"<b>","u":"g","evil":1}'), { n: '<b>', u: 'g' });
    const p = B.parse('p', JSON.stringify({ n: 'a', sp: '12', L: [{ c: 'k', q: 2, pin: 'bad id!' }, { c: '', q: 1 }, { c: 'k2', q: 0 }] }));
    assert.deepEqual(p, { n: 'a', sp: 12, L: [{ c: 'k', q: 2 }], K: [] });
  });
  it('התנגשות: מחירים ממוזגים תמיד; עריכה אחרת – at המאוחר גובר והמפסיד מסומן', () => {
    const base = { n: 'קמח', u: 'g', pq: 1000, p: 5, d: '2026-11-01', h: [{ p: 5, d: '2026-11-01', at: 1 }] };
    const loc = { o: B.addPrice(B.normItem(base), { p: 6, d: '2026-11-10', at: 10 }), at: 10 };
    const rem = { o: B.addPrice(B.normItem(Object.assign({}, base, { n: 'קמח לבן' })), { p: 7, d: '2026-11-12', at: 20 }), at: 20 };
    const r = B.resolve('i', loc, rem, true);
    assert.equal(r.o.h.length, 3); assert.equal(r.o.p, 7); assert.equal(r.o.n, 'קמח לבן');
    assert.equal(r.lost, false, 'השינוי המקומי היה רק מחיר – לא הפסיד'); assert.equal(r.same, false); assert.equal(r.at, 20);
    const loc2 = { o: Object.assign({}, B.normItem(base), { n: 'שם מקומי' }), at: 5 };
    const r2 = B.resolve('i', loc2, rem);
    assert.equal(r2.lost, true); assert.equal(r2.o.n, 'קמח לבן'); assert.equal(r2.o.h.length, 2, 'גם כשהעריכה הפסידה – ההיסטוריה ממוזגת');
    const r2b = B.resolve('i', { o: loc2.o, at: 50 }, rem);
    assert.equal(r2b.lost, false); assert.equal(r2b.o.n, 'שם מקומי'); assert.equal(r2b.o.p, 7, 'עריכה מאוחרת גוברת, המחיר מהענן נשמר');
    const c1 = { o: { n: 'א', u: 'g' }, at: 30 }, c2 = { o: { n: 'ב', u: 'g' }, at: 40 };
    assert.deepEqual(B.resolve('c', c1, c2), { o: c2.o, at: 40, lost: true, same: true });
    const r3 = B.resolve('p', c2, c1);
    assert.equal(r3.lost, false); assert.equal(r3.same, false); assert.equal(r3.o.n, 'ב');
  });
});
