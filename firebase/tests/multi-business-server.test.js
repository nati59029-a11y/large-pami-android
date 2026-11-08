'use strict';
// ריבוי עסקים (משימה 2026-11-05, שלב 5): פונקציות השרת לפי עסק, ופונקציות הניהול.
// רץ לבד (לא דרך all.test.js), מול האמולטור בלבד (auth, firestore, storage, functions):
//   firebase emulators:exec --only auth,firestore,storage,functions --project demo-largpeami "node --test tests/multi-business-server.test.js"
// Gemini וימות מוחלפים בשרתי דמה מקומיים (gemini-mock.js, yemot-mock.js). אין שום פנייה החוצה, ואין שליחת מייל.
// עסקים: largpeami (השורש, legacy, בלי מסמך b/largpeami – כמו היום בייצור), biz-a, biz-b.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');
const YM = require('./yemot-mock');
// firebase-admin מותקן רק בתיקיית functions – אותו מופע שהפונקציות עצמן משתמשות בו
const fa = (m) => require(require.resolve(m, { paths: [path.join(__dirname, '..', 'functions')] }));

const A = 'biz-a', B = 'biz-b', L = 'largpeami';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const U = { [A]: { mgr: 'a_mgr', emp: 'a_emp', off: 'a_off' }, [B]: { mgr: 'b_mgr', emp: 'b_emp', off: 'b_off' }, super: 'u_super', nobiz: 'u_nobiz' };
// משתמשי השורש (לארג' פעמי, בלי מסמך users – כמו היום)
const R = { mgr: 'u_mgr', emp: 'u_emp', off: 'u_off' };

