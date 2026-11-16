'use strict';
// מכשיר אחד למשתמש (16.11.2026, החלטות בעל העסק):
//   כניסה ממכשיר חדש מצליחה ומחליפה את הקודם. המכשיר הקודם מתנתק בפעם הבאה שהוא נפתח / פעיל ("התחברת ממכשיר אחר").
//   טלפון ומחשב נספרים בנפרד: טלפון אחד + מחשב אחד לכל משתמש. אתר שנפתח בדפדפן של טלפון = טלפון (האפליקציה קובעת kind).
//   חל על כולם חוץ ממנהל־העל (superadmins/{uid}) – תמיד { exempt: true } ובלי שום רישום.
//   התראות – רק לטלפון הנוכחי: תפיסת טלפון מוציאה את כל הטלפונים של המשתמש מ-pushTokens / pushAct / push_dev (dropTokens),
//   והטלפון החדש נרשם מחדש (registerPushToken עם s) – רק הוא נשאר.
//
// devClaim (onCall, שני האזורים)  קלט: { op: 'claim'|'check', kind: 'phone'|'web', s, legacy? }
//   s = מזהה הכניסה (מחרוזת אקראית שהאפליקציה יוצרת בכל כניסה מוצלחת ושומרת אצלה). נשמר רק הגיבוב (sha256).
//   claim – הכניסה הזו היא עכשיו המכשיר הנוכחי של הסוג. טלפון: גם fh מתאפס והטלפונים הקודמים יוצאים מההתראות.
//   claim + legacy: 1 – כניסה שהייתה קיימת לפני העדכון (אין לה s): נרשמת רק אם אין עדיין מכשיר מהסוג הזה. אחרת { cur: false }.
//     (אותו s שכבר נרשם – { cur: true }, כדי שניסיון חוזר אחרי תקלת רשת לא ינתק.)
//   check – { cur: true|false }. אין רישום מהסוג הזה – cur: true (none: true). רק cur: false מפורש מנתק באפליקציה.
//   פלט: { ok: true, cur, exempt?, none?, log?, off?, dropped? }
//
// dev_cur/{uid} (בשורש, שרת בלבד – החוקים סוגרים כל אוסף שלא הוגדר)
//   { phone: { sh: sha256(s), fh: sha256(מזהה FCM)|null, at }, web: { sh, at } }  – תוספת בלבד, שום מסמך קיים לא משתנה.
//   fh נכתב ב-registerPushToken (index.js) כשהטלפון הנוכחי נרשם עם s; push-act.js דורש שהטלפון הלוחץ = fh.
//
// מתג חירום ONE_DEVICE (functions/.env): on (ברירת מחדל) | log (רק רושם ביומן – אף אחד לא מנותק, ההתראות כמו קודם) | off (כמו לפני התכונה).

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { defineString } = require('firebase-functions/params');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall } = require('./lib/region'); // onCall בשני אזורים (europe-west1 + us-central1)
const { requireStaff, inputObject } = require('./lib/roles');
const T = require('./lib/tenant');

const ONE_DEVICE = defineString('ONE_DEVICE', { default: 'on', description: 'מכשיר אחד למשתמש: on | log (רק יומן) | off (כבוי)' });

const COLL = 'dev_cur';
const KINDS = ['phone', 'web'];
const OPS = ['claim', 'check'];
const S_RE = /^[A-Za-z0-9_-]{16,128}$/; // מזהה הכניסה מהאפליקציה (אקראי, base64url / hex)

const sha = (v) => crypto.createHash('sha256').update(String(v), 'utf8').digest('hex'); // כמו hashOf ב-push-act.js
const pathOf = (uid) => `${COLL}/${uid}`;
// המצב של המתג. ערך ריק / לא מוכר = on (ברירת המחדל)
function mode() {
  let v = '';
  try { v = String(ONE_DEVICE.value() || '').trim().toLowerCase(); } catch (e) { v = ''; }
  return v === 'off' || v === 'log' ? v : 'on';
}
// הרישום של סוג אחד מתוך המסמך, או null
function kindOf(snap, kind) {
  const v = snap && snap.exists ? snap.get(kind) : null;
  return v && typeof v === 'object' && !Array.isArray(v) && typeof v.sh === 'string' ? v : null;
}

