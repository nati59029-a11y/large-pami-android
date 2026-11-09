'use strict';
// בדיקות יחידה לחישוב מבצעי ניוד המפושטים (lib/line-discount.js) – בלי אמולטור. הרצה: node --test tests/line-discount.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcCell, ilDay } = require('../functions/lib/line-discount');

const plans = new Map([
  ['p39', { carrier: 'פרטנר', monthly: 39, ship: { amt: 30, pay: 'store' }, sim: { amt: 20, pay: 'carrier' }, promo: { disc: 200 } }],
  ['pQ', { carrier: 'פרטנר', monthly: 49, ship: { amt: 10, pay: 'store' }, promo: { qty: { n: 3, amt: 150, scope: 'plan' } } }],
  ['pQc', { carrier: 'פרטנר', monthly: 59, promo: { qty: { n: 2, amt: 100, scope: 'carrier' } } }],
  ['pQa', { carrier: 'הוט', monthly: 29, promo: { qty: { n: 3, amt: 90, scope: 'all' } } }],
  ['pH', { carrier: 'הוט', monthly: 29.9, sim: { amt: 10, pay: 'store' } }],
  ['pC', { carrier: 'סלקום', monthly: 49 }],
  ['pOld', { carrier: 'פרטנר', promo: { disc: 50, from: '2026-01-01', to: '2026-01-31' } }],
  ['pFut', { carrier: 'פרטנר', monthly: 1, promo: { disc: 70, from: '2026-11-10' } }],
]);
const T = '2026-11-09';
const run = (ps, man, items) => calcCell(ps.map((p) => ({ plan: p })), plans, man == null ? null : man, { today: T, itemsAg: Math.round((items || 0) * 100) });

describe('מבצעי ניוד – פישוט', () => {
  it('לחנות נספר, לחברה ועלות חודשית מוצגים בלבד; בלי מבצע – אין הנחה', () => {
    const r = run(['pH', 'pC'], null, 100);
    assert.equal(r.store, 10); assert.equal(r.ext, 0); assert.equal(r.monthly, 78.9);
    assert.equal(r.sug, 0); assert.equal(r.disc, 0); assert.equal(r.net, 110);
  });
  it('הנחה בסכום בקנייה – לכל קו בחבילה', () => {
    const r = run(['p39', 'p39'], null, 500);
    assert.equal(r.sug, 400); assert.equal(r.disc, 400); assert.equal(r.ext, 40); assert.equal(r.net, 500 + 60 - 400);
  });
  it('העובד משנה את הסה"כ: למטה, למעלה, 0 = בלי הנחה', () => {
    assert.equal(run(['p39'], 80, 500).disc, 80);
    assert.equal(run(['p39'], 250, 500).disc, 250);
    const z = run(['p39'], 0, 500); assert.equal(z.disc, 0); assert.equal(z.net, 530); assert.equal(z.sug, 200);
  });
  it('לא מתחת ל-0: ההנחה מוגבלת לסכום לחנות', () => {
    const r = run(['p39'], null, 50); assert.equal(r.disc, 80); assert.equal(r.net, 0);
    assert.equal(run(['p39'], 9999, 0).net, 0);
  });
  it('מבצע כמות – אותה חבילה: 2 קווים לא, 3 כן (פעם אחת), והמלצה ב-2', () => {
    const a = run(['pQ', 'pQ'], null, 0);
    assert.equal(a.sug, 0); assert.ok(a.hint); assert.match(a.hint.msg, /עוד קו אחד באותה חבילה יזכה בהנחה של ₪150 \(מבצע 3 קווים\)/);
    const b = run(['pQ', 'pQ', 'pQ'], null, 0);
    assert.equal(b.sug, 150); assert.equal(b.disc, 30); // ההנחה בפועל מוגבלת לסכום לחנות (3×10)
    assert.equal(run(['pQ', 'pQ', 'pQ'], null, 1000).sug, 150); assert.equal(b.hint, null);
  });
  it('מבצע כמות – אותה חברה: קו פרטנר מחבילה אחרת נספר; הוט לא', () => {
    assert.equal(run(['pQc', 'p39'], null, 1000).sug, 100 + 200);
    const r = run(['pQc', 'pH'], null, 1000); assert.equal(r.sug, 0); assert.match(r.hint.msg, /באותה חברה/);
  });
  it('מבצע כמות – כל קו בהזמנה', () => {
    assert.equal(run(['pQa', 'pC', 'p39'], null, 1000).sug, 90 + 200);
    assert.equal(run(['pQa', 'pC'], null, 1000).sug, 0);
  });
  it('תאריכי תוקף: מבצע שפג או שעוד לא התחיל – לא חל', () => {
    assert.equal(run(['pOld'], null, 100).sug, 0);
    assert.equal(run(['pFut'], null, 100).sug, 0);
    assert.equal(calcCell([{ plan: 'pFut' }], plans, null, { today: '2026-11-10', itemsAg: 10000 }).sug, 70);
  });
  it('אגורות: בלי שגיאות עיגול', () => {
    const r = calcCell([{ plan: 'pH' }], plans, 0.1, { today: T, itemsAg: 20 }); // 0.2 + 10 − 0.1
    assert.equal(r.net, 10.1);
  });
  it('שעון ישראל: חצות בחורף ובקיץ', () => {
    assert.equal(ilDay(Date.UTC(2026, 0, 1, 22, 30)), '2026-01-02'); // חורף +2
    assert.equal(ilDay(Date.UTC(2026, 6, 1, 21, 30)), '2026-07-02'); // קיץ +3
  });
});
