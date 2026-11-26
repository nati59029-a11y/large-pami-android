'use strict';
// קופה – אשף "ייבוא מכספיט" (משימה 2026-11-17_תוכנית-קופה-לחנות, סשן י', ענף feature/pos-import). מנהל בלבד, מאחורי מתג העסק 'pos'.
// כלל ברזל: רשומה קיימת לא נדרסת לעולם. הייבוא רק יוצר מוצרים / לקוחות חדשים; כפול = "קיים, דילגתי".
//   כפילות – מוצר: ברקוד (ומוצר בלי ברקוד: שם מדויק). לקוח: טלפון (כולל טלפונים נוספים, phx) או ת"ז.
//
//   posImpCheck({ kind:'prod'|'cust', keys:[…≤500] })  – לתצוגה המקדימה: אילו מפתחות כבר קיימים. לא כותב דבר.
//       prod: keys = [{ bc?, nm? }]   cust: keys = [{ ph?, tz? }]   → { ex:[אינדקסים שקיימים] }
//   posImport({ job, kind, file, src, total, at, rows[≤200], vatIn? })  – מנה של שורות שכבר עברו התאמה במכשיר (השרת בודק שוב הכול).
//       job = מזהה של 20 תווים שהמכשיר בוחר פעם אחת לקובץ. שליחה חוזרת של אותה מנה (אחרי ניתוק) מחזירה את התוצאה השמורה ולא יוצרת פעמיים.
//       prod: { n, name, price (₪ כולל מע"מ), barcode?, sku?, cost?, cid? (קטגוריה קיימת) | cat? (שם קטגוריה חדשה) }
//       cust: { n, name, phone?, tz?, mail? }  (בלי טלפון ובלי ת"ז – שגוי: אי אפשר לבדוק כפילות)
//   posImpList({})   – 30 הייבואים האחרונים (מונים בלבד, בלי ids) + רשימת הקטגוריות הקיימות (למיפוי מחלקות).
//   posImpUndo({ job }) – "ביטול ייבוא" של מוצרים: on:false למוצרים שנוצרו בייבוא, עדיין פעילים, ולא נמכרו (אין תנועת מלאי אחרת מלבד 'in').
//       בלי מחיקה. עד 150 מוצרים לקריאה – המכשיר קורא שוב עד left = 0. לקוחות – אין ביטול (לפי התוכנית, פרק 4); הלקוחות מסומנים imp = job.
//
// איפה הנתונים (תחת העסק – T.tdb(); בלארג' פעמי במצב legacy – בשורש):
//   posimp/{job}        (חדש) { kind, src:'xlsx'|'csv', file, rows, added, dup, bad, skip, skipped:[{n,why}] (עד 500), ids:[] , by, at, upd, undone?, undoAt?, off? }
//   posimp/{job}/c/{at} (חדש) סימון מנה שבוצעה + התוצאה שלה (אידמפוטנטיות)
//   prod/{id}  (+) imp: job, src:'posimp'      cust/{id} (+) imp: job, src:'import'
//   הכתיבה רק כאן. אין צורך בחוקים חדשים: המכשיר לא קורא posimp ישירות (posImpList), וכתיבה מהמכשיר חסומה ממילא (ברירת מחדל).

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { FieldValue } = require('firebase-admin/firestore');
const { onCall } = require('./lib/region');
const T = require('./lib/tenant');
const { inputObject } = require('./lib/roles');
const ORD = require('./orders')._core;
const CUS = require('./customers')._core;
const STK = Object.assign({ BCL: require('./lib/pos-barcode') }, require('./lib/pos-stock')); // POS:M6 – אינדקס ברקודים, דגלים, מק"ט רץ
const SKU0 = 10000;

const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });
const deny = (reason, message) => new HttpsError('permission-denied', message, { reason });
const pre = (reason, message) => new HttpsError('failed-precondition', message, { reason });

