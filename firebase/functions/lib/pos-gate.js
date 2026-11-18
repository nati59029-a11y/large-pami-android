'use strict';
// קופה (POS), ש5 – עזרים משותפים לפונקציות המשמרת (pos-auth / pos-cash / pos-z / pos-clock): שער הרשאות, שגיאות, טרנזקציה, אימות PIN, התראה למנהל.
// אותם כללים כמו pos.js (שלב 0): רק עסק b/{bizId}, התוספת 'pos' דלוקה, וכל כתיבה מהשרת בלבד.
// תפקיד בקופה (roleOf): 'manager' (מנהל / מנהל־על = "בעלים"), 'lead' (posMgr – אחראי משמרת), 'cashier' (pos), או null.

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { requireStaff, hasPerm } = require('./roles');
const T = require('./tenant');
const AG = require('./pos-agg');
const K = require('./pos-core');

const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const nf = (reason, msg) => new HttpsError('not-found', msg, { reason });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
// שגיאה מ-pos-agg (e.reason) → HttpsError
const aggErr = (e) => (e && e.reason && !(e instanceof HttpsError) ? bad(e.reason, e.message) : e);

function roleOf(who) {
  if (who.role === 'manager') return 'manager';
  if (hasPerm(who, 'posMgr')) return 'lead';
  if (hasPerm(who, 'pos')) return 'cashier';
  return null;
}
// o.sell – כל מי שבקופה; o.lead – אחראי משמרת או מנהל; o.mgr – מנהל בלבד
async function gate(request, o) {
  const who = await requireStaff(request);
  if (!who.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש');
  if (!who.superadmin) T.requireFeature(who.biz, 'pos');
  const role = roleOf(who);
  if (o && o.mgr && role !== 'manager') throw deny('not-manager', 'הפעולה זמינה למנהל בלבד');
  if (o && o.lead && role !== 'manager' && role !== 'lead') throw deny('not-lead', 'הפעולה זמינה לאחראי משמרת או למנהל');
  if (o && o.sell && !role) throw deny('not-pos', 'אין לך הרשאת קופה');
  return { who, role, db: T.tdb() };
}

const TX = { maxAttempts: 5 };
async function runTx(db, fn) {
  for (let i = 0; ; i++) {
    try { return await db.runTransaction(fn, TX); } catch (e) {
      const retry = !(e instanceof HttpsError) && e && (e.code === 10 || /ABORTED|contention|maximum number of retries/i.test(String(e.message || '')));
      if (i >= 20 || !retry) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 200)));
    }
  }
}

// תפקיד של עובד אחר (לפי uid): מנהל = admins/{uid}; אחרת staff/{uid} פעיל עם perms
async function roleOfUid(db, uid) {
  const [a, s] = await Promise.all([db.doc('admins/' + uid).get(), db.doc('staff/' + uid).get()]);
  if (a.exists) return { role: 'manager', name: (s.exists && s.get('name')) || a.get('name') || a.get('email') || '' };
  if (!s.exists || s.get('active') !== true) return { role: null, name: '' };
  return { role: roleOf({ role: 'employee', staff: s }), name: s.get('name') || '', br: s.get('br') };
}

// ---------- התראה למנהל (FCM + poslog). בבדיקות – O.send מדומה ----------
const O = { send: null };
async function alertMgrs(db, who, title, body, id) {
  try {
    const s = await db.collection('admins').limit(20).get();
    const RM = require('../secretary-remind')._core;
    for (const d of s.docs) {
      const toks = await RM.tokensOf(db, d.id);
      if (!toks.length) continue;
      const msg = { id, title, body };
      if (O.send) { await O.send(toks, msg, { uid: d.id, bizId: who.bizId }); continue; }
      const { getMessaging } = require('firebase-admin/messaging');
      const r = await getMessaging().sendEachForMulticast({ tokens: toks, notification: { title, body }, data: { k: 'pos', id: String(id) }, android: RM.androidOf('pos_' + id) });
      await RM.dropTokens(db, d.id, r.responses.map((x, i) => (!x.success && RM.BAD_TOKEN.includes(x.error && x.error.code) ? toks[i] : null)).filter(Boolean));
    }
  } catch (e) {
    logger.warn('pos: alert failed', { bizId: who.bizId, name: e && e.name, code: e && e.code });
  }
}

