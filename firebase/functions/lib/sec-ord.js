'use strict';
// המזכירה – שלב ג, שלב 1 (14.11.2026): טיוטת הזמנה מטקסט חופשי. פונקציות טהורות בלבד – בלי Firestore, בלי רשת, בלי AI.
// מוצר (כמו prod/{id} ב-orders.js): { id, name, price, bp?:{<br>:מחיר}, on, cto?:bool, ct?:מארזים בקרטון, sku?, barcode?, q?, wp? }
//   – מחירים בקטלוג בשקלים; כאן הכול מומר לאגורות שלמות. wp נקרא מ-prod/{id}/p/ws ומצורף על ידי הקורא.
//   – q: אובייקט { <br>|'_': כמות } כמו ב-prod. לא נמסר = לא בודקים מלאי; נמסר – כמו qOf ב-orders.js (סניף חסר = 0 = אזל).
//   – עסק בלי סניפים: הקורא מעביר br = '_'.
// לקוח: { wholesale?: true }. סניף: br.
// שורה מהטקסט: { txt, qty, unit?, pid? (בחירת המנהל) }. המחיר תמיד מהמוצר – לעולם לא מהטקסט.
// תוצאה לשורה: st = 'ok' (התאמה אחת בטוחה) | 'pick' (עד 3 אפשרויות opts) | 'ask' (לבירור). pick/ask חוסמים אישור (block).
// גם שורת ok חוסמת אם: אזל (out), כמות לא בקרטונים שלמים ללקוח סיטונאי (ctw – createOrder דוחה cto-qty).

const MAX_OPTS = 3;
const MAX_QTY = 100000;

// נרמול: ניקוד, גרשיים ומרכאות, אותיות סופיות, סימני פיסוק, רווחים
function norm(s) {
  return String(s == null ? '' : s).normalize('NFKC').toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'`׳״‘’“”]/g, '')
    .replace(/[ךםןףץ]/g, (c) => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }[c]))
    .replace(/[^0-9a-zא-ת]+/g, ' ')
    .trim().replace(/ +/g, ' ');
}
// רבים/יחיד פשוט: צלחות/צלחת → צלח, כוסות/כוס → כוס, סכינים/סכין → סכינ
function stem(t) {
  if (/^[0-9a-z]+$/.test(t)) return t;
  let w = t;
  if (w.length >= 4 && /(ות|ים)$/.test(w)) w = w.slice(0, -2);
  if (w.length >= 3 && /[תה]$/.test(w)) w = w.slice(0, -1);
  return w;
}
// אות עברית בודדת (ב-, ו-, ה- שנותקו במקף) לא נספרת
const toks = (s) => norm(s).split(' ').filter((t) => t && !/^[\u05D0-\u05EA]$/.test(t)).map(stem);

// מרחק עריכה ≤ 1 (החלפה/הוספה/מחיקה של אות אחת)
function ed1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return d + (la - i) + (lb - j) <= 1;
}
// דמיון בין מילים: זהה = 1, שגיאת כתיב קלה (מילה של 4 אותיות ומעלה, לא מספר) = 0.8
function sim(a, b) {
  if (a === b) return 1;
  if (/^[0-9]+$/.test(a) || /^[0-9]+$/.test(b)) return 0;
  return Math.min(a.length, b.length) >= 3 && Math.max(a.length, b.length) >= 4 && ed1(a, b) ? 0.8 : 0;
}

function score(q, p) {
  let hit = 0, w = 0;
  for (const t of q) { let b = 0; for (const u of p) b = Math.max(b, sim(t, u)); if (b) hit++; w += b; }
  let ph = 0;
  for (const u of p) if (q.some((t) => sim(t, u))) ph++;
  return { full: q.length > 0 && hit === q.length, all: p.length > 0 && ph === p.length, part: q.length ? hit / q.length : 0, s: (q.length ? w / q.length : 0) + (p.length ? ph / p.length : 0) };
}

const isProd = (p) => p && typeof p === 'object' && typeof p.id === 'string' && p.id && typeof p.name === 'string' && p.name.trim() && p.on !== false;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const ag = (v) => Math.round(v * 100);

// מחיר לשורה באגורות: סיטונאי + wp → wp; אחרת bp[br]; אחרת price. ללא-סיטונאי wp לא נקרא בכלל.
function priceOf(p, cust, br) {
  if (!p) return null;
  if (cust && cust.wholesale === true && num(p.wp) != null) return ag(p.wp);
  if (br && p.bp && typeof p.bp === 'object' && num(p.bp[br]) != null) return ag(p.bp[br]);
  return num(p.price) != null ? ag(p.price) : null;
}

