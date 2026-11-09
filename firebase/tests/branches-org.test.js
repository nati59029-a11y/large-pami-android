'use strict';
// סניפים, בנקים וכרטיסים (2026-11-08, חלק א'): setBusinessOrg / setStaffBranches, חוקים (org, private/org, br ב-inbox/mq), ומיגרציה.
// רץ מול האמולטור (auth, firestore, storage, functions), חלק מ-test:multibiz.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-a';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'o_mgr', EMP = 'o_emp', EMP1 = 'o_emp1', SUPER = 'o_super';

const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (name) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${name}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  return { status: json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: json && json.error && json.error.details && json.error.details.reason, result: json && json.result, text };
}

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
async function getDoc(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function audits() { let v = []; await prep(async (d) => { v = (await d.collection(`b/${A}/audit`).get()).docs.map((x) => x.data()); }); return v; }

const BRAND = { name: 'א', logoPath: '', colors: {}, base: 'dark-gold', updatedAt: 1, updatedBy: 'x' };
async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: ALL, brand: BRAND });
    b.set(d.doc(`b/${A}/private/info`), { ownerEmail: 'o@example.invalid', ownerPhone: '0501234567', adv: {} });
    b.set(d.doc(`b/${A}/private/org`), { acc: { bk1: '12-345-678901' } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true, pushTokens: [] });
    b.set(d.doc(`b/${A}/staff/${EMP}`), { name: EMP, role: 'employee', active: true, pushTokens: [] });
    b.set(d.doc(`b/${A}/staff/${EMP1}`), { name: EMP1, role: 'employee', active: true, pushTokens: [], br: ['br1'] });
    for (const [u, role] of [[MGR, 'admin'], [EMP, 'worker'], [EMP1, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    await b.commit();
  });
}
const ORG = () => ({ v: 1,
  branches: [{ id: 'br1', name: 'נחל לכיש', on: true, sig: [{ k: 'num', v: '1234567' }] }, { id: 'br2', name: 'יהודה הנשיא', on: true, sig: [{ k: 'txt', v: 'יהודה' }] }],
  banks: [{ id: 'bk1', name: 'לאומי', last4: '6789', on: true, sig: [] }],
  cards: [{ id: 'cc1', name: 'ויזה עסקי', last4: '4321', bank: 'bk1', on: true, sub: 'oldSub1' }] });

before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(seed);

