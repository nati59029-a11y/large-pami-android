'use strict';
// קופה ש5 – משמרת (17.11.2026): posAuth (PIN, נעילה, איפוס, אישור אחראי), posCash (פתיחה, הוצאה, הפקדה, תקרת מזומן), posZ (X / Z), posClock (שעון נוכחות)
// וכללי Firestore של pospin / posshift / posz / posclock – מול האמולטור. הפונקציות רצות בתוך תהליך הבדיקה (כמו pos.test.js).
// המכירות, התשלומים וההחזרות (possale / pospay / posret) נכתבים כאן ישירות בצורה המדומה של ש2 (ראו lib/pos-agg.js), עד שהמימוש שלו יתמזג.
process.env.FUNCTIONS_EMULATOR = 'true';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-sh', OFF = 'biz-shoff';
const MGR = 'sh_mgr', CASH = 'sh_cash', CASH2 = 'sh_cash2', LEAD = 'sh_lead', NOPOS = 'sh_none', FMGR = 'sh_fmgr', SUPER = 'sh_super';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };
const W = (o) => Object.assign({}, NONE, o);
const INST1 = 'inst_aaaaaaaaaaaaaaaa', INST2 = 'inst_bbbbbbbbbbbbbbbb';
const TOK = 'tok_mgr_' + 'a'.repeat(30);

let env, AU, CA, ZZ, CL, G;
const PUSH = [];
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const fs = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function put(p, v) { await prep((d) => d.doc(p).set(v, { merge: true })); }
async function logs(k) { let a = []; await prep(async (d) => { a = (await d.collection(`b/${A}/poslog`).where('k', '==', k).get()).docs.map((x) => x.data()); }); return a; }
const req = (uid, data) => ({ auth: uid ? { uid, token: { email: uid + '@x.invalid' } } : undefined, data: data || {} });
async function call(mod, uid, data) {
  try { return { ok: true, r: await mod.call()(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; }
}
const R = (r) => (r.ok ? 'ok' : r.reason);
const auth = (u, d) => call(AU, u, d), cash = (u, d) => call(CA, u, d), zz = (u, d) => call(ZZ, u, d), clk = (u, d) => call(CL, u, d);

async function seed() {
  await env.clearFirestore();
  PUSH.length = 0;
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    const biz = (id, f) => b.set(d.doc('b/' + id), { name: id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: f });
    biz(A, { pos: true }); biz(OFF, { orders: true });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid', perms: { pos: true, posMgr: true } }); // 18.11.2026: מנהל בקופה רק עם המתג (מנהל־על)
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'מנהל', role: 'manager', active: true, pushTokens: [TOK] });
    b.set(d.doc(`b/${A}/staff/${CASH}`), { name: 'קופאית', role: 'employee', active: true, perms: W({ pos: true }) });
    b.set(d.doc(`b/${A}/staff/${CASH2}`), { name: 'קופאי', role: 'employee', active: true, perms: W({ pos: true }) });
    b.set(d.doc(`b/${A}/staff/${LEAD}`), { name: 'אחראי', role: 'employee', active: true, perms: W({ posMgr: true }) });
    b.set(d.doc(`b/${A}/staff/${NOPOS}`), { name: 'בלי', role: 'employee', active: true, perms: NONE });
    b.set(d.doc(`b/${OFF}/admins/${FMGR}`), { email: 'f@x.invalid' });
    for (const [u, z, role] of [[MGR, A, 'admin'], [CASH, A, 'worker'], [CASH2, A, 'worker'], [LEAD, A, 'worker'], [NOPOS, A, 'worker'], [FMGR, OFF, 'admin']]) {
      b.set(d.doc('users/' + u), { bizId: z, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    }
    b.set(d.doc(`b/${A}/posdev/K1`), { name: 'קופה 1', code: 'K1', br: 'b1', on: true, st: 'active', lastSeq: 0, inst: INST1, appr: { by: 'seed', at: 1 } }); // appr – POS:W2 (devApprove של ש7)
    b.set(d.doc(`b/${A}/posdev/K2`), { name: 'קופה 2', code: 'K2', br: 'b1', on: false, st: 'active', lastSeq: 0, inst: INST2, appr: { by: 'seed', at: 1 } });
    b.set(d.doc(`b/${A}/poscfg/main`), { type: 'general', v: {}, openCashDef: 50000 }); // POS:W2: ערך העסק בפורמט של ש4 (ברירת המחדל באפיון – 100000)
    await b.commit();
  });
}
// מכירה + תשלום / החזרה בצורה המדומה של ש2
let n = 0;
async function sale(shift, gross, pays, st) {
  const id = 'S' + (++n);
  await prep(async (d) => {
    await d.doc(`b/${A}/possale/${id}`).set({ id, shift, dev: 'K1', cashier: CASH, gross, st: st || 'ok', br: 'b1', at: Date.now() });
    for (const p of pays || [{ m: 'cash', a: gross }]) await d.collection(`b/${A}/pospay`).add(Object.assign({ sale: id, shift }, p));
  });
  return id;
}
async function ret(shift, gross, m) { await prep((d) => d.collection(`b/${A}/posret`).add({ sale: 'S1', shift, gross, m: m || 'cash', at: Date.now() })); }
const PIN = { [CASH]: '2580', [CASH2]: '3691', [LEAD]: '4826', [MGR]: '7395' };
async function pins(...us) { for (const u of us) assert.equal(R(await auth(u, { op: 'set', pin: PIN[u] })), 'ok'); }

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  AU = require('../functions/pos-auth.js')._core;
  CA = require('../functions/pos-cash.js')._core;
  ZZ = require('../functions/pos-z.js')._core;
  CL = require('../functions/pos-clock.js')._core;
  G = require('../functions/lib/pos-gate.js');
  G.O.send = async (tokens, msg, meta) => { PUSH.push({ tokens, msg, meta }); };
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

