'use strict';
// קופה (POS), שלב 0 – פונקציות טהורות לזיהוי ומספור (בלי Firestore). השרת: pos.js.
//   קוד קופה: 'K' + מספר רץ לעסק (K1, K2, …). ניתן פעם אחת ולא חוזר לעולם – גם לא אחרי פרישה (מכשיר חלופי מקבל קוד חדש).
//   מזהה מכירה: '{dev}-{seq בן 6 ספרות}' (K1-000124). המספור לכל קופה בנפרד, בלי חורים ובלי כפילויות.
//   reqId: מזהה שהמכשיר יוצר ברגע הלחיצה. אותו reqId פעמיים = אותה מכירה (השרת מחזיר את הקיימת).
//   תרגול: מזהה עם '-T' ומספר (K1-T0007) לעולם לא מגיע לשרת; אם הגיע – נדחה.

const DEV_RE = /^K[1-9][0-9]{0,3}$/;
const REQ_RE = /^[A-Za-z0-9_-]{6,64}$/;
const INST_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SEQ_MAX = 999999;

const devCode = (n) => {
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error('pos-core: bad dev number');
  return 'K' + n;
};
const isDev = (s) => typeof s === 'string' && DEV_RE.test(s);
const saleId = (dev, seq) => {
  if (!isDev(dev) || !Number.isInteger(seq) || seq < 1 || seq > SEQ_MAX) throw new Error('pos-core: bad sale id');
  return dev + '-' + String(seq).padStart(6, '0');
};
// מזהה של מכירת תרגול: '-T' ואחריו ספרה, בכל מקום במחרוזת (K1-T0007, T1 בהתחלה)
const isPractice = (s) => typeof s === 'string' && /(^|-)T[0-9]/.test(s);
const isReq = (s) => typeof s === 'string' && REQ_RE.test(s) && !isPractice(s);
const isInst = (s) => typeof s === 'string' && INST_RE.test(s);
// מספר מהמכשיר (שלב 2, בלי רשת) מול המונה בשרת: 'next' = בדיוק הבא בתור; 'used' = כבר ניתן; 'gap' = מדלג (חור)
function seqCheck(last, seq) {
  const l = Number.isInteger(last) && last > 0 ? last : 0;
  if (!Number.isInteger(seq) || seq < 1 || seq > SEQ_MAX) return 'bad';
  if (seq === l + 1) return 'next';
  return seq <= l ? 'used' : 'gap';
}
// זמן המכירה במכשיר (soldAt): לא יותר מ-5 דקות בעתיד לפי שעון השרת, ולא לפני 2020
const FUTURE_MS = 5 * 60 * 1000;
const soldAtOk = (t, now) => Number.isInteger(t) && t > 1577836800000 && t <= now + FUTURE_MS;

module.exports = { DEV_RE, REQ_RE, INST_RE, SEQ_MAX, FUTURE_MS, devCode, isDev, saleId, isPractice, isReq, isInst, seqCheck, soldAtOk };
