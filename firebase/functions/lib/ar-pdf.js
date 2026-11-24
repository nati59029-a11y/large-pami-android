'use strict';
// מנוע מסמכים (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 3 חלק א'): קובץ PDF בשרת, בעברית מימין לשמאל.
// אותו מנוע משרת את כל המסמכים של שלבים 3–5: אישור הזמנה, חשבונית מס, חשבונית מס קבלה, קבלה, זיכוי, כרטסת.
// טהור: מקבל אובייקט מסמך ומחזיר Buffer. בלי Firestore, בלי רשת, בלי Storage (השמירה והקישור – ar-file.js).
//
//   render(doc) → Promise<Buffer>
//   doc = { t:'oc'|'inv'|'ir'|'rc'|'cr'|'st'|'qt', no?, ed?, d:'YYYY-MM-DD', vu?:'YYYY-MM-DD' (הצעת מחיר: "בתוקף עד"), draft?, title?,
//           biz:{ name, bn, addr, phone, mail, logo?(Buffer | data:image/png|jpeg;base64,…), foot },
//           cust:{ name, bn, addr, phone, mail },
//           vm:'ex'|'inc', rate (מע"מ באחוזים), disc? (אחוז הנחה כללית – כמו ar-calc.totals),
//           lines:[{ n, q, p, u? }]   (p = מחיר ליחידה בשקלים, ביחידת ההזמנה: ex לפני מע"מ, inc כולל מע"מ)
//           total? (= ord.total; אם נשלח וסכום השורות שונה – שגיאה, כדי שלא יצא מסמך עם סכומים שלא מתאימים)
//           table?:{ head:[..], rows:[[..]], num:[אינדקסים של עמודות כסף] }, sums?:[[label, amount]]   (קבלה / כרטסת)
//           due?, terms?, note? }
//   הסכומים של מסמך עם שורות מחושבים כאן מ-ar-calc (אותו חישוב כמו ההזמנה), באגורות. שורה = round(q × p × 100).
//
// כיוון כתיבה: pdfkit (fontkit) הופך כל מחרוזת שזוהתה כעברית, ולא יודע לסדר טקסט מעורב (עברית + מספרים/אנגלית).
// לכן הסידור נעשה כאן (bidi – גרסה מצומצמת של אלגוריתם Unicode UAX#9 לפסקה מימין לשמאל, בלי תווי הטבעה):
// כל שורה מחושבת לסדר חזותי משמאל לימין; רצף משמאל לימין (מספרים, אנגלית) מצויר כמחרוזת אחת, ואותיות מימין לשמאל
// מצוירות אחת־אחת במקומן (כך fontkit לא הופך אותן שוב). סוגריים מתהפכים (mirroring). סכומים מצוירים תמיד משמאל לימין.
// גופן: IBM Plex Sans Hebrew (רישיון OFL, assets/OFL-IBMPlexSansHebrew.txt) – אותו גופן שבאפליקציה.

const path = require('node:path');
const C = require('./ar-calc');

const FONT = path.join(__dirname, '..', 'assets', 'IBMPlexSansHebrew-Regular.ttf');
const FONT_B = path.join(__dirname, '..', 'assets', 'IBMPlexSansHebrew-Bold.ttf');
const LIM = { lines: 500, rows: 2000, txt: 200, foot: 1500, note: 600, logo: 1024 * 1024 };
const TITLES = { oc: 'אישור הזמנה', inv: 'חשבונית מס', ir: 'חשבונית מס / קבלה', rc: 'קבלה', cr: 'חשבונית מס זיכוי', st: 'כרטסת לקוח', qt: 'הצעת מחיר' };
const DRAFT_TXT = 'טיוטה – לא מסמך רשמי';

