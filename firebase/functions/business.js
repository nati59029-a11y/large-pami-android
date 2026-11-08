'use strict';
// ריבוי עסקים (משימה 2026-11-05, שלב 5, חלקים ג' ו-ה'): פונקציות ניהול.
//   מנהל־על בלבד (superadmins/{uid}): createBusiness, inviteBusinessAdmin, setBusinessStatus, setBusinessFeatures,
//                                     setBusinessAdv, setYemotToken, logBusinessEntry, setBusinessBrand.
//                                     setBusinessRanks, setStaffPerms, addStaff (6ה: הוספת עובדים – רק מנהל־על).
//   מנהל העסק (בתוך העסק שלו בלבד):   setStaffActive (השבתה והחזרה של עובד קיים).
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
const R = require('./lib/roles');
const { requireStaff, inputObject } = R;

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
// sup = מי שקורא לפונקציה הוא מנהל־על. רק הוא מקבל את הסיבה המפורטת. כל אחר (מנהל עסק) מקבל הודעה אחת אחידה,
// כדי שלא יוכל לגלות לפי מייל מי מנהל־העל או מי שייך לעסק אחר.
const NOT_JOINABLE = 'לא ניתן להוסיף את המייל הזה. אפשר לנסות מייל אחר, או לפנות לספק.';
async function assertJoinable(uid, bizId, sup) {
  const db = getFirestore();
  const [sa, u, a, s] = await Promise.all([db.doc('superadmins/' + uid).get(), db.doc('users/' + uid).get(), db.doc('admins/' + uid).get(), db.doc('staff/' + uid).get()]);
  const cur = u.exists ? u.get('bizId') : (a.exists || s.exists ? T.BIZ0 : null);
  if ((sa.exists || (cur && cur !== bizId)) && !sup) throw new HttpsError('failed-precondition', NOT_JOINABLE, { reason: 'not-joinable' });
  if (sa.exists) throw new HttpsError('failed-precondition', 'המייל שייך למנהל המערכת', { reason: 'is-superadmin' });
  if (cur && cur !== bizId) throw new HttpsError('failed-precondition', 'המייל כבר שייך לעסק אחר', { reason: 'other-biz' });
  return u;
}

// חשבון Auth למייל, כך שלאף אחד אין סיסמה ידועה לחשבון שמקבל הרשאות:
//   - אין חשבון → נוצר חשבון חדש בלי סיסמה. נכנסים רק אחרי "קבע סיסמה" מהמייל המובנה של Firebase.
//   - יש חשבון שלא אומת ושאינו חבר באף עסק (למשל מישהו שנרשם מראש עם המייל של המנהל, ויודע את הסיסמה שלו):
//     * הקורא אינו מנהל־על (מנהל עסק ב-addStaff) → לא נוגעים בחשבון; ההודעה האחידה not-joinable (עדכון חוזה 14).
//       כך מנהל עסק לא יכול לנטרל חשבון של אדם אחר רק לפי המייל שלו.
//     * הקורא מנהל־על → החשבון הישן מנוטרל בלי מחיקה (מושבת, המייל שלו מוחלף בכתובת שלא מקבלת דואר, החיבורים שלו מבוטלים), ונוצר חשבון חדש.
//     הטוקנים הישנים שלו שייכים למזהה אחר, ולכן לא מקבלים את ההרשאות. אפשר לשחזר אותו בלוח הבקרה.
//   - חשבון שאומת (בעל המייל) או שכבר רשום באותו עסק → אותו חשבון.
async function accountFor(email, bizId, sup) {
  const auth = getAuth();
  let rec = null;
  try { rec = await auth.getUserByEmail(email); } catch (e) { if (!e || e.code !== 'auth/user-not-found') throw e; }
  if (!rec) return (await auth.createUser({ email, emailVerified: false, disabled: false })).uid;
  const u = await assertJoinable(rec.uid, bizId, sup);
  if (u.exists || rec.emailVerified === true) return rec.uid;
  if (sup !== true) throw new HttpsError('failed-precondition', NOT_JOINABLE, { reason: 'not-joinable' }); // עדכון חוזה 14: רק מנהל־על מנטרל
  await auth.updateUser(rec.uid, { email: `orphan-${rec.uid.toLowerCase()}@orphaned.invalid`, disabled: true });
  await auth.revokeRefreshTokens(rec.uid);
  logger.warn('business: unverified account set aside', { reason: 'unverified-account' });
  return (await auth.createUser({ email, emailVerified: false, disabled: false })).uid;
}

