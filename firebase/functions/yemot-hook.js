'use strict';
// שלוחה 5 – הצטרפות ישירה לרשימת הצינתוקים (בקשת המשתמש 02.11.2026).
// שלוחה 5 בקו תהיה type=api ותפנה לכתובת הזו. השרת מוסיף את המתקשר לרשימה mivtzaim, ומחזיר לימות פקודות
// של מודול API: הודעה קצרה (tts) וחזרה לתפריט הראשי.
//   tzintukJoin (onRequest) – לא נקראת מהאפליקציה. כל בקשה בלי הסוד המשותף (YEMOT_HOOK_SECRET) נדחית ב-403,
//                             בלי שום פנייה לימות. הסוד נשלח מ-ext.ini של שלוחה 5 (api_add_N=key=...).
// (לא מאומת – מתיעוד ימות שלא נקרא בסביבה הזו): שמות הפרמטרים שימות שולח (ApiPhone, ApiCallId, hangup),
// פורמט התשובה (id_list_message=t-...&go_to_folder=/), והפקודה להוספה לרשימה (lib/yemot-client.js, TZ_ADD).
// פרטיות: מספר הטלפון לא נשמר במסד. מונה הניסיונות נשמר לפי גיבוב (sha256) של המספר.

const crypto = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineInt, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const { YemotError, apiBase, addToTzintukList } = require('./lib/yemot-client');
const { israelDay } = require('./yemot').shared;

const YEMOT_API_KEY = defineSecret('YEMOT_API_KEY');
const YEMOT_HOOK_SECRET = defineSecret('YEMOT_HOOK_SECRET');
const YEMOT_API_BASE = defineString('YEMOT_API_BASE', { default: 'https://www.call2all.co.il/ym/api/', description: 'כתובת ה-API של ימות המשיח' });
const YEMOT_TZINTUK_LIST = defineString('YEMOT_TZINTUK_LIST', { default: 'mivtzaim', description: 'רשימת הצינתוקים של המבצעים' });
const YEMOT_TIMEOUT_MS = defineInt('YEMOT_TIMEOUT_MS', { default: 15000, description: 'זמן המתנה מרבי לכל קריאה לימות' });
const YEMOT_JOIN_DAILY = defineInt('YEMOT_JOIN_DAILY', { default: 3, description: 'כמה פעמים ביום מותר לאותו מספר להצטרף (הגנה מהצפה)' });

const USAGE = 'yemot_hook_usage';
// ההודעות לא מכילות נקודה, מקף, & או = (ימות מפריד ביניהם בין קבצים ופקודות – לא מאומת)
const MSG = {
  ok: 'נוספתם בהצלחה לרשימת הצינתוקים',
  hidden: 'מספר לא מזוהה ולכן לא ניתן להוסיף אתכם לרשימה',
  limit: 'הבקשה כבר התקבלה היום',
  error: 'לא הצלחנו להוסיף אתכם כרגע נסו שוב מאוחר יותר',
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

// opts (לבדיקות בתוך התהליך): { secret, key, base, list, daily, timeoutMs }
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
  // 4. הוספה לרשימה (רק הוספה)
  const key = o.key !== undefined ? o.key : YEMOT_API_KEY.value();
  try {
    if (!key) throw new YemotError('no-key', false);
    const ctx = { key, base: apiBase(o.base !== undefined ? o.base : YEMOT_API_BASE.value()), timeoutMs: o.timeoutMs || YEMOT_TIMEOUT_MS.value() };
    await addToTzintukList(ctx, o.list || YEMOT_TZINTUK_LIST.value(), phone);
  } catch (e) {
    logger.warn('yemot-hook: add failed', { reason: 'yemot-add-failed', code: e instanceof YemotError ? e.code : 'internal' });
    return send(200, answer(MSG.error));
  }
  logger.info('yemot-hook: joined', { reason: 'ok' });
  return send(200, answer(MSG.ok));
}

exports.tzintukJoin = onRequest({ secrets: [YEMOT_API_KEY, YEMOT_HOOK_SECRET], timeoutSeconds: 30, maxInstances: 2 }, async (req, res) => {
  try { await handleJoin(req, res); } catch (e) {
    logger.error('yemot-hook: failed', { reason: 'internal', name: e && e.name });
    if (!res.headersSent) res.status(200).set('Content-Type', 'text/plain; charset=utf-8').send(answer(MSG.error));
  }
});

Object.defineProperty(exports, '_core', { enumerable: false, value: { handleJoin, israeliPhone, sameSecret, answer, MSG } });
