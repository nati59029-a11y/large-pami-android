'use strict';
// סנכרון כספית – שלב A1 (17.11.2026): קטלוג, מחיר ועלות בשני הכיוונים, קוד כספית למוצר, קבצים לכספית.
// כל הפונקציות: מנהל בלבד (who + mgr מ-orders.js, תוספת 'orders'). כל האוספים כאן – רק השרת קורא וכותב (בחוקים אין להם כלל = סגור).
// הכללים עצמם (ניקוי, איחוד, החלטת מחיר, CSV) – ב-lib/caspit-core.js, עותק זהה של app-source/www/caspit-core.js.
//
//   cxcfg/main         { skip:[קודים מיוחדים], next: הקוד הבא לפריט חדש (900000+), gen: מונה סנכרונים, bak?: { id, n, at }, last?: { run, at } }
//                      A2/A3: br – סניף המלאי באפליקציה (אחד לשתי הקופות), reg: { <מפתח סניף בכספית>: <קופה בסגירת הקופה> }, bkn: { <שם סניף>: <מספר> }, lastSales?: { run, at }
//                      החלטת בעל העסק (18.11): דוחות כספית לתצוגה ולהשוואה בלבד – ההכנסות רק מסגירת הקופה (אין הגדרת מקור הכנסות)
//   cxItem/{code}      { c, pid, st:'link', n, pr:{ fb, ab, pd? }, co:{ fb, ab, pd? }, m?: קוד ראשי (קוד שאוחד), nv?, nw?: פריט חדש מהאפליקציה שטרם נקלט בכספית, run, at }
//                        pr = מחיר לצרכן, co = עלות כולל מע"מ. fb/ab = הערך בכספית/באפליקציה בסנכרון האחרון, pd = נשלח לכספית וטרם נקלט (caspit-core: decide/after)
//   cxcfg/seen         { codes:[כל קודי הקטלוג שאושרו, גם מסוננים] } – תפוסים לקוד 900000+ · cxBak/{id} – גיבוי לפני האישור הראשון (נפרד מ-stockBak)
//   cxRun/{run}        { st:'up'|'pv'|'ap'|'done', parts, by, at, gen, cnt, sel?, res? } + in/{k} { items } (קלט) + pv/{k} { rows } (תצוגה מקדימה) + done/{k}
//   prod/{id}          + dn: true = "שם כפול – לבדוק" (cxDnOk מסיר), cx: קוד כספית, nc: true ("לא נספר" – יורד בהכנסת מלאי / תיקון כמות), bcx: [ברקודים נוספים], src:'cx'
//   priceLog/{id}      { prod, k:'p'|'c', old, new, src:'caspit'|'conf', code, run, by, at } (גם src:'app' – orders.js). conf = האפליקציה ניצחה: old = הערך בכספית
// A2 (דוח מכירות → מלאי) ו-A3 (מסך מכירות, התאמה מול סגירת קופה) – ראו בהמשך הקובץ: cxTx, cxDay, cxSales, cxLines, cxFix.
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldPath } = require('firebase-admin/firestore');
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
const cfgOf = (s) => { const d = s && s.exists ? s.data() : {}; return { reg: d.reg && typeof d.reg === 'object' ? d.reg : {}, br: typeof d.br === 'string' ? d.br : null, skip: Array.isArray(d.skip) ? d.skip : CC.SKIP, next: Number.isInteger(d.next) ? d.next : CC.NEW_FROM, gen: d.gen || 0, bak: d.bak || null, last: d.last || null, lastSales: d.lastSales || null,
  bot: { newMax: d.bot && Number.isInteger(d.bot.newMax) ? d.bot.newMax : BOT_NEW0 }, cats: Array.isArray(d.cats) ? d.cats : [] }; };
const BOT_NEW0 = 1; // רובוט כספית: פריטים חדשים לכספית בכל ריצה – 1 (בדיקה ראשונה עם פריט אחד) עד שהמנהל מעלה (החלטות 2, 11)
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

// cxCfg() → { cfg, items: מספר קודים מקושרים, br: סניף המלאי בפועל (null = צריך לבחור), sa: מנהל־על }
async function cxCfg(w) {
  const db = T.tdb();
  const [c, n] = await Promise.all([db.doc(CFG).get(), db.collection('cxItem').count().get()]);
  const cfg = cfgOf(c);
  return { cfg, items: n.data().count, br: stockBr(w, cfg), sa: !!w.superadmin };
}
// סניף המלאי של מכירות כספית (החלטה 4: שתי הקופות = סניף אחד): עסק בלי סניפים – NB; ההגדרה (אם עדיין פעיל); סניף פעיל יחיד; אחרת null
function stockBr(w, cfg) {
  if (!O.hasBranches(w)) return O.NB;
  if (cfg.br && w.activeBr.includes(cfg.br)) return cfg.br;
  return w.activeBr.length === 1 ? w.activeBr[0] : null;
}
const BK_RE = /^[\p{L}\p{N}-]{1,30}$/u; // מפתח סניף בכספית (CC.brKey)
const REG_RE = /^[a-z0-9_]{1,20}$/; // קופה בסגירת הקופה (i_yh, i_nl)
// cxSetCfg({ skip?:[קודים], br?: סניף המלאי, reg?: { <סניף בכספית>: <קופה> | '' } }) – מנהל
async function cxSetCfg(w, input) {
  onlyKeys(input, ['skip', 'br', 'reg', 'newMax']);
  const up = { upd: Date.now(), by: w.uid };
  // רובוט כספית (שלב B): כמה פריטים חדשים מותר לרובוט לטעון לכספית בריצה אחת (0–50)
  if (input.newMax !== undefined) {
    if (!Number.isInteger(input.newMax) || input.newMax < 0 || input.newMax > 50) throw bad('bad-newmax', 'פריטים חדשים בכל ריצה: מספר בין 0 ל-50');
    up.bot = { newMax: input.newMax };
  }
  if (input.skip !== undefined) {
    if (!Array.isArray(input.skip) || input.skip.length > 100) throw bad('bad-skip', 'קודים מיוחדים: עד 100');
    up.skip = [...new Set(input.skip.map((x) => s(x, 30).trim()).filter((x) => CC.CODE_RE.test(x)))];
  }
  if (input.br !== undefined) {
    if (!O.hasBranches(w)) { if (input.br !== O.NB && input.br !== null) throw bad('bad-br', 'בעסק אין סניפים'); up.br = O.NB; }
    else if (typeof input.br !== 'string' || !w.activeBr.includes(input.br)) throw bad('bad-br', 'בחרו סניף פעיל');
    else up.br = input.br;
  }
  if (input.reg !== undefined) {
    const r = input.reg;
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).length > 20) throw bad('bad-reg', 'מיפוי קופות לא תקין');
    const reg = {};
    for (const [k, v] of Object.entries(r)) {
      if (!BK_RE.test(k) || (v !== '' && (typeof v !== 'string' || !REG_RE.test(v)))) throw bad('bad-reg', 'מיפוי קופות לא תקין');
      if (v) reg[k] = v;
    }
    up.reg = reg;
  }
  // mergeFields: כל שדה שנשלח מחליף את הקודם במלואו (מיפוי קופות – בלי שאריות של מפתחות ישנים); שאר ההגדרות לא נוגעות
  await T.tdb().doc(CFG).set(up, { mergeFields: Object.keys(up) });
  return { ok: true, skip: up.skip, br: up.br, reg: up.reg, newMax: up.bot ? up.bot.newMax : undefined };
}

