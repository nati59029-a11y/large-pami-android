'use strict';
// משמרות (שלב 3, 18.11.2026). כל הנתונים בתוך העסק (T.tdb(): בשורש בלארג' פעמי legacy, אחרת b/{bizId}/), והשרת בלבד קורא וכותב –
// אין כללי Firestore לאוספים האלה, והחסימה הכללית בסוף firestore.rules חוסמת גישה ישירה מהאפליקציה.
//   shf/{id}      – הגדרת משמרת (lib/shifts-core.js). shft/{id} – משימה למשמרת: { occ, sid, day, u, txt, st, tk, by, bn, at, relAt, why }.
//                   st: wait (ממתינה) / rel (נשלחה – tasks/sh-<id>) / cx (בוטלה כשהמשמרת נמחקה) / orph (לא נשלחה: המופע לא קיים / אין עובד –
//                   מוצגת למנהל בטבלה, לא נעלמת בשקט).
//   shfcfg/main   – { late, at, hrs, ub, ua }. shfcfg/map – { m: { '<שם עובד בכספית>': uid } } (ישמש בשלב הנוכחות).
//   shfsent/{day} – { rem: { occ: ts }, holes: ts, att: { '<occ>_<uid>': ts } } – מונע שליחה כפולה (day = יום תחילת המשמרת).
// shApi({ op, ... }) – תוספת tasks. מנהל, או עובד עם perms.shf: הכול חוץ מ-cfg/setCfg (מנהל בלבד). עובד בלי shf: רק week, ורק המשמרות שלו.
//   week{from}  – 7 ימים מ-from: מופעים, חורים (לפי שעות הפעילות), משימות (משימות שממתינות במשמרות של המשתמש עצמו – מוסתרות ממנו).
//   save{id?, day?, mode?, u, d, s, e, fx, nt} – חדשה / עריכה. עריכה רק מהיום והלאה (מופע שעבר – bad-day). משמרת קבועה: mode 'one'
//     (רק הפעם: skip + חד־פעמית עם of) / 'fwd' (מכאן והלאה: to = יום לפני, וקבועה חדשה; ההיסטוריה נשארת; d לא לפני day).
//     השינוי בהגדרה והעברת המשימות שממתינות – בטרנזקציה אחת. משימה שאין לה מופע מקביל – orph (לא מבוטלת בשקט).
//   del{id, day?, mode?} – חד־פעמית: מחיקה (רק לפני שהתחילה). קבועה: 'one' = skip, 'fwd' = to (רק מהיום והלאה). משימות שממתינות – cx.
//   task{occ, txt} / taskDel{id} – משימה למשמרת (עד 30 למופע). מוצגת לעובד רק בתחילת המשמרת: shTick יוצר אז משימה רגילה ב-tasks
//     (tasks/sh-<id>, כמו recurring.js, בלי rc – tkPush שולח לעובד התראה). משמרת שכבר התחילה – המשימה נוצרת מיד.
//   cfg / setCfg{late?, at?, hrs?, map?} – מנהל בלבד. staff – רשימת העובדים הפעילים והמנהלים לבחירה.
// shTick – כל 10 דקות (us-central1 בלבד): פרסום משימות שהגיע זמנן (בטרנזקציה: המשמרת נקראת מחדש, והמופע חייב להיות תקף);
//   תזכורת לעובד שעה לפני המשמרת (פעם אחת); התראה למנהלים על זמנים בלי עובדים, פעם ביום אחרי שעת ההתראה (07:00).
//   שבת וחג (SC.quiet – מערב 14:00 עד מוצאי 21:00): אין התראות. תזכורת שנופלת בחלון נשלחת לפניו (משמרת בשישי/שבת) או בסופו (מוצאי שבת).
//   "שכחת להחתים יציאה" (שלב G, 19.11.2026): 15 דק' אחרי סוף משמרת (גם חוצה חצות), אם לעובד יש כניסה פתוחה שחופפת למשמרת (attOpen) –
//   התראה לעובד ולמנהלים, פעם אחת (shfsent.att). מקור לא ידוע / אין מקור – לא נשלח כלום. בשבת וחג – במוצאי החלון. לא על משמרת שהסתיימה
//   לפני יותר מ-12 שעות (SC.attDue). אין רשימת התראות בתוך האפליקציה של העובד – push בלבד (k:'sh').
// שגיאות (details.reason): not-allowed, not-manager, bad-op, bad-field, bad-time, bad-day, bad-fx, bad-note, bad-user, bad-id, bad-mode,
//   no-shift, no-occ, no-user, too-many, past, bad-text, released, bad-cfg, bad-late, bad-at, bad-hrs, bad-map, feature-off.

const { HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { onCall, LEGACY_REGION } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const TK = require('./lib/tk-time');
const SC = require('./lib/shifts-core');

const MAX_DEFS = 300;
const MAX_TASKS = 30;
const MAX_MAP = 100;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);
function onlyKeys(o, keys) { for (const k of Object.keys(o)) if (!keys.includes(k)) throw bad('bad-field', 'שדה לא מוכר: ' + String(k).slice(0, 30)); }
const pastErr = () => bad('bad-day', 'אפשר לשנות משמרות רק מהיום והלאה');

// ---------- עזר ----------
async function loadDefs(db) {
  const s = await db.collection('shf').limit(MAX_DEFS + 50).get();
  return s.docs.map((d) => Object.assign({ id: d.id }, d.data()));
}
// עובדים פעילים + מנהלים: [{ uid, name, mgr }]
async function staffList(db) {
  const [st, ad] = await Promise.all([db.collection('staff').where('active', '==', true).limit(300).get(), db.collection('admins').limit(50).get()]);
  const out = new Map();
  for (const d of st.docs) out.set(d.id, { uid: d.id, name: str(d.get('name'), 60) || 'עובד', mgr: false });
  for (const d of ad.docs) {
    const o = out.get(d.id);
    if (o) o.mgr = true;
    else out.set(d.id, { uid: d.id, name: str(d.get('name'), 60) || str(d.get('email'), 200).split('@')[0].slice(0, 60) || 'מנהל', mgr: true });
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
// עובד פעיל או מנהל של העסק → השם (או null). s/a = המסמכים staff/{u}, admins/{u}
function nameFrom(s, a) {
  if (s.exists && s.get('active') === true) return str(s.get('name'), 60) || 'עובד';
  if (a.exists) return (s.exists && str(s.get('name'), 60)) || str(a.get('name'), 60) || str(a.get('email'), 200).split('@')[0].slice(0, 60) || 'מנהל';
  return null;
}
async function userName(db, u) {
  const [s, a] = await db.getAll(db.doc('staff/' + u), db.doc('admins/' + u));
  return nameFrom(s, a);
}
const meName = (request) => str(request.auth && request.auth.token && request.auth.token.email, 200).split('@')[0].slice(0, 100);

async function gate(request) {
  const who = await requireStaff(request, { feature: 'tasks' });
  const mgr = who.role === 'manager';
  return { who, db: T.tdb(), mgr, full: mgr || hasPerm(who, 'shf') };
}

// ---------- משימה ב-tasks בתחילת המשמרת (כמו recurring.js: taskDoc, בלי rc – כדי ש-tkPush ישלח לעובד) ----------
function taskDoc(s, occ, nm, now) {
  return {
    owner: str(s.by, 128), by: str(s.bn, 100), role: 'a', txt: str(s.txt, 500), cr: now, due: TK.tkDue(now),
    st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '',
    to: [occ.u], toN: [nm], ow: occ.u, owN: nm, clt: now, np: 0, wp: 0, mi: 0,
  };
}
// שחרור משימה אחת – בטרנזקציה: המשימה עדיין ממתינה, וההגדרה נקראת מחדש (מופע תקף, עם עובד פעיל, שכבר התחיל).
// today (shTick): מופע שלא קיים ושיומו עבר – orph. מחזיר 'rel' / 'orph' / 'early' / 'gone' / 'skip'
async function release(db, ref, now, today) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('st') !== 'wait') return 'skip';
    const x = s.data();
    const p = SC.parseOcc(x.occ);
    const ds = p ? await tx.get(db.doc('shf/' + p.sid)) : null;
    const oc = ds && ds.exists ? SC.occById([Object.assign({ id: ds.id }, ds.data())], x.occ) : null;
    if (!oc) {
      if (today && (!p || p.day < SC.addDays(today, -1))) { tx.update(ref, { st: 'orph', why: 'gone', relAt: now }); return 'orph'; }
      return 'gone';
    }
    if (oc.start > now) return 'early';
    const [st, ad] = oc.u ? await tx.getAll(db.doc('staff/' + oc.u), db.doc('admins/' + oc.u)) : [null, null];
    const nm = oc.u ? nameFrom(st, ad) : null;
    if (nm === null) { tx.update(ref, { st: 'orph', why: oc.u ? 'inactive' : 'no-user', relAt: now }); return 'orph'; }
    const tref = db.doc('tasks/sh-' + ref.id);
    const t = await tx.get(tref);
    if (!t.exists) tx.create(tref, taskDoc(x, oc, nm, now));
    tx.update(ref, { st: 'rel', tk: tref.id, relAt: now, u: oc.u });
    return 'rel';
  });
}

