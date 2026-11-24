'use strict';
// גיטי – ניתוחים (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק ב, החלטות 6–10). חישוב טהור בלבד – בלי מסד, בלי AI, בלי שעון (now מבחוץ).
//
// 1. trends(fin, o) – מגמות מתוך נתוני הכספים (ST.cleanFin: מהמכשיר או ממראה הכספים בענן):
//    החודש האחרון שהסתיים (לפי התאריך של הנתונים, fin.at) מול החודש שלפניו ומול אותו חודש אשתקד – הכנסות, הוצאות, הוצאות לפי קטגוריה, ספקים.
//    החודש הנוכחי עד היום – רק כסכומים, מסומן "חלקי" (בלי אחוזי שינוי: חודש חלקי מול חודש מלא מטעה).
//    ספקים – רק כשהמכשיר שלח months[m].sups (אפליקציה מעודכנת). מראה ישנה בלי השדה: sups = null וההשוואה לספקים לא מוצגת.
//    months[m].supT = 1 – רשימת הספקים של החודש קוצרה (40 הגדולים): ספק שלא ברשימה – "לא ידוע" (לא 0), כדי לא להמציא חריגה.
// 2. הוצאה חריגה (anoms): קטגוריית הוצאה או ספק שבחודש ≥ anPct% מעל הממוצע של 3 החודשים הקודמים, וגם ההפרש ≥ anMin ₪
//    (ברירת מחדל 30% ו-200 ₪, מ-sec_cfg/perm – lib/sec-perm.js). נבדק לחודש האחרון שהסתיים, ולחודש הנוכחי (חלקי) – רק אם כבר עבר את הסף.
//    מקרי קצה: חודש היסטוריה חסר בנתונים (אין בכלל רשומה לחודש) או פחות מ-3 חודשים – לא בודקים (hist:false) ולא מנחשים.
//    ממוצע ≤ 0 (רק זיכויים / בלי הוצאה) – אין בסיס להשוואה, לא חריגה. סכום החודש שלילי (זיכוי) – לא חריגה.
//    הפקדה לבנק – לא הוצאה: המכשיר לא שולח אותה (secFin מסנן e_dep), ומשיכות בעלים בשדה נפרד (own).
// 3. anLine(tr) – שורה אחת לסיכום הבוקר.
// 4. ordSuggest(o) – הצעות הזמנה מספקים (טיוטה בלבד, ראו lib/sec-od.js):
//    א. לפי קצב מכירות ומלאי: מכירות נטו ב-28 הימים האחרונים (stockLog: קופה pos, כספית cx, הזמנות לקוח order, פחות החזרות posret/cancel),
//       כשהמלאי אמין (prod.q מספרי ולא מסומן "לא נספר" nc). מלאי שמספיק לפחות מ-7 ימים → כמות ל-21 ימים פחות המלאי.
//    ב. אחרת – לפי היסטוריית ההזמנות מהספק (supord שהוזמנו/הגיעו, 180 יום): לפחות 2 ימי הזמנה; כשעבר מרווח הזמן הממוצע – הכמות הממוצעת.
//    ג. אחרת – לא מציעים (noData). מוצר בלי ספק (prod.sup), לא זמין (on:false), או שכבר ב"להזמין מספקים" (פתוח/הוזמן) – לא מוצע.

const rnd = (x) => Math.round((+x || 0) * 100) / 100;
const MON_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TZ = 'Asia/Jerusalem';
const dayOf = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
// חודש + k (YYYY-MM)
function addMon(m, k) { const y = +m.slice(0, 4), mm = +m.slice(5, 7) - 1 + k; const d = new Date(Date.UTC(y, mm, 1)); return d.toISOString().slice(0, 7); }
// אותם שני כלים כמו ideas() ב-sec-tools.js (הוא מייבא אותם מכאן – התוצאות שלו לא משתנות)
const prevYear = (m) => (Number(m.slice(0, 4)) - 1) + m.slice(4);
const pct = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null);
const fin0 = (v) => typeof v === 'number' && Number.isFinite(v);
const DEF = { anPct: 30, anMin: 200 };
const TOP = 8, ANOM_MAX = 10;

