'use strict';
// תמלול הודעה קולית בקבוצה (26.11.2026, שיתוף לקבוצה – משימות/2026-11-26_שיתוף-לאפליקציה-סריקה-או-קבוצה/00-בקשה.md, "חוזה נתונים").
//   grpTr({ gid, mid, bizId? }) → { tr }
//   האפליקציה מעלה את ההקלטה ל-grpf/{gid}/{mid} (בעסק b/{bizId}/grpf/...), כותבת את ההודעה (k 'aud', fp = הנתיב), ואז קוראת ל-grpTr.
//   השרת מוריד את הקובץ, מתמלל באותה דרך שהמזכירה מתמללת (lib/sec-ai.js transcribe – Gemini, אותו מפתח GEMINI_API_KEY),
//   וכותב tr (עד 4000 תווים) להודעה. הלקוח לא יכול לכתוב tr (חוקי Firestore). כישלון – ההודעה הקולית נשארת בלי תמלול.
// הרשאות: מחובר, עובד פעיל / מנהל של העסק (requireStaff), התוספת groups (בלארג' פעמי legacy – פעילה תמיד, כמו החוקים),
//   רק השולח של ההודעה (m.by == uid), רק k == 'aud', ורק כש-fp הוא בדיוק הנתיב של אותה הודעה.
// כבר יש tr – מוחזר כמו שהוא, בלי פנייה נוספת ל-AI (לחיצה כפולה / ניסיון חוזר).
// מגבלת קצב: 30 תמלולים בשעה לכל משתמש (fn_rate/grpTr_{uid}, כמו cashoutTotal – לא נגיש מהאפליקציה). קובץ עד 15MB (בקשה אחת ל-Gemini).
// העלות לא נספרת בתקרת המזכירה (אין כאן הסכמה למזכירה); הגבולות הם מגבלת הקצב ו-dur <= 600 שניות בחוקים.
// פרטיות: ביומן השרת רק קודים ומספרים – בלי תמלול ובלי נתיבים.
// שגיאות (details.reason): bad-id, no-msg, not-sender, not-audio, no-file, too-big, rate-limit, internal (+ של requireStaff). ההודעה בעברית.
const logger = require('firebase-functions/logger');
const { HttpsError } = require('firebase-functions/v2/https');
const { getStorage } = require('firebase-admin/storage');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const AI = require('./lib/sec-ai');

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TR_MAX = 4000;
const FILE_MAX = 15 * 1024 * 1024;
const RL_MAX = 30, RL_MS = 3600000;
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });

async function rateLimit(db, uid, now) {
  const ref = db.doc('fn_rate/grpTr_' + uid);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const L = (s.exists && Array.isArray(s.get('t')) ? s.get('t') : []).filter((t) => typeof t === 'number' && now - t < RL_MS);
    if (L.length >= RL_MAX) throw new HttpsError('resource-exhausted', 'יותר מדי תמלולים בשעה האחרונה. נסו שוב מאוחר יותר.', { reason: 'rate-limit' });
    L.push(now);
    tx.set(ref, { t: L });
  });
}

// סוג ההקלטה ל-Gemini: מה-Storage אם הוא audio/*, אחרת מההודעה (fm); בלי פרמטרים (;codecs=...)
function mimeOf(meta, fm) {
  for (const v of [meta && meta.contentType, fm]) {
    const m = String(typeof v === 'string' ? v : '').split(';')[0].trim().toLowerCase();
    if (/^audio\/[a-z0-9.+-]{1,60}$/.test(m)) return m;
  }
  return '';
}

// opts: { bucket, ai (במקום AI.transcribe), now } לבדיקות
async function tr(request, opts) {
  const o = opts || {};
  const input = inputObject(request);
  const who = await requireStaff(request, { feature: 'groups' });
  const gid = input.gid, mid = input.mid;
  if (typeof gid !== 'string' || !ID_RE.test(gid) || typeof mid !== 'string' || !ID_RE.test(mid)) throw bad('bad-id', 'מזהה לא תקין');
  const db = T.tdb();
  const ref = db.doc('grp/' + gid + '/m/' + mid);
  const s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', 'ההודעה לא נמצאה', { reason: 'no-msg' });
  const m = s.data() || {};
  if (m.by !== who.uid) throw new HttpsError('permission-denied', 'רק מי ששלח את ההודעה יכול לבקש תמלול', { reason: 'not-sender' });
  const fp = who.prefix + 'grpf/' + gid + '/' + mid;
  if (m.k !== 'aud' || m.fp !== fp) throw new HttpsError('failed-precondition', 'זו לא הודעה קולית', { reason: 'not-audio' });
  if (typeof m.tr === 'string' && m.tr) return { tr: m.tr };
  await rateLimit(db, who.uid, o.now || Date.now());
  const bucket = o.bucket || getStorage().bucket();
  const file = bucket.file(fp);
  let meta;
  try { [meta] = await file.getMetadata(); } catch (e) {
    throw new HttpsError('not-found', 'ההקלטה לא נמצאה', { reason: 'no-file' });
  }
  if (!(Number(meta && meta.size) > 0)) throw new HttpsError('not-found', 'ההקלטה לא נמצאה', { reason: 'no-file' });
  if (Number(meta.size) > FILE_MAX) throw new HttpsError('failed-precondition', 'ההקלטה גדולה מדי לתמלול', { reason: 'too-big' });
  const mime = mimeOf(meta, m.fm);
  if (!mime) throw new HttpsError('failed-precondition', 'זו לא הודעה קולית', { reason: 'not-audio' });
  const [buf] = await file.download();
  const r = await (o.ai || AI.transcribe)({ mime, b64: buf.toString('base64') });
  const text = String((r && r.text) || '').replace(/\r/g, '').trim().slice(0, TR_MAX);
  if (!text) return { tr: '' };
  // כתיבה רק אם ההודעה עדיין קיימת ועדיין בלי tr (נמחקה בינתיים – לא יוצרים אותה מחדש)
  const out = await db.runTransaction(async (tx) => {
    const x = await tx.get(ref);
    if (!x.exists) return null;
    const cur = x.get('tr');
    if (typeof cur === 'string' && cur) return cur;
    tx.update(ref, { tr: text });
    return text;
  });
  if (out === null) throw new HttpsError('not-found', 'ההודעה לא נמצאה', { reason: 'no-msg' });
  logger.info('grpTr: ok', { bizId: who.bizId, kb: Math.round(buf.length / 1024), n: out.length });
  return { tr: out };
}

const wrap = (fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError && e.code !== 'internal') throw e;
    logger.error('grpTr failed', { reason: (e && e.details && e.details.reason) || 'internal', name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'התמלול נכשל. ההודעה הקולית נשלחה בלי תמלול.', { reason: 'internal' });
  }
});

exports.grpTr = onCall({ secrets: [AI.GEMINI_API_KEY], timeoutSeconds: 120, memory: '512MiB', maxInstances: 5 }, wrap((r) => tr(r)));
Object.defineProperty(exports, '_core', { enumerable: false, value: { tr, mimeOf, RL_MAX, FILE_MAX } });
