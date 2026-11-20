'use strict';
// "כל ההכנסות" (20.11.2026) – כל ההכנסות של העסק במקום אחד. קריאה בלבד: לא כותב אף רשומה של הכנסות, סגירות, קופה או כספית.
// החלטות בעל העסק (20.11):
//   סך ההכנסות = סגירות הקופה (closings, st:'ok' – מה שהוכנס להכנסות) + הקופה החדשה (possale.gross פחות posret.amt) + הכנסות אחרות שנרשמו
//   באפליקציה (רק במכשיר המנהל – S.tx, לא בשרת). מכירות כספית (cxDay / cxDayP) – בנפרד, להשוואה בלבד, לא בסך (אותו כסף כמו הסגירה).
//   הרשאה: מנהל, או עובד שהמנהל סימן (staff/{uid}.incA = true, נכתב רק כאן – op:'see'). עובד בלי הסימון לא מקבל נתונים.
//
//   incAll({ op:'get', from, to })  – עד 92 ימים → { zc:{ on, list:[{ id, reg, d, od, tm, no, by, amt, rows:[[שם, סכום]] }], more? },
//                                     pos:{ on, days:{ 'YYYY-MM-DD': { s, n, r, rn, debt } }, docs:[מזהי ardoc של מכירות/החזרות], more? }, cx:{ on, days:[{ d, bk, bn, gross, ret, disc, ntx, sp, pt? }], reg } }
//                                     כל הסכומים בשקלים, מעוגלים לאגורות (בקופה החדשה – חישוב באגורות שלמות). מקור כבוי בעסק → on:false בלי נתונים.
//   incAll({ op:'day', d })         – הרשומות של הקופה החדשה ביום אחד → { sales:[{ id, dev, seq, hm, gross, debt, st, cust?, chk? }], rets:[{ id, dev, hm, amt, sale? }], more? }
//   incAll({ op:'see', uid, on })   – מנהל בלבד: עובד רואה / לא רואה את המסך (staff/{uid}.incA). מנהל רואה תמיד (is-admin).
// הנחות (מסומנות בדוח): מכירה בהקפה נספרת ביום המכירה (כמו שורת "הקפה" בסגירה הקיימת), ותשלום החוב אחר כך לא נספר שוב;
//   הסכומים כוללים מע"מ, כמו שנשמרו; מכירה מבוטלת (st:'void') והחזרה מבוטלת לא נספרות; סגירה שממתינה לאישור או נדחתה – לא נספרת.
// שגיאות (details.reason): no-perm, manager-only, bad-op, bad-range, bad-day, bad-uid, bad-on, is-admin, no-staff, bad-field.

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject } = require('./lib/roles');
const T = require('./lib/tenant');

const DATE_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_DAYS = 92;
const POS_MAX = 30000; // מכירות בבקשה אחת (טווח של 92 ימים); מעבר לזה – more:true
const DAY_MAX = 3000; // רשומות ביום אחד
const ZC_MAX = 2000;
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const on = (biz, k) => !!(biz && biz.features && biz.features[k] === true);
const ag = (v) => (Number.isInteger(v) ? v : 0);
const r2 = (n) => Math.round(((+n || 0) + Number.EPSILON) * 100) / 100; // כמו rnd ב-index.html
function onlyKeys(input, keys) { for (const k of Object.keys(input)) if (!keys.includes(k)) throw bad('bad-field', 'שדה לא מוכר: ' + k); }

// ---------- תאריכים לפי שעון ישראל ----------
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
const HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const ymd = (t) => FMT.format(new Date(t));
const hm = (t) => (Number.isFinite(t) ? HM.format(new Date(t)) : '');
const addDay = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// תחילת היום (00:00 בישראל) במילישניות. ישראל: UTC+2 או UTC+3
function dayStart(d) {
  for (const off of [3, 2]) { const t = Date.parse(d + 'T00:00:00Z') - off * 3600e3; if (ymd(t) === d && ymd(t - 1) !== d) return t; }
  return Date.parse(d + 'T00:00:00Z') - 2 * 3600e3;
}
function rangeOf(input) {
  const from = input.from, to = input.to;
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to || addDay(from, 0) !== from || addDay(to, 0) !== to) throw bad('bad-range', 'טווח תאריכים לא תקין');
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > MAX_DAYS - 1) throw bad('bad-range', 'עד 92 ימים בכל בקשה');
  return [from, to];
}

