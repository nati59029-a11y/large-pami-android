'use strict';
// ריבוי עסקים (משימה 2026-11-05, שלב 5, חלקים ג' ו-ה'): פונקציות ניהול.
//   מנהל־על בלבד (superadmins/{uid}): createBusiness, inviteBusinessAdmin, setBusinessStatus, setBusinessFeatures,
//                                     setBusinessAdv, setYemotToken, logBusinessEntry.
//   מנהל העסק (בתוך העסק שלו בלבד):   addStaff, setStaffActive.
// כל פעולה נרשמת ב-b/{bizId}/audit (by, t, act, note). bizId של משתמש רגיל נקבע בשרת בלבד (requireStaff).
// כניסה ראשונה (שלב 6ג, עדכון חוזה 9, החלטת המשתמש "א"): אין קוד חד־פעמי ואין שליחת מייל בשרת.
//   השרת יוצר חשבון Auth בלי סיסמה ומחזיר את המייל שנשמר. האפליקציה שולחת למייל הזה את המייל המובנה של Firebase
//   ("קבע סיסמה", accounts:sendOobCode עם PASSWORD_RESET). רק מי שמקבל את המייל יכול לקבוע סיסמה ולהיכנס.

const crypto = require('node:crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const T = require('./lib/tenant');
const { requireStaff, inputObject } = require('./lib/roles');

const BATCH_MAX = 400;                // מתחת למגבלה של 500 פעולות באצווה
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const RESERVED = new Set([T.BIZ0]);   // לארג' פעמי נוצר רק בכלי ההעברה (שלב 4), לא כאן

const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });
const deny = (reason, message) => new HttpsError('permission-denied', message, { reason });

// מספר ישראלי: נייד 05X / 07X (10 ספרות), קווי 02/03/04/08/09 (9 ספרות). +972 → 0.
function israeliPhone(raw) {
  let p = String(raw == null ? '' : raw).trim().replace(/[\s-]/g, '');
  if (/^\+?972\d{8,9}$/.test(p)) p = '0' + p.replace(/^\+?972/, '');
  return /^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p) ? p : null;
}
function cleanEmail(v) {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (e.length > 254 || !EMAIL_RE.test(e)) throw bad('bad-email', 'כתובת המייל לא תקינה');
  return e;
}
function cleanName(v, max) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!s || s.length > (max || 60)) throw bad('bad-name', `השם חובה, עד ${max || 60} תווים`);
  return s;
}
function bizIdOf(input) {
  const b = input.bizId;
  if (typeof b !== 'string' || !T.BIZ_RE.test(b)) throw bad('bad-biz', 'מזהה עסק לא תקין: אותיות קטנות באנגלית, ספרות ומקף, 3 עד 30 תווים');
  return b;
}

async function requireSuper(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'צריך להתחבר לאפליקציה', { reason: 'not-signed-in' });
  if (!(await T.isSuper(uid))) throw deny('not-superadmin', 'הפעולה מותרת למנהל המערכת בלבד');
  return uid;
}
async function bizOrThrow(bizId) {
  const biz = await T.loadBiz(bizId);
  if (!biz || !biz.exists) throw new HttpsError('not-found', 'העסק לא נמצא', { reason: 'no-biz' });
  return biz;
}

function auditRef(bizId) { return getFirestore().collection(`b/${bizId}/audit`).doc(); }
function auditData(by, act, note) {
  return { by, t: Date.now(), act: String(act).slice(0, 60), note: String(note || '').slice(0, 500) };
}
async function audit(bizId, by, act, note) { await auditRef(bizId).set(auditData(by, act, note)); }

// משתמש ששייך לעסק אחר, או מנהל־על – לא מצטרף. כך הזמנה לא יכולה "לגנוב" חשבון קיים.
async function assertJoinable(uid, bizId) {
  const db = getFirestore();
  const [sa, u, a, s] = await Promise.all([db.doc('superadmins/' + uid).get(), db.doc('users/' + uid).get(), db.doc('admins/' + uid).get(), db.doc('staff/' + uid).get()]);
  if (sa.exists) throw new HttpsError('failed-precondition', 'המייל שייך למנהל המערכת', { reason: 'is-superadmin' });
  const cur = u.exists ? u.get('bizId') : (a.exists || s.exists ? T.BIZ0 : null);
  if (cur && cur !== bizId) throw new HttpsError('failed-precondition', 'המייל כבר שייך לעסק אחר', { reason: 'other-biz' });
  return u;
}

