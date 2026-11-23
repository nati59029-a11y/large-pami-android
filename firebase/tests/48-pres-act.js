'use strict';
// 23.11.2026: נוכחות (pres/{uid}), יומן שימוש (act/{uid}_{day}) ומתג היומן (cfg/act) – בשורש ובתוך b/bt (bx = עסק אחר).
// לכל תא: "מותר" ו"נחסם".

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const ENVS = [
  { name: 'שורש', P: '', mgr: 'u_mgr', mgr0: H.MANAGER_ONLY_ADMINS, e1: 'u_emp', e2: H.OTHER, off: 'u_off', out: 'u_out', foreign: null },
  { name: 'עסק b/bt', P: 'b/bt/', mgr: 'bt_mgr', mgr0: null, e1: 'bt_e1', e2: 'bt_e2', off: 'bt_off', out: 'u_out', foreign: 'bx_mgr' },
];

function seedBiz(d, b) {
  for (const [biz, mgr, emps] of [['bt', 'bt_mgr', ['bt_e1', 'bt_e2']], ['bx', 'bx_mgr', ['bx_e1']]]) {
    b.set(d.doc('b/' + biz), { name: biz, status: 'active', features: {} }); // בלי מתג תוספת – pres/act לא תלויים ב-feat
    b.set(d.doc(`b/${biz}/admins/${mgr}`), { email: mgr + '@example.invalid' });
    for (const u of [mgr, ...emps]) {
      b.set(d.doc(`b/${biz}/staff/${u}`), { name: 'שם ' + u, role: u === mgr ? 'manager' : 'employee', active: true });
    }
  }
  b.set(d.doc('b/bt/staff/bt_off'), { name: 'bt_off', role: 'employee', active: false });
}

