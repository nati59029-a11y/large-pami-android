'use strict';
// המזכירה – שלב 3: "מידע על העסק" (5.3), בנק תשובות (3.5), יומן (7.1) וייבוא מהמזכירה הקודמת (99, 100).
// כאן רק לוגיקה טהורה (נרמול, התאמה, בדיקת מבנה, ימי עסקים). הקריאה והכתיבה ל-Firestore – ב-secretary-know.js וב-secretary.js.
// כל תוכן שמגיע מקובץ, מהמשתמש או מהמודל הוא מידע בלבד, לא הוראה: הוא נשמר כטקסט ומוחזר כטקסט, ואף פעם לא מפעיל פעולה.

const TZ = 'Asia/Jerusalem';
const dayOf = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim() : '').slice(0, n + 1);
const line = (v, n) => clean(v, n).replace(/\n/g, ' ');

// ---------- מידע על העסק (5.3, 46–49) ----------
const TOPICS = Object.freeze({ general: 'כללי', sup: 'ספקים', emp: 'עובדים', goal: 'מטרות', reply: 'כללי תשובה' });
// שדות קבועים (46): נשמרים כעובדות במזהה קבוע fx_<key>
const FIXED = Object.freeze({ sells: 'מה העסק מוכר', hours: 'שעות פתיחה', addr: 'כתובות', branches: 'סניפים', audience: 'קהל יעד', seasons: 'עונות חזקות וחלשות' });
const FACT_MAX = 500, FACTS_MAX = 500, PROP_MAX = 30, PRICE_ROWS = 1000;
function validDay(s) { if (!DAY_RE.test(s)) return false; const d = new Date(s + 'T12:00:00Z'); return d.toISOString().slice(0, 10) === s; }

// נרמול לעברית (גם לבנק התשובות): בלי ניקוד וטעמים, בלי פיסוק, אותיות סופיות → רגילות, רווחים אחידים
function normHe(s) {
  return String(s || '').normalize('NFKC').replace(/[֑-ׇ]/g, '').replace(/[ךםןףץ]/g, (c) => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }[c]))
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// אותיות מחוברות ה/ב/ל/ו (ו גם לפני אחת מהן: "ובשעות"): כל הגרסאות של מילה
function variants(w) {
  const out = new Set([w]);
  let x = w;
  if (x.length > 2 && x[0] === 'ו') { x = x.slice(1); out.add(x); }
  if (x.length > 2 && 'הבל'.includes(x[0])) out.add(x.slice(1));
  return out;
}
const tokens = (s) => normHe(s).split(' ').filter(Boolean);
function tokMatch(a, b) { if (a === b) return true; const va = variants(a), vb = variants(b); for (const x of va) if (vb.has(x)) return true; return false; }

// עובדות סותרות (49): אותו נושא, מילים משותפות רבות (אותו "עניין"), אבל טקסט שונה. בלי לנחש מי צודקת – מציגים את שתיהן ושואלים.
function overlap(a, b) {
  const A = tokens(a).filter((w) => w.length > 1 && !/^\d+$/.test(w)), B = tokens(b).filter((w) => w.length > 1 && !/^\d+$/.test(w));
  if (!A.length || !B.length) return 0;
  let hit = 0; for (const w of A) if (B.some((v) => tokMatch(w, v))) hit++;
  return hit / Math.min(A.length, B.length);
}
function conflictsOf(fact, list) {
  const t = normHe(fact.text);
  return list.filter((f) => f.id !== fact.id && f.st === 'ok' && f.topic === fact.topic && normHe(f.text) !== t && overlap(f.text, fact.text) >= 0.6)
    .slice(0, 3).map((f) => ({ id: f.id, text: f.text, t: f.t || 0 }));
}
// עובדה במבנה האחיד שחוזר לאפליקציה ולכלי
function factOut(id, d) {
  const o = { id, topic: TOPICS[d.topic] ? d.topic : 'general', text: typeof d.text === 'string' ? d.text : '', st: d.st === 'prop' ? 'prop' : d.st === 'old' ? 'old' : 'ok', t: d.t || 0, by: d.by || '', src: d.src || 'mgr' };
  if (d.exp) o.exp = d.exp;
  if (d.fx) o.fx = d.fx;
  if (d.pub === true) o.pub = true;
  if (d.oldBy) o.oldBy = d.oldBy;
  return o;
}
const expired = (f, today) => !!(f.exp && f.exp < today);

// מחירון (23): שורות [פריט, מחיר, יחידה?]. מגיע מהאפליקציה אחרי פענוח CSV/טקסט – נבדק כאן שוב
function cleanPrice(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > PRICE_ROWS) return null;
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') return null;
    const n = line(r.n, 80), u = line(r.u || '', 20), p = r.p;
    if (!n || n.length > 80 || u.length > 20 || typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1e7) return null;
    out.push(u ? { n, p: Math.round(p * 100) / 100, u } : { n, p: Math.round(p * 100) / 100 });
  }
  return out;
}

