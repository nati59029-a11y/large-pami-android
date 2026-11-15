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
    const cfg = await get(`b/${A}/ordcfg/main`); assert.deepEqual(cfg.pay, { mode: 'link', has: true, cred: false }); assert.ok(!JSON.stringify(cfg).includes('pay.example'));
    await assertFails(db(E1).doc(`b/${A}/private/pay`).get());
    await assertFails(db(MGR).doc(`b/${A}/private/pay`).get());
    await assertSucceeds(db(E1).doc(`b/${A}/ordcfg/main`).get());
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone' })).status, 'OK');
    assert.equal((await call('getPayLink', E1, { id })).reason, 'no-pay-link');
    assert.ok((await coll(`b/${A}/audit`)).some((x) => x.act === 'setBusinessPayLink'));
  });
  // 2026-11-12: פרטי כניסה לאתר הסליקה – מוצפנים, מנהל־על בלבד, מוחזרים רק ב-getPayLink{auto:true}
  it('פרטי כניסה קשורים ל-host; עדכון פרטים בלי קישור שומר קישור וספק; כשל פענוח – קישור בלי auto', async () => {
    const PASS = 'Hh-77-pass', L = 'https://pay.example.com/biz', SUP = { id: 's1', name: 'ספק' };
    // אין קישור קיים – עדכון פרטים בלי קישור נדחה כמו היום
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', cred: { pass: PASS } })).reason, 'bad-link');
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: L, sup: SUP })).result.cred, false);
    const u = await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', cred: { user: 'me', pass: PASS } });
    assert.equal(u.status, 'OK', u.text); assert.equal(u.result.cred, true); assert.deepEqual(u.result.sup, SUP);
    assert.equal((await get(`b/${A}/private/pay`)).link, L); assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'link', has: true, cred: true, sup: SUP });
    assert.equal((await get(`b/${A}/private/payCred`)).host, 'pay.example.com');
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: '  ', cred: { pass: PASS } })).status, 'OK', 'קישור ריק – הקיים');
    // סבב 2: קישור קיים + "בלי ספק" (sup:null) – הספק מתנקה, הקישור ופרטי הכניסה נשארים; sup שלא נשלח – הספק נשמר
    const ns = await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', sup: null });
    assert.equal(ns.status, 'OK', ns.text); assert.equal(ns.result.sup || null, null); assert.equal(ns.result.cred, true);
    assert.equal((await get(`b/${A}/private/pay`)).link, L); assert.equal((await get(`b/${A}/ordcfg/main`)).pay.sup || null, null);
    await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: L, sup: SUP });
    assert.deepEqual((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link' })).result.sup, SUP);
    const id = await mk();
    assert.deepEqual((await call('getPayLink', E1, { id, auto: true })).result.auto, { user: '', pass: PASS });
    // הקישור הוחלף ישירות במסמך ל-host אחר (מצב לא צפוי) – בלי auto, כי ה-host שבתוך המוצפן שונה
    await prep((d) => d.doc(`b/${A}/private/pay`).update({ link: 'https://evil.example.net/x' }));
    const h = await call('getPayLink', E1, { id, auto: true });
    assert.equal(h.status, 'OK'); assert.equal(h.result.auto, undefined); assert.ok(!h.text.includes(PASS));
    await prep((d) => d.doc(`b/${A}/private/pay`).update({ link: L }));
    // מוצפן פגום – הקישור חוזר בלי auto, ביומן 'auto-fail' בלי פרטים
    const pc = await get(`b/${A}/private/payCred`);
    await prep((d) => d.doc(`b/${A}/private/payCred`).update({ box: Object.assign({}, pc.box, { tag: Buffer.alloc(16).toString('base64') }) }));
    const f = await call('getPayLink', E1, { id, auto: true });
    assert.equal(f.status, 'OK', f.text); assert.equal(f.result.link, L); assert.equal(f.result.auto, undefined);
    const lg = (await coll(`b/${A}/ord/${id}/log`)).filter((x) => x.act === 'payOpen').map((x) => x.note).sort();
    assert.deepEqual(lg, ['auto', 'auto-fail', 'auto-host']);
    // קישור ל-host אחר בלי cred חדש – פרטי הכניסה נמחקים
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: L, cred: { pass: PASS } })).result.cred, true);
    const o = await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: 'https://other.example.org/p' });
    assert.equal(o.result.cred, false); assert.equal(await get(`b/${A}/private/payCred`), null);
    assert.equal((await get(`b/${A}/ordcfg/main`)).pay.cred, false);
    assert.ok((await coll(`b/${A}/audit`)).some((x) => x.note.endsWith(' cred:del') && x.note.includes('other.example.org')));
    // host אחר עם cred חדש – נשמר עם ה-host החדש
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: 'https://other.example.org/p', cred: { pass: PASS } })).result.cred, true);
    assert.equal((await get(`b/${A}/private/payCred`)).host, 'other.example.org');
  });
  it('פרטי כניסה לסליקה: מנהל־על בלבד; מוצפן בלי ערכים גלויים; auto רק כשמבקשים; בלי cred – נשמר; null/phone – נמחק', async () => {
    const PASS = 'S3cr3t-Pa$$w0rd!', USER = 'shop@example.invalid';
    const leak = (x) => { const t = typeof x === 'string' ? x : JSON.stringify(x); return t.includes(PASS) || t.includes(USER); };
    const L = 'https://pay.example.com/biz';
    for (const u of [MGR, E1]) {
      const r = await call('setBusinessPayLink', u, { bizId: A, mode: 'link', link: L, cred: { user: USER, pass: PASS } });
      assert.equal(r.reason, 'not-superadmin'); assert.ok(!leak(r.text));
    }
    for (const cred of [{ pass: '' }, { user: USER }, { user: 'x'.repeat(121), pass: PASS }, { pass: 'x'.repeat(201) }, { pass: 'a\nb' }, { user: 'a\u0007', pass: PASS }, { pass: PASS, evil: 1 }, 'x', [PASS]]) {
      const r = await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: L, cred });
      assert.equal(r.reason, 'bad-cred', JSON.stringify(cred).slice(0, 40)); assert.ok(!r.text.includes(PASS));
    }
    const ph = await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone', cred: { pass: PASS } });
    assert.equal(ph.reason, 'bad-cred'); assert.ok(!leak(ph.text));
    const s = await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: L, cred: { user: USER, pass: PASS } });
    assert.equal(s.status, 'OK', s.text); assert.equal(s.result.cred, true); assert.ok(!leak(s.text));
    const pc = await get(`b/${A}/private/payCred`);
    assert.ok(pc.box && pc.box.ct && pc.box.iv && pc.box.tag && pc.by === SUPER && typeof pc.at === 'number'); assert.ok(!leak(pc));
    const cfg = await get(`b/${A}/ordcfg/main`); assert.deepEqual(cfg.pay, { mode: 'link', has: true, cred: true }); assert.ok(!leak(cfg));
    assert.ok(!leak(await get(`b/${A}/private/pay`)));
    await assertFails(db(E1).doc(`b/${A}/private/payCred`).get());
    await assertFails(db(MGR).doc(`b/${A}/private/payCred`).get());
    const id = await mk();
    const plain = await call('getPayLink', E1, { id });
    assert.equal(plain.status, 'OK'); assert.equal(plain.result.auto, undefined); assert.ok(!leak(plain.text));
    const au = await call('getPayLink', E1, { id, auto: true });
    assert.equal(au.status, 'OK', au.text); assert.deepEqual(au.result.auto, { user: USER, pass: PASS }); assert.equal(au.result.link, L);
    assert.equal((await call('getPayLink', E1, { id, auto: 'yes' })).reason, 'bad-field');
    const lg = await coll(`b/${A}/ord/${id}/log`);
    assert.deepEqual(lg.filter((x) => x.act === 'payOpen').map((x) => x.note).sort(), ['', 'auto']); assert.ok(!leak(lg));
    // שמירה בלי cred (למשל החלפת קישור) – הפרטים הקיימים נשמרים
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: L + '2' })).result.cred, true);
    assert.equal((await get(`b/${A}/ordcfg/main`)).pay.cred, true);
    assert.deepEqual((await call('getPayLink', E1, { id, auto: true })).result.auto, { user: USER, pass: PASS });
    // null – מחיקה
    const d = await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: L, cred: null });
    assert.equal(d.result.cred, false); assert.equal(await get(`b/${A}/private/payCred`), null);
    assert.equal((await get(`b/${A}/ordcfg/main`)).pay.cred, false);
    assert.equal((await call('getPayLink', E1, { id, auto: true })).result.auto, undefined);
    // בלי user – רק סיסמה; מעבר לטלפון מוחק
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: L, cred: { pass: PASS } })).result.cred, true);
    assert.deepEqual((await call('getPayLink', E1, { id, auto: true })).result.auto, { user: '', pass: PASS });
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'phone' })).result.cred, false);
    assert.equal(await get(`b/${A}/private/payCred`), null);
    const au2 = (await coll(`b/${A}/audit`)).filter((x) => x.act === 'setBusinessPayLink').map((x) => x.note);
    assert.ok(au2.some((x) => x.endsWith(' cred:set')) && au2.some((x) => x.endsWith(' cred:del'))); assert.ok(!leak(au2));
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
  it('החלטה 9: מתנה ממבצע (קו עם gift) במוצר cto ללקוח סיטונאי = מארז אחד, בלי ct; המלאי יורד 1; רק שורה אחת לכל קו עם מתנה', async () => {
    await prep(async (d) => {
      await d.doc('b/' + A).update({ features: Object.assign({}, ALL, { cellular: true }) });
      await d.doc(`b/${A}/lineplan/lpG`).set({ name: 'מבצע מתנה', on: true, monthly: 39, promos: [{ gifts: [{ pid: 'pC', price: 0 }] }] });
    });
    const cell = { lines: [{ phone: '0521111111', plan: 'lpG', gift: 'pC' }] };
    const go = (items) => call('createOrder', E1, { reqId: rid(), br: 'br1', cust, custId: 'cW', items, cell });
    const r = await go([{ pid: 'pC', qty: 12, price: 5 }, { pid: 'pC', qty: 1, price: 5 }]);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.total, 65 - 5); // ההנחה המוצעת: מארז אחד במחיר 5 (מתנה חינם)
    const o = await get(`b/${A}/ord/${r.result.id}`);
    assert.deepEqual(o.items.map((x) => [x.qty, x.ct]), [[12, 6], [1, undefined]]);
    assert.equal(o.cell.calc.gift, 5);
    assert.equal((await get(`b/${A}/prod/pC`)).q.br1, 30 - 13);
    // קו אחד עם מתנה פוטר שורה אחת בלבד, ורק בכמות 1
    assert.equal((await go([{ pid: 'pC', qty: 1, price: 5 }, { pid: 'pC', qty: 1, price: 5 }])).reason, 'cto-qty');
    assert.equal((await go([{ pid: 'pC', qty: 2, price: 5 }])).reason, 'cto-qty');
    // בלי קו עם מתנה – מארז בודד נדחה כמו קודם
    assert.equal((await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, custId: 'cW', items: [{ pid: 'pC', qty: 1, price: 5 }] })).reason, 'cto-qty');
    // עריכה בלי לשלוח cell (הקווים השמורים בהזמנה) – שורת המתנה נשארת מארז אחד
    const u = await call('updateOrder', E1, { id: r.result.id, items: [{ pid: 'pC', qty: 18, price: 5 }, { pid: 'pC', qty: 1, price: 5 }] });
    assert.equal(u.status, 'OK', u.text);
    assert.equal((await get(`b/${A}/prod/pC`)).q.br1, 30 - 19);
  });
  it('החלטה 9 (תיקון): שורת מתנה שמורה לא מקבלת גם פטור "שורה ישנה" – עריכה ל-12+1+1 נדחית; ביטול הניוד עם אותם פריטים נדחה; הנחת המתנה = המארז היקר בשני הסדרים', async () => {
    await prep(async (d) => {
      await d.doc('b/' + A).update({ features: Object.assign({}, ALL, { cellular: true }) });
      await d.doc(`b/${A}/lineplan/lpG`).set({ name: 'מבצע מתנה', on: true, monthly: 39, promos: [{ gifts: [{ pid: 'pC', price: 0 }] }] });
    });
    const cell = { lines: [{ phone: '0521111111', plan: 'lpG', gift: 'pC' }] };
    const go = (items) => call('createOrder', E1, { reqId: rid(), br: 'br1', cust, custId: 'cW', items, cell });
    const r = await go([{ pid: 'pC', qty: 12, price: 5 }, { pid: 'pC', qty: 1, price: 5 }]);
    assert.equal(r.status, 'OK', r.text);
    const id = r.result.id, G = [{ pid: 'pC', qty: 12, price: 5 }, { pid: 'pC', qty: 1, price: 5 }];
    // ליקוי 1: בלי פטור כפול – מארז בודד נוסף נדחה (גם בלי לשלוח cell וגם כששולחים את אותו ניוד)
    assert.equal((await call('updateOrder', E1, { id, items: G.concat([{ pid: 'pC', qty: 1, price: 5 }]) })).reason, 'cto-qty');
    assert.equal((await call('updateOrder', E1, { id, items: G.concat([{ pid: 'pC', qty: 1, price: 5 }]), cell })).reason, 'cto-qty');
    // ליקוי 2: ביטול הניוד / המתנה – שורת המתנה הבודדת נדחית; הסרה שלה עוברת
    assert.equal((await call('updateOrder', E1, { id, items: G, cell: null })).reason, 'cto-qty');
    assert.equal((await call('updateOrder', E1, { id, items: G, cell: { lines: [{ phone: '0521111111', plan: 'lpG' }] } })).reason, 'cto-qty');
    assert.equal((await get(`b/${A}/ord/${id}`)).items.length, 2);
    // סבב 2: ביטול הניוד בלי items – נבדקים הפריטים השמורים; נדחה, הסכום והמלאי לא משתנים. הזמנה בלי cto – לא נחסמת
    const o0 = await get(`b/${A}/ord/${id}`), q0 = (await get(`b/${A}/prod/pC`)).q.br1;
    assert.equal((await call('updateOrder', E1, { id, cell: null })).reason, 'cto-qty');
    assert.equal((await call('updateOrder', E1, { id, cell: { lines: [{ phone: '0521111111', plan: 'lpG' }] } })).reason, 'cto-qty');
    const o1 = await get(`b/${A}/ord/${id}`);
    assert.deepEqual([o1.total, o1.items.length, !!o1.cell, (await get(`b/${A}/prod/pC`)).q.br1], [o0.total, 2, true, q0]);
    const r2 = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, custId: 'cW', items: [{ pid: 'pE', qty: 1, price: 6 }], cell: { lines: [{ phone: '0521111112', plan: 'lpG' }] } });
    assert.equal(r2.status, 'OK', r2.text);
    assert.equal((await call('updateOrder', E1, { id: r2.result.id, cell: null })).status, 'OK');
    const u = await call('updateOrder', E1, { id, items: [G[0]], cell: null });
    assert.equal(u.status, 'OK', u.text); assert.equal(u.result.total, 60);
    // ליקוי 3: קרטון ב-5 ומתנה ב-6 – הנחה 6 (המתנה חינם) בשני הסדרים
    for (const items of [[{ pid: 'pC', qty: 12, price: 5 }, { pid: 'pC', qty: 1, price: 6 }], [{ pid: 'pC', qty: 1, price: 6 }, { pid: 'pC', qty: 12, price: 5 }]]) {
      const x = await go(items);
      assert.equal(x.status, 'OK', x.text); assert.equal(x.result.total, 60); assert.equal(x.result.calc.gift, 6);
    }
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
    // 2026-11-12: פרטי כניסה בשורש (private/payCred), מפתח של largpeami
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: 'largpeami', mode: 'link', link: 'https://pay.example.com/l', sup: { id: 's1', name: 'ספק' }, cred: { user: 'u1', pass: 'p1' } })).result.cred, true);
    assert.ok((await get('private/payCred')).box);
    assert.deepEqual((await call('getPayLink', LE, { id: r.result.id, auto: true })).result.auto, { user: 'u1', pass: 'p1' });
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
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).pay, { mode: 'phone', has: false, cred: false });
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


