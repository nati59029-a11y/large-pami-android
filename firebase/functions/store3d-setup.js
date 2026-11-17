'use strict';
// הקמת חנות שלב 2 (17.11.2026): הערות ושאלות. הלוגיקה הטהורה ב-lib/store3d-setup.js. חוזה: 3.1, 3.1א, 3.2, 4, 6.
//   s3SetupNote { mapId, itemId?: '' = הערה כללית (עד 1000), t (עד 300 לפריט; '' = ניקוי), qid, m?: הטיוטה שבטלפון }
//     – כותב s3setup.gnote או s3setup/{mapId}/n/{itemId} = { t, upd, by, d: תיאור הפריט בזמן הכתיבה }. עד 500 הערות פריטים (nN).
//     itemId חייב להיות קיים: במפה השמורה; בלעדיה – בטיוטה שבטלפון (m, אותה בדיקה כמו בשמירה); בלעדיה – בטיוטה האחרונה (s3setup.draftId).
//   mapQs { mapId, qid, m? } – שאלות על הטיוטה (עד 12, עד 3 סבבים). מחוץ למכסה כמו mapFix: רק הבלם היומי לעובד (+1, לא מוחזר).
//     כותב s3setup.qs, qr+1, qConf, st='qs' (רק משלב שלפני הצילום). תשובה שבורה – ניסיון חוזר אחד, ואז שגיאה בלי כתיבה (s3qid נמחק).
//   s3SetupAns { mapId, qid, ans: [{ id, c, x }] } – הכותב היחיד של qs[].a. ערך לא תקין ⇒ הבקשה כולה נדחית.
//   כולן: התוספת פעילה; מנהל או עובד עם s3m; עובד ששויך לסניפים – רק בסניפים שלו; qid חוזר = אותה תשובה (dup), בלי כתיבה נוספת.
//   ביומן – רק שלב הכשל ואורך הפלט. לא את ההערות, לא את התשובות ולא את המפה.

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { defineSecret, defineString, defineInt } = require('firebase-functions/params');
const { getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue } = require('firebase-admin/firestore');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const scan = require('./lib/scan');
const A = require('./lib/store3d-ai');
const F = require('./lib/store3d-fix');
const S = require('./lib/store3d-setup');
const C = require('./lib/store3d-core');

if (!getApps().length) initializeApp();

// אותם פרמטרים כמו ב-store3d-fix.js (אותו שם = פרמטר אחד)
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_API_BASE = defineString('GEMINI_API_BASE', { default: 'https://generativelanguage.googleapis.com', description: 'כתובת השירות של Gemini' });
const S3_USER_DAILY = defineInt('S3_USER_DAILY', { default: 400, description: 'סריקת חנות: מספר תמונות מרבי ביום לכל משתמש (בלם בטיחות)' });

const QID_DAYS = 30, D1 = 86400000, BUSY_MS = 5 * 60000;
const TIMES = { timeoutMs: 90000, budgetMs: 200000 }, MAX_OUT = 16384, RETRY_MIN_MS = 30000;
const bad = (reason, msg, code, extra) => new HttpsError(code || 'invalid-argument', msg, Object.assign({ reason }, extra || {}));
const CODE = { 's3-user-day': 'resource-exhausted', 'too-big': 'invalid-argument' };
const toHttps = (e) => (e instanceof HttpsError || !e || !e.code ? e : bad(e.code, e.message, CODE[e.code] || 'invalid-argument'));
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const canDraw = (who) => who.role === 'manager' || hasPerm(who, 's3m');
const mapLib = () => require('./store3d-map')._map;   // branchOk, myBranches – משותף
const qidRec = (k, uid, now, res) => Object.assign({ k, uid, at: now, exp: now + QID_DAYS * D1 }, res ? { res } : {});

