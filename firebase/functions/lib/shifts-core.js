'use strict';
// משמרות (שלב 3, 18.11.2026) – ליבה טהורה, בלי Firestore. שעון ישראל דרך tk-time.js (גם במעבר לשעון קיץ/חורף).
//   הגדרת משמרת (shf/{id}): u, nm, fx (קבועה), wd (0–6, קבועה) / d ('YYYY-MM-DD', חד־פעמית), from/to (טווח הקבועה, to '' = בלי סוף),
//     s/e ('HH:MM'). e <= s = משמרת שחוצה חצות (מסתיימת למחרת). skip = תאריכים שבהם הקבועה לא חלה (רק הפעם / מחיקה של מופע),
//     of = מזהה הקבועה שמופע חד־פעמי מחליף, nt = הערה.
//   מופע: { id: '<sid>_<YYYY-MM-DD>', sid, day, s, e, u, nm, fx, nt, start, end, x (חוצה חצות) } – שייך ליום שבו הוא מתחיל.
//   חורים: טווחים בתוך שעות הפעילות של היום שאין בהם אף משמרת עם עובד (u). שעות פעילות: hrs[0..6] = { s, e } או null (סגור).

const TK = require('./tk-time');

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_SKIP = 60;
const DEF_LATE = 5;
const DEF_AT = '07:00';
const REM_MIN = 60; // תזכורת לעובד: שעה לפני תחילת המשמרת
const HOLES_WIN = 3 * 3600000; // התראת החורים נשלחת רק בשלוש השעות שאחרי שעת ההתראה (לא באמצע היום / במוצאי שבת)
const MIN_HOLE = 60000; // חור קצר מדקה – לא נחשב

const isHM = (s) => typeof s === 'string' && HM_RE.test(s);
const hmMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
// 'YYYY-MM-DD' תקין (כולל בדיקה שהתאריך קיים)
function isDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const parts = (day) => { const [y, m, d] = day.split('-').map(Number); return { y, m: m - 1, d }; };
function addDays(day, n) {
  const p = parts(day), t = new Date(Date.UTC(p.y, p.m, p.d + n));
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
}
const weekdayOf = (day) => { const p = parts(day); return new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay(); };
const todayOf = (now) => TK.dayStr(TK.ymdOf(now));
// ראשון של השבוע שבו נמצא day
const weekStart = (day) => addDays(day, -weekdayOf(day));
// 'HH:MM' בשעון ישראל של רגע t
const hmOf = (t) => { const w = TK.wall(t); return String(w.hh).padStart(2, '0') + ':' + String(w.mm).padStart(2, '0'); };

// רגעי ההתחלה והסיום של משמרת ביום day (e <= s – למחרת)
function times(day, s, e) {
  const p = parts(day), x = hmMin(e) <= hmMin(s);
  const start = TK.zoned(p.y, p.m, p.d, hmMin(s) / 60 | 0, hmMin(s) % 60);
  const end = TK.zoned(p.y, p.m, p.d + (x ? 1 : 0), hmMin(e) / 60 | 0, hmMin(e) % 60);
  return { start, end, x };
}

// האם ההגדרה חלה ביום day
function appliesOn(def, day) {
  if (!def || !isHM(def.s) || !isHM(def.e) || def.s === def.e) return false;
  if (def.fx === true) {
    if (def.wd !== weekdayOf(day)) return false;
    if (isDay(def.from) && day < def.from) return false;
    if (isDay(def.to) && day > def.to) return false;
    return !(Array.isArray(def.skip) && def.skip.includes(day));
  }
  return def.d === day;
}
function occOn(def, day) {
  const t = times(day, def.s, def.e);
  return { id: def.id + '_' + day, sid: def.id, day, s: def.s, e: def.e, u: typeof def.u === 'string' ? def.u : '', nm: typeof def.nm === 'string' ? def.nm : '',
    fx: def.fx === true, nt: typeof def.nt === 'string' ? def.nt : '', start: t.start, end: t.end, x: t.x };
}
// כל המופעים שמתחילים בימים from .. from+n-1, לפי שעת ההתחלה. defs = [{ id, ...data }]
function expand(defs, from, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = addDays(from, i);
    for (const d of defs || []) if (appliesOn(d, day)) out.push(occOn(d, day));
  }
  return out.sort((a, b) => a.start - b.start || (a.nm < b.nm ? -1 : a.nm > b.nm ? 1 : 0));
}
// מופע לפי מזהה '<sid>_<day>' (null = לא קיים: נמחק, דולג, או מחוץ לטווח)
function parseOcc(occ) {
  const m = /^([A-Za-z0-9_-]{1,40})_(\d{4}-\d{2}-\d{2})$/.exec(String(occ || ''));
  return m && isDay(m[2]) ? { sid: m[1], day: m[2] } : null;
}
function occById(defs, occ) {
  const p = parseOcc(occ);
  if (!p) return null;
  const d = (defs || []).find((x) => x.id === p.sid);
  return d && appliesOn(d, p.day) ? occOn(d, p.day) : null;
}