// cxUpload({ run, part, parts, items }) – חלק מהקטלוג אחרי groupCat בטלפון. ניסיון חוזר של אותו חלק דורס את אותו מסמך.
async function cxUpload(w, input) {
  onlyKeys(input, ['run', 'part', 'parts', 'items', 'kind', 'lines']);
  const run = runOf(input.run);
  const kind = input.kind == null ? 'cat' : input.kind;
  if (!['cat', 'sales'].includes(kind)) throw bad('bad-kind', 'סוג קובץ לא תקין');
  const parts = input.parts, part = input.part;
  if (!Number.isInteger(parts) || parts < 1 || parts > (kind === 'sales' ? MAX_SPARTS : MAX_PARTS) || !Number.isInteger(part) || part < 0 || part >= parts) throw bad('bad-part', 'חלק לא תקין');
  let items = null, lines = null, nBad = 0, tm = null;
  if (kind === 'cat') {
    if (input.lines !== undefined) throw bad('bad-field', 'שדה לא מוכר: lines');
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > CC.PART) throw bad('bad-items', `פריטים: 1 עד ${CC.PART} בכל חלק`);
    items = input.items.map(cleanIn).filter(Boolean);
  } else {
    if (input.items !== undefined) throw bad('bad-field', 'שדה לא מוכר: items');
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > SPART) throw bad('bad-lines', `שורות: 1 עד ${SPART} בכל חלק`);
    // תיקון סבב 1: שורה לא תקינה מדולגת ונספרת (bad), ולא מכשילה חלק שלם; רק חלק שכולו פגום נדחה
    const all = input.lines.map(cleanLine);
    lines = all.filter(Boolean); nBad = all.length - lines.length;
    if (!lines.length) throw bad('bad-lines', 'שורת מכירה לא תקינה');
    // C2: סטטיסטיקת שעת המכירה של הקובץ מגיעה בתוך שורה (line.tm – CC.parseSales), לא כשדה חדש בבקשה: תוסף/טלפון ישן לא שולח, שרת ישן מתעלם
    const f = input.lines.find((x) => x && typeof x === 'object' && !Array.isArray(x) && x.tm != null);
    tm = f ? cleanTm(f.tm) : null;
  }
  const db = T.tdb();
  const ref = db.doc('cxRun/' + run);
  await db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (r.exists && (r.get('st') !== 'up' || r.get('by') !== w.uid)) throw pre('run-closed', 'הסנכרון הזה כבר נסגר. התחילו מחדש.');
    if (r.exists && r.get('parts') !== parts) throw bad('bad-part', 'מספר החלקים השתנה');
    if (r.exists && (r.get('kind') || 'cat') !== kind) throw bad('bad-kind', 'סוג הקובץ השתנה');
    if (!r.exists) tx.set(ref, { st: 'up', kind, parts, by: w.uid, at: Date.now() });
    tx.set(ref.collection('in').doc(String(part)), kind === 'cat' ? { items, n: items.length } : Object.assign({ lines, n: lines.length, bad: nBad }, tm ? { tm } : {}));
  });
  return { ok: true, n: (items || lines).length, bad: nBad };
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
async function cxPreview(w, input) {
  onlyKeys(input, ['run']);
  const run = runOf(input.run);
  const db = T.tdb();
  const ref = db.doc('cxRun/' + run);
  const r = await ref.get();
  if (!r.exists || r.get('by') !== w.uid) throw new HttpsError('not-found', 'הסנכרון לא נמצא', { reason: 'no-run' });
  if (!['up', 'pv'].includes(r.get('st'))) throw pre('run-closed', 'הסנכרון הזה כבר אושר');
  const ins = await ref.collection('in').get();
  if (ins.size !== r.get('parts')) throw pre('run-partial', 'לא כל חלקי הקובץ הגיעו. שלחו שוב.');
  if (r.get('kind') === 'sales') return previewSales(db, w, ref, ins);
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
async function cxApply(w, input) {
  onlyKeys(input, ['run', 'take', 'skip', 'qty']);
  const run = runOf(input.run);
  const db = T.tdb();
  const t0 = Date.now();
  const ref = db.doc('cxRun/' + run), cref = db.doc(CFG);
  let r = await ref.get();
  if (!r.exists || r.get('by') !== w.uid) throw new HttpsError('not-found', 'הסנכרון לא נמצא', { reason: 'no-run' });
  if (r.get('st') === 'done') return Object.assign({ done: true, dup: true, res: r.get('res') || {} }, r.get('kind') === 'sales' ? { ix: await appliedIx(ref) } : {});
  if (r.get('st') === 'up') throw pre('no-preview', 'קודם מציגים תצוגה מקדימה');
  if (r.get('kind') === 'sales') return applySales(db, w, run, ref, r, input, t0);
  if (input.qty !== undefined) throw bad('bad-field', 'שדה לא מוכר: qty');
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
    // cats: זמני 3 הקטלוגים האחרונים (רובוט: "עדיין ממתין לקליטה אחרי 2 קטלוגים" – caspit-bot.js)
    const cats = (c.exists && Array.isArray(c.get('cats')) ? c.get('cats') : []).slice(-2).concat([Date.now()]);
    tx.set(cref, { gen: (c.exists && c.get('gen') || 0) + 1, last: { run, at: Date.now() }, cats }, { merge: true });
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

// cxExport({ kind:'price'|'new', max? }) → { csv, n, rows:[{ c, n, p, cost }] }
// max (רובוט כספית): יותר שורות מ-max → סירוב 'limit' לפני שמשהו מסומן pd / מקבל קוד חדש
// price: כל קוד מקושר שהמחיר/העלות שלו באפליקציה שונים מהסנכרון האחרון, או שנשלח וטרם נקלט. מסמן pd (ממתין לקליטה).
// new: מוצרים באפליקציה בלי קוד כספית (זמינים בלבד) מקבלים קוד מ-900000 ומעלה (cxcfg.next), ועוד פריטים חדשים שנשלחו וטרם נקלטו.
//      זמין רק אחרי סנכרון קטלוג ראשון (כדי לא לתת קוד חדש למוצר שכבר קיים בכספית).
async function cxExport(w, input) {
  onlyKeys(input, ['kind', 'max']);
  if (!['price', 'new'].includes(input.kind)) throw bad('bad-kind', 'סוג קובץ לא תקין');
  if (input.max !== undefined && (!Number.isInteger(input.max) || input.max < 0 || input.max > 100000)) throw bad('bad-max', 'מגבלה לא תקינה');
  const max = input.max === undefined ? Infinity : input.max;
  const over = (n) => pre('limit', `${n} ${input.kind === 'new' ? 'פריטים חדשים' : 'שורות מחיר'} – מעל המגבלה (${max}). לא סומן ולא נשלח דבר; המנהל בודק באפליקציה.`);
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
    if (rows.length > max) throw over(rows.length);
    for (let i = 0; i < ups.length; i += 400) { const b = db.batch(); ups.slice(i, i + 400).forEach(([rf, u]) => b.update(rf, u)); await b.commit(); }
    if (ups.length) await bumpGen(db); // תצוגה מקדימה שנעשתה לפני הקובץ – מיושנת (ליקוי 4)
    return { csv: CC.csvPrice(rows, vat), n: rows.length, rows: rows.map((x) => ({ c: x.c, n: x.n, p: x.p, cost: x.cost })) };
  }
  if (!S.cfg.last) throw pre('no-cat', 'קודם מסנכרנים קטלוג מכספית, כדי לא לתת קוד חדש למוצר שכבר קיים שם');
  // ליקוי 5: הכול בטרנזקציה – מוצרי המועמדים וההגדרות נקראים בתוכה; מוצר שכבר קיבל קוד (cx) בקריאה מקבילה – מדולג.
  // ליקוי 6: תפוסים = cxItem + כל הקודים שהופיעו בקטלוג (cxcfg/seen).
  const linked = new Set([...S.X.values()].map((x) => x.pid).filter(Boolean));
  const cand = [...S.P].filter(([id, p]) => !linked.has(id) && !p.cx && p.on !== false).map(([id]) => id);
  if (max !== Infinity) { const pend = [...S.X.values()].filter((x) => x.nw && S.P.has(x.pid)).length; if (cand.length + pend > max) throw over(cand.length + pend); }
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
async function cxDnOk(w, input) {
  onlyKeys(input, ['pid']);
  const pid = idOf(input.pid, 'מוצר');
  const ref = T.tdb().doc('prod/' + pid);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'המוצר לא נמצא', { reason: 'no-prod' });
  await ref.update({ dn: FV().delete(), upd: Date.now(), dnBy: w.uid });
  return { ok: true };
}

// cxHist({ pid }) → { codes:[קודי כספית], log:[{ k, old, new, src, at }] } – היסטוריית מחיר ועלות למוצר (30 אחרונים)
async function cxHist(w, input) {
  void w;
  onlyKeys(input, ['pid']);
  const pid = idOf(input.pid, 'מוצר');
  const db = T.tdb();
  const [l, x] = await Promise.all([db.collection('priceLog').where('prod', '==', pid).orderBy('at', 'desc').limit(30).get(), db.collection('cxItem').where('pid', '==', pid).limit(20).get()]);
  return { codes: x.docs.map((d) => d.id), log: l.docs.map((d) => ({ k: d.get('k'), old: d.get('old'), new: d.get('new'), src: d.get('src'), at: d.get('at') })) };
}

// =====================================================================================================
// A2 (17.11.2026): דוח מכירות לפריטים מכספית → מלאי.
//   cxTx/{bk}_{yyyymmdd}_{עסקה}  { d, tx, bk, bn, bd: מזהה היום, dc:[d|קוד] (חיפוש שורות של מוצר), sb: סניף המלאי, un: יש שורה "לא בטוח",
//                                   lines:[{ k, c, n, a, ds, w?, t?, q, qs, why?, pid?, P? }], run, at, upd }   (t = שעת המכירה בדקות, C1)
//       k = קוד|פדיון|הנחה|מופע (CC.salesGroup) – מפתח השורה בתוך העסקה. שורה שהמפתח שלה כבר שמור – לא נספרת שוב (העלאה חוזרת / דוח חופף).
//       qs: sure / disc / unsure (כמות מוצעת – יורדת מהמלאי ומסומנת לבדיקה) / own (תוקן) / ok (אושר) / skip (קוד מיוחד) / nolink (קוד לא מוכר).
//   cxDay/{bk}_{yyyymmdd}        { d, bk, bn, gross, ret, disc, ntx, nl, sp, un, it:{ קוד:{ n, cat, q, r, a, ds, u, sp? } }, h?:{ 'HH'|'na': נטו } } – סיכום יומי לכל סניף בכספית (A3).
//       h (C1, 19.11.2026): פדיון נטו לפי שעת המכירה (שורה בלי שעה → 'na'). רק לשורות שנקלטו מאז; ימים ישנים – בלי h (CC.salesHours).
//       tm? (C2): { y, n, p, q } – כמה שורות בדוח האחרון שעדכן את היום היו עם/בלי שעה, ודפוס מוסווה של תא התאריך (לאבחון הפורמט של כספית).
//   prod/{id}.q.<br> יורד/עולה ב-FieldValue.increment; stockLog { why:'cx', src:'caspit', d, note: עסקה + סניף, run }.
//   שורת "לא בטוח" לא עוצרת את שאר השורות: הכמות המוצעת יורדת מהמלאי, ובעל העסק מאשר או מתקן (cxFix – ההפרש נרשם בתנועות).
// =====================================================================================================
const SPART = 1000; // שורות מכירה בכל חלק שנשלח לשרת
const MAX_SPARTS = 30; // עד 30,000 שורות בקובץ
const SPV = 120; // שורות בכל חלק של האישור (= טרנזקציה אחת; עד ~370 כתיבות)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TXID_RE = /^[\p{L}\p{N}_-]{3,120}$/u;
const fkey = (c) => (/^__.*__$/.test(c) ? '_' + c : c); // שם שדה במפה (it) – בלי שמות שמורים של Firestore
const nOr = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
// שורת מכירה מהטלפון (אחרי CC.parseSales) – רק השדות הידועים, באורך מוגבל. לא תקין → null
function cleanLine(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const d = typeof x.d === 'string' && DATE_RE.test(x.d) && CC.dateOf(x.d) === x.d ? x.d : '';
  const c = s(x.c, 40).trim(), tx = CC.txKey(x.tx), bk = s(x.bk, 30);
  const a = nOr(x.a, -1000000, 1000000), ds = x.ds == null ? 0 : nOr(x.ds, -1000000, 1000000);
  if (!d || !c || !tx || !BK_RE.test(bk) || a == null || ds == null) return null;
  const w = x.w == null ? null : nOr(x.w, 0, 100000);
  const o = { d, c, n: s(x.n, 80), tx, bk, bn: s(x.bn, 60), w: w > 0 ? w : null, ds: CC.r2(ds), a: CC.r2(a) };
  if (Number.isInteger(x.t) && x.t >= 0 && x.t < 1440) o.t = x.t; // C1: שעת המכירה (דקות) – רשות. חסר/לא תקין → בלי שעה (סל 'na'), השורה לא נדחית
  if (x.bkn === true) o.bkn = true; // מפתח הסניף לפי השם (אין מספר סניף בקובץ) – previewSales ממיר
  return o;
}
// C2: סטטיסטיקת שעת המכירה מהטלפון/תוסף { y, n, p, q } (CC.parseSales) – מספרים שלמים ודפוס מוסווה בלבד (בלי ספרות). לא תקין → null (לא נכשל)
function cleanTm(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const y = nOr(x.y, 0, 10000000), n = nOr(x.n, 0, 10000000);
  if (y == null || n == null || !Number.isInteger(y) || !Number.isInteger(n)) return null;
  const pm = (v) => (typeof v === 'string' ? v.slice(0, 30).replace(/[^dah #@:/.,+\-()'"_|?]/g, '?') : '');
  return { y, n, p: pm(x.p), q: pm(x.q) };
}
// תיקון סבב 1 (הערה 7): מפתח סניף יציב. cxcfg.bkn = { <מפתח לפי שם>: <מספר סניף> } נלמד מכל דוח שיש בו גם שם וגם מספר.
// שורה בלי מספר סניף מקבלת את המספר המוכר לפי השם; אם אין – ואם ידוע סניף אחד בלבד (בהגדרות ובקובץ) – אותו סניף.
function bkFix(lines, map) {
  const known = new Set(Object.values(map || {}));
  const learn = {};
  for (const l of lines) if (!l.bkn && /^\d+$/.test(l.bk) && l.bn) { const nk = CC.brKey('', l.bn); learn[nk] = l.bk; known.add(l.bk); }
  const M = Object.assign({}, map || {}, learn);
  let fixed = 0, left = 0;
  for (const l of lines) {
    if (!l.bkn) continue;
    const to = M[l.bk] || (known.size === 1 ? [...known][0] : null);
    if (to) { l.bk = to; fixed++; } else left++;
    delete l.bkn;
  }
  return { learn, fixed, left };
}

// תצוגה מקדימה של דוח מכירות: לא כותב למלאי. → { kind:'sales', cnt, rows:[[i, d, tx, c, n, a, ds, bk, qs, q, P, why]], bks, gone, br }
async function previewSales(db, w, ref, ins) {
  const lines = ins.docs.sort((a, b) => +a.id - +b.id).flatMap((d) => d.get('lines') || []);
  const badSrv = ins.docs.reduce((t, d) => t + (d.get('bad') || 0), 0);
  const tmd = ins.docs.find((d) => d.get('tm')), tm = tmd ? cleanTm(tmd.get('tm')) : null; // C2
  const [cs, xs, ps] = await Promise.all([db.doc(CFG).get(), db.collection('cxItem').select('pid', 'pr').get(), db.collection('prod').select('price', 'name', 'cat').get()]);
  const cfg = cfgOf(cs), skip = new Set(cfg.skip.map(String));
  const bkr = bkFix(lines, cs.exists && cs.get('bkn') && typeof cs.get('bkn') === 'object' ? cs.get('bkn') : {});
  const G = CC.salesGroup(lines);
  const X = new Map(xs.docs.map((d) => [d.id, d.data()]));
  const P = new Map(ps.docs.map((d) => [d.id, d.data()]));
  const saved = new Map();
  for (let i = 0; i < G.length; i += 300) {
    const sn = await db.getAll(...G.slice(i, i + 300).map((g) => db.doc('cxTx/' + g.id)));
    sn.forEach((x) => { if (x.exists) saved.set(x.id, new Set((x.get('lines') || []).map((l) => l.k))); });
  }
  const rows = [], groups = [], gone = [], bks = {};
  const cnt = { kind: 'sales', lines: lines.length, tx: G.length, nw: 0, dup: 0, sure: 0, disc: 0, unsure: 0, skip: 0, nolink: 0, ret: 0, gross: 0, retA: 0, discA: 0, gone: 0, days: [], pc: 0, badSrv, bkLeft: bkr.left };
  // תיקון סבב 1 (הערה 1): ספירת מלאי ידנית (why:'set') – שורות מכירה מיום שלפני הספירה האחרונה של המוצר כנראה כבר נכללו בספירה.
  // רק אזהרה (pc), האישור מותר. אם השאילתה נכשלה (למשל אינדקס חסר) – בלי אזהרה (cnt.pcErr)
  const lastSet = new Map();
  try {
    const from = lines.reduce((m, l) => (l.d < m ? l.d : m), '9999');
    if (from !== '9999') {
      const sn = await db.collection('stockLog').where('why', '==', 'set').where('at', '>=', Date.parse(from + 'T00:00:00Z') - 3 * 3600e3).get();
      sn.docs.forEach((d) => { const x = d.data(), day = ymdIL(x.at); if (x.prod && day && (!lastSet.has(x.prod) || lastSet.get(x.prod) < day)) lastSet.set(x.prod, day); });
    }
  } catch (e) { cnt.pcErr = 1; }
  const days = new Set();
  let i = 0;
  for (const g of G) {
    bks[g.bk] = g.bn || g.bk; days.add(g.d);
    const sv = saved.get(g.id), fk = new Set(), nl = [];
    for (const l of g.L) {
      fk.add(l.k);
      const idx = i++;
      if (sv && sv.has(l.k)) { cnt.dup++; rows.push([idx, l.d, l.tx, l.c, l.n, l.a, l.ds, l.bk, 'dup', null, null, '']); continue; }
      const o = { i: idx, k: l.k, c: l.c, n: l.n, a: l.a, ds: l.ds };
      if (l.w) o.w = l.w;
      if (typeof l.t === 'number') o.t = l.t; // C1: שעת המכירה
      const x = X.get(l.c), pid = x && x.pid && P.has(x.pid) ? x.pid : null;
      if (skip.has(l.c)) Object.assign(o, { qs: 'skip', q: null });
      else if (!pid) Object.assign(o, { qs: 'nolink', q: null });
      else {
        const ap = P.get(pid).price, pr = typeof ap === 'number' && ap > 0 ? ap : x.pr && typeof x.pr.fb === 'number' && x.pr.fb > 0 ? x.pr.fb : null;
        const r = CC.qtyOf(l.a, l.ds, pr, l.w);
        Object.assign(o, { qs: r.qs, q: r.q, pid, P: pr });
        if (r.why) o.why = r.why;
        if (lastSet.has(pid) && l.d < lastSet.get(pid)) { o.pc = lastSet.get(pid); cnt.pc++; }
      }
      cnt[o.qs]++; cnt.nw++;
      if (l.a < 0) { cnt.ret++; cnt.retA += -l.a; } else cnt.gross += l.a;
      cnt.discA += l.ds || 0;
      nl.push(o);
      rows.push([idx, l.d, l.tx, l.c, l.n, l.a, l.ds, l.bk, o.qs, o.q, o.P == null ? null : o.P, o.why || '', o.pc || '']);
    }
    if (sv) for (const k of sv) if (!fk.has(k)) { cnt.gone++; if (gone.length < 500) gone.push({ id: g.id, d: g.d, tx: g.tx, bk: g.bk, k }); }
    if (nl.length) groups.push({ id: g.id, bk: g.bk, bn: g.bn, d: g.d, tx: g.tx, L: nl });
  }
  for (const k of ['gross', 'retA', 'discA']) cnt[k] = CC.r2(cnt[k]);
  cnt.days = [...days].sort();
  if (tm) cnt.tm = tm; // C2: נשמר במסמך הריצה (cnt) ומשם לכל cxDay שמתעדכן באישור
  // חלקים של עד SPV שורות (עסקה גדולה מתפצלת – כל חלק בודק מחדש את המפתחות השמורים, אז אין ספירה כפולה)
  const pv = []; let cur = [], n = 0;
  for (const g of groups) {
    let L = g.L;
    while (L.length) {
      const room = SPV - n, take = L.slice(0, room);
      cur.push(Object.assign({}, g, { L: take })); n += take.length; L = L.slice(room);
      if (n >= SPV) { pv.push(cur); cur = []; n = 0; }
    }
  }
  if (cur.length) pv.push(cur);
  const old = await ref.collection('pv').listDocuments();
  const ops = old.map((d) => (b) => b.delete(d));
  pv.forEach((g, k) => ops.push((b) => b.set(ref.collection('pv').doc(String(k)), { rows: g })));
  for (let k = 0; k < ops.length; k += 100) { const b = db.batch(); ops.slice(k, k + 100).forEach((f) => f(b)); await b.commit(); }
  const br = stockBr(w, cfg);
  await ref.update({ st: 'pv', pvN: pv.length, cnt, pvAt: Date.now(), bkn: bkr.learn });
  return { kind: 'sales', cnt, rows, bks, gone, br, reg: cfg.reg };
}

// אישור דוח מכירות. qty = { <מספר שורה>: כמות } – תיקון כמות בתצוגה המקדימה (לשורה שמשנה מלאי). → { done, next?, res }
async function applySales(db, w, run, ref, r, input, t0) {
  if (input.take !== undefined || input.skip !== undefined) throw bad('bad-field', 'שדה לא מוכר בדוח מכירות');
  const cfg = cfgOf(await db.doc(CFG).get());
  const br = stockBr(w, cfg);
  if (!br) throw pre('no-br', 'בחרו בהגדרות של סנכרון כספית מאיזה סניף יורד המלאי');
  if (r.get('st') === 'void') throw pre('stale', STALE);
  if (r.get('st') === 'pv') {
    const qty = {};
    if (input.qty != null) {
      if (typeof input.qty !== 'object' || Array.isArray(input.qty) || Object.keys(input.qty).length > 30000) throw bad('bad-qty', 'כמויות לא תקינות');
      for (const [k, v] of Object.entries(input.qty)) { if (!/^\d{1,6}$/.test(k) || nOr(v, -100000, 100000) == null) throw bad('bad-qty', 'כמות לא תקינה'); qty[k] = Math.round(v * 1000) / 1000; }
    }
    await db.runTransaction(async (tx) => { const x = await tx.get(ref); if (x.get('st') === 'pv') tx.update(ref, { st: 'ap', sel: { qty, br }, apAt: t0, res: {} }); });
    r = await ref.get();
  }
  const sel = r.get('sel') || { qty: {}, br };
  if (sel.br && sel.br !== br) throw pre('br-changed', 'סניף המלאי השתנה מאז התחלת השמירה. בחרו שוב את הקובץ.');
  const N = r.get('pvN') || 0;
  const doneIds = new Set((await ref.collection('done').listDocuments()).map((d) => d.id));
  for (let k = 0; k < N; k++) {
    if (doneIds.has(String(k))) continue;
    if (Date.now() - t0 > BUDGET) return { done: false, next: k, res: (await ref.get()).get('res') || {} };
    const groups = (await ref.collection('pv').doc(String(k)).get()).get('rows') || [];
    try { await applySalesPart(db, w, run, ref, k, groups, sel.qty || {}, br, cleanTm((r.get('cnt') || {}).tm)); } catch (e) {
      // תיקון סבב 1 (הערה 8): קישור קוד→מוצר השתנה מאז התצוגה. מה שכבר נשמר נשאר (המפתחות ב-cxTx); ההרצה חוזרת לתצוגה מקדימה,
      // והטלפון מציג אותה מחדש (שורות שנשמרו יופיעו "כבר נקלטו")
      if (e && e.details && e.details.reason === 'stale') {
        const dl = await ref.collection('done').listDocuments();
        for (let i = 0; i < dl.length; i += 400) { const b = db.batch(); dl.slice(i, i + 400).forEach((d) => b.delete(d)); await b.commit(); }
        await ref.update({ st: 'pv', sel: FV().delete() });
      }
      throw e;
    }
  }
  const bkn = r.get('bkn') || {};
  await db.runTransaction(async (tx) => {
    const x = await tx.get(ref);
    if (x.get('st') === 'done') return;
    tx.update(ref, { st: 'done', doneAt: Date.now() });
    tx.set(db.doc(CFG), Object.assign({ lastSales: { run, at: Date.now() } }, Object.keys(bkn).length ? { bkn } : {}), { merge: true }); // bkn: שם סניף → מספר (נלמד)
  });
  const res = (await ref.get()).get('res') || {};
  logger.info('cxApply sales', { biz: w.bizId || '', run, res });
  return { done: true, res, ix: await appliedIx(ref) };
}
// תיקון סבב 1 (הערה 10): מספרי השורות שנשמרו בפועל (מסימוני החלקים) – למשבצות מסך הסיום
async function appliedIx(ref) { const d = await ref.collection('done').get(); return d.docs.flatMap((x) => x.get('ix') || []).sort((a, b) => a - b); }
const ymdIL = (t) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); } catch (e) { return ''; } };

// חלק אחד בטרנזקציה: קורא את העסקאות השמורות ואת המוצרים, מוסיף רק שורות חדשות, מעדכן מלאי, תנועות וסיכום יומי.
// tm (C2, רשות) = סטטיסטיקת שעת המכירה של הקובץ – נכתב לכל cxDay שמתעדכן (מחליף את הקודם: כל השדות תמיד נשלחים)
async function applySalesPart(db, w, run, ref, k, groups, qty, br, tm) {
  const mark = ref.collection('done').doc(String(k));
  await db.runTransaction(async (tx) => {
    if ((await tx.get(mark)).exists) return;
    const ids = [...new Set(groups.map((g) => g.id))];
    const tsn = ids.length ? await tx.getAll(...ids.map((id) => db.doc('cxTx/' + id))) : [];
    const T0 = new Map(tsn.map((x) => [x.id, x]));
    const pids = [...new Set(groups.flatMap((g) => g.L.map((l) => l.pid).filter(Boolean)))];
    const psn = pids.length ? await tx.getAll(...pids.map((id) => db.doc('prod/' + id))) : [];
    const PS = new Map(psn.filter((x) => x.exists).map((x) => [x.id, x.data() || {}]));
    // הערה 8: הקישור של כל קוד (פרט לקודים מיוחדים) נבדק שוב בתוך הטרנזקציה – שונה מהתצוגה → stale
    const codes = [...new Set(groups.flatMap((g) => g.L.filter((l) => l.qs !== 'skip').map((l) => l.c)))].filter((c) => CC.CODE_RE.test(c) && !/^__.*__$/.test(c));
    const xsn = codes.length ? await tx.getAll(...codes.map((c) => db.doc('cxItem/' + c))) : [];
    const XL = new Map(xsn.map((x) => [x.id, x.exists ? x.get('pid') || null : null]));
    // קוד שלא היה מקושר בתצוגה וקיבל עכשיו קישור למוצר קיים – גם זה שינוי (למוצר שלא קיים – לא)
    const neu = [...new Set(groups.flatMap((g) => g.L.filter((l) => l.qs !== 'skip' && !l.pid && XL.get(l.c)).map((l) => XL.get(l.c))))];
    const nsn = neu.length ? await tx.getAll(...neu.map((id) => db.doc('prod/' + id))) : [];
    const NE = new Set(nsn.filter((x) => x.exists).map((x) => x.id));
    for (const g of groups) for (const l of g.L) {
      if (l.qs === 'skip' || !XL.has(l.c)) continue;
      const now1 = XL.get(l.c), was = l.pid || null;
      if (was ? now1 !== was : now1 && NE.has(now1)) throw pre('stale', 'קישור המוצרים השתנה מאז התצוגה המקדימה (נשמר בינתיים קטלוג). מציגים שוב.');
    }
    const ix = [];
    const now = Date.now();
    const res = { lines: 0, dup: 0, stock: 0, sold: 0, back: 0, unsure: 0, skip: 0, nolink: 0, tx: 0 };
    const move = new Map(), day = new Map(), txw = new Map();
    for (const g of groups) {
      const s0 = T0.get(g.id);
      const cur = txw.get(g.id) || { lines: s0 && s0.exists ? (s0.get('lines') || []).slice() : [], fresh: !(s0 && s0.exists), g, logs: new Map() };
      txw.set(g.id, cur);
      const have = new Set(cur.lines.map((l) => l.k));
      const did = dayIdOf(g), D = day.get(did) || { d: g.d, bk: g.bk, bn: g.bn, gross: 0, ret: 0, disc: 0, ntx: 0, nl: 0, sp: 0, un: 0, it: {}, h: {} };
      day.set(did, D);
      for (const l0 of g.L) {
        if (have.has(l0.k)) { res.dup++; continue; }
        have.add(l0.k);
        const l = { k: l0.k, c: l0.c, n: l0.n, a: l0.a, ds: l0.ds || 0, q: l0.q, qs: l0.qs };
        if (l0.w) l.w = l0.w;
        if (typeof l0.t === 'number') l.t = l0.t;
        if (l0.why) l.why = l0.why;
        if (l0.P != null) l.P = l0.P;
        if (l0.pid) l.pid = l0.pid;
        if (l.pid && !PS.has(l.pid)) { l.qs = 'nolink'; l.q = null; delete l.pid; } // המוצר נמחק מאז התצוגה
        if (l.pid && qty[String(l0.i)] !== undefined && CC.qSignOk(l.a, qty[String(l0.i)])) { l.q = qty[String(l0.i)]; l.qs = 'own'; delete l.why; } // הערה 4: סימן הפוך לפדיון – לא מתקבל
        cur.lines.push(l);
        ix.push(l0.i);
        res.lines++;
        if (l.qs === 'skip') res.skip++; else if (l.qs === 'nolink') res.nolink++; else if (l.qs === 'unsure') res.unsure++;
        const p = l.pid ? PS.get(l.pid) : null;
        if (CC.stockQ(l) && l.q) {
          move.set(l.pid, (move.get(l.pid) || 0) + l.q);
          cur.logs.set(l.pid, (cur.logs.get(l.pid) || 0) + l.q);
          res.stock++; if (l.q > 0) res.sold += l.q; else res.back += -l.q;
        }
        if (l.a >= 0) D.gross += l.a; else D.ret += -l.a;
        D.disc += l.ds; D.nl++;
        if (l.qs === 'skip') D.sp += l.a - l.ds;
        if (l.qs === 'unsure') D.un++;
        const hk = CC.hourKey(l.t); D.h[hk] = (D.h[hk] || 0) + l.a - l.ds; // C1: פדיון נטו לפי שעה (בלי שעה → 'na'); סכום השעות = gross − ret − disc
        const key = fkey(l.c), it = D.it[key] || (D.it[key] = { n: l.n || (p && p.name) || '', cat: (p && p.cat) || '', q: 0, r: 0, a: 0, ds: 0, u: 0, sp: l.qs === 'skip' });
        const q = typeof l.q === 'number' ? l.q : 0;
        if (q > 0) it.q += q; else it.r += -q;
        it.a += l.a; it.ds += l.ds; if (l.qs === 'unsure') it.u++;
      }
    }
    for (const [id, cur] of txw) {
      const g = cur.g, L = cur.lines;
      const dc = [...new Set(L.map((l) => g.d + '|' + l.c))];
      if (cur.fresh && L.length) { day.get(dayIdOf(g)).ntx++; res.tx++; }
      if (!L.length) continue;
      tx.set(db.doc('cxTx/' + id), { d: g.d, tx: g.tx, bk: g.bk, bn: g.bn || '', bd: dayIdOf(g), dc, sb: br, un: L.some((l) => l.qs === 'unsure'), lines: L, run, at: cur.fresh ? now : (T0.get(id).get('at') || now), upd: now });
      for (const [pid, q] of cur.logs) {
        const p = PS.get(pid) || {};
        tx.set(O.stockRef(db), { prod: pid, name: p.name || '', br, delta: O.r3(-q), why: 'cx', src: 'caspit', d: g.d, note: `כספית · עסקה ${g.tx}${g.bn ? ' · ' + g.bn : ''}`.slice(0, 200), run, by: w.uid, at: now });
      }
    }
    for (const [pid, q] of move) if (q) tx.update(db.doc('prod/' + pid), new FieldPath('q', br), FV().increment(O.r3(-q)), 'upd', now);
    const inc = (v) => FV().increment(CC.r2(v));
    for (const [id, D] of day) {
      if (!D.nl && !D.ntx) continue;
      const it = {};
      for (const [c, v] of Object.entries(D.it)) it[c] = Object.assign({ n: v.n, cat: v.cat, q: FV().increment(O.r3(v.q)), r: FV().increment(O.r3(v.r)), a: inc(v.a), ds: inc(v.ds), u: FV().increment(v.u) }, v.sp ? { sp: true } : {});
      const h = Object.fromEntries(Object.entries(D.h).map(([k, v]) => [k, inc(v)]));
      tx.set(db.doc('cxDay/' + id), Object.assign({ d: D.d, bk: D.bk, bn: D.bn || '', gross: inc(D.gross), ret: inc(D.ret), disc: inc(D.disc), ntx: FV().increment(D.ntx), nl: FV().increment(D.nl), sp: inc(D.sp), un: FV().increment(D.un), it, upd: now }, Object.keys(h).length ? { h } : {}, tm ? { tm } : {}), { merge: true });
    }
    tx.set(mark, { at: now, res, ix });
    tx.update(ref, Object.fromEntries(Object.entries(res).map(([kk, v]) => ['res.' + kk, FV().increment(v)])));
  });
}
const dayIdOf = (g) => CC.dayId(g.bk, g.d);

// =====================================================================================================
// מכירות היום – תמונת מצב חלקית מהתוסף (19.11.2026; כל שעה 07:00–23:00, לא בשבת וחג; רובוט בלבד – caspit-bot.js upload עם partial).
//   לא נוגע במלאי, ב-cxTx, ב-cxDay, ב-lastSales או ביום האחרון שנקלט: רק cxDayP/{bk}_{yyyymmdd} – אותה צורה כמו cxDay (סיכום יומי לכל סניף,
//   כולל it ו-h) + pt:{ at, hm } ("חלקי – עד השעה hm"). כל העלאה מחליפה את כל מסמכי היום (סניף שנעלם – נמחק).
//   cxSales מחזיר אותם רק עם pt:true, ורק ליום שאין לו אף cxDay – הסנכרון הלילי של היום "דורס" אותם; הדיווח שלו מוחק אותם (partDrop).
//   הכמויות – כמו בתצוגה המקדימה (qtyOf לפי המחיר באפליקציה), רק לתצוגה.
// =====================================================================================================
const PMAX = 30000;
async function cxPartial(w, input) {
  void w;
  const day = input.day, hm = input.hm, now = input.now || Date.now();
  if (typeof day !== 'string' || !DATE_RE.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hm))) throw bad('bad-day', 'יום / שעה לא תקינים');
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > PMAX) throw bad('bad-lines', `שורות: 1 עד ${PMAX}`);
  const all = input.lines.map(cleanLine), lines = all.filter((l) => l && l.d === day);
  if (!lines.length) throw bad('bad-lines', 'אין שורות מכירה תקינות מהיום');
  const db = T.tdb();
  const cs = await db.doc(CFG).get();
  const cfg = cfgOf(cs), skip = new Set(cfg.skip.map(String));
  bkFix(lines, cs.exists && cs.get('bkn') && typeof cs.get('bkn') === 'object' ? cs.get('bkn') : {});
  const codes = [...new Set(lines.map((l) => l.c))].filter((c) => !skip.has(c) && CC.CODE_RE.test(c) && !/^__.*__$/.test(c));
  const X = new Map(), P = new Map();
  for (let i = 0; i < codes.length; i += 300) (await db.getAll(...codes.slice(i, i + 300).map((c) => db.doc('cxItem/' + c)), { fieldMask: ['pid', 'pr'] })).forEach((x) => { if (x.exists) X.set(x.id, x.data()); });
  const pids = [...new Set([...X.values()].map((x) => x.pid).filter((p) => typeof p === 'string' && p && !p.includes('/')))];
  for (let i = 0; i < pids.length; i += 300) (await db.getAll(...pids.slice(i, i + 300).map((p) => db.doc('prod/' + p)), { fieldMask: ['price', 'name', 'cat'] })).forEach((x) => { if (x.exists) P.set(x.id, x.data()); });
  const days = new Map(), txs = new Map();
  for (const l of lines) {
    const id = CC.dayId(l.bk, l.d);
    let D = days.get(id);
    if (!D) { D = { d: l.d, bk: l.bk, bn: l.bn || '', gross: 0, ret: 0, disc: 0, ntx: 0, nl: 0, sp: 0, un: 0, it: {}, h: {} }; days.set(id, D); txs.set(id, new Set()); }
    if (l.bn) D.bn = l.bn;
    txs.get(id).add(l.tx);
    const sp = skip.has(l.c), x = X.get(l.c), p = !sp && x && x.pid ? P.get(x.pid) : null;
    let q = 0, u = 0;
    if (p) {
      const pr = typeof p.price === 'number' && p.price > 0 ? p.price : x.pr && typeof x.pr.fb === 'number' && x.pr.fb > 0 ? x.pr.fb : null;
      const r = CC.qtyOf(l.a, l.ds, pr, l.w); q = r.q; if (r.qs === 'unsure') u = 1;
    }
    if (l.a >= 0) D.gross += l.a; else D.ret += -l.a;
    D.disc += l.ds; D.nl++; D.un += u;
    if (sp) D.sp += l.a - l.ds;
    const hk = CC.hourKey(l.t); D.h[hk] = (D.h[hk] || 0) + l.a - l.ds;
    const key = fkey(l.c), it = D.it[key] || (D.it[key] = Object.assign({ n: l.n || (p && p.name) || '', cat: (p && p.cat) || '', q: 0, r: 0, a: 0, ds: 0, u: 0 }, sp ? { sp: true } : {}));
    if (q > 0) it.q += q; else it.r += -q;
    it.a += l.a; it.ds += l.ds; it.u += u;
  }
  const R3 = (v) => Math.round(v * 1000) / 1000;
  const pt = { at: now, hm };
  const old = await db.collection('cxDayP').where('d', '==', day).get();
  const b = db.batch();
  for (const x of old.docs) if (!days.has(x.id)) b.delete(x.ref);
  for (const [id, D] of days) {
    D.ntx = txs.get(id).size;
    for (const k of ['gross', 'ret', 'disc', 'sp']) D[k] = CC.r2(D[k]);
    for (const k of Object.keys(D.h)) D.h[k] = CC.r2(D.h[k]);
    for (const v of Object.values(D.it)) { v.q = R3(v.q); v.r = R3(v.r); v.a = CC.r2(v.a); v.ds = CC.r2(v.ds); }
    b.set(db.doc('cxDayP/' + id), Object.assign(D, { pt, upd: now }));
  }
  await b.commit();
  return { n: lines.length, bad: all.length - lines.length, br: days.size };
}
// הסנכרון הלילי קלט ימים עד sd (כולל) – התמונות החלקיות שלהם כבר לא נחוצות
async function partDrop(sd) {
  if (typeof sd !== 'string' || !DATE_RE.test(sd)) return 0;
  const db = T.tdb();
  const x = await db.collection('cxDayP').where('d', '<=', sd).limit(200).get();
  if (!x.size) return 0;
  const b = db.batch(); x.docs.forEach((d) => b.delete(d.ref)); await b.commit();
  return x.size;
}

