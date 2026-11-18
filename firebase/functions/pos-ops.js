'use strict';
// POS:M7 – קופה, ש7: תפעול מכשירים (17.11.2026). אפיון ד 3.2, 4, 5 (H18, O9, O13, O15, O17). כל כתיבה – רק מכאן (בכללים write: if false).
// פונקציה אחת עם op (כדי לא להוסיף שבע פונקציות לפרסום). השמות מהאפיון בסוגריים:
//   posOps({ op:'approve', dev })                      (posDevApprove)  מנהל: מאשר מכשיר שנרשם (posdev.appr). מכשיר לא מאושר – Devices.blocked()
//   posOps({ op:'kill', dev })                         (posDevKill)     מנהל: ניתוק מרחוק – on:false + kill{at,by}. posSale כבר דוחה קופה עם on:false (dev-off)
//   posOps({ op:'unkill', dev })                       מנהל: החזרה לשימוש – on:true, בלי kill, בלי inst ובלי appr: המכשיר נרשם מחדש ומחכה לאישור
//   posOps({ op:'hw', dev, inst, hwSt, qLen?, qOldest?, ver? })  (posHwStatus)  הקופה עצמה: מצב הציוד והתור, למנהל (posdev.hwSt, hwAt)
//   posOps({ op:'err', sev, code, msg, ctx?, dev?, ver? })       (posErrLog)     כל מי שמוכר: יומן תקלות poserr – טכני בלבד (מספרים ארוכים ומיילים נמחקים)
//   posOps({ op:'conf', id, pick:'a'|'b' })            (posConfResolve) מנהל: הכרעה בהתנגשות posconf
//   posOps({ op:'manual', dev, inst, realAt, why, lines, reqId }) (posManualSale) מנהל (manEntry:'mgr'): מכירה אחרי תקלה דרך posSale,
//                                                      עם soldAt = השעה האמיתית, ואחר כך possale.man{by,why,realAt}
// posOpsWatch (מתוזמן, כל 30 דקות): תור ישן מ-qStaleH שעות או ארוך מ-qWarnCnt, ותקלות חמורות שלא נשלחו → התראה (Push) לבעל העסק;
//   crit גם ל-"dev" (מפתח) – רק קוד, גרסה ומסך, בלי נתוני לקוחות (אפיון ד "פתוח" 6). כל התראה נרשמת ב-poslog (kind:'alert').
// בעל העסק: admins/{uid}.own === true. עסק שאף מנהל בו לא סומן own – כל המנהלים נחשבים בעלים (עד שמסמנים; ראו "פתוח").
// שגיאות (details.reason): כמו pos.js + bad-sev, no-conf, conf-done, bad-pick, man-off, not-owner, bad-why, bad-real.

const { HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, LEGACY_REGION } = require('./lib/region');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const CF = require('./lib/pos-cfg');
const K = require('./lib/pos-core');

// ברירות המחדל של ש7 (אפיון סופי פרק 2, "חומרה, בלי רשת וגיבוי"). ש4 מוסיף אותן לסכמה; עד אז – מכאן.
const M7_DEF = Object.freeze({ devApprove: true, manEntry: 'mgr', qWarnCnt: 20, qWarnMin: 30, qStaleH: 24, errReport: true, errNotify: ['owner', 'dev'],
  bkManual: 'mgr', restoreBy: 'owner', bkExt: 'monthly', bkAlert: ['owner'], hwStatusTo: 'mgr' });
const PRN = ['ok', 'low', 'paper', 'off', 'none'];
const DISP = ['ok', 'on', 'none'];
const SEV = ['info', 'err', 'crit'];
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const nf = (reason, msg) => new HttpsError('not-found', msg, { reason });
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const isSeller = (who) => who.role === 'manager' || hasPerm(who, 'pos') || hasPerm(who, 'posMgr');
// יומן התקלות טכני בלבד: מיילים ורצף ספרות ארוך (טלפון, כרטיס, ת"ז) נמחקים גם אם הגיעו מהמכשיר
const scrub = (v) => String(v == null ? '' : v).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[mail]').replace(/\d[\d\s-]{6,}\d/g, '[num]');

