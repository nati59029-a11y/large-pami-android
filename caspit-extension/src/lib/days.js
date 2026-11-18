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
const api = { TZ, AT, MAX_DAYS, parts, dayStr, addDays, slotDay, isDue, offset, zonedToUtc, nextAt, daysToFetch, safeDays };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxDays = api;
})(typeof self !== 'undefined' ? self : this);
