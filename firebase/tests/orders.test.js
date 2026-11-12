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
  it('שורה ידנית עם עלות וסניף (00:18): נשמרים, מלאי לא משתנה; עובד רק לסניף שלו; שורת מוצר – לא', async () => {
    const r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ n: 'זר', qty: 2, price: 20, c: 12, lb: 'br1' }, { n: 'ישן', qty: 1, price: 5 }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.total, 45);
    const o = await get(`b/${A}/ord/${r.result.id}`);
    assert.equal(o.items[0].c, 12); assert.equal(o.items[0].lb, undefined); assert.equal(o.items[1].c, undefined);
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, 3);
    assert.equal((await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ n: 'זר', qty: 1, price: 1, lb: 'br2' }] })).reason, 'foreign-br');
    const m = await call('createOrder', MGR, { reqId: rid(), br: 'br1', cust, items: [{ n: 'זר', qty: 1, price: 1, lb: 'br2' }] });
    assert.equal(m.status, 'OK', m.text); assert.equal((await get(`b/${A}/ord/${m.result.id}`)).items[0].lb, 'br2');
    assert.equal((await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 1, c: 3 }] })).reason, 'bad-items');
    assert.equal((await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ n: 'x', qty: 1, price: 1, c: -1 }] })).status === 'OK', false);
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
    // 18:56: עובד עם ord עורך שם/מחיר – נרשם ביומן; עובד בלי ord – לא; 00:13: גם עלות
    assert.equal((await call('saveProduct', E1, { id: 'pA', name: 'עוגה גדולה', price: 11 })).status, 'OK');
    const pa = await get(`b/${A}/prod/pA`); assert.equal(pa.name, 'עוגה גדולה'); assert.equal(pa.price, 11); assert.equal(pa.q.br1, 7);
    const pl = (await coll(`b/${A}/stockLog`)).filter((x) => x.why === 'prod');
    assert.equal(pl.length, 1); assert.equal(pl[0].delta, 0); assert.match(pl[0].note, /מחיר: ₪10 → ₪11/); assert.equal(pl[0].by, E1);
    assert.equal((await call('saveProduct', NOORD, { id: 'pA', name: 'x', price: 1 })).reason, 'no-perm');
    assert.equal((await call('saveProduct', E1, { id: 'pA', name: 'עוגה גדולה', price: 11, cost: 2 })).status, 'OK');
    assert.equal((await get(`b/${A}/prod/pA/p/cost`)).cost, 2);
    assert.equal((await call('saveProduct', NOORD, { id: 'pA', name: 'x', price: 1, cost: 1 })).reason, 'no-perm');
    assert.equal((await call('stockIn', E2, { reqId: rid(), br: 'br1', lines: [{ pid: 'pA', qty: 1 }] })).reason, 'foreign-br');
    await assertSucceeds(db(E1).doc(`b/${A}/prod/pA/p/cost`).get());
    await assertFails(db(NOORD).doc(`b/${A}/prod/pA/p/cost`).get());
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

