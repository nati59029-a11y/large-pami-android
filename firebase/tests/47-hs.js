'use strict';
// חוסרים (18.11.2026, שלב 1): hsr/{id}, hsr/{id}/p/1, hsph/{supId}, hsx/{supId} – בשורש ובתוך b/bt (עסק עם התוספת suppliers; bx = עסק אחר; bo = עסק בלי התוספת).
// לכל תא: "מותר" ו"נחסם".

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(500);
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;

const ENVS = [
  { name: 'שורש', P: '', mgr: 'u_mgr', e1: 'u_emp', e2: H.OTHER, off: 'u_off', out: 'u_out', prc: null, foreign: null, offBiz: null, hsa: 'u_hsa', hsd: 'u_hsd' },
  { name: 'עסק b/bt', P: 'b/bt/', mgr: 'bt_mgr', e1: 'bt_e1', e2: 'bt_e2', off: 'bt_off', out: 'u_out', prc: 'bt_prc', foreign: 'bx_mgr', offBiz: 'bo_mgr', hsa: 'bt_hsa', hsd: 'bt_hsd' },
];

function seedBiz(d, b) {
  for (const [biz, mgr, emps, ft] of [['bt', 'bt_mgr', ['bt_e1', 'bt_e2', 'bt_prc'], { suppliers: true }], ['bx', 'bx_mgr', ['bx_e1'], { suppliers: true }], ['bo', 'bo_mgr', [], { suppliers: false }]]) {
    b.set(d.doc('b/' + biz), { name: biz, status: 'active', features: ft });
    b.set(d.doc(`b/${biz}/admins/${mgr}`), { email: mgr + '@example.invalid' });
    for (const u of [mgr, ...emps]) b.set(d.doc(`b/${biz}/staff/${u}`), Object.assign({ name: u, role: u === mgr ? 'manager' : 'employee', active: true }, u === 'bt_prc' ? { perms: { prc: true } } : {}));
  }
  b.set(d.doc('b/bt/staff/bt_off'), { name: 'bt_off', role: 'employee', active: false });
  b.set(d.doc('b/bo/hsr/h1'), { n: 'x' });
}

