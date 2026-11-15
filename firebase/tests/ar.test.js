'use strict';
// אישור הזמנה (14.11.2026, שלב 3 חלק ב'): functions/ar.js – arOc, arPdf, arSend, setArCfg + חוקי arcfg. רץ מול האמולטור, חלק מ-test:multibiz.
// ווטסאפ – wa-mock (127.0.0.1:9795) בלבד. מייל – סודות דמה באמולטור (no-secrets), אין שום שליחה אמיתית.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const WM = require('./wa-mock');

const A = 'biz-ar';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'ar_mgr', E1 = 'ar_e1', E2 = 'ar_e2', NOORD = 'ar_no', SUPER = 'ar_super';
const WS = 'cWS', PR = 'cPR';
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
let env, n = 0;
const rid = () => 'req' + Date.now().toString(36) + (n++) + 'xx';
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function seed(cfg) {
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
    b.set(d.doc(`b/${A}/cust/${PR}`), { name: 'דנה', phone: '0542222222', at: 1, upd: 1, x: {} });
    b.set(d.doc(`b/${A}/sec_cfg/wa`), { pnid: '1000000099', num: '97230000009' });
    if (cfg !== false) b.set(d.doc(`b/${A}/arcfg/main`), Object.assign({ on: true, name: 'לארג׳ פעמי בדיקה', bn: '512345678', addr: 'הרצל 1, אשדוד', phone: '08-1234567', mail: 'biz@x.invalid', foot: 'תודה שקניתם אצלנו' }, cfg || {}));
    await b.commit();
  });
}
async function order(uid, br, extra) {
  const r = await call('createOrder', uid, Object.assign({ reqId: rid(), br, cust: { name: 'דנה', phone: '0542222222' }, items: [{ pid: 'pA', qty: 1, price: 89.9 }] }, extra || {}));
  assert.equal(r.status, 'OK', r.text);
  return r.result.id;
}