// 2026-11-12: copyF – שדות "העתק פרטי לקוח" בהזמנת ניוד (מנהל בלבד, רשימה סגורה + שדות חופשיים מוגדרים)
describe('setOrderCfg – copyF', () => {
  it('מנהל שומר רשימה בסדר שלו בנפרד מ-src/vat; עובד נדחה; ולידציה', async () => {
    await prep((d) => d.doc(`b/${A}/custcfg/main`).set({ xKeys: [{ k: 'xcity', label: 'עיר' }] }));
    await call('setOrderCfg', MGR, { vat: 17 });
    const F = ['ccvv', 'name', 'phone', 'phs', 'tz', 'mail', 'st', 'city', 'fl', 'apt', 'bank', 'prod', 'due', 'orig', 'stat', 'note', 'od', 'lines', 'no', 'total', 'cnum', 'cexp', 'cname', 'x:xcity'];
    const r = await call('setOrderCfg', MGR, { copyF: F });
    assert.equal(r.status, 'OK', r.text); assert.deepEqual(r.result.copyF, F);
    const c = await get(`b/${A}/ordcfg/main`); assert.deepEqual(c.copyF, F); assert.equal(c.vat, 17, 'הגדרות אחרות נשמרות');
    assert.deepEqual((await call('setOrderCfg', MGR, { copyF: ['phone', 'name'] })).result.copyF, ['phone', 'name']);
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).copyF, ['phone', 'name'], 'רשימה מוחלפת כולה');
    assert.deepEqual((await call('setOrderCfg', MGR, { copyF: [] })).result.copyF, []);
    for (const u of [E1, NOORD]) assert.ok(['manager-only', 'no-perm'].includes((await call('setOrderCfg', u, { copyF: ['name'] })).reason));
    for (const v of ['name', null, ['name', 'name'], ['evil'], ['x:xnone'], ['x:XCITY'], [1], ['__proto__'], Array(41).fill('name')]) {
      assert.equal((await call('setOrderCfg', MGR, { copyF: v })).reason, 'bad-copyf', JSON.stringify(v).slice(0, 40));
    }
    assert.equal((await call('setOrderCfg', MGR, { copyF: ['name'], vat: 18 })).reason, 'bad-copyf');
    assert.deepEqual((await get(`b/${A}/ordcfg/main`)).copyF, []);
  });
});

