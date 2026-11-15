'use strict';
// המזכירה – שלב ג/6 (15.11.2026): יצירת הזמנה אמיתית מטיוטת sec_ord (ordCreateFromSec → createCore של orders.js). פנימי בלבד – אין callable/HTTP.
// רץ בתוך התהליך מול אמולטור Firestore (כמו secretary-google.test.js). אין פנייה לרשת.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const A = 'biz-so6';
const MAIL = 'g' + 'a'.repeat(30);
let env, T, CORE, ORD;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const inBiz = async (fn) => { const b = await T.loadBiz(A); return T.runInBiz({ bizId: A, prefix: T.bizPrefix(b), biz: b }, () => fn(T.tdb())); };
const make = (o) => inBiz((db) => CORE.ordCreateFromSec(db, o));
async function fails(o, reason) {
  let err = null;
  try { await make(o); } catch (e) { err = e; }
  assert.ok(err, 'הייתה אמורה להיות שגיאה (' + reason + ')');
  assert.equal(err.details && err.details.reason, reason, String(err && err.message));
}
const okLine = (id, qty, extra) => Object.assign({ txt: 'x', qty, unit: '', st: 'ok', block: false, id, name: 'x', pr: 1, sum: qty }, extra || {});
const secOrd = (extra) => Object.assign({ in: MAIL, ch: 'mail', thr: 't1', to: 'c@c.example', custId: 'c1', br: 'br1', ver: 1, st: 'mgr', blk: [], nBlock: 0,
  lines: [okLine('pA', 2)], total: 2 }, extra || {});

async function seed(features) {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('b/' + A), { name: 'ס', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: features || { orders: true, secretary: true },
      org: { v: 1, branches: [{ id: 'br1', name: 'א', on: true, sig: [] }, { id: 'br2', name: 'ב', on: true, sig: [] }], banks: [], cards: [] } });
    b.set(d.doc(`b/${A}/prod/pA`), { name: 'עוגה', price: 10, bp: { br1: 12 }, on: true, q: { br1: 5, br2: 0 } });
    b.set(d.doc(`b/${A}/prod/pW`), { name: 'מגש', price: 9, on: true, q: { br1: 10 } });
    b.set(d.doc(`b/${A}/prod/pW/p/ws`), { wp: 6 });
    b.set(d.doc(`b/${A}/prod/pZ`), { name: 'אזל', price: 5, on: true, q: { br1: 0 } });
    b.set(d.doc(`b/${A}/cust/c1`), { name: 'דנה', phone: '0501234567' });
    b.set(d.doc(`b/${A}/cust/c2`), { name: 'סיטונאי', bn: 'סיטונאי בע"מ', phone: '0502222222', wholesale: true });
    b.set(d.doc(`b/${A}/cust/c3`), { name: 'בלי טלפון' });
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js'); // initializeApp
  T = require('../functions/lib/tenant');
  CORE = require('../functions/secretary-google')._core;
  ORD = require('../functions/orders')._core;
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => seed());

