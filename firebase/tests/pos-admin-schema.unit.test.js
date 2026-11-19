'use strict';
// POS:M4 (ש4) – סכמת ההגדרות pos-cfg-schema.js מול האפיון הסופי, פרק 2. בלי אמולטור.
// הרצה: node --test tests/pos-admin-schema.unit.test.js
// מקור הרשימה: tests/fixtures/pos-cfg-spec-keys.json (נוצר מהאפיון ב-scripts/pos-cfg-spec-keys.py).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../functions/lib/pos-cfg-schema');
const SPEC = require('./fixtures/pos-cfg-spec-keys.json');

describe('pos-cfg-schema – מול פרק 2', () => {
  it('מספר המפתחות בסכמה = מספר המפתחות בפרק 2 (313) + rcptBizRc (החלטת בעל העסק, 19.11.2026) = 314, ואותם שמות', () => {
    assert.equal(SPEC.count, 314);
    assert.equal(S.ROWS.length, SPEC.count);
    assert.equal(S.COUNT, SPEC.count);
    assert.deepEqual(S.ROWS.map((r) => r.k).sort(), SPEC.keys.map((x) => x[0]).sort());
  });
  it('אין מפתח מהטור "במקום" (וגם לא מ-2.1)', () => {
    assert.ok(SPEC.replaced.length >= 34);
    for (const k of SPEC.replaced) assert.ok(!S.BY[k], k);
    for (const k of S.REPLACED) assert.ok(!S.BY[k], k);
    assert.deepEqual([...S.REPLACED].sort(), [...SPEC.replaced].sort());
  });
  it('"מי משנה" ו"רגישה" (\\*) – כמו בפרק 2', () => {
    for (const [k, who, sens] of SPEC.keys) {
      assert.equal(S.BY[k].who, who, 'who ' + k);
      assert.equal(S.BY[k].sens, sens, 'sens ' + k);
    }
  });
  it('הקובץ זהה בדפדפן ובשרת', () => {
    const a = fs.readFileSync(path.join(__dirname, '../functions/lib/pos-cfg-schema.js'));
    const b = fs.readFileSync(path.join(__dirname, '../../app-source/www/pos-cfg-schema.js'));
    assert.ok(a.equals(b));
  });
  it('כל שורה תקינה: sec מוכר, ברירת המחדל עוברת את הבדיקה של עצמה, שם בעברית', () => {
    const secs = new Set(S.SECS.map((x) => x[0]));
    for (const r of S.ROWS) {
      assert.ok(secs.has(r.sec), 'sec ' + r.k);
      assert.ok(S.WHO.includes(r.who), 'who ' + r.k);
      assert.ok(/[֐-׿]/.test(r.he), 'he ' + r.k);
      if (r.mod) assert.ok(S.MODS.includes(r.mod), 'mod ' + r.k);
      if (r.def === null && r.t !== 'obj') { assert.ok(r.nul, 'null def ' + r.k); continue; }
      assert.deepEqual(S.check(r, S.defOf(r)), S.defOf(r), 'def ' + r.k);
    }
  });
  it('ערכים לעסק הנוכחי מהפרק (דגימה) והכרעות בעל העסק', () => {
    const c = S.eff({}).cfg;
    assert.deepEqual(c.discMax, { cashier: 0, lead: 10 }); // החלטה 3
    assert.equal(c.docSeries, 'dev'); // החלטה 1
    assert.equal(c['staff.pinFail'], 'lock30'); // החלטה 8
    assert.equal(c.cashMaxMode, 'warn'); // החלטה 14
    assert.equal(c.lockMin, 0);
    assert.equal(c.cashMax, 600000);
    assert.equal(c.vatRate, 18);
    assert.equal(c['sa.type'], 'bakeryDisposable');
    assert.equal(c['sa.maxDev'], 25);
    assert.equal(c.partialPay, 'debt');
    assert.ok(!c.payOn.includes('credit'));
    assert.deepEqual(c.openDays, [0, 1, 2, 3, 4, 5]);
    assert.equal(c.hours, null);
    const m = c['sa.mods'];
    for (const x of ['variants', 'lot', 'expiry', 'preorder', 'delivery', 'layaway', 'offsite', 'custDisplay', 'clock', 'gift', 'club']) assert.equal(m[x], true, x);
    for (const x of ['weight', 'serial', 'services', 'online', 'foreignCur', 'ai']) assert.equal(m[x], false, x);
  });
});

