'use strict';
// משימות פרטיות (ptk), משימות קבועות (rtk) ובקשות למנהל (rq + rq/{id}/c) – 12.11.2026. חוקי השורש.
// משתמשים (helpers.seed): u_emp, u_emp2 (= H.OTHER) עובדים פעילים, u_mgr מנהל, u_off עובד מושבת, u_out מחובר בלי תפקיד.
const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const D1 = 86400000;
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const ptk = (owner, o) => { const cr = Date.now(); return Object.assign({ owner, by: owner, txt: 'תזכורת', cr, due: cr + 4 * D1, st: 'open', sub: 0, late: '' }, o); };
const rtk = (owner, o) => Object.assign({ owner, by: owner, txt: 'לסגור קופה', to: ['u_emp'], toN: ['u_emp'], np: 0, fq: 'w', wd: [2], hh: 7, mm: 0, hol: true, on: true, cr: Date.now(), ed: Date.now() }, o);
const rq = (owner, o) => Object.assign({ owner, by: owner, txt: 'בקשה', t: Date.now(), st: 'new', ans: '' }, o);
const cm = (uid, o) => Object.assign({ uid, by: uid, txt: 'תגובה', t: Date.now() }, o);

describe('משימות פרטיות, קבועות ובקשות (שורש)', () => {
  let env, emp, emp2, mgr, off, out;
  const db = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
  const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => {
    await H.seed(env);
    await prep(async (a) => {
      await a.doc('ptk/p_emp2').set(ptk(H.OTHER));
      await a.doc('ptk/p_emp').set(ptk('u_emp'));
      await a.doc('rtk/r1').set(rtk('u_mgr'));
      await a.doc('rq/q_emp2').set(rq(H.OTHER));
      await a.doc('rq/q_emp').set(rq('u_emp'));
      await a.doc('rq/q_emp/c/c1').set(cm('u_mgr'));
      await a.doc('rq/q_emp2/c/c1').set(cm(H.OTHER));
    });
    emp = db('u_emp'); emp2 = db(H.OTHER); mgr = db('u_mgr'); off = db('u_off'); out = db('u_out');
  });

  // ---------- ptk ----------
  it('ptk: עובד לא קורא משימה פרטית של אחר – לא במסמך ולא בשאילתה; את שלו כן; מנהל קורא הכול', async () => {
    await assertFails(emp.doc('ptk/p_emp2').get());
    await assertFails(emp.collection('ptk').get());
    await assertFails(emp.collection('ptk').where('owner', '==', H.OTHER).get());
    await assertSucceeds(emp.doc('ptk/p_emp').get());
    await assertSucceeds(emp.collection('ptk').where('owner', '==', 'u_emp').get());
    await assertSucceeds(mgr.doc('ptk/p_emp2').get());
    await assertSucceeds(mgr.collection('ptk').get());
    await assertFails(off.collection('ptk').where('owner', '==', 'u_off').get());
    await assertFails(out.collection('ptk').where('owner', '==', 'u_out').get());
  });

  it('ptk: יצירה רק בשמו, פתוחה, בזמן אמת, יעד בטווח, בלי שדות נוספים; עובד מושבת ומחובר בלי תפקיד – לא', async () => {
    await assertSucceeds(emp.doc('ptk/' + fresh('p')).set(ptk('u_emp')));
    await assertSucceeds(mgr.doc('ptk/' + fresh('p')).set(ptk('u_mgr')));
    await assertFails(emp.doc('ptk/' + fresh('p')).set(ptk(H.OTHER)));
    await assertFails(emp.doc('ptk/' + fresh('p')).set(ptk('u_emp', { by: H.OTHER })));
    await assertFails(emp.doc('ptk/' + fresh('p')).set(ptk('u_emp', { st: 'done' })));
    await assertFails(emp.doc('ptk/' + fresh('p')).set(ptk('u_emp', { late: '1' })));
    await assertFails(emp.doc('ptk/' + fresh('p')).set(ptk('u_emp', { txt: '' })));
    await assertFails(emp.doc('ptk/' + fresh('p')).set(ptk('u_emp', { txt: 'א'.repeat(501) })));
    const old = Date.now() - 10 * 60000;
    await assertFails(emp.doc('ptk/' + fresh('p')).set(ptk('u_emp', { cr: old, due: old + 4 * D1 })));
    const cr = Date.now();
    await assertFails(emp.doc('ptk/' + fresh('p')).set(ptk('u_emp', { cr, due: cr + D1 })));
    await assertFails(emp.doc('ptk/' + fresh('p')).set(ptk('u_emp', { to: ['u_emp'] })));
    await assertFails(off.doc('ptk/' + fresh('p')).set(ptk('u_off')));
    await assertFails(out.doc('ptk/' + fresh('p')).set(ptk('u_out')));
  });

  it('ptk: בעלים מסמן בוצע / מחזיר לפתוחה / עורך טקסט / מוחק; עובד אחר – לא; מנהל – כן', async () => {
    await assertSucceeds(emp.doc('ptk/p_emp').update({ st: 'done', sub: Date.now(), late: '' }));
    await assertSucceeds(emp.doc('ptk/p_emp').update({ st: 'open', sub: 0, late: '' }));
    await assertSucceeds(emp.doc('ptk/p_emp').update({ txt: 'חדש' }));
    await assertFails(emp.doc('ptk/p_emp').update({ st: 'done', sub: Date.now() - 10 * 60000, late: '' })); // sub מזויף
    await assertFails(emp.doc('ptk/p_emp').update({ st: 'wait' }));
    await assertFails(emp.doc('ptk/p_emp').update({ owner: H.OTHER }));
    await assertFails(emp.doc('ptk/p_emp').update({ due: Date.now() + 9 * D1 }));
    await assertFails(emp2.doc('ptk/p_emp').update({ st: 'done', sub: Date.now(), late: '' }));
    await assertFails(emp2.doc('ptk/p_emp').delete());
    await assertSucceeds(mgr.doc('ptk/p_emp2').update({ st: 'done', sub: Date.now(), late: '1' }));
    await assertSucceeds(emp.doc('ptk/p_emp').delete());
    await assertSucceeds(mgr.doc('ptk/p_emp2').delete());
  });

  it('ptk: עובד שהושבת לא קורא ולא מעדכן את המשימה הפרטית שלו', async () => {
    await prep((a) => a.doc('ptk/p_off').set(ptk('u_off')));
    await assertFails(off.doc('ptk/p_off').get());
    await assertFails(off.doc('ptk/p_off').update({ st: 'done', sub: Date.now(), late: '' }));
    await assertFails(off.doc('ptk/p_off').delete());
  });

  // ---------- rtk ----------
  it('rtk: עובד לא קורא ולא כותב כללי משימות קבועות (גם לא כלל שהוא נמען בו)', async () => {
    await assertFails(emp.doc('rtk/r1').get());
    await assertFails(emp.collection('rtk').get());
    await assertFails(emp.collection('rtk').where('to', 'array-contains', 'u_emp').get());
    await assertFails(emp.doc('rtk/' + fresh('r')).set(rtk('u_emp')));
    await assertFails(emp.doc('rtk/r1').update({ txt: 'x', ed: Date.now() + (++seq) }));
    await assertFails(emp.doc('rtk/r1').delete());
    await assertFails(off.doc('rtk/r1').get());
  });

  it('rtk: מנהל יוצר, קורא, עורך (עם ed בזמן אמת), מכבה ומוחק', async () => {
    const id = fresh('r');
    await assertSucceeds(mgr.doc('rtk/' + id).set(rtk('u_mgr')));
    await assertSucceeds(mgr.doc('rtk/' + id).get());
    await assertSucceeds(mgr.collection('rtk').get());
    await assertSucceeds(mgr.doc('rtk/' + id).update({ hh: 8, mm: 30, ed: Date.now() + (++seq) }));
    await assertSucceeds(mgr.doc('rtk/' + id).update({ on: false, ed: Date.now() + (++seq) }));
    await assertSucceeds(mgr.doc('rtk/' + id).update({ fq: 'm', md: 31, ed: Date.now() + (++seq) }));
    await assertSucceeds(mgr.doc('rtk/' + id).update({ fq: 'd', to: ['u_emp', 'u_emp2'], toN: ['א', 'ב'], np: 3, hol: false, ed: Date.now() + (++seq) }));
    await assertSucceeds(mgr.doc('rtk/' + id).delete());
  });

  it('rtk: בדיקת סוגים וטווחים, ed בזמן אמת וחייב להשתנות בכל עדכון, ושדות השרת (last/n/err) לא נכתבים מהאפליקציה', async () => {
    const bad = (o) => assertFails(mgr.doc('rtk/' + fresh('r')).set(rtk('u_mgr', o)));
    await bad({ owner: 'u_emp' });
    await bad({ by: 'u_emp' });
    await bad({ txt: '' });
    await bad({ to: [] });
    await bad({ to: Array.from({ length: 31 }, (_, i) => 'u' + i), toN: Array.from({ length: 31 }, (_, i) => 'n' + i) });
    await bad({ toN: ['a', 'b'] });
    await bad({ np: 4 });
    await bad({ fq: 'y' });
    await bad({ fq: 'w', wd: [] });
    await bad({ fq: 'w', wd: [6] });
    await bad({ fq: 'm', md: 0 });
    await bad({ fq: 'm', md: 32 });
    await bad({ hh: 24 });
    await bad({ mm: 7 });
    await bad({ mm: 60 });
    await bad({ hol: 'yes' });
    await bad({ ed: Date.now() - 10 * 60000 });
    await bad({ last: '2026-11-12' });
    await bad({ n: 3 });
    await bad({ err: 'x' });
    await bad({ extra: 1 });
    await assertFails(mgr.doc('rtk/r1').update({ txt: 'בלי ed' }));
    await assertFails(mgr.doc('rtk/r1').update({ last: '2026-11-12', ed: Date.now() + (++seq) }));
    await assertFails(mgr.doc('rtk/r1').update({ n: 5, ed: Date.now() + (++seq) }));
    await assertFails(mgr.doc('rtk/r1').update({ owner: 'u_emp', ed: Date.now() + (++seq) }));
    await assertSucceeds(mgr.doc('rtk/' + fresh('r')).set(rtk('u_mgr', { fq: 'm', md: 31, wd: [] })));
  });

  // ---------- rq ----------
  it('rq: עובד לא קורא בקשה של עובד אחר – לא במסמך, לא בשאילתה, לא בתגובות; את שלו כן; מנהל הכול', async () => {
    await assertFails(emp.doc('rq/q_emp2').get());
    await assertFails(emp.collection('rq').get());
    await assertFails(emp.collection('rq').where('owner', '==', H.OTHER).get());
    await assertFails(emp.doc('rq/q_emp2/c/c1').get());
    await assertFails(emp.collection('rq/q_emp2/c').get());
    await assertSucceeds(emp.doc('rq/q_emp').get());
    await assertSucceeds(emp.collection('rq').where('owner', '==', 'u_emp').get());
    await assertSucceeds(emp.collection('rq/q_emp/c').get());
    await assertSucceeds(mgr.collection('rq').get());
    await assertSucceeds(mgr.collection('rq/q_emp2/c').get());
    await assertFails(off.collection('rq').where('owner', '==', 'u_off').get());
  });

  it('rq: יצירה – בשמו, st new, ans ריק, בזמן אמת, עד 1000 תווים; עובד מושבת – לא', async () => {
    await assertSucceeds(emp.doc('rq/' + fresh('q')).set(rq('u_emp')));
    await assertSucceeds(emp.doc('rq/' + fresh('q')).set(rq('u_emp', { txt: 'א'.repeat(1000) })));
    await assertFails(emp.doc('rq/' + fresh('q')).set(rq('u_emp', { txt: 'א'.repeat(1001) })));
    await assertFails(emp.doc('rq/' + fresh('q')).set(rq(H.OTHER)));
    await assertFails(emp.doc('rq/' + fresh('q')).set(rq('u_emp', { by: 'u_mgr' })));
    await assertFails(emp.doc('rq/' + fresh('q')).set(rq('u_emp', { st: 'done' })));
    await assertFails(emp.doc('rq/' + fresh('q')).set(rq('u_emp', { ans: 'אושר' })));
    await assertFails(emp.doc('rq/' + fresh('q')).set(rq('u_emp', { t: Date.now() - 10 * 60000 })));
    await assertFails(off.doc('rq/' + fresh('q')).set(rq('u_off')));
  });

  it('rq: הבעלים לא משנה st ל-done/rej ולא כותב ans; תגובה שלו (cAt/cBy/cT/cN) מחזירה ל-new', async () => {
    await assertFails(emp.doc('rq/q_emp').update({ st: 'done' }));
    await assertFails(emp.doc('rq/q_emp').update({ st: 'rej' }));
    await assertFails(emp.doc('rq/q_emp').update({ ans: 'אישרתי לעצמי' }));
    await assertFails(emp.doc('rq/q_emp').update({ st: 'done', cAt: Date.now(), cBy: 'u_emp' }));
    await assertFails(emp.doc('rq/q_emp').update({ txt: 'שיניתי' }));
    await assertFails(emp.doc('rq/q_emp').update({ cAt: Date.now(), cBy: H.OTHER }));
    await assertFails(emp2.doc('rq/q_emp').update({ cAt: Date.now(), cBy: H.OTHER }));
    await prep((a) => a.doc('rq/q_emp').update({ st: 'done', ans: 'טופל', aBy: 'u_mgr', aAt: Date.now() }));
    await assertSucceeds(emp.doc('rq/q_emp').update({ cAt: Date.now(), cBy: 'u_emp', cT: 'עוד שאלה', cN: 'u_emp', st: 'new' }));
    await assertFails(emp.doc('rq/q_emp').update({ cAt: Date.now(), cBy: 'u_emp', cN: 'u_mgr' }));
  });

  it('rq: מנהל עונה ומסמן טופל/נדחה בשמו; שדות קבועים (owner/txt) לא משתנים', async () => {
    await assertSucceeds(mgr.doc('rq/q_emp').update({ st: 'done', ans: 'בסדר', aBy: 'u_mgr', aAt: Date.now() }));
    await assertSucceeds(mgr.doc('rq/q_emp').update({ st: 'rej', ans: 'לא הפעם', aBy: 'u_mgr', aAt: Date.now() }));
    await assertSucceeds(mgr.doc('rq/q_emp').update({ cAt: Date.now(), cBy: 'u_mgr', cT: 'תשובה', cN: 'u_mgr' }));
    await assertFails(mgr.doc('rq/q_emp').update({ st: 'doing' }));
    await assertFails(mgr.doc('rq/q_emp').update({ ans: 'א'.repeat(501) }));
    await assertFails(mgr.doc('rq/q_emp').update({ aBy: 'u_emp', aAt: Date.now() }));
    await assertFails(mgr.doc('rq/q_emp').update({ owner: 'u_mgr' }));
    await assertFails(mgr.doc('rq/q_emp').update({ txt: 'x' }));
    await assertSucceeds(mgr.doc('rq/q_emp').delete());
    await assertFails(emp.doc('rq/q_emp2').delete());
  });

  it('rq/c: תגובות – בעלים ומנהל בשמם; עובד אחר לא; בלי עדכון; מחיקה רק מנהל', async () => {
    await assertSucceeds(emp.doc('rq/q_emp/c/' + fresh('c')).set(cm('u_emp')));
    await assertSucceeds(mgr.doc('rq/q_emp/c/' + fresh('c')).set(cm('u_mgr')));
    await assertFails(emp2.doc('rq/q_emp/c/' + fresh('c')).set(cm(H.OTHER)));
    await assertFails(emp.doc('rq/q_emp/c/' + fresh('c')).set(cm('u_emp', { by: 'u_mgr' })));
    await assertFails(emp.doc('rq/q_emp/c/' + fresh('c')).set(cm('u_emp', { txt: '' })));
    await assertFails(emp.doc('rq/q_emp/c/' + fresh('c')).set(cm('u_emp', { t: 1 })));
    await assertFails(emp.doc('rq/nope/c/' + fresh('c')).set(cm('u_emp')));
    await assertFails(emp.doc('rq/q_emp/c/c1').update({ txt: 'x' }));
    await assertFails(emp.doc('rq/q_emp/c/c1').delete());
    await assertSucceeds(mgr.doc('rq/q_emp/c/c1').delete());
  });
});
