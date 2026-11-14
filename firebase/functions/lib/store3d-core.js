'use strict';
// סריקת חנות בתלת מימד – שלב 5 (14.11.2026): הלוגיקה הטהורה של סבבי הסריקה, בלי Firestore (נבדקת ב-Node בלי אמולטור).
// המקור המחייב: חוזה הנתונים (משימות/2026-11-14_סריקת-חנות-תלת-מימד/תוצרים/0-חוזה-נתונים.md), סעיפים 1.1, 4.7, 4.8, 4.18, 4.21.
//   nextOpen(rule)        – מועד הפתיחה הבא של כלל סבב (06:00 שעון ישראל): שבוע ביום קבוע / חודש ביום קבוע / כל X ימים / ידני (0).
//                           מחושב רק מתוך f, last ו-upd – אין מצב נסתר, ולכן עריכה של המנהל (upd חדש) מחשבת מחדש לבד.
//   decideOpen(rid, rule, now) – האם לפתוח עכשיו, ומזהה הסבב הקבוע <rid>_<YYYYMMDD> (יום המועד) – ריצה כפולה = אותו מזהה = בלי כפילות.
//   baysOf(map) / splitBays(bays, asg) – רשימת המקטעים מהגופים, וחלוקה לעובדים (z = חדרים/גופים; z ריק = כל השאר, בחלוקה מאוזנת).
//   planDeparted(...)     – עובד מושבת/שעזב: העברה למחליף הקבוע (sub == 'fixed'), אחרת שגיאה (staff-disabled / sub-disabled).
//                           ה-asg המוחזר חל רק על הסבב שנפתח – הכלל של המנהל לא משתנה (תיקון סבב 1, החלטת המתאם).
//   addEvent / workPause  – יומן הזמנים של עובד (התחלה, הפסקה, המשך, סיום) ודקות עבודה והפסקה.
//   finished / timeStep   – סיום סבב, תזכורת ואיחור.
//   moveRun               – העברת חלק של עובד בסבב לעובד אחר (מנהל) או לקיחה (עובד, כש-sub == 'any').
//   viewRun               – מה עובד רואה מסבב (s3View), לפי s3set.show.

const crypto = require('node:crypto');
const TK = require('./tk-time');

const D1 = 86400000, MIN = 60000;
const OPEN_HH = 6;            // שעת פתיחה של סבב מתוזמן, שעון ישראל (הנחה בחוזה 4.7)
const MAX_W = 10;             // עובדים בסבב
const MAX_BAYS = 2000;        // מקטעים במפה
const MAX_EV = 100;           // אירועי זמן לעובד בסבב
const RE = {
  uid: /^[A-Za-z0-9_-]{6,128}$/,
  rid: /^[a-z0-9]{6,20}$/,
  br: /^[a-z0-9_]{2,20}$/,
  map: /^[sw]-[a-z0-9_]{2,20}$/,
  fx: /^f[0-9]{1,4}$/,
  room: /^r[0-9]{1,4}$/,
  zone: /^[rf][0-9]{1,4}$/,
  bay: /^f[0-9]{1,4}-[ab]-[0-9]{1,2}$/,
  slot: /^f[0-9]{1,4}-[ab]-[0-9]{1,2}_[atb]$/,
  qid: /^[A-Za-z0-9-]{16,40}$/,
  runSched: /^[a-z0-9]{6,20}_[0-9]{8}$/,
  runMan: /^[a-z0-9]{6,20}_m[0-9]{13}$/,
  runAd: /^ad_[A-Za-z0-9-]{16,40}$/,
};
const SUBS = ['fixed', 'manual', 'any'];
const SHOW = ['fix', 'score', 'recs', 'full'];
const EVS = ['s', 'p', 'r', 'e'];
const LIVE = ['open', 'late'];

const isRunId = (s) => typeof s === 'string' && (RE.runSched.test(s) || RE.runMan.test(s) || RE.runAd.test(s));
const intIn = (v, a, b) => (Number.isInteger(v) && v >= a && v <= b ? v : 0);
const num = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
function fail(code) { const e = new Error(code); e.code = code; return e; }

