'use strict';
// מערכת הזמנות שלב 1: functions/orders.js + חוקי ord/prod/stockLog/ordcfg. רץ מול האמולטור, חלק מ-test:multibiz.
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
    await b.commit();
  });
}
const cust = { name: 'דנה', phone: '050-1234567' };
before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => seed());

describe('הזמנות – יצירה, סכום, מספור, idempotency', () => {
  it('עובד בסניף 1: סכום מחושב בשרת (total מהלקוח מתעלמים), מספר רץ, מלאי יורד, stockLog', async () => {
    const r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, total: 1, items: [{ pid: 'pA', qty: 2, price: 9.9 }, { n: 'משלוח', qty: 1, price: 15 }] });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.no, 1); assert.equal(r.result.total, 34.8);
    const o = await get(`b/${A}/ord/${r.result.id}`);
    assert.equal(o.total, 34.8); assert.equal(o.br, 'br1'); assert.equal(o.status, 'new'); assert.equal(o.cust.phone, '0501234567');
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 1);
    const r2 = await call('createOrder', MGR, { reqId: rid(), br: 'br2', cust, items: [{ pid: 'pB', qty: 1, price: 7.5 }] });
    assert.equal(r2.result.no, 2);
  });
  it('אותו reqId פעמיים (גם במקביל) = הזמנה אחת, מלאי יורד פעם אחת', async () => {
    const q = rid();
    const d = { reqId: q, br: 'br1', cust, items: [{ pid: 'pA', qty: 1, price: 10 }] };
    const rs = await Promise.all([call('createOrder', E1, d), call('createOrder', E1, d)]);
    assert.ok(rs.every((x) => x.status === 'OK'), rs.map((x) => x.text).join());
    assert.equal((await coll(`b/${A}/ord`)).length, 1);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 2);
  });
  it('שתי הזמנות שונות במקביל על אותו מוצר – הכמות נכונה, מספרים 1 ו-2', async () => {
    const rs = await Promise.all([1, 2].map(() => call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 1, price: 10 }] })));
    assert.deepEqual(rs.map((x) => x.result.no).sort(), [1, 2]);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 1);
  });
  it('אין מספיק במלאי: נשמרת, מינוס, ואזהרה', async () => {
    await prep((d) => d.doc(`b/${A}/ordcfg/main`).set({ src: { br1: 'br1' } }));
    const r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 5, price: 10 }] });
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, -2);
    assert.equal(r.result.warn.length, 1);
  });
  it('ולידציה: טלפון, מספר כרטיס בהערה/שם, פריטים ריקים, שדה לא מוכר, סניף זר', async () => {
    const base = () => ({ reqId: rid(), br: 'br1', cust: Object.assign({}, cust), items: [{ n: 'x', qty: 1, price: 1 }] });
    const cases = [[(d) => { d.cust.phone = '123'; }, 'bad-phone'], [(d) => { d.note = 'כרטיס 4580 1234 5678 9012'; }, 'card-like'],
      [(d) => { d.cust.name = '4580123456789012'; }, 'card-like'], [(d) => { d.items = []; }, 'bad-items'], [(d) => { d.evil = 1; }, 'bad-field'],
      [(d) => { d.items[0].price = -1; }, 'bad-price'], [(d) => { d.br = 'br2'; }, 'foreign-br'], [(d) => { delete d.br; }, 'bad-br']];
    for (const [f, reason] of cases) { const d = base(); f(d); const r = await call('createOrder', E1, d); assert.equal(r.reason, reason, r.text); }
    assert.equal((await coll(`b/${A}/ord`)).length, 0);
  });
  it('בלי ord / תוספת כבויה / לא מחובר – נדחה', async () => {
    const d = { reqId: rid(), br: 'br1', cust, items: [{ n: 'x', qty: 1, price: 1 }] };
    assert.equal((await call('createOrder', NOORD, d)).reason, 'no-perm');
    assert.equal((await call('createOrder', null, d)).status, 'UNAUTHENTICATED');
    await seed(Object.assign({}, ALL, { orders: false }));
    assert.equal((await call('createOrder', MGR, d)).reason, 'feature-off');
  });
});

