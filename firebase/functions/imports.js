'use strict';
// ייבוא קבצים ברקע (משימה 2026-11-11, שלב 3): הטלפון שולח את השורות לשרת ויכול לצאת מהאפליקציה; השרת מעבד לבד.
//
//   startImport (onCall, מנהל בלבד, שני האזורים)
//     { job, kind:'cust'|'prod', total, at, rows[≤200], ns?, br?, addQty? }  – שליחת חלק מהקובץ (at = מספר השורה הראשונה, מ-0).
//       job = מזהה של 20 תווים שהטלפון בוחר פעם אחת לכל קובץ. שליחה חוזרת של אותו חלק (אחרי ניתוק) לא נוספת פעמיים.
//     { retry: job }  – "נסה שוב" לחלקים שנכשלו.
//   runImportChunk (טריגר Firestore, europe-west1 בלבד, retry) – מעבד חלק אחד: אותה ליבה בדיוק כמו importCusts/importProducts.
//
// איפה הנתונים:
//   <עסק>/impJobs/{job}   { k, uid, t, upd, total, br, addQty, st:'up'|'run'|'done'|'part', recv, got:{<n>:שורות}, next, wait[], dn, fr,
//                           cnt:{c,u,s,b,sk}, bad:[{n,r,m}], fail:[{n,id,why}], fin? }  – מונים בלבד, בלי נתוני לקוח. מנהלי העסק קוראים (חוקים).
//   impQ/{biz}_{job}/c/{id}  { biz, job, n, cnt, k, uid, box, t, tries, st:'q'|'wait'|'done'|'err', kk }  – חלק מוצפן (AES-GCM, CARD.seal):
//                           כל השורות של החלק (כולל כרטיסים) בתוך box אחד, AAD = imp/{biz}/{job}/{n}. אין גישה מהאפליקציה בכלל (חוקים).
//   impQ/{biz}_{job}/r/{n}/i/{i}  { k, sk }  – תוצאת שורה של לקוח (נוצר/עודכן/זהה), נכתבת באותה טרנזקציה של השורה.
//   בשורש (ולא בתוך העסק) כדי שטריגר אחד ישרת את כל העסקים. המזהה כולל את העסק, כך שעסקים לא מתנגשים.
//
// סדר ואידמפוטנטיות (טריגר עם retry מופעל "לפחות פעם אחת"):
//   - החלקים של עבודה מעובדים אחד אחרי השני לפי סדר השורות (job.next) – בדיוק כמו המנות הרצופות של הייבוא הישן, ולכן אותה תוצאה.
//     חלק שהגיע לפני תורו מסומן 'wait'; כשהחלק הקודם מסתיים, באותה טרנזקציה החלק הבא נוצר מחדש (מזהה חדש) – והטריגר מפעיל אותו.
//   - לקוחות: כל שורה בטרנזקציה משלה, יחד עם תוצאת השורה. ניסיון חוזר מדלג על שורות שבוצעו וסופר אותן לפי התוצאה השמורה.
//   - מוצרים: טרנזקציה אחת לחלק עם הסימון ordcfg/req_<job>_<n> (כמו importProducts). ניסיון חוזר מקבל את התוצאה השמורה.
//   - המונים של העבודה מתעדכנים רק בטרנזקציה שמסמנת את החלק 'done' – פעם אחת בלבד.
//   - שגיאה קבועה (פענוח נכשל, אין הרשאה, נתונים שגויים ברמת החלק) – לא זורקים (אחרת ניסיונות אינסופיים): החלק מסומן 'err' והעבודה ממשיכה.
//     שגיאה זמנית – זורקים, ו-Google מנסה שוב. יותר מ-MAX_TRIES ניסיונות, או אירוע ישן מ-MAX_AGE_MS – 'err'.
//   - אחרי חלק שהצליח: התוכן המוצפן נמחק מיד. בסיום עבודה בלי כשלים – כל impQ של העבודה נמחק. חלקים שנכשלו נשארים (מוצפנים) ל"נסה שוב",
//     ונמחקים אחרי 7 ימים (בעבודה הבאה של העסק). מסמך העבודה (מונים בלבד) נמחק אחרי 30 יום.
// כלל ברזל: שום יומן ושום שדה גלוי לא כולל ערכים מהשורות. הודעות שגיאה לשורה (bad.m) עוברות ניקוי של רצפי ספרות.

const { HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, NEW_REGION } = require('./lib/region');
const T = require('./lib/tenant');
const { inputObject } = require('./lib/roles');
const CARD = require('./lib/card');
const CUS = require('./customers')._core;
const ORD = require('./orders')._core;

const CARD_ENC_KEY = CUS.CARD_ENC_KEY;
const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });
const deny = (reason, message) => new HttpsError('permission-denied', message, { reason });
const pre = (reason, message) => new HttpsError('failed-precondition', message, { reason });

// גודל חלק: לקוחות עד 100 שורות, מוצרים עד 200 (= מנה של הייבוא הישן), ובכל מקרה עד CHUNK_BYTES של JSON לפני הצפנה.
// שורה גדולה מ-rowMax (גדולה מכל שורה תקינה אפשרית) נשמרת כ-null ונספרת כ"שורה לא תקינה".
const KINDS = { cust: { rows: 100, rowMax: 48000 }, prod: { rows: 200, rowMax: 4000 } };
// סבב 2: אירוע של טריגר (Eventarc) מוגבל ל-512KB (לא מאומת – מכסות Eventarc), והמסמך כולו נשלח באירוע.
// 300,000 בתים של JSON → אחרי base64 ≈ 400KB + תקורה; DOC_MAX = גבול קשיח לפני שמירה, בבירור מתחת ל-512KB.
const CHUNK_BYTES = 300000;
const DOC_MAX = 460000;
const CALL_ROWS = 200;
const MAX_TOTAL = 50000;
const MAX_TRIES = 6;
const MAX_AGE_MS = 3 * 3600 * 1000;
const BAD_MAX = 200;
const KEEP_DATA_MS = 7 * 86400 * 1000;
const STUCK_MS = 10 * 60 * 1000; // סבב 2: חלק שתורו הגיע ולא התקדם 10 דקות (יותר מ-540 שניות של ריצה) = "נתקע"; "נסה שוב" מפעיל אותו מחדש
const KEEP_JOB_MS = 30 * 86400 * 1000;
const JOB_RE = /^[A-Za-z0-9]{20}$/;

const qRef = (biz, job) => getFirestore().collection('impQ').doc(biz + '_' + job);
const aadOf = (biz, job, n) => `imp/${biz}/${job}/${n}`;
const jobIdOf = (v) => { if (typeof v !== 'string' || !JOB_RE.test(v)) throw bad('bad-job', 'מזהה ייבוא לא תקין'); return v; };
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function onlyKeys(o, keys) { for (const k of Object.keys(o)) if (!keys.includes(k)) throw bad('bad-field', 'שדה לא מוכר'); }
// הודעה לשורה (נשמרת במסמך העבודה): בלי רצף של 8 ספרות ומעלה (גם עם רווחים/מקפים/נקודות ביניהן)
const clean = (m) => String(m == null ? '' : m).replace(/\d(?:[\s.\-/_]*\d){7,}/g, '…').slice(0, 120);
const stOf = (j) => ((j.recv || 0) < j.total ? 'up' : (j.dn || 0) + (j.fr || 0) >= j.total ? ((j.fr || 0) > 0 ? 'part' : 'done') : 'run');
const docBytes = (d) => Buffer.byteLength(JSON.stringify(d), 'utf8') + 200; // הערכה עליונה (שמות שדות + נתיב + תקורה)

// חלוקת שורות של קריאה אחת לחלקים. n = מספר השורה הראשונה של החלק בקובץ (מ-0) – קבוע לאותה קריאה, ולכן שליחה חוזרת מזוהה.
function pack(kind, rows, ns, at) {
  const K = KINDS[kind]; const out = []; let cur = null, bytes = 0;
  rows.forEach((r0, i) => {
    let r = r0 === undefined ? null : r0;
    let s = JSON.stringify(r);
    if (s === undefined || Buffer.byteLength(s, 'utf8') > K.rowMax) { r = null; s = 'null'; }
    const b = Buffer.byteLength(s, 'utf8') + 12;
    if (!cur || cur.rows.length >= K.rows || bytes + b > CHUNK_BYTES) { cur = { n: at + i, rows: [], ns: [] }; out.push(cur); bytes = 0; }
    cur.rows.push(r); cur.ns.push(ns[i]); bytes += b;
  });
  return out;
}
function sealChunk(key, biz, job, c) {
  return { n: c.n, cnt: c.rows.length, box: CARD.seal(key, biz, aadOf(biz, job, c.n), { rows: c.rows, ns: c.ns }) };
}

