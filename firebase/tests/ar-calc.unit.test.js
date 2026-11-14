'use strict';
// בדיקות יחידה ל-lib/ar-calc.js (לקוח עסקי ומחירים, שלב 1) – בלי אמולטור. הרצה: node --test tests/ar-calc.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AC = require('../functions/lib/ar-calc');

describe('לקוח עסקי – חישובים טהורים (ar-calc)', () => {
  it('הקובץ באפליקציה זהה תו-בתו לקובץ של השרת', () => {
    const a = fs.readFileSync(path.join(__dirname, '../../app-source/www/ar-calc.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../functions/lib/ar-calc.js'), 'utf8');
    assert.equal(a, b);
  });
  it('מינימום פרטי (inc): עלות כוללת מע"מ × (1+X%), עיגול כלפי מעלה לאגורה', () => {
    assert.equal(AC.floorOf(10, 'inc', 18, 15), 11.5);
    assert.equal(AC.floorOf(10.01, 'inc', 18, 15), 11.52); // 11.5115 → 11.52
    assert.equal(AC.floorOf(3.33, 'inc', 18, 10), 3.67); // 3.663 → 3.67
    assert.equal(AC.floorOf(10, 'inc', 18, 0), 10);
    assert.equal(AC.floorOf(10, 'inc', 18, null), 10);
    assert.equal(AC.floorOf(null, 'inc', 18, 15), null);
    assert.equal(AC.floorOf(-1, 'inc', 18, 15), null);
  });
  it('מינימום עסקי (ex): העלות מומרת ללפני מע"מ – השוואה באותה יחידה', () => {
    assert.equal(AC.floorOf(11.8, 'ex', 18, 15), 11.5); // 10 לפני מע"מ × 1.15
    assert.equal(AC.floorOf(11.8, 'ex', 18, 0), 10);
    assert.equal(AC.floorOf(1, 'ex', 18, 0), 0.85); // 0.847… → 0.85 (כלפי מעלה)
    assert.equal(AC.floorOf(11.8, 'ex', 17, 0), 10.09); // 10.085… → 10.09
    assert.equal(AC.floorOf(11.8, 'ex', undefined, 0), 10); // מע"מ חסר = 18
  });
  it('אחוז לפי קטגוריה / תת־קטגוריה / עסק; פרטי – pp נפרד, וריק = כמו עסקי', () => {
    const cfg = { pct: 15, pp: 30, cat: { c1: 20, s1: 5 } };
    assert.equal(AC.pctFor(cfg, true, 'c1', 's1'), 5);
    assert.equal(AC.pctFor(cfg, true, 'c1', 's9'), 20);
    assert.equal(AC.pctFor(cfg, true, 'c9', ''), 15);
    assert.equal(AC.pctFor(cfg, false, 'c1', 's1'), 30);
    assert.equal(AC.pctFor({ pct: 15, cat: { c1: 20 } }, false, 'c1'), 20);
    assert.equal(AC.pctFor({}, true, 'c1'), null);
    assert.equal(AC.pctFor(null, true, 'c1'), null);
  });
  it('מחיר ברירת מחדל: קבוע ← סיטונאי ← רגיל; עסקי בלי סיטונאי = רגיל ÷ (1+מע"מ) (החלטה 7)', () => {
    assert.equal(AC.defPrice({ cp: 7, wp: 8, price: 11.8, vm: 'ex', vat: 18 }), 7);
    assert.equal(AC.defPrice({ wp: 8, price: 11.8, vm: 'ex', vat: 18 }), 8);
    assert.equal(AC.defPrice({ price: 11.8, vm: 'ex', vat: 18 }), 10);
    assert.equal(AC.defPrice({ price: 10, vm: 'ex', vat: 18 }), 8.47);
    assert.equal(AC.defPrice({ wp: 8, price: 11.8, vm: 'inc', vat: 18 }), 11.8);
    assert.equal(AC.defPrice({ cp: 9, price: 11.8, vm: 'inc', vat: 18 }), 9);
  });
  it('בדיקת מחיר: מעל ברירת המחדל תמיד מותר; מתחת – רק עד המינימום; מתחת לעלות; בלי עלות', () => {
    const b = { def: 15, cost: 10, vm: 'inc', vat: 18, pct: 15 };
    assert.deepEqual(AC.priceOk(Object.assign({ price: 16 }, b)), { ok: true });
    assert.deepEqual(AC.priceOk(Object.assign({ price: 15 }, b)), { ok: true });
    assert.equal(AC.priceOk(Object.assign({ price: 11.5 }, b)).ok, true);
    assert.deepEqual(AC.priceOk(Object.assign({ price: 11.49 }, b)), { ok: false, min: 11.5, why: 'floor' });
    assert.deepEqual(AC.priceOk(Object.assign({ price: 9.99 }, b)), { ok: false, min: 11.5, why: 'below-cost' });
    assert.deepEqual(AC.priceOk({ price: 14, def: 15, cost: null, vm: 'inc', vat: 18, pct: 15 }), { ok: false, min: 15, why: 'no-cost' });
    assert.equal(AC.priceOk({ price: 14, def: 15, cost: null, vm: 'inc' }).ok, false);
    // עסקי: עלות 11.80 כולל = 10 לפני; 15% → 11.50 לפני מע"מ
    assert.equal(AC.priceOk({ price: 11.5, def: 13, cost: 11.8, vm: 'ex', vat: 18, pct: 15 }).ok, true);
    assert.equal(AC.priceOk({ price: 11.49, def: 13, cost: 11.8, vm: 'ex', vat: 18, pct: 15 }).why, 'floor');
    // מחיר ברירת מחדל שנמוך מהעלות – לא חוסם (לא העובד הוריד)
    assert.equal(AC.priceOk({ price: 5, def: 5, cost: 10, vm: 'inc', vat: 18, pct: 15 }).ok, true);
  });
  it('סכומי הזמנה: ex / inc / הנחה, באגורות', () => {
    assert.deepEqual(AC.totals(100, 'ex', 18), { net: 100, vat: 18, gross: 118 });
    assert.deepEqual(AC.totals(118, 'inc', 18), { net: 100, vat: 18, gross: 118 });
    assert.deepEqual(AC.totals(10.01, 'ex', 17), { net: 10.01, vat: 1.7, gross: 11.71 }); // 1.7017 → 1.70
    assert.deepEqual(AC.totals(0.03, 'ex', 17), { net: 0.03, vat: 0.01, gross: 0.04 }); // 0.51 אג' → 1
    assert.deepEqual(AC.totals(100, 'inc', 18, 10), { net: 76.27, vat: 13.73, gross: 90, dsc: 10 });
    assert.deepEqual(AC.totals(100, 'ex', 18, 10), { net: 90, vat: 16.2, gross: 106.2, dsc: 10 });
    assert.deepEqual(AC.totals(100, 'inc', 0), { net: 100, vat: 0, gross: 100 });
  });
  it('termsOfCust: כל ערך ישן של pay; terms חדש גובר; pay לא נדרש', () => {
    assert.deepEqual(AC.termsOfCust({ pay: 'n30' }), { b: 'eom', d: 30 });
    assert.deepEqual(AC.termsOfCust({ pay: 'n60' }), { b: 'eom', d: 60 });
    assert.deepEqual(AC.termsOfCust({ pay: 'n90' }), { b: 'eom', d: 90 });
    for (const p of ['cash', 'credit', 'transfer', undefined, '']) assert.deepEqual(AC.termsOfCust({ pay: p }), { b: 'imm', d: 0 });
    assert.deepEqual(AC.termsOfCust({ pay: 'other', payTxt: 'צ\'ק דחוי' }), { b: 'imm', d: 0, warn: true, txt: 'צ\'ק דחוי' });
    assert.deepEqual(AC.termsOfCust({ pay: 'n30', terms: { b: 'inv', d: 45 } }), { b: 'inv', d: 45 });
    assert.deepEqual(AC.termsOfCust({ pay: 'n30', terms: { b: 'bad', d: 1 } }), { b: 'eom', d: 30 });
    assert.deepEqual(AC.termsOfCust(null), { b: 'imm', d: 0 });
    assert.equal(AC.termsOk({ b: 'imm', d: 5 }), false);
    assert.equal(AC.termsOk({ b: 'eom', d: 366 }), false);
    assert.equal(AC.termsTxt({ b: 'eom', d: 60 }), 'שוטף+60');
    assert.equal(AC.termsTxt({ b: 'inv', d: 45 }), '45 ימים מהחשבונית');
  });
  it('סבב 2: cpConv (המרת מחיר קבוע בין vm), payOf (gross ?? total), staffOk (מחיר קבוע לא מכשיר את עצמו; עסקי – לא מתחת לעלות גם בלי מגבלה)', () => {
    assert.equal(AC.cpConv(11.8, 'inc', 'ex', 18), 10); assert.equal(AC.cpConv(10, 'ex', 'inc', 18), 11.8); assert.equal(AC.cpConv(7, 'ex', 'ex', 18), 7); assert.equal(AC.cpConv(7, undefined, 'inc', 18), 7);
    assert.equal(AC.payOf({ vm: 'ex', total: 100, gross: 118 }), 118); assert.equal(AC.payOf({ total: 100, gross: 1 }), 100); assert.equal(AC.payOf({ vm: 'inc', total: 100 }), 100);
    const b = { base: 15, cost: 10, vm: 'inc', vat: 18, pct: 15 };
    assert.equal(AC.staffOk(Object.assign({ price: 1, on: false, biz: false }, b)).ok, true); // פרטי בלי מגבלה – כמו קודם
    assert.equal(AC.staffOk(Object.assign({ price: 9.99, on: false, biz: true }, b)).why, 'below-cost');
    assert.equal(AC.staffOk(Object.assign({ price: 10, on: false, biz: true }, b)).ok, true);
    assert.equal(AC.staffOk(Object.assign({ price: 11, on: true, biz: false }, b)).why, 'floor'); // גם אם 11 הוא "מחיר קבוע"
    assert.equal(AC.staffOk(Object.assign({ price: 15, on: true, biz: false }, b)).ok, true);
    assert.equal(AC.staffOk({ price: 5, base: 5, cost: 10, vm: 'inc', vat: 18, on: true }).why, 'below-cost'); // ברירת מחדל מתחת לעלות – חסום לעובד
  });
  it('סבב 3: staffOk – מחיר קבוע של מנהל (mcp) מאושר גם מתחת לעלות; עסקי – מחיר 0 חסום גם בלי עלות', () => {
    const b = { base: 15, cost: 10, vm: 'inc', vat: 18, pct: 15, on: true, biz: true };
    assert.equal(AC.staffOk(Object.assign({ price: 5, mcp: 5 }, b)).ok, true);
    assert.equal(AC.staffOk(Object.assign({ price: 6, mcp: 5 }, b)).ok, true);
    assert.equal(AC.staffOk(Object.assign({ price: 4.99, mcp: 5 }, b)).why, 'below-cost');
    assert.equal(AC.staffOk(Object.assign({ price: 0, mcp: 0 }, b)).ok, true);
    assert.equal(AC.staffOk({ price: 0, base: 6, vm: 'ex', vat: 18, on: false, biz: true }).why, 'zero');
    assert.equal(AC.staffOk({ price: 0.5, base: 6, vm: 'ex', vat: 18, on: false, biz: true }).ok, true);
    assert.equal(AC.staffOk({ price: 0, base: 6, vm: 'inc', vat: 18, on: false, biz: false }).ok, true); // פרטי בלי מגבלה – כמו קודם
  });
});