describe('מלאי בין סניפים (אפשרות ב)', () => {
  it('"לפי המלאי": הזמנה בסניף 1 של לחם (יש רק בסניף 2) → xout בסניף 2, xin+order בסניף 1', async () => {
    const r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pB', qty: 4, price: 7.5 }] });
    assert.equal(r.status, 'OK', r.text);
    const o = await get(`b/${A}/ord/${r.result.id}`);
    assert.equal(o.items[0].from, 'br2');
    const p = await get(`b/${A}/prod/pB`); assert.equal(p.q.br2, 6); assert.equal(p.q.br1, 0);
    const L = await coll(`b/${A}/stockLog`);
    assert.deepEqual(L.map((x) => x.why + ':' + x.br + ':' + x.delta).sort(), ['order:br1:-4', 'xin:br1:4', 'xout:br2:-4']);
    // ביטול מחזיר
    assert.equal((await call('cancelOrder', E1, { id: r.result.id, reason: 'טעות' })).status, 'OK');
    const p2 = await get(`b/${A}/prod/pB`); assert.equal(p2.q.br2, 10); assert.equal(p2.q.br1, 0);
  });
  it('העובד בוחר סניף מקור אחר (from); מקור קבוע בהגדרה גובר', async () => {
    let r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 1, price: 10, from: 'br2' }] });
    assert.equal((await get(`b/${A}/prod/pA`)).q.br2, -1);
    assert.equal((await call('setOrderCfg', E1, { src: { br1: 'br2' } })).reason, 'manager-only');
    assert.equal((await call('setOrderCfg', MGR, { src: { br1: 'br2' } })).status, 'OK');
    r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 1, price: 10, from: 'br1' }] });
    assert.equal((await get(`b/${A}/ord/${r.result.id}`)).items[0].from, 'br2');
  });
});

