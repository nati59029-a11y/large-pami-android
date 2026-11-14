'use strict';
// סריקת חנות בתלת מימד – שלב 5 (14.11.2026): סבבים בשרת. הלוגיקה הטהורה ב-lib/store3d-core.js (בדיקות יחידה).
//   s3Rounds (מתוזמנת, כל 5 דקות, שעון ישראל, us-central1 בלבד) – לכל עסק ש-store3d מופעל אצלו (ולארג' פעמי במצב legacy – בשורש):
//     1. כללי סבב (sround): כלל פעיל – כשהגיע המועד נפתח סבב (srun) עם מזהה קבוע <rid>_<YYYYMMDD>, ב-create בתוך טרנזקציה:
//        ריצה כפולה או שתי ריצות במקביל לא יוצרות כפילות, וכשהסבב הקודם של הכלל עוד פתוח/באיחור – המועד מדולג (תיקון סבב 1).
//        עובד מושבת/שעזב → בסבב שנפתח החלק שלו אצל המחליף הקבוע (התראה left); אחרת err בכלל והתראה למנהל.
//        השרת לא משנה את asg של הכלל (החלטת המתאם). uids (מי קורא את הכלל) מתעדכן בכל כלל – גם כבוי; בכלל שבסל – ריק.
//        כל כתיבה לכלל – רק אם לא נערך מאז הקריאה (lastUpdateTime / טרנזקציה).
//     2. סבבים פתוחים: תזכורת לעובד (24 שעות לפני המועד), ובמועד – st = 'late', התראה לעובד שלא סיים ולמנהל.
//   s3Run (מנהל)  – פתיחה ידנית { rid } (מזהה <rid>_m<זמן>) או ביטול { runId, cancel: true }.
//   s3Move        – העברת החלק של עובד בסבב { runId, from, to } (מנהל), או לקיחה { runId, from, take: true } (עובד, רק כש-sub == 'any').
//   s3Log         – אירועי זמן של עובד { qid, run, ev: s/p/r/e, at } – נרשם רק ביומן של המתקשר; qid מונע כפילות (תור בלי רשת).
//   s3View        – הדרך היחידה של עובד לקרוא סבבים ותוצאות (חוזה 4.21): בלי runId – הסבבים הפתוחים שלו, משימות התיקון שלו
//                   ומה אפשר לקחת; עם runId – רק החלק שלו, הזמנים שלו, ותוצאות לפי s3set.show.
// כולן: requireStaff עם feature 'store3d' (כבויה = אין גישה), שגיאות בעברית, T.tdb() (שורש או b/{bizId}).
// התראות: יומן s3ntf (create – התראה לא נשלחת פעמיים) + FCM לטוקנים הקיימים (staff/push_tokens). באמולטור – בלי FCM.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, LEGACY_REGION } = require('./lib/region');
const { requireStaff, inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const C = require('./lib/store3d-core');

if (!getApps().length) initializeApp();

const QID_DAYS = 30;
const bad = (reason, msg, code) => new HttpsError(code || 'invalid-argument', msg, { reason });
const isExists = (e) => e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)));
const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
const ERR_TXT = {
  'no-map': 'אין מפה שמורה לסניף הזה (או שאין בה מדפים). שמרו מפה ונסו שוב.',
  'map-deleted': 'המפה של הסבב נמחקה. שחזרו אותה מסל המחזור או בחרו מפה אחרת.',
};
const CORE_TXT = {
  'bad-ev': ['invalid-argument', 'סוג האירוע לא תקין'],
  'bad-time': ['invalid-argument', 'השעה שנשלחה מהטלפון לא תקינה. בדקו את השעון בטלפון.'],
  full: ['resource-exhausted', 'יותר מדי אירועי זמן בסבב הזה'],
  'not-in-run': ['failed-precondition', 'העובד לא משויך לסבב הזה'],
  same: ['invalid-argument', 'אי אפשר להעביר לאותו עובד'],
  'too-many': ['failed-precondition', 'בסבב יכולים להשתתף עד 10 עובדים'],
};
function coreErr(e) {
  const t = e && CORE_TXT[e.code];
  return t ? new HttpsError(t[0], t[1], { reason: e.code }) : e;
}

