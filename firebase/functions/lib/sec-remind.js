'use strict';
// המזכירה – שלב 4: לוגיקה טהורה לתזכורות, שעות שקטות, ימי עסקים ודוחות (אפיון 6.4, 7.2–7.4, 9.5; החלטות 55, 66–69, 74–77).
// בלי קריאה ל-Firestore ובלי שליחה – רק חישובים. הקריאה, הכתיבה והשליחה – ב-secretary-remind.js.
const K = require('./sec-know');   // bizDay, addDays, nextBizDay – אותו כלל ימי עסקים כמו tkBiz באפליקציה (7.4)
const ST = require('./sec-tools'); // ideas, forecast – אותם חישובים כמו בצ'אט

const TZ = 'Asia/Jerusalem';
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const rnd = (x) => Math.round((+x || 0) * 100) / 100;
const ils = (n) => (Math.round(n) === n ? n : rnd(n)).toLocaleString('he-IL') + ' ₪';

// ---------- זמן בשעון ישראל ----------
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function il(ms) {
  const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute, wd: WD[p.weekday], mon: p.year + '-' + p.month };
}
// יום ושעה בשעון ישראל ← רגע (ms). שני סבבים מספיקים גם במעבר שעון
function ilMs(day, hm) {
  const [y, m, d] = day.split('-').map(Number), [h, mi] = (hm || '00:00').split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = il(t), [py, pm, pd] = p.day.split('-').map(Number), [ph, pmi] = p.hm.split(':').map(Number);
    const got = Date.UTC(py, pm - 1, pd, ph, pmi);
    if (got === want) return t;
    t += want - got;
  }
  return t;
}
const wdOf = (day) => new Date(day + 'T12:00:00Z').getUTCDay();
const bizOnOrAfter = (day) => (K.bizDay(day) ? day : K.nextBizDay(day));
function prevBizDay(day) { let d = day; for (let i = 0; i < 30; i++) { d = K.addDays(d, -1); if (K.bizDay(d)) return d; } return d; }
const MORNING = '08:00'; // "בבוקר" (7.4): תזכורת אוטומטית שנפלה ביום שאינו יום עסקים יוצאת ביום העסקים הבא ב-08:00
const nextBizMorning = (ms) => ilMs(K.nextBizDay(il(ms).day), MORNING);

