'use strict';
// משמרות (שלב 3, 18.11.2026). כל הנתונים בתוך העסק (T.tdb(): בשורש בלארג' פעמי legacy, אחרת b/{bizId}/), והשרת בלבד קורא וכותב –
// אין כללי Firestore לאוספים האלה, והחסימה הכללית בסוף firestore.rules חוסמת גישה ישירה מהאפליקציה.
//   shf/{id}      – הגדרת משמרת (lib/shifts-core.js). shft/{id} – משימה למשמרת: { occ, sid, day, u, txt, st: wait|rel, tk, by, bn, at, relAt }.
//   shfcfg/main   – { late, at, hrs, ub, ua }. shfcfg/map – { m: { '<שם עובד בכספית>': uid } } (ישמש בשלב הנוכחות).
//   shfsent/{day} – { rem: { occ: ts }, holes: ts } – מונע שליחה כפולה.
// shApi({ op, ... }) – תוספת tasks. מנהל, או עובד עם perms.shf: הכול חוץ מ-cfg/setCfg (מנהל בלבד). עובד בלי shf: רק week, ורק המשמרות שלו.
//   week{from}  – 7 ימים מ-from: מופעים, חורים (לפי שעות הפעילות), משימות (משימות שממתינות במשמרות של המשתמש עצמו – מוסתרות ממנו).
//   save{id?, day?, mode?, u, d, s, e, fx, nt} – חדשה / עריכה. משמרת קבועה: mode 'one' (רק הפעם: skip + חד־פעמית עם of) / 'fwd' (מכאן והלאה:
//     to = יום לפני, וקבועה חדשה; ההיסטוריה נשארת). משימות שממתינות עוברות למופע החדש.
//   del{id, day?, mode?} – חד־פעמית: מחיקה (רק לפני שהתחילה). קבועה: 'one' = skip, 'fwd' = to. משימות שממתינות – מבוטלות (st 'cx').
//   task{occ, txt} / taskDel{id} – משימה למשמרת (עד 30 למופע). מוצגת לעובד רק בתחילת המשמרת: shTick יוצר אז משימה רגילה ב-tasks
//     (tasks/sh-<id>, כמו recurring.js, בלי rc – tkPush שולח לעובד התראה). משמרת שכבר התחילה – המשימה נוצרת מיד.
//   cfg / setCfg{late?, at?, hrs?, map?} – מנהל בלבד. staff – רשימת העובדים הפעילים והמנהלים לבחירה.
// shTick – כל 10 דקות (us-central1 בלבד): פרסום משימות שהגיע זמנן; תזכורת לעובד שעה לפני המשמרת (פעם אחת);
//   התראה למנהלים על זמנים בלי עובדים, פעם ביום אחרי שעת ההתראה (07:00). בחלון השקט (שבת וחג, TK.quietAt) – אין התראות.
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
// עובד פעיל או מנהל של העסק → השם (או null)
async function userName(db, u) {
  const [s, a] = await db.getAll(db.doc('staff/' + u), db.doc('admins/' + u));
  if (s.exists && s.get('active') === true) return str(s.get('name'), 60) || 'עובד';
  if (a.exists) return (s.exists && str(s.get('name'), 60)) || str(a.get('name'), 60) || str(a.get('email'), 200).split('@')[0].slice(0, 60) || 'מנהל';
  return null;
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
// מחזיר 'rel' / 'cx'
async function release(db, ref, s, occ, now) {
  const nm = occ && occ.u ? await userName(db, occ.u) : null;
  if (!occ || !occ.u || nm === null) { await ref.update({ st: 'cx', relAt: now }); return 'cx'; }
  const tid = 'sh-' + ref.id;
  const b = db.batch();
  b.create(db.doc('tasks/' + tid), taskDoc(s, occ, nm, now));
  b.update(ref, { st: 'rel', tk: tid, relAt: now, u: occ.u });
  try { await b.commit(); } catch (e) {
    if (!(e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message))))) throw e;
    await ref.update({ st: 'rel', tk: tid, relAt: now });
  }
  return 'rel';
}