// כמות: מספר (או מחרוזת מספרית) גדול מ-0 ועד 100,000; אחרת null
function qtyOk(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
  if (!Number.isFinite(n) || n > MAX_QTY) return null;
  const q = Math.round(n * 1000) / 1000; // כמו qtyOf ב-orders.js: הבדיקה אחרי העיגול
  return q > 0 ? q : null;
}

// מלאי: אזל אם q נמסר והכמות בסניף ≤ 0. qOf – העתק מדויק של orders.js (סניף שלא מופיע / לא מספר = 0)
const qOf = (p, br) => { const q = p && p.q && typeof p.q === 'object' ? p.q[br] : 0; return typeof q === 'number' ? q : 0; };
function isOut(p, br) {
  if (!p || p.q == null) return false;
  return !(qOf(p, br) > 0);
}

// קרטונים (כמו ctoOf ב-orders.js): רק ללקוח סיטונאי ומוצר cto עם ct ≥ 2 – כמות שאינה כפולה של ct = אזהרה וחסימה. הכמות לא משתנה.
const ctoOf = (p) => (p && p.cto === true && Number.isInteger(p.ct) && p.ct >= 2 ? p.ct : 0);

// התאמה לקטלוג. מחזיר { st, p?, opts? }
function match(txt, prods) {
  const list = (Array.isArray(prods) ? prods : []).filter(isProd);
  const raw = norm(txt);
  if (!raw) return { st: 'ask', opts: [] };
  // 1. קוד פריט / ברקוד – התאמה מדויקת קודם (כל הטקסט או אחת המילים)
  const words = new Set([raw.replace(/ /g, ''), ...raw.split(' ')]);
  const code = list.filter((p) => [p.sku, p.barcode].some((c) => c != null && String(c).trim() && words.has(norm(c).replace(/ /g, ''))));
  if (code.length === 1) return { st: 'ok', p: code[0] };
  if (code.length > 1) return { st: 'pick', opts: code.slice(0, MAX_OPTS) };
  // 2. שם
  const q = toks(txt);
  const c = list.map((p) => ({ p, r: score(q, toks(p.name)) })).filter((x) => x.r.part >= 0.5)
    .sort((a, b) => b.r.s - a.r.s || a.p.name.length - b.p.name.length || (a.p.name < b.p.name ? -1 : a.p.name > b.p.name ? 1 : 0));
  if (!c.length) return { st: 'ask', opts: [] };
  const full = c.filter((x) => x.r.full);
  if (full.length === 1) return { st: 'ok', p: full[0].p };
  if (full.length > 1 && full[0].r.all && full[0].r.s > full[1].r.s) return { st: 'ok', p: full[0].p };
  return { st: 'pick', opts: c.slice(0, MAX_OPTS).map((x) => x.p) };
}

// שורה אחת. ctx = { cust, br }
function line(it, prods, ctx) {
  const o = ctx || {};
  const x = it || {};
  const txt = String(x.txt == null ? '' : x.txt).slice(0, 200);
  const unit = x.unit == null ? '' : String(x.unit).slice(0, 30);
  const out = { txt, qty: null, unit, st: 'ask', block: true };
  const qty = qtyOk(x.qty);
  if (qty == null) { out.why = 'qty'; return out; }
  out.qty = qty;
  // שלב 4: שורה שהמנהל בחר לה מוצר (pid) – רק המוצר הזה, אם הוא עדיין פעיל ברשימה; אחרת לבירור (why:'gone'). pid נשמר בשורה
  let m;
  if (typeof x.pid === 'string' && x.pid) {
    out.pid = x.pid;
    const p = (Array.isArray(prods) ? prods : []).find((q) => isProd(q) && q.id === x.pid);
    if (!p) { out.why = 'gone'; out.opts = []; return out; }
    m = { st: 'ok', p };
  } else m = match(txt, prods);
  if (m.st === 'ok') {
    const pr = priceOf(m.p, o.cust, o.br);
    if (pr == null) { out.why = 'price'; return out; }
    if (pr <= 0) { out.why = 'price0'; return out; } // לא שולחים ללקוח מחיר 0 (גם wp:0) – לבירור
    Object.assign(out, { st: 'ok', block: false, id: m.p.id, name: m.p.name, pr, sum: Math.round(pr * qty) });
    const ws = !!(o.cust && o.cust.wholesale === true);
    if (ws && num(m.p.wp) != null) out.ex = true; // מחיר סיטונאי = לפני מע"מ (pricing.js); מחיר לצרכן = כולל מע"מ
    const ct = ws ? ctoOf(m.p) : 0;
    if (ct && !Number.isInteger(qty / ct)) { out.ctw = ct; out.block = true; }
    if (isOut(m.p, o.br)) { out.out = true; out.block = true; } // החלטה 5: אזל – לא נכנס בלי אישור
    return out;
  }
  out.st = m.st;
  out.opts = (m.opts || []).map((p) => { const pr = priceOf(p, o.cust, o.br); const r = { id: p.id, name: p.name, pr: pr > 0 ? pr : null }; if (pr > 0 && o.cust && o.cust.wholesale === true && num(p.wp) != null) r.ex = true; return r; });
  if (m.st === 'ask') out.why = 'none';
  return out;
}

