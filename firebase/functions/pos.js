'use strict';
// קופה (POS), שלב 0 – תשתית בלבד (17.11.2026). כל כתיבה לאוספי הקופה – רק מכאן (בכללים: allow write: if false).
// רק עסק במבנה b/{bizId} (החלטה 10 בתוכנית): עסק legacy (תחילית ריקה) נדחה – אחרת הנתונים ייכתבו לשורש.
// התוספת 'pos' (FEATURES, רק מנהל־על מדליק) כבויה = כל הפונקציות נדחות (feature-off), חוץ ממנהל־על שמכין את ההגדרות מראש.
//
//   posCfg()                                   → { type, cfg, src, defs, types, who } – ההגדרות בפועל (ברירות מחדל ← סוג עסק ← העסק).
//                                                צוות עם pos / posMgr, מנהל, מנהל־על.
//   posCfgSet({ type?, set?, unset? })         → { type, cfg } – מנהל (הגדרות who:'mgr') או מנהל־על (הכול, כולל סוג העסק; נרשם ב-audit).
//   posDev({ op:'add', name, br })             → { dev } – מנהל: קופה חדשה, קוד חדש מהמונה (poscfg/ctr.dev). קוד לא חוזר לעולם.
//   posDev({ op:'claim', dev, inst })          → { dev, name, br } – המכשיר נרשם על הקופה (inst = מזהה התקנה שנוצר במכשיר).
//                                                קופה רשומה על מכשיר אחר – dev-taken. קופה שפרשה – retired.
//   posDev({ op:'retire', dev, replace? })     → { dev, lostFrom, newDev? } – מנהל: פרישה (אבד/התקלקל). replace – קופה חלופית עם קוד חדש.
//   posDev({ op:'on', dev, on })               → { dev, on } – מנהל: השבתה/הפעלה (מכשיר שנגנב – השבתה בלחיצה).
//   posSale({ reqId, dev, inst, lines, disc?, dpct?, vm?, soldAt, seq?, gross?, off? })
//                                              → { id, seq, gross, dup? } – שלד המכירה: מספור בטרנזקציה, reqId נגד כפילות.
//     lines: [{ pid, n, bc?, qty, unit (אגורות), disc? | dpct? }]. הסכומים מחושבים מחדש בשרת (pos-calc). gross מהמכשיר שונה – נשמר
//     עם chk:true (לבדיקת מנהל), לא נדחה (מכירה שכבר נמסרה ללקוח לא משתנה). seq מהמכשיר (שלב 2, בלי רשת) – חייב להיות הבא בתור.
//     שלב 0: בלי תשלום (pospay), בלי מסמך ardoc (doc:null), בלי מלאי – אלה בשלב 1.
// שגיאות (details.reason): legacy, feature-off, not-manager, not-superadmin, not-pos, bad-input, bad-op, bad-name, bad-br, bad-dev,
//   bad-inst, no-dev, dev-taken, dev-off, retired, bad-req, practice, req-used, bad-seq, seq-used, seq-gap, bad-time, bad-line, bad-unit,
//   bad-qty, bad-disc, bad-vm, bad-value, unknown-key, not-allowed, bad-type, too-many. ההודעה בעברית.

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const PC = require('./lib/pos-calc');
const CF = require('./lib/pos-cfg');
const K = require('./lib/pos-core');

const LINES_MAX = 300;
// טרנזקציה על מונה משותף (posdev.lastSeq, poscfg/ctr): בעומס, ספריית Firestore מוותרת אחרי 10 המתנות (backoff) גם כש-maxAttempts גבוה,
// וההמתנה שלה גדלה עד דקה. לכן מעט ניסיונות פנימיים, ועוד סבבים בחוץ עם המתנה אקראית קצרה (עד 0.4 שנייה). הגוף קורא הכול מחדש בכל ניסיון, ושגיאה שלנו (HttpsError) לא חוזרת.
const TX = { maxAttempts: 4 };
const TX_OUTER = 40;
// תור לכל מונה בתוך אותו מופע שרת: בקשות לאותה קופה רצות אחת אחרי השנייה (ההתנגשות בטרנזקציה נשארת רק בין מופעים שונים).
// הנכונות (בלי חור ובלי כפילות) – תמיד מהטרנזקציה עצמה; התור רק מונע עומס התנגשויות.
const Q = new Map();
const QON = { on: true }; // בדיקות בלבד: off = כמו כמה מופעי שרת במקביל (רק הטרנזקציה שומרת על המספור)
function serial(key, fn) {
  if (!QON.on) return fn();
  const prev = Q.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  Q.set(key, tail);
  tail.then(() => { if (Q.get(key) === tail) Q.delete(key); });
  return run;
}
const retriable = (e) => !(e instanceof HttpsError) && (e && (e.code === 10 || /maximum number of retries|ABORTED|contention/i.test(String(e.message || ''))));
async function runTx(db, fn) {
  for (let i = 0; ; i++) {
    try { return await db.runTransaction(fn, TX); } catch (e) {
      if (i >= TX_OUTER - 1 || !retriable(e)) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * Math.min(400, 40 * (i + 1)))));
    }
  }
}
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const nf = (reason, msg) => new HttpsError('not-found', msg, { reason });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const BR_RE = /^[A-Za-z0-9_-]{1,40}$/;

