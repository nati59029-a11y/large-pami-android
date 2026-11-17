'use strict';
// POS:M4 (ש4) – הגדרות הקופה לכל עסק, מנהל־על ודיווח בעיה (אפיון ה 0.3–0.7, 1.א–1.ג; אפיון סופי פרק 2).
// הסכמה: lib/pos-cfg-schema.js (זהה ל-www). תבניות: lib/pos-cfg-tpl.js (זהה ל-www). כל כתיבה ל-poscfg / poscfglog / postpl / posbug – רק מכאן.
//
// מאיזה עסק (אפיון ה 0.7 סעיף 2): bizId נגזר מ-users/{uid} של המשתמש המחובר (lib/tenant.js). הפרמטר bizId מתקבל רק ממנהל־על.
//   משתמש אחר ששולח bizId של עסק אחר ← permission-denied (foreign-biz), שום דבר לא נכתב, והניסיון נרשם ב-poslog של העסק שלו.
// תפקיד: 'sa' מנהל־על · 'own' מנהל עם admins/{uid}.own == true (בעל העסק) · 'mgr' מנהל · 'staff' עובד עם pos / posMgr.
// מתג 'pos' (FEATURES) כבוי ← הכול נדחה (feature-off), חוץ ממנהל־על שמכין את ההגדרות מראש.
//
//   posCfg({ br? })                                 → { role, ver, cfg, src, off, mods, on, st, type, sa? } – ההגדרות בפועל.
//                                                     sa (נעילות, "מי משנה", מגבלות) – רק למנהל / בעלים / מנהל־על.
//   posCfgSet({ scope?, br?, set?, unset?, appr?, apprPin? })
//                                                   → { ver, cfg, src, off, changes:[k] }. scope 'main' (ברירת מחדל) או 'br' (רק brOk).
//     מפתחות sa.* – מנהל־על בלבד; נכתבים ל-poscfg/sa ובאותה טרנזקציה ל-poscfg/saPub. כל שינוי: ver+1 ושורה ב-poscfglog לכל מפתח.
//     אישור שני (sens, לפי cfgApprove): מנהל – apprPin של בעל העסק (נבדק ב-lib/pos-pin.js של ש5; 5 טעויות = חסימה ל-15 דקות);
//     בעל העסק – appr:'self' (הקלדה חוזרת / טביעת אצבע במכשיר); מנהל־על – בלי.
//   posCfgUndo({ logId, appr?, apprPin? })          → { ver, k } – בעלים / מנהל־על. רק אם הערך הנוכחי עדיין "new" של השורה.
//   posSa({ op, ... })                              – מנהל־על בלבד:
//     op:'get'                                      → { sa, pub, tpls }
//     op:'open', type, maxDev?, maxBr?, force?       → פתיחת קופה לעסק: sa + saPub + ערכי התבנית ל-main, poscfglog src:'open'
//     op:'tplDiff'                                  → { type, diff:[{k,cur,tpl}], mods:[{m,cur,tpl}] } – מול התבנית של sa.type
//     op:'tplApply', keys:[k], mods:[m]             → מחיל רק את מה שסומן, poscfglog src:'tpl'
//     op:'tplSet', type, vals?, mods?               → עריכת postpl/{type} (גלובלי), ver+1
//     op:'bugs'                                     → { bugs } – 100 דיווחי הבעיה האחרונים מכל העסקים
//   posBug({ txt, dev?, ver? })                     → { id } – "דווח על בעיה" (כל מי שיש לו גישה לקופה בעסק). נשמר ב-posbug (גלובלי).
// שגיאות (details.reason): legacy, feature-off, foreign-biz, not-superadmin, not-manager, not-owner, not-pos, bad-input, bad-op, bad-br,
//   unknown-key, bad-value, not-allowed, mod-off, not-br, appr-needed, appr-bad, appr-locked, appr-unavailable, no-log, changed-since,
//   already-open, bad-type, bad-txt. ההודעה בעברית.

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const S = require('./lib/pos-cfg-schema');
const TP = require('./lib/pos-cfg-tpl');
// אימות קוד בעל העסק – של ש5 (FN/lib/pos-pin.js: verifyOwner(db, pin) → uid | null). עד שיגיע: מנהל לא משנה הגדרה רגישה.
let PIN = null;
try { PIN = require('./lib/pos-pin'); } catch (e) { PIN = null; }
const PIN_FAILS = 5, PIN_LOCK_MS = 15 * 60 * 1000;

