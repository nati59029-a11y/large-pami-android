'use strict';
// ריבוי עסקים (משימה 2026-11-05, שלב 6ג חלק 1): כניסה ראשונה דרך המייל המובנה של Firebase Auth ("קבע סיסמה"), בלי קוד חד־פעמי.
// רץ לבד, מול האמולטור בלבד (auth, firestore, storage, functions). אין שליחת מייל אמיתית: אמולטור ה-Auth שומר את הקישורים
// בנקודת הקצה emulator/v1/projects/{id}/oobCodes, ומשם הבדיקה לוקחת אותם.
//   firebase emulators:exec --only auth,firestore,storage,functions --project demo-largpeami "node --test tests/server-auth-invite.test.js"
// מה נבדק:
//   1. משתמש שנפתח בשרת (createBusiness / addStaff) נוצר בלי סיסמה: אי אפשר להיכנס עד "קבע סיסמה" מהקישור המובנה.
//   2. אין קוד (devCode או כל קוד) בתשובה – לא באמולטור ולא בייצור. completeInvite הוסרה.
//   3. מי שנרשם מראש עם המייל של המנהל (חשבון שלא אומת) לא מקבל את ההרשאות: החשבון שלו מנוטרל (לא נמחק), ונוצר חשבון חדש.
//   4. "מחשב חדש": קישור כניסה במייל (EMAIL_SIGNIN) עובד באמולטור, ומי שיש לו סיסמה עוקף אותו דרך REST (אכיפה באפליקציה בלבד).

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const fa = (m) => require(require.resolve(m, { paths: [path.join(__dirname, '..', 'functions')] }));

