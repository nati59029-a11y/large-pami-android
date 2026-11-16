'use strict';
// סריקת חנות בתלת מימד – שלב 8 (14.11.2026): בדיקות AI בשרת. הלוגיקה הטהורה ב-lib/store3d-ai.js, ההנחיות ב-lib/prompts-shelf.js
// ו-lib/prompts-mapdraft.js (שלב 6). אותו דפוס כמו scanDocument: הרשאה ← בדיקת קלט ← הזמנת מכסה בטרנזקציה ← Gemini ← החזרה בכשל.
//   shelfCheck { qid, mode: 'run' | 'adhoc', run?, map?, slot, at, src, rt?, img, th, txt? }
//     run   – רק העובד שהמקטע משויך לו בסבב open/late (או מנהל). adhoc – דיווח יזום של כל הצוות (map חובה), נספר במכסה,
//             ונפתח לו סבב יזום ad_<qid> (k:'adhoc', st:'done'). verify { fix } – צילום אימות של משימת תיקון (שלב 10, verifyCore).
//     תמונה עם אדם (תשובת המודל st:'person') – הקובץ לא נשמר ב-Storage; נשמר רק ph עם person:true ותוצאה person.
//     מחסן (w-) – noprice/pricepos/promoexp נמחקים בשרת גם אם המודל החזיר אותם. הערות קבועות (bay.notes), "מה אמור להיות" (bay.exp),
//     סוג החנות, קטגוריות, הצילום הקודם ותאריך היום – נשלחים כהקשר (רק מהשרת, לא מהלקוח). pid – לפי bay.exp או שם זהה בקטלוג (prod).
//     כותב: srun/{run}/ph/{slot}, srun/{run}/ai/{slot}, nDone/nUid בסבב (רק ok/issue/review נחשב "צולם"), s3sum/{map}.b[bay].
//     מחזיר { st, iss:[{k,sev,t,box}], usage:{m,n,cap,w80}, runId, ask?, t?, sug? }.
//     שלב 20א: בסבב נשלחים להנחיה עד 8 מקטעים מועמדים (שכנים במסלול, רק של העובד, רק עם מידע מהצילום האחרון). ניחוש תקין של המודל
//     נשמר ב-ai.slot = { s, c }; אם הוא מקטע אחר בביטחון A.SUG_MIN ומעלה – גם ph.sug = { s, c } ו-sug בתשובה (הצעה בלבד, נספר 1 כרגיל).
//   s3MovePh { run, from, to } – שלב 20ב: העברת תמונה ותוצאה בין מקטעים של אותו עובד בסבב פתוח (בלי AI ובלי מכסה; ראו moveCore).
//   mapDraft { qid, br, kind: 's' | 'w', imgs: [base64 JPEG, עד 100, סך הכל עד 13MB], cctv? } – מנהל או s3m. נספרת כבדיקה אחת
//     במכסה (וגם בבלם היומי), בלי קשר למספר התמונות (החלטת המשתמש 15.11.2026); בהחזרה מוחזרת בדיקה אחת.
//     כותב s3draft/{qid} (wait → ok / fail). המפה המוצעת במבנה 4.3, ואזורים שהמודל לא בטוח בהם ב-uz עם ok:false.
//     התמונות עצמן לא נשמרות (אין צורך; ואין בדיקת "אדם בתמונה" בטיוטה). מחזיר { draftId, st, m, conf, scale, notes, drop, usage }.
// מכסה (4.15): s3use/b_{br} – חודשית לסניף (תקרה s3br.cap, ברירת מחדל 500), אזהרה למנהלים ב-80% (פעם בחודש, s3ntf);
//   s3use/u_{uid} – בלם יומי לעובד (S3_USER_DAILY, ברירת מחדל 400). ההזמנה ויצירת s3qid – באותה טרנזקציה, לפני Gemini.
//   s3use/d_{br} – עד 5 הקמות (mapDraft) ביום לסניף, לפי יום בשעון ישראל (החלטת המשתמש 15.11.2026); חוזר ב-1 כשהמכסה מוחזרת.
//   תיקון סבב 1 (החלטת המשתמש): Gemini ענה (גם תשובה שבורה / לא JSON) = הבדיקה נספרת ולא מוחזרת, כמו scanDocument. המכסה מוחזרת רק
//   כשהבקשה לא הגיעה ל-AI או נדחתה בלי חיוב (429/עמוס, ניתוק, timeout לפני תשובה, כשל לפני הפנייה). בכל כשל s3qid נמחק (אפשר לנסות שוב).
//   הבלם היומי לא מוחזר. דיווח יזום של עובד: עד 20 ביום (s3use/a_{uid}), בנוסף למכסה החודשית; מנהל – בלי המונה הזה.
//   עובד ששויך לסניפים (staff.br) – דיווח יזום וטיוטה רק בסניפים שלו.
//   qid חוזר אחרי הצלחה מחזיר את התשובה השמורה (מקוצרת) עם dup:true, בלי מכסה ובלי Gemini.

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { defineSecret, defineString, defineInt } = require('firebase-functions/params');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
const { FieldValue } = require('firebase-admin/firestore');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const scan = require('./lib/scan');
const A = require('./lib/store3d-ai');
const C = require('./lib/store3d-core');
const PS = require('./lib/prompts-shelf');
const PM = require('./lib/prompts-mapdraft');
const X = require('./lib/store3d-extra');

if (!getApps().length) initializeApp();

// אותם פרמטרים כמו ב-index.js (defineSecret/defineString עם אותו שם = פרמטר אחד)
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_API_BASE = defineString('GEMINI_API_BASE', { default: 'https://generativelanguage.googleapis.com', description: 'כתובת השירות של Gemini' });
const S3_USER_DAILY = defineInt('S3_USER_DAILY', { default: 400, description: 'סריקת חנות: מספר תמונות מרבי ביום לכל משתמש (בלם בטיחות)' });

const QID_DAYS = 30, D1 = 86400000, BUSY_MS = 10 * 60000, MAX_N = 99, SAVE_TRIES = 5;
// draft: עד 100 תמונות – עד 300 שניות למודל, 480 שניות לכל הניסיונות; הפונקציה עצמה 540 שניות (מרווח לטרנזקציות ולשמירה)
const TIMES = { shelf: { timeoutMs: 60000, budgetMs: 120000 }, draft: { timeoutMs: 300000, budgetMs: 480000 } };
const bad = (reason, msg, code, extra) => new HttpsError(code || 'invalid-argument', msg, Object.assign({ reason }, extra || {}));
const CODE = {
  'bad-img': 'invalid-argument', 'bad-img-count': 'invalid-argument', 'too-big': 'invalid-argument', 'bad-type': 'invalid-argument', 'bad-size': 'invalid-argument', 'bad-slot': 'invalid-argument',
  's3-month-limit': 'resource-exhausted', 's3-user-day': 'resource-exhausted', 's3-adhoc-day': 'resource-exhausted', 'draft-daily': 'resource-exhausted', 'bad-answer': 'internal',
};
function toHttps(e) {
  if (e instanceof HttpsError || !e || !CODE[e.code]) return e;
  return bad(e.code, e.message, CODE[e.code]);
}
const mapLib = () => require('./store3d-map')._map;   // branchOk – בדיקת סניף משותפת (קיים, פעיל, מחסן)
const notify = (...a) => require('./store3d')._core.notify(...a);
const extra = () => require('./store3d-extra')._x;   // finishSafe – סיכום סבב, חוסרים, משימות תיקון (שלב 10)
// שלב 10, לפי החלטת המשתמש "ענה = נספר": no-answer (תשובה 200 בלי תוכן – למשל חסימת בטיחות) = Gemini ענה, הבדיקה נספרת.
// gemini-error (שגיאת 4xx אחרת) – נשאר מוחזר.
const answered = (e) => !!(e && e.details && e.details.reason === 'no-answer');

