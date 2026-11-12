'use strict';
// ניוד קווים (fb/ord-lines): orders.js setCellCfg/saveLinePlan/checkLines + cell בהזמנה + lineLog/ports ב"שולם" + חוקי lineplan/lineLog/ordcfg/cell.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-o';
const B2 = 'biz-p';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const CELL = Object.assign({}, ALL, { cellular: true });
const MGR = 'r_mgr', E1 = 'r_e1', E2 = 'r_e2', NOORD = 'r_no', SUPER = 'r_super';
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
let env, n = 0;
const rid = () => 'req' + Date.now().toString(36) + (n++) + 'xx';
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };
async function seed(features) {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: features || ALL,
      org: { v: 1, branches: [{ id: 'br1', name: 'נחל לכיש', on: true, sig: [] }, { id: 'br2', name: 'יהודה הנשיא', on: true, sig: [] }], banks: [], cards: [] } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true, br: ['br1'] });
    b.set(d.doc(`b/${A}/staff/${E2}`), { name: E2, role: 'employee', active: true, br: ['br2'] });
    b.set(d.doc(`b/${A}/staff/${NOORD}`), { name: NOORD, role: 'employee', active: true, perms: NONE });
    for (const [u, role] of [[MGR, 'admin'], [E1, 'worker'], [E2, 'worker'], [NOORD, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/prod/pA`), { name: 'עוגה', price: 10, barcode: '', on: true, q: { br1: 3, br2: 0 } });
    b.set(d.doc(`b/${A}/prod/pA/p/cost`), { cost: 4 });
    b.set(d.doc(`b/${A}/prod/pB`), { name: 'לחם', price: 7.5, barcode: '729', on: true, q: { br1: 0, br2: 10 } });
    b.set(d.doc('b/' + B2), { name: 'ב', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: features || ALL });
    b.set(d.doc(`b/${B2}/admins/m2`), { email: 'm2@x.invalid' });
    b.set(d.doc('users/m2'), { bizId: B2, role: 'admin', active: true, bizStatus: 'active', email: 'm2@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/custcfg/main`), { xKeys: [{ k: 'xcity', label: 'עיר' }] });
    await b.commit();
  });
}


const TZ = '123456782', TZ2 = '000000018';
const cust = { name: 'דנה', phone: '0501234567', tz: TZ };
const items = [{ n: 'כיסוי', qty: 1, price: 50 }];
const DAY = 86400000;
before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => seed(CELL));
async function setup() {
  let r = await call('setCellCfg', MGR, { carriers: ['פרטנר', 'סלקום'], ads: ['פייסבוק', 'חבר מביא חבר'] });
  assert.equal(r.status, 'OK', r.text);
  r = await call('saveLinePlan', MGR, { name: 'פרטנר 30', carrier: 'פרטנר', days: 30 });
  assert.equal(r.status, 'OK', r.text);
  const p30 = r.result.id;
  r = await call('saveLinePlan', MGR, { name: 'ברירת מחדל' });
  assert.equal(r.result.days, 60);
  return { p30, pDef: r.result.id };
}
const order = (uid, cell, extra) => call('createOrder', uid, Object.assign({ reqId: rid(), br: 'br1', cust, items, cell }, extra || {}));

describe('ניוד קווים – מתג cellular', () => {
  it('כבוי: כל פונקציות הניוד ו-cell בהזמנה נדחים (feature-off); הזמנה בלי cell עובדת כמו קודם', async () => {
    await seed(ALL);
    for (const [fn, d] of [['setCellCfg', { carriers: ['x'] }], ['saveLinePlan', { name: 'x' }], ['checkLines', { lines: [{ phone: '0521234567' }] }]]) {
      assert.equal((await call(fn, MGR, d)).reason, 'feature-off', fn);
    }
    assert.equal((await order(E1, { lines: [{ phone: '0521234567' }] })).reason, 'feature-off');
    const r = await order(E1, undefined);
    assert.equal(r.status, 'OK', r.text);
    const o = await get(`b/${A}/ord/${r.result.id}`); assert.equal(o.cell, undefined);
  });
  it('הזמנה ישנה בלי cell נפתחת ומשולמת כרגיל גם כשהמתג פעיל, בלי lineLog', async () => {
    const r = await order(E1, undefined);
    assert.equal((await call('markOrderPaid', E1, { id: r.result.id, method: 'cash' })).status, 'OK');
    assert.equal((await coll(`b/${A}/lineLog`)).length, 0);
  });
});

describe('ניוד קווים – הגדרות מנהל', () => {
  it('עובד לא מגדיר רשימות; עובד בלי ord לא בודק קווים', async () => {
    assert.equal((await call('saveLinePlan', NOORD, { name: 'x' })).reason, 'no-perm');
    assert.equal((await call('setCellCfg', E1, { carriers: ['x'] })).reason, 'manager-only');
    assert.equal((await call('checkLines', NOORD, { lines: [{ phone: '0521234567' }] })).reason, 'no-perm');
  });
  it('ולידציה: טווח 0 / 4000 / שבר נדחה; חברה שלא ברשימה נדחית; ברירת מחדל 60', async () => {
    await call('setCellCfg', MGR, { carriers: ['פרטנר'] });
    for (const days of [0, 4000, 1.5, '30']) assert.equal((await call('saveLinePlan', MGR, { name: 'x', days })).reason, 'bad-days', String(days));
    assert.equal((await call('saveLinePlan', MGR, { name: 'x', carrier: 'גולן' })).reason, 'bad-carrier');
    const r = await call('saveLinePlan', MGR, { name: 'x', carrier: 'פרטנר' });
    const p = await get(`b/${A}/lineplan/${r.result.id}`); assert.equal(p.days, 60); assert.equal(p.on, true);
    assert.equal((await call('saveLinePlan', MGR, { id: r.result.id, name: 'y', days: 14 })).status, 'OK');
    assert.equal((await get(`b/${A}/lineplan/${r.result.id}`)).days, 14);
    assert.equal((await call('saveLinePlan', MGR, { id: 'nope', name: 'y' })).status, 'NOT_FOUND');
  });
});

