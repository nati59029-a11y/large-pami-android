'use strict';
// שלושת המקרים שהתוכנית דורשת בבדיקות נפרדות:
// 1. חשבון שאינו ב-staff לא קורא את cfg ולא כותב ל-shelf (התנאי לסיום של שלב 0).
// 2. עובד מושבת נחסם מיד – בבקשה הבאה, עם אותו טוקן, בלי להתחבר מחדש.
// 3. אף אחד לא כותב ל-staff או ל-app_backup_status ישירות – כולל מנהל.

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const { fsx, sv } = H;

describe('מקרים מיוחדים', () => {
  let env;
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); });

  // ---- מקרה 1 ----
  it('1א. מחובר שאינו ב-staff לא קורא את cfg/main (SDK + REST כמו באפליקציה)', async () => {
    const db = env.authenticatedContext('stranger', { email: 'stranger@example.invalid' }).firestore();
    await assertFails(db.doc('cfg/main').get());
    await assertFails(db.collection('cfg').get());
    const r = await fsx('stranger', '/cfg/main');
    assert.equal(r.status, 403);
    H.record('special', { key: 'case1-cfg' });
  });

  it('1ב. מחובר שאינו ב-staff לא כותב ל-shelf (SDK + REST כמו באפליקציה)', async () => {
    const db = env.authenticatedContext('stranger').firestore();
    await assertFails(db.doc('shelf/price').set({ data: '{"items":[]}', at: '9' }));
    await assertFails(db.doc('shelf/new1').set({ data: '{}', at: '9' }));
    await assertFails(db.doc('shelf/price').delete());
    const r = await fsx('stranger', '/shelf/price', { method: 'PATCH', body: JSON.stringify({ fields: { data: sv('{"items":[]}'), at: sv(Date.now()) } }) });
    assert.equal(r.status, 403);
    // וגם: מפתח Gemini לא נקרא – אין דרך לקרוא את cfg
    H.record('special', { key: 'case1-shelf' });
  });

  // ---- מקרה 2 ----
  it('2. עובד מושבת נחסם מיד: אותו טוקן, הבקשה הבאה אחרי ההשבתה נחסמת', async () => {
    const uid = 'u_emp';
    // לפני ההשבתה – עובד פעיל קורא cfg ו-shelf וכותב ל-shelf
    assert.equal((await fsx(uid, '/cfg/main')).status, 200);
    assert.equal((await fsx(uid, '/shelf/price')).status, 200);
    // המנהל משבית (בשרת – כאן בלי כללים, כמו פונקציה בשרת)
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('staff/' + uid).update({ active: false }));
    // אותו משתמש, בלי כניסה מחדש – הכול נחסם
    assert.equal((await fsx(uid, '/cfg/main')).status, 403);
    assert.equal((await fsx(uid, '/shelf/price')).status, 403);
    assert.equal((await fsx(uid, '/shelf/price', { method: 'PATCH', body: JSON.stringify({ fields: { data: sv('{}'), at: sv(1) } }) })).status, 403);
    const q = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'inbox' }], where: { fieldFilter: { field: { fieldPath: 'owner' }, op: 'EQUAL', value: { stringValue: uid } } }, limit: 300 } }) });
    assert.equal(q.status, 403);
    const c = await fsx(uid, '/chunks?documentId=zz_0', { method: 'POST', body: JSON.stringify({ fields: { owner: sv(uid), data: sv('x') } }) });
    assert.equal(c.status, 403);
    // וגם ב-Storage – הגיבוי שלו
    const st = env.authenticatedContext(uid).storage();
    await assertFails(new Promise((res, rej) => st.ref(`app_backups/${uid}/x.bin`).put(new Uint8Array([1]), { contentType: 'application/octet-stream' }).then(res, rej)));
    // והפעלה מחדש מחזירה את הגישה
    await env.withSecurityRulesDisabled((c2) => c2.firestore().doc('staff/' + uid).update({ active: true }));
    assert.equal((await fsx(uid, '/cfg/main')).status, 200);
    H.record('special', { key: 'case2-disabled-immediately' });
  });

  it('2ב. עובד מושבת לא יכול להפעיל את עצמו מחדש', async () => {
    const db = env.authenticatedContext('u_off').firestore();
    await assertFails(db.doc('staff/u_off').update({ active: true }));
    await assertFails(db.doc('staff/u_off').set({ active: true }, { merge: true }));
    H.record('special', { key: 'case2-no-self-reactivate' });
  });

  // ---- מקרה 3 ----
  for (const role of H.ROLES) {
    it(`3. ${role}: לא כותב ל-staff ול-app_backup_status בשום צורה (יצירה, עדכון, מחיקה)`, async () => {
      const db = H.ctxFor(env, role).firestore();
      const me = H.UID[role] || 'nobody';
      for (const coll of ['staff', 'app_backup_status']) {
        await assertFails(db.doc(`${coll}/${me}`).set({ active: true, lastBackupAt: 'x' }));
        await assertFails(db.doc(`${coll}/${me}`).set({ active: true }, { merge: true }));
        await assertFails(db.doc(`${coll}/brand_new_${role}`).set({ active: true }));
        await assertFails(db.doc(`${coll}/${H.OTHER}`).update({ active: false, size: 0 }));
        await assertFails(db.doc(`${coll}/${H.OTHER}`).delete());
      }
      if (H.UID[role]) {
        // גם ב-REST, כמו שהאפליקציה כותבת (PATCH)
        for (const coll of ['staff', 'app_backup_status']) {
          const r = await fsx(me, `/${coll}/${me}`, { method: 'PATCH', body: JSON.stringify({ fields: { active: { booleanValue: true } } }) });
          assert.equal(r.status, 403);
        }
      }
      H.record('special', { key: `case3-${role}` });
    });
  }

  it('3ב. מנהל כמו היום (רק admins) גם הוא לא כותב ל-staff ול-app_backup_status', async () => {
    const db = env.authenticatedContext(H.MANAGER_ONLY_ADMINS).firestore();
    await assertFails(db.doc('staff/' + H.MANAGER_ONLY_ADMINS).set({ role: 'manager', active: true }));
    await assertFails(db.doc('app_backup_status/' + H.MANAGER_ONLY_ADMINS).set({ size: 1 }));
    H.record('special', { key: 'case3-manager-admins-only' });
  });

  // ---- נוסף: כתובת אנונימית / חשבון אנונימי לא פותח כלום ----
  it('נוסף: חשבון "אנונימי" של Firebase (מחובר בלי מייל) לא מקבל גישה לשום אוסף', async () => {
    const db = env.authenticatedContext('anon1', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
    for (const p of ['cfg/main', 'shelf/price', 'fb/fb_ok', 'bk/meta', `inbox/i_${H.OTHER}`, `chunks/c_${H.OTHER}_0`, 'staff/u_emp', 'app_backup_status/u_emp']) {
      await assertFails(db.doc(p).get());
    }
    H.record('special', { key: 'anonymous' });
  });
});