// סכומי הוצאה לפי קטגוריה (שם; שמות כפולים – מצטרפים)
function catMap(mo) {
  const M = new Map();
  for (const c of (mo && Array.isArray(mo.cats) ? mo.cats : [])) if (Array.isArray(c) && c[1] === 'e' && fin0(c[2])) M.set(c[0], rnd((M.get(c[0]) || 0) + c[2]));
  return M;
}
// null = אין נתוני ספקים לחודש (מראה ישנה)
function supMap(mo) {
  if (!mo || !Array.isArray(mo.sups)) return null;
  const M = new Map();
  for (const r of mo.sups) if (Array.isArray(r) && fin0(r[1])) M.set(r[0], rnd((M.get(r[0]) || 0) + r[1]));
  return M;
}
// ערך לחודש: חודש חסר – null; לא ברשימה – 0, או null כשרשימת הספקים קוצרה
const catVal = (fin, m, n) => { const mo = fin.months[m]; return mo ? (catMap(mo).get(n) || 0) : null; };
function supVal(fin, m, n) {
  const mo = fin.months[m]; const M = supMap(mo);
  if (!M) return null;
  if (M.has(n)) return M.get(n);
  return mo.supT ? null : 0;
}
const cmp = (v, prev, py) => ({ v, prev, py, dPrev: v === null || prev === null ? null : pct(v, prev), dPy: v === null || py === null ? null : pct(v, py) });

// חריגות לחודש m מול 3 החודשים שלפניו. kind: 'cat' | 'sup'
function anomsOf(fin, m, kind, P, part) {
  const H = [1, 2, 3].map((k) => addMon(m, -k));
  if (!fin.months[m] || H.some((h) => !fin.months[h])) return { ok: false, L: [] };
  if (kind === 'sup' && [m].concat(H).some((h) => !supMap(fin.months[h]))) return { ok: false, L: [] };
  const cur = kind === 'cat' ? catMap(fin.months[m]) : supMap(fin.months[m]);
  const val = kind === 'cat' ? (h, n) => catVal(fin, h, n) : (h, n) => supVal(fin, h, n);
  const L = [];
  for (const [n, v] of cur) {
    if (!(v > 0)) continue;
    const hv = H.map((h) => val(h, n));
    if (hv.some((x) => x === null)) continue; // ספק שלא ידוע באחד החודשים (רשימה מקוצרת) – לא מנחשים
    const avg = rnd((hv[0] + hv[1] + hv[2]) / 3);
    if (!(avg > 0)) continue;
    const diff = rnd(v - avg);
    if (diff >= P.anMin && v >= avg * (1 + P.anPct / 100)) L.push(Object.assign({ k: kind, n, m, v, avg, diff, pct: pct(v, avg) }, part ? { part: true } : {}));
  }
  return { ok: true, L };
}

