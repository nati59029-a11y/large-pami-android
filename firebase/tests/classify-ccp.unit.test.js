'use strict';
// חשבונית ששולמה באשראי (12.11.2026): סינון השדות החדשים של חשבונית בסריקה האחידה (lib/classify.js), בלי אמולטור.
//   node --test tests/classify-ccp.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require(path.join(__dirname, '..', 'functions', 'lib', 'classify.js'));
const P = require(path.join(__dirname, '..', 'functions', 'lib', 'prompts-classify.js'));

const ALL = C.allowedTypes({ role: 'manager' });
const inv = (fields, type) => C.shapeClassify({ type: type || 'invoice', type_confidence: 0.95, fields, confidence: {} }, ALL);

describe('classify – שולם באשראי', () => {
  it('paid_by_card, card_last4, installments, paid_amount עוברים ומנוקים', () => {
    const r = inv({ supplier: 'ספק', total_with_vat: 1170, paid_by_card: true, card_last4: '1234', installments: 3, paid_amount: '1,000' });
    assert.equal(r.fields.paid_by_card, true);
    assert.equal(r.fields.card_last4, '1234');
    assert.equal(r.fields.installments, 3);
    assert.equal(r.fields.paid_amount, 1000);
  });
  it('מספר כרטיס מלא – רק 4 ספרות אחרונות; פחות מ-4 ספרות = null', () => {
    assert.equal(inv({ card_last4: '4580 1234 5678 9876' }).fields.card_last4, '9876');
    assert.equal(inv({ card_last4: '****9876' }).fields.card_last4, '9876');
    assert.equal(inv({ card_last4: '12' }).fields.card_last4, null);
    assert.ok(!/4580/.test(JSON.stringify(inv({ card_last4: '4580123456789876' }))));
  });
  it('paid_by_card רק true בוליאני; מחרוזת או false = false', () => {
    assert.equal(inv({ paid_by_card: 'true' }).fields.paid_by_card, false);
    assert.equal(inv({ paid_by_card: false }).fields.paid_by_card, false);
    assert.equal(inv({ paid_by_card: 1 }).fields.paid_by_card, false);
  });
  it('installments: 1–36 בלבד', () => {
    assert.equal(inv({ installments: 0 }).fields.installments, null);
    assert.equal(inv({ installments: 37 }).fields.installments, null);
    assert.equal(inv({ installments: 2.5 }).fields.installments, null);
    assert.equal(inv({ installments: '6' }).fields.installments, 6);
  });
  it('שדות שלא נשלחו – לא מופיעים (חשבונית ישנה בלי השדות לא משתנה)', () => {
    const r = inv({ supplier: 'x', total_with_vat: 100 });
    assert.deepEqual(Object.keys(r.fields).sort(), ['supplier', 'total_with_vat']);
  });
  it('עובד בלי הרשאה – סוג בלבד, בלי השדות החדשים', () => {
    const r = C.shapeClassify({ type: 'invoice', fields: { paid_by_card: true, card_last4: '1234' } }, []);
    assert.equal(r.allowed, false);
    assert.deepEqual(r.fields, {});
  });
  it('ההנחיה מבקשת את השדות ומבחינה מ"אשראי 30 יום"', () => {
    for (const k of ['paid_by_card', 'card_last4', 'installments', 'paid_amount']) assert.ok(P.classify.includes('"' + k + '"'), k);
    assert.ok(P.classify.includes('אשראי 30 יום'));
  });
});
