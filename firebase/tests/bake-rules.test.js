'use strict';
// עלות מוצרי אפייה (26.11.2026, שלב א'): האוסף b/{bizId}/bake – התוספת bake והמתג bake ("עלות מוצרי אפייה").
// רץ מול אמולטור Firestore (חלק מ-test:multibiz:5). עסק במבנה b עם bake דלוק, ועסק עם bake כבוי. בשורש אין bake.
// השם bake ולא bk: bk הוא אוסף הגיבוי לענן (מנהל בלבד), וגיבוי מוחק בו כל מסמך שאינו חלק מהגיבוי האחרון.
const { describe, it, before, after, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-bk', OFF = 'biz-bk-off', SUS = 'biz-bk-sus';
const MGR = 'k_mgr', BK = 'k_bk', NOB = 'k_nob', OLD = 'k_old', OUT = 'k_out', OTH = 'k_oth', RMGR = 'kr_mgr';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false, shf: false, yl: false, tkS: false, lbl: false, bake: false };

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
const rec = (uid, x) => Object.assign({ t: 'i', j: '{"n":"קמח","u":"g","q":1000,"p":5}', at: Date.now(), by: uid }, x || {});

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    const biz = (id, bake, status) => b.set(d.doc('b/' + id), { name: id, status: status || 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { bake, orders: true } });
    biz(A, true); biz(OFF, false); biz(SUS, true, 'suspended');
    for (const z of [A, OFF, SUS]) {
      b.set(d.doc(`b/${z}/admins/${MGR}`), { email: MGR + '@example.invalid' });
      b.set(d.doc(`b/${z}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
      b.set(d.doc(`b/${z}/staff/${BK}`), { name: BK, role: 'employee', active: true, perms: Object.assign({}, NONE, { bake: true }) });
      b.set(d.doc(`b/${z}/staff/${NOB}`), { name: NOB, role: 'employee', active: true, perms: Object.assign({}, NONE, { expR: true, expW: true, sup: true, ord: true, prc: true, lbl: true }) });
      b.set(d.doc(`b/${z}/staff/${OLD}`), { name: OLD, role: 'employee', active: true }); // עובד ישן בלי perms: bake כבוי
      b.set(d.doc(`b/${z}/staff/${OUT}`), { name: OUT, role: 'employee', active: false, perms: Object.assign({}, NONE, { bake: true }) });
      b.set(d.doc(`b/${z}/bake/i1`), rec(MGR));
    }
    // עובד עם bake של עסק אחר (OFF) בלבד
    b.set(d.doc(`b/${OFF}/staff/${OTH}`), { name: OTH, role: 'employee', active: true, perms: Object.assign({}, NONE, { bake: true }) });
    // לארג' פעמי בשורש (legacy): מנהל בשורש; bake בשורש קיים רק בזריעה. bk = גיבוי לענן (לבדיקה שהמתג bake לא פותח אותו)
    b.set(d.doc('admins/' + RMGR), { email: RMGR + '@example.invalid' });
    b.set(d.doc('bake/i1'), rec(RMGR));
    b.set(d.doc(`b/${A}/bk/meta`), { data: '{}', owner: MGR });
    await b.commit();
  });
}

before(async () => { env = await H.getEnv(); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(seed);

describe('עלות מוצרי אפייה – חוקים (b/{bizId}/bake)', () => {
  it('מורשים: מנהל ועובד עם bake קוראים, יוצרים ומעדכנים (כל סוגי הרשומות)', async () => {
    for (const u of [MGR, BK]) {
      await assertSucceeds(db(u).collection(`b/${A}/bake`).get(), u);
      await assertSucceeds(db(u).doc(`b/${A}/bake/i1`).get(), u);
      await assertSucceeds(db(u).doc(`b/${A}/bake/c_${u}`).set(rec(u, { t: 'c' })), u);
      await assertSucceeds(db(u).doc(`b/${A}/bake/p-${u}`).set(rec(u, { t: 'p', j: '{}' })), u);
      await assertSucceeds(db(u).doc(`b/${A}/bake/i1`).set(rec(u, { j: '{"n":"קמח","off":1}' })), u);
    }
    // עריכה בלי חיבור שנשלחה מאוחר (at בעבר) – מותרת; גם הגודל המרבי
    await assertSucceeds(db(BK).doc(`b/${A}/bake/i1`).set(rec(BK, { at: Date.now() - 5 * 86400000 })));
    await assertSucceeds(db(BK).doc(`b/${A}/bake/big`).set(rec(BK, { j: 'x'.repeat(16000) })));
  });
  it('חסומים: עובד בלי bake, עובד ישן בלי perms, עובד מושבת, עובד של עסק אחר, אורח', async () => {
    for (const u of [NOB, OLD, OUT, OTH]) {
      await assertFails(db(u).collection(`b/${A}/bake`).get(), u);
      await assertFails(db(u).doc(`b/${A}/bake/i1`).get(), u);
      await assertFails(db(u).doc(`b/${A}/bake/x_${u}`).set(rec(u)), u);
      await assertFails(db(u).doc(`b/${A}/bake/i1`).set(rec(u)), u);
    }
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(anon.doc(`b/${A}/bake/i1`).get());
    await assertFails(anon.doc(`b/${A}/bake/x`).set(rec('x')));
  });
  it('תוספת כבויה: כולם חסומים, גם המנהל; עסק מושהה: עובד חסום', async () => {
    for (const u of [MGR, BK]) {
      await assertFails(db(u).collection(`b/${OFF}/bake`).get(), u);
      await assertFails(db(u).doc(`b/${OFF}/bake/i1`).get(), u);
      await assertFails(db(u).doc(`b/${OFF}/bake/x1`).set(rec(u)), u);
      await assertFails(db(u).doc(`b/${OFF}/bake/i1`).delete(), u);
    }
    await assertFails(db(OTH).doc(`b/${OFF}/bake/i1`).get());
    await assertFails(db(BK).collection(`b/${SUS}/bake`).get());
    await assertFails(db(BK).doc(`b/${SUS}/bake/x1`).set(rec(BK)));
  });
  it('תוכן לא תקין נדחה (יצירה ועדכון)', async () => {
    const bad = [
      { extra: 1 }, { t: 'x' }, { t: 1 }, { j: 5 }, { j: '{' }, { j: 'x'.repeat(16001) }, { by: MGR }, { at: 'now' }, { at: 1.5 },
      { at: 0 }, { at: 1700000000 }, { at: Date.now() + 3600000 },
    ];
    for (const x of bad) {
      await assertFails(db(BK).doc(`b/${A}/bake/bad`).set(rec(BK, x)), JSON.stringify(x).slice(0, 40));
      await assertFails(db(BK).doc(`b/${A}/bake/i1`).set(rec(BK, x)), 'עדכון ' + JSON.stringify(x).slice(0, 40));
    }
    for (const k of ['t', 'j', 'at', 'by']) {
      const r = rec(BK); delete r[k];
      await assertFails(db(BK).doc(`b/${A}/bake/bad`).set(r), 'חסר ' + k);
    }
    await assertFails(db(BK).doc(`b/${A}/bake/bad id`).set(rec(BK)), 'מזהה לא תקין');
    await assertFails(db(BK).doc(`b/${A}/bake/${'a'.repeat(41)}`).set(rec(BK)), 'מזהה ארוך');
    await assertFails(db(BK).doc(`b/${A}/bake/i1`).set(rec(BK, { t: 'p' })), 'סוג הרשומה לא משתנה בעדכון');
    await assertFails(db(MGR).doc(`b/${A}/bake/i1`).set(rec(MGR, { t: 'c' })), 'גם למנהל');
  });
  it('המתג bake לא פותח את אוסף הגיבוי bk (מנהל בלבד)', async () => {
    await assertFails(db(BK).doc(`b/${A}/bk/meta`).get());
    await assertFails(db(BK).collection(`b/${A}/bk`).get());
    await assertFails(db(BK).doc(`b/${A}/bk/x1`).set(rec(BK)));
    await assertSucceeds(db(MGR).doc(`b/${A}/bk/meta`).get());
  });
  it('מחיקה: רק המנהל; עובד עם bake נחסם (הסתרה = off:1 בתוך j)', async () => {
    await assertFails(db(BK).doc(`b/${A}/bake/i1`).delete());
    await assertFails(db(NOB).doc(`b/${A}/bake/i1`).delete());
    await assertSucceeds(db(MGR).doc(`b/${A}/bake/i1`).delete());
  });
  it('שורש: bake בשורש חסום לכולם (גם למנהל לארג\' פעמי בשורש ולמנהל עסק)', async () => {
    for (const u of [RMGR, MGR, BK]) {
      await assertFails(db(u).collection('bake').get(), u);
      await assertFails(db(u).doc('bake/i1').get(), u);
      await assertFails(db(u).doc('bake/x1').set(rec(u)), u);
      await assertFails(db(u).doc('bake/i1').delete(), u);
    }
  });
});
