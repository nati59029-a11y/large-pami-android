'use strict';
// קופה גל 2 – ש2 (17.11.2026): שרת המכירה מול האמולטור – posSale / posReturn / posPark / posDebtPay / posCouponUse / posGift / posPromo / posDoc.
// קריטריוני קבלה (אפיון ב פרק 5): 1 (בשרת), 4, 5, 6, 7 (reqId, Luhn, שדות), 8, 9, 10 (prn), 11, 12, 13, 14 (בשרת), 15 · ה 5.16 · ד H7.
// הפונקציות רצות בתוך תהליך הבדיקה (כמו pos.test.js).
process.env.FUNCTIONS_EMULATOR = 'true';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-pos';
const SUPER = 'pos_super', MGR = 'pos_mgr', CASH = 'pos_cash', LEAD = 'pos_lead';
// 18.11.2026 (הכרעת בעל העסק): מנהל בקופה רק עם המתג שמנהל־על הדליק (admins/{uid}.perms). MGR – מנהל עם pos + posMgr; MGR0 – מנהל בלי קופה
const MGR0 = 'pos_mgr0';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };
const W = (o) => Object.assign({}, NONE, o);
const INST1 = 'inst_aaaaaaaaaaaaaaaa', INST2 = 'inst_bbbbbbbbbbbbbbbb';
const DAY = 86400000;

