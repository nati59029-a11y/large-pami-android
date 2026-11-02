'use strict';
// ⛔ מושבת (BLOCKED) – "אין פעולת הוספה מתועדת".
// שלוחה 5 – הצטרפות ישירה לרשימת הצינתוקים. לפי תיעוד ימות (api-55, נבדק ע"י המתאם 02.11.2026), הפקודה
// TzintukimListManagement מכירה רק getlists / getlistEnteres / getLogList / resetList – אין פעולת "הוספה".
// לכן הקובץ הזה לא מיובא מ-index.js (לא מתפרסם), ואין בו שום פנייה לימות: אין מפתח, אין לקוח ימות.
// מה שנשאר (ונבדק בתוך תהליך הבדיקה): סוד משותף, זיהוי מספר, הגבלת קצב, ותשובה בפורמט מודול API.
// אם תימצא דרך מתועדת להוספה – מוסיפים אותה במקום אחד (addCaller למטה), אחרי אישור. אסור אי פעם resetList.
// עובדות מתועדות (api-56, לפי המתאם): פרמטרים ApiPhone/ApiDID/ApiCallId/ApiExtension/ApiTime; פרמטר קבוע דרך
// api_add_0=key=value; כותרת User-Agent: yemot-core-api/1.0; תשובה בטקסט רגיל id_list_message=t-<טקסט>&go_to_folder=/;
// בטקסט t- אסורים '.' ו-'-'; ימות רושם כל בקשה כולל הפרמטרים ב-Log/LogApi.ymgr, אלא אם api_log=no.
// פרטיות: מספר הטלפון לא נשמר במסד. מונה הניסיונות נשמר לפי גיבוב (sha256) של המספר.

const crypto = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineInt } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const { israelDay } = require('./yemot').shared;

const YEMOT_HOOK_SECRET = defineSecret('YEMOT_HOOK_SECRET');
const YEMOT_JOIN_DAILY = defineInt('YEMOT_JOIN_DAILY', { default: 3, description: 'כמה פעמים ביום מותר לאותו מספר להצטרף (הגנה מהצפה)' });

const USAGE = 'yemot_hook_usage';
// ההודעות לא מכילות נקודה ומקף (אסורים בטקסט t- לפי api-56), וגם לא & או =
const MSG = {
  ok: 'נוספתם בהצלחה לרשימת הצינתוקים',
  hidden: 'מספר לא מזוהה ולכן לא ניתן להוסיף אתכם לרשימה',
  limit: 'הבקשה כבר התקבלה היום',
  error: 'לא הצלחנו להוסיף אתכם כרגע נסו שוב מאוחר יותר',
  blocked: 'ההצטרפות דרך השלוחה הזו עוד לא פעילה',
};
const answer = (msg) => `id_list_message=t-${msg}&go_to_folder=/`;

// השוואה בזמן קבוע (גיבוב של שניהם, כדי שגם אורך שונה לא ידלוף)
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const h = (s) => crypto.createHash('sha256').update(s, 'utf8').digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// מספר ישראלי: נייד 05X (10 ספרות), קווי 02/03/04/08/09 (9 ספרות), 07X (10 ספרות). 972 בהתחלה → 0.
function israeliPhone(raw) {
  let p = String(raw == null ? '' : raw).trim().replace(/[\s-]/g, '');
  if (/^\+?972\d{8,9}$/.test(p)) p = '0' + p.replace(/^\+?972/, '');
  return /^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p) ? p : null;
}

const param = (req, name) => {
  const q = req.query && req.query[name];
  if (typeof q === 'string') return q;
  const b = req.body && typeof req.body === 'object' ? req.body[name] : undefined;
  return typeof b === 'string' ? b : undefined;
};

// opts (לבדיקות בתוך התהליך): { secret, daily }
async function handleJoin(req, res, opts) {
  const o = opts || {};
  const send = (code, body) => { res.status(code).set('Content-Type', 'text/plain; charset=utf-8').set('Cache-Control', 'no-store').send(body); };
  if (!['GET', 'POST'].includes(req.method)) return send(405, '');
  const secret = o.secret !== undefined ? o.secret : YEMOT_HOOK_SECRET.value();
  // 1. סוד משותף. בלי סוד בשרת – נדחה תמיד (סגור כברירת מחדל).
  if (!sameSecret(param(req, 'key'), secret)) { logger.warn('yemot-hook: rejected', { reason: 'bad-secret' }); return send(403, 'forbidden'); }
  // ימות מודיע גם על ניתוק השיחה – אין מה לעשות (לא מאומת)
  if (param(req, 'hangup') === 'yes') return send(200, '');
  // 2. מספר מזוהה
  const phone = israeliPhone(param(req, 'ApiPhone'));
  if (!phone) { logger.info('yemot-hook: hidden or foreign number', { reason: 'hidden' }); return send(200, answer(MSG.hidden)); }
  // 3. הגבלת קצב לפי מספר (נספר כל ניסיון שמגיע לכאן, גם אם ימות נכשל)
  const db = getFirestore();
  const day = israelDay();
  const daily = o.daily !== undefined ? o.daily : YEMOT_JOIN_DAILY.value();
  const id = crypto.createHash('sha256').update('tzjoin:' + phone).digest('hex').slice(0, 32);
  const ref = db.doc(`${USAGE}/${id}`);
  const allowed = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const used = s.exists && s.get('day') === day ? (s.get('count') || 0) : 0;
    if (used >= daily) return false;
    tx.set(ref, { day, count: used + 1, updatedAt: new Date().toISOString() });
    return true;
  });
  if (!allowed) { logger.info('yemot-hook: rate limited', { reason: 'rate-limited' }); return send(200, answer(MSG.limit)); }
  // 4. הוספה לרשימה – מושבת: אין פעולת הוספה מתועדת. אין שום פנייה לימות.
  const r = await addCaller(phone);
  logger.info('yemot-hook: join not available', { reason: r });
  return send(200, answer(r === 'ok' ? MSG.ok : MSG.blocked));
}

// נקודת ההוספה היחידה. היום: תמיד 'blocked'. אסור להשתמש כאן ב-TzintukimListManagement (אין בו הוספה, ויש בו resetList).
async function addCaller(phone) { void phone; return 'blocked'; }

// לא מיובא מ-index.js (מושבת). נשאר כאן כדי שההפעלה בעתיד תהיה שורת חיבור אחת, אחרי אישור.
exports.tzintukJoin = onRequest({ secrets: [YEMOT_HOOK_SECRET], timeoutSeconds: 30, maxInstances: 2 }, async (req, res) => {
  try { await handleJoin(req, res); } catch (e) {
    logger.error('yemot-hook: failed', { reason: 'internal', name: e && e.name });
    if (!res.headersSent) res.status(200).set('Content-Type', 'text/plain; charset=utf-8').send(answer(MSG.error));
  }
});

Object.defineProperty(exports, '_core', { enumerable: false, value: { handleJoin, israeliPhone, sameSecret, answer, MSG, BLOCKED: true } });
