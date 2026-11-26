'use strict';
// סנכרון כספית A1 (functions/caspit.js) מול האמולטור. חלק מ-test:multibiz:3. כל הנתונים מומצאים.
//   - הרשאות: עובד (גם עם ord), עובד בלי ord ומנהל של עסק אחר – נחסמים; האוספים החדשים סגורים לקריאה ישירה (גם למנהל).
//   - תצוגה מקדימה לא כותבת למוצרים. אישור כפול לא מכפיל. גיבוי לפני האישור הראשון. שום מוצר לא נמחק.
//   - הבדל ראשון (האפליקציה מנצחת), קובץ עדכון מחיר, קליטה בכספית (ack), שינוי מכספית (in), קונפליקט (האפליקציה מנצחת), היסטוריה.
//   - פריט חדש מהאפליקציה מקבל קוד 900000. "לא נספר" יורד בתיקון כמות.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-cx', B = 'biz-cy';
const ALL = { orders: true };
const MGR = 'x_mgr', M2 = 'x_m2', E1 = 'x_e1', NOORD = 'x_no';
const FN = path.join(H.ROOT, 'functions');
// קריאה בתוך התהליך (.run) – כמו one-device.test.js; אותו קוד ואותן בדיקות הרשאה כמו בקריאה מהטלפון
let FX;
async function call(name, uid, data) {
  FX = FX || require('../functions/index.js');
  try { return { status: 'OK', result: await FX[name].run({ auth: uid ? { uid, token: { uid } } : null, data: data || {}, rawRequest: { headers: {} } }) }; } catch (e) {
    return { status: (e && e.code) || 'ERR', reason: e && e.details && e.details.reason, text: String(e && e.message).slice(0, 300) };
  }
}
const ok = async (name, uid, data) => { const r = await call(name, uid, data); assert.equal(r.status, 'OK', name + ': ' + r.text); return r.result; };
let env, adm, CC; let n = 0;
const run = () => 'cxrun' + Date.now().toString(36) + (n++) + 'zz';
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
const P = (id) => adm().doc(`b/${A}/prod/${id}`);

const HDR = ['קוד פריט', 'שם פריט', 'ברקוד', 'ספק', 'קטגוריה ראשית', 'קטגוריה משנית', 'מחיר עלות', 'מחיר לצרכן', 'פריט ללא מעמ'];
const r = (c, nm, bc, p, cost, c1) => [c, nm, bc || '', 'ללא ספק', c1 || '', '', cost || 0, p, 'לא'];
// קטלוג 1: 200001 מקושר לפי ברקוד למוצר קיים (מחיר שונה – הבדל ראשון), 200002/200004/200005 חדשים, 200003 כפול של 200002,
// 200004/200005 – אותו שם במחיר שונה (נפרדים, "שם כפול – לבדוק"), 1000 מיוחד
const CAT1 = [HDR, r('200001', 'כוס נייר לבנה', '7000000000011', 9.9, 5.9), r('200002', 'צלחת גדולה', '7000000000028', 12, 7, 'כלים'), r('200003', 'צלחת  גדולה', '7000000000035', 12), r('200004', 'מגש מלבני', '', 20, 0), r('200005', 'מגש מלבני', '', 25, 0), r('1000', 'פריט כללי', '', 0)];
async function sendCat(uid, rows) {
  const g = CC.groupCat(rows); const id = run(); const parts = CC.parts(g.items, 2); // חלקים קטנים – כדי לבדוק כמה חלקים
  for (let k = 0; k < parts.length; k++) await ok('cxUpload', uid, { run: id, part: k, parts: parts.length, items: parts[k] });
  return id;
}
async function prods() { const s = await adm().collection(`b/${A}/prod`).get(); return new Map(s.docs.map((d) => [d.id, d.data()])); }
const cost = async (id) => { const s = await adm().doc(`b/${A}/prod/${id}/p/cost`).get(); return s.exists ? s.get('cost') : null; };