// כל הטלפונים של המשתמש בעסק הנוכחי יוצאים מההתראות (pushTokens / pushAct / push_dev) – הטלפון החדש נרשם מחדש אחרי התפיסה
async function dropAll(uid) {
  const RM = require('./secretary-remind')._core;
  const db = T.tdb();
  const toks = await RM.tokensOf(db, uid);
  if (toks.length) await RM.dropTokens(db, uid, toks);
  return toks.length;
}

exports.devClaim = onCall(T.scoped(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'צריך להתחבר לאפליקציה', { reason: 'not-signed-in' });
  const input = inputObject(request);
  // מנהל־העל – פטור (לפני requireStaff: הוא לא חייב להיות חבר בעסק)
  if (await T.isSuper(uid)) return { ok: true, cur: true, exempt: true };
  await requireStaff(request); // משתמש מושבת / עסק מושהה / לא עובד – אותן שגיאות כמו בכל פונקציה
  const op = input.op, kind = input.kind, s = input.s;
  if (!OPS.includes(op) || !KINDS.includes(kind) || typeof s !== 'string' || !S_RE.test(s)) {
    throw new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-input' });
  }
  const m = mode();
  if (m === 'off') return { ok: true, cur: true, off: true };
  const ref = getFirestore().doc(pathOf(uid));
  const sh = sha(s);

  if (op === 'check') {
    const k = kindOf(await ref.get(), kind);
    if (!k) return { ok: true, cur: true, none: true };
    if (k.sh === sh) return { ok: true, cur: true };
    if (m === 'log') { logger.info('devClaim: other device (log only)', { kind }); return { ok: true, cur: true, log: true }; }
    return { ok: true, cur: false };
  }

  // claim
  const legacy = input.legacy === 1 || input.legacy === true;
  const now = Date.now();
  const r = await getFirestore().runTransaction(async (tx) => {
    const k = kindOf(await tx.get(ref), kind);
    if (k && k.sh === sh) return { wrote: false, cur: true };
    if (legacy && k) return { wrote: false, cur: false };
    tx.set(ref, { [kind]: kind === 'phone' ? { sh, fh: null, at: now } : { sh, at: now } }, { merge: true });
    return { wrote: true, cur: true };
  });
  if (!r.cur) {
    if (m === 'log') { logger.info('devClaim: legacy session on other device (log only)', { kind }); return { ok: true, cur: true, log: true }; }
    return { ok: true, cur: false };
  }
  const out = { ok: true, cur: true };
  // טלפון חדש: הטלפונים הקודמים מפסיקים לקבל התראות (במצב log – לא נוגעים בהתראות)
  if (r.wrote && kind === 'phone' && m === 'on') {
    try { out.dropped = await dropAll(uid); } catch (e) { logger.warn('devClaim: drop tokens failed', { name: e && e.name, code: e && e.code }); }
  }
  return out;
}));

// push-act.js: הטלפון שלוחץ על כפתור בהתראה חייב להיות הטלפון הנוכחי (fh). אין רישום טלפון – כמו קודם (מותר)
async function phoneOk(uid, fcm) {
  const m = mode();
  if (m === 'off') return true;
  const ph = kindOf(await getFirestore().doc(pathOf(uid)).get(), 'phone');
  if (!ph || ph.fh === sha(fcm)) return true;
  if (await T.isSuper(uid)) return true;
  if (m === 'log') { logger.info('pushAct: not current phone (log only)'); return true; }
  return false;
}

Object.defineProperty(exports, '_core', { enumerable: false, value: { mode, kindOf, sha, pathOf, phoneOk, dropAll, COLL, KINDS, S_RE } });