let env, S, DOC;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const fsu = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
const P = (p) => `b/${A}/${p}`;
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(P(p)).get(); v = s.exists ? s.data() : null; }); return v; }
async function all(coll, f) { let v = []; await prep(async (d) => { let q = d.collection(P(coll)); if (f) q = q.where(f[0], '==', f[1]); v = (await q.get()).docs.map((x) => Object.assign({ _id: x.id }, x.data())); }); return v; }
async function set(p, o, merge) { await prep(async (d) => d.doc(P(p)).set(o, merge ? { merge: true } : {})); }
const req = (uid, data) => ({ auth: { uid, token: { email: uid + '@x.invalid' } }, data: data || {} });
async function call(fn, uid, data) {
  const C = fn === 'posDoc' ? DOC : S;
  try { return { ok: true, r: await C.call[fn]()(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message, d: e.details }; }
}
const R = (r) => (r.ok ? 'ok' : r.reason);
let rq = 0;
const reqId = () => 'rq' + String(++rq).padStart(8, '0') + 's';
const L = (o) => Object.assign({ pid: 'p1', n: 'מטען', qty: 1, unit: 4990 }, o || {});
const sale = (o) => Object.assign({ reqId: reqId(), dev: 'K1', inst: INST1, soldAt: Date.now() - 1000, lines: [L()], pays: [{ m: 'cash', amt: 4990 }] }, o || {});
const cash = (amt, chg) => ({ pays: [{ m: 'cash', amt: amt + (chg || 0) }], chg: chg || 0 });
async function sell(uid, o) { const r = await call('posSale', uid, sale(o)); if (!r.ok) throw new Error('sale failed: ' + r.reason + ' ' + r.msg); return r.r; }

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { orders: true, pos: true } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid', perms: { pos: true, posMgr: true } });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'מנהל', role: 'manager', active: true });
    b.set(d.doc(`b/${A}/admins/${MGR0}`), { email: 'm0@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${CASH}`), { name: 'קופאית', role: 'employee', active: true, perms: W({ pos: true }) });
    b.set(d.doc(`b/${A}/staff/${LEAD}`), { name: 'אחראי', role: 'employee', active: true, perms: W({ posMgr: true }) });
    for (const [u, role] of [[MGR, 'admin'], [MGR0, 'admin'], [CASH, 'worker'], [LEAD, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(P('poscfg/main')), { type: 'general', v: {} });
    for (const [k, inst] of [['K1', INST1], ['K2', INST2]]) b.set(d.doc(P('posdev/' + k)), { name: 'קופה ' + k, code: k, br: 'b1', on: true, st: 'active', inst, lastSeq: 0, at: 1, appr: { by: 'seed', at: 1 } }); // appr – POS:W2: devApprove (ש7) דלוק כברירת מחדל
    b.set(d.doc(P('prod/p1')), { name: 'מטען', price: 49.9, q: { b1: 5 }, cat: 'c1' });
    b.set(d.doc(P('prod/p0')), { name: 'כוסות', price: 10, q: { b1: 0 }, cat: 'c2' });
    b.set(d.doc(P('prod/pm')), { name: 'מגש', price: 100, minP: 90, q: { b1: 9 }, cat: 'c2' });
    b.set(d.doc(P('prod/pa')), { name: 'צלחת', price: 12.5, q: { b1: 50 }, cat: 'c3' });
    b.set(d.doc(P('cust/c1')), { name: 'דני', phone: '0501111111' });
    b.set(d.doc(P('cust/c2')), { name: 'רותי', phone: '0502222222', lim: 1000 });
    b.set(d.doc(P('cust/cb')), { name: 'איש קשר', bn: 'חברה בע"מ', vat: '123456789', wholesale: true, lim: 50000 });
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  S = require('../functions/pos-sale.js')._core;
  DOC = require('../functions/pos-doc.js')._core;
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

// ---------------------------------------------------------------------------------
describe('posSale – מכירה, תשלום, מסמך', () => {
  beforeEach(seed);

  it('מכירה במזומן עם עודף: possale + pospay + חשבונית מס קבלה בסדרת הקופה; prn ממתין; מלאי 0 יורד ל-1−', async () => {
    const r = await sell(CASH, { lines: [L(), L({ pid: 'p0', n: 'כוסות', unit: 1000 })], ...cash(5990, 4010) });
    assert.equal(r.id, 'K1-000001'); assert.equal(r.gross, 5990); assert.equal(r.chg, 4010);
    assert.deepEqual(r.docs.map((x) => x.id), ['irD-K1-1']);
    const s = await get('possale/K1-000001');
    assert.equal(s.paid + s.debt, s.gross); assert.equal(s.chg, 4010); assert.equal(s.prn, 'pend'); assert.deepEqual(s.pm, { cash: 5990 });
    assert.equal(s.net + s.vat, s.gross);
    const pays = await all('pospay', ['sale', 'K1-000001']);
    assert.equal(pays.length, 1); assert.equal(pays[0].chg, undefined); // העודף רק ב-possale
    const doc = await get('ardoc/irD-K1-1');
    assert.equal(doc.gross, 5990); assert.equal(doc.t, 'ir'); assert.equal(doc.dev, 'K1');
    assert.equal((await get('prod/p0')).q.b1, -1); assert.equal((await get('prod/p1')).q.b1, 4);
  });

  it('POS:W2 (איחוד, ש7): devApprove דלוק – מכשיר בלי posdev.appr לא מוכר; devApprove כבוי בהגדרות (ש4) – מוכר', async () => {
    await set('posdev/K2', { appr: null }, true);
    assert.equal(R(await call('posSale', CASH, sale({ dev: 'K2', inst: INST2 }))), 'dev-unapproved');
    await set('poscfg/main', { devApprove: false }, true);
    assert.equal(R(await call('posSale', CASH, sale({ dev: 'K2', inst: INST2 }))), 'ok');
  });

  it('(7) אותו reqId פעמיים = מכירה אחת, מסמך אחד', async () => {
    const o = sale();
    const a = await call('posSale', CASH, o), b = await call('posSale', CASH, o);
    assert.equal(a.r.id, b.r.id); assert.equal(b.r.dup, true);
    assert.equal((await all('possale')).length, 1); assert.equal((await all('ardoc')).length, 1);
  });

  it('(9) 500 מכירות (כולל ניסיונות כושלים) בשתי קופות – מספרי מכירה ומסמכים רציפים בלי חור ובלי כפילות', async () => {
    const jobs = [];
    for (let i = 0; i < 500; i++) {
      const dev = i % 2 ? 'K2' : 'K1', inst = i % 2 ? INST2 : INST1;
      const bad = i % 10 === 3; // ניסיון שנכשל (לא סגור) – לא מקבל מספר
      jobs.push(call('posSale', CASH, sale({ dev, inst, pays: [{ m: 'cash', amt: bad ? 100 : 4990 }] })));
    }
    const rs = await Promise.all(jobs);
    assert.equal(rs.filter((r) => !r.ok).length, 50);
    assert.ok(rs.filter((r) => !r.ok).every((r) => r.reason === 'not-closed'));
    // הכושלים (i % 10 === 3) כולם אי-זוגיים – כלומר ב-K2: K1 = 250 מכירות, K2 = 200
    for (const [dev, n] of [['K1', 250], ['K2', 200]]) {
      const ss = await all('possale', ['dev', dev]);
      assert.equal(ss.length, n);
      assert.deepEqual(ss.map((x) => x.seq).sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1));
      const ds = (await all('ardoc', ['dev', dev])).map((x) => x.no).sort((a, b) => a - b);
      assert.deepEqual(ds, Array.from({ length: n }, (_, i) => i + 1));
      assert.equal((await get(`arcfg/seq_irD_${dev}`)).n, n);
    }
  });

  it('(5) סגירה: עקיפת הממשק עם סכום לא סגור – נדחית בלי מספר; ביט מעל היתרה; credit; הקפה בתוך / מעל המסגרת; בלי לקוח', async () => {
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'cash', amt: 4000 }] }))), 'not-closed');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'bit', amt: 5000, ref: '1' }] }))), 'over-balance');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'check', amt: 5000, chk: { no: '1', bank: '2' } }] }))), 'over-balance');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'credit', amt: 4990 }] }))), 'bad-pay-m');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'bit', amt: 4990 }] }))), 'need-ref');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'cash', amt: 990 }], debt: 4000 }))), 'debt-no-cust');
    assert.equal((await get('posdev/K1')).lastSeq, 0);
    // 5 אמצעים שונים + הקפה בתוך המסגרת של c2 (1,000 ₪)
    const lines = [L({ qty: 10 })]; // 499.00 ₪
    const r = await call('posSale', CASH, sale({ cust: 'c2', lines, debt: 9900, pays: [{ m: 'card', amt: 10000, last4: '4242', appr: 'A1' }, { m: 'bit', amt: 10000, ref: 'B1' },
      { m: 'check', amt: 10000, chk: { no: '55', bank: '12' }, post: true, due: '2026-12-31' }, { m: 'transfer', amt: 5000, ref: 'T1' }, { m: 'cash', amt: 6000 }], chg: 1000 }));
    assert.equal(R(r), 'ok');
    const s = await get('possale/' + r.r.id);
    assert.equal(s.paid + s.debt, s.gross); assert.equal(s.debt, 9900);
    assert.deepEqual(r.r.docs.map((x) => x.t), ['inv', 'rc']);
    assert.equal((await get('cust/c2')).ar.bal, 9900);
    assert.ok(!(await all('pospay', ['sale', r.r.id])).some((p) => p.m === 'credit' || p.m === 'debt'));
    // מעל המסגרת הפנויה (1,000 ₪ − 99 ₪) – נחסם
    assert.equal(R(await call('posSale', CASH, sale({ cust: 'c2', lines: [L({ qty: 20 })], debt: 99800, pays: [] }))), 'over-limit');
    // לקוח בלי מסגרת – נחסם
    assert.equal(R(await call('posSale', CASH, sale({ cust: 'c1', debt: 4990, pays: [] }))), 'over-limit');
  });

  it('(4) תקרת מזומן: warn בלי אישור – נדחה; עם אישור – נשמר ונרשם cashMax; note – בלי אישור; block – נחסם', async () => {
    await set('poscfg/main', { v: { cashMax: 10000 } }, true);
    const big = { lines: [L({ qty: 3 })], pays: [{ m: 'cash', amt: 14970 }] };
    assert.equal(R(await call('posSale', CASH, sale(big))), 'cash-max-confirm');
    const r = await call('posSale', CASH, sale(Object.assign({ cashOk: true }, big)));
    assert.equal(R(r), 'ok'); assert.deepEqual(r.r.warn, ['cash-max']);
    assert.equal((await all('poslog', ['act', 'cashMax'])).length, 1);
    await set('poscfg/main', { v: { cashMax: 10000, cashMaxMode: 'note' } }, true);
    assert.equal(R(await call('posSale', CASH, sale(big))), 'ok');
    assert.equal((await all('poslog', ['act', 'cashMax'])).length, 2);
    await set('poscfg/main', { v: { cashMax: 10000, cashMaxMode: 'block' } }, true);
    assert.equal(R(await call('posSale', CASH, sale(Object.assign({ cashOk: true }, big)))), 'cash-max');
  });

  it('(9) לקוח רגיל ← ir; לקוח עסקי ← inv + rc; (ה 5.16) מעל allocMin בלי מספר הקצאה – לא מופק, poslog; במסמך אין מזהה מכירה', async () => {
    const r = await sell(CASH, { cust: 'cb', lines: [L({ qty: 2 })], pays: [{ m: 'transfer', amt: 9980, ref: 'TT' }] });
    assert.deepEqual(r.docs.map((x) => x.t), ['inv', 'rc']);
    const inv = await get('ardoc/' + r.docs[0].id);
    assert.equal(inv.st, 'paid'); assert.equal(inv.custSnap.bn, '123456789');
    for (const x of await all('ardoc')) assert.ok(!JSON.stringify(x).includes(r.id), 'מזהה מכירה פנימי במסמך');
    assert.equal(R(await call('posSale', CASH, sale({ cust: 'cb', lines: [L({ qty: 200 })], pays: [{ m: 'transfer', amt: 998000, ref: 'X' }] }))), 'need-alloc');
    assert.equal((await all('poslog', ['act', 'allocBlock'])).length, 1);
    assert.equal(R(await call('posSale', CASH, sale({ cust: 'cb', alloc: '123456789', lines: [L({ qty: 200 })], pays: [{ m: 'transfer', amt: 998000, ref: 'X' }] }))), 'ok');
    const c1 = await sell(CASH, { cust: 'c1' });
    assert.deepEqual(c1.docs.map((x) => x.t), ['ir']);
  });

  it('(7) אשראי: אחרי 50 עסקאות – אין ברצף 13–19 ספרות שעובר Luhn בשום אוסף; pospay רק שדות מותרים; מספר כרטיס בקלט – נדחה', async () => {
    for (let i = 0; i < 50; i++) await sell(CASH, { pays: [{ m: 'card', amt: 4990, last4: String(1000 + i), appr: 'AP' + i, brand: 'visa', termNo: 'T1' }], note: 'לקוח ' + i });
    assert.equal(R(await call('posSale', CASH, sale({ note: 'כרטיס 4580 4580 4580 4580'.replace(/4580 4580 4580 4580/, '4111 1111 1111 1111') }))), 'card-data');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 4990, last4: '1111', appr: '4111111111111111' }] }))), 'card-data');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 4990, last4: '1111', appr: '1', cvv: '123' }] }))), 'bad-pay-field');
    const allowed = ['m', 'amt', 'ref', 'reqId', 'last4', 'appr', 'brand', 'inst', 'tx', 'src', 'term', 'termNo', 'i', 'sale', 'dev', 'br', 'cashier', 'at', 'chk', 'due', 'code'];
    for (const p of await all('pospay')) { for (const k of Object.keys(p)) if (k !== '_id') assert.ok(allowed.includes(k), k); if (p.m === 'card') assert.match(p.last4, /^[0-9]{4}$/); }
    // סריקה של כל האוספים של העסק
    let bad = [];
    const path = require('node:path');
    const adb = require(require.resolve('firebase-admin/firestore', { paths: [path.join(H.ROOT, 'functions')] })).getFirestore();
    const cols = await adb.doc('b/' + A).listCollections();
    assert.ok(cols.length >= 8);
    for (const c of cols) for (const x of (await c.get()).docs) { if (S.cardIn(x.id) || S.hasCard(x.data())) bad.push(c.id + '/' + x.id); }
    assert.deepEqual(bad, []);
  });

  it('(8) אותו מספר אישור פעמיים בתוך 10 דקות – אזהרה + poslog dupWarn', async () => {
    const p = { pays: [{ m: 'card', amt: 4990, last4: '1234', appr: 'SAME1' }] };
    const a = await sell(CASH, p);
    assert.ok(!a.warn.includes('dup-appr'));
    const b = await sell(CASH, p);
    assert.ok(b.warn.includes('dup-appr'));
    assert.equal((await all('poslog', ['act', 'dupWarn'])).length, 1);
  });

  it('(1, 13) מבצע מחושב בשרת; סכום שונה במכשיר: מקוון – נדחה, בלי רשת – נשמר לבדיקה בלי מסמך; ביטול המבצע לא משנה מכירה שנשמרה', async () => {
    await set('promo/n2', { type: 'nForX', n: 2, price: 2000, pids: ['pa'], on: true, n0: '2 ב-20' });
    const r = await sell(CASH, { lines: [L({ pid: 'pa', n: 'צלחת', qty: 2, unit: 1250 })], pays: [{ m: 'cash', amt: 1000 }, { m: 'bit', amt: 1000, ref: '88231' }], gross: 2000 });
    const s = await get('possale/' + r.id);
    assert.deepEqual([s.gross, s.net, s.vat, s.lines[0].pdisc, s.lines[0].promo], [2000, 1695, 305, 500, 'n2']);
    assert.equal(R(await call('posSale', CASH, sale({ lines: [L({ pid: 'pa', n: 'צלחת', qty: 2, unit: 1250 })], pays: [{ m: 'cash', amt: 2500 }], gross: 2500 }))), 'bad-total');
    const off = await sell(CASH, { off: true, lines: [L({ pid: 'pa', n: 'צלחת', qty: 2, unit: 1250 })], pays: [{ m: 'cash', amt: 2500 }], gross: 2500 });
    const so = await get('possale/' + off.id);
    assert.equal(so.chk, true); assert.equal(so.devGross, 2500); assert.deepEqual(so.docs, []);
    await set('promo/n2', { on: false }, true);
    const s2 = await get('possale/' + r.id);
    assert.equal(s2.lines[0].pdisc, 500); assert.equal(s2.gross, 2000);
  });

  it('(14) הנחה ידנית: קופאי – נדחה; אחראי 10% עובר, 11% דורש מנהל; מנהל מתחת למחיר מינימום – discOvr', async () => {
    const ten = { lines: [L({ pid: 'pm', n: 'מגש', unit: 10000 })], manDisc: { pct: 10, why: 'לקוח קבוע' }, pays: [{ m: 'cash', amt: 9000 }] };
    assert.equal(R(await call('posSale', CASH, sale(ten))), 'disc-role');
    assert.equal(R(await call('posSale', LEAD, sale(ten))), 'ok');
    assert.equal(R(await call('posSale', LEAD, sale(Object.assign({}, ten, { manDisc: { pct: 11 }, pays: [{ m: 'cash', amt: 8900 }] })))), 'disc-over');
    const r = await call('posSale', MGR, sale(Object.assign({}, ten, { manDisc: { pct: 20 }, pays: [{ m: 'cash', amt: 8000 }] })));
    assert.equal(R(r), 'ok');
    assert.equal((await get('possale/' + r.r.id)).discOvr, true);
    assert.equal((await all('poslog', ['act', 'discOvr'])).length, 1);
  });
});

