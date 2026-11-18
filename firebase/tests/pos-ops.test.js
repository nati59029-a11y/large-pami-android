'use strict';
// POS:M7 – קופה ש7 (17.11.2026): pos-ops.js (posOps, posOpsWatch) ו-pos-backup.js (posBackup, posBackupDaily) – מול האמולטור (Firestore + Storage).
// מכסה מאפיון ד 5: H18 (מצב ציוד למנהל), O9 (הזנה ידנית), O11 (שחזור רק בעלים, השרת דוחה), O12 (התראה על כשל / עותק), O13 (ניתוק מרחוק,
// אישור מכשיר), O17 (יומן תקלות בלי פרטים אישיים, crit → התראה). הפונקציות רצות בתוך תהליך הבדיקה (כמו pos.test.js).
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.BACKUP_MASTER_KEY = process.env.BACKUP_MASTER_KEY || Buffer.alloc(32, 7).toString('base64');

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-posm7';
const OWN = 'm7_own', MGR = 'm7_mgr', CASH = 'm7_cash', NOPOS = 'm7_none';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };
const W = (o) => Object.assign({}, NONE, o);
const INST1 = 'inst_m7aaaaaaaaaaaaaa', INST2 = 'inst_m7bbbbbbbbbbbbbb';

let env, OP, BK, PS;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const fs = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function all(c) { let v = []; await prep(async (d) => { v = (await d.collection(`b/${A}/${c}`).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const req = (uid, data) => ({ auth: uid ? { uid, token: { email: uid + '@x.invalid' } } : undefined, data: data || {} });
async function call(mod, fn, uid, data) {
  try { return { ok: true, r: await mod.call[fn]()(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; }
}
const R = (r) => (r.ok ? 'ok' : r.reason);
let rq = 0;
const reqId = () => 'm7rq' + String(++rq).padStart(8, '0');

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { pos: true } });
    b.set(d.doc(`b/${A}/admins/${OWN}`), { email: 'o@x.invalid', own: true });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${OWN}`), { name: 'בעלים', role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'מנהל', role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${CASH}`), { name: 'קופאית', role: 'employee', active: true, perms: W({ pos: true }) });
    b.set(d.doc(`b/${A}/staff/${NOPOS}`), { name: 'בלי', role: 'employee', active: true, perms: NONE });
    for (const [u, role] of [[OWN, 'admin'], [MGR, 'admin'], [CASH, 'worker'], [NOPOS, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/push_tokens/${OWN}`), { pushTokens: ['tokOWN_' + 'a'.repeat(30)] });
    b.set(d.doc(`b/${A}/push_tokens/${MGR}`), { pushTokens: ['tokMGR_' + 'a'.repeat(30)] });
    b.set(d.doc(`b/${A}/poscfg/main`), { type: 'general', v: { rcptFooter: 'תודה' } });
    b.set(d.doc(`b/${A}/poscfg/ctr`), { dev: 2 });
    b.set(d.doc(`b/${A}/posdev/K1`), { name: 'קופה 1', code: 'K1', br: '_', on: true, st: 'active', lastSeq: 0, at: 1, inst: INST1 });
    b.set(d.doc(`b/${A}/posdev/K2`), { name: 'קופה 2', code: 'K2', br: '_', on: true, st: 'active', lastSeq: 0, at: 1 });
    b.set(d.doc(`b/${A}/promo/pr1`), { n: 'מבצע', pct: 10 });
    b.set(d.doc(`b/${A}/possale/old1`), { gross: 1000, at: 1 });
    b.set(d.doc(`b/${A}/posconf/c1`), { kind: 'price', ref: 'p1', a: 100, b: 120, st: 'open', at: 1 });
    for (const c of ['poserr', 'posconf', 'posbk']) b.set(d.doc(`b/${A}/${c}/x1`), { at: 1, st: 'done' });
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv();
  if (!process.env.FIREBASE_CONFIG) process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: H.PROJECT_ID, storageBucket: H.PROJECT_ID + '.appspot.com' });
  require('../functions/index.js');
  OP = require('../functions/pos-ops.js')._core;
  BK = require('../functions/pos-backup.js')._core;
  PS = require('../functions/pos.js')._core;
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('pos-ops – כללים (poserr, posconf, posbk)', () => {
  beforeEach(seed);
  it('מנהל קורא; קופאי ובלי הרשאה – לא; אף אחד לא כותב', async () => {
    for (const c of ['poserr', 'posconf', 'posbk']) {
      await assertSucceeds(fs(MGR).doc(`b/${A}/${c}/x1`).get());
      await assertFails(fs(CASH).doc(`b/${A}/${c}/x1`).get());
      await assertFails(fs(NOPOS).doc(`b/${A}/${c}/x1`).get());
      for (const u of [OWN, MGR, CASH]) {
        await assertFails(fs(u).doc(`b/${A}/${c}/n1`).set({ at: 1 }));
        await assertFails(fs(u).doc(`b/${A}/${c}/x1`).update({ at: 2 }));
        await assertFails(fs(u).doc(`b/${A}/${c}/x1`).delete());
      }
    }
  });
});

describe('posOps – מכשירים (O13)', () => {
  beforeEach(seed);
  it('אישור, ניתוק מרחוק והחזרה – מנהל בלבד; קופה מנותקת לא מוכרת', async () => {
    assert.equal(R(await call(OP, 'posOps', CASH, { op: 'approve', dev: 'K1' })), 'not-manager');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'approve', dev: 'K2' })), 'no-inst');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'approve', dev: 'K1' })), 'ok');
    assert.equal((await get(`b/${A}/posdev/K1`)).appr.by, MGR);
    // מכירה עובדת לפני הניתוק
    const s1 = await call(PS, 'posSale', CASH, { reqId: reqId(), dev: 'K1', inst: INST1, lines: [{ pid: 'p1', n: 'לחם', qty: 1, unit: 690 }], soldAt: Date.now() - 1000 });
    assert.equal(R(s1), 'ok');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'kill', dev: 'K1' })), 'ok');
    const k = await get(`b/${A}/posdev/K1`);
    assert.equal(k.on, false); assert.equal(k.kill.by, MGR);
    const s2 = await call(PS, 'posSale', CASH, { reqId: reqId(), dev: 'K1', inst: INST1, lines: [{ pid: 'p1', n: 'לחם', qty: 1, unit: 690 }], soldAt: Date.now() - 1000 });
    assert.equal(R(s2), 'dev-off');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'approve', dev: 'K1' })), 'dev-off');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'unkill', dev: 'K1' })), 'ok');
    const u = await get(`b/${A}/posdev/K1`);
    assert.equal(u.on, true); assert.equal(u.kill, undefined); assert.equal(u.inst, undefined); assert.equal(u.appr, undefined);
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'unkill', dev: 'K1' })), 'not-killed');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'kill', dev: 'K99' })), 'no-dev');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'kill', dev: 'x' })), 'bad-dev');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'nope' })), 'bad-op');
    assert.ok((await all('poslog')).filter((x) => x.kind === 'dev').length >= 3);
  });
});

describe('posOps – מצב ציוד (H18)', () => {
  beforeEach(seed);
  it('הקופה מדווחת מצב מדפסת ותור; מכשיר אחר / ערך לא מוכר נדחה או מנורמל', async () => {
    const r = await call(OP, 'posOps', CASH, { op: 'hw', dev: 'K1', inst: INST1, hwSt: { printer: 'paper', disp: 'ok', prnq: 2 }, qLen: 3, qOldest: Date.now() - 60000, ver: '2108' });
    assert.equal(R(r), 'ok');
    const d = await get(`b/${A}/posdev/K1`);
    assert.deepEqual(d.hwSt, { printer: 'paper', disp: 'ok', prnq: 2 });
    assert.equal(d.qLen, 3); assert.equal(d.ver, '2108'); assert.ok(d.hwAt > 0);
    assert.equal(R(await call(OP, 'posOps', CASH, { op: 'hw', dev: 'K1', inst: INST2, hwSt: {} })), 'dev-taken');
    assert.equal(R(await call(OP, 'posOps', NOPOS, { op: 'hw', dev: 'K1', inst: INST1, hwSt: {} })), 'not-pos');
    await call(OP, 'posOps', CASH, { op: 'hw', dev: 'K1', inst: INST1, hwSt: { printer: '<b>', disp: 7, prnq: -1 }, ver: 'a b<' });
    const d2 = await get(`b/${A}/posdev/K1`);
    assert.deepEqual(d2.hwSt, { printer: 'none', disp: 'none', prnq: 0 });
    assert.equal(d2.ver, '2108', 'גרסה לא תקינה לא נשמרת');
  });
});

describe('posOps – יומן תקלות (O17)', () => {
  beforeEach(seed);
  it('טלפון, כרטיס ומייל נמחקים; הקשר רק פרימיטיבי; crit מחכה להתראה', async () => {
    const r = await call(OP, 'posOps', CASH, { op: 'err', sev: 'crit', code: 'PRN<x>', msg: 'נכשל ללקוח 050-1234567 dana@mail.co.il כרטיס 4580 4580 4580 4580', ctx: { screen: 'pay', n: 3, phone: '0501234567', obj: { a: 1 }, 'bad key': 1 }, dev: 'K1', ver: '2108' });
    assert.equal(R(r), 'ok');
    const e = (await all('poserr')).find((x) => x.id === r.r.id);
    assert.equal(e.code, 'PRNx'); assert.equal(e.sev, 'crit'); assert.equal(e.sent, false); assert.equal(e.dev, 'K1');
    assert.ok(!/050|1234567|4580|dana|@/.test(e.msg), e.msg);
    assert.deepEqual(e.ctx, { screen: 'pay', n: 3, phone: '[num]' });
    assert.equal(R(await call(OP, 'posOps', CASH, { op: 'err', sev: 'boom' })), 'bad-sev');
    assert.equal(R(await call(OP, 'posOps', NOPOS, { op: 'err', msg: 'x' })), 'not-pos');
    const i = await call(OP, 'posOps', CASH, { op: 'err', sev: 'info', msg: 'בדיקה' });
    assert.equal((await all('poserr')).find((x) => x.id === i.r.id).sent, true);
  });
});

describe('posOps – התנגשויות והזנה ידנית (O15, O9)', () => {
  beforeEach(seed);
  it('הכרעה בהתנגשות – פעם אחת, מנהל בלבד', async () => {
    assert.equal(R(await call(OP, 'posOps', CASH, { op: 'conf', id: 'c1', pick: 'a' })), 'not-manager');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'conf', id: 'c1', pick: 'z' })), 'bad-pick');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'conf', id: 'c1', pick: 'b' })), 'ok');
    const c = await get(`b/${A}/posconf/c1`);
    assert.equal(c.st, 'done'); assert.equal(c.dec.val, 'b'); assert.equal(c.dec.by, MGR);
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'conf', id: 'c1', pick: 'a' })), 'conf-done');
    assert.equal(R(await call(OP, 'posOps', MGR, { op: 'conf', id: 'nope', pick: 'a' })), 'no-conf');
  });
  it('מכירה ידנית: מנהל, עם השעה האמיתית והסיבה; אותו reqId פעמיים = מכירה אחת; קופאי – לא', async () => {
    const realAt = Date.now() - 3 * 3600e3;
    const body = { op: 'manual', dev: 'K1', inst: INST1, realAt, why: 'הפסקת חשמל', lines: [{ n: 'לחם אחיד', qty: 2, unit: 690 }], reqId: reqId() };
    assert.equal(R(await call(OP, 'posOps', CASH, body)), 'not-manager');
    const r = await call(OP, 'posOps', MGR, body);
    assert.equal(R(r), 'ok');
    const s = await get(`b/${A}/possale/${r.r.id}`);
    assert.equal(s.soldAt, realAt); assert.equal(s.man.why, 'הפסקת חשמל'); assert.equal(s.man.by, MGR); assert.equal(s.man.realAt, realAt);
    assert.equal(s.gross, 1380);
    const again = await call(OP, 'posOps', MGR, body);
    assert.equal(again.r.id, r.r.id); assert.equal(again.r.dup, true);
    assert.equal(R(await call(OP, 'posOps', MGR, Object.assign({}, body, { why: '', reqId: reqId() }))), 'bad-why');
    assert.equal(R(await call(OP, 'posOps', MGR, Object.assign({}, body, { realAt: Date.now() + 864e5, reqId: reqId() }))), 'bad-real');
    // manEntry:'off' (ערך שמור, עוד לפני שש4 מוסיף את המפתח לסכמה)
    await prep((d) => d.doc(`b/${A}/poscfg/main`).set({ type: 'general', v: { manEntry: 'off' } }));
    assert.equal(R(await call(OP, 'posOps', MGR, Object.assign({}, body, { reqId: reqId() }))), 'man-off');
  });
});

describe('posOpsWatch – התראות תור ותקלה חמורה (O6, O17)', () => {
  beforeEach(seed);
  it('תור של 20+ ותקלה crit → התראה לבעלים בלבד, פעם אחת', async () => {
    const PUSH = [];
    const send = async (tokens, msg) => { PUSH.push({ tokens, msg }); return tokens.map((t) => ({ token: t, ok: true })); };
    await prep(async (d) => {
      await d.doc(`b/${A}/posdev/K1`).update({ qLen: 25, qOldest: Date.now() - 30 * 3600e3 });
      await d.doc(`b/${A}/poserr/e1`).set({ sev: 'crit', code: 'DB', at: 1, sent: false });
    });
    const T = require('../functions/lib/tenant.js');
    const run = () => T.runInBiz({ bizId: A, prefix: `b/${A}/` }, () => OP.watchBiz(T.tdb(), Date.now(), { send }));
    const n = await run();
    assert.equal(n, 3, 'תור ארוך + מכירה ישנה + תקלה');
    assert.ok(PUSH.every((p) => p.tokens.length === 1 && p.tokens[0].startsWith('tokOWN_')), 'רק לבעלים (own:true)');
    assert.equal((await get(`b/${A}/poserr/e1`)).sent, true);
    assert.equal(await run(), 0, 'לא שולח שוב');
  });
});

describe('posBackup – גיבוי ושחזור (O11, O12)', () => {
  beforeEach(seed);
  it('הצפנה: קובץ נפתח רק במפתח הנכון', () => {
    const k1 = Buffer.alloc(32, 1), k2 = Buffer.alloc(32, 2);
    const f = BK.seal({ a: 'שלום', n: 5 }, k1);
    assert.deepEqual(BK.open(f, k1), { a: 'שלום', n: 5 });
    assert.throws(() => BK.open(f, k2));
    assert.ok(!f.includes(Buffer.from('שלום')), 'לא טקסט גלוי');
  });
  it('גיבוי עכשיו: מנהל; קופאי – לא; הרשימה מראה מי רשאי לשחזר', async () => {
    assert.equal(R(await call(BK, 'posBackup', CASH, { op: 'now' })), 'not-manager');
    const r = await call(BK, 'posBackup', MGR, { op: 'now' });
    assert.equal(R(r), 'ok', r.msg);
    assert.ok(r.r.n >= 5);
    const l1 = await call(BK, 'posBackup', MGR, { op: 'list' });
    assert.equal(l1.r.items[0].ok, true); assert.equal(l1.r.canRun, true); assert.equal(l1.r.canRestore, false, 'מנהל שאינו בעלים');
    const l2 = await call(BK, 'posBackup', OWN, { op: 'list' });
    assert.equal(l2.r.canRestore, true);
  });
  it('שחזור: רק בעלים, עם אישור שני; מחזיר הגדרות ומבצעים, מכירות לא נוגעות', async () => {
    const b = await call(BK, 'posBackup', OWN, { op: 'now' });
    const id = b.r.id;
    await prep(async (d) => {
      await d.doc(`b/${A}/poscfg/main`).set({ type: 'general', v: { rcptFooter: 'שונה' } });
      await d.doc(`b/${A}/promo/pr1`).set({ n: 'מבצע שונה', pct: 50 });
      await d.doc(`b/${A}/promo/pr2`).set({ n: 'חדש' });
      await d.doc(`b/${A}/possale/old1`).set({ gross: 9999, at: 2 });
      await d.doc(`b/${A}/possale/new1`).set({ gross: 1, at: 3 });
    });
    assert.equal(R(await call(BK, 'posBackup', MGR, { op: 'restore', id, confirm: 'שחזור' })), 'not-owner');
    assert.equal(R(await call(BK, 'posBackup', OWN, { op: 'restore', id })), 'no-confirm');
    assert.equal(R(await call(BK, 'posBackup', OWN, { op: 'restore', id: 'b123', confirm: 'שחזור' })), 'bad-input');
    const r = await call(BK, 'posBackup', OWN, { op: 'restore', id, confirm: 'שחזור' });
    assert.equal(R(r), 'ok', r.msg);
    assert.equal((await get(`b/${A}/poscfg/main`)).v.rcptFooter, 'תודה');
    assert.equal((await get(`b/${A}/promo/pr1`)).pct, 10);
    assert.ok(await get(`b/${A}/promo/pr2`), 'מבצע שנוסף אחרי הגיבוי נשאר');
    assert.equal(r.r.skipped.promo, 1);
    assert.equal((await get(`b/${A}/possale/old1`)).gross, 9999, 'מכירות לא משוחזרות');
    assert.ok(await get(`b/${A}/possale/new1`));
    assert.ok((await all('posbk')).some((x) => x.kind === 'pre' && x.ok), 'גיבוי לפני שחזור');
  });
  it('לילה: גיבוי אוטומטי, וכשלון → posbk ok:false + התראה לבעלים', async () => {
    const T = require('../functions/lib/tenant.js');
    const ctx = { bizId: A, prefix: `b/${A}/` };
    const r = await T.runInBiz(ctx, () => BK.nightBiz(T.tdb(), ctx, Date.parse('2026-11-17T00:40:00Z'), {}));
    assert.ok(r.auto && r.auto.n > 0); assert.equal(r.month, null);
    const m = await T.runInBiz(ctx, () => BK.nightBiz(T.tdb(), ctx, Date.parse('2026-12-01T00:40:00Z'), {}));
    assert.ok(m.month, 'ב-1 לחודש – עותק חודשי');
    const keep = process.env.BACKUP_MASTER_KEY;
    process.env.BACKUP_MASTER_KEY = 'short';
    const AL = [];
    try {
      const f = await T.runInBiz(ctx, () => BK.nightBiz(T.tdb(), ctx, Date.parse('2026-11-18T00:40:00Z'), { alert: async (db, to, msg) => { AL.push({ to, msg }); } }));
      assert.equal(f.err, true);
    } finally { process.env.BACKUP_MASTER_KEY = keep; }
    assert.equal(AL.length, 1); assert.deepEqual(AL[0].to, [OWN]);
    assert.ok((await all('posbk')).some((x) => x.ok === false));
  });
});
