'use strict';
// 15.11.2026 (החלטה 32, חלק א): אמצעי גבייה לכל עסק וחיוב אחרי ליקוט – setBusinessPayLink (kind/after/mg/chg), getPayLink (fr, send),
// orderAuth ("המסגרת אושרה", ord-pick.js) ו-markOrderPaid { amt } ("חויב" – רק הסכום הסופי, אחרי ליקוט, בתוך המסגרת). רץ מול האמולטור, test:multibiz:3.
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


const L0 = 'https://pay.example.com/biz';
const setPay = (d) => call('setBusinessPayLink', SUPER, Object.assign({ bizId: A, mode: 'link', link: L0 }, d || {}));
const allOk = (n) => Array.from({ length: n }, (_, i) => ({ i, ok: true }));
const paidLink = (u, id, amt) => call('markOrderPaid', u, { id, method: 'link', amt });

describe('הגדרות העסק – אמצעי גבייה, חיוב אחרי ליקוט, מרווח, אופן חיוב', () => {
  it('ברירת מחדל = כמו היום: ordcfg/main.pay בלי שדות חדשים; private/pay עם ברירות המחדל', async () => {
    const r = await setPay();
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual({ kind: r.result.kind, after: r.result.after, mg: r.result.mg, chg: r.result.chg }, { kind: 'link', after: false, mg: 10, chg: 'man' });
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'link', has: true, cred: false });
    const p = await get(`b/${A}/private/pay`);
    assert.deepEqual({ kind: p.kind, after: p.after, mg: p.mg, chg: p.chg, mode: p.mode }, { kind: 'link', after: false, mg: 10, chg: 'man', mode: 'link' });
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone' })).status, 'OK');
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'phone', has: false, cred: false });
    assert.equal((await get(`b/${A}/private/pay`)).kind, 'phone');
  });
  it('שניהם + חיוב אחרי ליקוט + מרווח 15 + אוטומטי נשמרים; אפליקציה ישנה (רק mode+link) לא מאפסת; מעבר לפרטי אשראי מאפס', async () => {
    const r = await setPay({ kind: 'both', after: true, mg: 15, chg: 'auto' });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'link', has: true, cred: false, kind: 'both', after: true, mg: 15, chg: 'auto' });
    assert.equal((await setPay()).status, 'OK');
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'link', has: true, cred: false, kind: 'both', after: true, mg: 15, chg: 'auto' }, 'שמירה בלי השדות – הקודמים נשארים');
    assert.equal((await setPay({ kind: 'link', after: false, mg: 10, chg: 'man' })).status, 'OK');
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'link', has: true, cred: false });
    await setPay({ kind: 'both', after: true });
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone' })).status, 'OK');
    const p = await get(`b/${A}/private/pay`);
    assert.equal(p.kind, 'phone'); assert.equal(p.after, false);
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'phone', has: false, cred: false });
    assert.ok((await coll(`b/${A}/audit`)).some((x) => x.act === 'setBusinessPayLink' && /kind=both/.test(x.note) && / after/.test(x.note)));
  });
  it('אימות: kind/after/mg/chg לא תקינים נדחים; רק מנהל־על', async () => {
    for (const u of [MGR, E1]) assert.equal((await call('setBusinessPayLink', u, { bizId: A, mode: 'link', link: L0, after: true })).reason, 'not-superadmin');
    assert.equal((await setPay({ kind: 'phone' })).reason, 'bad-kind');
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone', kind: 'both' })).reason, 'bad-kind');
    assert.equal((await setPay({ kind: 'x' })).reason, 'bad-kind');
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone', after: true })).reason, 'bad-after');
    assert.equal((await setPay({ after: 'yes' })).reason, 'bad-field');
    for (const mg of [-1, 51, '10', 10.123, null]) assert.equal((await setPay({ mg })).reason, 'bad-mg', String(mg));
    for (const mg of [0, 50, 12.5]) assert.equal((await setPay({ mg })).status, 'OK', String(mg));
    assert.equal((await setPay({ chg: 'x' })).reason, 'bad-chg');
    assert.equal((await setPay({ evil: 1 })).reason, 'bad-field');
  });
});

