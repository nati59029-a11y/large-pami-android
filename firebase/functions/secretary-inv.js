'use strict';
// המזכירה העסקית – שלב 7 "קליטת חשבוניות" (אפיון 4.1–4.7, 9.4, 9.5, 10.3, 10.4, 10.7; החלטות 34–40, 109–111).
//
// עיקרון (4.1): הנתונים הכספיים נשמרים במכשיר של המנהל. השרת לא כותב הוצאה – הוא שומר את המסמך בתור (sec_inv), והמכשיר מכניס אותו
// באותה פונקציית כניסה של תיבת העובדים (ACT.inbOk), עם בדיקת הכפילויות הקיימת – אחרי "תפיסה" חד־פעמית בשרת (secDecide, 4.7).
//
// הזרימה:
//   קובץ מווצאפ (secretary-wa.js) או קובץ מצורף ב-Gmail (secretary-google.js) → ingest: בדיקת הקובץ לפני כל עלות (גודל, חתימת קובץ, zip/Office/הפעלה,
//   PDF מוצפן או עם פקודות, עד 4 עמודים) → מזהה = טביעת הקובץ (אותו קובץ ממייל ומווצאפ = רשומה אחת) → חלקי הקובץ ב-sec_inv/{id}/p/{k} →
//   תור הזיהוי (sec_waq עם inv:true – אותו טריגר secWaWork) → workIn: מכסת הסריקה הקיימת (bizCaps/reserveScan, קובץ = 1 – 109) →
//   הסריקה האחידה (classify) → ספק (ח.פ / שולח מקושר), סניף (40), כפילות בשרת (39), זכאות ל"נכנס ישר" (34–36) → st:'new'.
//
// sec_inv/{id} { st: 'q'|'qw'|'new'|'cl'|'ok'|'rej', k: 'q'|'inv'|'rcpt'|'dn'|'cr'|'chk'|'unk'|'bad'|'long', t, src:[{ch,from,name,in,t,sus?}], fn, mime, size, np, pages,
//                f, unsure[], sub, subN, match, br, brOk, ns (שולח חדש – מפתח השולח), dk, dk2, dup, full, el, why[], hold, sus, err,
//                by, dev, mode, clAt, okAt, okBy, auto, rejAt, rejBy, purgeAt, purged }      + p/{k} { d } (base64)
// sec_cfg/inv   { auto, cap, off{sub:true}, links{senderKey:sub}, sups[{id,name,hp,br[]}], nb, br1, supH, supAt } – שרת בלבד
//
// פונקציות: secInv (מנהל העסק: list, file, cfg, sups) ; secDecide (מנהל העסק: claim, done, rej, release, hold, undo, sender) – כל שינוי מצב בתור רק כאן.
// הרשאה: אותו שער כמו שלבים 1–6 (gate: requireStaff+secretary, מנהל אמיתי, הסכמה, מצב מנהלים, עסק פעיל). מנהל עם הגבלת סניפים – רק חשבוניות של הסניפים שלו.
const { HttpsError } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const scan = require('./lib/scan');
const CL = require('./lib/classify');
const AI = require('./lib/sec-ai');
const SI = require('./lib/sec-inv');
const C = require('./secretary')._core;
const { gate, logData, bad, deny, pre, wrap } = C;

const GEMINI_API_BASE = defineString('GEMINI_API_BASE', { default: 'https://generativelanguage.googleapis.com', description: 'כתובת השירות של Gemini' });
const SEC_USER_DAY = 100;   // התקרה ל"משתמש" המזכירה במונה הסריקה (כמו SCAN_DAILY_LIMIT בברירת המחדל; העסק נספר במונה העסק הקיים)
const SEC_SCAN_UID = '_sec';
const ID_RE = /^[fx][0-9a-f]{40}$/;
const DEV_RE = /^[A-Za-z0-9_-]{6,64}$/;
const SUB_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BR_RE = /^[a-z0-9_]{2,20}$/;
const SRC_MAX = 10, SUPS_MAX = 3000, LIST_MAX = 300;
const HOLDS = ['dup', 'dn', 'aw', 'local', 'undo', 'rel']; // rel – תפיסה ששוחררה (24 שעות): אולי כבר נכנסה במכשיר אחר, חוזרת רק לאישור ידני
const RELEASED = (x) => ({ hold: 'rel', el: false, why: [...new Set(((x && x.why) || []).concat(['hold']))] });
const ilog = (by, who, act, extra) => Object.assign(logData(by, who, act, extra), { ch: 'inv' });
const WA = () => require('./secretary-wa')._core; // עצלן – secretary-wa.js טוען את הקובץ הזה בתוך הטיפול
const show = (k) => String(k || '').replace(/^wa:/, '+').replace(/^m:/, '');

async function stopOn(db) { const s = await db.doc('sec_cfg/wa').get(); return !!(s.exists && s.get('stop') && s.get('stop').on === true); }
async function notify(db, key, title, body, now) { try { await WA().notifyMgrs(db, 'inv|' + key, title, body, now); } catch (e) { logger.warn('secretary-inv: notify failed', { reason: (e && e.code) || 'error' }); } }

