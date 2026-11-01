'use strict';
// שליחת מבצע לקו הטלפוני (ימות המשיח), שלוחה 2 "מבצעים".
//   sendPromoToLine    – עובד פעיל או מנהל. מעלה קובץ tts חדש לשלוחה, ובאופן רשות שולח צינתוק לרשימה mivtzaim.
//                        עם צינתוק: עובד – פעם ביום (שעון ישראל, נספר רק צינתוק שהצליח); מנהל – בלי הגבלה.
//                        בלי צינתוק: בלי הגבלה לאף אחד.
//                        { statusOnly: true } – רק מחזיר אם המשתמש עוד יכול לשלוח צינתוק היום (בלי שום פנייה לימות).
//                        promoKey – מזהה קבוע של המבצע: קובץ אחד לכל מבצע; ניסיון חוזר לא מעלה קובץ נוסף (פירוט למטה).
//   expirePromosOnLine – כל לילה 00:15 שעון ישראל: מוחקת מהקו מבצעים שפג תוקפם. מוחקת רק קבצים שהיא עצמה העלתה.
//   runExpiry(opts)    – הלב של ההורדה, מיוצא לבדיקות (לא מ-index.js).
// המפתח של ימות נמצא רק בכספת של השרת (YEMOT_API_KEY). הוא נשלח לימות בכותרת authorization בלבד,
// ולעולם לא נכתב ליומן, לרשומה או להודעת שגיאה. גם טקסט שחוזר מימות לא מועבר לטלפון.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineInt, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const { requireStaff, inputObject } = require('./lib/roles');

const TZ = 'Asia/Jerusalem';
const YEMOT_API_KEY = defineSecret('YEMOT_API_KEY');
const YEMOT_API_BASE = defineString('YEMOT_API_BASE', { default: 'https://www.call2all.co.il/ym/api/', description: 'כתובת ה-API של ימות המשיח' });
const YEMOT_EXT = defineString('YEMOT_EXT', { default: '2', description: 'שלוחת המבצעים בקו' });
const YEMOT_TZINTUK_LIST = defineString('YEMOT_TZINTUK_LIST', { default: 'mivtzaim', description: 'רשימת הצינתוקים של המבצעים' });
const YEMOT_EMPLOYEE_DAILY = defineInt('YEMOT_EMPLOYEE_DAILY', { default: 1, description: 'שליחות עם צינתוק ביום לעובד (למנהל אין הגבלה)' });
const YEMOT_MAX_DAYS = defineInt('YEMOT_MAX_DAYS', { default: 60, description: 'כמה ימים קדימה מותר תאריך הורדה' });
const YEMOT_TEXT_MAX = defineInt('YEMOT_TEXT_MAX', { default: 400, description: 'אורך מרבי לנוסח (תווים)' });
const YEMOT_TIMEOUT_MS = defineInt('YEMOT_TIMEOUT_MS', { default: 15000, description: 'זמן המתנה מרבי לכל קריאה לימות' });

const PROMOS = 'yemot_promos';
const USAGE = 'yemot_usage';
const STATE = 'yemot_state/line';
const ACTIVE = ['live', 'remove-failed'];

// ---------------- תאריכים (שעון ישראל) ----------------
function israelDay(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
}
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function validDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const heDate = (day) => day.split('-').reverse().join('/');