// 14.11.2026 (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 1): מחיר ברירת מחדל ללקוח, מינימום מחיר בשרת, חסימה, vm/net/vat/gross, הנחה כללית
describe('לקוח עסקי ומחירים – שלב 1 (14.11.2026)', () => {
  const WS = 'p0541111111', PR = 'p0542222222';
  async function seedBiz(extra) {
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc(`b/${A}/cust/${WS}`), Object.assign({ name: 'מסעדה', bn: 'מסעדה', phone: '0541111111', wholesale: true, at: 1, upd: 1, x: {} }, extra || {}));
      b.set(d.doc(`b/${A}/cust/${PR}`), { name: 'פרטי', phone: '0542222222', at: 1, upd: 1, x: {} });
      b.set(d.doc(`b/${A}/prod/pA/p/ws`), { wp: 6 });
      b.set(d.doc(`b/${A}/ordcfg/price`), { pct: 15 });
      await b.commit();
    });
  }
  const mk = (u, custId, items, x) => call('createOrder', u, Object.assign({ reqId: rid(), br: 'br1', cust, custId, items }, x || {}));
  it('עובד מתחת למינימום / מתחת לעלות / בלי עלות – נדחה עם reason price-floor; בדיוק במינימום – עובר; מנהל עוקף; בלי ordcfg/price – כמו קודם', async () => {
    await seedBiz();
    // לקוח פרטי: pA עלות 4 כולל מע"מ, 15% → מינימום 4.60
    let r = await mk(E1, PR, [{ pid: 'pA', qty: 1, price: 4.59 }]);
    assert.equal(r.status, 'INVALID_ARGUMENT'); assert.equal(r.reason, 'price-floor', r.text); assert.match(r.text, /אין אפשרות לתת במחיר הזה/);
    assert.equal((await mk(E1, PR, [{ pid: 'pA', qty: 1, price: 3.99 }])).reason, 'price-floor');
    assert.equal((await mk(E1, '', [{ pid: 'pA', qty: 1, price: 4.59 }])).reason, 'price-floor'); // גם בלי לקוח מקושר
    r = await mk(E1, PR, [{ pid: 'pA', qty: 1, price: 4.6 }]); assert.equal(r.status, 'OK', r.text);
    assert.equal((await mk(MGR, PR, [{ pid: 'pA', qty: 1, price: 1 }])).status, 'OK');
    // pB בלי עלות: עובד לא מוריד מתחת למחיר הרגיל (הנחה)
    assert.equal((await mk(E1, PR, [{ pid: 'pB', qty: 1, price: 7 }])).reason, 'price-floor');
    assert.equal((await mk(E1, PR, [{ pid: 'pB', qty: 1, price: 7.5 }])).status, 'OK');
    // לקוח עסקי: היחידה לפני מע"מ – 4 ÷ 1.18 × 1.15 = 3.90
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1, price: 3.89 }])).reason, 'price-floor');
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1, price: 3.9 }])).status, 'OK');
    // שורה חופשית – בלי מינימום
    assert.equal((await mk(E1, PR, [{ n: 'משלוח', qty: 1, price: 0 }])).status, 'OK');
    await prep((d) => d.doc(`b/${A}/ordcfg/price`).delete());
    assert.equal((await mk(E1, PR, [{ pid: 'pA', qty: 1, price: 1 }])).status, 'OK');
  });
  it('סדר מחיר לשורה בלי מחיר: קבוע ← סיטונאי ← רגיל (עסקי בלי סיטונאי = רגיל ÷ 1.18); vm/vr/net/vat/gross; שולם = gross', async () => {
    await seedBiz();
    let r = await mk(E1, WS, [{ pid: 'pA', qty: 2 }, { pid: 'pB', qty: 1 }]);
    assert.equal(r.status, 'OK', r.text);
    let o = await get(`b/${A}/ord/${r.result.id}`);
    assert.deepEqual(o.items.map((x) => x.price), [6, 6.36]);
    assert.equal(o.total, 18.36); assert.equal(o.vm, 'ex'); assert.equal(o.vr, 18); assert.equal(o.net, 18.36); assert.equal(o.vat, 3.3); assert.equal(o.gross, 21.66);
    await prep((d) => d.doc(`b/${A}/cprice/${WS}_pB`).set({ cust: WS, pid: 'pB', p: 5 }));
    await prep((d) => d.doc(`b/${A}/cprice/${PR}_pA`).set({ cust: PR, pid: 'pA', p: 9 }));
    r = await mk(MGR, WS, [{ pid: 'pB', qty: 1 }]); assert.equal((await get(`b/${A}/ord/${r.result.id}`)).items[0].price, 5);
    // סבב 2 (ליקוי 2): מחיר קבוע לא מכשיר את עצמו – pB בלי עלות, 5 מתחת לברירת המחדל 6.36 → עובד נחסם (גם בשורה בלי מחיר)
    assert.equal((await mk(E1, WS, [{ pid: 'pB', qty: 1, price: 5 }])).reason, 'price-floor');
    assert.equal((await mk(E1, WS, [{ pid: 'pB', qty: 1 }])).reason, 'price-floor');
    // פרטי: מחיר רגיל, או קבוע שלו; vm inc, gross = total
    r = await mk(E1, PR, [{ pid: 'pA', qty: 1 }, { pid: 'pB', qty: 1 }]);
    o = await get(`b/${A}/ord/${r.result.id}`);
    assert.deepEqual(o.items.map((x) => x.price), [9, 7.5]); assert.equal(o.vm, 'inc'); assert.equal(o.gross, 16.5); assert.equal(o.net, 13.98); assert.equal(o.vat, 2.52);
    // יומן: מחיר שונה מברירת המחדל נרשם (מי, מתי, ממחיר למחיר)
    r = await mk(E1, PR, [{ pid: 'pB', qty: 1, price: 8 }]);
    const lg = await coll(`b/${A}/ord/${r.result.id}/log`); assert.match(lg[0].note, /לחם: ₪7.5 → ₪8/);
    // תשלום: עסקי – gross
    r = await mk(E1, WS, [{ pid: 'pA', qty: 1 }]);
    assert.equal((await call('markOrderPaid', E1, { id: r.result.id, method: 'cash' })).status, 'OK');
    assert.equal((await get(`b/${A}/ord/${r.result.id}`)).paid.amt, 7.08);
  });
  it('לקוח חסום: עובד לא פותח הזמנה, מנהל כן', async () => {
    await seedBiz({ blk: true });
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1 }])).reason, 'cust-blocked');
    assert.equal((await mk(MGR, WS, [{ pid: 'pA', qty: 1 }])).status, 'OK');
  });
  it('updateOrder נאכף כמו יצירה; שורה שלא השתנתה לא נחסמת (גם אם העלות עלתה); סכומים מתעדכנים', async () => {
    await seedBiz();
    const id = (await mk(E1, PR, [{ pid: 'pA', qty: 1, price: 5 }])).result.id;
    assert.equal((await call('updateOrder', E1, { id, items: [{ pid: 'pA', qty: 1, price: 4.5 }] })).reason, 'price-floor');
    await prep((d) => d.doc(`b/${A}/prod/pA/p/cost`).set({ cost: 6 }));
    let r = await call('updateOrder', E1, { id, items: [{ pid: 'pA', qty: 1, price: 5 }, { n: 'משלוח', qty: 1, price: 10 }] });
    assert.equal(r.status, 'OK', r.text);
    const o = await get(`b/${A}/ord/${id}`); assert.equal(o.total, 15); assert.equal(o.gross, 15); assert.equal(o.net, 12.71);
    r = await call('updateOrder', E1, { id, items: [{ pid: 'pA', qty: 1, price: 6.5 }] }); assert.equal(r.reason, 'price-floor'); // 6 × 1.15 = 6.90
    assert.equal((await call('updateOrder', MGR, { id, items: [{ pid: 'pA', qty: 1, price: 6.5 }] })).status, 'OK');
  });
  it('הזמנה ישנה בלי vm: עריכה שומרת אותה כמו קודם (בלי שדות חדשים)', async () => {
    await seedBiz();
    await prep((d) => d.doc(`b/${A}/ord/old1`).set({ no: 7, src: 'staff', br: 'br1', cust, items: [{ pid: 'pA', n: 'עוגה', qty: 1, price: 3 }], total: 3, status: 'new', by: E1, at: 1, upd: 1 }));
    const r = await call('updateOrder', E1, { id: 'old1', items: [{ pid: 'pA', qty: 1, price: 3 }], note: 'x' });
    assert.equal(r.status, 'OK', r.text);
    const o = await get(`b/${A}/ord/old1`);
    for (const k of ['vm', 'vr', 'net', 'vat', 'gross', 'disc']) assert.equal(o[k], undefined, k);
    assert.equal(o.total, 3); assert.equal(o.items[0].price, 3);
    assert.equal((await call('updateOrder', MGR, { id: 'old1', disc: 5 })).reason, 'no-vm');
    assert.equal((await call('markOrderPaid', E1, { id: 'old1', method: 'cash' })).status, 'OK');
    assert.equal((await get(`b/${A}/ord/old1`)).paid.amt, 3);
  });
  it('הנחה כללית: עובד – נדחה; מנהל עד המגבלה; gross אחרי הנחה; עריכה משנה', async () => {
    await seedBiz({}); await prep((d) => d.doc(`b/${A}/ordcfg/price`).set({ pct: 15, disc: 5 }));
    assert.equal((await mk(E1, PR, [{ pid: 'pA', qty: 1, price: 10 }], { disc: 5 })).reason, 'manager-only');
    assert.equal((await mk(MGR, PR, [{ pid: 'pA', qty: 1, price: 10 }], { disc: 6 })).reason, 'disc-limit');
    assert.equal((await mk(MGR, PR, [{ pid: 'pA', qty: 1, price: 10 }], { disc: 'x' })).reason, 'bad-disc');
    const r = await mk(MGR, PR, [{ pid: 'pA', qty: 2, price: 10 }], { disc: 5 });
    assert.equal(r.status, 'OK', r.text);
    let o = await get(`b/${A}/ord/${r.result.id}`); assert.equal(o.total, 20); assert.equal(o.disc, 5); assert.equal(o.gross, 19);
    assert.equal((await call('updateOrder', E1, { id: r.result.id, disc: 0 })).reason, 'manager-only');
    assert.equal((await call('updateOrder', MGR, { id: r.result.id, disc: 0 })).status, 'OK');
    o = await get(`b/${A}/ord/${r.result.id}`); assert.equal(o.disc, undefined); assert.equal(o.gross, 20);
  });

  // ---------- סבב 2 (ליקויים 2–7) ----------
  it('סבב 2: לקוח עסקי – מתחת לעלות חסום לעובד גם בלי ordcfg/price; פרטי בלי הגדרה – כמו קודם; מחיר קבוע של מנהל מתחת למינימום לא עובר לעובד', async () => {
    await seedBiz(); await prep((d) => d.doc(`b/${A}/ordcfg/price`).delete());
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1, price: 3.38 }])).reason, 'price-floor'); // עלות 4 ÷ 1.18 = 3.39
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1, price: 3.39 }])).status, 'OK');
    assert.equal((await mk(E1, PR, [{ pid: 'pA', qty: 1, price: 1 }])).status, 'OK');
    assert.equal((await mk(MGR, WS, [{ pid: 'pA', qty: 1, price: 1 }])).status, 'OK');
    await prep((d) => d.doc(`b/${A}/ordcfg/price`).set({ pct: 15 }));
    await prep((d) => d.doc(`b/${A}/cprice/${WS}_pA`).set({ cust: WS, pid: 'pA', p: 3.5, vm: 'ex' })); // מנהל קבע 3.50 (מתחת ל-3.90)
    const r = await mk(E1, WS, [{ pid: 'pA', qty: 1 }]);
    assert.equal(r.reason, 'price-floor'); assert.match(r.text, /3\.9/); // רשומה ישנה בלי mg – כמו עובד (מחמיר)
  });
  it('סבב 3 (החלטה 8): מחיר קבוע שמנהל שמר (mg) – מאושר לעובד גם מתחת למינימום ולעלות; שעובד שמר – נבדק כרגיל', async () => {
    await seedBiz();
    // מנהל שמר 3.00 (מתחת למינימום 3.90 ומתחת לעלות 3.39)
    await prep((d) => d.doc(`b/${A}/cprice/${WS}_pA`).set({ cust: WS, pid: 'pA', p: 3, vm: 'ex', mg: true }));
    let r = await mk(E1, WS, [{ pid: 'pA', qty: 1 }]); assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/ord/${r.result.id}`)).items[0].price, 3);
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1, price: 3 }])).status, 'OK');
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1, price: 3.5 }])).status, 'OK'); // מעל המחיר שהמנהל אישר
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1, price: 2.99 }])).reason, 'price-floor'); // מתחתיו – נבדק כרגיל
    // בעריכה – אותו דבר
    assert.equal((await call('updateOrder', E1, { id: r.result.id, items: [{ pid: 'pA', qty: 2, price: 3 }] })).status, 'OK');
    // עובד שמר (mg:false) – נבדק כרגיל
    await prep((d) => d.doc(`b/${A}/cprice/${WS}_pA`).set({ cust: WS, pid: 'pA', p: 3, vm: 'ex', mg: false }));
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1 }])).reason, 'price-floor');
    // דרך setCustPrice: מנהל שומר → mg:true, ועובד יכול להשתמש
    await prep((d) => d.doc(`b/${A}/cprice/${WS}_pA`).delete());
    assert.equal((await call('setCustPrice', MGR, { custId: WS, pid: 'pA', p: 2.5 })).status, 'OK');
    assert.equal((await get(`b/${A}/cprice/${WS}_pA`)).mg, true);
    assert.equal((await mk(E1, WS, [{ pid: 'pA', qty: 1 }])).status, 'OK');
  });
  it('סבב 3: לקוח עסקי, מוצר בלי עלות – עובד לא נותן מחיר 0 (גם בלי ordcfg/price); מנהל – מותר; פרטי בלי הגדרה – כמו קודם', async () => {
    await seedBiz(); await prep((d) => d.doc(`b/${A}/ordcfg/price`).delete());
    const r = await mk(E1, WS, [{ pid: 'pB', qty: 1, price: 0 }]);
    assert.equal(r.reason, 'price-floor'); assert.match(r.text, /במחיר 0/);
    assert.equal((await mk(E1, WS, [{ pid: 'pB', qty: 1, price: 1 }])).status, 'OK');
    assert.equal((await mk(MGR, WS, [{ pid: 'pB', qty: 1, price: 0 }])).status, 'OK');
    assert.equal((await mk(E1, PR, [{ pid: 'pB', qty: 1, price: 0 }])).status, 'OK');
  });
  it('סבב 2: מחיר קבוע ב-vm אחר – המרה לפי מע"מ (פרטי→עסקי ועסקי→פרטי)', async () => {
    await seedBiz();
    await prep((d) => d.doc(`b/${A}/cprice/${WS}_pA`).set({ cust: WS, pid: 'pA', p: 11.8, vm: 'inc' }));
    await prep((d) => d.doc(`b/${A}/cprice/${PR}_pA`).set({ cust: PR, pid: 'pA', p: 5, vm: 'ex' }));
    let r = await mk(E1, WS, [{ pid: 'pA', qty: 1 }]); assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/ord/${r.result.id}`)).items[0].price, 10);
    r = await mk(E1, PR, [{ pid: 'pA', qty: 1 }]); assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/ord/${r.result.id}`)).items[0].price, 5.9);
  });
  it('סבב 2+3: שורה חופשית בשם של מוצר קיים – עובד נדחה (use-stock) בלקוח עסקי, גם בעריכה; לקוח פרטי – כמו קודם; משלוח – כמו קודם; מנהל – מותר; שורה ישנה שלא השתנתה – עוברת', async () => {
    await seedBiz();
    assert.equal((await mk(E1, WS, [{ n: 'עוגה', qty: 1, price: 0 }])).reason, 'use-stock');
    assert.equal((await mk(E1, WS, [{ n: ' עוגה ', qty: 1, price: 1 }])).reason, 'use-stock');
    await prep((d) => d.doc(`b/${A}/prod/pB`).update({ al: ['כיכר'] }));
    assert.equal((await mk(E1, WS, [{ n: 'כיכר', qty: 1, price: 1 }])).reason, 'use-stock');
    assert.equal((await mk(E1, WS, [{ n: 'משלוח', qty: 1, price: 0 }])).status, 'OK');
    // סבב 3: לקוח פרטי / בלי לקוח – כמו לפני המשימה
    assert.equal((await mk(E1, PR, [{ n: 'עוגה', qty: 1, price: 1 }])).status, 'OK');
    assert.equal((await mk(E1, '', [{ n: 'כיכר', qty: 1, price: 1 }])).status, 'OK');
    const m = await mk(MGR, WS, [{ n: 'עוגה', qty: 1, price: 1 }]); assert.equal(m.status, 'OK');
    assert.equal((await call('updateOrder', E1, { id: m.result.id, items: [{ n: 'עוגה', qty: 1, price: 1 }, { n: 'משלוח', qty: 1, price: 5 }] })).status, 'OK');
    assert.equal((await call('updateOrder', E1, { id: m.result.id, items: [{ n: 'עוגה', qty: 1, price: 0.5 }] })).reason, 'use-stock');
  });
  it('סבב 2: הסכום לתשלום = gross – createOrder/updateOrder מחזירים gross, getPayLink מחזיר gross; הזמנה ישנה – total', async () => {
    await seedBiz();
    assert.equal((await call('setBusinessPayLink', SUPER, { bizId: A, mode: 'link', link: 'https://pay.example.com/biz' })).status, 'OK');
    const r = await mk(E1, WS, [{ pid: 'pA', qty: 1 }]); assert.equal(r.result.total, 6); assert.equal(r.result.gross, 7.08);
    assert.equal((await call('getPayLink', E1, { id: r.result.id })).result.total, 7.08);
    const u = await call('updateOrder', E1, { id: r.result.id, items: [{ pid: 'pA', qty: 2, price: 6 }] }); assert.equal(u.result.gross, 14.16);
    await prep((d) => d.doc(`b/${A}/ord/old2`).set({ no: 9, src: 'staff', br: 'br1', cust, items: [{ n: 'x', qty: 1, price: 3 }], total: 3, status: 'new', by: E1, at: 1, upd: 1 }));
    assert.equal((await call('getPayLink', E1, { id: 'old2' })).result.total, 3);
  });
});

describe('רשימה חופשית, חיפוש וכינויים – שלב 2 חלק ב\' (14.11.2026)', () => {
  const M = require('./gemini-mock');
  const CAT = JSON.parse(fsm.readFileSync(path.join(__dirname, 'prod-match-cases.json'), 'utf8')).catalog;
  const WS = 'p0543333333';
  before(() => M.start());
  after(() => M.stop());
  beforeEach(async () => {
    M.reset();
    await prep(async (d) => {
      const b = d.batch();
      for (const p of CAT) b.set(d.doc(`b/${A}/prod/${p.id}`), Object.assign({ price: 10, on: true, q: {} }, p, p.id === 'nap' ? { ct: 10 } : {}, p.id === 'bag' ? { ct: 12, cto: true } : {}));
      b.set(d.doc(`b/${A}/cust/${WS}`), { name: 'מסעדה', phone: '0543333333', wholesale: true, at: 1, upd: 1, x: {} });
      await b.commit();
    });
  });
  const ords = () => M.state.requests.filter((r) => r.kind === 'ordparse');
  // 10 שורות: 8 מוכרות (כולל שם ישן, ברקוד, קרטונים) ו-2 שלא ברור לאיזה מוצר הכוונה ("כפפות" – שני מוצרים, "במב" – שני גדלים)
  const TEN = ['צלחת עמוקה', '3 שקית זבל', '5 קרטונים מפיות', 'כוסות 200 מל x2', 'ביסלי גריל 4', 'סוללות AA', 'קולה זירו 6', '7290002', 'כפפות 2', 'במב 10'].join('\n');

  it('קריטריון 3: רשימה של 10 שורות, 8 מוכרות – בלי ai אין שום פנייה ל-AI; עם ai נשלחות ל-AI רק 2 השורות (נמדד בשרת המדומה)', async () => {
    const r0 = await call('ordParse', E1, { text: TEN });
    assert.equal(r0.status, 'OK', r0.text);
    assert.equal(r0.result.lines.length, 10);
    assert.equal(r0.result.need, 2); assert.equal(ords().length, 0, 'בלי ai – אין פנייה');
    assert.ok(r0.result.est && r0.result.est.usd > 0, 'עלות משוערת לפני הפעולה');
    const L = r0.result.lines;
    assert.equal(L[0].pid, 'mg', 'שם ישן (כינוי) → המוצר ששמו שונה'); assert.equal(L[0].pn, 'מגשים עמוקים');
    assert.equal(L[7].pid, 'mgf'); assert.equal(L[7].by, 'code');
    assert.deepEqual([L[2].pid, L[2].q, L[2].conv], ['nap', 50, 10], '5 קרטונים × 10');
    assert.deepEqual([L[3].pid, L[3].q], ['cup', 2]);
    assert.equal(L[8].pid, null); assert.equal(L[9].pid, null);
    assert.ok(L[8].alts.some((x) => x.id === 'gl') && L[8].alts.some((x) => x.id === 'gl2'), 'חלופות לבחירה');
    const r1 = await call('ordParse', E1, { text: TEN, ai: true });
    assert.equal(r1.status, 'OK', r1.text);
    assert.equal(ords().length, 1, 'קריאת AI אחת');
    const P = M.ordPayload(ords()[0].body);
    assert.equal(P.length, 2, 'רק 2 שורות נשלחו ל-AI');
    assert.deepEqual(P.map((x) => x.i), [8, 9]);
    assert.ok(P.every((x) => x.c.length >= 2 && x.c.length <= 20), 'עד 20 מועמדים');
    assert.ok(!JSON.stringify(P).includes('צלחת'), 'שורה שזוהתה לא נשלחה');
    assert.equal(r1.result.ai.sent, 2); assert.equal(r1.result.ai.got, 2);
    assert.equal(r1.result.lines[8].by, 'ai'); assert.ok(['gl', 'gl2'].includes(r1.result.lines[8].pid));
    assert.equal((await get(`b/${A}/scan_usage/_ordai`)).count, 1, 'מונה המכסה היומית');
  });

  it('AI בוחר רק מתוך הרשימה: id שלא ברשימה של השורה נזרק; שורה בלי מועמדים לא נשלחת; תשובה לא תקינה – בלי בחירה', async () => {
    M.state.ordparse = (P) => ({ r: P.map((l) => ({ i: l.i, id: l.i === 8 ? 'mg' : l.c[0].id })) });
    const r = await call('ordParse', E1, { text: TEN + '\nמחשב נייד', ai: true });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.none, 1); assert.equal(M.ordPayload(ords()[0].body).length, 2, 'מחשב נייד (אין מועמדים) לא נשלח');
    assert.equal(r.result.lines[8].pid, null, 'mg אינו מועמד של "כפפות"');
    assert.equal(r.result.lines[10].pid, null); assert.equal(r.result.lines[10].alts.length, 0);
    M.state.ordparse = () => 'not json';
    const r2 = await call('ordParse', E1, { text: 'כפפות', ai: true });
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.lines[0].pid, null); assert.equal(r2.result.ai.got, 0);
  });

  it('לקוח עסקי + "רק קרטונים" (33): 3 = 3 קרטונים (cto); קנה בעבר מכריע בין שני מוצרים קרובים; צילום (lines) עובר אותה התאמה', async () => {
    const r = await call('ordParse', E1, { text: '3 שקית זבל', custId: WS });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual([r.result.lines[0].pid, r.result.lines[0].q, r.result.lines[0].cto], ['bag', 3, true]);
    const r0 = await call('ordParse', E1, { text: '3 שקית זבל' });
    assert.equal(r0.result.lines[0].cto, undefined, 'לקוח רגיל – כמו קודם');
    await prep((d) => d.doc(`b/${A}/ord/o1`).set({ no: 1, custId: WS, items: [{ pid: 'gl2', n: 'כפפות עבודה', qty: 1, price: 5 }], status: 'done', at: 1 }));
    const r2 = await call('ordParse', E1, { text: 'כפפות', custId: WS });
    assert.equal(r2.result.lines[0].pid, 'gl2', 'מה שהלקוח קנה בעבר'); assert.equal(r2.result.need, 0);
    const r3 = await call('ordParse', E1, { lines: [{ name: 'צלחות עמוקות', qty: 5, unit: 'ct' }, { name: 'מפיות', qty: 2 }] });
    assert.equal(r3.status, 'OK', r3.text);
    assert.deepEqual(r3.result.lines.map((x) => [x.pid, x.q]), [['mg', 5], ['nap', 2]], 'מגשים בלי ct – 5 (noCt)'); assert.equal(r3.result.lines[0].noCt, true);
  });

  it('הרשאות, מכסה יומית ותוספת "זיהוי חכם"', async () => {
    assert.equal((await call('ordParse', NOORD, { text: 'מפית' })).reason, 'no-perm');
    assert.equal((await call('ordParse', E1, { text: '' })).reason, 'bad-text');
    assert.equal((await call('ordParse', E1, { text: 'x'.repeat(4001) })).reason, 'bad-text');
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    await prep((d) => d.doc(`b/${A}/scan_usage/_ordai`).set({ day, count: 30 }));
    const q = await call('ordParse', E1, { text: 'כפפות', ai: true });
    assert.equal(q.reason, 'ord-ai-limit'); assert.equal(ords().length, 0, 'מעבר למכסה – לא נשלח');
    await prep((d) => d.doc(`b/${A}/scan_usage/_ordai`).set({ day: '2000-01-01', count: 30 }));
    await prep((d) => d.doc('b/' + A).update({ features: Object.assign({}, ALL, { scan: false }) }));
    assert.equal((await call('ordParse', E1, { text: 'כפפות', ai: true })).reason, 'feature-off');
    assert.equal((await call('ordParse', E1, { text: 'כפפות' })).status, 'OK', 'התאמה רגילה – בלי התוספת');
    assert.equal(ords().length, 0);
    // רצף שנראה כמו מספר כרטיס – מוסר מהשורה ולא נשלח
    await prep((d) => d.doc('b/' + A).update({ features: ALL }));
    const c = await call('ordParse', E1, { text: 'כפפות 4111 1111 1111 1111', ai: true });
    assert.equal(c.status, 'OK', c.text); assert.ok(!JSON.stringify(c.result).includes('4111')); assert.ok(!JSON.stringify(M.state.requests.map((x) => x.body)).includes('4111'));
  });

  it('צילום רשימה (scanDocument ordlist): עובד עם ord – שורות שם+כמות; בלי ord – נדחה לפני Gemini', async () => {
    const jpg = { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64') };
    const r = await call('scanDocument', E1, { kind: 'ordlist', files: [jpg] });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.data.lines.length, 3); assert.equal(M.state.requests[0].kind, 'ordlist');
    M.reset();
    assert.equal((await call('scanDocument', NOORD, { kind: 'ordlist', files: [jpg] })).reason, 'no-perm');
    assert.equal(M.state.requests.length, 0);
  });

  it('שינוי שם (saveProduct): השם הקודם נשמר ככינוי, בלי כפילות; חזרה לשם ישן מוציאה אותו מהכינויים', async () => {
    const up = (name) => call('saveProduct', E1, { id: 'mgf', name, price: 10 });
    assert.equal((await up('מגשים שטוחים גדולים')).status, 'OK');
    assert.deepEqual((await get(`b/${A}/prod/mgf`)).al, ['מגשים שטוחים']);
    await up('מגש שטוח XL');
    assert.deepEqual((await get(`b/${A}/prod/mgf`)).al, ['מגשים שטוחים', 'מגשים שטוחים גדולים']);
    await up('מגשים  שטוחים'); // אותו שם אחרי נרמול – יוצא מהכינויים, ו-"מגש שטוח XL" נכנס
    assert.deepEqual((await get(`b/${A}/prod/mgf`)).al, ['מגשים שטוחים גדולים', 'מגש שטוח XL']);
    await call('saveProduct', E1, { id: 'mgf', name: 'מגשים  שטוחים', price: 12 }); // בלי שינוי שם – בלי שינוי בכינויים
    assert.deepEqual((await get(`b/${A}/prod/mgf`)).al, ['מגשים שטוחים גדולים', 'מגש שטוח XL']);
    const pa = await call('ordParse', E1, { text: 'מגש שטוח XL' });
    assert.equal(pa.result.lines[0].pid, 'mgf', 'הכינוי מזוהה מיד (האינדקס מתרענן אחרי שינוי)');
  });

  it('שינוי שם בהכנסת מלאי (stockIn nm) ומחיקת כינוי (delAlias): עובד עם ord כן, בלי ord לא', async () => {
    const s = await call('stockIn', E1, { reqId: rid(), br: 'br1', lines: [{ pid: 'foil', qty: 2, nm: 'נייר אלומיניום' }, { pid: 'nap', qty: 1 }] });
    assert.equal(s.status, 'OK', s.text);
    const f = await get(`b/${A}/prod/foil`);
    assert.equal(f.name, 'נייר אלומיניום'); assert.deepEqual(f.al, ['נייר כסף מקצועי']); assert.equal(f.q.br1, 2);
    assert.equal((await get(`b/${A}/prod/nap`)).name, 'מפיות לבנות');
    assert.ok((await coll(`b/${A}/stockLog`)).some((x) => x.prod === 'foil' && x.why === 'prod' && /נייר כסף/.test(x.note)));
    assert.equal((await call('stockIn', E1, { reqId: rid(), br: 'br1', lines: [{ pid: 'foil', qty: 1, nm: 'x'.repeat(61) }] })).reason, 'bad-name');
    assert.equal((await call('delAlias', NOORD, { pid: 'foil', al: 'נייר כסף מקצועי' })).reason, 'no-perm');
    const d = await call('delAlias', E1, { pid: 'foil', al: 'נייר  כסף מקצועי' });
    assert.equal(d.status, 'OK', d.text); assert.equal(d.result.removed, 1);
    assert.deepEqual((await get(`b/${A}/prod/foil`)).al, []);
    assert.equal((await call('delAlias', E1, { pid: 'foil', al: 'לא קיים' })).result.removed, 0);
    assert.equal((await call('delAlias', E1, { pid: 'nope', al: 'x' })).status, 'NOT_FOUND');
    assert.equal((await call('delAlias', E1, { pid: 'foil', al: '' })).reason, 'bad-al');
  });
});

// 14.11.2026 (משוב בעל הפרויקט, סבב 2 – סעיף 5, החלטות 13–16): לקוח בשוטף – "נשלח" ← ממתין לתשלום (shp), נעילה, שולם ← הושלם
describe('לקוח בשוטף – נשלח, נעילה ושולם (משוב סבב 2)', () => {
  const ST = ['new', 'work', 'wait_pay', 'paid', 'out', 'done', 'cancel'];
  const OK = { new: ['work', 'wait_pay'], work: ['wait_pay', 'new'], wait_pay: ['work'], paid: ['out', 'done'], out: ['done'], done: [], cancel: [] };
  async function seedT() {
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc(`b/${A}/cust/cT`), { name: 'שוטף 30', bn: 'חברה', phone: '0541111111', terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} });
      b.set(d.doc(`b/${A}/cust/cV`), { name: 'שוטף מהחשבונית', phone: '0541111112', terms: { b: 'inv', d: 45 }, at: 1, upd: 1, x: {} });
      b.set(d.doc(`b/${A}/cust/cN`), { name: 'ישן שוטף+60', phone: '0541111113', pay: 'n60', at: 1, upd: 1, x: {} });
      b.set(d.doc(`b/${A}/cust/cI`), { name: 'עסקי מיידי', bn: 'מיידי', phone: '0541111114', terms: { b: 'imm', d: 0 }, at: 1, upd: 1, x: {} });
      b.set(d.doc(`b/${A}/cust/cP`), { name: 'פרטי', phone: '0541111115', pay: 'cash', at: 1, upd: 1, x: {} });
      await b.commit();
    });
  }
  const mk = async (custId) => { const r = await call('createOrder', E1, Object.assign({ reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 1, price: 10 }] }, custId ? { custId } : {})); assert.equal(r.status, 'OK', r.text); return r.result.id; };
  const setSt = (id, status) => prep((d) => d.doc(`b/${A}/ord/${id}`).update({ status }));
  it('בשוטף: בטיפול ← "נשלח" = ממתין לתשלום + shp; שליחה כפולה – בלי שינוי; יומן ship', async () => {
    await seedT();
    const id = await mk('cT');
    await setSt(id, 'work');
    const r = await call('setOrderStatus', E1, { id, status: 'out' });
    assert.equal(r.status, 'OK', r.text); assert.deepEqual(r.result, { ok: true, status: 'wait_pay' });
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.status, 'wait_pay'); assert.equal(o.shp.by, E1); assert.equal(typeof o.shp.at, 'number'); assert.equal(o.paid, undefined);
    const r2 = await call('setOrderStatus', E1, { id, status: 'out' });
    assert.deepEqual(r2.result, { ok: true, status: 'wait_pay', dup: true });
    assert.equal((await get(`b/${A}/ord/${id}`)).shp.at, o.shp.at);
    const lg = await coll(`b/${A}/ord/${id}/log`);
    assert.equal(lg.filter((x) => x.act === 'ship').length, 1); assert.equal(lg.find((x) => x.act === 'ship').note, 'work→wait_pay');
  });
  it('אחרי "נשלח": עריכה נעולה (עובד ומנהל, גם הערה בלבד), אין חזרה לבטיפול, המלאי לא משתנה', async () => {
    await seedT();
    const id = await mk('cV');
    await setSt(id, 'work');
    assert.equal((await call('setOrderStatus', E1, { id, status: 'out' })).status, 'OK');
    const q0 = (await get(`b/${A}/prod/pA`)).q.br1;
    for (const u of [E1, MGR]) {
      assert.equal((await call('updateOrder', u, { id, items: [{ pid: 'pA', qty: 2, price: 10 }] })).reason, 'locked');
      assert.equal((await call('updateOrder', u, { id, note: 'x' })).reason, 'locked');
      assert.equal((await call('setOrderStatus', u, { id, status: 'work' })).reason, 'locked');
    }
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.status, 'wait_pay'); assert.equal(o.total, 10); assert.equal((await get(`b/${A}/prod/pA`)).q.br1, q0);
  });
  it('נשלח ושולם ← ישר "הושלם", נספר כשולם בסיכום; מנהל מבטל "שולם" ← ממתין לתשלום וה-shp נשאר; עובד – לא', async () => {
    await seedT();
    const id = await mk('cT');
    await setSt(id, 'work');
    await call('setOrderStatus', E1, { id, status: 'out' });
    const p = await call('markOrderPaid', E1, { id, method: 'transfer' });
    assert.deepEqual(p.result, { ok: true, dup: false });
    let o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.status, 'done'); assert.equal(o.paid.amt, 10); assert.equal(o.paid.method, 'transfer'); assert.ok(o.shp);
    assert.deepEqual((await call('markOrderPaid', E1, { id, method: 'cash' })).result, { ok: true, dup: true });
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    const s = await call('ordProfit', MGR, { from: day, to: day, lite: true });
    assert.equal(s.status, 'OK', s.text); assert.equal(s.result.paidN, 1); assert.equal(s.result.paid, 10);
    assert.equal((await call('unpayOrder', E1, { id, reason: 'x' })).reason, 'manager-only');
    assert.equal((await call('unpayOrder', MGR, { id, reason: 'טעות' })).status, 'OK');
    o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.status, 'wait_pay'); assert.equal(o.paid, undefined); assert.ok(o.shp);
    // הזמנה רגילה שהושלמה (בלי shp) – ביטול "שולם" נדחה כמו קודם
    const id2 = await mk('cP');
    await call('markOrderPaid', E1, { id: id2, method: 'cash' }); await call('setOrderStatus', E1, { id: id2, status: 'done' });
    assert.equal((await call('unpayOrder', MGR, { id: id2, reason: 'x' })).reason, 'bad-status');
  });
  it('תיקון אחרי בדיקה: הזמנה שנשלחה לא מתבטלת (עובד ומנהל) והמלאי לא חוזר; לפני "נשלח" – ביטול כמו קודם', async () => {
    await seedT();
    const id = await mk('cT');
    await setSt(id, 'work');
    await call('setOrderStatus', E1, { id, status: 'out' });
    const q0 = (await get(`b/${A}/prod/pA`)).q.br1;
    for (const u of [E1, MGR]) assert.equal((await call('cancelOrder', u, { id, reason: 'x' })).reason, 'locked');
    assert.equal((await get(`b/${A}/ord/${id}`)).status, 'wait_pay'); assert.equal((await get(`b/${A}/prod/pA`)).q.br1, q0);
    const id2 = await mk('cT'); const q1 = (await get(`b/${A}/prod/pA`)).q.br1;
    assert.equal((await call('cancelOrder', E1, { id: id2, reason: 'x' })).status, 'OK');
    assert.equal((await get(`b/${A}/prod/pA`)).q.br1, q1 + 1);
  });
  it('תיקון אחרי בדיקה: עובד לא הופך לקוח קיים ל"בשוטף" דרך pay; שינוי pay באותם תנאים, מנהל, ולקוח חדש – כמו קודם', async () => {
    await seedT();
    const P = 'p0541111125', R = 'p0541111126', O = 'p0541111127', T = 'p0541111128';
    await prep(async (d) => { const b = d.batch();
      b.set(d.doc(`b/${A}/cust/${P}`), { name: 'פרטי', phone: '0541111125', pay: 'cash', at: 1, upd: 1, x: {} });
      b.set(d.doc(`b/${A}/cust/${R}`), { name: 'בלי pay', phone: '0541111126', at: 1, upd: 1, x: {} });
      b.set(d.doc(`b/${A}/cust/${O}`), { name: 'ישן שוטף', phone: '0541111127', pay: 'n60', at: 1, upd: 1, x: {} });
      b.set(d.doc(`b/${A}/cust/${T}`), { name: 'עם terms', phone: '0541111128', terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} });
      await b.commit(); });
    assert.equal((await call('saveCust', E1, { id: P, cust: { pay: 'n30' } })).reason, 'manager-only');
    assert.equal((await call('saveCust', E1, { id: R, cust: { pay: 'n30' }, fill: true })).reason, 'manager-only'); // fill בלקוח בלי pay
    assert.equal((await call('saveCust', E1, { id: O, cust: { pay: 'cash' } })).reason, 'manager-only'); // גם הפוך (שוטף → מיידי)
    assert.equal((await call('saveCust', E1, { id: O, cust: { pay: 'n30' } })).reason, 'manager-only'); // שוטף+60 → שוטף+30
    assert.equal((await get(`b/${A}/cust/${P}`)).pay, 'cash');
    let r = await call('saveCust', E1, { id: P, cust: { pay: 'transfer' } }); assert.equal(r.status, 'OK', r.text); assert.equal((await get(`b/${A}/cust/${P}`)).pay, 'transfer');
    r = await call('saveCust', E1, { id: P, cust: { pay: 'n30' }, fill: true }); assert.equal(r.status, 'OK', r.text); assert.equal((await get(`b/${A}/cust/${P}`)).pay, 'transfer'); // fill לא דורס
    r = await call('saveCust', E1, { id: T, cust: { pay: 'n60' } }); assert.equal(r.status, 'OK', r.text); // יש terms – pay לא משנה את התנאים
    r = await call('saveCust', MGR, { id: P, cust: { pay: 'n30' } }); assert.equal(r.status, 'OK', r.text); assert.equal((await get(`b/${A}/cust/${P}`)).pay, 'n30');
    r = await call('saveCust', E1, { cust: { name: 'חדש', phone: '0541111129', pay: 'n30' } }); assert.equal(r.status, 'OK', r.text); // לקוח חדש – כמו קודם
    // הזמנה של לקוח בלי pay – "נשלח" עדיין נדחה אחרי ניסיון העובד
    const id = await mk(R); await setSt(id, 'work');
    assert.equal((await call('setOrderStatus', E1, { id, status: 'out' })).reason, 'bad-status');
  });
  it('לקוח ישן שוטף+60 (pay:n60): נשלח עובד; גם מממתין לתשלום בלי shp. מחדשה – לא', async () => {
    await seedT();
    const id = await mk('cN');
    assert.equal((await call('setOrderStatus', E1, { id, status: 'out' })).reason, 'bad-status');
    await setSt(id, 'wait_pay');
    assert.equal((await call('setOrderStatus', E1, { id, status: 'out' })).status, 'OK');
    assert.ok((await get(`b/${A}/ord/${id}`)).shp);
  });
  it('השוואה: לקוח עסקי מיידי, פרטי, ובלי לקוח – טבלת המעברים זהה להיום, "שולם" ← paid, בלי shp', async () => {
    await seedT();
    for (const c of ['cI', 'cP', null]) {
      for (const from of ST) for (const to of ST) {
        const id = await mk(c);
        await setSt(id, from);
        const r = await call('setOrderStatus', E1, { id, status: to });
        assert.equal(r.status === 'OK', OK[from].includes(to), `${c} ${from}→${to}: ${r.text}`);
        if (r.status === 'OK') assert.deepEqual(r.result, { ok: true, status: to });
        assert.equal((await get(`b/${A}/ord/${id}`)).shp, undefined);
      }
      const id = await mk(c);
      await setSt(id, 'work');
      assert.equal((await call('markOrderPaid', E1, { id, method: 'cash' })).status, 'OK');
      assert.equal((await get(`b/${A}/ord/${id}`)).status, 'paid');
    }
  });
  it('בשוטף: כל שאר המעברים כמו היום (רק work/wait_pay → out משתנים)', async () => {
    await seedT();
    for (const from of ST) for (const to of ST) {
      const id = await mk('cT');
      await setSt(id, from);
      const r = await call('setOrderStatus', E1, { id, status: to });
      const ship = to === 'out' && (from === 'work' || from === 'wait_pay');
      assert.equal(r.status === 'OK', ship || OK[from].includes(to), `${from}→${to}: ${r.text}`);
      assert.equal((await get(`b/${A}/ord/${id}`)).status, r.status !== 'OK' ? from : ship ? 'wait_pay' : to);
    }
  });
});
