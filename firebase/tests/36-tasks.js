'use strict';
// משימות (tasks) ותגובות במשימה (tasks/{id}/c/{cid}).
// הלוגיקה של המשימות הועתקה מהכללים שפעילים היום; כאן בודקים שהיא עדיין חוסמת את מה שצריך,
// שעכשיו רק צוות (מנהל או עובד פעיל) נכנס, ואת חוקי התגובות ושדות הסימון cAt/cBy.
// נתוני הדמו (helpers.seed): t_open, t_pr (נדרשת תמונה), t_wait, t_overdue (עבר היעד), t_done, t_done_late,
// ותגובה c1 ב-t_open וב-t_done. כולן של עובד אחר (u_emp2).

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const D1 = 86400000, H1 = 3600000, MIN = 60000;
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const newTask = (owner, o) => { const cr = Date.now(); return Object.assign({ owner, by: owner, role: 'w', txt: 'משימה', cr, due: cr + 4 * D1,
  st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '' }, o); };
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(500);
const comment = (uid, o) => Object.assign({ uid, by: uid, txt: 'תגובה', t: Date.now() }, o);

describe('משימות (tasks)', () => {
  let env, emp, mgr;
  const db = (role) => H.ctxFor(env, role).firestore();
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); emp = db('employee'); mgr = db('manager'); });

  it('עובד יוצר משימה רק בשמו', async () => {
    await assertSucceeds(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp')));
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask(H.OTHER)));
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask('u_mgr')));
  });

  it('השם (by) במשימה חדשה חייב להיות של הכותב: לא בשם המנהל ולא בשם עובד אחר', async () => {
    const t = (d, owner, by) => d.doc('tasks/' + fresh('t')).set(newTask(owner, { by }));
    await assertFails(t(emp, 'u_emp', 'u_mgr'));
    await assertFails(t(emp, 'u_emp', H.OTHER));
    await assertFails(t(emp, 'u_emp', ''));
    await assertFails(t(mgr, 'u_mgr', 'u_emp'));
    await assertSucceeds(t(emp, 'u_emp', 'U_EMP')); // אותו שם באותיות שונות
    await assertSucceeds(t(mgr, 'u_mgr', 'U_Mgr'));
    await assertFails(env.authenticatedContext('u_emp').firestore().doc('tasks/' + fresh('t')).set(newTask('u_emp'))); // בלי אימייל בטוקן
  });

  it('עובד לא מסמן בוצע או מצרף תמונה בשם אחר (doneBy)', async () => {
    let n = Date.now();
    await assertFails(emp.doc('tasks/t_open').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_mgr', late: '' }));
    await assertFails(emp.doc('tasks/t_open').update({ st: 'done', open: '', sub: n, ok: n, doneBy: H.OTHER, late: '' }));
    await assertFails(emp.doc('tasks/t_pr').update({ st: 'wait', img: IMG, sub: n, doneBy: 'u_mgr' }));
    await assertSucceeds(emp.doc('tasks/t_pr').update({ st: 'wait', img: IMG, sub: n, doneBy: 'U_Emp' }));
    n = Date.now();
    await assertSucceeds(emp.doc('tasks/t_open').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'U_EMP', late: '' }));
  });

  it('עובד לא קובע יעד מעל 17 יום או פחות מ-72 שעות (הגבולות עצמם מותרים)', async () => {
    const cr = Date.now();
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { cr, due: cr + 17 * D1 + MIN })));
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { cr, due: cr + 72 * H1 - MIN })));
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { cr, due: cr + H1 })));
    await assertSucceeds(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { cr, due: cr + 72 * H1 })));
    await assertSucceeds(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { cr, due: cr + 17 * D1 })));
  });

  it('עובד לא יוצר משימה "של מנהל", עם דרישת תמונה, שכבר בוצעה, או עם זמן יצירה מזויף', async () => {
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { role: 'a' })));
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { pr: '1' })));
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { st: 'done', open: '' })));
    const old = Date.now() - 10 * MIN;
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { cr: old, due: old + 4 * D1 })));
    // שדות נוספים (גם cAt/cBy) לא נכנסים ביצירה
    await assertFails(emp.doc('tasks/' + fresh('t')).set(newTask('u_emp', { cAt: Date.now(), cBy: 'u_emp' })));
  });

  it('עובד לא מסמן "בוצע" במשימה שנדרשת בה תמונה; צירוף תמונה תקינה מותר', async () => {
    const n = Date.now();
    await assertFails(emp.doc('tasks/t_pr').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '' }));
    await assertFails(emp.doc('tasks/t_pr').update({ st: 'wait', img: 'data:text/html;base64,' + 'A'.repeat(500), sub: n, doneBy: 'u_emp' }));
    await assertSucceeds(emp.doc('tasks/t_pr').update({ st: 'wait', img: IMG, sub: n, doneBy: 'u_emp' }));
    // ממתינה לאישור – העובד לא סוגר אותה בעצמו
    await assertFails(emp.doc('tasks/t_wait').update({ st: 'done', open: '', ok: Date.now() }));
  });

  it('עובד לא מזייף את זמן הביצוע (nowOk)', async () => {
    const past = Date.now() - 10 * MIN, future = Date.now() + 10 * MIN;
    await assertFails(emp.doc('tasks/t_open').update({ st: 'done', open: '', sub: past, ok: past, doneBy: 'u_emp', late: '' }));
    await assertFails(emp.doc('tasks/t_open').update({ st: 'done', open: '', sub: future, ok: future, doneBy: 'u_emp', late: '' }));
    const n = Date.now();
    await assertFails(emp.doc('tasks/t_open').update({ st: 'done', open: '', sub: n, ok: n - 5000, doneBy: 'u_emp', late: '' }));
  });

  it('עובד לא מסתיר איחור (ולא מסמן איחור כשאין)', async () => {
    let n = Date.now();
    await assertFails(emp.doc('tasks/t_overdue').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '' }));
    await assertFails(emp.doc('tasks/t_open').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '1' }));
    n = Date.now();
    await assertSucceeds(emp.doc('tasks/t_overdue').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '1' }));
  });

  it('עובד לא משנה שדות אחרים ולא מוחק', async () => {
    await assertFails(emp.doc('tasks/t_open').update({ txt: 'שונה' }));
    await assertFails(emp.doc('tasks/t_open').update({ due: Date.now() + 10 * D1 }));
    await assertFails(emp.doc('tasks/t_open').update({ pr: '1' }));
    await assertFails(emp.doc('tasks/t_open').delete());
    await assertFails(emp.doc('tasks/t_done').delete());
  });

  it('עובד רואה רק משימות פתוחות או באיחור', async () => {
    await assertSucceeds(emp.doc('tasks/t_open').get());
    await assertSucceeds(emp.doc('tasks/t_done_late').get());
    await assertFails(emp.doc('tasks/t_done').get());
    await assertSucceeds(emp.collection('tasks').where('late', '==', '1').get());
    await assertFails(emp.collection('tasks').where('st', '==', 'done').get());
  });

  for (const role of ['signedIn', 'disabledEmployee', 'guest']) {
    it(`${role}: נחסם בכל פעולה על משימות ותגובות`, async () => {
      const d = db(role); const me = H.UID[role] || 'nobody'; const n = Date.now();
      await assertFails(d.doc('tasks/t_open').get());
      await assertFails(d.doc('tasks/t_done_late').get());
      await assertFails(d.collection('tasks').where('open', '==', '1').get());
      await assertFails(d.collection('tasks').where('late', '==', '1').get());
      await assertFails(d.doc('tasks/' + fresh('t')).set(newTask(me)));
      await assertFails(d.doc('tasks/t_open').update({ st: 'done', open: '', sub: n, ok: n, doneBy: me, late: '' }));
      await assertFails(d.doc('tasks/t_pr').update({ st: 'wait', img: IMG, sub: n, doneBy: me }));
      await assertFails(d.doc('tasks/t_open').update({ cAt: n, cBy: me }));
      await assertFails(d.doc('tasks/t_open').delete());
      await assertFails(d.doc('tasks/t_open/c/c1').get());
      await assertFails(d.collection('tasks/t_open/c').get());
      await assertFails(d.doc('tasks/t_open/c/' + fresh('c')).set(comment(me)));
      await assertFails(d.doc('tasks/t_open/c/c1').delete());
    });
  }

  it('מנהל יכול הכול: יצירה (גם "של מנהל" ועם תמונה), קריאה, עדכון, אישור ומחיקה', async () => {
    await assertSucceeds(mgr.doc('tasks/' + fresh('t')).set(newTask('u_mgr', { role: 'a', pr: '1' })));
    await assertSucceeds(mgr.collection('tasks').get());
    await assertSucceeds(mgr.doc('tasks/t_done').get());
    await assertSucceeds(mgr.doc('tasks/t_open').update({ txt: 'שונה', pr: '1' }));
    await assertSucceeds(mgr.doc('tasks/t_wait').update({ st: 'done', open: '', ok: Date.now(), late: '', note: '' }));
    await assertSucceeds(mgr.doc('tasks/t_done').delete());
    // גם מנהל "כמו היום" (רק admins, בלי staff)
    const oldDb = env.authenticatedContext(H.MANAGER_ONLY_ADMINS).firestore();
    await assertSucceeds(oldDb.doc('tasks/t_overdue').delete());
  });
});