// ---------- תדירות ומועד הבא ----------
function cleanF(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  if (f.k === 'manual') return { k: 'manual' };
  if (f.k === 'week' && intIn(f.dow + 1, 1, 7)) return { k: 'week', dow: f.dow };
  if (f.k === 'month' && intIn(f.dom, 1, 28)) return { k: 'month', dom: f.dom };
  if (f.k === 'days' && intIn(f.n, 1, 90)) return { k: 'days', n: f.n };
  return null;
}
// יום y-m-d + i ימים (מנורמל), ו-06:00 שעון ישראל של יום כזה
function addDays(o, i) { const d = new Date(Date.UTC(o.y, o.m, o.d + i)); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; }
const at6 = (o) => TK.zoned(o.y, o.m, o.d, OPEN_HH, 0);
const weekday = (o) => new Date(Date.UTC(o.y, o.m, o.d)).getUTCDay();
// המועד הראשון (06:00) אחרי t (לא כולל) ביום שמתאים ל-ok. עד 62 יום קדימה (חודש מלא + מרווח)
function firstAfter(t, ok) {
  const o = TK.ymdOf(t);
  for (let i = 0; i <= 62; i++) { const x = addDays(o, i), c = at6(x); if (c > t && ok(x)) return c; }
  return 0;
}
// מפתח היום בשעון ישראל: YYYYMMDD
const dayKey = (t) => TK.dayStr(TK.ymdOf(t)).replace(/-/g, '');

// המועד הבא של כלל. 0 = אין (ידני / תדירות לא תקינה / כלל בלי upd).
//   שבוע / חודש: המועד הראשון אחרי max(last, upd) – כלומר אחרי הפתיחה האחרונה, ואחרי העריכה האחרונה (הפעלה מחדש לא "משלימה" סבבים שעברו).
//   כל X ימים: last + X ימים (06:00). אם המנהל ערך את הכלל אחרי המועד הזה (למשל הפעיל אותו מחדש אחרי הפסקה) – מתחילים מחדש מהעריכה.
function nextOpen(rule) {
  const r = rule || {};
  const f = cleanF(r.f);
  if (!f || f.k === 'manual') return 0;
  const last = num(r.last), upd = num(r.upd), base = Math.max(last, upd);
  if (!base) return 0;
  if (f.k === 'days') {
    if (last) { const c = at6(addDays(TK.ymdOf(last), f.n)); if (c > upd) return c; }
    return firstAfter(upd, () => true);
  }
  if (f.k === 'week') return firstAfter(base, (o) => weekday(o) === f.dow);
  return firstAfter(base, (o) => o.d === f.dom);
}

// { go, why, next, runId }
function decideOpen(rid, rule, now) {
  const r = rule || {};
  if (r.on !== true) return { go: false, why: 'off', next: 0 };
  if (r.del === 1) return { go: false, why: 'deleted', next: 0 };
  const next = nextOpen(r);
  if (!next) return { go: false, why: 'manual', next: 0 };
  if (now < next) return { go: false, why: 'early', next };
  return { go: true, why: 'go', next, runId: rid + '_' + dayKey(next) };
}

// ---------- הגדרות: הכלל דורס את s3set ----------
function settingsFor(rule, set) {
  const r = rule || {}, s = set || {};
  const sub = SUBS.includes(r.sub) ? r.sub : SUBS.includes(s.sub) ? s.sub : 'manual';
  const subU = typeof r.subU === 'string' && RE.uid.test(r.subU) ? r.subU : typeof s.subU === 'string' && RE.uid.test(s.subU) ? s.subU : '';
  const due = intIn(r.due, 1, 14) || intIn(s.due, 1, 14) || 2;
  return { sub, subU, due };
}

