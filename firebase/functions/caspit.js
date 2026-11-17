'use strict';
// סנכרון כספית – שלב A1 (17.11.2026): קטלוג, מחיר ועלות בשני הכיוונים, קוד כספית למוצר, קבצים לכספית.
// כל הפונקציות: מנהל בלבד (who + mgr מ-orders.js, תוספת 'orders'). כל האוספים כאן – רק השרת קורא וכותב (בחוקים אין להם כלל = סגור).
// הכללים עצמם (ניקוי, איחוד, החלטת מחיר, CSV) – ב-lib/caspit-core.js, עותק זהה של app-source/www/caspit-core.js.
//
//   cxcfg/main         { skip:[קודים מיוחדים], next: הקוד הבא לפריט חדש (900000+), gen: מונה סנכרונים, bak?: { id, n, at }, last?: { run, at } }
//                      שמור לשלב A2/A3 (לא בשימוש ב-A1): br – סניף המלאי באפליקציה (אחד לשתי הקופות), reg: { <מספר/שם סניף בכספית>: <קופה בסגירת הקופה> }
//   cxItem/{code}      { c, pid, st:'link', n, pr:{ fb, ab, pd? }, co:{ fb, ab, pd? }, m?: קוד ראשי (קוד שאוחד), nv?, nw?: פריט חדש מהאפליקציה שטרם נקלט בכספית, run, at }
//                        pr = מחיר לצרכן, co = עלות כולל מע"מ. fb/ab = הערך בכספית/באפליקציה בסנכרון האחרון, pd = נשלח לכספית וטרם נקלט (caspit-core: decide/after)
//   cxcfg/seen         { codes:[כל קודי הקטלוג שאושרו, גם מסוננים] } – תפוסים לקוד 900000+ · cxBak/{id} – גיבוי לפני האישור הראשון (נפרד מ-stockBak)
//   cxRun/{run}        { st:'up'|'pv'|'ap'|'done', parts, by, at, gen, cnt, sel?, res? } + in/{k} { items } (קלט) + pv/{k} { rows } (תצוגה מקדימה) + done/{k}
//   prod/{id}          + dn: true = "שם כפול – לבדוק" (cxDnOk מסיר), cx: קוד כספית, nc: true ("לא נספר" – יורד בהכנסת מלאי / תיקון כמות), bcx: [ברקודים נוספים], src:'cx'
//   priceLog/{id}      { prod, k:'p'|'c', old, new, src:'caspit'|'conf', code, run, by, at } (גם src:'app' – orders.js). conf = האפליקציה ניצחה: old = הערך בכספית
// בסיס לשלבים הבאים (A2/A3): cxItem לפי קוד → pid (מכירות → מלאי), cxcfg.skip לקודים שלא נוגעים במלאי.
const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const logger = require('firebase-functions/logger');
const T = require('./lib/tenant');
const { inputObject } = require('./lib/roles');
const CC = require('./lib/caspit-core');
const PM = require('./lib/prod-match');
const O = require('./orders')._core;
const FV = () => require('firebase-admin/firestore').FieldValue;

const { bad, pre, onlyKeys, idOf, catIdOf } = O;
const RUN_RE = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_PARTS = 20; // 20 × 1,500 = 30,000 קודים
const PV_PART = 200; // שורות בכל חלק של התצוגה המקדימה (= טרנזקציה אחת באישור)
const BUDGET = 200000; // אישור: עד 200 שניות לקריאה, והטלפון ממשיך בקריאה נוספת
const CFG = 'cxcfg/main';
const SEEN = 'cxcfg/seen'; // { codes:[כל הקודים שהופיעו בקטלוגים שאושרו] }
const STALE = 'מאז התצוגה המקדימה נשמר סנכרון או קובץ לכספית. מציגים שוב.';

