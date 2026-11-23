'use strict';
// גיטי – מרכז שליטה (app-source/www/sec-hub.js, החלק הטהור): מצב חיבורים, איחוד פריטי תשומת לב בלי כפילויות, סינון יומן ושאילתת דפים.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../app-source/www/sec-hub.js');

const by = (L, k) => L.find((x) => x.k === k);

describe('sec-hub: מצב חיבורים (רק לפי מקור אמיתי)', () => {
  it('בלי שום מקור – הכול "טרם נבדק", ואף אחד לא "פעיל"', () => {
    const L = C.connOf({});
    assert.equal(L.length, 5);
    assert.ok(L.every((x) => x.s === 'unk' && x.sl === 'טרם נבדק'));
  });
  it('Gmail: מחובר / פג / לא חובר / לא הוגדר בשרת', () => {
    const g = (o) => by(C.connOf({ gs: o }), 'gmail');
    assert.equal(g({ configured: true, boxes: [{ id: 'a', st: 'ok' }] }).s, 'ok');
    assert.equal(g({ configured: true, boxes: [{ id: 'a', st: 'ok' }, { id: 'b', st: 'expired' }] }).s, 'perm');
    assert.equal(g({ configured: true, boxes: [] }).s, 'off');
    assert.equal(g({ configured: false, boxes: [] }).s, 'off');
    assert.equal(g({ err: 'x' }).s, 'unk');
  });
  it('יומן Google ווצאפ', () => {
    const L = C.connOf({ gs: { configured: true, boxes: [], cal: { connected: true, st: 'expired' } }, wc: { connected: true } });
    assert.equal(by(L, 'gcal').s, 'perm');
    assert.equal(by(L, 'wa').s, 'ok');
    assert.equal(by(C.connOf({ wc: { connected: false } }), 'wa').s, 'off');
    assert.equal(by(C.connOf({ wc: { err: 'x' } }), 'wa').s, 'unk');
  });
  it('התראות מהטלפון: לא באפליקציה = טרם נבדק; יש קליטה בלי גישה = דורש הרשאה', () => {
    const n = (o) => by(C.connOf({ nf: o }), 'notif').s;
    assert.equal(n({ native: false }), 'unk');
    assert.equal(n({ native: true, plug: false }), 'unk');
    assert.equal(n({ native: true, plug: true, on: true, en: true }), 'ok');
    assert.equal(n({ native: true, plug: true, on: true, en: false }), 'perm');
    assert.equal(n({ native: true, plug: true, on: false, en: true }), 'off');
    assert.equal(n({ native: true, plug: true, err: 1 }), 'unk');
  });
  it('נתוני הכספים: פעיל רק עם חותמת זמן אמיתית; מראה כבוי = מנותק', () => {
    const b = (st) => by(C.connOf({ st }), 'biz').s;
    assert.equal(b({ ok: true, mirror: true, mirrorAt: 1795000000000 }), 'ok');
    assert.equal(b({ ok: true, mirror: true, mirrorAt: null }), 'unk');
    assert.equal(b({ ok: true, mirror: false, mirrorAt: 5 }), 'off');
    assert.equal(b(null), 'unk');
  });
});

describe('sec-hub: איחוד פריטי תשומת לב', () => {
  it('אותו מזהה (או הפניה) לא מוצג פעמיים', () => {
    const eyes = [{ id: 'n:1', go: { id: 'T9' } }, { id: 'i:2' }];
    const ex = [{ id: 'tk:T9', ref: 'T9' }, { id: 'tk:T8', ref: 'T8' }, { id: 'rq:5', ref: '5' }, { id: 'tk:T8', ref: 'T8' }];
    assert.deepEqual(C.mergeAttention(eyes, ex).map((x) => x.id), ['tk:T8', 'rq:5']);
  });
  it('פריט בלי מזהה נזרק; קלט לא תקין לא זורק', () => {
    assert.deepEqual(C.mergeAttention(null, [{ title: 'x' }]), []);
    assert.deepEqual(C.mergeAttention([{ id: 'a' }], null), []);
  });
});

