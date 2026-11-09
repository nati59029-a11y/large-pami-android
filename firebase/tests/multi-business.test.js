'use strict';
// ריבוי עסקים (משימה 2026-11-05, שלב 2): בדיקות בידוד בין עסקים, תוספות, השהיה, מסמך העסק ו-Storage.
// רץ לבד (לא דרך all.test.js, שלא משתנה), מול האמולטור בלבד:
//   firebase emulators:exec --only auth,firestore,storage --project demo-largpeami "node --test tests/multi-business.test.js"
// שני עסקים: biz-a ו-biz-b. 7 תפקידים: מנהל א', עובד א', מנהל ב', עובד ב', מנהל־על, עובד מושבת (של העסק הנבדק),
// ומשתמש מחובר בלי עסק. לכל אוסף × פעולה (get/list/create/update/delete) × תפקיד × כיוון (א'←ב' וב'←א') יש בדיקה.
// מנהל ועובד של העסק השני – תמיד "נחסם". בתוך העסק עצמו – "מותר" לפי הכללים בשורש (ויש לכל "נחסם" בדיקת "מותר" תואמת).

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-a', B = 'biz-b';
const ALL_FEATURES = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const U = {
  [A]: { mgr: 'a_mgr', emp: 'a_emp', off: 'a_off' },
  [B]: { mgr: 'b_mgr', emp: 'b_emp', off: 'b_off' },
  super: 'u_super', nobiz: 'u_nobiz',
};
const ROLES7 = ['mgrA', 'empA', 'mgrB', 'empB', 'super', 'off', 'nobiz'];
const ROLE_NAMES = { mgrA: "מנהל א'", empA: "עובד א'", mgrB: "מנהל ב'", empB: "עובד ב'", super: 'מנהל־על', off: 'עובד מושבת', nobiz: 'מחובר בלי עסק' };
const other = (biz) => (biz === A ? B : A);
// התפקיד בפועל מול העסק הנבדק: 'mgr'/'emp' של העסק עצמו, 'foreign' של העסק השני
function resolve(role, biz) {
  if (role === 'super') return { uid: U.super, rel: 'super' };
  if (role === 'nobiz') return { uid: U.nobiz, rel: 'nobiz' };
  if (role === 'off') return { uid: U[biz].off, rel: 'off' };
  const b = role.endsWith('A') ? A : B;
  const k = role.slice(0, 3);
  return { uid: U[b][k], rel: b === biz ? k : 'foreign' };
}

let env;
let seq = 0;
const fresh = (p) => `${p || 'x'}_${Date.now()}_${++seq}`;
const now = () => Date.now();
const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
const st = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).storage();
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const prepSt = (fn) => env.withSecurityRulesDisabled((c) => fn(c.storage()));
async function getDoc(p) { let v = null; await prep(async (db) => { const x = await db.doc(p).get(); v = x.exists ? x.data() : null; }); return v; }
const up = (ref, data, meta) => new Promise((res, rej) => ref.put(data, meta).then(res, rej));

function bizDoc(biz, o) {
  return Object.assign({ name: 'עסק ' + biz, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: U.super, bizId: biz,
    features: Object.assign({}, ALL_FEATURES), brand: { name: 'עסק', logoPath: '', colors: { acc: '#c9a227' }, base: 'dark-gold', updatedAt: 1, updatedBy: 'x' } }, o);
}

async function seedAll() {
  await env.clearFirestore();
  await prep(async (db) => {
    const b = db.batch();
    b.set(db.doc('superadmins/' + U.super), {});
    for (const biz of [A, B]) {
      const u = U[biz];
      b.set(db.doc('b/' + biz), bizDoc(biz));
      b.set(db.doc(`b/${biz}/admins/${u.mgr}`), { email: u.mgr + '@example.invalid' });
      b.set(db.doc(`b/${biz}/staff/${u.mgr}`), { name: u.mgr, role: 'manager', active: true });
      b.set(db.doc(`b/${biz}/staff/${u.emp}`), { name: u.emp, role: 'employee', active: true });
      b.set(db.doc(`b/${biz}/staff/${u.off}`), { name: u.off, role: 'employee', active: false });
      // שלב 5 (עדכון חוזה 6): השרת שומר ב-users/{uid} גם role, active ו-bizStatus (מה שכללי Storage קוראים)
      for (const k of ['mgr', 'emp', 'off']) b.set(db.doc('users/' + u[k]), { bizId: biz, role: k === 'mgr' ? 'admin' : 'worker', active: k !== 'off', bizStatus: 'active', email: u[k] + '@example.invalid', createdAt: 1 });
    }
    await b.commit();
  });
}

// ---- פעולות לכל אוסף. כל פעולה: { run(db, biz, uid) , allow: [תפקידים בתוך העסק שמותרים] } ----
// תפקידים בתוך העסק: mgr, emp, super (מנהל־על = מנהל מלא בכל עסק), off, nobiz. foreign תמיד נחסם.
const P = (biz) => 'b/' + biz;
const S = ['mgr', 'emp', 'super'];   // צוות (מנהל, עובד פעיל, מנהל־על)
const M = ['mgr', 'super'];          // מנהל (ומנהל־על)
const NONE = [];

const simple = (coll, readAllow, writeAllow, body) => ({
  get: { allow: readAllow, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/${coll}/g1`).set(body())); return db.doc(`${P(biz)}/${coll}/g1`).get(); } },
  list: { allow: readAllow, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/${coll}/g1`).set(body())); return db.collection(`${P(biz)}/${coll}`).get(); } },
  create: { allow: writeAllow, run: (db, biz) => db.doc(`${P(biz)}/${coll}/${fresh()}`).set(body()) },
  update: { allow: writeAllow, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/${coll}/u1`).set(body())); return db.doc(`${P(biz)}/${coll}/u1`).set(body()); } },
  delete: { allow: writeAllow, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/${coll}/${id}`).set(body())); return db.doc(`${P(biz)}/${coll}/${id}`).delete(); } },
});

const taskBody = (uid, o) => Object.assign({ owner: uid, by: uid, role: 'w', txt: 'משימה', cr: now(), due: now() + 4 * 86400000, st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '' }, o);
const closingBody = (uid, o) => Object.assign({ uid, by: uid, t: now(), st: 'new', np: 1, reg: 'i_nl', d: '2026-11-01', no: '1', data: '{}' }, o);
const depBody = (uid, o) => Object.assign({ uid, by: uid, t: now(), d: '2026-11-01', items: ['co1'], a: 10, st: 'new', why: '', np: 1, data: '{}' }, o);
const coBody = (uid, id, o) => Object.assign({ uid, by: uid, t: now(), reg: 'i_nl', d: '2026-11-01', a: 10, why: 'קניתי חלב', dep: '', src: id, zc: '', dp: '' }, o);
const inboxBody = (uid, o) => Object.assign({ owner: uid, by: uid, status: 'new', created: 'x', data: '{}', parts: '1', t: now() }, o);
const mqBody = (uid, o) => Object.assign({ uid, by: uid, t: now(), st: 'new', k: 'invoice', np: 1 }, o);
const stUpd = (uid, st) => ({ st, stBy: uid, stAt: now() });
// תת-אוסף p של מסמך שנוצר על ידי המשתמש עצמו (appreq / closings / deposits)
const partsOf = (coll, parentBody, readAllow) => ({
  get: { allow: readAllow, run: async (db, biz, uid) => { await prep(async (a) => { await a.doc(`${P(biz)}/${coll}/q1`).set(parentBody('x')); await a.doc(`${P(biz)}/${coll}/q1/p/0`).set({ data: 'x' }); }); return db.doc(`${P(biz)}/${coll}/q1/p/0`).get(); } },
  list: { allow: readAllow, run: async (db, biz) => { await prep(async (a) => { await a.doc(`${P(biz)}/${coll}/q1`).set(parentBody('x')); await a.doc(`${P(biz)}/${coll}/q1/p/0`).set({ data: 'x' }); }); return db.collection(`${P(biz)}/${coll}/q1/p`).get(); } },
  create: { allow: S, run: async (db, biz, uid) => { const id = fresh('q'); await prep((a) => a.doc(`${P(biz)}/${coll}/${id}`).set(parentBody(uid))); return db.doc(`${P(biz)}/${coll}/${id}/p/0`).set({ data: 'x' }); } },
  update: { allow: NONE, run: async (db, biz, uid) => { const id = fresh('q'); await prep(async (a) => { await a.doc(`${P(biz)}/${coll}/${id}`).set(parentBody(uid)); await a.doc(`${P(biz)}/${coll}/${id}/p/0`).set({ data: 'x' }); }); return db.doc(`${P(biz)}/${coll}/${id}/p/0`).set({ data: 'y' }); } },
  delete: { allow: M, run: async (db, biz) => { const id = fresh('q'); await prep(async (a) => { await a.doc(`${P(biz)}/${coll}/${id}`).set(parentBody('x')); await a.doc(`${P(biz)}/${coll}/${id}/p/0`).set({ data: 'x' }); }); return db.doc(`${P(biz)}/${coll}/${id}/p/0`).delete(); } },
});

