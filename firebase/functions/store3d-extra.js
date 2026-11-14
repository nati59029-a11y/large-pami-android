'use strict';
// סריקת חנות בתלת מימד – שלב 10 (14.11.2026): השרת הנלווה. הלוגיקה הטהורה ב-lib/store3d-extra.js (בדיקות יחידה).
//   סיום סבב (finishRun – נקרא מ-shelfCheck ומ-s3Log כשסבב מסתיים, ורשת ביטחון ב-s3Clean):
//     srun.sum – ציון 0–100 לפי משקלות s3set.w (ברירת מחדל 35/30/20/15), "לבדיקה" ואזהרות לא מורידים ציון, השוואה לסבב הקודם;
//     s3sum.score; s3short/{runId} – רשימת חוסרים (create בלבד); s3fix/<runId>__<slot> – משימת תיקון אוטומטית לכל מקום עם בעיה
//     קשה (create בלבד – משימה שבוטלה לא נפתחת שוב), והתראה אחת לכל עובד (s3ntf <runId>_fix_<uid>).
//   ערעור (appealsBiz – בכל ריצה של s3Rounds, כל 5 דקות): הכרעת מנהל 'acc' → ai.ovr[ik], ai.sc מחדש, הערה קבועה ל-bay.notes
//     כש-note == true (src:'appeal'), סיכום הסבב ו-s3sum מחדש, משימת התיקון מתעדכנת/מבוטלת. אידמפוטנטי (ovr כבר קיים = כבר טופל).
//     ערעור פתוח לא משנה כלום (גם של עובד על מקום שלא שלו – המנהל מכריע).
//   s3Fix (מנהל): { qid, map, slot, u, man, dueDays? } – משימת תיקון ידנית m_<qid> + התראה fix לעובד;
//     { fixTaskId, cancel: true } – ביטול; { fixTaskId, decide: 'ok' | 'rej' } – הכרעה במשימה שממתינה (st 'sent').
//   s3Clean (מתוזמנת, כל יום 03:45 שעון ישראל, us-central1 בלבד) – לכל עסק ש-store3d פעיל אצלו:
//     1. סבבים שהסתיימו ב-3 הימים האחרונים בלי sum – finishRun.  2. ביצועי עובדים (s3perf) לחודש הנוכחי (ובשלושת הימים הראשונים
//     של חודש – גם לקודם), מחושבים מחדש מהנתונים; עובד שעזב נשאר.  3. סל המחזור – מחיקה סופית **רק** של מה שסומן del:1 לפני
//     30 יום ומעלה: רכיבים במפה (עם גרסה קודמת ב-ver ו-v+1, כמו כל שמירה) וכללי סבב.  4. תמונות: 3 סבבים אחרונים לכל מקום צילום;
//     ישנים יותר – ph.gone=true והקבצים נמחקים (התוצאות בטקסט נשארות תמיד); קבצים תועים שלא שייכים ל-ph.  5. טקסטורות שאינן במפה
//     ובאף גרסה, בנות 30 יום ומעלה.  6. טיוטות (s3draft) בנות 30 יום ומעלה, s3qid שפג תוקפו (exp).
//     כל מחיקה שהצליחה נרשמת ביומן השרת (logger) וב-b/{bizId}/audit (act 's3Clean'; רשימה ארוכה – כמה רשומות). מפה שלמה שנמחקה
//     (smap.del) – לא נמחקת סופית. תיקון סבב 1: 3 סבבים אחרונים לכל מפה + מקום (חנות ומחסן בנפרד), ודיווחים יזומים בשמירה נפרדת.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, FieldPath } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onCall, LEGACY_REGION } = require('./lib/region');
const { requireStaff, inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const C = require('./lib/store3d-core');
const X = require('./lib/store3d-extra');
const M = require('./lib/store3d-map');
const A = require('./lib/store3d-ai');

if (!getApps().length) initializeApp();

const D1 = X.D1, DONE = ['done', 'closed'];
const bad = (reason, msg, code) => new HttpsError(code || 'invalid-argument', msg, { reason });
const isExists = (e) => e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)));
const core = () => require('./store3d')._core;            // notify, activeOf
const mapLib = () => require('./store3d-map')._map;       // branchOk
async function managers(db) { return (await db.collection('admins').get()).docs.map((d) => d.id).filter((u) => C.RE.uid.test(u)); }
const setOf = async (db, br) => { if (!C.RE.br.test(br || '')) return {}; const s = await db.doc('s3set/' + br).get(); return s.exists ? s.data() : {}; };
const dueOf = (S) => (Number.isInteger(S.due) && S.due >= 1 && S.due <= 14 ? S.due : 2);

