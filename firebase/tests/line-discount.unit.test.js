'use strict';
// בדיקות יחידה לחישוב הנחות ניוד (lib/line-discount.js) – בלי אמולטור. הרצה: node --test tests/line-discount.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcCell, CalcErr } = require('../functions/lib/line-discount');

const plans = new Map([
  ['pP', { carrier: 'פרטנר', monthly: 39.9, ship: { amt: 30, pay: 'store' }, sim: { amt: 20, pay: 'carrier' } }],
  ['pH', { carrier: 'הוט', monthly: 29.9, ship: { amt: 30, pay: 'store' }, sim: { amt: 10, pay: 'store' } }],
  ['pC', { carrier: 'סלקום', monthly: 49, sim: { amt: 25, pay: 'store' } }],
  ['pOld', { name: 'ישנה', carrier: 'פרטנר', days: 60, on: true }],
]);
const T = '2026-11-09';
const run = (lines, cfg, man, opt) => calcCell(lines.map((p) => ({ plan: p })), plans, cfg, man, Object.assign({ today: T, itemsAg: 0 }, opt || {}));
const P3 = { id: 'x3', name: '3 קווים', carriers: ['פרטנר', 'הוט'], min: 3, kind: 'once', disc: { t: 'amt', v: 100 }, stack: 'add', on: true };

