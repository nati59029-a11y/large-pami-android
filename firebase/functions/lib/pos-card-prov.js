'use strict';
// קופה גל 3 (19.11.2026): אשראי במסוף מחובר – ספק הסליקה, מופשט. פונקציות השרת (pos-card.js) מדברות רק עם הממשק הזה.
//
// כלל ברזל: האפליקציה והשרת לא רואים מספר כרטיס לעולם. המסוף הפיזי קורא את הכרטיס; השרת שולח לספק בקשת חיוב בסכום
// ומקבל תוצאה: מאושר / נדחה, מספר אישור, 4 ספרות אחרונות, סוג כרטיס. רק אלה נשמרים.
//
// הממשק (כל פונקציה אסינכרונית; rec = הרשומה poscard/{id}; cred() = פרטי החיבור המפוענחים – נקרא רק כשצריך):
//   start(rec, cred)        → { pid?, st:'wait'|'ok'|'no', appr?, last4?, brand?, msg? }   שליחת בקשת החיוב למסוף
//   status(rec, cred, now)  → { st:'wait'|'ok'|'no'|'err', appr?, last4?, brand?, msg? }   מצב העסקה אצל הספק
//   cancel(rec, cred)       → { st:'cancel' } | { st:'ok', ... } (כבר אושרה – לא בוטלה)      ביטול עסקה שעוד ממתינה
//   refund(rec, cred)       → { st:'void' }                                                ביטול חיוב שאושר (עוד לא שייך למכירה)
//
// שני מימושים:
//   mock    – מסוף מדומה (לבדיקות ולהדגמה): מאשר אחרי MOCK.delay מ"ש. סכום שמסתיים ב-13 אגורות – נדחה; ב-99 אגורות – "אין תשובה" (לבדיקת timeout).
//   cardcom – עדיין לא מחובר: כל פעולה זורקת שגיאה ברורה. לא הומצאו כתובות או שדות של CardCom – ממתינים לתיעוד.
// שום פונקציה כאן לא כותבת ליומן, ושום שגיאה לא כוללת פרטי חיבור.

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const MODES = Object.freeze(['off', 'mock', 'cardcom']);
const MOCK = { delay: 3000 }; // מ"ש עד שהמסוף המדומה "עונה" (בבדיקות – 0)

const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const digitsOf = (hex, n) => { let out = ''; for (let i = 0; out.length < n && i < hex.length; i++) out += String(parseInt(hex[i], 16) % 10); return out; };
const cents = (amt) => ((amt % 100) + 100) % 100;

const mock = Object.freeze({
  name: 'mock',
  async start(rec) { return { pid: 'M' + h('pid:' + rec.id).slice(0, 12), st: 'wait' }; },
  async status(rec, cred, now) {
    if (cents(rec.amt) === 99) return { st: 'wait' }; // "אין תשובה מהמסוף"
    if ((now || Date.now()) - rec.at < MOCK.delay) return { st: 'wait' };
    if (cents(rec.amt) === 13) return { st: 'no', msg: 'הכרטיס נדחה (מסוף מדומה)' };
    const x = h('ok:' + rec.id);
    return { st: 'ok', appr: digitsOf(x, 6), last4: digitsOf(x.slice(16), 4), brand: 'מדומה' };
  },
  async cancel(rec, cred, now) {
    const s = await mock.status(rec, cred, now);
    return s.st === 'ok' ? s : { st: 'cancel' };
  },
  async refund() { return { st: 'void' }; },
});

const notReady = () => new HttpsError('failed-precondition', 'החיבור ל-CardCom עדיין לא הוגדר – ממתין לתיעוד', { reason: 'cardcom-not-ready' });
// TODO(CardCom): המימוש האמיתי – אחרי שיגיע תיעוד חיבור מסוף EMV לקופה (כתובת, אימות, שדות הבקשה והתשובה, ביטול, זיכוי).
const cardcom = Object.freeze({
  name: 'cardcom',
  async start() { throw notReady(); },
  async status() { throw notReady(); },
  async cancel() { throw notReady(); },
  async refund() { throw notReady(); },
});

function prov(mode) {
  if (mode === 'mock') return mock;
  if (mode === 'cardcom') return cardcom;
  throw new HttpsError('failed-precondition', 'אשראי במסוף לא פעיל בעסק', { reason: 'card-off' });
}

// תוצאה מהספק → רק השדות המותרים, בצורה בטוחה (אף פעם לא מספר כרטיס)
function clean(r) {
  const o = { st: ['wait', 'ok', 'no', 'err', 'cancel', 'void'].includes(r && r.st) ? r.st : 'err' };
  if (r && typeof r.pid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.pid)) o.pid = r.pid;
  if (o.st === 'ok') {
    const appr = r && typeof r.appr === 'string' ? r.appr.trim().slice(0, 20) : '';
    const last4 = r && typeof r.last4 === 'string' && /^[0-9]{4}$/.test(r.last4) ? r.last4 : '';
    if (!appr || !/^[A-Za-z0-9-]+$/.test(appr) || !last4) return { st: 'err', msg: 'תשובה לא תקינה מהמסוף' };
    o.appr = appr; o.last4 = last4;
    if (r.brand != null) { const b = String(r.brand).replace(/[\u0000-\u001f\d]/g, '').trim().slice(0, 20); if (b) o.brand = b; }
  }
  if (r && typeof r.msg === 'string' && r.msg) o.msg = r.msg.replace(/[\u0000-\u001f]/g, ' ').replace(/\d{5,}/g, '').slice(0, 120);
  return o;
}

module.exports = { MODES, MOCK, mock, cardcom, prov, clean };