// ---------- startImport ----------
async function startImport(request) {
  const w = await ORD.who(request); // requireStaff (תוספת orders) + הרשאת ord, כמו importCusts/importProducts
  if (w.role !== 'manager') throw deny('manager-only', 'ייבוא קובץ ברקע – מנהל בלבד');
  const input = inputObject(request);
  if (input.retry !== undefined) { onlyKeys(input, ['retry']); return retryJob(w, jobIdOf(input.retry)); }
  onlyKeys(input, ['job', 'kind', 'total', 'at', 'rows', 'ns', 'br', 'addQty', 'skipEx']);
  const job = jobIdOf(input.job);
  const kind = input.kind;
  if (!KINDS[kind]) throw bad('bad-kind', 'סוג ייבוא לא תקין');
  const total = input.total, at = input.at, rows = input.rows;
  if (!intIn(total, 1, MAX_TOTAL)) throw bad('bad-total', `מספר שורות בקובץ: 1 עד ${MAX_TOTAL}`);
  if (!Array.isArray(rows) || !rows.length || rows.length > CALL_ROWS) throw bad('bad-rows', `שורות: 1 עד ${CALL_ROWS}`);
  if (!intIn(at, 0, total - 1) || at + rows.length > total) throw bad('bad-at', 'מיקום החלק בקובץ לא תקין');
  let ns = input.ns;
  if (ns === undefined || ns === null) ns = rows.map((_, i) => at + i + 1);
  else if (!Array.isArray(ns) || ns.length !== rows.length || !ns.every((x) => intIn(x, 1, 10000000))) throw bad('bad-ns', 'מספרי שורות לא תקינים');
  let br = null, addQty = false, skipEx = false;
  if (kind === 'prod') {
    if (input.br != null && input.br !== '' && typeof input.br !== 'string') throw bad('bad-br', 'סניף לא תקין');
    br = input.br == null || input.br === '' ? null : input.br;
    addQty = input.addQty === true;
    skipEx = input.skipEx === true;
    ORD.prodBr(w, br, rows); // אותה בדיקת סניף כמו importProducts – כבר עכשיו, ולא רק בעיבוד
  } else if (input.br !== undefined || input.addQty !== undefined || input.skipEx !== undefined) throw bad('bad-field', 'שדה לא מוכר');

  const key = CARD_ENC_KEY.value();
  const chunks = pack(kind, rows, ns, at).map((c) => sealChunk(key, w.bizId, job, c));
  for (const c of chunks) if (docBytes(c) > DOC_MAX) throw new HttpsError('internal', 'חלק מהקובץ גדול מדי. נסו קובץ קטן יותר.', { reason: 'too-big' });

  const db = getFirestore();
  const jobRef = db.doc(w.prefix + 'impJobs/' + job);
  const q = qRef(w.bizId, job);
  const now = Date.now();
  let isNew = false;
  const out = await db.runTransaction(async (tx) => {
    const js = await tx.get(jobRef);
    let j;
    if (!js.exists) {
      isNew = true;
      j = { k: kind, uid: w.uid, t: now, total, br, addQty, skipEx, st: 'up', recv: 0, got: {}, next: 0, wait: [], dn: 0, fr: 0, cnt: { c: 0, u: 0, s: 0, b: 0, sk: 0 }, bad: [], fail: [] };
    } else {
      isNew = false;
      j = js.data();
      if (j.k !== kind || j.total !== total || j.uid !== w.uid || (j.br || null) !== br || (j.addQty === true) !== addQty || (j.skipEx === true) !== skipEx) throw pre('job-mismatch', 'החלק לא תואם לייבוא שכבר התחיל. התחילו ייבוא חדש.');
    }
    const got = Object.assign({}, j.got || {});
    let recv = j.recv || 0;
    for (const c of chunks) {
      if (got[c.n] !== undefined) { if (got[c.n] !== c.cnt) throw pre('job-mismatch', 'החלק לא תואם לייבוא שכבר התחיל. התחילו ייבוא חדש.'); continue; } // שליחה חוזרת
      for (const [k, v] of Object.entries(got)) { const a = +k; if (c.n < a + v && a < c.n + c.cnt) throw bad('bad-at', 'חלקי הקובץ חופפים'); }
      got[c.n] = c.cnt; recv += c.cnt;
      tx.create(q.collection('c').doc(String(c.n)), { biz: w.bizId, job, n: c.n, cnt: c.cnt, k: kind, uid: w.uid, box: c.box, t: now, tries: 0, st: 'q', kk: 0 });
    }
    if (recv > total) throw bad('bad-at', 'יותר שורות ממספר השורות בקובץ');
    const upd = { got, recv, upd: now };
    upd.st = stOf(Object.assign({}, j, upd));
    if (!js.exists) tx.set(jobRef, Object.assign(j, upd)); else tx.update(jobRef, upd);
    return { ok: true, job, recv, total, st: upd.st };
  });
  if (isNew) await sweep(db, w).catch((e) => logger.warn('imports: sweep failed', { name: e && e.name, code: e && e.code }));
  return out;
}

