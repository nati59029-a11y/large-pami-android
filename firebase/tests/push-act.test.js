'use strict';
// כפתורים בהתראת הטלפון (16.11.2026): pushAct ("טופל" / "הזכר לי מחר" / "בעוד שעה"), אסימון חד־פעמי ב-pact/{sha256}, צורת ההודעה לטלפון ישן ולטלפון עם כפתורים.
// חלק א' – פונקציות טהורות (בלי אמולטור): parseBody, tkPlan, fcmPayload.
// חלק ב' – מול האמולטור (חלק מ-test:multibiz:3): הליבה (push-act._core.act / handle) נקראת ישירות עם זמן קבוע, שם מדומה (nameOf) ושליחה מדומה (אין FCM אמיתי).
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const PA = require('../functions/push-act.js')._core;
const RMC = require('../functions/secretary-remind.js')._core;
const EMU = !!process.env.FIRESTORE_EMULATOR_HOST;

// ---------------------------------------------------------------------------------
describe('pushAct – פונקציות טהורות', () => {
  const T43 = 'A'.repeat(43), F = 'fcm_' + 'b'.repeat(40);
  const rq = (body, ct, raw) => ({ headers: { 'content-type': ct === undefined ? 'application/json' : ct }, body, rawBody: raw });
  it('parseBody: רק JSON, אסימון בפורמט, פעולה מוכרת, מזהה טלפון תקין, גוף קטן', () => {
    assert.deepEqual(PA.parseBody(rq({ t: T43, a: 'done', f: F })), { t: T43, a: 'done', f: F });
    assert.deepEqual(PA.parseBody(rq({ t: T43, a: 'h1', f: F }, 'application/json; charset=utf-8')), { t: T43, a: 'h1', f: F });
    assert.equal(PA.parseBody(rq({ t: T43, a: 'done', f: F }, 'text/plain')), null);
    assert.equal(PA.parseBody(rq({ t: T43.slice(1), a: 'done', f: F })), null, 'אסימון קצר');
    assert.equal(PA.parseBody(rq({ t: T43, a: 'open', f: F })), null, 'פעולה לא מוכרת');
    assert.equal(PA.parseBody(rq({ t: T43, a: 'done', f: 'x' })), null, 'מזהה טלפון קצר');
    assert.equal(PA.parseBody(rq({ t: T43, a: 'done', f: F + '<' })), null);
    assert.equal(PA.parseBody(rq([T43])), null);
    assert.equal(PA.parseBody(rq({ t: T43, a: 'done', f: F }, 'application/json', Buffer.alloc(7000))), null, 'גוף גדול');
  });
  it('tkPlan: אותם כללים כמו "✓ בוצע" באפליקציה ו-workerUpd בחוקים', () => {
    const now = 1_800_000_000_000;
    const t = (o) => Object.assign({ st: 'open', open: '1', ow: 'u1', pr: '', np: 0, nc: '', due: now + 1000 }, o);
    assert.deepEqual(PA.tkPlan(t(), 'u1', false, 'dana', now).patch, { st: 'done', open: '', sub: now, ok: now, doneBy: 'dana', late: '' });
    assert.equal(PA.tkPlan(t({ due: now - 1 }), 'u1', false, 'dana', now).patch.late, '1', 'עבר היעד (due) – באיחור');
    assert.equal(PA.tkPlan(t({ due: now - 1, dl: now + 5 }), 'u1', false, 'd', now).patch.late, '', 'dl גובר על due');
    assert.equal(PA.tkPlan(t({ ck: ['a', 'b'], ckd: [0] }), 'u1', false, 'd', now).r, 'open-app', 'רשימת סימון שלא הושלמה – באפליקציה');
    assert.equal(PA.tkPlan(t({ ck: ['a', 'b'], ckd: [1, 0] }), 'u1', false, 'd', now).r, 'done', 'רשימה שהושלמה – נסגר');
    assert.equal(PA.tkPlan(t({ dl: 0, due: now - 1 }), 'u1', false, 'd', now).patch.late, '', 'dl=0 – בלי יעד');
    assert.equal(PA.tkPlan(t({ dl: now - 5 }), 'u1', false, 'd', now).patch.late, '1');
    assert.deepEqual(PA.tkPlan(t({ nc: '1' }), 'u1', false, 'dana', now).patch, { st: 'wait', sub: now, doneBy: 'dana' }, 'הערת עובד – לאישור המנהל');
    assert.equal(PA.tkPlan(t({ nc: '1' }), 'u1', true, 'dana', now).patch.st, 'done', 'מנהל – כמו באפליקציה');
    assert.equal(PA.tkPlan(t({ pr: '1' }), 'u1', false, 'd', now).r, 'open-app');
    assert.equal(PA.tkPlan(t({ np: 2 }), 'u1', false, 'd', now).r, 'open-app');
    assert.equal(PA.tkPlan(t({ ow: '' }), 'u1', false, 'd', now).r, 'open-app', 'משימה קבוצתית שלא נתפסה');
    assert.equal(PA.tkPlan(t({ ow: 'u2' }), 'u1', false, 'd', now).r, 'not-owner');
    assert.equal(PA.tkPlan(t({ st: 'done' }), 'u1', false, 'd', now).r, 'closed');
    assert.equal(PA.tkPlan(t({ st: 'wait' }), 'u1', false, 'd', now).r, 'closed');
    assert.equal(PA.tkPlan(null, 'u1', false, 'd', now).r, 'closed');
    assert.equal(PA.tkPlan(t(), 'u1', false, '', now).r, 'open-app', 'בלי שם (doneBy) – באפליקציה');
  });
  it('fcmPayload: טלפון ישן – בדיוק ההודעה של היום; טלפון עם כפתורים – data בלבד, priority high, עם אסימון, פעולות וכתובת', () => {
    const msg = { title: 'תזכורת: לבדוק', body: 'פרטים', id: 'n1' };
    assert.deepEqual(RMC.fcmPayload(['a'], msg, { data: { k: 'sec', v: 'notes' }, tag: 'sec_n1' }), {
      tokens: ['a'], notification: { title: 'תזכורת: לבדוק', body: 'פרטים' }, data: { k: 'sec', v: 'notes', id: 'n1' },
      android: { priority: 'high', notification: { visibility: 'private', tag: 'sec_n1' } },
    });
    assert.deepEqual(RMC.fcmPayload(['a'], { title: 'x', body: 'y' }, { data: { k: 'sec', v: 'notes' }, tag: '' }).data, { k: 'sec', v: 'notes' }, 'בלי מזהה – כמו קודם');
    assert.deepEqual(RMC.fcmPayload(['a'], { title: 'ת', body: 'ב', id: 't1' }, { data: { k: 'tk' }, tag: 'tk_t1' }), {
      tokens: ['a'], notification: { title: 'ת', body: 'ב' }, data: { k: 'tk', id: 't1' }, android: { priority: 'high', notification: { visibility: 'private', tag: 'tk_t1' } },
    });
    const p = RMC.fcmPayload(['b'], Object.assign({ act: { at: 'T'.repeat(43), acts: 'done,h1,d1', u: 'https://x/pushAct' } }, msg), { data: { k: 'sec', v: 'notes' }, tag: 'sec_n1' });
    assert.equal(p.notification, undefined, 'data בלבד – הטלפון בונה את ההתראה');
    assert.deepEqual(p.android, { priority: 'high' });
    assert.deepEqual(p.data, { k: 'sec', v: 'notes', id: 'n1', title: 'תזכורת: לבדוק', body: 'פרטים', tag: 'sec_n1', at: 'T'.repeat(43), acts: 'done,h1,d1', u: 'https://x/pushAct' });
    assert.ok(Object.values(p.data).every((v) => typeof v === 'string'), 'FCM: כל ערכי data מחרוזות');
  });
  it('urlOf: us-central1 בלבד, /pushAct', () => {
    assert.match(PA.urlOf({ project: 'p1' }), /^(https:\/\/us-central1-p1\.cloudfunctions\.net|http:\/\/[^/]+\/p1\/us-central1)\/pushAct$/);
  });
});

