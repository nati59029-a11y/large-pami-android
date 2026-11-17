'use strict';
// הקמת חנות – שלב 3 (17.11.2026, משימה 2026-11-17_תהליך-הקמת-חנות): צילום החנות לפי תוכנית הצילום. חוזה: תוצרים/0-חוזה-נתונים.md, סעיפים 3.1, 3.3, 3.4, 3.6, 4, 5.
// התוכנית עצמה (capPlan) – lib/store3d-capplan.js, אותו קובץ בדיוק כמו באפליקציה (www/store3d-capplan.js), כך שהטלפון והשרת מחשבים אותה תוכנית.
//   s3CapPut { qid, mapId, key, op, lv?, img?, th?, why?, man?, n? } – מנהל או עובד עם "שרטוט מפה" (s3m). בלי AI ובלי מכסה.
//     op 'ph'     – תמונה לפריט: img (JPEG, צלע ארוכה עד 1600, עד 1.5MB) + th (JPEG, עד 512, עד 150KB). lv: מדף גבוה – 't'/'b', אחר – 'a'.
//                   נשמר ב-Storage: b/{biz}/store3d/{br}/cap/{mapId}/{key}_{n}.jpg (+ _t). עד 6 תמונות לכל גובה ועד 12 לפריט, n = 1..99.
//     op 'front'  – חזית מחוברת (שלב 4) או ידנית: img עד 2048, th עד 512. front/{mapId}/{key}_{v}.jpg (+ _t), v = 1..999, 5 קודמות ב-frH.
//                   man: true = חזית שאדם בחר/חתך ואישר ← הפריט 'ok' (okBy). בלי man – 'part' עד בדיקת ה-AI (שלב 5).
//                   מקטע ← s3sum.b[bay].fr/frT (מיזוג, בלי לגעת ב-th/s של הסבבים); שאר הפריטים ← s3look.it[key].
//     op 'skip'   – דילוג עם סיבה (why, 1–120 תווים). op 'unskip' – ביטול הדילוג. op 'off' – n: תמונה שלא בשימוש (הפוך), לא נמחקת.
//     op 'geo'    – (שלב 4ב) תיקון ידני מהעורך "חיבור וחיתוך" לתמונה n: quad? (8 מספרים שלמים 0–1000), xr?/yr? ({a,b} שלמים 0–1000, a<b).
//                   לפחות אחד מהשלושה. נכתב ל-ph[n] בלבד (שדה שלא נשלח – לא משתנה). בלי תמונה; st לא משתנה מהפעולה עצמה.
//     תמיד: הפריט חייב להיות בתוכנית של המפה השמורה; geo/geoV מהמפה הנוכחית; פריט ok שהמקום שלו זז ← 'part' (חוזה 3.3).
//     qid חוזר = אותה תשובה (dup: true), בלי קבצים ובלי כתיבה נוספת. מונים ב-s3setup (capOk/capPart/capSkip) באותה טרנזקציה.
//     כשגרסת המפה השתנתה מאז הכתיבה הקודמת (s3setup.mapV) – פריטים שכבר לא בתוכנית מסומנים 'orph' (לא נמחקים) והמונים מחושבים מחדש.
//   s3SetupDone { qid, mapId } – מנהל או s3m. מחשב מחדש את התוכנית מהמפה השמורה ובודק שכל פריט ok (במקום הנוכחי) או דולג עם סיבה.
//     לא – 'not-done' עם עד 20 מפתחות חסרים. כן – הערות המקטעים (s3setup/{mapId}/n/{bayId}) נוספות ל-bay.notes (src:'setup', עד 20 ברשימה),
//     ו-s3setup.st = 'done', doneAt, doneBy.
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const M = require('./lib/store3d-map');
const A = require('./lib/store3d-ai');
const P = require('./lib/store3d-capplan');
const NK = require('./lib/store3d-notekey');

if (!getApps().length) initializeApp();

