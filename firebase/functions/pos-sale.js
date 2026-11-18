'use strict';
// קופה (POS), גל 2 – ש2: שרת המכירה (17.11.2026). מחליף את שלד posSale של שלב 0 (pos.js) – index.js טוען את הקובץ הזה אחרי pos.js,
// בבלוק POS:M2, ולכן posSale כאן גובר. כל כתיבה לאוספי הקופה – רק מכאן (בכללים: write: if false). אפיון: 06-אפיון/ב-מכירה-ותשלום.md.
//
// כללי כסף (כולם נבדקים בשרת, בתוך הטרנזקציה):
//   • כל הסכומים באגורות, מספרים שלמים. החישוב – pos-calc.js + pos-promo.js, אותו קוד בדיוק במכשיר.
//   • כלל הסגירה (ב ת7): paid + debt = gross, כאשר paid = Σpospay.amt − chg. מכירה שלא מקיימת – נדחית, ולא מקבלת מספר ולא מסמך.
//   • עודף (chg) רק במזומן: chg ≤ Σמזומן. כל אמצעי אחר ≤ היתרה ברגע הרישום (לפי סדר התשלומים). הקפה = possale.debt בלבד, אף פעם לא pospay.
//   • reqId לכל פעולה (posreq/{dev}_{reqId}): אותה בקשה פעמיים = אותה תוצאה. מספור לכל קופה (posdev.lastSeq / lastRet), בלי חור ובלי כפילות.
//   • מסמך לא נמחק – רק מסמך נגדי (pos-doc.js). החזרה: תקרה מצטברת לשורה (כמות + סכום) ולכל אמצעי, וקיזוז חוב הקפה לפני החזר כסף (ב ה15).
//   • אין נתוני כרטיס: רק last4 (4 ספרות), appr, brand, inst, tx, src, term, termNo, ref, reqId. כל רצף של 13–19 ספרות שעובר Luhn – נדחה.
//
// פונקציות (onCall):
//   posSale({ reqId, dev, inst, soldAt, lines, pays, chg?, debt?, cust?, manDisc?, cpns?, promoOff?, note?, docAs?, alloc?, cashOk?, seq?, gross?, off?, rs?, aps? })
//     lines: [{ pid?, n, bc?, cat?, qty, unit, mdisc?{amt|pct, why?}, noPromo?, stk?, free? }] – unit באגורות (מחיר מחירון; הנחת מבצע מחושבת בשרת).
//     pays: [{ m, amt, ref?, reqId?, + card: last4, appr, brand?, inst?, tx?, src?, term?, termNo? · check: chk{no,bank}, due?, post? · gift/voucher: code }]
//     → { id, seq, gross, paid, chg, debt, docs:[{t,id,no}], warn[], dup? }
//   posReturn({ op:'quote'|'do', reqId, dev, inst, sale?, items?[{i,qty}], noRcpt?[{pid,qty}], why, cond?, tag, dmg?, refunds?[{m,amt}], debtTo?, aps? })
//   aps (POS:W2) – מזהי אישור של ש5 (posAuth op:'approve'): 'disc' במכירה, 'ret' בהחזרה. נבדקים בשרת ומסומנים used (ראו apsCheck).
//     → quote: { amt, debtOff, debtCash, money, alloc, max } · do: { id, amt, debtOff, refunds, vouchers, docs, dup? }
//   posPark({ op:'save'|'done'|'list'|'flag', ... })      – עגלות מושהות (pospark). flag = בסגירת יום: פתוחות ← 'flag'.
//   posDebtPay({ reqId, dev, inst, cust, amt, pays, chg? }) – תשלום חוב הקפה: קבלה (rc) שנסגרת מול החשבוניות הפתוחות.
//   posCouponUse({ op:'issue'|'check'|'void', ... })      – קופון אישי (poscpn). המימוש עצמו – בתוך posSale (טרנזקציה אחת עם המכירה).
//   posGift({ op:'get'|'issue'|'restore'|'sell', ... })  – כרטיס מתנה (gift) / פתק זיכוי (voucher) – posgift + posgiftlog. אין המרה למזומן.
//   posPromo({ op:'set'|'on'|'dup', ... })               – ניהול מבצעים (מנהל), לאזור הניהול (pos-admin-sale.js).
// ההגדרות – cfgOf: ש4 (lib/pos-cfg-schema.js, PosCfg) כשקיים; עד אז ברירות המחדל של האפיון הסופי פרק 2 (CFG0) + מה שנשמר לעסק.

const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const PC = require('./lib/pos-calc');
const PP = require('./lib/pos-promo');
const CF = require('./lib/pos-cfg');
const K = require('./lib/pos-core');
const ARD = require('./lib/ar-doc');
const D = require('./pos-doc')._core;

// ---------- הגדרות (מדומה עד ש4) ----------
// השמות והערכים – האפיון הסופי, פרק 2 (ערך לעסק הנוכחי).
const CFG0 = Object.freeze({
  payOn: ['cash', 'card', 'check', 'transfer', 'bit', 'paybox', 'gift', 'extGift', 'voucher'], partialPay: 'debt',
  refReq: ['transfer', 'bit', 'paybox'], checkPostdated: true, creditOverLimit: 'block', cashMax: 600000, cashMaxMode: 'warn', cashRound: 0,
  instMax: 3, instMinAmt: 30000, txTypes: ['reg', 'inst', 'defer'], cardMin: 0, dupWinMin: 10, termMode: 'manual', payLinkOn: true,
  docDef: 'ir', docBiz: 'inv+rc', docSeries: 'dev', docShowSaleId: false, allocMin: 500000, allocMode: 'manual', giftDocMode: 'advance',
  retDays: 14, retNoRcpt: 'lead', retNoRcptPrice: 'cur', retNoRcptDef: 'voucher', retMgrAbove: 20000, retDefective: 'exchange', retNeedTag: true,
  retRefundPolicy: { card: ['card'], gift: ['gift'], '*': ['cash', 'voucher', 'same'] }, creditExpDays: 730,
  discMax: { cashier: 0, lead: 10 }, discRoles: 'lead', promoStack: 'best', promoCancelRole: 'lead', cpnStack: true, cpnOnPromo: false, parkMax: 0,
});
let SCH = null;
try { SCH = require('./lib/pos-cfg-schema'); } catch (e) { SCH = null; } // ש4 – כשימוזג
const sameT = (a, b) => (Array.isArray(a) ? Array.isArray(b) : typeof a === typeof b && !Array.isArray(b) && (a === null) === (b === null));
async function cfgOf(db) {
  const s = await db.doc('poscfg/main').get();
  const doc = s.exists ? s.data() : null;
  // POS:W2 (איחוד גל 2): הסכמה של ש4 – ערכי העסק ב-poscfg/main ומתגי המודולים ב-poscfg/sa (כמו posCfg ב-pos-cfg.js), כולל vatRate
  if (SCH && typeof SCH.eff === 'function') return Object.assign({}, CFG0, await require('./lib/pos-cfg-read').cfgOf(db));
  const out = Object.assign({}, CFG0);
  const e = CF.eff(doc);
  for (const k of Object.keys(e.cfg)) if (e.src[k] === 'biz' || !(k in CFG0)) out[k] = e.cfg[k];
  const v = doc && doc.v && typeof doc.v === 'object' ? doc.v : {};
  for (const [k, x] of Object.entries(v)) if (!(k in CF.DEFS) && k in CFG0 && sameT(CFG0[k], x)) out[k] = x;
  return out;
}

// ---------- תשתית (כמו pos.js של שלב 0) ----------
const TX = { maxAttempts: 4 };
const TX_OUTER = 40;
const Q = new Map();
const QON = { on: true };
function serial(key, fn) {
  if (!QON.on) return fn();
  const prev = Q.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  Q.set(key, tail);
  tail.then(() => { if (Q.get(key) === tail) Q.delete(key); });
  return run;
}
const retriable = (e) => !(e instanceof HttpsError) && !(e && e.reason) && (e && (e.code === 10 || /maximum number of retries|ABORTED|contention/i.test(String(e.message || ''))));
async function runTx(db, fn) {
  for (let i = 0; ; i++) {
    try { return await db.runTransaction(fn, TX); } catch (e) {
      if (i >= TX_OUTER - 1 || !retriable(e)) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * Math.min(400, 40 * (i + 1)))));
    }
  }
}
const deny = (reason, msg, x) => new HttpsError('permission-denied', msg, Object.assign({ reason }, x));
const pre = (reason, msg, x) => new HttpsError('failed-precondition', msg, Object.assign({ reason }, x));
const bad = (reason, msg, x) => new HttpsError('invalid-argument', msg, Object.assign({ reason }, x));
const nf = (reason, msg) => new HttpsError('not-found', msg, { reason });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isAg = (v) => Number.isInteger(v);
const pad = (n) => String(n).padStart(6, '0');
const CTRL = /[\u0000-\u001f]/;
const SALE_RE = /^K[1-9][0-9]{0,3}-[0-9]{6}$/;
const CODE_RE = /^[0-9]{12}$/;
const CPN_RE = /^[A-Za-z0-9_-]{3,40}$/;
const DAY = 86400000;

// 18.11.2026: גם מנהל רק עם pos / posMgr (מנהל־על מדליק; hasPerm). מנהל עם posMgr = 'mgr', מנהל עם pos בלבד = 'cashier'. פעולות ניהול (o.mgr) – כל מנהל, כמו היום.
const roleOf = (who) => (hasPerm(who, 'posMgr') ? (who.role === 'manager' ? 'mgr' : 'lead') : 'cashier');
const RANK = { cashier: 0, lead: 1, mgr: 2 };
const atLeast = (who, r) => RANK[roleOf(who)] >= RANK[r];
async function gate(request, o) {
  const who = await requireStaff(request);
  if (!who.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש');
  if (!who.superadmin) T.requireFeature(who.biz, 'pos');
  if (o && o.mgr && who.role !== 'manager') throw deny('not-manager', 'הפעולה זמינה למנהל בלבד');
  if (!(o && o.mgr) && !(hasPerm(who, 'pos') || hasPerm(who, 'posMgr'))) throw deny('not-pos', 'אין לך הרשאת קופה');
  return { who, db: T.tdb() };
}
const keysOk = (o, ks) => { for (const k of Object.keys(o)) if (!ks.includes(k)) throw bad('bad-input', 'קלט לא תקין: ' + String(k).slice(0, 20)); };
// מכשיר: קיים, פעיל, רשום על ההתקנה הזו
function devOk(s, inst, cfg) {
  if (!s.exists) throw nf('no-dev', 'הקופה לא נמצאה');
  const d = s.data();
  if (d.st === 'retired') throw pre('retired', 'הקופה הוצאה משימוש');
  if (d.on !== true) throw pre('dev-off', 'הקופה מושבתת');
  if (!d.inst || d.inst !== inst) throw pre('dev-taken', 'המכשיר לא רשום על הקופה הזו');
  // POS:W2 (איחוד, ש7): devApprove דלוק – מכשיר שנרשם ועוד לא אושר ע"י מנהל (posdev.appr, posOps op:'approve') לא מוכר
  if (cfg && cfg.devApprove !== false && !d.appr) throw pre('dev-unapproved', 'המכשיר מחכה לאישור מנהל');
  return d;
}
function idsIn(input) {
  if (K.isPractice(input.reqId) || K.isPractice(input.dev)) throw bad('practice', 'פעולת תרגול לא נשלחת לשרת');
  if (!K.isReq(input.reqId)) throw bad('bad-req', 'מזהה בקשה לא תקין');
  if (!K.isDev(input.dev)) throw bad('bad-dev', 'קוד קופה לא תקין');
  if (!K.isInst(input.inst)) throw bad('bad-inst', 'מזהה מכשיר לא תקין');
}
const log = (tx, db, o) => tx.set(db.collection('poslog').doc(), Object.assign({ at: Date.now() }, o));

// ---------- אין נתוני כרטיס (ב 5 קריטריון 7) ----------
function luhn(d) {
  let s = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; }
  return s % 10 === 0;
}
// רצף ספרות (עם רווח או מקף בודד ביניהן) של 13–19 ספרות שעובר Luhn (הרצף כולו). רצף ארוך מ-19 – כל חלון של 13–19
function cardIn(s) {
  if (typeof s !== 'string') return false;
  const runs = s.match(/\d(?:[ -]?\d)*/g) || [];
  for (const r of runs) {
    const d = r.replace(/[ -]/g, '');
    if (d.length < 13) continue;
    if (d.length <= 19) { if (luhn(d)) return true; continue; }
    for (let L = 13; L <= Math.min(19, d.length); L++) for (let i = 0; i + L <= d.length; i++) if (luhn(d.slice(i, i + L))) return true;
  }
  return false;
}
// סריקה עמוקה של כל המחרוזות (ערכים ומפתחות)
function hasCard(v, depth) {
  if ((depth || 0) > 8) return false;
  if (typeof v === 'string') return cardIn(v);
  if (Array.isArray(v)) return v.some((x) => hasCard(x, (depth || 0) + 1));
  if (isObj(v)) return Object.entries(v).some(([k, x]) => cardIn(k) || hasCard(x, (depth || 0) + 1));
  return false;
}
const noCard = (input) => { if (hasCard(input)) throw bad('card-data', 'אסור לשלוח מספר כרטיס אשראי. מקלידים רק 4 ספרות אחרונות ומספר אישור'); };