// חשבון Auth למייל, כך שלאף אחד אין סיסמה ידועה לחשבון שמקבל הרשאות:
//   - אין חשבון → נוצר חשבון חדש בלי סיסמה. נכנסים רק אחרי "קבע סיסמה" מהמייל המובנה של Firebase.
//   - יש חשבון שלא אומת ושאינו חבר באף עסק (למשל מישהו שנרשם מראש עם המייל של המנהל, ויודע את הסיסמה שלו) →
//     החשבון הישן מנוטרל בלי מחיקה (מושבת, המייל שלו מוחלף בכתובת שלא מקבלת דואר, החיבורים שלו מבוטלים), ונוצר חשבון חדש.
//     הטוקנים הישנים שלו שייכים למזהה אחר, ולכן לא מקבלים את ההרשאות. אפשר לשחזר אותו בלוח הבקרה.
//   - חשבון שאומת (בעל המייל) או שכבר רשום באותו עסק → אותו חשבון.
async function accountFor(email, bizId) {
  const auth = getAuth();
  let rec = null;
  try { rec = await auth.getUserByEmail(email); } catch (e) { if (!e || e.code !== 'auth/user-not-found') throw e; }
  if (!rec) return (await auth.createUser({ email, emailVerified: false, disabled: false })).uid;
  const u = await assertJoinable(rec.uid, bizId);
  if (u.exists || rec.emailVerified === true) return rec.uid;
  await auth.updateUser(rec.uid, { email: `orphan-${rec.uid.toLowerCase()}@orphaned.invalid`, disabled: true });
  await auth.revokeRefreshTokens(rec.uid);
  logger.warn('business: unverified account set aside', { reason: 'unverified-account' });
  return (await auth.createUser({ email, emailVerified: false, disabled: false })).uid;
}

// ---------- createBusiness ----------
async function createBusiness(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  if (RESERVED.has(bizId)) throw new HttpsError('failed-precondition', 'המזהה שמור', { reason: 'reserved' });
  const name = cleanName(input.name, 60);
  const ownerEmail = cleanEmail(input.ownerEmail);
  const ownerPhone = israeliPhone(input.ownerPhone);
  if (!ownerPhone) throw bad('bad-phone', 'מספר הטלפון לא תקין (מספר ישראלי)');
  const db = getFirestore();
  const ref = db.doc('b/' + bizId);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) throw new HttpsError('already-exists', 'כבר יש עסק עם המזהה הזה', { reason: 'biz-exists' });
    tx.create(ref, {
      name, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: now, createdBy: by, features: {},
      brand: { name, logoPath: '', colors: {}, base: 'dark-gold', updatedAt: now, updatedBy: by },
    });
    tx.set(db.doc(`b/${bizId}/private/info`), { ownerEmail, ownerPhone, adv: {} });
    tx.set(auditRef(bizId), auditData(by, 'createBusiness', name));
  });
  const biz = await bizOrThrow(bizId);
  const inv = await inviteAdmin(biz, ownerEmail, by);
  return Object.assign({ ok: true, bizId }, inv);
}

// הזמנת מנהל: החשבון בלי סיסמה ידועה (accountFor), ולכן אפשר לרשום את החברות מיד (admins + users פעיל).
// המנהל נכנס רק אחרי שקבע סיסמה מהמייל המובנה. התשובה: uid והמייל שנשמר – לשם האפליקציה שולחת את הקישור. אין קוד.
async function inviteAdmin(biz, email, by) {
  if (biz.dataRoot === 'legacy') throw new HttpsError('failed-precondition', 'בעסק במצב legacy מנהלים משתמשים כמו היום', { reason: 'legacy-biz' });
  const uid = await accountFor(email, biz.bizId);
  const u = await assertJoinable(uid, biz.bizId);
  const db = getFirestore();
  const now = Date.now();
  const b = db.batch();
  b.set(db.doc(T.bizRef(biz, 'admins/' + uid)), { email, addedAt: new Date(now).toISOString(), addedBy: by }, { merge: true });
  b.set(db.doc('users/' + uid), Object.assign({ bizId: biz.bizId, role: 'admin', active: true, bizStatus: biz.status, email }, u.exists ? {} : { createdAt: now }), { merge: true });
  b.set(auditRef(biz.bizId), auditData(by, 'inviteBusinessAdmin', email));
  await b.commit();
  return { uid, email };
}
async function inviteBusinessAdmin(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const biz = await bizOrThrow(bizIdOf(input));
  return Object.assign({ ok: true }, await inviteAdmin(biz, cleanEmail(input.email), by));
}