async function managers(db) { return (await db.collection('admins').get()).docs.map((d) => d.id).filter((u) => C.RE.uid.test(u)); }
// הסניפים של עובד (staff.br). מנהל / בלי שיוך – null = כל הסניפים (כמו ב-store3d.js)
function myBranches(who) {
  if (!who || who.role === 'manager') return null;
  const brs = who.staff && who.staff.exists ? who.staff.get('br') : null;
  return Array.isArray(brs) ? brs.filter((b) => typeof b === 'string') : null;
}

// ---------------- מכסה + s3qid (טרנזקציה אחת) ----------------
// q = { k, run?, slot? } – מה נשמר ב-s3qid ומה חייב להתאים בקריאה חוזרת.
// o = { br, cap, k (כמה נספר: 1 לבדיקת מדף ו-1 לטיוטת מפה), now, userMax, adhocMax? (דיווח יזום של עובד: 20),
//       draftDay? (הקמה: עד A.DRAFT_DAY_MAX ביום לסניף, s3use/d_{br}), extra?(tx) – כתיבה נוספת באותה טרנזקציה }.
// מחזיר { dup: res } או { qs } (תוצאת quotaStep).
async function reserve(db, who, qid, q, o) {
  const qref = db.doc('s3qid/' + qid), bref = db.doc('s3use/b_' + o.br), uref = db.doc('s3use/u_' + who.uid), aref = db.doc('s3use/a_' + who.uid);
  const ddref = db.doc('s3use/d_' + o.br);
  const lim = Number.isInteger(o.adhocMax);
  const day = scan.israelDay(new Date(o.now)), now = o.now;
  return db.runTransaction(async (tx) => {
    const [qs0, b, u, a, dd] = await Promise.all([tx.get(qref), tx.get(bref), tx.get(uref), lim ? tx.get(aref) : null, o.draftDay ? tx.get(ddref) : null]);
    if (qs0.exists) {
      const d = qs0.data();
      // הערה פתוחה משלב 5: qid חוזר – גם סוג הפעולה (k) חייב להתאים, לא רק המשתמש
      if (d.k !== q.k || d.uid !== who.uid || (d.run || '') !== (q.run || '') || (d.slot || '') !== (q.slot || '')) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
      if (d.res) return { dup: d.res };
      if (Number.isInteger(d.at) && d.at > now - BUSY_MS) throw bad('busy', 'התמונה הזו עדיין בבדיקה. נסו שוב בעוד דקה.', 'aborted');
      // רשומה תקועה (השרת נפל באמצע) – מטפלים מחדש
    }
    let qs;
    try {
      qs = A.quotaStep(b.exists ? b.data() : null, u.exists ? u.data() : null,
        { k: o.k, cap: o.cap, month: A.israelMonth(day), day, now, userMax: o.userMax, a: a && a.exists ? a.data() : null, adhocMax: lim ? o.adhocMax : undefined });
      if (dd) qs.d = A.draftDayStep(dd.exists ? dd.data() : null, day, now);
    } catch (e) { throw toHttps(e); }
    tx.set(bref, qs.b);
    tx.set(uref, qs.u);
    if (qs.a) tx.set(aref, qs.a);
    if (qs.d) tx.set(ddref, qs.d);
    const doc = { k: q.k, uid: who.uid, at: now, exp: now + QID_DAYS * D1 };
    if (q.run) doc.run = q.run;
    if (q.slot) doc.slot = q.slot;
    tx.set(qref, doc);
    if (o.extra) o.extra(tx);
    qs.day = day;
    return { qs };
  });
}
// אחרי כשל: s3qid נמחק תמיד (ניסיון חוזר עם אותו qid יעבור שוב). המכסה מוחזרת רק כש-charged == false – הבקשה לא הגיעה ל-Gemini
// או נדחתה ממנו בלי חיוב (429/עמוס, ניתוק, timeout לפני תשובה, כשל לפני הפנייה). אם Gemini ענה – גם תשובה שבורה – הבדיקה נספרת
// (החלטת המשתמש, תיקון סבב 1, כמו scanDocument). הקמה (qs.d) – גם מונה ההקמות היומי של הסניף חוזר ב-1, באותו תנאי ובאותו יום.
// o = { br, k, qs, charged, adhoc, now, extra?(tx) }
async function release(db, who, qid, o) {
  const qref = db.doc('s3qid/' + qid), bref = db.doc('s3use/b_' + o.br), aref = db.doc('s3use/a_' + who.uid), ddref = db.doc('s3use/d_' + o.br);
  try {
    await db.runTransaction(async (tx) => {
      const [q, b, a, dd] = await Promise.all([tx.get(qref), o.charged ? null : tx.get(bref), o.charged || !o.adhoc ? null : tx.get(aref), o.charged || !o.qs.d ? null : tx.get(ddref)]);
      if (b) { const r = A.refundStep(b.exists ? b.data() : null, o.qs.b.m, o.k, o.now); if (r) tx.update(bref, r); }
      if (a) { const r = A.refundDay(a.exists ? a.data() : null, o.qs.day, o.k, o.now); if (r) tx.update(aref, r); }
      if (dd) { const r = A.refundDay(dd.exists ? dd.data() : null, o.qs.day, 1, o.now); if (r) tx.update(ddref, r); }
      if (q.exists && !q.get('res') && q.get('uid') === who.uid) tx.delete(qref);
      if (o.extra) o.extra(tx);
    });
  } catch (e) {
    logger.error('store3d-ai: release failed', { code: e && e.code });
  }
}
async function warn80(db, br, qs, now, send) {
  if (!qs.warn) return;
  try { await notify({ db, send }, `${br}_${qs.b.m}_w80`, 'w80', await managers(db), now); } catch (e) { logger.warn('store3d-ai: w80 notify failed', { code: e && e.code }); }
}

// קריאה ל-Gemini עם תמונות JPEG. מחזיר { obj, model } – obj = JSON שפוענח (או null)
async function ask(deps, prompt, b64s, t) {
  const body = {
    contents: [{ parts: [{ text: prompt }].concat(b64s.map((d) => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))) }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  };
  const r = await scan.callGemini(String(deps.base).replace(/\/+$/, ''), deps.key, body, t.timeoutMs, false, { deadline: Date.now() + t.budgetMs, stats: { sent: 0 } });
  return { obj: scan.parseLikeApp(r.text), model: String(r.model || '').slice(0, 60) || 'unknown' };
}

// ---------------- shelfCheck ----------------
const runDir = (bizId, br, runId) => `b/${bizId}/store3d/${br}/run/${runId}/`;
// מספר הניסיון הבא לקובץ (1–99): גדול מכל קובץ קיים של אותו מקום צילום בסבב (5.1)
async function nextN(bucket, dir, slot) {
  const [files] = await bucket.getFiles({ prefix: dir + slot + '_' });
  let n = 0;
  for (const f of files) { const m = /_([0-9]{1,2})(_t)?\.jpg$/.exec(f.name); if (m) n = Math.max(n, +m[1]); }
  return n + 1;
}
// true = נשמר; false = הקובץ כבר קיים (בקשה אחרת שמרה אותו – 412); כל שגיאה אחרת נזרקת
async function saveJpeg(bucket, path, buf) {
  try { await bucket.file(path).save(buf, { resumable: false, contentType: 'image/jpeg', preconditionOpts: { ifGenerationMatch: 0 } }); return true; } catch (e) {
    if (e && (e.code === 412 || e.code === '412')) return false;
    throw e;
  }
}
async function delFiles(bucket, paths) {
  for (const p of paths) if (p) { try { await bucket.file(p).delete(); } catch (e) { /* ינוקה בניקוי הכללי (שלב 10) */ } }
}