async function mgrW(request) { const w = await O.who(request); if (w.role !== 'manager') throw O.deny('manager-only', 'הפעולה מותרת למנהל בלבד'); return w; }
const runOf = (v) => { if (typeof v !== 'string' || !RUN_RE.test(v)) throw bad('bad-run', 'מזהה סנכרון לא תקין'); return v; };
const cfgOf = (s) => { const d = s && s.exists ? s.data() : {}; return { reg: d.reg && typeof d.reg === 'object' ? d.reg : {}, br: typeof d.br === 'string' ? d.br : null, skip: Array.isArray(d.skip) ? d.skip : CC.SKIP, next: Number.isInteger(d.next) ? d.next : CC.NEW_FROM, gen: d.gen || 0, bak: d.bak || null, last: d.last || null }; };
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v, n) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '').slice(0, n);
// קלט מהטלפון: רק השדות של groupCat, באורך מוגבל
function cleanIn(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const c = s(x.c, 40).trim();
  if (!c) return null;
  const arr = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []).map((b) => s(b, 40).trim()).filter(Boolean);
  return { c, n: s(x.n, 200), bcs: arr(x.bcs, 200), col: arr(x.col, 50), sz: arr(x.sz, 50),
    p: numOrNull(x.p), cost: numOrNull(x.cost) > 0 && x.cost <= 1000000 ? x.cost : null, nv: x.nv === true, c1: s(x.c1, 60), c2: s(x.c2, 60), sup: s(x.sup, 80) };
}

// cxCfg() → { cfg, items: מספר קודים מקושרים }
async function cxCfg(request) {
  await mgrW(request);
  const db = T.tdb();
  const [c, n] = await Promise.all([db.doc(CFG).get(), db.collection('cxItem').count().get()]);
  return { cfg: cfgOf(c), items: n.data().count };
}
// cxSetCfg({ skip:[קודים] }) – רשימת הקודים המיוחדים (לא נקלטים כמוצרים; בשלב A2 – לא משנים מלאי)
async function cxSetCfg(request) {
  const w = await mgrW(request);
  const input = inputObject(request);
  onlyKeys(input, ['skip']);
  if (!Array.isArray(input.skip) || input.skip.length > 100) throw bad('bad-skip', 'קודים מיוחדים: עד 100');
  const skip = [...new Set(input.skip.map((x) => s(x, 30).trim()).filter((x) => CC.CODE_RE.test(x)))];
  await T.tdb().doc(CFG).set({ skip, upd: Date.now(), by: w.uid }, { merge: true });
  return { ok: true, skip };
}

// cxUpload({ run, part, parts, items }) – חלק מהקטלוג אחרי groupCat בטלפון. ניסיון חוזר של אותו חלק דורס את אותו מסמך.
async function cxUpload(request) {
  const w = await mgrW(request);
  const input = inputObject(request);
  onlyKeys(input, ['run', 'part', 'parts', 'items']);
  const run = runOf(input.run);
  const parts = input.parts, part = input.part;
  if (!Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS || !Number.isInteger(part) || part < 0 || part >= parts) throw bad('bad-part', 'חלק לא תקין');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > CC.PART) throw bad('bad-items', `פריטים: 1 עד ${CC.PART} בכל חלק`);
  const items = input.items.map(cleanIn).filter(Boolean);
  const db = T.tdb();
  const ref = db.doc('cxRun/' + run);
  await db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (r.exists && (r.get('st') !== 'up' || r.get('by') !== w.uid)) throw pre('run-closed', 'הסנכרון הזה כבר נסגר. התחילו מחדש.');
    if (r.exists && r.get('parts') !== parts) throw bad('bad-part', 'מספר החלקים השתנה');
    if (!r.exists) tx.set(ref, { st: 'up', kind: 'cat', parts, by: w.uid, at: Date.now() });
    tx.set(ref.collection('in').doc(String(part)), { items, n: items.length });
  });
  return { ok: true, n: items.length };
}

// מצב נוכחי: מוצרים (שדות לקישור), עלויות, cxItem, הגדרות
async function loadState(db) {
  const [ps, xs, cs] = await Promise.all([db.collection('prod').select('name', 'price', 'barcode', 'bcx', 'sku', 'cx', 'on', 'cat', 'sub', 'sup').get(), db.collection('cxItem').get(), db.doc(CFG).get()]);
  const P = new Map(ps.docs.map((d) => [d.id, d.data()]));
  const cost = new Map();
  const refs = ps.docs.map((d) => db.doc(`prod/${d.id}/p/cost`));
  for (let k = 0; k < refs.length; k += 300) (await db.getAll(...refs.slice(k, k + 300))).forEach((x) => { if (x.exists && typeof x.get('cost') === 'number') cost.set(x.ref.parent.parent.id, x.get('cost')); });
  const X = new Map(xs.docs.map((d) => [d.id, d.data()]));
  return { P, cost, X, cfg: cfgOf(cs) };
}