// ---------- setBusinessStatus: מסמך העסק + bizStatus בכל users של העסק ----------
async function setBusinessStatus(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  const status = input.status;
  if (status !== 'active' && status !== 'suspended') throw bad('bad-status', 'סטטוס לא תקין');
  await bizOrThrow(bizId);
  const db = getFirestore();
  await db.doc('b/' + bizId).update({ status });
  const users = await db.collection('users').where('bizId', '==', bizId).get();
  for (let i = 0; i < users.docs.length; i += BATCH_MAX) {
    const b = db.batch();
    for (const d of users.docs.slice(i, i + BATCH_MAX)) b.update(d.ref, { bizStatus: status });
    await b.commit();
  }
  await audit(bizId, by, 'setBusinessStatus', status);
  return { ok: true, bizId, status, users: users.size };
}

// ---------- setBusinessFeatures ----------
async function setBusinessFeatures(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  const f = input.features;
  if (!f || typeof f !== 'object' || Array.isArray(f) || !Object.keys(f).length) throw bad('bad-features', 'רשימת תוספות לא תקינה');
  const upd = {};
  for (const [k, v] of Object.entries(f)) {
    if (!T.FEATURES.includes(k)) throw bad('unknown-feature', 'תוספת לא מוכרת: ' + String(k).slice(0, 30));
    if (typeof v !== 'boolean') throw bad('bad-features', 'ערך תוספת חייב להיות כן/לא');
    upd['features.' + k] = v;
  }
  await bizOrThrow(bizId);
  await getFirestore().doc('b/' + bizId).update(upd);
  await audit(bizId, by, 'setBusinessFeatures', Object.entries(f).map(([k, v]) => k + '=' + (v ? 'on' : 'off')).join(','));
  const biz = await T.loadBiz(bizId);
  return { ok: true, bizId, features: biz.features };
}

// ---------- setBusinessAdv: הגדרות מתקדמות ב-b/{bizId}/private/info.adv ----------
// מבנה (הנחה, ייתכן שיתעדכן בשלב 6): limits { scanDaily, scanPerUserDaily, yemotDaily } – מספרים שלמים;
// yemot { phone, did, ext, label } – שדות תשתית בלבד, בלי חיבור לימות.
const ADV_LIMITS = { scanDaily: [0, 10000], scanPerUserDaily: [0, 1000], yemotDaily: [0, 1000] };
function cleanAdv(adv) {
  if (!adv || typeof adv !== 'object' || Array.isArray(adv)) throw bad('bad-adv', 'הגדרות לא תקינות');
  const out = {};
  for (const k of Object.keys(adv)) if (!['limits', 'yemot'].includes(k)) throw bad('bad-adv', 'שדה לא מוכר בהגדרות: ' + String(k).slice(0, 30));
  if (adv.limits !== undefined) {
    const l = adv.limits;
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw bad('bad-adv', 'מגבלות לא תקינות');
    out.limits = {};
    for (const [k, v] of Object.entries(l)) {
      const r = ADV_LIMITS[k];
      if (!r) throw bad('bad-adv', 'מגבלה לא מוכרת: ' + String(k).slice(0, 30));
      if (!Number.isInteger(v) || v < r[0] || v > r[1]) throw bad('bad-adv', `מגבלה ${k} חייבת להיות מספר שלם בין ${r[0]} ל-${r[1]}`);
      out.limits[k] = v;
    }
  }
  if (adv.yemot !== undefined) {
    const y = adv.yemot;
    if (!y || typeof y !== 'object' || Array.isArray(y)) throw bad('bad-adv', 'הגדרות ימות לא תקינות');
    out.yemot = {};
    for (const [k, v] of Object.entries(y)) {
      if (k === 'phone' || k === 'did') { const p = v === '' ? '' : israeliPhone(v); if (p === null) throw bad('bad-adv', 'מספר טלפון לא תקין בהגדרות ימות'); out.yemot[k] = p; }
      else if (k === 'ext') { if (typeof v !== 'string' || !/^[0-9/]{0,20}$/.test(v)) throw bad('bad-adv', 'שלוחה לא תקינה'); out.yemot[k] = v; }
      else if (k === 'label') { if (typeof v !== 'string' || v.length > 60) throw bad('bad-adv', 'תיאור עד 60 תווים'); out.yemot[k] = v.trim(); }
      else throw bad('bad-adv', 'שדה לא מוכר בהגדרות ימות: ' + String(k).slice(0, 30));
    }
  }
  return out;
}
async function setBusinessAdv(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  const adv = cleanAdv(input.adv);
  await bizOrThrow(bizId);
  await getFirestore().doc(`b/${bizId}/private/info`).set({ adv }, { mergeFields: ['adv'] });
  await audit(bizId, by, 'setBusinessAdv', Object.keys(adv).join(','));
  return { ok: true, bizId, adv };
}

