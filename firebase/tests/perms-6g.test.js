'use strict';
// 6ז (עדכון חוזה 17): הדוח של העובד מפוצל לפי רמה, והאכיפה בנתונים (בחוקים), לא בתצוגה.
//   wv/rpi_YYYY-MM = הכנסות לפי קטגוריה – rep.
//   wv/rpe_YYYY-MM = הוצאות לפי קטגוריה, בלי משכורות – rep + expR == true ("כל העסק"). 'own' / false – חסום.
//   wv/rps_YYYY-MM = סך המשכורות – rep + sal.
//   wv/rep_YYYY-MM (הפורמט הישן של 6ו, כלל הכול) – רק למנהל, כדי שעותק ישן לא ידליף.
// כולל ניסיונות עקיפה: קריאה ישירה של מסמך אסור, list, שאילתה, כתיבה בידי עובד, עובד מעסק אחר, מזהה מזויף.
// רץ מול האמולטור, חלק מ-test:multibiz.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-a', B = 'biz-b';
const M = '2026-11';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };
const MGR = 'g_mgr', SUPER = 'g_super', OLD = 'g_old';
const R_ALL = 'g_rall', R_OWN = 'g_rown', R_NONE = 'g_rnone', R_SAL = 'g_rsal', R_ALLSAL = 'g_rallsal', R_OWNSAL = 'g_rownsal';
const NOREP = 'g_norep', OTHB = 'g_othb', INACT = 'g_inact', R_NOINC = 'g_rnoinc';

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
const body = (m, data) => ({ data: data || '[]', h: 'abc', m: m || M, at: Date.now() });
const KINDS = ['rpi', 'rpe', 'rps', 'rep'];
const RPO = (u) => `rpo_${M}_${u}`;
// can/cannot מוסיפים _<חודש> למזהה; למסמכי rpo_ (שהחודש באמצע) – מזהה מלא
const canId = (u, id, z) => assertSucceeds(db(u).doc(`b/${z || A}/wv/${id}`).get());
const cannotId = (u, id, z) => assertFails(db(u).doc(`b/${z || A}/wv/${id}`).get());

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    for (const z of [A, B]) {
      b.set(d.doc('b/' + z), { name: z, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: {} });
      for (const k of KINDS) b.set(d.doc(`b/${z}/wv/${k}_${M}`), body());
      for (const u of [R_OWN, R_ALL, R_NONE, R_OWNSAL, OTHB]) b.set(d.doc(`b/${z}/wv/${RPO(u)}`), body());
    }
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true, pushTokens: [] });
    const emp = (u, perms, z, active) => b.set(d.doc(`b/${z || A}/staff/${u}`),
      Object.assign({ name: u, role: 'employee', active: active !== false, pushTokens: [], rank: '' }, perms ? { perms: Object.assign({}, NONE, perms) } : {}));
    emp(OLD, null);
    emp(R_ALL, { rep: true, incR: true, expR: true });
    emp(R_OWN, { rep: true, incR: true, expR: 'own' });
    emp(R_NONE, { rep: true, incR: true });
    emp(R_SAL, { rep: true, incR: true, sal: true });
    emp(R_ALLSAL, { rep: true, incR: true, expR: true, sal: true });
    emp(R_OWNSAL, { rep: true, incR: true, expR: 'own', sal: true });
    emp(R_NOINC, { rep: true, expR: true, sal: true });
    emp(NOREP, { expR: true, sal: true, incR: true });
    emp(INACT, { rep: true, incR: true, expR: true, sal: true }, A, false);
    emp(OTHB, { rep: true, incR: true, expR: 'own', sal: true }, B);
    await b.commit();
  });
}

const can = (u, k, z) => assertSucceeds(db(u).doc(`b/${z || A}/wv/${k}_${M}`).get());
const cannot = (u, k, z) => assertFails(db(u).doc(`b/${z || A}/wv/${k}_${M}`).get());

before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(seed);

