'use strict';
// "שליחת משימות" לעובד מורשה (19.11.2026): tkStaffNames() – רשימת הנמענים לטופס המשימה של עובד עם המתג tkS.
// עובד לא קורא את אוסף staff (בכוונה: יש שם מיילים, טלפונים, הרשאות ואסימוני התראות), ולכן השרת מחזיר רק { uid, name }.
// מי: מנהל העסק, או עובד פעיל שהמתג perms.tkS דולק אצלו עכשיו (hasPerm; בלי perms = כבוי). תוספת tasks מופעלת.
// מה: עובדים פעילים בלבד (staff/{uid}.active == true), בלי מנהלים (admins / role 'manager'), בלי הקורא עצמו, עד 300.
// name = השם בכרטיס העובד, ואם אין – החלק שלפני ה-@ (אותו שם שכבר מוצג לכל הצוות במשימות: by / doneBy). מייל מלא לא מוחזר.
// ההרשאה לשלוח, לאשר ולמחוק נאכפת בחוקי Firestore (tasks, dg == '1'); כאן רק הרשימה.
const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const { requireStaff, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX = 300;

async function staffNames(who) {
  if (who.role !== 'manager' && !hasPerm(who, 'tkS')) throw new HttpsError('permission-denied', 'אין לך הרשאה לשלוח משימות לעובדים', { reason: 'no-tkS' });
  const db = T.tdb();
  const [st, ad] = await Promise.all([db.collection('staff').limit(MAX + 50).get(), db.collection('admins').get()]);
  const adm = new Set(ad.docs.map((d) => d.id));
  const out = [];
  for (const d of st.docs) {
    const u = d.id, x = d.data() || {};
    if (!ID_RE.test(u) || u === who.uid || adm.has(u) || x.active !== true || x.role === 'manager') continue;
    const name = String(typeof x.name === 'string' && x.name.trim() ? x.name : String(typeof x.email === 'string' ? x.email : '').split('@')[0]).replace(/\s+/g, ' ').trim().slice(0, 100) || 'עובד';
    out.push({ uid: u, name });
    if (out.length >= MAX) break;
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return { ok: true, L: out };
}

exports.tkStaffNames = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'tasks' });
  return staffNames(who);
}));
Object.defineProperty(exports, '_core', { enumerable: false, value: { staffNames, MAX } });
