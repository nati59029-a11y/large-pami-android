'use strict';
// לקוחות הקפה מכספית (24.11.2026, ענף claude/new-session-umlkgh). התוכנית המחייבת: docs/caspit-handoff.md, "לקוחות הקפה מכספית – תוכנית (24.11)".
// "תמונת יתרות" מ-#/hakafa-customers בכספית. התוסף שולח דרך cxBot (caspit-bot.js, op:'hkSnap'):
//   { run?, day:'YYYY-MM-DD', rows:[{ xc, tz, name, ph, addr, bal }] } – bal באגורות (שלם), חוב = חיובי. עד 2000 שורות. נשמרים רק השדות האלה (מנורמלים).
// לפני אישור ראשון: נשמר כ"ממתין לאישור" + תצוגה מקדימה (חדשים / מותאמים / "לבדוק" ולמה / סך היתרות / יתרות שליליות). לא נוגעים ב-cust וב-ardoc.
//   תמונה חדשה מחליפה תמונה ממתינה.
// hkApprove (מנהל) – "אשר ייבוא ראשון", במנות: ההתאמה מחושבת מחדש ברגע האישור ונשמרת (p בכל שורה), ואז מנות של CH שורות בטרנזקציה.
//   לקוח חדש – פרטי (לא wholesale), עם xc. לקוח קיים מותאם – רק xc נוסף (פרטים קיימים לא נדרסים). יתרה ≠ 0 → יתרת פתיחה ardoc ob (כמו ar-import.js),
//   חוב = חובה, יתרה שלילית = זכות. הכול בקבוצת arimp אחת (kind:'ob', src:'hk') – "ביטול קבוצה" הקיים (arImpVoid) עובד.
//   התאמה: מספר לקוח (xc) ← ת.ז/ח.פ (cust/t{tz}, vat) ← טלפון (cust/p{phone}, phx). כמה התאמות / לקוח שכבר יש לו ob / xc אחר → "לבדוק", לא נוצר כלום.
// אחרי האישור – כל תמונה (כל לילה): הפרש מול היתרה האחרונה שהוחלה ללקוח (hkc).
//   הפרש חיובי → ardoc old חובה x_old_hk{YYYYMMDD}_{xc} ("חיובי הקפה בכספית DD/MM"); הפרש שלילי → "לבדוק" בלבד (בלי מסמך); לקוח חדש בכספית → כמו באישור;
//   לקוח שנמחק באפליקציה → hkc.st='del' ולא חוזר. היתרה האחרונה מתעדכנת באותה טרנזקציה של המסמך – תמונה חוזרת של אותו יום לא יוצרת כפילות.
//   קבוצת arimp אחת ליום: hk_{YYYYMMDD} (kind:'inv', src:'hk'); אם בוטלה – hk_{YYYYMMDD}_2 ...
//
//   hkcfg/main         { st?:'on', pend?:{ sid, day, at, n, parts, pv }, apr?:{ sid, batch, pos, n, day, at, by, c }, first?:{ batch, day, at, by, n, c }, night?:{ day, at, batch, ...מונים } }
//   hkpend/{sid}_{k}   { sid, k, rows:[{ xc, tz, name, ph, addr, bal, p? }] } – עד PART שורות לחלק. נמחק אחרי האישור או כשתמונה חדשה מחליפה.
//   hkc/{xc}           { xc, st:'ok'|'chk'|'del', cust?, bal, day, b, why?, at, upd } – היתרה האחרונה בכספית שהוחלה, והלקוח באפליקציה.
//   hkchk/{id}         { xc, name, ph, why, day, at, cust?, diff? } – "לבדוק" למנהל. a_{xc} = התאמה בעייתית; n_{YYYYMMDD}_{xc} = הפרש שלילי (diff אגורות, שלילי).
// כל האוספים – שרת בלבד (אין להם כלל בחוקים = אין קריאה ואין כתיבה מהאפליקציה). האפליקציה קוראת דרך hkGet.
// פרטיות: ביומן השרת רק קודים ומספרים – בלי שמות, טלפונים ות.ז.

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const logger = require('firebase-functions/logger');
const { FieldValue } = require('firebase-admin/firestore');
const T = require('./lib/tenant');
const { inputObject } = require('./lib/roles');
const ARD = require('./lib/ar-doc');
const AC = require('./lib/ar-calc');
const OC = require('./orders')._core;
const CUS = require('./customers')._core;

