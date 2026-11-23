'use strict';
// משימות קבועות (12.11.2026): recurringTasks – פונקציה מתוזמנת, כל 5 דקות, שעון ישראל.
// לכל עסק שתוספת המשימות מופעלת אצלו (ולארג' פעמי במצב legacy – בשורש): עוברת על rtk (כללים פעילים, on == true),
// ולכל כלל שהגיע מועדו (lib/tk-time.js: decide) פותחת משימת מנהל ב-tasks של אותו עסק, עם מזהה קבוע r-<rid>-<YYYYMMDD>.
// בלי כפילויות: create נכשל אם המסמך כבר קיים (ריצה כפולה / שתי ריצות במקביל), והכלל מסמן last = התאריך של היום.
// נמענים: רק מי שב-staff/{uid} עם active == true (באותו עסק). אף אחד – לא נפתחת משימה, ונכתב err בכלל.
// השדות זהים למשימת מנהל חדשה מהאפליקציה (FRM.tkAdd), ובנוסף rc = מזהה הכלל. due = tkDue(now) – זהה לאפליקציה.
// אזור: us-central1 בלבד (מתוזמנת – אסור להריץ כפול; lib/region.js).
// 22.11.2026 – התראת טלפון לעובד על משימה שלו שבאיחור (lateAll): באותה פונקציה מתוזמנת (בלי פונקציית ענן חדשה), פעם ב-15 דקות
//   (כל ריצה שלישית – LATE_EVERY), אחרי פתיחת המשימות הקבועות. הכללים – lib/tk-late.js. הסימון "נשלח" – fn_rate/tkLate_<taskId>
//   בתוך העסק ({ t, u: [uid] }; fn_rate חסום מהאפליקציה בחוקים – הכלל האחרון). שדות המשימה לא משתנים.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { LEGACY_REGION } = require('./lib/region');
const T = require('./lib/tenant');
const TK = require('./lib/tk-time');
const LT = require('./lib/tk-late');

if (!getApps().length) initializeApp();

const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);

// בונה את מסמך המשימה מהכלל ומהנמענים הפעילים (to/toN מסוננים). now = זמן הריצה.
function taskDoc(rid, r, to, toN, now) {
  const one = to.length === 1;
  const np = Number.isInteger(r.np) && r.np >= 0 && r.np <= 3 ? r.np : 0;
  return {
    owner: str(r.owner, 128), by: str(r.by, 100), role: 'a', txt: str(r.txt, 500), cr: now, due: TK.tkDue(now),
    st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '',
    to, toN, ow: one ? to[0] : '', owN: one ? toN[0] : '', clt: one ? now : 0, np, wp: 0, mi: 0, rc: rid,
  };
}

// כלל אחד. מחזיר 'created' / 'exists' / 'no-recipients' / 'bad' / סיבת הדילוג מ-decide
async function runRule(db, prefix, snap, now) {
  const r = snap.data() || {};
  const d = TK.decide(r, now);
  if (!d.go) return d.why;
  const rid = snap.id;
  if (typeof r.txt !== 'string' || !r.txt.trim() || !Array.isArray(r.to) || !r.to.length) {
    await snap.ref.update({ last: d.day, err: 'bad-rule' });
    return 'bad';
  }
  const names = Array.isArray(r.toN) ? r.toN : [];
  const pairs = r.to.slice(0, 30).map((u, i) => [String(u || ''), str(names[i], 100)]).filter(([u]) => /^[A-Za-z0-9_-]{1,128}$/.test(u));
  const snaps = pairs.length ? await db.getAll(...pairs.map(([u]) => db.doc(prefix + 'staff/' + u))) : [];
  const live = pairs.filter((p, i) => snaps[i].exists && snaps[i].get('active') === true);
  if (!live.length) {
    await snap.ref.update({ last: d.day, err: 'no-recipients' });
    return 'no-recipients';
  }
  const tref = db.doc(prefix + 'tasks/r-' + rid + '-' + d.key);
  const b = db.batch();
  b.create(tref, taskDoc(rid, r, live.map((p) => p[0]), live.map((p) => p[1]), now));
  b.update(snap.ref, { last: d.day, n: FieldValue.increment(1), err: '' });
  try {
    await b.commit();
    return 'created';
  } catch (e) {
    if (e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)))) {
      await snap.ref.update({ last: d.day });
      return 'exists';
    }
    throw e;
  }
}

// כל העסקים. opts.now – לבדיקות. מחזיר { [bizId]: { created, skipped..., error } }
async function runAll(opts) {
  const now = (opts && opts.now) || Date.now();
  const db = getFirestore();
  const out = {};
  for (const biz of await T.bizzesWith('tasks')) {
    const res = (out[biz.bizId] = {});
    if (biz.status !== 'active' || !biz.features.tasks) { res.skipped = 'inactive'; continue; }
    try {
      const prefix = T.bizPrefix(biz);
      const rules = await db.collection(prefix + 'rtk').where('on', '==', true).get();
      for (const s of rules.docs) {
        try { const k = await runRule(db, prefix, s, now); res[k] = (res[k] || 0) + 1; } catch (e) {
          logger.error('recurringTasks: rule failed', { biz: biz.bizId, rule: s.id, name: e && e.name, code: e && e.code });
          res.error = (res.error || 0) + 1;
        }
      }
    } catch (e) {
      logger.error('recurringTasks: biz failed', { biz: biz.bizId, name: e && e.name, code: e && e.code });
      res.error = (res.error || 0) + 1;
    }
  }
  return out;
}

