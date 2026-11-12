'use strict';
// משימות קבועות, פרטיות ובקשות (12.11.2026) – באמולטור:
//   1. חוקי ptk / rtk / rq בתוך עסק (b/{bizId}): עובד לא רואה של אחר, עובד לא נוגע ב-rtk, בעלים לא סוגר בקשה, מנהל של עסק אחר נחסם,
//      ותוספת tasks כבויה = אין גישה.
//   2. הפונקציה recurringTasks (הליבה runAll, עם now מדומה) מול Firestore של האמולטור: פותחת משימה בזמן הנכון, לא פעמיים
//      (גם בהרצה כפולה ובמקביל), לא ביום לא מתאים / חג (hol), לא לפני ed, מדלגת על נמען לא פעיל, ועובדת בשורש (legacy) וב-b/{bizId}.
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const TK = require('../functions/lib/tk-time');

const A = 'biz-a', B = 'biz-b';
const FEAT = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const U = { [A]: { mgr: 'ra_mgr', emp: 'ra_emp', emp2: 'ra_emp2', off: 'ra_off' }, [B]: { mgr: 'rb_mgr', emp: 'rb_emp', emp2: 'rb_emp2', off: 'rb_off' } };
const D1 = 86400000;
const SUPER = 'r_super', NOBIZ = 'r_nobiz';
let env, seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const ptk = (owner, o) => { const cr = Date.now(); return Object.assign({ owner, by: owner, txt: 'תזכורת', cr, due: cr + 4 * D1, st: 'open', sub: 0, late: '' }, o); };
const rtk = (owner, o) => Object.assign({ owner, by: owner, txt: 'לסגור קופה', to: [U[A].emp], toN: ['עובד א'], np: 0, fq: 'w', wd: [2], hh: 7, mm: 0, hol: true, on: true, cr: Date.now(), ed: Date.now() }, o);
const rq = (owner, o) => Object.assign({ owner, by: owner, txt: 'בקשה', t: Date.now(), st: 'new', ans: '' }, o);
const cm = (uid) => ({ uid, by: uid, txt: 'תגובה', t: Date.now() });

