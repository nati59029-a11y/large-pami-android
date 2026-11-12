'use strict';
// תמחור מחשבונית ספק (משימה 2026-11-12_תמחור-חשבונית-ספק, שלב 1; החלטות המשתמש 12.11.2026).
// כל הנתיבים תחת b/{bizId}/ (או בשורש ללארג' פעמי במצב legacy – T.tdb()). כל כתיבה רק כאן; מהאפליקציה – קריאה לפי החוקים.
//
//   pinv/{id}  { st:'new'|'done'|'void', src:'scan'|'worker', sup, supId?, inv, date, by, byName, at, upd, n,
//                lines:[{ n, bc?, sku?, qty, unit:'u'|'pk'|'ct', pk?, ct?, cost?, raw?, chk? (הסיבה לסימון "לבדיקה"),
//                         pid? (מוצר קיים לעדכון), nw? (נבחר "מוצר חדש"), skip?, price? (לצרכן כולל מע"מ), wp? (סיטונאי לפני מע"מ),
//                         wpSrc?: 'stock'|'auto'|'man', cto? }],
//                lk?: { uid, name, t } (בטיפול), fin?: { by, name, t, rq, add, upd, void? } }
//
// חוזה השורה (תיקון סבב 1, ליקוי 1): qty ו-cost הם תמיד ביחידת מלאי (מארז; החלטה 3) – qty = מספר המארזים שנכנסים למלאי,
//   cost = עלות מארז לפני מע"מ. ההמרה מקרטונים (קרטונים × ct, מחיר קרטון ÷ ct) נעשית במכשיר לפני השליחה (www/pricing-lines.js,
//   PricingCalc.unitCost). unit = מה שהיה כתוב בחשבונית – מידע להצגה בלבד; השרת לא ממיר לפיו (אחרת – המרה כפולה).
// piCreate שומר רק שדות זיהוי (CREATE_KEYS); pid / מחירים / סימונים – רק מהמסך של מי שמטפל (piDraft / piFinish).
// מי: piCreate – כל איש צוות (גם עובד בלי prc ששולח חשבונית). כל השאר – מנהל, או עובד עם מתג prc ("עדכון מחירים ומלאי", כבוי כברירת מחדל).
// תוספת: מדף (shelf) או הזמנות (orders). בלי הזמנות (מדף בלבד) – אין מלאי בענן: piFinish רק סוגר את החשבונית.
// נעילה (החלטה 6): piClaim נועל; כל פעילות (piBeat / piDraft) מחדשת. 30 דקות בלי פעילות = משתחרר. אין שחרור כפוי –
//   גם מנהל לא עורך, לא סוגר ולא מבטל (piVoid) חשבונית שנעולה אצל מישהו אחר; רק המחזיק משחרר (piRelease) או התפוגה.
// זיהוי מוצר קיים (תוספת א'): ברקוד + ספק. piClaim מחזיר לכל שורה הצעה (m) ו"קיים אצל ספק אחר" (oth) – לא מקשר לבד:
//   piFinish מעדכן רק מוצר שהמסך שלח בשורה (pid). שורה בלי pid = מוצר חדש. עלות קודמת ושינוי עלות (תוספת ב') – cch.
// סיום (החלטה 4): מחיר לצרכן, סיטונאי, עלות (נשמרת כולל מע"מ, כמו היום), מארז/קרטון, cto, מוצרים חדשים, והוספת הכמויות למלאי
//   (q += כמות, stockLog why:'pinv'). מזהה בקשה (reqId) – ניסיון חוזר לא מוסיף פעמיים. הכתיבה למוצר – prodClean/prodPut של saveProduct.

const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const logger = require('firebase-functions/logger');
const { FieldValue } = require('firebase-admin/firestore');
const T = require('./lib/tenant');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const PC = require('./lib/pricing-calc');
const O = require('./orders')._core;

const { bad, deny, pre } = O;
const LOCK_MS = 30 * 60 * 1000; // החלטה 6
const MAX_LINES = 100;
const BC_RE = /^[0-9A-Za-z-]{3,30}$/;
const DATE_RE = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UNITS = ['u', 'pk', 'ct'];
const WP_SRC = ['stock', 'auto', 'man'];
const LINE_KEYS = ['n', 'bc', 'sku', 'qty', 'unit', 'pk', 'ct', 'cost', 'raw', 'chk', 'pid', 'nw', 'skip', 'price', 'wp', 'wpSrc', 'cto'];
const CREATE_KEYS = ['n', 'bc', 'sku', 'qty', 'unit', 'pk', 'ct', 'cost', 'raw', 'chk']; // piCreate: שדות זיהוי בלבד (ליקוי 2)
const NAME_MAX = 60; // כמו שם מוצר ב-saveProduct (prodClean) – ליקוי 5