describe('סטטוסים, תשלום, נעילה', () => {
  async function mk(u) { return (await call('createOrder', u || E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 1, price: 10 }] })).result.id; }
  it('טבלת מעברים מלאה', async () => {
    const ST = ['new', 'work', 'wait_pay', 'paid', 'out', 'done', 'cancel'];
    const OK = { new: ['work', 'wait_pay'], work: ['wait_pay', 'new'], wait_pay: ['work'], paid: ['out', 'done'], out: ['done'], done: [], cancel: [] };
    for (const from of ST) for (const to of ST) {
      const id = await mk();
      await prep((d) => d.doc(`b/${A}/ord/${id}`).update({ status: from }));
      const r = await call('setOrderStatus', E1, { id, status: to });
      assert.equal(r.status === 'OK', OK[from].includes(to), `${from}→${to}: ${r.text}`);
    }
  });
  it('שולם: last4 3/5 ספרות נדחה; אישור עם 16 ספרות נדחה; אחרי שולם – עריכה נדחית; ביטול שולם – מנהל בלבד עם סיבה', async () => {
    const id = await mk();
    for (const l of ['123', '12345', '12a4']) assert.equal((await call('markOrderPaid', E1, { id, method: 'phone', last4: l })).reason, 'bad-last4');
    assert.equal((await call('markOrderPaid', E1, { id, method: 'phone', conf: '4580123456789012' })).reason, 'card-like');
    assert.equal((await call('markOrderPaid', E1, { id, method: 'phone', card: '4580123456789012' })).reason, 'bad-field');
    assert.equal((await call('markOrderPaid', E1, { id, method: 'link', last4: '1234', conf: 'A77' })).status, 'OK');
    const o = await get(`b/${A}/ord/${id}`); assert.equal(o.status, 'paid'); assert.equal(o.paid.last4, '1234'); assert.equal(o.paid.amt, 10);
    assert.equal((await call('updateOrder', E1, { id, items: [{ n: 'x', qty: 1, price: 1 }] })).reason, 'locked');
    assert.equal((await call('updateOrder', MGR, { id, items: [{ n: 'x', qty: 1, price: 1 }] })).reason, 'locked');
    assert.equal((await call('unpayOrder', E1, { id, reason: 'x' })).reason, 'manager-only');
    assert.equal((await call('unpayOrder', MGR, { id })).reason, 'bad-reason');
    assert.equal((await call('cancelOrder', E1, { id, reason: 'x' })).reason, 'manager-only'); // שולם (לפני משלוח) – מנהל
    assert.equal((await call('unpayOrder', MGR, { id, reason: 'חיוב בוטל' })).status, 'OK');
    assert.equal((await get(`b/${A}/ord/${id}`)).status, 'wait_pay');
  });
  it('עריכה לפני שולם: מלאי לפי ההפרש, סכום מחושב מחדש', async () => {
    const id = await mk();
    const r = await call('updateOrder', E1, { id, items: [{ pid: 'pA', qty: 3, price: 8 }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.total, 24);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 0);
  });
  it('עובד סניף 2 לא רואה ולא משנה הזמנה של סניף 1 (שרת + חוקים)', async () => {
    const id = await mk();
    for (const [fn, d] of [['setOrderStatus', { id, status: 'work' }], ['markOrderPaid', { id, method: 'cash' }], ['cancelOrder', { id, reason: 'x' }], ['markOrderCalled', { id }], ['getPayLink', { id }], ['updateOrder', { id, items: [{ n: 'x', qty: 1, price: 1 }] }]]) {
      assert.equal((await call(fn, E2, d)).reason, 'foreign-br', fn);
    }
    await assertFails(db(E2).doc(`b/${A}/ord/${id}`).get());
    await assertSucceeds(db(E1).doc(`b/${A}/ord/${id}`).get());
    await assertSucceeds(db(MGR).doc(`b/${A}/ord/${id}`).get());
    await assertFails(db(E2).collection(`b/${A}/ord`).get());
    await assertSucceeds(db(E2).collection(`b/${A}/ord`).where('br', '==', 'br2').get());
    await assertFails(db(E2).collection(`b/${A}/ord/${id}/log`).get());
  });
  it('קישור תשלום: מנהל־על בלבד; https בלבד; עובד מקבל את הקישור רק דרך getPayLink ולא רואה private/pay', async () => {
    for (const u of [MGR, E1]) assert.equal((await call('setBusinessPayLink', u, { bizId: A, mode: 'link', link: 'https://pay.example.com/x' })).reason, 'not-superadmin');
    for (const l of ['http://pay.example.com', 'javascript:alert(1)', 'https://x', 'https://a.b/' + 'x'.repeat(500), 'https://u:p@pay.example.com']) {
      assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: l })).reason, 'bad-link', l);
    }
    const id = await mk();
    assert.equal((await call('getPayLink', E1, { id })).reason, 'no-pay-link');
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: 'https://pay.example.com/biz?a=1' })).status, 'OK');
    const r = await call('getPayLink', E1, { id });
    assert.equal(r.result.link, 'https://pay.example.com/biz?a=1');
    const cfg = await get(`b/${A}/ordcfg/main`); assert.deepEqual(cfg.pay, { mode: 'link', has: true }); assert.ok(!JSON.stringify(cfg).includes('pay.example'));
    await assertFails(db(E1).doc(`b/${A}/private/pay`).get());
    await assertFails(db(MGR).doc(`b/${A}/private/pay`).get());
    await assertSucceeds(db(E1).doc(`b/${A}/ordcfg/main`).get());
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone' })).status, 'OK');
    assert.equal((await call('getPayLink', E1, { id })).reason, 'no-pay-link');
    assert.ok((await coll(`b/${A}/audit`)).some((x) => x.act === 'setBusinessPayLink'));
  });
});

describe('החלטות 19:27', () => {
  it('עובד סניף 1 מוריד מלאי מסניף 2 (לא שלו) – מותר, ונרשם ביומן עם שמו והזמנה', async () => {
    const r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pB', qty: 3, price: 7.5, from: 'br2' }] });
    assert.equal(r.status, 'OK', r.text);
    const L = (await coll(`b/${A}/stockLog`)).filter((x) => x.ord === r.result.id);
    const xo = L.find((x) => x.why === 'xout');
    assert.ok(xo); assert.equal(xo.br, 'br2'); assert.equal(xo.delta, -3); assert.equal(xo.by, E1); assert.equal(xo.to, 'br1'); assert.equal(xo.no, r.result.no);
    const lg = await coll(`b/${A}/ord/${r.result.id}/log`); assert.ok(lg.some((x) => x.act === 'create' && x.by === E1));
  });
  it('ביטול "שולם" בהזמנה שיצאה למשלוח – נדחה גם למנהל; ביטול ההזמנה כולה מחזיר מלאי', async () => {
    const id = (await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 1, price: 10 }] })).result.id;
    await call('markOrderPaid', E1, { id, method: 'cash' });
    await call('setOrderStatus', E1, { id, status: 'out' });
    assert.equal((await call('unpayOrder', MGR, { id, reason: 'x' })).reason, 'bad-status');
    assert.equal((await get(`b/${A}/ord/${id}`)).status, 'out');
    assert.equal((await call('cancelOrder', E1, { id, reason: 'החזרה' })).status, 'OK');
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 3);
  });
});

