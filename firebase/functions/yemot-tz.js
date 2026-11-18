'use strict';
// שליחת צינתוק מהמסך "שלוחות הקו" בלי מבצע (משימה 2026-11-18).
//   sendLineTzintuk – מנהל בלבד. קלט { action:'preview'|'send', target:'fb'|'all', requestId }.
//     target 'fb'  – צינתוק בתשלום רק ללקוחות המשוב (רשימת התפוצה "לקוחות משוב", לא חסומים), גם למי שברשימה החינמית.
//     target 'all' – RunTzintuk tzl:<רשימה חינמית> (חינם), ובנוסף צינתוק בתשלום ללקוחות משוב שאינם ברשימה החינמית. כל מספר מקבל אחד.
//     preview – רק קריאה (כמה יקבלו, עלות משוערת). לא שולח.
//     send    – שולח. אותו requestId שוב = לא שולח (מחזיר את מה שנרשם). שליחה אחת בכל רגע (נעילה ב-yemot_state/tzsend).
// הצינתוק בתשלום – דרך fbTzintuk מ-yemot.js (קבוצות של 500, רישום מה נשלח, pending/uncertain בלי שליחה חוזרת, מכסה YEMOT_FB_TZ_MAX,
// מונה חודשי fblist.tzMonth). רשומה לכל שליחה: yemot_tzsend/{requestId} (רק השרת קורא וכותב).
// עלות: 0.1 יחידה לכל מספר בתשלום – לפי התיעוד של ימות (לא מאומת). המפתח רק בכותרת (yemot-client), לא ביומן ולא בתשובה.

const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const roles = require('./lib/roles');
const T = require('./lib/tenant');
const { inputObject } = roles;
const { YemotError, apiBase, yemotCall, getTemplateEntries, tzlEntries } = require('./lib/yemot-client');
const Y = require('./yemot').shared;
const { normPhone } = require('./yemot-fblist')._core;

const YEMOT_API_KEY = defineSecret('YEMOT_API_KEY');
const YEMOT_API_BASE = defineString('YEMOT_API_BASE', { default: 'https://www.call2all.co.il/ym/api/', description: 'כתובת ה-API של ימות המשיח' });

const requireStaff = (request) => roles.requireStaff(request, { feature: 'yemot', yemotLine: true });
const SENDS = 'yemot_tzsend';
const LOCK = 'yemot_state/tzsend';
const LOCK_MS = 6 * 60 * 1000; // ארוך מזמן הריצה המרבי (300 שניות); נעילה של ריצה שקרסה משתחררת אחריו
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UNIT = 0.1; // יחידות לכל מספר בתשלום – לפי התיעוד של ימות (לא מאומת)
const cost = (n) => Math.round(n * UNIT * 100) / 100;
const bad = () => new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-input' });

// כמה יקבלו: free = מספרים ברשימה החינמית (רק ב-all), paid = לקוחות משוב לא חסומים (ב-all – פחות מי שברשימה החינמית)
async function counts(ctx, cfg, fbs, target) {
  const tplId = fbs.templateId;
  const fb = Number.isInteger(tplId) && tplId > 0
    ? [...new Set((await getTemplateEntries(ctx, tplId)).filter((e) => !e.blocked).map((e) => normPhone(e.phone)).filter(Boolean))] : [];
  let free = 0, paid = fb.length;
  if (target === 'all') {
    const raw = await tzlEntries(ctx, cfg.list);
    const subs = new Set(raw.map((p) => normPhone(p) || p));
    free = subs.size;
    paid = fb.filter((p) => !subs.has(p)).length;
  }
  return { free, paid, total: free + paid, cost: cost(paid), max: cfg.fbTzMax, capped: paid > cfg.fbTzMax, listReady: Number.isInteger(tplId) && tplId > 0 };
}

// "ודאי שלא יצא" – כמו בצינתוק ללקוחות משוב במבצע: שגיאה בלי sent, ובשגיאת רשת רק כשלא נוצר חיבור
const certainFail = (e) => e instanceof YemotError && !e.sent && (e.code !== 'network' || Y.NO_CONNECT.has(e.netCode));

function view(rec, duplicate) {
  const r = rec.result || {};
  return Object.assign({ ok: true, requestId: rec.requestId, target: rec.target, status: rec.status, duplicate: !!duplicate,
    sent: 0, failed: 0, uncertain: 0, paidSent: 0, cost: 0, warnings: [] }, r);
}