function brAllowed(who, br) {
  if (who.brs && !who.brs.includes(br)) throw bad('other-branch', 'הסניף הזה לא משויך אליך', 'permission-denied');
}
// qid חוזר אחרי הצלחה: אותה תשובה. qid של פעולה אחרת / משתמש אחר – נדחה
async function dupOf(db, qid, k, uid) {
  const q = await db.doc('s3qid/' + qid).get();
  if (!q.exists) return null;
  if (q.get('k') !== k || q.get('uid') !== uid) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
  return q.get('res') ? Object.assign({}, q.get('res'), { dup: true }) : null;
}
// המפה שעליה עובדים: השמורה; בלעדיה – הטיוטה שבטלפון (אותה בדיקה כמו בשמירה); בלעדיה – הטיוטה האחרונה בשרת. null = אין.
async function mapOf(db, who, mapId, m, sd) {
  const ms = await db.doc('smap/' + mapId).get();
  if (ms.exists && ms.get('del') !== 1) return { map: ms.data(), src: 'map' };
  if (m) {
    try { A.draftCheck(m, { bizId: who.bizId, mapId, uid: who.uid, now: Date.now() }); } catch (e) {
      throw bad(e.code === 'too-big' ? 'too-big' : 'bad-map', e.code === 'too-big' ? 'הטיוטה גדולה מדי' : 'הטיוטה לא תקינה: ' + String(e.message || '').slice(0, 160));
    }
    return { map: m, src: 'phone' };
  }
  const did = sd && typeof sd.draftId === 'string' ? sd.draftId : '';
  if (did) {
    const ds = await db.doc('s3draft/' + did).get();
    if (ds.exists && ds.get('st') === 'ok' && isObj(ds.get('m'))) return { map: ds.get('m'), src: 'draft' };
  }
  return null;
}
const PREST = (sd) => !sd || !sd.st || S.PRE.includes(sd.st);

// ---------------- s3SetupNote ----------------
async function noteCore(db, who, input, now) {
  let x;
  try { x = S.noteInput(input); } catch (e) { throw toHttps(e); }
  const { mapId, itemId, t, qid, from } = x, br = mapId.slice(2);
  brAllowed(who, br);
  const d0 = await dupOf(db, qid, 'note', who.uid);
  if (d0) return d0;
  await mapLib().branchOk(db, who.bizId, br, mapId.charAt(0));
  const sref = db.doc('s3setup/' + mapId), qref = db.doc('s3qid/' + qid);
  let items = null, on = 'draft';
  if (itemId) {
    const s0 = await sref.get();
    const mm = await mapOf(db, who, mapId, x.m, s0.exists ? s0.data() : null);
    if (mm) { items = S.itemsOf(mm.map); on = mm.src === 'map' ? 'map' : 'draft'; }
    else if (t || from) throw bad('no-draft', 'אין עדיין מפה או טיוטה. אפשר לכתוב עכשיו רק הערה כללית.', 'failed-precondition');
  }
  const res = { ok: true, mapId, itemId, t };
  if (from) res.from = from;
  await db.runTransaction(async (tx) => {
    const nref = itemId ? db.doc(`s3setup/${mapId}/n/${itemId}`) : null, fref = from ? db.doc(`s3setup/${mapId}/n/${from}`) : null;
    const [q, ss, ns, fs] = await Promise.all([tx.get(qref), tx.get(sref), nref ? tx.get(nref) : null, fref ? tx.get(fref) : null]);
    if (q.exists) return;
    const sd = ss.exists ? ss.data() : null;
    const o = Object.assign(sd ? {} : { v: 1 }, { upd: now, by: who.uid });
    if (PREST(sd) && (!sd || sd.st !== 'qs')) o.st = 'notes';
    const nN = sd && Number.isInteger(sd.nN) ? sd.nN : 0;
    if (!itemId) Object.assign(o, { gnote: t, gnoteAt: now, gnoteBy: who.uid });
    else {
      const desc = items ? items.get(itemId) : '';
      const cur = ns && ns.exists ? ns.data() : null;
      const st = cur ? S.noteState(cur, itemId, items || new Map()) : 'empty';
      if (from) {
        // שיוך מחדש: הערה שמחכה לשיוך עוברת לפריט שנבחר (העברה, לא מחיקה). אם לפריט כבר יש הערה – הטקסטים מתחברים (עד 300)
        if (!fs.exists || typeof fs.get('t') !== 'string' || !fs.get('t').trim()) throw bad('no-note', 'ההערה לשיוך לא נמצאה. טענו מחדש.', 'failed-precondition');
        if (!desc) throw bad('no-item', 'הפריט הזה לא נמצא במפה. טענו מחדש ונסו שוב.', 'failed-precondition');
        if (st === 're') throw bad('note-re', 'גם לפריט הזה יש הערה שמחכה לשיוך. שייכו או מחקו אותה קודם.', 'failed-precondition');
        const tt = st === 'ok' ? cur.t + ' · ' + t : t;
        if (tt.length > S.SET.note) throw bad('bad-note', `לפריט הזה כבר יש הערה, ויחד הן ארוכות מ-${S.SET.note} תווים. קצרו ונסו שוב.`);
        tx.set(nref, { t: tt, upd: now, by: who.uid, d: desc, on });
        tx.delete(fref);
        if (cur) o.nN = Math.max(0, nN - 1);
        res.t = tt;
      } else if (cur && st === 're') {
        // הערה "לשיוך מחדש" לא נקשרת בשקט לפריט שנמצא עכשיו במספר הזה: רק ניקוי (המסמך נשאר) או שיוך מחדש (from)
        if (t) throw bad('note-re', 'להערה הזו יש פריט מטיוטה קודמת. שייכו אותה לפריט או מחקו אותה.', 'failed-precondition');
        tx.update(nref, { t: '', upd: now, by: who.uid, re: FieldValue.delete() });
      } else if (cur) {
        if (t && !desc) throw bad('no-item', 'הפריט הזה לא נמצא במפה. טענו מחדש ונסו שוב.', 'failed-precondition');
        tx.update(nref, Object.assign({ t, upd: now, by: who.uid }, t ? { d: desc, on } : {}));
      } else if (t) {
        if (!desc) throw bad('no-item', 'הפריט הזה לא נמצא במפה. טענו מחדש ונסו שוב.', 'failed-precondition');
        if (nN >= S.SET.notesMax) throw bad('notes-max', `אפשר עד ${S.SET.notesMax} הערות לפריטים במפה`, 'resource-exhausted');
        tx.set(nref, { t, upd: now, by: who.uid, d: desc, on });
        o.nN = nN + 1;
      }
    }
    tx.set(sref, o, { merge: true });
    tx.set(qref, qidRec('note', who.uid, now, res));
  });
  return res;
}