describe('posCouponUse – קופונים (ב 5.15)', () => {
  beforeEach(seed);
  it('שימוש שני נדחה (גם בשתי קופות באותה שנייה); של לקוח אחר – נדחה; שניים יחד – עובר; על מוצר במבצע – לא חל', async () => {
    const i1 = await call('posCouponUse', MGR, { op: 'issue', cust: 'c1', disc: { type: 'amt', amt: 500 }, code: 'CPN-A' });
    assert.equal(R(i1), 'ok');
    assert.equal(R(await call('posCouponUse', CASH, { op: 'issue', cust: 'c1', disc: { type: 'amt', amt: 1 } })), 'not-manager');
    const [a, b] = await Promise.all([
      call('posSale', CASH, sale({ cust: 'c1', cpns: ['CPN-A'], pays: [{ m: 'cash', amt: 4490 }] })),
      call('posSale', CASH, sale({ dev: 'K2', inst: INST2, cust: 'c1', cpns: ['CPN-A'], pays: [{ m: 'cash', amt: 4490 }] })),
    ]);
    assert.deepEqual([R(a), R(b)].sort(), ['cpn-used', 'ok']);
    assert.equal((await get('poscpn/CPN-A')).st, 'used');
    await call('posCouponUse', MGR, { op: 'issue', cust: 'c1', disc: { type: 'amt', amt: 300 }, code: 'CPN-B' });
    await call('posCouponUse', MGR, { op: 'issue', cust: 'c1', disc: { type: 'pct', pct: 10 }, code: 'CPN-C' });
    assert.equal(R(await call('posSale', CASH, sale({ cust: 'c2', cpns: ['CPN-B'], pays: [{ m: 'cash', amt: 4690 }] }))), 'cpn-cust');
    const two = await call('posSale', CASH, sale({ cust: 'c1', cpns: ['CPN-B', 'CPN-C'], pays: [{ m: 'cash', amt: 4221 }] }));
    assert.equal(R(two), 'ok'); // 4990 − 300 = 4690; 10% מהסכום אחרי הקופון הקודם = 469 → 4221
    await set('promo/x', { type: 'pct', pct: 5, pids: ['p1'], on: true, n: 'x' });
    await call('posCouponUse', MGR, { op: 'issue', cust: 'c1', disc: { type: 'amt', amt: 100 }, code: 'CPN-D' });
    assert.equal(R(await call('posSale', CASH, sale({ cust: 'c1', cpns: ['CPN-D'], pays: [{ m: 'cash', amt: 4740 }] }))), 'cpn-no-line');
  });
});

describe('posReturn – החזרה (ב 5.11, ה15)', () => {
  beforeEach(seed);
  const ret = (o) => Object.assign({ reqId: reqId(), dev: 'K1', inst: INST1, why: 'לא מתאים', tag: true }, o);

  it('קבלה בת 15 יום – נחסמת; קופאי – נדחה; 250 ₪ – דורש מנהל; פגום – רק פתק החלפה', async () => {
    const old = await sell(CASH, { soldAt: Date.now() - 15 * DAY });
    assert.equal(R(await call('posReturn', LEAD, ret({ sale: old.id, items: [{ i: 0, qty: 1 }] }))), 'ret-too-old');
    const s = await sell(CASH, { lines: [L({ qty: 6 })], pays: [{ m: 'cash', amt: 29940 }] });
    assert.equal(R(await call('posReturn', CASH, ret({ sale: s.id, items: [{ i: 0, qty: 1 }] }))), 'ret-lead');
    assert.equal(R(await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 5 }] }))), 'ret-mgr');
    assert.equal(R(await call('posReturn', MGR, ret({ sale: s.id, items: [{ i: 0, qty: 5 }] }))), 'ok');
    assert.equal(R(await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 1 }], dmg: true, refunds: [{ m: 'cash', amt: 4990 }] }))), 'ret-exch');
    const d = await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 1 }], dmg: true }));
    assert.equal(R(d), 'ok'); assert.equal(d.r.vouchers.length, 1);
    assert.equal((await get('prod/p1')).q.b1, 5 - 1 - 6 + 5); // המכירה הישנה (1), המכירה (6), החזרה תקינה (5); פגום לא חוזר למלאי
    assert.equal(R(await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 1 }] }))), 'ret-qty');
    const n = await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 1 }], tag: false }));
    assert.equal(R(n), 'need-tag');
  });

  it('1 מתוך 3 עם הנחת חשבון = שליש מהשורה; 3 החזרות חלקיות = בדיוק מה ששולם; זיכוי cr לכל החזרה', async () => {
    const s = await sell(LEAD, { lines: [L({ qty: 3, unit: 3333 }), L({ pid: 'pa', n: 'צלחת', qty: 1, unit: 1250 })], manDisc: { amt: 777 }, pays: [{ m: 'cash', amt: 9999 + 1250 - 777 }] });
    const sl = await get('possale/' + s.id);
    const pg = sl.lines[0].pg;
    let tot = 0;
    for (let k = 0; k < 3; k++) {
      const r = await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 1 }] }));
      assert.equal(R(r), 'ok');
      if (k < 2) assert.equal(r.r.amt, Math.round(pg / 3));
      tot += r.r.amt;
      assert.equal(r.r.docs[0].t, 'cr');
    }
    assert.equal(tot, pg);
    assert.equal((await get('possale/' + s.id)).retAmt[0], pg);
  });

  it('אותו reqId פעמיים – החזרה אחת; שתי קופות במקביל על היחידה האחרונה – רק אחת עוברת', async () => {
    const s = await sell(CASH);
    const o = ret({ sale: s.id, items: [{ i: 0, qty: 1 }] });
    const a = await call('posReturn', LEAD, o), b = await call('posReturn', LEAD, o);
    assert.equal(a.r.id, b.r.id); assert.equal(b.r.dup, true);
    const s2 = await sell(CASH);
    const [x, y] = await Promise.all([call('posReturn', LEAD, ret({ sale: s2.id, items: [{ i: 0, qty: 1 }] })), call('posReturn', LEAD, ret({ dev: 'K2', inst: INST2, sale: s2.id, items: [{ i: 0, qty: 1 }] }))]);
    assert.deepEqual([R(x), R(y)].sort(), ['ok', 'ret-qty']);
    assert.equal((await all('posret', ['sale', s2.id])).length, 1);
  });

  it('100 ₪ אשראי + 50 ₪ מזומן: לכרטיס מעל 100 / מזומן מעל 50 – נחסם; עסקת אשראי – אין מזומן', async () => {
    const s = await sell(LEAD, { lines: [L({ unit: 15000 })], pays: [{ m: 'card', amt: 10000, last4: '4242', appr: 'X1' }, { m: 'cash', amt: 5000 }] });
    await set('poscfg/main', { v: { retMgrAbove: 100000 } }, true);
    assert.equal(R(await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 1 }], refunds: [{ m: 'card', amt: 11000 }, { m: 'cash', amt: 4000 }] }))), 'ret-over-method');
    assert.equal(R(await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 1 }], refunds: [{ m: 'card', amt: 9000 }, { m: 'cash', amt: 6000 }] }))), 'ret-over-method');
    const ok = await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 1 }], refunds: [{ m: 'card', amt: 10000 }, { m: 'cash', amt: 5000 }] }));
    assert.equal(R(ok), 'ok');
    assert.deepEqual((await get('possale/' + s.id)).retByM, { card: 10000, cash: 5000 });
    const c = await sell(CASH, { pays: [{ m: 'card', amt: 4990, last4: '1111', appr: 'C2' }] });
    assert.equal(R(await call('posReturn', LEAD, ret({ sale: c.id, items: [{ i: 0, qty: 1 }], refunds: [{ m: 'cash', amt: 4990 }] }))), 'ret-over-method');
  });

  it('קיזוז חוב: 200 ₪ עם debt 80 → החזרה 100 מקטינה חוב ב-80 ומחזירה 20; עוד 50 – כולה כסף; כולה בהקפה; אחרי posDebtPay', async () => {
    await set('poscfg/main', { v: { retMgrAbove: 100000 } }, true);
    const s = await sell(CASH, { cust: 'c2', lines: [L({ unit: 10000 }), L({ unit: 5000 }), L({ unit: 5000 })], debt: 8000, pays: [{ m: 'cash', amt: 12000 }] });
    assert.equal((await get('cust/c2')).ar.bal, 8000);
    const r1 = await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 0, qty: 1 }] }));
    assert.equal(R(r1), 'ok');
    assert.equal(r1.r.debtOff, 8000); assert.deepEqual(r1.r.refunds, [{ m: 'cash', src: 'cash', amt: 2000 }]);
    assert.equal((await get('cust/c2')).ar.bal, 0);
    const r2 = await call('posReturn', LEAD, ret({ sale: s.id, items: [{ i: 1, qty: 1 }] }));
    assert.equal(r2.r.debtOff, 0); assert.equal(r2.r.refunds[0].amt, 5000);
    // כולה בהקפה: 150 ₪
    const s3 = await sell(CASH, { cust: 'c2', lines: [L({ unit: 15000 })], debt: 15000, pays: [] });
    assert.deepEqual(s3.docs.map((x) => x.t), ['inv']);
    const r3 = await call('posReturn', LEAD, ret({ sale: s3.id, items: [{ i: 0, qty: 1 }] }));
    assert.equal(r3.r.debtOff, 15000); assert.deepEqual(r3.r.refunds, []);
    assert.equal((await get('cust/c2')).ar.bal, 0);
    // אותה מכירה, אחרי שהלקוח שילם 100 ₪ מהחוב: 50 ₪ מקטינים את החוב, 100 ₪ מוחזרים לפי '*' (מזומן)
    const s4 = await sell(CASH, { cust: 'c2', lines: [L({ unit: 15000 })], debt: 15000, pays: [] });
    const dp = await call('posDebtPay', CASH, { reqId: reqId(), dev: 'K1', inst: INST1, cust: 'c2', amt: 10000, pays: [{ m: 'cash', amt: 10000 }] });
    assert.equal(R(dp), 'ok'); assert.equal(dp.r.doc.t, 'rc');
    assert.equal((await get('cust/c2')).ar.bal, 5000);
    assert.equal(R(await call('posDebtPay', CASH, { reqId: reqId(), dev: 'K1', inst: INST1, cust: 'c2', amt: 6000, pays: [{ m: 'cash', amt: 6000 }] })), 'over-debt');
    const r4 = await call('posReturn', LEAD, ret({ sale: s4.id, items: [{ i: 0, qty: 1 }] }));
    assert.equal(R(r4), 'ok');
    assert.equal(r4.r.debtOff, 5000); assert.deepEqual(r4.r.refunds, [{ m: 'cash', src: 'debt', amt: 10000 }]);
    assert.equal((await get('cust/c2')).ar.bal, 0);
  });
});

