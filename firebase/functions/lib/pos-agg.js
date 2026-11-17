'use strict';
// קופה (POS), ש5 – משמרת: PIN, אישור אחראי, מזומן ומגירה, דוח Z, שעון נוכחות. פונקציות טהורות (בלי Firestore). השרת: pos-auth.js, pos-cash.js, pos-z.js, pos-clock.js.
// כל הסכומים באגורות (מספר שלם). Z = סכום המכירות פחות ההחזרות – מדויק לאגורה (חיבור של מספרים שלמים בלבד, בלי שברים).
//
// ממשק מדומה של ש2 (מכירה ותשלום) – עד שהמימוש שלו יתמזג. השדות שנקראים כאן בלבד:
//   possale: { id, shift, dev, cashier, gross, st: 'ok' | 'void' }            מכירה בוטלה (void) לא נספרת
//   pospay:  { sale, shift, m: 'cash' | 'card' | …, a, chg? }                  a = הסכום שהתקבל; chg = עודף שהוחזר (מזומן). נטו = a - chg
//   posret:  { sale, shift, gross, m, st? }                                    gross = סכום ההחזר (חיובי); st: 'void' לא נספר
// שדה חסר / לא שלם – הרשומה נדחית מהחישוב ונספרת ב-bad (כדי שהמנהל יראה), ולא "מעוגלת".

const crypto = require('crypto');

const PIN_RE = /^[0-9]{4,6}$/;
const PIN_WEAK = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '123456', '654321', '000000', '111111']);
const PIN_MAX_FAILS = 5;          // אחרי 5 ניסיונות שגויים
const PIN_LOCK_MS = 30 * 1000;    // נעילה ל-30 שניות
const LEAD_DISC_MAX = 10;         // אחראי משמרת מאשר הנחה עד 10%. מעל זה – מנהל בלבד
const MV_KINDS = Object.freeze({ in: 'הכנסה למגירה', out: 'הוצאה', drop: 'הפקדה' });
const MV_MAX = 400;               // תנועות מזומן למשמרת
const AMT_MAX = 100000000;        // מיליון ₪ באגורות

const isAg = (v) => Number.isInteger(v) && v >= 0 && v <= AMT_MAX;
const fail = (reason, msg) => { const e = new Error(msg || reason); e.reason = reason; return e; };