// בתוך טרנזקציה: המשימות שממתינות של הגדרה sid (קריאה – לפני כל כתיבה)
async function waitOf(tx, db, sid) {
  const s = await tx.get(db.collection('shft').where('sid', '==', sid).limit(500));
  return s.docs.filter((d) => d.get('st') === 'wait');
}
// map(day) → מזהה מופע חדש, או null: cancel = מחיקה ע"י המשתמש (cx), אחרת orph (לא נעלמת בשקט)
function moveIn(tx, docs, pick, map, now, cancel) {
  let n = 0;
  for (const d of docs) {
    const x = d.data();
    if (!pick(x.day)) continue;
    const to = map ? map(x.day) : null;
    if (to) { const p = SC.parseOcc(to); if (to !== x.occ) tx.update(d.ref, { occ: to, sid: p.sid, day: p.day }); } else tx.update(d.ref, cancel ? { st: 'cx', relAt: now } : { st: 'orph', why: 'moved', relAt: now });
    n++;
  }
  return n;
}
// "מכאן והלאה": המופע החדש שמקביל ליום x – היום הראשון (x === day) → המופע הראשון של ההגדרה החדשה; אחרת אותו שבוע, ביום החדש
function fwdMap(nid, nd, day) {
  return (x) => {
    const t = x === day ? (nd.fx ? nd.from : nd.d) : nd.fx ? SC.sameWeek(x, nd.wd) : null;
    return t && SC.appliesOn(nd, t) ? nid + '_' + t : null;
  };
}

// ---------- shApi ----------
async function opWeek(g, input) {
  onlyKeys(input, ['op', 'from']);
  const now = Date.now(), today = SC.todayOf(now);
  const from = input.from === undefined ? SC.weekStart(today) : input.from;
  if (!SC.isDay(from) || from < SC.addDays(today, -400) || from > SC.addDays(today, 400)) throw bad('bad-day', 'תאריך לא תקין');
  const { db, who, full } = g;
  const [defs, cfgS] = await Promise.all([loadDefs(db), full ? db.doc('shfcfg/main').get() : null]);
  const all = SC.expand(defs, SC.addDays(from, -1), 8);
  const days = Array.from({ length: 7 }, (_, i) => SC.addDays(from, i));
  const occ = all.filter((o) => o.day >= from && o.day <= days[6]);
  const out = { from, days, today, now, full, mgr: g.mgr };
  if (!full) {
    out.occ = occ.filter((o) => o.u === who.uid);
    return out;
  }
  const cfg = SC.cfgOf(cfgS && cfgS.exists ? cfgS.data() : null);
  out.hrs = cfg.hrs;
  out.holes = {};
  if (cfg.hrs) for (const d of days) { const h = SC.holes(d, cfg.hrs, all); if (h.length) out.holes[d] = h.map(([a, b]) => [SC.hmOf(a), SC.hmOf(b)]); }
  const ts = await db.collection('shft').where('day', '>=', from).where('day', '<=', days[6]).limit(1000).get();
  const tasks = {}, orph = [];
  const mine = new Set(occ.filter((o) => o.u === who.uid).map((o) => o.id));
  for (const d of ts.docs) {
    const x = d.data();
    if (x.st === 'cx') continue;
    if ((x.st === 'wait' || x.st === 'orph') && !g.mgr && mine.has(x.occ)) continue; // הנחה: משימות שממתינות במשמרת שלי – מוסתרות ממני
    const t = { id: d.id, txt: str(x.txt, 500), st: x.st, bn: str(x.bn, 100), at: x.at || 0 };
    if (x.st === 'orph') orph.push(Object.assign(t, { day: x.day, why: str(x.why, 20) }));
    else (tasks[x.occ] = tasks[x.occ] || []).push(t);
  }
  out.occ = occ;
  out.tasks = tasks;
  out.orph = orph;
  out.staff = await staffList(db);
  return out;
}