// ---------------- סיום סבב ----------------
// o = { send }. מחזיר { sum, short, fixes } או null (הסבב לא קיים / לא הסתיים). אפשר לקרוא שוב – אין כפילויות.
async function finishRun(db, runId, now, o) {
  const ref = db.doc('srun/' + runId);
  const rs = await ref.get();
  if (!rs.exists) return null;
  const run = rs.data();
  if (!DONE.includes(run.st)) return null;
  const [aiS, S] = await Promise.all([db.collection(`srun/${runId}/ai`).get(), setOf(db, run.br)]);
  const entries = aiS.docs.filter((d) => C.RE.slot.test(d.id)).map((d) => [d.id, d.data()]);
  let prev = null;
  if (run.k !== 'adhoc' && C.RE.map.test(run.map || '')) {
    // שאילתה על שדה אחד (בלי אינדקס מורכב); הסינון והמיון בקוד
    const L = await db.collection('srun').where('map', '==', run.map).select('st', 'k', 'doneAt', 'sum').get();
    prev = X.prevRun(L.docs.map((d) => [d.id, d.data()]), runId, run.openAt);
  }
  const sum = X.runSum(entries, run, S.w, prev);
  await ref.update({ sum });
  if (run.k !== 'adhoc' && C.RE.map.test(run.map || '')) {
    const sref = db.doc('s3sum/' + run.map);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(sref);
      const cur = s.exists ? s.get('run') : null;
      if (!cur || cur === runId) tx.set(sref, { score: sum.score, upd: now }, { merge: true });
    });
  }
  // רשימת חוסרים: נוצרת בסיום; כל עוד המנהל לא החליט (st 'draft') – מתעדכנת (למשל אחרי ערעור שביטל בעיית low/hole). תיקון סבב 1
  const items = X.shortList(entries);
  const shref = db.doc('s3short/' + runId);
  await db.runTransaction(async (tx) => {
    const sh = await tx.get(shref);
    if (!sh.exists) { if (items.length) tx.create(shref, { items, st: 'draft' }); return; }
    if (sh.get('st') === 'draft' && JSON.stringify(sh.get('items') || []) !== JSON.stringify(items)) tx.update(shref, { items });
  });
  const tasks = X.fixTasks(entries, run, runId, now, dueOf(S));
  const made = [];
  for (const t of tasks) {
    try { await db.doc('s3fix/' + t.id).create(t.doc); made.push(t); } catch (e) { if (!isExists(e)) throw e; }
  }
  const to = [...new Set(made.map((t) => t.doc.u))];
  for (const u of to) await core().notify({ db, send: o && o.send }, `${runId}_fix_${u}`, 'fix', [u], now);
  return { sum, short: items.length, fixes: made.length };
}
// עטיפה למקומות שבהם סיום הסבב כבר נשמר (shelfCheck / s3Log): כשל כאן לא מחזיר שגיאה ללקוח – רשת הביטחון ב-s3Clean תשלים
async function finishSafe(db, runId, now, o) {
  try { return await finishRun(db, runId, now, o); } catch (e) { logger.error('store3d: finishRun failed', { run: runId, code: e && e.code }); return null; }
}

