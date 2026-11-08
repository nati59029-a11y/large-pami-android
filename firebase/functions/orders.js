'use strict';
// מערכת הזמנות – שלב 1 (משימה 2026-11-08_בוט-הזמנות): עובד מכניס הזמנות + מלאי לכל סניף + תשלום ידני.
// כל הנתיבים תחת b/{bizId}/ (או בשורש ללארג' פעמי במצב legacy – T.tdb()). כל כתיבה רק כאן; מהאפליקציה – קריאה לפי החוקים.
//
//   prod/{id}          { name, price, barcode, on, q: { <br>|'_': כמות }, at, by, upd }   – מוצר + כמות לכל סניף ('_' = עסק בלי סניפים)
//   prod/{id}/p/cost   { cost }                                                     – עלות, מנהל בלבד
//   prod/{id}/p/ws     { wp }                                                       – מחיר סיטונאי (אחד לעסק). נקרא רק דרך getWsPrices (ראו WS_SHOW)
//   prod/{id}          + { cat?, sub?, bp?: { <br>: מחיר }, pk?, ct?, home? }       – fb/ord-catalog, תוספתי: מוצר ישן בלי השדות עובד כמו קודם
//   cat/{id}           { name, parent?, ord, upd }                                  – קטגוריה (parent ריק) / תת־קטגוריה. מנהל, דרך saveCat
//   xfer/{id}          { prod, name, from, to, qty, why:'order'|'cancel'|'edit'|'manual', ord?, no?, by, at, reqId }  – העברה פנימית בין סניפים
//   stockLog/{id}      { prod, name, br, delta, why, ord?, no?, by, at }             – כל תנועת מלאי. why: in/set/zero/order/xout/xin/cancel/edit
//   ord/{id}           { no, src:'staff', br, cust, items:[{pid?,n,qty,price,from?}], total, status, paid?, calledAt?, by, byName, at, upd, cancel? }
//   ord/{id}/log/{k}   { t, by, act, note }
//   ordcfg/main        { pay: { mode: 'link'|'phone', has }, src: { <br>: 'stock' | <br> }, upd }   – הקישור עצמו לא כאן
//   ordcfg/seq         { n }                                                        – מספור רץ לכל עסק
//   private/pay        { link, mode, at, by }                                       – רק השרת (setBusinessPayLink, מנהל־על)
//
// מלאי בין סניפים (החלטת המשתמש 16:39, אפשרות ב): הזמנה בסניף A, שורה שמקורה בסניף B → ב-B יורד (xout), ב-A העברה נכנסת (xin)
// ומיד יוצאת ללקוח (order). מקור לכל שורה: ordcfg/main.src[A] = 'stock' (העובד בוחר, ברירת מחדל = הסניף שיש בו) או מזהה סניף קבוע.
// אין מספיק במלאי → ההזמנה נשמרת, הכמות יכולה לרדת מתחת לאפס, ומוחזרת אזהרה (תשובה 5). ביטול מחזיר את כל התנועות של ההזמנה.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const T = require('./lib/tenant');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');

const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });
const deny = (reason, message) => new HttpsError('permission-denied', message, { reason });
const pre = (reason, message) => new HttpsError('failed-precondition', message, { reason });

const NB = '_'; // מפתח הכמות בעסק בלי סניפים
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const REQ_RE = /^[A-Za-z0-9_-]{8,40}$/;
const BR_RE = /^[a-z0-9_]{2,20}$/;
const STATUSES = ['new', 'work', 'wait_pay', 'paid', 'out', 'done', 'cancel'];
// מעברים ב-setOrderStatus. 'paid' רק דרך markOrderPaid, 'cancel' רק דרך cancelOrder, ביטול "שולם" רק unpayOrder (מנהל).
const NEXT = { new: ['work', 'wait_pay'], work: ['wait_pay', 'new'], wait_pay: ['work'], paid: ['out', 'done'], out: ['done'], done: [], cancel: [] };
const PAYABLE = ['new', 'work', 'wait_pay'];
const PAY_METHODS = ['link', 'phone', 'cash', 'transfer', 'other'];
const MAX_ITEMS = 50;
const MAX_IMPORT = 200;
// מי רואה מחיר סיטונאי (החלטת המשתמש 22:07): 'wsCust' = מנהל תמיד; עובד עם ord – רק ללקוח שמסומן wholesale.
// אפשרויות נוספות לשינוי מהיר: 'mgr' (מנהל בלבד), 'ord' (כל עובד עם הרשאת הזמנות).
const WS_SHOW = 'wsCust';

// ---------- ניקוי קלט ----------
function txt(v, max, reason, label, required) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : (v == null ? '' : null);
  if (s === null) throw bad(reason, label + ' לא תקין');
  if (required && !s) throw bad(reason, label + ' – חובה');
  if (s.length > max) throw bad(reason, `${label} – עד ${max} תווים`);
  // הגנה מפני הקלדת מספר כרטיס בשדה טקסט (תקן PCI): 8 ספרות ומעלה ברצף (גם עם רווחים/מקפים ביניהן) – נדחה
  if (/\d{8,}/.test(s.replace(/[\s._\/\\,:;|·'"`~*#+-]/g, '')) && reason !== 'bad-phone') throw bad('card-like', `${label}: אסור להקליד מספר כרטיס אשראי או מספר ארוך. מותר רק 4 ספרות אחרונות.`);
  return s;
}
function phone(raw) {
  let p = String(raw == null ? '' : raw).trim().replace(/[\s-]/g, '');
  if (/^\+?972\d{8,9}$/.test(p)) p = '0' + p.replace(/^\+?972/, '');
  if (!/^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p)) throw bad('bad-phone', 'מספר הטלפון לא תקין');
  return p;
}
function money(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000000) throw bad('bad-price', label + ': מספר בין 0 ל-1,000,000');
  return Math.round(v * 100) / 100;
}
function qtyOf(v, allowZero, allowNeg) {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 100000) throw bad('bad-qty', 'כמות לא תקינה');
  const q = Math.round(v * 1000) / 1000;
  if (!allowNeg && q < 0) throw bad('bad-qty', 'כמות לא תקינה');
  if (!allowZero && q === 0) throw bad('bad-qty', 'כמות חייבת להיות גדולה מ-0');
  return q;
}
const agor = (x) => Math.round(x * 100);
const r3 = (x) => Math.round(x * 1000) / 1000;
function reqIdOf(input) {
  const r = input.reqId;
  if (typeof r !== 'string' || !REQ_RE.test(r)) throw bad('bad-req', 'מזהה בקשה חסר (reqId)');
  return r;
}
function idOf(v, label) {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw bad('bad-id', (label || 'מזהה') + ' לא תקין');
  return v;
}
function onlyKeys(o, keys, label) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw bad('bad-field', `שדה לא מוכר${label ? ' ב' + label : ''}: ` + String(k).slice(0, 30));
}

