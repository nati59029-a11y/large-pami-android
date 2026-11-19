'use strict';
// 19.11.2026: המזכירה מביאה רק חשבוניות – "בטוח שזה לא חשבונית" נדחה אוטומטית, בספק – נשאר
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const SI = require('../functions/lib/sec-inv');
const CL = require('../functions/lib/classify');
const sh = (raw) => CL.shapeClassify(raw, CL.TYPES, {});
const no = (raw) => SI.sureNotInv(sh(raw), raw);

describe('sureNotInv – קובץ חדש אחרי הזיהוי', () => {
  it('מסמך ספק וצ׳ק – תמיד נשארים', () => {
    for (const type of ['invoice', 'delivery_note', 'receipt', 'credit_note', 'check']) assert.equal(no({ type, type_confidence: 0.99, fields: {} }), '', type);
  });
  it('מסמך אחר בביטחון גבוה ("ברור שזה מסמך אחר") – נדחה', () => {
    assert.equal(no({ type: 'unknown', type_confidence: 0.95, fields: { unreadable: false } }), 'unknown');
    assert.equal(no({ type: 'deposit', type_confidence: 0.9, fields: {} }), 'deposit');
    assert.equal(no({ type: 'statement', type_confidence: 0.92, fields: {} }), 'statement');
  });
  it('ספק – נשאר: ביטחון נמוך, "אי אפשר לדעת", או שהמודל לא ענה אם אפשר לקרוא', () => {
    assert.equal(no({ type: 'unknown', type_confidence: 0.8, fields: { unreadable: false } }), '', 'מתחת ל-0.85');
    assert.equal(no({ type: 'unknown', type_confidence: 0.99, fields: { unreadable: true } }), '');
    assert.equal(no({ type: 'unknown', type_confidence: 0.99, fields: {} }), '');
    assert.equal(no({ type: 'unknown', fields: { unreadable: false } }), '', 'בלי ביטחון');
    assert.equal(no({ type: 'transfer', type_confidence: 0.5, fields: {} }), '');
    assert.equal(no(null), '');
  });
});

describe('staleNotInv – מה שכבר ממתין מלפני התיקון', () => {
  const base = { st: 'new', k: 'unk', t0: 'unknown', unsure: [] };
  it('לא זוהה בביטחון / מסמך שאינו של ספק / קובץ לא רלוונטי – נדחה', () => {
    assert.equal(SI.staleNotInv(base), true);
    assert.equal(SI.staleNotInv(Object.assign({}, base, { t0: 'deposit' })), true);
    for (const w of ['type', 'exe', 'empty', 'zip', 'office']) assert.equal(SI.staleNotInv({ st: 'new', k: 'bad', why: [w] }), true, w);
  });
  it('בספק – נשאר', () => {
    assert.equal(SI.staleNotInv(Object.assign({}, base, { unsure: ['type'] })), false, 'סוג לא בטוח');
    assert.equal(SI.staleNotInv(Object.assign({}, base, { err: 'ai' })), false, 'הזיהוי נכשל');
    assert.equal(SI.staleNotInv(Object.assign({}, base, { err: 'quota' })), false);
    assert.equal(SI.staleNotInv(Object.assign({}, base, { t0: '' })), false);
    assert.equal(SI.staleNotInv(Object.assign({}, base, { t0: 'check' })), false);
    assert.equal(SI.staleNotInv(Object.assign({}, base, { tc: 0.95, unr: true })), false, 'אי אפשר לקרוא');
    assert.equal(SI.staleNotInv(Object.assign({}, base, { tc: 0.75, unr: false })), false);
    assert.equal(SI.staleNotInv(Object.assign({}, base, { hold: 'local' })), false, 'מעוכב במכשיר');
    for (const w of ['big', 'dl', 'enc', 'active', 'unv']) assert.equal(SI.staleNotInv({ st: 'new', k: 'bad', why: [w] }), false, w);
    assert.equal(SI.staleNotInv({ st: 'new', k: 'long' }), false);
  });
  it('רק ממתינות – לא בטיפול, לא שאושרו, ולא מסמכי ספק', () => {
    for (const st of ['cl', 'ok', 'rej', 'q', 'qw']) assert.equal(SI.staleNotInv(Object.assign({}, base, { st })), false, st);
    for (const k of ['inv', 'rcpt', 'dn', 'cr', 'chk']) assert.equal(SI.staleNotInv(Object.assign({}, base, { k })), false, k);
  });
});