describe('סניפים – setBusinessOrg', () => {
  it('מנהל־על שומר; נרשם audit; שדות אחרים במסמך העסק לא השתנו', async () => {
    const before = await getDoc('b/' + A);
    const r = await call('setBusinessOrg', SUPER, { bizId: A, org: ORG() });
    assert.equal(r.status, 'OK', r.text);
    const after = await getDoc('b/' + A);
    assert.deepEqual(after.org.branches.map((x) => x.id), ['br1', 'br2']);
    assert.equal(after.org.updatedBy, SUPER);
    const { org, ...rest } = after; assert.deepEqual(rest, before);
    const a = await audits(); assert.equal(a.length, 1); assert.equal(a[0].act, 'setBusinessOrg'); assert.equal(a[0].by, SUPER);
  });
  it('עקיפה: מנהל העסק / עובד / בלי כניסה – נחסם, ולא נכתב כלום', async () => {
    for (const u of [MGR, EMP]) assert.equal((await call('setBusinessOrg', u, { bizId: A, org: ORG() })).reason, 'not-superadmin');
    assert.equal((await call('setBusinessOrg', null, { bizId: A, org: ORG() })).status, 'UNAUTHENTICATED');
    assert.equal((await getDoc('b/' + A)).org, undefined);
    assert.equal((await audits()).length, 0);
  });
  it('ולידציה: מזהה, 4 ספרות, שם, מספר סימנים, מגבלת כמות, שדה לא מוכר, בנק לא קיים', async () => {
    const bad = [
      (o) => { o.branches[0].id = 'BR-1'; }, (o) => { o.branches[1].id = 'br1'; }, (o) => { o.banks[0].last4 = '12a4'; },
      (o) => { o.banks[0].last4 = '12345'; }, (o) => { o.branches[0].name = 'א'.repeat(41); }, (o) => { o.branches[0].name = '  '; },
      (o) => { o.branches[0].sig = Array.from({ length: 11 }, () => ({ k: 'txt', v: 'x' })); }, (o) => { o.branches[0].sig = [{ k: 'zzz', v: 'x' }]; },
      (o) => { o.branches = Array.from({ length: 21 }, (_, i) => ({ id: 'b' + i + 'x', name: 'n' })); },
      (o) => { o.cards = Array.from({ length: 31 }, (_, i) => ({ id: 'c' + i + 'x', name: 'n' })); },
      (o) => { o.extra = 1; }, (o) => { o.branches[0].evil = 1; }, (o) => { o.cards[0].bank = 'bk9'; }, (o) => { o.branches[0].on = 'yes'; },
    ];
    for (const f of bad) { const o = ORG(); f(o); const r = await call('setBusinessOrg', SUPER, { bizId: A, org: o }); assert.equal(r.reason, 'bad-org', JSON.stringify(o).slice(0, 120) + ' ' + r.text); }
    assert.equal((await getDoc('b/' + A)).org, undefined);
  });
  it('אי אפשר להסיר מזהה קיים – רק להשבית (on:false)', async () => {
    assert.equal((await call('setBusinessOrg', SUPER, { bizId: A, org: ORG() })).status, 'OK');
    const o = ORG(); o.branches = o.branches.slice(0, 1);
    assert.equal((await call('setBusinessOrg', SUPER, { bizId: A, org: o })).reason, 'org-remove');
    const o2 = ORG(); o2.cards = [];
    assert.equal((await call('setBusinessOrg', SUPER, { bizId: A, org: o2 })).reason, 'org-remove');
    const o3 = ORG(); o3.branches[1].on = false;
    assert.equal((await call('setBusinessOrg', SUPER, { bizId: A, org: o3 })).status, 'OK');
    assert.equal((await getDoc('b/' + A)).org.branches[1].on, false);
  });
  it('עסק לא קיים – not-found', async () => {
    assert.equal((await call('setBusinessOrg', SUPER, { bizId: 'nope-biz', org: ORG() })).reason, 'no-biz');
  });
});

describe('סניפים – setStaffBranches', () => {
  beforeEach(async () => { assert.equal((await call('setBusinessOrg', SUPER, { bizId: A, org: ORG() })).status, 'OK'); });
  it('מנהל־על משייך עובד ומנהל; null = כל הסניפים (השדה נמחק); audit', async () => {
    assert.equal((await call('setStaffBranches', SUPER, { bizId: A, uid: EMP, br: ['br2'], kind: 'staff' })).status, 'OK');
    assert.deepEqual((await getDoc(`b/${A}/staff/${EMP}`)).br, ['br2']);
    assert.equal((await call('setStaffBranches', SUPER, { bizId: A, uid: MGR, br: ['br1', 'br2'], kind: 'admin' })).status, 'OK');
    assert.deepEqual((await getDoc(`b/${A}/admins/${MGR}`)).br, ['br1', 'br2']);
    assert.equal((await call('setStaffBranches', SUPER, { bizId: A, uid: EMP, br: null, kind: 'staff' })).status, 'OK');
    assert.equal((await getDoc(`b/${A}/staff/${EMP}`)).br, undefined);
    assert.equal((await getDoc(`b/${A}/staff/${EMP}`)).active, true);
    assert.equal((await audits()).filter((x) => x.act === 'setStaffBranches').length, 3);
  });
  it('עקיפה ושגיאות: לא מנהל־על, סניף לא קיים, משתמש לא קיים, kind לא תקין', async () => {
    assert.equal((await call('setStaffBranches', MGR, { bizId: A, uid: EMP, br: ['br1'] })).reason, 'not-superadmin');
    assert.equal((await call('setStaffBranches', EMP, { bizId: A, uid: EMP, br: ['br1'] })).reason, 'not-superadmin');
    assert.equal((await call('setStaffBranches', SUPER, { bizId: A, uid: EMP, br: ['br9'] })).reason, 'bad-br');
    assert.equal((await call('setStaffBranches', SUPER, { bizId: A, uid: 'ghost', br: ['br1'] })).reason, 'no-staff');
    assert.equal((await call('setStaffBranches', SUPER, { bizId: A, uid: EMP, br: ['br1'], kind: 'boss' })).reason, 'bad-kind');
    assert.equal((await getDoc(`b/${A}/staff/${EMP}`)).br, undefined);
  });
});