async function opSave(g, input) {
  onlyKeys(input, ['op', 'id', 'day', 'mode', 'u', 'd', 's', 'e', 'fx', 'nt']);
  const { db, who } = g;
  const now = Date.now(), today = SC.todayOf(now);
  const n = SC.normDef(input);
  if (n.err) throw bad(n.err.reason, n.err.msg);
  const def = n.def;
  let nm = '';
  if (def.u) { nm = await userName(db, def.u); if (nm === null) throw bad('bad-user', 'העובד לא פעיל בעסק'); }
  const stamp = { nm, ub: who.uid, ua: now };
  if (input.id === undefined) {
    if ((await db.collection('shf').select().limit(MAX_DEFS + 1).get()).size >= MAX_DEFS) throw pre('too-many', 'אפשר עד ' + MAX_DEFS + ' משמרות');
    const ref = db.collection('shf').doc();
    await ref.set(Object.assign({}, def, stamp, { by: who.uid, at: now }));
    return { ok: true, id: ref.id };
  }
  if (typeof input.id !== 'string' || !SC.ID_RE.test(input.id)) throw bad('bad-id', 'מזהה לא תקין');
  if (input.d < today) throw pastErr();
  const ref = db.doc('shf/' + input.id);
  const newOcc = (id, d) => (d.fx ? id + '_' + d.from : id + '_' + d.d);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw pre('no-shift', 'המשמרת לא נמצאה (אולי נמחקה). רעננו את המסך.');
    const old = Object.assign({ id: snap.id }, snap.data());
    const tasks = await waitOf(tx, db, old.id);
    const keep = { by: str(old.by, 128), at: old.at || now };
    if (old.of) keep.of = old.of;
    if (old.fx !== true) {
      // חד־פעמית: עריכה במקום (גם הפיכה לקבועה). המשימות עוברות לתאריך החדש
      if (!SC.isDay(old.d) || old.d < today) throw pastErr();
      tx.set(ref, Object.assign({}, def, stamp, keep));
      const to = newOcc(old.id, def);
      moveIn(tx, tasks, (x) => x === old.d, () => to, now);
      return { ok: true, id: old.id };
    }
    const day = input.day;
    if (!SC.isDay(day) || !SC.appliesOn(old, day)) throw bad('no-occ', 'המופע של המשמרת לא נמצא. רעננו את המסך.');
    if (day < today) throw pastErr();
    if (input.mode !== 'one' && input.mode !== 'fwd') throw bad('bad-mode', 'צריך לבחור: רק הפעם או מכאן והלאה');
    if (input.mode === 'one') {
      const one = SC.normDef(Object.assign({}, input, { fx: false })).def;
      const sk = SC.addSkip(old, day, today);
      if (sk.err) throw pre('too-many', 'יותר מדי שינויים חד־פעמיים במשמרת הזו. ערכו "מכאן והלאה".');
      const nref = db.collection('shf').doc();
      tx.update(ref, Object.assign({ skip: sk.skip, ub: who.uid, ua: now }, sk.from !== old.from ? { from: sk.from } : {}));
      tx.set(nref, Object.assign({}, one, stamp, { of: old.id, by: who.uid, at: now }));
      moveIn(tx, tasks, (x) => x === day, () => nref.id + '_' + one.d, now);
      return { ok: true, id: nref.id };
    }
    // מכאן והלאה: התאריך החדש לא לפני המופע שנערך (אחרת שני מופעים באותו שבוע)
    if (input.d < day) throw bad('bad-day', 'ב"מכאן והלאה" התאריך החדש לא יכול להיות לפני ' + day);
    const nw = def.fx ? Object.assign({}, def, { to: SC.isDay(old.to) ? old.to : '', skip: (old.skip || []).filter((x) => x > def.from) }) : def;
    if (day <= old.from) {
      // המופע הראשון – אין היסטוריה לשמור: עריכה במקום
      tx.set(ref, Object.assign({}, nw, stamp, keep));
      moveIn(tx, tasks, (x) => x >= day, fwdMap(old.id, Object.assign({ id: old.id }, nw), day), now);
      return { ok: true, id: old.id };
    }
    const nref = db.collection('shf').doc();
    tx.update(ref, { to: SC.addDays(day, -1), ub: who.uid, ua: now });
    tx.set(nref, Object.assign({}, nw, stamp, { by: who.uid, at: now }));
    moveIn(tx, tasks, (x) => x >= day, fwdMap(nref.id, Object.assign({ id: nref.id }, nw), day), now);
    return { ok: true, id: nref.id };
  });
}

