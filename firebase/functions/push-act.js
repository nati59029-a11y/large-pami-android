'use strict';
// כפתורים בהתראת הטלפון (16.11.2026, החלטות בעל העסק): "טופל" / "הזכר לי מחר" / "הזכר לי בעוד שעה" – בלי לפתוח את האפליקציה.
//   pushAct – POST JSON { t: <אסימון>, a: 'done'|'h1'|'d1', f: <מזהה FCM של הטלפון> }  →  { ok, msg, open? } (msg – משפט קצר בעברית להצגה בטלפון).
// אסימון: 32 בתים אקראיים (base64url, 43 תווים), אחד לכל פריט לכל משתמש. נשמר רק הגיבוב (sha256) – כמו arlink ב-ar-file.js:
//   pact/{sha256}  (בשורש, שרת בלבד – החוקים סוגרים כל אוסף שלא הוגדר)  { biz, uid, kind: 'sec'|'tk', id, acts[], exp, at, used?, ua? }
// חד־פעמי (used נכתב בטרנזקציה – שתי לחיצות במקביל: רק אחת עוברת), תוקף 7 ימים, קשור לעסק+משתמש+סוג+פריט+פעולות,
// והטלפון ששלח (f) חייב להיות רשום להתראות של אותו משתמש (tokensOf), וגם השיוך הגלובלי שלו (push_dev, ראו devPath) – לאותו עסק ואותו משתמש
// (טלפון שעבר למשתמש בעסק אחר לא נמחק מ-pushTokens של העסק הקודם, אבל push_dev כבר מצביע על העסק החדש). ההרשאה נבדקת מחדש בכל לחיצה, כמו קריאה מהאפליקציה:
//   sec (התראה של המזכירה) – אותו שער כמו secNotes (gate: מנהל העסק, עסק פעיל, תוספת, הסכמה בנוסח הנוכחי, מצב "מנהל ראשי").
//   tk ("הזכר לעובד") – requireStaff עם התוספת tasks, עובד פעיל, עסק פעיל. "טופל" = בדיוק כמו "✓ בוצע" באפליקציה (ACT.tkDone) ובחוקים (workerUpd).
//   "הזכר לי" במשימה – דחייה מקומית בטלפון בלבד, לא מגיעה לכאן.
// כתובת קבועה בתוך ההתראה שכבר נשלחה – לכן אזור אחד בלבד, us-central1 (כמו arFile). האסימון לא נכתב ליומן.
// ניקוי: secDaily מוחק מסמכי pact שפג תוקפם (cleanPact).
// push_dev/{sha256(מזהה FCM)} (בשורש, שרת בלבד – החוקים סוגרים כל אוסף שלא הוגדר) { biz, uid, t } – למי הטלפון רשום עכשיו, בכל העסקים.
//   נכתב בכל registerPushToken (עם act ובלי), נמחק ב-dropTokens כשהוא עדיין של אותו משתמש. מזהה ה-FCM עצמו לא נשמר שם – רק הגיבוב.
// מכשיר אחד (16.11.2026): אחרי push_dev – אם למשתמש יש רישום טלפון נוכחי (dev_cur/{uid}.phone, one-device.js), הטלפון הלוחץ חייב להיות fh שלו.
// סדר הבדיקות: גודל הגוף (content-length, לפני כל עיבוד) ← פורמט (parseBody) ← רק אז קריאה מהמסד.
// אישור קבלה בקבוצות (24.11.2026): kind 'grp', פעולה אחת 'rcv' – הטלפון שולח אותה לבד, ברקע, כשהגיעה התראה על הודעה בקבוצה (גם כשהאפליקציה סגורה).
//   האסימון: id = gid, mt = זמן ההודעה (t), gp = 'r' (grp בשורש, לארג' פעמי legacy) / 'b' (b/{biz}/grp), תוקף GRP_H שעות. נוצר ב-grp-notify.js (sendItem).
//   אותן בדיקות טלפון (push_dev, מכשיר אחד, tokensOf). אחר כך: עסק פעיל (+ תוספת groups ב-'b' / legacy ב-'r'), המשתמש מנהל או עובד פעיל וחבר בקבוצה,
//   ובטרנזקציה: grp/{gid}/r/{uid}.d = max(d, t, mt), u = max(u, עכשיו). לא מוריד שום ערך ולא נוגע ב-t / mu. מסמך חדש – d, u, n (n = מה שהאפליקציה כותבת: החלק שלפני @ במייל).
//   אין טריגר על r – הכתיבה לא שולחת התראות.

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
const ACTS = ['done', 'h1', 'd1', 'rcv'];
const KINDS = ['sec', 'tk', 'grp'];
const DAYS = 7;
const GRP_H = 48; // אישור קבלה: טלפון שלא היה מחובר יותר מזה – מדווח רק כשהאפליקציה נפתחת (כמו היום)
const BODY_MAX = 6000;
const H1 = 3600e3, D1 = 864e5; // "בעוד שעה" = עכשיו + שעה; "מחר" = בדיוק עכשיו + 24 שעות (החלטת בעל העסק)

