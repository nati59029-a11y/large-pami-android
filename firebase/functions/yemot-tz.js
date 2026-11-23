'use strict';
// שליחת צינתוק מהמסך "שלוחות הקו" בלי מבצע (משימה 2026-11-18).
//   sendLineTzintuk – מנהל בלבד. קלט { action:'preview'|'send', target:'fb'|'all', requestId }.
//     target 'fb'  – צינתוק בתשלום רק ללקוחות המשוב (רשימת התפוצה "לקוחות משוב", לא חסומים), גם למי שברשימה החינמית.
//     target 'all' – RunTzintuk tzl:<רשימה חינמית> (חינם), ובנוסף צינתוק בתשלום ללקוחות משוב שאינם ברשימה החינמית. כל מספר מקבל אחד.
//     preview – רק קריאה (כמה יקבלו, עלות משוערת). לא שולח.
//     send    – שולח. אותו requestId שוב = לא שולח (מחזיר את מה שנרשם). שליחה אחת בכל רגע (נעילה ב-yemot_state/tzsend).
//     send + resume:true (סבב 2) – "השלם את מי שלא קיבל": רק לרשומה שהסתיימה ב-'partial' או 'failed' (בלי שום חלק לא ודאי).
//       ממשיך את אותה רשומה: החינמי נשלח שוב רק אם נכשל בוודאות, והבתשלום רק למי שאינו ב-fbTzSent. בלי חיוב כפול.
//     preview מחזיר גם recent – שליחה מהשעה האחרונה (מתי, לכמה), כדי שחלון האישור יזהיר לפני שליחה חדשה לכולם.
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
const { optOut } = require('./yemot-optout');

const YEMOT_API_KEY = defineSecret('YEMOT_API_KEY');
const YEMOT_API_BASE = defineString('YEMOT_API_BASE', { default: 'https://www.call2all.co.il/ym/api/', description: 'כתובת ה-API של ימות המשיח' });

const requireStaff = (request) => roles.requireStaff(request, { feature: 'yemot', yemotLine: true });
const SENDS = 'yemot_tzsend';
const LOCK = 'yemot_state/tzsend';
const LOCK_MS = 6 * 60 * 1000; // ארוך מזמן הריצה המרבי (300 שניות); נעילה של ריצה שקרסה משתחררת אחריו
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UNIT = 0.1; // יחידות לכל מספר בתשלום – לפי התיעוד של ימות (לא מאומת)
const cost = (n) => Math.round(n * UNIT * 100) / 100;
const RECENT_MS = 60 * 60 * 1000;
const RESUMABLE = ['partial', 'failed'];
const bad = () => new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-input' });