const NEW_BIZ_SCAN_DAILY = 20;

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
      name, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: now, createdBy: by, features: { scan: true }, // סריקה אחידה, שלב 2: עסק חדש – זיהוי חכם דלוק
      brand: { name, logoPath: '', colors: {}, base: 'dark-gold', updatedAt: now, updatedBy: by },
    });
    // סריקה אחידה, שלב 2: עסק חדש – 20 דפים ביום (עסקים קיימים בלי הגדרה נשארים על ברירת המחדל הקודמת, 50)
    tx.set(db.doc(`b/${bizId}/private/info`), { ownerEmail, ownerPhone, adv: { limits: { scanDaily: NEW_BIZ_SCAN_DAILY } } });
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
  const uid = await accountFor(email, biz.bizId, true); // inviteAdmin: רק מנהל־על (requireSuper)
  const u = await assertJoinable(uid, biz.bizId, true);
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

// ---------- setScanQuota (סריקה אחידה, שלב 2): סוג הגבלת הזיהוי לעסק – מנהל־על בלבד ----------
// קלט: { bizId, mode }
//   mode 'limit'   + period 'day'|'week'|'month'|'total' + n (0..100000) – N דפים ליום / לשבוע / לחודש / קבוע (סך הכול, בלי איפוס)
//   mode 'release' + for 'day'|'week'|'month'|'forever' – שחרור החסימה ל-24 שעות / 7 ימים / 30 ימים (ואז חוזר להגבלה הרגילה) / קבוע
//   mode 'default' – מוחק את ההגדרה: חוזר בדיוק להתנהגות של היום (adv.limits.scanDaily או ברירת המחדל)
// נשמר ב-b/{bizId}/private/info.scanQuota (הכללים חוסמים כתיבה מהאפליקציה). התקרה לכל משתמש (100) לא מושפעת.
const RELEASE_MS = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000, forever: null };
async function setScanQuota(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  const biz = await T.loadBiz(bizId);
  if (!biz) throw new HttpsError('not-found', 'העסק לא נמצא', { reason: 'no-biz' });
  const now = Date.now();
  let q, note;
  if (input.mode === 'limit') {
    if (!['day', 'week', 'month', 'total'].includes(input.period)) throw bad('bad-quota', 'סוג הגבלה לא תקין');
    if (!Number.isInteger(input.n) || input.n < 0 || input.n > 100000) throw bad('bad-quota', 'מספר הדפים חייב להיות מספר שלם בין 0 ל-100000');
    q = { period: input.period, n: input.n, setAt: now, by };
    if (input.period === 'total') q.since = now;
    note = `limit:${input.period}:${input.n}`;
  } else if (input.mode === 'release') {
    if (!Object.hasOwn(RELEASE_MS, input.for)) throw bad('bad-quota', 'משך שחרור לא תקין');
    q = { release: { until: RELEASE_MS[input.for] === null ? null : now + RELEASE_MS[input.for] }, setAt: now, by };
    note = `release:${input.for}`;
  } else if (input.mode === 'default') {
    q = null; note = 'default';
  } else throw bad('bad-quota', 'מצב לא תקין');
  const db = getFirestore();
  const ref = db.doc(`b/${bizId}/private/info`);
  // הגבלה קבועה (total) חדשה מתחילה מאפס: המונה _biz מתאפס יחד עם ההגדרה, בטרנזקציה אחת
  await db.runTransaction(async (tx) => {
    tx.set(ref, { scanQuota: q === null ? FieldValue.delete() : q }, { merge: true });
    if (q && q.period === 'total') tx.set(db.doc(T.bizRef(biz, 'scan_usage/_biz')), { day: 'T', count: 0, updatedAt: new Date(now).toISOString() });
  });
  await audit(bizId, by, 'setScanQuota', note);
  return { ok: true, bizId, scanQuota: q };
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

// ---------- setBusinessBrand: מיתוג העסק (שם תצוגה, לוגו, צבעים) – מנהל־על בלבד (עדכון חוזה 14) ----------
// הלוגו עצמו מועלה מהאפליקציה ל-Storage, לנתיב b/{bizId}/brand/logo שרק מנהל־על כותב (כללי Storage, קריאה אחת: superadmins).
// כאן נשמר מסמך brand: name (עד 60 תווים), logoPath ('' או נתיב הלוגו של העסק הזה בלבד), colors (#rrggbb, רק 6 המפתחות המוכרים).
// שדה שלא נשלח – נשאר כמו שהיה. base נשמר כמו שהיה (ברירת מחדל 'dark-gold'). updatedAt/updatedBy – השרת. כל שינוי נרשם ב-audit.
const BRAND_COLORS = ['acc', 'acc2', 'onacc', 'bg', 'card', 'ink'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function cleanBrand(bizId, br) {
  if (!br || typeof br !== 'object' || Array.isArray(br)) throw bad('bad-brand', 'המיתוג לא תקין');
  for (const k of Object.keys(br)) if (!['name', 'logoPath', 'colors'].includes(k)) throw bad('bad-brand', 'שדה לא מוכר במיתוג: ' + String(k).slice(0, 30));
  const out = {};
  if (br.name !== undefined) {
    const n = typeof br.name === 'string' ? br.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : null;
    if (n === null || n.length > 60) throw bad('bad-brand', 'שם התצוגה: עד 60 תווים');
    out.name = n;
  }
  if (br.logoPath !== undefined) {
    if (br.logoPath !== '' && br.logoPath !== `b/${bizId}/brand/logo`) throw bad('bad-brand', 'נתיב הלוגו לא תקין');
    out.logoPath = br.logoPath;
  }
  if (br.colors !== undefined) {
    const c = br.colors;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('bad-brand', 'הצבעים לא תקינים');
    out.colors = {};
    for (const [k, v] of Object.entries(c)) {
      if (!BRAND_COLORS.includes(k)) throw bad('bad-brand', 'צבע לא מוכר: ' + String(k).slice(0, 30));
      if (typeof v !== 'string' || !HEX_RE.test(v)) throw bad('bad-brand', 'כל צבע חייב להיות בצורה #rrggbb');
      out.colors[k] = v.toLowerCase();
    }
  }
  if (!Object.keys(out).length) throw bad('bad-brand', 'לא נשלח שום שינוי במיתוג');
  return out;
}
async function setBusinessBrand(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  const upd = cleanBrand(bizId, input.brand);
  const biz = await bizOrThrow(bizId);
  if (biz.dataRoot === 'legacy') throw new HttpsError('failed-precondition', 'בעסק במצב legacy אין מיתוג', { reason: 'legacy-biz' });
  const db = getFirestore();
  const ref = db.doc('b/' + bizId);
  let brand = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const old = s.get('brand') && typeof s.get('brand') === 'object' ? s.get('brand') : {};
    const base = typeof old.base === 'string' && /^[a-z0-9-]{1,30}$/.test(old.base) ? old.base : 'dark-gold';
    brand = {
      name: upd.name !== undefined ? upd.name : (typeof old.name === 'string' ? old.name : biz.name),
      logoPath: upd.logoPath !== undefined ? upd.logoPath : (old.logoPath === `b/${bizId}/brand/logo` ? old.logoPath : ''),
      colors: upd.colors !== undefined ? upd.colors : (old.colors && typeof old.colors === 'object' ? old.colors : {}),
      base, updatedAt: Date.now(), updatedBy: by,
    };
    tx.update(ref, { brand });
    tx.set(auditRef(bizId), auditData(by, 'setBusinessBrand', Object.keys(upd).join(',') + (upd.logoPath !== undefined ? ';logo=' + (upd.logoPath ? 'on' : 'off') : '')));
  });
  return { ok: true, bizId, brand };
}