const OPS = {
  'מסמך העסק b/{bizId}': {
    get: { allow: S, run: (db, biz) => db.doc(P(biz)).get() },
    list: { allow: ['super'], run: (db) => db.collection('b').get() },
    create: { allow: NONE, run: (db, biz) => db.doc(P(biz) + '-new').set(bizDoc(biz + '-new')) },
    // עדכון חוזה 14: brand נכתב רק דרך setBusinessBrand (מנהל־על, audit) – אף אחד לא כותב אותו מהאפליקציה (בדיקה נפרדת למטה).
    // הכתיבה היחידה מהאפליקציה למסמך העסק: migrationTarget, מנהל־על בלבד (עדכון חוזה 7א).
    update: { allow: ['super'], run: (db, biz) => db.doc(P(biz)).update({ migrationTarget: false }) },
    delete: { allow: NONE, run: (db, biz) => db.doc(P(biz)).delete() },
  },
  admins: {
    get: { allow: S, run: (db, biz, uid) => db.doc(`${P(biz)}/admins/${uid}`).get() },
    list: { allow: NONE, run: (db, biz) => db.collection(`${P(biz)}/admins`).get() },
    create: { allow: NONE, run: (db, biz, uid) => db.doc(`${P(biz)}/admins/${uid}`).set({ email: 'x' }) },
    update: { allow: NONE, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/admins/zz_victim`).set({ email: 'v' })); return db.doc(`${P(biz)}/admins/zz_victim`).set({ email: 'x' }); } },
    delete: { allow: NONE, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/admins/zz_victim`).set({ email: 'v' })); return db.doc(`${P(biz)}/admins/zz_victim`).delete(); } },
  },
  staff: {
    get: { allow: S, run: (db, biz, uid) => db.doc(`${P(biz)}/staff/${uid}`).get() },
    list: { allow: M, run: (db, biz) => db.collection(`${P(biz)}/staff`).get() },
    create: { allow: NONE, run: (db, biz, uid) => db.doc(`${P(biz)}/staff/${uid}`).set({ name: uid, role: 'employee', active: true }) },
    update: { allow: NONE, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/staff/zz_victim`).set({ active: false })); return db.doc(`${P(biz)}/staff/zz_victim`).update({ active: true }); } },
    delete: { allow: NONE, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/staff/zz_victim`).set({ active: false })); return db.doc(`${P(biz)}/staff/zz_victim`).delete(); } },
  },
  app_backup_status: {
    get: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/app_backup_status/${uid}`).set({ size: 1 })); return db.doc(`${P(biz)}/app_backup_status/${uid}`).get(); } },
    list: { allow: M, run: (db, biz) => db.collection(`${P(biz)}/app_backup_status`).get() },
    create: { allow: NONE, run: (db, biz) => db.doc(`${P(biz)}/app_backup_status/${fresh()}`).set({ size: 1 }) },
    update: { allow: NONE, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/app_backup_status/${uid}`).set({ size: 1 })); return db.doc(`${P(biz)}/app_backup_status/${uid}`).set({ size: 2 }); } },
    delete: { allow: NONE, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/app_backup_status/${uid}`).set({ size: 1 })); return db.doc(`${P(biz)}/app_backup_status/${uid}`).delete(); } },
  },
  cfg: simple('cfg', S, M, () => ({ data: '{}' })),
  bk: simple('bk', M, M, () => ({ data: '{}', owner: 'x' })),
  shelf: simple('shelf', S, S, () => ({ data: '{}', at: '1' })),
  fb: {
    get: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/fb/ok1`).set({ st: 'ok', owner: 'x', data: '{}' })); return db.doc(`${P(biz)}/fb/ok1`).get(); } },
    list: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/fb/ok1`).set({ st: 'ok', owner: 'x', data: '{}' })); return db.collection(`${P(biz)}/fb`).where('st', '==', 'ok').get(); } },
    create: { allow: S, run: (db, biz, uid) => db.doc(`${P(biz)}/fb/${fresh()}`).set({ owner: uid, st: 'new', data: '{}' }) },
    update: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/fb/u1`).set({ st: 'new', owner: 'x', data: '{}' })); return db.doc(`${P(biz)}/fb/u1`).update({ st: 'ok' }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/fb/${id}`).set({ st: 'new', owner: 'x' })); return db.doc(`${P(biz)}/fb/${id}`).delete(); } },
  },
  chunks: {
    get: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/chunks/own_${uid}_0`).set({ owner: uid, data: 'x' })); return db.doc(`${P(biz)}/chunks/own_${uid}_0`).get(); } },
    list: { allow: S, run: (db, biz, uid) => db.collection(`${P(biz)}/chunks`).where('owner', '==', uid).get() },
    create: { allow: ['emp'], run: (db, biz, uid) => db.doc(`${P(biz)}/chunks/${fresh('c')}_0`).set({ owner: uid, data: 'x' }) },
    update: { allow: NONE, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/chunks/own_${uid}_0`).set({ owner: uid, data: 'x' })); return db.doc(`${P(biz)}/chunks/own_${uid}_0`).set({ owner: uid, data: 'y' }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh('c') + '_0'; await prep((a) => a.doc(`${P(biz)}/chunks/${id}`).set({ owner: 'x', data: 'x' })); return db.doc(`${P(biz)}/chunks/${id}`).delete(); } },
  },
  inbox: {
    get: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/inbox/own_${uid}`).set(inboxBody(uid))); return db.doc(`${P(biz)}/inbox/own_${uid}`).get(); } },
    list: { allow: S, run: (db, biz, uid) => db.collection(`${P(biz)}/inbox`).where('owner', '==', uid).get() },
    create: { allow: ['emp'], run: async (db, biz, uid) => { const id = fresh('i'); await prep((a) => a.doc(`${P(biz)}/chunks/${id}_0`).set({ owner: uid, data: 'x' })); return db.doc(`${P(biz)}/inbox/${id}`).set(inboxBody(uid)); } },
    update: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/inbox/u1`).set(inboxBody('x'))); return db.doc(`${P(biz)}/inbox/u1`).update({ status: 'done' }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/inbox/${id}`).set(inboxBody('x'))); return db.doc(`${P(biz)}/inbox/${id}`).delete(); } },
  },
  tasks: {
    get: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/tasks/t1`).set(taskBody('x'))); return db.doc(`${P(biz)}/tasks/t1`).get(); } },
    list: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/tasks/t1`).set(taskBody('x'))); return db.collection(`${P(biz)}/tasks`).where('open', '==', '1').get(); } },
    create: { allow: S, run: (db, biz, uid) => db.doc(`${P(biz)}/tasks/${fresh()}`).set(taskBody(uid)) },
    update: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/tasks/tu`).set(taskBody('x'))); return db.doc(`${P(biz)}/tasks/tu`).update({ cAt: now(), cBy: uid }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/tasks/${id}`).set(taskBody('x'))); return db.doc(`${P(biz)}/tasks/${id}`).delete(); } },
  },
  'tasks/c': {
    get: { allow: S, run: async (db, biz) => { await prep(async (a) => { await a.doc(`${P(biz)}/tasks/t1`).set(taskBody('x')); await a.doc(`${P(biz)}/tasks/t1/c/c1`).set({ uid: 'x', by: 'x', txt: 'a', t: 1 }); }); return db.doc(`${P(biz)}/tasks/t1/c/c1`).get(); } },
    list: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/tasks/t1`).set(taskBody('x'))); return db.collection(`${P(biz)}/tasks/t1/c`).get(); } },
    create: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/tasks/tnc`).set(taskBody('x', { nc: '1' }))); return db.doc(`${P(biz)}/tasks/tnc/c/${fresh()}`).set({ uid, by: uid, txt: 'תגובה', t: now() }); } },
    update: { allow: NONE, run: async (db, biz, uid) => { await prep(async (a) => { await a.doc(`${P(biz)}/tasks/t1`).set(taskBody('x')); await a.doc(`${P(biz)}/tasks/t1/c/cu`).set({ uid, by: uid, txt: 'a', t: now() }); }); return db.doc(`${P(biz)}/tasks/t1/c/cu`).update({ txt: 'b' }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep(async (a) => { await a.doc(`${P(biz)}/tasks/t1`).set(taskBody('x')); await a.doc(`${P(biz)}/tasks/t1/c/${id}`).set({ uid: 'x', by: 'x', txt: 'a', t: 1 }); }); return db.doc(`${P(biz)}/tasks/t1/c/${id}`).delete(); } },
  },
  supinv: simple('supinv', S, M, () => ({ c: 'ספקים', n: 'ספק', d: '2026-11-01', a: '10', m: '2026-11' })),
  'supinv/p': {
    get: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/supinv/s1/p/0`).set({ data: 'x' })); return db.doc(`${P(biz)}/supinv/s1/p/0`).get(); } },
    list: { allow: S, run: (db, biz) => db.collection(`${P(biz)}/supinv/s1/p`).get() },
    create: { allow: M, run: (db, biz) => db.doc(`${P(biz)}/supinv/s1/p/${fresh()}`).set({ data: 'x' }) },
    update: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/supinv/s1/p/1`).set({ data: 'x' })); return db.doc(`${P(biz)}/supinv/s1/p/1`).set({ data: 'y' }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/supinv/s1/p/${id}`).set({ data: 'x' })); return db.doc(`${P(biz)}/supinv/s1/p/${id}`).delete(); } },
  },
  appreq: {
    get: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/appreq/r1`).set({ uid: 'x', by: 'x', txt: 'a', t: 1, st: 'new', np: 0 })); return db.doc(`${P(biz)}/appreq/r1`).get(); } },
    list: { allow: S, run: (db, biz) => db.collection(`${P(biz)}/appreq`).get() },
    create: { allow: S, run: (db, biz, uid) => db.doc(`${P(biz)}/appreq/${fresh()}`).set({ uid, by: uid, txt: 'בקשה', t: now(), st: 'new', np: 0 }) },
    update: { allow: M, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/appreq/ru`).set({ uid: 'x', by: 'x', txt: 'a', t: 1, st: 'new', np: 0 })); return db.doc(`${P(biz)}/appreq/ru`).update(stUpd(uid, 'doing')); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/appreq/${id}`).set({ uid: 'x', st: 'new' })); return db.doc(`${P(biz)}/appreq/${id}`).delete(); } },
  },
  'appreq/p': partsOf('appreq', (uid) => ({ uid, by: uid, txt: 'a', t: now(), st: 'new', np: 1 }), S),
  // תור "נשלח למנהל לטיפול" (שלב 6): עובד יוצר ורואה רק את שלו; מנהל קורא, מטפל ומוחק; מנהל לא יוצר
  mq: {
    get: { allow: S, run: async (db, biz, uid) => { const id = 'q_' + uid; await prep((a) => a.doc(`${P(biz)}/mq/${id}`).set(mqBody(uid || 'x'))); return db.doc(`${P(biz)}/mq/${id}`).get(); } },
    list: { allow: M, run: (db, biz) => db.collection(`${P(biz)}/mq`).get() },
    create: { allow: ['emp'], run: (db, biz, uid) => db.doc(`${P(biz)}/mq/${fresh()}`).set(mqBody(uid)) },
    update: { allow: M, run: async (db, biz, uid) => { const id = fresh('qu'); await prep((a) => a.doc(`${P(biz)}/mq/${id}`).set(mqBody('x'))); return db.doc(`${P(biz)}/mq/${id}`).update(stUpd(uid, 'done')); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/mq/${id}`).set(mqBody('x'))); return db.doc(`${P(biz)}/mq/${id}`).delete(); } },
  },
  'mq/p': {
    get: { allow: S, run: async (db, biz, uid) => { const id = 'qp_' + uid; await prep(async (a) => { await a.doc(`${P(biz)}/mq/${id}`).set(mqBody(uid || 'x')); await a.doc(`${P(biz)}/mq/${id}/p/0`).set({ data: 'x' }); }); return db.doc(`${P(biz)}/mq/${id}/p/0`).get(); } },
    list: { allow: M, run: async (db, biz) => { await prep(async (a) => { await a.doc(`${P(biz)}/mq/q1`).set(mqBody('x')); await a.doc(`${P(biz)}/mq/q1/p/0`).set({ data: 'x' }); }); return db.collection(`${P(biz)}/mq/q1/p`).get(); } },
    create: { allow: ['emp'], run: async (db, biz, uid) => { const id = fresh('q'); await prep((a) => a.doc(`${P(biz)}/mq/${id}`).set(mqBody(uid || 'x'))); return db.doc(`${P(biz)}/mq/${id}/p/0`).set({ data: 'x' }); } },
    update: { allow: NONE, run: async (db, biz, uid) => { const id = fresh('q'); await prep(async (a) => { await a.doc(`${P(biz)}/mq/${id}`).set(mqBody(uid || 'x')); await a.doc(`${P(biz)}/mq/${id}/p/0`).set({ data: 'x' }); }); return db.doc(`${P(biz)}/mq/${id}/p/0`).set({ data: 'y' }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh('q'); await prep(async (a) => { await a.doc(`${P(biz)}/mq/${id}`).set(mqBody('x')); await a.doc(`${P(biz)}/mq/${id}/p/0`).set({ data: 'x' }); }); return db.doc(`${P(biz)}/mq/${id}/p/0`).delete(); } },
  },
  closings: {
    get: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/closings/z1`).set(closingBody('x'))); return db.doc(`${P(biz)}/closings/z1`).get(); } },
    list: { allow: M, run: (db, biz) => db.collection(`${P(biz)}/closings`).get() },
    create: { allow: S, run: (db, biz, uid) => db.doc(`${P(biz)}/closings/${fresh()}`).set(closingBody(uid)) },
    update: { allow: M, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/closings/zu`).set(closingBody('x'))); return db.doc(`${P(biz)}/closings/zu`).update(stUpd(uid, 'ok')); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/closings/${id}`).set(closingBody('x'))); return db.doc(`${P(biz)}/closings/${id}`).delete(); } },
  },
  'closings/p': partsOf('closings', (uid) => closingBody(uid), M),
  cashout: {
    get: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/cashout/co1`).set(coBody('x', 'co1'))); return db.doc(`${P(biz)}/cashout/co1`).get(); } },
    list: { allow: S, run: (db, biz) => db.collection(`${P(biz)}/cashout`).get() },
    create: { allow: S, run: async (db, biz, uid) => { const id = fresh('co'); await prep((a) => a.doc(`${P(biz)}/inbox/${id}`).set(inboxBody(uid))); return db.doc(`${P(biz)}/cashout/${id}`).set(coBody(uid, id)); } },
    update: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/cashout/cu`).set(coBody('x', 'cu'))); return db.doc(`${P(biz)}/cashout/cu`).update({ zc: 'z9' }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/cashout/${id}`).set(coBody('x', id))); return db.doc(`${P(biz)}/cashout/${id}`).delete(); } },
  },
  deposits: {
    get: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/deposits/d1`).set(depBody('x'))); return db.doc(`${P(biz)}/deposits/d1`).get(); } },
    list: { allow: S, run: (db, biz) => db.collection(`${P(biz)}/deposits`).get() },
    create: { allow: S, run: (db, biz, uid) => db.doc(`${P(biz)}/deposits/${fresh()}`).set(depBody(uid)) },
    update: { allow: M, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/deposits/du`).set(depBody('x'))); return db.doc(`${P(biz)}/deposits/du`).update(stUpd(uid, 'ok')); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/deposits/${id}`).set(depBody('x'))); return db.doc(`${P(biz)}/deposits/${id}`).delete(); } },
  },
  'deposits/p': partsOf('deposits', (uid) => depBody(uid), M),
  zlast: {
    get: { allow: S, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/zlast/i_nl`).set({ d: '2026-10-01', tm: '', id: 'z0', uid: 'x', t: 1 })); return db.doc(`${P(biz)}/zlast/i_nl`).get(); } },
    list: { allow: S, run: (db, biz) => db.collection(`${P(biz)}/zlast`).get() },
    // עובד כותב zlast רק יחד עם יצירת הסגירה שלו (אותו commit) – כמו באפליקציה
    create: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/zlast/i_yh`).delete()); const id = fresh('z'); const b = db.batch();
      b.set(db.doc(`${P(biz)}/closings/${id}`), closingBody(uid, { reg: 'i_yh', tm: '10:00' })); b.set(db.doc(`${P(biz)}/zlast/i_yh`), { d: '2026-11-01', tm: '10:00', id, uid, t: now() }); return b.commit(); } },
    update: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/zlast/i_yh`).set({ d: '2026-10-01', tm: '', id: 'z0', uid: 'x', t: 1 })); const id = fresh('z'); const b = db.batch();
      b.set(db.doc(`${P(biz)}/closings/${id}`), closingBody(uid, { reg: 'i_yh', tm: '10:00' })); b.set(db.doc(`${P(biz)}/zlast/i_yh`), { d: '2026-11-01', tm: '10:00', id, uid, t: now() }); return b.commit(); } },
    delete: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/zlast/i_nl`).set({ d: '2026-10-01', tm: '', id: 'z0', uid: 'x', t: 1 })); return db.doc(`${P(biz)}/zlast/i_nl`).delete(); } },
  },
  yemot_lexicon: {
    get: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/yemot_lexicon/main`).set({ text: '', updatedAt: 1, updatedBy: 'x' })); return db.doc(`${P(biz)}/yemot_lexicon/main`).get(); } },
    list: { allow: NONE, run: (db, biz) => db.collection(`${P(biz)}/yemot_lexicon`).get() },
    create: { allow: M, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/yemot_lexicon/main`).delete()); return db.doc(`${P(biz)}/yemot_lexicon/main`).set({ text: 'א', updatedAt: now(), updatedBy: uid }); } },
    update: { allow: M, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/yemot_lexicon/main`).set({ text: '', updatedAt: 1, updatedBy: 'x' })); return db.doc(`${P(biz)}/yemot_lexicon/main`).set({ text: 'ב', updatedAt: now(), updatedBy: uid }); } },
    delete: { allow: NONE, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/yemot_lexicon/main`).set({ text: '', updatedAt: 1, updatedBy: 'x' })); return db.doc(`${P(biz)}/yemot_lexicon/main`).delete(); } },
  },
  yemot_items: simple('yemot_items', NONE, NONE, () => ({ x: 1 })),
  private: simple('private', NONE, NONE, () => ({ tokenHash: 'x' })),
  audit: {
    get: { allow: ['super'], run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/audit/a1`).set({ by: 'x', t: 1, act: 'open' })); return db.doc(`${P(biz)}/audit/a1`).get(); } },
    list: { allow: ['super'], run: (db, biz) => db.collection(`${P(biz)}/audit`).get() },
    create: { allow: ['super'], run: (db, biz, uid) => db.doc(`${P(biz)}/audit/${fresh()}`).set({ by: uid, t: now(), act: 'enter' }) },
    update: { allow: NONE, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/audit/a1`).set({ by: 'x', t: 1, act: 'open' })); return db.doc(`${P(biz)}/audit/a1`).update({ act: 'changed' }); } },
    delete: { allow: NONE, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/audit/a1`).set({ by: 'x', t: 1, act: 'open' })); return db.doc(`${P(biz)}/audit/a1`).delete(); } },
  },
};

// Storage: גיבוי (בתיקייה של המשתמש עצמו) ולוגו. list של הלוגו – לא רלוונטי (קובץ אחד בנתיב קבוע).
const BIN = { contentType: 'application/octet-stream' };
const PNG = { contentType: 'image/png' };
const ST_OPS = {
  'Storage b/{bizId}/app_backups/{uid}/': {
    get: { allow: S, run: async (s, biz, uid) => { await prepSt((a) => up(a.ref(`${P(biz)}/app_backups/${uid}/seed.bin`), new Uint8Array([1]), BIN)); return s.ref(`${P(biz)}/app_backups/${uid}/seed.bin`).getMetadata(); } },
    list: { allow: S, run: (s, biz, uid) => s.ref(`${P(biz)}/app_backups/${uid}`).listAll() },
    create: { allow: S, run: (s, biz, uid) => up(s.ref(`${P(biz)}/app_backups/${uid}/${fresh()}.bin`), new Uint8Array([1, 2]), BIN) },
    update: { allow: S, run: async (s, biz, uid) => { await prepSt((a) => up(a.ref(`${P(biz)}/app_backups/${uid}/seed.bin`), new Uint8Array([1]), BIN)); return up(s.ref(`${P(biz)}/app_backups/${uid}/seed.bin`), new Uint8Array([2]), BIN); } },
    delete: { allow: S, run: async (s, biz, uid) => { const f = fresh() + '.bin'; await prepSt((a) => up(a.ref(`${P(biz)}/app_backups/${uid}/${f}`), new Uint8Array([1]), BIN)); return s.ref(`${P(biz)}/app_backups/${uid}/${f}`).delete(); } },
  },
  'Storage b/{bizId}/brand/logo': {
    get: { allow: S, run: async (s, biz) => { await prepSt((a) => up(a.ref(`${P(biz)}/brand/logo`), new Uint8Array([1]), PNG)); return s.ref(`${P(biz)}/brand/logo`).getMetadata(); } },
    // עדכון חוזה 14: הלוגו – כתיבה ומחיקה רק למנהל־על
    create: { allow: ['super'], run: async (s, biz) => { await prepSt((a) => a.ref(`${P(biz)}/brand/logo`).delete().catch(() => {})); return up(s.ref(`${P(biz)}/brand/logo`), new Uint8Array(1024), PNG); } },
    update: { allow: ['super'], run: async (s, biz) => { await prepSt((a) => up(a.ref(`${P(biz)}/brand/logo`), new Uint8Array([1]), PNG)); return up(s.ref(`${P(biz)}/brand/logo`), new Uint8Array(2048), { contentType: 'image/webp' }); } },
    delete: { allow: ['super'], run: async (s, biz) => { await prepSt((a) => up(a.ref(`${P(biz)}/brand/logo`), new Uint8Array([1]), PNG)); return s.ref(`${P(biz)}/brand/logo`).delete(); } },
  },
};

const TALLY = { allow: 0, deny: 0, foreignDeny: 0, cells: 0 };
const PAIRS = new Map(); // אוסף|פעולה → {deny, allow}

describe('ריבוי עסקים – טבלת בידוד: אוסף × פעולה × 7 תפקידים × שני כיוונים', () => {
  before(async () => { env = await H.getEnv(); await seedAll(); await env.clearStorage(); });
  for (const [kind, table] of [['fs', OPS], ['st', ST_OPS]]) {
    for (const [coll, ops] of Object.entries(table)) {
      for (const [op, spec] of Object.entries(ops)) {
        for (const biz of [A, B]) {
          for (const role of ROLES7) {
            const { uid, rel } = resolve(role, biz);
            const expected = rel !== 'foreign' && spec.allow.includes(rel) ? 'allow' : 'deny';
            it(`${coll} | ${op} | עסק ${biz} | ${ROLE_NAMES[role]} → ${expected === 'allow' ? 'מותר' : 'נחסם'}`, async () => {
              const ctx = kind === 'fs' ? fs(uid) : st(uid);
              const p = spec.run(ctx, biz, uid);
              if (expected === 'allow') await assertSucceeds(p); else await assertFails(p);
              TALLY.cells++; TALLY[expected]++; if (rel === 'foreign') TALLY.foreignDeny++;
              const k = coll + '|' + op; const pr = PAIRS.get(k) || { deny: 0, allow: 0 }; pr[expected]++; PAIRS.set(k, pr);
            });
          }
        }
      }
    }
  }
  it('סיכום הטבלה: לכל "נחסם" יש "מותר" תואם באותו אוסף ופעולה (חוץ מפעולות שסגורות לכולם גם בשורש)', () => {
    const closed = [...PAIRS].filter(([, v]) => v.allow === 0).map(([k]) => k);
    console.log('# טבלת בידוד: ' + JSON.stringify(TALLY));
    console.log('# פעולות שסגורות לכולם (כמו בשורש, או אוספים של השרת בלבד): ' + closed.join(', '));
    const ok = new Set(['מסמך העסק b/{bizId}|create', 'מסמך העסק b/{bizId}|delete', 'admins|list', 'admins|create', 'admins|update', 'admins|delete',
      'staff|create', 'staff|update', 'staff|delete', 'app_backup_status|create', 'app_backup_status|update', 'app_backup_status|delete',
      'chunks|update', 'tasks/c|update', 'appreq/p|update', 'mq/p|update', 'closings/p|update', 'deposits/p|update', 'yemot_lexicon|list', 'yemot_lexicon|delete',
      'yemot_items|get', 'yemot_items|list', 'yemot_items|create', 'yemot_items|update', 'yemot_items|delete',
      'private|get', 'private|list', 'private|create', 'private|update', 'private|delete', 'audit|update', 'audit|delete']);
    assert.deepEqual(closed.filter((k) => !ok.has(k)), [], 'פעולה בלי אף בדיקת "מותר" שלא ברשימת הסגורות-בכוונה');
    assert.equal(TALLY.foreignDeny, TALLY.cells / 7 * 2, 'בכל תא: מנהל ועובד של העסק השני נחסמו');
  });
});

describe('ריבוי עסקים – users, superadmins, ושדות שהמשתמש לא קובע לעצמו', () => {
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await seedAll(); });

  it('users/{uid}: קורא רק את שלו; לא יוצר, לא משנה ולא מוחק – גם לא את שלו (bizId, role)', async () => {
    const a = fs(U[A].mgr);
    await assertSucceeds(a.doc('users/' + U[A].mgr).get());
    await assertFails(a.doc('users/' + U[B].mgr).get());
    await assertFails(a.collection('users').get());
    await assertFails(a.doc('users/' + U[A].mgr).update({ bizId: B }));
    await assertFails(a.doc('users/' + U[A].mgr).update({ role: 'admin' }));
    await assertFails(a.doc('users/' + U[A].mgr).delete());
    const n = fs(U.nobiz);
    await assertSucceeds(n.doc('users/' + U.nobiz).get());
    await assertFails(n.doc('users/' + U.nobiz).set({ bizId: A, role: 'admin', email: 'x', createdAt: 1 }));
    await assertFails(fs(U.super).doc('users/' + U.super).set({ bizId: A, role: 'admin' }));
  });

  it('superadmins/{uid}: קורא רק את שלו; אף אחד לא כותב (גם לא מנהל־על)', async () => {
    await assertSucceeds(fs(U.super).doc('superadmins/' + U.super).get());
    await assertSucceeds(fs(U[A].mgr).doc('superadmins/' + U[A].mgr).get()); // לא קיים – תשובה ריקה
    await assertFails(fs(U[A].mgr).doc('superadmins/' + U.super).get());
    await assertFails(fs(U[A].mgr).doc('superadmins/' + U[A].mgr).set({}));
    await assertFails(fs(U.super).doc('superadmins/u_new').set({}));
    await assertFails(fs(U.super).collection('superadmins').get());
  });

  it('admins / staff: מנהל העסק לא כותב את עצמו ולא אחרים; עובד לא מפעיל את עצמו מחדש', async () => {
    const m = fs(U[A].mgr);
    await assertFails(m.doc(`b/${A}/admins/${U[A].emp}`).set({ email: 'x' }));
    await assertFails(m.doc(`b/${A}/admins/${U[A].mgr}`).update({ email: 'y' }));
    await assertFails(m.doc(`b/${A}/staff/${U[A].emp}`).update({ active: false }));
    await assertFails(fs(U[A].off).doc(`b/${A}/staff/${U[A].off}`).update({ active: true }));
    await assertFails(fs(U[A].emp).doc(`b/${A}/admins/${U[A].emp}`).set({ email: 'x' }));
    await assertFails(fs(U.super).doc(`b/${A}/admins/u_x`).set({ email: 'x' }));
    // מותר תואם: קריאה
    await assertSucceeds(m.doc(`b/${A}/staff/${U[A].emp}`).get());
  });

  it('מסמך העסק: מנהל העסק לא כותב features, status, dataRoot, bizId, role, name, adv, ownerEmail, ownerPhone', async () => {
    const m = fs(U[A].mgr);
    const d = m.doc('b/' + A);
    for (const [k, v] of Object.entries({ features: { scan: true }, status: 'active', dataRoot: 'legacy', bizId: B, role: 'admin', name: 'שם', adv: { limits: {} },
      ownerEmail: 'a@b.c', ownerPhone: '050', schemaVersion: 2, createdBy: U[A].mgr })) {
      await assertFails(d.update({ [k]: v }), k);
    }
    await assertFails(d.update({ 'features.scan': true }));
    // גם יחד עם brand תקין
    await assertFails(d.update({ brand: { name: 'x', updatedAt: now(), updatedBy: U[A].mgr }, status: 'suspended' }));
    // עובד לא כותב גם brand
    await assertFails(fs(U[A].emp).doc('b/' + A).update({ brand: { name: 'x', updatedAt: now(), updatedBy: U[A].emp } }));
    // עדכון חוזה 14: גם brand תואם לבדו – נדחה (רק מנהל־על, דרך setBusinessBrand)
    await assertFails(d.update({ brand: { name: 'x', updatedAt: now(), updatedBy: U[A].mgr } }));
  });

  it('brand (עדכון חוזה 14): מנהל העסק לא כותב brand מהאפליקציה – גם לא שם, צבעים או לוגו תקינים, וגם לא כשדה משנה; העסק לא השתנה', async () => {
    const uid = U[A].mgr, d = fs(uid).doc('b/' + A);
    const before = (await getDoc('b/' + A)).brand;
    const br = (o) => ({ brand: Object.assign({ name: 'שם', updatedAt: now(), updatedBy: uid }, o) });
    await assertFails(d.update(br({ name: 'מותג חדש' })));
    await assertFails(d.update(br({ colors: { acc: '#aabbcc', acc2: '#aabbcc', onacc: '#000000', bg: '#111111', card: '#222222', ink: '#ffffff' } })));
    await assertFails(d.update(br({ logoPath: `b/${A}/brand/logo` })));
    await assertFails(d.update(br({ logoPath: '' })));
    await assertFails(d.update({ 'brand.name': 'x' }));
    await assertFails(d.update({ 'brand.colors.acc': '#aabbcc' }));
    await assertFails(d.set({ brand: { name: 'x' } }, { merge: true }));
    // גם מנהל של עסק ב' ועובד
    await assertFails(fs(U[B].mgr).doc('b/' + A).update(br({ updatedBy: U[B].mgr })));
    await assertFails(fs(U[A].emp).doc('b/' + A).update({ 'brand.name': 'x' }));
    assert.deepEqual((await getDoc('b/' + A)).brand, before, 'brand לא השתנה');
  });

  it('מנהל־על: מהאפליקציה כותב רק migrationTarget. status, features, adv, brand, ownerEmail, ownerPhone – רק דרך השרת (audit + bizStatus); לא יוצר ולא מוחק עסק', async () => {
    const s = fs(U.super), d = s.doc('b/' + A);
    // שלב 5 (עדכון חוזה 6): השינויים האלה עוברים דרך setBusinessStatus / setBusinessFeatures / setBusinessAdv / createBusiness
    await assertFails(d.update({ status: 'suspended' }));
    await assertFails(d.update({ features: { scan: false, shelf: true } }));
    await assertFails(d.update({ 'features.tasks': false }));
    await assertFails(d.update({ adv: { limits: { scanDaily: 100 }, yemot: {} } }));
    await assertFails(d.update({ ownerEmail: 'owner@example.invalid', ownerPhone: '+972 50-000-0000' }));
    // עדכון חוזה 14: brand – רק דרך setBusinessBrand (audit), לא בכתיבה ישירה
    await assertFails(d.update({ brand: { name: 'x', updatedAt: now(), updatedBy: U.super } }));
    await assertFails(d.update({ 'brand.name': 'x' }));
    await assertFails(d.update({ brand: { name: 'x', updatedAt: now(), updatedBy: U.super }, status: 'suspended' }));
    for (const [k, v] of Object.entries({ dataRoot: 'legacy', bizId: B, name: 'x', schemaVersion: 2, createdBy: 'x' })) await assertFails(d.update({ [k]: v }), k);
    await assertFails(s.doc('b/biz-new').set(bizDoc('biz-new')));
    await assertFails(d.delete());
    await assertFails(fs(U[A].mgr).doc('b/' + A).update({ status: 'active' }));
    await assertFails(fs(U[A].emp).doc('b/' + A).update({ features: ALL_FEATURES }));
  });

  it('migrationTarget (עדכון חוזה 7א): מנהל־על כותב (בוליאני בלבד); מנהל העסק, עובד ועסק אחר – לא', async () => {
    const d = (uid) => fs(uid).doc('b/' + A);
    await assertSucceeds(d(U.super).update({ migrationTarget: true }));
    await assertSucceeds(d(U.super).update({ migrationTarget: false }));
    await assertFails(d(U.super).update({ migrationTarget: 'yes' }));
    await assertFails(d(U.super).update({ migrationTarget: true, status: 'suspended' }));
    for (const uid of [U[A].mgr, U[A].emp, U[B].mgr, U.nobiz]) await assertFails(d(uid).update({ migrationTarget: true }), uid);
    await assertFails(d(U[A].mgr).update({ migrationTarget: true, brand: { name: 'x', updatedAt: now(), updatedBy: U[A].mgr } }));
  });

  it('private/info (ownerEmail, ownerPhone, adv): מנהל העסק ומנהל־על קוראים; עובד, מנהל של עסק אחר ומחובר בלי עסק – לא. כתיבה – לאף אחד. שאר private סגור', async () => {
    await prep(async (a) => { await a.doc(`b/${A}/private/info`).set({ ownerEmail: 'o@example.invalid', ownerPhone: '0501234567', adv: {} }); await a.doc(`b/${A}/private/yemot`).set({ tokenHash: 'x' }); });
    await assertSucceeds(fs(U[A].mgr).doc(`b/${A}/private/info`).get());
    await assertSucceeds(fs(U.super).doc(`b/${A}/private/info`).get());
    for (const uid of [U[A].emp, U[A].off, U[B].mgr, U[B].emp, U.nobiz]) await assertFails(fs(uid).doc(`b/${A}/private/info`).get(), uid);
    for (const uid of [U[A].mgr, U.super]) {
      await assertFails(fs(uid).doc(`b/${A}/private/yemot`).get(), uid);
      await assertFails(fs(uid).collection(`b/${A}/private`).get(), uid);
      await assertFails(fs(uid).doc(`b/${A}/private/info`).set({ adv: {} }), uid);
      await assertFails(fs(uid).doc(`b/${A}/private/info`).update({ ownerEmail: 'x@example.invalid' }), uid);
      await assertFails(fs(uid).doc(`b/${A}/private/info`).delete(), uid);
    }
    // עסק מושהה: מנהל העסק כבר לא קורא; מנהל־על כן
    await prep((a) => a.doc('b/' + A).update({ status: 'suspended' }));
    await assertFails(fs(U[A].mgr).doc(`b/${A}/private/info`).get());
    await assertSucceeds(fs(U.super).doc(`b/${A}/private/info`).get());
  });

  it('audit: רק מנהל־על קורא ויוצר (בשמו, בזמן אמת, שדות מוגדרים); אין עדכון ואין מחיקה – לאף אחד', async () => {
    const s = fs(U.super), col = `b/${A}/audit`;
    await assertSucceeds(s.doc(`${col}/e1`).set({ by: U.super, t: now(), act: 'enter', note: 'כניסה לעסק' }));
    await assertSucceeds(s.doc(`${col}/e1`).get());
    await assertFails(s.doc(`${col}/e1`).update({ act: 'x' }));
    await assertFails(s.doc(`${col}/e1`).delete());
    await assertFails(s.doc(`${col}/e2`).set({ by: U[A].mgr, t: now(), act: 'enter' }));
    await assertFails(s.doc(`${col}/e3`).set({ by: U.super, t: now() - 10 * 60000, act: 'enter' }));
    await assertFails(s.doc(`${col}/e4`).set({ by: U.super, t: now(), act: 'enter', extra: 1 }));
    await assertFails(fs(U[A].mgr).doc(`${col}/e1`).get());
    await assertFails(fs(U[A].mgr).doc(`${col}/e5`).set({ by: U[A].mgr, t: now(), act: 'enter' }));
    await assertFails(fs(U[A].mgr).doc(`${col}/e1`).delete());
    await assertFails(fs(U[A].mgr).doc(`${col}/e1`).update({ act: 'x' }));
  });
});

// אוסף לכל תוספת: פעולת "מותר" אחת למנהל (קריאה), ובשביל chunks גם יצירה של עובד
const FEATURE_PROBES = {
  shelf: [['shelf', (db) => db.doc(`b/${A}/shelf/price`).get()]],
  feedback: [['fb', (db) => db.collection(`b/${A}/fb`).get()], ['chunks fbhi_', (db) => db.doc(`b/${A}/chunks/fbhi_q_0`).get()]],
  tasks: [['tasks', (db) => db.collection(`b/${A}/tasks`).get()], ['tasks/c', (db) => db.collection(`b/${A}/tasks/t1/c`).get()]],
  suppliers: [['supinv', (db) => db.collection(`b/${A}/supinv`).get()], ['supinv/p', (db) => db.collection(`b/${A}/supinv/s1/p`).get()]],
  requests: [['appreq', (db) => db.collection(`b/${A}/appreq`).get()], ['appreq/p', (db) => db.collection(`b/${A}/appreq/r1/p`).get()]],
  cashClose: [['closings', (db) => db.collection(`b/${A}/closings`).get()], ['closings/p', (db) => db.collection(`b/${A}/closings/z1/p`).get()],
    ['cashout', (db) => db.collection(`b/${A}/cashout`).get()], ['deposits', (db) => db.collection(`b/${A}/deposits`).get()],
    ['deposits/p', (db) => db.collection(`b/${A}/deposits/d1/p`).get()], ['zlast', (db) => db.collection(`b/${A}/zlast`).get()]],
  yemot: [['yemot_lexicon', (db) => db.doc(`b/${A}/yemot_lexicon/main`).get()]],
};

describe('ריבוי עסקים – תוספות: כבויה = אין גישה לאוסף, מופעלת = יש', () => {
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await seedAll(); await prep(async (a) => { await a.doc(`b/${A}/chunks/fbhi_q_0`).set({ owner: 'x', data: 'x' }); await a.doc(`b/${A}/tasks/t1`).set(taskBody('x')); }); });
  const setFeat = (features) => prep((a) => a.doc('b/' + A).update({ features }));

  for (const [key, probes] of Object.entries(FEATURE_PROBES)) {
    for (const [name, probe] of probes) {
      it(`${key} → ${name}: כבויה – נחסם (גם מנהל־על); מופעלת – מותר`, async () => {
        await setFeat(Object.assign({}, ALL_FEATURES, { [key]: false }));
        await assertFails(probe(fs(U[A].mgr)));
        await assertFails(probe(fs(U.super)));
        await setFeat(Object.assign({}, ALL_FEATURES, { [key]: true }));
        await assertSucceeds(probe(fs(U[A].mgr)));
        await assertSucceeds(probe(fs(U.super)));
      });
    }
  }

  it('מסמך עסק בלי השדה features: כל התוספות כבויות, הבסיס עובד', async () => {
    await prep(async (a) => { const d = bizDoc(A); delete d.features; await a.doc('b/' + A).set(d); });
    for (const probes of Object.values(FEATURE_PROBES)) for (const [, probe] of probes) await assertFails(probe(fs(U[A].mgr)));
    await assertSucceeds(fs(U[A].mgr).doc(`b/${A}/cfg/main`).get());
    await assertSucceeds(fs(U[A].emp).doc(`b/${A}/chunks/${fresh('c')}_0`).set({ owner: U[A].emp, data: 'x' }));
  });

  it('תוספת "feedback" כבויה: עובד לא יוצר chunks של fbhi_, אבל chunks רגיל (שליחת מסמך – בסיס) ממשיך לעבוד', async () => {
    await setFeat(Object.assign({}, ALL_FEATURES, { feedback: false }));
    const e = fs(U[A].emp);
    await assertFails(e.doc(`b/${A}/chunks/fbhi_${fresh()}_0`).set({ owner: U[A].emp, data: 'x' }));
    await assertSucceeds(e.doc(`b/${A}/chunks/${fresh('c')}_0`).set({ owner: U[A].emp, data: 'x' }));
    await setFeat(ALL_FEATURES);
    await assertSucceeds(e.doc(`b/${A}/chunks/fbhi_${fresh()}_0`).set({ owner: U[A].emp, data: 'x' }));
  });

  it('תוספת "tasks" כבויה: גם יצירה ועדכון נחסמים; כיבוי בעסק א\' לא משפיע על עסק ב\'', async () => {
    await setFeat(Object.assign({}, ALL_FEATURES, { tasks: false }));
    await assertFails(fs(U[A].emp).doc(`b/${A}/tasks/${fresh()}`).set(taskBody(U[A].emp)));
    await assertSucceeds(fs(U[B].emp).doc(`b/${B}/tasks/${fresh()}`).set(taskBody(U[B].emp)));
    await setFeat(ALL_FEATURES);
    await assertSucceeds(fs(U[A].emp).doc(`b/${A}/tasks/${fresh()}`).set(taskBody(U[A].emp)));
  });
});

describe('ריבוי עסקים – עסק מושהה', () => {
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await seedAll(); await env.clearStorage(); });
  // כמו setBusinessStatus בשרת: מסמך העסק וגם bizStatus בכל users של העסק
  const setStatus = (status) => prep(async (a) => { await a.doc('b/' + A).update({ status }); for (const k of ['mgr', 'emp', 'off']) await a.doc('users/' + U[A][k]).update({ bizStatus: status }); });
  const suspend = () => setStatus('suspended');

  it('מנהל ועובד של עסק מושהה: רק קריאה של מסמך העסק; כל השאר נחסם. מנהל־על – גישה מלאה', async () => {
    // לפני ההשהיה: מותר
    await assertSucceeds(fs(U[A].emp).doc(`b/${A}/cfg/main`).get());
    await assertSucceeds(fs(U[A].emp).doc(`b/${A}/chunks/${fresh('c')}_0`).set({ owner: U[A].emp, data: 'x' }));
    await suspend();
    const m = fs(U[A].mgr), e = fs(U[A].emp), s = fs(U.super);
    await assertSucceeds(m.doc('b/' + A).get());
    await assertSucceeds(e.doc('b/' + A).get());
    await assertFails(e.doc(`b/${A}/cfg/main`).get());
    await assertFails(e.doc(`b/${A}/chunks/${fresh('c')}_0`).set({ owner: U[A].emp, data: 'x' }));
    await assertFails(e.collection(`b/${A}/inbox`).where('owner', '==', U[A].emp).get());
    await assertFails(e.doc(`b/${A}/staff/${U[A].emp}`).get());
    await assertFails(e.doc(`b/${A}/admins/${U[A].emp}`).get());
    await assertFails(e.doc(`b/${A}/tasks/${fresh()}`).set(taskBody(U[A].emp)));
    await assertFails(m.doc(`b/${A}/cfg/main`).get());
    await assertFails(m.doc(`b/${A}/cfg/main`).set({ data: '{}' }));
    await assertFails(m.collection(`b/${A}/closings`).get());
    await assertFails(m.doc(`b/${A}/admins/${U[A].mgr}`).get());
    await assertFails(m.doc('b/' + A).update({ brand: { name: 'x', updatedAt: now(), updatedBy: U[A].mgr } }));
    await assertFails(m.doc('b/' + A).update({ status: 'active' }));
    // מנהל־על: מנהל מלא גם בעסק מושהה
    await assertSucceeds(s.doc(`b/${A}/cfg/main`).set({ data: '{}' }));
    await assertSucceeds(s.collection(`b/${A}/closings`).get());
    await assertFails(s.doc('b/' + A).update({ status: 'active' })); // רק דרך השרת (setBusinessStatus)
    await setStatus('active');
    // ואחרי החזרה לפעיל – העובד חוזר לעבוד
    await assertSucceeds(e.doc(`b/${A}/cfg/main`).get());
    // עסק ב' לא מושפע מההשהיה של א'
  });

  it('השהיה של עסק א\' לא משפיעה על עסק ב\'', async () => {
    await suspend();
    await assertSucceeds(fs(U[B].emp).doc(`b/${B}/cfg/main`).get());
    await assertSucceeds(fs(U[B].mgr).doc(`b/${B}/cfg/main`).set({ data: '{}' }));
  });

  it('Storage בעסק מושהה: עובד ומנהל לא קוראים ולא כותבים גיבוי או לוגו; מנהל־על כן', async () => {
    await prepSt(async (a) => { await up(a.ref(`b/${A}/app_backups/${U[A].emp}/s.bin`), new Uint8Array([1]), BIN); await up(a.ref(`b/${A}/brand/logo`), new Uint8Array([1]), PNG); });
    await assertSucceeds(st(U[A].emp).ref(`b/${A}/app_backups/${U[A].emp}/s.bin`).getMetadata());
    await suspend();
    await assertFails(st(U[A].emp).ref(`b/${A}/app_backups/${U[A].emp}/s.bin`).getMetadata());
    await assertFails(up(st(U[A].emp).ref(`b/${A}/app_backups/${U[A].emp}/n.bin`), new Uint8Array([1]), BIN));
    await assertFails(st(U[A].emp).ref(`b/${A}/brand/logo`).getMetadata());
    await assertFails(up(st(U[A].mgr).ref(`b/${A}/brand/logo`), new Uint8Array([1]), PNG));
    await assertFails(st(U[A].mgr).ref(`b/${A}/app_backups/${U[A].emp}/s.bin`).getMetadata());
    await assertSucceeds(st(U.super).ref(`b/${A}/app_backups/${U[A].emp}/s.bin`).getMetadata());
    await assertSucceeds(up(st(U.super).ref(`b/${A}/brand/logo`), new Uint8Array([1]), PNG));
  });
});

describe('ריבוי עסקים – Storage: לוגו, גיבוי ועדכוני APK', () => {
  before(async () => { env = await H.getEnv(); await seedAll(); });
  beforeEach(async () => { await env.clearStorage(); });

  it('לוגו (מנהל־על): png/jpeg/webp עד 1MB – מותר; מעל 1MB או סוג אחר – נחסם', async () => {
    const m = st(U.super), r = m.ref(`b/${A}/brand/logo`);
    await assertSucceeds(up(r, new Uint8Array(1024 * 1024), PNG));
    await assertFails(up(r, new Uint8Array(1024 * 1024 + 1), PNG));
    await assertSucceeds(up(r, new Uint8Array(10), { contentType: 'image/jpeg' }));
    await assertSucceeds(up(r, new Uint8Array(10), { contentType: 'image/webp' }));
    for (const ct of ['image/gif', 'image/svg+xml', 'text/plain', 'application/octet-stream', 'text/html']) await assertFails(up(r, new Uint8Array(10), { contentType: ct }), ct);
    await assertFails(up(m.ref(`b/${A}/brand/logo2`), new Uint8Array(10), PNG));
    await assertFails(up(m.ref(`b/${A}/brand/x/logo`), new Uint8Array(10), PNG));
  });

  it('לוגו (עדכון חוזה 14): מנהל העסק, עובד, מנהל של עסק אחר ומחובר בלי עסק – לא מעלים, לא מחליפים ולא מוחקים; הקובץ לא השתנה. קריאה – חברי העסק', async () => {
    await prepSt((a) => up(a.ref(`b/${A}/brand/logo`), new Uint8Array([7, 7, 7]), PNG));
    for (const uid of [U[A].mgr, U[A].emp, U[B].mgr, U.nobiz]) {
      const r = st(uid).ref(`b/${A}/brand/logo`);
      await assertFails(up(r, new Uint8Array(10), PNG), uid + ' העלאה');
      await assertFails(up(r, new Uint8Array(10), { contentType: 'image/webp' }), uid + ' החלפה');
      await assertFails(r.delete(), uid + ' מחיקה');
    }
    await assertSucceeds(st(U[A].mgr).ref(`b/${A}/brand/logo`).getMetadata());
    await assertSucceeds(st(U[A].emp).ref(`b/${A}/brand/logo`).getMetadata());
    let size = -1; await prepSt(async (a) => { size = (await a.ref(`b/${A}/brand/logo`).getMetadata()).size; });
    assert.equal(size, 3, 'הקובץ המקורי נשאר');
    await assertSucceeds(up(st(U.super).ref(`b/${A}/brand/logo`), new Uint8Array(10), PNG));
  });

  it('עובד א\' לא קורא ולא כותב גיבוי או לוגו של עסק ב\' (וגם להפך)', async () => {
    await prepSt(async (a) => {
      for (const biz of [A, B]) { await up(a.ref(`b/${biz}/brand/logo`), new Uint8Array([1]), PNG); for (const k of ['emp', 'mgr']) await up(a.ref(`b/${biz}/app_backups/${U[biz][k]}/s.bin`), new Uint8Array([1]), BIN); }
    });
    for (const [me, bizMe, bizOther] of [[U[A].emp, A, B], [U[B].emp, B, A]]) {
      const s = st(me);
      await assertSucceeds(s.ref(`b/${bizMe}/brand/logo`).getMetadata());
      await assertSucceeds(s.ref(`b/${bizMe}/app_backups/${me}/s.bin`).getMetadata());
      await assertFails(s.ref(`b/${bizOther}/brand/logo`).getMetadata());
      await assertFails(up(s.ref(`b/${bizOther}/brand/logo`), new Uint8Array([1]), PNG));
      await assertFails(s.ref(`b/${bizOther}/app_backups/${U[bizOther].emp}/s.bin`).getMetadata());
      await assertFails(s.ref(`b/${bizOther}/app_backups/${me}/s.bin`).getMetadata());
      await assertFails(up(s.ref(`b/${bizOther}/app_backups/${me}/n.bin`), new Uint8Array([1]), BIN));
      await assertFails(s.ref(`b/${bizOther}/app_backups/${U[bizOther].mgr}`).listAll());
      // גם בעסק שלו: לא קורא גיבוי של עובד אחר, ולא כותב לוגו
      await assertFails(s.ref(`b/${bizMe}/app_backups/${U[bizMe].mgr}/s.bin`).getMetadata());
      await assertFails(up(s.ref(`b/${bizMe}/brand/logo`), new Uint8Array([1]), PNG));
    }
    // מנהל העסק קורא גיבויים של העובדים שלו, לא של עסק אחר
    await assertSucceeds(st(U[A].mgr).ref(`b/${A}/app_backups/${U[A].emp}/s.bin`).getMetadata());
    await assertFails(st(U[A].mgr).ref(`b/${B}/app_backups/${U[B].emp}/s.bin`).getMetadata());
  });

  it('גיבוי בתוך העסק: אותם תנאים כמו בשורש (בינארי בלבד, עד 50MB)', async () => {
    const s = st(U[A].emp);
    await assertFails(up(s.ref(`b/${A}/app_backups/${U[A].emp}/t.txt`), new Uint8Array([65]), { contentType: 'text/plain' }));
    await assertSucceeds(up(s.ref(`b/${A}/app_backups/${U[A].emp}/ok.bin`), new Uint8Array([1]), BIN));
    await assertFails(up(st(U[A].off).ref(`b/${A}/app_backups/${U[A].off}/ok.bin`), new Uint8Array([1]), BIN));
    await assertFails(up(st(U.nobiz).ref(`b/${A}/app_backups/${U.nobiz}/ok.bin`), new Uint8Array([1]), BIN));
  });

  it('app_releases: חבר פעיל בכל עסק (לפי users) ומנהל־על קוראים – גם בעסק מושהה (עדכוני אבטחה); מחובר בלי עסק ועובד מושבת – נחסמים; כתיבה – לאף אחד', async () => {
    await prepSt((a) => up(a.ref('app_releases/latest/version.json'), new TextEncoder().encode('{}'), { contentType: 'application/json' }));
    const v = (uid) => st(uid).ref('app_releases/latest/version.json').getMetadata();
    for (const uid of [U[A].mgr, U[A].emp, U[B].mgr, U[B].emp, U.super]) await assertSucceeds(v(uid), uid);
    for (const uid of [U.nobiz, U[A].off]) await assertFails(v(uid), uid);
    await assertFails(up(st(U[A].mgr).ref('app_releases/latest/x.apk'), new Uint8Array([1]), { contentType: 'application/vnd.android.package-archive' }));
    await assertFails(up(st(U.super).ref('app_releases/latest/x.apk'), new Uint8Array([1]), { contentType: 'application/vnd.android.package-archive' }));
    // עדכון חוזה 6: עסק מושהה עדיין מקבל עדכוני APK (הנתיב מחוץ לעסק, והבדיקה לא תלויה בסטטוס)
    await prep(async (a) => { await a.doc('b/' + A).update({ status: 'suspended' }); for (const k of ['mgr', 'emp']) await a.doc('users/' + U[A][k]).update({ bizStatus: 'suspended' }); });
    await assertSucceeds(v(U[A].emp));
    await assertSucceeds(v(U[A].mgr));
    await assertSucceeds(v(U[B].emp));
    // users בלי active == true (למשל הזמנה שעוד לא הושלמה) – נחסם
    await prep((a) => a.doc('users/' + U.nobiz).set({ bizId: B, role: 'admin' }));
    await assertFails(v(U.nobiz));
    await prep((a) => a.doc('users/' + U.nobiz).set({ bizId: B, role: 'admin', active: false, bizStatus: 'active' }));
    await assertFails(v(U.nobiz));
  });

  it('Storage של b/{bizId} נקבע רק לפי users/{uid} (role, active, bizStatus) ו-superadmins: עותק שהשרת לא עדכן = לא נפתח, גם כשה-staff פעיל', async () => {
    await seedAll(); // הבדיקה הקודמת השהתה את עסק א'
    await prepSt((a) => up(a.ref(`b/${A}/app_backups/${U[A].emp}/s.bin`), new Uint8Array([1]), BIN));
    const r = () => st(U[A].emp).ref(`b/${A}/app_backups/${U[A].emp}/s.bin`).getMetadata();
    await assertSucceeds(r());
    for (const [k, v] of [['active', false], ['bizStatus', 'suspended'], ['bizId', B], ['role', 'guest']]) {
      await prep((a) => a.doc('users/' + U[A].emp).update({ [k]: v }));
      await assertFails(r(), k);
      await seedAll();
    }
    // עובד שהוגדר במסמך users כמנהל (השרת בלבד כותב) מקבל הרשאות מנהל ב-Storage – לכן רק השרת כותב users
    await prep((a) => a.doc('users/' + U[A].emp).update({ role: 'admin' }));
    // (עדכון חוזה 14: הלוגו כבר לא נכתב בידי מנהל, ולכן בודקים הרשאת מנהל אחרת – קריאת גיבוי של משתמש אחר בעסק)
    await prepSt((a) => up(a.ref(`b/${A}/app_backups/${U[A].mgr}/m.bin`), new Uint8Array([1]), BIN));
    await assertSucceeds(st(U[A].emp).ref(`b/${A}/app_backups/${U[A].mgr}/m.bin`).getMetadata());
  });

  it('migrate_backups/ (עדכון חוזה 7א): סגור לגמרי לאפליקציה – גם מנהל־על, מנהל ועובד לא קוראים, לא רושמים ולא כותבים', async () => {
    await seedAll();
    await prepSt((a) => up(a.ref('migrate_backups/backup-1.json'), new TextEncoder().encode('{}'), { contentType: 'application/json' }));
    for (const uid of [U.super, U[A].mgr, U[A].emp, U.nobiz, 'u_mgr']) {
      const s = st(uid);
      await assertFails(s.ref('migrate_backups/backup-1.json').getMetadata(), uid);
      await assertFails(s.ref('migrate_backups/backup-1.json').getDownloadURL(), uid);
      await assertFails(s.ref('migrate_backups').listAll(), uid);
      await assertFails(up(s.ref('migrate_backups/x.json'), new TextEncoder().encode('{}'), { contentType: 'application/json' }), uid);
      await assertFails(s.ref('migrate_backups/backup-1.json').delete(), uid);
    }
  });

  it('מגבלת 2 הקריאות (עדכון חוזה 6): בכללי Storage של b/{bizId} יש קריאה רק ל-users/{uid} ול-superadmins/{uid}', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(H.ROOT, 'storage.rules'), 'utf8');
    const block = src.slice(src.indexOf('// ---------- ריבוי עסקים'), src.indexOf('// הכלל האחרון'));
    const paths = [...block.matchAll(/firestore\.(?:get|exists)\(\/databases\/\(default\)\/documents\/([a-z_]+)\//g)].map((m) => m[1]);
    assert.deepEqual([...new Set(paths)].sort(), ['superadmins', 'users']);
    assert.ok(!/documents\/b\//.test(block), 'אין קריאה למסמך העסק או ל-admins/staff של העסק');
  });
});

describe('ריבוי עסקים – מגבלת קריאות המסמכים (get/exists) בחוקים', () => {
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await seedAll(); });

  // הבקשה עם הכי הרבה קריאות: עובד יוצר הפקדה ובאותו commit מעדכן 30 הוצאות מקופה (המקסימום ב-items).
  // כל עדכון של cashout אצל עובד: admins (exists), superadmins (exists), staff (exists+get), b/{bizId} (get), deposits (getAfter);
  // ההפקדה עצמה: admins, superadmins, staff, b/{bizId}. מסמכים שונים בכל הבקשה: 5 (הקריאות לאותו מסמך נשמרות במטמון).
  it('הבקשה הכבדה ביותר של האפליקציה (הפקדה + 30 הוצאות באותו commit, עובד) – עוברת', async () => {
    const uid = U[A].emp, ids = [];
    await prep(async (a) => { for (let i = 0; i < 30; i++) { const id = 'co' + i; ids.push(id); await a.doc(`b/${A}/cashout/${id}`).set(coBody('x', id, { dep: '1', why: 'להפקדה' })); } });
    const db = fs(uid), b = db.batch(), did = fresh('dp');
    b.set(db.doc(`b/${A}/deposits/${did}`), depBody(uid, { items: ids, a: 300 }));
    for (const id of ids) b.update(db.doc(`b/${A}/cashout/${id}`), { dp: did });
    await assertSucceeds(b.commit());
  });

  it('zlast של עובד (הכלל עם הכי הרבה קריאות שונות במסמך בודד: 6) – עובר; והמגבלה אכן נאכפת באמולטור (ניסוי בקרה)', async () => {
    const uid = U[A].emp, db = fs(uid), b = db.batch(), id = fresh('z');
    b.set(db.doc(`b/${A}/closings/${id}`), closingBody(uid, { reg: 'i_yh', tm: '10:00' }));
    b.set(db.doc(`b/${A}/zlast/i_yh`), { d: '2026-11-01', tm: '10:00', id, uid, t: now() });
    await assertSucceeds(b.commit());
    // ניסוי בקרה: commit של 25 חלקי chunks (_1), שכל אחד קורא חלק _0 אחר – 25 מסמכים שונים + תפקידים (מעל 20)
    const ids = [];
    await prep(async (a) => { for (let i = 0; i < 25; i++) { ids.push('lim' + i); await a.doc(`b/${A}/chunks/lim${i}_0`).set({ owner: uid, data: 'x' }); } });
    const b2 = db.batch();
    for (const i of ids) b2.set(db.doc(`b/${A}/chunks/${i}_1`), { owner: uid, data: 'x' });
    let res = 'allow';
    try { await b2.commit(); } catch (e) { res = 'deny: ' + String(e.message).replace(/\s+/g, ' ').slice(0, 400); }
    console.log('# ניסוי בקרה (25 קריאות שונות ב-commit אחד): ' + res);
    // ו-commit של 10 חלקים כאלה (10 + 4 = 14 מסמכים שונים) – עובר
    const b3 = db.batch();
    for (const i of ids.slice(0, 10)) b3.set(db.doc(`b/${A}/chunks/${i}_2`), { owner: uid, data: 'x' });
    await assertSucceeds(b3.commit());
  });
});

describe('ריבוי עסקים – הקוד הישן מול הכללים החדשים (לארג\' פעמי במצב legacy)', () => {
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); });
  it('משתמשים של השורש (admins/staff בשורש) עובדים כמו היום, ולא מקבלים גישה ל-b/ בלי חברות', async () => {
    await assertSucceeds(H.ctxFor(env, 'employee').firestore().doc('cfg/main').get());
    await assertSucceeds(H.ctxFor(env, 'manager').firestore().doc('cfg/main').set({ data: '{}' }));
    await prep((a) => a.doc('b/largpeami').set(bizDoc('largpeami', { dataRoot: 'legacy' })));
    await assertFails(H.ctxFor(env, 'manager').firestore().doc('b/largpeami/cfg/main').get());
    await assertFails(H.ctxFor(env, 'manager').firestore().doc('b/largpeami').get());
    await assertFails(H.ctxFor(env, 'employee').firestore().doc('users/u_emp2').get());
    await assertSucceeds(H.ctxFor(env, 'employee').firestore().doc('users/u_emp').get()); // קריאת זיהוי בכניסה – מותרת (אין מסמך)
  });
});

after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* האמולטור כבר נסגר */ } });

// סריקה אחידה, שלב 6: תור "נשלח למנהל לטיפול" (mq) – הקריטריונים במילים: עובד יוצר ורואה רק את שלו, לא עורך אחרי שליחה,
// לא רואה של אחרים; רק מנהל העסק מטפל, ופעם אחת בלבד (פריט שטופל לא נשמר פעמיים); בלי סכומים; אין גישה בין עסקים.
describe('סריקה אחידה שלב 6 – תור "נשלח למנהל לטיפול" (mq)', () => {
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await seedAll(); await prep(async (a) => { await a.doc(`b/${A}/staff/e2`).set({ name: 'e2', role: 'employee', active: true, perms: { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false } }); await a.doc(`b/${A}/mq/qo`).set(mqBody('e2')); }); });
  const e = () => fs(U[A].emp), m = () => fs(U[A].mgr);
  it('עובד (גם בלי שום הרשאה) יוצר פריט בשמו, רואה רק את שלו, ולא רואה של אחרים', async () => {
    await assertSucceeds(fs('e2').doc(`b/${A}/mq/qn`).set(mqBody('e2', { k: 'transfer' })));
    await assertSucceeds(fs('e2').doc(`b/${A}/mq/qn/p/0`).set({ data: 'AAAA' }));
    await assertSucceeds(e().doc(`b/${A}/mq/q2`).set(mqBody(U[A].emp)));
    await assertSucceeds(e().collection(`b/${A}/mq`).where('uid', '==', U[A].emp).get());
    await assertFails(e().doc(`b/${A}/mq/qo`).get());
    await assertFails(e().doc(`b/${A}/mq/qn/p/0`).get());
    await assertFails(e().collection(`b/${A}/mq`).get());
  });
  it('בלי סכומים ובלי שדות אחרים; סוג לא מוכר / 13 חלקים / שם של אחר / זמן ישן – נדחה', async () => {
    for (const o of [{ amt: 10 }, { fields: {} }, { k: 'salary' }, { np: 13 }, { np: 0 }, { by: 'e2' }, { t: 1 }, { st: 'done' }]) await assertFails(e().doc(`b/${A}/mq/${fresh()}`).set(mqBody(U[A].emp, o)));
  });
  it('לא עורך ולא מוחק אחרי שליחה (גם לא את שלו); לא מוסיף חלק מעבר ל-np', async () => {
    await prep((a) => a.doc(`b/${A}/mq/qm`).set(mqBody(U[A].emp)));
    await assertFails(e().doc(`b/${A}/mq/qm`).update({ k: 'transfer' }));
    await assertFails(e().doc(`b/${A}/mq/qm`).update(stUpd(U[A].emp, 'done')));
    await assertFails(e().doc(`b/${A}/mq/qm`).delete());
    await assertFails(e().doc(`b/${A}/mq/qm/p/1`).set({ data: 'x' }));
  });
  it('מנהל העסק מטפל פעם אחת: new→done מותר; done→rej, שינוי סוג או בלי stBy שלו – נחסם; מנהל לא יוצר', async () => {
    await assertSucceeds(m().doc(`b/${A}/mq/qo`).update(stUpd(U[A].mgr, 'done')));
    await assertFails(m().doc(`b/${A}/mq/qo`).update(stUpd(U[A].mgr, 'rej')));
    await prep((a) => a.doc(`b/${A}/mq/qx`).set(mqBody('e2')));
    await assertFails(m().doc(`b/${A}/mq/qx`).update(Object.assign(stUpd(U[A].mgr, 'rej'), { k: 'transfer' })));
    await assertFails(m().doc(`b/${A}/mq/qx`).update(stUpd('e2', 'rej')));
    await assertFails(m().doc(`b/${A}/mq/${fresh()}`).set(mqBody(U[A].mgr)));
  });
  it('אין גישה בין עסקים: מנהל ועובד של עסק ב\' לא קוראים, לא מטפלים ולא יוצרים בעסק א\'', async () => {
    await assertFails(fs(U[B].mgr).doc(`b/${A}/mq/qo`).get());
    await assertFails(fs(U[B].mgr).doc(`b/${A}/mq/qo`).update(stUpd(U[B].mgr, 'done')));
    await assertFails(fs(U[B].emp).doc(`b/${A}/mq/${fresh()}`).set(mqBody(U[B].emp)));
  });
});