// ---------------- התראות ----------------
const PUSH = {
  new: { title: 'סבב סריקה חדש', body: 'נפתח סבב סריקת מדפים. פתחו את האפליקציה כדי להתחיל.' },
  remind: { title: 'תזכורת: סבב סריקה', body: 'הסבב שלך עוד לא הסתיים, והמועד מתקרב.' },
  late: { title: 'סבב סריקה באיחור', body: 'עבר המועד של סבב הסריקה, והוא עוד לא הסתיים.' },
  done: { title: 'סבב סריקה הסתיים', body: 'סבב סריקת המדפים הסתיים. אפשר לראות את התוצאות באפליקציה.' },
  move: { title: 'סבב סריקה הועבר', body: 'חלק מסבב סריקה הועבר. פתחו את האפליקציה כדי לראות.' },
  left: { title: 'סבב הועבר למחליף', body: 'עובד שהושבת – החלק שלו בסבבים עובר למחליף הקבוע.' },
  err: { title: 'בעיה בסבב סריקה', body: 'יש בעיה בכלל סבב (עובד לא פעיל או מפה חסרה). פתחו את הגדרות הסבבים.' },
  w80: { title: 'מכסת סריקת החנות: 80%', body: 'הסניף ניצל 80% ממכסת התמונות החודשית. אפשר לבקש ממנהל המערכת להגדיל אותה.' }, // שלב 8 (store3d-ai.js)
  fix: { title: 'משימת תיקון במדף', body: 'יש לך משימת תיקון. פתחו את האפליקציה כדי לראות מה לתקן ולצלם אימות.' }, // שלב 10 (store3d-extra.js)
};
const BAD_TOKEN = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];
async function fcmSend(tokens, msg) {
  const { getMessaging } = require('firebase-admin/messaging');
  const r = await getMessaging().sendEachForMulticast({ tokens, notification: { title: msg.title, body: msg.body }, data: { k: 's3', v: msg.kind }, android: { priority: 'high' } });
  return r.responses.map((x, i) => ({ token: tokens[i], ok: x.success, code: x.error && x.error.code }));
}
async function pushTo(db, uids, msg, send) {
  for (const uid of uids) {
    try {
      const [s, p] = await Promise.all([db.doc('staff/' + uid).get(), db.doc('push_tokens/' + uid).get()]);
      const arr = (d) => (d.exists && Array.isArray(d.get('pushTokens')) ? d.get('pushTokens').filter((t) => typeof t === 'string') : []);
      const tokens = [...new Set(arr(s).concat(arr(p)))];
      if (!tokens.length) continue;
      const res = await send(tokens, msg);
      const dead = res.filter((x) => !x.ok && BAD_TOKEN.includes(x.code)).map((x) => x.token);
      if (dead.length) for (const d of [s, p]) if (d.exists) await d.ref.update({ pushTokens: FieldValue.arrayRemove(...dead) });
    } catch (e) {
      logger.warn('store3d: push failed', { code: e && e.code });
    }
  }
}
// מתעד ב-s3ntf/{key} (create) ושולח. כבר קיים = כבר נשלח → לא שולחים שוב. send: לבדיקות; באמולטור בלי send – בלי FCM.
async function notify(ctx, key, kind, to, now) {
  const list = [...new Set(to.filter((u) => typeof u === 'string' && C.RE.uid.test(u)))].slice(0, 20);
  if (!list.length) return false;
  const ref = ctx.db.doc('s3ntf/' + key);
  if ((await ref.get()).exists) return false;
  try { await ref.create({ at: now, kind, to: list }); } catch (e) { if (isExists(e)) return false; throw e; }
  const send = ctx.send || (process.env.FUNCTIONS_EMULATOR === 'true' ? null : fcmSend);
  if (send) await pushTo(ctx.db, list, Object.assign({ kind }, PUSH[kind]), send);
  return true;
}

