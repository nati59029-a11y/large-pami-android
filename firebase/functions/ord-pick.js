'use strict';
// 14.11.2026 (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, משוב בעל הפרויקט סעיף 6, החלטות 19–20): מסך טיפול/ליקוט.
// העובד מסמן לכל מוצר בהזמנה "יש במלאי" / "אין". "אין" → (1) להוריד, (2) מוצר דומה, (3) להזמין מספק.
// שינוי הפריטים עצמם (הורדה/החלפה, סכום, מלאי, מינימום מחיר) – רק דרך updateOrder הקיים (orders.js), כדי לא לשכפל את לוגיקת הכסף והמלאי.
// כאן: שמירת הסימונים, צילום ההזמנה לפני השינויים (לסיכום "לפני/אחרי"), רשימת "להזמין מספקים", ו"הלקוח אישר את השינויים".
//
// נתונים (תוספות בלבד, בלי מיגרציה; הזמנה ישנה בלי pk מתנהגת כמו קודם):
//   ord/{id}.pk = { st:'ok'|'chg', rq, l:[{ i, ok, act?:'rm'|'rep'|'ord', rep?:{pid,n}, so?, sup?, qty?, eta? }], sum:{ it:[{pid?,n,qty,price}], t, g? }, by, at, okBy?, okAt? }
//     i = מיקום השורה ב-sum.it (ההזמנה לפני השינויים). st 'chg' = יש שינויים שהלקוח עוד לא אישר; 'ok' = הכול במלאי או שהלקוח אישר.
//     כש-st === 'chg' השרת חוסם "נשלח" / "ממתין לתשלום" / "יצא למשלוח" / "הושלם" (setOrderStatus ב-orders.js). מנהל עוקף עם force:true.
//   supord/{ordId}_{reqId}_{i} = { ord, no, br, pid?, n, qty, sup, eta?, cust?, st:'open'|'ord'|'done'|'void', by, at, upd, sby? }
//     רשימה פנימית "להזמין מספקים" (לפי ספק). לא נשלח לספק ולא משנה מלאי. כשהסחורה מגיעה – "הכנסת מלאי" הקיים.
// סדר הקריאות מהמסך: orderPick (סימונים + צילום "לפני") ← updateOrder (רק כשיש הורדה/החלפה) ← orderPickOk (אחרי שיחה עם הלקוח).
// orderPick חוזר על עצמו בלי נזק עם אותו reqId: אם הפריטים עוד לא שונו – הסימונים מתעדכנים; אם כבר שונו – מוחזר applied:true ולא נוגעים.

const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const logger = require('firebase-functions/logger');
const T = require('./lib/tenant');
const { inputObject } = require('./lib/roles');
const C = require('./orders')._core; // who, idOf, reqIdOf, onlyKeys, txt, qtyOf, bad, deny, pre, NB

const OPEN = ['new', 'work', 'wait_pay']; // כמו PAYABLE ב-orders.js – אחרי "שולם" / ביטול / "נשלח" אין ליקוט
const ACTS = ['rm', 'rep', 'ord'];
const SO_ST = ['open', 'ord', 'done', 'void'];
const ETA_RE = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function access(w, d) {
  if (!d) throw new HttpsError('not-found', 'ההזמנה לא נמצאה', { reason: 'no-ord' });
  if (d.br && d.br !== C.NB && w.mine && !w.mine.includes(d.br)) throw C.deny('foreign-br', 'אין לך הרשאה להזמנה של סניף אחר');
}
function lockCheck(d) {
  if (!OPEN.includes(d.status)) throw C.pre('locked', d.status === 'cancel' ? 'ההזמנה בוטלה' : 'ההזמנה שולמה – אי אפשר לשנות מוצרים');
  if (d.shp) throw C.pre('locked', 'ההזמנה נשלחה – אי אפשר לשנות מוצרים. תיקון – בזיכוי');
}
const logRef = (db, id) => db.collection(`ord/${id}/log`).doc();
const logData = (w, act, note) => ({ t: Date.now(), by: w.uid, act, note: String(note || '').slice(0, 300) });
// צילום השורות לסיכום (בלי עלות ושדות פנימיים)
const snapIt = (items) => items.map((x) => Object.assign({ n: String(x.n || '').slice(0, 80), qty: x.qty, price: x.price }, x.pid ? { pid: x.pid } : {}));
const sameIt = (a, b) => JSON.stringify(snapIt(a || [])) === JSON.stringify(snapIt(b || []));

