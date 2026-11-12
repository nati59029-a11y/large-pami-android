'use strict';
// המזכירה העסקית – שלב 4 (2026-11-11): התראות (registerPushToken גם למנהל), תזכורות (7.3, 7.4, 74–77), התראה על עובד (61), דוחות (55, 66–69),
// secDaily – שמירה ומחיקה (9.5), מחיקה יזומה באישור כפול (93), ניתוק לא מוחק (95). מול האמולטור, חלק מ-test:multibiz.
// הפונקציות המתוזמנות לא רצות באמולטור – הליבה שלהן (runRemind, runSecDaily) נקראת כאן ישירות, עם זמן קבוע ושליחה מדומה (אין FCM אמיתי).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-r', B = 'biz-s';
const M1 = 'r_m1', M2 = 'r_m2', M3 = 'r_m3', E1 = 'r_e1', SUPER = 'r_super', MB = 'r_mb';
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
let env, SEC, RM, R, T;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
// זמן בשעון ישראל (נובמבר–דצמבר 2026: UTC+2)
const IL = (s) => Date.parse(s + ':00+02:00');
const ALL_RT = { invDue: true, invLate: true, chk: true, task: true, close: true, backup: true, fact: true, cal: true, emp: true };
const closingData = (drawer, oTot) => JSON.stringify({ v: 1, f: { drawer: String(drawer), oTot: String(oTot) }, rs: 'manual' });
const finOf = (o) => JSON.stringify(Object.assign({ v: 1, at: IL('2026-11-11T20:00'), months: {}, open: [], sups: [], crs: [], late: { sum: 0, gross: 0, n: 0 }, chk: [] }, o));