// הרשאות: who.role 'manager' (כולל מנהל־על) = הכול. עובד: pos (קופאי) או posMgr (אחראי משמרת).
const isSeller = (who) => who.role === 'manager' || hasPerm(who, 'pos') || hasPerm(who, 'posMgr');

async function gate(request, o) {
  const who = await requireStaff(request);
  if (!who.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש');
  if (!who.superadmin) T.requireFeature(who.biz, 'pos');
  if (o && o.sup && !who.superadmin) throw deny('not-superadmin', 'הפעולה זמינה למנהל־על בלבד');
  if (o && o.mgr && who.role !== 'manager') throw deny('not-manager', 'הפעולה זמינה למנהל בלבד');
  if (o && o.sell && !isSeller(who)) throw deny('not-pos', 'אין לך הרשאת קופה');
  return { who, db: T.tdb() };
}
const cfgErr = (e) => (e && e.reason ? (e.reason === 'not-allowed' ? deny(e.reason, e.message) : bad(e.reason, e.message)) : e);

// ---------- הגדרות ----------
async function cfgDoc(db) { const s = await db.doc('poscfg/main').get(); return s.exists ? s.data() : null; }
async function cfgGet(request) {
  inputObject(request);
  const { who, db } = await gate(request, { sell: true });
  const e = CF.eff(await cfgDoc(db));
  return Object.assign({ ok: true }, e, CF.describe(), { who: who.superadmin ? 'sa' : who.role === 'manager' ? 'mgr' : 'staff' });
}
async function cfgSet(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request, { mgr: true }); // קודם gate: requireStaff מסיר את bizId (מנהל־על) מהקלט
  for (const k of Object.keys(input)) if (!['type', 'set', 'unset'].includes(k)) throw bad('bad-input', 'קלט לא תקין');
  const role = who.superadmin ? 'sa' : 'mgr';
  const ref = db.doc('poscfg/main');
  let next;
  await runTx(db, async (tx) => {
    const s = await tx.get(ref);
    try { next = CF.patch(s.exists ? s.data() : null, input, role); } catch (e) { throw cfgErr(e); }
    tx.set(ref, Object.assign({}, next, { upd: Date.now(), by: who.uid }));
    if (who.superadmin) {
      const note = JSON.stringify({ type: input.type, set: input.set, unset: input.unset }).slice(0, 500);
      tx.set(db.collection('audit').doc(), { by: who.uid, t: Date.now(), act: 'posCfgSet', note });
    }
  });
  const e = CF.eff(next);
  return { ok: true, type: e.type, cfg: e.cfg, src: e.src };
}