for (const E of ENVS) {
  const R = (p) => E.P + p;
  const DAY = '2026-11-23';
  const act = (uid, o) => Object.assign({ uid, n: 'שם', day: DAY, s: [{ a: 1, b: 2 }], v: [{ k: 'home', l: 'בית', a: 1, b: 2 }], t: Date.now() }, o);

  describe(`נוכחות ויומן שימוש – Firestore – ${E.name}`, () => {
    let env;
    const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
    const guest = () => env.unauthenticatedContext().firestore();
    const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
    const realName = (uid) => (E.P ? 'שם ' + uid : uid); // staff/{uid}.name (בשורש helpers.seed שם name = uid)

    before(async () => { env = await H.getEnv(); });
    beforeEach(async () => {
      await H.seed(env);
      await prep(async (d) => {
        const b = d.batch();
        if (E.P) seedBiz(d, b);
        b.set(d.doc(R('pres/' + E.e2)), { on: true, t: 1, n: 'x', e: E.e2 });
        b.set(d.doc(R('act/' + E.e2 + '_' + DAY)), act(E.e2, { t: 1 }));
        b.set(d.doc(R('cfg/act')), { on: false });
        await b.commit();
      });
    });

    it('pres: הבעלים כותב (עובד פעיל / מנהל); n = השם ב-staff או תחילית המייל; קריאה – הצוות; מחיקה – אף אחד', async () => {
      const now = Date.now();
      const P = (u) => fs(u).doc(R('pres/' + u));
      await assertSucceeds(P(E.e1).set({ on: true, t: now, n: realName(E.e1), e: E.e1 }));
      await assertSucceeds(P(E.e1).set({ on: false, t: now }));
      await assertSucceeds(P(E.e1).set({ on: true, t: now, n: E.e1 }), 'n = תחילית המייל');
      await assertSucceeds(P(E.mgr).set({ on: true, t: now, n: realName(E.mgr), e: E.mgr }));
      if (E.mgr0) await assertSucceeds(P(E.mgr0).set({ on: true, t: now, n: E.mgr0, e: E.mgr0 }), 'מנהל בלי staff');
      if (E.mgr0) await assertFails(P(E.mgr0).set({ on: true, t: now, n: 'שם אחר' }), 'מנהל בלי staff – שם אחר');
      await assertFails(fs(E.e1).doc(R('pres/' + E.e2)).set({ on: true, t: now }), 'של אחר');
      await assertFails(fs(E.mgr).doc(R('pres/' + E.e1)).set({ on: true, t: now }), 'גם מנהל לא כותב של אחר');
      await assertFails(P(E.off).set({ on: true, t: now }), 'מושבת');
      await assertFails(P(E.out).set({ on: true, t: now }), 'מחובר שאינו צוות');
      if (E.foreign) await assertFails(P(E.foreign).set({ on: true, t: now }), 'מנהל של עסק אחר');
      await assertFails(P(E.e1).set({ on: true, t: now, n: 'שם מזויף' }), 'n לא שלו');
      await assertFails(P(E.e1).set({ on: true, t: now, e: E.e2 }), 'e לא שלו');
      await assertFails(P(E.e1).set({ on: true, t: now - 3600000 }), 't לא זמן אמת');
      await assertFails(P(E.e1).set({ on: 'כן', t: now }));
      await assertFails(P(E.e1).set({ t: now }), 'בלי on');
      await assertFails(P(E.e1).set({ on: true, t: now, x: 1 }), 'שדה זר');
      // קריאה
      await assertSucceeds(fs(E.e1).doc(R('pres/' + E.e2)).get());
      await assertSucceeds(fs(E.e1).collection(R('pres')).get());
      await assertSucceeds(fs(E.mgr).collection(R('pres')).get());
      await assertFails(fs(E.off).doc(R('pres/' + E.e2)).get(), 'מושבת');
      await assertFails(fs(E.out).doc(R('pres/' + E.e2)).get(), 'מחובר שאינו צוות');
      await assertFails(guest().doc(R('pres/' + E.e2)).get(), 'גולש');
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('pres/' + E.e2)).get(), 'עסק אחר');
      // מחיקה
      await assertFails(fs(E.e2).doc(R('pres/' + E.e2)).delete());
      await assertFails(fs(E.mgr).doc(R('pres/' + E.e2)).delete());
    });

    it('act: רק עובד פעיל (לא מנהל) כותב את שלו; קריאה (get + list) – מנהל בלבד; מחיקה – אף אחד', async () => {
      const A = (u, day) => fs(u).doc(R('act/' + u + '_' + (day || DAY)));
      await assertSucceeds(A(E.e1).set(act(E.e1)));
      await assertSucceeds(A(E.e1).set(act(E.e1, { s: [], v: [] })), 'עדכון (דריסה) של היום');
      await assertSucceeds(A(E.e1).update({ t: Date.now(), v: Array.from({ length: 3000 }, () => ({ k: 'a', l: 'b', a: 1, b: 2 })) }), '3000 מסכים');
      await assertFails(A(E.e1).update({ t: Date.now(), v: Array.from({ length: 3001 }, () => ({ k: 'a' })) }), 'יותר מ-3000');
      await assertFails(A(E.e1).update({ t: Date.now(), s: Array.from({ length: 301 }, () => ({ a: 1, b: 2 })) }), 'יותר מ-300');
      await assertFails(A(E.e1).update({ t: 1 }), 't לא זמן אמת');
      await assertFails(fs(E.e1).doc(R('act/' + E.e2 + '_' + DAY)).set(act(E.e2)), 'של אחר');
      await assertFails(fs(E.e1).doc(R('act/' + E.e1 + '_2026-11-24')).set(act(E.e1)), 'מזהה לא תואם ל-day');
      await assertFails(fs(E.e1).doc(R('act/' + E.e1 + '_x')).set(act(E.e1, { day: 'x' })), 'day לא תאריך');
      await assertFails(A(E.e1).set(act(E.e1, { z: 1 })), 'שדה זר');
      await assertFails(A(E.e1).set(act(E.e1, { s: 'x' })), 's לא רשימה');
      await assertFails(A(E.mgr).set(act(E.mgr)), 'מנהל לא נרשם ביומן');
      if (E.mgr0) await assertFails(A(E.mgr0).set(act(E.mgr0)), 'מנהל בלי staff');
      await assertFails(A(E.off).set(act(E.off)), 'מושבת');
      await assertFails(A(E.out).set(act(E.out)), 'מחובר שאינו צוות');
      if (E.foreign) await assertFails(A(E.foreign).set(act(E.foreign)), 'עסק אחר');
      // קריאה
      await assertSucceeds(fs(E.mgr).doc(R('act/' + E.e2 + '_' + DAY)).get());
      await assertSucceeds(fs(E.mgr).collection(R('act')).where('day', '>=', '2026-11-01').get());
      if (E.mgr0) await assertSucceeds(fs(E.mgr0).collection(R('act')).get());
      await assertFails(fs(E.e2).doc(R('act/' + E.e2 + '_' + DAY)).get(), 'גם העובד עצמו לא קורא');
      await assertFails(fs(E.e1).collection(R('act')).get());
      await assertFails(fs(E.off).collection(R('act')).get());
      await assertFails(guest().collection(R('act')).get());
      if (E.foreign) await assertFails(fs(E.foreign).collection(R('act')).get());
      // מחיקה
      await assertFails(fs(E.e2).doc(R('act/' + E.e2 + '_' + DAY)).delete());
      await assertFails(fs(E.mgr).doc(R('act/' + E.e2 + '_' + DAY)).delete());
    });

    it('cfg/act: מנהל כותב { on, by, at }; הצוות קורא (get); עובד לא כותב', async () => {
      const C = (u) => fs(u).doc(R('cfg/act'));
      await assertSucceeds(C(E.mgr).set({ on: true, by: E.mgr, at: Date.now() }));
      await assertSucceeds(C(E.mgr).set({ on: false }));
      await assertFails(C(E.mgr).set({ on: 'כן' }));
      await assertFails(C(E.mgr).set({ by: E.mgr }), 'בלי on');
      await assertFails(C(E.mgr).set({ on: true, x: 1 }), 'שדה זר');
      await assertFails(C(E.e1).set({ on: false }), 'עובד');
      await assertFails(C(E.off).set({ on: false }), 'מושבת');
      if (E.foreign) await assertFails(C(E.foreign).set({ on: false }), 'עסק אחר');
      await assertSucceeds(C(E.e1).get());
      await assertSucceeds(C(E.mgr).get());
      await assertFails(C(E.off).get());
      await assertFails(C(E.out).get());
      if (E.foreign) await assertFails(C(E.foreign).get());
    });
  });
}
