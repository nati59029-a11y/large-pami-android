'use strict';
// כפתורים בהתראת הטלפון (16.11.2026, החלטות בעל העסק): "טופל" / "הזכר לי מחר" / "הזכר לי בעוד שעה" – בלי לפתוח את האפליקציה.
//   pushAct – POST JSON { t: <אסימון>, a: 'done'|'h1'|'d1', f: <מזהה FCM של הטלפון> }  →  { ok, msg, open? } (msg – משפט קצר בעברית להצגה בטלפון).
// אסימון: 32 בתים אקראיים (base64url, 43 תווים), אחד לכל פריט לכל משתמש. נשמר רק הגיבוב (sha256) – כמו arlink ב-ar-file.js:
//   pact/{sha256}  (בשורש, שרת בלבד – החוקים סוגרים כל אוסף שלא הוגדר)  { biz, uid, kind: 'sec'|'tk', id, acts[], exp, at, used?, ua? }
// חד־פעמי (used נכתב בטרנזקציה – שתי לחיצות במקביל: רק אחת עוברת), תוקף 7 ימים, קשור לעסק+משתמש+סוג+פריט+פעולות,
// והטלפון ששלח (f) חייב להיות רשום להתראות של אותו משתמש (tokensOf). ההרשאה נבדקת מחדש בכל לחיצה, כמו קריאה מהאפליקציה:
//   sec (התראה של המזכירה) – אותו שער כמו secNotes (gate: מנהל העסק, עסק פעיל, תוספת, הסכמה בנוסח הנוכחי, מצב "מנהל ראשי").
//   tk ("הזכר לעובד") – requireStaff עם התוספת tasks, עובד פעיל, עסק פעיל. "טופל" = בדיוק כמו "✓ בוצע" באפליקציה (ACT.tkDone) ובחוקים (workerUpd).
//   "הזכר לי" במשימה – דחייה מקומית בטלפון בלבד, לא מגיעה לכאן.
// כתובת קבועה בתוך ההתראה שכבר נשלחה – לכן אזור אחד בלבד, us-central1 (כמו arFile). האסימון לא נכתב ליומן.
// ניקוי: secDaily מוחק מסמכי pact שפג תוקפם (cleanPact).

const crypto = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { LEGACY_REGION } = require('./lib/region');
const { requireStaff } = require('./lib/roles');
const T = require('./lib/tenant');

const COLL = 'pact';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const FCM_RE = /^[A-Za-z0-9_:.\-]{20,4096}$/; // כמו TOKEN_RE של registerPushToken
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ACTS = ['done', 'h1', 'd1'];
const KINDS = ['sec', 'tk'];
const DAYS = 7;
const BODY_MAX = 6000;
const H1 = 3600e3, D1 = 864e5; // "בעוד שעה" = עכשיו + שעה; "מחר" = בדיוק עכשיו + 24 שעות (החלטת בעל העסק)

const MSG = {
  done: '✓ טופל', d1: 'נדחה למחר', h1: 'נדחה לעוד שעה', wait: 'נשלח לאישור המנהל', closed: 'המשימה כבר סגורה',
  open: 'פתחו את האפליקציה כדי לסיים', notMine: 'המשימה כבר לא אצלך', used: 'הפעולה כבר בוצעה',
  stale: 'הכפתור כבר לא בתוקף. פתחו את האפליקציה', deny: 'אין הרשאה. פתחו את האפליקציה', late: 'כבר מאוחר מדי לדחות. פתחו את האפליקציה',
  bad: 'בקשה לא תקינה', err: 'משהו השתבש. נסו שוב או פתחו את האפליקציה',
};

const hashOf = (tok) => crypto.createHash('sha256').update(String(tok), 'utf8').digest('hex');

// כתובת הפונקציה (נכנסת להתראה). באמולטור – הכתובת המקומית. כמו urlOf ב-ar-file.js
function urlOf(o) {
  const project = (o && o.project) || process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || '';
  if (o && o.base) return o.base.replace(/\/+$/, '');
  if (process.env.FUNCTIONS_EMULATOR === 'true') return `http://${process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001'}/${project}/${LEGACY_REGION}/pushAct`;
  return `https://${LEGACY_REGION}-${project}.cloudfunctions.net/pushAct`;
}

// אסימון חדש לפריט. { bizId, uid, kind, id, acts, now? } → { token, u, exp }. האסימון עצמו לא נשמר – רק מוחזר כדי להיכנס להתראה
async function mkAct(a) {
  const now = a.now || Date.now();
  if (!T.BIZ_RE.test(String(a.bizId || '')) || !ID_RE.test(String(a.uid || '')) || !KINDS.includes(a.kind) || !ID_RE.test(String(a.id || ''))) throw new Error('push-act: bad args');
  const acts = [...new Set(Array.isArray(a.acts) ? a.acts : [])].filter((x) => ACTS.includes(x));
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = now + DAYS * D1;
  await getFirestore().doc(`${COLL}/${hashOf(token)}`).create({ biz: a.bizId, uid: a.uid, kind: a.kind, id: a.id, acts, exp, at: now });
  return { token, u: urlOf(a), exp };
}