describe('ניוד קווים – בהזמנה', () => {
  it('שמירה: קווים (טלפון הלקוח / אחר, ת"ז הלקוח / אחרת), כמות אוטומטית, פרסום, בנק, ת"ז בעל כרטיס', async () => {
    const { p30 } = await setup();
    const r = await order(E1, { lines: [{ same: true, sameTz: true, plan: p30, carrier: 'פרטנר' }, { phone: '052-1234567', tz: TZ2, carrier: 'סלקום' }], ad: 'פייסבוק', bank: { bank: '12', br: '345', acct: '123456' }, ctz: TZ2 });
    assert.equal(r.status, 'OK', r.text);
    const c = (await get(`b/${A}/ord/${r.result.id}`)).cell;
    assert.equal(c.n, 2); assert.equal(c.lines[0].phone, '0501234567'); assert.equal(c.lines[0].tz, TZ); assert.equal(c.lines[1].phone, '0521234567');
    assert.equal(c.ad, 'פייסבוק'); assert.deepEqual(c.bank, { bank: '12', br: '345', acct: '123456' }); assert.equal(c.ctz, TZ2);
  });
  it('ולידציה: חברה/פרסום לא מהרשימה, תוכנית לא קיימת, טלפון כפול, ת"ז שגויה, בנק עם אותיות/אורך, שדה זר', async () => {
    await setup();
    const bad = async (cell, reason) => { const r = await order(E1, cell); assert.equal(r.reason, reason, JSON.stringify(cell) + r.text); };
    await bad({ lines: [{ phone: '0521234567', carrier: 'גולן' }] }, 'bad-carrier');
    await bad({ lines: [], ad: 'טלוויזיה' }, 'bad-ad');
    await bad({ lines: [{ phone: '0521234567', plan: 'nope' }] }, 'bad-plan');
    await bad({ lines: [{ phone: '0521234567' }, { phone: '052-1234567' }] }, 'bad-lines');
    await bad({ lines: [{ phone: '0521234567', tz: '123456789' }] }, 'bad-tz');
    await bad({ lines: [], ctz: '111' }, 'bad-tz');
    for (const bank of [{ bank: '1a', br: '345', acct: '1234' }, { bank: '12', br: '3', acct: '1234' }, { bank: '12', br: '345', acct: '4580123456789012' }, { bank: '12', br: '345' }, { bank: '12', br: '345', acct: '1234', x: 1 }]) {
      const r = await order(E1, { lines: [], bank });
      assert.ok(['bad-bank', 'bad-field'].includes(r.reason), JSON.stringify(bank) + r.text);
    }
    await bad({ lines: [], card: '4580' }, 'bad-field');
    await bad({ lines: [{ phone: '0521234567', cvv: '123' }] }, 'bad-field');
  });
  it('updateOrder: עדכון cell לפני "שולם"; null מוחק; אחרי "שולם" – נעול', async () => {
    await setup();
    const r = await order(E1, { lines: [{ phone: '0521234567' }] });
    const id = r.result.id;
    let u = await call('updateOrder', E1, { id, cell: { lines: [{ phone: '0521234567' }, { phone: '0531234567' }], ctz: TZ } });
    assert.equal(u.status, 'OK', u.text); assert.equal((await get(`b/${A}/ord/${id}`)).cell.n, 2);
    u = await call('updateOrder', E1, { id, cell: null }); assert.equal(u.status, 'OK', u.text);
    assert.equal((await get(`b/${A}/ord/${id}`)).cell, undefined);
    await call('markOrderPaid', E1, { id, method: 'cash' });
    assert.equal((await call('updateOrder', E1, { id, cell: { lines: [] } })).reason, 'locked');
  });
  it('עובד מסניף אחר לא מעדכן את פרטי הניוד/בנק של הזמנה בסניף שלא שלו', async () => {
    await setup();
    const r = await order(E1, { lines: [], bank: { bank: '12', br: '345', acct: '123456' } });
    assert.equal((await call('updateOrder', E2, { id: r.result.id, cell: { lines: [] } })).reason, 'foreign-br');
  });
});