// =====================================================================================
// קליטה: קובץ אחד (מווצאפ או ממייל) → sec_inv. o: { ch, from, name, inId, idx, fn, buf, sus, now }
// מחזיר { id, dup?, bad?, long? }. לא זורק על קובץ פגום – הוא נשמר ככרטיס "התקבל קובץ שלא נקלט" (בלי הקובץ עצמו).
// =====================================================================================
async function ingest(db, o) {
  const now = o.now || Date.now();
  const src = { ch: o.ch === 'mail' ? 'mail' : 'wa', from: String(o.from || '').slice(0, 200), name: String(o.name || '').slice(0, 80), in: String(o.inId || '').slice(0, 100), t: now };
  if (o.sus) src.sus = true;
  // תיקון 1 (ליקוי 2): מייל שלא עבר אימות DKIM/DMARC של דומיין השולח (secretary-google: authOf)
  if (src.ch === 'mail' && o.auth === false) src.ua = true;
  const fn = String(o.fn || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
  const chk = o.why ? { ok: false, why: o.why } : SI.inspect(o.buf);
  if (!chk.ok) {
    // קובץ חשוד / לא נתמך: לא נשמר, לא נפתח ולא נשלח לזיהוי. כרטיס עם שם השולח
    const id = 'x' + SI.sha(src.ch + '|' + src.in + '|' + (o.idx || 0) + '|' + fn).slice(0, 40);
    const ref = db.doc('sec_inv/' + id);
    try { await ref.create({ st: 'new', k: 'bad', why: [chk.why], t: now, src: [src], fn, size: Buffer.isBuffer(o.buf) ? o.buf.length : Number(o.size) || 0, np: 0, el: false }); } catch (e) { if (e && e.code === 6) return { id, dup: true, bad: true }; throw e; }
    await db.collection('sec_log').doc().set(ilog('', 'sec', 'invBad', { tgt: id, note: chk.why }));
    return { id, bad: true };
  }
  const id = 'f' + SI.sha(o.buf).slice(0, 40);
  const ref = db.doc('sec_inv/' + id);
  const add = async () => db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return false;
    const L = Array.isArray(s.get('src')) ? s.get('src') : [];
    if (!L.some((x) => x && x.ch === src.ch && x.in === src.in) && L.length < SRC_MAX) {
      const up = { src: L.concat([src]) };
      if (src.sus && !s.get('sus')) Object.assign(up, { sus: true, el: false, why: [...new Set((s.get('why') || []).concat(['sus']))] });
      tx.update(ref, up);
    }
    return true;
  });
  if (await add()) return { id, dup: true };
  // חלקי הקובץ קודם (אותו תוכן לאותו מזהה – כתיבה חוזרת לא מזיקה), ואחר כך הרשומה עצמה
  const b64 = o.buf.toString('base64');
  const np = Math.ceil(b64.length / SI.PART);
  for (let k = 0; k < np; k += 10) {
    const b = db.batch();
    for (let j = k; j < Math.min(np, k + 10); j++) b.set(db.doc(`sec_inv/${id}/p/${j}`), { d: b64.slice(j * SI.PART, (j + 1) * SI.PART) });
    await b.commit();
  }
  const doc = { st: chk.long ? 'new' : 'q', k: chk.long ? 'long' : 'q', t: now, src: [src], fn, mime: chk.mime, size: o.buf.length, np, pages: chk.pages, el: false };
  if (src.sus) doc.sus = true;
  try { await ref.create(doc); } catch (e) { if (e && e.code === 6) { await add(); return { id, dup: true }; } throw e; }
  await db.collection('sec_log').doc().set(ilog('', 'sec', chk.long ? 'invLong' : 'invIn', { tgt: id, note: src.ch }));
  // בדיקות שמריצות את הזיהוי בתוך התהליך (עם מודל מדומה) – בלי תור, כדי שהטריגר באמולטור לא יתחרה בהן. רק באמולטור
  const noQ = process.env.FUNCTIONS_EMULATOR === 'true' && process.env.SEC_INV_TEST_NOQUEUE === '1';
  if (!chk.long && !noQ) {
    const bizId = (T.scope() || {}).bizId;
    await getFirestore().doc('sec_waq/' + bizId + '__' + id).create({ biz: bizId, id, inv: true, t: now }).catch(() => {});
  }
  return { id, long: !!chk.long };
}

