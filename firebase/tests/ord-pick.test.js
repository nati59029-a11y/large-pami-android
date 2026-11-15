'use strict';
// 14.11.2026 (משוב בעל הפרויקט סעיף 6, משוב סבב 3): מסך טיפול/ליקוט – functions/ord-pick.js (orderPick, orderPickOk, supOrdSet),
// החסימה של "נשלח"/"ממתין לתשלום" ב-setOrderStatus כשיש שינויים שהלקוח לא אישר, וחוקי supord. רץ מול האמולטור, חלק מ-test:multibiz.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-o';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
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
    b.set(d.doc(`b/${A}/prod/pC`), { name: 'מפית', price: 5, barcode: '', on: true, sup: 'ספק המפיות', q: { br1: 10, br2: 0 } });
    b.set(d.doc(`b/${A}/prod/pD`), { name: 'מפית דומה', price: 6, barcode: '', on: true, q: { br1: 10, br2: 0 } });
    b.set(d.doc(`b/${A}/prod/pD/p/cost`), { cost: 10 });
    b.set(d.doc(`b/${A}/prod/pX`), { name: 'לא זמין', price: 6, barcode: '', on: false, q: { br1: 10 } });
    await b.commit();
  });
}
const cust = { name: 'דנה', phone: '050-1234567' };
before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => seed());

const ITEMS = [{ pid: 'pA', qty: 2, price: 10 }, { pid: 'pB', qty: 1, price: 7.5, from: 'br2' }, { pid: 'pC', qty: 3, price: 5 }];
async function mk(items, extra) {
  const r = await call('createOrder', E1, Object.assign({ reqId: rid(), br: 'br1', cust, items: items || ITEMS }, extra || {}));
  assert.equal(r.status, 'OK', r.text);
  await prep((d) => d.doc(`b/${A}/ord/${r.result.id}`).update({ status: 'work' }));
  return r.result.id;
}
const q = async (pid, br) => (await get(`b/${A}/prod/${pid}`)).q[br];
const keep = (o) => o.items.map((x) => Object.assign({ pid: x.pid, qty: x.qty, price: x.price }, x.from ? { from: x.from } : {}));