// אימות PIN של uid בתוך טרנזקציה, עם נעילה אחרי 5 שגויים. → { ok, wait?, alert }
// קוראים לה לפני כל כתיבה בטרנזקציה (ב-Firestore כל הקריאות קודמות לכתיבות). ניסיון שגוי לא זורק בתוך הטרנזקציה – אחרת המונה לא נשמר:
// הקורא כותב (pinWrite), מסיים את הטרנזקציה בלי פעולות נוספות, ורק אחריה זורק (pinThrow).
async function pinTx(tx, db, uid, pin, now) {
  const ref = db.doc('pospin/' + uid);
  const s = await tx.get(ref);
  const rec = s.exists ? s.data() : null;
  if (!rec || !rec.h) return { ok: false, why: 'no-pin', ref, rec };
  const ls = AG.lockState(rec, now);
  if (ls.locked) return { ok: false, why: 'pin-locked', wait: ls.wait, ref, rec };
  const ok = AG.pinMatch(pin, rec);
  const nx = AG.pinAfter(rec, ok, now);
  return { ok, why: ok ? null : nx.alert ? 'pin-locked' : 'bad-pin', wait: nx.alert ? Math.ceil(AG.PIN_LOCK_MS / 1000) : 0, alert: nx.alert, ref, rec,
    write: { fails: nx.fails, lockUntil: nx.lockUntil, upd: now }, left: ok || nx.alert ? 0 : AG.PIN_MAX_FAILS - nx.fails };
}
// אחרי pinTx: כותב את מצב הנעילה, ובנעילה – רשומה ביומן (ההתראה נשלחת אחרי הטרנזקציה)
function pinWrite(tx, db, r, who, uid, now, dev) {
  if (r.write) tx.set(r.ref, r.write, { merge: true });
  if (r.alert) tx.set(db.collection('poslog').doc(), { k: 'pin-lock', uid, by: who.uid, dev: dev || null, at: now });
}
function pinThrow(r) {
  if (r.ok) return;
  if (r.why === 'no-pin') throw pre('no-pin', 'לעובד עדיין אין קוד PIN');
  if (r.why === 'pin-locked') throw pre('pin-locked', `יותר מדי ניסיונות. נסו שוב בעוד ${r.wait} שניות`);
  throw deny('bad-pin', `קוד שגוי. נותרו ${r.left} ניסיונות`);
}
async function pinAlert(db, who, uid, r) {
  if (!r || !r.alert) return;
  const x = await roleOfUid(db, uid);
  await alertMgrs(db, who, 'קופה – נעילת קוד', `5 ניסיונות שגויים לקוד של ${x.name || 'עובד'}. הקופה ננעלה ל-30 שניות.`, 'pin_' + uid + '_' + Date.now());
}

// מכשיר הקופה: קיים, פעיל, רשום על המכשיר הזה
function devOk(d, inst) {
  if (!d) throw nf('no-dev', 'הקופה לא נמצאה');
  if (d.st === 'retired') throw pre('retired', 'הקופה הוצאה משימוש');
  if (d.on !== true) throw pre('dev-off', 'הקופה מושבתת');
  if (!d.inst || d.inst !== inst) throw pre('dev-taken', 'המכשיר לא רשום על הקופה הזו');
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e && e.reason) throw aggErr(e);
    logger.error(`pos: ${name} failed`, { name: e && e.name, code: e && e.code, msg: String(e && e.message || '').slice(0, 300) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

module.exports = { deny, pre, bad, nf, str, UID_RE, aggErr, roleOf, roleOfUid, gate, runTx, alertMgrs, O, pinTx, pinWrite, pinThrow, pinAlert, devOk, wrap, K };
