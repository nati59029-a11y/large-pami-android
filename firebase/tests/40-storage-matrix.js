'use strict';
// בדיקות "תיקייה × תפקיד × פעולה" ל-Storage, לפי permissions-matrix.json (פרק 20.3, ו"כל השאר: אף אחד").

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const matrix = require('./permissions-matrix.json');
const H = require('./helpers');

const BIN = { contentType: 'application/octet-stream' };
const MB50 = 50 * 1024 * 1024;
let seq = 0;
const fresh = () => `b_${Date.now()}_${++seq}.bin`;
// ב-SDK, put מחזיר "משימת העלאה"; ממירים אותה להבטחה רגילה
const up = (ref, data, meta) => new Promise((res, rej) => ref.put(data, meta).then(res, rej));

const OPS = {
  'app_backups/{uid}/': {
    'read-own':              (st, me) => st.ref(`app_backups/${me}/seed.bin`).getMetadata(),
    'read-other':            (st) => st.ref(`app_backups/${H.OTHER}/seed.bin`).getMetadata(),
    'list-own':              (st, me) => st.ref(`app_backups/${me}`).listAll(),
    'list-other':            (st) => st.ref(`app_backups/${H.OTHER}`).listAll(),
    'create-own':            (st, me) => up(st.ref(`app_backups/${me}/${fresh()}`), new Uint8Array([9, 9, 9]), BIN),
    'overwrite-own':         (st, me) => up(st.ref(`app_backups/${me}/seed.bin`), new Uint8Array([7, 7]), BIN),
    'create-own-too-big':    (st, me) => up(st.ref(`app_backups/${me}/${fresh()}`), new Uint8Array(MB50 + 1), BIN),
    'create-own-not-binary': (st, me) => up(st.ref(`app_backups/${me}/${fresh()}`), new Uint8Array([65, 66]), { contentType: 'text/plain' }),
    'create-other':          (st) => up(st.ref(`app_backups/${H.OTHER}/${fresh()}`), new Uint8Array([1]), BIN),
    'delete-own':            (st, me) => st.ref(`app_backups/${me}/seed.bin`).delete(),
    'delete-other':          (st) => st.ref(`app_backups/${H.OTHER}/seed.bin`).delete(),
  },
  _not_in_table: {
    'read-other-path':   (st) => st.ref('products/p1.jpg').getMetadata(),
    'create-other-path': (st) => up(st.ref('products/' + fresh()), new Uint8Array([1]), { contentType: 'image/jpeg' }),
  },
};

describe('Storage – תיקייה × תפקיד × פעולה (טבלה 20.3)', () => {
  let env;
  before(async () => { env = await H.getEnv(); await H.seed(env); });
  beforeEach(async () => { await H.clearStorageAndSeed(env); });

  for (const [folder, spec] of Object.entries(matrix.storage)) {
    for (const [op, flags] of Object.entries(spec.ops)) {
      if (!OPS[folder] || !OPS[folder][op]) throw new Error(`חסר מימוש לפעולה ${folder}/${op}`);
      H.ROLES.forEach((role, i) => {
        const expected = flags[i] === 'A' ? 'allow' : 'deny';
        const key = `storage|${folder}|${role}|${op}`;
        it(`${folder} | ${matrix.roleNames[role]} | ${op} → ${expected === 'allow' ? 'מותר' : 'נחסם'}`, async () => {
          const st = H.ctxFor(env, role).storage();
          const me = H.UID[role] || 'nobody';
          const p = OPS[folder][op](st, me);
          if (expected === 'allow') await assertSucceeds(p); else await assertFails(p);
          H.record('matrix', { key, expected });
        });
      });
    }
  }

  // גבול הגודל: בדיוק 50MB מותר (עובד פעיל), 50MB + בית אחד נחסם (נבדק בטבלה למעלה)
  it('app_backups: קובץ של בדיוק 50MB – מותר לעובד פעיל', async () => {
    const st = H.ctxFor(env, 'employee').storage();
    await assertSucceeds(up(st.ref(`app_backups/u_emp/${fresh()}`), new Uint8Array(MB50), BIN));
    H.record('special', { key: 'storage-50mb-boundary' });
  });
});