// ---------------- עזר: מנהלים, עובדים פעילים, הגדרות סניף ----------------
async function managers(ctx) {
  if (!ctx.mgrs) ctx.mgrs = (await ctx.db.collection('admins').get()).docs.map((d) => d.id).filter((u) => C.RE.uid.test(u));
  return ctx.mgrs;
}
// פעיל = staff/{uid}.active == true, או מנהל (admins/{uid}) – אותה הגדרה כמו requireStaff
async function activeOf(db, uids) {
  const list = [...new Set(uids.filter((u) => typeof u === 'string' && C.RE.uid.test(u)))];
  if (!list.length) return new Set();
  const snaps = await db.getAll(...list.map((u) => db.doc('staff/' + u)), ...list.map((u) => db.doc('admins/' + u)));
  const out = new Set();
  list.forEach((u, i) => { if ((snaps[i].exists && snaps[i].get('active') === true) || snaps[list.length + i].exists) out.add(u); });
  return out;
}
async function setOf(ctx, br) {
  if (!(br in ctx.sets)) { const s = await ctx.db.doc('s3set/' + br).get(); ctx.sets[br] = s.exists ? s.data() : {}; }
  return ctx.sets[br];
}

// הכנת כלל לפני פתיחה. תיקון סבב 1 (החלטת המתאם): השרת לא משנה את sround.asg – ההחלפה במחליף (dep.asg) חלה רק על הסבב שנפתח.
// uids של הכלל נגזר מה-asg של המנהל + המחליף (חוזה 4.7).
async function prepRule(ctx, r) {
  const cfg = C.settingsFor(r, await setOf(ctx, r.br));
  const act = await activeOf(ctx.db, C.cleanAsg(r.asg).map((a) => a.u).concat(cfg.subU ? [cfg.subU] : []));
  const dep = C.planDeparted(r.asg, (u) => act.has(u), cfg.sub, cfg.subU);
  return { cfg, dep, asg: dep.asg || r.asg, uids: C.uidsOf(r.asg, cfg.subU), active: act };
}
// כתיבה לכלל רק אם לא השתנה מאז הקריאה (המנהל ערך בינתיים – מדלגים, והריצה הבאה מחשבת מחדש)
async function updIf(snap, upd) {
  try { await snap.ref.update(upd, { lastUpdateTime: snap.updateTime }); return true; } catch (e) { if (e && e.code === 9) return false; throw e; }
}

// פתיחת סבב בטרנזקציה. מחזיר { runId, doc } / { exists: true } / { changed: true } / { err } /
//   { open: runId } (ידני: כבר יש סבב פתוח לכלל) / { skip: runId } (מתוזמן: הסבב הקודם עוד פתוח – המועד הזה מדולג).
// next: בסבב מתוזמן – המועד שעליו הוחלט; אם בינתיים הכלל נפתח (ריצה מקבילה) – לא פותחים.
// ut: updateTime של הכלל כפי שנקרא (p חושב ממנו); המנהל ערך בינתיים – { changed } ומנסים בריצה הבאה.
async function openRun(ctx, ruleRef, rid, p, runId, k, next, ut) {
  const db = ctx.db, now = ctx.now;
  const runRef = db.doc('srun/' + runId);
  return db.runTransaction(async (tx) => {
    const [rs, ex] = await Promise.all([tx.get(ruleRef), tx.get(runRef)]);
    if (ex.exists) return { exists: true };
    if (!rs.exists || rs.get('del') === 1) return { err: 'gone' };
    if (ut && !rs.updateTime.isEqual(ut)) return { changed: true };
    const r = rs.data();
    if (k === 'sched' && C.nextOpen(r) !== next) return { exists: true };
    if (!C.RE.br.test(r.br || '') || !C.RE.map.test(r.map || '')) return { err: 'no-map' };
    const reads = [tx.get(db.doc('smap/' + r.map))];
    if (C.isRunId(r.lastRun)) reads.push(tx.get(db.doc('srun/' + r.lastRun)));
    const [ms, prev] = await Promise.all(reads);
    if (prev && prev.exists && C.LIVE.includes(prev.get('st'))) {
      if (k === 'manual') return { open: r.lastRun };
      // תיקון סבב 1: לא פותחים סבב שני לאותו כלל. המועד מדולג (last = המועד), והבא – לפי התדירות
      tx.update(ruleRef, { last: next, next: C.nextOpen(Object.assign({}, r, { last: next })) || FieldValue.delete() });
      return { skip: r.lastRun };
    }
    const map = ms.exists ? ms.data() : null;
    const mp = C.mapProblem(map, r.br);
    if (mp) return { err: mp };
    const split = C.splitBays(C.baysOf(map), p.asg);
    if (!split.n) return { err: 'no-map' };
    const subFrom = {};
    for (const u of p.dep.moved) if (split.asg[p.cfg.subU]) subFrom[u] = p.cfg.subU;
    const doc = C.runDoc({ rid, br: r.br, mapId: r.map, mapV: map.v, k, split, now, due: p.cfg.due, subFrom });
    tx.create(runRef, doc);
    const upd = { last: now, lastRun: runId, uids: p.uids, err: p.dep.err };
    const nx = C.nextOpen(Object.assign({}, r, { last: now }));
    upd.next = nx || FieldValue.delete(); // ידני – בלי מועד (השדה נמחק, לא 0)
    tx.update(ruleRef, upd);
    return { runId, doc };
  });
}