// ---------------------------------------------------------------------------------
describe('ש5 – עובדים ו-PIN', () => {
  beforeEach(seed);

  it('קביעת קוד: 4–6 ספרות, לא פשוט; שינוי – רק עם הקוד הנוכחי; הקוד נשמר מגובב בלבד', async () => {
    assert.equal(R(await auth(CASH, { op: 'set', pin: '1234' })), 'weak-pin');
    assert.equal(R(await auth(CASH, { op: 'set', pin: '12' })), 'bad-pin');
    assert.equal(R(await auth(CASH, { op: 'set', pin: '2580' })), 'ok');
    const p = await get(`b/${A}/pospin/${CASH}`);
    assert.ok(p.h && p.s && !JSON.stringify(p).includes('2580'));
    assert.equal(R(await auth(CASH, { op: 'set', pin: '9753' })), 'bad-input');
    assert.equal(R(await auth(CASH, { op: 'set', pin: '9753', old: '0001' })), 'bad-pin');
    assert.equal(R(await auth(CASH, { op: 'set', pin: '9753', old: '2580' })), 'ok');
    assert.equal(R(await auth(CASH, { op: 'verify', pin: '9753' })), 'ok');
    assert.equal(R(await auth(NOPOS, { op: 'set', pin: '2580' })), 'not-pos');
  });

  it('POS:W2 (איחוד, ש4↔ש5): lib/pos-pin.verifyOwner – רק הקוד של בעל העסק (admins.own); מנהל בלי own, קוד שגוי או קוד נעול – null', async () => {
    const PIN = require('../functions/lib/pos-pin');
    const tdb = (d) => ({ doc: (x) => d.doc(`b/${A}/${x}`), collection: (x) => d.collection(`b/${A}/${x}`) });
    const vo = async (pin) => { let v; await prep(async (d) => { v = await PIN.verifyOwner(tdb(d), pin); }); return v; };
    assert.equal(R(await auth(MGR, { op: 'set', pin: '2580' })), 'ok');
    assert.equal(await vo('2580'), null); // אין בעלים מסומן – מנהל לא מאשר לעצמו
    await put(`b/${A}/admins/${MGR}`, { own: true });
    assert.equal(await vo('2580'), MGR);
    assert.equal(await vo('9999'), null);
    assert.equal(await vo('12'), null);
    await put(`b/${A}/pospin/${MGR}`, { lockUntil: Date.now() + 30000 });
    assert.equal(await vo('2580'), null);
  });

  it('5 קודים שגויים: נעילה ל-30 שניות, התראה למנהל (יומן + טלפון); בזמן הנעילה גם קוד נכון נחסם; אחרי 30 שניות – נפתח', async () => {
    await pins(CASH);
    for (let i = 1; i <= 4; i++) { const r = await auth(CASH2, { op: 'verify', uid: CASH, pin: '0001', dev: 'K1' }); assert.equal(r.reason, 'bad-pin'); assert.match(r.msg, new RegExp('נותרו ' + (5 - i))); }
    assert.equal(PUSH.length, 0);
    const r5 = await auth(CASH2, { op: 'verify', uid: CASH, pin: '0001', dev: 'K1' });
    assert.equal(r5.reason, 'pin-locked'); assert.match(r5.msg, /30 שניות/);
    const lg = await logs('pin-lock');
    assert.equal(lg.length, 1); assert.equal(lg[0].uid, CASH); assert.equal(lg[0].dev, 'K1');
    assert.equal(PUSH.length, 1); assert.deepEqual(PUSH[0].tokens, [TOK]); assert.match(PUSH[0].msg.body, /קופאית/);
    const p = await get(`b/${A}/pospin/${CASH}`);
    assert.ok(p.lockUntil - Date.now() > 25000 && p.lockUntil - Date.now() <= 30000);
    assert.equal(R(await auth(CASH, { op: 'verify', pin: PIN[CASH] })), 'pin-locked');
    await put(`b/${A}/pospin/${CASH}`, { lockUntil: Date.now() - 1 }); // עברו 30 שניות
    assert.equal(R(await auth(CASH, { op: 'verify', pin: PIN[CASH] })), 'ok');
    // אחרי הצלחה המונה מתאפס – 4 שגויים לא נועלים
    for (let i = 0; i < 4; i++) await auth(CASH, { op: 'verify', pin: '0001' });
    assert.equal(R(await auth(CASH, { op: 'verify', pin: PIN[CASH] })), 'ok');
  });

  it('איפוס קוד – רק לבעלים (מנהל); אחראי משמרת וקופאי – לא; אחרי איפוס – אין קוד והנעילה משתחררת', async () => {
    await pins(CASH);
    for (let i = 0; i < 5; i++) await auth(CASH, { op: 'verify', pin: '0001' });
    assert.equal(R(await auth(LEAD, { op: 'reset', uid: CASH })), 'not-owner');
    assert.equal(R(await auth(CASH2, { op: 'reset', uid: CASH })), 'not-owner');
    assert.equal(R(await auth(CASH, { op: 'reset', uid: CASH })), 'not-owner');
    assert.equal(R(await auth(MGR, { op: 'reset', uid: CASH })), 'ok');
    assert.equal(R(await auth(CASH, { op: 'verify', pin: PIN[CASH] })), 'no-pin');
    assert.equal((await logs('pin-reset')).length, 1);
    assert.equal(R(await auth(CASH, { op: 'set', pin: '8642' })), 'ok'); // קוד חדש בלי הקוד הישן
  });

  it('רשימת עובדי הקופה – מנהל בלבד, עם מצב הקוד', async () => {
    await pins(CASH);
    const r = await auth(MGR, { op: 'list' });
    assert.equal(R(r), 'ok');
    const m = Object.fromEntries(r.r.staff.map((x) => [x.uid, x]));
    assert.equal(m[CASH].hasPin, true); assert.equal(m[CASH2].hasPin, false); assert.equal(m[LEAD].role, 'lead'); assert.equal(m[MGR].role, 'manager');
    assert.ok(!m[NOPOS]);
    assert.equal(R(await auth(LEAD, { op: 'list' })), 'not-manager');
  });

  it('כללים: pospin – אף אחד לא קורא ולא כותב מהאפליקציה, גם לא מנהל', async () => {
    await pins(CASH);
    for (const u of [MGR, CASH, LEAD]) {
      await assertFails(fs(u).doc(`b/${A}/pospin/${CASH}`).get());
      await assertFails(fs(u).doc(`b/${A}/pospin/${u}`).set({ h: 'x' }));
    }
  });

  it('מתג כבוי / בלי הרשאת קופה – נדחה', async () => {
    assert.equal(R(await auth(FMGR, { op: 'list' })), 'feature-off');
    assert.equal(R(await auth(NOPOS, { op: 'verify', pin: '2580' })), 'not-pos');
    assert.equal(R(await auth(CASH, { op: 'zap' })), 'bad-op');
  });
});