// ---------- הרשאות וסניפים ----------
async function who(request) {
  const w = await requireStaff(request, { feature: 'orders' });
  if (!hasPerm(w, 'ord')) throw deny('no-perm', 'אין לך הרשאה להזמנות. פנה למנהל.');
  const bd = w.biz.exists ? await getFirestore().doc('b/' + w.bizId).get() : null;
  const org = bd && bd.exists && bd.get('org') && typeof bd.get('org') === 'object' ? bd.get('org') : {};
  w.branches = (Array.isArray(org.branches) ? org.branches : []).filter((b) => b && typeof b.id === 'string');
  w.activeBr = w.branches.filter((b) => b.on !== false).map((b) => b.id);
  const mine = w.role === 'manager' ? null : (w.staff && Array.isArray(w.staff.get('br')) ? w.staff.get('br') : null);
  w.mine = mine; // null = כל הסניפים
  w.name = (w.staff && typeof w.staff.get === 'function' && typeof w.staff.get('name') === 'string' ? w.staff.get('name') : '').slice(0, 60);
  return w;
}
const hasBranches = (w) => w.branches.length > 0;
const canBr = (w, br) => !w.mine || w.mine.includes(br);
// סניף ההזמנה/פעולת המלאי: עסק בלי סניפים = NB. יש סניפים: חובה, פעיל, ומשויך לעובד.
function brOf(w, v, label) {
  if (!hasBranches(w)) {
    if (v != null && v !== '' && v !== NB) throw bad('bad-br', 'בעסק אין סניפים');
    return NB;
  }
  if (typeof v !== 'string' || !BR_RE.test(v) || !w.activeBr.includes(v)) throw bad('bad-br', (label || 'סניף') + ': בחרו סניף פעיל');
  if (!canBr(w, v)) throw deny('foreign-br', 'אין לך הרשאה לסניף הזה');
  return v;
}
function mgr(w) { if (w.role !== 'manager') throw deny('manager-only', 'הפעולה מותרת למנהל בלבד'); }

function logRef(db, ordId) { return db.collection(`ord/${ordId}/log`).doc(); }
function logData(w, act, note) { return { t: Date.now(), by: w.uid, act, note: String(note || '').slice(0, 300) }; }
function stockRef(db) { return db.collection('stockLog').doc(); }
const qOf = (p, br) => { const q = p && p.q && typeof p.q === 'object' ? p.q[br] : 0; return typeof q === 'number' ? q : 0; };

// =====================================================================================
// מוצרים ומלאי
// =====================================================================================
// שדות הקטלוג (fb/ord-catalog). רק מה שנשלח נכתב; '' / null בשדה טקסט = מחיקה מהמוצר (FieldValue.delete בעדכון).
const FV = () => require('firebase-admin/firestore').FieldValue;
function prodExt(w, input) {
  const o = {};
  for (const k of ['cat', 'sub']) {
    if (input[k] === undefined) continue;
    if (input[k] === null || input[k] === '') o[k] = FV().delete();
    else o[k] = idOf(input[k], 'קטגוריה');
  }
  if (input.bp !== undefined) {
    const bp = input.bp;
    if (bp !== null && (typeof bp !== 'object' || Array.isArray(bp))) throw bad('bad-bp', 'מחיר לסניף לא תקין');
    const m = {};
    for (const [br, v] of Object.entries(bp || {})) {
      if (!w.branches.some((b) => b.id === br)) throw bad('bad-bp', 'מחיר לסניף: סניף לא קיים');
      if (v === null || v === '') continue;
      m[br] = money(v, 'מחיר לסניף');
    }
    o.bp = m;
  }
  for (const [k, l] of [['pk', 'כמות במארז'], ['ct', 'כמות בקרטון']]) {
    if (input[k] === undefined) continue;
    if (input[k] === null || input[k] === '' || input[k] === 0) { o[k] = FV().delete(); continue; }
    o[k] = qtyOf(input[k]);
    if (!Number.isInteger(o[k])) throw bad('bad-qty', l + ': מספר שלם');
  }
  if (input.home !== undefined) {
    if (input.home === null || input.home === '') o.home = FV().delete();
    else if (typeof input.home !== 'string' || !w.branches.some((b) => b.id === input.home)) throw bad('bad-br', 'סניף בית לא קיים');
    else o.home = input.home;
  }
  return o;
}
const noDel = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => !(v && v.constructor && /Delete/.test(v.constructor.name))));
// saveProduct({ id?, name, price, barcode?, on?, cost?, br?, qty? }) – מוצר חדש: מנהל או עובד עם ord (עם כמות פתיחה לסניף).
// עריכת מוצר קיים (שם/מחיר/ברקוד/זמין) – מנהל או עובד עם ord (החלטה 18:56), נרשם ב-stockLog (why:'prod', delta 0). עלות – מנהל בלבד.
async function saveProduct(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'name', 'price', 'barcode', 'on', 'cost', 'br', 'qty', 'reqId', 'cat', 'sub', 'bp', 'wp', 'pk', 'ct', 'home']);
  const name = txt(input.name, 60, 'bad-name', 'שם המוצר', true);
  const price = money(input.price, 'מחיר');
  const barcode = input.barcode == null || input.barcode === '' ? '' : String(input.barcode).trim();
  if (barcode && !/^[0-9A-Za-z-]{3,30}$/.test(barcode)) throw bad('bad-barcode', 'ברקוד: ספרות/אותיות, 3 עד 30');
  if (input.on !== undefined && typeof input.on !== 'boolean') throw bad('bad-field', 'זמין חייב להיות כן/לא');
  if (input.cost !== undefined && input.cost !== null) { mgr(w); money(input.cost, 'עלות'); }
  if (input.wp !== undefined && input.wp !== null) { mgr(w); money(input.wp, 'מחיר סיטונאי'); }
  const ext = prodExt(w, input);
  const db = T.tdb();
  const now = Date.now();
  if (input.id != null) {
    const id = idOf(input.id, 'מוצר');
    const ref = db.doc('prod/' + id);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw new HttpsError('not-found', 'המוצר לא נמצא', { reason: 'no-prod' });
      const o = s.data() || {};
      const ch = [];
      if (o.name !== name) ch.push(`שם: ${String(o.name || '').slice(0, 60)} → ${name}`);
      if (o.price !== price) ch.push(`מחיר: ₪${o.price} → ₪${price}`);
      if ((o.barcode || '') !== barcode) ch.push('ברקוד');
      if ((o.on !== false) !== (input.on !== false)) ch.push(input.on === false ? 'לא זמין' : 'זמין');
      if (ext.bp && JSON.stringify(ext.bp) !== JSON.stringify(o.bp || {})) ch.push('מחיר לסניף');
      tx.update(ref, Object.assign({ name, price, barcode, on: input.on !== false, upd: now }, ext));
      if (input.wp != null) tx.set(db.doc(`prod/${id}/p/ws`), { wp: money(input.wp, 'מחיר סיטונאי'), at: now, by: w.uid });
      if (ch.length) tx.set(stockRef(db), { prod: id, name, br: NB, delta: 0, why: 'prod', note: ch.join('; ').slice(0, 300), by: w.uid, at: now });
      if (input.cost != null) tx.set(db.doc(`prod/${id}/p/cost`), { cost: money(input.cost, 'עלות'), at: now, by: w.uid });
    });
    return { ok: true, id };
  }
  const reqId = reqIdOf(input);
  const br = input.qty ? brOf(w, input.br) : (hasBranches(w) ? (input.br ? brOf(w, input.br) : null) : NB);
  const qty = input.qty == null ? 0 : qtyOf(input.qty, true);
  const id = 'p' + reqId;
  const ref = db.doc('prod/' + id);
  let dup = false;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) { dup = true; return; }
    const q = {};
    if (br && qty) q[br] = qty;
    tx.set(ref, Object.assign({ name, price, barcode, on: input.on !== false, q, at: now, by: w.uid, upd: now }, noDel(ext)));
    if (input.wp != null) tx.set(db.doc(`prod/${id}/p/ws`), { wp: money(input.wp, 'מחיר סיטונאי'), at: now, by: w.uid });
    if (input.cost != null) tx.set(db.doc(`prod/${id}/p/cost`), { cost: money(input.cost, 'עלות'), at: now, by: w.uid });
    if (br && qty) tx.set(stockRef(db), { prod: id, name, br, delta: qty, why: 'in', by: w.uid, at: now });
  });
  return { ok: true, id, dup };
}