const QID_DAYS = 30, D1 = 86400000;
const PH_LV = 6, PH_MAX = 12, N_MAX = 99, V_MAX = 999, FR_HIST = 5, LOOK_MAX = 1500, NOTES_MAX = 20;
const LIM = {
  ph: { min: 1000, max: 1500000, longMin: 200, longMax: 1600, shortMin: 100, shortMax: 1600 },
  fr: { min: 1000, max: 1500000, longMin: 200, longMax: 2048, shortMin: 50, shortMax: 2048 },
  th: { min: 100, max: 150000, longMin: 32, longMax: 512, shortMin: 16, shortMax: 512 },
};
const OPS = ['ph', 'front', 'skip', 'unskip', 'off', 'geo'];
const bad = (reason, msg, code, extra) => new HttpsError(code || 'invalid-argument', msg, Object.assign({ reason }, extra || {}));
const isExists = (e) => e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)));
const is412 = (e) => e && (e.code === 412 || e.code === '412');
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const canDraw = (who) => who.role === 'manager' || hasPerm(who, 's3m');
const mapLib = () => require('./store3d-map')._map;   // branchOk, myBranches – משותף
const capDir = (biz, br, mapId) => `b/${biz}/store3d/${br}/cap/${mapId}/`;
const frDir = (biz, br, mapId) => `b/${biz}/store3d/${br}/front/${mapId}/`;
const fileOf = (dir, key, n, t) => dir + key + '_' + n + (t ? '_t' : '') + '.jpg';
const cleanWhy = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '');