// ---------- 6ה (עדכון חוזה 15): דרגות ומתגי הרשאה לעובדים ----------
// ranks: b/{bizId}/private/info.ranks = [{ id, name, perms }]. רק מנהל־על כותב (setBusinessRanks). מנהל העסק קורא (private/info).
// staff/{uid}.perms = מפת מתגים, staff/{uid}.rank = מזהה דרגה ('' = בלי דרגה). רק מנהל־על כותב (setStaffPerms / addStaff).
// הדרגה היא תבנית התחלתית בלבד: perms של העובד הם הקובעים, וכל מתג אפשר לשנות לבד. בלי perms (עובד ישן) = R.DEFAULT_PERMS.
const PERM_KEYS = R.PERM_KEYS;
function cleanPerms(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad('bad-perms', 'ההרשאות לא תקינות');
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (!PERM_KEYS.includes(k)) throw bad('bad-perms', 'הרשאה לא מוכרת: ' + String(k).slice(0, 30));
    // 6ו (עדכון חוזה 16): expR = true (כל ההוצאות) | 'own' (רק מה שהזין בעצמו) | false (לא רואה). שאר המתגים – כן/לא
    if (typeof v !== 'boolean' && !(k === 'expR' && v === 'own')) throw bad('bad-perms', 'ערך הרשאה חייב להיות כן/לא');
  }
  for (const k of PERM_KEYS) out[k] = p[k] === true; // תמיד מפה מלאה: מתג שלא נשלח = כבוי
  if (p.expR === 'own') out.expR = 'own';
  return out;
}
const RANK_ID_RE = /^[a-z0-9_-]{1,30}$/;
function cleanRanks(rs) {
  if (!Array.isArray(rs) || rs.length > 20) throw bad('bad-ranks', 'רשימת הדרגות לא תקינה (עד 20)');
  const ids = new Set();
  return rs.map((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('bad-ranks', 'דרגה לא תקינה');
    for (const k of Object.keys(r)) if (!['id', 'name', 'perms'].includes(k)) throw bad('bad-ranks', 'שדה לא מוכר בדרגה');
    if (typeof r.id !== 'string' || !RANK_ID_RE.test(r.id) || ids.has(r.id)) throw bad('bad-ranks', 'מזהה דרגה לא תקין או כפול');
    ids.add(r.id);
    let name;
    try { name = cleanName(r.name, 40); } catch (e) { throw bad('bad-ranks', 'שם הדרגה חובה, עד 40 תווים'); }
    return { id: r.id, name, perms: cleanPerms(r.perms) };
  });
}
async function bizB(bizId) {
  const biz = await bizOrThrow(bizId);
  if (biz.dataRoot === 'legacy') throw new HttpsError('failed-precondition', 'בעסק במצב legacy מנהלים עובדים כמו היום', { reason: 'legacy-biz' });
  return biz;
}
async function setBusinessRanks(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  const ranks = cleanRanks(input.ranks);
  await bizB(bizId);
  // 7: הדרגות וה-audit באותה אצווה (כמו setStaffPerms), כדי שלא יישמרו דרגות בלי רישום
  const wb = getFirestore().batch();
  wb.set(getFirestore().doc(`b/${bizId}/private/info`), { ranks }, { mergeFields: ['ranks'] });
  wb.set(auditRef(bizId), auditData(by, 'setBusinessRanks', ranks.map((r) => r.id).join(',')));
  await wb.commit();
  return { ok: true, bizId, ranks };
}
async function rankOf(bizId, rank) {
  if (rank === undefined || rank === '') return null;
  if (typeof rank !== 'string' || !RANK_ID_RE.test(rank)) throw bad('bad-rank', 'דרגה לא תקינה');
  const info = await getFirestore().doc(`b/${bizId}/private/info`).get();
  const rs = Array.isArray(info.get('ranks')) ? info.get('ranks') : [];
  const r = rs.find((x) => x && x.id === rank);
  if (!r) throw bad('bad-rank', 'הדרגה לא קיימת בעסק');
  return r;
}
// setStaffPerms({bizId, uid, rank?, perms?}): rank בלי perms = המתגים של הדרגה (תבנית). perms = המתגים שנשלחו (גוברים על הדרגה).
async function setStaffPerms(request) {
  const by = await requireSuper(request);
  const input = inputObject(request);
  const bizId = bizIdOf(input);
  const uid = typeof input.uid === 'string' ? input.uid : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw bad('bad-uid', 'מזהה משתמש לא תקין');
  const biz = await bizB(bizId);
  const r = await rankOf(bizId, input.rank);
  if (input.perms === undefined && !r) throw bad('bad-perms', 'צריך לבחור דרגה או הרשאות');
  const perms = input.perms !== undefined ? cleanPerms(input.perms) : cleanPerms(r.perms);
  const db = getFirestore();
  const sRef = db.doc(T.bizRef(biz, 'staff/' + uid));
  const [s, a] = await Promise.all([sRef.get(), db.doc(T.bizRef(biz, 'admins/' + uid)).get()]);
  if (!s.exists) throw new HttpsError('not-found', 'העובד לא נמצא בעסק', { reason: 'no-staff' });
  if (a.exists) throw new HttpsError('failed-precondition', 'למנהל העסק יש את כל ההרשאות', { reason: 'is-admin' });
  const upd = { perms };
  if (input.rank !== undefined) upd.rank = r ? r.id : '';
  const b = db.batch();
  b.update(sRef, upd);
  b.set(auditRef(bizId), auditData(by, 'setStaffPerms', uid + ':' + PERM_KEYS.filter((k) => perms[k]).map((k) => (perms[k] === 'own' ? k + '=own' : k)).join(',')));
  await b.commit();
  return { ok: true, uid, perms, rank: upd.rank !== undefined ? upd.rank : (s.get('rank') || '') };
}