// ---------------- ערעורים ----------------
const RE_IK = /^([0-9]{1,2}|all)$/;
async function applyAppeal(ctx, aid, a) {
  const db = ctx.db;
  if (!C.isRunId(a.run) || !C.RE.slot.test(a.slot || '') || !RE_IK.test(a.ik || '') || aid !== `${a.run}__${a.slot}__${a.ik}`) return false;
  const aiRef = db.doc(`srun/${a.run}/ai/${a.slot}`), runRef = db.doc('srun/' + a.run);
  const bay = X.bayOf(a.slot);
  const res = await db.runTransaction(async (tx) => {
    const [ai, rs] = await Promise.all([tx.get(aiRef), tx.get(runRef)]);
    if (!ai.exists || !rs.exists) return 'skip';
    const d = ai.data(), run = rs.data();
    const iss = Array.isArray(d.iss) ? d.iss : [];
    if (a.ik !== 'all' && +a.ik >= iss.length) return 'skip';
    const ovr = Object.assign({}, d.ovr);
    // ovr כבר נכתב (ריצה קודמת שנכשלה אחרי הטרנזקציה): לא כותבים שוב, וממשיכים להשלמה (afterAppeal) – תיקון סבב 1
    if (ovr[a.ik] === 'acc') return 'ok';
    if (!(a.ik in ovr) && Object.keys(ovr).length >= 31) return 'skip';
    const reads = [C.RE.br.test(run.br || '') ? tx.get(db.doc('s3set/' + run.br)) : null];
    const noteOn = a.note === true && C.RE.map.test(run.map || '');
    if (noteOn) reads.push(tx.get(db.doc(`smap/${run.map}/bay/${bay}`)));
    const [set, bd] = await Promise.all(reads);
    ovr[a.ik] = 'acc';
    const patch = { ovr };
    const sc = X.scoreSlot(Object.assign({}, d, { ovr }), set && set.exists ? set.get('w') : null);
    if (sc) patch.sc = sc;
    tx.update(aiRef, patch);
    if (noteOn) {
      const t = X.str(a.dec, 200) || X.str(a.txt, 200);
      const notes = bd && bd.exists && Array.isArray(bd.get('notes')) ? bd.get('notes') : [];
      const dup = notes.some((n) => n && n.src === 'appeal' && n.at === a.decAt && n.by === a.decBy);
      if (t && !dup && notes.length < 20 && Number.isInteger(a.decAt) && C.RE.uid.test(a.decBy || '')) {
        const nn = notes.concat([{ t, at: a.decAt, by: a.decBy, src: 'appeal' }]);
        if (bd.exists) tx.update(bd.ref, { notes: nn }); else tx.set(bd.ref, { notes: nn, upd: a.decAt, by: a.decBy });
      } else if (t && !dup && notes.length >= 20) logger.warn('store3d: appeal note skipped – 20 notes', { bay });
    }
    return 'ok';
  });
  // השלמה (סיכום, s3sum, חוסרים, משימת התיקון). כשל = שגיאה, והערעור לא מסומן כמטופל – הריצה הבאה תשלים
  if (res === 'ok') await afterAppeal(ctx, a, bay);
  // סימון "טופל" (sv) – רק אחרי שהכל הושלם (או שהערעור לא רלוונטי: אין תוצאה / אינדקס לא קיים)
  await db.doc('s3appeal/' + aid).update({ sv: ctx.now });
  return res === 'ok';
}
// אחרי ערעור שהתקבל: סיכום הסבב, s3sum של המקטע (אם הוא עדיין מהסבב הזה), ומשימת התיקון של המקום
// כל השלבים בטוחים להרצה חוזרת. שגיאה נזרקת הלאה (תיקון סבב 1) – לא נבלעת.
async function afterAppeal(ctx, a, bay) {
  const db = ctx.db, now = ctx.now;
  if (ctx.inject) await ctx.inject('afterAppeal', a); // לבדיקות בלבד: הדמיית כשל באמצע
  {
    const run = (await db.doc('srun/' + a.run).get()).data() || {};
    if (DONE.includes(run.st)) await finishRun(db, a.run, now, ctx);
    if (C.RE.map.test(run.map || '')) {
      const sref = db.doc('s3sum/' + run.map);
      const slots = ['a', 't', 'b'].map((l) => `${bay}_${l}`);
      await db.runTransaction(async (tx) => {
        const [s, ...ais] = await Promise.all([tx.get(sref)].concat(slots.map((x) => tx.get(db.doc(`srun/${a.run}/ai/${x}`)))));
        const e0 = s.exists && s.get('b') ? s.get('b')[bay] : null;
        if (!e0 || e0.r !== a.run) return;
        const list = ais.filter((x) => x.exists).map((x) => X.effAi(x.data()));
        const e = A.sumEntry(list.concat(list.length < 2 ? [null] : []), a.run, Number.isInteger(e0.t) ? e0.t : now, e0.th, null);
        tx.update(sref, new FieldPath('b', bay), e, 'upd', now);
      });
    }
    const fref = db.doc('s3fix/' + X.fixId(a.run, a.slot));
    await db.runTransaction(async (tx) => {
      const [f, ai] = await Promise.all([tx.get(fref), tx.get(db.doc(`srun/${a.run}/ai/${a.slot}`))]);
      if (!f.exists || !['open', 'sent', 'rej'].includes(f.get('st')) || !ai.exists) return;
      const hard = new Set(X.hardIdx(ai.data()));
      const left = (f.get('iks') || []).filter((i) => hard.has(i));
      if (!left.length) tx.update(fref, { st: 'cancel', cBy: a.decBy, cAt: Number.isInteger(a.decAt) ? a.decAt : now });
      else if (left.length !== (f.get('iks') || []).length) tx.update(fref, { iks: left });
    });
  }
}
// ctx = { db, now, send }. ערעורים שהוכרעו ב-7 הימים האחרונים (שאילתה על שדה אחד); מה שכבר סומן כמטופל (sv) – מדולג
async function appealsBiz(ctx) {
  const s = await ctx.db.collection('s3appeal').where('decAt', '>=', ctx.now - 7 * D1).limit(500).get();
  let n = 0;
  for (const d of s.docs) {
    const a = d.data();
    if (a.st !== 'acc' || Number.isInteger(a.sv)) continue;
    try { if (await applyAppeal(ctx, d.id, a)) n++; } catch (e) { logger.error('store3d: appeal failed – will retry', { aid: d.id, code: e && e.code, msg: e && e.message }); }
  }
  return n;
}

