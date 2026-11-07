'use strict';
// 6ו (עדכון חוזה 16): "רואה הוצאות" בשלוש אפשרויות (כל העסק / רק שלו / לא רואה), ומסכי עובד – הכנסות, משכורות, דוחות (האוסף wv).
// רץ מול האמולטור (auth, firestore, storage, functions), חלק מ-test:multibiz.
// כולל ניסיונות עקיפה: עובד "רק שלו" מבקש בשאילתה הוצאות של אחר, עובד בלי "משכורות" קורא משכורות, עובד מעסק אחר, עובד כותב למראה.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-a', B = 'biz-b';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'f_mgr', OLD = 'f_old', EALL = 'f_all', OWN = 'f_own', NOEXP = 'f_none', INC = 'f_inc', SAL = 'f_sal', REP = 'f_rep', OTHB = 'f_othb', SUPER = 'f_super';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };
const M = '2026-11';

const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (name) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${name}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  return { status: json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: json && json.error && json.error.details && json.error.details.reason, result: json && json.result, text };
}

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
async function getDoc(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
const wvBody = (m) => ({ data: '[]', h: 'abc', m: m || M, at: Date.now() });

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    for (const z of [A, B]) {
      b.set(d.doc('b/' + z), { name: z, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: ALL });
      b.set(d.doc(`b/${z}/private/info`), { ownerEmail: 'o@example.invalid', ownerPhone: '0501234567', adv: {} });
    }
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true, pushTokens: [] });
    const emp = (u, perms, z) => b.set(d.doc(`b/${z || A}/staff/${u}`), Object.assign({ name: u, role: 'employee', active: true, pushTokens: [], rank: '' }, perms ? { perms } : {}));
    emp(OLD, null); // עובד ישן: בלי perms = כמו היום
    emp(EALL, Object.assign({}, NONE, { expR: true, expW: true }));
    emp(OWN, Object.assign({}, NONE, { expR: 'own', expW: true }));
    emp(NOEXP, Object.assign({}, NONE, { expW: true }));
    emp(INC, Object.assign({}, NONE, { incR: true }));
    emp(SAL, Object.assign({}, NONE, { sal: true }));
    emp(REP, Object.assign({}, NONE, { rep: true }));
    emp(OTHB, { incR: true, incW: true, expR: true, expW: true, sup: true, sal: true, rep: true, ord: true, trf: true }, B); // עסק אחר, כל המתגים
    for (const [u, z] of [[MGR, A], [OLD, A], [EALL, A], [OWN, A], [NOEXP, A], [INC, A], [SAL, A], [REP, A], [OTHB, B]]) b.set(d.doc('users/' + u), { bizId: z, role: u === MGR ? 'admin' : 'worker', active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    for (const u of [OLD, OWN, NOEXP]) {
      b.set(d.doc(`b/${A}/inbox/in_${u}`), { owner: u, by: u, status: 'new', created: 'x', data: '{}', parts: 1 });
      b.set(d.doc(`b/${A}/chunks/in_${u}_0`), { owner: u, data: 'x' });
      b.set(d.doc(`b/${A}/cashout/co_${u}`), { uid: u, by: u, t: 1, reg: 'i_yh', d: '2026-11-01', a: 10, why: 'x', dep: '', src: 'co_' + u, zc: '', dp: '' });
    }
    for (const k of ['inc', 'sal', 'rpi']) for (const z of [A, B]) b.set(d.doc(`b/${z}/wv/${k}_${M}`), wvBody());
    await b.commit();
  });
}

before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(seed);

