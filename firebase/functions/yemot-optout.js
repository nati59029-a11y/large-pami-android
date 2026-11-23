'use strict';
// מי יצא מרשימת הצינתוקים החינמית, ודוח הקו החודשי (משימה 2026-11-23).
// החלטת בעל העסק 23.11.2026: מי שיצא מהרשימה החינמית – בעצמו (שלוחת ההסרה) או שמנהל הוציא אותו באתר ימות –
// לא מקבל צינתוק בתשלום כלקוח משוב. בלי שום שינוי ברשימות בימות. מי שנרשם שוב – חוזר לקבל (מהרשימה החינמית).
//
// מקורות "יצא":
//   1. יומן הרשימה בימות: TzintukimListManagement action=getLogList (מתועד ב-post/65034, קריאה בלבד).
//      אירועים: AddToListTzintuk / RemovingToListTzintuk / AdminRemovingToListTzintuk. האירוע האחרון לכל מספר קובע.
//      (לא מאומת) באיזה שדה המספר – Phone או PhoneAction; לכן PhoneAction אם תקין, אחרת Phone.
//   2. השוואה לתמונת מצב שמורה: מספר שהיה ברשימה החינמית ועכשיו לא – יצא. עובד גם אם היומן קצר או בפורמט אחר.
// הכל נשמר ב-yemot_state/tzlopt { seen: [טלפונים שנראו ברשימה], out: { טלפון: { at, how } }, logOk, at } – רק השרת.
// אם היומן לא נקרא ואין שום תמונת מצב קודמת – זורקים (לא שולחים צינתוק בתשלום בלי לדעת מי יצא).

const logger = require('firebase-functions/logger');
const { YemotError, tzlLog } = require('./lib/yemot-client');

const OPT = 'yemot_state/tzlopt';
const HOW = { AddToListTzintuk: 'join', RemovingToListTzintuk: 'self', AdminRemovingToListTzintuk: 'admin' };

// עכשיו בשעון ישראל, באותו פורמט של אירועי היומן ("2026-11-23T10:00:00")
const ilNow = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(' ', 'T');
const normPhone = (p) => require('./yemot-fblist')._core.normPhone(p);
// "19/01/2021" + "00:39:10" ← "2021-01-19T00:39:10" (שעון ישראל, בלי אזור). לא תקין ← null.
function evAt(d, t) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d || '').trim());
  if (!m) return null;
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(t || '').trim());
  const p2 = (x) => String(x).padStart(2, '0');
  return `${m[3]}-${p2(m[2])}-${p2(m[1])}T${tm ? `${p2(tm[1])}:${tm[2]}:${tm[3] || '00'}` : '00:00:00'}`;
}
// Phone = מי שביצע את הפעולה; PhoneAction = המספר שעליו נעשתה הפעולה (רק כשמנהל פעל על מספר – לפי post/65034). לכן PhoneAction קודם.
// ResetToListTzintuk (איפוס הרשימה) לא מפרט מספרים – נתפס רק בתמונת המצב ('gone').
// אירועי יומן ← [{ p, how:'join'|'self'|'admin', at }] (רק סוגים מוכרים ומספר תקין), ממוין לפי זמן
function parseLog(events) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object') continue;
    const how = HOW[e.TypeOperation];
    if (!how) continue;
    const p = normPhone(e.PhoneAction) || normPhone(e.Phone);
    const at = evAt(e.Date, e.Time);
    if (p && at) out.push({ p, how, at });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// free: הרשימה החינמית עכשיו (טלפונים מנורמלים). מחזיר { out: Map(טלפון → { at, how }), events (מהיומן, אם נקרא), logErr }.
