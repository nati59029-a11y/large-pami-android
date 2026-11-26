'use strict';
// אישור קבלה בקבוצות (24.11.2026): טלפון עם APK שתומך באישור קבלה (pushRcvAt – רישום עם rcv:1) מקבל על הודעה בקבוצה הודעת data בלבד עם אסימון חד־פעמי (kind 'grp'),
// ושולח ברקע 'rcv' ל-pushAct, שכותב grp/{gid}/r/{uid}.d. טלפון ישן, וגם APK עם כפתורים בלבד – ההודעה הרגילה של היום.
// מול אמולטור Firestore (חלק מ-test:multibiz:3): onMsg עם שליחה מדומה, ו-push-act._core.act נקרא ישירות עם זמן קבוע ושם מדומה.
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const PA = require('../functions/push-act.js')._core;
const RMC = require('../functions/secretary-remind.js')._core;
const EMU = !!process.env.FIRESTORE_EMULATOR_HOST;

describe('pushAct – פעולה rcv (בלי מסד)', () => {
  it('parseBody מקבל rcv; mkAct של קבוצה דורש mt ו-gp', async () => {
    const T43 = 'A'.repeat(43), F = 'fcm_' + 'b'.repeat(40);
    assert.deepEqual(PA.parseBody({ headers: { 'content-type': 'application/json' }, body: { t: T43, a: 'rcv', f: F } }), { t: T43, a: 'rcv', f: F });
    await assert.rejects(PA.mkAct({ bizId: 'biz-ga', uid: 'u1', kind: 'grp', id: 'g1', gp: 'b' }), /bad args/);
    await assert.rejects(PA.mkAct({ bizId: 'biz-ga', uid: 'u1', kind: 'grp', id: 'g1', mt: 5, gp: 'x' }), /bad args/);
  });
});

