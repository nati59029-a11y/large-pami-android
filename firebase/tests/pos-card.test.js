'use strict';
// קופה גל 3 (19.11.2026): אשראי במסוף מחובר מול האמולטור – posCardCfg / posCardStart / posCardStatus / posCardCancel, והקישור למכירה ב-posSale (cardTx).
// הפונקציות רצות בתוך תהליך הבדיקה (כמו pos-sale.test.js). המסוף המדומה עונה מיד (MOCK.delay = 0).
process.env.FUNCTIONS_EMULATOR = 'true';
if (!process.env.CARD_ENC_KEY) process.env.CARD_ENC_KEY = Buffer.from('test-only-card-key-32-bytes-0000').toString('base64'); // מפתח דמה (כמו ensure-emulator-secrets)

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-pcard';
const SUPER = 'pc_super', MGR = 'pc_mgr', CASH = 'pc_cash', CASH2 = 'pc_cash2', LEAD = 'pc_lead';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };
const W = (o) => Object.assign({}, NONE, o);
const INST1 = 'inst_aaaaaaaaaaaaaaaa', INST2 = 'inst_bbbbbbbbbbbbbbbb';
const SECRET = 'S3cret-Pass-XYZ';

let env, C, S, PV;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const fsu = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
const P = (p) => `b/${A}/${p}`;
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(P(p)).get(); v = s.exists ? s.data() : null; }); return v; }
async function all(coll) { let v = []; await prep(async (d) => { v = (await d.collection(P(coll)).get()).docs.map((x) => Object.assign({ _id: x.id }, x.data())); }); return v; }
async function set(p, o, merge) { await prep(async (d) => d.doc(P(p)).set(o, merge ? { merge: true } : {})); }
const req = (uid, data) => ({ auth: { uid, token: { email: uid + '@x.invalid' } }, data: data || {} });
async function call(fn, uid, data) {
  const X = fn.startsWith('posCard') ? C : S;
  try { return { ok: true, r: await X.call[fn]()(req(uid, Object.assign({}, data))) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; }
}
const R = (r) => (r.ok ? 'ok' : r.reason);
let n = 0;
const ref = () => 'cr' + String(++n).padStart(8, '0');
const start = (uid, o) => call('posCardStart', uid, Object.assign({ dev: 'K1', inst: INST1, amt: 4990, ref: ref() }, o));
const sale = (o) => Object.assign({ reqId: 'rq' + String(++n).padStart(8, '0') + 's', dev: 'K1', inst: INST1, soldAt: Date.now() - 1000, lines: [{ pid: 'p1', n: 'מטען', qty: 1, unit: 4990 }] }, o);
const cfgSet = (mode, cred) => call('posCardCfg', SUPER, Object.assign({ bizId: A, op: 'set', mode }, cred !== undefined ? { cred } : {}));

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { pos: true } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid', perms: { pos: true, posMgr: true } });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'מנהל', role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${CASH}`), { name: 'קופאית', role: 'employee', active: true, perms: W({ pos: true }) });
    b.set(d.doc(`b/${A}/staff/${CASH2}`), { name: 'קופאי 2', role: 'employee', active: true, perms: W({ pos: true }) });
    b.set(d.doc(`b/${A}/staff/${LEAD}`), { name: 'אחראי', role: 'employee', active: true, perms: W({ posMgr: true }) });
    for (const [u, role] of [[MGR, 'admin'], [CASH, 'worker'], [CASH2, 'worker'], [LEAD, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(P('poscfg/main')), { type: 'general', v: {} });
    for (const [k, inst] of [['K1', INST1], ['K2', INST2]]) b.set(d.doc(P('posdev/' + k)), { name: 'קופה ' + k, code: k, br: 'b1', on: true, st: 'active', inst, lastSeq: 0, at: 1, appr: { by: 'seed', at: 1 } });
    b.set(d.doc(P('prod/p1')), { name: 'מטען', price: 49.9, q: { b1: 5 }, cat: 'c1' });
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  C = require('../functions/pos-card.js')._core;
  S = require('../functions/pos-sale.js')._core;
  PV = require('../functions/lib/pos-card-prov');
  PV.MOCK.delay = 0;
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('posCardCfg – מנהל־על בלבד, פרטי חיבור מוצפנים', () => {
  beforeEach(seed);

  it('מנהל עסק וקופאי – נדחים; ברירת מחדל: כבוי, בלי פרטים', async () => {
    assert.equal(R(await call('posCardCfg', MGR, { op: 'get' })), 'not-superadmin');
    assert.equal(R(await call('posCardCfg', CASH, { op: 'set', mode: 'mock' })), 'not-superadmin');
    const g = await call('posCardCfg', SUPER, { bizId: A, op: 'get' });
    assert.deepEqual(g.r, { mode: 'off', on: false, saved: false, at: null });
  });

  it('CardCom בלי פרטים מלאים → need-cred; עם פרטים: מוצפן ב-private/posCard, ב-poscfg/card רק on/mode, והערכים לא חוזרים', async () => {
    assert.equal(R(await cfgSet('cardcom')), 'need-cred');
    assert.equal(R(await cfgSet('cardcom', { term: '1234' })), 'need-cred');
    const r = await cfgSet('cardcom', { term: '1234567', user: 'apiuser', pass: SECRET });
    assert.equal(R(r), 'ok'); assert.equal(r.r.saved, true);
    assert.deepEqual(Object.keys(await get('poscfg/card')).sort(), ['mode', 'on', 'upd']);
    const k = await get('private/posCard');
    assert.ok(k.box && k.box.ct); assert.equal(JSON.stringify(k).includes(SECRET), false); assert.equal(JSON.stringify(k).includes('apiuser'), false);
    const g = await call('posCardCfg', SUPER, { bizId: A, op: 'get' });
    assert.equal(g.r.saved, true); assert.equal(JSON.stringify(g.r).includes(SECRET), false);
    // עדכון חלקי (רק סיסמה) – נשמר משולב; מעבר למצב mock בלי cred – הפרטים נשמרים
    assert.equal(R(await cfgSet('cardcom', { pass: 'new-pass' })), 'ok');
    assert.equal(R(await cfgSet('mock')), 'ok');
    assert.ok((await get('private/posCard')).box);
    // null = מחיקה; cardcom אחרי מחיקה → need-cred
    assert.equal(R(await cfgSet('mock', null)), 'ok');
    assert.equal(await get('private/posCard'), null);
    assert.equal(R(await cfgSet('cardcom')), 'need-cred');
    assert.equal(R(await cfgSet('real')), 'bad-mode');
    assert.equal(R(await cfgSet('mock', { term: '12ab' })), 'bad-cred');
  });

  it('כללים: poscfg/card קריא לקופאי; private/posCard לא קריא לאף אחד (גם לא מנהל־על); poscard – קריאה בלבד', async () => {
    await cfgSet('cardcom', { term: '1', user: 'u', pass: SECRET });
    await assertSucceeds(fsu(CASH).doc(P('poscfg/card')).get());
    for (const u of [SUPER, MGR, CASH]) await assertFails(fsu(u).doc(P('private/posCard')).get());
    await cfgSet('mock');
    const s = await start(CASH);
    await assertSucceeds(fsu(CASH).doc(P('poscard/' + s.r.id)).get());
    await assertSucceeds(fsu(MGR).collection(P('poscard')).get());
    for (const u of [MGR, CASH]) { await assertFails(fsu(u).doc(P('poscard/' + s.r.id)).set({ st: 'ok' })); await assertFails(fsu(u).doc(P('poscard/x')).set({ st: 'ok' })); }
  });
});

describe('posCardStart / Status / Cancel – מסוף מדומה', () => {
  beforeEach(async () => { await seed(); await cfgSet('mock'); });

  it('כבוי → card-off; קלט לא תקין; מכשיר לא מאושר; מצב תרגול', async () => {
    await cfgSet('off');
    assert.equal(R(await start(CASH)), 'card-off');
    await cfgSet('mock');
    assert.equal(R(await start(CASH, { amt: 0 })), 'bad-amt');
    assert.equal(R(await start(CASH, { amt: 10.5 })), 'bad-amt');
    assert.equal(R(await start(CASH, { amt: C.AMT_MAX + 1 })), 'bad-amt');
    assert.equal(R(await start(CASH, { ref: 'x' })), 'bad-ref');
    assert.equal(R(await start(CASH, { inst: INST2 })), 'dev-taken');
    assert.equal(R(await start(CASH, { n: 9, amt: 90000 })), 'bad-inst'); // מעל instMax
    await set('posdev/K2', { appr: null }, true);
    assert.equal(R(await start(CASH, { dev: 'K2', inst: INST2 })), 'dev-unapproved');
    assert.equal(R(await start(CASH, { ref: 'r-T1abcdef' })), 'practice');
    assert.equal((await all('poscard')).length, 0);
  });

  it('אידמפוטנטי: אותו ref = אותה עסקה (בלי חיוב כפול); אותו ref בסכום אחר → ref-used', async () => {
    const r0 = ref();
    const [a, b] = await Promise.all([start(CASH, { ref: r0 }), start(CASH, { ref: r0 })]);
    assert.equal(a.r.id, 'K1_' + r0); assert.equal(b.r.id, a.r.id);
    assert.equal([a.r.dup, b.r.dup].filter(Boolean).length, 1);
    assert.equal((await all('poscard')).length, 1);
    assert.equal(R(await start(CASH, { ref: r0, amt: 100 })), 'ref-used');
    const d = await get('poscard/K1_' + r0);
    assert.equal(d.st, 'wait'); assert.equal(d.amt, 4990); assert.equal(d.by, CASH); assert.equal(d.sale, null); assert.ok(d.pid);
  });

  it('אישור: status → ok עם מספר אישור ו-4 ספרות; התשובה בלי pid/by/ref', async () => {
    const s = await start(CASH);
    const r = await call('posCardStatus', CASH, { id: s.r.id });
    assert.equal(r.r.st, 'ok'); assert.match(r.r.appr, /^[0-9]{6}$/); assert.match(r.r.last4, /^[0-9]{4}$/);
    for (const k of ['pid', 'by', 'ref', 'dev', 'mode']) assert.equal(k in r.r, false, k);
    assert.equal((await get('poscard/' + s.r.id)).st, 'ok');
    assert.equal(R(await call('posCardStatus', CASH, { id: 'bad' })), 'bad-id');
    assert.equal(R(await call('posCardStatus', CASH, { id: 'K1_nosuchref1' })), 'no-card-tx');
  });

  it('13 אגורות → נדחה; 99 אגורות → ממתין, וביטול → cancel (גם אחרי זה status נשאר cancel)', async () => {
    const a = await start(CASH, { amt: 1013 });
    assert.equal((await call('posCardStatus', CASH, { id: a.r.id })).r.st, 'no');
    const b = await start(CASH, { amt: 1099 });
    assert.equal((await call('posCardStatus', CASH, { id: b.r.id })).r.st, 'wait');
    assert.equal((await call('posCardCancel', CASH, { id: b.r.id })).r.st, 'cancel');
    assert.equal((await call('posCardStatus', CASH, { id: b.r.id })).r.st, 'cancel');
    assert.equal((await call('posCardCancel', CASH, { id: a.r.id })).r.st, 'no'); // סופית – אין מה לבטל
  });

  it('ביטול חיוב שאושר ועוד לא שייך למכירה: קופאי אחר → not-lead; מי שחייב / אחראי → void', async () => {
    const s = await start(CASH);
    await call('posCardStatus', CASH, { id: s.r.id });
    assert.equal(R(await call('posCardCancel', CASH2, { id: s.r.id })), 'not-lead');
    assert.equal((await call('posCardCancel', LEAD, { id: s.r.id })).r.st, 'void');
    const s2 = await start(CASH);
    await call('posCardStatus', CASH, { id: s2.r.id });
    assert.equal((await call('posCardCancel', CASH, { id: s2.r.id })).r.st, 'void');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 4990, src: 'term', cardTx: s2.r.id }] }))), 'card-tx-st');
  });

  it('CardCom (עוד לא מחובר): העסקה נרשמת כשגיאה עם ההודעה הברורה, בלי חיוב', async () => {
    await cfgSet('cardcom', { term: '1', user: 'u', pass: SECRET });
    const s = await start(CASH);
    assert.equal(s.r.st, 'err'); assert.equal(s.r.msg, 'החיבור ל-CardCom עדיין לא הוגדר – ממתין לתיעוד');
  });
});

