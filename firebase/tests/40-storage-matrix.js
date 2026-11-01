'use strict';
// בדיקות "תיקייה × תפקיד × פעולה" ל-Storage, לפי permissions-matrix.json (פרק 20.3, ו"כל השאר: אף אחד").

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const matrix = require('./permissions-matrix.json');
const H = require('./helpers');

const BIN = { contentType: 'application/octet-stream' };
const APK = { contentType: 'application/vnd.android.package-archive' };
const MB50 = 50 * 1024 * 1024;
let seq = 0;
const fresh = () => `b_${Date.now()}_${++seq}.bin`;
// ב-SDK, put מחזיר "משימת העלאה"; ממירים אותה להבטחה רגילה
const up = (ref, data, meta) => new Promise((res, rej) => ref.put(data, meta).then(res, rej));
// הורדת התוכן בדיוק כמו באפליקציה: REST, ?alt=media, "Authorization: Firebase <token>" (בלי כניסה: בלי הכותרת).
// 403 נזרק כ-permission-denied, כדי ש-assertFails יקבל רק חסימה של הכללים ולא כל שגיאה אחרת.
async function restGet(st, me, name) {
  const url = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${encodeURIComponent(st.ref().bucket)}/o/${encodeURIComponent(name)}?alt=media`;
  const r = await fetch(url, { headers: me && me !== 'nobody' ? { Authorization: 'Firebase ' + H.mockToken(me) } : {} });
  if (r.status === 403) { const e = new Error('PERMISSION_DENIED: ' + name); e.code = 'permission-denied'; throw e; }
  if (r.status !== 200) throw new Error('unexpected HTTP ' + r.status + ' for ' + name);
  return new Uint8Array(await r.arrayBuffer());
}

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
  // עדכוני APK: רק קריאה, ורק לעובד פעיל או למנהל. אף אחד לא כותב (ההעלאה רק מתהליך הבנייה, עם מפתח גישה).
  'app_releases/latest/': {
    'read-version':        (st) => st.ref('app_releases/latest/version.json').getMetadata(),
    'download-version':    (st, me) => restGet(st, me, 'app_releases/latest/version.json'),
    'download-apk':        (st, me) => restGet(st, me, 'app_releases/latest/large-pami.apk'),
    'list':                (st) => st.ref('app_releases/latest').listAll(),
    'create-apk':          (st) => up(st.ref('app_releases/latest/' + fresh() + '.apk'), new Uint8Array([80, 75]), APK),
    'overwrite-version':   (st) => up(st.ref('app_releases/latest/version.json'), new TextEncoder().encode('{"versionCode":9999}'), { contentType: 'application/json' }),
    'overwrite-apk':       (st) => up(st.ref('app_releases/latest/large-pami.apk'), new Uint8Array([80, 75, 9]), APK),
    'delete-apk':          (st) => st.ref('app_releases/latest/large-pami.apk').delete(),
    'create-other-folder': (st) => up(st.ref('app_releases/evil/large-pami.apk'), new Uint8Array([80, 75]), APK),
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

  // עדכוני APK: מנהל "כמו היום" (רק admins, בלי staff) קורא; עובד שהושבת באמצע נחסם מיד.
  it('app_releases: מנהל עם admins בלבד קורא את קובץ הגרסה; עובד שהושבת נחסם מיד', async () => {
    const mgrOld = env.authenticatedContext(H.MANAGER_ONLY_ADMINS).storage();
    await assertSucceeds(mgrOld.ref('app_releases/latest/version.json').getMetadata());
    await assertSucceeds(restGet(mgrOld, H.MANAGER_ONLY_ADMINS, 'app_releases/latest/large-pami.apk'));
    const emp = H.ctxFor(env, 'employee').storage();
    await assertSucceeds(emp.ref('app_releases/latest/version.json').getMetadata());
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('staff/u_emp').update({ active: false }));
    await assertFails(emp.ref('app_releases/latest/version.json').getMetadata());
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('staff/u_emp').update({ active: true }));
    H.record('special', { key: 'storage-app-releases-admins-only-and-disable' });
  });

  // אותה בקשה שהאפליקציה שולחת (REST, "Authorization: Firebase <token>", ?alt=media)
  it('app_releases: בקשת REST כמו באפליקציה – עובד 200 עם התוכן, מחובר שאינו צוות 403, בלי כניסה 403', async () => {
    const url = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${encodeURIComponent(env.unauthenticatedContext().storage().ref().bucket)}/o/${encodeURIComponent('app_releases/latest/version.json')}?alt=media`;
    const get = (uid) => fetch(url, { headers: uid ? { Authorization: 'Firebase ' + H.mockToken(uid) } : {} });
    const r1 = await get(H.UID.employee);
    assert.equal(r1.status, 200);
    assert.equal(JSON.parse(await r1.text()).versionCode, 1001);
    assert.equal((await get(H.UID.signedIn)).status, 403);
    assert.equal((await get(H.UID.disabledEmployee)).status, 403);
    assert.equal((await get(null)).status, 403);
    H.record('special', { key: 'storage-app-releases-rest' });
  });
});
