'use strict';
// הצפנת פרטי כרטיס אשראי (fb/ord-card, החלטות המשתמש 00:32/00:37/00:38/00:50 ב-9.11).
// AES-256-GCM. המפתח נגזר (HKDF-SHA-256) מהסוד CARD_ENC_KEY שב-Secret Manager, עם מזהה העסק כ-info –
// לכל עסק מפתח אחר, כך שמוצפן של עסק אחד לא נפתח בעסק אחר גם אם הועתק. AAD = נתיב המסמך היחסי (cust/{id}).
// כלל ברזל: אף פונקציה כאן לא כותבת ליומן, ושום שגיאה לא כוללת את הערכים.

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const VER = 1;
const SALT = Buffer.from('large-pami/card/v1', 'utf8');
const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });

// חומר המפתח: base64 של 32 בתים ומעלה (openssl rand -base64 32), או מחרוזת של 32 תווים ומעלה. אחרת – הפונקציה לא פועלת.
function material(secret) {
  const s = String(secret == null ? '' : secret).trim();
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0) {
    const b = Buffer.from(s, 'base64');
    if (b.length >= 32) return b;
  }
  const u = Buffer.from(s, 'utf8');
  if (u.length >= 32 && s !== 'unset') return u;
  throw new HttpsError('failed-precondition', 'מפתח ההצפנה של כרטיסי האשראי לא מוגדר בשרת. פנו למנהל המערכת.', { reason: 'no-card-key' });
}
function keyFor(secret, bizId) {
  if (typeof bizId !== 'string' || !bizId) throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  return Buffer.from(crypto.hkdfSync('sha256', material(secret), SALT, Buffer.from('biz:' + bizId, 'utf8'), 32));
}
function seal(secret, bizId, aad, obj) {
  const key = keyFor(secret, bizId);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(String(aad), 'utf8'));
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()]);
  return { v: VER, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
}
function open(secret, bizId, aad, box) {
  if (!box || box.v !== VER || typeof box.iv !== 'string' || typeof box.ct !== 'string' || typeof box.tag !== 'string') {
    throw new HttpsError('data-loss', 'פרטי הכרטיס השמורים לא תקינים', { reason: 'bad-box' });
  }
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyFor(secret, bizId), Buffer.from(box.iv, 'base64'));
    d.setAAD(Buffer.from(String(aad), 'utf8'));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8'));
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('data-loss', 'לא ניתן לפענח את פרטי הכרטיס', { reason: 'bad-box' });
  }
}

// ---------- ולידציה (בלי להחזיר את הערך בהודעות) ----------
const digs = (v) => String(v == null ? '' : v).replace(/\D/g, '');
function numOf(v) {
  const s = String(v == null ? '' : v);
  if (/\p{L}/u.test(s)) throw bad('bad-card-num', 'מספר כרטיס: ספרות בלבד');
  const d = digs(s);
  if (!/^\d{13,19}$/.test(d)) throw bad('bad-card-num', 'מספר כרטיס: 13 עד 19 ספרות');
  return d;
}
// תוקף: MM/YY, MM/YYYY, MMYY, MM-YY, YYYY-MM(-DD) (מאקסל) → "MM/YY"
function expOf(v) {
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{1,2})\s*[/.\-\\ ]\s*(\d{2}|\d{4})$/.exec(s) || /^(\d{2})(\d{2})$/.exec(s);
  let mm, yy;
  if (m) { mm = +m[1]; yy = m[2].slice(-2); } else if ((m = /^(\d{4})-(\d{2})(-\d{2})?/.exec(s))) { mm = +m[2]; yy = m[1].slice(-2); } else throw bad('bad-card-exp', 'תוקף: חודש/שנה (MM/YY)');
  if (!(mm >= 1 && mm <= 12)) throw bad('bad-card-exp', 'תוקף: חודש 1 עד 12');
  return String(mm).padStart(2, '0') + '/' + yy;
}
function cvvOf(v) {
  const d = String(v == null ? '' : v).trim();
  if (!/^\d{3,4}$/.test(d)) throw bad('bad-card-cvv', 'קוד אבטחה: 3 או 4 ספרות');
  return d;
}
function holderOf(v) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 60) throw bad('bad-card-name', 'שם בעל הכרטיס: עד 60 תווים');
  if (/\d{5,}/.test(s.replace(/\D+/g, (x) => (x.length <= 1 ? '' : ' ')))) throw bad('bad-card-name', 'שם בעל הכרטיס: בלי מספרים');
  return s;
}
const empty = (v) => v == null || v === '';
// card = { num, exp?, name?, cvv? } → אובייקט נקי. num חובה.
function cleanCard(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('bad-card', 'פרטי כרטיס חסרים');
  for (const k of Object.keys(c)) if (!['num', 'exp', 'name', 'cvv'].includes(k)) throw bad('bad-field', 'שדה לא מוכר בפרטי כרטיס');
  const o = { num: numOf(c.num) };
  if (!empty(c.exp)) o.exp = expOf(c.exp);
  if (!empty(c.name)) o.name = holderOf(c.name);
  if (!empty(c.cvv)) o.cvv = cvvOf(c.cvv);
  return o;
}

module.exports = { seal, open, cleanCard, keyFor, material, VER };
