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
//   s3PutPano / s3DelPano – שלב 18א (15.11.2026), סיור 360. ראו את ההערות ליד הפונקציות למטה.
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
const scan = require('./lib/scan');
const SL = require('./lib/store3d-setup');

if (!getApps().length) initializeApp();

const QID_DAYS = 30, D1 = 86400000;
const bad = (reason, msg, code, extra) => new HttpsError(code || 'invalid-argument', msg, Object.assign({ reason }, extra || {}));
const isExists = (e) => e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)));
const CODE = {
  'bad-map': 'invalid-argument', 'bad-base': 'invalid-argument', 'too-big': 'invalid-argument', 'bad-img': 'invalid-argument',
  'bad-type': 'invalid-argument', 'bad-size': 'invalid-argument', 'bad-br': 'invalid-argument', 'bad-cap': 'invalid-argument',
  'bad-input': 'invalid-argument', stale: 'failed-precondition', 'id-reuse': 'failed-precondition', 'del-mgr': 'permission-denied',
  'bad-ratio': 'invalid-argument', 'bad-pt': 'invalid-argument', 'bad-nb': 'invalid-argument', 'pano-day': 'resource-exhausted',
};
// שגיאה של הליבה (fail) → HttpsError עם reason; כל שגיאה אחרת עוברת כמו שהיא
function toHttps(e) {
  if (e instanceof HttpsError || !e || !CODE[e.code]) return e;
  return bad(e.code, e.message, CODE[e.code], e.errs ? { errs: e.errs } : null);
}
const canDraw = (who) => who.role === 'manager' || hasPerm(who, 's3m');
// שלב 8, תיקון סבב 1: עובד ששויך לסניפים (staff.br) פועל רק בסניפים שלו – אותו תנאי כמו myBranches ב-store3d.js. מנהל / בלי שיוך = null
function myBranches(who) {
  if (!who || who.role === 'manager') return null;
  const brs = who.staff && who.staff.exists ? who.staff.get('br') : null;
  return Array.isArray(brs) ? brs.filter((b) => typeof b === 'string') : null;
}
function brAllowed(who, br) {
  if (who.brs && !who.brs.includes(br)) throw bad('other-branch', 'הסניף הזה לא משויך אליך', 'permission-denied');
}
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
  brAllowed(who, br);
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
      // הקמת חנות שלב 2 (חוזה 6): גוף שקיבל מספר חדש (renamed) – ההערות שלו ושל המקטעים שלו (s3setup/{mapId}/n) ו-qs[].ref עוברים
      // למזהה החדש באותה טרנזקציה. זו העברה ולא מחיקת נתון. קריאות לפני כל כתיבה.
      let mv = null;
      if (Object.keys(fin.renamed).length) {
        const [ss, ns] = await Promise.all([tx.get(db.doc('s3setup/' + mapId)), tx.get(db.collection(`s3setup/${mapId}/n`))]);
        const rn = SL.renameNotes(ns.docs.map((d) => ({ id: d.id, data: d.data() })), fin.renamed);
        const qs = ss.exists ? SL.renameRefs(ss.get('qs'), fin.renamed) : null;
        const ids = new Set(ns.docs.map((d) => d.id));
        for (const id of rn.del) ids.delete(id);
        for (const x of rn.set) ids.add(x.id);
        mv = { rn, qs, nN: ids.size };
      }
      if (mv && (mv.qs || mv.rn.set.length)) {
        for (const x of mv.rn.set) tx.set(db.doc(`s3setup/${mapId}/n/${x.id}`), x.data);
        for (const id of mv.rn.del) tx.delete(db.doc(`s3setup/${mapId}/n/${id}`));
        tx.set(db.doc('s3setup/' + mapId), Object.assign({ upd: now, by: who.uid }, mv.qs ? { qs: mv.qs } : {}, mv.rn.set.length ? { nN: mv.nN } : {}), { merge: true });
      }
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
  return saveMap(T.tdb(), { uid: who.uid, mgr: who.role === 'manager', bizId: who.bizId, brs: myBranches(who) }, input, Date.now());
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
  brAllowed(who, br);
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
  return putTex(T.tdb(), { uid: who.uid, bizId: who.bizId, brs: myBranches(who) }, inputObject(request), Date.now());
}));