// ---------- סגירת קופה: אותו חישוב כמו zcCalc באפליקציה (index.html) – שורה לכל אמצעי תשלום, עיגולים בתוך המזומן ----------
const ZPAY = [['credit', 'אשראי'], ['cash', 'מזומן'], ['checks', 'צ׳קים'], ['vbuy', 'שובר קניה'], ['vcred', 'שובר זיכוי'], ['vissue', 'הנפקת שובר זיכוי'], ['house', 'הקפה']];
// pNum באפליקציה: ₪ ורווחים, סוגריים = מינוס, פסיק/נקודה עשרוניים
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v == null ? '' : v).replace(/[₪\s]|ש"ח|שח/g, '');
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '');
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c > -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return neg ? -parseFloat(s) : parseFloat(s);
}
// → { rows:[[שם, סכום]], amt } (סכום = סך השורות, באגורות שלמות)
function zcRows(f) {
  f = f && typeof f === 'object' ? f : {};
  const rows = [];
  for (const [k, sub] of ZPAY) {
    if (k === 'cash') continue;
    let v = num(f[k]);
    if (v != null && k === 'vissue') v = -Math.abs(v); // הנפקת שובר זיכוי – תמיד במינוס
    if (v != null && Math.abs(v) >= 0.005) rows.push([sub, r2(v)]);
  }
  const cash = r2((num(f.cash) || 0) + (num(f.round) || 0));
  if (Math.abs(cash) >= 0.005) rows.splice(Math.min(1, rows.length), 0, ['מזומן', cash]);
  const a = rows.reduce((s, r) => s + Math.round(r[1] * 100), 0);
  return { rows, amt: a / 100 };
}
async function closings(db, from, to) {
  const s = await db.collection('closings').where('d', '>=', from).where('d', '<=', to).limit(ZC_MAX + 1).get();
  const list = [];
  for (const doc of s.docs.slice(0, ZC_MAX)) {
    const x = doc.data();
    if (x.st !== 'ok' || typeof x.d !== 'string' || !DATE_RE.test(x.d)) continue; // ממתינה לאישור / נדחתה – עוד לא הכנסה
    let j = {}; try { j = JSON.parse(typeof x.data === 'string' ? x.data : '{}'); } catch (e) { j = {}; }
    const z = zcRows(j && j.f);
    if (!z.rows.length) continue;
    list.push({ id: doc.id, reg: String(x.reg || ''), d: x.d, od: typeof x.od === 'string' ? x.od : '', tm: typeof x.tm === 'string' ? x.tm : '', no: String(x.no || '').slice(0, 30), by: String(x.by || '').slice(0, 100), amt: z.amt, rows: z.rows });
  }
  list.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.tm < b.tm ? -1 : 1)));
  return { on: true, list, more: s.size > ZC_MAX }; // יותר מ-2,000 סגירות בבקשה – לא חותכים בשקט
}

