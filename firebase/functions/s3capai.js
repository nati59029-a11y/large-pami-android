'use strict';
// הקמת חנות – שלב 5 (17.11.2026, משימה 2026-11-17_תהליך-הקמת-חנות): "בדיקה חכמה" לפריט בתוכנית הצילום ו"המערכת מציעה".
// חוזה: תוצרים/0-חוזה-נתונים.md – 3.3 (cap, ph, ai, prods, diff), 3.5 (fx.st), 3.7 (s3use/s_{mapId}), 4. הלוגיקה הטהורה: lib/store3d-capai.js,
// ההנחיה והבדיקה הקפדנית של התשובה: lib/prompts-bayscan.js.
//   s3CapCheck { qid, mapId, key } – מנהל או s3m. התמונות נקראות מ-Storage לפי cap/{key}.ph (לא off), עד 13MB מלאות (השאר – מוקטנות).
//     מכסה: s3use/s_{mapId} – חד-פעמית למפה (2 × מקטעים + 50, גדלה לבד, לא יורדת; מנהל־על – s3SetupLim), + הבלם היומי לעובד (s3use/u_).
//     המכסה החודשית של הסניף (b_) לא נספרת. ההזמנה ו-s3qid – בטרנזקציה אחת לפני Gemini. Gemini ענה (גם תשובה שבורה) = נספר;
//     לא ענה (429, ניתוק, timeout) = מוחזר. qid חוזר אחרי הצלחה = אותה תשובה, בלי ספירה ובלי Gemini. 80% – push למנהלים פעם אחת למפה.
//     כותב cap/{key}.ai, ph[].quad/xr/yr/q (תמונה שנערכה ידנית – man: 1 – לא נדרסת), st (ok רק לפי הכללים ב-capSt), מונים ב-s3setup.
//     תמונה עם אדם – נמחקת מ-ph ומ-Storage (לא נשמרת, כמו בבדיקת מדף), ו-ai.retake מבקש לצלם שוב. מסמך cap עד 60,000 בתים (fitSize).
//     מחזיר { ok, mapId, key, st, cov, kind?, prods, rev, retake?, per, usage: { n, lim, w80 } }.
//   s3CapDec { qid, mapId, key, at, k: 'prod' | 'diff' | 'exp', i?, st?: 'ok' | 'no' } – החלטה במסך "המערכת מציעה". at = ai.at (נגד החלטה
//     על תוצאה ישנה). prod/diff – st של הפריט ברשימה. diff של סוג (kind) / קומות (lvl) שאושר – נשמר במפה דרך saveMap (גרסה קודמת נשמרת
//     ב-ver, הפיך); סוג מפורט ב-fx.st עם k בסיסי. מקטעים (bays) / רוחב (w) – אישור לידיעה בלבד, מתקנים בעורך. exp – "העתק לרשימה":
//     מוצרים שנכנסו (auto/ok) נוספים ל-bay.exp (רק הוספה, עד 60; מנהל בלבד, כמו כתיבת bay היום). מוצרים לא נכתבים ל-exp אוטומטית.
//   s3SetupLim { qid, mapId, lim } – מנהל־על בלבד. s3use/s_{mapId}.lim/limBy/limAt (n לא משתנה); רשומת audit כמו s3SetBranch.
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { defineSecret, defineString, defineInt } = require('firebase-functions/params');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const scan = require('./lib/scan');
const M = require('./lib/store3d-map');
const P = require('./lib/store3d-capplan');
const F = require('./lib/store3d-fix');
const CA = require('./lib/store3d-capai');
const PB = require('./lib/prompts-bayscan');

if (!getApps().length) initializeApp();

// אותם פרמטרים כמו ב-store3d-ai.js (אותו שם = פרמטר אחד)
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_API_BASE = defineString('GEMINI_API_BASE', { default: 'https://generativelanguage.googleapis.com', description: 'כתובת השירות של Gemini' });
const S3_USER_DAILY = defineInt('S3_USER_DAILY', { default: 400, description: 'סריקת חנות: מספר תמונות מרבי ביום לכל משתמש (בלם בטיחות)' });