// התראות אחרי הכנת כלל ופתיחה
async function afterOpen(ctx, rid, p, opened) {
  const mg = await managers(ctx);
  // left – רק כשבאמת נפתח סבב שבו המחליף נכנס (לא במועד שדולג / לא נפתח) – תיקון סבב 2
  if (opened && opened.runId) for (const u of p.dep.moved) await notify(ctx, u + '_' + rid + '_left', 'left', mg.concat([p.cfg.subU]), ctx.now);
  for (const u of p.dep.stuck) await notify(ctx, u + '_' + rid + '_err', 'err', mg, ctx.now);
  if (opened && opened.runId) await notify(ctx, opened.runId + '_new', 'new', opened.doc.uids.filter((u) => p.active.has(u)), ctx.now);
}

// ---------------- המתוזמנת ----------------
// כלל אחד. מחזיר 'opened' / 'exists' / 'early' / 'off' / 'manual' / 'err' / 'bad'
async function ruleStep(ctx, snap) {
  const r = snap.data() || {};
  // תיקון סבב 1: uids מתעדכן גם בכלל כבוי, ובכלל שבסל המחזור מתרוקן (אף עובד לא קורא אותו)
  if (r.del === 1) { if (Array.isArray(r.uids) && r.uids.length) await updIf(snap, { uids: [] }); return 'off'; }
  if (!C.RE.br.test(r.br || '')) return 'bad';
  if (r.on !== true) {
    const u = C.uidsOf(r.asg, C.settingsFor(r, await setOf(ctx, r.br)).subU);
    if (!sameArr(u, r.uids)) await updIf(snap, { uids: u });
    return 'off';
  }
  const p = await prepRule(ctx, r);
  const d = C.decideOpen(snap.id, r, ctx.now);
  let res = null, mapErr = '';
  if (d.go) {
    res = await openRun(ctx, snap.ref, snap.id, p, d.runId, 'sched', d.next, snap.updateTime);
    if (res.changed) return 'changed';
    if (res.err && res.err !== 'gone') mapErr = res.err;
  }
  if (!res || (!res.runId && !res.exists && !res.skip)) {
    // לא נפתח סבב (וגם ריצה מקבילה לא פתחה אותו עכשיו): רק מה שהשתנה (אין כתיבה בכל 5 דקות), ורק אם הכלל לא נערך בינתיים
    const upd = {};
    if (!sameArr(p.uids, r.uids)) upd.uids = p.uids;
    const err = p.dep.err || mapErr;
    if ((r.err || '') !== err) upd.err = err;
    if (d.next !== (r.next || 0)) upd.next = d.next || FieldValue.delete();
    if (Object.keys(upd).length && !(await updIf(snap, upd))) return 'changed';
    if (mapErr) await notify(ctx, d.runId + '_err', 'err', await managers(ctx), ctx.now);
  }
  await afterOpen(ctx, snap.id, p, res);
  if (res && res.runId) return 'opened';
  if (res && res.skip) return 'skipped';
  if (res && res.exists) return 'exists';
  if (mapErr || p.dep.err) return 'err';
  return d.why;
}