// ---------------- ניקוי קלט ----------------
// תווי בקרה, סימני כיווניות ותווים בלתי נראים יוצאים; שורות חדשות → רווח; ₪ → "שקלים" (המנוע הקולי לא תמיד מקריא את הסימן).
function cleanText(s) {
  return String(s)
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, ' ')
    .replace(/₪/g, ' שקלים ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bad(reason, message, extra) { return new HttpsError('invalid-argument', message, Object.assign({ reason }, extra || {})); }

function validateSend(input, today, cfg) {
  const { requestId, text, until, source } = input;
  const warnings = [];
  let withTzintuk = input.withTzintuk;
  // ברירת מחדל בטוחה: בלי צינתוק (לא עולה יחידות ולא מצלצל לנרשמים). האפליקציה אמורה לשלוח את השדה תמיד.
  if (withTzintuk === undefined) { withTzintuk = false; warnings.push('with-tzintuk-missing'); }
  if (typeof withTzintuk !== 'boolean') throw bad('bad-input', 'קלט לא תקין');
  const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
  if (typeof requestId !== 'string' || !ID_RE.test(requestId)) throw bad('bad-request-id', 'הבקשה לא תקינה. נסו שוב.');
  let promoKey = input.promoKey;
  if (promoKey === undefined) { promoKey = requestId; warnings.push('promo-key-missing'); }
  if (typeof promoKey !== 'string' || !ID_RE.test(promoKey)) throw bad('bad-promo-key', 'הבקשה לא תקינה. נסו שוב.');
  if (typeof text !== 'string') throw bad('empty-text', 'הנוסח ריק. כתבו מה יוקרא בקו.');
  const clean = cleanText(text);
  if (!clean) throw bad('empty-text', 'הנוסח ריק. כתבו מה יוקרא בקו.');
  if (clean.length > cfg.textMax) throw bad('text-too-long', `הנוסח ארוך מדי (עד ${cfg.textMax} תווים).`, { max: cfg.textMax });
  if (!validDay(until)) throw bad('bad-date', 'תאריך ההורדה לא תקין.');
  if (until < today) throw bad('date-past', 'תאריך ההורדה כבר עבר.');
  if (until > addDays(today, cfg.maxDays)) throw bad('date-too-far', `אפשר להשאיר מבצע בקו עד ${cfg.maxDays} ימים.`, { max: cfg.maxDays });
  let src = null;
  if (source !== undefined && source !== null) {
    if (typeof source !== 'object' || Array.isArray(source) || !['p8', 'p2', 'p1'].includes(source.size)
      || !Number.isInteger(source.index) || source.index < 0 || source.index > 9999
      || (source.name !== undefined && typeof source.name !== 'string')) throw bad('bad-input', 'קלט לא תקין');
    src = { size: source.size, index: source.index, name: cleanText(source.name || '').slice(0, 80) };
  }
  return { requestId, promoKey, text: clean, until, withTzintuk, source: src, warnings };
}

// ---------------- לקוח ימות ----------------
class YemotError extends Error {
  constructor(code, sent) { super('yemot:' + code); this.code = code; this.sent = !!sent; }
}

function apiBase(raw) {
  const base = String(raw || '').replace(/\/+$/, '') + '/';
  let u; try { u = new URL(base); } catch (e) { throw new YemotError('bad-base', false); }
  // הגנה: באמולטור מותר לפנות רק לשרת דמה מקומי, אף פעם לא לימות האמיתי.
  if (process.env.FUNCTIONS_EMULATOR === 'true' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new YemotError('emulator-non-local', false);
  if (u.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new YemotError('insecure-base', false);
  return base;
}

// קריאה אחת ל-API. המפתח רק בכותרת. כל responseStatus שאינו OK = כשל. לא מחזירים את טקסט השגיאה של ימות.
async function yemotCall(ctx, command, params) {
  let r;
  try {
    r = await fetch(ctx.base + command, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: ctx.key },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    // בפסק זמן ייתכן שהבקשה כבר הגיעה לימות ובוצעה – "לא ודאי"
    throw new YemotError(timeout ? 'timeout' : 'network', timeout);
  }
  let j = null;
  try { j = await r.json(); } catch (e) { throw new YemotError('bad-json', true); }
  if (!r.ok) throw new YemotError('http-' + r.status, true);
  if (!j || j.responseStatus !== 'OK') throw new YemotError('status-' + String((j && j.responseStatus) || 'none').slice(0, 20), true);
  return j;
}

function readCfg() {
  return {
    ext: YEMOT_EXT.value(), list: YEMOT_TZINTUK_LIST.value(), daily: YEMOT_EMPLOYEE_DAILY.value(),
    maxDays: YEMOT_MAX_DAYS.value(), textMax: YEMOT_TEXT_MAX.value(), timeoutMs: YEMOT_TIMEOUT_MS.value(),
  };
}

// מספרי הקבצים (3 ספרות) שקיימים כרגע בשלוחה, מכל סוג קובץ
async function lineNumbers(ctx, ext) {
  const j = await yemotCall(ctx, 'GetIVR2Dir', { path: ext });
  const nums = new Set();
  for (const f of Array.isArray(j.files) ? j.files : []) {
    const m = /^(\d{3})\.[A-Za-z0-9]+$/.exec(String((f && f.name) || ''));
    if (m) nums.add(Number(m[1]));
  }
  return nums;
}

// ---------------- מכסה יומית לצינתוק (עובד בלבד) ----------------
function usageView(snap, day, limit) {
  const used = snap.exists && snap.get('day') === day ? (snap.get('count') || 0) : 0;
  return { day, used, limit, allowed: used < limit };
}
async function refundUsage(db, uid, day) {
  const ref = db.doc(`${USAGE}/${uid}`);
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.exists && s.get('day') === day && (s.get('count') || 0) > 0) tx.update(ref, { count: s.get('count') - 1, updatedAt: new Date().toISOString() });
    });
  } catch (e) { logger.error('yemot: refund failed', { reason: 'refund-failed' }); }
}