// cxPreview({ run }) – ניקוי, קישור והשוואה. לא כותב למוצרים. → { cnt, rows, filt, merged, warn }
async function cxPreview(request) {
  const w = await mgrW(request);
  const input = inputObject(request);
  onlyKeys(input, ['run']);
  const run = runOf(input.run);
  const db = T.tdb();
  const ref = db.doc('cxRun/' + run);
  const r = await ref.get();
  if (!r.exists || r.get('by') !== w.uid) throw new HttpsError('not-found', 'הסנכרון לא נמצא', { reason: 'no-run' });
  if (!['up', 'pv'].includes(r.get('st'))) throw pre('run-closed', 'הסנכרון הזה כבר אושר');
  const ins = await ref.collection('in').get();
  if (ins.size !== r.get('parts')) throw pre('run-partial', 'לא כל חלקי הקובץ הגיעו. שלחו שוב.');
  const items = ins.docs.sort((a, b) => +a.id - +b.id).flatMap((d) => d.get('items') || []);
  const S = await loadState(db);
  const C = CC.clean(items, { skip: S.cfg.skip });
  // מפות לקישור: קוד (sku/cx), ברקוד (ייחודי בלבד), שם מדויק (ייחודי בלבד)
  const bySku = new Map(), byBc = new Map(), byName = new Map(), linked = new Map();
  const add = (m, k, id) => { if (!k) return; m.set(k, m.has(k) && m.get(k) !== id ? null : id); };
  for (const [id, p] of S.P) {
    add(bySku, p.cx, id); if (!p.cx) add(bySku, p.sku, id);
    add(byBc, p.barcode, id); for (const b of Array.isArray(p.bcx) ? p.bcx : []) add(byBc, b, id);
    add(byName, PM.key(p.name), id);
  }
  for (const [c, x] of S.X) if (x.pid && S.P.has(x.pid)) linked.set(x.pid, c);
  const claimed = new Set();
  const rows = []; const warn = C.warn.slice();
  const cnt = { codes: C.cnt.codes, keep: C.cnt.keep, merged: C.cnt.merged, filt: C.cnt.filt, by: C.cnt.by, nw: 0, link: 0, pr: {}, co: {} };
  for (const it of C.keep) {
    const codes = [it.c].concat(it.m);
    let pid = null, via = '';
    for (const c of codes) { const x = S.X.get(c); if (x && x.pid && S.P.has(x.pid)) { pid = x.pid; via = 'cx'; break; } }
    const free = (id) => id && !claimed.has(id) && (!linked.has(id) || codes.includes(linked.get(id)));
    if (!pid && free(bySku.get(it.c))) { pid = bySku.get(it.c); via = 'sku'; }
    if (!pid) for (const b of [it.bc].concat(it.bx)) if (free(byBc.get(b))) { pid = byBc.get(b); via = 'bc'; break; }
    if (!pid && free(byName.get(PM.key(it.n)))) { pid = byName.get(PM.key(it.n)); via = 'name'; }
    if (pid) claimed.add(pid);
    const row = { c: it.c, m: it.m, n: it.n, it };
    if (!pid) { row.a = 'new'; cnt.nw++; rows.push(row); continue; }
    const p = S.P.get(pid), st = S.X.get(it.c) || codes.map((c) => S.X.get(c)).find(Boolean) || {};
    const ap = typeof p.price === 'number' ? p.price : null, ac = S.cost.has(pid) ? S.cost.get(pid) : null;
    Object.assign(row, { a: 'link', pid, via, pn: p.name, pr: Object.assign({ f: it.p, a: ap }, CC.decide(it.p, ap, st.pr)), co: Object.assign({ f: it.cost, a: ac }, CC.decide(it.cost, ac, st.co)) });
    if (p.sku && p.sku !== it.c && !p.cx && via !== 'cx') warn.push({ c: it.c, w: 'sku', v: p.sku });
    cnt.link++;
    cnt.pr[row.pr.act] = (cnt.pr[row.pr.act] || 0) + 1;
    cnt.co[row.co.act] = (cnt.co[row.co.act] || 0) + 1;
    rows.push(row);
  }
  // מוצרים באפליקציה שלא מקושרים לשום קוד (אחרי האישור – ייצאו בקובץ "פריטים חדשים")
  cnt.appOnly = [...S.P.keys()].filter((id) => !claimed.has(id) && !linked.has(id) && S.P.get(id).on !== false).length;
  // שמירת התצוגה (מחליפה תצוגה קודמת של אותו סנכרון)
  const old = await ref.collection('pv').listDocuments();
  const groups = old.map((d) => (b) => b.delete(d));
  CC.parts(rows, PV_PART).forEach((g, k) => groups.push((b) => b.set(ref.collection('pv').doc(String(k)), { rows: g })));
  for (let i = 0; i < groups.length; i += 100) { const b = db.batch(); groups.slice(i, i + 100).forEach((f) => f(b)); await b.commit(); }
  cnt.warn = warn.length;
  await ref.update({ st: 'pv', gen: S.cfg.gen, pvN: Math.ceil(rows.length / PV_PART), cnt, pvAt: Date.now() });
  const lite = rows.map((x) => (x.a === 'new' ? [x.c, 'new', x.n, x.it.p, x.it.cost, x.m.length] : [x.c, 'link', x.n, x.pr.act, x.pr.f, x.pr.a, x.co.act, x.co.f, x.co.a, x.via, x.pn]));
  return { cnt, rows: lite, filt: C.filt, merged: C.merged, warn, first: !S.cfg.last };
}