describe('posGift – פתק זיכוי וכרטיס מתנה (ב 5.12)', () => {
  beforeEach(seed);
  it('פתק זיכוי נוצר עם תוקף, ממומש בשתי מכירות עד 0, לא מומר למזומן; כרטיס מתנה – מכירה וקבלה', async () => {
    const s = await sell(CASH, { lines: [L({ qty: 2 })], pays: [{ m: 'cash', amt: 9980 }] });
    const r = await call('posReturn', LEAD, { reqId: reqId(), dev: 'K1', inst: INST1, sale: s.id, items: [{ i: 0, qty: 2 }], why: 'לא מתאים', tag: true, refunds: [{ m: 'voucher', amt: 9980 }] });
    assert.equal(R(r), 'ok');
    const code = r.r.vouchers[0].code;
    const g = await get('posgift/' + code);
    assert.equal(g.type, 'voucher'); assert.equal(g.bal, 9980); assert.ok(g.exp > Date.now() + 700 * DAY);
    const a = await sell(CASH, { pays: [{ m: 'voucher', amt: 4990, code }] });
    const b = await sell(CASH, { pays: [{ m: 'voucher', amt: 4990, code }] });
    assert.equal((await get('posgift/' + code)).bal, 0);
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'voucher', amt: 1, code }, { m: 'cash', amt: 4989 }] }))), 'gift-bal');
    // החזרה של מכירה ששולמה בפתק – רק לפתק, לא למזומן
    assert.equal(R(await call('posReturn', LEAD, { reqId: reqId(), dev: 'K1', inst: INST1, sale: a.id, items: [{ i: 0, qty: 1 }], why: 'x', tag: true, refunds: [{ m: 'cash', amt: 4990 }] })), 'ret-over-method');
    const back = await call('posReturn', LEAD, { reqId: reqId(), dev: 'K1', inst: INST1, sale: b.id, items: [{ i: 0, qty: 1 }], why: 'x', tag: true });
    assert.equal(back.r.refunds[0].m, 'voucher');
    assert.equal(R(await call('posGift', LEAD, { op: 'get', code })), 'ok');
    const gs = await call('posGift', CASH, { op: 'sell', reqId: reqId(), dev: 'K1', inst: INST1, amt: 20000, pays: [{ m: 'cash', amt: 20000 }] });
    assert.equal(R(gs), 'ok'); assert.equal(gs.r.doc.t, 'rc');
    assert.equal((await get('posgift/' + gs.r.code)).bal, 20000);
    assert.equal(R(await call('posGift', CASH, { op: 'issue', type: 'voucher', amt: 100, why: 'x' })), 'not-manager');
    const rs = await call('posGift', LEAD, { op: 'restore', code: gs.r.code });
    assert.equal(R(rs), 'ok'); assert.equal((await get('posgift/' + gs.r.code)).st, 'void'); assert.equal((await get('posgift/' + rs.r.code)).bal, 20000);
  });
});

describe('posPark, posDoc, posPromo, כללים', () => {
  beforeEach(seed);
  it('(2) 15 עגלות מושהות נשמרות ומשוחזרות; בסגירת יום פתוחות ← flag', async () => {
    for (let i = 0; i < 15; i++) assert.equal(R(await call('posPark', CASH, { op: 'save', dev: 'K1', id: 'park' + String(i).padStart(4, '0'), name: 'עגלה ' + i, lines: [L({ qty: i + 1 })] })), 'ok');
    let l = await call('posPark', CASH, { op: 'list', dev: 'K1' });
    assert.equal(l.r.list.length, 15); assert.equal(l.r.list[3].lines[0].qty, 4);
    await call('posPark', CASH, { op: 'done', dev: 'K1', id: 'park0000' });
    const f = await call('posPark', LEAD, { op: 'flag', dev: 'K1' });
    assert.equal(f.r.n, 14);
    l = await call('posPark', CASH, { op: 'list', dev: 'K1' });
    assert.equal(l.r.list.length, 14); assert.ok(l.r.list.every((x) => x.st === 'flag'));
  });

  it('(ד H7, 10) קבלה: נייר נגמר ← prn pend; אחרי החלפה "הדפס שוב" ← ok + reprint ביומן; קבלת מתנה נרשמת; נתוני קבלה', async () => {
    const s = await sell(CASH);
    assert.equal((await call('posDoc', CASH, { op: 'printed', sale: s.id, ok: false })).r.prn, 'pend');
    assert.equal((await call('posDoc', CASH, { op: 'printed', sale: s.id, ok: true })).r.prn, 'ok');
    assert.equal((await all('poslog', ['act', 'reprint'])).length, 1);
    await call('posDoc', CASH, { op: 'gift', sale: s.id });
    assert.equal((await all('poslog', ['act', 'giftRcpt'])).length, 1);
    const g = await call('posDoc', CASH, { op: 'get', sale: s.id });
    assert.equal(g.r.docs[0].t, 'ir'); assert.equal(g.r.pays.length, 1);
  });

  it('posPromo: מנהל יוצר / משכפל / מכבה; קופאי – לא; מבצע לא תקין – נדחה', async () => {
    const c = await call('posPromo', MGR, { op: 'set', p: { n: '1+1', type: 'bxgy', buy: ['p1'], get: ['p1'], on: true, from: '2026-11-01', to: '2026-12-31' } });
    assert.equal(R(c), 'ok');
    assert.equal(R(await call('posPromo', CASH, { op: 'on', id: c.r.id, on: false })), 'not-manager');
    assert.equal(R(await call('posPromo', MGR, { op: 'set', p: { n: 'x', type: 'pct', pct: 0 } })), 'bad-pct');
    const d = await call('posPromo', MGR, { op: 'dup', id: c.r.id, from: '2027-01-01', to: '2027-01-07' });
    assert.equal((await get('promo/' + d.r.id)).on, false);
    assert.equal(R(await call('posPromo', MGR, { op: 'on', id: c.r.id, on: false })), 'ok');
  });

  it('(9) אין פעולה שמוחקת מסמך: כתיבה / מחיקה ישירה נדחית לכל תפקיד; אין קריאת delete בקוד של ש2', async () => {
    const s = await sell(CASH);
    await call('posPark', CASH, { op: 'save', dev: 'K1', id: 'parkxxxx', lines: [L()] });
    for (const u of [SUPER, MGR, LEAD, CASH]) {
      for (const p of ['ardoc/irD-K1-1', 'possale/' + s.id, 'pospay/' + s.id + '-1', 'pospark/K1_parkxxxx', 'poscpn/x', 'posret/x']) {
        await assertFails(fsu(u).doc(P(p)).delete());
        await assertFails(fsu(u).doc(P(p)).set({ x: 1 }));
      }
    }
    const fs = require('node:fs'), path = require('node:path');
    for (const f of ['pos-sale.js', 'pos-doc.js']) assert.ok(!/(tx|b|batch|ref|\))\.delete\(/.test(fs.readFileSync(path.join(__dirname, '../functions', f), 'utf8')), f);
  });
});