// ---------- הרשאות ----------
function feats(w) {
  const f = (w.biz && w.biz.features) || {};
  w.shelf = f.shelf === true; w.ord = f.orders === true;
  if (!w.shelf && !w.ord) throw pre('feature-off', 'התוספת "מדף" או "הזמנות" לא מופעלת בעסק שלך. פנו לספק.');
  const nm = w.staff && typeof w.staff.get === 'function' && typeof w.staff.get('name') === 'string' ? w.staff.get('name') : '';
  w.uname = String(nm || (w.role === 'manager' ? 'מנהל' : 'עובד')).slice(0, 60);
  return w;
}
// מנהל, או עובד פעיל עם prc
async function pw(request) {
  const w = feats(await requireStaff(request));
  if (!hasPerm(w, 'prc')) throw deny('no-perm', 'אין לך הרשאה לעדכון מחירים ומלאי. פנה למנהל.');
  return O.withBr(w);
}

// ---------- ניקוי קלט ----------
// טקסט מזיהוי (שם ספק / שם מוצר / מספר חשבונית): בלי תווי בקרה; רצף של 8 ספרות ומעלה (מספר כרטיס אפשרי) – נמחק ולא נשמר
function soft(v, max) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  let s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (O.digRun(s) >= 8) s = s.replace(/\d[\d\s\-–—־./]*\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '' : m)).replace(/\s+/g, ' ').trim();
  if (O.digRun(s) >= 8) s = s.replace(/\d/g, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// שורה. strict = מהמסך (piDraft / piFinish): ערך לא תקין נדחה עם מספר השורה. אחרת (piCreate, מהזיהוי) – ערך לא תקין פשוט לא נשמר.
function cleanLine(l, i, strict) {
  const no = `שורה ${i + 1}: `;
  const fail = (reason, msg) => { if (strict) throw bad(reason, no + msg); };
  if (!l || typeof l !== 'object' || Array.isArray(l)) throw bad('bad-lines', no + 'לא תקינה');
  for (const k of Object.keys(l)) if (!LINE_KEYS.includes(k)) throw bad('bad-field', no + 'שדה לא מוכר: ' + String(k).slice(0, 30));
  const o = { n: soft(l.n, NAME_MAX), qty: 0, unit: UNITS.includes(l.unit) ? l.unit : 'u' };
  if (l.unit != null && !UNITS.includes(l.unit)) fail('bad-unit', 'יחידה לא תקינה');
  if (l.bc != null && l.bc !== '') { const b = String(l.bc).trim(); if (BC_RE.test(b)) o.bc = b; else fail('bad-barcode', 'ברקוד: ספרות/אותיות, 3 עד 30'); }
  if (l.sku != null && l.sku !== '') { const k = soft(l.sku, 30); if (k) o.sku = k; }
  if (l.raw != null && l.raw !== '') { const r = soft(l.raw, 200); if (r) o.raw = r; }
  if (l.chk != null && l.chk !== '') { const c = soft(l.chk, 120); if (c) o.chk = c; }
  if (l.qty != null && l.qty !== '') {
    if (isNum(l.qty) && l.qty >= 0 && l.qty <= 100000) o.qty = O.r3(l.qty); else fail('bad-qty', 'כמות לא תקינה');
  }
  for (const k of ['pk', 'ct']) {
    if (l[k] == null || l[k] === '' || l[k] === 0) continue;
    if (isNum(l[k]) && Number.isInteger(l[k]) && l[k] > 0 && l[k] <= 100000) o[k] = l[k]; else fail('bad-qty', (k === 'pk' ? 'כמות במארז' : 'כמות בקרטון') + ': מספר שלם');
  }
  for (const [k, lb] of [['cost', 'עלות'], ['price', 'מחיר'], ['wp', 'מחיר סיטונאי']]) {
    if (l[k] == null || l[k] === '') continue;
    if (isNum(l[k]) && l[k] >= 0 && l[k] <= 1000000) o[k] = Math.round(l[k] * 100) / 100; else fail('bad-price', lb + ': מספר בין 0 ל-1,000,000');
  }
  if (l.wpSrc != null && l.wpSrc !== '') { if (WP_SRC.includes(l.wpSrc)) o.wpSrc = l.wpSrc; else fail('bad-field', 'מקור סיטונאי לא תקין'); }
  for (const k of ['cto', 'nw', 'skip']) {
    if (l[k] == null) continue;
    if (typeof l[k] === 'boolean') { if (l[k] || k === 'cto') o[k] = l[k]; } else fail('bad-field', 'סימון חייב להיות כן/לא');
  }
  if (l.pid != null && l.pid !== '') { if (typeof l.pid === 'string' && O.ID_RE.test(l.pid)) o.pid = l.pid; else fail('bad-id', 'מוצר לא תקין'); }
  return o;
}
function cleanLines(v, strict, allowEmpty, keys) {
  if (v == null && allowEmpty) return [];
  if (!Array.isArray(v) || v.length > MAX_LINES || (!allowEmpty && !v.length)) throw bad('bad-lines', `שורות: ${allowEmpty ? 0 : 1} עד ${MAX_LINES}`);
  return v.map((l, i) => {
    const o = cleanLine(l, i, strict);
    if (keys) for (const k of Object.keys(o)) if (!keys.includes(k)) delete o[k]; // piCreate – מה שאינו זיהוי לא נשמר
    return o;
  });
}
// כותרת: ספק, מספר חשבונית, תאריך (רק מה שנשלח)
function cleanHdr(input) {
  const h = {};
  if (input.sup !== undefined) h.sup = soft(input.sup, 60);
  if (input.inv !== undefined) h.inv = soft(input.inv, 30);
  if (input.date !== undefined) {
    if (input.date === '' || input.date == null) h.date = '';
    else if (typeof input.date === 'string' && DATE_RE.test(input.date)) h.date = input.date;
    else throw bad('bad-date', 'תאריך לא תקין');
  }
  if (input.supId !== undefined) {
    if (input.supId === '' || input.supId == null) h.supId = '';
    else if (typeof input.supId === 'string' && O.ID_RE.test(input.supId)) h.supId = input.supId;
    else throw bad('bad-id', 'ספק לא תקין');
  }
  return h;
}

// ---------- נעילה ----------
const fresh = (lk, now) => !!lk && typeof lk.t === 'number' && now - lk.t < LOCK_MS;
const lockedErr = (lk) => pre('locked', `החשבונית בטיפול של ${lk.name || 'משתמש אחר'}`);
function open(s) {
  if (!s.exists) throw new HttpsError('not-found', 'החשבונית לא נמצאה', { reason: 'no-pinv' });
  const d = s.data() || {};
  if (d.st !== 'new') throw pre('closed', 'החשבונית כבר טופלה');
  return d;
}
// רק מי שמחזיק בנעילה (גם אם פגה ואף אחד אחר לא נכנס בינתיים)
function holder(d, w, now) {
  if (d.lk && d.lk.uid === w.uid) return;
  if (fresh(d.lk, now)) throw lockedErr(d.lk);
  throw pre('not-locked', 'צריך להיכנס לחשבונית מחדש');
}
const lockOf = (w, now) => ({ uid: w.uid, name: w.uname, t: now });

// ---------- זיהוי מוצר קיים: ברקוד + ספק ----------
const normSup = (s) => String(s || '').toLowerCase().replace(/בע["'״׳]?מ/g, '').replace(/\bltd\b/g, '').replace(/[^\p{L}\p{N}]/gu, '');
// שם מנורמל (תוספת ג'): אותיות קטנות, פיסוק = רווח, רווחים כפולים – אחד. השוואה מדויקת אחרי הנרמול (לא "דומה")
const normName = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const SUP_SCAN = 2000; // שורות בלי ברקוד: מוצרי הספק נטענים להשוואת שם מנורמל
// התאמה לכל שורה: { m: מוצר מוצע | null, k, oth: אותו ברקוד אצל ספק אחר }.
//   k: 'pid' (המשתמש בחר / כבר מקושר) | 'bc' (ברקוד + אותו ספק; nosup = למוצר אין ספק רשום) | 'sku' (בלי ברקוד: קוד פריט של אותו ספק)
//      | 'name' (בלי ברקוד: שם מנורמל של אותו ספק – לבדוק) | 'otherSup' (רק אצל ספק אחר – לא מוצע) | '' (אין / המשתמש בחר "מוצר חדש", nw)
//   ההצעה לא נשמרת: piFinish מעדכן רק pid שהמסך שלח (המשתמש יכול לבטל ולהגדיר כמוצר חדש).
async function matches(db, d, vat) {
  const L = Array.isArray(d.lines) ? d.lines : [];
  const byBc = new Map(), bySku = new Map(), byName = new Map(), byId = new Map();
  const add = (m, k, s) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).some((x) => x.id === s.id)) m.get(k).push(s); };
  const q = async (field, vals, m, key) => {
    const u = [...new Set(vals.filter(Boolean))];
    for (let k = 0; k < u.length; k += 30) (await db.collection('prod').where(field, 'in', u.slice(k, k + 30)).get()).forEach((s) => add(m, key ? key(s.get(field)) : s.get(field), s));
  };
  const sup0 = normSup(d.sup);
  const sameSup = (s) => !!sup0 && normSup(s.get('sup')) === sup0;
  const noBc = L.filter((l) => !l.bc && !l.pid && !l.nw);
  await q('barcode', L.map((l) => l.bc), byBc);
  await q('sku', noBc.map((l) => l.sku), bySku);
  if (sup0 && noBc.some((l) => l.n)) {
    // שם מנורמל: השם המדויק + מוצרי הספק (השם כמו בחשבונית, עם / בלי "בע\"מ"). ספק שנרשם במלאי בכתיב אחר – רק לפי שם מדויק
    await q('name', noBc.map((l) => l.n), byName, normName);
    const base = String(d.sup).replace(/\s*בע["'״׳]?מ\.?\s*$/, '').trim();
    const sv = [...new Set([d.sup, base].concat(['בע"מ', 'בע״מ', 'בעמ', "בע'מ"].map((x) => base + ' ' + x)))];
    (await db.collection('prod').where('sup', 'in', sv).limit(SUP_SCAN).get()).forEach((s) => add(byName, normName(s.get('name')), s));
  }
  const pids = [...new Set(L.map((l) => l.pid).filter(Boolean))];
  if (pids.length) (await db.getAll(...pids.map((p) => db.doc('prod/' + p)))).forEach((s) => { if (s.exists) byId.set(s.id, s); });
  const res = L.map((l) => {
    const bcL = l.bc ? byBc.get(l.bc) || [] : [];
    const oth = bcL.filter((s) => s.get('sup') && !sameSup(s));
    let m = null, k = '', nosup = false;
    if (l.pid) { m = byId.get(l.pid) || null; k = m ? 'pid' : ''; }
    else if (l.nw) k = '';
    else if (l.bc) {
      m = bcL.find(sameSup) || bcL.find((s) => !s.get('sup')) || null;
      if (m) { k = 'bc'; nosup = !m.get('sup'); } else if (oth.length) k = 'otherSup';
    } else {
      m = (l.sku && (bySku.get(l.sku) || []).find(sameSup)) || null;
      if (m) k = 'sku';
      else if (l.n && (m = (byName.get(normName(l.n)) || []).find(sameSup) || null)) k = 'name';
    }
    return { m, k, nosup, oth: oth.filter((s) => !m || s.id !== m.id).slice(0, 5) };
  });
  const ids = [...new Set(res.flatMap((r) => (r.m ? [r.m.id] : []).concat(r.oth.map((s) => s.id))))];
  const cost = new Map(), wp = new Map();
  for (let k = 0; k < ids.length; k += 150) {
    const part = ids.slice(k, k + 150);
    (await db.getAll(...part.flatMap((p) => [db.doc(`prod/${p}/p/cost`), db.doc(`prod/${p}/p/ws`)]))).forEach((s) => {
      const p = s.ref.parent.parent.id;
      if (s.exists && isNum(s.get('cost'))) cost.set(p, s.get('cost'));
      if (s.exists && isNum(s.get('wp'))) wp.set(p, s.get('wp'));
    });
  }
  const view = (s) => {
    const x = s.data() || {};
    const c = cost.has(s.id) ? cost.get(s.id) : null;
    const o = { pid: s.id, name: x.name || '', price: isNum(x.price) ? x.price : null, barcode: x.barcode || '', sup: x.sup || '', on: x.on !== false,
      pk: x.pk || null, ct: x.ct || null, cto: x.cto === true, q: x.q && typeof x.q === 'object' ? x.q : {}, cost: c, costx: c == null ? null : PC.noVat(c, vat),
      wp: wp.has(s.id) ? wp.get(s.id) : null };
    return o;
  };
  return res.map((r, i) => {
    const m = r.m ? view(r.m) : null;
    return { m, k: r.k, nosup: r.nosup, oth: r.oth.map((s) => { const v = view(s); return { pid: v.pid, name: v.name, sup: v.sup, price: v.price, costx: v.costx, wp: v.wp }; }),
      cch: m ? PC.costChange(L[i].cost, m.costx) : '' };
  });
}
async function vatOf(db, w) {
  if (!w.ord) return PC.VAT0;
  const c = await db.doc('ordcfg/main').get();
  const v = c.exists ? c.get('vat') : null;
  return isNum(v) && v >= 0 && v <= 100 ? v : PC.VAT0;
}

// ---------- הפונקציות ----------
// piCreate({ reqId, sup?, supId?, inv?, date?, lines? }) → { id, dup } – מזהה קבוע 'i' + reqId: ניסיון חוזר לא יוצר שנייה
async function piCreate(request) {
  const w = feats(await requireStaff(request));
  const input = inputObject(request);
  O.onlyKeys(input, ['reqId', 'sup', 'supId', 'inv', 'date', 'lines']);
  const reqId = O.reqIdOf(input);
  const h = Object.assign({ sup: '', inv: '', date: '' }, cleanHdr(input));
  const lines = cleanLines(input.lines, false, true, CREATE_KEYS);
  const db = T.tdb();
  const ref = db.doc('pinv/i' + reqId);
  const now = Date.now();
  let dup = false;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) { dup = true; return; }
    tx.set(ref, Object.assign({ st: 'new', src: w.role === 'manager' ? 'scan' : 'worker', by: w.uid, byName: w.uname, at: now, upd: now, n: lines.length, lines }, h));
  });
  return { ok: true, id: ref.id, dup };
}

