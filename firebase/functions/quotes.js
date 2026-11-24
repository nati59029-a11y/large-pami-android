'use strict';
// הצעת מחיר ללקוח (משימה 2026-11-24_הצעת-מחיר-ומיון-חיפוש, שלב 2). כל כתיבה רק כאן; מהאפליקציה – קריאה לפי החוקים (כמו ord).
// נתיבים דרך T.tdb(): בשורש ללארג' פעמי במצב legacy, אחרת b/{bizId}/...
//
//   qt/{id}          { no, br, cust, custId?, items:[{pid?,n,qty,price,ct?,c?,lb?}], total, vm, vr, net, vat, gross, disc?, note?,
//                      vu:'YYYY-MM-DD' (היום האחרון בתוקף, שעון ישראל), st:'open'|'conv'|'cancel', apr?:{st:'req'|'ok',by,byName,at},
//                      cvReq (reqId קבוע להמרה להזמנה), cancel?:{by,at}, by, byName, at, upd }   – id = 'q' + reqId
//   qt/{id}/log/{k}  { t, by, act, note }                                                  – create / cancel / req / ok / conv (ובהמשך send)
//   ordcfg/seq_qt    { n }                                                                 – מספור רץ של הצעות, נצרך בטרנזקציית השמירה
// "פג תוקף" לא נשמר – מחושב: st==='open' && vu < היום בשעון ישראל (_core.expired).
// הצעה לא נוגעת במלאי (אין applyMoves, אין stockLog/xfer), לא ב-cprice, לא ברווחיות ולא בדוחות. הצעה לא ניתנת לעריכה.
//
// הרשאה: בדיוק כמו createOrder – who() (תוספת orders + הרשאת ord) וסניף העובד (brOf / גישה לפי סניף ההצעה).
// ניקוי ותמחור: אותן פונקציות של orders.js (cleanCust, rawItems, discIn/discOk, priceCtx, priceRun, cartons, freeHits/freeCheck).
//
// ייצוא: index.js עושה Object.assign(exports, require('./quotes')) – כל פונקציה שנוספת ל-FNS כאן מיוצאת אוטומטית.
// אפשרויות פרסום לפונקציה (סודות, זמן) – במפה OPT. _core לא מיוצא (לא enumerable).

const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const logger = require('firebase-functions/logger');
const crypto = require('node:crypto');
const T = require('./lib/tenant');
const { inputObject } = require('./lib/roles');
const O = require('./orders')._core;

const { bad, deny, pre, NB } = O;
const QT_DAYS = 14; // ברירת מחדל לתוקף (החלטת המשתמש)
const DAYS_MAX = 365;
const ACTS = ['cancel', 'req', 'ok'];
const QT_KEYS = ['reqId', 'br', 'cust', 'custId', 'items', 'note', 'disc', 'days', 'total']; // total נשלח? מתעלמים – השרת מחשב (כמו createOrder)

// ---------- תאריכים (שעון ישראל) ----------
const ilDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const vuOf = (now, days) => addDays(ilDay(now), days);
// פג תוקף: הצעה פתוחה שהיום האחרון שלה כבר עבר (בשעון ישראל). הצעה שהומרה/בוטלה – לא "פג תוקף"
const expired = (d, now) => !!d && d.st === 'open' && typeof d.vu === 'string' && d.vu < ilDay(now == null ? Date.now() : now);
function daysOf(v) {
  if (v === undefined || v === null || v === '') return QT_DAYS;
  if (!Number.isInteger(v) || v < 1 || v > DAYS_MAX) throw bad('bad-days', `תוקף ההצעה: מספר שלם של ימים בין 1 ל-${DAYS_MAX}`);
  return v;
}

// ---------- גישה ----------
const qtRef = (db, id) => db.doc('qt/' + id);
const logRef = (db, id) => db.collection(`qt/${id}/log`).doc();
// עובד – רק הצעה של סניף שמותר לו (כמו ordAccess). מנהל / עובד בלי שיוך סניף – הכול
function access(w, d) {
  if (!d) throw new HttpsError('not-found', 'הצעת המחיר לא נמצאה', { reason: 'no-qt' });
  if (d.br && d.br !== NB && w.mine && !w.mine.includes(d.br)) throw deny('foreign-br', 'אין לך הרשאה להצעה של סניף אחר');
  return d;
}
// טעינת הצעה + בדיקת הרשאה וסניף. tx – בתוך טרנזקציה (אחרת קריאה רגילה). מחזיר { ref, snap, d }
async function loadQt(tx, db, w, id) {
  const ref = qtRef(db, O.idOf(id, 'הצעה'));
  const snap = tx ? await tx.get(ref) : await ref.get();
  const d = access(w, snap.exists ? snap.data() : null);
  return { ref, snap, d };
}
const isMgr = (w) => w.role === 'manager';
const newReq = () => 'c' + crypto.randomBytes(15).toString('base64url'); // 21 תווים, תואם REQ_RE של orders.js