before(async () => { env = await H.getEnv(); await WM.start(); require('../functions/index.js'); });
after(async () => { await WM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(async () => { WM.reset(); await seed(); });

describe('arOc – מספור רץ נפרד', () => {
  it('20 קריאות מקבילות (20 הזמנות) → המספרים 1–20 בדיוק, בלי כפילות ובלי חור; המונה = 20', async () => {
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push(await order(i % 2 ? MGR : E1, 'br1'));
    const rs = await Promise.all(ids.map((id) => call('arOc', E1, { id, reqId: rid() })));
    for (const r of rs) assert.equal(r.status, 'OK', r.text);
    const nos = rs.map((r) => r.result.no).sort((a, b) => a - b);
    assert.deepEqual(nos, Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal((await get(`b/${A}/arcfg/seq_oc`)).n, 20);
    // המספר נשמר בהזמנה, והוא נפרד ממספר ההזמנה (ordcfg/seq)
    for (let i = 0; i < 20; i++) { const o = await get(`b/${A}/ord/${ids[i]}`); assert.equal(o.oc.no, rs[i].result.no); assert.equal(o.oc.ed, 1); assert.equal(o.oc.pf, true); }
  });
  it('מזהה בקשה כפול (גם במקביל) = אותו מספר; לחיצה חוזרת בלי שינוי = אותו מספר ואותה מהדורה; אחרי עריכה – אותו מספר, מהדורה 2', async () => {
    const a = await order(E1, 'br1'), b = await order(E1, 'br1');
    const q = rid();
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => call('arOc', E1, { id: a, reqId: q })));
    for (const r of rs) { assert.equal(r.status, 'OK', r.text); assert.equal(r.result.no, 1); assert.equal(r.result.ed, 1); }
    assert.equal(rs.filter((r) => r.result.dup).length, 4);
    assert.equal((await get(`b/${A}/arcfg/seq_oc`)).n, 1);
    // לחיצות מקבילות עם מזהי בקשה שונים על אותה הזמנה – אותו מספר, מהדורה אחת, והמונה לא זז
    const par = await Promise.all([1, 2, 3, 4, 5].map(() => call('arOc', MGR, { id: a, reqId: rid() })));
    for (const r of par) { assert.equal(r.status, 'OK', r.text); assert.equal(r.result.no, 1); assert.equal(r.result.ed, 1); assert.equal(r.result.fresh, false); }
    assert.equal((await get(`b/${A}/arcfg/seq_oc`)).n, 1);
    const again = await call('arOc', E1, { id: a, reqId: rid() });
    assert.equal(again.result.no, 1); assert.equal(again.result.ed, 1); assert.equal(again.result.fresh, false);
    assert.equal((await call('arOc', E1, { id: b, reqId: rid() })).result.no, 2);
    // אותו מזהה בקשה להזמנה אחרת – נדחה
    assert.equal((await call('arOc', E1, { id: b, reqId: q })).reason, 'bad-req');
    const u = await call('updateOrder', E1, { id: a, items: [{ pid: 'pA', qty: 2, price: 89.9 }] });
    assert.equal(u.status, 'OK', u.text);
    const e2 = await call('arOc', E1, { id: a, reqId: rid() });
    assert.equal(e2.status, 'OK', e2.text);
    assert.equal(e2.result.no, 1); assert.equal(e2.result.ed, 2); assert.equal(e2.result.fresh, true);
    assert.equal((await get(`b/${A}/arcfg/seq_oc`)).n, 2, 'מהדורה לא צורכת מספר');
    const o = await get(`b/${A}/ord/${a}`);
    assert.equal(o.oc.f, `oc_${a}_2`);
    assert.equal(o.total, 179.8, 'שדות ההזמנה לא השתנו');
  });
  it('הרשאות: עובד מסניף אחר נדחה; עובד בלי הרשאת הזמנות נדחה; בלי התחברות נדחה; מסמכים כבויים – ar-off; הזמנה מבוטלת – נדחה', async () => {
    const id = await order(E1, 'br1');
    assert.equal((await call('arOc', E2, { id, reqId: rid() })).reason, 'foreign-br');
    assert.equal((await call('arPdf', E2, { id })).reason, 'foreign-br');
    assert.equal((await call('arSend', E2, { id, reqId: rid(), ch: 'mail' })).reason, 'foreign-br');
    assert.equal((await call('arOc', NOORD, { id, reqId: rid() })).reason, 'no-perm');
    assert.equal((await call('arOc', null, { id, reqId: rid() })).status, 'UNAUTHENTICATED');
    assert.equal((await call('arOc', MGR, { id, reqId: rid() })).status, 'OK', 'מנהל – כל הסניפים');
    assert.equal((await get(`b/${A}/arcfg/seq_oc`)).n, 1, 'ניסיונות שנדחו לא צרכו מספר');
    await prep((d) => d.doc(`b/${A}/arcfg/main`).set({ on: false }, { merge: true }));
    assert.equal((await call('arOc', E1, { id, reqId: rid() })).reason, 'ar-off');
    await prep((d) => d.doc(`b/${A}/arcfg/main`).delete());
    assert.equal((await call('arOc', MGR, { id, reqId: rid() })).reason, 'ar-off', 'בלי הגדרה – כבוי (כמו היום)');
    await prep((d) => d.doc(`b/${A}/arcfg/main`).set({ on: true }));
    const c = await order(E1, 'br1');
    assert.equal((await call('cancelOrder', MGR, { id: c, reason: 'בדיקה' })).status, 'OK');
    assert.equal((await call('arOc', MGR, { id: c, reqId: rid() })).reason, 'cancelled');
  });
  it('הזמנה ישנה בלי vm: צריך לבחור במפורש אם המחירים כוללים מע"מ; אחרי הבחירה – נשמרת ב-oc.vm', async () => {
    await prep((d) => d.doc(`b/${A}/ord/oOLD`).set({ no: 7, src: 'staff', br: 'br1', cust: { name: 'ישן', phone: '0543333333' }, items: [{ n: 'פריט', qty: 2, price: 50 }], total: 100, status: 'new', by: MGR, at: 1, upd: 1 }));
    assert.equal((await call('arOc', E1, { id: 'oOLD', reqId: rid() })).reason, 'need-vm');
    assert.equal((await call('arOc', E1, { id: 'oOLD', reqId: rid(), vm: 'x' })).reason, 'bad-vm');
    const r = await call('arOc', E1, { id: 'oOLD', reqId: rid(), vm: 'inc' });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.no, 1);
    const o = await get(`b/${A}/ord/oOLD`);
    assert.equal(o.oc.vm, 'inc'); assert.equal(o.oc.vr, 18); assert.equal(o.vm, undefined, 'ההזמנה הישנה עצמה לא קיבלה vm');
    assert.equal((await call('arOc', E1, { id: 'oOLD', reqId: rid() })).result.ed, 1, 'בלי vm בקלט – לפי הבחירה הקודמת');
  });
});

