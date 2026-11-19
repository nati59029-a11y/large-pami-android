'use strict';
// קופה ש6 (POS:M6) – ספריית מלאי וברקודים משותפת לשרת (ש2 – מכירה/החזרה, ש6 – ספירה, ייבוא, הוספה מהירה). בלי onCall.
//   WHY       – ערכי stockLog.why: הקיימים (in/set/zero/order/xout/xin/cancel/edit) + של הקופה (pos/posret) + חדשים מאפיון א 4
//               (rcv, rtv, cnt, make, use, fix, undo, dmg). תוספת בלבד: הקוד הקיים (orders.js, pricing.js) לא משתנה.
//   move(tx, db, m)   – תנועת מלאי אחת בתוך טרנזקציה (אחרי כל הקריאות): prod.q[br] += delta ורשומה ב-stockLog.
//                       m = { pid, br, delta, why, by, name?, ref?, note? }. delta 0 – לא כותב כלום.
//   codesOf(p)        – כל הברקודים של מוצר: barcode + bcs[] + packs[].bc (P19, B8)
//   bcTaken(get, db, codes, selfId) – אילו מהברקודים כבר שייכים למוצר אחר: באינדקס posbc, ובמוצרים (barcode / bcs) שעוד לא באינדקס.
//                       get = (ref|query) => snapshot (tx.get או ref.get). מחזיר [{ bc, pid }].
//   bcIndex(tx, db, pid, codes, packs) – כתיבת האינדקס posbc/{bc} = { pid, t:'main'|'alt'|'pack', qty? }
//   prodFlags(p)      – הדגלים של מוצר לפי השדות: noPrice (מחיר 0/חסר), missing (חסר מק"ט/קטגוריה/עלות), bcCheck (ברקוד לא תקין)
//   nextCtr(tx, ref, field, n) – מונה בטרנזקציה (מק"ט רץ, ברקוד פנימי): מחזיר את הראשון מתוך n מספרים רצופים. חייב לבוא אחרי tx.get(ref).

const { FieldValue } = require('firebase-admin/firestore');
const BC = require('./pos-barcode');

const WHY = ['in', 'set', 'zero', 'order', 'xout', 'xin', 'cancel', 'edit', 'pos', 'posret', 'rcv', 'rtv', 'cnt', 'make', 'use', 'fix', 'undo', 'dmg'];
const BR_RE = /^[A-Za-z0-9_-]{1,40}$/;

function move(tx, db, m) {
  if (!m || typeof m.pid !== 'string' || !m.pid) throw new Error('pos-stock: pid');
  if (typeof m.br !== 'string' || !BR_RE.test(m.br)) throw new Error('pos-stock: br');
  if (!WHY.includes(m.why)) throw new Error('pos-stock: why');
  const d = Number(m.delta);
  if (!Number.isFinite(d)) throw new Error('pos-stock: delta');
  if (d === 0) return null;
  const now = Date.now();
  tx.update(db.doc('prod/' + m.pid), { [`q.${m.br}`]: FieldValue.increment(d), upd: now });
  const ref = db.collection('stockLog').doc();
  const row = { prod: m.pid, br: m.br, delta: d, why: m.why, by: m.by || '', at: now };
  if (m.name) row.name = String(m.name).slice(0, 60);
  if (m.ref) row.ref = String(m.ref).slice(0, 60);
  if (m.note) row.note = String(m.note).slice(0, 120);
  tx.set(ref, row);
  return ref.id;
}

function codesOf(p) {
  const out = [];
  const add = (c) => { const s = BC.clean(c); if (s && !out.includes(s)) out.push(s); };
  if (p) { add(p.barcode); (Array.isArray(p.bcs) ? p.bcs : []).forEach(add); (Array.isArray(p.packs) ? p.packs : []).forEach((x) => x && add(x.bc)); }
  return out;
}

async function bcTaken(get, db, codes, selfId) {
  const C = [...new Set((codes || []).filter(Boolean))];
  const hit = new Map();
  for (const c of C) {
    const s = await get(db.doc('posbc/' + c));
    if (s.exists && s.get('pid') !== selfId) hit.set(c, s.get('pid'));
  }
  for (let i = 0; i < C.length; i += 30) {
    const part = C.slice(i, i + 30);
    (await get(db.collection('prod').where('barcode', 'in', part))).forEach((s) => { if (s.id !== selfId && !hit.has(s.get('barcode'))) hit.set(s.get('barcode'), s.id); });
    (await get(db.collection('prod').where('bcs', 'array-contains-any', part.slice(0, 30)))).forEach((s) => {
      if (s.id === selfId) return;
      for (const b of s.get('bcs') || []) if (part.includes(b) && !hit.has(b)) hit.set(b, s.id);
    });
  }
  return [...hit.entries()].map(([bc, pid]) => ({ bc, pid }));
}

function bcIndex(tx, db, pid, p) {
  const now = Date.now();
  const main = BC.clean(p.barcode);
  if (main) tx.set(db.doc('posbc/' + main), { pid, t: 'main', at: now });
  for (const b of Array.isArray(p.bcs) ? p.bcs : []) { const c = BC.clean(b); if (c && c !== main) tx.set(db.doc('posbc/' + c), { pid, t: 'alt', at: now }); }
  for (const x of Array.isArray(p.packs) ? p.packs : []) { const c = x && BC.clean(x.bc); if (c) tx.set(db.doc('posbc/' + c), { pid, t: 'pack', qty: x.qty, at: now }); }
}
// ברקודים שהוסרו ממוצר – מוחקים מהאינדקס רק אם הם עדיין מצביעים על המוצר הזה
async function bcUnindex(tx, db, pid, codes) {
  const snaps = [];
  for (const c of codes) snaps.push(await tx.get(db.doc('posbc/' + c)));
  return () => { for (const s of snaps) if (s.exists && s.get('pid') === pid) tx.delete(s.ref); };
}

function prodFlags(p, cost) {
  const f = [];
  if (!(typeof p.price === 'number' && p.price > 0)) f.push('noPrice');
  if (!p.sku || !p.cat || !(typeof cost === 'number' && cost > 0)) f.push('missing');
  if (p.barcode && !BC.check(p.barcode).ok) f.push('bcCheck');
  if (p.bcRaw) f.push('bcCheck');
  return [...new Set(f)];
}

function nextCtr(tx, ref, snap, field, n) {
  const cur = snap && snap.exists && Number.isInteger(snap.get(field)) ? snap.get(field) : 0;
  const k = Number.isInteger(n) && n > 0 ? n : 1;
  tx.set(ref, { [field]: cur + k, upd: Date.now() }, { merge: true });
  return cur + 1;
}

module.exports = { WHY, move, codesOf, bcTaken, bcIndex, bcUnindex, prodFlags, nextCtr };
