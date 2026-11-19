'use strict';
// POS:M4 (ש4) – הגדרות לכל עסק, מנהל־על ודיווח בעיה (pos-cfg.js) וכללי poscfg/* – מול האמולטור.
// מכסה את קריטריוני הקבלה של אפיון ה 5: 1 (פתיחה), 2 (בידוד עסקים), 2א (קריאה לפי מסמך), 3 (מפתח לא רשום), 4 (שכבות), 5 (הרשאות),
// 6 (אישור שני), 7 (יומן וביטול), 11 (תבנית מחדש), ומתג כבוי = אין גישה ואין כתיבה.
process.env.FUNCTIONS_EMULATOR = 'true';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-cfga', B = 'biz-cfgb', OFF = 'biz-cfgoff';
const SUPER = 'cf_super', MGR = 'cf_mgr', OWN = 'cf_own', CASH = 'cf_cash', BMGR = 'cf_bmgr', FMGR = 'cf_fmgr', NOPOS = 'cf_none';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };

let env, PC;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const fs = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function all(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => x.data()); }); return v; }
const req = (uid, data) => ({ auth: uid ? { uid, token: { email: uid + '@x.invalid' } } : undefined, data: data || {} });
async function call(fn, uid, data) {
  try { return { ok: true, r: await PC.call[fn]()(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; }
}
const R = (r) => (r.ok ? 'ok' : r.reason);

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    const biz = (id, f) => b.set(d.doc('b/' + id), { name: id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: f });
    biz(A, { pos: true }); biz(B, { pos: true }); biz(OFF, { orders: true });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/admins/${OWN}`), { email: 'o@x.invalid', own: true });
    b.set(d.doc(`b/${A}/staff/${CASH}`), { name: 'קופאית', role: 'employee', active: true, perms: Object.assign({}, NONE, { pos: true }) });
    b.set(d.doc(`b/${A}/staff/${NOPOS}`), { name: 'בלי', role: 'employee', active: true, perms: NONE });
    b.set(d.doc(`b/${B}/admins/${BMGR}`), { email: 'b@x.invalid' });
    b.set(d.doc(`b/${OFF}/admins/${FMGR}`), { email: 'f@x.invalid' });
    for (const [u, z, role] of [[MGR, A, 'admin'], [OWN, A, 'admin'], [CASH, A, 'worker'], [NOPOS, A, 'worker'], [BMGR, B, 'admin'], [FMGR, OFF, 'admin']]) {
      b.set(d.doc('users/' + u), { bizId: z, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    }
    for (const z of [A, B, OFF]) {
      b.set(d.doc(`b/${z}/poscfg/main`), { retDays: 14, ver: 1 });
      b.set(d.doc(`b/${z}/poscfg/sa`), { on: true, st: 'trial', type: 'bakeryDisposable', ver: 1 });
      b.set(d.doc(`b/${z}/poscfg/saPub`), { on: true, st: 'trial', type: 'bakeryDisposable', mods: {}, ver: 1 });
      b.set(d.doc(`b/${z}/poscfg/br_b1`), { openDays: [0, 1, 2, 3, 4] });
      b.set(d.doc(`b/${z}/poscfglog/l0`), { key: 'retDays', old: null, new: 14, at: 1 });
    }
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  PC = require('../functions/pos-cfg.js')._core;
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('pos-cfg – בידוד עסקים (חובה)', () => {
  beforeEach(seed);
  it('מנהל של עסק A לא יכול לכתוב הגדרות של עסק B – בשרת: foreign-biz, B לא משתנה, הניסיון נרשם ב-poslog של A', async () => {
    const before = await get(`b/${B}/poscfg/main`);
    const r = await call('posCfgSet', MGR, { bizId: B, set: { retDays: 30 } });
    assert.equal(r.code, 'permission-denied'); assert.equal(r.reason, 'foreign-biz');
    assert.deepEqual(await get(`b/${B}/poscfg/main`), before);
    assert.equal((await all(`b/${B}/poscfglog`)).length, 1);
    const lg = (await all(`b/${A}/poslog`)).filter((x) => x.act === 'foreignBiz');
    assert.equal(lg.length, 1); assert.equal(lg[0].tgt, B); assert.equal(lg[0].fn, 'posCfgSet');
    for (const fn of ['posCfg', 'posCfgUndo', 'posSa', 'posBug']) assert.equal(R(await call(fn, OWN, { bizId: B, op: 'get', logId: 'l0', txt: 'x' })), 'foreign-biz', fn);
  });
  it('אותה קריאה בלי bizId – משנה רק את A', async () => {
    assert.equal(R(await call('posCfgSet', MGR, { set: { retDays: 30 } })), 'ok');
    assert.equal((await get(`b/${A}/poscfg/main`)).retDays, 30);
    assert.equal((await get(`b/${B}/poscfg/main`)).retDays, 14);
  });
  it('מנהל־על עם bizId של B – עובר ונרשם ביומן של B עם role:sa', async () => {
    assert.equal(R(await call('posCfgSet', SUPER, { bizId: B, set: { retDays: 21 } })), 'ok');
    assert.equal((await get(`b/${B}/poscfg/main`)).retDays, 21);
    const l = (await all(`b/${B}/poscfglog`)).find((x) => x.key === 'retDays' && x.new === 21);
    assert.equal(l.role, 'sa'); assert.equal(l.by, SUPER); assert.equal(l.old, 14);
  });
  it('בכללים: מנהל של B לא קורא ולא כותב poscfg / poscfglog של A; אף אחד לא כותב ישירות', async () => {
    for (const d of ['main', 'sa', 'saPub', 'br_b1']) await assertFails(fs(BMGR).doc(`b/${A}/poscfg/${d}`).get());
    await assertFails(fs(BMGR).doc(`b/${A}/poscfglog/l0`).get());
    for (const u of [SUPER, OWN, MGR, CASH]) {
      for (const d of ['main', 'sa', 'saPub', 'br_b1', 'apprlock']) await assertFails(fs(u).doc(`b/${A}/poscfg/${d}`).set({ x: 1 }));
      await assertFails(fs(u).doc(`b/${A}/poscfglog/n1`).set({ x: 1 }));
      await assertFails(fs(u).doc('postpl/grocery').set({ x: 1 }));
      await assertFails(fs(u).doc('posbug/x').set({ x: 1 }));
    }
  });
});

describe('pos-cfg – קריאה לפי מסמך (אפיון ה 5.2א)', () => {
  beforeEach(seed);
  it('קופאי: saPub, main, br – כן; sa, poscfglog – לא. מנהל: sa – כן, poscfglog – לא. בעלים ומנהל־על: poscfglog – כן', async () => {
    for (const d of ['saPub', 'main', 'br_b1']) await assertSucceeds(fs(CASH).doc(`b/${A}/poscfg/${d}`).get());
    await assertFails(fs(CASH).doc(`b/${A}/poscfg/sa`).get());
    await assertFails(fs(CASH).doc(`b/${A}/poscfglog/l0`).get());
    await assertFails(fs(NOPOS).doc(`b/${A}/poscfg/saPub`).get());
    await assertSucceeds(fs(MGR).doc(`b/${A}/poscfg/sa`).get());
    await assertFails(fs(MGR).doc(`b/${A}/poscfglog/l0`).get());
    await assertSucceeds(fs(OWN).doc(`b/${A}/poscfglog/l0`).get());
    await assertSucceeds(fs(SUPER).doc(`b/${A}/poscfglog/l0`).get());
    await assertFails(fs(MGR).doc(`b/${A}/poscfg/apprlock`).get());
  });
  it('אחרי שינוי mods ע"י מנהל־על – sa.mods ו-saPub.mods זהים', async () => {
    assert.equal(R(await call('posCfgSet', SUPER, { bizId: A, set: { 'sa.mods': { weight: true, club: false } } })), 'ok');
    const s = await get(`b/${A}/poscfg/sa`), p = await get(`b/${A}/poscfg/saPub`);
    assert.equal(s.mods.weight, true);
    assert.equal(p.mods.weight, true); assert.equal(p.mods.club, false);
    assert.equal(p.ver, s.ver);
  });
});

describe('pos-cfg – מתג כבוי = כמו היום (חובה)', () => {
  beforeEach(seed);
  it('עסק בלי pos: כל הפונקציות נדחות (feature-off) ושום דבר לא נכתב; בכללים – אין קריאה', async () => {
    const before = await get(`b/${OFF}/poscfg/main`);
    for (const fn of ['posCfg', 'posCfgSet', 'posCfgUndo', 'posBug']) assert.equal(R(await call(fn, FMGR, { set: { retDays: 1 }, logId: 'l0', txt: 'x' })), 'feature-off', fn);
    assert.equal(R(await call('posSa', FMGR, { op: 'get' })), 'feature-off');
    assert.deepEqual(await get(`b/${OFF}/poscfg/main`), before);
    assert.equal((await all(`b/${OFF}/poscfglog`)).length, 1);
    for (const d of ['main', 'sa', 'saPub', 'br_b1']) await assertFails(fs(FMGR).doc(`b/${OFF}/poscfg/${d}`).get());
    await assertFails(fs(FMGR).doc(`b/${OFF}/poscfglog/l0`).get());
  });
});

describe('pos-cfg – הרשאות, סכמה, אישור שני ויומן', () => {
  beforeEach(seed);
  it('מפתח לא רשום / שם שבוטל – "הגדרה לא מוכרת"', async () => {
    const r = await call('posCfgSet', OWN, { set: { foo: 1 } });
    assert.equal(r.reason, 'unknown-key'); assert.match(r.msg, /הגדרה לא מוכרת/);
    assert.equal(R(await call('posCfgSet', SUPER, { bizId: A, set: { zeroStock: 'warn' } })), 'unknown-key');
  });
  it('מנהל: payOn, cashMax, cashMaxMode, rcptFooter – נדחה; retDays – עובר. קופאי לא משנה כלום', async () => {
    for (const set of [{ payOn: ['cash'] }, { cashMax: 1 }, { cashMaxMode: 'note' }, { rcptFooter: 'x' }]) assert.equal(R(await call('posCfgSet', MGR, { set })), 'not-allowed', JSON.stringify(set));
    assert.equal(R(await call('posCfgSet', MGR, { set: { retDays: 7 } })), 'ok');
    assert.equal(R(await call('posCfgSet', CASH, { set: { retDays: 7 } })), 'not-manager');
  });
  it('מנהל־על שם sa.who.rcptFooter=mgr ← מנהל עובר; sa.lock ← בעלים נחסם', async () => {
    assert.equal(R(await call('posCfgSet', SUPER, { bizId: A, set: { 'sa.who': { rcptFooter: 'mgr' }, 'sa.lock': ['retDays'] } })), 'ok');
    assert.equal(R(await call('posCfgSet', MGR, { set: { rcptFooter: 'תודה' } })), 'ok');
    assert.equal(R(await call('posCfgSet', OWN, { set: { retDays: 3 } })), 'not-allowed');
  });
  it('אישור שני: בעלים בלי appr – appr-needed; עם appr:self – עובר ונרשם appr. מנהל – apprPin של בעל העסק, 5 טעויות = חסימה', async () => {
    assert.equal(R(await call('posCfgSet', OWN, { set: { payOn: ['cash', 'card'] } })), 'appr-needed');
    assert.equal(R(await call('posCfgSet', OWN, { set: { payOn: ['cash', 'card'] }, appr: 'self' })), 'ok');
    const l = (await all(`b/${A}/poscfglog`)).find((x) => x.key === 'payOn');
    assert.equal(l.appr, 'self'); assert.equal(l.role, 'own');
    assert.equal((await all(`b/${A}/poslog`)).filter((x) => x.act === 'cfg').length, 1);
    // מנהל משנה הגדרה רגישה שהועברה אליו (sa.who) – בלי מודול ה-PIN של ש5: appr-unavailable
    await call('posCfgSet', SUPER, { bizId: A, set: { 'sa.who': { vatRate: 'mgr' } } });
    PC.setPin(null);
    assert.equal(R(await call('posCfgSet', MGR, { set: { vatRate: 17 }, apprPin: '1234' })), 'appr-unavailable');
    PC.setPin({ verifyOwner: async (db, pin) => (pin === '9999' ? OWN : null) });
    for (let i = 0; i < 5; i++) assert.equal(R(await call('posCfgSet', MGR, { set: { vatRate: 17 }, apprPin: '1111' })), 'appr-bad');
    assert.equal(R(await call('posCfgSet', MGR, { set: { vatRate: 17 }, apprPin: '9999' })), 'appr-locked');
    await prep((d) => d.doc(`b/${A}/poscfg/apprlock`).delete());
    assert.equal(R(await call('posCfgSet', MGR, { set: { vatRate: 17 }, apprPin: '9999' })), 'ok');
    assert.equal((await get(`b/${A}/poscfg/main`)).vatRate, 17);
    PC.setPin(null);
  });
  it('יומן וביטול: בטל מחזיר את הערך; בטל אחרי שינוי מאוחר – changed-since; מנהל לא מבטל', async () => {
    await call('posCfgSet', MGR, { set: { retDays: 20 } });
    const l1 = (await all(`b/${A}/poscfglog`)).find((x) => x.new === 20);
    let id;
    await prep(async (d) => { id = (await d.collection(`b/${A}/poscfglog`).where('new', '==', 20).get()).docs[0].id; });
    assert.equal(l1.old, 14);
    assert.equal(R(await call('posCfgUndo', MGR, { logId: id })), 'not-owner');
    await call('posCfgSet', MGR, { set: { retDays: 25 } });
    assert.equal(R(await call('posCfgUndo', OWN, { logId: id })), 'changed-since');
    let id2;
    await prep(async (d) => { id2 = (await d.collection(`b/${A}/poscfglog`).where('new', '==', 25).get()).docs[0].id; });
    assert.equal(R(await call('posCfgUndo', OWN, { logId: id2 })), 'ok');
    assert.equal((await get(`b/${A}/poscfg/main`)).retDays, 20);
    assert.ok((await all(`b/${A}/poscfglog`)).some((x) => x.src === 'undo' && x.undoOf === id2));
  });
  it('שכבות: חריגה לסניף רק ל-brOk; posCfg({br}) מחזיר את ערך הסניף', async () => {
    assert.equal(R(await call('posCfgSet', MGR, { scope: 'br', br: 'b2', set: { openDays: [0, 1] } })), 'ok');
    assert.deepEqual((await get(`b/${A}/poscfg/br_b2`)).openDays, [0, 1]);
    assert.equal(R(await call('posCfgSet', MGR, { scope: 'br', br: 'b2', set: { retDays: 3 } })), 'not-br');
    const r1 = await call('posCfg', CASH, { br: 'b1' }), r0 = await call('posCfg', CASH, {});
    assert.deepEqual(r1.r.cfg.openDays, [0, 1, 2, 3, 4]); assert.deepEqual(r0.r.cfg.openDays, [0, 1, 2, 3, 4, 5]);
    assert.equal(r0.r.sa, undefined); assert.equal(r0.r.cfg['sa.lock'], undefined); // לקופאי – בלי נעילות
  });
});

describe('pos-cfg – מנהל־על: פתיחה, תבנית, דיווח בעיה', () => {
  beforeEach(seed);
  it('פתיחה לעסק מסוג grocery: sa, saPub (אותם on/st/mods), main עם ערכי התבנית, mods.weight, poscfglog src:open; פעם שנייה – already-open', async () => {
    await prep((d) => Promise.all(['sa', 'saPub'].map((x) => d.doc(`b/${B}/poscfg/${x}`).delete())));
    assert.equal(R(await call('posSa', BMGR, { op: 'open', type: 'grocery' })), 'not-superadmin');
    assert.equal(R(await call('posSa', SUPER, { bizId: B, op: 'open', type: 'grocery', maxDev: 3 })), 'ok');
    const s = await get(`b/${B}/poscfg/sa`), p = await get(`b/${B}/poscfg/saPub`), m = await get(`b/${B}/poscfg/main`);
    assert.equal(s.type, 'grocery'); assert.equal(s.mods.weight, true); assert.equal(s.maxDev, 3); assert.ok(s.openedAt);
    assert.deepEqual({ on: p.on, st: p.st, mods: p.mods, type: p.type }, { on: s.on, st: s.st, mods: s.mods, type: s.type });
    assert.deepEqual(m.wbc, { prefix: '2', mode: 'price' });
    assert.equal(m.retDays, 7);
    assert.ok((await all(`b/${B}/poscfglog`)).some((x) => x.src === 'open' && x.key === 'wbc'));
    assert.equal(R(await call('posSa', SUPER, { bizId: B, op: 'open', type: 'grocery' })), 'already-open');
  });
  it('החל תבנית מחדש: רשימת הבדלים, ורק מה שסומן משתנה (src:tpl)', async () => {
    await call('posCfgSet', SUPER, { bizId: A, set: { 'sa.type': 'fashion' } });
    const d = await call('posSa', SUPER, { bizId: A, op: 'tplDiff' });
    assert.equal(d.r.type, 'fashion');
    const ks = d.r.diff.map((x) => x.k);
    assert.ok(ks.includes('retDays') && ks.includes('giftRcpt') === false); // giftRcpt כבר true
    assert.equal(R(await call('posSa', SUPER, { bizId: A, op: 'tplApply', keys: ['retDays'] })), 'ok');
    const m = await get(`b/${A}/poscfg/main`);
    assert.equal(m.retDays, 30); assert.equal(m.retNoRcptDef, undefined);
    assert.ok((await all(`b/${A}/poscfglog`)).some((x) => x.src === 'tpl' && x.key === 'retDays'));
  });
  it('עריכת תבנית (postpl) – רק מנהל־על, ערכים נבדקים מול הסכמה', async () => {
    assert.equal(R(await call('posSa', SUPER, { bizId: A, op: 'tplSet', type: 'grocery', vals: { retDays: 5 } })), 'ok');
    assert.equal((await get('postpl/grocery')).vals.retDays, 5);
    assert.equal(R(await call('posSa', SUPER, { bizId: A, op: 'tplSet', type: 'grocery', vals: { foo: 1 } })), 'unknown-key');
    assert.equal(R(await call('posSa', OWN, { op: 'tplSet', type: 'grocery', vals: {} })), 'not-superadmin');
  });
  it('דווח על בעיה: נשמר ב-posbug עם העסק; מנהל־על רואה את כל הדיווחים', async () => {
    assert.equal(R(await call('posBug', CASH, { txt: 'המדפסת לא מדפיסה', dev: 'K1' })), 'ok');
    assert.equal(R(await call('posBug', CASH, { txt: '  ' })), 'bad-txt');
    const b = await call('posSa', SUPER, { bizId: A, op: 'bugs' });
    assert.equal(b.r.bugs.length, 1); assert.equal(b.r.bugs[0].bizId, A); assert.equal(b.r.bugs[0].dev, 'K1');
  });
});
