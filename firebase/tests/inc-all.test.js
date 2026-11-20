'use strict';
// "כל ההכנסות" (functions/inc-all.js – incAll) מול האמולטור. חלק מ-test:multibiz:3. כל הנתונים מומצאים.
//   - סגירות: רק st:'ok' בטווח, אותו חישוב כמו zcCalc (עיגולים במזומן, הנפקת שובר זיכוי במינוס), סכום מעוגל לאגורות.
//   - קופה חדשה: possale לפי soldAt (יום לפי שעון ישראל, כולל חצות), posret מקוזז, מבוטלת לא נספרת, הקפה בנפרד.
//   - כספית: cxDay + cxDayP (חלקי, רק ליום בלי סופי), חיבור הקופות. מקור כבוי בעסק → on:false. עסק אחר לא דולף.
//   - הרשאות: מנהל; עובד רק עם staff.incA (op:'see', מנהל בלבד). עובד מסומן עדיין לא קורא ישירות סגירות/קופה ולא כותב את הסימון.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-ia', B = 'biz-ib', C = 'biz-ic', D = 'biz-id';
const ALL = { cashClose: true, pos: true, cxSales: true, orders: true };
const MGR = 'i_mgr', E1 = 'i_e1', E2 = 'i_e2', MB = 'i_mb', MC = 'i_mc', MD = 'i_md';
const FN = path.join(H.ROOT, 'functions');
let FX;
async function call(name, uid, data) {
  FX = FX || require('../functions/index.js');
  try { return { status: 'OK', result: await FX[name].run({ auth: uid ? { uid, token: { uid } } : null, data: data || {}, rawRequest: { headers: {} } }) }; } catch (e) {
    return { status: (e && e.code) || 'ERR', reason: e && e.details && e.details.reason, text: String(e && e.message).slice(0, 300) };
  }
}
const ok = async (uid, data) => { const r = await call('incAll', uid, data); assert.equal(r.status, 'OK', JSON.stringify(data) + ': ' + r.text); return r.result; };
let env, adm;
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
const R = { op: 'get', from: '2026-11-16', to: '2026-11-17' };
// שעון ישראל בנובמבר = UTC+2
const IL = (d, hm) => Date.parse(d + 'T' + hm + ':00Z') - 2 * 3600e3;
const zcDoc = (st, d, f, extra) => Object.assign({ uid: E1, by: 'דנה', t: 1, st, np: 4, reg: 'i_yh', d, no: '55', tm: '21:00', data: JSON.stringify({ v: 1, f }) }, extra || {});

