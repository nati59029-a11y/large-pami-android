'use strict';
// קופה ש6 (POS:M6) – קטלוג מוצרים: עריכה בניהול, הוספה מהירה מהקופה, ברקוד פנימי, שינוי מחירים קבוצתי, תור מדבקות, התראות.
// רק עסק במבנה החדש (b/{bizId}) ותוספת 'pos' דלוקה – כמו pos.js (שלב 0). כל כתיבה רק מכאן; המכשיר קורא את prod לפי הכללים הקיימים.
// כלל: מוסיפים שדות בלבד. prod.price נשאר בשקלים כולל מע"מ (כמו היום). שדות חדשים באגורות: minP, ph.old/new.
//
//   posProdSave({ id?, name, price, barcode?, autoBc?, bcs?, packs?, sku?, cat?, cost?, minP?, alias?, season?, on?, track?, minQ?, loc? })
//       מנהל. מוצר חדש – חובה: שם, מחיר, קטגוריה ועלות (P2); בלי ברקוד ועם autoBc – ברקוד פנימי (B2); בלי מק"ט – מספר רץ (P4).
//       ברקוד (ראשי / נוסף / ארגז) שכבר שייך למוצר אחר – נדחה (P19, א 5.2). שינוי מחיר → prod/{id}/ph (P23).
//       → { id, sku, barcode, flags }
//   posProdQuick({ reqId, bc, name, price, cat? })  – קופאי / אחראי / מנהל: ברקוד לא מוכר בקופה (B5). המוצר מסומן fromPos + missing,
//       והמנהל מקבל התראה (posalert). אותו reqId פעמיים – אותה תוצאה. ברקוד שכבר קיים – מחזיר את המוצר הקיים (dup), לא יוצר שני.
//   posBcGen({ n })        – מנהל: n (1–50) ברקודים פנימיים פנויים, EAN-13 עם הקידומת (bc.intPrefix, ברירת מחדל 200).
//   posPriceBulk({ pids? | cat?, mode:'pct'|'add'|'set', val, dry? }) – מנהל: שינוי מחיר קבוצתי (P22). dry = תצוגה מקדימה בלבד.
//   posLbl({ op:'add', items:[{pid,n,kind}] } | { op:'list' } | { op:'done', ids:[] }) – תור מדבקות ושלטי מדף (B13). מנהל / אחראי משמרת.
//   posAlert({ op:'list' } | { op:'close', id })     – התראות למנהל (מוצר שנוצר בקופה).
//
// אוספים (חדשים, תחת העסק): posbc/{bc} – אינדקס ייחודיות ברקוד · poslbl · posalert · prod/{id}/ph · poscfg/ctr6 (מונים: sku, bc)
//   posreq/pq_{reqId} – סימון נגד כפילות של הוספה מהירה (אותו אוסף של שלב 0, שאיש לא קורא מהאפליקציה).

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const ORD = require('./orders')._core;
const BC = require('./lib/pos-barcode');
const ST = require('./lib/pos-stock');

const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const nf = (reason, msg) => new HttpsError('not-found', msg, { reason });

const NAME_MAX = 40; // cat.nameMax
const SKU0 = 10000;  // מק"ט רץ מתחיל מ-10001
const BULK_MAX = 2000;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const REQ_RE = /^[A-Za-z0-9_-]{8,64}$/;
const BR_RE = /^[A-Za-z0-9_-]{1,40}$/;

