'use strict';
// מרכז עבודה – סבב 2 (15.11.2026): שדות חדשים במשימות (tasks): dl (יעד בפועל), pri, cat, est, ck (רשימת סימון), ckd (מה סומן),
// sa ("התחלתי"), nd/ndN ("הזכר לעובד" – רק מנהל). "באיחור" של עובד לפי היעד בפועל (dl, ובלי dl – due כמו היום; dl = 0 = אף פעם לא באיחור).
// גלאי גרסת הכללים rv/tk2 (get בלבד). כל בדיקה רצה פעמיים: בשורש וב-b/{bizId} (עסק bt; עסק bx בשביל "עסק אחר").

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const D1 = 86400000, H1 = 3600000, MIN = 60000;
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const CK3 = ['לפתוח קופה', 'לבדוק מקרר', 'לסדר מדף'];

const ENVS = [
  { name: 'שורש', P: '', mgr: 'u_mgr', e1: 'u_emp', e2: H.OTHER, foreign: null },
  { name: 'עסק b/bt', P: 'b/bt/', mgr: 'bt_mgr', e1: 'bt_e1', e2: 'bt_e2', foreign: 'bx_mgr' },
];

for (const E of ENVS) {
  describe(`מרכז עבודה סבב 2 – משימות – ${E.name}`, () => {
    let env;
    const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
    const T = (id) => `${E.P}tasks/${id}`;
    const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
    // משימה במסד (נכתבה לפני הבדיקה)
    const base = (o) => { const t = Date.now(); return Object.assign({ owner: E.mgr, by: E.mgr, role: 'a', txt: 'משימה', cr: t - H1, due: t + 4 * D1,
      st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '' }, o); };
    const mine1 = (o) => base(Object.assign({ to: [E.e1], toN: [E.e1], ow: E.e1, owN: E.e1, clt: Date.now() - H1, np: 0, mi: 0, wp: 0 }, o));
    // משימה חדשה ליצירה (בזמן אמת)
    const mk = (owner, o) => { const t = Date.now(); return Object.assign({ owner, by: owner, role: owner === E.mgr ? 'a' : 'w', txt: 'חדשה', cr: t, due: t + 4 * D1,
      st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '' }, o); };
    const done = (uid, late) => { const n = Date.now(); return { st: 'done', open: '', sub: n, ok: n, doneBy: uid, late }; };

    before(async () => { env = await H.getEnv(); });
    beforeEach(async () => {
      await H.seed(env);
      await prep(async (d) => {
        const b = d.batch();
        if (E.P) {
          for (const [biz, mgr, emps] of [['bt', 'bt_mgr', ['bt_e1', 'bt_e2']], ['bx', 'bx_mgr', ['bx_e1']]]) {
            b.set(d.doc('b/' + biz), { name: biz, status: 'active', features: { tasks: true } });
            b.set(d.doc(`b/${biz}/admins/${mgr}`), { email: mgr + '@example.invalid' });
            for (const u of [mgr, ...emps]) b.set(d.doc(`b/${biz}/staff/${u}`), { name: u, role: u === mgr ? 'manager' : 'employee', active: true });
          }
        }
        const t = Date.now();
        b.set(d.doc(T('ck')), mine1({ ck: CK3, ckd: [], dl: t + 5 * H1, pri: 'h', cat: 'מלאי', est: 30, sa: 0 }));
        b.set(d.doc(T('dlPast')), mine1({ dl: t - H1 }));               // יעד שעבר, אבל due (72ש') עוד לא
        b.set(d.doc(T('dlFuture')), mine1({ due: t - H1, dl: t + D1 }));  // due עבר, אבל היעד בפועל בעתיד
        b.set(d.doc(T('dl0')), mine1({ due: t - H1, dl: 0 }));            // בלי יעד
        b.set(d.doc(T('oldLate')), mine1({ due: t - H1 }));               // משימה ישנה בלי dl – לפי due, כמו היום
        b.set(d.doc(T('oldOk')), mine1({}));
        b.set(d.doc(T('multi')), mine1({ to: [E.e1, E.e2], toN: [E.e1, E.e2], ow: '', owN: '', clt: 0, ck: CK3, ckd: [] }));
        b.set(d.doc(T('legacy')), base({ ck: CK3, ckd: [] })); // משימה ישנה (בלי to) שלא נתפסה – כל עובד פועל בה, כמו היום
        await b.commit();
      });
    });

    it('יצירה: כל השדות החדשים בערכים חוקיים – מנהל ועובד', async () => {
      const t = Date.now();
      await assertSucceeds(fs(E.mgr).doc(T(fresh('n'))).set(mk(E.mgr, { dl: t + 3 * H1, pri: 'h', cat: 'קופה', est: 15, ck: CK3, ckd: [], sa: 0, nd: 0 })));
      await assertSucceeds(fs(E.mgr).doc(T(fresh('n'))).set(mk(E.mgr, { to: [E.e1], toN: [E.e1], ow: E.e1, owN: E.e1, clt: t, np: 0, mi: 0, wp: 0, dl: 0, pri: 'l', est: 1440, ck: Array.from({ length: 20 }, (_, i) => 'פריט ' + i) })));
      await assertSucceeds(fs(E.e1).doc(T(fresh('n'))).set(mk(E.e1, { dl: t + 400 * D1 - MIN, pri: '', cat: 'א'.repeat(30), est: 0, ck: ['א'.repeat(120)] })));
      await assertSucceeds(fs(E.e1).doc(T(fresh('n'))).set(mk(E.e1, { dl: t - MIN }))); // שעון הטלפון מעט מאחור – עד 2 דקות
      await assertSucceeds(fs(E.e1).doc(T(fresh('n'))).set(mk(E.e1))); // בלי השדות – כמו היום
    });

    it('יצירה: ערכים לא חוקיים בכל שדה – נחסם', async () => {
      const t = Date.now();
      const bad = (o, who) => assertFails(fs(who || E.e1).doc(T(fresh('n'))).set(mk(who || E.e1, o)));
      await bad({ dl: t - 10 * MIN });
      await bad({ dl: t + 401 * D1 });
      await bad({ dl: -1 });
      await bad({ dl: 'מחר' });
      await bad({ dl: t + 0.5 });
      await bad({ pri: 'x' });
      await bad({ pri: 1 });
      await bad({ cat: 'א'.repeat(31) });
      await bad({ cat: 5 });
      await bad({ est: -1 });
      await bad({ est: 1441 });
      await bad({ est: '30' });
      await bad({ ck: 'פריט' });
      await bad({ ck: Array.from({ length: 21 }, (_, i) => 'p' + i) });
      await bad({ ck: ['א'.repeat(121)] });
      await bad({ ck: [''] });
      await bad({ ck: ['א\nב'] });       // שורה חדשה בתוך פריט (סבב 3: tkCkOk בלי חזרה מקוננת)
      await bad({ ck: ['א', ''] });
      await bad({ ck: ['א', 5] });
      await bad({ ck: CK3, ckd: [0] }); // ckd ריק ביצירה
      await bad({ sa: t });              // "התחלתי" לא ביצירה
      await bad({ nd: t }, E.mgr);       // "הזכר לעובד" לא ביצירה
      await bad({ ndN: 'מנהל' }, E.mgr); // לא ברשימת השדות של יצירה
      await bad({ xx: 1 });
    });

    it('"בוצע" של עובד: late לפי dl כשיש, לפי due כשאין (כמו היום), ו-dl = 0 תמיד בזמן', async () => {
      const w = fs(E.e1);
      await assertFails(w.doc(T('dlPast')).update(done(E.e1, '')));      // dl עבר – חייב late '1'
      await assertSucceeds(w.doc(T('dlPast')).update(done(E.e1, '1')));
      await assertFails(w.doc(T('dlFuture')).update(done(E.e1, '1')));   // due עבר אבל dl בעתיד – בזמן
      await assertSucceeds(w.doc(T('dlFuture')).update(done(E.e1, '')));
      await assertFails(w.doc(T('dl0')).update(done(E.e1, '1')));        // בלי יעד – אף פעם לא באיחור
      await assertSucceeds(w.doc(T('dl0')).update(done(E.e1, '')));
      await assertFails(w.doc(T('oldLate')).update(done(E.e1, '')));     // ישנה בלי dl – לפי due
      await assertSucceeds(w.doc(T('oldLate')).update(done(E.e1, '1')));
      await assertFails(w.doc(T('oldOk')).update(done(E.e1, '1')));
      await assertSucceeds(w.doc(T('oldOk')).update(done(E.e1, '')));
    });

    it('ckd: המטפל מסמן פריטים (חוקי); ערכים לא חוקיים, שדות נוספים, לא מטפל, משימה סגורה – נחסם', async () => {
      const w = fs(E.e1);
      await assertSucceeds(w.doc(T('ck')).update({ ckd: [0, 2] }));
      await assertSucceeds(w.doc(T('ck')).update({ ckd: [] }));
      await assertSucceeds(w.doc(T('ck')).update({ ckd: [2, 1, 0] }));
      await assertFails(w.doc(T('ck')).update({ ckd: [3] }));          // אין פריט כזה
      await assertFails(w.doc(T('ck')).update({ ckd: [-1] }));
      await assertFails(w.doc(T('ck')).update({ ckd: [1, 1] }));       // כפילות
      await assertFails(w.doc(T('ck')).update({ ckd: ['0'] }));
      await assertFails(w.doc(T('ck')).update({ ckd: 1 }));
      await assertFails(w.doc(T('ck')).update({ ckd: [0], ck: ['אחר'] })); // עובד לא משנה את הרשימה
      await assertFails(w.doc(T('ck')).update({ ck: ['אחר'] }));
      await assertFails(w.doc(T('ck')).update({ ckd: [0], pri: '' }));
      await assertFails(fs(E.e2).doc(T('ck')).update({ ckd: [0] }));   // לא המטפל
      await assertFails(fs(E.e2).doc(T('multi')).update({ ckd: [0] })); // משימה עם נמענים שעוד לא נתפסה
      await assertFails(fs(E.e1).doc(T('multi')).update({ ckd: [0] }));
      await assertSucceeds(fs(E.e2).doc(T('legacy')).update({ ckd: [1] })); // משימה ישנה בלי נמענים שלא נתפסה – כמו "בוצע" היום
      await prep((d) => d.doc(T('ck')).update({ st: 'done', open: '' }));
      await assertFails(w.doc(T('ck')).update({ ckd: [1] }));          // משימה סגורה
    });

    it('sa ("התחלתי"): רק המטפל, רק sa, בזמן אמת, במשימה פתוחה; עובד לא כותב nd/dl/pri', async () => {
      const w = fs(E.e1);
      await assertSucceeds(w.doc(T('ck')).update({ sa: Date.now() }));
      await assertFails(w.doc(T('ck')).update({ sa: Date.now() - 10 * MIN }));
      await assertFails(w.doc(T('ck')).update({ sa: Date.now(), ckd: [0] }));
      await assertFails(fs(E.e2).doc(T('ck')).update({ sa: Date.now() }));
      await assertFails(fs(E.e2).doc(T('multi')).update({ sa: Date.now() }));
      await assertFails(fs(E.e2).doc(T('legacy')).update({ sa: Date.now() })); // ישנה שלא נתפסה – קודם "אני מטפל"
      await assertFails(w.doc(T('ck')).update({ nd: Date.now(), ndN: E.e1 }));
      await assertFails(w.doc(T('ck')).update({ dl: Date.now() + 9 * D1 }));
      await assertFails(w.doc(T('ck')).update({ pri: 'l' }));
      await assertFails(w.doc(T('ck')).update({ cat: 'x' }));
      await assertFails(w.doc(T('ck')).update({ est: 60 }));
      await prep((d) => d.doc(T('ck')).update({ st: 'wait' }));
      await assertFails(w.doc(T('ck')).update({ sa: Date.now() }));
    });

    it('מנהל: "הזכר לעובד" (nd/ndN), ביטול תפיסה שמאפס sa, ועריכת היעד והשדות – מותר (כמו היום, מנהל מעדכן הכול)', async () => {
      const m = fs(E.mgr);
      await assertSucceeds(m.doc(T('ck')).update({ nd: Date.now(), ndN: E.mgr }));
      await assertSucceeds(m.doc(T('ck')).update({ ow: '', owN: '', clt: 0, wp: 0, sa: 0 }));
      await assertSucceeds(m.doc(T('ck')).update({ dl: 0, pri: '', cat: '', est: 0, ck: [], ckd: [] }));
    });

    it('עסק אחר / תפקידים בלי הרשאה: לא יוצרים ולא מסמנים', async () => {
      await assertFails(fs('u_off').doc(T(fresh('n'))).set(mk('u_off', { pri: 'h' })));
      await assertFails(fs('u_out').doc(T(fresh('n'))).set(mk('u_out', { pri: 'h' })));
      await assertFails(fs('u_off').doc(T('legacy')).update({ ckd: [0] }));
      if (E.foreign) {
        await assertFails(fs(E.foreign).doc(T(fresh('n'))).set(mk(E.foreign, { dl: Date.now() + H1 })));
        await assertFails(fs('bx_e1').doc(T('legacy')).update({ ckd: [0] }));
        await assertFails(fs('bx_e1').doc(T('ck')).update({ sa: Date.now() }));
        // עובד של bt לא נוגע במשימה של bx, גם לא ב-sa כשהוא "המטפל" שם בטעות
        await prep((d) => d.doc('b/bx/tasks/x1').set(base({ owner: 'bx_mgr', by: 'bx_mgr', to: [E.e1], toN: [E.e1], ow: E.e1, owN: E.e1, clt: Date.now(), ck: CK3, ckd: [] })));
        await assertFails(fs(E.e1).doc('b/bx/tasks/x1').update({ sa: Date.now() }));
        await assertFails(fs(E.e1).doc('b/bx/tasks/x1').update({ ckd: [0] }));
      }
    });

    it('גלאי rv/tk2: צוות – get מותר (404 = כללים חדשים); מזהה אחר, list וכתיבה – נחסם; מושבת / בלי תפקיד – נחסם', async () => {
      const R = (id) => `${E.P}rv/${id}`;
      await assertSucceeds(fs(E.mgr).doc(R('tk2')).get());
      await assertSucceeds(fs(E.e1).doc(R('tk2')).get());
      await assertFails(fs(E.e1).doc(R('tk9')).get());
      await assertFails(fs(E.e1).collection(`${E.P}rv`).get());
      await assertFails(fs(E.mgr).doc(R('tk2')).set({ a: 1 }));
      await assertFails(fs('u_off').doc(R('tk2')).get());
      await assertFails(fs('u_out').doc(R('tk2')).get());
      if (E.foreign) {
        await assertFails(fs(E.foreign).doc(R('tk2')).get());
        await prep((d) => d.doc('b/bt').update({ 'features.tasks': false }));
        await assertFails(fs(E.mgr).doc(R('tk2')).get());
        await assertFails(fs(E.e1).doc(R('tk2')).get());
      }
    });
  });
}