const { bad, deny, pre, onlyKeys } = OC;
const MAX_ROWS = 2000, PART = 500, CH = 20, CALL_ROWS = 400, CHK_MAX = 300, BACK_DAYS = 7;
const AG_MAX = 1000000000; // ₪10,000,000 – כמו ar-import.js
const ROW_KEYS = ['xc', 'tz', 'name', 'ph', 'addr', 'bal'];
const XC_RE = /^[0-9A-Za-z-]{1,20}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SID_RE = /^s[a-z0-9]{8,30}$/;
const CTL = /[\u0000-\u001f\u007f]/;
const CFG = 'hkcfg/main';
const WHY = {
  'many-xc': 'כמה לקוחות באפליקציה עם אותו מספר לקוח', 'many-tz': 'כמה לקוחות באפליקציה עם אותה ת.ז / ח.פ', 'many-ph': 'כמה לקוחות באפליקציה עם אותו טלפון',
  'xc-other': 'הלקוח המתאים באפליקציה מקושר למספר לקוח אחר בכספית', 'dup-cust': 'כמה לקוחות בכספית מתאימים לאותו לקוח באפליקציה',
  'has-ob': 'ללקוח המתאים כבר יש יתרת פתיחה', changed: 'הלקוח השתנה מאז החישוב – בדקו ונסו שוב', 'too-many-v': 'המסמך יובא ובוטל יותר מדי פעמים',
  neg: 'היתרה בכספית ירדה (קבלה או זיכוי בכספית) – לא נוצר מסמך',
};