describe('ש5 – אישור אחראי', () => {
  beforeEach(seed);

  it('הנחה: עד 5% – בלי אישור; אחראי משמרת מאשר עד 10%; מעל 10% – רק מנהל; קופאי לא מאשר', async () => {
    await pins(LEAD, MGR, CASH2);
    // POS:W2 סבב 2 (ליקוי 6): discMax.cashier חל רק כש-discRoles מתיר לקופאי ('cashier') – אותו כלל כמו posSale. ברירת המחדל 'lead' – כל הנחה של קופאי דורשת אישור
    await put(`b/${A}/poscfg/main`, { v: { discMax: { cashier: 5, lead: 10 } } });
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', pct: 3, by: LEAD, pin: 'x' })), 'bad-pin', 'discRoles=lead: גם 3% דורש אישור');
    await put(`b/${A}/poscfg/main`, { v: { discMax: { cashier: 5, lead: 10 }, discRoles: 'cashier' } }); // בסכמה של ש4 ברירת המחדל לקופאי היא 0 – כאן העסק קבע 5
    let r = await auth(CASH, { op: 'approve', act: 'disc', pct: 5, by: LEAD, pin: 'x' });
    assert.equal(R(r), 'ok'); assert.equal(r.r.ap, null);
    r = await auth(CASH, { op: 'approve', act: 'disc', pct: 10, by: LEAD, pin: PIN[LEAD], ref: 'K1-000001', dev: 'K1' });
    assert.equal(R(r), 'ok'); assert.ok(r.r.ap); assert.equal(r.r.need, 'lead');
    const ap = await get(`b/${A}/poslog/${r.r.ap}`);
    assert.deepEqual([ap.k, ap.act, ap.pct, ap.by, ap.for, ap.ref], ['appr', 'disc', 10, LEAD, CASH, 'K1-000001']);
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', pct: 10.5, by: LEAD, pin: PIN[LEAD] })), 'need-manager');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', pct: 30, by: MGR, pin: PIN[MGR] })), 'ok');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', pct: 8, by: CASH2, pin: PIN[CASH2] })), 'need-lead');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'void', by: LEAD, pin: '0001' })), 'bad-pin');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'void', by: LEAD, pin: PIN[LEAD] })), 'ok');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'fly', by: LEAD, pin: PIN[LEAD] })), 'bad-act');
  });
  it('הגדרת discMax.lead נמוכה מ-10 גוברת', async () => {
    await pins(LEAD);
    await put(`b/${A}/poscfg/main`, { v: { discMax: { cashier: 2, lead: 6 } } });
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', pct: 6, by: LEAD, pin: PIN[LEAD] })), 'ok');
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'disc', pct: 7, by: LEAD, pin: PIN[LEAD] })), 'need-manager');
  });
  it('אישור עם קוד שגוי נספר לנעילה (5 = נעילה + התראה)', async () => {
    await pins(LEAD);
    for (let i = 0; i < 5; i++) await auth(CASH, { op: 'approve', act: 'void', by: LEAD, pin: '0001' });
    assert.equal(R(await auth(CASH, { op: 'approve', act: 'void', by: LEAD, pin: PIN[LEAD] })), 'pin-locked');
    assert.equal(PUSH.length, 1);
  });
});