// ---------- bidi ----------
// סוג כיווניות של תו (UAX#9, מצומצם): R, L, EN (ספרה), ES (+ -), ET (₪ % $ …), CS (, . / :), NSM (ניקוד), WS, ON (שאר)
function bidiType(cp) {
  if (cp >= 0x30 && cp <= 0x39) return 'EN';
  if (cp === 0x20 || cp === 0x09) return 'WS';
  if (cp === 0x2b || cp === 0x2d || cp === 0x2212) return 'ES';
  if (cp === 0x2c || cp === 0x2e || cp === 0x2f || cp === 0x3a || cp === 0xa0) return 'CS';
  if (cp === 0x23 || cp === 0x24 || cp === 0x25 || cp === 0xa2 || cp === 0xa3 || cp === 0xa5 || cp === 0xb0 || cp === 0xb1 || cp === 0x20aa || cp === 0x20ac || cp === 0x2030) return 'ET';
  if (cp === 0x200f) return 'R';
  if (cp === 0x200e) return 'L';
  if (cp >= 0x0591 && cp <= 0x05c7) return [0x05be, 0x05c0, 0x05c3, 0x05c6].includes(cp) ? 'R' : 'NSM';
  if ((cp >= 0x05c8 && cp <= 0x05ff) || (cp >= 0x0600 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return cp === 0xfb1e ? 'NSM' : 'R';
  const ch = String.fromCodePoint(cp);
  if (/\p{Mn}/u.test(ch)) return 'NSM';
  if (/[\p{L}\p{Nd}]/u.test(ch)) return 'L';
  return 'ON';
}
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«', '‹': '›', '›': '‹' };
// תווי שליטה של כיווניות ותווי בקרה – מוסרים מכל טקסט שנכנס למסמך (מונעים "היפוך" זדוני של שורה)
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200d\u2028-\u202e\u2066-\u2069\ufeff]/g;
const clean = (v, n) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(CTRL, '').replace(/\t/g, ' ').trim().slice(0, n || LIM.txt);

// שורה לוגית → קטעים בסדר חזותי (משמאל לימין): [{ s, rtl }]. קטע rtl = אשכול אחד (אות + ניקוד) – כבר אחרי היפוך מראה.
function bidiRuns(text) {
  const cps = Array.from(String(text || ''));
  const cl = []; // אשכולות: תו בסיס + סימני ניקוד שאחריו
  for (const ch of cps) {
    const t = bidiType(ch.codePointAt(0));
    if (t === 'NSM' && cl.length) cl[cl.length - 1].s += ch; else cl.push({ s: ch, t: t === 'NSM' ? 'ON' : t });
  }
  const n = cl.length;
  if (!n) return [];
  const t = cl.map((c) => c.t);
  // W4: מפריד יחיד בין שתי ספרות (1,234.50 / 1+2) – חלק מהמספר
  for (let i = 1; i < n - 1; i++) if ((t[i] === 'CS' || t[i] === 'ES') && t[i - 1] === 'EN' && t[i + 1] === 'EN') t[i] = 'EN';
  // W5: סימן מטבע/אחוז צמוד למספר (₪1,234.50 / 18%) – חלק מהמספר
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'ET') continue;
    let j = i; while (j < n && t[j] === 'ET') j++;
    if ((i > 0 && t[i - 1] === 'EN') || (j < n && t[j] === 'EN')) for (let k = i; k < j; k++) t[k] = 'EN';
    i = j - 1;
  }
  // W6: שאר המפרידים – ניטרליים
  for (let i = 0; i < n; i++) if (t[i] === 'ES' || t[i] === 'ET' || t[i] === 'CS') t[i] = 'ON';
  // W7: מספר אחרי אנגלית – משמאל לימין כמו האנגלית
  let last = 'R';
  for (let i = 0; i < n; i++) { if (t[i] === 'R' || t[i] === 'L') last = t[i]; else if (t[i] === 'EN' && last === 'L') t[i] = 'L'; }
  // N1/N2: רצף ניטרלי בין שני צדדים באותו כיוון – מקבל אותו; אחרת – כיוון הפסקה (מימין לשמאל)
  const side = (x) => (x === 'L' ? 'L' : 'R'); // EN נחשב R לצורך הניטרליים (פסקה מימין לשמאל)
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'WS' && t[i] !== 'ON') continue;
    let j = i; while (j < n && (t[j] === 'WS' || t[j] === 'ON')) j++;
    const a = i > 0 ? side(t[i - 1]) : 'R', b = j < n ? side(t[j]) : 'R';
    const v = a === b ? a : 'R';
    for (let k = i; k < j; k++) t[k] = v;
    i = j - 1;
  }
  // I2: רמות. R = 1, L/EN = 2. L2: היפוך רצפים ברמה 2, ואחר כך היפוך השורה כולה
  const lv = t.map((x) => (x === 'R' ? 1 : 2));
  const idx = cl.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    if (lv[idx[i]] !== 2) continue;
    let j = i; while (j < n && lv[idx[j]] === 2) j++;
    const seg = idx.slice(i, j).reverse(); for (let k = i; k < j; k++) idx[k] = seg[k - i];
    i = j - 1;
  }
  idx.reverse();
  // קיבוץ: רצף ברמה 2 (בסדר חזותי הוא כבר משמאל לימין) – קטע אחד; כל אשכול ברמה 1 – קטע נפרד, עם היפוך מראה
  const out = [];
  for (const i of idx) {
    if (lv[i] === 2) {
      const p = out[out.length - 1];
      if (p && !p.rtl) p.s += cl[i].s; else out.push({ s: cl[i].s, rtl: false });
    } else out.push({ s: MIRROR[cl[i].s] || cl[i].s, rtl: true });
  }
  return out;
}
// המחרוזת החזותית (משמאל לימין) – לבדיקות ולחילוץ טקסט
const visual = (text) => bidiRuns(text).map((r) => r.s).join('');

