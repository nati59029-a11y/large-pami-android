'use strict';
// לקוחות (fb/ord-cust): functions/customers.js + חוקי cust/custcfg. רץ מול האמולטור, חלק מ-test:multibiz.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-o';
const B2 = 'biz-p';
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
    b.set(d.doc('b/' + B2), { name: 'ב', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: features || ALL });
    b.set(d.doc(`b/${B2}/admins/m2`), { email: 'm2@x.invalid' });
    b.set(d.doc('users/m2'), { bizId: B2, role: 'admin', active: true, bizStatus: 'active', email: 'm2@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/custcfg/main`), { xKeys: [{ k: 'xcity', label: 'עיר' }] });
    await b.commit();
  });
}

const TZ = '123456782', TZ2 = '000000018';
const c1 = { name: 'דנה', phone: '050-1234567', tz: TZ };
before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => seed());

describe('לקוחות – saveCust', () => {
  it('לקוח חדש לפי ת"ז → cust/t{tz}, רגיל (בלי wholesale), src manual', async () => {
    const r = await call('saveCust', E1, { cust: Object.assign({ mail: 'D@x.co', addr: 'הרצל 1', x: { xcity: 'אשדוד' } }, c1) });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.id, 't' + TZ); assert.ok(r.result.created);
    const d = await get(`b/${A}/cust/t${TZ}`);
    assert.equal(d.phone, '0501234567'); assert.equal(d.mail, 'd@x.co'); assert.equal(d.x.xcity, 'אשדוד'); assert.equal(d.wholesale, undefined); assert.equal(d.src, 'manual');
  });
  it('fill:true לא דורס, רק ממלא ריקים; בלי fill – דורס', async () => {
    await call('saveCust', E1, { cust: c1 });
    await call('saveCust', E1, { fill: true, cust: { tz: TZ, name: 'אחר', addr: 'בן גוריון 2' } });
    let d = await get(`b/${A}/cust/t${TZ}`); assert.equal(d.name, 'דנה'); assert.equal(d.addr, 'בן גוריון 2');
    await call('saveCust', E1, { cust: { tz: TZ, name: 'דנה לוי' } });
    d = await get(`b/${A}/cust/t${TZ}`); assert.equal(d.name, 'דנה לוי');
  });
  it('בלי ת"ז → p{phone}; כשנוספת ת"ז – מועבר ל-t{tz}, הישן מסומן mv ולא נמחק', async () => {
    const r = await call('saveCust', E1, { cust: { name: 'יוסי', phone: '0521112222' } });
    assert.equal(r.result.id, 'p0521112222');
    const r2 = await call('saveCust', E1, { fill: true, cust: { phone: '0521112222', tz: TZ2 } });
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.id, 't' + TZ2);
    assert.equal((await get(`b/${A}/cust/t${TZ2}`)).name, 'יוסי');
    assert.equal((await get(`b/${A}/cust/p0521112222`)).mv, 't' + TZ2);
  });
  it('ולידציה: ת"ז שגויה, last4 של 5 ספרות, שדה חופשי עם 8 ספרות, שדה חופשי לא מוגדר, שדה זר (card)', async () => {
    const bad = async (cust, reason) => { const r = await call('saveCust', E1, { cust }); assert.equal(r.status, 'INVALID_ARGUMENT', r.text); assert.equal(r.reason, reason); };
    await bad(Object.assign({}, c1, { tz: '123456789' }), 'bad-tz');
    await bad(Object.assign({}, c1, { last4: '12345' }), 'bad-last4');
    await bad(Object.assign({}, c1, { x: { xcity: '45801234' } }), 'card-like');
    await bad(Object.assign({}, c1, { x: { xzzz: 'a' } }), 'bad-x');
    await bad(Object.assign({}, c1, { card: '4580123456789012' }), 'bad-field');
  });
  it('last4 עם מספר כרטיס מלא → נחתך ל-4 ספרות; המספר המלא לא נשמר בשום מקום', async () => {
    const r = await call('saveCust', E1, { cust: Object.assign({}, c1, { last4: '4580-1234-5678-9012' }) });
    assert.equal(r.status, 'OK', r.text);
    const d = await get(`b/${A}/cust/t${TZ}`); assert.equal(d.last4, '9012');
    assert.ok(!JSON.stringify(d).includes('45801234')); assert.ok(!r.text.includes('45801234'));
  });
  it('סיטונאי: עובד לא יכול (גם false); מנהל מסמן ומבטל', async () => {
    let r = await call('saveCust', E1, { cust: c1, wholesale: true }); assert.equal(r.reason, 'manager-only');
    r = await call('saveCust', E1, { cust: c1, wholesale: false }); assert.equal(r.reason, 'manager-only');
    r = await call('saveCust', MGR, { cust: c1, wholesale: true }); assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/cust/t${TZ}`)).wholesale, true);
    await call('saveCust', E1, { cust: { tz: TZ, addr: 'x 1' } }); // עדכון של עובד לא מוריד סיטונאי
    assert.equal((await get(`b/${A}/cust/t${TZ}`)).wholesale, true);
    r = await call('saveCust', MGR, { cust: { tz: TZ }, wholesale: false });
    assert.equal((await get(`b/${A}/cust/t${TZ}`)).wholesale, false);
  });
  it('עובד בלי ord / תוספת כבויה – נחסם', async () => {
    assert.equal((await call('saveCust', NOORD, { cust: c1 })).reason, 'no-perm');
    await seed(Object.assign({}, ALL, { orders: false }));
    assert.equal((await call('saveCust', MGR, { cust: c1 })).status, 'FAILED_PRECONDITION');
  });
});

describe('לקוחות – importCusts', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ name: 'לקוח ' + i, phone: '05' + String(20000000 + i).padStart(8, '0') }));
  it('500 לקוחות ב-3 מנות; ייבוא חוזר – אין כפולים, לא דורס', async () => {
    const all = rows(500);
    for (let i = 0; i < 500; i += 200) { const r = await call('importCusts', MGR, { reqId: rid(), rows: all.slice(i, i + 200) }); assert.equal(r.status, 'OK', r.text.slice(0, 300)); assert.equal(r.result.bad.length, 0); }
    assert.equal((await coll(`b/${A}/cust`)).length, 500);
    const again = all.slice(0, 200).map((x) => Object.assign({}, x, { name: 'שונה' }));
    const r = await call('importCusts', MGR, { reqId: rid(), rows: again });
    assert.equal(r.result.created, 0);
    assert.equal((await coll(`b/${A}/cust`)).length, 500);
    assert.equal((await get(`b/${A}/cust/p0520000000`)).name, 'לקוח 0');
  });
  it('עמודת כרטיס מלא (ב-last4 או בשדה חופשי) → נשמרות 4 אחרונות בלבד; last4 של 5 ספרות → שורה שגויה; wholesale מתעלמים', async () => {
    const r = await call('importCusts', MGR, { reqId: rid(), rows: [
      { name: 'א', phone: '0501111111', last4: '4580123456789012', wholesale: true },
      { name: 'ב', phone: '0502222222', x: { xcity: '5326 1000 2000 3456' } },
      { name: 'ג', phone: '0503333333', last4: '12345' },
      { name: 'ד', phone: 'abc' }] });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.created, 2); assert.deepEqual(r.result.bad.map((x) => [x.i, x.reason]), [[2, 'bad-last4'], [3, 'bad-phone']]);
    const a = await get(`b/${A}/cust/p0501111111`), b = await get(`b/${A}/cust/p0502222222`);
    assert.equal(a.last4, '9012'); assert.equal(a.wholesale, undefined); assert.equal(b.last4, '3456'); assert.deepEqual(b.x, {});
    assert.ok(!r.text.includes('4580123456789012') && !JSON.stringify(a).includes('45801234') && !JSON.stringify(b).includes('53261000'));
  });
  it('אותו reqId = מנה אחת; עובד לא מייבא', async () => {
    const q = rid();
    await call('importCusts', MGR, { reqId: q, rows: rows(3) });
    assert.ok((await call('importCusts', MGR, { reqId: q, rows: rows(5) })).result.dup);
    assert.equal((await coll(`b/${A}/cust`)).length, 3);
    assert.equal((await call('importCusts', E1, { reqId: rid(), rows: rows(1) })).reason, 'manager-only');
  });
});

describe('לקוחות – setCustCfg וחוקים', () => {
  it('setCustCfg: מנהל בלבד, יוצר מזהה, דוחה 21 שדות', async () => {
    assert.equal((await call('setCustCfg', E1, { xKeys: [{ label: 'א' }] })).reason, 'manager-only');
    const r = await call('setCustCfg', MGR, { xKeys: [{ k: 'xcity', label: 'עיר' }, { label: 'תאריך ניוד' }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.xKeys.length, 2); assert.match(r.result.xKeys[1].k, /^x[0-9a-z]+$/);
    assert.equal((await call('setCustCfg', MGR, { xKeys: Array.from({ length: 21 }, (_, i) => ({ label: 'ש' + i })) })).reason, 'bad-x');
  });
  it('חוקים: עובד עם ord ומנהל קוראים; בלי ord – לא; אף אחד לא כותב (גם wholesale); עסק אחר – לא', async () => {
    await call('saveCust', E1, { cust: c1 });
    const p = `b/${A}/cust/t${TZ}`;
    await assertSucceeds(db(E1).doc(p).get());
    await assertSucceeds(db(MGR).doc(p).get());
    await assertSucceeds(db(E1).doc(`b/${A}/custcfg/main`).get());
    await assertFails(db(NOORD).doc(p).get());
    await assertFails(db('m2').doc(p).get());
    await assertFails(db(MGR).doc(p).update({ wholesale: true }));
    await assertFails(db(E1).doc(p).update({ wholesale: true }));
    await assertFails(db(MGR).doc(`b/${A}/cust/tnew`).set({ name: 'x' }));
    await assertFails(db(MGR).doc(`b/${A}/custcfg/main`).set({ xKeys: [] }));
  });
  it('ת"ז של לקוח בעסק אחר – לא נגיש מהעסק השני (cust בתוך b/{bizId})', async () => {
    await call('saveCust', MGR, { cust: c1 });
    const r = await call('saveCust', 'm2', { cust: { tz: TZ } }); // אין לקוח בעסק ב → חובה שם וטלפון
    assert.equal(r.reason, 'bad-name');
    assert.equal(await get(`b/${B2}/cust/t${TZ}`), null);
  });
});