describe('ש5 – משמרת, מזומן ומגירה', () => {
  beforeEach(seed);

  it('פתיחה: מזומן ברירת מחדל מההגדרות; משמרת אחת לקופה; מכשיר לא רשום / קופה מושבתת – נדחה', async () => {
    let r = await cash(CASH, { op: 'open', dev: 'K1', inst: INST1 });
    assert.equal(R(r), 'ok'); assert.equal(r.r.shift, 'K1-S000001'); assert.equal(r.r.open, 50000);
    assert.equal(R(await cash(CASH2, { op: 'open', dev: 'K1', inst: INST1 })), 'shift-open');
    assert.equal(R(await cash(CASH, { op: 'open', dev: 'K1', inst: INST2 })), 'dev-taken');
    assert.equal(R(await cash(CASH, { op: 'open', dev: 'K2', inst: INST2 })), 'dev-off');
    assert.equal(R(await cash(CASH, { op: 'open', dev: 'K9', inst: INST1 })), 'no-dev');
    assert.equal(R(await cash(CASH, { op: 'open', dev: 'K1', inst: INST1, open: 10.5 })), 'bad-amt');
    const sh = await get(`b/${A}/posshift/K1-S000001`);
    assert.deepEqual([sh.st, sh.cashier, sh.open, sh.br], ['open', CASH, 50000, 'b1']);
    assert.equal((await get(`b/${A}/posdev/K1`)).shift, 'K1-S000001');
  });

  it('הוצאה (חובה הערה) והפקדה מורידות מהמגירה; יותר ממה שיש – no-cash; קופאי אחר – לא; אחראי – כן', async () => {
    const id = (await cash(CASH, { op: 'open', dev: 'K1', inst: INST1, open: 20000 })).r.shift;
    await sale(id, 4990);
    assert.equal(R(await cash(CASH, { op: 'mv', shift: id, k: 'out', a: 1000 })), 'bad-note');
    let r = await cash(CASH, { op: 'mv', shift: id, k: 'out', a: 1000, note: 'חלב לצוות' });
    assert.equal(R(r), 'ok'); assert.equal(r.r.cash.expected, 20000 + 4990 - 1000);
    r = await cash(CASH, { op: 'mv', shift: id, k: 'drop', a: 15000 });
    assert.equal(r.r.cash.expected, 8990);
    assert.equal(R(await cash(CASH, { op: 'mv', shift: id, k: 'drop', a: 9000 })), 'no-cash');
    assert.equal(R(await cash(CASH2, { op: 'mv', shift: id, k: 'in', a: 100 })), 'not-yours');
    assert.equal(R(await cash(LEAD, { op: 'mv', shift: id, k: 'in', a: 1010 })), 'ok');
    const st = await cash(CASH, { op: 'state', shift: id });
    assert.deepEqual([st.r.cash.open, st.r.cash.in, st.r.cash.out, st.r.cash.drop, st.r.cash.sales, st.r.cash.expected], [20000, 1010, 1000, 15000, 4990, 10000]);
    assert.equal((await logs('cash-out')).length, 1); assert.equal((await logs('cash-drop')).length, 1);
  });

  it('תקרת מזומן: מעל – אזהרה; הקופאי מאשר; אזהרה חוזרת רק כשהסכום עולה שוב', async () => {
    await put(`b/${A}/poscfg/main`, { v: { cashMax: 100000 } }); // הגדרת מנהל־על; כאן ישירות
    const id = (await cash(CASH, { op: 'open', dev: 'K1', inst: INST1, open: 50000 })).r.shift;
    await sale(id, 40000);
    let s = await cash(CASH, { op: 'state', shift: id });
    assert.equal(s.r.cap.warn, false);
    await sale(id, 20000, [{ m: 'cash', a: 30000, chg: 10000 }]);
    s = await cash(CASH, { op: 'state', shift: id });
    assert.deepEqual([s.r.cash.expected, s.r.cap.over, s.r.cap.warn, s.r.cap.by], [110000, true, true, 10000]);
    const a = await cash(CASH, { op: 'ack', shift: id });
    assert.equal(a.r.acked, 110000);
    assert.equal((await cash(CASH, { op: 'state', shift: id })).r.cap.warn, false);
    assert.equal((await logs('cash-over-ack')).length, 1);
    await sale(id, 100);
    assert.equal((await cash(CASH, { op: 'state', shift: id })).r.cap.warn, true);
    // הפקדה מורידה מתחת לתקרה
    const m = await cash(CASH, { op: 'mv', shift: id, k: 'drop', a: 50000 });
    assert.equal(m.r.cap.over, false);
  });

  it('רשימת משמרות – אחראי / מנהל בלבד; כללים: קופאי קורא רק את המשמרת שלו', async () => {
    const id = (await cash(CASH, { op: 'open', dev: 'K1', inst: INST1 })).r.shift;
    assert.equal(R(await cash(CASH, { op: 'list' })), 'not-lead');
    const l = await cash(LEAD, { op: 'list' });
    assert.equal(l.r.shifts.length, 1); assert.equal(l.r.shifts[0].id, id);
    await assertSucceeds(fs(CASH).doc(`b/${A}/posshift/${id}`).get());
    await assertFails(fs(CASH2).doc(`b/${A}/posshift/${id}`).get());
    await assertFails(fs(CASH).doc(`b/${A}/posshift/${id}`).update({ open: 1 }));
  });
});

