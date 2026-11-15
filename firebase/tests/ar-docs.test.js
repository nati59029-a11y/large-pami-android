'use strict';
// חשבוניות, קבלות וזיכויים (15.11.2026, שלב 4): lib/ar-doc.js + ar.js (arIssue, arReceipt, arCredit, arVoidRc, arProof, arProofGet, arDoc, arMonthly, setArOff)
// והחיבור ל-setOrderStatus / markOrderPaid (orders.js). רץ מול האמולטור, חלק מ-test:multibiz. ווטסאפ – wa-mock בלבד; מייל – סודות דמה (לא נשלח).
// בכל תרחיש: סך החובה פחות סך הזכות, מחושב מחדש מכל המסמכים = cust.ar.bal (קריטריון 3), ותוכן מסמך לא משתנה אחרי שהופק.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const WM = require('./wa-mock');

const A = 'biz-ard';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'ard_mgr', E1 = 'ard_e1', E2 = 'ard_e2', NOORD = 'ard_no', SUPER = 'ard_super';
const WS = 'cWS', WI = 'cWI', PR = 'cPR';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 'OK', r.text); return r.result; };
let env, n = 0;
const rid = () => 'req' + Date.now().toString(36) + (n++) + 'xx';
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function all(c) { let v = []; await prep(async (d) => { const q = await d.collection(`b/${A}/${c}`).get(); v = q.docs.map((s) => Object.assign({ id: s.id }, s.data())); }); return v; }
const MUT = ['open', 'st', 'sent', 'void', 'dueX', 'upd'];
const content = (x) => JSON.stringify(Object.keys(x).filter((k) => !MUT.includes(k)).sort().map((k) => [k, x[k]]));