describe('6ז – דוח העובד: כל חלק לפי המתג שלו', () => {
  it('"דוחות" + "רואה הכנסות" בלבד: רק הכנסות. אין הוצאות ואין משכורות', async () => {
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
    for (const k of ['rpi', 'rps']) { await cannot(OTHB, k, A); await can(OTHB, k, B); }
    await cannotId(OTHB, RPO(OTHB), A); await canId(OTHB, RPO(OTHB), B);
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

describe('6ז – החלטות 7.11 (20:45): הכנסות דורשות incR; "רק שלו" רואה רק את מה שהזין (rpo_)', () => {
  it('"דוחות" בלי "רואה הכנסות" – אין הכנסות בדוח, גם בבקשה ישירה; שאר החלקים לפי המתגים', async () => {
    await cannot(R_NOINC, 'rpi');
    await can(R_NOINC, 'rpe');
    await can(R_NOINC, 'rps');
  });
  it('"רק שלו": קורא את rpo_ שלו בלבד', async () => {
    await canId(R_OWN, RPO(R_OWN));
    await canId(R_OWNSAL, RPO(R_OWNSAL));
  });
  it('עקיפה: "רק שלו" קורא rpo_ של עובד אחר – נחסם', async () => {
    await cannotId(R_OWN, RPO(R_ALL));
    await cannotId(R_OWN, RPO(R_OWNSAL));
  });
  it('עקיפה: "לא רואה" / בלי "דוחות" / עובד ישן – לא קורא אפילו את rpo_ של עצמו', async () => {
    await cannotId(R_NONE, RPO(R_NONE));
    await prep((d) => d.doc(`b/${A}/wv/${RPO(NOREP)}`).set(body()));
    await cannotId(NOREP, RPO(NOREP));
    await prep((d) => d.doc(`b/${A}/wv/${RPO(OLD)}`).set(body()));
    await cannotId(OLD, RPO(OLD));
  });
  it('עקיפה: מזהה עם תוספת אחרי ה-uid (rpo_<חודש>_<uid>x) – נחסם', async () => {
    await prep((d) => d.doc(`b/${A}/wv/${RPO(R_OWN)}x`).set(body()));
    await cannotId(R_OWN, RPO(R_OWN) + 'x');
  });
  it('מנהל כותב rpo_ תקין; עובד לא כותב rpo_ (גם לא של עצמו); מזהה לא תקין – נחסם', async () => {
    await assertSucceeds(db(MGR).doc(`b/${A}/wv/rpo_2026-10_${R_OWN}`).set(body('2026-10')));
    await assertFails(db(R_OWN).doc(`b/${A}/wv/${RPO(R_OWN)}`).set(body()));
    await assertFails(db(MGR).doc(`b/${A}/wv/rpo_2026-10_a.b`).set(body('2026-10')));
    await assertFails(db(MGR).doc(`b/${A}/wv/rpo_2026-10_${R_OWN}`).set(body('2026-09')));
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

// ---------------------------------------------------------------------------------------------
// חלק ד (החלטת המשתמש 7.11): cashoutTotal – סכום ההוצאות מקופה לסגירה, מחושב בשרת. מחזיר רק { s, diff? }.
// ---------------------------------------------------------------------------------------------
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (name) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${name}`;
async function call(uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl('cashoutTotal'), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  return { status: json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: json && json.error && json.error.details && json.error.details.reason, result: json && json.result, text };
}
const C_OWN = 'c_own', C_NONE = 'c_none', C_NOINC = 'c_noinc', C_ALL = 'c_all', C_OTHB = 'c_othb', C_OFF = 'c_off';
// סבב 2: השרת מקבל רק את היום או אתמול (שעון ישראל), ולכן התאריכים יחסיים להיום
const ilDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const DT = ilDay(Date.now()), DY = ilDay(Date.now() - 864e5), D2 = ilDay(Date.now() - 2 * 864e5), DN = ilDay(Date.now() + 864e5);
const REQ = { reg: 'i_yh', d: DT, z: 300 };
// הוצאות מקופה (של עובדים שונים). הסגירה הקודמת: אתמול 20:00. החלון: עד סוף היום. 100 (אחר) + 50 (אחר) + 30 (העובד עצמו) = 180
const CO = [
  ['k1', { uid: 'someone', by: 'דנה סודית', reg: 'i_yh', d: DT, tm: '10:00', a: 100, why: 'סיבה-סודית-1' }],
  ['k2', { uid: 'other2', by: 'יוסי סודי', reg: 'i_yh', d: DY, tm: '22:00', a: 50, why: 'סיבה-סודית-2' }],
  ['k3', { uid: C_OWN, by: 'אני', reg: 'i_yh', d: DT, tm: '', a: 30, why: 'שלי' }],
  ['k4', { uid: 'someone', by: 'דנה סודית', reg: 'i_yh', d: DY, tm: '19:00', a: 1000, why: 'לפני החלון' }],
  ['k5', { uid: 'someone', by: 'דנה סודית', reg: 'i_nl', d: DT, tm: '10:00', a: 2000, why: 'קופה אחרת' }],
  ['k6', { uid: 'someone', by: 'דנה סודית', reg: 'i_yh', d: DN, tm: '09:00', a: 4000, why: 'אחרי יום הסגירה' }],
  ['k7', { uid: 'someone', by: 'דנה סודית', reg: 'i_yh', d: DY, tm: '', a: 8000, why: 'לא ברור' }],
];
async function seedCash() {
  await prep(async (d) => {
    const b = d.batch();
    for (const z of [A, B]) b.set(d.doc('b/' + z), { name: z, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { cashClose: true } });
    b.set(d.doc('b/biz-off'), { name: 'off', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: {} });
    const emp = (u, perms, z, extra) => {
      b.set(d.doc(`b/${z || A}/staff/${u}`), Object.assign({ name: u, role: 'employee', active: true, pushTokens: [], rank: '', perms: Object.assign({}, NONE, perms) }, extra || {}));
      b.set(d.doc('users/' + u), { bizId: z || A, role: 'worker', active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    };
    emp(C_OWN, { expR: 'own', incW: true });
    emp(C_NONE, { incW: true });
    emp(C_NOINC, { expR: true });
    emp(C_ALL, { expR: true, incW: true });
    emp(C_OTHB, { expR: true, incW: true }, B);
    emp(C_OFF, { incW: true }, 'biz-off');
    b.set(d.doc('users/' + MGR), { bizId: A, role: 'admin', active: true, bizStatus: 'active', email: MGR + '@example.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/zlast/i_yh`), { d: DY, tm: '20:00', id: 'zprev', uid: MGR, t: 1, od: '', otm: '' });
    for (const [id, x] of CO) b.set(d.doc(`b/${A}/cashout/${id}`), Object.assign({ t: 1, dep: '', src: id, zc: '', dp: '' }, x));
    await b.commit();
  });
}
const SECRETS = ['דנה', 'יוסי', 'סודית', 'סודי', 'someone', 'other2', 'k1', 'k2', 'k3', 'סיבה', '10:00', '22:00'];

describe('6ז חלק ד – cashoutTotal: סכום ההוצאות מקופה בשרת', () => {
  beforeEach(seedCash);
  it('עובד "רק שלו" מקבל את הסכום של כל ההוצאות בחלון (כולל של אחרים), וההפרש מול Z', async () => {
    const r = await call(C_OWN, REQ);
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(r.result, { s: 180, diff: 120 });
  });
  it('עובד "לא רואה" מקבל אותו סכום; בלי z – רק s', async () => {
    const r = await call(C_NONE, { reg: 'i_yh', d: DT });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(r.result, { s: 180 });
  });
  it('התגובה לא חושפת רשומות, שמות, סיבות, מזהים או שעות – רק המפתחות s ו-diff, ושני מספרים', async () => {
    const r = await call(C_OWN, REQ);
    assert.deepEqual(Object.keys(r.result).sort(), ['diff', 's']);
    for (const v of Object.values(r.result)) assert.equal(typeof v, 'number');
    for (const w of SECRETS) assert.ok(!r.text.includes(w), 'התגובה מכילה: ' + w);
  });
  it('העובד עדיין לא יכול לקרוא את ההוצאות של אחרים ישירות (התצוגה שלו נשמרת)', async () => {
    await assertFails(db(C_OWN).doc(`b/${A}/cashout/k1`).get());
    await assertFails(db(C_NONE).doc(`b/${A}/cashout/k3`).get());
    await assertFails(db(C_OWN).collection(`b/${A}/cashout`).get());
  });
  it('מנהל העסק ומנהל־על (עם bizId) – מותר, אותו סכום', async () => {
    const m = await call(MGR, REQ); assert.equal(m.status, 'OK', m.text); assert.equal(m.result.s, 180);
    const s = await call(SUPER, Object.assign({ bizId: A }, REQ)); assert.equal(s.status, 'OK', s.text); assert.equal(s.result.s, 180);
  });
  it('עקיפה: עובד בלי "מזין הכנסות" (סגירת קופה) – נחסם', async () => {
    const r = await call(C_NOINC, REQ); assert.equal(r.status, 'PERMISSION_DENIED'); assert.equal(r.reason, 'no-perm');
  });
  it('עקיפה: עובד מעסק אחר מבקש את עסק א – נחסם; בלי bizId מקבל רק את העסק שלו (0)', async () => {
    const r = await call(C_OTHB, Object.assign({ bizId: A }, REQ)); assert.equal(r.status, 'PERMISSION_DENIED'); assert.equal(r.reason, 'foreign-biz');
    const o = await call(C_OTHB, REQ); assert.equal(o.status, 'OK', o.text); assert.equal(o.result.s, 0);
  });
  it('עקיפה: לא מחובר / עובד לא פעיל / עסק מושהה / תוספת כבויה – נחסם', async () => {
    assert.equal((await call(null, REQ)).status, 'UNAUTHENTICATED');
    await prep((d) => d.doc(`b/${A}/staff/${C_ALL}`).update({ active: false }));
    assert.equal((await call(C_ALL, REQ)).status, 'PERMISSION_DENIED');
    await prep((d) => d.doc('b/' + A).update({ status: 'suspended' }));
    const s = await call(C_OWN, REQ); assert.equal(s.status, 'PERMISSION_DENIED'); assert.equal(s.reason, 'biz-suspended');
    const f = await call(C_OFF, REQ); assert.equal(f.status, 'FAILED_PRECONDITION'); assert.equal(f.reason, 'feature-off');
  });
  it('קלט לא תקין (קופה, תאריך, z) – נדחה; תאריך שאינו היום או אתמול – נדחה', async () => {
    for (const [x, why] of [[{ reg: 'x' }, 'bad-reg'], [{ d: '5.11.2026' }, 'bad-date'], [{ d: D2 }, 'bad-date'], [{ d: DN }, 'bad-date'], [{ z: 'abc' }, 'bad-z']]) {
      const r = await call(C_OWN, Object.assign({}, REQ, x));
      assert.equal(r.status, 'INVALID_ARGUMENT', JSON.stringify(x)); assert.equal(r.reason, why);
    }
  });
  it('עקיפה: הלקוח לא קובע את תחילת החלון – מזהה סגירה ופתיחה ישנה מהלקוח לא משנים את הסכום', async () => {
    for (const x of [{ id: 'zprev' }, { od: DY, otm: '00:01' }, { od: D2, otm: '23:00' }]) {
      const r = await call(C_OWN, Object.assign({}, REQ, x));
      assert.equal(r.status, 'OK', r.text); assert.equal(r.result.s, 180, JSON.stringify(x));
    }
  });
  // 6ח (עדכון חוזה 18): החלון נגמר ברגע הסגירה (tm), לא בסוף היום. הבדיקות על אתמול (DY), כדי שהשעה לא תהיה בעתיד
  const RY = { reg: 'i_yh', d: DY };
  it('6ח: הוצאה דקה לפני רגע הסגירה – נספרת; בדיוק ברגע – נספרת; דקה אחרי – לא', async () => {
    const r1 = await call(C_OWN, Object.assign({}, RY, { tm: '22:01' }));
    assert.equal(r1.status, 'OK', r1.text); assert.equal(r1.result.s, 50); // k2 (אתמול 22:00)
    assert.equal((await call(C_OWN, Object.assign({}, RY, { tm: '22:00' }))).result.s, 50);
    const r3 = await call(C_OWN, Object.assign({}, RY, { tm: '21:59' }));
    assert.equal(r3.status, 'OK', r3.text); assert.equal(r3.result.s, 0);
  });
  it('6ח: סגירה עם פתיחה שצורפה – החלון נגמר בשעת הפתיחה; פתיחה יותר מיום אחרי – הגבול חוזר לשעת הסגירה', async () => {
    const r = await call(C_OWN, Object.assign({}, RY, { tm: '21:00', od: DY, otm: '23:00' }));
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.s, 50);
    const r2 = await call(C_OWN, Object.assign({}, RY, { tm: '21:00', od: '2020-01-01', otm: '23:00' }));
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.s, 0); // פתיחה לפני הסגירה – לא נחשבת
  });
  it('6ח: הוצאה שנרשמה אחרי רגע הסגירה באותו יום – לא נספרת (גם כשהיא של אחר)', async () => {
    await prep((d) => d.doc(`b/${A}/cashout/late`).set({ uid: 'someone', by: 'x', t: 1, reg: 'i_yh', d: DY, tm: '23:30', a: 7, why: 'x', dep: '', src: 'late', zc: '', dp: '' }));
    assert.equal((await call(C_OWN, Object.assign({}, RY, { tm: '23:00' }))).result.s, 50);
    assert.equal((await call(C_OWN, Object.assign({}, RY, { tm: '23:30' }))).result.s, 57);
  });
  it('6ח סבב 2: סוף חלון אחרי השעה הנוכחית בישראל – נדחה (אי אפשר לסרוק את העתיד)', async () => {
    const f = await call(C_OWN, Object.assign({}, REQ, { tm: '00:00', od: DN, otm: '00:01' }));
    assert.equal(f.status, 'INVALID_ARGUMENT', f.text); assert.equal(f.reason, 'bad-time');
    const nowT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    if (nowT < '23:57') { const g = await call(C_OWN, Object.assign({}, REQ, { tm: '23:59' })); assert.equal(g.status, 'INVALID_ARGUMENT', g.text); assert.equal(g.reason, 'bad-time'); }
    assert.equal((await call(C_OWN, Object.assign({}, RY, { tm: '23:59' }))).status, 'OK'); // אתמול – כל שעה
  });
  it('6ח: שעה או פתיחה לא תקינות – נדחות', async () => {
    for (const [x, why] of [[{ tm: '25:00' }, 'bad-time'], [{ tm: 'abc' }, 'bad-time'], [{ otm: '9' }, 'bad-time'], [{ od: '7.11.2026' }, 'bad-date']]) {
      const r = await call(C_OWN, Object.assign({}, REQ, x));
      assert.equal(r.status, 'INVALID_ARGUMENT', JSON.stringify(x)); assert.equal(r.reason, why);
    }
  });
  it('עקיפה: יותר מ-20 קריאות בשעה לעובד – נחסם (rate-limit); עובד אחר לא מושפע', async () => {
    for (let k = 0; k < 20; k++) assert.equal((await call(C_OWN, REQ)).status, 'OK');
    const r = await call(C_OWN, REQ); assert.equal(r.status, 'RESOURCE_EXHAUSTED'); assert.equal(r.reason, 'rate-limit');
    assert.equal((await call(C_NONE, REQ)).status, 'OK');
  });
  it('יותר מ-3000 הוצאות בחלון – שגיאה (לא סכום חלקי)', async () => {
    await prep(async (d) => { for (let n = 0; n < 7; n++) { const b = d.batch(); for (let k = 0; k < 430; k++) b.set(d.doc(`b/${A}/cashout/m${n}_${k}`), { uid: 'x', by: 'x', t: 1, reg: 'i_nl', d: DT, tm: '', a: 1, why: 'x', dep: '', src: 'x', zc: '', dp: '' }); await b.commit(); } });
    const r = await call(C_OWN, REQ); assert.equal(r.status, 'FAILED_PRECONDITION'); assert.equal(r.reason, 'too-many');
  });
  it('החלון מתחיל בפתיחה האחרונה (zlast.od/otm): הוצאה שלפני הפתיחה – לא נספרת', async () => {
    await prep((d) => d.doc(`b/${A}/zlast/i_yh`).set({ d: DY, tm: '20:00', id: 'zprev', uid: MGR, t: 1, od: DT, otm: '08:00' }));
    const r = await call(C_OWN, REQ);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.s, 100); // k1 (היום 10:00) בלבד; k2 (אתמול 22:00) לפני הפתיחה; k3 (היום בלי שעה) – לא ברור, לא נספר
  });
  it('בסגירה הראשונה (אין פתיחה קודמת) – כל מה שלא שויך, גם ישן מאוד (בלי הגבלת ימים)', async () => {
    await prep(async (d) => { await d.doc(`b/${A}/zlast/i_yh`).delete(); await d.doc(`b/${A}/cashout/old`).set({ uid: 'x', by: 'x', t: 1, reg: 'i_yh', d: '2025-01-01', tm: '', a: 3, why: 'x', dep: '', src: 'old', zc: '', dp: '' }); await d.doc(`b/${A}/cashout/done`).set({ uid: 'x', by: 'x', t: 1, reg: 'i_yh', d: '2025-01-02', tm: '', a: 7, why: 'x', dep: '', src: 'done', zc: 'z1', dp: '' }); });
    const r = await call(C_OWN, REQ);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.s, 100 + 50 + 30 + 1000 + 8000 + 3); // ישן שלא שויך – נספר; שויך (zc) – לא
  });
  it('בלי סגירה קודמת: כל מה שעוד לא שויך (zc ריק) ועד סוף יום הסגירה', async () => {
    await prep((d) => d.doc(`b/${A}/zlast/i_yh`).delete());
    const r = await call(C_OWN, REQ);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.s, 100 + 50 + 30 + 1000 + 8000); // k4 ו-k7 נכנסים כשאין סגירה קודמת; k5 קופה אחרת; k6 אחרי יום הסגירה
  });
});

