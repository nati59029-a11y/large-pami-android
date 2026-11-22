'use strict';
// קופה (POS), ש5 – שעון נוכחות. posClock({ op, … }).
//   posclock/{uid}_{in} = { who, name, in, out: null | זמן, day (YYYYMMDD, שעון ישראל), dev, br, by, fix?: [{ in, out, by, at, note }] }
//   כניסה פתוחה אחת לכל עובד. כלל הקריאה (שלב 0): מנהל – הכול; עובד – רק שלו (who).
//
//   op 'in' | 'out', { uid?, pin?, dev? }  → { id, in, out?, min? } – החתמה. בלי uid – המתחבר עצמו.
//                                          uid של עובד אחר (מסך קופה משותף) – חובה pin של אותו עובד (נעילה אחרי 5 שגויים, כמו בכל מקום).
//                                          כניסה מאוחרת ממשמרת היום (shifts.js posLate) → התראה למנהל, פעם ביום לעובד (גם מול כספית).
//   op 'status', { uid? }                  → { open: null | { id, in } } – לעצמי; לעובד אחר – אחראי / מנהל.
//   op 'list',  { from, to, uid? }         → { recs, sum } – מנהל: רשומות בטווח (עד 62 יום) וסיכום דקות לכל עובד.
//   op 'fix',   { id, in?, out?, note }    → { ok } – מנהל: תיקון החתמה (הערך הקודם נשמר ב-fix, ונרשם ב-poslog).
// שגיאות: bad-op, bad-input, bad-time, clocked-in, not-in, no-rec, no-user, not-manager, not-lead, + שגיאות PIN.

const logger = require('firebase-functions/logger');
const { onCall } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const AG = require('./lib/pos-agg');
const G = require('./lib/pos-gate');

const RANGE_MAX = 62 * AG.DAY_MS;
const ID_RE = /^[A-Za-z0-9_-]{1,128}_[0-9]{13}$/;

async function clock(request) {
  const input = inputObject(request);
  const op = input.op;
  if (!['in', 'out', 'status', 'list', 'fix'].includes(op)) throw G.bad('bad-op', 'פעולה לא מוכרת');
  if (op === 'list') return list(request, input);
  if (op === 'fix') return fix(request, input);
  const { who, role, db } = await G.gate(request, { sell: true });
  const uid = input.uid == null ? who.uid : input.uid;
  if (typeof uid !== 'string' || !G.UID_RE.test(uid)) throw G.bad('bad-input', 'עובד לא תקין');
  const other = uid !== who.uid;
  const openQ = db.collection('posclock').where('who', '==', uid).where('out', '==', null).limit(1);

  if (op === 'status') {
    if (other && role !== 'lead' && role !== 'manager') throw G.deny('not-lead', 'הפעולה זמינה לאחראי משמרת או למנהל');
    const s = await openQ.get();
    return { ok: true, open: s.empty ? null : { id: s.docs[0].id, in: s.docs[0].get('in') } };
  }

  const x = other ? await G.roleOfUid(db, uid) : { role, name: (who.staff && who.staff.exists && who.staff.get('name')) || '' };
  if (!x.role) throw G.nf('no-user', 'העובד לא נמצא או שאין לו הרשאת קופה');
  if (other && typeof input.pin !== 'string') throw G.bad('bad-pin', 'כתבו את הקוד של העובד');
  const dev = G.K.isDev(input.dev) ? input.dev : null;
  const now = Date.now();
  let out, r = null;
  await G.runTx(db, async (tx) => {
    r = null;
    if (other) {
      r = await G.pinTx(tx, db, uid, input.pin, now);
      if (!r.ok) { G.pinWrite(tx, db, r, who, uid, now, dev); return; }
    }
    const s = await tx.get(openQ);
    if (r) G.pinWrite(tx, db, r, who, uid, now, dev);
    if (op === 'in') {
      if (!s.empty) throw G.pre('clocked-in', 'כבר החתמת כניסה. החתימו יציאה קודם');
      const id = uid + '_' + now;
      tx.create(db.doc('posclock/' + id), { who: uid, name: x.name || '', in: now, out: null, day: AG.dayOf(now), dev, br: x.br && typeof x.br === 'string' ? x.br : null, by: who.uid });
      out = { ok: true, id, in: now };
      return;
    }
    if (s.empty) throw G.pre('not-in', 'אין החתמת כניסה פתוחה');
    const d = s.docs[0];
    tx.update(d.ref, { out: now, outBy: who.uid });
    out = { ok: true, id: d.id, in: d.get('in'), out: now, min: AG.clockMin({ in: d.get('in'), out: now }, now).min };
  });
  if (r && !r.ok) { await G.pinAlert(db, who, uid, r); G.pinThrow(r); }
  // התראת איחור למנהל (shifts.js posLate – אותו רישום כפילויות כמו בכספית, shfsent/{day}.late). תקלה כאן לא מפילה את ההחתמה
  if (op === 'in' && out) {
    const send = G.O.send ? async (t, m, meta) => { await G.O.send(t, m, meta); return t.map((token) => ({ token, ok: true })); } : undefined;
    try { await require('./shifts')._core.posLate(uid, now, send ? { send } : {}); } catch (e) { logger.warn('posClock: late check failed', { name: e && e.name, code: e && e.code }); }
  }
  return out;
}