// =====================================================================================
// זיהוי (טריגר secWaWork, רשומת תור עם inv:true). o.classify – מודל מדומה בבדיקות
// =====================================================================================
async function work(bizId, id, opts) {
  const biz = await T.loadBiz(bizId);
  if (!biz || biz.status !== 'active' || !biz.features || biz.features.secretary !== true) return { skip: 'biz' };
  return T.runInBiz({ bizId, prefix: T.bizPrefix(biz), biz }, () => workIn(id, opts || {}));
}
async function readFile(db, id, np) {
  const ps = await Promise.all(Array.from({ length: np }, (_, k) => db.doc(`sec_inv/${id}/p/${k}`).get()));
  return ps.map((p) => (p.exists ? String(p.get('d') || '') : '')).join('');
}
async function geminiClassify(file) {
  let key = ''; try { key = AI.GEMINI_API_KEY.value(); } catch (e) { key = ''; }
  if (!key) throw new HttpsError('failed-precondition', 'אין מפתח לזיהוי', { reason: 'no-key' });
  const t = scan.timesFor('classify');
  const stats = { sent: 0 };
  try {
    const r = await scan.callGemini(GEMINI_API_BASE.value().replace(/\/+$/, ''), key, scan.buildGeminiBody('classify', [file]), t.timeoutMs, false, { deadline: Date.now() + t.budgetMs, stats });
    const raw = scan.parseLikeApp(r.text);
    if (!raw) throw new HttpsError('internal', 'התשובה מהזיהוי לא נקראה', { reason: 'bad-answer' });
    return raw;
  } catch (e) { e.sent = stats.sent; throw e; }
}
async function workIn(id, o) {
  const db = T.tdb();
  const now = o.now || Date.now();
  const ref = db.doc('sec_inv/' + id);
  const x = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    const v = s.data();
    if (v.st === 'q' || (v.st === 'qw' && now - (v.wk || 0) > 10 * 60000)) { tx.update(ref, { st: 'qw', wk: now }); return v; }
    return null;
  });
  if (!x) return { skip: 'taken' };
  const fail = async (err) => { await ref.update({ st: 'new', k: 'unk', err, el: false, why: ['type'] }); await db.collection('sec_log').doc().set(ilog('', 'sec', 'invErr', { tgt: id, note: err })); return { err }; };
  const data = await readFile(db, id, x.np || 0);
  if (!data) return fail('file');
  // 109: הזיהוי עובר דרך המכסה הקיימת של העסק, קובץ = 1 (גם PDF של 4 עמודים)
  const bizId = (T.scope() || {}).bizId;
  let usage;
  try {
    const caps = await scan.bizCaps(bizId, SEC_USER_DAY);
    usage = await scan.reserveScan(SEC_SCAN_UID, caps.perUser, caps.bizDaily, 1, caps.bizKey, caps.period);
  } catch (e) { if (e && e.code === 'resource-exhausted') return fail('quota'); throw e; }
  let raw;
  try { raw = await (o.classify || geminiClassify)({ mimeType: x.mime, data }); } catch (e) {
    await scan.refundScan(SEC_SCAN_UID, usage.day); // כמו בסריקה האחידה: זיהוי שנכשל לא נספר
    return fail('ai');
  }
  const m = SI.mapClassify(CL.shapeClassify(raw, CL.TYPES, {}));
  const [cs, stop] = await Promise.all([db.doc('sec_cfg/inv').get(), stopOn(db)]);
  const cfg = SI.invCfgOf(cs);
  const s0 = (x.src || [])[0] || {};
  const skey = SI.senderKey(s0.ch, s0.from);
  // מייל לא מאומת: השולח לא משמש לזיהוי הספק (אין 'snd'), והחשבונית לא זכאית ל"נכנס ישר" (why 'auth')
  const ua = s0.ch === 'mail' && s0.ua === true;
  const up = { st: 'new', k: m.k, t0: m.t0, f: m.f, unsure: m.unsure, wk: FieldValue.delete(), ua };
  if (['inv', 'rcpt', 'dn', 'cr'].includes(m.k)) {
    const sm = SI.matchSup(m.f, cfg, ua ? '' : skey);
    const b = SI.brOf(sm.sub, cfg);
    Object.assign(up, sm, b, { ns: sm.sub && cfg.links[skey] !== sm.sub ? skey : '', full: SI.fullOf(m) });
    const keys = SI.dupKeys(m, sm.sub);
    Object.assign(up, keys);
    // 39 + 10.4: אותה חשבונית בקובץ אחר (למשל צילום בווצאפ ו-PDF במייל) – ממתינה עם התראה
    let dup = '';
    for (const [fld, v] of [['dk', keys.dk], ['dk2', keys.dk2]]) {
      if (!v || dup) continue;
      const q = await db.collection('sec_inv').where(fld, '==', v).limit(5).get();
      const d = q.docs.find((z) => z.id !== id && z.get('st') !== 'rej');
      if (d) dup = d.id;
    }
    up.dup = dup;
  } else Object.assign(up, { sub: '', match: '', br: '', brOk: false, ns: '', full: false, dup: '' });
  const why = SI.eligOf(Object.assign({}, x, up), cfg, stop);
  Object.assign(up, { el: why.length === 0, why });
  await ref.update(up);
  // תיקון 1 (ליקוי 7): שני קבצים של אותה חשבונית שזוהו באותו זמן – בדיקה שנייה אחרי הכתיבה; מי שמוצאת את השנייה – ממתינה
  if (!up.dup && (up.dk || up.dk2)) {
    for (const [fld, v] of [['dk', up.dk], ['dk2', up.dk2]]) {
      if (!v || up.dup) continue;
      const q = await db.collection('sec_inv').where(fld, '==', v).limit(5).get();
      const d = q.docs.find((z) => z.id !== id && z.get('st') !== 'rej');
      if (d) up.dup = d.id;
    }
    if (up.dup) { up.el = false; up.why = [...new Set(up.why.concat(['dup']))]; await ref.update({ dup: up.dup, el: false, why: up.why }); }
  }
  if (ua && cfg.links[skey]) {
    // כתובת של ספק מקושר, אבל המייל לא אומת – אולי זיוף. ממתינה + התראה
    await db.collection('sec_log').doc().set(ilog('', 'sec', 'invUnauth', { tgt: id }));
    await notify(db, 'ua|' + id, 'חשבונית ממייל לא מאומת', 'הגיעה חשבונית במייל מהכתובת ' + show(skey) + ', אבל Gmail לא אישר שהמייל באמת נשלח ממנה. היא ממתינה לבדיקה שלך במסך "חשבוניות שהתקבלו".', now);
  }
  if (up.dup) {
    await db.collection('sec_log').doc().set(ilog('', 'sec', 'invDup', { tgt: id, note: up.dup }));
    await notify(db, 'dup|' + id, 'חשד לחשבונית כפולה', 'הגיעה חשבונית שנראית כמו חשבונית שכבר התקבלה. היא ממתינה לבדיקה שלך במסך "חשבוניות שהתקבלו".', now);
  }
  return { k: m.k, el: up.el, why };
}