// ---------------------------------------------------------------------------------
// POS:W2 – איחוד גל 2, סבב 2 (18.11): אישור אחראי (ש5) במכירה ובהחזרה, החזרה מהקופה דרך התור (pos-data → posReturn), קטגוריה במבצע
describe('POS:W2 – אישור אחראי (ש5) ב-posSale וב-posReturn', () => {
  const AG = require('../functions/lib/pos-agg');
  const AU = () => require('../functions/pos-auth.js')._core;
  const PIN = { [LEAD]: '4826', [MGR]: '7391' };
  const auth = async (uid, data) => { try { return { ok: true, r: await AU().call()(req(uid, data)) }; } catch (e) { return { ok: false, reason: e.details && e.details.reason, msg: e.message }; } };
  // אישור: o = { pct?, amt?, ref?, need? }
  const appr = async (uid, by, act, o) => {
    const r = await auth(uid, Object.assign({ op: 'approve', act, by, pin: PIN[by] }, o || {}));
    assert.equal(R(r), 'ok', r.msg); assert.ok(r.r.ap); return r.r.ap;
  };
  const age = (ap, ms) => set('poslog/' + ap, { at: Date.now() - ms }, true);
  beforeEach(async () => { await seed(); for (const [u, p] of Object.entries(PIN)) { const h = AG.pinHash(p); await set('pospin/' + u, { h: h.h, s: h.s, fails: 0, lockUntil: 0, upd: 1 }); } });
  // מגש 100 ₪ (מינימום 90 ₪); הנחת עגלה של pct% – כל ההנחה על המגש
  const tray = (pct, ap, o) => Object.assign({ lines: [L({ pid: 'pm', n: 'מגש', unit: 10000 })], manDisc: Object.assign({ amt: pct * 100, why: 'לקוח קבוע' }, ap ? { ap } : {}), pays: [{ m: 'cash', amt: 10000 - pct * 100 }] }, o || {});

  it('leads: הקופאי רואה רק מי שיכול לאשר (אחראי / מנהל עם קוד), בלי פרטי הקוד', async () => {
    const r = await auth(CASH, { op: 'leads' });
    assert.equal(R(r), 'ok');
    assert.deepEqual(r.r.staff.map((x) => [x.uid, x.role]).sort(), [[LEAD, 'lead'], [MGR, 'manager']].sort());
    assert.ok(r.r.staff.every((x) => !('h' in x) && !('s' in x) && !('hasPin' in x)));
  });

  it('קופאי + אישור אחראי תקין (10% על העגלה) – עובר; נרשם מי אישר; האישור מנוצל: אותו reqId – אותה מכירה, מכירה אחרת – נדחית', async () => {
    const ap = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    const o = sale(tray(10, ap));
    const r = await call('posSale', CASH, o);
    assert.equal(R(r), 'ok', r.msg);
    const s = await get('possale/' + r.r.id);
    assert.equal(s.gross, 9000); assert.deepEqual(s.aps, [{ id: ap, by: LEAD, role: 'lead' }]);
    const lg = await get('poslog/' + ap);
    assert.equal(lg.used, true); assert.equal(lg.sale, r.r.id);
    const again = await call('posSale', CASH, o);
    assert.equal(R(again), 'ok'); assert.equal(again.r.dup, true); assert.equal(again.r.id, r.r.id);
    assert.equal(R(await call('posSale', CASH, sale(tray(10, ap)))), 'ap-used');
  });

  it('הנחת שורה עם אישור לשורה; אותו אישור לשתי שורות – נדחה', async () => {
    const ap = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'l:pa' });
    const l2 = (x) => [L({ pid: 'pa', n: 'צלחת', unit: 1250, qty: 2, mdisc: { amt: 250, why: 'x', ap: x } }), L({ pid: 'p0', n: 'כוסות', unit: 1000, mdisc: { amt: 100, why: 'x', ap: x } })];
    assert.equal(R(await call('posSale', CASH, sale({ lines: l2(ap), pays: [{ m: 'cash', amt: 2250 + 900 }] }))), 'ap-used');
    const r = await call('posSale', CASH, sale({ lines: [l2(ap)[0]], pays: [{ m: 'cash', amt: 2250 }] }));
    assert.equal(R(r), 'ok', r.msg);
  });

  it('ליקוי 1: האישור קשור לאחוז ולמה שאושר – 1% שאושר לא מכסה 10%; אישור מנהל ל-1% לא מכסה 40% מתחת למינימום (ולא נרשם discOvr); עגלה ↔ שורה', async () => {
    const a1 = await appr(CASH, LEAD, 'disc', { pct: 1, ref: 'cart' });
    assert.equal(R(await call('posSale', CASH, sale(tray(10, a1)))), 'ap-scope');
    const m1 = await appr(CASH, MGR, 'disc', { pct: 1, ref: 'cart' });
    assert.equal(R(await call('posSale', CASH, sale(tray(40, m1)))), 'ap-scope');
    assert.equal((await all('possale')).length, 0, 'שום מכירה לא נשמרה');
    const line = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'l:pm' });
    assert.equal(R(await call('posSale', CASH, sale(tray(10, line)))), 'ap-scope', 'אישור לשורה לא חל על הנחת עגלה');
    // מתחת למינימום: אישור מנהל שמכסה את האחוז אבל בלי need:'manager' – לא מספיק; עם need:'manager' – עובר ונרשם discOvr
    const m15 = await appr(CASH, MGR, 'disc', { pct: 15, ref: 'cart' }); // 15% > 10% → need 'manager' בכל מקרה
    const r = await call('posSale', CASH, sale(tray(15, m15)));
    assert.equal(R(r), 'ok', r.msg); assert.equal((await get('possale/' + r.r.id)).discOvr, true);
    const lineBelow = { lines: [L({ pid: 'pm', n: 'מגש', unit: 10000 }), L({ pid: 'pa', n: 'צלחת', unit: 1250, qty: 8 })], pays: [{ m: 'cash', amt: 18900 }] };
    const mNo = await appr(CASH, MGR, 'disc', { pct: 11, ref: 'l:pm' }); // 11% על השורה – posAuth שומר need:'manager' (מעל 10%), והמנהל אישר ערך שמכסה
    const withAp = (ap) => Object.assign({}, lineBelow, { lines: [L({ pid: 'pm', n: 'מגש', unit: 10000, mdisc: { amt: 1100, why: 'x', ap } }), lineBelow.lines[1]] });
    const r2 = await call('posSale', CASH, sale(withAp(mNo)));
    assert.equal(R(r2), 'ok', 'need מנהל (האחוז מעל 10) – המנהל אישר בפועל ערך שמכסה; discOvr'); assert.equal((await get('possale/' + r2.r.id)).discOvr, true);
    const lead5 = await appr(CASH, LEAD, 'disc', { pct: 5, ref: 'cart' }); // 5% על העגלה, אבל המגש יורד ל-89 ₪
    const below = { lines: [L({ pid: 'pm', n: 'מגש', unit: 9300 }), L({ pid: 'pa', n: 'צלחת', unit: 1250, qty: 8 })], manDisc: { amt: 965, why: 'x', ap: lead5 }, pays: [{ m: 'cash', amt: 19300 - 965 }] };
    assert.equal(R(await call('posSale', CASH, sale(below))), 'below-min', 'אחראי לא מאשר מתחת למינימום');
    const mgr5 = await appr(CASH, MGR, 'disc', { pct: 5, ref: 'cart' }); // מנהל, אבל בלי need:'manager'
    assert.equal(R(await call('posSale', CASH, sale(Object.assign({}, below, { manDisc: { amt: 965, why: 'x', ap: mgr5 } })))), 'below-min');
    const mgr5x = await appr(CASH, MGR, 'disc', { pct: 5, ref: 'cart', need: 'manager' });
    const r3 = await call('posSale', CASH, sale(Object.assign({}, below, { manDisc: { amt: 965, why: 'x', ap: mgr5x } })));
    assert.equal(R(r3), 'ok', r3.msg); assert.equal((await get('possale/' + r3.r.id)).discOvr, true);
  });

  it('בלי אישור / אישור מזויף / של קופאי אחר / מסוג אחר / מבנה לא תקין – נדחה, ושום מכירה לא נשמרת', async () => {
    assert.equal(R(await call('posSale', CASH, sale(tray(10)))), 'disc-role');
    assert.equal(R(await call('posSale', CASH, sale(tray(10, 'FakeApproval12345678')))), 'ap-bad');
    const forLead = await appr(LEAD, MGR, 'disc', { pct: 10, ref: 'cart' });
    assert.equal(R(await call('posSale', CASH, sale(tray(10, forLead)))), 'ap-bad');
    const voidAp = await appr(CASH, LEAD, 'void');
    assert.equal(R(await call('posSale', CASH, sale(tray(10, voidAp)))), 'ap-bad');
    assert.equal(R(await call('posSale', CASH, sale(tray(10, 'x')))), 'bad-ap');
    assert.equal((await all('possale')).length, 0);
    assert.equal((await get('poslog/' + voidAp)).used, false);
  });

  // סבב 3: הקופה בודקת לפני הגבייה עם PC.discAudit – אותו כלל שהשרת מריץ. בכל מקרה: מה שהקופה מאשרת – השרת רושם; מה שהשרת דוחה – הקופה עוצרת לפני הגבייה
  it('סבב 3 – POC-A ו-POC-B: הקופה (PC.discAudit, כמו ב-pos-sale.js בקופה) מזהה מראש בדיוק את מה שהשרת דוחה, וגם את התיקון', async () => {
    const PC = require('../functions/lib/pos-calc');
    const cfg = {}; // poscfg ריק – ברירות המחדל (אחראי עד 10%)
    const role = (r) => (r === 'manager' ? 'mgr' : 'lead');
    const apr = async (by, o) => { const r = await auth(CASH, Object.assign({ op: 'approve', act: 'disc', by, pin: PIN[by] }, o)); assert.equal(R(r), 'ok', r.msg); return { id: r.r.ap, role: role(r.r.role), pct: o.pct, ref: o.ref, need: r.r.need }; };
    const plates = (qty, md) => ({ base: 1250 * qty, pd: 0, md: md || 0, ref: 'l:pa' });
    const cartOf = (sd, ap) => ({ sd, ap });
    const off = { off: true, soldAt: Date.now() - 1000 };
    // POC-A: אחראי אישר 10% (10 ₪) על עגלה של 100 ₪; הוסרו שתי צלחות – העגלה 75 ₪, ההנחה (סכום קבוע) עכשיו 13.3%
    const a = await apr(LEAD, { pct: 10, ref: 'cart' });
    assert.equal(PC.discAudit('cashier', [plates(8)], cartOf(1000, a), cfg).ok, true, 'לפני שהעגלה השתנתה – תקין');
    const pocA = PC.discAudit('cashier', [plates(6)], cartOf(1000, a), cfg);
    const sA = sale(Object.assign({ lines: [L({ pid: 'pa', n: 'צלחת', unit: 1250, qty: 6 })], manDisc: { amt: 1000, why: 'x', ap: a.id }, pays: [{ m: 'cash', amt: 6500 }] }, off));
    const srvA = await call('posSale', CASH, sA);
    assert.equal(pocA.ok, false); assert.equal(R(srvA), pocA.code, 'הקופה והשרת – אותה דחייה'); assert.equal(pocA.code, 'ap-scope'); assert.equal(pocA.at, -1);
    assert.ok(Math.abs(pocA.pct - 1000 * 100 / 7500) < 1e-9, 'האחוז הנוכחי לבקשת האישור החדש');
    // התיקון: אישור חדש עם האחוז הנוכחי – מעל 10%, ולכן מנהל
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', by: LEAD, pin: PIN[LEAD], pct: 13.34, ref: 'cart' })), 'need-manager');
    const a2 = await apr(MGR, { pct: 13.34, ref: 'cart' });
    assert.equal(PC.discAudit('cashier', [plates(6)], cartOf(1000, a2), cfg).ok, true);
    const okA = await call('posSale', CASH, Object.assign({}, sA, { reqId: reqId(), manDisc: { amt: 1000, why: 'x', ap: a2.id } }));
    assert.equal(R(okA), 'ok', okA.msg);
    // POC-B: אחראי אישר 10% על השורה ועוד 10% על העגלה (אחרי הנחת השורה) – יחד 19%, מעל התקרה של אחראי
    const l = await apr(LEAD, { pct: 10, ref: 'l:pa' });
    const c = await apr(LEAD, { pct: 10, ref: 'cart' });
    const pocB = PC.discAudit('cashier', [Object.assign(plates(8, 1000), { ap: l })], cartOf(900, c), cfg);
    const sB = sale(Object.assign({ lines: [L({ pid: 'pa', n: 'צלחת', unit: 1250, qty: 8, mdisc: { amt: 1000, why: 'x', ap: l.id } })], manDisc: { amt: 900, why: 'x', ap: c.id }, pays: [{ m: 'cash', amt: 8100 }] }, off));
    const srvB = await call('posSale', CASH, sB);
    assert.equal(pocB.ok, false); assert.equal(R(srvB), pocB.code, 'הקופה והשרת – אותה דחייה'); assert.equal(pocB.code, 'disc-over'); assert.equal(pocB.at, -2);
    assert.ok(Math.abs(pocB.pct - 19) < 1e-9);
    // התיקון: מנהל מאשר את הנחת העגלה – התפקיד הגבוה ביותר שאישר הוא מנהל, בלי תקרה
    const c2 = await apr(MGR, { pct: 10, ref: 'cart', need: 'manager' });
    assert.equal(PC.discAudit('cashier', [Object.assign(plates(8, 1000), { ap: l })], cartOf(900, c2), cfg).ok, true);
    const okB = await call('posSale', CASH, Object.assign({}, sB, { reqId: reqId(), manDisc: { amt: 900, why: 'x', ap: c2.id } }));
    assert.equal(R(okB), 'ok', okB.msg);
    assert.equal((await all('possale')).length, 2, 'רק שתי המכירות המתוקנות נרשמו');
  });

  it('תקרה: אחראי עד 10% – 15% עם אישור אחראי נדחה; posAuth: need:"manager" רק מעלה', async () => {
    const ap = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    assert.equal(R(await call('posSale', CASH, sale(tray(15, ap)))), 'ap-scope');
    assert.equal((await get('poslog/' + ap)).used, false, 'מכירה שנדחתה לא מנצלת את האישור');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', pct: 15, by: LEAD, pin: PIN[LEAD] })), 'need-manager');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', pct: 5, by: LEAD, pin: PIN[LEAD], need: 'manager' })), 'need-manager');
  });

  it('ליקוי 2: תוקף 30 דקות לפי שעון השרת – מכירה מקוונת נדחית גם כש-soldAt נשלח ליד זמן האישור; אישור שנוצר אחרי המכירה – נדחה; בן 29 דקות למכירה שנשמרה קודם – עובר', async () => {
    const old = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    await age(old, 5 * DAY);
    assert.equal(R(await call('posSale', CASH, sale(tray(10, old, { soldAt: Date.now() - 5 * DAY + 1000 })))), 'ap-old');
    const o31 = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    await age(o31, 31 * 60000);
    assert.equal(R(await call('posSale', CASH, sale(tray(10, o31, { soldAt: Date.now() - 31 * 60000 + 5000 })))), 'ap-old');
    assert.equal(R(await call('posSale', CASH, sale(tray(10, o31, { soldAt: Date.now() - 31 * 60000 + 5000, off: false, rs: false })))), 'ap-old');
    const late = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    assert.equal(R(await call('posSale', CASH, sale(tray(10, late, { soldAt: Date.now() - 10 * 60000, off: true })))), 'ap-bad', 'האישור ניתן אחרי רגע המכירה');
    const ok = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    await age(ok, 29 * 60000);
    const r = await call('posSale', CASH, sale(tray(10, ok, { soldAt: Date.now() - 20 * 60000, off: true })));
    assert.equal(R(r), 'ok', r.msg);
    const ra = await appr(CASH, LEAD, 'ret', { ref: r.r.id, amt: 9000 });
    await age(ra, 31 * 60000);
    assert.equal(R(await call('posReturn', CASH, { reqId: reqId(), dev: 'K1', inst: INST1, why: 'x', tag: true, sale: r.r.id, items: [{ i: 0, qty: 1 }], aps: [ra] })), 'ap-old');
  });

  // הכרעת בעל העסק (18.11): מכירה שנגבתה בלי רשת עם אישור שהיה תקף ברגע המכירה, והגיעה אחרי 30 דקות – נרשמת עם apLate
  it('אישור מאוחר: מכירה מהתור (off / rs) עם אישור שהיה תקף ברגע המכירה – נרשמת עם מסמך ומספור רגילים, apLate, התראה למנהל; מעל 72 שעות – apCrit', async () => {
    const a = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    await age(a, 50 * 60000);
    const r = await call('posSale', CASH, sale(tray(10, a, { soldAt: Date.now() - 40 * 60000, off: true })));
    assert.equal(R(r), 'ok', r.msg);
    assert.ok(r.r.docs.length >= 1, 'מסמך מס רשמי'); assert.equal(r.r.seq, 1);
    const s = await get('possale/' + r.r.id);
    assert.equal(s.apLate, true); assert.equal(s.apCrit, undefined); assert.equal(s.chk, undefined);
    assert.deepEqual(s.aps, [{ id: a, by: LEAD, role: 'lead', apLate: true }]);
    assert.equal((await get('poslog/' + a)).used, true);
    const errs = (await all('poserr')).filter((e) => e.code === 'AP_LATE');
    assert.equal(errs.length, 1); assert.equal(errs[0].sev, 'crit'); assert.equal(errs[0].sent, false); assert.equal(errs[0].ctx.sale, r.r.id);
    assert.ok((await all('poslog')).some((x) => x.act === 'apLate' && x.sale === r.r.id));
    // שליחה חוזרת מהתור (rs) של מכירה שהייתה מקוונת – גם מתקבלת
    const b = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    await age(b, 45 * 60000);
    const r2 = await call('posSale', CASH, sale(tray(10, b, { soldAt: Date.now() - 44 * 60000, rs: true })));
    assert.equal(R(r2), 'ok', r2.msg); assert.equal((await get('possale/' + r2.r.id)).apLate, true);
    // 5 ימים – נרשמת, אבל לבדיקה דחופה
    const c = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    await age(c, 5 * DAY);
    const r3 = await call('posSale', CASH, sale(tray(10, c, { soldAt: Date.now() - 5 * DAY + 60000, off: true })));
    assert.equal(R(r3), 'ok', r3.msg);
    const s3 = await get('possale/' + r3.r.id);
    assert.equal(s3.apLate, true); assert.equal(s3.apCrit, true);
    assert.equal((await all('poserr')).filter((e) => e.code === 'AP_LATE72').length, 1);
    // אישור שכבר לא היה תקף ברגע המכירה (soldAt אחרי 30 דקות מהאישור) – נדחה גם מהתור
    const d = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    await age(d, 60 * 60000);
    assert.equal(R(await call('posSale', CASH, sale(tray(10, d, { soldAt: Date.now() - 25 * 60000, off: true })))), 'ap-old');
    assert.equal((await get('poslog/' + d)).used, false);
  });

  it('אישור מאוחר – השרת לא מוותר: אחרי soldAt נדחה; אחוז נמוך יותר נדחה; אישור שנוצל נדחה; קופאי אחר נדחה; מקוונת רגילה עם אישור ישן נדחית', async () => {
    const q = (ap, pct, o) => sale(tray(pct, ap, Object.assign({ soldAt: Date.now() - 40 * 60000, off: true }, o || {})));
    // נוצר אחרי soldAt (יותר מ-2 דקות)
    const after = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    await age(after, 35 * 60000);
    assert.equal(R(await call('posSale', CASH, q(after, 10))), 'ap-bad');
    // אחוז נמוך מההנחה
    const low = await appr(CASH, LEAD, 'disc', { pct: 5, ref: 'cart' });
    await age(low, 50 * 60000);
    assert.equal(R(await call('posSale', CASH, q(low, 10))), 'ap-scope');
    // אישור שכבר נוצל
    const used = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    assert.equal(R(await call('posSale', CASH, sale(tray(10, used)))), 'ok');
    await age(used, 50 * 60000);
    assert.equal(R(await call('posSale', CASH, q(used, 10))), 'ap-used');
    // אישור שניתן לקופאי אחר
    const other = await appr(LEAD, MGR, 'disc', { pct: 10, ref: 'cart' });
    await age(other, 50 * 60000);
    assert.equal(R(await call('posSale', CASH, q(other, 10))), 'ap-bad');
    // אותו אישור ישן, מכירה מקוונת רגילה (בלי off ובלי rs) – נדחית כמו קודם
    const old = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    await age(old, 50 * 60000);
    assert.equal(R(await call('posSale', CASH, q(old, 10, { off: false }))), 'ap-old');
    assert.equal((await get('poslog/' + old)).used, false);
    for (const x of [after, low, other]) assert.equal((await get('poslog/' + x)).used, false);
    assert.ok((await all('possale')).every((x) => !x.apLate), 'שום מכירה מאוחרת לא נרשמה');
    // rs שאינו בוליאני – קלט לא תקין
    assert.equal(R(await call('posSale', CASH, q(old, 10, { rs: 1 }))), 'bad-input');
  });

  it('אישור של עסק אחר – לא נמצא בעסק הזה ונדחה', async () => {
    const ap = await appr(CASH, LEAD, 'disc', { pct: 10, ref: 'cart' });
    const B = 'biz-pos-b';
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('b/' + B), { name: B, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { orders: true, pos: true } });
      b.set(d.doc(`b/${B}/staff/${CASH}`), { name: 'קופאית', role: 'employee', active: true, perms: W({ pos: true }) });
      b.set(d.doc(`b/${B}/poscfg/main`), { type: 'general', v: {} });
      b.set(d.doc(`b/${B}/posdev/K1`), { name: 'קופה', code: 'K1', br: 'b1', on: true, st: 'active', inst: INST1, lastSeq: 0, at: 1, appr: { by: 'seed', at: 1 } });
      b.set(d.doc(`b/${B}/prod/pm`), { name: 'מגש', price: 100, minP: 90, q: { b1: 9 } });
      b.set(d.doc('users/' + CASH), { bizId: B, role: 'worker', active: true, bizStatus: 'active', email: CASH + '@x.invalid', createdAt: 1 });
      await b.commit();
    });
    assert.equal(R(await call('posSale', CASH, sale(tray(10, ap)))), 'ap-bad');
    assert.equal((await get('poslog/' + ap)).used, false);
  });

  it('החזרה: בלי אישור – נדחה; אישור אחראי למכירה ולסכום – עובר; אישור למכירה אחרת / לסכום קטן – נדחה; 250 ₪ – מנהל', async () => {
    const s = await sell(CASH, { lines: [L({ qty: 6 })], pays: [{ m: 'cash', amt: 29940 }] });
    const other = await sell(CASH);
    const ret = (o) => Object.assign({ reqId: reqId(), dev: 'K1', inst: INST1, why: 'לא מתאים', tag: true, sale: s.id, items: [{ i: 0, qty: 1 }] }, o);
    assert.equal(R(await call('posReturn', CASH, ret())), 'ret-lead');
    assert.equal(R(await call('posReturn', CASH, ret({ aps: ['FakeApproval12345678'] }))), 'ap-bad');
    const discAp = await appr(CASH, LEAD, 'disc', { pct: 5, ref: 'cart' });
    assert.equal(R(await call('posReturn', CASH, ret({ aps: [discAp] }))), 'ap-bad');
    const wrongSale = await appr(CASH, MGR, 'ret', { ref: other.id, amt: 100000 });
    assert.equal(R(await call('posReturn', CASH, ret({ aps: [wrongSale] }))), 'ap-scope', 'אישור למכירה אחרת');
    const small = await appr(CASH, LEAD, 'ret', { ref: s.id, amt: 1000 });
    assert.equal(R(await call('posReturn', CASH, ret({ aps: [small] }))), 'ap-scope', 'סכום גדול ממה שאושר');
    const noAmt = await appr(CASH, MGR, 'ret', { ref: s.id });
    assert.equal(R(await call('posReturn', CASH, ret({ aps: [noAmt] }))), 'ap-scope', 'אישור בלי סכום');
    const a1 = await appr(CASH, LEAD, 'ret', { ref: s.id, amt: 4990 });
    const o1 = ret({ aps: [a1] });
    const r1 = await call('posReturn', CASH, o1);
    assert.equal(R(r1), 'ok', r1.msg); assert.equal(r1.r.docs[0].t, 'cr');
    assert.deepEqual((await get('posret/' + r1.r.id)).aps, [{ id: a1, by: LEAD, role: 'lead' }]);
    const d1 = await call('posReturn', CASH, o1);
    assert.equal(R(d1), 'ok'); assert.equal(d1.r.dup, true); assert.equal(d1.r.id, r1.r.id);
    assert.equal(R(await call('posReturn', CASH, ret({ aps: [a1] }))), 'ap-used');
    const a2 = await appr(CASH, LEAD, 'ret', { ref: s.id, amt: 5 * 4990 });
    assert.equal(R(await call('posReturn', CASH, ret({ items: [{ i: 0, qty: 5 }], aps: [a2] }))), 'ret-mgr');
    const a3 = await appr(CASH, MGR, 'ret', { ref: s.id, amt: 5 * 4990, need: 'manager' });
    const r3 = await call('posReturn', CASH, ret({ items: [{ i: 0, qty: 5 }], aps: [a3] }));
    assert.equal(R(r3), 'ok'); assert.equal(r3.r.amt, 5 * 4990);
    assert.equal((await all('posret', ['sale', s.id])).length, 2);
  });
});

