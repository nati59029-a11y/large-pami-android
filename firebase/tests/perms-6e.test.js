'use strict';
// 6ה (עדכון חוזה 15): הוספת עובדים רק בידי מנהל־על; דרגות ומתגי הרשאה לכל עובד; אכיפה בחוקים ובשרת.
// רץ מול האמולטור (auth, firestore, storage, functions), חלק מ-test:multibiz.
// כולל ניסיונות עקיפה: מנהל עסק מוסיף עובד, עובד משנה לעצמו מתגים, עובד בלי "רואה הוצאות" קורא הוצאות.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-a';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'p_mgr', OLD = 'p_old', NOEXP = 'p_noexp', TRF = 'p_trf', SUPER = 'p_super';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false };

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

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: ALL, brand: { name: 'א', logoPath: '', colors: {}, base: 'dark-gold', updatedAt: 1, updatedBy: 'x' } });
    b.set(d.doc(`b/${A}/private/info`), { ownerEmail: 'o@example.invalid', ownerPhone: '0501234567', adv: {} });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true, pushTokens: [] });
    b.set(d.doc(`b/${A}/staff/${OLD}`), { name: OLD, role: 'employee', active: true, pushTokens: [] }); // עובד ישן: בלי perms
    b.set(d.doc(`b/${A}/staff/${NOEXP}`), { name: NOEXP, role: 'employee', active: true, pushTokens: [], rank: '', perms: Object.assign({}, NONE, { incW: true }) });
    b.set(d.doc(`b/${A}/staff/${TRF}`), { name: TRF, role: 'employee', active: true, pushTokens: [], rank: '', perms: Object.assign({}, NONE, { trf: true, expW: true, expR: true }) });
    for (const [u, role] of [[MGR, 'admin'], [OLD, 'worker'], [NOEXP, 'worker'], [TRF, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    for (const u of [OLD, NOEXP]) b.set(d.doc(`b/${A}/inbox/in_${u}`), { owner: u, by: u, status: 'new', created: 'x', data: '{}', parts: 1 });
    b.set(d.doc(`b/${A}/supinv/s1`), { c: 'x' });
    await b.commit();
  });
}