async function gate(request, o) {
  const who = await requireStaff(request);
  if (!who.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש');
  if (!who.superadmin) T.requireFeature(who.biz, 'pos');
  const mgr = who.role === 'manager';
  if (o.mgr && !mgr) throw deny('not-manager', 'הפעולה זמינה למנהל בלבד');
  if (o.lead && !(mgr || hasPerm(who, 'posMgr'))) throw deny('not-lead', 'הפעולה זמינה לאחראי משמרת ולמנהל');
  if (o.sell && !(mgr || hasPerm(who, 'pos') || hasPerm(who, 'posMgr'))) throw deny('not-pos', 'אין לך הרשאת קופה');
  return { who, db: T.tdb() };
}
const only = (o, keys) => { for (const k of Object.keys(o)) if (!keys.includes(k)) throw bad('bad-field', 'שדה לא מוכר: ' + String(k).slice(0, 30)); };
const txt = (v, max, label, req) => ORD.txt(v == null ? '' : String(v), max, 'bad-' + label, label, req);
const shek = (v, label) => ORD.money(typeof v === 'string' ? Number(v) : v, label); // שקלים, עד 2 ספרות
const ag = (sh) => Math.round(sh * 100);
const strList = (v, max, each, label) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) throw bad('bad-' + label, `${label}: עד ${max}`);
  return [...new Set(v.map((x) => txt(x, each, label, false)).filter(Boolean))];
};
function bcOf(v, label) {
  const c = BC.clean(v);
  if (!c) return '';
  const r = BC.check(c);
  if (!r.ok) throw bad('bad-barcode', `${label || 'ברקוד'} לא תקין${r.why === 'check' ? ' (ספרת ביקורת)' : ''}`);
  return c;
}
function brMap(v, fn, label) {
  if (v == null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 30) throw bad('bad-' + label, label + ' לא תקין');
  const o = {};
  for (const [k, x] of Object.entries(v)) { if (!BR_RE.test(k)) throw bad('bad-br', 'סניף לא תקין'); const y = fn(x); if (y !== null && y !== undefined && y !== '') o[k] = y; }
  return o;
}
const ctrRef = (db) => db.doc('poscfg/ctr6');
async function intPrefix(db) {
  const s = await db.doc('poscfg/main').get();
  const p = s.exists && s.get('cfg') && s.get('cfg')['bc.intPrefix'];
  return typeof p === 'string' && /^[0-9]{1,6}$/.test(p) ? p : BC.INT0;
}