before(async () => {
  env = await H.getEnv();
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
  adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const b = d.batch();
    const biz = (id, features) => b.set(d.doc('b/' + id), { name: id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features, org: { v: 1, branches: [], banks: [], cards: [] } });
    biz(A, ALL); biz(B, ALL); biz(C, {}); biz(D, { cashClose: true });
    for (const [bz, m] of [[A, MGR], [B, MB], [C, MC], [D, MD]]) {
      b.set(d.doc(`b/${bz}/admins/${m}`), { email: m + '@x.invalid' });
      b.set(d.doc(`b/${bz}/staff/${m}`), { name: m, role: 'manager', active: true });
      b.set(d.doc('users/' + m), { bizId: bz, role: 'admin', active: true, bizStatus: 'active', email: m + '@x.invalid', createdAt: 1 });
    }
    for (const e of [E1, E2]) {
      b.set(d.doc(`b/${A}/staff/${e}`), { name: e, role: 'employee', active: true });
      b.set(d.doc('users/' + e), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: e + '@x.invalid', createdAt: 1 });
    }
    // סגירות: c1 הוכנסה (100 + 50 − 0.30 עיגול + (−20) + 30.50 = 160.20), c2 ממתינה, c3 נדחתה, c4 מחוץ לטווח
    b.set(d.doc(`b/${A}/closings/c1`), zcDoc('ok', '2026-11-16', { credit: '100', cash: '50', round: '-0.3', vissue: '20', house: '30.5', total: '160.2' }, { od: '2026-11-16' }));
    b.set(d.doc(`b/${A}/closings/c2`), zcDoc('new', '2026-11-16', { credit: '999' }));
    b.set(d.doc(`b/${A}/closings/c3`), zcDoc('rej', '2026-11-17', { credit: '999' }));
    b.set(d.doc(`b/${A}/closings/c4`), zcDoc('ok', '2026-11-20', { credit: '999' }));
    b.set(d.doc(`b/${A}/closings/c5`), zcDoc('ok', '2026-11-17', { credit: '1,234.56', cash: '(10)' }, { reg: 'i_nl', no: '7' }));
    // קופה חדשה (אגורות)
    const sale = (id, soldAt, gross, extra) => b.set(d.doc(`b/${A}/possale/${id}`), Object.assign({ id, dev: 'K1', seq: +id.slice(-1), br: '_', cashier: E1, gross, debt: 0, paid: gross, st: 'ok', soldAt, at: soldAt + 1000, lines: [] }, extra || {}));
    sale('K1-S1', IL('2026-11-16', '10:00'), 1234, { debt: 500, custName: 'לקוח א', docs: [{ t: 'ir', id: 'irD-K1-1', no: 1 }] });
    sale('K1-S6', IL('2026-11-16', '10:30'), 4000, { docs: [{ t: 'inv', id: 'invD7', no: 7 }, { t: 'rc', id: 'rcD7', no: 7 }] }); // סדרת מסמכים של העסק (docSeries 'biz')
    sale('K1-S2', IL('2026-11-16', '23:30'), 1000);
    sale('K1-S3', IL('2026-11-17', '00:10'), 777); // אחרי חצות בישראל – יום 17 (ב-UTC עוד 16)
    sale('K1-S4', IL('2026-11-16', '11:00'), 9999, { st: 'void' });
    sale('K1-S5', IL('2026-11-15', '23:59'), 5555); // לפני הטווח
    b.set(d.doc(`b/${A}/posret/K1-R1`), { id: 'K1-R1', dev: 'K1', br: '_', sale: 'K1-S1', amt: 234, by: E1, at: IL('2026-11-16', '12:00'), lines: [], docs: [{ t: 'cr', id: 'crD-K1-1', no: 1 }] });
    // כספית: 16 סופי, 17 חלקי
    b.set(d.doc(`b/${A}/cxDay/6200_20261116`), { d: '2026-11-16', bk: '6200', bn: 'יהודה הנשיא', gross: 200, ret: 10, disc: 5, ntx: 3, nl: 4, sp: 0, un: 0, it: { x: { n: 'סוד', q: 1 } } });
    b.set(d.doc(`b/${A}/cxDayP/6200_20261117`), { d: '2026-11-17', bk: '6200', bn: 'יהודה הנשיא', gross: 50, ret: 0, disc: 0, ntx: 1, nl: 1, sp: 0, un: 0, pt: { at: 1, hm: '13:00' } });
    b.set(d.doc(`b/${A}/cxDayP/6200_20261116`), { d: '2026-11-16', bk: '6200', bn: 'יהודה הנשיא', gross: 1, ret: 0, disc: 0, ntx: 1, nl: 1, sp: 0, un: 0, pt: { at: 1, hm: '09:00' } }); // יש סופי – לא נכלל
    b.set(d.doc(`b/${A}/cxcfg/main`), { reg: { 6200: 'i_yh' } });
    // עסק אחר – לא דולף
    b.set(d.doc(`b/${B}/closings/x1`), zcDoc('ok', '2026-11-16', { credit: '77777' }));
    b.set(d.doc(`b/${C}/closings/y1`), zcDoc('ok', '2026-11-16', { credit: '5' }));
    await b.commit();
  });
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('כל ההכנסות – incAll', () => {
  it('הרשאות: בלי התחברות, ועובד בלי סימון – לא מקבלים נתונים', async () => {
    assert.equal((await call('incAll', null, R)).status, 'unauthenticated');
    for (const d of [R, { op: 'day', d: '2026-11-16' }, { op: 'see', uid: E1, on: true }]) assert.equal((await call('incAll', E1, d)).reason, 'no-perm', JSON.stringify(d));
  });
  it('מנהל: סגירות (רק שהוכנסו), קופה חדשה לפי יום בישראל, כספית להשוואה', async () => {
    const r = await ok(MGR, R);
    assert.equal(r.zc.on, true);
    assert.deepEqual(r.zc.list.map((z) => z.id), ['c1', 'c5'], 'רק st:ok בטווח');
    const c1 = r.zc.list[0];
    assert.equal(c1.amt, 160.2);
    assert.deepEqual(c1.rows, [['אשראי', 100], ['מזומן', 49.7], ['הנפקת שובר זיכוי', -20], ['הקפה', 30.5]]);
    assert.equal(c1.reg, 'i_yh'); assert.equal(c1.od, '2026-11-16'); assert.equal(c1.no, '55');
    assert.equal(r.zc.list[1].amt, 1224.56, 'פסיק אלפים ומינוס בסוגריים');
    assert.equal(r.pos.on, true);
    assert.deepEqual(r.pos.days['2026-11-16'], { s: 62.34, n: 3, r: 2.34, rn: 1, debt: 5 });
    assert.deepEqual(r.pos.docs.slice().sort(), ['crD-K1-1', 'invD7', 'irD-K1-1', 'rcD7'], 'מסמכי הקופה – כדי שהאפליקציה לא תספור אותם שוב ב"אחר"');
    assert.equal(r.zc.more, false);
    assert.deepEqual(r.pos.days['2026-11-17'], { s: 7.77, n: 1, r: 0, rn: 0, debt: 0 });
    assert.equal(r.pos.days['2026-11-15'], undefined);
    assert.equal(r.cx.on, true); assert.deepEqual(r.cx.reg, { 6200: 'i_yh' });
    const d16 = r.cx.days.filter((x) => x.d === '2026-11-16'), d17 = r.cx.days.filter((x) => x.d === '2026-11-17');
    assert.equal(d16.length, 1); assert.equal(d16[0].gross, 200); assert.equal(d16[0].pt, undefined); assert.equal(d16[0].it, undefined, 'בלי פירוט פריטים');
    assert.equal(d17.length, 1); assert.deepEqual(d17[0].pt, { hm: '13:00' });
  });
  it('יום בקופה החדשה: מכירות (כולל מבוטלת, מסומנת), החזרות, שעה בישראל', async () => {
    const r = await ok(MGR, { op: 'day', d: '2026-11-16' });
    assert.deepEqual(r.sales.map((x) => [x.id, x.hm, x.gross, x.st]), [['K1-S1', '10:00', 12.34, 'ok'], ['K1-S6', '10:30', 40, 'ok'], ['K1-S4', '11:00', 99.99, 'void'], ['K1-S2', '23:30', 10, 'ok']]);
    assert.equal(r.sales[0].debt, 5); assert.equal(r.sales[0].cust, 'לקוח א');
    assert.deepEqual(r.rets.map((x) => [x.id, x.amt, x.sale]), [['K1-R1', 2.34, 'K1-S1']]);
    assert.deepEqual((await ok(MGR, { op: 'day', d: '2026-11-17' })).sales.map((x) => x.id), ['K1-S3']);
  });
  it('קלט: טווח, פעולה ושדות', async () => {
    assert.equal((await call('incAll', MGR, { op: 'get', from: '2026-01-01', to: '2026-04-03' })).reason, 'bad-range', '93 ימים');
    assert.equal((await ok(MGR, { op: 'get', from: '2026-01-01', to: '2026-04-02' })).from, '2026-01-01', '92 ימים');
    for (const d of [{ op: 'get', from: '2026-11-17', to: '2026-11-16' }, { op: 'get', from: '2026-02-30', to: '2026-03-01' }, { op: 'get', from: 'x', to: '2026-11-16' }]) assert.equal((await call('incAll', MGR, d)).reason, 'bad-range', JSON.stringify(d));
    assert.equal((await call('incAll', MGR, { op: 'nope' })).reason, 'bad-op');
    assert.equal((await call('incAll', MGR, {})).reason, 'bad-op');
    assert.equal((await call('incAll', MGR, Object.assign({ x: 1 }, R))).reason, 'bad-field');
    assert.equal((await call('incAll', MGR, { op: 'day', d: '2026-13-01' })).reason, 'bad-day');
  });
  it('ריבוי עסקים: כל עסק רואה רק את שלו; תוספות כבויות → on:false', async () => {
    const b = await ok(MB, R);
    assert.deepEqual(b.zc.list.map((z) => z.id), ['x1']); assert.deepEqual(b.pos.days, {});
    const c = await ok(MC, R);
    assert.deepEqual([c.zc.on, c.pos.on, c.cx.on], [false, false, false]);
    assert.deepEqual(c.zc.list, []);
    assert.equal((await call('incAll', MC, { op: 'day', d: '2026-11-16' })).reason, 'feature-off');
  });
  it('op:see – מנהל מסמן עובד; עובד מסומן מקבל נתונים אבל לא מסמן; ביטול חוסם שוב', async () => {
    assert.equal((await call('incAll', MGR, { op: 'see', uid: MGR, on: true })).reason, 'is-admin');
    assert.equal((await call('incAll', MGR, { op: 'see', uid: 'nobody', on: true })).status, 'not-found');
    assert.equal((await call('incAll', MGR, { op: 'see', uid: E2, on: 'yes' })).reason, 'bad-on');
    assert.equal((await call('incAll', MGR, { op: 'see', uid: 'a/b', on: true })).reason, 'bad-uid');
    assert.deepEqual(await ok(MGR, { op: 'see', uid: E2, on: true }), { ok: true, uid: E2, on: true });
    const s = (await adm().doc(`b/${A}/staff/${E2}`).get()).data();
    assert.equal(s.incA, true); assert.equal(s.active, true, 'שאר השדות לא השתנו'); assert.equal(s.name, E2);
    const r = await ok(E2, R); assert.equal(r.zc.list.length, 2);
    await ok(E2, { op: 'day', d: '2026-11-16' });
    assert.equal((await call('incAll', E2, { op: 'see', uid: E1, on: true })).reason, 'manager-only');
    assert.equal((await call('incAll', E1, R)).reason, 'no-perm', 'עובד אחר עדיין חסום');
    // כללי הגישה לא השתנו: העובד המסומן לא קורא ישירות סגירות / מכירות ולא כותב את הסימון
    await assertFails(db(E2).doc(`b/${A}/closings/c1`).get());
    await assertFails(db(E2).doc(`b/${A}/possale/K1-S1`).get());
    await assertFails(db(E2).doc(`b/${A}/cxDay/6200_20261116`).get());
    await assertFails(db(E1).doc(`b/${A}/staff/${E1}`).update({ incA: true }));
    await ok(MGR, { op: 'see', uid: E2, on: false });
    assert.equal((await call('incAll', E2, R)).reason, 'no-perm');
  });
  it('יותר מ-2,000 סגירות בטווח – more:true (לא נחתך בשקט)', async () => {
    const d = adm();
    for (let k = 0; k < 5; k++) { const b = d.batch(); for (let i = 0; i < 401; i++) b.set(d.doc(`b/${D}/closings/m${k}_${i}`), zcDoc('ok', '2026-11-16', { credit: '1' })); await b.commit(); }
    const r = await ok(MD, R);
    assert.equal(r.zc.more, true); assert.equal(r.zc.list.length, 2000);
  });
  it('ליבה: חישוב שורות הסגירה ותחילת יום בישראל (חורף/קיץ)', () => {
    const K = require('../functions/inc-all.js')._core;
    assert.deepEqual(K.zcRows({ cash: '', round: '0.4', credit: '₪ 10' }), { rows: [['אשראי', 10], ['מזומן', 0.4]], amt: 10.4 });
    assert.deepEqual(K.zcRows({}), { rows: [], amt: 0 });
    assert.equal(K.zcRows({ credit: '0.1', checks: '0.2' }).amt, 0.3);
    assert.equal(K.r2(1.005), 1.01, 'עיגול כמו rnd באפליקציה');
    assert.equal(K.r2('1.005'), 1.01);
    assert.equal(K.zcRows({ credit: '1.005' }).amt, 1.01);
    assert.equal(K.r2(-1.005), -1, 'כמו rnd: Math.round עם EPSILON');
    assert.equal(K.dayStart('2026-11-16'), Date.parse('2026-11-15T22:00:00Z'));
    assert.equal(K.dayStart('2026-07-01'), Date.parse('2026-06-30T21:00:00Z'));
  });
});
