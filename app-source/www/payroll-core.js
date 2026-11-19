// מודול שכר ותלושים – שלב א' (משימה 2026-11-18_שכר-ותלושים). חישוב טהור: בלי DOM, בלי localStorage ובלי גלובלים.
// נטען באפליקציה (window.PayCore) ובבדיקות node (module.exports). בדיקה: firebase/tests/payroll.unit.test.js
//
// יחידות: הקלט כמו שהוא שמור ב-S – סכומים בש"ח (rate/mo/r לשעה, add.a, bon.a, psl.net, tx.amt), שעות "HH:MM", תאריך "YYYY-MM-DD".
// הפלט כולו באגורות שלמות ובדקות שלמות. תעריף לשעה הופך לאגורות פעם אחת, וסכום השעות (Σ דקות × אגורות לשעה ÷ 60)
// מתעגל פעם אחת בסוף. קלט פגום לא זורק – נספר כ-0 או נדלג, ונרשם ב-warnings.
//
// s.pay: {mode:'hr'|'mo', rate, mo, m, slip, uid, rules:[{id,d:[0..6],s,e,r}], add:[{id,n,k:'mo'|'day',a}], comp:[רכיבים – ראו validComp למטה]}
// שעות S.wh: {id,sub,d,in,out,brk,src,n} · בונוס S.bon: {id,sub,mon,a,n[,src:'auto',cid,calc,det]} · תלוש S.psl: {id,sub,mon,net,gross,ok,at}
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
// עובד בלי pay ← null (אין שינוי התנהגות). עם pay.comp: data גם {tasks, salesByDay, hoursOpenByDay, now} (ראו compSum),
// והתוצאה כוללת גם comp, exp (בונוס צפוי שלא אושר, באגורות – לא נכלל ב-due/left) ו-hints. בלי pay.comp – התוצאה כמו קודם.
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
  const R = { sub: id, mon, mode, minutes, days: nd, rows, base, adds, bonus, bons, calc, slip, due, paid, left, status, toAccountant, warnings: [...new Set(w)] };
  // רכיבי שכר (שלב B): רק כשיש pay.comp. בונוס צפוי (exp) לא נכנס ל-calc/due/left. רכיב שאושר (bon src:'auto' עם cid) – נספר רק דרך bons
  if (Array.isArray(p.comp)) {
    const cs = compSum(sub, mon, D), ap = apprMap(id, mon, D.bon);
    cs.items.forEach((it) => { if (ap.has(it.id)) { it.appr = true; it.bonA = ap.get(it.id); } });
    R.comp = cs.items;
    R.exp = cs.items.reduce((s, it) => s + (it.appr || it.man ? 0 : it.amt), 0);
    R.hints = cs.items.filter((it) => !it.appr).reduce((a, it) => a.concat(it.hints), []);
    R.warnings = [...new Set(R.warnings.concat(cs.warnings))];
  }
  return R;
}