async function opDel(g, input) {
  onlyKeys(input, ['op', 'id', 'day', 'mode']);
  const { db, who } = g;
  const now = Date.now(), today = SC.todayOf(now);
  if (typeof input.id !== 'string' || !SC.ID_RE.test(input.id)) throw bad('bad-id', 'מזהה לא תקין');
  const ref = db.doc('shf/' + input.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw pre('no-shift', 'המשמרת לא נמצאה (אולי כבר נמחקה)');
    const old = Object.assign({ id: snap.id }, snap.data());
    const tasks = await waitOf(tx, db, old.id);
    if (old.fx !== true) {
      if (SC.isHM(old.s) && SC.isDay(old.d) && SC.times(old.d, old.s, old.e || old.s).start <= now) throw pre('past', 'אי אפשר למחוק משמרת שכבר התחילה');
      tx.delete(ref);
      moveIn(tx, tasks, () => true, null, now, true);
      return { ok: true };
    }
    const day = input.day;
    if (!SC.isDay(day) || !SC.appliesOn(old, day)) throw bad('no-occ', 'המופע של המשמרת לא נמצא. רעננו את המסך.');
    if (day < today) throw pastErr();
    if (input.mode === 'one') {
      const sk = SC.addSkip(old, day, today);
      if (sk.err) throw pre('too-many', 'יותר מדי שינויים חד־פעמיים במשמרת הזו. מחקו "מכאן והלאה".');
      tx.update(ref, Object.assign({ skip: sk.skip, ub: who.uid, ua: now }, sk.from !== old.from ? { from: sk.from } : {}));
      moveIn(tx, tasks, (x) => x === day, null, now, true);
      return { ok: true };
    }
    if (input.mode !== 'fwd') throw bad('bad-mode', 'צריך לבחור: רק הפעם או מכאן והלאה');
    tx.update(ref, { to: SC.addDays(day, -1), ub: who.uid, ua: now }); // ההיסטוריה נשארת
    moveIn(tx, tasks, (x) => x >= day, null, now, true);
    return { ok: true };
  });
}

async function opTask(g, input, request) {
  onlyKeys(input, ['op', 'occ', 'txt']);
  const { db, who } = g;
  const now = Date.now();
  const p = SC.parseOcc(input.occ);
  if (!p) throw bad('bad-id', 'מזהה לא תקין');
  const txt = typeof input.txt === 'string' ? input.txt.trim() : '';
  if (!txt || txt.length > 500) throw bad('bad-text', 'כתבו משימה (עד 500 תווים)');
  const ds = await db.doc('shf/' + p.sid).get();
  const occ = ds.exists ? SC.occById([Object.assign({ id: ds.id }, ds.data())], input.occ) : null;
  if (!occ) throw pre('no-occ', 'המשמרת לא נמצאה. רעננו את המסך.');
  if (!occ.u) throw pre('no-user', 'אין עובד במשמרת הזו – קודם בחרו עובד');
  if (occ.end <= now) throw pre('past', 'המשמרת כבר הסתיימה');
  const cnt = await db.collection('shft').where('occ', '==', input.occ).limit(MAX_TASKS + 20).get();
  if (cnt.docs.filter((d) => d.get('st') === 'wait' || d.get('st') === 'rel').length >= MAX_TASKS) throw pre('too-many', 'אפשר עד ' + MAX_TASKS + ' משימות למשמרת');
  const ref = db.collection('shft').doc();
  await ref.set({ occ: input.occ, sid: p.sid, day: p.day, u: occ.u, txt, st: 'wait', tk: '', by: who.uid, bn: meName(request), at: now, relAt: 0 });
  let st = 'wait';
  if (occ.start <= now) { const r = await release(db, ref, now); st = r === 'rel' ? 'rel' : r === 'orph' ? 'orph' : 'wait'; }
  return { ok: true, id: ref.id, st };
}

