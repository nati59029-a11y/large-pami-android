'use strict';
// משימות קבועות (12.11.2026): חישובי זמן בשעון ישראל, בלי תלות באזור הזמן של השרת.
//   tkBiz(ymd)      – יום עסקים? (ראשון–חמישי, בלי יום טוב, חול המועד, ערבי חג, פורים ותשעה באב). זהה ל-tkBiz באפליקציה.
//   tkDue(t)        – 72 שעות של ימי עסקים מרגע t. זהה ל-tkDue באפליקציה (index.html) כשהטלפון בשעון ישראל.
//   decide(rule, now) – פונקציה טהורה: האם כלל קבוע צריך לפתוח משימה עכשיו, ומה מפתח היום.
// הערה: האפליקציה מחשבת לפי השעון המקומי של הטלפון. כאן "מקומי" = Asia/Jerusalem תמיד (Intl), כך שהתוצאה זהה גם כשהשרת ב-UTC.
// tkDue חייב לתת בדיוק את אותו ערך כמו באפליקציה: סימון "באיחור" בחוקים נבדק מול due של המשימה.

const TZ = 'Asia/Jerusalem';
// העתק מדויק של TK_OFF באפליקציה (לוח החגים של המשימות)
const TK_OFF = { Elul: [29], Tishri: [1, 2, 9, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22], Nisan: [14, 15, 16, 17, 18, 19, 20, 21], Sivan: [5, 6] };
// התאריך העברי של יום גרגוריאני: מחשבים על 12:00 UTC של אותו יום, עם timeZone UTC – אותו יום עברי כמו 12:00 מקומי באפליקציה
const HEB = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const PARTS = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// שעון קיר בישראל ברגע t: { y, m (0–11), d, wd (0=ראשון), hh, mm, ss }
function wall(t) {
  const o = {};
  for (const p of PARTS.formatToParts(new Date(t))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month - 1, d: +o.day, wd: WD[o.weekday], hh: +o.hour % 24, mm: +o.minute, ss: +o.second };
}
// ההפרש בין שעון ישראל ל-UTC ברגע t (במילישניות)
function offsetAt(t) {
  const w = wall(t);
  return Date.UTC(w.y, w.m, w.d, w.hh, w.mm, w.ss) - Math.floor(t / 1000) * 1000;
}
// הרגע (epoch) שבו השעון בישראל מראה y-m-d hh:mm (m 0–11, מותר גלישה: d+1 בסוף חודש וכו').
// כמו new Date(y, m, d, hh, mm) בטלפון בשעון ישראל: שעה שלא קיימת (מעבר לשעון קיץ) – קדימה; שעה כפולה (מעבר לחורף) – הראשונה.
function zoned(y, m, d, hh, mm) {
  const u = Date.UTC(y, m, d, hh || 0, mm || 0);
  const o1 = offsetAt(u - 3 * 3600000), o2 = offsetAt(u + 3 * 3600000); // ההפרש לפני ואחרי (מעבר שעון אחד לכל היותר בחלון)
  const a = u - o1, b = u - o2;
  const ok = (t) => { const w = wall(t), n = new Date(u); return w.y === n.getUTCFullYear() && w.m === n.getUTCMonth() && w.d === n.getUTCDate() && w.hh === n.getUTCHours() && w.mm === n.getUTCMinutes(); };
  if (ok(a) && ok(b)) return Math.min(a, b);   // שעה כפולה – הראשונה
  if (ok(a)) return a;
  if (ok(b)) return b;
  return u - Math.min(o1, o2);                  // שעה שלא קיימת – קדימה (כמו Date בדפדפן)
}

const ymdOf = (t) => { const w = wall(t); return { y: w.y, m: w.m, d: w.d }; };
const keyOf = (o) => o.y + '-' + o.m + '-' + o.d;
const dayStr = (o) => o.y + '-' + String(o.m + 1).padStart(2, '0') + '-' + String(o.d).padStart(2, '0');
const weekday = (o) => new Date(Date.UTC(o.y, o.m, o.d)).getUTCDay();

