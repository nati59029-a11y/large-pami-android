'use strict';
// גיטי – קבוצות פנימיות (23.11.2026, "גיטי מנהלת עסק", סבב 3 חלק א, החלטה 2): הרשאת קריאה לכל קבוצה.
//   sec_cfg/main.grp = [gid, ...] – הקבוצות שהמנהל פתח לגיטי (ברירת מחדל: אין שדה = אף קבוצה). נכתב רק בשרת (secPrefs op:'grp'),
//   ונקרא מחדש בכל קריאה (כלי getGroupMessages ו-secComm), כך שכיבוי עוצר מיד. מסמכי grp עצמם לא משתנים.
//   תוספת: בעסק b/{biz} – features.groups (כמו החוקים); בשורש (לארג' פעמי ב-legacy) החוקים לא בודקים תוספת – תמיד פעיל.

const GID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_ALLOWED = 50; // קבוצות פתוחות לגיטי בעסק אחד
const LIST_MAX = 300;   // קבוצות שנקראות לרשימת ההגדרות

const grpOn = (who) => !!who && (who.prefix === '' || !!(who.biz && who.biz.features && who.biz.features.groups === true));
const allowedOf = (data) => {
  const a = data && Array.isArray(data.grp) ? data.grp : [];
  return [...new Set(a.filter((g) => typeof g === 'string' && GID_RE.test(g)))].slice(0, MAX_ALLOWED);
};
// הרשאה עדכנית – קריאה חוזרת של sec_cfg/main בזמן הקריאה (לא מה שנקרא בתחילת השיחה)
async function readAllowed(db) {
  const s = await db.doc('sec_cfg/main').get();
  return allowedOf(s.exists ? s.data() : null);
}
const cleanName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '');
// הקבוצות המורשות שעדיין קיימות: [{ gid, name }]. קבוצה שנמחקה – לא מוחזרת (ולא נקראת)
async function allowedGroups(db, ids) {
  if (!ids.length) return [];
  const snaps = await db.getAll(...ids.map((g) => db.doc('grp/' + g)));
  return snaps.filter((s) => s.exists).map((s) => ({ gid: s.id, name: cleanName(s.get('name')) || 'קבוצה' }));
}
// כל קבוצות העסק (למסך ההגדרות): שם, מספר חברים, הודעה אחרונה (זמן בלבד) ומצב ההרשאה
async function listGroups(db, allowed) {
  const s = await db.collection('grp').select('name', 'mem', 'last').limit(LIST_MAX).get();
  const A = new Set(allowed || []);
  return s.docs.map((d) => ({ gid: d.id, name: cleanName(d.get('name')) || 'קבוצה', n: Array.isArray(d.get('mem')) ? d.get('mem').length : 0,
    last: d.get('last') && Number.isInteger(d.get('last').t) ? d.get('last').t : 0, on: A.has(d.id) }))
    .sort((a, b) => (b.last - a.last) || a.name.localeCompare(b.name, 'he'));
}
const KIND = { img: 'תמונה', vid: 'סרטון' };

module.exports = { GID_RE, MAX_ALLOWED, grpOn, allowedOf, readAllowed, allowedGroups, listGroups, cleanName, KIND };