// ---------- setYemotToken (חלק ה'): אסימון לכתובת של yemot-hook. נשמר רק כגיבוב; מוחזר פעם אחת ----------
async function setYemotToken(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  await bizOrThrow(bizId);
  const token = bizId + '.' + crypto.randomBytes(24).toString('base64url');
  await getFirestore().doc(`b/${bizId}/private/yemot`).set({ tokenHash: crypto.createHash('sha256').update(token, 'utf8').digest('hex'), createdAt: Date.now(), by });
  await audit(bizId, by, 'setYemotToken', '');
  return { ok: true, bizId, token };
}

// ---------- logBusinessEntry: כניסה של מנהל־על לעסק (האפליקציה קוראת לה בשלב 6) ----------
async function logBusinessEntry(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  await bizOrThrow(bizId);
  await audit(bizId, by, 'superadminEnter', typeof input.note === 'string' ? input.note.slice(0, 200) : '');
  return { ok: true, bizId };
}

// ---------- addStaff / setStaffActive: מנהל העסק, בתוך העסק שלו בלבד ----------
async function requireBizManager(request) {
  const who = await requireStaff(request);
  if (who.role !== 'manager') throw deny('manager-only', 'הפעולה מותרת למנהל העסק בלבד');
  if (who.biz.dataRoot === 'legacy') throw new HttpsError('failed-precondition', 'בעסק במצב legacy מנהלים עובדים כמו היום', { reason: 'legacy-biz' });
  return who;
}
async function addStaff(request) {
  const who = await requireBizManager(request);
  const input = inputObject(request);
  const email = cleanEmail(input.email);
  const name = cleanName(input.name, 60);
  const db = getFirestore();
  const uid = await accountFor(email, who.bizId);
  await assertJoinable(uid, who.bizId);
  if ((await db.doc(T.bizRef(who.biz, 'admins/' + uid)).get()).exists) throw new HttpsError('failed-precondition', 'המשתמש כבר מנהל בעסק', { reason: 'is-admin' });
  const now = Date.now();
  const b = db.batch();
  b.set(db.doc(T.bizRef(who.biz, 'staff/' + uid)), { name, email, role: 'employee', active: true, addedAt: new Date(now).toISOString(), addedBy: who.uid, pushTokens: [] }, { merge: true });
  b.set(db.doc('users/' + uid), { bizId: who.bizId, role: 'worker', active: true, bizStatus: who.biz.status, email, createdAt: now }, { merge: true });
  b.set(auditRef(who.bizId), auditData(who.uid, 'addStaff', email));
  await b.commit();
  // סיסמה: האפליקציה שולחת ל-email את המייל המובנה "קבע סיסמה" (כמו למנהל). אין קוד.
  return { ok: true, bizId: who.bizId, uid, email };
}
async function setStaffActive(request) {
  const who = await requireBizManager(request);
  const input = inputObject(request);
  const uid = typeof input.uid === 'string' ? input.uid : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw bad('bad-uid', 'מזהה משתמש לא תקין');
  if (typeof input.active !== 'boolean') throw bad('bad-active', 'ערך לא תקין');
  if (uid === who.uid) throw new HttpsError('failed-precondition', 'אי אפשר לשנות את עצמך', { reason: 'self' });
  const db = getFirestore();
  const sRef = db.doc(T.bizRef(who.biz, 'staff/' + uid));
  const [s, a, u] = await Promise.all([sRef.get(), db.doc(T.bizRef(who.biz, 'admins/' + uid)).get(), db.doc('users/' + uid).get()]);
  if (!s.exists || (u.exists && u.get('bizId') !== who.bizId)) throw new HttpsError('not-found', 'העובד לא נמצא בעסק', { reason: 'no-staff' });
  if (a.exists) throw new HttpsError('failed-precondition', 'אי אפשר להשבית מנהל', { reason: 'is-admin' });
  const b = db.batch();
  b.update(sRef, { active: input.active });
  if (u.exists) b.update(u.ref, { active: input.active, bizStatus: who.biz.status });
  b.set(auditRef(who.bizId), auditData(who.uid, 'setStaffActive', uid + '=' + input.active));
  await b.commit();
  return { ok: true, uid, active: input.active };
}

