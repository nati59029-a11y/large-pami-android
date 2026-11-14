'use strict';
// סריקת חנות בתלת מימד – שלב 5ב (14.11.2026): פונקציות השרת של המפה. הלוגיקה הטהורה ב-lib/store3d-map.js (בדיקות יחידה).
//   s3SaveMap { mapId, baseV, map, why? } – מנהל, או עובד עם המתג s3m ("שרטוט מפה"). מחיקה/שחזור של פריט או של המפה – מנהל בלבד.
//     נעילה: baseV חייב להיות שווה ל-v הנוכחי (מפה חדשה = 0), אחרת "המפה השתנתה בטלפון אחר. טענו מחדש."
//     בטרנזקציה אחת: הגרסה הקודמת נשמרת ב-smap/{mapId}/ver/{v קודם, 6 ספרות}, והמפה החדשה נכתבת עם v+1, upd, by (השרת קובע).
//     בדיקת תקינות לפי חוזה 4.3, עד 800KB. אחרי השמירה – נשארות 30 גרסאות אחרונות. שחזור גרסה = שמירה חדשה (why: 'שחזור').
//     תיקון סבב 1: seq – רק של השרת; גוף חדש עם מזהה מחוץ לטווח מקבל מזהה חדש (renamed); מגבלות על פריטים חיים, ולסל המחזור
//     תקרה נפרדת – מעבר לה המחוקים הישנים מוסרים סופית (purged).
//   s3SetBranch { brId, wh, cap, on } – מנהל־על בלבד. כותב s3br/{brId} ורשומת audit ב-b/{bizId}/audit (כמו setBusinessOrg).
//   s3PutTex { qid, mapId, img } – מנהל או s3m. תמונת טקסטורה (JPEG, כל צלע 256/512/1024, עד 600,000 בתים) נשמרת ב-Storage תחת
//     b/{bizId}/store3d/{brId}/tex/{mapId}/{texId}_1.jpg ומחזירה { texId, path, w, h }. בלי AI ובלי מכסה. qid – ניסיון חוזר מחזיר
//     את אותה תשובה (s3qid). הטקסטורה נכנסת למפה רק בשמירה הבאה (tx[] ב-s3SaveMap).
//     תיקון סבב 1: נחסם כשהתלת מימד כבוי בסניף (br-off) או מחסן בלי wh; עד 200 העלאות ב-24 שעות לכל מפה (tex-day, הנחה).
// כולן: requireStaff עם feature 'store3d', inputObject, T.scoped, שגיאות בעברית.

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const M = require('./lib/store3d-map');

if (!getApps().length) initializeApp();

const QID_DAYS = 30, D1 = 86400000;
const bad = (reason, msg, code, extra) => new HttpsError(code || 'invalid-argument', msg, Object.assign({ reason }, extra || {}));
const isExists = (e) => e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)));
const CODE = {
  'bad-map': 'invalid-argument', 'bad-base': 'invalid-argument', 'too-big': 'invalid-argument', 'bad-img': 'invalid-argument',
  'bad-type': 'invalid-argument', 'bad-size': 'invalid-argument', 'bad-br': 'invalid-argument', 'bad-cap': 'invalid-argument',
  'bad-input': 'invalid-argument', stale: 'failed-precondition', 'id-reuse': 'failed-precondition', 'del-mgr': 'permission-denied',
};
// שגיאה של הליבה (fail) → HttpsError עם reason; כל שגיאה אחרת עוברת כמו שהיא
function toHttps(e) {
  if (e instanceof HttpsError || !e || !CODE[e.code]) return e;
  return bad(e.code, e.message, CODE[e.code], e.errs ? { errs: e.errs } : null);
}
const canDraw = (who) => who.role === 'manager' || hasPerm(who, 's3m');
async function branchesOf(bizId) {
  const s = await getFirestore().doc('b/' + bizId).get();
  return M.branchIds(s.exists ? s.get('org') : null);
}
function mapIdOf(input) {
  if (typeof input.mapId !== 'string' || !M.RE.map.test(input.mapId)) throw bad('bad-map-id', 'מזהה המפה לא תקין');
  return input.mapId;
}