async function run(request, key, base) {
  const who = await requireStaff(request);
  // מנהל בלבד – נבדק לפני כל פנייה לימות
  if (who.role !== 'manager') throw new HttpsError('permission-denied', 'רק מנהל יכול לשלוח צינתוק.', { reason: 'manager-only' });
  const input = inputObject(request);
  if (!['preview', 'send'].includes(input.action) || !['fb', 'all'].includes(input.target)) throw bad();
  if (input.action === 'send' && (typeof input.requestId !== 'string' || !ID_RE.test(input.requestId))) throw new HttpsError('invalid-argument', 'הבקשה לא תקינה. נסו שוב.', { reason: 'bad-request-id' });
  if (!key) throw new HttpsError('failed-precondition', 'הקו הטלפוני עוד לא מחובר בשרת. פנו למנהל.', { reason: 'no-key' });
  let ctx;
  const cfg = Y.readCfg();
  try { ctx = { key, base: apiBase(base), timeoutMs: cfg.timeoutMs }; } catch (e) {
    throw new HttpsError('failed-precondition', 'הקו הטלפוני עוד לא מחובר בשרת. פנו למנהל.', { reason: 'no-key' });
  }
  const db = T.tdb();
  const target = input.target;
  const fbs = (await db.doc(Y.FBLIST).get()).data() || {};
  const readFail = (e) => {
    logger.warn('yemot-tz: read failed', { reason: 'read-failed', code: e instanceof YemotError ? e.code : 'internal' });
    return new HttpsError('unavailable', 'לא הצלחנו לקרוא את הרשימות מימות. לא נשלח צינתוק. נסו שוב מאוחר יותר.', { reason: 'read-failed' });
  };

  if (input.action === 'preview') {
    try { return Object.assign({ ok: true, target }, await counts(ctx, cfg, fbs, target)); } catch (e) { throw readFail(e); }
  }

  // ---------- send ----------
  const requestId = input.requestId;
  const recRef = db.doc(`${SENDS}/${requestId}`);
  const lockRef = db.doc(LOCK);
  const now = new Date().toISOString();
  const got = await db.runTransaction(async (tx) => {
    const [r, l] = await Promise.all([tx.get(recRef), tx.get(lockRef)]);
    // ניסיון חוזר עם אותו מזהה – לא שולחים שוב. חריג: 'not-sent' (קריאת הרשימות נכשלה לפני כל שליחה) – מותר לנסות שוב.
    if (r.exists && r.get('status') !== 'not-sent') return { dup: r.data() };
    const lx = l.exists ? l.data() : {};
    if (lx.lockAt && Date.now() - Date.parse(lx.lockAt) < LOCK_MS) return { busy: true };
    tx.set(lockRef, { lockAt: now, requestId }, { merge: true });
    tx.set(recRef, { requestId, target, status: 'sending', byUid: who.uid, at: now });
    return {};
  });
  if (got.busy) throw new HttpsError('failed-precondition', 'שליחת צינתוק אחרת בטיפול. נסו שוב בעוד כמה דקות.', { reason: 'busy' });
  if (got.dup) {
    const d = got.dup;
    // הריצה הקודמת לא הסתיימה (או קרסה) – לא ידוע מה נשלח, ולכן לא שולחים שוב
    if (d.status === 'sending') return view(Object.assign({}, d, { status: 'uncertain', result: { warnings: ['in-progress'], message: 'השליחה הקודמת עם הבקשה הזו עוד בטיפול או נקטעה. לא נשלח שוב – בדקו בימות.' } }), true);
    return view(d, true);
  }

  const finish = async (status, result, extra) => {
    try { await recRef.update(Object.assign({ status, result, doneAt: new Date().toISOString() }, extra || {})); } catch (e) { logger.error('yemot-tz: record failed', { reason: 'record-failed' }); }
    try {
      await db.runTransaction(async (tx) => { const l = await tx.get(lockRef); if (l.exists && l.get('requestId') === requestId) tx.set(lockRef, { lockAt: null }, { merge: true }); });
    } catch (e) { logger.error('yemot-tz: unlock failed', { reason: 'unlock-failed' }); }
    return view({ requestId, target, status, result }, false);
  };

  // 1. בדיקה מקדימה: כמה, ומכסה. מעל המכסה – לא שולחים כלום (גם לא את החינמי), ומזהירים.
  let pre;
  try { pre = await counts(ctx, cfg, fbs, target); } catch (e) {
    await finish('not-sent', { sent: 0, failed: 0, uncertain: 0, warnings: ['read-failed'], message: 'לא הצלחנו לקרוא את הרשימות מימות. לא נשלח צינתוק.' });
    throw readFail(e);
  }
  if (pre.capped) {
    return finish('capped', { sent: 0, failed: 0, uncertain: 0, paidSent: 0, cost: 0, free: pre.free, paid: pre.paid, max: pre.max, warnings: ['fb-tz-capped'],
      message: `לא נשלח צינתוק: ${pre.paid} מספרים בתשלום – מעל המכסה (${pre.max}).` });
  }

  // 2. החינמי (רק ב-all): tzl:<רשימה>
  let freeSt = null;
  if (target === 'all' && pre.free > 0) {
    await recRef.update({ freeTz: 'pending' });
    try {
      await yemotCall(ctx, 'RunTzintuk', { phones: 'tzl:' + cfg.list });
      freeSt = 'sent';
    } catch (e) {
      freeSt = certainFail(e) ? 'failed' : 'uncertain';
      logger.warn('yemot-tz: free tzintuk failed', { reason: 'free-tz-' + freeSt, code: e instanceof YemotError ? e.code : 'internal' });
    }
    try { await recRef.update({ freeTz: freeSt }); } catch (e) { logger.error('yemot-tz: record failed', { reason: 'record-failed' }); }
  }

  // 3. בתשלום: לקוחות המשוב (ב-all – רק מי שאינו ברשימה החינמית). קבוצות, רישום ו-uncertain – ב-fbTzintuk.
  const fb = await Y.fbTzintuk(db, ctx, cfg, fbs, recRef, [], null, { keepFree: target === 'fb' });
  const paidTotal = fb.st === 'capped' ? 0 : fb.total;
  const paidLeft = Math.max(0, paidTotal - fb.sent.length);
  const freeN = freeSt ? pre.free : 0;
  const res = {
    free: freeN, freeTz: freeSt, paid: paidTotal, paidTz: fb.st, paidSent: fb.sent.length, cost: cost(fb.sent.length),
    sent: (freeSt === 'sent' ? freeN : 0) + fb.sent.length,
    failed: (freeSt === 'failed' ? freeN : 0) + (['failed', 'partial'].includes(fb.st) ? paidLeft : 0),
    uncertain: (freeSt === 'uncertain' ? freeN : 0) + (fb.st === 'uncertain' ? paidLeft : 0),
    warnings: fb.st === 'capped' ? ['fb-tz-capped'] : [],
  };
  const status = res.uncertain ? 'uncertain' : res.failed ? (res.sent ? 'partial' : 'failed') : fb.st === 'capped' ? 'capped' : 'done';
  res.message = status === 'done' ? (res.sent ? `הצינתוק נשלח ל-${res.sent} מספרים.` : 'אין למי לשלוח: הרשימות ריקות.')
    : status === 'capped' ? 'לא נשלח צינתוק בתשלום: מעל המכסה.'
      : `נשלחו ${res.sent}${res.failed ? `, נכשלו ${res.failed}` : ''}${res.uncertain ? `, לא ידוע אם נשלח ל-${res.uncertain} – בדקו בימות לפני שליחה חוזרת` : ''}.`;
  logger.info('yemot-tz: send done', { target, status, sent: res.sent, failed: res.failed, uncertain: res.uncertain });
  // כמו ב-sendPromo: מצב סופי של הבתשלום ברשומה (fbTzintuk רושם 'pending' ואת fbTzSent בדרך)
  return finish(status, res, Object.assign({ fbTz: fb.st, fbTzCount: fb.sent.length, fbTzTotal: fb.total }, fb.sent.length ? { fbTzSent: fb.sent } : {}));
}

exports.sendLineTzintuk = onCall({ secrets: [YEMOT_API_KEY], timeoutSeconds: 300 }, T.scoped(async (request) => {
  try { return await run(request, YEMOT_API_KEY.value(), YEMOT_API_BASE.value()); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('yemot-tz: call failed', { reason: 'internal', name: e && e.name });
    throw new HttpsError('internal', 'שגיאה בשליחת הצינתוק.', { reason: 'internal' });
  }
}));

Object.defineProperty(exports, '_core', { enumerable: false, value: { run, counts } });