describe('מחיקת כל המלאי ושחזור (11.11.2026)', () => {
  it('עובד נחסם; בלי "מחק" נדחה; מנהל מוחק הכול עם גיבוי (כולל עלות/סיטונאי); קטגוריות והיסטוריה נשארות; שחזור מחזיר הכול ולא דורס מוצר חדש; שחזור שני נדחה', async () => {
    await prep(async (d) => {
      await d.doc(`b/${A}/prod/pA`).set({ name: 'עוגה', price: 10, on: true, q: { br1: 4 } });
      await d.doc(`b/${A}/prod/pA/p/cost`).set({ cost: 6 });
      await d.doc(`b/${A}/prod/pA/p/ws`).set({ wp: 8 });
      await d.doc(`b/${A}/prod/pB`).set({ name: 'קפה', price: 12, on: true, q: { br2: 2 } });
      await d.doc(`b/${A}/cat/c1`).set({ name: 'מאפים', ord: 1 });
      await d.doc(`b/${A}/stockLog/l1`).set({ prod: 'pA', name: 'עוגה', br: 'br1', delta: 4, why: 'in', by: MGR, at: 1 });
    });
    assert.equal((await call('wipeStock', E1, { reqId: rid(), confirm: 'מחק' })).reason, 'manager-only');
    assert.equal((await call('wipeStock', MGR, { reqId: rid(), confirm: 'כן' })).reason, 'bad-confirm');
    assert.equal((await call('restoreStock', MGR, { reqId: rid() })).reason, 'no-bak');
    const q = rid();
    const r = await call('wipeStock', MGR, { reqId: q, confirm: 'מחק' });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.n, 2);
    assert.equal((await call('wipeStock', MGR, { reqId: q, confirm: 'מחק' })).result.dup, true);
    assert.equal((await coll(`b/${A}/prod`)).length, 0);
    assert.equal(await get(`b/${A}/prod/pA/p/cost`), null); assert.equal(await get(`b/${A}/prod/pA/p/ws`), null);
    assert.equal((await coll(`b/${A}/cat`)).length, 1); assert.equal((await coll(`b/${A}/stockLog`)).length, 1);
    const bk = await coll(`b/${A}/stockBak`); assert.equal(bk.length, 1); assert.equal(bk[0].st, 'wiped'); assert.equal(bk[0].n, 2);
    await assertFails(db(MGR).doc(`b/${A}/stockBak/${bk[0].id}`).get());
    await prep((d) => d.doc(`b/${A}/prod/pN`).set({ name: 'חדש', price: 1, on: true, q: {} }));
    const rs = await call('restoreStock', MGR, { reqId: rid() });
    assert.equal(rs.status, 'OK', rs.text); assert.equal(rs.result.n, 2); assert.equal(rs.result.skip, 0);
    assert.deepEqual((await get(`b/${A}/prod/pA`)).q, { br1: 4 }); assert.equal((await get(`b/${A}/prod/pA/p/cost`)).cost, 6); assert.equal((await get(`b/${A}/prod/pA/p/ws`)).wp, 8);
    assert.equal((await coll(`b/${A}/prod`)).length, 3);
    assert.equal((await call('restoreStock', MGR, { reqId: rid() })).reason, 'bak-used');
  });
  it('תקלה באמצע: מחיקה שנעצרה (גיבוי done) – ניסיון חוזר ממשיך את אותו גיבוי; גיבוי partial חדש יותר לא חוסם שחזור; מוצר קיים לא נדרס', async () => {
    const B = `b/${A}/stockBak`;
    await prep(async (d) => {
      // מצב אחרי תקלה: גיבוי שלם של pA+pB (done), pA כבר נמחק, pB נשאר
      await d.doc(`${B}/k1`).set({ at: 100, by: MGR, n: 2, st: 'done' });
      await d.doc(`${B}/k1/items/pA`).set({ d: { name: 'עוגה', price: 10, q: { br1: 4 } }, p: { cost: { cost: 6 } } });
      await d.doc(`${B}/k1/items/pB`).set({ d: { name: 'קפה', price: 12, q: { br2: 2 } }, p: {} });
      await d.doc(`b/${A}/prod/pB`).set({ name: 'קפה', price: 12, q: { br2: 2 } });
    });
    const r = await call('wipeStock', MGR, { reqId: rid(), confirm: 'מחק' });
    assert.equal(r.status, 'OK', r.text);
    const bk = await coll(B); assert.equal(bk.length, 1); assert.equal(bk[0].st, 'wiped'); // אותו גיבוי, לא חדש
    assert.equal((await coll(`b/${A}/prod`)).length, 0);
    await prep(async (d) => {
      await d.doc(`${B}/k2`).set({ at: 200, by: MGR, n: 1, st: 'partial' }); // גיבוי שנכשל בכתיבה – לא נמחק כלום
      await d.doc(`b/${A}/prod/pA`).set({ name: 'עוגה חדשה', price: 99, q: {} });
    });
    const rs = await call('restoreStock', MGR, { reqId: rid() });
    assert.equal(rs.status, 'OK', rs.text); assert.equal(rs.result.n, 1); assert.equal(rs.result.skip, 1);
    assert.equal((await get(`b/${A}/prod/pA`)).name, 'עוגה חדשה'); assert.equal(await get(`b/${A}/prod/pA/p/cost`), null);
    assert.deepEqual((await get(`b/${A}/prod/pB`)).q, { br2: 2 });
  });
});