describe('תגובות במשימה (tasks/{id}/c) ושדות הסימון cAt/cBy', () => {
  let env, emp, emp2, mgr;
  const db = (role) => H.ctxFor(env, role).firestore();
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); emp = db('employee'); mgr = db('manager'); emp2 = env.authenticatedContext(H.OTHER, { email: H.OTHER + '@example.invalid' }).firestore(); });

  it('עובד ומנהל מגיבים זה לזה בלי הגבלת כמות', async () => {
    for (let k = 0; k < 5; k++) {
      await assertSucceeds(emp.doc('tasks/t_open/c/' + fresh('c')).set(comment('u_emp')));
      await assertSucceeds(mgr.doc('tasks/t_open/c/' + fresh('c')).set(comment('u_mgr')));
    }
    const all = await assertSucceeds(emp.collection('tasks/t_open/c').get());
    if (all.size < 11) throw new Error('ציפינו ל-11 תגובות לפחות, התקבלו ' + all.size);
    // מגיב גם על משימה שבוצעה באיחור (הוא רשאי לקרוא אותה)
    await assertSucceeds(emp.doc('tasks/t_done_late/c/' + fresh('c')).set(comment('u_emp')));
  });

  it('עובד לא כותב תגובה בשם אחר', async () => {
    await assertFails(emp.doc('tasks/t_open/c/' + fresh('c')).set(comment(H.OTHER)));
    await assertFails(emp.doc('tasks/t_open/c/' + fresh('c')).set(comment('u_mgr')));
  });

  it('השם (by) בתגובה חייב להתאים לאימייל של הכותב: עובד לא מציג שם של מנהל, ומנהל לא מציג שם של עובד', async () => {
    const c = (d, uid, by) => d.doc('tasks/t_open/c/' + fresh('c')).set(comment(uid, { by }));
    await assertFails(c(emp, 'u_emp', 'u_mgr'));
    await assertFails(c(emp, 'u_emp', 'boss'));
    await assertFails(c(emp, 'u_emp', ''));
    await assertFails(c(mgr, 'u_mgr', 'u_emp'));
    await assertFails(c(mgr, 'u_mgr', H.OTHER));
    await assertSucceeds(c(emp, 'u_emp', 'u_emp'));
    await assertSucceeds(c(emp, 'u_emp', 'U_Emp')); // האימייל הוקלד באותיות גדולות – עדיין אותו אדם
    await assertSucceeds(c(mgr, 'u_mgr', 'u_mgr'));
    // טוקן בלי אימייל – נחסם
    const noMail = env.authenticatedContext('u_emp').firestore();
    await assertFails(noMail.doc('tasks/t_open/c/' + fresh('c')).set(comment('u_emp')));
  });

  it('עובד לא מעדכן תגובה (גם לא שלו) ולא מוחק; מנהל מוחק אבל לא מעדכן', async () => {
    const id = fresh('c');
    await assertSucceeds(emp.doc('tasks/t_open/c/' + id).set(comment('u_emp')));
    await assertFails(emp.doc('tasks/t_open/c/' + id).update({ txt: 'שונה' }));
    await assertFails(emp.doc('tasks/t_open/c/' + id).set(comment('u_emp', { txt: 'שונה' })));
    await assertFails(emp.doc('tasks/t_open/c/' + id).delete());
    await assertFails(emp2.doc('tasks/t_open/c/c1').delete());
    await assertFails(mgr.doc('tasks/t_open/c/' + id).update({ txt: 'שונה' }));
    await assertSucceeds(mgr.doc('tasks/t_open/c/' + id).delete());
  });

  it('עובד לא מגיב ולא קורא תגובות במשימה שאינו רשאי לקרוא; אין תגובה למשימה שלא קיימת', async () => {
    await assertFails(emp.doc('tasks/t_done/c/' + fresh('c')).set(comment('u_emp')));
    await assertFails(emp.doc('tasks/t_done/c/c1').get());
    await assertFails(emp.collection('tasks/t_done/c').get());
    await assertFails(emp.doc('tasks/no_such/c/' + fresh('c')).set(comment('u_emp')));
    await assertFails(mgr.doc('tasks/no_such/c/' + fresh('c')).set(comment('u_mgr')));
    await assertSucceeds(mgr.doc('tasks/t_done/c/' + fresh('c')).set(comment('u_mgr')));
  });

  it('תגובה: טקסט 1–500 תווים, זמן עכשיו, רק השדות uid/by/txt/t', async () => {
    const c = (o) => emp.doc('tasks/t_open/c/' + fresh('c')).set(comment('u_emp', o));
    await assertFails(c({ txt: '' }));
    await assertFails(c({ txt: 'א'.repeat(501) }));
    await assertSucceeds(c({ txt: 'א'.repeat(500) }));
    await assertFails(c({ t: Date.now() - 10 * MIN }));
    await assertFails(c({ t: Date.now() + 10 * MIN }));
    await assertFails(c({ t: String(Date.now()) }));
    await assertFails(c({ extra: 1 }));
    await assertFails(emp.doc('tasks/t_open/c/' + fresh('c')).set({ uid: 'u_emp', txt: 'בלי שם וזמן' }));
  });

  it('cAt/cBy: עובד מעדכן רק את שני השדות, בשמו ובזמן אמת, ורק במשימה שהוא רשאי לקרוא', async () => {
    await assertSucceeds(emp.doc('tasks/t_open').update({ cAt: Date.now(), cBy: 'u_emp' }));
    await assertSucceeds(emp2.doc('tasks/t_open').update({ cAt: Date.now(), cBy: H.OTHER })); // דורס סימון של אחר
    await assertFails(emp.doc('tasks/t_open').update({ cAt: Date.now(), cBy: H.OTHER }));
    await assertFails(emp.doc('tasks/t_open').update({ cAt: Date.now() - 10 * MIN, cBy: 'u_emp' }));
    await assertFails(emp.doc('tasks/t_open').update({ cAt: Date.now(), cBy: 'u_emp', txt: 'שונה' }));
    await assertFails(emp.doc('tasks/t_open').update({ cAt: Date.now(), cBy: 'u_emp', st: 'done', open: '' }));
    await assertFails(emp.doc('tasks/t_open').update({ cAt: Date.now(), cBy: 'u_emp', late: '1' }));
    await assertFails(emp.doc('tasks/t_overdue').update({ cAt: Date.now(), cBy: 'u_emp', due: Date.now() + 10 * D1 }));
    await assertFails(emp.doc('tasks/t_done').update({ cAt: Date.now(), cBy: 'u_emp' }));
    await assertSucceeds(emp.doc('tasks/t_done_late').update({ cAt: Date.now(), cBy: 'u_emp' }));
  });

  it('תאימות: משימות עם cAt/cBy ובלעדיהם – סימון בוצע וצירוף תמונה עובדים כרגיל', async () => {
    await assertSucceeds(emp.doc('tasks/t_open').update({ cAt: Date.now(), cBy: 'u_emp' }));
    let n = Date.now();
    await assertSucceeds(emp.doc('tasks/t_open').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '' }));
    n = Date.now();
    await assertSucceeds(emp.doc('tasks/t_pr').update({ st: 'wait', img: IMG, sub: n, doneBy: 'u_emp' }));
  });
});