// תיקון ידני (op 'geo'): quad – בדיוק 8 מספרים שלמים 0–1000; xr/yr – { a, b } שלמים 0–1000, a < b (חוזה 3.3א + תוספת 17.11)
const YR_MIN = 50;
const int1k = (v) => Number.isInteger(v) && v >= 0 && v <= 1000;
function cleanGeo(input) {
  const o = {};
  if (input.quad !== undefined) {
    if (!Array.isArray(input.quad) || input.quad.length !== 8 || !input.quad.every(int1k)) throw bad('bad-quad', 'הפינות לא תקינות');
    o.quad = input.quad.slice();
  }
  for (const f of ['xr', 'yr']) {
    if (input[f] === undefined) continue;
    const r = input[f];
    if (!isObj(r) || Object.keys(r).some((k) => k !== 'a' && k !== 'b') || !int1k(r.a) || !int1k(r.b) || r.a >= r.b) throw bad('bad-' + f, 'הטווח לא תקין');
    // החלטת המתאם (17.11): טווח הגובה לפחות 50 (5% מהתמונה), כמו בטלפון
    if (f === 'yr' && r.b - r.a < YR_MIN) throw bad('bad-yr', 'טווח הגובה קטן מדי');
    o[f] = { a: r.a, b: r.b };
  }
  if (!Object.keys(o).length) throw bad('bad-input', 'אין מה לשמור');
  return o;
}
function dec(b64, lim, label) {
  try { return A.decodeJpeg(b64, lim, label); } catch (e) {
    const code = e && e.code === 'too-big' ? 'too-big' : e && e.code === 'bad-type' ? 'bad-type' : e && e.code === 'bad-size' ? 'bad-size' : 'bad-img';
    throw bad(code, (e && e.message) || 'התמונה לא תקינה');
  }
}
function mapIdOf(input) {
  if (typeof input.mapId !== 'string' || !M.RE.map.test(input.mapId)) throw bad('bad-map-id', 'מזהה המפה לא תקין');
  return input.mapId;
}
function qidOf(input) {
  if (typeof input.qid !== 'string' || !M.RE.qid.test(input.qid)) throw bad('bad-qid', 'מזהה השליחה לא תקין');
  return input.qid;
}
function brAllowed(who, br) {
  if (who.brs && !who.brs.includes(br)) throw bad('other-branch', 'הסניף הזה לא משויך אליך', 'permission-denied');
}
// הקלט של s3CapPut אחרי בדיקה (לפני כל קריאה למסד): { op, key, lv, img, th, why, man, n }
function cleanPut(input) {
  const op = input.op, key = input.key;
  if (!OPS.includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  if (typeof key !== 'string' || !P.KEY_RE.test(key)) throw bad('bad-key', 'הפריט לא תקין');
  const o = { op, key };
  if (op === 'ph') {
    o.lv = input.lv === undefined || input.lv === null ? 'a' : input.lv;
    if (!['a', 't', 'b'].includes(o.lv)) throw bad('bad-lv', 'הגובה לא תקין');
    o.img = dec(input.img, LIM.ph, 'התמונה');
    o.th = dec(input.th, LIM.th, 'התמונה המוקטנת');
  } else if (op === 'front') {
    o.img = dec(input.img, LIM.fr, 'החזית');
    o.th = dec(input.th, LIM.th, 'החזית המוקטנת');
    if (input.man !== undefined && typeof input.man !== 'boolean') throw bad('bad-input', 'man לא תקין');
    o.man = input.man === true;
  } else if (op === 'skip') {
    o.why = cleanWhy(input.why);
    if (o.why.length < 1 || o.why.length > 120) throw bad('bad-why', 'כתבו למה מדלגים (עד 120 תווים)');
  } else if (op === 'off' || op === 'geo') {
    if (!Number.isInteger(input.n) || input.n < 1 || input.n > N_MAX) throw bad('bad-n', 'התמונה לא תקינה');
    o.n = input.n;
    if (op === 'geo') o.g = cleanGeo(input);
  }
  return o;
}
// המפה השמורה והתוכנית שלה. item – הפריט (או זורק). מחזיר { map, plan, item }
function planItem(ms, key) {
  if (!ms.exists || ms.get('del') === 1) throw bad('no-map', 'המפה לא קיימת. שמרו את המפה לפני הצילום.', 'failed-precondition');
  const map = ms.data(), plan = P.capPlan(map), item = plan.items.find((i) => i.key === key);
  if (key && !item) throw bad('not-in-plan', 'הפריט הזה כבר לא נמצא במפה. טענו מחדש את תוכנית הצילום.', 'failed-precondition');
  if (item && item.ord > P.PLAN_MAX) throw bad('plan-too-big', 'התוכנית גדולה מדי – פצלו את המפה או הגדילו את אריחי הרצפה', 'failed-precondition');
  return { map, plan, item };
}
const phOf = (d) => (isObj(d) && Array.isArray(d.ph) ? d.ph.filter(isObj) : []);
// בדיקת מקום לתמונה חדשה (ph) לפי המסמך הנוכחי. זורק ph-full
function phRoom(d, lv) {
  const L = phOf(d);
  if (L.length >= PH_MAX || L.filter((p) => p.lv === lv).length >= PH_LV) throw bad('ph-full', `יש כבר ${PH_LV} תמונות לחלק הזה. אשרו חזית, או דלגו עם סיבה.`, 'resource-exhausted');
  const n = L.reduce((m, p) => (Number.isInteger(p.n) && p.n > m ? p.n : m), 0) + 1;
  if (n > N_MAX) throw bad('ph-full', 'הגעתם למספר המרבי של צילומים לפריט הזה', 'resource-exhausted');
  return n;
}
// המסמך החדש של cap/{key} אחרי הפעולה (טהור; לבדיקות יחידה). old – המסמך הקיים או null. x = { op, lv, n, v, ... }; f = נתיבי הקבצים
function nextDoc(old, item, mapV, x, f, uid, now) {
  const d = Object.assign({}, isObj(old) ? old : {});
  const moved = isObj(old) && old.st === 'ok' && P.geoMoved(old.geo, item.geo, item.k);
  Object.assign(d, { k: item.k, ord: item.ord, geo: item.geo.slice(), geoV: mapV, upd: now, by: uid });
  if (item.room) d.room = item.room;
  if (!d.st || d.st === 'orph') d.st = phOf(d).length || d.fr ? 'part' : 'todo';
  if (moved) { d.st = 'part'; delete d.okBy; delete d.okAt; }
  if (x.op === 'ph') {
    d.ph = phOf(d).concat([{ p: f.p, th: f.t, n: x.n, lv: x.lv, w: x.img.w, h: x.img.h, at: now, by: uid }]);
    if (d.st !== 'ok') d.st = 'part';
    if (d.st === 'part') delete d.why;
  } else if (x.op === 'front') {
    if (d.fr) d.frH = [{ th: d.frTh || d.fr, t: Number.isInteger(d.frT) ? d.frT : now, v: Number.isInteger(d.frV) ? d.frV : 1 }].concat(Array.isArray(d.frH) ? d.frH : []).slice(0, FR_HIST);
    Object.assign(d, { fr: f.p, frTh: f.t, frV: x.v, frT: now, man: x.man });
    if (x.man) Object.assign(d, { st: 'ok', okBy: uid, okAt: now });
    else { d.st = 'part'; delete d.okBy; delete d.okAt; }
    delete d.why;
  } else if (x.op === 'skip') {
    d.st = 'skip'; d.why = x.why;
  } else if (x.op === 'unskip') {
    delete d.why;
    d.st = d.okBy && d.fr && !P.geoMoved(old && old.geo, item.geo, item.k) ? 'ok' : phOf(d).length || d.fr ? 'part' : 'todo';
  } else if (x.op === 'off') {
    const i = phOf(d).findIndex((p) => p.n === x.n);
    if (i < 0) throw bad('no-photo', 'התמונה לא נמצאה', 'not-found');
    d.ph = phOf(d).map((p, j) => (j === i ? Object.assign({}, p, { off: p.off !== true }) : p));
    if (!d.ph[i].off) delete d.ph[i].off;
  } else if (x.op === 'geo') {
    const i = phOf(d).findIndex((p) => p.n === x.n);
    if (i < 0) throw bad('no-photo', 'התמונה לא נמצאה', 'not-found');
    d.ph = phOf(d).map((p, j) => (j === i ? Object.assign({}, p, x.g) : p));
  }
  return d;
}
const CNT = { ok: 'capOk', part: 'capPart', skip: 'capSkip' };
function counters(setup, before, after) {
  const c = { capOk: 0, capPart: 0, capSkip: 0 };
  for (const k of Object.keys(c)) c[k] = isObj(setup) && Number.isInteger(setup[k]) ? setup[k] : 0;
  if (CNT[before]) c[CNT[before]] = Math.max(0, c[CNT[before]] - 1);
  if (CNT[after]) c[CNT[after]] = Math.min(5000, c[CNT[after]] + 1);
  return c;
}
const PRE = ['sketch', 'draft', 'notes', 'qs'];
function setupDoc(old, cnt, uid, now) {
  const st = isObj(old) && typeof old.st === 'string' && !PRE.includes(old.st) ? old.st : 'cap';
  return Object.assign(isObj(old) ? {} : { v: 1 }, { st, upd: now, by: uid }, cnt);
}

// ניקוי קבצים שהבקשה הזו כתבה ולא נכנסו למסמך (רק עם ה-generation שלהם)
async function dropOwn(bk, items) {
  for (const it of items) { if (!it || !it.path || !it.gen) continue; try { await bk.file(it.path).delete({ ifGenerationMatch: it.gen }); } catch (e) { /* יתום – לא מזיק */ } }
}
async function claim(db, id, uid, now) {
  try { await db.doc('s3qid/' + id).create({ k: 'cap-lock', uid, at: now, exp: now + QID_DAYS * D1 }); return true; } catch (e) { if (isExists(e)) return false; throw e; }
}
// מסמני orph ומונים מחדש – כשגרסת המפה השתנתה מאז הכתיבה הקודמת. לא חוסם: כשל כאן נרשם בלוג, ויתוקן בכתיבה הבאה.
async function syncPlan(db, mapId, plan, mapV, now) {
  const keys = new Map(plan.items.map((i) => [i.key, i]));
  const cs = await db.collection(`s3setup/${mapId}/cap`).get();
  const c = { capOk: 0, capPart: 0, capSkip: 0 };
  let b = db.batch(), nb = 0;
  for (const d of cs.docs) {
    const x = d.data(), it = keys.get(d.id);
    if (!it) { if (x.st !== 'orph') { b.update(d.ref, { st: 'orph', upd: now }); nb++; } } else {
      if (x.st === 'orph') { b.update(d.ref, { st: phOf(x).length || x.fr ? 'part' : 'todo', upd: now }); nb++; }
      const s = P.itemState(x.st === 'orph' ? Object.assign({}, x, { st: 'part' }) : x, it);
      if (CNT[s]) c[CNT[s]]++;
    }
    if (nb >= 400) { await b.commit(); b = db.batch(); nb = 0; }
  }
  b.set(db.doc('s3setup/' + mapId), Object.assign({ mapV, upd: now }, c), { merge: true });
  await b.commit();
}

// ---------------- s3CapPut ----------------
// הליבה (לבדיקות מול אמולטור). who = { uid, bizId, brs }; db = T.tdb() של העסק.
async function capPut(db, who, input, now, bucket) {
  const qid = qidOf(input), mapId = mapIdOf(input), br = mapId.slice(2);
  brAllowed(who, br);
  const x = cleanPut(input), key = x.key;
  const qref = db.doc('s3qid/' + qid);
  const same = (q) => q.get('k') === 'cap' && q.get('uid') === who.uid && isObj(q.get('res')) && q.get('res').mapId === mapId && q.get('res').key === key;
  const dupOf = (q) => { if (!same(q)) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת'); return Object.assign({}, q.get('res'), { dup: true }); };
  const q0 = await qref.get();
  if (q0.exists) return dupOf(q0);
  await mapLib().branchOk(db, who.bizId, br, mapId.charAt(0));
  const mref = db.doc('smap/' + mapId), cref = db.doc(`s3setup/${mapId}/cap/${key}`), sref = db.doc('s3setup/' + mapId);
  const [ms0, c0] = await Promise.all([mref.get(), cref.get()]);
  const { item: item0 } = planItem(ms0, key);
  if (x.op === 'ph' && !item0.lv.includes(x.lv)) throw bad('bad-lv', item0.lv.length > 1 ? 'במדף גבוה בחרו תמונה עליונה או תחתונה' : 'לפריט הזה יש תמונה אחת לכל גובה', 'invalid-argument');
  const old0 = c0.exists ? c0.data() : null;
  // העלאה (לפני הטרנזקציה): נעילה על הנתיב, ואז שמירה עם ifGenerationMatch: 0. נתיב תפוס ← המספר הבא
  const bk = bucket || getStorage().bucket();
  let f = null, mine = [];
  if (x.op === 'ph' || x.op === 'front') {
    let n = x.op === 'ph' ? phRoom(old0, x.lv) - 1 : (old0 && Number.isInteger(old0.frV) ? old0.frV : 0);
    const dir = x.op === 'ph' ? capDir(who.bizId, br, mapId) : frDir(who.bizId, br, mapId), max = x.op === 'ph' ? N_MAX : V_MAX;
    const save = async (p, buf) => { const fl = bk.file(p); await fl.save(buf, { resumable: false, contentType: 'image/jpeg', preconditionOpts: { ifGenerationMatch: 0 } }); return fl.metadata && fl.metadata.generation; };
    for (let i = 0; i < 6 && !f; i++) {
      n += 1;
      if (n > max) throw bad(x.op === 'ph' ? 'ph-full' : 'fr-full', 'הגעתם למספר המרבי של צילומים לפריט הזה', 'resource-exhausted');
      if (!(await claim(db, `cap_${mapId}_${x.op === 'ph' ? 'p' : 'f'}_${key}_${n}`, who.uid, now))) continue;
      const pf = fileOf(dir, key, n), pt = fileOf(dir, key, n, true);
      try {
        const g1 = await save(pf, x.img.buf);
        mine = [{ path: pf, gen: g1 }];
        mine.push({ path: pt, gen: await save(pt, x.th.buf) });
        f = { p: pf, t: pt };
        if (x.op === 'ph') x.n = n; else x.v = n;
      } catch (e) {
        await dropOwn(bk, mine); mine = [];
        if (is412(e)) continue;
        logger.warn('s3CapPut: save failed', { code: e && e.code });
        throw bad('save-failed', 'שמירת התמונה נכשלה. נסו שוב.', 'unavailable');
      }
    }
    if (!f) throw bad('busy', 'נסו שוב בעוד רגע', 'aborted');
  }
  const bay = item0.k === 'b' ? key.slice(2) : '';
  const lref = db.doc('s3look/' + mapId), sumRef = db.doc('s3sum/' + mapId);
  let out, mapV = 0, plan = null, syncNeeded = false;
  try {
    out = await db.runTransaction(async (tx) => {
      const reads = [tx.get(qref), tx.get(mref), tx.get(cref), tx.get(sref)];
      if (x.op === 'front' && !bay) reads.push(tx.get(lref));
      const [q, ms, cs, ss, ls] = await Promise.all(reads);
      if (q.exists) return { dup: dupOf(q) };
      const st = planItem(ms, key), item = st.item;
      plan = st.plan; mapV = Number.isInteger(ms.get('v')) ? ms.get('v') : 0;
      const old = cs.exists ? cs.data() : null, setup = ss.exists ? ss.data() : null;
      if (x.op === 'ph') { if (phOf(old).some((p) => p.n === x.n)) throw bad('busy', 'נסו שוב בעוד רגע', 'aborted'); phRoom(old, x.lv); }
      if (x.op === 'front' && old && Number.isInteger(old.frV) && old.frV >= x.v) throw bad('busy', 'החזית הוחלפה בטלפון אחר. טענו מחדש.', 'aborted');
      if (x.op === 'unskip' && (!old || old.st !== 'skip')) throw bad('not-skipped', 'הפריט לא מסומן כדילוג', 'failed-precondition');
      const doc = nextDoc(old, item, mapV, x, f, who.uid, now);
      const s0 = old ? P.itemState(old.st === 'orph' ? null : old, item) : 'todo', s1 = P.itemState(doc, item);
      tx.set(cref, doc);
      syncNeeded = !setup || setup.mapV !== mapV;
      tx.set(sref, Object.assign(setupDoc(setup, counters(setup, s0, s1), who.uid, now), syncNeeded ? {} : { mapV }), { merge: true });
      if (x.op === 'front') {
        if (bay) tx.set(sumRef, { b: { [bay]: { fr: f.t, frT: now } } }, { merge: true });
        else {
          const it = ls && ls.exists && isObj(ls.get('it')) ? ls.get('it') : {};
          if (it[key] || Object.keys(it).length < LOOK_MAX) tx.set(lref, { v: 1, it: { [key]: { th: f.t, p: f.p, t: now, v: x.v } }, upd: now }, { merge: true });
          else logger.warn('s3CapPut: s3look full', { mapId });
        }
      }
      const res = { ok: true, mapId, key, op: x.op, st: s1, ph: phOf(doc).length };
      if (x.op === 'ph') res.n = x.n;
      if (x.op === 'front') Object.assign(res, { v: x.v, fr: f.p, frTh: f.t });
      if (x.op === 'geo') res.n = x.n;
      if (x.op === 'off') res.off = phOf(doc).some((p) => p.n === x.n && p.off === true);
      tx.set(qref, { k: 'cap', uid: who.uid, res, at: now, exp: now + QID_DAYS * D1 });
      return { res };
    });
  } catch (e) {
    await dropOwn(bk, mine);
    if (e instanceof HttpsError) throw e;
    logger.error('s3CapPut: write failed', { code: e && e.code });
    throw bad('save-failed', 'שמירת הצילום נכשלה. נסו שוב.', 'unavailable');
  }
  if (out.dup) { await dropOwn(bk, mine); return out.dup; }
  if (syncNeeded && plan) { try { await syncPlan(db, mapId, plan, mapV, now); } catch (e) { logger.warn('s3CapPut: sync failed', { code: e && e.code }); } }
  return out.res;
}
exports.s3CapPut = onCall({ memory: '512MiB' }, T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!canDraw(who)) throw bad('not-s3m', 'צילום החנות מותר למנהל או לעובד עם הרשאת "שרטוט מפה"', 'permission-denied');
  return capPut(T.tdb(), { uid: who.uid, bizId: who.bizId, brs: mapLib().myBranches(who) }, inputObject(request), Date.now());
}));

