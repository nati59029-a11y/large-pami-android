'use strict';
// המזכירה – שלב ג/6 (15.11.2026): יצירת הזמנה אמיתית מטיוטת sec_ord (ordCreateFromSec → createCore של orders.js). פנימי בלבד – אין callable/HTTP.
// רץ בתוך התהליך מול אמולטור Firestore (כמו secretary-google.test.js). אין פנייה לרשת.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const A = 'biz-so6', XB = 'biz-so6x';
const MAIL = 'g' + 'a'.repeat(30);
let env, T, CORE, ORD;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const inBiz = async (fn) => { const b = await T.loadBiz(A); return T.runInBiz({ bizId: A, prefix: T.bizPrefix(b), biz: b }, () => fn(T.tdb())); };
// sec_ord/{mailId} חייב להתקיים (נעילה lk) – נוצר מהטיוטה אם חסר; קיים – לא נדרס (ordId/lk נשמרים)
async function ensureSo(o) { if (o && typeof o.in === 'string' && /^[A-Za-z0-9_-]+$/.test(o.in)) await prep(async (d) => { const r = d.doc(`b/${A}/sec_ord/${o.in}`); if (!(await r.get()).exists) await r.set(o); }); }
const make = async (o) => { await ensureSo(o); return inBiz((db) => CORE.ordCreateFromSec(db, o)); };
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
    b.set(d.doc(`b/${A}/prod/pB`), { name: 'לחם', price: 4, on: true, q: { br1: 0, br2: 5 } });
    // עסק אחר – לקוח עם טלפון תקין, שאסור שייקרא מהעסק A
    b.set(d.doc('b/' + XB), { name: 'ז', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { orders: true, secretary: true } });
    b.set(d.doc(`b/${XB}/cust/cX`), { name: 'זר', phone: '0503333333' });
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

  it('reqId כפול (אותו מייל ואותה גרסה) – הזמנה אחת, המלאי יורד פעם אחת; גרסה אחרת אחרי ביטול ordId (איפוס) = reqId אחר', async () => {
    const a = await make(secOrd());
    const b = await make(secOrd());
    assert.equal(b.dup, true); assert.equal(b.id, a.id);
    assert.equal((await coll(`b/${A}/ord`)).length, 1);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 3);
    assert.equal((await get(`b/${A}/ordcfg/seq`)).n, 1);
    await prep((d) => d.doc(`b/${A}/sec_ord/${MAIL}`).update({ ordId: null }));
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

  it('סבב 1/1: הזמנה שגמרה את המלאי – קריאה חוזרת עם אותה טיוטה ואותה ver מחזירה dup:true ולא מורידה שוב', async () => {
    const a = await make(secOrd({ lines: [okLine('pA', 5)] }));
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 0);
    const b = await make(secOrd({ lines: [okLine('pA', 5)] }));
    assert.deepEqual(b, { id: a.id, no: 1, total: 60, dup: true, warn: [] });
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 0);
    assert.equal((await coll(`b/${A}/stockLog`)).length, 1);
    // גם אחרי שהטלפון נמחק מהכרטיס – עדיין dup ולא חסימה
    await prep((d) => d.doc(`b/${A}/cust/c1`).update({ phone: '' }));
    assert.equal((await make(secOrd({ lines: [okLine('pA', 5)] }))).dup, true);
  });

  it('סבב 1/2: sec_ord מקבל ordId ו-st:ordered; גרסה אחרת – already-ordered; כתיבה שנכשלה מושלמת בקריאה הבאה', async () => {
    await prep((d) => d.doc(`b/${A}/sec_ord/${MAIL}`).set(secOrd()));
    const a = await make(secOrd());
    const so = await get(`b/${A}/sec_ord/${MAIL}`);
    assert.equal(so.ordId, a.id); assert.equal(so.st, 'ordered');
    await fails(secOrd({ ver: 2 }), 'already-ordered'); // הטיוטה שהקורא העביר ישנה (בלי ordId) – נקרא מהמסד
    await fails(secOrd({ ver: 3, ordId: a.id }), 'already-ordered');
    assert.equal((await coll(`b/${A}/ord`)).length, 1);
    assert.equal((await make(secOrd())).dup, true, 'אותו reqId – dup');
    // כתיבת ordId ל-sec_ord שנכשלה (מדומה: ordId/st נמחקו ו-lk נשאר) – ההזמנה קיימת; הקריאה הבאה עם אותו reqId מחזירה dup ומשלימה
    await seed();
    const c = await make(secOrd());
    await prep((d) => d.doc(`b/${A}/sec_ord/${MAIL}`).set(Object.assign(secOrd(), { lk: { reqId: 'sec' + MAIL + 'v1', at: Date.now() } })));
    assert.equal((await make(secOrd())).dup, true);
    const so2 = await get(`b/${A}/sec_ord/${MAIL}`);
    assert.equal(so2.ordId, c.id); assert.equal(so2.st, 'ordered');
  });

  it('סבב 1/3: "אזל" נבדק בסניף שממנו יורד המלאי – סניף ההזמנה (בלי מעבר שקט לסניף אחר), או סניף מקור קבוע מ-ordcfg/main.src', async () => {
    // לפי המלאי: בסניף ההזמנה אין – חסום (גם אם בסניף אחר יש), ושום דבר לא זז
    await fails(secOrd({ lines: [okLine('pB', 1)] }), 'ord-blocked');
    assert.deepEqual((await get(`b/${A}/prod/pB`)).q, { br1: 0, br2: 5 });
    // סניף מקור קבוע br2: pB יורד מ-br2 ונוצר; pA (ב-br2 אין) – חסום
    await prep((d) => d.doc(`b/${A}/ordcfg/main`).set({ src: { br1: 'br2' } }));
    await fails(secOrd({ ver: 5, lines: [okLine('pA', 1)] }), 'ord-blocked');
    const r = await make(secOrd({ lines: [okLine('pB', 2)] }));
    const d = await get(`b/${A}/ord/${r.id}`);
    assert.equal(d.items[0].from, 'br2'); assert.equal(d.items[0].price, 4);
    assert.deepEqual((await get(`b/${A}/prod/pB`)).q, { br1: 0, br2: 3 });
  });

  it('סבב 1/4: custId של עסק אחר – ord-blocked, ושום דבר לא נוצר', async () => {
    await fails(secOrd({ custId: 'cX' }), 'ord-blocked');
    assert.equal((await coll(`b/${A}/ord`)).length, 0);
    assert.equal((await coll(`b/${XB}/ord`)).length, 0);
  });

  it('החלטת מתאם: שתי גרסאות במקביל – הזמנה אחת בלבד, השנייה busy או already-ordered; נעילה ישנה / של אותו reqId לא חוסמת; שגיאה משחררת', async () => {
    await ensureSo(secOrd());
    const rs = await Promise.all([1, 2, 3].map((v) => make(secOrd({ ver: v })).then((r) => ({ r }), (e) => ({ reason: e.details && e.details.reason }))));
    assert.equal(rs.filter((x) => x.r && !x.r.dup).length, 1, JSON.stringify(rs));
    for (const x of rs) if (!x.r) assert.ok(['busy', 'already-ordered'].includes(x.reason), JSON.stringify(x));
    assert.equal((await coll(`b/${A}/ord`)).length, 1);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 3);
    const so = await get(`b/${A}/sec_ord/${MAIL}`);
    assert.ok(so.ordId); assert.equal(so.lk, undefined, 'הנעילה נמחקה');
    // נעילה טרייה של reqId אחר – busy; ישנה (מעל 120 שניות) – לא חוסמת; של אותו reqId – לא חוסמת
    await seed();
    const S = `b/${A}/sec_ord/${MAIL}`;
    await prep((d) => d.doc(S).set(Object.assign(secOrd(), { lk: { reqId: 'secOTHERv9', at: Date.now() } })));
    await fails(secOrd(), 'busy');
    await prep((d) => d.doc(S).update({ lk: { reqId: 'secOTHERv9', at: Date.now() - 121000 } }));
    assert.equal((await make(secOrd())).dup, false);
    await seed();
    await prep((d) => d.doc(S).set(Object.assign(secOrd(), { lk: { reqId: 'sec' + MAIL + 'v1', at: Date.now() } })));
    assert.equal((await make(secOrd())).dup, false);
    // שגיאה בתוך createCore (טיוטת סיטונאי של לקוח אחר ← ws-not-linked) – הנעילה משתחררת
    await seed();
    await prep((d) => d.doc(`b/${A}/ordcfg/wsb_sec${MAIL}v1`).set({ cust: 'c2' }));
    await ensureSo(secOrd());
    let err = null; try { await make(secOrd()); } catch (e) { err = e; }
    assert.equal(err && err.details && err.details.reason, 'ws-not-linked');
    assert.equal((await get(S)).lk, undefined, 'הנעילה שוחררה אחרי שגיאה');
  });

  it('השלמה: נעילה ישנה (121 שניות) של reqId שההזמנה שלו נוצרה בלי ordId – גרסה אחרת מקבלת already-ordered, אין הזמנה שנייה, ordId מושלם', async () => {
    const S = `b/${A}/sec_ord/${MAIL}`;
    const a = await make(secOrd());
    // מדמה קריסה אחרי createCore ולפני הכתיבה: ordId/st חסרים ו-lk ישן נשאר
    await prep((d) => d.doc(S).set(Object.assign(secOrd(), { lk: { reqId: 'sec' + MAIL + 'v1', at: Date.now() - 121000 } })));
    await fails(secOrd({ ver: 2 }), 'already-ordered');
    assert.equal((await coll(`b/${A}/ord`)).length, 1);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 3);
    const so = await get(S);
    assert.equal(so.ordId, a.id); assert.equal(so.st, 'ordered'); assert.equal(so.lk, undefined);
    await fails(secOrd({ ver: 3 }), 'already-ordered');
  });

  it('שלב ג/5 סבב 1: אישור לקוח (opt.sent) – רק טיוטה שעדיין sent באותה גרסה; מזהה מייל באורך אמיתי – reqId מקוצר', async () => {
    const o = secOrd({ st: 'sent', sentVer: 1 });
    const S = `b/${A}/sec_ord/${MAIL}`;
    const stale = async () => { let err = null; try { await inBiz((db) => CORE.ordCreateFromSec(db, o, { sent: true })); } catch (e) { err = e; } assert.equal(err && err.details && err.details.reason, 'stale'); };
    await prep((d) => d.doc(S).set(Object.assign({}, o, { st: 'cancel' }))); await stale();
    await prep((d) => d.doc(S).set(Object.assign({}, o, { st: 'mgr', ver: 2 }))); await stale();
    assert.equal((await coll(`b/${A}/ord`)).length, 0);
    await prep((d) => d.doc(S).set(o));
    assert.ok((await inBiz((db) => CORE.ordCreateFromSec(db, o, { sent: true }))).id);
    const M2 = 'g' + 'b'.repeat(40);
    const r2 = await make(secOrd({ in: M2 }));
    assert.ok(/^osec[0-9a-f]{28}v1$/.test(r2.id), r2.id);
    assert.equal((await make(secOrd({ in: M2 }))).dup, true, 'אותו מייל ואותה גרסה – dup');
  });
});