describe('arPdf – הקובץ', () => {
  it('לקוח עסקי (לפני מע"מ, הנחה): PDF תקין, הסכום לתשלום = gross של ההזמנה; לקוח פרטי – "כולל מע"מ"', async () => {
    const PDF = require('../functions/lib/ar-pdf');
    const w = await call('createOrder', MGR, { reqId: rid(), br: 'br1', custId: WS, disc: 5, cust: { name: 'מסעדת הים', phone: '0541111111' }, items: [{ pid: 'pA', qty: 3, price: 89.9 }, { pid: 'pB', qty: 12, price: 6.25 }] });
    assert.equal(w.status, 'OK', w.text);
    const o = await get(`b/${A}/ord/${w.result.id}`);
    assert.equal(o.vm, 'ex');
    const r = await call('arOc', MGR, { id: w.result.id, reqId: rid() });
    assert.equal(r.status, 'OK', r.text);
    // 3×89.90 + 12×6.25 = 344.70; הנחה 5% = 17.24 (17.235 → 17.24); לפני מע"מ 327.46; מע"מ 18% = 58.94; לתשלום 386.40
    assert.equal(o.gross, 386.4); assert.equal(r.result.gross, 386.4);
    const p = await call('arPdf', E1, { id: w.result.id });
    assert.equal(p.status, 'OK', p.text);
    const buf = Buffer.from(p.result.b64, 'base64');
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal(p.result.no, 1); assert.equal(p.result.stale, false); assert.equal(p.result.name, 'אישור הזמנה 1.pdf');
    const k = PDF.calc({ vm: 'ex', rate: 18, disc: 5, lines: o.items.map((it) => ({ n: it.n, q: it.qty, p: it.price })) });
    assert.deepEqual([k.sum, k.dsc, k.net, k.vat, k.gross], [34470, -1724, 32746, 5894, 38640]);
    const pr = await order(E1, 'br1', { custId: PR });
    assert.equal((await get(`b/${A}/ord/${pr}`)).vm, 'inc');
    assert.equal((await call('arOc', E1, { id: pr, reqId: rid() })).result.gross, 89.9);
  });
  it('לפני הפקה – no-oc; אחרי עריכה – stale (הקובץ הישן עדיין זמין)', async () => {
    const id = await order(E1, 'br1');
    assert.equal((await call('arPdf', E1, { id })).reason, 'no-oc');
    await call('arOc', E1, { id, reqId: rid() });
    await call('updateOrder', E1, { id, items: [{ pid: 'pA', qty: 3, price: 89.9 }] });
    const p = await call('arPdf', E1, { id });
    assert.equal(p.status, 'OK', p.text); assert.equal(p.result.stale, true); assert.equal(p.result.ed, 1);
  });
});

