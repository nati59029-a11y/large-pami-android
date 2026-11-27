'use strict';
// הדפסת מדבקות (22.11.2026): המתג lbl ("הדפסת מדבקות") – קריאת prod כשתוספת ההזמנות פעילה, והאוסף lblp (מוצר שהוקלד ידנית).
// רץ מול אמולטור Firestore (חלק מ-test:multibiz:5). עסק במצב b ולארג' פעמי בשורש (legacy).
const { describe, it, before, after, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-lbl', OFF = 'biz-lbl-off';
const MGR = 'l_mgr', LBL = 'l_lbl', NOL = 'l_nol', OLD = 'l_old', OUT = 'l_out', RMGR = 'r_mgr', RLBL = 'r_lbl', ROLD = 'r_old';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false, shf: false, yl: false, tkS: false, lbl: false, edb: false, bake: false };

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
  it('נעילת השורש (lpW) גם ל-lblt ול-lbls: אחרי המעבר אין כתיבה ומחיקה בשורש; קריאה מותרת; legacy פותח שוב', async () => {
    await prep(async (d) => { await d.doc('lblt/t1').set(tpl(RMGR)); await d.doc('lbls/main').set(sets(RMGR)); });
    const lp = (dataRoot) => prep((d) => d.doc('b/largpeami').set({ name: 'lp', status: 'active', dataRoot, schemaVersion: 1, createdAt: 1, createdBy: 'migrate', migrationTarget: true }));
    await lp('b');
    await assertFails(db(RLBL).doc('lblt/t2').set(tpl(RLBL)));
    await assertFails(db(RLBL).doc('lblt/t1').set(tpl(RLBL, { del: true })));
    await assertFails(db(RMGR).doc('lblt/t1').delete());
    await assertFails(db(RLBL).doc('lbls/main').set(sets(RLBL)));
    await assertFails(db(RMGR).doc('lbls/main').delete());
    await assertSucceeds(db(RLBL).collection('lblt').get());
    await assertSucceeds(db(RLBL).doc('lbls/main').get());
    await lp('legacy');
    await assertSucceeds(db(RLBL).doc('lblt/t2').set(tpl(RLBL)));
    await assertSucceeds(db(RLBL).doc('lbls/main').set(sets(RLBL)));
    await assertSucceeds(db(RMGR).doc('lblt/t1').delete());
  });
});

