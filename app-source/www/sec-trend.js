// גיטי – ניתוחים (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק ב): מגמות, הוצאה חריגה והצעות הזמנה. קריאה בלבד – פונקציות טהורות (בלי Firestore ובלי DOM).
// אותו קובץ בדיוק: app-source/www/sec-trend.js (מסך "ניתוחים" במכשיר) ו-firebase/functions/lib/sec-trend.js (הכלים בצ'אט וסיכום הבוקר).
// בדיקה: firebase/tests/sec-trend.unit.test.js (כולל השוואה ששני הקבצים זהים).
//
// הקלט: נתוני הכספים (fin) – מהמכשיר (secretary.js → secFin) או מהמראה בענן (sec-tools.js → cleanFin). אין כאן נוסחה כספית:
//   fin.months[YYYY-MM] = { inc, exp, cats: [[קטגוריה, 'i'|'e', סכום]], sp?: [[מספר ב-spn, סכום]] }  – הסכומים כמו במסכי ההכנסות וההוצאות
//     (catTotal / monthExpense: לפי תאריך הרשומה, זיכוי בסכום שלילי, החזר כספי = 0).
//   fin.spn?  = [[שם הספק, 'i'|'e', קטגוריה]]  – רשימת הכרטיסים (בלי עובדים/שכר).
//   fin.ord?  = [[מספר ב-spn, [ימים]]]  – ימי החשבוניות של ספקי סחורה (יום = מספר הימים מ-1.1.1970), בלי זיכויים.
// מכשיר ישן (בלי sp/spn/ord) – רק מגמות לפי קטגוריה; לפי ספק והצעות הזמנה: "אין מספיק נתונים".
//
// הגדרות (החלטות המשתמש 24.11.2026, סעיפים 5–7):
//   מגמות: 12 חודשים עד החודש שנבחר; לכל שורה – החודש מול החודש הקודם ומול אותו חודש אשתקד.
//   חריגה: הוצאה חודשית לספק או לקטגוריה שגבוהה ב-30% לפחות מהממוצע של 3 החודשים הקודמים, וגם מעל 200 ₪.
//     הממוצע – של החודשים שהיו בהם הוצאות (סכום חיובי) מתוך ה-3; צריך לפחות 2 כאלה, אחרת "אין היסטוריה" ← לא חריג (הנחה).
//     זיכויים מורידים את הסכום החודשי (סך שלילי או 0 – לא חריג). נבדקים החודש הנוכחי והחודש הקודם.
//     בלי כפילות: קטגוריה לא מסומנת כחריגה אם באותו חודש כבר סומן ספק חריג מאותה קטגוריה (זו אותה הוצאה – הנחה). מזהה קבוע לכל חריגה (key):
//     ספק – an:sup:<קטגוריה>:<שם>:<חודש> (שני ספקים באותו שם בקטגוריות שונות – שתי חריגות נפרדות); קטגוריה – an:cat:<שם>:<חודש>.
//   הצעת הזמנה: ספק סחורה עם לפחות 3 ימי חשבונית ב-365 הימים האחרונים; הקצב = החציון של הימים בין חשבוניות;
//     מוצע כשעברו לפחות (קצב − 1) ימים מהאחרונה, ולא יותר מפי 3 מהקצב (או קצב + 14) – אחרת כנראה הפסיקו לעבוד איתו. הצעה בלבד.
(function (root) {
'use strict';
const MON_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PCT = 30, MIN = 200, HIST = 3, HIST_MIN = 2, MONTHS = 12, ORD_MIN = 3, ORD_DAYS = 365;
const rnd = (x) => Math.round((+x || 0) * 100) / 100;
const ag = (x) => Math.round((+x || 0) * 100);
const addMon = (m, k) => { const [y, x] = m.split('-').map(Number); const d = new Date(Date.UTC(y, x - 1 + k, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const dayNum = (d) => (DAY_RE.test(d) ? Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5) : null);
const dayStr = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
// שינוי באחוזים מול בסיס חיובי בלבד (בסיס 0 או שלילי – אין אחוז משמעותי)
const pct = (a, b) => (b > 0.004 ? Math.round(((a - b) / b) * 100) : null);
const monOf = (fin, today) => (MON_RE.test(today && today.slice(0, 7)) ? today.slice(0, 7) : null);
const firstMon = (fin) => Object.keys((fin && fin.months) || {}).filter((m) => MON_RE.test(m)).sort()[0] || null;
const hasSup = (fin) => !!(fin && Array.isArray(fin.spn) && fin.spn.length);

// סדרות: מפתח → { by, name, kind, cat, v: { חודש: סכום } }. by = 'cat' (קטגוריה) | 'sup' (ספק)
function seriesOf(fin) {
  const S = new Map(), spn = hasSup(fin) ? fin.spn : [];
  const put = (key, o, m, v) => { let r = S.get(key); if (!r) { r = Object.assign({ v: {} }, o); S.set(key, r); } r.v[m] = rnd((r.v[m] || 0) + v); };
  for (const [m, x] of Object.entries((fin && fin.months) || {})) {
    if (!MON_RE.test(m) || !x) continue;
    for (const c of x.cats || []) put('c|' + c[1] + '|' + c[0], { by: 'cat', name: c[0], kind: c[1] }, m, c[2]);
    for (const r of x.sp || []) { const s = spn[r[0]]; if (s) put('s|' + r[0], { by: 'sup', name: s[0], kind: s[1], cat: s[2] || '' }, m, r[1]); }
  }
  return S;
}

// חריגה: cur – הסכום החודשי; hist – סכומי 3 החודשים הקודמים. השוואה באגורות (בלי שגיאות עיגול): cur ≥ ממוצע × 1.3 ⇔ cur × n × 100 ≥ סכום × 130
function isAnomaly(cur, hist) {
  const H = (hist || []).filter((v) => typeof v === 'number' && ag(v) > 0);
  if (H.length < HIST_MIN || !(ag(cur) > MIN * 100)) return null;
  const s = H.reduce((a, v) => a + ag(v), 0), n = H.length;
  if (ag(cur) * n * 100 < s * (100 + PCT)) return null;
  const avg = rnd(s / n / 100);
  return { avg3: avg, over: rnd(cur - avg), overPct: pct(cur, avg), months: n };
}

// o: { today: 'YYYY-MM-DD' }. מחזיר רשימה (החדשה והגדולה קודם)
function anomalies(fin, o) {
  const m0 = monOf(fin, o && o.today), f0 = firstMon(fin);
  if (!m0 || !f0) return [];
  const S = seriesOf(fin), out = [];
  for (const mon of [m0, addMon(m0, -1)]) {
    if (addMon(mon, -HIST) < f0) continue; // אין 3 חודשים של נתונים לפני החודש הזה – אין היסטוריה
    const flagged = [];
    for (const by of ['sup', 'cat']) {
      for (const r of S.values()) {
        if (r.by !== by || r.kind !== 'e') continue;
        const cur = r.v[mon] || 0;
        if (by === 'cat' && flagged.some((x) => x.cat && x.cat === r.name)) continue; // אותה הוצאה כבר סומנה לפי הספק
        const a = isAnomaly(cur, [1, 2, 3].map((k) => r.v[addMon(mon, -k)] || 0));
        if (!a) continue;
        // מזהה: לספק – גם הקטגוריה וסוג הכרטיס (שם ספק ייחודי רק בתוך קטגוריה); לקטגוריה – השם (תיקון בדיקה סבב 1)
        const x = Object.assign({ key: 'an:' + by + ':' + (by === 'sup' ? (r.cat || '') + ':' : '') + r.name + ':' + mon, by, name: r.name, month: mon, amount: rnd(cur) }, a, r.cat ? { cat: r.cat } : {});
        flagged.push(x); out.push(x);
      }
    }
  }
  return out.sort((a, b) => b.month.localeCompare(a.month) || b.over - a.over);
}

// o: { month?, today, by?: 'cat'|'sup'|'all', kind?: 'e'|'i'|'all', q?: חיפוש בשם, limit? }
function trends(fin, o) {
  o = o || {};
  const today = monOf(fin, o.today);
  const mon = MON_RE.test(o.month) ? o.month : today;
  if (!mon) return { error: 'no-data' };
  const months = []; for (let i = MONTHS - 1; i >= 0; i--) months.push(addMon(mon, -i));
  const prev = addMon(mon, -1), ly = addMon(mon, -12);
  const M = (fin && fin.months) || {};
  const totals = months.map((m) => ({ month: m, income: (M[m] && M[m].inc) || 0, expenses: (M[m] && M[m].exp) || 0 }));
  const by = ['cat', 'sup'].includes(o.by) ? o.by : 'all', kind = ['e', 'i'].includes(o.kind) ? o.kind : 'all';
  const q = typeof o.q === 'string' ? o.q.trim().toLowerCase() : '';
  const rows = [];
  for (const r of seriesOf(fin).values()) {
    if ((by !== 'all' && r.by !== by) || (kind !== 'all' && r.kind !== kind)) continue;
    if (q && !String(r.name).toLowerCase().includes(q)) continue;
    const series = months.map((m) => r.v[m] || 0);
    if (!series.some((v) => Math.abs(v) > 0.004) && !(Math.abs(r.v[ly] || 0) > 0.004)) continue;
    const cur = r.v[mon] || 0, pv = r.v[prev] || 0, lv = r.v[ly] || 0;
    rows.push(Object.assign({ by: r.by, name: r.name, kind: r.kind, month: rnd(cur), prevMonth: rnd(pv), lastYear: rnd(lv), vsPrevPct: pct(cur, pv), vsLastYearPct: pct(cur, lv),
      avg12: rnd(series.reduce((a, v) => a + v, 0) / MONTHS), series }, r.cat ? { cat: r.cat } : {}));
  }
  rows.sort((a, b) => Math.abs(b.month) - Math.abs(a.month) || Math.abs(b.prevMonth) - Math.abs(a.prevMonth));
  const lim = Math.min(200, Math.max(1, Math.round(+o.limit) || 200));
  return { month: mon, prevMonth: prev, lastYearMonth: ly, months, totals, rows: rows.slice(0, lim), more: Math.max(0, rows.length - lim),
    hasSup: hasSup(fin), hasLastYear: !!M[ly], firstMonth: firstMon(fin) };
}

// o: { today: 'YYYY-MM-DD', all?: true – גם ספקים שעוד לא הגיע זמנם }
function orderTips(fin, o) {
  const t = dayNum(o && o.today);
  if (t === null || !hasSup(fin) || !Array.isArray(fin.ord)) return [];
  const out = [];
  for (const [i, D] of fin.ord) {
    const s = fin.spn[i];
    if (!s || !Array.isArray(D)) continue;
    const L = [...new Set(D.filter((d) => Number.isInteger(d) && d <= t && d > t - ORD_DAYS))].sort((a, b) => a - b);
    if (L.length < ORD_MIN) continue;
    const gaps = L.slice(1).map((d, k) => d - L[k]).sort((a, b) => a - b);
    const h = gaps.length >> 1, med = gaps.length % 2 ? gaps[h] : (gaps[h - 1] + gaps[h]) / 2;
    const every = Math.max(1, Math.round(med)), last = L[L.length - 1], since = t - last;
    const due = since >= every - 1 && since <= Math.max(every * 3, every + 14);
    if (!due && !(o && o.all)) continue;
    out.push({ name: s[0], cat: s[2] || '', every, lastDate: dayStr(last), daysSince: since, orders: L.length, due, late: since > every });
  }
  return out.sort((a, b) => b.daysSince / b.every - a.daysSince / a.every || a.name.localeCompare(b.name));
}

// "הכן הזמנה" (החלטת המשתמש 24.11.2026): טיוטה בלבד. בדיקת הקלט ובניית הנוסח – כאן; השרת (secPrefs op:'ordDraft') שומר אותה כהצעה במרכז האישורים
//   (sec_cmt ch:'ord', מזהה קבוע מ-key – הצעה אחת לכל ספק וחשבונית אחרונה), ובאישור נפתחת משימה עם הנוסח להעתקה. אין שליחה לספק.
const cleanS = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
function orderDraft(o) {
  o = o || {};
  const sup = cleanS(o.sup, 60), last = DAY_RE.test(o.last) ? o.last : '', every = Number.isInteger(o.every) && o.every >= 1 && o.every <= 365 ? o.every : 0;
  if (!sup || !last || !every) return null;
  const dm = (+last.slice(8, 10)) + '.' + (+last.slice(5, 7));
  return { key: 'ord|' + sup.toLowerCase() + '|' + last, sup, last, every, what: 'להזמין מספק ' + sup,
    prev: 'שלום, נבקש להזמין כרגיל (כמו בהזמנה הקודמת מ-' + dm + '). נא לאשר מועד אספקה. תודה' };
}

const api = { PCT, MIN, HIST, MONTHS, ORD_MIN, addMon, dayNum, dayStr, pct, isAnomaly, anomalies, trends, orderTips, orderDraft, seriesOf };
// שרת (Node) – module.exports; אפליקציה (דפדפן) – window.SecTrend
if (typeof module === 'object' && module.exports) module.exports = api; else root.SecTrend = api;
})(typeof self !== 'undefined' ? self : this);
