'use strict';
// סריקה אחידה (משימה 2026-11-07, שלב 1): עיבוד התשובה של סוג classify בשרת.
//   allowedTypes(who) – אילו סוגים המשתמש רשאי לקבל עם נתונים (אותה הגדרה כמו בדיקות ההרשאה של scanDocument לכל סוג).
//   shapeClassify(raw, allowed) – מסנן את התשובה של Gemini לרשימה סגורה של שדות; סוג אסור = סוג בלבד, בלי נתונים.
// עיקרון: לעולם לא מחזירים לעובד שדות של מסמך שאין לו הרשאה אליו – גם לא את הטקסט הגולמי.

const { hasPerm } = require('./roles');

const TYPES = ['invoice', 'cashout', 'deposit', 'transfer', 'zreport', 'opening', 'check', 'statement'];
// חלק ג' (2026-11-08): דף בנק/אשראי – עד 300 שורות; מעבר לזה נחתך (truncated)
const STM_MAX = 300;
// תתי־סוג של "invoice" (הוצאה): חשבונית, תעודת משלוח, קבלה (נשמרת כהוצאה), חשבונית זיכוי (סכום שלילי)
const DOC_TYPES = ['invoice', 'delivery_note', 'receipt', 'credit_note'];
const Z_PARTS = ['top', 'middle', 'bottom'];
const LOW = 0.7; // מתחת לזה השדה מסומן "לא בטוח" (צהוב באפליקציה)

const S = 's', N = 'n';
const FIELDS = {
  invoice: { supplier: S, supplier_id: S, number: S, date: S, total_before_vat: N, vat_amount: N, total_with_vat: N, related_invoice: S },
  cashout: { register: S, store: S, date: S, time: S, amount: N },
  deposit: { date: S, time: S, amount: N, bank: S, account: S },
  transfer: { transfers: 'transfers' },
  zreport: Object.assign({ register: S, store: S, date: S, time: S, report_no: S },
    Object.fromEntries(['credit', 'cash', 'checks', 'voucher_buy', 'voucher_credit', 'voucher_issue', 'house', 'rounding', 'total', 'open_float', 'cash_sales', 'cash_out', 'cash_in_drawer'].map((k) => [k, N]))),
  opening: { register: S, store: S, date: S, time: S, total: N },
  // צ'ק ששילמנו לספק (חלק ב' 2026-11-08): date = תאריך הפירעון שעל הצ'ק; payee = המוטב (הספק)
  check: { number: S, bank: S, branch: S, account: S, date: S, amount: N, payee: S },
  // דף בנק/אשראי (חלק ג'): kind = bank|card; last4 = רק 4 ספרות אחרונות; lines מצונזרים (אין מספר כרטיס/חשבון מלא)
  statement: { kind: S, last4: S, from: S, to: S, lines: 'lines' },
};

// מנהל = הכול. עסק legacy (לארג' פעמי היום): עובד – הכול חוץ מהעברה (כמו scanDocument היום). עסק במבנה b: לפי expW/incW/trf.
// חלק ג': statement – מנהל בלבד. check אצל עובד לא נכלל כאן (הוא לא מזכה בסריקה); הוא מוחזר תמיד עם route:'mgr' (ראו shapeClassify, opts.route)
function allowedTypes(who) {
  if (!who || who.role === 'manager') return TYPES.slice();
  if (!(who.biz && who.biz.dataRoot === 'b')) return TYPES.filter((t) => t !== 'transfer' && t !== 'statement');
  const out = [];
  if (hasPerm(who, 'expW')) out.push('invoice', 'cashout', 'check');
  if (hasPerm(who, 'incW')) out.push('zreport', 'opening', 'deposit');
  if (hasPerm(who, 'trf')) out.push('transfer');
  return TYPES.filter((t) => out.includes(t));
}

const str = (v) => (v == null ? null : typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || null : null);
const num = (v) => {
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s₪]/g, '')) : NaN;
  return Number.isFinite(x) && Math.abs(x) < 1e9 ? Math.round(x * 100) / 100 : null;
};
const conf = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
const intOrNull = (v) => (Number.isInteger(v) && v > 0 && v < 1000 ? v : null);

// צנזור: כל רצף 8–19 ספרות (גם עם רווחים/מקפים) → ••••+4 אחרונות. כמו stlScrub באפליקציה
function scrub(v) {
  if (v == null) return v;
  // כל רצף של 8+ ספרות עם מפרידים כלשהם ביניהן (רווחים, נקודות, לוכסנים, מקפים, קו תחתון, רווח קשיח, סימני כיוון), באורך כלשהו → ••••+4 אחרונות. זהה ל-stlScrub בלקוח
  return String(v).replace(/\d(?:[\s.\-\/\\_\u00a0\u200e\u200f\u202a-\u202e]*\d){7,}/g, (m) => {
    if (/^\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4}$|^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/.test(m)) return m;
    return '\u2022\u2022\u2022\u2022' + m.replace(/\D/g, '').slice(-4);
  });
}
function cleanLines(a, out) {
  if (!Array.isArray(a)) return [];
  if (a.length > STM_MAX) out.truncated = true;
  return a.slice(0, STM_MAX).filter((l) => l && typeof l === 'object').map((l) => {
    const amt = num(l.amt != null ? l.amt : l.amount);
    const dir = l.dir === 'in' || l.dir === 'out' ? l.dir : (typeof amt === 'number' && amt < 0 ? 'out' : null);
    return { date: str(l.date), desc: scrub(str(l.desc)), amt: amt == null ? null : Math.abs(amt), dir, ref: scrub(str(l.ref)) };
  });
}
const last4 = (v) => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : null; };