// cxApply({ run, take?:'app'|'cx', skip?:[קודים] }) – אישור. מחולק לחלקים של 200 קודים, כל חלק בטרנזקציה עם סימון done/{k}:
// ניסיון חוזר / קריאה כפולה לא מכפילים. לפני האישור הראשון בעסק – גיבוי מלא של המוצרים (snapAll → stockBak, אפשר "שחזור מלאי מגיבוי").
// → { done, next?, res }. done:false = הזמן נגמר; הטלפון קורא שוב עם אותו run (הבחירות נשמרו בקריאה הראשונה).
async function cxApply(request) {
  const w = await mgrW(request);
  const input = inputObject(request);
  onlyKeys(input, ['run', 'take', 'skip']);
  const run = runOf(input.run);
  const db = T.tdb();
  const t0 = Date.now();
  const ref = db.doc('cxRun/' + run), cref = db.doc(CFG);
  let r = await ref.get();
  if (!r.exists || r.get('by') !== w.uid) throw new HttpsError('not-found', 'הסנכרון לא נמצא', { reason: 'no-run' });
  if (r.get('st') === 'done') return { done: true, dup: true, res: r.get('res') || {} };
  if (r.get('st') === 'up') throw pre('no-preview', 'קודם מציגים תצוגה מקדימה');
  if (r.get('st') === 'void') throw pre('stale', STALE);
  let cfg = cfgOf(await cref.get());
  // תיקון סבב 1 (ליקוי 4): בדיקת "תצוגה מיושנת" בכל קריאה (גם בהמשך אישור), ושוב בתוך כל חלק (applyPart). gen עולה בכל אישור ובכל cxExport
  if (cfg.gen !== r.get('gen')) { if (r.get('st') === 'ap') await ref.update({ st: 'void' }); throw pre('stale', STALE); }
  if (r.get('st') === 'pv') {
    if (input.take != null && !['app', 'cx'].includes(input.take)) throw bad('bad-take', 'בחירה לא תקינה');
    if (input.skip != null && (!Array.isArray(input.skip) || input.skip.length > 30000)) throw bad('bad-skip', 'רשימה לא תקינה');
    const sel = { take: input.take === 'cx' ? 'cx' : 'app', skip: (input.skip || []).map((x) => s(x, 40)).filter(Boolean) };
    await db.runTransaction(async (tx) => { const x = await tx.get(ref); if (x.get('st') === 'pv') tx.update(ref, { st: 'ap', sel, apAt: t0, res: {} }); });
    r = await ref.get();
  }
  if (!cfg.bak) { // גיבוי לפני האישור הראשון (פעם אחת לעסק)
    const b = await O.snapAll(db, w, 'prod', 'cxBak', 'caspit'); // אוסף נפרד – לא נוגע בגיבויי המחיקה (stockBak) ובשחזור שלהם (ליקוי 10)
    await cref.set({ bak: Object.assign(b, { at: Date.now() }) }, { merge: true });
    cfg = cfgOf(await cref.get());
  }
  const sel = r.get('sel') || { take: 'app', skip: [] };
  const skip = new Set(sel.skip);
  const N = r.get('pvN') || 0;
  const doneIds = new Set((await ref.collection('done').listDocuments()).map((d) => d.id));
  const cats = new Map((await db.collection('cat').get()).docs.map((d) => [d.id, true]));
  for (let k = 0; k < N; k++) {
    if (doneIds.has(String(k))) continue;
    if (Date.now() - t0 > BUDGET) return { done: false, next: k, res: (await ref.get()).get('res') || {} };
    const rows = (await ref.collection('pv').doc(String(k)).get()).get('rows') || [];
    try { await applyPart(db, w, run, ref, k, rows, sel.take, skip, cats, r.get('gen')); } catch (e) {
      if (e && e.details && e.details.reason === 'stale') await ref.update({ st: 'void' });
      throw e;
    }
  }
  // ליקוי 6: כל הקודים שהופיעו בקטלוג (גם מסוננים ושורות שבוטל סימונן) נשמרים כתפוסים – קוד 900000+ לפריט חדש לא יתנגש בהם
  const seenRef = db.doc(SEEN);
  const codes = new Set(((await seenRef.get()).get('codes')) || []);
  (await ref.collection('in').get()).docs.forEach((d) => (d.get('items') || []).forEach((x) => codes.add(x.c)));
  await seenRef.set({ codes: [...codes], at: Date.now() });
  await db.runTransaction(async (tx) => {
    const x = await tx.get(ref), c = await tx.get(cref);
    if (x.get('st') === 'done') return;
    tx.update(ref, { st: 'done', doneAt: Date.now() });
    tx.set(cref, { gen: (c.exists && c.get('gen') || 0) + 1, last: { run, at: Date.now() } }, { merge: true });
  });
  O.ixDrop(w);
  const res = (await ref.get()).get('res') || {};
  logger.info('cxApply', { biz: w.bizId || '', run, res });
  return { done: true, res };
}