const QID_DAYS = 30, D1 = 86400000, BUSY_MS = 5 * 60000, IMG_BUDGET = 13000000;
const TIMES = { timeoutMs: 120000, budgetMs: 200000 }, MAX_OUT = 32768;
const bad = (reason, msg, code, extra) => new HttpsError(code || 'invalid-argument', msg, Object.assign({ reason }, extra || {}));
const CODE = { 's3-setup-limit': 'resource-exhausted', 's3-user-day': 'resource-exhausted', 'too-big': 'failed-precondition', 'kind-sides': 'failed-precondition', 'bad-kind': 'invalid-argument', 'bad-answer': 'internal' };
const toHttps = (e) => (e instanceof HttpsError || !e || !CODE[e.code] ? e : bad(e.code, e.message, CODE[e.code], e.extra));
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const canDraw = (who) => who.role === 'manager' || hasPerm(who, 's3m');
const mapLib = () => require('./store3d-map')._map;
const capLib = () => require('./s3cap')._cap;
const notify = (...a) => require('./store3d')._core.notify(...a);
const answered = (e) => !!(e && e.details && e.details.reason === 'no-answer');
const LV_ORD = { t: 0, b: 1, a: 2 };

function brAllowed(who, br) {
  if (who.brs && !who.brs.includes(br)) throw bad('other-branch', 'הסניף הזה לא משויך אליך', 'permission-denied');
}
function base(input) {
  if (!isObj(input)) throw bad('bad-input', 'הבקשה לא תקינה');
  if (typeof input.qid !== 'string' || !M.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  if (typeof input.mapId !== 'string' || !M.RE.map.test(input.mapId)) throw bad('bad-map-id', 'מזהה המפה לא תקין');
  return { qid: input.qid, mapId: input.mapId, br: input.mapId.slice(2), kind: input.mapId.charAt(0) };
}
function keyOf(input) {
  if (typeof input.key !== 'string' || !P.KEY_RE.test(input.key)) throw bad('bad-key', 'הפריט לא תקין');
  return input.key;
}
// qid חוזר: אותה פעולה, אותו משתמש ואותו פריט – אותה תשובה; אחרת נדחה
const sameQ = (d, k, uid, mapId, key) => d.k === k && d.uid === uid && d.mapId === mapId && (d.key || '') === (key || '');
async function dupOf(db, qid, k, uid, mapId, key) {
  const q = await db.doc('s3qid/' + qid).get();
  if (!q.exists) return null;
  if (!sameQ(q.data(), k, uid, mapId, key)) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
  return q.get('res') ? Object.assign({}, q.get('res'), { dup: true }) : null;
}
const fxOfKey = (map, key) => (Array.isArray(map.fx) ? map.fx : []).find((f) => isObj(f) && f.del !== 1 && f.id === key.slice(2).split('-')[0]) || null;

// ---------------- s3CapCheck ----------------
async function ask(deps, prompt, b64s, deadline) {
  const body = {
    contents: [{ parts: [{ text: prompt }].concat(b64s.map((d) => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))) }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  };
  const r = await scan.callGemini(String(deps.base).replace(/\/+$/, ''), deps.key, body, TIMES.timeoutMs, false, { deadline, stats: { sent: 0 }, maxOut: MAX_OUT });
  return { obj: scan.parseLikeApp(r.text), finish: r.finish || '', len: String(r.text || '').length };
}
// התמונות שבשימוש (לא off), לפי הגובה (עליון, תחתון, רגיל) ואז לפי n. מלאות עד IMG_BUDGET, ואחר כך מוקטנות. קובץ חסר – מדלגים
async function readPhotos(bucket, ph) {
  const L = ph.filter((p) => isObj(p) && p.off !== true && Number.isInteger(p.n) && typeof p.p === 'string' && typeof p.th === 'string')
    .sort((a, b) => (LV_ORD[a.lv] || 0) - (LV_ORD[b.lv] || 0) || a.n - b.n);
  const out = [];
  let total = 0;
  for (const p of L) {
    let buf = null;
    for (const path of [p.p, p.th]) {
      try { const [b] = await bucket.file(path).download(); if (total + b.length <= IMG_BUDGET || path === p.th) { buf = b; break; } } catch (e) { logger.warn('s3CapCheck: photo read failed', { n: p.n, code: e && e.code }); }
    }
    if (!buf || total + buf.length > IMG_BUDGET) continue;
    total += buf.length;
    out.push({ n: p.n, lv: p.lv || 'a', i: out.length + 1, b64: buf.toString('base64') });
  }
  return out;
}
async function managers(db) { return (await db.collection('admins').get()).docs.map((d) => d.id).filter((u) => M.RE.uid.test(u)); }

// who = { uid, mgr, bizId, brs }; deps = { base, key, userMax, bucket?, send? }
async function checkCore(db, who, input, now, deps) {
  const b = base(input), key = keyOf(input), { qid, mapId, br } = b;
  brAllowed(who, br);
  const d0 = await dupOf(db, qid, 'capai', who.uid, mapId, key);
  if (d0) return d0;
  await mapLib().branchOk(db, who.bizId, br, b.kind);
  const C = capLib();
  const mref = db.doc('smap/' + mapId), cref = db.doc(`s3setup/${mapId}/cap/${key}`);
  const [ms, cs] = await Promise.all([mref.get(), cref.get()]);
  const { item, map } = C.planItem(ms, key);
  const cap = cs.exists ? cs.data() : null;
  if (cap && cap.st === 'skip') throw bad('skipped', 'הפריט מסומן כדילוג. בטלו את הדילוג כדי לבדוק אותו.', 'failed-precondition');
  const ph = cap && Array.isArray(cap.ph) ? cap.ph : [];
  if (!ph.some((p) => isObj(p) && p.off !== true)) throw bad('no-photos', 'אין עדיין תמונות לפריט הזה. צלמו קודם.', 'failed-precondition');
  if (!deps.key) throw bad('no-key', 'אין מפתח לזיהוי חכם בשרת', 'failed-precondition');
  // ---- הקשר (רק מהשרת) ----
  const fx = item.k === 'b' ? fxOfKey(map, key) : null, bayId = item.k === 'b' ? key.slice(2) : '';
  const [set, bayDoc, n1, n2] = await Promise.all([
    db.doc('s3set/' + br).get(),
    bayId ? db.doc(`smap/${mapId}/bay/${bayId}`).get() : null,
    bayId ? db.doc(`s3setup/${mapId}/n/${bayId}`).get() : null,
    fx ? db.doc(`s3setup/${mapId}/n/${fx.id}`).get() : null,
  ]);
  const B = bayDoc && bayDoc.exists ? bayDoc.data() : {};
  const bucket = deps.bucket || getStorage().bucket();
  const sent = await readPhotos(bucket, ph);
  if (!sent.length) throw bad('no-photos', 'לא הצלחנו לקרוא את התמונות של הפריט. צלמו שוב.', 'failed-precondition');
  const prompt = PB.buildBayPrompt({
    k: item.k, label: P.label(item, map), storeType: set.exists ? set.get('stype') : '', hi: item.lv.length > 1, photos: sent.map((s) => ({ i: s.i, lv: s.lv })),
    fx: fx ? { kind: CA.kindOf(fx), lvl: fx.lvl, w: Number.isInteger(fx.w) && fx.bays ? Math.round(fx.w / fx.bays) : null, bays: fx.bays, name: fx.name, glass: fx.glass === true } : null,
    cat: B.cat, exp: (Array.isArray(B.exp) ? B.exp : []).map((e) => e && e.n), notes: (Array.isArray(B.notes) ? B.notes : []).map((n) => n && n.t),
    setup: [n1, n2].filter((s) => s && s.exists && typeof s.get('t') === 'string').map((s) => s.get('t')),
  });
  // ---- מכסה + s3qid (טרנזקציה אחת, לפני Gemini) ----
  const qref = db.doc('s3qid/' + qid), sref = db.doc('s3use/s_' + mapId), uref = db.doc('s3use/u_' + who.uid);
  const bays = M.bayCount(map);
  const rv = await db.runTransaction(async (tx) => {
    const [q, s, u] = await Promise.all([tx.get(qref), tx.get(sref), tx.get(uref)]);
    if (q.exists) {
      const d = q.data();
      if (!sameQ(d, 'capai', who.uid, mapId, key)) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
      if (d.res) return { dup: d.res };
      if (Number.isInteger(d.at) && d.at > now - BUSY_MS) throw bad('busy', 'הפריט הזה עדיין בבדיקה. נסו שוב בעוד דקה.', 'aborted');
    }
    let qs, un;
    try {
      qs = CA.setupQuota(s.exists ? s.data() : null, { bays, k: 1, now });
      un = F.userDayStep(u.exists ? u.data() : null, scan.israelDay(new Date(now)), now, deps.userMax);
    } catch (e) { throw toHttps(e); }
    tx.set(sref, qs.doc, { merge: true });
    tx.set(uref, un);
    tx.set(qref, { k: 'capai', uid: who.uid, mapId, key, at: now, exp: now + QID_DAYS * D1 });
    return { qs };
  });
  if (rv.dup) return Object.assign({}, rv.dup, { dup: true });
  if (rv.qs.warn) { try { await notify({ db, send: deps.send }, `${mapId}_sw80`, 'sw80', await managers(db), now); } catch (e) { logger.warn('s3CapCheck: sw80 notify failed', { code: e && e.code }); } }
  let charged = false;
  const back = async (e) => {
    try {
      await db.runTransaction(async (tx) => {
        const [q, s] = await Promise.all([tx.get(qref), charged ? null : tx.get(sref)]);
        if (s) { const r = CA.setupRefund(s.exists ? s.data() : null, 1, Date.now()); if (r) tx.update(sref, r); }
        if (q.exists && !q.get('res') && q.get('uid') === who.uid) tx.delete(qref);
      });
    } catch (e2) { logger.error('s3CapCheck: release failed', { code: e2 && e2.code }); }
    throw e;
  };
  // ---- Gemini ----
  let resp;
  try { resp = await ask(deps, prompt, sent.map((s) => s.b64), Date.now() + TIMES.budgetMs); } catch (e) {
    if (answered(e)) charged = true;
    return back(e instanceof HttpsError ? e : bad('internal', 'שגיאה בבדיקה החכמה', 'internal'));
  }
  charged = true;
  let cl;
  try {
    if (resp.finish === 'MAX_TOKENS') { const e = new Error('cut'); e.code = 'bad-answer'; e.why = 'cut'; throw e; }
    cl = PB.cleanBayScan(resp.obj, { k: item.k, nPh: sent.length });
  } catch (e) {
    logger.warn('s3CapCheck: bad answer', { why: (e && e.why) || '', len: resp.len });
    return back(bad('bad-answer', 'התשובה מהבדיקה החכמה לא נקראה. נסו שוב.', 'internal', { why: (e && e.why) || '' }));
  }
  const ai = CA.buildAi(cl, { item, fx, now });
  // ---- כתיבה (טרנזקציה אחת) ----
  const setRef = db.doc('s3setup/' + mapId);
  let res, drop = [];
  try {
    res = await db.runTransaction(async (tx) => {
      const [q, ms2, cs2, ss] = await Promise.all([tx.get(qref), tx.get(mref), tx.get(cref), tx.get(setRef)]);
      if (q.exists && q.get('res')) return Object.assign({}, q.get('res'), { dup: true });
      const it = C.planItem(ms2, key).item;
      const old = cs2.exists ? cs2.data() : null;
      if (!old) throw bad('no-photos', 'אין עדיין תמונות לפריט הזה. צלמו קודם.', 'failed-precondition');
      const ap = CA.applyPhotos(old.ph, cl, sent);
      drop = ap.drop;
      const doc = Object.assign({}, old, { ph: ap.ph, ai, upd: now, by: who.uid });
      if (doc.st !== 'skip') CA.capSt(doc, P.geoMoved(old.geo, it.geo, it.k), who.uid, now);
      try { CA.fitSize(doc); } catch (e) { throw toHttps(e); }
      const setup = ss.exists ? ss.data() : null;
      const s0 = P.itemState(old.st === 'orph' ? null : old, it), s1 = P.itemState(doc, it);
      tx.set(cref, doc);
      tx.set(setRef, C.setupDoc(setup, C.counters(setup, s0, s1), who.uid, now), { merge: true });
      const out = { ok: true, mapId, key, st: s1, cov: ai.cov, prods: (ai.prods || []).length, rev: (ai.diff || []).filter((d) => d.st === 'rev').length + (ai.prods || []).filter((p) => p.st === 'rev').length, per: drop.length, usage: rv.qs.usage, at: now };
      if (ai.kind) out.kind = ai.kind;
      if (ai.retake) out.retake = ai.retake;
      tx.update(qref, { res: out });
      return out;
    });
  } catch (e) {
    drop = [];
    return back(e instanceof HttpsError ? e : (logger.error('s3CapCheck: write failed', { code: e && e.code }), bad('save-failed', 'שמירת התוצאה נכשלה. נסו שוב.', 'unavailable')));
  }
  // תמונה עם אדם – הקבצים נמחקים (כבר לא במסמך)
  for (const p of drop) for (const path of [p.p, p.th]) { if (typeof path === 'string') { try { await bucket.file(path).delete(); } catch (e) { /* יתום – לא מזיק */ } } }
  return res;
}

// ---------------- s3CapDec ----------------
const DEC_K = ['prod', 'diff', 'exp'];
async function decCore(db, who, input, now) {
  const b = base(input), key = keyOf(input), { qid, mapId, br } = b;
  if (!DEC_K.includes(input.k)) throw bad('bad-input', 'סוג ההחלטה לא תקין');
  if (!Number.isInteger(input.at) || input.at < 1) throw bad('bad-input', 'חסר זמן הבדיקה');
  const k = input.k;
  if (k !== 'exp') {
    if (!Number.isInteger(input.i) || input.i < 0 || input.i > 79) throw bad('bad-input', 'הפריט ברשימה לא תקין');
    if (input.st !== 'ok' && input.st !== 'no') throw bad('bad-input', 'ההחלטה לא תקינה');
  } else if (!who.mgr) throw bad('not-mgr', 'העתקה לרשימת "מה אמור להיות" מותרת למנהל', 'permission-denied');
  brAllowed(who, br);
  const d0 = await dupOf(db, qid, 'capdec', who.uid, mapId, key);
  if (d0) return d0;
  await mapLib().branchOk(db, who.bizId, br, b.kind);
  const C = capLib();
  const mref = db.doc('smap/' + mapId), cref = db.doc(`s3setup/${mapId}/cap/${key}`), qref = db.doc('s3qid/' + qid), setRef = db.doc('s3setup/' + mapId);
  const [ms, cs] = await Promise.all([mref.get(), cref.get()]);
  const { item, map } = C.planItem(ms, key);
  const ai0 = cs.exists && isObj(cs.get('ai')) ? cs.get('ai') : null;
  if (!ai0 || ai0.at !== input.at) throw bad('stale-ai', 'תוצאת הבדיקה התחלפה. טענו מחדש.', 'failed-precondition');
  const L0 = k === 'prod' ? ai0.prods : ai0.diff;
  if (k !== 'exp' && (!Array.isArray(L0) || !isObj(L0[input.i]))) throw bad('bad-input', 'הפריט ברשימה לא נמצא');
  const dd = k === 'diff' ? L0[input.i] : null;
  if (k === 'exp' && item.k !== 'b') throw bad('bad-input', 'אפשר להעתיק מוצרים רק במקטע מדף');
  // סוג / קומות שאושרו – למפה (saveMap: גרסה קודמת נשמרת ב-ver). כבר במפה – לא שומרים שוב (qid חוזר אחרי כשל בהמשך)
  let mapV = null;
  if (dd && input.st === 'ok' && (dd.k === 'kind' || dd.k === 'lvl') && item.k === 'b') {
    const fx = fxOfKey(map, key);
    if (!fx) throw bad('not-in-plan', 'הגוף כבר לא נמצא במפה. טענו מחדש.', 'failed-precondition');
    let nf;
    try {
      if (dd.k === 'kind') nf = typeof ai0.kind === 'string' ? CA.kindFx(fx, ai0.kind) : null;
      else nf = Number.isInteger(ai0.lvl) ? Object.assign({}, fx, { lvl: ai0.lvl }) : null;
    } catch (e) { throw toHttps(e); }
    if (!nf) throw bad('bad-input', 'אין ערך חדש להחיל', 'failed-precondition');
    if (CA.kindOf(nf) !== CA.kindOf(fx) || nf.lvl !== fx.lvl || nf.glass !== fx.glass) {
      const nm = Object.assign({}, map, { fx: map.fx.map((f) => (isObj(f) && f.id === fx.id ? nf : f)) });
      const why = dd.k === 'kind' ? `הקמה: סוג המידוף לפי הצילום (${dd.was} ← ${dd.got})` : `הקמה: מספר הקומות לפי הצילום (${dd.was} ← ${dd.got})`;
      const r = await mapLib().saveMap(db, { uid: who.uid, mgr: who.mgr, bizId: who.bizId, brs: who.brs }, { mapId, baseV: Number.isInteger(map.v) ? map.v : 0, map: nm, why: why.slice(0, 120) }, now);
      mapV = r.v;
    }
  }
  return db.runTransaction(async (tx) => {
    const reads = [tx.get(qref), tx.get(mref), tx.get(cref), tx.get(setRef)];
    const bref = k === 'exp' ? db.doc(`smap/${mapId}/bay/${key.slice(2)}`) : null;
    if (bref) reads.push(tx.get(bref));
    const [q, ms2, cs2, ss, bs] = await Promise.all(reads);
    if (q.exists) {
      if (!sameQ(q.data(), 'capdec', who.uid, mapId, key)) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת');
      return Object.assign({}, q.get('res') || {}, { dup: true });
    }
    const old = cs2.exists ? cs2.data() : null;
    if (!old || !isObj(old.ai) || old.ai.at !== input.at) throw bad('stale-ai', 'תוצאת הבדיקה התחלפה. טענו מחדש.', 'failed-precondition');
    const it = C.planItem(ms2, key).item;
    const res = { ok: true, mapId, key, k };
    if (k === 'exp') {
      const B = bs && bs.exists ? bs.data() : {};
      const r = CA.expAdd(B.exp, old.ai.prods);
      if (r.added) tx.set(bref, { exp: r.exp, upd: now, by: who.uid }, { merge: true });
      Object.assign(res, { added: r.added, n: r.exp.length });
    } else {
      const ai = Object.assign({}, old.ai), f = k === 'prod' ? 'prods' : 'diff';
      ai[f] = ai[f].map((x, j) => (j === input.i ? Object.assign({}, x, { st: input.st }, k === 'diff' ? { at: now, by: who.uid } : {}) : x));
      const doc = Object.assign({}, old, { ai, upd: now, by: who.uid });
      if (doc.st !== 'skip' && doc.st !== 'orph') CA.capSt(doc, P.geoMoved(old.geo, it.geo, it.k), who.uid, now);
      const setup = ss.exists ? ss.data() : null;
      const s0 = P.itemState(old.st === 'orph' ? null : old, it), s1 = P.itemState(doc, it);
      tx.set(cref, doc);
      if (s0 !== s1) tx.set(setRef, C.setupDoc(setup, C.counters(setup, s0, s1), who.uid, now), { merge: true });
      Object.assign(res, { i: input.i, st: input.st, item: s1 });
      if (mapV) res.mapV = mapV;
    }
    tx.set(qref, { k: 'capdec', uid: who.uid, mapId, key, res, at: now, exp: now + QID_DAYS * D1 });
    return res;
  });
}

// ---------------- s3SetupLim (מנהל־על) ----------------
async function limCore(db, who, input, now) {
  const b = base(input), { qid, mapId } = b;
  if (!Number.isInteger(input.lim) || input.lim < 0 || input.lim > 100000) throw bad('bad-lim', 'התקרה צריכה להיות מספר שלם בין 0 ל-100,000');
  const d0 = await dupOf(db, qid, 'slim', who.uid, mapId, '');
  if (d0) return d0;
  const ms = await db.doc('smap/' + mapId).get();
  if (!ms.exists || ms.get('del') === 1) throw bad('no-map', 'המפה לא קיימת', 'failed-precondition');
  const sref = db.doc('s3use/s_' + mapId), qref = db.doc('s3qid/' + qid);
  const res = await db.runTransaction(async (tx) => {
    const [q, s] = await Promise.all([tx.get(qref), tx.get(sref)]);
    if (q.exists) return Object.assign({}, q.get('res') || {}, { dup: true });
    const d = CA.setupLim(s.exists ? s.data() : null, input.lim, who.uid, now);
    tx.set(sref, d, { merge: true });
    const out = { ok: true, mapId, n: d.n, lim: d.lim, was: s.exists && Number.isInteger(s.get('lim')) ? s.get('lim') : null };
    tx.set(qref, { k: 'slim', uid: who.uid, mapId, res: out, at: now, exp: now + QID_DAYS * D1 });
    return out;
  });
  if (!res.dup) {
    try { await getFirestore().collection(`b/${who.bizId}/audit`).add({ by: who.uid, t: now, act: 's3SetupLim', note: `${mapId}: lim=${res.lim} (היה ${res.was === null ? 'אוטומטי' : res.was})` }); } catch (e) { logger.warn('s3SetupLim: audit failed', { code: e && e.code }); }
  }
  return res;
}

// ---------------- הפונקציות ----------------
const depsOf = () => ({ base: GEMINI_API_BASE.value(), key: GEMINI_API_KEY.value(), userMax: S3_USER_DAILY.value() });
async function staffDraw(request) {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!canDraw(who)) throw bad('not-s3m', 'הבדיקה החכמה של ההקמה מותרת למנהל או לעובד עם הרשאת "שרטוט מפה"', 'permission-denied');
  return { uid: who.uid, mgr: who.role === 'manager', bizId: who.bizId, brs: mapLib().myBranches(who) };
}
exports.s3CapCheck = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '1GiB' }, T.scoped(async (request) => {
  const who = await staffDraw(request);
  return checkCore(T.tdb(), who, inputObject(request), Date.now(), depsOf());
}));
exports.s3CapDec = onCall(T.scoped(async (request) => {
  const who = await staffDraw(request);
  return decCore(T.tdb(), who, inputObject(request), Date.now());
}));
exports.s3SetupLim = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!who.superadmin) throw bad('not-superadmin', 'הפעולה מותרת למנהל המערכת בלבד', 'permission-denied');
  return limCore(T.tdb(), { uid: who.uid, bizId: who.bizId }, inputObject(request), Date.now());
}));

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_capai', { enumerable: false, value: { checkCore, decCore, limCore, readPhotos } });