describe('ליקוט – יש / להוריד / להזמין, סכום ומלאי (קריטריון ההצלחה)', () => {
  it('3 מוצרים: יש / אין+הורדה / אין+להזמין ← סכום ומלאי נכונים באגורות, supord עם ספק מ-prod.sup, הסיכום שומר "לפני"', async () => {
    const id = await mk();
    assert.equal(await q('pB', 'br2'), 9);
    const rq = rid();
    const r = await call('orderPick', E1, { id, reqId: rq, l: [{ i: 0, ok: true }, { i: 1, ok: false, act: 'rm' }, { i: 2, ok: false, act: 'ord', qty: 3, eta: '2026-11-20' }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.st, 'chg'); assert.equal(r.result.applied, false); assert.equal(r.result.so.length, 1);
    const so = await coll(`b/${A}/supord`);
    assert.equal(so.length, 1);
    assert.deepEqual({ sup: so[0].sup, qty: so[0].qty, eta: so[0].eta, st: so[0].st, pid: so[0].pid, n: so[0].n, br: so[0].br, ord: so[0].ord, cust: so[0].cust }, { sup: 'ספק המפיות', qty: 3, eta: '2026-11-20', st: 'open', pid: 'pC', n: 'מפית', br: 'br1', ord: id, cust: 'דנה' });
    assert.equal(await q('pC', 'br1'), 7, '"להזמין" לא משנה מלאי');
    let o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.pk.st, 'chg'); assert.equal(o.pk.sum.t, 42.5); assert.equal(o.pk.sum.it.length, 3); assert.equal(o.pk.by, E1);
    assert.deepEqual(o.pk.l.map((x) => x.act || 'ok'), ['ok', 'rm', 'ord']);
    // שינוי הפריטים – דרך updateOrder הקיים (מה שהמסך שולח)
    const u = await call('updateOrder', E1, { id, items: keep(o).filter((x, i) => i !== 1) });
    assert.equal(u.status, 'OK', u.text); assert.equal(u.result.total, 35);
    o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.total, 35); assert.equal(Math.round(o.gross * 100), 3500);
    assert.equal(await q('pB', 'br2'), 10, 'המלאי של המוצר שהוסר חזר'); assert.equal(await q('pA', 'br1'), 1); assert.equal(await q('pC', 'br1'), 7);
    assert.equal(o.pk.sum.t, 42.5, 'הסיכום "לפני" לא נדרס');
    // שליחה חוזרת עם אותו reqId אחרי שהפריטים שונו – applied, בלי supord נוסף
    const r2 = await call('orderPick', E1, { id, reqId: rq, l: [{ i: 0, ok: true }, { i: 1, ok: false, act: 'rm' }, { i: 2, ok: false, act: 'ord', qty: 3 }] });
    assert.equal(r2.result.applied, true); assert.equal((await coll(`b/${A}/supord`)).length, 1);
    // אין "ממתין לתשלום" עד "הלקוח אישר" – עובד; מנהל בלי force – גם לא
    assert.equal((await call('setOrderStatus', E1, { id, status: 'wait_pay' })).reason, 'pick-chg');
    assert.equal((await call('setOrderStatus', MGR, { id, status: 'wait_pay' })).reason, 'pick-chg');
    assert.equal((await call('setOrderStatus', E1, { id, status: 'wait_pay', force: true })).reason, 'pick-chg', 'עובד לא עוקף');
    assert.equal((await call('setOrderStatus', E1, { id, status: 'new' })).status, 'OK', 'חזרה ל"חדשה" לא נחסמת');
    assert.equal((await call('setOrderStatus', E1, { id, status: 'work' })).status, 'OK');
    const ok = await call('orderPickOk', E1, { id });
    assert.equal(ok.status, 'OK', ok.text);
    o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.pk.st, 'ok'); assert.equal(o.pk.okBy, E1); assert.equal(typeof o.pk.okAt, 'number');
    assert.deepEqual((await call('orderPickOk', E1, { id })).result, { ok: true, dup: true });
    assert.equal((await call('setOrderStatus', E1, { id, status: 'wait_pay' })).status, 'OK');
    const lg = await coll(`b/${A}/ord/${id}/log`);
    assert.equal(lg.filter((x) => x.act === 'pick').length, 1); assert.equal(lg.filter((x) => x.act === 'pickok').length, 1);
  });
  it('הכול במלאי ← st ok, לא נחסם; הזמנה ישנה בלי pk – כמו היום', async () => {
    const id = await mk();
    const r = await call('orderPick', E1, { id, reqId: rid(), l: [0, 1, 2].map((i) => ({ i, ok: true })) });
    assert.equal(r.result.st, 'ok');
    assert.equal((await call('setOrderStatus', E1, { id, status: 'wait_pay' })).status, 'OK');
    const id2 = await mk();
    assert.equal((await get(`b/${A}/ord/${id2}`)).pk, undefined);
    assert.equal((await call('setOrderStatus', E1, { id: id2, status: 'wait_pay' })).status, 'OK');
  });
  it('מנהל עוקף עם force – נרשם ביומן pickforce; לקוח בשוטף: "נשלח" נחסם עד אישור', async () => {
    await prep((d) => d.doc(`b/${A}/cust/cT`).set({ name: 'שוטף 30', bn: 'חברה', phone: '0541111111', terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} }));
    const id = await mk(null, { custId: 'cT' });
    await call('orderPick', E1, { id, reqId: rid(), l: [{ i: 0, ok: true }, { i: 1, ok: false, act: 'rm' }, { i: 2, ok: true }] });
    assert.equal((await call('setOrderStatus', E1, { id, status: 'out' })).reason, 'pick-chg');
    assert.equal((await get(`b/${A}/ord/${id}`)).shp, undefined);
    const f = await call('setOrderStatus', MGR, { id, status: 'out', force: true });
    assert.equal(f.status, 'OK', f.text); assert.equal(f.result.status, 'wait_pay');
    assert.ok((await get(`b/${A}/ord/${id}`)).shp);
    assert.equal((await coll(`b/${A}/ord/${id}/log`)).filter((x) => x.act === 'pickforce').length, 1);
    assert.equal((await call('setOrderStatus', MGR, { id, status: 'out', force: 'yes' })).reason, 'bad-field');
  });
});