// ---------------- mapQs ----------------
async function ask(deps, prompt, deadline) {
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } };
  const r = await scan.callGemini(String(deps.base).replace(/\/+$/, ''), deps.key, body, TIMES.timeoutMs, false, { deadline, stats: { sent: 0 }, maxOut: MAX_OUT });
  return { obj: scan.parseLikeApp(r.text), finish: r.finish || '', len: String(r.text || '').length };
}
// ההערות השמורות ← { gnote, notes: [{ id, d, t }] } (רק לא ריקות, עד 500)
async function notesOf(db, mapId, sd, items) {
  const ns = await db.collection(`s3setup/${mapId}/n`).limit(S.SET.notesMax).get();
  // st: 'ok' = על הפריט שבמזהה; 're' = לשיוך מחדש (הפריט במזהה הזה כבר אחר) – נשלח ל-AI בלי המזהה
  const notes = ns.docs.filter((d) => typeof d.get('t') === 'string' && d.get('t').trim())
    .map((d) => ({ id: d.id, d: typeof d.get('d') === 'string' && d.get('d') ? d.get('d') : items.get(d.id) || d.id, t: d.get('t'), st: S.noteState(d.data(), d.id, items) }));
  return { gnote: sd && typeof sd.gnote === 'string' ? sd.gnote : '', notes };
}
async function qsCore(db, who, input, now, deps) {
  if (!isObj(input)) throw bad('bad-input', 'הבקשה לא תקינה');
  if (typeof input.qid !== 'string' || !C.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  if (typeof input.mapId !== 'string' || !C.RE.map.test(input.mapId)) throw bad('bad-map-id', 'מזהה המפה לא תקין');
  const m = input.m === undefined || input.m === null ? null : input.m;
  if (m !== null && !isObj(m)) throw bad('bad-map', 'הטיוטה לא תקינה');
  const qid = input.qid, mapId = input.mapId, br = mapId.slice(2), kind = mapId.charAt(0);
  brAllowed(who, br);
  const d0 = await dupOf(db, qid, 'qs', who.uid);
  if (d0) return d0;
  await mapLib().branchOk(db, who.bizId, br, kind);
  const sref = db.doc('s3setup/' + mapId), qref = db.doc('s3qid/' + qid), uref = db.doc('s3use/u_' + who.uid);
  const s0 = await sref.get(), sd = s0.exists ? s0.data() : null;
  const qr0 = sd && Number.isInteger(sd.qr) ? sd.qr : 0;
  if (qr0 >= S.SET.qrMax) throw bad('qs-max', `כבר היו ${S.SET.qrMax} סבבי שאלות. אפשר להמשיך לתקן בכתב או בעורך.`, 'resource-exhausted');
  const mm = await mapOf(db, who, mapId, m, sd);
  if (!mm) throw bad('no-draft', 'אין עדיין טיוטה. בנו טיוטה קודם.', 'failed-precondition');
  if (!deps.key) throw bad('no-key', 'אין מפתח לזיהוי חכם בשרת', 'failed-precondition');
  const items = S.itemsOf(mm.map);
  const nt = await notesOf(db, mapId, sd, items);
  const set = await db.doc('s3set/' + br).get();
  const prompt = S.buildQsPrompt({
    kind, storeType: set.exists ? set.get('stype') : '', cur: S.toQsModel(mm.map), round: qr0 + 1,
    gnote: nt.gnote, notes: nt.notes.map((n) => (n.st === 'ok' ? { פריט: n.d, id: n.id, t: n.t } : { פריט: n.d, מצב: 'פריט מטיוטה קודמת – לא ידוע אם הוא עדיין במפה', t: n.t })), prev: S.answered(sd && sd.qs),
  });
  // רק הבלם היומי לעובד + s3qid, בטרנזקציה אחת לפני Gemini
  const dup = await db.runTransaction(async (tx) => {
    const [q, u] = await Promise.all([tx.get(qref), tx.get(uref)]);
    if (q.exists) {
      const d = q.data();
      if (d.k !== 'qs' || d.uid !== who.uid) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
      if (d.res) return d.res;
      if (Number.isInteger(d.at) && d.at > now - BUSY_MS) throw bad('busy', 'השאלות עדיין בהכנה. נסו שוב בעוד דקה.', 'aborted');
    }
    let un;
    try { un = F.userDayStep(u.exists ? u.data() : null, scan.israelDay(new Date(now)), now, deps.userMax); } catch (e) { throw toHttps(e); }
    tx.set(uref, un);
    tx.set(qref, qidRec('qs', who.uid, now));
    return null;
  });
  if (dup) return Object.assign({}, dup, { dup: true });
  const back = async (e) => {
    try {
      await db.runTransaction(async (tx) => {
        const q = await tx.get(qref);
        if (q.exists && !q.get('res') && q.get('uid') === who.uid) tx.delete(qref);
      });
    } catch (e2) { logger.error('mapQs: release failed', { code: e2 && e2.code }); }
    throw e;
  };
  const deadline = Date.now() + TIMES.budgetMs, ids = new Set(items.keys());
  const check = (rp, n) => {
    if (rp.finish === 'MAX_TOKENS') { logger.warn('mapQs: cut', { try: n, len: rp.len }); return { why: 'cut' }; }
    if (rp.obj === null || rp.obj === undefined) { logger.warn('mapQs: parse', { try: n, len: rp.len }); return { why: 'parse' }; }
    try { return { v: S.qsClean(rp.obj, ids) }; } catch (e) { logger.warn('mapQs: bad answer', { try: n, why: e.why || '', len: rp.len }); return { why: e.why || 'not-obj' }; }
  };
  let r;
  try { r = check(await ask(deps, prompt, deadline), 1); } catch (e) {
    return back(e instanceof HttpsError ? e : bad('internal', 'שגיאה בהכנת השאלות', 'internal'));
  }
  if (r.why && deadline - Date.now() >= RETRY_MIN_MS) {
    try { r = check(await ask(deps, prompt, deadline), 2); } catch (e) { logger.warn('mapQs: retry failed', { code: (e && e.code) || '' }); }
  }
  if (r.why) return back(bad('bad-answer', S.qsMsg(r.why), 'internal', { why: r.why }));
  const v = r.v;
  let res;
  try {
    res = await db.runTransaction(async (tx) => {
      const ss = await tx.get(sref), cur = ss.exists ? ss.data() : null;
      const qr = cur && Number.isInteger(cur.qr) ? cur.qr : 0;
      if (qr >= S.SET.qrMax) throw bad('qs-max', `כבר היו ${S.SET.qrMax} סבבי שאלות.`, 'resource-exhausted');
      const o = Object.assign(cur ? {} : { v: 1 }, { qs: v.qs, qr: qr + 1, upd: now, by: who.uid });
      if (v.conf !== null) o.qConf = v.conf;
      if (PREST(cur)) o.st = 'qs';
      const out = { ok: true, mapId, qs: v.qs, qr: qr + 1, conf: v.conf, drop: v.drop };
      tx.set(sref, o, { merge: true });
      tx.update(qref, { res: out });
      return out;
    });
  } catch (e) {
    logger.error('mapQs: write failed', { code: e && e.code });
    return back(e instanceof HttpsError ? e : bad('save-failed', 'שמירת השאלות נכשלה. נסו שוב.', 'unavailable'));
  }
  return res;
}

// ---------------- s3SetupAns ----------------
async function ansCore(db, who, input, now) {
  if (!isObj(input)) throw bad('bad-input', 'הבקשה לא תקינה');
  if (typeof input.qid !== 'string' || !C.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  if (typeof input.mapId !== 'string' || !C.RE.map.test(input.mapId)) throw bad('bad-map-id', 'מזהה המפה לא תקין');
  const qid = input.qid, mapId = input.mapId, br = mapId.slice(2);
  brAllowed(who, br);
  const d0 = await dupOf(db, qid, 'ans', who.uid);
  if (d0) return d0;
  await mapLib().branchOk(db, who.bizId, br, mapId.charAt(0));
  const sref = db.doc('s3setup/' + mapId), qref = db.doc('s3qid/' + qid);
  return db.runTransaction(async (tx) => {
    const [q, ss] = await Promise.all([tx.get(qref), tx.get(sref)]);
    if (q.exists) return Object.assign({}, q.get('res') || {}, { dup: true });
    const qs = ss.exists && Array.isArray(ss.get('qs')) ? ss.get('qs') : [];
    if (!qs.length) throw bad('no-qs', 'אין שאלות פתוחות. טענו מחדש.', 'failed-precondition');
    // qr (לא חובה): סבב השאלות שהטלפון ענה עליו. סבב אחר בינתיים (המזהים q1.. חוזרים בכל סבב) ⇒ נדחה
    if (input.qr !== undefined && input.qr !== null && input.qr !== (Number.isInteger(ss.get('qr')) ? ss.get('qr') : 0)) throw bad('stale-qs', 'השאלות התחלפו בינתיים. טענו מחדש וענו שוב.', 'failed-precondition');
    let A2;
    try { A2 = S.ansInput(input.ans, qs); } catch (e) { throw toHttps(e); }
    const nq = qs.map((x) => (A2.has(x.id) ? Object.assign({}, x, { a: Object.assign({}, A2.get(x.id), { at: now, by: who.uid }) }) : x));
    const res = { ok: true, mapId, n: A2.size, left: nq.filter((x) => !isObj(x.a)).length };
    tx.set(sref, { qs: nq, upd: now, by: who.uid }, { merge: true });
    tx.set(qref, qidRec('ans', who.uid, now, res));
    return res;
  });
}

const depsOf = () => ({ base: GEMINI_API_BASE.value(), key: GEMINI_API_KEY.value(), userMax: S3_USER_DAILY.value() });
const whoOf = (who) => ({ uid: who.uid, bizId: who.bizId, brs: mapLib().myBranches(who) });
async function staffDraw(request) {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!canDraw(who)) throw bad('not-s3m', 'הערות ושאלות ההקמה מותרות למנהל או לעובד עם הרשאת "שרטוט מפה"', 'permission-denied');
  return who;
}
exports.s3SetupNote = onCall(T.scoped(async (request) => {
  const who = await staffDraw(request);
  return noteCore(T.tdb(), whoOf(who), inputObject(request), Date.now());
}));
exports.mapQs = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '512MiB' }, T.scoped(async (request) => {
  const who = await staffDraw(request);
  return qsCore(T.tdb(), whoOf(who), inputObject(request), Date.now(), depsOf());
}));
exports.s3SetupAns = onCall(T.scoped(async (request) => {
  const who = await staffDraw(request);
  return ansCore(T.tdb(), whoOf(who), inputObject(request), Date.now());
}));

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_setup', { enumerable: false, value: { noteCore, qsCore, ansCore, notesOf } });