const JOB_RE = /^[A-Za-z0-9]{20}$/;
const CALL_ROWS = 200;
const CHECK_MAX = 500;
const MAX_TOTAL = 50000;
const SKIP_MAX = 500;
const UNDO_STEP = 150;
const BC_RE = /^[0-9A-Za-z-]{3,30}$/;
const MAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// הרשאה: מנהל + תוספת orders + הרשאת ord (ORD.who) + מתג העסק 'pos' (הקופה). מתג כבוי = הפונקציות לא עובדות בכלל.
async function who(request) {
  const w = await ORD.who(request);
  if (w.role !== 'manager') throw deny('manager-only', 'ייבוא מכספיט – מנהל בלבד');
  if (!w.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש'); // כמו pos.js (שלב 0)
  T.requireFeature(w.biz, 'pos');
  return w;
}
const jobOf = (v) => { if (typeof v !== 'string' || !JOB_RE.test(v)) throw bad('bad-job', 'מזהה ייבוא לא תקין'); return v; };
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const onlyKeys = (o, keys, label) => ORD.onlyKeys(o, keys, label);

// ---------- ניקוי שורה (טהור – גם לבדיקות בלי אמולטור) ----------
function prodRow(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('bad-row', 'שורה לא תקינה');
  onlyKeys(r, ['n', 'name', 'price', 'barcode', 'bcRaw', 'sku', 'cost', 'cid', 'cat'], 'שורה');
  const o = { n: r.n, name: ORD.txt(r.name, 60, 'bad-name', 'שם המוצר', true), price: ORD.money(r.price, 'מחיר') };
  const bc = r.barcode == null ? '' : String(r.barcode).trim();
  if (bc && !BC_RE.test(bc)) throw bad('bad-barcode', 'ברקוד: ספרות / אותיות, 3 עד 30');
  o.barcode = bc;
  // P1: ברקוד ישן לא תקין (ספרת ביקורת, כתיב מדעי) – נקלט בלי ברקוד, הטקסט המקורי נשמר ב-bcRaw והמוצר מסומן "לבדיקה"
  if (r.bcRaw != null && r.bcRaw !== '') o.bcRaw = String(r.bcRaw).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  if (bc && !STK.BCL.check(bc).ok) { o.bcRaw = bc; o.barcode = ''; }
  if (r.sku != null && r.sku !== '') o.sku = ORD.txt(String(r.sku), 30, 'bad-sku', 'מק"ט');
  if (r.cost != null && r.cost !== '') o.cost = ORD.money(r.cost, 'עלות');
  if (r.cid != null && r.cid !== '') o.cid = ORD.idOf(r.cid, 'קטגוריה');
  else if (r.cat != null && r.cat !== '') o.cat = ORD.txt(r.cat, 40, 'bad-cat', 'קטגוריה');
  if (!o.cid && !o.cat) o.cat = 'ללא קטגוריה'; // 26.11.2026 (החלטת בעל העסק): מוצר בלי קטגוריה בקובץ – תחת "ללא קטגוריה" (נוצרת אם חסרה)
  return o;
}
function custRow(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('bad-row', 'שורה לא תקינה');
  onlyKeys(r, ['n', 'name', 'phone', 'tz', 'mail'], 'שורה');
  const o = { n: r.n, name: ORD.txt(r.name, 60, 'bad-name', 'שם הלקוח', true) };
  if (r.phone != null && r.phone !== '') o.phone = CUS.phoneOf(r.phone);
  if (r.tz != null && r.tz !== '') o.tz = CUS.tzOf(r.tz);
  if (!o.phone && !o.tz) throw bad('no-key', 'חסר טלפון או ת"ז – אי אפשר לבדוק כפילות');
  if (r.mail != null && r.mail !== '') { const m = String(r.mail).trim().toLowerCase(); if (!MAIL_RE.test(m)) throw bad('bad-mail', 'מייל לא תקין'); o.mail = m; }
  return o;
}
const reasonOf = (e) => String((e && e.details && e.details.reason) || 'bad-row').slice(0, 30);

// ---------- חיפוש קיימים (בתוך טרנזקציה או בלי) ----------
const inChunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
async function existingProds(db, get, bcs, names) {
  const byBc = new Set(), byName = new Set();
  for (const part of inChunks([...new Set(bcs)], 30)) (await get(db.collection('prod').where('barcode', 'in', part))).forEach((s) => byBc.add(s.get('barcode')));
  for (const part of inChunks([...new Set(names)], 30)) (await get(db.collection('prod').where('name', 'in', part))).forEach((s) => byName.add(s.get('name')));
  // גם ברקוד נוסף / ברקוד ארגז של מוצר קיים, ואינדקס posbc (P19)
  const rest = [...new Set(bcs)].filter((b) => !byBc.has(b));
  if (rest.length) for (const t of await STK.bcTaken(get, db, rest, '')) byBc.add(t.bc);
  return { byBc, byName };
}
async function existingCusts(db, get, getAll, phones, tzs) {
  const ph = new Set(), tz = new Set();
  const P = [...new Set(phones)], Z = [...new Set(tzs)];
  const refs = P.map((p) => db.doc('cust/p' + p)).concat(Z.map((t) => db.doc('cust/t' + t)));
  for (const part of inChunks(refs, 100)) {
    if (!part.length) continue;
    (await getAll(part)).forEach((s) => { if (!s.exists) return; const id = s.id; if (id[0] === 'p') ph.add(id.slice(1)); else tz.add(id.slice(1)); });
  }
  for (const part of inChunks(P, 30)) {
    (await get(db.collection('cust').where('phx', 'array-contains-any', part))).forEach((s) => { for (const x of s.get('phx') || []) if (P.includes(x)) ph.add(x); });
    (await get(db.collection('cust').where('phone', 'in', part))).forEach((s) => ph.add(s.get('phone')));
  }
  for (const part of inChunks(Z, 30)) (await get(db.collection('cust').where('tz', 'in', part))).forEach((s) => tz.add(s.get('tz')));
  return { ph, tz };
}

// ---------- posImpCheck ----------
async function posImpCheck(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['kind', 'keys']);
  const kind = input.kind;
  if (kind !== 'prod' && kind !== 'cust') throw bad('bad-kind', 'סוג ייבוא לא תקין');
  const keys = input.keys;
  if (!Array.isArray(keys) || keys.length > CHECK_MAX) throw bad('bad-keys', `עד ${CHECK_MAX} שורות לבדיקה`);
  const db = T.tdb();
  const get = (q) => q.get();
  const ex = [];
  if (kind === 'prod') {
    const K = keys.map((k) => ({ bc: k && typeof k.bc === 'string' && BC_RE.test(k.bc) ? k.bc : '', nm: k && typeof k.nm === 'string' ? k.nm.slice(0, 60) : '' }));
    const { byBc, byName } = await existingProds(db, get, K.map((k) => k.bc).filter(Boolean), K.filter((k) => !k.bc && k.nm).map((k) => k.nm));
    K.forEach((k, i) => { if (k.bc ? byBc.has(k.bc) : (k.nm && byName.has(k.nm))) ex.push(i); });
  } else {
    const K = keys.map((k) => {
      let ph = '', tz = '';
      try { if (k && k.ph) ph = CUS.phoneOf(k.ph); } catch (e) { /* לא תקין – לא נבדק */ }
      try { if (k && k.tz) tz = CUS.tzOf(k.tz); } catch (e) { /* */ }
      return { ph, tz };
    });
    const { ph, tz } = await existingCusts(db, get, (refs) => db.getAll(...refs), K.map((k) => k.ph).filter(Boolean), K.map((k) => k.tz).filter(Boolean));
    K.forEach((k, i) => { if ((k.ph && ph.has(k.ph)) || (k.tz && tz.has(k.tz))) ex.push(i); });
  }
  return { ok: true, ex };
}