// בדיקת קלט (בלי מסד). מחזיר את הערכים הנקיים או זורק.
function shelfInput(input, now) {
  if (typeof input.qid !== 'string' || !C.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  if (input.mode !== 'run' && input.mode !== 'adhoc' && input.mode !== 'verify') throw bad('bad-mode', 'סוג השליחה לא תקין');
  if (input.mode === 'verify' && (typeof input.fix !== 'string' || !X.RE_FIX.test(input.fix))) throw bad('bad-fix', 'מזהה משימת התיקון לא תקין');
  if (typeof input.slot !== 'string' || !A.RE_SLOT.test(input.slot)) throw bad('bad-slot', 'מקום הצילום לא תקין');
  if (!A.validAt(input.at, now)) throw bad('bad-time', 'השעה שנשלחה מהטלפון לא תקינה. בדקו את השעון בטלפון.');
  if (input.src !== 'photo' && input.src !== 'video') throw bad('bad-src', 'מקור התמונה לא תקין');
  const rt = input.rt === undefined || input.rt === null ? 0 : input.rt;
  if (!Number.isInteger(rt) || rt < 0 || rt > 50) throw bad('bad-rt', 'מספר הצילומים החוזרים לא תקין');
  if (input.txt !== undefined && input.txt !== null && (typeof input.txt !== 'string' || input.txt.length > 300)) throw bad('bad-txt', 'ההערה ארוכה מדי (עד 300 תווים)');
  if (input.mode === 'run' && !C.isRunId(input.run)) throw bad('bad-run', 'מזהה הסבב לא תקין');
  if (input.mode === 'adhoc' && (typeof input.map !== 'string' || !C.RE.map.test(input.map))) throw bad('bad-map-id', 'מזהה המפה לא תקין');
  let img, th;
  try { img = A.decodeJpeg(input.img, A.IMG, 'התמונה'); th = A.decodeJpeg(input.th, A.THUMB, 'התמונה המוקטנת'); } catch (e) { throw toHttps(e); }
  return { qid: input.qid, mode: input.mode, slot: input.slot, at: input.at, src: input.src, rt, img, th, fix: input.fix };
}
// שלב 10: qid חוזר של בקשה שהצליחה – dup גם כשתקרת הצילומים (99) כבר מלאה (לפני הבדיקה too-many). null = אין תשובה שמורה
async function savedRes(db, who, qid, q) {
  const s = await db.doc('s3qid/' + qid).get();
  if (!s.exists) return null;
  const d = s.data();
  if (d.k !== q.k || d.uid !== who.uid || (d.run || '') !== (q.run || '') || (d.slot || '') !== (q.slot || '')) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
  return d.res ? Object.assign({}, d.res, { dup: true }) : null;
}

// שלב 20א: מקטעים מועמדים להנחיה. הראשון = המקטע הנוכחי (עם הצילום הקודם שלו, prev), ואחריו שכנים במסלול מתוך המקטעים
// של העובד בסבב (run.asg[owner]), רק כאלה שיש להם מידע מהצילום האחרון (s3sum.b[bay].r → srun/{r}/ai/{slot}: קטגוריה / מוצרים).
// בלי שכן עם מידע (למשל סבב ראשון) – [] ואין ניחוש. כשל בקריאה – בלי מועמדים (הבדיקה עצמה ממשיכה כרגיל).
const sideTxt = (c, fm) => { const f = fm.get(c.fx) || {}; return `גוף ${f.num || c.fx}${f.name ? ' (' + String(f.name).slice(0, 30) + ')' : ''}, ${c.s === 'a' ? 'צד ראשי' : 'צד שני'}, מקטע ${c.n}${c.lv === 't' ? ', עליון' : c.lv === 'b' ? ', תחתון' : ''}`; };
async function candsOf(db, run, owner, map, slot, sum, prev) {
  try {
    const L = A.slotCands(run && run.asg ? run.asg[owner] : null, map, slot);
    if (!L.length) return [];
    const fm = new Map(map.fx.filter((f) => f && typeof f.id === 'string').map((f) => [f.id, f]));
    const B = (sum.exists && sum.get('b')) || {};
    const docs = await Promise.all(L.slice(1).map((c) => { const e = B[c.bay]; return e && C.isRunId(e.r) ? db.doc(`srun/${e.r}/ai/${c.slot}`).get() : null; }));
    const out = [];
    L.slice(1).forEach((c, i) => {
      const d = docs[i];
      if (!d || !d.exists) return;
      const cat = typeof d.get('cat') === 'string' ? d.get('cat') : '';
      const prods = (Array.isArray(d.get('prods')) ? d.get('prods') : []).map((p) => p && p.n).filter((n) => typeof n === 'string' && n);
      if (cat || prods.length) out.push({ id: c.slot, label: sideTxt(c, fm), cat, prods });
    });
    if (!out.length) return [];
    return [{ id: L[0].slot, label: sideTxt(L[0], fm), cat: (prev && prev.cat) || '', prods: (prev && prev.prods) || [] }].concat(out);
  } catch (e) {
    logger.warn('shelfCheck: candidates failed', { code: e && e.code });
    return [];
  }
}

// who = { uid, mgr, bizId, brs }; deps = { base, key, bucket, send, userMax }
async function shelfCore(db, who, input, now, deps) {
  const x = shelfInput(input, now);
  if (x.mode === 'verify') return verifyCore(db, who, x, now, deps);
  const bucket = deps.bucket || getStorage().bucket();
  // ---- הרשאה ומקום הצילום (קריאות בלבד, לפני המכסה) ----
  let runId, run = null, mapId, owner, adhocTxt = '';
  if (x.mode === 'run') {
    runId = input.run;
    const s = await db.doc('srun/' + runId).get();
    if (!s.exists) throw bad('no-run', 'הסבב לא נמצא', 'not-found');
    run = s.data();
    if (!C.LIVE.includes(run.st)) throw bad('run-closed', 'הסבב כבר הסתיים או בוטל', 'failed-precondition');
    mapId = run.map;
  } else {
    runId = 'ad_' + x.qid;
    mapId = input.map;
    adhocTxt = typeof input.txt === 'string' ? input.txt.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  }
  const br = String(mapId || '').slice(2), kind = String(mapId || '').charAt(0);
  if (!C.RE.map.test(mapId || '')) throw bad('no-map', 'המפה של הסבב לא תקינה', 'failed-precondition');
  if (x.mode === 'adhoc' && who.brs && !who.brs.includes(br)) throw bad('other-branch', 'המפה שייכת לסניף אחר', 'permission-denied');
  const ms = await db.doc('smap/' + mapId).get();
  const map = ms.exists ? ms.data() : null;
  if (!map || map.del === 1) throw bad('no-map', 'המפה לא נמצאה (או שנמחקה)', 'failed-precondition');
  let sl;
  try { sl = A.checkSlot(x.slot, map); } catch (e) { throw toHttps(e); }
  if (x.mode === 'run') {
    owner = Object.keys(run.asg || {}).find((u) => Array.isArray(run.asg[u]) && run.asg[u].includes(sl.bay));
    if (!owner) throw bad('bad-slot', 'המדף הזה לא בסבב', 'invalid-argument');
    if (!who.mgr && owner !== who.uid) throw bad('not-assigned', 'המדף הזה לא משויך אליך בסבב', 'permission-denied');
  } else owner = who.uid;
  const cfg = await mapLib().branchOk(db, who.bizId, br, kind);
  // ---- הקשר להנחיה (רק מהשרת) ----
  const [set, bayDoc, sum] = await Promise.all([db.doc('s3set/' + br).get(), db.doc(`smap/${mapId}/bay/${sl.bay}`).get(), db.doc('s3sum/' + mapId).get()]);
  const S = set.exists ? set.data() : {}, B = bayDoc.exists ? bayDoc.data() : {};
  let prev = null;
  const last = sum.exists && sum.get('b') && sum.get('b')[sl.bay];
  if (last && C.isRunId(last.r) && last.r !== runId) {
    const pa = await db.doc(`srun/${last.r}/ai/${x.slot}`).get();
    if (pa.exists) prev = { date: Number.isInteger(pa.get('at')) ? scan.israelDay(new Date(pa.get('at'))) : '', cat: pa.get('cat') || '', prods: (pa.get('prods') || []).map((p) => p && p.n) };
  }
  const exp = Array.isArray(B.exp) ? B.exp : [];
  // שלב 20א: מקטעים מועמדים (רק בסבב, רק מהמקטעים של העובד שהמקטע הנוכחי שלו)
  const cands = x.mode === 'run' ? await candsOf(db, run, owner, map, x.slot, sum, prev) : [];
  const ctx = {
    kind, storeType: S.stype, today: scan.israelDay(new Date(now)), recN: Number.isInteger(S.recN) ? S.recN : 3, cats: S.cats, catMode: S.catMode || 'mix',
    notes: (Array.isArray(B.notes) ? B.notes : []).map((n) => n && n.t), expected: exp.map((e) => e && e.n), prev, hi: sl.lv === 't' ? 'top' : sl.lv === 'b' ? 'bottom' : null, cctv: false,
    cands,
  };
  if (!deps.key) throw bad('no-key', 'אין מפתח לזיהוי חכם בשרת', 'failed-precondition');
  const dir = runDir(who.bizId, br, runId);
  // תיקון סבב 1: תקרת הצילומים החוזרים נבדקת לפני המכסה ולפני Gemini
  let n0 = await nextN(bucket, dir, x.slot);
  const K = x.mode === 'run' ? 'photo' : 'adhoc';
  if (n0 > MAX_N) {
    const dup = await savedRes(db, who, x.qid, { k: K, run: runId, slot: x.slot });
    if (dup) return dup;
    throw bad('too-many', 'יותר מדי צילומים חוזרים למקום הזה בסבב', 'resource-exhausted');
  }
  // ---- מכסה ----
  const adhoc = K === 'adhoc' && !who.mgr; // דיווח יזום של עובד: עד 20 ביום (החלטת המשתמש). מנהל – בלי המונה הזה
  const rv = await reserve(db, who, x.qid, { k: K, run: runId, slot: x.slot }, { br, cap: cfg.cap, k: 1, now, userMax: deps.userMax, adhocMax: adhoc ? (deps.adhocMax || A.ADHOC_DAY) : undefined });
  if (rv.dup) return Object.assign({}, rv.dup, { dup: true });
  await warn80(db, br, rv.qs, now, deps.send);
  let charged = false; // true = Gemini החזיר תשובה → הבדיקה נספרת גם אם משהו נכשל אחר כך
  const back = async (e) => { await release(db, who, x.qid, { br, k: 1, qs: rv.qs, charged, adhoc, now: Date.now() }); throw e; };
  // ---- Gemini ----
  let resp;
  try { resp = await ask(deps, PS.buildShelfPrompt(ctx), [x.img.b64], TIMES.shelf); } catch (e) {
    if (answered(e)) charged = true;
    return back(e instanceof HttpsError ? e : bad('internal', 'שגיאה בבדיקת התמונה', 'internal'));
  }
  charged = true;
  if (A.shelfBroken(resp.obj)) return back(bad('bad-answer', 'התשובה מהבדיקה החכמה לא נקראה. התמונה נשארת בטלפון ותישלח שוב.', 'internal'));
  const errs = PS.checkShelfResponse(resp.obj, { warehouse: kind === 'w', recN: ctx.recN });
  if (errs.length) logger.info('shelfCheck: model answer cleaned', { n: errs.length });
  // קישור לקטלוג: שם זהה במוצרים (prod.name). שמות שכבר הותאמו מ"מה אמור להיות" – לא נשאלים
  const catalog = new Map();
  const names = A.prodNames(resp.obj).filter((n) => !A.pidOf(n, { exp }));
  if (names.length) {
    try { (await db.collection('prod').where('name', 'in', names).limit(60).get()).docs.forEach((d) => { const k = A.norm(d.get('name')); if (k && !catalog.has(k)) catalog.set(k, d.id); }); } catch (e) { /* בלי קטלוג – בלי pid */ }
  }
  const cl = A.cleanShelf(resp.obj, { wh: kind === 'w', recN: ctx.recN, cats: S.cats, catMode: ctx.catMode, exp, catalog, cands: cands.map((c) => c.id), cur: x.slot });
  const ai = Object.assign(cl.ai, { model: resp.model, at: now, ver: PS.VERSION });
  const sc = X.scoreSlot(ai, S.w); // שלב 10: ציון המקום לפי המשקלות של הסניף ("לבדיקה" ואזהרות לא מורידים)
  if (sc) ai.sc = sc;
  // ---- Storage: רק כשאין אדם בתמונה ----
  let p = '', tp = '';
  if (ai.st !== 'person') {
    // תיקון סבב 1: כל קובץ נשמר רק אם עוד לא קיים (ifGenerationMatch:0). בקשה מקבילה לאותו מקום תפסה את המספר – עוברים למספר הבא.
    // נמחקים רק קבצים שהבקשה הזו עצמה שמרה בהצלחה.
    const saved = [];
    try {
      for (let i = 0; i < SAVE_TRIES && !p; i++, n0++) {
        if (n0 > MAX_N) break;
        const fp = `${dir}${x.slot}_${n0}.jpg`, ft = `${dir}${x.slot}_${n0}_t.jpg`;
        if (!(await saveJpeg(bucket, fp, x.img.buf))) continue;
        saved.push(fp);
        if (!(await saveJpeg(bucket, ft, x.th.buf))) { await delFiles(bucket, [fp]); saved.pop(); continue; }
        saved.push(ft);
        p = fp; tp = ft;
      }
    } catch (e) {
      logger.warn('shelfCheck: save failed', { code: e && e.code });
      await delFiles(bucket, saved);
      return back(bad('save-failed', 'שמירת התמונה נכשלה. נסו שוב.', 'unavailable'));
    }
    if (!p) { await delFiles(bucket, saved); return back(bad('busy', 'נסו שוב בעוד רגע', 'aborted')); }
  }
  const ph = { w: x.img.w, h: x.img.h, sz: x.img.buf.length, tsz: x.th.buf.length, src: x.src, by: who.uid, at: x.at, rx: now, qid: x.qid, rt: x.rt };
  if (p) { ph.p = p; ph.th = tp; } else ph.person = true;
  if (cl.ask) ph.ask = true;
  if (cl.sug) ph.sug = cl.sug; // שלב 20א: הצעה "נראה כמו מקטע אחר" – העובד מחליט (s3MovePh). לא מועבר אוטומטית
  const out = { st: ai.st, iss: ai.iss.map((i) => { const o = { k: i.k, sev: i.sev, t: i.t }; if (i.box) o.box = i.box; return o; }), usage: rv.qs.usage, runId };
  if (cl.ask) out.ask = true;
  if (cl.t) out.t = cl.t;
  const res = { st: ai.st, iss: ai.iss.map((i) => ({ k: i.k, sev: i.sev })), usage: rv.qs.usage, runId };
  if (cl.sug) { out.sug = cl.sug; res.sug = cl.sug; }
  let kept = false;
  // ---- כתיבה (טרנזקציה אחת) ----
  const runRef = db.doc('srun/' + runId), phRef = db.doc(`srun/${runId}/ph/${x.slot}`), aiRef = db.doc(`srun/${runId}/ai/${x.slot}`);
  const other = sl.hi ? `${sl.bay}_${sl.lv === 't' ? 'b' : 't'}` : null;
  const sumRef = db.doc('s3sum/' + mapId), qref = db.doc('s3qid/' + x.qid);
  let fin = null, oldPh = null;
  try {
    await db.runTransaction(async (tx) => {
      const reads = [tx.get(runRef), tx.get(phRef), tx.get(aiRef), tx.get(sumRef), other ? tx.get(db.doc(`srun/${runId}/ai/${other}`)) : null];
      const [rs, ph0, ai0, su, ao] = await Promise.all(reads);
      oldPh = ph0.exists ? ph0.data() : null;
      // תיקון סבב 1: צילום עם אדם אחרי צילום שנשמר באותו סבב – לא דורסים. הצילום הקודם (ph, ai, קבצים, s3sum) נשאר; נרשם רק s3qid
      kept = ai.st === 'person' && !!(oldPh && oldPh.p);
      if (kept) {
        if (x.mode === 'run' && (!rs.exists || !C.LIVE.includes(rs.get('st')))) throw bad('run-closed', 'הסבב כבר הסתיים או בוטל', 'failed-precondition');
        tx.update(qref, { res: Object.assign({}, res, { kept: true }) });
        return;
      }
      // שלב 20ב: תמונה "קודמת" (prv) שנשמרה בהעברה בין מקטעים – נשארת גם בצילום חוזר (הקבצים שלה לא נמחקים כאן)
      if (oldPh && oldPh.prv && typeof oldPh.prv === 'object') ph.prv = oldPh.prv; else delete ph.prv;
      const aiPrv = ai0.exists ? ai0.get('prv') : null;
      if (aiPrv && typeof aiPrv === 'object') ai.prv = aiPrv; else delete ai.prv;
      const delta = (A.countsDone(ai) ? 1 : 0) - (ai0.exists && A.countsDone(ai0.data()) ? 1 : 0);
      if (x.mode === 'run') {
        if (!rs.exists || !C.LIVE.includes(rs.get('st'))) throw bad('run-closed', 'הסבב כבר הסתיים או בוטל', 'failed-precondition');
        const r = rs.data();
        const nUid = Object.assign({}, r.nUid);
        const me = Object.assign({ n: 0, d: 0 }, nUid[owner]);
        me.d = Math.max(0, Math.min(me.n, me.d + delta));
        nUid[owner] = me;
        const patch = { nUid, nDone: Math.max(0, Math.min(r.n || 0, (r.nDone || 0) + delta)) };
        if (C.finished(Object.assign({}, r, patch))) { patch.st = C.closeSt(r, now); patch.doneAt = now; fin = patch.st; }
        tx.update(runRef, patch);
      } else {
        if (rs.exists) throw bad('busy', 'נסו שוב בעוד רגע', 'aborted');
        const k = 1;
        tx.create(runRef, { br, map: mapId, mapV: Number.isInteger(map.v) ? map.v : 1, k: 'adhoc', st: 'done', asg: { [who.uid]: [sl.bay] }, uids: [who.uid],
          n: k, nDone: A.countsDone(ai) ? 1 : 0, nUid: { [who.uid]: { n: k, d: A.countsDone(ai) ? 1 : 0 } }, openAt: now, dueAt: now + 1, doneAt: now, tlog: { [who.uid]: [] },
          // 7ב: ההערה של העובד נשמרת לעיון המנהל בלבד – לא נשלחת ל-AI (מניעת הזרקת הוראות מטקסט חופשי)
          ...(adhocTxt ? { txt: adhocTxt } : {}) });
      }
      tx.set(phRef, ph);
      tx.set(aiRef, ai);
      const oldB = su.exists && su.get('b') ? su.get('b')[sl.bay] : null;
      const e = A.sumEntry([ai, ao && ao.exists ? ao.data() : null], runId, now, tp, oldB && oldB.th);
      const sp = { b: { [sl.bay]: e }, upd: now };
      if (x.mode === 'run') sp.run = runId;
      tx.set(sumRef, sp, { merge: true });
      tx.update(qref, { res });
    });
  } catch (e) {
    await delFiles(bucket, [p, tp]);
    return back(e instanceof HttpsError ? e : (logger.error('shelfCheck: write failed', { code: e && e.code }), bad('save-failed', 'שמירת התוצאה נכשלה. נסו שוב.', 'unavailable')));
  }
  // צילום חוזר לאותו מקום דורס את המסמך; הקובץ הקודם נמחק (4.9)
  if (kept) return Object.assign(out, { kept: true });
  if (oldPh && p) await delFiles(bucket, [oldPh.p, oldPh.th].filter((q) => q && q !== p && q !== tp));
  // שלב 10: סבב שהסתיים (או דיווח יזום) – סיכום וציון, רשימת חוסרים, משימות תיקון
  if (fin || x.mode === 'adhoc') await extra().finishSafe(db, runId, now, { send: deps.send });
  if (fin) await notify({ db, send: deps.send }, runId + '_done', 'done', await managers(db), now);
  return out;
}

// ---------------- צילום אימות של משימת תיקון (shelfCheck mode 'verify', שלב 10) ----------------
// רק העובד שהמשימה שלו (s3fix.u), במשימה פתוחה / שנדחתה / שממתינה; slot חייב להיות של המשימה. נספר במכסה (חוזה 4.12).
// תוצאה: ok (הבעיות המקוריות נעלמו) / rej (אחת מהן עדיין קיימת) / sent (ה-AI לא בטוח, או משימה ידנית – המנהל מכריע ב-s3Fix).
// תמונה עם אדם או לא קריאה – לא נשמרת, והמשימה לא משתנה. הקבצים: b/{biz}/store3d/{br}/fix/{fixTaskId}_{n}.jpg (+_t).
async function verifyCore(db, who, x, now, deps) {
  const bucket = deps.bucket || getStorage().bucket();
  const fref = db.doc('s3fix/' + x.fix);
  const fs = await fref.get();
  if (!fs.exists) throw bad('no-fix', 'משימת התיקון לא נמצאה', 'not-found');
  const f = fs.data();
  if (f.u !== who.uid) throw bad('not-assigned', 'משימת התיקון הזו לא שלך', 'permission-denied');
  const OPEN = ['open', 'rej', 'sent'];
  if (!OPEN.includes(f.st)) throw bad('fix-closed', 'משימת התיקון כבר נסגרה', 'failed-precondition');
  if (f.slot !== x.slot) throw bad('bad-slot', 'מקום הצילום לא שייך למשימה', 'invalid-argument');
  const mapId = f.map, br = String(mapId || '').slice(2), kind = String(mapId || '').charAt(0);
  if (!C.RE.map.test(mapId || '')) throw bad('no-map', 'המפה של המשימה לא תקינה', 'failed-precondition');
  const ms = await db.doc('smap/' + mapId).get();
  const map = ms.exists ? ms.data() : null;
  if (!map || map.del === 1) throw bad('no-map', 'המפה לא נמצאה (או שנמחקה)', 'failed-precondition');
  let sl;
  try { sl = A.checkSlot(x.slot, map); } catch (e) { throw toHttps(e); }
  const cfg = await mapLib().branchOk(db, who.bizId, br, kind);
  const [set, bayDoc, orig] = await Promise.all([db.doc('s3set/' + br).get(), db.doc(`smap/${mapId}/bay/${sl.bay}`).get(),
    C.isRunId(f.run) ? db.doc(`srun/${f.run}/ai/${x.slot}`).get() : null]);
  const S = set.exists ? set.data() : {}, B = bayDoc.exists ? bayDoc.data() : {};
  const O = orig && orig.exists ? orig.data() : null;
  const origKinds = O && Array.isArray(f.iks) ? f.iks.map((i) => O.iss && O.iss[i] && O.iss[i].k).filter(Boolean) : [];
  const exp = Array.isArray(B.exp) ? B.exp : [];
  const ctx = {
    kind, storeType: S.stype, today: scan.israelDay(new Date(now)), recN: 0, cats: S.cats, catMode: S.catMode || 'mix',
    notes: (Array.isArray(B.notes) ? B.notes : []).map((n) => n && n.t), expected: exp.map((e) => e && e.n),
    prev: O ? { date: Number.isInteger(O.at) ? scan.israelDay(new Date(O.at)) : '', cat: O.cat || '', prods: (O.prods || []).map((p) => p && p.n) } : null,
    hi: sl.lv === 't' ? 'top' : sl.lv === 'b' ? 'bottom' : null, cctv: false,
  };
  if (!deps.key) throw bad('no-key', 'אין מפתח לזיהוי חכם בשרת', 'failed-precondition');
  const dir = `b/${who.bizId}/store3d/${br}/fix/`;
  const q = { k: 'verify', slot: x.slot };
  if (f.run) q.run = f.run;
  let n0 = await nextN(bucket, dir, x.fix);
  if (n0 > MAX_N) {
    const dup = await savedRes(db, who, x.qid, q);
    if (dup) return dup;
    throw bad('too-many', 'יותר מדי צילומי אימות למשימה הזו', 'resource-exhausted');
  }
  const rv = await reserve(db, who, x.qid, q, { br, cap: cfg.cap, k: 1, now, userMax: deps.userMax });
  if (rv.dup) return Object.assign({}, rv.dup, { dup: true });
  await warn80(db, br, rv.qs, now, deps.send);
  let charged = false;
  const back = async (e) => { await release(db, who, x.qid, { br, k: 1, qs: rv.qs, charged, now: Date.now() }); throw e; };
  let resp;
  try { resp = await ask(deps, PS.buildShelfPrompt(ctx), [x.img.b64], TIMES.shelf); } catch (e) {
    if (answered(e)) charged = true;
    return back(e instanceof HttpsError ? e : bad('internal', 'שגיאה בבדיקת התמונה', 'internal'));
  }
  charged = true;
  if (A.shelfBroken(resp.obj)) return back(bad('bad-answer', 'התשובה מהבדיקה החכמה לא נקראה. התמונה נשארת בטלפון ותישלח שוב.', 'internal'));
  const cl = A.cleanShelf(resp.obj, { wh: kind === 'w', recN: 0, cats: S.cats, catMode: ctx.catMode, exp, catalog: new Map() });
  const ai = cl.ai;
  const fixSt = X.verifyResult(f, origKinds, ai); // null = תמונה לא שמישה (אדם / לא קריאה) – לא נשמרת
  let p = '', tp = '';
  const saved = [];
  if (fixSt) {
    try {
      for (let i = 0; i < SAVE_TRIES && !p; i++, n0++) {
        if (n0 > MAX_N) break;
        const fp = `${dir}${x.fix}_${n0}.jpg`, ft = `${dir}${x.fix}_${n0}_t.jpg`;
        if (!(await saveJpeg(bucket, fp, x.img.buf))) continue;
        saved.push(fp);
        if (!(await saveJpeg(bucket, ft, x.th.buf))) { await delFiles(bucket, [fp]); saved.pop(); continue; }
        saved.push(ft);
        p = fp; tp = ft;
      }
    } catch (e) {
      logger.warn('shelfCheck verify: save failed', { code: e && e.code });
      await delFiles(bucket, saved);
      return back(bad('save-failed', 'שמירת התמונה נכשלה. נסו שוב.', 'unavailable'));
    }
    if (!p) { await delFiles(bucket, saved); return back(bad('busy', 'נסו שוב בעוד רגע', 'aborted')); }
  }
  const out = { st: ai.st, iss: ai.iss.map((i) => { const o = { k: i.k, sev: i.sev, t: i.t }; if (i.box) o.box = i.box; return o; }), usage: rv.qs.usage, fix: x.fix, fixSt: fixSt || f.st };
  if (cl.t) out.t = cl.t;
  const res = { st: ai.st, iss: ai.iss.map((i) => ({ k: i.k, sev: i.sev })), usage: rv.qs.usage, fix: x.fix, fixSt: fixSt || f.st };
  let old = null;
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(fref);
      if (!s.exists || !OPEN.includes(s.get('st')) || s.get('u') !== who.uid) throw bad('fix-closed', 'משימת התיקון כבר נסגרה', 'failed-precondition');
      if (fixSt) {
        old = { vp: s.get('vp'), vth: s.get('vth') };
        const patch = { vp: p, vth: tp, vst: ai.st, st: fixSt };
        if (fixSt === 'ok' || fixSt === 'rej') patch.doneAt = now;
        tx.update(fref, patch);
      }
      tx.update(db.doc('s3qid/' + x.qid), { res });
    });
  } catch (e) {
    await delFiles(bucket, saved);
    return back(e instanceof HttpsError ? e : (logger.error('shelfCheck verify: write failed', { code: e && e.code }), bad('save-failed', 'שמירת התוצאה נכשלה. נסו שוב.', 'unavailable')));
  }
  if (old) await delFiles(bucket, [old.vp, old.vth].filter((v) => typeof v === 'string' && v && v !== p && v !== tp));
  return out;
}