// בדיקת הקלט (בלי מסד). מחזיר { t, a, f } או null
function parseBody(req) {
  const ct = String((req.headers && req.headers['content-type']) || '');
  if (!/^application\/json\b/i.test(ct)) return null;
  if (req.rawBody && req.rawBody.length > BODY_MAX) return null;
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const t = typeof b.t === 'string' ? b.t : '', a = typeof b.a === 'string' ? b.a : '', f = typeof b.f === 'string' ? b.f.trim() : '';
  if (!TOKEN_RE.test(t) || !ACTS.includes(a) || !FCM_RE.test(f)) return null;
  return { t, a, f };
}

// "✓ בוצע" במשימה – אותם כללים כמו workerUpd בחוקים ו-ACT.tkDone באפליקציה. מחזיר { patch } או { r, msg, open? } (נדחה)
// t = נתוני המשימה, uid = המשתמש, mgr = מנהל (באפליקציה מנהל סוגר גם משימה עם הערת עובד), name = doneBy, now
const dlOf = (t) => (Number.isFinite(t.dl) ? t.dl : t.due); // כמו tkDlOf בחוקים: dl אם נשמר, אחרת due. 0/חסר = בלי יעד
function tkPlan(t, uid, mgr, name, now) {
  if (!t || t.st !== 'open') return { r: 'closed', msg: MSG.closed };
  const ow = typeof t.ow === 'string' ? t.ow : '';
  if (!ow) return { r: 'open-app', msg: MSG.open, open: true }; // משימה קבוצתית שעוד לא נתפסה – "אני מטפל" באפליקציה
  if (ow !== uid) return { r: 'not-owner', msg: MSG.notMine };
  if (t.pr === '1' || Number(t.np) > 0) return { r: 'open-app', msg: MSG.open, open: true }; // נדרשת תמונה – רק באפליקציה
  if (!name) return { r: 'open-app', msg: MSG.open, open: true };
  if (!mgr && t.nc === '1') return { patch: { st: 'wait', sub: now, doneBy: name }, r: 'wait', msg: MSG.wait };
  const dl = dlOf(t);
  return { patch: { st: 'done', open: '', sub: now, ok: now, doneBy: name, late: dl > 0 && now > dl ? '1' : '' }, r: 'done', msg: MSG.done };
}

// השם שהאפליקציה כותבת ב-doneBy: החלק שלפני @ במייל של המשתמש (fbBy באפליקציה, isMyName בחוקים)
async function nameOf(uid) {
  const { getAuth } = require('firebase-admin/auth');
  const u = await getAuth().getUser(uid);
  return String(u.email || '').split('@')[0];
}

const R = (ok, r, msg, extra) => Object.assign({ ok, r, msg }, extra || {});
const live = (p, now) => !!p && !p.used && typeof p.exp === 'number' && p.exp > now;

// הלחיצה עצמה. b = { t, a, f }; o = { now, nameOf } (בבדיקות). מחזיר את גוף התשובה
async function act(b, o) {
  const opt = o || {};
  const now = opt.now || Date.now();
  const ref = getFirestore().doc(`${COLL}/${hashOf(b.t)}`);
  const s = await ref.get();
  const d = s.exists ? s.data() || {} : null;
  if (!d || !KINDS.includes(d.kind) || !T.BIZ_RE.test(String(d.biz || '')) || !ID_RE.test(String(d.uid || '')) || !ID_RE.test(String(d.id || '')) || !Array.isArray(d.acts)) return R(false, 'no-token', MSG.stale, { open: true });
  if (d.used) return R(false, 'used', MSG.used);
  if (!(typeof d.exp === 'number' && d.exp > now)) return R(false, 'expired', MSG.stale, { open: true });
  if (!d.acts.includes(b.a)) return d.kind === 'tk' && b.a === 'done' ? R(false, 'open-app', MSG.open, { open: true }) : R(false, 'bad-act', MSG.bad);
  // בדיקת הרשאה מחדש – בתוך העסק, בדיוק כמו קריאה מהאפליקציה של אותו משתמש (bizId מהאסימון, לא מהלקוח)
  return T.runInBiz({}, async () => {
    const req = { auth: { uid: d.uid }, data: { bizId: d.biz } };
    let who;
    try {
      who = d.kind === 'sec' ? (await require('./secretary')._core.gate(req, { consent: true })).who : await requireStaff(req, { feature: 'tasks' });
    } catch (e) { return R(false, (e && e.details && e.details.reason) || 'deny', MSG.deny, { open: true }); }
    if (!who || who.uid !== d.uid || who.bizId !== d.biz || who.biz.status !== 'active') return R(false, 'deny', MSG.deny, { open: true });
    const db = T.tdb();
    const RM = require('./secretary-remind')._core;
    if (!(await RM.tokensOf(db, d.uid)).includes(b.f)) return R(false, 'bad-device', MSG.deny, { open: true });
    return d.kind === 'tk' ? tkAct(db, ref, d, who, b, now, opt) : secAct(db, ref, d, b, now, RM);
  });
}