// סבב פתוח: תזכורת / איחור. סבב שהסתיים בינתיים (s3Log) – לא נוגעים (lastUpdateTime)
async function runStep(ctx, snap) {
  const run = snap.data() || {};
  const t = C.timeStep(run, ctx.now);
  if (!t.kind) return '';
  const workers = C.behind(run);
  if (t.st === 'late') {
    try { await snap.ref.update({ st: 'late' }, { lastUpdateTime: snap.updateTime }); } catch (e) { if (e && e.code === 9) return ''; throw e; }
    await notify(ctx, snap.id + '_late', 'late', workers.concat(await managers(ctx)), ctx.now);
    return 'late';
  }
  if (workers.length && await notify(ctx, snap.id + '_remind', 'remind', workers, ctx.now)) return 'remind';
  return '';
}

// עסק אחד (בתוך T.runInBiz). opts: { now, send }
async function runBiz(opts) {
  const o = opts || {};
  const ctx = { db: T.tdb(), now: o.now || Date.now(), send: o.send, mgrs: null, sets: {} };
  const out = {};
  const inc = (k) => { if (k) out[k] = (out[k] || 0) + 1; };
  const rules = await ctx.db.collection('sround').get(); // כל הכללים – גם כבויים ומחוקים (uids)
  for (const s of rules.docs) {
    try { inc(await ruleStep(ctx, s)); } catch (e) { logger.error('s3Rounds: rule failed', { rule: s.id, name: e && e.name, code: e && e.code }); inc('error'); }
  }
  const runs = await ctx.db.collection('srun').where('st', 'in', C.LIVE).limit(1000).get();
  for (const s of runs.docs) {
    try { inc(await runStep(ctx, s)); } catch (e) { logger.error('s3Rounds: run failed', { run: s.id, name: e && e.name, code: e && e.code }); inc('error'); }
  }
  // שלב 10: ערעורים שהמנהל קיבל – ציון מחדש, הערה קבועה, משימת התיקון (store3d-extra.js)
  try { const n = await require('./store3d-extra')._x.appealsBiz(ctx); if (n) out.appeals = n; } catch (e) { logger.error('s3Rounds: appeals failed', { code: e && e.code }); inc('error'); }
  return out;
}

// כל העסקים שהתוספת פעילה אצלם בפועל (bizzesWith מוסיף את לארג' פעמי בלי מסמך – שם store3d כבוי, ולכן מסונן). opts.now / opts.send – לבדיקות
async function runAll(opts) {
  const o = opts || {};
  const list = (await T.bizzesWith('store3d')).filter((b) => b.status === 'active' && b.features && b.features.store3d === true);
  const res = {};
  for (const biz of list) {
    try { res[biz.bizId] = await T.runInBiz({ bizId: biz.bizId, prefix: T.bizPrefix(biz), biz }, () => runBiz(o)); } catch (e) {
      logger.error('s3Rounds: biz failed', { biz: biz.bizId, name: e && e.name, code: e && e.code });
      res[biz.bizId] = { error: 1 };
    }
  }
  return res;
}

exports.s3Rounds = onSchedule({ region: LEGACY_REGION, schedule: 'every 5 minutes', timeZone: C.TZ, timeoutSeconds: 240, memory: '256MiB' }, async () => {
  const out = await runAll();
  if (Object.values(out).some((r) => r.opened || r.late || r.error || r.err)) logger.info('s3Rounds', out);
});

