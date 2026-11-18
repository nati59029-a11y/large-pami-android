'use strict';
// סבב 4, חבילה ב' (18.11.2026): תבניות משימה בענן – tkt/{id} ותמונת דוגמה tkt/{id}/p/1.
// קריאה וכתיבה: מנהלים בלבד. עובד (פעיל ומושבת), מחובר בלי תפקיד ומנהל של עסק אחר – נחסמים.
// תמונה: data:image (jpeg/png/webp) ב-base64, 100 עד 900,000 תווים, יצירה בלבד (בלי דריסה), רק כשהתבנית קיימת.
// כל בדיקה רצה פעמיים: בשורש, ובתוך b/bt (bx = עסק אחר).

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(500);
const ENVS = [
  { name: 'שורש', P: '', mgr: 'u_mgr', e1: 'u_emp', off: 'u_off', out: 'u_out', foreign: null },
  { name: 'עסק b/bt', P: 'b/bt/', mgr: 'bt_mgr', e1: 'bt_e1', off: 'bt_off', out: 'u_out', foreign: 'bx_mgr' },
];

for (const E of ENVS) {
  describe(`תבניות משימה בענן – ${E.name}`, () => {
    let env;
    const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
    const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
    const R = (p) => E.P + p;
    const tpl = (o) => Object.assign({ txt: 'לנקות את המקרר', t: Date.now(), to: [], np: 1, dk: 'd3', pri: 'h', cat: 'ניקיון', est: 30, ck: ['א', 'ב'], im: 1, by: 'מנהל' }, o);
    const photo = (uid, o) => Object.assign({ img: IMG, t: Date.now(), uid }, o);

    before(async () => { env = await H.getEnv(); });
    beforeEach(async () => {
      await H.seed(env);
      await prep(async (d) => {
        const b = d.batch();
        if (E.P) {
          for (const [biz, mgr, emps] of [['bt', 'bt_mgr', ['bt_e1']], ['bx', 'bx_mgr', ['bx_e1']]]) {
            b.set(d.doc('b/' + biz), { name: biz, status: 'active', features: { tasks: true } });
            b.set(d.doc(`b/${biz}/admins/${mgr}`), { email: mgr + '@example.invalid' });
            for (const u of [mgr, ...emps]) b.set(d.doc(`b/${biz}/staff/${u}`), { name: u, role: u === mgr ? 'manager' : 'employee', active: true });
          }
          b.set(d.doc('b/bt/staff/bt_off'), { name: 'bt_off', role: 'employee', active: false });
        }
        b.set(d.doc(R('tkt/t1')), tpl());
        b.set(d.doc(R('tkt/t1/p/1')), photo(E.mgr));
        b.set(d.doc(R('tkt/t2')), tpl({ im: 0 }));
        await b.commit();
      });
    });

    it('מותר: מנהל קורא תבנית, תמונה ורשימה', async () => {
      const m = fs(E.mgr);
      await assertSucceeds(m.doc(R('tkt/t1')).get());
      await assertSucceeds(m.doc(R('tkt/t1/p/1')).get());
      await assertSucceeds(m.collection(R('tkt')).get());
    });

    it('נחסם: עובד, עובד מושבת, מחובר בלי תפקיד ומנהל של עסק אחר – לא קוראים', async () => {
      for (const u of [E.e1, E.off, E.out].concat(E.foreign ? [E.foreign] : [])) {
        await assertFails(fs(u).doc(R('tkt/t1')).get());
        await assertFails(fs(u).doc(R('tkt/t1/p/1')).get());
        await assertFails(fs(u).collection(R('tkt')).get());
      }
      await assertFails(env.unauthenticatedContext().firestore().doc(R('tkt/t1')).get());
    });

    it('מותר: מנהל יוצר ומעדכן תבנית (גם בלי שדות רשות)', async () => {
      const m = fs(E.mgr);
      await assertSucceeds(m.doc(R('tkt/n1')).set(tpl({ im: 0 })));
      await assertSucceeds(m.doc(R('tkt/n2')).set({ txt: 'מינימלי', t: Date.now() }));
      await assertSucceeds(m.doc(R('tkt/t2')).update({ txt: 'שונה' }));
    });

    it('נחסם: עובד, מושבת וזר – לא יוצרים, לא מעדכנים ולא מוחקים תבנית', async () => {
      for (const u of [E.e1, E.off, E.out].concat(E.foreign ? [E.foreign] : [])) {
        const c = fs(u);
        await assertFails(c.doc(R('tkt/x_' + u)).set(tpl({ im: 0 })));
        await assertFails(c.doc(R('tkt/t2')).update({ txt: 'פריצה' }));
        await assertFails(c.doc(R('tkt/t2')).delete());
      }
    });

    it('נחסם: תבנית פגומה (טקסט ריק / ארוך, np גדול, שדה זר, ck ארוך, im לא תקין)', async () => {
      const m = fs(E.mgr);
      for (const [i, o] of [{ txt: '' }, { txt: 'א'.repeat(501) }, { np: 4 }, { np: -1 }, { zz: 1 }, { ck: Array(21).fill('x') }, { im: 2 }, { est: 5000 }, { cat: 'x'.repeat(31) }].entries())
        await assertFails(m.doc(R('tkt/bad' + i)).set(tpl(o)));
      await assertFails(m.doc(R('tkt/bad_t')).set({ txt: 'בלי זמן' }));
    });

    it('מותר: מנהל מעלה תמונה (jpeg/png/webp) לתבנית קיימת, בשמו ובזמן אמת', async () => {
      const m = fs(E.mgr);
      await assertSucceeds(m.doc(R('tkt/t2/p/1')).set(photo(E.mgr)));
      await prep((d) => d.doc(R('tkt/t2/p/1')).delete());
      await assertSucceeds(m.doc(R('tkt/t2/p/1')).set(photo(E.mgr, { img: 'data:image/png;base64,' + 'B'.repeat(300) })));
      await prep((d) => d.doc(R('tkt/t2/p/1')).delete());
      await assertSucceeds(m.doc(R('tkt/t2/p/1')).set(photo(E.mgr, { img: 'data:image/webp;base64,' + 'C'.repeat(300) })));
    });

    it('נחסם: תמונה – עובד/זר, דריסה, מזהה אחר, סוג/גודל לא תקינים, תבנית לא קיימת, uid או זמן מזויפים', async () => {
      const m = fs(E.mgr);
      for (const u of [E.e1, E.off, E.out].concat(E.foreign ? [E.foreign] : []))
        await assertFails(fs(u).doc(R('tkt/t2/p/1')).set(photo(u)));
      await assertFails(m.doc(R('tkt/t1/p/1')).set(photo(E.mgr)));            // דריסה (set על קיים)
      await assertFails(m.doc(R('tkt/t1/p/1')).update({ img: IMG + 'x' }));   // עדכון
      await assertFails(m.doc(R('tkt/t2/p/2')).set(photo(E.mgr)));            // מזהה אחר
      await assertFails(m.doc(R('tkt/t2/p/1')).set(photo(E.mgr, { img: 'data:image/gif;base64,' + 'A'.repeat(300) })));
      await assertFails(m.doc(R('tkt/t2/p/1')).set(photo(E.mgr, { img: 'data:text/html;base64,' + 'A'.repeat(300) })));
      await assertFails(m.doc(R('tkt/t2/p/1')).set(photo(E.mgr, { img: 'data:image/jpeg;base64,AAA' })));              // קצר
      await assertFails(m.doc(R('tkt/t2/p/1')).set(photo(E.mgr, { img: 'data:image/jpeg;base64,' + 'A'.repeat(900000) }))); // ארוך
      await assertFails(m.doc(R('tkt/nope/p/1')).set(photo(E.mgr)));          // תבנית לא קיימת
      await assertFails(m.doc(R('tkt/t2/p/1')).set(photo('אחר')));            // uid של מישהו אחר
      await assertFails(m.doc(R('tkt/t2/p/1')).set(photo(E.mgr, { t: Date.now() - 600000 }))); // זמן ישן
      await assertFails(m.doc(R('tkt/t2/p/1')).set(photo(E.mgr, { extra: 1 })));
    });

    it('מותר: מנהל מוחק תמונה ותבנית', async () => {
      const m = fs(E.mgr);
      await assertSucceeds(m.doc(R('tkt/t1/p/1')).delete());
      await assertSucceeds(m.doc(R('tkt/t1')).delete());
    });
  });
}
