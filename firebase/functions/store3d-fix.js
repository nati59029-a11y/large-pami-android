'use strict';
// סריקת חנות בתלת מימד – שלב 20ג, חלק השרת (15.11.2026): mapFix – תיקון טיוטת מפה בכתב. הלוגיקה הטהורה ב-lib/store3d-fix.js.
//   mapFix { qid, br, kind: 's' | 'w', m: הטיוטה הנוכחית (מבנה המפה 4.3, כמו s3draft.m), txt: טקסט התיקון (2–1000 תווים),
//            ans?, notes?: bool (הקמת חנות שלב 2 – לצרף תשובות/הערות שמורות; עם אחד מהם txt לא חובה; כותב גם s3setup.draftId),
//            sk?: סקיצה במבנה של mapDraft + info? עם w/l (אותה בדיקה; לא נשמרת), from?: מזהה הטיוטה הקודמת (לתיעוד בלבד) }
//     – מנהל או s3m (כמו mapDraft), עובד ששויך לסניפים – רק בסניפים שלו. בלי תמונות.
//     הטיוטה הנוכחית חייבת לעבור את בדיקת שמירת המפה (A.draftCheck); הטיוטה המתוקנת עוברת את אותה בדיקה כמו בהקמה (A.evalDraft),
//     כולל השמטת פריטים פסולים וניסיון חוזר אחד כשהתשובה שבורה, באותו תקציב זמן.
//     מכסה (החלטת המשתמש 15.11.2026): בלי הגבלה – לא במכסה החודשית, לא ב-5 ההקמות ביום ולא בתקרה נפרדת. רק הבלם היומי לעובד
//     (s3use/u_{uid}, S3_USER_DAILY = 400) עולה ב-1, באותה טרנזקציה עם s3qid (k:'fix'), ולא מוחזר.
//     כותב s3draft/{qid} (wait → ok / fail, fix:1, from?). מחזיר { draftId, st, m, conf, scale, notes, drop, fix:true }.
//     qid חוזר אחרי הצלחה – אותה תשובה (עם m מ-s3draft) ו-dup:true, בלי Gemini ובלי בלם. בכשל s3qid נמחק (אפשר לנסות שוב).
//     ביומן – רק שלב הכשל, finishReason ואורך הפלט. לא את טקסט המשתמש, לא את הטיוטה ולא את התשובה.

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { defineSecret, defineString, defineInt } = require('firebase-functions/params');
const { getApps, initializeApp } = require('firebase-admin/app');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const scan = require('./lib/scan');
const A = require('./lib/store3d-ai');
const F = require('./lib/store3d-fix');
const SL = require('./lib/store3d-setup');

if (!getApps().length) initializeApp();

// אותם פרמטרים כמו ב-index.js וב-store3d-ai.js (אותו שם = פרמטר אחד)
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_API_BASE = defineString('GEMINI_API_BASE', { default: 'https://generativelanguage.googleapis.com', description: 'כתובת השירות של Gemini' });
const S3_USER_DAILY = defineInt('S3_USER_DAILY', { default: 400, description: 'סריקת חנות: מספר תמונות מרבי ביום לכל משתמש (בלם בטיחות)' });

const QID_DAYS = 30, D1 = 86400000, BUSY_MS = 5 * 60000;
// טקסט בלבד: עד 120 שניות לניסיון, 240 לכל הניסיונות; הפונקציה 300 שניות. maxOutputTokens כמו בהקמה (65,536, לא מאומת כאן)
const TIMES = { timeoutMs: 120000, budgetMs: 240000 }, MAX_OUT = 65536, RETRY_MIN_MS = 45000;
const bad = (reason, msg, code, extra) => new HttpsError(code || 'invalid-argument', msg, Object.assign({ reason }, extra || {}));
const CODE = { 'too-big': 'invalid-argument', 's3-user-day': 'resource-exhausted' };
const toHttps = (e) => (e instanceof HttpsError || !e || !e.code ? e : bad(e.code, e.message, CODE[e.code] || 'invalid-argument'));
const mapLib = () => require('./store3d-map')._map;   // branchOk – בדיקת סניף משותפת (קיים, פעיל, מחסן)

function myBranches(who) {
  if (!who || who.role === 'manager') return null;
  const brs = who.staff && who.staff.exists ? who.staff.get('br') : null;
  return Array.isArray(brs) ? brs.filter((b) => typeof b === 'string') : null;
}

async function ask(deps, prompt, deadline) {
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } };
  const r = await scan.callGemini(String(deps.base).replace(/\/+$/, ''), deps.key, body, TIMES.timeoutMs, false, { deadline, stats: { sent: 0 }, maxOut: MAX_OUT });
  return { obj: scan.parseLikeApp(r.text), model: String(r.model || '').slice(0, 60) || 'unknown', finish: r.finish || '', len: String(r.text || '').length };
}

