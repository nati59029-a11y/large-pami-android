'use strict';
// סנכרון כספית A2/A3 (functions/caspit.js – דוח מכירות → מלאי, מסך מכירות) מול האמולטור. חלק מ-test:multibiz:3. כל הנתונים מומצאים.
//   - כמות מחושבת (בטוח / לפי הנחה / לא בטוח), החזרה מעלה מלאי, קוד מיוחד וקוד לא מוכר – בלי מלאי אבל בסיכום.
//   - תצוגה מקדימה לא כותבת. העלאה חוזרת / דוח חופף / סדר שורות אחר – לא סופרים פעמיים. אישור כפול / חלק חוזר – לא מכפילים.
//   - שתי קופות בכספית → סניף מלאי אחד; לכל שורה נשמר הסניף בכספית. cxDay, cxSales, cxLines, cxFix (תיקון "לא בטוח").
//   - הרשאות: מנהל בלבד. אין סניף מלאי → האישור נחסם. אין יצירת הכנסות ואין הגדרת מקור הכנסות (החלטת בעל העסק 18.11).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-cs', B = 'biz-ct';
const ALL = { orders: true };
const MGR = 's_mgr', E1 = 's_e1', SA = 's_sa', MB = 's_mb';
const FN = path.join(H.ROOT, 'functions');
let FX;
async function call(name, uid, data) {
  FX = FX || require('../functions/index.js');
  try { return { status: 'OK', result: await FX[name].run({ auth: uid ? { uid, token: { uid } } : null, data: data || {}, rawRequest: { headers: {} } }) }; } catch (e) {
    return { status: (e && e.code) || 'ERR', reason: e && e.details && e.details.reason, text: String(e && e.message).slice(0, 300) };
  }
}
const ok = async (name, uid, data) => { const r = await call(name, uid, data); assert.equal(r.status, 'OK', name + ': ' + r.text); return r.result; };
let env, adm, CC; let n = 0;
const run = () => 'cxsrun' + Date.now().toString(36) + (n++) + 'zz';
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();

const HDR = ['תאריך מכירה', 'שם פריט', 'מספר ברקוד', 'מספר עסקה', 'שם סניף', 'מספר סניף', 'משקל', 'הנחה', 'פדיון'];
const Y = ['סניף בדיקה א', '6200'], N2 = ['סניף בדיקה ב', '7700'];
const L = (d, nm, c, tx, br, a, ds) => [d, nm, c, tx, br[0], br[1], '', ds == null ? '0.0' : String(ds), String(a)];
const D1 = '16/11/2026', D2 = '17/11/2026';
const FILE1 = [HDR,
  L(D1, 'מוצר א', '300001', '5001', Y, 20), L(D1, 'מוצר א', '300001', '5001', Y, 10), L(D1, 'מוצר א', '300001', '5001', Y, 10), L(D1, 'פריט כללי', '1000', '5001', Y, 23.6),
  L(D1, 'מוצר ב', '300002', '5002', Y, 9), L(D1, 'מוצר א', '300001', '5002', Y, 7, 3), L(D1, 'מוצר ב', '300002', '5002', Y, -4.5),
  L(D1, 'מוצר א', '300001', '7001', N2, 13), L(D1, 'לא מוכר', '999999', '7001', N2, 5), L(D1, 'מוצר ג', '300003', '7001', N2, 8),
  L(D2, 'מוצר ב', '300002', '5003', Y, 4.5)];
async function send(uid, rows) {
  const p = CC.parseSales(rows); const id = run(); const parts = CC.parts(p.lines, 4);
  for (let k = 0; k < parts.length; k++) await ok('cxUpload', uid, { run: id, kind: 'sales', part: k, parts: parts.length, lines: parts[k] });
  return id;
}
const q = async (biz, id, br) => { const s = await adm().doc(`b/${biz}/prod/${id}`).get(); const v = s.get('q') || {}; return v[br || '_'] || 0; };
const day = async (id) => (await adm().doc(`b/${A}/cxDay/${id}`).get()).data();