// ---------- addStaff (מנהל־על בלבד, 6ה) / setStaffActive (מנהל העסק או מנהל־על) ----------
async function requireBizManager(request) {
  const who = await requireStaff(request);
  if (who.role !== 'manager') throw deny('manager-only', 'הפעולה מותרת למנהל העסק בלבד');
  if (who.biz.dataRoot === 'legacy') throw new HttpsError('failed-precondition', 'בעסק במצב legacy מנהלים עובדים כמו היום', { reason: 'legacy-biz' });
  return who;
}
async function addStaff(request) {
  const who = await requireBizManager(request);
  // 6ה, החלטת המשתמש 3: רק מנהל־על מוסיף עובדים. מנהל העסק – לא (גם לא דרך הפונקציה).
  if (who.superadmin !== true) throw deny('not-superadmin', 'הוספת עובדים מותרת למנהל המערכת בלבד');
  const input = inputObject(request);
  const r = await rankOf(who.bizId, input.rank);
  const perms = input.perms !== undefined ? cleanPerms(input.perms) : (r ? cleanPerms(r.perms) : null);
  const email = cleanEmail(input.email);
  const name = cleanName(input.name, 60);
  const db = getFirestore();
  const uid = await accountFor(email, who.bizId, who.superadmin === true);
  await assertJoinable(uid, who.bizId, who.superadmin === true);
  if ((await db.doc(T.bizRef(who.biz, 'admins/' + uid)).get()).exists) throw new HttpsError('failed-precondition', 'המשתמש כבר מנהל בעסק', { reason: 'is-admin' });
  const now = Date.now();
  const b = db.batch();
  b.set(db.doc(T.bizRef(who.biz, 'staff/' + uid)), Object.assign({ name, email, role: 'employee', active: true, addedAt: new Date(now).toISOString(), addedBy: who.uid, pushTokens: [] },
    perms ? { perms, rank: r ? r.id : '' } : {}), { merge: true });
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

// setStaffName({uid, name}) – סריקה אחידה, שלב 6: שם העובד (מוצג ב"מי הכניס"). מנהל העסק (במבנה b) או מנהל־על. רק השדה name ב-staff, עם audit.
// staff נכתב רק דרך השרת (החוקים חוסמים כתיבה מהאפליקציה), ולכן אין שינוי בחוקים. לארג' פעמי במצב legacy – נדחה כמו addStaff/setStaffActive.
async function setStaffName(request) {
  const who = await requireBizManager(request);
  const input = inputObject(request);
  const uid = typeof input.uid === 'string' ? input.uid : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw bad('bad-uid', 'מזהה משתמש לא תקין');
  const name = cleanName(input.name, 60);
  const db = getFirestore();
  const sRef = db.doc(T.bizRef(who.biz, 'staff/' + uid));
  const s = await sRef.get();
  if (!s.exists) throw new HttpsError('not-found', 'העובד לא נמצא בעסק', { reason: 'no-staff' });
  const b = db.batch();
  b.update(sRef, { name });
  b.set(auditRef(who.bizId), auditData(who.uid, 'setStaffName', uid));
  await b.commit();
  return { ok: true, uid, name };
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
exports.setScanQuota = onCall(wrap('setScanQuota', setScanQuota));
exports.setYemotToken = onCall(wrap('setYemotToken', setYemotToken));
exports.logBusinessEntry = onCall(wrap('logBusinessEntry', logBusinessEntry));
exports.setBusinessBrand = onCall(wrap('setBusinessBrand', setBusinessBrand));
exports.setBusinessRanks = onCall(wrap('setBusinessRanks', setBusinessRanks));
exports.setStaffPerms = onCall(wrap('setStaffPerms', setStaffPerms));
exports.addStaff = onCall(wrap('addStaff', addStaff));
exports.setStaffActive = onCall(wrap('setStaffActive', setStaffActive));
exports.setStaffName = onCall(wrap('setStaffName', setStaffName));

Object.defineProperty(exports, '_core', { enumerable: false, value: {
  createBusiness, inviteBusinessAdmin, setBusinessStatus, setBusinessFeatures, setBusinessAdv, setYemotToken,
  setScanQuota, NEW_BIZ_SCAN_DAILY, logBusinessEntry, setBusinessBrand, cleanBrand, addStaff, setBusinessRanks, setStaffPerms, cleanPerms, cleanRanks, setStaffActive, syncLegacyMember, israeliPhone, cleanAdv, BATCH_MAX, wrap,
} });