// חג / חול המועד / ערב חג / פורים / תשעה באב – בלי קשר ליום בשבוע (החלק ה"עברי" של tkBiz)
const HC = {};
function isHoliday(o) {
  const k = keyOf(o);
  if (k in HC) return HC[k];
  let h = false;
  try {
    const p = HEB.formatToParts(new Date(Date.UTC(o.y, o.m, o.d, 12)));
    const m = (p.find((x) => x.type === 'month') || {}).value, dd = +((p.find((x) => x.type === 'day') || {}).value);
    if ((TK_OFF[m] || []).includes(dd)) h = true;
    if (((m === 'Adar' || m === 'Adar II') && dd === 14) || (m === 'Av' && (dd === 9 || (dd === 10 && weekday(o) === 0)))) h = true;
  } catch (e) { /* כמו באפליקציה: כשל בלוח העברי = לא חג */ }
  return (HC[k] = h);
}
// יום עסקים – בדיוק כמו tkBiz באפליקציה
function tkBiz(o) { return weekday(o) <= 4 && !isHoliday(o); }

// 72 שעות של ימי עסקים מרגע t – אותה לולאה כמו באפליקציה, עם "חצות של מחר" בשעון ישראל
function tkDue(t) {
  let rem = 72 * 36e5, x = t;
  for (let i = 0; i < 400; i++) {
    const o = ymdOf(x), nx = zoned(o.y, o.m, o.d + 1, 0, 0);
    if (tkBiz(o)) { const k = Math.min(rem, nx - x); rem -= k; if (rem <= 0) return x + k; }
    x = nx;
  }
  return x;
}

const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// האם היום מתאים לכלל (לפי התדירות ו-hol), בלי קשר לשעה
function dayMatches(rule, o) {
  const wd = weekday(o), hol = rule.hol !== false;
  if (hol && isHoliday(o)) return false;
  if (rule.fq === 'd') return wd <= 4;
  if (rule.fq === 'w') return Array.isArray(rule.wd) && rule.wd.includes(wd) && wd <= 5;
  if (rule.fq === 'm') { const md = +rule.md; if (!(md >= 1 && md <= 31)) return false; return o.d === Math.min(md, daysIn(o.y, o.m)); }
  return false;
}

// decide: { go, day ('YYYY-MM-DD'), key ('YYYYMMDD'), at (רגע המועד היום), why }
// go = true רק אם: הכלל פעיל, היום מתאים, השעה hh:mm כבר הגיעה, המועד של היום לא לפני העריכה האחרונה (ed), ועוד לא נפתחה היום (last).
function decide(rule, now) {
  const o = ymdOf(now), day = dayStr(o), key = day.replace(/-/g, '');
  const r = rule || {};
  const out = (go, why, at) => ({ go, day, key, at: at || 0, why });
  if (r.on !== true) return out(false, 'off');
  const hh = +r.hh, mm = +r.mm;
  if (!Number.isInteger(hh) || hh < 0 || hh > 23 || !Number.isInteger(mm) || mm < 0 || mm > 59) return out(false, 'bad-time');
  if (!dayMatches(r, o)) return out(false, 'day');
  const at = zoned(o.y, o.m, o.d, hh, mm);
  if (now < at) return out(false, 'early', at);
  if (typeof r.ed === 'number' && at < r.ed) return out(false, 'before-edit', at);
  if (r.last === day) return out(false, 'done-today', at);
  return out(true, 'go', at);
}

// המועד הבא (לתצוגה/בדיקות): הרגע הראשון אחרי from שבו decide יחזיר go (עד 400 יום קדימה). 0 = אין.
function nextAt(rule, from) {
  const r = Object.assign({}, rule, { last: '' });
  const o = ymdOf(from);
  for (let i = 0; i < 400; i++) {
    const at = zoned(o.y, o.m, o.d + i, +r.hh, +r.mm);
    const t = Math.max(at, from);
    const d = decide(r, t);
    if (d.go) return d.at;
  }
  return 0;
}

module.exports = { TZ, TK_OFF, wall, zoned, tkBiz, isHoliday, tkDue, dayMatches, decide, nextAt, dayStr, ymdOf };