async function seed(extra) {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: 'עסק בדיקה', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: ALL,
      org: { v: 1, branches: [{ id: 'br1', name: 'נחל לכיש', on: true, sig: [] }, { id: 'br2', name: 'יהודה הנשיא', on: true, sig: [] }], banks: [], cards: [] } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true, br: ['br1'] });
    b.set(d.doc(`b/${A}/staff/${E2}`), { name: E2, role: 'employee', active: true, br: ['br2'] });
    b.set(d.doc(`b/${A}/staff/${NOORD}`), { name: NOORD, role: 'employee', active: true, perms: NONE });
    for (const [u, role] of [[MGR, 'admin'], [E1, 'worker'], [E2, 'worker'], [NOORD, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/prod/pA`), { name: 'מגש עמוק', price: 89.9, barcode: '', on: true, q: { br1: 1000, br2: 1000 } });
    b.set(d.doc(`b/${A}/prod/pB`), { name: 'כוס', price: 6.25, barcode: '', on: true, q: { br1: 1000, br2: 1000 } });
    b.set(d.doc(`b/${A}/ordcfg/main`), { vat: 18 });
    b.set(d.doc(`b/${A}/cust/${WS}`), { name: 'מסעדת הים', bn: 'מסעדת הים בע"מ', vat: '515555555', phone: '0541111111', mail: 'ws@x.invalid', wholesale: true, terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} });
    b.set(d.doc(`b/${A}/cust/${WI}`), { name: 'קפה מיידי', bn: 'קפה מיידי בע"מ', vat: '516666666', phone: '0543333333', wholesale: true, terms: { b: 'imm', d: 0 }, at: 1, upd: 1, x: {} });
    b.set(d.doc(`b/${A}/cust/${PR}`), { name: 'דנה', phone: '0542222222', at: 1, upd: 1, x: {} });
    b.set(d.doc(`b/${A}/sec_cfg/wa`), { pnid: '1000000099', num: '97230000009' });
    if (extra !== false) b.set(d.doc(`b/${A}/arcfg/main`), Object.assign({ on: true, name: 'לארג׳ פעמי בדיקה', bn: '512345678', addr: 'הרצל 1, אשדוד', phone: '08-1234567', mail: 'biz@x.invalid', foot: 'תודה' }, extra || {}));
    await b.commit();
  });
}
// הזמנה: ללקוח עסקי (vm ex) – מנהל יוצר (בלי מגבלות מחיר), פרטי – עובד
async function order(cust, items, uid) {
  const k = cust === PR ? { name: 'דנה', phone: '0542222222' } : cust === WI ? { name: 'קפה מיידי', phone: '0543333333' } : { name: 'מסעדת הים', phone: '0541111111' };
  const r = await call('createOrder', uid || MGR, { reqId: rid(), br: 'br1', cust: k, custId: cust, items: items || [{ pid: 'pA', qty: 3, price: 89.9 }, { pid: 'pB', qty: 12, price: 6.25 }] });
  assert.equal(r.status, 'OK', r.text);
  return r.result.id;
}
async function ship(id, uid) {
  await ok(call('setOrderStatus', uid || E1, { id, status: 'work' }));
  return ok(call('setOrderStatus', uid || E1, { id, status: 'out' }));
}
const JPG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
async function proof(uid, data) { const r = await ok(call('arProof', uid, { k: 0, np: 1, data: data || JPG })); assert.equal(r.done, true); return r.id; }

// קריטריון 3: חובה − זכות מכל המסמכים = cust.ar.bal; open/cr תואמים; כל חשבונית: gross − הקצאות = open; כל קבלה/זיכוי: gross − הקצאות = open
async function balanced(cid) {
  const docs = (await all('ardoc')).filter((x) => x.cust === cid);
  const al = (await all('aralloc')).filter((a) => !a.void);
  let bal = 0, open = 0, cr = 0;
  for (const x of docs) {
    if (x.t === 'inv') { bal += x.gross; open += x.open; assert.equal(x.gross - al.filter((a) => a.inv === x.id).reduce((s, a) => s + a.amt, 0), x.open, 'חשבונית ' + x.id); }
    if (x.t === 'ir') { bal += x.gross - x.gross; assert.equal(x.open, 0); }
    // החלטה 31: החזר כסף (cr.rf) = חובה שסוגרת את הזכות שנשארה מהזיכוי
    const rf = x.t === 'cr' && x.rf ? x.rf.amt : 0;
    if ((x.t === 'rc' && !x.void) || x.t === 'cr') { bal -= x.gross - rf; cr += x.open; assert.equal(x.gross - al.filter((a) => a.rc === x.id).reduce((s, a) => s + a.amt, 0) - rf, x.open, 'זכות ' + x.id); }
    if (x.t === 'rc' && x.void) assert.equal(x.open, 0);
    for (const k of ['gross', 'net', 'vat', 'open']) assert.ok(Number.isInteger(x[k]), k + ' שלם');
  }
  const c = await get(`b/${A}/cust/${cid}`);
  const a = (c && c.ar) || { bal: 0, open: 0, cr: 0 };
  assert.deepEqual({ bal: a.bal, open: a.open, cr: a.cr }, { bal, open, cr }, 'יתרה מחושבת מחדש = cust.ar');
  assert.equal(bal, open - cr);
  return a;
}

before(async () => { env = await H.getEnv(); await WM.start(); require('../functions/index.js'); });
after(async () => { await WM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(async () => { WM.reset(); await seed(); });

describe('מתג כבוי = אפס שינוי התנהגות', () => {
  it('בלי arcfg/main ועם on:false – setOrderStatus / markOrderPaid מחזירים בדיוק את אותו JSON, בלי מסמכים ובלי שדות חדשים בהזמנה', async () => {
    for (const cfg of [false, { on: false }]) {
      await seed(cfg);
      const a = await order(WS), b = await order(PR, [{ pid: 'pA', qty: 1, price: 89.9 }], E1), c = await order(WI);
      assert.deepEqual(await ok(call('setOrderStatus', E1, { id: a, status: 'work' })), { ok: true, status: 'work' });
      assert.deepEqual(await ok(call('setOrderStatus', E1, { id: a, status: 'out' })), { ok: true, status: 'wait_pay' });
      assert.deepEqual(await ok(call('markOrderPaid', E1, { id: a, method: 'transfer' })), { ok: true, dup: false });
      assert.deepEqual(await ok(call('markOrderPaid', E1, { id: b, method: 'cash' })), { ok: true, dup: false });
      assert.deepEqual(await ok(call('markOrderPaid', E1, { id: c, method: 'cash' })), { ok: true, dup: false });
      assert.deepEqual(await ok(call('setOrderStatus', E1, { id: c, status: 'out' })), { ok: true, status: 'out' });
      assert.deepEqual(await ok(call('unpayOrder', MGR, { id: b, reason: 'בדיקה' })), { ok: true });
      assert.equal((await all('ardoc')).length, 0);
      assert.equal((await all('aralloc')).length, 0);
      for (const id of [a, b, c]) { const o = await get(`b/${A}/ord/${id}`); assert.equal(o.inv, undefined); assert.equal((o.paid || {}).rc, undefined); }
      assert.equal((await get(`b/${A}/cust/${WS}`)).ar, undefined);
      assert.equal((await call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 10, method: 'cash' })).reason, 'ar-off');
    }
  });
});

describe('הפקה אוטומטית מההזמנה (החלטה 22)', () => {
  it('לקוח בשוטף: "נשלח" → חשבונית מס טיוטה, מועד תשלום מתאריך היום, ההזמנה ננעלת; עובד בלי אסמכתא נדחה ב"שולם"; עם אסמכתא – קבלה, הזמנה הושלמה, יתרה 0', async () => {
    const id = await order(WS);
    const r = await ship(id);
    assert.equal(r.status, 'wait_pay');
    assert.equal(r.ar.t, 'inv'); assert.equal(r.ar.no, 1); assert.equal(r.ar.draft, true); assert.equal(r.ar.id, 'invD1');
    const o = await get(`b/${A}/ord/${id}`);
    assert.deepEqual(o.inv, { id: 'invD1', no: 1, t: 'inv', draft: true });
    const inv = await get(`b/${A}/ardoc/invD1`);
    assert.equal(inv.gross, Math.round(o.gross * 100)); assert.equal(inv.vm, 'ex'); assert.equal(inv.rate, 18); assert.equal(inv.cust, WS); assert.equal(inv.ser, 'D');
    assert.equal(inv.terms, 'שוטף+30'); assert.match(inv.due, /^\d{4}-\d{2}-\d{2}$/); assert.ok(inv.due > inv.d);
    assert.equal(inv.custSnap.name, 'מסעדת הים בע"מ'); assert.equal(inv.custSnap.bn, '515555555');
    assert.equal((await get(`b/${A}/arcfg/seq_invD`)).n, 1);
    assert.equal((await call('updateOrder', MGR, { id, note: 'x' })).reason, 'locked');
    assert.equal((await call('cancelOrder', MGR, { id, reason: 'x' })).reason, 'locked');
    let a = await balanced(WS); assert.equal(a.bal, inv.gross);
    // PDF
    const p = await ok(call('arDoc', E1, { id: 'invD1', op: 'pdf' }));
    assert.equal(Buffer.from(p.b64, 'base64').slice(0, 5).toString(), '%PDF-');
    // עובד בלי אסמכתא / עם אסמכתא של עובד אחר – נדחה
    assert.equal((await call('markOrderPaid', E1, { id, method: 'transfer' })).reason, 'need-proof');
    const pf2 = await proof(E2);
    assert.equal((await call('markOrderPaid', E1, { id, method: 'transfer', proofId: pf2 })).reason, 'proof-owner');
    const pf = await proof(E1);
    const m = await ok(call('markOrderPaid', E1, { id, method: 'transfer', proofId: pf }));
    assert.equal(m.ar.t, 'rc'); assert.equal(m.ar.gross, inv.gross);
    const o2 = await get(`b/${A}/ord/${id}`);
    assert.equal(o2.status, 'done'); assert.equal(o2.paid.rc, m.ar.id);
    assert.equal((await get(`b/${A}/ardoc/invD1`)).st, 'paid');
    assert.equal((await get(`b/${A}/arproof/${pf}`)).used, m.ar.id);
    a = await balanced(WS); assert.equal(a.bal, 0);
    // אותה אסמכתא בהזמנה אחרת – נדחית; ביטול "שולם" – רק דרך ביטול הקבלה
    const id2 = await order(WS); await ship(id2);
    assert.equal((await call('markOrderPaid', E1, { id: id2, method: 'transfer', proofId: pf })).reason, 'proof-used');
    assert.equal((await call('unpayOrder', MGR, { id, reason: 'x' })).reason, 'locked');
    // מנהל – גם בלי אסמכתא
    assert.equal((await ok(call('markOrderPaid', MGR, { id: id2, method: 'cash' }))).ar.t, 'rc');
    await balanced(WS);
  });
  it('לקוח פרטי: "שולם" → חשבונית מס קבלה מיד; לקוח עסקי מיידי: אין מסמך ב"שולם", חשבונית מס קבלה כשהסחורה יוצאת', async () => {
    const p = await order(PR, [{ pid: 'pA', qty: 2, price: 89.9 }], E1);
    const r = await ok(call('markOrderPaid', E1, { id: p, method: 'cash' }));
    assert.equal(r.ar.t, 'ir'); assert.equal(r.ar.gross, 17980);
    const ir = await get(`b/${A}/ardoc/${r.ar.id}`);
    assert.equal(ir.vm, 'inc'); assert.equal(ir.vat, Math.round(17980 * 18 / 118)); assert.equal(ir.open, 0); assert.equal(ir.st, 'paid'); assert.equal(ir.pay.m, 'cash');
    assert.equal((await call('unpayOrder', MGR, { id: p, reason: 'x' })).reason, 'locked');
    await balanced(PR);
    const w = await order(WI);
    const m = await ok(call('markOrderPaid', E1, { id: w, method: 'transfer' }));
    assert.equal(m.ar, undefined);
    assert.equal((await get(`b/${A}/ord/${w}`)).inv, undefined);
    const o = await ok(call('setOrderStatus', E1, { id: w, status: 'out' }));
    assert.equal(o.ar.t, 'ir');
    assert.equal((await get(`b/${A}/ord/${w}`)).inv.t, 'ir');
    assert.equal((await call('setOrderStatus', E1, { id: w, status: 'done' })).status, 'OK');
    assert.equal((await all('ardoc')).filter((x) => x.t === 'ir').length, 2, 'בלי מסמך כפול ב"הושלם"');
    await balanced(WI);
  });
  it('שליחה אוטומטית ללקוח מסומן (snd.inv) – גם בטיוטה; "עצור הכל" עוצר; שליחה בלחיצה (arDoc send) עם מזהה בקשה', async () => {
    await prep((d) => d.doc(`b/${A}/arcfg/main`).set({ wt: { oc: '', inv: 'invoice_doc' } }, { merge: true }));
    await ok(call('setArCfg', E1, { cust: WS, snd: { ch: 'wa', oc: false, inv: true, rc: false } }));
    const id = await order(WS);
    const r = await ship(id);
    assert.equal(r.ar.sent.length, 1); assert.equal(r.ar.sent[0].ok, true, JSON.stringify(r.ar.sent));
    const s = WM.sends();
    assert.equal(s.length, 1); assert.equal(s[0].body.template.name, 'invoice_doc');
    const f = await fetch(s[0].body.template.components[0].parameters[0].document.link);
    assert.equal(f.status, 200);
    assert.equal((await get(`b/${A}/ardoc/invD1`)).sent.length, 1);
    const q = rid();
    const a = await ok(call('arDoc', E1, { id: 'invD1', op: 'send', ch: 'wa', reqId: q }));
    assert.equal(a.sent[0].ok, true);
    assert.equal((await ok(call('arDoc', E1, { id: 'invD1', op: 'send', ch: 'wa', reqId: q }))).dup, true);
    assert.equal(WM.sends().length, 2);
    assert.equal((await call('arDoc', E1, { id: 'invD1', op: 'send', ch: 'fax', reqId: rid() })).reason, 'bad-ch');
  });
});

describe('קבלות, תשלום חלקי, זכות וקיזוז (70, 71, 101, 102)', () => {
  it('קבלה חלקית, קבלה על כמה חשבוניות (בחירה), עודף → זכות → קיזוז אוטומטי בחשבונית הבאה; צ׳ק עם פרטים', async () => {
    const i1 = await order(WS), i2 = await order(WS, [{ pid: 'pA', qty: 1, price: 100 }]);
    await ship(i1); await ship(i2);
    const g1 = (await get(`b/${A}/ardoc/invD1`)).gross, g2 = (await get(`b/${A}/ardoc/invD2`)).gross;
    assert.equal(g2, 11800);
    // חלקי: 50 ש"ח לחשבונית 2 (בחירה)
    const r1 = await ok(call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 50, method: 'cash', alloc: [{ inv: 'invD2', amt: 50 }] }));
    assert.equal(r1.left, 0); assert.equal((await get(`b/${A}/ardoc/invD2`)).open, 6800); assert.equal((await get(`b/${A}/ardoc/invD2`)).st, 'part');
    await balanced(WS);
    // בחירה מעל היתרה – נדחה; סכום לחשבוניות גדול מהקבלה – נדחה
    assert.equal((await call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 100, method: 'cash', alloc: [{ inv: 'invD2', amt: 99 }] })).reason, 'bad-alloc');
    assert.equal((await call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 10, method: 'cash', alloc: [{ inv: 'invD2', amt: 20 }] })).reason, 'bad-alloc');
    // צ׳ק: חסרים פרטים – נדחה
    assert.equal((await call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 10, method: 'chq' })).reason, 'bad-chq');
    // צ׳ק על שתי החשבוניות + עודף 25 ש"ח (בלי בחירה – מהמוקדמת)
    const tot = (g1 + 6800 + 2500) / 100;
    const q = rid();
    const r2 = await ok(call('arReceipt', MGR, { reqId: q, cust: WS, amt: tot, method: 'chq', chq: { no: '100234', bank: 'לאומי 10', d: '2026-12-31' } }));
    assert.equal(r2.left, 2500); assert.equal(r2.alloc.length, 2);
    assert.equal((await ok(call('arReceipt', MGR, { reqId: q, cust: WS, amt: tot, method: 'chq', chq: { no: '100234', bank: 'לאומי 10', d: '2026-12-31' } }))).dup, true, 'מזהה בקשה – בלי קבלה כפולה');
    const rc = await get(`b/${A}/ardoc/${r2.id}`);
    assert.deepEqual(rc.pay.chq, { no: '100234', bank: 'לאומי 10', d: '2026-12-31' });
    let a = await balanced(WS); assert.equal(a.bal, -2500); assert.equal(a.cr, 2500);
    // חשבונית הבאה: הזכות מקוזזת לבד
    const i3 = await order(WS, [{ pid: 'pB', qty: 4, price: 10 }]);
    await ship(i3);
    const inv3 = await get(`b/${A}/ardoc/invD3`);
    assert.equal(inv3.gross, 4720); assert.equal(inv3.open, 4720 - 2500); assert.equal(inv3.st, 'part');
    assert.equal((await get(`b/${A}/ardoc/${r2.id}`)).open, 0);
    a = await balanced(WS); assert.equal(a.bal, 2220); assert.equal(a.cr, 0);
    // קבלה ב-PDF: טבלה ולא שורות מוצרים
    const p = await ok(call('arDoc', MGR, { id: r2.id, op: 'pdf' }));
    assert.equal(Buffer.from(p.b64, 'base64').slice(0, 5).toString(), '%PDF-');
  });
  it('עובד: קבלה רק עם אסמכתא שלו (גם במזומן – החלטה 25), פעם אחת; מנהל – בלי; ביטול קבלה – מנהל בלבד, ההקצאות מתבטלות והיתרה חוזרת', async () => {
    const id = await order(WS); await ship(id);
    const g = (await get(`b/${A}/ardoc/invD1`)).gross;
    assert.equal((await call('arReceipt', E1, { reqId: rid(), cust: WS, amt: 20, method: 'cash' })).reason, 'need-proof');
    const pf = await proof(E1);
    assert.equal((await call('arReceipt', E2, { reqId: rid(), cust: WS, amt: 20, method: 'cash', proofId: pf })).reason, 'proof-owner');
    const r = await ok(call('arReceipt', E1, { reqId: rid(), cust: WS, amt: 20, method: 'cash', proofId: pf }));
    assert.equal((await call('arReceipt', E1, { reqId: rid(), cust: WS, amt: 20, method: 'cash', proofId: pf })).reason, 'proof-used');
    assert.equal((await get(`b/${A}/ardoc/${r.id}`)).proof, pf);
    await balanced(WS);
    // ביטול: עובד – נדחה; מנהל – עם סיבה
    assert.equal((await call('arVoidRc', E1, { reqId: rid(), id: r.id, reason: 'טעות' })).reason, 'manager-only');
    assert.equal((await call('arVoidRc', MGR, { reqId: rid(), id: r.id, reason: '' })).reason, 'bad-reason');
    const v = await ok(call('arVoidRc', MGR, { reqId: rid(), id: r.id, reason: 'נרשם פעמיים' }));
    assert.deepEqual(v.reopened, ['invD1']);
    const rc = await get(`b/${A}/ardoc/${r.id}`);
    assert.equal(rc.st, 'void'); assert.equal(rc.void.why, 'נרשם פעמיים'); assert.equal(rc.no, 1, 'המספר נשמר');
    assert.equal((await get(`b/${A}/ardoc/invD1`)).open, g);
    assert.equal((await all('aralloc')).every((x) => x.void === true), true);
    const a = await balanced(WS); assert.equal(a.bal, g);
    // קבלה שנרשמה ב"שולם" – ביטול מחזיר את ההזמנה ל"ממתין לתשלום"
    const m = await ok(call('markOrderPaid', MGR, { id, method: 'cash' }));
    await ok(call('arVoidRc', MGR, { reqId: rid(), id: m.ar.id, reason: 'הצ׳ק חזר' }));
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.status, 'wait_pay'); assert.equal(o.paid, undefined);
    await balanced(WS);
    // הקובץ המבוטל: arDoc pdf מחזיר את העותק עם "מבוטל"
    assert.equal((await ok(call('arDoc', MGR, { id: r.id, op: 'pdf' }))).void, true);
  });
});

describe('זיכוי (72, 73, החלטה 11)', () => {
  it('זיכוי חלקי לפי שורות עם החזרה למלאי, זיכוי סכום, זיכוי מלא של היתרה; מעבר לחשבונית – נדחה; עובד מסניף אחר – נדחה', async () => {
    const id = await order(WS); await ship(id);
    const inv = await get(`b/${A}/ardoc/invD1`);
    const q0 = (await get(`b/${A}/prod/pB`)).q.br1;
    assert.equal((await call('arCredit', E2, { reqId: rid(), inv: 'invD1', mode: 'full', reason: 'x' })).reason, 'foreign-br');
    assert.equal((await call('arCredit', E1, { reqId: rid(), inv: 'invD1', mode: 'full', reason: '' })).reason, 'bad-reason');
    // 2 כוסות מתוך 12, עם החזרה למלאי
    const c1 = await ok(call('arCredit', E1, { reqId: rid(), inv: 'invD1', mode: 'lines', lines: [{ i: 1, q: 2 }], restock: true, reason: 'שבורות' }));
    assert.equal(c1.gross, 1475); // 2×6.25 = 12.50 + 18% = 14.75
    assert.equal((await get(`b/${A}/prod/pB`)).q.br1, q0 + 2);
    const cr = await get(`b/${A}/ardoc/${c1.id}`);
    assert.equal(cr.ref, 'invD1'); assert.deepEqual(cr.li, [{ i: 1, q: 2 }]); assert.equal(cr.rs, true);
    assert.equal((await get(`b/${A}/ardoc/invD1`)).open, inv.gross - 1475);
    // יותר מהכמות שנשארה – נדחה; בלי החזרה למלאי – המלאי לא זז
    assert.equal((await call('arCredit', E1, { reqId: rid(), inv: 'invD1', mode: 'lines', lines: [{ i: 1, q: 11 }], reason: 'x' })).reason, 'too-much');
    await ok(call('arCredit', MGR, { reqId: rid(), inv: 'invD1', mode: 'lines', lines: [{ i: 1, q: 1 }], reason: 'x' }));
    assert.equal((await get(`b/${A}/prod/pB`)).q.br1, q0 + 2);
    // סכום
    const c3 = await ok(call('arCredit', MGR, { reqId: rid(), inv: 'invD1', mode: 'amt', amt: 10, reason: 'הנחה בדיעבד' }));
    assert.equal(c3.gross, 1000);
    const cr3 = await get(`b/${A}/ardoc/${c3.id}`);
    assert.equal(cr3.vat, Math.round(1000 * 18 / 118));
    // מלא = היתרה (אחרי זיכוי בסכום – לפי סכום)
    const left = (await get(`b/${A}/ardoc/invD1`)).open;
    const c4 = await ok(call('arCredit', MGR, { reqId: rid(), inv: 'invD1', mode: 'full', reason: 'החזרה' }));
    const prevG = 1475 + 738 + 1000; // 1×6.25 + 18% = 7.375 → 7.38
    assert.equal(c4.gross, inv.gross - prevG);
    assert.equal(left, inv.gross - prevG);
    assert.equal((await get(`b/${A}/ardoc/invD1`)).st, 'paid');
    assert.equal((await call('arCredit', MGR, { reqId: rid(), inv: 'invD1', mode: 'amt', amt: 1, reason: 'x' })).reason, 'too-much');
    const a = await balanced(WS); assert.equal(a.bal, 0);
  });
  it('החלטה 29: זיכוי לפי כמויות – 2 מתוך 5, ועוד 3 שמשלימים; חריגה נדחית; זיכוי שסוגר את כל החשבונית = בדיוק היתרה; החשבונית לא מבוטלת; שורת הפניה ב-PDF', async () => {
    const { extract } = require('./pdf-text');
    const PDF = require('../functions/lib/ar-pdf');
    const AR = require('../functions/ar.js')._core;
    // קובצי ה-PDF נשמרים ב-Storage לפי מזהה המסמך, ו-Storage לא מתנקה בין הבדיקות – מספור זיכויים נפרד, כדי לבדוק את הקובץ החדש ולא קובץ crD1 ישן
    await prep((d) => d.doc(`b/${A}/arcfg/seq_crD`).set({ n: 500 }));
    const id = await order(WS, [{ pid: 'pA', qty: 1, price: 12.35 }, { pid: 'pB', qty: 5, price: 6.25 }]);
    const r = await ship(id, E1);
    const inv0 = await get(`b/${A}/ardoc/${r.ar.id}`);
    const cr = (q) => call('arCredit', E1, { reqId: rid(), inv: r.ar.id, mode: 'lines', lines: [{ i: 1, q }], reason: 'החזרה' });
    // 2 מתוך 5
    const c1 = await ok(cr(2));
    assert.equal(c1.gross, 1475); // 2×6.25 = 12.50 + 18%
    assert.deepEqual((await get(`b/${A}/ardoc/${c1.id}`)).li, [{ i: 1, q: 2 }]);
    await balanced(WS);
    // עוד 4 – יותר מה-3 שנשארו – נדחה; אחר כך 3 – עובר (2 + 3 = 5)
    const x4 = await cr(4); assert.equal(x4.reason, 'too-much'); assert.match(x4.text, /עד 3/);
    const c2 = await ok(cr(3)); assert.equal(c2.gross, Math.round(3 * 625 * 1.18));
    await balanced(WS);
    // השורה זוכתה במלואה – גם 1 נדחה; 0 / שלילי – נדחה
    assert.equal((await cr(1)).reason, 'too-much');
    assert.equal((await cr(0)).reason, 'bad-lines');
    // החשבונית המקורית לא בוטלה: התוכן זהה, רק open / st
    const inv1 = await get(`b/${A}/ardoc/${r.ar.id}`);
    assert.equal(content(inv1), content(inv0)); assert.equal(inv1.void, undefined); assert.equal(inv1.st, 'part');
    assert.equal(inv1.open, inv0.gross - c1.gross - c2.gross);
    // זיכוי השורה האחרונה שנשארה – סוגר את כל החשבונית בדיוק (gross − prevG, adj לעיגול)
    const c3 = await ok(call('arCredit', E1, { reqId: rid(), inv: r.ar.id, mode: 'lines', lines: [{ i: 0, q: 1 }], reason: 'החזרה' }));
    assert.equal(c1.gross + c2.gross + c3.gross, inv0.gross);
    const inv2 = await get(`b/${A}/ardoc/${r.ar.id}`); assert.equal(inv2.open, 0); assert.equal(inv2.st, 'paid'); assert.equal(inv2.void, undefined);
    const ds = await Promise.all([c1, c2, c3].map((c) => get(`b/${A}/ardoc/${c.id}`)));
    assert.equal(ds.reduce((s, d) => s + d.net, 0), inv0.net); assert.equal(ds.reduce((s, d) => s + d.vat, 0), inv0.vat);
    assert.equal((await call('arCredit', E1, { reqId: rid(), inv: r.ar.id, mode: 'full', reason: 'x' })).reason, 'nothing-left');
    const a = await balanced(WS); assert.equal(a.bal, 0);
    // שורת ההפניה: המספר המודפס של חשבונית החיוב, עם סימון טיוטה
    assert.equal(AR.refTxt(ds[0].ref, ds[0].bt), `זיכוי לחשבונית מס מספר ${inv0.no} (טיוטה)`);
    assert.equal(AR.refTxt('irO3401', ''), 'זיכוי לחשבונית מס קבלה מספר 3401');
    for (const c of [c1, c3]) {
      const f = await ok(call('arDoc', E1, { id: c.id, op: 'pdf' }));
      const pg = extract(Buffer.from(f.b64, 'base64'))[0];
      assert.ok(pg.some((l) => l.includes(PDF.visual(`זיכוי לחשבונית מס מספר ${inv0.no} (טיוטה)`))), pg.join('\n'));
    }
  });
  it('החלטה 31: החזר כסף – מזומן וזיכוי באשראי על חשבונית מס קבלה (bal=0, via עובר מהתשלום); על חשבונית מס לא משולמת – נדחה; חלקית – רק מה ששולם; PDF והרשאות', async () => {
    const { extract } = require('./pdf-text');
    const PDF = require('../functions/lib/ar-pdf');
    await prep((d) => d.doc(`b/${A}/arcfg/seq_crD`).set({ n: 600 })); // ראו למעלה – קובצי PDF ישנים
    // לקוח פרטי, חשבונית מס קבלה במזומן – החזר מזומן על 1 מתוך 2 (עובד)
    const p1 = await order(PR, [{ pid: 'pA', qty: 2, price: 89.9 }], E1);
    const ir1 = (await ok(call('markOrderPaid', E1, { id: p1, method: 'cash' }))).ar.id;
    assert.equal((await call('arCredit', E1, { reqId: rid(), inv: ir1, mode: 'lines', lines: [{ i: 0, q: 1 }], reason: 'x', refund: { m: 'bitcoin' } })).reason, 'bad-field');
    assert.equal((await call('arCredit', NOORD, { reqId: rid(), inv: ir1, mode: 'lines', lines: [{ i: 0, q: 1 }], reason: 'x', refund: { m: 'cash' } })).reason, 'no-perm');
    const c1 = await ok(call('arCredit', E1, { reqId: rid(), inv: ir1, mode: 'lines', lines: [{ i: 0, q: 1 }], reason: 'החזרה', refund: { m: 'cash' } }));
    assert.deepEqual(c1.rf, { m: 'cash', amt: 8990 }); assert.equal(c1.left, 0);
    const d1 = await get(`b/${A}/ardoc/${c1.id}`); assert.deepEqual(d1.rf, { m: 'cash', amt: 8990 }); assert.equal(d1.open, 0);
    let a = await balanced(PR); assert.equal(a.bal, 0); assert.equal(a.cr, 0);
    const pg = extract(Buffer.from((await ok(call('arDoc', E1, { id: c1.id, op: 'pdf' }))).b64, 'base64'))[0];
    assert.ok(pg.some((l) => l.includes('₪89.90') && l.includes(PDF.visual('הוחזר ללקוח')) && l.includes(PDF.visual('החזר מזומן'))), pg.join('\n'));
    // חשבונית מס קבלה בקישור – זיכוי באשראי (מנהל), via:'link' עובר מהתשלום
    const p2 = await order(PR, [{ pid: 'pB', qty: 4, price: 6.25 }], E1);
    const ir2 = (await ok(call('markOrderPaid', E1, { id: p2, method: 'link' }))).ar.id;
    const c2 = await ok(call('arCredit', MGR, { reqId: rid(), inv: ir2, mode: 'full', reason: 'בוטל', refund: { m: 'card' } }));
    assert.deepEqual(c2.rf, { m: 'card', amt: 2500, via: 'link' });
    a = await balanced(PR); assert.equal(a.bal, 0);
    // חשבונית מס לא משולמת – אין כסף להחזיר; בלי החזר – הזיכוי מוריד את החוב כמו קודם
    const o3 = await order(WS, [{ pid: 'pA', qty: 1, price: 100 }]); const inv3 = (await ship(o3, E1)).ar.id;
    const n3 = await call('arCredit', E1, { reqId: rid(), inv: inv3, mode: 'amt', amt: 10, reason: 'x', refund: { m: 'cash' } });
    assert.equal(n3.reason, 'nothing-paid'); assert.match(n3.text, /לא שולמה/);
    // שולם ₪30 (העברה) מתוך ₪118: זיכוי ₪20 עם החזר – נדחה (רק מוריד את החוב); זיכוי מלא עם החזר – מוחזר בדיוק מה ששולם
    await ok(call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 30, method: 'transfer', alloc: [{ inv: inv3, amt: 30 }] }));
    assert.equal((await call('arCredit', E1, { reqId: rid(), inv: inv3, mode: 'amt', amt: 20, reason: 'x', refund: { m: 'transfer' } })).reason, 'nothing-paid');
    const c3 = await ok(call('arCredit', E1, { reqId: rid(), inv: inv3, mode: 'full', reason: 'החזרה', refund: { m: 'transfer' } }));
    assert.equal(c3.gross, 11800); assert.deepEqual(c3.rf, { m: 'transfer', amt: 3000 });
    assert.equal((await get(`b/${A}/ardoc/${inv3}`)).open, 0);
    a = await balanced(WS); assert.equal(a.bal, 0); assert.equal(a.cr, 0);
    // זיכוי בלי החזר על חשבונית מס קבלה – כמו קודם: זכות פתוחה
    const p4 = await order(PR, [{ pid: 'pB', qty: 1, price: 6.25 }], E1);
    const ir4 = (await ok(call('markOrderPaid', E1, { id: p4, method: 'cash' }))).ar.id;
    const c4 = await ok(call('arCredit', E1, { reqId: rid(), inv: ir4, mode: 'full', reason: 'x' }));
    assert.equal(c4.rf, undefined); assert.equal(c4.left, 625);
    a = await balanced(PR); assert.equal(a.bal, -625);
  });
  it('החלטה 37: ביטול קבלה אחרי החזר כסף על החשבונית שלה – נדחה (rc-refunded); זיכוי בלי החזר – הביטול כמו קודם', async () => {
    const o3 = await order(WS, [{ pid: 'pA', qty: 1, price: 100 }]); const inv3 = (await ship(o3, E1)).ar.id;
    const r3 = await ok(call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 30, method: 'transfer', alloc: [{ inv: inv3, amt: 30 }] }));
    const o4 = await order(WS, [{ pid: 'pA', qty: 1, price: 50 }]); const inv4 = (await ship(o4, E1)).ar.id;
    const r4 = await ok(call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 20, method: 'cash', alloc: [{ inv: inv4, amt: 20 }] }));
    // זיכוי בלי החזר על inv4 – ביטול הקבלה עובר כמו קודם
    await ok(call('arCredit', E1, { reqId: rid(), inv: inv4, mode: 'amt', amt: 5, reason: 'הנחה' }));
    await ok(call('arVoidRc', MGR, { reqId: rid(), id: r4.id, reason: 'טעות' }));
    assert.equal((await get(`b/${A}/ardoc/${r4.id}`)).st, 'void');
    // החזר כסף על inv3 – ביטול הקבלה שלה נחסם, ושום דבר לא משתנה
    const c3 = await ok(call('arCredit', E1, { reqId: rid(), inv: inv3, mode: 'full', reason: 'החזרה', refund: { m: 'transfer' } }));
    assert.deepEqual(c3.rf, { m: 'transfer', amt: 3000 });
    const before = await balanced(WS);
    const v = await call('arVoidRc', MGR, { reqId: rid(), id: r3.id, reason: 'טעות' });
    assert.equal(v.reason, 'rc-refunded', v.text);
    assert.match(v.text, /הוחזר כסף על החשבונית/); assert.match(v.text, /בזיכוי/);
    const rc3 = await get(`b/${A}/ardoc/${r3.id}`); assert.equal(rc3.void, undefined); assert.notEqual(rc3.st, 'void');
    assert.ok((await all('aralloc')).filter((x) => x.rc === r3.id).every((x) => !x.void), 'ההקצאה לא בוטלה');
    const a = await balanced(WS); assert.equal(a.bal, before.bal); assert.equal(a.cr, before.cr);
  });
  it('זיכוי לחשבונית מס קבלה (שולמה) – זכות פתוחה ללקוח; זיכוי מלא בלי זיכויים קודמים = בדיוק סכום החשבונית', async () => {
    const p = await order(WI); await ok(call('markOrderPaid', E1, { id: p, method: 'cash' }));
    const ir = await ok(call('setOrderStatus', E1, { id: p, status: 'out' }));
    const g = (await get(`b/${A}/ardoc/${ir.ar.id}`)).gross;
    const c = await ok(call('arCredit', MGR, { reqId: rid(), inv: ir.ar.id, mode: 'full', reason: 'החזרה' }));
    assert.equal(c.gross, g); assert.equal(c.left, g);
    const a = await balanced(WI); assert.equal(a.bal, -g); assert.equal(a.cr, g);
  });
});

describe('מסמך קבוע, הרשאות וחוקים', () => {
  it('תוכן מסמך לא משתנה באף פונקציה (כל התרחישים); docUpd דוחה שדה תוכן; אין במקור כתיבה ל-ardoc חוץ מ-create ו-docUpd', async () => {
    const id = await order(WS); await ship(id);
    const snap = new Map((await all('ardoc')).map((x) => [x.id, content(x)]));
    const take = async () => { for (const x of await all('ardoc')) if (!snap.has(x.id)) snap.set(x.id, content(x)); };
    // כל הפונקציות שנוגעות במסמכים
    const r = await ok(call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 30, method: 'cash' })); await take();
    await ok(call('arCredit', MGR, { reqId: rid(), inv: 'invD1', mode: 'amt', amt: 5, reason: 'x' })); await take();
    await ok(call('arDoc', MGR, { id: 'invD1', op: 'due', due: '2027-06-01' }));
    await ok(call('arDoc', MGR, { id: 'invD1', op: 'pdf' }));
    await ok(call('arDoc', MGR, { id: 'invD1', op: 'send', ch: 'mail', reqId: rid() }));
    await ok(call('arVoidRc', MGR, { reqId: rid(), id: r.id, reason: 'x' }));
    await ok(call('markOrderPaid', MGR, { id, method: 'cash' })); await take();
    await ok(call('arMonthly', MGR, { cust: WS, ym: (await get(`b/${A}/ardoc/invD1`)).d.slice(0, 7) }));
    await ok(call('arIssue', MGR, { reqId: rid(), ord: await order(WS) })); await take();
    for (const x of await all('ardoc')) assert.equal(content(x), snap.get(x.id), 'תוכן המסמך השתנה: ' + x.id);
    assert.equal((await get(`b/${A}/ardoc/invD1`)).dueX, '2027-06-01');
    // docUpd: שדה תוכן – שגיאה לפני כתיבה
    const ARD = require('../functions/lib/ar-doc');
    const fake = { update: () => { throw new Error('לא אמור לכתוב'); } };
    for (const k of ['gross', 'no', 'lines', 'cust', 'd', 'vat', 'net', 'draft', 'ser', 't', 'due', 'pay', 'ref']) assert.throws(() => ARD.docUpd(fake, {}, { [k]: 1 }), /immutable/);
    let w = 0; ARD.docUpd({ update: () => { w++; } }, {}, { open: 0, st: 'paid', upd: 1 }); assert.equal(w, 1);
    // סריקת המקור: כל כתיבה ל-ardoc היא tx.create (מסמך חדש) או docUpd
    const dir = path.join(H.ROOT, 'functions');
    for (const f of fsm.readdirSync(dir).concat(fsm.readdirSync(path.join(dir, 'lib')).map((x) => 'lib/' + x)).filter((x) => x.endsWith('.js'))) {
      const t = fsm.readFileSync(path.join(dir, f), 'utf8');
      for (const ln of t.split('\n')) { const code = ln.replace(/\/\/.*$/, ''); if (/['"`]ardoc\/|collection\(['"`]ardoc['"`]\)/.test(code) && /\.(set|update|delete)\(/.test(code) && !/docUpd/.test(code)) assert.fail(`${f}: כתיבה ל-ardoc מחוץ ל-docUpd: ${ln.trim().slice(0, 120)}`); }
    }
    await balanced(WS);
  });
  it('setArOff – מנהל־על בלבד; רשמי מתחיל מ-start; טיוטה נשארת טיוטה; start נעול אחרי מסמך רשמי; פטור = בלי מע"מ', async () => {
    const id1 = await order(WS); await ship(id1);
    assert.equal((await call('setArOff', MGR, { on: true })).reason, 'not-superadmin');
    assert.equal((await call('setArOff', E1, { on: true })).reason, 'not-superadmin');
    await assertFails(db(MGR).doc(`b/${A}/arcfg/off`).set({ on: true }));
    // בדיקה באמולטור בלבד – בשום סביבה אמיתית המתג "רשמי" לא נדלק
    await ok(call('setArOff', SUPER, { bizId: A, on: true, bt: 'co', start: { inv: 3401 } }));
    await assertSucceeds(db(MGR).doc(`b/${A}/arcfg/off`).get());
    await assertFails(db(E1).doc(`b/${A}/arcfg/off`).get());
    const id2 = await order(WS); const r = await ship(id2);
    assert.equal(r.ar.id, 'invO3401'); assert.equal(r.ar.draft, false);
    const id3 = await order(WS); assert.equal((await ship(id3)).ar.no, 3402);
    assert.equal((await get(`b/${A}/ardoc/invD1`)).draft, true, 'מסמך שהופק כטיוטה נשאר טיוטה');
    assert.equal((await call('setArOff', SUPER, { bizId: A, start: { inv: 9000 } })).reason, 'seq-started');
    // תיקון סבב 1 (הערה 4): אחרי מסמך רשמי – אין חזרה לטיוטה
    assert.equal((await call('setArOff', SUPER, { bizId: A, on: false, bt: 'patur' })).reason, 'official-started');
    assert.equal((await get(`b/${A}/arcfg/off`)).on, true);
    await ok(call('setArOff', SUPER, { bizId: A, bt: 'patur' }));
    const id4 = await order(PR, [{ pid: 'pA', qty: 1, price: 89.9 }], E1);
    const p = await ok(call('markOrderPaid', E1, { id: id4, method: 'cash' }));
    const ir = await get(`b/${A}/ardoc/${p.ar.id}`);
    assert.equal(ir.rate, 0); assert.equal(ir.vat, 0); assert.equal(ir.gross, 8990); assert.equal(ir.bt, 'patur'); assert.equal(ir.ser, 'O');
    await balanced(WS);
  });
  it('חוקים: ardoc / aralloc – עובד עם הזמנות ומנהל קוראים, בלי כתיבה; arproof – אף אחד; arDoc due – מנהל בלבד', async () => {
    const id = await order(WS); await ship(id);
    await ok(call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 10, method: 'cash' }));
    const pf = await proof(E1);
    for (const u of [E1, MGR]) {
      await assertSucceeds(db(u).doc(`b/${A}/ardoc/invD1`).get());
      await assertSucceeds(db(u).collection(`b/${A}/aralloc`).get());
      await assertFails(db(u).doc(`b/${A}/ardoc/invD1`).update({ gross: 1 }));
      await assertFails(db(u).doc(`b/${A}/ardoc/x`).set({ t: 'inv' }));
      await assertFails(db(u).doc(`b/${A}/aralloc/x`).set({ amt: 1 }));
      await assertFails(db(u).doc(`b/${A}/arproof/${pf}`).get());
      await assertFails(db(u).doc(`b/${A}/arcfg/seq_invD`).get());
    }
    await assertFails(db(NOORD).doc(`b/${A}/ardoc/invD1`).get());
    await assertFails(db('nobody').doc('ardoc/invD1').get());
    assert.equal((await call('arDoc', E1, { id: 'invD1', op: 'due', due: '2027-01-01' })).reason, 'manager-only');
    assert.equal((await call('arDoc', MGR, { id: 'invD1', op: 'due', due: '2000-01-01' })).reason, 'bad-due');
    assert.equal((await call('arDoc', NOORD, { id: 'invD1', op: 'pdf' })).reason, 'no-perm');
    // זיהוי אסמכתא (payproof): עובד בלי הרשאת הזמנות – נדחה לפני Gemini ולפני המכסה
    const jpg = { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64') };
    assert.equal((await call('scanDocument', NOORD, { kind: 'payproof', files: [jpg] })).reason, 'no-perm');
  });
  it('mergeCust / wipeCusts נחסמים כשיש מסמכים', async () => {
    const P1 = 'p0547777777', P2 = 'p0548888888';
    await prep(async (d) => { await d.doc(`b/${A}/cust/${P1}`).set({ name: 'מסעדה א', phone: '0547777777', wholesale: true, terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} }); await d.doc(`b/${A}/cust/${P2}`).set({ name: 'מסעדה ב', phone: '0548888888', wholesale: true, at: 1, upd: 1, x: {} }); });
    const id = await order(P1); await ship(id);
    assert.equal((await call('mergeCust', MGR, { a: P1, b: P2, keep: P2 })).reason, 'merge-ardoc');
    assert.equal((await call('mergeCust', MGR, { a: P1, b: P2, keep: P1 })).status, 'OK', 'הלקוח עם המסמכים נשאר – מותר');
    assert.equal((await call('wipeCusts', MGR, { reqId: rid(), confirm: 'מחק' })).reason, 'has-ardoc');
    assert.ok(await get(`b/${A}/cust/${WS}`));
  });
});