// ---------- תשלומים (ב ת1–ת8, פרק 4) ----------
const PAYM = ['cash', 'card', 'check', 'transfer', 'bit', 'paybox', 'gift', 'voucher', 'extGift', 'link'];
const PF = { cash: [], card: ['last4', 'appr', 'brand', 'inst', 'tx', 'src', 'term', 'termNo'], check: ['chk', 'due', 'post'], gift: ['code'], voucher: ['code'] };
const PF0 = ['m', 'amt', 'ref', 'reqId'];
const PAY_MAX = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// pays → [{ m, amt, ... }] מנורמל. gross = הסכום לסגירה. today = 'YYYY-MM-DD' (ישראל). זורק HttpsError
function paysIn(pays, gross, cfg, today) {
  if (pays == null) pays = [];
  if (!Array.isArray(pays) || pays.length > PAY_MAX) throw bad('bad-pay', 'תשלומים לא תקינים');
  const on = (Array.isArray(cfg.payOn) ? cfg.payOn : []).filter((m) => PAYM.includes(m));
  const refReq = Array.isArray(cfg.refReq) ? cfg.refReq : [];
  let run = 0;
  return pays.map((p, i) => {
    if (!isObj(p)) throw bad('bad-pay', 'תשלום לא תקין');
    if (!PAYM.includes(p.m)) throw bad('bad-pay-m', 'אמצעי תשלום לא מוכר'); // כולל 'credit' (הקפה = debt) ו-'phone'
    if (!on.includes(p.m) || (p.m === 'link' && cfg.payLinkOn !== true)) throw pre('pay-off', 'אמצעי התשלום לא פעיל בעסק');
    for (const k of Object.keys(p)) if (!PF0.includes(k) && !(PF[p.m] || []).includes(k)) throw bad('bad-pay-field', 'שדה לא מותר בתשלום: ' + String(k).slice(0, 20));
    if (!isAg(p.amt) || p.amt <= 0 || p.amt > 100000000) throw bad('bad-amt', 'סכום תשלום לא תקין');
    // כל אמצעי שאינו מזומן – לא יותר מהיתרה ברגע הרישום. מזומן – עודף מותר, אבל לא כשאין יתרה בכלל
    const left = gross - run;
    if (p.m !== 'cash' && p.amt > left) throw pre('over-balance', 'הסכום גבוה מהיתרה', { i, left });
    if (p.m === 'cash' && left <= 0) throw pre('over-balance', 'הסכום גבוה מהיתרה', { i, left });
    run += p.amt;
    const o = { m: p.m, amt: p.amt, i };
    if (p.ref != null) { const r = str(p.ref, 40); if (!r || CTRL.test(p.ref)) throw bad('bad-ref', 'אסמכתא לא תקינה'); o.ref = r; }
    if ((refReq.includes(p.m) || p.m === 'extGift') && !o.ref) throw pre('need-ref', 'חובה להקליד אסמכתא', { i });
    if (p.reqId != null) { if (!K.isReq(p.reqId)) throw bad('bad-req', 'מזהה בקשה לא תקין'); o.reqId = p.reqId; }
    if (p.m === 'check') {
      if (!isObj(p.chk) || Object.keys(p.chk).some((k) => !['no', 'bank'].includes(k))) throw pre('need-chk', 'פרטי הצ\'ק חסרים');
      const no = str(String(p.chk.no == null ? '' : p.chk.no), 20), bank = str(String(p.chk.bank == null ? '' : p.chk.bank), 40);
      if (!no || !bank) throw pre('need-chk', 'פרטי הצ\'ק חסרים');
      o.chk = { no, bank };
      if (p.due != null && (typeof p.due !== 'string' || !DATE_RE.test(p.due))) throw bad('bad-due', 'תאריך פירעון לא תקין');
      if (p.post === true && !p.due) throw pre('need-due', 'צ\'ק דחוי – חובה תאריך פירעון', { i });
      if (p.due) { if (p.due > today && cfg.checkPostdated !== true) throw pre('no-postdated', 'צ\'ק דחוי לא מתקבל בעסק'); o.due = p.due; }
    }
    if (p.m === 'card') {
      const src = p.src == null ? 'manual' : p.src;
      if (!['manual', 'term'].includes(src)) throw bad('bad-pay', 'מקור חיוב לא תקין');
      o.src = src;
      if (p.last4 != null || src === 'manual') { if (typeof p.last4 !== 'string' || !/^[0-9]{4}$/.test(p.last4)) throw pre('need-last4', 'חובה 4 ספרות אחרונות בדיוק'); o.last4 = p.last4; }
      if (p.appr != null || src === 'manual') { const a = str(p.appr, 20); if (!a || !/^[A-Za-z0-9-]+$/.test(a)) throw pre('need-appr', 'חובה מספר אישור'); o.appr = a; }
      if (p.brand != null) { const b = str(p.brand, 20); if (b) o.brand = b; }
      if (p.term != null) { const t = str(p.term, 40); if (t) o.term = t; }
      if (p.termNo != null) { const t = str(p.termNo, 20); if (t) o.termNo = t; }
      let tx = p.tx == null ? (p.inst != null && p.inst > 1 ? 'inst' : 'reg') : p.tx;
      const types = Array.isArray(cfg.txTypes) ? cfg.txTypes : ['reg'];
      if (!types.includes(tx)) throw pre('bad-tx', 'סוג עסקה לא מותר');
      o.tx = tx;
      if (tx === 'inst') {
        if (!Number.isInteger(p.inst) || p.inst < 2 || p.inst > (cfg.instMax || 1)) throw pre('bad-inst', 'מספר תשלומים לא מותר');
        if (Number.isInteger(cfg.instMinAmt) && p.amt < cfg.instMinAmt) throw pre('bad-inst', 'הסכום נמוך מהמינימום לתשלומים');
        o.inst = p.inst;
      } else if (p.inst != null && p.inst !== 1) throw pre('bad-inst', 'מספר תשלומים לא מותר');
      if (Number.isInteger(cfg.cardMin) && cfg.cardMin > 0 && p.amt < cfg.cardMin) throw pre('card-min', 'הסכום נמוך מהמינימום לאשראי');
    }
    if (p.m === 'gift' || p.m === 'voucher') { if (typeof p.code !== 'string' || !CODE_RE.test(p.code)) throw bad('bad-code', 'קוד כרטיס לא תקין'); o.code = p.code; }
    return o;
  });
}
// כלל הסגירה. → { sum, cash, paid }
function closeOk(gross, list, chg, debt) {
  if (!isAg(chg) || chg < 0) throw bad('bad-chg', 'עודף לא תקין');
  if (!isAg(debt) || debt < 0) throw bad('bad-debt', 'סכום הקפה לא תקין');
  const sum = list.reduce((s, p) => s + p.amt, 0);
  const cash = list.filter((p) => p.m === 'cash').reduce((s, p) => s + p.amt, 0);
  if (chg > 0 && !(cash > 0)) throw pre('chg-no-cash', 'עודף ניתן רק במזומן');
  if (chg > cash) throw pre('chg-over-cash', 'העודף גדול מהמזומן ששולם');
  const paid = sum - chg;
  if (paid + debt !== gross) throw pre('not-closed', 'סכום התשלומים לא שווה לסכום המכירה', { gross, paid, debt });
  return { sum, cash, paid };
}
// סכום נטו לכל אמצעי (מזומן אחרי עודף), לפי סדר ההופעה
function byMethod(list, chg) {
  const m = {};
  for (const p of list) m[p.m] = (m[p.m] || 0) + p.amt;
  if (chg) m.cash -= chg;
  for (const k of Object.keys(m)) if (!(m[k] > 0)) delete m[k];
  return m;
}

// ---------- שורות ----------
const LINES_MAX = 300;
function linesIn(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > LINES_MAX) throw bad('bad-line', 'שורות המכירה לא תקינות');
  return lines.map((l) => {
    if (!isObj(l)) throw bad('bad-line', 'שורה לא תקינה');
    keysOk(l, ['pid', 'n', 'bc', 'cat', 'qty', 'unit', 'mdisc', 'noPromo', 'stk', 'free']);
    const o = { n: str(l.n, 120), qty: l.qty, unit: l.unit };
    if (!o.n) throw bad('bad-line', 'שם מוצר חסר');
    if (l.pid != null) { o.pid = str(l.pid, 80); if (!/^[A-Za-z0-9_-]{1,80}$/.test(o.pid)) throw bad('bad-line', 'מוצר לא תקין'); }
    if (l.bc != null) o.bc = str(l.bc, 40);
    if (l.cat != null) o.cat = str(l.cat, 80);
    if (l.noPromo === true || l.free === true || !o.pid) o.noPromo = true;
    if (l.free === true) o.free = true;
    if (l.stk != null && typeof l.stk === 'number' && Number.isFinite(l.stk)) o.stk = l.stk;
    if (l.mdisc != null) {
      if (!isObj(l.mdisc)) throw bad('bad-disc', 'הנחה לא תקינה');
      keysOk(l.mdisc, ['amt', 'pct', 'why', 'ap']);
      if ((l.mdisc.amt == null) === (l.mdisc.pct == null)) throw bad('bad-disc', 'הנחה בסכום או באחוז');
      o.mdisc = { why: str(l.mdisc.why, 80) };
      if (l.mdisc.ap != null) o.mdisc.ap = apsIn([l.mdisc.ap])[0]; // POS:W2
      if (l.mdisc.amt != null) { if (!isAg(l.mdisc.amt) || l.mdisc.amt < 0) throw bad('bad-disc', 'הנחה לא תקינה'); o.mdisc.amt = l.mdisc.amt; }
      else { if (typeof l.mdisc.pct !== 'number' || !(l.mdisc.pct >= 0 && l.mdisc.pct <= 100)) throw bad('bad-disc', 'הנחה לא תקינה'); o.mdisc.pct = l.mdisc.pct; }
    }
    return o;
  });
}
async function promosOf(db) {
  const q = await db.collection('promo').limit(500).get();
  return q.docs.map((d) => Object.assign({}, d.data(), { id: d.id }));
}
const expired = (exp, now) => (typeof exp === 'number' ? exp < now : typeof exp === 'string' && DATE_RE.test(exp) ? exp < PP.dayOf(now) : false);
const limAg = (c) => (c && typeof c.lim === 'number' && Number.isFinite(c.lim) && c.lim >= 0 ? Math.round(c.lim * 100) : 0);
const balOf = (c) => ARD.arOf(c).bal;

