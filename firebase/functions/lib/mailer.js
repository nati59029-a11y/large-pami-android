'use strict';
// שליחת מייל עם קוד חד־פעמי (הזמנת מנהל עסק או עובד).
// היום אין שליחה אמיתית: שליחת מייל היא פעולה חיצונית שדורשת אישור מפורש של המשתמש.
//   באמולטור – "נשלח" כהדמיה בלבד (status: 'simulated'), והקוד מוחזר לבדיקות דרך הפונקציה שקראה (devCode).
//   בייצור   – לא נשלח כלום (status: 'not-configured'), והקוד לא מוחזר בשום מקום.
// לחיבור שליחה אמיתית (אחרי אישור): מממשים כאן את transport (למשל שירות מייל עם מפתח ב-Secret Manager),
// ומחזירים status: 'sent'. הקוד עצמו לעולם לא נכתב ליומן.

const logger = require('firebase-functions/logger');

const mask = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');

// transport אפשר להחליף בבדיקות בלבד (setTransport). ברירת המחדל: אין שליחה.
let transport = null;

async function sendInviteCode({ to, code, bizName, role }) {
  if (transport) {
    await transport({ to, subject: 'קוד כניסה ראשונה', text: `הקוד שלך לכניסה ל-${bizName || 'האפליקציה'}: ${code}. הקוד בתוקף 30 דקות.` });
    return { status: 'sent' };
  }
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    logger.info('mailer: simulated', { to: mask(to), role });
    return { status: 'simulated' };
  }
  logger.warn('mailer: not configured', { to: mask(to), role });
  return { status: 'not-configured' };
}

Object.defineProperty(module.exports, 'sendInviteCode', { enumerable: true, value: sendInviteCode });
Object.defineProperty(module.exports, '_setTransport', { enumerable: false, value: (fn) => { transport = fn; } });