// ---------- בנק תשובות (3.5) ----------
// כלל: { id, q: [ניסוחים], a: תשובה, cond: תנאים (לא חובה), on }. התאמה: כל המילים של ניסוח מופיעות בהודעה (עם ה/ב/ל/ו מחוברות),
// וההודעה לא ארוכה מהניסוח ביותר משתי מילים (כדי ש"מה שעות הפתיחה ומה המחיר של עוגה" לא ייענה רק על השעות).
const RULE_Q_MAX = 200, RULE_A_MAX = 1000, RULE_COND_MAX = 300, RULES_MAX = 500, RULE_QS = 10, BANK_CTX = 40;
function ruleHits(text, q) {
  const m = tokens(text), t = tokens(q);
  if (!t.length || !m.length || m.length > t.length + 2) return false;
  return t.every((w) => m.some((v) => tokMatch(v, w)));
}
// מחזיר { rule, q } לכלל הראשון שמתאים בלי תנאים (ענה בלי AI), ו-cond: עד 40 כללים עם תנאים שמתאימים (עוברים למודל כמידע)
function bankMatch(text, rules) {
  const cond = [];
  let hit = null;
  for (const r of rules || []) {
    if (!r || r.on === false || !Array.isArray(r.q) || typeof r.a !== 'string' || !r.a.trim()) continue;
    const q = r.q.find((x) => ruleHits(text, x));
    if (!q) continue;
    if (r.cond && String(r.cond).trim()) { if (cond.length < BANK_CTX) cond.push({ id: r.id, q, a: r.a, cond: r.cond }); continue; }
    if (!hit) hit = { rule: r, q };
  }
  return { hit, cond };
}
function cleanRule(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const qs = (Array.isArray(x.q) ? x.q : [x.q]).map((v) => line(v, RULE_Q_MAX)).filter(Boolean);
  const a = clean(x.a, RULE_A_MAX), cond = line(x.cond || '', RULE_COND_MAX);
  if (!qs.length || qs.length > RULE_QS || qs.some((v) => v.length > RULE_Q_MAX || !tokens(v).length) || !a || a.length > RULE_A_MAX || cond.length > RULE_COND_MAX) return null;
  return { q: [...new Set(qs)], a, cond, on: x.on !== false };
}

// ---------- יומן (7.1, 71, 72) ----------
// ימי עסקים – אותו כלל בדיוק כמו tkBiz במשימות (index.html; 72 שעות): ראשון–חמישי, בלי יום טוב, חול המועד, ערבי חג, פורים ותשעה באב.
// הועבר לשרת (7.4). בדיקה אוטומטית משווה לפונקציה שבאפליקציה על פני שנתיים (secretary-know.test.js).
const TK_OFF = { Elul: [29], Tishri: [1, 2, 9, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22], Nisan: [14, 15, 16, 17, 18, 19, 20, 21], Sivan: [5, 6] };
const TKHF = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', timeZone: 'UTC' });
function bizDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = dt.getUTCDay();
  if (wd > 4) return false;
  try {
    const p = TKHF.formatToParts(dt), mm = (p.find((x) => x.type === 'month') || {}).value, dd = +((p.find((x) => x.type === 'day') || {}).value);
    if ((TK_OFF[mm] || []).includes(dd)) return false;
    if (((mm === 'Adar' || mm === 'Adar II') && dd === 14) || (mm === 'Av' && (dd === 9 || (dd === 10 && wd === 0)))) return false;
  } catch (e) { /* בלי לוח עברי – רק שישי/שבת */ }
  return true;
}
const addDays = (d, k) => { const [y, m, x] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, x + k)).toISOString().slice(0, 10); };
function nextBizDay(day) { let d = day; for (let i = 0; i < 30; i++) { d = addDays(d, 1); if (bizDay(d)) return d; } return d; }
function offKind(day) {
  const wd = new Date(day + 'T12:00:00Z').getUTCDay();
  return wd === 5 ? 'שישי' : wd === 6 ? 'שבת' : bizDay(day) ? '' : 'חג או ערב חג';
}
const CAL_TITLE = 120, CAL_NOTE = 500, CAL_MAX = 2000, CAL_PROP_MAX = 30;
// אירוע נקי: { title, d, tm?, note?, biz? } – תאריך YYYY-MM-DD, שעה HH:MM (לא חובה)
function cleanEvent(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const title = line(x.title, CAL_TITLE), d = typeof x.d === 'string' ? x.d : '', tm = typeof x.tm === 'string' ? x.tm : '', note = clean(x.note || '', CAL_NOTE);
  if (!title || title.length > CAL_TITLE || !validDay(d) || (tm && !TIME_RE.test(tm)) || note.length > CAL_NOTE) return null;
  const o = { title, d };
  if (tm) o.tm = tm;
  if (note) o.note = note;
  return o;
}
function calOut(id, x, me) {
  const o = { id, title: x.title || '', d: x.d || '', st: x.st === 'prop' ? 'prop' : 'ok', biz: !x.uid, src: x.src || 'mgr', t: x.t || 0 };
  if (x.tm) o.tm = x.tm;
  if (x.note) o.note = x.note;
  if (x.st === 'prop') o.to = x.to === 'biz' ? 'biz' : 'me';
  if (x.keepOff) o.keepOff = true;
  o.mine = !!x.uid && x.uid === me;
  return o;
}