// ---------------- s3SetupDone ----------------
const BAY_RE = /^f[0-9]{1,4}-[ab]-[0-9]{1,2}$/;
async function setupDone(db, who, input, now) {
  const qid = qidOf(input), mapId = mapIdOf(input), br = mapId.slice(2);
  brAllowed(who, br);
  const qref = db.doc('s3qid/' + qid);
  const same = (q) => q.get('k') === 'done' && q.get('uid') === who.uid && isObj(q.get('res')) && q.get('res').mapId === mapId;
  const q0 = await qref.get();
  if (q0.exists) { if (!same(q0)) throw bad('bad-qid', 'מזהה השליחה כבר שימש לפעולה אחרת'); return Object.assign({}, q0.get('res'), { dup: true }); }
  await mapLib().branchOk(db, who.bizId, br, mapId.charAt(0));
  const ms = await db.doc('smap/' + mapId).get();
  const { plan, map } = planItem(ms, '');
  if (!plan.n) throw bad('empty-plan', 'אין במפה מה לצלם. שרטטו חדר אחד לפחות.', 'failed-precondition');
  if (plan.big) throw bad('plan-too-big', 'התוכנית גדולה מדי – פצלו את המפה או הגדילו את אריחי הרצפה', 'failed-precondition');
  const cs = await db.collection(`s3setup/${mapId}/cap`).get();
  const docs = {}; for (const d of cs.docs) docs[d.id] = d.data();
  const sm = P.summary(plan, docs);
  if (!sm.all) throw bad('not-done', `עוד ${sm.miss.length} פריטים לא צולמו או לא אושרו. צלמו אותם, או דלגו עם סיבה.`, 'failed-precondition', { miss: sm.miss.slice(0, 20), n: sm.miss.length });
  // הערות המקטעים ← bay.notes (רק הוספה, רק אם יש מקום; n.bay = 1 כדי שלא תועתק פעמיים). בקבוצות של 100 מקטעים לטרנזקציה.
  const bays = new Set(plan.items.filter((i) => i.k === 'b').map((i) => i.key.slice(2)));
  const ns = await db.collection(`s3setup/${mapId}/n`).get();
  // הקמת חנות שלב 2: רק הערה שבטוח שייכת למקטע הזה מועתקת: על המפה השמורה (on='map'), או מטיוטה שהגיאומטריה שלה (g) מצביעה בדיוק
  // על המקטע הזה. "לשיוך מחדש" (re, לא נמצא / לא חד-משמעי / מצביע על מקטע אחר) – לא מועתקת עד שישייכו אותה
  const NI = NK.geoIndex(map), okHere = (n, id) => { const r = NK.noteTo(n, id, NI); return r.st === 'ok' && r.to === id; };
  const todo = ns.docs.filter((d) => BAY_RE.test(d.id) && bays.has(d.id) && d.get('bay') !== 1 && typeof d.get('t') === 'string' && d.get('t').trim() && okHere(d.data(), d.id));
  let added = 0;
  for (let i = 0; i < todo.length; i += 100) {
    const part = todo.slice(i, i + 100);
    added += await db.runTransaction(async (tx) => {
      const nn = await Promise.all(part.map((d) => tx.get(d.ref)));
      const bb = await Promise.all(part.map((d) => tx.get(db.doc(`smap/${mapId}/bay/${d.id}`))));
      let k = 0;
      nn.forEach((n, j) => {
        if (!n.exists || n.get('bay') === 1 || !okHere(n.data(), n.id)) return;
        const t = String(n.get('t') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
        if (!t) return;
        const L = bb[j].exists && Array.isArray(bb[j].get('notes')) ? bb[j].get('notes') : [];
        if (L.length >= NOTES_MAX) return;
        const by = typeof n.get('by') === 'string' && M.RE.uid.test(n.get('by')) ? n.get('by') : who.uid;
        tx.set(bb[j].ref, { notes: L.concat([{ t, at: now, by, src: 'setup' }]) }, { merge: true });
        tx.update(n.ref, { bay: 1 });
        k++;
      });
      return k;
    });
  }
  const reN = ns.docs.filter((d) => typeof d.get('t') === 'string' && d.get('t').trim() && !okHere(d.data(), d.id)).length;
  const res = { ok: true, mapId, n: plan.n, done: sm.ok, skip: sm.skip, notes: added, re: reN, mapV: Number.isInteger(map.v) ? map.v : 0 };
  await db.runTransaction(async (tx) => {
    const [q, ss] = await Promise.all([tx.get(qref), tx.get(db.doc('s3setup/' + mapId))]);
    if (q.exists) return;
    tx.set(db.doc('s3setup/' + mapId), Object.assign(ss.exists ? {} : { v: 1 }, { st: 'done', doneAt: now, doneBy: who.uid, upd: now, by: who.uid, mapV: res.mapV, capOk: sm.ok, capPart: sm.part, capSkip: sm.skip }), { merge: true });
    tx.set(qref, { k: 'done', uid: who.uid, res, at: now, exp: now + QID_DAYS * D1 });
  });
  return res;
}
exports.s3SetupDone = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'store3d' });
  if (!canDraw(who)) throw bad('not-s3m', 'סיום ההקמה מותר למנהל או לעובד עם הרשאת "שרטוט מפה"', 'permission-denied');
  return setupDone(T.tdb(), { uid: who.uid, bizId: who.bizId, brs: mapLib().myBranches(who) }, inputObject(request), Date.now());
}));

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_cap', { enumerable: false, value: { capPut, setupDone, cleanPut, cleanGeo, nextDoc, counters, phRoom, syncPlan, LIM } });