describe('סניפים – חוקים', () => {
  it('org במסמך העסק: לא נכתב מהאפליקציה – גם לא מנהל־על או מנהל העסק', async () => {
    await assertFails(db(SUPER).doc('b/' + A).update({ org: ORG() }));
    await assertFails(db(MGR).doc('b/' + A).update({ org: ORG() }));
    await assertFails(db(EMP).doc('b/' + A).update({ org: ORG() }));
    await assertSucceeds(db(SUPER).doc('b/' + A).update({ migrationTarget: true })); // השדה המותר היחיד – לא נשבר
  });
  it('private/org: מנהל העסק ומנהל־על קוראים, עובד לא; אף אחד לא כותב', async () => {
    await assertSucceeds(db(MGR).doc(`b/${A}/private/org`).get());
    await assertSucceeds(db(SUPER).doc(`b/${A}/private/org`).get());
    await assertFails(db(EMP).doc(`b/${A}/private/org`).get());
    await assertFails(db(MGR).doc(`b/${A}/private/org`).set({ acc: {} }));
    await assertFails(db(SUPER).doc(`b/${A}/private/org`).set({ acc: {} }));
    await assertFails(db(MGR).doc(`b/${A}/private/other`).get());
  });
  it('שיוך: עובד לא משנה לעצמו br; מנהל העסק לא משנה לעובד', async () => {
    await assertFails(db(EMP1).doc(`b/${A}/staff/${EMP1}`).update({ br: ['br1', 'br2'] }));
    await assertFails(db(MGR).doc(`b/${A}/staff/${EMP1}`).update({ br: ['br2'] }));
    await assertFails(db(MGR).doc(`b/${A}/admins/${MGR}`).update({ br: ['br2'] }));
  });
  const mq = (u, o) => Object.assign({ uid: u, by: u, t: Date.now(), st: 'new', k: 'invoice', np: 1 }, o);
  it('mq: br של העובד מותר; סניף שאינו שלו נחסם; עובד בלי שיוך – כל מזהה תקין; בלי br – כמו היום', async () => {
    await assertSucceeds(db(EMP1).doc(`b/${A}/mq/q1`).set(mq(EMP1, { br: 'br1' })));
    await assertFails(db(EMP1).doc(`b/${A}/mq/q2`).set(mq(EMP1, { br: 'br2' })));
    await assertSucceeds(db(EMP1).doc(`b/${A}/mq/q3`).set(mq(EMP1)));
    await assertSucceeds(db(EMP).doc(`b/${A}/mq/q4`).set(mq(EMP, { br: 'br2' })));
    await assertFails(db(EMP).doc(`b/${A}/mq/q5`).set(mq(EMP, { br: 'Bad!' })));
    await assertFails(db(EMP).doc(`b/${A}/mq/q6`).set(mq(EMP, { br: 7 })));
  });
  it('inbox: אותו כלל br', async () => {
    const mk = async (u, id, o) => { await prep((d) => d.doc(`b/${A}/chunks/${id}_0`).set({ owner: u, data: 'x' })); return db(u).doc(`b/${A}/inbox/${id}`).set(Object.assign({ owner: u, by: u, status: 'new', created: 'x', data: '{}', parts: '1' }, o)); };
    await assertSucceeds(mk(EMP1, 'i1', { br: 'br1' }));
    await assertFails(mk(EMP1, 'i2', { br: 'br2' }));
    await assertSucceeds(mk(EMP1, 'i3', {}));
    await assertSucceeds(mk(EMP, 'i4', { br: 'br2' }));
  });
  // חלק ג' §5א: צ'ק שעובד סרק נשלח לתיבה עם k='check' – גם בלי expW. k אחר נחסם; בלי k ובלי expW – נחסם כמו היום
  it('inbox: k=check – עובד בלי expW יכול לשלוח צ\'ק (גם chunks k<16 hex>_N); k אחר / בלי k נחסם', async () => {
    await prep((d) => d.doc(`b/${A}/staff/${EMP}`).set({ name: EMP, role: 'employee', active: true, pushTokens: [], perms: { incW: true, expW: false } }));
    const id = 'k0123456789abcdef';
    await assertSucceeds(db(EMP).doc(`b/${A}/chunks/${id}_0`).set({ owner: EMP, data: 'x' }));
    await assertFails(db(EMP).doc(`b/${A}/chunks/wzzz_0`).set({ owner: EMP, data: 'x' }));
    const base = { owner: EMP, by: EMP, status: 'new', created: 'x', data: '{"kind":"check"}', parts: '1' };
    await assertSucceeds(db(EMP).doc(`b/${A}/inbox/${id}`).set(Object.assign({ k: 'check' }, base)));
    await prep((d) => d.doc(`b/${A}/chunks/i9_0`).set({ owner: EMP, data: 'x' }));
    await assertFails(db(EMP).doc(`b/${A}/inbox/i9`).set(Object.assign({ k: 'invoice' }, base)));
    await assertFails(db(EMP).doc(`b/${A}/inbox/i9`).set(base));
    await prep((d) => d.doc(`b/${A}/chunks/i8_0`).set({ owner: EMP1, data: 'x' }));
    await assertFails(db(EMP1).doc(`b/${A}/inbox/i8`).set(Object.assign({}, base, { owner: EMP1, by: EMP1, k: 'other' })));
  });
});

