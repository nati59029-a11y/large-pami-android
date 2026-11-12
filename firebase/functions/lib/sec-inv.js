'use strict';
// המזכירה שלב 7 – קליטת חשבוניות: כלים טהורים (בלי מסד נתונים), כדי שאפשר לבדוק אותם לבד.
//   inspect(buf)      – בדיקת קובץ לפני כל עלות: גודל, חתימת קובץ (לפי התוכן, sniff הקיים), קבצים מכווצים/Office/הפעלה, PDF מוצפן או עם פקודות, מספר עמודים.
//   badByName(fn,mime) – דחייה לפי שם/סוג מוצהר, עוד לפני הורדה (קובץ מצורף במייל).
//   mapClassify(shaped) – תוצאת הסריקה האחידה (lib/classify.js) → סוג מסמך ושדות לתור.
//   matchSup / brOf / eligOf – זיהוי ספק, סניף (40), וזכאות ל"נכנס ישר" (34–36, 4.3). eligOf נקראת גם בזמן העיבוד וגם ב"תפיסה" (secDecide).
const crypto = require('node:crypto');
const scan = require('./scan');

const MAX_FILE = 10 * 1024 * 1024; // כמו SCAN_MAX_FILE_MB (ברירת המחדל) – בדיקה לפני הורדה ולפני פענוח (10.3)
const MAX_PAGES = 4;               // חשבונית: עד 4 עמודים (4.2). מעל – כרטיס "קובץ ארוך – לבדיקה ידנית", בלי זיהוי
const PART = 700000;               // גודל חלק (base64) ב-sec_inv/{id}/p/{k} – מתחת למגבלת המסמך של Firestore
const CAP_DEFAULT = 2000;          // תקרה אחת לעסק (35) – ברירת מחדל מוצעת באפיון (הנחה)
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
function inspect(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, why: 'empty' };
  if (buf.length > MAX_FILE) return { ok: false, why: 'big' };
  const mb = magicBad(buf);
  if (mb) return { ok: false, why: mb };
  const mime = scan.sniff(buf);
  if (!mime) return { ok: false, why: 'type' };
  if (mime !== 'application/pdf') return { ok: true, mime, pages: 1 };
  const s = buf.toString('latin1');
  if (/\/Encrypt\b/.test(s)) return { ok: false, why: 'enc' };
  // PDF עם פקודות (JavaScript, הפעלת קובץ, קובץ מוטמע) – לא נפתח
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(s)) return { ok: false, why: 'active' };
  const pages = (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length || 1;
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
    sups: Array.isArray(d.sups) ? d.sups : [], nb: Number.isInteger(d.nb) ? d.nb : 0, br1: typeof d.br1 === 'string' ? d.br1 : '', supH: typeof d.supH === 'string' ? d.supH : '', supAt: Number(d.supAt) || 0,
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
  const who = f.hp ? 'h' + f.hp : sub ? 's' + sub : '';
  const n = NINV(f.num);
  return { dk: who && n ? who + '|' + n : '', dk2: who && f.date && typeof f.total === 'number' ? who + '|' + f.date + '|' + Math.round(f.total * 100) : '' };
}
// מפתח השולח: ווצאפ – מספר, מייל – כתובת
const senderKey = (ch, from) => (ch === 'wa' ? 'wa:' : 'm:') + String(from || '').toLowerCase().slice(0, 200);

module.exports = { MAX_FILE, MAX_PAGES, PART, CAP_DEFAULT, KEEP_DAYS, CLAIM_MS, KINDS, sha, hpN, hpOk, NINV, nameKey, inspect, badByName, mapClassify, matchSup, brOf, invCfgOf, eligOf, fullOf, dupKeys, senderKey };