describe('שליחה ללקוח', () => {
  it('לקוח מסומן (snd.oc, ווטסאפ): נשלח אוטומטית עם קישור למסמך, ונרשם ב-oc.sent; לחיצה חוזרת בלי שינוי – לא שולחת שוב', async () => {
    await prep((d) => d.doc(`b/${A}/arcfg/main`).set({ wt: { oc: 'order_doc' } }, { merge: true }));
    assert.equal((await call('setArCfg', E1, { cust: PR, snd: { ch: 'wa', oc: true } })).status, 'OK');
    assert.deepEqual((await get(`b/${A}/cust/${PR}`)).snd, { ch: 'wa', oc: true, inv: false, rc: false });
    const id = await order(E1, 'br1', { custId: PR });
    const r = await call('arOc', E1, { id, reqId: rid() });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.sent.length, 1); assert.equal(r.result.sent[0].ch, 'wa'); assert.equal(r.result.sent[0].ok, true, JSON.stringify(r.result.sent));
    assert.equal(r.result.sent[0].auto, true);
    const s = WM.sends();
    assert.equal(s.length, 1);
    assert.equal(s[0].body.template.name, 'order_doc');
    const link = s[0].body.template.components[0].parameters[0].document.link;
    const f = await fetch(link);
    assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'application/pdf');
    assert.equal((await get(`b/${A}/ord/${id}`)).oc.sent.length, 1);
    await call('arOc', E1, { id, reqId: rid() });
    assert.equal(WM.sends().length, 1, 'אותה מהדורה – בלי שליחה כפולה');
  });
  it('"עצור הכל" עוצר שליחה אוטומטית, לא שליחה בלחיצה; בלי תבנית – no-tpl; מייל בסודות דמה – no-secrets (לא נשלח)', async () => {
    await prep((d) => d.doc(`b/${A}/sec_cfg/wa`).set({ stop: { on: true } }, { merge: true }));
    await prep((d) => d.doc(`b/${A}/arcfg/main`).set({ wt: { oc: 'order_doc' } }, { merge: true }));
    await call('setArCfg', MGR, { cust: PR, snd: { ch: 'both', oc: true } });
    const id = await order(E1, 'br1', { custId: PR });
    const r = await call('arOc', E1, { id, reqId: rid() });
    assert.deepEqual(r.result.sent.map((x) => [x.ch, x.ok, x.why]), [['wa', false, 'stopped'], ['mail', false, 'no-to']]);
    assert.equal(r.result.sent[0].why, 'stopped');
    assert.equal(WM.sends().length, 0);
    const q = rid();
    const m = await call('arSend', E1, { id, reqId: q, ch: 'wa' });
    assert.equal(m.status, 'OK', m.text); assert.equal(m.result.sent[0].ok, true, JSON.stringify(m.result));
    assert.equal(WM.sends().length, 1);
    const dup = await call('arSend', E1, { id, reqId: q, ch: 'wa' });
    assert.equal(dup.result.dup, true); assert.equal(WM.sends().length, 1, 'מזהה בקשה כפול – לא שולח שוב');
    const ml = await call('arSend', E1, { id, reqId: rid(), ch: 'mail', to: 'dana@x.invalid' });
    assert.equal(ml.status, 'OK', ml.text); assert.equal(ml.result.sent[0].ok, false); assert.equal(ml.result.sent[0].why, 'no-secrets');
    await prep((d) => d.doc(`b/${A}/arcfg/main`).set({ wt: { oc: '' } }, { merge: true }));
    assert.equal((await call('arSend', E1, { id, reqId: rid(), ch: 'wa' })).result.sent[0].why, 'no-tpl');
    const o = await get(`b/${A}/ord/${id}`);
    assert.equal(o.oc.sent.length, 5);
    assert.equal((await call('arSend', E1, { id, reqId: rid(), ch: 'sms' })).reason, 'bad-ch');
  });
});

