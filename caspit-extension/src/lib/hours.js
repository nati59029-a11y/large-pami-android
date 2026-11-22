// תוסף כספית – קובץ "שעות לעובד" (0.1.14): ניתוח סובלני של הקובץ שכספית מייצאת מדף השעות של עובד (טהור, בלי chrome.*).
// מבנה הקובץ האמיתי עוד לא ידוע (דוח ההיכרות 0.1.12: עובד ראשון – חודש ריק). לכן:
//   - שורת הכותרות נמצאת לפי מילות מפתח (תאריך, כניסה, יציאה; רשות: הפסקה, סה"כ) מבין 15 השורות הראשונות.
//   - לכל שורה: d = YYYY-MM-DD, i = כניסה HH:MM, o = יציאה HH:MM ('' = לא החתים יציאה), b = הפסקה בדקות, t = סה"כ בדקות (אם ידוע), n = 1 אם המשמרת חוצה חצות.
//   - ערכים: טקסט (03/11/2026, 7:41, 8:17, 2026-11-03 07:41) או ערכי Excel גולמיים (מספר סידורי של יום, שבר של יממה).
//   - שורה בלי תאריך תקין או בלי שעת כניסה (שורת סיכום, יום חופש) – לא נכנסת. שורה מחוץ לחודש המבוקש – לא נכנסת (נספרת ב-out).
//   - מבנה לא מזוהה → { ok:false } – לא שולחים שורות (ה-service worker מדווח hours-format עם הכותרות דרך הרשימה הלבנה בלבד).
// פרטיות: הפונקציות לא רושמות כלום; שם העובד (nm) – רק מהשורה שמעל הכותרות ("דוח שעות עובד - <שם>"), כגיבוי לשם מרשימת העובדים.
(function (root) {
'use strict';
const MAX_ROWS = 200; // שורות לעובד לחודש (גם בשרת)
const M_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const p2 = (n) => String(n).padStart(2, '0');
const norm = (v) => String(v == null ? '' : v).replace(/[‎‏‪-‮⁦-⁩﻿]/g, '').replace(/ /g, ' ').replace(/[”“״]/g, '"').replace(/\s+/g, ' ').trim();
const okDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const dayOf = (y, m, d) => (okDay(y, m, d) ? `${y}-${p2(m)}-${p2(d)}` : null);
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
// מספר סידורי של Excel (ימים מ-30.12.1899) → YYYY-MM-DD
const serialDay = (v) => new Date(Math.round((Math.floor(v) - 25569) * 864e5)).toISOString().slice(0, 10);
// החודש המבוקש 'YYYY-MM' → החודש של התאריך הקודם / הבא (לתאריך בלי שנה)
function months(ym) { const [y, m] = ym.split('-').map(Number); return { y, m }; }
// תאריך: טקסט dd/mm(/yyyy) (גם בתוך טקסט, למשל "יום ב' 03/11/2026"), yyyy-mm-dd, או מספר סידורי של Excel. ym – לשנה חסרה
function pDate(v, ym) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 20000 && v < 80000 ? serialDay(v) : null;
  const t = norm(v);
  if (!t) return null;
  let m = /(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(t);
  if (m) return dayOf(+m[1], +m[2], +m[3]);
  m = /(?:^|[^\d:])(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?![\d:])/.exec(t);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  let y;
  if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : m[3].length === 4 ? +m[3] : NaN;
  else { const W = months(ym); y = W.y + (W.m === 1 && mo === 12 ? -1 : W.m === 12 && mo === 1 ? 1 : 0); }
  return dayOf(y, mo, d);
}
// שעה: "7:41", "07:41:00", "03/11/2026 07:41", שבר של יממה (0.32), או מספר סידורי עם שעה (46329.32) → { min, day? }
function pTime(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    if (v < 1) { const min = Math.round(v * 1440); return min < 1440 ? { min } : { min: 0, next: true }; }
    if (v > 20000 && v < 80000 && v % 1) { let min = Math.round((v % 1) * 1440), day = serialDay(v); if (min >= 1440) { min = 0; day = addDays(day, 1); } return { min, day }; }
    return null;
  }
  const t = norm(v);
  const m = /(?:^|[^\d])(\d{1,2}):(\d{2})(?::\d{2})?(?![\d])/.exec(t);
  if (!m || +m[1] > 24 || +m[2] > 59 || (+m[1] === 24 && +m[2] > 0)) return null;
  const min = (+m[1] % 24) * 60 + +m[2];
  const dm = /(\d{4})[./-](\d{1,2})[./-](\d{1,2})|(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(t);
  const day = dm ? (dm[1] ? dayOf(+dm[1], +dm[2], +dm[3]) : dayOf(dm[6].length === 2 ? 2000 + +dm[6] : +dm[6], +dm[5], +dm[4])) : null;
  return Object.assign({ min }, day ? { day } : {}, +m[1] === 24 ? { next: true } : {});
}
// משך בדקות: "8:17" / "08:17:00" (שעות:דקות), שבר של יממה (Excel), מספר עשרוני = שעות ("8.5"), ובהפסקה – מספר שלם מעל 12 או עמודת "דקות" = דקות
function pDur(v, isMin) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    if (isMin) return Math.round(v);
    if (v > 0 && v < 1) return Math.round(v * 1440);
    return Math.round(v * 60);
  }
  const t = norm(v).replace(',', '.');
  if (!t || t === '-') return null;
  let m = /^(-)?(\d{1,3}):(\d{2})(?::\d{2})?$/.exec(t);
  if (m) return m[1] ? null : +m[2] * 60 + +m[3];
  m = /^(\d{1,4})(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const n = parseFloat(t);
  return isMin ? Math.round(n) : Math.round(n * 60);
}
const hm = (min) => p2(Math.floor(min / 60)) + ':' + p2(min % 60);
// עמודות לפי מילות מפתח. → { hi, c:{ d, i, o, b, t }, bMin } או null
const KW = {
  d: (t) => /תאריך/.test(t) && !/עדכון|יצירה|הפקה/.test(t),
  i: (t) => /כניסה/.test(t) && !/יציאה/.test(t),
  o: (t) => /יציאה/.test(t) && !/כניסה/.test(t),
  b: (t) => /הפסק/.test(t),
  t: (t) => /סה"?כ|סהכ|סך הכל/.test(t) && !/הפסק|125|150|175|200|225|250/.test(t),
};
function header(rows) {
  const R = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < Math.min(15, R.length); i++) {
    const row = Array.isArray(R[i]) ? R[i].slice(0, 40).map(norm) : [];
    const c = {};
    for (const k of Object.keys(KW)) {
      const L = row.map((x, j) => (x && x.length <= 40 && KW[k](x) ? j : -1)).filter((j) => j >= 0);
      if (!L.length) continue;
      // סה"כ: עדיפות לעמודה עם "שעות"; תאריך: עדיפות ל"תאריך" מדויק
      c[k] = k === 't' ? (L.find((j) => /שעות/.test(row[j])) ?? L[0]) : k === 'd' ? (L.find((j) => row[j] === 'תאריך') ?? L[0]) : L[0];
    }
    if (c.d != null && c.i != null && c.o != null && new Set([c.d, c.i, c.o]).size === 3) return { hi: i, c, bMin: c.b != null && /דק/.test(row[c.b]) };
  }
  return null;
}
// שם העובד מכותרת הקובץ (שורה מעל הכותרות עם "עובד"): הטקסט שאחרי המקף האחרון
function titleName(rows, hi) {
  for (let i = 0; i < hi; i++) {
    const t = norm((Array.isArray(rows[i]) ? rows[i] : []).filter((x) => x !== '' && x != null).join(' '));
    const m = /עובד\S*\s*[-–:]\s*(.+)$/.exec(t);
    if (m && m[1].length <= 60) return m[1].trim();
  }
  return '';
}
// rows (U.readRows) + ym 'YYYY-MM' → { ok:true, rows, out, nm } | { ok:false, why }
function parse(rows, ym) {
  if (!M_RE.test(String(ym || ''))) return { ok: false, why: 'bad-month' };
  const H = header(rows);
  if (!H) return { ok: false, why: 'no-hdr' };
  const c = H.c, out = [];
  let skip = 0, bad = 0;
  for (const r of rows.slice(H.hi + 1)) {
    if (!Array.isArray(r)) continue;
    const d = pDate(r[c.d], ym);
    const ti = d ? pTime(r[c.i]) : null;
    if (!d || !ti) {
      // 0.1.15: שורת נתונים שלא פוענחה (תאריך / כניסה בפורמט לא מוכר) נספרת ב-bad – רק bad = 0 מאפשר "אין שורות" (empty).
      // לא נספרות: שורה ריקה, שורת סה"כ, ותאריך תקין בלי שעת כניסה (יום בלי החתמה)
      const cell = (j) => norm(r[j]);
      if (!r.some((v) => norm(v) !== '') || r.some((v) => /סה"?כ|סהכ|סך הכל/.test(norm(v)))) continue;
      if (!d ? cell(c.d) !== '' || cell(c.i) !== '' : cell(c.i) !== '') bad++;
      continue;
    }
    if (d.slice(0, 7) !== ym) { skip++; continue; }
    const to = pTime(r[c.o]);
    const b = c.b != null ? pDur(r[c.b], H.bMin || (typeof r[c.b] === 'number' && r[c.b] > 12 && Number.isInteger(r[c.b])) || (/^\d+$/.test(norm(r[c.b])) && +norm(r[c.b]) > 12)) : null;
    let t = c.t != null ? pDur(r[c.t], false) : null;
    // חוצה חצות: היציאה ביום שאחרי (לפי התאריך שבתא), או שעת יציאה מוקדמת משעת הכניסה
    let n = false;
    if (to) n = to.next || (to.day ? to.day > d : to.min < ti.min);
    const ok = { d, i: hm(ti.min), o: to ? hm(to.min) : '', b: b != null && b >= 0 && b <= 1440 ? b : 0 };
    if (t == null && to) t = Math.max(0, (to.min + (n ? 1440 : 0)) - ti.min - ok.b);
    if (t != null && t >= 0 && t <= 2880) ok.t = t;
    if (n && to) ok.n = 1;
    out.push(ok);
    if (out.length >= MAX_ROWS) break;
  }
  return { ok: true, rows: out, out: skip, bad, nm: titleName(rows, H.hi) };
}
// החודשים לסנכרון לפי היום (YYYY-MM-DD): החודש הנוכחי; בימים 1–5 – קודם החודש הקודם (morning: רק הנוכחי)
function monthsFor(day, curOnly) {
  const [y, m, d] = String(day).split('-').map(Number);
  const cur = `${y}-${p2(m)}`, prev = m === 1 ? `${y - 1}-12` : `${y}-${p2(m - 1)}`;
  return !curOnly && d <= 5 ? [prev, cur] : [cur];
}
// 0.1.15: מי נשלח ב-empty בסניף אחד. emps – [{ id, z:{ ym:1 } }] (z = יצוא החודש הצליח בלי אף שורה ובלי שורות לא מפוענחות),
// seen – מזהים שנשלחו בעבר עם שורות לאותו סניף+חודש (רק להם יש מה למחוק). מעצור נגד מחיקה גורפת: כל העובדים בסניף ריקים,
// או יותר מ-max מועמדים → אף אחד, warn 'hours-empty-many'. → { ids, warn }
function emptyPick(emps, ym, seen, max) {
  const L = Array.isArray(emps) ? emps : [], S = new Set(Array.isArray(seen) ? seen : []), lim = max == null ? 2 : max;
  const z = L.filter((e) => e && e.z && e.z[ym]);
  const ids = z.map((e) => String(e.id)).filter((id) => S.has(id));
  if (!ids.length) return { ids: [], warn: '' };
  if (z.length === L.length || ids.length > lim) return { ids: [], warn: 'hours-empty-many' };
  return { ids, warn: '' };
}
const api = { MAX_ROWS, M_RE, pDate, pTime, pDur, header, parse, monthsFor, titleName, emptyPick };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxHours = api;
})(typeof self !== 'undefined' ? self : this);