// סימון אחד מהמסך: { i, ok, act?, pid? (rep), sup?, qty?, eta? (ord) }
function markOf(m, n) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw C.bad('bad-pick', 'סימון לא תקין');
  C.onlyKeys(m, ['i', 'ok', 'act', 'pid', 'sup', 'qty', 'eta'], 'סימון');
  if (!Number.isInteger(m.i) || m.i < 0 || m.i >= n) throw C.bad('bad-pick', 'סימון לשורה שלא קיימת');
  if (m.ok === true) { if (m.act != null) throw C.bad('bad-pick', 'מוצר שיש במלאי – בלי פעולה'); return { i: m.i, ok: true }; }
  if (m.ok !== false) throw C.bad('bad-pick', 'סמנו לכל מוצר "יש" או "אין"');
  if (!ACTS.includes(m.act)) throw C.bad('no-act', 'מוצר שאין במלאי: בחרו להוריד, מוצר דומה או להזמין');
  const o = { i: m.i, ok: false, act: m.act };
  if (m.act === 'rep') o.pid = C.idOf(m.pid, 'מוצר חלופי');
  if (m.act === 'ord') {
    o.sup = C.txt(m.sup, 60, 'bad-sup', 'ספק');
    o.qty = C.qtyOf(m.qty);
    if (m.eta != null && m.eta !== '') {
      if (typeof m.eta !== 'string' || !ETA_RE.test(m.eta) || isNaN(Date.parse(m.eta + 'T00:00:00Z'))) throw C.bad('bad-eta', 'תאריך צפי לא תקין');
      o.eta = m.eta;
    }
  }
  return o;
}

// orderPick({ id, reqId, l:[סימון לכל שורה] }) → { ok, st, applied, so:[מזהי supord] }
async function orderPick(request) {
  const w = await C.who(request);
  const input = inputObject(request);
  C.onlyKeys(input, ['id', 'reqId', 'l']);
  const id = C.idOf(input.id, 'הזמנה');
  const reqId = C.reqIdOf(input);
  if (!Array.isArray(input.l) || !input.l.length || input.l.length > 50) throw C.bad('bad-pick', 'סימונים חסרים');
  const db = T.tdb();
  const ref = db.doc('ord/' + id);
  let res = null;
  await db.runTransaction(async (tx) => {
    res = null;
    const s = await tx.get(ref);
    access(w, s.exists ? s.data() : null);
    const d = s.data();
    const items = Array.isArray(d.items) ? d.items : [];
    const old = d.pk && typeof d.pk === 'object' ? d.pk : null;
    const again = !!(old && old.rq === reqId);
    // אותו reqId והפריטים כבר שונו (updateOrder הצליח) – לא נוגעים, רק מחזירים
    if (again && old.sum && !sameIt(old.sum.it, items)) { res = { ok: true, st: old.st, applied: true, dup: true, so: (old.l || []).filter((x) => x.so).map((x) => x.so) }; return; }
    lockCheck(d);
    const base = again && old.sum ? old.sum.it : snapIt(items); // צילום "לפני": מהקריאה הראשונה עם ה-reqId הזה
    const L = input.l.map((m) => markOf(m, base.length));
    if (new Set(L.map((x) => x.i)).size !== L.length || L.length !== base.length) throw C.bad('bad-pick', 'צריך סימון אחד לכל מוצר בהזמנה');
    L.sort((a, b) => a.i - b.i);
    if (L.every((x) => x.act === 'rm')) throw C.bad('all-rm', 'כל המוצרים מסומנים להורדה. לביטול ההזמנה – "ביטול הזמנה"');
    // מוצרים: החלופי (חייב להיות קיים וזמין) והמקורי (ספק ברירת מחדל – prod.sup)
    const pids = [...new Set(L.filter((x) => x.pid).map((x) => x.pid).concat(L.filter((x) => x.act === 'ord' && base[x.i].pid).map((x) => base[x.i].pid)))];
    const ps = pids.length ? await tx.getAll(...pids.map((p) => db.doc('prod/' + p))) : [];
    const P = new Map(ps.filter((x) => x.exists).map((x) => [x.id, x.data()]));
    const now = Date.now();
    const so = [], out = [];
    for (const x of L) {
      const o = { i: x.i, ok: x.ok };
      if (x.act) o.act = x.act;
      if (x.act === 'rep') {
        const p = P.get(x.pid);
        if (!p) throw new HttpsError('not-found', 'המוצר החלופי לא נמצא', { reason: 'no-prod' });
        if (p.on === false) throw C.pre('prod-off', `המוצר "${String(p.name || '')}" לא זמין`);
        o.rep = { pid: x.pid, n: String(p.name || '').slice(0, 80) };
      }
      if (x.act === 'ord') {
        const it = base[x.i];
        const p = it.pid ? P.get(it.pid) : null;
        const sup = x.sup || (p && typeof p.sup === 'string' ? C.txt(p.sup, 60, 'bad-sup', 'ספק') : '');
        if (!sup) throw C.bad('no-sup', `"${it.n}": חסר ספק – כתבו את שם הספק`);
        const sid = `${id}_${reqId}_${x.i}`;
        const doc = Object.assign({ ord: id, no: d.no, br: d.br || C.NB, n: it.n, qty: x.qty, sup, st: 'open', by: w.uid, at: now, upd: now },
          it.pid ? { pid: it.pid } : {}, x.eta ? { eta: x.eta } : {}, d.cust && typeof d.cust.name === 'string' ? { cust: d.cust.name.slice(0, 60) } : {});
        tx.set(db.doc('supord/' + sid), doc);
        Object.assign(o, { so: sid, sup, qty: x.qty }, x.eta ? { eta: x.eta } : {}); so.push(sid); // לסיכום במסך (העותק המלא ב-supord)
      }
      out.push(o);
    }
    // אותו reqId שוב (לפני שהפריטים שונו): שורה שכבר לא "להזמין" – הרשומה שלה מסומנת void (לא נמחקת)
    if (again) for (const x of old.l || []) if (x.so && !so.includes(x.so)) tx.set(db.doc('supord/' + x.so), { st: 'void', upd: now, sby: w.uid }, { merge: true });
    const st = out.every((x) => x.ok) ? 'ok' : 'chg';
    const pk = { st, rq: reqId, l: out, sum: Object.assign({ it: base, t: again && old.sum ? old.sum.t : d.total }, again && old.sum ? (typeof old.sum.g === 'number' ? { g: old.sum.g } : {}) : (d.vm && typeof d.gross === 'number' ? { g: d.gross } : {})), by: w.uid, at: now };
    tx.update(ref, { pk, upd: now });
    const cnt = (a) => out.filter((x) => x.act === a).length;
    tx.set(logRef(db, id), logData(w, 'pick', st === 'ok' ? 'הכול במלאי' : [`${out.filter((x) => x.ok).length} במלאי`, cnt('rm') && `${cnt('rm')} להוריד`, cnt('rep') && `${cnt('rep')} מוצר דומה`, cnt('ord') && `${cnt('ord')} להזמין מספק`].filter(Boolean).join(' · ')));
    res = { ok: true, st, applied: false, so };
  });
  return res;
}

