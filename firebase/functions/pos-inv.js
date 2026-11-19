'use strict';
// קופה ש6 (POS:M6) – ספירת מלאי (I4, I5; א 5.13). רק במבנה החדש ועם תוספת 'pos'.
// סדר: פתיחה (אחראי משמרת / מנהל – inv.countRole) ← סריקה (כמה מכשירים יכולים לספור במקביל) ← "סיימתי" ← אישור מנהל (inv.countApprove).
// **המלאי לא משתנה עד אישור המנהל.** באישור: לכל מוצר שנספר, הפרש = נספר − המלאי עכשיו, ותנועת stockLog why:'cnt' (lib/pos-stock.js).
// מוצר בתחום שלא נספר – לא משתנה (מופיע בדוח "לא נספר"). כמות שלילית לא נספרת.
//
//   posCnt({ op:'open', br, scope:'all'|'cat'|'list', cat?, pids?, name? }) → { id }       (sys = צילום המלאי בפתיחה, לדוח בלבד)
//   posCnt({ op:'add', id, items:[{ pid, n, set? }] })   → { counted }  – n נוסף לספירה (סריקה = 1); set:true – מחליף. עד 300 לקריאה.
//   posCnt({ op:'submit', id })                            → { st:'review' }
//   posCnt({ op:'approve', id })                           → { applied, left, st } – מנהל. במנות של 150 מוצרים; קוראים שוב עד left = 0.
//   posCnt({ op:'cancel', id })                            → מנהל / מי שפתח, רק לפני אישור
//   posCnt({ op:'list' })                                  → 30 הספירות האחרונות (בלי שורות)
//   posCnt({ op:'get', id })                               → הספירה + שורות { pid, name, sys, cnt, now } – הדוח (דוח פערים אחרי אישור)
//
// poscnt/{id} (חדש): { br, scope, cat?, name, st:'open'|'review'|'apply'|'done'|'cancel', sys:{pid:n}, c:{pid:n}, done:{pid:d},
//                       by, at, sub?{by,at}, appr?{by,at}, diffs, units }  – c ו-sys עד ~6,000 מוצרים (מסמך עד 1MB).

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const ORD = require('./orders')._core;
const ST = require('./lib/pos-stock');

const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const nf = (reason, msg) => new HttpsError('not-found', msg, { reason });
const BR_RE = /^[A-Za-z0-9_-]{1,40}$/;
const SCOPE_MAX = 8000;
const ADD_MAX = 300;
const STEP = 150;
const only = (o, keys) => { for (const k of Object.keys(o)) if (!keys.includes(k)) throw bad('bad-field', 'שדה לא מוכר: ' + String(k).slice(0, 30)); };
const qOf = (p, br) => (p && p.q && typeof p.q[br] === 'number' ? p.q[br] : 0);