// =====================================================================================
// qtSave({ reqId, br?, cust, custId?, items, note?, disc?, days? }) → { id, no, vu, gross, total, dup }
// אותו ניקוי, תמחור והרשאה כמו createOrder (בלי ניוד – cell נדחה), בלי מלאי. reqId חוזר → אותה הצעה (dup:true).
// =====================================================================================
async function qtSave(request) {
  const w = await O.who(request);
  const input = inputObject(request);
  if (input.cell !== undefined) throw bad('qt-no-cell', 'הצעת מחיר לא כוללת ניוד קווים');
  O.onlyKeys(input, QT_KEYS);
  const reqId = O.reqIdOf(input);
  const br = O.brOf(w, input.br);
  const cust = O.cleanCust(input.cust);
  const raw = O.rawItems(input.items);
  const note = input.note == null ? '' : O.txt(input.note, 300, 'bad-note', 'הערה');
  const custId = input.custId == null || input.custId === '' ? '' : O.idOf(input.custId, 'לקוח');
  const disc = O.discIn(input.disc);
  const days = daysOf(input.days);
  const db = T.tdb();
  const ref = qtRef(db, 'q' + reqId);
  const seq = db.doc('ordcfg/seq_qt');
  const fh = await O.freeHits(db, w, raw, custId, null);
  const pids = raw.filter((x) => x.pid).map((x) => x.pid);
  let out = null;
  await db.runTransaction(async (tx) => {
    const [s, q, c, wb] = await tx.getAll(ref, seq, db.doc('ordcfg/main'), db.doc('ordcfg/wsb_' + reqId));
    if (s.exists) { const d = access(w, s.data()); out = { id: s.id, no: d.no, vu: d.vu, gross: d.gross, total: d.total, dup: true }; return; }
    if (wb.exists && wb.get('cust') !== custId) throw deny('ws-not-linked', 'מחיר הסיטונאי נטען ללקוח אחר. בחרו שוב את הלקוח');
    const prods = await O.loadProds(tx, db, pids);
    const costs = await O.loadCosts(tx, db, pids);
    const pc = await O.priceCtx(tx, db, custId, pids, c);
    if (pc.blk && !isMgr(w)) throw deny('cust-blocked', 'הלקוח חסום. רק מנהל יכול לפתוח לו הצעת מחיר');
    O.discOk(w, disc, pc);
    const pd = O.plain(prods);
    const { items } = O.resolveItems(w, br, raw, pd, null);
    for (const it of items) delete it.from; // סניף המקור נקבע רק בהמרה להזמנה
    O.freeCheck(raw, pc.vm === 'ex' ? fh : null, null);
    const pnotes = O.priceRun(w, items, raw, pc, pd, br, costs, null); // עובד מתחת למינימום → price-floor
    O.snapCosts(items, costs);
    O.cartons(items, pd, pc.biz, null, null);
    for (const it of items) if (it.pid && prods.get(it.pid).get('on') === false) throw pre('prod-off', `המוצר "${it.n}" לא זמין`);
    const total = O.totalOf(items);
    const no = (q.exists && typeof q.get('n') === 'number' ? q.get('n') : 0) + 1;
    const now = Date.now();
    const vu = vuOf(now, days);
    const doc = Object.assign({ no, br, cust, items, total, vm: pc.vm, vr: pc.vat }, O.sums(total, pc.vm, pc.vat, disc),
      { vu, st: 'open', cvReq: newReq(), by: w.uid, byName: w.name, at: now, upd: now });
    if (disc) doc.disc = disc;
    if (note) doc.note = note;
    if (custId) doc.custId = custId;
    tx.set(ref, doc);
    tx.set(seq, { n: no });
    tx.set(logRef(db, ref.id), O.logData(w, 'create', `₪${doc.gross} · בתוקף עד ${vu}${disc ? ` · הנחה ${disc}%` : ''}${pnotes.length ? ' · מחיר שונה: ' + pnotes.join('; ') : ''}`));
    out = { id: ref.id, no, vu, gross: doc.gross, total, dup: false };
  });
  return out;
}