// stockIn({ br, lines:[{pid, qty}], reqId }) – הכנסת מלאי (הוספת כמות), כמה שורות בבת אחת. מנהל או עובד עם ord בסניף שלו.
async function stockIn(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['br', 'lines', 'reqId']);
  const reqId = reqIdOf(input);
  const br = brOf(w, input.br);
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > MAX_ITEMS) throw bad('bad-lines', `שורות: 1 עד ${MAX_ITEMS}`);
  const sum = new Map();
  for (const l of input.lines) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw bad('bad-lines', 'שורה לא תקינה');
    onlyKeys(l, ['pid', 'qty'], 'שורה');
    const pid = idOf(l.pid, 'מוצר');
    sum.set(pid, r3((sum.get(pid) || 0) + qtyOf(l.qty)));
  }
  const db = T.tdb();
  const mark = db.doc('ordcfg/req_' + reqId);
  const now = Date.now();
  const out = {};
  let dup = false;
  await db.runTransaction(async (tx) => {
    const m = await tx.get(mark);
    if (m.exists) { dup = true; return; }
    const refs = [...sum.keys()].map((pid) => db.doc('prod/' + pid));
    const snaps = await tx.getAll(...refs);
    snaps.forEach((s) => { if (!s.exists) throw new HttpsError('not-found', 'מוצר לא נמצא', { reason: 'no-prod' }); });
    snaps.forEach((s) => {
      const d = sum.get(s.id);
      const nq = r3(qOf(s.data(), br) + d);
      tx.update(s.ref, new FieldPath('q', br), nq, 'upd', now);
      tx.set(stockRef(db), { prod: s.id, name: s.get('name') || '', br, delta: d, why: 'in', by: w.uid, at: now });
      out[s.id] = nq;
    });
    tx.set(mark, { t: now, by: w.uid, k: 'stockIn' });
  });
  return { ok: true, dup, q: out };
}

// stockSet({ pid, br, qty, reqId }) – qty = 0: "נגמר במלאי" (מנהל או עובד עם ord). כל ערך אחר – תיקון, מנהל בלבד.
async function stockSet(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['pid', 'br', 'qty', 'reqId']);
  const reqId = reqIdOf(input);
  const pid = idOf(input.pid, 'מוצר');
  const br = brOf(w, input.br);
  const qty = qtyOf(input.qty, true, true);
  if (qty !== 0) mgr(w);
  const db = T.tdb();
  const ref = db.doc('prod/' + pid);
  const mark = db.doc('ordcfg/req_' + reqId);
  const now = Date.now();
  let res = null;
  await db.runTransaction(async (tx) => {
    const [m, s] = await tx.getAll(mark, ref);
    if (m.exists) { res = { ok: true, dup: true }; return; }
    if (!s.exists) throw new HttpsError('not-found', 'המוצר לא נמצא', { reason: 'no-prod' });
    const old = qOf(s.data(), br);
    const delta = r3(qty - old);
    tx.update(ref, new FieldPath('q', br), qty, 'upd', now);
    if (delta !== 0) tx.set(stockRef(db), { prod: pid, name: s.get('name') || '', br, delta, why: qty === 0 ? 'zero' : 'set', by: w.uid, at: now });
    tx.set(mark, { t: now, by: w.uid, k: 'stockSet' });
    res = { ok: true, dup: false, q: qty, delta };
  });
  return res;
}

// =====================================================================================
// הזמנות
// =====================================================================================
function cleanCust(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('bad-cust', 'פרטי לקוח חסרים');
  onlyKeys(c, ['name', 'phone', 'tz', 'addr', 'mail'], 'פרטי לקוח');
  const o = { name: txt(c.name, 60, 'bad-name', 'שם הלקוח', true), phone: phone(c.phone) };
  if (c.tz != null && c.tz !== '') {
    const tz = String(c.tz).replace(/\D/g, '');
    if (!/^\d{5,9}$/.test(tz)) throw bad('bad-tz', 'ת.ז: 5 עד 9 ספרות');
    o.tz = tz.padStart(9, '0');
  }
  if (c.addr != null && c.addr !== '') o.addr = txt(c.addr, 150, 'bad-addr', 'כתובת');
  if (c.mail != null && c.mail !== '') {
    const m = String(c.mail).trim().toLowerCase();
    if (m.length > 254 || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(m)) throw bad('bad-email', 'כתובת המייל לא תקינה');
    if (/\d{8,}/.test(m.replace(/[\s._\/\\,:;|·'"`~*#+-]/g, ''))) throw bad('card-like', 'מייל: אסור רצף של 8 ספרות ומעלה (מספר כרטיס).');
    o.mail = m;
  }
  return o;
}
// שורות מהלקוח: { pid?, n?, qty, price, from? }. השם של שורת מוצר נלקח מהמוצר; המחיר – מה שנשלח (העובד רשאי לשנות, תשובה 4).
function rawItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) throw bad('bad-items', `פריטים: 1 עד ${MAX_ITEMS}`);
  return items.map((it) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) throw bad('bad-items', 'פריט לא תקין');
    onlyKeys(it, ['pid', 'n', 'qty', 'price', 'from'], 'פריט');
    const o = { qty: qtyOf(it.qty) };
    if (it.pid != null && it.pid !== '') o.pid = idOf(it.pid, 'מוצר');
    else o.n = txt(it.n, 80, 'bad-items', 'שם הפריט', true);
    // מחיר: מה שהעובד שלח (רשאי לשנות, תשובה 4). בשורת מוצר בלי מחיר – השרת לוקח את מחיר הסניף (bp[br] ?? price)
    if (it.price != null || !o.pid) o.price = money(it.price, 'מחיר');
    if (it.from != null && it.from !== '') {
      if (typeof it.from !== 'string' || !BR_RE.test(it.from)) throw bad('bad-from', 'סניף מקור לא תקין');
      o.from = it.from;
    }
    return o;
  });
}
// מחיר המוצר בסניף: bp[br] אם הוגדר, אחרת מחיר הבסיס (מוצר ישן בלי bp – בדיוק כמו קודם)
const brPrice = (p, br) => (p && p.bp && typeof p.bp === 'object' && typeof p.bp[br] === 'number' ? p.bp[br] : (typeof (p && p.price) === 'number' ? p.price : 0));
const totalOf = (items) => items.reduce((s, it) => s + Math.round(it.qty * it.price * 100), 0) / 100;