async function opTaskDel(g, input) {
  onlyKeys(input, ['op', 'id']);
  if (typeof input.id !== 'string' || !SC.ID_RE.test(input.id)) throw bad('bad-id', 'מזהה לא תקין');
  const { db } = g;
  const ref = db.doc('shft/' + input.id);
  const ok = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return true;
    if (s.get('st') !== 'wait' && s.get('st') !== 'orph') return false;
    tx.delete(ref);
    return true;
  });
  if (!ok) throw pre('released', 'המשימה כבר נשלחה לעובד – אפשר לטפל בה במסך המשימות');
  return { ok: true };
}

async function opCfg(g, input) {
  onlyKeys(input, ['op']);
  const { db } = g;
  const [c, m, staff] = await Promise.all([db.doc('shfcfg/main').get(), db.doc('shfcfg/map').get(), staffList(db)]);
  const raw = m.exists && m.get('m') && typeof m.get('m') === 'object' ? m.get('m') : {};
  return { cfg: SC.cfgOf(c.exists ? c.data() : null), map: raw, staff };
}

async function opSetCfg(g, input) {
  onlyKeys(input, ['op', 'late', 'at', 'hrs', 'map']);
  const { db, who } = g;
  const now = Date.now();
  const upd = {};
  if (input.late !== undefined) { if (!Number.isInteger(input.late) || input.late < 0 || input.late > 60) throw bad('bad-late', 'סף איחור: 0–60 דקות'); upd.late = input.late; }
  if (input.at !== undefined) { if (!SC.isHM(input.at)) throw bad('bad-at', 'שעת התראה לא תקינה'); upd.at = input.at; }
  if (input.hrs !== undefined) { const h = SC.normHrs(input.hrs); if (!h) throw bad('bad-hrs', 'שעות הפעילות לא תקינות'); upd.hrs = h; }
  let map = null;
  if (input.map !== undefined) {
    const m = input.map;
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length > MAX_MAP) throw bad('bad-map', 'טבלת ההתאמה לא תקינה (עד ' + MAX_MAP + ' שורות)');
    map = {};
    for (const [k, v] of Object.entries(m)) {
      const name = String(k).replace(/\s+/g, ' ').trim();
      if (!name || name.length > 60 || /[\u0000-\u001f]/.test(name) || typeof v !== 'string' || !UID_RE.test(v)) throw bad('bad-map', 'שורה לא תקינה בטבלת ההתאמה');
      if ((await userName(db, v)) === null) throw bad('bad-map', 'משתמש לא פעיל בטבלת ההתאמה: ' + name);
      map[name] = v;
    }
  }
  if (!Object.keys(upd).length && !map) throw bad('bad-cfg', 'אין מה לשמור');
  const b = db.batch();
  if (Object.keys(upd).length) b.set(db.doc('shfcfg/main'), Object.assign(upd, { ub: who.uid, ua: now }), { merge: true });
  if (map) b.set(db.doc('shfcfg/map'), { m: map, ub: who.uid, ua: now }); // כל הטבלה מחדש (שורה שנמחקה – נמחקת)
  await b.commit();
  return opCfg(g, { op: 'cfg' });
}

async function api(request) {
  const input = inputObject(request);
  const g = await gate(request);
  const op = input.op;
  if (op === 'week') return opWeek(g, input);
  if (!['save', 'del', 'task', 'taskDel', 'cfg', 'setCfg', 'staff'].includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  if (!g.full) throw deny('not-allowed', 'אין לך הרשאה לערוך משמרות');
  if (op === 'save') return opSave(g, input);
  if (op === 'del') return opDel(g, input);
  if (op === 'task') return opTask(g, input, request);
  if (op === 'taskDel') return opTaskDel(g, input);
  if (op === 'staff') { onlyKeys(input, ['op']); return { staff: await staffList(g.db) }; }
  if (!g.mgr) throw deny('not-manager', 'ההגדרות זמינות למנהל בלבד');
  if (op === 'cfg') return opCfg(g, input);
  return opSetCfg(g, input);
}

// ---------- shTick: עסק אחד (בתוך T.runInBiz). opts: { now, send } ----------
// תפיסה בטרנזקציה – שתי ריצות במקביל לא שולחות פעמיים. key: 'rem' + occ / 'att' + '<occ>_<uid>' / 'holes'
async function claim(db, day, key, occ, now) {
  const ref = db.doc('shfsent/' + day);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() || {} : {};
    if (key === 'holes') { if (d.holes) return false; tx.set(ref, { holes: now, day }, { merge: true }); return true; }
    const k = key === 'att' ? 'att' : 'rem';
    if (d[k] && d[k][occ]) return false;
    tx.set(ref, { [k]: { [occ]: now }, day }, { merge: true });
    return true;
  });
}

