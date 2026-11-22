// תוסף כספית – תאריכים ושעות (טהור, בלי chrome.*). כל החישובים לפי אזור הזמן של העסק (ברירת מחדל Asia/Jerusalem),
// ולא לפי השעון של המחשב – כך מחשב שמכוון לאזור זמן אחר, ומעבר שעון קיץ/חורף, לא משנים את שעת הסנכרון.
//   isDue(now, at, lastOkDay, tz): האם צריך להריץ עכשיו. "יום היעד" = היום אם כבר עברה השעה at, אחרת אתמול.
//     מריצים אם הריצה המוצלחת האחרונה (lastOkDay = יום היעד שלה) מוקדמת מיום היעד הנוכחי.
//   nextAt(now, at, tz): הרגע הבא (ms) שבו השעה המקומית היא at.
//   daysToFetch / safeDays: אילו ימי מכירות להביא – רק ימים שלמים (עד אתמול), לא יותר מ-14 ימים אחורה, אף פעם לא היום.
(function (root) {
'use strict';
const TZ = 'Asia/Jerusalem';
const AT = '03:00';
const MAX_DAYS = 14;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmts = new Map();
function fmt(tz) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmts.set(tz, f);
  }
  return f;
}
// חלקי התאריך והשעה ב-tz
function parts(ms, tz) {
  const o = {};
  for (const p of fmt(tz || TZ).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = +p.value;
  if (o.hour === 24) o.hour = 0;
  return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}
const p2 = (n) => String(n).padStart(2, '0');
const dayStr = (ms, tz) => { const p = parts(ms, tz); return `${p.y}-${p2(p.m)}-${p2(p.d)}`; };
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
function hm(at) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(at || AT));
  if (!m || +m[1] > 23 || +m[2] > 59) return [3, 0];
  return [+m[1], +m[2]];
}
// יום היעד: היום אם השעה המקומית כבר at או אחריה, אחרת אתמול
function slotDay(now, at, tz) {
  const p = parts(now, tz), [H, M] = hm(at);
  const today = `${p.y}-${p2(p.m)}-${p2(p.d)}`;
  return p.h * 60 + p.mi >= H * 60 + M ? today : addDays(today, -1);
}
function isDue(now, at, lastOkDay, tz) {
  if (!lastOkDay || !DAY_RE.test(lastOkDay)) return true;
  return lastOkDay < slotDay(now, at, tz);
}
// הפרש (ms) בין השעה המקומית ב-tz ל-UTC ברגע t
function offset(t, tz) {
  const p = parts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}
// היום day בשעה המקומית at ב-tz → ms (UTC). שעה שלא קיימת (מעבר לשעון קיץ) – נדחית קדימה בהפרש.
function zonedToUtc(day, at, tz) {
  const [y, m, d] = day.split('-').map(Number), [H, M] = hm(at);
  const guess = Date.UTC(y, m - 1, d, H, M);
  let t = guess - offset(guess, tz);
  const o2 = offset(t, tz);
  if (o2 !== guess - t) t = guess - o2;
  return t;
}
function nextAt(now, at, tz) {
  const today = dayStr(now, tz);
  for (let k = 0; k < 3; k++) {
    const t = zonedToUtc(addDays(today, k), at, tz);
    if (t > now) return t;
  }
  return now + 864e5;
}
// ימים להבאה: מהיום שאחרי lastSales ועד אתמול. בלי lastSales – רק אתמול. לכל היותר max ימים אחורה.
function daysToFetch(lastSales, today, max) {
  const n = max || MAX_DAYS, min = addDays(today, -n);
  let d = lastSales && DAY_RE.test(lastSales) ? addDays(lastSales, 1) : addDays(today, -1);
  if (d < min) d = min;
  const out = [];
  for (; d < today; d = addDays(d, 1)) out.push(d);
  return out;
}
// רשימת ימים מהשרת – רק תאריכים תקינים, לפני היום, לא יותר מ-max אחורה, בלי כפולים, מהישן לחדש
function safeDays(list, today, max) {
  const n = max || MAX_DAYS, min = addDays(today, -n);
  const s = new Set((Array.isArray(list) ? list : []).filter((d) => typeof d === 'string' && DAY_RE.test(d) && d < today && d >= min && addDays(d, 0) === d));
  return [...s].sort();
}
// ---------- מכירות היום כל שעה (0.1.10) ----------
// שבת וחג – כמו בשרת (functions/lib/tk-time.js isRest, functions/lib/shifts-core.js quiet): יום מנוחה = שבת, או יום טוב
// (ראש השנה א'–ב', כיפור, סוכות, שמיני עצרת, פסח א' וז', שבועות). חלון שקט: מערב שבת/חג 14:00 ועד מוצאי שבת/חג 21:00 (לפי tz).
// כשל בלוח העברי של הדפדפן = לא חג (שבת – תמיד).
const YT = { Tishri: [1, 2, 10, 15, 22], Nisan: [15, 21], Sivan: [6] };
const QS = 14, QE = 21;
let HEB = null;
function restDay(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  if (t.getUTCDay() === 6) return true;
  try {
    HEB = HEB || new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'UTC', day: 'numeric', month: 'long' });
    const p = HEB.formatToParts(t);
    const mo = (p.find((x) => x.type === 'month') || {}).value, dd = +((p.find((x) => x.type === 'day') || {}).value);
    return (YT[mo] || []).includes(dd);
  } catch (e) { return false; }
}
function quiet(now, tz) {
  const day = dayStr(now, tz), h = parts(now, tz).h;
  if (restDay(day) && h < QE) return true;
  return h >= QS && restDay(addDays(day, 1));
}
// השעה העגולה הנוכחית כמזהה 'YYYY-MM-DD HH' – רק בין from ל-to (כולל, שעון tz) ולא בחלון השקט; אחרת null
function hourSlot(now, tz, from, to) {
  const p = parts(now, tz);
  if (p.h < from || p.h > to || quiet(now, tz)) return null;
  return `${p.y}-${p2(p.m)}-${p2(p.d)} ${p2(p.h)}`;
}
// שעות העובדים במשך היום (0.1.14; 0.1.15 – 07:00–23:00): חצי השעה הנוכחית כמזהה 'YYYY-MM-DD HH:MM' (MM = 00 / 30) – רק מ-from עד to (דקות מחצות, כולל, שעון tz)
// ולא בחלון השקט (שבת וחג); אחרת null
function halfSlot(now, tz, from, to) {
  const p = parts(now, tz), m = p.h * 60 + p.mi, s = p.h * 60 + (p.mi < 30 ? 0 : 30);
  if (m < from || s > to || quiet(now, tz)) return null;
  return `${p.y}-${p2(p.m)}-${p2(p.d)} ${p2(p.h)}:${p.mi < 30 ? '00' : '30'}`;
}
const nextHalf = (now) => Math.floor(now / 1800e3) * 1800e3 + 1800e3;
// השעה העגולה הבאה (בישראל ההפרש מ-UTC הוא שעות שלמות – גם בשעון קיץ)
const nextHour = (now) => Math.floor(now / 3600e3) * 3600e3 + 3600e3;
const hmOf = (now, tz) => { const p = parts(now, tz); return `${p2(p.h)}:${p2(p.mi)}`; };
const api = { TZ, AT, MAX_DAYS, parts, dayStr, addDays, slotDay, isDue, offset, zonedToUtc, nextAt, daysToFetch, safeDays, restDay, quiet, hourSlot, nextHour, hmOf, halfSlot, nextHalf };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxDays = api;
})(typeof self !== 'undefined' ? self : this);