// =====================================================================================================
// A3: מסך "מכירות כספית" (מנהל בלבד, החלטה 5) – סיכומים יומיים, שורות, תיקון כמות "לא בטוח". לא יוצר הכנסות.
// =====================================================================================================
// cxSales({ from, to }) – עד 92 ימים → { days:[cxDay בלי it, כולל h – מכירות לפי שעה], items:{ קוד:{ n, cat, sp?, v:{ i:[q,r,a,ds,u] } } }, cats:{ id: שם }, cfg:{ reg, inc, br }, sa }
//   pt:true (אפליקציה מ-19.11.2026): גם תמונות מצב חלקיות של היום (cxDayP, pt:{ at, hm }) – רק ליום שאין לו אף cxDay. בלי pt – כמו קודם
//   (אפליקציה ישנה לא תקבל נתון חלקי שייראה לה סופי, למשל בהתאמה לסגירת קופה).
async function cxSales(w, input) {
  onlyKeys(input, ['from', 'to', 'pt']);
  if (input.pt !== undefined && input.pt !== true) throw bad('bad-field', 'שדה לא תקין: pt');
  const from = CC.dateOf(input.from), to = CC.dateOf(input.to);
  if (!from || !to || from !== input.from || to !== input.to || from > to) throw bad('bad-range', 'טווח תאריכים לא תקין');
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 91) throw bad('bad-range', 'עד 92 ימים בכל בקשה'); // תיקון סבב 1 (הערה 5): טווח ארוך – הטלפון מבקש בחלקים
  const db = T.tdb();
  const [ds, cs, ct, pp] = await Promise.all([db.collection('cxDay').where('d', '>=', from).where('d', '<=', to).get(), db.doc(CFG).get(), db.collection('cat').select('name').get(),
    input.pt === true ? db.collection('cxDayP').where('d', '>=', from).where('d', '<=', to).get() : null]);
  const cfg = cfgOf(cs);
  const docs = ds.docs.map((d) => { const x = d.data(); delete x.upd; return x; });
  if (pp) { const have = new Set(docs.map((x) => x.d)); for (const d of pp.docs) { const x = d.data(); if (have.has(x.d)) continue; delete x.upd; docs.push(x); } }
  const { days, items } = CC.packDays(docs); // צורה קומפקטית (CC.unpackDays בטלפון)
  return { days, items, cats: Object.fromEntries(ct.docs.map((d) => [d.id, d.get('name') || ''])), cfg: { reg: cfg.reg, br: stockBr(w, cfg), lastSales: cfg.lastSales }, sa: !!w.superadmin };
}
// cxLines({ bd } | { c, days:[d] } | { un:true } | { id }) → { tx:[{ id, d, tx, bk, bn, lines }] } – השורות שמאחורי מספר (החלטה 12)
async function cxLines(w, input) {
  void w;
  onlyKeys(input, ['bd', 'c', 'days', 'un', 'id']);
  const db = T.tdb();
  let docs = [];
  let c = null;
  if (input.id !== undefined) {
    if (typeof input.id !== 'string' || !TXID_RE.test(input.id)) throw bad('bad-id', 'מזהה לא תקין');
    const x = await db.doc('cxTx/' + input.id).get(); if (x.exists) docs = [x];
  } else if (input.bd !== undefined) {
    if (typeof input.bd !== 'string' || !TXID_RE.test(input.bd)) throw bad('bad-id', 'מזהה לא תקין');
    docs = (await db.collection('cxTx').where('bd', '==', input.bd).limit(3000).get()).docs;
  } else if (input.c !== undefined) {
    c = s(input.c, 40).trim();
    if (!c || !Array.isArray(input.days) || !input.days.length || input.days.length > 400 || input.days.some((d) => typeof d !== 'string' || !DATE_RE.test(d))) throw bad('bad-days', 'ימים לא תקינים');
    const keys = input.days.map((d) => d + '|' + c);
    for (let i = 0; i < keys.length; i += 30) docs.push(...(await db.collection('cxTx').where('dc', 'array-contains-any', keys.slice(i, i + 30)).get()).docs);
  } else if (input.un === true) {
    docs = (await db.collection('cxTx').where('un', '==', true).limit(500).get()).docs;
  } else throw bad('bad-query', 'חסר מה להציג');
  const tx = docs.map((d) => { const x = d.data(); return { id: d.id, d: x.d, tx: x.tx, bk: x.bk, bn: x.bn, lines: (x.lines || []).filter((l) => (!c || l.c === c) && (input.un !== true || l.qs === 'unsure')).map((l) => ({ k: l.k, c: l.c, n: l.n, a: l.a, ds: l.ds, q: l.q, qs: l.qs, why: l.why, P: l.P, t: l.t })) }; })
    .filter((x) => x.lines.length).sort((a, b) => (a.d === b.d ? (a.tx < b.tx ? 1 : -1) : a.d < b.d ? 1 : -1));
  return { tx };
}
// cxFix({ id, k, q }) – אישור / תיקון כמות של שורה (בעיקר "לא בטוח"). ההפרש יורד/עולה במלאי ונרשם בתנועות; הסיכום היומי מתעדכן.
async function cxFix(w, input) {
  onlyKeys(input, ['id', 'k', 'q']);
  if (typeof input.id !== 'string' || !TXID_RE.test(input.id) || typeof input.k !== 'string' || input.k.length > 200) throw bad('bad-id', 'שורה לא תקינה');
  const q1 = nOr(input.q, -100000, 100000);
  if (q1 == null) throw bad('bad-qty', 'כמות לא תקינה');
  const nq = Math.round(q1 * 1000) / 1000;
  const db = T.tdb();
  const ref = db.doc('cxTx/' + input.id);
  let out = null;
  await db.runTransaction(async (tx) => {
    const x = await tx.get(ref);
    if (!x.exists) throw new HttpsError('not-found', 'העסקה לא נמצאה', { reason: 'no-tx' });
    const L = (x.get('lines') || []).slice(), i = L.findIndex((l) => l.k === input.k);
    if (i < 0) throw new HttpsError('not-found', 'השורה לא נמצאה', { reason: 'no-line' });
    const l = Object.assign({}, L[i]);
    if (!CC.stockQ(l)) throw pre('no-stock-line', 'השורה הזו לא משנה מלאי (קוד מיוחד או לא מוכר)');
    if (!CC.qSignOk(l.a, nq)) throw bad('bad-sign', l.a < 0 ? 'בהחזרה הכמות שלילית (או 0)' : 'במכירה הכמות חיובית (או 0)');
    const br = x.get('sb');
    const p = await tx.get(db.doc('prod/' + l.pid));
    const old = l.q, wasU = l.qs === 'unsure', d = O.r3(nq - old);
    if (d && p.exists) {
      tx.update(p.ref, new FieldPath('q', br), FV().increment(O.r3(-d)), 'upd', Date.now());
      tx.set(O.stockRef(db), { prod: l.pid, name: p.get('name') || '', br, delta: O.r3(-d), why: 'cx', src: 'caspit', d: x.get('d'), note: `כספית · תיקון כמות · עסקה ${x.get('tx')}`.slice(0, 200), by: w.uid, at: Date.now() });
    }
    Object.assign(l, { q: nq, qs: d ? 'own' : wasU ? 'ok' : l.qs === 'own' ? 'own' : 'ok', fixBy: w.uid, fixAt: Date.now() });
    delete l.why;
    L[i] = l;
    tx.update(ref, { lines: L, un: L.some((z) => z.qs === 'unsure'), upd: Date.now() });
    const sold = (v) => (v > 0 ? v : 0), back = (v) => (v < 0 ? -v : 0);
    const it = { q: FV().increment(O.r3(sold(nq) - sold(old))), r: FV().increment(O.r3(back(nq) - back(old))) };
    if (wasU) it.u = FV().increment(-1);
    tx.set(db.doc('cxDay/' + x.get('bd')), Object.assign({ it: { [fkey(l.c)]: it }, upd: Date.now() }, wasU ? { un: FV().increment(-1) } : {}), { merge: true });
    out = { ok: true, q: nq, delta: d, qs: l.qs };
  });
  return out;
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`caspit: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code, msg: String(e && e.message).slice(0, 200) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
// שלב B (רובוט כספית): כל פונקציה היא ליבה (w, input); הטלפון נכנס דרך mgrW (מנהל), הרובוט – caspit-bot.js עם זהות סינתטית.
// מנעול משותף (b/{bizId}/private/cxbot.lock, 30 דקות): אישור ויצוא מהטלפון לא רצים בזמן שהרובוט באמצע (ולהפך).
const LOCK_MS = 30 * 60e3;
const lockRef = (bizId) => require('firebase-admin/firestore').getFirestore().doc(`b/${bizId}/private/cxbot.lock`);
async function lockTake(bizId, owner) {
  const ref = lockRef(bizId);
  await ref.firestore.runTransaction(async (tx) => {
    const x = await tx.get(ref), now = Date.now();
    if (x.exists && x.get('o') !== owner && (x.get('exp') || 0) > now) throw pre('busy', String(x.get('o') || '').startsWith('bot:') ? 'הרובוט במחשב החנות מסנכרן עכשיו מול כספית. נסו שוב בעוד כמה דקות.' : 'מנהל אחר שומר עכשיו סנכרון כספית. נסו שוב בעוד כמה דקות.');
    tx.set(ref, { o: owner, exp: now + LOCK_MS, at: now });
  });
}
async function lockFree(bizId, owner) {
  const ref = lockRef(bizId);
  await ref.firestore.runTransaction(async (tx) => { const x = await tx.get(ref); if (x.exists && x.get('o') === owner) tx.delete(ref); });
}
const LOCKED = ['cxApply', 'cxExport'];
const SALES_FNS = ['cxSales', 'cxLines', 'cxFix'];
const FNS = { cxCfg, cxSetCfg, cxUpload, cxPreview, cxApply, cxExport, cxHist, cxDnOk, cxSales, cxLines, cxFix, cxSee };
const BIG = ['cxPreview', 'cxApply', 'cxExport']; // ~9,000 מוצרים
// 19.11.2026: מנהל מסמן עובדים שרואים את "מכירות כספית" (staff/{uid}.cxS = true). עובד כזה – צפייה בלבד: cxSales ו-cxLines.
// cxSee({ uid, on }) – מנהל בלבד, רק כשהתוספת cxSales מופעלת. לא נוגע ב-perms (שמנהל־על קובע).
const VIEW_FNS = ['cxSales', 'cxLines'];
async function cxSee(w, input) {
  onlyKeys(input, ['uid', 'on']);
  const uid = typeof input.uid === 'string' ? input.uid : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw bad('bad-uid', 'מזהה משתמש לא תקין');
  if (typeof input.on !== 'boolean') throw bad('bad-on', 'ערך לא תקין');
  const db = T.tdb();
  const sRef = db.doc('staff/' + uid), aRef = db.doc('admins/' + uid);
  await db.runTransaction(async (tx) => {
    const [s, a] = await Promise.all([tx.get(sRef), tx.get(aRef)]);
    if (!s.exists) throw new HttpsError('not-found', 'העובד לא נמצא בעסק', { reason: 'no-staff' });
    if (a.exists || s.get('role') === 'manager') throw pre('is-admin', 'מנהל רואה את המסך תמיד');
    tx.update(sRef, { cxS: input.on });
  });
  if (w.biz && w.biz.exists && w.bizId) await require('firebase-admin/firestore').getFirestore().collection(`b/${w.bizId}/audit`).add({ by: w.uid, t: Date.now(), act: 'cxSee', note: uid + '=' + input.on }).catch(() => {});
  return { ok: true, uid, on: input.on };
}
async function viewW(request) {
  const w = await O.who(request);
  if (w.role === 'manager') return w;
  if (w.staff && typeof w.staff.get === 'function' && w.staff.get('cxS') === true) return w;
  throw O.deny('no-perm', 'אין לך הרשאה למכירות כספית. פנה למנהל.');
}
async function phone(k, request) {
  const w = VIEW_FNS.includes(k) ? await viewW(request) : await mgrW(request);
  const input = k === 'cxCfg' ? {} : inputObject(request);
  if (k === 'cxSee') T.requireFeature(w.biz, 'cxSales');
  // דוח מכירות שהועלה לפני שהתוספת כובתה – לא מוצג ולא נשמר מהטלפון (הרובוט לא עובר כאן)
  if ((k === 'cxPreview' || k === 'cxApply') && typeof input.run === 'string' && RUN_RE.test(input.run) && !(w.biz && w.biz.features && w.biz.features.cxSales === true)) {
    const r = await T.tdb().doc('cxRun/' + input.run).get();
    if (r.exists && r.get('kind') === 'sales') T.requireFeature(w.biz, 'cxSales');
  }
  // 19.11.2026: "מכירות כספית" – תוספת נפרדת (cxSales), כבויה כברירת מחדל; רק מנהל־על מפעיל. הרובוט (caspit-bot.js) לא עובר כאן ולא מושפע.
  if (SALES_FNS.includes(k) || (k === 'cxUpload' && input.kind === 'sales')) T.requireFeature(w.biz, 'cxSales');
  if (!LOCKED.includes(k) || !w.bizId) return FNS[k](w, input);
  const me = 'u:' + w.uid;
  await lockTake(w.bizId, me);
  let r;
  try { r = await FNS[k](w, input); } catch (e) { await lockFree(w.bizId, me).catch(() => {}); throw e; }
  if (k === 'cxExport' || (r && r.done)) await lockFree(w.bizId, me);
  return r;
}
for (const k of Object.keys(FNS)) exports[k] = onCall(BIG.includes(k) ? { timeoutSeconds: 300, memory: '1GiB' } : {}, wrap(k, (request) => phone(k, request)));
Object.defineProperty(exports, '_core', { enumerable: false, value: { cleanIn, cleanLine, cleanTm, cxPartial, partDrop, loadState, applyPart, applySalesPart, PV_PART, SPV, FNS, cfgOf, mgrW, wrap, lockTake, lockFree, CFG, RUN_RE, DATE_RE } });