// משימה: הבדיקה, הסגירה וסימון האסימון כמשומש – בטרנזקציה אחת
async function tkAct(db, ref, d, who, b, now, opt) {
  let name = '';
  try { name = await (opt.nameOf || nameOf)(d.uid); } catch (e) { name = ''; }
  const tRef = db.doc('tasks/' + d.id);
  return db.runTransaction(async (tx) => {
    const [p, ts] = await Promise.all([tx.get(ref), tx.get(tRef)]);
    if (!live(p.exists ? p.data() : null, now)) return p.exists && p.get('used') ? R(false, 'used', MSG.used) : R(false, 'expired', MSG.stale, { open: true });
    const plan = tkPlan(ts.exists ? ts.data() : null, d.uid, who.role === 'manager', name, now);
    if (!plan.patch) return R(plan.r === 'closed', plan.r, plan.msg, plan.open ? { open: true } : null);
    tx.update(tRef, plan.patch);
    tx.update(ref, { used: now, ua: b.a });
    return R(true, plan.r, plan.msg);
  });
}

// התראה של המזכירה: תפיסת האסימון בטרנזקציה, ואז הפעולה הקיימת (doneNote / snooze). תקלה – האסימון משתחרר ואפשר ללחוץ שוב
async function secAct(db, ref, d, b, now, RM) {
  const got = await db.runTransaction(async (tx) => {
    const p = await tx.get(ref);
    if (!live(p.exists ? p.data() : null, now)) return p.exists && p.get('used') ? 'used' : 'expired';
    tx.update(ref, { used: now, ua: b.a });
    return 'ok';
  });
  if (got === 'used') return R(false, 'used', MSG.used);
  if (got !== 'ok') return R(false, 'expired', MSG.stale, { open: true });
  // אחרי התפיסה (כדי ששתי לחיצות במקביל לא יחזירו שתיהן ok): התראה שנמחקה או כבר נסגרה – "כבר סגורה" (ok: הטלפון מסיר את ההתראה)
  const ns = await db.doc(`sec_note/${d.uid}/n/${d.id}`).get();
  if (!ns.exists || (b.a === 'done' && ['done', 'gone'].includes(ns.get('st')))) return R(true, 'closed', MSG.closed);
  try {
    if (b.a === 'done') { await RM.doneNote(db, d.uid, d.id, 'push'); return R(true, 'done', MSG.done); }
    const at = Math.floor((now + (b.a === 'h1' ? H1 : D1)) / 60e3) * 60e3;
    await RM.snooze(db, d.uid, d.id, at, now, 'push');
    return R(true, b.a, MSG[b.a]);
  } catch (e) {
    await ref.update({ used: FieldValue.delete(), ua: FieldValue.delete() }).catch(() => null);
    const why = e && e.details && e.details.reason;
    if (why === 'gone' || why === 'not-found') return R(true, 'closed', MSG.closed);
    if (why === 'too-late' || why === 'bad-at') return R(false, 'too-late', MSG.late, { open: true });
    throw e;
  }
}

async function handle(req, res, o) {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json(R(false, 'method', MSG.bad));
  const b = parseBody(req);
  if (!b) return res.status(400).json(R(false, 'bad-input', MSG.bad));
  const out = await act(b, o);
  if (!out.ok) logger.info('pushAct: rejected', { reason: out.r }); // בלי האסימון ובלי מזהה הטלפון
  return res.status(200).json(out);
}

// ניקוי: מסמכי pact שפג תוקפם (נקרא מ-secDaily)
async function cleanPact(now) {
  const db = getFirestore();
  let n = 0;
  for (;;) {
    const s = await db.collection(COLL).where('exp', '<', now || Date.now()).limit(400).get();
    if (s.empty) return n;
    const b = db.batch(); s.docs.forEach((x) => b.delete(x.ref)); await b.commit();
    n += s.size;
    if (s.size < 400) return n;
  }
}

exports.pushAct = onRequest({ region: LEGACY_REGION, maxInstances: 5, timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  try { await handle(req, res); } catch (e) {
    logger.error('pushAct failed', { reason: 'internal', name: e && e.name, code: e && e.code });
    if (!res.headersSent) res.status(500).json(R(false, 'internal', MSG.err));
  }
});
Object.defineProperty(exports, '_core', { enumerable: false, value: { handle, act, mkAct, parseBody, tkPlan, dlOf, urlOf, hashOf, cleanPact, MSG, ACTS, COLL, DAYS, TOKEN_RE } });