async function applyPart(db, w, run, ref, k, rows, take, skip, cats, gen) {
  const mark = ref.collection('done').doc(String(k));
  await db.runTransaction(async (tx) => {
    if ((await tx.get(mark)).exists) return;
    if (gen !== undefined && cfgOf(await tx.get(db.doc(CFG))).gen !== gen) throw pre('stale', STALE);
    const L = rows.filter((x) => !skip.has(x.c));
    const pids = L.map((x) => (x.a === 'new' ? 'cx' + x.c : x.pid));
    const ps = pids.length ? await tx.getAll(...pids.map((id) => db.doc('prod/' + id))) : [];
    const linkIdx = L.map((x, i) => (x.a === 'link' ? i : -1)).filter((i) => i >= 0);
    const cs = linkIdx.length ? await tx.getAll(...linkIdx.map((i) => db.doc(`prod/${pids[i]}/p/cost`))) : [];
    const cost = new Map(linkIdx.map((i, j) => [i, cs[j].exists && typeof cs[j].get('cost') === 'number' ? cs[j].get('cost') : null]));
    const now = Date.now();
    const res = { nw: 0, link: 0, pin: 0, cin: 0, pout: 0, cout: 0, chg: 0, skip: rows.length - L.length };
    const log = (pid, kk, old, nv, code) => tx.set(O.priceRef(db), { prod: pid, k: kk, old, new: nv, src: 'caspit', code, run, by: w.uid, at: now });
    // fresh = מוצר שנוצר עכשיו: המסמך נכתב מחדש (בלי שאריות של cxItem יתום – m/pd/nv ישנים)
    const xi = (c, d, fresh) => (fresh ? tx.set(db.doc('cxItem/' + c), Object.assign({ c, run, at: now, st: 'link' }, d)) : tx.set(db.doc('cxItem/' + c), Object.assign({ c, run, at: now, st: 'link', nw: FV().delete() }, d), { merge: true }));
    L.forEach((x, i) => {
      const s0 = ps[i];
      if (x.a === 'new' && !s0.exists) {
        const it = x.it, pid = pids[i];
        const ext = {};
        if (it.c1) { ext.cat = catIdOf(it.c1, ''); if (!cats.has(ext.cat)) { tx.set(db.doc('cat/' + ext.cat), { name: it.c1, ord: 0, upd: now }); cats.set(ext.cat, true); } }
        if (it.c1 && it.c2) { ext.sub = catIdOf(it.c2, ext.cat); if (!cats.has(ext.sub)) { tx.set(db.doc('cat/' + ext.sub), { name: it.c2, parent: ext.cat, ord: 0, upd: now }); cats.set(ext.sub, true); } }
        if (it.sup) ext.sup = it.sup;
        if (it.bx && it.bx.length) ext.bcx = it.bx;
        if (it.dn) ext.dn = true; // "שם כפול – לבדוק" (החלטה 10)
        tx.set(db.doc('prod/' + pid), Object.assign({ name: it.n, price: it.p, barcode: it.bc || '', on: true, q: {}, nc: true, sku: it.c, cx: it.c, at: now, by: w.uid, upd: now, src: 'cx' }, ext));
        if (it.cost != null) tx.set(db.doc(`prod/${pid}/p/cost`), { cost: it.cost, at: now, by: w.uid, src: 'cx' });
        const st = { pr: { fb: it.p, ab: it.p }, co: { fb: it.cost, ab: it.cost } };
        xi(x.c, Object.assign({ pid, n: it.n }, st, it.nv ? { nv: true } : {}), true);
        for (const m of x.m || []) xi(m, Object.assign({ pid, n: it.n, m: x.c }, st), true);
        res.nw++;
        return;
      }
      // קיים: מוצר שנוצר כבר (ניסיון חוזר אחרי שחזור) או קישור למוצר קיים
      if (!s0.exists) { res.chg++; return; }
      const p = s0.data() || {}, pid = s0.id, it = x.it;
      const ap = typeof p.price === 'number' ? p.price : null, ac = x.a === 'link' ? cost.get(i) : null;
      let pr, co;
      if (x.a === 'new') { pr = { fb: it.p, ab: ap }; co = { fb: it.cost, ab: it.cost }; } else {
        if (!CC.eq(ap, x.pr.a) || !CC.eq(ac, x.co.a)) { res.chg++; return; } // השתנה באפליקציה מאז התצוגה – לא נוגעים (יופיע בסנכרון הבא)
        const upd = { upd: now };
        const dp = x.pr, dc = x.co;
        const pIn = dp.act === 'in' || (dp.act === 'first' && take === 'cx');
        const cIn = dc.act === 'in' || (dc.act === 'first' && take === 'cx');
        if (pIn && dp.f != null && !CC.eq(dp.f, ap)) { upd.price = dp.f; log(pid, 'p', ap, dp.f, x.c); res.pin++; }
        if (cIn && dc.f != null && !CC.eq(dc.f, ac)) { tx.set(db.doc(`prod/${pid}/p/cost`), { cost: dc.f, at: now, by: w.uid, src: 'cx' }); log(pid, 'c', ac, dc.f, x.c); res.cin++; }
        // ליקוי 7ב: האפליקציה ניצחה בהתנגשות / בהבדל ראשון – הערך שהיה בכספית נרשם בהיסטוריה (src:'conf': old = כספית, new = האפליקציה)
        const lose = (d) => (d.act === 'conf' || (d.act === 'first' && take !== 'cx')) && d.f != null;
        if (lose(dp)) tx.set(O.priceRef(db), { prod: pid, k: 'p', old: dp.f, new: ap, src: 'conf', code: x.c, run, by: w.uid, at: now });
        if (lose(dc)) tx.set(O.priceRef(db), { prod: pid, k: 'c', old: dc.f, new: ac, src: 'conf', code: x.c, run, by: w.uid, at: now });
        if (['out', 'conf'].includes(dp.act) || (dp.act === 'first' && take !== 'cx')) res.pout++;
        if (['out', 'conf'].includes(dc.act) || (dc.act === 'first' && take !== 'cx')) res.cout++;
        if (!p.cx) upd.cx = x.c;
        if (!p.sku) upd.sku = x.c;
        if (!p.barcode && it.bc) upd.barcode = it.bc;
        if (!p.sup && it.sup) upd.sup = it.sup;
        tx.update(s0.ref, upd);
        pr = CC.after(dp, dp.f, ap, take); co = CC.after(dc, dc.f, ac, take);
        if (!('pd' in pr)) pr.pd = FV().delete();
        if (!('pd' in co)) co.pd = FV().delete();
      }
      xi(x.c, Object.assign({ pid, n: it.n, pr, co }, it.nv ? { nv: true } : {}));
      for (const m of x.m || []) xi(m, { pid, n: it.n, m: x.c, pr, co });
      res.link++;
    });
    tx.set(mark, { at: now, res });
    tx.update(ref, Object.fromEntries(Object.entries(res).map(([kk, v]) => ['res.' + kk, FV().increment(v)])));
  });
}