describe('ש5 – דוח Z', () => {
  beforeEach(seed);

  it('Z = מכירות פחות החזרות, מדויק לאגורה; מבוטלת לא נספרת; ספירה והפרש; סגירה פעם אחת; מספור לכל קופה', async () => {
    const id = (await cash(CASH, { op: 'open', dev: 'K1', inst: INST1, open: 50000 })).r.shift;
    const amounts = [1990, 4990, 333, 1, 99999, 1250, 7];
    for (const g of amounts) await sale(id, g);
    await sale(id, 15000, [{ m: 'card', a: 15000 }]);
    await sale(id, 8888, null, 'void');
    await ret(id, 333); await ret(id, 990, 'card');
    await cash(CASH, { op: 'mv', shift: id, k: 'drop', a: 30000 });
    const salesSum = amounts.reduce((a, b) => a + b, 0) + 15000;
    const x = await zz(CASH, { op: 'x', shift: id });
    assert.equal(R(x), 'ok'); assert.equal(x.r.rep.z, salesSum - 333 - 990); assert.equal(x.r.st, 'open');
    const expCash = 50000 + amounts.reduce((a, b) => a + b, 0) - 333 - 30000;
    assert.equal(x.r.rep.cash.expected, expCash);
    assert.equal(R(await zz(CASH, { op: 'close', shift: id })), 'bad-amt');
    assert.equal(R(await zz(CASH2, { op: 'close', shift: id, counted: 1 })), 'not-yours');
    const z = await zz(CASH, { op: 'close', shift: id, counted: expCash - 50 });
    assert.equal(R(z), 'ok'); assert.equal(z.r.id, 'K1-Z000001');
    const zd = await get(`b/${A}/posz/K1-Z000001`);
    assert.deepEqual([zd.z, zd.sales, zd.rets, zd.n, zd.voids, zd.nRet, zd.diff, zd.counted], [salesSum - 1323, salesSum, 1323, 8, 1, 2, -50, expCash - 50]);
    assert.deepEqual(zd.pay, { cash: amounts.reduce((a, b) => a + b, 0), card: 15000 });
    assert.equal((await get(`b/${A}/posshift/${id}`)).st, 'closed');
    assert.equal((await get(`b/${A}/posdev/K1`)).shift, null);
    assert.equal((await logs('z-diff')).length, 1);
    const again = await zz(CASH, { op: 'close', shift: id, counted: 0 });
    assert.equal(again.r.dup, true); assert.equal(again.r.id, 'K1-Z000001');
    assert.equal(R(await cash(CASH, { op: 'mv', shift: id, k: 'in', a: 10 })), 'shift-closed');
    const id2 = (await cash(CASH2, { op: 'open', dev: 'K1', inst: INST1 })).r.shift;
    assert.equal(id2, 'K1-S000002');
    const z2 = await zz(LEAD, { op: 'close', shift: id2, counted: 50000 });
    assert.equal(z2.r.id, 'K1-Z000002'); assert.equal(z2.r.rep.z, 0); assert.equal(z2.r.rep.diff, 0);
  });

  it('כללים: Z – אחראי / מנהל קוראים, קופאי לא; אף אחד לא כותב', async () => {
    const id = (await cash(CASH, { op: 'open', dev: 'K1', inst: INST1 })).r.shift;
    await zz(CASH, { op: 'close', shift: id, counted: 50000 });
    await assertFails(fs(CASH).doc(`b/${A}/posz/K1-Z000001`).get());
    await assertSucceeds(fs(LEAD).doc(`b/${A}/posz/K1-Z000001`).get());
    await assertSucceeds(fs(MGR).doc(`b/${A}/posz/K1-Z000001`).get());
    await assertFails(fs(MGR).doc(`b/${A}/posz/K1-Z000001`).update({ z: 1 }));
  });
});