// ---------- קופות (מכשירים) ----------
async function dev(request) {
  const input = inputObject(request);
  const op = input.op;
  if (op === 'claim') return devClaim(request, input);
  if (!['add', 'retire', 'on'].includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  const { who, db } = await gate(request, { mgr: true });
  if (op === 'add') {
    const name = str(input.name, 40);
    if (!name) throw bad('bad-name', 'שם הקופה חסר');
    const br = input.br == null || input.br === '' ? '_' : input.br;
    if (typeof br !== 'string' || !BR_RE.test(br)) throw bad('bad-br', 'סניף לא תקין');
    let code;
    await serial(who.bizId + '/ctr', () => runTx(db, async (tx) => { code = await addDev(tx, db, who, name, br); }));
    return { ok: true, dev: code };
  }
  if (!K.isDev(input.dev)) throw bad('bad-dev', 'קוד קופה לא תקין');
  const ref = db.doc('posdev/' + input.dev);
  if (op === 'on') {
    if (typeof input.on !== 'boolean') throw bad('bad-input', 'קלט לא תקין');
    await runTx(db, async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw nf('no-dev', 'הקופה לא נמצאה');
      if (s.get('st') === 'retired') throw pre('retired', 'הקופה הוצאה משימוש');
      tx.update(ref, { on: input.on, upd: Date.now(), updBy: who.uid });
    });
    return { ok: true, dev: input.dev, on: input.on };
  }
  // retire
  let out;
  await runTx(db, async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw nf('no-dev', 'הקופה לא נמצאה');
    if (s.get('st') === 'retired') throw pre('retired', 'הקופה כבר הוצאה משימוש');
    const d = s.data();
    const lostFrom = (Number.isInteger(d.lastSeq) ? d.lastSeq : 0) + 1;
    let newDev = null;
    if (input.replace === true) newDev = await addDev(tx, db, who, d.name, d.br, input.dev);
    const now = Date.now();
    tx.update(ref, Object.assign({ st: 'retired', on: false, retiredAt: now, retiredBy: who.uid, lostFrom, upd: now }, newDev ? { replacedBy: newDev } : {}));
    out = Object.assign({ ok: true, dev: input.dev, lostFrom }, newDev ? { newDev } : {});
  });
  return out;
}
// קוד חדש מהמונה (poscfg/ctr.dev) – בתוך טרנזקציה. המונה רק עולה, ולכן קוד שפרש לא ניתן שוב.
async function addDev(tx, db, who, name, br, replaces) {
  const ctr = db.doc('poscfg/ctr');
  const c = await tx.get(ctr);
  const n = (c.exists && Number.isInteger(c.get('dev')) ? c.get('dev') : 0) + 1;
  if (n > 9999) throw pre('too-many', 'הגעתם למספר הקופות המרבי');
  const code = K.devCode(n);
  const now = Date.now();
  tx.set(ctr, { dev: n }, { merge: true });
  tx.create(db.doc('posdev/' + code), Object.assign({ name, code, br, on: true, st: 'active', lastSeq: 0, at: now, by: who.uid, upd: now },
    replaces ? { replaces } : {}));
  return code;
}
async function devClaim(request, input) {
  const { who, db } = await gate(request, { sell: true });
  if (!K.isDev(input.dev)) throw bad('bad-dev', 'קוד קופה לא תקין');
  if (!K.isInst(input.inst)) throw bad('bad-inst', 'מזהה מכשיר לא תקין');
  const ref = db.doc('posdev/' + input.dev);
  let out;
  await runTx(db, async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw nf('no-dev', 'הקופה לא נמצאה');
    const d = s.data();
    if (d.st === 'retired') throw pre('retired', 'הקופה הוצאה משימוש. רשמו קופה חדשה');
    if (d.inst && d.inst !== input.inst) throw pre('dev-taken', 'הקופה כבר רשומה על מכשיר אחר');
    if (!d.inst) tx.update(ref, { inst: input.inst, claimAt: Date.now(), claimBy: who.uid, upd: Date.now() });
    out = { ok: true, dev: input.dev, name: d.name, br: d.br, on: d.on === true };
  });
  return out;
}

