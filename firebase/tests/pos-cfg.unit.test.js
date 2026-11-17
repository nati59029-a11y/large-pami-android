'use strict';
// קופה שלב 0 (17.11.2026): הגדרות קופה לכל עסק (functions/lib/pos-cfg.js) – מפתח-ערך עם ברירות מחדל בקוד. בלי אמולטור.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const CF = require('../functions/lib/pos-cfg');
const T = require('../functions/lib/tenant');
const R = require('../functions/lib/roles');

describe('pos – מתג עסק והרשאות', () => {
  it('pos ב-FEATURES, כבוי כברירת מחדל גם בעסק הישן (OFF_IN_LEGACY)', () => {
    assert.ok(T.FEATURES.includes('pos'));
    assert.equal(T.ALL_ON.pos, false);
  });
  it('PERM_KEYS כולל pos ו-posMgr, כבויים כברירת מחדל גם לעובד ישן בלי perms', () => {
    for (const k of ['pos', 'posMgr']) {
      assert.ok(R.PERM_KEYS.includes(k));
      assert.equal(R.DEFAULT_PERMS[k], false);
      assert.equal(R.hasPerm({ role: 'employee', staff: { get: () => undefined } }, k), false);
      assert.equal(R.hasPerm({ role: 'employee', staff: { get: () => ({ [k]: true }) } }, k), true);
      assert.equal(R.hasPerm({ role: 'manager' }, k), true);
    }
  });
});

describe('pos-cfg – הגדרות לכל עסק', () => {
  it('בלי מסמך: סוג כללי וכל ברירות המחדל מהקוד', () => {
    const e = CF.eff(null);
    assert.equal(e.type, 'general');
    assert.equal(e.cfg.vatRate, 18);
    assert.deepEqual(e.cfg.discMax, { cashier: 5, lead: 15 });
    assert.equal(e.cfg.allocMin, 500000);
    assert.equal(e.cfg.cashMax, 600000);
    assert.deepEqual(e.cfg.payOn, ['cash', 'card']);
    assert.deepEqual(e.cfg.wbc, { prefix: '', mode: 'price' });
    assert.equal(e.cfg.retNoRcptPrice, 'cur');
    for (const k of Object.keys(CF.DEFS)) { assert.ok(k in e.cfg, k); assert.equal(e.src[k], 'def'); }
  });
  it('ערך לעסק דורס את ברירת המחדל; obj מתמזג לפי שדה; ערך שמור לא תקין – ברירת מחדל', () => {
    const e = CF.eff({ type: 'disposables', v: { discMax: { lead: 20 }, lockMin: 999, retDays: 30, junk: 1 } });
    assert.equal(e.type, 'disposables');
    assert.deepEqual(e.cfg.discMax, { cashier: 5, lead: 20 });
    assert.equal(e.src.discMax, 'biz');
    assert.equal(e.cfg.lockMin, 3);
    assert.equal(e.src.lockMin, 'def');
    assert.equal(e.cfg.retDays, 30);
    assert.ok(!('junk' in e.cfg));
    assert.equal(CF.eff({ type: 'nope' }).type, 'general');
  });
  it('ברירת מחדל של סוג העסק נכנסת בין הקוד לעסק', () => {
    const TY = Object.assign({}, CF.TYPES, { grocery: { n: 'מכולת', d: { retDays: 7, wbc: { prefix: '2' } } } });
    const e = CF.eff({ type: 'grocery', v: { wbc: { mode: 'wt' } } }, TY);
    assert.equal(e.cfg.retDays, 7);
    assert.equal(e.src.retDays, 'type');
    assert.deepEqual(e.cfg.wbc, { prefix: '2', mode: 'wt' });
    assert.equal(e.src.wbc, 'biz');
    assert.equal(CF.eff({ type: 'grocery' }).cfg.retDays, 14, 'בקוד עצמו אין עדיין ברירות מחדל לסוג');
  });
  it('patch: מנהל משנה רק הגדרות mgr; מנהל־על – הכול כולל סוג העסק', () => {
    const a = CF.patch(null, { set: { discMax: { lead: 20 }, payOn: ['card', 'cash', 'check'] } }, 'mgr');
    assert.deepEqual(a.v, { discMax: { lead: 20 }, payOn: ['cash', 'card', 'check'] });
    assert.throws(() => CF.patch(a, { set: { vatRate: 17 } }, 'mgr'), (e) => e.reason === 'not-allowed');
    assert.throws(() => CF.patch(a, { type: 'grocery' }, 'mgr'), (e) => e.reason === 'not-allowed');
    const b = CF.patch(a, { type: 'disposables', set: { vatRate: 17, cashMax: 500000 }, unset: ['payOn'] }, 'sa');
    assert.deepEqual(b, { type: 'disposables', v: { discMax: { lead: 20 }, vatRate: 17, cashMax: 500000 } });
    const c = CF.patch(b, { set: { discMax: { cashier: 3 } } }, 'mgr');
    assert.deepEqual(c.v.discMax, { lead: 20, cashier: 3 });
  });
  it('patch: מפתח לא מוכר, ערך לא תקין, סוג לא מוכר – נדחים', () => {
    assert.throws(() => CF.patch(null, { set: { nope: 1 } }, 'sa'), (e) => e.reason === 'unknown-key');
    assert.throws(() => CF.patch(null, { set: { discMax: { boss: 1 } } }, 'sa'), (e) => e.reason === 'unknown-key');
    assert.throws(() => CF.patch(null, { set: { lockMin: 1.5 } }, 'mgr'), (e) => e.reason === 'bad-value');
    assert.throws(() => CF.patch(null, { set: { payOn: ['cash', 'cash'] } }, 'mgr'), (e) => e.reason === 'bad-value');
    assert.throws(() => CF.patch(null, { set: { wbc: { prefix: 'ab' } } }, 'mgr'), (e) => e.reason === 'bad-value');
    assert.throws(() => CF.patch(null, { set: { rcptFooter: 'x'.repeat(201) } }, 'mgr'), (e) => e.reason === 'bad-value');
    assert.throws(() => CF.patch(null, { type: 'zz' }, 'sa'), (e) => e.reason === 'bad-type');
    assert.throws(() => CF.patch(null, {}, 'worker'), (e) => e.reason === 'not-allowed');
  });
  it('patch שומר מפתחות שנשמרו ואינם מוכרים (לא מוחק נתונים)', () => {
    const r = CF.patch({ type: 'general', v: { future: 5 } }, { set: { beginner: false } }, 'mgr');
    assert.deepEqual(r.v, { future: 5, beginner: false });
  });
  it('describe: תיאור לכל הגדרה, בלי RegExp, ורשימת סוגי עסק', () => {
    const d = CF.describe();
    assert.equal(Object.keys(d.defs).length, Object.keys(CF.DEFS).length);
    assert.equal(d.defs.vatRate.who, 'sa');
    assert.equal(d.defs.discMax.f.lead.def, 15);
    assert.equal(JSON.parse(JSON.stringify(d)).defs.wbc.f.prefix.re, undefined);
    assert.ok(d.types.find((t) => t.id === 'disposables' && t.n === 'חד-פעמי ומוצרי אפייה'));
  });
});
