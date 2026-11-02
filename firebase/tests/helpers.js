'use strict';
// כלי עזר משותפים לבדיקות. רץ רק מול האמולטור המקומי (פרויקט דמה demo-largpeami).
// אין כאן שום פנייה לפרויקט Firebase אמיתי.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = 'demo-largpeami';

// הגנה: לעולם לא רצים בלי אמולטור.
function requireEmulator() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error('הבדיקות רצות רק בתוך האמולטור. הרץ: npm test (בתוך התיקייה firebase/)');
  }
}

// ---- המשתמשים בבדיקות: 5 התפקידים ----
const ROLES = ['guest', 'signedIn', 'disabledEmployee', 'employee', 'manager'];
const UID = {
  guest: null,
  signedIn: 'u_out',          // מחובר, אין לו מסמך ב-staff ולא ב-admins
  disabledEmployee: 'u_off',  // staff/u_off עם active == false
  employee: 'u_emp',          // staff/u_emp עם active == true
  manager: 'u_mgr',           // admins/u_mgr + staff/u_mgr (role: manager, active: true)
};
const OTHER = 'u_emp2';       // עובד פעיל נוסף – "מישהו אחר"
const MANAGER_ONLY_ADMINS = 'u_mgr_old'; // מנהל כמו היום: רק admins, בלי מסמך staff

let testEnv = null;
async function getEnv() {
  if (testEnv) return testEnv;
  requireEmulator();
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
    storage: { rules: fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8') },
  });
  return testEnv;
}

function ctxFor(env, role) {
  const uid = UID[role];
  return uid ? env.authenticatedContext(uid, { email: uid + '@example.invalid' }) : env.unauthenticatedContext();
}

// ---- נתוני דמו: נטענים מחדש לפני כל בדיקה, בלי כללים ----
async function seed(env) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const b = db.batch();
    const now = '2026-10-28T10:00:00.000Z';
    b.set(db.doc('admins/u_mgr'), { email: 'u_mgr@example.invalid' });
    b.set(db.doc('admins/' + MANAGER_ONLY_ADMINS), { email: 'old@example.invalid' });
    const staff = (uid, role, active) => b.set(db.doc('staff/' + uid), {
      name: uid, email: uid + '@example.invalid', role, active, addedAt: now, addedBy: 'u_mgr', pushTokens: [],
    });
    staff('u_mgr', 'manager', true);
    staff('u_emp', 'employee', true);
    staff('u_emp2', 'employee', true);
    staff('u_off', 'employee', false);
    for (const uid of ['u_mgr', 'u_emp', 'u_emp2', 'u_off', 'u_out']) {
      b.set(db.doc('app_backup_status/' + uid), { lastBackupAt: now, size: 1234, device: 'demo' });
    }
    b.set(db.doc('cfg/main'), { data: JSON.stringify({ cats: [], th: 'paper', at: now }) });
    b.set(db.doc('shelf/price'), { data: JSON.stringify({ items: [], next: 0 }), at: '1' });
    b.set(db.doc('fb/fb_ok'), { data: '{}', img: '', owner: OTHER, at: '1', st: 'ok' });
    b.set(db.doc('fb/fb_new'), { data: '{}', img: '', owner: OTHER, at: '1', st: 'new' });
    b.set(db.doc('bk/meta'), { data: '{}', owner: 'u_mgr' });
    for (const uid of ['u_mgr', 'u_emp', 'u_off', 'u_out', OTHER]) {
      b.set(db.doc(`chunks/c_${uid}_0`), { owner: uid, data: 'x' });
      b.set(db.doc(`inbox/i_${uid}`), { owner: uid, by: uid, status: 'new', created: now, data: '{}', parts: '1' });
    }
    b.set(db.doc('orders/o1'), { x: 1 });
    b.set(db.doc('supinv/s1'), { c: 'sup', n: 'ספק', d: '2026-11-02', at: '2026-11-02', a: '100', inv: '1', by: 'מנהל', pend: '', src: '', m: '2026-11', np: '1', h: 'x', fh: 'y' });
    b.set(db.doc('supinv/s1/p/0'), { data: 'data:image/jpeg;base64,AAAA' });
    // משימות (tasks) ותגובות (tasks/{id}/c). זמנים יחסית לעכשיו, כי הכללים בודקים מול שעון השרת.
    const T = Date.now(), H1 = 3600000, D1 = 86400000;
    const task = (id, o) => b.set(db.doc('tasks/' + id), Object.assign({ owner: OTHER, by: OTHER, role: 'w', txt: 'משימה ' + id,
      cr: T - H1, due: T + 4 * D1, st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '' }, o));
    task('t_open', {});
    task('t_nc', { nc: '1' }); // משימה פתוחה שיש בה הערת עובד – "בוצע" של עובד עובר לאישור מנהל
    task('t_pr', { pr: '1' });
    task('t_wait', { pr: '1', st: 'wait', img: 'data:image/jpeg;base64,' + 'A'.repeat(200), sub: T - 1000, doneBy: OTHER });
    task('t_overdue', { cr: T - 6 * D1, due: T - D1 });
    task('t_done', { st: 'done', open: '', sub: T - 2000, ok: T - 2000, doneBy: OTHER });
    task('t_done_late', { st: 'done', open: '', sub: T - 2000, ok: T - 2000, doneBy: OTHER, late: '1', cr: T - 9 * D1, due: T - 5 * D1 });
    b.set(db.doc('tasks/t_open/c/c1'), { uid: OTHER, by: OTHER, txt: 'תגובה', t: T - 5000 });
    b.set(db.doc('tasks/t_done/c/c1'), { uid: 'u_mgr', by: 'u_mgr', txt: 'תגובה', t: T - 5000 });
    // בקשות לעדכון האפליקציה (appreq): בקשה של עובד אחר עם תמונה בחלק אחד
    b.set(db.doc('appreq/r1'), { uid: OTHER, by: OTHER, txt: 'בקשה', t: T - 5000, st: 'new', np: 1 });
    b.set(db.doc('appreq/r1/p/0'), { data: 'PAGES:["data:image/jpeg;base64,AAAA"]' });
    // סגירת קופה (closings): סגירה של עובד אחר, בסטטוס 'new', עם צילומים בחלק אחד
    b.set(db.doc('closings/z1'), { uid: OTHER, by: OTHER, t: T - 5000, st: 'new', np: 1, reg: 'i_nl', d: '2026-10-20', no: '555', data: JSON.stringify({ v: 1, f: { d: '2026-10-20', no: '555', credit: '594.72', cash: '60.10', total: '654.82', drawer: '982.70', oTot: '970.30' }, ack: 1 }) });
    b.set(db.doc('closings/z1/p/0'), { data: 'PAGES:["data:image/jpeg;base64,AAAA"]' });
    await b.commit();
  });
}