describe('ליקוט – מוצר דומה, מינימום מחיר, ניסיון חוזר', () => {
  it('החלפה: מחיר לפי כללי המחיר (בלי מחיר ← ברירת מחדל), מלאי הישן חוזר והחדש יורד; הסיכום שומר את שם החלופי', async () => {
    const id = await mk([{ pid: 'pA', qty: 2, price: 10 }]);
    const r = await call('orderPick', E1, { id, reqId: rid(), l: [{ i: 0, ok: false, act: 'rep', pid: 'pD' }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.st, 'chg');
    assert.deepEqual((await get(`b/${A}/ord/${id}`)).pk.l[0].rep, { pid: 'pD', n: 'מפית דומה' });
    const u = await call('updateOrder', E1, { id, items: [{ pid: 'pD', qty: 2 }] });
    assert.equal(u.status, 'OK', u.text); assert.equal(u.result.total, 12);
    assert.equal(await q('pA', 'br1'), 3); assert.equal(await q('pD', 'br1'), 8);
    assert.equal((await get(`b/${A}/ord/${id}`)).items[0].price, 6);
  });
  it('החלפה מתחת למינימום לעובד ← price-floor (הפריטים לא משתנים); מנהל עוקף', async () => {
    await prep((d) => d.doc(`b/${A}/ordcfg/price`).set({ pct: 10 }));
    const id = await mk([{ pid: 'pA', qty: 1, price: 10 }]);
    await call('orderPick', E1, { id, reqId: rid(), l: [{ i: 0, ok: false, act: 'rep', pid: 'pD' }] });
    const u = await call('updateOrder', E1, { id, items: [{ pid: 'pD', qty: 1 }] });
    assert.equal(u.reason, 'price-floor');
    assert.equal((await get(`b/${A}/ord/${id}`)).items[0].pid, 'pA'); assert.equal(await q('pD', 'br1'), 10);
    assert.equal((await call('updateOrder', MGR, { id, items: [{ pid: 'pD', qty: 1 }] })).status, 'OK');
  });
  it('אותו reqId לפני שהפריטים שונו: הסימונים מתעדכנים, supord שבוטל מסומן void (לא נמחק); שליחה כפולה ← supord אחד', async () => {
    const id = await mk();
    const rq = rid();
    const L1 = [{ i: 0, ok: true }, { i: 1, ok: true }, { i: 2, ok: false, act: 'ord', qty: 3, sup: 'ספק אחר' }];
    const [a, b] = await Promise.all([call('orderPick', E1, { id, reqId: rq, l: L1 }), call('orderPick', E1, { id, reqId: rq, l: L1 })]);
    assert.equal(a.status, 'OK', a.text); assert.equal(b.status, 'OK', b.text);
    let so = await coll(`b/${A}/supord`);
    assert.equal(so.length, 1); assert.equal(so[0].sup, 'ספק אחר', 'ספק שהעובד שינה גובר על prod.sup');
    await call('orderPick', E1, { id, reqId: rq, l: [{ i: 0, ok: true }, { i: 1, ok: true }, { i: 2, ok: false, act: 'rm' }] });
    so = await coll(`b/${A}/supord`);
    assert.equal(so.length, 1); assert.equal(so[0].st, 'void');
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.pk.l[2].act, 'rm'); assert.equal(o.pk.sum.t, 42.5);
  });
});

describe('ליקוט – קלט, נעילה והרשאות', () => {
  it('קלט: חסר סימון / כפול / בלי פעולה / הכול להוריד / מוצר חלופי לא קיים או לא זמין / שורה ידנית בלי ספק / תאריך לא תקין', async () => {
    const id = await mk([{ pid: 'pA', qty: 1, price: 10 }, { n: 'משלוח', qty: 1, price: 15 }]);
    const t = async (l) => (await call('orderPick', E1, { id, reqId: rid(), l })).reason;
    assert.equal(await t([{ i: 0, ok: true }]), 'bad-pick');
    assert.equal(await t([{ i: 0, ok: true }, { i: 0, ok: true }]), 'bad-pick');
    assert.equal(await t([{ i: 0, ok: true }, { i: 1, ok: false }]), 'no-act');
    assert.equal(await t([{ i: 0, ok: false, act: 'rm' }, { i: 1, ok: false, act: 'rm' }]), 'all-rm');
    assert.equal(await t([{ i: 0, ok: false, act: 'rep', pid: 'nope' }, { i: 1, ok: true }]), 'no-prod');
    assert.equal(await t([{ i: 0, ok: false, act: 'rep', pid: 'pX' }, { i: 1, ok: true }]), 'prod-off');
    assert.equal(await t([{ i: 0, ok: true }, { i: 1, ok: false, act: 'ord', qty: 1 }]), 'no-sup');
    assert.equal(await t([{ i: 0, ok: false, act: 'ord', qty: 1, eta: '20-11-2026' }, { i: 1, ok: true }]), 'bad-eta');
    assert.equal(await t([{ i: 0, ok: false, act: 'ord', qty: 0 }, { i: 1, ok: true }]), 'bad-qty');
    assert.equal((await call('orderPick', E1, { id, l: [{ i: 0, ok: true }, { i: 1, ok: true }] })).reason, 'bad-req');
    assert.equal((await get(`b/${A}/ord/${id}`)).pk, undefined);
    assert.equal((await coll(`b/${A}/supord`)).length, 0);
  });
  it('נעילה: שולמה / בוטלה / נשלחה ← locked; orderPickOk בלי ליקוט ← no-pick', async () => {
    for (const x of [{ status: 'paid' }, { status: 'cancel' }, { status: 'wait_pay', shp: { at: 1, by: E1 } }]) {
      const id = await mk([{ pid: 'pA', qty: 1, price: 10 }]);
      await prep((d) => d.doc(`b/${A}/ord/${id}`).update(x));
      assert.equal((await call('orderPick', E1, { id, reqId: rid(), l: [{ i: 0, ok: true }] })).reason, 'locked', JSON.stringify(x));
    }
    const id = await mk([{ pid: 'pA', qty: 1, price: 10 }]);
    assert.equal((await call('orderPickOk', E1, { id })).reason, 'no-pick');
  });
  it('הרשאות: עובד מסניף אחר ← foreign-br; בלי הרשאת הזמנות ← no-perm; supOrdSet לפי סניף, לא משנה מלאי', async () => {
    const id = await mk();
    const L = [{ i: 0, ok: true }, { i: 1, ok: true }, { i: 2, ok: false, act: 'ord', qty: 2 }];
    assert.equal((await call('orderPick', E2, { id, reqId: rid(), l: L })).reason, 'foreign-br');
    assert.equal((await call('orderPick', NOORD, { id, reqId: rid(), l: L })).reason, 'no-perm');
    assert.equal((await call('orderPick', E1, { id, reqId: rid(), l: L })).status, 'OK');
    await call('orderPickOk', E2, { id }).then((r) => assert.equal(r.reason, 'foreign-br'));
    const [so] = await coll(`b/${A}/supord`);
    const q0 = await q('pC', 'br1');
    assert.equal((await call('supOrdSet', E2, { id: so.id, st: 'ord' })).reason, 'foreign-br');
    assert.equal((await call('supOrdSet', E1, { id: so.id, st: 'ord' })).status, 'OK');
    assert.equal((await call('supOrdSet', MGR, { id: so.id, st: 'done' })).status, 'OK');
    assert.equal((await call('supOrdSet', E1, { id: so.id, st: 'x' })).reason, 'bad-status');
    assert.equal((await call('supOrdSet', E1, { id: 'nope', st: 'ord' })).status, 'NOT_FOUND');
    const s1 = await get(`b/${A}/supord/${so.id}`);
    assert.equal(s1.st, 'done'); assert.equal(s1.sby, MGR);
    assert.equal(await q('pC', 'br1'), q0, 'הגיע – לא משנה מלאי (מכניסים ב"הכנסת מלאי")');
  });
  it('חוקים: supord – עובד בסניף ומנהל קוראים, עובד מסניף אחר לא; אין כתיבה מהאפליקציה', async () => {
    const id = await mk();
    await call('orderPick', E1, { id, reqId: rid(), l: [{ i: 0, ok: true }, { i: 1, ok: true }, { i: 2, ok: false, act: 'ord', qty: 2 }] });
    const [so] = await coll(`b/${A}/supord`);
    await assertSucceeds(db(E1).doc(`b/${A}/supord/${so.id}`).get());
    await assertSucceeds(db(MGR).doc(`b/${A}/supord/${so.id}`).get());
    await assertSucceeds(db(MGR).collection(`b/${A}/supord`).get());
    await assertFails(db(E2).doc(`b/${A}/supord/${so.id}`).get());
    await assertFails(db(NOORD).doc(`b/${A}/supord/${so.id}`).get());
    for (const u of [E1, MGR]) {
      await assertFails(db(u).doc(`b/${A}/supord/${so.id}`).update({ st: 'done' }));
      await assertFails(db(u).doc(`b/${A}/supord/x1`).set({ ord: id, br: 'br1', st: 'open' }));
      await assertFails(db(u).doc(`b/${A}/ord/${id}`).update({ 'pk.st': 'ok' }));
    }
  });
});