// ---------- posProdSave ----------
async function prodSave(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request, { mgr: true });
  only(input, ['id', 'name', 'price', 'barcode', 'autoBc', 'bcs', 'packs', 'sku', 'cat', 'cost', 'minP', 'alias', 'season', 'on', 'track', 'minQ', 'loc']);
  const isNew = input.id == null || input.id === '';
  const id = isNew ? 'p' + crypto.randomBytes(12).toString('hex') : input.id;
  if (!ID_RE.test(id)) throw bad('bad-id', 'מוצר לא תקין');
  const d = { name: txt(input.name, NAME_MAX, 'name', true) };
  if (input.price == null || input.price === '') throw bad('bad-price', 'מחיר – חובה');
  d.price = shek(input.price, 'מחיר');
  let barcode = input.barcode === undefined ? undefined : bcOf(input.barcode);
  const bcs = input.bcs === undefined ? undefined : strList(input.bcs, 20, 30, 'bcs').map((b) => bcOf(b, 'ברקוד נוסף'));
  let packs;
  if (input.packs !== undefined) {
    if (!Array.isArray(input.packs) || input.packs.length > 10) throw bad('bad-packs', 'ברקודי ארגז: עד 10');
    packs = input.packs.map((x) => {
      if (!x || typeof x !== 'object') throw bad('bad-packs', 'ברקוד ארגז לא תקין');
      const q = Number(x.qty); if (!Number.isInteger(q) || q < 2 || q > 10000) throw bad('bad-packs', 'כמות בארגז: מספר שלם 2–10,000');
      return { bc: bcOf(x.bc, 'ברקוד ארגז'), qty: q };
    }).filter((x) => x.bc);
  }
  const sku = input.sku == null || input.sku === '' ? '' : txt(input.sku, 30, 'sku', false);
  const cat = input.cat == null || input.cat === '' ? '' : ORD.idOf(input.cat, 'קטגוריה');
  const cost = input.cost == null || input.cost === '' ? null : shek(input.cost, 'עלות');
  const minP = input.minP == null || input.minP === '' ? null : ag(shek(input.minP, 'מחיר מינימום'));
  const alias = input.alias === undefined ? undefined : strList(input.alias, 20, 40, 'alias');
  const season = input.season === undefined ? undefined : strList(input.season, 10, 20, 'season');
  if (input.track != null && !['', 'lot', 'exp'].includes(input.track)) throw bad('bad-track', 'מעקב לא תקין');
  const minQ = brMap(input.minQ, (x) => { const n = Number(x); if (x === '' || x == null) return null; if (!Number.isInteger(n) || n < 0 || n > 1e6) throw bad('bad-minQ', 'מלאי מינימום: מספר שלם'); return n; }, 'minQ');
  const loc = brMap(input.loc, (x) => txt(x, 30, 'loc', false), 'loc');
  if (isNew) {
    if (!cat) throw bad('bad-cat', 'קטגוריה – חובה במוצר חדש');
    if (cost == null) throw bad('bad-cost', 'עלות – חובה במוצר חדש');
    if (!(d.price > 0)) throw bad('bad-price', 'מחיר – חובה במוצר חדש');
  }
  const now = Date.now();
  const pref = db.doc('prod/' + id);
  const pfx = input.autoBc === true ? await intPrefix(db) : BC.INT0;
  const res = await db.runTransaction(async (tx) => {
    // ---- קריאות בלבד ----
    const [ps, cs, cos] = await tx.getAll(pref, ctrRef(db), db.doc(`prod/${id}/p/cost`));
    if (isNew && ps.exists) throw pre('exists', 'המוצר כבר קיים');
    if (!isNew && !ps.exists) throw nf('no-prod', 'המוצר לא נמצא');
    const old = ps.exists ? ps.data() : {};
    if (cat) { const c = await tx.get(db.doc('cat/' + cat)); if (!c.exists) throw nf('no-cat', 'הקטגוריה לא נמצאה'); }
    const main = barcode === undefined ? (old.barcode || '') : barcode;
    const next = { barcode: main, bcs: bcs === undefined ? (old.bcs || []) : bcs.filter((b) => b !== main), packs: packs === undefined ? (old.packs || []) : packs };
    const codes = ST.codesOf(next);
    if (codes.length !== next.bcs.length + next.packs.length + (main ? 1 : 0)) throw bad('bad-barcode', 'אותו ברקוד מופיע פעמיים במוצר');
    const taken = await ST.bcTaken((r) => tx.get(r), db, codes, id);
    if (taken.length) throw pre('bc-taken', `הברקוד ${taken[0].bc} כבר שייך למוצר אחר`);
    const removed = ST.codesOf(old).filter((c) => !codes.includes(c));
    const unindex = removed.length ? await ST.bcUnindex(tx, db, id, removed) : () => {};
    let ctr = { sku: cs.exists && Number.isInteger(cs.get('sku')) ? cs.get('sku') : 0, bc: cs.exists && Number.isInteger(cs.get('bc')) ? cs.get('bc') : 0 };
    const ctr0 = Object.assign({}, ctr);
    let skuOut = sku || old.sku || '';
    if (!skuOut) {
      for (let k = 0; k < 5 && !skuOut; k++) {
        ctr.sku++;
        const q = await tx.get(db.collection('prod').where('sku', '==', String(SKU0 + ctr.sku)).limit(1));
        if (q.empty) skuOut = String(SKU0 + ctr.sku);
      }
      if (!skuOut) throw pre('sku-busy', 'לא נמצא מק"ט פנוי. נסו שוב.');
    } else if (skuOut !== (old.sku || '')) {
      const q = await tx.get(db.collection('prod').where('sku', '==', skuOut).limit(2));
      if (q.docs.some((x) => x.id !== id)) throw pre('sku-taken', 'המק"ט כבר שייך למוצר אחר');
    }
    if (!next.barcode && input.autoBc === true) {
      for (let k = 0; k < 10 && !next.barcode; k++) {
        ctr.bc++;
        const cand = BC.internal(pfx, ctr.bc);
        if (!(await ST.bcTaken((r) => tx.get(r), db, [cand], id)).length) next.barcode = cand;
      }
      if (!next.barcode) throw pre('bc-busy', 'לא נמצא ברקוד פנימי פנוי. נסו שוב.');
    }
    const costKnown = cost != null ? cost : (cos.exists && typeof cos.get('cost') === 'number' ? cos.get('cost') : null);
    // ---- כתיבות ----
    if (ctr.sku !== ctr0.sku || ctr.bc !== ctr0.bc) tx.set(ctrRef(db), { sku: ctr.sku, bc: ctr.bc, upd: now }, { merge: true });
    unindex();
    const doc = Object.assign({}, d, { barcode: next.barcode, sku: skuOut, upd: now });
    if (next.bcs.length || old.bcs) doc.bcs = next.bcs;
    if (next.packs.length || old.packs) doc.packs = next.packs;
    if (cat) doc.cat = cat;
    if (minP !== null) doc.minP = minP;
    if (alias !== undefined) doc.alias = alias;
    if (season !== undefined) doc.season = season;
    if (input.on !== undefined) doc.on = input.on !== false;
    if (input.track !== undefined) doc.track = input.track || '';
    if (minQ !== undefined) doc.minQ = minQ;
    if (loc !== undefined) doc.loc = loc;
    const merged = Object.assign({}, old, doc);
    if (old.bcRaw && next.barcode && BC.check(next.barcode).ok) { delete merged.bcRaw; if (!isNew) doc.bcRaw = FieldValue.delete(); }
    if (input.minP === '' && old.minP != null && !isNew) doc.minP = FieldValue.delete();
    const fl = ST.prodFlags(merged, costKnown); // נשמר בניהול = נבדק: fromPos יורד
    doc.flags = fl;
    if (isNew) { Object.assign(doc, { on: input.on !== false, q: {}, at: now, by: who.uid, src: 'admin' }); tx.set(pref, doc); } else tx.update(pref, doc);
    ST.bcIndex(tx, db, id, next);
    if (cost != null) tx.set(db.doc(`prod/${id}/p/cost`), { cost, at: now, by: who.uid });
    if (!isNew && typeof old.price === 'number' && old.price !== d.price) tx.set(pref.collection('ph').doc(), { old: ag(old.price), new: ag(d.price), by: who.uid, at: now, why: 'edit' });
    if (isNew) tx.set(pref.collection('ph').doc(), { old: null, new: ag(d.price), by: who.uid, at: now, why: 'new' });
    return { id, sku: skuOut, barcode: next.barcode, flags: fl, priceChanged: !isNew && old.price !== d.price };
  });
  return Object.assign({ ok: true }, res);
}