// piClaim({ id }) – כניסה לטיפול: נועל אם פנוי / שלי / הנעילה פגה. מחזיר את החשבונית + נתוני מלאי לכל שורה (גם עלות וסיטונאי)
async function piClaim(request) {
  const w = await pw(request);
  const input = inputObject(request);
  O.onlyKeys(input, ['id']);
  const id = O.idOf(input.id, 'חשבונית');
  const db = T.tdb();
  const ref = db.doc('pinv/' + id);
  let d = null; const now = Date.now();
  await db.runTransaction(async (tx) => {
    d = open(await tx.get(ref));
    if (fresh(d.lk, now) && d.lk.uid !== w.uid) throw lockedErr(d.lk);
    d.lk = lockOf(w, now);
    tx.update(ref, { lk: d.lk, upd: now });
  });
  const vat = await vatOf(db, w);
  const m = w.ord ? await matches(db, d, vat) : [];
  const inv = { st: d.st, src: d.src, sup: d.sup || '', supId: d.supId || '', inv: d.inv || '', date: d.date || '', by: d.by, byName: d.byName || '', at: d.at, lines: Array.isArray(d.lines) ? d.lines : [] };
  return { ok: true, id, inv, lk: d.lk, until: now + LOCK_MS, vat, ord: w.ord, m };
}

