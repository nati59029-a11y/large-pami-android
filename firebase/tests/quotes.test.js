'use strict';
// הצעת מחיר ללקוח (24.11.2026, שלב 2): functions/quotes.js (qtSave, qtSet) + חוקי qt/{id} ו-qt/{id}/log. רץ מול האמולטור, חלק מ-test:multibiz:1.
// סבב ב (qtConvert, qtPdf, qtSend) – describe נוספים בסוף הקובץ.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-q';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'q_mgr', E1 = 'q_e1', E1B = 'q_e1b', E2 = 'q_e2', NOORD = 'q_no', SUPER = 'q_super';
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
const rid = () => 'qreq' + Date.now().toString(36) + (n++) + 'xx';
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
    b.set(d.doc('b/' + A), { name: 'ק', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: ALL,
      org: { v: 1, branches: [{ id: 'br1', name: 'סניף 1', on: true, sig: [] }, { id: 'br2', name: 'סניף 2', on: true, sig: [] }], banks: [], cards: [] } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true, br: ['br1'] });
    b.set(d.doc(`b/${A}/staff/${E1B}`), { name: E1B, role: 'employee', active: true, br: ['br1'] });
    b.set(d.doc(`b/${A}/staff/${E2}`), { name: E2, role: 'employee', active: true, br: ['br2'] });
    b.set(d.doc(`b/${A}/staff/${NOORD}`), { name: NOORD, role: 'employee', active: true, perms: NONE });
    for (const [u, role] of [[MGR, 'admin'], [E1, 'worker'], [E1B, 'worker'], [E2, 'worker'], [NOORD, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/prod/pA`), { name: 'עוגה', price: 10, barcode: '', on: true, q: { br1: 3, br2: 0 } });
    b.set(d.doc(`b/${A}/prod/pA/p/cost`), { cost: 4 });
    b.set(d.doc(`b/${A}/prod/pB`), { name: 'לחם', price: 7.5, barcode: '729', on: true, q: { br1: 0, br2: 10 } });
    await b.commit();
  });
}
const cust = { name: 'דנה', phone: '050-1234567' };
const body = (x) => Object.assign({ reqId: rid(), br: 'br1', cust, items: [{ pid: 'pA', qty: 2, price: 9.9 }, { pid: 'pB', qty: 5, price: 7.5, from: 'br2' }, { n: 'משלוח', qty: 1, price: 15 }] }, x || {});
const ilDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const plus = (day, k) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };
// מצב המלאי וכל מה שהזמנה הייתה יוצרת – להשוואה לפני/אחרי
async function stockState(pre) {
  const prods = (await coll(pre + 'prod')).map((p) => ({ id: p.id, q: p.q, upd: p.upd || null }));
  return { prods, ord: (await coll(pre + 'ord')).length, xfer: (await coll(pre + 'xfer')).length, stockLog: (await coll(pre + 'stockLog')).length, cprice: (await coll(pre + 'cprice')).length, seq: await get(pre + 'ordcfg/seq') };
}

before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => seed());

describe('qtSave – שמירה, מספור, תוקף, בלי מלאי', () => {
  it('עובד בסניף 1: הצעה נשמרת עם מספר 1, סכומים מהשרת, תוקף 14 יום בשעון ישראל; מלאי/הזמנות/העברות לא השתנו', async () => {
    const before0 = await stockState(`b/${A}/`);
    const t0 = Date.now();
    const r = await call('qtSave', E1, body({ total: 1 }));
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.no, 1); assert.equal(r.result.dup, false);
    assert.equal(r.result.total, 2 * 9.9 + 5 * 7.5 + 15);
    assert.ok(r.result.id.startsWith('q'));
    const d = await get(`b/${A}/qt/${r.result.id}`);
    assert.equal(d.st, 'open'); assert.equal(d.br, 'br1'); assert.equal(d.no, 1); assert.equal(d.by, E1);
    assert.equal(d.total, 72.3); assert.equal(d.gross, r.result.gross); assert.equal(d.vm, 'inc');
    assert.ok([plus(ilDay(t0), 14), plus(ilDay(Date.now()), 14)].includes(d.vu), d.vu);
    assert.equal(r.result.vu, d.vu);
    assert.equal(d.cust.phone, '0501234567');
    assert.equal(d.items.length, 3); assert.equal(d.items[1].from, undefined, 'סניף מקור לא נשמר בהצעה');
    assert.equal(d.items[0].c, 4, 'עלות ביום ההצעה (כמו בהזמנה)');
    assert.match(d.cvReq, /^[A-Za-z0-9_-]{8,40}$/);
    assert.equal(d.apr, undefined);
    assert.equal((await get(`b/${A}/ordcfg/seq_qt`)).n, 1);
    const log = await coll(`b/${A}/qt/${r.result.id}/log`);
    assert.equal(log.length, 1); assert.equal(log[0].act, 'create'); assert.equal(log[0].by, E1);
    assert.deepEqual(await stockState(`b/${A}/`), before0, 'מלאי, ord, xfer, stockLog, cprice ומספור ההזמנות לא השתנו');
  });
  it('שתי שמירות במקביל → מספרים 1 ו-2 (בלי כפילות); reqId חוזר → אותה הצעה, בלי מסמך נוסף ובלי צריכת מספר', async () => {
    const rs = await Promise.all([1, 2].map(() => call('qtSave', E1, body())));
    for (const r of rs) assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(rs.map((r) => r.result.no).sort(), [1, 2]);
    const b0 = body();
    const a = await call('qtSave', E1, b0);
    const b = await call('qtSave', E1, b0);
    assert.equal(a.result.no, 3); assert.equal(b.result.no, 3); assert.equal(b.result.id, a.result.id); assert.equal(b.result.dup, true);
    assert.equal(b.result.vu, a.result.vu); assert.equal(b.result.gross, a.result.gross);
    // reqId חוזר במקביל – עדיין הצעה אחת
    const b1 = body();
    const par = await Promise.all([1, 2, 3].map(() => call('qtSave', E1, b1)));
    assert.equal(new Set(par.map((r) => r.result.id)).size, 1); assert.equal(new Set(par.map((r) => r.result.no)).size, 1);
    assert.equal((await coll(`b/${A}/qt`)).length, 4);
    assert.equal((await get(`b/${A}/ordcfg/seq_qt`)).n, 4);
    // reqId של הצעה מסניף 1 – עובד סניף 2 לא מקבל את פרטיה
    assert.equal((await call('qtSave', E2, Object.assign(body(), { reqId: b0.reqId, br: 'br2' }))).reason, 'foreign-br');
  });
  it('תוקף: days 1–365 (מספר שלם), ברירת מחדל 14; מחוץ לטווח → bad-days', async () => {
    const r = await call('qtSave', E1, body({ days: 30 }));
    assert.equal(r.status, 'OK', r.text);
    assert.ok([plus(ilDay(Date.now()), 30), plus(ilDay(Date.now() - 60000), 30)].includes(r.result.vu));
    assert.equal((await call('qtSave', E1, body({ days: 1 }))).status, 'OK');
    assert.equal((await call('qtSave', E1, body({ days: 365 }))).status, 'OK');
    for (const days of [0, 366, -1, 1.5, '7', true]) assert.equal((await call('qtSave', E1, body({ days }))).reason, 'bad-days', String(days));
  });
  it('רשימת שדות מותרים: st, apr, no, floorOk, cvReq, vu, gross ועוד נדחים; ניוד (cell) נדחה; שדה לא מוכר בפריט נדחה', async () => {
    for (const k of ['st', 'apr', 'no', 'floorOk', 'cvReq', 'vu', 'gross', 'net', 'vat', 'by', 'src', 'ord'])
      assert.equal((await call('qtSave', MGR, body({ [k]: k === 'st' ? 'conv' : 1 }))).reason, 'bad-field', k);
    assert.equal((await call('qtSave', E1, body({ cell: { n: 1 } }))).reason, 'qt-no-cell');
    assert.equal((await call('qtSave', E1, body({ items: [{ pid: 'pA', qty: 1, price: 10, c: 1 }] }))).reason, 'bad-items');
    assert.equal((await call('qtSave', E1, body({ items: [{ pid: 'pA', qty: 1, price: 10, gross: 1 }] }))).reason, 'bad-field');
    assert.equal((await call('qtSave', E1, body({ reqId: 'x' }))).reason, 'bad-req');
    assert.equal((await coll(`b/${A}/qt`)).length, 0);
  });
  it('מינימום מחיר: עובד מתחת לעלות → price-floor (לא נשמר, המספר לא נצרך); מנהל עוקף; הנחה כללית לעובד → manager-only', async () => {
    await prep((d) => d.doc(`b/${A}/ordcfg/price`).set({ pct: 10 }));
    const r = await call('qtSave', E1, body({ items: [{ pid: 'pA', qty: 1, price: 3 }] }));
    assert.equal(r.reason, 'price-floor', r.text);
    assert.equal((await coll(`b/${A}/qt`)).length, 0);
    assert.equal(await get(`b/${A}/ordcfg/seq_qt`), null);
    const m = await call('qtSave', MGR, body({ items: [{ pid: 'pA', qty: 1, price: 3 }] }));
    assert.equal(m.status, 'OK', m.text); assert.equal(m.result.no, 1);
    assert.equal((await call('qtSave', E1, body({ disc: 5 }))).reason, 'manager-only');
    const md = await call('qtSave', MGR, body({ disc: 5, items: [{ pid: 'pA', qty: 1, price: 10 }] }));
    assert.equal(md.status, 'OK', md.text);
    const d = await get(`b/${A}/qt/${md.result.id}`);
    assert.equal(d.disc, 5); assert.equal(d.gross, 9.5);
    // שורת מוצר בלי מחיר – מחיר ברירת המחדל של הסניף (כמו בהזמנה)
    const def = await call('qtSave', E1, body({ items: [{ pid: 'pA', qty: 1 }] }));
    assert.equal(def.status, 'OK', def.text); assert.equal((await get(`b/${A}/qt/${def.result.id}`)).items[0].price, 10);
  });
  it('הרשאות: עובד מסניף אחר → foreign-br; בלי הרשאת הזמנות → נדחה; בלי כניסה → UNAUTHENTICATED; לקוח חסום לעובד → cust-blocked', async () => {
    assert.equal((await call('qtSave', E2, body())).reason, 'foreign-br');
    const no = await call('qtSave', NOORD, body());
    assert.equal(no.status, 'PERMISSION_DENIED'); assert.equal(no.reason, 'no-perm');
    assert.equal((await call('qtSave', null, body())).status, 'UNAUTHENTICATED');
    assert.equal((await call('qtSave', E1, body({ br: 'nope' }))).reason, 'bad-br');
    await prep((d) => d.doc(`b/${A}/cust/c1`).set({ name: 'חסום', phone: '0501234567', blk: true }));
    assert.equal((await call('qtSave', E1, body({ custId: 'c1' }))).reason, 'cust-blocked');
    assert.equal((await call('qtSave', MGR, body({ custId: 'c1' }))).status, 'OK');
    await prep((d) => d.doc(`b/${A}/prod/pA`).update({ on: false }));
    assert.equal((await call('qtSave', E1, body())).reason, 'prod-off');
    assert.equal((await coll(`b/${A}/qt`)).length, 1);
  });
  it('לקוח עסקי: מחירים לפני מע"מ (vm ex), ומוצר "רק קרטונים" – כמות שאינה כפולה של קרטון נדחית (cto-qty)', async () => {
    await prep(async (d) => { await d.doc(`b/${A}/cust/w1`).set({ name: 'עסק', phone: '0501234567', wholesale: true }); await d.doc(`b/${A}/prod/pA`).update({ cto: true, ct: 6 }); });
    assert.equal((await call('qtSave', E1, body({ custId: 'w1', items: [{ pid: 'pA', qty: 4, price: 9 }] }))).reason, 'cto-qty');
    const r = await call('qtSave', E1, body({ custId: 'w1', items: [{ pid: 'pA', qty: 12, price: 9 }] }));
    assert.equal(r.status, 'OK', r.text);
    const d = await get(`b/${A}/qt/${r.result.id}`);
    assert.equal(d.vm, 'ex'); assert.equal(d.items[0].ct, 6); assert.equal(d.custId, 'w1'); assert.equal(d.net, 108);
  });
});

describe('qtSet – ביטול, בקשת אישור, אישור מנהל', () => {
  async function mk(u) { const r = await call('qtSave', u || E1, body()); assert.equal(r.status, 'OK', r.text); return r.result.id; }
  it('req: עובד מבקש אישור (פעמיים – בלי שינוי); ok: רק מנהל; מנהל לא "מבקש"; עובד מסניף אחר → foreign-br', async () => {
    const id = await mk();
    assert.equal((await call('qtSet', E1, { id, act: 'ok' })).reason, 'manager-only');
    assert.equal((await call('qtSet', E2, { id, act: 'req' })).reason, 'foreign-br');
    assert.equal((await call('qtSet', MGR, { id, act: 'req' })).reason, 'mgr-self');
    const r = await call('qtSet', E1, { id, act: 'req' });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.apr.st, 'req'); assert.equal(r.result.apr.by, E1);
    const r2 = await call('qtSet', E1B, { id, act: 'req' });
    assert.equal(r2.result.apr.by, E1, 'בקשה כפולה לא דורסת');
    const ok = await call('qtSet', MGR, { id, act: 'ok' });
    assert.equal(ok.status, 'OK', ok.text); assert.equal(ok.result.apr.st, 'ok'); assert.equal(ok.result.apr.by, MGR);
    assert.equal((await call('qtSet', E1, { id, act: 'req' })).result.apr.st, 'ok', 'אחרי אישור – בקשה לא מבטלת את האישור');
    const d = await get(`b/${A}/qt/${id}`);
    assert.equal(d.apr.st, 'ok'); assert.equal(d.st, 'open');
    assert.deepEqual((await coll(`b/${A}/qt/${id}/log`)).map((x) => x.act).sort(), ['create', 'ok', 'req']);
  });
  it('cancel: רק יוצר ההצעה או מנהל, רק הצעה פתוחה; אחרי ביטול – אין req/ok/ביטול נוסף', async () => {
    const id = await mk();
    assert.equal((await call('qtSet', E1B, { id, act: 'cancel' })).reason, 'not-owner');
    assert.equal((await call('qtSet', E2, { id, act: 'cancel' })).reason, 'foreign-br');
    const c = await call('qtSet', E1, { id, act: 'cancel' });
    assert.equal(c.status, 'OK', c.text); assert.equal(c.result.st, 'cancel');
    const d = await get(`b/${A}/qt/${id}`); assert.equal(d.st, 'cancel'); assert.equal(d.cancel.by, E1);
    for (const [u, act] of [[E1, 'cancel'], [MGR, 'cancel'], [E1, 'req'], [MGR, 'ok']]) assert.equal((await call('qtSet', u, { id, act })).reason, 'qt-closed', act);
    const id2 = await mk();
    assert.equal((await call('qtSet', MGR, { id: id2, act: 'cancel' })).status, 'OK');
    // הצעה שהומרה (st:'conv') – לא מבוטלת
    const id3 = await mk();
    await prep((x) => x.doc(`b/${A}/qt/${id3}`).update({ st: 'conv', ord: { id: 'oX', no: 1 } }));
    assert.equal((await call('qtSet', MGR, { id: id3, act: 'cancel' })).reason, 'qt-closed');
  });
  it('קלט: פעולה לא מוכרת / שדה נוסף / הצעה שלא קיימת / בלי הרשאת הזמנות', async () => {
    const id = await mk();
    assert.equal((await call('qtSet', MGR, { id, act: 'conv' })).reason, 'bad-act');
    assert.equal((await call('qtSet', MGR, { id, act: 'ok', st: 'conv' })).reason, 'bad-field');
    assert.equal((await call('qtSet', MGR, { id: 'qnone123', act: 'ok' })).reason, 'no-qt');
    assert.equal((await call('qtSet', NOORD, { id, act: 'req' })).reason, 'no-perm');
  });
});

describe('חוקים: qt/{id} ו-log – קריאה לפי סניף, כתיבה ישירה נדחית', () => {
  it('עסק b: עובד רואה רק את סניפו (מסמך, שאילתה לפי סניף, יומן); מנהל – הכול; בלי ord / עסק אחר – לא; כתיבה ישירה נדחית לכולם', async () => {
    const r1 = await call('qtSave', E1, body());
    const r2 = await call('qtSave', E2, body({ br: 'br2', items: [{ pid: 'pB', qty: 1, price: 7.5 }] }));
    assert.equal(r1.status, 'OK', r1.text); assert.equal(r2.status, 'OK', r2.text);
    const q1 = `b/${A}/qt/${r1.result.id}`, q2 = `b/${A}/qt/${r2.result.id}`;
    await assertSucceeds(db(E1).doc(q1).get());
    await assertFails(db(E1).doc(q2).get());
    await assertSucceeds(db(E2).doc(q2).get());
    await assertFails(db(E2).doc(q1).get());
    await assertSucceeds(db(E1).collection(`b/${A}/qt`).where('br', '==', 'br1').get());
    await assertFails(db(E1).collection(`b/${A}/qt`).get());
    await assertSucceeds(db(MGR).collection(`b/${A}/qt`).get());
    await assertSucceeds(db(E1).collection(`${q1}/log`).get());
    await assertFails(db(E2).collection(`${q1}/log`).get());
    await assertFails(db(NOORD).doc(q1).get());
    await assertFails(db('q_out').doc(q1).get());
    for (const u of [MGR, E1]) {
      await assertFails(db(u).doc(`b/${A}/qt/qnew12345`).set({ br: 'br1', st: 'open', no: 99 }));
      await assertFails(db(u).doc(q1).update({ st: 'conv' }));
      await assertFails(db(u).doc(q1).update({ apr: { st: 'ok' } }));
      await assertFails(db(u).doc(q1).delete());
      await assertFails(db(u).collection(`${q1}/log`).add({ act: 'ok' }));
      await assertFails(db(u).doc(`b/${A}/ordcfg/seq_qt`).set({ n: 0 }));
    }
  });
});

describe('לארג\' פעמי במצב legacy (שורש)', () => {
  const LM = 'ql_mgr', LE = 'ql_emp';
  async function seedL() {
    await env.clearFirestore();
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('admins/' + LM), { email: 'lm@x.invalid' });
      b.set(d.doc('staff/' + LM), { name: LM, role: 'manager', active: true });
      b.set(d.doc('staff/' + LE), { name: LE, role: 'employee', active: true });
      b.set(d.doc('prod/pA'), { name: 'עוגה', price: 10, on: true, q: { _: 5 } });
      b.set(d.doc('prod/pA/p/cost'), { cost: 3 });
      await b.commit();
    });
  }
  it('עובד שומר הצעה בשורש (בלי סניפים), מלאי לא משתנה, מספור רץ; חוקי השורש: קריאה כן, כתיבה לא; ביטול ואישור', async () => {
    await seedL();
    const before0 = await stockState('');
    const r = await call('qtSave', LE, { reqId: rid(), cust, items: [{ pid: 'pA', qty: 2, price: 10 }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.no, 1);
    const d = await get('qt/' + r.result.id);
    assert.equal(d.br, '_'); assert.equal(d.total, 20); assert.equal(d.st, 'open');
    assert.equal(await get(`b/largpeami/qt/${r.result.id}`), null);
    assert.equal((await get('ordcfg/seq_qt')).n, 1);
    assert.deepEqual(await stockState(''), before0);
    await assertSucceeds(db(LE).doc('qt/' + r.result.id).get());
    await assertSucceeds(db(LE).collection('qt').get());
    await assertSucceeds(db(LE).collection(`qt/${r.result.id}/log`).get());
    await assertFails(db('ql_out').doc('qt/' + r.result.id).get());
    for (const u of [LM, LE]) {
      await assertFails(db(u).doc('qt/' + r.result.id).update({ st: 'conv' }));
      await assertFails(db(u).doc('qt/qx1234567').set({ br: '_' }));
      await assertFails(db(u).collection(`qt/${r.result.id}/log`).add({ act: 'ok' }));
    }
    assert.equal((await call('qtSet', LE, { id: r.result.id, act: 'ok' })).reason, 'manager-only');
    assert.equal((await call('qtSet', LE, { id: r.result.id, act: 'req' })).status, 'OK');
    assert.equal((await call('qtSet', LM, { id: r.result.id, act: 'ok' })).result.apr.st, 'ok');
    assert.equal((await call('qtSet', LE, { id: r.result.id, act: 'cancel' })).result.st, 'cancel');
    const r2 = await call('qtSave', LE, { reqId: rid(), cust, items: [{ n: 'x', qty: 1, price: 1 }] });
    assert.equal(r2.result.no, 2);
  });
});

describe('_core – תאריכים (שעון ישראל) ופג תוקף', () => {
  const Q = () => require('../functions/quotes.js')._core;
  it('ilDay לפי שעון ישראל (לא UTC); addDays חוצה חודש/שנה/שנה מעוברת; expired רק להצעה פתוחה שהיום האחרון שלה עבר', () => {
    const C = Q();
    assert.equal(C.ilDay(Date.UTC(2026, 10, 24, 22, 30)), '2026-11-25', '00:30 בישראל (חורף, UTC+2) = כבר מחר');
    assert.equal(C.ilDay(Date.UTC(2026, 6, 1, 21, 30)), '2026-07-02', 'קיץ, UTC+3');
    assert.equal(C.ilDay(Date.UTC(2026, 10, 24, 21, 30)), '2026-11-24');
    assert.equal(C.addDays('2026-12-25', 14), '2027-01-08');
    assert.equal(C.addDays('2028-02-20', 14), '2028-03-05');
    assert.equal(C.vuOf(Date.UTC(2026, 10, 24, 22, 30), 14), '2026-12-09');
    const now = Date.UTC(2026, 10, 24, 10);
    assert.equal(C.expired({ st: 'open', vu: '2026-11-24' }, now), false, 'היום האחרון עדיין בתוקף');
    assert.equal(C.expired({ st: 'open', vu: '2026-11-23' }, now), true);
    assert.equal(C.expired({ st: 'conv', vu: '2026-01-01' }, now), false);
    assert.equal(C.expired({ st: 'cancel', vu: '2026-01-01' }, now), false);
    assert.equal(C.daysOf(undefined), 14);
    assert.throws(() => C.daysOf(0)); assert.throws(() => C.daysOf(366));
    for (const k of ['loadQt', 'access', 'expired', 'qtRef', 'logRef']) assert.equal(typeof C[k], 'function', k);
  });
});