const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const nf = (reason, msg) => new HttpsError('not-found', msg, { reason });
const BR_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const js = (v) => JSON.stringify(v === undefined ? null : v);
const schemaErr = (e) => {
  if (!e || !e.reason) return e;
  if (e.reason === 'not-allowed') return deny(e.reason, e.message);
  if (e.reason === 'mod-off' || e.reason === 'not-br') return pre(e.reason, e.message);
  return bad(e.reason, e.message);
};

// ניסיון לגשת לעסק אחר – נרשם ב-poslog של העסק של המשתמש (לא נכשל אם הרישום לא הצליח)
async function logForeign(m, uid, fn, tgt) {
  try {
    if (!m.bizId) return;
    const biz = await T.loadBiz(m.bizId);
    if (!biz) return;
    await getFirestore().collection(T.bizPrefix(biz) + 'poslog').add({ act: 'foreignBiz', fn, by: uid, tgt: String(tgt).slice(0, 60), at: Date.now() });
  } catch (e) { logger.warn('pos-cfg: foreign log failed', { msg: String(e && e.message || '').slice(0, 200) }); }
}

async function gate(request, fn, o) {
  const input = inputObject(request);
  const uid = request.auth && request.auth.uid;
  if (uid && has(input, 'bizId') && input.bizId != null && input.bizId !== '') {
    const m = await T.resolveMember(uid);
    if (!m.superadmin && input.bizId !== m.bizId) {
      await logForeign(m, uid, fn, input.bizId);
      throw deny('foreign-biz', 'אין לך הרשאה לעסק הזה');
    }
  }
  const who = await requireStaff(request); // מסיר את bizId מהקלט
  if (!who.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש');
  if (!who.superadmin) T.requireFeature(who.biz, 'pos');
  let role = 'staff';
  if (who.superadmin) role = 'sa';
  else if (who.role === 'manager') {
    const a = await getFirestore().doc(who.prefix + 'admins/' + who.uid).get();
    role = a.exists && a.get('own') === true ? 'own' : 'mgr';
  }
  if (o.sup && role !== 'sa') throw deny('not-superadmin', 'הפעולה זמינה למנהל־על בלבד');
  if (o.own && role !== 'sa' && role !== 'own') throw deny('not-owner', 'הפעולה זמינה לבעל העסק בלבד');
  if (o.mgr && role === 'staff') throw deny('not-manager', 'הפעולה זמינה למנהל בלבד');
  if (o.sell && role === 'staff' && !(hasPerm(who, 'pos') || hasPerm(who, 'posMgr'))) throw deny('not-pos', 'אין לך הרשאת קופה');
  return { who, role, input, db: T.tdb() };
}

const refs = (db, br) => ({ main: db.doc('poscfg/main'), sa: db.doc('poscfg/sa'), pub: db.doc('poscfg/saPub'), br: br ? db.doc('poscfg/br_' + br) : null });
async function readState(get, R) {
  const list = [R.main, R.sa].concat(R.br ? [R.br] : []);
  const snaps = await get(list);
  const d = (s) => (s && s.exists ? s.data() : null);
  return { main: d(snaps[0]), sa: d(snaps[1]), br: R.br ? d(snaps[2]) : null };
}
const verOf = (doc) => (doc && Number.isInteger(doc.ver) ? doc.ver : 0);
const view = (st) => S.eff({ sa: st.sa, main: st.main, br: st.br });

// האם השינוי דורש אישור שני (cfgApprove: none / sens / all)
function needAppr(changes, st) {
  if (!changes.length) return false;
  const mode = view(st).cfg.cfgApprove;
  if (mode === 'none') return false;
  if (mode === 'all') return true;
  return changes.some((c) => c.sens);
}
// אישור שני – לפני הטרנזקציה. → { appr } לשורת היומן
async function approve(db, role, input) {
  if (role === 'sa') return { appr: 'sa' };
  if (role === 'own') {
    if (input.appr !== 'self') throw pre('appr-needed', 'הגדרה רגישה – נדרש אישור נוסף (הקלדה חוזרת של הקוד או טביעת אצבע)');
    return { appr: 'self' };
  }
  const pin = input.apprPin;
  if (typeof pin !== 'string' || !/^[0-9]{4,8}$/.test(pin)) throw pre('appr-needed', 'הגדרה רגישה – נדרש קוד של בעל העסק');
  if (!PIN || typeof PIN.verifyOwner !== 'function') throw pre('appr-unavailable', 'אישור בקוד של בעל העסק עוד לא זמין. בעל העסק יכול לשנות את ההגדרה בעצמו');
  const lock = db.doc('poscfg/apprlock');
  const ls = await lock.get();
  const now = Date.now();
  if (ls.exists && ls.get('until') > now) throw pre('appr-locked', 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה');
  const ok = await PIN.verifyOwner(db, pin);
  if (!ok) {
    const n = (ls.exists && Number.isInteger(ls.get('n')) ? ls.get('n') : 0) + 1;
    await lock.set(n >= PIN_FAILS ? { n: 0, until: now + PIN_LOCK_MS } : { n, until: 0 });
    throw deny('appr-bad', 'הקוד של בעל העסק שגוי');
  }
  if (ls.exists) await lock.set({ n: 0, until: 0 });
  return { appr: String(ok).slice(0, 128) };
}

// כתיבת תוצאת patch בטרנזקציה: main / sa+saPub / br, ver+1, poscfglog לכל מפתח, poslog act:'cfg' לרגישות
function writeRes(tx, db, R, st, res, meta) {
  const now = Date.now();
  const ver = verOf(st.main) + 1;
  if (res.main) tx.set(R.main, Object.assign({}, res.main, { ver, upd: now, by: meta.uid }));
  else tx.set(R.main, { ver, upd: now, by: meta.uid }, { merge: true });
  if (res.sa) {
    const sv = verOf(st.sa) + 1;
    tx.set(R.sa, Object.assign({}, res.sa, { ver: sv, upd: now, by: meta.uid }));
    tx.set(R.pub, S.pubOf(res.sa, sv));
  }
  if (res.br) tx.set(R.br, Object.assign({}, res.br, { upd: now, by: meta.uid }));
  for (const c of res.changes) {
    const scope = S.isSa(c.k) ? 'sa' : meta.scope === 'br' ? 'br_' + meta.br : 'main';
    tx.set(db.collection('poscfglog').doc(), Object.assign({ key: c.k, old: c.old, new: c.new, had: c.old !== null, scope, by: meta.uid, role: meta.role, src: meta.src, at: now },
      meta.appr ? { appr: meta.appr } : {}, meta.undoOf ? { undoOf: meta.undoOf } : {}));
  }
  const sens = res.changes.filter((c) => c.sens).map((c) => c.k);
  if (sens.length) tx.set(db.collection('poslog').doc(), { act: 'cfg', keys: sens.slice(0, 50), by: meta.uid, role: meta.role, at: now });
  return ver;
}

// ---------- posCfg ----------
async function cfgGet(request) {
  const { role, input, db } = await gate(request, 'posCfg', { sell: true });
  const br = input.br == null || input.br === '' ? null : input.br;
  if (br !== null && (typeof br !== 'string' || !BR_RE.test(br))) throw bad('bad-br', 'סניף לא תקין');
  const R = refs(db, br);
  const st = await readState((l) => Promise.all(l.map((r) => r.get())), R);
  const e = view(st);
  const out = { ok: true, role, ver: verOf(st.main), cfg: e.cfg, src: e.src, off: e.off, mods: e.mods, on: e.on, st: e.st, type: e.type, upd: st.main && st.main.upd || null };
  if (role === 'staff') { // לעובד – בלי נעילות ומגבלות
    for (const k of Object.keys(out.cfg)) if (S.isSa(k) && !['sa.on', 'sa.st', 'sa.type', 'sa.mods'].includes(k)) { delete out.cfg[k]; delete out.src[k]; }
  } else out.sa = st.sa ? { lock: st.sa.lock || [], who: st.sa.who || {}, opened: !!st.sa.openedAt } : { lock: [], who: {}, opened: false };
  return out;
}

// ---------- posCfgSet ----------
async function cfgSet(request) {
  const { who, role, input, db } = await gate(request, 'posCfgSet', { mgr: true });
  for (const k of Object.keys(input)) if (!['scope', 'br', 'set', 'unset', 'appr', 'apprPin'].includes(k)) throw bad('bad-input', 'קלט לא תקין');
  const scope = input.scope == null ? 'main' : input.scope;
  if (scope !== 'main' && scope !== 'br') throw bad('bad-input', 'קלט לא תקין');
  const br = scope === 'br' ? input.br : null;
  if (scope === 'br' && (typeof br !== 'string' || !BR_RE.test(br))) throw bad('bad-br', 'סניף לא תקין');
  const p = { scope, set: input.set, unset: input.unset };
  const R = refs(db, br);
  // בדיקה מוקדמת (מחוץ לטרנזקציה) – כדי לדעת אם נדרש אישור שני לפני שנוגעים במסד
  const st0 = await readState((l) => Promise.all(l.map((r) => r.get())), R);
  let res0;
  try { res0 = S.patch(st0, p, role); } catch (e) { throw schemaErr(e); }
  const ap = needAppr(res0.changes, st0) ? await approve(db, role, input) : null;
  let ver, res;
  await db.runTransaction(async (tx) => {
    const st = await readState((l) => tx.getAll(...l), R);
    try { res = S.patch(st, p, role); } catch (e) { throw schemaErr(e); }
    if (!ap && needAppr(res.changes, st)) throw pre('appr-needed', 'הגדרה רגישה – נדרש אישור נוסף');
    if (!res.changes.length) { ver = verOf(st.main); return; }
    ver = writeRes(tx, db, R, st, res, { uid: who.uid, role, src: 'ui', scope, br, appr: ap && ap.appr });
  });
  const st = await readState((l) => Promise.all(l.map((r) => r.get())), R);
  const e = view(st);
  return { ok: true, ver, cfg: e.cfg, src: e.src, off: e.off, changes: res.changes.map((c) => c.k) };
}

// ---------- posCfgUndo ----------
async function cfgUndo(request) {
  const { who, role, input, db } = await gate(request, 'posCfgUndo', { own: true });
  if (typeof input.logId !== 'string' || !ID_RE.test(input.logId)) throw bad('bad-input', 'קלט לא תקין');
  const lref = db.doc('poscfglog/' + input.logId);
  const l0 = await lref.get();
  if (!l0.exists) throw nf('no-log', 'השינוי לא נמצא ביומן');
  const L = l0.data();
  if (!has(S.BY, L.key)) throw bad('unknown-key', 'הגדרה לא מוכרת');
  const brM = /^br_(.+)$/.exec(L.scope || '');
  const scope = brM ? 'br' : 'main', br = brM ? brM[1] : null;
  const R = refs(db, br);
  const build = (st) => {
    const docOf = L.scope === 'sa' ? st.sa : scope === 'br' ? st.br : st.main;
    if (js(S.pget(docOf || {}, L.key)) !== js(L.new)) throw pre('changed-since', 'ההגדרה השתנתה מאז – אי אפשר לבטל את השינוי הזה');
    const p = L.had === false || L.old === null && L.had !== true ? { scope, unset: [L.key] } : { scope, set: { [L.key]: L.old } };
    try { return S.patch(st, p, role); } catch (e) { throw schemaErr(e); }
  };
  const st0 = await readState((l) => Promise.all(l.map((r) => r.get())), R);
  const r0 = build(st0);
  const ap = needAppr(r0.changes, st0) ? await approve(db, role, input) : null;
  let ver;
  await db.runTransaction(async (tx) => {
    const st = await readState((l) => tx.getAll(...l), R);
    const res = build(st);
    if (!ap && needAppr(res.changes, st)) throw pre('appr-needed', 'הגדרה רגישה – נדרש אישור נוסף');
    ver = writeRes(tx, db, R, st, res, { uid: who.uid, role, src: 'undo', scope, br, appr: ap && ap.appr, undoOf: input.logId });
  });
  return { ok: true, ver, k: L.key };
}

// ---------- מנהל־על ----------
async function tplOf(type) {
  const code = TP.TPL[type];
  let d = null;
  try { const s = await getFirestore().doc('postpl/' + type).get(); d = s.exists ? s.data() : null; } catch (e) { d = null; }
  if (!code && !d) return null;
  const base = code || { name: type, ver: 0, mods: {}, vals: {} };
  const vals = Object.assign({}, base.vals, d && isObj(d.vals) ? d.vals : {});
  const mods = {};
  for (const m of S.MODS) mods[m] = d && isObj(d.mods) && typeof d.mods[m] === 'boolean' ? d.mods[m] : !!base.mods[m];
  return { type, name: d && d.name || base.name, ver: d && Number.isInteger(d.ver) ? d.ver : base.ver, vals, mods, edited: !!d };
}
const tplVals = (tpl) => Object.entries(tpl.vals).filter(([k]) => has(S.BY, k) && !S.isSa(k));

async function sa(request) {
  const { who, input, db } = await gate(request, 'posSa', { sup: true });
  const op = input.op;
  const R = refs(db, null);
  if (op === 'get') {
    const st = await readState((l) => Promise.all(l.map((r) => r.get())), R);
    const pub = await R.pub.get();
    const tpls = [];
    for (const t of S.TYPES) { const x = await tplOf(t); if (x) tpls.push(x); }
    return { ok: true, sa: st.sa, pub: pub.exists ? pub.data() : null, tpls };
  }
  if (op === 'bugs') {
    const q = await getFirestore().collection('posbug').orderBy('at', 'desc').limit(100).get();
    return { ok: true, bugs: q.docs.map((d) => Object.assign({ id: d.id }, d.data())) };
  }
  if (op === 'tplSet') {
    if (!S.TYPES.includes(input.type)) throw bad('bad-type', 'סוג עסק לא מוכר');
    const out = {};
    if (input.vals !== undefined) {
      if (!isObj(input.vals)) throw bad('bad-value', 'קלט לא תקין');
      out.vals = {};
      for (const [k, v] of Object.entries(input.vals)) {
        if (!has(S.BY, k) || S.isSa(k)) throw bad('unknown-key', 'הגדרה לא מוכרת: ' + String(k).slice(0, 40));
        try { out.vals[k] = S.check(S.BY[k], v, k); } catch (e) { throw schemaErr(e); }
      }
    }
    if (input.mods !== undefined) {
      if (!isObj(input.mods)) throw bad('bad-value', 'קלט לא תקין');
      out.mods = {};
      for (const [m, v] of Object.entries(input.mods)) { if (!S.MODS.includes(m) || typeof v !== 'boolean') throw bad('bad-value', 'מודול לא מוכר: ' + String(m).slice(0, 30)); out.mods[m] = v; }
    }
    const ref = getFirestore().doc('postpl/' + input.type);
    let ver;
    await getFirestore().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const cur = await tplOf(input.type);
      ver = (s.exists && Number.isInteger(s.get('ver')) ? s.get('ver') : cur.ver) + 1;
      tx.set(ref, { name: cur.name, ver, vals: out.vals || cur.vals, mods: out.mods || cur.mods, upd: Date.now(), by: who.uid });
    });
    return { ok: true, type: input.type, ver };
  }
  if (op === 'open') {
    if (!S.TYPES.includes(input.type)) throw bad('bad-type', 'סוג עסק לא מוכר');
    const tpl = await tplOf(input.type);
    const lim = {};
    for (const [f, k] of [['maxDev', 'sa.maxDev'], ['maxBr', 'sa.maxBr']]) {
      if (input[f] === undefined) continue;
      try { lim[f] = S.check(S.BY[k], input[f], k); } catch (e) { throw schemaErr(e); }
    }
    let ver;
    await db.runTransaction(async (tx) => {
      const st = await readState((l) => tx.getAll(...l), R);
      if (st.sa && st.sa.openedAt && input.force !== true) throw pre('already-open', 'הקופה כבר נפתחה לעסק הזה. לשינוי סוג – "החל תבנית מחדש"');
      const now = Date.now();
      const set = { 'sa.on': true, 'sa.st': 'trial', 'sa.type': input.type, 'sa.mods': tpl.mods };
      if (lim.maxDev !== undefined) set['sa.maxDev'] = lim.maxDev;
      if (lim.maxBr !== undefined) set['sa.maxBr'] = lim.maxBr;
      for (const [k, v] of tplVals(tpl)) set[k] = v;
      let res;
      try { res = S.patch(st, { set }, 'sa'); } catch (e) { throw schemaErr(e); }
      res.sa = Object.assign(res.sa || S.patch({}, { set: { 'sa.on': true } }, 'sa').sa, { tpl: input.type, tplVer: tpl.ver, openedAt: now, openedBy: who.uid });
      ver = writeRes(tx, db, R, st, res, { uid: who.uid, role: 'sa', src: 'open', scope: 'main' });
    });
    return { ok: true, ver, type: input.type };
  }
  if (op === 'tplDiff' || op === 'tplApply') {
    const st0 = await readState((l) => Promise.all(l.map((r) => r.get())), R);
    const e0 = view(st0);
    const tpl = await tplOf(e0.type);
    if (!tpl) throw bad('bad-type', 'סוג עסק לא מוכר');
    if (op === 'tplDiff') {
      const diff = tplVals(tpl).filter(([k, v]) => js(e0.cfg[k]) !== js(S.BY[k].t === 'obj' ? Object.assign({}, e0.cfg[k], v) : v)).map(([k, v]) => ({ k, he: S.BY[k].he, cur: e0.cfg[k], tpl: v }));
      const mods = S.MODS.filter((m) => e0.mods[m] !== tpl.mods[m]).map((m) => ({ m, he: S.MODS_HE[m], cur: e0.mods[m], tpl: tpl.mods[m] }));
      return { ok: true, type: e0.type, ver: tpl.ver, diff, mods };
    }
    const keys = Array.isArray(input.keys) ? input.keys : [];
    const mods = Array.isArray(input.mods) ? input.mods : [];
    if (keys.length + mods.length === 0 || keys.length > 400) throw bad('bad-input', 'לא סומן שום שינוי');
    const tv = Object.fromEntries(tplVals(tpl));
    const set = {};
    for (const k of keys) { if (typeof k !== 'string' || !has(tv, k)) throw bad('unknown-key', 'ההגדרה לא בתבנית: ' + String(k).slice(0, 40)); set[k] = tv[k]; }
    if (mods.length) {
      const mm = {};
      for (const m of mods) { if (!S.MODS.includes(m)) throw bad('bad-value', 'מודול לא מוכר'); mm[m] = tpl.mods[m]; }
      set['sa.mods'] = mm;
    }
    let ver, n = 0;
    await db.runTransaction(async (tx) => {
      const st = await readState((l) => tx.getAll(...l), R);
      let res;
      try { res = S.patch(st, { set }, 'sa'); } catch (e) { throw schemaErr(e); }
      n = res.changes.length;
      if (!n) { ver = verOf(st.main); return; }
      if (res.sa) res.sa.tplVer = tpl.ver;
      ver = writeRes(tx, db, R, st, res, { uid: who.uid, role: 'sa', src: 'tpl', scope: 'main' });
    });
    return { ok: true, ver, n };
  }
  throw bad('bad-op', 'פעולה לא מוכרת');
}

