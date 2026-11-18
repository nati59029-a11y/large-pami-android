'use strict';
// משמרות (שלב 3, 18.11.2026) – shApi ו-shTick מול האמולטור (Firestore). הפונקציות רצות בתוך תהליך הבדיקה (כמו daily-rep.test.js),
// כדי לשלוט בשעון של shTick (opts.now) ובשליחת ההתראות (send מדומה). shApi רץ בשעון האמיתי – לכן כל התאריכים בעתיד.
//   1. הרשאות: עובד בלי shf – רק week, ורק המשמרות שלו; עובד עם shf – רואה ועורך, לא הגדרות; עסק בלי tasks נחסם.
//   2. גישה ישירה מהאפליקציה ל-shf / shft / shfcfg / shfsent – חסומה בחוקים, גם ב-b/{bizId} וגם בשורש (legacy).
//   3. משמרת קבועה: "רק הפעם" משנה רק את השבוע הזה; "מכאן והלאה" לא משנה שבועות קודמים.
//   4. shTick: משימה ב-tasks רק כשהמשמרת מתחילה (פעם אחת); תזכורת אחת שעה לפני גם אחרי 3 ריצות; התראת חורים אחת ב-07:00, למנהלים בלבד;
//      בשבת – לא נשלח כלום. נתונים קיימים (tasks, staff, admins) לא משתנים.
//   5. legacy (לארג' פעמי בשורש): המשמרות נשמרות בשורש.
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-sh', OFF = 'biz-shoff';
const M1 = 'sh_m1', E1 = 'sh_e1', E2 = 'sh_e2', EX = 'sh_ex', EOFF = 'sh_eoff', LM = 'sh_lm', LE = 'sh_le';
const P = 'b/' + A + '/';
const HRS = [{ s: '08:00', e: '20:00' }, { s: '08:00', e: '20:00' }, { s: '08:00', e: '20:00' }, { s: '08:00', e: '20:00' }, { s: '08:00', e: '20:00' }, { s: '08:00', e: '14:00' }, null];
const FULL = { incR: false, incW: true, expR: true, expW: true, sup: true, sal: false, rep: false, ord: true, trf: false, bal: false, ordP: false, prc: false, s3m: false, shf: true };
let env, SH, SC, TK;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const fs = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function list(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const req = (uid, data) => ({ auth: { uid, token: { email: uid + '@x.invalid' } }, data: data || {} });
async function call(uid, data) { try { return { ok: true, r: await SH.api(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; } }
let PUSH = [];
const send = async (tokens, msg, meta) => { PUSH.push({ tokens, msg, uid: meta && meta.uid }); return tokens.map((t) => ({ token: t, ok: true })); };
const IL = (day, hm) => { const [y, m, d] = day.split('-').map(Number); return TK.zoned(y, m - 1, d, +hm.slice(0, 2), +hm.slice(3)); };
// יום שני–רביעי בעתיד (לפחות 3 ימים מהיום), שאינו חג – כדי שהשעון המדומה של shTick לא ייפול בחלון השקט
function workDay(minAhead) {
  let d = SC.addDays(SC.todayOf(Date.now()), minAhead || 3);
  for (let i = 0; i < 60; i++, d = SC.addDays(d, 1)) if ([1, 2, 3].includes(SC.weekdayOf(d)) && !TK.quietAt(IL(d, '06:00')) && !TK.quietAt(IL(d, '12:00'))) return d;
  throw new Error('no work day');
}
const tick = (now) => SH.runTick({ now, send });

async function seed() {
  await env.clearFirestore();
  PUSH = [];
  await prep(async (d) => {
    const b = d.batch();
    const biz = (id, tasks) => b.set(d.doc('b/' + id), { name: id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { tasks } });
    biz(A, true); biz(OFF, false);
    b.set(d.doc(`${P}admins/${M1}`), { email: 'm1@x.example' });
    b.set(d.doc(`${P}staff/${E1}`), { name: 'דנה', role: 'employee', active: true, perms: FULL });
    b.set(d.doc(`${P}staff/${E2}`), { name: 'יוסי', role: 'employee', active: true });
    b.set(d.doc(`${P}staff/${EX}`), { name: 'מושבת', role: 'employee', active: false });
    b.set(d.doc(`b/${OFF}/staff/${EOFF}`), { name: 'אחר', role: 'employee', active: true });
    for (const [u, bz, role] of [[M1, A, 'admin'], [E1, A, 'worker'], [E2, A, 'worker'], [EX, A, 'worker'], [EOFF, OFF, 'worker']]) {
      b.set(d.doc('users/' + u), { bizId: bz, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    }
    b.set(d.doc(`${P}push_tokens/${M1}`), { pushTokens: ['tokM1'] });
    b.set(d.doc(`${P}push_tokens/${E1}`), { pushTokens: ['tokE1'] });
    b.set(d.doc(`${P}push_tokens/${E2}`), { pushTokens: ['tokE2'] });
    b.set(d.doc(`${P}tasks/old1`), { owner: M1, by: 'm1', role: 'a', txt: 'משימה קיימת', cr: 1, due: 2, st: 'open', open: '1', to: [E2], toN: ['יוסי'] });
    // לארג' פעמי במצב legacy (שורש)
    b.set(d.doc('b/largpeami'), { name: 'ל', status: 'active', dataRoot: 'legacy', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { tasks: true } });
    b.set(d.doc('admins/' + LM), { email: 'lm@x.example' });
    b.set(d.doc('staff/' + LE), { name: 'ותיק', active: true });
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  SH = require('../functions/shifts.js')._core;
  SC = require('../functions/lib/shifts-core.js');
  TK = require('../functions/lib/tk-time.js');
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('shApi – הרשאות', () => {
  beforeEach(seed);
  it('עובד בלי shf: week – רק המשמרות שלו, בלי חורים ומשימות; כל פעולה אחרת – permission-denied', async () => {
    const D = workDay();
    assert.ok((await call(M1, { op: 'save', d: D, s: '08:00', e: '12:00', fx: false, u: E2 })).ok);
    assert.ok((await call(M1, { op: 'save', d: D, s: '12:00', e: '16:00', fx: false, u: E1 })).ok);
    const w = await call(E2, { op: 'week', from: SC.weekStart(D) });
    assert.ok(w.ok, w.msg);
    assert.deepEqual(w.r.occ.map((o) => o.u), [E2]);
    assert.equal(w.r.full, false);
    assert.equal(w.r.tasks, undefined);
    assert.equal(w.r.holes, undefined);
    for (const data of [{ op: 'save', d: D, s: '08:00', e: '12:00', fx: false }, { op: 'del', id: 'x' }, { op: 'task', occ: 'x_' + D, txt: 'a' }, { op: 'taskDel', id: 'x' }, { op: 'staff' }, { op: 'cfg' }, { op: 'setCfg', late: 3 }]) {
      const r = await call(E2, data);
      assert.equal(r.code, 'permission-denied', data.op);
      assert.equal(r.reason, 'not-allowed', data.op);
    }
  });
  it('עובד עם shf: רואה הכול ועורך; הגדרות – מנהל בלבד', async () => {
    const D = workDay();
    const s = await call(E1, { op: 'save', d: D, s: '08:00', e: '12:00', fx: false, u: E2 });
    assert.ok(s.ok, s.msg);
    const w = await call(E1, { op: 'week', from: SC.weekStart(D) });
    assert.equal(w.r.full, true);
    assert.equal(w.r.occ.length, 1);
    assert.ok(w.r.staff.some((x) => x.uid === E2) && !w.r.staff.some((x) => x.uid === EX));
    assert.equal((await call(E1, { op: 'cfg' })).reason, 'not-manager');
    assert.equal((await call(E1, { op: 'setCfg', late: 3 })).reason, 'not-manager');
    const c = await call(M1, { op: 'setCfg', late: 7, at: '06:30', hrs: HRS, map: { 'דנה כספית': E1 } });
    assert.ok(c.ok, c.msg);
    assert.deepEqual(c.r.cfg, { late: 7, at: '06:30', hrs: HRS });
    assert.deepEqual(c.r.map, { 'דנה כספית': E1 });
    assert.equal((await call(M1, { op: 'setCfg', map: { x: EX } })).reason, 'bad-map');
    assert.equal((await call(M1, { op: 'setCfg', late: 61 })).reason, 'bad-late');
    assert.equal((await call(M1, { op: 'setCfg', hrs: HRS.slice(0, 6) })).reason, 'bad-hrs');
  });
  it('קלט: שדה זר, עובד מושבת, שעה שגויה, פעולה לא מוכרת; עסק בלי tasks – feature-off', async () => {
    const D = workDay();
    assert.equal((await call(M1, { op: 'save', d: D, s: '08:00', e: '12:00', fx: false, zz: 1 })).reason, 'bad-field');
    assert.equal((await call(M1, { op: 'save', d: D, s: '08:00', e: '12:00', fx: false, u: EX })).reason, 'bad-user');
    assert.equal((await call(M1, { op: 'save', d: D, s: '08:00', e: '08:00', fx: false })).reason, 'bad-time');
    assert.equal((await call(M1, { op: 'save', d: D, s: '08:00', e: '12:00' })).reason, 'bad-fx');
    assert.equal((await call(M1, { op: 'nope' })).reason, 'bad-op');
    assert.equal((await call(EOFF, { op: 'week' })).reason, 'feature-off');
  });
});

describe('גישה ישירה לאוספי המשמרות – חסומה', () => {
  beforeEach(seed);
  it('מנהל ועובד, b/{bizId} ושורש: קריאה וכתיבה נכשלות', async () => {
    await prep(async (d) => { await d.doc(P + 'shf/s1').set({ u: E2 }); await d.doc('shf/s1').set({ u: LE }); });
    for (const u of [M1, E1, E2]) {
      for (const c of ['shf', 'shft', 'shfcfg', 'shfsent']) {
        await assertFails(fs(u).doc(P + c + '/s1').get());
        await assertFails(fs(u).collection(P + c).get());
        await assertFails(fs(u).doc(P + c + '/n1').set({ u }));
      }
    }
    for (const u of [LM, LE]) for (const c of ['shf', 'shft', 'shfcfg', 'shfsent']) {
      await assertFails(fs(u).doc(c + '/s1').get());
      await assertFails(fs(u).doc(c + '/n1').set({ u }));
    }
  });
});

describe('shApi – משמרת קבועה: רק הפעם / מכאן והלאה', () => {
  beforeEach(seed);
  it('"רק הפעם": השבוע שונה, השבוע הבא לא השתנה; "מכאן והלאה": שבועות קודמים לא השתנו', async () => {
    const D = workDay(), W0 = SC.weekStart(D), W1 = SC.addDays(W0, 7), W2 = SC.addDays(W0, 14);
    const s = await call(M1, { op: 'save', d: D, s: '08:00', e: '14:00', fx: true, u: E2 });
    assert.ok(s.ok, s.msg);
    const id = s.r.id;
    const week = async (from) => (await call(M1, { op: 'week', from })).r.occ.map((o) => [o.day, o.s, o.e, o.u]);
    const [b0, b1, b2] = [await week(W0), await week(W1), await week(W2)];
    assert.equal(b1.length, 1);
    const D1 = SC.addDays(D, 7), D2 = SC.addDays(D, 14);
    const one = await call(M1, { op: 'save', id, day: D1, mode: 'one', d: D1, s: '10:00', e: '16:00', fx: true, u: E1 });
    assert.ok(one.ok, one.msg);
    assert.deepEqual(await week(W1), [[D1, '10:00', '16:00', E1]]);
    assert.deepEqual(await week(W0), b0);
    assert.deepEqual(await week(W2), b2);
    const nd = await get(P + 'shf/' + one.r.id);
    assert.equal(nd.of, id);
    assert.equal(nd.fx, false);
    const fwd = await call(M1, { op: 'save', id, day: D2, mode: 'fwd', d: D2, s: '20:00', e: '02:00', fx: true, u: E2 });
    assert.ok(fwd.ok, fwd.msg);
    assert.deepEqual(await week(W0), b0);
    assert.deepEqual(await week(W1), [[D1, '10:00', '16:00', E1]]);
    assert.deepEqual(await week(W2), [[D2, '20:00', '02:00', E2]]);
    assert.equal((await get(P + 'shf/' + id)).to, SC.addDays(D2, -1));
    assert.equal((await call(M1, { op: 'save', id, day: D2, d: D2, s: '08:00', e: '12:00', fx: true })).reason, 'no-occ');
    assert.equal((await call(M1, { op: 'save', id: fwd.r.id, day: D2, d: D2, s: '08:00', e: '12:00', fx: true })).reason, 'bad-mode');
    // מחיקה "מכאן והלאה" – ההגדרה נשארת (to), השבוע שלפני לא השתנה
    assert.ok((await call(M1, { op: 'del', id: fwd.r.id, day: SC.addDays(D2, 7), mode: 'fwd' })).ok);
    assert.equal((await week(SC.addDays(W2, 7))).length, 0);
    assert.deepEqual(await week(W2), [[D2, '20:00', '02:00', E2]]);
    assert.ok(await get(P + 'shf/' + fwd.r.id));
  });
});

describe('shTick – משימות, תזכורת, חורים', () => {
  beforeEach(seed);
  it('משימה למשמרת: נשמרת בהמתנה, מוסתרת מהעובד, ונוצרת ב-tasks רק כשהמשמרת מתחילה – פעם אחת', async () => {
    const D = workDay();
    const s = await call(E1, { op: 'save', d: D, s: '10:00', e: '18:00', fx: false, u: E2 });
    const occ = s.r.id + '_' + D;
    const t = await call(E1, { op: 'task', occ, txt: 'לסדר מדף' });
    assert.ok(t.ok, t.msg);
    assert.equal(t.r.st, 'wait');
    assert.equal((await call(E1, { op: 'task', occ: s.r.id + '_' + SC.addDays(D, 1), txt: 'x' })).reason, 'no-occ');
    const w2 = await call(E2, { op: 'week', from: SC.weekStart(D) });
    assert.equal(w2.r.tasks, undefined);
    assert.deepEqual((await call(M1, { op: 'week', from: SC.weekStart(D) })).r.tasks[occ].map((x) => x.txt), ['לסדר מדף']);
    await tick(IL(D, '09:55'));
    assert.equal((await list(P + 'tasks')).length, 1, 'רק המשימה הקיימת');
    for (let i = 0; i < 3; i++) await tick(IL(D, '10:00') + i * 600000);
    const tk = await get(P + 'tasks/sh-' + t.r.id);
    assert.ok(tk);
    assert.deepEqual([tk.to, tk.toN, tk.ow, tk.role, tk.st, tk.open, tk.rc], [[E2], ['יוסי'], E2, 'a', 'open', '1', undefined]);
    assert.equal(tk.owner, E1);
    assert.equal((await list(P + 'tasks')).length, 2);
    assert.equal((await get(P + 'shft/' + t.r.id)).st, 'rel');
    assert.equal((await call(M1, { op: 'taskDel', id: t.r.id })).reason, 'released');
    assert.deepEqual(await get(P + 'tasks/old1'), { owner: M1, by: 'm1', role: 'a', txt: 'משימה קיימת', cr: 1, due: 2, st: 'open', open: '1', to: [E2], toN: ['יוסי'] });
  });
  it('עובד עם shf לא רואה משימות שממתינות במשמרת שלו; מחיקת משמרת מבטלת את המשימות שלה', async () => {
    const D = workDay();
    const s = await call(M1, { op: 'save', d: D, s: '10:00', e: '18:00', fx: false, u: E1 });
    const occ = s.r.id + '_' + D;
    const t = await call(M1, { op: 'task', occ, txt: 'הפתעה' });
    assert.equal((await call(E1, { op: 'week', from: SC.weekStart(D) })).r.tasks[occ], undefined);
    assert.ok((await call(M1, { op: 'del', id: s.r.id })).ok);
    assert.equal((await get(P + 'shft/' + t.r.id)).st, 'cx');
    await tick(IL(D, '10:05'));
    assert.equal(await get(P + 'tasks/sh-' + t.r.id), null);
  });
  it('תזכורת אחת לעובד שעה לפני (גם אחרי 3 ריצות); בלי עובד – בלי תזכורת', async () => {
    const D = workDay();
    await call(M1, { op: 'save', d: D, s: '10:00', e: '18:00', fx: true, u: E2 });
    await call(M1, { op: 'save', d: D, s: '10:00', e: '12:00', fx: false });
    await tick(IL(D, '08:55'));
    assert.equal(PUSH.length, 0);
    for (let i = 0; i < 3; i++) await tick(IL(D, '09:05') + i * 600000);
    assert.equal(PUSH.length, 1);
    assert.deepEqual([PUSH[0].uid, PUSH[0].tokens, PUSH[0].msg.k], [E2, ['tokE2'], 'sh']);
    assert.match(PUSH[0].msg.body, /10:00/);
  });
  it('התראת חורים: אחת ב-07:00, למנהלים בלבד, עם הטווחים; בלי שעות פעילות – כלום; שבת – כלום', async () => {
    const D = workDay();
    await call(M1, { op: 'save', d: D, s: '08:00', e: '12:00', fx: false, u: E2 });
    const hp = () => PUSH.filter((p) => /^h/.test(String(p.msg.id))); // בלי תזכורת המשמרת של 08:00
    await tick(IL(D, '07:05'));
    assert.equal(hp().length, 0, 'בלי שעות פעילות');
    assert.ok((await call(M1, { op: 'setCfg', hrs: HRS })).ok);
    await tick(IL(D, '06:55'));
    assert.equal(hp().length, 0);
    for (let i = 0; i < 3; i++) await tick(IL(D, '07:05') + i * 600000);
    const h = hp();
    assert.equal(h.length, 1);
    assert.deepEqual([h[0].uid, h[0].msg.k], [M1, 'sh']);
    assert.equal(h[0].msg.body, '12:00–20:00');
    // שבת: גם תזכורת וגם חורים – לא נשלחים
    PUSH = [];
    const S = SC.addDays(D, 6 - SC.weekdayOf(D));
    await call(M1, { op: 'save', d: S, s: '10:00', e: '12:00', fx: false, u: E2 });
    const hrs = HRS.slice(); hrs[6] = { s: '08:00', e: '20:00' };
    await call(M1, { op: 'setCfg', hrs });
    await tick(IL(S, '07:05'));
    await tick(IL(S, '09:05'));
    assert.equal(PUSH.length, 0);
  });
});

describe('legacy – לארג\' פעמי בשורש', () => {
  beforeEach(seed);
  it('משמרת נשמרת בשורש (shf), והמשימה נוצרת ב-tasks שבשורש', async () => {
    const D = workDay();
    const s = await call(LM, { op: 'save', d: D, s: '10:00', e: '18:00', fx: false, u: LE });
    assert.ok(s.ok, s.msg);
    assert.ok(await get('shf/' + s.r.id));
    const t = await call(LM, { op: 'task', occ: s.r.id + '_' + D, txt: 'בדיקה' });
    await tick(IL(D, '10:05'));
    assert.deepEqual((await get('tasks/sh-' + t.r.id)).to, [LE]);
  });
});