// ---------- posImport ----------
async function posImport(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['job', 'kind', 'file', 'src', 'total', 'at', 'rows', 'vatIn']);
  const job = jobOf(input.job);
  const kind = input.kind;
  if (kind !== 'prod' && kind !== 'cust') throw bad('bad-kind', 'סוג ייבוא לא תקין');
  const src = input.src === 'csv' ? 'csv' : 'xlsx';
  // שם הקובץ – לתצוגה ביומן בלבד. רצף ספרות ארוך (תאריך, מספר) מוחלף ב-… (כמו imports.js – לא שומרים מספרים ארוכים)
  const file = String(typeof input.file === 'string' ? input.file : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\d(?:[\s.\-/_]*\d){7,}/g, '…').trim().slice(0, 80);
  const total = input.total, at = input.at, rows = input.rows;
  if (!intIn(total, 1, MAX_TOTAL)) throw bad('bad-total', `מספר שורות: 1 עד ${MAX_TOTAL}`);
  if (!Array.isArray(rows) || !rows.length || rows.length > CALL_ROWS) throw bad('bad-rows', `שורות: 1 עד ${CALL_ROWS}`);
  if (!intIn(at, 0, total - 1) || at + rows.length > total) throw bad('bad-at', 'מיקום המנה בקובץ לא תקין');

  const ok = [], badRows = [];
  rows.forEach((r, i) => {
    const n = r && intIn(r.n, 1, 10000000) ? r.n : at + i + 2;
    try { const o = kind === 'prod' ? prodRow(r) : custRow(r); o.n = n; o.i = i; ok.push(o); } catch (e) { badRows.push({ n, why: reasonOf(e) }); }
  });

  const db = T.tdb();
  const logRef = db.doc('posimp/' + job);
  const mark = logRef.collection('c').doc(String(at));
  const now = Date.now();
  const res = await db.runTransaction(async (tx) => {
    const [ls, ms] = await tx.getAll(logRef, mark);
    if (ms.exists) return Object.assign({}, ms.get('res'), { again: true });
    if (ls.exists) {
      const L = ls.data();
      if (L.kind !== kind || L.rows !== total || L.by !== w.uid) throw pre('job-mismatch', 'המנה לא תואמת לייבוא שכבר התחיל. התחילו ייבוא חדש.');
      if (L.undone) throw pre('job-undone', 'הייבוא הזה בוטל. התחילו ייבוא חדש.');
    }
    const get = (q) => tx.get(q);
    const out = { added: 0, dup: 0, bad: badRows.length, skipped: badRows.slice(), ids: [] };
    const seen = new Set();
    if (kind === 'prod') {
      const { byBc, byName } = await existingProds(db, get, ok.map((o) => o.barcode).filter(Boolean), ok.filter((o) => !o.barcode).map((o) => o.name));
      const cids = [...new Set(ok.map((o) => o.cid).filter(Boolean))];
      const cidSnaps = cids.length ? await tx.getAll(...cids.map((id) => db.doc('cat/' + id))) : [];
      const cidOk = new Set(cidSnaps.filter((s) => s.exists).map((s) => s.id));
      const newCats = new Map();
      for (const o of ok) if (o.cat) newCats.set(ORD.catIdOf(o.cat, ''), o.cat);
      const ncSnaps = newCats.size ? await tx.getAll(...[...newCats.keys()].map((id) => db.doc('cat/' + id))) : [];
      // P4: מק"ט רץ למוצר בלי מק"ט – מונה poscfg/ctr6 (כמו pos-catalog.js), מדלגים על מק"ט שכבר קיים
      const ctrRef = db.doc('poscfg/ctr6');
      const cs = await tx.get(ctrRef);
      let ctr = cs.exists && Number.isInteger(cs.get('sku')) ? cs.get('sku') : 0;
      const ctr0 = ctr;
      const need = ok.filter((o) => !o.sku).length;
      const free = [];
      for (let round = 0; round < 5 && free.length < need; round++) {
        const cand = Array.from({ length: need - free.length + 5 }, () => String(SKU0 + (++ctr)));
        const used = new Set();
        for (const part of inChunks(cand, 30)) (await tx.get(db.collection('prod').where('sku', 'in', part))).forEach((x) => used.add(x.get('sku')));
        cand.forEach((c) => { if (!used.has(c)) free.push(c); });
      }
      // כל הקריאות לפני כל הכתיבות (חובה בטרנזקציה)
      if (ctr !== ctr0) tx.set(ctrRef, { sku: ctr, upd: now }, { merge: true });
      ncSnaps.forEach((s) => { if (!s.exists) tx.set(s.ref, { name: newCats.get(s.id), ord: 0, upd: now }); });
      for (const o of ok) {
        const key = o.barcode ? 'b:' + o.barcode : 'n:' + o.name;
        if (o.barcode ? byBc.has(o.barcode) : byName.has(o.name)) { out.dup++; out.skipped.push({ n: o.n, why: 'exists' }); continue; }
        if (seen.has(key)) { out.dup++; out.skipped.push({ n: o.n, why: 'file-dup' }); continue; }
        if (o.cid && !cidOk.has(o.cid)) { out.bad++; out.skipped.push({ n: o.n, why: 'no-cat' }); continue; }
        seen.add(key);
        const id = 'p' + crypto.createHash('sha1').update(job + '|' + (at + o.i)).digest('hex').slice(0, 24); // מזהה קבוע לשורה
        const d = { name: o.name, price: o.price, barcode: o.barcode, on: true, q: {}, at: now, by: w.uid, upd: now, src: 'posimp', imp: job };
        d.sku = o.sku || free.shift() || '';
        if (o.cid) d.cat = o.cid; else if (o.cat) d.cat = ORD.catIdOf(o.cat, '');
        if (o.bcRaw) d.bcRaw = o.bcRaw;
        d.flags = STK.prodFlags(d, o.cost != null ? o.cost : null); // P1/P2: חסר מחיר / חסר פרטים / לבדיקה – לא חוסם
        tx.create(db.doc('prod/' + id), d); // create – אם במקרה קיים, הטרנזקציה נכשלת ולא דורסת
        STK.bcIndex(tx, db, id, d);
        if (o.cost != null) tx.set(db.doc(`prod/${id}/p/cost`), { cost: o.cost, at: now, by: w.uid });
        out.ids.push(id); out.added++;
      }
    } else {
      const { ph, tz } = await existingCusts(db, get, (refs) => tx.getAll(...refs), ok.map((o) => o.phone).filter(Boolean), ok.map((o) => o.tz).filter(Boolean));
      for (const o of ok) {
        if ((o.phone && ph.has(o.phone)) || (o.tz && tz.has(o.tz))) { out.dup++; out.skipped.push({ n: o.n, why: 'exists' }); continue; }
        if ((o.phone && seen.has('p' + o.phone)) || (o.tz && seen.has('t' + o.tz))) { out.dup++; out.skipped.push({ n: o.n, why: 'file-dup' }); continue; }
        if (o.phone) seen.add('p' + o.phone);
        if (o.tz) seen.add('t' + o.tz);
        const id = o.tz ? 't' + o.tz : 'p' + o.phone; // אותה שיטת מזהה כמו customers.js
        const d = { name: o.name, x: {}, at: now, upd: now, by: w.uid, src: 'import', imp: job };
        if (o.phone) { d.phone = o.phone; d.phx = [o.phone]; }
        if (o.tz) d.tz = o.tz;
        if (o.mail) d.mail = o.mail;
        tx.create(db.doc('cust/' + id), d);
        out.ids.push(id); out.added++;
      }
    }
    const r = { added: out.added, dup: out.dup, bad: out.bad, skipped: out.skipped.slice(0, SKIP_MAX) };
    tx.set(mark, { t: now, res: r });
    if (!ls.exists) {
      tx.set(logRef, { kind, src, file, rows: total, added: out.added, dup: out.dup, bad: out.bad, skipped: r.skipped, ids: out.ids, by: w.uid, at: now, upd: now });
    } else {
      const prev = ls.get('skipped') || [];
      const upd = { added: FieldValue.increment(out.added), dup: FieldValue.increment(out.dup), bad: FieldValue.increment(out.bad), upd: now };
      if (prev.length < SKIP_MAX && r.skipped.length) upd.skipped = prev.concat(r.skipped).slice(0, SKIP_MAX);
      if (out.ids.length) upd.ids = FieldValue.arrayUnion(...out.ids);
      tx.update(logRef, upd);
    }
    return r;
  });
  return Object.assign({ ok: true, job }, res);
}

