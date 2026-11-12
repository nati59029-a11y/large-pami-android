'use strict';
// בדיקות יחידה לחישובי תמחור חשבונית ספק (lib/pricing-calc.js) – בלי אמולטור. הרצה: node --test tests/pricing-calc.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PC = require('../functions/lib/pricing-calc');

describe('תמחור – חישובים טהורים', () => {
  it('הקובץ באפליקציה זהה תו-בתו לקובץ של השרת', () => {
    const a = fs.readFileSync(path.join(__dirname, '../../app-source/www/pricing-calc.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../functions/lib/pricing-calc.js'), 'utf8');
    assert.equal(a, b);
  });
  it('עיגול סיטונאי למעלה לסיום .0 / .5 / .9 בכל טווח (החלטה 1)', () => {
    const T = [[1.3, 1.5], [1.6, 1.9], [1.91, 2], [10.3, 10.5], [10.6, 10.9], [10.91, 11], [1, 1], [1.5, 1.5], [1.9, 1.9], [2, 2],
      [1.01, 1.5], [1.51, 1.9], [12.3, 12.5], [12.7, 12.9], [0.4, 0.5], [0.01, 0.5], [0.95, 1], [99.95, 100], [99.5, 99.5], [100.2, 100.5],
      [1.245, 1.5], [0, 0], ['1,3', 1.5], ['2.6', 2.9]];
    for (const [x, y] of T) assert.equal(PC.roundWs(x), y, `${x} → ${y}`);
  });
  it('עיגול: ריק / לא מספר / שלילי = null', () => {
    for (const x of [null, undefined, '', '   ', '₪', ' ₪ ', 'abc', -1, -0.5, NaN, Infinity, true, {}]) assert.equal(PC.roundWs(x), null, JSON.stringify(x));
  });
  it('סיטונאי ברירת מחדל = עלות לפני מע"מ × 1.5 ואז עיגול (החלטה 2)', () => {
    const T = [[1, 1.5], [0.87, 1.5], [1.2, 1.9], [1.28, 2], [4, 6], [6.9, 10.5], [10, 15], [0, 0], [0.01, 0.5]];
    for (const [c, w] of T) assert.equal(PC.wsDefault(c), w, `${c} → ${w}`);
    for (const x of [null, '', -2, 'x']) assert.equal(PC.wsDefault(x), null);
  });
  it('אחוז רווח על העלות, שני הצדדים בלי מע"מ', () => {
    assert.equal(PC.margin(15, 10), 50);
    assert.equal(PC.margin(10, 10), 0);
    assert.equal(PC.margin(8, 10), -20);
    assert.equal(PC.margin(1, 3), -66.7);
    assert.equal(PC.margin(4, 3), 33.3);
    assert.equal(PC.margin(5, 0), null, 'עלות 0 – אין אחוז');
    assert.equal(PC.margin('', 3), null);
    assert.equal(PC.margin(5, ''), null);
    assert.equal(PC.margin(5, -1), null);
    // מחיר לצרכן כולל מע"מ 18%: 11.8 → 10 לפני מע"מ, עלות 8 → 25%
    assert.equal(PC.marginInc(11.8, 8, 18), 25);
    assert.equal(PC.marginInc(11.8, 8), 25, 'ברירת מחדל 18%');
    assert.equal(PC.marginInc(10, 8, 0), 25);
  });
  it('המרות מע"מ באגורות', () => {
    assert.equal(PC.withVat(10, 18), 11.8);
    assert.equal(PC.withVat(0.99, 18), 1.17);
    assert.equal(PC.noVat(11.8, 18), 10);
    assert.equal(PC.noVat(1, 18), 0.85);
    assert.equal(PC.withVat(10, 17), 11.7);
    assert.equal(PC.withVat(10, 'x'), 11.8, 'מע"מ לא תקין = 18');
    assert.equal(PC.withVat(10, 150), 11.8);
    assert.equal(PC.withVat(0, 18), 0);
    assert.equal(PC.withVat('', 18), null);
    assert.equal(PC.noVat(-5, 18), null);
  });
  it('מארז וקרטון (החלטה 3): עלות מארז = מחיר קרטון ÷ ct; מחיר קרטון = מחיר מארז × ct', () => {
    assert.equal(PC.packCost(120, 12), 10);
    assert.equal(PC.packCost(100, 3), 33.33);
    assert.equal(PC.packCost(100, 6), 16.67);
    assert.equal(PC.cartonPrice(10, 12), 120);
    assert.equal(PC.cartonPrice(1.17, 3), 3.51);
    for (const ct of [0, -1, 1.5, '', null, 'x']) { assert.equal(PC.packCost(120, ct), null, String(ct)); assert.equal(PC.cartonPrice(10, ct), null); }
    assert.equal(PC.packCost('', 12), null);
    assert.equal(PC.unitCost(120, 'ct', 12), 10);
    assert.equal(PC.unitCost(4.5, 'u', 12), 4.5);
    assert.equal(PC.unitCost(4.5, 'pk', 12), 4.5);
    assert.equal(PC.unitCost(120, 'ct', 0), null);
  });
  it('שינוי עלות מול העלות הקודמת', () => {
    assert.equal(PC.costChange(5, 4.5), 'up');
    assert.equal(PC.costChange(4, 4.5), 'down');
    assert.equal(PC.costChange(4.5, 4.5), '');
    assert.equal(PC.costChange(4.501, 4.5), '', 'אותה אגורה');
    assert.equal(PC.costChange(4.5, null), '');
    assert.equal(PC.costChange('', 4), '');
  });
  it('מספרים מהמסך: פסיק עשרוני, ₪ ורווחים', () => {
    assert.equal(PC.num(' 1,5 '), 1.5);
    assert.equal(PC.num('₪ 12'), 12);
    assert.equal(PC.num('0'), 0);
    assert.equal(PC.num(''), null);
    assert.equal(PC.num('  '), null); assert.equal(PC.num('₪'), null); assert.equal(PC.num(' ₪ '), null);
    assert.equal(PC.wsDefault(' '), null); assert.equal(PC.withVat('₪', 18), null); assert.equal(PC.margin(' ', 3), null);
  });
});