describe('sec-hub: יומן פעולות', () => {
  const L = [
    { id: '1', t: 1000, act: 'factOk', title: 'אושרה עובדה', note: 'חלב טרי', who: 'mgr' },
    { id: '2', t: 2000, act: 'calAdd', title: 'נוסף אירוע ביומן', who: 'sec' },
    { id: '3', t: 3000, act: 'readChat', title: 'צפייה בשיחה', who: 'sa' },
    { id: '4', t: 4000, act: 'nf:task', title: 'התראה מדני – נפתחה משימה', who: 'auto' },
  ];
  it('סוג לפי שם הפעולה', () => {
    assert.equal(C.logType('factOk'), 'facts');
    assert.equal(C.logType('calDel'), 'cal');
    assert.equal(C.logType('remDone'), 'cal');
    assert.equal(C.logType('readChat'), 'chat');
    assert.equal(C.logType('nf:ign'), 'nf');
    assert.equal(C.logType('zzz'), 'other');
  });
  it('חיפוש (כל המילים), סוג וטווח תאריכים', () => {
    assert.deepEqual(C.logFilter(L, { q: 'חלב' }).map((x) => x.id), ['1']);
    assert.deepEqual(C.logFilter(L, { q: 'עובדה אושרה' }).map((x) => x.id), ['1']);
    assert.deepEqual(C.logFilter(L, { q: 'מנהל המערכת' }).map((x) => x.id), ['3']);
    assert.deepEqual(C.logFilter(L, { type: 'cal' }).map((x) => x.id), ['2']);
    assert.deepEqual(C.logFilter(L, { from: 2000, to: 3000 }).map((x) => x.id), ['2', '3']);
    assert.equal(C.logFilter(L, {}).length, 4);
    assert.deepEqual(C.logFilter(null, {}), []);
  });
  it('שאילתת דף: בלי תקרה של 20, מהחדש לישן, עם מסנני t בלבד (בלי אינדקס מורכב)', () => {
    const q0 = C.logQuery({});
    assert.equal(q0.limit, 50);
    assert.equal(q0.where, undefined);
    assert.equal(q0.orderBy[0].direction, 'DESCENDING');
    const q1 = C.logQuery({ cursor: 5000 });
    assert.equal(q1.where.fieldFilter.op, 'LESS_THAN_OR_EQUAL');
    assert.equal(q1.where.fieldFilter.value.integerValue, '5000');
    const q2 = C.logQuery({ from: 1000, to: 9000, cursor: 5000 });
    assert.equal(q2.where.compositeFilter.filters.length, 2);
    assert.equal(q2.where.compositeFilter.filters[1].fieldFilter.value.integerValue, '5000');
    assert.equal(C.logQuery({ from: 1000, to: 3000, cursor: 5000 }).where.compositeFilter.filters[1].fieldFilter.value.integerValue, '3000');
    assert.ok(JSON.stringify(q2).split('fieldPath').every((x, i) => i === 0 || /^":"t"/.test(x)));
  });
});

// 23.11.2026 (גיטי, סבב 2): תוצאה ביומן, סינון "נכשל", "נשלח לבד" דרך השרת, מצב כספית
describe('sec-hub סבב 2: תוצאה, נשלח לבד, כספית', () => {
  const L = [
    { id: 'a', t: 1, act: 'sendFail', res: 'fail', why: 'retries', who: 'auto' },
    { id: 'b', t: 2, act: 'autoSend', res: 'ok', who: 'auto' },
    { id: 'c', t: 3, act: 'factOk', who: 'mgr' }, // רשומה ישנה / בלי תוצאה
  ];
  it('סינון לפי תוצאה; רשומה בלי השדה לא נחשבת "נכשל" ולא "הצליח"', () => {
    assert.deepEqual(C.logFilter(L, { res: 'fail' }).map((x) => x.id), ['a']);
    assert.deepEqual(C.logFilter(L, { res: 'ok' }).map((x) => x.id), ['b']);
    assert.equal(C.logFilter(L, {}).length, 3);
    assert.equal(C.resOf(L[2]), '');
    assert.equal(C.resL(L[0]), 'נכשל – לא עובדה אחרי כמה ניסיונות');
    assert.equal(C.resL({ res: 'fail', why: 'zz9' }), 'נכשל – קוד: zz9');
    assert.equal(C.resL({ res: 'fail' }), 'נכשל');
    assert.equal(C.resL(L[1]), 'הצליח'); assert.equal(C.resL(L[2]), '');
  });
  it('mlogRows: נשלח / נכשל, סוג "ml", בלי פריטים לא תקינים', () => {
    const R = C.mlogRows([{ id: 'x1', t: 10, ch: 'wa', st: 'sent', to: '050***12', ri: 'לענות על שעות', by: 'אני' }, { id: 'x2', t: 11, ch: 'mail', st: 'fail', whyL: ['השליחה נכשלה'] }, { t: 5 }, null]);
    assert.equal(R.length, 2);
    assert.equal(R[0].res, 'ok'); assert.match(R[0].title, /נשלח לבד בווצאפ ל050\*\*\*12/);
    assert.equal(R[1].res, 'fail'); assert.equal(C.resL(R[1]), 'נכשל – השליחה נכשלה');
    assert.equal(C.logType(R[0].act), 'ml');
    assert.deepEqual(C.logFilter(R, { res: 'fail' }).map((x) => x.id), ['mlx2']);
    assert.deepEqual(C.mlogRows(undefined), []);
  });
  it('כספית: אין מקור – אין שורה; כל מצב לפי תשובת השרת בלבד', () => {
    assert.equal(by(C.connOf({}), 'cx'), undefined);
    const x = (cx) => by(C.connOf({ cx }), 'cx').s;
    assert.equal(x({ err: 'x' }), 'unk');
    assert.equal(x({ dev: null }), 'off');
    assert.equal(x({ dev: { id: 'd' }, lr: null }), 'unk');
    assert.equal(x({ dev: { id: 'd' }, lr: { st: 'ok', at: 5 } }), 'ok');
    assert.equal(x({ dev: { id: 'd' }, lr: { st: 'needs-login', at: 5 } }), 'perm');
    assert.equal(x({ dev: { id: 'd' }, lr: { st: 'fail', at: 5 } }), 'off');
    assert.equal(x({ dev: { id: 'd' }, lr: { st: 'run', at: 5 } }), 'unk');
  });
});

// תיקון סבב 2 (גיטי): כל שליחה נספרת ומוצגת פעם אחת; כשלי גבייה מקבלים תוצאה; סיבות בעברית
describe('יומן: תוצאה אחת לכל שליחה (תיקון סבב 2)', () => {
  const SEC = require('../functions/secretary.js')._core;
  const okCount = (L) => L.filter((l) => l.res === 'ok').length;
  it('מייל אחד לפי כלל אישי (mailMrAuto + mrSend) = "1 הצליחו"; tkpOk לא נספר', () => {
    const L = [SEC.logData('', 'auto', 'mailMrAuto', { tgt: 'i1', note: 'r1:box' }), SEC.logData('u1', 'auto', 'mrSend', { tgt: 'i1', note: 'r1' }), SEC.logData('u1', 'mgr', 'tkpOk', { tgt: 'sectp0', note: 'task' })];
    assert.equal(okCount(L), 1);
    assert.equal(okCount([SEC.logData('', 'auto', 'waMrAuto', {}), SEC.logData('u1', 'auto', 'mrSend', {})]), 1);
    assert.equal(SEC.logData('u1', 'mgr', 'tkpOk', { tgt: 'x' }).res, undefined);
    const f = SEC.logData('u1', 'auto', 'mrFail', { note: 'r1' });
    assert.equal(f.res, 'fail'); assert.equal(f.why, 'send');
  });
  it('mlDedup: שורת "נשלח לבד" שכבר מופיעה ב-sec_log (ml) לא מוצגת פעמיים; בלי קישור (רשומה ישנה) – נשארת', () => {
    const ml = C.mlogRows([{ id: 'a1', t: 10, ch: 'mail', st: 'sent' }, { id: 'a2', t: 11, ch: 'wa', st: 'fail' }, { id: 'a3', t: 12, ch: 'wa', st: 'sent' }]);
    const srv = [{ id: 's1', t: 10, act: 'mrSend', res: 'ok', ml: 'a1' }, { id: 's2', t: 11, act: 'mrFail', res: 'fail', ml: 'a2' }, { id: 's3', t: 9, act: 'mailMrAuto' }];
    assert.deepEqual(C.mlDedup(srv, ml).map((x) => x.id), ['mla3']);
    const all = C.logFilter(srv.concat(C.mlDedup(srv, ml)), { res: 'ok' });
    assert.deepEqual(all.map((x) => x.id), ['s1', 'mla3']);
    assert.deepEqual(C.mlDedup(srv, undefined), []); assert.equal(C.mlDedup(null, ml).length, 3);
  });
  it('סיבות כישלון נפוצות – בעברית ולא "קוד: …"', () => {
    for (const w of ['file', 'quota', 'ai', 'resource-exhausted', 'unavailable', 'no-tpl', 'stopped', 'not-connected', 'google-expired']) assert.doesNotMatch(C.whyL(w), /^קוד:/, w);
    assert.equal(C.resL({ res: 'fail', why: 'quota' }), 'נכשל – הגיע למגבלת השימוש בבינה המלאכותית');
  });
  it('גבייה (lib/ar-send.js): outLimit ו-sendFail נרשמים עם res:"fail" ו-why; arSend – "ok"', async () => {
    const S = require('../functions/lib/ar-send.js');
    const logs = [];
    const mk = (tx) => ({
      doc: () => ({ get: async () => ({ exists: true, data: () => ({ pnid: '111' }), get: () => undefined }) }),
      collection: () => ({ doc: () => ({ set: async (x) => { logs.push(x); } }) }),
      runTransaction: async () => tx,
    });
    const a = { to: '0501234567', tpl: { name: 't1' }, link: process.env.FUNCTIONS_EMULATOR === 'true' ? 'http://127.0.0.1/x.pdf' : 'https://x.invalid/x.pdf', by: 'u1', token: 't', now: 1 };
    await S.sendWa(mk(false), a);
    await S.sendWa(mk(true), Object.assign({}, a, { send: async () => { throw Object.assign(new Error('x'), { details: { reason: 'no-wa-token' } }); } }));
    await S.sendWa(mk(true), Object.assign({}, a, { send: async () => ({ wamid: 'w1' }) }));
    assert.deepEqual(logs.map((l) => [l.act, l.res, l.why || '']), [['outLimit', 'fail', 'limit'], ['sendFail', 'fail', 'no-wa-token'], ['arSend', 'ok', '']]);
    assert.ok(logs.every((l) => l.who === 'ar' && l.ch === 'wa'));
  });
});