// קובע את סניף המקור לכל שורת מוצר ומחזיר את השורות הסופיות + שינויי המלאי.
// cfgSrc = ordcfg/main.src[br]: 'stock' (ברירת מחדל) או מזהה סניף קבוע (גובר על מה שנשלח).
function resolveItems(w, br, raw, prods, cfgSrc) {
  const fixed = hasBranches(w) && cfgSrc && cfgSrc !== 'stock' && w.activeBr.includes(cfgSrc) ? cfgSrc : null;
  const warn = [];
  const items = raw.map((it) => {
    if (!it.pid) { const o = { n: it.n, qty: it.qty, price: it.price }; return o; }
    if (!prods.get(it.pid)) throw new HttpsError('not-found', 'מוצר לא נמצא', { reason: 'no-prod' });
    const p = prods.get(it.pid);
    if (!p) throw new HttpsError('not-found', 'מוצר לא נמצא', { reason: 'no-prod' });
    let from = br;
    if (hasBranches(w)) {
      if (fixed) from = fixed;
      else if (it.from) {
        if (!w.activeBr.includes(it.from)) throw bad('bad-from', 'סניף מקור לא פעיל');
        from = it.from;
      } else if (qOf(p, br) < it.qty) {
        // "לפי המלאי": מוצע הסניף שיש בו מספיק (קודם הסניף של ההזמנה), אחרת זה שיש בו הכי הרבה
        const cand = w.activeBr.filter((b) => qOf(p, b) >= it.qty);
        from = cand.length ? cand[0] : w.activeBr.reduce((a, b) => (qOf(p, b) > qOf(p, a) ? b : a), br);
      }
    }
    const o = { pid: it.pid, n: String(p.name || '').slice(0, 80), qty: it.qty, price: it.price != null ? it.price : brPrice(p, br) };
    if (from !== br) o.from = from;
    return o;
  });
  return { items, warn, fixed };
}
// תנועות מלאי של שורות: מפה "pid|br" → delta (שלילי = יורד). שורה מסניף אחר: from -qty, br +qty (xin) -qty (order).
function moves(br, items) {
  const m = [];
  for (const it of items) {
    if (!it.pid) continue;
    if (it.from && it.from !== br) {
      m.push({ pid: it.pid, br: it.from, delta: -it.qty, why: 'xout', to: br });
      m.push({ pid: it.pid, br, delta: it.qty, why: 'xin', fromBr: it.from });
      m.push({ pid: it.pid, br, delta: -it.qty, why: 'order' });
    } else m.push({ pid: it.pid, br, delta: -it.qty, why: 'order' });
  }
  return m;
}
function applyMoves(tx, db, w, prodSnaps, mv, extra, warnings) {
  const cur = new Map(); // pid → {q}
  for (const [pid, s] of prodSnaps) cur.set(pid, Object.assign({}, (s.data() || {}).q || {}));
  const now = Date.now();
  for (const x of mv) {
    const q = cur.get(x.pid);
    q[x.br] = r3((typeof q[x.br] === 'number' ? q[x.br] : 0) + x.delta);
    const rec = { prod: x.pid, name: (prodSnaps.get(x.pid).get('name') || '').slice(0, 80), br: x.br, delta: r3(x.delta), why: x.why, by: w.uid, at: now };
    if (x.to) rec.to = x.to;
    if (x.fromBr) rec.from = x.fromBr;
    tx.set(stockRef(db), Object.assign(rec, extra));
    // העברה פנימית: רשומת xfer אחת לכל שורה מסניף אחר (צד המקור). בהיפוך (ביטול/עריכה) הכיוון מתהפך.
    if (x.to) {
      const back = x.delta > 0;
      tx.set(db.collection('xfer').doc(), Object.assign({ prod: x.pid, name: rec.name, from: back ? x.to : x.br, to: back ? x.br : x.to, qty: r3(Math.abs(x.delta)),
        why: x.why === 'xout' ? 'order' : x.why, by: w.uid, at: now }, extra.ord ? { ord: extra.ord, no: extra.no } : {}));
    }
  }
  for (const [pid, q] of cur) {
    const s = prodSnaps.get(pid);
    const old = (s.data() || {}).q || {};
    const changed = Object.keys(q).filter((k) => q[k] !== old[k]);
    if (!changed.length) continue;
    const args = [];
    for (const k of changed) { args.push(new FieldPath('q', k), q[k]); if (q[k] < 0 && warnings) warnings.push({ pid, br: k, q: q[k], n: s.get('name') || '' }); }
    args.push('upd', now);
    tx.update(s.ref, ...args);
  }
}
// היפוך: כל התנועות שנשלחו נגד (ביטול / עריכה)
const invert = (mv, why) => mv.map((x) => Object.assign({}, x, { delta: -x.delta, why: why || 'cancel' }));

async function loadProds(tx, db, pids) {
  const ids = [...new Set(pids)];
  const m = new Map();
  if (!ids.length) return m;
  const snaps = await tx.getAll(...ids.map((id) => db.doc('prod/' + id)));
  for (const s of snaps) if (s.exists) m.set(s.id, s);
  return m;
}
const plain = (prods) => new Map([...prods].map(([k, s]) => [k, s.data()]));

function ordAccess(w, d) {
  if (!d) throw new HttpsError('not-found', 'ההזמנה לא נמצאה', { reason: 'no-ord' });
  if (d.br && d.br !== NB && !canBr(w, d.br)) throw deny('foreign-br', 'אין לך הרשאה להזמנה של סניף אחר');
}

// createOrder({ reqId, br?, cust, items, note? }) → { id, no, total, warn: [{pid, br, q, n}] }
async function createOrder(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['reqId', 'br', 'cust', 'items', 'note', 'total']); // total נשלח? מתעלמים – השרת מחשב
  const reqId = reqIdOf(input);
  const br = brOf(w, input.br);
  const cust = cleanCust(input.cust);
  const raw = rawItems(input.items);
  const note = input.note == null ? '' : txt(input.note, 300, 'bad-note', 'הערה');
  const db = T.tdb();
  const ref = db.doc('ord/o' + reqId);
  const seq = db.doc('ordcfg/seq');
  const cfg = db.doc('ordcfg/main');
  let out = null;
  await db.runTransaction(async (tx) => {
    const [s, q, c] = await tx.getAll(ref, seq, cfg);
    if (s.exists) { out = { id: s.id, no: s.get('no'), total: s.get('total'), dup: true, warn: [] }; return; }
    const prods = await loadProds(tx, db, raw.filter((x) => x.pid).map((x) => x.pid));
    const src = c.exists && c.get('src') && typeof c.get('src') === 'object' ? c.get('src')[br] : null;
    const { items } = resolveItems(w, br, raw, plain(prods), src);
    for (const it of items) if (it.pid && prods.get(it.pid).get('on') === false) throw pre('prod-off', `המוצר "${it.n}" לא זמין`);
    const total = totalOf(items);
    const no = (q.exists && typeof q.get('n') === 'number' ? q.get('n') : 0) + 1;
    const now = Date.now();
    const warn = [];
    applyMoves(tx, db, w, prods, moves(br, items), { ord: ref.id, no }, warn);
    const doc = { no, src: 'staff', br, cust, items, total, status: 'new', by: w.uid, byName: w.name, at: now, upd: now };
    if (note) doc.note = note;
    tx.set(ref, doc);
    tx.set(seq, { n: no });
    tx.set(logRef(db, ref.id), logData(w, 'create', `₪${total}`));
    out = { id: ref.id, no, total, dup: false, warn };
  });
  return out;
}