// ---------- הקופה החדשה (POS): possale לפי רגע המכירה (soldAt), posret לפי זמן הרישום (at) – יום לפי שעון ישראל ----------
async function posDays(db, from, to) {
  const a = dayStart(from), b = dayStart(addDay(to, 1));
  const [s, r] = await Promise.all([
    db.collection('possale').where('soldAt', '>=', a).where('soldAt', '<', b).select('soldAt', 'gross', 'debt', 'st', 'docs').limit(POS_MAX).get(),
    db.collection('posret').where('at', '>=', a).where('at', '<', b).select('at', 'amt', 'gross', 'st', 'docs').limit(POS_MAX).get()]);
  const days = {}, docs = new Set();
  // מסמכי הקופה (ardoc) – ar-inc.js באפליקציה הופך אותם גם לתנועות הכנסה (ar_<id>); האפליקציה מוציאה אותן מ"אחר" כדי לא לספור פעמיים
  const docOf = (x) => { for (const o of Array.isArray(x.docs) ? x.docs : []) if (o && typeof o.id === 'string' && o.id.length <= 80) docs.add(o.id); };
  const day = (d) => days[d] || (days[d] = { s: 0, n: 0, r: 0, rn: 0, debt: 0 });
  for (const doc of s.docs) {
    const x = doc.data();
    docOf(x);
    if (x.st === 'void' || !Number.isFinite(x.soldAt)) continue;
    const o = day(ymd(x.soldAt)); o.s += ag(x.gross); o.n++; o.debt += ag(x.debt);
  }
  for (const doc of r.docs) {
    const x = doc.data();
    docOf(x);
    if (x.st === 'void' || !Number.isFinite(x.at)) continue;
    const o = day(ymd(x.at)); o.r += Number.isInteger(x.amt) ? x.amt : ag(x.gross); o.rn++;
  }
  for (const o of Object.values(days)) { o.s /= 100; o.r /= 100; o.debt /= 100; }
  return { on: true, days, docs: [...docs], more: s.size >= POS_MAX || r.size >= POS_MAX };
}
async function posDay(db, d) {
  const a = dayStart(d), b = dayStart(addDay(d, 1));
  const [s, r] = await Promise.all([
    db.collection('possale').where('soldAt', '>=', a).where('soldAt', '<', b).select('dev', 'seq', 'soldAt', 'gross', 'debt', 'st', 'custName', 'chk').limit(DAY_MAX).get(),
    db.collection('posret').where('at', '>=', a).where('at', '<', b).select('dev', 'at', 'amt', 'gross', 'st', 'sale').limit(DAY_MAX).get()]);
  const sales = s.docs.map((doc) => { const x = doc.data(); return Object.assign({ id: doc.id, dev: String(x.dev || ''), seq: Number.isInteger(x.seq) ? x.seq : null, hm: hm(x.soldAt), t: x.soldAt || 0, gross: ag(x.gross) / 100, debt: ag(x.debt) / 100, st: x.st === 'void' ? 'void' : 'ok' },
    typeof x.custName === 'string' && x.custName ? { cust: x.custName.slice(0, 80) } : {}, x.chk ? { chk: true } : {}); });
  const rets = r.docs.map((doc) => { const x = doc.data(); return Object.assign({ id: doc.id, dev: String(x.dev || ''), hm: hm(x.at), t: x.at || 0, amt: (Number.isInteger(x.amt) ? x.amt : ag(x.gross)) / 100, st: x.st === 'void' ? 'void' : 'ok' },
    typeof x.sale === 'string' ? { sale: x.sale } : {}); });
  sales.sort((x, y) => x.t - y.t); rets.sort((x, y) => x.t - y.t);
  for (const x of sales.concat(rets)) delete x.t;
  return { sales, rets, more: s.size >= DAY_MAX || r.size >= DAY_MAX };
}

// ---------- כספית – להשוואה בלבד (cxDay סופי; cxDayP – תמונת מצב חלקית של יום שעוד אין לו סיכום סופי) ----------
async function cxDays(db, from, to) {
  const [ds, pp, cs] = await Promise.all([db.collection('cxDay').where('d', '>=', from).where('d', '<=', to).select('d', 'bk', 'bn', 'gross', 'ret', 'disc', 'ntx', 'sp').get(),
    db.collection('cxDayP').where('d', '>=', from).where('d', '<=', to).select('d', 'bk', 'bn', 'gross', 'ret', 'disc', 'ntx', 'sp', 'pt').get(), db.doc('cxcfg/main').get()]);
  const one = (x) => ({ d: x.d, bk: String(x.bk || ''), bn: String(x.bn || ''), gross: r2(x.gross), ret: r2(x.ret), disc: r2(x.disc), ntx: Number.isInteger(x.ntx) ? x.ntx : 0, sp: r2(x.sp) });
  const days = ds.docs.map((d) => one(d.data()));
  const have = new Set(days.map((x) => x.d));
  for (const d of pp.docs) { const x = d.data(); if (have.has(x.d)) continue; days.push(Object.assign(one(x), { pt: { hm: String((x.pt && x.pt.hm) || '') } })); }
  const c = cs.exists ? cs.data() : {};
  return { on: true, days, reg: c.reg && typeof c.reg === 'object' && !Array.isArray(c.reg) ? c.reg : {} };
}