async function gate(request, o) {
  const who = await requireStaff(request);
  if (!who.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש');
  if (!who.superadmin) T.requireFeature(who.biz, 'pos');
  if (o && o.mgr && who.role !== 'manager') throw deny('not-manager', 'הפעולה זמינה למנהל בלבד');
  if (o && o.sell && !isSeller(who)) throw deny('not-pos', 'אין לך הרשאת קופה');
  return { who, db: T.tdb() };
}
// POS:W2 (איחוד גל 2): 9 המפתחות של ש7 כבר בסכמה של ש4 (lib/pos-cfg-schema.js) – הערך נקרא דרכה (poscfg/main + poscfg/sa)
let SCH = null;
try { SCH = require('./lib/pos-cfg-schema'); } catch (e) { SCH = null; }
async function cfgOf(db) {
  const s = await db.doc('poscfg/main').get();
  if (SCH && typeof SCH.eff === 'function') {
    const e = await require('./lib/pos-cfg-read').cfgOf(db);
    const c = Object.assign({}, M7_DEF);
    for (const k of Object.keys(M7_DEF)) if (e[k] !== undefined) c[k] = e[k];
    return c;
  }
  const e = CF.eff(s.exists ? s.data() : null);
  const c = Object.assign({}, M7_DEF);
  const raw = s.exists && s.get('v') && typeof s.get('v') === 'object' ? s.get('v') : {};
  for (const k of Object.keys(M7_DEF)) {
    if (e.cfg && e.cfg[k] !== undefined) c[k] = e.cfg[k];
    // עד שש4 מוסיף את המפתח לסכמה (CF.eff מתעלם ממפתח לא מוכר): ערך שמור מאותו סוג כמו ברירת המחדל
    else if (raw[k] !== undefined && Array.isArray(raw[k]) === Array.isArray(M7_DEF[k]) && typeof raw[k] === typeof M7_DEF[k]) c[k] = raw[k];
  }
  return c;
}
// בעלים: admins/{uid}.own. אין אף own בעסק – כל מנהל (לא מנהל־על שאינו מנהל בעסק)
async function isOwner(db, who) {
  if (who.role !== 'manager') return false;
  const ad = await db.collection('admins').get();
  const mine = ad.docs.find((d) => d.id === who.uid);
  if (!mine) return false;
  const owners = ad.docs.filter((d) => d.get('own') === true);
  return owners.length ? mine.get('own') === true : true;
}
async function ownerUids(db) {
  const ad = await db.collection('admins').get();
  const own = ad.docs.filter((d) => d.get('own') === true).map((d) => d.id);
  return own.length ? own : ad.docs.map((d) => d.id);
}
async function devRef(db, dev) {
  if (!K.isDev(dev)) throw bad('bad-dev', 'קוד קופה לא תקין');
  const ref = db.doc('posdev/' + dev);
  return ref;
}
const log = (tx, db, o) => tx.set(db.collection('poslog').doc(), Object.assign({ at: Date.now() }, o));

// ---------- מכשירים: אישור, ניתוק מרחוק, החזרה ----------
async function devOp(db, who, op, dev) {
  const ref = await devRef(db, dev);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw nf('no-dev', 'הקופה לא נמצאה');
    const d = s.data(), now = Date.now();
    if (d.st === 'retired') throw pre('retired', 'הקופה הוצאה משימוש');
    if (op === 'approve') {
      if (!d.inst) throw pre('no-inst', 'אין מכשיר רשום על הקופה הזו');
      if (d.kill) throw pre('dev-off', 'הקופה נותקה מרחוק. קודם "החזרה לשימוש"');
      tx.update(ref, { appr: { by: who.uid, at: now, inst: d.inst }, upd: now, updBy: who.uid });
    } else if (op === 'kill') {
      tx.update(ref, { on: false, kill: { at: now, by: who.uid }, upd: now, updBy: who.uid });
    } else {
      if (!d.kill) throw pre('not-killed', 'הקופה לא נותקה');
      // החזרה: המכשיר שנותק לא חוזר אוטומטית – נרשמים מחדש ומקבלים אישור
      const { FieldValue } = require('firebase-admin/firestore');
      tx.update(ref, { on: true, kill: FieldValue.delete(), inst: FieldValue.delete(), appr: FieldValue.delete(), upd: now, updBy: who.uid });
    }
    log(tx, db, { kind: 'dev', op, dev, by: who.uid });
  });
  return { ok: true, dev, op };
}