// cxExport({ kind:'price'|'new' }) → { csv, n, rows:[{ c, n, p, cost }] }
// price: כל קוד מקושר שהמחיר/העלות שלו באפליקציה שונים מהסנכרון האחרון, או שנשלח וטרם נקלט. מסמן pd (ממתין לקליטה).
// new: מוצרים באפליקציה בלי קוד כספית (זמינים בלבד) מקבלים קוד מ-900000 ומעלה (cxcfg.next), ועוד פריטים חדשים שנשלחו וטרם נקלטו.
//      זמין רק אחרי סנכרון קטלוג ראשון (כדי לא לתת קוד חדש למוצר שכבר קיים בכספית).
async function cxExport(request) {
  const w = await mgrW(request);
  const input = inputObject(request);
  onlyKeys(input, ['kind']);
  if (!['price', 'new'].includes(input.kind)) throw bad('bad-kind', 'סוג קובץ לא תקין');
  const db = T.tdb();
  const S = await loadState(db);
  const oc = await db.doc('ordcfg/main').get();
  const vat = oc.exists && typeof oc.get('vat') === 'number' ? oc.get('vat') : 18;
  const now = Date.now();
  const ups = [];
  if (input.kind === 'price') {
    const rows = [];
    for (const [c, x] of [...S.X].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!x.pid || x.nw || !S.P.has(x.pid)) continue;
      const p = S.P.get(x.pid), ap = typeof p.price === 'number' ? p.price : null, ac = S.cost.has(x.pid) ? S.cost.get(x.pid) : null;
      const pr = x.pr || {}, co = x.co || {};
      const needP = ap != null && pr.ab !== undefined && (pr.pd != null || !CC.eq(ap, pr.ab));
      const needC = ac != null && co.ab !== undefined && (co.pd != null || !CC.eq(ac, co.ab));
      if (!needP && !needC) continue;
      rows.push({ c, n: p.name, p: ap, cost: ac, nv: x.nv === true });
      const u = { 'pr.pd': ap, 'pr.ab': ap, xAt: now };
      if (ac != null) Object.assign(u, { 'co.pd': ac, 'co.ab': ac });
      ups.push([db.doc('cxItem/' + c), u]);
    }
    for (let i = 0; i < ups.length; i += 400) { const b = db.batch(); ups.slice(i, i + 400).forEach(([rf, u]) => b.update(rf, u)); await b.commit(); }
    if (ups.length) await bumpGen(db); // תצוגה מקדימה שנעשתה לפני הקובץ – מיושנת (ליקוי 4)
    return { csv: CC.csvPrice(rows, vat), n: rows.length, rows: rows.map((x) => ({ c: x.c, n: x.n, p: x.p, cost: x.cost })) };
  }
  if (!S.cfg.last) throw pre('no-cat', 'קודם מסנכרנים קטלוג מכספית, כדי לא לתת קוד חדש למוצר שכבר קיים שם');
  // ליקוי 5: הכול בטרנזקציה – מוצרי המועמדים וההגדרות נקראים בתוכה; מוצר שכבר קיבל קוד (cx) בקריאה מקבילה – מדולג.
  // ליקוי 6: תפוסים = cxItem + כל הקודים שהופיעו בקטלוג (cxcfg/seen).
  const linked = new Set([...S.X.values()].map((x) => x.pid).filter(Boolean));
  const cand = [...S.P].filter(([id, p]) => !linked.has(id) && !p.cx && p.on !== false).map(([id]) => id);
  let added = 0, made = [];
  if (cand.length) {
    await db.runTransaction(async (tx) => {
      added = 0; made = []; // ניסיון חוזר של הטרנזקציה מתחיל נקי
      const [cs, seen] = await Promise.all([tx.get(db.doc(CFG)), tx.get(db.doc(SEEN))]);
      const c0 = cfgOf(cs);
      const ps = [];
      for (let i = 0; i < cand.length; i += 300) ps.push(...await tx.getAll(...cand.slice(i, i + 300).map((id) => db.doc('prod/' + id))));
      const taken = new Set([...S.X.keys()].concat(seen.exists ? seen.get('codes') || [] : []));
      const todo = ps.filter((x) => x.exists && !x.get('cx') && x.get('on') !== false).sort((a, b) => String(a.get('name')).localeCompare(String(b.get('name')), 'he'));
      let n = c0.next;
      for (const ps1 of todo) {
        const pid = ps1.id, p = ps1.data();
        n = CC.nextCode(n, taken); const code = String(n); taken.add(code); n++;
        const ap = typeof p.price === 'number' ? p.price : null, ac = S.cost.has(pid) ? S.cost.get(pid) : null;
        const d = { c: code, pid, st: 'link', nw: true, src: 'app', n: p.name, pr: { fb: null, ab: ap, pd: ap }, co: { fb: null, ab: ac, pd: ac }, at: now };
        tx.set(db.doc('cxItem/' + code), d);
        tx.update(ps1.ref, Object.assign({ cx: code, upd: now }, p.sku ? {} : { sku: code }));
        made.push([code, d, pid, Object.assign({}, p, { cx: code })]);
        added++;
      }
      tx.set(db.doc(CFG), Object.assign({ next: n }, added ? { gen: c0.gen + 1 } : {}), { merge: true });
    });
    for (const [code, d, pid, p] of made) { S.X.set(code, d); S.P.set(pid, p); }
  }
  const catN = new Map((await db.collection('cat').get()).docs.map((d) => [d.id, d.get('name') || '']));
  const rows = [];
  for (const [c, x] of [...S.X].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!x.nw || !S.P.has(x.pid)) continue;
    const p = S.P.get(x.pid);
    rows.push({ c, bc: p.barcode || '', n: p.name, p: typeof p.price === 'number' ? p.price : 0, cost: S.cost.has(x.pid) ? S.cost.get(x.pid) : null, c1: p.cat ? catN.get(p.cat) || '' : '', c2: p.sub ? catN.get(p.sub) || '' : '', sup: p.sup || '' });
  }
  O.ixDrop(w);
  return { csv: CC.csvNew(rows, vat), n: rows.length, added, rows: rows.map((x) => ({ c: x.c, n: x.n, p: x.p, cost: x.cost })) };
}