// ---------- syncLegacyAdmin / syncLegacyStaff: עותק users/{uid} לחברי לארג' פעמי במצב legacy ----------
// כללי Storage של app_releases/ קוראים רק את users/{uid} ואת superadmins/{uid} (מגבלת 2 הקריאות, עדכון חוזה 6).
// לכן כל שינוי ב-admins/{uid} או ב-staff/{uid} בשורש (למשל השבתת עובד בלוח הבקרה) מתעדכן מיד בעותק.
// רק כש-largpeami במצב legacy (אחרי מעבר ל-b, השרת מעדכן את users דרך addStaff / setStaffActive).
// לא נוגע במשתמש ש-users שלו שייך לעסק אחר. לא יוצר users למי שאינו חבר (ואם יש עותק – מסמן active:false).
async function syncLegacyMember(uid, attempt) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(uid || ''))) return 'bad-uid';
  const biz = await T.loadBiz(T.BIZ0);
  if (!biz || biz.dataRoot !== 'legacy') return 'not-legacy';
  const db = getFirestore();
  const uRef = db.doc('users/' + uid);
  // קריאות רגילות (לא בעסקה): לא נועלות מסמכים, ולכן לא מתנגשות בכתיבות אחרות (למשל ניקוי בבדיקות).
  const [a, st, u] = await Promise.all([db.doc('admins/' + uid).get(), db.doc('staff/' + uid).get(), uRef.get()]);
  if (u.exists && u.get('bizId') !== T.BIZ0) return 'other-biz';
  const member = a.exists || st.exists;
  if (!member && !u.exists) return 'none';
  const role = a.exists ? 'admin' : 'worker';
  const active = a.exists || (st.exists && st.get('active') === true);
  const want = { bizId: T.BIZ0, role, active, bizStatus: biz.status };
  // אין שינוי בפועל = אין כתיבה (למשל registerPushToken שכותב ל-staff, או זריעה שכבר כתבה users תואם)
  if (u.exists && Object.keys(want).every((k) => u.get(k) === want[k])) return 'unchanged';
  const email = (a.exists && a.get('email')) || (st.exists && st.get('email')) || (u.exists && u.get('email')) || '';
  try {
    // כתיבה אופטימית: רק אם users לא השתנה מאז הקריאה (בלי נעילה). אם השתנה – קוראים שוב ומחשבים מחדש.
    if (u.exists) await uRef.update(want, { lastUpdateTime: u.updateTime });
    else await uRef.create(Object.assign({}, want, { email: typeof email === 'string' ? email : '', createdAt: Date.now() }));
  } catch (e) {
    const code = e && e.code;
    if ((code === 9 || code === 6 || code === 5) && (attempt || 0) < 3) return syncLegacyMember(uid, (attempt || 0) + 1);
    throw e;
  }
  return active ? 'active' : 'inactive';
}
const syncTrigger = (coll) => onDocumentWritten({ document: coll + '/{uid}', maxInstances: 2 }, async (event) => {
  try { await syncLegacyMember(event.params.uid); } catch (e) { logger.error('business: legacy sync failed', { reason: 'internal', name: e && e.name }); throw e; }
});
exports.syncLegacyAdmin = syncTrigger('admins');
exports.syncLegacyStaff = syncTrigger('staff');

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`business: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

exports.createBusiness = onCall(wrap('createBusiness', createBusiness));
exports.inviteBusinessAdmin = onCall(wrap('inviteBusinessAdmin', inviteBusinessAdmin));
exports.setBusinessStatus = onCall({ timeoutSeconds: 300 }, wrap('setBusinessStatus', setBusinessStatus));
exports.setBusinessFeatures = onCall(wrap('setBusinessFeatures', setBusinessFeatures));
exports.setBusinessAdv = onCall(wrap('setBusinessAdv', setBusinessAdv));
exports.setYemotToken = onCall(wrap('setYemotToken', setYemotToken));
exports.logBusinessEntry = onCall(wrap('logBusinessEntry', logBusinessEntry));
exports.addStaff = onCall(wrap('addStaff', addStaff));
exports.setStaffActive = onCall(wrap('setStaffActive', setStaffActive));

Object.defineProperty(exports, '_core', { enumerable: false, value: {
  createBusiness, inviteBusinessAdmin, setBusinessStatus, setBusinessFeatures, setBusinessAdv, setYemotToken,
  logBusinessEntry, addStaff, setStaffActive, syncLegacyMember, israeliPhone, cleanAdv, BATCH_MAX, wrap,
} });