// ---------------- בחירת מספר קובץ (בטרנזקציה, בלי התנגשות בין מקבילים) ----------------
// n = max(nextNum, 1 + המספר הגבוה בשלוחה). מעל 999: המספר הפנוי הקטן ביותר מ-001. לעולם לא 000.
// recent = 20 המספרים האחרונים שהוקצו, כדי ששני מקבילים לא יבחרו אותו מספר פנוי גם כשהשלוחה כמעט מלאה.
async function allocateNumber(db, onLine, promoRef, ext) {
  const stateRef = db.doc(STATE);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(stateRef);
    const nextNum = (s.exists && Number(s.get('nextNum'))) || 1;
    const recent = (s.exists && Array.isArray(s.get('recent')) ? s.get('recent') : []).map(Number);
    const maxOn = onLine.size ? Math.max(...onLine) : 0;
    let n = Math.max(nextNum, maxOn + 1, 1);
    if (n > 999) {
      n = 0;
      for (let c = 1; c <= 999; c++) if (!onLine.has(c) && !recent.includes(c)) { n = c; break; }
      if (!n) throw new HttpsError('resource-exhausted', 'אין מקום לעוד מבצעים בשלוחה. פנו למנהל.', { reason: 'line-full' });
    }
    const file = String(n).padStart(3, '0') + '.tts';
    const now = new Date().toISOString();
    tx.set(stateRef, { nextNum: n + 1, recent: recent.concat(n).slice(-20), updatedAt: now });
    tx.update(promoRef, { file, path: `ivr2:${ext}/${file}`, updatedAt: now });
    return file;
  });
}