// הסניף קיים בעסק, התלת מימד פעיל בו, ומחסן (w-) רק כש-wh (משותף ל-s3SaveMap ול-s3PutTex)
async function branchOk(db, bizId, br, kind) {
  const [ids, brDoc] = await Promise.all([branchesOf(bizId), db.doc('s3br/' + br).get()]);
  if (!ids.includes(br)) throw bad('no-branch', 'הסניף לא קיים בעסק', 'failed-precondition');
  const cfg = M.brCfg(brDoc.exists ? brDoc.data() : null);
  if (!cfg.on) throw bad('br-off', 'התלת מימד כבוי בסניף הזה. מנהל המערכת יכול להפעיל אותו בהגדרות הסניף.', 'failed-precondition');
  if (kind === 'w' && !cfg.wh) throw bad('no-wh', 'לסניף הזה אין מחסן. מנהל המערכת יכול להפעיל מחסן בהגדרות הסניף.', 'failed-precondition');
  return cfg;
}

// ---------------- s3SaveMap ----------------
// הליבה, לבדיקות מול אמולטור Firestore בלי אמולטור הפונקציות. who = { uid, mgr, bizId }; db = T.tdb() של העסק.
async function saveMap(db, who, input, now) {
  const mapId = mapIdOf(input), br = mapId.slice(2), kind = mapId.charAt(0);
  let clean;
  try { clean = M.cleanMap(input.map, { bizId: who.bizId, mapId }); } catch (e) { throw toHttps(e); }
  await branchOk(db, who.bizId, br, kind);
  const ref = db.doc('smap/' + mapId);
  const res = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const old = s.exists ? s.data() : null;
    try {
      const v = M.checkLock(old, input.baseV);
      const fin = M.finalCheck(M.mergeDel(old, clean.map, { mgr: who.mgr, uid: who.uid, now }), old);
      const doc = Object.assign(fin.map, { v, upd: now, by: who.uid });
      if (M.bytesOf(doc) > M.MAX_BYTES) throw M.fail('too-big', 'המפה גדולה מדי (עד 800KB). מחקו פריטים שלא צריך או חלקו לשתי מפות.');
      if (old) tx.set(db.doc('smap/' + mapId + '/ver/' + M.verId(old.v)), M.verDoc(old, { uid: who.uid, now }, input.why));
      tx.set(ref, doc);
      return { ok: true, mapId, v, upd: now, seq: doc.seq, dropped: clean.dropped, renamed: fin.renamed, purged: fin.purged };
    } catch (e) { throw toHttps(e); }
  });
  // 30 גרסאות אחרונות – הישנות נמחקות (לא חלק מהטרנזקציה; כשל כאן לא מבטל את השמירה, וינוקה בשמירה הבאה)
  try {
    const vs = await db.collection('smap/' + mapId + '/ver').select().get();
    const del = M.prune(vs.docs.map((d) => d.id), M.KEEP_VERS);
    if (del.length) { const b = db.batch(); for (const id of del) b.delete(db.doc('smap/' + mapId + '/ver/' + id)); await b.commit(); }
  } catch (e) {
    logger.warn('s3SaveMap: prune failed', { code: e && e.code });
  }
  return res;
}
exports.s3SaveMap = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!canDraw(who)) throw bad('not-s3m', 'שמירת מפה מותרת למנהל או לעובד עם הרשאת "שרטוט מפה"', 'permission-denied');
  const input = inputObject(request);
  return saveMap(T.tdb(), { uid: who.uid, mgr: who.role === 'manager', bizId: who.bizId }, input, Date.now());
}));

// ---------------- s3SetBranch (מנהל־על) ----------------
async function setBranch(db, who, input, now) {
  let c;
  try { c = M.cleanBranch(input); } catch (e) { throw toHttps(e); }
  const root = getFirestore();
  const bizRef = root.doc('b/' + who.bizId), ref = db.doc('s3br/' + c.brId);
  return root.runTransaction(async (tx) => {
    const [b, s] = await Promise.all([tx.get(bizRef), tx.get(ref)]);
    if (!M.branchIds(b.exists ? b.get('org') : null).includes(c.brId)) throw bad('no-branch', 'הסניף לא קיים בעסק', 'failed-precondition');
    const p = M.brCfg(s.exists ? s.data() : null);
    tx.set(ref, { wh: c.wh, cap: c.cap, on: c.on, upd: now, by: who.uid });
    const f = (x) => `wh=${x.wh ? 1 : 0} cap=${x.cap} on=${x.on ? 1 : 0}`;
    tx.set(root.collection(`b/${who.bizId}/audit`).doc(), { by: who.uid, t: now, act: 's3SetBranch', note: `${c.brId}: ${f(c)} (היה ${f(p)})` });
    return { ok: true, brId: c.brId, wh: c.wh, cap: c.cap, on: c.on, upd: now };
  });
}
exports.s3SetBranch = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!who.superadmin) throw bad('not-superadmin', 'הפעולה מותרת למנהל המערכת בלבד', 'permission-denied');
  return setBranch(T.tdb(), { uid: who.uid, bizId: who.bizId }, inputObject(request), Date.now());
}));