// 12.11.2026 (תמחור חשבונית, שלב 5א): "רק קרטונים סגורים" (cto) – ללקוח סיטונאי הכמות נשמרת במארזים וחייבת להיות כפולה של ct
describe('קרטונים סגורים ללקוח סיטונאי (cto)', () => {
  beforeEach(() => prep(async (d) => {
    const b = d.batch();
    b.set(d.doc(`b/${A}/prod/pC`), { name: 'חטיף', price: 6, on: true, ct: 6, cto: true, q: { br1: 30 } });
    b.set(d.doc(`b/${A}/prod/pC/p/cost`), { cost: 3 });
    b.set(d.doc(`b/${A}/prod/pD`), { name: 'בלי ct', price: 6, on: true, ct: 1, cto: true, q: { br1: 30 } });
    b.set(d.doc(`b/${A}/prod/pE`), { name: 'בלי cto', price: 6, on: true, ct: 6, q: { br1: 30 } });
    b.set(d.doc(`b/${A}/cust/cW`), { name: 'סיטונאי', phone: '0501111111', wholesale: true });
    b.set(d.doc(`b/${A}/cust/cR`), { name: 'רגיל', phone: '0502222222' });
    await b.commit();
  }));
  const mk = (custId, items) => call('createOrder', E1, { reqId: rid(), br: 'br1', cust, custId, items });
  it('סיטונאי: 2 קרטונים = 12 מארזים, מחיר מארז, ct נשמר בשורה, המלאי יורד 12; כמות שאינה כפולה של ct נדחית', async () => {
    const r = await mk('cW', [{ pid: 'pC', qty: 12, price: 5 }]);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.total, 60);
    const o = await get(`b/${A}/ord/${r.result.id}`);
    assert.deepEqual([o.items[0].qty, o.items[0].price, o.items[0].ct, o.items[0].c], [12, 5, 6, 3]);
    assert.equal((await get(`b/${A}/prod/pC`)).q.br1, 18);
    const lg = (await coll(`b/${A}/stockLog`)).filter((x) => x.ord === r.result.id);
    assert.deepEqual(lg.map((x) => x.delta), [-12]);
    for (const q of [5, 1, 13, 6.5]) assert.equal((await mk('cW', [{ pid: 'pC', qty: q, price: 5 }])).reason, 'cto-qty', 'qty ' + q);
    assert.equal((await get(`b/${A}/prod/pC`)).q.br1, 18);
  });
  it('לקוח רגיל / בלי לקוח / מוצר בלי ct תקין / בלי cto – כמו קודם (מארז אחד, בלי ct בשורה)', async () => {
    for (const [cid, pid] of [['cR', 'pC'], [undefined, 'pC'], ['cW', 'pD'], ['cW', 'pE']]) {
      const r = await mk(cid, [{ pid, qty: 5, price: 6 }]);
      assert.equal(r.status, 'OK', `${cid}/${pid}: ${r.text}`);
      const o = await get(`b/${A}/ord/${r.result.id}`);
      assert.equal(o.total, 30); assert.equal(o.items[0].qty, 5); assert.equal(o.items[0].ct, undefined);
    }
  });
  it('עריכה: שורה קיימת שלא השתנתה לא נחסמת; שינוי לכמות שאינה כפולה נדחה; לכפולה – נשמר עם ct, המלאי לפי ההפרש', async () => {
    const r = await mk('cR', [{ pid: 'pC', qty: 5, price: 6 }]); // הזמנה "ישנה": הלקוח עוד לא היה סיטונאי
    await prep((d) => d.doc(`b/${A}/ord/${r.result.id}`).update({ custId: 'cW' }));
    const id = r.result.id;
    assert.equal((await call('updateOrder', E1, { id, items: [{ pid: 'pC', qty: 5, price: 7 }] })).status, 'OK');
    assert.equal((await call('updateOrder', E1, { id, items: [{ pid: 'pC', qty: 7, price: 7 }] })).reason, 'cto-qty');
    const u = await call('updateOrder', E1, { id, items: [{ pid: 'pC', qty: 18, price: 7 }] });
    assert.equal(u.status, 'OK', u.text); assert.equal(u.result.total, 126);
    const o = await get(`b/${A}/ord/${id}`);
    assert.deepEqual([o.items[0].qty, o.items[0].ct], [18, 6]);
    assert.equal((await get(`b/${A}/prod/pC`)).q.br1, 12);
  });
  it('עריכה: שורה ישנה שאינה קרטון שלם פוטרת רק את עצמה – 3 שורות של 5 נדחות, 2 שורות ישנות של 5 עוברות', async () => {
    const r = await mk('cR', [{ pid: 'pC', qty: 5, price: 6 }, { pid: 'pC', qty: 5, price: 6 }]);
    await prep((d) => d.doc(`b/${A}/ord/${r.result.id}`).update({ custId: 'cW' }));
    const id = r.result.id, L = (n) => Array.from({ length: n }, () => ({ pid: 'pC', qty: 5, price: 6 }));
    assert.equal((await call('updateOrder', E1, { id, items: L(3) })).reason, 'cto-qty');
    assert.equal((await get(`b/${A}/ord/${id}`)).items.length, 2);
    assert.equal((await get(`b/${A}/prod/pC`)).q.br1, 20);
    assert.equal((await call('updateOrder', E1, { id, items: L(2) })).status, 'OK');
    assert.equal((await call('updateOrder', E1, { id, items: L(1) })).status, 'OK');
    assert.equal((await call('updateOrder', E1, { id, items: L(2) })).reason, 'cto-qty'); // אחרי הצמצום – רק שורה ישנה אחת
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
    await assertSucceeds(db(LE).doc('prod/pA/p/cost').get()); // 00:12: עובד עם ord רואה עלות
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
  it('fb/ord-perm-enforce: מתג "הזמנות" בשורש – עובד עם perms.ord=false חסום בחוקים ובשרת; בלי perms / ord=true / מנהל – מורשים', async () => {
    await seedL();
    const OFF = 'l_off_ord', ON = 'l_on_ord';
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('staff/' + OFF), { name: OFF, role: 'employee', active: true, perms: NONE });
      b.set(d.doc('staff/' + ON), { name: ON, role: 'employee', active: true, perms: Object.assign({}, NONE, { ord: true }) });
      b.set(d.doc('ord/o1'), { br: '_', total: 5, status: 'new', no: 1 });
      b.set(d.doc('ord/o1/log/l1'), { at: 1 });
      b.set(d.doc('stockLog/s1'), { br: '_', pid: 'pA', d: 1 });
      b.set(d.doc('cat/c1'), { name: 'עוגות' });
      b.set(d.doc('xfer/x1'), { from: '_', to: '_', items: [] });
      b.set(d.doc('cust/k1'), { name: 'דנה', phone: '0501234567' });
      b.set(d.doc('ordcfg/main'), { v: 1 });
      b.set(d.doc('custcfg/main'), { v: 1 });
      await b.commit();
    });
    const reads = (u) => [
      () => db(u).doc('ord/o1').get(), () => db(u).collection('ord').get(), () => db(u).collection('ord/o1/log').get(),
      () => db(u).doc('prod/pA').get(), () => db(u).collection('prod').get(), () => db(u).doc('prod/pA/p/cost').get(),
      () => db(u).collection('stockLog').get(), () => db(u).collection('cat').get(), () => db(u).doc('xfer/x1').get(),
      () => db(u).doc('cust/k1').get(), () => db(u).collection('cust').get(), () => db(u).doc('ordcfg/main').get(), () => db(u).doc('custcfg/main').get(),
    ];
    for (const f of reads(OFF)) await assertFails(f());
    for (const u of [LE, ON, LM, SUPER]) for (const f of reads(u)) await assertSucceeds(f());
    // השרת: אותה תוצאה (hasPerm קורא את staff/{uid} בשורש)
    assert.equal((await call('createOrder', OFF, { reqId: rid(), cust, items: [{ n: 'x', qty: 1, price: 1 }] })).reason, 'no-perm');
    assert.equal((await call('saveCust', OFF, { name: 'א', phone: '0501111111' })).reason, 'no-perm');
    assert.equal((await call('createOrder', ON, { reqId: rid(), cust, items: [{ n: 'x', qty: 1, price: 1 }] })).status, 'OK');
  });
  it('מעבר לטלפון מנקה את pay.sup; מייל עם רצף ספרות נדחה', async () => {
    await seed();
    await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: 'https://pay.example.com/x', sup: { id: 's1', name: 'ספק' } });
    await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone' });
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'phone', has: false });
    const r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust: Object.assign({ mail: '4580123456789012@x.com' }, cust), items: [{ n: 'x', qty: 1, price: 1 }] });
    assert.equal(r.reason, 'card-like');
    for (const sep of ['\u2013', '\u2014', '\u05BE', '=', '!', '\u200F', '\u200B']) {
      const v = ['4580', '1234', '5678', '9012'].join(sep);
      for (const mut of [(d) => { d.note = 'כרטיס ' + v; }, (d) => { d.cust.name = 'דנה ' + v; }, (d) => { d.cust.addr = 'רחוב ' + v; }, (d) => { d.cust.mail = v + '@x.com'; }]) {
        const d = { reqId: rid(), br: 'br1', cust: Object.assign({}, cust), items: [{ n: 'x', qty: 1, price: 1 }] }; mut(d);
        const q = await call('createOrder', E1, d);
        assert.equal(q.reason, 'card-like', JSON.stringify(sep) + ' ' + q.text);
      }
    }
  });
});