// תבניות מדבקה (lblt) והגדרות מדבקות (lbls/main) – 24.11.2026. אותן בדיקות בשורש (legacy) ובתוך b/{bizId}.
const tpl = (uid, x) => Object.assign({ v: 1, name: 'מדבקת מחיר', w: 50, h: 30, base: 1, j: '{"el":[]}', at: Date.now(), by: uid }, x || {});
const sets = (uid, x) => Object.assign({ sz: [{ w: 50, h: 30 }], def: 't1', at: Date.now(), by: uid }, x || {});
// oth = משתמש של עסק אחר: ב-b – מנהל ועובד עם lbl רק בעסק OFF; בשורש – מנהל של b/biz-lbl (אין לו מסמך בשורש).
for (const [title, P, mgr, lbl, nol, old, out, oth] of [
  ['b/{bizId}', `b/${A}/`, MGR, LBL, NOL, OLD, OUT, 'l_oth'],
  ['שורש (legacy)', '', RMGR, RLBL, 'r_nol', ROLD, 'r_out', MGR],
]) {
  describe(`תבניות והגדרות מדבקות – חוקים (${title})`, () => {
    beforeEach(() => prep(async (d) => {
      const b = d.batch();
      if (!P) {
        b.set(d.doc('staff/r_nol'), { name: 'r_nol', active: true, perms: Object.assign({}, NONE) });
        b.set(d.doc('staff/r_out'), { name: 'r_out', active: false, perms: Object.assign({}, NONE, { lbl: true }) });
      }
      b.set(d.doc(`b/${OFF}/admins/l_oth`), { email: 'l_oth@example.invalid' });
      b.set(d.doc(`b/${OFF}/staff/l_oth`), { name: 'l_oth', role: 'employee', active: true, perms: Object.assign({}, NONE, { lbl: true }) });
      b.set(d.doc(P + 'lblt/t1'), tpl(mgr));
      b.set(d.doc(P + 'lbls/main'), sets(mgr));
      await b.commit();
    }));
    it('lblt: מנהל ועובד עם lbl קוראים, יוצרים ומעדכנים תבנית תקינה; עובד מוחק "רך" (del:true)', async () => {
      await assertSucceeds(db(lbl).collection(P + 'lblt').get());
      await assertSucceeds(db(lbl).doc(P + 'lblt/t2').set(tpl(lbl)));
      await assertSucceeds(db(lbl).doc(P + 'lblt/t1').set(tpl(lbl, { name: 'שונה', w: 104, h: 100 })));
      const { base, ...noBase } = tpl(lbl, { w: 15, h: 10 }); // בלי base (רשות)
      await assertSucceeds(db(lbl).doc(P + 'lblt/t3').set(noBase));
      await assertSucceeds(db(lbl).doc(P + 'lblt/t1').set(tpl(lbl, { del: true })));
      await assertSucceeds(db(mgr).doc(P + 'lblt/t_M-1').set(tpl(mgr)));
      await assertSucceeds(db(mgr).collection(P + 'lblt').get());
    });
    it('lblt: עובד בלי lbl / ישן בלי perms / מושבת – לא קורא ולא כותב', async () => {
      for (const u of [nol, old, out]) {
        await assertFails(db(u).collection(P + 'lblt').get(), u);
        await assertFails(db(u).doc(P + 'lblt/x1').set(tpl(u)), u);
      }
    });
    it('lblt: שדות / מזהה לא תקינים נחסמים', async () => {
      const bad = [
        { extra: 1 }, { j: 'x'.repeat(16001) }, { j: 'x' }, { by: mgr }, { w: 14 }, { w: 105 }, { h: 9 }, { h: 101 }, { w: '50' },
        { v: 0 }, { v: 10 }, { v: 1.5 }, { name: '' }, { name: 'א'.repeat(41) }, { base: 6 }, { del: 'yes' }, { at: 0 },
      ];
      for (const x of bad) await assertFails(db(lbl).doc(P + 'lblt/bad').set(tpl(lbl, x)), JSON.stringify(x).slice(0, 40));
      await assertFails(db(lbl).doc(P + 'lblt/bad').set({ v: 1, name: 'א', w: 50, h: 30, at: Date.now(), by: lbl }), 'חסר j');
      await assertFails(db(lbl).doc(P + 'lblt/' + 'a'.repeat(41)).set(tpl(lbl)), 'מזהה ארוך');
      await assertFails(db(lbl).doc(P + 'lblt/a.b').set(tpl(lbl)), 'מזהה עם נקודה');
      await assertFails(db(lbl).doc(P + 'lblt/א1').set(tpl(lbl)), 'מזהה בעברית');
    });
    it('lblt: מחיקה מלאה – רק מנהל', async () => {
      await assertFails(db(lbl).doc(P + 'lblt/t1').delete());
      await assertSucceeds(db(mgr).doc(P + 'lblt/t1').delete());
    });
    it('lbls/main: עובד עם lbl קורא ושומר; מסמך אחר / sz מעל 10 / שדה נוסף – חסום; עובד בלי lbl – חסום; מחיקה – מנהל', async () => {
      await assertSucceeds(db(lbl).doc(P + 'lbls/main').get());
      await assertSucceeds(db(lbl).doc(P + 'lbls/main').set(sets(lbl, { sz: Array.from({ length: 10 }, () => ({ w: 40, h: 20 })) })));
      await assertSucceeds(db(lbl).doc(P + 'lbls/main').set({ at: Date.now(), by: lbl }));
      await assertFails(db(lbl).doc(P + 'lbls/other').set(sets(lbl)), 'מזהה אחר');
      await assertFails(db(lbl).doc(P + 'lbls/other').get(), 'קריאת מזהה אחר');
      await assertFails(db(lbl).doc(P + 'lbls/main').set(sets(lbl, { sz: Array.from({ length: 11 }, () => ({ w: 40, h: 20 })) })), 'sz>10');
      await assertFails(db(lbl).doc(P + 'lbls/main').set(sets(lbl, { extra: 1 })), 'שדה נוסף');
      await assertFails(db(lbl).doc(P + 'lbls/main').set(sets(lbl, { def: 'x'.repeat(41) })), 'def ארוך');
      await assertFails(db(lbl).doc(P + 'lbls/main').set(sets(mgr)), 'by של משתמש אחר');
      for (const u of [nol, old, out]) {
        await assertFails(db(u).doc(P + 'lbls/main').get(), u);
        await assertFails(db(u).doc(P + 'lbls/main').set(sets(u)), u);
      }
      await assertFails(db(lbl).doc(P + 'lbls/main').delete());
      await assertSucceeds(db(mgr).doc(P + 'lbls/main').delete());
    });
    it('lbls/main: כל פריט ב-sz נבדק ({ w, h } בטווח); 2 גדלים תקינים – מותר', async () => {
      await assertSucceeds(db(lbl).doc(P + 'lbls/main').set(sets(lbl, { sz: [{ w: 15, h: 10 }, { w: 104, h: 100 }] })));
      const bad = [['x'.repeat(90000)], [{ w: 50, h: 30 }, { w: { a: { b: 1 } }, h: 30 }], [{ w: 50, h: 30, extra: 1 }], [{ w: 14, h: 30 }],
        [{ w: 50, h: 101 }], [{ w: 50 }], [{ w: '50', h: 30 }], [{ l: [50, 30] }], [...Array(9).fill({ w: 50, h: 30 }), 'x']];
      for (const sz of bad) await assertFails(db(lbl).doc(P + 'lbls/main').set(sets(lbl, { sz })), JSON.stringify(sz).slice(0, 60));
    });
    it('lblt / lbls: משתמש של עסק אחר ומשתמש לא מחובר – לא קורא ולא כותב', async () => {
      const anon = env.unauthenticatedContext().firestore();
      for (const [c, u] of [[db(oth), oth], [anon, 'anon']]) {
        await assertFails(c.collection(P + 'lblt').get(), u);
        await assertFails(c.doc(P + 'lblt/t1').get(), u);
        await assertFails(c.doc(P + 'lblt/x9').set(tpl(u)), u);
        await assertFails(c.doc(P + 'lbls/main').get(), u);
        await assertFails(c.doc(P + 'lbls/main').set(sets(u)), u);
        await assertFails(c.doc(P + 'lblt/t1').delete(), u);
        await assertFails(c.doc(P + 'lbls/main').delete(), u);
      }
    });
  });
}