// ---------------- s3Run: פתיחה ידנית / ביטול (מנהל) ----------------
exports.s3Run = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (who.role !== 'manager') throw bad('manager-only', 'רק מנהל יכול לפתוח או לבטל סבב', 'permission-denied');
  const input = inputObject(request);
  const db = T.tdb(), now = Date.now();
  if (input.cancel === true) {
    if (!C.isRunId(input.runId)) throw bad('bad-run', 'מזהה הסבב לא תקין');
    const ref = db.doc('srun/' + input.runId);
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw bad('no-run', 'הסבב לא נמצא', 'not-found');
      if (!C.LIVE.includes(s.get('st'))) throw bad('run-closed', 'הסבב כבר הסתיים או בוטל', 'failed-precondition');
      tx.update(ref, { st: 'cancel', doneAt: now });
      return { ok: true, st: 'cancel' };
    });
  }
  if (typeof input.rid !== 'string' || !C.RE.rid.test(input.rid)) throw bad('bad-rule', 'מזהה כלל הסבב לא תקין');
  const ref = db.doc('sround/' + input.rid);
  const rs = await ref.get();
  if (!rs.exists || rs.get('del') === 1) throw bad('no-rule', 'כלל הסבב לא נמצא', 'not-found');
  const r = rs.data();
  if (!C.RE.br.test(r.br || '')) throw bad('no-map', ERR_TXT['no-map'], 'failed-precondition');
  const ctx = { db, now, mgrs: null, sets: {} };
  const p = await prepRule(ctx, r);
  const res = await openRun(ctx, ref, input.rid, p, input.rid + '_m' + now, 'manual', 0, rs.updateTime);
  if (res.changed) throw bad('busy', 'הכלל השתנה בדיוק עכשיו. נסו שוב.', 'aborted');
  if (res.open) throw bad('run-open', 'יש כבר סבב פתוח לכלל הזה. סיימו או בטלו אותו קודם.', 'failed-precondition');
  if (res.exists) throw bad('busy', 'נסו שוב בעוד רגע', 'aborted');
  if (res.err) {
    if (res.err === 'gone') throw bad('no-rule', 'כלל הסבב לא נמצא', 'not-found');
    if ((r.err || '') !== res.err) await ref.update({ err: res.err });
    throw bad(res.err, ERR_TXT[res.err], 'failed-precondition');
  }
  await afterOpen(ctx, input.rid, p, res);
  return { ok: true, runId: res.runId, n: res.doc.n, uids: res.doc.uids, err: p.dep.err };
}));

// ---------------- s3Move: העברה (מנהל) / לקיחה (עובד, sub == 'any') ----------------
exports.s3Move = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  const input = inputObject(request);
  const take = input.take === true;
  if (!C.isRunId(input.runId)) throw bad('bad-run', 'מזהה הסבב לא תקין');
  // לקיחה: from = uid, או fromH = המזהה העקיף מרשימת take של s3View (בלי לחשוף uid של עובד אחר)
  const byH = take && input.from === undefined && typeof input.fromH === 'string' && /^[0-9a-f]{16}$/.test(input.fromH);
  if (!byH && (typeof input.from !== 'string' || !C.RE.uid.test(input.from))) throw bad('bad-user', 'העובד לא תקין');
  const to = take ? who.uid : input.to;
  if (!take && who.role !== 'manager') throw bad('manager-only', 'רק מנהל יכול להעביר סבב לעובד אחר', 'permission-denied');
  if (typeof to !== 'string' || !C.RE.uid.test(to)) throw bad('bad-user', 'העובד לא תקין');
  const db = T.tdb(), now = Date.now();
  if (!(await activeOf(db, [to])).has(to)) throw bad('staff-disabled', 'העובד שנבחר לא פעיל', 'failed-precondition');
  const ref = db.doc('srun/' + input.runId);
  let from = input.from;
  const res = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw bad('no-run', 'הסבב לא נמצא', 'not-found');
    const run = s.data();
    if (!C.LIVE.includes(run.st)) throw bad('run-closed', 'הסבב כבר הסתיים או בוטל', 'failed-precondition');
    if (byH) {
      from = (Array.isArray(run.uids) ? run.uids : []).find((u) => C.partKey(input.runId, u) === input.fromH);
      if (!from) throw bad('not-in-run', CORE_TXT['not-in-run'][1], 'failed-precondition');
    }
    if (take) {
      // תיקון סבב 2: אותו תנאי כמו ברשימת take של s3View – עובד עם שיוך לסניפים לוקח רק מסבב של סניף שלו
      const myBr = myBranches(who);
      if (myBr && !myBr.includes(run.br)) throw bad('other-branch', 'הסבב שייך לסניף אחר', 'permission-denied');
      const [rule, set] = await Promise.all([
        C.RE.rid.test(run.rid || '') ? tx.get(db.doc('sround/' + run.rid)) : null,
        C.RE.br.test(run.br || '') ? tx.get(db.doc('s3set/' + run.br)) : null,
      ]);
      const cfg = C.settingsFor(rule && rule.exists ? rule.data() : {}, set && set.exists ? set.data() : {});
      if (cfg.sub !== 'any') throw bad('no-take', 'בסבב הזה רק המנהל מעביר עבודה בין עובדים', 'permission-denied');
    }
    let patch;
    try { patch = C.moveRun(run, from, to); } catch (e) { throw coreErr(e); }
    tx.update(ref, patch);
    // תיקון סבב 2: רק מנהל מקבל את uids (מזהי עובדים); עובד שלוקח – רק ok
    return who.role === 'manager' ? { ok: true, uids: patch.uids } : { ok: true };
  });
  const ctx = { db, now, mgrs: null, sets: {} };
  // שלב 12: גם העובד שהחלק שלו הועבר או נלקח מקבל התראה (אם עדיין פעיל), כדי שלא ימשיך לצלם חלק שכבר לא שלו
  const fromOn = from !== to && (await activeOf(db, [from])).has(from);
  await notify(ctx, input.runId + '_move_' + from, 'move', [to].concat(fromOn ? [from] : [], await managers(ctx)), now);
  return res;
}));