// ---------- שיוך עובדים ----------
// asg של הכלל: [{u, z}] → [{u, z: null (הכל) | [מזהים]}]. uid לא תקין – מדולג; uid כפול – מאוחד; עד 10 עובדים.
function cleanAsg(asg) {
  const out = [], seen = new Map();
  for (const a of Array.isArray(asg) ? asg : []) {
    if (!a || typeof a !== 'object' || typeof a.u !== 'string' || !RE.uid.test(a.u)) continue;
    const zl = Array.isArray(a.z) ? [...new Set(a.z.filter((x) => typeof x === 'string' && RE.zone.test(x)))].slice(0, 200) : [];
    const z = zl.length ? zl : null;
    const e = seen.get(a.u);
    if (e) { e.z = e.z && z ? [...new Set(e.z.concat(z))].slice(0, 200) : null; continue; }
    if (out.length >= MAX_W) continue;
    const n = { u: a.u, z };
    seen.set(a.u, n); out.push(n);
  }
  return out;
}
// מי קורא את הכלל (sround.uids): העובדים המשויכים + המחליף, עד 11
function uidsOf(asg, subU) {
  const l = cleanAsg(asg).map((a) => a.u);
  if (subU && RE.uid.test(subU) && !l.includes(subU)) l.push(subU);
  return l.slice(0, 11);
}

// עובדים לא פעילים בכלל. isActive(uid) → bool.
//   sub == 'fixed' ומחליף פעיל: החלק שלהם עובר למחליף (בכלל עצמו – כל הסבבים הבאים). moved = מי הועבר.
//   אחרת: stuck = מי תקוע, err = 'sub-disabled' (יש מחליף קבוע אבל הוא לא פעיל / חסר) או 'staff-disabled'.
function planDeparted(asg, isActive, sub, subU) {
  const A = cleanAsg(asg);
  const gone = A.filter((a) => !isActive(a.u)).map((a) => a.u);
  if (!gone.length) return { asg: null, moved: [], stuck: [], err: '' };
  const ok = sub === 'fixed' && !!subU && RE.uid.test(subU) && isActive(subU) && !gone.includes(subU);
  if (!ok) return { asg: null, moved: [], stuck: gone, err: sub === 'fixed' ? 'sub-disabled' : 'staff-disabled' };
  let out = A.map((a) => ({ u: a.u, z: a.z }));
  let tgt = out.find((a) => a.u === subU) || null;
  for (const g of gone) {
    const src = out.find((a) => a.u === g);
    if (tgt) { tgt.z = tgt.z && src.z ? [...new Set(tgt.z.concat(src.z))].slice(0, 200) : null; out = out.filter((a) => a !== src); }
    else { src.u = subU; tgt = src; }
  }
  return { asg: out.map((a) => ({ u: a.u, z: a.z || [] })), moved: gone, stuck: [], err: '' };
}