// =====================================================================================
// פונקציות האפליקציה
// =====================================================================================
async function who2(request) {
  const g = await gate(request, { consent: true });
  const a = await g.db.doc('admins/' + g.who.uid).get();
  const br = !g.who.superadmin && a.exists && Array.isArray(a.get('br')) ? a.get('br').filter((b) => typeof b === 'string') : null;
  return Object.assign(g, { br });
}
// מנהל עם הגבלת סניפים: רק חשבוניות שהסניף שלהן ידוע ונמצא ברשימה שלו
const brAllowed = (g, x) => !g.br || (typeof x.br === 'string' && !!x.br && g.br.includes(x.br));
function outOf(id, x, uid, now) {
  const o = {
    id, st: x.st, k: x.k, t: x.t || 0, fn: x.fn || '', mime: x.mime || '', size: x.size || 0, np: x.np || 0, pages: x.pages || 0,
    src: (x.src || []).slice(0, SRC_MAX).map((s) => ({ ch: s.ch, from: s.from, name: s.name || '', t: s.t || 0, sus: !!s.sus })),
    f: x.f || {}, unsure: x.unsure || [], sub: x.sub || '', subN: x.subN || '', match: x.match || '', br: x.br || '', brOk: x.brOk === true,
    ns: x.ns || '', nsShow: show(x.ns), ua: x.ua === true, dup: x.dup || '', el: x.el === true, why: x.why || [], hold: x.hold || '', err: x.err || '', t0: x.t0 || '',
  };
  if (x.st === 'cl') Object.assign(o, { mine: x.by === uid, dev: x.by === uid ? x.dev || '' : '', clAt: x.clAt || 0, stale: now - (x.clAt || 0) > SI.CLAIM_MS });
  if (x.st === 'ok') Object.assign(o, { okAt: x.okAt || 0, auto: x.auto === true, mineOk: x.okBy === uid, okDev: x.okBy === uid ? x.dev || '' : '', purged: x.purged === true });
  return o;
}
async function secInv(request) {
  const input = inputObject(request);
  const op = ['list', 'file', 'cfg', 'sups'].includes(input.op) ? input.op : null;
  if (!op) throw bad('bad-op', 'פעולה לא מוכרת');
  const g = await who2(request);
  const { db, who } = g;
  const now = Date.now();
  if (op === 'list') {
    const [a, r, cs, stop] = await Promise.all([
      db.collection('sec_inv').where('st', 'in', ['q', 'qw', 'new', 'cl']).limit(LIST_MAX).get(),
      db.collection('sec_inv').where('okAt', '>', now - 3 * 864e5).limit(100).get(),
      db.doc('sec_cfg/inv').get(), stopOn(db),
    ]);
    const seen = new Set(), items = [];
    for (const d of a.docs.concat(r.docs)) { if (seen.has(d.id)) continue; seen.add(d.id); const x = d.data(); if (brAllowed(g, x)) items.push(outOf(d.id, x, who.uid, now)); }
    items.sort((p, q) => q.t - p.t);
    const cfg = SI.invCfgOf(cs);
    return { ok: true, items, cfg: { auto: cfg.auto, cap: cfg.cap, off: Object.keys(cfg.off).filter((k) => cfg.off[k] === true), supH: cfg.supH, supAt: cfg.supAt, supMe: cfg.supBy === who.uid, supDev: cfg.supBy === who.uid ? cfg.supDev : '', linked: Object.keys(cfg.links).length }, stop, br: g.br };
  }
  if (op === 'file') {
    const id = String(input.id || '');
    if (!ID_RE.test(id)) throw bad('bad-id', 'מזהה לא תקין');
    const s = await db.doc('sec_inv/' + id).get();
    if (!s.exists || !brAllowed(g, s.data())) throw new HttpsError('not-found', 'החשבונית לא נמצאה', { reason: 'not-found' });
    const k = Number.isInteger(input.k) ? input.k : 0;
    if (k < 0 || k >= (s.get('np') || 0) || s.get('purged')) throw new HttpsError('not-found', 'הקובץ כבר לא שמור בתור', { reason: 'no-file' });
    const p = await db.doc(`sec_inv/${id}/p/${k}`).get();
    return { ok: true, id, k, np: s.get('np'), mime: s.get('mime'), d: p.exists ? p.get('d') : '' };
  }
  if (g.br) throw deny('br-limited', 'הגדרות קליטת החשבוניות – למנהל בלי הגבלת סניפים');
  const ref = db.doc('sec_cfg/inv');
  if (op === 'cfg') {
    const up = {};
    if (input.auto !== undefined) { if (typeof input.auto !== 'boolean') throw bad('bad-auto', 'ערך לא תקין'); up.auto = input.auto; }
    if (input.cap !== undefined) { if (typeof input.cap !== 'number' || !Number.isFinite(input.cap) || input.cap < 0 || input.cap > 1e7) throw bad('bad-cap', 'תקרה לא תקינה'); up.cap = Math.round(input.cap * 100) / 100; }
    if (input.sub !== undefined) {
      if (typeof input.sub !== 'string' || !SUB_RE.test(input.sub) || typeof input.off !== 'boolean') throw bad('bad-sub', 'ספק לא תקין');
      up.off = { [input.sub]: input.off ? true : FieldValue.delete() };
    }
    if (!Object.keys(up).length) throw bad('nothing', 'אין מה לשמור');
    await ref.set(Object.assign(up, { upd: now, updBy: who.uid }), { merge: true });
    await db.collection('sec_log').doc().set(ilog(who.uid, 'mgr', 'invCfg', { note: Object.keys(up).filter((k) => !['upd', 'updBy'].includes(k)).map((k) => k + '=' + (k === 'off' ? input.sub + ':' + input.off : up[k])).join(',') }));
    const c = SI.invCfgOf(await ref.get());
    return { ok: true, cfg: { auto: c.auto, cap: c.cap, off: Object.keys(c.off).filter((k) => c.off[k] === true) } };
  }
  // sups: רשימת הספקים (שם, ח.פ, סניפים) מהמכשיר של המנהל – כדי שהשרת יזהה "ספק מוכר" ו"ספק של סניף אחד" (4.3, 40)
  const L = Array.isArray(input.sups) ? input.sups : null;
  if (!L || L.length > SUPS_MAX) throw bad('bad-sups', 'רשימת ספקים לא תקינה');
  const sups = [];
  for (const s of L) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !SUB_RE.test(s.id)) continue;
    const hp = SI.hpN(s.hp);
    sups.push({ id: s.id, name: String(s.name || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80), hp: SI.hpOk(hp) ? hp : '', br: (Array.isArray(s.br) ? s.br : []).filter((b) => typeof b === 'string' && BR_RE.test(b)).slice(0, 20) });
  }
  const nb = Number.isInteger(input.nb) && input.nb >= 0 && input.nb < 100 ? input.nb : 0;
  const br1 = typeof input.br1 === 'string' && BR_RE.test(input.br1) ? input.br1 : '';
  const supH = SI.sha(JSON.stringify([sups, nb, br1])).slice(0, 16);
  const supDev = typeof input.dev === 'string' && DEV_RE.test(input.dev) ? input.dev : '';
  const cur = SI.invCfgOf(await ref.get());
  if (cur.supH === supH) return { ok: true, same: true, supH, n: sups.length };
  await ref.set({ sups, nb, br1, supH, supAt: now, supBy: who.uid, supDev }, { merge: true });
  // תיקון 1 (ליקוי 8): כל מכשיר מחזיק עותק משלו של הספקים. שיוך סניף של ספק השתנה (או מספר הסניפים) – חשבוניות שממתינות מאבדות את הזכאות
  // ל"נכנס ישר" ואת הסניף שנקבע, והסניף מחושב מחדש לפי הרשימה החדשה. נרשם ביומן מי פרסם
  const brKey = (L, id) => { const x = L.find((z) => z && z.id === id); return x ? JSON.stringify((x.br || []).slice().sort()) : '-'; };
  const all = cur.nb !== nb || cur.br1 !== br1;
  const ch = new Set();
  if (!all) for (const id of new Set(cur.sups.map((x) => x && x.id).concat(sups.map((x) => x.id)))) if (id && brKey(cur.sups, id) !== brKey(sups, id)) ch.add(id);
  let rev = 0;
  if (cur.supH && (all || ch.size)) {
    const q = await db.collection('sec_inv').where('st', '==', 'new').limit(LIST_MAX).get();
    const ncfg = { sups, nb, br1 };
    const b = db.batch();
    for (const d of q.docs) {
      const x = d.data();
      if (!x.sub || !(all || ch.has(x.sub))) continue;
      const nbr = SI.brOf(x.sub, ncfg);
      const why = [...new Set((x.why || []).concat(['hold']).concat(nbr.brOk ? [] : ['br']))];
      b.update(d.ref, Object.assign({ el: false, hold: x.hold || 'local', why }, nbr));
      rev++;
    }
    if (rev) await b.commit();
  }
  await db.collection('sec_log').doc().set(ilog(who.uid, 'mgr', 'invSups', { note: 'n=' + sups.length + (supDev ? ',dev=' + supDev : '') + (rev ? ',rev=' + rev : '') }));
  return { ok: true, supH, n: sups.length, rev };
}

