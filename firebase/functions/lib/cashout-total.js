'use strict';
// 6ז (עדכון חוזה 17, החלטת המשתמש 7.11): סכום ההוצאות מקופה לסגירת קופה – מחושב בשרת.
// עובד עם "רואה הוצאות: רק שלו / לא רואה" לא קורא הוצאות של אחרים, אבל הסגירה חייבת את הסכום של כולן.
// הפונקציה מחזירה רק מספרים: { s } = סכום ההוצאות מקופה בחלון, ו-{ diff } = ההפרש מול Z (אם נשלח z). בלי רשומות, בלי שמות, בלי מזהים.
// סבב 2 (בודק, הערה 1): **השרת קובע את החלון**, לא הלקוח – מהסגירה האחרונה של הקופה (zlast/{reg}) ועד סוף יום הסגירה d.
// הלקוח שולח רק קופה ותאריך (היום או אתמול, שעון ישראל). שעות, פתיחה ומזהה סגירה מהלקוח לא משפיעים – כך אי אפשר "לסרוק" דקה אחר דקה.
// גבולות: חלון של 62 יום לכל היותר, עד 3000 מסמכים (מעל = שגיאה, לא סכום חלקי), ו-20 קריאות בשעה לכל משתמש.
// הוצאה "לא ברורה" (מיום הסגירה הקודמת, בלי שעה) לא נספרת כאן – כמו באפליקציה כשלא סימנו אותה.
const { HttpsError } = require('firebase-functions/v2/https');
const { requireStaff, inputObject, hasPerm } = require('./roles');
const T = require('./tenant');

const REGS = ['i_yh', 'i_nl'];
const D_RE = /^\d{4}-\d{2}-\d{2}$/;
const TM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const bad = (r) => { throw new HttpsError('invalid-argument', 'קלט לא תקין', { reason: r }); };
const date = (v) => (typeof v === 'string' && D_RE.test(v) ? v : '');
const time = (v) => (typeof v === 'string' && TM_RE.test(v) ? v : '');
const key = (x) => (x.d || '') + ' ' + (x.tm || '');
const rnd = (n) => Math.round(n * 100) / 100;
function nextDay(d) { const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)); return t.toISOString().slice(0, 10); }
// zcB: הגבול הוא הפתיחה שצורפה לסגירה, אם היא אחרי הסגירה ועד יום אחד אחריה
function bound(x) {
  if (!x) return null;
  const c = { d: x.d, tm: time(x.tm) }, od = date(x.od), otm = time(x.otm);
  if (od && otm && c.d && od <= nextDay(c.d) && key({ d: od, tm: otm }) > key(c)) return { d: od, tm: otm };
  return c;
}
// coIn
function where(x, prev, d, tm) {
  if (!x.d || !d || x.d > d) return 'out';
  if (x.d === d && x.tm && tm && x.tm > tm) return 'out';
  if (!prev) return x.zc ? 'out' : 'in';
  if (x.d < prev.d) return 'out';
  if (x.d > prev.d) return 'in';
  if (x.tm && prev.tm) return x.tm > prev.tm ? 'in' : 'out';
  return 'unc';
}

const MAX_DOCS = 3000, MAX_DAYS = 62, RL_MAX = 20, RL_MS = 3600000;
const ilDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

async function rateLimit(db, uid) {
  const ref = db.doc('fn_rate/cashoutTotal_' + uid); // לא נגיש מהאפליקציה (אין כלל = חסום)
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref), now = Date.now();
    const L = (s.exists && Array.isArray(s.get('t')) ? s.get('t') : []).filter((t) => typeof t === 'number' && now - t < RL_MS);
    if (L.length >= RL_MAX) throw new HttpsError('resource-exhausted', 'יותר מדי בדיקות בשעה האחרונה. נסה שוב מאוחר יותר.', { reason: 'rate-limit' });
    L.push(now);
    tx.set(ref, { t: L });
  });
}

async function cashoutTotal(request) {
  const who = await requireStaff(request, { feature: 'cashClose' });
  // עובד: רק עם "מזין הכנסות" (סגירת קופה). בעסק legacy – כמו היום (כל עובד פעיל).
  if (who.role !== 'manager' && who.biz && who.biz.dataRoot === 'b' && !hasPerm(who, 'incW')) {
    throw new HttpsError('permission-denied', 'אין לך הרשאה לפעולה הזו. פנה למנהל.', { reason: 'no-perm' });
  }
  const i = inputObject(request);
  const reg = REGS.includes(i.reg) ? i.reg : bad('bad-reg');
  const d = date(i.d) || bad('bad-date');
  const now = Date.now(), today = ilDay(now), yday = ilDay(now - 86400000);
  if (d !== today && d !== yday) bad('bad-date');
  let z = null;
  if (i.z != null && i.z !== '') { z = Number(i.z); if (!isFinite(z) || Math.abs(z) > 1e7) bad('bad-z'); z = rnd(Math.abs(z)); }
  const db = T.tdb();
  if (!who.superadmin) await rateLimit(db, who.uid);
  // הסגירה הקודמת – zlast/{reg} (רק אם היא לפני יום הסגירה, או באותו יום). החלון נגמר בסוף היום d.
  let prev = null;
  const zl = await db.doc('zlast/' + reg).get();
  if (zl.exists) {
    const p = { d: date(zl.get('d')), tm: time(zl.get('tm')), od: zl.get('od'), otm: zl.get('otm') };
    if (p.d && p.d <= d) prev = bound(p);
  }
  const cut = ilDay(now - MAX_DAYS * 86400000);
  const from = prev && prev.d > cut ? prev.d : cut;
  const snap = await db.collection('cashout').where('d', '>=', from).limit(MAX_DOCS + 1).get();
  if (snap.size > MAX_DOCS) throw new HttpsError('failed-precondition', 'יותר מדי הוצאות מקופה לבדיקה. פנה למנהל.', { reason: 'too-many' });
  let s = 0;
  snap.forEach((doc) => {
    const g = (k) => doc.get(k);
    const a = Number(g('a'));
    if (g('reg') !== reg || !(a > 0 && a <= 1e6)) return;
    const x = { d: date(g('d')), tm: time(g('tm')), zc: typeof g('zc') === 'string' ? g('zc') : '' };
    if (where(x, prev, d, '') === 'in') s += a;
  });
  s = rnd(s);
  const out = { s };
  if (z != null) out.diff = rnd(Math.abs(z - s));
  return out;
}

module.exports = { cashoutTotal, _t: { bound, where } };