// ---------- מפה ומקטעים ----------
// בעיה במפה שמונעת פתיחת סבב: 'no-map' (חסרה / של סניף אחר / בלי מקטעים) או 'map-deleted'
function mapProblem(map, br) {
  if (!map || typeof map !== 'object') return 'no-map';
  if (map.del === 1) return 'map-deleted';
  if (map.br !== br) return 'no-map';
  if (!intIn(map.v, 1, 1000000)) return 'no-map';
  return baysOf(map).length ? '' : 'no-map';
}
// המקטעים נגזרים מהגופים (חוזה 4.3, טבלה ג'): לכל צד ולכל מקטע bayId = id-s-n; k = מספר הצילומים (2 במדף גבוה, אחרת 1).
// גוף מחוק (del == 1) או לא תקין – מדולג. עד 2000 מקטעים.
function baysOf(map) {
  const out = [];
  for (const f of Array.isArray(map && map.fx) ? map.fx : []) {
    if (!f || typeof f !== 'object' || f.del === 1 || typeof f.id !== 'string' || !RE.fx.test(f.id)) continue;
    const nb = intIn(f.bays, 1, 30);
    if (!nb) continue;
    const room = typeof f.room === 'string' && RE.room.test(f.room) ? f.room : '';
    for (const s of f.sides === 2 ? ['a', 'b'] : ['a']) {
      for (let n = 1; n <= nb; n++) {
        if (out.length >= MAX_BAYS) return out;
        out.push({ bay: f.id + '-' + s + '-' + n, fx: f.id, room, k: f.hi === true ? 2 : 1 });
      }
    }
  }
  return out;
}
// חלוקה: קודם מי שקיבל חדרים/גופים (z) – לפי הסדר ב-asg, מקטע לא מחולק פעמיים. אחר כך מי ש-z ריק אצלו מקבל את כל השאר;
// כמה כאלה – חלוקה רציפה לפי גופים (גוף שלם אצל עובד אחד), מאוזנת לפי מספר הצילומים. מקטע שלא שויך – לא בסבב (אפור).
function splitBays(bays, asg) {
  const A = cleanAsg(asg);
  const own = {};
  for (const a of A) own[a.u] = [];
  const taken = new Set();
  for (const a of A) {
    if (!a.z) continue;
    const zs = new Set(a.z);
    for (const b of bays) if (!taken.has(b.bay) && (zs.has(b.fx) || (b.room && zs.has(b.room)))) { taken.add(b.bay); own[a.u].push(b); }
  }
  const all = A.filter((a) => !a.z);
  if (all.length) {
    const rest = bays.filter((b) => !taken.has(b.bay));
    const groups = [];
    for (const b of rest) { const g = groups[groups.length - 1]; if (g && g.fx === b.fx) g.items.push(b); else groups.push({ fx: b.fx, items: [b] }); }
    const total = rest.reduce((s, b) => s + b.k, 0);
    let i = 0, acc = 0;
    for (const g of groups) {
      while (i < all.length - 1 && acc >= (total * (i + 1)) / all.length) i++;
      own[all[i].u].push(...g.items);
      acc += g.items.reduce((s, b) => s + b.k, 0);
    }
  }
  const out = {}, nUid = {};
  let n = 0;
  for (const a of A) {
    out[a.u] = own[a.u].map((b) => b.bay);
    const k = own[a.u].reduce((s, b) => s + b.k, 0);
    nUid[a.u] = { n: k, d: 0 };
    n += k;
  }
  return { asg: out, nUid, n, uids: A.map((a) => a.u) };
}

// מסמך סבב חדש (חוזה 4.8). k = 'sched' / 'manual'. subFrom – רק כשמחליף נכנס באותה פתיחה.
function runDoc(o) {
  const tlog = {};
  for (const u of o.split.uids) tlog[u] = [];
  const d = {
    br: o.br, map: o.mapId, mapV: o.mapV, k: o.k, st: 'open', asg: o.split.asg, uids: o.split.uids,
    n: o.split.n, nDone: 0, nUid: o.split.nUid, openAt: o.now, dueAt: o.now + o.due * D1, tlog,
  };
  if (o.rid) d.rid = o.rid;
  if (o.subFrom && Object.keys(o.subFrom).length) d.subFrom = o.subFrom;
  return d;
}