// secDecide – כל שינוי מצב בתור (4.7, 9.4). claim במצב אוטומטי בודק את כל התנאים שוב (4.3) ומסרב כשאחד לא מתקיים.
async function secDecide(request) {
  const input = inputObject(request);
  const op = ['claim', 'done', 'rej', 'release', 'hold', 'undo', 'sender'].includes(input.op) ? input.op : null;
  if (!op) throw bad('bad-op', 'פעולה לא מוכרת');
  const id = String(input.id || '');
  if (!ID_RE.test(id)) throw bad('bad-id', 'מזהה לא תקין');
  const dev = typeof input.dev === 'string' && DEV_RE.test(input.dev) ? input.dev : '';
  if (['claim', 'done', 'release'].includes(op) && !dev) throw bad('bad-dev', 'חסר מזהה מכשיר');
  const mode = input.mode === 'auto' ? 'auto' : 'man';
  const g = await who2(request);
  const { db, who } = g;
  const uid = who.uid;
  const now = Date.now();
  const ref = db.doc('sec_inv/' + id);
  const gone = () => new HttpsError('not-found', 'החשבונית לא נמצאה', { reason: 'not-found' });
  if (op === 'sender') {
    // תיקון 1 (ליקוי 6): קישור שולח חל על כל העסק – כמו שאר ההגדרות, רק למנהל בלי הגבלת סניפים
    if (g.br) throw deny('br-limited', 'אישור שולח – למנהל בלי הגבלת סניפים');
    const s = await ref.get();
    if (!s.exists || !brAllowed(g, s.data())) throw gone();
    const x = s.data();
    if (!x.ns || !x.sub) throw pre('no-sender', 'אין שולח חדש לאשר');
    await db.doc('sec_cfg/inv').set({ links: { [x.ns]: x.sub } }, { merge: true });
    const q = await db.collection('sec_inv').where('ns', '==', x.ns).limit(50).get();
    const b = db.batch();
    q.docs.filter((d) => d.get('sub') === x.sub).forEach((d) => b.update(d.ref, { ns: '' }));
    b.set(db.collection('sec_log').doc(), ilog(uid, 'mgr', 'invSender', { tgt: id }));
    await b.commit();
    return { ok: true, id, sender: show(x.ns), sub: x.sub };
  }
  let after = null; // פעולות אחרי הטרנזקציה (התראה, יומן)
  const r = await db.runTransaction(async (tx) => {
    after = null; // טרנזקציה שרצה שוב – מתחילים נקי
    const [s, cs, ws] = await Promise.all([tx.get(ref), op === 'claim' && mode === 'auto' ? tx.get(db.doc('sec_cfg/inv')) : null, op === 'claim' && mode === 'auto' ? tx.get(db.doc('sec_cfg/wa')) : null]);
    if (!s.exists) throw gone();
    const x = s.data();
    if (!brAllowed(g, x)) throw deny('br-limited', 'החשבונית שייכת לסניף שאינו שלך');
    const mineCl = x.st === 'cl' && x.by === uid;
    if (op === 'claim') {
      if (x.k === 'bad' || ['q', 'qw'].includes(x.st)) throw pre('not-ready', 'אין מה להכניס');
      if (x.st === 'ok') throw pre('already', 'כבר הוכנסה במכשיר אחר');
      if (x.st === 'rej') throw pre('rejected', 'החשבונית נדחתה');
      if (x.st === 'cl' && !(mineCl && x.dev === dev) && now - (x.clAt || 0) <= SI.CLAIM_MS) throw pre('already', 'כבר הוכנסה במכשיר אחר');
      // תיקון 1 (ליקוי 1): תפיסה ישנה (מעל 24 שעות) של מכשיר אחר – ייתכן שהחשבונית כבר נכנסה שם ורק הדיווח לא יצא.
      // מכאן רק אישור ידני עם עיכוב (hold 'rel', el:false) והתראה; השתלטות במצב אוטומטי נדחית
      if (x.st === 'cl' && !(mineCl && x.dev === dev)) {
        const rel = RELEASED(x);
        after = { act: 'invRelease', x };
        if (mode === 'auto') {
          tx.update(ref, Object.assign({ st: 'new', by: FieldValue.delete(), dev: FieldValue.delete(), mode: FieldValue.delete(), clAt: FieldValue.delete() }, rel));
          return { deny: ['hold'], el: false };
        }
        tx.update(ref, Object.assign({ st: 'cl', by: uid, dev, mode, clAt: now }, rel));
        return { ok: true, x: Object.assign({}, x, rel) };
      }
      if (mode === 'auto') {
        // 4.3: הבדיקה בשרת, ברגע התפיסה – סימון הזכאות מהעיבוד + כל התנאים שוב עם ההגדרות של עכשיו
        const why = SI.eligOf(x, SI.invCfgOf(cs), !!(ws.exists && ws.get('stop') && ws.get('stop').on === true));
        if (x.el !== true && !why.length) why.push('el');
        if (why.length) return { deny: why, el: x.el === true };
      }
      if (mineCl && x.dev === dev) return { ok: true, x, again: true };
      tx.update(ref, { st: 'cl', by: uid, dev, mode, clAt: now });
      return { ok: true, x };
    }
    if (op === 'done') {
      if (x.st === 'ok' && x.okBy === uid) return { ok: true, again: true };
      if (!mineCl || x.dev !== dev) throw pre('not-mine', 'החשבונית לא נתפסה במכשיר הזה');
      const auto = x.mode === 'auto';
      tx.update(ref, { st: 'ok', okAt: now, okBy: uid, auto, purgeAt: now + SI.KEEP_DAYS * 864e5 });
      after = { act: auto ? 'invAuto' : 'invOk', x, auto };
      return { ok: true, auto };
    }
    if (op === 'release') {
      if (!mineCl) return { ok: true, again: true };
      tx.update(ref, { st: 'new', by: FieldValue.delete(), dev: FieldValue.delete(), mode: FieldValue.delete(), clAt: FieldValue.delete() });
      return { ok: true };
    }
    if (op === 'rej') {
      if (x.st === 'rej') return { ok: true, again: true };
      if (!(x.st === 'new' || mineCl || (x.st === 'cl' && now - (x.clAt || 0) > SI.CLAIM_MS))) throw pre(x.st === 'ok' ? 'already' : 'taken', x.st === 'ok' ? 'כבר הוכנסה' : 'בטיפול במכשיר אחר');
      tx.update(ref, { st: 'rej', rejAt: now, rejBy: uid, el: false, purgeAt: now + SI.KEEP_DAYS * 864e5 });
      after = { act: 'invRej', x };
      return { ok: true };
    }
    if (op === 'hold') {
      const why = HOLDS.includes(input.why) ? input.why : 'local';
      if (!(x.st === 'new' || mineCl)) return { ok: true, again: true };
      const was = x.hold === why;
      tx.update(ref, Object.assign({ hold: why, el: false, why: [...new Set((x.why || []).concat(['hold']))] }, mineCl ? { st: 'new', by: FieldValue.delete(), dev: FieldValue.delete(), mode: FieldValue.delete(), clAt: FieldValue.delete() } : {}));
      after = was ? null : { act: 'invHold', x, why };
      return { ok: true };
    }
    // undo: ביטול של "נכנס ישר" (4.3: "אפשרות ביטול") – חוזר ל"ממתין לאישור", לא יוכנס שוב אוטומטית
    if (x.st !== 'ok' || x.okBy !== uid) throw pre('not-mine', 'אפשר לבטל רק חשבונית שהוכנסה אצלך');
    // תיקון 1 (ליקוי 4): ההוצאה נשמרת רק במכשיר שהכניס – ביטול רק משם (המכשיר שולח את המזהה שלו; הנחה: קריאה בלי מזהה – כמו קודם)
    if (input.dev !== undefined && (!dev || (x.dev && x.dev !== dev))) throw pre('other-dev', 'אפשר לבטל רק במכשיר שבו החשבונית נכנסה');
    tx.update(ref, { st: 'new', hold: 'undo', el: false, why: [...new Set((x.why || []).concat(['hold']))], okAt: FieldValue.delete(), okBy: FieldValue.delete(), auto: FieldValue.delete(), purgeAt: FieldValue.delete(), by: FieldValue.delete(), dev: FieldValue.delete(), mode: FieldValue.delete(), clAt: FieldValue.delete() });
    after = { act: 'invUndo', x };
    return { ok: true };
  });
  if (after && after.act === 'invRelease') {
    await db.collection('sec_log').doc().set(ilog(uid, 'mgr', 'invRelease', { tgt: id, note: 'stale' }));
    await notify(db, 'rel|' + id + '|' + now, 'חשבונית חזרה לאישור ידני', 'חשבונית שנלקחה במכשיר אחר ולא הושלמה 24 שעות חזרה ל"ממתינה לאישור". ייתכן שהיא כבר נרשמה במכשיר ההוא – כדאי לבדוק לפני שמאשרים.', now);
    after = null;
  }
  if (r.deny) {
    if (r.el) await ref.update({ el: false, why: r.deny }).catch(() => {});
    await db.collection('sec_log').doc().set(ilog(uid, 'mgr', 'invAutoNo', { tgt: id, note: r.deny.join(',') }));
    throw new HttpsError('failed-precondition', 'החשבונית לא עומדת בתנאים להכנסה אוטומטית – היא ממתינה לאישור', { reason: 'not-eligible', why: r.deny });
  }
  if (op === 'claim') {
    if (!r.again) await db.collection('sec_log').doc().set(ilog(uid, 'mgr', 'invClaim', { tgt: id, note: mode }));
    return { ok: true, id, mode, item: outOf(id, Object.assign({}, r.x, { st: 'cl', by: uid, dev, clAt: now }), uid, now) };
  }
  if (after) {
    const x = after.x;
    await db.collection('sec_log').doc().set(ilog(uid, after.act === 'invAuto' ? 'auto' : 'mgr', after.act, { tgt: id, note: after.why || (x.sub ? 'sub=' + x.sub : '') }));
    // 36: נכנסה (גם אוטומטית) משולח חדש – סימון שנשאר + התראה, עם ביטול בלחיצה
    if (after.act === 'invAuto' && x.ns) await notify(db, 'ns|' + id, 'חשבונית משולח חדש', 'נכנסה חשבונית מספק ' + (x.subN || '') + ' משולח חדש: ' + show(x.ns) + ' – לבדוק. אפשר לבטל או לאשר את השולח במסך "חשבוניות שהתקבלו".', now);
    if (after.act === 'invHold' && after.why === 'dup') await notify(db, 'dup|' + id, 'חשד לחשבונית כפולה', 'חשבונית שהגיעה נראית כמו חשבונית שכבר רשומה. היא ממתינה לבדיקה שלך במסך "חשבוניות שהתקבלו".', now);
  }
  return Object.assign({ id, op }, r);
}

