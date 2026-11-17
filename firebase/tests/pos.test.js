'use strict';
// קופה (POS) שלב 0 (17.11.2026): כללי Firestore לאוספי הקופה, posCfg / posCfgSet / posDev / posSale, וספר המסמכים עם קוד קופה – מול האמולטור.
// הפונקציות רצות בתוך תהליך הבדיקה (כמו daily-rep.test.js). מכסה את בדיקות שלב 0 בתוכנית:
//   (1) כתיבה ישירה לכל אוסף pos* נדחית; (2) קופאי לא קורא p/cost; (3) אותה מכירה פעמיים = מסמך אחד; (4) 100 מכירות במקביל = 1–100;
//   (6) מתג כבוי = אין גישה ואין פעולה; (7) K1 ו-K2 עם אותו מספר – מזהי ardoc שונים, ובלי dev – כמו היום; (8) קוד שפרש לא חוזר;
//   (9) מזהה תרגול (-T) נדחה. בדיקה (5) – ב-pos-calc.unit.test.js.
process.env.FUNCTIONS_EMULATOR = 'true';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-pos', OFF = 'biz-posoff', O = 'biz-pos2';
const SUPER = 'pos_super', MGR = 'pos_mgr', CASH = 'pos_cash', CASH2 = 'pos_cash2', LEAD = 'pos_lead', ORD = 'pos_ord', OLD = 'pos_old', NOPOS = 'pos_none', DIS = 'pos_dis';
const FMGR = 'pos_fmgr', OMGR = 'pos_omgr', LEG = 'pos_legacy';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };
const W = (o) => Object.assign({}, NONE, o);
// כל אוספי הקופה החדשים (תוכנית, פרק "הנתונים" 5.3) + posreq
const COLLS = ['possale', 'pospay', 'posret', 'posshift', 'posz', 'posdev', 'promo', 'clubcfg', 'clublog', 'poscfg', 'poslog', 'posgift', 'posgiftlog', 'posclock', 'posimp', 'pos_income_daily', 'posreq'];
const INST1 = 'inst_aaaaaaaaaaaaaaaa', INST2 = 'inst_bbbbbbbbbbbbbbbb';