// updateOrder({ id, items, cust?, note? }) – רק לפני "שולם" (ולא בוטלה). מנהל או עובד עם ord בסניף. מלאי מתעדכן לפי ההפרש.
async function updateOrder(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'items', 'cust', 'note', 'total']);
  const id = idOf(input.id, 'הזמנה');
  const raw = input.items === undefined ? null : rawItems(input.items);
  const cust = input.cust === undefined ? null : cleanCust(input.cust);
  const note = input.note === undefined ? null : txt(input.note, 300, 'bad-note', 'הערה');
  const db = T.tdb();
  const ref = db.doc('ord/' + id);
  let out = null;
  await db.runTransaction(async (tx) => {
    const [s, c] = await tx.getAll(ref, db.doc('ordcfg/main'));
    ordAccess(w, s.exists ? s.data() : null);
    const d = s.data();
    if (!PAYABLE.includes(d.status)) throw pre('locked', d.status === 'cancel' ? 'ההזמנה בוטלה' : 'ההזמנה שולמה – אי אפשר לשנות פריטים או סכום');
    const upd = { upd: Date.now() };
    const warn = [];
    const notes = [];
    if (raw) {
      const oldItems = Array.isArray(d.items) ? d.items : [];
      const prods = await loadProds(tx, db, raw.filter((x) => x.pid).map((x) => x.pid).concat(oldItems.filter((x) => x.pid).map((x) => x.pid)));
      // מוצר ישן שנמחק מהמאגר – מדלגים עליו בהחזרה
      const src = c.exists && c.get('src') && typeof c.get('src') === 'object' ? c.get('src')[d.br] : null;
      // שורה קיימת שנשארת עם אותו מוצר – שומרת את סניף המקור שלה, אלא אם נשלח אחר
      const { items } = resolveItems(w, d.br, raw, plain(prods), src);
      const total = totalOf(items);
      const mv = invert(moves(d.br, oldItems.filter((x) => !x.pid || prods.has(x.pid))), 'edit').concat(moves(d.br, items).map((x) => Object.assign(x, { why: x.why === 'order' ? 'order' : x.why })));
      applyMoves(tx, db, w, prods, mv, { ord: id, no: d.no }, warn);
      Object.assign(upd, { items, total });
      if (total !== d.total) notes.push(`סכום ₪${d.total} → ₪${total}`);
      const pc = items.filter((it, i) => oldItems[i] && oldItems[i].pid === it.pid && oldItems[i].price !== it.price).map((it) => `${it.n}: ₪${oldItems[items.indexOf(it)].price} → ₪${it.price}`);
      notes.push(...pc);
      out = { total, warn };
    }
    if (cust) upd.cust = cust;
    if (note !== null) upd.note = note;
    tx.update(ref, upd);
    tx.set(logRef(db, id), logData(w, 'edit', notes.join('; ') || 'פרטים'));
  });
  return Object.assign({ ok: true }, out || {});
}

// setOrderStatus({ id, status }) – לפי טבלת NEXT.
async function setOrderStatus(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'status']);
  const id = idOf(input.id, 'הזמנה');
  const st = input.status;
  if (!STATUSES.includes(st)) throw bad('bad-status', 'סטטוס לא מוכר');
  const db = T.tdb();
  const ref = db.doc('ord/' + id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    ordAccess(w, s.exists ? s.data() : null);
    const cur = s.get('status');
    if (!(NEXT[cur] || []).includes(st)) throw pre('bad-status', 'אי אפשר לעבור מהסטטוס הנוכחי לסטטוס הזה');
    tx.update(ref, { status: st, upd: Date.now() });
    tx.set(logRef(db, id), logData(w, 'status', cur + '→' + st));
  });
  return { ok: true, status: st };
}

// markOrderPaid({ id, method, last4?, conf?, note? }) – "שולם" ידני. אחרי זה הסכום והפריטים נעולים.
async function markOrderPaid(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'method', 'last4', 'conf', 'note']);
  const id = idOf(input.id, 'הזמנה');
  if (!PAY_METHODS.includes(input.method)) throw bad('bad-method', 'בחרו אמצעי תשלום');
  const paid = { method: input.method };
  if (input.last4 != null && input.last4 !== '') {
    if (typeof input.last4 !== 'string' || !/^\d{4}$/.test(input.last4)) throw bad('bad-last4', '4 ספרות אחרונות: בדיוק 4 ספרות');
    paid.last4 = input.last4;
  }
  if (input.conf != null && input.conf !== '') {
    const c = txt(input.conf, 20, 'bad-conf', 'מספר אישור');
    if (!/^[0-9A-Za-z-]{1,20}$/.test(c)) throw bad('bad-conf', 'מספר אישור: ספרות/אותיות בלבד, עד 20');
    paid.conf = c;
  }
  if (input.note != null && input.note !== '') paid.note = txt(input.note, 200, 'bad-note', 'הערה');
  const db = T.tdb();
  const ref = db.doc('ord/' + id);
  let res = null;
  await db.runTransaction(async (tx) => {
    const [s, pp] = await tx.getAll(ref, db.doc('private/pay'));
    ordAccess(w, s.exists ? s.data() : null);
    const cur = s.get('status');
    if (cur === 'paid' || cur === 'out' || cur === 'done') { res = { ok: true, dup: true }; return; }
    if (!PAYABLE.includes(cur)) throw pre('bad-status', 'ההזמנה בוטלה');
    const now = Date.now();
    Object.assign(paid, { at: now, by: w.uid, amt: s.get('total') });
    // 17:47: "שולם" דרך קישור הספק → הכנסה של העסק + זיכוי אצל הספק (רשומת ordpay; מכשיר המנהל קולט אותה ליומן)
    const sup = paid.method === 'link' && pp.exists && pp.get('mode') === 'link' && pp.get('sup') && typeof pp.get('sup').id === 'string' ? pp.get('sup') : null;
    if (sup) {
      paid.sup = { id: sup.id, name: sup.name || '' };
      tx.set(db.doc('ordpay/' + id), { ord: id, no: s.get('no'), br: s.get('br'), amt: paid.amt, at: now, sup: paid.sup, st: 'paid', upd: now });
    }
    tx.update(ref, { status: 'paid', paid, upd: now });
    tx.set(logRef(db, id), logData(w, 'paid', `${paid.method} ₪${paid.amt}${paid.last4 ? ' ****' + paid.last4 : ''}${paid.conf ? ' אישור ' + paid.conf : ''}`));
    res = { ok: true, dup: false };
  });
  return res;
}