async function seed(o) {
  const opt = Object.assign({ cfg: {}, featA: true, featB: false, nt: {}, consent: [M1, M2, M3] }, o);
  await env.clearFirestore();
  const ver = SEC.CONSENT_VER;
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true, secretary: opt.featA } });
    b.set(d.doc('b/' + B), { name: B, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true, secretary: opt.featB } });
    b.set(d.doc(`b/${A}/admins/${M1}`), { email: 'm1@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${M1}`), { name: 'מנהל 1', role: 'manager', active: true, pushTokens: ['tokM1_' + 'a'.repeat(30)] });
    b.set(d.doc(`b/${A}/admins/${M2}`), { email: 'm2@x.invalid' }); // מנהל בלי רשומת עובד
    b.set(d.doc(`b/${A}/admins/${M3}`), { email: 'm3@x.invalid', br: ['br1'] }); // מנהל עם הגבלת סניפים
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: 'דוד כהן', role: 'employee', active: true });
    b.set(d.doc(`b/${B}/admins/${MB}`), { email: 'mb@x.invalid' });
    for (const [u, biz, role] of [[M1, A, 'admin'], [M2, A, 'admin'], [M3, A, 'admin'], [E1, A, 'worker'], [MB, B, 'admin']]) b.set(d.doc('users/' + u), { bizId: biz, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    const mgr = {}; for (const u of opt.consent) mgr[u] = { cv: ver, ca: 1, nm: 'רותי', ad: 'f', nt: opt.nt[u] || {} };
    b.set(d.doc(`b/${A}/sec_cfg/main`), Object.assign({ mode: 'all', mainUid: '', emp: true, pay: { [M1]: true }, mgr }, opt.cfg));
    b.set(d.doc(`b/${B}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: true, pay: {}, mgr: { [MB]: { cv: ver, ca: 1 } } });
    await b.commit();
  });
}
let BIZA;
const PUSH = [];
const send = async (tokens, msg, meta) => { PUSH.push({ tokens, msg, meta }); return tokens.map((t) => ({ token: t, ok: true })); };
const run = (iso, extra) => RM.runRemind(Object.assign({ now: IL(iso), bizzes: [BIZA], send }, extra || {}));
const notes = (u) => coll(`b/${A}/sec_note/${u}/n`);
const byKey = (L, re) => L.filter((x) => re.test(x.key));

before(async () => {
  env = await H.getEnv(); require('../functions/index.js');
  SEC = require('../functions/secretary.js')._core; RM = require('../functions/secretary-remind.js')._core;
  R = require('../functions/lib/sec-remind.js'); T = require('../functions/lib/tenant.js');
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
async function bizA() { BIZA = await T.loadBiz(A); return BIZA; }

// ---------------------------------------------------------------------------------
describe('אבטחה: פונקציות שלב 4 – אותו שער כמו בשלבים 1–3', () => {
  const FNS = { secNotes: { op: 'list' }, secReports: { op: 'list' }, secHistory: { op: 'ask' } };
  it('עובד, לא מחובר, מנהל של עסק אחר, לפני הסכמה, מנהל־על שאינו מנהל העסק, "מנהל ראשי בלבד", תוספת כבויה – נחסמים', async () => {
    await seed({ consent: [M1] });
    for (const [fn, data] of Object.entries(FNS)) {
      assert.equal((await call(fn, M1, data)).status, 'OK', fn);
      assert.equal((await call(fn, E1, data)).status, 'PERMISSION_DENIED', fn + ' עובד');
      assert.equal((await call(fn, null, data)).status, 'UNAUTHENTICATED', fn + ' לא מחובר');
      assert.equal((await call(fn, MB, Object.assign({ bizId: A }, data))).status, 'PERMISSION_DENIED', fn + ' עסק אחר');
      assert.equal((await call(fn, M2, data)).reason, 'no-consent', fn + ' לפני הסכמה');
      assert.equal((await call(fn, SUPER, Object.assign({ bizId: A }, data))).reason, 'not-biz-admin', fn + ' מנהל־על');
    }
    await seed({ cfg: { mode: 'main', mainUid: M1 } });
    for (const [fn, data] of Object.entries(FNS)) assert.equal((await call(fn, M2, data)).reason, 'not-main-manager', fn);
    await seed({ featA: false });
    for (const [fn, data] of Object.entries(FNS)) assert.equal((await call(fn, M1, data)).reason, 'feature-off', fn);
  });
  it('חוקים: אין קריאה ישירה של התראות (sec_note) לאף אחד; דוח (sec_rep) – רק של המנהל עצמו', async () => {
    await seed();
    await prep(async (d) => { await d.doc(`b/${A}/sec_note/${M1}/n/x`).set({ t: 1 }); await d.doc(`b/${A}/sec_rep/w_${M1}_k`).set({ uid: M1, t: 1 }); });
    for (const u of [M1, M2, SUPER]) await assertFails(db(u).doc(`b/${A}/sec_note/${M1}/n/x`).get());
    await assertSucceeds(db(M1).doc(`b/${A}/sec_rep/w_${M1}_k`).get());
    await assertFails(db(M2).doc(`b/${A}/sec_rep/w_${M1}_k`).get());
    await assertFails(db(M1).doc(`b/${A}/sec_rep/w_${M1}_k`).set({ uid: M1, t: 2 }));
  });
});

// ---------------------------------------------------------------------------------
describe('רישום התראות: מנהל בלי רשומת עובד נרשם; עובד ממשיך כמו היום', () => {
  const tok = (n) => 'tok' + n + '_' + 'x'.repeat(30);
  it('מנהל בלי staff – push_tokens/{uid} (בלי ליצור staff); עובד ומנהל עם staff – staff/{uid}.pushTokens כמו קודם; מנהל־על שאינו מנהל – נדחה כמו קודם', async () => {
    await seed();
    const r = await call('registerPushToken', M2, { token: tok(1) });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual((await get(`b/${A}/push_tokens/${M2}`)).pushTokens, [tok(1)]);
    assert.equal(await get(`b/${A}/staff/${M2}`), null, 'לא נוצרה רשומת עובד');
    for (let i = 2; i <= 7; i++) await call('registerPushToken', M2, { token: tok(i) });
    assert.deepEqual((await get(`b/${A}/push_tokens/${M2}`)).pushTokens, [tok(3), tok(4), tok(5), tok(6), tok(7)], 'מגבלת 5 טלפונים גם למנהל');
    assert.equal((await call('registerPushToken', E1, { token: tok(8) })).status, 'OK');
    const e = await get(`b/${A}/staff/${E1}`);
    assert.deepEqual(e.pushTokens, [tok(8)]); assert.equal(e.name, 'דוד כהן');
    assert.equal(await get(`b/${A}/push_tokens/${E1}`), null);
    assert.equal((await call('registerPushToken', M1, { token: tok(9) })).status, 'OK');
    assert.deepEqual((await get(`b/${A}/staff/${M1}`)).pushTokens, ['tokM1_' + 'a'.repeat(30), tok(9)]);
    assert.equal((await call('registerPushToken', SUPER, { bizId: A, token: tok(1) })).reason, 'no-staff-doc');
    // השרת שולח לשני המקורות
    await bizA();
    const toks = await T.runInBiz({ bizId: A, prefix: `b/${A}/`, biz: BIZA }, () => RM.tokensOf(T.tdb(), M2));
    assert.equal(toks.length, 5, 'השרת שולח גם לטלפונים של מנהל בלי רשומת עובד');
    await assertFails(db(M2).doc(`b/${A}/push_tokens/${M2}`).get()); // אין קריאה ישירה מהאפליקציה
  });
  it('12.11.2026: טלפון אחד = משתמש אחד – עובד שנרשם בטלפון של מנהל מוציא אותו מהמנהל (עובד לא מקבל התראות של מנהל), וההפך', async () => {
    await seed();
    assert.equal((await call('registerPushToken', M2, { token: tok(1) })).status, 'OK');
    assert.equal((await call('registerPushToken', M1, { token: tok(2) })).status, 'OK');
    const r = await call('registerPushToken', E1, { token: tok(1) });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual((await get(`b/${A}/push_tokens/${M2}`)).pushTokens, [], 'הטלפון יצא מהמנהל בלי רשומת עובד');
    assert.deepEqual((await get(`b/${A}/staff/${E1}`)).pushTokens, [tok(1)]);
    await call('registerPushToken', E1, { token: tok(2) });
    assert.deepEqual((await get(`b/${A}/staff/${M1}`)).pushTokens, ['tokM1_' + 'a'.repeat(30)], 'הטלפון יצא גם ממנהל עם רשומת עובד; הטלפון האחר שלו נשאר');
    assert.equal((await call('registerPushToken', M2, { token: tok(1) })).status, 'OK');
    assert.deepEqual((await get(`b/${A}/staff/${E1}`)).pushTokens, [tok(2)], 'מנהל שנכנס שוב – הטלפון חוזר אליו ויוצא מהעובד');
    assert.deepEqual((await get(`b/${A}/push_tokens/${M2}`)).pushTokens, [tok(1)]);
    // רישום חוזר של אותו משתמש – בלי שינוי אצל אחרים
    assert.equal((await call('registerPushToken', M2, { token: tok(1) })).status, 'OK');
    assert.deepEqual((await get(`b/${A}/push_tokens/${M2}`)).pushTokens, [tok(1)]);
  });
});

// ---------------------------------------------------------------------------------
describe('תזכורות (7.3, 7.4, 74–77)', () => {
  it('תזכורת שנפלה בשבת יוצאת בראשון בבוקר (חשבונית לתשלום, ותזכורת יומן בלי "להשאיר"); בשבת – כלום', async () => {
    await seed();
    await bizA();
    await prep(async (d) => {
      await d.doc(`b/${A}/sec_mirror/fin`).set({ v: 1, data: finOf({ open: [['ספק החלב', '501', '2026-11-01', '2026-11-14', 1200, 1200]] }), at: IL('2026-11-11T20:00') });
      await d.doc(`b/${A}/push_tokens/${M2}`).set({ pushTokens: ['tokM2_' + 'b'.repeat(30)] });
      await d.doc(`b/${A}/sec_cal/c1`).set({ uid: M1, st: 'ok', title: 'להתקשר לרואה החשבון', d: '2026-11-14', tm: '11:00', rem: true, t: 1 });
      await d.doc(`b/${A}/sec_cal/c2`).set({ uid: M1, st: 'ok', title: 'תזכורת שהמנהל השאיר בשבת', d: '2026-11-14', tm: '11:00', rem: true, keepOff: true, t: 1 });
    });
    PUSH.length = 0;
    await run('2026-11-14T10:00');
    await run('2026-11-14T13:00');
    let L = await notes(M1);
    assert.equal(byKey(L, /^invDue/).length, 0, 'שבת: אין תזכורת חשבונית');
    assert.equal(byKey(L, /^cal:c1:/).length, 0, 'שבת: תזכורת שלא "הושארה" – לא יוצאת');
    assert.equal(byKey(L, /^cal:c2:/).length, 1, 'תזכורת שהמנהל בחר להשאיר בשבת (75) – בזמנה');
    await run('2026-11-15T07:30');
    assert.equal(byKey(await notes(M1), /^invDue/).length, 0, 'ראשון לפני 08:00 – עדיין לא');
    PUSH.length = 0;
    await run('2026-11-15T08:05');
    L = await notes(M1);
    const inv = byKey(L, /^invDue:due:/);
    assert.equal(inv.length, 1, 'ראשון בבוקר – יוצאת'); assert.equal(inv[0].at, IL('2026-11-15T08:05'));
    assert.match(inv[0].body, /ספק החלב/); assert.match(inv[0].body, /1,200/);
    assert.equal(inv[0].pend, false); assert.equal(inv[0].pushed, IL('2026-11-15T08:05'));
    const c1 = byKey(L, /^cal:c1:/); assert.equal(c1.length, 1); assert.match(c1[0].body, /הועבר לבוקר יום העסקים הבא/);
    assert.equal(byKey(await notes(M2), /^invDue:due:/).length, 1, 'גם למנהל בלי רשומת עובד');
    const p2 = PUSH.find((p) => p.meta.uid === M2);
    assert.ok(p2 && p2.tokens[0].startsWith('tokM2_'), 'התראה נשלחה לטלפון של מנהל בלי רשומת עובד');
    assert.ok(PUSH.every((p) => !/ספק|1,200|1200|רואה החשבון/.test(p.msg.title + p.msg.body)), 'תוכן ההתראה כללי – בלי שמות וסכומים');
    assert.equal(byKey(await notes(M3), /^invDue/).length, 0, 'מנהל עם הגבלת סניפים – בלי תזכורות על נתוני כל העסק');
  });

  it('כל תזכורת בטבלה 7.3 שהמקור שלה קיים: מראה (חשבונית, צ\'ק), tasks, closings, app_backup_status, sec_facts, sec_cal; ברירת מחדל = קבוצת הליבה (77)', async () => {
    await seed({ nt: { [M1]: { rt: ALL_RT } } });
    await bizA();
    const now = IL('2026-11-12T08:30'); // חמישי
    await prep(async (d) => {
      await d.doc(`b/${A}/sec_mirror/fin`).set({ v: 1, data: finOf({ open: [['ספק הקמח', '77', '2026-11-01', '2026-11-15', 500, 450]], chk: [['2026-11-16', 'בעל הבית', -8000]] }), at: now - 3600e3 });
      await d.doc(`b/${A}/tasks/t1`).set({ txt: 'לנקות את המקרר', st: 'open', due: now - 864e5, cr: now - 3 * 864e5, ow: E1 });
      await d.doc(`b/${A}/tasks/t2`).set({ txt: 'משימה בזמן', st: 'open', due: now + 864e5, cr: now - 864e5, ow: E1 });
      await d.doc(`b/${A}/closings/z1`).set({ uid: M1, by: 'מנהל 1', t: now - 30 * 3600e3, reg: 'i_yh', d: '2026-11-11', st: 'ok', data: closingData(1500, 1380) });
      await d.doc(`b/${A}/closings/z2`).set({ uid: M1, by: 'מנהל 1', t: now - 4 * 864e5, reg: 'i_nl', d: '2026-11-08', st: 'ok', data: closingData(900, 900) });
      await d.doc(`b/${A}/app_backup_status/${M1}`).set({ lastBackupAt: '2026-11-05T10:00:00.000Z', size: 10, device: 'Galaxy' });
      await d.doc(`b/${A}/app_backup_status/${M2}`).set({ lastBackupAt: new Date(now - 3600e3).toISOString(), size: 10, device: 'Pixel' });
      await d.doc(`b/${A}/sec_facts/f1`).set({ topic: 'general', text: 'מבצע חנוכה 1+1', st: 'ok', exp: '2026-11-12', t: 1 });
      await d.doc(`b/${A}/sec_facts/f2`).set({ topic: 'general', text: 'עובדה בתוקף', st: 'ok', exp: '2026-12-30', t: 1 });
      await d.doc(`b/${A}/sec_cal/e1`).set({ uid: '', st: 'ok', title: 'ספירת מלאי', d: '2026-11-12', tm: '10:00', t: 1 });
    });
    await RM.runRemind({ now, bizzes: [BIZA], send });
    let L = await notes(M1);
    const has = (re, label) => assert.equal(byKey(L, re).length, 1, label + ': ' + JSON.stringify(L.map((x) => x.key)));
    has(/^invDue:pre:/, 'חשבונית לתשלום – יום עסקים לפני המועד (המועד בראשון → חמישי)');
    has(/^chk:/, 'צ\'ק – 2 ימי עסקים לפני (שני → חמישי)');
    has(/^task:/, 'משימה שעברה את הזמן (מקובץ)');
    assert.match(byKey(L, /^task:/)[0].body, /לנקות את המקרר/); assert.doesNotMatch(byKey(L, /^task:/)[0].body, /משימה בזמן/);
    has(/^close:2026-11-11$/, 'סגירת קופה חסרה או עם הפרש – למחרת');
    const cl = byKey(L, /^close:/)[0].body; assert.match(cl, /i_nl: לא נשלחה סגירה/); assert.match(cl, /i_yh: הפרש מזומן 120/);
    has(/^backup:/, 'גיבוי ישן מ-3 ימים'); assert.match(byKey(L, /^backup:/)[0].body, /Galaxy/);
    has(/^fact:f1:/, 'עובדה שפגה – ביום התפוגה'); assert.equal(byKey(L, /^fact:f2/).length, 0);
    assert.equal(byKey(L, /^cal:e1/).length, 0, 'אירוע ב-10:00 – התזכורת שעה לפני, עוד לא');
    await RM.runRemind({ now: IL('2026-11-12T09:05'), bizzes: [BIZA], send });
    L = await notes(M1);
    has(/^cal:e1:/, 'sec_cal – אירוע של העסק, שעה לפני');
    // מנהל עם ברירת המחדל (77): רק קבוצת הליבה
    const L2 = await notes(M2);
    assert.equal(byKey(L2, /^invDue:pre:/).length, 1); assert.equal(byKey(L2, /^chk:/).length, 1); assert.equal(byKey(L2, /^cal:e1:/).length, 1);
    for (const re of [/^task:/, /^close:/, /^backup:/, /^fact:/]) assert.equal(byKey(L2, re).length, 0, 'כבוי כברירת מחדל: ' + re);
    // ריצה חוזרת באותו יום – בלי כפילויות
    const n0 = L.length;
    await RM.runRemind({ now: IL('2026-11-12T10:00'), bizzes: [BIZA], send });
    assert.equal((await notes(M1)).length, n0);
    // חשבונית ששולמה (נעלמה מהמראה) – התזכורת נסגרת ולא חוזרת
    await prep((d) => d.doc(`b/${A}/sec_mirror/fin`).set({ v: 1, data: finOf({ open: [], chk: [['2026-11-16', 'בעל הבית', -8000]] }), at: now }));
    await RM.runRemind({ now: IL('2026-11-15T08:10'), bizzes: [BIZA], send });
    assert.equal(byKey(await notes(M1), /^invDue:pre:/)[0].st, 'gone');
  });

  it('חזרה עד 3 פעמים (76), פעם ביום עסקים; בתוך תזכורת: שינוי מספר החזרות, ביטול ו"טופל"; שעות שקטות (74) – ההתראה מחכה לסופן', async () => {
    await seed({ nt: { [M1]: { rt: ALL_RT, q: { on: true, f: '22:00', t: '07:00' } } } });
    await bizA();
    await prep(async (d) => {
      await d.doc(`b/${A}/closings/z1`).set({ uid: M1, by: 'מנהל 1', t: IL('2026-11-11T21:00'), reg: 'i_yh', d: '2026-11-11', st: 'ok', data: closingData(1500, 1380) });
      await d.doc(`b/${A}/sec_mirror/fin`).set({ v: 1, data: finOf({ chk: [['2026-11-16', 'בעל הבית', -8000]] }), at: IL('2026-11-11T20:00') });
    });
    await run('2026-11-12T08:30');
    const close0 = byKey(await notes(M1), /^close:2026-11-11$/)[0];
    assert.equal(close0.rep, 3); assert.equal(close0.n, 1); assert.equal(close0.nextAt, IL('2026-11-15T08:00'), 'החזרה הבאה – יום העסקים הבא (ראשון) בבוקר');
    await run('2026-11-13T09:00'); // שישי – אין חזרות
    assert.equal(byKey(await notes(M1), /^close:2026-11-11$/)[0].n, 1);
    const reps = [];
    for (const day of ['15', '16', '17', '18', '19']) { await run(`2026-11-${day}T08:10`); const x = byKey(await notes(M1), /^close:2026-11-11$/)[0]; reps.push([x.n, x.rep]); }
    assert.deepEqual(reps, [[2, 2], [3, 1], [4, 0], [4, 0], [4, 0]], 'שליחה ראשונה + 3 חזרות, ואז נעצרת');
    // בתוך התזכורת: חזרה אחת בלבד, ואז "טופל"
    const chk = byKey(await notes(M1), /^chk:/)[0];
    assert.equal((await call('secNotes', M1, { op: 'reps', id: chk.id, n: 0 })).status, 'OK');
    assert.equal((await call('secNotes', M1, { op: 'reps', id: chk.id, n: 4 })).reason, 'bad-reps');
    let x = (await notes(M1)).find((y) => y.id === chk.id);
    assert.equal(x.rep, 0); assert.equal(x.nextAt, undefined, 'ביטול חזרות');
    assert.equal((await call('secNotes', M1, { op: 'done', id: chk.id })).status, 'OK');
    x = (await notes(M1)).find((y) => y.id === chk.id); assert.equal(x.st, 'done');
    assert.ok((await coll(`b/${A}/sec_log`)).some((l) => l.act === 'remReps') && (await coll(`b/${A}/sec_log`)).some((l) => l.act === 'remDone'));
    // שעות שקטות: המנהל קובע 07:00–09:00 (בדיקה), תזכורת שנוצרת ב-08:30 נשלחת ב-09:00
    assert.equal((await call('secPrefs', M1, { op: 'notify', nt: { q: { on: true, f: '07:00', t: '09:00' } } })).status, 'OK');
    await prep((d) => d.doc(`b/${A}/sec_facts/f9`).set({ topic: 'general', text: 'עובדה שפגה', st: 'ok', exp: '2026-11-19', t: 1 }));
    PUSH.length = 0;
    await run('2026-11-20T08:30'); // שישי – לא יום עסקים: לא נוצר
    await run('2026-11-22T08:30'); // ראשון
    let f = byKey(await notes(M1), /^fact:f9:/)[0];
    assert.equal(f.pend, true); assert.equal(f.pushAt, IL('2026-11-22T09:00')); assert.ok(!PUSH.some((p) => p.meta.uid === M1), 'בשעות השקטות – לא נשלח');
    await run('2026-11-22T09:05');
    f = byKey(await notes(M1), /^fact:f9:/)[0];
    assert.equal(f.pend, false); assert.ok(PUSH.some((p) => p.meta.uid === M1), 'אחרי סוף השעות השקטות – נשלח');
  });

  it('התראה מיידית על עובד (61): שם ופירוט, "מה לא ידוע"; רק כשמתג ניתוח העובדים פעיל; סגירה של מנהל – לא; התראת הטלפון בלי שם', async () => {
    await seed({ cfg: { emp: false } });
    await bizA();
    const t0 = IL('2026-11-12T10:00');
    await run('2026-11-12T10:00'); // נקודת ההתחלה
    await prep((d) => d.doc(`b/${A}/closings/z5`).set({ uid: E1, by: 'דוד כהן', t: t0 + 60000, reg: 'i_yh', d: '2026-11-12', st: 'new', data: closingData(1000, 880) }));
    await run('2026-11-12T10:15');
    assert.equal((await notes(M1)).filter((x) => x.k === 'emp').length, 0, 'מתג כבוי – אין התראה');
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).update({ emp: true }));
    await prep(async (d) => {
      await d.doc(`b/${A}/closings/z6`).set({ uid: E1, by: 'דוד כהן', t: t0 + 30 * 60000, reg: 'i_yh', d: '2026-11-12', st: 'new', data: closingData(1000, 920) });
      await d.doc(`b/${A}/closings/z7`).set({ uid: M1, by: 'מנהל 1', t: t0 + 31 * 60000, reg: 'i_nl', d: '2026-11-12', st: 'ok', data: closingData(1000, 700) });
      await d.doc(`b/${A}/closings/z8`).set({ uid: E1, by: 'דוד כהן', t: t0 + 32 * 60000, reg: 'i_nl', d: '2026-11-12', st: 'new', data: closingData(500, 500) });
    });
    PUSH.length = 0;
    await run('2026-11-12T10:45');
    const L = (await notes(M1)).filter((x) => x.k === 'emp');
    assert.equal(L.length, 1, JSON.stringify(L.map((x) => x.key)));
    assert.match(L[0].title, /דוד כהן/); assert.match(L[0].body, /הפרש מספר 2 החודש/); assert.match(L[0].body, /120.*80|80.*120/); assert.match(L[0].body, /מה לא ידוע/); assert.match(L[0].body, /אינו הוכחה לגניבה/);
    assert.equal((await notes(M3)).filter((x) => x.k === 'emp').length, 0, 'מנהל עם הגבלת סניפים – לא');
    assert.ok(PUSH.length && PUSH.every((p) => !/דוד|כהן|80/.test(p.msg.body)), 'בטלפון – בלי שם ובלי סכום');
    assert.ok((await coll(`b/${A}/sec_log`)).some((l) => l.act === 'empAlert' && l.tgt === E1));
  });
});

// ---------------------------------------------------------------------------------
describe('דוחות שבועי וחודשי (6.4, 55, 66–69): ביום ובשעה שהמנהל קבע, באפליקציה בלבד', () => {
  const months = { '2026-10': { inc: 50000, exp: 61000, own: 0, cats: [['אריזות', 'e', 9000], ['מכירות', 'i', 50000]] }, '2026-09': { inc: 52000, exp: 48000, own: 0, cats: [] }, '2025-10': { inc: 47000, exp: 45000, own: 0, cats: [['אריזות', 'e', 6000]] }, '2026-11': { inc: 20000, exp: 15000, own: 0, cats: [] } };
  it('שבועי: ברירת מחדל ראשון 08:00; נשמר ב-sec_rep עם uid, התראה כללית; יוזמות לשיפור, "לא רלוונטי" (90 יום) לא חוזר; "סמן כטופל"', async () => {
    await seed();
    await bizA();
    await prep((d) => d.doc(`b/${A}/sec_mirror/fin`).set({ v: 1, data: finOf({ months, open: [['ספק', '1', '2026-11-01', '2026-11-17', 300, 300]], late: { sum: 700, gross: 700, n: 2 }, chk: [['2026-11-18', 'מוטב', -2000]] }), at: IL('2026-11-14T20:00') }));
    PUSH.length = 0;
    await run('2026-11-15T07:55');
    assert.equal((await coll(`b/${A}/sec_rep`)).length, 0, 'לפני 08:00 – אין דוח');
    await run('2026-11-15T08:10');
    const reps = await coll(`b/${A}/sec_rep`);
    const w1 = reps.find((r) => r.id === `w_${M1}_2026-11-15`);
    assert.ok(w1, JSON.stringify(reps.map((r) => r.id)));
    assert.equal(w1.uid, M1); assert.equal(w1.kind, 'w');
    const txt = JSON.stringify(w1.secs);
    for (const re of [/חשבוניות לתשלום השבוע/, /חשבוניות באיחור/, /צ'קים/, /משימות פתוחות/, /הפרשי קופה/]) assert.match(txt, re);
    assert.ok(w1.ideas.some((x) => /^loss:2026-10/.test(x.key)) && w1.ideas.some((x) => /^catUp:אריזות/.test(x.key)), 'יוזמות לשיפור (55)');
    assert.equal(reps.filter((r) => r.uid === M3).length, 0, 'מנהל עם הגבלת סניפים – אין דוח');
    assert.ok(PUSH.some((p) => p.msg.body === 'הדוח השבועי מוכן' || /התראות חדשות/.test(p.msg.body)), 'התראה באפליקציה/בטלפון – כללית');
    assert.ok(PUSH.every((p) => !/61,000|50,000|אריזות/.test(p.msg.body)));
    // באפליקציה בלבד (68): אין ערוץ אחר – לא נוצר שום מסמך יוצא (sec_draft/sec_in) ולא נשלח דבר מלבד ההתראה
    assert.equal((await coll(`b/${A}/sec_draft`)).length, 0); assert.equal((await coll(`b/${A}/sec_in`)).length, 0);
    const lr = await call('secReports', M1, { op: 'list' });
    assert.ok(lr.result.reports.some((r) => r.id === w1.id));
    assert.equal((await call('secReports', M2, { op: 'get', id: w1.id })).reason, 'not-found', 'מנהל אחר לא רואה');
    const lossKey = w1.ideas.find((x) => /^loss:/.test(x.key)).key;
    assert.equal((await call('secReports', M1, { op: 'done', id: w1.id, key: lossKey })).status, 'OK');
    assert.deepEqual((await get(`b/${A}/sec_rep/${w1.id}`)).done, [lossKey]);
    assert.equal((await call('secPrefs', M1, { op: 'notRelevant', key: lossKey })).status, 'OK');
    await run('2026-11-22T08:10');
    const w2 = await get(`b/${A}/sec_rep/w_${M1}_2026-11-22`);
    assert.ok(w2 && !w2.ideas.some((x) => x.key === lossKey), '"לא רלוונטי" – לא מוצע שוב');
    assert.ok(w2.ideas.some((x) => /^catUp:/.test(x.key)));
  });
  it('יום ושעה שהמנהל קבע (67): שישי – אזהרה בבחירה, והדוח ביום העסקים הבא; חג – "נדחה בגלל חג"; חודשי – יום העסקים הראשון, השוואות, שכר כסך כולל רק עם מתג שכר; תקציר יומי כבוי כברירת מחדל (69)', async () => {
    await seed();
    await bizA();
    await prep(async (d) => {
      await d.doc(`b/${A}/sec_mirror/fin`).set({ v: 1, data: finOf({ months: Object.assign({}, months, { '2026-11': { inc: 51000, exp: 40000, own: 0, cats: [['אריזות', 'e', 7000]] }, '2025-11': { inc: 45000, exp: 41000, own: 0, cats: [] } }), wk: { start: '2026-12-06', out: [1000, 2000], inLo: 9000, inHi: 12000, inAvg: 10000 } }), at: IL('2026-11-30T20:00') });
      await d.doc(`b/${A}/sec_mirror/pay`).set({ data: JSON.stringify({ '2026-11': [['דוד כהן', 6000], ['דנה', 7000]] }), at: 1 });
    });
    const r = await call('secPrefs', M1, { op: 'notify', nt: { wd: 5, wh: 9 } });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.warn, 'הדוח יופיע ביום העסקים הבא');
    assert.equal((await call('secPrefs', M1, { op: 'notify', nt: { wh: 25 } })).reason, 'bad-input');
    assert.equal((await call('secState', M1)).result.nt.wd, 5);
    await run('2026-11-13T09:30'); // שישי
    assert.equal(await get(`b/${A}/sec_rep/w_${M1}_2026-11-13`), null, 'בשישי – אין');
    await run('2026-11-15T08:10'); // ראשון לפני השעה שנבחרה (09:00)
    assert.equal(await get(`b/${A}/sec_rep/w_${M1}_2026-11-13`), null, 'לפני השעה שנבחרה – אין');
    await run('2026-11-15T09:10');
    const w = await get(`b/${A}/sec_rep/w_${M1}_2026-11-13`);
    assert.ok(w); assert.match(w.why, /יום העסקים הבא/);
    // חג: שבוע של ראש השנה תשפ"ז – היום שנבחר (ראשון 13.9.2026) הוא חג
    const K = require('../functions/lib/sec-know.js');
    const h = R.weeklyDue('2026-09-14', 0);
    assert.equal(K.bizDay('2026-09-13'), false); assert.equal(h.fire, R.bizOnOrAfter('2026-09-13')); assert.equal(h.why, 'נדחה בגלל חג');
    // חודשי: יום העסקים הראשון בדצמבר (שלישי 1.12) אחרי 08:00
    await run('2026-12-01T08:20');
    const m1 = await get(`b/${A}/sec_rep/m_${M1}_2026-12`), m2 = await get(`b/${A}/sec_rep/m_${M2}_2026-12`);
    assert.ok(m1 && m2);
    const t1 = JSON.stringify(m1.secs);
    assert.match(t1, /סיכום 2026-11/); assert.match(t1, /מול החודש הקודם/); assert.match(t1, /מול אותו חודש אשתקד/); assert.match(t1, /הוצאות לפי קטגוריה/); assert.match(t1, /13 השבועות/);
    assert.match(t1, /סך השכר בחודש הקודם: 13,000/); assert.doesNotMatch(t1, /דוד|דנה/, 'שכר – סך כולל בלבד');
    assert.doesNotMatch(JSON.stringify(m2.secs), /שכר/, 'מנהל בלי מתג שכר – בלי שכר');
    assert.equal((await notes(M1)).filter((x) => x.k === 'dig').length, 0, 'תקציר יומי כבוי כברירת מחדל');
    await call('secPrefs', M1, { op: 'notify', nt: { dg: true, dh: 7 } });
    await run('2026-12-02T07:10');
    assert.equal((await notes(M1)).filter((x) => x.k === 'dig').length, 1, 'הודלק – נוצר');
  });
});

// ---------------------------------------------------------------------------------
describe('שמירת היסטוריה (9.5, 91–95): secDaily, מחיקה יזומה באישור כפול, ניתוק לא מוחק', () => {
  const NOW = IL('2026-11-12T04:15');
  const MO = 30.5 * 864e5;
  async function seedHist(feat) {
    await seed({ featA: feat });
    await prep(async (d) => {
      await d.doc(`b/${A}/sec_chat/${M1}/m/old`).set({ t: NOW - 13 * MO, role: 'u', text: 'ישן' });
      await d.doc(`b/${A}/sec_chat/${M1}/m/young`).set({ t: NOW - 11 * MO, role: 'u', text: 'צעיר' });
      await d.doc(`b/${A}/sec_chat/${M2}/m/old2`).set({ t: NOW - 14 * MO, role: 'a', text: 'ישן 2' });
      await d.doc(`b/${A}/sec_log/l23`).set({ t: NOW - 23 * MO, act: 'x' });
      await d.doc(`b/${A}/sec_log/l25`).set({ t: NOW - 25 * MO, act: 'x' });
      await d.doc(`b/${A}/sec_note/${M1}/n/n13`).set({ t: NOW - 13 * MO, at: 1, k: 'rem' });
    });
  }
  it('ריצה מדומה של secDaily: צ\'אט מעל 12 חודשים נמחק, צעיר נשאר; sec_log לא נמחק לפני 24 חודשים', async () => {
    await seedHist(true);
    const r = await RM.runSecDaily({ now: NOW, bizzes: [await bizA()] });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.res[A], { chat: 2, notes: 1, log: 1, inbox: 0 }); // inbox – שלב 5 (sec_in בן יותר מ-12 חודשים → תקציר; secretary-wa.test.js)
    assert.deepEqual((await coll(`b/${A}/sec_chat/${M1}/m`)).map((x) => x.id), ['young']);
    assert.equal((await coll(`b/${A}/sec_chat/${M2}/m`)).length, 0);
    const lg = (await coll(`b/${A}/sec_log`)).map((x) => x.id);
    assert.ok(lg.includes('l23'), 'sec_log בן 23 חודשים – נשאר'); assert.ok(!lg.includes('l25'));
    assert.ok((await coll(`b/${A}/sec_log`)).some((l) => l.act === 'retention'));
  });
  it('ניתוק התוספת לא מוחק נתונים (95): secDaily ו-secRemind דרך רשימת העסקים עם התוספת – העסק המנותק לא נגעו בו', async () => {
    await seedHist(false);
    const r = await RM.runSecDaily({ now: NOW });
    assert.equal(r.res[A], undefined, 'עסק מנותק לא ברשימה');
    await RM.runRemind({ now: NOW, send });
    assert.equal((await coll(`b/${A}/sec_chat/${M1}/m`)).length, 2); assert.equal((await coll(`b/${A}/sec_log`)).length, 2); assert.equal((await coll(`b/${A}/sec_note/${M1}/n`)).length, 1);
    assert.ok(await get(`b/${A}/sec_cfg/main`));
  });
  it('עמידה לתקלה: עסק אחד שנכשל לא עוצר את האחרים (כמו בגיבוי)', async () => {
    await seedHist(true);
    const r = await RM.runSecDaily({ now: NOW, bizzes: [{ bizId: 'bad//x', dataRoot: 'b', status: 'active', features: {} }, await bizA()] });
    assert.equal(r.errors.length, 1); assert.equal(r.errors[0].bizId, 'bad//x');
    assert.equal(r.res[A].chat, 2);
    const r2 = await RM.runRemind({ now: NOW, bizzes: [{ bizId: 'bad//x', dataRoot: 'b', status: 'active', features: {} }, BIZA], send });
    assert.equal(r2.errors.length, 1); assert.ok(r2.res[A]);
  });
  it('מחיקה יזומה (93): בלי אישור שני – נכשלת; עם אישור – נמחק ונרשם ב-sec_log; האישור חד־פעמי; של מנהל אחר – לא נוגע', async () => {
    await seedHist(true);
    assert.equal((await call('secHistory', M1, { op: 'del' })).reason, 'need-confirm');
    const a = await call('secHistory', M1, { op: 'ask' });
    assert.equal(a.status, 'OK', a.text); assert.equal(a.result.counts.chat, 2);
    assert.equal((await call('secHistory', M1, { op: 'del', token: a.result.token })).reason, 'need-confirm', 'בלי sure');
    assert.equal((await call('secHistory', M1, { op: 'del', token: 'x' + a.result.token.slice(1), sure: true })).reason, 'bad-confirm');
    assert.equal((await call('secHistory', M2, { op: 'del', token: a.result.token, sure: true })).reason, 'bad-confirm', 'קוד של מנהל אחר');
    assert.equal((await coll(`b/${A}/sec_chat/${M1}/m`)).length, 2, 'עדיין לא נמחק');
    const d = await call('secHistory', M1, { op: 'del', token: a.result.token, sure: true });
    assert.equal(d.status, 'OK', d.text); assert.deepEqual(d.result.deleted, { chat: 2, notes: 1, reports: 0 });
    assert.equal((await coll(`b/${A}/sec_chat/${M1}/m`)).length, 0);
    assert.equal((await coll(`b/${A}/sec_chat/${M2}/m`)).length, 1, 'של מנהל אחר – לא נמחק');
    const lg = await coll(`b/${A}/sec_log`);
    assert.ok(lg.some((l) => l.act === 'histDel' && l.by === M1 && /chat=2/.test(l.note)));
    assert.ok(lg.some((l) => l.id === 'l25'), 'יומן הפעולות לא נמחק');
    assert.equal((await call('secHistory', M1, { op: 'del', token: a.result.token, sure: true })).reason, 'bad-confirm', 'חד־פעמי');
    // אין מחיקה מהאפליקציה ישירות
    await assertFails(db(M1).doc(`b/${A}/sec_chat/${M2}/m/old2`).delete());
  });
});

// ---------------------------------------------------------------------------------
describe('תיקון סבב 1', () => {
  const finSet = (biz, data) => prep((d) => d.doc(`b/${biz}/sec_mirror/fin`).set({ v: 1, data, at: IL('2026-11-11T20:00') }));
  it('ליקוי 2: תזכורת חשבונית/צ\'ק לא נסגרת כשאין מראה (חסר/פגום) או כשעבר חלון הזמן – רק כשהפריט באמת נעלם מהמראה', async () => {
    await seed({ nt: { [M1]: { rt: ALL_RT } } });
    await bizA();
    const full = finOf({ open: [['ספק הקמח', '77', '2026-11-01', '2026-11-15', 500, 450]], chk: [['2026-11-16', 'בעל הבית', -8000]] });
    await finSet(A, full);
    await run('2026-11-12T08:30');
    const st = async () => { const L = await notes(M1); return [byKey(L, /^invDue:pre:/)[0].st, byKey(L, /^chk:/)[0].st]; };
    assert.deepEqual(await st(), ['open', 'open']);
    await prep((d) => d.doc(`b/${A}/sec_mirror/fin`).delete());
    await run('2026-11-15T08:10');
    assert.deepEqual(await st(), ['open', 'open'], 'מראה חסר – לא נסגרות');
    await finSet(A, '{not json');
    await run('2026-11-16T08:10');
    assert.deepEqual(await st(), ['open', 'open'], 'מראה פגום – לא נסגרות');
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).update({ mirror: false }));
    await run('2026-11-17T08:10');
    assert.deepEqual(await st(), ['open', 'open'], 'מראה כבוי – לא נסגרות');
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).update({ mirror: true }));
    await finSet(A, full);
    await run('2026-11-18T08:10');
    assert.deepEqual(await st(), ['open', 'open'], 'חלון הזמן עבר אבל החשבונית והצ\'ק עדיין במראה – לא נסגרות');
    await finSet(A, finOf({ open: [], chk: [] }));
    await run('2026-11-19T08:10');
    assert.deepEqual(await st(), ['gone', 'gone'], 'נעלמו ממראה תקין – נסגרות');
  });

  it('ליקוי 3: הדוח החודשי ביום שהמנהל קבע – שבת → יום העסקים הבא (גם בחודש הבא), 31 בחודש של 30 ימים → היום האחרון, חג → "נדחה בגלל חג"; ברירת מחדל – יום העסקים הראשון', async () => {
    await seed();
    await bizA();
    await finSet(A, finOf({ months: { '2026-09': { inc: 100, exp: 50, own: 0, cats: [] }, '2026-10': { inc: 200, exp: 90, own: 0, cats: [] } } }));
    assert.equal((await call('secPrefs', M1, { op: 'notify', nt: { md: 32 } })).reason, 'bad-input');
    assert.equal((await call('secPrefs', M1, { op: 'notify', nt: { md: 31, mh: 8 } })).status, 'OK');
    assert.equal((await call('secState', M1)).result.nt.md, 31);
    await run('2026-10-30T09:00'); // שישי – לא
    assert.equal(await get(`b/${A}/sec_rep/m_${M1}_2026-10`), null);
    await run('2026-11-01T08:10'); // 31.10.2026 = שבת → ראשון 1.11
    const oct = await get(`b/${A}/sec_rep/m_${M1}_2026-10`);
    assert.ok(oct, 'דוח אוקטובר יצא ביום העסקים הבא, בחודש הבא'); assert.match(oct.why, /יום העסקים הבא/); assert.match(JSON.stringify(oct.secs), /סיכום 2026-09/);
    assert.ok(await get(`b/${A}/sec_rep/m_${M2}_2026-11`), 'ברירת מחדל (M2) – יום העסקים הראשון בנובמבר');
    assert.equal(await get(`b/${A}/sec_rep/m_${M1}_2026-11`), null, 'M1 – לא ב-1 בחודש');
    await run('2026-11-29T09:00');
    assert.equal(await get(`b/${A}/sec_rep/m_${M1}_2026-11`), null);
    await run('2026-11-30T08:10'); // בנובמבר אין 31 – היום האחרון (שני)
    const nov = await get(`b/${A}/sec_rep/m_${M1}_2026-11`);
    assert.ok(nov); assert.match(nov.why, /אין 31 ימים/); assert.match(JSON.stringify(nov.secs), /סיכום 2026-10/);
    const K = require('../functions/lib/sec-know.js');
    const h = R.monthlyOf('2026-09', 13); // 13.9.2026 – ראש השנה (ראשון)
    assert.equal(K.bizDay('2026-09-13'), false); assert.equal(h.fire, R.bizOnOrAfter('2026-09-13')); assert.equal(h.why, 'נדחה בגלל חג');
    assert.equal(R.monthlyOf('2026-10', 0).fire, R.bizOnOrAfter('2026-10-01'));
  });

  it('ליקוי 4: סגירה שנדחתה (st:rej) לא נספרת – לא בהתראה על עובד, לא בתזכורת סגירות ולא בדוח השבועי', async () => {
    await seed();
    await bizA();
    const t0 = IL('2026-11-12T10:00');
    await run('2026-11-12T10:00');
    await prep(async (d) => {
      await d.doc(`b/${A}/closings/r1`).set({ uid: E1, by: 'דוד כהן', t: t0 + 60000, reg: 'i_yh', d: '2026-11-12', st: 'rej', data: closingData(1000, 880) });
      await d.doc(`b/${A}/closings/r2`).set({ uid: E1, by: 'דוד כהן', t: t0 + 120000, reg: 'i_yh', d: '2026-11-12', st: 'new', data: closingData(1000, 920) });
    });
    await run('2026-11-12T10:15');
    const L = (await notes(M1)).filter((x) => x.k === 'emp');
    assert.equal(L.length, 1, 'רק על הסגירה שלא נדחתה');
    assert.match(L[0].body, /הפרש ראשון החודש/); assert.doesNotMatch(L[0].body, /120/);
    const P = '2026-11-11';
    const cl = [{ reg: 'i_yh', d: P, st: 'rej', data: closingData(1000, 800) }, { reg: 'i_yh', d: P, st: 'ok', data: closingData(500, 500) }];
    assert.deepEqual(R.closeCands(cl, '2026-11-12'), [], 'סגירה תקינה בלי הפרש + נדחית עם הפרש – אין תזכורת');
    assert.equal(R.closeCands([{ reg: 'i_nl', d: '2026-11-08', st: 'rej', data: closingData(1, 1) }], '2026-11-12').length, 0, 'קופה שרק נדחו בה סגירות – לא "חסרה"');
    const rep = R.buildReport({ kind: 'w', today: '2026-11-15', now: IL('2026-11-15T08:00'), fin: null, nr: {}, tasks: [], closings: cl, rt: { invLate: true } });
    assert.match(JSON.stringify(rep.secs), /הפרשי קופה בשבוע האחרון","lines":\["אין"\]/);
  });

  it('ליקוי 5 (החלטה 75): secCal – תזכורת בשישי/שבת נשאלת גם כשהמנהל בחר "לקבל"; force שומר עם keepOff; אירוע רגיל – בלי שאלה; עריכה לשבת – שואלת שוב', async () => {
    await seed();
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).set({ mgr: { [M1]: { we: 'accept' } } }, { merge: true }));
    const dkIL = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    let k = 2; while (new Date(dkIL(Date.now() + k * 864e5) + 'T12:00:00Z').getUTCDay() !== 6) k++;
    const sat = dkIL(Date.now() + k * 864e5), sat2 = dkIL(Date.now() + (k + 7) * 864e5), mon = dkIL(Date.now() + (k + 2) * 864e5);
    const w = await call('secCal', M1, { op: 'add', title: 'להתקשר לרו"ח', d: sat, tm: '11:00', rem: true });
    assert.equal(w.status, 'OK', w.text); assert.equal(w.result.ok, false); assert.equal(w.result.warn.rem, true); assert.equal(w.result.warn.kind, 'שבת');
    assert.equal((await coll(`b/${A}/sec_cal`)).length, 0, 'לא נשמר לפני תשובה');
    const f = await call('secCal', M1, { op: 'add', title: 'להתקשר לרו"ח', d: sat, tm: '11:00', rem: true, force: true });
    assert.equal(f.result.ok, true);
    const x = await get(`b/${A}/sec_cal/${f.result.id}`);
    assert.equal(x.rem, true); assert.equal(x.keepOff, true); assert.equal(x.d, sat);
    const e = await call('secCal', M1, { op: 'add', title: 'פגישה', d: sat, tm: '10:00' });
    assert.equal(e.result.ok, true, 'אירוע רגיל עם "לקבל" – בלי שאלה');
    const r2 = await call('secCal', M1, { op: 'add', title: 'תזכורת', d: mon, rem: true });
    assert.equal(r2.result.ok, true);
    const ed = await call('secCal', M1, { op: 'edit', id: r2.result.id, title: 'תזכורת', d: sat2 });
    assert.equal(ed.result.ok, false); assert.equal(ed.result.warn.rem, true, 'עריכת תאריך לשבת – שואלת שוב');
    assert.equal((await get(`b/${A}/sec_cal/${r2.result.id}`)).d, mon);
  });

  it('ליקוי 6: בידוד בין שני עסקים פעילים – runRemind ו-runSecDaily', async () => {
    await seed({ featB: true });
    const bizB = await T.loadBiz(B); await bizA();
    await prep(async (d) => {
      await d.doc(`b/${B}/staff/${MB}`).set({ name: 'מנהל B', role: 'manager', active: true, pushTokens: ['tokMB_' + 'c'.repeat(30)] });
      await d.doc(`b/${B}/sec_cal/cb`).set({ uid: '', st: 'ok', title: 'אירוע של B', d: '2026-11-15', tm: '10:00', t: 1 });
      await d.doc(`b/${A}/sec_cal/ca`).set({ uid: '', st: 'ok', title: 'אירוע של A', d: '2026-11-15', tm: '10:00', t: 1 });
      await d.doc(`b/${A}/sec_chat/${M1}/m/old`).set({ t: IL('2025-09-01T10:00'), role: 'u', text: 'ישן A' });
      await d.doc(`b/${B}/sec_chat/${MB}/m/old`).set({ t: IL('2025-09-01T10:00'), role: 'u', text: 'ישן B' });
    });
    await finSet(A, finOf({ open: [['ספק של A', '1', '2026-11-01', '2026-11-15', 100, 100]] }));
    await finSet(B, finOf({ open: [['ספק של B', '2', '2026-11-01', '2026-11-15', 200, 200]] }));
    PUSH.length = 0;
    const r = await RM.runRemind({ now: IL('2026-11-15T09:30'), bizzes: [BIZA, bizB], send });
    assert.deepEqual(r.errors, []);
    const nA = JSON.stringify(await notes(M1)), nB = JSON.stringify(await coll(`b/${B}/sec_note/${MB}/n`));
    assert.match(nA, /ספק של A/); assert.match(nA, /אירוע של A/); assert.doesNotMatch(nA, /של B/);
    assert.match(nB, /ספק של B/); assert.match(nB, /אירוע של B/); assert.doesNotMatch(nB, /של A/);
    assert.equal((await coll(`b/${A}/sec_note/${MB}/n`)).length, 0); assert.equal((await coll(`b/${B}/sec_note/${M1}/n`)).length, 0);
    const repB = await coll(`b/${B}/sec_rep`);
    assert.ok(repB.length && repB.every((x) => x.uid === MB)); assert.ok((await coll(`b/${A}/sec_rep`)).every((x) => x.uid !== MB));
    assert.ok(PUSH.filter((p) => p.meta.uid === MB).every((p) => p.meta.bizId === B && p.tokens[0].startsWith('tokMB_')));
    // secDaily בעסק A בלבד – לא נוגע ב-B; בשניהם – כל עסק לחוד
    const d1 = await RM.runSecDaily({ now: IL('2026-11-15T04:15'), bizzes: [BIZA] });
    assert.equal(d1.res[A].chat, 1); assert.equal((await coll(`b/${B}/sec_chat/${MB}/m`)).length, 1, 'B לא נגע');
    const d2 = await RM.runSecDaily({ now: IL('2026-11-15T04:15'), bizzes: [BIZA, bizB] });
    assert.equal(d2.res[A].chat, 0); assert.equal(d2.res[B].chat, 1);
  });

  it('תקלה בשליחת התראה למנהל אחד לא עוצרת את שאר העסק; ההתראה נשארת ממתינה', async () => {
    await seed();
    await bizA();
    await prep((d) => d.doc(`b/${A}/push_tokens/${M2}`).set({ pushTokens: ['tokM2_' + 'b'.repeat(30)] }));
    await finSet(A, finOf({ open: [['ספק', '9', '2026-11-01', '2026-11-15', 100, 100]] }));
    PUSH.length = 0;
    const bad = async (tokens, msg, meta) => { if (meta.uid === M1) throw new Error('fcm down'); return send(tokens, msg, meta); };
    const r = await RM.runRemind({ now: IL('2026-11-15T08:10'), bizzes: [BIZA], send: bad });
    assert.deepEqual(r.errors, []); assert.equal(r.res[A].pushErr, 1);
    assert.ok(PUSH.some((p) => p.meta.uid === M2), 'מנהל אחר קיבל');
    assert.ok(byKey(await notes(M1), /^invDue:due:/)[0].pend, 'נשארה ממתינה');
    assert.equal((await get(`b/${A}/sec_cfg/rem`)).scan, '2026-11-15', 'מצב הריצה נשמר');
  });
});