// who = { uid, bizId, brs }; deps = { base, key, userMax }
async function fixCore(db, who, input, now, deps) {
  let x;
  try { x = F.fixInput(input); } catch (e) { throw toHttps(e); }
  const { qid, br, kind } = x;
  if (who.brs && !who.brs.includes(br)) throw bad('other-branch', 'הסניף הזה לא משויך אליך', 'permission-denied');
  // qid חוזר אחרי הצלחה – לפני כל בדיקה כבדה
  const q0 = await db.doc('s3qid/' + qid).get();
  if (q0.exists && q0.get('res')) {
    const d = q0.data();
    if (d.k !== 'fix' || d.uid !== who.uid) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
    const s = await db.doc('s3draft/' + qid).get();
    return Object.assign({}, d.res, s.exists && s.get('m') ? { m: s.get('m') } : {}, { dup: true });
  }
  await mapLib().branchOk(db, who.bizId, br, kind);
  const ectx = { br, kind, numDir: x.m.numDir, bizId: who.bizId, uid: who.uid, now };
  try { A.draftCheck(x.m, { bizId: who.bizId, mapId: kind + '-' + br, uid: who.uid, now }); } catch (e) {
    throw bad(e.code === 'too-big' ? 'too-big' : 'bad-map', e.code === 'too-big' ? 'הטיוטה הנוכחית גדולה מדי' : 'הטיוטה הנוכחית לא תקינה: ' + String(e.message || '').slice(0, 160));
  }
  if (!deps.key) throw bad('no-key', 'אין מפתח לזיהוי חכם בשרת', 'failed-precondition');
  const set = await db.doc('s3set/' + br).get();
  const S = set.exists ? set.data() : {};
  // הקמת חנות שלב 2: ans – התשובות השמורות (s3setup.qs[].a, רק קריאה); notes – ההערה הכללית והערות הפריטים (עם תיאור הפריט מזמן הכתיבה)
  const mapId = kind + '-' + br, sref = db.doc('s3setup/' + mapId);
  let qa = [], gnote = '', notes = [];
  if (x.ans || x.notes) {
    const ss = await sref.get(), sd = ss.exists ? ss.data() : null;
    if (x.ans) qa = SL.answered(sd && sd.qs);
    if (x.notes) {
      const items = SL.itemsOf(x.m);
      gnote = sd && typeof sd.gnote === 'string' ? sd.gnote : '';
      const ns = await db.collection(`s3setup/${mapId}/n`).limit(SL.SET.notesMax).get();
      // ההערה הולכת אחרי הפריט הפיזי (g): התיאור של הפריט הנוכחי. "לשיוך מחדש" (לא נמצא / לא חד-משמעי) – התיאור המקורי וסימון
      const G = SL.NK.geoIndex(x.m);
      notes = ns.docs.filter((d) => typeof d.get('t') === 'string' && d.get('t').trim()).map((d) => {
        const r = SL.NK.noteTo(d.data(), d.id, G), d0 = typeof d.get('d') === 'string' && d.get('d') ? d.get('d') : d.id;
        return r.st === 'ok' ? { פריט: items.get(r.to) || d0, t: d.get('t') } : { פריט: d0, t: d.get('t'), מצב: 'פריט מטיוטה קודמת – לא ידוע אם הוא עדיין במפה' };
      });
    }
    if (!x.txt && !qa.length && !gnote && !notes.length) throw bad('nothing', 'אין עדיין תשובות או הערות. ענו על השאלות, כתבו הערה, או כתבו מה לתקן.', 'failed-precondition');
  }
  const dref = db.doc('s3draft/' + qid), qref = db.doc('s3qid/' + qid), uref = db.doc('s3use/u_' + who.uid);
  const base = Object.assign({ br, kind, by: who.uid, at: now, n: 0, fix: 1 }, x.from ? { from: x.from } : {});
  // רק הבלם היומי לעובד + s3qid + s3draft (wait), בטרנזקציה אחת לפני Gemini
  const dup = await db.runTransaction(async (tx) => {
    const [q, u] = await Promise.all([tx.get(qref), tx.get(uref)]);
    if (q.exists) {
      const d = q.data();
      if (d.k !== 'fix' || d.uid !== who.uid) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
      if (d.res) return d.res;
      if (Number.isInteger(d.at) && d.at > now - BUSY_MS) throw bad('busy', 'התיקון הזה עדיין בעבודה. נסו שוב בעוד דקה.', 'aborted');
    }
    let un;
    try { un = F.userDayStep(u.exists ? u.data() : null, scan.israelDay(new Date(now)), now, deps.userMax); } catch (e) { throw toHttps(e); }
    tx.set(uref, un);
    tx.set(qref, { k: 'fix', uid: who.uid, at: now, exp: now + QID_DAYS * D1 });
    tx.set(dref, Object.assign({}, base, { st: 'wait' }));
    return null;
  });
  if (dup) {
    const s = await dref.get();
    return Object.assign({}, dup, s.exists && s.get('m') ? { m: s.get('m') } : {}, { dup: true });
  }
  // כשל: s3qid נמחק (אפשר לנסות שוב עם אותו qid), s3draft = fail. הבלם היומי לא מוחזר.
  const back = async (e, why) => {
    try {
      await db.runTransaction(async (tx) => {
        const q = await tx.get(qref);
        if (q.exists && !q.get('res') && q.get('uid') === who.uid) tx.delete(qref);
        tx.set(dref, Object.assign({}, base, { st: 'fail', err: String(e.message || 'שגיאה').slice(0, 120) }, why ? { why } : {}));
      });
    } catch (e2) { logger.error('mapFix: release failed', { code: e2 && e2.code }); }
    throw e;
  };
  let prompt;
  try { prompt = F.buildFixPrompt({ kind, storeType: S.stype, cur: F.toModel(x.m), txt: x.txt, sk: x.sk, qa, gnote, notes }); } catch (e) {
    return back(bad('internal', 'שגיאה בתיקון הטיוטה', 'internal'));
  }
  const deadline = Date.now() + TIMES.budgetMs;
  const check = (rp, tryN) => {
    const v = A.evalDraft(rp.obj, rp.finish, ectx);
    if (v.why) logger.warn('mapFix: bad answer', { try: tryN, why: v.why, code: v.code || '', finish: rp.finish, len: rp.len, model: rp.model });
    else if (v.fit) logger.info('mapFix: items dropped by map check', { try: tryN, fit: v.fit });
    return v;
  };
  let v;
  try { v = check(await ask(deps, prompt, deadline), 1); } catch (e) {
    return back(e instanceof HttpsError ? e : bad('internal', 'שגיאה בתיקון הטיוטה', 'internal'));
  }
  if (v.why && deadline - Date.now() >= RETRY_MIN_MS) {
    try {
      const v2 = check(await ask(deps, prompt, deadline), 2);
      v = v2.why === 'parse' && v.why === 'cut' ? v : v2;
    } catch (e) {
      logger.warn('mapFix: retry failed', { reason: (e && e.details && e.details.reason) || (e && e.code) || '', why: v.why });
    }
  }
  if (v.why) return back(bad('bad-answer', F.fixMsg(v.why), 'internal', { why: v.why }), v.why);
  const d = v.d;
  // שם המפה ורשת ההצמדה – כמו בטיוטה הנוכחית (cleanDraft קובע ברירת מחדל)
  if (typeof x.m.name === 'string' && x.m.name.trim()) d.map.name = x.m.name.trim().slice(0, 40);
  if ([25, 50, 100].includes(x.m.grid)) d.map.grid = x.m.grid;
  const res = Object.assign({ draftId: qid, st: 'ok', conf: d.conf, drop: d.drop, fix: true }, x.ans || x.notes ? { used: { qa: qa.length, nt: notes.length + (gnote ? 1 : 0) } } : {});
  try {
    await db.runTransaction(async (tx) => {
      // הקמת חנות (חוזה 4): s3setup.draftId = הטיוטה המתוקנת. merge – שאר השדות לא נוגעים; st רק כשאין עדיין הקמה
      const ss = await tx.get(sref);
      tx.set(sref, Object.assign(ss.exists && ss.get('st') ? {} : { v: 1, st: 'draft' }, { draftId: qid, upd: now, by: who.uid }), { merge: true });
      tx.set(dref, Object.assign({}, base, { st: 'ok', m: d.map }, typeof d.conf === 'number' ? { conf: d.conf } : {}, d.notes ? { notes: d.notes } : {}));
      tx.update(qref, { res });
    });
  } catch (e) {
    logger.error('mapFix: write failed', { code: e && e.code });
    return back(bad('save-failed', 'שמירת הטיוטה המתוקנת נכשלה. נסו שוב.', 'unavailable'));
  }
  return Object.assign({}, res, { m: d.map, scale: d.scale, notes: d.notes });
}

const depsOf = () => ({ base: GEMINI_API_BASE.value(), key: GEMINI_API_KEY.value(), userMax: S3_USER_DAILY.value() });
exports.mapFix = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '512MiB' }, T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!(who.role === 'manager' || hasPerm(who, 's3m'))) throw bad('not-s3m', 'תיקון טיוטה מותר למנהל או לעובד עם הרשאת "שרטוט מפה"', 'permission-denied');
  return fixCore(T.tdb(), { uid: who.uid, bizId: who.bizId, brs: myBranches(who) }, inputObject(request), Date.now(), depsOf());
}));

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_fix', { enumerable: false, value: { fixCore } });
