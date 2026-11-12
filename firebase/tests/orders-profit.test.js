'use strict';
// 2026-11-12: רווחיות הזמנות – עלות נשמרת בהזמנה (it.c), ordProfit (מתג ordP, סניפים, תקופה, בלי מבוטלות, רק ששולמו), הגדרת nc. חלק מ-test:multibiz.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-pf';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'f_mgr', E1 = 'f_e1', E2 = 'f_e2', NOORD = 'f_no', SUPER = 'f_super', PF1 = 'f_pf1';
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
const rid = () => 'req' + Date.now().toString(36) + (n++) + 'cc';
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false };
async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: 'ג', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: ALL,
      org: { v: 1, branches: [{ id: 'br1', name: 'נחל לכיש', on: true, sig: [] }, { id: 'br2', name: 'יהודה הנשיא', on: true, sig: [] }], banks: [], cards: [] } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true, br: ['br1'] });
    b.set(d.doc(`b/${A}/staff/${E2}`), { name: E2, role: 'employee', active: true, br: ['br2'] });
    b.set(d.doc(`b/${A}/staff/${NOORD}`), { name: NOORD, role: 'employee', active: true, perms: NONE });
    b.set(d.doc(`b/${A}/staff/${PF1}`), { name: PF1, role: 'employee', active: true, br: ['br1'], perms: Object.assign({}, NONE, { ord: true, ordP: true }) });
    b.set(d.doc(`b/${A}/prod/pB/p/cost`), { cost: 3 });
    for (const [u, role] of [[MGR, 'admin'], [E1, 'worker'], [E2, 'worker'], [NOORD, 'worker'], [PF1, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    // מוצר ישן – בלי אף שדה חדש
    b.set(d.doc(`b/${A}/prod/pOld`), { name: 'עוגה', price: 10, barcode: '', on: true, q: { br1: 5, br2: 0 } });
    b.set(d.doc(`b/${A}/prod/pB`), { name: 'לחם', price: 7.5, barcode: '729', on: true, q: { br1: 0, br2: 10 } });
    b.set(d.doc(`b/${A}/cust/t000000018`), { name: 'סיטונאי', phone: '0501111111', wholesale: true });
    b.set(d.doc(`b/${A}/cust/p0502222222`), { name: 'רגיל', phone: '0502222222' });
    await b.commit();
  });
}
const cust = { name: 'דנה', phone: '050-1234567' };
const total = async (pid) => { const p = await get(`b/${A}/prod/${pid}`); return Object.values(p.q || {}).reduce((s, v) => s + v, 0); };
before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => seed());

const IL = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const prof = (u, extra) => call('ordProfit', u, Object.assign({ from: IL(), to: IL() }, extra || {}));

