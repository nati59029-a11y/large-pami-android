'use strict';
// מסמכים ללקוח (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 3 חלק א'): arFile – קישור ציבורי לקובץ PDF, עם אסימון.
//   GET ?t=<אסימון>  →  הקובץ (application/pdf). כל בעיה (אסימון שגוי, פג תוקף, בוטל, קובץ חסר) – 404 אחיד, בלי פירוט.
// אסימון: 32 בתים אקראיים (base64url, 43 תווים). נשמר רק הגיבוב (sha256) – מי שקורא את המסד לא יכול לבנות את הקישור.
//   arlink/{sha256}  (בשורש, שרת בלבד – החוקים סוגרים כל אוסף שלא הוגדר)  { biz, p, doc, n, exp, at, void? }
// הקובץ: Storage, ar/{bizId}/{docId}.pdf. כללי Storage סוגרים את הנתיב לכולם (ברירת המחדל) – רק השרת (Admin) קורא וכותב.
// תוקף: 180 יום (הנחה של התוכנית). ווטסאפ מוריד את המסמך מהקישור הזה.
// כתובת קבועה מחוץ לקוד (אצל הלקוח ובווטסאפ) – לכן אזור אחד בלבד, us-central1 (כמו publicBrand, secWaHook).
// עזרים לשלב 3 חלק ב' (ar.js): _core.put (שמירת קובץ), _core.mkLink (קישור חדש), _core.revoke (ביטול), _core.urlOf.

const crypto = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { LEGACY_REGION } = require('./lib/region');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const T = require('./lib/tenant');

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const DAYS = 180;
const PDF_MAX = 10 * 1024 * 1024;
const COLL = 'arlink';

const hashOf = (tok) => crypto.createHash('sha256').update(String(tok), 'utf8').digest('hex');
function pathOf(biz, id) {
  if (!T.BIZ_RE.test(String(biz || '')) || !ID_RE.test(String(id || ''))) throw new Error('ar-file: bad path');
  return `ar/${biz}/${id}.pdf`;
}
const bucketOf = (o) => (o && o.bucket ? getStorage().bucket(o.bucket) : getStorage().bucket());

// שמירת הקובץ (דורס קובץ קודם של אותו מסמך – למשל "מהדורה 2"). מחזיר את הנתיב
async function put(biz, id, buf, o) {
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > PDF_MAX || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('ar-file: bad pdf');
  const p = pathOf(biz, id);
  await bucketOf(o).file(p).save(buf, { resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'private, no-store' } });
  return p;
}

// כתובת הפונקציה. באמולטור – הכתובת המקומית
function urlOf(tok, o) {
  const project = (o && o.project) || process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || '';
  if (o && o.base) return o.base.replace(/\/+$/, '') + '?t=' + tok;
  if (process.env.FUNCTIONS_EMULATOR === 'true') return `http://${process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001'}/${project}/${LEGACY_REGION}/arFile?t=${tok}`;
  return `https://${LEGACY_REGION}-${project}.cloudfunctions.net/arFile?t=${tok}`;
}

// קישור חדש למסמך. { biz, id, n (שם הקובץ להורדה), days?, now? } → { token, url, exp, h }
// האסימון עצמו לא נשמר בשום מקום – רק מוחזר למי שקרא (כדי לשלוח ללקוח)
async function mkLink(a) {
  const now = a.now || Date.now();
  const days = Number.isInteger(a.days) && a.days > 0 && a.days <= DAYS ? a.days : DAYS;
  const p = pathOf(a.biz, a.id);
  const token = crypto.randomBytes(32).toString('base64url');
  const h = hashOf(token);
  const exp = now + days * 864e5;
  const n = String(a.n || 'document.pdf').replace(/[\u0000-\u001f\u007f"\\/]/g, '').slice(0, 100) || 'document.pdf';
  await getFirestore().doc(`${COLL}/${h}`).create({ biz: a.biz, p, doc: a.id, n, exp, at: now });
  return { token, url: urlOf(token, a), exp, h };
}
async function revoke(h, now) {
  if (!HASH_RE.test(String(h || ''))) return false;
  const ref = getFirestore().doc(`${COLL}/${h}`);
  const s = await ref.get();
  if (!s.exists) return false;
  await ref.update({ void: now || Date.now() });
  return true;
}

function notFound(res) {
  res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('not found');
}
async function handle(req, res, o) {
  const now = (o && o.now) || Date.now();
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).set('Allow', 'GET, HEAD').send('');
  const tok = typeof (req.query && req.query.t) === 'string' ? req.query.t : '';
  if (!TOKEN_RE.test(tok)) return notFound(res);
  const s = await getFirestore().doc(`${COLL}/${hashOf(tok)}`).get();
  const d = s.exists ? s.data() || {} : null;
  if (!d || d.void || !(typeof d.exp === 'number' && d.exp > now)) return notFound(res);
  if (!T.BIZ_RE.test(String(d.biz || '')) || typeof d.p !== 'string' || !d.p.startsWith(`ar/${d.biz}/`) || !/^ar\/[a-z0-9-]+\/[A-Za-z0-9_-]{1,80}\.pdf$/.test(d.p)) return notFound(res);
  let buf;
  try {
    const f = bucketOf(o).file(d.p);
    const [m] = await f.getMetadata();
    if (+m.size > PDF_MAX) return notFound(res);
    [buf] = await f.download();
  } catch (e) { return notFound(res); }
  const n = String(d.n || 'document.pdf');
  const ascii = n.replace(/[^A-Za-z0-9._-]/g, '_');
  res.status(200).set('Content-Type', 'application/pdf')
    .set('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`)
    .set('Content-Length', String(buf.length));
  return req.method === 'HEAD' ? res.end() : res.end(buf);
}

exports.arFile = onRequest({ region: LEGACY_REGION, maxInstances: 5, timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  try { await handle(req, res); } catch (e) {
    logger.error('arFile failed', { reason: 'internal', name: e && e.name });
    if (!res.headersSent) notFound(res);
  }
});
Object.defineProperty(exports, '_core', { enumerable: false, value: { handle, put, mkLink, revoke, urlOf, hashOf, pathOf, TOKEN_RE, DAYS, PDF_MAX, COLL } });