// חישוב מכירה מלא (בלי Firestore): שורות + מבצעים + קופונים + הנחה ידנית → סכומים, וסמכות ההנחה
// prods: { pid: prod } ; cp: [{ code, promo }] ; ctx = { at, club, grp, promoOff }
function compute(lines, input, cfg, promos, prods, cp, ctx) {
  const pl = lines.map((l) => ({ pid: l.pid, cat: (l.pid && prods[l.pid] && prods[l.pid].cat) || l.cat, qty: l.qty, unit: l.unit, noPromo: l.noPromo }));
  const pr = PP.apply(pl, promos, { at: ctx.at, club: ctx.club, grp: ctx.grp, stack: cfg.promoStack, off: ctx.promoOff, cpns: cp, cpnStack: cfg.cpnStack !== false, cpnOnPromo: cfg.cpnOnPromo === true });
  for (const c of pr.cpns) if (!c.ok) throw pre(c.why === 'no-stack' ? 'cpn-stack' : 'cpn-no-line', c.why === 'no-stack' ? 'אי אפשר לשלב קופונים בעסק הזה' : 'הקופון לא חל על אף מוצר בעגלה', { code: c.code });
  const cl = lines.map((l, i) => {
    let base;
    try { base = PC.line({ unit: l.unit, qty: l.qty }).base; } catch (e) { throw bad(e.reason || 'bad-line', e.message); }
    const pd = pr.lines[i].pdisc;
    let md = 0;
    if (l.mdisc) md = l.mdisc.amt != null ? l.mdisc.amt : PC.pctOf(base - pd, l.mdisc.pct);
    if (pd + md > base) throw bad('bad-disc', 'ההנחה גדולה מסכום השורה');
    return { unit: l.unit, qty: l.qty, disc: pd + md, md, pd, base };
  });
  const md = input.manDisc;
  let calc;
  try {
    calc = PC.sale(cl.map((x) => ({ unit: x.unit, qty: x.qty, disc: x.disc })), Object.assign({ vm: input.vm, rate: cfg.vatRate },
      md ? (md.amt != null ? { disc: md.amt } : { dpct: md.pct }) : {}));
  } catch (e) { throw bad(e.reason || 'bad-line', e.message); }
  const pg = calc.vm === 'inc' ? calc.lines.map((x) => x.fin) : PC.spread(calc.gross, calc.lines.map((x) => x.fin));
  // סמכות הנחה ידנית (ב נ7): קופאי – discMax.cashier (0 = אין); אחראי – עד discMax.lead%; מנהל – בלי תקרה, אבל מתחת למחיר מינימום – נרשם discOvr
  const manual = cl.reduce((s, x) => s + x.md, 0) + calc.sdisc;
  const afterPromo = cl.reduce((s, x) => s + x.base - x.pd, 0);
  const pct = afterPromo > 0 ? manual * 100 / afterPromo : 0;
  const below = [];
  lines.forEach((l, i) => {
    const p = l.pid && prods[l.pid];
    const minAg = p && typeof p.minP === 'number' ? PC.toAg(p.minP) : null;
    if (minAg != null && (cl[i].md > 0 || calc.lines[i].sd > 0) && pg[i] < PC.rnd(minAg * l.qty)) below.push(i);
  });
  const out = lines.map((l, i) => {
    const o = Object.assign({}, l, { pdisc: cl[i].pd, disc: calc.lines[i].disc, tot: calc.lines[i].tot, sd: calc.lines[i].sd, fin: calc.lines[i].fin, pg: pg[i] });
    if (pr.lines[i].promo) o.promo = pr.lines[i].promo;
    if (pr.lines[i].bp) o.bp = pr.lines[i].bp;
    if (pr.lines[i].cpn) o.cpn = pr.lines[i].cpn;
    if (l.mdisc) o.mdisc = { amt: cl[i].md, why: l.mdisc.why || '' };
    else delete o.mdisc;
    return o;
  });
  return { calc, cl, lines: out, manual, pct, below, applied: pr.applied };
}
// ---------- POS:W2 – אישור אחראי / מנהל (ש5: posAuth op:'approve' → poslog/{ap}, k:'appr') ----------
// כל הנחה ידנית שהקופאי לא רשאי לתת בעצמו נושאת מזהה אישור: mdisc.ap (שורה) או manDisc.ap (כל העגלה). בהחזרה – aps:[מזהה].
// השרת מאמת כל אישור: הרשומה קיימת (poslog – רק השרת כותב, ובמסד של העסק – אישור של עסק אחר לא נמצא), סוג הפעולה, ניתן לקופאי
// המחובר (for), לא נוצל (used), ובתוקף: 30 דקות מיצירתו לפי שעון השרת (הכרעת בעל העסק, 18.11), ובמכירה – נוצר לפני רגע המכירה (soldAt).
// האישור קשור למה שאושר (סבב 2): הנחה – pct ≥ ההנחה בפועל, ref = 'l:<מוצר>' / 'cart'; החזרה – ref = מספר המכירה ('noRcpt' בלי קבלה),
// amt ≥ סכום ההחזרה. התפקיד – של מי שאישר; תקרות לפי PC.discCap (אותו כלל כמו posAuth). מתחת למחיר מינימום – רק אישור מנהל שנוצר
// עם need:'manager' ומכסה את ההנחה (אז נרשם discOvr). אישור משמש פעם אחת: מסומן used בטרנזקציה של הפעולה.
// מכירה שהגיעה אחרי יותר מ-30 דקות מהאישור (הכרעת בעל העסק, 18.11 – שינוי להכרעה הקודמת שדחתה אותה):
//   • מכירה מקוונת רגילה (לא off ולא שליחה חוזרת מהתור – rs) – נדחית (ap-old), כמו קודם.
//   • מכירה שכבר נגבתה בלי רשת (off:true) או שנשלחה שוב מהתור (rs:true) – נרשמת כרגיל (מסמך ומספור רגילים), אם האישור היה תקף ברגע
//     המכירה: soldAt − at ≤ 30 דקות (וכמו תמיד: at ≤ soldAt + 2 דקות, אותו עסק, אותו קופאי, לא נוצל, ref ו-pct מכסים). האישור מסומן
//     late, המכירה apLate:true (לבדיקת מנהל – posOps op:'apChk' מסמן "נבדק"), ונכתבת תקלה חמורה (poserr, sev:'crit') שמתריעה לבעל
//     העסק ולמנהלים (posOpsWatch). מעל 72 שעות מיצירת האישור (שעון השרת) – גם apCrit:true (בדיקה דחופה).
//   סיכון ידוע (לא נפתר): soldAt, off ו-rs מגיעים מהמכשיר, ושעון המכשיר אפשר לזייף. הבקרה – הסימון וההתראה למנהל.
const AP_RE = /^[A-Za-z0-9]{10,40}$/;
const AP_WIN = 30 * 60000;
const AP_SKEW = 2 * 60000; // הפרש שעונים מותר בין המכשיר לשרת (soldAt מול זמן יצירת האישור)
const AP_ROLE = { manager: 'mgr', lead: 'lead' };
const AP_CRIT = 72 * 3600000; // אישור מאוחר מעל 72 שעות (שעון השרת) – המכירה נרשמת, ההנחה לבדיקה דחופה
function apsIn(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 5 || v.some((x) => typeof x !== 'string' || !AP_RE.test(x)) || new Set(v).size !== v.length) throw bad('bad-ap', 'אישור לא תקין');
  return v;
}
// snaps – poslog/{ap}. → { role, list:[{ id, by, role, need, pct, amt, ref, late?, crit? }] }. soldAt – רק במכירה.
// late – מכירה שנגבתה בלי רשת / נשלחה שוב מהתור: אישור שעבר 30 דקות לפי שעון השרת מתקבל אם היה תקף ברגע המכירה (soldAt − at ≤ 30 דקות)
// soft – בדיקה מקדימה מחוץ לטרנזקציה: אישור שנוצל לא נדחה כאן (שליחה חוזרת של אותו reqId מחזירה את התוצאה הראשונה – בטרנזקציה)
function apsCheck(snaps, who, act, now, o) {
  o = o || {};
  let role = null;
  const list = [];
  for (const x of snaps) {
    const v = x.exists ? x.data() : null;
    if (!v || v.k !== 'appr' || v.act !== act || v.for !== who.uid || !AP_ROLE[v.role] || typeof v.at !== 'number' || v.at > now + 60000) throw deny('ap-bad', 'האישור לא תקף');
    if (v.used === true && !o.soft) throw deny('ap-used', 'האישור כבר נוצל');
    if (o.soldAt != null && v.at > o.soldAt + AP_SKEW) throw deny('ap-bad', 'האישור ניתן אחרי המכירה');
    let late = false;
    if (now - v.at > AP_WIN) {
      if (!(o.late && o.soldAt != null && o.soldAt - v.at <= AP_WIN)) throw deny('ap-old', 'פג תוקף האישור (30 דקות) – בקשו אישור חדש');
      late = true;
    }
    const r = AP_ROLE[v.role];
    if (!role || RANK[r] > RANK[role]) role = r;
    list.push(Object.assign({ id: x.id, by: String(v.by || '').slice(0, 128), role: r, need: v.need || null, pct: typeof v.pct === 'number' ? v.pct : null, amt: Number.isInteger(v.amt) ? v.amt : null, ref: typeof v.ref === 'string' ? v.ref : null },
      late ? { late: true } : {}, late && now - v.at > AP_CRIT ? { crit: true } : {}));
  }
  return { role, list };
}
const apUse = (tx, db, list, o) => { for (const a of list) tx.update(db.doc('poslog/' + a.id), Object.assign({ used: true, usedAt: Date.now() }, o)); };
const apPub = (a) => Object.assign({ id: a.id, by: a.by, role: a.role }, a.late ? { apLate: true } : {}, a.crit ? { apCrit: true } : {});
// סמכות הנחה ידנית (ב נ7), לכל הנחה בנפרד ולכל המכירה. → { ovr, used:[אישור] }
// לכל הנחה: מה שהקופאי רשאי בעצמו (PC.discCap) – עובר; אחרת חייב אישור שמכסה אותה (ref, pct, תפקיד, מינימום).
function discCheck(who, cfg, co, lines, input, apl) {
  // סבב 3: הכלל עצמו – PC.discAudit, משותף לקופה (שבודקת אותו לפני הגבייה) ולשרת
  const am = new Map(apl.map((a) => [a.id, a]));
  const apOf = (id) => (id ? am.get(id) || null : null);
  const r = PC.discAudit(roleOf(who),
    co.cl.map((c, i) => ({ base: c.base, pd: c.pd, md: c.md, below: co.below.includes(i), ref: 'l:' + (lines[i].pid || 'gen'), ap: apOf(lines[i].mdisc && lines[i].mdisc.ap) })),
    { sd: co.calc.sdisc, below: co.below.some((i) => co.calc.lines[i].sd > 0), ap: apOf(input.manDisc && input.manDisc.ap) }, cfg);
  if (!r.ok) throw deny(r.code, r.msg, r.det);
  return { ovr: r.ovr, used: r.used };
}