const A = 'biz-a';
const SUPER = 'u_super', A_MGR = 'a_mgr';
const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (name) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${name}`;
const AUTH = () => 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST;

// קריאה לפונקציה: who = uid (טוקן לא חתום, כמו בשאר הבדיקות) או { idToken } אמיתי מאמולטור ה-Auth
async function call(name, who, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + (typeof who === 'string' ? H.mockToken(who) : who.idToken);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  const status = json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status);
  return { status, reason: json && json.error && json.error.details && json.error.details.reason, result: json && json.result, text };
}
// Identity Toolkit (REST) – אותן כתובות שהאפליקציה משתמשת בהן (signInWithPassword), מול האמולטור
async function idt(method, body, extraHeaders) {
  const r = await fetch(`${AUTH()}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=demo-key`, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders), body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const signIn = (email, password) => idt('signInWithPassword', { email, password, returnSecureToken: true });
async function refresh(refreshToken) {
  const r = await fetch(`${AUTH()}/securetoken.googleapis.com/v1/token?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function lastOob(email, requestType) {
  const j = await (await fetch(`${AUTH()}/emulator/v1/projects/${H.PROJECT_ID}/oobCodes`)).json();
  const list = (j.oobCodes || []).filter((c) => c.email === email && c.requestType === requestType);
  return list[list.length - 1] || null;
}
const claims = (t) => JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8'));
const clearAuth = () => fetch(`${AUTH()}/emulator/v1/projects/${H.PROJECT_ID}/accounts`, { method: 'DELETE' });
// "קבע סיסמה": בדיוק מה שהאפליקציה תעשה (6ג-2) – sendOobCode עם PASSWORD_RESET, והמנהל לוחץ על הקישור במייל
async function setPasswordByMail(email, newPassword) {
  const s = await idt('sendOobCode', { requestType: 'PASSWORD_RESET', email }, { 'X-Firebase-Locale': 'he' });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const oob = await lastOob(email, 'PASSWORD_RESET');
  assert.ok(oob && oob.oobCode, 'הקישור נשמר באמולטור');
  const r = await idt('resetPassword', { oobCode: oob.oobCode, newPassword });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return oob;
}

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function getDoc(p) { let v = null; await prep(async (db) => { const s = await db.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function listDocs(p) { let v = []; await prep(async (db) => { const s = await db.collection(p).get(); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; }

async function seed() {
  await env.clearFirestore();
  await clearAuth();
  await prep(async (db) => {
    const b = db.batch();
    b.set(db.doc('superadmins/' + SUPER), {});
    b.set(db.doc('b/' + A), { name: 'עסק א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: {}, brand: { name: 'א', logoPath: '', colors: {}, base: 'dark-gold', updatedAt: 1, updatedBy: SUPER } });
    b.set(db.doc(`b/${A}/admins/${A_MGR}`), { email: A_MGR + '@example.invalid' });
    b.set(db.doc(`b/${A}/staff/${A_MGR}`), { name: A_MGR, role: 'manager', active: true, pushTokens: [] });
    b.set(db.doc('users/' + A_MGR), { bizId: A, role: 'admin', active: true, bizStatus: 'active', email: A_MGR + '@example.invalid', createdAt: 1 });
    await b.commit();
  });
}

before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(seed);

const NEW_BIZ = { bizId: 'biz-new', name: 'עסק חדש', ownerEmail: 'Boss@Example.invalid', ownerPhone: '0501234567' };
const EIGHT_DIGITS = /(^|\D)\d{8}(\D|$)/;

describe('6ג – כניסה ראשונה: המייל המובנה של Firebase ("קבע סיסמה"), בלי קוד בשרת', () => {
  it('createBusiness: המנהל נוצר בלי סיסמה ולא יכול להיכנס; התשובה בלי קוד; אחרי "קבע סיסמה" מהקישור – נכנס, והוא מנהל בעסק שלו בלבד', async (t) => {
    const r = await call('createBusiness', SUPER, NEW_BIZ);
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(Object.keys(r.result).sort(), ['bizId', 'email', 'ok', 'uid'], 'רק השדות האלה בתשובה');
    assert.equal(r.result.email, 'boss@example.invalid', 'המייל שנשמר בשרת (מנורמל) – לשם האפליקציה שולחת את הקישור');
    assert.ok(!EIGHT_DIGITS.test(JSON.stringify(r.result)), 'אין קוד בתשובה');
    const { uid } = r.result;
    // החשבון: בלי סיסמה, בלי ספק כניסה, לא מאומת
    const rec = await fa('firebase-admin/auth').getAuth().getUser(uid);
    assert.equal(rec.email, 'boss@example.invalid'); assert.equal(rec.emailVerified, false); assert.equal(rec.disabled, false);
    assert.deepEqual(rec.providerData, [], 'אין ספק כניסה (אין סיסמה)');
    // אי אפשר להיכנס: לא עם סיסמה ריקה, לא עם סיסמה "צפויה"
    for (const pw of ['', 'password', '12345678', 'boss@example.invalid', 'biz-new', '0501234567']) {
      const s = await signIn('boss@example.invalid', pw);
      assert.notEqual(s.status, 200, 'כניסה עם "' + pw + '" נדחית');
      t.diagnostic(`signInWithPassword("${pw}") → ${s.status} ${s.json && s.json.error && s.json.error.message}`);
    }
    // ההרשאות כבר קיימות (החשבון לא שמיש בלי המייל)
    assert.ok(await getDoc(`b/biz-new/admins/${uid}`));
    assert.deepEqual((({ bizId, role, active, bizStatus }) => ({ bizId, role, active, bizStatus }))(await getDoc('users/' + uid)), { bizId: 'biz-new', role: 'admin', active: true, bizStatus: 'active' });
    assert.deepEqual((await listDocs('b/biz-new/private')).map((d) => d.id), ['info'], 'אין מסמך הזמנה/קוד ב-private');
    // "קבע סיסמה" מהמייל המובנה → כניסה
    const oob = await setPasswordByMail('boss@example.invalid', 'Strong-pass-1');
    t.diagnostic('oobLink (אמולטור): ' + String(oob.oobLink).replace(/oobCode=[^&]+/, 'oobCode=…'));
    const s = await signIn('boss@example.invalid', 'Strong-pass-1');
    assert.equal(s.status, 200, JSON.stringify(s.json));
    const c = claims(s.json.idToken);
    t.diagnostic(`אחרי קביעת סיסמה: email_verified=${c.email_verified} sign_in_provider=${c.firebase && c.firebase.sign_in_provider} (אמולטור)`);
    assert.equal(c.user_id, uid);
    // טוקן אמיתי מאמולטור ה-Auth → הפונקציות מזהות אותו כמנהל של biz-new בלבד
    assert.equal((await call('getBackupKey', s.json)).status, 'OK');
    assert.equal((await call('getBackupKey', s.json, { bizId: A })).reason, 'foreign-biz');
    assert.ok((await listDocs('b/biz-new/audit')).find((x) => x.act === 'inviteBusinessAdmin' && x.note === 'boss@example.invalid'));
  });

  it('addStaff: עובד חדש נוצר בלי סיסמה; תשובה בלי קוד; נכנס רק אחרי "קבע סיסמה"', async () => {
    // 6ה: רק מנהל־על מוסיף עובדים. מנהל העסק נחסם.
    assert.equal((await call('addStaff', A_MGR, { email: 'worker@example.invalid', name: 'עובד' })).reason, 'not-superadmin');
    const r = await call('addStaff', SUPER, { bizId: A, email: 'worker@example.invalid', name: 'עובד' });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(Object.keys(r.result).sort(), ['bizId', 'email', 'ok', 'uid']);
    assert.ok(!EIGHT_DIGITS.test(JSON.stringify(r.result)));
    assert.notEqual((await signIn('worker@example.invalid', 'Strong-pass-1')).status, 200);
    await setPasswordByMail('worker@example.invalid', 'Strong-pass-1');
    const s = await signIn('worker@example.invalid', 'Strong-pass-1');
    assert.equal(s.status, 200);
    assert.equal((await call('getBackupKey', s.json)).status, 'OK');
  });

  it('בלי אמולטור (ייצור): אותה תשובה – בלי קוד ובלי שדה מייל/תוקף; completeInvite לא קיימת', async () => {
    const B5 = require('../functions/business.js')._core;
    const T = require('../functions/lib/tenant');
    const prev = process.env.FUNCTIONS_EMULATOR; delete process.env.FUNCTIONS_EMULATOR;
    try {
      const r = await T.scoped(B5.inviteBusinessAdmin)({ auth: { uid: SUPER }, data: { bizId: A, email: 'prod@example.invalid' } });
      assert.deepEqual(Object.keys(r).sort(), ['email', 'ok', 'uid']);
      assert.ok(!EIGHT_DIGITS.test(JSON.stringify(r)));
      const r2 = await T.scoped(B5.createBusiness)({ auth: { uid: SUPER }, data: { bizId: 'biz-prod', name: 'x', ownerEmail: 'p2@example.invalid', ownerPhone: '0501234567' } });
      assert.deepEqual(Object.keys(r2).sort(), ['bizId', 'email', 'ok', 'uid']);
    } finally { if (prev !== undefined) process.env.FUNCTIONS_EMULATOR = prev; }
    const ex = require('../functions/index.js');
    assert.equal(ex.completeInvite, undefined);
    assert.equal(B5.completeInvite, undefined);
    assert.equal((await call('completeInvite', null, { email: 'boss@example.invalid', code: '12345678', password: 'Strong-pass-1' })).status, 'HTTP_404', 'נקודת הקצה לא קיימת');
    // אין שאריות של מנגנון הקוד בקוד השרת
    const src = fs.readFileSync(path.join(H.ROOT, 'functions', 'business.js'), 'utf8');
    for (const w of ['devCode', 'codeHash', 'completeInvite', 'mailer', 'invite-']) assert.ok(!src.includes(w), w);
    assert.ok(!fs.existsSync(path.join(H.ROOT, 'functions', 'lib', 'mailer.js')));
  });

  it('תוקף שנרשם מראש עם המייל של המנהל (חשבון שלא אומת, בלי חברות): לא מקבל הרשאות. החשבון שלו מנוטרל (לא נמחק), והמנהל מקבל חשבון חדש', async () => {
    const up = await idt('signUp', { email: 'boss@example.invalid', password: 'Attacker-pass-1', returnSecureToken: true });
    assert.equal(up.status, 200, JSON.stringify(up.json));
    const attacker = up.json; // idToken + refreshToken של התוקף
    const r = await call('createBusiness', SUPER, NEW_BIZ);
    assert.equal(r.status, 'OK', r.text);
    assert.notEqual(r.result.uid, attacker.localId, 'חשבון חדש, לא של התוקף');
    // התוקף: הסיסמה לא עובדת, הרענון נכשל, הטוקן הישן לא מנהל בעסק
    assert.notEqual((await signIn('boss@example.invalid', 'Attacker-pass-1')).status, 200);
    assert.notEqual((await refresh(attacker.refreshToken)).status, 200, 'החיבור של התוקף בוטל');
    const g = await call('getBackupKey', attacker);
    assert.notEqual(g.status, 'OK', g.text);
    assert.equal(await getDoc(`b/biz-new/admins/${attacker.localId}`), null);
    assert.equal(await getDoc('users/' + attacker.localId), null);
    // החשבון הישן לא נמחק: מושבת, עם כתובת שלא מקבלת מייל
    const old = await fa('firebase-admin/auth').getAuth().getUser(attacker.localId);
    assert.equal(old.disabled, true); assert.match(old.email, /@orphaned\.invalid$/);
    // המנהל האמיתי: "קבע סיסמה" מהמייל → נכנס לחשבון החדש
    await setPasswordByMail('boss@example.invalid', 'Strong-pass-1');
    const s = await signIn('boss@example.invalid', 'Strong-pass-1');
    assert.equal(s.status, 200);
    assert.equal(s.json.localId, r.result.uid);
    assert.equal((await call('getBackupKey', s.json)).status, 'OK');
  });

  it('חשבון שאומת (בעל המייל) או חבר באותו עסק – נשאר אותו חשבון; שינוי מייל מבטל אימות (אין עקיפה דרך מייל אחר)', async (t) => {
    const { getAuth } = fa('firebase-admin/auth');
    await getAuth().createUser({ uid: 'u_verified', email: 'owner2@example.invalid', emailVerified: true, password: 'Owner-pass-1' });
    const r = await call('inviteBusinessAdmin', SUPER, { bizId: A, email: 'owner2@example.invalid' });
    assert.equal(r.result.uid, 'u_verified');
    assert.equal((await signIn('owner2@example.invalid', 'Owner-pass-1')).status, 200, 'הסיסמה של בעל החשבון לא נפגעה');
    assert.ok(await getDoc(`b/${A}/admins/u_verified`));
    // הזמנה חוזרת של אותו מנהל: אותו חשבון, בלי נזק
    assert.equal((await call('inviteBusinessAdmin', SUPER, { bizId: A, email: 'owner2@example.invalid' })).result.uid, 'u_verified');
    // ניסיון עקיפה: נרשם עם המייל שלו, מאמת אותו, ואז מחליף לכתובת של המנהל
    const up = await idt('signUp', { email: 'attacker@example.invalid', password: 'Attacker-pass-1', returnSecureToken: true });
    await idt('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: up.json.idToken });
    const v = await lastOob('attacker@example.invalid', 'VERIFY_EMAIL');
    assert.equal((await idt('update', { oobCode: v.oobCode })).status, 200);
    const ch = await idt('update', { idToken: up.json.idToken, email: 'boss3@example.invalid', returnSecureToken: true });
    t.diagnostic('החלפת מייל ב-REST (אמולטור): ' + ch.status + ' ' + (ch.json && ch.json.error ? ch.json.error.message : ''));
    if (ch.status === 200) {
      const rec = await getAuth().getUser(up.json.localId);
      assert.equal(rec.emailVerified, false, 'אחרי החלפת מייל – לא מאומת');
      const r3 = await call('inviteBusinessAdmin', SUPER, { bizId: A, email: 'boss3@example.invalid' });
      assert.notEqual(r3.result.uid, up.json.localId, 'התוקף לא מקבל את ההרשאות');
    }
  });
});

describe('6ג – "מחשב חדש": קישור כניסה מובנה (EMAIL_SIGNIN). האכיפה באפליקציה בלבד', () => {
  it('באמולטור: אחרי סיסמה, קישור כניסה במייל נותן טוקן לאותו משתמש; מי שיש לו סיסמה יכול לדלג עליו דרך REST', async (t) => {
    const r = await call('createBusiness', SUPER, NEW_BIZ);
    await setPasswordByMail('boss@example.invalid', 'Strong-pass-1');
    const pw = await signIn('boss@example.invalid', 'Strong-pass-1');
    assert.equal(pw.status, 200);
    // השלב הנוסף: האפליקציה שולחת קישור כניסה למייל של החשבון (מתוך התשובה של signInWithPassword, לא מהקלדה)
    const s = await idt('sendOobCode', { requestType: 'EMAIL_SIGNIN', email: pw.json.email, continueUrl: 'https://largpeami.web.app/?mode=newdevice' });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    const oob = await lastOob('boss@example.invalid', 'EMAIL_SIGNIN');
    assert.ok(oob && oob.oobCode);
    const el = await idt('signInWithEmailLink', { email: 'boss@example.invalid', oobCode: oob.oobCode });
    assert.equal(el.status, 200, JSON.stringify(el.json));
    assert.equal(el.json.localId, r.result.uid);
    const c1 = claims(pw.json.idToken).firebase.sign_in_provider, c2 = claims(el.json.idToken).firebase.sign_in_provider;
    t.diagnostic(`sign_in_provider: סיסמה=${c1}, קישור במייל=${c2} (אמולטור)`);
    // אותו קישור – פעם אחת
    assert.notEqual((await idt('signInWithEmailLink', { email: 'boss@example.invalid', oobCode: oob.oobCode })).status, 200, 'קישור משמש פעם אחת');
    // עקיפה: הטוקן מהסיסמה לבד מספיק לשרת – כלומר השלב הנוסף נאכף רק באפליקציה
    assert.equal((await call('getBackupKey', pw.json)).status, 'OK');
  });
});