// ---------- posProdQuick ----------
async function prodQuick(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request, { sell: true });
  only(input, ['reqId', 'bc', 'name', 'price', 'cat', 'dev']);
  if (typeof input.reqId !== 'string' || !REQ_RE.test(input.reqId)) throw bad('bad-req', 'מזהה בקשה חסר');
  const bc = bcOf(input.bc);
  if (!bc) throw bad('bad-barcode', 'ברקוד – חובה');
  const name = txt(input.name, NAME_MAX, 'name', true);
  const price = shek(input.price, 'מחיר');
  if (!(price > 0)) throw bad('bad-price', 'מחיר – חובה');
  const cat = input.cat == null || input.cat === '' ? '' : ORD.idOf(input.cat, 'קטגוריה');
  const mark = db.doc('posreq/pq_' + input.reqId);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const m = await tx.get(mark);
    if (m.exists) return Object.assign({ ok: true, again: true }, m.get('res'));
    if (cat) { const cs = await tx.get(db.doc('cat/' + cat)); if (!cs.exists) throw nf('no-cat', 'הקטגוריה לא נמצאה'); }
    const taken = await ST.bcTaken((r) => tx.get(r), db, [bc], '');
    if (taken.length) {
      const ps = await tx.get(db.doc('prod/' + taken[0].pid));
      const res = { id: taken[0].pid, dup: true, name: ps.exists ? ps.get('name') : '', price: ps.exists ? ps.get('price') : null };
      tx.set(mark, { t: now, by: who.uid, res });
      return Object.assign({ ok: true }, res);
    }
    const cs = await tx.get(ctrRef(db));
    let n = cs.exists && Number.isInteger(cs.get('sku')) ? cs.get('sku') : 0, sku = '';
    for (let k = 0; k < 5 && !sku; k++) {
      n++;
      const q = await tx.get(db.collection('prod').where('sku', '==', String(SKU0 + n)).limit(1));
      if (q.empty) sku = String(SKU0 + n);
    }
    tx.set(ctrRef(db), { sku: n, upd: now }, { merge: true });
    const id = 'p' + crypto.createHash('sha1').update(who.bizId + '|q|' + input.reqId).digest('hex').slice(0, 24);
    const doc = { name, price, barcode: bc, sku, on: true, q: {}, at: now, by: who.uid, upd: now, src: 'pos', flags: ['fromPos', 'missing'] };
    if (cat) doc.cat = cat;
    tx.create(db.doc('prod/' + id), doc);
    ST.bcIndex(tx, db, id, doc);
    tx.set(db.doc(`prod/${id}/ph/new`), { old: null, new: ag(price), by: who.uid, at: now, why: 'new' });
    tx.set(db.collection('posalert').doc(), { k: 'newProd', pid: id, name, by: who.uid, byName: (who.staff && typeof who.staff.get === 'function' && who.staff.get('name')) || '', at: now, st: 'open', dev: typeof input.dev === 'string' ? input.dev.slice(0, 10) : '' });
    const res = { id, sku, name, price, created: true };
    tx.set(mark, { t: now, by: who.uid, res });
    return Object.assign({ ok: true }, res);
  });
}