describe('אסמכתאות (arProof / arProofGet)', () => {
  it('רק jpeg/png/pdf, תוכן תואם לסוג, עד 5MB, ממשיך רק מי שהתחיל; צפייה – מנהל ומי שהעלה', async () => {
    assert.equal((await call('arProof', E1, { k: 0, np: 1, data: 'data:image/gif;base64,R0lGOD' })).reason, 'bad-proof');
    assert.equal((await call('arProof', E1, { k: 0, np: 1, data: 'data:image/png;base64,' + Buffer.from('not a png at all').toString('base64') })).reason, 'bad-proof');
    assert.equal((await call('arProof', E1, { k: 0, np: 11, data: JPG })).reason, 'proof-big');
    const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%test\n').toString('base64');
    const id = await proof(E1, pdf);
    assert.equal((await ok(call('arProofGet', MGR, { id }))).mime, 'application/pdf');
    assert.equal((await ok(call('arProofGet', E1, { id }))).data, pdf);
    assert.equal((await call('arProofGet', E2, { id })).reason, 'proof-owner');
    // בחלקים: 2 חלקים, עובד אחר לא ממשיך; אחרי הסוף – נעול
    const b64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 1)]).toString('base64');
    const s1 = await ok(call('arProof', E1, { k: 0, np: 2, data: 'data:image/png;base64,' + b64.slice(0, 2000) }));
    assert.equal(s1.done, undefined);
    assert.equal((await call('arProof', E2, { id: s1.id, k: 1, np: 2, data: b64.slice(2000) })).reason, 'proof-owner');
    assert.equal((await ok(call('arProof', E1, { id: s1.id, k: 1, np: 2, data: b64.slice(2000) }))).done, true);
    assert.equal((await call('arProof', E1, { id: s1.id, k: 1, np: 2, data: b64.slice(2000) })).reason, 'proof-done');
    // מעל 5MB אחרי פענוח – נדחה בחלק האחרון
    const big = 'A'.repeat(699996);
    const st = await ok(call('arProof', E1, { k: 0, np: 10, data: 'data:image/jpeg;base64,/9j/' + big.slice(100) }));
    for (let k = 1; k < 9; k++) await ok(call('arProof', E1, { id: st.id, k, np: 10, data: big }));
    assert.equal((await call('arProof', E1, { id: st.id, k: 9, np: 10, data: big })).reason, 'proof-big'); // ~5.25MB אחרי פענוח
  });
});