// ניקוי (בלי מתזמן): בכל עבודה חדשה של העסק – חלקים מוצפנים של עבודות בנות יותר מ-7 ימים, ומסמכי עבודה בני יותר מ-30 יום.
async function sweep(db, w) {
  const now = Date.now();
  const s = await db.collection(w.prefix + 'impJobs').where('t', '<', now - KEEP_DATA_MS).limit(20).get();
  for (const d of s.docs) {
    await db.recursiveDelete(qRef(w.bizId, d.id));
    if ((d.get('t') || 0) < now - KEEP_JOB_MS) await d.ref.delete();
  }
}

// "נסה שוב": כל חלק שנכשל נוצר מחדש (מזהה חדש, אותו n) – הטריגר מפעיל אותו שוב. שורות שכבר בוצעו בחלק לא יבוצעו פעמיים.
// סבב 2 (חילוץ ייבוא תקוע): גם חלק במצב 'q'/'wait' שתורו הגיע (n ≤ next) ולא התקדם STUCK_MS – למשל אירוע שלא הגיע לטריגר,
// או הפעלה של החלק הבא שלא קרתה – נוצר מחדש. אם הוא בכל זאת עדיין רץ, ההרצה הישנה תסתיים ב-'skip' (המסמך שלה נמחק) והעיבוד אידמפוטנטי.
async function retryJob(w, job) {
  const db = getFirestore();
  const jobRef = db.doc(w.prefix + 'impJobs/' + job);
  const q = qRef(w.bizId, job);
  return db.runTransaction(async (tx) => {
    const js = await tx.get(jobRef);
    if (!js.exists) throw new HttpsError('not-found', 'הייבוא לא נמצא', { reason: 'no-job' });
    const j = js.data();
    const now = Date.now();
    const fail = Array.isArray(j.fail) ? j.fail : [];
    const snaps = fail.length ? await tx.getAll(...fail.map((f) => q.collection('c').doc(String(f.id)))) : [];
    const open = (await tx.get(q.collection('c').where('st', 'in', ['q', 'wait']))).docs
      .filter((s) => s.get('n') <= (j.next || 0) && now - (s.get('at') || s.get('t') || 0) > STUCK_MS && now - (j.upd || 0) > STUCK_MS);
    let rows = 0, n = 0;
    const redo = (s) => {
      const d = s.data(); delete d.why; delete d.at;
      const kk = (d.kk || 0) + 1;
      tx.create(q.collection('c').doc(`${d.n}-${kk}`), Object.assign(d, { st: 'q', tries: 0, kk, t: now }));
      tx.delete(s.ref);
      n++;
      return d;
    };
    snaps.forEach((s) => { if (s.exists && s.get('st') === 'err') rows += redo(s).cnt; });
    open.forEach((s) => redo(s));
    const upd = { upd: now };
    if (fail.length) Object.assign(upd, { fail: [], fr: Math.max(0, (j.fr || 0) - rows), fin: FieldValue.delete() });
    if (open.length) upd.wait = (j.wait || []).filter((x) => !open.some((s) => s.id === x.id));
    upd.st = stOf(Object.assign({}, j, upd));
    if (n) tx.update(jobRef, upd);
    return { ok: true, n, st: n ? upd.st : j.st };
  });
}

