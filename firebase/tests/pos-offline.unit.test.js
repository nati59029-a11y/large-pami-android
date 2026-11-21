'use strict';
// POS:M3 – קופה גל 2 (ש3): תור בלי רשת (pos-offline.js) ושכבת הנתונים (pos-data.js) מול שרת מדומה שמקיים את החוזה של posSale
// (functions/pos.js, שלב 0): posreq – אותו reqId = אותה מכירה (dup); seq מהמכשיר – רק הבא בתור (used / gap); inst רשום; מזהה K1-000001.
// הבדיקה המרכזית (אפיון, ש3): 3 קופות × 30 מכירות בלי רשת, ואחר כך סנכרון – אפס כפילויות ואפס חורים,
// גם כשהתשובה מהשרת הולכת לאיבוד אחרי שהמכירה נרשמה, וגם כשהאפליקציה "נסגרת" באמצע השליחה.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const W = path.join(__dirname, '..', '..', 'app-source', 'www');
const OFF = require(path.join(W, 'pos-offline.js'));
const PD = require(path.join(W, 'pos-data.js'));
const K = require('../functions/lib/pos-core');

// ---------- שרת מדומה לפי החוזה ----------
function server() {
  const S = { dev: new Map(), sale: new Map(), req: new Map(), calls: 0 };
  const err = (reason, code) => { const e = new Error(reason); e.code = code || 'failed-precondition'; e.details = { reason }; return e; };
  S.addDev = (dev, inst, lastSeq) => S.dev.set(dev, { inst, on: true, st: 'active', lastSeq: lastSeq || 0 });
  // אותה לוגיקה כמו saleIn: קודם posreq, אחר כך הקופה, אחר כך המספר
  S.posSale = (d) => {
    S.calls++;
    if (K.isPractice(d.reqId) || K.isPractice(d.dev)) throw err('practice', 'invalid-argument');
    if (!K.isReq(d.reqId)) throw err('bad-req', 'invalid-argument');
    if (!K.isDev(d.dev)) throw err('bad-dev', 'invalid-argument');
    if (!K.isInst(d.inst)) throw err('bad-inst', 'invalid-argument');
    if (!K.soldAtOk(d.soldAt, Date.now())) throw err('bad-time', 'invalid-argument');
    if (!Array.isArray(d.lines) || !d.lines.length) throw err('bad-line', 'invalid-argument');
    for (const l of d.lines) for (const k of Object.keys(l)) if (!['pid', 'n', 'bc', 'qty', 'unit', 'disc', 'dpct'].includes(k)) throw err('bad-line', 'invalid-argument');
    const mk = d.dev + '_' + d.reqId;
    if (S.req.has(mk)) return Object.assign({ ok: true, dup: true }, S.req.get(mk));
    const v = S.dev.get(d.dev);
    if (!v) throw err('no-dev', 'not-found');
    if (v.st === 'retired') throw err('retired');
    if (v.on !== true) throw err('dev-off');
    if (v.inst !== d.inst) throw err('dev-taken');
    let seq = v.lastSeq + 1;
    if (d.seq != null) { const c = K.seqCheck(v.lastSeq, d.seq); if (c === 'used') throw err('seq-used'); if (c === 'gap') throw err('seq-gap'); if (c === 'bad') throw err('bad-seq', 'invalid-argument'); seq = d.seq; }
    const id = K.saleId(d.dev, seq), gross = d.lines.reduce((a, l) => a + Math.round(l.unit * l.qty), 0);
    if (S.sale.has(id)) throw new Error('כפילות מזהה – לא אמור לקרות');
    S.sale.set(id, { id, reqId: d.reqId, dev: d.dev, seq, gross, off: d.off === true });
    v.lastSeq = seq;
    S.req.set(mk, { id, seq, gross });
    return { ok: true, id, seq, gross };
  };
  return S;
}
const tick = () => new Promise((r) => setImmediate(r));
const fastTimer = { set: (f) => setTimeout(f, 1), clear: (t) => clearTimeout(t) };
const offErr = () => { const e = new Error('אין חיבור לאינטרנט'); e.offline = true; return e; };