describe('arIssue, סיכום חודשי ועומס מספור', () => {
  it('החלטה 36 (תיקון 7ב): עסק עם "חיוב אחרי ליקוט" – חשבונית מס ללקוח מיידי רק אחרי ליקוט שלא השתנה; שוטף ועסק רגיל – כמו קודם', async () => {
    await prep((d) => d.doc(`b/${A}/private/pay`).set({ mode: 'link', link: 'https://pay.example.com/biz', after: true }));
    const id = await order(WI);
    const r0 = await call('arIssue', MGR, { reqId: rid(), ord: id, t: 'inv' });
    assert.equal(r0.reason, 'pay-pick', r0.text);
    assert.equal((await get(`b/${A}/ord/${id}`)).inv, undefined, 'לא הופקה חשבונית');
    const L = [{ i: 0, ok: true }, { i: 1, ok: true }];
    assert.equal((await call('orderPick', E1, { id, reqId: rid(), l: L })).status, 'OK');
    const o = await get(`b/${A}/ord/${id}`);
    const it2 = o.items.map((x) => ({ pid: x.pid, qty: x.qty, price: x.price })); it2[1].qty = 13;
    assert.equal((await call('updateOrder', MGR, { id, items: it2 })).status, 'OK');
    const r1 = await call('arIssue', MGR, { reqId: rid(), ord: id, t: 'inv' });
    assert.equal(r1.reason, 'pick-old', r1.text);
    assert.equal((await call('orderPick', E1, { id, reqId: rid(), l: L })).status, 'OK');
    assert.equal((await ok(call('arIssue', MGR, { reqId: rid(), ord: id, t: 'inv' }))).t, 'inv');
    // לקוח בשוטף – בלי ליקוט, כמו קודם
    assert.equal((await ok(call('arIssue', MGR, { reqId: rid(), ord: await order(WS), t: 'inv' }))).t, 'inv');
    // עסק בלי "אחרי ליקוט" – לקוח מיידי בלי ליקוט, כמו קודם
    await prep((d) => d.doc(`b/${A}/private/pay`).set({ mode: 'link', link: 'https://pay.example.com/biz', after: false }));
    assert.equal((await ok(call('arIssue', MGR, { reqId: rid(), ord: await order(WI), t: 'inv' }))).t, 'inv');
  });
  it('arIssue: הזמנה ישנה בלי vm – רק עם בחירה; כבר יש חשבונית – נדחה; מספר הקצאה מעל הסף: חובה או דילוג', async () => {
    const id = await order(WS);
    await prep(async (d) => { const r = d.doc(`b/${A}/ord/${id}`); const o = (await r.get()).data(); delete o.vm; delete o.vr; delete o.gross; delete o.net; delete o.vat; await r.set(o); });
    assert.equal((await call('arIssue', E1, { reqId: rid(), ord: id })).reason, 'need-vm');
    const r = await ok(call('arIssue', E1, { reqId: rid(), ord: id, vm: 'inc' }));
    assert.equal(r.t, 'inv');
    assert.equal((await call('arIssue', E1, { reqId: rid(), ord: id })).reason, 'has-inv');
    await prep((d) => d.doc(`b/${A}/arcfg/off`).set({ amin: 100 }));
    const id2 = await order(WS);
    assert.equal((await call('arIssue', E1, { reqId: rid(), ord: id2 })).reason, 'need-alloc');
    const r2 = await ok(call('arIssue', E1, { reqId: rid(), ord: id2, alloc: '123456789' }));
    assert.equal((await get(`b/${A}/ardoc/${r2.id}`)).alloc, '123456789');
    const id3 = await order(WS);
    const r3 = await ok(call('arIssue', E1, { reqId: rid(), ord: id3, skipAlloc: true }));
    assert.equal((await get(`b/${A}/ardoc/${r3.id}`)).alq, true);
    // "נשלח" אחרי חשבונית ידנית – בלי חשבונית נוספת
    const s = await ship(id3);
    assert.equal(s.ar, undefined);
    assert.equal((await call('arIssue', E2, { reqId: rid(), ord: await order(WS) })).reason, 'foreign-br');
    await balanced(WS);
  });
  it('סיכום חודשי – מסמך סיכום (לא חשבונית מס), כולל זיכויים; בלי מסמכים – no-docs', async () => {
    await ship(await order(WS)); await ship(await order(WS, [{ pid: 'pA', qty: 1, price: 100 }]));
    await ok(call('arCredit', MGR, { reqId: rid(), inv: 'invD2', mode: 'amt', amt: 18, reason: 'x' }));
    const ym = (await get(`b/${A}/ardoc/invD1`)).d.slice(0, 7);
    const r = await ok(call('arMonthly', E1, { cust: WS, ym }));
    assert.equal(r.n, 3); assert.equal(Buffer.from(r.b64, 'base64').slice(0, 5).toString(), '%PDF-');
    assert.equal(r.tot, (await get(`b/${A}/ardoc/invD1`)).gross + 11800 - 1800);
    assert.equal((await get(`b/${A}/arcfg/seq_invD`)).n, 2, 'הסיכום לא צורך מספר חשבונית');
    assert.ok(await get(`b/${A}/arsum/${WS}_${ym}`));
    assert.equal((await call('arMonthly', E1, { cust: WS, ym: '2020-01' })).reason, 'no-docs');
  });
  it('עומס: 50 מסמכים במקביל משני סוגים (25 חשבוניות מס + 25 חשבוניות מס קבלה) – מספרים 1–25 בכל סדרה, בלי כפילות ובלי חור', async () => {
    const custs = Array.from({ length: 25 }, (_, i) => 'cL' + i);
    await prep(async (d) => { const b = d.batch(); custs.forEach((c, i) => b.set(d.doc(`b/${A}/cust/${c}`), { name: 'לקוח ' + i, phone: '05400000' + String(i).padStart(2, '0'), wholesale: true, terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} })); await b.commit(); });
    const invO = [], irO = [];
    for (const c of custs) {
      const r = await call('createOrder', MGR, { reqId: rid(), br: 'br1', cust: { name: 'x', phone: '0541234567' }, custId: c, items: [{ pid: 'pB', qty: 2, price: 10 }] });
      invO.push(r.result.id);
    }
    for (let i = 0; i < 25; i++) { const p = await order(PR, [{ pid: 'pB', qty: 1, price: 6.25 }], E1); irO.push(p); }
    await prep(async (d) => { const b = d.batch(); irO.forEach((id) => b.update(d.doc(`b/${A}/ord/${id}`), { status: 'paid', paid: { method: 'cash', amt: 6.25, at: 1, by: E1 } })); await b.commit(); });
    const rs = await Promise.all(invO.map((ord) => call('arIssue', MGR, { reqId: rid(), ord })).concat(irO.map((ord) => call('arIssue', E1, { reqId: rid(), ord }))));
    for (const r of rs) assert.equal(r.status, 'OK', r.text);
    const docs = await all('ardoc');
    for (const t of ['inv', 'ir']) {
      const nos = docs.filter((x) => x.t === t).map((x) => x.no).sort((a, b) => a - b);
      assert.deepEqual(nos, Array.from({ length: 25 }, (_, i) => i + 1), t);
      assert.equal((await get(`b/${A}/arcfg/seq_${t}D`)).n, 25);
    }
    for (const c of custs.slice(0, 5)) await balanced(c);
  });
});