// משימות שממתינות של הגדרה sid: map(day) → מזהה מופע חדש, או null = ביטול. pick(day) – אילו ימים
async function moveTasks(db, sid, pick, map, now) {
  const s = await db.collection('shft').where('sid', '==', sid).limit(500).get();
  const b = db.batch();
  let n = 0;
  for (const d of s.docs) {
    const x = d.data();
    if (x.st !== 'wait' || !pick(x.day)) continue;
    const to = map(x.day);
    if (to) { const p = SC.parseOcc(to); b.update(d.ref, { occ: to, sid: p.sid, day: p.day }); } else b.update(d.ref, { st: 'cx', relAt: now });
    n++;
  }
  if (n) await b.commit();
  return n;
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
  let occ = all.filter((o) => o.day >= from && o.day <= days[6]);
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
  const tasks = {};
  const mine = new Set(occ.filter((o) => o.u === who.uid).map((o) => o.id));
  for (const d of ts.docs) {
    const x = d.data();
    if (x.st === 'cx') continue;
    if (x.st === 'wait' && !g.mgr && mine.has(x.occ)) continue; // הנחה: משימות שממתינות במשמרת שלי – מוסתרות ממני
    (tasks[x.occ] = tasks[x.occ] || []).push({ id: d.id, txt: str(x.txt, 500), st: x.st, bn: str(x.bn, 100), at: x.at || 0 });
  }
  out.occ = occ;
  out.tasks = tasks;
  out.staff = await staffList(db);
  return out;
}

async function opSave(g, input) {
  onlyKeys(input, ['op', 'id', 'day', 'mode', 'u', 'd', 's', 'e', 'fx', 'nt']);
  const { db, who } = g;
  const now = Date.now();
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
  const ref = db.doc('shf/' + input.id);
  const snap = await ref.get();
  if (!snap.exists) throw pre('no-shift', 'המשמרת לא נמצאה (אולי נמחקה). רעננו את המסך.');
  const old = Object.assign({ id: snap.id }, snap.data());
  const keep = { by: str(old.by, 128), at: old.at || now };
  if (old.of) keep.of = old.of;
  const newOcc = (id, d) => (d.fx ? id + '_' + d.from : id + '_' + d.d);
  if (old.fx !== true) {
    // חד־פעמית: עריכה במקום (גם הפיכה לקבועה)
    await ref.set(Object.assign({}, def, stamp, keep));
    const to = newOcc(old.id, def);
    await moveTasks(db, old.id, (day) => day === old.d, () => to, now);
    return { ok: true, id: old.id };
  }
  const day = input.day;
  if (!SC.isDay(day) || !SC.appliesOn(old, day)) throw bad('no-occ', 'המופע של המשמרת לא נמצא. רעננו את המסך.');
  if (input.mode !== 'one' && input.mode !== 'fwd') throw bad('bad-mode', 'צריך לבחור: רק הפעם או מכאן והלאה');
  if (input.mode === 'one') {
    const one = SC.normDef(Object.assign({}, input, { fx: false })).def;
    const skip = (Array.isArray(old.skip) ? old.skip : []).filter((x) => SC.isDay(x) && x >= SC.addDays(SC.todayOf(now), -7));
    if (skip.length >= SC.MAX_SKIP) throw pre('too-many', 'יותר מדי שינויים חד־פעמיים במשמרת הזו. ערכו "מכאן והלאה".');
    const nref = db.collection('shf').doc();
    const b = db.batch();
    b.update(ref, { skip: skip.concat([day]), ub: who.uid, ua: now });
    b.set(nref, Object.assign({}, one, stamp, { of: old.id, by: who.uid, at: now }));
    await b.commit();
    await moveTasks(db, old.id, (x) => x === day, () => nref.id + '_' + one.d, now);
    return { ok: true, id: nref.id };
  }
  // מכאן והלאה
  if (day <= old.from) {
    // המופע הראשון – אין היסטוריה לשמור: עריכה במקום (טווח הסיום והדילוגים נשמרים כשהמשמרת נשארת קבועה)
    const upd = def.fx ? Object.assign({}, def, { to: SC.isDay(old.to) ? old.to : '', skip: (old.skip || []).filter((x) => x > def.from) }) : def;
    await ref.set(Object.assign({}, upd, stamp, keep));
    const nd = Object.assign({ id: old.id }, upd);
    await moveTasks(db, old.id, (x) => x >= day, (x) => (SC.appliesOn(nd, x) ? old.id + '_' + x : x === day ? newOcc(old.id, upd) : null), now);
    return { ok: true, id: old.id };
  }
  const nref = db.collection('shf').doc();
  const nw = def.fx ? Object.assign({}, def, { to: SC.isDay(old.to) ? old.to : '', skip: (old.skip || []).filter((x) => x > def.from) }) : def;
  const b = db.batch();
  b.update(ref, { to: SC.addDays(day, -1), ub: who.uid, ua: now });
  b.set(nref, Object.assign({}, nw, stamp, { by: who.uid, at: now }));
  await b.commit();
  const nd = Object.assign({ id: nref.id }, nw);
  await moveTasks(db, old.id, (x) => x >= day, (x) => (SC.appliesOn(nd, x) ? nref.id + '_' + x : x === day ? newOcc(nref.id, nw) : null), now);
  return { ok: true, id: nref.id };
}

