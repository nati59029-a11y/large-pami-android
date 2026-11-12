'use strict';
// המזכירה שלב 7 – קליטת חשבוניות: כלים טהורים (בלי מסד נתונים), כדי שאפשר לבדוק אותם לבד.
//   inspect(buf)      – בדיקת קובץ לפני כל עלות: גודל, חתימת קובץ (לפי התוכן, sniff הקיים), קבצים מכווצים/Office/הפעלה, PDF מוצפן או עם פקודות, מספר עמודים.
//   badByName(fn,mime) – דחייה לפי שם/סוג מוצהר, עוד לפני הורדה (קובץ מצורף במייל).
//   mapClassify(shaped) – תוצאת הסריקה האחידה (lib/classify.js) → סוג מסמך ושדות לתור.
//   matchSup / brOf / eligOf – זיהוי ספק, סניף (40), וזכאות ל"נכנס ישר" (34–36, 4.3). eligOf נקראת גם בזמן העיבוד וגם ב"תפיסה" (secDecide).
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const scan = require('./scan');

const MAX_FILE = 10 * 1024 * 1024; // כמו SCAN_MAX_FILE_MB (ברירת המחדל) – בדיקה לפני הורדה ולפני פענוח (10.3)
const MAX_PAGES = 4;               // חשבונית: עד 4 עמודים (4.2). מעל – כרטיס "קובץ ארוך – לבדיקה ידנית", בלי זיהוי
const PART = 700000;               // גודל חלק (base64) ב-sec_inv/{id}/p/{k} – מתחת למגבלת המסמך של Firestore
const CAP_DEFAULT = 20000;         // תקרה אחת לעסק (35) – 20,000 ₪ (החלטת בעל הפרויקט, תיקון 1 לשלב 7). סכום ששווה לתקרה – ממתין
const KEEP_DAYS = 30;              // 9.5: עותק בתור של חשבונית שאושרה / קובץ שנדחה – 30 יום
const CLAIM_MS = 24 * 3600e3;      // 4.7(3): תפיסה שלא הושלמה משתחררת אחרי 24 שעות
const KINDS = ['q', 'inv', 'rcpt', 'dn', 'cr', 'chk', 'unk', 'bad', 'long'];

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hpN = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const hpOk = (h) => /^\d{7,9}$/.test(h);
// מספר חשבונית מנורמל – בדיוק כמו NINV באפליקציה (בדיקת הכפילויות הקיימת)
const NINV = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^0-9a-zא-ת]/g, '').replace(/^0+(?=.)/, '');
const nameKey = (s) => String(s || '').replace(/["'׳״`’]/g, '').replace(/בע"?מ|בעמ/g, '').replace(/[^0-9a-zA-Zא-ת]/g, '').toLowerCase();
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- בדיקת הקובץ ----------
// מחזיר { ok:true, mime, pages } או { ok:false, why } (why: empty|big|zip|office|exe|type|enc|active) או { ok:true, long:true, ... }
function magicBad(buf) {
  const h = (n) => buf.slice(0, n);
  if (buf.length >= 4 && h(4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'zip'; // zip, וגם docx/xlsx (Office מודרני הוא zip)
  if (buf.length >= 4 && h(4).toString('latin1') === 'Rar!') return 'zip';
  if (buf.length >= 6 && h(6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return 'zip';
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return 'zip';
  if (buf.length >= 8 && h(8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'office'; // Office ישן (עם מאקרו אפשרי)
  if (buf.length >= 2 && h(2).toString('latin1') === 'MZ') return 'exe';
  if (buf.length >= 4 && h(4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'exe';
  return '';
}
// PDF: שם בקידוד #xx (למשל /J#61vaScript) – מפוענח לפני החיפוש (תיקון 1, ליקוי 3)
const decNames = (t) => t.replace(/\/[^\s\/\[\]<>(){}%]+/g, (m) => (m.includes('#') ? m.replace(/#([0-9A-Fa-f]{2})/g, (z, h) => String.fromCharCode(parseInt(h, 16))) : m));
// שלב 8: גם קובץ מוטמע שמסומן רק במפתח /EF (ה-/Type של זרם הקובץ אינו חובה), עץ /EmbeddedFiles, מעבר לקובץ מוטמע (/GoToE) וייבוא נתונים (/ImportData)
const ACTIVE_RE = /\/(JavaScript|JS|Launch|EmbeddedFiles?|EF|GoToE|ImportData|RichMedia|XFA)(?![A-Za-z0-9])/;
// מילת stream: קוראי PDF מקבלים גם רווחים לפני סוף השורה ("stream \r\n") – שלב 8: נבדק גם כך, אחרת אוסף דחוס כזה לא היה נבדק
const STREAM_HEAD = /^stream[ \t\f\x00]*(\r\n|\n|\r)/;
const OBJSTM_MAX = 200, INFLATE_MAX = 30 * 1024 * 1024;
// המילון שסביב מיקום i (איזון << >>) – כדי לקרוא /Count של עץ העמודים ולא של משהו אחר
function dictAt(t, i) {
  let d = 0, a = -1;
  for (let k = i; k >= 0 && i - k < 20000; k--) {
    if (t[k] === '>' && t[k - 1] === '>') { d++; k--; } else if (t[k] === '<' && t[k - 1] === '<') { if (d === 0) { a = k - 1; break; } d--; k--; }
  }
  if (a < 0) return '';
  d = 0;
  for (let k = a; k < t.length && k - a < 20000; k++) {
    if (t[k] === '<' && t[k + 1] === '<') { d++; k++; } else if (t[k] === '>' && t[k + 1] === '>') { d--; k++; if (d === 0) return t.slice(a, k + 1); }
  }
  return '';
}
// מילוני הזרמים לפי קריאה רציפה של הקובץ (מדלגת על מחרוזות (...), מחרוזות הקס <..> והערות %), כדי ש-"obj" או "endobj"
// שמוסתרים בתוך מחרוזת או הערה לא יחתכו את המילון (תיקון 2, ליקוי 1 של סבב 2). אורך הזרם לפי /Length כשהוא תואם
function streamDicts(s) {
  const res = [], n = s.length;
  let i = 0, depth = 0, dStart = -1, last = '';
  let ints = null; // "N G obj <מספר> endobj" – נבנה פעם אחת, רק אם צריך (בלי סריקה של כל הקובץ לכל זרם)
  const lenOf = (d) => {
    let m = /\/Length\s+(\d+)\s+(\d+)\s+R(?![A-Za-z])/.exec(d);
    if (m) {
      if (!ints) { ints = new Map(); const r = /(?:^|[^0-9])(\d+)\s+(\d+)\s+obj\s*(\d+)\s*endobj/g; let x; while ((x = r.exec(s))) if (!ints.has(x[1] + ' ' + x[2])) ints.set(x[1] + ' ' + x[2], Number(x[3])); }
      const v = ints.get(m[1] + ' ' + m[2]); return v === undefined ? -1 : v;
    }
    m = /\/Length\s+(\d+)(?![\d\s]*R)/.exec(d);
    return m ? Number(m[1]) : -1;
  };
  while (i < n) {
    const c = s[i];
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      let d = 1; i++;
      while (i < n && d) { const ch = s[i]; if (ch === '\\') { i += 2; continue; } if (ch === '(') d++; else if (ch === ')') d--; i++; }
      if (d) return null; // מחרוזת שלא נסגרת עד סוף הקובץ – לא ניתן לבדוק
      continue;
    }
    if (c === '<' && s[i + 1] === '<') { if (depth === 0) dStart = i; depth++; i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { if (depth > 0) { depth--; if (depth === 0 && dStart >= 0) last = s.slice(dStart, i + 2); } i += 2; continue; }
    if (c === '<') { const e = s.indexOf('>', i); if (e < 0) return null; i = e + 1; continue; }
    if (depth === 0 && c === 's' && s.startsWith('stream', i) && !/[A-Za-z0-9]/.test(s[i - 1] || ' ')) {
      const m = STREAM_HEAD.exec(s.slice(i, i + 64));
      if (!m && last && !/[A-Za-z0-9]/.test(s[i + 6] || ' ')) return null; // מילת stream אחרי מילון בלי סוף שורה – לא ניתן לבדוק (שלב 8)
      if (m) {
        const a = i + m[0].length;
        let e = -1;
        const L = lenOf(last);
        if (L >= 0 && /^\s*endstream/.test(s.slice(a + L, a + L + 12))) e = a + L;
        if (e < 0) e = s.indexOf('endstream', a);
        if (e < 0) return null;
        res.push({ dict: last, a, e });
        last = ''; i = s.indexOf('endstream', e) + 9; continue;
      }
    }
    if (depth === 0 && c === 'e' && s.startsWith('endobj', i)) last = '';
    i++;
  }
  return res;
}
// שלב 8 סבב 1 של הבודק: המילון מנורמל לפני הבדיקה – הערה (%…סוף שורה) ותו אפס הם רווח ב-PDF, ו-"+4" הוא המספר 4.
// בלי זה "/Type%x\n/ObjStm", "/N\x00 1" או "/Predictor +12" לא זוהו, והאוסף לא נפרס (או נפרס בלי ה-Predictor)
function normDict(d) {
  let o = '', i = 0;
  const n = d.length;
  while (i < n) {
    const c = d[i];
    if (c === '(') { // מחרוזת – מועתקת כמו שהיא (% בתוכה אינו הערה)
      let k = i + 1, dp = 1;
      while (k < n && dp) { const ch = d[k]; if (ch === '\\') { k += 2; continue; } if (ch === '(') dp++; else if (ch === ')') dp--; k++; }
      o += d.slice(i, k); i = k; continue;
    }
    if (c === '%') { while (i < n && d[i] !== '\n' && d[i] !== '\r') i++; o += ' '; continue; }
    o += c === '\x00' ? ' ' : c; i++;
  }
  return o.replace(/([\s\[<>\/])\+(?=\d)/g, '$1 ');
}
const isObjStmDict = (d) => /\/ObjStm(?![A-Za-z])/.test(d) || (/\/N\s*\d/.test(d) && /\/First\s*\d/.test(d));
// /Filter שאינו שם או מערך של שמות בלבד (למשל הפניה עקיפה "7 0 R") – לא ידוע, ולכן נחסם (תיקון 3)
const filtersOf = (d) => {
  if (!/\/Filter(?![A-Za-z0-9])/.test(d)) return null;
  const fm = /\/Filter\s*(\/[A-Za-z0-9]+(?![A-Za-z0-9#])|\[\s*(?:\/[A-Za-z0-9]+\s*)*\])/.exec(d);
  if (!fm) return ['/?'];
  const f = fm[1].match(/\/[A-Za-z0-9]+/g) || [];
  return /\[\s*\]/.test(fm[1]) ? [] : f;
};
// אוספי אובייקטים דחוסים (/ObjStm, או כל זרם עם /N ו-/First) – נפרסים (FlateDecode) ונבדקים גם הם. מה שאי אפשר לפרוס – null (חסימה).
// כל זרם נבדק בשתי דרכים: לפי הקריאה הרציפה (streamDicts) ולפי חיפוש לאחור לכותרת אובייקט "N G obj". אם אחת מהן מזהה אוסף – נבדק;
// אם הן לא מסכימות על המסנן – חסום
function objStreams(buf, s) {
  const out = [];
  let total = 0;
  const sd = streamDicts(s);
  if (!sd) return null;
  const byA = new Map(sd.map((x) => [x.a, x]));
  const hdr = /\d+\s+\d+\s+obj(?![A-Za-z])/g;
  let hNext = hdr.exec(s), h = -1; // מצביע שמתקדם רק קדימה – זמן ליניארי
  let prevEnd = 0, prevA = 0; // המילון של זרם מתחיל אחרי סוף הזרם הקודם – כל תו נבדק פעם אחת
  const re = /stream[ \t\f\x00]*(\r\n|\n|\r)/g; // שלב 8: כמו STREAM_HEAD
  let m;
  while ((m = re.exec(s))) {
    if (s.slice(Math.max(0, m.index - 3), m.index) === 'end') continue;
    const a = m.index + m[0].length;
    const tok = byA.get(a);
    // כותרת האובייקט האחרונה לפני הזרם (ולא סתם המחרוזת "obj")
    while (hNext && hNext.index < m.index) { h = hNext.index; hNext = hdr.exec(s); }
    // זרם שמתחיל בתוך הנתונים של זרם קודם (אוסף מוסתר שה-xref מפנה אליו ישירות – סבב 1 של הבודק, שלב 8): המילון שלו
    // נמצא אחרי תחילת הנתונים של הזרם הקודם, ולא אחרי סופו. החלונות עדיין לא חופפים – זמן ליניארי
    const from = m.index < prevEnd ? prevA : prevEnd;
    const cands = [tok ? tok.dict : '', h >= 0 ? s.slice(Math.max(h, from, m.index - 20000), m.index) : ''].map((d) => normDict(decNames(d))).filter((d) => d.trim());
    prevEnd = Math.max(prevEnd, tok ? tok.e : a); prevA = a;
    if (!cands.some(isObjStmDict)) continue;
    if (out.length >= OBJSTM_MAX) return null;
    const fls = cands.map(filtersOf).filter(Boolean).map((f) => f.join(' '));
    if (new Set(fls).size > 1) return null;
    const fl = fls.length ? fls[0].split(' ') : [];
    const e = tok ? tok.e : s.indexOf('endstream', a);
    if (e < 0) return null;
    let raw = buf.subarray(a, e);
    while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) raw = raw.subarray(0, raw.length - 1);
    // כל פרמטר פענוח באוסף (Predictor, DecodeParms, DP) – לא נפרס בלי לפענח אותו, ולכן נחסם. אוסף רגיל אינו משתמש בהם (הנחה)
    const pred = cands.some((d) => /\/(Predictor|DecodeParms|DP)(?![A-Za-z0-9])/.test(d));
    let txt;
    if (!fl.length) txt = raw.toString('latin1');
    else if (fl.length === 1 && ['/FlateDecode', '/Fl'].includes(fl[0]) && !pred) {
      try { txt = zlib.inflateSync(raw, { maxOutputLength: INFLATE_MAX - total }).toString('latin1'); } catch (er) { return null; }
    } else return null; // מסנן אחר או שרשרת מסננים – לא נבדק, לכן נחסם
    total += txt.length;
    if (total >= INFLATE_MAX) return null;
    out.push(decNames(txt));
  }
  return out;
}
function inspect(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, why: 'empty' };
  if (buf.length > MAX_FILE) return { ok: false, why: 'big' };
  const mb = magicBad(buf);
  if (mb) return { ok: false, why: mb };
  const mime = scan.sniff(buf);
  if (!mime) return { ok: false, why: 'type' };
  if (mime !== 'application/pdf') return { ok: true, mime, pages: 1 };
  const s0 = buf.toString('latin1');
  const s = decNames(s0);
  if (/\/Encrypt(?![A-Za-z0-9])/.test(s)) return { ok: false, why: 'enc' };
  // PDF עם פקודות (JavaScript, הפעלת קובץ, קובץ מוטמע) – לא נפתח. נבדק גם בתוך אוספי אובייקטים דחוסים
  if (ACTIVE_RE.test(s)) return { ok: false, why: 'active' };
  const os = objStreams(buf, s0);
  if (!os) return { ok: false, why: 'unv' }; // אי אפשר לאמת שאין בו פקודות – חסום (הנחה: כרטיס "התקבל קובץ שלא נקלט")
  if (os.some((t) => ACTIVE_RE.test(t) || /\/Encrypt(?![A-Za-z0-9])/.test(t))) return { ok: false, why: 'active' };
  // עמודים: גם /Type /Page (כולל בתוך אוספים דחוסים) וגם /Count של עץ העמודים – הגבוה מביניהם
  // מגבלה אחת לכל הקובץ (ולא 500 לכל אוסף) – אחרת 200 אוספים × 500 חיפושי מילון תוקעים את התור (סבב 1 של הבודק, שלב 8)
  let nPage = 0, nCount = 0, guard = 0;
  for (const t of [s].concat(os)) {
    nPage += (t.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    const re = /\/Type\s*\/Pages(?![a-zA-Z])/g;
    let m;
    while (guard < 200 && (m = re.exec(t)) && guard++ < 200) { const c = /\/Count\s+(\d{1,7})/.exec(dictAt(t, m.index)); if (c) nCount = Math.max(nCount, Number(c[1])); }
  }
  const pages = Math.max(nPage, nCount) || 1;
  return pages > MAX_PAGES ? { ok: true, long: true, mime, pages } : { ok: true, mime, pages };
}
// קובץ מצורף במייל: שם וסוג מוצהרים. מה שאינו PDF או תמונה – נדחה בלי הורדה
const OK_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
const ZIP_EXT = ['zip', 'rar', '7z', 'gz', 'tgz', 'tar', 'iso', 'docx', 'xlsx', 'pptx', 'docm', 'xlsm', 'pptm'];
const EXE_EXT = ['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'js', 'vbs', 'ps1', 'jar', 'apk', 'lnk', 'hta'];
const OFFICE_EXT = ['doc', 'xls', 'ppt', 'rtf'];
function badByName(fn, mime) {
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(String(fn || '')) || [])[1];
  const e = ext ? ext.toLowerCase() : '';
  if (ZIP_EXT.includes(e)) return 'zip';
  if (EXE_EXT.includes(e)) return 'exe';
  if (OFFICE_EXT.includes(e)) return 'office';
  const m = String(mime || '').toLowerCase();
  if (OK_EXT.includes(e) || scan.ALLOWED_MIME.includes(m)) return '';
  return 'type';
}

// ---------- תוצאת הזיהוי → רשומה בתור ----------
// shaped = CL.shapeClassify(raw, CL.TYPES, {}). מסמך שאינו מסמך ספק (קופה, הפקדה, העברה, דף בנק) – "לא זוהה" (38): מטופל ידנית במסכים הקיימים
function mapClassify(sh) {
  const s = sh && typeof sh === 'object' ? sh : {};
  const f = s.fields || {};
  const unsure = (Array.isArray(s.uncertain) ? s.uncertain : []).slice(0, 20);
  if (s.uncertainType) unsure.push('type');
  if (s.type === 'check') {
    return { k: 'chk', t0: 'check', f: { no: f.number || '', bank: f.bank || '', cdate: DAY_RE.test(f.date || '') ? f.date : '', amt: typeof f.amount === 'number' ? Math.abs(f.amount) : null, payee: f.payee || '' }, unsure };
  }
  if (s.type !== 'invoice') return { k: 'unk', t0: String(s.type || 'unknown').slice(0, 20), f: {}, unsure };
  const k = { invoice: 'inv', delivery_note: 'dn', receipt: 'rcpt', credit_note: 'cr' }[s.docType] || 'inv';
  const out = {
    supplier: f.supplier || '', hp: hpOk(hpN(f.supplier_id)) ? hpN(f.supplier_id) : '', num: f.number || '', date: DAY_RE.test(f.date || '') ? f.date : '',
    total: typeof f.total_with_vat === 'number' ? f.total_with_vat : null, before: typeof f.total_before_vat === 'number' ? f.total_before_vat : null,
    vat: typeof f.vat_amount === 'number' ? f.vat_amount : null, rel: f.related_invoice || '',
  };
  return { k, t0: 'invoice', f: out, unsure };
}

// ---------- ספק, שולח וסניף ----------
// cfg.sups = [{ id, name, hp, br:[...] }] – רשימת הספקים שהמכשיר של המנהל מפרסם (secInv op:'sups'); cfg.links = { <מפתח שולח>: <ספק> }
// מחזיר { sub, subN, match: 'hp'|'snd'|'name'|'' }. 'name' = "נראה כמו X – לאשר?" – לעולם לא זכאי ל"נכנס ישר"
function matchSup(f, cfg, sender) {
  const sups = Array.isArray(cfg.sups) ? cfg.sups : [];
  const h = hpN(f && f.hp);
  if (hpOk(h)) { const s = sups.find((x) => x && hpN(x.hp) === h); if (s) return { sub: s.id, subN: s.name, match: 'hp' }; }
  const lk = sender && cfg.links ? cfg.links[sender] : '';
  if (lk) { const s = sups.find((x) => x && x.id === lk); if (s && !(hpOk(h) && hpOk(hpN(s.hp)) && hpN(s.hp) !== h)) return { sub: s.id, subN: s.name, match: 'snd' }; }
  const nk = nameKey(f && f.supplier);
  if (nk.length >= 2) { const L = sups.filter((x) => x && nameKey(x.name) && (nameKey(x.name) === nk || (nk.length >= 4 && (nameKey(x.name).includes(nk) || nk.includes(nameKey(x.name)))))); if (L.length === 1) return { sub: L[0].id, subN: L[0].name, match: 'name' }; }
  return { sub: '', subN: '', match: '' };
}
// 40: ספק של סניף אחד – לסניף שלו. ספק של כמה סניפים / בלי שיוך / ספק חדש – ממתין לבחירה. עסק עם סניף אחד (או בלי סניפים) – אין שאלה
function brOf(subId, cfg) {
  const nb = Number.isInteger(cfg.nb) ? cfg.nb : 0;
  if (nb <= 1) return { br: typeof cfg.br1 === 'string' ? cfg.br1 : '', brOk: true };
  const s = (Array.isArray(cfg.sups) ? cfg.sups : []).find((x) => x && x.id === subId);
  const L = s && Array.isArray(s.br) ? s.br : [];
  return L.length === 1 ? { br: L[0], brOk: true } : { br: '', brOk: false };
}
// הגדרות קליטת החשבוניות (sec_cfg/inv)
function invCfgOf(snap) {
  const d = snap && snap.exists ? snap.data() || {} : {};
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return {
    auto: d.auto !== false,
    cap: typeof d.cap === 'number' && Number.isFinite(d.cap) && d.cap >= 0 ? d.cap : CAP_DEFAULT,
    off: obj(d.off), links: obj(d.links),
    sups: Array.isArray(d.sups) ? d.sups : [], nb: Number.isInteger(d.nb) ? d.nb : 0, br1: typeof d.br1 === 'string' ? d.br1 : '', supH: typeof d.supH === 'string' ? d.supH : '', supAt: Number(d.supAt) || 0, supBy: typeof d.supBy === 'string' ? d.supBy : '', supDev: typeof d.supDev === 'string' ? d.supDev : '',
  };
}
// ---------- זכאות ל"נכנס ישר" (4.3) ----------
// x = רשומת התור; cfg = invCfgOf; stop = "עצור הכל" (sec_cfg/wa.stop.on). why ריק = זכאי.
// תמיד באישור: כל מה שאינו חשבונית רגילה (זיכוי, קבלה, תעודת משלוח, צ'ק, לא זוהה), סכום שלילי או אפס, ספק לא מוכר (רק לפי ח.פ או שולח מקושר),
// שדה חסר או לא בטוח, תקרה (לפי ערך מוחלט; סכום שווה לתקרה – ממתין, הנחה שמרנית), סניף לא ידוע, כבוי לעסק/לספק, "עצור הכל", חשד לכפילות, עיכוב מהמכשיר, תוכן חשוד
function eligOf(x, cfg, stop) {
  const why = [];
  const f = (x && x.f) || {};
  if (!x || x.k !== 'inv') why.push('type');
  if (!(typeof f.total === 'number' && Number.isFinite(f.total) && f.total > 0)) why.push('neg');
  if (!x || !x.sub || !['hp', 'snd'].includes(x.match)) why.push('sup');
  if (!x || x.full !== true) why.push('fields');
  if (!(typeof f.total === 'number' && Math.abs(f.total) < cfg.cap)) why.push('cap');
  if (!x || x.brOk !== true) why.push('br');
  if (cfg.auto === false || (x && x.sub && cfg.off[x.sub] === true)) why.push('off');
  if (stop) why.push('stop');
  if (x && x.dup) why.push('dup');
  if (x && x.hold) why.push('hold');
  if (x && x.sus) why.push('sus');
  // מייל שלא עבר אימות DKIM/DMARC של דומיין השולח (תיקון 1, ליקוי 2) – לא "נכנס ישר", אלא אם הספק זוהה לפי ח.פ של ספק מוכר
  // (החלטת בעל הפרויקט, שלב 8: ח.פ מוכר מספיק גם כשהשולח לא מאומת; שאר התנאים נשארים, והמנהל מקבל התראה "שולח לא מאומת")
  if (x && x.ua && x.match !== 'hp') why.push('auth');
  return why;
}
// כל השדות זוהו ובביטחון (4.2: "הזיהוי מלא")
function fullOf(m) {
  if (!m || m.k !== 'inv') return false;
  const f = m.f || {};
  if (!f.supplier && !f.hp) return false;
  if (!f.num || !DAY_RE.test(f.date || '') || typeof f.total !== 'number') return false;
  return !(m.unsure || []).some((k) => ['type', 'supplier', 'supplier_id', 'number', 'date', 'total_with_vat'].includes(k));
}
// מפתחות כפילות בשרת: אותו ספק + אותו מספר חשבונית; אותו ספק + אותו תאריך + אותו סכום (כמו dupOf באפליקציה)
function dupKeys(m, sub) {
  const f = m.f || {};
  // לפי הספק כשהוא ידוע (גם כשבקובץ אחד זוהה ח.פ ובשני לא – תיקון 1, ליקוי 7), ואם לא – לפי ח.פ
  const who = sub ? 's' + sub : f.hp ? 'h' + f.hp : '';
  const n = NINV(f.num);
  return { dk: who && n ? who + '|' + n : '', dk2: who && f.date && typeof f.total === 'number' ? who + '|' + f.date + '|' + Math.round(f.total * 100) : '' };
}
// מפתח השולח: ווצאפ – מספר, מייל – כתובת
const senderKey = (ch, from) => (ch === 'wa' ? 'wa:' : 'm:') + String(from || '').toLowerCase().slice(0, 200);

module.exports = { MAX_FILE, MAX_PAGES, PART, CAP_DEFAULT, KEEP_DAYS, CLAIM_MS, KINDS, sha, hpN, hpOk, NINV, nameKey, inspect, badByName, mapClassify, matchSup, brOf, invCfgOf, eligOf, fullOf, dupKeys, senderKey };