function trends(fin, o) {
  const x = o || {};
  const P = { anPct: fin0(x.anPct) ? x.anPct : DEF.anPct, anMin: fin0(x.anMin) ? x.anMin : DEF.anMin };
  if (!fin || typeof fin !== 'object' || !fin.months || typeof fin.months !== 'object' || !Number.isInteger(fin.at)) return { ok: false, err: 'no-fin' };
  const cur = dayOf(fin.at).slice(0, 7), last = addMon(cur, -1), prev = addMon(last, -1), py = prevYear(last);
  const A = fin.months[last] || null, B = fin.months[prev] || null, Y = fin.months[py] || null, C = fin.months[cur] || null;
  const out = { ok: true, at: fin.at, P, cur, last, prev, py, has: !!A, notes: [] };
  const mv = (mo, k) => (mo ? mo[k] : null);
  out.inc = cmp(mv(A, 'inc'), mv(B, 'inc'), mv(Y, 'inc'));
  out.exp = cmp(mv(A, 'exp'), mv(B, 'exp'), mv(Y, 'exp'));
  if (!A) out.notes.push('אין נתונים לחודש ' + last + '.');
  if (!B) out.notes.push('אין נתונים לחודש הקודם (' + prev + ') – אין השוואה לחודש הקודם.');
  if (!Y) out.notes.push('אין נתונים לאותו חודש אשתקד (' + py + ').');
  // קטגוריות: הגדולות בחודש האחרון
  const cm = catMap(A);
  out.cats = [...cm.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([n, v]) => Object.assign({ n }, cmp(v, B ? catVal(fin, prev, n) : null, Y ? catVal(fin, py, n) : null)));
  // ספקים: רק כשיש נתוני ספקים לחודש האחרון
  const sm = supMap(A);
  out.supOk = !!sm;
  out.sups = sm ? [...sm.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([n, v]) => Object.assign({ n }, cmp(v, supVal(fin, prev, n), supVal(fin, py, n)))) : null;
  if (A && !sm) out.notes.push('אין עדיין סכומי ספקים לחודש בנתונים (יופיעו אחרי עדכון האפליקציה במכשיר שבו נשמרים הנתונים).');
  // החודש הנוכחי עד היום – חלקי
  out.part = C ? { m: cur, to: dayOf(fin.at), inc: C.inc, exp: C.exp } : null;
  // חריגות
  const a1 = anomsOf(fin, last, 'cat', P), a2 = anomsOf(fin, last, 'sup', P), a3 = anomsOf(fin, cur, 'cat', P, true), a4 = anomsOf(fin, cur, 'sup', P, true);
  out.hist = a1.ok;
  if (!a1.ok) out.notes.push('אין 3 חודשים מלאים לפני ' + last + ' בנתונים – לא בודקים הוצאות חריגות.');
  out.anoms = a1.L.concat(a2.L).sort((p, q) => q.diff - p.diff).concat(a3.L.concat(a4.L).sort((p, q) => q.diff - p.diff)).slice(0, ANOM_MAX);
  return out;
}

const ils = (v) => (fin0(v) ? Math.round(v).toLocaleString('he-IL') + ' ₪' : '—');
const monL = (m) => (MON_RE.test(m || '') ? +m.slice(5, 7) + '/' + m.slice(0, 4) : '');
const sgn = (d) => (d > 0 ? '+' : '') + d + '%';
// שורה אחת לסיכום הבוקר. בלי נתונים – '' (השורה לא מופיעה)
function anLine(tr) {
  if (!tr || !tr.ok || !tr.has) return '';
  const L = [];
  L.push('הכנסות ' + monL(tr.last) + ': ' + ils(tr.inc.v) + (tr.inc.dPrev !== null ? ' (' + sgn(tr.inc.dPrev) + ' מול החודש הקודם)' : ''));
  L.push('הוצאות: ' + ils(tr.exp.v) + (tr.exp.dPrev !== null ? ' (' + sgn(tr.exp.dPrev) + ')' : ''));
  const an = tr.anoms || [];
  if (an.length) L.push('הוצאות חריגות: ' + an.length + ' – ' + an.slice(0, 3).map((a) => (a.k === 'sup' ? 'ספק ' : '') + '"' + a.n + '" ' + sgn(a.pct) + (a.part ? ' (החודש עד היום)' : '')).join(', ') + (an.length > 3 ? '…' : ''));
  else L.push(tr.hist ? 'אין הוצאות חריגות' : 'אין מספיק היסטוריה לזיהוי הוצאות חריגות');
  return 'מגמות וחריגות: ' + L.join('; ');
}