// ---------------- s3Log: אירועי זמן של עובד ----------------
exports.s3Log = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  const input = inputObject(request);
  if (typeof input.qid !== 'string' || !C.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  if (!C.isRunId(input.run)) throw bad('bad-run', 'מזהה הסבב לא תקין');
  if (!C.EVS.includes(input.ev)) throw bad('bad-ev', CORE_TXT['bad-ev'][1]);
  if (!Number.isInteger(input.at)) throw bad('bad-time', CORE_TXT['bad-time'][1]);
  const db = T.tdb(), now = Date.now(), uid = who.uid;
  const qref = db.doc('s3qid/' + input.qid), ref = db.doc('srun/' + input.run);
  const res = await db.runTransaction(async (tx) => {
    const [q, s] = await Promise.all([tx.get(qref), tx.get(ref)]);
    if (q.exists) {
      if (q.get('k') !== 'event' || q.get('uid') !== uid || q.get('run') !== input.run) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
      return Object.assign({}, q.get('res'), { dup: true });
    }
    if (!s.exists) throw bad('no-run', 'הסבב לא נמצא', 'not-found');
    const run = s.data();
    if (!Array.isArray(run.uids) || !run.uids.includes(uid)) throw bad('not-assigned', 'אינך משויך לסבב הזה', 'permission-denied');
    if (!C.LIVE.includes(run.st)) throw bad('run-closed', 'הסבב כבר הסתיים או בוטל', 'failed-precondition');
    let l;
    try { l = C.addEvent(run.tlog && run.tlog[uid], input.ev, input.at, run.openAt, now); } catch (e) { throw coreErr(e); }
    const wp = C.workPause(l);
    const patch = {
      tlog: Object.assign({}, run.tlog, { [uid]: l }),
      work: Object.assign({}, run.work, { [uid]: wp.work }),
      pause: Object.assign({}, run.pause, { [uid]: wp.pause }),
    };
    let st = run.st;
    if (C.finished(Object.assign({}, run, patch))) { st = C.closeSt(run, now); patch.st = st; patch.doneAt = now; }
    tx.update(ref, patch);
    const out = { ok: true, st, work: wp.work, pause: wp.pause };
    tx.create(qref, { k: 'event', run: input.run, uid, res: out, at: now, exp: now + QID_DAYS * C.D1 });
    return out;
  });
  if (!res.dup && (res.st === 'done' || res.st === 'closed')) {
    const ctx = { db, now, mgrs: null, sets: {} };
    await require('./store3d-extra')._x.finishSafe(db, input.run, now, {}); // שלב 10: סיכום, ציון, חוסרים, משימות תיקון
    await notify(ctx, input.run + '_done', 'done', await managers(ctx), now);
  }
  return res;
}));