const MSG = {
  done: '✓ טופל', d1: 'נדחה למחר', h1: 'נדחה לעוד שעה', wait: 'נשלח לאישור המנהל', closed: 'המשימה כבר סגורה',
  open: 'פתחו את האפליקציה כדי לסיים', notMine: 'המשימה כבר לא אצלך', used: 'הפעולה כבר בוצעה',
  stale: 'הכפתור כבר לא בתוקף. פתחו את האפליקציה', deny: 'אין הרשאה. פתחו את האפליקציה', late: 'כבר מאוחר מדי לדחות. פתחו את האפליקציה',
  bad: 'בקשה לא תקינה', err: 'משהו השתבש. נסו שוב או פתחו את האפליקציה',
};

const hashOf = (tok) => crypto.createHash('sha256').update(String(tok), 'utf8').digest('hex');
const DEV = 'push_dev';
const devPath = (fcm) => `${DEV}/${hashOf(fcm)}`; // השיוך הגלובלי של טלפון (בשורש, לא בתוך העסק)

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
  const grp = a.kind === 'grp';
  if (grp && (!Number.isInteger(a.mt) || a.mt < 0 || !['r', 'b'].includes(a.gp))) throw new Error('push-act: bad args');
  // 'rcv' רק באסימון של קבוצה, וקבוצה – רק 'rcv'
  const acts = grp ? ['rcv'] : [...new Set(Array.isArray(a.acts) ? a.acts : [])].filter((x) => ACTS.includes(x) && x !== 'rcv');
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = now + (grp ? GRP_H * 3600e3 : DAYS * D1);
  await getFirestore().doc(`${COLL}/${hashOf(token)}`).create(Object.assign({ biz: a.bizId, uid: a.uid, kind: a.kind, id: a.id, acts, exp, at: now }, grp ? { mt: a.mt, gp: a.gp } : {}));
  return { token, u: urlOf(a), exp };
}

// בדיקת הקלט (בלי מסד). מחזיר { t, a, f } או null
function parseBody(req) {
  if (tooBig(req)) return null;
  const ct = String((req.headers && req.headers['content-type']) || '');
  if (!/^application\/json\b/i.test(ct)) return null;
  if (req.rawBody && req.rawBody.length > BODY_MAX) return null;
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const t = typeof b.t === 'string' ? b.t : '', a = typeof b.a === 'string' ? b.a : '', f = typeof b.f === 'string' ? b.f.trim() : '';
  if (!TOKEN_RE.test(t) || !ACTS.includes(a) || !FCM_RE.test(f)) return null;
  return { t, a, f };
}

// גוף גדול מדי – לפי הכותרת content-length (נבדק לפני שקוראים את req.body) או לפי rawBody
function tooBig(req) {
  const cl = req.headers && req.headers['content-length'];
  if (cl !== undefined && !(Number(cl) >= 0 && Number(cl) <= BODY_MAX)) return true;
  return !!(req.rawBody && req.rawBody.length > BODY_MAX);
}