// ---------- posImpList ----------
async function posImpList(request) {
  const w = await who(request);
  onlyKeys(inputObject(request), []);
  void w;
  const db = T.tdb();
  const [s, cs] = await Promise.all([db.collection('posimp').orderBy('at', 'desc').limit(30).get(), db.collection('cat').select('name', 'parent').limit(2000).get()]);
  return {
    ok: true,
    cats: cs.docs.map((d) => ({ id: d.id, name: String(d.get('name') || '').slice(0, 40), parent: d.get('parent') || '' })),
    list: s.docs.map((d) => {
      const x = d.data();
      return { id: d.id, kind: x.kind, src: x.src, file: x.file || '', rows: x.rows || 0, added: x.added || 0, dup: x.dup || 0, bad: x.bad || 0, at: x.at || 0, undone: !!x.undone, off: x.off || 0, kept: x.kept || 0, skipped: (x.skipped || []).slice(0, 200) };
    }),
  };
}

// ---------- posImpUndo ----------
// "נמכר" = יש למוצר תנועת מלאי שאינה 'in' (הזמנה, מכירה, העברה, ספירה, ביטול…) – נשאר פעיל, ונספר ב-kept.
async function posImpUndo(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['job']);
  const job = jobOf(input.job);
  const db = T.tdb();
  const logRef = db.doc('posimp/' + job);
  const ls = await logRef.get();
  if (!ls.exists) throw new HttpsError('not-found', 'הייבוא לא נמצא', { reason: 'no-job' });
  const L = ls.data();
  if (L.kind !== 'prod') throw pre('cust-no-undo', 'ביטול ייבוא – למוצרים בלבד. לקוחות לא מבוטלים (אין להם מצב "כבוי").');
  const ids = Array.isArray(L.ids) ? L.ids : [];
  const from = Number.isInteger(L.undoAt) ? L.undoAt : 0;
  const part = ids.slice(from, from + UNDO_STEP);
  let off = 0, kept = 0;
  for (const id of part) {
    const ref = db.doc('prod/' + id);
    const moved = await db.collection('stockLog').where('prod', '==', id).limit(20).get();
    const sold = moved.docs.some((s) => s.get('why') !== 'in');
    const done = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists || s.get('imp') !== job || s.get('on') === false) return 0;
      if (sold) return -1;
      tx.update(ref, { on: false, upd: Date.now(), impOff: job });
      return 1;
    });
    if (done === 1) off++; else if (done === -1) kept++;
  }
  const next = from + part.length;
  const left = Math.max(0, ids.length - next);
  const upd = { undoAt: next, off: FieldValue.increment(off), kept: FieldValue.increment(kept), upd: Date.now() };
  if (!left) { upd.undone = true; upd.undoBy = w.uid; }
  await logRef.update(upd);
  return { ok: true, off, kept, left };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`pos-import: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code }); // בלי קלט ובלי ערכים מהקובץ
    if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) throw new HttpsError('aborted', 'הרשומה כבר קיימת. רעננו ונסו שוב.', { reason: 'exists' });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

exports.posImpCheck = onCall({ timeoutSeconds: 120 }, wrap('posImpCheck', posImpCheck));
exports.posImport = onCall({ timeoutSeconds: 300, memory: '512MiB' }, wrap('posImport', posImport));
exports.posImpList = onCall(wrap('posImpList', posImpList));
exports.posImpUndo = onCall({ timeoutSeconds: 300 }, wrap('posImpUndo', posImpUndo));
Object.defineProperty(exports, '_core', { enumerable: false, value: { prodRow, custRow, reasonOf, CALL_ROWS, CHECK_MAX, UNDO_STEP, SKIP_MAX } });