describe('posSale + cardTx – קישור החיוב למכירה', () => {
  beforeEach(async () => { await seed(); await cfgSet('mock'); });
  async function okTx(o) { const s = await start(CASH, o); return (await call('posCardStatus', CASH, { id: s.r.id })).r; }

  it('מכירה עם חיוב מאושר: נקשר פעם אחת; פרטי החיוב מהשרת (לא מהמכשיר); שימוש חוזר → card-tx-used; ביטול אחרי מכירה → card-in-sale', async () => {
    const t = await okTx();
    const r = await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 4990, src: 'term', cardTx: t.id, last4: '0000', appr: 'FAKE' }] }));
    assert.equal(R(r), 'ok');
    const c = await get('poscard/' + t.id);
    assert.equal(c.sale, r.r.id); assert.ok(c.usedAt);
    const pay = (await all('pospay')).find((x) => x.sale === r.r.id);
    assert.equal(pay.appr, t.appr); assert.equal(pay.last4, t.last4); assert.equal(pay.src, 'term'); assert.equal(pay.cardTx, t.id); assert.equal(pay.term, 'mock');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 4990, src: 'term', cardTx: t.id }] }))), 'card-tx-used');
    assert.equal(R(await call('posCardCancel', MGR, { id: t.id })), 'card-in-sale');
  });

  it('סכום שונה, קופה אחרת, חיוב שלא אושר, אותו חיוב פעמיים, cardTx עם src ידני – נדחים; המכירה לא נרשמת והחיוב נשאר פתוח', async () => {
    const t = await okTx({ amt: 2000 });
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 4990, src: 'term', cardTx: t.id }] }))), 'card-tx-amt');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 2000, src: 'term', cardTx: t.id }, { m: 'card', amt: 2000, src: 'term', cardTx: t.id }, { m: 'cash', amt: 990 }] }))), 'bad-card-tx');
    const t2 = await okTx({ dev: 'K2', inst: INST2 });
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 4990, src: 'term', cardTx: t2.id }] }))), 'card-tx-dev');
    const w = await start(CASH, { amt: 4099 }); // 99 אגורות – המסוף המדומה לא עונה, נשאר wait
    assert.equal(R(await call('posSale', CASH, sale({ lines: [{ pid: 'p1', n: 'x', qty: 1, unit: 4099 }], pays: [{ m: 'card', amt: 4099, src: 'term', cardTx: w.r.id }] }))), 'card-tx-st');
    assert.equal(R(await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 4990, src: 'manual', cardTx: t.id }] }))), 'bad-card-tx');
    assert.equal((await all('possale')).length, 0);
    assert.equal((await get('poscard/' + t.id)).sale, null); // חיוב בלי מכירה – מופיע למנהל
    // חיוב חלקי + מזומן – נסגר
    const r = await call('posSale', CASH, sale({ pays: [{ m: 'card', amt: 2000, src: 'term', cardTx: t.id }, { m: 'cash', amt: 2990 }] }));
    assert.equal(R(r), 'ok');
  });

  it('אותו reqId פעמיים (שליחה חוזרת מהתור) – מכירה אחת, החיוב נקשר פעם אחת', async () => {
    const t = await okTx();
    const o = sale({ pays: [{ m: 'card', amt: 4990, src: 'term', cardTx: t.id }] });
    const a = await call('posSale', CASH, o), b = await call('posSale', CASH, o);
    assert.equal(a.r.id, b.r.id); assert.equal(b.r.dup, true);
    assert.equal((await all('possale')).length, 1);
  });
});