const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (name) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${name}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  const status = json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status);
  const reason = json && json.error && json.error.details && json.error.details.reason;
  return { status, reason, result: json && json.result, error: json && json.error, text };
}
const jpg = () => { const b = Buffer.alloc(200); Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(b); return { mimeType: 'image/jpeg', data: b.toString('base64') }; };
const SCAN = () => ({ kind: 'invoice', files: [jpg()] });

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const prepSt = (fn) => env.withSecurityRulesDisabled((c) => fn(c.storage()));
async function getDoc(p) { let v = null; await prep(async (db) => { const s = await db.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function listDocs(p) { let v = []; await prep(async (db) => { const s = await db.collection(p).get(); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; }

function bizDoc(biz, o) {
  return Object.assign({ name: 'עסק ' + biz, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: U.super,
    features: Object.assign({}, ALL), brand: { name: 'עסק', logoPath: '', colors: {}, base: 'dark-gold', updatedAt: 1, updatedBy: 'x' } }, o);
}
async function seedAll() {
  await env.clearFirestore();
  await prep(async (db) => {
    const b = db.batch();
    b.set(db.doc('superadmins/' + U.super), {});
    // לארג' פעמי בשורש, כמו היום
    b.set(db.doc('admins/' + R.mgr), { email: 'u_mgr@example.invalid' });
    for (const [uid, role, active] of [[R.mgr, 'manager', true], [R.emp, 'employee', true], [R.off, 'employee', false]]) b.set(db.doc('staff/' + uid), { name: uid, email: uid + '@example.invalid', role, active, pushTokens: [] });
    // עותק users לחברי השורש, כמו שכלי ההעברה יוצר (באותה אצווה, ולכן הטריגרים syncLegacy* מוצאים אותו תואם ולא כותבים)
    for (const [uid, role, active] of [[R.mgr, 'admin', true], [R.emp, 'worker', true], [R.off, 'worker', false]]) b.set(db.doc('users/' + uid), { bizId: L, role, active, bizStatus: 'active', email: uid + '@example.invalid', createdAt: 1 });
    for (const biz of [A, B]) {
      const u = U[biz];
      b.set(db.doc('b/' + biz), bizDoc(biz));
      b.set(db.doc(`b/${biz}/admins/${u.mgr}`), { email: u.mgr + '@example.invalid' });
      b.set(db.doc(`b/${biz}/staff/${u.mgr}`), { name: u.mgr, role: 'manager', active: true, pushTokens: [] });
      b.set(db.doc(`b/${biz}/staff/${u.emp}`), { name: u.emp, role: 'employee', active: true, pushTokens: [] });
      b.set(db.doc(`b/${biz}/staff/${u.off}`), { name: u.off, role: 'employee', active: false, pushTokens: [] });
      for (const k of ['mgr', 'emp', 'off']) b.set(db.doc('users/' + u[k]), { bizId: biz, role: k === 'mgr' ? 'admin' : 'worker', active: k !== 'off', bizStatus: 'active', email: u[k] + '@example.invalid', createdAt: 1 });
    }
    await b.commit();
  });
}
const setBiz = (biz, o) => prep((db) => db.doc('b/' + biz).update(o));
const audits = async (biz) => (await listDocs(`b/${biz}/audit`));

before(async () => {
  env = await H.getEnv();
  await GM.start(); await YM.start(9797);
  // מאתחל את firebase-admin בתהליך הבדיקה (מול האמולטור), לבדיקות שקוראות לליבה ישירות
  require('../functions/index.js');
});
after(async () => { await GM.stop(); await YM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(async () => { await seedAll(); GM.reset(); YM.reset(); });

// ---------------------------------------------------------------------------------------------
describe('שלב 5 – לארג\' פעמי במצב legacy (בלי מסמך b/largpeami) עובד כמו היום', () => {
  it('scanDocument של עובד בשורש: עובר, ונספר ב-scan_usage/{uid} בשורש בלבד (בלי מונה עסק, בלי b/)', async () => {
    const r = await call('scanDocument', R.emp, SCAN());
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await getDoc('scan_usage/' + R.emp)).count, 1);
    assert.equal(await getDoc('scan_usage/_biz'), null);
    assert.deepEqual(await listDocs(`b/${L}/scan_usage`), []);
  });
  it('registerPushToken / getBackupKey / reportBackupStatus של משתמשי השורש – בשורש, כמו היום', async () => {
    const t = 'tok_' + 'a'.repeat(40);
    assert.equal((await call('registerPushToken', R.emp, { token: t })).status, 'OK');
    assert.deepEqual((await getDoc('staff/' + R.emp)).pushTokens, [t]);
    assert.equal((await call('getBackupKey', R.mgr)).status, 'OK');
    await prepSt((s) => s.ref(`app_backups/${R.emp}/x.bin`).put(new Uint8Array([1, 2]), { contentType: 'application/octet-stream' }));
    const r = await call('reportBackupStatus', R.emp, { file: 'x.bin', device: 'd' });
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await getDoc('app_backup_status/' + R.emp)).size, 2);
    // עובד מושבת ומשתמש בלי חברות – אותן סיבות כמו היום
    assert.equal((await call('getBackupKey', R.off)).reason, 'staff-disabled');
    assert.equal((await call('getBackupKey', U.nobiz)).reason, 'not-staff');
    assert.equal((await call('getBackupKey', null)).status, 'UNAUTHENTICATED');
  });
  it('לארג\' פעמי במצב legacy עם מסמך b/largpeami: הנתונים נשארים בשורש; dataRoot=b מעביר אותם ל-b/largpeami', async () => {
    await prep((db) => db.doc('b/' + L).set(bizDoc(L, { dataRoot: 'legacy' })));
    assert.equal((await call('scanDocument', R.emp, SCAN())).status, 'OK');
    assert.equal((await getDoc('scan_usage/' + R.emp)).count, 1);
    await setBiz(L, { dataRoot: 'b' });
    await prep(async (db) => { await db.doc(`b/${L}/staff/${R.emp}`).set({ name: 'e', role: 'employee', active: true }); });
    assert.equal((await call('scanDocument', R.emp, SCAN())).status, 'OK');
    assert.equal((await getDoc('scan_usage/' + R.emp)).count, 1, 'השורש לא השתנה');
    assert.equal((await getDoc(`b/${L}/scan_usage/${R.emp}`)).count, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// כל פונקציה שמשתמש רגיל קורא לה: bizId של עסק אחר בקלט = שגיאה, בלי לגעת בשום עסק
const MEMBER_FNS = {
  scanDocument: SCAN, registerPushToken: () => ({ token: 'tok_' + 'b'.repeat(40) }), reportBackupStatus: () => ({ file: 'x.bin' }), getBackupKey: () => ({}),
  sendPromoToLine: () => ({ statusOnly: true }), publishLineItem: () => ({}), removeLineItem: () => ({}), getLineState: () => ({}), listLineFiles: () => ({}),
  previewVoice: () => ({}), getLineBoard: () => ({}), getLineAudio: () => ({}), extendLineItem: () => ({}), restoreLineItem: () => ({}),
  addStaff: () => ({ email: 'new@example.invalid', name: 'חדש' }), setStaffActive: () => ({ uid: U[A].emp, active: false }),
  setStaffName: () => ({ uid: U[A].emp, name: 'זר' }),
};
describe('שלב 5 – bizId של עסק אחר בקלט: שגיאה, בלי פעולה על העסק האחר (לכל פונקציה)', () => {
  for (const [fn, input] of Object.entries(MEMBER_FNS)) {
    it(`${fn}: מנהל ב' ששולח bizId של עסק א' → PERMISSION_DENIED (foreign-biz); עסק א' לא השתנה`, async () => {
      const before = JSON.stringify([await listDocs(`b/${A}/staff`), await listDocs(`b/${A}/audit`), await listDocs(`b/${A}/scan_usage`)]);
      for (const uid of [U[B].mgr, U[B].emp, R.mgr]) {
        const r = await call(fn, uid, Object.assign(input(), { bizId: A }));
        assert.equal(r.status, 'PERMISSION_DENIED', `${uid}: ${r.text}`);
        assert.equal(r.reason, 'foreign-biz', `${uid}: ${r.text}`);
      }
      assert.equal(JSON.stringify([await listDocs(`b/${A}/staff`), await listDocs(`b/${A}/audit`), await listDocs(`b/${A}/scan_usage`)]), before);
      assert.equal(GM.state.requests.length, 0, 'לא נשלח ל-Gemini');
      assert.equal(YM.state.requests.length, 0, 'לא נשלח לימות');
    });
  }
  it('bizId של העסק שלו – מותר (שקוף); bizId לא תקין – INVALID_ARGUMENT', async () => {
    assert.equal((await call('getBackupKey', U[B].emp, { bizId: B })).status, 'OK');
    assert.equal((await call('getBackupKey', U[B].emp, { bizId: 'X/../a' })).reason, 'bad-biz');
  });
  it('"בכל שדה אחר": registerPushToken / reportBackupStatus / setStaffActive / addStaff של עסק ב\' לא נוגעים בעסק א\'', async () => {
    const t = 'tok_' + 'c'.repeat(40);
    assert.equal((await call('registerPushToken', U[B].emp, { token: t })).status, 'OK');
    assert.deepEqual((await getDoc(`b/${B}/staff/${U[B].emp}`)).pushTokens, [t]);
    assert.deepEqual((await getDoc(`b/${A}/staff/${U[A].emp}`)).pushTokens, []);
    // קובץ גיבוי שקיים רק בעסק א' – לא נמצא לעובד ב'
    await prepSt((s) => s.ref(`b/${A}/app_backups/${U[B].emp}/x.bin`).put(new Uint8Array([1]), { contentType: 'application/octet-stream' }));
    assert.equal((await call('reportBackupStatus', U[B].emp, { file: 'x.bin' })).reason, 'no-backup-file');
    await prepSt((s) => s.ref(`b/${B}/app_backups/${U[B].emp}/x.bin`).put(new Uint8Array([1, 2, 3]), { contentType: 'application/octet-stream' }));
    assert.equal((await call('reportBackupStatus', U[B].emp, { file: 'x.bin' })).status, 'OK');
    assert.equal((await getDoc(`b/${B}/app_backup_status/${U[B].emp}`)).size, 3);
    assert.equal(await getDoc(`b/${A}/app_backup_status/${U[B].emp}`), null);
    assert.equal(await getDoc(`app_backup_status/${U[B].emp}`), null);
    // מנהל ב' משבית עובד של עסק א' (uid בקלט) – לא נמצא; העובד של א' נשאר פעיל
    assert.equal((await call('setStaffActive', U[B].mgr, { uid: U[A].emp, active: false })).reason, 'no-staff');
    assert.equal((await getDoc(`b/${A}/staff/${U[A].emp}`)).active, true);
    assert.equal((await getDoc('users/' + U[A].emp)).active, true);
    // מנהל ב' מוסיף כעובד את המייל של עובד א' – נדחה, בהודעה אחידה שלא מגלה שהמייל שייך לעסק אחר (6ג, ליקוי 2 מסבב בדיקה 1)
    const { getAuth } = fa('firebase-admin/auth');
    await getAuth().createUser({ uid: U[A].emp, email: 'a_emp_real@example.invalid' }).catch(() => {});
    const r = await call('addStaff', U[B].mgr, { email: 'a_emp_real@example.invalid', name: 'x' });
    assert.equal(r.reason, 'not-superadmin', r.text); // 6ה: מנהל עסק לא מוסיף עובדים בכלל
    assert.equal((await call('addStaff', U.super, { bizId: B, email: 'a_emp_real@example.invalid', name: 'x' })).reason, 'other-biz');
    assert.equal(await getDoc(`b/${B}/staff/${U[A].emp}`), null);
  });
  it('מנהל־על בוחר עסק (bizId) ופועל בו כמנהל; עובד/מנהל רגיל לא יכול לבחור', async () => {
    const r = await call('getBackupKey', U.super, { bizId: A });
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await call('getBackupKey', U.super)).reason, 'no-biz');
    assert.equal((await call('getBackupKey', U.super, { bizId: 'biz-none' })).reason, 'not-staff');
  });
});

// ---------------------------------------------------------------------------------------------
describe('שלב 5 – תוספת כבויה: הפונקציה נדחית; סריקה לא נשלחת ל-Gemini', () => {
  it('scan כבויה בעסק א\': scanDocument נדחית (feature-off) ו-Gemini המדומה לא קיבל שום בקשה; בעסק ב\' (מופעלת) – נשלחת', async () => {
    await setBiz(A, { 'features.scan': false });
    for (const uid of [U[A].emp, U[A].mgr, U.super]) {
      const r = await call('scanDocument', uid, uid === U.super ? Object.assign(SCAN(), { bizId: A }) : SCAN());
      assert.equal(r.status, 'FAILED_PRECONDITION', r.text);
      assert.equal(r.reason, 'feature-off');
    }
    assert.equal(GM.state.requests.length, 0, 'אף בקשה לא יצאה ל-Gemini');
    assert.deepEqual(await listDocs(`b/${A}/scan_usage`), [], 'לא נספר במכסה');
    const ok = await call('scanDocument', U[B].emp, SCAN());
    assert.equal(ok.status, 'OK', ok.text);
    assert.ok(GM.state.requests.length > 0, 'בעסק ב\' הבקשה כן נשלחה');
  });
  it('עסק חדש (features ריק): scan כבויה כברירת מחדל', async () => {
    await setBiz(A, { features: {} });
    assert.equal((await call('scanDocument', U[A].emp, SCAN())).reason, 'feature-off');
    assert.equal(GM.state.requests.length, 0);
  });
  it('yemot כבויה: כל פונקציות הקו נדחות (feature-off); מופעלת בעסק שאינו largpeami: yemot-not-connected; אין פנייה לימות', async () => {
    const YFN = ['sendPromoToLine', 'publishLineItem', 'removeLineItem', 'getLineState', 'listLineFiles', 'previewVoice', 'getLineBoard', 'getLineAudio', 'extendLineItem', 'restoreLineItem'];
    await setBiz(A, { 'features.yemot': false });
    for (const fn of YFN) assert.equal((await call(fn, U[A].mgr, {})).reason, 'feature-off', fn);
    for (const fn of YFN) assert.equal((await call(fn, U[B].mgr, {})).reason, 'yemot-not-connected', fn);
    assert.equal(YM.state.requests.length, 0);
    // לארג' פעמי – כמו היום (statusOnly בלי פנייה לימות)
    const r = await call('sendPromoToLine', R.emp, { statusOnly: true });
    assert.equal(r.status, 'OK', r.text);
  });
  it('עסק מושהה: מנהל ועובד נחסמים (biz-suspended), מנהל־על לא', async () => {
    await setBiz(A, { status: 'suspended' });
    assert.equal((await call('getBackupKey', U[A].emp)).reason, 'biz-suspended');
    assert.equal((await call('scanDocument', U[A].mgr, SCAN())).reason, 'biz-suspended');
    assert.equal((await call('getBackupKey', U.super, { bizId: A })).status, 'OK');
    assert.equal(GM.state.requests.length, 0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('שלב 5 – פונקציות ניהול: רק מנהל־על; כל פעולה ב-audit', () => {
  const SUPER_FNS = {
    createBusiness: () => ({ bizId: 'biz-new', name: 'חדש', ownerEmail: 'owner@example.invalid', ownerPhone: '050-1234567' }),
    inviteBusinessAdmin: () => ({ bizId: A, email: 'x@example.invalid' }),
    setBusinessFeatures: () => ({ bizId: A, features: { scan: false } }),
    setBusinessStatus: () => ({ bizId: A, status: 'suspended' }),
    setBusinessAdv: () => ({ bizId: A, adv: { limits: { scanDaily: 5 } } }),
    setYemotToken: () => ({ bizId: A }),
    logBusinessEntry: () => ({ bizId: A }),
    setBusinessBrand: () => ({ bizId: A, brand: { name: 'מותג' } }), // עדכון חוזה 14
  };
  for (const [fn, input] of Object.entries(SUPER_FNS)) {
    it(`${fn}: מנהל א', עובד א', מנהל ב', מנהל השורש ומחובר בלי עסק – נחסמים; אורח – לא מחובר; מנהל־על – מצליח ונרשם ב-audit`, async () => {
      for (const uid of [U[A].mgr, U[A].emp, U[B].mgr, R.mgr, U.nobiz]) {
        const r = await call(fn, uid, input());
        assert.equal(r.status, 'PERMISSION_DENIED', `${uid}: ${r.text}`); assert.equal(r.reason, 'not-superadmin');
      }
      assert.equal((await call(fn, null, input())).status, 'UNAUTHENTICATED');
      assert.equal((await getDoc('b/biz-new')), null);
      assert.deepEqual(await audits(A), []);
      const r = await call(fn, U.super, input());
      assert.equal(r.status, 'OK', r.text);
      const biz = input().bizId;
      const acts = (await audits(biz)).map((x) => x.act);
      assert.ok(acts.includes(fn === 'logBusinessEntry' ? 'superadminEnter' : fn), acts.join(','));
      for (const x of await audits(biz)) { assert.equal(x.by, U.super); assert.ok(Number.isInteger(x.t)); assert.deepEqual(Object.keys(x).sort(), ['act', 'by', 'id', 'note', 't']); }
    });
  }
  it('createBusiness: מבנה המסמך לפי החוזה; ownerEmail/ownerPhone ב-private/info; ולידציה; אין כפילות; largpeami שמור', async () => {
    const r = await call('createBusiness', U.super, { bizId: 'biz-new', name: 'עסק חדש', ownerEmail: 'Owner@Example.invalid', ownerPhone: '+972-50-123-4567' });
    assert.equal(r.status, 'OK', r.text);
    const d = await getDoc('b/biz-new');
    assert.equal(d.status, 'active'); assert.equal(d.dataRoot, 'b'); assert.equal(d.schemaVersion, 1); assert.deepEqual(d.features, { scan: true }); // סריקה אחידה, שלב 2 assert.equal(d.createdBy, U.super);
    assert.equal(d.brand.base, 'dark-gold');
    for (const k of ['ownerEmail', 'ownerPhone', 'adv']) assert.equal(d[k], undefined, k + ' לא במסמך העסק');
    assert.deepEqual(await getDoc('b/biz-new/private/info'), { ownerEmail: 'owner@example.invalid', ownerPhone: '0501234567', adv: { limits: { scanDaily: 20 } } }); // סריקה אחידה, שלב 2
    assert.equal((await call('createBusiness', U.super, { bizId: 'biz-new', name: 'x', ownerEmail: 'a@example.invalid', ownerPhone: '0501234567' })).reason, 'biz-exists');
    for (const [bad, reason] of [[{ bizId: 'AB' }, 'bad-biz'], [{ bizId: 'ab_c' }, 'bad-biz'], [{ bizId: 'a'.repeat(31) }, 'bad-biz'], [{ bizId: L }, 'reserved'], [{ ownerPhone: '123' }, 'bad-phone'], [{ ownerEmail: 'no-at' }, 'bad-email'], [{ name: 'x'.repeat(61) }, 'bad-name']]) {
      const x = await call('createBusiness', U.super, Object.assign({ bizId: 'biz-ok', name: 'x', ownerEmail: 'a@example.invalid', ownerPhone: '0501234567' }, bad));
      assert.equal(x.reason, reason, JSON.stringify(bad) + ' ' + x.text);
    }
    assert.equal(await getDoc('b/biz-ok'), null);
    assert.equal(await getDoc('b/' + L), null, 'largpeami לא נוצר');
  });
  it('כניסה ראשונה (שלב 6ג): בלי קוד. החשבון נוצר בלי סיסמה, המנהל רשום מיד, והתשובה מחזירה רק uid ומייל (פירוט: server-auth-invite.test.js)', async () => {
    const r = await call('createBusiness', U.super, { bizId: 'biz-new', name: 'חדש', ownerEmail: 'boss@example.invalid', ownerPhone: '0501234567' });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(Object.keys(r.result).sort(), ['bizId', 'email', 'ok', 'uid']);
    const { uid } = r.result;
    assert.ok(await getDoc(`b/biz-new/admins/${uid}`));
    assert.deepEqual((({ bizId, role, active, bizStatus }) => ({ bizId, role, active, bizStatus }))(await getDoc('users/' + uid)), { bizId: 'biz-new', role: 'admin', active: true, bizStatus: 'active' });
    assert.deepEqual((await listDocs('b/biz-new/private')).map((d) => d.id), ['info'], 'אין מסמך הזמנה/קוד');
    // אין סיסמה: אי אפשר להיכנס (מול אמולטור Auth)
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const si = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'boss@example.invalid', password: 'Secret-pass-1', returnSecureToken: true }) });
    assert.notEqual(si.status, 200);
    // completeInvite לא קיימת יותר
    assert.equal((await call('completeInvite', null, { email: 'boss@example.invalid', code: '12345678', password: 'Secret-pass-1' })).status, 'HTTP_404');
    // המנהל החדש עובד בעסק שלו בלבד
    assert.equal((await call('getBackupKey', uid)).status, 'OK');
    assert.equal((await call('getBackupKey', uid, { bizId: A })).reason, 'foreign-biz');
  });
  it('הזמנה לא "גונבת" חשבון: מייל של מנהל־על או של חבר בעסק אחר (כולל לארג\' פעמי בשורש) – נדחה', async () => {
    const { getAuth } = fa('firebase-admin/auth');
    await getAuth().createUser({ uid: U.super, email: 'super@example.invalid' }).catch(() => {});
    await getAuth().createUser({ uid: U[B].mgr, email: 'bmgr@example.invalid' }).catch(() => {});
    await getAuth().createUser({ uid: R.emp, email: 'root-emp@example.invalid' }).catch(() => {});
    assert.equal((await call('inviteBusinessAdmin', U.super, { bizId: A, email: 'super@example.invalid' })).reason, 'is-superadmin');
    assert.equal((await call('inviteBusinessAdmin', U.super, { bizId: A, email: 'bmgr@example.invalid' })).reason, 'other-biz');
    assert.equal((await call('inviteBusinessAdmin', U.super, { bizId: A, email: 'root-emp@example.invalid' })).reason, 'other-biz');
    assert.equal(await getDoc(`b/${A}/admins/${U[B].mgr}`), null);
  });
  it('מנהל עסק (לא מנהל־על) שמוסיף עובד: הודעה אחת אחידה לכל מייל חסום – לא מגלה מי מנהל־העל ומי שייך לעסק אחר', async () => {
    const { getAuth } = fa('firebase-admin/auth');
    await getAuth().createUser({ uid: U.super, email: 'super@example.invalid' }).catch(() => {});
    await getAuth().createUser({ uid: U[B].mgr, email: 'bmgr@example.invalid' }).catch(() => {});
    await getAuth().createUser({ uid: R.emp, email: 'root-emp@example.invalid' }).catch(() => {});
    const rs = [];
    for (const email of ['super@example.invalid', 'bmgr@example.invalid', 'root-emp@example.invalid']) rs.push(await call('addStaff', U[A].mgr, { email, name: 'x' }));
    // 6ה: מנהל עסק נחסם לפני כל בדיקה של המייל – אותה תשובה לכל מייל, ולכן גם לא מגלה דבר
    for (const r of rs) {
      assert.equal(r.status, 'PERMISSION_DENIED', r.text);
      assert.equal(r.reason, 'not-superadmin', r.text);
      assert.equal(r.error.message, rs[0].error.message);
      assert.doesNotMatch(r.error.message, /עסק אחר/);
      assert.equal(JSON.stringify(r.error.details), JSON.stringify({ reason: 'not-superadmin' }));
    }
    for (const uid of [U.super, U[B].mgr, R.emp]) assert.equal(await getDoc(`b/${A}/staff/${uid}`), null);
    // מנהל־על (שבחר את העסק) עדיין מקבל את הסיבה המפורטת
    assert.equal((await call('addStaff', U.super, { bizId: A, email: 'super@example.invalid', name: 'x' })).reason, 'is-superadmin');
    assert.equal((await call('addStaff', U.super, { bizId: A, email: 'bmgr@example.invalid', name: 'x' })).reason, 'other-biz');
  });
  it('עדכון חוזה 14 – חשבון קיים שלא אומת ואינו חבר: מנהל עסק מקבל not-joinable והחשבון לא נוגע; מנהל־על – החשבון מנוטרל כמו קודם', async () => {
    const { getAuth } = fa('firebase-admin/auth');
    const auth = getAuth();
    await auth.deleteUser('u_pre').catch(() => {});
    await auth.createUser({ uid: 'u_pre', email: 'pre@example.invalid', emailVerified: false, password: 'Pre-pass-123' });
    const before = await auth.getUser('u_pre');
    const r = await call('addStaff', U[A].mgr, { email: 'pre@example.invalid', name: 'עובד' });
    assert.equal(r.status, 'PERMISSION_DENIED', r.text); // 6ה: מנהל עסק לא מוסיף עובדים
    assert.equal(r.reason, 'not-superadmin', r.text);
    assert.equal(JSON.stringify(r.error.details), JSON.stringify({ reason: 'not-superadmin' }));
    const after = await auth.getUser('u_pre');
    assert.equal(after.disabled, false, 'לא הושבת');
    assert.equal(after.email, 'pre@example.invalid', 'המייל לא הוחלף');
    assert.equal(after.tokensValidAfterTime, before.tokensValidAfterTime, 'החיבורים לא בוטלו');
    assert.equal((await auth.getUserByEmail('pre@example.invalid')).uid, 'u_pre', 'לא נוצר חשבון חדש למייל');
    assert.equal(await getDoc(`b/${A}/staff/u_pre`), null);
    assert.equal(await getDoc('users/u_pre'), null);
    assert.ok(!(await audits(A)).some((x) => x.act === 'addStaff'), 'לא נרשמה הוספה');
    // מנהל־על (שבחר את העסק): ניטרול כמו היום – החשבון הישן מושבת עם כתובת שלא מקבלת דואר, ונוצר חשבון חדש
    const s = await call('addStaff', U.super, { bizId: A, email: 'pre@example.invalid', name: 'עובד' });
    assert.equal(s.status, 'OK', s.text);
    assert.notEqual(s.result.uid, 'u_pre');
    const old = await auth.getUser('u_pre');
    assert.equal(old.disabled, true); assert.match(old.email, /@orphaned\.invalid$/);
    assert.ok(await getDoc(`b/${A}/staff/${s.result.uid}`));
    await auth.deleteUser('u_pre').catch(() => {}); await auth.deleteUser(s.result.uid).catch(() => {});
  });
  it('בלי אמולטור (ייצור): אין קוד ואין שדות מייל/תוקף בתשובה (שלב 6ג: אין מנגנון קוד בכלל)', async () => {
    const B5 = require('../functions/business.js')._core;
    const T = require('../functions/lib/tenant');
    const prev = process.env.FUNCTIONS_EMULATOR; delete process.env.FUNCTIONS_EMULATOR;
    try {
      const r = await T.scoped(B5.inviteBusinessAdmin)({ auth: { uid: U.super }, data: { bizId: A, email: 'prod@example.invalid' } });
      assert.deepEqual(Object.keys(r).sort(), ['email', 'ok', 'uid']);
      assert.ok(!JSON.stringify(r).match(/\d{8}/), 'אין קוד בתשובה');
    } finally { if (prev !== undefined) process.env.FUNCTIONS_EMULATOR = prev; }
  });
  it('setBusinessStatus: מעדכן status וגם bizStatus בכל users של העסק – באצוות (450 משתמשים, יותר מאצווה אחת), ולא נוגע בעסק ב\'', async () => {
    await prep(async (db) => { for (let i = 0; i < 450; i += 150) { const b = db.batch(); for (let j = i; j < i + 150; j++) b.set(db.doc('users/zz' + j), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: 'x', createdAt: 1 }); await b.commit(); } });
    const r = await call('setBusinessStatus', U.super, { bizId: A, status: 'suspended' });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.users, 453);
    assert.equal((await getDoc('b/' + A)).status, 'suspended');
    const us = await listDocs('users');
    assert.equal(us.filter((u) => u.bizId === A && u.bizStatus !== 'suspended').length, 0);
    assert.equal(us.filter((u) => u.bizId === B && u.bizStatus !== 'active').length, 0);
    assert.equal((await call('getBackupKey', U[A].emp)).reason, 'biz-suspended');
    assert.equal((await call('setBusinessStatus', U.super, { bizId: A, status: 'deleted' })).reason, 'bad-status');
    assert.equal((await call('setBusinessStatus', U.super, { bizId: A, status: 'active' })).result.status, 'active');
    assert.equal((await call('getBackupKey', U[A].emp)).status, 'OK');
  });
  it('setBusinessFeatures: מפתח לא מוכר / ערך לא בוליאני – שגיאה; משנה רק את המפתחות שנשלחו', async () => {
    assert.equal((await call('setBusinessFeatures', U.super, { bizId: A, features: { evil: true } })).reason, 'unknown-feature');
    assert.equal((await call('setBusinessFeatures', U.super, { bizId: A, features: { scan: 'yes' } })).reason, 'bad-features');
    assert.equal((await call('setBusinessFeatures', U.super, { bizId: 'biz-none', features: { scan: true } })).reason, 'no-biz');
    const r = await call('setBusinessFeatures', U.super, { bizId: A, features: { scan: false, tasks: false } });
    assert.equal(r.status, 'OK', r.text);
    const f = (await getDoc('b/' + A)).features;
    assert.equal(f.scan, false); assert.equal(f.tasks, false); assert.equal(f.shelf, true);
  });
  it('setBusinessBrand (עדכון חוזה 14): ולידציה; שדה שלא נשלח נשאר; updatedBy/updatedAt של השרת; audit; לא נוגע בשדות אחרים ובעסק ב\'; legacy נדחה', async () => {
    const b0 = await getDoc('b/' + A), bB = await getDoc('b/' + B);
    const cols = { acc: '#AABBCC', acc2: '#ddeeff', onacc: '#000000', bg: '#111111', card: '#222222', ink: '#ffffff' };
    const r = await call('setBusinessBrand', U.super, { bizId: A, brand: { name: '  מאפייה  ', logoPath: `b/${A}/brand/logo`, colors: cols } });
    assert.equal(r.status, 'OK', r.text);
    const d = await getDoc('b/' + A);
    assert.equal(d.brand.name, 'מאפייה'); assert.equal(d.brand.logoPath, `b/${A}/brand/logo`); assert.equal(d.brand.colors.acc, '#aabbcc');
    assert.equal(d.brand.base, 'dark-gold'); assert.equal(d.brand.updatedBy, U.super); assert.ok(Math.abs(d.brand.updatedAt - Date.now()) < 60000);
    assert.deepEqual(Object.keys(d.brand).sort(), ['base', 'colors', 'logoPath', 'name', 'theme', 'updatedAt', 'updatedBy']);
    assert.equal(d.brand.theme, 'a', 'D1: dark-gold בלי theme → a');
    for (const k of Object.keys(b0)) if (k !== 'brand') assert.deepEqual(d[k], b0[k], k + ' לא השתנה');
    assert.deepEqual(r.result.brand, d.brand);
    // רק colors: השם והלוגו נשארים
    assert.equal((await call('setBusinessBrand', U.super, { bizId: A, brand: { colors: {} } })).status, 'OK');
    const d2 = await getDoc('b/' + A);
    assert.equal(d2.brand.name, 'מאפייה'); assert.equal(d2.brand.logoPath, `b/${A}/brand/logo`); assert.deepEqual(d2.brand.colors, {});
    const acts = (await audits(A)).filter((x) => x.act === 'setBusinessBrand');
    assert.ok(acts.length >= 2); assert.ok(acts.some((x) => x.note === 'name,logoPath,colors;logo=on;theme=a'), JSON.stringify(acts));
    // D1: theme – 'b' נשמר ונשאר כשלא נשלח; 'x' / 5 / '' נדחים
    const tb = await call('setBusinessBrand', U.super, { bizId: A, brand: { theme: 'b' } });
    assert.equal(tb.status, 'OK', tb.text); assert.equal((await getDoc('b/' + A)).brand.theme, 'b'); assert.equal(tb.result.brand.theme, 'b');
    assert.equal((await call('setBusinessBrand', U.super, { bizId: A, brand: { name: 'מאפייה' } })).status, 'OK');
    assert.equal((await getDoc('b/' + A)).brand.theme, 'b', 'theme נשאר כשלא נשלח');
    for (const t of ['x', 5, '', 'A', null]) { const x = await call('setBusinessBrand', U.super, { bizId: A, brand: { theme: t } }); assert.equal(x.reason, 'bad-brand', String(t)); }
    assert.ok((await audits(A)).some((x) => x.note === 'theme;theme=b'));
    assert.equal((await call('setBusinessBrand', U.super, { bizId: A, brand: { colors: {}, theme: 'a' } })).status, 'OK');
    for (const bad of [{}, { evil: 1 }, { name: 'x'.repeat(61) }, { name: 5 }, { logoPath: `b/${B}/brand/logo` }, { logoPath: 'app_backups/x' },
      { colors: { acc: '#abc' } }, { colors: { acc: 'red' } }, { colors: { evil: '#000000' } }, { colors: [] }, { updatedBy: 'x' }]) {
      const x = await call('setBusinessBrand', U.super, { bizId: A, brand: bad });
      assert.equal(x.reason, 'bad-brand', JSON.stringify(bad) + ' ' + x.text);
    }
    assert.equal((await call('setBusinessBrand', U.super, { bizId: A, brand: 'x' })).reason, 'bad-brand');
    assert.equal((await call('setBusinessBrand', U.super, { bizId: 'no-such', brand: { name: 'x' } })).reason, 'no-biz');
    assert.deepEqual(await getDoc('b/' + B), bB, 'עסק ב\' לא השתנה');
    await prep((db) => db.doc('b/' + L).set({ name: 'לארג', status: 'active', dataRoot: 'legacy', features: {} }));
    assert.equal((await call('setBusinessBrand', U.super, { bizId: L, brand: { name: 'x' } })).reason, 'legacy-biz');
    // מנהל העסק עצמו – נחסם (גם לעסק שלו)
    const m = await call('setBusinessBrand', U[A].mgr, { bizId: A, brand: { name: 'שלי' } });
    assert.equal(m.reason, 'not-superadmin');
    assert.equal((await getDoc('b/' + A)).brand.name, 'מאפייה');
  });
  it('setBusinessAdv: ולידציה (מפתחות מותרים, טיפוסים, טווחים); נכתב ל-private/info, לא למסמך העסק', async () => {
    for (const adv of [{ evil: 1 }, { limits: { scanDaily: -1 } }, { limits: { scanDaily: 1.5 } }, { limits: { other: 1 } }, { yemot: { phone: '12' } }, { yemot: { apiKey: 'x' } }, 'x']) {
      assert.equal((await call('setBusinessAdv', U.super, { bizId: A, adv })).reason, 'bad-adv', JSON.stringify(adv));
    }
    const r = await call('setBusinessAdv', U.super, { bizId: A, adv: { limits: { scanDaily: 7, yemotDaily: 3 }, yemot: { phone: '0771234567', ext: '2', label: 'קו' } } });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual((await getDoc(`b/${A}/private/info`)).adv, { limits: { scanDaily: 7, yemotDaily: 3 }, yemot: { phone: '0771234567', ext: '2', label: 'קו' } });
    assert.equal((await getDoc('b/' + A)).adv, undefined);
  });
  it('addStaff / setStaffActive: מנהל א\' בתוך העסק שלו – staff + users (role, active, bizStatus) + audit; עסק ב\' לא נגע; עובד לא יכול', async () => {
    const snapB = JSON.stringify([await listDocs(`b/${B}/staff`), await listDocs(`b/${B}/audit`)]);
    assert.equal((await call('addStaff', U[A].emp, { email: 'w@example.invalid', name: 'עובד' })).reason, 'manager-only');
    assert.equal((await call('addStaff', U[A].mgr, { email: 'w@example.invalid', name: 'עובד' })).reason, 'not-superadmin'); // 6ה
    const r = await call('addStaff', U.super, { bizId: A, email: 'w@example.invalid', name: 'עובד' });
    assert.equal(r.status, 'OK', r.text);
    const uid = r.result.uid;
    assert.equal((await getDoc(`b/${A}/staff/${uid}`)).active, true);
    assert.deepEqual((({ bizId, role, active, bizStatus }) => ({ bizId, role, active, bizStatus }))(await getDoc('users/' + uid)), { bizId: A, role: 'worker', active: true, bizStatus: 'active' });
    assert.equal(await getDoc(`staff/${uid}`), null, 'לא בשורש');
    assert.ok((await audits(A)).find((x) => x.act === 'addStaff' && x.by === U.super));
    // השבתה: staff וגם users מתעדכנים; העובד נחסם מיד
    assert.equal((await call('setStaffActive', U[A].mgr, { uid, active: false })).status, 'OK');
    assert.equal((await getDoc(`b/${A}/staff/${uid}`)).active, false);
    assert.equal((await getDoc('users/' + uid)).active, false);
    assert.equal((await call('getBackupKey', uid)).reason, 'staff-disabled');
    assert.equal((await call('setStaffActive', U[A].mgr, { uid: U[A].mgr, active: false })).reason, 'self');
    assert.equal((await call('setStaffActive', U.super, { uid: U[A].mgr, active: false, bizId: A })).reason, 'is-admin');
    assert.equal(JSON.stringify([await listDocs(`b/${B}/staff`), await listDocs(`b/${B}/audit`)]), snapB);
    // במצב legacy (לארג' פעמי בשורש) – לא דרך הפונקציה, כמו היום
    assert.equal((await call('addStaff', R.mgr, { email: 'w2@example.invalid', name: 'x' })).reason, 'legacy-biz');
  });
  it('setStaffName (סריקה אחידה שלב 6): מנהל א\' משנה שם עובד בעסק שלו (רק name + audit); עובד, מנהל ב\' ו-legacy – נדחים; שם ריק/ארוך – נדחה', async () => {
    const snapB = JSON.stringify(await listDocs(`b/${B}/staff`));
    const before = await getDoc(`b/${A}/staff/${U[A].emp}`);
    assert.equal((await call('setStaffName', U[A].emp, { uid: U[A].emp, name: 'אני' })).reason, 'manager-only');
    assert.equal((await call('setStaffName', U[B].mgr, { uid: U[A].emp, name: 'זר' })).reason, 'no-staff');
    assert.equal((await call('setStaffName', U[A].mgr, { uid: U[A].emp, name: '' })).reason, 'bad-name');
    assert.equal((await call('setStaffName', U[A].mgr, { uid: U[A].emp, name: 'א'.repeat(61) })).reason, 'bad-name');
    assert.equal((await call('setStaffName', U[A].mgr, { uid: '../x', name: 'א' })).reason, 'bad-uid');
    const r = await call('setStaffName', U[A].mgr, { uid: U[A].emp, name: '  משה כהן ' });
    assert.equal(r.status, 'OK', r.text);
    const after = await getDoc(`b/${A}/staff/${U[A].emp}`);
    assert.equal(after.name, 'משה כהן');
    assert.deepEqual(Object.assign({}, after, { name: before.name }), before, 'רק השדה name השתנה');
    assert.ok((await audits(A)).find((x) => x.act === 'setStaffName' && x.by === U[A].mgr && x.note === U[A].emp));
    assert.equal((await call('setStaffName', U.super, { bizId: A, uid: U[A].emp, name: 'דרך מנהל־על' })).status, 'OK');
    assert.equal(JSON.stringify(await listDocs(`b/${B}/staff`)), snapB);
    assert.equal((await call('setStaffName', R.mgr, { uid: R.emp, name: 'x' })).reason, 'legacy-biz');
  });
});

// ---------------------------------------------------------------------------------------------
describe('שלב 5 – yemot-hook: אסימון לכל עסק', () => {
  const H5 = () => require('../functions/yemot-hook.js')._core;
  function fakeRes() {
    const r = { code: 0, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; }; r.set = (k, v) => { r.headers[k] = v; return r; }; r.send = (b) => { r.body = b; return r; };
    return r;
  }
  // רושם כל נתיב מסמך/אוסף שנפתח ב-Firestore בזמן הקריאה (כדי להוכיח "לא קורא ולא כותב לעסק א'")
  async function tracePaths(fn) {
    const { Firestore } = fa('firebase-admin/firestore');
    const od = Firestore.prototype.doc, oc = Firestore.prototype.collection, seen = [];
    Firestore.prototype.doc = function (p) { seen.push(p); return od.call(this, p); };
    Firestore.prototype.collection = function (p) { seen.push(p); return oc.call(this, p); };
    try { await fn(); } finally { Firestore.prototype.doc = od; Firestore.prototype.collection = oc; }
    return seen;
  }
  it('אסימון של עסק ב\': לא קורא ולא כותב שום נתיב של עסק א\' או של השורש; התשובה "לא פעיל" (לא מחובר)', async () => {
    const tb = await call('setYemotToken', U.super, { bizId: B });
    const ta = await call('setYemotToken', U.super, { bizId: A });
    assert.equal(tb.status, 'OK'); assert.match(tb.result.token, /^biz-b\./);
    assert.ok(!JSON.stringify(await getDoc(`b/${B}/private/yemot`)).includes(tb.result.token), 'נשמר רק גיבוב');
    const res = fakeRes();
    const seen = await tracePaths(() => H5().handleJoin({ method: 'GET', query: { t: tb.result.token, ApiPhone: '0501234567' } }, res, { daily: 3 }));
    assert.equal(res.code, 200); assert.equal(res.body, H5().answer(H5().MSG.blocked));
    assert.ok(seen.length > 0);
    for (const p of seen) assert.ok(p === `b/${B}` || p.startsWith(`b/${B}/`), 'נתיב מחוץ לעסק ב\': ' + p);
    assert.deepEqual(await listDocs('yemot_hook_usage'), []);
    assert.deepEqual(await listDocs(`b/${A}/yemot_hook_usage`), []);
    // אסימון של עסק א' לא עובד בכתובת של ב' (ולהפך): אסימון מזויף עם bizId של א' וסוד של ב' – נדחה
    const forged = A + '.' + tb.result.token.split('.')[1];
    const r2 = fakeRes(); await H5().handleJoin({ method: 'GET', query: { t: forged, ApiPhone: '0501234567' } }, r2, {});
    assert.equal(r2.code, 403);
    assert.ok(ta.result.token !== tb.result.token);
  });
  it('בלי אסימון: רק לארג\' פעמי (סוד משותף, השורש – כמו היום); אסימון שגוי – 403', async () => {
    const res = fakeRes();
    await H5().handleJoin({ method: 'GET', query: { key: 'S3', ApiPhone: '0501234567' } }, res, { secret: 'S3', daily: 3 });
    assert.equal(res.code, 200);
    assert.equal((await listDocs('yemot_hook_usage')).length, 1, 'נספר בשורש (לארג\' פעמי)');
    const r2 = fakeRes(); await H5().handleJoin({ method: 'GET', query: { ApiPhone: '0501234567' } }, r2, { secret: 'S3' });
    assert.equal(r2.code, 403);
    const r3 = fakeRes(); await H5().handleJoin({ method: 'GET', query: { t: 'biz-b.' + 'x'.repeat(32) } }, r3, { secret: 'S3' });
    assert.equal(r3.code, 403);
  });
});

// ---------------------------------------------------------------------------------------------
describe('שלב 5 – מגבלת שימוש לפי עסק', () => {
  it('עסק א\' מגיע לתקרה (adv.limits.scanDaily = 2) ונחסם; עסק ב\' לא נחסם; המונה בתוך העסק', async () => {
    assert.equal((await call('setBusinessAdv', U.super, { bizId: A, adv: { limits: { scanDaily: 2 } } })).status, 'OK');
    assert.equal((await call('scanDocument', U[A].emp, SCAN())).status, 'OK');
    assert.equal((await call('scanDocument', U[A].mgr, SCAN())).status, 'OK');
    const r = await call('scanDocument', U[A].emp, SCAN());
    assert.equal(r.status, 'RESOURCE_EXHAUSTED', r.text); assert.equal(r.reason, 'biz-daily-limit');
    assert.equal((await getDoc(`b/${A}/scan_usage/_biz`)).count, 2);
    const sent = GM.state.requests.length;
    assert.equal((await call('scanDocument', U[B].emp, SCAN())).status, 'OK', 'עסק ב\' לא נחסם');
    assert.ok(GM.state.requests.length > sent);
    assert.equal((await getDoc(`b/${B}/scan_usage/_biz`)).count, 1);
    assert.equal(await getDoc('scan_usage/_biz'), null);
  });
  it('עסק בלי הגדרה: תקרת ברירת מחדל (הנחה) – 50 ביום; לארג\' פעמי בלי הגדרה – בלי תקרת עסק', async () => {
    const S = require('../functions/lib/scan');
    assert.deepEqual(await S.bizCaps(B, 100), { perUser: 100, bizDaily: S.BIZ_DEFAULT_DAILY });
    assert.deepEqual(await S.bizCaps(L, 100), { perUser: 100, bizDaily: null });
  });
});

// ---------------------------------------------------------------------------------------------
describe('שלב 5 – פונקציות מתוזמנות: לולאה על עסקים, כל עסק לבד', () => {
  it('nightlyAll: largpeami (legacy) רץ; עסק עם yemot שאינו מחובר – מדולג; עסק עם yemot כבויה – לא ברשימה', async () => {
    await setBiz(A, { 'features.yemot': false });
    const Y = require('../functions/yemot.js')._core;
    const out = await Y.nightlyAll({ key: 'k', base: 'http://127.0.0.1:9797/ym/api/', timeoutMs: 2000, skipCache: true });
    assert.deepEqual(out[B], { skipped: 'yemot-not-connected' });
    assert.equal(out[A], undefined);
    assert.ok(out[L] && out[L].promos, JSON.stringify(out));
    assert.equal(YM.state.requests.length, 0, 'אין מבצעים שפג תוקפם – אין פנייה לימות');
  });
});

// ---------------------------------------------------------------------------------------------
describe('שלב 5, סבב 2 – סנכרון users/{uid} לחברי לארג\' פעמי במצב legacy (בשביל כללי Storage של 2 קריאות)', () => {
  const S5 = () => require('../functions/business.js')._core;
  const pick = (u) => u && (({ bizId, role, active, bizStatus }) => ({ bizId, role, active, bizStatus }))(u);
  async function waitFor(fn, ms) { const end = Date.now() + (ms || 15000); for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 200)); } }
  it('הטריגר באמולטור: השבתת עובד ב-staff בשורש מעדכנת מיד את users.active; החזרה – מחזירה', async () => {
    await prep((db) => db.doc('staff/' + R.emp).update({ active: false }));
    assert.ok(await waitFor(async () => { const u = await getDoc('users/' + R.emp); return u && u.active === false; }), 'users.active לא התעדכן ל-false');
    assert.deepEqual(pick(await getDoc('users/' + R.emp)), { bizId: L, role: 'worker', active: false, bizStatus: 'active' });
    await prep((db) => db.doc('staff/' + R.emp).update({ active: true }));
    assert.ok(await waitFor(async () => { const u = await getDoc('users/' + R.emp); return u && u.active === true; }), 'users.active לא חזר ל-true');
  });
  it('ליבה: אין שינוי = אין כתיבה; מנהל (admins) = admin פעיל; עובד מושבת = לא פעיל; לא חבר = לא נוצר; users של עסק אחר – לא נגעים; לארג\' פעמי ב-b – לא מסנכרן', async () => {
    // אין שינוי בפועל = אין כתיבה (גם updateTime לא משתנה)
    const adb = fa('firebase-admin/firestore').getFirestore();
    const t0 = (await adb.doc('users/' + R.emp).get()).updateTime;
    assert.equal(await S5().syncLegacyMember(R.emp), 'unchanged');
    assert.ok((await adb.doc('users/' + R.emp).get()).updateTime.isEqual(t0), 'לא נכתב כלום');
    // מכאן: מוחקים את העותק ומסנכרנים. טריגר מאוחר של הזריעה יכול להקדים את הקריאה הישירה – לכן בודקים את התוצאה במסד
    await prep(async (db) => { for (const u of [R.mgr, R.emp, R.off, U.nobiz]) await db.doc('users/' + u).delete(); });
    assert.ok(['active', 'unchanged'].includes(await S5().syncLegacyMember(R.mgr)));
    assert.deepEqual(pick(await getDoc('users/' + R.mgr)), { bizId: L, role: 'admin', active: true, bizStatus: 'active' });
    assert.ok(Number.isInteger((await getDoc('users/' + R.mgr)).createdAt), 'createdAt במילישניות');
    assert.ok(['inactive', 'unchanged'].includes(await S5().syncLegacyMember(R.off)));
    assert.equal((await getDoc('users/' + R.off)).active, false);
    assert.equal(await S5().syncLegacyMember(U.nobiz), 'none');
    assert.equal(await getDoc('users/' + U.nobiz), null);
    // חבר של עסק א' שמופיע במקרה גם ב-staff בשורש – users שלו לא משתנה
    await prep((db) => db.doc('staff/' + U[A].emp).set({ name: 'x', role: 'employee', active: false }));
    assert.equal(await S5().syncLegacyMember(U[A].emp), 'other-biz');
    assert.deepEqual(pick(await getDoc('users/' + U[A].emp)), { bizId: A, role: 'worker', active: true, bizStatus: 'active' });
    // לארג' פעמי במצב b: השרת מנהל את users דרך addStaff/setStaffActive, לא מהשורש
    await prep((db) => db.doc('b/' + L).set(bizDoc(L, { dataRoot: 'b' })));
    await prep((db) => db.doc('users/' + R.emp).delete());
    assert.equal(await S5().syncLegacyMember(R.emp), 'not-legacy');
    assert.equal(await getDoc('users/' + R.emp), null);
  });
});

// ---------------------------------------------------------------------------------------------
describe('שלב 5 – ייצוא ואין סודות', () => {
  const NEW = ['createBusiness', 'inviteBusinessAdmin', 'setBusinessStatus', 'setBusinessFeatures', 'setBusinessAdv', 'setYemotToken', 'logBusinessEntry', 'setBusinessBrand', 'setBusinessRanks', 'setStaffPerms', 'addStaff', 'setStaffActive', 'setStaffName', 'setBusinessOrg', 'setStaffBranches'];
  it('כל הפונקציות החדשות מיוצאות מ-index.js (10 ניהול + 2 סנכרון, ורק הן נוספו; completeInvite הוסרה בשלב 6ג; setBusinessBrand נוספה בעדכון חוזה 14); עוזרי בדיקה לא מיוצאים', () => {
    const ex = require('../functions/index.js');
    for (const n of NEW) assert.equal(typeof ex[n], 'function', n);
    assert.equal(Object.keys(ex).length, 52); // +3 לקוחות (customers.js: saveCust, importCusts, setCustCfg); +13 הזמנות שלב 1; מייל עצמי: sendInviteMail; דף פתיחה: publicBrand; סניפים 2026-11-08: setBusinessOrg, setStaffBranches; סריקה אחידה שלב 6: setStaffName; סריקה אחידה: setScanQuota; // 6ה: setBusinessRanks, setStaffPerms (עדכון חוזה 15); 6ז: cashoutTotal (עדכון חוזה 17)
    assert.equal(ex.completeInvite, undefined);
    for (const n of ['syncLegacyAdmin', 'syncLegacyStaff']) assert.equal(typeof ex[n], 'function', n);
    for (const n of ['_core', 'resolveMember', 'bizRef', 'tzintukJoin', 'nightlyAll']) assert.equal(ex[n], undefined, n);
    // והן גם נטענו באמולטור (קריאה בלי כניסה מחזירה UNAUTHENTICATED/PERMISSION_DENIED ולא 404)
  });
  it('כל פונקציה חדשה עונה באמולטור (לא 404)', async () => {
    for (const n of NEW) { const r = await call(n, null, {}); assert.ok(['UNAUTHENTICATED', 'PERMISSION_DENIED', 'INVALID_ARGUMENT'].includes(r.status), n + ': ' + r.status); }
  });
  it('אין סודות בקוד הפונקציות, ותשובות שגיאה לא מכילות קוד, גיבוב, salt או מפתח', async () => {
    const dir = path.join(H.ROOT, 'functions');
    const files = ['index.js', 'business.js', 'yemot.js', 'yemot-line.js', 'yemot-board.js', 'yemot-hook.js'].concat(fs.readdirSync(path.join(dir, 'lib')).map((f) => 'lib/' + f));
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(!/AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,}|DUMMY-|dummy-gemini/.test(src), f);
    }
    const errs = [await call('inviteBusinessAdmin', U.super, { bizId: A, email: 'super-leak@' }),
      await call('setBusinessAdv', U.super, { bizId: A, adv: { yemot: { apiKey: 'S' } } }), await call('createBusiness', U[A].mgr, {}),
      await call('getLineState', U[B].mgr, {}), await call('scanDocument', U.nobiz, SCAN())];
    for (const e of errs) {
      assert.ok(e.error, e.text);
      assert.ok(!/\d{8}|codeHash|salt|tokenHash|DUMMY|dummy-gemini/.test(e.text), e.text);
    }
  });
});
