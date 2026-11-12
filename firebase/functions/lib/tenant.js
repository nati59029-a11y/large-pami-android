'use strict';
// ריבוי עסקים (משימה 2026-11-05, שלב 5): לאיזה עסק שייכת הקריאה, ואיפה הנתונים שלו.
//   resolveMember(uid)  – { uid, bizId, role ('admin'/'worker'/null), active, bizStatus, superadmin } לפי users/{uid}.
//                         בלי מסמך users: admins/{uid} או staff/{uid} בשורש = חבר של largpeami (תאימות למשתמשים קיימים).
//   loadBiz(bizId)      – מסמך העסק b/{bizId}. ללארג' פעמי בלי מסמך: legacy, פעיל, כל התוספות מופעלות (בדיוק כמו היום).
//   bizPrefix(biz)      – '' (השורש) רק ל-largpeami במצב legacy. כל עסק אחר: 'b/{bizId}/'.
//   bizRef(bizId, path) – הנתיב המלא של path בתוך העסק (מכבד את dataRoot).
//   tdb()               – Firestore של העסק של הקריאה הנוכחית: doc() ו-collection() מקבלים את התחילית של העסק.
//                         בלי עסק (בדיקות שקוראות לליבה ישירות, או largpeami במצב legacy) = getFirestore() הרגיל.
// עיקרון: bizId לעולם לא נלקח מהלקוח, חוץ ממנהל־על (superadmins/{uid}), שמורשה בכל עסק.

const { AsyncLocalStorage } = require('node:async_hooks');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');

const BIZ0 = 'largpeami';
const BIZ_RE = /^[a-z0-9-]{3,30}$/;
// מפתחות התוספות (חוזה, סעיף ו)
const FEATURES = ['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders', 'cellular', 'ordCard', 'secretary'];
// ordCard (2026-11-10 11:50): הזנת כרטיס אשראי בטופס ההזמנה – ברירת מחדל פעיל (גם כשהמפתח חסר במסמך); רק מנהל־על מכבה (false)
// cellular (00:24, ניודים בלקוח) – ברירת מחדל כבוי גם בעסק הישן; רק מנהל־על מפעיל
// secretary (המזכירה העסקית, שלב 1, 11.11.2026) – כמו cellular: כבוי כברירת מחדל בכל עסק, גם בעסק הישן; רק מנהל־על מפעיל
const OFF_IN_LEGACY = ['cellular', 'secretary'];
const ALL_ON = Object.freeze(Object.fromEntries(FEATURES.map((k) => [k, !OFF_IN_LEGACY.includes(k)])));

const als = new AsyncLocalStorage();

// עוטף פונקציית שרת: לכל קריאה "מגירה" משלה, שאליה requireStaff כותב את העסק שנקבע.
function scoped(fn) {
  return (...args) => als.run({}, () => fn(...args));
}
function scope() { return als.getStore() || null; }
// להרצה בתוך עסק ידוע (פונקציות מתוזמנות, yemot-hook)
function runInBiz(ctx, fn) { return als.run(Object.assign({}, ctx), fn); }