// ---------- מצב ציוד מהקופה ----------
async function hwOp(db, who, input) {
  if (!K.isInst(input.inst)) throw bad('bad-inst', 'מזהה מכשיר לא תקין');
  const ref = await devRef(db, input.dev);
  const h = input.hwSt && typeof input.hwSt === 'object' && !Array.isArray(input.hwSt) ? input.hwSt : {};
  const hwSt = { printer: PRN.includes(h.printer) ? h.printer : 'none', disp: DISP.includes(h.disp) ? h.disp : 'none', prnq: Number.isInteger(h.prnq) && h.prnq >= 0 ? Math.min(h.prnq, 999) : 0 };
  const now = Date.now();
  const up = { hwSt, hwAt: now };
  if (Number.isInteger(input.qLen) && input.qLen >= 0) up.qLen = Math.min(input.qLen, 100000);
  if (Number.isInteger(input.qOldest) && input.qOldest >= 0 && input.qOldest <= now + 60000) up.qOldest = input.qOldest;
  const ver = str(input.ver, 20);
  if (ver && /^[\w.-]+$/.test(ver)) up.ver = ver;
  const s = await ref.get();
  if (!s.exists) throw nf('no-dev', 'הקופה לא נמצאה');
  const d = s.data();
  if (d.st === 'retired') throw pre('retired', 'הקופה הוצאה משימוש');
  if (d.inst !== input.inst) throw pre('dev-taken', 'הקופה רשומה על מכשיר אחר');
  await ref.update(up);
  return { ok: true, at: now, on: d.on === true, kill: !!d.kill, appr: !!d.appr };
}

// ---------- יומן תקלות ----------
async function errOp(db, who, input) {
  const sev = input.sev == null ? 'err' : input.sev;
  if (!SEV.includes(sev)) throw bad('bad-sev', 'רמת תקלה לא תקינה');
  const code = str(input.code, 40).replace(/[^\w.:-]/g, '') || 'ERR';
  const msg = scrub(str(input.msg, 300));
  const ctx = {};
  if (input.ctx && typeof input.ctx === 'object' && !Array.isArray(input.ctx)) {
    let n = 0;
    for (const [k, v] of Object.entries(input.ctx)) {
      if (n >= 12 || !/^[A-Za-z]\w{0,30}$/.test(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v)) ctx[k] = v;
      else if (typeof v === 'boolean') ctx[k] = v;
      else if (typeof v === 'string') ctx[k] = scrub(v).slice(0, 120);
      else continue;
      n++;
    }
  }
  const doc = { sev, code, msg, ctx, at: Date.now(), by: who.uid, sent: sev === 'crit' ? false : true };
  if (input.dev != null) { if (!K.isDev(input.dev)) throw bad('bad-dev', 'קוד קופה לא תקין'); doc.dev = input.dev; }
  const ver = str(input.ver, 20);
  if (ver && /^[\w.-]+$/.test(ver)) doc.ver = ver;
  const ref = db.collection('poserr').doc();
  await ref.set(doc);
  return { ok: true, id: ref.id };
}