// תיקון סבב 1 אחרי בודק (15.11.2026)
describe('תיקון סבב 1 – ליקויים 1, 2, 4 והערות 2, 4', () => {
  it('ליקוי 1: לקוח לפי טלפון עם חשבונית – הוספת ת"ז נחסמת (move-ardoc), שום דבר לא זז, והיתרה נשארת מאוזנת; בלי מסמכים – המעבר עובד כמו קודם', async () => {
    const P = 'p0545555555', T1 = 't000000018';
    await prep(async (d) => { await d.doc(`b/${A}/cust/${P}`).set({ name: 'יוסי', phone: '0545555555', terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} }); });
    const cr = await ok(call('createOrder', MGR, { reqId: rid(), br: 'br1', cust: { name: 'יוסי', phone: '0545555555' }, custId: P, items: [{ pid: 'pA', qty: 1, price: 89.9 }] }));
    await ship(cr.id, MGR);
    const before0 = await get(`b/${A}/cust/${P}`);
    const sv = await call('saveCust', MGR, { id: P, cust: { tz: '000000018', name: 'יוסי', phone: '0545555555' } });
    assert.equal(sv.reason, 'move-ardoc', sv.text);
    assert.match(sv.text, /אי אפשר להוסיף ת\.ז/);
    // גם בלי id (upsert לפי טלפון + ת"ז) – נחסם
    assert.equal((await call('saveCust', MGR, { cust: { tz: '000000018', name: 'יוסי', phone: '0545555555' } })).reason, 'move-ardoc');
    assert.equal(await get(`b/${A}/cust/${T1}`), null, 'לא נוצר לקוח t');
    assert.deepEqual(await get(`b/${A}/cust/${P}`), before0, 'הלקוח הישן לא השתנה');
    await ok(call('arReceipt', MGR, { reqId: rid(), cust: P, amt: 50, method: 'cash' }));
    const a = await balanced(P); assert.equal(a.bal, 8990 - 5000);
    // לקוח בלי מסמכים – המעבר p→t עובד כמו קודם
    await prep(async (d) => { await d.doc(`b/${A}/cust/p0546666666`).set({ name: 'רון', phone: '0546666666', at: 1, upd: 1, x: {} }); });
    const m = await ok(call('saveCust', MGR, { id: 'p0546666666', cust: { tz: '000000026', name: 'רון', phone: '0546666666' } }));
    assert.equal(m.id, 't000000026'); assert.equal((await get(`b/${A}/cust/p0546666666`)).mv, 't000000026');
  });
  it('ליקוי 2: זיכוי מלא אחרי זיכוי לפי שורות סוגר את החשבונית בדיוק – גם כשהעיגול משאיר אגורה וגם כשהוא עובר אגורה; שורת "התאמת עיגול" ב-PDF', async () => {
    for (const [pr, why] of [[12.35, 'חסר'], [12.25, 'עודף']]) {
      await seed();
      const id = await order(WS, [{ pid: 'pA', qty: 1, price: pr }, { pid: 'pB', qty: 1, price: pr }]);
      const r = await ship(id, MGR);
      const inv = await get(`b/${A}/ardoc/${r.ar.id}`);
      const c1 = await ok(call('arCredit', MGR, { reqId: rid(), inv: r.ar.id, mode: 'lines', lines: [{ i: 0, q: 1 }], reason: 'x' }));
      const naive = 2 * c1.gross - inv.gross; // בלי התיקון: הזיכוי השני היה שווה לראשון
      assert.notEqual(naive, 0, why + ': המקרה אכן בודק עיגול');
      const c2 = await ok(call('arCredit', MGR, { reqId: rid(), inv: r.ar.id, mode: 'full', reason: 'x' }));
      assert.equal(c1.gross + c2.gross, inv.gross, why);
      const x = await get(`b/${A}/ardoc/${r.ar.id}`); assert.equal(x.open, 0, why); assert.equal(x.st, 'paid', why);
      const d2 = await get(`b/${A}/ardoc/${c2.id}`), d1 = await get(`b/${A}/ardoc/${c1.id}`);
      assert.equal(d2.adj, inv.gross - c1.gross - (c1.gross), why + ': adj = ההפרש');
      assert.equal(d1.net + d2.net, inv.net, why + ' net'); assert.equal(d1.vat + d2.vat, inv.vat, why + ' vat');
      assert.equal(d2.net + d2.vat, d2.gross);
      assert.deepEqual(d2.li, [{ i: 1, q: 1 }], 'השורות שנשארו נשמרות לתיעוד');
      // ה-PDF נבנה (docRender בודק שהסכום המודפס = gross) וכולל "התאמת עיגול"
      const k = require('../functions/lib/ar-pdf').calc({ lines: d2.lines, vm: d2.vm, rate: d2.rate, adj: d2.adj });
      assert.equal(k.gross, d2.gross); assert.equal(k.adj, d2.adj);
      assert.equal((await call('arDoc', MGR, { id: c2.id, op: 'pdf' })).status, 'OK');
      assert.equal((await call('arCredit', MGR, { reqId: rid(), inv: r.ar.id, mode: 'full', reason: 'x' })).reason, 'nothing-left');
      await balanced(WS);
    }
    // זיכוי לפי שורות שמכסה את כל מה שנשאר – אותו כלל
    await seed();
    const id = await order(WS, [{ pid: 'pA', qty: 1, price: 12.35 }, { pid: 'pB', qty: 1, price: 12.35 }]);
    const r = await ship(id, MGR);
    await ok(call('arCredit', MGR, { reqId: rid(), inv: r.ar.id, mode: 'lines', lines: [{ i: 0, q: 1 }], reason: 'x' }));
    await ok(call('arCredit', MGR, { reqId: rid(), inv: r.ar.id, mode: 'lines', lines: [{ i: 1, q: 1 }], reason: 'x' }));
    assert.equal((await get(`b/${A}/ardoc/${r.ar.id}`)).open, 0);
    const a = await balanced(WS); assert.equal(a.bal, 0);
  });
  it('ליקוי 4: תשלום בקישור / בטלפון נשמר עם via (ומודפס כאשראי); מזומן ואשראי – בלי via', async () => {
    const ARD = require('../functions/lib/ar-doc');
    assert.deepEqual(ARD.payOf({ method: 'link' }), { m: 'card', via: 'link' });
    assert.deepEqual(ARD.payOf({ method: 'phone', last4: '1234' }), { m: 'card', via: 'phone', last4: '1234' });
    assert.deepEqual(ARD.payOf({ method: 'cash' }), { m: 'cash' });
    assert.deepEqual(ARD.payOf({ method: 'card' }), { m: 'card' });
    const id = await order(PR, [{ pid: 'pA', qty: 1, price: 89.9 }], E1);
    const p = await ok(call('markOrderPaid', E1, { id, method: 'link' }));
    const ir = await get(`b/${A}/ardoc/${p.ar.id}`);
    assert.deepEqual(ir.pay, { m: 'card', via: 'link' });
    assert.equal((await call('arDoc', MGR, { id: p.ar.id, op: 'pdf' })).status, 'OK');
  });
  it('הערה 2: קבלה מכרטיס הלקוח שסוגרת את החשבונית – ההזמנה עוברת ל"הושלם" עם paid.rc; קבלה חלקית – לא; ביטול הקבלה מחזיר ל"ממתין לתשלום"', async () => {
    const id = await order(WS); const r = await ship(id, MGR);
    const inv = await get(`b/${A}/ardoc/${r.ar.id}`);
    await ok(call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: 10, method: 'transfer' }));
    assert.equal((await get(`b/${A}/ord/${id}`)).status, 'wait_pay', 'חלקי – ההזמנה לא זזה');
    const rc = await ok(call('arReceipt', MGR, { reqId: rid(), cust: WS, amt: (inv.gross - 1000) / 100, method: 'chq', chq: { no: '123', bank: 'לאומי', d: '2026-12-01' } }));
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.status, 'done'); assert.equal(o.paid.rc, rc.id); assert.equal(o.paid.method, 'other'); assert.equal(o.paid.amt, (await get(`b/${A}/ord/${id}`)).gross);
    assert.equal((await call('markOrderPaid', MGR, { id, method: 'transfer' })).result.dup, true);
    await balanced(WS);
    await ok(call('arVoidRc', MGR, { reqId: rid(), id: rc.id, reason: 'הצ׳ק חזר' }));
    const o2 = await get(`b/${A}/ord/${id}`);
    assert.equal(o2.status, 'wait_pay'); assert.equal(o2.paid, undefined);
    const a = await balanced(WS); assert.equal(a.bal, inv.gross - 1000);
  });
});