async function list(request, input) {
  const { db } = await G.gate(request, { mgr: true });
  const { from, to } = input;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || to - from > RANGE_MAX) throw G.bad('bad-time', 'טווח תאריכים לא תקין (עד 62 יום)');
  let q = db.collection('posclock').where('in', '>=', from).where('in', '<', to).orderBy('in', 'asc').limit(3000);
  const s = await q.get();
  let recs = s.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  if (typeof input.uid === 'string') recs = recs.filter((x) => x.who === input.uid);
  const now = Date.now();
  return { ok: true, recs: recs.map((x) => Object.assign(x, AG.clockMin(x, now))), sum: AG.clockSum(recs, now) };
}

async function fix(request, input) {
  const { who, db } = await G.gate(request, { mgr: true });
  if (typeof input.id !== 'string' || !ID_RE.test(input.id)) throw G.bad('bad-input', 'רשומה לא תקינה');
  const note = G.str(input.note, 200);
  if (!note) throw G.bad('bad-input', 'כתבו סיבה לתיקון');
  const now = Date.now();
  await G.runTx(db, async (tx) => {
    const ref = db.doc('posclock/' + input.id);
    const s = await tx.get(ref);
    if (!s.exists) throw G.nf('no-rec', 'הרשומה לא נמצאה');
    const d = s.data();
    const nin = input.in == null ? d.in : input.in, nout = input.out === undefined ? d.out : input.out;
    if (!Number.isInteger(nin) || (nout !== null && !Number.isInteger(nout)) || (nout !== null && nout <= nin) || nin > now + 60000 || (nout !== null && nout > now + 60000) || (nout !== null && nout - nin > 24 * 3600 * 1000)) {
      throw G.bad('bad-time', 'שעות לא תקינות');
    }
    const prev = Array.isArray(d.fix) ? d.fix : [];
    tx.update(ref, { in: nin, out: nout, day: AG.dayOf(nin), fix: prev.concat([{ in: d.in, out: d.out, by: who.uid, at: now, note }]).slice(-20) });
    tx.set(db.collection('poslog').doc(), { k: 'clock-fix', id: input.id, uid: d.who, from: { in: d.in, out: d.out }, to: { in: nin, out: nout }, note, by: who.uid, at: now });
  });
  return { ok: true };
}

exports.posClock = onCall(G.wrap('posClock', clock));
Object.defineProperty(exports, '_core', { enumerable: false, value: { clock, call: () => G.wrap('posClock', clock) } });
