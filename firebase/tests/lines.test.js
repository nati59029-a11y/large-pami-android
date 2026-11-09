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
  it('עובד לא מגדיר תוכניות/רשימות; עובד בלי ord לא בודק קווים', async () => {
    assert.equal((await call('saveLinePlan', E1, { name: 'x' })).reason, 'manager-only');
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

// חבילות ניוד, הנחות ומבצעים (2026-11-09_חבילות-ניוד, שלב 2 חלק א: שמירת הגדרות)
describe('חבילות ניוד – הגדרות מנהל', () => {
  const PR = { name: '3 קווים', carriers: ['פרטנר', 'סלקום'], min: 3, kind: 'once', disc: { t: 'amt', v: 100 }, stack: 'add' };
  it('חבילה: פרטים, עלות חודשית, משלוח/סים לחנות/לחברה; עדכון בלי השדות לא מוחק; null מוחק', async () => {
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
  it('הנחה קבועה ותקרה לכל חברה, מבצעים; ולידציה; עובד נדחה', async () => {
    await call('setCellCfg', MGR, { carriers: ['פרטנר', 'סלקום'] });
    const r = await call('setCellCfg', MGR, { disc: { 'פרטנר': { t: 'amt', v: 10 }, 'סלקום': { t: 'pct', v: 5 } }, cap: { 'פרטנר': { t: 'amt', v: 50 } }, promos: [PR] });
    assert.equal(r.status, 'OK', r.text);
    const c = await get(`b/${A}/ordcfg/cell`);
    assert.deepEqual(c.carriers, ['פרטנר', 'סלקום']);
    assert.deepEqual(c.disc, { 'פרטנר': { t: 'amt', v: 10 }, 'סלקום': { t: 'pct', v: 5 } });
    assert.deepEqual(c.cap, { 'פרטנר': { t: 'amt', v: 50 } });
    assert.equal(c.promos.length, 1); assert.equal(c.promos[0].on, true); assert.ok(/^p[0-9a-f]{12}$/.test(c.promos[0].id));
    // מחיקת חברה מהמפה – נמחקת בשרת (החלפה, לא מיזוג)
    assert.equal((await call('setCellCfg', MGR, { disc: { 'פרטנר': { t: 'amt', v: 10 } } })).status, 'OK');
    assert.deepEqual((await get(`b/${A}/ordcfg/cell`)).disc, { 'פרטנר': { t: 'amt', v: 10 } });
    assert.equal((await get(`b/${A}/ordcfg/cell`)).promos.length, 1);
    const bads = [{ disc: { 'גולן': { t: 'amt', v: 1 } } }, { disc: { 'פרטנר': { t: 'pct', v: 101 } } }, { cap: { 'פרטנר': { t: 'x', v: 1 } } },
      { promos: [Object.assign({}, PR, { carriers: ['גולן'] })] }, { promos: [Object.assign({}, PR, { min: 0 })] }, { promos: [Object.assign({}, PR, { kind: 'x' })] },
      { promos: [Object.assign({}, PR, { stack: 'x' })] }, { promos: [Object.assign({}, PR, { disc: null })] }, { promos: [Object.assign({}, PR, { from: '2026-12-01', to: '2026-11-01' })] },
      { promos: [Object.assign({}, PR, { zz: 1 })] }, { promos: [Object.assign({}, PR, { id: 'a' }), Object.assign({}, PR, { id: 'a' })] }];
    for (const b of bads) assert.equal((await call('setCellCfg', MGR, b)).status, 'INVALID_ARGUMENT', JSON.stringify(b));
    assert.equal((await call('setCellCfg', E1, { disc: {} })).reason, 'manager-only');
    assert.equal((await call('saveLinePlan', E1, { name: 'x', monthly: 1 })).reason, 'manager-only');
  });
  it('הזמנה ישנה/חבילה ישנה – total לא משתנה אחרי שמירת ההגדרות החדשות', async () => {
    const { p30 } = await setup();
    await call('setCellCfg', MGR, { disc: { 'פרטנר': { t: 'amt', v: 10 } }, promos: [PR] });
    const r = await order(E1, { lines: [{ phone: '0521111111', plan: p30 }, { phone: '0521111112', plan: p30 }, { phone: '0521111113', plan: p30 }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.total, 50);
  });
});