// out = מי שיצא ולא חזר. מעדכן את yemot_state/tzlopt.
async function optOut(db, ctx, list, free) {
  const now = new Set(free);
  const ref = db.doc(OPT);
  const prev = (await ref.get()).data() || null;
  let events = null, logErr = null;
  try {
    const raw = await tzlLog(ctx, list);
    events = parseLog(raw);
    // יש ביומן אירועי הרשמה/יציאה אבל אף אחד לא פוענח (פורמט תאריך או מספר אחר) – כמו יומן שלא נקרא, לא "אין יציאות"
    if (!events.length && raw.some((e) => e && HOW[e.TypeOperation])) throw new YemotError('log-unparsed', false);
  } catch (e) {
    events = null;
    logErr = e instanceof YemotError ? String(e.code).slice(0, 30) : 'internal';
    logger.warn('yemot-optout: log failed', { reason: 'log-failed', code: logErr });
  }
  if (!events && !prev) {
    // אין יומן ואין תמונת מצב: לא יודעים מי יצא. שומרים תמונת מצב ראשונה, וזורקים – הבתשלום לא נשלח.
    try { await ref.set({ seen: [...now], out: {}, logOk: false, at: new Date().toISOString() }); } catch (e) { /* */ }
    throw new YemotError('optout-unknown', false);
  }
  const out = new Map(Object.entries((prev && prev.out && typeof prev.out === 'object') ? prev.out : {}).filter(([p, v]) => normPhone(p) === p && v && typeof v === 'object'));
  const today = ilNow();
  // 2. תמונת מצב: היה ברשימה ועכשיו לא
  for (const p of (prev && Array.isArray(prev.seen) ? prev.seen : [])) if (!now.has(p) && !out.has(p)) out.set(p, { at: today, how: 'gone' });
  // 1. היומן: האירוע האחרון לכל מספר
  if (events) {
    const last = new Map();
    for (const e of events) last.set(e.p, e);
    for (const [p, e] of last) {
      if (e.how !== 'join' && !now.has(p)) out.set(p, { at: e.at, how: e.how });
    }
  }
  for (const p of now) out.delete(p); // נמצא ברשימה עכשיו = נרשם שוב
  const seen = [...new Set([...(prev && Array.isArray(prev.seen) ? prev.seen : []), ...now])];
  try { await ref.set({ seen, out: Object.fromEntries(out), logOk: !!events, at: today }); } catch (e) {
    logger.warn('yemot-optout: save failed', { reason: 'save-failed' });
  }
  return { out, events, logErr };
}

// ---------------- דוח הקו (yemotFbList action:'report') ----------------
const LOG_FILE = (ym) => `ivr2:/Log/LogFolderEnterExit-${ym}.ymgr`;
const MAX_ROWS = 1000;

// שורות יומן הכניסות ← { calls, phones, rows:[{ p, n, sec, last }] }. שורה בלי טלפון תקין נספרת בשיחות בלבד.
// (לא מאומת – לא בתיעוד הרשמי) שמות השדות: Phone, EnterDate, EnterTime, TimeTotal, CallId.
function heardOf(rows) {
  const calls = new Set(), by = new Map();
  let i = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue;
    i++;
    const at = evAt(r.EnterDate, r.EnterTime);
    const id = String(r.CallId || '').slice(0, 80) || `row${i}`;
    calls.add(id);
    const p = normPhone(r.Phone);
    if (!p) continue;
    const x = by.get(p) || { p, n: 0, sec: 0, last: null, ids: new Set() };
    if (!x.ids.has(id)) { x.n++; x.ids.add(id); }
    const s = Number(r.TimeTotal);
    if (Number.isFinite(s) && s > 0) x.sec += Math.round(s);
    if (at && (!x.last || at > x.last)) x.last = at;
    by.set(p, x);
  }
  const list = [...by.values()].map(({ p, n, sec, last }) => ({ p, n, sec, last }))
    .sort((a, b) => (b.last || '').localeCompare(a.last || '') || b.n - a.n);
  return { calls: calls.size, phones: list.length, rows: list.slice(0, MAX_ROWS), more: Math.max(0, list.length - MAX_ROWS) };
}
// קובץ ymgr בטקסט (שורה לכל כניסה: Key#Value%Key#Value) ← מערך אובייקטים
function parseYmgr(text) {
  return String(text || '').split(/\r?\n/).filter((l) => l.includes('#')).map((l) => {
    const o = {};
    for (const part of l.split('%')) { const k = part.indexOf('#'); if (k > 0) o[part.slice(0, k).trim()] = part.slice(k + 1).trim(); }
    return o;
  });
}

const inMonth = (at, ym) => typeof at === 'string' && at.slice(0, 7) === ym;

module.exports = { optOut, parseLog, evAt, heardOf, parseYmgr, inMonth, LOG_FILE, OPT, MAX_ROWS };
