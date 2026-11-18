// מודול שכר ותלושים – שלב א' (משימה 2026-11-18_שכר-ותלושים). חישוב טהור: בלי DOM, בלי localStorage ובלי גלובלים.
// נטען באפליקציה (window.PayCore) ובבדיקות node (module.exports). בדיקה: firebase/tests/payroll.unit.test.js
//
// יחידות: הקלט כמו שהוא שמור ב-S – סכומים בש"ח (rate/mo/r לשעה, add.a, bon.a, psl.net, tx.amt), שעות "HH:MM", תאריך "YYYY-MM-DD".
// הפלט כולו באגורות שלמות ובדקות שלמות. תעריף לשעה הופך לאגורות פעם אחת, וסכום השעות (Σ דקות × אגורות לשעה ÷ 60)
// מתעגל פעם אחת בסוף. קלט פגום לא זורק – נספר כ-0 או נדלג, ונרשם ב-warnings.
//
// s.pay: {mode:'hr'|'mo', rate, mo, m, slip, uid, rules:[{id,d:[0..6],s,e,r}], add:[{id,n,k:'mo'|'day',a}]}
// שעות S.wh: {id,sub,d,in,out,brk,src,n} · בונוס S.bon: {id,sub,mon,a,n} · תלוש S.psl: {id,sub,mon,net,gross,ok,at}
(function (root) {
'use strict';
const DAY = 1440;
// מספר תקין (גם מחרוזת מספרית מטופס); אחרת null
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}
// ש"ח → אגורות שלמות (עיגול חצי מהאפס; רעש נקודה צפה לא מזיז)
function toAg(sh) {
  const n = num(sh);
  if (n === null) return 0;
  const x = Math.round(Math.abs(n) * 10000) / 100;
  return n < 0 ? -Math.round(x) : Math.round(x);
}
// עיגול סימטרי לשלם
const rnd = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
// "HH:MM" → דקות מתחילת היום. e24=true מתיר "24:00" (סוף כלל תעריף)
function hm(v, e24) {
  const m = typeof v === 'string' && /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (mi > 59) return null;
  if (h === 24 && mi === 0 && e24) return DAY;
  return h <= 23 ? h * 60 + mi : null;
}
function ymdOk(d) {
  const m = typeof d === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
}
const monOk = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
// יום בשבוע לפי UTC (בלי תלות באזור הזמן של המכשיר): 0=ראשון … 6=שבת
const wdOf = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).getUTCDay(); };

// משך שורת שעות. out<in ← חוצה חצות; out==in ← 0 עם אזהרה (טעות הזנה) (היציאה למחרת). brk = דקות הפסקה, יורדות מהמשך.
// מחזיר {ok, min, gross, brk, x, start, warnings}; start = דקה מתחילת יום d (לפיצול לפי תעריף)
function shiftMin(row) {
  const w = [];
  const r = row && typeof row === 'object' ? row : {};
  const a = hm(r.in), b = hm(r.out);
  if (!ymdOk(r.d)) w.push('תאריך לא תקין בשורת שעות' + (r.id ? ' ' + r.id : ''));
  if (a === null || b === null) w.push('שעת כניסה/יציאה לא תקינה בשורת שעות' + (r.id ? ' ' + r.id : ''));
  if (w.length) return { ok: false, min: 0, gross: 0, brk: 0, x: false, start: 0, warnings: w };
  if (b === a) { w.push('כניסה ויציאה באותה שעה – נספר כ-0 (כנראה טעות הזנה)' + (r.id ? ' (' + r.id + ')' : '')); return { ok: true, min: 0, gross: 0, brk: 0, x: false, start: a, warnings: w }; }
  const x = b < a;
  const gross = x ? b + DAY - a : b - a;
  let brk = 0;
  if (r.brk !== undefined && r.brk !== null && r.brk !== '') {
    const n = num(r.brk);
    if (n === null || n < 0) w.push('הפסקה לא תקינה – לא נוכתה' + (r.id ? ' (' + r.id + ')' : ''));
    else brk = Math.round(n);
  }
  if (brk > gross) { w.push('הפסקה ארוכה מהמשמרת – המשמרת נספרת כ-0' + (r.id ? ' (' + r.id + ')' : '')); brk = gross; }
  return { ok: true, min: gross - brk, gross, brk, x, start: a, warnings: w };
}

