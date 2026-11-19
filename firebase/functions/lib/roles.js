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
  // 19.11.2026 (הכרעת בעל העסק): "שלוחות הקו" לעובד – רק עם המתג yl (כבוי כברירת מחדל, גם לעובד ישן בלי perms).
  // מנהל ומנהל־על – כמו היום. השיחות לקו (yemot-hook.js) והפונקציות המתוזמנות לא עוברות כאן.
  if (o.yemotLine && role !== 'manager' && !hasPerm({ role, staff, admin, superadmin: m.superadmin }, 'yl')) {
    throw new HttpsError('permission-denied', 'אין לך הרשאה לשלוחות הקו. פנו למנהל.', { reason: 'no-line-perm' });
  }
  const s = T.scope();
  if (s) Object.assign(s, { bizId, prefix, biz, uid });
  return { uid, role, staff, admin, bizId, biz, prefix, superadmin: m.superadmin };
}

// הקלט של כל פונקציה חייב להיות אובייקט (או ריק).
function inputObject(request) {
  const d = request.data;
  if (d == null) return {};
  if (typeof d !== 'object' || Array.isArray(d)) throw new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-input' });
  return d;
}

// 6ה (עדכון חוזה 15): מתגי הרשאה לעובד. מנהל (ומנהל־על) = הכול (חוץ מ-pos / posMgr של מנהל – ראו SA_ONLY). עובד: staff/{uid}.perms, ובלי perms – ההרשאות שהיו עד היום.
// אותה הגדרה בדיוק כמו perm()/dflt() בכללי Firestore של b/{bizId}.
// prc (12.11.2026, תמחור חשבונית ספק): "עדכון מחירים ומלאי" – כבוי כברירת מחדל, גם לעובד ישן בלי perms (גם בלארג' פעמי).
// s3m (14.11.2026, store3d): "שרטוט מפה" – עובד ששומר מפה (s3SaveMap) וקורא גרסאות קודמות; כבוי כברירת מחדל, גם לעובד ישן בלי perms.
// pos / posMgr (קופה, שלב 0, 17.11.2026): קופאי / אחראי משמרת – כבויים כברירת מחדל, גם לעובד ישן בלי perms. pos לבד לא נותן עלות (p/cost).
// shf (18.11.2026, shifts.js): "משמרות" – עובד שרואה את כל המשמרות, עורך ושולח משימות למשמרת; כבוי כברירת מחדל, גם לעובד ישן בלי perms.
// yl (19.11.2026): "שלוחות הקו" – עובד שמשתמש בפונקציות הקו (requireStaff עם yemotLine); כבוי כברירת מחדל, גם לעובד ישן בלי perms.
// tkS (19.11.2026, tasks-send.js + חוקי tasks): "שליחת משימות" – עובד ששולח משימות לעובדים אחרים ומאשר/מחזיר/מוחק רק את מה ששלח (dg == '1'); כבוי כברירת מחדל.
const PERM_KEYS = Object.freeze(['incR', 'incW', 'expR', 'expW', 'sup', 'sal', 'rep', 'ord', 'trf', 'bal', 'ordP', 'prc', 's3m', 'pos', 'posMgr', 'shf', 'yl', 'tkS']);
const DEFAULT_PERMS = Object.freeze({ incR: false, incW: true, expR: true, expW: true, sup: true, sal: false, rep: false, ord: true, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false, shf: false, yl: false, tkS: false });
// 18.11.2026 (הכרעת בעל העסק): קופה – רק מנהל־על מחליט מי מקבל, גם מנהלים. pos / posMgr של מנהל עסק = admins/{uid}.perms
// (רק השרת כותב: setStaffPerms, מנהל־על בלבד). מנהל־על (גם כשהוא מנהל בעסק) = הכול, כמו היום. שאר ההרשאות של מנהל לא השתנו.
// אותה הגדרה בדיוק כמו perm() בכללי Firestore של b/{bizId}.
const SA_ONLY = Object.freeze(['pos', 'posMgr']);
function hasPerm(who, k) {
  if (!who) return true;
  if (who.role === 'manager') {
    if (who.superadmin || !SA_ONLY.includes(k)) return true;
    const ap = who.admin && typeof who.admin.get === 'function' ? who.admin.get('perms') : null;
    return !!ap && typeof ap === 'object' && !Array.isArray(ap) && ap[k] === true;
  }
  const p = who.staff && typeof who.staff.get === 'function' ? who.staff.get('perms') : null;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return DEFAULT_PERMS[k] === true;
  return p[k] === true;
}

module.exports = { requireStaff, inputObject, hasPerm, PERM_KEYS, DEFAULT_PERMS, SA_ONLY };