// ---------- התנגשויות ----------
async function confOp(db, who, input) {
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.id)) throw bad('bad-input', 'קלט לא תקין');
  if (!['a', 'b'].includes(input.pick)) throw bad('bad-pick', 'בחירה לא תקינה');
  const ref = db.doc('posconf/' + input.id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw nf('no-conf', 'ההתנגשות לא נמצאה');
    if (s.get('st') !== 'open') throw pre('conf-done', 'כבר הוכרע');
    const now = Date.now();
    tx.update(ref, { st: 'done', dec: { by: who.uid, val: input.pick, at: now } });
    log(tx, db, { kind: 'conf', id: input.id, pick: input.pick, by: who.uid });
  });
  return { ok: true, id: input.id, pick: input.pick };
}

// ---------- הזנה ידנית אחרי תקלה ----------
async function manualOp(request, db, who, input, cfg) {
  if (cfg.manEntry === 'off' || cfg.manEntry === 'none') throw pre('man-off', 'הזנה ידנית כבויה בעסק הזה'); // POS:W2: בסכמה של ש4 כבוי = 'none'
  const why = str(input.why, 200);
  if (!why) throw bad('bad-why', 'חסרה סיבה');
  const now = Date.now();
  if (!K.soldAtOk(input.realAt, now)) throw bad('bad-real', 'שעת המכירה לא תקינה');
  const PS = require('./pos')._core;
  // אותו מסלול בדיוק כמו מכירה רגילה: מספור, reqId נגד כפילות, חישוב בשרת
  const sub = { auth: request.auth, data: { reqId: input.reqId, dev: input.dev, inst: input.inst, lines: input.lines, soldAt: input.realAt } };
  const r = await PS.saleIn(sub);
  const ref = db.doc('possale/' + r.id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw nf('no-sale', 'המכירה לא נמצאה');
    if (!s.get('man')) tx.update(ref, { man: { by: who.uid, why, realAt: input.realAt, at: now } });
    if (!r.dup) log(tx, db, { kind: 'manual', sale: r.id, by: who.uid });
  });
  return { ok: true, id: r.id, seq: r.seq, gross: r.gross, dup: !!r.dup };
}