// כללי תעריף תקינים בלבד: {d:Set, s, e, rAg}. כלל עם e<=s חוצה חצות (החלק שאחרי חצות שייך ליום שבו הכלל התחיל)
function cleanRules(rules, w) {
  const out = [];
  (Array.isArray(rules) ? rules : []).forEach((u, i) => {
    const s = u && hm(u.s), e = u && hm(u.e, true), r = u && num(u.r);
    const d = u && Array.isArray(u.d) ? u.d.map(Number).filter((k) => Number.isInteger(k) && k >= 0 && k <= 6) : [];
    if (s === null || e === null || r === null || r < 0 || !d.length) { w.push('כלל תעריף לא תקין – לא הופעל' + (u && u.id ? ' (' + u.id + ')' : ' (#' + (i + 1) + ')')); return; }
    out.push({ d: new Set(d), s, e, x: e <= s, rAg: toAg(r) });
  });
  return out;
}
// התעריף (אגורות לשעה) לדקה t ביום בשבוע wd. חפיפה ← הגבוה. אין כלל ← base
function rateAt(rules, wd, t, base) {
  let best = null;
  for (const u of rules) {
    const hit = u.x ? ((t >= u.s && u.d.has(wd)) || (t < u.e && u.d.has((wd + 6) % 7))) : (t >= u.s && t < u.e && u.d.has(wd));
    if (hit && (best === null || u.rAg > best)) best = u.rAg;
  }
  return best === null ? base : best;
}

// פיצול דקות שורת שעות לפי תעריף. מחזיר {min, buckets:[{rAg, min}] (מהתעריף הנמוך לגבוה), sum (Σ דקות×אגורות לשעה, לא מעוגל), warnings}
// הפסקה: מנוכה מהדקות בתעריף הנמוך ביותר קודם (הנחה – ראו דוח שלב א').
function splitMin(row, pay) {
  const sm = shiftMin(row), w = sm.warnings.slice();
  const p = pay && typeof pay === 'object' ? pay : {};
  if (!sm.ok) return { min: 0, buckets: [], sum: 0, warnings: w };
  const baseR = num(p.rate);
  if (p.mode !== 'mo' && (baseR === null || baseR < 0)) w.push('תעריף שעתי חסר או לא תקין – נספר 0');
  const base = baseR === null || baseR < 0 ? 0 : toAg(baseR);
  const rules = cleanRules(p.rules, w);
  const wd0 = wdOf(row.d), map = new Map();
  for (let i = 0; i < sm.gross; i++) {
    const abs = sm.start + i, wd = (wd0 + Math.floor(abs / DAY)) % 7, t = abs % DAY;
    const r = rateAt(rules, wd, t, base);
    map.set(r, (map.get(r) || 0) + 1);
  }
  const buckets = [...map.entries()].map(([rAg, min]) => ({ rAg, min })).sort((a, b) => a.rAg - b.rAg);
  let left = sm.brk;
  for (const k of buckets) { const c = Math.min(left, k.min); k.min -= c; left -= c; }
  const B = buckets.filter((k) => k.min > 0);
  return { min: sm.min, buckets: B, sum: B.reduce((s, k) => s + k.min * k.rAg, 0), warnings: w };
}

const defPmon = (t) => t.plan || (t.date || '').slice(0, 7);