describe('ביטול הזמנה שיצאה למשלוח (18:56)', () => {
  it('עובד מבטל הזמנה במצב "יצא למשלוח": מלאי חוזר, זיכוי void; "הושלם" – לא', async () => {
    await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: 'https://pay.example.com/x', sup: { id: 's1', name: 'ספק' } });
    const id = (await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 2, price: 10 }] })).result.id;
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 1);
    await call('markOrderPaid', E1, { id, method: 'link' });
    assert.equal((await call('setOrderStatus', E1, { id, status: 'out' })).status, 'OK');
    const r = await call('cancelOrder', E1, { id, reason: 'הלקוח החזיר' });
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 3);
    assert.equal((await get(`b/${A}/ordpay/${id}`)).st, 'void');
    const id2 = (await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ n: 'x', qty: 1, price: 1 }] })).result.id;
    await prep((d) => d.doc(`b/${A}/ord/${id2}`).update({ status: 'done' }));
    assert.equal((await call('cancelOrder', E1, { id: id2, reason: 'x' })).reason, 'bad-status');
  });
});

describe('זיכוי אצל ספק הקישור (17:47)', () => {
  async function mk() { return (await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 2, price: 10 }] })).result.id; }
  const SUP = { id: 's_samvix', name: 'סמוויקס' };
  it('שולם בקישור → ordpay paid עם הספק והסכום; שולם במזומן → בלי זיכוי; ביטול שולם → void; תשלום מחדש → paid שוב', async () => {
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: 'https://pay.example.com/x', sup: SUP })).status, 'OK');
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay.sup, SUP);
    const id = await mk();
    assert.equal((await call('markOrderPaid', E1, { id, method: 'link', last4: '1111' })).status, 'OK');
    let c = await get(`b/${A}/ordpay/${id}`);
    assert.equal(c.st, 'paid'); assert.equal(c.amt, 20); assert.deepEqual(c.sup, SUP);
    assert.deepEqual((await get(`b/${A}/ord/${id}`)).paid.sup, SUP);
    // כפילות "שולם" – לא משנה
    assert.equal((await call('markOrderPaid', E1, { id, method: 'link' })).result.dup, true);
    assert.equal((await call('unpayOrder', MGR, { id, reason: 'בוטל' })).status, 'OK');
    assert.equal((await get(`b/${A}/ordpay/${id}`)).st, 'void');
    assert.equal((await call('markOrderPaid', E1, { id, method: 'link' })).status, 'OK');
    assert.equal((await get(`b/${A}/ordpay/${id}`)).st, 'paid');
    assert.equal((await call('cancelOrder', MGR, { id, reason: 'החזר' })).status, 'OK');
    assert.equal((await get(`b/${A}/ordpay/${id}`)).st, 'void');
    const id2 = await mk();
    await call('markOrderPaid', E1, { id: id2, method: 'cash' });
    assert.equal(await get(`b/${A}/ordpay/${id2}`), null);
    // חוקים: מנהל קורא, עובד לא; אף אחד לא כותב
    await assertSucceeds(db(MGR).doc(`b/${A}/ordpay/${id}`).get());
    await assertFails(db(E1).doc(`b/${A}/ordpay/${id}`).get());
    for (const u of [MGR, E1, SUPER]) await assertFails(db(u).doc(`b/${A}/ordpay/x`).set({ amt: 1 }));
  });
  it('ספק לא תקין נדחה; מצב טלפון – בלי ספק ובלי זיכוי', async () => {
    for (const [sup, why] of [[{ id: 'a b', name: 'x' }, 'bad-sup'], [{ id: 's1' }, 'bad-sup'], [{ id: 's1', name: 'x', evil: 1 }, 'bad-field'], ['x', 'bad-sup']]) assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: 'https://pay.example.com/x', sup })).reason, why);
    await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone', sup: SUP });
    const id = await mk();
    await call('markOrderPaid', E1, { id, method: 'link' });
    assert.equal(await get(`b/${A}/ordpay/${id}`), null);
  });
});