describe('pos-cfg-schema – שכבות, מודולים והרשאות', () => {
  it('שכבות: קוד ← תבנית ← עסק ← סניף (רק brOk)', () => {
    const e = S.eff({ tpl: { retDays: 30, openDays: [1, 2] }, main: { openDays: [0, 1, 2, 3, 4, 5], cat: { nameMax: 50 } }, br: { openDays: [0, 1, 2, 3, 4], retDays: 1 } });
    assert.equal(e.cfg.retDays, 30); assert.equal(e.src.retDays, 'tpl'); // retDays בלי brOk – הסניף לא חל
    assert.deepEqual(e.cfg.openDays, [0, 1, 2, 3, 4]); assert.equal(e.src.openDays, 'br');
    assert.equal(e.cfg['cat.nameMax'], 50); assert.equal(e.src['cat.nameMax'], 'biz');
  });
  it('ערך שמור לא תקין – נופל לשכבה הקודמת', () => {
    const e = S.eff({ main: { lockMin: 999, discMax: { lead: 500, cashier: 3 } } });
    assert.equal(e.cfg.lockMin, 0);
    assert.deepEqual(e.cfg.discMax, { cashier: 3, lead: 10 });
  });
  it('מודול כבוי: ההגדרה מסומנת off (wbc כש-weight כבוי)', () => {
    assert.equal(S.eff({}).off.wbc, true);
    assert.ok(!S.eff({ sa: { mods: { weight: true } } }).off.wbc);
  });
  it('patch: מפתח לא רשום – unknown-key; ערך לא תקין – bad-value', () => {
    assert.throws(() => S.patch({}, { set: { foo: 1 } }, 'own'), (e) => e.reason === 'unknown-key');
    assert.throws(() => S.patch({}, { set: { retDays: -1 } }, 'own'), (e) => e.reason === 'bad-value');
    assert.throws(() => S.patch({}, { set: { cashierStats: true } }, 'sa'), (e) => e.reason === 'unknown-key');
  });
  it('patch: הרשאות לפי who, sa.who ו-sa.lock', () => {
    assert.throws(() => S.patch({}, { set: { payOn: ['cash'] } }, 'mgr'), (e) => e.reason === 'not-allowed');
    assert.throws(() => S.patch({}, { set: { rcptFooter: 'x' } }, 'mgr'), (e) => e.reason === 'not-allowed');
    assert.throws(() => S.patch({}, { set: { cashMaxMode: 'note' } }, 'mgr'), (e) => e.reason === 'not-allowed');
    assert.throws(() => S.patch({}, { set: { 'sa.on': false } }, 'own'), (e) => e.reason === 'not-allowed');
    assert.equal(S.patch({}, { set: { payOn: ['cash'] } }, 'own').main.payOn[0], 'cash');
    assert.equal(S.patch({ sa: { who: { payOn: 'mgr' } } }, { set: { payOn: ['cash'] } }, 'mgr').changes.length, 1);
    assert.throws(() => S.patch({ sa: { lock: ['retDays'] } }, { set: { retDays: 3 } }, 'own'), (e) => e.reason === 'not-allowed');
    assert.equal(S.patch({ sa: { lock: ['retDays'] } }, { set: { retDays: 3 } }, 'sa').main.retDays, 3);
  });
  it('patch: מפתח מנוקד נשמר מקונן; sa.* נשמר ב-sa; obj מתמזג; unset', () => {
    const r = S.patch({ main: { discMax: { cashier: 2, lead: 8 } } }, { set: { 'cat.nameMax': 30, discMax: { lead: 9 } } }, 'sa');
    assert.deepEqual(r.main.cat, { nameMax: 30 });
    assert.deepEqual(r.main.discMax, { cashier: 2, lead: 9 });
    const s = S.patch({}, { set: { 'sa.mods': { weight: true }, 'sa.st': 'active' } }, 'sa');
    assert.deepEqual(s.sa, { mods: { weight: true }, st: 'active' });
    assert.equal(s.main, undefined);
    const u = S.patch({ main: { retDays: 3 } }, { unset: ['retDays'] }, 'mgr');
    assert.deepEqual(u.main, {}); assert.equal(u.changes[0].old, 3);
  });
  it('patch לסניף: רק brOk', () => {
    assert.deepEqual(S.patch({}, { scope: 'br', set: { openDays: [0, 1] } }, 'mgr').br, { openDays: [0, 1] });
    assert.throws(() => S.patch({}, { scope: 'br', set: { retDays: 3 } }, 'mgr'), (e) => e.reason === 'not-br');
  });
  it('pubOf: saPub = on, st, type, mods, ver', () => {
    assert.deepEqual(Object.keys(S.pubOf({ on: true }, 3)).sort(), ['mods', 'on', 'st', 'type', 'ver']);
  });
});

describe('pos-cfg-tpl – תבניות', () => {
  const TP = require('../functions/lib/pos-cfg-tpl');
  it('כל סוג בסכמה יש לו תבנית, וכל ערך בתבנית עובר את הסכמה (בלי sa.*)', () => {
    assert.deepEqual([...TP.TYPES].sort(), [...S.TYPES].sort());
    for (const [t, x] of Object.entries(TP.TPL)) {
      for (const [k, v] of Object.entries(x.vals)) { assert.ok(S.BY[k] && !S.isSa(k), t + ' ' + k); S.check(S.BY[k], v, k); }
      for (const m of Object.keys(x.mods)) assert.ok(S.MODS.includes(m), t + ' ' + m);
    }
  });
  it('תבנית העסק הנוכחי = מודולי ברירת המחדל של הסכמה', () => {
    assert.deepEqual(TP.modsOf('bakeryDisposable', S.MODS), S.eff({}).mods);
  });
  it('הקובץ זהה בדפדפן ובשרת', () => {
    assert.ok(fs.readFileSync(path.join(__dirname, '../functions/lib/pos-cfg-tpl.js')).equals(fs.readFileSync(path.join(__dirname, '../../app-source/www/pos-cfg-tpl.js'))));
  });
});
