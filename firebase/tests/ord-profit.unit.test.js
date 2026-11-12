'use strict';
// 2026-11-12: נוסחת הרווח של הזמנה ושעון ישראל (functions/lib/ord-profit.js) + אותה נוסחה באפליקציה (orders-staff.js). בלי אמולטור.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { profitOf, ilDayStart } = require('../functions/lib/ord-profit');

const ORD = { total: 95, items: [{ pid: 'p1', qty: 2, price: 20, c: 12 }, { pid: 'p2', qty: 1, price: 10 }, { pid: 'p3', qty: 1, price: 50 }, { n: 'x', qty: 1, price: 5, c: 1 }] };
describe('רווח של הזמנה', () => {
  it('skip: שורה בלי עלות (גם לא נוכחית) יורדת מהסכום ונספרת ב-miss; עלות נוכחית לשורה ישנה בלי c', () => {
    assert.deepEqual(profitOf(ORD, new Map([['p2', 3]]), 'skip'), { total: 9500, cost: 2800, profit: 1700, miss: 1 });
  });
  it('zero: שורה בלי עלות – עלות 0', () => {
    assert.deepEqual(profitOf(ORD, new Map([['p2', 3]]), 'zero'), { total: 9500, cost: 2800, profit: 6700, miss: 1 });
  });
  it('הנחה (total קטן מסכום השורות) מורידה מהרווח; כמות שברית; הזמנה בלי פריטים', () => {
    assert.equal(profitOf({ total: 90, items: [{ pid: 'a', qty: 1, price: 100, c: 60 }] }, null, 'skip').profit, 3000);
    assert.equal(profitOf({ total: 15, items: [{ pid: 'a', qty: 1.5, price: 10, c: 3.33 }] }, null, 'skip').cost, 500);
    assert.deepEqual(profitOf({}, null, 'skip'), { total: 0, cost: 0, profit: 0, miss: 0 });
  });
  it('האפליקציה מחשבת בדיוק כמו השרת (orders-staff.js, ordProfitOf)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app-source', 'www', 'orders-staff.js'), 'utf8');
    const m = src.match(/const ordProfitOf=o=>\{.*?\};\n/s);
    assert.ok(m, 'ordProfitOf לא נמצא');
    for (const nc of ['skip', 'zero']) {
      const fn = vm.runInNewContext(`const O={cfg:{nc:${JSON.stringify(nc)}}},ncOf=()=>O.cfg.nc==='zero'?'zero':'skip',costOf=id=>id==='p2'?3:null;${m[0]};ordProfitOf`, {});
      assert.deepEqual(JSON.parse(JSON.stringify(fn(ORD))), profitOf(ORD, new Map([['p2', 3]]), nc), nc);
    }
  });
});
describe('חצות בשעון ישראל', () => {
  it('חורף (UTC+2) וקיץ (UTC+3), כולל יום המעבר', () => {
    assert.equal(new Date(ilDayStart('2026-11-12')).toISOString(), '2026-11-11T22:00:00.000Z');
    assert.equal(new Date(ilDayStart('2026-07-01')).toISOString(), '2026-06-30T21:00:00.000Z');
    assert.equal(new Date(ilDayStart('2026-03-27')).toISOString(), '2026-03-26T22:00:00.000Z');
    assert.equal(new Date(ilDayStart('2026-03-28')).toISOString(), '2026-03-27T21:00:00.000Z');
  });
});