// טיוטה מלאה: total באגורות רק משורות ok שלא אזלו; block = יש שורה חוסמת (pick/ask/אזל/קרטון)
function build(items, prods, ctx) {
  const lines = (Array.isArray(items) ? items : []).slice(0, 100).map((it) => line(it, prods, ctx));
  const total = lines.reduce((s, l) => s + (l.st === 'ok' && !l.out ? l.sum : 0), 0);
  const nBlock = lines.filter((l) => l.block).length;
  return { lines, total, block: nBlock > 0, nBlock };
}

// תצוגה בטוחה ללקוח: רשימה לבנה של שדות. אין q, אין עלות, אין wp (המחיר pr כבר נקבע לפי סוג הלקוח), אין מזהי מוצר (id/pid). ex = המחיר לפני מע"מ
function safeView(d) {
  const src = d || {};
  const lines = (Array.isArray(src.lines) ? src.lines : []).map((l) => {
    const v = { txt: l.txt, qty: typeof l.qty === 'number' && Number.isFinite(l.qty) && l.qty > 0 ? l.qty : null, unit: l.unit, st: l.st };
    if (l.st === 'ok' && l.pr > 0) { v.name = l.name; v.pr = l.pr; v.sum = l.sum; if (l.ex) v.ex = true; }
    if (l.out) v.out = true;
    if (l.ctw) v.ctw = l.ctw;
    if (l.why) v.why = l.why;
    if (Array.isArray(l.opts)) v.opts = l.opts.map((p) => Object.assign({ name: p.name, pr: p.pr > 0 ? p.pr : null }, p.pr > 0 && p.ex ? { ex: true } : {}));
    return v;
  });
  return { lines, total: Number.isInteger(src.total) ? src.total : 0, block: !!src.block };
}

// שלב 2: ניקוי השדה order שהמודל החזיר (prepareReplyDraft). הפלט של המודל לא אמין – תוכן המייל יכול לנסות להשתלט עליו.
// { lines:[{txt,qty,unit}], cust:{bn,vat,ct,phone,city,st} } → אותו מבנה מנוקה, או null אם אין אף שורה עם טקסט.
// מחירים לא נשמרים: אין שדה מחיר, וסכום עם ₪/ש"ח/NIS נמחק מהטקסט (המחיר תמיד מהקטלוג – line/priceOf).
const AI_LINES = 50, AI_TXT = 120, AI_UNIT = 20, AI_CUST = 80;
const PRICE_RE = /(?:₪|nis|ils)\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:₪|ש["״']?ח|שקל(?:ים)?|nis\b|ils\b)/gi;
function aiStr(v, n) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n).trim();
}
// טלפון ישראלי – כמו phoneOf ב-customers.js, בלי לזרוק: לא תקין = ''
function aiPhone(v) {
  let p = String(typeof v === 'string' || typeof v === 'number' ? v : '').trim().replace(/[\s\-().]/g, '');
  if (/^\+?972\d{8,9}$/.test(p)) p = '0' + p.replace(/^\+?972/, '');
  if (/^5\d{8}$/.test(p)) p = '0' + p;
  return /^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p) ? p : '';
}
function aiOrder(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const lines = [];
  for (const it of (Array.isArray(o.lines) ? o.lines : []).slice(0, AI_LINES)) {
    if (!it || typeof it !== 'object') continue;
    const txt = aiStr(aiStr(it.txt, 400).replace(PRICE_RE, ' '), AI_TXT);
    if (!txt) continue;
    lines.push({ txt, qty: qtyOk(typeof it.qty === 'number' ? it.qty : null), unit: aiStr(it.unit, AI_UNIT) });
  }
  if (!lines.length) return null;
  const c = o.cust && typeof o.cust === 'object' && !Array.isArray(o.cust) ? o.cust : {};
  const cust = {};
  for (const k of ['bn', 'ct', 'city', 'st']) { const v = aiStr(c[k], AI_CUST); if (v) cust[k] = v; }
  const vat = typeof c.vat === 'string' || typeof c.vat === 'number' ? String(c.vat).trim().replace(/[\s-]/g, '') : '';
  if (/^\d{9}$/.test(vat)) cust.vat = vat;
  const ph = aiPhone(c.phone);
  if (ph) cust.phone = ph;
  return { lines, cust };
}

module.exports = { norm, stem, toks, ed1, priceOf, qtyOk, isOut, ctoOf, match, line, build, safeView, MAX_OPTS, aiOrder, aiPhone, AI_LINES, AI_TXT };