// ---------- posBcGen ----------
async function bcGen(request) {
  const input = inputObject(request);
  const { db } = await gate(request, { mgr: true });
  only(input, ['n']);
  const n = Number.isInteger(input.n) ? input.n : 1;
  if (n < 1 || n > 50) throw bad('bad-n', 'בין 1 ל-50 ברקודים');
  const pfx = await intPrefix(db);
  return db.runTransaction(async (tx) => {
    const cs = await tx.get(ctrRef(db));
    const start = (cs.exists && Number.isInteger(cs.get('bc')) ? cs.get('bc') : 0) + 1;
    const out = [];
    let k = 0;
    for (; k < n + 10 && out.length < n; k++) {
      const c = BC.internal(pfx, start + k);
      const s = await tx.get(db.doc('posbc/' + c));
      if (!s.exists) out.push(c);
    }
    tx.set(ctrRef(db), { bc: start + k - 1, upd: Date.now() }, { merge: true });
    return { ok: true, codes: out };
  });
}

// ---------- posPriceBulk ----------
function newPrice(old, mode, val) {
  const o = typeof old === 'number' ? old : 0;
  const v = mode === 'pct' ? o * (1 + val / 100) : mode === 'add' ? o + val : val;
  return Math.round(Math.max(0, v) * 100) / 100;
}
async function priceBulk(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request, { mgr: true });
  only(input, ['pids', 'cat', 'mode', 'val', 'dry']);
  if (!['pct', 'add', 'set'].includes(input.mode)) throw bad('bad-mode', 'סוג שינוי לא תקין');
  const val = Number(input.val);
  if (!Number.isFinite(val) || (input.mode === 'pct' && (val < -90 || val > 500)) || Math.abs(val) > 100000) throw bad('bad-val', 'ערך שינוי לא תקין');
  let snaps = [];
  if (Array.isArray(input.pids)) {
    if (!input.pids.length || input.pids.length > BULK_MAX) throw bad('bad-pids', `מוצרים: 1 עד ${BULK_MAX}`);
    const ids = [...new Set(input.pids.map((x) => ORD.idOf(x, 'מוצר')))];
    for (let i = 0; i < ids.length; i += 300) snaps.push(...(await db.getAll(...ids.slice(i, i + 300).map((x) => db.doc('prod/' + x)))));
    snaps = snaps.filter((s) => s.exists);
  } else if (input.cat) {
    const cat = ORD.idOf(input.cat, 'קטגוריה');
    snaps = (await db.collection('prod').where('cat', '==', cat).limit(BULK_MAX + 1).get()).docs;
    if (snaps.length > BULK_MAX) throw bad('too-many', `יותר מ-${BULK_MAX} מוצרים בקטגוריה`);
  } else throw bad('bad-input', 'בחרו מוצרים או קטגוריה');
  const items = snaps.map((s) => ({ id: s.id, name: s.get('name') || '', old: s.get('price'), new: newPrice(s.get('price'), input.mode, val), barcode: s.get('barcode') || '' }))
    .filter((x) => x.new !== x.old);
  if (input.dry !== false) return { ok: true, dry: true, n: items.length, items: items.slice(0, 500) };
  const now = Date.now();
  for (let i = 0; i < items.length; i += 200) {
    const part = items.slice(i, i + 200);
    await db.runTransaction(async (tx) => {
      const cur = await tx.getAll(...part.map((x) => db.doc('prod/' + x.id)));
      cur.forEach((s, j) => {
        if (!s.exists) return;
        const nw = newPrice(s.get('price'), input.mode, val);
        if (nw === s.get('price')) return;
        const fl = (s.get('flags') || []).filter((f) => !(f === 'noPrice' && nw > 0));
        tx.update(s.ref, { price: nw, upd: now, flags: fl });
        tx.set(s.ref.collection('ph').doc(), { old: typeof s.get('price') === 'number' ? ag(s.get('price')) : null, new: ag(nw), by: who.uid, at: now, why: 'bulk' });
        part[j].new = nw;
      });
    });
  }
  return { ok: true, dry: false, n: items.length, items: items.slice(0, 500) };
}