// ---------- עיבוד חלק (הטריגר; גם נקרא ישירות בבדיקות) ----------
// opts: { old: true – האירוע ישן מדי (מסמנים 'err'); failAt – בדיקות בלבד: שגיאה זמנית לפני שורה failAt }
async function processChunk(ref, opts) {
  opts = opts || {};
  const db = getFirestore();
  const s0 = await ref.get();
  if (!s0.exists) return 'gone';
  const c = s0.data();
  if (c.st !== 'q') return c.st;
  const q = ref.parent.parent;
  const biz = await T.loadBiz(c.biz);
  if (!biz) { await db.recursiveDelete(q); return 'nobiz'; }
  const jobRef = db.doc(T.bizPrefix(biz) + 'impJobs/' + c.job);
  const now = Date.now();
  const step = await db.runTransaction(async (tx) => {
    const [js, cs] = await tx.getAll(jobRef, ref);
    if (!cs.exists || cs.get('st') !== 'q') return { go: 'skip' };
    if (!js.exists) return { go: 'nojob' };
    const j = js.data();
    if (c.n > (j.next || 0)) { // עוד לא תורו: מחכה לחלק הקודם
      tx.update(ref, { st: 'wait' });
      tx.update(jobRef, { wait: FieldValue.arrayUnion({ n: c.n, id: ref.id }), upd: now });
      return { go: 'wait' };
    }
    const tries = (cs.get('tries') || 0) + 1;
    tx.update(ref, { tries, at: now });
    return { go: tries > MAX_TRIES || opts.old ? 'fail' : 'run', tries, br: j.br || null, addQty: j.addQty === true, skipEx: j.skipEx === true };
  });
  if (step.go === 'skip' || step.go === 'wait') return step.go;
  if (step.go === 'nojob') { await db.recursiveDelete(q); return 'nojob'; }
  if (step.go === 'fail') return finish(ref, c, jobRef, { err: opts.old ? 'expired' : 'tries' });

  let payload;
  try { payload = CARD.open(opts.key || CARD_ENC_KEY.value(), c.biz, aadOf(c.biz, c.job, c.n), c.box); } catch (e) {
    if (e instanceof HttpsError && e.details && e.details.reason === 'bad-box') return finish(ref, c, jobRef, { err: 'bad-box' });
    throw e; // מפתח חסר וכו' – זמני
  }
  const rows = payload && Array.isArray(payload.rows) ? payload.rows : null;
  if (!rows || rows.length !== c.cnt) return finish(ref, c, jobRef, { err: 'bad-box' });
  const ns = Array.isArray(payload.ns) ? payload.ns : [];
  // בדיקות בלבד: באמולטור, חלק עם _t נכשל פעם אחת (בניסיון הראשון) לפני השורה _t
  const failAt = Number.isInteger(opts.failAt) ? opts.failAt : (process.env.FUNCTIONS_EMULATOR === 'true' && Number.isInteger(c._t) && step.tries === 1 ? c._t : -1);
  let res;
  try {
    res = await T.runInBiz({}, async () => {
      const w = await (c.k === 'prod' ? ORD.who : CUS.who)({ auth: { uid: c.uid }, data: { bizId: c.biz } }); // ההרשאה נבדקת שוב בזמן העיבוד
      if (w.role !== 'manager') throw deny('manager-only', 'ייבוא – מנהל בלבד');
      if (c.k === 'prod') {
        const r = await ORD.prodRows(w, { reqId: c.job + '_' + c.n, br: step.br, addQty: step.addQty, skipEx: step.skipEx, rows });
        if (failAt === 0) throw new Error('test: injected failure');
        return r;
      }
      const rc = q.collection('r').doc(String(c.n)).collection('i');
      const prior = new Map();
      (await rc.get()).forEach((d) => prior.set(+d.id, d.data()));
      return CUS.custRows(w, T.tdb(), rows, { prior, ref: (i) => rc.doc(String(i)), fail: failAt < 0 ? null : (i) => { if (i === failAt) throw new Error('test: injected failure'); } });
    });
  } catch (e) {
    if (e instanceof HttpsError) return finish(ref, c, jobRef, { err: String((e.details && e.details.reason) || 'bad').slice(0, 40) });
    logger.warn('imports: chunk failed, retrying', { job: c.job, n: c.n, tries: step.tries, name: e && e.name, code: e && e.code });
    throw transient(e);
  }
  return finish(ref, c, jobRef, { res, ns });
}