// שעות הפעילות של היום (רגעים), או null כשסגור / לא הוגדר
function openRange(day, hrs) {
  const h = Array.isArray(hrs) ? hrs[weekdayOf(day)] : null;
  if (!h || !isHM(h.s) || !isHM(h.e) || h.s === h.e) return null;
  const t = times(day, h.s, h.e);
  return [t.start, t.end];
}
// חורים: [[from, to]] בתוך שעות הפעילות של day, שאין בהם משמרת עם עובד. occs – מופעים (גם של אתמול, למשמרת שחוצה חצות)
function holes(day, hrs, occs) {
  const r = openRange(day, hrs);
  if (!r) return [];
  const cov = (occs || []).filter((o) => o.u && o.end > r[0] && o.start < r[1]).map((o) => [Math.max(o.start, r[0]), Math.min(o.end, r[1])]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = r[0];
  for (const [a, b] of cov) {
    if (a - at >= MIN_HOLE) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (r[1] - at >= MIN_HOLE) out.push([at, r[1]]);
  return out;
}
const holesTxt = (hs) => hs.map(([a, b]) => hmOf(a) + '–' + hmOf(b)).join(', ');

// ---------- שבת וחג: חלון שקט שמרני – מערב שבת/חג QS:00 ועד מוצאי שבת/חג QE:00 (שעון ישראל), כולל רצף של כמה ימי מנוחה ----------
const QS = 14, QE = 21;
const REM_PRE = 30 * 60000; // תזכורת שנופלת בחלון, למשמרת בתוכו: נשלחת בחצי השעה שלפני תחילת החלון
const restDay = (day) => { const p = parts(day); return TK.isRest({ y: p.y, m: p.m, d: p.d }); };
const atHM = (day, hm) => { const p = parts(day); return TK.zoned(p.y, p.m, p.d, hmMin(hm) / 60 | 0, hmMin(hm) % 60); };
function quiet(t) {
  const day = todayOf(t), hh = TK.wall(t).hh;
  if (restDay(day) && hh < QE) return true;
  return hh >= QS && restDay(addDays(day, 1));
}
// [תחילת החלון, סופו] של החלון שבו נמצא t (t בתוך חלון)
function quietWin(t) {
  const day = todayOf(t);
  const D = restDay(day) && TK.wall(t).hh < QE ? day : addDays(day, 1);
  let F = D, L = D;
  for (let i = 0; i < 10 && restDay(addDays(F, -1)); i++) F = addDays(F, -1);
  for (let i = 0; i < 10 && restDay(addDays(L, 1)); i++) L = addDays(L, 1);
  return [atHM(addDays(F, -1), String(QS).padStart(2, '0') + ':00'), atHM(L, String(QE) + ':00')];
}
// חלון השליחה של התזכורת [מ, עד): בדרך כלל השעה שלפני ההתחלה. נופלת בחלון השקט –
//   משמרת שמתחילה עד סוף החלון (שישי אחר הצהריים / שבת): לפני תחילת החלון; משמרת במוצאי שבת: מסוף החלון ועד ההתחלה.
function remWin(occ, min) {
  const r = occ.start - (min || REM_MIN) * 60000;
  const q = quiet(r) ? r : quiet(occ.start - 60000) ? occ.start - 60000 : 0;
  if (!q) return [r, occ.start];
  const [ws, we] = quietWin(q);
  if (occ.start <= we) return [Math.min(r, ws - REM_PRE), ws];
  return [we, occ.start];
}
const remDue = (occ, now, min) => { if (!occ.u || now >= occ.start || quiet(now)) return false; const [a, b] = remWin(occ, min); return now >= a && now < b; };

// ---------- "שכחת להחתים יציאה" (שלב G, 19.11.2026): ATT_AFTER אחרי סוף המשמרת, ועד ATT_MAX אחרי הסוף (לא על משמרות ישנות, למשל אחרי הפעלה מחדש).
//   סוף+15 נופל בשבת/חג – החלון מתחיל בסוף חלון השקט (מוצאי שבת 21:00) ונמשך אותו אורך. בתוך חלון השקט – לא שולחים.
const ATT_AFTER = 15 * 60000;
const ATT_MAX = 12 * 3600000;
const ATT_PRE = 12 * 3600000; // כניסה פתוחה "חופפת" למשמרת: התחילה לפני סוף המשמרת, ולא יותר מ-12 שעות לפני תחילתה (כניסה ישנה שנשכחה – לא שייכת)
function attWin(occ) {
  const a = occ.end + ATT_AFTER;
  if (!quiet(a)) return [a, occ.end + ATT_MAX];
  const we = quietWin(a)[1];
  return [we, we + ATT_MAX - ATT_AFTER];
}
const attDue = (occ, now) => { if (!occ || !occ.u || now < occ.end + ATT_AFTER || quiet(now)) return false; const [a, b] = attWin(occ); return now >= a && now < b; };
// רשומת נוכחות { in, out } – כניסה פתוחה (out ריק) שחופפת למשמרת [start, end)
const attHit = (r, start, end) => !!r && (r.out === null || r.out === undefined) && Number.isFinite(r.in) && r.in < end && r.in >= start - ATT_PRE;

// ---------- skip ("רק הפעם"): לא מוחקים תאריכים (היסטוריה והשוואת נוכחות). עד MAX_SKIP תאריכים עתידיים.
// מעל SKIP_KEEP תאריכים – תאריכים מלפני יותר משנה יוצאים, ו-from עולה לאותו יום (כדי שמופע שבוטל לא יחזור). { skip, from } או { err }
const SKIP_KEEP = 400;
function addSkip(def, day, today) {
  let skip = [...new Set((Array.isArray(def.skip) ? def.skip : []).filter(isDay).concat([day]))].sort();
  if (skip.filter((x) => x >= today).length > MAX_SKIP) return { err: true };
  let from = def.from;
  if (skip.length > SKIP_KEEP) {
    const cut = addDays(today, -366);
    skip = skip.filter((x) => x >= cut);
    if (!isDay(from) || from < cut) from = cut;
  }
  return { skip, from };
}
// המופע המקביל באותו שבוע (ראשון–שבת) ביום wd
const sameWeek = (day, wd) => addDays(weekStart(day), wd);

// ההגדרות (shfcfg/main) – תמיד מנורמלות. hrs: null = המנהל עוד לא הגדיר (אין התראת חורים)
function cfgOf(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const late = Number.isInteger(c.late) && c.late >= 0 && c.late <= 60 ? c.late : DEF_LATE;
  const at = isHM(c.at) ? c.at : DEF_AT;
  const hrs = Array.isArray(c.hrs) && c.hrs.length === 7 ? c.hrs.map((h) => (h && isHM(h.s) && isHM(h.e) && h.s !== h.e ? { s: h.s, e: h.e } : null)) : null;
  return { late, at, hrs };
}
// התראת החורים היומית: אחרי שעת ההתראה של היום, עד HOLES_WIN אחריה. { go, day, at }
function holesDue(cfg, now) {
  const day = todayOf(now), p = parts(day);
  const at = TK.zoned(p.y, p.m, p.d, hmMin(cfg.at) / 60 | 0, hmMin(cfg.at) % 60);
  return { go: !!cfg.hrs && now >= at && now < at + HOLES_WIN, day, at };
}

// ---------- בדיקת קלט (shApi) ----------
// שגיאה = { reason, msg }. מחזיר את השדות המנורמלים של ההגדרה (בלי by/at)
function normDef(x) {
  const o = x && typeof x === 'object' ? x : {};
  if (!isHM(o.s) || !isHM(o.e)) return { err: { reason: 'bad-time', msg: 'שעה לא תקינה (HH:MM)' } };
  if (o.s === o.e) return { err: { reason: 'bad-time', msg: 'שעת הסיום שווה לשעת ההתחלה' } };
  if (!isDay(o.d)) return { err: { reason: 'bad-day', msg: 'תאריך לא תקין' } };
  if (typeof o.fx !== 'boolean') return { err: { reason: 'bad-fx', msg: 'צריך לבחור: משמרת קבועה או חד־פעמית' } };
  const nt = typeof o.nt === 'string' ? o.nt.trim().slice(0, 200) : '';
  if (o.nt !== undefined && typeof o.nt !== 'string') return { err: { reason: 'bad-note', msg: 'הערה לא תקינה' } };
  const u = o.u === undefined || o.u === null ? '' : o.u;
  if (typeof u !== 'string' || (u && !/^[A-Za-z0-9_-]{1,128}$/.test(u))) return { err: { reason: 'bad-user', msg: 'עובד לא תקין' } };
  const base = { u, s: o.s, e: o.e, nt };
  return { def: o.fx ? Object.assign(base, { fx: true, wd: weekdayOf(o.d), from: o.d, to: '', skip: [] }) : Object.assign(base, { fx: false, d: o.d }) };
}
// שעות פעילות מהמנהל: 7 ימים, כל יום null (סגור) או { s, e } (e <= s = עד אחרי חצות)
function normHrs(v) {
  if (!Array.isArray(v) || v.length !== 7) return null;
  const out = [];
  for (const h of v) {
    if (h === null) { out.push(null); continue; }
    if (!h || typeof h !== 'object' || Array.isArray(h) || Object.keys(h).some((k) => k !== 's' && k !== 'e') || !isHM(h.s) || !isHM(h.e) || h.s === h.e) return null;
    out.push({ s: h.s, e: h.e });
  }
  return out;
}

module.exports = {
  HM_RE, DAY_RE, ID_RE, MAX_SKIP, DEF_LATE, DEF_AT, REM_MIN, HOLES_WIN,
  isHM, hmMin, isDay, addDays, weekdayOf, todayOf, weekStart, hmOf, times, appliesOn, occOn, expand, parseOcc, occById,
  openRange, holes, holesTxt, remDue, remWin, quiet, quietWin, ATT_AFTER, ATT_MAX, ATT_PRE, attWin, attDue, attHit, addSkip, sameWeek, SKIP_KEEP, cfgOf, holesDue, normDef, normHrs,
};
