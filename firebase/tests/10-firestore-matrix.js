'use strict';
// בדיקות "אוסף × תפקיד × פעולה" ל-Firestore, לפי permissions-matrix.json.
// לכל תא: אם בטבלה "מותר" – הפעולה חייבת להצליח; אם "אין" – הפעולה חייבת להיחסם (permission-denied).

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const matrix = require('./permissions-matrix.json');
const H = require('./helpers');

let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;

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