describe('6ו – רואה הוצאות: כל העסק / רק שלו / לא רואה', () => {
  it('עובד ישן (בלי perms) – בדיוק כמו היום: כל ההוצאות מהקופה, וההוצאות ששלח', async () => {
    await assertSucceeds(db(OLD).collection(`b/${A}/cashout`).get());
    await assertSucceeds(db(OLD).doc(`b/${A}/cashout/co_${OWN}`).get());
    await assertSucceeds(db(OLD).doc(`b/${A}/inbox/in_${OLD}`).get());
    await assertSucceeds(db(OLD).collection(`b/${A}/inbox`).where('owner', '==', OLD).get());
  });
  it('"כל העסק" (expR = true) – כל ההוצאות מהקופה', async () => {
    await assertSucceeds(db(EALL).collection(`b/${A}/cashout`).get());
    await assertSucceeds(db(EALL).doc(`b/${A}/cashout/co_${OLD}`).get());
  });
  it('"רק שלו" – רואה את מה שהזין: הוצאה מקופה, שאילתה לפי uid שלו, inbox ותמונה', async () => {
    await assertSucceeds(db(OWN).doc(`b/${A}/cashout/co_${OWN}`).get());
    await assertSucceeds(db(OWN).collection(`b/${A}/cashout`).where('uid', '==', OWN).get());
    await assertSucceeds(db(OWN).collection(`b/${A}/cashout`).where('uid', '==', OWN).where('zc', '==', '').get());
    await assertSucceeds(db(OWN).doc(`b/${A}/inbox/in_${OWN}`).get());
    await assertSucceeds(db(OWN).collection(`b/${A}/inbox`).where('owner', '==', OWN).get());
    await assertSucceeds(db(OWN).doc(`b/${A}/chunks/in_${OWN}_0`).get());
  });
  it('עקיפה: "רק שלו" מבקש הוצאות של אחר – במסמך, בשאילתה בלי סינון, ובשאילתה עם uid של אחר', async () => {
    await assertFails(db(OWN).doc(`b/${A}/cashout/co_${OLD}`).get());
    await assertFails(db(OWN).collection(`b/${A}/cashout`).get());
    await assertFails(db(OWN).collection(`b/${A}/cashout`).where('zc', '==', '').get());
    await assertFails(db(OWN).collection(`b/${A}/cashout`).where('uid', '==', OLD).get());
    await assertFails(db(OWN).doc(`b/${A}/inbox/in_${OLD}`).get());
    await assertFails(db(OWN).collection(`b/${A}/inbox`).where('owner', '==', OLD).get());
    await assertFails(db(OWN).doc(`b/${A}/chunks/in_${OLD}_0`).get());
  });
  it('"לא רואה" (expR = false) – אין גישה, גם לא למה שהזין בעצמו; עדיין יכול להזין', async () => {
    await assertFails(db(NOEXP).doc(`b/${A}/cashout/co_${NOEXP}`).get());
    await assertFails(db(NOEXP).collection(`b/${A}/cashout`).where('uid', '==', NOEXP).get());
    await assertFails(db(NOEXP).doc(`b/${A}/inbox/in_${NOEXP}`).get());
    await assertFails(db(NOEXP).doc(`b/${A}/chunks/in_${NOEXP}_0`).get());
    await assertSucceeds(db(NOEXP).doc(`b/${A}/chunks/n_${NOEXP}_0`).set({ owner: NOEXP, data: 'x' }));
  });
  it('עקיפה: עובד מעסק אחר (כל המתגים) קורא הוצאות של עסק א – נחסם', async () => {
    await assertFails(db(OTHB).collection(`b/${A}/cashout`).get());
    await assertFails(db(OTHB).collection(`b/${A}/cashout`).where('uid', '==', OTHB).get());
    await assertFails(db(OTHB).doc(`b/${A}/inbox/in_${OLD}`).get());
  });
  it('עקיפה: עובד משנה לעצמו את "רואה הוצאות" ל-true במסד – נחסם', async () => {
    await assertFails(db(OWN).doc(`b/${A}/staff/${OWN}`).update({ 'perms.expR': true }));
  });
});