// ---------- הגדרות ההתראות של מנהל (אישיות, sec_cfg/main.mgr.<uid>.nt) ----------
// 77: קבוצת ליבה פעילה כברירת מחדל, מתג לכל סוג. "emp" = התראה מיידית על עובד (61) – פעילה רק כשמתג ניתוח העובדים של העסק פעיל.
const TYPES = Object.freeze({
  invDue: { l: 'חשבונית לתשלום', on: true },
  invLate: { l: 'חשבוניות באיחור (בדוח השבועי)', on: true },
  chk: { l: 'צ\'ק שעומד להיפרע', on: true },
  task: { l: 'משימות שעברו את הזמן', on: false },
  close: { l: 'סגירת קופה חסרה או עם הפרש', on: false },
  backup: { l: 'גיבוי ישן', on: false },
  fact: { l: 'עובדה במידע על העסק שפגה', on: false },
  cal: { l: 'אירועים ותזכורות מהיומן', on: true },
  emp: { l: 'התראה מיידית על עובד', on: true },
  inv: { l: 'חשבוניות שהתקבלו ומחכות', on: true },          // שלב 8 (7.3): sec_inv – פעם ביום אם יש
  win: { l: 'הודעה שלא נענתה – חלון 24 השעות נסגר', on: true }, // שלב 8 (7.3): sec_in – שעתיים לפני סוף החלון
});
// משימות וחשבוניות שמחכות – הודעה מקובצת אחת ביום (7.3), כך שחזרה מיותרת; התראה על עובד וחלון 24 השעות – פעם אחת (אחרי החלון אין למה לחזור)
const NO_REPEAT = ['task', 'emp', 'inv', 'win'];
const DEF = Object.freeze({ wd: 0, wh: 8, md: 0, mh: 8, dg: false, dh: 8, q: { on: true, f: '22:00', t: '07:00' }, reps: 3 });
function ntOf(me) {
  const x = me && me.nt && typeof me.nt === 'object' ? me.nt : {};
  const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const q = x.q && typeof x.q === 'object' ? x.q : {};
  const rt = {};
  for (const [k, v] of Object.entries(TYPES)) rt[k] = x.rt && typeof x.rt[k] === 'boolean' ? x.rt[k] : v.on;
  return {
    wd: int(x.wd, 0, 6, DEF.wd), wh: int(x.wh, 0, 23, DEF.wh), md: int(x.md, 0, 31, DEF.md), mh: int(x.mh, 0, 23, DEF.mh),
    dg: x.dg === true, dh: int(x.dh, 0, 23, DEF.dh),
    q: { on: typeof q.on === 'boolean' ? q.on : DEF.q.on, f: HM_RE.test(q.f) ? q.f : DEF.q.f, t: HM_RE.test(q.t) ? q.t : DEF.q.t },
    reps: int(x.reps, 0, 3, DEF.reps), rt,
  };
}
// קלט מהאפליקציה (secPrefs op:'notify') – בדיקה מחמירה; שדה שלא נשלח – נשאר כמו שהיה
function readNt(input, cur) {
  const o = JSON.parse(JSON.stringify(cur));
  const bad = (m) => { const e = new Error(m); e.badNt = true; throw e; };
  const int = (k, lo, hi) => { if (input[k] === undefined) return; if (!Number.isInteger(input[k]) || input[k] < lo || input[k] > hi) bad(k); o[k] = input[k]; };
  int('wd', 0, 6); int('wh', 0, 23); int('md', 0, 31); // md: יום בחודש לדוח החודשי (0 = יום העסקים הראשון)
  int('mh', 0, 23); int('dh', 0, 23); int('reps', 0, 3);
  if (input.dg !== undefined) { if (typeof input.dg !== 'boolean') bad('dg'); o.dg = input.dg; }
  if (input.q !== undefined) {
    const q = input.q;
    if (!q || typeof q !== 'object' || Array.isArray(q) || typeof q.on !== 'boolean' || !HM_RE.test(q.f) || !HM_RE.test(q.t) || q.f === q.t) bad('q');
    o.q = { on: q.on, f: q.f, t: q.t };
  }
  if (input.rt !== undefined) {
    const r = input.rt;
    if (!r || typeof r !== 'object' || Array.isArray(r)) bad('rt');
    for (const [k, v] of Object.entries(r)) { if (!TYPES[k] || typeof v !== 'boolean') bad('rt'); o.rt[k] = v; }
  }
  return o;
}
// אזהרה בזמן הבחירה (6.4): יום דוח שבועי בשישי/שבת – "הדוח יופיע ביום העסקים הבא"
const wkWarn = (wd) => (wd === 5 || wd === 6 ? 'הדוח יופיע ביום העסקים הבא' : '');

// ---------- שעות שקטות (74): התראת טלפון שנופלת בהן מחכה לסופן ----------
function inQuiet(hm, q) {
  if (!q || !q.on || q.f === q.t) return false;
  return q.f < q.t ? hm >= q.f && hm < q.t : hm >= q.f || hm < q.t;
}
function pushAtOf(ms, q) {
  const p = il(ms);
  if (!inQuiet(p.hm, q)) return ms;
  const day = p.hm < q.t ? p.day : K.addDays(p.day, 1);
  return ilMs(day, q.t);
}