// סיום חלק (הצלחה או 'err'): המונים, הסימון 'done'/'err', קידום התור והפעלת החלק הבא – בטרנזקציה אחת.
async function finish(ref, c, jobRef, r) {
  const db = getFirestore();
  const q = ref.parent.parent;
  const now = Date.now();
  const out = await db.runTransaction(async (tx) => {
    const [js, cs] = await tx.getAll(jobRef, ref);
    if (!js.exists || !cs.exists || cs.get('st') !== 'q') return null;
    const j = js.data();
    let next = j.next || 0, kick = null;
    const wait = (j.wait || []).slice();
    if (c.n === next) {
      next = c.n + c.cnt;
      const wi = wait.findIndex((x) => x.n === next);
      if (wi > -1) { kick = wait[wi]; wait.splice(wi, 1); }
    }
    const ks = kick ? await tx.get(q.collection('c').doc(String(kick.id))) : null;
    const upd = { next, wait, upd: now };
    if (r.err) {
      upd.fr = (j.fr || 0) + c.cnt;
      upd.fail = (j.fail || []).concat([{ n: c.n, id: ref.id, why: r.err }]);
      tx.update(ref, { st: 'err', why: r.err, at: now });
    } else {
      const res = r.res || {};
      const cnt = Object.assign({ c: 0, u: 0, s: 0, b: 0, sk: 0 }, j.cnt || {});
      cnt.c += (res.created || 0) + (res.added || 0);
      cnt.u += res.updated || 0;
      cnt.s += res.same || 0;
      cnt.b += (res.bad || []).length;
      cnt.sk += res.cardSkip || 0;
      upd.cnt = cnt;
      upd.dn = (j.dn || 0) + c.cnt;
      const list = (j.bad || []).slice();
      for (const b of res.bad || []) {
        if (list.length >= BAD_MAX) break;
        list.push({ n: Number.isInteger(r.ns[b.i]) ? r.ns[b.i] : c.n + b.i + 1, r: String(b.reason || 'bad').slice(0, 40), m: clean(b.msg) });
      }
      upd.bad = list;
      tx.update(ref, { st: 'done', box: FieldValue.delete(), at: now });
    }
    upd.st = stOf(Object.assign({}, j, upd));
    if (upd.st === 'done' || upd.st === 'part') upd.fin = now;
    tx.update(jobRef, upd);
    if (ks && ks.exists && ks.get('st') === 'wait') {
      const d = ks.data(); const kk = (d.kk || 0) + 1;
      tx.create(q.collection('c').doc(`${d.n}-${kk}`), Object.assign(d, { st: 'q', kk }));
      tx.delete(ks.ref);
    }
    return upd;
  });
  if (!out) return 'skip';
  if (out.st === 'done') await db.recursiveDelete(q).catch(() => {});
  else if (!r.err) { await db.recursiveDelete(q.collection('r').doc(String(c.n))).catch(() => {}); await ref.delete().catch(() => {}); }
  return r.err ? 'err' : 'done';
}

// סבב 2: השגיאה שנזרקת ל-Google (ונרשמת ביומן עם ההודעה) – בלי ההודעה המקורית, שעלולה לכלול נתיב מסמך (למשל cust/t<ת"ז>)
const transient = (e) => Object.assign(new Error('transient: ' + String((e && (e.code || e.name)) || 'error').replace(/[^\w.-]/g, '').slice(0, 40)), { transient: true });
const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`imports: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code }); // בלי קלט ובלי הודעה מלאה
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

exports.startImport = onCall({ secrets: [CARD_ENC_KEY], timeoutSeconds: 120, memory: '512MiB' }, wrap('startImport', startImport));
exports.runImportChunk = onDocumentCreated(
  { document: 'impQ/{qid}/c/{cid}', region: NEW_REGION, retry: true, timeoutSeconds: 540, memory: '512MiB', maxInstances: 3, secrets: [CARD_ENC_KEY] },
  async (event) => {
    if (!event.data) return;
    const age = Date.now() - Date.parse(event.time || '');
    try { await processChunk(event.data.ref, { old: age > MAX_AGE_MS }); } catch (e) { throw e && e.transient ? e : transient(e); }
  },
);
Object.defineProperty(exports, '_core', { enumerable: false, value: { pack, sealChunk, processChunk, finish, aadOf, qRef, clean, stOf, docBytes, KINDS, CHUNK_BYTES, DOC_MAX, STUCK_MS, retryJob, transient, CALL_ROWS, MAX_TRIES } });