describe('POS:W2 – החזרה מהקופה (pos-data.returnSrv → posReturn) ומבצע לפי קטגוריה', () => {
  const path = require('node:path');
  const W = path.join(__dirname, '..', '..', 'app-source', 'www');
  const OFF = require(path.join(W, 'pos-offline.js'));
  const PDC = require(path.join(W, 'pos-data.js'));
  const PPW = require(path.join(W, 'pos-promo.js'));
  beforeEach(seed);
  function device(uid) {
    const net = { up: true, lose: 0, n: 0 };
    const D = PDC.create({
      store: OFF.memStore(), key: 'lp-pos:' + A, timer: { set: (f) => setTimeout(f, 1), clear: clearTimeout },
      dev: () => 'K1', inst: () => INST1, br: () => 'b1', cashier: () => ({ id: uid, name: 'x' }), online: () => net.up,
      call: async (fn, data) => {
        if (!net.up) { const e = new Error('אין חיבור לאינטרנט'); e.offline = true; throw e; }
        const r = await call(fn, uid, JSON.parse(JSON.stringify(data)));
        if (!r.ok) { const e = new Error(r.msg); e.code = r.code; e.details = { reason: r.reason }; throw e; }
        if (net.lose && ++net.n % 2 === 1) { const e = new Error('אין חיבור לאינטרנט'); e.offline = true; throw e; } // השרת רשם, התשובה אבדה
        return r.r;
      },
      devSeq: async () => (await get('posdev/K1')).lastSeq || 0,
      loadProducts: async () => (await all('prod')).map((p) => Object.assign({}, p, { id: p._id })),
    });
    return { D, net };
  }
  const drain = async (D) => { for (let i = 0; i < 300 && (D.net().pending || D.retPending()); i++) { await D.flush(); await new Promise((r) => setTimeout(r, 3)); } };
  const devSale = (unit, qty, m) => ({ lines: [{ pid: 'p1', name: 'מטען', price: unit, qty, total: unit * qty }], total: unit * qty, pays: [{ m: m || 'cash', amt: unit * qty }] });

  it('עם רשת: הקבלה מקבלת מספר מסמך; החזרה – חשבונית זיכוי; אותה בקשה פעמיים – החזרה אחת; יותר ממה שנשאר / יותר ממה ששולם באמצעי – נדחה', async () => {
    const { D } = device(LEAD);
    const r = await D.saveSale(devSale(4990, 2));
    await drain(D);
    const sl = await D.getSale(r.no);
    assert.equal(sl.srvId, 'K1-000001'); assert.equal(sl.docs[0].t, 'ir'); assert.ok(sl.docs[0].no != null, 'מספר המסמך הרשמי');
    const o = { reqId: 'rqret00000001x', sale: sl.srvId, saleReq: sl.reqId, saleNo: sl.no, items: [{ i: 0, qty: 1 }], why: 'לא מתאים', tag: true, refunds: [{ m: 'cash', amt: 4990 }], lines: [{ pid: 'p1', qty: 1 }], total: 4990 };
    const a = await D.returnSrv(o);
    assert.equal(a.res.id, 'K1-R000001'); assert.equal(a.res.amt, 4990); assert.equal(a.res.docs[0].t, 'cr');
    const b = await D.returnSrv(o); // לחיצה כפולה / שליחה חוזרת
    assert.equal(b.res.id, 'K1-R000001');
    assert.equal((await all('posret')).length, 1);
    await assert.rejects(D.returnSrv(Object.assign({}, o, { reqId: 'rqret00000002x', items: [{ i: 0, qty: 2 }], refunds: [{ m: 'cash', amt: 9980 }] })), (e) => e.reason === 'ret-qty');
    await assert.rejects(D.returnSrv(Object.assign({}, o, { reqId: 'rqret00000003x', refunds: [{ m: 'cash', amt: 5990 }] })), (e) => e.reason === 'ret-sum');
    assert.equal(D.retPending(), 0, 'החזרה שנדחתה לא נשארת בתור');
    const ok2 = await D.returnSrv(Object.assign({}, o, { reqId: 'rqret00000004x' }));
    assert.equal(ok2.res.id, 'K1-R000002');
    await assert.rejects(D.returnSrv(Object.assign({}, o, { reqId: 'rqret00000005x' })), (e) => e.reason === 'ret-qty'); // כבר הוחזר הכול
    const s = await get('possale/K1-000001');
    assert.deepEqual(s.retQty, [2]); assert.equal(s.retAmt[0], 9980); assert.deepEqual(s.retByM, { cash: 9980 });
  });

  it('בלי רשת: מכירה והחזרה נכנסות לתור; כשהרשת חוזרת – המכירה קודם, ההחזרה אחריה עם אותו reqId, גם כשהתשובות הולכות לאיבוד – בלי כפילות', async () => {
    const { D, net } = device(LEAD);
    net.up = false;
    const r = await D.saveSale(devSale(4990, 1));
    const sl = await D.getSale(r.no);
    assert.equal(sl.docs, undefined, 'בלי רשת אין עדיין מסמך – הקבלה "ממתין למסמך"');
    const p = await D.returnSrv({ sale: sl.id, saleReq: sl.reqId, saleNo: sl.no, items: [{ i: 0, qty: 1 }], why: 'לא מתאים', tag: true, lines: [{ pid: 'p1', qty: 1 }], total: 4990 });
    assert.equal(p.pend, true); assert.equal(D.retPending(), 1);
    net.up = true; net.lose = 1; D.netChanged(true);
    await drain(D);
    assert.equal(D.retPending(), 0);
    const it = D.retItem(p.reqId);
    assert.equal(it.st, 'ok'); assert.equal(it.res.id, 'K1-R000001'); assert.equal(it.res.docs[0].t, 'cr');
    assert.equal((await all('possale')).length, 1); assert.equal((await all('posret')).length, 1);
    assert.equal((await get('posret/K1-R000001')).reqId, p.reqId);
    assert.ok((await D.getSale(r.no)).docs.length, 'המסמך הגיע כשהרשת חזרה');
  });

  it('מבצע על קטגוריה: הקטגוריה מ-pos-data (prod.cat) – הסכום במכשיר זהה לשרת; בלי קטגוריה – המכשיר טועה והשרת דוחה', async () => {
    await set('promo/cat1', { type: 'pct', pct: 20, cats: ['c1'], on: true, n: 'קטגוריה' });
    const promos = (await all('promo')).map((x) => Object.assign({}, x, { id: x._id }));
    const prod = PDC.toProd(Object.assign({ id: 'p1' }, await get('prod/p1')), 'b1');
    assert.equal(prod.cat, 'c1');
    const devGross = (withCat) => {
      const r = PPW.apply([{ pid: prod.id, cat: withCat ? prod.cat : undefined, qty: 2, unit: prod.price }], promos, { at: Date.now() });
      return prod.price * 2 - r.lines[0].pdisc;
    };
    const g = devGross(true);
    assert.equal(g, 9980 - 1996);
    const r = await call('posSale', CASH, sale({ lines: [L({ qty: 2 })], gross: g, pays: [{ m: 'cash', amt: g }] }));
    assert.equal(R(r), 'ok', r.msg); assert.equal(r.r.gross, g);
    const bad = devGross(false);
    assert.equal(bad, 9980);
    assert.equal(R(await call('posSale', CASH, sale({ lines: [L({ qty: 2 })], gross: bad, pays: [{ m: 'cash', amt: bad }] }))), 'bad-total');
  });
});

