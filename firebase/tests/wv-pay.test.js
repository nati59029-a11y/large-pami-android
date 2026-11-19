'use strict';
// 19.11.2026 (שלב E, "השכר שלי"): wv/pay_YYYY-MM_<uid> – השכר המשוער של עובד אחד.
//   קריאה: רק העובד שה-uid שלו במזהה, ורק כשהוא עובד פעיל בעסק פעיל (גם בלי perms). מנהל / מנהל־על – הכול.
//   כתיבה ומחיקה: מנהל בלבד, עם השדות הקבועים של wv ({data,h,m,at}). עובד לא כותב ולא מוחק, גם לא את המסמך של עצמו.
// רץ מול האמולטור, חלק מ-test:multibiz:1.

const { describe, it, before, after, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-a', B = 'biz-b', M = '2026-11';
const MGR = 'p_mgr', SUPER = 'p_super', E1 = 'p_e1', E2 = 'p_e2', OLD = 'p_old', INACT = 'p_inact', OTHB = 'p_othb';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
const body = (m) => ({ data: '{"v":1,"rows":[]}', h: 'abc', m: m || M, at: Date.now() });
const PAY = (u, m) => `pay_${m || M}_${u}`;
const doc = (u, id, z) => db(u).doc(`b/${z || A}/wv/${id}`);

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    for (const z of [A, B]) {
      b.set(d.doc('b/' + z), { name: z, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: {} });
      for (const u of [E1, E2, OLD, INACT, OTHB]) b.set(d.doc(`b/${z}/wv/${PAY(u)}`), body());
    }
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true, pushTokens: [] });
    const emp = (u, perms, z, active) => b.set(d.doc(`b/${z || A}/staff/${u}`),
      Object.assign({ name: u, role: 'employee', active: active !== false, pushTokens: [], rank: '' }, perms ? { perms: Object.assign({}, NONE, perms) } : {}));
    emp(E1, {});
    emp(E2, { sal: true, rep: true, incR: true, expR: true });
    emp(OLD, null);
    emp(INACT, { sal: true }, A, false);
    emp(OTHB, {}, B);
    await b.commit();
  });
}

before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(seed);

describe('wv/pay_ – קריאה', () => {
  it('עובד פעיל קורא את המסמך שלו (גם בלי מתגים, וגם עובד ישן בלי perms)', async () => {
    await assertSucceeds(doc(E1, PAY(E1)).get());
    await assertSucceeds(doc(OLD, PAY(OLD)).get());
    await assertSucceeds(doc(E2, PAY(E2, '2026-10')).get());
  });
  it('עובד א\' לא קורא את המסמך של עובד ב\' (גם עם כל המתגים)', async () => {
    await assertFails(doc(E1, PAY(E2)).get());
    await assertFails(doc(E2, PAY(E1)).get());
  });
  it('עובד לא פעיל לא קורא אפילו את המסמך של עצמו', async () => {
    await assertFails(doc(INACT, PAY(INACT)).get());
  });
  it('עובד מעסק אחר – חסום בעסק א, מותר בעסק שלו', async () => {
    await assertFails(doc(OTHB, PAY(OTHB), A).get());
    await assertSucceeds(doc(OTHB, PAY(OTHB), B).get());
  });
  it('עקיפה: מזהה עם תוספת אחרי ה-uid, או חודש לא תקין – חסום', async () => {
    await prep(async (d) => { await d.doc(`b/${A}/wv/${PAY(E1)}x`).set(body()); await d.doc(`b/${A}/wv/pay_2026-13_${E1}`).set(body('2026-13')); });
    await assertFails(doc(E1, PAY(E1) + 'x').get());
    await assertFails(doc(E1, `pay_2026-13_${E1}`).get());
  });
  it('list ושאילתה על wv – חסומים לעובד', async () => {
    await assertFails(db(E1).collection(`b/${A}/wv`).get());
    await assertFails(db(E1).collection(`b/${A}/wv`).where('m', '==', M).get());
  });
  it('מנהל ומנהל־על קוראים הכול', async () => {
    await assertSucceeds(doc(MGR, PAY(E1)).get());
    await assertSucceeds(doc(SUPER, PAY(E2)).get());
  });
});

describe('wv/pay_ – כתיבה ומחיקה', () => {
  it('מנהל כותב, מעדכן ומוחק מסמך תקין', async () => {
    await assertSucceeds(doc(MGR, PAY(E1, '2026-10')).set(body('2026-10')));
    await assertSucceeds(doc(MGR, PAY(E1)).set(body()));
    await assertSucceeds(doc(MGR, PAY(E2)).delete());
  });
  it('מנהל: שדה נוסף, m שלא תואם למזהה או uid לא תקין במזהה – נחסם', async () => {
    await assertFails(doc(MGR, PAY(E1)).set(Object.assign(body(), { u: E1 })));
    await assertFails(doc(MGR, PAY(E1)).set(body('2026-10')));
    await assertFails(doc(MGR, `pay_${M}_a.b`).set(body()));
  });
  it('עובד לא כותב ולא מוחק – גם לא את המסמך של עצמו', async () => {
    await assertFails(doc(E1, PAY(E1)).set(body()));
    await assertFails(doc(E1, PAY(E1, '2026-10')).set(body('2026-10')));
    await assertFails(doc(E2, PAY(E2)).delete());
    await assertFails(doc(E1, PAY(E2)).set(body()));
  });
});