// ---------- posSale ----------
const SALE_KEYS = ['reqId', 'dev', 'inst', 'lines', 'pays', 'chg', 'debt', 'cust', 'manDisc', 'cpns', 'promoOff', 'note', 'docAs', 'alloc', 'cashOk', 'vm', 'soldAt', 'seq', 'gross', 'off', 'rs'];
async function saleIn(request) {
  const input = inputObject(request);
  if (K.isPractice(input.reqId) || K.isPractice(input.dev)) throw bad('practice', 'מכירת תרגול לא נשלחת לשרת');
  const { who, db } = await gate(request);
  keysOk(input, SALE_KEYS);
  idsIn(input);
  noCard(input);
  const now = Date.now();
  if (!K.soldAtOk(input.soldAt, now)) throw bad('bad-time', 'שעון המכשיר לא תקין');
  if (input.seq != null && K.seqCheck(0, input.seq) === 'bad') throw bad('bad-seq', 'מספר מכירה לא תקין');
  if (input.gross != null && !isAg(input.gross)) throw bad('bad-input', 'סכום לא תקין');
  if (input.rs != null && typeof input.rs !== 'boolean') throw bad('bad-input', 'קלט לא תקין');
  const lines = linesIn(input.lines);
  if (input.manDisc != null) {
    if (!isObj(input.manDisc)) throw bad('bad-disc', 'הנחה לא תקינה');
    keysOk(input.manDisc, ['amt', 'pct', 'why', 'ap']);
    if ((input.manDisc.amt == null) === (input.manDisc.pct == null)) throw bad('bad-disc', 'הנחה בסכום או באחוז');
    if (input.manDisc.ap != null) apsIn([input.manDisc.ap]);
  }
  const cust = input.cust == null || input.cust === '' ? '' : str(input.cust, 80);
  if (cust && !/^[A-Za-z0-9_-]{1,80}$/.test(cust)) throw bad('bad-cust', 'לקוח לא תקין');
  const cpnCodes = input.cpns == null ? [] : input.cpns;
  if (!Array.isArray(cpnCodes) || cpnCodes.length > 10 || cpnCodes.some((c) => typeof c !== 'string' || !CPN_RE.test(c)) || new Set(cpnCodes).size !== cpnCodes.length) throw bad('bad-cpn', 'קוד קופון לא תקין');
  const promoOff = input.promoOff == null ? [] : input.promoOff;
  if (!Array.isArray(promoOff) || promoOff.length > 50 || promoOff.some((x) => typeof x !== 'string' || !x || x.length > 80)) throw bad('bad-input', 'קלט לא תקין');
  const note = input.note == null ? '' : str(input.note, 300);
  const apIds = apsIn([...new Set(lines.map((l) => l.mdisc && l.mdisc.ap).concat(input.manDisc && input.manDisc.ap).filter(Boolean))]);
  const chg = input.chg == null ? 0 : input.chg, debt = input.debt == null ? 0 : input.debt;
  const cfg = await cfgOf(db);
  if (promoOff.length && cfg.promoCancelRole === 'lead' && !atLeast(who, 'lead')) throw deny('promo-off-lead', 'ביטול מבצע – באישור אחראי');
  const promos = await promosOf(db);
  const today = PP.dayOf(now);
  // מבנה התשלומים נבדק לפני הטרנזקציה (בלי סכום); הסדר והיתרה – אחרי החישוב
  paysIn(input.pays, Number.MAX_SAFE_INTEGER, cfg, today);
  const mark = db.doc('posreq/' + input.dev + '_' + input.reqId), dref = db.doc('posdev/' + input.dev);
  const pids = [...new Set(lines.filter((l) => l.pid).map((l) => l.pid))];
  let res, rejectLog = null;
  await serial(who.bizId + '/' + input.dev, () => runTx(db, async (tx) => {
    rejectLog = null;
    const refs = [mark, dref].concat(pids.map((p) => db.doc('prod/' + p)), cpnCodes.map((c) => db.doc('poscpn/' + c)));
    const gcodes = [...new Set((input.pays || []).filter((p) => p && (p.m === 'gift' || p.m === 'voucher') && typeof p.code === 'string').map((p) => p.code))];
    const gr = gcodes.map((c) => db.doc('posgift/' + c));
    const snaps = await tx.getAll(...refs.concat(gr, apIds.map((a) => db.doc('poslog/' + a))));
    const [m, s] = snaps;
    if (m.exists) { res = Object.assign({ ok: true, dup: true }, m.get('res') || { id: m.get('sale'), seq: m.get('seq'), gross: m.get('gross') }); return; }
    // POS:W2: אישור הנחה (ש5) – אחרי בדיקת הכפילות (שליחה חוזרת של מכירה שכבר נרשמה מחזירה אותה, גם כשהאישור כבר נוצל)
    // אישור שפג תוקפו עד שהמכירה הגיעה – מתקבל רק במכירה שכבר נגבתה בלי רשת (off) או שנשלחה שוב מהתור (rs)
    const ap = apsCheck(snaps.slice(snaps.length - apIds.length), who, 'disc', now, { soldAt: input.soldAt, late: input.off === true || input.rs === true });
    const d = devOk(s, input.inst, cfg);
    const prods = {};
    pids.forEach((p, i) => { const x = snaps[2 + i]; if (x.exists) prods[p] = x.data(); });
    const cps = cpnCodes.map((c, i) => ({ code: c, s: snaps[2 + pids.length + i] }));
    const gifts = {};
    gcodes.forEach((c, i) => { gifts[c] = snaps[2 + pids.length + cpnCodes.length + i]; });
    const { B, c } = await D.prep(tx, db, { uid: who.uid }, now, cfg, input.dev, cust);
    if (cust && !c.data) throw nf('no-cust', 'הלקוח לא נמצא');
    const cd = c && c.data ? c.data : null;
    // קופונים: קיים, פתוח, בתוקף, של הלקוח הזה
    const cp = cps.map(({ code, s: x }) => {
      if (!x.exists) throw nf('cpn-none', 'קוד קופון לא תקף', { code });
      const v = x.data();
      if (v.st !== 'open') throw pre('cpn-used', 'הקופון כבר מומש', { code });
      if (expired(v.exp, input.soldAt)) throw pre('cpn-exp', 'פג תוקף הקופון', { code });
      if (v.cust && v.cust !== cust) throw pre('cpn-cust', 'הקופון שייך ללקוח אחר', { code });
      const pm = isObj(v.disc) ? v.disc : promos.find((p) => p.id === v.promo);
      if (!pm) throw pre('cpn-none', 'קוד קופון לא תקף', { code });
      return { code, promo: { type: pm.type, pct: pm.pct, amt: pm.amt, pids: pm.pids, cats: pm.cats } };
    });
    const co = compute(lines, input, cfg, promos, prods, cp, { at: input.soldAt, club: !!(cd && cd.club), grp: cd && cd.grp, promoOff });
    const dc = discCheck(who, cfg, co, lines, input, ap.list);
    const ovr = dc.ovr ? 'ovr' : null;
    const apLate = dc.used.some((a) => a.late), apCrit = dc.used.some((a) => a.crit);
    const calc = co.calc;
    // סכום מהמכשיר שונה: מכירה מקוונת – נדחית (המכשיר מחשב מחדש). מכירה בלי רשת (off) – כבר נמסרה ללקוח: נשמרת לבדיקת מנהל (chk), בלי מסמך
    let gross = calc.gross, chk = null;
    if (input.gross != null && input.gross !== calc.gross) {
      if (input.off !== true) throw pre('bad-total', 'הסכום במכשיר שונה מהחישוב בשרת – רעננו את העגלה', { gross: calc.gross });
      chk = { devGross: input.gross }; gross = input.gross;
    }
    const list = paysIn(input.pays, gross, cfg, today);
    const cl = closeOk(gross, list, chg, debt);
    // הקפה: partialPay='debt', לקוח מזוהה, בתוך המסגרת (lim – בשקלים, כמו בכרטיס הלקוח)
    let debtWarn = false;
    if (debt > 0) {
      if (cfg.partialPay !== 'debt') throw pre('no-debt', 'הקפה לא פעילה בעסק');
      if (!cust || !cd) throw pre('debt-no-cust', 'הקפה – רק ללקוח מזוהה');
      const free = limAg(cd) - Math.max(0, balOf(cd));
      if (debt > free) {
        if (cfg.creditOverLimit === 'warn') debtWarn = true;
        else if (cfg.creditOverLimit === 'lead' && atLeast(who, 'lead')) debtWarn = true;
        else throw pre('over-limit', 'חריגה ממסגרת ההקפה של הלקוח', { free: Math.max(0, free) });
      }
    }
    // תקרת מזומן (ב ת3, ה 5.16)
    const cashNet = cl.cash - chg;
    let cashLog = false;
    if (Number.isInteger(cfg.cashMax) && cfg.cashMax > 0 && cashNet > cfg.cashMax) {
      const mode = cfg.cashMaxMode;
      if (mode === 'block') throw pre('cash-max', 'תשלום במזומן מעל התקרה – אסור');
      if (mode === 'warn' && input.cashOk !== true) throw pre('cash-max-confirm', 'תשלום במזומן מעל התקרה – אשרו כדי להמשיך');
      if (mode === 'lead' && !atLeast(who, 'lead')) throw deny('cash-max-lead', 'תשלום במזומן מעל התקרה – דורש אחראי');
      cashLog = true;
    }
    // כרטיס מתנה / פתק זיכוי: קיים, מאותו סוג, פתוח, בתוקף, יש יתרה
    const gUse = {};
    for (const p of list.filter((x) => x.m === 'gift' || x.m === 'voucher')) {
      const x = gifts[p.code];
      if (!x || !x.exists) throw nf('gift-none', 'הכרטיס לא נמצא', { code: p.code });
      const v = x.data();
      if (v.type !== p.m) throw pre('gift-type', 'סוג הכרטיס לא מתאים לאמצעי', { code: p.code });
      if (v.st !== 'open') throw pre('gift-void', 'הכרטיס לא פעיל', { code: p.code });
      if (expired(v.exp, now)) throw pre('gift-exp', 'פג תוקף', { code: p.code });
      gUse[p.code] = (gUse[p.code] || 0) + p.amt;
      if (gUse[p.code] > (Number.isInteger(v.bal) ? v.bal : 0)) throw pre('gift-bal', 'אין מספיק יתרה בכרטיס', { code: p.code, bal: v.bal });
    }
    // מסמך: סוג, ומספר הקצאה (ה 5.16)
    const biz = !!(cd && cd.wholesale === true);
    const ks = D.kinds(cfg, { biz, debt, paid: cl.paid, docAs: input.docAs });
    if (!chk && D.needAlloc(cfg, { biz, ks, net: calc.net, alloc: input.alloc })) {
      rejectLog = { act: 'allocBlock', note: 'חשבונית ללקוח עוסק מעל סף ההקצאה – בלי מספר הקצאה' };
      throw pre('need-alloc', 'חשבונית מעל סף מספר ההקצאה – צריך מספר הקצאה מרשות המסים');
    }
    // מספור המכירה – הבא בתור בקופה
    const last = Number.isInteger(d.lastSeq) ? d.lastSeq : 0;
    let seq = last + 1;
    if (input.seq != null) {
      const sc = K.seqCheck(last, input.seq);
      if (sc === 'used') throw pre('seq-used', 'מספר המכירה כבר ניתן');
      if (sc === 'gap') throw pre('seq-gap', 'חסרות מכירות קודמות של הקופה – שלחו אותן קודם');
      seq = input.seq;
    }
    if (seq > K.SEQ_MAX) throw pre('too-many', 'מונה הקופה מלא');
    const id = K.saleId(input.dev, seq);
    const br = d.br || '_';
    const docs = chk ? [] : D.issueSale(B, cfg, { lines: co.lines, vm: calc.vm, rate: calc.rate, net: calc.net, vat: calc.vat, gross, paid: cl.paid, debt, chg,
      pays: list, cust, custData: cd, br, note, id, alloc: input.alloc && /^[0-9]{9}$/.test(String(input.alloc)) ? String(input.alloc) : '', ks });
    const md = input.manDisc ? Object.assign({ amt: calc.sdisc, why: str(input.manDisc.why, 80), by: who.uid }, input.manDisc.pct != null ? { pct: input.manDisc.pct } : {}) : null;
    const warn = [];
    if (cashLog) warn.push('cash-max');
    if (debtWarn) warn.push('over-limit');
    const priceChk = co.lines.filter((l) => l.pid && !l.free && prods[l.pid] && typeof prods[l.pid].price === 'number' && PC.toAg(prods[l.pid].price) !== l.unit).map((l) => l.pid);
    const doc = Object.assign({
      id, reqId: input.reqId, dev: input.dev, br, seq, cashier: who.uid, vm: calc.vm, lines: co.lines.map((l) => { const o = Object.assign({}, l); if (o.mdisc) o.mdisc.by = who.uid; delete o.noPromo; return o; }),
      sub: calc.sub, pdisc: co.lines.reduce((x, l) => x + l.pdisc, 0), disc: calc.disc, net: calc.net, vat: calc.vat, gross, rate: calc.rate,
      paid: cl.paid, chg, debt, pm: byMethod(list, chg), pays: list.map((p) => Object.assign({ m: p.m, amt: p.amt }, p.code ? { code: p.code } : {})),
      cpns: cpnCodes, promos: co.applied.map((a) => a.id), st: 'ok', docs, doc: docs.length ? docs[0].id : null, prn: 'pend',
      retQty: co.lines.map(() => 0), retAmt: co.lines.map(() => 0), retByM: {}, soldAt: input.soldAt, at: now, off: input.off === true,
    }, cust ? { cust, custName: String((cd && (cd.bn || cd.name)) || '').slice(0, 80) } : {}, note ? { note } : {}, md ? { manDisc: md } : {},
    chk ? Object.assign({ chk: true }, chk) : {}, priceChk.length ? { chkPrice: priceChk.slice(0, 50) } : {}, warn.length ? { warn } : {}, ovr ? { discOvr: true } : {},
    promoOff.length ? { promoOff } : {}, dc.used.length ? { aps: dc.used.map(apPub) } : {}, apLate ? { apLate: true } : {}, apCrit ? { apCrit: true } : {});
    // ---- כתיבות ----
    B.flush();
    tx.create(db.doc('possale/' + id), doc);
    list.forEach((p, i) => tx.create(db.doc(`pospay/${id}-${i + 1}`), Object.assign({}, p, { i: i + 1, sale: id, dev: input.dev, br, cashier: who.uid, at: now })));
    for (const [code, amt] of Object.entries(gUse)) {
      const v = gifts[code].data();
      tx.update(gifts[code].ref, { bal: v.bal - amt, upd: now, last: id });
      tx.set(db.collection('posgiftlog').doc(), { code, amt: -amt, sale: id, by: who.uid, at: now });
    }
    for (const { s: x, code } of cps) tx.update(x.ref, { st: 'used', sale: id, usedAt: now, usedBy: who.uid });
    apUse(tx, db, dc.used, { sale: id });
    // מלאי (מינימלי עד ש6 – lib/pos-stock.js): q.{סניף} יורד בכמות, גם מתחת ל-0 (ב ס8)
    const byPid = {};
    for (const l of co.lines) if (l.pid && prods[l.pid]) byPid[l.pid] = (byPid[l.pid] || 0) + l.qty;
    for (const [pid, q] of Object.entries(byPid)) tx.update(db.doc('prod/' + pid), { ['q.' + br]: FieldValue.increment(-q) });
    tx.update(dref, { lastSeq: seq, lastSync: now });
    const out = { id, seq, gross, paid: cl.paid, chg, debt, docs, warn };
    tx.set(mark, { kind: 'sale', sale: id, seq, gross, at: now, res: out });
    if (cashLog) log(tx, db, { act: 'cashMax', sale: id, dev: input.dev, br, by: who.uid, amt: cashNet, note: String(cfg.cashMaxMode) });
    if (ovr) log(tx, db, { act: 'discOvr', sale: id, dev: input.dev, br, by: who.uid, note: 'מתחת למחיר מינימום' });
    if (apLate) {
      // הנחה באישור שפג תוקפו עד שהמכירה הגיעה – ביומן, ותקלה חמורה (poserr crit) שמתריעה לבעל העסק ולמנהלים (posOpsWatch)
      const note = apCrit ? 'אישור הנחה בן יותר מ-72 שעות – בדיקה דחופה' : 'אישור הנחה שפג תוקפו עד שהמכירה הגיעה לשרת';
      log(tx, db, { act: 'apLate', sale: id, dev: input.dev, br, by: who.uid, note });
      tx.create(db.collection('poserr').doc(), { sev: 'crit', code: apCrit ? 'AP_LATE72' : 'AP_LATE', msg: note + ' (מכירה ' + id + ')', ctx: { sale: id, aps: dc.used.filter((a) => a.late).map((a) => a.id).join(',').slice(0, 120) },
        at: now, by: who.uid, dev: input.dev, sent: false });
    }
    if (promoOff.length) log(tx, db, { act: 'promoOff', sale: id, dev: input.dev, br, by: who.uid, note: promoOff.join(',').slice(0, 200) });
    if (debtWarn) log(tx, db, { act: 'creditOver', sale: id, dev: input.dev, br, by: who.uid, amt: debt });
    res = Object.assign({ ok: true }, out);
  })).catch(async (e) => {
    if (rejectLog) { try { await db.collection('poslog').doc().set(Object.assign({ at: Date.now(), dev: input.dev, by: who.uid }, rejectLog)); } catch (x) { /* */ } }
    throw e;
  });
  // חיוב כפול (ב א7): אותו מספר אישור בקופה הזו בחלון dupWinMin – אזהרה ביומן (לא חוסם; ההתראה במסך – ש1)
  if (!res.dup) {
    const apprs = (input.pays || []).filter((p) => p && p.m === 'card' && typeof p.appr === 'string').map((p) => str(p.appr, 20));
    if (apprs.length) {
      const since = now - (Number.isInteger(cfg.dupWinMin) ? cfg.dupWinMin : 10) * 60000;
      const q = await db.collection('pospay').where('dev', '==', input.dev).where('m', '==', 'card').where('at', '>=', since).get();
      const dup = q.docs.filter((x) => x.get('sale') !== res.id && apprs.includes(x.get('appr')));
      if (dup.length) {
        res.warn = (res.warn || []).concat('dup-appr');
        await db.collection('poslog').doc().set({ act: 'dupWarn', sale: res.id, dev: input.dev, by: who.uid, at: Date.now(), note: dup.map((x) => x.get('sale')).join(',').slice(0, 200) });
      }
    }
  }
  return res;
}