// orderPickOk({ id }) – "הלקוח אישר את השינויים". עובד עם ord בסניף או מנהל.
async function orderPickOk(request) {
  const w = await C.who(request);
  const input = inputObject(request);
  C.onlyKeys(input, ['id']);
  const id = C.idOf(input.id, 'הזמנה');
  const db = T.tdb();
  const ref = db.doc('ord/' + id);
  let res = null;
  await db.runTransaction(async (tx) => {
    res = null;
    const s = await tx.get(ref);
    access(w, s.exists ? s.data() : null);
    const pk = s.get('pk');
    if (!pk || typeof pk !== 'object') throw C.pre('no-pick', 'אין בהזמנה סימוני ליקוט');
    if (pk.st === 'ok') { res = { ok: true, dup: true }; return; }
    if (s.get('status') === 'cancel') throw C.pre('locked', 'ההזמנה בוטלה');
    const now = Date.now();
    tx.update(ref, { 'pk.st': 'ok', 'pk.okBy': w.uid, 'pk.okAt': now, upd: now });
    tx.set(logRef(db, id), logData(w, 'pickok', ''));
    res = { ok: true, dup: false };
  });
  return res;
}

// supOrdSet({ id, st }) – "להזמין מספקים": open (להזמין) → ord (הוזמן) → done (הגיע); void = לא צריך. לא משנה מלאי.
async function supOrdSet(request) {
  const w = await C.who(request);
  const input = inputObject(request);
  C.onlyKeys(input, ['id', 'st']);
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{1,130}$/.test(input.id)) throw C.bad('bad-id', 'מזהה לא תקין');
  if (!SO_ST.includes(input.st)) throw C.bad('bad-status', 'סטטוס לא מוכר');
  const db = T.tdb();
  const ref = db.doc('supord/' + input.id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'השורה לא נמצאה', { reason: 'no-supord' });
    access(w, { br: s.get('br') });
    if (s.get('st') === input.st) return;
    tx.update(ref, { st: input.st, upd: Date.now(), sby: w.uid });
  });
  return { ok: true };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`ord-pick: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code, msg: String(e && e.message).slice(0, 200) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { orderPick, orderPickOk, supOrdSet };
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall({}, wrap(k, f));
