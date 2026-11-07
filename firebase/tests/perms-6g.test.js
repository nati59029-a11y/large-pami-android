'use strict';
// 6ז (עדכון חוזה 17): הדוח של העובד מפוצל לפי רמה, והאכיפה בנתונים (בחוקים), לא בתצוגה.
//   wv/rpi_YYYY-MM = הכנסות לפי קטגוריה – rep.
//   wv/rpe_YYYY-MM = הוצאות לפי קטגוריה, בלי משכורות – rep + expR == true ("כל העסק"). 'own' / false – חסום.
//   wv/rps_YYYY-MM = סך המשכורות – rep + sal.
//   wv/rep_YYYY-MM (הפורמט הישן של 6ו, כלל הכול) – רק למנהל, כדי שעותק ישן לא ידליף.
// כולל ניסיונות עקיפה: קריאה ישירה של מסמך אסור, list, שאילתה, כתיבה בידי עובד, עובד מעסק אחר, מזהה מזויף.
// רץ מול האמולטור, חלק מ-test:multibiz.

const { describe, it, before, after, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-a', B = 'biz-b';
const M = '2026-11';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };
const MGR = 'g_mgr', SUPER = 'g_super', OLD = 'g_old';
const R_ALL = 'g_rall', R_OWN = 'g_rown', R_NONE = 'g_rnone', R_SAL = 'g_rsal', R_ALLSAL = 'g_rallsal', R_OWNSAL = 'g_rownsal';
const NOREP = 'g_norep', OTHB = 'g_othb', INACT = 'g_inact';

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
const body = (m, data) => ({ data: data || '[]', h: 'abc', m: m || M, at: Date.now() });
const KINDS = ['rpi', 'rpe', 'rps', 'rep'];

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    for (const z of [A, B]) {
      b.set(d.doc('b/' + z), { name: z, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: {} });
      for (const k of KINDS) b.set(d.doc(`b/${z}/wv/${k}_${M}`), body());
    }
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true, pushTokens: [] });
    const emp = (u, perms, z, active) => b.set(d.doc(`b/${z || A}/staff/${u}`),
      Object.assign({ name: u, role: 'employee', active: active !== false, pushTokens: [], rank: '' }, perms ? { perms: Object.assign({}, NONE, perms) } : {}));
    emp(OLD, null);
    emp(R_ALL, { rep: true, expR: true });
    emp(R_OWN, { rep: true, expR: 'own' });
    emp(R_NONE, { rep: true });
    emp(R_SAL, { rep: true, sal: true });
    emp(R_ALLSAL, { rep: true, expR: true, sal: true });
    emp(R_OWNSAL, { rep: true, expR: 'own', sal: true });
    emp(NOREP, { expR: true, sal: true, incR: true });
    emp(INACT, { rep: true, expR: true, sal: true }, A, false);
    emp(OTHB, { rep: true, expR: true, sal: true }, B);
    await b.commit();
  });
}

const can = (u, k, z) => assertSucceeds(db(u).doc(`b/${z || A}/wv/${k}_${M}`).get());
const cannot = (u, k, z) => assertFails(db(u).doc(`b/${z || A}/wv/${k}_${M}`).get());