// ---------------------------------------------------------------------------------------------
// 6ח (עדכון חוזה 18, החלטת המשתמש): הוצאה מקופה מתאריך שלפני הפתיחה האחרונה של הקופה – נדחית בחוקים (עובד)
// ---------------------------------------------------------------------------------------------
describe('6ח – הוצאה מקופה מלפני הפתיחה האחרונה נדחית', () => {
  let n = 0; const fresh = (p) => p + Date.now().toString(36) + (n++);
  beforeEach(async () => { await seedCash(); await prep((d) => d.doc(`b/${A}/staff/${C_ALL}`).update({ 'perms.expW': true })); });
  const inb = (uid, id) => prep(async (d) => { await d.doc(`b/${A}/chunks/${id}_0`).set({ owner: uid, data: 'x' }); await d.doc(`b/${A}/inbox/${id}`).set({ owner: uid, by: uid, status: 'new', created: 'x', data: '{}', parts: 1, t: Date.now() }); });
  const body = (uid, id, o) => Object.assign({ uid, by: uid, t: Date.now(), reg: 'i_yh', a: 10, why: 'קניתי חלב', dep: '', src: id, zc: '', dp: '' }, o);
  const tryCo = async (o) => { const id = fresh('w'); await inb(C_ALL, id); return db(C_ALL).doc(`b/${A}/cashout/${id}`).set(body(C_ALL, id, o)); };
  // zlast: אתמול 20:00 (בלי פתיחה)
  it('הוצאה רגילה (אחרי הסגירה האחרונה) – עוברת', async () => {
    await assertSucceeds(tryCo({ d: DT, tm: '09:00' }));
    await assertSucceeds(tryCo({ d: DY, tm: '20:01' }));
    await assertSucceeds(tryCo({ d: DT }));
  });
  it('הוצאה מתאריך ישן (לפני הסגירה האחרונה) – נדחית', async () => {
    await assertFails(tryCo({ d: D2, tm: '12:00' }));
    await assertFails(tryCo({ d: D2 }));
    await assertFails(tryCo({ d: DY, tm: '19:59' }));
    await assertFails(tryCo({ d: DY, tm: '20:00' }));
  });
  it('אותו יום כמו הסגירה בלי שעה – מותר ("לא ברור")', async () => {
    await assertSucceeds(tryCo({ d: DY }));
  });
  it('עם פתיחה שצורפה (היום 08:00) – הגבול הוא הפתיחה', async () => {
    await prep((d) => d.doc(`b/${A}/zlast/i_yh`).set({ d: DY, tm: '20:00', id: 'zprev', uid: MGR, t: 1, od: DT, otm: '08:00' }));
    await assertFails(tryCo({ d: DY, tm: '22:00' }));
    await assertFails(tryCo({ d: DT, tm: '07:59' }));
    await assertSucceeds(tryCo({ d: DT, tm: '08:01' }));
  });
  it('פתיחה שצורפה יותר מיום אחרי הסגירה – לא נחשבת; הגבול חוזר לזמן הסגירה', async () => {
    await prep((d) => d.doc(`b/${A}/zlast/i_yh`).set({ d: D2, tm: '20:00', id: 'zprev', uid: MGR, t: 1, od: DT, otm: '08:00' }));
    await assertSucceeds(tryCo({ d: DY, tm: '09:00' }));
    await assertFails(tryCo({ d: D2, tm: '19:00' }));
  });
  it('אין סגירה קודמת לקופה – כל תאריך מותר; קופה אחרת לא מושפעת', async () => {
    await assertSucceeds(tryCo({ d: D2, reg: 'i_nl' }));
    await prep((d) => d.doc(`b/${A}/zlast/i_yh`).delete());
    await assertSucceeds(tryCo({ d: '2025-01-01' }));
  });
  it('מנהל העסק – לא מוגבל (מראה מהטלפון שלו, גם לתאריך ישן)', async () => {
    await assertSucceeds(db(MGR).doc(`b/${A}/cashout/mOld`).set(body(MGR, 'tx1', { d: D2 })));
  });
});