// ---------------- sendPromoToLine ----------------
// מפתח מבצע (promoKey): מזהה קבוע של המבצע מהאפליקציה. לכל promoKey יש רשומה אחת ב-yemot_promos/{promoKey}
// וקובץ אחד בקו. ניסיון חוזר לא מעלה קובץ נוסף:
//   אותו נוסח, הקובץ כבר בקו, הצינתוק לא נשלח או נכשל → רק צינתוק (action 'tzintuk-only').
//   נוסח אחר → מחליפים את הקובץ הקיים באותו נתיב (action 'replaced').
//   אותו נוסח והצינתוק כבר נשלח (או שלא ביקשו צינתוק) → שום פנייה לימות, רק עדכון תאריך ההורדה (action 'none').
// requestId: מזהה של לחיצה אחת. אותו requestId פעמיים = אותה בקשה (duplicate:true).
const LOCK_MS = 120000; // שליחה "בטיפול": שתי שליחות של אותו מבצע לא רצות במקביל
// נעילה פעילה = שליחה אחרת של אותו מבצע רצה עכשיו. נעילה ישנה מ-LOCK_MS = השליחה נתקעה/קרסה, ואפשר להמשיך.
function isLocked(x, nowMs) { return !!(x && x.lockAt && nowMs - Date.parse(x.lockAt) < LOCK_MS); }
// האם ייתכן שהקובץ של הרשומה נמצא בקו (גם אם לא בוודאות)
function holdsPath(x) {
  return !!(x && x.path && (ACTIVE.includes(x.status) || x.status === 'uploading' || (x.status === 'failed' && x.uncertain)));
}
// תאריך ההורדה האפקטיבי: אם יש העלאה לא ודאית (pending), התאריך המוקדם מבין מה שבקו למה שאולי עלה
function effectiveUntil(x) {
  const a = x.until, b = x.pending && x.pending.until;
  if (typeof b !== 'string') return a;
  if (typeof a !== 'string') return b;
  return a < b ? a : b;
}
// הזרקת תקלה לבדיקות: פעילה רק באמולטור (בפרסום אמיתי לא קוראת כלום)
async function testFault(db, at) {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') return;
  const f = await db.doc('yemot_test/fault').get();
  if (f.exists && f.get('at') === at) throw new Error('test fault ' + at);
}