let env, PS, ARD, T, getFirestore;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const fs = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function count(coll) { let n = 0; await prep(async (d) => { n = (await d.collection(coll).get()).size; }); return n; }
const req = (uid, data) => ({ auth: uid ? { uid, token: { email: uid + '@x.invalid' } } : undefined, data: data || {} });
async function call(fn, uid, data) {
  const keep = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data;
  try { return { ok: true, r: await PS.call[fn]()(req(uid, data)), req: keep }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message, req: keep }; }
}
const R = (r) => (r.ok ? 'ok' : r.reason);
let rq = 0;
const reqId = () => 'rq' + String(++rq).padStart(8, '0') + 'x';
const line = (o) => Object.assign({ pid: 'p1', n: 'מטען USB-C', qty: 2, unit: 4990 }, o || {});
const sale = (o) => Object.assign({ reqId: reqId(), dev: 'K1', inst: INST1, lines: [line()], soldAt: Date.now() - 1000 }, o || {});

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    const biz = (id, f) => b.set(d.doc('b/' + id), { name: id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: f });
    biz(A, { orders: true, pos: true }); biz(OFF, { orders: true }); biz(O, { orders: true, pos: true });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'מנהל', role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${CASH}`), { name: 'קופאית', role: 'employee', active: true, perms: W({ pos: true }) });
    b.set(d.doc(`b/${A}/staff/${CASH2}`), { name: 'קופאי', role: 'employee', active: true, perms: W({ pos: true }) });
    b.set(d.doc(`b/${A}/staff/${LEAD}`), { name: 'אחראי', role: 'employee', active: true, br: ['b1'], perms: W({ posMgr: true }) });
    b.set(d.doc(`b/${A}/staff/${ORD}`), { name: 'הזמנות', role: 'employee', active: true, perms: W({ ord: true }) });
    b.set(d.doc(`b/${A}/staff/${OLD}`), { name: 'ותיק', role: 'employee', active: true }); // בלי perms – ord כן, pos לא
    b.set(d.doc(`b/${A}/staff/${NOPOS}`), { name: 'בלי', role: 'employee', active: true, perms: NONE });
    b.set(d.doc(`b/${A}/staff/${DIS}`), { name: 'מושבת', role: 'employee', active: false, perms: W({ pos: true, posMgr: true }) });
    b.set(d.doc(`b/${OFF}/admins/${FMGR}`), { email: 'f@x.invalid' });
    b.set(d.doc(`b/${O}/admins/${OMGR}`), { email: 'o@x.invalid' });
    for (const [u, z, role, active] of [[MGR, A, 'admin', true], [CASH, A, 'worker', true], [CASH2, A, 'worker', true], [LEAD, A, 'worker', true], [ORD, A, 'worker', true],
      [OLD, A, 'worker', true], [NOPOS, A, 'worker', true], [DIS, A, 'worker', false], [FMGR, OFF, 'admin', true], [OMGR, O, 'admin', true]]) {
      b.set(d.doc('users/' + u), { bizId: z, role, active, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    }
    // לארג' פעמי במצב legacy (שורש), עם התוספת מופעלת – השרת חייב לדחות, ואין כללים בשורש
    b.set(d.doc('b/largpeami'), { name: 'ל', status: 'active', dataRoot: 'legacy', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { orders: true, pos: true } });
    b.set(d.doc('admins/' + LEG), { email: 'l@x.invalid' });
    // מוצר עם עלות
    for (const z of [A, OFF]) {
      b.set(d.doc(`b/${z}/prod/p1`), { name: 'מטען USB-C', price: 49.9, barcode: '7290000000017', on: true, q: { b1: 5 } });
      b.set(d.doc(`b/${z}/prod/p1/p/cost`), { cost: 20 });
      b.set(d.doc(`b/${z}/cat/c1`), { name: 'אביזרים', ord: 1 });
      // מסמך קיים בכל אוסף קופה (לבדיקת עדכון / מחיקה / קריאה)
      for (const c of COLLS) b.set(d.doc(`b/${z}/${c}/x1`), { br: 'b1', cashier: CASH, who: CASH, at: 1 });
      b.set(d.doc(`b/${z}/poscfg/main`), { type: 'general', v: {} });
      b.set(d.doc(`b/${z}/possale/x2`), { br: 'b2', cashier: CASH2, at: 1 });
    }
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  PS = require('../functions/pos.js')._core;
  ARD = require('../functions/lib/ar-doc.js');
  T = require('../functions/lib/tenant.js');
  getFirestore = require(require.resolve('firebase-admin/firestore', { paths: [path.join(H.ROOT, 'functions')] })).getFirestore;
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

// ---------------------------------------------------------------------------------
describe('pos – כללי Firestore', () => {
  beforeEach(seed);

  it('(1) כתיבה ישירה לכל אוסף pos* נדחית – לכל תפקיד, גם מנהל ומנהל־על', async () => {
    for (const u of [SUPER, MGR, CASH, LEAD, ORD]) {
      for (const c of COLLS) {
        const db = fs(u);
        await assertFails(db.doc(`b/${A}/${c}/new1`).set({ br: 'b1', cashier: u, at: 1 }));
        await assertFails(db.doc(`b/${A}/${c}/x1`).update({ at: 2 }));
        await assertFails(db.doc(`b/${A}/${c}/x1`).delete());
      }
    }
    // בשורש (legacy) – אין כללי קופה כלל
    for (const c of COLLS) await assertFails(fs(LEG).doc(`${c}/new1`).set({ at: 1 }));
  });

  it('(2) קופאי קורא מוצרים וקטגוריות, אבל לא עלות (p/cost); עובד הזמנות ומנהל – כן', async () => {
    await assertSucceeds(fs(CASH).doc(`b/${A}/prod/p1`).get());
    await assertSucceeds(fs(CASH).doc(`b/${A}/cat/c1`).get());
    await assertFails(fs(CASH).doc(`b/${A}/prod/p1/p/cost`).get());
    await assertFails(fs(LEAD).doc(`b/${A}/prod/p1/p/cost`).get());
    await assertFails(fs(CASH).doc(`b/${A}/prod/p1/p/ws`).get());
    await assertSucceeds(fs(ORD).doc(`b/${A}/prod/p1/p/cost`).get());
    await assertSucceeds(fs(OLD).doc(`b/${A}/prod/p1/p/cost`).get());
    await assertSucceeds(fs(MGR).doc(`b/${A}/prod/p1/p/cost`).get());
    await assertFails(fs(NOPOS).doc(`b/${A}/prod/p1`).get());
  });

  it('קריאה: קופאי – רק המכירות שלו; אחראי – הסניף שלו; מנהל – הכול; בלי הרשאה / מושבת – כלום', async () => {
    await assertSucceeds(fs(CASH).doc(`b/${A}/possale/x1`).get());
    await assertFails(fs(CASH).doc(`b/${A}/possale/x2`).get());
    await assertSucceeds(fs(CASH).collection(`b/${A}/possale`).where('cashier', '==', CASH).get());
    await assertFails(fs(CASH).collection(`b/${A}/possale`).get());
    await assertSucceeds(fs(LEAD).doc(`b/${A}/possale/x1`).get());
    await assertFails(fs(LEAD).doc(`b/${A}/possale/x2`).get());
    await assertSucceeds(fs(MGR).doc(`b/${A}/possale/x2`).get());
    await assertSucceeds(fs(MGR).collection(`b/${A}/possale`).get());
    for (const u of [NOPOS, DIS, ORD, OLD, OMGR]) await assertFails(fs(u).doc(`b/${A}/possale/x1`).get());
    // אחראי בלבד: תשלומים, החזרות, Z; קופאי – לא
    for (const c of ['pospay', 'posret', 'posz', 'clublog']) { await assertFails(fs(CASH).doc(`b/${A}/${c}/x1`).get()); await assertSucceeds(fs(LEAD).doc(`b/${A}/${c}/x1`).get()); }
    // מנהל בלבד: יומן, ייבוא, הכנסה יומית, יומן כרטיס מתנה
    for (const c of ['poslog', 'posimp', 'pos_income_daily', 'posgiftlog']) { await assertFails(fs(LEAD).doc(`b/${A}/${c}/x1`).get()); await assertSucceeds(fs(MGR).doc(`b/${A}/${c}/x1`).get()); }
    // כל מי שמוכר: מכשירים, מבצעים, מועדון, כרטיס מתנה, הגדרות
    for (const c of ['posdev', 'promo', 'clubcfg', 'posgift']) await assertSucceeds(fs(CASH).doc(`b/${A}/${c}/x1`).get());
    await assertSucceeds(fs(CASH).doc(`b/${A}/poscfg/main`).get());
    await assertFails(fs(CASH).doc(`b/${A}/poscfg/x1`).get());
    await assertFails(fs(MGR).doc(`b/${A}/posreq/x1`).get());
    await assertSucceeds(fs(CASH).doc(`b/${A}/posclock/x1`).get());
    await assertFails(fs(CASH2).doc(`b/${A}/posclock/x1`).get());
  });

  it('(6) מתג כבוי – אין גישה לאף אוסף קופה ולא למוצרים דרך הקופה, גם למנהל', async () => {
    for (const c of COLLS) await assertFails(fs(FMGR).doc(`b/${OFF}/${c}/x1`).get());
    // המוצרים – רק כמו היום (מנהל עם התוספת orders)
    await assertSucceeds(fs(FMGR).doc(`b/${OFF}/prod/p1`).get());
  });
});

describe('pos – הגדרות (posCfg, posCfgSet)', () => {
  beforeEach(seed);

  it('ברירות מחדל; מנהל משנה הגדרות מנהל בלבד; מנהל־על – סוג עסק והכול, עם audit', async () => {
    let r = await call('posCfg', CASH);
    assert.equal(R(r), 'ok');
    assert.equal(r.r.type, 'general');
    assert.deepEqual(r.r.cfg.discMax, { cashier: 5, lead: 15 });
    assert.equal(r.r.who, 'staff');
    assert.equal(R(await call('posCfgSet', MGR, { set: { discMax: { lead: 20 }, retDays: 30 } })), 'ok');
    assert.equal(R(await call('posCfgSet', MGR, { set: { vatRate: 17 } })), 'not-allowed');
    assert.equal(R(await call('posCfgSet', MGR, { type: 'disposables' })), 'not-allowed');
    assert.equal(R(await call('posCfgSet', MGR, { set: { nope: 1 } })), 'unknown-key');
    assert.equal(R(await call('posCfgSet', MGR, { set: { lockMin: -1 } })), 'bad-value');
    assert.equal(R(await call('posCfgSet', CASH, { set: { retDays: 1 } })), 'not-manager');
    r = await call('posCfgSet', SUPER, { bizId: A, type: 'disposables', set: { cashMax: 500000 } });
    assert.equal(R(r), 'ok');
    assert.equal(r.r.type, 'disposables');
    const d = await get(`b/${A}/poscfg/main`);
    assert.deepEqual(d.v, { discMax: { lead: 20 }, retDays: 30, cashMax: 500000 });
    assert.equal(d.type, 'disposables');
    let audits = 0;
    await prep(async (db) => { audits = (await db.collection(`b/${A}/audit`).where('act', '==', 'posCfgSet').get()).size; });
    assert.equal(audits, 1);
    r = await call('posCfg', LEAD);
    assert.deepEqual([r.r.cfg.discMax.lead, r.r.cfg.retDays, r.r.cfg.cashMax, r.r.src.cashMax], [20, 30, 500000, 'biz']);
  });

  it('(6) מתג כבוי: מנהל העסק נדחה; מנהל־על יכול להכין הגדרות מראש; legacy ועובד בלי הרשאה נדחים', async () => {
    assert.equal(R(await call('posCfg', FMGR)), 'feature-off');
    assert.equal(R(await call('posCfgSet', FMGR, { set: { retDays: 1 } })), 'feature-off');
    assert.equal(R(await call('posCfgSet', SUPER, { bizId: OFF, type: 'grocery' })), 'ok');
    assert.equal(R(await call('posCfg', LEG)), 'legacy');
    assert.equal(R(await call('posCfg', NOPOS)), 'not-pos');
    assert.equal(R(await call('posCfg', OLD)), 'not-pos');
    assert.equal(R(await call('posCfg', DIS)), 'staff-disabled');
  });
});

describe('pos – קופות ומכשירים (posDev)', () => {
  beforeEach(seed);

  it('(8) הוספה, רישום מכשיר אחד לקופה, פרישה עם קופה חלופית – קוד שפרש לא ניתן שוב', async () => {
    assert.equal(R(await call('posDev', CASH, { op: 'add', name: 'קופה 1', br: 'b1' })), 'not-manager');
    let r = await call('posDev', MGR, { op: 'add', name: 'קופה 1', br: 'b1' });
    assert.equal(r.r.dev, 'K1');
    r = await call('posDev', MGR, { op: 'add', name: 'קופה 2', br: 'b1' });
    assert.equal(r.r.dev, 'K2');
    assert.equal(R(await call('posDev', CASH, { op: 'claim', dev: 'K1', inst: INST1 })), 'ok');
    assert.equal(R(await call('posDev', CASH, { op: 'claim', dev: 'K1', inst: INST1 })), 'ok', 'אותו מכשיר שוב – מותר');
    assert.equal(R(await call('posDev', CASH2, { op: 'claim', dev: 'K1', inst: INST2 })), 'dev-taken');
    assert.equal(R(await call('posDev', NOPOS, { op: 'claim', dev: 'K2', inst: INST2 })), 'not-pos');
    assert.equal(R(await call('posDev', CASH, { op: 'claim', dev: 'K9', inst: INST1 })), 'no-dev');
    // שתי מכירות על K1, ואז פרישה
    assert.equal(R(await call('posSale', CASH, sale())), 'ok');
    assert.equal(R(await call('posSale', CASH, sale())), 'ok');
    r = await call('posDev', MGR, { op: 'retire', dev: 'K1', replace: true });
    assert.equal(R(r), 'ok');
    assert.deepEqual([r.r.lostFrom, r.r.newDev], [3, 'K3']);
    const k1 = await get(`b/${A}/posdev/K1`);
    assert.deepEqual([k1.st, k1.on, k1.lostFrom, k1.replacedBy], ['retired', false, 3, 'K3']);
    assert.equal((await get(`b/${A}/posdev/K3`)).replaces, 'K1');
    assert.equal(R(await call('posDev', CASH, { op: 'claim', dev: 'K1', inst: INST1 })), 'retired');
    assert.equal(R(await call('posDev', MGR, { op: 'retire', dev: 'K1' })), 'retired');
    assert.equal(R(await call('posDev', MGR, { op: 'on', dev: 'K1', on: true })), 'retired');
    assert.equal(R(await call('posSale', CASH, sale())), 'retired');
    r = await call('posDev', MGR, { op: 'add', name: 'קופה 4', br: 'b1' });
    assert.equal(r.r.dev, 'K4', 'המונה רק עולה – K1 לא חוזר');
    // השבתה (מכשיר שנגנב) והפעלה
    assert.equal(R(await call('posDev', CASH, { op: 'claim', dev: 'K3', inst: INST2 })), 'ok');
    assert.equal(R(await call('posDev', MGR, { op: 'on', dev: 'K3', on: false })), 'ok');
    assert.equal(R(await call('posSale', CASH, sale({ dev: 'K3', inst: INST2 }))), 'dev-off');
    assert.equal(R(await call('posDev', MGR, { op: 'on', dev: 'K3', on: true })), 'ok');
    r = await call('posSale', CASH, sale({ dev: 'K3', inst: INST2 }));
    assert.equal(r.r.id, 'K3-000001', 'קופה חלופית – מונה חדש מ-1');
    assert.equal(R(await call('posSale', CASH, sale({ dev: 'K3', inst: INST1 }))), 'dev-taken');
  });

  it('קלט לא תקין; legacy; מתג כבוי', async () => {
    assert.equal(R(await call('posDev', MGR, { op: 'zap' })), 'bad-op');
    assert.equal(R(await call('posDev', MGR, { op: 'add', name: '' })), 'bad-name');
    assert.equal(R(await call('posDev', MGR, { op: 'add', name: 'א', br: 'a b' })), 'bad-br');
    assert.equal(R(await call('posDev', MGR, { op: 'retire', dev: 'X1' })), 'bad-dev');
    assert.equal(R(await call('posDev', CASH, { op: 'claim', dev: 'K1', inst: 'short' })), 'bad-inst');
    assert.equal(R(await call('posDev', LEG, { op: 'add', name: 'א' })), 'legacy');
    assert.equal(R(await call('posDev', FMGR, { op: 'add', name: 'א' })), 'feature-off');
  });
});

describe('pos – מכירה (posSale): reqId, מספור, תרגול', () => {
  beforeEach(async () => {
    await seed();
    await call('posDev', MGR, { op: 'add', name: 'קופה 1', br: 'b1' });
    await call('posDev', MGR, { op: 'add', name: 'קופה 2', br: 'b1' });
    await call('posDev', CASH, { op: 'claim', dev: 'K1', inst: INST1 });
    await call('posDev', CASH2, { op: 'claim', dev: 'K2', inst: INST2 });
  });

  it('מכירה: סכומים מחושבים בשרת באגורות (9980 = 8458 + 1522), נכתבת רק דרך השרת', async () => {
    const r = await call('posSale', CASH, sale());
    assert.equal(R(r), 'ok');
    assert.deepEqual([r.r.id, r.r.seq, r.r.gross], ['K1-000001', 1, 9980]);
    const d = await get(`b/${A}/possale/K1-000001`);
    assert.deepEqual([d.gross, d.net, d.vat, d.rate, d.vm, d.dev, d.br, d.cashier, d.st, d.doc, d.paid], [9980, 8458, 1522, 18, 'inc', 'K1', 'b1', CASH, 'ok', null, 0]);
    assert.deepEqual(d.lines[0], { pid: 'p1', n: 'מטען USB-C', qty: 2, unit: 4990, disc: 0, tot: 9980, sd: 0, retQty: 0 });
    assert.equal(d.chk, undefined);
    assert.equal((await get(`b/${A}/posdev/K1`)).lastSeq, 1);
    // הקופאי רואה את המכירה שלו
    await assertSucceeds(fs(CASH).doc(`b/${A}/possale/K1-000001`).get());
  });

  it('(3) אותה מכירה (אותו reqId) פעמיים = מסמך אחד, אותו מספר', async () => {
    const s = sale();
    const a = await call('posSale', CASH, s);
    const b = await call('posSale', CASH, s);
    assert.equal(R(a), 'ok'); assert.equal(R(b), 'ok');
    assert.equal(a.r.id, b.r.id);
    assert.equal(b.r.dup, true);
    // גם במקביל
    const s2 = sale();
    const par = await Promise.all([1, 2, 3, 4, 5].map(() => call('posSale', CASH, s2)));
    assert.equal(new Set(par.map((x) => x.r.id)).size, 1);
    let n = 0;
    await prep(async (db) => { n = (await db.collection(`b/${A}/possale`).where('dev', '==', 'K1').get()).size; });
    assert.equal(n, 2);
    assert.equal((await get(`b/${A}/posdev/K1`)).lastSeq, 2);
  });

  it('(4) 100 מכירות במקביל = מספרים 1–100, בלי חור ובלי כפילות', async () => {
    const res = await Promise.all(Array.from({ length: 100 }, () => call('posSale', CASH2, sale({ dev: 'K2', inst: INST2 }))));
    const bad = res.filter((x) => !x.ok);
    assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 3)));
    const seqs = res.map((x) => x.r.seq).sort((a, b) => a - b);
    assert.deepEqual(seqs, Array.from({ length: 100 }, (_, i) => i + 1));
    let ids = [];
    await prep(async (db) => { ids = (await db.collection(`b/${A}/possale`).where('dev', '==', 'K2').get()).docs.map((x) => x.id).sort(); });
    assert.equal(ids.length, 100);
    assert.equal(ids[0], 'K2-000001');
    assert.equal(ids[99], 'K2-000100');
    assert.equal((await get(`b/${A}/posdev/K2`)).lastSeq, 100);
  });

  it('(4ב) 25 מכירות במקביל בלי התור שבתוך השרת (כמו כמה מופעי שרת) – הטרנזקציה לבדה: 1–25, בלי חור ובלי כפילות', async () => {
    PS.QON.on = false;
    try {
      const res = await Promise.all(Array.from({ length: 25 }, () => call('posSale', CASH2, sale({ dev: 'K2', inst: INST2 }))));
      // מכשיר שקיבל שגיאה זמנית שולח שוב עם אותו reqId – כמו בקופה
      for (let k = 0; k < 3; k++) for (const r of res) if (!r.ok) Object.assign(r, await call('posSale', CASH2, r.req));
      assert.equal(res.filter((x) => !x.ok).length, 0, JSON.stringify(res.filter((x) => !x.ok).slice(0, 2)));
      assert.deepEqual(res.map((x) => x.r.seq).sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
      assert.equal((await get(`b/${A}/posdev/K2`)).lastSeq, 25);
      assert.equal(await count(`b/${A}/possale`), 25 + 2);
    } finally { PS.QON.on = true; }
  });

  it('(9) מזהה תרגול (-T) נדחה בשרת ולא מקדם את המונה', async () => {
    assert.equal(R(await call('posSale', CASH, sale({ reqId: 'K1-T0007' }))), 'practice');
    assert.equal(R(await call('posSale', CASH, sale({ dev: 'K1-T1' }))), 'practice');
    assert.equal(R(await call('posSale', NOPOS, sale({ reqId: 'K1-T0008' }))), 'practice', 'נדחה לפני כל בדיקה אחרת');
    assert.equal((await get(`b/${A}/posdev/K1`)).lastSeq, 0);
    assert.equal(await count(`b/${A}/possale`), 2, 'רק שני מסמכי הדמו');
  });

  it('מספר מהמכשיר (שלב 2): רק הבא בתור; כבר ניתן / חור – נדחים', async () => {
    assert.equal(R(await call('posSale', CASH, sale({ seq: 2 }))), 'seq-gap');
    let r = await call('posSale', CASH, sale({ seq: 1, off: true }));
    assert.deepEqual([r.r.id, r.r.seq], ['K1-000001', 1]);
    assert.equal((await get(`b/${A}/possale/K1-000001`)).off, true);
    assert.equal(R(await call('posSale', CASH, sale({ seq: 1 }))), 'seq-used');
    r = await call('posSale', CASH, sale());
    assert.equal(r.r.seq, 2);
  });

  it('סכום מהמכשיר שונה מהחישוב בשרת – נשמר עם chk (לבדיקת מנהל), לא נדחה; הנחת מכירה מתחלקת בין השורות', async () => {
    const r = await call('posSale', CASH, sale({ gross: 9900 }));
    assert.equal(R(r), 'ok');
    const d = await get(`b/${A}/possale/${r.r.id}`);
    assert.deepEqual([d.chk, d.devGross, d.gross], [true, 9900, 9980]);
    const r2 = await call('posSale', CASH, sale({ lines: [line({ qty: 1 }), line({ pid: 'p2', n: 'כבל', qty: 1, unit: 1000, dpct: 10 })], disc: 100 }));
    const d2 = await get(`b/${A}/possale/${r2.r.id}`);
    assert.equal(d2.lines.reduce((s, l) => s + l.tot - l.sd, 0), d2.gross);
    assert.equal(d2.gross, 4990 + 900 - 100);
  });

  it('דחיות: הרשאה, מכשיר לא רשום, שעון, קלט, legacy, מתג כבוי', async () => {
    assert.equal(R(await call('posSale', NOPOS, sale())), 'not-pos');
    assert.equal(R(await call('posSale', OLD, sale())), 'not-pos', 'עובד ישן בלי perms – pos כבוי');
    assert.equal(R(await call('posSale', DIS, sale())), 'staff-disabled');
    assert.equal(R(await call('posSale', CASH, sale({ inst: INST2 }))), 'dev-taken');
    assert.equal(R(await call('posSale', CASH, sale({ dev: 'K7' }))), 'no-dev');
    assert.equal(R(await call('posSale', CASH, sale({ soldAt: Date.now() + 3600000 }))), 'bad-time');
    assert.equal(R(await call('posSale', CASH, sale({ reqId: 'a b' }))), 'bad-req');
    assert.equal(R(await call('posSale', CASH, sale({ lines: [] }))), 'bad-line');
    assert.equal(R(await call('posSale', CASH, sale({ lines: [line({ unit: 1.5 })] }))), 'bad-unit');
    assert.equal(R(await call('posSale', CASH, sale({ lines: [line({ cost: 1 })] }))), 'bad-line');
    assert.equal(R(await call('posSale', CASH, sale({ extra: 1 }))), 'bad-input');
    assert.equal(R(await call('posSale', LEG, sale())), 'legacy');
    assert.equal(R(await call('posSale', FMGR, sale())), 'feature-off');
    assert.equal((await get(`b/${A}/posdev/K1`)).lastSeq, 0, 'אף דחייה לא קידמה את המונה');
  });
});

describe('(7) ספר המסמכים עם קוד קופה (ar-doc.js, תוספת בלבד)', () => {
  beforeEach(seed);

  async function issue(dev) {
    const db = T.prefixed(getFirestore(), `b/${A}/`);
    let out;
    await db.runTransaction(async (tx) => {
      const B = new ARD.Book(tx, db, { uid: MGR }, Date.now(), dev ? { dev } : undefined);
      await B.init();
      await B.needSeq('ir');
      const x = B.issue('ir', { lines: [{ n: 'מטען', q: 1, p: 99.8 }], vm: 'inc', rate: 18, net: 8458, vat: 1522, gross: 9980 });
      B.flush();
      out = x.id;
    });
    return out;
  }

  it('K1 ו-K2 עם אותו מספר רץ – מזהים שונים ומונים נפרדים; בלי dev – מזהה ומונה כמו היום', async () => {
    assert.equal(await issue('K1'), 'irD-K1-1');
    assert.equal(await issue('K2'), 'irD-K2-1');
    assert.equal(await issue('K1'), 'irD-K1-2');
    assert.equal(await issue(), 'irD1');
    assert.equal(await issue(), 'irD2');
    assert.equal((await get(`b/${A}/arcfg/seq_irD_K1`)).n, 2);
    assert.equal((await get(`b/${A}/arcfg/seq_irD_K2`)).n, 1);
    assert.equal((await get(`b/${A}/arcfg/seq_irD`)).n, 2);
    const k = await get(`b/${A}/ardoc/irD-K2-1`);
    assert.deepEqual([k.dev, k.no, k.ser, k.t], ['K2', 1, 'D', 'ir']);
    assert.equal((await get(`b/${A}/ardoc/irD1`)).dev, undefined);
    assert.throws(() => new ARD.Book(null, null, { uid: MGR }, 1, { dev: 'K1-T1' }));
  });
});