describe('ש5 – שעון נוכחות', () => {
  beforeEach(seed);

  it('כניסה / יציאה לעצמי; כניסה כפולה ויציאה בלי כניסה – נדחות', async () => {
    assert.equal(R(await clk(CASH, { op: 'out' })), 'not-in');
    const i = await clk(CASH, { op: 'in', dev: 'K1' });
    assert.equal(R(i), 'ok');
    assert.equal(R(await clk(CASH, { op: 'in' })), 'clocked-in');
    assert.equal((await clk(CASH, { op: 'status' })).r.open.id, i.r.id);
    const o = await clk(CASH, { op: 'out' });
    assert.equal(R(o), 'ok'); assert.equal(o.r.id, i.r.id); assert.equal(o.r.min, 0);
    assert.equal((await clk(CASH, { op: 'status' })).r.open, null);
    const rec = await get(`b/${A}/posclock/${i.r.id}`);
    assert.equal(rec.who, CASH); assert.equal(rec.name, 'קופאית'); assert.match(rec.day, /^2[0-9]{7}$/);
  });

  it('החתמה לעובד אחר בקופה משותפת – רק עם הקוד שלו (שגוי נספר לנעילה)', async () => {
    await pins(CASH2);
    assert.equal(R(await clk(CASH, { op: 'in', uid: CASH2 })), 'bad-pin');
    assert.equal(R(await clk(CASH, { op: 'in', uid: CASH2, pin: '0001' })), 'bad-pin');
    assert.equal((await get(`b/${A}/pospin/${CASH2}`)).fails, 1);
    assert.equal(R(await clk(CASH, { op: 'in', uid: CASH2, pin: PIN[CASH2] })), 'ok');
    assert.equal(R(await clk(CASH, { op: 'status', uid: CASH2 })), 'not-lead');
    assert.ok((await clk(LEAD, { op: 'status', uid: CASH2 })).r.open);
  });

  it('דוח למנהל עם סיכום דקות, ותיקון עם סיבה (הקודם נשמר); כללים: עובד קורא רק את שלו', async () => {
    const t = Date.now() - 3 * 3600000;
    await prep(async (d) => {
      await d.doc(`b/${A}/posclock/${CASH}_${t}`).set({ who: CASH, name: 'קופאית', in: t, out: t + 2 * 3600000, day: '20261117' });
      await d.doc(`b/${A}/posclock/${CASH2}_${t}`).set({ who: CASH2, name: 'קופאי', in: t, out: t + 45 * 60000, day: '20261117' });
    });
    assert.equal(R(await clk(CASH, { op: 'list', from: t - 1, to: Date.now() })), 'not-manager');
    assert.equal(R(await clk(MGR, { op: 'list', from: 0, to: Date.now() })), 'bad-time');
    const l = await clk(MGR, { op: 'list', from: t - 1, to: Date.now() });
    assert.equal(l.r.sum[CASH].min, 120); assert.equal(l.r.sum[CASH2].min, 45);
    assert.equal(R(await clk(MGR, { op: 'fix', id: `${CASH}_${t}`, out: t + 3600000 })), 'bad-input');
    assert.equal(R(await clk(MGR, { op: 'fix', id: `${CASH}_${t}`, out: t - 1, note: 'x' })), 'bad-time');
    assert.equal(R(await clk(MGR, { op: 'fix', id: `${CASH}_${t}`, out: t + 3600000, note: 'שכחה להחתים' })), 'ok');
    const rec = await get(`b/${A}/posclock/${CASH}_${t}`);
    assert.equal(rec.out, t + 3600000); assert.equal(rec.fix[0].out, t + 2 * 3600000);
    assert.equal((await logs('clock-fix')).length, 1);
    assert.equal(R(await clk(LEAD, { op: 'fix', id: `${CASH}_${t}`, out: t + 60000, note: 'x' })), 'not-manager');
    await assertSucceeds(fs(CASH).doc(`b/${A}/posclock/${CASH}_${t}`).get());
    await assertFails(fs(CASH).doc(`b/${A}/posclock/${CASH2}_${t}`).get());
    await assertFails(fs(CASH).doc(`b/${A}/posclock/${CASH}_${t}`).update({ out: 1 }));
  });
  // 22.11.2026: התראת איחור משעון הקופה (shifts.js posLate). השעה האמיתית – בשבת / חג (או 00:00–00:10) לא מצפים להתראה
  it('כניסה מאוחרת ב-6 דקות ממשמרת היום → התראה אחת למנהל (shfsent.late); כניסה חוזרת באותו יום → אין; עובד בלי משמרת → אין', async () => {
    const SC = require('../functions/lib/shifts-core.js');
    const now = Date.now(), st = now - 6 * 60000, today = SC.todayOf(now);
    const can = !SC.quiet(now) && SC.todayOf(st) === today && SC.todayOf(now + 3600000) === today;
    await put(`b/${A}/shf/PL1`, { d: today, s: SC.hmOf(st), e: SC.hmOf(now + 3600000), u: CASH, nm: 'קופאית', fx: false });
    PUSH.length = 0;
    assert.equal(R(await clk(CASH, { op: 'in', dev: 'K1' })), 'ok');
    assert.equal(R(await clk(CASH2, { op: 'in', dev: 'K1' })), 'ok', 'בלי משמרת');
    const lt = () => PUSH.filter((x) => /^lt/.test(x.msg.id));
    if (!can) { assert.equal(lt().length, 0); return; }
    assert.equal(lt().length, 1, JSON.stringify(PUSH.map((x) => x.msg)));
    assert.deepEqual(lt()[0].tokens, [TOK]); assert.match(lt()[0].msg.body, /^קופאית החתים\/ה כניסה בקופה ב-/); assert.match(lt()[0].msg.body, /לפי שעון הקופה/);
    assert.ok((await get(`b/${A}/shfsent/${today}`)).late[CASH]);
    assert.equal(R(await clk(CASH, { op: 'out' })), 'ok');
    assert.equal(R(await clk(CASH, { op: 'in' })), 'ok');
    assert.equal(lt().length, 1, 'פעם ביום');
  });

  it('תקלה בבדיקת האיחור לא מפילה את ההחתמה', async () => {
    const SH = require('../functions/shifts.js')._core, orig = SH.posLate;
    SH.posLate = async () => { throw new Error('boom'); };
    try {
      const i = await clk(CASH, { op: 'in', dev: 'K1' });
      assert.equal(R(i), 'ok');
      assert.equal((await get(`b/${A}/posclock/${i.r.id}`)).out, null);
    } finally { SH.posLate = orig; }
  });
});