// ---------- מקור נוכחות: האם לעובד יש כניסה פתוחה (נכנס ולא יצא) שחופפת למשמרת [start, end). true / false / null (לא ידוע) ----------
// כל מקור: on(biz) – האם חל בעסק; open(db, uid, start, end) → true / false / null. התוצאה: true אם מקור כלשהו אמר true; false אם לפחות
// מקור אחד ענה false ואף אחד לא true; אחרת null – ואז לא שולחים כלום.
const ATT_SRC = [
  // קופה חדשה (pos-clock.js): posclock/{uid}_{in}, out:null = כניסה פתוחה. רק בעסק במבנה החדש עם תוספת הקופה
  { id: 'posclock', on: (biz) => !!biz && !!biz.features && biz.features.pos === true && T.bizPrefix(biz) !== '',
    open: async (db, uid, start, end) => {
      const s = await db.collection('posclock').where('who', '==', uid).where('out', '==', null).limit(1).get();
      return !s.empty && SC.attHit(s.docs[0].data(), start, end);
    } },
  // כספית (שעון נוכחות דרך תוסף הדפדפן, docs/caspit-handoff.md – "שלב הנוכחות"): עוד לא קיים. ייושם בשלב הנוכחות לפי shfcfg/map
  // (שם עובד בכספית → uid). עד אז – תמיד "לא ידוע" (null), כך שלא נשלחת התראה על סמך מקור שאין לו נתונים.
  { id: 'caspit', on: () => false, open: async () => null },
];
async function attOpen(db, biz, uid, start, end, srcs) {
  let r = null;
  for (const x of srcs || ATT_SRC) {
    if (!x.on(biz)) continue;
    const v = await x.open(db, uid, start, end);
    if (v === true) return true;
    if (v === false) r = false;
  }
  return r;
}