async function seedBiz(features) {
  await env.clearFirestore();
  await prep(async (db) => {
    const b = db.batch();
    for (const biz of [A, B]) {
      const u = U[biz];
      b.set(db.doc('b/' + biz), { name: 'עסק ' + biz, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', bizId: biz, features: Object.assign({}, FEAT, features || {}) });
      b.set(db.doc(`b/${biz}/admins/${u.mgr}`), { email: u.mgr + '@example.invalid' });
      for (const [k, active] of [['mgr', true], ['emp', true], ['emp2', true], ['off', false]]) {
        b.set(db.doc(`b/${biz}/staff/${u[k]}`), { name: u[k], role: k === 'mgr' ? 'manager' : 'employee', active });
        b.set(db.doc('users/' + u[k]), { bizId: biz, role: k === 'mgr' ? 'admin' : 'worker', active, bizStatus: 'active', email: u[k] + '@example.invalid', createdAt: 1 });
      }
    }
    b.set(db.doc('superadmins/' + SUPER), {});
    await b.commit();
  });
}

describe('חוקי ptk / rtk / rq בתוך עסק', () => {
  const P = 'b/' + A + '/';
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => {
    await seedBiz();
    await prep(async (a) => {
      await a.doc(P + 'ptk/p2').set(ptk(U[A].emp2));
      await a.doc(P + 'ptk/p1').set(ptk(U[A].emp));
      await a.doc(P + 'rtk/r1').set(rtk(U[A].mgr));
      await a.doc(P + 'rq/q2').set(rq(U[A].emp2));
      await a.doc(P + 'rq/q1').set(rq(U[A].emp));
      await a.doc(P + 'rq/q2/c/c1').set(cm(U[A].emp2));
    });
  });

  it('ptk: עובד לא קורא של אחר (גם לא בשאילתה), את שלו כן; מנהל כן; מנהל ועובד של עסק אחר – לא', async () => {
    const e = fs(U[A].emp), m = fs(U[A].mgr);
    await assertFails(e.doc(P + 'ptk/p2').get());
    await assertFails(e.collection(P + 'ptk').get());
    await assertSucceeds(e.collection(P + 'ptk').where('owner', '==', U[A].emp).get());
    await assertSucceeds(m.doc(P + 'ptk/p2').get());
    await assertSucceeds(m.collection(P + 'ptk').get());
    await assertFails(fs(U[B].mgr).doc(P + 'ptk/p2').get());
    await assertFails(fs(U[B].mgr).collection(P + 'ptk').get());
    await assertFails(fs(U[B].emp).collection(P + 'ptk').where('owner', '==', U[B].emp).get());
    await assertSucceeds(e.doc(P + 'ptk/' + fresh('p')).set(ptk(U[A].emp)));
    await assertFails(fs(U[B].emp).doc(P + 'ptk/' + fresh('p')).set(ptk(U[B].emp)));
    await assertFails(fs(U[A].off).collection(P + 'ptk').where('owner', '==', U[A].off).get());
    await assertSucceeds(e.doc(P + 'ptk/p1').update({ st: 'done', sub: Date.now(), late: '' }));
    await assertFails(fs(U[A].emp2).doc(P + 'ptk/p1').delete());
    await assertFails(fs(U[B].mgr).doc(P + 'ptk/p1').delete());
  });

  it('rtk: עובד לא קורא ולא כותב; מנהל כן; מנהל של עסק אחר נחסם', async () => {
    const e = fs(U[A].emp), m = fs(U[A].mgr), mb = fs(U[B].mgr);
    await assertFails(e.doc(P + 'rtk/r1').get());
    await assertFails(e.collection(P + 'rtk').get());
    await assertFails(e.doc(P + 'rtk/' + fresh('r')).set(rtk(U[A].emp)));
    await assertSucceeds(m.collection(P + 'rtk').get());
    await assertSucceeds(m.doc(P + 'rtk/' + fresh('r')).set(rtk(U[A].mgr)));
    await assertSucceeds(m.doc(P + 'rtk/r1').update({ on: false, ed: Date.now() + (++seq) }));
    await assertFails(mb.doc(P + 'rtk/r1').get());
    await assertFails(mb.collection(P + 'rtk').get());
    await assertFails(mb.doc(P + 'rtk/' + fresh('r')).set(rtk(U[B].mgr)));
    await assertFails(mb.doc(P + 'rtk/r1').update({ on: true, ed: Date.now() + (++seq) }));
    await assertFails(mb.doc(P + 'rtk/r1').delete());
    await assertSucceeds(m.doc(P + 'rtk/r1').delete());
  });

  it('rq: עובד לא קורא בקשה/תגובות של אחר; בעלים לא סוגר ולא עונה; מנהל עונה; מנהל של עסק אחר נחסם', async () => {
    const e = fs(U[A].emp), m = fs(U[A].mgr), mb = fs(U[B].mgr);
    await assertFails(e.doc(P + 'rq/q2').get());
    await assertFails(e.collection(P + 'rq').get());
    await assertFails(e.collection(P + 'rq/q2/c').get());
    await assertSucceeds(e.collection(P + 'rq').where('owner', '==', U[A].emp).get());
    await assertFails(e.doc(P + 'rq/q1').update({ st: 'done' }));
    await assertFails(e.doc(P + 'rq/q1').update({ ans: 'x' }));
    await assertSucceeds(e.doc(P + 'rq/q1').update({ cAt: Date.now(), cBy: U[A].emp, st: 'new' }));
    await assertSucceeds(e.doc(P + 'rq/q1/c/' + fresh('c')).set(cm(U[A].emp)));
    await assertFails(fs(U[A].emp2).doc(P + 'rq/q1/c/' + fresh('c')).set(cm(U[A].emp2)));
    await assertSucceeds(m.doc(P + 'rq/q1').update({ st: 'done', ans: 'טופל', aBy: U[A].mgr, aAt: Date.now() }));
    await assertSucceeds(m.collection(P + 'rq/q2/c').get());
    await assertFails(mb.doc(P + 'rq/q1').get());
    await assertFails(mb.collection(P + 'rq').get());
    await assertFails(mb.doc(P + 'rq/q1').update({ st: 'rej', ans: 'x', aBy: U[B].mgr, aAt: Date.now() }));
    await assertFails(mb.collection(P + 'rq/q2/c').get());
    await assertFails(mb.doc(P + 'rq/q2/c/' + fresh('c')).set(cm(U[B].mgr)));
    await assertFails(fs(U[B].emp).doc(P + 'rq/' + fresh('q')).set(rq(U[B].emp)));
  });

  it('תוספת tasks כבויה: ptk / rtk / rq נחסמים גם למנהל; עסק ב\' לא מושפע', async () => {
    await prep((a) => a.doc('b/' + A).update({ features: Object.assign({}, FEAT, { tasks: false }) }));
    const m = fs(U[A].mgr), e = fs(U[A].emp);
    await assertFails(m.collection(P + 'rtk').get());
    await assertFails(m.collection(P + 'ptk').get());
    await assertFails(m.collection(P + 'rq').get());
    await assertFails(e.doc(P + 'ptk/' + fresh('p')).set(ptk(U[A].emp)));
    await assertFails(e.doc(P + 'rq/' + fresh('q')).set(rq(U[A].emp)));
    await assertSucceeds(fs(U[B].emp).doc(`b/${B}/rq/${fresh('q')}`).set(rq(U[B].emp)));
  });
});

// ---------------- טבלת בידוד: אוסף × פעולה × 7 תפקידים × שני עסקים (כמו בטבלה של multi-business.test.js) ----------------
// בקובץ נפרד מ-multi-business.test.js, כי התהליך שלו כבר קרוב למגבלת הזיכרון של Node (תוספת שם = heap out of memory).
const ROLES7 = ['mgrA', 'empA', 'mgrB', 'empB', 'super', 'off', 'nobiz'];
function resolve(role, biz) {
  if (role === 'super') return { uid: SUPER, rel: 'super' };
  if (role === 'nobiz') return { uid: NOBIZ, rel: 'nobiz' };
  if (role === 'off') return { uid: U[biz].off, rel: 'off' };
  const b = role.endsWith('A') ? A : B;
  return { uid: U[b][role.slice(0, 3)], rel: b === biz ? role.slice(0, 3) : 'foreign' };
}
const P = (biz) => 'b/' + biz;
const S = ['mgr', 'emp', 'super'], M = ['mgr', 'super'], NONE = [];
const now = () => Date.now();
const ptkBody = (uid) => ptk(uid);
const rtkBody = (uid) => rtk(uid);
const rqBody = (uid) => rq(uid);
const OPS = {
  ptk: {
    get: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/ptk/g1`).set(ptkBody('x'))); return db.doc(`${P(biz)}/ptk/g1`).get(); } },
    list: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/ptk/l_${uid}`).set(ptkBody(uid))); return db.collection(`${P(biz)}/ptk`).where('owner', '==', uid).get(); } },
    create: { allow: S, run: (db, biz, uid) => db.doc(`${P(biz)}/ptk/${fresh()}`).set(ptkBody(uid)) },
    update: { allow: S, run: async (db, biz, uid) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/ptk/${id}`).set(ptkBody(uid))); return db.doc(`${P(biz)}/ptk/${id}`).update({ st: 'done', sub: now(), late: '' }); } },
    delete: { allow: S, run: async (db, biz, uid) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/ptk/${id}`).set(ptkBody(uid))); return db.doc(`${P(biz)}/ptk/${id}`).delete(); } },
  },
  rtk: {
    get: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/rtk/g1`).set(rtkBody('x'))); return db.doc(`${P(biz)}/rtk/g1`).get(); } },
    list: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/rtk/g1`).set(rtkBody('x'))); return db.collection(`${P(biz)}/rtk`).get(); } },
    create: { allow: M, run: (db, biz, uid) => db.doc(`${P(biz)}/rtk/${fresh()}`).set(rtkBody(uid)) },
    update: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/rtk/${id}`).set(rtkBody('x'))); return db.doc(`${P(biz)}/rtk/${id}`).update({ on: false, ed: now() }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/rtk/${id}`).set(rtkBody('x'))); return db.doc(`${P(biz)}/rtk/${id}`).delete(); } },
  },
  rq: {
    get: { allow: M, run: async (db, biz) => { await prep((a) => a.doc(`${P(biz)}/rq/g1`).set(rqBody('x'))); return db.doc(`${P(biz)}/rq/g1`).get(); } },
    list: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/rq/l_${uid}`).set(rqBody(uid))); return db.collection(`${P(biz)}/rq`).where('owner', '==', uid).get(); } },
    create: { allow: S, run: (db, biz, uid) => db.doc(`${P(biz)}/rq/${fresh()}`).set(rqBody(uid)) },
    update: { allow: M, run: async (db, biz, uid) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/rq/${id}`).set(rqBody('x'))); return db.doc(`${P(biz)}/rq/${id}`).update({ st: 'done', ans: 'טופל', aBy: uid, aAt: now() }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep((a) => a.doc(`${P(biz)}/rq/${id}`).set(rqBody('x'))); return db.doc(`${P(biz)}/rq/${id}`).delete(); } },
  },
  'rq/c': {
    get: { allow: S, run: async (db, biz, uid) => { await prep(async (a) => { await a.doc(`${P(biz)}/rq/c_${uid}`).set(rqBody(uid)); await a.doc(`${P(biz)}/rq/c_${uid}/c/c1`).set({ uid: 'x', by: 'x', txt: 'a', t: 1 }); }); return db.doc(`${P(biz)}/rq/c_${uid}/c/c1`).get(); } },
    list: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/rq/c_${uid}`).set(rqBody(uid))); return db.collection(`${P(biz)}/rq/c_${uid}/c`).get(); } },
    create: { allow: S, run: async (db, biz, uid) => { await prep((a) => a.doc(`${P(biz)}/rq/c_${uid}`).set(rqBody(uid))); return db.doc(`${P(biz)}/rq/c_${uid}/c/${fresh()}`).set({ uid, by: uid, txt: 'תגובה', t: now() }); } },
    update: { allow: NONE, run: async (db, biz, uid) => { await prep(async (a) => { await a.doc(`${P(biz)}/rq/c_${uid}`).set(rqBody(uid)); await a.doc(`${P(biz)}/rq/c_${uid}/c/cu`).set({ uid, by: uid, txt: 'a', t: now() }); }); return db.doc(`${P(biz)}/rq/c_${uid}/c/cu`).update({ txt: 'b' }); } },
    delete: { allow: M, run: async (db, biz) => { const id = fresh(); await prep(async (a) => { await a.doc(`${P(biz)}/rq/c1`).set(rqBody('x')); await a.doc(`${P(biz)}/rq/c1/c/${id}`).set({ uid: 'x', by: 'x', txt: 'a', t: 1 }); }); return db.doc(`${P(biz)}/rq/c1/c/${id}`).delete(); } },
  },
};

describe('ptk / rtk / rq – טבלת בידוד בין עסקים (7 תפקידים)', () => {
  const tally = { allow: 0, deny: 0, foreign: 0 };
  before(async () => { env = await H.getEnv(); await seedBiz(); });
  for (const [coll, ops] of Object.entries(OPS)) {
    for (const [op, spec] of Object.entries(ops)) {
      for (const biz of [A, B]) {
        for (const role of ROLES7) {
          const { uid, rel } = resolve(role, biz);
          const expected = rel !== 'foreign' && spec.allow.includes(rel) ? 'allow' : 'deny';
          it(`${coll} | ${op} | ${biz} | ${role} → ${expected === 'allow' ? 'מותר' : 'נחסם'}`, async () => {
            const p = spec.run(fs(uid), biz, uid);
            if (expected === 'allow') await assertSucceeds(p); else await assertFails(p);
            tally[expected]++; if (rel === 'foreign') tally.foreign++;
          });
        }
      }
    }
  }
  it('סיכום: מנהל ועובד של העסק השני נחסמו בכל תא; בכל אוסף ופעולה (חוץ מעדכון תגובה) יש גם "מותר"', () => {
    const cells = Object.values(OPS).reduce((n, o) => n + Object.keys(o).length, 0) * 2 * ROLES7.length;
    assert.equal(tally.allow + tally.deny, cells);
    assert.equal(tally.foreign, cells / 7 * 2);
    for (const [coll, ops] of Object.entries(OPS)) for (const [op, spec] of Object.entries(ops)) if (!(coll === 'rq/c' && op === 'update')) assert.ok(spec.allow.length > 0, coll + '|' + op);
    console.log('# ptk/rtk/rq בידוד: ' + JSON.stringify(tally));
  });
});

// ---------------- הפונקציה ----------------
describe('recurringTasks – פותחת משימות קבועות (ליבה מול האמולטור)', () => {
  let R, adm;
  const at = (y, m, d, hh, mm) => TK.zoned(y, m - 1, d, hh, mm);
  const TUE = at(2026, 11, 17, 7, 0);        // שלישי 17.11.2026 07:00 שעון ישראל
  const ED = at(2026, 11, 1, 9, 0);           // הכלל נשמר לפני שבועיים
  const rule = (o) => Object.assign({ owner: U[A].mgr, by: U[A].mgr, txt: 'לסגור קופה', to: [U[A].emp], toN: ['עובד א'], np: 1, fq: 'w', wd: [2], hh: 7, mm: 0, hol: true, on: true, cr: ED, ed: ED, last: '', n: 0, err: '' }, o);
  const get = async (p) => { const s = await adm.doc(p).get(); return s.exists ? s.data() : null; };
  const tasksOf = async (prefix) => (await adm.collection(prefix + 'tasks').get()).docs;
  const run = (now) => R.runAll({ now });

  before(async () => {
    env = await H.getEnv();
    R = require('../functions/recurring.js')._core;
    // אותו מופע firebase-admin של הפונקציות (functions/node_modules), מול האמולטור (FIRESTORE_EMULATOR_HOST)
    adm = require(require.resolve('firebase-admin/firestore', { paths: [require('node:path').join(__dirname, '..', 'functions')] })).getFirestore();
  });
  beforeEach(async () => { await seedBiz(); });

  it('בזמן הנכון: 06:55 – לא; 07:00 – משימה אחת עם כל השדות של משימת מנהל, due = tkDue, מזהה r-<rid>-<יום>; last/n מתעדכנים', async () => {
    await adm.doc(`b/${A}/rtk/r1`).set(rule());
    let out = await run(at(2026, 11, 17, 6, 55));
    assert.equal((await tasksOf(`b/${A}/`)).length, 0, JSON.stringify(out));
    out = await run(TUE + 2 * 60000);
    assert.equal(out[A].created, 1, JSON.stringify(out));
    const t = await get(`b/${A}/tasks/r-r1-20261117`);
    const now = TUE + 2 * 60000;
    assert.deepEqual(t, { owner: U[A].mgr, by: U[A].mgr, role: 'a', txt: 'לסגור קופה', cr: now, due: TK.tkDue(now), st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '',
      to: [U[A].emp], toN: ['עובד א'], ow: U[A].emp, owN: 'עובד א', clt: now, np: 1, wp: 0, mi: 0, rc: 'r1' });
    assert.ok(t.due >= t.cr + 259200000 && t.due <= t.cr + 1468800000, 'due בטווח שהחוקים מתירים');
    const r = await get(`b/${A}/rtk/r1`);
    assert.equal(r.last, '2026-11-17'); assert.equal(r.n, 1); assert.equal(r.err, '');
    assert.equal((await tasksOf('')).length, 0, 'לא נפתחה משימה בשורש');
    assert.equal((await tasksOf(`b/${B}/`)).length, 0, 'לא נפתחה משימה בעסק ב');
  });

  it('לא פעמיים באותו יום: הרצה חוזרת, שתי הרצות במקביל, ו-last שנמחק (המשימה כבר קיימת) – עדיין משימה אחת', async () => {
    await adm.doc(`b/${A}/rtk/r1`).set(rule());
    const outs = await Promise.all([run(TUE + 60000), run(TUE + 60000)]);
    await run(TUE + 5 * 60000);
    await run(at(2026, 11, 17, 22, 0));
    await adm.doc(`b/${A}/rtk/r1`).update({ last: '' });
    const o4 = await run(at(2026, 11, 17, 23, 0));
    assert.equal(o4[A].exists, 1, JSON.stringify(o4));
    const ts = await tasksOf(`b/${A}/`);
    assert.deepEqual(ts.map((d) => d.id), ['r-r1-20261117'], JSON.stringify(outs));
    assert.equal((await get(`b/${A}/rtk/r1`)).n, 1);
    // שבוע אחרי – משימה חדשה
    await run(at(2026, 11, 24, 7, 5));
    assert.deepEqual((await tasksOf(`b/${A}/`)).map((d) => d.id).sort(), ['r-r1-20261117', 'r-r1-20261124']);
  });

  it('לא ביום לא מתאים, ולא בחג כש-hol (יום כיפור 21.9.2026, שני); hol false – כן', async () => {
    await adm.doc(`b/${A}/rtk/r1`).set(rule({ wd: [1], ed: at(2026, 9, 1, 0, 0) }));
    await adm.doc(`b/${A}/rtk/r2`).set(rule({ wd: [1], hol: false, ed: at(2026, 9, 1, 0, 0) }));
    await adm.doc(`b/${A}/rtk/r3`).set(rule({ wd: [3], ed: at(2026, 9, 1, 0, 0) }));
    await run(at(2026, 9, 21, 9, 0));
    assert.deepEqual((await tasksOf(`b/${A}/`)).map((d) => d.id), ['r-r2-20260921']);
    await run(at(2026, 9, 28, 9, 0)); // שני, חול המועד סוכות – r1 לא; r2 כן
    assert.deepEqual((await tasksOf(`b/${A}/`)).map((d) => d.id).sort(), ['r-r2-20260921', 'r-r2-20260928']);
    await run(at(2026, 10, 5, 9, 0)); // שני רגיל – r1 ו-r2
    assert.deepEqual((await tasksOf(`b/${A}/`)).map((d) => d.id).sort(), ['r-r1-20261005', 'r-r2-20260921', 'r-r2-20260928', 'r-r2-20261005']);
  });

  it('לא לפני ed: כלל שנשמר ב-08:00 לא נפתח היום על 07:00, כן בשבוע הבא; כלל כבוי לא נפתח', async () => {
    await adm.doc(`b/${A}/rtk/r1`).set(rule({ ed: at(2026, 11, 17, 8, 0) }));
    await adm.doc(`b/${A}/rtk/r2`).set(rule({ on: false }));
    await run(at(2026, 11, 17, 8, 5));
    assert.equal((await tasksOf(`b/${A}/`)).length, 0);
    await run(at(2026, 11, 24, 7, 0));
    assert.deepEqual((await tasksOf(`b/${A}/`)).map((d) => d.id), ['r-r1-20261124']);
  });

  it('נמענים: עובד מושבת / לא קיים מדולג; נשאר אחד = אצלו מיד; כמה = "מי שתופס ראשון"; אף אחד = אין משימה ו-err', async () => {
    await adm.doc(`b/${A}/rtk/r1`).set(rule({ to: [U[A].off, U[A].emp, 'nobody'], toN: ['מושבת', 'עובד א', 'אין'] }));
    await adm.doc(`b/${A}/rtk/r2`).set(rule({ to: [U[A].emp, U[A].emp2, U[A].off], toN: ['א', 'ב', 'ג'], np: 0 }));
    await adm.doc(`b/${A}/rtk/r3`).set(rule({ to: [U[A].off, U[B].emp], toN: ['מושבת', 'של עסק אחר'] }));
    const out = await run(TUE + 60000);
    const t1 = await get(`b/${A}/tasks/r-r1-20261117`), t2 = await get(`b/${A}/tasks/r-r2-20261117`);
    assert.deepEqual([t1.to, t1.toN, t1.ow, t1.owN, t1.clt], [[U[A].emp], ['עובד א'], U[A].emp, 'עובד א', TUE + 60000]);
    assert.deepEqual([t2.to, t2.toN, t2.ow, t2.owN, t2.clt, t2.np], [[U[A].emp, U[A].emp2], ['א', 'ב'], '', '', 0, 0]);
    assert.equal(await get(`b/${A}/tasks/r-r3-20261117`), null);
    const r3 = await get(`b/${A}/rtk/r3`);
    assert.equal(r3.err, 'no-recipients'); assert.equal(r3.last, '2026-11-17');
    assert.equal(out[A]['no-recipients'], 1, JSON.stringify(out));
  });

  it('עסק לארג\' פעמי במצב legacy (בשורש) ועסק b/{bizId} – כל אחד ב-tasks שלו; עסק עם tasks כבויה – לא', async () => {
    await H.seed(env); // השורש: staff/u_emp פעיל, u_off מושבת
    await seedBizKeep();
    await adm.doc('rtk/r1').set(rule({ owner: 'u_mgr', by: 'u_mgr', to: ['u_emp', 'u_off'], toN: ['u_emp', 'u_off'] }));
    await adm.doc(`b/${A}/rtk/r1`).set(rule());
    await adm.doc(`b/${B}/rtk/r1`).set(rule({ owner: U[B].mgr, by: U[B].mgr, to: [U[B].emp], toN: ['ב'] }));
    await adm.doc('b/' + B).update({ 'features.tasks': false });
    const out = await run(TUE + 60000);
    const root = await get('tasks/r-r1-20261117');
    assert.ok(root, JSON.stringify(out));
    assert.deepEqual([root.to, root.ow, root.rc], [['u_emp'], 'u_emp', 'r1']);
    assert.ok(await get(`b/${A}/tasks/r-r1-20261117`));
    assert.equal((await tasksOf(`b/${B}/`)).length, 0);
  });

  it('משימה שנפתחה עוברת את חוקי האפליקציה: העובד תופס/מסמן בוצע בזמן (late לפי due), המנהל קורא', async () => {
    // פותחים "עכשיו" (שעון אמיתי) כדי שהחוקים (nowOk) יקבלו את הסימון: כלל חודשי ליום של היום בישראל, 00:00
    const now = Date.now();
    const r = rule({ np: 0, ed: 0, hh: 0, mm: 0, fq: 'm', md: TK.wall(now).d, hol: false });
    const d = TK.decide(r, now);
    assert.equal(d.go, true);
    await adm.doc(`b/${A}/rtk/r1`).set(r);
    await run(now);
    const id = 'r-r1-' + d.key;
    assert.ok(await get(`b/${A}/tasks/${id}`));
    await assertSucceeds(fs(U[A].mgr).doc(`b/${A}/tasks/${id}`).get());
    await assertSucceeds(fs(U[A].emp).doc(`b/${A}/tasks/${id}`).get());
    const n = Date.now();
    await assertSucceeds(fs(U[A].emp).doc(`b/${A}/tasks/${id}`).update({ st: 'done', open: '', sub: n, ok: n, doneBy: U[A].emp, late: '' }));
  });
});

// seedBiz בלי למחוק את השורש (לבדיקת legacy + עסק)
async function seedBizKeep() {
  await prep(async (db) => {
    const b = db.batch();
    for (const biz of [A, B]) {
      const u = U[biz];
      b.set(db.doc('b/' + biz), { name: 'עסק ' + biz, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', bizId: biz, features: Object.assign({}, FEAT) });
      b.set(db.doc(`b/${biz}/admins/${u.mgr}`), { email: u.mgr + '@example.invalid' });
      for (const [k, active] of [['mgr', true], ['emp', true], ['emp2', true], ['off', false]]) b.set(db.doc(`b/${biz}/staff/${u[k]}`), { name: u[k], role: 'employee', active });
    }
    await b.commit();
  });
}

after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* האמולטור כבר נסגר */ } });