describe('6ו – מסכי עובד: הכנסות, משכורות, דוחות (wv)', () => {
  it('כל מתג פותח רק את המסך שלו', async () => {
    await assertSucceeds(db(INC).doc(`b/${A}/wv/inc_${M}`).get());
    await assertSucceeds(db(SAL).doc(`b/${A}/wv/sal_${M}`).get());
    await assertSucceeds(db(REP).doc(`b/${A}/wv/rpi_${M}`).get());
  });
  it('עקיפה: עובד בלי "משכורות" קורא משכורות; בלי "הכנסות" קורא הכנסות; בלי "דוחות" קורא דוחות – נחסם', async () => {
    for (const u of [INC, REP, OLD, EALL]) await assertFails(db(u).doc(`b/${A}/wv/sal_${M}`).get());
    for (const u of [SAL, REP, OLD, EALL]) await assertFails(db(u).doc(`b/${A}/wv/inc_${M}`).get());
    for (const u of [INC, SAL, OLD, EALL]) await assertFails(db(u).doc(`b/${A}/wv/rpi_${M}`).get());
  });
  it('עובד ישן (בלי perms) – אין לו אף מסך חדש (כמו היום)', async () => {
    for (const k of ['inc', 'sal', 'rpi']) await assertFails(db(OLD).doc(`b/${A}/wv/${k}_${M}`).get());
  });
  it('עקיפה: עובד מעסק אחר עם כל המתגים קורא את המסכים של עסק א – נחסם; בעסק שלו – מותר', async () => {
    for (const k of ['inc', 'sal', 'rpi']) {
      await assertFails(db(OTHB).doc(`b/${A}/wv/${k}_${M}`).get());
      await assertSucceeds(db(OTHB).doc(`b/${B}/wv/${k}_${M}`).get());
    }
  });
  it('עקיפה: עובד מבקש רשימה של כל המסמכים (list) – נחסם, גם עם המתג', async () => {
    await assertFails(db(SAL).collection(`b/${A}/wv`).get());
    await assertFails(db(INC).collection(`b/${A}/wv`).where('m', '==', M).get());
  });
  it('עקיפה: עובד כותב או מוחק במראה – נחסם (גם עם המתג)', async () => {
    await assertFails(db(INC).doc(`b/${A}/wv/inc_${M}`).set(wvBody()));
    await assertFails(db(SAL).doc(`b/${A}/wv/sal_2026-10`).set(wvBody('2026-10')));
    await assertFails(db(REP).doc(`b/${A}/wv/rpi_${M}`).delete());
  });
  it('מנהל העסק כותב מראה תקין; מזהה, חודש או שדות לא תקינים – נחסם', async () => {
    await assertSucceeds(db(MGR).doc(`b/${A}/wv/inc_2026-10`).set(wvBody('2026-10')));
    await assertSucceeds(db(MGR).doc(`b/${A}/wv/inc_${M}`).get());
    await assertSucceeds(db(MGR).collection(`b/${A}/wv`).get());
    await assertFails(db(MGR).doc(`b/${A}/wv/exp_${M}`).set(wvBody()));
    await assertFails(db(MGR).doc(`b/${A}/wv/inc_2026-13`).set(wvBody('2026-13')));
    await assertFails(db(MGR).doc(`b/${A}/wv/inc_2026-10`).set(wvBody('2026-09')));
    await assertFails(db(MGR).doc(`b/${A}/wv/inc_2026-10`).set(Object.assign(wvBody('2026-10'), { x: 1 })));
    await assertFails(db(MGR).doc(`b/${A}/wv/inc_2026-10`).set(Object.assign(wvBody('2026-10'), { data: 5 })));
  });
  it('עקיפה: מנהל של עסק א כותב או קורא מראה של עסק ב – נחסם', async () => {
    await assertFails(db(MGR).doc(`b/${B}/wv/inc_${M}`).get());
    await assertFails(db(MGR).doc(`b/${B}/wv/inc_${M}`).set(wvBody()));
  });
  it('מנהל־על קורא; לא קיים wv בשורש (legacy)', async () => {
    await assertSucceeds(db(SUPER).doc(`b/${A}/wv/sal_${M}`).get());
    await assertFails(db(MGR).doc(`wv/inc_${M}`).get());
  });
  it('מתג "משכורות" לבד לא פותח הכנסות לכתיבה (סגירת קופה / הפקדות)', async () => {
    await assertFails(db(SAL).collection(`b/${A}/deposits`).get());
    await assertFails(db(INC).collection(`b/${A}/zlast`).get());
  });
});

describe('6ו – שרת: setStaffPerms עם "רואה רק את שלו"', () => {
  it('מנהל־על קובע expR = own; נשמר בשדה אחד; נאכף מיד; audit', async () => {
    const r = await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { expR: 'own', expW: true } });
    assert.equal(r.status, 'OK', r.text);
    const s = await getDoc(`b/${A}/staff/${OLD}`);
    assert.equal(s.perms.expR, 'own'); assert.equal(s.perms.expW, true); assert.equal(s.perms.sal, false);
    await assertFails(db(OLD).collection(`b/${A}/cashout`).get());
    await assertSucceeds(db(OLD).collection(`b/${A}/cashout`).where('uid', '==', OLD).get());
    let det = []; await prep(async (d) => { det = (await d.collection(`b/${A}/audit`).get()).docs.map((x) => JSON.stringify(x.data())); });
    assert.ok(det.some((x) => x.includes('expR=own')), 'audit כולל expR=own');
    const back = await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { expR: true } });
    assert.equal(back.status, 'OK', back.text);
    await assertSucceeds(db(OLD).collection(`b/${A}/cashout`).get());
  });
  it('דרגה יכולה לכלול expR = own', async () => {
    const rk = await call('setBusinessRanks', SUPER, { bizId: A, ranks: [{ id: 'own', name: 'רק שלו', perms: { expR: 'own', expW: true } }] });
    assert.equal(rk.status, 'OK', rk.text);
    assert.equal((await getDoc(`b/${A}/private/info`)).ranks[0].perms.expR, 'own');
  });
  it('קלט לא תקין: own במתג אחר, ערך אחר – bad-perms', async () => {
    assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { sal: 'own' } })).reason, 'bad-perms');
    assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { expR: 'all' } })).reason, 'bad-perms');
    assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { expR: 'OWN' } })).reason, 'bad-perms');
  });
  it('עקיפה: עובד או מנהל העסק קובעים "רק שלו" / "הכול" – not-superadmin, ולא השתנה כלום', async () => {
    for (const u of [OWN, MGR]) assert.equal((await call('setStaffPerms', u, { bizId: A, uid: OWN, perms: { expR: true } })).reason, 'not-superadmin');
    assert.equal((await getDoc(`b/${A}/staff/${OWN}`)).perms.expR, 'own');
  });
});