// ---------------- s3PutTex ----------------
// bucket, opts.maxDay: לבדיקות; ברירת מחדל – ה-bucket של הפרויקט ו-M.TEX_DAY (200) העלאות ב-24 שעות לכל מפה
async function putTex(db, who, input, now, bucket, opts) {
  const maxDay = opts && Number.isInteger(opts.maxDay) ? opts.maxDay : M.TEX_DAY;
  if (typeof input.qid !== 'string' || !M.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  const mapId = mapIdOf(input), br = mapId.slice(2);
  const qref = db.doc('s3qid/' + input.qid);
  const same = (q) => q.get('k') === 'tex' && q.get('uid') === who.uid && q.get('res') && String(q.get('res').path || '').startsWith(M.texDir(who.bizId, br, mapId));
  const q0 = await qref.get();
  if (q0.exists) {
    if (!same(q0)) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
    return Object.assign({}, q0.get('res'), { dup: true });
  }
  let img;
  try { img = M.decodeTex(input.img); } catch (e) { throw toHttps(e); }
  await branchOk(db, who.bizId, br, mapId.charAt(0));
  const bk = bucket || getStorage().bucket();
  const [files, ms] = await Promise.all([bk.getFiles({ prefix: M.texDir(who.bizId, br, mapId) }), db.doc('smap/' + mapId).get()]);
  // תקרת עלות (הנחה, תיקון סבב 1): עד 200 העלאות ב-24 השעות האחרונות לכל מפה, לפי זמן יצירת הקבצים בתיקייה
  if (M.recentCount(files[0].map((f) => f.metadata && f.metadata.timeCreated), now) >= maxDay) {
    throw bad('tex-day', `הגעתם למספר המרבי של צילומי טקסטורה למפה הזו היום (${maxDay}). נסו שוב מחר.`, 'resource-exhausted');
  }
  let n = M.nextTexN(files[0].map((f) => f.name), ms.exists ? ms.get('tx') : null), path = '';
  // ifGenerationMatch: 0 = רק אם הקובץ לא קיים. שתי העלאות במקביל לא דורסות זו את זו – השנייה מקבלת את המספר הבא.
  for (let i = 0; i < 5 && !path; i++, n++) {
    if (n > 9999) throw bad('tex-full', 'נגמרו המזהים לטקסטורות במפה הזו', 'resource-exhausted');
    const p = M.texPath(who.bizId, br, mapId, 't' + n, 1);
    try {
      await bk.file(p).save(img.buf, { resumable: false, contentType: 'image/jpeg', preconditionOpts: { ifGenerationMatch: 0 } });
      path = p;
    } catch (e) {
      if (e && (e.code === 412 || e.code === '412')) continue;
      logger.warn('s3PutTex: save failed', { code: e && e.code });
      throw bad('save-failed', 'שמירת התמונה נכשלה. נסו שוב.', 'unavailable');
    }
  }
  if (!path) throw bad('busy', 'נסו שוב בעוד רגע', 'aborted');
  const res = { texId: 't' + (n - 1), path, w: img.w, h: img.h };
  try {
    await qref.create({ k: 'tex', uid: who.uid, res, at: now, exp: now + QID_DAYS * D1 });
  } catch (e) {
    if (!isExists(e)) throw e;
    // אותו qid נשלח פעמיים במקביל: הקובץ שלנו מיותר, מחזירים את התשובה הראשונה
    try { await bk.file(path).delete(); } catch (x) { /* ינוקה בניקוי הכללי */ }
    const q = await qref.get();
    if (!same(q)) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
    return Object.assign({}, q.get('res'), { dup: true });
  }
  return res;
}
exports.s3PutTex = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!canDraw(who)) throw bad('not-s3m', 'צילום טקסטורות מותר למנהל או לעובד עם הרשאת "שרטוט מפה"', 'permission-denied');
  return putTex(T.tdb(), { uid: who.uid, bizId: who.bizId }, inputObject(request), Date.now());
}));

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_map', { enumerable: false, value: { saveMap, setBranch, putTex } });