// ---------------- s3Fix (מנהל) ----------------
async function fixCore(db, who, input, now, deps) {
  const send = deps && deps.send;
  if (input.cancel === true || input.decide !== undefined) {
    if (typeof input.fixTaskId !== 'string' || !X.RE_FIX.test(input.fixTaskId)) throw bad('bad-fix', 'מזהה משימת התיקון לא תקין');
    const dec = input.decide;
    if (input.cancel !== true && dec !== 'ok' && dec !== 'rej') throw bad('bad-decide', 'ההכרעה צריכה להיות "תוקן" או "לא תוקן"');
    const ref = db.doc('s3fix/' + input.fixTaskId);
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw bad('no-fix', 'משימת התיקון לא נמצאה', 'not-found');
      const st = s.get('st');
      if (input.cancel === true) {
        if (!['open', 'sent', 'rej'].includes(st)) throw bad('fix-closed', 'המשימה כבר נסגרה', 'failed-precondition');
        tx.update(ref, { st: 'cancel', cBy: who.uid, cAt: now });
        return { ok: true, fixTaskId: input.fixTaskId, st: 'cancel' };
      }
      if (st !== 'sent') throw bad('fix-not-sent', 'אפשר להכריע רק במשימה שצולם לה אימות וממתינה לבדיקה', 'failed-precondition');
      tx.update(ref, { st: dec, doneAt: now });
      return { ok: true, fixTaskId: input.fixTaskId, st: dec };
    });
  }
  if (typeof input.qid !== 'string' || !C.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  if (typeof input.map !== 'string' || !C.RE.map.test(input.map)) throw bad('bad-map-id', 'מזהה המפה לא תקין');
  if (typeof input.slot !== 'string' || !A.RE_SLOT.test(input.slot)) throw bad('bad-slot', 'מקום הצילום לא תקין');
  if (typeof input.u !== 'string' || !C.RE.uid.test(input.u)) throw bad('bad-user', 'העובד לא תקין');
  const man = X.str(input.man, 201);
  if (!man || man.length > 200) throw bad('bad-man', 'תיאור המשימה חובה, עד 200 תווים');
  const dd = input.dueDays === undefined || input.dueDays === null ? null : input.dueDays;
  if (dd !== null && !(Number.isInteger(dd) && dd >= 1 && dd <= 14)) throw bad('bad-due', 'מספר הימים לביצוע: 1 עד 14');
  const mapId = input.map, br = mapId.slice(2), kind = mapId.charAt(0);
  const ms = await db.doc('smap/' + mapId).get();
  if (!ms.exists || ms.get('del') === 1) throw bad('no-map', 'המפה לא נמצאה (או שנמחקה)', 'failed-precondition');
  try { A.checkSlot(input.slot, ms.data()); } catch (e) { throw bad('bad-slot', e.message); }
  await mapLib().branchOk(db, who.bizId, br, kind);
  if (!(await core().activeOf(db, [input.u])).has(input.u)) throw bad('staff-disabled', 'העובד שנבחר לא פעיל', 'failed-precondition');
  // תיקון סבב 1: עובד ששויך לסניפים (staff.br) ואינו משויך לסניף של המפה – המשימה הולכת למנהל שפתח אותה
  const st0 = await db.doc('staff/' + input.u).get();
  const brs = st0.exists && Array.isArray(st0.get('br')) ? st0.get('br') : null;
  const u = brs && !brs.includes(br) ? who.uid : input.u;
  const days = dd || dueOf(await setOf(db, br));
  const id = 'm_' + input.qid, ref = db.doc('s3fix/' + id);
  const res = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) {
      const f = s.data();
      if (f.u !== u || f.slot !== input.slot || f.map !== mapId) throw bad('bad-qid', 'מזהה השליחה כבר שימש למשימה אחרת');
      return { ok: true, fixTaskId: id, st: f.st, dueAt: f.dueAt, u, toMgr: u !== input.u, dup: true };
    }
    const doc = { slot: input.slot, map: mapId, br, iks: [], man, by: who.uid, u, st: 'open', at: now, dueAt: now + days * D1 };
    tx.create(ref, doc);
    return { ok: true, fixTaskId: id, st: 'open', dueAt: doc.dueAt, u, toMgr: u !== input.u };
  });
  if (!res.dup) await core().notify({ db, send }, id + '_fix', 'fix', [u], now);
  return res;
}
exports.s3Fix = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (who.role !== 'manager') throw bad('manager-only', 'רק מנהל יכול לפתוח או לבטל משימת תיקון', 'permission-denied');
  return fixCore(T.tdb(), { uid: who.uid, bizId: who.bizId }, inputObject(request), Date.now(), {});
}));