// =====================================================================================
// qtSet({ id, act: 'cancel'|'req'|'ok' }) → { id, st, apr }
//   cancel – יוצר ההצעה או מנהל, רק הצעה פתוחה. req – עובד מבקש אישור מנהל. ok – מנהל בלבד.
//   req/ok חוזרים על עצמם בלי שינוי (לחיצה כפולה). כולם רק על הצעה פתוחה (st==='open').
// =====================================================================================
async function qtSet(request) {
  const w = await O.who(request);
  const input = inputObject(request);
  O.onlyKeys(input, ['id', 'act']);
  const id = O.idOf(input.id, 'הצעה');
  const act = input.act;
  if (!ACTS.includes(act)) throw bad('bad-act', 'פעולה לא מוכרת');
  if (act === 'ok' && !isMgr(w)) throw deny('manager-only', 'אישור הצעה – מנהל בלבד');
  if (act === 'req' && isMgr(w)) throw bad('mgr-self', 'מנהל מאשר בעצמו (act: ok)');
  const db = T.tdb();
  let out = null;
  await db.runTransaction(async (tx) => {
    const { ref, d } = await loadQt(tx, db, w, id);
    if (d.st !== 'open') throw pre('qt-closed', d.st === 'conv' ? 'ההצעה כבר הפכה להזמנה' : 'ההצעה בוטלה');
    const now = Date.now();
    const cur = d.apr && typeof d.apr === 'object' ? d.apr : null;
    if (act === 'cancel') {
      if (!isMgr(w) && d.by !== w.uid) throw deny('not-owner', 'רק מי שיצר את ההצעה או מנהל יכולים לבטל אותה');
      tx.update(ref, { st: 'cancel', cancel: { by: w.uid, at: now }, upd: now });
      tx.set(logRef(db, id), O.logData(w, 'cancel', ''));
      out = { id, st: 'cancel', apr: cur };
      return;
    }
    const want = act === 'ok' ? 'ok' : 'req';
    if (cur && (cur.st === want || cur.st === 'ok')) { out = { id, st: d.st, apr: cur }; return; } // כבר במצב הזה / כבר אושרה
    const apr = { st: want, by: w.uid, byName: w.name, at: now };
    tx.update(ref, { apr, upd: now });
    tx.set(logRef(db, id), O.logData(w, act, expired(d, now) ? 'פג תוקף' : ''));
    out = { id, st: d.st, apr };
  });
  return out;
}