// unpayOrder({ id, reason }) – ביטול "שולם" (חוזר ל"ממתין לתשלום"). מנהל בלבד, עם סיבה (תשובה 3).
async function unpayOrder(request) {
  const w = await who(request);
  mgr(w);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'reason']);
  const id = idOf(input.id, 'הזמנה');
  const reason = txt(input.reason, 200, 'bad-reason', 'סיבה', true);
  const db = T.tdb();
  const ref = db.doc('ord/' + id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    ordAccess(w, s.exists ? s.data() : null);
    if (s.get('status') !== 'paid') throw pre('bad-status', 'אפשר לבטל "שולם" רק בהזמנה במצב שולם');
    if (s.get('paid') && s.get('paid').sup) tx.set(db.doc('ordpay/' + id), { st: 'void', upd: Date.now(), why: 'unpay' }, { merge: true });
    tx.update(ref, { status: 'wait_pay', paid: require('firebase-admin/firestore').FieldValue.delete(), upd: Date.now() });
    tx.set(logRef(db, id), logData(w, 'unpay', reason));
  });
  return { ok: true };
}

// cancelOrder({ id, reason }) – מכל מצב לפני "הושלם". הזמנה ששולמה – מנהל בלבד. המלאי חוזר.
async function cancelOrder(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'reason']);
  const id = idOf(input.id, 'הזמנה');
  const reason = txt(input.reason, 200, 'bad-reason', 'סיבת ביטול', true);
  const db = T.tdb();
  const ref = db.doc('ord/' + id);
  let res = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    ordAccess(w, s.exists ? s.data() : null);
    const d = s.data();
    if (d.status === 'cancel') { res = { ok: true, dup: true }; return; }
    if (d.status === 'done') throw pre('bad-status', 'הזמנה שהושלמה לא מבוטלת');
    if (d.status === 'paid') mgr(w); // 18:56: "יצא למשלוח" – גם עובד; "שולם" (לפני משלוח) – מנהל, כמו קודם
    const items = Array.isArray(d.items) ? d.items : [];
    const prods = await loadProds(tx, db, items.filter((x) => x.pid).map((x) => x.pid));
    applyMoves(tx, db, w, prods, invert(moves(d.br, items.filter((x) => !x.pid || prods.has(x.pid)))), { ord: id, no: d.no });
    if (['paid', 'out'].includes(d.status) && d.paid && d.paid.sup) tx.set(db.doc('ordpay/' + id), { st: 'void', upd: Date.now(), why: 'cancel' }, { merge: true });
    const now = Date.now();
    tx.update(ref, { status: 'cancel', cancel: { at: now, by: w.uid, reason, from: d.status }, upd: now });
    tx.set(logRef(db, id), logData(w, 'cancel', reason));
    res = { ok: true, dup: false };
  });
  return res;
}

// markOrderCalled({ id }) – "חייגתי ללקוח".
async function markOrderCalled(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id']);
  const id = idOf(input.id, 'הזמנה');
  const db = T.tdb();
  const ref = db.doc('ord/' + id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    ordAccess(w, s.exists ? s.data() : null);
    const now = Date.now();
    tx.update(ref, { calledAt: now, upd: now });
    tx.set(logRef(db, id), logData(w, 'called', ''));
  });
  return { ok: true };
}

// =====================================================================================
// תשלום: הקישור של העסק (מנהל־על) ופתיחתו מתוך הזמנה
// =====================================================================================
// getPayLink({ id }) – מחזיר את קישור הסליקה לפתיחה מיידית (האפליקציה לא מציגה אותו). רק להזמנה שעוד לא שולמה.
async function getPayLink(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id']);
  const id = idOf(input.id, 'הזמנה');
  const db = T.tdb();
  const [s, p] = await Promise.all([db.doc('ord/' + id).get(), db.doc('private/pay').get()]);
  ordAccess(w, s.exists ? s.data() : null);
  if (!PAYABLE.includes(s.get('status'))) throw pre('bad-status', 'ההזמנה כבר שולמה או בוטלה');
  const link = p.exists && p.get('mode') === 'link' && typeof p.get('link') === 'string' ? p.get('link') : '';
  if (!link) throw pre('no-pay-link', 'לעסק לא הוגדר קישור תשלום. תשלום בטלפון.');
  await db.collection(`ord/${id}/log`).add(logData(w, 'payOpen', ''));
  return { link, total: s.get('total') };
}

// setBusinessPayLink({ bizId, mode: 'link'|'phone', link? }) – מנהל־על בלבד. https בלבד, עד 500 תווים.
async function setBusinessPayLink(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'צריך להתחבר לאפליקציה', { reason: 'not-signed-in' });
  if (!(await T.isSuper(uid))) throw deny('not-superadmin', 'הפעולה מותרת למנהל המערכת בלבד');
  const input = inputObject(request);
  onlyKeys(input, ['bizId', 'mode', 'link', 'sup']);
  const bizId = input.bizId;
  if (typeof bizId !== 'string' || !T.BIZ_RE.test(bizId)) throw bad('bad-biz', 'מזהה עסק לא תקין');
  const biz = await T.loadBiz(bizId);
  // לארג' פעמי במצב legacy (גם בלי מסמך b/largpeami) – הנתונים בשורש (bizPrefix = '')
  if (!biz || (!biz.exists && bizId !== T.BIZ0)) throw new HttpsError('not-found', 'העסק לא נמצא', { reason: 'no-biz' });
  if (!['link', 'phone'].includes(input.mode)) throw bad('bad-mode', 'בחרו: קישור או תשלום בטלפון');
  let link = '';
  if (input.mode === 'link') {
    link = typeof input.link === 'string' ? input.link.trim() : '';
    let u = null;
    try { u = new URL(link); } catch (e) { /* */ }
    if (!u || u.protocol !== 'https:' || !u.hostname.includes('.') || link.length > 500 || /[\s<>"']/.test(link) || u.username || u.password) throw bad('bad-link', 'קישור לא תקין: חייב להתחיל ב-https:// ועד 500 תווים');
  }
  // 17:47: לאיזה ספק שייך הקישור (ספק קיזוז). { id, name } מתוך רשימת הספקים של העסק (cfg/main). null = בלי ספק
  let sup = null;
  if (input.mode === 'link' && input.sup != null) {
    const x = input.sup;
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad('bad-sup', 'ספק לא תקין');
    onlyKeys(x, ['id', 'name'], 'ספק');
    if (typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(x.id)) throw bad('bad-sup', 'ספק לא תקין');
    sup = { id: x.id, name: txt(x.name, 60, 'bad-sup', 'שם הספק', true) };
  }
  const db = getFirestore();
  const pfx = T.bizPrefix(biz);
  const now = Date.now();
  const b = db.batch();
  b.set(db.doc(pfx + 'private/pay'), { mode: input.mode, link, sup, at: now, by: uid });
  b.set(db.doc(pfx + 'ordcfg/main'), { pay: Object.assign({ mode: input.mode, has: !!link }, sup ? { sup } : {}), upd: now }, { mergeFields: ['pay', 'upd'] }); // pay מוחלף כולו (בלי sup ישן)
  b.set(db.collection(`b/${bizId}/audit`).doc(), { by: uid, t: now, act: 'setBusinessPayLink', note: input.mode + (link ? ':' + new URL(link).hostname : '') + (sup ? ' sup=' + sup.id : '') });
  await b.commit();
  return { ok: true, bizId, mode: input.mode, has: !!link, sup };
}

// setOrderCfg({ src: { <br>: 'stock' | <br> } }) – מנהל העסק (או מנהל־על). מקור המלאי לכל סניף (16:42).
async function setOrderCfg(request) {
  const w = await who(request);
  mgr(w);
  const input = inputObject(request);
  onlyKeys(input, ['src']);
  const src = input.src;
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw bad('bad-src', 'הגדרה לא תקינה');
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (!w.branches.some((b) => b.id === k)) throw bad('bad-src', 'סניף לא קיים: ' + String(k).slice(0, 20));
    if (v !== 'stock' && !w.activeBr.includes(v)) throw bad('bad-src', 'סניף מקור לא פעיל');
    out[k] = v;
  }
  const db = T.tdb();
  await db.doc('ordcfg/main').set({ src: out, upd: Date.now() }, { merge: true });
  if (w.biz.exists) await getFirestore().collection(`b/${w.bizId}/audit`).add({ by: w.uid, t: Date.now(), act: 'setOrderCfg', note: Object.entries(out).map(([k, v]) => k + '=' + v).join(';').slice(0, 500) });
  return { ok: true, src: out };
}

