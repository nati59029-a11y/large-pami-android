'use strict';
// fb/ord-catalog: קטגוריות, מחיר לסניף, סיטונאי, ייבוא מוצרים, העברה פנימית (אוטומטית + ידנית). חלק מ-test:multibiz.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-c';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'c_mgr', E1 = 'c_e1', E2 = 'c_e2', NOORD = 'c_no', SUPER = 'c_super';
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
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };
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
    for (const [u, role] of [[MGR, 'admin'], [E1, 'worker'], [E2, 'worker'], [NOORD, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
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

describe('קטלוג: מוצר ישן, מחיר לסניף, שדות חדשים', () => {
  it('(1) מוצר ישן בלי שדות חדשים: נמכר במחיר הבסיס כשלא נשלח מחיר; עם מחיר שנשלח – כמו קודם', async () => {
    const r = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pOld', qty: 1 }, { pid: 'pOld', qty: 1, price: 9 }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.total, 19);
    const p = await get(`b/${A}/prod/pOld`);
    assert.equal(p.price, 10); assert.equal(p.bp, undefined); assert.equal(p.q.br1, 3);
  });
  it('(2) מחיר לסניף B: הזמנה ב-B מקבלת אותו, ב-A את הבסיס; עריכה עם מחיר ריק מוחקת את מחיר הסניף', async () => {
    const s = await call('saveProduct', MGR, { id: 'pB', name: 'לחם', price: 7.5, bp: { br2: 9 }, pk: 6, ct: 24, home: 'br2' });
    assert.equal(s.status, 'OK', s.text);
    const p = await get(`b/${A}/prod/pB`); assert.deepEqual(p.bp, { br2: 9 }); assert.equal(p.pk, 6); assert.equal(p.ct, 24); assert.equal(p.home, 'br2'); assert.equal(p.q.br2, 10);
    const rb = await call('createOrder', E2, { reqId: rid(), br: 'br2', cust, items: [{ pid: 'pB', qty: 1 }] });
    assert.equal(rb.result.total, 9);
    const ra = await call('createOrder', MGR, { reqId: rid(), br: 'br1', cust, items: [{ pid: 'pB', qty: 1 }] });
    assert.equal(ra.result.total, 7.5);
    await call('saveProduct', MGR, { id: 'pB', name: 'לחם', price: 7.5, bp: { br2: '' }, pk: null });
    const p2 = await get(`b/${A}/prod/pB`); assert.deepEqual(p2.bp, {}); assert.equal(p2.pk, undefined); assert.equal(p2.ct, 24);
  });
  it('ולידציה: מחיר לסניף לסניף לא קיים / שלילי, מארז לא שלם, סניף בית לא קיים, שדה לא מוכר', async () => {
    assert.equal((await call('saveProduct', MGR, { id: 'pB', name: 'x', price: 1, bp: { br9: 2 } })).reason, 'bad-bp');
    assert.equal((await call('saveProduct', MGR, { id: 'pB', name: 'x', price: 1, bp: { br1: -2 } })).reason, 'bad-price');
    assert.equal((await call('saveProduct', MGR, { id: 'pB', name: 'x', price: 1, pk: 1.5 })).reason, 'bad-qty');
    assert.equal((await call('saveProduct', MGR, { id: 'pB', name: 'x', price: 1, home: 'br9' })).reason, 'bad-br');
    assert.equal((await call('saveProduct', MGR, { id: 'pB', name: 'x', price: 1, foo: 1 })).reason, 'bad-field');
  });
  it('קטגוריות: מנהל יוצר קטגוריה + תת־קטגוריה; עובד לא; תת לקטגוריה לא קיימת נדחית; עובד קורא, לא כותב', async () => {
    const c = await call('saveCat', MGR, { name: 'מאפים' }); assert.equal(c.status, 'OK', c.text);
    const s = await call('saveCat', MGR, { name: 'לחמים', parent: c.result.id }); assert.equal(s.status, 'OK', s.text);
    assert.equal((await call('saveCat', MGR, { name: 'x', parent: s.result.id })).reason, 'bad-parent');
    assert.equal((await call('saveCat', E1, { name: 'y' })).reason, 'manager-only');
    assert.equal((await call('saveProduct', E1, { id: 'pB', name: 'לחם', price: 7.5, cat: c.result.id, sub: s.result.id })).status, 'OK');
    assert.equal((await get(`b/${A}/prod/pB`)).sub, s.result.id);
    await assertSucceeds(db(E1).doc(`b/${A}/cat/${c.result.id}`).get());
    await assertFails(db(NOORD).doc(`b/${A}/cat/${c.result.id}`).get());
    for (const u of [MGR, E1, SUPER]) await assertFails(db(u).doc(`b/${A}/cat/zz`).set({ name: 'x' }));
  });
});

describe('מחיר סיטונאי (22:07: עובד רואה רק ללקוח סיטונאי)', () => {
  it('(6) מנהל קובע wp; עובד קובע wp/עלות (00:13); עובד מקבל wp רק ללקוח wholesale; עובד לא קורא p/ws, כן קורא p/cost', async () => {
    assert.equal((await call('saveProduct', E1, { id: 'pB', name: 'לחם', price: 7.5, wp: 4 })).status, 'OK');
    assert.equal((await get(`b/${A}/prod/pB/p/ws`)).wp, 4);
    assert.equal((await call('saveProduct', MGR, { id: 'pB', name: 'לחם', price: 7.5, wp: 5, cost: 3 })).status, 'OK');
    assert.equal((await get(`b/${A}/prod/pB`)).wp, undefined); // לא על מסמך המוצר (שעובד קורא)
    assert.deepEqual((await call('getWsPrices', MGR, {})).result.wp, { pB: 5 });
    const q = rid(), W = { custId: 't000000018', reqId: q, pids: ['pB', 'pOld'] };
    assert.deepEqual((await call('getWsPrices', E1, W)).result.wp, { pB: 5 });
    assert.deepEqual((await call('getWsPrices', E1, W)).result.wp, { pB: 5 }); // אותה טיוטה, אותו לקוח – שוב מותר
    assert.equal((await call('getWsPrices', E1, { custId: 'p0502222222', reqId: rid(), pids: ['pB'] })).reason, 'not-wholesale');
    assert.equal((await call('getWsPrices', E1, { custId: 'pNONE', reqId: rid(), pids: ['pB'] })).reason, 'not-wholesale');
    assert.equal((await call('getWsPrices', E1, {})).reason, 'bad-id');
    assert.equal((await call('getWsPrices', E1, { custId: 't000000018', reqId: rid() })).reason, 'bad-pids');
    assert.equal((await call('getWsPrices', NOORD, W)).reason, 'no-perm');
    // סבב 1 ליקוי 1: הלקוח חייב להיות מקושר להזמנה הנוכחית
    assert.equal((await call('getWsPrices', E2, W)).reason, 'ws-not-linked'); // עובד אחר על אותה טיוטה
    assert.equal((await call('createOrder', E1, { reqId: q, br: 'br1', cust, items: [{ pid: 'pB', qty: 1, price: 5 }] })).reason, 'ws-not-linked'); // נשמרת בלי הלקוח
    assert.equal((await call('createOrder', E1, { reqId: q, br: 'br1', cust, custId: 'p0502222222', items: [{ pid: 'pB', qty: 1, price: 5 }] })).reason, 'ws-not-linked');
    const o = await call('createOrder', E1, { reqId: q, br: 'br1', cust, custId: 't000000018', items: [{ pid: 'pB', qty: 1, price: 5 }] });
    assert.equal(o.status, 'OK', o.text); assert.equal((await get(`b/${A}/ord/${o.result.id}`)).custId, 't000000018');
    assert.equal((await call('getWsPrices', E1, W)).reason, 'ws-not-linked'); // הטיוטה כבר נשמרה
    assert.deepEqual((await call('getWsPrices', E1, { custId: 't000000018', ordId: o.result.id, pids: ['pB'] })).result.wp, { pB: 5 });
    const o2 = await call('createOrder', E1, { reqId: rid(), br: 'br1', cust, custId: 'p0502222222', items: [{ pid: 'pB', qty: 1 }] });
    assert.equal((await call('getWsPrices', E1, { custId: 't000000018', ordId: o2.result.id, pids: ['pB'] })).reason, 'ws-not-linked'); // הזמנה של לקוח אחר
    const o3 = await call('createOrder', E2, { reqId: rid(), br: 'br2', cust, custId: 't000000018', items: [{ pid: 'pB', qty: 1 }] });
    assert.equal((await call('getWsPrices', E1, { custId: 't000000018', ordId: o3.result.id, pids: ['pB'] })).reason, 'foreign-br'); // הזמנה של סניף זר
    await assertFails(db(E1).doc(`b/${A}/prod/pB/p/ws`).get());
    await assertSucceeds(db(E1).doc(`b/${A}/prod/pB/p/cost`).get());
    assert.deepEqual((await call('getCosts', E1, {})).result.cost, { pB: 3 });
    assert.equal((await call('getCosts', NOORD, {})).reason, 'no-perm');
    await assertSucceeds(db(MGR).doc(`b/${A}/prod/pB/p/ws`).get());
  });
});

describe('ייבוא מוצרים', () => {
  const rows = (k) => Array.from({ length: k }, (_, i) => ({ name: 'מוצר ' + i, price: 1 + i, barcode: 'B' + String(i).padStart(4, '0'), qty: 2, cat: 'קטגוריה ' + (i % 3), sub: i % 2 ? 'תת' : '' }));
  it('(3) 250 שורות בשתי מנות → 250 מוצרים; ייבוא חוזר בלי "הוסף כמות" – אין כפולים והכמות לא משתנה; עם – מוסיף; מחיר טקסט נדחה', async () => {
    const R = rows(250); R[7] = Object.assign({}, R[7], { price: 'abc' });
    const a = await call('importProducts', MGR, { reqId: rid(), br: 'br1', rows: R.slice(0, 200) });
    assert.equal(a.status, 'OK', a.text); assert.equal(a.result.added, 199); assert.equal(a.result.bad.length, 1); assert.equal(a.result.bad[0].i, 7);
    const b = await call('importProducts', MGR, { reqId: rid(), br: 'br1', rows: R.slice(200) });
    assert.equal(b.result.added, 50);
    let P = (await coll(`b/${A}/prod`)).filter((p) => p.src === 'import');
    assert.equal(P.length, 249);
    assert.equal(P.find((p) => p.barcode === 'B0010').q.br1, 2);
    const cats = await coll(`b/${A}/cat`); assert.equal(cats.filter((c) => !c.parent).length, 3); assert.equal(cats.filter((c) => c.parent).length, 3);
    const c1 = await call('importProducts', MGR, { reqId: rid(), br: 'br1', rows: R.slice(0, 200) });
    assert.equal(c1.result.added, 0); assert.equal(c1.result.updated, 199);
    P = (await coll(`b/${A}/prod`)).filter((p) => p.src === 'import');
    assert.equal(P.length, 249); assert.equal(P.find((p) => p.barcode === 'B0010').q.br1, 2);
    assert.equal((await coll(`b/${A}/cat`)).length, 6);
    await call('importProducts', MGR, { reqId: rid(), br: 'br1', addQty: true, rows: R.slice(0, 200) });
    assert.equal((await get(`b/${A}/prod/${P.find((p) => p.barcode === 'B0010').id}`)).q.br1, 4);
    const L = (await coll(`b/${A}/stockLog`)).filter((x) => x.why === 'in' && x.note === 'ייבוא');
    assert.equal(L.length, 249 + 199);
  });
  it('התאמה לפי שם כשאין ברקוד; אותו reqId פעמיים = מנה אחת; עובד מייבא גם סיטונאי; יותר מ-200 נדחה; סיטונאי בייבוא נשמר ב-p/ws', async () => {
    const q = rid();
    const d = { reqId: q, br: 'br1', rows: [{ name: 'עוגה', price: 12, qty: 1, wp: 8 }, { name: 'חדש', price: 3 }] };
    const r1 = await call('importProducts', MGR, d); assert.equal(r1.result.updated, 1); assert.equal(r1.result.added, 1);
    const r2 = await call('importProducts', MGR, d); assert.equal(r2.result.dup, true);
    const o = await get(`b/${A}/prod/pOld`); assert.equal(o.price, 12); assert.equal(o.q.br1, 5);
    assert.equal((await get(`b/${A}/prod/pOld/p/ws`)).wp, 8);
    assert.equal((await coll(`b/${A}/prod`)).length, 3);
    assert.equal((await call('importProducts', E1, Object.assign({}, d, { reqId: rid() }))).status, 'OK'); // 00:12: עובד עם עמודת סיטונאי – מותר
    assert.equal((await call('importProducts', MGR, { reqId: rid(), rows: rows(201) })).reason, 'bad-rows');
  });
});

describe('ייבוא מלאי ע"י עובד (החלטה 23:19)', () => {
  it('עובד עם ord: לסניף שלו – כן; סניף זר / בלי סניף – לא; סיטונאי/עלות – נשמרים (00:12); עובד בלי ord – לא', async () => {
    const ok = await call('importProducts', E1, { reqId: rid(), br: 'br1', rows: [{ name: 'עוגה', price: 11, qty: 2 }, { name: 'חדש עובד', price: 4, qty: 3 }] });
    assert.equal(ok.status, 'OK', ok.text); assert.equal(ok.result.updated, 1); assert.equal(ok.result.added, 1);
    assert.equal((await get(`b/${A}/prod/pOld`)).price, 11);
    assert.equal((await call('importProducts', E1, { reqId: rid(), br: 'br2', rows: [{ name: 'x', price: 1 }] })).reason, 'foreign-br');
    assert.equal((await call('importProducts', E1, { reqId: rid(), rows: [{ name: 'x', price: 1 }] })).reason, 'bad-br');
    assert.equal(await get(`b/${A}/prod/pOld/p/ws`), null);
    const wc = await call('importProducts', E1, { reqId: rid(), br: 'br1', rows: [{ name: 'עוגה', price: 11, wp: 7, cost: 5 }] });
    assert.equal(wc.status, 'OK', wc.text); assert.equal(wc.result.updated, 1);
    assert.equal((await get(`b/${A}/prod/pOld/p/ws`)).wp, 7); assert.equal((await get(`b/${A}/prod/pOld/p/cost`)).cost, 5);
    assert.equal((await call('importProducts', E1, { reqId: rid(), br: 'br1', rows: [{ name: 'x', price: 1, cost: -1 }] })).result.bad.length, 1);
    assert.equal((await call('importProducts', NOORD, { reqId: rid(), br: 'br1', rows: [{ name: 'x', price: 1 }] })).reason, 'no-perm');
  });
});

describe('getWsPrices למנהל בעמודים (מעל 2000 מוצרים)', () => {
  it('2500 מוצרים עם סיטונאי – כל המחירים מגיעים דרך next, בלי חיתוך', async () => {
    await prep(async (d) => { for (let k = 0; k < 2500; k += 250) { const b = d.batch(); for (let i = k; i < k + 250; i++) { const id = 'pz' + String(i).padStart(5, '0'); b.set(d.doc(`b/${A}/prod/${id}`), { name: id, price: 1, on: true }); b.set(d.doc(`b/${A}/prod/${id}/p/ws`), { wp: i }); } await b.commit(); } });
    const W = {}; let a; let pages = 0;
    for (;;) { const r = await call('getWsPrices', MGR, a ? { after: a } : {}); assert.equal(r.status, 'OK', r.text); Object.assign(W, r.result.wp); pages++; if (!r.result.next) break; a = r.result.next; }
    assert.equal(Object.keys(W).length, 2500); assert.ok(pages >= 3); assert.equal(W.pz02499, 2499);
  });
});

describe('העברה פנימית', () => {
  it('(4) הזמנה ב-B על פריט שיש רק ב-A: A יורד, B לא משתנה, xfer אחד; סך לפני = אחרי + הכמות; reqId כפול = אחד; ביטול מחזיר ל-A עם xfer הפוך', async () => {
    const t0 = await total('pOld');
    const q = rid();
    const d = { reqId: q, br: 'br2', cust, items: [{ pid: 'pOld', qty: 2 }] };
    const rs = await Promise.all([call('createOrder', E2, d), call('createOrder', E2, d)]);
    assert.ok(rs.every((x) => x.status === 'OK'), rs.map((x) => x.text).join());
    const p = await get(`b/${A}/prod/pOld`); assert.equal(p.q.br1, 3); assert.equal(p.q.br2, 0);
    assert.equal(await total('pOld'), t0 - 2);
    let X = await coll(`b/${A}/xfer`);
    assert.equal(X.length, 1); assert.equal(X[0].from, 'br1'); assert.equal(X[0].to, 'br2'); assert.equal(X[0].qty, 2); assert.equal(X[0].why, 'order'); assert.equal(X[0].ord, rs[0].result.id); assert.equal(X[0].reqId, q);
    await assertSucceeds(db(E2).doc(`b/${A}/xfer/${X[0].id}`).get());
    await assertSucceeds(db(E1).doc(`b/${A}/xfer/${X[0].id}`).get());
    await call('cancelOrder', E2, { id: rs[0].result.id, reason: 'x' });
    assert.equal((await get(`b/${A}/prod/pOld`)).q.br1, 5); assert.equal(await total('pOld'), t0);
    X = await coll(`b/${A}/xfer`);
    assert.equal(X.length, 2); const back = X.find((x) => x.why === 'cancel'); assert.equal(back.from, 'br2'); assert.equal(back.to, 'br1'); assert.ok(typeof back.reqId === 'string' && back.reqId && back.reqId !== q);
  });
  it('(5) העברה ידנית: עובד מסניפו – כן; עובד מסניף זר – לא (שרת + חוקים); סך נשמר; reqId כפול', async () => {
    const t0 = await total('pB');
    const q = rid();
    const ok = await call('transferStock', E2, { reqId: q, pid: 'pB', from: 'br2', to: 'br1', qty: 4 });
    assert.equal(ok.status, 'OK', ok.text);
    assert.equal((await call('transferStock', E2, { reqId: q, pid: 'pB', from: 'br2', to: 'br1', qty: 4 })).result.dup, true);
    const p = await get(`b/${A}/prod/pB`); assert.equal(p.q.br2, 6); assert.equal(p.q.br1, 4); assert.equal(await total('pB'), t0);
    assert.equal((await call('transferStock', E1, { reqId: rid(), pid: 'pB', from: 'br2', to: 'br1', qty: 1 })).reason, 'foreign-br');
    assert.equal((await call('transferStock', E1, { reqId: rid(), pid: 'pB', from: 'br1', to: 'br1', qty: 1 })).reason, 'bad-br');
    assert.equal((await call('transferStock', MGR, { reqId: rid(), pid: 'pB', from: 'br1', to: 'br2', qty: 1 })).status, 'OK');
    const X = await coll(`b/${A}/xfer`); assert.equal(X.length, 2); assert.equal(X[0].why, 'manual');
    await prep((d) => d.doc(`b/${A}/xfer/zz`).set({ from: 'br2', to: 'br2', qty: 1 }));
    await assertFails(db(E1).doc(`b/${A}/xfer/zz`).get());
    await assertSucceeds(db(E2).doc(`b/${A}/xfer/zz`).get());
    for (const u of [MGR, E1, SUPER]) await assertFails(db(u).doc(`b/${A}/xfer/new`).set({ qty: 1 }));
  });
});

describe('הערות למוצר ואחוז מע"מ (10.11)', () => {
  it('הערות: נשמרות במסמך המוצר, מנוקות בריק, עד 500 תווים, מספר כרטיס נחסם; מוצר בלי הערות לא משתנה; ייבוא עם הערות', async () => {
    assert.equal((await call('saveProduct', MGR, { id: 'pB', name: 'לחם', price: 7.5, note: 'שומר במקרר' })).status, 'OK');
    assert.equal((await get(`b/${A}/prod/pB`)).note, 'שומר במקרר');
    assert.equal((await call('saveProduct', E1, { id: 'pB', name: 'לחם', price: 7.5, note: 'א'.repeat(501) })).reason, 'bad-note');
    assert.equal((await call('saveProduct', E1, { id: 'pB', name: 'לחם', price: 7.5, note: 'א'.repeat(500) })).status, 'OK');
    assert.equal((await call('saveProduct', E1, { id: 'pB', name: 'לחם', price: 7.5, note: 'כרטיס 4580 1234 5678 9012' })).reason, 'card-like');
    assert.equal((await call('saveProduct', E1, { id: 'pB', name: 'לחם', price: 7.5, note: 5 })).reason, 'bad-note');
    assert.equal((await get(`b/${A}/prod/pB`)).note.length, 500); // הנחסם לא דרס
    assert.equal((await call('saveProduct', MGR, { id: 'pB', name: 'לחם', price: 7.5 })).status, 'OK'); // בלי note – לא משתנה
    assert.equal((await get(`b/${A}/prod/pB`)).note.length, 500);
    assert.equal((await call('saveProduct', MGR, { id: 'pB', name: 'לחם', price: 7.5, note: null })).status, 'OK');
    assert.equal((await get(`b/${A}/prod/pB`)).note, undefined);
    const r = await call('importProducts', MGR, { reqId: rid(), br: 'br1', rows: [{ name: 'ייבוא-הערה', price: 3, note: 'שביר', cost: 2 }, { name: 'ייבוא-כרטיס', price: 3, note: '4580123456789012' }, { name: 'ייבוא-ארוך', price: 3, note: 'ב'.repeat(501) }] });
    assert.equal(r.status, 'OK'); assert.equal(r.result.added, 1); assert.equal(r.result.bad.length, 2);
  });
  it('אחוז מע"מ: מנהל בלבד, 0–100, נשמר ב-ordcfg/main בלי לגעת בשאר; לא תקין נדחה; src נשאר', async () => {
    assert.equal((await call('setOrderCfg', E1, { vat: 17 })).reason, 'manager-only');
    assert.equal((await call('setOrderCfg', MGR, { vat: 101 })).reason, 'bad-vat');
    assert.equal((await call('setOrderCfg', MGR, { vat: -1 })).reason, 'bad-vat');
    assert.equal((await call('setOrderCfg', MGR, { vat: '18' })).reason, 'bad-vat');
    assert.equal((await call('setOrderCfg', MGR, { vat: 17.123 })).reason, 'bad-vat');
    assert.equal((await call('setOrderCfg', MGR, { src: { br1: 'br2' } })).status, 'OK');
    assert.equal((await call('setOrderCfg', MGR, { vat: 18.07 })).status, 'OK');
    const c = await get(`b/${A}/ordcfg/main`);
    assert.equal(c.vat, 18.07); assert.deepEqual(c.src, { br1: 'br2' });
    assert.equal((await call('setOrderCfg', MGR, {})).reason, 'bad-src');
  });
});