describe('שלב ג/6: הזמנה מהמזכירה (ordCreateFromSec)', () => {
  it('נוצרת עם src:mail, status new, by sec, sec:{in,ch}; המחיר מהקטלוג (bp של הסניף) ולא מ-sec_ord; המלאי יורד', async () => {
    const r = await make(secOrd());
    assert.equal(r.dup, false);
    assert.equal(r.id, 'osec' + MAIL + 'v1');
    const d = await get(`b/${A}/ord/${r.id}`);
    assert.equal(d.src, 'mail'); assert.equal(d.status, 'new'); assert.equal(d.by, 'sec'); assert.equal(d.byName, 'המזכירה');
    assert.deepEqual(d.sec, { in: MAIL, ch: 'mail' });
    assert.equal(d.custId, 'c1'); assert.equal(d.br, 'br1'); assert.equal(d.no, 1);
    assert.deepEqual(d.cust, { name: 'דנה', phone: '0501234567' });
    assert.equal(d.items.length, 1); assert.equal(d.items[0].pid, 'pA'); assert.equal(d.items[0].price, 12, 'bp[br1] – לא pr:1 של הטיוטה');
    assert.equal(d.total, 24); assert.equal(r.total, 24);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 3, 'המלאי ירד ב-2');
    const st = await coll(`b/${A}/stockLog`);
    assert.equal(st.length, 1); assert.equal(st[0].by, 'sec'); assert.equal(st[0].ord, r.id); assert.equal(st[0].delta, -2);
    const lg = await coll(`b/${A}/ord/${r.id}/log`);
    assert.equal(lg.length, 1); assert.equal(lg[0].by, 'sec'); assert.equal(lg[0].act, 'create');
  });

  it('reqId כפול (אותו מייל ואותה גרסה) – הזמנה אחת, המלאי יורד פעם אחת; גרסה אחרת = reqId אחר', async () => {
    const a = await make(secOrd());
    const b = await make(secOrd());
    assert.equal(b.dup, true); assert.equal(b.id, a.id);
    assert.equal((await coll(`b/${A}/ord`)).length, 1);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 3);
    assert.equal((await get(`b/${A}/ordcfg/seq`)).n, 1);
    const c = await make(secOrd({ ver: 2 }));
    assert.notEqual(c.id, a.id); assert.equal(c.id, 'osec' + MAIL + 'v2');
  });

  it('לקוח סיטונאי מאושר – מחיר סיטונאי מהקטלוג (wp), גם אם בטיוטה מחיר אחר', async () => {
    const r = await make(secOrd({ custId: 'c2', lines: [okLine('pW', 3, { pr: 99999, sum: 299997 })] }));
    const d = await get(`b/${A}/ord/${r.id}`);
    assert.equal(d.items[0].price, 6); assert.equal(d.total, 18);
    assert.equal(d.cust.name, 'סיטונאי בע"מ');
  });

  it('שורה חוסמת (pick / ask / אזל / block / בלי מוצר) – שגיאה ושום דבר לא נוצר', async () => {
    const bads = [
      { txt: 'כוס', qty: 1, st: 'pick', block: true, opts: [{ id: 'pA', name: 'עוגה', pr: 1200 }] },
      { txt: '?', qty: 1, st: 'ask', block: true, opts: [] },
      okLine('pZ', 1, { out: true, block: true }),
      okLine('pW', 1, { ctw: 6, block: true }),
      { txt: 'x', qty: 1, st: 'ok', block: false },
    ];
    for (const l of bads) await fails(secOrd({ lines: [okLine('pA', 1), l] }), 'ord-blocked');
    await fails(secOrd({ lines: [] }), 'ord-blocked');
    await fails(secOrd({ blk: ['cust'], cands: [{ id: 'c1' }], custId: '' }), 'ord-blocked');
    // הטיוטה תקינה, אבל לפי הקטלוג הנוכחי המוצר אזל – לא נוצרת
    await fails(secOrd({ lines: [okLine('pZ', 1)] }), 'ord-blocked');
    assert.equal((await coll(`b/${A}/ord`)).length, 0);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 5, 'המלאי לא השתנה');
    assert.equal((await coll(`b/${A}/stockLog`)).length, 0);
  });

  it('טלפון חסר או לא תקין – לא נוצרת', async () => {
    await fails(secOrd({ custId: 'c3' }), 'ord-blocked');
    await fails(secOrd({ custId: 'c3', phone: '12' }), 'bad-phone');
    assert.equal((await coll(`b/${A}/ord`)).length, 0);
  });

  it('תוספת ההזמנות כבויה / טיוטה בלי מזהה מייל תקין – לא נוצרת', async () => {
    await fails(secOrd({ in: 'bad id!' }), 'bad-req');
    await fails(secOrd({ ver: 0 }), 'bad-req');
    await seed({ secretary: true });
    await fails(secOrd(), 'feature-off');
    assert.equal((await coll(`b/${A}/ord`)).length, 0);
  });

  it('אין דרך לקרוא מבחוץ: אין export חדש (callable/HTTP), רק _core שאינו enumerable', () => {
    const idx = require('../functions/index.js');
    const keys = Object.keys(idx);
    for (const k of keys) assert.ok(!/ordCreateFromSec|createCore|fromSec/i.test(k), 'export לא צפוי: ' + k);
    assert.ok(!keys.includes('_core'));
    assert.ok(!Object.keys(require('../functions/orders')).includes('createCore'));
    assert.ok(!Object.keys(require('../functions/secretary-google')).includes('ordCreateFromSec'));
    assert.equal(typeof ORD.createCore, 'function');
    assert.equal(typeof CORE.ordCreateFromSec, 'function');
  });
});