// "✓ בוצע" במשימה – אותם כללים כמו workerUpd בחוקים ו-ACT.tkDone באפליקציה. מחזיר { patch } או { r, msg, open? } (נדחה)
// t = נתוני המשימה, uid = המשתמש, mgr = מנהל (באפליקציה מנהל סוגר גם משימה עם הערת עובד), name = doneBy, now
const dlOf = (t) => (Number.isFinite(t.dl) ? t.dl : t.due); // כמו tkDlOf בחוקים: dl אם נשמר, אחרת due. 0/חסר = בלי יעד
// רשימת סימון עם פריטים שלא סומנו (כמו ckN ב-tasks-wc.js)
function ckOpen(t) { const n = Array.isArray(t.ck) ? t.ck.length : 0; if (!n) return false; const s = new Set((Array.isArray(t.ckd) ? t.ckd : []).filter((i) => Number.isInteger(i) && i >= 0 && i < n)); return s.size < n; }
function tkPlan(t, uid, mgr, name, now) {
  if (!t || t.st !== 'open') return { r: 'closed', msg: MSG.closed };
  const ow = typeof t.ow === 'string' ? t.ow : '';
  if (!ow) return { r: 'open-app', msg: MSG.open, open: true }; // משימה קבוצתית שעוד לא נתפסה – "אני מטפל" באפליקציה
  if (ow !== uid) return { r: 'not-owner', msg: MSG.notMine };
  if (t.pr === '1' || Number(t.np) > 0) return { r: 'open-app', msg: MSG.open, open: true }; // נדרשת תמונה – רק באפליקציה
  if (!name) return { r: 'open-app', msg: MSG.open, open: true };
  // החוקים (workerUpd): "לאישור" דורש open == '1', ו"בוצע" מחשב איחור לפי dl/due (tkLateOk). משימה בלי open='1' או בלי יעד מספרי
  // (dl/due חסר או לא מספר) הייתה נכשלת בחוקים באפליקציה – לכן נשלחת לאפליקציה ולא נסגרת מכאן. משימה רגילה: open '1' ו-due מספר
  if (t.open !== '1' || !Number.isFinite(dlOf(t))) return { r: 'open-app', msg: MSG.open, open: true };
  if (ckOpen(t)) return { r: 'open-app', msg: MSG.open, open: true }; // רשימת סימון שלא הושלמה – באפליקציה (שם מוצגת האזהרה ckWarn)
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
  if ((d.kind === 'grp') !== (b.a === 'rcv')) return R(false, 'bad-act', MSG.bad);
  if (!d.acts.includes(b.a)) return d.kind === 'tk' && b.a === 'done' ? R(false, 'open-app', MSG.open, { open: true }) : R(false, 'bad-act', MSG.bad);
  // הטלפון חייב להיות משויך עכשיו לאותו עסק ולאותו משתמש (push_dev) – לפני כל קריאה בתוך העסק
  const dev = await getFirestore().doc(devPath(b.f)).get();
  if (!dev.exists || dev.get('biz') !== d.biz || dev.get('uid') !== d.uid) return R(false, 'bad-device', MSG.deny, { open: true });
  // מכשיר אחד למשתמש (16.11.2026, one-device.js): יש רישום טלפון נוכחי (dev_cur/{uid}.phone) – רק הוא (fh) יכול ללחוץ
  if (!(await require('./one-device')._core.phoneOk(d.uid, b.f))) return R(false, 'bad-device', MSG.deny, { open: true });
  if (d.kind === 'grp') return grpAct(ref, d, b, now, opt);
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
    await ref.update({ used: FieldValue.delete(), ua: FieldValue.delete() }).catch((e2) => {
      // האסימון נשאר "משומש" – לחיצה חוזרת תקבל "כבר בוצעה". ביומן בלי האסימון
      logger.warn('pushAct: token release failed', { bizId: d.biz, kind: d.kind, name: e2 && e2.name, code: e2 && e2.code });
    });
    const why = e && e.details && e.details.reason;
    if (why === 'gone' || why === 'not-found') return R(true, 'closed', MSG.closed);
    if (why === 'too-late' || why === 'bad-at') return R(false, 'too-late', MSG.late, { open: true });
    throw e;
  }
}