// =====================================================================================
// קטלוג (fb/ord-catalog): קטגוריות, ייבוא מוצרים, העברה ידנית, מחיר סיטונאי
// =====================================================================================
const crypto = require('crypto');
const catIdOf = (name, parent) => (parent ? 's_' : 'c_') + crypto.createHash('sha1').update((parent || '') + '|' + name).digest('hex').slice(0, 16);

// saveCat({ id?, name, parent?, ord? }) – מנהל. parent ריק = קטגוריה; מלא = תת־קטגוריה של קטגוריה קיימת.
async function saveCat(request) {
  const w = await who(request);
  mgr(w);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'name', 'parent', 'ord']);
  const name = txt(input.name, 40, 'bad-name', 'שם הקטגוריה', true);
  const db = T.tdb();
  let parent = '';
  if (input.parent != null && input.parent !== '') {
    parent = idOf(input.parent, 'קטגוריה ראשית');
    const ps = await db.doc('cat/' + parent).get();
    if (!ps.exists || ps.get('parent')) throw bad('bad-parent', 'קטגוריה ראשית לא קיימת');
  }
  const ord = input.ord == null ? 0 : Math.max(0, Math.min(9999, Math.round(Number(input.ord) || 0)));
  const id = input.id != null ? idOf(input.id, 'קטגוריה') : catIdOf(name, parent);
  if (input.id != null && !(await db.doc('cat/' + id).get()).exists) throw new HttpsError('not-found', 'הקטגוריה לא נמצאה', { reason: 'no-cat' });
  const doc = { name, ord, upd: Date.now() };
  if (parent) doc.parent = parent;
  await db.doc('cat/' + id).set(doc, { merge: true });
  return { ok: true, id };
}

// importProducts({ reqId, br?, addQty: bool, rows:[{ name, price, barcode?, qty?, cat?, sub?, wp?, pk?, ct?, bpx? }] }) – מנהל. עד 200 שורות למנה.
// התאמה: ברקוד, אחר כך שם מדויק → עדכון (לא כפילות). כמות: מוצר חדש – כמות פתיחה; קיים – נוספת רק אם addQty. כל כמות = stockLog why:'in'.
// cat/sub = שמות; קטגוריה שלא קיימת נוצרת (מזהה קבוע לפי השם – ייבוא חוזר לא משכפל). שורה שגויה – נדחית ומוחזרת ב-bad, השאר נשמרות.
async function importProducts(request) {
  const w = await who(request);
  mgr(w);
  const input = inputObject(request);
  onlyKeys(input, ['reqId', 'br', 'addQty', 'rows']);
  const reqId = reqIdOf(input);
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > MAX_IMPORT) throw bad('bad-rows', `שורות: 1 עד ${MAX_IMPORT}`);
  const anyQty = input.rows.some((r) => r && r.qty != null && r.qty !== '' && r.qty !== 0);
  const br = anyQty ? brOf(w, input.br) : (hasBranches(w) && input.br ? brOf(w, input.br) : (hasBranches(w) ? null : NB));
  const addQty = input.addQty === true;
  const ok = []; const badRows = [];
  input.rows.forEach((r, i) => {
    try {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('bad-row', 'שורה לא תקינה');
      onlyKeys(r, ['name', 'price', 'barcode', 'qty', 'cat', 'sub', 'wp', 'pk', 'ct'], 'שורה');
      const o = { i, name: txt(r.name, 60, 'bad-name', 'שם המוצר', true), price: money(r.price, 'מחיר') };
      const bc = r.barcode == null ? '' : String(r.barcode).trim();
      if (bc && !/^[0-9A-Za-z-]{3,30}$/.test(bc)) throw bad('bad-barcode', 'ברקוד לא תקין');
      o.barcode = bc;
      o.qty = r.qty == null || r.qty === '' ? 0 : qtyOf(r.qty, true);
      if (r.wp != null && r.wp !== '') o.wp = money(r.wp, 'מחיר סיטונאי');
      for (const k of ['pk', 'ct']) if (r[k] != null && r[k] !== '' && r[k] !== 0) { const v = qtyOf(r[k]); if (!Number.isInteger(v)) throw bad('bad-qty', 'מארז/קרטון: מספר שלם'); o[k] = v; }
      if (r.cat != null && r.cat !== '') o.cat = txt(r.cat, 40, 'bad-cat', 'קטגוריה');
      if (r.sub != null && r.sub !== '') { if (!o.cat) throw bad('bad-cat', 'תת־קטגוריה בלי קטגוריה'); o.sub = txt(r.sub, 40, 'bad-cat', 'תת־קטגוריה'); }
      ok.push(o);
    } catch (e) { badRows.push({ i, reason: (e.details && e.details.reason) || 'bad-row', msg: String(e.message || '').slice(0, 120) }); }
  });
  const db = T.tdb();
  const mark = db.doc('ordcfg/req_' + reqId);
  const res = { ok: true, dup: false, added: 0, updated: 0, bad: badRows };
  if (!ok.length) return res;
  await db.runTransaction(async (tx) => {
    const m = await tx.get(mark);
    if (m.exists) { Object.assign(res, m.get('res') || {}, { dup: true }); return; }
    const byBc = new Map(); const byName = new Map();
    const bcs = [...new Set(ok.map((o) => o.barcode).filter(Boolean))];
    const names = [...new Set(ok.map((o) => o.name))];
    for (let k = 0; k < bcs.length; k += 30) (await tx.get(db.collection('prod').where('barcode', 'in', bcs.slice(k, k + 30)))).forEach((s) => { if (!byBc.has(s.get('barcode'))) byBc.set(s.get('barcode'), s); });
    for (let k = 0; k < names.length; k += 30) (await tx.get(db.collection('prod').where('name', 'in', names.slice(k, k + 30)))).forEach((s) => { if (!byName.has(s.get('name'))) byName.set(s.get('name'), s); });
    const cats = new Map();
    for (const o of ok) if (o.cat) { cats.set(catIdOf(o.cat, ''), { name: o.cat }); if (o.sub) cats.set(catIdOf(o.sub, catIdOf(o.cat, '')), { name: o.sub, parent: catIdOf(o.cat, '') }); }
    const catSnaps = cats.size ? await tx.getAll(...[...cats.keys()].map((id) => db.doc('cat/' + id))) : [];
    const now = Date.now();
    catSnaps.forEach((s) => { if (!s.exists) tx.set(s.ref, Object.assign({ ord: 0, upd: now }, cats.get(s.id))); });
    const seen = new Map(); // מוצר חדש שכבר נוצר במנה הזו (שורה כפולה בקובץ)
    for (const o of ok) {
      const ex = (o.barcode && byBc.get(o.barcode)) || byName.get(o.name) || seen.get(o.barcode || ('n:' + o.name)) || null;
      const ext = { upd: now };
      if (o.cat) { ext.cat = catIdOf(o.cat, ''); if (o.sub) ext.sub = catIdOf(o.sub, ext.cat); }
      if (o.pk) ext.pk = o.pk;
      if (o.ct) ext.ct = o.ct;
      let id; let qty = 0;
      if (ex && ex.ref) {
        id = ex.id;
        const upd = Object.assign({ name: o.name, price: o.price }, o.barcode ? { barcode: o.barcode } : {}, ext);
        if (br && addQty && o.qty) { qty = o.qty; upd[`q.${br}`] = FV().increment(qty); }
        tx.update(ex.ref, upd);
        res.updated++;
      } else if (ex && ex.newId) {
        id = ex.newId; // שורה כפולה בקובץ – רק מצטרפת לכמות אם addQty
        if (br && addQty && o.qty) { qty = o.qty; ex.q = r3(ex.q + qty); tx.set(db.doc('prod/' + id), { q: { [br]: ex.q } }, { merge: true }); }
      } else {
        id = 'p' + crypto.createHash('sha1').update(reqId + '|' + o.i).digest('hex').slice(0, 24); // מזהה קבוע לכל מנה+שורה
        qty = br && o.qty ? o.qty : 0;
        tx.set(db.doc('prod/' + id), Object.assign({ name: o.name, price: o.price, barcode: o.barcode, on: true, q: qty ? { [br]: qty } : {}, at: now, by: w.uid, src: 'import' }, ext));
        seen.set(o.barcode || ('n:' + o.name), { newId: id, q: qty });
        res.added++;
      }
      if (o.wp != null) tx.set(db.doc(`prod/${id}/p/ws`), { wp: o.wp, at: now, by: w.uid });
      if (qty) tx.set(stockRef(db), { prod: id, name: o.name, br, delta: qty, why: 'in', note: 'ייבוא', by: w.uid, at: now });
    }
    tx.set(mark, { t: now, by: w.uid, k: 'importProducts', res: { added: res.added, updated: res.updated } });
  });
  return res;
}