// ---------- פונקציות טהורות (גם לבדיקות) ----------
const realDay = (s) => { if (typeof s !== 'string' || !DAY_RE.test(s)) return false; const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const ymd8 = (day) => day.replace(/-/g, '');
const dm = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)}`;
// ת.ז / ח.פ: ספרות בלבד, 5–9 → משלימים ל-9. ok = ספרת ביקורת תקינה (רק אז נשמר כ-tz בלקוח חדש)
function tzOf(v) {
  const t = String(v || '').replace(/\D/g, '');
  if (!/^\d{5,9}$/.test(t)) return { d: '', ok: false };
  const d = t.padStart(9, '0');
  try { return { d, ok: CUS.tzOf(d) === d }; } catch (e) { return { d, ok: false }; }
}
// שורה מהתוסף → שורה מנורמלת. קלט לא תקין – שגיאה (כל ההעלאה נדחית, כמו בשאר הפעולות של הרובוט)
function rowOf(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('bad-row', 'שורה לא תקינה');
  onlyKeys(r, ROW_KEYS, 'שורה');
  const xc = typeof r.xc === 'number' && Number.isSafeInteger(r.xc) && r.xc >= 0 ? String(r.xc) : r.xc;
  if (typeof xc !== 'string' || !XC_RE.test(xc)) throw bad('bad-row', 'מספר לקוח לא תקין');
  const s = (v, n, l) => {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
    if (typeof v !== 'string' || v.length > n || CTL.test(v)) throw bad('bad-row', l + ' לא תקין/ה בשורה');
    return v.replace(/\s+/g, ' ').trim();
  };
  const tz = s(r.tz, 20, 'ת.ז'), ph = s(r.ph, 30, 'טלפון');
  let name = s(r.name, 80, 'שם').slice(0, 60);
  const addr = s(r.addr, 150, 'כתובת');
  if (!Number.isSafeInteger(r.bal) || Math.abs(r.bal) > AG_MAX) throw bad('bad-row', 'יתרה לא תקינה (אגורות, מספר שלם)');
  if (OC.cardLike(name)) name = ''; // מספר שנראה כמו כרטיס אשראי – לא נשמר (כמו בשאר הלקוחות)
  let phone = '';
  try { if (ph) phone = CUS.phoneOf(ph); } catch (e) { /* לא תקין – לא משמש לזיהוי ולא נשמר */ }
  return { xc, tz: tzOf(tz).d, name, ph: phone, addr: OC.cardLike(addr) ? '' : addr, bal: r.bal };
}
function rowsOf(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) throw bad('bad-rows', `שורות: 1 עד ${MAX_ROWS}`);
  const out = rows.map(rowOf), seen = new Set();
  for (const r of out) { if (seen.has(r.xc)) throw bad('dup-xc', 'מספר לקוח מופיע פעמיים'); seen.add(r.xc); }
  return out;
}

// ---------- התאמה ללקוחות קיימים ----------
// סריקה אחת של הלקוחות (רק שדות הזיהוי) → אינדקסים. ids – כל המזהים (גם mv), כדי שלקוח חדש לא יקבל מזהה תפוס
async function scanCusts(db) {
  const q = await db.collection('cust').select('xc', 'tz', 'vat', 'phone', 'phx', 'mv').get();
  const ix = { xc: new Map(), tz: new Map(), vat: new Map(), ph: new Map(), ids: new Set(), xcOf: new Map() };
  const add = (m, k, id) => { if (typeof k !== 'string' || !k) return; const s = m.get(k) || new Set(); s.add(id); m.set(k, s); };
  q.forEach((s) => {
    ix.ids.add(s.id);
    const d = s.data() || {};
    if (d.mv) return;
    add(ix.xc, d.xc, s.id); if (typeof d.xc === 'string' && d.xc) ix.xcOf.set(s.id, d.xc);
    add(ix.tz, d.tz || (s.id[0] === 't' ? s.id.slice(1) : ''), s.id);
    add(ix.vat, d.vat, s.id);
    add(ix.ph, d.phone, s.id); if (s.id[0] === 'p') add(ix.ph, s.id.slice(1), s.id);
    if (Array.isArray(d.phx)) for (const p of d.phx) add(ix.ph, p, s.id);
  });
  return ix;
}
// יתרת פתיחה קיימת: השרשרת x_ob_{cid}, _v2.._v9 (אחרי ביטול). get(id) → נתונים או null. → { live } / { id } / { why }
async function obSlot(get, cid) {
  const b = 'x_ob_' + cid;
  let id = b, x = await get(id), v = 1;
  while (x && x.void && v < 9) { v++; id = b + '_v' + v; x = await get(id); }
  if (x && !x.void) return { live: true };
  if (x) return { why: 'too-many-v' };
  return { id };
}
const newIdOf = (r) => 'c' + crypto.createHash('sha1').update('hk:' + r.xc).digest('hex').slice(0, 20);
// לכל שורה: p = { k:'match', id } | { k:'new', id } | { k:'chk', why }. obLive(cid) → Promise<bool|'too-many-v'>
async function planOf(rows, ix, obLive) {
  const one = (s) => (s && s.size ? [...s] : []);
  const uni = (...L) => [...new Set(L.flatMap(one))];
  for (const r of rows) {
    let m = one(ix.xc.get(r.xc)), why = 'many-xc';
    if (!m.length && r.tz) { m = uni(TZOK(r) ? ix.tz.get(r.tz) : null, ix.vat.get(r.tz)); why = 'many-tz'; }
    if (!m.length && r.ph) { m = one(ix.ph.get(r.ph)); why = 'many-ph'; }
    if (m.length > 1) r.p = { k: 'chk', why };
    else if (m.length === 1) r.p = ix.xcOf.get(m[0]) && ix.xcOf.get(m[0]) !== r.xc ? { k: 'chk', why: 'xc-other' } : { k: 'match', id: m[0] };
    else r.p = { k: 'new' };
  }
  const cnt = new Map();
  for (const r of rows) if (r.p.k === 'match') cnt.set(r.p.id, (cnt.get(r.p.id) || 0) + 1);
  for (const r of rows) if (r.p.k === 'match' && cnt.get(r.p.id) > 1) r.p = { k: 'chk', why: 'dup-cust' };
  for (const r of rows) if (r.p.k === 'match') { const z = await obLive(r.p.id); if (z) r.p = { k: 'chk', why: z === true ? 'has-ob' : z }; }
  const taken = new Set(ix.ids);
  for (const r of rows) {
    if (r.p.k !== 'new') continue;
    const id = TZOK(r) && !taken.has('t' + r.tz) ? 't' + r.tz : r.ph && !taken.has('p' + r.ph) ? 'p' + r.ph : newIdOf(r);
    taken.add(id); r.p.id = id;
  }
  return rows;
}
const TZOK = (r) => !!r.tz && tzOf(r.tz).ok;
function pvOf(rows) {
  const pv = { n: rows.length, new: 0, match: 0, chk: 0, why: {}, sum: 0, sumOk: 0, neg: 0, zero: 0, chkL: [] };
  for (const r of rows) {
    pv.sum += r.bal; if (r.bal < 0) pv.neg++; if (r.bal === 0) pv.zero++;
    if (r.p.k === 'chk') { pv.chk++; pv.why[r.p.why] = (pv.why[r.p.why] || 0) + 1; if (pv.chkL.length < CHK_MAX) pv.chkL.push({ xc: r.xc, name: r.name, why: r.p.why, bal: r.bal }); continue; }
    pv[r.p.k]++; pv.sumOk += r.bal;
  }
  return pv;
}
async function obLiveDb(db) {
  return async (cid) => { const z = await obSlot(async (id) => { const s = await db.doc('ardoc/' + id).get(); return s.exists ? s.data() : null; }, cid); return z.live ? true : z.why || false; };
}

// ---------- כתיבה בתוך טרנזקציה (משותף לאישור וללילה) ----------
// קריאות לשורה עם החלטה (p): it.x = { k:'new'|'match'|'chk', id?, why?, obId? }
async function readPlan(tx, B, db, it) {
  const p = it.p;
  if (p.k === 'chk') { it.x = { k: 'chk', why: p.why }; return; }
  const get = async (id) => { const x = await B.needDoc(id); return x ? x.d : null; };
  if (p.k === 'match') {
    const c = await B.needCust(p.id);
    if (!c.data || c.data.mv || (c.data.xc && c.data.xc !== it.xc)) { it.x = { k: 'chk', why: 'changed' }; return; }
    const z = await obSlot(get, p.id);
    if (!z.id) { it.x = { k: 'chk', why: z.live ? 'has-ob' : z.why }; return; }
    it.x = { k: 'match', id: p.id, obId: z.id };
    if (it.bal) it.open = await B.openDocs(p.id);
    return;
  }
  const s = await tx.get(db.doc('cust/' + p.id));
  if (s.exists) { it.x = { k: 'chk', why: 'changed' }; return; }
  const z = it.bal ? await obSlot(get, p.id) : { id: '' };
  if (!z.id && it.bal) { it.x = { k: 'chk', why: z.live ? 'has-ob' : z.why }; return; }
  it.x = { k: 'new', id: p.id, obId: z.id };
}
// גוף מסמך מיובא (ob / old) – אותו מבנה כמו ar-import.js
function xDoc(B, w, o) {
  const c = o.c, dr = o.k === 'dr';
  return { t: o.t, k: o.k, ...(o.t === 'old' ? { ot: 'inv' } : {}), ext: o.no, no: o.no, ser: 'X', d: o.day, cust: o.cust, custSnap: ARD.custSnap(c),
    lines: [], vm: 'inc', rate: 0, net: o.ag, vat: 0, gross: o.ag, ord: [], br: ARD.NB, draft: false, bt: B.bt, imp: o.batch, note: o.note,
    ...(dr ? { due: ARD.dueFor(AC.termsOfCust(c), o.day), dueT: 1 } : {}), by: w.uid, at: B.now, sent: [], upd: B.now, open: o.ag, st: dr ? 'open' : 'ok' };
}
function addDoc(B, db, id, d) { const x = { id, ref: db.doc('ardoc/' + id), d, patch: null, isNew: true }; B.docs[id] = x; B.news.push(x); return x; }
// כמו ar-import.js: כל זכות פתוחה של הלקוח סוגרת חובות פתוחים (מהישן לחדש)
function allocAll(B, open, made) {
  const byD = (a, b) => String(a.d.dueX || a.d.due || a.d.d).localeCompare(String(b.d.dueX || b.d.due || b.d.d)) || String(a.d.d).localeCompare(String(b.d.d)) || (a.d.at || 0) - (b.d.at || 0);
  for (const cid of Object.keys(open)) {
    const all = open[cid].concat(made.filter((x) => x.d.cust === cid));
    const drs = all.filter((x) => ARD.isDr(x.d) && !x.d.void).sort(byD), crs = all.filter((x) => ARD.isCr(x.d) && !x.d.void).sort(byD);
    for (const s of crs) for (const v of drs) { if (s.d.open <= 0) break; if (v.d.open > 0) B.alloc(s, v, s.d.open); }
  }
}
// כתיבות לשורה עם החלטה (אחרי כל הקריאות). מחזיר { k, ob?, ag? } למונים
function writePlan(tx, B, db, w, it, ctx, made, open) {
  const now = B.now, x = it.x;
  const hk = db.doc('hkc/' + it.xc);
  if (x.k === 'chk') {
    tx.set(hk, { xc: it.xc, st: 'chk', why: x.why, bal: it.bal, day: ctx.day, b: ctx.batch, at: now, upd: now });
    tx.set(db.doc('hkchk/a_' + it.xc), { xc: it.xc, name: it.name, ph: it.ph, why: x.why, day: ctx.day, at: now, ...(it.p.id ? { cust: it.p.id } : {}) });
    return { k: 'chk' };
  }
  let c;
  if (x.k === 'new') {
    const tz = TZOK(it) ? it.tz : '';
    c = Object.assign({ x: {}, name: it.name || 'לקוח כספית ' + it.xc }, tz ? { tz } : {}, it.ph ? { phone: it.ph, phx: [it.ph] } : {}, it.addr ? { addr: it.addr } : {},
      { xc: it.xc, at: now, upd: now, by: w.uid, src: 'import' });
    if (it.bal) c.ar = { bal: it.bal, open: Math.max(it.bal, 0), cr: Math.max(-it.bal, 0), at: now };
    tx.create(db.doc('cust/' + x.id), c);
  } else {
    const cc = B.custs[x.id];
    c = cc.data;
    if (!c.xc) tx.update(cc.ref, { xc: it.xc, upd: now, by: w.uid }); // רק xc – שום פרט קיים לא נדרס
  }
  if (it.bal) {
    const k = it.bal > 0 ? 'dr' : 'cr', ag = Math.abs(it.bal);
    const d = addDoc(B, db, x.obId, xDoc(B, w, { t: 'ob', k, no: '', day: ctx.day, cust: x.id, c, ag, batch: ctx.batch, note: 'יתרת הקפה בכספית ' + dm(ctx.day) }));
    if (x.k === 'match') {
      const cc = B.custs[x.id];
      if (k === 'dr') { cc.ar.bal += ag; cc.ar.open += ag; } else { cc.ar.bal -= ag; cc.ar.cr += ag; }
      cc.dirty = true; made.push(d); open[x.id] = it.open || [];
    }
  }
  tx.set(hk, { xc: it.xc, st: 'ok', cust: x.id, bal: it.bal, day: ctx.day, b: ctx.batch, at: now, upd: now });
  return { k: x.k, ob: it.bal ? 1 : 0, ag: it.bal };
}
function batchUpd(tx, bref, bs, o) {
  if (!o.n) return;
  if (!bs.exists) tx.set(bref, { kind: o.kind, name: o.name, at: o.now, by: o.by, n: o.n, sum: o.sum, st: 'ok', upd: o.now, src: 'hk' });
  else tx.update(bref, { n: FieldValue.increment(o.n), sum: FieldValue.increment(o.sum), upd: o.now });
}

// ---------- תמונה מהתוסף ----------
const partRef = (db, sid, k) => db.doc(`hkpend/${sid}_${k}`);
async function dropParts(db, sid, n) { if (!sid) return; const bt = db.batch(); for (let k = 0; k < n; k++) bt.delete(partRef(db, sid, k)); await bt.commit(); }
// snap(w, { day, rows }, now) – w = זהות הרובוט (מנהל סינתטי), בתוך הקשר העסק
async function snap(w, b, now) {
  onlyKeys(b, ['day', 'rows']);
  const today = ARD.ilDay(now);
  if (!realDay(b.day) || b.day > today || b.day < addDays(today, -BACK_DAYS)) throw bad('bad-day', 'יום לא תקין (היום, או עד 7 ימים אחורה)');
  const rows = rowsOf(b.rows);
  const db = T.tdb();
  const cs = await db.doc(CFG).get(), cfg = cs.exists ? cs.data() || {} : {};
  if (cfg.apr) throw pre('hk-busy', 'הייבוא הראשון באמצע אישור באפליקציה. ננסה בפעם הבאה.');
  if (cfg.st === 'on') return night(w, db, cfg, b.day, rows, now);
  // ממתין לאישור: חלקים חדשים ← טרנזקציה שמחליפה את הממתין ← מחיקת החלקים הישנים
  const ix = await scanCusts(db);
  await planOf(rows, ix, await obLiveDb(db));
  const pv = pvOf(rows);
  const sid = 's' + now.toString(36) + crypto.randomBytes(4).toString('hex'), parts = Math.ceil(rows.length / PART);
  const bt = db.batch();
  for (let k = 0; k < parts; k++) bt.set(partRef(db, sid, k), { sid, k, rows: rows.slice(k * PART, (k + 1) * PART).map(({ p, ...r }) => r) });
  await bt.commit();
  let old = null;
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(db.doc(CFG)), c = s.exists ? s.data() || {} : {};
      if (c.apr || c.st === 'on') throw pre('hk-busy', 'הייבוא הראשון כבר אושר או באמצע אישור. ננסה בפעם הבאה.');
      old = c.pend || null;
      tx.set(db.doc(CFG), { pend: { sid, day: b.day, at: now, n: rows.length, parts, pv }, upd: now }, { merge: true });
    });
  } catch (e) { await dropParts(db, sid, parts).catch(() => {}); throw e; }
  if (old && old.sid !== sid) await dropParts(db, old.sid, old.parts || 0).catch((er) => logger.warn('hk: drop old parts failed', { name: er && er.name }));
  const { chkL, ...cnt } = pv;
  return Object.assign({ st: 'pend', sid }, cnt);
}

// ---------- לילה (אחרי האישור) ----------
async function night(w, db, cfg, day, rows, now) {
  if (cfg.night && cfg.night.day && day < cfg.night.day) throw bad('old-day', 'כבר נקלטה תמונה של יום מאוחר יותר');
  if (cfg.first && cfg.first.day && day < cfg.first.day) throw bad('old-day', 'היום לפני הייבוא הראשון');
  // הקבוצה של היום (אם בוטלה – הבאה בתור)
  let batch = 'hk_' + ymd8(day);
  for (let v = 2; v <= 9; v++) { const s = await db.doc('arimp/' + batch).get(); if (!s.exists || s.get('st') !== 'void') break; batch = 'hk_' + ymd8(day) + '_' + v; }
  // שורות בלי hkc → התאמה (סריקת לקוחות רק אם יש כאלה)
  const hs = new Map();
  for (let i = 0; i < rows.length; i += 300) (await db.getAll(...rows.slice(i, i + 300).map((r) => db.doc('hkc/' + r.xc)))).forEach((s) => { if (s.exists) hs.set(s.id, s.data()); });
  const nw = rows.filter((r) => !hs.has(r.xc));
  if (nw.length) await planOf(nw, await scanCusts(db), await obLiveDb(db));
  const tot = { n: rows.length, same: 0, add: 0, sum: 0, neg: 0, nsum: 0, new: 0, match: 0, ob: 0, obSum: 0, del: 0, chk: 0 };
  for (let i = 0; i < rows.length; i += CH) {
    const L = rows.slice(i, i + CH).map((r) => Object.assign({}, r));
    let cnt = null;
    await db.runTransaction(async (tx) => {
      cnt = { same: 0, add: 0, sum: 0, neg: 0, nsum: 0, new: 0, match: 0, ob: 0, obSum: 0, del: 0, chk: 0 };
      const B = await new ARD.Book(tx, db, w, now).init();
      const bref = db.doc('arimp/' + batch);
      const [bs, ...hh] = await tx.getAll(bref, ...L.map((r) => db.doc('hkc/' + r.xc)));
      const get = async (id) => { const x = await B.needDoc(id); return x ? x.d : null; };
      // קריאות
      for (let j = 0; j < L.length; j++) {
        const it = L[j], h = hh[j].exists ? hh[j].data() : null;
        delete it.x; delete it.open;
        if (!h) { if (!it.p) it.p = { k: 'chk', why: 'changed' }; await readPlan(tx, B, db, it); it.mode = 'plan'; continue; }
        it.h = h;
        if (h.st === 'del') { it.mode = 'del0'; continue; }
        if (h.st !== 'ok') { it.mode = 'chk0'; continue; }
        let cid = h.cust, c = await B.needCust(cid);
        if (c.data && c.data.mv) { const c2 = await B.needCust(c.data.mv); if (c2.data && !c2.data.mv) { cid = c2.id; c = c2; } else c = { data: null }; } // לקוח שאוחד – ממשיכים בלקוח שנשאר
        if (!c.data) { it.mode = 'del'; continue; } // נמחק באפליקציה
        it.cid = cid;
        const diff = it.bal - (Number.isInteger(h.bal) ? h.bal : 0);
        it.diff = diff;
        if (diff === 0) { it.mode = cid !== h.cust ? 'relink' : 'same'; continue; }
        if (diff < 0) { it.mode = 'neg'; continue; }
        const base = `x_old_hk${ymd8(day)}_${it.xc}`;
        let id = base, v = 1;
        while (await get(id) && v < 9) { v++; id = base + '_' + v; }
        if (await get(id)) { it.mode = 'neg'; it.why = 'too-many-v'; continue; }
        it.oldId = id; it.mode = 'add';
        if (!B.custs[cid].open0) B.custs[cid].open0 = await B.openDocs(cid);
      }
      // כתיבות
      const made = [], open = {};
      const ctx = { day, batch };
      for (const it of L) {
        const hk = db.doc('hkc/' + it.xc);
        if (it.mode === 'plan') { const r = writePlan(tx, B, db, w, it, ctx, made, open); cnt[r.k]++; if (r.ob) { cnt.ob++; cnt.obSum += r.ag; } continue; }
        if (it.mode === 'del0') { cnt.del++; continue; }
        if (it.mode === 'chk0') { cnt.chk++; continue; }
        if (it.mode === 'del') { tx.update(hk, { st: 'del', upd: now }); cnt.del++; continue; }
        if (it.mode === 'same') { cnt.same++; continue; }
        if (it.mode === 'relink') { tx.update(hk, { cust: it.cid, upd: now }); cnt.same++; continue; }
        if (it.mode === 'neg') {
          tx.set(db.doc(`hkchk/n_${ymd8(day)}_${it.xc}`), { xc: it.xc, name: it.name, ph: it.ph, why: it.why || 'neg', day, at: now, cust: it.cid, diff: FieldValue.increment(it.diff) }, { merge: true });
          if (!it.why) tx.update(hk, { bal: it.bal, day, cust: it.cid, upd: now }); // היתרה החדשה = הבסיס להפרש הבא
          cnt.neg++; cnt.nsum += it.diff; continue;
        }
        // add: מסמך ישן אחד על ההפרש
        const cc = B.custs[it.cid];
        const d = addDoc(B, db, it.oldId, xDoc(B, w, { t: 'old', k: 'dr', no: 'כספית ' + dm(day), day, cust: it.cid, c: cc.data, ag: it.diff, batch, note: 'חיובי הקפה בכספית ' + dm(day).slice(0, 5) }));
        cc.ar.bal += it.diff; cc.ar.open += it.diff; cc.dirty = true;
        made.push(d); open[it.cid] = cc.open0 || [];
        tx.update(hk, { bal: it.bal, day, cust: it.cid, b: batch, upd: now });
        cnt.add++; cnt.sum += it.diff;
      }
      allocAll(B, open, made);
      B.flush();
      const nb = made.length + L.filter((it) => it.mode === 'plan' && it.x.k === 'new' && it.bal).length;
      batchUpd(tx, bref, bs, { kind: 'inv', name: 'לקוחות הקפה מכספית ' + dm(day), now, by: w.uid, n: nb, sum: cnt.sum + cnt.obSum });
    }, { maxAttempts: 30 });
    for (const k of Object.keys(cnt)) tot[k] += cnt[k];
  }
  const res = Object.assign({ day, at: now, batch }, tot);
  await db.doc(CFG).set({ night: res, upd: now }, { merge: true });
  return Object.assign({ st: 'night' }, res);
}

// ---------- פונקציות לאפליקציה (מנהל בלבד) ----------
async function who(request) {
  const w = await OC.who(request);
  if (w.role !== 'manager') throw deny('manager-only', 'לקוחות הקפה מכספית – מנהל בלבד');
  return w;
}
// hkGet() → { st:'none'|'pend'|'apr'|'on', pend?:{ sid, day, at, n, pv }, apr?:{ pos, n, c }, first?, night?, chk:[{ id, xc, name, ph, why, msg, day, at, cust?, diff? }] }
async function hkGet(request) {
  await who(request);
  onlyKeys(inputObject(request), []);
  const db = T.tdb();
  const [cs, q] = await Promise.all([db.doc(CFG).get(), db.collection('hkchk').orderBy('at', 'desc').limit(CHK_MAX).get()]);
  const c = cs.exists ? cs.data() || {} : {};
  const out = { st: c.st === 'on' ? 'on' : c.apr ? 'apr' : c.pend ? 'pend' : 'none', chk: q.docs.map((s) => Object.assign({ id: s.id }, s.data(), { msg: WHY[s.get('why')] || '' })) };
  if (c.pend && c.st !== 'on') out.pend = { sid: c.pend.sid, day: c.pend.day, at: c.pend.at, n: c.pend.n, pv: Object.assign({}, c.pend.pv, { chkL: (c.pend.pv && c.pend.pv.chkL || []).map((x) => Object.assign({}, x, { msg: WHY[x.why] || '' })) }) };
  if (c.apr) out.apr = { pos: c.apr.pos, n: c.apr.n, c: c.apr.c };
  if (c.first) out.first = c.first;
  if (c.night) out.night = c.night;
  return out;
}
async function loadParts(db, pend) {
  const ss = await db.getAll(...Array.from({ length: pend.parts }, (_, k) => partRef(db, pend.sid, k)));
  if (ss.some((s) => !s.exists)) throw pre('hk-changed', 'התמונה הממתינה השתנתה. רעננו ונסו שוב.');
  return ss.flatMap((s) => s.get('rows') || []);
}
// hkApprove({ sid }) – "אשר ייבוא ראשון". עד CALL_ROWS שורות בקריאה; done:false → קוראים שוב עם אותו sid. → { done, pos, n, c:{ new, match, ob, chk, sum } }
async function hkApprove(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['sid']);
  if (typeof input.sid !== 'string' || !SID_RE.test(input.sid)) throw bad('bad-sid', 'מזהה תמונה חסר');
  const db = T.tdb(), cref = db.doc(CFG);
  const c0 = (await cref.get()).data() || {};
  if (c0.st === 'on') throw pre('hk-done', 'הייבוא הראשון כבר אושר');
  const pend = c0.pend;
  if (!pend || pend.sid !== input.sid) throw pre('hk-changed', 'אין תמונה ממתינה כזו (אולי הגיעה תמונה חדשה). רעננו ונסו שוב.');
  let rows = await loadParts(db, pend);
  if (!c0.apr) {
    // התחלה: ההתאמה מחושבת מחדש עכשיו ונשמרת בחלקים (כל המנות מבצעות בדיוק אותה החלטה)
    await planOf(rows, await scanCusts(db), await obLiveDb(db));
    const batch = 'hk0_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), now = Date.now();
    await db.runTransaction(async (tx) => {
      const s = await tx.get(cref), c = s.data() || {};
      if (c.st === 'on') throw pre('hk-done', 'הייבוא הראשון כבר אושר');
      if (!c.pend || c.pend.sid !== input.sid) throw pre('hk-changed', 'התמונה הממתינה השתנתה. רעננו ונסו שוב.');
      if (c.apr) return; // קריאה מקבילה כבר התחילה
      for (let k = 0; k < pend.parts; k++) tx.set(partRef(db, pend.sid, k), { sid: pend.sid, k, rows: rows.slice(k * PART, (k + 1) * PART) });
      tx.update(cref, { apr: { sid: pend.sid, batch, pos: 0, n: rows.length, day: pend.day, at: now, by: w.uid, c: { new: 0, match: 0, ob: 0, chk: 0, sum: 0 } }, upd: now });
    });
    rows = await loadParts(db, pend);
  }
  let left = CALL_ROWS, st = null;
  while (left > 0) {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(cref), c = s.data() || {}, apr = c.apr;
      if (!apr || apr.sid !== input.sid) throw pre('hk-changed', 'האישור הופסק. רעננו ונסו שוב.');
      st = apr;
      if (apr.pos >= apr.n) return;
      const L = rows.slice(apr.pos, apr.pos + CH).map((r) => Object.assign({}, r));
      const B = await new ARD.Book(tx, db, w).init();
      const bref = db.doc('arimp/' + apr.batch);
      const bs = await tx.get(bref);
      for (const it of L) await readPlan(tx, B, db, it);
      const made = [], open = {}, ctx = { day: apr.day, batch: apr.batch };
      const cc = Object.assign({}, apr.c);
      let nb = 0;
      for (const it of L) { const r = writePlan(tx, B, db, w, it, ctx, made, open); cc[r.k]++; if (r.ob) { cc.ob++; cc.sum += r.ag; nb++; } }
      allocAll(B, open, made);
      B.flush();
      batchUpd(tx, bref, bs, { kind: 'ob', name: 'לקוחות הקפה מכספית – ייבוא ראשון', now: B.now, by: w.uid, n: nb, sum: cc.sum - apr.c.sum });
      const pos = apr.pos + L.length;
      st = Object.assign({}, apr, { pos, c: cc });
      if (pos < apr.n) tx.update(cref, { 'apr.pos': pos, 'apr.c': cc, upd: B.now });
      else tx.update(cref, { st: 'on', first: { batch: apr.batch, day: apr.day, at: B.now, by: w.uid, n: apr.n, c: cc }, apr: FieldValue.delete(), pend: FieldValue.delete(), upd: B.now });
    }, { maxAttempts: 30 });
    if (st.pos >= st.n) break;
    left -= CH;
  }
  const done = st.pos >= st.n;
  if (done) await dropParts(db, pend.sid, pend.parts).catch((er) => logger.warn('hk: drop parts failed', { name: er && er.name }));
  return { done, pos: st.pos, n: st.n, c: st.c, batch: st.batch };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`hk-import: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
exports.hkGet = onCall({ memory: '512MiB', timeoutSeconds: 60 }, wrap('hkGet', hkGet));
exports.hkApprove = onCall({ memory: '512MiB', timeoutSeconds: 300 }, wrap('hkApprove', hkApprove));
Object.defineProperty(exports, '_core', { enumerable: false, value: { snap, rowOf, rowsOf, planOf, pvOf, tzOf, obSlot, MAX_ROWS, CH, CALL_ROWS, WHY } });