async function sendPromo(request, key, base) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const cfg = readCfg();
  const db = getFirestore();
  const today = israelDay();
  const usageRef = db.doc(`${USAGE}/${who.uid}`);
  const isEmp = who.role === 'employee';
  const todayView = async () => (isEmp ? usageView(await usageRef.get(), today, cfg.daily) : { day: today, used: null, limit: null, allowed: true });

  // מצב בלבד: האם אפשר עוד לשלוח צינתוק היום. בלי פנייה לימות.
  if (input.statusOnly === true) return { ok: true, statusOnly: true, role: who.role, tzintukToday: await todayView() };

  const v = validateSend(input, today, cfg);
  if (v.warnings.length) logger.warn('yemot: request warning', { warnings: v.warnings, requestId: v.requestId });
  if (!key) throw new HttpsError('failed-precondition', 'הקו הטלפוני עוד לא מחובר בשרת. פנו למנהל.', { reason: 'no-key' });
  let ctx;
  try { ctx = { key, base: apiBase(base), timeoutMs: cfg.timeoutMs }; } catch (e) {
    logger.error('yemot: bad api base', { reason: e.code });
    throw new HttpsError('failed-precondition', 'הקו הטלפוני עוד לא מחובר בשרת. פנו למנהל.', { reason: 'no-key' });
  }
  const promoRef = db.doc(`${PROMOS}/${v.promoKey}`);

  // 1. טרנזקציה: נעילת המבצע, החלטה מה לעשות, ו(לעובד, אם יישלח צינתוק) תפיסת המכסה היומית.
  // הרשומה מתארת את מה שבאמת בקו: text/until/tzintuk משתנים רק אחרי שהפעולה בימות הצליחה.
  // בזמן העלאה הנוסח והתאריך המבוקשים נשמרים ב-pending; אם התוצאה לא ודאית, ההורדה משתמשת בתאריך המוקדם מבין השניים.
  const plan = await db.runTransaction(async (tx) => {
    const p = await tx.get(promoRef);
    const u = isEmp && v.withTzintuk ? await tx.get(usageRef) : null;
    const x = p.exists ? p.data() : null;
    const nowMs = Date.now();
    if (isLocked(x, nowMs)) throw new HttpsError('aborted', 'השליחה של המבצע הזה כבר בטיפול. נסו שוב בעוד רגע.', { reason: 'busy' });
    // כפילות רק אם אותה בקשה כבר הסתיימה בהצלחה מלאה. בקשה שנכשלה (גם חלקית) – מנסים שוב את מה שנכשל.
    if (x && x.lastRequestId === v.requestId && x.lastResult === 'done') return { kind: 'duplicate', x };
    const onLine = holdsPath(x, nowMs);
    const sameText = onLine && ACTIVE.includes(x.status) && x.text === v.text;
    const upload = !sameText;
    const doTz = v.withTzintuk && !(sameText && x.tzintuk === 'sent');
    const now = new Date(nowMs).toISOString();
    const who2 = { withTzintuk: v.withTzintuk, byUid: who.uid, byRole: who.role, day: today, updatedAt: now };
    if (v.source) who2.source = v.source;
    if (!upload && !doTz) {
      tx.update(promoRef, Object.assign(who2, { until: v.until, lastRequestId: v.requestId, lastResult: 'done' },
        x.status === 'remove-failed' && v.until >= today ? { status: 'live', error: null } : {}));
      return { kind: 'none', x, untilChanged: x.until !== v.until };
    }
    let usage = null;
    if (isEmp && doTz) {
      const uv = usageView(u, today, cfg.daily);
      if (!uv.allowed) {
        throw new HttpsError('resource-exhausted', 'כבר שלחת היום מבצע עם צינתוק. אפשר להעלות לקו בלי צינתוק, לשלוח שוב מחר, או לבקש ממנהל.',
          { reason: 'daily-limit', limit: cfg.daily, used: uv.used });
      }
      tx.set(usageRef, { day: today, count: uv.used + 1, updatedAt: now });
      usage = { day: today };
    }
    const rec = Object.assign(who2, { lockAt: now, lockReq: v.requestId });
    if (upload) rec.pending = { text: v.text, until: v.until, at: now };
    else rec.until = v.until; // רק צינתוק: הנוסח בקו זהה, אז התאריך החדש מתאים למה שבקו
    if (!onLine) {
      // אין קובץ של המבצע בקו: רשומה "חדשה". until כבר עכשיו – כדי שאם משהו ייתקע, ההורדה תנקה בזמן
      Object.assign(rec, { text: null, file: null, path: null, status: 'uploading', until: v.until, removedAt: null, error: null, uncertain: false, tzintuk: 'skipped' });
      if (!x) Object.assign(rec, { createdAt: now, createdBy: who.uid });
    }
    tx.set(promoRef, rec, { merge: true });
    return { kind: 'work', x, onLine, upload, doTz, usage, replacing: upload && onLine && ACTIVE.includes(x.status) };
  });

  if (plan.kind === 'duplicate' || plan.kind === 'none') {
    const d = plan.kind === 'none' ? Object.assign({}, plan.x, { until: v.until }) : plan.x;
    const msg = plan.kind === 'duplicate' ? 'המבצע הזה כבר נשלח.'
      : `המבצע כבר בקו עם אותו נוסח${d.tzintuk === 'sent' && v.withTzintuk ? ', והצינתוק כבר נשלח' : ''}.${plan.untilChanged ? ` תאריך ההורדה עודכן: יושמע עד ${heDate(v.until)}.` : ''}`;
    return {
      ok: true, id: v.promoKey, promoKey: v.promoKey, requestId: v.requestId, action: 'none', file: d.file, until: d.until,
      withTzintuk: v.withTzintuk, tzintuk: plan.kind === 'none' && !v.withTzintuk ? 'skipped' : d.tzintuk,
      role: who.role, usage: null, tzintukToday: await todayView(), duplicate: plan.kind === 'duplicate', warnings: v.warnings, message: msg,
    };
  }

  const usageDay = plan.usage ? plan.usage.day : null;
  const stamp = () => new Date().toISOString();
  // סיום הבקשה: שחרור הנעילה ורישום התוצאה של requestId ('done' = הצליח הכול, אחרת ינוסה שוב)
  const finish = (result, extra) => promoRef.update(Object.assign({ lockAt: null, lockReq: null, lastRequestId: v.requestId, lastResult: result, updatedAt: stamp() }, extra || {}));
  let file = plan.onLine ? plan.x.file : null;
  let path = plan.onLine ? plan.x.path : null;
  let action = 'tzintuk-only';
  let tzSent = false;
  let uploaded = !plan.upload;

  try {
    // 2. העלאה: לנתיב הקיים של המבצע (החלפה / השלמה של העלאה שנתקעה), או למספר פנוי חדש
    if (plan.upload) {
      action = plan.replacing ? 'replaced' : 'uploaded';
      const failUpload = async (code, uncertain) => {
        if (usageDay) await refundUsage(db, who.uid, usageDay);
        // כשל ודאי: הקובץ בקו (אם יש) לא השתנה – pending נמחק, text/until נשארים כמו שהם.
        // כשל לא ודאי (פסק זמן): pending נשאר, וההורדה תשתמש בתאריך המוקדם מבין הישן והחדש.
        const extra = { error: code };
        if (!uncertain) extra.pending = null;
        if (!plan.replacing) Object.assign(extra, { status: 'failed', uncertain: !!uncertain || !!(plan.onLine && plan.x.uncertain) || (plan.onLine && plan.x.status === 'uploading') });
        await finish('failed', extra);
        logger.warn('yemot: upload failed', { reason: 'yemot-upload-failed', code, requestId: v.requestId });
        return new HttpsError('unavailable', 'העלאת ההודעה לקו נכשלה' + (v.withTzintuk ? ', ולא נשלח צינתוק' : '') + '. נסו שוב מאוחר יותר.', { reason: 'yemot-upload-failed' });
      };
      try {
        if (path) {
          // הגנה: אם רשומה אחרת "מחזיקה" את אותו נתיב (למשל מספר שהוקצה מחדש) – לא דורסים, מקצים מספר חדש
          const other = await db.collection(PROMOS).where('path', '==', path).get();
          if (other.docs.some((d) => d.id !== v.promoKey && holdsPath(d.data(), Date.now()))) { path = null; file = null; action = 'uploaded'; }
        }
        if (!path) {
          const nums = await lineNumbers(ctx, cfg.ext);
          file = await allocateNumber(db, nums, promoRef, cfg.ext);
          path = `ivr2:${cfg.ext}/${file}`;
        }
      } catch (e) {
        if (e instanceof HttpsError) {
          if (usageDay) await refundUsage(db, who.uid, usageDay);
          await finish('failed', Object.assign({ pending: null, error: (e.details && e.details.reason) || 'internal' }, plan.replacing ? {} : { status: 'failed' }));
          throw e;
        }
        throw await failUpload(e instanceof YemotError ? 'dir-' + e.code : 'internal', false);
      }
      try {
        await yemotCall(ctx, 'UploadTextFile', { what: path, contents: v.text });
      } catch (e) {
        throw await failUpload(e instanceof YemotError ? 'upload-' + e.code : 'internal', e instanceof YemotError && e.sent && e.code === 'timeout');
      }
      uploaded = true;
      await testFault(db, 'after-upload');
      // הצינתוק הקודם שייך לנוסח הקודם
      await promoRef.update({ status: 'live', text: v.text, until: v.until, file, path, pending: null, uncertain: false, error: null, removedAt: null, tzintuk: 'skipped', updatedAt: stamp() });
    }

    // 3. צינתוק. כשל: ההודעה נשארת בקו, והמכסה של העובד מוחזרת (נספר רק צינתוק שהצליח). ניסיון חוזר = רק צינתוק.
    let tz = plan.doTz ? 'pending' : (plan.upload ? 'skipped' : plan.x.tzintuk);
    if (plan.doTz) {
      try {
        await yemotCall(ctx, 'RunTzintuk', { phones: 'tzl:' + cfg.list });
        tz = 'sent'; tzSent = true;
      } catch (e) {
        tz = 'failed';
        if (usageDay) await refundUsage(db, who.uid, usageDay);
        logger.warn('yemot: tzintuk failed', { reason: 'tzintuk-failed', code: e instanceof YemotError ? e.code : 'internal', requestId: v.requestId });
      }
    }
    await finish(tz === 'failed' ? 'partial' : 'done', Object.assign({ tzintuk: tz }, tz === 'sent' ? { tzintukAt: stamp() } : {}));

    const tToday = await todayView();
    const end = `המבצע יושמע בקו עד ${heDate(v.until)}.`;
    const head = action === 'replaced' ? 'הנוסח של המבצע בקו הוחלף' : action === 'tzintuk-only' ? 'המבצע כבר היה בקו' : 'המבצע עלה לקו';
    const tzPart = tz === 'sent' ? (action === 'tzintuk-only' ? ', ועכשיו נשלח צינתוק לנרשמים.' : ' ונשלח צינתוק לנרשמים.')
      : tz === 'failed' ? `, אבל הצינתוק לנרשמים לא נשלח${isEmp ? ' (ולא נספר במכסה היומית)' : ''}. אפשר לנסות שוב – הקובץ לא יועלה פעמיים.`
        : (v.withTzintuk ? '.' : ' בלי צינתוק.');
    return {
      ok: true, id: v.promoKey, promoKey: v.promoKey, requestId: v.requestId, action, file, until: v.until, withTzintuk: v.withTzintuk, tzintuk: tz,
      role: who.role, usage: isEmp && plan.doTz ? tToday : null, tzintukToday: tToday, duplicate: false, warnings: v.warnings, message: `${head}${tzPart} ${end}`,
    };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // חריגה פנימית (לא מימות): מחזירים מכסה שלא נוצלה, משחררים נעילה, ומסמנים "לא ודאי" כדי שההורדה תנקה את הקובץ אם הוא בקו
    try {
      if (usageDay && !tzSent) await refundUsage(db, who.uid, usageDay);
      const cur = await promoRef.get();
      const extra = { error: 'internal', uncertain: true };
      if (cur.exists && cur.get('status') === 'uploading') extra.status = 'failed';
      await finish('failed', extra);
    } catch (e2) { logger.error('yemot: cleanup failed', { reason: 'cleanup-failed' }); }
    throw e;
  }
}