// ---------------- s3View: מה עובד רואה ----------------
exports.s3View = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  const input = inputObject(request);
  const db = T.tdb(), uid = who.uid, mgr = who.role === 'manager';
  if (input.runId === undefined || input.runId === null || input.runId === '') {
    if (mgr) {
      const s = await db.collection('srun').where('st', 'in', C.LIVE).limit(200).get();
      return { runs: s.docs.map((d) => Object.assign({ runId: d.id }, d.data())) };
    }
    const [mine, fixes, live] = await Promise.all([
      db.collection('srun').where('uids', 'array-contains', uid).where('st', 'in', C.LIVE).orderBy('dueAt').limit(50).get(),
      // שלב 10: גם 'rej' (צילום האימות הראה שהבעיה עדיין קיימת) – העובד צריך לתקן ולצלם שוב
      db.collection('s3fix').where('u', '==', uid).where('st', 'in', ['open', 'sent', 'rej']).orderBy('dueAt').limit(100).get(),
      db.collection('srun').where('st', 'in', C.LIVE).limit(200).get(),
    ]);
    // מה אפשר לקחת: סבבים שאני לא בהם, שהכלל שלהם (או ההגדרות של הסניף) מתיר "כל עובד יכול לקחת"
    const take = [];
    const ctx = { db, sets: {} }, rules = {};
    const myBr = myBranches(who);
    for (const d of live.docs) {
      const r = d.data();
      if (Array.isArray(r.uids) && r.uids.includes(uid)) continue;
      if (!C.RE.br.test(r.br || '')) continue;
      if (myBr && !myBr.includes(r.br)) continue; // רק סבבים של הסניפים שלו (בלי שיוך לסניפים – כל הסניפים של העסק)
      if (C.RE.rid.test(r.rid || '') && !(r.rid in rules)) { const x = await db.doc('sround/' + r.rid).get(); rules[r.rid] = x.exists ? x.data() : {}; }
      const cfg = C.settingsFor(rules[r.rid] || {}, await setOf(ctx, r.br));
      if (cfg.sub !== 'any') continue;
      // תיקון סבב 1: בלי מזהי משתמש של עובדים אחרים – לכל חלק מזהה עקיף (h), מספר מדפים והתקדמות
      take.push({ runId: d.id, st: r.st, br: r.br, map: r.map, dueAt: r.dueAt, parts: C.takeParts(d.id, r) });
    }
    return {
      runs: mine.docs.map((d) => C.listItem(d.id, d.data(), uid)),
      fixes: fixes.docs.map((d) => Object.assign({ id: d.id }, pickFix(d.data()))),
      take,
    };
  }
  if (!C.isRunId(input.runId)) throw bad('bad-run', 'מזהה הסבב לא תקין');
  const s = await db.doc('srun/' + input.runId).get();
  if (!s.exists) throw bad('no-run', 'הסבב לא נמצא', 'not-found');
  const run = s.data();
  if (mgr) return { run: Object.assign({ runId: s.id }, run) };
  if (!Array.isArray(run.uids) || !run.uids.includes(uid)) throw bad('not-assigned', 'אינך משויך לסבב הזה', 'permission-denied');
  const [set, ai] = await Promise.all([
    C.RE.br.test(run.br || '') ? db.doc('s3set/' + run.br).get() : null,
    db.collection('srun/' + input.runId + '/ai').get(),
  ]);
  const show = set && set.exists ? set.get('show') : null;
  return { run: C.viewRun(s.id, run, uid, show, ai.docs.map((d) => [d.id, d.data()])) };
}));
// הסניפים של עובד (staff.br). בלי שיוך / מנהל – null = כל הסניפים של העסק
function myBranches(who) {
  if (!who || who.role === 'manager') return null;
  const brs = who.staff && who.staff.exists ? who.staff.get('br') : null;
  return Array.isArray(brs) ? brs.filter((b) => typeof b === 'string') : null;
}
function pickFix(f) {
  const o = {};
  for (const k of ['run', 'slot', 'map', 'br', 'iks', 'man', 'st', 'at', 'dueAt']) if (f[k] !== undefined) o[k] = f[k];
  return o;
}

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_core', { enumerable: false, value: { runAll, runBiz, ruleStep, runStep, openRun, prepRule, notify, activeOf } });