describe('תאימות – עסק בלי "חיוב אחרי ליקוט" ממשיך בדיוק כמו היום', () => {
  it('getPayLink בלי fr; orderAuth ← no-after; "שולם" רגיל כמו קודם; "חויב" עם amt ← no-auth', async () => {
    await setPay();
    const id = await mk();
    const g = await call('getPayLink', E1, { id });
    assert.deepEqual(g.result, { link: L0, total: 42.5 });
    assert.equal((await call('orderAuth', E1, { id, amt: 47, via: 'link' })).reason, 'no-after');
    assert.equal((await paidLink(E1, id, 42.5)).reason, 'no-auth');
    const p = await call('markOrderPaid', E1, { id, method: 'link' });
    assert.equal(p.status, 'OK', p.text);
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.status, 'paid'); assert.equal(o.paid.amt, 42.5); assert.equal(o.paid.fr, undefined); assert.equal(o.auth, undefined);
  });
  it('עסק בתשלום בטלפון (פרטי אשראי) – orderAuth ← no-after', async () => {
    await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone' });
    const id = await mk();
    assert.equal((await call('orderAuth', E1, { id, amt: 47, via: 'call' })).reason, 'no-after');
  });
});

describe('מסגרת – "המסגרת אושרה"', () => {
  beforeEach(() => setPay({ after: true }));
  it('מסגרת = סכום × 1.1 מעוגל לשקל למעלה; send:true נרשם paySend; orderAuth שומר auth ויומן', async () => {
    const id = await mk();
    const g = await call('getPayLink', E1, { id, send: true });
    assert.equal(g.status, 'OK', g.text); assert.equal(g.result.fr, 47); assert.equal(g.result.total, 42.5);
    assert.equal((await call('getPayLink', E1, { id, send: 'x' })).reason, 'bad-field');
    const r = await call('orderAuth', E1, { id, amt: 47, via: 'link', last4: '1234' });
    assert.equal(r.status, 'OK', r.text);
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.auth.amt, 47); assert.equal(o.auth.due, 42.5); assert.equal(o.auth.mg, 10); assert.equal(o.auth.via, 'link'); assert.equal(o.auth.last4, '1234'); assert.equal(o.auth.by, E1);
    assert.equal(o.status, 'work', 'הסטטוס לא משתנה');
    const lg = await coll(`b/${A}/ord/${id}/log`);
    assert.ok(lg.some((x) => x.act === 'paySend')); assert.ok(lg.some((x) => x.act === 'auth' && /47/.test(x.note) && /1234/.test(x.note)));
    await setPay({ mg: 20 });
    assert.equal((await call('getPayLink', E1, { id })).result.fr, 51);
  });
  it('אימות: מתחת לסכום ההזמנה, מספר כרטיס, via, סכום; הרשאות; לקוח בשוטף; הזמנה ששולמה', async () => {
    const id = await mk();
    assert.equal((await call('orderAuth', E1, { id, amt: 42.49, via: 'link' })).reason, 'auth-low');
    assert.equal((await call('orderAuth', E1, { id, amt: 42.5, via: 'call' })).status, 'OK', 'בדיוק הסכום – מותר');
    assert.equal((await call('orderAuth', E1, { id, amt: 47, via: 'call', last4: '4580 1234 5678 9012' })).reason, 'card-like');
    assert.equal((await call('orderAuth', E1, { id, amt: 47, via: 'call', last4: '4580123456789012' })).reason, 'card-like');
    assert.equal((await call('orderAuth', E1, { id, amt: 47, via: 'call', last4: '12a4' })).reason, 'bad-last4');
    assert.equal((await call('orderAuth', E1, { id, amt: 47, via: 'sms' })).reason, 'bad-via');
    assert.equal((await call('orderAuth', E1, { id, amt: 0, via: 'call' })).reason, 'bad-price');
    assert.equal((await call('orderAuth', E1, { id, amt: '47', via: 'call' })).reason, 'bad-price');
    assert.equal((await call('orderAuth', E1, { id, amt: 47, via: 'call', card: '4580123456789012' })).reason, 'bad-field');
    assert.equal((await call('orderAuth', E2, { id, amt: 47, via: 'call' })).reason, 'foreign-br');
    assert.notEqual((await call('orderAuth', NOORD, { id, amt: 47, via: 'call' })).status, 'OK');
    assert.equal((await call('orderAuth', null, { id, amt: 47, via: 'call' })).status, 'UNAUTHENTICATED');
    assert.equal((await call('orderAuth', MGR, { id, amt: 48, via: 'call' })).status, 'OK');
    assert.equal((await get(`b/${A}/ord/${id}`)).auth.amt, 48, 'אישור חוזר מחליף');
    assert.ok(!JSON.stringify(await get(`b/${A}/ord/${id}`)).includes('4580'), 'מספר הכרטיס לא נשמר');
    // לקוח בשוטף (החלטות 13, 18) – בלי מסגרת
    const t = await mk();
    await prep(async (d) => { await d.doc(`b/${A}/cust/c1`).set({ name: 'עסק', phone: '0501234567', wholesale: true, pay: 'n30' }); await d.doc(`b/${A}/ord/${t}`).update({ custId: 'c1' }); });
    assert.equal((await call('orderAuth', E1, { id: t, amt: 47, via: 'call' })).reason, 'terms');
    // לקוח מיידי – מותר
    await prep((d) => d.doc(`b/${A}/cust/c1`).update({ pay: 'cash' }));
    assert.equal((await call('orderAuth', E1, { id: t, amt: 47, via: 'call' })).status, 'OK');
    // הזמנה ששולמה / בוטלה
    await call('markOrderPaid', E1, { id: t, method: 'cash' });
    assert.equal((await call('orderAuth', E1, { id: t, amt: 47, via: 'call' })).reason, 'bad-status');
  });
});