for (const E of ENVS) {
  const R = (p) => E.P + p;
  const item = (uid, o) => Object.assign({ n: 'חלב 3%', nk: 'חלב 3', gen: false, sups: ['s1'], supN: ['תנובה'], why: 'store', np: 0, st: 'open', by: uid, byN: uid, t: Date.now() }, o);
  const upd = (uid, o) => Object.assign({ ub: uid, ut: Date.now() }, o);

  describe(`חוסרים – Firestore – ${E.name}`, () => {
    let env;
    const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
    const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));

    before(async () => { env = await H.getEnv(); });
    // שינוי מצב כמו האפליקציה: רשומה אחת נוספת בסוף h, בשם המבצע, t = ut (קורא את המסמך הנוכחי בלי כללים)
    let lastUt = 0;
    const cur = async () => { let v; await prep(async (d) => { v = (await d.doc(R('hsr/h1')).get()).data(); }); return v; };
    const stUpd = async (u, st, k) => { const o = await cur(), ut = Math.max(Date.now(), (o.ut || 0) + 1, lastUt + 1); lastUt = ut; return { st, ub: u, ut, h: (o.h || []).concat([{ k, t: ut, byN: u, u }]) }; };
    beforeEach(async () => {
      await H.seed(env);
      await prep(async (d) => {
        const b = d.batch();
        if (E.P) seedBiz(d, b);
        // אישור חוסרים (27.11.2026): עובד מאשר (hsA) ועובד שמכניס ישירות (hsD)
        for (const [u, k] of [[E.hsa, 'hsA'], [E.hsd, 'hsD']]) b.set(d.doc(R('staff/' + u)), { name: u, role: 'employee', active: true, perms: { [k]: true } });
        b.set(d.doc(R('hsr/h1')), item(E.e1, { t: 1 }));
        b.set(d.doc(R('hsr/h1/p/1')), { img: IMG, t: 1, uid: E.e1 });
        b.set(d.doc(R('hsph/s1')), { ph: '0501234567', n: 'תנובה', byN: E.mgr, t: 1 });
        b.set(d.doc(R('hsx/s1')), { n: 'תנובה', it: ['חלב 3'], t: 1 });
        await b.commit();
      });
    });

    it('hsr: קריאה ורשימה – מנהל ועובד פעיל; מושבת, מחובר בלי תפקיד ומנהל של עסק אחר – נחסמים', async () => {
      for (const u of [E.mgr, E.e1, E.e2]) {
        await assertSucceeds(fs(u).doc(R('hsr/h1')).get());
        await assertSucceeds(fs(u).collection(R('hsr')).where('st', '==', 'open').get());
      }
      for (const u of [E.off, E.out]) await assertFails(fs(u).doc(R('hsr/h1')).get());
      if (E.foreign) await assertFails(fs(E.foreign).collection(R('hsr')).get());
      await assertFails(env.unauthenticatedContext().firestore().doc(R('hsr/h1')).get());
    });

    it('hsr: יצירה – מנהל (open) ועובד (pend, 27.11.2026), בשמם, זמן אמת; שדות וערכים נבדקים', async () => {
      for (const u of [E.mgr, E.e1]) {
        const st = u === E.mgr ? 'open' : 'pend';
        await assertSucceeds(fs(u).doc(R('hsr/' + fresh('n'))).set(item(u, { st })));
        await assertSucceeds(fs(u).doc(R('hsr/' + fresh('n'))).set(item(u, { st, gen: true, sups: [], supN: [], why: 'both', q: 2.5, cust: { nm: 'דני', ph: '0501234567', cid: 'c1' }, ord: { id: 'o1', no: 7 }, np: 1 })));
      }
      const e = fs(E.e1), N = () => R('hsr/' + fresh('n'));
      await assertFails(e.doc(N()).set(item(E.e1, { x: 1 })), 'שדה לא מוכר');
      await assertFails(e.doc(N()).set(item(E.e1, { byN: E.e2 })), 'byN של אחר');
      await assertFails(e.doc(N()).set(item(E.e1, { by: E.e2 })), 'by של אחר');
      await assertFails(e.doc(N()).set(item(E.e1, { t: Date.now() - 600000 })), 'זמן ישן');
      await assertFails(e.doc(N()).set(item(E.e1, { st: 'arr' })), 'יצירה רק פתוח');
      await assertFails(e.doc(N()).set(item(E.e1, { n: '' })));
      await assertFails(e.doc(N()).set(item(E.e1, { n: 'א'.repeat(81) })));
      await assertFails(e.doc(N()).set(item(E.e1, { q: -1 })), 'כמות שלילית');
      await assertFails(e.doc(N()).set(item(E.e1, { q: 0 })));
      await assertFails(e.doc(N()).set(item(E.e1, { why: 'x' })));
      await assertFails(e.doc(N()).set(item(E.e1, { gen: true })), 'כללי עם ספקים');
      await assertFails(e.doc(N()).set(item(E.e1, { sups: Array.from({ length: 11 }, (_, i) => 's' + i) })));
      await assertFails(e.doc(N()).set(item(E.e1, { cust: { nm: 'דני', ph: '050-123' } })), 'טלפון עם מקף');
      await assertFails(e.doc(N()).set(item(E.e1, { cust: { nm: 'דני', x: 1 } })));
      await assertFails(e.doc(N()).set(item(E.e1, { ord: { id: '../x', no: 1 } })));
      await assertFails(e.doc(N()).set(item(E.e1, { np: 2 })));
      await assertFails(e.doc(N()).set(item(E.e1, { ub: E.e1, ut: Date.now() })), 'ub רק בעדכון');
      // בדיקת אבטחה 19.11 – ליקויים 2 ו-3: איברי sups / supN נבדקים; h לא נשלח ביצירה (גם לא ריק, גם לא "בשם המנהל")
      await assertFails(e.doc(N()).set(item(E.e1, { h: [] })), 'h ביצירה');
      await assertFails(e.doc(N()).set(item(E.e1, { h: [{ k: 'arr', byN: E.mgr }] })), 'היסטוריה מזויפת ביצירה');
      await assertFails(e.doc(N()).set(item(E.e1, { sups: ['../cats/x?a=1'], supN: ['רע'] })), 'מזהה ספק עם נתיב');
      await assertFails(e.doc(N()).set(item(E.e1, { sups: ['a/b'], supN: ['רע'] })), 'מזהה ספק עם /');
      await assertFails(e.doc(N()).set(item(E.e1, { sups: [{ a: 1 }], supN: ['x'] })), 'מפה במקום מזהה');
      await assertFails(e.doc(N()).set(item(E.e1, { sups: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's/0'], supN: Array(10).fill('x') })), 'האיבר העשירי נבדק');
      await assertFails(e.doc(N()).set(item(E.e1, { supN: ['x'.repeat(61)] })), 'שם ספק ארוך');
      await assertFails(e.doc(N()).set(item(E.e1, { supN: [5] })), 'שם ספק לא מחרוזת');
      await assertFails(e.doc(N()).set(item(E.e1, { sups: ['s1', 's2'], supN: ['תנובה'] })), 'sups ו-supN באותו אורך');
      await assertSucceeds(e.doc(N()).set(item(E.e1, { st: 'pend', sups: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's_0'], supN: Array(10).fill('x'.repeat(60)) })));
      for (const u of [E.off, E.out]) await assertFails(fs(u).doc(N()).set(item(u, { st: 'pend' })));
      if (E.foreign) await assertFails(fs(E.foreign).doc(N()).set(item(E.foreign)));
    });

    it('hsr: עריכה, "הגיע", מחיקה רכה ושחזור – מנהל ועובד אחר; by/byN/t לא משתנים; ub בשם המעדכן', async () => {
      for (const u of [E.mgr, E.e2]) {
        await assertSucceeds(fs(u).doc(R('hsr/h1')).update(upd(u, { n: 'חלב 1%', sups: ['s1', 's2'], supN: ['תנובה', 'טרה'], q: 3 })));
        await assertSucceeds(fs(u).doc(R('hsr/h1')).update(await stUpd(u, 'arr', 'man')));
        await assertSucceeds(fs(u).doc(R('hsr/h1')).update(await stUpd(u, 'open', 'undo')));
        await assertSucceeds(fs(u).doc(R('hsr/h1')).update(await stUpd(u, 'del', 'del')));
        // 27.11.2026: שחזור מ"נמחקו" ל-open – רק מאשר; עובד רגיל משחזר ל-pend (חוזר לאישור)
        if (u === E.mgr) await assertSucceeds(fs(u).doc(R('hsr/h1')).update(await stUpd(u, 'open', 'res')));
        else {
          await assertFails(fs(u).doc(R('hsr/h1')).update(await stUpd(u, 'open', 'res')), 'עובד רגיל: שחזור ישר לפתוח');
          await assertSucceeds(fs(u).doc(R('hsr/h1')).update(await stUpd(u, 'pend', 'res')));
          await prep((d) => d.doc(R('hsr/h1')).update({ st: 'open' }));
        }
      }
      const e = fs(E.e2);
      await assertFails(e.doc(R('hsr/h1')).update({ st: 'arr' }), 'בלי ub/ut');
      await assertFails(e.doc(R('hsr/h1')).update(upd(E.e1, { st: 'arr' })), 'ub של אחר');
      await assertFails(e.doc(R('hsr/h1')).update(upd(E.e2, { ut: Date.now() - 600000 })));
      await assertFails(e.doc(R('hsr/h1')).update(upd(E.e2, { by: E.e2 })), 'by לא משתנה');
      await assertFails(e.doc(R('hsr/h1')).update(upd(E.e2, { byN: E.e2 })), 'byN לא משתנה');
      await assertFails(e.doc(R('hsr/h1')).update(upd(E.e2, { t: Date.now() })), 't לא משתנה');
      await assertFails(e.doc(R('hsr/h1')).update(upd(E.e2, { st: 'gone' })));
      await assertFails(e.doc(R('hsr/h1')).update(upd(E.e2, { z: 1 })));
      await assertFails(e.doc(R('hsr/h1')).update(upd(E.e2, { sups: ['../cats/x'], supN: ['רע'] })), 'עריכה עם מזהה ספק עם נתיב');
    });

    it('hsr: היסטוריה (h) – רק רשומה אחת בסוף, בשם המבצע, בזמן העדכון ומתאימה למעבר; אי אפשר לזייף, לשנות או למחוק', async () => {
      const e = fs(E.e2), doc = e.doc(R('hsr/h1'));
      await assertFails(doc.update(upd(E.e2, { st: 'arr' })), 'שינוי מצב בלי רשומה');
      let ut = Date.now();
      await assertFails(doc.update({ st: 'arr', ub: E.e2, ut, h: [{ k: 'man', t: ut, byN: E.mgr, u: E.mgr }] }), 'רשומה בשם המנהל');
      await assertFails(doc.update({ st: 'arr', ub: E.e2, ut, h: [{ k: 'man', t: ut, byN: E.e2, u: E.mgr }] }), 'u של אחר');
      await assertFails(doc.update({ st: 'arr', ub: E.e2, ut, h: [{ k: 'man', t: ut - 5000, byN: E.e2, u: E.e2 }] }), 't שונה מ-ut');
      await assertFails(doc.update({ st: 'arr', ub: E.e2, ut, h: [{ k: 'del', t: ut, byN: E.e2, u: E.e2 }] }), 'k לא מתאים למעבר');
      await assertFails(doc.update({ st: 'arr', ub: E.e2, ut, h: [{ k: 'man', t: ut, byN: E.e2, u: E.e2, x: 1 }] }), 'שדה נוסף ברשומה');
      await assertFails(doc.update({ st: 'arr', ub: E.e2, ut, h: [{ k: 'man', t: ut, byN: E.e2, u: E.e2 }, { k: 'man', t: ut, byN: E.e2, u: E.e2 }] }), 'שתי רשומות');
      await assertSucceeds(doc.update(await stUpd(E.e2, 'arr', 'man')));
      const h1 = (await cur()).h;
      ut = Math.max(Date.now(), lastUt) + 5;
      await assertFails(doc.update({ st: 'open', ub: E.e2, ut, h: [{ k: 'undo', t: ut, byN: E.e2, u: E.e2 }] }), 'מחיקת הרשומה הקודמת');
      await assertFails(doc.update({ st: 'open', ub: E.e2, ut, h: [Object.assign({}, h1[0], { byN: E.mgr }), { k: 'undo', t: ut, byN: E.e2, u: E.e2 }] }), 'שינוי רשומה קודמת');
      await assertFails(doc.update({ ub: E.e2, ut, h: [] }), 'ריקון ההיסטוריה');
      await assertFails(doc.update({ ub: E.e2, ut, h: [Object.assign({}, h1[0], { byN: E.mgr, u: E.mgr })] }), 'שינוי רשומה בלי שינוי מצב');
      await assertSucceeds(doc.update({ st: 'open', ub: E.e2, ut, h: h1.concat([{ k: 'undo', t: ut, byN: E.e2, u: E.e2 }]) }));
      // 30 רשומות: הראשונה נחתכת והשאר זהות
      const full = Array.from({ length: 30 }, (_, i) => ({ k: 'man', t: i, byN: E.mgr, u: E.mgr }));
      await prep((d) => d.doc(R('hsr/h1')).update({ h: full, st: 'open' }));
      ut = Math.max(Date.now(), lastUt) + 10;
      await assertFails(doc.update({ st: 'arr', ub: E.e2, ut, h: full.concat([{ k: 'man', t: ut, byN: E.e2, u: E.e2 }]) }), '31 רשומות');
      await assertFails(doc.update({ st: 'arr', ub: E.e2, ut, h: full.slice(2).concat([{ k: 'man', t: 0, byN: E.mgr, u: E.mgr }, { k: 'man', t: ut, byN: E.e2, u: E.e2 }]) }), 'חיתוך לא נכון');
      await assertSucceeds(doc.update({ st: 'arr', ub: E.e2, ut, h: full.slice(1).concat([{ k: 'man', t: ut, byN: E.e2, u: E.e2 }]) }));
      for (const u of [E.off, E.out]) await assertFails(fs(u).doc(R('hsr/h1')).update(upd(u, { st: 'arr' })));
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('hsr/h1')).update(upd(E.foreign, { st: 'arr' })));
    });

    // שלב 2 (19.11.2026): הורדה אוטומטית מחשבונית ספק – 'inv' (הגיע כולו), 'part' (חלקי, הכמות יורדת), 'unp' (ביטול חלקי)
    it('hsr: שלב 2 – הורדה מחשבונית: inv / part / unp לפי החוזה; זיוף, כמות לא נכונה ושדות זרים – נחסמים', async () => {
      const doc = (u) => fs(u).doc(R('hsr/h1'));
      const nu = () => { const ut = Math.max(Date.now(), lastUt + 1); lastUt = ut; return ut; };
      const ie = (u, ut, o) => Object.assign({ k: 'inv', t: ut, byN: u, u, pinv: 'iRQ1', inv: '5001', sup: 'תנובה' }, o);
      await prep(async (d) => { await d.doc(R('hsr/h1')).update({ q: 10, t: 1000 });
        await d.doc(R('pinv/iRQ1')).set({ st: 'new', at: Date.now(), inv: '5001', sup: 'תנובה' });
        await d.doc(R('pinv/iVOID')).set({ st: 'void', at: Date.now(), inv: '5002', sup: 'תנובה' });
        await d.doc(R('pinv/iOLD')).set({ st: 'new', at: 500, inv: '5003', sup: 'תנובה' }); });
      // סבב בדיקה 1: pinv חייב להיות חשבונית קיימת, לא מבוטלת, שנקלטה אחרי שהפריט נוסף
      for (const [pv, why] of [['iFAKE999', 'pinv שאינו קיים'], ['iVOID', 'חשבונית מבוטלת'], ['iOLD', 'חשבונית מלפני שהפריט נוסף']]) {
        const o = await cur(), ut = nu();
        await assertFails(doc(E.e2).update({ st: 'arr', ub: E.e2, ut, h: (o.h || []).concat([ie(E.e2, ut, { pinv: pv })]) }), why + ' (inv)');
        await assertFails(doc(E.e2).update({ q: 6, ub: E.e2, ut, h: (o.h || []).concat([ie(E.e2, ut, { pinv: pv, k: 'part', q0: 10, q: 6 })]) }), why + ' (part)');
      }
      // עדכון של שדות מצב בלבד (בלי itOk המלא) – עדיין נבדקים הערכים שהשתנו
      await assertFails(doc(E.e2).update(upd(E.e2, { q: -1 })), 'כמות שלילית בעדכון מצב');
      await assertFails(doc(E.e2).update(upd(E.e2, { q: 'x' })), 'כמות לא מספר');
      await assertFails(doc(E.e2).update(upd(E.e2, { q: 100001 })), 'כמות גדולה מדי');
      await assertFails(doc(E.e2).update(upd(E.e2, { ub: 'x'.repeat(101) })), 'ub ארוך');
      for (const u of [E.mgr, E.e2]) {
        // חלקי: 10 → 6
        let o = await cur(), ut = nu();
        await assertFails(doc(u).update({ q: 6, ub: u, ut, h: (o.h || []).concat([ie(u, ut, { k: 'part', q0: 9, q: 6 })]) }), 'q0 לא הכמות הקודמת');
        await assertFails(doc(u).update({ q: 6, ub: u, ut, h: (o.h || []).concat([ie(u, ut, { k: 'part', q0: 10, q: 5 })]) }), 'q ברשומה לא הכמות החדשה');
        await assertFails(doc(u).update({ q: 12, ub: u, ut, h: (o.h || []).concat([ie(u, ut, { k: 'part', q0: 10, q: 12 })]) }), 'הכמות עולה');
        await assertFails(doc(u).update({ q: 6, ub: u, ut, h: (o.h || []).concat([ie(u, ut, { k: 'part', q0: 10 })]) }), 'part בלי q');
        await assertFails(doc(u).update({ q: 6, ub: u, ut, h: (o.h || []).concat([ie(u, ut, { k: 'part', q0: 10, q: 6, x: 1 })]) }), 'שדה זר ברשומה');
        await assertFails(doc(u).update({ q: 6, ub: u, ut, h: (o.h || []).concat([ie(u, ut, { k: 'part', q0: 10, q: 6, pinv: '../x' })]) }), 'pinv עם נתיב');
        await assertFails(doc(u).update({ q: 6, ub: u, ut, h: (o.h || []).concat([ie(u, ut, { k: 'part', q0: 10, q: 6, inv: 'x'.repeat(31) })]) }), 'מספר חשבונית ארוך');
        await assertFails(doc(u).update({ q: 6, ub: u, ut, h: (o.h || []).concat([ie(E.e1, ut, { k: 'part', q0: 10, q: 6 })]) }), 'רשומה בשם אחר');
        await assertFails(doc(u).update({ q: 6, ub: u, ut, h: (o.h || []).concat([{ k: 'man', t: ut, byN: u, u }]) }), 'man בלי שינוי מצב');
        await assertFails(doc(u).update({ st: 'arr', q: 6, ub: u, ut, h: (o.h || []).concat([ie(u, ut, { k: 'part', q0: 10, q: 6 })]) }), 'part עם שינוי מצב');
        await assertSucceeds(doc(u).update({ q: 6, ub: u, ut, h: (o.h || []).concat([ie(u, ut, { k: 'part', q0: 10, q: 6 })]) }));
        // ביטול החלקי: חוזר בדיוק ל-10
        o = await cur(); ut = nu();
        await assertFails(doc(u).update({ q: 11, ub: u, ut, h: o.h.concat([{ k: 'unp', t: ut, byN: u, u }]) }), 'unp לכמות אחרת');
        await assertFails(doc(u).update({ q: 10, ub: u, ut, h: o.h.concat([{ k: 'unp', t: ut, byN: u, u, pinv: 'iRQ1' }]) }), 'unp עם שדות');
        await assertSucceeds(doc(u).update({ q: 10, ub: u, ut, h: o.h.concat([{ k: 'unp', t: ut, byN: u, u }]) }));
        o = await cur(); ut = nu();
        await assertFails(doc(u).update({ q: 10, ub: u, ut, h: o.h.concat([{ k: 'unp', t: ut, byN: u, u }]) }), 'unp פעמיים (הקודמת לא part)');
        // הגיע כולו: open → arr, הכמות לא משתנה, בלי q0 / q
        await assertFails(doc(u).update({ st: 'arr', ub: u, ut, h: o.h.concat([ie(u, ut, { q0: 10, q: 0 })]) }), 'inv עם q0/q');
        await assertFails(doc(u).update({ st: 'arr', q: 4, ub: u, ut, h: o.h.concat([ie(u, ut)]) }), 'inv שמשנה כמות');
        await assertFails(doc(u).update({ st: 'del', ub: u, ut, h: o.h.concat([ie(u, ut)]) }), 'inv למצב אחר');
        await assertFails(doc(u).update({ ub: u, ut, h: o.h.concat([ie(u, ut)]) }), 'inv בלי שינוי מצב');
        await assertFails(doc(u).update({ st: 'arr', ub: u, ut, h: o.h.concat([ie(u, ut, { sup: 5 })]) }), 'sup לא מחרוזת');
        await assertSucceeds(doc(u).update({ st: 'arr', ub: u, ut, h: o.h.concat([ie(u, ut)]) }));
        // החזר (undo) אחרי inv – כמו בשלב 1
        await assertSucceeds(doc(u).update(await stUpd(u, 'open', 'undo')));
        o = await cur(); ut = nu();
        await assertFails(doc(u).update({ st: 'del', ub: u, ut, h: o.h.concat([ie(u, ut)]) }), 'inv למחוק');
      }
      // inv רק מ-open: פריט שכבר הגיע / נמחק – לא
      await assertSucceeds(doc(E.e2).update(await stUpd(E.e2, 'del', 'del')));
      let o = await cur(), ut = nu();
      await assertFails(doc(E.e2).update({ st: 'arr', ub: E.e2, ut, h: o.h.concat([ie(E.e2, ut)]) }), 'inv מנמחק');
      for (const u of [E.off, E.out]) { o = await cur(); ut = nu(); await assertFails(fs(u).doc(R('hsr/h1')).update({ st: 'arr', ub: u, ut, h: o.h.concat([ie(u, ut)]) })); }
    });

    it('hsr: "הוזמן" (od, 19.11.2026) – מנהל ועובד, בשם המבצע, רק od/ub/ut; זיוף, תאריך לא תקין, יצירה עם od ועריכה שמשנה od – נחסמים', async () => {
      const del = require('firebase/compat/app').default.firestore.FieldValue.delete();
      let last = 0; const nu = () => { last = Math.max(Date.now(), last + 1); return last; };
      const od = (u, ut, o) => Object.assign({ u, byN: u, t: ut, sup: 'תנובה', eta: '2026-11-25' }, o);
      const set = (who, o, x) => { const ut = nu(); return fs(who).doc(R('hsr/h1')).update(Object.assign({ od: od(who, ut, o), ub: who, ut }, x || {})); };
      for (const u of [E.mgr, E.e2]) {
        await assertSucceeds(set(u), 'סימון הוזמן – ' + u);
        await assertSucceeds(set(u, { eta: '', sup: '' }), 'בלי צפי ובלי ספק');
        await assertSucceeds(fs(u).doc(R('hsr/h1')).update({ od: del, ub: u, ut: nu() }), 'ביטול');
      }
      await assertFails(set(E.e2, { byN: E.e1 }), 'byN של אחר');
      await assertFails(set(E.e2, { u: E.e1 }), 'u של אחר');
      await assertFails(set(E.e2, { t: 5 }), 't שונה מ-ut');
      await assertFails(set(E.e2, { eta: '25/11/2026' }), 'תאריך לא תקין');
      await assertFails(set(E.e2, { sup: 'א'.repeat(61) }), 'ספק ארוך');
      await assertFails(set(E.e2, { z: 1 }), 'שדה זר ב-od');
      await assertFails(fs(E.e2).doc(R('hsr/h1')).update({ od: 'כן', ub: E.e2, ut: nu() }), 'od לא מפה');
      await assertFails(set(E.e2, {}, { ub: E.e1 }), 'ub של אחר');
      await assertFails(set(E.e2, {}, { st: 'arr' }), 'יחד עם שינוי מצב');
      await assertFails(set(E.e2, {}, { n: 'אחר' }), 'יחד עם עריכה');
      await assertSucceeds(set(E.e2));
      await assertFails(fs(E.e1).doc(R('hsr/h1')).update(upd(E.e1, { n: 'חלב 1%', od: od(E.e2, 1) })), 'עריכה מלאה שמזייפת od');
      await assertSucceeds(fs(E.e1).doc(R('hsr/h1')).update(Object.assign(upd(E.e1, { n: 'חלב 1%' }), { ut: nu() })), 'עריכה רגילה – od נשאר');
      await assertFails(fs(E.e1).collection(R('hsr')).doc(fresh('h')).set(item(E.e1, { t: Date.now(), od: od(E.e1, 1) })), 'יצירה עם od');
      await assertFails(fs(E.out).doc(R('hsr/h1')).update({ od: del, ub: E.out, ut: nu() }), 'מחובר בלי תפקיד');
    });

    // ---------- אישור חוסרים (27.11.2026): pend / rej, rj, or, מתגים hsA (מאשר) ו-hsD (מכניס ישירות) ----------
    describe('אישור חוסרים', () => {
      let last = 0;
      const nu = () => { last = Math.max(Date.now(), last + 1); return last; };
      const P1 = () => R('hsr/p1');
      const get1 = async () => { let v; await prep(async (d) => { v = (await d.doc(P1()).get()).data(); }); return v; };
      const setP = (o) => prep((d) => d.doc(P1()).set(item(E.e1, Object.assign({ st: 'pend', t: 1 }, o))));
      // מעבר מצב כמו האפליקציה: רשומת h אחת בסוף, t = ut
      const mv = async (u, st, k, x) => { const o = await get1(), ut = nu(); return fs(u).doc(P1()).update(Object.assign({ st, ub: u, ut, h: (o.h || []).concat([{ k, t: ut, byN: u, u }]) }, x || {})); };
      const ed = (u, x) => fs(u).doc(P1()).update(Object.assign({ ub: u, ut: nu() }, x));
      const OR = { n: 'חלב 3%', supN: ['תנובה'], gen: false, why: 'store' }; // מה שהעובד רשם (item)
      beforeEach(() => setP());

      it('יצירה: מאשר / hsD / מנהל – open; עובד רגיל – רק pend; rj / or / rej ביצירה – נחסמים', async () => {
        const N = () => R('hsr/' + fresh('n'));
        for (const u of [E.mgr, E.hsa, E.hsd]) await assertSucceeds(fs(u).doc(N()).set(item(u)), 'open – ' + u);
        for (const u of [E.e1, E.e2, E.mgr, E.hsd]) await assertSucceeds(fs(u).doc(N()).set(item(u, { st: 'pend' })), 'pend – ' + u);
        for (const u of [E.e1, E.e2]) await assertFails(fs(u).doc(N()).set(item(u)), 'עובד רגיל – open');
        if (E.prc) await assertFails(fs(E.prc).doc(N()).set(item(E.prc)), 'עובד עם מתג אחר (prc) – open');
        await assertFails(fs(E.e1).doc(N()).set(item(E.e1, { st: 'rej' })), 'יצירה כנדחה');
        await assertFails(fs(E.e1).doc(N()).set(item(E.e1, { st: 'pend', rj: 'x' })), 'rj ביצירה');
        await assertFails(fs(E.mgr).doc(N()).set(item(E.mgr, { or: OR })), 'or ביצירה');
        for (const u of [E.off, E.out]) await assertFails(fs(u).doc(N()).set(item(u, { st: 'pend' })));
        if (E.foreign) await assertFails(fs(E.foreign).doc(N()).set(item(E.foreign, { st: 'pend' })));
      });

      it('ממתין: עריכה – היוצר / מאשר / מנהל; עובד אחר ו-hsD – נחסמים. ביטול (pend→del) – היוצר או מאשר', async () => {
        for (const u of [E.e1, E.hsa, E.mgr]) await assertSucceeds(ed(u, { n: 'חלב ' + u }), 'עריכה – ' + u);
        for (const u of [E.e2, E.hsd]) await assertFails(ed(u, { n: 'x' }), 'עריכה – ' + u);
        if (E.prc) await assertFails(ed(E.prc, { n: 'x' }), 'prc אינו מאשר');
        if (E.foreign) await assertFails(ed(E.foreign, { n: 'x' }));
        for (const u of [E.e2, E.hsd]) await assertFails(mv(u, 'del', 'del'), 'ביטול – ' + u);
        await assertSucceeds(mv(E.e1, 'del', 'del'), 'היוצר מבטל');
        await setP();
        await assertSucceeds(mv(E.hsa, 'del', 'del'), 'מאשר מוחק');
      });

      it('אישור (pend→open, k ok): רק מאשר / מנהל; עם עריכה באותה כתיבה; or (מה שהעובד רשם) – רק בכתיבת האישור בלי עריכה, ואחר כך לא משתנה', async () => {
        for (const u of [E.e1, E.e2, E.hsd]) await assertFails(mv(u, 'open', 'ok'), 'אישור – ' + u);
        if (E.prc) await assertFails(mv(E.prc, 'open', 'ok'));
        if (E.foreign) await assertFails(mv(E.foreign, 'open', 'ok'));
        await assertFails(mv(E.hsa, 'open', 'undo'), 'k לא מתאים');
        await assertSucceeds(mv(E.hsa, 'open', 'ok'), 'מאשר');
        await setP();
        const fix = { n: 'חלב 3% 1 ליטר', sups: ['s1', 's2'], supN: ['תנובה', 'טרה'], q: 6 };
        await assertSucceeds(mv(E.mgr, 'open', 'ok', fix), 'אישור + תיקון בכתיבה אחת (בלי or)');
        await setP();
        await assertFails(mv(E.mgr, 'open', 'ok', Object.assign({ or: OR }, fix)), 'or יחד עם תיקון – בשתי כתיבות');
        await assertFails(mv(E.mgr, 'open', 'ok', { or: Object.assign({}, OR, { n: 'א'.repeat(81) }) }), 'or: שם ארוך');
        await assertFails(mv(E.mgr, 'open', 'ok', { or: Object.assign({}, OR, { x: 1 }) }), 'or: שדה זר');
        await assertFails(mv(E.mgr, 'open', 'ok', { or: Object.assign({}, OR, { why: 'x' }) }), 'or: why לא תקין');
        await assertFails(mv(E.mgr, 'open', 'ok', { or: Object.assign({}, OR, { supN: Array(11).fill('x') }) }), 'or: 11 ספקים');
        await assertFails(mv(E.mgr, 'open', 'ok', { or: 'x' }), 'or לא מפה');
        await assertFails(ed(E.e1, { or: OR }), 'or בלי אישור (עריכה של ממתין)');
        await assertFails(mv(E.e1, 'del', 'del', { or: OR }), 'or בביטול');
        // עריכה של המאשר (ממתין) ואז אישור עם or – שתי כתיבות
        await assertSucceeds(ed(E.mgr, fix), 'מאשר מתקן ממתין');
        await assertSucceeds(mv(E.mgr, 'open', 'ok', { or: Object.assign({}, OR, { q: 2 }) }), 'אישור + or');
        const a = await get1();
        assert.equal(a.st, 'open'); assert.deepEqual(a.or, Object.assign({}, OR, { q: 2 })); assert.equal(a.n, fix.n);
        await assertFails(ed(E.e2, { n: 'y', or: OR }), 'שינוי or אחרי האישור (עריכה)');
        await assertFails(mv(E.mgr, 'arr', 'man', { or: OR }), 'שינוי or אחרי האישור (מצב)');
        await assertFails(ed(E.mgr, { or: require('firebase/compat/app').default.firestore.FieldValue.delete() }), 'מחיקת or');
        await assertSucceeds(ed(E.e2, { n: 'חלב אחר' }), 'עריכה רגילה – or נשאר');
        await assertSucceeds(mv(E.e2, 'arr', 'man'), 'הגיע – or נשאר');
        assert.deepEqual((await get1()).or, Object.assign({}, OR, { q: 2 }));
      });

      it('דחייה (pend→rej, k rej, rj עד 200): רק מאשר; נדחה – רק "החזר לאישור" (rej→pend, k res) ע"י מאשר', async () => {
        for (const u of [E.e1, E.e2, E.hsd]) await assertFails(mv(u, 'rej', 'rej', { rj: 'לא צריך' }), 'דחייה – ' + u);
        await assertFails(mv(E.hsa, 'rej', 'rej', { rj: 'x'.repeat(201) }), 'סיבה ארוכה');
        await assertFails(mv(E.hsa, 'rej', 'rej', { rj: 5 }), 'סיבה לא מחרוזת');
        await assertFails(mv(E.hsa, 'rej', 'del'), 'k לא מתאים');
        await assertSucceeds(mv(E.hsa, 'rej', 'rej', { rj: 'יש במלאי' }));
        await assertSucceeds(fs(E.e1).doc(P1()).get(), 'היוצר רואה את הנדחה');
        await assertFails(ed(E.e1, { n: 'x' }), 'עריכת נדחה – היוצר');
        for (const u of [E.e1, E.e2, E.hsd]) await assertFails(mv(u, 'pend', 'res'), 'החזרה – ' + u);
        await assertFails(mv(E.mgr, 'open', 'ok'), 'נדחה → פתוח ישר');
        await assertFails(mv(E.mgr, 'del', 'del'), 'נדחה → נמחק');
        await assertFails(mv(E.mgr, 'arr', 'man'), 'נדחה → הגיע');
        const del = require('firebase/compat/app').default.firestore.FieldValue.delete();
        await assertSucceeds(mv(E.hsa, 'pend', 'res', { rj: del }), 'מאשר מחזיר לממתינים');
        await assertSucceeds(mv(E.mgr, 'rej', 'rej'), 'דחייה בלי סיבה');
        await assertSucceeds(mv(E.mgr, 'pend', 'res'), 'מנהל מחזיר');
      });

      it('ממתין: אסור "הגיע" (man), "הוזמן" (od) וחלקי – גם למנהל', async () => {
        await assertFails(mv(E.mgr, 'arr', 'man'), 'הגיע');
        const ut = nu();
        await assertFails(fs(E.mgr).doc(P1()).update({ od: { u: E.mgr, byN: E.mgr, t: ut, sup: 'תנובה', eta: '' }, ub: E.mgr, ut }), 'הוזמן');
        const o = await get1(), t2 = nu();
        await assertFails(fs(E.mgr).doc(P1()).update({ q: 1, ub: E.mgr, ut: t2, h: (o.h || []).concat([{ k: 'unp', t: t2, byN: E.mgr, u: E.mgr }]) }), 'שינוי כמות עם רשומה');
      });

      it('שחזור מ"נמחקו": עובד רגיל ו-hsD – רק ל-pend; מאשר – גם ל-open', async () => {
        await setP({ st: 'del' });
        for (const u of [E.e2, E.hsd]) await assertFails(mv(u, 'open', 'res'), 'ל-open – ' + u);
        await assertFails(mv(E.e2, 'pend', 'undo'), 'k לא מתאים');
        await assertSucceeds(mv(E.e2, 'pend', 'res'), 'עובד רגיל – ל-pend');
        await setP({ st: 'del' });
        await assertSucceeds(mv(E.hsa, 'open', 'res'), 'מאשר – ל-open');
        await setP({ st: 'open' });
        await assertFails(mv(E.mgr, 'pend', 'res'), 'פתוח → ממתין');
        await assertFails(mv(E.mgr, 'rej', 'rej'), 'פתוח → נדחה');
      });
    });

    it('hsr: מחיקה אמיתית – מנהל בלבד', async () => {
      await assertFails(fs(E.e1).doc(R('hsr/h1')).delete());
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('hsr/h1')).delete());
      await assertSucceeds(fs(E.mgr).doc(R('hsr/h1')).delete());
    });

    it('hsr/p/1: תמונה – הצוות קורא ויוצר (רק 1, רק לפריט קיים, uid עצמו, עד 900,000), בלי עדכון; מחיקה – הצוות', async () => {
      const e = fs(E.e2), ph = (o) => Object.assign({ img: IMG, t: Date.now(), uid: E.e2 }, o);
      await assertSucceeds(e.doc(R('hsr/h1/p/1')).get());
      await assertFails(fs(E.off).doc(R('hsr/h1/p/1')).get());
      await assertFails(e.doc(R('hsr/h1/p/1')).set(ph()), 'עדכון (דריסה) אסור');
      await assertSucceeds(e.doc(R('hsr/h1/p/1')).delete());
      await assertSucceeds(e.doc(R('hsr/h1/p/1')).set(ph()));
      await prep((d) => d.doc(R('hsr/h1/p/1')).delete());
      await assertFails(e.doc(R('hsr/h1/p/2')).set(ph()), 'רק 1');
      await assertFails(e.doc(R('hsr/nope/p/1')).set(ph()), 'פריט לא קיים');
      await assertFails(e.doc(R('hsr/h1/p/1')).set(ph({ uid: E.e1 })));
      await assertFails(e.doc(R('hsr/h1/p/1')).set(ph({ img: 'data:image/jpeg;base64,' + 'A'.repeat(900000) })), 'גדולה מדי');
      await assertFails(e.doc(R('hsr/h1/p/1')).set(ph({ img: 'data:text/html;base64,' + 'A'.repeat(500) })));
      await assertFails(e.doc(R('hsr/h1/p/1')).set(ph({ x: 1 })));
      await assertFails(fs(E.off).doc(R('hsr/h1/p/1')).set(ph({ uid: E.off })));
      await assertSucceeds(fs(E.mgr).doc(R('hsr/h1/p/1')).set(ph({ uid: E.mgr })));
    });

    it('hsph: טלפון ספק – הצוות קורא וכותב (ספרות, בשמו, זמן אמת); מחיקה – מנהל', async () => {
      const ph = (u, o) => Object.assign({ ph: '972501234567', n: 'טרה', byN: u, t: Date.now() }, o);
      for (const u of [E.mgr, E.e1]) { await assertSucceeds(fs(u).doc(R('hsph/s1')).get()); await assertSucceeds(fs(u).doc(R('hsph/' + fresh('s'))).set(ph(u))); await assertSucceeds(fs(u).doc(R('hsph/s1')).set(ph(u))); }
      await assertFails(fs(E.e1).doc(R('hsph/s2')).set(ph(E.e1, { ph: '050-1234567' })));
      await assertFails(fs(E.e1).doc(R('hsph/s2')).set(ph(E.e1, { ph: '12' })));
      await assertFails(fs(E.e1).doc(R('hsph/s2')).set(ph(E.e2)), 'byN של אחר');
      await assertFails(fs(E.e1).doc(R('hsph/s2')).set(ph(E.e1, { x: 1 })));
      await assertFails(fs(E.off).doc(R('hsph/s1')).get());
      await assertFails(fs(E.off).doc(R('hsph/s2')).set(ph(E.off)));
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('hsph/s1')).get());
      await assertFails(fs(E.e1).doc(R('hsph/s1')).delete());
      await assertSucceeds(fs(E.mgr).doc(R('hsph/s1')).delete());
    });

    it('hsx: שמות מוצרים מחשבוניות – הצוות קורא; כותב רק מנהל (ובעסק b גם עובד עם prc); עובד בלי prc – נחסם', async () => {
      const x = (o) => Object.assign({ n: 'תנובה', it: ['חלב 3', 'קוטג 5'], t: Date.now() }, o);
      for (const u of [E.mgr, E.e1]) { await assertSucceeds(fs(u).doc(R('hsx/s1')).get()); await assertSucceeds(fs(u).collection(R('hsx')).get()); }
      await assertFails(fs(E.off).doc(R('hsx/s1')).get());
      await assertSucceeds(fs(E.mgr).doc(R('hsx/s1')).set(x()));
      await assertFails(fs(E.e1).doc(R('hsx/s1')).set(x()), 'עובד בלי prc');
      if (E.prc) await assertSucceeds(fs(E.prc).doc(R('hsx/s1')).set(x()));
      await assertFails(fs(E.mgr).doc(R('hsx/s1')).set(x({ it: Array.from({ length: 3001 }, (_, i) => 'a' + i) })));
      await assertFails(fs(E.mgr).doc(R('hsx/s1')).set(x({ price: 5 })), 'בלי מחירים');
      await assertFails(fs(E.mgr).doc(R('hsx/s1')).set(x({ t: 1 })));
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('hsx/s1')).set(x()));
      await assertFails(fs(E.e1).doc(R('hsx/s1')).delete());
      await assertSucceeds(fs(E.mgr).doc(R('hsx/s1')).delete());
    });

    if (E.offBiz) it('עסק בלי התוספת suppliers – הכול נחסם, גם למנהל העסק', async () => {
      const m = fs(E.offBiz);
      await assertFails(m.doc('b/bo/hsr/h1').get());
      await assertFails(m.doc('b/bo/hsr/' + fresh('n')).set(item(E.offBiz)));
      await assertFails(m.doc('b/bo/hsph/s1').set({ ph: '0501234567', n: 'x', byN: E.offBiz, t: Date.now() }));
      await assertFails(m.doc('b/bo/hsx/s1').get());
    });
  });
}