async function gate(request) {
  const w = await requireStaff(request);
  if (w.role === 'manager') return w;
  if (w.staff && typeof w.staff.get === 'function' && w.staff.get('incA') === true) return w;
  throw deny('no-perm', 'אין לך הרשאה למסך "כל ההכנסות". פנה למנהל.');
}

async function get(w, input) {
  onlyKeys(input, ['op', 'from', 'to']);
  const [from, to] = rangeOf(input);
  const db = T.tdb();
  const [zc, pos, cx] = await Promise.all([
    on(w.biz, 'cashClose') ? closings(db, from, to) : { on: false, list: [] },
    on(w.biz, 'pos') ? posDays(db, from, to) : { on: false, days: {} },
    on(w.biz, 'cxSales') ? cxDays(db, from, to) : { on: false, days: [], reg: {} }]);
  return { from, to, zc, pos, cx };
}
async function day(w, input) {
  onlyKeys(input, ['op', 'd']);
  if (typeof input.d !== 'string' || !DATE_RE.test(input.d) || addDay(input.d, 0) !== input.d) throw bad('bad-day', 'תאריך לא תקין');
  T.requireFeature(w.biz, 'pos');
  return posDay(T.tdb(), input.d);
}
// כמו cxSee (caspit.js): רק השרת כותב את הסימון; לא נוגע ב-perms
async function see(w, input) {
  if (w.role !== 'manager') throw deny('manager-only', 'הפעולה מותרת למנהל בלבד');
  onlyKeys(input, ['op', 'uid', 'on']);
  const uid = typeof input.uid === 'string' ? input.uid : '';
  if (!UID_RE.test(uid)) throw bad('bad-uid', 'מזהה משתמש לא תקין');
  if (typeof input.on !== 'boolean') throw bad('bad-on', 'ערך לא תקין');
  const db = T.tdb();
  const sRef = db.doc('staff/' + uid), aRef = db.doc('admins/' + uid);
  await db.runTransaction(async (tx) => {
    const [s, a] = await Promise.all([tx.get(sRef), tx.get(aRef)]);
    if (!s.exists) throw new HttpsError('not-found', 'העובד לא נמצא בעסק', { reason: 'no-staff' });
    if (a.exists || s.get('role') === 'manager') throw pre('is-admin', 'מנהל רואה את המסך תמיד');
    tx.update(sRef, { incA: input.on });
  });
  if (w.biz && w.biz.exists && w.bizId) await require('firebase-admin/firestore').getFirestore().collection(`b/${w.bizId}/audit`).add({ by: w.uid, t: Date.now(), act: 'incSee', note: uid + '=' + input.on }).catch(() => {});
  return { ok: true, uid, on: input.on };
}
const OPS = { get, day, see };

exports.incAll = onCall(T.scoped(async (request) => {
  try {
    const w = await gate(request);
    const input = inputObject(request);
    const op = input.op;
    if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(OPS, op)) throw bad('bad-op', 'פעולה לא מוכרת');
    return await OPS[op](w, input);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('incAll failed', { reason: 'internal', name: e && e.name, code: e && e.code, msg: String(e && e.message).slice(0, 200) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
}));
Object.defineProperty(exports, '_core', { enumerable: false, value: { zcRows, num, r2, dayStart, ymd, rangeOf } });