// ---------- התראה לעובד על משימה שבאיחור (22.11.2026) ----------
const LATE_EVERY = 3; // ריצה אחת מכל 3 (הפונקציה רצה כל 5 דקות) = פעם ב-15 דקות
const lateSlot = (now) => Math.floor(now / 300000) % LATE_EVERY === 0;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function fcmLate(tokens, msg, tag) {
  const { getMessaging } = require('firebase-admin/messaging');
  const RM = require('./secretary-remind')._core;
  const r = await getMessaging().sendEachForMulticast(RM.fcmPayload(tokens, msg, { data: { k: 'tk' }, tag }));
  return r.responses.map((x, i) => ({ token: tokens[i], ok: x.success, code: x.error && x.error.code }));
}
// getAll במנות (עד 100 מסמכים לקריאה)
async function getMany(db, paths) {
  const out = [];
  for (let i = 0; i < paths.length; i += 100) out.push(...(await db.getAll(...paths.slice(i, i + 100).map((p) => db.doc(p)))));
  return out;
}

// עסק אחד: משימות פתוחות ← מועמדות ← סימונים ← עובדים פעילים ← סימון ← שליחה. מחזיר { late, users, sent }
async function lateBiz(db, biz, sup, now, send) {
  const prefix = T.bizPrefix(biz);
  const snap = await db.collection(prefix + 'tasks').where('st', '==', 'open').get();
  const cand = snap.docs.map((d) => Object.assign({}, d.data() || {}, { id: d.id })).filter((t) => LT.lateDl(t, now));
  if (!cand.length) return { late: 0 };
  const ms = await getMany(db, cand.map((t) => prefix + 'fn_rate/' + LT.markId(t.id)));
  const marks = new Map(cand.map((t, i) => [t.id, new Set(ms[i].exists && Array.isArray(ms[i].get('u')) ? ms[i].get('u') : [])]));
  const uids = [...new Set(cand.flatMap((t) => LT.recips(t)))].filter((u) => !sup.has(u));
  const ss = await getMany(db, uids.map((u) => prefix + 'staff/' + u));
  const live = new Set(uids.filter((u, i) => ss[i].exists && ss[i].get('active') === true));
  const P = LT.pick(cand, marks, now, (u) => live.has(u));
  if (!P.users.length) return { late: cand.length, users: 0, sent: 0 };
  // סימון לפני השליחה: "פעם אחת" גובר על "בטוח הגיע" (כשל שליחה לא ישלח שוב). arrayUnion – בטוח גם בריצה כפולה
  for (let i = 0; i < P.marks.length; i += 400) {
    const b = db.batch();
    for (const m of P.marks.slice(i, i + 400)) b.set(db.doc(prefix + 'fn_rate/' + LT.markId(m.id)), { t: now, u: FieldValue.arrayUnion(...m.u) }, { merge: true });
    await b.commit();
  }
  const RM = require('./secretary-remind')._core;
  let sent = 0;
  await T.runInBiz({ bizId: biz.bizId, prefix }, async () => {
    const tdb = T.tdb();
    for (const { uid, tasks } of P.users) {
      try {
        const toks = await RM.tokensOf(tdb, uid);
        if (!toks.length) continue;
        if (!send) { sent++; continue; } // אמולטור בלי שליחה מדומה – רק ספירה
        const res = await send(toks, Object.assign({ id: tasks[0].id }, LT.msgOf(tasks)), 'tkl_' + tasks[0].id);
        if (res.some((r) => r.ok)) sent++;
        await RM.dropTokens(tdb, uid, res.filter((r) => !r.ok && RM.BAD_TOKEN.includes(r.code)).map((r) => r.token));
      } catch (e) {
        logger.warn('recurringTasks: late push failed', { biz: biz.bizId, name: e && e.name, code: e && e.code });
      }
    }
  });
  return { late: cand.length, users: P.users.length, sent };
}

// כל העסקים עם תוספת tasks (ולארג' פעמי במצב legacy – בשורש). opts.now / opts.send – לבדיקות. מחזיר { quiet } או { [bizId]: {...} }
async function lateAll(opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  if (LT.quiet(now)) return { quiet: true };
  const db = getFirestore();
  const send = o.send || (process.env.FUNCTIONS_EMULATOR === 'true' ? null : fcmLate);
  const sa = await db.collection('superadmins').get();
  const sup = new Set(sa.docs.map((d) => d.id).filter((u) => ID_RE.test(u))); // מנהל־על לא מקבל התראה כעובד (כמו tasks-push.js)
  const out = {};
  for (const biz of await T.bizzesWith('tasks')) {
    if (biz.status !== 'active' || !biz.features.tasks) { out[biz.bizId] = { skipped: 'inactive' }; continue; }
    try { out[biz.bizId] = await lateBiz(db, biz, sup, now, send); } catch (e) {
      logger.error('recurringTasks: late biz failed', { biz: biz.bizId, name: e && e.name, code: e && e.code });
      out[biz.bizId] = { error: 1 };
    }
  }
  return out;
}

exports.recurringTasks = onSchedule({ region: LEGACY_REGION, schedule: 'every 5 minutes', timeZone: TK.TZ, timeoutSeconds: 120, memory: '256MiB' }, async () => {
  const out = await runAll();
  if (Object.values(out).some((r) => r.created || r.error)) logger.info('recurringTasks', out);
  // 22.11.2026: התראות איחור לעובדים – פעם ב-15 דקות. כשל כאן לא משפיע על פתיחת המשימות הקבועות
  const now = Date.now();
  if (!lateSlot(now)) return;
  try {
    const lt = await lateAll({ now });
    if (Object.values(lt).some((r) => r && (r.sent || r.error))) logger.info('recurringTasks: late', lt);
  } catch (e) { logger.error('recurringTasks: late failed', { name: e && e.name, code: e && e.code }); }
});

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_core', { enumerable: false, value: { runAll, runRule, taskDoc, lateAll, lateBiz, lateSlot, LATE_EVERY } });