// =====================================================================================
// שמירה ומחיקה (9.5) – נקרא מ-secDaily: עותק בתור של חשבונית שאושרה / קובץ שנדחה נמחק 30 יום אחרי האישור/הדחייה.
// נשארת רשומה קטנה בלי הקובץ (purged), כדי שאותו קובץ שיגיע שוב לא ייכנס פעם שנייה. תפיסה שלא הושלמה 24 שעות – משתחררת עם התראה (4.7).
// לא נוגעים בשום נתון אחר – ההוצאה עצמה נשמרת במכשיר של המנהל.
// =====================================================================================
async function retention(db, now) {
  const out = { purged: 0, released: 0 };
  for (;;) {
    const s = await db.collection('sec_inv').where('purgeAt', '<', now).limit(100).get();
    if (s.empty) break;
    for (const d of s.docs) {
      const np = d.get('np') || 0;
      for (let k = 0; k < np; k += 400) { const b = db.batch(); for (let j = k; j < Math.min(np, k + 400); j++) b.delete(db.doc(`sec_inv/${d.id}/p/${j}`)); await b.commit(); }
      const extra = await db.collection(`sec_inv/${d.id}/p`).limit(50).get(); // ליתר ביטחון: חלקים שלא נספרו
      if (!extra.empty) { const b = db.batch(); extra.docs.forEach((p) => b.delete(p.ref)); await b.commit(); }
      await d.ref.update({ purged: true, purgeAt: FieldValue.delete(), np: 0, src: (d.get('src') || []).map((x) => ({ ch: x.ch, t: x.t || 0 })) });
      out.purged++;
    }
    if (s.size < 100) break;
  }
  const cl = await db.collection('sec_inv').where('st', '==', 'cl').limit(200).get();
  for (const d of cl.docs) {
    if (now - (d.get('clAt') || 0) <= SI.CLAIM_MS) continue;
    // תיקון 1 (ליקוי 1): ייתכן שנכנסה במכשיר שתפס – חוזרת רק לאישור ידני (לא זכאית שוב ל"נכנס ישר")
    await d.ref.update(Object.assign({ st: 'new', by: FieldValue.delete(), dev: FieldValue.delete(), mode: FieldValue.delete(), clAt: FieldValue.delete() }, RELEASED(d.data())));
    out.released++;
    await db.collection('sec_log').doc().set(ilog('', 'auto', 'invRelease', { tgt: d.id }));
    await notify(db, 'rel|' + d.id + '|' + now, 'חשבונית חזרה לתור', 'חשבונית שנלקחה להכנסה ולא הושלמה 24 שעות חזרה ל"ממתינה לאישור". כדאי לבדוק במסך "חשבוניות שהתקבלו" שהיא לא נכנסה כבר.', now);
  }
  return out;
}

exports.secInv = onCall(wrap('secInv', secInv));
exports.secDecide = onCall(wrap('secDecide', secDecide));
Object.defineProperty(exports, '_core', { enumerable: false, value: { ingest, work, workIn, secInv, secDecide, retention, SEC_SCAN_UID, readFile } });