describe('setArCfg וחוקים', () => {
  it('פרטי העסק – מנהל בלבד; עובד מסמן שליחה ללקוח; ולידציה', async () => {
    assert.equal((await call('setArCfg', E1, { on: true })).reason, 'manager-only');
    const r = await call('setArCfg', MGR, { on: true, name: 'עסק חדש', foot: 'שורה 1\nשורה 2', wt: { oc: 'order_doc' }, mail: 'A@B.co' });
    assert.equal(r.status, 'OK', r.text);
    const c = await get(`b/${A}/arcfg/main`);
    assert.equal(c.name, 'עסק חדש'); assert.equal(c.foot, 'שורה 1\nשורה 2'); assert.equal(c.mail, 'a@b.co'); assert.equal(c.addr, 'הרצל 1, אשדוד', 'שדה שלא נשלח לא נמחק');
    assert.equal((await call('setArCfg', MGR, { mail: 'xx' })).reason, 'bad-email');
    assert.equal((await call('setArCfg', MGR, { wt: { oc: 'Bad Name' } })).reason, 'bad-tpl');
    assert.equal((await call('setArCfg', MGR, { logo: 'data:image/png;base64,AAAA' })).reason, 'bad-logo');
    assert.equal((await call('setArCfg', MGR, { foot: 'א'.repeat(1501) })).reason, 'bad-cfg');
    assert.equal((await call('setArCfg', MGR, { zz: 1 })).reason, 'bad-field');
    const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex').toString('base64');
    assert.equal((await call('setArCfg', MGR, { logo: png })).status, 'OK');
    assert.equal((await get(`b/${A}/arcfg/logo`)).d, png); assert.equal((await get(`b/${A}/arcfg/main`)).logo, true);
    assert.equal((await call('setArCfg', MGR, { logo: '' })).status, 'OK');
    assert.equal(await get(`b/${A}/arcfg/logo`), null);
    assert.equal((await call('setArCfg', E1, { cust: PR, snd: { ch: 'fax', oc: true } })).reason, 'bad-snd');
    assert.equal((await call('setArCfg', E1, { cust: 'nope', snd: { ch: 'wa', oc: true } })).reason, 'no-cust');
    assert.equal((await call('setArCfg', NOORD, { cust: PR, snd: { ch: 'wa', oc: true } })).reason, 'no-perm');
    assert.equal((await call('setArCfg', E1, { cust: PR, snd: null })).status, 'OK');
    assert.equal((await get(`b/${A}/cust/${PR}`)).snd, undefined);
    assert.equal((await get(`b/${A}/cust/${PR}`)).name, 'דנה', 'שאר שדות הלקוח לא השתנו');
  });
  it('חוקים: arcfg/main – קריאה לעובד עם הזמנות ולמנהל; מונה / מזהי בקשה / לוגו – אף אחד; כתיבה – אף אחד; עסק אחר – לא', async () => {
    await call('arOc', MGR, { id: await order(E1, 'br1'), reqId: rid() });
    await prep((d) => d.doc(`b/${A}/arcfg/logo`).set({ d: 'x' }));
    await assertSucceeds(db(E1).doc(`b/${A}/arcfg/main`).get());
    await assertSucceeds(db(MGR).doc(`b/${A}/arcfg/main`).get());
    await assertFails(db(NOORD).doc(`b/${A}/arcfg/main`).get());
    for (const u of [E1, MGR]) {
      await assertFails(db(u).doc(`b/${A}/arcfg/seq_oc`).get());
      await assertFails(db(u).doc(`b/${A}/arcfg/logo`).get());
      await assertFails(db(u).collection(`b/${A}/arcfg`).get());
      await assertFails(db(u).doc(`b/${A}/arcfg/main`).set({ on: false }));
    }
    await assertFails(db('ar_other').doc(`b/${A}/arcfg/main`).get());
    // בשורש (עסק legacy): אותו כלל
    await assertFails(db('nobody').doc('arcfg/main').get());
    await assertFails(db('nobody').doc('arcfg/seq_oc').get());
  });
});