function prefixed(db, prefix) {
  if (!prefix) return db;
  return new Proxy(db, {
    get(t, k) {
      if (k === 'doc') return (p) => t.doc(prefix + p);
      if (k === 'collection') return (p) => t.collection(prefix + p);
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
function tdb() {
  const s = scope();
  return prefixed(getFirestore(), s && s.prefix ? s.prefix : '');
}

async function loadBiz(bizId) {
  if (!BIZ_RE.test(String(bizId || ''))) return null;
  const s = await getFirestore().doc('b/' + bizId).get();
  if (!s.exists) {
    if (bizId === BIZ0) return { bizId, exists: false, status: 'active', dataRoot: 'legacy', features: Object.assign({}, ALL_ON) };
    return null;
  }
  const d = s.data() || {};
  const f = d.features && typeof d.features === 'object' ? d.features : {};
  return {
    bizId, exists: true,
    status: d.status === 'active' ? 'active' : 'suspended', // חסר או ערך לא מוכר = לא פעיל (כמו בחוקים)
    dataRoot: bizId === BIZ0 && d.dataRoot === 'legacy' ? 'legacy' : 'b', // השורש שייך רק ללארג' פעמי
    features: Object.fromEntries(FEATURES.map((k) => [k, k === 'ordCard' ? f[k] !== false : f[k] === true])),
    name: typeof d.name === 'string' ? d.name : '',
  };
}
const bizPrefix = (biz) => (biz && biz.dataRoot === 'legacy' && biz.bizId === BIZ0 ? '' : 'b/' + biz.bizId + '/');
const bizRef = (biz, path) => bizPrefix(biz) + path;

// עסקים שהתוספת key מופעלת אצלם (לפונקציות מתוזמנות). largpeami בלי מסמך b/largpeami = legacy, הכול מופעל.
async function bizzesWith(key) {
  const snap = await getFirestore().collection('b').where('features.' + key, '==', true).get();
  const out = [];
  for (const d of snap.docs) { const biz = await loadBiz(d.id); if (biz) out.push(biz); }
  if (!out.find((b) => b.bizId === BIZ0)) { const b0 = await loadBiz(BIZ0); if (b0 && !b0.exists) out.push(b0); }
  return out;
}

async function isSuper(uid) {
  return !!uid && (await getFirestore().doc('superadmins/' + uid).get()).exists;
}

async function resolveMember(uid) {
  const db = getFirestore();
  const [u, sa] = await Promise.all([db.doc('users/' + uid).get(), db.doc('superadmins/' + uid).get()]);
  const out = { uid, bizId: null, role: null, active: false, bizStatus: null, superadmin: sa.exists };
  if (u.exists) {
    const b = u.get('bizId');
    if (BIZ_RE.test(String(b || ''))) Object.assign(out, { bizId: b, role: u.get('role') === 'admin' ? 'admin' : u.get('role') === 'worker' ? 'worker' : null, active: u.get('active') === true, bizStatus: u.get('bizStatus') || null });
    return out;
  }
  const [a, s] = await Promise.all([db.doc('admins/' + uid).get(), db.doc('staff/' + uid).get()]);
  if (a.exists) Object.assign(out, { bizId: BIZ0, role: 'admin', active: true });
  else if (s.exists) Object.assign(out, { bizId: BIZ0, role: 'worker', active: s.get('active') === true });
  return out;
}

// bizId שהגיע בקלט: מנהל־על – העסק שבחר. כל משתמש אחר – רק העסק שלו (אחר = שגיאה). השדה מוסר מהקלט,
// כדי שהבדיקות הקיימות של הקלט בכל פונקציה ימשיכו לראות בדיוק את מה שראו קודם.
function takeBizInput(request, m) {
  const d = request && request.data;
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Object.prototype.hasOwnProperty.call(d, 'bizId')) return null;
  const v = d.bizId;
  delete d.bizId;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !BIZ_RE.test(v)) throw new HttpsError('invalid-argument', 'מזהה עסק לא תקין', { reason: 'bad-biz' });
  if (!m.superadmin && v !== m.bizId) throw new HttpsError('permission-denied', 'אין לך הרשאה לעסק הזה', { reason: 'foreign-biz' });
  return v;
}

function requireFeature(biz, key) {
  if (!biz || !biz.features || biz.features[key] !== true) {
    throw new HttpsError('failed-precondition', 'התוספת הזו לא מופעלת בעסק שלך. פנו לספק.', { reason: 'feature-off', feature: key });
  }
}

module.exports = {
  BIZ0, BIZ_RE, FEATURES, ALL_ON, als, scoped, scope, runInBiz, tdb, prefixed,
  loadBiz, bizzesWith, bizPrefix, bizRef, isSuper, resolveMember, takeBizInput, requireFeature,
};