// ---------- החזרה (ב ה1–ה15) ----------
// שורות ההחזרה מול המכירה המקורית: (א) כמות מצטברת ≤ שנמכרה, (ב) סכום מצטבר ≤ ששולם על השורה (pg); ביחידה האחרונה – בדיוק היתרה
function retLines(sale, items) {
  if (!Array.isArray(items) || !items.length || items.length > LINES_MAX) throw bad('bad-line', 'שורות ההחזרה לא תקינות');
  const seen = new Set();
  return items.map((it) => {
    if (!isObj(it)) throw bad('bad-line', 'שורה לא תקינה');
    keysOk(it, ['i', 'qty']);
    const l = Number.isInteger(it.i) && sale.lines[it.i];
    if (!l || seen.has(it.i)) throw bad('bad-line', 'שורה לא תקינה');
    seen.add(it.i);
    const done = (sale.retQty || [])[it.i] || 0, doneAmt = (sale.retAmt || [])[it.i] || 0;
    const left = Math.round((l.qty - done) * 1000) / 1000;
    if (typeof it.qty !== 'number' || !(it.qty > 0) || Math.abs(Math.round(it.qty * 1000) - it.qty * 1000) > 1e-6) throw bad('bad-qty', 'כמות לא תקינה');
    if (it.qty > left + 1e-9) throw pre('ret-qty', 'הכמות גדולה ממה שנשאר להחזרה בשורה', { i: it.i, left });
    const pg = Number.isInteger(l.pg) ? l.pg : l.fin;
    const last = Math.abs(it.qty - left) < 1e-9;
    const amt = last ? pg - doneAmt : Math.min(pg - doneAmt, PC.rnd(pg * it.qty / l.qty));
    return { i: it.i, pid: l.pid || '', n: l.n, qty: it.qty, unit: l.unit, amt };
  });
}
const POL = (cfg) => (isObj(cfg.retRefundPolicy) ? cfg.retRefundPolicy : CFG0.retRefundPolicy);
// לאן מותר להחזיר כסף ששולם באמצעי src (ב ה3). פתק זיכוי – רק לפתק (אין המרה למזומן)
function targets(cfg, src) {
  if (src === 'voucher') return ['voucher'];
  const P = POL(cfg);
  const t = Array.isArray(P[src]) ? P[src] : Array.isArray(P['*']) ? P['*'] : ['cash'];
  return [...new Set(t.map((x) => (x === 'same' ? src : x)).filter((x) => PAYM.includes(x)))];
}
// חלוקת ההחזר: (ד) קודם חוב ההקפה, ואז (ג) אמצעי הכסף עם תקרה לכל אמצעי. o = { bal, openSum, refunds?, debtTo?, dmg }
function retAlloc(sale, R, cfg, o) {
  const byM = Object.assign({}, sale.retByM || {});
  const debtLeft = Math.max(0, (sale.debt || 0) - (byM.debt || 0));
  const dpart = Math.min(R, debtLeft);
  const debtOff = Math.min(dpart, Math.max(0, o.bal || 0), Math.max(0, o.openSum || 0));
  const debtCash = dpart - debtOff;
  const money = R - dpart;
  const out = { dpart, debtOff, debtCash, money, alloc: [], debtTo: null, byM: {} };
  if (dpart) out.byM.debt = dpart;
  const exch = o.dmg && cfg.retDefective === 'exchange';
  if (debtCash > 0) {
    // החוב כבר שולם בנפרד (posDebtPay): ההפרש מוחזר לפי retRefundPolicy['*'] – מזומן או פתק זיכוי
    const star = targets(cfg, '*').filter((t) => t === 'cash' || t === 'voucher');
    const t = exch ? 'voucher' : o.debtTo == null ? (star[0] || 'voucher') : o.debtTo;
    if (!star.includes(t) && !(exch && t === 'voucher')) throw pre('ret-target', 'אמצעי ההחזר לא מותר', { m: t });
    out.debtTo = t;
  }
  const pm = sale.pm || {};
  const order = [...new Set((sale.pays || []).map((p) => p.m))].filter((m) => pm[m] > 0);
  const cap = {};
  for (const m of order) cap[m] = Math.max(0, pm[m] - (byM[m] || 0));
  const take = (t, amt) => {
    let left = amt;
    for (const s of order) {
      if (left <= 0) break;
      if (!(cap[s] > 0) || !targets(cfg, s).includes(t)) continue;
      const a = Math.min(cap[s], left);
      cap[s] -= a; left -= a;
      out.byM[s] = (out.byM[s] || 0) + a;
      out.alloc.push({ m: t, src: s, amt: a });
    }
    return left;
  };
  if (money > 0) {
    if (o.refunds == null) {
      // אוטומטי: כל אמצעי מקור – ליעד הראשון שמותר לו (פגום ב-'exchange' – פתק זיכוי להחלפה)
      let left = money;
      for (const s of order) {
        if (left <= 0) break;
        const a = Math.min(cap[s], left);
        if (!(a > 0)) continue;
        const t = exch ? 'voucher' : targets(cfg, s)[0];
        if (exch && !targets(cfg, s).includes('voucher')) throw pre('ret-exch', 'מוצר פגום – החלפה בלבד, והתשלום המקורי לא מאפשר פתק החלפה');
        cap[s] -= a; left -= a;
        out.byM[s] = (out.byM[s] || 0) + a;
        out.alloc.push({ m: t, src: s, amt: a });
      }
      if (left > 0) throw pre('ret-over-method', 'ההחזר גדול ממה ששולם באמצעי התשלום', { left });
    } else {
      if (!Array.isArray(o.refunds) || !o.refunds.length || o.refunds.length > 10) throw bad('bad-refund', 'אמצעי החזר לא תקינים');
      let sum = 0;
      for (const r of o.refunds) {
        if (!isObj(r)) throw bad('bad-refund', 'אמצעי החזר לא תקין');
        keysOk(r, ['m', 'amt']);
        if (!PAYM.includes(r.m) || !isAg(r.amt) || r.amt <= 0) throw bad('bad-refund', 'אמצעי החזר לא תקין');
        if (exch && r.m !== 'voucher') throw pre('ret-exch', 'מוצר פגום – החלפה בלבד (פתק החלפה)');
        sum += r.amt;
      }
      if (sum !== money) throw pre('ret-sum', 'סכום ההחזר לא שווה לסכום שמגיע בכסף', { money });
      for (const r of o.refunds) {
        const left = take(r.m, r.amt);
        if (left > 0) throw pre('ret-over-method', r.m === 'cash' ? 'אי אפשר להחזיר במזומן מעבר למה ששולם באמצעים שמאפשרים מזומן' : 'ההחזר לאמצעי הזה גדול ממה ששולם בו', { m: r.m, left });
      }
    }
  }
  return out;
}
const RET_KEYS = ['op', 'reqId', 'dev', 'inst', 'sale', 'items', 'noRcpt', 'why', 'cond', 'tag', 'dmg', 'refunds', 'debtTo', 'img', 'aps'];
async function retIn(request) {
  const input = inputObject(request);
  if (K.isPractice(input.reqId) || K.isPractice(input.dev)) throw bad('practice', 'פעולת תרגול לא נשלחת לשרת');
  const { who, db } = await gate(request);
  keysOk(input, RET_KEYS);
  const op = input.op == null ? 'do' : input.op;
  if (!['quote', 'do'].includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  noCard(input);
  if (op === 'do') idsIn(input);
  else { if (!K.isDev(input.dev)) throw bad('bad-dev', 'קוד קופה לא תקין'); }
  const cfg = await cfgOf(db);
  const now = Date.now();
  const withSale = input.sale != null;
  if (withSale && (typeof input.sale !== 'string' || !SALE_RE.test(input.sale))) throw bad('bad-sale', 'מספר מכירה לא תקין');
  if (!withSale && input.noRcpt == null) throw bad('bad-input', 'חסרה מכירה מקורית או שורות בלי קבלה');
  const why = str(input.why, 80), cond = str(input.cond, 120);
  if (op === 'do' && !why) throw bad('need-why', 'חובה לבחור סיבת החזרה');
  if (op === 'do' && cfg.retNeedTag === true && input.tag !== true) throw pre('need-tag', 'מוצר בלי תג ואריזה לא מתקבל');
  if (input.debtTo != null && !['cash', 'voucher'].includes(input.debtTo)) throw bad('bad-refund', 'אמצעי החזר לא תקין');
  const dmg = input.dmg === true;
  // מי מאשר (ב ה2): אחראי ומעלה; מעל retMgrAbove – מנהל. POS:W2: קופאי – עם אישור (aps, act 'ret') של אחראי / מנהל (ש5, PIN).
  // כאן בדיקה מקדימה (קריאה רגילה); האימות הקובע והסימון used – בתוך הטרנזקציה
  const apIds = op === 'do' ? apsIn(input.aps) : [];
  const apRefs = apIds.map((a) => db.doc('poslog/' + a));
  const ap0 = apIds.length ? apsCheck(await db.getAll(...apRefs), who, 'ret', now, { soft: true }) : { role: null, list: [] };
  const r0 = ap0.role && RANK[ap0.role] > RANK[roleOf(who)] ? ap0.role : roleOf(who);
  if (op === 'do' && RANK[r0] < RANK.lead) throw deny('ret-lead', 'החזרה – באישור אחראי');
  if (!withSale) {
    if (cfg.retNoRcpt === 'no') throw pre('ret-no-rcpt', 'אין החזרה בלי קבלה בעסק');
    if (cfg.retNoRcpt === 'lead' && RANK[r0] < RANK.lead) throw deny('ret-lead', 'החזרה בלי קבלה – באישור אחראי');
  }
  const mark = op === 'do' ? db.doc('posreq/' + input.dev + '_' + input.reqId) : null;
  const dref = db.doc('posdev/' + input.dev);
  const sref = withSale ? db.doc('possale/' + input.sale) : null;
  let res;
  await serial(who.bizId + '/' + input.dev, () => runTx(db, async (tx) => {
    const reads = [dref].concat(mark ? [mark] : [], sref ? [sref] : [], apRefs);
    const sn = await tx.getAll(...reads);
    const ds = sn[0], ms = mark ? sn[1] : null, ss = sref ? sn[mark ? 2 : 1] : null;
    if (ms && ms.exists) { res = Object.assign({ ok: true, dup: true }, ms.get('res')); return; }
    const ap = apsCheck(sn.slice(sn.length - apRefs.length), who, 'ret', now);
    const d = op === 'do' ? devOk(ds, input.inst, cfg) : (ds.exists ? ds.data() : (() => { throw nf('no-dev', 'הקופה לא נמצאה'); })());
    const br = d.br || '_';
    let sale = null, rl, R, plan, rate;
    if (withSale) {
      if (!ss.exists) throw nf('no-sale', 'המכירה לא נמצאה');
      sale = ss.data();
      if (sale.st === 'void') throw pre('ret-void', 'המכירה בוטלה');
      if (Number.isInteger(cfg.retDays) && now - sale.soldAt > cfg.retDays * DAY) throw pre('ret-too-old', `עברו יותר מ-${cfg.retDays} ימים מהמכירה`);
      rl = retLines(sale, input.items);
      R = rl.reduce((s, x) => s + x.amt, 0);
      rate = sale.rate;
    } else {
      // בלי קבלה (ב ה1): מחיר נוכחי, ברירת מחדל פתק זיכוי
      const nr = input.noRcpt;
      if (!Array.isArray(nr) || !nr.length || nr.length > 50) throw bad('bad-line', 'שורות ההחזרה לא תקינות');
      const ps = await tx.getAll(...nr.map((x) => db.doc('prod/' + (isObj(x) && typeof x.pid === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x.pid) ? x.pid : '_bad_'))));
      rl = nr.map((x, i) => {
        keysOk(x, ['pid', 'qty']);
        if (!ps[i].exists || typeof ps[i].get('price') !== 'number') throw nf('no-prod', 'המוצר לא נמצא');
        if (!Number.isInteger(x.qty) || x.qty < 1 || x.qty > 1000) throw bad('bad-qty', 'כמות לא תקינה');
        const unit = PC.toAg(ps[i].get('price'));
        return { i, pid: x.pid, n: String(ps[i].get('name') || '').slice(0, 120), qty: x.qty, unit, amt: unit * x.qty };
      });
      R = rl.reduce((s, x) => s + x.amt, 0);
      rate = cfg.vatRate;
    }
    if (!(R > 0)) throw pre('ret-zero', 'אין סכום להחזרה בשורות שנבחרו');
    // מי מאשר (ב ה2): אחראי ומעלה; מעל retMgrAbove – מנהל. קופאי / אחראי בלי הסמכות – אישור שמכסה בדיוק את ההחזרה הזו (המכירה, הסכום)
    let apUsed = [];
    if (op === 'do') {
      const need = Number.isInteger(cfg.retMgrAbove) && R > cfg.retMgrAbove ? 'mgr' : 'lead';
      if (RANK[roleOf(who)] < RANK[need]) {
        const a = ap.list.filter((x) => RANK[x.role] >= RANK[need]).sort((x, y) => RANK[y.role] - RANK[x.role])[0];
        if (!a) throw deny(need === 'mgr' ? 'ret-mgr' : 'ret-lead', need === 'mgr' ? 'החזרה בסכום הזה – באישור מנהל' : 'החזרה – באישור אחראי', { amt: R });
        if (a.ref !== (withSale ? input.sale : 'noRcpt')) throw deny('ap-scope', 'האישור ניתן להחזרה של מכירה אחרת');
        if (a.amt == null || R > a.amt) throw deny('ap-scope', 'סכום ההחזרה גדול ממה שאושר', { amt: a.amt });
        apUsed = [a];
      }
    }
    // הלקוח של המכירה (קיזוז חוב): יתרה וחשבוניות פתוחות – ספר המסמכים, קריאות לפני כתיבות
    const custId = sale && sale.cust ? sale.cust : '';
    const { B, c } = await D.prep(tx, db, { uid: who.uid }, now, cfg, input.dev, custId);
    let open = [];
    if (custId && c && c.data && sale.debt > 0) {
      open = await B.openDocs(custId);
      const src = new Set((sale.docs || []).map((x) => x.id));
      open.sort((a, b) => (src.has(b.id) ? 1 : 0) - (src.has(a.id) ? 1 : 0)); // חשבונית המכירה קודם
    }
    const openSum = open.filter((x) => ARD.isDr(x.d) && !x.d.void).reduce((s, x) => s + Math.max(0, x.d.open || 0), 0);
    if (withSale) plan = retAlloc(sale, R, cfg, { bal: c && c.data ? c.ar.bal : 0, openSum, refunds: input.refunds, debtTo: input.debtTo, dmg });
    else {
      const t0 = dmg && cfg.retDefective === 'exchange' ? 'voucher' : cfg.retNoRcptDef === 'refund' ? 'cash' : 'voucher';
      const rf = input.refunds == null ? [{ m: t0, amt: R }] : input.refunds;
      if (!Array.isArray(rf) || rf.length !== 1 || !isObj(rf[0]) || rf[0].amt !== R) throw pre('ret-sum', 'סכום ההחזר לא שווה לסכום שמגיע', { money: R });
      const ok = ['voucher'].concat(cfg.retNoRcptDef === 'refund' && !(dmg && cfg.retDefective === 'exchange') ? ['cash'] : []);
      if (!ok.includes(rf[0].m)) throw pre('ret-target', 'בלי קבלה – החזר לפתק זיכוי בלבד', { m: rf[0].m });
      plan = { dpart: 0, debtOff: 0, debtCash: 0, money: R, alloc: [{ m: rf[0].m, src: 'noRcpt', amt: R }], byM: {}, debtTo: null };
    }
    if (op === 'quote') {
      const max = withSale ? sale.lines.map((l, i) => ({ i, left: Math.round((l.qty - ((sale.retQty || [])[i] || 0)) * 1000) / 1000 })) : null;
      res = { ok: true, amt: R, lines: rl, debtOff: plan.debtOff, debtCash: plan.debtCash, debtTo: plan.debtTo, money: plan.money, alloc: plan.alloc, max,
        targets: withSale ? Object.fromEntries(Object.keys(sale.pm || {}).map((m) => [m, targets(cfg, m)])) : null };
      return;
    }
    // ---- כתיבות ----
    const lastRet = Number.isInteger(d.lastRet) ? d.lastRet : 0;
    const rid = input.dev + '-R' + pad(lastRet + 1);
    // יעדי ההחזר: פתק זיכוי חדש (אחד לכל ההחזרה), כרטיס מתנה מקורי (זיכוי חזרה לכרטיס), השאר – רישום (הכסף / הזיכוי במסוף – בפועל)
    const refunds = plan.alloc.map((a) => ({ m: a.m, src: a.src, amt: a.amt }));
    if (plan.debtCash > 0) refunds.push({ m: plan.debtTo, src: 'debt', amt: plan.debtCash });
    const vAmt = refunds.filter((r) => r.m === 'voucher').reduce((s, r) => s + r.amt, 0);
    const gAmt = refunds.filter((r) => r.m === 'gift').reduce((s, r) => s + r.amt, 0);
    const vouchers = [];
    let gref = null;
    if (gAmt > 0) {
      const gp = (sale.pays || []).find((p) => p.m === 'gift' && p.code);
      if (!gp) throw pre('ret-target', 'לא נמצא כרטיס המתנה המקורי');
      gref = db.doc('posgift/' + gp.code);
      const g = await tx.get(gref); // קריאה אחרונה לפני הכתיבות
      if (!g.exists) throw nf('gift-none', 'הכרטיס לא נמצא');
      gref = { ref: gref, code: gp.code, bal: g.get('bal') || 0 };
    }
    const crLines = rl.map((x) => ({ n: x.n, q: x.qty, p: x.unit / 100, dsc: Math.max(0, PC.rnd(x.unit * x.qty) - x.amt), pid: x.pid || undefined })).map((x) => { if (!x.pid) delete x.pid; return x; });
    const mset = [...new Set(refunds.map((r) => r.m))];
    const cr = D.issueCr(B, { lines: crLines, gross: R, rate, cust: plan.debtOff > 0 ? custId : '', custData: c && c.data, ref: sale && sale.doc ? sale.doc : '',
      debtOff: plan.debtOff, refund: R - plan.debtOff, refM: mset.length === 1 ? mset[0] : 'mix', br, open });
    const vcode = vAmt > 0 ? await newCode(tx, db) : ''; // קריאה – לפני כל הכתיבות
    B.flush();
    if (vAmt > 0) {
      const code = vcode;
      const exp = now + (Number.isInteger(cfg.creditExpDays) ? cfg.creditExpDays : 730) * DAY;
      tx.create(db.doc('posgift/' + code), Object.assign({ type: 'voucher', bal: vAmt, amt0: vAmt, st: 'open', exp, src: rid, by: who.uid, at: now, upd: now }, custId ? { cust: custId } : {}, dmg ? { exch: true } : {}));
      tx.set(db.collection('posgiftlog').doc(), { code, amt: vAmt, ret: rid, by: who.uid, at: now });
      vouchers.push({ code, amt: vAmt, exp });
    }
    if (gref) {
      tx.update(gref.ref, { bal: gref.bal + gAmt, upd: now, last: rid });
      tx.set(db.collection('posgiftlog').doc(), { code: gref.code, amt: gAmt, ret: rid, by: who.uid, at: now });
    }
    if (sale) {
      const rq = (sale.retQty || sale.lines.map(() => 0)).slice(), ra = (sale.retAmt || sale.lines.map(() => 0)).slice();
      for (const x of rl) { rq[x.i] = Math.round(((rq[x.i] || 0) + x.qty) * 1000) / 1000; ra[x.i] = (ra[x.i] || 0) + x.amt; }
      const bm = Object.assign({}, sale.retByM || {});
      for (const [k, v] of Object.entries(plan.byM)) bm[k] = (bm[k] || 0) + v;
      const all = sale.lines.every((l, i) => Math.abs(rq[i] - l.qty) < 1e-9);
      tx.update(sref, { retQty: rq, retAmt: ra, retByM: bm, rets: FieldValue.arrayUnion(rid), retSt: all ? 'all' : 'part', upd: now });
    }
    // מלאי: תקין חוזר למלאי; פגום – רק רישום (ב ה5)
    if (!dmg) { const byPid = {}; for (const x of rl) if (x.pid) byPid[x.pid] = (byPid[x.pid] || 0) + x.qty; for (const [pid, q] of Object.entries(byPid)) { const pr = db.doc('prod/' + pid); tx.set(pr, { q: { [br]: FieldValue.increment(q) } }, { merge: true }); } }
    const doc = Object.assign({ id: rid, reqId: input.reqId, dev: input.dev, br, src: withSale ? 'sale' : 'noRcpt', lines: rl, amt: R, debtOff: plan.debtOff, refunds,
      why, cond, tag: input.tag === true, dmg, by: who.uid, at: now, doc: cr.id, docs: [cr] }, sale ? { sale: input.sale, cust: custId || '' } : {}, apUsed.length ? { aps: apUsed.map(apPub) } : {},
    vouchers.length ? { vouchers: vouchers.map((v) => v.code) } : {}, typeof input.img === 'string' && /^[A-Za-z0-9_/.-]{1,200}$/.test(input.img) ? { img: input.img } : {});
    tx.create(db.doc('posret/' + rid), doc);
    apUse(tx, db, apUsed, { ret: rid });
    tx.update(dref, { lastRet: lastRet + 1, lastSync: now });
    const out = { id: rid, amt: R, debtOff: plan.debtOff, refunds, vouchers, docs: [cr] };
    tx.set(mark, { kind: 'ret', ret: rid, at: now, res: out });
    res = Object.assign({ ok: true }, out);
  }));
  return res;
}
// קוד כרטיס / פתק: 12 ספרות (פחות מ-13 – לעולם לא נראה כמו מספר כרטיס אשראי). קידומת bc.prefixes.gift ('98')
async function newCode(tx, db) {
  for (let i = 0; i < 6; i++) {
    const c = '98' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
    const s = await tx.get(db.doc('posgift/' + c));
    if (!s.exists) return c;
  }
  throw new Error('pos-sale: no free gift code');
}

