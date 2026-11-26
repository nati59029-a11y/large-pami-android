'use strict';
// מכשיר אחד למשתמש (16.11.2026, one-device.js): devClaim, registerPushToken עם s, והבדיקה ב-pushAct.
// חלק א' – בלי אמולטור: המתג (mode), kindOf, צורת הקלט.
// חלק ב' – מול אמולטור Firestore (חלק מ-test:multibiz:3): הפונקציות נקראות בתוך התהליך (exports.<שם>.run) – כמו קריאה מהאפליקציה,
//   בלי אמולטור הפונקציות. כך אפשר להחליף את המתג ONE_DEVICE (process.env) בין בדיקה לבדיקה.
const { describe, it, before, beforeEach, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

if (!process.env.MAX_PUSH_TOKENS) process.env.MAX_PUSH_TOKENS = '5'; // כמו functions/.env (הבדיקה רצה בתוך התהליך, בלי הקובץ)
const OD = require('../functions/one-device.js')._core;
const EMU = !!process.env.FIRESTORE_EMULATOR_HOST;

// ---------------------------------------------------------------------------------
describe('מכשיר אחד – בלי אמולטור', () => {
  afterEach(() => { delete process.env.ONE_DEVICE; });
  it('המתג: ריק / לא מוכר = on; log; off', () => {
    delete process.env.ONE_DEVICE; assert.equal(OD.mode(), 'on');
    process.env.ONE_DEVICE = 'log'; assert.equal(OD.mode(), 'log');
    process.env.ONE_DEVICE = ' OFF '; assert.equal(OD.mode(), 'off');
    process.env.ONE_DEVICE = 'maybe'; assert.equal(OD.mode(), 'on');
  });
  it('kindOf: רק רישום עם sh; sha = sha256 hex (כמו hashOf ב-push-act.js)', () => {
    const snap = (d) => ({ exists: !!d, get: (k) => (d || {})[k] });
    assert.equal(OD.kindOf(snap(null), 'phone'), null);
    assert.equal(OD.kindOf(snap({ phone: { fh: 'x' } }), 'phone'), null);
    assert.equal(OD.kindOf(snap({ phone: [1] }), 'phone'), null);
    assert.deepEqual(OD.kindOf(snap({ phone: { sh: 'a', fh: null } }), 'phone'), { sh: 'a', fh: null });
    assert.equal(OD.kindOf(snap({ phone: { sh: 'a' } }), 'web'), null);
    assert.equal(OD.sha('x'), require('../functions/push-act.js')._core.hashOf('x'));
    assert.ok(OD.S_RE.test('A'.repeat(43)) && !OD.S_RE.test('short') && !OD.S_RE.test('A'.repeat(20) + '<'));
  });
});

// ---------------------------------------------------------------------------------
describe('מכשיר אחד – מול האמולטור', { skip: !EMU && 'אמולטור Firestore לא רץ' }, () => {
  const A = 'biz-od';
  const M1 = 'od_m1', M2 = 'od_m2', E1 = 'od_e1', EOFF = 'od_off', SA = 'od_sa';
  const F = (u, n) => 'fcm' + u + '_' + (n || 'a') + '_'.repeat(25);
  const S1 = 's1_' + 'a'.repeat(40), S2 = 's2_' + 'b'.repeat(40), W1 = 'w1_' + 'c'.repeat(40), W2 = 'w2_' + 'd'.repeat(40);
  let env, IX, PA;
  const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
  async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
  // קריאה כמו מהאפליקציה: { result } או { code, reason }
  async function call(name, uid, data) {
    try { return { result: await IX[name].run({ auth: uid ? { uid, token: { uid } } : null, data: Object.assign({ bizId: A }, data), rawRequest: { headers: {} } }) }; }
    catch (e) { return { code: e.code, reason: e.details && e.details.reason, msg: e.message }; }
  }
  const claim = (uid, kind, s, extra) => call('devClaim', uid, Object.assign({ op: 'claim', kind, s }, extra));
  const check = (uid, kind, s) => call('devClaim', uid, { op: 'check', kind, s });
  const reg = (uid, token, s) => call('registerPushToken', uid, Object.assign({ token, act: 1 }, s === undefined ? {} : { s }));
  const toks = async (uid) => ((await get(`b/${A}/staff/${uid}`)) || {}).pushTokens;

  before(async () => {
    env = await H.getEnv(); IX = require('../functions/index.js'); PA = require('../functions/push-act.js')._core;
  });
  after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
  afterEach(() => { delete process.env.ONE_DEVICE; });
  beforeEach(async () => {
    await env.clearFirestore();
    const T0 = Date.now() - 60e3;
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { tasks: true, secretary: true } });
      b.set(d.doc(`b/${A}/admins/${M1}`), { email: 'm1@x.invalid' });
      b.set(d.doc(`b/${A}/staff/${M1}`), { name: 'מנהל', role: 'manager', active: true, pushTokens: [F(M1), F(M1, 'b')], pushAct: [F(M1)], pushActAt: { [PA.hashOf(F(M1))]: T0 } });
      b.set(d.doc(`b/${A}/admins/${M2}`), { email: 'm2@x.invalid' });
      b.set(d.doc(`b/${A}/push_tokens/${M2}`), { pushTokens: [F(M2), F(M2, 'b')] });
      b.set(d.doc(`b/${A}/staff/${E1}`), { name: 'e1', role: 'employee', active: true, pushTokens: [F(E1), F(E1, 'old')] });
      b.set(d.doc(`b/${A}/staff/${EOFF}`), { name: 'off', role: 'employee', active: false, pushTokens: [] });
      for (const [u, ts] of [[M1, [F(M1), F(M1, 'b')]], [M2, [F(M2), F(M2, 'b')]], [E1, [F(E1), F(E1, 'old')]]]) for (const t of ts) b.set(d.doc(PA.devPath(t)), { biz: A, uid: u, t: T0 });
      for (const [u, role] of [[M1, 'admin'], [M2, 'admin'], [E1, 'worker'], [EOFF, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
      b.set(d.doc('superadmins/' + SA), { email: 'sa@x.invalid' });
      await b.commit();
    });
  });

  // ---------- devClaim ----------
  it('claim טלפון: נרשם (רק הגיבוב), fh מתאפס, כל הטלפונים הקודמים יוצאים מההתראות (pushTokens / pushAct / push_dev); check', async () => {
    const r = await claim(M1, 'phone', S1);
    assert.deepEqual(r.result, { ok: true, cur: true, dropped: 2 });
    const c = await get('dev_cur/' + M1);
    assert.deepEqual(Object.keys(c), ['phone']);
    assert.equal(c.phone.sh, OD.sha(S1)); assert.equal(c.phone.fh, null); assert.equal(typeof c.phone.at, 'number');
    assert.ok(!JSON.stringify(c).includes(S1), 'מזהה הכניסה עצמו לא נשמר');
    const st = await get(`b/${A}/staff/${M1}`);
    assert.deepEqual(st.pushTokens, []); assert.deepEqual(st.pushAct, []);
    assert.equal(await get(PA.devPath(F(M1))), null); assert.equal(await get(PA.devPath(F(M1, 'b'))), null);
    assert.ok(await get(PA.devPath(F(E1))), 'משתמש אחר – לא נוגעים');
    assert.deepEqual((await check(M1, 'phone', S1)).result, { ok: true, cur: true });
    // טלפון חדש מחליף
    assert.deepEqual((await claim(M1, 'phone', S2)).result, { ok: true, cur: true, dropped: 0 });
    assert.deepEqual((await check(M1, 'phone', S1)).result, { ok: true, cur: false }, 'הטלפון הקודם – מנותק');
    assert.deepEqual((await check(M1, 'phone', S2)).result, { ok: true, cur: true });
    // claim רגיל חוזר עם אותו s (ניסיון חוזר) – cur: true, בלי כתיבה ובלי למחוק התראות
    await prep((d) => d.doc(`b/${A}/staff/${M1}`).update({ pushTokens: [F(M1, 'n')] }));
    assert.deepEqual((await claim(M1, 'phone', S2)).result, { ok: true, cur: true });
    assert.deepEqual(await toks(M1), [F(M1, 'n')], 'אותה כניסה – ההתראות נשארות');
  });
  it('טלפון ומחשב נפרדים: מחשב לא מנתק טלפון ולא נוגע בהתראות; מחשב חדש מנתק רק את המחשב הקודם', async () => {
    await claim(E1, 'phone', S1);
    await prep((d) => d.doc(`b/${A}/staff/${E1}`).update({ pushTokens: [F(E1)] }));
    assert.deepEqual((await claim(E1, 'web', W1)).result, { ok: true, cur: true });
    assert.deepEqual(await toks(E1), [F(E1)], 'מחשב – ההתראות לא משתנות');
    assert.equal((await check(E1, 'phone', S1)).result.cur, true);
    await claim(E1, 'web', W2);
    assert.equal((await check(E1, 'web', W1)).result.cur, false);
    assert.equal((await check(E1, 'web', W2)).result.cur, true);
    assert.equal((await check(E1, 'phone', S1)).result.cur, true, 'הטלפון נשאר');
    const c = await get('dev_cur/' + E1);
    assert.equal(c.phone.sh, OD.sha(S1)); assert.equal(c.web.sh, OD.sha(W2)); assert.equal(c.web.fh, undefined);
  });
  it('check בלי רישום – cur: true (none); אין כתיבה', async () => {
    assert.deepEqual((await check(E1, 'phone', S1)).result, { ok: true, cur: true, none: true });
    assert.deepEqual((await check(E1, 'web', W1)).result, { ok: true, cur: true, none: true });
    assert.equal(await get('dev_cur/' + E1), null);
  });
  it('legacy (כניסה מלפני העדכון): נרשמת רק אם אין רישום מהסוג; אותו s שוב – cur: true; s אחר – cur: false בלי לדרוס', async () => {
    assert.deepEqual((await claim(E1, 'phone', S1, { legacy: 1 })).result, { ok: true, cur: true, dropped: 2 });
    assert.deepEqual((await claim(E1, 'phone', S1, { legacy: 1 })).result, { ok: true, cur: true }, 'ניסיון חוזר אחרי תקלת רשת');
    assert.deepEqual((await claim(E1, 'phone', S2, { legacy: 1 })).result, { ok: true, cur: false });
    assert.equal((await get('dev_cur/' + E1)).phone.sh, OD.sha(S1), 'לא נדרס');
    assert.deepEqual((await claim(E1, 'web', W1, { legacy: true })).result, { ok: true, cur: true }, 'מחשב – סוג נפרד');
    // כניסה רגילה (לא legacy) תמיד מחליפה
    assert.equal((await claim(E1, 'phone', S2)).result.cur, true);
    assert.equal((await check(E1, 'phone', S1)).result.cur, false);
  });
  it('מנהל־העל – פטור: exempt, בלי רישום (גם בלי עסק וגם עם עסק שנבחר)', async () => {
    assert.deepEqual((await claim(SA, 'phone', S1)).result, { ok: true, cur: true, exempt: true });
    assert.deepEqual((await check(SA, 'web', 'bad')).result, { ok: true, cur: true, exempt: true }, 'גם קלט חלקי – לא נכשל');
    assert.equal(await get('dev_cur/' + SA), null);
    // מנהל עסק שהוא גם מנהל־על
    await prep((d) => d.doc('superadmins/' + M1).set({ email: 'm1@x.invalid' }));
    assert.equal((await claim(M1, 'phone', S1)).result.exempt, true);
    assert.deepEqual(await toks(M1), [F(M1), F(M1, 'b')], 'ההתראות לא משתנות');
  });
  it('קלט לא תקין / לא מחובר / עובד מושבת / עובד בעסק אחר', async () => {
    for (const d of [{ op: 'x', kind: 'phone', s: S1 }, { op: 'claim', kind: 'tv', s: S1 }, { op: 'claim', kind: 'phone', s: 'short' }, { op: 'check', kind: 'web', s: 5 }, { op: 'claim', kind: 'phone' }, { op: 'claim', kind: 'phone', s: S1 + '<>' }]) {
      const r = await call('devClaim', E1, d);
      assert.equal(r.code, 'invalid-argument', JSON.stringify(d)); assert.equal(r.reason, 'bad-input');
    }
    assert.equal((await call('devClaim', null, { op: 'check', kind: 'phone', s: S1 })).code, 'unauthenticated');
    const off = await claim(EOFF, 'phone', S1);
    assert.equal(off.code, 'permission-denied'); assert.equal(off.reason, 'staff-disabled');
    assert.equal((await call('devClaim', E1, { op: 'check', kind: 'phone', s: S1, bizId: 'biz-other' })).code, 'permission-denied');
    assert.equal(await get('dev_cur/' + E1), null);
    assert.equal(await get('dev_cur/' + EOFF), null);
  });
  it('מתג ONE_DEVICE: off – כמו לפני התכונה (בלי כתיבה); log – אף אחד לא מנותק וההתראות לא נמחקות', async () => {
    process.env.ONE_DEVICE = 'off';
    assert.deepEqual((await claim(E1, 'phone', S1)).result, { ok: true, cur: true, off: true });
    assert.equal(await get('dev_cur/' + E1), null);
    assert.deepEqual(await toks(E1), [F(E1), F(E1, 'old')]);
    process.env.ONE_DEVICE = 'log';
    assert.deepEqual((await claim(E1, 'phone', S1)).result, { ok: true, cur: true });
    assert.deepEqual(await toks(E1), [F(E1), F(E1, 'old')], 'log – לא נוגעים בהתראות');
    assert.deepEqual((await check(E1, 'phone', S2)).result, { ok: true, cur: true, log: true });
    assert.deepEqual((await claim(E1, 'phone', S2, { legacy: 1 })).result, { ok: true, cur: true, log: true });
    assert.equal((await reg(E1, F(E1, 'old'))).result.ok, true, 'log – רישום בלי s מטלפון לא נוכחי עובר');
    // off: גם רישום בלי s מטלפון לא נוכחי – כמו קודם
    process.env.ONE_DEVICE = 'off';
    assert.equal((await check(E1, 'phone', S2)).result.cur, true);
    assert.equal((await reg(E1, F(E1, 'old'))).result.ok, true);
    delete process.env.ONE_DEVICE;
    assert.equal((await check(E1, 'phone', S2)).result.cur, false, 'on – הרישום מ-log נשמר ופועל');
  });
  it('ONE_DEVICE=log: registerPushToken עם s של הטלפון הנוכחי – לא מוחק את שאר הטלפונים (on – כן)', async () => {
    process.env.ONE_DEVICE = 'log';
    await claim(E1, 'phone', S1); // log – הרישום נשמר, ההתראות לא נמחקות
    const r = await reg(E1, F(E1, 'new'), S1);
    assert.equal(r.result.ok, true); assert.equal(r.result.removed, 0);
    assert.deepEqual(await toks(E1), [F(E1), F(E1, 'old'), F(E1, 'new')], 'log – הטלפונים האחרים נשארים');
    assert.ok(await get(PA.devPath(F(E1, 'old'))), 'log – push_dev של טלפון אחר נשאר');
    delete process.env.ONE_DEVICE;
    assert.equal((await reg(E1, F(E1, 'new'), S1)).result.ok, true);
    assert.deepEqual(await toks(E1), [F(E1, 'new')], 'on – רק הטלפון הנוכחי');
    assert.equal(await get(PA.devPath(F(E1, 'old'))), null);
  });

  // ---------- registerPushToken ----------
  it('registerPushToken בלי רישום טלפון (APK/מסכים ישנים, משתמש שעוד לא נכנס מחדש) – בדיוק כמו קודם', async () => {
    const r = await reg(E1, F(E1, 'new'));
    assert.deepEqual(r.result, { ok: true, count: 3, removed: 0, moved: 0 });
    assert.deepEqual(await toks(E1), [F(E1), F(E1, 'old'), F(E1, 'new')]);
    assert.equal((await reg(E1, F(E1, 'x'), S1)).result.ok, true, 's בלי רישום – כמו קודם');
    assert.equal(await get('dev_cur/' + E1), null, 'בלי רישום חדש');
  });
  it('24.11.2026 אישור קבלה: rcv:1 עם act:1 – pushRcvAt (tokensRcv); act:1 בלי rcv – נמחק; בלי act – לא משתנה; rcv בלי act – לא נשמר', async () => {
    const RM = require('../functions/secretary-remind.js')._core;
    const T = require('../functions/lib/tenant.js');
    const h = PA.hashOf(F(E1));
    const rcvAt = async () => ((await get(`b/${A}/staff/${E1}`)) || {}).pushRcvAt;
    const tr = () => T.runInBiz({ bizId: A, prefix: 'b/' + A + '/' }, () => RM.tokensRcv(T.tdb(), E1));
    // רישום ישן בלי rcv (APK עם כפתורים בלבד) – אין pushRcvAt, ולא נוסף שדה
    assert.equal((await call('registerPushToken', E1, { token: F(E1), act: 1 })).result.ok, true);
    assert.equal(await rcvAt(), undefined, 'בלי rcv – לא נוסף שדה');
    assert.deepEqual(await tr(), []);
    // APK חדש: rcv:1
    assert.equal((await call('registerPushToken', E1, { token: F(E1), act: 1, rcv: 1 })).result.ok, true);
    const m = await rcvAt();
    assert.deepEqual(Object.keys(m), [h]);
    assert.equal(m[h], ((await get(`b/${A}/staff/${E1}`)).pushActAt || {})[h], 'באותו זמן כמו pushActAt');
    assert.deepEqual(await tr(), [F(E1)]);
    // מסכים ישנים / orders/api.js – בלי act: לא משתנה (אבל pushPlainAt עוצר את הכפתורים, ולכן גם את האישור)
    assert.equal((await call('registerPushToken', E1, { token: F(E1) })).result.ok, true);
    assert.deepEqual(Object.keys(await rcvAt()), [h]);
    assert.deepEqual(await tr(), [], 'רישום בלי act אחרי – בלי כפתורים ובלי אישור קבלה');
    // חזרה ל-APK עם כפתורים בלבד (act:1 בלי rcv) – נמחק
    await call('registerPushToken', E1, { token: F(E1), act: 1, rcv: 1 });
    assert.deepEqual(await tr(), [F(E1)]);
    await call('registerPushToken', E1, { token: F(E1), act: 1 });
    assert.deepEqual(await rcvAt(), {}, 'act:1 בלי rcv – נמחק');
    assert.deepEqual(await tr(), []);
    // rcv בלי act – לא נחשב (רק יחד עם act); act:0 – נמחק
    await call('registerPushToken', E1, { token: F(E1), rcv: 1 });
    assert.deepEqual(await rcvAt(), {});
    await call('registerPushToken', E1, { token: F(E1), act: 1, rcv: 1 });
    await call('registerPushToken', E1, { token: F(E1), act: 0, rcv: 1 });
    assert.deepEqual(await rcvAt(), {}, 'act:0 – נמחק');
    assert.deepEqual(await tr(), []);
    // קיצוץ: טלפון שיצא מ-pushTokens יוצא גם מ-pushRcvAt
    await call('registerPushToken', E1, { token: F(E1), act: 1, rcv: 1 });
    for (const n of ['x1', 'x2', 'x3', 'x4', 'x5']) await call('registerPushToken', E1, { token: F(E1, n), act: 1 });
    assert.ok(!(await toks(E1)).includes(F(E1)));
    assert.deepEqual(await rcvAt(), {}, 'טלפון שיצא – נמחק מהמפה');
  });
  it('registerPushToken עם s של הטלפון הנוכחי: רק הוא נשאר רשום, fh נכתב; בלי s – רק מהטלפון הנוכחי; s שגוי / טלפון אחר – not-current בלי כתיבה', async () => {
    await claim(E1, 'phone', S1);
    // טלפון ישן שעוד רשום (נוסף ידנית אחרי התפיסה – למשל רישום שהיה באמצע)
    await prep((d) => d.doc(`b/${A}/staff/${E1}`).update({ pushTokens: [F(E1, 'old')] }));
    await prep((d) => d.doc(PA.devPath(F(E1, 'old'))).set({ biz: A, uid: E1, t: 1 }));
    const r = await reg(E1, F(E1, 'new'), S1);
    assert.deepEqual(r.result, { ok: true, count: 1, removed: 1, moved: 0 });
    const st = await get(`b/${A}/staff/${E1}`);
    assert.deepEqual(st.pushTokens, [F(E1, 'new')]); assert.deepEqual(st.pushAct, [F(E1, 'new')]);
    assert.deepEqual(Object.keys(st.pushActAt), [PA.hashOf(F(E1, 'new'))]);
    assert.equal((await get('dev_cur/' + E1)).phone.fh, OD.sha(F(E1, 'new')));
    assert.equal(await get(PA.devPath(F(E1, 'old'))), null, 'השיוך של הטלפון הישן נמחק');
    assert.equal((await get(PA.devPath(F(E1, 'new')))).uid, E1);
    // בלי s (orders/api.js) מהטלפון הנוכחי – עובר
    assert.equal((await reg(E1, F(E1, 'new'))).result.ok, true);
    // בלי s מטלפון אחר / s שגוי – נדחה, בלי כתיבה
    assert.deepEqual((await reg(E1, F(E1, 'old'))).result, { ok: false, reason: 'not-current' });
    assert.deepEqual((await reg(E1, F(E1, 'old'), S2)).result, { ok: false, reason: 'not-current' });
    assert.deepEqual((await reg(E1, F(E1, 'old'), 7)).result, { ok: false, reason: 'not-current' });
    assert.deepEqual(await toks(E1), [F(E1, 'new')]);
    assert.equal(await get(PA.devPath(F(E1, 'old'))), null);
    // טלפון חדש נכנס: fh מתאפס – הטלפון הקודם כבר לא נרשם גם בלי s
    await claim(E1, 'phone', S2);
    assert.equal((await get('dev_cur/' + E1)).phone.fh, null);
    assert.deepEqual(await toks(E1), [], 'התפיסה הוציאה את הטלפון הקודם');
    assert.deepEqual((await reg(E1, F(E1, 'new'))).result, { ok: false, reason: 'not-current' });
    assert.deepEqual((await reg(E1, F(E1, 'new'), S1)).result, { ok: false, reason: 'not-current' });
    assert.equal((await reg(E1, F(E1, 'p2'), S2)).result.ok, true);
    assert.deepEqual(await toks(E1), [F(E1, 'p2')]);
  });
  it('registerPushToken: מנהל בלי staff (push_tokens) – אותו כלל; טלפונים שנשארו במסמך השני של המשתמש – יוצאים', async () => {
    await claim(M2, 'phone', S1);
    assert.deepEqual((await get(`b/${A}/push_tokens/${M2}`)).pushTokens, []);
    assert.equal((await reg(M2, F(M2, 'n'), S1)).result.ok, true);
    assert.deepEqual((await get(`b/${A}/push_tokens/${M2}`)).pushTokens, [F(M2, 'n')]);
    assert.deepEqual((await reg(M2, F(M2))).result, { ok: false, reason: 'not-current' });
    // M1: גם staff וגם push_tokens (נשאר ממצב קודם)
    await claim(M1, 'phone', S1);
    await prep((d) => d.doc(`b/${A}/push_tokens/${M1}`).set({ pushTokens: [F(M1, 'z')] }));
    await prep((d) => d.doc(`b/${A}/staff/${M1}`).update({ pushTokens: [F(M1, 'y')] }));
    assert.equal((await reg(M1, F(M1, 'n'), S1)).result.ok, true);
    assert.deepEqual(await toks(M1), [F(M1, 'n')]);
    assert.deepEqual((await get(`b/${A}/push_tokens/${M1}`)).pushTokens, []);
  });
  it('registerPushToken של מנהל־על (גם מנהל העסק) עם רישום טלפון ישן – כמו קודם (פטור)', async () => {
    await claim(M1, 'phone', S1);
    await prep((d) => d.doc('superadmins/' + M1).set({ email: 'm1@x.invalid' }));
    assert.equal((await reg(M1, F(M1, 'q'))).result.ok, true);
    assert.deepEqual(await toks(M1), [F(M1, 'q')]);
  });

  // ---------- pushAct ----------
  it('phoneOk (pushAct): אין רישום – מותר; fh = הטלפון – מותר; טלפון אחר / fh ריק – נחסם; log / off / מנהל־על – מותר', async () => {
    assert.equal(await OD.phoneOk(E1, F(E1)), true, 'בלי רישום – כמו קודם');
    await claim(E1, 'phone', S1);
    assert.equal(await OD.phoneOk(E1, F(E1)), false, 'fh ריק (עוד לא נרשם עם s)');
    await reg(E1, F(E1, 'n'), S1);
    assert.equal(await OD.phoneOk(E1, F(E1, 'n')), true);
    assert.equal(await OD.phoneOk(E1, F(E1)), false);
    process.env.ONE_DEVICE = 'log'; assert.equal(await OD.phoneOk(E1, F(E1)), true);
    process.env.ONE_DEVICE = 'off'; assert.equal(await OD.phoneOk(E1, F(E1)), true);
    delete process.env.ONE_DEVICE;
    await prep((d) => d.doc('superadmins/' + E1).set({ email: 'e1@x.invalid' }));
    assert.equal(await OD.phoneOk(E1, F(E1)), true);
  });
  it('dev_cur סגור לאפליקציה (הכלל האחרון בחוקים)', async () => {
    const { assertFails } = require('@firebase/rules-unit-testing');
    await claim(E1, 'phone', S1);
    const c = env.authenticatedContext(E1, { email: E1 + '@x.invalid' }).firestore();
    await assertFails(c.doc('dev_cur/' + E1).get());
    await assertFails(c.doc('dev_cur/' + E1).set({ phone: { sh: 'x', fh: null, at: 1 } }));
    await assertFails(c.collection('dev_cur').get());
  });
});