describe('"חויב" בסוף הליקוט – בתוך המסגרת / מעל המסגרת', () => {
  beforeEach(() => setPay({ after: true }));
  it('בתוך המסגרת: רק אחרי ליקוט, רק הסכום הסופי, רק בקישור → שולם עם paid.amt = הסופי ו-paid.fr', async () => {
    const id = await mk();
    assert.equal((await call('orderAuth', E1, { id, amt: 47, via: 'link' })).status, 'OK');
    assert.equal((await paidLink(E1, id, 42.5)).reason, 'no-pick');
    assert.equal((await call('orderPick', E1, { id, reqId: rid(), l: allOk(3) })).result.st, 'ok');
    assert.equal((await paidLink(E1, id, 40)).reason, 'amt-mismatch');
    assert.equal((await paidLink(E1, id, 47)).reason, 'amt-mismatch', 'גם לא סכום המסגרת');
    assert.equal((await call('markOrderPaid', E1, { id, method: 'cash', amt: 42.5 })).reason, 'bad-method');
    assert.equal((await paidLink(E1, id, 'x')).reason, 'bad-price');
    const r = await paidLink(E1, id, 42.5);
    assert.equal(r.status, 'OK', r.text);
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.status, 'paid'); assert.equal(o.paid.method, 'link'); assert.equal(o.paid.amt, 42.5); assert.equal(o.paid.fr, 47);
    assert.ok((await coll(`b/${A}/ord/${id}/log`)).some((x) => x.act === 'paid' && /מסגרת ₪47/.test(x.note)));
    assert.equal((await paidLink(E1, id, 42.5)).result.dup, true, 'שוב – dup');
  });
  it('שינויים בליקוט: עד "הלקוח אישר" ← pick-chg; אחרי ההורדה הסכום ירד ← חויב על הסכום החדש', async () => {
    const id = await mk();
    await call('orderAuth', E1, { id, amt: 47, via: 'call' });
    const rq = rid();
    const p = await call('orderPick', E1, { id, reqId: rq, l: [{ i: 0, ok: true }, { i: 1, ok: false, act: 'rm' }, { i: 2, ok: true }] });
    assert.equal(p.result.st, 'chg');
    const o0 = await get(`b/${A}/ord/${id}`);
    assert.equal((await call('updateOrder', E1, { id, items: [keep(o0)[0], keep(o0)[2]], ver: p.result.upd })).status, 'OK');
    assert.equal((await paidLink(E1, id, 35)).reason, 'pick-chg');
    assert.equal((await call('orderPickOk', E1, { id })).status, 'OK');
    assert.equal((await paidLink(E1, id, 42.5)).reason, 'amt-mismatch');
    const r = await paidLink(E1, id, 35);
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/ord/${id}`)).paid.amt, 35);
  });
  it('מעל המסגרת ← over-auth; מסגרת חדשה (קישור חדש) ← חויב', async () => {
    const id = await mk();
    await call('orderAuth', E1, { id, amt: 43, via: 'link' });
    const o0 = await get(`b/${A}/ord/${id}`);
    const it = keep(o0); it[0].qty = 3; // 52.5
    assert.equal((await call('updateOrder', E1, { id, items: it })).status, 'OK');
    await call('orderPick', E1, { id, reqId: rid(), l: allOk(3) });
    assert.equal((await paidLink(E1, id, 52.5)).reason, 'over-auth');
    assert.equal((await get(`b/${A}/ord/${id}`)).status, 'work');
    assert.equal((await call('getPayLink', E1, { id, send: true })).result.fr, 58);
    assert.equal((await call('orderAuth', E1, { id, amt: 58, via: 'link' })).status, 'OK');
    assert.equal((await paidLink(E1, id, 52.5)).status, 'OK');
    assert.equal((await get(`b/${A}/ord/${id}`)).paid.fr, 58);
  });
});

describe('תיקון סבב 1 – "סמן שולם" בקישור בעסק עם חיוב אחרי ליקוט, ושינוי אחרי הליקוט', () => {
  beforeEach(() => setPay({ after: true }));
  it('קישור בלי amt ← use-charge (גם מנהל); מזומן / העברה / טלפון / אחר – כמו היום', async () => {
    const id = await mk();
    for (const u of [E1, MGR]) {
      const r = await call('markOrderPaid', u, { id, method: 'link' });
      assert.equal(r.reason, 'use-charge', r.text);
      assert.match(r.text, /חויב/);
    }
    assert.equal((await get(`b/${A}/ord/${id}`)).status, 'work', 'לא נרשם תשלום');
    for (const m of ['cash', 'transfer', 'phone', 'other']) {
      const o = await mk();
      const r = await call('markOrderPaid', E1, { id: o, method: m });
      assert.equal(r.status, 'OK', m + ': ' + r.text);
      assert.equal((await get(`b/${A}/ord/${o}`)).paid.method, m);
    }
  });
  it('תרחיש הבודק: ליקוט ok ← updateOrder מוסיף מוצר ← חויב נדחה (pick-old) ← ליקוט מחדש ← חויב עובר', async () => {
    const id = await mk([{ pid: 'pA', qty: 2, price: 10 }]); // 20
    assert.equal((await call('orderAuth', E1, { id, amt: 30, via: 'link' })).status, 'OK');
    assert.equal((await call('orderPick', E1, { id, reqId: rid(), l: allOk(1) })).result.st, 'ok');
    const f0 = (await get(`b/${A}/ord/${id}`)).pk.fin;
    assert.equal(f0.due, 20); assert.equal(typeof f0.k, 'string');
    const o0 = await get(`b/${A}/ord/${id}`);
    assert.equal((await call('updateOrder', E1, { id, items: keep(o0).concat([{ pid: 'pC', qty: 1, price: 5 }]) })).status, 'OK');
    const r1 = await paidLink(E1, id, 25);
    assert.equal(r1.reason, 'pick-old', r1.text);
    assert.match(r1.text, /יש ללקט מחדש/);
    assert.equal((await get(`b/${A}/ord/${id}`)).status, 'work');
    assert.equal((await call('orderPick', E1, { id, reqId: rid(), l: allOk(2) })).result.st, 'ok');
    const r2 = await paidLink(E1, id, 25);
    assert.equal(r2.status, 'OK', r2.text);
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.paid.amt, 25); assert.equal(o.paid.fr, 30);
  });
  it('שינוי מחיר בלבד אחרי הליקוט ← pick-old; אחרי "הלקוח אישר" החותמת מהפריטים אחרי ההורדה; הזמנה ישנה בלי fin – לא נחסמת', async () => {
    const id = await mk();
    await call('orderAuth', E1, { id, amt: 60, via: 'call' });
    await call('orderPick', E1, { id, reqId: rid(), l: allOk(3) });
    const it = keep(await get(`b/${A}/ord/${id}`)); it[0].price = 11; // 44.5
    assert.equal((await call('updateOrder', E1, { id, items: it })).status, 'OK');
    assert.equal((await paidLink(E1, id, 44.5)).reason, 'pick-old');
    // הורדה בליקוט + "הלקוח אישר" – החותמת נלקחת אחרי ההורדה, ולכן חויב עובר
    const rq = rid();
    const p = await call('orderPick', E1, { id, reqId: rq, l: [{ i: 0, ok: true }, { i: 1, ok: false, act: 'rm' }, { i: 2, ok: true }] });
    assert.equal(p.result.st, 'chg');
    const o1 = await get(`b/${A}/ord/${id}`);
    assert.equal((await call('updateOrder', E1, { id, items: [keep(o1)[0], keep(o1)[2]], ver: p.result.upd })).status, 'OK');
    assert.equal((await call('orderPickOk', E1, { id })).status, 'OK');
    assert.equal((await get(`b/${A}/ord/${id}`)).pk.fin.due, 37);
    assert.equal((await paidLink(E1, id, 37)).status, 'OK');
    // הזמנה ישנה: pk.st 'ok' בלי fin – שינוי אחרי הליקוט לא חוסם (כמו קודם)
    const old = await mk();
    await call('orderAuth', E1, { id: old, amt: 60, via: 'call' });
    await call('orderPick', E1, { id: old, reqId: rid(), l: allOk(3) });
    const pk0 = (await get(`b/${A}/ord/${old}`)).pk; delete pk0.fin;
    await prep((d) => d.doc(`b/${A}/ord/${old}`).update({ pk: pk0 }));
    const it2 = keep(await get(`b/${A}/ord/${old}`)); it2[0].qty = 3; // 52.5
    assert.equal((await call('updateOrder', E1, { id: old, items: it2 })).status, 'OK');
    assert.equal((await paidLink(E1, old, 52.5)).status, 'OK');
  });
});