// ---------- יומן זמנים ----------
const validEv = (e) => e && EVS.includes(e.k) && Number.isInteger(e.t);
// מוסיף אירוע ליומן של עובד. t = זמן הטלפון; מותר מדקה לפני הפתיחה עד 2 דקות קדימה (חוזה 4.8). מסודר לפי זמן.
function addEvent(list, ev, t, openAt, now) {
  if (!EVS.includes(ev)) throw fail('bad-ev');
  if (!Number.isInteger(t) || t < openAt - MIN || t > now + 2 * MIN) throw fail('bad-time');
  const l = (Array.isArray(list) ? list : []).filter(validEv).map((e) => ({ k: e.k, t: e.t }));
  if (l.length >= MAX_EV) throw fail('full');
  l.push({ k: ev, t });
  l.sort((a, b) => a.t - b.t);
  return l;
}
// דקות עבודה והפסקה ומספר הפסקות. עבודה: מ-s/r עד p/e. הפסקה: מ-p עד r/s/e. קטע פתוח בסוף – לא נספר.
function workPause(list) {
  const l = (Array.isArray(list) ? list : []).filter(validEv).slice().sort((a, b) => a.t - b.t);
  let st = 'idle', from = 0, work = 0, pause = 0, pauses = 0;
  for (const e of l) {
    if (e.k === 's' || e.k === 'r') {
      if (st === 'paused') pause += e.t - from;
      if (st !== 'work') { st = 'work'; from = e.t; }
    } else if (e.k === 'p') {
      if (st === 'work') { work += e.t - from; st = 'paused'; from = e.t; pauses++; }
    } else if (e.k === 'e') {
      if (st === 'work') work += e.t - from;
      else if (st === 'paused') pause += e.t - from;
      st = 'idle';
    }
  }
  const m = (x) => Math.min(100000, Math.round(x / MIN));
  return { work: m(work), pause: m(pause), pauses };
}

// ---------- סיום, תזכורת, איחור ----------
// הסבב הסתיים: כל מקומות הצילום צולמו, או שכל עובד עם חלק בסבב סיים (האירוע האחרון שלו = e). מקטע שלא צולם נשאר "לא צולם".
function finished(run) {
  const r = run || {};
  if (Number.isInteger(r.n) && r.n > 0 && Number.isInteger(r.nDone) && r.nDone >= r.n) return true;
  const ws = (Array.isArray(r.uids) ? r.uids : []).filter((u) => r.nUid && r.nUid[u] && r.nUid[u].n > 0);
  if (!ws.length) return false;
  return ws.every((u) => { const l = r.tlog && r.tlog[u]; return Array.isArray(l) && l.length > 0 && l[l.length - 1].k === 'e'; });
}
const closeSt = (run, now) => (now <= run.dueAt ? 'done' : 'closed');
// תזכורת: 24 שעות לפני המועד, ובסבב קצר מיומיים – באמצע הזמן
const remindAt = (run) => run.dueAt - Math.min(D1, Math.floor((run.dueAt - run.openAt) / 2));
// { st?: 'late', kind?: 'late' | 'remind' }
function timeStep(run, now) {
  const r = run || {};
  if (r.st !== 'open' || !Number.isInteger(r.dueAt) || !Number.isInteger(r.openAt)) return {};
  if (now >= r.dueAt) return { st: 'late', kind: 'late' };
  if (now >= remindAt(r)) return { kind: 'remind' };
  return {};
}
// מי עוד לא סיים את החלק שלו: יש לו מקומות שלא צולמו, והוא לא רשם סיום (האירוע האחרון ביומן שלו = e) – תיקון סבב 1
const lastIsEnd = (run, u) => { const l = run.tlog && run.tlog[u]; return Array.isArray(l) && l.length > 0 && l[l.length - 1].k === 'e'; };
const behind = (run) => (Array.isArray(run.uids) ? run.uids : []).filter((u) => { const x = run.nUid && run.nUid[u]; return x && x.n > 0 && x.d < x.n && !lastIsEnd(run, u); });
// מזהה עקיף לחלק של עובד בסבב (לרשימת "אפשר לקחת" – בלי uid של עובד אחר): 16 תווים hex מ-sha256(runId|uid)
const partKey = (runId, uid) => crypto.createHash('sha256').update(String(runId) + '|' + String(uid), 'utf8').digest('hex').slice(0, 16);
// החלקים בסבב שאפשר לקחת: { h, n (מקומות צילום), d (צולמו), bays (מספר מקטעים) }
const takeParts = (runId, run) => (Array.isArray(run.uids) ? run.uids : []).map((u) => {
  const x = (run.nUid && run.nUid[u]) || { n: 0, d: 0 };
  return { h: partKey(runId, u), n: x.n, d: x.d, bays: Array.isArray(run.asg && run.asg[u]) ? run.asg[u].length : 0 };
});