// כמה יקבלו: free = מספרים ברשימה החינמית (רק ב-all), paid = לקוחות משוב לא חסומים (ב-all – פחות מי שברשימה החינמית).
// (משימה 2026-11-23) skipped = לקוחות משוב שיצאו מהרשימה החינמית (בעצמם או ע"י מנהל) – לא מקבלים בתשלום, בשני הסוגים.
async function counts(ctx, cfg, fbs, target, db) {
  const tplId = fbs.templateId;
  const fb = Number.isInteger(tplId) && tplId > 0
    ? [...new Set((await getTemplateEntries(ctx, tplId)).filter((e) => !e.blocked).map((e) => normPhone(e.phone)).filter(Boolean))] : [];
  const raw = await tzlEntries(ctx, cfg.list);
  const gone = (await optOut(db, ctx, cfg.list, [...new Set(raw.map((p) => normPhone(p)).filter(Boolean))])).out;
  const fbOk = fb.filter((p) => !gone.has(p));
  let free = 0, paid = fbOk.length;
  if (target === 'all') {
    const subs = new Set(raw.map((p) => normPhone(p) || p));
    free = subs.size;
    paid = fbOk.filter((p) => !subs.has(p)).length;
  }
  return { free, paid, total: free + paid, cost: cost(paid), skipped: fb.length - fbOk.length, max: cfg.fbTzMax, capped: paid > cfg.fbTzMax, listReady: Number.isInteger(tplId) && tplId > 0 };
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
    if (e instanceof YemotError && e.code === 'optout-unknown') return new HttpsError('unavailable', 'לא הצלחנו לבדוק בימות מי הסיר את עצמו מהצינתוקים. לא נשלח צינתוק. נסו שוב מאוחר יותר.', { reason: 'optout-unknown' });
    return new HttpsError('unavailable', 'לא הצלחנו לקרוא את הרשימות מימות. לא נשלח צינתוק. נסו שוב מאוחר יותר.', { reason: 'read-failed' });
  };

  if (input.action === 'preview') {
    let c;
    try { c = await counts(ctx, cfg, fbs, target, db); } catch (e) { throw readFail(e); }
    // שליחה מהשעה האחרונה שהגיעה למישהו (ליידע לפני שליחה חדשה לכולם)
    let recent = null;
    try {
      for (const d of (await db.collection(SENDS).orderBy('at', 'desc').limit(10).get()).docs) {
        const x = d.data(), t = Date.parse(x.doneAt || x.at), n = x.result && Number.isInteger(x.result.sent) ? x.result.sent : 0;
        if (n > 0 && Date.now() - t < RECENT_MS) { recent = { at: x.doneAt || x.at, sent: n, target: x.target }; break; }
      }
    } catch (e) { logger.warn('yemot-tz: recent failed', { reason: 'recent-failed' }); }
    return Object.assign({ ok: true, target, recent }, c);
  }
  if (input.resume !== undefined && input.resume !== true) throw bad();
  const resume = input.resume === true;

  // ---------- send ----------
  const requestId = input.requestId;
  const recRef = db.doc(`${SENDS}/${requestId}`);
  const lockRef = db.doc(LOCK);
  const now = new Date().toISOString();
  const got = await db.runTransaction(async (tx) => {
    const [r, l] = await Promise.all([tx.get(recRef), tx.get(lockRef)]);
    // ניסיון חוזר עם אותו מזהה – לא שולחים שוב. חריגים: 'not-sent' (קריאת הרשימות נכשלה לפני כל שליחה) – מותר לנסות שוב;
    // resume על 'partial'/'failed' – משלימים את אותה רשומה (רק מי שלא קיבל).
    const prev = r.exists ? r.data() : null;
    const cont = !!prev && resume && RESUMABLE.includes(prev.status) && prev.target === target;
    if (prev && prev.status !== 'not-sent' && !cont) return { dup: prev };
    if (resume && !cont) return { noResume: true };
    const lx = l.exists ? l.data() : {};
    if (lx.lockAt && Date.now() - Date.parse(lx.lockAt) < LOCK_MS) return { busy: true };
    tx.set(lockRef, { lockAt: now, requestId }, { merge: true });
    if (cont) tx.update(recRef, { status: 'sending', resumedAt: now, resumedBy: who.uid });
    else tx.set(recRef, { requestId, target, status: 'sending', byUid: who.uid, at: now });
    return { cont: cont ? prev : null };
  });
  if (got.noResume) throw new HttpsError('failed-precondition', 'אין מה להשלים בשליחה הזו.', { reason: 'nothing-to-resume' });
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
  const P = got.cont; // השלמה: הרשומה הקודמת (מה כבר נשלח)
  let pre;
  try { pre = await counts(ctx, cfg, fbs, target, db); } catch (e) {
    // בהשלמה – מחזירים את המצב הקודם (לא 'not-sent', כדי שניסיון הבא לא ישלח שוב לכולם)
    if (P) await finish(P.status, P.result);
    else await finish('not-sent', { sent: 0, failed: 0, uncertain: 0, warnings: ['read-failed'], message: 'לא הצלחנו לקרוא את הרשימות מימות. לא נשלח צינתוק.' });
    throw readFail(e);
  }
  if (pre.capped && P) { await finish(P.status, P.result); throw new HttpsError('failed-precondition', `אי אפשר להשלים: ${pre.paid} מספרים בתשלום – מעל המכסה (${pre.max}).`, { reason: 'capped' }); }
  if (pre.capped) {
    return finish('capped', { sent: 0, failed: 0, uncertain: 0, paidSent: 0, cost: 0, free: pre.free, paid: pre.paid, max: pre.max, warnings: ['fb-tz-capped'],
      message: `לא נשלח צינתוק: ${pre.paid} מספרים בתשלום – מעל המכסה (${pre.max}).` });
  }

  // 2. החינמי (רק ב-all): tzl:<רשימה>
  // בהשלמה: רק אם החינמי נכשל בוודאות בפעם הקודמת
  let freeSt = P ? (P.freeTz || null) : null;
  const freeN0 = P && P.result && Number.isInteger(P.result.free) ? P.result.free : 0;
  if (target === 'all' && (P ? P.freeTz === 'failed' : pre.free > 0)) {
    await recRef.update({ freeTz: 'pending' });
    let called = false;
    try {
      await Y.testFault(db, 'tz-free-before'); // בדיקות בלבד (אמולטור): כשל לפני שהקריאה יצאה
      called = true;
      await yemotCall(ctx, 'RunTzintuk', { phones: 'tzl:' + cfg.list });
      freeSt = 'sent';
    } catch (e) {
      freeSt = !called || certainFail(e) ? 'failed' : 'uncertain';
      logger.warn('yemot-tz: free tzintuk failed', { reason: 'free-tz-' + freeSt, code: e instanceof YemotError ? e.code : 'internal' });
    }
    try { await recRef.update({ freeTz: freeSt }); } catch (e) { logger.error('yemot-tz: record failed', { reason: 'record-failed' }); }
  }

  // 3. בתשלום: לקוחות המשוב (ב-all – רק מי שאינו ברשימה החינמית). קבוצות, רישום ו-uncertain – ב-fbTzintuk.
  // בהשלמה: רק אם הבתשלום נכשל (failed/partial), ורק למי שאינו ב-fbTzSent. אחרת – מה שנרשם בפעם הקודמת.
  const doPaid = !P || RESUMABLE.includes(P.fbTz);
  const fb = doPaid ? await Y.fbTzintuk(db, ctx, cfg, fbs, recRef, P ? P.fbTzSent : [], null, { keepFree: target === 'fb' })
    : { st: P.fbTz || 'empty', sent: Array.isArray(P.fbTzSent) ? P.fbTzSent : [], total: Number.isInteger(P.fbTzTotal) ? P.fbTzTotal : 0 };
  // fbTzintuk שנכשל לפני שקרא את הרשימה מחזיר total:0 – לפי הבדיקה המקדימה, כדי לא לדווח "נשלח" (סבב 2)
  const paidTotal = fb.st === 'capped' ? 0 : ['failed', 'partial', 'uncertain'].includes(fb.st) ? Math.max(fb.total, pre.paid) : fb.total;
  const paidLeft = Math.max(0, paidTotal - fb.sent.length);
  const freeN = freeSt ? (pre.free || freeN0) : 0;
  const res = {
    free: freeN, freeTz: freeSt, paid: paidTotal, paidTz: fb.st, paidSent: fb.sent.length, cost: cost(fb.sent.length),
    sent: (freeSt === 'sent' ? freeN : 0) + fb.sent.length,
    failed: (freeSt === 'failed' ? freeN : 0) + (['failed', 'partial'].includes(fb.st) ? paidLeft : 0),
    uncertain: (freeSt === 'uncertain' ? freeN : 0) + (fb.st === 'uncertain' ? paidLeft : 0),
    warnings: fb.st === 'capped' ? ['fb-tz-capped'] : [],
    resumed: !!P,
  };
  const status = res.uncertain ? 'uncertain' : res.failed ? (res.sent ? 'partial' : 'failed') : fb.st === 'capped' ? 'capped' : 'done';
  res.message = status === 'done' ? (res.sent ? `הצינתוק נשלח ל-${res.sent} מספרים.` : 'אין למי לשלוח: הרשימות ריקות.')
    : status === 'failed' ? `לא נשלח צינתוק${res.failed ? ` ל-${res.failed} מספרים` : ''}. אפשר להשלים את מי שלא קיבל.`
    : status === 'capped' ? 'לא נשלח צינתוק בתשלום: מעל המכסה.'
      : `נשלחו ${res.sent}${res.failed ? `, נכשלו ${res.failed}` : ''}${res.uncertain ? `, לא ידוע אם נשלח ל-${res.uncertain} – בדקו בימות לפני שליחה חוזרת` : ''}.${status === 'partial' ? ' אפשר להשלים את מי שלא קיבל.' : ''}`;
  logger.info('yemot-tz: send done', { target, status, resumed: !!P, sent: res.sent, failed: res.failed, uncertain: res.uncertain });
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