describe('חישוב הנחות ניוד', () => {
  it('חבילה לכל קו, לחברות שונות; לחנות נספר, לחברה ועלות חודשית מוצגים בלבד', () => {
    const r = run(['pP', 'pH', 'pC'], {});
    assert.equal(r.store, 30 + 40 + 25);
    assert.equal(r.ext, 20);
    assert.equal(r.monthly, 118.8);
    assert.deepEqual(r.lines.map((l) => l.c), ['פרטנר', 'הוט', 'סלקום']);
    assert.equal(r.disc, 0);
  });
  it('הנחה קבועה לכל חברה בנפרד – סכום ואחוז', () => {
    const r = run(['pP', 'pH'], { disc: { 'פרטנר': { t: 'amt', v: 10 }, 'הוט': { t: 'pct', v: 50 } } });
    assert.deepEqual(r.lines.map((l) => l.fix), [10, 20]);
    assert.equal(r.disc, 30); assert.equal(r.net, 40);
  });
  it('הנחה קבועה לא עוברת את התשלום לחנות של הקו; לא נוגעת בלחברה/חודשי', () => {
    const r = run(['pP'], { disc: { 'פרטנר': { t: 'amt', v: 500 } } });
    assert.equal(r.disc, 30); assert.equal(r.net, 0); assert.equal(r.ext, 20); assert.equal(r.monthly, 39.9);
  });
  it('מבצע "פעם אחת": חברות משתתפות נספרות יחד; מתחת למינימום – אין', () => {
    assert.equal(run(['pP', 'pH'], { promos: [P3] }).promo, null);
    const r = run(['pP', 'pH', 'pH'], { promos: [P3] });
    assert.equal(r.promo.id, 'x3'); assert.equal(r.disc, 100);
  });
  it('מבצע "לכל קו": ההנחה לכל קו משתתף', () => {
    const p = Object.assign({}, P3, { kind: 'line', disc: { t: 'amt', v: 15 }, min: 2 });
    const r = run(['pP', 'pH', 'pC'], { promos: [p] });
    assert.equal(r.disc, 30);
  });
  it('כמה מבצעים – רק המשתלם ביותר', () => {
    const a = Object.assign({}, P3, { id: 'a', min: 2, disc: { t: 'amt', v: 20 } });
    const b = Object.assign({}, P3, { id: 'b', min: 2, kind: 'line', disc: { t: 'amt', v: 15 } });
    const r = run(['pP', 'pH', 'pH'], { promos: [a, b] });
    assert.equal(r.promo.id, 'b'); assert.equal(r.disc, 45);
  });
  it('מצטרף מוסיף לקבועה; מחליף מבטל אותה בקווים המשתתפים', () => {
    const disc = { 'פרטנר': { t: 'amt', v: 5 }, 'סלקום': { t: 'amt', v: 5 } };
    const add = run(['pP', 'pH', 'pH', 'pC'], { disc, promos: [P3] });
    assert.equal(add.disc, 100 + 5 + 5);
    const rep = run(['pP', 'pH', 'pH', 'pC'], { disc, promos: [Object.assign({}, P3, { stack: 'replace' })] });
    assert.equal(rep.disc, 100 + 5); // פרטנר (משתתף) בלי קבועה, סלקום (לא משתתף) נשאר
  });
  it('הנחה ידנית כשיש מבצע – נדחית; שינוי מבצע מחליף אותו; ביטול מחזיר לקבועה', () => {
    assert.throws(() => run(['pP', 'pH', 'pH'], { promos: [P3] }, { order: { t: 'amt', v: 5 } }), (e) => e instanceof CalcErr && e.reason === 'promo-active');
    const ed = run(['pP', 'pH', 'pH'], { promos: [P3] }, { promo: { id: 'x3', disc: { t: 'amt', v: 80 } } });
    assert.equal(ed.disc, 80); assert.deepEqual(ed.promo.edit, { t: 'amt', v: 80 });
    const off = run(['pP', 'pH', 'pH'], { promos: [P3], disc: { 'הוט': { t: 'amt', v: 3 } } }, { promo: { id: 'x3', off: true } });
    assert.equal(off.disc, 6); assert.equal(off.promo.off, true);
  });
  it('בלי מבצע – ידנית לקו או להזמנה', () => {
    assert.equal(run(['pP', 'pH'], {}, { lines: [{ t: 'amt', v: 7 }, null] }).disc, 7);
    assert.equal(run(['pP', 'pH'], {}, { order: { t: 'pct', v: 10 } }).disc, 7);
  });
  it('תקרה: עובד מעל התקרה נדחה; מנהל/בלי תקרה – אין הגבלה; הזמנה עם כמה חברות – הנמוכה', () => {
    const cap = { 'פרטנר': { t: 'amt', v: 10 }, 'הוט': { t: 'amt', v: 20 } };
    assert.throws(() => run(['pP'], { cap }, { lines: [{ t: 'amt', v: 11 }] }, { capped: true }), (e) => e.reason === 'over-cap');
    assert.equal(run(['pP'], { cap }, { lines: [{ t: 'amt', v: 10 }] }, { capped: true }).disc, 10);
    assert.equal(run(['pP'], { cap }, { lines: [{ t: 'amt', v: 25 }] }, { capped: false }).disc, 25);
    assert.equal(run(['pC'], { cap }, { lines: [{ t: 'amt', v: 25 }] }, { capped: true }).disc, 25);
    assert.throws(() => run(['pP', 'pH'], { cap }, { order: { t: 'amt', v: 15 } }, { capped: true }), (e) => e.reason === 'over-cap');
    assert.throws(() => run(['pP', 'pH', 'pH'], { cap, promos: [P3] }, { promo: { id: 'x3', disc: { t: 'amt', v: 150 } } }, { capped: true }), (e) => e.reason === 'over-cap');
  });
  it('סכום לחנות לא שלילי (הנחה גדולה מהסכום)', () => {
    const r = run(['pP', 'pH', 'pH'], { promos: [Object.assign({}, P3, { disc: { t: 'amt', v: 1000 } })] });
    assert.equal(r.net, 0); assert.equal(r.disc, 110);
  });
  it('אגורות: 33.33% על 3 קווים – בלי שגיאות עיגול', () => {
    const p = Object.assign({}, P3, { kind: 'line', disc: { t: 'pct', v: 33.33 } });
    const r = run(['pP', 'pP', 'pP'], { promos: [p] });
    assert.equal(r.disc, 30); // 10.00 (=999.9 אגורות → 1000) ×3
    assert.equal(r.net, 60);
    assert.ok(Number.isInteger(Math.round(r.net * 100)) && Math.abs(r.net * 100 - Math.round(r.net * 100)) < 1e-9);
  });
  it('המלצה: קו לחברה לא משתתפת – הודעה עם חברות, מבצע וסכום; בלי שיפור – אין', () => {
    const h = run(['pP', 'pH', 'pC'], { promos: [P3] }).hint;
    assert.equal(h.line, 2); assert.deepEqual(h.carriers, ['פרטנר', 'הוט']); assert.equal(h.name, '3 קווים'); assert.equal(h.disc, 100);
    assert.equal(run(['pP', 'pH', 'pH'], { promos: [P3] }).hint, null);
    assert.equal(run(['pC'], { promos: [P3] }).hint, null);
  });
  it('מבצע כבוי או מחוץ לתאריכים – לא חל', () => {
    assert.equal(run(['pP', 'pH', 'pH'], { promos: [Object.assign({}, P3, { on: false })] }).disc, 0);
    assert.equal(run(['pP', 'pH', 'pH'], { promos: [Object.assign({}, P3, { to: '2026-11-08' })] }).disc, 0);
    assert.equal(run(['pP', 'pH', 'pH'], { promos: [Object.assign({}, P3, { from: '2026-11-09', to: '2026-11-09' })] }).disc, 100);
  });
  it('legacy: חבילה ישנה / קו בלי חבילה – אפס בכל השדות', () => {
    const r = calcCell([{ plan: 'pOld' }, { carrier: 'פרטנר' }, {}], plans, {}, {}, { today: T });
    assert.deepEqual([r.store, r.disc, r.net, r.ext, r.monthly, r.promo, r.hint], [0, 0, 0, 0, 0, null, null]);
  });
});