// ---------- סגירת קופה: הפרש המזומן (כמו zcCalc באפליקציה: |מזומן בסגירה − סה"כ בפתיחה|) ----------
const numOf = (v) => { const s = String(v == null ? '' : v).replace(/[\s,₪]/g, ''); if (!s) return null; const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
function cashDiff(c) {
  let f = {};
  try { const j = JSON.parse(typeof c.data === 'string' && c.data.length < 20001 ? c.data : '{}'); f = j && j.f && typeof j.f === 'object' ? j.f : {}; } catch (e) { f = {}; }
  const a = numOf(f.drawer), b = numOf(f.oTot);
  return a === null || b === null ? null : rnd(Math.abs(a - b));
}
const EMP_MIN = 1; // הפרש מזומן מ-1 ₪ ומעלה – התראה על עובד (הנחה; פחות מזה – עיגול)

// ---------- תזכורות אוטומטיות מהנתונים (7.3) ----------
// כל מועמד: { typ, key (קבוע – מונע כפילות), title, body (באפליקציה בלבד), fire (היום שבו יוצאת) }.
// fire תמיד יום עסקים: מה שנפל בשישי/שבת/חג – ביום העסקים הבא (7.4). מועמד נוצר כשהיום ≥ fire ובתוך חלון השלמה קצר.
const CATCH_DAYS = 7;
const chkItem = (r) => 'chk:' + r[0] + '|' + r[1] + '|' + r[2];
// הפריטים שקיימים כרגע במראה (חשבונית פתוחה עם יתרה, צ'ק) – תזכורת נסגרת רק כשהפריט שלה באמת נעלם (תיקון סבב 1)
function finItems(fin) { const S = new Set(); for (const r of fin.open || []) if (r[5] > 0.004) S.add('inv:' + r[0] + '|' + r[1]); for (const r of fin.chk || []) S.add(chkItem(r)); return S; }
const notRej = (c) => c && c.st !== 'rej'; // סגירה שהמנהל דחה (כפולה/שגויה) לא נספרת – תיקון סבב 1
const within = (today, fire, last) => today >= fire && today <= (last || K.addDays(fire, CATCH_DAYS));
function finCands(fin, today, rt) {
  const out = [];
  if (!fin) return out;
  if (rt.invDue) {
    for (const r of fin.open || []) {
      const due = r[3], bal = r[5];
      if (!due || !(bal > 0.004)) continue;
      const id = r[0] + '|' + r[1] + '|' + due, item = 'inv:' + r[0] + '|' + r[1];
      const pre = prevBizDay(due);
      if (within(today, pre, K.addDays(due, -1))) out.push({ typ: 'invDue', key: 'invDue:pre:' + id, item, title: 'חשבונית לתשלום מחר', body: 'חשבונית ' + (r[1] || '') + ' של ' + (r[0] || 'ספק') + ' – יתרה ' + ils(bal) + ', לתשלום עד ' + due + '.', fire: pre });
      const onDue = bizOnOrAfter(due);
      if (within(today, onDue)) out.push({ typ: 'invDue', key: 'invDue:due:' + id, item, title: 'חשבונית לתשלום היום', body: 'חשבונית ' + (r[1] || '') + ' של ' + (r[0] || 'ספק') + ' – יתרה ' + ils(bal) + ', מועד התשלום ' + due + (onDue !== due ? ' (נפל ביום שאינו יום עסקים)' : '') + '.', fire: onDue });
    }
  }
  if (rt.chk) {
    for (const r of fin.chk || []) {
      const d = r[0];
      const fire = bizOnOrAfter(prevBizDay(prevBizDay(d)));
      if (within(today, fire, d)) out.push({ typ: 'chk', key: 'chk:' + d + '|' + r[1] + '|' + r[2], item: chkItem(r), title: 'צ\'ק שעומד להיפרע', body: 'צ\'ק ל' + (r[1] || 'מוטב') + ' על ' + ils(Math.abs(r[2])) + ' ייפרע ב-' + d + '.', fire });
    }
  }
  return out;
}
function taskCands(tasks, names, now, today) {
  const late = tasks.filter((t) => t.st === 'open' && +t.due && +t.due < now);
  if (!late.length) return [];
  const who = (t) => names[t.ow] || names[t.owner] || '';
  const lines = late.slice(0, 10).map((t) => '• ' + String(t.txt || '').slice(0, 60) + (who(t) ? ' (' + who(t) + ')' : ''));
  return [{ typ: 'task', key: 'task:' + today, title: late.length + ' משימות פתוחות עברו את הזמן', body: lines.join('\n') + (late.length > 10 ? '\nועוד ' + (late.length - 10) + '.' : ''), fire: today }];
}
// סגירות: יום העסקים הקודם – קופה שנסגרה ב-30 הימים האחרונים ולא נסגרה בו ("חסרה"), או סגירה עם הפרש מזומן
function closeCands(closings0, today) {
  const closings = closings0.filter(notRej);
  const P = prevBizDay(today);
  const regs = [...new Set(closings.filter((c) => typeof c.reg === 'string' && c.d >= K.addDays(today, -30)).map((c) => c.reg))];
  const onP = closings.filter((c) => c.d === P);
  const missing = regs.filter((g) => !onP.some((c) => c.reg === g));
  const diffs = onP.map((c) => ({ c, a: cashDiff(c) })).filter((x) => x.a !== null && x.a >= EMP_MIN);
  if (!missing.length && !diffs.length) return [];
  const lines = missing.map((g) => '• קופה ' + g + ': לא נשלחה סגירה').concat(diffs.map((x) => '• קופה ' + (x.c.reg || '') + ': הפרש מזומן ' + ils(x.a)));
  return [{ typ: 'close', key: 'close:' + P, title: 'סגירות קופה של ' + P, body: lines.join('\n'), fire: today }];
}
function backupCands(statuses, now, today) {
  const out = [];
  for (const s of statuses) {
    const at = Date.parse(s.lastBackupAt || '');
    if (!Number.isFinite(at) || now - at <= 3 * 864e5) continue;
    out.push({ typ: 'backup', key: 'backup:' + s.id + ':' + il(at).day, title: 'גיבוי ישן', body: 'הגיבוי האחרון' + (s.device ? ' מ-' + String(s.device).slice(0, 40) : '') + ' נעשה ב-' + il(at).day + ' – לפני יותר מ-3 ימים.', fire: today });
  }
  return out;
}
function factCands(facts, today) {
  return facts.filter((f) => f.st === 'ok' && typeof f.exp === 'string' && f.exp <= today)
    .map((f) => ({ typ: 'fact', key: 'fact:' + f.id + ':' + f.exp, title: 'עובדה במידע על העסק פגה', body: '"' + String(f.text || '').slice(0, 120) + '" – בתוקף עד ' + f.exp + '. כדאי לעדכן או למחוק.', fire: bizOnOrAfter(f.exp) }))
    .filter((c) => c.fire <= today);
}
// ---------- שלב 8: חשבוניות שהתקבלו ומחכות (sec_inv, 7.3 – "פעם ביום אם יש") ----------
// items: רשומות sec_inv במצב 'new' (ממתינות לאישור המנהל). brs: מערך סניפים של מנהל עם הגבלת סניפים (null = כל העסק) – רואה רק את הסניפים שלו, כמו ב-secInv.
const INV_WAIT = ['new'];
function invCands(items, today, brs) {
  const L = (items || []).filter((x) => x && INV_WAIT.includes(x.st) && (!brs || (typeof x.br === 'string' && !!x.br && brs.includes(x.br))));
  if (!L.length) return [];
  const old = L.reduce((a, x) => Math.min(a, Number(x.t) || Infinity), Infinity);
  const nm = (x) => String((x.f && x.f.supplier) || x.subN || '').slice(0, 40);
  const lines = L.slice(0, 5).map((x) => '• ' + (nm(x) || 'שולח לא מזוהה') + (x.f && typeof x.f.total === 'number' ? ' – ' + ils(x.f.total) : ''));
  return [{ typ: 'inv', key: 'inv:' + today, title: L.length === 1 ? 'חשבונית אחת מחכה לאישור' : L.length + ' חשבוניות מחכות לאישור',
    body: lines.join('\n') + (L.length > 5 ? '\nועוד ' + (L.length - 5) + '.' : '') + (Number.isFinite(old) ? '\nהוותיקה התקבלה ב-' + il(old).day + '.' : '') + '\nבלשונית "חשבוניות" של המזכירה.', fire: today }];
}
// ---------- שלב 8: הודעה שלא נענתה ועומד להיסגר חלון 24 השעות (sec_in, 7.3 – "שעתיים לפני סוף החלון") ----------
// החלון של Meta נמדד מההודעה האחרונה של הפונה (sec_snd.lastIn). תזכורת אחת לכל הודעה אחרונה, כשנשארו שעתיים או פחות (ועדיין לא נסגר).
// "לא נענתה" = ההודעה האחרונה של הפונה (sec_snd.lastId) שייכת למזכירה (own:'sec') ולא סומנה "נענתה" (replied) או "טופלה" (handled).
const WIN_MS = 24 * 3600e3, WIN_LEAD = 2 * 3600e3;
const ANSWERED = ['replied', 'handled', 'ord'];
const winOpen = (m) => !!m && m.own === 'sec' && (m.ch || 'wa') === 'wa' && !ANSWERED.includes(m.st);
// snd: כרטיס השולח; msg: sec_in של lastId (id במפתח). מחזיר מועמד או null
function winCand(snd, msg, now, show) {
  if (!snd || snd.mgr === true || !Number.isFinite(snd.lastIn) || !msg || !winOpen(msg)) return null;
  const end = snd.lastIn + WIN_MS;
  if (now < end - WIN_LEAD || now >= end) return null;
  const hm = il(end).hm;
  const who = (show || String)(snd.wa) + (snd.name ? ' (' + String(snd.name).slice(0, 40) + ')' : '');
  const txt = msg.type === 'audio' ? 'הודעה קולית' : msg.type === 'other' ? 'קובץ' : '"' + String(msg.text || '').slice(0, 80) + '"';
  return { typ: 'win', key: 'win:' + snd.wa + ':' + snd.lastIn, item: 'win:' + msg.id, title: 'הודעה שלא נענתה – החלון נסגר ב-' + hm,
    body: 'מ-' + who + ': ' + txt + '\nאחרי ' + hm + ' אפשר לענות רק בתבנית מאושרת (חלון 24 השעות של ווצאפ).', until: end };
}

// יומן (sec_cal): תזכורת שהמנהל קבע (rem) – בשעה שקבע (בלי שעה: 08:00); אירוע – שעה לפני (בלי שעה: 08:00).
// ביום שאינו יום עסקים: אם המנהל בחר "להשאיר" (keepOff, 75) – בזמנה; אחרת – ביום העסקים הבא בבוקר (7.4)
function calAt(e) {
  let hm = e.tm && HM_RE.test(e.tm) ? e.tm : MORNING;
  if (e.rem !== true && e.tm && HM_RE.test(e.tm)) { const [h, m] = e.tm.split(':').map(Number); const x = Math.max(0, h * 60 + m - 60); hm = String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); }
  if (!K.bizDay(e.d) && e.keepOff !== true) return { at: ilMs(K.nextBizDay(e.d), MORNING), moved: true };
  return { at: ilMs(e.d, hm), moved: false };
}

