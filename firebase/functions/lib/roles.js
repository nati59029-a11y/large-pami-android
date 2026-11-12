'use strict';
// מי רשאי להפעיל את הפונקציות: מנהל (מסמך ב-admins/{uid}) או עובד פעיל (staff/{uid} עם active == true).
// אותה הגדרה בדיוק כמו בכללי Firestore (firebase/firestore.rules). התפקיד נקרא מהמסד בכל קריאה,
// ולא מתוך הטוקן – ולכן עובד שהושבת נחסם כבר בקריאה הבאה.

const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const T = require('./tenant');

// ריבוי עסקים (שלב 5): קודם נקבע העסק (lib/tenant.js: users/{uid}, ובלי מסמך – admins/staff בשורש = largpeami),
// ואחר כך אותה בדיקה בדיוק, בתוך העסק: admins/{uid} = מנהל, staff/{uid} עם active == true = עובד.
// largpeami במצב legacy (או בלי מסמך b/largpeami): הנתיבים בשורש, כמו היום. מנהל־על = מנהל בכל עסק (גם מושהה),
// ורק הוא רשאי לבחור עסק בקלט (bizId). עסק מושהה: מנהל ועובדים נחסמים.
// opts: { feature: 'scan' | 'yemot' | ... – התוספת חייבת להיות מופעלת; yemotLine: true – רק עסק שמחובר לקו (היום: largpeami) }
async function requireStaff(request, opts) {
  const o = opts || {};
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'צריך להתחבר לאפליקציה', { reason: 'not-signed-in' });
  const m = await T.resolveMember(uid);
  const chosen = T.takeBizInput(request, m);
  const bizId = chosen || m.bizId;
  if (!bizId) {
    if (m.superadmin) throw new HttpsError('failed-precondition', 'בחרו עסק', { reason: 'no-biz' });
    throw new HttpsError('permission-denied', 'אין לך הרשאה לאפליקציה', { reason: 'not-staff' });
  }
  const biz = await T.loadBiz(bizId);
  if (!biz) throw new HttpsError('permission-denied', 'אין לך הרשאה לאפליקציה', { reason: 'not-staff' });
  const prefix = T.bizPrefix(biz);
  const db = getFirestore();
  const [admin, staff] = await Promise.all([db.doc(prefix + 'admins/' + uid).get(), db.doc(prefix + 'staff/' + uid).get()]);
  let role;
  if (admin.exists) role = 'manager';
  else if (staff.exists && staff.get('active') === true) role = 'employee';
  else if (m.superadmin) role = 'manager';
  // עובד מושבת מקבל סיבה נפרדת (על עצמו בלבד), כדי שהאפליקציה תוכל להציג "המשתמש הושבת".
  else if (staff.exists) throw new HttpsError('permission-denied', 'המשתמש הושבת. פנו למנהל.', { reason: 'staff-disabled' });
  else throw new HttpsError('permission-denied', 'אין לך הרשאה לאפליקציה', { reason: 'not-staff' });
  if (biz.status !== 'active' && !m.superadmin) throw new HttpsError('permission-denied', 'החשבון מושהה – פנה לספק', { reason: 'biz-suspended' });
  if (o.feature) T.requireFeature(biz, o.feature);
  if (o.yemotLine && bizId !== T.BIZ0) {
    throw new HttpsError('failed-precondition', 'הקו הטלפוני עוד לא מחובר לעסק שלך. פנו לספק.', { reason: 'yemot-not-connected' });
  }
  const s = T.scope();
  if (s) Object.assign(s, { bizId, prefix, biz, uid });
  return { uid, role, staff, bizId, biz, prefix, superadmin: m.superadmin };
}

// הקלט של כל פונקציה חייב להיות אובייקט (או ריק).
function inputObject(request) {
  const d = request.data;
  if (d == null) return {};
  if (typeof d !== 'object' || Array.isArray(d)) throw new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-input' });
  return d;
}

// 6ה (עדכון חוזה 15): מתגי הרשאה לעובד. מנהל (ומנהל־על) = הכול. עובד: staff/{uid}.perms, ובלי perms – ההרשאות שהיו עד היום.
// אותה הגדרה בדיוק כמו perm()/dflt() בכללי Firestore של b/{bizId}.
const PERM_KEYS = Object.freeze(['incR', 'incW', 'expR', 'expW', 'sup', 'sal', 'rep', 'ord', 'trf', 'bal']);
const DEFAULT_PERMS = Object.freeze({ incR: false, incW: true, expR: true, expW: true, sup: true, sal: false, rep: false, ord: true, trf: false, bal: false });
function hasPerm(who, k) {
  if (!who || who.role === 'manager') return true;
  const p = who.staff && typeof who.staff.get === 'function' ? who.staff.get('perms') : null;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return DEFAULT_PERMS[k] === true;
  return p[k] === true;
}

module.exports = { requireStaff, inputObject, hasPerm, PERM_KEYS, DEFAULT_PERMS };