// ---------------- mapDraft ----------------
async function draftCore(db, who, input, now, deps) {
  if (typeof input.qid !== 'string' || !C.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  if (typeof input.br !== 'string' || !C.RE.br.test(input.br)) throw bad('bad-br', 'מזהה הסניף לא תקין');
  if (input.kind !== 's' && input.kind !== 'w') throw bad('bad-kind', 'סוג המפה (חנות/מחסן) לא תקין');
  let imgs;
  try { imgs = A.draftImgs(input.imgs); } catch (e) { throw toHttps(e); }
  const qid = input.qid, br = input.br, kind = input.kind, n = imgs.length;
  if (who.brs && !who.brs.includes(br)) throw bad('other-branch', 'הסניף הזה לא משויך אליך', 'permission-denied');
  const cfg = await mapLib().branchOk(db, who.bizId, br, kind);
  const set = await db.doc('s3set/' + br).get();
  const S = set.exists ? set.data() : {};
  if (!deps.key) throw bad('no-key', 'אין מפתח לזיהוי חכם בשרת', 'failed-precondition');
  const dref = db.doc('s3draft/' + qid);
  // טיוטה = בדיקה אחת במכסה (k: 1), לא לפי מספר התמונות. n נשמר ב-s3draft רק לתיעוד
  // + עד A.DRAFT_DAY_MAX הקמות ביום לסניף (s3use/d_{br}), באותה טרנזקציה. qid חוזר (dup) לא נספר
  const rv = await reserve(db, who, qid, { k: 'draft' }, { br, cap: cfg.cap, k: 1, now, userMax: deps.userMax, draftDay: true, extra: (tx) => tx.set(dref, { br, kind, by: who.uid, at: now, st: 'wait', n }) });
  if (rv.dup) return Object.assign({}, rv.dup, { dup: true });
  await warn80(db, br, rv.qs, now, deps.send);
  let charged = false;
  const back = async (e) => {
    await release(db, who, qid, { br, k: 1, qs: rv.qs, charged, now: Date.now(), extra: (tx) => tx.set(dref, { br, kind, by: who.uid, at: now, st: 'fail', n, err: String(e.message || 'שגיאה').slice(0, 120) }) });
    throw e;
  };
  let resp;
  try { resp = await ask(deps, PM.buildMapDraftPrompt({ kind, storeType: S.stype, cctv: input.cctv === true, n }), imgs.map((d) => d.b64), TIMES.draft); } catch (e) {
    if (answered(e)) charged = true;
    return back(e instanceof HttpsError ? e : bad('internal', 'שגיאה ביצירת הטיוטה', 'internal'));
  }
  charged = true;
  const errs = PM.checkMapDraftResponse(resp.obj);
  if (errs.length) logger.info('mapDraft: model answer cleaned', { n: errs.length });
  let d;
  try {
    d = A.cleanDraft(resp.obj, { br, kind, numDir: S.numDir });
    // רשת ביטחון: אותה בדיקה כמו בשמירת מפה (s3SaveMap), כדי שהטיוטה תישמר בלי שגיאה אחרי עריכה
    const M = require('./lib/store3d-map');
    const c = M.cleanMap(d.map, { bizId: who.bizId, mapId: kind + '-' + br });
    M.finalCheck(M.mergeDel(null, c.map, { mgr: true, uid: who.uid, now }), null);
    if (M.bytesOf(d.map) > M.MAX_BYTES) throw A.fail('bad-answer', 'הטיוטה גדולה מדי');
  } catch (e) {
    return back(bad('bad-answer', e && e.code === 'bad-answer' ? e.message : 'הטיוטה שהתקבלה לא תקינה. נסו שוב, אולי עם תמונות אחרות.', 'internal'));
  }
  const res = { draftId: qid, st: 'ok', n, conf: d.conf, drop: d.drop, usage: rv.qs.usage };
  try {
    await db.runTransaction(async (tx) => {
      // 7ב: + conf (0–1) ו-notes (עד 200) – לא חובה בחוזה, נשמרים כשהם קיימים
      tx.set(dref, Object.assign({ br, kind, by: who.uid, at: now, st: 'ok', m: d.map, n }, typeof d.conf === 'number' ? { conf: d.conf } : {}, d.notes ? { notes: d.notes } : {}));
      tx.update(db.doc('s3qid/' + qid), { res });
    });
  } catch (e) {
    logger.error('mapDraft: write failed', { code: e && e.code });
    return back(bad('save-failed', 'שמירת הטיוטה נכשלה. נסו שוב.', 'unavailable'));
  }
  return Object.assign({}, res, { m: d.map, scale: d.scale, notes: d.notes });
}

// ---------------- s3MovePh: העברת תמונה ממקטע למקטע (שלב 20ב) ----------------
// { run, from, to } – בלי AI ובלי מכסה. רק העובד ששני המקטעים שלו בסבב (או מנהל, כששני המקטעים של אותו עובד), בסבב open / late.
// הקבצים מועתקים לשם של מקום היעד ({to}_{n}.jpg + _t) – כך הניקוי היומי (s3Clean, לפי שם הקובץ) משייך אותם נכון; אחרי שהטרנזקציה
// הצליחה, הקבצים הישנים של המקור נמחקים. בטרנזקציה אחת: ph + ai של היעד (המקור נמחק), nDone / nUid (moveDone), s3sum של שני המקטעים.
// יעד שכבר צולם (החלטת המשתמש 4): התמונה המועברת מחליפה, והקודמת נשמרת ב-ph.prv / ai.prv (הקבצים שלה לא נמחקים). קודמת אחת בלבד.
// sug ו-ask של התמונה המועברת נמחקים (ההצעה טופלה); נרשם ph.mv = { f: מקור, at, by }. קריאה חוזרת אחרי הצלחה – { ok, dup:true }.
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const noPrv = (o) => { const x = Object.assign({}, o); delete x.prv; return x; };
function moveInput(input) {
  if (!C.isRunId(input.run) || /^ad_/.test(input.run)) throw bad('bad-run', 'מזהה הסבב לא תקין');
  if (typeof input.from !== 'string' || !A.RE_SLOT.test(input.from) || typeof input.to !== 'string' || !A.RE_SLOT.test(input.to)) throw bad('bad-slot', 'מקום הצילום לא תקין');
  if (input.from === input.to) throw bad('same-slot', 'אי אפשר להעביר תמונה לאותו מקטע');
  return { run: input.run, from: input.from, to: input.to };
}
const levels = (sl) => (sl.hi ? [sl.bay + '_t', sl.bay + '_b'] : [sl.bay + '_a']);
// who = { uid, mgr, bizId }; deps = { bucket? }
async function moveCore(db, who, input, now, deps) {
  const x = moveInput(input);
  const bucket = (deps && deps.bucket) || getStorage().bucket();
  const runId = x.run;
  const rs = await db.doc('srun/' + runId).get();
  if (!rs.exists) throw bad('no-run', 'הסבב לא נמצא', 'not-found');
  const run = rs.data();
  if (!C.LIVE.includes(run.st)) throw bad('run-closed', 'הסבב כבר הסתיים או בוטל', 'failed-precondition');
  const mapId = run.map, br = String(mapId || '').slice(2), kind = String(mapId || '').charAt(0);
  if (!C.RE.map.test(mapId || '')) throw bad('no-map', 'המפה של הסבב לא תקינה', 'failed-precondition');
  const ms = await db.doc('smap/' + mapId).get();
  const map = ms.exists ? ms.data() : null;
  if (!map || map.del === 1) throw bad('no-map', 'המפה לא נמצאה (או שנמחקה)', 'failed-precondition');
  let sf, st;
  try { sf = A.checkSlot(x.from, map); st = A.checkSlot(x.to, map); } catch (e) { throw toHttps(e); }
  const ownerOf = (bay) => Object.keys(run.asg || {}).find((u) => Array.isArray(run.asg[u]) && run.asg[u].includes(bay));
  const owner = ownerOf(sf.bay), ownerTo = ownerOf(st.bay);
  if (!owner || !ownerTo) throw bad('bad-slot', 'המדף הזה לא בסבב', 'invalid-argument');
  if (owner !== ownerTo) throw bad('not-assigned', 'אפשר להעביר רק בין מקטעים של אותו עובד בסבב', 'permission-denied');
  if (!who.mgr && owner !== who.uid) throw bad('not-assigned', 'המדף הזה לא משויך אליך בסבב', 'permission-denied');
  await mapLib().branchOk(db, who.bizId, br, kind);
  const phFromRef = db.doc(`srun/${runId}/ph/${x.from}`), phToRef = db.doc(`srun/${runId}/ph/${x.to}`);
  const p0 = await phFromRef.get();
  if (!p0.exists) {
    const t0 = await phToRef.get();
    const mv = t0.exists ? t0.get('mv') : null;
    if (isObj(mv) && mv.f === x.from) return { ok: true, dup: true, runId, from: x.from, to: x.to };
    throw bad('no-photo', 'במקטע הזה אין תמונה להעביר', 'failed-precondition');
  }
  const src = p0.data();
  if (src.person || src.gone || typeof src.p !== 'string' || typeof src.th !== 'string') throw bad('no-photo', 'במקטע הזה אין תמונה שמורה להעביר', 'failed-precondition');
  // ---- העתקת הקבצים לשם של היעד ----
  const dir = runDir(who.bizId, br, runId);
  if (!src.p.startsWith(dir) || !src.th.startsWith(dir)) throw bad('no-photo', 'הקובץ של התמונה לא נמצא', 'failed-precondition');
  let bufs;
  try { bufs = [(await bucket.file(src.p).download())[0], (await bucket.file(src.th).download())[0]]; } catch (e) {
    if (e && (e.code === 404 || e.code === '404')) throw bad('no-photo', 'הקובץ של התמונה לא נמצא', 'failed-precondition');
    logger.warn('s3MovePh: read failed', { code: e && e.code });
    throw bad('save-failed', 'קריאת התמונה נכשלה. נסו שוב.', 'unavailable');
  }
  let n = await nextN(bucket, dir, x.to), p = '', tp = '';
  const saved = [];
  try {
    for (let i = 0; i < SAVE_TRIES && !p; i++, n++) {
      if (n > MAX_N) break;
      const fp = `${dir}${x.to}_${n}.jpg`, ft = `${dir}${x.to}_${n}_t.jpg`;
      if (!(await saveJpeg(bucket, fp, bufs[0]))) continue;
      saved.push(fp);
      if (!(await saveJpeg(bucket, ft, bufs[1]))) { await delFiles(bucket, [fp]); saved.pop(); continue; }
      saved.push(ft);
      p = fp; tp = ft;
    }
  } catch (e) {
    logger.warn('s3MovePh: save failed', { code: e && e.code });
    await delFiles(bucket, saved);
    throw bad('save-failed', 'שמירת התמונה נכשלה. נסו שוב.', 'unavailable');
  }
  if (!p) { await delFiles(bucket, saved); throw bad(n > MAX_N ? 'too-many' : 'busy', n > MAX_N ? 'יותר מדי צילומים חוזרים למקום הזה בסבב' : 'נסו שוב בעוד רגע', n > MAX_N ? 'resource-exhausted' : 'aborted'); }
  // ---- טרנזקציה אחת ----
  const runRef = db.doc('srun/' + runId), sumRef = db.doc('s3sum/' + mapId);
  const aiRef = (s) => db.doc(`srun/${runId}/ai/${s}`), phRef = (s) => db.doc(`srun/${runId}/ph/${s}`);
  const extra = [...new Set(levels(sf).concat(levels(st)))].filter((s) => s !== x.from && s !== x.to); // הצד השני של מדף גבוה
  let prvOld = null, hadTo = false;
  try {
    await db.runTransaction(async (tx) => {
      const [r1, pf, pt, af, at, su, ...ex] = await Promise.all([tx.get(runRef), tx.get(phFromRef), tx.get(phToRef), tx.get(aiRef(x.from)), tx.get(aiRef(x.to)), tx.get(sumRef)]
        .concat(extra.map((s) => tx.get(aiRef(s)))).concat(extra.map((s) => tx.get(phRef(s)))));
      if (!r1.exists || !C.LIVE.includes(r1.get('st'))) throw bad('run-closed', 'הסבב כבר הסתיים או בוטל', 'failed-precondition');
      const r = r1.data();
      const ow = Object.keys(r.asg || {}).find((u) => Array.isArray(r.asg[u]) && r.asg[u].includes(sf.bay));
      if (ow !== owner || !(r.asg[owner] || []).includes(st.bay)) throw bad('not-assigned', 'השיוך בסבב השתנה. טענו מחדש.', 'permission-denied');
      if (!pf.exists || pf.get('p') !== src.p || !af.exists) throw bad('busy', 'התמונה השתנתה בינתיים. טענו מחדש ונסו שוב.', 'aborted');
      const aiFrom = af.data(), aiTo = at.exists ? at.data() : null, phTo = pt.exists ? pt.data() : null;
      tx.update(runRef, A.moveDone(r, owner, aiFrom, aiTo));
      // ph / ai של היעד
      const ph = Object.assign(noPrv(pf.data()), { p, th: tp, mv: { f: x.from, at: now, by: who.uid } });
      delete ph.sug; delete ph.ask;
      const ai = noPrv(aiFrom);
      prvOld = phTo && isObj(phTo.prv) ? phTo.prv : null;
      hadTo = !!phTo;
      if (phTo) ph.prv = noPrv(phTo);
      if (aiTo) ai.prv = noPrv(aiTo);
      tx.set(phToRef, ph);
      tx.set(aiRef(x.to), ai);
      tx.delete(phFromRef);
      tx.delete(aiRef(x.from));
      // s3sum: שני המקטעים (או אחד, כשמעבירים בין עליון לתחתון של אותו מקטע)
      const aiAfter = { [x.from]: null, [x.to]: ai }, phAfter = { [x.from]: null, [x.to]: ph };
      extra.forEach((s, i) => { aiAfter[s] = ex[i].exists ? ex[i].data() : null; phAfter[s] = ex[extra.length + i].exists ? ex[extra.length + i].data() : null; });
      const B = (su.exists && su.get('b')) || {};
      const sp = { b: {}, upd: now, run: runId };
      for (const sl of sf.bay === st.bay ? [st] : [sf, st]) {
        const ls = levels(sl), oldB = B[sl.bay];
        const ais = ls.map((s) => aiAfter[s]).filter(isObj);
        const ths = ls.map((s) => phAfter[s] && phAfter[s].th).filter((t) => typeof t === 'string' && t);
        const keepTh = oldB && typeof oldB.th === 'string' && oldB.th !== src.th ? oldB.th : '';
        if (ais.length) {
          const e = A.sumEntry(ais, runId, now, sl.bay === st.bay ? tp : (ths[0] || ''), keepTh);
          if (!e.th) e.th = FieldValue.delete();
          sp.b[sl.bay] = e;
        } else if (oldB && oldB.r === runId) {
          // המקטע כבר לא צולם בסבב הזה
          sp.b[sl.bay] = Object.assign({ s: 'miss', r: runId, t: now, n: 0 }, keepTh ? { th: keepTh } : { th: FieldValue.delete() });
        }
      }
      tx.set(sumRef, sp, { merge: true });
    });
  } catch (e) {
    await delFiles(bucket, [p, tp]);
    throw e instanceof HttpsError ? e : (logger.error('s3MovePh: write failed', { code: e && e.code }), bad('save-failed', 'ההעברה נכשלה. נסו שוב.', 'unavailable'));
  }
  // הקבצים הישנים של המקור (עכשיו יש להם עותק ביעד). "קודמת" ישנה יותר (שתי העברות לאותו יעד) – ינוקה בניקוי היומי (s3Clean)
  await delFiles(bucket, [src.p, src.th]);
  if (prvOld) logger.info('s3MovePh: older previous photo left for s3Clean', { run: runId, slot: x.to });
  return { ok: true, runId, from: x.from, to: x.to, p, th: tp, replaced: hadTo };
}

// ---------------- הפונקציות ----------------
const depsOf = () => ({ base: GEMINI_API_BASE.value(), key: GEMINI_API_KEY.value(), userMax: S3_USER_DAILY.value(), adhocMax: A.ADHOC_DAY });
exports.shelfCheck = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '512MiB' }, T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  const input = inputObject(request);
  return shelfCore(T.tdb(), { uid: who.uid, mgr: who.role === 'manager', bizId: who.bizId, brs: myBranches(who) }, input, Date.now(), depsOf());
}));
exports.mapDraft = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 540, memory: '512MiB' }, T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!(who.role === 'manager' || hasPerm(who, 's3m'))) throw bad('not-s3m', 'טיוטת מפה מותרת למנהל או לעובד עם הרשאת "שרטוט מפה"', 'permission-denied');
  return draftCore(T.tdb(), { uid: who.uid, mgr: who.role === 'manager', bizId: who.bizId, brs: myBranches(who) }, inputObject(request), Date.now(), depsOf());
}));

// שלב 20ב: העברת תמונה ממקטע למקטע (בלי AI ובלי מכסה). לא מפורסם עד מיזוג ואישור
exports.s3MovePh = onCall({ timeoutSeconds: 60, memory: '256MiB' }, T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  return moveCore(T.tdb(), { uid: who.uid, mgr: who.role === 'manager', bizId: who.bizId }, inputObject(request), Date.now(), {});
}));

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_ai', { enumerable: false, value: { shelfCore, draftCore, moveCore, reserve, release } });