// ---------- posLbl ----------
async function lbl(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request, { lead: true });
  const op = input.op;
  if (op === 'list') {
    only(input, ['op']);
    const q = await db.collection('poslbl').where('done', '==', false).limit(500).get();
    const L = q.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (a.at || 0) - (b.at || 0));
    const ids = [...new Set(L.map((x) => x.pid))];
    const P = new Map();
    for (let i = 0; i < ids.length; i += 300) (await db.getAll(...ids.slice(i, i + 300).map((x) => db.doc('prod/' + x)))).forEach((s) => { if (s.exists) P.set(s.id, s.data()); });
    return { ok: true, items: L.map((x) => { const p = P.get(x.pid) || {}; return { id: x.id, pid: x.pid, n: x.n, kind: x.kind, why: x.why || '', name: p.name || '', price: p.price, barcode: p.barcode || '', gone: !P.has(x.pid) }; }) };
  }
  if (op === 'add') {
    only(input, ['op', 'items', 'why']);
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 500) throw bad('bad-items', 'עד 500 מדבקות בפעם');
    const why = ['new', 'rcv', 'price', 'manual'].includes(input.why) ? input.why : 'manual';
    const now = Date.now();
    const b = db.batch();
    for (const it of input.items) {
      const pid = ORD.idOf(it && it.pid, 'מוצר');
      const n = Number.isInteger(it.n) && it.n >= 1 && it.n <= 200 ? it.n : 1;
      const kind = it.kind === 'shelf' ? 'shelf' : 'lbl';
      b.set(db.collection('poslbl').doc(), { pid, n, kind, why, done: false, by: who.uid, at: now });
    }
    await b.commit();
    return { ok: true, n: input.items.length };
  }
  if (op === 'done') {
    only(input, ['op', 'ids']);
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 500) throw bad('bad-ids', 'עד 500');
    const b = db.batch();
    for (const id of input.ids) b.update(db.doc('poslbl/' + ORD.idOf(id, 'מדבקה')), { done: true, doneAt: Date.now(), doneBy: who.uid });
    await b.commit().catch((e) => { if (e && e.code === 5) throw nf('no-lbl', 'מדבקה לא נמצאה'); throw e; });
    return { ok: true };
  }
  throw bad('bad-op', 'פעולה לא מוכרת');
}

// ---------- posAlert ----------
async function alert(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request, { mgr: true });
  if (input.op === 'list') {
    only(input, ['op']);
    const q = await db.collection('posalert').where('st', '==', 'open').limit(200).get();
    return { ok: true, items: q.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (b.at || 0) - (a.at || 0)) };
  }
  if (input.op === 'close') {
    only(input, ['op', 'id']);
    const ref = db.doc('posalert/' + ORD.idOf(input.id, 'התראה'));
    const s = await ref.get();
    if (!s.exists) throw nf('no-alert', 'ההתראה לא נמצאה');
    await ref.update({ st: 'done', doneBy: who.uid, doneAt: Date.now() });
    return { ok: true };
  }
  throw bad('bad-op', 'פעולה לא מוכרת');
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`pos-catalog: ${name} failed`, { name: e && e.name, code: e && e.code, msg: String(e && e.message || '').slice(0, 120) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
exports.posProdSave = onCall(wrap('posProdSave', prodSave));
exports.posProdQuick = onCall(wrap('posProdQuick', prodQuick));
exports.posBcGen = onCall(wrap('posBcGen', bcGen));
exports.posPriceBulk = onCall({ timeoutSeconds: 300, memory: '512MiB' }, wrap('posPriceBulk', priceBulk));
exports.posLbl = onCall(wrap('posLbl', lbl));
exports.posAlert = onCall(wrap('posAlert', alert));
Object.defineProperty(exports, '_core', { enumerable: false, value: { newPrice, NAME_MAX, SKU0 } });