// ---------- posBug ----------
async function bug(request) {
  const { who, input } = await gate(request, 'posBug', { sell: true });
  const txt = typeof input.txt === 'string' ? input.txt.trim().slice(0, 2000) : '';
  if (!txt) throw bad('bad-txt', 'כתבו מה קרה');
  const d = { bizId: who.bizId, by: who.uid, txt, st: 'new', at: Date.now() };
  if (typeof input.dev === 'string' && /^K[1-9][0-9]{0,3}$/.test(input.dev)) d.dev = input.dev;
  if (input.ver != null) d.ver = String(input.ver).slice(0, 20);
  const r = await getFirestore().collection('posbug').add(d);
  return { ok: true, id: r.id };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`pos-cfg: ${name} failed`, { name: e && e.name, code: e && e.code, msg: String(e && e.message || '').slice(0, 300) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

// posCfg / posCfgSet מחליפים את השלד של שלב 0 (pos.js) – נטען אחריו ב-index.js (בלוק POS:M4)
exports.posCfg = onCall(wrap('posCfg', cfgGet));
exports.posCfgSet = onCall(wrap('posCfgSet', cfgSet));
exports.posCfgUndo = onCall(wrap('posCfgUndo', cfgUndo));
exports.posSa = onCall(wrap('posSa', sa));
exports.posBug = onCall(wrap('posBug', bug));
// לבדיקות בלבד (לא נספר כפונקציה: enumerable false, כמו pos.js)
Object.defineProperty(exports, '_core', { enumerable: false, value: {
  setPin: (p) => { PIN = p; },
  call: { posCfg: () => wrap('posCfg', cfgGet), posCfgSet: () => wrap('posCfgSet', cfgSet), posCfgUndo: () => wrap('posCfgUndo', cfgUndo), posSa: () => wrap('posSa', sa), posBug: () => wrap('posBug', bug) },
} });