// ---------------- s3Clean: ניקוי ותחזוקה יומיים ----------------
const tms = (f) => { const t = Date.parse(f && f.metadata && f.metadata.timeCreated); return Number.isFinite(t) ? t : NaN; };
async function listFiles(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix });
  return files.map((f) => ({ name: f.name, t: tms(f) }));
}
async function delFile(bucket, name) {
  try { await bucket.file(name).delete(); return true; } catch (e) { if (e && (e.code === 404 || e.code === '404')) return true; logger.warn('s3Clean: file delete failed', { code: e && e.code }); return false; }
}

// 1. רשת ביטחון: סבבים שהסתיימו לאחרונה בלי סיכום
async function stepFinish(c) {
  const s = await c.db.collection('srun').where('doneAt', '>=', c.now - 3 * D1).get();
  let n = 0;
  for (const d of s.docs) if (DONE.includes(d.get('st')) && !d.get('sum')) { if (await finishRun(c.db, d.id, c.now, c)) n++; }
  return n;
}
// 2. ביצועי עובדים
async function perfMonth(db, range, now) {
  const [runs, fixes, apps] = await Promise.all([
    db.collection('srun').where('doneAt', '>=', range.start).where('doneAt', '<', range.end).get(),
    db.collection('s3fix').where('doneAt', '>=', range.start).where('doneAt', '<', range.end).get(),
    db.collection('s3appeal').where('at', '>=', range.start).where('at', '<', range.end).get(),
  ]);
  const R = [];
  for (const d of runs.docs) {
    if (!DONE.includes(d.get('st'))) continue;
    const ph = await db.collection(`srun/${d.id}/ph`).select('by', 'rt', 'person').get();
    R.push({ id: d.id, d: d.data(), ph: ph.docs.map((x) => x.data()) });
  }
  const out = X.perfAll(range, R, fixes.docs.map((d) => d.data()), apps.docs.map((d) => d.data()));
  for (const u of Object.keys(out)) await db.doc(`s3perf/${u}/m/${range.key}`).set(Object.assign(out[u], { upd: now }));
  return Object.keys(out).length;
}
async function stepPerf(c) {
  const cur = X.monthRange(c.now);
  let n = await perfMonth(c.db, cur, c.now);
  if (c.now - cur.start < 3 * D1) n += await perfMonth(c.db, X.monthRange(cur.start - 1), c.now);
  return n;
}
// 3. סל המחזור: רכיבים במפה וכללי סבב שסומנו כמחוקים לפני 30 יום ומעלה. log = [שורות ליומן]
async function stepBin(c, maps, log) {
  let n = 0;
  for (const m of maps) {
    if (!X.binPurge(m.data(), c.now).n) continue;
    const ref = m.ref;
    const r = await c.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const old = s.exists ? s.data() : null;
      const p = X.binPurge(old, c.now);
      if (!p.n || !Number.isInteger(old.v) || old.v >= 1000000) return null;
      // כמו כל שמירה: הגרסה הקודמת נשמרת ב-ver, והמפה מקבלת v+1 (טלפון שעורך עכשיו יקבל "המפה השתנתה – טענו מחדש")
      tx.set(c.db.doc(`smap/${m.id}/ver/${M.verId(old.v)}`), M.verDoc(old, { uid: 'system', now: c.now }, 'ניקוי סל המחזור (30 יום)'));
      tx.set(ref, Object.assign(p.map, { v: old.v + 1, upd: c.now }));
      return p;
    });
    if (!r) continue;
    n += r.n;
    log.push(`smap/${m.id}: ` + Object.entries(r.purged).map(([k, v]) => `${k} ${v.join(',')}`).join('; '));
    try {
      const vs = await c.db.collection(`smap/${m.id}/ver`).select().get();
      const del = M.prune(vs.docs.map((d) => d.id), M.KEEP_VERS);
      if (del.length) {
        const b = c.db.batch(); for (const id of del) b.delete(c.db.doc(`smap/${m.id}/ver/${id}`)); await b.commit();
        log.push(`smap/${m.id}/ver: ${del.join(',')} (מעבר ל-${M.KEEP_VERS} גרסאות)`); // תיקון סבב 1: גם מחיקת גרסאות נרשמת
      }
    } catch (e) { logger.warn('s3Clean: prune failed', { code: e && e.code }); }
  }
  const rules = await c.db.collection('sround').where('del', '==', 1).get();
  for (const s of rules.docs) {
    if (!X.expired(s.data(), c.now)) continue;
    try { await s.ref.delete({ lastUpdateTime: s.updateTime }); n++; log.push('sround/' + s.id); } catch (e) { if (!(e && e.code === 9)) throw e; }
  }
  return n;
}
// 4. תמונות סבבים: 3 סבבים אחרונים לכל מקום צילום; קבצים תועים
async function stepPhotos(c, brs, log) {
  let n = 0;
  const runCache = {};
  const runOf = async (id) => { if (!(id in runCache)) { const s = await c.db.doc('srun/' + id).get(); runCache[id] = s.exists ? s.data() : null; } return runCache[id]; };
  const thumbsGone = new Map(); // mapId → Set(נתיבי מוקטנות שנמחקו)
  for (const br of brs) {
    const files = await listFiles(c.bucket, `b/${c.bizId}/store3d/${br}/run/`);
    // תיקון סבב 1: המפה של כל סבב (חנות ומחסן משתפים את תיקיית run/ של הסניף). סבב בלי מסמך – הקבצים שלו לא נמחקים
    const runMap = {};
    for (const id of new Set(files.map((f) => (X.parseRunFile(f.name) || {}).runId).filter((x) => C.isRunId(x)))) {
      const r = await runOf(id);
      if (r && C.RE.map.test(r.map || '') && r.br === br) runMap[id] = r.map;
    }
    const plan = X.keepPlan(files, c.now, X.KEEP_RUNS, runMap);
    const dropped = new Set();
    for (const d of plan.drop) {
      if (!C.isRunId(d.runId)) continue;
      const pref = c.db.doc(`srun/${d.runId}/ph/${d.slot}`);
      const ph = await pref.get();
      const names = new Set(d.names);
      if (ph.exists && (names.has(ph.get('p')) || names.has(ph.get('th')))) {
        // קודם המסמך (gone, בלי נתיב), ואחר כך הקבצים – אף פעם לא נשאר נתיב לקובץ שנמחק
        try { await pref.update({ gone: true, p: FieldValue.delete(), th: FieldValue.delete() }, { lastUpdateTime: ph.updateTime }); } catch (e) { if (e && e.code === 9) continue; throw e; }
      }
      let k = 0;
      for (const f of d.names) if (await delFile(c.bucket, f)) { n++; k++; dropped.add(f); }
      const run = await runOf(d.runId);
      if (run && C.RE.map.test(run.map || '')) { if (!thumbsGone.has(run.map)) thumbsGone.set(run.map, new Set()); for (const f of d.names) if (dropped.has(f)) thumbsGone.get(run.map).add(f); }
      // תיקון סבב 1: שורת יומן רק על מה שנמחק בפועל
      if (k) log.push(`run ${d.runId} ${d.slot}: ${k} קבצים (ישן מ-3 הסבבים האחרונים)` + (k < d.names.length ? ` – ${d.names.length - k} נכשלו` : ''));
    }
    // קבצים תועים בסבבים שנשמרו: יותר מזוג אחד (תמונה + מוקטנת) לאותו מקום באותו סבב, או קובץ בודד
    const groups = new Map();
    for (const f of files) {
      if (dropped.has(f.name)) continue;
      const p = X.parseRunFile(f.name);
      if (!p) continue;
      const k = p.runId + '|' + p.slot;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    for (const [k, L] of groups) {
      if (L.length === 2 && new Set(L.map((f) => X.parseRunFile(f.name).n)).size === 1) continue;
      const [runId, slot] = k.split('|');
      if (!C.isRunId(runId)) continue;
      const ph = await c.db.doc(`srun/${runId}/ph/${slot}`).get();
      for (const f of X.strayFiles(L, ph.exists ? ph.data() : null, c.now)) if (await delFile(c.bucket, f)) { n++; log.push(`run ${runId} ${slot}: קובץ תועה`); }
    }
  }
  // s3sum לא מצביע על מוקטנת שנמחקה
  for (const [mapId, gone] of thumbsGone) {
    const sref = c.db.doc('s3sum/' + mapId);
    await c.db.runTransaction(async (tx) => {
      const s = await tx.get(sref);
      const b = s.exists && s.get('b') ? s.get('b') : {};
      const args = [];
      for (const bay of Object.keys(b)) if (b[bay] && gone.has(b[bay].th)) args.push(new FieldPath('b', bay, 'th'), FieldValue.delete());
      if (args.length) tx.update(sref, ...args);
    });
  }
  return n;
}
// 5. טקסטורות יתומות: לא במפה (כולל סל המחזור) ולא באף גרסה שמורה, ונוצרו לפני 30 יום ומעלה
async function stepTex(c, brs, log) {
  let n = 0;
  for (const br of brs) {
    const files = await listFiles(c.bucket, `b/${c.bizId}/store3d/${br}/tex/`);
    const byMap = new Map();
    for (const f of files) { const m = /\/tex\/([sw]-[a-z0-9_]{2,20})\//.exec(f.name); if (m) { if (!byMap.has(m[1])) byMap.set(m[1], []); byMap.get(m[1]).push(f); } }
    for (const [mapId, L] of byMap) {
      if (!L.some((f) => Number.isFinite(f.t) && f.t <= c.now - X.TEX_DAYS * D1)) continue;
      const [ms, vs] = await Promise.all([c.db.doc('smap/' + mapId).get(), c.db.collection(`smap/${mapId}/ver`).select('m.tx', 'at').get()]);
      const refs = new Set(X.txPaths(ms.exists ? ms.data() : null));
      // תיקון סבב 1: "30 יום" מהרגע שהטקסטורה הפסיקה להיות בשימוש = זמן הגרסה האחרונה שבה הופיעה (ver.at – מתי הגרסה הוחלפה)
      const lastUse = new Map();
      for (const v of vs.docs) {
        const at = Number.isInteger(v.get('at')) ? v.get('at') : c.now; // בלי זמן – כאילו בשימוש עכשיו (לא נמחק)
        for (const p of X.txPaths(v.get('m'))) lastUse.set(p, Math.max(lastUse.get(p) || 0, at));
      }
      for (const f of X.texOrphans(L, refs, lastUse, c.now)) if (await delFile(c.bucket, f)) { n++; log.push('tex ' + f.split('/tex/')[1]); }
    }
  }
  return n;
}
// 6. טיוטות ישנות ו-s3qid שפג תוקפו (זמניים לפי החוזה)
async function stepTemp(c, log) {
  let n = 0;
  const dr = await c.db.collection('s3draft').where('at', '<=', c.now - 30 * D1).limit(200).get();
  let k = 0;
  for (const d of dr.docs) { try { await d.ref.delete(); k++; } catch (e) { logger.warn('s3Clean: draft delete failed', { code: e && e.code }); } }
  n += k;
  if (k) log.push(`s3draft: ${k}`);
  const q = await c.db.collection('s3qid').where('exp', '<=', c.now).limit(500).get();
  if (q.size) { const b = c.db.batch(); q.docs.forEach((d) => b.delete(d.ref)); await b.commit(); n += q.size; log.push(`s3qid: ${q.size}`); }
  return n;
}

// עסק אחד (בתוך T.runInBiz). o = { bizId, now, bucket, send }
async function cleanBiz(o) {
  const c = { db: T.tdb(), bizId: o.bizId, now: o.now || Date.now(), bucket: o.bucket || getStorage().bucket(), send: o.send };
  const out = {}, log = [];
  const step = async (k, fn) => { try { out[k] = await fn(); } catch (e) { out[k] = -1; logger.error('s3Clean: step failed', { biz: c.bizId, step: k, code: e && e.code, msg: e && e.message }); } };
  await step('finish', () => stepFinish(c));
  await step('perf', () => stepPerf(c));
  let maps = [];
  await step('maps', async () => { maps = (await c.db.collection('smap').get()).docs; return maps.length; });
  const brs = [...new Set(maps.map((m) => m.get('br')).filter((b) => C.RE.br.test(b || '')))];
  await step('bin', () => stepBin(c, maps, log));
  await step('photos', () => stepPhotos(c, brs, log));
  await step('tex', () => stepTex(c, brs, log));
  await step('temp', () => stepTemp(c, log));
  if (log.length) {
    logger.info('s3Clean: deleted', { biz: c.bizId, log });
    // תיקון סבב 1: בלי חיתוך – רשימה ארוכה מתפצלת לכמה רשומות (כל אחת עד 1500 תווים, part = מספר הרשומה)
    const parts = X.splitNote(log, 1500);
    try {
      const b = getFirestore().batch();
      parts.forEach((note, i) => b.set(getFirestore().collection(`b/${c.bizId}/audit`).doc(), { by: 'system', t: c.now, act: 's3Clean', note, part: i + 1, parts: parts.length }));
      await b.commit();
    } catch (e) { logger.error('s3Clean: audit failed', { biz: c.bizId, code: e && e.code }); }
  }
  return out;
}
async function cleanAll(opts) {
  const o = opts || {};
  const list = (await T.bizzesWith('store3d')).filter((b) => b.status === 'active' && b.features && b.features.store3d === true);
  const res = {};
  for (const biz of list) {
    try { res[biz.bizId] = await T.runInBiz({ bizId: biz.bizId, prefix: T.bizPrefix(biz), biz }, () => cleanBiz(Object.assign({}, o, { bizId: biz.bizId }))); } catch (e) {
      logger.error('s3Clean: biz failed', { biz: biz.bizId, code: e && e.code });
      res[biz.bizId] = { error: 1 };
    }
  }
  return res;
}
exports.s3Clean = onSchedule({ region: LEGACY_REGION, schedule: 'every day 03:45', timeZone: C.TZ, timeoutSeconds: 540, memory: '512MiB' }, async () => {
  logger.info('s3Clean', await cleanAll());
});

// לבדיקות ולשימוש פנימי (לא נספר כפונקציה)
Object.defineProperty(exports, '_x', { enumerable: false, value: { finishRun, finishSafe, appealsBiz, applyAppeal, fixCore, cleanBiz, cleanAll } });
