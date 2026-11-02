'use strict';
// בדיקות "אוסף × תפקיד × פעולה" ל-Firestore, לפי permissions-matrix.json.
// לכל תא: אם בטבלה "מותר" – הפעולה חייבת להצליח; אם "אין" – הפעולה חייבת להיחסם (permission-denied).

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const matrix = require('./permissions-matrix.json');
const H = require('./helpers');

let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const newSup = () => ({ c: 'bak', n: 'ספק', d: '2026-11-01', at: '2026-11-01', a: '10', inv: '2', by: 'מנהל', pend: '', src: '', m: '2026-11', np: '0', h: 'a', fh: 'b' });
const newReq = (uid, np) => ({ uid, by: uid, txt: 'בקשה', t: Date.now(), st: 'new', np: np || 0 });
const newTask = (owner) => { const cr = Date.now(); return { owner, by: owner, role: 'w', txt: 'משימה', cr, due: cr + 4 * 86400000,
  st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '' }; };

// איך מבצעים כל פעולה. db = Firestore של המשתמש; me = המזהה שלו ('nobody' לגולש).
const OPS = {
  admins: {
    'get-own':   (db, me) => db.doc('admins/' + me).get(),
    'get-other': (db, me) => db.doc('admins/' + (me === 'u_mgr' ? H.MANAGER_ONLY_ADMINS : 'u_mgr')).get(),
    'list':      (db) => db.collection('admins').get(),
    'create':    (db, me) => db.doc('admins/' + me + '_new').set({ email: 'x' }),
    'update':    (db) => db.doc('admins/u_mgr').update({ email: 'changed' }),
    'delete':    (db) => db.doc('admins/u_mgr').delete(),
  },
  cfg: {
    'get':    (db) => db.doc('cfg/main').get(),
    'list':   (db) => db.collection('cfg').get(),
    'create': (db) => db.doc('cfg/' + fresh('c')).set({ data: '{}' }),
    'update': (db) => db.doc('cfg/main').update({ data: '{"cats":[]}' }),
    'delete': (db) => db.doc('cfg/main').delete(),
  },
  shelf: {
    'get':    (db) => db.doc('shelf/price').get(),
    'list':   (db) => db.collection('shelf').get(),
    'create': (db) => db.doc('shelf/' + fresh('s')).set({ data: '{}', at: '2' }),
    'update': (db) => db.doc('shelf/price').update({ at: '3' }),
    'delete': (db) => db.doc('shelf/price').delete(),
  },
  fb: {
    'get-approved':        (db) => db.doc('fb/fb_ok').get(),
    'get-new':             (db) => db.doc('fb/fb_new').get(),
    'list-approved':       (db) => db.collection('fb').where('st', '==', 'ok').get(),
    'list-all':            (db) => db.collection('fb').get(),
    'create-own-new':      (db, me) => db.doc('fb/' + fresh('f')).set({ data: '{}', img: '', owner: me, at: '1', st: 'new' }),
    'create-own-approved': (db, me) => db.doc('fb/' + fresh('f')).set({ data: '{}', img: '', owner: me, at: '1', st: 'ok' }),
    'create-other-owner':  (db) => db.doc('fb/' + fresh('f')).set({ data: '{}', img: '', owner: H.OTHER, at: '1', st: 'new' }),
    'update':              (db) => db.doc('fb/fb_ok').update({ data: '{"x":1}' }),
    'delete':              (db) => db.doc('fb/fb_ok').delete(),
  },
  bk: {
    'get':    (db) => db.doc('bk/meta').get(),
    'list':   (db) => db.collection('bk').get(),
    'create': (db, me) => db.doc('bk/' + fresh('b')).set({ data: 'x', owner: me }),
    'update': (db) => db.doc('bk/meta').update({ data: '{"gen":"a"}' }),
    'delete': (db) => db.doc('bk/meta').delete(),
  },
  chunks: {
    'get-own':            (db, me) => db.doc(`chunks/c_${me}_0`).get(),
    'get-other':          (db) => db.doc(`chunks/c_${H.OTHER}_0`).get(),
    'list-own':           (db, me) => db.collection('chunks').where('owner', '==', me).get(),
    'list-all':           (db) => db.collection('chunks').get(),
    'create-own':         (db, me) => db.doc('chunks/' + fresh('n') + '_0').set({ owner: me, data: 'x' }),
    'create-other-owner': (db) => db.doc('chunks/' + fresh('n') + '_0').set({ owner: H.OTHER, data: 'x' }),
    'update-own':         (db, me) => db.doc(`chunks/c_${me}_0`).update({ data: 'y' }),
    'delete-own':         (db, me) => db.doc(`chunks/c_${me}_0`).delete(),
    'delete-other':       (db) => db.doc(`chunks/c_${H.OTHER}_0`).delete(),
  },
  inbox: {
    'get-own':      (db, me) => db.doc(`inbox/i_${me}`).get(),
    'get-other':    (db) => db.doc(`inbox/i_${H.OTHER}`).get(),
    'list-own':     (db, me) => db.collection('inbox').where('owner', '==', me).get(),
    'list-new':     (db) => db.collection('inbox').where('status', '==', 'new').get(),
    'list-all':     (db) => db.collection('inbox').get(),
    // יצירה תקינה: קודם החלק הראשון ב-chunks (נוצר כאן בלי כללים, כדי לבדוק רק את כלל ה-inbox)
    'create-own-new': async (db, me, env) => {
      const id = fresh('in');
      await env.withSecurityRulesDisabled((c) => c.firestore().doc(`chunks/${id}_0`).set({ owner: me, data: 'x' }));
      return db.doc('inbox/' + id).set({ owner: me, by: me, status: 'new', created: 'x', data: '{}', parts: '1' });
    },
    'create-own-imported': async (db, me, env) => {
      const id = fresh('in');
      await env.withSecurityRulesDisabled((c) => c.firestore().doc(`chunks/${id}_0`).set({ owner: me, data: 'x' }));
      return db.doc('inbox/' + id).set({ owner: me, by: me, status: 'imported', created: 'x', data: '{}', parts: '1' });
    },
    'create-without-chunk': (db, me) => db.doc('inbox/' + fresh('in')).set({ owner: me, by: me, status: 'new', created: 'x', data: '{}', parts: '1' }),
    'create-other-owner': async (db, me, env) => {
      const id = fresh('in');
      await env.withSecurityRulesDisabled((c) => c.firestore().doc(`chunks/${id}_0`).set({ owner: H.OTHER, data: 'x' }));
      return db.doc('inbox/' + id).set({ owner: H.OTHER, by: H.OTHER, status: 'new', created: 'x', data: '{}', parts: '1' });
    },
    'update-other': (db) => db.doc(`inbox/i_${H.OTHER}`).update({ status: 'imported' }),
    'delete-other': (db) => db.doc(`inbox/i_${H.OTHER}`).delete(),
  },
  staff: {
    'get-own':      (db, me) => db.doc('staff/' + me).get(),
    'get-other':    (db) => db.doc('staff/' + H.OTHER).get(),
    'list':         (db) => db.collection('staff').get(),
    'set-own':      (db, me) => db.doc('staff/' + me).set({ name: me, email: 'x', role: 'manager', active: true, addedAt: 'x', addedBy: me, pushTokens: [] }),
    'update-other': (db) => db.doc('staff/' + H.OTHER).update({ active: false }),
    'delete-other': (db) => db.doc('staff/' + H.OTHER).delete(),
  },
  app_backup_status: {
    'get-own':      (db, me) => db.doc('app_backup_status/' + me).get(),
    'get-other':    (db) => db.doc('app_backup_status/' + H.OTHER).get(),
    'list':         (db) => db.collection('app_backup_status').get(),
    'set-own':      (db, me) => db.doc('app_backup_status/' + me).set({ lastBackupAt: 'x', size: 1, device: 'd' }),
    'update-other': (db) => db.doc('app_backup_status/' + H.OTHER).update({ size: 2 }),
    'delete-other': (db) => db.doc('app_backup_status/' + H.OTHER).delete(),
  },
  // משימות. משימה חדשה תקינה: יעד 4 ימים מעכשיו (בין 72 שעות ל-17 יום), כמו באפליקציה.
  tasks: {
    'get-open':            (db) => db.doc('tasks/t_open').get(),
    'get-done':            (db) => db.doc('tasks/t_done').get(),
    'get-done-late':       (db) => db.doc('tasks/t_done_late').get(),
    'list-open':           (db) => db.collection('tasks').where('open', '==', '1').get(),
    'list-all':            (db) => db.collection('tasks').get(),
    'create-own':          (db, me) => db.doc('tasks/' + fresh('t')).set(newTask(me)),
    'create-other-owner':  (db) => db.doc('tasks/' + fresh('t')).set(newTask(H.OTHER)),
    'update-mark-done':    (db, me) => { const n = Date.now(); return db.doc('tasks/t_open').update({ st: 'done', open: '', sub: n, ok: n, doneBy: me, late: '' }); },
    'update-other-fields': (db) => db.doc('tasks/t_open').update({ txt: 'שונה' }),
    'update-comment-mark': (db, me) => db.doc('tasks/t_open').update({ cAt: Date.now(), cBy: me }),
    'update-nc-mark':      (db) => db.doc('tasks/t_open').update({ nc: '1' }),
    'update-remove-nc':    (db) => db.doc('tasks/t_nc').update({ nc: '' }),
    'update-done-with-nc': (db, me) => { const n = Date.now(); return db.doc('tasks/t_nc').update({ st: 'done', open: '', sub: n, ok: n, doneBy: me, late: '' }); },
    'update-wait-with-nc': (db, me) => db.doc('tasks/t_nc').update({ st: 'wait', sub: Date.now(), doneBy: me }),
    'update-return-to-open': (db) => db.doc('tasks/t_done').update({ st: 'open', open: '1', img: '', sub: 0, doneBy: '', ok: 0, late: '', note: 'לא גמור', rt: '1' }),
    'delete':              (db) => db.doc('tasks/t_open').delete(),
  },
  tasks_c: {
    'get-on-open-task':    (db) => db.doc('tasks/t_open/c/c1').get(),
    'get-on-done-task':    (db) => db.doc('tasks/t_done/c/c1').get(),
    'list-on-open-task':   (db) => db.collection('tasks/t_open/c').get(),
    'create-own':          (db, me) => db.doc('tasks/t_nc/c/' + fresh('c')).set({ uid: me, by: me, txt: 'שלום', t: Date.now() }),
    'create-own-without-nc-mark': (db, me) => db.doc('tasks/t_open/c/' + fresh('c')).set({ uid: me, by: me, txt: 'שלום', t: Date.now() }),
    'create-other-uid':    (db) => db.doc('tasks/t_open/c/' + fresh('c')).set({ uid: H.OTHER, by: H.OTHER, txt: 'שלום', t: Date.now() }),
    'create-on-done-task': (db, me) => db.doc('tasks/t_done/c/' + fresh('c')).set({ uid: me, by: me, txt: 'שלום', t: Date.now() }),
    'update':              (db) => db.doc('tasks/t_open/c/c1').update({ txt: 'שונה' }),
    'delete':              (db) => db.doc('tasks/t_open/c/c1').delete(),
  },
  // חשבוניות ספקים לעובד (supSync במכשיר המנהל, supLoad במכשיר העובד)
  supinv: {
    'get':                (db) => db.doc('supinv/s1').get(),
    'list-month':         (db) => db.collection('supinv').where('m', '==', '2026-11').get(),
    'create':             (db) => db.doc('supinv/' + fresh('s')).set(newSup()),
    'create-extra-field': (db) => db.doc('supinv/' + fresh('s')).set(Object.assign(newSup(), { amt_all: '999' })),
    'update':             (db) => db.doc('supinv/s1').set(Object.assign(newSup(), { a: '-50' })),
    'delete':             (db) => db.doc('supinv/s1').delete(),
  },
  supinv_p: {
    'get':            (db) => db.doc('supinv/s1/p/0').get(),
    'create':         (db) => db.doc('supinv/s1/p/1').set({ data: 'AAAA' }),
    'create-too-big': (db) => db.doc('supinv/s1/p/1').set({ data: 'A'.repeat(700001) }),
    'update':         (db) => db.doc('supinv/s1/p/0').set({ data: 'BBBB' }),
    'delete':         (db) => db.doc('supinv/s1/p/0').delete(),
  },
  // בקשות לעדכון האפליקציה (arLoad / FRM.arAdd / FRM.arSt / ACT.arDel)
  appreq: {
    'get':                (db) => db.doc('appreq/r1').get(),
    'list':               (db) => db.collection('appreq').get(),
    'create-own':         (db, me) => db.doc('appreq/' + fresh('r')).set(newReq(me)),
    'create-other-uid':   (db) => db.doc('appreq/' + fresh('r')).set(newReq(H.OTHER)),
    'create-with-status': (db, me) => db.doc('appreq/' + fresh('r')).set(Object.assign(newReq(me), { st: 'done' })),
    'update-status':      (db, me) => db.doc('appreq/r1').update({ st: 'doing', stBy: me, stAt: Date.now(), note: 'בטיפול' }),
    'update-text':        (db) => db.doc('appreq/r1').update({ txt: 'שונה' }),
    'delete':             (db) => db.doc('appreq/r1').delete(),
  },
  appreq_p: {
    'get':                     (db) => db.doc('appreq/r1/p/0').get(),
    'create-own-request':      async (db, me) => { const id = fresh('r'); await db.doc('appreq/' + id).set(newReq(me, 1)); return db.doc('appreq/' + id + '/p/0').set({ data: 'AAAA' }); },
    'create-on-other-request': (db) => db.doc('appreq/r1/p/1').set({ data: 'AAAA' }),
    'create-too-big':          async (db, me) => { const id = fresh('r'); try { await db.doc('appreq/' + id).set(newReq(me, 1)); } catch (e) { /* תפקיד שלא יוצר – נחסם ממילא */ } return db.doc('appreq/' + id + '/p/0').set({ data: 'A'.repeat(700001) }); },
    'update':                  (db) => db.doc('appreq/r1/p/0').set({ data: 'BBBB' }),
    'delete':                  (db) => db.doc('appreq/r1/p/0').delete(),
  },
  _not_in_table: {
    'get-orders':    (db) => db.doc('orders/o1').get(),
    'list-orders':   (db) => db.collection('orders').get(),
    'create-orders': (db) => db.doc('orders/' + fresh('o')).set({ x: 1 }),
    'create-cfg-subcollection': (db) => db.doc('cfg/main/extra/' + fresh('x')).set({ x: 1 }),
  },
};

describe('Firestore – אוסף × תפקיד × פעולה (טבלה 3.3 / 20.3)', () => {
  let env;
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); });

  for (const [coll, spec] of Object.entries(matrix.firestore)) {
    for (const [op, flags] of Object.entries(spec.ops)) {
      if (!OPS[coll] || !OPS[coll][op]) throw new Error(`חסר מימוש לפעולה ${coll}/${op}`);
      H.ROLES.forEach((role, i) => {
        const expected = flags[i] === 'A' ? 'allow' : 'deny';
        const key = `firestore|${coll}|${role}|${op}`;
        it(`${coll} | ${matrix.roleNames[role]} | ${op} → ${expected === 'allow' ? 'מותר' : 'נחסם'}`, async () => {
          const db = H.ctxFor(env, role).firestore();
          const me = H.UID[role] || 'nobody';
          const p = OPS[coll][op](db, me, env);
          if (expected === 'allow') await assertSucceeds(p); else await assertFails(p);
          H.record('matrix', { key, expected });
        });
      });
    }
  }
});

module.exports = { OPS };