async function ops(request) {
  const input = inputObject(request);
  const op = input.op;
  const OPS = ['approve', 'kill', 'unkill', 'hw', 'err', 'conf', 'manual'];
  if (!OPS.includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  const mgrOps = ['approve', 'kill', 'unkill', 'conf', 'manual'];
  const { who, db } = await gate(request, mgrOps.includes(op) ? { mgr: true } : { sell: true });
  if (op === 'hw') return hwOp(db, who, input);
  if (op === 'err') return errOp(db, who, input);
  if (op === 'conf') return confOp(db, who, input);
  if (op === 'manual') return manualOp(request, db, who, input, await cfgOf(db));
  return devOp(db, who, op, input.dev);
}

// ---------- מעקב מתוזמן: תור ישן/ארוך, תקלות חמורות ----------
// opts.send(tokens, msg) – מדומה בבדיקות. מחזיר כמה התראות נשלחו לעסק.
async function watchBiz(db, now, opts) {
  const cfg = await cfgOf(db);
  const alerts = [];
  const devs = await db.collection('posdev').get();
  for (const d of devs.docs) {
    const x = d.data();
    if (x.st === 'retired' || x.on !== true) continue;
    const q = Number.isInteger(x.qLen) ? x.qLen : 0;
    const old = Number.isInteger(x.qOldest) ? x.qOldest : 0;
    if (q >= cfg.qWarnCnt) alerts.push({ key: 'q|' + d.id + '|' + Math.floor(now / 864e5), title: 'מכירות ממתינות בקופה', body: `בקופה ${x.name || d.id} יש ${q} מכירות שעוד לא נשלחו לענן. בדקו את חיבור האינטרנט.` });
    if (q > 0 && old && now - old > cfg.qStaleH * 3600e3) alerts.push({ key: 'old|' + d.id + '|' + Math.floor(now / 864e5), title: 'מכירה ממתינה יותר מיום', body: `בקופה ${x.name || d.id} יש מכירה שממתינה לשליחה יותר מ-${cfg.qStaleH} שעות.` });
  }
  const crit = await db.collection('poserr').where('sent', '==', false).limit(20).get();
  for (const e of crit.docs) alerts.push({ key: 'err|' + e.id, title: 'תקלה חמורה בקופה', body: `קוד ${e.get('code') || ''}${e.get('dev') ? ', קופה ' + e.get('dev') : ''}. פרטים ביומן התקלות באזור הניהול.`, err: e.ref, dev: true });
  if (!alerts.length) return 0;
  const owners = await ownerUids(db);
  let sent = 0;
  for (const a of alerts) {
    // פעם אחת לכל מפתח (poslog עם מזהה קבוע)
    const mark = db.doc('poslog/alert_' + require('node:crypto').createHash('sha256').update(a.key).digest('hex').slice(0, 24));
    const fresh = await db.runTransaction(async (tx) => { const s = await tx.get(mark); if (s.exists) return false; tx.set(mark, { kind: 'alert', key: a.key.slice(0, 200), title: a.title, at: now }); return true; });
    if (a.err) await a.err.update({ sent: true }).catch(() => {});
    if (!fresh) continue;
    const to = owners.slice();
    if (a.dev && Array.isArray(cfg.errNotify) && cfg.errNotify.includes('dev')) logger.error('pos: critical error', { key: a.key }); // "למפתח": יומן השרת – רק קוד, בלי נתונים
    if (Array.isArray(cfg.errNotify) && !cfg.errNotify.includes('owner') && a.dev) continue;
    sent += await pushTo(db, to, { id: a.key.slice(0, 60), title: a.title, body: a.body }, opts);
  }
  return sent;
}
async function fcmSend(tokens, msg) {
  const { getMessaging } = require('firebase-admin/messaging');
  const RM = require('./secretary-remind')._core;
  const r = await getMessaging().sendEachForMulticast({ tokens, notification: { title: msg.title, body: msg.body }, data: { k: 'pos', id: String(msg.id) }, android: RM.androidOf('pos_' + msg.id) });
  return r.responses.map((x, i) => ({ token: tokens[i], ok: x.success, code: x.error && x.error.code }));
}
async function pushTo(db, uids, msg, opts) {
  const RM = require('./secretary-remind')._core;
  let n = 0;
  for (const u of [...new Set(uids)].slice(0, 20)) {
    try {
      const toks = await RM.tokensOf(db, u);
      if (!toks.length) continue;
      const res = await ((opts && opts.send) || fcmSend)(toks, msg);
      if (res.some((x) => x.ok)) n++;
    } catch (e) { logger.warn('pos-ops: push failed', { name: e && e.name, code: e && e.code }); }
  }
  return n;
}
async function watchAll(opts) {
  const now = Date.now();
  let total = 0;
  for (const biz of await T.bizzesWith('pos')) {
    if (T.bizPrefix(biz) === '') continue; // legacy – הקופה רק במבנה b/
    try { total += await T.runInBiz({ bizId: biz.bizId, prefix: T.bizPrefix(biz), biz }, () => watchBiz(T.tdb(), now, opts)); } catch (e) { logger.warn('pos-ops: watch failed', { bizId: biz.bizId, name: e && e.name }); }
  }
  return total;
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`pos-ops: ${name} failed`, { name: e && e.name, code: e && e.code, msg: String(e && e.message || '').slice(0, 300) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

exports.posOps = onCall(wrap('posOps', ops));
exports.posOpsWatch = onSchedule({ region: LEGACY_REGION, schedule: 'every 30 minutes', timeZone: 'Asia/Jerusalem', timeoutSeconds: 300, memory: '256MiB' }, async () => { await watchAll(); });

Object.defineProperty(exports, '_core', { enumerable: false, value: {
  ops, watchBiz, watchAll, isOwner, ownerUids, cfgOf, scrub, M7_DEF, gate,
  call: { posOps: () => wrap('posOps', ops) },
} });