// ---------- דוחות (6.4, 55, 66–68) ----------
// מתי הדוח השבועי של השבוע הזה: היום ש-wd נופל בו ב-7 הימים האחרונים (כולל היום); בשישי/שבת/חג – יום העסקים הבא
function weeklyDue(today, wd) {
  let s = today;
  for (let k = 0; k < 7 && wdOf(s) !== wd; k++) s = K.addDays(s, -1);
  const fire = bizOnOrAfter(s);
  const why = fire === s ? '' : (wdOf(s) === 5 || wdOf(s) === 6 ? 'היום שנבחר אינו יום עסקים – הדוח מופיע ביום העסקים הבא' : 'נדחה בגלל חג');
  return { key: s, fire, why };
}
// md = 0: יום העסקים הראשון בחודש (ברירת המחדל). md 1–31: היום שהמנהל קבע (67); יום שלא קיים בחודש (31 בנובמבר) – היום האחרון בחודש;
// שישי/שבת/חג – יום העסקים הבא (גם אם הוא בחודש הבא). מחזיר את הדוח של החודש הזה ושל החודש הקודם (שאולי נדחה לתוך החודש הזה)
const lastDay = (mon) => { const [y, m] = mon.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
function monthlyOf(mon, md) {
  const first = mon + '-01';
  if (!md) return { key: mon, s: first, fire: bizOnOrAfter(first), why: '' };
  const d = Math.min(md, lastDay(mon)), s = mon + '-' + String(d).padStart(2, '0'), fire = bizOnOrAfter(s);
  const why = (d < md ? 'בחודש הזה אין ' + md + ' ימים – ביום האחרון בחודש' : '') + (fire === s ? '' : (d < md ? '; ' : '') + (wdOf(s) === 5 || wdOf(s) === 6 ? 'היום שנבחר אינו יום עסקים – הדוח מופיע ביום העסקים הבא' : 'נדחה בגלל חג'));
  return { key: mon, s, fire, why };
}
function monthlyDue(today, md) {
  const mon = today.slice(0, 7);
  return [monthlyOf(prevMon(mon), md || 0), monthlyOf(mon, md || 0)];
}
const sum = (L, f) => rnd(L.reduce((s, x) => s + (f(x) || 0), 0));
const prevMon = (m) => { const [y, x] = m.split('-').map(Number); return x === 1 ? (y - 1) + '-12' : y + '-' + String(x - 1).padStart(2, '0'); };
const pctCh = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null);
const pctTxt = (p) => (p === null ? '' : ' (' + (p > 0 ? '+' : '') + p + '%)');
// insight/ideas: מ-ST.ideas (אותם רעיונות כמו בצ'אט, בלי מה שסומן "לא רלוונטי" ל-90 יום – 56)
function ideasOf(fin, nr, now, n) {
  return fin ? ST.ideas(fin, nr, now).slice(0, n).map((x) => ({ key: x.key, seen: x.seen, why: x.why, options: (x.options || []).slice(0, 3), unknown: x.unknown || '' })) : [];
}
// o: { kind:'w'|'m', today, now, fin, finAt, nr, tasks, closings, rt, payTotal (מספר או null), threshold, why }
function buildReport(o) {
  const secs = [];
  const fin = o.fin;
  const src = fin ? 'נתוני הכספים מהמראה בענן, נכון ל-' + ST.fmtAt(o.finAt || fin.at) : 'אין נתוני כספים (מראה הכספים כבוי או שלא עודכן) – הדוח חלקי.';
  if (o.kind === 'w') {
    const end = K.addDays(o.today, 6);
    if (fin) {
      const cur = fin.months[o.today.slice(0, 7)];
      if (cur) secs.push({ h: 'מה נכנס ויצא החודש (עד עכשיו)', lines: ['הכנסות: ' + ils(cur.inc), 'הוצאות: ' + ils(cur.exp), 'רווח: ' + ils(rnd(cur.inc - cur.exp))] });
      const due = (fin.open || []).filter((r) => r[3] && r[3] >= o.today && r[3] <= end && r[5] > 0.004);
      secs.push({ h: 'חשבוניות לתשלום השבוע', lines: due.length ? [due.length + ' חשבוניות, סך ' + ils(sum(due, (r) => r[5]))].concat(due.slice(0, 8).map((r) => '• ' + r[0] + ' – ' + ils(r[5]) + ' עד ' + r[3])) : ['אין'] });
      if (o.rt.invLate) secs.push({ h: 'חשבוניות באיחור', lines: fin.late && fin.late.n ? [fin.late.n + ' חשבוניות, סך ' + ils(fin.late.sum) + ' (אחרי זיכויים)'] : ['אין'] });
      const ch = (fin.chk || []).filter((r) => r[0] >= o.today && r[0] <= end);
      secs.push({ h: 'צ\'קים שייפרעו השבוע', lines: ch.length ? [ch.length + ' צ\'קים, סך ' + ils(sum(ch, (r) => Math.abs(r[2])))] : ['אין'] });
    }
    const open = o.tasks.filter((t) => t.st === 'open'), late = open.filter((t) => +t.due && +t.due < o.now);
    secs.push({ h: 'משימות פתוחות', lines: [open.length + ' פתוחות, מהן ' + late.length + ' באיחור'] });
    const from = K.addDays(o.today, -7);
    const df = o.closings.filter(notRej).filter((c) => c.d >= from && c.d < o.today).map((c) => cashDiff(c)).filter((a) => a !== null && a >= EMP_MIN);
    secs.push({ h: 'הפרשי קופה בשבוע האחרון', lines: df.length ? [df.length + ' סגירות עם הפרש, סך ' + ils(sum(df, (a) => a))] : ['אין'] });
    const ideas = ideasOf(fin, o.nr, o.now, 3);
    if (ideas.length) secs.push({ h: 'תובנה', lines: [ideas[0].seen] });
    return { kind: 'w', title: 'הדוח השבועי', secs, ideas, src, why: o.why || '' };
  }
  // חודשי
  if (fin) {
    const m = o.mon || prevMon(o.today.slice(0, 7)), a = fin.months[m], b = fin.months[prevMon(m)], y = fin.months[(Number(m.slice(0, 4)) - 1) + m.slice(4)];
    if (a) {
      const L = ['הכנסות: ' + ils(a.inc), 'הוצאות: ' + ils(a.exp), 'רווח: ' + ils(rnd(a.inc - a.exp))];
      if (b) L.push('מול החודש הקודם: הכנסות' + pctTxt(pctCh(a.inc, b.inc)) + ', הוצאות' + pctTxt(pctCh(a.exp, b.exp)));
      if (y) L.push('מול אותו חודש אשתקד: הכנסות' + pctTxt(pctCh(a.inc, y.inc)) + ', הוצאות' + pctTxt(pctCh(a.exp, y.exp)));
      secs.push({ h: 'סיכום ' + m, lines: L });
      const cats = a.cats.filter((c) => c[1] === 'e').sort((p, q) => Math.abs(q[2]) - Math.abs(p[2])).slice(0, 5);
      if (cats.length) secs.push({ h: 'הוצאות לפי קטגוריה', lines: cats.map((c) => '• ' + c[0] + ': ' + ils(c[2]) + (a.inc > 0.004 ? ' (' + Math.round((c[2] / a.inc) * 100) + '% מההכנסות)' : '')) });
    } else secs.push({ h: 'סיכום ' + m, lines: ['אין נתונים לחודש הזה'] });
    if (fin.wk) {
      const f = ST.forecast(fin, NaN, o.threshold);
      secs.push({ h: 'צפי תזרים ל-13 השבועות הבאים', lines: ['יציאות צפויות בממוצע לשבוע: ' + ils(f.avgWeeklyOut), 'הכנסות לשבוע לפי העבר: ' + ils(f.incomeRangeWeekly[0]) + ' עד ' + ils(f.incomeRangeWeekly[1]), 'יתרת הבנק לא ידועה למזכירה – לחישוב יתרה צפויה שאלו בצ\'אט.'] });
    }
  }
  if (o.payTotal !== null && o.payTotal !== undefined) secs.push({ h: 'שכר', lines: ['סך השכר בחודש הקודם: ' + ils(o.payTotal) + ' (סך כולל בלבד)'] });
  const ideas = ideasOf(fin, o.nr, o.now, 3);
  if (ideas.length) secs.push({ h: '3 רעיונות לשיפור', lines: ideas.map((x) => '• ' + x.seen) });
  return { kind: 'm', title: 'הדוח החודשי', secs, ideas, src, why: o.why || '' };
}

module.exports = {
  TZ, MORNING, TYPES, NO_REPEAT, DEF, EMP_MIN, il, ilMs, wdOf, bizOnOrAfter, prevBizDay, nextBizMorning, ntOf, readNt, wkWarn, inQuiet, pushAtOf,
  cashDiff, finItems, notRej, monthlyOf, finCands, invCands, winCand, winOpen, WIN_MS, WIN_LEAD, INV_WAIT, taskCands, closeCands, backupCands, factCands, calAt, weeklyDue, monthlyDue, buildReport, ils, prevMon,
};