// ===== רכיבי שכר גמישים (שלב B, משימה 2026-11-19_תנאי-שכר-והערות-עובד) =====
// pay.comp:[{id,k,n,on,src?,ai?,...}] – סכומים בקלט בש"ח, אחוזים 0–100. הפלט באגורות שלמות.
//  tk: {m:'all',a} | {m:'tier',t:[{p,a}]}   – בונוס משימות בזמן (כולן / מדרגות אחוז בזמן)
//  sl: {t:[{min,a}], ss:'day'|'hrs'}         – בונוס מדרגות מכירות (המדרגה הגבוהה שהושגה)
//  pc: {p, th?, ss}                          – אחוז מהמכירות (מהכול, או רק מהחלק שמעל th)
//  man: {n}                                  – בונוס ידני, בלי חישוב (תזכורת למנהל)
// ss:'day' = מכירות החנות בימים שבהם לעובד יש שעות; ss:'hrs' = הערכה: מכירות היום × (דקות העובד ÷ דקות פעילות), עד 1.
const KN = { tk: 'בונוס משימות בזמן', sl: 'בונוס מכירות', pc: 'אחוז ממכירות', man: 'בונוס ידני' };
// אגורות → "52,300" / "52,300.50"
function fmt(ag) {
  const v = Math.round(Number(ag) || 0), neg = v < 0, a = Math.abs(v);
  const sh = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ','), c = a % 100;
  return (neg ? '-' : '') + sh + (c ? '.' + String(c).padStart(2, '0') : '');
}
const pctTxt = (x) => String(Math.round(x * 10) / 10);
// אימות ונרמול רכיב. מחזיר {ok, comp, err}; לא משנה את הקלט
function validComp(c) {
  const bad = (err) => ({ ok: false, comp: null, err });
  if (!c || typeof c !== 'object' || Array.isArray(c)) return bad('רכיב לא תקין');
  if (typeof c.id !== 'string' || !c.id.trim() || c.id.length > 60) return bad('חסר מזהה רכיב');
  if (!KN[c.k]) return bad('סוג רכיב לא מוכר');
  const n = typeof c.n === 'string' && c.n.trim() ? c.n.trim().slice(0, 80) : KN[c.k];
  const on = !(c.on === false || c.on === 0 || c.on === '0');
  const o = { id: c.id.trim(), k: c.k, n, on };
  if (typeof c.src === 'string' && c.src) o.src = c.src.slice(0, 500);
  if (c.ai) o.ai = 1;
  const amt = (v) => { const x = num(v); return x !== null && x >= 0 ? x : null; };
  const ss = c.ss === undefined || c.ss === null || c.ss === '' ? 'day' : c.ss;
  if ((c.k === 'sl' || c.k === 'pc') && ss !== 'day' && ss !== 'hrs') return bad('בסיס מכירות לא מוכר (day/hrs)');
  if (c.k === 'tk') {
    if (c.m === 'all') { const a = amt(c.a); if (a === null) return bad('סכום בונוס לא תקין'); o.m = 'all'; o.a = a; }
    else if (c.m === 'tier') {
      if (!Array.isArray(c.t) || !c.t.length || c.t.length > 20) return bad('חסרות מדרגות');
      const t = [];
      for (const u of c.t) {
        const p = u && num(u.p), a = u && amt(u.a);
        if (p === null || p < 0 || p > 100) return bad('אחוז מדרגה לא תקין (0–100)');
        if (a === null) return bad('סכום מדרגה לא תקין');
        t.push({ p, a });
      }
      t.sort((x, y) => x.p - y.p);
      if (t.some((u, i) => i && u.p === t[i - 1].p)) return bad('שתי מדרגות באותו אחוז');
      o.m = 'tier'; o.t = t;
    } else return bad('סוג בונוס משימות לא מוכר (all/tier)');
  } else if (c.k === 'sl') {
    if (!Array.isArray(c.t) || !c.t.length || c.t.length > 20) return bad('חסרות מדרגות');
    const t = [];
    for (const u of c.t) {
      const mn = u && amt(u.min), a = u && amt(u.a);
      if (mn === null) return bad('סף מדרגה לא תקין');
      if (a === null) return bad('סכום מדרגה לא תקין');
      t.push({ min: mn, a });
    }
    t.sort((x, y) => x.min - y.min);
    if (t.some((u, i) => i && u.min === t[i - 1].min)) return bad('שתי מדרגות באותו סף');
    o.t = t; o.ss = ss;
  } else if (c.k === 'pc') {
    const p = num(c.p);
    if (p === null || p <= 0 || p > 100) return bad('אחוז לא תקין (מעל 0 ועד 100)');
    o.p = p;
    if (c.th !== undefined && c.th !== null && c.th !== '') { const th = amt(c.th); if (th === null) return bad('סף לא תקין'); o.th = th; }
    o.ss = ss;
  }
  return { ok: true, comp: o, err: '' };
}
function nextDay(d) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10); }
// בסיס המכירות של העובד בחודש (אגורות). {ag, est, days, w}
function salesBase(id, mon, ctx, ss) {
  const w = [], S = ctx.salesByDay, H = ctx.hoursOpenByDay;
  const own = [];
  (Array.isArray(ctx.wh) ? ctx.wh : []).forEach((r) => {
    if (!r || r.sub !== id || typeof r.d !== 'string' || r.d.slice(0, 7) !== mon) return;
    const sm = shiftMin(r);
    if (sm.ok && sm.min > 0) own.push({ d: r.d, sm });
  });
  const days = [...new Set(own.map((x) => x.d))].sort();
  if (!S || typeof S !== 'object') { w.push('אין נתוני מכירות – בונוס המכירות נספר 0'); return { ag: 0, est: ss === 'hrs', days: days.length, w }; }
  const sale = (d) => { const v = num(S[d]); return v === null ? null : toAg(v); };
  let miss = 0;
  if (ss === 'day') {
    let ag = 0;
    days.forEach((d) => { const v = sale(d); if (v === null) miss++; else ag += v; });
    if (miss) w.push('חסרים נתוני מכירות ל-' + miss + ' ימי עבודה – נספרו 0');
    return { ag, est: false, days: days.length, w };
  }
  // hrs: דקות העובד לפי יום קלנדרי (משמרת שחוצה חצות מתחלקת בין שני הימים; ההפסקה מתחלקת יחסית)
  const em = new Map();
  own.forEach(({ d, sm }) => {
    const p1 = Math.min(sm.gross, DAY - sm.start), f = sm.min / sm.gross;
    em.set(d, (em.get(d) || 0) + p1 * f);
    if (sm.gross > p1) { const d2 = nextDay(d); em.set(d2, (em.get(d2) || 0) + (sm.gross - p1) * f); }
  });
  let x = 0, noOpen = 0;
  [...em.keys()].sort().forEach((d) => {
    const v = sale(d);
    if (v === null) { miss++; return; }
    const op = H && typeof H === 'object' ? num(H[d]) : null;
    if (op === null || op <= 0) { if (v) noOpen++; return; }
    x += v * Math.min(1, em.get(d) / op);
  });
  if (miss) w.push('חסרים נתוני מכירות ל-' + miss + ' ימי עבודה – נספרו 0');
  if (noOpen) w.push('אין שעות פעילות ל-' + noOpen + ' ימים עם מכירות – נספרו 0 בהערכה לפי שעות');
  return { ag: rnd(x), est: true, days: em.size, w };
}
const isLateFlag = (v) => v === '1' || v === 1 || v === true;
// חישוב רכיב אחד (רכיב מנורמל ע"י validComp). get(ss) מחזיר את בסיס המכירות (במטמון)
function compOne(c, ctx, get) {
  const it = { id: c.id, k: c.k, n: c.n, amt: 0, det: [], hints: [] };
  const hint = (t, x) => it.hints.push(Object.assign({ cid: c.id, n: c.n, t }, x || {}));
  if (c.k === 'man') { it.man = true; it.det.push('בונוס ידני – הסכום נקבע על ידי המנהל ונרשם כבונוס'); return it; }
  if (c.k === 'tk') {
    const nw = num(ctx.now) !== null ? num(ctx.now) : Date.now();
    let on = 0, nod = 0;
    const late = [], lateOpen = [], pend = [];
    (Array.isArray(ctx.tasks) ? ctx.tasks : []).forEach((t) => {
      if (!t || typeof t !== 'object') return;
      const dl = num(t.dl);
      if (dl === null || dl <= 0) { nod++; return; }
      const done = t.st === 'done', sb = num(t.sub);
      if (isLateFlag(t.late)) late.push(t);
      else if (done) on++;
      else if (t.st === 'wait' && sb !== null && sb > 0) (sb <= dl ? pend : late).push(t);
      else if (nw > dl) lateOpen.push(t);
      else pend.push(t);
    });
    const dec = on + late.length + lateOpen.length, pct = dec ? (on * 100) / dec : null;
    it.tk = { on, late: late.length, lateOpen: lateOpen.length, pend: pend.length, nod, dec, pct };
    it.det.push(dec ? on + ' מתוך ' + dec + ' משימות בזמן (' + pctTxt(pct) + '%)' : 'אין עדיין משימות עם יעד שעבר החודש');
    if (late.length) it.det.push(late.length + ' באיחור');
    if (lateOpen.length) it.det.push(lateOpen.length + ' פתוחות אחרי היעד');
    if (pend.length) it.det.push(pend.length + ' פתוחות שהיעד שלהן עוד לא עבר');
    if (nod) it.det.push(nod + ' בלי יעד – לא נספרות');
    const names = (L) => L.slice(0, 5).map((t) => t.n || t.txt || t.id || '?').join(', ') + (L.length > 5 ? ' ועוד ' + (L.length - 5) : '');
    if (late.length) hint('משימות שאחרו: ' + names(late), { late: late.length });
    if (lateOpen.length) hint('משימות פתוחות אחרי היעד: ' + names(lateOpen) + ' – כדאי לסיים בהקדם', { lateOpen: lateOpen.length });
    const bad = late.length + lateOpen.length;
    if (c.m === 'all') {
      const aAg = toAg(c.a);
      it.amt = dec && !bad ? aAg : 0;
      it.det.push(it.amt ? 'כל המשימות בזמן = ' + fmt(aAg) : 'בונוס ' + fmt(aAg) + ' ניתן כשכל המשימות בזמן');
      if (bad) hint('הבונוס (' + fmt(aAg) + ' ₪) ניתן רק כשכל המשימות בזמן – החודש כבר יש ' + bad + ' באיחור', { next: aAg });
      else if (pend.length) hint('סיים בזמן את ' + pend.length + ' המשימות הפתוחות כדי ' + (dec ? 'לשמור על' : 'לקבל את') + ' הבונוס (' + fmt(aAg) + ' ₪)', { next: aAg });
      return it;
    }
    const T = c.t.map((u) => ({ p: u.p, a: toAg(u.a) }));
    let cur = null;
    if (pct !== null) T.forEach((u) => { if (pct >= u.p) cur = u; });
    it.amt = cur ? cur.a : 0;
    it.det.push(cur ? 'מדרגה ' + pctTxt(cur.p) + '% = ' + fmt(cur.a) : 'מתחת למדרגה הראשונה (' + pctTxt(T[0].p) + '%)');
    const nx = T.find((u) => pct === null || u.p > pct);
    if (nx) {
      const base = 'למדרגה ' + pctTxt(nx.p) + '% (' + fmt(nx.a) + ' ₪) צריך ' + pctTxt(nx.p) + '% בזמן';
      if (pct === null) hint(base, { need: nx.p, next: nx.a });
      else if (nx.p >= 100) hint(base + ' – לא אפשרי החודש (יש ' + bad + ' באיחור)', { need: nx.p, next: nx.a, gapPct: Math.round((nx.p - pct) * 10) / 10 });
      else {
        const k = Math.max(1, Math.ceil((nx.p * dec - 100 * on) / (100 - nx.p) - 1e-9));
        hint(base + ' – עוד ' + k + ' משימות בזמן בלי איחורים (עכשיו ' + pctTxt(pct) + '%)', { need: nx.p, next: nx.a, gapPct: Math.round((nx.p - pct) * 10) / 10, k });
      }
    }
    return it;
  }
  // sl / pc
  const sb = get(c.ss);
  it.sales = sb.ag;
  if (sb.est) it.est = true;
  const sl = 'מכירות ' + fmt(sb.ag);
  const basis = c.ss === 'hrs' ? 'הערכה: חלק יחסי ממכירות החנות לפי השעות שעבדת מתוך שעות הפעילות (' + sb.days + ' ימים)' : 'לפי מכירות החנות ב-' + sb.days + ' ימי עבודה';
  if (c.k === 'sl') {
    const T = c.t.map((u) => ({ min: toAg(u.min), a: toAg(u.a) }));
    let cur = null;
    T.forEach((u) => { if (sb.ag >= u.min) cur = u; });
    it.amt = cur ? cur.a : 0;
    it.det.push(cur ? sl + ' ← מדרגה ' + fmt(cur.min) + ' = ' + fmt(cur.a) : sl + ' ← מתחת למדרגה הראשונה (' + fmt(T[0].min) + ')');
    it.det.push(basis);
    const nx = T.find((u) => u.min > sb.ag);
    if (nx) {
      const gap = nx.min - sb.ag, gp = nx.min ? Math.round((gap * 1000) / nx.min) / 10 : 100;
      hint('חסרים ' + fmt(gap) + ' ₪ במכירות (' + pctTxt(gp) + '% מהיעד) למדרגה ' + fmt(nx.min) + ' – בונוס ' + fmt(nx.a) + ' ₪' + (cur ? ' במקום ' + fmt(cur.a) + ' ₪' : ''), { gap, gapPct: gp, next: nx.a });
    }
    return it;
  }
  const thAg = c.th !== undefined ? toAg(c.th) : 0, b = Math.max(0, sb.ag - thAg);
  it.amt = rnd(Math.round(b * c.p * 100) / 10000);
  if (c.th !== undefined && sb.ag < thAg) it.det.push(sl + ' – עדיין מתחת לסף ' + fmt(thAg) + ' = 0');
  else if (c.th !== undefined) it.det.push(sl + ' − סף ' + fmt(thAg) + ' = ' + fmt(b) + ' × ' + c.p + '% = ' + fmt(it.amt));
  else it.det.push(sl + ' × ' + c.p + '% = ' + fmt(it.amt));
  it.det.push(basis);
  if (c.th !== undefined && sb.ag < thAg) {
    const gap = thAg - sb.ag, gp = thAg ? Math.round((gap * 1000) / thAg) / 10 : 0;
    hint('חסרים ' + fmt(gap) + ' ₪ במכירות (' + pctTxt(gp) + '% מהסף) עד הסף ' + fmt(thAg) + ' – מעליו מקבלים ' + c.p + '% מכל שקל', { gap, gapPct: gp });
  } else hint('כל 1,000 ₪ מכירות נוספות = עוד ' + fmt(Math.round(1000 * c.p)) + ' ₪', { per1k: Math.round(1000 * c.p) });
  return it;
}
// חישוב כל הרכיבים הפעילים של העובד בחודש. ctx = {wh, tasks, salesByDay, hoursOpenByDay, now}
// מחזיר {items:[{id,k,n,amt,det:[],hints:[],est?,man?,tk?,sales?}], sum, hints, warnings}. לא זורק.
function compSum(sub, mon, ctx) {
  const out = { items: [], sum: 0, hints: [], warnings: [] };
  const p = sub && typeof sub === 'object' && sub.pay && typeof sub.pay === 'object' ? sub.pay : null;
  if (!p || !Array.isArray(p.comp)) return out;
  const C = ctx && typeof ctx === 'object' ? ctx : {}, w = out.warnings;
  if (!monOk(mon)) { w.push('חודש לא תקין'); return out; }
  const cache = {};
  const get = (ss) => { if (!cache[ss]) { cache[ss] = salesBase(sub.id, mon, C, ss); cache[ss].w.forEach((x) => w.push(x)); } return cache[ss]; };
  p.comp.forEach((c, i) => {
    const v = validComp(c);
    if (!v.ok) { w.push('רכיב שכר לא תקין – לא חושב' + (c && c.id ? ' (' + c.id + ')' : ' (#' + (i + 1) + ')') + ': ' + v.err); return; }
    if (!v.comp.on) return;
    let it;
    try { it = compOne(v.comp, C, get); } catch (e) { w.push('שגיאה בחישוב רכיב ' + v.comp.id + ' – נספר 0'); return; }
    out.items.push(it);
  });
  out.sum = out.items.reduce((s, it) => s + (it.man ? 0 : it.amt), 0);
  out.hints = out.items.reduce((a, it) => a.concat(it.hints), []);
  out.warnings = [...new Set(w)];
  return out;
}
// רכיבים שכבר אושרו לחודש: bon עם src:'auto' ו-cid → סכום באגורות
function apprMap(id, mon, bon) {
  const m = new Map();
  (Array.isArray(bon) ? bon : []).forEach((b) => {
    if (!b || b.sub !== id || b.mon !== mon || b.src !== 'auto' || typeof b.cid !== 'string' || !b.cid) return;
    m.set(b.cid, (m.get(b.cid) || 0) + toAg(b.a));
  });
  return m;
}
// רשומות bon מוצעות לכל רכיב מחושב (לא man) שעוד לא אושר: {sub,mon,a,n,src:'auto',cid,calc,det[,est]} – a/calc בש"ח כמו S.bon
// (כולל רכיב שיצא 0 – כדי שאישור ירשום "נבדק" ויעצור את החישוב החי; המסך יכול לסנן). בלי id – הקורא מוסיף.
function autoBon(sub, mon, ctx) {
  const cs = compSum(sub, mon, ctx);
  const ap = apprMap(sub && sub.id, mon, ctx && ctx.bon);
  return cs.items.filter((it) => !it.man && !ap.has(it.id)).map((it) => {
    const r = { sub: sub.id, mon, a: it.amt / 100, n: it.n, src: 'auto', cid: it.id, calc: it.amt / 100, det: it.det.join(' · ') };
    if (it.est) r.est = true;
    return r;
  });
}

const api = { num, toAg, hm, ymdOk, monOk, wdOf, shiftMin, splitMin, rateAt, monthSum, validComp, compSum, autoBon, fmtAg: fmt };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PayCore = api;
})(typeof self !== 'undefined' ? self : this);