const DN = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
// "היום" / "מחר" / "ביום שבת" – לפי שעון ישראל
const whenTxt = (day, today) => (day === today ? 'היום' : day === SC.addDays(today, 1) ? 'מחר' : 'ביום ' + DN[SC.weekdayOf(day)]);
async function tickBiz(o) {
  const db = T.tdb();
  const now = (o && o.now) || Date.now();
  const sc = T.scope();
  const DR = require('./daily-rep')._core;
  const [cfgS, defs, waitS] = await Promise.all([db.doc('shfcfg/main').get(), loadDefs(db), db.collection('shft').where('st', '==', 'wait').limit(500).get()]);
  const res = { rel: 0, orph: 0, rem: 0, holes: 0 };
  if (!defs.length && waitS.empty) return res;
  const cfg = SC.cfgOf(cfgS.exists ? cfgS.data() : null);
  const today = SC.todayOf(now);
  // 1. משימות שהגיע זמנן (גם בשבת – יצירת משימה אינה התראה; tkPush לא שולח בחלון השקט). הבדיקה הסופית – בטרנזקציה (release)
  for (const d of waitS.docs) {
    const x = d.data();
    const p = SC.parseOcc(x.occ);
    const oc = p ? SC.occById(defs, x.occ) : null;
    if (oc ? oc.start > now : p && p.day >= SC.addDays(today, -1)) continue;
    const r = await release(db, d.ref, now, today);
    if (r in res) res[r]++;
  }
  const quiet = SC.quiet(now);
  if (quiet) res.quiet = true;
  const occs = SC.expand(defs, SC.addDays(today, -1), 6); // עד 4 ימים קדימה – תזכורת לפני שבת וחג רצופים
  // 2. תזכורת לעובד, שעה לפני (בשבת וחג – לפני החלון או בסופו, SC.remDue)
  for (const oc of occs) {
    if (!SC.remDue(oc, now)) continue;
    if ((await userName(db, oc.u)) === null) continue;
    if (!(await claim(db, oc.day, 'rem', oc.id, now))) continue;
    res.rem++;
    const sd = SC.todayOf(oc.start);
    await DR.pushTo(db, [oc.u], { k: 'sh', id: oc.id, title: 'תזכורת משמרת', body: 'המשמרת שלך מתחילה ' + whenTxt(sd, today) + ' ב-' + oc.s + ' ועד ' + oc.e + (oc.x ? ' (למחרת)' : '') + (oc.nt ? ' · ' + oc.nt.slice(0, 80) : '') }, o, sc && sc.bizId);
  }
  // 3. התראה למנהלים: זמנים בלי עובדים היום (פעם ביום, לא בשבת וחג)
  const hd = SC.holesDue(cfg, now);
  if (hd.go && !quiet) {
    const hs = SC.holes(today, cfg.hrs, occs);
    if (await claim(db, today, 'holes', '', now)) {
      if (hs.length) {
        res.holes = hs.length;
        await DR.pushMgrs(db, { uid: 'shtick', bizId: sc && sc.bizId }, 'h' + today, '', Object.assign({}, o, { msg: { k: 'sh', id: 'h' + today, title: 'משמרות היום – זמנים בלי עובדים', body: SC.holesTxt(hs) } }));
      }
    }
  }
  // 4. "שכחת להחתים יציאה": משמרות שהסתיימו (עד 4 ימים אחורה – חג ושבת רצופים), לפי SC.attDue; רק כשמקור הנוכחות אומר בוודאות שהכניסה פתוחה
  if (!quiet) {
    for (const oc of SC.expand(defs, SC.addDays(today, -4), 5)) {
      if (!SC.attDue(oc, now)) continue;
      if ((await attOpen(db, sc && sc.biz, oc.u, oc.start, oc.end)) !== true) continue;
      const nm = await userName(db, oc.u);
      if (nm === null) continue;
      if (!(await claim(db, oc.day, 'att', oc.id + '_' + oc.u, now))) continue;
      res.att = (res.att || 0) + 1;
      const ed = SC.todayOf(oc.end), endTxt = oc.e + (ed === today ? '' : ed === SC.addDays(today, -1) ? ' (אתמול)' : ' (יום ' + DN[SC.weekdayOf(ed)] + ')');
      await DR.pushTo(db, [oc.u], { k: 'sh', id: 'a' + oc.id, title: 'החתמת יציאה', body: 'אם שכחת להחתים אצבע, נא לפנות בהקדם למנהל' }, o, sc && sc.bizId);
      await DR.pushMgrs(db, { uid: 'shtick', bizId: sc && sc.bizId }, 'am' + oc.id, '', Object.assign({}, o, { msg: { k: 'sh', id: 'am' + oc.id, title: 'לא הוחתמה יציאה', body: (nm || 'עובד') + ' – המשמרת הסתיימה ב-' + endTxt + ', ואין החתמת יציאה' } }));
    }
  }
  return res;
}
async function runTick(opts) {
  const o = opts || {};
  const list = o.bizzes || (await T.bizzesWith('tasks')).filter((b) => b.status === 'active' && b.features && b.features.tasks === true);
  const out = {};
  for (const biz of list) {
    try { out[biz.bizId] = await T.runInBiz({ bizId: biz.bizId, prefix: T.bizPrefix(biz), biz }, () => tickBiz(o)); } catch (e) {
      logger.error('shTick: biz failed', { bizId: biz.bizId, name: e && e.name, code: e && e.code });
      out[biz.bizId] = { error: true };
    }
  }
  return out;
}

const wrap = (fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('shApi failed', { name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

exports.shApi = onCall(wrap(api));
// מתוזמנת – אזור אחד בלבד (אסור להריץ כפול)
exports.shTick = onSchedule({ region: LEGACY_REGION, schedule: 'every 10 minutes', timeZone: TK.TZ, timeoutSeconds: 120, memory: '256MiB' }, async () => {
  const r = await runTick({});
  if (Object.values(r).some((x) => x.rel || x.orph || x.rem || x.holes || x.att || x.error)) logger.info('shTick', r);
});

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_core', { enumerable: false, value: { api: wrap(api), tickBiz, runTick, release, taskDoc, attOpen, ATT_SRC, ops: { opWeek, opSave, opDel, opTask, opTaskDel, opCfg, opSetCfg } } });