// ---------------- s3PutPano / s3DelPano (שלב 18א – סיור 360) ----------------
// ניקוי הקבצים של הבקשה הזו בלבד (תיקון סבב 1 של הבודק): items = [{ path, gen }] – רק קובץ שהבקשה הזו כתבה (נתיב שנתפס בנעילה,
// ו-generation שחזר מהשמירה), רק עם ifGenerationMatch שלו, ולעולם לא נתיב שמופיע ב-full/sm של מסמך הנקודה הנוכחי (הגנה כפולה).
// בספק (קריאת המסמך נכשלה, אין generation) – לא מוחקים; קובץ שנשאר יתום נמחק ב-s3Clean אחרי 30 יום.
async function dropOwn(bk, ref, items) {
  let cur = null;
  try { const s = await ref.get(); cur = s.exists ? s.data() : null; } catch (e) { return; }
  for (const it of items) {
    if (!it || !it.path || !it.gen) continue;
    if (cur && (cur.full === it.path || cur.sm === it.path)) continue;
    try { await bk.file(it.path).delete({ ifGenerationMatch: it.gen }); } catch (x) { /* ינוקה ב-s3Clean אחרי 30 יום */ }
  }
}
// נעילה על נתיב (תיקון סבב 1): s3qid/pano_{mapId}_{pid}_{ver} נוצר ב-create (נכשל אם קיים) לפני ההעלאה, כך שרק בקשה אחת כותבת לנתיב,
// גם אם ifGenerationMatch: 0 לא נאכף (באמולטור). המזהה לא תואם את תבנית ה-qid (יש בו _), ולכן לא מתנגש בו. נמחק ב-s3Clean לפי exp.
async function claimPath(db, who, mapId, pid, ver, now) {
  try {
    await db.doc(`s3qid/pano_${mapId}_${pid}_${ver}`).create({ k: 'pano-lock', uid: who.uid, at: now, exp: now + QID_DAYS * D1 });
    return true;
  } catch (e) { if (isExists(e)) return false; throw e; }
}
// מצב המפה והנקודות (לבדיקה לפני ההעלאה ושוב בתוך הטרנזקציה). ms = smap, ps = הנקודות (QuerySnapshot). מחזיר { map, pts, old }.
function panoState(ms, ps, pid, pt) {
  if (!ms.exists || ms.get('del') === 1) throw bad('no-map', 'המפה לא קיימת. שמרו את המפה לפני שמוסיפים נקודות 360.', 'failed-precondition');
  const map = ms.data();
  if (!M.inMap(map, pt.x, pt.y)) throw bad('out-of-map', 'הנקודה מחוץ לחדרי המפה');
  const all = ps.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const pts = all.filter((d) => d.del !== 1 && d.id !== pid);
  const old = pid ? all.find((d) => d.id === pid) || null : null;
  return { map, pts, old, ids: all.map((d) => d.id) };
}
// s3PutPano { qid, mapId, id?, x, y, yaw, nb?, full?, sm? } – מנהל או s3m (כמו s3PutTex). בלי AI ובלי מכסת AI.
//   חדשה (בלי id): full + sm חובה; השרת נותן מזהה p{n}. החלפה (עם id): full + sm → גרסה חדשה (ver+1), הקבצים הקודמים נשארים
//   ונמחקים ב-s3Clean 30 יום אחרי ההחלפה. עם id ובלי תמונות – עדכון מיקום / כיוון / שכנות בלבד (לא נספר בבלם היומי).
//   x, y בס"מ בתוך חדר חי של המפה; yaw 0–360; nb – אם לא נשלח: חיבור אוטומטי (M.autoNb). הקישור דו-כיווני (M.linkNb).
//   עד 40 נקודות פעילות למפה; עד 60 העלאות תמונה ביום לסניף (s3use/p_{br}, בטרנזקציה). qid חוזר → אותה תשובה עם dup: true.
//   מחזיר { ok, mapId, id, ver, full, sm, w, h, x, y, yaw, nb, linked }.
// opts.maxDay / opts.maxPts – לבדיקות; ברירת מחדל M.PANO_DAY (60) ו-M.PANO_LIMIT (40)
async function putPano(db, who, input, now, bucket, opts) {
  const maxDay = opts && Number.isInteger(opts.maxDay) ? opts.maxDay : M.PANO_DAY;
  const maxPts = opts && Number.isInteger(opts.maxPts) ? opts.maxPts : M.PANO_LIMIT;
  if (typeof input.qid !== 'string' || !M.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  const mapId = mapIdOf(input), br = mapId.slice(2);
  brAllowed(who, br);
  const qref = db.doc('s3qid/' + input.qid);
  const same = (q) => q.get('k') === 'pano' && q.get('uid') === who.uid && q.get('res') && q.get('res').mapId === mapId;
  const dupOf = (q) => { if (!same(q)) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת'); return Object.assign({}, q.get('res'), { dup: true }); };
  const q0 = await qref.get();
  if (q0.exists) return dupOf(q0);
  let pt, img = null;
  const hasImg = (input.full !== undefined && input.full !== null) || (input.sm !== undefined && input.sm !== null);
  try {
    pt = M.cleanPt(input);
    if (!hasImg && !pt.id) throw M.fail('bad-img', 'חסרה תמונת 360');
    if (hasImg) img = M.decodePano(input.full, input.sm);
  } catch (e) { throw toHttps(e); }
  await branchOk(db, who.bizId, br, mapId.charAt(0));
  const mref = db.doc('smap/' + mapId), pcol = db.collection('smap/' + mapId + '/pano'), dref = db.doc('s3use/p_' + br);
  const day = scan.israelDay(new Date(now));
  // בדיקות לפני ההעלאה (כדי לא להעלות 3MB לשווא). אותן בדיקות שוב בתוך הטרנזקציה.
  const check = (ms, ps, dd, pid) => {
    const st = panoState(ms, ps, pid, pt);
    if (pid && !st.old) throw bad('no-pano', 'הנקודה לא קיימת', 'not-found');
    if (st.old && st.old.del === 1) throw bad('pano-gone', 'הנקודה נמחקה', 'failed-precondition');
    if (!pid && st.pts.length >= maxPts) throw bad('pano-limit', `אפשר עד ${maxPts} נקודות 360 במפה. מחקו נקודה שלא צריך.`, 'resource-exhausted');
    if (pt.nb) { const ok = new Set(st.pts.map((q) => q.id)); if (!pt.nb.every((n) => ok.has(n))) throw bad('bad-nb', 'אחת מהנקודות המקושרות לא קיימת'); }
    let dayDoc = null;
    if (hasImg) { try { dayDoc = M.panoDayStep(dd.exists ? dd.data() : null, day, now, maxDay); } catch (e) { throw toHttps(e); } }
    return Object.assign(st, { dayDoc });
  };
  const [ms0, ps0, dd0] = await Promise.all([mref.get(), pcol.get(), dref.get()]);
  const st0 = check(ms0, ps0, dd0, pt.id);
  const bk = bucket || getStorage().bucket();
  let pid = pt.id, ver = st0.old ? (Number.isInteger(st0.old.ver) ? st0.old.ver : 0) : 0, full = '', sm = '', mine = [];
  if (img) {
    // לכל נתיב: קודם נעילה (claimPath), ואז שמירה עם ifGenerationMatch: 0. נתיב תפוס / 412 → מזהה / גרסה הבאים.
    let n = pt.id ? 0 : M.nextPid(st0.ids) - 1;
    const save = async (p, buf) => { const f = bk.file(p); await f.save(buf, { resumable: false, contentType: 'image/jpeg', preconditionOpts: { ifGenerationMatch: 0 } }); return f.metadata && f.metadata.generation; };
    for (let i = 0; i < 10 && !full; i++) {
      if (pt.id) ver += 1; else { n += 1; pid = 'p' + n; ver = 1; }
      if (n > 9999 || ver > 9999) throw bad('pano-full', 'נגמרו המזהים לנקודות 360 במפה הזו', 'resource-exhausted');
      if (!(await claimPath(db, who, mapId, pid, ver, now))) continue;
      const pf = M.panoPath(who.bizId, br, mapId, pid, ver), ps = M.panoPath(who.bizId, br, mapId, pid, ver, true);
      let gf;
      try {
        gf = await save(pf, img.full.buf);
      } catch (e) {
        if (e && (e.code === 412 || e.code === '412')) continue;
        logger.warn('s3PutPano: save failed', { code: e && e.code });
        throw bad('save-failed', 'שמירת התמונה נכשלה. נסו שוב.', 'unavailable');
      }
      try {
        mine = [{ path: pf, gen: gf }, { path: ps, gen: await save(ps, img.sm.buf) }];
      } catch (e) {
        await dropOwn(bk, pcol.doc(pid), [{ path: pf, gen: gf }]);
        if (e && (e.code === 412 || e.code === '412')) continue;
        logger.warn('s3PutPano: save failed', { code: e && e.code });
        throw bad('save-failed', 'שמירת התמונה נכשלה. נסו שוב.', 'unavailable');
      }
      full = pf; sm = ps;
    }
    if (!full) throw bad('busy', 'נסו שוב בעוד רגע', 'aborted');
  }
  let res;
  try {
    res = await db.runTransaction(async (tx) => {
      const [q, ms, ps, dd] = await Promise.all([tx.get(qref), tx.get(mref), tx.get(pcol), tx.get(dref)]);
      if (q.exists) return { dup: dupOf(q) };
      const st = check(ms, ps, dd, pt.id);
      if (!pt.id && ps.docs.some((d) => d.id === pid)) throw bad('busy', 'נסו שוב בעוד רגע', 'aborted');
      const o = st.old;
      if (img && o && Number.isInteger(o.ver) && o.ver >= ver) throw bad('busy', 'הנקודה הוחלפה בטלפון אחר. טענו מחדש.', 'aborted');
      // שכנות: נשלחו – כמו שהן; לא נשלחו – בהחלפה באותו מקום נשארות הקודמות, אחרת חיבור אוטומטי (עד 8 מ', בלי קיר באמצע)
      const ids = new Set(st.pts.map((x) => x.id));
      const nb = pt.nb ? pt.nb : (o && o.x === pt.x && o.y === pt.y && Array.isArray(o.nb) ? o.nb.filter((x) => ids.has(x)) : M.autoNb({ id: pid, x: pt.x, y: pt.y }, st.pts, st.map));
      const doc = { x: pt.x, y: pt.y, yaw: pt.yaw, nb, by: who.uid, upd: now };
      if (img) Object.assign(doc, { full, sm, w: img.full.w, h: img.full.h, sz: img.full.buf.length, ver, at: now });
      else Object.assign(doc, { full: o.full, sm: o.sm, w: o.w, h: o.h, sz: o.sz, ver: o.ver, at: o.at });
      tx.set(pcol.doc(pid), doc);
      const ch = M.linkNb(pid, nb, st.pts);
      for (const id of Object.keys(ch)) tx.update(pcol.doc(id), { nb: ch[id], upd: now });
      if (st.dayDoc) tx.set(dref, st.dayDoc);
      const r = { ok: true, mapId, id: pid, ver: doc.ver, full: doc.full, sm: doc.sm, w: doc.w, h: doc.h, x: doc.x, y: doc.y, yaw: doc.yaw, nb, linked: Object.keys(ch) };
      tx.set(qref, { k: 'pano', uid: who.uid, res: r, at: now, exp: now + QID_DAYS * D1 });
      return { r };
    });
  } catch (e) {
    if (full) await dropOwn(bk, pcol.doc(pid), mine);
    throw e;
  }
  if (res.dup) { if (full) await dropOwn(bk, pcol.doc(pid), mine); return res.dup; }
  return res.r;
}
exports.s3PutPano = onCall({ memory: '512MiB' }, T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!canDraw(who)) throw bad('not-s3m', 'העלאת נקודות 360 מותרת למנהל או לעובד עם הרשאת "שרטוט מפה"', 'permission-denied');
  return putPano(T.tdb(), { uid: who.uid, bizId: who.bizId, brs: myBranches(who) }, inputObject(request), Date.now());
}));