// =====================================================================================
// qtConvert({ id }) → { id, st:'conv', ord:{id,no}, dup, why:[…] }   (משימה 2026-11-24, שלב 3)
//   הזמנה רגילה דרך createCore (אותה טרנזקציה: מספור, מלאי, עלות, קרטונים, חסום, מוצר כבוי) – במחירים השמורים בהצעה.
//   סדר: st==='open' ('conv' → אותה הזמנה, dup:true; 'cancel' → qt-closed) ← הנחה כללית: מנהל בלבד ← vm של הלקוח היום ≠ vm בהצעה → quote-vm
//        ← "דורש אישור" = פג תוקף ו/או מחיר שנכשל היום ב-AC.staffOk (priceRun של עובד, שורה-שורה, מול העלות/המחירון/המינימום של היום)
//          → עובד בלי apr.st==='ok' → quote-approval { why:[{t:'exp',vu} | {t:'floor',pid,n,min,why}] }; מנהל / עובד עם אישור – עובר
//        ← createCore(reqId: cvReq) ← רק אחרי הצלחה: st:'conv', ord:{id,no} + יומן בהצעה (conv) ובהזמנה (quote).
//   אידמפוטנטי: cvReq קבוע → לחיצה כפולה / שתי קריאות במקביל = הזמנה אחת (createCore מחזיר dup), וההצעה מסומנת פעם אחת (טרנזקציה).
//   כישלון ב-createCore → ההצעה נשארת 'open' (שום דבר לא נכתב). כישלון אחרי ההזמנה (נדיר) → קריאה חוזרת משלימה את הסימון (dup).
//   floorOk ל-createCore = true רק לעובד שההצעה אושרה לו בידי מנהל (נקבע כאן, לא מהקלט). מנהל – priceRun ממילא לא בודק מינימום.
// =====================================================================================
const STAFF = (w) => Object.assign({}, w, { role: 'staff' }); // לבדיקת "דורש אישור" גם כשהממיר מנהל (רק priceRun – לא נשמר)
function rawOf(items) {
  if (!Array.isArray(items) || !items.length) throw pre('qt-bad', 'ההצעה פגומה (אין פריטים)');
  return items.map((it) => {
    const o = { qty: it.qty, price: it.price };
    if (it.pid) o.pid = it.pid;
    else { o.n = it.n; if (typeof it.c === 'number') o.c = it.c; if (it.lb) o.lb = it.lb; }
    return o;
  });
}
// מצב היום: סוג הלקוח (vm) והשורות שמחירן נכשל מול המינימום של היום. קריאות רגילות (לא טרנזקציה) – createCore בודק שוב בטרנזקציה שלו.
async function today(db, w, d, raw, custId) {
  const pids = raw.filter((x) => x.pid).map((x) => x.pid);
  const [prods, costs, c] = await Promise.all([O.loadProds(db, db, pids), O.loadCosts(db, db, pids), db.doc('ordcfg/main').get()]);
  const pc = await O.priceCtx(db, db, custId, pids, c);
  const pd = O.plain(prods);
  const sw = STAFF(w);
  const fl = [];
  raw.forEach((x) => {
    if (!x.pid || !pd.get(x.pid)) return; // מוצר שנמחק – createCore ידחה (no-prod)
    const it = { pid: x.pid, n: String(pd.get(x.pid).name || '').slice(0, 80), qty: x.qty, price: x.price };
    try { O.priceRun(sw, [it], [x], pc, pd, d.br, costs, null); } catch (e) {
      const r = e && e.details && e.details.reason;
      if (r !== 'price-floor') throw e;
      fl.push({ t: 'floor', pid: x.pid, n: it.n, price: x.price, min: e.details.min == null ? null : e.details.min, why: e.details.why || '' });
    }
  });
  return { vm: pc.vm, bad: fl };
}
const whyTxt = (why) => why.map((x) => (x.t === 'exp' ? `פג תוקף (${x.vu})` : `"${x.n}" ₪${x.price} מתחת למינימום${x.min != null ? ` ₪${x.min}` : ''}`)).join('; ');
async function qtConvert(request) {
  const w = await O.who(request);
  const input = inputObject(request);
  O.onlyKeys(input, ['id']);
  const id = O.idOf(input.id, 'הצעה');
  const db = T.tdb();
  const { d } = await loadQt(null, db, w, id);
  const done = (q) => ({ id, st: 'conv', ord: q.ord, dup: true, why: [] });
  if (d.st === 'conv') return done(d);
  if (d.st !== 'open') throw pre('qt-closed', 'ההצעה בוטלה');
  if (typeof d.cvReq !== 'string' || !d.cvReq) throw pre('qt-bad', 'ההצעה פגומה');
  if (d.disc && !isMgr(w)) throw deny('manager-only', 'בהצעה יש הנחה כללית – רק מנהל יכול להפוך אותה להזמנה');
  const raw = rawOf(d.items);
  const custId = typeof d.custId === 'string' ? d.custId : '';
  const now = Date.now();
  const td = await today(db, w, d, raw, custId);
  if (td.vm !== d.vm) throw pre('quote-vm', 'סוג הלקוח השתנה (עסקי/פרטי) מאז ההצעה – צרו הצעה חדשה');
  const why = (expired(d, now) ? [{ t: 'exp', vu: d.vu }] : []).concat(td.bad);
  const apr = !!(d.apr && d.apr.st === 'ok');
  if (why.length && !isMgr(w) && !apr) {
    throw new HttpsError('failed-precondition', `ההצעה דורשת אישור מנהל: ${whyTxt(why)}`, { reason: 'quote-approval', why });
  }
  const r = await O.createCore(db, w, { reqId: d.cvReq, br: d.br, cust: d.cust, raw, note: typeof d.note === 'string' ? d.note : '', custId, input: {},
    disc: d.disc || undefined, src: 'staff', floorOk: apr && !isMgr(w) });
  let out = null;
  await db.runTransaction(async (tx) => {
    const { ref, d: q } = await loadQt(tx, db, w, id);
    if (q.st === 'conv') { out = done(q); return; } // קריאה מקבילה כבר סימנה
    const t = Date.now();
    tx.update(ref, { st: 'conv', ord: { id: r.id, no: r.no }, conv: { by: w.uid, at: t }, upd: t });
    tx.set(logRef(db, id), O.logData(w, 'conv', `הזמנה #${r.no}${q.st === 'cancel' ? ' · ההצעה בוטלה במקביל' : ''}${why.length ? ` · ${apr && !isMgr(w) ? 'באישור מנהל' : 'מנהל'}: ${whyTxt(why)}` : ''}`));
    tx.set(O.logRef(db, r.id), O.logData(w, 'quote', `נוצרה מהצעת מחיר #${q.no}`));
    out = { id, st: 'conv', ord: { id: r.id, no: r.no }, dup: false, why };
  });
  return out;
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`quotes: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code, msg: String(e && e.message).slice(0, 200) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { qtSave, qtSet, qtConvert }; // סבב ב: qtPdf, qtSend (quotes-pdf.js) – qtConvert כאן – ומיוצאים אוטומטית דרך index.js
const OPT = {}; // אפשרויות onCall לפי שם (למשל { qtSend: { secrets: [...], timeoutSeconds: 120 } })
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall(OPT[k] || {}, wrap(k, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: { qtSave, qtSet, qtConvert, rawOf, loadQt, access, expired, ilDay, addDays, vuOf, daysOf, qtRef, logRef, newReq, isMgr, QT_DAYS, DAYS_MAX, ACTS, QT_KEYS } });