// ---------- עגלות מושהות (ב ס6) ----------
const PARK_KEYS = ['op', 'dev', 'id', 'name', 'lines', 'cust', 'shift'];
async function parkIn(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request);
  keysOk(input, PARK_KEYS);
  noCard(input);
  const op = input.op;
  if (!['save', 'done', 'list', 'flag'].includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  if (op === 'flag') {
    // סגירת יום (ש5 קורא): כל העגלות הפתוחות של הקופה (או של העסק – מנהל) ← 'flag', לא נמחקות ולא חוסמות
    if (input.dev != null && !K.isDev(input.dev)) throw bad('bad-dev', 'קוד קופה לא תקין');
    if (input.dev == null && who.role !== 'manager') throw deny('not-manager', 'הפעולה זמינה למנהל בלבד');
    let q = db.collection('pospark').where('st', '==', 'open');
    if (input.dev) q = q.where('dev', '==', input.dev);
    const s = await q.limit(500).get();
    const now = Date.now();
    const b = db.batch();
    s.docs.forEach((x) => b.update(x.ref, { st: 'flag', flagAt: now, upd: now }));
    if (s.size) await b.commit();
    return { ok: true, n: s.size, ids: s.docs.map((x) => x.id) };
  }
  if (!K.isDev(input.dev)) throw bad('bad-dev', 'קוד קופה לא תקין');
  if (op === 'list') {
    const s = await db.collection('pospark').where('dev', '==', input.dev).where('st', 'in', ['open', 'flag']).limit(500).get();
    return { ok: true, list: s.docs.map((x) => Object.assign({ id: x.id }, x.data())).sort((a, b) => a.at - b.at) };
  }
  if (typeof input.id !== 'string' || !K.REQ_RE.test(input.id)) throw bad('bad-id', 'מזהה עגלה לא תקין');
  const ref = db.doc('pospark/' + input.dev + '_' + input.id);
  const now = Date.now();
  if (op === 'done') {
    await runTx(db, async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw nf('no-park', 'העגלה לא נמצאה');
      if (s.get('st') !== 'done') tx.update(ref, { st: 'done', doneAt: now, doneBy: who.uid, upd: now });
    });
    return { ok: true, id: input.id };
  }
  // save
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > LINES_MAX) throw bad('bad-line', 'שורות העגלה לא תקינות');
  const lines = linesIn(input.lines.map((l) => (isObj(l) ? Object.fromEntries(Object.entries(l).filter(([k]) => ['pid', 'n', 'bc', 'cat', 'qty', 'unit', 'mdisc', 'noPromo', 'free'].includes(k))) : l)));
  for (const l of lines) { try { PC.line({ unit: l.unit, qty: l.qty }); } catch (e) { throw bad(e.reason || 'bad-line', e.message); } }
  const cfg = await cfgOf(db);
  await runTx(db, async (tx) => {
    const s = await tx.get(ref);
    if (s.exists && s.get('st') === 'done') throw pre('park-done', 'העגלה כבר שוחזרה ונסגרה');
    if (!s.exists && Number.isInteger(cfg.parkMax) && cfg.parkMax > 0) {
      const q = await tx.get(db.collection('pospark').where('dev', '==', input.dev).where('st', '==', 'open').limit(cfg.parkMax + 1));
      if (q.size >= cfg.parkMax) throw pre('park-max', 'הגעתם למספר העגלות המושהות המרבי');
    }
    const o = Object.assign({ dev: input.dev, cashier: who.uid, name: str(input.name, 40), lines, st: 'open', upd: now }, s.exists ? {} : { at: now },
      input.cust ? { cust: str(input.cust, 80) } : {}, input.shift ? { shift: str(input.shift, 80) } : {});
    tx.set(ref, o, { merge: true });
  });
  return { ok: true, id: input.id };
}