// transferStock({ pid, from, to, qty, reqId, note? }) – העברה ידנית. מנהל, או עובד עם ord שמשויך לסניף המקור (לא מעביר מסניף זר).
async function transferStock(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['pid', 'from', 'to', 'qty', 'reqId', 'note']);
  if (!hasBranches(w)) throw pre('no-branches', 'בעסק אין סניפים');
  const reqId = reqIdOf(input);
  const pid = idOf(input.pid, 'מוצר');
  const from = brOf(w, input.from, 'סניף מקור');
  if (typeof input.to !== 'string' || !w.activeBr.includes(input.to)) throw bad('bad-br', 'סניף יעד: בחרו סניף פעיל');
  const to = input.to;
  if (from === to) throw bad('bad-br', 'סניף המקור והיעד זהים');
  const qty = qtyOf(input.qty);
  const note = input.note == null ? '' : txt(input.note, 200, 'bad-note', 'הערה');
  const db = T.tdb();
  const mark = db.doc('ordcfg/req_' + reqId);
  const ref = db.doc('prod/' + pid);
  let res = null;
  await db.runTransaction(async (tx) => {
    const [m, s] = await tx.getAll(mark, ref);
    if (m.exists) { res = { ok: true, dup: true }; return; }
    if (!s.exists) throw new HttpsError('not-found', 'המוצר לא נמצא', { reason: 'no-prod' });
    const now = Date.now(); const name = (s.get('name') || '').slice(0, 80);
    const qf = r3(qOf(s.data(), from) - qty), qt = r3(qOf(s.data(), to) + qty);
    tx.update(ref, new FieldPath('q', from), qf, new FieldPath('q', to), qt, 'upd', now);
    tx.set(stockRef(db), { prod: pid, name, br: from, delta: -qty, why: 'xout', to, by: w.uid, at: now });
    tx.set(stockRef(db), { prod: pid, name, br: to, delta: qty, why: 'xin', from, by: w.uid, at: now });
    const x = { prod: pid, name, from, to, qty, why: 'manual', by: w.uid, at: now, reqId };
    if (note) x.note = note;
    tx.set(db.doc('xfer/x' + reqId), x);
    tx.set(mark, { t: now, by: w.uid, k: 'transferStock' });
    res = { ok: true, dup: false, q: { [from]: qf, [to]: qt }, warn: qf < 0 };
  });
  return res;
}

// getWsPrices({ custId? }) → { wp: { <pid>: מחיר } }. מנהל – תמיד. עובד עם ord – לפי WS_SHOW (ברירת מחדל: רק ללקוח cust/{custId}.wholesale === true).
async function getWsPrices(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['custId']);
  const db = T.tdb();
  if (w.role !== 'manager' && WS_SHOW !== 'ord') {
    if (WS_SHOW === 'mgr') throw deny('manager-only', 'מחיר סיטונאי – מנהל בלבד');
    const cid = idOf(input.custId, 'לקוח');
    const c = await db.doc('cust/' + cid).get();
    if (!c.exists || c.get('wholesale') !== true) throw deny('not-wholesale', 'הלקוח לא מסומן כסיטונאי');
  }
  const wp = {};
  // קוראים לפי רשימת המוצרים של העסק (עד 2000) – לא collectionGroup, שאינו מוגבל לעסק
  const prods = await db.collection('prod').select().limit(2000).get();
  const refs = prods.docs.map((d) => db.doc(`prod/${d.id}/p/ws`));
  for (let k = 0; k < refs.length; k += 300) (await db.getAll(...refs.slice(k, k + 300))).forEach((s) => { if (s.exists && typeof s.get('wp') === 'number') wp[s.ref.parent.parent.id] = s.get('wp'); });
  return { wp };
}

// getProdCost({ pid }) – מנהל בלבד (העובד לא מקבל עלות בשום קריאה)
// (העלות נקראת גם ישירות מ-prod/{id}/p/cost לפי החוקים – מנהל בלבד)

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`orders: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code, msg: String(e && e.message).slice(0, 200) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { saveCat, importProducts, transferStock, getWsPrices, saveProduct, stockIn, stockSet, createOrder, updateOrder, setOrderStatus, markOrderPaid, unpayOrder, cancelOrder, markOrderCalled, getPayLink, setBusinessPayLink, setOrderCfg };
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall(wrap(k, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: { NEXT, STATUSES, PAY_METHODS, WS_SHOW, txt, totalOf, moves, invert, resolveItems, brPrice, catIdOf } });