describe('רווחיות הזמנות', () => {
  it('העלות נשמרת בשורה ברגע ההזמנה; שינוי עלות אחר כך לא משנה הזמנה קיימת; מוצר בלי עלות – בלי c', async () => {
    const o = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pB', qty: 2, price: 7.5 }, { pid: 'pOld', qty: 1 }, { n: 'ידני', qty: 1, price: 4, c: 1 }] });
    assert.equal(o.status, 'OK', o.text);
    const d = await get(`b/${A}/ord/${o.result.id}`);
    assert.equal(d.items[0].c, 3); assert.equal(d.items[1].c, undefined); assert.equal(d.items[2].c, 1);
    await call('saveProduct', MGR, { id: 'pB', name: 'לחם', price: 7.5, cost: 5 });
    const e = await call('updateOrder', E1, { id: o.result.id, items: [{ pid: 'pB', qty: 3, price: 7.5 }, { pid: 'pOld', qty: 1 }] });
    assert.equal(e.status, 'OK', e.text);
    assert.equal((await get(`b/${A}/ord/${o.result.id}`)).items[0].c, 3, 'שורה שהמוצר שלה כבר היה בהזמנה שומרת את העלות שלה');
    const o2 = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pB', qty: 1, price: 7.5 }] });
    assert.equal((await get(`b/${A}/ord/${o2.result.id}`)).items[0].c, 5, 'הזמנה חדשה – העלות החדשה');
  });
  it('עקיפה: לקוח לא שולח עלות לשורת מוצר', async () => {
    assert.equal((await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pB', qty: 1, price: 7.5, c: 0 }] })).reason, 'bad-items');
  });
  it('ordProfit: סכום, עלות ורווח; בלי מבוטלות; שורה בלי עלות לא נספרת (skip) או עלות 0 (zero); רק ששולמו', async () => {
    const a = await call('createOrder', MGR, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pB', qty: 2, price: 10 }, { pid: 'pOld', qty: 1, price: 6 }] }); // 26, עלות 6, pOld בלי עלות
    const b = await call('createOrder', MGR, { reqId: rid(), br: 'br2', cust, items: [{ pid: 'pB', qty: 1, price: 8 }] }); // 8, עלות 3
    const c = await call('createOrder', MGR, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pB', qty: 5, price: 10 }] });
    assert.equal((await call('cancelOrder', MGR, { id: c.result.id, reason: 'בדיקה' })).status, 'OK');
    let r = await prof(MGR);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.n, 2); assert.equal(r.result.total, 34); assert.equal(r.result.cost, 9); assert.equal(r.result.profit, 19); assert.equal(r.result.miss, 1); assert.equal(r.result.nc, 'skip');
    assert.ok(!r.result.rows.some((x) => x.id === c.result.id), 'מבוטלת לא נספרת');
    assert.equal((await call('setOrderCfg', MGR, { nc: 'zero' })).status, 'OK');
    r = await prof(MGR); assert.equal(r.result.profit, 25); assert.equal(r.result.nc, 'zero');
    assert.equal((await call('markOrderPaid', MGR, { id: b.result.id, method: 'cash' })).status, 'OK');
    r = await prof(MGR, { paid: true }); assert.equal(r.result.n, 1); assert.equal(r.result.rows[0].id, b.result.id); assert.equal(r.result.profit, 5);
    r = await prof(MGR, { br: 'br2' }); assert.equal(r.result.n, 1);
    r = await prof(MGR, { from: '2020-01-01', to: '2020-01-02' }); assert.equal(r.result.n, 0);
    assert.ok(a.result.id);
  });
  it('הרשאה: עובד עם ordP רואה רק את הסניפים שלו; בלי ordP / בלי ord – נחסם; הגדרת nc – מנהל בלבד', async () => {
    await call('createOrder', MGR, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pB', qty: 1, price: 10 }] });
    await call('createOrder', MGR, { reqId: rid(), br: 'br2', cust, items: [{ pid: 'pB', qty: 1, price: 10 }] });
    const r = await prof(PF1); assert.equal(r.status, 'OK', r.text); assert.equal(r.result.n, 1); assert.equal(r.result.rows[0].br, 'br1');
    assert.equal((await prof(PF1, { br: 'br2' })).reason, 'foreign-br');
    await prep((d) => d.doc(`b/${A}/ord/oNoBr`).set({ no: 99, br: '_', status: 'new', total: 50, items: [{ n: 'x', qty: 1, price: 50, c: 1 }], cust: { name: 'סוד' }, at: Date.now() }));
    const r2 = await prof(PF1); assert.ok(!r2.result.rows.some((x) => x.id === 'oNoBr'), 'עובד משויך לסניף לא רואה הזמנה בלי סניף (כמו בחוקים)');
    assert.ok((await prof(MGR)).result.rows.some((x) => x.id === 'oNoBr'), 'מנהל – כן');
    assert.equal((await prof(E1)).reason, 'no-perm');
    assert.equal((await prof(NOORD)).reason, 'no-perm');
    assert.equal((await call('setOrderCfg', PF1, { nc: 'zero' })).reason, 'manager-only');
    assert.equal((await call('setOrderCfg', MGR, { nc: 'all' })).reason, 'bad-nc');
  });
  it('קלט לא תקין: תאריך, תקופה ארוכה מדי, סוף לפני התחלה, שדה לא מוכר', async () => {
    assert.equal((await prof(MGR, { from: '12/11/2026' })).reason, 'bad-date');
    assert.equal((await prof(MGR, { from: '2024-01-01', to: '2026-01-01' })).reason, 'bad-date');
    assert.equal((await prof(MGR, { from: '2026-02-02', to: '2026-02-01' })).reason, 'bad-date');
    assert.equal((await prof(MGR, { from: '2026-02-01', to: '2026-02-31' })).reason, 'bad-date');
    assert.notEqual((await prof(MGR, { x: 1 })).status, 'OK');
  });
});
