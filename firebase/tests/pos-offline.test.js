'use strict';
// POS:M3 – קופה גל 2 (ש3): pos-data.js / pos-offline.js מול posSale האמיתי (functions/pos.js) באמולטור Firestore.
// 3 קופות × 30 מכירות בלי רשת, ואחר כך סנכרון במקביל, עם תשובות שהולכות לאיבוד – אפס כפילויות ואפס חורים ב-possale.
// הרצה: firebase emulators:exec --only firestore,storage --project demo-largpeami "node --test tests/pos-offline.test.js"
process.env.FUNCTIONS_EMULATOR = 'true';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./helpers');
const W = path.join(__dirname, '..', '..', 'app-source', 'www');
const OFF = require(path.join(W, 'pos-offline.js'));
const PD = require(path.join(W, 'pos-data.js'));

const A = 'biz-posoff3', SUPER = 'po_super', MGR = 'po_mgr', CASH = ['po_c1', 'po_c2', 'po_c3'];
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };
let env, PS;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const req = (uid, data) => ({ auth: { uid, token: { email: uid + '@x.invalid' } }, data: data || {} });
const call = (fn, uid, data) => PS.call[fn]()(req(uid, data));
const inst = (i) => 'inst_posoff_' + i + '_aaaaaaaaaaaa';

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  PS = require('../functions/pos.js')._core;
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { pos: true, orders: true } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'מנהל', role: 'manager', active: true });
    b.set(d.doc('users/' + MGR), { bizId: A, role: 'admin', active: true, bizStatus: 'active', email: MGR + '@x.invalid', createdAt: 1 });
    CASH.forEach((u, i) => {
      b.set(d.doc(`b/${A}/staff/${u}`), { name: 'קופאי ' + (i + 1), role: 'employee', active: true, perms: Object.assign({}, NONE, { pos: true }) });
      b.set(d.doc('users/' + u), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    });
    b.set(d.doc(`b/${A}/poscfg/main`), { type: 'general', v: {} });
    await b.commit();
  });
  for (let i = 1; i <= 3; i++) {
    const r = await call('posDev', MGR, { op: 'add', name: 'קופה ' + i, br: '_' });
    assert.equal(r.dev, 'K' + i);
    await call('posDev', CASH[i - 1], { op: 'claim', dev: 'K' + i, inst: inst(i) });
  }
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

function device(i) {
  const dev = 'K' + i, uid = CASH[i - 1];
  const net = { up: true, lose: 0, n: 0 };
  const D = PD.create({
    store: OFF.memStore(), key: 'lp-pos:' + A, timer: { set: (f) => setTimeout(f, 1), clear: clearTimeout },
    dev: () => dev, inst: () => inst(i), br: () => '_', cashier: () => ({ id: uid, name: 'קופאי ' + i }),
    online: () => net.up,
    call: async (fn, data) => {
      if (!net.up) { const e = new Error('אין חיבור לאינטרנט'); e.offline = true; throw e; }
      const r = await call(fn, uid, JSON.parse(JSON.stringify(data)));
      // כל שליחה שלישית: השרת רשם, התשובה לא הגיעה
      if (net.lose && ++net.n % 3 === 0) { const e = new Error('אין חיבור לאינטרנט'); e.offline = true; throw e; }
      return r;
    },
    devSeq: async () => { let v = 0; await prep(async (d) => { v = (await d.doc(`b/${A}/posdev/${dev}`).get()).get('lastSeq') || 0; }); return v; },
    loadProducts: async () => [],
  });
  return { D, net, dev };
}
const saleOf = (i) => { const lines = [{ pid: 'p1', name: 'מטען USB-C', barcode: '7290000000017', price: 4990, qty: 1 + (i % 2), total: 4990 * (1 + (i % 2)) }]; const total = lines[0].total; return { lines, total, vat: Math.round(total * 18 / 118), payments: [{ m: 'cash', a: total }], change: 0 }; };

describe('pos-offline מול posSale האמיתי (אמולטור)', () => {
  it('3 קופות × 30 מכירות בלי רשת, סנכרון במקביל עם תשובות אבודות – אפס כפילויות, אפס חורים', async () => {
    const devs = [1, 2, 3].map(device);
    devs.forEach((x) => { x.net.up = false; });
    for (let i = 0; i < 30; i++) for (const x of devs) await x.D.saveSale(saleOf(i));
    devs.forEach((x) => { x.net.up = true; x.net.lose = 1; });
    await Promise.all(devs.map(async (x) => { x.D.netChanged(true); for (let k = 0; k < 300 && x.D.net().pending; k++) { await x.D.flush(); await new Promise((r) => setTimeout(r, 2)); } }));
    let docs = [], marks = 0, devDocs = {};
    await prep(async (d) => {
      docs = (await d.collection(`b/${A}/possale`).get()).docs.map((s) => s.data());
      marks = (await d.collection(`b/${A}/posreq`).get()).size;
      for (const x of devs) devDocs[x.dev] = (await d.doc(`b/${A}/posdev/${x.dev}`).get()).data();
    });
    assert.equal(docs.length, 90, 'בדיוק 90 מכירות');
    assert.equal(marks, 90);
    assert.equal(new Set(docs.map((s) => s.reqId)).size, 90, 'אין reqId כפול');
    for (const x of devs) {
      const seqs = docs.filter((s) => s.dev === x.dev).map((s) => s.seq).sort((a, b) => a - b);
      assert.deepEqual(seqs, Array.from({ length: 30 }, (_, i) => i + 1), x.dev + ': 1..30');
      assert.equal(devDocs[x.dev].lastSeq, 30);
      const L = await x.D.getSales();
      assert.ok(L.every((s) => s.sync === '✓' && s.srvId === s.id));
      assert.equal(x.D.net().net, 'on');
    }
    assert.ok(docs.every((s) => s.off === true && !s.chk), 'מסומנות "בלי רשת", והסכום שהמכשיר חישב = הסכום בשרת');
  });
});