// ---------- הצעות הזמנה ----------
const OD = Object.freeze({ WIN: 28, LOW: 7, TARGET: 21, HIST_DAYS: 180, MIN_GAP: 3, MAX_SUP: 20, MAX_LINES: 30, MAX_QTY: 100000 });
const SALE = new Set(['pos', 'cx', 'order']), RET = new Set(['posret', 'cancel']);
const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const supKey = (s) => clean(s, 60).toLowerCase();
// סך המלאי בכל הסניפים; לא מספרי / ריק – null (לא אמין)
function stockOf(q) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
  const v = Object.values(q).filter(fin0);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) * 1000) / 1000 : null;
}
// o = { now, prods:[{id,name,sup,q,on,nc}], moves:[{prod,delta,why,at}], movesFrom (ms – מאיזה רגע התנועות מלאות), so:[{pid,n,sup,qty,st,at}] }
function ordSuggest(o) {
  const now = o.now, win = OD.WIN * 864e5;
  const from = Math.max(now - win, fin0(o.movesFrom) ? o.movesFrom : now - win);
  const days = Math.max(1, (now - from) / 864e5);
  const sold = new Map();
  for (const m of o.moves || []) {
    if (!m || typeof m.prod !== 'string' || !fin0(m.delta) || !fin0(m.at) || m.at < from || m.at > now) continue;
    if (!SALE.has(m.why) && !RET.has(m.why)) continue;
    sold.set(m.prod, (sold.get(m.prod) || 0) - m.delta);
  }
  const open = new Set(), hist = new Map();
  for (const r of o.so || []) {
    if (!r || typeof r.pid !== 'string' || !r.pid) continue;
    if (r.st === 'open' || r.st === 'ord') open.add(r.pid);
    if ((r.st === 'ord' || r.st === 'done') && fin0(r.at) && r.at >= now - OD.HIST_DAYS * 864e5 && r.at <= now && fin0(r.qty) && r.qty > 0) {
      const d = dayOf(r.at), H = hist.get(r.pid) || new Map();
      const e = H.get(d) || { at: r.at, qty: 0 }; e.qty += r.qty; e.at = Math.min(e.at, r.at); H.set(d, e); hist.set(r.pid, H);
    }
  }
  const stat = { noSup: 0, noData: 0, open: 0, off: 0 };
  const G = new Map();
  for (const p of o.prods || []) {
    if (!p || typeof p.id !== 'string') continue;
    if (p.on === false) { stat.off++; continue; }
    const sup = clean(p.sup, 60), n = clean(p.name, 80) || p.id;
    if (open.has(p.id)) { stat.open++; continue; }
    const s = Math.max(0, Math.round((sold.get(p.id) || 0) * 1000) / 1000);
    const q = p.nc === true ? null : stockOf(p.q);
    let line = null;
    if (s > 0 && q !== null) {
      const rate = s / days, cover = Math.max(0, q) / rate;
      if (cover < OD.LOW) {
        const qty = Math.min(OD.MAX_QTY, Math.ceil(rate * OD.TARGET - Math.max(0, q)));
        if (qty > 0) line = { pid: p.id, n, qty, m: 's', sold: s, days: Math.round(days), q, why: 'נמכרו ' + s + ' ב-' + Math.round(days) + ' ימים; במלאי ' + q + ' (מספיק לכ-' + Math.floor(cover) + ' ימים). הכמות – ל-' + OD.TARGET + ' ימים' };
      }
    } else {
      const H = hist.get(p.id);
      const ev = H ? [...H.values()].sort((a, b) => a.at - b.at) : [];
      if (ev.length >= 2) {
        const gap = (ev[ev.length - 1].at - ev[0].at) / (ev.length - 1), since = now - ev[ev.length - 1].at;
        if (gap >= OD.MIN_GAP * 864e5 && since >= gap) {
          const qty = Math.min(OD.MAX_QTY, Math.max(1, Math.round(ev.reduce((x, e) => x + e.qty, 0) / ev.length)));
          line = { pid: p.id, n, qty, m: 'h', orders: ev.length, why: 'לפי היסטוריית ההזמנות: ' + ev.length + ' הזמנות, בממוצע כל ' + Math.round(gap / 864e5) + ' ימים; האחרונה לפני ' + Math.floor(since / 864e5) + ' ימים' + (s > 0 ? ' (המלאי לא אמין)' : '') };
        }
      } else if (s > 0 || ev.length) stat.noData++; // יש פעילות אבל אין מספיק נתונים להצעה
    }
    if (!line) continue;
    if (!sup) { stat.noSup++; continue; }
    const k = supKey(sup);
    if (!G.has(k)) G.set(k, { sup, sk: k, lines: [] });
    G.get(k).lines.push(line);
  }
  const drafts = [...G.values()].map((g) => Object.assign(g, { lines: g.lines.sort((a, b) => String(a.n).localeCompare(String(b.n), 'he')).slice(0, OD.MAX_LINES) }))
    .sort((a, b) => b.lines.length - a.lines.length || String(a.sup).localeCompare(String(b.sup), 'he')).slice(0, OD.MAX_SUP);
  return { drafts, stat };
}

module.exports = { trends, anLine, ordSuggest, anomsOf, addMon, prevYear, pct, stockOf, supKey, OD, DEF, monL };