async function bumpGen(db) { await db.runTransaction(async (tx) => { const c = cfgOf(await tx.get(db.doc(CFG))); tx.set(db.doc(CFG), { gen: c.gen + 1 }, { merge: true }); }); }

// cxDnOk({ pid }) – "נבדק": מסיר את הסימון "שם כפול – לבדוק" (dn) מהמוצר (החלטה 10). מנהל בלבד.
async function cxDnOk(request) {
  const w = await mgrW(request);
  const input = inputObject(request);
  onlyKeys(input, ['pid']);
  const pid = idOf(input.pid, 'מוצר');
  const ref = T.tdb().doc('prod/' + pid);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'המוצר לא נמצא', { reason: 'no-prod' });
  await ref.update({ dn: FV().delete(), upd: Date.now(), dnBy: w.uid });
  return { ok: true };
}

// cxHist({ pid }) → { codes:[קודי כספית], log:[{ k, old, new, src, at }] } – היסטוריית מחיר ועלות למוצר (30 אחרונים)
async function cxHist(request) {
  await mgrW(request);
  const input = inputObject(request);
  onlyKeys(input, ['pid']);
  const pid = idOf(input.pid, 'מוצר');
  const db = T.tdb();
  const [l, x] = await Promise.all([db.collection('priceLog').where('prod', '==', pid).orderBy('at', 'desc').limit(30).get(), db.collection('cxItem').where('pid', '==', pid).limit(20).get()]);
  return { codes: x.docs.map((d) => d.id), log: l.docs.map((d) => ({ k: d.get('k'), old: d.get('old'), new: d.get('new'), src: d.get('src'), at: d.get('at') })) };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`caspit: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code, msg: String(e && e.message).slice(0, 200) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { cxCfg, cxSetCfg, cxUpload, cxPreview, cxApply, cxExport, cxHist, cxDnOk };
const BIG = ['cxPreview', 'cxApply', 'cxExport']; // ~9,000 מוצרים
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall(BIG.includes(k) ? { timeoutSeconds: 300, memory: '1GiB' } : {}, wrap(k, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: { cleanIn, loadState, applyPart, PV_PART } });