exports.sendPromoToLine = onCall({ secrets: [YEMOT_API_KEY], timeoutSeconds: 60 }, async (request) => {
  try {
    return await sendPromo(request, YEMOT_API_KEY.value(), YEMOT_API_BASE.value());
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('yemot: send failed', { reason: 'internal', name: e && e.name });
    throw new HttpsError('internal', 'שגיאה בשליחה לקו.', { reason: 'internal' });
  }
});

// ---------------- הורדת מבצעים שפג תוקפם ----------------
// מוחקת רק path שרשום ב-yemot_promos, בפורמט ivr2:<שלוחה>/NNN.tts עם NNN בין 001 ל-999, שתוקפו (until) לפני היום.
// קובץ שכבר לא קיים בשלוחה – מסומן removed בלי מחיקה. מחיקה שנכשלה – remove-failed, וניסיון חוזר בריצה הבאה.
async function runExpiry(opts) {
  const o = opts || {};
  const db = getFirestore();
  const today = israelDay(o.now);
  const ext = String(o.ext || YEMOT_EXT.value());
  const key = o.key !== undefined ? o.key : YEMOT_API_KEY.value();
  const base = o.base !== undefined ? o.base : YEMOT_API_BASE.value();
  const out = { today, checked: 0, removed: 0, missing: 0, failed: 0, skipped: 0 };
  if (!key) { logger.error('yemot: expiry without key', { reason: 'no-key' }); return Object.assign(out, { error: 'no-key' }); }
  const ctx = { key, base: apiBase(base), timeoutMs: o.timeoutMs || YEMOT_TIMEOUT_MS.value() };
  const nowMs = Date.now();
  const snap = await db.collection(PROMOS).where('status', 'in', ACTIVE.concat('failed', 'uploading')).get();
  // רשומה שאולי יש לה קובץ בקו, שאינה באמצע שליחה, ושתאריך ההורדה האפקטיבי שלה עבר.
  // (העלאה שנכשלה בוודאות – אין מה למחוק; uploading עם נעילה ישנה = שליחה שנתקעה – מנקים)
  const isDue = (x) => holdsPath(x) && !isLocked(x, nowMs) && typeof effectiveUntil(x) === 'string' && effectiveUntil(x) < today;
  const due = snap.docs.filter((d) => isDue(d.data()));
  // נתיב שרשומה אחרת (שלא יורדת עכשיו) מחזיקה – לא מוחקים, כדי לא למחוק מבצע חדש שקיבל את אותו מספר
  const keep = new Set(snap.docs.filter((d) => holdsPath(d.data()) && !isDue(d.data())).map((d) => d.get('path')));
  out.checked = due.length;
  if (!due.length) return out;
  let onLine;
  try { onLine = await lineNumbers(ctx, ext); } catch (e) {
    logger.error('yemot: expiry dir failed', { reason: 'dir-failed', code: e.code });
    return Object.assign(out, { error: 'dir-failed' });
  }
  const re = new RegExp(`^ivr2:${ext.replace(/[^0-9A-Za-z/]/g, '')}/(\\d{3})\\.tts$`);
  for (const d of due) {
    const x = d.data();
    const m = re.exec(String(x.path || ''));
    const now = new Date().toISOString();
    if (!m || Number(m[1]) < 1) { out.skipped++; continue; } // לעולם לא 000 ולא נתיב שלא אנחנו יצרנו
    if (keep.has(x.path)) { await d.ref.update({ status: x.status === 'failed' || x.status === 'uploading' ? 'failed' : 'removed', uncertain: false, pending: null, removedAt: now, updatedAt: now, error: 'path-reused' }); out.skipped++; continue; }
    const unsure = x.status === 'failed' || x.status === 'uploading';
    if (!onLine.has(Number(m[1]))) {
      await d.ref.update({ status: unsure ? 'failed' : 'removed', removedAt: now, updatedAt: now, uncertain: false, pending: null, error: unsure ? x.error || 'internal' : 'already-missing' });
      out.missing++; continue;
    }
    try {
      const j = await yemotCall(ctx, 'FileAction', { action: 'delete', what: x.path });
      if (j.success === false) throw new YemotError('delete-false', true);
      await d.ref.update({ status: 'removed', removedAt: now, updatedAt: now, uncertain: false, pending: null });
      out.removed++;
    } catch (e) {
      // מחיקה שנכשלה: remove-failed, וניסיון חוזר בריצה הבאה (גם לרשומה שהייתה uploading/failed)
      await d.ref.update({ status: 'remove-failed', error: 'delete-' + (e.code || 'internal'), updatedAt: now });
      out.failed++;
    }
  }
  logger.info('yemot: expiry done', out);
  return out;
}

exports.expirePromosOnLine = onSchedule({ schedule: 'every day 00:15', timeZone: TZ, secrets: [YEMOT_API_KEY] }, async () => { await runExpiry(); });

// לבדיקות בלבד. לא נספרים (enumerable: false), ולכן Object.assign ב-index.js מעתיק רק את שתי הפונקציות.
Object.defineProperty(exports, 'runExpiry', { enumerable: false, value: runExpiry });
Object.defineProperty(exports, '_test', { enumerable: false, value: { israelDay, addDays, cleanText, validDay } });