// ---------- העברה / לקיחה ----------
// מחזיר את השדות לעדכון בסבב. היומן של from נשאר (היסטוריה), אבל הוא יוצא מ-uids.
function moveRun(run, from, to) {
  const r = run || {};
  if (!r.asg || !Array.isArray(r.asg[from])) throw fail('not-in-run');
  if (from === to) throw fail('same');
  const asg = Object.assign({}, r.asg);
  const mine = asg[from];
  delete asg[from];
  asg[to] = (Array.isArray(asg[to]) ? asg[to] : []).concat(mine);
  const nUid = Object.assign({}, r.nUid);
  const a = nUid[from] || { n: 0, d: 0 }, b = nUid[to] || { n: 0, d: 0 };
  delete nUid[from];
  nUid[to] = { n: a.n + b.n, d: a.d + b.d };
  const uids = (Array.isArray(r.uids) ? r.uids : []).filter((u) => u !== from);
  if (!uids.includes(to)) uids.push(to);
  if (uids.length > MAX_W) throw fail('too-many');
  const tlog = Object.assign({}, r.tlog);
  if (!Array.isArray(tlog[to])) tlog[to] = [];
  const subFrom = Object.assign({}, r.subFrom, { [from]: to });
  if (Object.keys(tlog).length > MAX_W || Object.keys(subFrom).length > MAX_W) throw fail('too-many');
  return { asg, nUid, uids, tlog, subFrom };
}

// ---------- מה עובד רואה (חוזה 4.21) ----------
function cleanShow(show) { return new Set(['fix'].concat((Array.isArray(show) ? show : []).filter((x) => SHOW.includes(x)))); }
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k]; return r; };
// פריט ברשימת "הסבבים שלי"
function listItem(runId, run, uid) {
  return { runId, st: run.st, openAt: run.openAt, dueAt: run.dueAt, map: run.map, mapV: run.mapV, n: (run.nUid && run.nUid[uid]) || { n: 0, d: 0 } };
}
// סבב אחד לעובד: רק החלק שלו, הזמנים שלו בלבד, ותוצאות לפי show. ai = [[slot, data], ...]
function viewRun(runId, run, uid, show, ai) {
  const sh = cleanShow(show);
  const mine = new Set((run.asg && run.asg[uid]) || []);
  const pickU = (m) => (m && m[uid] !== undefined ? m[uid] : undefined);
  const out = Object.assign(listItem(runId, run, uid), {
    bays: [...mine], tlog: pickU(run.tlog) || [], work: pickU(run.work) || 0, pause: pickU(run.pause) || 0, ai: {},
  });
  for (const [slot, a] of ai || []) {
    if (!RE.slot.test(slot) || !mine.has(slot.split('_')[0]) || !a) continue;
    let r = { st: a.st, iss: (Array.isArray(a.iss) ? a.iss : []).map((i) => pick(i, ['k', 'sev', 't', 'box'])) };
    if (sh.has('score') && a.sc && Number.isInteger(a.sc.all)) r.sc = { all: a.sc.all };
    if (sh.has('recs') && Array.isArray(a.recs)) r.recs = a.recs;
    if (sh.has('full')) { r = Object.assign({}, a); delete r.tok; }
    out.ai[slot] = r;
  }
  if (run.sum && (sh.has('full') || sh.has('score'))) out.sum = sh.has('full') ? run.sum : { score: run.sum.score };
  if (sh.has('full') && Array.isArray(run.recs)) out.recs = run.recs;
  return out;
}

module.exports = {
  TZ: TK.TZ, D1, MIN, OPEN_HH, MAX_W, MAX_BAYS, MAX_EV, RE, SUBS, SHOW, EVS, LIVE,
  isRunId, cleanF, nextOpen, decideOpen, dayKey, settingsFor, cleanAsg, uidsOf, planDeparted,
  mapProblem, baysOf, splitBays, runDoc, addEvent, workPause, finished, closeSt, remindAt, timeStep, behind,
  moveRun, cleanShow, listItem, viewRun, partKey, takeParts,
};