// אישור קבלה בקבוצה (kind 'grp'). הטלפון לא מציג את התשובה – רק מפסיק לנסות
async function grpAct(ref, d, b, now, opt) {
  if (!['r', 'b'].includes(d.gp) || !Number.isInteger(d.mt) || d.mt < 0) return R(false, 'no-token', MSG.stale);
  const biz = await T.loadBiz(d.biz);
  if (!biz || biz.status !== 'active') return R(false, 'deny', MSG.deny);
  // כמו grp-notify: השורש רק ללארג' פעמי ב-legacy; עסק – רק עם התוספת groups
  if (d.gp === 'r' ? d.biz !== T.BIZ0 || biz.dataRoot !== 'legacy' : biz.features.groups !== true) return R(false, 'deny', MSG.deny);
  return T.runInBiz({ bizId: d.biz, prefix: d.gp === 'b' ? 'b/' + d.biz + '/' : '' }, async () => {
    const db = T.tdb();
    const [adm, st] = await Promise.all([db.doc('admins/' + d.uid).get(), db.doc('staff/' + d.uid).get()]);
    if (!adm.exists && !(st.exists && st.get('active') === true)) return R(false, 'deny', MSG.deny);
    if (!(await require('./secretary-remind')._core.tokensOf(db, d.uid)).includes(b.f)) return R(false, 'bad-device', MSG.deny);
    const gRef = db.doc('grp/' + d.id), rRef = db.doc('grp/' + d.id + '/r/' + d.uid);
    // מסמך קריאה שעוד לא קיים – גם n (כמו rdPut / rWr באפליקציה: השם מוצג ברשימת "התקבל אצל")
    let n = '';
    if (!(await rRef.get()).exists) { try { n = String(await (opt.nameOf || nameOf)(d.uid)).slice(0, 100); } catch (e) { n = ''; } }
    const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
    return db.runTransaction(async (tx) => {
      const [p, gs, rs] = await Promise.all([tx.get(ref), tx.get(gRef), tx.get(rRef)]);
      if (!live(p.exists ? p.data() : null, now)) return p.exists && p.get('used') ? R(false, 'used', MSG.used) : R(false, 'expired', MSG.stale);
      tx.update(ref, { used: now, ua: b.a });
      const mem = gs.exists && Array.isArray(gs.get('mem')) ? gs.get('mem') : [];
      if (!mem.includes(d.uid)) return R(false, 'not-member', MSG.deny); // כמו האפליקציה: רק חבר בקבוצה כותב מצב קריאה
      const x = rs.exists ? rs.data() || {} : null;
      const dd = Math.max(x ? num(x.d) : 0, x ? num(x.t) : 0, d.mt), u = Math.max(now, x ? num(x.u) : 0);
      if (!x) tx.set(rRef, Object.assign({ d: dd, u }, n ? { n } : {}));
      else if (dd > num(x.d) || !Number.isInteger(x.d)) tx.update(rRef, { d: dd, u });
      return R(true, 'rcv', '');
    });
  });
}

async function handle(req, res, o) {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json(R(false, 'method', MSG.bad));
  if (tooBig(req)) return res.status(413).json(R(false, 'too-big', MSG.bad));
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
Object.defineProperty(exports, '_core', { enumerable: false, value: { handle, act, mkAct, parseBody, tooBig, tkPlan, ckOpen, dlOf, grpAct, GRP_H, urlOf, hashOf, devPath, cleanPact, MSG, ACTS, COLL, DEV, DAYS, TOKEN_RE } });
