'use strict';
// קופה (POS), ש5 – משמרת, מזומן ומגירה. posCash({ op, … }).
//   posshift/{dev}-S{000001} = { id, dev, br, no, cashier, st: 'open'|'closed', open, mv: [{ k, a, note, by, at }], ack, openAt, by, closeAt?, z? }
//   posdev.shift = המשמרת הפתוחה (אחת לכל קופה), posdev.lastShift = מונה המשמרות של הקופה.
//
//   op 'open',  { dev, inst, open? }       → { shift, no, open } – פתיחת משמרת. open = מזומן בפתיחה (ברירת מחדל: openCashDef מ-PosCfg).
//                                            המגירה נפתחת במכשיר (Devices.openDrawer) אחרי תשובה מוצלחת.
//   op 'mv',    { shift, k, a, note? }     → { mv, cash, cap } – תנועה במגירה: in (הכנסה), out (הוצאה – חובה הערה), drop (הפקדה).
//                                            הוצאה / הפקדה של יותר ממה שיש במגירה – no-cash.
//   op 'state', { shift }                  → { cash, cap } – כמה מזומן אמור להיות, והאם מעל תקרת המזומן (cashMax).
//   op 'ack',   { shift }                  → { ok, acked } – הקופאי מאשר את אזהרת התקרה (עד הסכום הנוכחי). נרשם ב-poslog.
//   op 'list',  { st? }                    → { shifts } – אחראי משמרת / מנהל: 50 המשמרות האחרונות (פתוחות קודם).
// מי: הקופאי של המשמרת, או אחראי משמרת / מנהל.
// cap = { over, warn, by }: warn = מעל התקרה ועוד לא אושר בסכום הזה – הקופה מציגה אזהרה, והקופאי מאשר (op 'ack').
// שגיאות: bad-op, bad-input, bad-dev, bad-inst, no-dev, dev-off, retired, dev-taken, shift-open, no-shift, shift-closed, not-yours,
//   bad-amt, bad-note, no-cash, too-many.

const { onCall } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const CF = require('./lib/pos-cfg');
const AG = require('./lib/pos-agg');
const G = require('./lib/pos-gate');

const SHIFT_RE = /^K[1-9][0-9]{0,3}-S[0-9]{6}$/;
const shiftId = (dev, no) => dev + '-S' + String(no).padStart(6, '0');

// POS:W2 (איחוד גל 2): לפי הסכמה של ש4 (גם הפורמט של שלב 0 נקרא) – lib/pos-cfg-read.js
async function cfgOf(db) { return require('./lib/pos-cfg-read').cfgOf(db); }

// הרשומות של המשמרת (מכירות, תשלומים, החזרות – צורת ש2). tx – אופציונלי
async function shiftData(db, id, tx) {
  const q = (c) => db.collection(c).where('shift', '==', id);
  const get = (x) => (tx ? tx.get(x) : x.get());
  const [s, p, r] = await Promise.all([get(q('possale')), get(q('pospay')), get(q('posret'))]);
  return AG.zAgg(s.docs.map((d) => Object.assign({ id: d.id }, d.data())), p.docs.map((d) => d.data()), r.docs.map((d) => d.data()));
}
function mine(sh, who, role) {
  if (sh.cashier !== who.uid && role !== 'lead' && role !== 'manager') throw G.deny('not-yours', 'המשמרת של קופאי אחר');
}
async function loadShift(db, input, tx) {
  if (typeof input.shift !== 'string' || !SHIFT_RE.test(input.shift)) throw G.bad('bad-input', 'משמרת לא תקינה');
  const s = await (tx ? tx.get(db.doc('posshift/' + input.shift)) : db.doc('posshift/' + input.shift).get());
  if (!s.exists) throw G.nf('no-shift', 'המשמרת לא נמצאה');
  return s.data();
}