before(async () => {
  env = await H.getEnv();
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
  CC = require('../functions/lib/caspit-core.js');
  adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const b = d.batch();
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: ALL, org: { v: 1, branches: [], banks: [], cards: [] } });
    b.set(d.doc('b/' + B), { name: B, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: ALL, org: { v: 1, branches: [{ id: 'b1', name: 'א', on: true }, { id: 'b2', name: 'ב', on: true }], banks: [], cards: [] } });
    for (const [biz, m] of [[A, MGR], [A, SA], [B, MB]]) {
      b.set(d.doc(`b/${biz}/admins/${m}`), { email: m + '@x.invalid' });
      b.set(d.doc(`b/${biz}/staff/${m}`), { name: m, role: 'manager', active: true });
      b.set(d.doc('users/' + m), { bizId: biz, role: 'admin', active: true, bizStatus: 'active', email: m + '@x.invalid', createdAt: 1 });
    }
    b.set(d.doc('superadmins/' + SA), { email: SA + '@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true });
    b.set(d.doc('users/' + E1), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: E1 + '@x.invalid', createdAt: 1 });
    for (const biz of [A, B]) {
      b.set(d.doc(`b/${biz}/prod/p1`), { name: 'מוצר א', price: 10, barcode: '', on: true, q: { _: 5 }, cat: 'k1', at: 1 });
      b.set(d.doc(`b/${biz}/prod/p2`), { name: 'מוצר ב', price: 4.5, barcode: '', on: true, q: {}, at: 1 });
      b.set(d.doc(`b/${biz}/prod/p3`), { name: 'מוצר ג', price: 0, barcode: '', on: true, q: {}, at: 1 });
      b.set(d.doc(`b/${biz}/cat/k1`), { name: 'קטגוריה א', ord: 0 });
      for (const [c, pid] of [['300001', 'p1'], ['300002', 'p2'], ['300003', 'p3'], ['300004', 'gone']]) b.set(d.doc(`b/${biz}/cxItem/${c}`), { c, pid, st: 'link', pr: c === '300003' ? { fb: null, ab: null } : { fb: 99, ab: 99 } }); // 300003: אין מחיר גם בכספית
    }
    await b.commit();
  });
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('סנכרון כספית A2/A3 – דוח מכירות', () => {
  let run1;
  it('הרשאות: עובד ובלי התחברות נחסמים בכל הפונקציות החדשות', async () => {
    for (const u of [E1, null]) {
      assert.notEqual((await call('cxUpload', u, { run: run(), kind: 'sales', part: 0, parts: 1, lines: CC.parseSales(FILE1).lines })).status, 'OK');
      assert.notEqual((await call('cxSales', u, { from: '2026-11-16', to: '2026-11-17' })).status, 'OK');
      assert.notEqual((await call('cxLines', u, { un: true })).status, 'OK');
      assert.notEqual((await call('cxFix', u, { id: '6200_20261116_5001', k: 'x', q: 1 })).status, 'OK');
    }
    assert.equal((await call('cxSales', E1, { from: '2026-11-16', to: '2026-11-17' })).reason, 'manager-only');
  });
  it('שורת מכירה לא תקינה נדחית; סוג קובץ לא מתערבב', async () => {
    assert.equal((await call('cxUpload', MGR, { run: run(), kind: 'sales', part: 0, parts: 1, lines: [{ d: '2026-13-01', c: '1', tx: '1', bk: '1', a: 1 }] })).reason, 'bad-lines');
    assert.equal((await call('cxUpload', MGR, { run: run(), kind: 'sales', part: 0, parts: 1, items: [{ c: '1', n: 'x', p: 1 }] })).reason, 'bad-field');
  });
  it('תצוגה מקדימה: כמויות ומחלקות נכונות, ולא נכתב כלום', async () => {
    run1 = await send(MGR, FILE1);
    const pv = await ok('cxPreview', MGR, { run: run1 });
    assert.equal(pv.kind, 'sales');
    const c = pv.cnt;
    assert.deepEqual([c.lines, c.tx, c.nw, c.dup, c.sure, c.disc, c.unsure, c.skip, c.nolink, c.ret], [11, 4, 11, 0, 6, 1, 2, 1, 1, 1]);
    assert.deepEqual([c.gross, c.retA, c.discA], [110.1, 4.5, 3]);
    const byI = Object.fromEntries(pv.rows.map((r) => [r[0], r]));
    assert.deepEqual([byI[0][8], byI[0][9]], ['sure', 2]);
    assert.deepEqual([byI[5][8], byI[5][9]], ['disc', 1]);
    assert.deepEqual([byI[6][8], byI[6][9]], ['sure', -1]);
    assert.deepEqual([byI[7][8], byI[7][9], byI[7][11]], ['unsure', 1, 'frac']);
    assert.deepEqual([byI[9][8], byI[9][11]], ['unsure', 'noprice']);
    assert.equal(byI[8][8], 'nolink');
    assert.deepEqual(pv.bks, { 6200: 'סניף בדיקה א', 7700: 'סניף בדיקה ב' });
    assert.equal(pv.br, '_');
    assert.equal(await q(A, 'p1'), 5);
    assert.equal((await adm().collection(`b/${A}/cxTx`).get()).size, 0);
    assert.equal((await adm().collection(`b/${A}/cxDay`).get()).size, 0);
  });
  it('אישור: מלאי יורד (החזרה מעלה), קוד מיוחד/לא מוכר בלי מלאי, תיקון כמות בתצוגה; תנועות why:cx; סיכום יומי לכל סניף', async () => {
    const a = await ok('cxApply', MGR, { run: run1, qty: { 9: 2 } }); // שורה 9 (מוצר ג, אין מחיר) – בעל העסק תיקן ל-2
    assert.equal(a.done, true);
    assert.deepEqual([a.res.lines, a.res.stock, a.res.skip, a.res.nolink, a.res.unsure, a.res.tx], [11, 9, 1, 1, 1, 4]);
    assert.deepEqual(a.ix, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // מה שנשמר בפועל – למסך הסיום
    assert.equal(await q(A, 'p1'), 5 - 4 - 1 - 1); // עסקה 5001: 2+1+1, 5002: 1 (הנחה), 7001: 1 (לא בטוח)
    assert.equal(await q(A, 'p2'), -2 + 1 - 1);
    assert.equal(await q(A, 'p3'), -2);
    const t1 = (await adm().doc(`b/${A}/cxTx/6200_20261116_5001`).get()).data();
    assert.equal(t1.lines.length, 4); assert.equal(t1.bk, '6200'); assert.equal(t1.bn, 'סניף בדיקה א'); assert.equal(t1.sb, '_');
    assert.deepEqual(t1.lines.map((l) => l.k), ['300001|20|0|0', '300001|10|0|0', '300001|10|0|1', '1000|23.6|0|0']);
    const t3 = (await adm().doc(`b/${A}/cxTx/7700_20261116_7001`).get()).data();
    assert.deepEqual(t3.lines.map((l) => l.qs), ['unsure', 'nolink', 'own']);
    assert.equal(t3.un, true);
    const d1 = await day('6200_20261116');
    assert.deepEqual([d1.gross, d1.ret, d1.disc, d1.ntx, d1.nl, d1.sp, d1.un], [79.6, 4.5, 3, 2, 7, 23.6, 0]);
    assert.deepEqual([d1.it['300001'].q, d1.it['300001'].a, d1.it['300001'].ds, d1.it['300001'].cat], [5, 47, 3, 'k1']);
    assert.deepEqual([d1.it['300002'].q, d1.it['300002'].r], [2, 1]);
    assert.equal(d1.it['1000'].sp, true);
    const d2 = await day('7700_20261116');
    assert.deepEqual([d2.gross, d2.un, d2.ntx, d2.bk], [26, 1, 1, '7700']);
    const logs = (await adm().collection(`b/${A}/stockLog`).where('why', '==', 'cx').get()).docs.map((x) => x.data());
    assert.ok(logs.every((x) => x.src === 'caspit' && x.br === '_' && /עסקה/.test(x.note)));
    assert.equal(logs.filter((x) => x.prod === 'p1').reduce((s, x) => s + x.delta, 0), -6);
    const again = await ok('cxApply', MGR, { run: run1 });
    assert.equal(again.dup, true);
    assert.equal(await q(A, 'p1'), -1);
  });
  it('חלק חוזר (ניסיון חוזר אחרי תקלה) לא כותב שוב', async () => {
    const C = require('../functions/caspit.js')._core;
    const ref = adm().doc(`b/${A}/cxRun/${run1}`);
    const groups = (await ref.collection('pv').doc('0').get()).get('rows');
    const tdb = require('../functions/lib/tenant').prefixed(adm(), `b/${A}/`);
    await C.applySalesPart(tdb, { uid: MGR }, run1, ref, 0, groups, {}, '_');
    assert.equal(await q(A, 'p1'), -1);
    // גם בלי סימון החלק: שורות שכבר שמורות בעסקה לא נספרות שוב
    await C.applySalesPart(tdb, { uid: MGR }, run1, ref, 99, groups, {}, '_');
    assert.equal(await q(A, 'p1'), -1);
    assert.equal((await day('6200_20261116')).nl, 7);
  });
  it('העלאה חוזרת של אותו דוח (גם בסדר שורות הפוך) – 0 שורות חדשות, המלאי לא משתנה', async () => {
    const id = await send(MGR, [HDR].concat(FILE1.slice(1).reverse()));
    const pv = await ok('cxPreview', MGR, { run: id });
    assert.deepEqual([pv.cnt.nw, pv.cnt.dup, pv.cnt.gone], [0, 11, 0]);
    const a = await ok('cxApply', MGR, { run: id });
    assert.equal(a.res.lines || 0, 0);
    assert.equal(await q(A, 'p1'), -1);
    assert.equal((await day('6200_20261116')).ntx, 2);
  });
  it('דוח חופף: רק העסקה החדשה נקלטת; שורה שנעלמה מעסקה – אזהרה בלבד', async () => {
    const F = [HDR, L(D2, 'מוצר ב', '300002', '5003', Y, 4.5), L(D2, 'מוצר א', '300001', '5004', Y, 30), L(D1, 'מוצר א', '300001', '5001', Y, 20)];
    const id = await send(MGR, F);
    const pv = await ok('cxPreview', MGR, { run: id });
    assert.deepEqual([pv.cnt.nw, pv.cnt.dup, pv.cnt.gone], [1, 2, 3]); // 5001 בקובץ עם שורה אחת מתוך 4 → 3 "נעלמו" (לא מבוטלות)
    await ok('cxApply', MGR, { run: id });
    assert.equal(await q(A, 'p1'), -4);
    const d = await day('6200_20261117');
    assert.deepEqual([d.ntx, d.nl, d.gross], [2, 2, 34.5]);
    assert.equal((await adm().doc(`b/${A}/cxTx/6200_20261116_5001`).get()).get('lines').length, 4);
  });
  it('cxSales: ימים בטווח, קטגוריות, הגדרות; cxLines לפי יום+סניף, לפי מוצר, ו"לא בטוח"', async () => {
    const s = await ok('cxSales', MGR, { from: '2026-11-16', to: '2026-11-17' });
    assert.equal(s.days.length, 3);
    assert.ok(!s.days[0].it && s.items['300001']); // צורה קומפקטית
    assert.equal(s.cats.k1, 'קטגוריה א');
    assert.equal(s.cfg.inc, undefined); assert.equal(s.sa, false);
    const T = CC.aggDays(CC.unpackDays(s));
    assert.deepEqual([T.gross, T.ret, T.disc, T.net, T.ntx, T.un], [140.1, 4.5, 3, 132.6, 5, 1]);
    const it1 = T.items.find((x) => x.c === '300001');
    assert.deepEqual([it1.q, it1.r, it1.a], [9, 0, 87]);
    assert.equal((await ok('cxSales', MGR, { from: '2026-11-17', to: '2026-11-17' })).days.length, 1);
    assert.equal((await call('cxSales', MGR, { from: '2026-11-17', to: '2026-11-16' })).reason, 'bad-range');
    assert.equal((await call('cxSales', MGR, { from: '2026-01-01', to: '2026-04-02' })).status, 'OK'); // 92 ימים
    assert.equal((await call('cxSales', MGR, { from: '2026-01-01', to: '2026-04-03' })).reason, 'bad-range'); // 93 – הטלפון מבקש בחלקים
    const bd = await ok('cxLines', MGR, { bd: '6200_20261116' });
    assert.deepEqual(bd.tx.map((x) => x.tx).sort(), ['5001', '5002']);
    const pc = await ok('cxLines', MGR, { c: '300001', days: ['2026-11-16', '2026-11-17'] });
    assert.equal(pc.tx.reduce((s2, x) => s2 + x.lines.length, 0), 6);
    assert.ok(pc.tx.every((x) => x.lines.every((l) => l.c === '300001')));
    const un = await ok('cxLines', MGR, { un: true });
    assert.equal(un.tx.length, 1); assert.equal(un.tx[0].lines.length, 1); assert.equal(un.tx[0].lines[0].why, 'frac');
  });
  it('cxFix: אישור בלי שינוי → "אושר", בלי תנועת מלאי; תיקון → ההפרש במלאי ובסיכום היומי', async () => {
    const id = '7700_20261116_7001', k = '300001|13|0|0';
    const logs0 = (await adm().collection(`b/${A}/stockLog`).get()).size;
    const r1 = await ok('cxFix', MGR, { id, k, q: 1 });
    assert.deepEqual([r1.qs, r1.delta], ['ok', 0]);
    assert.equal((await adm().collection(`b/${A}/stockLog`).get()).size, logs0);
    let d = await day('7700_20261116');
    assert.deepEqual([d.un, d.it['300001'].u], [0, 0]);
    assert.equal((await adm().doc(`b/${A}/cxTx/${id}`).get()).get('un'), false);
    const r2 = await ok('cxFix', MGR, { id, k, q: 2 });
    assert.deepEqual([r2.qs, r2.delta], ['own', 1]);
    assert.equal(await q(A, 'p1'), -5);
    d = await day('7700_20261116');
    assert.equal(d.it['300001'].q, 2); assert.equal(d.un, 0);
    assert.equal((await call('cxFix', MGR, { id, k: '999999|5|0|0', q: 1 })).reason, 'no-stock-line');
    assert.equal((await call('cxFix', MGR, { id, k, q: -1 })).reason, 'bad-sign'); // מכירה עם כמות שלילית – נדחה
    assert.equal(await q(A, 'p1'), -5);
  });
  it('החוקים: cxTx ו-cxDay סגורים לקריאה ולכתיבה ישירה – גם למנהל', async () => {
    await assertFails(db(MGR).doc(`b/${A}/cxTx/6200_20261116_5001`).get());
    await assertFails(db(MGR).doc(`b/${A}/cxDay/6200_20261116`).get());
    await assertFails(db(MGR).doc(`b/${A}/cxDay/x`).set({ d: 'x' }));
  });
  it('הגדרות: מיפוי סניף כספית → קופה (מחליף את הקודם); אין פונקציית מקור הכנסות', async () => {
    await ok('cxSetCfg', MGR, { reg: { 6200: 'i_yh', 7700: 'i_nl' } });
    await ok('cxSetCfg', MGR, { reg: { 6200: 'i_yh', 7700: '' } });
    assert.deepEqual((await ok('cxCfg', MGR)).cfg.reg, { 6200: 'i_yh' });
    assert.equal((await call('cxSetCfg', MGR, { reg: { 'a/b': 'i_yh' } })).reason, 'bad-reg');
    assert.equal(FX.cxSetInc, undefined); // החלטת בעל העסק 18.11: אין הגדרת מקור הכנסות – ההכנסות רק מסגירת הקופה
    assert.equal((await ok('cxSales', SA, { from: '2026-11-16', to: '2026-11-16' })).sa, true);
    assert.equal((await ok('cxCfg', MGR)).cfg.skip.length, 5); // שאר ההגדרות לא נמחקו
  });
  it('תיקון סבב 1: שורה פגומה בחלק מדולגת ונספרת; מספר סניף חסר → לפי השם שנלמד; ספירת מלאי ידנית → אזהרה; כמות בסימן הפוך – לא מתקבלת', async () => {
    const good = CC.parseSales([HDR, L('18/11/2026', 'מוצר א', '300001', '6001', Y, 10), L('18/11/2026', 'מוצר א', '300001', '6002', ['סניף בדיקה א', ''], 10), L('18/11/2026', 'מוצר ב', '300002', '6003', Y, 4.5)]).lines;
    assert.equal(good[1].bkn, true); assert.equal(good[1].bk, CC.brKey('', 'סניף בדיקה א'));
    // מוצר ב נספר ידנית ב-19.11 (אחרי המכירות של 18.11)
    await ok('stockSet', MGR, { reqId: 'reqcxsset1zz', pid: 'p2', qty: 7 });
    await adm().collection(`b/${A}/stockLog`).where('why', '==', 'set').get().then((sn) => Promise.all(sn.docs.map((d) => d.ref.update({ at: Date.parse('2026-11-19T10:00:00Z') }))));
    const id = run();
    const up = await ok('cxUpload', MGR, { run: id, kind: 'sales', part: 0, parts: 1, lines: good.concat([{ d: '2026-11-18', c: '300001', tx: '6004', bk: '6200', a: 5, ds: 5e9 }]) });
    assert.deepEqual([up.n, up.bad], [3, 1]);
    const pv = await ok('cxPreview', MGR, { run: id });
    assert.deepEqual([pv.cnt.badSrv, pv.cnt.bkLeft, pv.cnt.pc], [1, 0, 1]);
    assert.ok(pv.rows.every((r) => r[7] === '6200')); // אותו מפתח סניף גם בלי עמודת המספר
    assert.equal(pv.rows.find((r) => r[3] === '300002')[12], '2026-11-19');
    const p1 = await q(A, 'p1'), p2 = await q(A, 'p2');
    const a = await ok('cxApply', MGR, { run: id, qty: { 0: -3, 2: 0 } }); // 0: סימן הפוך – מתעלמים; 2: נכלל בספירה → 0
    assert.equal(a.res.lines, 3);
    assert.equal(await q(A, 'p1'), p1 - 2);
    assert.equal(await q(A, 'p2'), p2);
    assert.equal((await adm().doc(`b/${A}/cxcfg/main`).get()).get('bkn')[CC.brKey('', 'סניף בדיקה א')], '6200');
  });
  it('תיקון סבב 1: קישור קוד→מוצר השתנה בין התצוגה לאישור → stale, ההרצה חוזרת לתצוגה, ואחרי תצוגה חוזרת – המלאי יורד מהמוצר החדש', async () => {
    const id = await send(MGR, [HDR, L('20/11/2026', 'מוצר א', '300001', '6100', Y, 10)]);
    await ok('cxPreview', MGR, { run: id });
    await adm().doc(`b/${A}/cxItem/300001`).update({ pid: 'p2' });
    const p1 = await q(A, 'p1'), p2 = await q(A, 'p2');
    assert.equal((await call('cxApply', MGR, { run: id })).reason, 'stale');
    assert.equal((await adm().doc(`b/${A}/cxRun/${id}`).get()).get('st'), 'pv');
    assert.equal(await q(A, 'p1'), p1);
    const pv = await ok('cxPreview', MGR, { run: id });
    assert.equal(pv.rows[0][8], 'unsure'); // 10 / 4.5 – לא שלם
    await ok('cxApply', MGR, { run: id });
    assert.equal(await q(A, 'p1'), p1); assert.equal(await q(A, 'p2'), p2 - 2);
    await adm().doc(`b/${A}/cxItem/300001`).update({ pid: 'p1' });
  });
  it('עסק עם כמה סניפים: בלי סניף מלאי – האישור נחסם; אחרי בחירה – המלאי יורד בסניף שנבחר', async () => {
    const id = await send(MB, [HDR, L(D1, 'מוצר א', '300001', '9001', Y, 20)]);
    const pv = await ok('cxPreview', MB, { run: id });
    assert.equal(pv.br, null);
    assert.equal((await call('cxApply', MB, { run: id })).reason, 'no-br');
    assert.equal((await call('cxSetCfg', MB, { br: 'zz' })).reason, 'bad-br');
    await ok('cxSetCfg', MB, { br: 'b2' });
    await ok('cxApply', MB, { run: id });
    assert.equal(await q(B, 'p1', 'b2'), -2);
    assert.equal(await q(B, 'p1', '_'), 5);
  });
  it('C1: שעת מכירה – נשמרת בעסקה ובפילוח השעות של הסיכום היומי (בלי שעה → na, חצות → 00); cxSales מחזיר h; קובץ בלי שעות – יום בלי שעות', async () => {
    const F = [HDR, L('25/11/2026 14:05', 'מוצר א', '300001', '8001', Y, 20), L('25/11/2026 14:50', 'מוצר א', '300001', '8001', Y, 10, 2), L('25/11/2026 09:00', 'מוצר ב', '300002', '8002', Y, -4.5),
      L('25/11/2026', 'פריט כללי', '1000', '8003', Y, 7), L('26/11/2026 00:00', 'מוצר א', '300001', '8004', Y, 10), L('25/11/2026 23:59', 'מוצר א', '300001', '8101', N2, 10)];
    const lines = CC.parseSales(F).lines;
    assert.deepEqual(lines.map((l) => l.t), [845, 890, 540, undefined, 0, 1439]);
    // שעה לא תקינה מהלקוח – השורה נקלטת בלי שעה (לא נדחית)
    const up = await ok('cxUpload', MGR, { run: run(), kind: 'sales', part: 0, parts: 1, lines: [Object.assign({}, lines[0], { t: 5000 })] });
    assert.deepEqual([up.n, up.bad], [1, 0]);
    const id = await send(MGR, F);
    await ok('cxPreview', MGR, { run: id });
    await ok('cxApply', MGR, { run: id });
    const d = await day('6200_20261125');
    assert.deepEqual(d.h, { 14: 28, '09': -4.5, na: 7 }); // 20 + (10 − 2 הנחה); החזרה במינוס; בלי שעה → na
    assert.equal(CC.r2(Object.values(d.h).reduce((a, b) => a + b, 0)), CC.r2(d.gross - d.ret - d.disc));
    assert.deepEqual((await day('6200_20261126')).h, { '00': 10 });
    assert.deepEqual((await day('7700_20261125')).h, { 23: 10 });
    const t = (await adm().doc(`b/${A}/cxTx/6200_20261125_8001`).get()).data();
    assert.deepEqual(t.lines.map((l) => l.t), [845, 890]);
    // העלאה חוזרת – לא סופרים שוב גם בשעות
    const id2 = await send(MGR, F); await ok('cxPreview', MGR, { run: id2 }); await ok('cxApply', MGR, { run: id2 });
    assert.deepEqual((await day('6200_20261125')).h, { 14: 28, '09': -4.5, na: 7 });
    const s = await ok('cxSales', MGR, { from: '2026-11-25', to: '2026-11-26' });
    const H = CC.salesHours(CC.unpackDays(s));
    assert.deepEqual(H.hours['2026-11-25'], { 14: 28, '09': -4.5, 23: 10, na: 7 });
    assert.deepEqual(H.day, { '2026-11-25': 40.5, '2026-11-26': 10 });
    assert.deepEqual(CC.salesHours(CC.unpackDays(s), '7700').hours, { '2026-11-25': { 23: 10 } });
    // קובץ בלי שעות (FILE1) – הכול ב-na, והיום חוזר בלי שעות (גם יום ישן בלי h בכלל – ראו בדיקת היחידה)
    assert.deepEqual((await day('6200_20261116')).h, { na: 72.1 });
    const old = await ok('cxSales', MGR, { from: '2026-11-16', to: '2026-11-16' });
    assert.deepEqual(CC.salesHours(CC.unpackDays(old)).hours['2026-11-16'], {});
  });
  it('C2: סטטיסטיקת שעת המכירה (tm) עוברת בתוך שורה → in → cnt → cxDay.tm; AM/PM; tm פגום/דפוס עם ספרות – מנוקה, השורה לא נדחית; לקוח ישן בלי tm – עובד', async () => {
    const F = [HDR, L('27/11/2026 2:05 PM', 'מוצר א', '300001', '8201', Y, 10), L('27/11/2026', 'מוצר ב', '300002', '8202', Y, 4.5), L('27/11/2026 9:00 AM', 'מוצר א', '300001', '8203', Y, 10)];
    const p = CC.parseSales(F);
    assert.deepEqual(p.tm, { y: 2, n: 1, p: 'dd/dd/dddd', q: 'dd/dd/dddd d:dd aa' });
    const id = await send(MGR, F);
    assert.deepEqual((await adm().doc(`b/${A}/cxRun/${id}/in/0`).get()).get('tm'), p.tm);
    const pv = await ok('cxPreview', MGR, { run: id });
    assert.deepEqual(pv.cnt.tm, p.tm);
    await ok('cxApply', MGR, { run: id });
    const d = await day('6200_20261127');
    assert.deepEqual(d.tm, p.tm);
    assert.deepEqual(d.h, { 14: 10, '09': 10, na: 4.5 });
    const s = await ok('cxSales', MGR, { from: '2026-11-27', to: '2026-11-27' });
    assert.deepEqual(CC.unpackDays(s)[0].tm, p.tm);
    const lx = await ok('cxLines', MGR, { bd: '6200_20261127' });
    assert.deepEqual(lx.tx.flatMap((x) => x.lines.map((l) => l.t)).sort(), [540, 845, undefined].sort());
    // tm פגום (מערך / דפוס עם ספרות ואותיות) – מנוקה או מתעלמים; השורה נקלטת
    const L0 = Object.assign({}, p.lines[0]);
    for (const [tm, want] of [[['x'], undefined], [{ y: 1.5, n: 0 }, undefined], [{ y: 1, n: 2, p: '27/11/2026 14:05 Fri', q: 5 }, { y: 1, n: 2, p: '??/??/???? ??:?? ???', q: '' }]]) {
      const r = run(); const up = await ok('cxUpload', MGR, { run: r, kind: 'sales', part: 0, parts: 1, lines: [Object.assign({}, L0, { tm })] });
      assert.equal(up.n, 1);
      assert.deepEqual((await adm().doc(`b/${A}/cxRun/${r}/in/0`).get()).get('tm'), want);
    }
    // לקוח ישן (בלי tm): עובד, ו-cxDay.tm הקודם נשאר
    const F2 = [HDR, L('27/11/2026', 'מוצר ב', '300002', '8204', Y, 4.5)];
    const old = CC.parseSales(F2).lines.map(({ tm, ...l }) => l);
    const r2 = run(); await ok('cxUpload', MGR, { run: r2, kind: 'sales', part: 0, parts: 1, lines: old });
    const pv2 = await ok('cxPreview', MGR, { run: r2 }); assert.equal(pv2.cnt.tm, undefined);
    await ok('cxApply', MGR, { run: r2 });
    const d2 = await day('6200_20261127');
    assert.deepEqual(d2.tm, p.tm); assert.equal(d2.h.na, 9);
    // דוח חדש עם tm אחר מחליף את כולו (גם p ריק)
    const F3 = [HDR, L('27/11/2026 10:00', 'מוצר ב', '300002', '8205', Y, 4.5)];
    const id3 = await send(MGR, F3); await ok('cxPreview', MGR, { run: id3 }); await ok('cxApply', MGR, { run: id3 });
    assert.deepEqual((await day('6200_20261127')).tm, { y: 1, n: 0, p: '', q: 'dd/dd/dddd dd:dd' });
  });
});