// מחיקה רכה (del:1, delAt, delBy) – מנהל בלבד, כמו מחיקת פריט במפה. הקבצים והמסמך נמחקים סופית ב-s3Clean אחרי 30 יום.
// הנקודה יוצאת גם מרשימות השכנות של שאר הנקודות. מחיקה חוזרת – { ok, dup: true }.
async function delPano(db, who, input, now) {
  const mapId = mapIdOf(input), br = mapId.slice(2);
  if (typeof input.id !== 'string' || !M.RE.pano.test(input.id)) throw bad('bad-pt', 'מזהה הנקודה לא תקין');
  brAllowed(who, br);
  await branchOk(db, who.bizId, br, mapId.charAt(0));
  const pcol = db.collection('smap/' + mapId + '/pano'), ref = pcol.doc(input.id);
  return db.runTransaction(async (tx) => {
    const ps = await tx.get(pcol);
    const d = ps.docs.find((x) => x.id === input.id);
    if (!d) throw bad('no-pano', 'הנקודה לא קיימת', 'not-found');
    if (d.get('del') === 1) return { ok: true, mapId, id: input.id, delAt: d.get('delAt'), dup: true };
    tx.update(ref, { del: 1, delAt: now, delBy: who.uid, upd: now });
    const pts = ps.docs.filter((x) => x.id !== input.id && x.get('del') !== 1).map((x) => ({ id: x.id, nb: x.get('nb') }));
    const ch = M.linkNb(input.id, [], pts);
    for (const id of Object.keys(ch)) tx.update(pcol.doc(id), { nb: ch[id], upd: now });
    return { ok: true, mapId, id: input.id, delAt: now };
  });
}
exports.s3DelPano = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (who.role !== 'manager') throw bad('del-mgr', 'מחיקת נקודת 360 – למנהל בלבד', 'permission-denied');
  return delPano(T.tdb(), { uid: who.uid, bizId: who.bizId, brs: myBranches(who) }, inputObject(request), Date.now());
}));

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_map', { enumerable: false, value: { saveMap, setBranch, putTex, branchOk, putPano, delPano, myBranches } });