// סיכום חודש לעובד. sub = כרטיס העובד ({id, pay}); mon = "YYYY-MM".
// data = {wh, bon, psl, tx, pmon} – המערכים מ-S ופונקציית "חודש המשכורת" של רשומת tx (ברירת מחדל: plan || חודש התאריך).
// עובד בלי pay ← null (אין שינוי התנהגות).
function monthSum(sub, mon, data) {
  if (!sub || typeof sub !== 'object' || !sub.pay || typeof sub.pay !== 'object') return null;
  const D = data && typeof data === 'object' ? data : {};
  const p = sub.pay, id = sub.id, w = [];
  const arr = (v) => (Array.isArray(v) ? v : []);
  const pm = typeof D.pmon === 'function' ? D.pmon : defPmon;
  if (!monOk(mon)) w.push('חודש לא תקין');
  const mode = p.mode === 'mo' ? 'mo' : 'hr';
  if (p.mode !== undefined && p.mode !== 'hr' && p.mode !== 'mo') w.push('סוג שכר לא מוכר – חושב לפי שעה');

  // שעות
  let minutes = 0, sum = 0;
  const days = new Set(), rows = [];
  arr(D.wh).forEach((r) => {
    if (!r || r.sub !== id || typeof r.d !== 'string' || r.d.slice(0, 7) !== mon) return;
    const sp = splitMin(r, mode === 'mo' ? Object.assign({}, p, { rate: 0, rules: [] }) : p);
    sp.warnings.forEach((x) => w.push(x));
    if (!sp.min) return;
    minutes += sp.min; sum += sp.sum; days.add(r.d);
    rows.push({ id: r.id, d: r.d, min: sp.min, buckets: sp.buckets });
  });
  // (אזהרה שחוזרת בכל שורה – למשל תעריף חסר – מופיעה פעם אחת: warnings עובר סינון כפילויות בסוף)
  let base;
  if (mode === 'mo') {
    const m = num(p.mo);
    if (m === null || m < 0) { w.push('שכר חודשי חסר או לא תקין – נספר 0'); base = 0; } else base = toAg(m);
  } else base = rnd(sum / 60);

  // תוספות קבועות
  const nd = days.size, adds = [];
  arr(p.add).forEach((a, i) => {
    const v = a && num(a.a);
    if (!a || v === null || (a.k !== 'mo' && a.k !== 'day')) { w.push('תוספת לא תקינה – לא נספרה' + (a && a.id ? ' (' + a.id + ')' : ' (#' + (i + 1) + ')')); return; }
    const per = toAg(v), cnt = a.k === 'mo' ? 1 : nd;
    adds.push({ id: a.id, n: a.n || '', k: a.k, per, cnt, amt: per * cnt });
  });
  const addSum = adds.reduce((s, a) => s + a.amt, 0);

  // בונוסים
  const bons = [];
  arr(D.bon).forEach((b) => {
    if (!b || b.sub !== id || b.mon !== mon) return;
    const v = num(b.a);
    if (v === null) { w.push('בונוס עם סכום לא תקין – לא נספר' + (b.id ? ' (' + b.id + ')' : '')); return; }
    bons.push({ id: b.id, n: b.n || '', a: toAg(v) });
  });
  const bonus = bons.reduce((s, b) => s + b.a, 0);

  // תלוש: רק לעובד בתלוש (pay.slip), ורק תלוש מאושר (ok). כמה מאושרים ← האחרון לפי at
  const isSlip = !!p.slip;
  let slip = null;
  if (isSlip) {
    const L = arr(D.psl).filter((s) => s && s.sub === id && s.mon === mon && s.ok);
    if (L.length > 1) w.push('יש יותר מתלוש מאושר אחד לחודש – נלקח האחרון');
    const good = L.filter((s) => num(s.net) !== null);
    if (L.length && !good.length) w.push('בתלוש המאושר אין נטו תקין – החישוב לפי שעות');
    good.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || (num(a.at) || 0) - (num(b.at) || 0));
    if (good.length) { const s = good[good.length - 1]; slip = { id: s.id, net: toAg(s.net), diff: 0 }; }
  }
  // עובד בתלוש: הבונוס לא נכנס לחישוב – עובר לרואה החשבון (הסכום הסופי לפי התלוש)
  const calc = base + addSum + (isSlip ? 0 : bonus);
  const toAccountant = isSlip ? bons.map((b) => ({ k: 'bon', id: b.id, n: b.n, a: b.a })) : [];
  if (slip) slip.diff = calc - slip.net;
  const due = slip ? slip.net : calc;

  // שולם: רשומות tx של העובד לאותו חודש משכורת, בלי מבוטלות (x) ובלי עלויות מעביד (ec)
  let paid = 0;
  arr(D.tx).forEach((t) => {
    if (!t || t.sub !== id || t.x || t.ec) return;
    let m;
    try { m = pm(t); } catch (e) { m = null; }
    if (m !== mon) return;
    const v = num(t.amt);
    if (v === null) { w.push('תשלום עם סכום לא תקין – לא נספר' + (t.id ? ' (' + t.id + ')' : '')); return; }
    paid += toAg(v);
  });
  const left = due - paid;
  const status = left > 0 ? 'open' : left < 0 ? 'over' : 'closed';
  return { sub: id, mon, mode, minutes, days: nd, rows, base, adds, bonus, bons, calc, slip, due, paid, left, status, toAccountant, warnings: [...new Set(w)] };
}

const api = { num, toAg, hm, ymdOk, monOk, wdOf, shiftMin, splitMin, rateAt, monthSum };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PayCore = api;
})(typeof self !== 'undefined' ? self : this);
