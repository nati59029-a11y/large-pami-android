// תוסף כספית – מכונת המצבים של ריצת סנכרון (טהורה: מקבלת מצב ומחזירה מצב חדש, בלי chrome.*).
// המצב נשמר ב-storage.local אחרי כל שלב, כך שאם Chrome סוגר את ה-service worker באמצע – ממשיכים מאותו שלב.
// שלבים: hello → login → catalog (הורדה + העלאה) → catPreview → catApply → sales (יום אחרי יום) → exportNew → exportPrice → report
// שגיאת רשת / שרת (5xx) / זמן: ניסיון חוזר אחרי 1, 4, 15 דקות (3 פעמים). אחרי זה – נכשל.
// צריך התחברות / כפתור לא נמצא / הרשאה / מגבלה – בלי ניסיון חוזר (הודעה למנהל). צריך התחברות – הבדיקה הבאה (כל 15 דקות) מנסה שוב.
(function (root) {
'use strict';
const STEPS = ['hello', 'login', 'catalog', 'catPreview', 'catApply', 'sales', 'exportNew', 'exportPrice', 'report'];
const BACKOFF = [60e3, 4 * 60e3, 15 * 60e3];
const RETRY = new Set(['network', 'timeout', 'server', 'rate', 'offline', 'stale', 'busy', 'tab']);
const STALE_MS = 6 * 3600e3; // ריצה שלא התקדמה 6 שעות – לא ממשיכים אותה, מתחילים חדשה
const LOG_MAX = 60;
const MSG = {
  ok: 'הסנכרון הצליח',
  run: 'הסנכרון רץ עכשיו',
  wait: 'תקלה זמנית – ננסה שוב בעוד כמה דקות',
  'needs-login': 'צריך להתחבר לכספית בדפדפן הזה. אחרי ההתחברות הסנכרון ימשיך לבד תוך רבע שעה.',
  'selector-miss': 'מסך בכספית השתנה ולא נמצא כפתור או שדה. נשלחה הודעה למנהל.',
  'endpoint-changed': 'הקובץ שהתקבל מכספית לא נראה כמו שציפינו. נשלחה הודעה למנהל.',
  'first-manual': 'את הסנכרון הראשון של הקטלוג עושים באפליקציה. המכירות ממשיכות להיקלט.',
  limit: 'יותר מדי שינויים בבת אחת – הסנכרון נעצר לבדיקה של המנהל.',
  auth: 'החיבור לאפליקציה בוטל או לא תקין. יש לחבר מחדש עם קוד חדש מהאפליקציה.',
  'min-ver': 'צריך לעדכן את התוסף לגרסה חדשה.',
  disabled: 'הסנכרון האוטומטי כבוי באפליקציה.',
  network: 'אין חיבור לאינטרנט או לשרת.',
  offline: 'אין חיבור לאינטרנט.',
  timeout: 'הפעולה לקחה יותר מדי זמן.',
  server: 'תקלה זמנית בשרת.',
  rate: 'יותר מדי פניות היום – ננסה מחר.',
  stale: 'הנתונים השתנו באמצע – ננסה שוב.',
  busy: 'סנכרון אחר רץ עכשיו.',
  tab: 'תקלה זמנית בלשונית של כספית.',
  parse: 'לא הצלחנו לקרוא את הקובץ מכספית.',
  fail: 'הסנכרון נכשל.',
};
function err(code, msg, extra) {
  const e = new Error(msg || MSG[code] || code);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}
const codeOf = (e) => (e && typeof e.code === 'string' ? e.code : 'fail');
function newRun(o) {
  const now = o.now;
  return { id: o.id, mode: o.mode || 'sync', manual: !!o.manual, slot: o.slot || null, st: 'run', step: STEPS[0], day: 0, days: [], attempt: 0,
    retryAt: 0, startedAt: now, touchedAt: now, err: null, flags: {}, info: {}, log: [] };
}
function push(run, rec) {
  run.log = (run.log || []).concat([rec]).slice(-LOG_MAX);
}
// השלב הצליח → השלב הבא. info נשמר תחת run.info[step]
function advance(run, now, info) {
  const r = JSON.parse(JSON.stringify(run));
  const step = r.step;
  push(r, { s: step, d: step === 'sales' ? r.days[r.day] || null : undefined, ok: true, at: now });
  if (info !== undefined) {
    if (step === 'sales') { r.info.sales = r.info.sales || {}; const d = r.days[r.day]; if (d) r.info.sales[d] = info; } else r.info[step] = info;
  }
  r.attempt = 0; r.retryAt = 0; r.err = null; r.touchedAt = now; r.st = 'run';
  if (step === 'sales' && r.day + 1 < r.days.length) { r.day++; return r; }
  let i = STEPS.indexOf(step) + 1;
  // בלי ימים להבאה – מדלגים על המכירות. בלי קטלוג (סנכרון ראשון ידני) – מדלגים על הקבצים לכספית
  for (;;) {
    const s = STEPS[i];
    if (s === 'sales' && !r.days.length) { i++; continue; }
    if ((s === 'exportNew' || s === 'exportPrice') && r.flags.noCat) { i++; continue; }
    break;
  }
  if (i >= STEPS.length) { r.st = 'ok'; r.step = 'done'; return r; }
  r.step = STEPS[i];
  if (r.step === 'sales') r.day = 0;
  return r;
}
// השלב נכשל
function fail(run, now, e) {
  const r = JSON.parse(JSON.stringify(run));
  const code = codeOf(e);
  const msg = String((e && e.message) || MSG[code] || code).slice(0, 300);
  push(r, { s: r.step, d: r.step === 'sales' ? r.days[r.day] || null : undefined, ok: false, code, msg, at: now });
  r.touchedAt = now;
  r.err = { code, msg, step: r.step };
  if (RETRY.has(code) && r.attempt < BACKOFF.length) {
    r.retryAt = now + BACKOFF[r.attempt];
    r.attempt++;
    r.st = 'wait';
    return r;
  }
  r.st = code === 'needs-login' ? 'needs-login' : 'fail';
  return r;
}
const isTerminal = (run) => !run || ['ok', 'fail', 'needs-login'].includes(run.st);
// אפשר להמשיך ריצה קיימת? ('run' = ה-service worker נסגר באמצע שלב; 'wait' = הגיע זמן הניסיון החוזר)
function canResume(run, now) {
  if (!run || isTerminal(run)) return false;
  if (now - (run.touchedAt || run.startedAt || 0) > STALE_MS) return false;
  if (run.st === 'wait') return now >= run.retryAt;
  return run.st === 'run';
}
// שלב שמתחיל מחדש אחרי הפסקה: catalog שנקטע חוזר להורדה (המידע לא נשמר), וכך גם יום מכירות שנקטע
function resumeFrom(run) {
  const r = JSON.parse(JSON.stringify(run));
  r.st = 'run';
  return r;
}
const msgOf = (code) => MSG[code] || MSG.fail;
const api = { STEPS, BACKOFF, RETRY, STALE_MS, MSG, err, codeOf, newRun, advance, fail, isTerminal, canResume, resumeFrom, msgOf };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxPlan = api;
})(typeof self !== 'undefined' ? self : this);