describe('מלאי', () => {
  it('3 + הכנסת 5 = 8; הזמנה 2 = 6; ביטול = 8; נגמר = 0; סך התנועות = הכמות', async () => {
    await prep((d) => d.doc(`b/${A}/prod/pA`).set({ name: 'עוגה', price: 10, on: true, q: {} }));
    const pr = await call('saveProduct', E1, { reqId: rid(), name: 'קפה', price: 12, br: 'br1', qty: 3 });
    assert.equal(pr.status, 'OK', pr.text);
    const pid = pr.result.id;
    const q = rid();
    assert.equal((await call('stockIn', E1, { reqId: q, br: 'br1', lines: [{ pid, qty: 5 }] })).result.q[pid], 8);
    assert.equal((await call('stockIn', E1, { reqId: q, br: 'br1', lines: [{ pid, qty: 5 }] })).result.dup, true);
    const o = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid, qty: 2, price: 12 }] });
    assert.equal((await get(`b/${A}/prod/${pid}`)).q.br1, 6);
    await call('cancelOrder', E1, { id: o.result.id, reason: 'x' });
    assert.equal((await get(`b/${A}/prod/${pid}`)).q.br1, 8);
    assert.equal((await call('stockSet', E1, { reqId: rid(), pid, br: 'br1', qty: 0 })).status, 'OK');
    assert.equal((await get(`b/${A}/prod/${pid}`)).q.br1, 0);
    const L = (await coll(`b/${A}/stockLog`)).filter((x) => x.prod === pid && x.br === 'br1');
    assert.equal(Math.round(L.reduce((s, x) => s + x.delta, 0) * 1000) / 1000, 0);
  });
  it('תיקון כמות / עריכת מוצר / עלות – מנהל בלבד; עובד סניף 2 לא משנה מלאי סניף 1; עובד לא קורא עלות', async () => {
    assert.equal((await call('stockSet', E1, { reqId: rid(), pid: 'pA', br: 'br1', qty: 7 })).reason, 'manager-only');
    assert.equal((await call('stockSet', MGR, { reqId: rid(), pid: 'pA', br: 'br1', qty: 7 })).status, 'OK');
    // 18:56: עובד עם ord עורך שם/מחיר – נרשם ביומן; עובד בלי ord – לא; עלות – רק מנהל
    assert.equal((await call('saveProduct', E1, { id: 'pA', name: 'עוגה גדולה', price: 11 })).status, 'OK');
    const pa = await get(`b/${A}/prod/pA`); assert.equal(pa.name, 'עוגה גדולה'); assert.equal(pa.price, 11); assert.equal(pa.q.br1, 7);
    const pl = (await coll(`b/${A}/stockLog`)).filter((x) => x.why === 'prod');
    assert.equal(pl.length, 1); assert.equal(pl[0].delta, 0); assert.match(pl[0].note, /מחיר: ₪10 → ₪11/); assert.equal(pl[0].by, E1);
    assert.equal((await call('saveProduct', NOORD, { id: 'pA', name: 'x', price: 1 })).reason, 'no-perm');
    assert.equal((await call('saveProduct', E1, { id: 'pA', name: 'x', price: 1, cost: 2 })).reason, 'manager-only');
    assert.equal((await call('saveProduct', E1, { reqId: rid(), name: 'x', price: 1, cost: 1 })).reason, 'manager-only');
    assert.equal((await call('stockIn', E2, { reqId: rid(), br: 'br1', lines: [{ pid: 'pA', qty: 1 }] })).reason, 'foreign-br');
    await assertFails(db(E1).doc(`b/${A}/prod/pA/p/cost`).get());
    await assertSucceeds(db(MGR).doc(`b/${A}/prod/pA/p/cost`).get());
    await assertSucceeds(db(E1).doc(`b/${A}/prod/pA`).get());
    await assertFails(db(NOORD).doc(`b/${A}/prod/pA`).get());
    for (const u of [MGR, E1, SUPER]) {
      await assertFails(db(u).doc(`b/${A}/prod/pZ`).set({ name: 'x' }));
      await assertFails(db(u).doc(`b/${A}/ord/oZ`).set({ total: 1 }));
      await assertFails(db(u).doc(`b/${A}/stockLog/s1`).set({ delta: 1 }));
      await assertFails(db(u).doc(`b/${A}/ordcfg/main`).set({ pay: {} }));
    }
    const r = await call('saveProduct', E1, { reqId: rid(), name: 'x', price: 1 });
    assert.equal(r.status, 'OK', r.text);
  });
});