// piBeat({ id }) – "עדיין בטיפול" (כל דקה מהמסך): מחדש את הנעילה
async function piBeat(request) {
  const w = await pw(request);
  const input = inputObject(request);
  O.onlyKeys(input, ['id']);
  const ref = T.tdb().doc('pinv/' + O.idOf(input.id, 'חשבונית'));
  const now = Date.now();
  await T.tdb().runTransaction(async (tx) => {
    const d = open(await tx.get(ref));
    holder(d, w, now);
    tx.update(ref, { lk: lockOf(w, now), upd: now });
  });
  return { ok: true, until: now + LOCK_MS };
}

// piRelease({ id }) – יציאה מהחשבונית. רק המחזיק משחרר (מנהל לא משחרר נעילה של אחר); אחרת – בלי שינוי
async function piRelease(request) {
  const w = await pw(request);
  const input = inputObject(request);
  O.onlyKeys(input, ['id']);
  const ref = T.tdb().doc('pinv/' + O.idOf(input.id, 'חשבונית'));
  let rel = false;
  await T.tdb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'החשבונית לא נמצאה', { reason: 'no-pinv' });
    const d = s.data() || {};
    if (d.st === 'new' && d.lk && d.lk.uid === w.uid) { tx.update(ref, { lk: FieldValue.delete(), upd: Date.now() }); rel = true; }
  });
  return { ok: true, rel };
}