before(async () => {
  env = await H.getEnv();
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
  CC = require('../functions/lib/caspit-core.js');
  adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const b = d.batch();
    for (const [biz, m] of [[A, MGR], [B, M2]]) {
      b.set(d.doc('b/' + biz), { name: biz, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: ALL, org: { v: 1, branches: [], banks: [], cards: [] } });
      b.set(d.doc(`b/${biz}/admins/${m}`), { email: m + '@x.invalid' });
      b.set(d.doc(`b/${biz}/staff/${m}`), { name: m, role: 'manager', active: true });
      b.set(d.doc('users/' + m), { bizId: biz, role: 'admin', active: true, bizStatus: 'active', email: m + '@x.invalid', createdAt: 1 });
    }
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true });
    b.set(d.doc('users/' + E1), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: E1 + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/staff/${NOORD}`), { name: NOORD, role: 'employee', active: true, perms: { ord: false } });
    b.set(d.doc('users/' + NOORD), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: NOORD + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/prod/pold1`), { name: 'כוס נייר לבנה', price: 10, barcode: '7000000000011', on: true, q: { _: 4 }, at: 1 });
    b.set(d.doc(`b/${A}/prod/pold1/p/cost`), { cost: 6 });
    b.set(d.doc(`b/${A}/prod/pold2`), { name: 'מוצר של האפליקציה בלבד', price: 5, barcode: '', on: true, q: {}, at: 1 });
    await b.commit();
  });
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('סנכרון כספית A1', () => {
  let run1, before1;
  it('הרשאות: רק מנהל העסק; עובד (גם עם הזמנות), עובד בלי ord, בלי התחברות – נחסמים', async () => {
    for (const u of [E1, NOORD, null]) {
      const x = await call('cxUpload', u, { run: run(), part: 0, parts: 1, items: [{ c: '1', n: 'x', p: 1 }] });
      assert.notEqual(x.status, 'OK', String(u));
    }
    assert.equal((await call('cxCfg', E1)).reason, 'manager-only');
    assert.equal((await call('cxExport', E1, { kind: 'price' })).reason, 'manager-only');
  });
  it('העלאה + תצוגה מקדימה: מונים נכונים, ולא נכתב שום מוצר', async () => {
    before1 = JSON.stringify([...(await prods())]);
    run1 = await sendCat(MGR, CAT1);
    const pv = await ok('cxPreview', MGR, { run: run1 });
    assert.deepEqual([pv.cnt.codes, pv.cnt.keep, pv.cnt.merged, pv.cnt.filt, pv.cnt.nw, pv.cnt.link], [6, 4, 1, 1, 3, 1]);
    assert.equal(pv.first, true);
    const l = pv.rows.find((x) => x[0] === '200001');
    assert.deepEqual(l.slice(1, 4), ['link', 'כוס נייר לבנה', 'first']);
    assert.equal(l[9], 'bc');
    assert.equal(pv.cnt.appOnly, 1);
    assert.equal(JSON.stringify([...(await prods())]), before1);
    assert.equal((await adm().collection(`b/${A}/cxItem`).get()).size, 0);
  });
  it('מנהל של עסק אחר לא רואה ולא מאשר את הסנכרון', async () => {
    assert.notEqual((await call('cxPreview', M2, { run: run1 })).status, 'OK');
    assert.notEqual((await call('cxApply', M2, { run: run1 })).status, 'OK');
  });
  it('אישור: גיבוי לפני, מוצרים חדשים "לא נספר" עם קוד, האפליקציה מנצחת בהבדל הראשון; אישור כפול לא מכפיל', async () => {
    const a = await ok('cxApply', MGR, { run: run1, take: 'app' });
    assert.equal(a.done, true);
    assert.equal(a.res.nw, 3); assert.equal(a.res.link, 1); assert.equal(a.res.pout, 1); assert.equal(a.res.cout, 1);
    const bak = (await adm().collection(`b/${A}/cxBak`).get()).docs;
    assert.equal(bak.length, 1); assert.equal(bak[0].get('st'), 'snap'); assert.equal(bak[0].get('n'), 2);
    assert.equal((await adm().collection(`b/${A}/stockBak`).get()).size, 0); // לא נוגעים בגיבויי מחיקת המלאי (ליקוי 10)
    const p = await prods();
    assert.equal(p.size, 5);
    assert.deepEqual([p.get('cx200004').dn, p.get('cx200005').dn, p.get('cx200002').dn], [true, true, undefined]);
    // האפליקציה ניצחה בהבדל הראשון – הערך שבכספית נרשם בהיסטוריה (src:'conf')
    const lg = (await adm().collection(`b/${A}/priceLog`).where('prod', '==', 'pold1').get()).docs.map((d) => [d.get('k'), d.get('old'), d.get('new'), d.get('src')]).sort();
    assert.deepEqual(lg, [['c', 5.9, 6, 'conf'], ['p', 9.9, 10, 'conf']]);
    assert.equal(p.get('pold1').price, 10); assert.equal(p.get('pold1').cx, '200001'); assert.equal(p.get('pold1').q._, 4);
    assert.equal(await cost('pold1'), 6);
    const nw = p.get('cx200002');
    assert.deepEqual([nw.name, nw.price, nw.barcode, nw.bcx, nw.nc, nw.cx, nw.sku, nw.src], ['צלחת גדולה', 12, '7000000000028', ['7000000000035'], true, '200002', '200002', 'cx']);
    assert.deepEqual(nw.q, {});
    assert.equal(await cost('cx200002'), 7);
    assert.equal(await cost('cx200004'), null);
    assert.ok(nw.cat && (await adm().doc(`b/${A}/cat/${nw.cat}`).get()).get('name') === 'כלים');
    const x3 = (await adm().doc(`b/${A}/cxItem/200003`).get()).data();
    assert.deepEqual([x3.pid, x3.m], ['cx200002', '200002']);
    const x1 = (await adm().doc(`b/${A}/cxItem/200001`).get()).data();
    assert.deepEqual(x1.pr, { fb: 9.9, ab: 10, pd: 10 });
    assert.ok(!(await adm().doc(`b/${A}/cxItem/1000`).get()).exists);
    const snap = JSON.stringify([...(await prods())]);
    const again = await ok('cxApply', MGR, { run: run1, take: 'cx' });
    assert.equal(again.dup, true);
    assert.equal(JSON.stringify([...(await prods())]), snap);
    assert.equal((await adm().collection(`b/${A}/cxBak`).get()).size, 1);
  });
  it('אישור חוזר של חלק (כמו ניסיון חוזר אחרי תקלה) לא כותב שוב', async () => {
    const C = require('../functions/caspit.js')._core;
    const ref = adm().doc(`b/${A}/cxRun/${run1}`);
    const rows = (await ref.collection('pv').doc('0').get()).get('rows');
    const logs0 = (await adm().collection(`b/${A}/priceLog`).get()).size;
    const T = require('../functions/lib/tenant');
    const tdb = T.prefixed(adm(), `b/${A}/`);
    await C.applyPart(tdb, { uid: MGR }, run1, ref, 0, rows, 'cx', new Set(), new Map());
    const p = await prods();
    assert.equal(p.get('pold1').price, 10); // take:'cx' בניסיון החוזר לא שינה דבר – החלק כבר סומן
    assert.equal((await adm().collection(`b/${A}/priceLog`).get()).size, logs0);
  });
  it('החוקים: האוספים החדשים סגורים לקריאה ישירה – גם למנהל', async () => {
    for (const p of [`b/${A}/cxItem/200001`, `b/${A}/cxcfg/main`, `b/${A}/cxRun/${run1}`, `b/${A}/cxRun/${run1}/pv/0`]) await assertFails(db(MGR).doc(p).get());
    await assertFails(db(MGR).collection(`b/${A}/priceLog`).get());
    await assertFails(db(MGR).doc(`b/${A}/cxItem/x`).set({ c: 'x' }));
  });
  it('קובץ עדכון מחיר: 200001 (האפליקציה ניצחה) במחיר ובעלות של האפליקציה; קובץ חוזר – אותן שורות', async () => {
    const e = await ok('cxExport', MGR, { kind: 'price' });
    assert.equal(e.n, 1);
    assert.equal(e.csv, '﻿' + CC.HDR_PRICE.join(',') + '\n200001,10,5.08,6\n');
    assert.equal((await ok('cxExport', MGR, { kind: 'price' })).csv, e.csv);
  });
  it('פריטים חדשים: מוצר של האפליקציה בלבד מקבל קוד 900000; קריאה חוזרת – אותו קוד', async () => {
    const e = await ok('cxExport', MGR, { kind: 'new' });
    assert.equal(e.n, 1); assert.equal(e.added, 1);
    const L = e.csv.slice(1).split('\n');
    assert.equal(L[0], CC.HDR_NEW.join(','));
    assert.ok(L[1].startsWith('900000,,מוצר של האפליקציה בלבד,,,5,'));
    assert.equal((await P('pold2').get()).get('cx'), '900000');
    const e2 = await ok('cxExport', MGR, { kind: 'new' });
    assert.equal(e2.added, 0); assert.equal(e2.csv, e.csv);
  });
  it('26.11: מוצר באפליקציה שהברקוד שלו כבר בכספית (קוד אחר) – לא נשלח כפריט חדש ולא מקבל קוד; מוחזר ב-dup', async () => {
    const seen = await adm().doc(`b/${A}/cxcfg/seenBc`).get();
    assert.ok(seen.exists && /(^|\n)7000000000011\t200001(\n|$)/.test(seen.get('s')), 'מפת הברקודים נשמרה באישור הקטלוג');
    await P('pdupbc').set({ name: 'כוס נייר – כפול', price: 3, barcode: '7000000000011', on: true });
    try {
      const e = await ok('cxExport', MGR, { kind: 'new' });
      assert.equal(e.n, 1, 'רק הפריט החדש הקודם (900000)'); assert.equal(e.added, 0);
      assert.ok(!e.csv.includes('כוס נייר – כפול'));
      assert.equal(e.dupN, 1); assert.deepEqual([e.dup[0].pid, e.dup[0].bc, e.dup[0].cx], ['pdupbc', '7000000000011', '200001']);
      assert.equal((await P('pdupbc').get()).get('cx'), undefined, 'לא קיבל קוד 900000+');
      // גם מעל המגבלה: הכפול לא נספר
      const e2 = await ok('cxExport', MGR, { kind: 'new', max: 1 });
      assert.equal(e2.n, 1);
    } finally { await P('pdupbc').delete(); }
  });
  it('קטלוג 2: כספית קלטה (ack), שינוי מכספית (in, עם היסטוריה), קונפליקט – האפליקציה מנצחת', async () => {
    // באפליקציה: מגש מלבני 20 → 22 (דרך saveProduct, נרשם priceLog src:'app')
    await ok('saveProduct', MGR, { id: 'cx200004', name: 'מגש מלבני', price: 22, barcode: '', cost: 9 });
    const CAT2 = [HDR, r('200001', 'כוס נייר לבנה', '7000000000011', 10, 6), r('200002', 'צלחת גדולה', '7000000000028', 13, 7, 'כלים'), r('200003', 'צלחת גדולה', '7000000000035', 13), r('200004', 'מגש מלבני', '', 21, 0), r('900000', 'מוצר של האפליקציה בלבד', '', 5), r('900001', '12.9', '', 0)]; // 900001 מסונן (בלי אותיות) – אבל תפוס
    const id = await sendCat(MGR, CAT2);
    const pv = await ok('cxPreview', MGR, { run: id });
    const act = Object.fromEntries(pv.rows.map((x) => [x[0], x[3]]));
    assert.deepEqual(act, { 200001: 'ack', 200002: 'in', 200004: 'conf', 900000: 'ack' });
    assert.equal(pv.cnt.nw, 0);
    const a = await ok('cxApply', MGR, { run: id });
    assert.equal(a.res.pin, 1);
    const p = await prods();
    assert.equal(p.get('cx200002').price, 13);
    assert.equal(p.get('cx200004').price, 22);
    assert.equal(p.size, 5);
    assert.ok(!('pd' in (await adm().doc(`b/${A}/cxItem/200001`).get()).get('pr')));
    assert.equal((await adm().doc(`b/${A}/cxItem/900000`).get()).get('nw'), undefined);
    const h = await ok('cxHist', MGR, { pid: 'cx200002' });
    assert.deepEqual(h.codes.sort(), ['200002', '200003']);
    assert.deepEqual(h.log.map((x) => [x.k, x.old, x.new, x.src]), [['p', 12, 13, 'caspit']]);
    const h4 = await ok('cxHist', MGR, { pid: 'cx200004' });
    assert.deepEqual(h4.log.map((x) => [x.k, x.old, x.new, x.src]).sort(), [['c', null, 9, 'app'], ['p', 20, 22, 'app'], ['p', 21, 22, 'conf']]);
    // ועכשיו בקובץ עדכון המחיר: 200004 ב-22 (קונפליקט – האפליקציה ניצחה)
    const e = await ok('cxExport', MGR, { kind: 'price' });
    assert.ok(e.csv.includes('\n200004,22,7.63,9\n'), e.csv);
  });
  it('תצוגה ישנה אחרי סנכרון אחר – נחסמת (stale)', async () => {
    const id1 = await sendCat(MGR, CAT1);
    await ok('cxPreview', MGR, { run: id1 });
    const id2 = await sendCat(MGR, CAT1);
    await ok('cxPreview', MGR, { run: id2 });
    await ok('cxApply', MGR, { run: id2 });
    assert.equal((await call('cxApply', MGR, { run: id1 })).reason, 'stale');
  });
  it('קובץ לכספית אחרי תצוגה מקדימה → האישור נחסם (stale) והסנכרון מוצג שוב; המשך אישור מיושן – נחסם ומסומן void', async () => {
    const id1 = await sendCat(MGR, CAT1);
    await ok('cxPreview', MGR, { run: id1 });
    await ok('saveProduct', MGR, { id: 'cx200002', name: 'צלחת גדולה', price: 14, barcode: '7000000000028' });
    await ok('cxExport', MGR, { kind: 'price' });
    assert.equal((await call('cxApply', MGR, { run: id1 })).reason, 'stale');
    await ok('cxPreview', MGR, { run: id1 }); // תצוגה חוזרת של אותו קובץ – ואז אפשר לאשר
    await ok('cxApply', MGR, { run: id1 });
    const id2 = await sendCat(MGR, CAT1);
    await ok('cxPreview', MGR, { run: id2 });
    await adm().doc(`b/${A}/cxRun/${id2}`).update({ st: 'ap', sel: { take: 'app', skip: [] }, gen: -5 });
    assert.equal((await call('cxApply', MGR, { run: id2 })).reason, 'stale');
    assert.equal((await adm().doc(`b/${A}/cxRun/${id2}`).get()).get('st'), 'void');
  });
  it('פריטים חדשים: שתי קריאות במקביל – קוד אחד למוצר; קוד שהופיע בקטלוג (גם מסונן) לא ניתן', async () => {
    await adm().doc(`b/${A}/cat/c_app`).set({ name: 'כללי', ord: 0 });
    await ok('saveProduct', MGR, { reqId: 'reqcxnew01zz', name: 'מוצר חדש מהאפליקציה', price: 8, cat: 'c_app' });
    const [e1, e2] = await Promise.all([ok('cxExport', MGR, { kind: 'new' }), ok('cxExport', MGR, { kind: 'new' })]);
    assert.equal(e1.added + e2.added, 1);
    const d = (await adm().doc(`b/${A}/prod/preqcxnew01zz`).get()).data();
    assert.equal(d.cx, '900002'); // 900000 – pold2, 900001 – בקטלוג (מסונן)
    const x = (await adm().collection(`b/${A}/cxItem`).where('pid', '==', 'preqcxnew01zz').get()).size;
    assert.equal(x, 1);
  });
  it('"שם כפול – לבדוק": "נבדק" מסיר את הסימון (מנהל בלבד)', async () => {
    assert.notEqual((await call('cxDnOk', E1, { pid: 'cx200005' })).status, 'OK');
    await ok('cxDnOk', MGR, { pid: 'cx200005' });
    assert.equal((await P('cx200005').get()).get('dn'), undefined);
    assert.equal((await P('cx200004').get()).get('dn'), true);
  });
  it('ייבוא מוצרים (importProducts) שמשנה עלות של מוצר קיים – נרשם בהיסטוריה', async () => {
    await ok('importProducts', MGR, { reqId: 'reqcximp01zz', rows: [{ name: 'מגש מלבני', price: 22, barcode: '', cost: 11 }] });
    const h = await ok('cxHist', MGR, { pid: 'cx200004' });
    assert.ok(h.log.some((x) => x.k === 'c' && x.old === 9 && x.new === 11 && x.src === 'app'), JSON.stringify(h.log));
  });
  it('"לא נספר" יורד בתיקון כמות; שום מוצר לא נמחק', async () => {
    await ok('stockSet', MGR, { reqId: 'reqcxset01zz', pid: 'cx200002', qty: 3 });
    const d = (await P('cx200002').get()).data();
    assert.equal(d.nc, undefined); assert.equal(d.q._, 3);
    assert.equal((await adm().collection(`b/${A}/prod`).get()).size, 6);
  });
});
