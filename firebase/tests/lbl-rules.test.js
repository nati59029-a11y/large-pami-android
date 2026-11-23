'use strict';
// הדפסת מדבקות (22.11.2026): המתג lbl ("הדפסת מדבקות") – קריאת prod כשתוספת ההזמנות פעילה, והאוסף lblp (מוצר שהוקלד ידנית).
// רץ מול אמולטור Firestore (חלק מ-test:multibiz:5). עסק במצב b ולארג' פעמי בשורש (legacy).
const { describe, it, before, after, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-lbl', OFF = 'biz-lbl-off';
const MGR = 'l_mgr', LBL = 'l_lbl', NOL = 'l_nol', OLD = 'l_old', OUT = 'l_out', RMGR = 'r_mgr', RLBL = 'r_lbl', ROLD = 'r_old';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false, shf: false, yl: false, tkS: false, lbl: false };

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
const good = (uid, x) => Object.assign({ name: 'במבה 80 גרם', price: 4.9, barcode: '63621060', pack: '80 גרם', at: Date.now(), by: uid }, x || {});

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    const biz = (id, orders) => b.set(d.doc('b/' + id), { name: id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { orders } });
    biz(A, true); biz(OFF, false);
    for (const z of [A, OFF]) {
      b.set(d.doc(`b/${z}/admins/${MGR}`), { email: MGR + '@example.invalid' });
      b.set(d.doc(`b/${z}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
      b.set(d.doc(`b/${z}/staff/${LBL}`), { name: LBL, role: 'employee', active: true, perms: Object.assign({}, NONE, { lbl: true }) });
      b.set(d.doc(`b/${z}/staff/${NOL}`), { name: NOL, role: 'employee', active: true, perms: Object.assign({}, NONE) });
      b.set(d.doc(`b/${z}/staff/${OLD}`), { name: OLD, role: 'employee', active: true }); // עובד ישן בלי perms: lbl כבוי
      b.set(d.doc(`b/${z}/staff/${OUT}`), { name: OUT, role: 'employee', active: false, perms: Object.assign({}, NONE, { lbl: true }) });
      b.set(d.doc(`b/${z}/prod/p1`), { name: 'במבה', price: 5, barcode: '7290000068183' });
      b.set(d.doc(`b/${z}/lblp/m1`), good(MGR));
    }
    // לארג' פעמי בשורש (legacy)
    b.set(d.doc('admins/' + RMGR), { email: RMGR + '@example.invalid' });
    b.set(d.doc('staff/' + RLBL), { name: RLBL, active: true, perms: Object.assign({}, NONE, { lbl: true }) });
    b.set(d.doc('staff/' + ROLD), { name: ROLD, active: true });
    b.set(d.doc('prod/p1'), { name: 'במבה', price: 5 });
    b.set(d.doc('lblp/m1'), good(RMGR));
    await b.commit();
  });
}

before(async () => { env = await H.getEnv(); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(seed);

describe('הדפסת מדבקות – חוקים (b/{bizId})', () => {
  it('עובד עם lbl קורא מוצרים כשההזמנות פעילות; בלי lbl / ישן / מושבת – לא (בלי ord)', async () => {
    await assertSucceeds(db(LBL).doc(`b/${A}/prod/p1`).get());
    await assertSucceeds(db(LBL).collection(`b/${A}/prod`).limit(5).get());
    await assertFails(db(NOL).doc(`b/${A}/prod/p1`).get());
    await assertFails(db(OUT).doc(`b/${A}/prod/p1`).get());
    await assertFails(db(LBL).doc(`b/${A}/prod/p1/p/cost`).get(), 'עלות – לא דרך lbl');
  });
  it('תוספת ההזמנות כבויה – גם עם lbl אין קריאת מוצרים', async () => {
    await assertFails(db(LBL).doc(`b/${OFF}/prod/p1`).get());
  });
  it('lblp: מנהל ועובד עם lbl קוראים ושומרים מוצר תקין', async () => {
    await assertSucceeds(db(LBL).collection(`b/${A}/lblp`).get());
    await assertSucceeds(db(LBL).doc(`b/${A}/lblp/bc_63621060`).set(good(LBL)));
    await assertSucceeds(db(LBL).doc(`b/${A}/lblp/m1`).set(good(LBL, { price: 5.5 })));
    await assertSucceeds(db(LBL).doc(`b/${A}/lblp/m2`).set({ name: 'בלי ברקוד', price: 0, at: Date.now(), by: LBL }));
    await assertSucceeds(db(MGR).doc(`b/${A}/lblp/m3`).set(good(MGR)));
    await assertSucceeds(db(MGR).collection(`b/${A}/lblp`).get());
  });
  it('lblp: עובד בלי lbl / ישן / מושבת – לא קורא ולא כותב', async () => {
    for (const u of [NOL, OLD, OUT]) {
      await assertFails(db(u).collection(`b/${A}/lblp`).get());
      await assertFails(db(u).doc(`b/${A}/lblp/x_${u}`).set(good(u)));
    }
  });
  it('lblp: שדות לא תקינים נחסמים', async () => {
    const bad = [
      { extra: 1 }, { name: '' }, { name: 'א'.repeat(121) }, { price: -1 }, { price: 100001 }, { price: '5' },
      { barcode: '1'.repeat(41) }, { barcode: 'ברקוד' }, { barcode: 5 }, { pack: 'x'.repeat(31) }, { at: 'now' }, { by: MGR },
    ];
    for (const x of bad) await assertFails(db(LBL).doc(`b/${A}/lblp/bad`).set(good(LBL, x)), JSON.stringify(x).slice(0, 40));
    await assertFails(db(LBL).doc(`b/${A}/lblp/bad`).set({ price: 1, at: Date.now(), by: LBL }), 'חסר שם');
  });
  it('lblp: מחיקה – רק מנהל', async () => {
    await assertFails(db(LBL).doc(`b/${A}/lblp/m1`).delete());
    await assertSucceeds(db(MGR).doc(`b/${A}/lblp/m1`).delete());
  });
});

describe('הדפסת מדבקות – חוקים בשורש (לארג\' פעמי, legacy)', () => {
  it('עובד עם lbl קורא מוצרים ו-lblp ושומר מוצר תקין; עובד ישן – lblp חסום', async () => {
    await assertSucceeds(db(RLBL).doc('prod/p1').get());
    await assertSucceeds(db(RLBL).collection('lblp').get());
    await assertSucceeds(db(RLBL).doc('lblp/bc_1').set(good(RLBL)));
    await assertFails(db(RLBL).doc('lblp/bc_1').set(good(RLBL, { extra: 1 })));
    await assertFails(db(RLBL).doc('lblp/m1').delete());
    await assertFails(db(ROLD).collection('lblp').get());
    await assertFails(db(ROLD).doc('lblp/x').set(good(ROLD)));
    await assertSucceeds(db(RMGR).doc('lblp/m1').delete());
  });  it('נעילת השורש (lpW): אחרי המעבר (b/largpeami.dataRoot = b) אין כתיבה ומחיקה ב-lblp בשורש; קריאה מותרת; legacy פותח שוב', async () => {
    const lp = (dataRoot) => prep((d) => d.doc('b/largpeami').set({ name: 'lp', status: 'active', dataRoot, schemaVersion: 1, createdAt: 1, createdBy: 'migrate', migrationTarget: true }));
    await lp('b');
    await assertFails(db(RLBL).doc('lblp/bc_2').set(good(RLBL)));
    await assertFails(db(RLBL).doc('lblp/m1').set(good(RLBL, { price: 1 })));
    await assertFails(db(RMGR).doc('lblp/m1').delete());
    await assertSucceeds(db(RLBL).collection('lblp').get());
    await lp('legacy');
    await assertSucceeds(db(RLBL).doc('lblp/bc_2').set(good(RLBL)));
    await assertSucceeds(db(RMGR).doc('lblp/m1').delete());
  });
});