// ---------- תשלום חוב הקפה (ב ת6) ----------
async function debtIn(request) {
  const input = inputObject(request);
  if (K.isPractice(input.reqId) || K.isPractice(input.dev)) throw bad('practice', 'פעולת תרגול לא נשלחת לשרת');
  const { who, db } = await gate(request);
  keysOk(input, ['reqId', 'dev', 'inst', 'cust', 'amt', 'pays', 'chg']);
  idsIn(input);
  noCard(input);
  const cust = str(input.cust, 80);
  if (!cust || !/^[A-Za-z0-9_-]{1,80}$/.test(cust)) throw bad('bad-cust', 'לקוח לא תקין');
  if (!isAg(input.amt) || input.amt <= 0) throw bad('bad-amt', 'סכום לא תקין');
  const chg = input.chg == null ? 0 : input.chg;
  const cfg = await cfgOf(db);
  const now = Date.now();
  const list = paysIn(input.pays, input.amt, cfg, PP.dayOf(now));
  if (list.some((p) => p.m === 'gift' || p.m === 'voucher')) throw pre('pay-off', 'תשלום חוב – בלי כרטיס מתנה ופתק זיכוי');
  closeOk(input.amt, list, chg, 0);
  const mark = db.doc('posreq/' + input.dev + '_' + input.reqId), dref = db.doc('posdev/' + input.dev);
  let res;
  await serial(who.bizId + '/' + input.dev, () => runTx(db, async (tx) => {
    const [m, s] = await tx.getAll(mark, dref);
    if (m.exists) { res = Object.assign({ ok: true, dup: true }, m.get('res')); return; }
    const d = devOk(s, input.inst, cfg);
    const { B, c } = await D.prep(tx, db, { uid: who.uid }, now, cfg, input.dev, cust);
    if (!c.data) throw nf('no-cust', 'הלקוח לא נמצא');
    const open = await B.openDocs(cust);
    if (input.amt > Math.max(0, c.ar.bal)) throw pre('over-debt', 'הסכום גבוה מהחוב של הלקוח', { bal: Math.max(0, c.ar.bal) });
    const br = d.br || '_';
    const doc = D.issueRc(B, { n: 'תשלום חוב', amt: input.amt, cust, custData: c.data, br, pays: list, chg, open });
    B.flush();
    list.forEach((p, i) => tx.create(db.doc(`pospay/D-${doc.id}-${i + 1}`), Object.assign({}, p, { i: i + 1, debtPay: doc.id, cust, dev: input.dev, br, cashier: who.uid, at: now })));
    log(tx, db, { act: 'debtPay', dev: input.dev, br, by: who.uid, amt: input.amt, note: cust });
    const out = { doc, amt: input.amt, chg };
    tx.set(mark, { kind: 'debt', at: now, res: out });
    res = Object.assign({ ok: true }, out);
  }));
  return res;
}