// ---------- מכירה (שלד) ----------
function linesIn(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > LINES_MAX) throw bad('bad-line', 'שורות המכירה לא תקינות');
  return lines.map((l) => {
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw bad('bad-line', 'שורה לא תקינה');
    for (const k of Object.keys(l)) if (!['pid', 'n', 'bc', 'qty', 'unit', 'disc', 'dpct'].includes(k)) throw bad('bad-line', 'שורה לא תקינה');
    const o = { pid: str(l.pid, 80), n: str(l.n, 120), qty: l.qty, unit: l.unit };
    if (!o.n) throw bad('bad-line', 'שם מוצר חסר');
    if (l.bc != null) o.bc = str(l.bc, 40);
    if (l.disc != null) o.disc = l.disc;
    if (l.dpct != null) o.dpct = l.dpct;
    return o;
  });
}
async function saleIn(request) {
  const input = inputObject(request);
  // תרגול – נדחה לפני כל דבר אחר (גם לפני הרשאות), כדי שאף מכירת תרגול לא תיגע במונה
  if (K.isPractice(input.reqId) || K.isPractice(input.dev)) throw bad('practice', 'מכירת תרגול לא נשלחת לשרת');
  const { who, db } = await gate(request, { sell: true });
  // POS:W2: rs (שליחה חוזרת מהתור, pos-data.js) – מתקבל ולא בשימוש בשלד הזה (pos-sale.js משתמש בו לאישור הנחה מאוחר)
  for (const k of Object.keys(input)) if (!['reqId', 'dev', 'inst', 'lines', 'disc', 'dpct', 'vm', 'soldAt', 'seq', 'gross', 'off', 'rs'].includes(k)) throw bad('bad-input', 'קלט לא תקין');
  if (!K.isReq(input.reqId)) throw bad('bad-req', 'מזהה בקשה לא תקין');
  if (!K.isDev(input.dev)) throw bad('bad-dev', 'קוד קופה לא תקין');
  if (!K.isInst(input.inst)) throw bad('bad-inst', 'מזהה מכשיר לא תקין');
  const now = Date.now();
  if (!K.soldAtOk(input.soldAt, now)) throw bad('bad-time', 'שעון המכשיר לא תקין');
  if (input.seq != null && K.seqCheck(0, input.seq) === 'bad') throw bad('bad-seq', 'מספר מכירה לא תקין');
  if (input.gross != null && !Number.isInteger(input.gross)) throw bad('bad-input', 'סכום לא תקין');
  const lines = linesIn(input.lines);
  const cfg = CF.eff(await cfgDoc(db)).cfg;
  let calc;
  try { calc = PC.sale(lines, { disc: input.disc, dpct: input.dpct, vm: input.vm, rate: cfg.vatRate }); } catch (e) { throw bad(e.reason || 'bad-line', e.message); }
  const mark = db.doc('posreq/' + input.dev + '_' + input.reqId), dref = db.doc('posdev/' + input.dev);
  let res;
  await serial(who.bizId + '/' + input.dev, () => runTx(db, async (tx) => {
    const [m, s] = await tx.getAll(mark, dref);
    if (m.exists) {
      // אותה בקשה פעמיים = אותה מכירה (גם אחרי פרישה – זו מכירה שכבר נרשמה)
      res = { ok: true, id: m.get('sale'), seq: m.get('seq'), gross: m.get('gross'), dup: true };
      return;
    }
    if (!s.exists) throw nf('no-dev', 'הקופה לא נמצאה');
    const d = s.data();
    if (d.st === 'retired') throw pre('retired', 'הקופה הוצאה משימוש');
    if (d.on !== true) throw pre('dev-off', 'הקופה מושבתת');
    if (!d.inst || d.inst !== input.inst) throw pre('dev-taken', 'המכשיר לא רשום על הקופה הזו');
    const last = Number.isInteger(d.lastSeq) ? d.lastSeq : 0;
    let seq = last + 1;
    if (input.seq != null) {
      const c = K.seqCheck(last, input.seq);
      if (c === 'used') throw pre('seq-used', 'מספר המכירה כבר ניתן');
      if (c === 'gap') throw pre('seq-gap', 'חסרות מכירות קודמות של הקופה – שלחו אותן קודם');
      seq = input.seq;
    }
    if (seq > K.SEQ_MAX) throw pre('too-many', 'מונה הקופה מלא');
    const id = K.saleId(input.dev, seq);
    const sl = lines.map((l, i) => Object.assign({}, l, { disc: calc.lines[i].disc, tot: calc.lines[i].tot, sd: calc.lines[i].sd, retQty: 0 }));
    for (const l of sl) delete l.dpct;
    const doc = {
      id, reqId: input.reqId, dev: input.dev, br: d.br || '_', seq, cashier: who.uid, vm: calc.vm, lines: sl,
      sub: calc.sub, disc: calc.disc, net: calc.net, vat: calc.vat, gross: calc.gross, rate: calc.rate, paid: 0,
      st: 'ok', doc: null, soldAt: input.soldAt, at: now, off: input.off === true,
    };
    if (input.gross != null && input.gross !== calc.gross) Object.assign(doc, { chk: true, devGross: input.gross });
    tx.create(db.doc('possale/' + id), doc);
    tx.update(dref, { lastSeq: seq, lastSync: now });
    tx.set(mark, { sale: id, seq, gross: calc.gross, at: now });
    res = { ok: true, id, seq, gross: calc.gross };
  }));
  return res;
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`pos: ${name} failed`, { name: e && e.name, code: e && e.code, msg: String(e && e.message || '').slice(0, 300) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

exports.posCfg = onCall(wrap('posCfg', cfgGet));
exports.posCfgSet = onCall(wrap('posCfgSet', cfgSet));
exports.posDev = onCall(wrap('posDev', dev));
exports.posSale = onCall(wrap('posSale', saleIn));

Object.defineProperty(exports, '_core', { enumerable: false, value: {
  cfgGet, cfgSet, dev, saleIn, isSeller, QON,
  call: { posCfg: () => wrap('posCfg', cfgGet), posCfgSet: () => wrap('posCfgSet', cfgSet), posDev: () => wrap('posDev', dev), posSale: () => wrap('posSale', saleIn) },
} });