// ---------- ייבוא מהמזכירה הקודמת (99, 100) ----------
// קובץ JSON שהמנהל מעלה. מבנה מוסכם: { rules: [{ q, a, cond? }], events: [{ title, date, time?, note? }] }.
// גם שמות שדות חלופיים (המזכירה הקודמת – "מצב, תשובה, תנאים"): situation/state/question/מצב ← q, answer/response/תשובה ← a,
// conditions/תנאים ← cond; start (ISO) ← date+time. שדה לא מוכר – מתעלמים. כל הערכים – טקסט בלבד.
const IMPORT_MAX = 1000000, IMPORT_ITEMS = 2000;
const pick = (o, ks) => { for (const k of ks) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
function parseImport(raw, today) {
  if (typeof raw !== 'string' || !raw.length) return { error: 'empty' };
  if (raw.length > IMPORT_MAX) return { error: 'too-big' };
  let j; try { j = JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { return { error: 'not-json' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { error: 'bad-shape' };
  const R = pick(j, ['rules', 'answers', 'bank', 'בנק תשובות']), E = pick(j, ['events', 'calendar', 'יומן']);
  if ((R !== undefined && !Array.isArray(R)) || (E !== undefined && !Array.isArray(E)) || (R === undefined && E === undefined)) return { error: 'bad-shape' };
  if ((R || []).length > IMPORT_ITEMS || (E || []).length > IMPORT_ITEMS) return { error: 'too-many' };
  const rules = [], events = [], bad = { rules: 0, events: 0 };
  let past = 0;
  for (const x of R || []) {
    if (!x || typeof x !== 'object') { bad.rules++; continue; }
    const r = cleanRule({ q: pick(x, ['q', 'question', 'questions', 'situation', 'state', 'trigger', 'מצב', 'שאלה']), a: pick(x, ['a', 'answer', 'response', 'reply', 'תשובה']), cond: pick(x, ['cond', 'conditions', 'condition', 'תנאים']) || '' });
    if (r) rules.push(r); else bad.rules++;
  }
  for (const x of E || []) {
    if (!x || typeof x !== 'object') { bad.events++; continue; }
    let d = pick(x, ['date', 'd', 'day', 'תאריך']), tm = pick(x, ['time', 'tm', 'שעה']);
    const st = pick(x, ['start', 'startsAt', 'when']);
    if (!d && typeof st === 'string') {
      const ms = Date.parse(st);
      if (Number.isFinite(ms)) { d = dayOf(ms); if (/T\d{2}:\d{2}/.test(st)) tm = new Date(ms).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); }
    }
    const ev = cleanEvent({ title: pick(x, ['title', 'name', 'subject', 'כותרת']), d, tm: tm || '', note: pick(x, ['note', 'notes', 'description', 'הערה']) || '' });
    if (!ev) { bad.events++; continue; }
    if (ev.d < today) { past++; continue; } // רק אירועים עתידיים (100). אירוע של היום – נכנס
    events.push(ev);
  }
  return { rules, events, bad, past };
}

module.exports = {
  TOPICS, FIXED, FACT_MAX, FACTS_MAX, PROP_MAX, PRICE_ROWS, normHe, tokens, variants, tokMatch, conflictsOf, overlap, factOut, expired, cleanPrice, validDay,
  RULE_Q_MAX, RULE_A_MAX, RULE_COND_MAX, RULES_MAX, BANK_CTX, ruleHits, bankMatch, cleanRule,
  TK_OFF, bizDay, nextBizDay, offKind, addDays, CAL_TITLE, CAL_NOTE, CAL_MAX, CAL_PROP_MAX, cleanEvent, calOut,
  IMPORT_MAX, IMPORT_ITEMS, parseImport, clean, line, dayOf, DAY_RE, TIME_RE,
};