// ---------- קופונים (ב נ9) ----------
async function cpnIn(request) {
  const input = inputObject(request);
  const op = input.op;
  if (!['issue', 'check', 'void'].includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  const { who, db } = await gate(request, { mgr: op !== 'check' });
  keysOk(input, ['op', 'code', 'cust', 'promo', 'disc', 'exp']);
  noCard(input);
  const now = Date.now();
  if (op === 'check') {
    if (typeof input.code !== 'string' || !CPN_RE.test(input.code)) throw bad('bad-cpn', 'קוד קופון לא תקין');
    const s = await db.doc('poscpn/' + input.code).get();
    if (!s.exists) return { ok: false, why: 'cpn-none' };
    const v = s.data();
    const why = v.st !== 'open' ? 'cpn-used' : expired(v.exp, now) ? 'cpn-exp' : v.cust && v.cust !== (input.cust || '') ? 'cpn-cust' : null;
    return why ? { ok: false, why } : { ok: true, code: input.code, promo: v.promo || null, disc: v.disc || null, exp: v.exp || null };
  }
  if (op === 'void') {
    if (typeof input.code !== 'string' || !CPN_RE.test(input.code)) throw bad('bad-cpn', 'קוד קופון לא תקין');
    await runTx(db, async (tx) => {
      const ref = db.doc('poscpn/' + input.code);
      const s = await tx.get(ref);
      if (!s.exists) throw nf('cpn-none', 'הקופון לא נמצא');
      if (s.get('st') === 'used') throw pre('cpn-used', 'קופון שמומש לא מבוטל');
      tx.update(ref, { st: 'void', voidAt: now, voidBy: who.uid });
    });
    return { ok: true };
  }
  // issue – הפקה ידנית לכל לקוח (מנהל, אזור הניהול)
  const cust = str(input.cust, 80);
  if (!cust || !/^[A-Za-z0-9_-]{1,80}$/.test(cust)) throw bad('bad-cust', 'קופון שייך ללקוח – חובה לבחור לקוח');
  const promos = await promosOf(db);
  let disc = null, promo = null;
  if (input.disc != null) {
    if (!isObj(input.disc)) throw bad('bad-cpn', 'הנחה לא תקינה');
    keysOk(input.disc, ['type', 'pct', 'amt', 'pids', 'cats']);
    if (!['pct', 'amt'].includes(input.disc.type) || PP.check(input.disc)) throw bad('bad-cpn', 'הנחה לא תקינה');
    disc = Object.fromEntries(Object.entries(input.disc).filter(([, v]) => v != null));
  } else {
    promo = str(input.promo, 80);
    const p = promos.find((x) => x.id === promo);
    if (!p || !['pct', 'amt'].includes(p.type)) throw bad('bad-cpn', 'מבצע לא מתאים לקופון (אחוז או סכום)');
  }
  if (input.exp != null && !(typeof input.exp === 'string' && DATE_RE.test(input.exp))) throw bad('bad-exp', 'תוקף לא תקין');
  let code = input.code == null ? '' : input.code;
  if (code && (typeof code !== 'string' || !CPN_RE.test(code))) throw bad('bad-cpn', 'קוד קופון לא תקין');
  await runTx(db, async (tx) => {
    const cs = await tx.get(db.doc('cust/' + cust));
    if (!cs.exists) throw nf('no-cust', 'הלקוח לא נמצא');
    if (!code) {
      for (let i = 0; i < 6 && !code; i++) { const c = 'C' + Math.random().toString(36).slice(2, 10).toUpperCase(); if (!(await tx.get(db.doc('poscpn/' + c))).exists) code = c; }
      if (!code) throw new Error('pos-sale: no free coupon code');
    } else if ((await tx.get(db.doc('poscpn/' + code))).exists) throw pre('cpn-exists', 'קוד הקופון כבר קיים');
    tx.create(db.doc('poscpn/' + code), Object.assign({ cust, st: 'open', by: who.uid, at: now }, promo ? { promo } : {}, disc ? { disc } : {}, input.exp ? { exp: input.exp } : {}));
  });
  return { ok: true, code };
}

// ---------- כרטיס מתנה / פתק זיכוי (ב ה8, נ10) ----------
async function giftIn(request) {
  const input = inputObject(request);
  const op = input.op;
  if (!['get', 'issue', 'restore', 'sell'].includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  if (op === 'sell' && (K.isPractice(input.reqId) || K.isPractice(input.dev))) throw bad('practice', 'פעולת תרגול לא נשלחת לשרת');
  const { who, db } = await gate(request, { mgr: op === 'issue' });
  keysOk(input, ['op', 'code', 'type', 'amt', 'cust', 'why', 'reqId', 'dev', 'inst', 'pays', 'chg']);
  noCard(input);
  const cfg = await cfgOf(db);
  const now = Date.now();
  const codeOk = (c) => typeof c === 'string' && CODE_RE.test(c);
  if (op === 'get') {
    if (!codeOk(input.code)) throw bad('bad-code', 'קוד כרטיס לא תקין');
    const s = await db.doc('posgift/' + input.code).get();
    if (!s.exists) throw nf('gift-none', 'הכרטיס לא נמצא');
    const v = s.data();
    return { ok: true, code: input.code, type: v.type, bal: v.bal, exp: v.exp || null, st: expired(v.exp, now) ? 'exp' : v.st };
  }
  if (op === 'restore') {
    // שחזור פתק / כרטיס שאבד: הישן ← void, חדש באותה יתרה (אחראי, נרשם)
    if (!atLeast(who, 'lead')) throw deny('ret-lead', 'שחזור – באישור אחראי');
    if (!codeOk(input.code)) throw bad('bad-code', 'קוד כרטיס לא תקין');
    let out;
    await runTx(db, async (tx) => {
      const ref = db.doc('posgift/' + input.code);
      const s = await tx.get(ref);
      if (!s.exists) throw nf('gift-none', 'הכרטיס לא נמצא');
      const v = s.data();
      if (v.st !== 'open') throw pre('gift-void', 'הכרטיס לא פעיל');
      const code = await newCode(tx, db);
      tx.update(ref, { st: 'void', voidAt: now, voidBy: who.uid, bal: 0, repl: code, upd: now });
      tx.create(db.doc('posgift/' + code), Object.assign({}, v, { bal: v.bal, st: 'open', src: 'restore:' + input.code, by: who.uid, at: now, upd: now }));
      tx.set(db.collection('posgiftlog').doc(), { code: input.code, amt: -v.bal, restore: code, by: who.uid, at: now });
      tx.set(db.collection('posgiftlog').doc(), { code, amt: v.bal, restore: input.code, by: who.uid, at: now });
      log(tx, db, { act: 'giftRestore', by: who.uid, note: input.code + '→' + code, amt: v.bal });
      out = { ok: true, code, bal: v.bal, exp: v.exp || null };
    });
    return out;
  }
  if (op === 'issue') {
    // פתק זיכוי ידני (מנהל) – למשל פתק נייר ישן. נרשם
    if (input.type !== 'voucher') throw bad('bad-type', 'הפקה ידנית – פתק זיכוי בלבד');
    if (!isAg(input.amt) || input.amt <= 0 || input.amt > 10000000) throw bad('bad-amt', 'סכום לא תקין');
    const why = str(input.why, 120);
    if (!why) throw bad('need-why', 'חובה סיבה');
    let out;
    await runTx(db, async (tx) => {
      const code = await newCode(tx, db);
      const exp = now + (Number.isInteger(cfg.creditExpDays) ? cfg.creditExpDays : 730) * DAY;
      tx.create(db.doc('posgift/' + code), Object.assign({ type: 'voucher', bal: input.amt, amt0: input.amt, st: 'open', exp, src: 'manual', why, by: who.uid, at: now, upd: now }, input.cust ? { cust: str(input.cust, 80) } : {}));
      tx.set(db.collection('posgiftlog').doc(), { code, amt: input.amt, manual: true, by: who.uid, at: now });
      log(tx, db, { act: 'giftIssue', by: who.uid, amt: input.amt, note: why });
      out = { ok: true, code, bal: input.amt, exp };
    });
    return out;
  }
  // sell – מכירת כרטיס מתנה: קבלה (rc, giftDocMode 'advance' = מקדמה, בלי מע"מ עד המימוש)
  idsIn(input);
  if (!isAg(input.amt) || input.amt <= 0 || input.amt > 10000000) throw bad('bad-amt', 'סכום לא תקין');
  const chg = input.chg == null ? 0 : input.chg;
  const list = paysIn(input.pays, input.amt, cfg, PP.dayOf(now));
  if (list.some((p) => p.m === 'gift' || p.m === 'voucher')) throw pre('pay-off', 'אי אפשר לקנות כרטיס מתנה בכרטיס מתנה או בפתק זיכוי');
  closeOk(input.amt, list, chg, 0);
  const mark = db.doc('posreq/' + input.dev + '_' + input.reqId), dref = db.doc('posdev/' + input.dev);
  let res;
  await serial(who.bizId + '/' + input.dev, () => runTx(db, async (tx) => {
    const [m, s] = await tx.getAll(mark, dref);
    if (m.exists) { res = Object.assign({ ok: true, dup: true }, m.get('res')); return; }
    const d = devOk(s, input.inst, cfg);
    const { B } = await D.prep(tx, db, { uid: who.uid }, now, cfg, input.dev, '');
    const code = await newCode(tx, db);
    const br = d.br || '_';
    const doc = D.issueRc(B, { n: 'כרטיס מתנה', amt: input.amt, br, pays: list, chg });
    B.flush();
    tx.create(db.doc('posgift/' + code), Object.assign({ type: 'gift', bal: input.amt, amt0: input.amt, st: 'open', src: doc.id, by: who.uid, at: now, upd: now }, input.cust ? { cust: str(input.cust, 80) } : {}));
    tx.set(db.collection('posgiftlog').doc(), { code, amt: input.amt, doc: doc.id, by: who.uid, at: now });
    list.forEach((p, i) => tx.create(db.doc(`pospay/G-${doc.id}-${i + 1}`), Object.assign({}, p, { i: i + 1, giftSale: doc.id, dev: input.dev, br, cashier: who.uid, at: now })));
    const out = { code, amt: input.amt, doc };
    tx.set(mark, { kind: 'gift', at: now, res: out });
    res = Object.assign({ ok: true }, out);
  }));
  return res;
}

// ---------- מבצעים (ניהול, ב נ1–נ3) ----------
const PROMO_F = ['type', 'n', 'on', 'auto', 'from', 'to', 'pids', 'cats', 'clubOnly', 'custGrp', 'maxPerCust', 'prio', 'pct', 'amt', 'price', 'buy', 'get', 'bn', 'gn', 'getPct', 'need', 'minAmt', 'giftPid', 'upsell'];
function promoClean(p) {
  const o = {};
  for (const k of PROMO_F) if (p[k] !== undefined && p[k] !== null) o[k] = p[k];
  o.n = str(o.n, 80);
  if (!o.n) throw bad('bad-name', 'שם המבצע חסר');
  for (const k of ['pids', 'cats', 'buy', 'get']) if (o[k] !== undefined && (!Array.isArray(o[k]) || o[k].length > 500 || o[k].some((x) => typeof x !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(x)))) throw bad('bad-promo', 'רשימת מוצרים לא תקינה');
  for (const k of ['from', 'to']) if (o[k] !== undefined && !(typeof o[k] === 'string' && DATE_RE.test(o[k]))) throw bad('bad-promo', 'תאריך לא תקין');
  if (o.from && o.to && o.from > o.to) throw bad('bad-promo', 'תאריך הסיום לפני ההתחלה');
  for (const k of ['on', 'auto', 'clubOnly']) if (o[k] !== undefined && typeof o[k] !== 'boolean') throw bad('bad-promo', 'ערך לא תקין: ' + k);
  if (o.upsell !== undefined) delete o.upsell; // גל 4 (AI)
  const why = PP.check(o);
  if (why) throw bad(why, 'פרטי המבצע לא תקינים');
  return o;
}
async function promoIn(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request, { mgr: true });
  const op = input.op;
  if (!['set', 'on', 'dup'].includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  const now = Date.now();
  const idOk = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
  if (op === 'on') {
    keysOk(input, ['op', 'id', 'on']);
    if (!idOk(input.id) || typeof input.on !== 'boolean') throw bad('bad-input', 'קלט לא תקין');
    const ref = db.doc('promo/' + input.id);
    if (!(await ref.get()).exists) throw nf('no-promo', 'המבצע לא נמצא');
    await ref.update({ on: input.on, upd: now, by: who.uid });
    return { ok: true, id: input.id, on: input.on };
  }
  if (op === 'dup') {
    // שכפול מבצע לשבוע הבא (נ1): אותו מבצע, תאריכים חדשים, כבוי עד שמפעילים
    keysOk(input, ['op', 'id', 'from', 'to']);
    if (!idOk(input.id)) throw bad('bad-input', 'קלט לא תקין');
    const s = await db.doc('promo/' + input.id).get();
    if (!s.exists) throw nf('no-promo', 'המבצע לא נמצא');
    const o = promoClean(Object.assign({}, s.data(), { from: input.from, to: input.to, on: false }));
    const ref = db.collection('promo').doc();
    await ref.set(Object.assign(o, { at: now, upd: now, by: who.uid, dupOf: input.id }));
    return { ok: true, id: ref.id };
  }
  keysOk(input, ['op', 'id', 'p']);
  if (!isObj(input.p)) throw bad('bad-input', 'קלט לא תקין');
  const o = promoClean(input.p);
  // מבצע שכבר חל על מכירות לא משתנה בהן (נ13): המכירה שומרת את ההנחה בשורה, והקבלה לא נבנית מחדש מהמבצע
  const ref = input.id ? (idOk(input.id) ? db.doc('promo/' + input.id) : null) : db.collection('promo').doc();
  if (!ref) throw bad('bad-input', 'קלט לא תקין');
  await ref.set(Object.assign(o, { upd: now, by: who.uid }, input.id ? {} : { at: now }), { merge: false });
  return { ok: true, id: ref.id };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`pos: ${name} failed`, { name: e && e.name, code: e && e.code, msg: String(e && e.message || '').slice(0, 300) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { posSale: saleIn, posReturn: retIn, posPark: parkIn, posDebtPay: debtIn, posCouponUse: cpnIn, posGift: giftIn, posPromo: promoIn };
for (const [n, f] of Object.entries(FNS)) exports[n] = onCall(wrap(n, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: {
  CFG0, PAYM, cfgOf, luhn, cardIn, hasCard, paysIn, closeOk, byMethod, linesIn, compute, discCheck, apsCheck, retLines, retAlloc, targets, QON,
  call: Object.fromEntries(Object.entries(FNS).map(([n, f]) => [n, () => wrap(n, f)])),
} });