// ---------------------------------------------------------------------------------
// 18.11.2026 – הכרעת בעל העסק: רק מנהל־על מחליט מי מקבל קופה, כולל מנהלים. שאר ההרשאות של מנהל לא השתנו.
describe('קופה למנהל – רק לפי המתג שמנהל־על הדליק (pos / posMgr)', () => {
  const AG = require('../functions/lib/pos-agg');
  const core = (f) => require('../functions/' + f)._core;
  const wrapCall = async (fn, uid, data) => { try { return { ok: true, r: await fn(req(uid, data)) }; } catch (e) { return { ok: false, reason: e.details && e.details.reason, msg: e.message }; } };
  const auth = (uid, data) => wrapCall(core('pos-auth.js').call(), uid, data);
  const cashF = (uid, data) => wrapCall(core('pos-cash.js').call(), uid, data);
  const bizF = (fn, uid, data) => wrapCall(core('business.js')[fn], uid, data);
  const pin = async (u, p) => { const h = AG.pinHash(p); await set('pospin/' + u, { h: h.h, s: h.s, fails: 0, lockUntil: 0, upd: 1 }); };
  beforeEach(seed);

  it('מנהל בלי pos: לא מוכר ולא פותח את הקופה (מכירה, כניסה בקוד, פתיחת משמרת, עגלה מושהית) – בשרת', async () => {
    assert.equal(R(await call('posSale', MGR0, sale())), 'not-pos');
    assert.equal(R(await call('posPark', MGR0, { op: 'list', dev: 'K1' })), 'not-pos');
    await pin(MGR0, '7391');
    assert.equal(R(await auth(MGR0, { op: 'verify', pin: '7391' })), 'not-pos');
    assert.equal(R(await cashF(MGR0, { op: 'open', dev: 'K1', inst: INST1 })), 'not-pos');
    assert.equal((await all('possale')).length, 0);
    // קופאי לא יכול לבחור את המנהל בלי הקופה כמי שנכנס / מאשר
    assert.equal(R(await auth(CASH, { op: 'verify', uid: MGR0, pin: '7391' })), 'no-user');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'void', by: MGR0, pin: '7391' })), 'no-user');
    const l = await auth(CASH, { op: 'leads' });
    assert.ok(!l.r.staff.some((x) => x.uid === MGR0));
  });

  it('שאר ההרשאות של מנהל בלי pos לא השתנו: ניהול מבצעים, קוד אישי, וקריאת מכירות במסך הניהול', async () => {
    assert.equal(R(await call('posPromo', MGR0, { op: 'set', p: { n: '1+1', type: 'bxgy', buy: ['p1'], get: ['p1'], on: true, from: '2026-11-01', to: '2026-12-31' } })), 'ok');
    assert.equal(R(await auth(MGR0, { op: 'set', pin: '2580' })), 'ok');
    const s = await sell(CASH);
    await assertSucceeds(fsu(MGR0).doc(P('possale/' + s.id)).get());
    await assertSucceeds(fsu(MGR0).collection(P('posdev')).get());
    await assertSucceeds(fsu(MGR0).collection(P('promo')).get());
  });

  it('כללים: מנהל בלי pos לא קורא עגלות מושהות של הקופה; מנהל עם posMgr – כן; מנהל עם pos בלבד – רק את שלו', async () => {
    assert.equal(R(await call('posPark', CASH, { op: 'save', dev: 'K1', id: 'park0001', name: 'עגלה', lines: [L()] })), 'ok');
    const pk = (await all('pospark'))[0]._id;
    await assertFails(fsu(MGR0).doc(P('pospark/' + pk)).get());
    await assertSucceeds(fsu(MGR).doc(P('pospark/' + pk)).get());
    await set(`admins/${MGR0}`, { perms: { pos: true, posMgr: false } }, true);
    await assertFails(fsu(MGR0).doc(P('pospark/' + pk)).get());
    assert.equal(R(await call('posPark', MGR0, { op: 'save', dev: 'K1', id: 'park0002', name: 'שלי', lines: [L()] })), 'ok');
    const mine = (await all('pospark', ['cashier', MGR0]))[0]._id;
    await assertSucceeds(fsu(MGR0).doc(P('pospark/' + mine)).get());
  });

  it('מנהל עם pos (שמנהל־על הדליק) מוכר; אישור "מנהל" בקופה דורש גם posMgr', async () => {
    assert.equal(R(await bizF('setStaffPerms', SUPER, { bizId: A, uid: MGR0, perms: { pos: true } })), 'ok');
    assert.deepEqual((await get(`admins/${MGR0}`)).perms, { pos: true, posMgr: false });
    const s = await sell(MGR0);
    assert.equal((await get('possale/' + s.id)).cashier, MGR0);
    await pin(MGR0, '7391');
    assert.equal((await auth(MGR0, { op: 'verify', pin: '7391' })).r.role, 'cashier');
    // pos בלבד: לא מאשר כמנהל, וגם לא כאחראי
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'void', by: MGR0, pin: '7391' })), 'need-lead');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', pct: 40, by: MGR0, pin: '7391', need: 'manager' })), 'need-manager');
    // posMgr דלוק = מנהל בקופה, כולל אישור "מנהל"
    assert.equal(R(await bizF('setStaffPerms', SUPER, { bizId: A, uid: MGR0, perms: { posMgr: true } })), 'ok');
    assert.deepEqual((await get(`admins/${MGR0}`)).perms, { pos: true, posMgr: true });
    const ok = await auth(CASH, { op: 'approve', act: 'disc', pct: 40, by: MGR0, pin: '7391', need: 'manager' });
    assert.equal(R(ok), 'ok', ok.msg); assert.equal(ok.r.role, 'manager');
  });

  it('רק מנהל־על מדליק קופה: מנהל עסק לא מדליק pos לעצמו או לעובד; אין קיצור דרך מהאפליקציה', async () => {
    for (const uid of [MGR0, CASH, LEAD]) {
      assert.equal(R(await bizF('setStaffPerms', MGR, { bizId: A, uid, perms: { pos: true } })), 'not-superadmin');
      assert.equal(R(await bizF('setStaffPerms', MGR0, { bizId: A, uid, perms: { pos: true, posMgr: true } })), 'not-superadmin');
    }
    assert.equal((await get(`admins/${MGR0}`)).perms, undefined);
    // כתיבה ישירה למסמכי admins / staff – נחסמת בחוקים
    await assertFails(fsu(MGR0).doc(P('admins/' + MGR0)).set({ perms: { pos: true } }, { merge: true }));
    await assertFails(fsu(MGR).doc(P('staff/' + CASH)).set({ perms: { pos: true } }, { merge: true }));
    // רשימת המנהלים (מסך העובדים) – רק מנהל־על
    await assertFails(fsu(MGR).collection(P('admins')).get());
    await assertSucceeds(fsu(SUPER).collection(P('admins')).get());
    // מנהל־על: רק pos / posMgr למנהל; הרשאה אחרת למנהל – is-admin, ולא השתנה כלום
    assert.equal(R(await bizF('setStaffPerms', SUPER, { bizId: A, uid: MGR0, perms: { sal: true } })), 'is-admin');
    assert.equal(R(await bizF('setStaffPerms', SUPER, { bizId: A, uid: MGR0, perms: { pos: 'yes' } })), 'is-admin');
    assert.equal(R(await bizF('setStaffPerms', SUPER, { bizId: A, uid: MGR0, rank: 'x', perms: { pos: true } })), 'is-admin');
    assert.equal((await get(`admins/${MGR0}`)).perms, undefined);
    assert.equal(R(await bizF('setStaffPerms', SUPER, { bizId: A, uid: MGR0, perms: { pos: true, posMgr: false } })), 'ok');
    assert.equal(R(await call('posSale', MGR0, sale())), 'ok');
    // כיבוי – שוב אין קופה
    assert.equal(R(await bizF('setStaffPerms', SUPER, { bizId: A, uid: MGR0, perms: { pos: false } })), 'ok');
    assert.equal(R(await call('posSale', MGR0, sale())), 'not-pos');
  });

  it('הנפקת כרטיס מתנה / פתק זיכוי: מנהל בלי posMgr נדחה; עם posMgr ומנהל־על – מצליח; קופון – כל מנהל', async () => {
    const issue = { op: 'issue', type: 'voucher', amt: 500, why: 'פתק ישן' };
    const gsell = () => ({ op: 'sell', reqId: reqId(), dev: 'K1', inst: INST1, amt: 1000, pays: [{ m: 'cash', amt: 1000 }] });
    for (const perms of [undefined, { pos: true, posMgr: false }]) {
      if (perms) await set(`admins/${MGR0}`, { perms }, true);
      assert.equal(R(await call('posGift', MGR0, issue)), 'not-posmgr');
      assert.equal(R(await call('posGift', MGR0, gsell())), perms ? 'not-posmgr' : 'not-pos'); // בלי מתג בכלל – אין קופה
    }
    assert.equal((await all('posgift')).length, 0);
    // קופון – כל מנהל, כמו היום
    assert.equal(R(await call('posCouponUse', MGR0, { op: 'issue', cust: 'c1', disc: { type: 'pct', pct: 10 } })), 'ok');
    // posMgr דלוק – מצליח
    await set(`admins/${MGR0}`, { perms: { pos: true, posMgr: true } }, true);
    assert.equal(R(await call('posGift', MGR0, issue)), 'ok');
    assert.equal(R(await call('posGift', MGR0, gsell())), 'ok');
    assert.equal(R(await call('posGift', MGR, issue)), 'ok');
    assert.equal(R(await call('posGift', SUPER, Object.assign({ bizId: A }, issue))), 'ok');
    assert.equal((await all('posgift')).length, 4);
  });

  it('מנהל־על שנכנס לעסק – כמו היום: מוכר ומאשר כמנהל בלי מתג', async () => {
    assert.equal(R(await call('posSale', SUPER, Object.assign(sale(), { bizId: A }))), 'ok');
  });
});