// ---------------------------------------------------------------------------------
describe('pushAct – מול האמולטור', { skip: !EMU && 'אמולטור Firestore לא רץ' }, () => {
  const A = 'biz-pa', B = 'biz-pb';
  const M1 = 'pa_m1', M2 = 'pa_m2', E1 = 'pa_e1', E2 = 'pa_e2', EOFF = 'pa_off', MB = 'pa_mb';
  const F = (u, n) => 'fcm' + u + '_' + (n || 'a') + '_'.repeat(25);
  const NOW = Date.parse('2026-11-16T10:00:00+02:00');
  let env, T, RS, NG, SEC, BIZA;
  const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
  async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
  const nameOf = async (uid) => uid.replace(/^pa_/, ''); // במקום getAuth().getUser – החלק שלפני @
  const press = (t, a, f, now) => PA.act({ t, a, f }, { now: now || NOW, nameOf });
  const mk = (o) => PA.mkAct(Object.assign({ bizId: A, now: NOW }, o));
  const task = (o) => Object.assign({ owner: M1, by: M1, role: 'a', txt: 'לסדר את המדף', cr: NOW - 3600e3, due: NOW + 86400e3, st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '', to: [E1], toN: ['e1'], ow: E1, owN: 'e1', clt: NOW, np: 0, wp: 0, mi: 0 }, o);
  const note = (o) => Object.assign({ k: 'rem', typ: 'cal', key: 'k', title: 'תזכורת', body: 'גוף', t: NOW - 1000, at: NOW - 1000, pend: false, pushAt: NOW, n: 1, rep: 0, st: 'open', seen: false }, o);

  before(async () => {
    env = await H.getEnv(); require('../functions/index.js');
    T = require('../functions/lib/tenant.js'); RS = require('../functions/lib/roles.js'); NG = require('../functions/tasks-nudge.js')._core; SEC = require('../functions/secretary.js')._core;
  });
  after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
  beforeEach(async () => {
    await env.clearFirestore();
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { tasks: true, secretary: true } });
      b.set(d.doc('b/' + B), { name: B, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { tasks: true, secretary: true } });
      b.set(d.doc(`b/${A}/admins/${M1}`), { email: 'm1@x.invalid' });
      b.set(d.doc(`b/${A}/staff/${M1}`), { name: 'מנהל', role: 'manager', active: true, pushTokens: [F(M1), F(M1, 'b')], pushAct: [F(M1)] });
      b.set(d.doc(`b/${A}/admins/${M2}`), { email: 'm2@x.invalid' });
      b.set(d.doc(`b/${A}/push_tokens/${M2}`), { pushTokens: [F(M2)], pushAct: [F(M2)] });
      b.set(d.doc(`b/${A}/staff/${E1}`), { name: 'e1', role: 'employee', active: true, pushTokens: [F(E1), F(E1, 'old')], pushAct: [F(E1)] });
      b.set(d.doc(`b/${A}/staff/${E2}`), { name: 'e2', role: 'employee', active: true, pushTokens: [F(E2)], pushAct: [F(E2)] });
      b.set(d.doc(`b/${A}/staff/${EOFF}`), { name: 'off', role: 'employee', active: false, pushTokens: [F(EOFF)] });
      b.set(d.doc(`b/${B}/admins/${MB}`), { email: 'mb@x.invalid' });
      b.set(d.doc(`b/${B}/staff/${MB}`), { name: 'mb', role: 'manager', active: true, pushTokens: [F(MB)] });
      for (const [u, biz, role] of [[M1, A, 'admin'], [M2, A, 'admin'], [E1, A, 'worker'], [E2, A, 'worker'], [EOFF, A, 'worker'], [MB, B, 'admin']]) b.set(d.doc('users/' + u), { bizId: biz, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
      b.set(d.doc(`b/${A}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: true, pay: {}, mgr: { [M1]: { cv: SEC.CONSENT_VER, ca: 1 }, [M2]: { cv: SEC.CONSENT_VER, ca: 1 } } });
      b.set(d.doc(`b/${A}/sec_note/${M1}/n/n1`), note({}));
      b.set(d.doc(`b/${A}/sec_note/${M1}/n/n2`), note({ title: 'אחרת' }));
      b.set(d.doc(`b/${A}/tasks/t1`), task({}));
      await b.commit();
    });
    BIZA = await T.loadBiz(A);
  });

  // ---------- המזכירה ----------
  it('sec "טופל": ההתראה נסגרת בדיוק כמו "טופל" באפליקציה, נרשם ביומן (מקור push), האסימון משומש; האסימון לא במסד – רק הגיבוב', async () => {
    const x = await mk({ uid: M1, kind: 'sec', id: 'n1', acts: ['done', 'h1', 'd1'] });
    assert.match(x.token, PA.TOKEN_RE);
    assert.match(x.u, /\/pushAct$/);
    const p0 = await get('pact/' + PA.hashOf(x.token));
    assert.deepEqual({ biz: p0.biz, uid: p0.uid, kind: p0.kind, id: p0.id, acts: p0.acts, exp: p0.exp }, { biz: A, uid: M1, kind: 'sec', id: 'n1', acts: ['done', 'h1', 'd1'], exp: NOW + 7 * 864e5 });
    assert.ok(!JSON.stringify(p0).includes(x.token));
    const r = await press(x.token, 'done', F(M1));
    assert.deepEqual(r, { ok: true, r: 'done', msg: '✓ טופל' });
    const n = await get(`b/${A}/sec_note/${M1}/n/n1`);
    assert.equal(n.st, 'done'); assert.equal(n.pend, false); assert.equal(n.seen, true);
    assert.equal((await get(`b/${A}/sec_note/${M1}/n/n2`)).st, 'open', 'אסימון של פריט אחד לא נוגע בפריט אחר');
    assert.equal((await get('pact/' + PA.hashOf(x.token))).used, NOW);
    let logs = []; await prep(async (d) => { logs = (await d.collection(`b/${A}/sec_log`).get()).docs.map((s) => s.data()); });
    assert.ok(logs.some((l) => l.act === 'remDone' && l.tgt === 'n1' && l.note === 'push'));
    // שוב – כבר בוצע
    assert.equal((await press(x.token, 'done', F(M1))).r, 'used');
  });
  it('sec "בעוד שעה" / "מחר": snooze הקיים, עכשיו+שעה ועכשיו+24 שעות; התראה שכבר לא רלוונטית – "כבר סגורה"', async () => {
    const h = await mk({ uid: M1, kind: 'sec', id: 'n1', acts: ['done', 'h1', 'd1'] });
    assert.deepEqual(await press(h.token, 'h1', F(M1)), { ok: true, r: 'h1', msg: 'נדחה לעוד שעה' });
    let n = await get(`b/${A}/sec_note/${M1}/n/n1`);
    assert.equal(n.at, Math.floor((NOW + 3600e3) / 60e3) * 60e3); assert.equal(n.pend, true); assert.equal(n.pushAt, n.at);
    const d1 = await mk({ uid: M1, kind: 'sec', id: 'n2', acts: ['done', 'h1', 'd1'] });
    assert.deepEqual(await press(d1.token, 'd1', F(M1)), { ok: true, r: 'd1', msg: 'נדחה למחר' });
    n = await get(`b/${A}/sec_note/${M1}/n/n2`);
    assert.equal(n.at, Math.floor((NOW + 864e5) / 60e3) * 60e3);
    await prep((d) => d.doc(`b/${A}/sec_note/${M1}/n/n1`).update({ st: 'gone' }));
    const g = await mk({ uid: M1, kind: 'sec', id: 'n1', acts: ['done', 'h1', 'd1'] });
    assert.equal((await press(g.token, 'h1', F(M1))).msg, 'המשימה כבר סגורה');
    assert.equal((await get('pact/' + PA.hashOf(g.token))).used, undefined, 'פעולה שלא בוצעה – האסימון משתחרר');
  });
  it('נדחה: אסימון שפג, לא קיים, פעולה שלא ברשימה, טלפון שלא של המשתמש', async () => {
    const old = await mk({ uid: M1, kind: 'sec', id: 'n1', acts: ['done'], now: NOW - 8 * 864e5 });
    assert.equal((await press(old.token, 'done', F(M1))).r, 'expired');
    assert.equal((await press('Z'.repeat(43), 'done', F(M1))).r, 'no-token');
    const x = await mk({ uid: M1, kind: 'sec', id: 'n1', acts: ['done'] });
    assert.equal((await press(x.token, 'h1', F(M1))).r, 'bad-act');
    assert.equal((await press(x.token, 'done', F(E1))).r, 'bad-device', 'טלפון של עובד אחר');
    assert.equal((await press(x.token, 'done', F('zz'))).r, 'bad-device', 'טלפון לא רשום');
    assert.equal((await get(`b/${A}/sec_note/${M1}/n/n1`)).st, 'open');
    assert.equal((await get('pact/' + PA.hashOf(x.token))).used, undefined);
    // הטלפון השני של המנהל (גם בלי כפתורים) – רשום לו, ולכן מותר
    assert.equal((await press(x.token, 'done', F(M1, 'b'))).ok, true);
  });
  it('שתי לחיצות במקביל – רק אחת עוברת (sec ו-tk)', async () => {
    const x = await mk({ uid: M1, kind: 'sec', id: 'n1', acts: ['done', 'h1', 'd1'] });
    const rs = await Promise.all([press(x.token, 'done', F(M1)), press(x.token, 'h1', F(M1)), press(x.token, 'd1', F(M1))]);
    assert.equal(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs));
    const y = await mk({ uid: E1, kind: 'tk', id: 't1', acts: ['done'] });
    const ts = await Promise.all([press(y.token, 'done', F(E1)), press(y.token, 'done', F(E1))]);
    assert.equal(ts.filter((r) => r.ok).length, 1, JSON.stringify(ts));
  });
  it('הרשאה נבדקת מחדש: מנהל שההסכמה שלו בוטלה / לא המנהל הראשי / תוספת כבויה / עסק מושהה – נחסם; עובד מושבת – נחסם', async () => {
    const x = await mk({ uid: M1, kind: 'sec', id: 'n1', acts: ['done'] });
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).update({ [`mgr.${M1}.cv`]: 'old-ver' }));
    assert.deepEqual(await press(x.token, 'done', F(M1)), { ok: false, r: 'no-consent', msg: 'אין הרשאה. פתחו את האפליקציה', open: true });
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).update({ [`mgr.${M1}.cv`]: SEC.CONSENT_VER, mode: 'main', mainUid: M2 }));
    assert.equal((await press(x.token, 'done', F(M1))).r, 'not-main-manager');
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).update({ mode: 'all' }));
    await prep((d) => d.doc('b/' + A).update({ 'features.secretary': false }));
    assert.equal((await press(x.token, 'done', F(M1))).r, 'feature-off');
    await prep((d) => d.doc('b/' + A).update({ 'features.secretary': true, status: 'suspended' }));
    assert.notEqual((await press(x.token, 'done', F(M1))).ok, true, 'עסק מושהה');
    await prep((d) => d.doc('b/' + A).update({ status: 'active' }));
    assert.equal((await get(`b/${A}/sec_note/${M1}/n/n1`)).st, 'open');
    assert.equal((await press(x.token, 'done', F(M1))).ok, true, 'אחרי החזרה – עובד');
    const y = await mk({ uid: EOFF, kind: 'tk', id: 't1', acts: ['done'] });
    assert.equal((await press(y.token, 'done', F(EOFF))).r, 'staff-disabled');
    // אסימון של עסק אחר לא עוזר: המשתמש שייך לעסק B
    const z = await mk({ uid: MB, kind: 'sec', id: 'n1', acts: ['done'] });
    assert.equal((await press(z.token, 'done', F(MB))).r, 'foreign-biz');
  });

  // ---------- משימות ----------
  it('tk "טופל": רגילה – done (sub, ok, doneBy, late), בזמן ובאיחור; האסימון משומש', async () => {
    const x = await mk({ uid: E1, kind: 'tk', id: 't1', acts: ['done'] });
    assert.deepEqual(await press(x.token, 'done', F(E1)), { ok: true, r: 'done', msg: '✓ טופל' });
    const t = await get(`b/${A}/tasks/t1`);
    assert.deepEqual({ st: t.st, open: t.open, sub: t.sub, ok: t.ok, doneBy: t.doneBy, late: t.late }, { st: 'done', open: '', sub: NOW, ok: NOW, doneBy: 'e1', late: '' });
    assert.equal(t.img, '', 'שדות אחרים לא משתנים');
    await prep((d) => d.doc(`b/${A}/tasks/t1`).set(task({ due: NOW - 1000 })));
    const y = await mk({ uid: E1, kind: 'tk', id: 't1', acts: ['done'] });
    await press(y.token, 'done', F(E1));
    assert.equal((await get(`b/${A}/tasks/t1`)).late, '1', 'באיחור');
  });
  it('tk: הערת עובד (nc) – לאישור המנהל; תמונה נדרשת (pr / np) – "פתחו את האפליקציה"; לא שלו; סגורה; קבוצתית בלי מטפל', async () => {
    const run = async (o, uid) => { await prep((d) => d.doc(`b/${A}/tasks/t1`).set(task(o))); const x = await mk({ uid: uid || E1, kind: 'tk', id: 't1', acts: ['done'] }); return press(x.token, 'done', F(uid || E1)); };
    assert.deepEqual(await run({ nc: '1' }), { ok: true, r: 'wait', msg: 'נשלח לאישור המנהל' });
    const w = await get(`b/${A}/tasks/t1`);
    assert.deepEqual({ st: w.st, open: w.open, sub: w.sub, doneBy: w.doneBy, ok: w.ok, late: w.late }, { st: 'wait', open: '1', sub: NOW, doneBy: 'e1', ok: 0, late: '' });
    assert.deepEqual(await run({ pr: '1' }), { ok: false, r: 'open-app', msg: 'פתחו את האפליקציה כדי לסיים', open: true });
    assert.equal((await get(`b/${A}/tasks/t1`)).st, 'open');
    assert.equal((await run({ np: 1 })).r, 'open-app');
    assert.equal((await run({ ow: E2, owN: 'e2' })).r, 'not-owner');
    assert.equal((await run({ st: 'done' })).msg, 'המשימה כבר סגורה');
    assert.equal((await run({ ow: '', owN: '', to: [E1, E2] })).r, 'open-app');
    // קבוצתית – האסימון נוצר בלי "טופל" (acts ריק): "טופל" מחזיר "פתחו את האפליקציה" עוד לפני כל בדיקה
    const g = await mk({ uid: E1, kind: 'tk', id: 't1', acts: [] });
    assert.equal((await press(g.token, 'done', F(E1))).r, 'open-app');
    assert.equal((await press(g.token, 'h1', F(E1))).r, 'bad-act', '"הזכר לי" במשימה – מקומי בטלפון, לא בשרת');
  });

  // ---------- שליחה ----------
  it('tkNudge: טלפון ישן – ההודעה של היום (בלי act); טלפון עם כפתורים – אסימון אחד, acts "done,h1,d1"; קבוצתית – "open,h1,d1"', async () => {
    const PUSH = [];
    const send = async (tokens, msg, meta) => { PUSH.push({ tokens, msg, meta }); return tokens.map((t) => ({ token: t, ok: true })); };
    const nudge = (uid, data) => T.runInBiz({}, async () => { const who = await RS.requireStaff({ auth: { uid }, data: Object.assign({ bizId: A }, data) }, { feature: 'tasks' }); return NG.nudge(who, data, { send, now: Date.now() }); });
    await prep((d) => d.doc(`b/${A}/tasks/t1`).update({ nd: Date.now() }));
    assert.deepEqual(await nudge(M1, { taskId: 't1' }), { ok: true, n: 1, sent: 1 });
    assert.equal(PUSH.length, 2);
    const old = PUSH.find((p) => !p.msg.act), nw = PUSH.find((p) => p.msg.act);
    assert.deepEqual(old.tokens, [F(E1, 'old')]); assert.deepEqual(old.msg, { id: 't1', title: 'תזכורת מהמנהל', body: 'לסדר את המדף' });
    assert.deepEqual(nw.tokens, [F(E1)]); assert.equal(nw.msg.act.acts, 'done,h1,d1'); assert.match(nw.msg.act.u, /\/pushAct$/);
    const p = await get('pact/' + PA.hashOf(nw.msg.act.at));
    assert.deepEqual({ uid: p.uid, kind: p.kind, id: p.id, acts: p.acts, biz: p.biz }, { uid: E1, kind: 'tk', id: 't1', acts: ['done'], biz: A });
    assert.equal((await press(nw.msg.act.at, 'done', F(E1), Date.now())).ok, true, 'הכפתור מההתראה עובד');
    // קבוצתית
    PUSH.length = 0;
    await prep((d) => d.doc(`b/${A}/tasks/t2`).set(task({ ow: '', owN: '', to: [E1, E2], toN: ['e1', 'e2'], nd: Date.now() })));
    await nudge(M1, { taskId: 't2' });
    const acts = PUSH.filter((x) => x.msg.act);
    assert.equal(acts.length, 2); assert.ok(acts.every((x) => x.msg.act.acts === 'open,h1,d1'));
    assert.equal(new Set(acts.map((x) => x.msg.act.at)).size, 2, 'אסימון נפרד לכל משתמש');
  });
  it('sendItem (המזכירה): טלפונים ישנים – קריאה אחת כמו היום; טלפונים עם כפתורים – אסימון אחד לפריט למשתמש; תקלה ביצירת האסימון – הודעה רגילה', async () => {
    const PUSH = [];
    const send = async (tokens, msg) => { PUSH.push({ tokens, msg }); return tokens.map((t) => ({ token: t, ok: true })); };
    const C = { bizId: A, prefix: `b/${A}/`, biz: BIZA };
    const toks = await T.runInBiz(C, () => RMC.tokensOf(T.tdb(), M1));
    const actT = new Set(await T.runInBiz(C, () => RMC.tokensAct(T.tdb(), M1)));
    assert.deepEqual([...actT], [F(M1)]);
    const msg = RMC.noteMsg(note({}), 'n1');
    const res = await T.runInBiz(C, () => RMC.sendItem(send, toks, actT, msg, {}, { bizId: A, uid: M1, kind: 'sec', id: 'n1', acts: ['done', 'h1', 'd1'], show: 'done,h1,d1', now: NOW }));
    assert.equal(res.length, 2);
    assert.deepEqual(PUSH[0], { tokens: [F(M1, 'b')], msg });
    assert.deepEqual(PUSH[1].tokens, [F(M1)]); assert.equal(PUSH[1].msg.act.acts, 'done,h1,d1');
    PUSH.length = 0;
    await T.runInBiz(C, () => RMC.sendItem(send, toks, actT, msg, {}, { bizId: 'BAD!', uid: M1, kind: 'sec', id: 'n1', acts: ['done'], show: 'done,h1,d1' }));
    assert.ok(PUSH.every((p) => !p.msg.act), 'בלי אסימון – ההודעה הרגילה לכולם');
    PUSH.length = 0;
    await T.runInBiz(C, () => RMC.sendItem(send, [F(M1, 'b')], new Set(), msg, {}, { bizId: A, uid: M1, kind: 'sec', id: 'n1', acts: ['done'], show: 'done,h1,d1' }));
    assert.equal(PUSH.length, 1, 'בלי טלפונים עם כפתורים – בדיוק קריאה אחת כמו היום');
  });

  // ---------- HTTP וניקוי ----------
  it('handle: רק POST JSON; תשובה JSON עם msg; ניקוי מוחק רק אסימונים שפג תוקפם', async () => {
    const res = () => ({ code: 0, h: {}, body: null, headersSent: false, status(c) { this.code = c; return this; }, set(k, v) { this.h[k] = v; return this; }, json(b) { this.body = b; return this; } });
    let r = res(); await PA.handle({ method: 'GET', headers: {} }, r); assert.equal(r.code, 405);
    r = res(); await PA.handle({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }, r); assert.equal(r.code, 400); assert.equal(r.body.ok, false);
    const x = await mk({ uid: M1, kind: 'sec', id: 'n1', acts: ['done'] });
    r = res(); await PA.handle({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { t: x.token, a: 'done', f: F(M1) } }, r, { now: NOW, nameOf });
    assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true, r: 'done', msg: '✓ טופל' }); assert.equal(r.h['Cache-Control'], 'private, no-store');
    const live = await mk({ uid: M1, kind: 'sec', id: 'n2', acts: ['done'] });
    await mk({ uid: M1, kind: 'sec', id: 'n2', acts: ['done'], now: NOW - 8 * 864e5 });
    assert.equal(await PA.cleanPact(NOW), 1);
    assert.ok(await get('pact/' + PA.hashOf(live.token)), 'אסימון בתוקף נשאר');
  });
  it('דרך אמולטור הפונקציות: POST אמיתי לכתובת pushAct', { skip: !process.env.FUNCTIONS_EMULATOR_HOST && 'אמולטור הפונקציות לא רץ' }, async () => {
    const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
    const url = `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/pushAct`;
    const x = await PA.mkAct({ bizId: A, uid: M1, kind: 'sec', id: 'n1', acts: ['h1'] });
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: x.token, a: 'h1', f: F(M1) }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).msg, 'נדחה לעוד שעה');
    assert.equal((await fetch(url)).status, 405);
  });
});