// piDraft({ id, lines, sup?, inv?, date?, supId? }) – שמירת עבודה באמצע (כדי שאחר ימשיך), רק למחזיק. מחדש את הנעילה
async function piDraft(request) {
  const w = await pw(request);
  const input = inputObject(request);
  O.onlyKeys(input, ['id', 'lines', 'sup', 'inv', 'date', 'supId']);
  const ref = T.tdb().doc('pinv/' + O.idOf(input.id, 'חשבונית'));
  const lines = cleanLines(input.lines, true, true);
  const h = cleanHdr(input);
  const now = Date.now();
  await T.tdb().runTransaction(async (tx) => {
    const d = open(await tx.get(ref));
    holder(d, w, now);
    tx.update(ref, Object.assign({ lines, n: lines.length, lk: lockOf(w, now), upd: now }, h));
  });
  return { ok: true, until: now + LOCK_MS };
}

// piFinish({ id, reqId, lines, br?, sup?, inv?, date?, supId? }) – סיום ושמירה: מעדכן/יוצר מוצרים ומוסיף כמויות למלאי, וסוגר.
async function piFinish(request) {
  const w = await pw(request);
  const input = inputObject(request);
  O.onlyKeys(input, ['id', 'reqId', 'lines', 'br', 'sup', 'inv', 'date', 'supId']);
  const id = O.idOf(input.id, 'חשבונית');
  const reqId = O.reqIdOf(input);
  const lines = cleanLines(input.lines, true, false);
  const h = cleanHdr(input);
  const act = lines.map((l, i) => ({ l, i })).filter((x) => !x.l.skip);
  const db = T.tdb();
  const br = w.ord && act.some((x) => x.l.qty > 0) ? O.brOf(w, input.br) : null;
  const ref = db.doc('pinv/' + id);
  const now = Date.now();
  let res = null;
  await db.runTransaction(async (tx) => {
    // טרנזקציה יכולה לרוץ שוב (התנגשות) – כל מה שמשתנה בתוכה מתחיל מחדש בכל ניסיון
    res = { ok: true, id, dup: false, added: 0, updated: 0, qty: 0 };
    const out = lines.map((l) => Object.assign({}, l));
    const pids = w.ord ? [...new Set(act.map((x) => x.l.pid).filter(Boolean))] : [];
    const [s, cfg, ...ps] = await tx.getAll(ref, db.doc('ordcfg/main'), ...pids.map((p) => db.doc('prod/' + p)));
    if (s.exists && s.get('st') === 'done' && s.get('fin') && s.get('fin').rq === reqId) { Object.assign(res, { dup: true }, s.get('fin').res || {}); return; }
    const d = open(s);
    holder(d, w, now);
    const sup = h.sup !== undefined ? h.sup : (d.sup || '');
    if (w.ord) {
      const v = cfg.exists ? cfg.get('vat') : null;
      const vat = isNum(v) && v >= 0 && v <= 100 ? v : PC.VAT0;
      const P = new Map(ps.map((x) => [x.id, x]));
      const qBy = new Map(); // כמות לכל מוצר (קיים: pid; חדש: לפי ברקוד / שם) – כמה שורות לאותו מוצר מצטרפות
      const keyOf = (l) => (l.pid ? 'p:' + l.pid : l.bc ? 'b:' + l.bc : 'n:' + l.n + '|' + l.i);
      act.forEach(({ l, i }) => { const k = keyOf(Object.assign({ i }, l)); qBy.set(k, O.r3((qBy.get(k) || 0) + (l.qty || 0))); });
      const done = new Set();
      const supOk = sup && O.digRun(sup) < 8 ? sup : '';
      for (const { l, i } of act) {
        const k = keyOf(Object.assign({ i }, l));
        if (done.has(k)) continue; // שורה נוספת לאותו מוצר – הכמות כבר נספרה
        done.add(k);
        const qty = br ? qBy.get(k) : 0;
        const ext = {};
        for (const f of ['pk', 'ct', 'wp']) if (l[f] != null) ext[f] = l[f];
        if (typeof l.cto === 'boolean') ext.cto = l.cto;
        if (l.cost != null) ext.cost = PC.withVat(l.cost, vat); // החלטה 2: במלאי העלות כולל מע"מ
        try {
          if (l.pid) {
            const p = P.get(l.pid);
            if (!p || !p.exists) throw new HttpsError('not-found', 'המוצר לא נמצא', { reason: 'no-prod' });
            const o = p.data() || {};
            const price = l.price != null ? l.price : o.price;
            const c = O.prodClean(w, Object.assign({ name: o.name, price, barcode: o.barcode || l.bc || '', on: o.on !== false }, ext, !o.sup && supOk ? { sup: supOk } : {}));
            const extra = qty ? { [`q.${br}`]: O.r3(O.qOf(o, br) + qty) } : {};
            O.prodPut(tx, db, w, l.pid, o, c, now, extra);
            if (qty) tx.set(O.stockRef(db), { prod: l.pid, name: c.name, br, delta: qty, why: 'pinv', note: `חשבונית ${d.inv || ''} ${sup}`.trim().slice(0, 300), pinv: id, by: w.uid, at: now });
            res.updated++;
          } else {
            const nid = 'p' + crypto.createHash('sha1').update(id + '|' + i).digest('hex').slice(0, 24);
            const sku = l.sku && O.digRun(l.sku) < 8 ? { sku: l.sku } : {};
            const c = O.prodClean(w, Object.assign({ name: l.n, price: l.price, barcode: l.bc || '', on: true }, ext, supOk ? { sup: supOk } : {}, sku));
            O.prodPut(tx, db, w, nid, null, c, now, { q: qty ? { [br]: qty } : {}, src: 'pinv' });
            if (qty) tx.set(O.stockRef(db), { prod: nid, name: c.name, br, delta: qty, why: 'pinv', note: `חשבונית ${d.inv || ''} ${sup}`.trim().slice(0, 300), pinv: id, by: w.uid, at: now });
            out[i].pid = nid; // נשמר בחשבונית הסגורה – איזה מוצר נוצר
            res.added++;
          }
          res.qty = O.r3(res.qty + qty);
        } catch (e) {
          if (e instanceof HttpsError) throw new HttpsError(e.code, `שורה ${i + 1}: ${e.message}`, e.details);
          throw e;
        }
      }
    }
    const fin = { by: w.uid, name: w.uname, t: now, rq: reqId, br: br || '', res: { added: res.added, updated: res.updated, qty: res.qty } };
    tx.update(ref, Object.assign({ st: 'done', lines: out, n: out.length, fin, lk: FieldValue.delete(), upd: now }, h));
  });
  return res;
}

