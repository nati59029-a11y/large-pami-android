'use strict';
// שדרוג משימות (2026-11-09): נמענים (to/toN), "מי שתופס ראשון" (ow/owN/clt), חובת תמונות לסגירה (np + p/w1..w3),
// תמונות מנהל (p/m1..m5), מונה תמונות (wp), "נקרא" לכל משתמש (rd), ותצוגה מקדימה של התגובה האחרונה (cT/cN).
// כל בדיקה רצה פעמיים: על tasks בשורש, ועל b/{bizId}/tasks (עסק bt; עסק שני bx בשביל "מנהל של עסק אחר").
// משימה בלי to = ישנה (legacy), ועובדת כמו היום – חוץ ממשימה ישנה שנתפסה (ow לא ריק): אז רק המטפל פועל.

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const D1 = 86400000, H1 = 3600000, MIN = 60000;
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(500);
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;

const ENVS = [
  { name: 'שורש', P: '', mgr: 'u_mgr', e1: 'u_emp', e2: H.OTHER, e3: 'u_emp3', foreign: null },
  { name: 'עסק b/bt', P: 'b/bt/', mgr: 'bt_mgr', e1: 'bt_e1', e2: 'bt_e2', e3: 'bt_e3', foreign: 'bx_mgr' },
];

for (const E of ENVS) {
  describe(`שדרוג משימות – ${E.name}`, () => {
    let env;
    const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
    const T = (id) => `${E.P}tasks/${id}`;
    const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
    const get = async (p) => { let v; await prep(async (d) => { const x = await d.doc(p).get(); v = x.exists ? x.data() : null; }); return v; };
    const base = (o) => { const t = Date.now(); return Object.assign({ owner: E.mgr, by: E.mgr, role: 'a', txt: 'משימה', cr: t - H1, due: t + 4 * D1,
      st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '' }, o); };
    const newMgr = (o) => { const t = Date.now(); return Object.assign(base({ cr: t, due: t + 4 * D1 }), o); };
    const done = (uid) => { const n = Date.now(); return { st: 'done', open: '', sub: n, ok: n, doneBy: uid, late: '' }; };
    const wait = (uid) => ({ st: 'wait', sub: Date.now(), doneBy: uid });
    const claim = (uid, o) => Object.assign({ ow: uid, owN: uid, clt: Date.now() }, o);
    const photo = (uid, o) => Object.assign({ img: IMG, t: Date.now(), uid }, o);

    before(async () => { env = await H.getEnv(); });
    beforeEach(async () => {
      await H.seed(env);
      await prep(async (d) => {
        const b = d.batch();
        if (E.P) {
          for (const [biz, mgr, emps] of [['bt', 'bt_mgr', ['bt_e1', 'bt_e2', 'bt_e3']], ['bx', 'bx_mgr', ['bx_e1']]]) {
            b.set(d.doc('b/' + biz), { name: biz, status: 'active', features: { tasks: true } });
            b.set(d.doc(`b/${biz}/admins/${mgr}`), { email: mgr + '@example.invalid' });
            for (const u of [mgr, ...emps]) b.set(d.doc(`b/${biz}/staff/${u}`), { name: u, role: u === mgr ? 'manager' : 'employee', active: true });
          }
        } else {
          b.set(d.doc('staff/u_emp3'), { name: 'u_emp3', email: 'u_emp3@example.invalid', role: 'worker', active: true });
        }
        const nu = (o) => base(Object.assign({ to: [E.e1, E.e2], toN: [E.e1, E.e2], ow: '', owN: '', clt: 0, np: 0, mi: 0, wp: 0 }, o));
        b.set(d.doc(T('multi')), nu({}));
        b.set(d.doc(T('single')), nu({ to: [E.e1], toN: [E.e1], ow: E.e1, owN: E.e1, clt: Date.now() - H1 }));
        b.set(d.doc(T('np3')), nu({ ow: E.e1, owN: E.e1, clt: Date.now() - H1, np: 3 }));
        b.set(d.doc(T('np1')), nu({ ow: E.e1, owN: E.e1, clt: Date.now() - H1, np: 1 }));
        b.set(d.doc(T('legacyA')), base({}));
        b.set(d.doc(T('legacyW')), base({ owner: E.e2, by: E.e2, role: 'w' }));
        b.set(d.doc(T('legacyClaimed')), base({ ow: E.e1, owN: E.e1, clt: Date.now() - H1 }));
        b.set(d.doc(T('multi') + '/p/m1'), photo(E.mgr));
        await b.commit();
      });
    });

    it('§2 תפיסה: נמען תופס; תפיסה שנייה נדחית; לא-נמען לא תופס', async () => {
      await assertFails(fs(E.e3).doc(T('multi')).update(claim(E.e3)));
      await assertSucceeds(fs(E.e1).doc(T('multi')).update(claim(E.e1)));
      await assertFails(fs(E.e2).doc(T('multi')).update(claim(E.e2)));
      await assertFails(fs(E.e1).doc(T('multi')).update(claim(E.e1))); // גם שוב אותו עובד – ow כבר לא ריק
      const t = await get(T('multi'));
      if (t.ow !== E.e1 || t.owN !== E.e1) throw new Error('התפיסה לא נשמרה');
    });

    it('§2 תפיסה: רק ow/owN/clt, בשמו, בזמן אמת, במשימה פתוחה', async () => {
      const e = fs(E.e1);
      await assertFails(e.doc(T('multi')).update(claim(E.e2)));                           // ow של אחר
      await assertFails(e.doc(T('multi')).update(claim(E.e1, { owN: E.mgr })));           // שם של אחר
      await assertFails(e.doc(T('multi')).update(claim(E.e1, { clt: Date.now() - 10 * MIN })));
      await assertFails(e.doc(T('multi')).update(claim(E.e1, { txt: 'שונה' })));
      await assertFails(e.doc(T('multi')).update(claim(E.e1, { to: [E.e1] })));
      await assertFails(env.authenticatedContext(E.e1).firestore().doc(T('multi')).update(claim(E.e1))); // בלי אימייל
      await prep((d) => d.doc(T('multi')).update({ st: 'wait' }));
      await assertFails(e.doc(T('multi')).update(claim(E.e1)));
    });

    it('§2 תאימות: משימת מנהל ישנה (role a, בלי to) – כל עובד תופס; משימת עובד ישנה – לא', async () => {
      await assertFails(fs(E.e3).doc(T('legacyW')).update(claim(E.e3)));
      await assertSucceeds(fs(E.e3).doc(T('legacyA')).update(claim(E.e3)));
      await assertFails(fs(E.e1).doc(T('legacyA')).update(claim(E.e1)));
    });

    it('§3 עובד לא משחרר ולא מעביר (גם במשימה ישנה שנתפסה)', async () => {
      for (const id of ['single', 'np3', 'legacyClaimed']) {
        const e = fs(E.e1);
        await assertFails(e.doc(T(id)).update({ ow: '', owN: '', clt: 0 }));
        await assertFails(e.doc(T(id)).update({ ow: '' }));
        await assertFails(e.doc(T(id)).update(claim(E.e2, { owN: E.e1 })));
        await assertFails(e.doc(T(id)).update({ ow: E.e2, owN: E.e2 }));
        await assertFails(fs(E.e2).doc(T(id)).update(claim(E.e2)));
      }
    });

    it('§9 מנהל מבטל תפיסה (חוזרת פתוחה לכולם) ומעביר לעובד אחר', async () => {
      const m = fs(E.mgr);
      await assertSucceeds(m.doc(T('np3')).update({ ow: '', owN: '', clt: 0 }));
      await assertSucceeds(fs(E.e2).doc(T('np3')).update(claim(E.e2)));
      await assertSucceeds(m.doc(T('single')).update({ ow: E.e3, owN: E.e3, clt: Date.now(), to: [E.e1, E.e3], toN: [E.e1, E.e3] }));
      await assertFails(fs(E.e1).doc(T('single')).update(done(E.e1)));
      await assertSucceeds(fs(E.e3).doc(T('single')).update(done(E.e3)));
    });

    it('§4 canAct: רק המטפל מסמן בוצע; לפני תפיסה – אף אחד; ישנה לא נתפסה – כמו היום', async () => {
      await assertFails(fs(E.e1).doc(T('multi')).update(done(E.e1)));
      await assertSucceeds(fs(E.e1).doc(T('multi')).update(claim(E.e1)));
      await assertFails(fs(E.e2).doc(T('multi')).update(done(E.e2)));
      await assertSucceeds(fs(E.e1).doc(T('multi')).update(done(E.e1)));
      await assertFails(fs(E.e3).doc(T('legacyClaimed')).update(done(E.e3)));
      await assertSucceeds(fs(E.e1).doc(T('legacyClaimed')).update(done(E.e1)));
      await assertSucceeds(fs(E.e3).doc(T('legacyA')).update(done(E.e3)));
      await assertSucceeds(fs(E.e1).doc(T('legacyW')).update(done(E.e1)));
    });

    it('§4 canAct: צירוף תמונה (pr) ו"בוצע" עם הערה (nc) – רק המטפל', async () => {
      await prep((d) => Promise.all([d.doc(T('single')).update({ pr: '1' }), d.doc(T('legacyClaimed')).update({ nc: '1' })]));
      await assertFails(fs(E.e2).doc(T('single')).update(Object.assign(wait(E.e2), { img: IMG })));
      await assertSucceeds(fs(E.e1).doc(T('single')).update(Object.assign(wait(E.e1), { img: IMG })));
      await assertFails(fs(E.e3).doc(T('legacyClaimed')).update(wait(E.e3)));
      await assertSucceeds(fs(E.e1).doc(T('legacyClaimed')).update(wait(E.e1)));
    });

    it('§5 חובת תמונות: בלי מספר התמונות נכשל; עם np תמונות עובר ל-wait (np=3 – בדיקת מגבלת 10 הקריאות)', async () => {
      const e = fs(E.e1);
      await assertFails(e.doc(T('np3')).update(done(E.e1)));
      await assertFails(e.doc(T('np3')).update(wait(E.e1)));
      await assertSucceeds(e.doc(T('np3') + '/p/w1').set(photo(E.e1)));
      await assertSucceeds(e.doc(T('np3') + '/p/w2').set(photo(E.e1)));
      await assertFails(e.doc(T('np3')).update(wait(E.e1)));
      await assertSucceeds(e.doc(T('np3') + '/p/w3').set(photo(E.e1)));
      await assertFails(e.doc(T('np3')).update(done(E.e1)));                            // גם עם תמונות – לא done ישירות
      await assertFails(e.doc(T('np3')).update(Object.assign(wait(E.e1), { open: '' })));
      await assertFails(e.doc(T('np3')).update(Object.assign(wait(E.e1), { late: '1' })));
      await assertFails(fs(E.e2).doc(T('np3')).update(wait(E.e2)));
      await assertSucceeds(e.doc(T('np3')).update(wait(E.e1)));
      await assertFails(e.doc(T('np3')).update(done(E.e1)));                            // ממתינה – רק המנהל מאשר
      await assertSucceeds(fs(E.mgr).doc(T('np3')).update({ st: 'done', open: '', ok: Date.now(), late: '', note: '' }));
    });

    it('§5 חובת תמונות: np=1 עם הערת עובד (nc), ומשימה שהמנהל סימן בה גם pr', async () => {
      await prep((d) => d.doc(T('np1')).update({ nc: '1', pr: '' }));
      await assertFails(fs(E.e1).doc(T('np1')).update(wait(E.e1)));
      await assertSucceeds(fs(E.e1).doc(T('np1') + '/p/w1').set(photo(E.e1)));
      await assertSucceeds(fs(E.e1).doc(T('np1')).update(wait(E.e1)));
      // pr == '1' לא עוקף את חובת התמונות
      await prep((d) => d.doc(T('np3')).update({ pr: '1' }));
      await assertFails(fs(E.e1).doc(T('np3')).update(Object.assign(wait(E.e1), { img: IMG })));
    });

    it('§תמונות ביצוע (w1..w3): רק המטפל, רק במשימה פתוחה, רק עד np, תמונה תקינה בשמו; מחיקה – מנהל', async () => {
      const e = fs(E.e1);
      await assertFails(fs(E.e2).doc(T('np3') + '/p/w1').set(photo(E.e2)));               // לא המטפל
      await assertFails(fs(E.e1).doc(T('multi') + '/p/w1').set(photo(E.e1)));             // לא נתפסה; np 0
      await assertFails(e.doc(T('np1') + '/p/w2').set(photo(E.e1)));                      // מעבר ל-np
      await assertFails(e.doc(T('np3') + '/p/w4').set(photo(E.e1)));
      await assertFails(e.doc(T('np3') + '/p/w1').set(photo(E.e2)));                      // uid של אחר
      await assertFails(e.doc(T('np3') + '/p/w1').set(photo(E.e1, { img: 'data:text/html;base64,' + 'A'.repeat(500) })));
      await assertFails(e.doc(T('np3') + '/p/w1').set(photo(E.e1, { img: 'data:image/jpeg;base64,AA' })));
      await assertFails(e.doc(T('np3') + '/p/w1').set(photo(E.e1, { t: Date.now() - 10 * MIN })));
      await assertFails(e.doc(T('np3') + '/p/w1').set(photo(E.e1, { x: 1 })));
      await assertSucceeds(e.doc(T('np3') + '/p/w1').set(photo(E.e1)));
      await assertSucceeds(e.doc(T('np3') + '/p/w1').set(photo(E.e1)));                   // החלפה
      await assertFails(e.doc(T('np3') + '/p/w1').delete());
      await assertFails(fs(E.mgr).doc(T('np3') + '/p/w2').set(photo(E.mgr)));             // מנהל לא מעלה תמונת ביצוע
      await assertSucceeds(fs(E.mgr).doc(T('np3') + '/p/w1').delete());
      await prep((d) => d.doc(T('np3')).update({ st: 'wait' }));
      await assertFails(e.doc(T('np3') + '/p/w1').set(photo(E.e1)));                      // לא פתוחה
    });

    it('§תמונות מנהל (m1..m5): יצירה ומחיקה – מנהל בלבד; קריאה – מי שרשאי לקרוא את המשימה', async () => {
      await assertSucceeds(fs(E.mgr).doc(T('multi') + '/p/m2').set(photo(E.mgr)));
      await assertSucceeds(fs(E.mgr).doc(T('multi') + '/p/m5').set(photo(E.mgr)));
      await assertFails(fs(E.mgr).doc(T('multi') + '/p/m6').set(photo(E.mgr)));
      await assertFails(fs(E.mgr).doc(T('multi') + '/p/x1').set(photo(E.mgr)));
      await assertFails(fs(E.e1).doc(T('multi') + '/p/m3').set(photo(E.e1)));
      await assertFails(fs(E.e1).doc(T('multi') + '/p/m1').delete());
      await assertSucceeds(fs(E.e2).doc(T('multi') + '/p/m1').get());
      await assertSucceeds(fs(E.e3).collection(T('multi') + '/p').get());
      await assertSucceeds(fs(E.mgr).doc(T('multi') + '/p/m1').delete());
      // משימה שבוצעה (לא באיחור) – עובד לא קורא את התמונות שלה
      await prep(async (d) => { await d.doc(T('multi')).update({ st: 'done', open: '' }); await d.doc(T('multi') + '/p/m2').set(photo(E.mgr)); });
      await assertFails(fs(E.e2).doc(T('multi') + '/p/m2').get());
      await assertSucceeds(fs(E.mgr).doc(T('multi') + '/p/m2').get());
    });

    it('§6 מונה wp: רק המטפל, רק wp, 0–3, במשימה פתוחה', async () => {
      await assertSucceeds(fs(E.e1).doc(T('np3')).update({ wp: 1 }));
      await assertFails(fs(E.e1).doc(T('np3')).update({ wp: 4 }));
      await assertFails(fs(E.e1).doc(T('np3')).update({ wp: '2' }));
      await assertFails(fs(E.e1).doc(T('np3')).update({ wp: 2, np: 0 }));
      await assertFails(fs(E.e2).doc(T('np3')).update({ wp: 2 }));
      await assertFails(fs(E.e1).doc(T('multi')).update({ wp: 1 }));
      await assertFails(fs(E.e1).doc(T('np3')).update({ np: 0 }));                         // עובד לא מוריד את הדרישה
    });

    it('§7 rd: כל מי שרשאי לקרוא מסמן רק את המפתח שלו, בזמן אמת; גם במשימה ישנה בלי rd', async () => {
      await assertSucceeds(fs(E.e3).doc(T('legacyA')).update({ ['rd.' + E.e3]: Date.now() }));
      await assertSucceeds(fs(E.e1).doc(T('multi')).update({ ['rd.' + E.e1]: Date.now() }));
      await assertSucceeds(fs(E.e2).doc(T('multi')).update({ ['rd.' + E.e2]: Date.now() }));
      await assertSucceeds(fs(E.e2).doc(T('multi')).update({ ['rd.' + E.e2]: Date.now() })); // עדכון חוזר
      await assertFails(fs(E.e2).doc(T('multi')).update({ ['rd.' + E.e1]: Date.now() }));   // מפתח של אחר
      await assertFails(fs(E.e2).doc(T('multi')).update({ rd: { [E.e2]: Date.now() } }));    // דורס את המפה (מוחק את של e1)
      await assertFails(fs(E.e2).doc(T('multi')).update({ ['rd.' + E.e2]: Date.now() - 10 * MIN }));
      await assertFails(fs(E.e2).doc(T('multi')).update({ ['rd.' + E.e2]: Date.now(), txt: 'x' }));
      await prep((d) => d.doc(T('multi')).update({ st: 'done', open: '' }));
      await assertFails(fs(E.e2).doc(T('multi')).update({ ['rd.' + E.e2]: Date.now() }));   // לא רשאי לקרוא
      await assertSucceeds(fs(E.mgr).doc(T('multi')).update({ ['rd.' + E.mgr]: Date.now() }));
    });

    it('§8 תגובה: cAt/cBy/cT/cN יחד (וגם רק cAt/cBy כמו באפליקציה הישנה); אורכים ושם הכותב', async () => {
      const m = (o) => fs(E.e2).doc(T('multi')).update(Object.assign({ cAt: Date.now(), cBy: E.e2 }, o));
      await assertSucceeds(m({}));
      await assertSucceeds(m({ cT: 'א'.repeat(120), cN: E.e2 }));
      await assertFails(m({ cT: 'א'.repeat(121), cN: E.e2 }));
      await assertFails(m({ cT: 'שלום', cN: E.mgr }));
      await assertFails(m({ cT: 5, cN: E.e2 }));
      await assertFails(m({ cT: 'שלום', cN: E.e2, ow: E.e2 }));
      await assertSucceeds(fs(E.mgr).doc(T('multi')).update({ cAt: Date.now(), cBy: E.mgr, cT: 'תגובה', cN: E.mgr }));
    });

    it('§1 יצירה ע"י מנהל: נמענים, ow לפי מספר הנמענים, np/mi/wp בגבולות', async () => {
      const c = (o) => fs(E.mgr).doc(T(fresh('t'))).set(newMgr(o));
      const two = { to: [E.e1, E.e2], toN: [E.e1, E.e2], ow: '', owN: '', clt: 0 };
      const one = { to: [E.e1], toN: [E.e1], ow: E.e1, owN: E.e1, clt: Date.now() };
      await assertSucceeds(c(two));
      await assertSucceeds(c(Object.assign({}, two, { np: 3, mi: 5, wp: 0 })));
      await assertSucceeds(c(one));
      await assertSucceeds(c({ np: 1 }));                                                  // בלי נמענים (כמו היום) עם חובת תמונה
      await assertFails(c(Object.assign({}, one, { ow: '' })));
      await assertFails(c(Object.assign({}, one, { ow: E.e2 })));
      await assertFails(c(Object.assign({}, two, { ow: E.e1 })));
      await assertFails(c(Object.assign({}, two, { toN: [E.e1] })));
      await assertFails(c(Object.assign({}, two, { to: [], toN: [] , ow: ''})));
      const many = Array.from({ length: 31 }, (_, i) => 'u' + i);
      await assertFails(c(Object.assign({}, two, { to: many, toN: many })));
      const thirty = many.slice(0, 30);
      await assertSucceeds(c(Object.assign({}, two, { to: thirty, toN: thirty })));
      await assertFails(c(Object.assign({}, two, { to: E.e1 })));
      await assertFails(c({ ow: E.e1, owN: E.e1, clt: Date.now() }));                       // ow בלי to
      await assertFails(c(Object.assign({}, two, { np: 4 })));
      await assertFails(c(Object.assign({}, two, { np: -1 })));
      await assertFails(c(Object.assign({}, two, { np: 2, pr: '1' })));
      await assertFails(c(Object.assign({}, two, { mi: 6 })));
      await assertFails(c(Object.assign({}, two, { wp: 1 })));
      await assertFails(c(Object.assign({}, two, { rd: {} })));
      await assertFails(c(Object.assign({}, two, { cT: 'x' })));
    });

    it('§1 עובד לא יוצר משימה עם השדות החדשים (משימת עובד נשארת כמו היום)', async () => {
      const w = (o) => { const t = Date.now(); return fs(E.e1).doc(T(fresh('t'))).set(Object.assign(base({ owner: E.e1, by: E.e1, role: 'w', cr: t, due: t + 4 * D1 }), o)); };
      await assertSucceeds(w({}));
      await assertFails(w({ to: [E.e1], toN: [E.e1], ow: E.e1, owN: E.e1, clt: Date.now() }));
      await assertFails(w({ to: [E.e1, E.e2], toN: [E.e1, E.e2], ow: '', owN: '', clt: 0 }));
      await assertFails(w({ np: 0 }));
      await assertFails(w({ mi: 0 }));
      await assertFails(w({ wp: 0 }));
    });

    if (E.foreign) {
      it('מנהל של עסק אחר: לא תופס, לא מבטל, לא מעביר, לא מעלה ולא קורא תמונות', async () => {
        const f = fs(E.foreign);
        await assertFails(f.doc(T('np3')).update({ ow: '', owN: '', clt: 0 }));
        await assertFails(f.doc(T('np3')).update({ ow: E.foreign, owN: E.foreign, clt: Date.now() }));
        await assertFails(f.doc(T('multi')).update(claim(E.foreign)));
        await assertFails(f.doc(T('multi') + '/p/m2').set(photo(E.foreign)));
        await assertFails(f.doc(T('multi') + '/p/m1').get());
        await assertFails(f.doc(T('multi') + '/p/m1').delete());
        await assertFails(f.doc(T('multi')).update({ ['rd.' + E.foreign]: Date.now() }));
        await assertFails(f.doc(T(fresh('t'))).set(newMgr({ to: [E.e1], toN: [E.e1], ow: E.e1, owN: E.e1, clt: Date.now() })));
        // ובעסק שלו – מותר (בדיקת "מותר" תואמת)
        await prep((d) => d.doc('b/bx/tasks/x1').set(base({ owner: 'bx_mgr', by: 'bx_mgr', ow: 'bx_e1', owN: 'bx_e1', to: ['bx_e1'], toN: ['bx_e1'] })));
        await assertSucceeds(f.doc('b/bx/tasks/x1').update({ ow: '', owN: '', clt: 0 }));
      });

      it('תוספת tasks כבויה בעסק – גם תפיסה ותמונות נחסמות', async () => {
        await prep((d) => d.doc('b/bt').update({ 'features.tasks': false }));
        await assertFails(fs(E.e1).doc(T('multi')).update(claim(E.e1)));
        await assertFails(fs(E.e1).doc(T('np3') + '/p/w1').set(photo(E.e1)));
        await assertFails(fs(E.mgr).doc(T('multi') + '/p/m2').set(photo(E.mgr)));
        await assertFails(fs(E.e2).doc(T('multi') + '/p/m1').get());
      });
    }
  });
}