// ---------- עיצוב מספרים ----------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const grp = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// אגורות → "₪1,234.50" / "-₪50.00"
function moneyAg(a) { const v = Math.abs(a); return (a < 0 ? '-' : '') + '₪' + grp(String(Math.floor(v / 100))) + '.' + String(v % 100).padStart(2, '0'); }
const money = (sh) => moneyAg(C.ag(sh));
function qtyTxt(q) { const r = Math.round(q * 1000) / 1000; return grp(String(Math.trunc(r))) + (r % 1 ? '.' + String(Math.abs(r)).split('.')[1] : ''); }
function dateTxt(d) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }

// ---------- חישוב (אגורות) ----------
// מסמך עם שורות: סכום כל שורה, סכום השורות, ואחר כך ar-calc.totals (הנחה, מע"מ, לתשלום)
function calc(doc) {
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  if (lines.length > LIM.lines) throw docErr('too-many-lines');
  const rows = lines.map((l) => {
    const q = Number(l && l.q), p = Number(l && l.p);
    if (!isNum(q) || !isNum(p) || Math.abs(q) > 1e6 || Math.abs(p) > 1e8) throw docErr('bad-line');
    return { n: clean(l.n, 120), u: clean(l.u, 20), q, p, a: Math.round(q * p * 100) };
  });
  const sumAg = rows.reduce((s, r) => s + r.a, 0);
  if (doc.total != null && (!isNum(doc.total) || C.ag(doc.total) !== sumAg)) throw docErr('total-mismatch');
  const rate = isNum(doc.rate) && doc.rate >= 0 && doc.rate <= 100 ? doc.rate : C.VAT0;
  const vm = doc.vm === 'ex' ? 'ex' : 'inc';
  const tt = C.totals(sumAg / 100, vm, rate, doc.disc);
  // adj (אגורות, זיכוי שסוגר חשבונית – ar.js arCredit): "התאמת עיגול" שמתווספת לסכום לתשלום
  const adj = Number.isInteger(doc.adj) && Math.abs(doc.adj) <= 100 ? doc.adj : 0;
  return { rows, sum: sumAg, vm, rate, dsc: tt.dsc ? -C.ag(tt.dsc) : 0, net: C.ag(tt.net), vat: C.ag(tt.vat), gross: C.ag(tt.gross) + adj, adj };
}
function docErr(reason) { const e = new Error('ar-pdf: ' + reason); e.reason = reason; return e; }