describe('ניוד קווים – "שולם", היסטוריה ובדיקת ניוד חוזר', () => {
  it('"שולם" כותב lineLog לכל קו + ports בלקוח (עם סניף), בלי כפילות; checkLines בסניף אחר מתריע עם תאריך וסניף', async () => {
    const { p30 } = await setup();
    await call('saveCust', E1, { cust });
    const r = await order(E1, { lines: [{ phone: '0521234567', tz: TZ2, plan: p30 }] }, { custId: 't' + TZ });
    assert.equal((await call('markOrderPaid', E1, { id: r.result.id, method: 'cash' })).status, 'OK');
    const L = await coll(`b/${A}/lineLog`);
    assert.equal(L.length, 1); assert.equal(L[0].phone, '0521234567'); assert.equal(L[0].br, 'br1'); assert.equal(L[0].plan, p30);
    const c = await get(`b/${A}/cust/t${TZ}`);
    assert.equal(c.ports.length, 1); assert.equal(c.ports[0].phone, '0521234567'); assert.equal(c.ports[0].br, 'br1');
    const k = await call('checkLines', E2, { lines: [{ phone: '0521234567', plan: p30 }] });
    assert.equal(k.status, 'OK', k.text);
    assert.equal(k.result.hits.length, 1); assert.equal(k.result.hits[0].br, 'br1'); assert.equal(k.result.hits[0].days, 30);
    assert.match(k.result.hits[0].d, /^\d{4}-\d{2}-\d{2}$/);
    // ההזמנה עצמה לא מתריעה על עצמה
    assert.equal((await call('checkLines', E1, { lines: [{ phone: '0521234567' }], ord: r.result.id })).result.hits.length, 0);
  });
  it('טווח: ניוד לפני 10 ימים בתוכנית 30 → התראה; לפני 40 → אין; בלי תוכנית – 60 יום', async () => {
    const { p30 } = await setup();
    const now = Date.now();
    await prep(async (d) => {
      await d.doc(`b/${A}/lineLog/a`).set({ phone: '0521111111', br: 'br2', ord: 'x', at: now - 10 * DAY, by: MGR });
      await d.doc(`b/${A}/lineLog/b`).set({ phone: '0522222222', br: 'br2', ord: 'x', at: now - 40 * DAY, by: MGR });
    });
    const k = await call('checkLines', E1, { lines: [{ phone: '0521111111', plan: p30 }, { phone: '0522222222', plan: p30 }, { phone: '0522222222' }] });
    assert.deepEqual(k.result.hits.map((h) => h.i), [0, 2]);
  });
  it('היסטוריה מיובאת (ports בלקוח, כולל port ישן לפי ת"ז) נבדקת; לקוח בעסק אחר – לא', async () => {
    const now = Date.now(), d5 = new Date(now - 5 * DAY).toISOString().slice(0, 10);
    await prep(async (d) => {
      await d.doc(`b/${A}/cust/p0523333333`).set({ name: 'א', phone: '0523333333', ports: [{ d: d5, phone: '0523333333', br: 'br2' }] });
      await d.doc(`b/${A}/cust/t${TZ2}`).set({ name: 'ב', phone: '0529999999', tz: TZ2, port: d5 });
      await d.doc(`b/${B2}/lineLog/z`).set({ phone: '0524444444', br: 'br1', ord: 'x', at: now, by: 'm2' });
    });
    const k = await call('checkLines', E1, { lines: [{ phone: '0523333333' }, { phone: '0525555555', tz: TZ2 }, { phone: '0524444444' }] });
    assert.equal(k.status, 'OK', k.text);
    assert.deepEqual(k.result.hits.map((h) => [h.i, h.br, h.src]), [[0, 'br2', 'cust'], [1, '', 'cust']]);
  });
  it('ייבוא לקוחות: עמודת סניף בניוד נשמרת; סניף שלא קיים בעסק – השורה נדחית', async () => {
    const r = await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'א', phone: '0501111111', ports: [{ d: '2025-01-02', br: 'br2' }] }, { name: 'ב', phone: '0502222222', ports: [{ d: '2025-01-02', br: 'zz' }] }] });
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/cust/p0501111111`)).ports[0].br, 'br2');
    assert.deepEqual(r.result.bad.map((x) => [x.i, x.reason]), [[1, 'bad-br']]);
  });
});

// 12.11.2026 (fix/lines-unpay): ביטול "שולם" מבטל את הניוד; תשלום חוזר – רישום אחד לכל הזמנה+קו
describe('ניוד קווים – ביטול "שולם" ותשלום חוזר', () => {
  const L1 = '0521234567', L2 = '0537654321';
  async function paidOrder() {
    await call('saveCust', E1, { cust });
    const r = await order(E1, { lines: [{ phone: L1, tz: TZ2 }, { phone: L2 }] }, { custId: 't' + TZ });
    assert.equal(r.status, 'OK', r.text);
    const id = r.result.id;
    assert.equal((await call('markOrderPaid', E1, { id, method: 'cash' })).status, 'OK');
    return id;
  }
  it('תשלום → ביטול: אין רישום lineLog, ports של הלקוח חוזר, checkLines לא מתריע', async () => {
    await setup();
    const id = await paidOrder();
    assert.deepEqual((await coll(`b/${A}/lineLog`)).map((x) => x.id).sort(), [`o_${id}_0`, `o_${id}_1`]);
    assert.equal((await get(`b/${A}/cust/t${TZ}`)).ports.length, 2);
    const u = await call('unpayOrder', MGR, { id, reason: 'טעות' });
    assert.equal(u.status, 'OK', u.text);
    assert.equal((await coll(`b/${A}/lineLog`)).length, 0);
    assert.deepEqual((await get(`b/${A}/cust/t${TZ}`)).ports, []);
    assert.equal((await get(`b/${A}/ord/${id}`)).status, 'wait_pay');
    assert.equal((await call('checkLines', E2, { lines: [{ phone: L1 }, { phone: L2 }] })).result.hits.length, 0);
  });
  it('תשלום → ביטול → תשלום: רישום אחד לכל קו, ports בלי כפילות', async () => {
    await setup();
    const id = await paidOrder();
    assert.equal((await call('unpayOrder', MGR, { id, reason: 'טעות' })).status, 'OK');
    assert.equal((await call('markOrderPaid', E1, { id, method: 'cash' })).status, 'OK');
    const L = await coll(`b/${A}/lineLog`);
    assert.equal(L.length, 2); assert.deepEqual(L.map((x) => x.phone).sort(), [L1, L2].sort());
    assert.equal((await get(`b/${A}/cust/t${TZ}`)).ports.length, 2);
    // לחיצה כפולה על "שולם" – עדיין רישום אחד לכל קו
    assert.equal((await call('markOrderPaid', E1, { id, method: 'cash' })).result.dup, true);
    assert.equal((await coll(`b/${A}/lineLog`)).length, 2);
  });
  it('תשלום → ביטול הזמנה (cancelOrder): אין רישום lineLog, ports של הלקוח חוזר, checkLines לא מתריע', async () => {
    await setup();
    const id = await paidOrder();
    const c = await call('cancelOrder', MGR, { id, reason: 'הלקוח התחרט' });
    assert.equal(c.status, 'OK', c.text);
    assert.equal((await get(`b/${A}/ord/${id}`)).status, 'cancel');
    assert.equal((await coll(`b/${A}/lineLog`)).length, 0);
    assert.deepEqual((await get(`b/${A}/cust/t${TZ}`)).ports, []);
    assert.equal((await call('checkLines', E2, { lines: [{ phone: L1 }, { phone: L2 }] })).result.hits.length, 0);
  });
  it('הזמנה ישנה (רישומים עם מזהה אקראי, בלי paid.pk): ביטול מנקה; רשומת ניוד אחרת של הלקוח נשארת', async () => {
    await setup();
    const id = await paidOrder();
    const o = await get(`b/${A}/ord/${id}`);
    const d0 = new Date(o.paid.at).toISOString().slice(0, 10);
    // מדמים את המצב שלפני התיקון: מזהים אקראיים, בלי pk, ורשומת ניוד מיובאת נוספת (תאריך אחר) + רשומה מועשרת
    await prep(async (d) => {
      for (const x of await coll(`b/${A}/lineLog`)) await d.doc(`b/${A}/lineLog/${x.id}`).delete();
      await d.doc(`b/${A}/lineLog/rndA1`).set({ phone: L1, br: 'br1', ord: id, at: o.paid.at, by: E1, tz: TZ2 });
      await d.doc(`b/${A}/lineLog/rndA2`).set({ phone: L2, br: 'br1', ord: id, at: o.paid.at, by: E1 });
      await d.doc(`b/${A}/lineLog/other`).set({ phone: L1, br: 'br2', ord: 'zzz', at: o.paid.at, by: E2 });
      const p = Object.assign({}, o.paid); delete p.pk;
      await d.doc(`b/${A}/ord/${id}`).update({ paid: p });
      await d.doc(`b/${A}/cust/t${TZ}`).update({ ports: [{ d: '2025-01-02', phone: L1 }, { d: d0, phone: L1, tz: TZ2, br: 'br1' }, { d: d0, phone: L2, br: 'br1', co: 'פרטנר' }] });
    });
    assert.equal((await call('unpayOrder', MGR, { id, reason: 'טעות' })).status, 'OK');
    assert.deepEqual((await coll(`b/${A}/lineLog`)).map((x) => x.id), ['other']);
    assert.deepEqual((await get(`b/${A}/cust/t${TZ}`)).ports, [{ d: '2025-01-02', phone: L1 }, { d: d0, phone: L2, br: 'br1', co: 'פרטנר' }]);
    // תשלום חוזר אחרי הביטול – לא מכפיל
    assert.equal((await call('markOrderPaid', E1, { id, method: 'cash' })).status, 'OK');
    assert.equal((await coll(`b/${A}/lineLog`)).filter((x) => x.ord === id).length, 2);
  });
  it('הזמנה ישנה ששולמה, בוטלה ושולמה שוב לפני התיקון (2 רישומים אקראיים לקו): ביטול מוחק את כולם', async () => {
    await setup();
    const id = await paidOrder();
    await prep(async (d) => {
      await d.doc(`b/${A}/lineLog/dup1`).set({ phone: L1, br: 'br1', ord: id, at: 1, by: E1 });
      await d.doc(`b/${A}/lineLog/dup2`).set({ phone: L2, br: 'br1', ord: id, at: 1, by: E1 });
    });
    assert.equal((await call('unpayOrder', MGR, { id, reason: 'טעות' })).status, 'OK');
    assert.equal((await coll(`b/${A}/lineLog`)).length, 0);
  });
});

// 2026-11-10 (ייבוא לקוחות מלא): לא תקין נשמר עם סימון, שדות מידע, חברת ניוד / נויד בפועל, איחוד רק לפי מזהה תקין, מתג cellular
describe('ייבוא לקוחות מלא – סימון "לא תקין" ושדות מידע', () => {
  it('טלפון/ת"ז/מייל לא תקינים נשמרים ב-bph/btz/bml; שורה בלי מזהה תקין – לקוח נפרד (לא מתאחד); שדות מידע וקו עם חברה ונויד בפועל', async () => {
    const r = await call('importCusts', MGR, { reqId: rid(), rows: [
      { fn: 'א', ln: 'ב', phone: '0501111111', bml: 'x@@y', bank: 'בנק 12 סניף 345 חשבון 123456789', prod: 'חבילה', due: '₪100', orig: 'פייסבוק', stat: 'פעיל', note: 'להתקשר 0521234567 0531234567', od: '2026-10-01', ports: [{ phone: '0521111111', co: 'חברה א', act: 'y' }, { bph: '12345', btz: '99', act: 'u' }] },
      { name: 'ג', bph: '0' }, { name: 'ד', bph: '0' }, { name: 'ה', btz: '123', phone: '0502222222' }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.bad.length, 0, JSON.stringify(r.result.bad)); assert.equal(r.result.created, 4);
    const a = await get(`b/${A}/cust/p0501111111`);
    assert.equal(a.bml, 'x@@y'); assert.equal(a.bank, 'בנק 12 סניף 345 חשבון 123456789'); assert.equal(a.note, 'להתקשר 0521234567 0531234567'); assert.equal(a.od, '2026-10-01');
    assert.deepEqual(a.ports, [{ phone: '0521111111', co: 'חברה א', act: 'y' }, { bph: '12345', btz: '99', act: 'u' }]);
    assert.equal((await get(`b/${A}/cust/p0502222222`)).btz, '123');
    const L = (await coll(`b/${A}/cust`)).filter((d) => d.bph === '0');
    assert.equal(L.length, 2); // טלפון "0" לא מאחד לקוחות שונים
  });
  it('מספר כרטיס בשדות המידע / בטלפון לא תקין – נדחה; פרטי בנק – טקסט גלוי; נויד בפועל רק y/n/u', async () => {
    const one = async (row) => (await call('importCusts', MGR, { reqId: rid(), rows: [Object.assign({ name: 'א', phone: '0501111111' }, row)] })).result.bad.map((x) => x.reason);
    assert.deepEqual(await one({ note: 'כרטיס 4111 1111 1111 1111' }), ['card-like']);
    assert.deepEqual(await one({ bph: '4111111111111111' }), ['card-like']);
    assert.deepEqual(await one({ ports: [{ act: 'yes' }] }), ['bad-ports']);
    assert.deepEqual(await one({ bank: '4111111111111111' }), []); // החלטת המשתמש: גלוי
  });
  it('לקוח קיים לא משתנה בייבוא (רק שדות ריקים); עריכה מוחקת סימון; בעסק בלי cellular – שדות המידע נדחים', async () => {
    await call('saveCust', E1, { cust: { name: 'קיים', phone: '0503333333', mail: 'a@b.co' } });
    await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'אחר', phone: '0503333333', bml: 'zz', stat: 'חדש' }] });
    let d = await get(`b/${A}/cust/p0503333333`); assert.equal(d.name, 'קיים'); assert.equal(d.mail, 'a@b.co'); assert.equal(d.stat, 'חדש');
    assert.equal((await call('saveCust', MGR, { id: 'p0503333333', cust: { bml: '', stat: '' } })).status, 'OK');
    d = await get(`b/${A}/cust/p0503333333`); assert.ok(!d.bml && !d.stat);
    assert.equal((await call('saveCust', E1, { cust: { name: 'מ', phone: '0504444444', mail: '0504444444@x.co' } })).status, 'OK'); // מייל עם טלפון – מותר
    await seed(ALL);
    assert.equal((await call('saveCust', E1, { cust: { name: 'ב', phone: '0505555555', note: 'x' } })).reason, 'feature-off');
    assert.equal((await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'ב', phone: '0505555555', bph: 'x' }] })).result.bad.length, 0); // סימון לא תקין – גם בלי cellular
  });
  // סבב 2 (ליקוי הבודק, החלטה 4): לקוח עם טלפון תקין + עוד שורה שלו עם טלפון לא תקין
  it('סבב 2: ללקוח עם טלפון/ת"ז תקינים לא נשמר bph/btz – הערך עובר להערות; עריכה בלי שינוי לא מוחקת ערך לא תקין; חברת ניוד עם מספר כרטיס נחסמת', async () => {
    await call('saveCust', E1, { cust: { name: 'ק', phone: '0506666666', tz: TZ } });
    let r = await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'ק', tz: TZ, bph: '05012', note: 'ישן' }] }); // לקוח קיים במאגר
    assert.equal(r.status, 'OK', r.text);
    let d = await get(`b/${A}/cust/t${TZ}`);
    assert.equal(d.bph, undefined); assert.equal(d.phone, '0506666666'); assert.equal(d.note, 'ישן | טלפון נוסף (לא תקין): 05012');
    await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'ק', tz: TZ, bph: '05012' }] }); // ייבוא חוזר – לא מכפיל בהערות
    assert.equal((await get(`b/${A}/cust/t${TZ}`)).note, 'ישן | טלפון נוסף (לא תקין): 05012');
    r = await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'ש', phone: '0507777777', btz: '12' }] }); // באותה שורה: טלפון תקין + ת"ז לא תקינה – נשמרת (אין ת"ז תקינה)
    assert.equal((await get(`b/${A}/cust/p0507777777`)).btz, '12');
    r = await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'ח', phone: '0508888888', bph: '0508888888x' }] }); // חדש: טלפון תקין + לא תקין באותה שורה
    d = await get(`b/${A}/cust/p0508888888`); assert.equal(d.bph, undefined); assert.equal(d.note, 'טלפון נוסף (לא תקין): 0508888888x');
    // לקוח בלי טלפון תקין: עריכה שלא שולחת bph – הערך הלא תקין נשאר
    await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'בלי', bph: '123' }] });
    const cid = ((await coll(`b/${A}/cust`)).find((x) => x.bph === '123') || {}).id;
    assert.ok(cid);
    assert.equal((await call('saveCust', MGR, { id: cid, cust: { stat: 'א' } })).status, 'OK');
    assert.equal((await get(`b/${A}/cust/${cid}`)).bph, '123');
    assert.equal((await call('saveCust', MGR, { id: 't' + TZ, cust: { ports: [{ phone: '0521111111', co: 'חברה 4580 1234 5678' }] } })).reason, 'card-like');
  });
});

describe('ניוד קווים – חוקי Firestore', () => {
  it('lineLog – אין קריאה ואין כתיבה מהאפליקציה; lineplan/ordcfg/cell – קריאה לעובד ord רק כשהמתג פעיל, כתיבה לאף אחד', async () => {
    await setup();
    await prep(async (d) => { await d.doc(`b/${A}/lineLog/a`).set({ phone: '0521111111', at: 1 }); });
    for (const u of [MGR, E1]) {
      await assertFails(db(u).doc(`b/${A}/lineLog/a`).get());
      await assertFails(db(u).collection(`b/${A}/lineLog`).get());
      await assertFails(db(u).doc(`b/${A}/lineLog/n`).set({ phone: '0521111111' }));
      await assertFails(db(u).doc(`b/${A}/lineplan/n`).set({ name: 'x' }));
      await assertFails(db(u).doc(`b/${A}/ordcfg/cell`).set({ carriers: [] }));
    }
    await assertSucceeds(db(E1).collection(`b/${A}/lineplan`).get());
    await assertSucceeds(db(E1).doc(`b/${A}/ordcfg/cell`).get());
    await assertFails(db(NOORD).collection(`b/${A}/lineplan`).get());
    await assertFails(db('m2').collection(`b/${A}/lineplan`).get());
    await prep(async (d) => { await d.doc('b/' + A).update({ features: ALL }); });
    await assertFails(db(E1).collection(`b/${A}/lineplan`).get());
    await assertFails(db(E1).doc(`b/${A}/ordcfg/cell`).get());
  });
  it('בנק/ת"ז בעל כרטיס בהזמנה: עובד מסניף אחר ועסק אחר לא קוראים את ההזמנה', async () => {
    await setup();
    const r = await order(E1, { lines: [], bank: { bank: '12', br: '345', acct: '123456' } });
    await assertSucceeds(db(E1).doc(`b/${A}/ord/${r.result.id}`).get());
    await assertFails(db(E2).doc(`b/${A}/ord/${r.result.id}`).get());
    await assertFails(db('m2').doc(`b/${A}/ord/${r.result.id}`).get());
  });
});

// חבילות ניוד ומבצעים – פישוט (2026-11-09_חבילות-ניוד, שלב 5; החלטות 22:27, 22:35). המבצע בתוך החבילה; בהזמנה – "סה"כ הנחה" אחד.
describe('חבילות ניוד – מבצע בחבילה ו"סה"כ הנחה"', () => {
  async function setup2(promo) {
    await call('setCellCfg', MGR, { carriers: ['פרטנר', 'סלקום'] });
    const r = await call('saveLinePlan', MGR, { name: 'פרטנר 39', carrier: 'פרטנר', monthly: 39, ship: { amt: 30, pay: 'store' }, sim: { amt: 20, pay: 'carrier' }, promo: promo === undefined ? { disc: 20 } : promo });
    assert.equal(r.status, 'OK', r.text);
    const old = await call('saveLinePlan', MGR, { name: 'ישנה', carrier: 'פרטנר' });
    return { pN: r.result.id, pO: old.result.id };
  }
  const L2 = (p) => [{ phone: '0521111111', plan: p }, { phone: '0521111112', plan: p }];
  it('חבילה: פרטים, עלות חודשית, משלוח/סים; עדכון בלי השדות לא מוחק; null מוחק', async () => {
    await call('setCellCfg', MGR, { carriers: ['פרטנר'] });
    const r = await call('saveLinePlan', MGR, { name: 'פרטנר 5G', carrier: 'פרטנר', details: '500GB', monthly: 39.9, ship: { amt: 30, pay: 'store' }, sim: { amt: 20, pay: 'carrier' } });
    assert.equal(r.status, 'OK', r.text);
    let p = await get(`b/${A}/lineplan/${r.result.id}`);
    assert.deepEqual([p.details, p.monthly, p.ship, p.sim], ['500GB', 39.9, { amt: 30, pay: 'store' }, { amt: 20, pay: 'carrier' }]);
    assert.equal((await call('saveLinePlan', MGR, { id: r.result.id, name: 'פרטנר 5G', carrier: 'פרטנר' })).status, 'OK');
    p = await get(`b/${A}/lineplan/${r.result.id}`); assert.equal(p.monthly, 39.9);
    assert.equal((await call('saveLinePlan', MGR, { id: r.result.id, name: 'x', carrier: 'פרטנר', sim: null, details: '' })).status, 'OK');
    p = await get(`b/${A}/lineplan/${r.result.id}`); assert.equal(p.sim, undefined); assert.equal(p.details, undefined); assert.deepEqual(p.ship, { amt: 30, pay: 'store' });
    for (const bad of [{ ship: { amt: 30, pay: 'x' } }, { ship: { amt: -1, pay: 'store' } }, { sim: { amt: 5, pay: 'store', z: 1 } }, { monthly: '40' }])
      assert.equal((await call('saveLinePlan', MGR, Object.assign({ name: 'x' }, bad))).status, 'INVALID_ARGUMENT', JSON.stringify(bad));
  });
  it('מבצע בחבילה: הנחה, מתנות מהמלאי, מבצע כמות, תאריכים; עובד עם ord שומר; ולידציה; הגדרות ישנות (הנחה/תקרה/מבצעי חברה) נדחות', async () => {
    await call('setCellCfg', MGR, { carriers: ['פרטנר'] });
    const pr = { disc: 200, gifts: [{ pid: 'pA', price: 0 }, { pid: 'pB', price: 100 }], qty: { n: 3, amt: 150, scope: 'carrier' }, from: '2026-01-01', to: '2099-12-31' };
    const r = await call('saveLinePlan', E1, { name: 'עם מבצע', carrier: 'פרטנר', promo: pr });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual((await get(`b/${A}/lineplan/${r.result.id}`)).promos, [pr]); // promo יחיד נשמר כרשימה (23:52)
    assert.equal((await call('saveLinePlan', E1, { id: r.result.id, name: 'עם מבצע', promos: [{ disc: 5 }, {}, pr] })).status, 'OK');
    let g = await get(`b/${A}/lineplan/${r.result.id}`); assert.deepEqual(g.promos, [{ disc: 5 }, pr]); assert.equal(g.promo, undefined);
    assert.equal((await call('saveLinePlan', E1, { id: r.result.id, name: 'x', promos: Array(6).fill({ disc: 1 }) })).status, 'INVALID_ARGUMENT');
    assert.equal((await call('saveLinePlan', E1, { id: r.result.id, name: 'עם מבצע', promos: [] })).status, 'OK');
    g = await get(`b/${A}/lineplan/${r.result.id}`); assert.equal(g.promos, undefined); assert.equal(g.promo, undefined);
    const bads = [{ zz: 1 }, { disc: -1 }, { gifts: [{ pid: 'nope' }] }, { gifts: [{ pid: 'pA' }, { pid: 'pA' }] }, { gifts: [{ pid: 'pA', price: -5 }] },
      { qty: { n: 1, amt: 10, scope: 'plan' } }, { qty: { n: 3, amt: 10, scope: 'x' } }, { qty: { n: 3, amt: 0, scope: 'all' } }, { disc: 5, from: '2026-12-01', to: '2026-11-01' }];
    for (const b of bads) assert.equal((await call('saveLinePlan', MGR, { name: 'x', promo: b })).status, 'INVALID_ARGUMENT', JSON.stringify(b));
    for (const b of [{ disc: {} }, { cap: {} }, { promos: [] }]) assert.equal((await call('setCellCfg', MGR, b)).status, 'INVALID_ARGUMENT', JSON.stringify(b));
    assert.equal((await call('saveLinePlan', NOORD, { name: 'x', promo: { disc: 5 } })).status, 'PERMISSION_DENIED');
  });
  it('total = פריטים + משלוח לחנות − הנחת המבצע; לחברה ועלות חודשית לא נכנסים; calc נשמר', async () => {
    const { pN } = await setup2();
    const r = await order(E1, { lines: L2(pN) });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.total, 50 + 60 - 40);
    const d = await get(`b/${A}/ord/${r.result.id}`);
    assert.deepEqual(d.cell.calc, { store: 60, sug: 40, disc: 40 }); assert.equal(d.cell.man, undefined);
  });
  it('"סה"כ הנחה" שהעובד הזין נשמר: למטה, למעלה, 0; לא מתחת ל-0', async () => {
    const { pN } = await setup2();
    let r = await order(E1, { lines: L2(pN), man: 30 }); assert.equal(r.status, 'OK', r.text); assert.equal(r.result.total, 110 - 30);
    assert.equal((await get(`b/${A}/ord/${r.result.id}`)).cell.man, 30);
    r = await order(E1, { lines: L2(pN), man: 60 }); assert.equal(r.result.total, 110 - 60);
    r = await order(E1, { lines: L2(pN), man: 0 }); assert.equal(r.result.total, 110);
    r = await order(E1, { lines: L2(pN), man: 500 }); assert.equal(r.result.total, 0);
    assert.equal((await order(E1, { lines: L2(pN), man: -1 })).status, 'INVALID_ARGUMENT');
    assert.equal((await order(E1, { lines: L2(pN), man: { order: { t: 'amt', v: 5 } } })).status, 'INVALID_ARGUMENT');
  });
  it('מבצע כמות: 3 קווים באותה חבילה → הנחה פעם אחת; 2 קווים → המלצה', async () => {
    const { pN } = await setup2({ qty: { n: 3, amt: 100, scope: 'plan' } });
    let r = await order(E1, { lines: L2(pN) });
    assert.equal(r.result.total, 110); assert.match(r.result.hint.msg, /עוד קו אחד באותו מבצע יזכה בהנחה של ₪100/);
    r = await order(E1, { lines: L2(pN).concat([{ phone: '0521111113', plan: pN }]) });
    assert.equal(r.result.total, 50 + 90 - 100); assert.equal(r.result.hint, null);
  });
  it('מתנה (23:50): שורת מוצר במחיר המלא, יורדת מהמלאי; ההפרש נכנס ל"סה"כ הנחה"; מתנה שלא במבצע נדחית', async () => {
    const { pN } = await setup2({ gifts: [{ pid: 'pA', price: 0 }] });
    const L = L2(pN); L[0].gift = 'pA';
    const r = await order(E1, { lines: L }, { items: [{ n: 'כיסוי', qty: 1, price: 50 }, { pid: 'pA', qty: 1, price: 10 }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.total, 50 + 10 + 60 - 10);
    const d = await get(`b/${A}/ord/${r.result.id}`);
    assert.deepEqual(d.cell.calc, { store: 60, sug: 10, disc: 10, gift: 10 }); assert.equal(d.cell.lines[0].gift, 'pA');
    assert.equal(d.items.find((it) => it.pid === 'pA').price, 10);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 2);
    const L3 = L2(pN); L3[0].gift = 'pB';
    assert.equal((await order(E1, { lines: L3 }, { items: [{ pid: 'pB', qty: 1, price: 5 }] })).reason, 'bad-gift');
  });
  it('כמה מבצעים (23:52): העובד בוחר מבצע לכל קו / בלי מבצע; ברירת מחדל הראשון; כמות סופרת רק מי שבחר; חבילה עם promo ישן במסד נקראת כרשימה', async () => {
    const { pN } = await setup2();
    assert.equal((await call('saveLinePlan', MGR, { id: pN, name: 'פרטנר 39', promos: [{ disc: 20 }, { qty: { n: 2, amt: 70 } }] })).status, 'OK');
    const L = (a, b) => [{ phone: '0521111111', plan: pN, pr: a }, { phone: '0521111112', plan: pN, pr: b }];
    let r = await order(E1, { lines: L2(pN) }); assert.equal(r.result.total, 110 - 40);
    r = await order(E1, { lines: L(1, 1) }); assert.equal(r.result.total, 110 - 70);
    assert.equal((await get(`b/${A}/ord/${r.result.id}`)).cell.lines[0].pr, 1);
    r = await order(E1, { lines: L(1, 0) }); assert.equal(r.result.total, 110 - 20); assert.match(r.result.hint.msg, /באותו מבצע/);
    r = await order(E1, { lines: L(-1, -1) }); assert.equal(r.result.total, 110);
    for (const bad of [2, -2, 'x', 0.5]) assert.equal((await order(E1, { lines: L(bad, 0) })).reason, 'bad-promo', String(bad));
    await prep(async (d) => { const x = (await d.doc(`b/${A}/lineplan/${pN}`).get()).data(); delete x.promos; x.promo = { disc: 15 }; await d.doc(`b/${A}/lineplan/${pN}`).set(x); });
    r = await order(E1, { lines: L2(pN) }); assert.equal(r.result.total, 110 - 30);
    assert.equal((await order(E1, { lines: L(1, 0) })).reason, 'bad-promo');
  });
  it('legacy: חבילה ישנה – total כמו קודם, בלי calc; הנחה נדחית', async () => {
    const { pO } = await setup2();
    const r = await order(E1, { lines: L2(pO) });
    assert.equal(r.result.total, 50);
    assert.equal((await get(`b/${A}/ord/${r.result.id}`)).cell.calc, undefined);
    assert.equal((await order(E1, { lines: L2(pO), man: 5 })).reason, 'bad-disc');
  });
  it('updateOrder: שינוי פריטים מחשב מחדש ושומר את ההנחה שהזין העובד; מחיקת ניוד מחזירה לסכום הפריטים; הזמנה ישנה לא משתנה', async () => {
    const { pN, pO } = await setup2();
    const r = await order(E1, { lines: L2(pN), man: 25 });
    const id = r.result.id;
    let u = await call('updateOrder', E1, { id, items: [{ n: 'כיסוי', qty: 2, price: 50 }] });
    assert.equal(u.status, 'OK', u.text); assert.equal(u.result.total, 100 + 60 - 25);
    u = await call('updateOrder', E1, { id, note: 'x' }); assert.equal((await get(`b/${A}/ord/${id}`)).total, 135);
    u = await call('updateOrder', E1, { id, cell: null }); assert.equal(u.result.total, 100);
    const o = await order(E1, { lines: L2(pO) });
    u = await call('updateOrder', E1, { id: o.result.id, items: [{ n: 'כיסוי', qty: 1, price: 60 }] });
    assert.equal(u.result.total, 60);
  });
});

describe('תוכניות ניוד ברירת מחדל (מהאקסל, 2026-11-12)', () => {
  const SEEDN = require('../functions/lib/line-plans-seed.json').plans.length;
  it('הפעלת סלולר ע"י מנהל־העל טוענת את כל התוכניות פעם אחת, עם כל השדות', async () => {
    await seed(ALL);
    const r = await call('setBusinessFeatures', SUPER, { bizId: A, features: { cellular: true } });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.plans, SEEDN);
    const P = await coll(`b/${A}/lineplan`);
    assert.equal(P.length, SEEDN);
    assert.equal(P.filter((p) => p.sector === 'kosher').length, 13);
    const k = P.find((p) => p.name === 'כשרה Larg');
    assert.equal(k.carrier, 'פלאפון'); assert.equal(k.monthly, 29.9); assert.ok(k.abroadUrl.startsWith('https://')); assert.equal(k.days, 60);
    const cfg = await get(`b/${A}/ordcfg/cell`);
    assert.ok(cfg.seeded); assert.ok(cfg.carriers.includes('טלזר 019'));
    // כיבוי והפעלה מחדש – לא נטען שוב
    await call('setBusinessFeatures', SUPER, { bizId: A, features: { cellular: false } });
    await call('setBusinessFeatures', SUPER, { bizId: A, features: { cellular: true } });
    assert.equal((await coll(`b/${A}/lineplan`)).length, SEEDN);
    assert.equal((await coll(`b/${B2}/lineplan`)).length, 0);
  });
  it('עסק קיים עם סלולר פעיל: ensureLinePlans טוען פעם אחת, לא מכפיל תוכנית קיימת, שומר חברות קיימות', async () => {
    await call('setCellCfg', MGR, { carriers: ['חברה שלי'] });
    let r = await call('ensureLinePlans', E1, {});
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.added, SEEDN);
    r = await call('ensureLinePlans', MGR, {});
    assert.equal(r.result.already, true); assert.equal(r.result.added, 0);
    const cfg = await get(`b/${A}/ordcfg/cell`);
    assert.equal(cfg.carriers[0], 'חברה שלי');
  });
  it('עריכה, שדות חדשים, מחיקה (מנהל בלבד)', async () => {
    await call('ensureLinePlans', MGR, {});
    const p = (await coll(`b/${A}/lineplan`)).find((x) => x.name === 'BIG TIME');
    let r = await call('saveLinePlan', MGR, { id: p.id, name: 'BIG TIME', carrier: 'טלזר 019', sector: 'general', pair: '30 ₪', abroadUrl: 'https://x.example/a?id=123456789' });
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/lineplan/${p.id}`)).pair, '30 ₪');
    assert.equal((await call('saveLinePlan', MGR, { id: p.id, name: 'x', sector: 'other' })).reason, 'bad-sector');
    assert.equal((await call('saveLinePlan', MGR, { id: p.id, name: 'x', abroadUrl: 'javascript:1' })).reason, 'bad-abroadUrl');
    assert.equal((await call('saveLinePlan', E1, { id: p.id, del: true })).reason, 'no-perm');
    r = await call('saveLinePlan', MGR, { id: p.id, del: true });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(await get(`b/${A}/lineplan/${p.id}`), null);
  });
});
