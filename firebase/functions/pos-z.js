'use strict';
// קופה (POS), ש5 – דוח X / Z. posZ({ op, … }).
//   Z = סכום המכירות (possale.gross, בלי מבוטלות) פחות סכום ההחזרות (posret.gross) – באגורות, מדויק לאגורה (pos-agg.zAgg).
//   posz/{dev}-Z{000001} = { id, dev, br, no, shift, cashier, z, n, sales, rets, nRet, voids, pay, retBy, bad, cash, counted, diff, note, at, by }
//   posdev.lastZ = מונה דוחות ה-Z של הקופה (בלי חורים ובלי כפילויות – בטרנזקציה).
//
//   op 'x',     { shift }                     → { rep } – דוח X: אותו חישוב, בלי לסגור (הקופאי של המשמרת / אחראי / מנהל).
//   op 'close', { shift, counted, note? }     → { id, no, rep, dup? } – דוח Z: סוגר את המשמרת. counted = המזומן שנספר במגירה (אגורות).
//                                               משמרת שכבר נסגרה – מחזיר את אותו Z (dup:true), לא יוצר שני.
// שגיאות: bad-op, bad-input, bad-amt, no-shift, not-yours, too-many.

const { onCall } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const AG = require('./lib/pos-agg');
const G = require('./lib/pos-gate');
const PCASH = require('./pos-cash')._core;

const zId = (dev, no) => dev + '-Z' + String(no).padStart(6, '0');

async function z(request) {
  const input = inputObject(request);
  if (!['x', 'close'].includes(input.op)) throw G.bad('bad-op', 'פעולה לא מוכרת');
  const { who, role, db } = await G.gate(request, { sell: true });
  if (typeof input.shift !== 'string' || !PCASH.SHIFT_RE.test(input.shift)) throw G.bad('bad-input', 'משמרת לא תקינה');
  const sref = db.doc('posshift/' + input.shift);
  const own = (sh) => { if (sh.cashier !== who.uid && role !== 'lead' && role !== 'manager') throw G.deny('not-yours', 'המשמרת של קופאי אחר'); };

  if (input.op === 'x') {
    const s = await sref.get();
    if (!s.exists) throw G.nf('no-shift', 'המשמרת לא נמצאה');
    own(s.data());
    const rep = AG.zReport(s.data(), await PCASH.shiftData(db, input.shift), null);
    return { ok: true, shift: input.shift, st: s.get('st'), rep };
  }

  if (!AG.isAg(input.counted)) throw G.bad('bad-amt', 'כתבו כמה מזומן נספר במגירה');
  const note = G.str(input.note, 200);
  const now = Date.now();
  let out;
  await G.runTx(db, async (tx) => {
    const s = await tx.get(sref);
    if (!s.exists) throw G.nf('no-shift', 'המשמרת לא נמצאה');
    const sh = s.data();
    own(sh);
    if (sh.st === 'closed') {
      const zs = sh.z ? await tx.get(db.doc('posz/' + sh.z)) : null;
      const zd = zs && zs.exists ? zs.data() : {};
      out = { ok: true, id: sh.z, no: zd.no, rep: zd, dup: true };
      return;
    }
    const dref = db.doc('posdev/' + sh.dev);
    const [d, agg] = await Promise.all([tx.get(dref), PCASH.shiftData(db, sh.id, tx)]);
    const rep = AG.zReport(sh, agg, input.counted);
    const no = (d.exists && Number.isInteger(d.get('lastZ')) ? d.get('lastZ') : 0) + 1;
    if (no > 999999) throw G.pre('too-many', 'מונה דוחות ה-Z מלא');
    const id = zId(sh.dev, no);
    const doc = Object.assign({ id, dev: sh.dev, br: sh.br || '_', no, shift: sh.id, cashier: sh.cashier, openAt: sh.openAt, note, at: now, by: who.uid }, rep);
    tx.create(db.doc('posz/' + id), doc);
    tx.update(sref, { st: 'closed', closeAt: now, closeBy: who.uid, z: id, counted: input.counted, expected: rep.cash.expected, diff: rep.diff });
    if (d.exists) tx.update(dref, Object.assign({ lastZ: no, upd: now }, d.get('shift') === sh.id ? { shift: null } : {}));
    if (rep.diff !== 0) tx.set(db.collection('poslog').doc(), { k: 'z-diff', z: id, shift: sh.id, diff: rep.diff, by: who.uid, at: now });
    out = { ok: true, id, no, rep: doc };
  });
  return out;
}

exports.posZ = onCall(G.wrap('posZ', z));
Object.defineProperty(exports, '_core', { enumerable: false, value: { z, zId, call: () => G.wrap('posZ', z) } });