describe('לארג\' פעמי במצב legacy (שורש)', () => {
  const LM = 'l_mgr', LE = 'l_emp';
  async function seedL() {
    await env.clearFirestore();
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('superadmins/' + SUPER), {});
      b.set(d.doc('admins/' + LM), { email: 'lm@x.invalid' });
      b.set(d.doc('staff/' + LM), { name: LM, role: 'manager', active: true });
      b.set(d.doc('staff/' + LE), { name: LE, role: 'employee', active: true });
      b.set(d.doc('prod/pA'), { name: 'עוגה', price: 10, on: true, q: { _: 5 } });
      b.set(d.doc('prod/pA/p/cost'), { cost: 3 });
      await b.commit();
    });
  }
  it('עובד יוצר הזמנה בשורש (בלי סניפים), מלאי יורד, מנהל־על קובע קישור, עובד מקבל אותו; חוקי השורש: קריאה כן, כתיבה לא, עלות/ordpay/private – מנהל/אף אחד', async () => {
    await seedL();
    const r = await call('createOrder', LE, { reqId: rid(), cust, items: [{ pid: 'pA', qty: 2, price: 10 }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.no, 1);
    const o = await get('ord/' + r.result.id); assert.equal(o.br, '_'); assert.equal(o.total, 20);
    assert.equal((await get('prod/pA')).q._, 3);
    assert.equal(await get(`b/largpeami/ord/${r.result.id}`), null);
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: 'largpeami', mode: 'link', link: 'https://pay.example.com/l', sup: { id: 's1', name: 'ספק' } })).status, 'OK');
    assert.equal((await call('getPayLink', LE, { id: r.result.id })).result.link, 'https://pay.example.com/l');
    assert.equal((await call('markOrderPaid', LE, { id: r.result.id, method: 'link' })).status, 'OK');
    assert.equal((await get('ordpay/' + r.result.id)).st, 'paid');
    await assertSucceeds(db(LE).doc('ord/' + r.result.id).get());
    await assertSucceeds(db(LE).collection('ord').get());
    await assertSucceeds(db(LE).doc('prod/pA').get());
    await assertSucceeds(db(LE).doc('ordcfg/main').get());
    await assertSucceeds(db(LE).collection(`ord/${r.result.id}/log`).get());
    await assertSucceeds(db(LE).collection('stockLog').get());
    await assertFails(db(LE).doc('prod/pA/p/cost').get());
    await assertSucceeds(db(LM).doc('prod/pA/p/cost').get());
    await assertFails(db(LE).doc('ordpay/' + r.result.id).get());
    await assertSucceeds(db(LM).doc('ordpay/' + r.result.id).get());
    for (const u of [LM, LE, SUPER]) {
      await assertFails(db(u).doc('private/pay').get());
      await assertFails(db(u).doc('ord/x').set({ total: 1 }));
      await assertFails(db(u).doc('prod/x').set({ name: 'x' }));
      await assertFails(db(u).doc('ordcfg/main').set({}));
    }
    await assertFails(db('u_out').doc('ord/' + r.result.id).get());
    // סבב 2, הערה 3: משתמש של עסק b/* (מנהל ועובד) – לא קורא את נתוני השורש; עובד מושבת בשורש – חסום בחוקים ובשרת
    await seed();
    await prep(async (d) => { await d.doc('ord/' + r.result.id).set({ br: '_', total: 20, status: 'new' }); await d.doc('prod/pA').set({ name: 'x', q: {} }); await d.doc('staff/l_off').set({ name: 'l_off', role: 'employee', active: false }); });
    for (const u of [MGR, E1]) {
      await assertFails(db(u).doc('ord/' + r.result.id).get());
      await assertFails(db(u).doc('prod/pA').get());
      await assertFails(db(u).doc('ordcfg/main').get());
    }
    await assertFails(db('l_off').doc('ord/' + r.result.id).get());
    await assertFails(db('l_off').doc('prod/pA').get());
    assert.equal((await call('createOrder', 'l_off', { reqId: rid(), cust, items: [{ n: 'x', qty: 1, price: 1 }] })).reason, 'staff-disabled');
  });
  it('מעבר לטלפון מנקה את pay.sup; מייל עם רצף ספרות נדחה', async () => {
    await seed();
    await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: 'https://pay.example.com/x', sup: { id: 's1', name: 'ספק' } });
    await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone' });
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'phone', has: false });
    const r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust: Object.assign({ mail: '4580123456789012@x.com' }, cust), items: [{ n: 'x', qty: 1, price: 1 }] });
    assert.equal(r.reason, 'card-like');
  });
});