before(async () => { env = await H.getEnv(); await GM.start(); require('../functions/index.js'); });
after(async () => { await GM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(seed);

describe('6ה – חוקים: מתגי עובד נאכפים בשרת', () => {
  it('עובד ישן (בלי perms) – ההרשאות של היום: קורא את ההוצאות ששלח, ספקים, ושולח הוצאה', async () => {
    await assertSucceeds(db(OLD).doc(`b/${A}/inbox/in_${OLD}`).get());
    await assertSucceeds(db(OLD).doc(`b/${A}/supinv/s1`).get());
    await assertSucceeds(db(OLD).doc(`b/${A}/chunks/c_${OLD}_0`).set({ owner: OLD, data: 'x' }));
  });
  it('עקיפה: עובד בלי "רואה הוצאות" קורא הוצאות – נחסם (גם את שלו)', async () => {
    await assertFails(db(NOEXP).doc(`b/${A}/inbox/in_${NOEXP}`).get());
    await assertFails(db(NOEXP).collection(`b/${A}/inbox`).where('owner', '==', NOEXP).get());
    await assertFails(db(NOEXP).collection(`b/${A}/cashout`).get());
  });
  it('עובד בלי "מזין הוצאות" לא שולח הוצאה; בלי "ספקים" לא קורא ספקים', async () => {
    await assertFails(db(NOEXP).doc(`b/${A}/chunks/c_${NOEXP}_0`).set({ owner: NOEXP, data: 'x' }));
    await assertFails(db(NOEXP).doc(`b/${A}/supinv/s1`).get());
  });
  it('מתגי הכנסות: עם "מזין הכנסות" קורא zlast; בלי – נחסם', async () => {
    await assertSucceeds(db(NOEXP).collection(`b/${A}/zlast`).get());
    await assertFails(db(TRF).collection(`b/${A}/zlast`).get());
    await assertFails(db(TRF).collection(`b/${A}/deposits`).get());
  });
  it('מנהל העסק – הכול, בלי קשר למתגים', async () => {
    await assertSucceeds(db(MGR).doc(`b/${A}/inbox/in_${NOEXP}`).get());
    await assertSucceeds(db(MGR).doc(`b/${A}/supinv/s1`).get());
  });
  it('עקיפה: עובד משנה לעצמו מתגים ישירות במסד – נחסם; גם מנהל העסק', async () => {
    await assertFails(db(NOEXP).doc(`b/${A}/staff/${NOEXP}`).update({ perms: Object.assign({}, NONE, { expR: true }) }));
    await assertFails(db(MGR).doc(`b/${A}/staff/${NOEXP}`).update({ perms: Object.assign({}, NONE, { expR: true }) }));
    await assertFails(db(MGR).doc(`b/${A}/private/info`).update({ ranks: [] }));
  });
  it('דרגות (private/info): מנהל־על ומנהל העסק קוראים, עובד לא', async () => {
    await assertSucceeds(db(SUPER).doc(`b/${A}/private/info`).get());
    await assertSucceeds(db(MGR).doc(`b/${A}/private/info`).get());
    await assertFails(db(OLD).doc(`b/${A}/private/info`).get());
  });
});

describe('6ה – פונקציות: הוספת עובד, דרגות ומתגים רק למנהל־על', () => {
  it('עקיפה: מנהל עסק מוסיף עובד – not-superadmin, ולא נוצר כלום', async () => {
    const r = await call('addStaff', MGR, { email: 'x6e@example.invalid', name: 'x' });
    assert.equal(r.status, 'PERMISSION_DENIED', r.text); assert.equal(r.reason, 'not-superadmin');
    const s = await call('addStaff', MGR, { bizId: A, email: 'x6e@example.invalid', name: 'x' });
    assert.notEqual(s.status, 'OK', s.text);
  });
  it('מנהל העסק עדיין משבית ומחזיר עובד קיים', async () => {
    assert.equal((await call('setStaffActive', MGR, { uid: OLD, active: false })).status, 'OK');
    assert.equal((await getDoc(`b/${A}/staff/${OLD}`)).active, false);
    assert.equal((await call('setStaffActive', MGR, { uid: OLD, active: true })).status, 'OK');
  });
  it('עקיפה: עובד או מנהל עסק קוראים ל-setStaffPerms / setBusinessRanks – נחסם, ולא השתנה כלום', async () => {
    for (const u of [NOEXP, MGR]) {
      assert.equal((await call('setStaffPerms', u, { bizId: A, uid: NOEXP, perms: { expR: true } })).reason, 'not-superadmin');
      assert.equal((await call('setBusinessRanks', u, { bizId: A, ranks: [] })).reason, 'not-superadmin');
    }
    assert.equal((await getDoc(`b/${A}/staff/${NOEXP}`)).perms.expR, false);
  });
  it('מנהל־על: דרגה = תבנית, ואחר כך מתג בודד; addStaff עם דרגה; audit', async () => {
    const rk = await call('setBusinessRanks', SUPER, { bizId: A, ranks: [{ id: 'cash', name: 'קופאי', perms: { incW: true, expW: true } }] });
    assert.equal(rk.status, 'OK', rk.text);
    assert.deepEqual((await getDoc(`b/${A}/private/info`)).ranks[0].perms, Object.assign({}, NONE, { incW: true, expW: true }));
    assert.equal((await getDoc(`b/${A}/private/info`)).ownerEmail, 'o@example.invalid', 'שאר השדות נשמרו');
    const p1 = await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, rank: 'cash' });
    assert.equal(p1.status, 'OK', p1.text);
    assert.equal((await getDoc(`b/${A}/staff/${OLD}`)).rank, 'cash');
    await assertFails(db(OLD).doc(`b/${A}/supinv/s1`).get()); // הדרגה בלי "ספקים"
    const p2 = await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: Object.assign({}, p1.result.perms, { sup: true }) });
    assert.equal(p2.status, 'OK', p2.text);
    await assertSucceeds(db(OLD).doc(`b/${A}/supinv/s1`).get()); // מתג בודד לעובד הזה
    const add = await call('addStaff', SUPER, { bizId: A, email: 'new6e@example.invalid', name: 'חדש', rank: 'cash' });
    assert.equal(add.status, 'OK', add.text);
    const ns = await getDoc(`b/${A}/staff/${add.result.uid}`);
    assert.equal(ns.rank, 'cash'); assert.equal(ns.perms.incW, true); assert.equal(ns.perms.sup, false);
    let acts = []; await prep(async (d) => { acts = (await d.collection(`b/${A}/audit`).get()).docs.map((x) => x.get('act')); });
    for (const a of ['setBusinessRanks', 'setStaffPerms', 'addStaff']) assert.ok(acts.includes(a), a);
  });
  it('קלט לא תקין: מתג לא מוכר, דרגה שלא קיימת, מנהל, legacy', async () => {
    assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { admin: true } })).reason, 'bad-perms');
    assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { expR: 'yes' } })).reason, 'bad-perms');
    assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, rank: 'nope' })).reason, 'bad-rank');
    assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: MGR, perms: {} })).reason, 'is-admin');
    assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: 'ghost', perms: {} })).reason, 'no-staff');
    assert.equal((await call('setBusinessRanks', SUPER, { bizId: A, ranks: [{ id: 'a', name: 'x', perms: {} }, { id: 'a', name: 'y', perms: {} }] })).reason, 'bad-ranks');
    assert.equal((await call('setBusinessRanks', SUPER, { bizId: 'largpeami', ranks: [] })).reason, 'no-biz'); // אין b/largpeami בזריעה (כמו בייצור לפני ההעברה)
    await prep((d) => d.doc('b/largpeami').set({ name: 'L', status: 'active', dataRoot: 'legacy' }));
    assert.equal((await call('setBusinessRanks', SUPER, { bizId: 'largpeami', ranks: [] })).reason, 'legacy-biz');
    assert.equal((await call('setStaffPerms', SUPER, { bizId: 'largpeami', uid: OLD, perms: {} })).reason, 'legacy-biz');
  });
  it('2026-11-12 מצב העסק: bal + balB (סניפים) נשמרים בעובד ובדרגה; balB ריק לא נשמר; קלט לא תקין נחסם', async () => {
    const p = await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { bal: true, balB: ['br_a', 'br_a', 'zz'] } });
    assert.equal(p.status, 'OK', p.text);
    const sp = (await getDoc(`b/${A}/staff/${OLD}`)).perms;
    assert.equal(sp.bal, true); assert.deepEqual(sp.balB, ['br_a', 'zz']);
    const q = await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { bal: true, balB: [] } });
    assert.equal(q.status, 'OK', q.text); assert.equal((await getDoc(`b/${A}/staff/${OLD}`)).perms.balB, undefined);
    for (const balB of ['br_a', ['Bad-ID'], ['x'], [1], Array.from({ length: 21 }, (_, i) => 'b' + i)]) {
      assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { bal: true, balB } })).reason, 'bad-perms', JSON.stringify(balB));
    }
    assert.equal((await call('setStaffPerms', SUPER, { bizId: A, uid: OLD, perms: { bal: 'yes' } })).reason, 'bad-perms');
    const rk = await call('setBusinessRanks', SUPER, { bizId: A, ranks: [{ id: 'br', name: 'מנהל סניף', perms: { bal: true, balB: ['br_b'] } }] });
    assert.equal(rk.status, 'OK', rk.text);
    assert.deepEqual((await getDoc(`b/${A}/private/info`)).ranks[0].perms, Object.assign({}, NONE, { bal: true, balB: ['br_b'] }));
    const add = await call('addStaff', SUPER, { bizId: A, email: 'bal6e@example.invalid', name: 'סניף', rank: 'br' });
    assert.equal(add.status, 'OK', add.text);
    assert.deepEqual((await getDoc(`b/${A}/staff/${add.result.uid}`)).perms.balB, ['br_b']);
  });
  it('זיהוי חכם: צילום העברה – עובד עם מתג "צילום העברות" עובר את בדיקת ההרשאה; בלי "מזין הוצאות" – חשבונית נחסמת', async () => {
    const jpg = () => { const b = Buffer.alloc(200); Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(b); return { mimeType: 'image/jpeg', data: b.toString('base64') }; };
    assert.equal((await call('scanDocument', OLD, { kind: 'transfer', files: [jpg()] })).reason, 'manager-only');
    assert.notEqual((await call('scanDocument', TRF, { kind: 'transfer', files: [jpg()] })).reason, 'manager-only');
    assert.equal((await call('scanDocument', NOEXP, { kind: 'invoice', files: [jpg()] })).reason, 'no-perm');
    assert.notEqual((await call('scanDocument', OLD, { kind: 'invoice', files: [jpg()] })).reason, 'no-perm');
  });
});