// ---------------------------------------------------------------------------------------------
// מיגרציה: גיבוי ישן → ensure(save(load())) מחזיר tx זהה, ובלי org אין סניפים (brList ריק, txBr = '') – אין שינוי בממשק.
function appCore() {
  const html = H.appSourceLines().join('\n');
  const grab = (re) => { const m = html.match(re); assert.ok(m, 'לא נמצא: ' + re); return m[0]; };
  const ensureSrc = grab(/function ensure\(d\)\{[\s\S]*?\n return d\}/);
  const blk = grab(/\/\* ===== סניפים\/בנקים: ליבה ===== \*\/[\s\S]*?\nconst brArr=[^\n]*\n/);
  const ctx = { console, localStorage: { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); } } };
  vm.createContext(ctx);
  vm.runInContext(`var S=null,SY={},ADM={sa:0};const uid=()=>'u'+Math.random().toString(36).slice(2,8);const heKey=s=>String(s||'').replace(/["'׳״\`’]/g,'').trim();
    const isW=()=>false,isA=()=>false,cfgLocal=()=>({cats:[]}),subById=()=>null,save=()=>{};
    ${ensureSrc}\n${blk}\nthis.ensure=ensure;this.brList=brList;this.txBr=txBr;this.inBr=inBr;this.brGuess=brGuess;this.bankGuess=bankGuess;this.cardGuess=cardGuess;this.setS=(x)=>{S=x};this.setSY=(x)=>{SY=x};`, ctx);
  return ctx;
}
describe('סניפים – מיגרציה ולוגיקת זיהוי (בלי אמולטור)', () => {
  const OLD = { v: 3, cats: [{ id: 'e_sup', kind: 'exp', name: 'ספקים', beh: 'sup' }], subs: [{ id: 's1', cat: 'e_sup', name: 'תנובה' }],
    tx: [{ id: 't1', t: 'exp', cat: 'e_sup', sub: 's1', date: '2026-10-01', amt: 100, note: 'x', pays: [{ id: 'p1', d: '2026-10-02', a: 100, m: 'העברה' }], ts: '', eu: '' },
      { id: 't2', t: 'inc', cat: 'i_yh', date: '2026-10-03', amt: 50, pays: [] }] };
  it('גיבוי ישן: ensure(JSON(ensure(גיבוי))) – tx זהה תו בתו, בלי br/bank/card', () => {
    const C = appCore();
    const a = C.ensure(JSON.parse(JSON.stringify(OLD)));
    const b = C.ensure(JSON.parse(JSON.stringify(a)));
    assert.deepEqual(JSON.parse(JSON.stringify(b.tx)), OLD.tx);
    assert.equal(JSON.stringify(b.tx).includes('"br"'), false);
    assert.equal('orgC' in b, false);
  });
  it('בלי org / סניף יחיד: brList ריק או אחד, brGuess בטוח, inBr תמיד נכון – אין שאלה ואין צ\'יפים', () => {
    const C = appCore(); C.setS(C.ensure(JSON.parse(JSON.stringify(OLD))));
    assert.deepEqual(JSON.parse(JSON.stringify(C.brList())), []);
    assert.equal(C.txBr(OLD.tx[0]), '');
    assert.equal(C.brGuess(OLD.tx[0]).sure, true);
    assert.equal(C.inBr(OLD.tx[0], []), true);
    C.setSY({ biz: { org: { branches: [{ id: 'br1', name: 'א', on: true }] } } });
    assert.equal(C.brList().length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(C.brGuess({}))), { id: 'br1', sure: true });
    assert.equal(C.txBr({}), 'br1');
  });
  it('2 סניפים: זיהוי לפי ספק / עובד / מספר / טקסט; אין התאמה = לא בטוח; כמה = לא בטוח; עובד משויך לסניף אחד', () => {
    const C = appCore(); C.setS(C.ensure(JSON.parse(JSON.stringify(OLD))));
    C.setSY({ biz: { org: { branches: [
      { id: 'br1', name: 'א', on: true, sig: [{ k: 'sup', v: 's1' }, { k: 'num', v: '99887' }] },
      { id: 'br2', name: 'ב', on: true, sig: [{ k: 'emp', v: 'u_x' }, { k: 'txt', v: 'יהודה' }] }],
      banks: [{ id: 'bk1', name: 'לאומי', last4: '6789', on: true }, { id: 'bk2', name: 'פועלים', last4: '1111', on: true }],
      cards: [{ id: 'cc1', name: 'ויזה', last4: '4321', on: true, sub: 'c_old' }, { id: 'cc2', name: 'מאסטר', last4: '8765', on: true }] } } });
    const g = (t) => JSON.parse(JSON.stringify(C.brGuess(t)));
    assert.deepEqual(g({ sub: 's1' }), { id: 'br1', sure: true });
    assert.deepEqual(g({ eu: 'u_x' }), { id: 'br2', sure: true });
    assert.deepEqual(g({ note: 'מסוף 99887' }), { id: 'br1', sure: true });
    assert.deepEqual(g({ note: 'סניף יהודה' }), { id: 'br2', sure: true });
    assert.deepEqual(g({ note: 'כלום' }), { id: '', sure: false });
    assert.deepEqual(g({ sub: 's1', eu: 'u_x' }), { id: 'br1', sure: true }); // ספק קודם לעובד
    assert.deepEqual(g({ br: 'br2', sub: 's1' }), { id: 'br2', sure: true }); // בחירה קיימת נשמרת
    assert.equal(C.inBr({ br: 'br2' }, ['br1']), false); assert.equal(C.inBr({}, ['br1']), true);
    assert.deepEqual(JSON.parse(JSON.stringify(C.bankGuess({ note: 'העברה מחשבון 12-6789' }, {}))), { id: 'bk1', sure: true });
    assert.deepEqual(JSON.parse(JSON.stringify(C.bankGuess({ note: 'x' }, {}))), { id: '', sure: false });
    assert.deepEqual(JSON.parse(JSON.stringify(C.cardGuess({ sub: 'c_old' }, {}))), { id: 'cc1', sure: true });
    assert.deepEqual(JSON.parse(JSON.stringify(C.cardGuess({ note: '**8765' }, {}))), { id: 'cc2', sure: true });
    C.setSY({ br: ['br2'], biz: C_ORG(C) });
    assert.deepEqual(JSON.parse(JSON.stringify(C.brList())).map((x) => x.id), ['br2']);
    assert.deepEqual(g({ sub: 's1' }), { id: 'br2', sure: true });
  });
});
function C_ORG() { return { org: { branches: [{ id: 'br1', name: 'א', on: true, sig: [{ k: 'sup', v: 's1' }] }, { id: 'br2', name: 'ב', on: true }] } }; }