async function opDel(g, input) {
  onlyKeys(input, ['op', 'id', 'day', 'mode']);
  const { db, who } = g;
  const now = Date.now();
  if (typeof input.id !== 'string' || !SC.ID_RE.test(input.id)) throw bad('bad-id', 'מזהה לא תקין');
  const ref = db.doc('shf/' + input.id);
  const snap = await ref.get();
  if (!snap.exists) throw pre('no-shift', 'המשמרת לא נמצאה (אולי כבר נמחקה)');
  const old = Object.assign({ id: snap.id }, snap.data());
  if (old.fx !== true) {
    if (SC.isHM(old.s) && SC.isDay(old.d) && SC.times(old.d, old.s, old.e || old.s).start <= now) throw pre('past', 'אי אפשר למחוק משמרת שכבר התחילה');
    await ref.delete();
    await moveTasks(db, old.id, () => true, () => null, now);
    return { ok: true };
  }
  const day = input.day;
  if (!SC.isDay(day) || !SC.appliesOn(old, day)) throw bad('no-occ', 'המופע של המשמרת לא נמצא. רעננו את המסך.');
  if (input.mode === 'one') {
    const skip = (Array.isArray(old.skip) ? old.skip : []).filter((x) => SC.isDay(x) && x >= SC.addDays(SC.todayOf(now), -7));
    if (skip.length >= SC.MAX_SKIP) throw pre('too-many', 'יותר מדי שינויים חד־פעמיים במשמרת הזו. מחקו "מכאן והלאה".');
    await ref.update({ skip: skip.concat([day]), ub: who.uid, ua: now });
    await moveTasks(db, old.id, (x) => x === day, () => null, now);
    return { ok: true };
  }
  if (input.mode !== 'fwd') throw bad('bad-mode', 'צריך לבחור: רק הפעם או מכאן והלאה');
  await ref.update({ to: SC.addDays(day, -1), ub: who.uid, ua: now }); // ההיסטוריה נשארת
  await moveTasks(db, old.id, (x) => x >= day, () => null, now);
  return { ok: true };
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
  if (cnt.docs.filter((d) => d.get('st') !== 'cx').length >= MAX_TASKS) throw pre('too-many', 'אפשר עד ' + MAX_TASKS + ' משימות למשמרת');
  const ref = db.collection('shft').doc();
  const s = { occ: input.occ, sid: p.sid, day: p.day, u: occ.u, txt, st: 'wait', tk: '', by: who.uid, bn: meName(request), at: now, relAt: 0 };
  await ref.set(s);
  const st = occ.start <= now ? await release(db, ref, s, occ, now) : 'wait';
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
    if (s.get('st') !== 'wait') return false;
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
// תפיסה בטרנזקציה – שתי ריצות במקביל לא שולחות פעמיים. key: 'rem' + occ / 'holes'
async function claim(db, day, key, occ, now) {
  const ref = db.doc('shfsent/' + day);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() || {} : {};
    if (key === 'holes') { if (d.holes) return false; tx.set(ref, { holes: now, day }, { merge: true }); return true; }
    if (d.rem && d.rem[occ]) return false;
    tx.set(ref, { rem: { [occ]: now }, day }, { merge: true });
    return true;
  });
}