async function cash(request) {
  const input = inputObject(request);
  const op = input.op;
  if (!['open', 'mv', 'state', 'ack', 'list'].includes(op)) throw G.bad('bad-op', 'פעולה לא מוכרת');
  if (op === 'list') return list(request, input);
  const { who, role, db } = await G.gate(request, { sell: true });
  const cfg = await cfgOf(db);
  const now = Date.now();

  if (op === 'open') {
    if (!G.K.isDev(input.dev)) throw G.bad('bad-dev', 'קוד קופה לא תקין');
    if (!G.K.isInst(input.inst)) throw G.bad('bad-inst', 'מזהה מכשיר לא תקין');
    const open = input.open == null ? cfg.openCashDef : input.open;
    if (!AG.isAg(open)) throw G.bad('bad-amt', 'סכום הפתיחה לא תקין');
    const dref = db.doc('posdev/' + input.dev);
    let out;
    await G.runTx(db, async (tx) => {
      const s = await tx.get(dref);
      const d = s.exists ? s.data() : null;
      G.devOk(d, input.inst);
      if (d.shift) throw G.pre('shift-open', 'כבר יש משמרת פתוחה בקופה הזו. סגרו אותה (דוח Z) קודם');
      const no = (Number.isInteger(d.lastShift) ? d.lastShift : 0) + 1;
      if (no > 999999) throw G.pre('too-many', 'מונה המשמרות מלא');
      const id = shiftId(input.dev, no);
      tx.create(db.doc('posshift/' + id), { id, dev: input.dev, br: d.br || '_', no, cashier: who.uid, st: 'open', open, mv: [], ack: 0, openAt: now, by: who.uid });
      tx.update(dref, { shift: id, lastShift: no, upd: now });
      out = { ok: true, shift: id, no, open };
    });
    return out;
  }

  if (op === 'mv') {
    let m;
    try { m = AG.mvIn(input.k, input.a, input.note); } catch (e) { throw G.aggErr(e); }
    let out;
    await G.runTx(db, async (tx) => {
      const sh = await loadShift(db, input, tx);
      mine(sh, who, role);
      if (sh.st !== 'open') throw G.pre('shift-closed', 'המשמרת כבר נסגרה');
      const mv = Array.isArray(sh.mv) ? sh.mv.slice() : [];
      if (mv.length >= AG.MV_MAX) throw G.pre('too-many', 'יותר מדי תנועות במשמרת');
      const agg = await shiftData(db, sh.id, tx);
      const rec = Object.assign({}, m, { by: who.uid, at: now });
      const next = Object.assign({}, sh, { mv: mv.concat([rec]) });
      const c = AG.cashExpected(next, agg);
      if (c.expected < 0) throw G.pre('no-cash', 'אין מספיק מזומן במגירה');
      tx.update(db.doc('posshift/' + sh.id), { mv: next.mv });
      if (m.k !== 'in') tx.set(db.collection('poslog').doc(), { k: 'cash-' + m.k, shift: sh.id, a: m.a, note: m.note, by: who.uid, at: now });
      out = { ok: true, mv: rec, cash: c, cap: AG.overCap(c.expected, cfg.cashMax, sh.ack) };
    });
    return out;
  }

  if (op === 'state') {
    const sh = await loadShift(db, input);
    mine(sh, who, role);
    const c = AG.cashExpected(sh, await shiftData(db, sh.id));
    return { ok: true, shift: sh.id, st: sh.st, cash: c, cap: AG.overCap(c.expected, cfg.cashMax, sh.ack), cashMax: cfg.cashMax };
  }

  // ack
  let acked;
  await G.runTx(db, async (tx) => {
    const sh = await loadShift(db, input, tx);
    mine(sh, who, role);
    if (sh.st !== 'open') throw G.pre('shift-closed', 'המשמרת כבר נסגרה');
    const c = AG.cashExpected(sh, await shiftData(db, sh.id, tx));
    acked = c.expected;
    tx.update(db.doc('posshift/' + sh.id), { ack: acked, ackAt: now, ackBy: who.uid });
    tx.set(db.collection('poslog').doc(), { k: 'cash-over-ack', shift: sh.id, a: acked, max: cfg.cashMax, by: who.uid, at: now });
  });
  return { ok: true, acked };
}

async function list(request, input) {
  const { db } = await G.gate(request, { lead: true });
  // בלי where + orderBy על שדות שונים (דורש אינדקס מורכב) – סינון בזיכרון
  const s = await db.collection('posshift').orderBy('openAt', 'desc').limit(200).get();
  const st = input.st === 'open' || input.st === 'closed' ? input.st : null;
  const shifts = s.docs.filter((d) => !st || d.get('st') === st).slice(0, 50).map((d) => { const x = d.data(); return { id: d.id, dev: x.dev, br: x.br, no: x.no, cashier: x.cashier, st: x.st, open: x.open, openAt: x.openAt, closeAt: x.closeAt || null, z: x.z || null, nMv: (x.mv || []).length }; });
  shifts.sort((a, b) => (a.st === b.st ? b.openAt - a.openAt : a.st === 'open' ? -1 : 1));
  return { ok: true, shifts };
}

exports.posCash = onCall(G.wrap('posCash', cash));
Object.defineProperty(exports, '_core', { enumerable: false, value: { cash, shiftData, shiftId, SHIFT_RE, call: () => G.wrap('posCash', cash) } });
