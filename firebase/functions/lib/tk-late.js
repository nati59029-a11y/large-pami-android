'use strict';
// התראת טלפון לעובד על משימה שלו שבאיחור (22.11.2026, החלטת בעל העסק) – הלוגיקה הטהורה, בלי Firestore ובלי שליחה.
// הקריאה, הסימון והשליחה – lateAll ב-recurring.js (רץ בתוך הפונקציה המתוזמנת recurringTasks, פעם ב-15 דקות).
//   "באיחור" = משימה פתוחה (st 'open') שהיעד בפועל שלה עבר – tk-time.js tkLateAt/tkDl, בדיוק כמו tkDl/tkLateNow באפליקציה
//   (dl>0 – יעד שנקבע; dl===0 – בלי יעד, לעולם לא באיחור; אחרת due).
//   לא על משימה שבאיחור יותר מ-MAX_AGE (30 יום) – כדי לא להציף בהפעלה הראשונה.
//   נמענים: ow (המטפל), ואם אין – to (עד 30). רק מי ש-ok(uid) מאשר (עובד פעיל, לא מנהל־על – נבדק ב-recurring.js).
//   פעם אחת לכל משימה ולכל נמען: marks = Map(taskId → Set(uid שכבר קיבלו)) – fn_rate/tkLate_<taskId> בתוך העסק (רק השרת כותב).
//   התראה אחת לכל עובד בריצה (מאוגדת), עד MAX_USERS עובדים לעסק בריצה. השאר – בריצה הבאה (לא סומנו).
//   שקט: שבת/חג (tk-time.js quietAt – כמו התראות המשימות ב-tasks-push.js) ושעות הלילה (NIGHT_FROM–NIGHT_TO, שעון ישראל).
//   בשקט לא נשלח ולא מסומן כלום – ההתראה יוצאת בסוף השקט (אם המשימה עדיין פתוחה ובאיחור).
const TK = require('./tk-time');

const MAX_AGE = 30 * 864e5;
const MAX_USERS = 20;
const MAX_TO = 30;
const NIGHT_FROM = 22; // 22:00–07:00 – כמו ברירת המחדל של השעות השקטות של המזכירה (sec-remind.js DEF.q)
const NIGHT_TO = 7;
const BODY = 400;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const isId = (u) => typeof u === 'string' && ID_RE.test(u);
const clean = (v) => String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// שעות הלילה בשעון ישראל
function night(now) { const h = TK.wall(now).hh; return h >= NIGHT_FROM || h < NIGHT_TO; }
// לא שולחים עכשיו: שבת/חג או לילה
function quiet(now) { return TK.quietAt(now) || night(now); }

// מי מטפל: ow, אחרת to (כמו tkNudge)
function recips(t) {
  if (isId(t.ow)) return [t.ow];
  return Array.isArray(t.to) ? [...new Set(t.to.filter(isId))].slice(0, MAX_TO) : [];
}

// משימה מועמדת: באיחור עכשיו, היעד בתוך 30 הימים האחרונים, ויש לה נמען. מחזיר את היעד (מספר) או 0
function lateDl(t, now) {
  if (!t || !TK.tkLateAt(t, now)) return 0;
  const d = +TK.tkDl(t);
  if (now - d > MAX_AGE) return 0;
  return recips(t).length ? d : 0;
}

// הבחירה. tasks = [{ id, ...שדות המשימה }], marks = Map(id → Set(uid)), ok = (uid) → boolean.
// מחזיר { users: [{ uid, tasks: [{ id, txt, dl }] }], marks: [{ id, u: [uid חדשים] }] }.
// הסדר: המשימה הישנה ביותר (יעד מוקדם) קודם; העובדים לפי סדר ההופעה; עד MAX_USERS עובדים.
function pick(tasks, marks, now, ok) {
  const M = marks || new Map();
  const okf = typeof ok === 'function' ? ok : () => true;
  const L = (tasks || []).map((t) => ({ t, dl: lateDl(t, now) })).filter((x) => x.dl && isId(x.t.id))
    .sort((a, b) => a.dl - b.dl || (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0));
  const G = new Map(); // uid → tasks
  const add = new Map(); // taskId → [uid]
  for (const { t, dl } of L) {
    const had = M.get(t.id) || new Set();
    for (const u of recips(t)) {
      if (had.has(u) || !okf(u)) continue;
      if (!G.has(u)) { if (G.size >= MAX_USERS) continue; G.set(u, []); }
      G.get(u).push({ id: t.id, txt: clean(t.txt), dl });
      if (!add.has(t.id)) add.set(t.id, []);
      add.get(t.id).push(u);
    }
  }
  return { users: [...G].map(([uid, ts]) => ({ uid, tasks: ts })), marks: [...add].map(([id, u]) => ({ id, u })) };
}

// הטקסט. אחת: "יש לך משימה באיחור" + הטקסט; כמה: "יש לך N משימות באיחור" + עד 3 טקסטים
function msgOf(ts) {
  const n = ts.length;
  if (n === 1) return { title: 'יש לך משימה באיחור', body: cut(ts[0].txt, BODY) || 'פרטים באפליקציה' };
  const top = ts.slice(0, 3).map((x) => cut(x.txt, 80)).filter(Boolean);
  const body = top.length ? top.join(' · ') + (n > top.length ? ' ועוד ' + (n - top.length) : '') : 'פרטים באפליקציה';
  return { title: 'יש לך ' + n + ' משימות באיחור', body: cut(body, BODY) };
}

// מזהה מסמך הסימון (בתוך העסק): fn_rate/tkLate_<taskId>
const markId = (taskId) => 'tkLate_' + taskId;

module.exports = { MAX_AGE, MAX_USERS, NIGHT_FROM, NIGHT_TO, night, quiet, recips, lateDl, pick, msgOf, markId };