async function tickBiz(o) {
  const db = T.tdb();
  const now = (o && o.now) || Date.now();
  const sc = T.scope();
  const DR = require('./daily-rep')._core;
  const [cfgS, defs, waitS] = await Promise.all([db.doc('shfcfg/main').get(), loadDefs(db), db.collection('shft').where('st', '==', 'wait').limit(500).get()]);
  const res = { rel: 0, cx: 0, rem: 0, holes: 0 };
  if (!defs.length && waitS.empty) return res;
  const cfg = SC.cfgOf(cfgS.exists ? cfgS.data() : null);
  const today = SC.todayOf(now);
  // 1. משימות שהגיע זמנן (גם בשבת – יצירת משימה אינה התראה; tkPush לא שולח בחלון השקט)
  for (const d of waitS.docs) {
    const x = d.data();
    const p = SC.parseOcc(x.occ);
    const oc = p ? SC.occById(defs, x.occ) : null;
    if (!oc) { if (!p || p.day < SC.addDays(today, -1)) { await d.ref.update({ st: 'cx', relAt: now }); res.cx++; } continue; }
    if (oc.start > now) continue;
    res[await release(db, d.ref, x, oc, now)]++;
  }
  if (TK.quietAt(now)) return Object.assign(res, { quiet: true });
  const occs = SC.expand(defs, SC.addDays(today, -1), 3);
  // 2. תזכורת לעובד, שעה לפני
  for (const oc of occs) {
    if (!SC.remDue(oc, now)) continue;
    if ((await userName(db, oc.u)) === null) continue;
    if (!(await claim(db, oc.day, 'rem', oc.id, now))) continue;
    res.rem++;
    await DR.pushTo(db, [oc.u], { k: 'sh', id: oc.id, title: 'תזכורת משמרת', body: 'המשמרת שלך מתחילה ב-' + oc.s + ' ועד ' + oc.e + (oc.x ? ' (למחרת)' : '') + (oc.nt ? ' · ' + oc.nt.slice(0, 80) : '') }, o, sc && sc.bizId);
  }
  // 3. התראה למנהלים: זמנים בלי עובדים היום (פעם ביום)
  const hd = SC.holesDue(cfg, now);
  if (hd.go) {
    const hs = SC.holes(today, cfg.hrs, occs);
    if (await claim(db, today, 'holes', '', now)) {
      if (hs.length) {
        res.holes = hs.length;
        await DR.pushMgrs(db, { uid: 'shtick', bizId: sc && sc.bizId }, 'h' + today, '', Object.assign({}, o, { msg: { k: 'sh', id: 'h' + today, title: 'משמרות היום – זמנים בלי עובדים', body: SC.holesTxt(hs) } }));
      }
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
  if (Object.values(r).some((x) => x.rel || x.rem || x.holes || x.error)) logger.info('shTick', r);
});

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_core', { enumerable: false, value: { api: wrap(api), tickBiz, runTick, release, taskDoc, ops: { opWeek, opSave, opDel, opTask, opTaskDel, opCfg, opSetCfg } } });