// לוגו: Buffer או data:image/png|jpeg;base64 (webp לא נתמך ב-pdfkit – מדלגים בשקט). לוגו פגום/חסר לא מפיל את המסמך
function logoBuf(v) {
  let b = null;
  if (Buffer.isBuffer(v)) b = v;
  else if (typeof v === 'string') { const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(v); if (m) b = Buffer.from(m[2], 'base64'); }
  if (!b || !b.length || b.length > LIM.logo) return null;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, jpg = b[0] === 0xff && b[1] === 0xd8;
  return png || jpg ? b : null;
}

// ---------- ציור ----------
const PAGE = { w: 595.28, h: 841.89, m: 40 };
const COL = { ink: '#1a1a1a', mute: '#666666', line: '#c9c9c9', head: '#f1ece0', gold: '#8a6d1f', red: '#b3261e' };

function painter(pdf) {
  const font = (b, size) => { pdf.font(b ? 'B' : 'R').fontSize(size); };
  const runs = (text) => bidiRuns(text).map((r) => Object.assign(r, { w: pdf.widthOfString(r.s) }));
  const widthOf = (text) => runs(text).reduce((s, r) => s + r.w, 0);
  // טקסט מעורב בשורה אחת. o: { b, size, color, align:'right'|'left'|'center', x (קצה שמאל), w (רוחב) }
  function text(str, o) {
    font(o.b, o.size || 10);
    const rs = runs(clean(str, o.max || LIM.txt).replace(/\n/g, ' '));
    const tw = rs.reduce((s, r) => s + r.w, 0);
    let x = o.align === 'left' ? o.x : o.align === 'center' ? o.x + (o.w - tw) / 2 : o.x + o.w - tw;
    pdf.fillColor(o.color || COL.ink);
    for (const r of rs) { pdf.text(r.s, x, o.y, { lineBreak: false }); x += r.w; }
    return tw;
  }
  // טקסט משמאל לימין בלבד (סכומים, מספרים) – בלי bidi
  function ltr(str, o) {
    font(o.b, o.size || 10);
    const tw = pdf.widthOfString(str);
    const x = o.align === 'left' ? o.x : o.align === 'center' ? o.x + (o.w - tw) / 2 : o.x + o.w - tw;
    pdf.fillColor(o.color || COL.ink).text(str, x, o.y, { lineBreak: false });
    return tw;
  }
  // פירוק לשורות לפי רוחב (על הטקסט הלוגי; הרוחב לא תלוי בסדר). מילה ארוכה מדי נחתכת לפי תווים
  function wrap(str, w, b, size, maxLines) {
    font(b, size);
    const out = [];
    for (const para of clean(str, LIM.foot).split('\n')) {
      let cur = '';
      for (const word of para.split(/ +/).filter(Boolean)) {
        const cand = cur ? cur + ' ' + word : word;
        if (widthOf(cand) <= w) { cur = cand; continue; }
        if (cur) out.push(cur);
        cur = word;
        while (widthOf(cur) > w && cur.length > 1) {
          let k = cur.length - 1; while (k > 1 && widthOf(cur.slice(0, k)) > w) k--;
          out.push(cur.slice(0, k)); cur = cur.slice(k);
        }
      }
      out.push(cur);
    }
    return maxLines && out.length > maxLines ? out.slice(0, maxLines - 1).concat([out.slice(maxLines - 1).join(' ').slice(0, 60) + '…']) : out;
  }
  return { text, ltr, wrap, font };
}