// ---------- PIN ----------
function pinCheckNew(pin) {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw fail('bad-pin', 'קוד PIN – 4 עד 6 ספרות');
  if (PIN_WEAK.has(pin)) throw fail('weak-pin', 'קוד PIN פשוט מדי. בחרו קוד אחר');
  return pin;
}
function pinHash(pin, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pin), salt, 32, { N: 4096, r: 8, p: 1 }).toString('hex');
  return { h, s: salt };
}
function pinMatch(pin, rec) {
  if (!rec || typeof rec.h !== 'string' || typeof rec.s !== 'string' || typeof pin !== 'string' || !PIN_RE.test(pin)) return false;
  const a = Buffer.from(pinHash(pin, rec.s).h, 'hex'), b = Buffer.from(rec.h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// מצב הנעילה ברגע now. → { locked, wait (שניות) }
function lockState(rec, now) {
  const u = rec && Number.isInteger(rec.lockUntil) ? rec.lockUntil : 0;
  return u > now ? { locked: true, wait: Math.ceil((u - now) / 1000) } : { locked: false, wait: 0 };
}
// אחרי ניסיון: ok – איפוס המונה; שגוי – מונה +1, ובחמישי: נעילה ל-30 שניות, המונה מתאפס, alert = התראה למנהל.
// → { fails, lockUntil, alert }
function pinAfter(rec, ok, now) {
  if (ok) return { fails: 0, lockUntil: 0, alert: false };
  const f = (rec && Number.isInteger(rec.fails) ? rec.fails : 0) + 1;
  if (f >= PIN_MAX_FAILS) return { fails: 0, lockUntil: now + PIN_LOCK_MS, alert: true };
  return { fails: f, lockUntil: rec && Number.isInteger(rec.lockUntil) ? rec.lockUntil : 0, alert: false };
}

// ---------- אישור אחראי ----------
// role: 'manager' | 'lead' | 'cashier'. cfg.discMax = { cashier, lead } (PosCfg). → { ok, need: null | 'lead' | 'manager' }
// קופאי: עד discMax.cashier בלי אישור. אחראי משמרת: עד min(discMax.lead, 10). מעל זה – מנהל.
function discNeed(pct, cfg) {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) throw fail('bad-disc', 'אחוז הנחה לא תקין');
  const dm = (cfg && cfg.discMax) || {};
  const cash = Number.isFinite(dm.cashier) ? dm.cashier : 5;
  const lead = Math.min(Number.isFinite(dm.lead) ? dm.lead : LEAD_DISC_MAX, LEAD_DISC_MAX);
  if (pct <= cash) return null;
  if (pct <= lead) return 'lead';
  return 'manager';
}
const canApprove = (role, need) => need === null || role === 'manager' || (need === 'lead' && role === 'lead');

// ---------- מזומן ----------
// תנועה במגירה. → { k, a, note }
function mvIn(k, a, note) {
  if (!Object.prototype.hasOwnProperty.call(MV_KINDS, k)) throw fail('bad-op', 'סוג תנועה לא מוכר');
  if (!isAg(a) || a === 0) throw fail('bad-amt', 'סכום לא תקין');
  const n = typeof note === 'string' ? note.trim().slice(0, 120) : '';
  if (k === 'out' && !n) throw fail('bad-note', 'כתבו על מה ההוצאה');
  if (/[\u0000-\u001f]/.test(n)) throw fail('bad-note', 'הערה לא תקינה');
  return { k, a, note: n };
}
const sumInt = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
// כמה מזומן אמור להיות במגירה: פתיחה + הכנסות + מזומן נטו ממכירות − החזרים במזומן − הוצאות − הפקדות
function cashExpected(shift, agg) {
  const mv = Array.isArray(shift && shift.mv) ? shift.mv : [];
  const by = (k) => sumInt(mv.filter((m) => m && m.k === k && isAg(m.a)), (m) => m.a);
  const open = isAg(shift && shift.open) ? shift.open : 0;
  const o = { open, in: by('in'), out: by('out'), drop: by('drop'), sales: agg ? agg.pay.cash || 0 : 0, refunds: agg ? agg.retBy.cash || 0 : 0 };
  o.expected = o.open + o.in + o.sales - o.refunds - o.out - o.drop;
  return o;
}
// מעל תקרת המזומן (cfg.cashMax, 0 = בלי תקרה) – אזהרה שהקופאי מאשר. acked = הסכום שבו כבר אושרה האזהרה: אזהרה חוזרת רק כשהסכום עלה מעליו.
function overCap(expected, cashMax, acked) {
  if (!Number.isInteger(cashMax) || cashMax <= 0) return { over: false, warn: false };
  const over = expected > cashMax;
  return { over, warn: over && !(Number.isInteger(acked) && acked >= expected), by: over ? expected - cashMax : 0 };
}

// ---------- Z ----------
// sales / pays / rets – רשומות המשמרת (צורת ש2 למעלה). → סיכום באגורות
function zAgg(sales, pays, rets) {
  const out = { n: 0, sales: 0, voids: 0, rets: 0, nRet: 0, z: 0, pay: {}, retBy: {}, bad: 0 };
  for (const s of sales || []) {
    if (!s || !Number.isInteger(s.gross)) { out.bad++; continue; }
    if (s.st === 'void') { out.voids++; continue; }
    out.n++; out.sales += s.gross;
  }
  const voided = new Set((sales || []).filter((s) => s && s.st === 'void').map((s) => s.id));
  for (const p of pays || []) {
    if (!p || typeof p.m !== 'string' || !Number.isInteger(p.a) || (p.chg != null && !Number.isInteger(p.chg))) { out.bad++; continue; }
    if (voided.has(p.sale)) continue;
    out.pay[p.m] = (out.pay[p.m] || 0) + p.a - (p.chg || 0);
  }
  for (const r of rets || []) {
    if (!r || !Number.isInteger(r.gross) || r.gross < 0) { out.bad++; continue; }
    if (r.st === 'void') continue;
    out.nRet++; out.rets += r.gross;
    const m = typeof r.m === 'string' ? r.m : 'cash';
    out.retBy[m] = (out.retBy[m] || 0) + r.gross;
  }
  out.z = out.sales - out.rets;
  return out;
}
// דוח Z מלא למשמרת: הסיכום + המזומן + הספירה. counted = מה שנספר במגירה (אגורות) או null
function zReport(shift, agg, counted) {
  const cash = cashExpected(shift, agg);
  const r = { z: agg.z, n: agg.n, sales: agg.sales, rets: agg.rets, nRet: agg.nRet, voids: agg.voids, pay: agg.pay, retBy: agg.retBy, bad: agg.bad, cash };
  if (counted != null) {
    if (!isAg(counted)) throw fail('bad-amt', 'הסכום שנספר לא תקין');
    r.counted = counted; r.diff = counted - cash.expected;
  }
  return r;
}

// ---------- שעון נוכחות ----------
const DAY_MS = 24 * 3600 * 1000;
// יום לפי שעון ישראל (YYYYMMDD)
function dayOf(t) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  return p.replace(/-/g, '');
}
// דקות במשמרת נוכחות. משמרת פתוחה – עד now. יותר מ-16 שעות – נחתך ומסומן long (שכחו להחתים יציאה)
function clockMin(rec, now) {
  if (!rec || !Number.isInteger(rec.in)) return { min: 0, open: false, long: false };
  const end = Number.isInteger(rec.out) ? rec.out : now;
  let ms = Math.max(0, end - rec.in);
  const long = ms > 16 * 3600 * 1000;
  if (long) ms = 16 * 3600 * 1000;
  return { min: Math.floor(ms / 60000), open: !Number.isInteger(rec.out), long };
}
// סיכום לכל עובד: { uid: { min, n, open, long } }
function clockSum(recs, now) {
  const o = {};
  for (const r of recs || []) {
    if (!r || typeof r.who !== 'string') continue;
    const c = clockMin(r, now), x = o[r.who] || (o[r.who] = { min: 0, n: 0, open: false, long: 0 });
    x.min += c.min; x.n++; if (c.open) x.open = true; if (c.long) x.long++;
  }
  return o;
}

module.exports = {
  PIN_RE, PIN_MAX_FAILS, PIN_LOCK_MS, LEAD_DISC_MAX, MV_KINDS, MV_MAX, AMT_MAX, DAY_MS,
  isAg, pinCheckNew, pinHash, pinMatch, lockState, pinAfter, discNeed, canApprove,
  mvIn, cashExpected, overCap, zAgg, zReport, dayOf, clockMin, clockSum,
};
