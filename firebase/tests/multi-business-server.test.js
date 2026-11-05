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
    // מנהל ב' מוסיף כעובד את המייל של עובד א' – נדחה (שייך לעסק אחר)
    const { getAuth } = fa('firebase-admin/auth');
    await getAuth().createUser({ uid: U[A].emp, email: 'a_emp_real@example.invalid' }).catch(() => {});
    const r = await call('addStaff', U[B].mgr, { email: 'a_emp_real@example.invalid', name: 'x' });
    assert.equal(r.reason, 'other-biz', r.text);
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
    assert.equal(d.status, 'active'); assert.equal(d.dataRoot, 'b'); assert.equal(d.schemaVersion, 1); assert.deepEqual(d.features, {}); assert.equal(d.createdBy, U.super);
    assert.equal(d.brand.base, 'dark-gold');
    for (const k of ['ownerEmail', 'ownerPhone', 'adv']) assert.equal(d[k], undefined, k + ' לא במסמך העסק');
    assert.deepEqual(await getDoc('b/biz-new/private/info'), { ownerEmail: 'owner@example.invalid', ownerPhone: '0501234567', adv: {} });
    assert.equal((await call('createBusiness', U.super, { bizId: 'biz-new', name: 'x', ownerEmail: 'a@example.invalid', ownerPhone: '0501234567' })).reason, 'biz-exists');
    for (const [bad, reason] of [[{ bizId: 'AB' }, 'bad-biz'], [{ bizId: 'ab_c' }, 'bad-biz'], [{ bizId: 'a'.repeat(31) }, 'bad-biz'], [{ bizId: L }, 'reserved'], [{ ownerPhone: '123' }, 'bad-phone'], [{ ownerEmail: 'no-at' }, 'bad-email'], [{ name: 'x'.repeat(61) }, 'bad-name']]) {
      const x = await call('createBusiness', U.super, Object.assign({ bizId: 'biz-ok', name: 'x', ownerEmail: 'a@example.invalid', ownerPhone: '0501234567' }, bad));
      assert.equal(x.reason, reason, JSON.stringify(bad) + ' ' + x.text);
    }
    assert.equal(await getDoc('b/biz-ok'), null);
    assert.equal(await getDoc('b/' + L), null, 'largpeami לא נוצר');
  });
  it('כניסה ראשונה: קוד חד־פעמי (8 ספרות, נשמר רק מגובב), עד 5 ניסיונות, תוקף; סיסמה רק אחרי קוד; ואז מנהל פעיל בעסק', async () => {
    const r = await call('createBusiness', U.super, { bizId: 'biz-new', name: 'חדש', ownerEmail: 'boss@example.invalid', ownerPhone: '0501234567' });
    assert.equal(r.status, 'OK', r.text);
    const { uid, devCode, mail } = r.result;
    assert.match(devCode, /^\d{8}$/); assert.equal(mail, 'simulated');
    const inv = await getDoc(`b/biz-new/private/invite-${uid}`);
    assert.ok(!JSON.stringify(inv).includes(devCode), 'הקוד לא נשמר כטקסט');
    assert.match(inv.codeHash, /^[0-9a-f]{64}$/);
    // לפני הקוד: users קיים אבל לא פעיל, ואין admins
    assert.equal((await getDoc('users/' + uid)).active, false);
    assert.equal(await getDoc(`b/biz-new/admins/${uid}`), null);
    const wrong = devCode === '00000000' ? '11111111' : '00000000';
    const c = (code, pw) => call('completeInvite', null, { email: 'boss@example.invalid', code, password: pw || 'Secret-pass-1' });
    assert.equal((await c(devCode, 'short')).reason, 'weak-password');
    for (let i = 0; i < 5; i++) assert.equal((await c(wrong)).reason, 'bad-code');
    assert.equal((await c(devCode)).reason, 'bad-code', 'אחרי 5 ניסיונות גם הקוד הנכון נחסם');
    // הזמנה חוזרת: קוד חדש; קוד שפג תוקפו – נדחה
    const r2 = await call('inviteBusinessAdmin', U.super, { bizId: 'biz-new', email: 'boss@example.invalid' });
    assert.equal(r2.status, 'OK', r2.text);
    await prep((db) => db.doc(`b/biz-new/private/invite-${uid}`).update({ exp: Date.now() - 1 }));
    assert.equal((await c(r2.result.devCode)).reason, 'bad-code');
    const r3 = await call('inviteBusinessAdmin', U.super, { bizId: 'biz-new', email: 'boss@example.invalid' });
    assert.equal((await c(r3.result.devCode, 'Secret-pass-1')).status, 'OK');
    assert.equal((await c(r3.result.devCode, 'Secret-pass-2')).reason, 'bad-code', 'קוד משמש פעם אחת');
    assert.ok(await getDoc(`b/biz-new/admins/${uid}`));
    assert.deepEqual((({ bizId, role, active, bizStatus }) => ({ bizId, role, active, bizStatus }))(await getDoc('users/' + uid)), { bizId: 'biz-new', role: 'admin', active: true, bizStatus: 'active' });
    // הסיסמה נקבעה באמת (כניסה מול אמולטור Auth)
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const si = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'boss@example.invalid', password: 'Secret-pass-1', returnSecureToken: true }) });
    assert.equal(si.status, 200);
    // מייל לא מוכר – אותה תשובה בדיוק (לא חושף אילו מיילים קיימים)
    const u = await call('completeInvite', null, { email: 'nobody@example.invalid', code: '12345678', password: 'Secret-pass-1' });
    assert.equal(u.reason, 'bad-code');
    // המנהל החדש עובד בעסק שלו בלבד
    await setBiz('biz-new', { 'features.scan': true });
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
    assert.equal(await getDoc(`b/${A}/private/invite-${U[B].mgr}`), null);
  });
  it('בלי אמולטור (ייצור): הקוד לא מוחזר בתשובה, והמייל מסומן "לא מחובר" (אין שליחה אמיתית)', async () => {
    const B5 = require('../functions/business.js')._core;
    const T = require('../functions/lib/tenant');
    const prev = process.env.FUNCTIONS_EMULATOR; delete process.env.FUNCTIONS_EMULATOR;
    try {
      const r = await T.scoped(B5.inviteBusinessAdmin)({ auth: { uid: U.super }, data: { bizId: A, email: 'prod@example.invalid' } });
      assert.equal(r.devCode, undefined);
      assert.equal(r.mail, 'not-configured');
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
    const r = await call('addStaff', U[A].mgr, { email: 'w@example.invalid', name: 'עובד' });
    assert.equal(r.status, 'OK', r.text);
    const uid = r.result.uid;
    assert.equal((await getDoc(`b/${A}/staff/${uid}`)).active, true);
    assert.deepEqual((({ bizId, role, active, bizStatus }) => ({ bizId, role, active, bizStatus }))(await getDoc('users/' + uid)), { bizId: A, role: 'worker', active: true, bizStatus: 'active' });
    assert.equal(await getDoc(`staff/${uid}`), null, 'לא בשורש');
    assert.ok((await audits(A)).find((x) => x.act === 'addStaff' && x.by === U[A].mgr));
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
describe('שלב 5 – ייצוא ואין סודות', () => {
  const NEW = ['createBusiness', 'inviteBusinessAdmin', 'completeInvite', 'setBusinessStatus', 'setBusinessFeatures', 'setBusinessAdv', 'setYemotToken', 'logBusinessEntry', 'addStaff', 'setStaffActive'];
  it('כל הפונקציות החדשות מיוצאות מ-index.js (ורק הן נוספו); עוזרי בדיקה לא מיוצאים', () => {
    const ex = require('../functions/index.js');
    for (const n of NEW) assert.equal(typeof ex[n], 'function', n);
    assert.equal(Object.keys(ex).length, 25);
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
    const inv = await call('inviteBusinessAdmin', U.super, { bizId: A, email: 'leak@example.invalid' });
    const errs = [await call('completeInvite', null, { email: 'leak@example.invalid', code: '00000000', password: 'Secret-pass-1' }),
      await call('setBusinessAdv', U.super, { bizId: A, adv: { yemot: { apiKey: 'S' } } }), await call('createBusiness', U[A].mgr, {}),
      await call('getLineState', U[B].mgr, {}), await call('scanDocument', U.nobiz, SCAN())];
    for (const e of errs) {
      assert.ok(e.error, e.text);
      assert.ok(!e.text.includes(inv.result.devCode) && !/codeHash|salt|tokenHash|DUMMY|dummy-gemini/.test(e.text), e.text);
    }
  });
});