before(async () => { env = await H.getEnv(); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(seed);

describe('6ז – דוח העובד: כל חלק לפי המתג שלו', () => {
  it('"דוחות" לבד: רק הכנסות. אין הוצאות ואין משכורות', async () => {
    await can(R_NONE, 'rpi');
    await cannot(R_NONE, 'rpe');
    await cannot(R_NONE, 'rps');
  });
  it('"דוחות" + "רואה הוצאות: כל העסק": הכנסות והוצאות, בלי סך המשכורות', async () => {
    await can(R_ALL, 'rpi');
    await can(R_ALL, 'rpe');
    await cannot(R_ALL, 'rps');
  });
  it('"דוחות" + "רואה הוצאות: רק שלו": סך ההוצאות של העסק מוסתר', async () => {
    await can(R_OWN, 'rpi');
    await cannot(R_OWN, 'rpe');
    await cannot(R_OWN, 'rps');
  });
  it('"דוחות" + "משכורות" בלי הוצאות: הכנסות וסך המשכורות, בלי הוצאות', async () => {
    await can(R_SAL, 'rpi');
    await can(R_SAL, 'rps');
    await cannot(R_SAL, 'rpe');
  });
  it('"רק שלו" + "משכורות": משכורות כן, הוצאות העסק לא', async () => {
    await can(R_OWNSAL, 'rps');
    await cannot(R_OWNSAL, 'rpe');
  });
  it('כל המתגים: כל החלקים', async () => {
    for (const k of ['rpi', 'rpe', 'rps']) await can(R_ALLSAL, k);
  });
  it('מנהל העסק ומנהל־על: הכול, כולל המסמך הישן', async () => {
    for (const k of KINDS) { await can(MGR, k); await can(SUPER, k); }
  });
});

describe('6ז – ניסיונות עקיפה', () => {
  it('עובד בלי "דוחות" (אבל עם הוצאות, משכורות והכנסות) לא קורא אף חלק של הדוח', async () => {
    for (const k of KINDS) await cannot(NOREP, k);
  });
  it('עובד ישן (בלי perms) לא קורא אף חלק של הדוח', async () => {
    for (const k of KINDS) await cannot(OLD, k);
  });
  it('המסמך הישן rep_ (כלל הוצאות ומשכורות) חסום לכל עובד, גם עם כל המתגים', async () => {
    for (const u of [R_ALL, R_OWN, R_NONE, R_SAL, R_ALLSAL, R_OWNSAL]) await cannot(u, 'rep');
  });
  it('list ושאילתה על wv – חסומים לעובד עם כל המתגים', async () => {
    await assertFails(db(R_ALLSAL).collection(`b/${A}/wv`).get());
    await assertFails(db(R_OWN).collection(`b/${A}/wv`).where('m', '==', M).get());
  });
  it('עובד לא פעיל עם כל המתגים – חסום', async () => {
    for (const k of ['rpi', 'rpe', 'rps']) await cannot(INACT, k);
  });
  it('עובד מעסק אחר עם כל המתגים – חסום בעסק א, מותר בעסק שלו', async () => {
    for (const k of ['rpi', 'rpe', 'rps']) { await cannot(OTHB, k, A); await can(OTHB, k, B); }
  });
  it('מזהה דומה שלא תואם בדיוק (למשל "rpex_" או אות גדולה) – חסום לעובד', async () => {
    await prep(async (d) => { await d.doc(`b/${A}/wv/RPE_${M}`).set(body()); await d.doc(`b/${A}/wv/xrpi_${M}`).set(body()); });
    await assertFails(db(R_OWN).doc(`b/${A}/wv/RPE_${M}`).get());
    await assertFails(db(R_NONE).doc(`b/${A}/wv/xrpi_${M}`).get());
  });
  it('עובד "רק שלו" מנסה לכתוב לעצמו מסמך הוצאות או לשנות את הדוח – חסום', async () => {
    await assertFails(db(R_OWN).doc(`b/${A}/wv/rpe_${M}`).set(body()));
    await assertFails(db(R_ALLSAL).doc(`b/${A}/wv/rpi_${M}`).set(body()));
    await assertFails(db(R_ALLSAL).doc(`b/${A}/wv/rps_${M}`).delete());
  });
  it('עובד "רק שלו" מנסה לשנות לעצמו את המתג ל-true – חסום', async () => {
    await assertFails(db(R_OWN).doc(`b/${A}/staff/${R_OWN}`).update({ 'perms.expR': true }));
    await assertFails(db(R_SAL).doc(`b/${A}/staff/${R_SAL}`).update({ perms: Object.assign({}, NONE, { rep: true, sal: true, expR: true }) }));
  });
});

describe('6ז – כתיבה של המנהל', () => {
  it('מנהל כותב את שלושת החלקים החדשים', async () => {
    for (const k of ['rpi', 'rpe', 'rps']) await assertSucceeds(db(MGR).doc(`b/${A}/wv/${k}_2026-10`).set(body('2026-10')));
  });
  it('המסמך הישן rep_ לא נכתב יותר (גם לא בידי מנהל); מזהה לא מוכר – חסום', async () => {
    await assertFails(db(MGR).doc(`b/${A}/wv/rep_2026-10`).set(body('2026-10')));
    await assertFails(db(MGR).doc(`b/${A}/wv/rpx_2026-10`).set(body('2026-10')));
  });
  it('מנהל עסק א לא כותב ולא קורא את הדוח של עסק ב', async () => {
    await assertFails(db(MGR).doc(`b/${B}/wv/rpe_${M}`).get());
    await assertFails(db(MGR).doc(`b/${B}/wv/rpe_${M}`).set(body()));
  });
});