// מכשיר קופה: ליבה של pos-data עם אחסון משלו, רשת שאפשר לכבות, ושרת משותף
function device(S, dev, o) {
  o = o || {};
  const st = o.store || OFF.memStore();
  const net = o.net || { up: true, lose: 0, rnd: mulberry(dev.charCodeAt(1) * 7919) };
  const inst = 'inst_' + dev.toLowerCase() + '_aaaaaaaaaaaaaaaa';
  if (!S.dev.has(dev)) S.addDev(dev, inst);
  const deps = {
    store: st, key: 'lp-pos:biz1', timer: fastTimer,
    dev: () => dev, inst: () => inst, br: () => '_', cashier: () => ({ id: 'u_' + dev, name: 'קופאי ' + dev }),
    online: () => net.up,
    call: async (fn, data) => {
      await tick();
      if (!net.up) throw offErr();
      assert.equal(fn, 'posSale');
      const r = S.posSale(JSON.parse(JSON.stringify(data)));
      // התשובה הלכה לאיבוד אחרי שהשרת כבר רשם (נפילת רשת באמצע)
      if (net.lose && net.rnd() < net.lose) throw offErr();
      return r;
    },
    devSeq: async () => { if (!net.up) throw offErr(); return S.dev.get(dev).lastSeq; },
    loadProducts: async () => [{ id: 'p1', name: 'חלב 3% 1 ליטר', price: 6.9, barcode: '7290000000015', sku: '1' }, { id: 'p2', name: 'לחם אחיד', price: 8.5, barcode: '7290000000022' }],
  };
  const D = PD.create(deps);
  return { D, st, net, deps, inst };
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const saleOf = (i) => {
  const lines = [{ pid: 'p1', name: 'חלב 3% 1 ליטר', barcode: '7290000000015', price: 690, qty: 1 + (i % 3), total: 690 * (1 + (i % 3)) }, { pid: 'p2', name: 'לחם אחיד', barcode: '7290000000022', price: 850, qty: 1, total: 850 }];
  const total = lines.reduce((a, l) => a + l.total, 0);
  return { lines, total, vat: Math.round(total * 18 / 118), items: lines.reduce((a, l) => a + l.qty, 0), payments: [{ m: 'cash', a: total }], change: 0 };
};
async function drain(D, max) { for (let i = 0; i < (max || 200) && D.net().pending; i++) { await D.flush(); await new Promise((r) => setTimeout(r, 2)); } }
function checkServer(S, devs, n) {
  for (const d of devs) {
    const list = [...S.sale.values()].filter((s) => s.dev === d).map((s) => s.seq).sort((a, b) => a - b);
    assert.deepEqual(list, Array.from({ length: n }, (_, i) => i + 1), `קופה ${d}: מספרים 1..${n} בלי חור ובלי כפילות`);
    assert.equal(S.dev.get(d).lastSeq, n);
  }
  const reqs = [...S.sale.values()].map((s) => s.reqId);
  assert.equal(new Set(reqs).size, reqs.length, 'אין שתי מכירות עם אותו reqId');
  assert.equal(S.sale.size, devs.length * n);
}

describe('pos-offline – התור', () => {
  it('פריט נשמר באחסון לפני שהפעולה חוזרת; אותו reqId פעמיים = פריט אחד', async () => {
    const st = OFF.memStore(); let sent = 0;
    const q = OFF.queue({ store: st, key: 'k', online: () => false, timer: fastTimer, send: async () => { sent++; return { id: 'x' }; } });
    const it = q.add({ reqId: 'req001', fn: 'posSale', payload: { a: 1 } }, { seq: true });
    assert.equal(it.seq, 1);
    assert.match(st.get('k:q'), /req001/);
    q.add({ reqId: 'req001', fn: 'posSale', payload: { a: 1 } }, { seq: true });
    assert.equal(q.pending(), 1);
    assert.equal(q.seq(), 1, 'לחיצה כפולה לא צורכת מספר');
    await q.flush();
    assert.equal(sent, 0, 'בלי רשת – לא שולח');
    assert.equal(q.status().net, 'off');
    assert.equal(q.mark('req001'), '⏳');
  });
  it('אחרי "סגירת האפליקציה" התור נטען מהאחסון וממשיך מאותו מספר', async () => {
    const st = OFF.memStore();
    const q1 = OFF.queue({ store: st, key: 'k', online: () => false, timer: fastTimer, send: async () => ({}) });
    q1.add({ reqId: 'req001', fn: 'posSale', payload: {} }, { seq: true });
    q1.add({ reqId: 'req002', fn: 'posSale', payload: {} }, { seq: true });
    const got = [];
    const q2 = OFF.queue({ store: st, key: 'k', online: () => true, timer: fastTimer, send: async (it) => { got.push([it.reqId, it.payload.seq]); return { id: 'K1-' + it.payload.seq, seq: it.payload.seq }; } });
    assert.equal(q2.pending(), 2);
    assert.equal(q2.add({ reqId: 'req003', fn: 'posSale', payload: {} }, { seq: true }).seq, 3);
    await q2.flush(); await q2.flush();
    assert.deepEqual(got, [['req001', 1], ['req002', 2], ['req003', 3]], 'נשלח לפי הסדר');
    assert.equal(q2.status().net, 'on');
    assert.equal(q2.mark('req002'), '✓');
  });
  it('שגיאה קבועה עוצרת את התור (נורית אדומה), retryErr ממשיך', async () => {
    let off = true;
    const q = OFF.queue({ store: OFF.memStore(), key: 'k', online: () => true, timer: fastTimer,
      send: async () => { if (off) { const e = new Error('הקופה מושבתת'); e.code = 'failed-precondition'; e.details = { reason: 'dev-off' }; throw e; } return { id: 'x' }; } });
    q.add({ reqId: 'req001', fn: 'posSale', payload: {} }, { seq: true });
    q.add({ reqId: 'req002', fn: 'posSale', payload: {} }, { seq: true });
    await q.flush();
    assert.equal(q.status().net, 'err');
    assert.equal(q.status().err.reason, 'dev-off');
    assert.equal(q.mark('req001'), '!');
    assert.equal(q.mark('req002'), '⏳', 'הבא בתור לא נשלח – המספור נשאר רציף');
    off = false;
    await q.retryErr(); await q.flush();
    assert.equal(q.pending(), 0);
  });
  it('שגיאה זמנית (שרת 503 / internal) – ממתין ומנסה שוב, לא מסמן שגיאה', async () => {
    let n = 0;
    const q = OFF.queue({ store: OFF.memStore(), key: 'k', online: () => true, timer: fastTimer,
      send: async () => { if (++n < 3) { const e = new Error('שגיאה בפעולה'); e.code = 'internal'; e.details = { reason: 'internal' }; throw e; } return { id: 'x' }; } });
    q.add({ reqId: 'req001', fn: 'posSale', payload: {} });
    await q.flush();
    assert.equal(q.status().net, 'sync');
    for (let i = 0; i < 20 && q.pending(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(q.pending(), 0);
    assert.equal(n, 3);
  });
  it('flush שנקרא כמה פעמים במקביל – כל פריט נשלח פעם אחת', async () => {
    const seen = [];
    const q = OFF.queue({ store: OFF.memStore(), key: 'k', online: () => true, timer: fastTimer, send: async (it) => { seen.push(it.reqId); await tick(); return { id: it.reqId }; } });
    for (let i = 0; i < 10; i++) q.add({ reqId: 'req00' + i, fn: 'posSale', payload: {} }, { seq: true });
    await Promise.all([q.flush(), q.flush(), q.flush(), q.flush()]);
    await q.flush();
    assert.equal(seen.length, 10);
    assert.equal(new Set(seen).size, 10);
  });
  it('סל שנשמר: נטען אחרי פתיחה מחדש, ומתנקה', () => {
    const st = OFF.memStore();
    OFF.cart({ store: st, key: 'k' }).save([{ pid: 'p1', qty: 2 }]);
    assert.deepEqual(OFF.cart({ store: st, key: 'k' }).load(), [{ pid: 'p1', qty: 2 }]);
    OFF.cart({ store: st, key: 'k' }).save([]);
    assert.deepEqual(OFF.cart({ store: st, key: 'k' }).load(), []);
  });
  it('נורית: ארבעה מצבים, עם מספר הממתינים', () => {
    assert.match(OFF.light({ net: 'on', pending: 0 }), /מחובר/);
    assert.match(OFF.light({ net: 'off', pending: 4 }), /אין רשת \(4\)/);
    assert.match(OFF.light({ net: 'sync', pending: 2 }), /שולח \(2\)/);
    assert.match(OFF.light({ net: 'err', pending: 1 }), /בעיה בשליחה/);
    assert.ok(OFF.transient(offErr()));
    assert.ok(!OFF.transient(Object.assign(new Error('x'), { code: 'invalid-argument', details: { reason: 'bad-line' } })));
  });
});

describe('pos-data – מכירה בלי רשת וסנכרון (מול החוזה של posSale)', () => {
  it('3 קופות × 30 מכירות בלי רשת, ואחר כך סנכרון – אפס כפילויות ואפס חורים', async () => {
    const S = server();
    const devs = ['K1', 'K2', 'K3'].map((d) => device(S, d));
    devs.forEach((x) => { x.net.up = false; });
    const rc = { K1: [], K2: [], K3: [] };
    for (let i = 0; i < 30; i++) for (const x of devs) { const r = await x.D.saveSale(saleOf(i)); rc[x.deps.dev()].push(r); }
    assert.equal(S.calls, 0, 'בלי רשת – אף קריאה לא הגיעה לשרת');
    for (const x of devs) {
      const d = x.deps.dev();
      assert.deepEqual(rc[d].map((r) => r.id), Array.from({ length: 30 }, (_, i) => K.saleId(d, i + 1)), 'מספר קבלה ידוע מיד, רציף');
      assert.ok(rc[d].every((r) => r.sync === '⏳'));
      assert.equal(x.D.net().net, 'off');
      assert.equal(x.D.net().pending, 30);
      assert.equal((await x.D.dayStats()).sales, 30);
    }
    // הרשת חוזרת – בכל הקופות במקביל
    devs.forEach((x) => { x.net.up = true; });
    await Promise.all(devs.map((x) => { x.D.netChanged(true); return drain(x.D); }));
    checkServer(S, ['K1', 'K2', 'K3'], 30);
    for (const x of devs) {
      const L = await x.D.getSales();
      assert.equal(L.length, 30);
      assert.ok(L.every((s) => s.sync === '✓'), 'סימן ✓ לכל מכירה');
      assert.ok(L.every((s) => s.srvId === s.id), 'המזהה בקבלה = המזהה בשרת');
      assert.equal(x.D.net().net, 'on');
    }
    assert.ok([...S.sale.values()].every((s) => s.off === true), 'מסומנות כמכירות בלי רשת');
  });

  it('אותו דבר, כשהתשובה מהשרת הולכת לאיבוד ב-40% מהשליחות (השרת כבר רשם) – אותו reqId נשלח שוב, השרת מחזיר dup', async () => {
    const S = server();
    const devs = ['K1', 'K2', 'K3'].map((d) => device(S, d));
    devs.forEach((x) => { x.net.up = false; });
    for (let i = 0; i < 30; i++) for (const x of devs) await x.D.saveSale(saleOf(i));
    devs.forEach((x) => { x.net.up = true; x.net.lose = 0.4; });
    await Promise.all(devs.map((x) => drain(x.D, 1000)));
    checkServer(S, ['K1', 'K2', 'K3'], 30);
    for (const x of devs) assert.equal(x.D.net().pending, 0);
    assert.ok([...S.req.values()].length === 90);
    assert.ok(S.calls > 90, 'היו שליחות חוזרות (' + S.calls + ')');
  });

  it('האפליקציה נסגרת באמצע הסנכרון ונפתחת מחדש מאותו אחסון – אין כפילות ואין חור', async () => {
    const S = server();
    const a = device(S, 'K1');
    a.net.up = false;
    for (let i = 0; i < 30; i++) await a.D.saveSale(saleOf(i));
    a.net.up = true; a.net.lose = 0.5;
    await a.D.flush(); await a.D.flush(); // חלק נשלח, חלק "נשלח" בלי תשובה
    // "סגירה": מכשיר חדש מאותו אחסון ואותה רשת
    const b = device(S, 'K1', { store: a.st, net: a.net });
    b.net.lose = 0;
    await drain(b.D);
    checkServer(S, ['K1'], 30);
    assert.equal((await b.D.getSales()).filter((s) => s.sync === '✓').length, 30);
    // מכירה חדשה אחרי הפתיחה – המספר הבא
    const r = await b.D.saveSale(saleOf(99));
    assert.equal(r.id, 'K1-000031');
    await drain(b.D);
    assert.equal(S.dev.get('K1').lastSeq, 31);
  });

  it('מכירות עם רשת ובלי רשת לסירוגין – רצף אחד', async () => {
    const S = server();
    const x = device(S, 'K2');
    for (let i = 0; i < 20; i++) { x.net.up = i % 3 !== 0; x.D.netChanged(x.net.up); await x.D.saveSale(saleOf(i)); if (x.net.up) await x.D.flush(); }
    x.net.up = true; x.D.netChanged(true);
    await drain(x.D);
    checkServer(S, ['K2'], 20);
  });

  it('התנגשות מספרים (המכשיר נוקה והמונה המקומי מאחור) – ממוספר מחדש מהמונה בשרת, הקבלה מתעדכנת', async () => {
    const S = server();
    S.addDev('K3', 'inst_k3_aaaaaaaaaaaaaaaa', 5); // בשרת כבר 5 מכירות
    const x = device(S, 'K3');
    x.net.up = false;
    const r1 = await x.D.saveSale(saleOf(1)), r2 = await x.D.saveSale(saleOf(2));
    assert.equal(r1.id, 'K3-000001');
    x.net.up = true;
    await drain(x.D);
    assert.equal(S.dev.get('K3').lastSeq, 7);
    const s1 = await x.D.getSale('K3-000006');
    assert.equal(s1.reqId, r1.reqId);
    assert.equal(s1.no0, 1, 'המספר הקודם נשמר');
    assert.equal((await x.D.getSale(7)).reqId, r2.reqId);
    assert.equal(x.D._q().seq(), 7);
  });

  it('עם רשת – המונה המקומי מתיישר למונה בשרת לפני המכירה הראשונה', async () => {
    const S = server();
    S.addDev('K1', 'inst_k1_aaaaaaaaaaaaaaaa', 41);
    const x = device(S, 'K1');
    const r = await x.D.saveSale(saleOf(1));
    assert.equal(r.id, 'K1-000042');
    await drain(x.D);
    assert.equal((await x.D.getSale(42)).sync, '✓');
  });

  it('הנתונים שנשלחים תואמים את החוזה: רק השדות המותרים, unit באגורות, gross = סה"כ הקופה', async () => {
    const S = server(); const x = device(S, 'K1'); let sent;
    const call0 = x.deps.call; x.deps.call = async (fn, d) => { sent = d; return call0(fn, d); };
    const s = saleOf(4);
    await x.D.saveSale(s); await drain(x.D);
    assert.deepEqual(Object.keys(sent).sort(), ['dev', 'gross', 'inst', 'lines', 'off', 'reqId', 'seq', 'soldAt']);
    assert.equal(sent.gross, s.total);
    assert.deepEqual(sent.lines[0], { pid: 'p1', n: 'חלב 3% 1 ליטר', qty: 2, unit: 690, bc: '7290000000015' });
    assert.ok(K.isReq(sent.reqId));
    assert.equal([...S.sale.values()][0].gross, s.total);
  });

  it('מכשיר לא רשום כקופה – מצב תרגול: מספרי T, לא נשלח לשרת', async () => {
    const S = server(); const x = device(S, 'K1');
    x.deps.dev = () => '';
    const r = await x.D.saveSale(saleOf(1));
    assert.equal(r.id, 'T000001');
    assert.ok(K.isPractice(r.id));
    await x.D.flush();
    assert.equal(S.calls, 0);
    assert.equal((await x.D.getSales())[0].sync, 'T');
  });

  it('ממשק זהה ל-pos-data-mock: מוצרים באגורות, חיפוש, ברקוד, החזרה ונתוני היום', async () => {
    const S = server(); const x = device(S, 'K1');
    const P = await x.D.getProducts();
    assert.deepEqual(P.map((p) => [p.id, p.price]).sort(), [['p1', 690], ['p2', 850]]);
    assert.equal((await x.D.byBarcode('7290000000015')).id, 'p1');
    assert.equal((await x.D.search('לחמ'))[0].id, 'p2');
    assert.equal(x.D.searchSync('חלב')[0].id, 'p1');
    const sess = await x.D.getSession();
    assert.equal(sess.cashier.id, 'u_K1');
    assert.ok(sess.shift.id && sess.shift.no === 1);
    const r = await x.D.saveSale(saleOf(0));
    const ret = await x.D.saveReturn({ saleNo: r.no, lines: [{ pid: 'p1', qty: 1, price: 690, total: 690 }], total: 690, vat: 105, method: 'cash' });
    assert.ok(ret.id && ret.no === 1);
    assert.deepEqual(await x.D.returnedQty(r.no), { p1: 1 });
    const st = await x.D.dayStats();
    assert.equal(st.sales, 1); assert.equal(st.returns, 1); assert.equal(st.returnsTotal, 690);
    for (const k of ['getSession', 'getProducts', 'search', 'searchSync', 'byBarcode', 'saveSale', 'getSales', 'getSale', 'returnedQty', 'saveReturn', 'dayStats', 'normalize']) assert.equal(typeof x.D[k], 'function', k);
  });

  it('toProd: מחיר סניף קודם, מוצר כבוי לא נכנס, שקלים → אגורות בלי שגיאת נקודה צפה', () => {
    assert.equal(PD.toProd({ id: 'a', name: 'x', price: 19.9 }, '_').price, 1990);
    assert.equal(PD.toProd({ id: 'a', name: 'x', price: 1.15 }, '_').price, 115);
    assert.equal(PD.toProd({ id: 'a', name: 'x', price: 10, bp: { b1: 9.5 } }, 'b1').price, 950);
    assert.equal(PD.toProd({ id: 'a', name: 'x', price: 10, on: false }, '_'), null);
    assert.equal(PD.toProd({ id: 'a', name: 'x', price: 'abc' }, '_'), null);
    // POS:W2: הקטגוריה עוברת (אריחים, מבצע על קטגוריה)
    assert.equal(PD.toProd({ id: 'a', name: 'x', price: 10, cat: 'c7' }, '_').cat, 'c7');
    assert.equal(PD.toProd({ id: 'a', name: 'x', price: 10 }, '_').cat, '');
    // ברקודים נוספים: bcs (קופה) + bcx (משניים מכספית), בלי הראשי ובלי כפולים
    assert.deepEqual(PD.toProd({ id: 'a', name: 'x', price: 10, barcode: '111', bcs: ['222', '111'], bcx: ['333', '222', ' '] }, '_').bx, ['222', '333']);
    assert.deepEqual(PD.toProd({ id: 'a', name: 'x', price: 10 }, '_').bx, []);
  });

  it('POS:W2: תור עם skipErr – שגיאה קבועה לא עוצרת את הבאים; drop מוציא פריט שנדחה; התשובה שומרת את המסמכים', async () => {
    const st = OFF.memStore();
    const sent = [];
    const q = OFF.queue({ store: st, key: 't', timer: fastTimer, skipErr: true, send: async (it) => { sent.push(it.reqId); if (it.payload.bad) { const e = new Error('נדחה'); e.code = 'failed-precondition'; e.details = { reason: 'ret-qty' }; throw e; } return { id: 'K1-R00000' + sent.length, amt: 100, docs: [{ t: 'cr', id: 'crD-K1-1', no: 7, extra: 'x' }] }; } });
    q.add({ reqId: 'a1', fn: 'posReturn', payload: { bad: true } });
    q.add({ reqId: 'a2', fn: 'posReturn', payload: {} });
    await q.flush(); await tick(); await q.flush();
    assert.equal(q.mark('a1'), '!'); assert.equal(q.mark('a2'), '✓');
    assert.deepEqual(q.item('a2').res.docs, [{ t: 'cr', id: 'crD-K1-1', no: 7 }]);
    assert.equal(q.item('a2').res.amt, 100);
    assert.equal(q.drop('a1'), 1); assert.equal(q.item('a1'), null);
    assert.equal(q.drop('a2'), 0, 'פריט שנשלח לא נמחק');
    assert.equal(q.status().net, 'on');
  });
});

// POS:W2 סבב 2 – ליקויים 3–5: מכירה שנדחתה (אישור) לא עוצרת את התור; החזרה על מכירה שלא נשלחה לא חוסמת החזרות אחרות;
// החזרה שממתינה לא נרשמת במכשיר עד שהשרת מאשר, ותשובה ברקע מגיעה לממשק (onRet)
describe('POS:W2 – תור מכירות והחזרות: דחייה לא עוצרת, החזרה ממתינה לא נספרת', () => {
  function rig() {
    const S = server();
    const R = { rets: new Map(), n: 0, saleDown: false, sent: [] };
    const errOf = (reason, code) => { const e = new Error(reason); e.code = code || 'failed-precondition'; e.details = { reason }; return e; };
    S.posReturn = (d) => {
      if (R.rets.has(d.reqId)) return Object.assign({ dup: true }, R.rets.get(d.reqId));
      if (!S.sale.has(d.sale)) throw errOf('no-sale', 'not-found');
      if (d.why === 'BAD') throw errOf('ret-over-method');
      R.n += 1; const amt = (d.refunds || []).reduce((a, x) => a + x.amt, 0) || 100;
      const r = { ok: true, id: d.dev + '-R' + String(R.n).padStart(6, '0'), amt, refunds: [{ m: 'cash', src: 'cash', amt }], docs: [{ t: 'cr', id: 'cr' + R.n, no: R.n }] };
      R.rets.set(d.reqId, r); return r;
    };
    const net = { up: true };
    const ev = { rej: [], ret: [] };
    const inst = 'inst_k1_aaaaaaaaaaaaaaaa'; S.addDev('K1', inst);
    const D = PD.create({
      store: OFF.memStore(), key: 'lp-pos:biz1', timer: fastTimer, dev: () => 'K1', inst: () => inst, br: () => '_', cashier: () => ({ id: 'u1', name: 'x' }), online: () => net.up,
      call: async (fn, data) => {
        await tick();
        if (!net.up) throw offErr();
        const d = JSON.parse(JSON.stringify(data));
        if (fn === 'posSale') {
          R.sent.push(d);
          if (R.saleDown) throw errOf('internal', 'unavailable');
          if (d.note === 'OLD') throw errOf('ap-old', 'permission-denied');
          return S.posSale(d);
        }
        assert.equal(fn, 'posReturn'); assert.equal(d._sr, undefined); assert.equal(d._m, undefined, 'שדות המכשיר לא נשלחים');
        return S.posReturn(d);
      },
      devSeq: async () => S.dev.get('K1').lastSeq,
      loadProducts: async () => [],
      onReject: (x) => ev.rej.push(x), onRet: (x) => ev.ret.push(x),
    });
    return { S, R, D, net, ev };
  }
  const sl = (note) => ({ lines: [{ pid: 'p1', name: 'חלב', price: 690, qty: 1, total: 690 }], total: 690, pays: [{ m: 'cash', amt: 690 }], note: note || '' });
  const retOf = (s, o) => Object.assign({ sale: s.id, saleReq: s.reqId, saleNo: s.no, items: [{ i: 0, qty: 1 }], why: 'לא מתאים', tag: true, refunds: [{ m: 'cash', amt: 690 }], lines: [{ pid: 'p1', qty: 1 }], total: 690, wait: 300 }, o || {});
  const drainAll = async (D) => { for (let i = 0; i < 300 && (D.net().pending || D.retPending()); i++) { await D.flush(); await new Promise((r) => setTimeout(r, 3)); } };

  it('אישור מאוחר (הכרעה 18.11): שליחה ראשונה מקוונת – בלי rs; שליחה חוזרת מהתור – rs:true (השרת מקבל בה אישור שהיה תקף ברגע המכירה)', async () => {
    const { R, D } = rig();
    await D.saveSale(sl()); await drainAll(D);
    assert.equal(R.sent.length, 1); assert.equal(R.sent[0].rs, undefined); assert.equal(R.sent[0].off, false);
    R.saleDown = true;
    await D.saveSale(sl()); await D.flush();
    R.saleDown = false; await drainAll(D);
    const two = R.sent.filter((x) => x.seq === 2);
    assert.ok(two.length >= 2, 'נשלחה פעמיים'); assert.equal(two[0].rs, undefined); assert.equal(two[two.length - 1].rs, true);
    assert.equal(D.net().pending, 0);
  });

  it('ליקוי 3: מכירה שהשרת דחה בגלל אישור – יוצאת ל"מכירות שנדחו" (lp-pos-err), נורית אדומה, הודעה, והמכירות שאחריה נשלחות ברצף בלי חור', async () => {
    const { S, D, net, ev } = rig();
    net.up = false;
    await D.saveSale(sl()); await D.saveSale(sl('OLD')); await D.saveSale(sl());
    net.up = true; D.netChanged(true); await drainAll(D);
    assert.equal(D.net().pending, 0, 'התור לא נעצר');
    assert.deepEqual([...S.sale.values()].map((x) => x.seq).sort(), [1, 2], 'בשרת – 1, 2 בלי חור');
    const rj = D.rejected();
    assert.equal(rj.length, 1); assert.equal(rj[0].reason, 'ap-old');
    assert.equal(D.net().net, 'err', 'נורית אדומה'); assert.equal(D.net().rej, 1);
    assert.equal(ev.rej.length, 1); assert.equal(ev.rej[0].reason, 'ap-old');
    const all = await D.getSales();
    assert.equal(all.filter((x) => x.sync === '!').length, 1); assert.equal(all.filter((x) => x.sync === '✓').length, 2);
    assert.equal((await D.dayStats()).sales, 2, 'המכירה שנדחתה לא בסיכום');
    assert.equal((await D.getSale(2)).sync, '✓', 'מספר 2 – המכירה שנשלחה, לא זו שנדחתה');
    D.ackRejected(); assert.equal(D.net().net, 'on');
  });

  it('ליקוי 4: החזרה על מכירה שעוד בתור לא חוסמת החזרה אחרת; נשלחת לבד כשהמכירה יוצאת; החזרה על מכירה שנדחתה – נדחית מיד', async () => {
    const { S, R, D } = rig();
    const s0 = await D.saveSale(sl()); await drainAll(D);
    const S0 = await D.getSale(s0.no);
    R.saleDown = true;
    const a = await D.saveSale(sl()); const A = await D.getSale(a.no);
    const pa = await D.returnSrv(retOf(A));
    assert.equal(pa.pend, true);
    const p0 = await D.returnSrv(retOf(S0));
    assert.ok(p0.res && p0.res.id, 'ההחזרה על המכירה שכבר נשלחה – יצאה, למרות שהחזרה קודמת מחכה');
    R.saleDown = false; await drainAll(D);
    assert.equal(D.retItem(pa.reqId).st, 'ok', 'ההחזרה שחיכתה נשלחה אחרי המכירה');
    assert.equal(R.rets.size, 2); assert.ok(S.sale.has(A.id));
    const b = await D.saveSale(sl('OLD')); await drainAll(D);
    const B = (await D.getSales()).find((x) => x.reqId === b.reqId);
    await assert.rejects(D.returnSrv(Object.assign(retOf(B), { saleNo: undefined })), (e) => e.reason === 'sale-rej');
    assert.equal(D.retPending(), 0);
  });

  it('ליקוי 5: החזרה ממתינה לא נספרת עד אישור; אישור ברקע – onRet ok ונספרת; דחייה ברקע – onRet err, לא נספרת ולא נשארת בתור', async () => {
    const { D, net, ev } = rig();
    const s = await D.saveSale(sl()); await drainAll(D);
    const S1 = await D.getSale(s.no);
    net.up = false;
    const p = await D.returnSrv(retOf(S1));
    assert.equal(p.pend, true);
    assert.equal((await D.dayStats()).returns, 0, 'לא בדוח היום לפני אישור');
    assert.deepEqual(await D.returnedQty(S1.no), {});
    const bad = await D.returnSrv(retOf(S1, { why: 'BAD' }));
    assert.equal(bad.pend, true);
    net.up = true; D.netChanged(true); await drainAll(D);
    const ok = ev.ret.find((x) => x.reqId === p.reqId), no = ev.ret.find((x) => x.reqId === bad.reqId);
    assert.equal(ok.st, 'ok'); assert.equal(ok.res.amt, 690); assert.equal(ok.res.refunds[0].m, 'cash');
    assert.equal(no.st, 'err'); assert.equal(no.reason, 'ret-over-method');
    const st = await D.dayStats();
    assert.equal(st.returns, 1); assert.equal(st.returnsTotal, 690);
    assert.deepEqual(await D.returnedQty(S1.no), { p1: 1 });
    assert.equal(D.retPending(), 0); assert.equal(D.retItem(bad.reqId), null);
    // החזרה שהשרת אישר מול המסך – לא מגיעה שוב כאירוע רקע
    const fgr = await D.returnSrv(retOf(S1, { refunds: [{ m: 'cash', amt: 1 }] }));
    assert.ok(fgr.res); assert.equal(ev.ret.filter((x) => x.reqId === fgr.reqId).length, 0);
  });
});