// piVoid({ id }) – מנהל: הסרה מהתמחור בלי לעדכן מלאי (למשל חשבונית שנדחתה). לא על חשבונית שנעולה אצל מישהו אחר
async function piVoid(request) {
  const w = await pw(request);
  if (w.role !== 'manager') throw deny('manager-only', 'הפעולה מותרת למנהל בלבד');
  const input = inputObject(request);
  O.onlyKeys(input, ['id']);
  const ref = T.tdb().doc('pinv/' + O.idOf(input.id, 'חשבונית'));
  const now = Date.now();
  let dup = false;
  await T.tdb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists && s.get('st') === 'void') { dup = true; return; }
    const d = open(s);
    if (fresh(d.lk, now) && d.lk.uid !== w.uid) throw lockedErr(d.lk);
    tx.update(ref, { st: 'void', fin: { by: w.uid, name: w.uname, t: now, void: true }, lk: FieldValue.delete(), upd: now });
  });
  return { ok: true, dup };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`pricing: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code, msg: String(e && e.message).slice(0, 200) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { piCreate, piClaim, piBeat, piRelease, piDraft, piFinish, piVoid };
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall({}, wrap(k, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: { cleanLine, cleanLines, soft, normSup, matches, LOCK_MS, MAX_LINES } });