async function render(docIn, opts) {
  const PDFDocument = require('pdfkit');
  const doc = docIn && typeof docIn === 'object' ? docIn : {};
  const o = opts || {};
  const t = Object.prototype.hasOwnProperty.call(TITLES, doc.t) ? doc.t : 'oc';
  const hasTable = !!(doc.table && Array.isArray(doc.table.head) && Array.isArray(doc.table.rows));
  const k = hasTable ? null : calc(doc);
  const biz = doc.biz && typeof doc.biz === 'object' ? doc.biz : {};
  const cust = doc.cust && typeof doc.cust === 'object' ? doc.cust : {};
  const title = clean(doc.title, 60) || TITLES[t];

  const pdf = new PDFDocument({ size: 'A4', margin: PAGE.m, bufferPages: true, autoFirstPage: true, compress: o.compress !== false,
    info: { Title: title + (doc.no != null ? ' ' + clean(doc.no, 30) : ''), Author: clean(biz.name, 80), Creator: 'large-pami', Producer: 'large-pami' } });
  pdf.registerFont('R', FONT); pdf.registerFont('B', FONT_B);
  const chunks = [];
  const done = new Promise((ok, no) => { pdf.on('data', (c) => chunks.push(c)); pdf.on('end', () => ok(Buffer.concat(chunks))); pdf.on('error', no); });
  const P = painter(pdf);
  const L = PAGE.m, R = PAGE.w - PAGE.m, W = R - L, BOTTOM = PAGE.h - PAGE.m - 30;
  let y = PAGE.m;

  // --- כותרת: פרטי העסק מימין, סוג המסמך משמאל ---
  const lg = logoBuf(biz.logo);
  let bx = R;
  if (lg) {
    try { pdf.image(lg, R - 64, y, { fit: [64, 64], align: 'right', valign: 'top' }); bx = R - 74; } catch (e) { bx = R; } // לוגו פגום – בלי לוגו
  }
  let hy = y;
  P.text(biz.name || '', { b: true, size: 16, x: L, w: bx - L, y: hy, max: 80 }); hy += 22;
  for (const s of [biz.bn ? 'ע.מ / ח.פ ' + clean(biz.bn, 20) : '', clean(biz.addr, 120), biz.phone ? 'טל׳ ' + clean(biz.phone, 30) : '', clean(biz.mail, 80)]) {
    if (!s) continue; P.text(s, { size: 9, color: COL.mute, x: L, w: bx - L, y: hy }); hy += 13;
  }
  let ty = y;
  P.text(title, { b: true, size: 18, color: COL.gold, x: L, w: 240, y: ty, align: 'left' }); ty += 25;
  if (doc.no != null && doc.no !== '') { P.text('מס׳ ' + clean(doc.no, 30) + (isNum(doc.ed) && doc.ed > 1 ? ' (מהדורה ' + doc.ed + ')' : ''), { size: 10, x: L, w: 240, y: ty, align: 'left' }); ty += 15; }
  if (dateTxt(doc.d)) { P.text('תאריך: ' + dateTxt(doc.d), { size: 10, x: L, w: 240, y: ty, align: 'left' }); ty += 15; }
  if (dateTxt(doc.vu)) { P.text('בתוקף עד: ' + dateTxt(doc.vu), { b: true, size: 10, x: L, w: 240, y: ty, align: 'left' }); ty += 15; } // הצעת מחיר (qt.vu)
  if (doc.draft) { P.text(DRAFT_TXT, { b: true, size: 10, color: COL.red, x: L, w: 240, y: ty, align: 'left' }); ty += 15; }
  y = Math.max(hy, ty, lg ? y + 70 : 0) + 8;
  pdf.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(COL.gold).stroke(); y += 10;

  // --- פרטי הלקוח ---
  P.text('לכבוד: ' + clean(cust.name, 120), { b: true, size: 11, x: L, w: W, y }); y += 16;
  for (const s of [cust.bn ? 'ע.מ / ח.פ ' + clean(cust.bn, 20) : '', clean(cust.addr, 160), cust.phone ? 'טל׳ ' + clean(cust.phone, 30) : '', clean(cust.mail, 80)]) {
    if (!s) continue; P.text(s, { size: 9, color: COL.mute, x: L, w: W, y }); y += 13;
  }
  // זיכוי (החלטה 29): "זיכוי לחשבונית מס מספר N" – שורה בולטת מעל הטבלה
  if (doc.refTxt) { y += 4; P.text(clean(doc.refTxt, 80), { b: true, size: 12, color: COL.gold, x: L, w: W, y }); y += 18; }
  // החזר כסף (החלטה 31): "הוחזר ללקוח: זיכוי באשראי, ₪X"
  if (doc.rfTxt) { P.text(clean(doc.rfTxt, 80), { b: true, size: 11, x: L, w: W, y }); y += 16; }
  const meta = [doc.terms ? 'תנאי תשלום: ' + clean(doc.terms, 60) : '', dateTxt(doc.due) ? 'לתשלום עד: ' + dateTxt(doc.due) : ''].filter(Boolean).join('   |   ');
  if (meta) { P.text(meta, { size: 9, x: L, w: W, y }); y += 13; }
  y += 8;

  // --- טבלה ---
  // עמודות מימין לשמאל. מסמך עם שורות: # | תיאור | כמות | מחיר ליח׳ | סה״כ
  const cols = hasTable ? tableCols(doc.table, W) : [
    { h: '#', w: 26 }, { h: 'תיאור', w: W - 26 - 60 - 85 - 90 }, { h: 'כמות', w: 60, num: true }, { h: k.vm === 'ex' ? 'מחיר ליח׳ (לפני מע״מ)' : 'מחיר ליח׳ (כולל מע״מ)', w: 85, num: true }, { h: 'סה״כ', w: 90, num: true },
  ];
  const head = () => {
    pdf.rect(L, y, W, 20).fill(COL.head);
    let x = R;
    for (const c of cols) { x -= c.w; P.text(c.h, { b: true, size: 9, x: x + 4, w: c.w - 8, y: y + 5, align: c.num ? 'center' : 'right' }); }
    y += 22;
  };
  const newPage = () => { pdf.addPage(); y = PAGE.m; head(); };
  head();
  const rows = hasTable ? tableRows(doc.table, cols) : k.rows.map((r, i) => [String(i + 1), r.n + (r.u ? ' (' + r.u + ')' : ''), qtyTxt(r.q), money(r.p), moneyAg(r.a)]);
  rows.forEach((cells, ri) => {
    // תיאור ארוך – עד 3 שורות בעמודה
    const descI = hasTable ? -1 : 1;
    const desc = descI >= 0 ? P.wrap(cells[descI], cols[descI].w - 8, false, 9, 3) : null;
    const hRow = Math.max(1, desc ? desc.length : 1) * 12 + 6;
    if (y + hRow > BOTTOM) newPage();
    let x = R;
    cols.forEach((c, ci) => {
      x -= c.w;
      if (ci === descI) desc.forEach((ln, li) => P.text(ln, { size: 9, x: x + 4, w: c.w - 8, y: y + 3 + li * 12 }));
      else if (c.num) P.ltr(String(cells[ci] == null ? '' : cells[ci]), { size: 9, x: x + 4, w: c.w - 8, y: y + 3, align: 'center' });
      else P.text(cells[ci], { size: 9, x: x + 4, w: c.w - 8, y: y + 3 });
    });
    y += hRow;
    pdf.moveTo(L, y - 2).lineTo(R, y - 2).lineWidth(0.5).strokeColor(COL.line).stroke();
    if (ri === rows.length - 1) y += 4;
  });

  // --- סיכום (משמאל, כמו בחשבונית עברית) ---
  // עסקי (ex): סה״כ, הנחה, סה״כ לפני מע״מ, מע״מ, לתשלום. פרטי (inc): סה״כ, הנחה, מתוכם מע״מ, לתשלום
  const sums = [];
  if (!hasTable) {
    const rateTxt = (Math.round(k.rate * 100) / 100) + '%';
    if (k.dsc) sums.push(['סה״כ', moneyAg(k.sum)], ['הנחה', moneyAg(k.dsc)]);
    const aj = k.adj ? [['התאמת עיגול', moneyAg(k.adj)]] : [];
    if (k.vm === 'ex') sums.push(['סה״כ לפני מע״מ', moneyAg(k.net)], ['מע״מ ' + rateTxt, moneyAg(k.vat)], ...aj, ['לתשלום', moneyAg(k.gross), true]);
    else { if (!k.dsc) sums.push(['סה״כ', moneyAg(k.sum)]); sums.push(['מתוכם מע״מ ' + rateTxt, moneyAg(k.vat)], ...aj, ['לתשלום', moneyAg(k.gross), true]); }
  } else if (Array.isArray(doc.sums)) {
    doc.sums.slice(0, 10).forEach((s, i, a) => { if (Array.isArray(s) && isNum(s[1])) sums.push([clean(s[0], 40), money(s[1]), i === a.length - 1]); });
  }
  if (y + sums.length * 18 + 10 > BOTTOM) { pdf.addPage(); y = PAGE.m; }
  const sw = 230, sx = L;
  for (const [lab, val, strong] of sums) {
    if (strong) { pdf.rect(sx, y - 2, sw, 20).fill(COL.head); }
    P.text(lab, { b: !!strong, size: strong ? 11 : 10, x: sx + 100, w: sw - 106, y: y + 2 });
    P.ltr(val, { b: !!strong, size: strong ? 11 : 10, x: sx + 6, w: 94, y: y + 2, align: 'left' });
    y += 20;
  }
  if (doc.note) {
    y += 8;
    for (const ln of P.wrap(clean(doc.note, LIM.note), W, false, 9, 6)) { if (y > BOTTOM) { pdf.addPage(); y = PAGE.m; } P.text(ln, { size: 9, x: L, w: W, y }); y += 12; }
  }
  // --- טקסט תחתון של העסק (62) ---
  if (biz.foot) {
    const fl = P.wrap(clean(biz.foot, LIM.foot), W, false, 8, 12);
    const fh = fl.length * 11 + 10;
    if (y + fh > BOTTOM) { pdf.addPage(); y = PAGE.m; }
    let fy = Math.max(y + 10, BOTTOM - fh);
    pdf.moveTo(L, fy - 4).lineTo(R, fy - 4).lineWidth(0.5).strokeColor(COL.line).stroke();
    for (const ln of fl) { P.text(ln, { size: 8, color: COL.mute, x: L, w: W, y: fy, align: 'center' }); fy += 11; }
  }
  // --- מספרי עמודים + "טיוטה" בכל עמוד ---
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    const py = PAGE.h - PAGE.m + 4;
    P.text('עמוד ' + (i + 1) + ' מתוך ' + range.count, { size: 8, color: COL.mute, x: L, w: W, y: py, align: 'center' });
    if (doc.draft) P.text(DRAFT_TXT, { b: true, size: 8, color: COL.red, x: L, w: W, y: py, align: 'right' });
  }
  pdf.end();
  return done;
}

// טבלה כללית (קבלה, כרטסת): רוחב שווה, עמודות כסף ממורכזות
function tableCols(tb, W) {
  const head = tb.head.slice(0, 8).map((h) => clean(h, 30));
  const num = Array.isArray(tb.num) ? tb.num : [];
  return head.map((h, i) => ({ h, w: W / head.length, num: num.includes(i), money: num.includes(i) }));
}
function tableRows(tb, cols) {
  if (tb.rows.length > LIM.rows) throw docErr('too-many-rows');
  return tb.rows.map((r) => cols.map((c, i) => {
    const v = Array.isArray(r) ? r[i] : '';
    if (c.money) return isNum(v) ? money(v) : '';
    return clean(v, 120);
  }));
}

module.exports = { render, calc, bidiRuns, visual, bidiType, moneyAg, money, qtyTxt, dateTxt, clean, logoBuf, TITLES, DRAFT_TXT, FONT, FONT_B };