function cleanTransfers(a) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, 50).filter((t) => t && typeof t === 'object').map((t) => {
    const pa = t.payee_account && typeof t.payee_account === 'object' ? t.payee_account : {};
    return { amount: num(t.amount), date: str(t.date), payee_name: str(t.payee_name), payee_account: { bank: str(pa.bank), branch: str(pa.branch), account: str(pa.account) }, reference: str(t.reference) };
  });
}

// raw = התשובה של Gemini אחרי JSON.parse (או null). allowed = allowedTypes(who).
// opts.route = המשתמש אינו מנהל: צ'ק לא נדחה – מוחזר עם route:'mgr' ושדות הצ'ק בלבד (§5א)
function shapeClassify(raw, allowed, opts) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const t0 = typeof o.type === 'string' ? o.type.trim() : '';
  const docType = DOC_TYPES.includes(t0) ? t0 : null;
  const type = docType ? 'invoice' : TYPES.includes(t0) ? t0 : 'unknown';
  const out = {
    type, docType, typeConfidence: conf(o.type_confidence),
    zPart: type === 'zreport' && Z_PARTS.includes(o.z_part) ? o.z_part : null,
    page: type === 'invoice' ? intOrNull(o.page_number) : null,
    pages: type === 'invoice' ? intOrNull(o.page_count) : null,
    allowed: type === 'unknown' || allowed.includes(type) || (type === 'check' && !!(opts && opts.route)),
    fields: {}, confidence: {}, uncertain: [],
  };
  if (type === 'unknown') return out;
  if (!out.allowed) {
    // סוג חסום: סוג בלבד, בלי נתונים ובלי מספר חשבונית/דף. המסמך הולך למנהל לטיפול (שלב 6).
    out.page = null; out.pages = null;
    return Object.assign(out, { reason: 'no-perm', toManager: true });
  }
  const f = o.fields && typeof o.fields === 'object' && !Array.isArray(o.fields) ? o.fields : {};
  const c = o.confidence && typeof o.confidence === 'object' && !Array.isArray(o.confidence) ? o.confidence : {};
  for (const [k, kind] of Object.entries(FIELDS[type])) {
    if (!Object.hasOwn(f, k)) continue;
    out.fields[k] = kind === S ? str(f[k]) : kind === N ? num(f[k]) : kind === 'lines' ? cleanLines(f[k], out) : cleanTransfers(f[k]);
    const cv = Object.hasOwn(c, k) ? conf(c[k]) : null;
    if (cv !== null) out.confidence[k] = cv;
  }
  if (type === 'statement') {
    if ('kind' in out.fields) out.fields.kind = out.fields.kind === 'card' ? 'card' : out.fields.kind === 'bank' ? 'bank' : null;
    if ('last4' in out.fields) out.fields.last4 = last4(out.fields.last4);
  }
  if (type === 'check') {
    if ('account' in out.fields) out.fields.account = last4(out.fields.account); // מספר חשבון – רק 4 אחרונות
    for (const k of ['payee', 'bank', 'number']) if (k in out.fields) out.fields[k] = scrub(out.fields[k]);
    if (opts && opts.route) out.route = 'mgr';
  }
  if (docType === 'credit_note') {
    // חשבונית זיכוי: הסכומים תמיד שליליים (גם אם המודל החזיר חיובי)
    for (const k of ['total_before_vat', 'vat_amount', 'total_with_vat']) if (typeof out.fields[k] === 'number') out.fields[k] = -Math.abs(out.fields[k]);
    out.credit = true;
  }
  // לא בטוח: ביטחון נמוך, או שדה שלא נקרא. תאריך חסר תמיד ברשימה (האפליקציה ממלאת "היום" בצהוב).
  const keys = type === 'transfer' ? ['transfers'] : type === 'statement' ? ['kind', 'last4'] : Object.keys(FIELDS[type]);
  for (const k of keys) {
    const v = out.fields[k];
    const missing = v == null || (Array.isArray(v) && !v.length);
    if ((out.confidence[k] != null && out.confidence[k] < LOW) || (missing && k === 'date')) out.uncertain.push(k);
  }
  if (out.typeConfidence != null && out.typeConfidence < LOW) out.uncertainType = true;
  return out;
}

module.exports = { TYPES, DOC_TYPES, FIELDS, LOW, STM_MAX, allowedTypes, shapeClassify, scrub };