describe('קבוצות – אישור קבלה מהטלפון (rcv)', { skip: !EMU && 'אמולטור Firestore לא רץ' }, () => {
  const A = 'biz-ga', B = 'biz-gb', OFF = 'biz-gn';
  const F = (u, n) => 'fcm' + u + '_' + (n || 'a') + '_'.repeat(25);
  const NOW = Math.floor(Date.now() / 1000) * 1000;
  const MT = NOW - 5000; // זמן ההודעה
  let env, G;
  const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
  async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
  const nameOf = async (uid) => uid; // במקום getAuth().getUser – החלק שלפני @ במייל
  const rcv = (t, f, now) => PA.act({ t, a: 'rcv', f }, { now: now || NOW, nameOf });
  const mk = (o) => PA.mkAct(Object.assign({ bizId: A, kind: 'grp', id: 'g1', mt: MT, gp: 'b', now: NOW }, o));
  const R = (u, biz) => (biz === null ? '' : 'b/' + (biz || A) + '/') + 'grp/g1/r/' + u;

  before(async () => { env = await H.getEnv(); require('../functions/index.js'); G = require('../functions/grp-notify.js')._core; });
  after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
  beforeEach(async () => {
    await env.clearFirestore();
    const T0 = Date.now() - 60e3;
    const AT = (...ts) => Object.fromEntries(ts.map((t) => [PA.hashOf(t), T0])); // pushActAt: רישום עם act:1 לפני דקה
    await prep(async (d) => {
      const b = d.batch();
      for (const [biz, groups] of [[A, true], [B, true], [OFF, false]]) {
        const P = 'b/' + biz + '/';
        b.set(d.doc('b/' + biz), { name: biz, status: 'active', dataRoot: 'b', features: { tasks: true, groups } });
        b.set(d.doc(P + 'admins/m1'), { email: 'm1@x.invalid' });
        b.set(d.doc(P + 'staff/m1'), { name: 'המנהל', active: true, pushTokens: [F('m1', biz)], pushAct: [F('m1', biz)], pushActAt: AT(F('m1', biz)), pushRcvAt: AT(F('m1', biz)) });
        for (const u of ['e1', 'e3', 'ex']) b.set(d.doc(P + 'staff/' + u), { name: 'עובד ' + u, active: true, pushTokens: [F(u, biz)], pushAct: [F(u, biz)], pushActAt: AT(F(u, biz)), pushRcvAt: AT(F(u, biz)) });
        b.set(d.doc(P + 'staff/e2'), { name: 'עובד e2', active: true, pushTokens: [F('e2', biz)] }); // APK ישן – בלי pushAct
        b.set(d.doc(P + 'grp/g1'), { name: 'משמרת', mem: ['e1', 'e2', 'e3'], ao: false, md: true, by: 'm1', t: 1 });
        b.set(d.doc(P + 'grp/g1/r/e3'), { t: 1, mu: true }); // השתיק
        for (const u of ['m1', 'e1', 'e2', 'e3', 'ex']) b.set(d.doc(PA.devPath(F(u, biz))), { biz, uid: u, t: T0 });
      }
      // לארג' פעמי legacy בשורש (אין b/largpeami)
      b.set(d.doc('admins/rm'), { email: 'rm@x.invalid' });
      b.set(d.doc('staff/r1'), { name: 'דנה', active: true, pushTokens: [F('r1')], pushAct: [F('r1')], pushActAt: AT(F('r1')), pushRcvAt: AT(F('r1')) });
      b.set(d.doc('grp/g1'), { name: 'כולם', mem: ['r1'], ao: false, md: true, by: 'rm', t: 1 });
      b.set(d.doc(PA.devPath(F('r1'))), { biz: 'largpeami', uid: 'r1', t: T0 });
      await b.commit();
    });
  });

  it('onMsg: טלפון עם כפתורים – אסימון grp (בלי כפתורים); טלפון ישן – ההודעה של היום; מושתק והשולח – כלום', async () => {
    const calls = [];
    const send = async (toks, msg, g) => { calls.push({ toks, msg, g }); return toks.map((t) => ({ token: t, ok: true })); };
    const out = await G.onMsg(A, 'g1', 'mx1', { by: 'e1', byN: 'e1', t: MT, k: 't', txt: 'שלום' }, { send, now: NOW });
    assert.equal(out.ok, true);
    const by = (u) => calls.find((c) => c.toks.includes(F(u, A)));
    assert.equal(by('e1'), undefined, 'השולח לא מקבל');
    assert.equal(by('e3'), undefined, 'מי שהשתיק לא מקבל (ולא נוצר לו אסימון)');
    // ישן: בדיוק ההודעה הרגילה
    const old = by('e2');
    assert.deepEqual(old.msg, { title: 'משמרת', body: 'עובד e1: שלום' });
    assert.deepEqual(RMC.fcmPayload(old.toks, Object.assign({ id: 'g1' }, old.msg), { data: { k: 'grp' }, tag: 'grp_g1' }), {
      tokens: [F('e2', A)], notification: { title: 'משמרת', body: 'עובד e1: שלום' }, data: { k: 'grp', id: 'g1' },
      android: { priority: 'high', notification: { visibility: 'private', tag: 'grp_g1' } },
    });
    // עם כפתורים (המנהל m1): data בלבד, אותה כותרת/גוף/tag, acts ריק = בלי כפתורים
    const nw = by('m1');
    assert.match(nw.msg.act.at, PA.TOKEN_RE);
    assert.equal(nw.msg.act.acts, '');
    const p = RMC.fcmPayload(nw.toks, Object.assign({ id: 'g1' }, nw.msg), { data: { k: 'grp' }, tag: 'grp_g1' });
    assert.equal(p.notification, undefined);
    assert.deepEqual(p.android, { priority: 'high' });
    assert.deepEqual(Object.assign({}, p.data, { at: 'X', u: 'U' }), { k: 'grp', id: 'g1', title: 'משמרת', body: 'עובד e1: שלום', tag: 'grp_g1', at: 'X', acts: '', u: 'U' });
    assert.ok(Object.values(p.data).every((v) => typeof v === 'string'));
    const pd = await get('pact/' + PA.hashOf(nw.msg.act.at));
    assert.deepEqual({ biz: pd.biz, uid: pd.uid, kind: pd.kind, id: pd.id, acts: pd.acts, mt: pd.mt, gp: pd.gp, exp: pd.exp }, { biz: A, uid: 'm1', kind: 'grp', id: 'g1', acts: ['rcv'], mt: MT, gp: 'b', exp: NOW + 48 * 3600e3 });
    assert.ok(!JSON.stringify(pd).includes(nw.msg.act.at), 'רק הגיבוב נשמר');
  });

  it('APK עם כפתורים בלבד (pushActAt בלי pushRcvAt) – ההודעה הרגילה של היום, ולא נוצר מסמך pact', async () => {
    const T0 = Date.now() - 60e3;
    await prep((d) => d.doc('b/' + A + '/staff/m1').update({ pushRcvAt: {} }));
    // pushRcvAt ישן מ-pushActAt (רישום act:1 אחר כך בלי rcv שלא נמחק) – גם לא
    await prep((d) => d.doc('b/' + A + '/staff/e1').update({ pushRcvAt: { [PA.hashOf(F('e1', A))]: T0 - 1000 } }));
    const calls = [];
    const send = async (toks, msg, g) => { calls.push({ toks, msg, g }); return toks.map((t) => ({ token: t, ok: true })); };
    const out = await G.onMsg(A, 'g1', 'mx2', { by: 'e3', byN: 'e3', t: MT, k: 't', txt: 'היי' }, { send, now: NOW, cmt: false });
    assert.equal(out.ok, true);
    for (const u of ['m1', 'e1']) {
      const c = calls.find((x) => x.toks.includes(F(u, A)));
      assert.ok(c, 'קיבל התראה: ' + u);
      assert.deepEqual(c.msg, { title: 'משמרת', body: 'עובד e3: היי' }, 'בלי act: ' + u);
      assert.deepEqual(RMC.fcmPayload(c.toks, Object.assign({ id: 'g1' }, c.msg), { data: { k: 'grp' }, tag: 'grp_g1' }).notification, { title: 'משמרת', body: 'עובד e3: היי' });
    }
    let n = -1;
    await prep(async (d) => { n = (await d.collection('pact').get()).size; });
    assert.equal(n, 0, 'לא נוצר אסימון');
  });

  it('טלפון עם אישור קבלה – הודעת data עם אסימון; נמען שכבר קיבל / קרא (r.d או r.t >= t) – ההודעה הרגילה, בלי אסימון', async () => {
    await prep(async (d) => { await d.doc(R('m1')).set({ d: MT }); await d.doc('b/' + A + '/grp/g1').update({ ao: true }); });
    const calls = [];
    const send = async (toks, msg, g) => { calls.push({ toks, msg, g }); return toks.map((t) => ({ token: t, ok: true })); };
    await G.onMsg(A, 'g1', 'mx3', { by: 'e3', byN: 'e3', t: MT, k: 't', txt: 'א' }, { send, now: NOW, cmt: false });
    const by = (u) => calls.find((x) => x.toks.includes(F(u, A)));
    assert.equal(by('m1').msg.act, undefined, 'כבר התקבלה – בלי אסימון');
    assert.match(by('e1').msg.act.at, PA.TOKEN_RE, 'e1 – אסימון (אין לו r)');
    let n = -1;
    await prep(async (d) => { n = (await d.collection('pact').get()).size; });
    assert.equal(n, 1);
    // הודעה חדשה יותר – שוב אסימון; r.t >= t – בלי
    calls.length = 0;
    await prep((d) => d.doc(R('e1')).set({ t: MT + 10 }));
    await G.onMsg(A, 'g1', 'mx4', { by: 'e3', byN: 'e3', t: MT + 10, k: 't', txt: 'ב' }, { send, now: NOW, cmt: false });
    assert.match(by('m1').msg.act.at, PA.TOKEN_RE, 'הודעה חדשה מ-r.d – אסימון');
    assert.equal(by('e1').msg.act, undefined, 'r.t >= t – בלי אסימון');
  });

  it('אסימון תקין: מסמך חדש – d, u, n בלבד; שימוש חוזר – נדחה', async () => {
    const x = await mk({ uid: 'e1' });
    assert.deepEqual(await rcv(x.token, F('e1', A)), { ok: true, r: 'rcv', msg: '' });
    assert.deepEqual(await get(R('e1')), { d: MT, u: NOW, n: 'e1' });
    assert.equal((await get('pact/' + PA.hashOf(x.token))).used, NOW);
    assert.equal((await rcv(x.token, F('e1', A), NOW + 1000)).r, 'used');
  });

  it('d לא יורד; t, mu, n לא משתנים; d = max(d, t, mt)', async () => {
    await prep((d) => d.doc(R('e3')).set({ t: MT + 500, d: 0, mu: true, n: 'x', u: 7 }));
    assert.equal((await rcv((await mk({ uid: 'e3' })).token, F('e3', A))).ok, true);
    assert.deepEqual(await get(R('e3')), { t: MT + 500, d: MT + 500, mu: true, n: 'x', u: NOW }, 't גבוה מ-mt – d = t');
    await prep((d) => d.doc(R('e2')).set({ t: 3, d: MT + 9000, u: NOW + 60e3, n: 'e2' }));
    assert.equal((await rcv((await mk({ uid: 'e2' })).token, F('e2', A))).ok, true);
    assert.deepEqual(await get(R('e2')), { t: 3, d: MT + 9000, u: NOW + 60e3, n: 'e2' }, 'd גבוה יותר – לא נוגעים בכלל');
    await prep((d) => d.doc(R('e1')).set({ t: 3, d: MT - 100, u: NOW + 60e3 }));
    assert.equal((await rcv((await mk({ uid: 'e1' })).token, F('e1', A))).ok, true);
    assert.deepEqual(await get(R('e1')), { t: 3, d: MT, u: NOW + 60e3 }, 'd עולה, u לא יורד, n לא נוסף למסמך קיים');
  });

  it('נדחה: טלפון אחר / משתמש אחר / עסק אחר / מכשיר אחד / לא רשום ב-pushTokens; פג תוקף; פעולה לא נכונה – בלי כתיבה', async () => {
    const x = await mk({ uid: 'e1' });
    assert.equal((await rcv(x.token, F('e2', A))).r, 'bad-device', 'הטלפון של משתמש אחר');
    assert.equal((await rcv(x.token, F('e1', B))).r, 'bad-device', 'אותו משתמש בעסק אחר (push_dev של עסק אחר)');
    assert.equal((await rcv(x.token, F('zz'))).r, 'bad-device', 'טלפון בלי שיוך');
    await prep((d) => d.doc(PA.devPath(F('e1', 'x'))).set({ biz: A, uid: 'e1', t: 1 })); // משויך אבל לא ב-pushTokens
    assert.equal((await rcv(x.token, F('e1', 'x'))).r, 'bad-device');
    const OD = require('../functions/one-device.js')._core;
    await prep((d) => d.doc(OD.pathOf('e1')).set({ phone: { sh: OD.sha('s'.repeat(43)), fh: PA.hashOf(F('e1', 'x')), at: 1 } }));
    assert.equal((await rcv(x.token, F('e1', A))).r, 'bad-device', 'יש טלפון נוכחי אחר');
    await prep((d) => d.doc(OD.pathOf('e1')).delete());
    assert.equal((await rcv(x.token, F('e1', A), NOW + 49 * 3600e3)).r, 'expired');
    assert.equal((await PA.act({ t: x.token, a: 'done', f: F('e1', A) }, { now: NOW, nameOf })).r, 'bad-act', 'אסימון קבוצה – רק rcv');
    const s = await PA.mkAct({ bizId: A, uid: 'm1', kind: 'sec', id: 'n1', acts: ['done', 'rcv'], now: NOW });
    assert.deepEqual((await get('pact/' + PA.hashOf(s.token))).acts, ['done'], 'rcv לא נכנס לאסימון של המזכירה');
    assert.equal((await PA.act({ t: s.token, a: 'rcv', f: F('m1', A) }, { now: NOW, nameOf })).r, 'bad-act');
    assert.equal(await get(R('e1')), null, 'שום דבר לא נכתב');
    assert.equal((await get('pact/' + PA.hashOf(x.token))).used, undefined, 'האסימון לא נוצל');
    assert.equal((await rcv(x.token, F('e1', A))).ok, true, 'הטלפון הנכון – עובר');
  });

  it('הרשאה: עובד מושבת / לא חבר בקבוצה / תוספת כבויה / עסק מושהה – בלי כתיבה', async () => {
    await prep((d) => d.doc(`b/${A}/staff/e2`).update({ active: false }));
    assert.equal((await rcv((await mk({ uid: 'e2' })).token, F('e2', A))).r, 'deny');
    assert.equal((await rcv((await mk({ uid: 'ex' })).token, F('ex', A))).r, 'not-member');
    assert.equal(await get(R('ex')), null);
    assert.equal((await rcv((await mk({ uid: 'e1', bizId: OFF })).token, F('e1', OFF))).r, 'deny');
    assert.equal(await get(R('e1', OFF)), null);
    await prep((d) => d.doc('b/' + A).update({ status: 'suspended' }));
    assert.equal((await rcv((await mk({ uid: 'e1' })).token, F('e1', A))).r, 'deny');
    assert.equal(await get(R('e1')), null);
  });

  it('legacy בשורש: נכתב ב-grp/{gid}/r/{uid}; אחרי המעבר ל-b – נדחה; אסימון "שורש" לעסק אחר – נדחה', async () => {
    const x = await mk({ bizId: 'largpeami', uid: 'r1', gp: 'r' });
    assert.equal((await rcv(x.token, F('r1'))).ok, true);
    assert.deepEqual(await get(R('r1', null)), { d: MT, u: NOW, n: 'r1' });
    assert.equal(await get('b/largpeami/grp/g1/r/r1'), null);
    const y = await mk({ uid: 'e1', gp: 'r' });
    assert.equal((await rcv(y.token, F('e1', A))).r, 'deny');
    await prep((d) => d.doc('b/largpeami').set({ name: 'x', status: 'active', dataRoot: 'b', features: { tasks: true, groups: true } }));
    const z = await mk({ bizId: 'largpeami', uid: 'r1', gp: 'r' });
    assert.equal((await rcv(z.token, F('r1'))).r, 'deny');
  });

  it('ניקוי: אסימון קבוצה שפג תוקפו נמחק ב-cleanPact', async () => {
    const x = await mk({ uid: 'e1' });
    assert.equal(await PA.cleanPact(NOW + 47 * 3600e3), 0);
    assert.equal(await PA.cleanPact(NOW + 49 * 3600e3), 1);
    assert.equal(await get('pact/' + PA.hashOf(x.token)), null);
  });
});
