'use strict';
// מי רשאי להפעיל את הפונקציות: מנהל (מסמך ב-admins/{uid}) או עובד פעיל (staff/{uid} עם active == true).
// אותה הגדרה בדיוק כמו בכללי Firestore (firebase/firestore.rules). התפקיד נקרא מהמסד בכל קריאה,
// ולא מתוך הטוקן – ולכן עובד שהושבת נחסם כבר בקריאה הבאה.

const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');

async function requireStaff(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'צריך להתחבר לאפליקציה', { reason: 'not-signed-in' });
  const db = getFirestore();
  const [admin, staff] = await Promise.all([db.doc('admins/' + uid).get(), db.doc('staff/' + uid).get()]);
  if (admin.exists) return { uid, role: 'manager', staff };
  if (staff.exists && staff.get('active') === true) return { uid, role: 'employee', staff };
  // עובד מושבת מקבל סיבה נפרדת (על עצמו בלבד), כדי שהאפליקציה תוכל להציג "המשתמש הושבת".
  if (staff.exists) throw new HttpsError('permission-denied', 'המשתמש הושבת. פנו למנהל.', { reason: 'staff-disabled' });
  throw new HttpsError('permission-denied', 'אין לך הרשאה לאפליקציה', { reason: 'not-staff' });
}

// הקלט של כל פונקציה חייב להיות אובייקט (או ריק).
function inputObject(request) {
  const d = request.data;
  if (d == null) return {};
  if (typeof d !== 'object' || Array.isArray(d)) throw new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-input' });
  return d;
}

module.exports = { requireStaff, inputObject };