async function gate(request) {
  const who = await requireStaff(request);
  if (!who.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש');
  if (!who.superadmin) T.requireFeature(who.biz, 'pos');
  who.mgr = who.role === 'manager';
  who.lead = who.mgr || hasPerm(who, 'posMgr');
  if (!who.lead) throw deny('not-lead', 'ספירת מלאי – אחראי משמרת או מנהל');
  return { who, db: T.tdb() };
}
const brOk = (who, br) => who.mgr || !who.staff || typeof who.staff.get !== 'function' || !Array.isArray(who.staff.get('br')) || who.staff.get('br').includes(br);

async function cnt(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request);
  const op = input.op;
  const ref = () => db.doc('poscnt/' + ORD.idOf(input.id, 'ספירה'));
  if (op === 'open') {
    only(input, ['op', 'br', 'scope', 'cat', 'pids', 'name']);
    const br = typeof input.br === 'string' && BR_RE.test(input.br) ? input.br : '_';
    if (!brOk(who, br)) throw deny('foreign-br', 'אין לך הרשאה לסניף הזה');
    const scope = ['all', 'cat', 'list'].includes(input.scope) ? input.scope : 'all';
    let snaps;
    if (scope === 'cat') {
      const cat = ORD.idOf(input.cat, 'קטגוריה');
      snaps = (await db.collection('prod').where('cat', '==', cat).limit(SCOPE_MAX + 1).get()).docs;
      const subs = (await db.collection('cat').where('parent', '==', cat).get()).docs.map((d) => d.id);
      for (let i = 0; i < subs.length; i += 30) snaps.push(...(await db.collection('prod').where('sub', 'in', subs.slice(i, i + 30)).get()).docs);
    } else if (scope === 'list') {
      if (!Array.isArray(input.pids) || !input.pids.length || input.pids.length > SCOPE_MAX) throw bad('bad-pids', 'רשימת מוצרים לא תקינה');
      const ids = [...new Set(input.pids.map((x) => ORD.idOf(x, 'מוצר')))];
      snaps = [];
      for (let i = 0; i < ids.length; i += 300) snaps.push(...(await db.getAll(...ids.slice(i, i + 300).map((x) => db.doc('prod/' + x)))).filter((s) => s.exists));
    } else snaps = (await db.collection('prod').select('q', 'on').limit(SCOPE_MAX + 1).get()).docs;
    snaps = snaps.filter((s, i, A) => A.findIndex((x) => x.id === s.id) === i && s.get('on') !== false);
    if (snaps.length > SCOPE_MAX) throw bad('too-many', `יותר מ-${SCOPE_MAX} מוצרים – ספרו לפי קטגוריה`);
    const sys = {};
    for (const s of snaps) sys[s.id] = qOf(s.data(), br);
    const name = ORD.txt(input.name == null ? '' : String(input.name), 40, 'bad-name', 'שם') || (scope === 'all' ? 'ספירה מלאה' : 'ספירה חלקית');
    const d = db.collection('poscnt').doc();
    await d.set(Object.assign({ br, scope, name, st: 'open', sys, c: {}, done: {}, by: who.uid, at: Date.now(), n: snaps.length }, scope === 'cat' ? { cat: input.cat } : {}));
    return { ok: true, id: d.id, n: snaps.length };
  }
  if (op === 'add') {
    only(input, ['op', 'id', 'items']);
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > ADD_MAX) throw bad('bad-items', `עד ${ADD_MAX} שורות בקריאה`);
    const items = input.items.map((x) => {
      const n = Number(x && x.n);
      if (!Number.isInteger(n) || n < 0 || n > 1e6) throw bad('bad-qty', 'כמות: מספר שלם, 0 ומעלה');
      return { pid: ORD.idOf(x.pid, 'מוצר'), n, set: x.set === true };
    });
    const r = ref();
    return db.runTransaction(async (tx) => {
      const s = await tx.get(r);
      if (!s.exists) throw nf('no-cnt', 'הספירה לא נמצאה');
      if (s.get('st') !== 'open') throw pre('cnt-closed', 'הספירה כבר הוגשה');
      if (!brOk(who, s.get('br'))) throw deny('foreign-br', 'אין לך הרשאה לסניף הזה');
      const sys = s.get('sys') || {};
      const out = [];
      const upd = {};
      const extra = items.filter((x) => !(x.pid in sys));
      const ex = extra.length ? await tx.getAll(...[...new Set(extra.map((x) => x.pid))].map((x) => db.doc('prod/' + x))) : [];
      const known = new Set(ex.filter((x) => x.exists).map((x) => x.id));
      const c = Object.assign({}, s.get('c') || {});
      for (const it of items) {
        if (!(it.pid in sys) && !known.has(it.pid)) { out.push({ pid: it.pid, err: 'no-prod' }); continue; }
        if (!(it.pid in sys)) { const p = ex.find((x) => x.id === it.pid); upd[`sys.${it.pid}`] = qOf(p.data(), s.get('br')); sys[it.pid] = upd[`sys.${it.pid}`]; }
        c[it.pid] = it.set ? it.n : (c[it.pid] || 0) + it.n;
        upd[`c.${it.pid}`] = c[it.pid];
        out.push({ pid: it.pid, cnt: c[it.pid] });
      }
      upd.upd = Date.now();
      tx.update(r, upd);
      return { ok: true, items: out, counted: Object.keys(c).length };
    });
  }
  if (op === 'submit' || op === 'cancel') {
    only(input, ['op', 'id']);
    const r = ref();
    return db.runTransaction(async (tx) => {
      const s = await tx.get(r);
      if (!s.exists) throw nf('no-cnt', 'הספירה לא נמצאה');
      const st = s.get('st');
      if (op === 'submit') { if (st !== 'open') throw pre('cnt-closed', 'הספירה כבר הוגשה'); tx.update(r, { st: 'review', sub: { by: who.uid, at: Date.now() } }); return { ok: true, st: 'review' }; }
      if (!['open', 'review'].includes(st)) throw pre('cnt-closed', 'אי אפשר לבטל ספירה שכבר אושרה');
      if (!who.mgr && s.get('by') !== who.uid) throw deny('not-manager', 'ביטול – מנהל או מי שפתח את הספירה');
      tx.update(r, { st: 'cancel', canc: { by: who.uid, at: Date.now() } });
      return { ok: true, st: 'cancel' };
    });
  }
  if (op === 'approve') {
    only(input, ['op', 'id']);
    if (!who.mgr) throw deny('not-manager', 'אישור ספירה – מנהל בלבד');
    const r = ref();
    const s0 = await r.get();
    if (!s0.exists) throw nf('no-cnt', 'הספירה לא נמצאה');
    if (!['review', 'apply'].includes(s0.get('st'))) throw pre('cnt-state', s0.get('st') === 'open' ? 'הספירה עוד פתוחה – "סיימתי" קודם' : 'הספירה כבר טופלה');
    const br = s0.get('br');
    const c0 = s0.get('c') || {};
    const todo = Object.keys(c0).filter((pid) => !((s0.get('done') || {})[pid] !== undefined)).slice(0, STEP);
    let applied = 0;
    await db.runTransaction(async (tx) => {
      const s = await tx.get(r);
      const done = s.get('done') || {};
      const ids = todo.filter((pid) => done[pid] === undefined);
      const ps = ids.length ? await tx.getAll(...ids.map((x) => db.doc('prod/' + x))) : [];
      const upd = { st: 'apply', upd: Date.now() };
      ps.forEach((p, i) => {
        const pid = ids[i];
        if (!p.exists) { upd[`done.${pid}`] = 0; return; }
        const d = (s.get('c') || {})[pid] - qOf(p.data(), br);
        if (d) ST.move(tx, db, { pid, br, delta: d, why: 'cnt', by: who.uid, name: p.get('name'), ref: r.id, note: 'ספירה' });
        upd[`done.${pid}`] = d;
        applied++;
      });
      tx.update(r, upd);
    });
    const s1 = await r.get();
    const done = s1.get('done') || {};
    const left = Object.keys(s1.get('c') || {}).filter((pid) => done[pid] === undefined).length;
    if (!left && s1.get('st') !== 'done') {
      const vals = Object.values(done);
      await r.update({ st: 'done', appr: { by: who.uid, at: Date.now() }, diffs: vals.filter((x) => x).length, units: vals.reduce((a, x) => a + Math.abs(x), 0) });
    }
    return { ok: true, applied, left, st: left ? 'apply' : 'done' };
  }
  if (op === 'list') {
    only(input, ['op']);
    const q = await db.collection('poscnt').orderBy('at', 'desc').limit(30).get();
    return { ok: true, items: q.docs.map((d) => { const x = d.data(); return { id: d.id, name: x.name, br: x.br, scope: x.scope, st: x.st, at: x.at, n: x.n || Object.keys(x.sys || {}).length, counted: Object.keys(x.c || {}).length, diffs: x.diffs || 0, units: x.units || 0 }; }) };
  }
  if (op === 'get') {
    only(input, ['op', 'id']);
    const s = await ref().get();
    if (!s.exists) throw nf('no-cnt', 'הספירה לא נמצאה');
    const x = s.data();
    const ids = [...new Set(Object.keys(x.sys || {}).concat(Object.keys(x.c || {})))];
    const P = new Map();
    for (let i = 0; i < ids.length; i += 300) (await db.getAll(...ids.slice(i, i + 300).map((k) => db.doc('prod/' + k)))).forEach((p) => { if (p.exists) P.set(p.id, p.data()); });
    const lines = ids.map((pid) => { const p = P.get(pid) || {}; return { pid, name: p.name || '', bc: p.barcode || '', sys: (x.sys || {})[pid] || 0, cnt: (x.c || {})[pid], now: qOf(p, x.br), d: (x.done || {})[pid] }; });
    return { ok: true, cnt: { id: s.id, name: x.name, br: x.br, scope: x.scope, st: x.st, at: x.at, by: x.by, appr: x.appr || null, diffs: x.diffs || 0, units: x.units || 0 }, lines };
  }
  throw bad('bad-op', 'פעולה לא מוכרת');
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`pos-inv: ${name} failed`, { name: e && e.name, code: e && e.code, msg: String(e && e.message || '').slice(0, 120) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
exports.posCnt = onCall({ timeoutSeconds: 300, memory: '512MiB' }, wrap('posCnt', cnt));