async function clearStorageAndSeed(env) {
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const st = ctx.storage();
    for (const uid of ['u_mgr', 'u_emp', 'u_off', 'u_out', OTHER]) {
      await st.ref(`app_backups/${uid}/seed.bin`).put(new Uint8Array([1, 2, 3]), { contentType: 'application/octet-stream' });
    }
    await st.ref('products/p1.jpg').put(new Uint8Array([1]), { contentType: 'image/jpeg' });
    // עדכוני APK (app_releases/latest/): קובץ גרסה ו-APK לדוגמה, כמו שתהליך הבנייה מעלה
    await st.ref('app_releases/latest/version.json').put(new TextEncoder().encode(JSON.stringify({ versionCode: 1001, size: 2, sha256: '0'.repeat(64), file: 'large-pami.apk' })), { contentType: 'application/json' });
    await st.ref('app_releases/latest/large-pami.apk').put(new Uint8Array([80, 75]), { contentType: 'application/vnd.android.package-archive' });
  });
}

// ---- רישום תוצאות: כל בדיקה שעברה נרשמת, ובסוף בודקים כיסוי ----
const RESULTS = { matrix: [], app: [], special: [] };
function record(kind, entry) { RESULTS[kind].push(entry); }

// ---- בקשות REST בדיוק כמו באפליקציה (fsx, שורה 1341 ב-ZIP של הבסיס c9bac16) ----
// טוקן לא חתום – האמולטור מקבל אותו (כמו @firebase/rules-unit-testing).
function mockToken(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://securetoken.google.com/' + PROJECT_ID, aud: PROJECT_ID, iat, exp: iat + 3600, auth_time: iat,
    sub: uid, user_id: uid, email: uid + '@example.invalid',
    firebase: { sign_in_provider: 'password', identities: {} },
  };
  return b64({ alg: 'none', kid: 'fakekid', type: 'JWT' }) + '.' + b64(payload) + '.';
}
const FSB = () => `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const sv = (v) => ({ stringValue: String(v == null ? '' : v) });
// fsx(path, opt) – אותה חתימה כמו באפליקציה; מחזיר { status, json } במקום לזרוק.
async function fsx(uid, p, opt) {
  opt = opt || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opt.headers);
  if (uid) headers.Authorization = 'Bearer ' + mockToken(uid);
  const r = await fetch(FSB() + p, Object.assign({}, opt, { headers }));
  let json = null; try { json = await r.json(); } catch (e) { /* גוף ריק */ }
  return { status: r.status, json };
}

// ---- קריאת index.html המקורי מתוך ה-ZIP (בלי כלים חיצוניים) ----
function readFromZip(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath);
  // חיפוש רשומת הסיום של ה-ZIP (End of Central Directory)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('קובץ ZIP לא תקין: ' + zipPath);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('מבנה ZIP לא צפוי');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    if (name === entryName) {
      const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
      const data = buf.slice(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
      throw new Error('שיטת דחיסה לא נתמכת: ' + method);
    }
    off += 46 + nameLen + extraLen + commLen;
  }
  throw new Error('הקובץ ' + entryName + ' לא נמצא ב-ZIP');
}
const APP_ZIP = path.resolve(ROOT, '..', 'large-pami-android-project.zip');
function appSourceLines() { return readFromZip(APP_ZIP, 'www/index.html').split('\n'); }

module.exports = {
  ROOT, PROJECT_ID, ROLES, UID, OTHER, MANAGER_ONLY_ADMINS,
  getEnv, ctxFor, seed, clearStorageAndSeed, RESULTS, record,
  mockToken, fsx, sv, appSourceLines, APP_ZIP,
};
