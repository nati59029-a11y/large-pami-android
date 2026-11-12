'use strict';
// המזכירה – מידע רגיש על עובדים (אפיון 10.8, החלטה 63). שלב 3.
// הכלל: התוכן (שם העובד + הטקסט) נשמר רק מוצפן, באוסף sec_facts_sensitive, שאף אחד לא קורא ישירות מהאפליקציה (חוקי הגישה).
// הצפנה: AES-256-GCM. המפתח נגזר (HKDF-SHA-256) מהסוד SEC_SENS_KEY שבכספת הסודות (defineSecret – לא בקוד), עם מזהה העסק כ-info:
// לכל עסק מפתח אחר, כך שמוצפן של עסק אחד לא נפתח בעסק אחר גם אם הועתק. AAD = נתיב המסמך היחסי (sec_facts_sensitive/{id}),
// כך שאי אפשר להעביר "קופסה" ממסמך למסמך. מפתח נפרד ממפתח הגיבוי וממפתח הכרטיסים (10.8 המלצה 1).
// כלל ברזל: שום שגיאה ושום רישום ביומן לא כוללים את התוכן. היומן (sec_log) נכתב בקוד שקורא לכאן (secretary-know.js / secretary.js).

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const SEC_SENS_KEY = defineSecret('SEC_SENS_KEY');
const VER = 1;
const SALT = Buffer.from('large-pami/sec-sens/v1', 'utf8');
const COLL = 'sec_facts_sensitive';
const MAX_DOCS = 300;   // רשומות רגישות לעסק
const TEXT_MAX = 500;   // תווים לרשומה (מזעור – 10.8 המלצה 4)
const NAME_MAX = 60;

// חומר המפתח: base64 של 32 בתים ומעלה (openssl rand -base64 32). אחרת – הפונקציה לא פועלת (לא מצפינים במפתח חלש)
function material(secret) {
  const s = String(secret == null ? '' : secret).trim();
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0) {
    const b = Buffer.from(s, 'base64');
    if (b.length >= 32) return b;
  }
  throw new HttpsError('failed-precondition', 'מפתח ההצפנה של המידע הרגיש לא מוגדר בשרת. פנו למנהל המערכת.', { reason: 'no-sens-key' });
}
function keyFor(secret, bizId) {
  if (typeof bizId !== 'string' || !bizId) throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  return Buffer.from(crypto.hkdfSync('sha256', material(secret), SALT, Buffer.from('biz:' + bizId, 'utf8'), 32));
}
const aadOf = (id) => Buffer.from(COLL + '/' + id, 'utf8');
// aad מלא (תיקון סבב 1): להודעות צ'אט שמבוססות על מידע רגיש – 'sec_chat/<uid>/m/<id>'. רשומות המידע הרגיש – COLL/<id>
const aadAny = (id) => (String(id).includes('/') ? Buffer.from(String(id), 'utf8') : aadOf(id));
function seal(secret, bizId, id, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(secret, bizId), iv);
  c.setAAD(aadAny(id));
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()]);
  return { v: VER, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
}
function open(secret, bizId, id, box) {
  if (!box || box.v !== VER || typeof box.iv !== 'string' || typeof box.ct !== 'string' || typeof box.tag !== 'string') return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyFor(secret, bizId), Buffer.from(box.iv, 'base64'));
    d.setAAD(aadAny(id));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    const o = JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (e) {
    if (e instanceof HttpsError) throw e; // מפתח חסר – לא "רשומה פגומה"
    return null; // קופסה פגומה / מפתח אחר / הועתקה ממסמך אחר – לא נפתחת
  }
}

const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim() : '').slice(0, n + 1);

// קריאה ופענוח של כל הרשומות (עד MAX_DOCS) – רק בשרת. מחזיר [{ id, emp, text, t, by }]; רשומה שלא נפתחת – { id, bad: true }
async function readAll(db, secret, bizId) {
  const s = await db.collection(COLL).limit(MAX_DOCS).get();
  return s.docs.map((d) => {
    const o = open(secret, bizId, d.id, d.get('box'));
    if (!o) return { id: d.id, bad: true, t: d.get('t') || 0 };
    return { id: d.id, emp: clean(o.emp, NAME_MAX), text: clean(o.text, TEXT_MAX), t: d.get('t') || 0, by: d.get('by') || '' };
  }).sort((a, b) => (b.t || 0) - (a.t || 0));
}
// התאמת שם עובד (חלקי, בלי רווחים כפולים) – לשליפה ממוזערת למודל
// תיקון סבב 1: לא "מכיל" – רק שם מלא, או מילים שלמות מהשם (שם פרטי / משפחה), כל מילה לפחות 2 תווים
const norm = (s) => clean(String(s || ''), NAME_MAX).normalize('NFKC').replace(/[\u0591-\u05C7]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
function sameEmp(a, q) {
  const x = norm(a), y = norm(q);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(' '), ys = y.split(' ');
  return ys.every((w) => w.length >= 2) && ys.every((w) => xs.includes(w));
}
// הרשומות של העובד שנשאל עליו. כמה עובדים שונים מתאימים – רק רשימת שמות לבירור, בלי תוכן (מזעור – 10.8 המלצה 4)
function pickEmp(all, q) {
  const L = all.filter((x) => !x.bad && sameEmp(x.emp, q));
  const names = [...new Set(L.map((x) => norm(x.emp)))];
  if (names.length > 1) return { ambiguous: true, names: [...new Set(L.map((x) => x.emp))].slice(0, 10), items: [] };
  return { ambiguous: false, items: L.slice(0, 5) };
}
const HIDDEN = '(הודעה עם מידע רגיש – מוסתרת)';

module.exports = { SEC_SENS_KEY, seal, open, readAll, sameEmp, pickEmp, HIDDEN, clean, keyFor, material, COLL, MAX_DOCS, TEXT_MAX, NAME_MAX, VER };
