'use strict';
// משימות (tasks) ותגובות במשימה (tasks/{id}/c/{cid}).
// הלוגיקה של המשימות הועתקה מהכללים שפעילים היום; כאן בודקים שהיא עדיין חוסמת את מה שצריך,
// שעכשיו רק צוות (מנהל או עובד פעיל) נכנס, ואת חוקי התגובות ושדות הסימון cAt/cBy.
// נתוני הדמו (helpers.seed): t_open, t_pr (נדרשת תמונה), t_wait, t_overdue (עבר היעד), t_done, t_done_late,
// t_nc (פתוחה, עם הערת עובד nc == '1'), ותגובה c1 ב-t_open וב-t_done. כולן של עובד אחר (u_emp2).

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

  // סיכום משימות: עובד פעיל קורא גם משימה שהוא עצמו ביצע (doneBy בשמו), כולל משימה שבוצעה בזמן
  describe('סיכום משימות – משימה שהעובד ביצע', () => {
    const mineDone = (uid) => newTask(H.OTHER, { st: 'done', open: '', sub: Date.now() - 2000, ok: Date.now() - 2000, doneBy: uid, late: '' });
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        const d = c.firestore();
        await d.doc('tasks/t_emp_done').set(mineDone('u_emp'));
        await d.doc('tasks/t_emp_done_uc').set(mineDone('U_Emp'));
        await d.doc('tasks/t_off_done').set(mineDone('u_off'));
        await d.doc('tasks/t_out_done').set(mineDone('u_out'));
      });
    });

    it('עובד פעיל קורא משימה שהוא ביצע (גם כשהשם נשמר באותיות גדולות), ושאילתה לפי doneBy בשמו', async () => {
      await assertSucceeds(emp.doc('tasks/t_emp_done').get());
      await assertSucceeds(emp.doc('tasks/t_emp_done_uc').get());
      const q = await assertSucceeds(emp.collection('tasks').where('doneBy', '==', 'u_emp').get());
      if (!q.docs.some((x) => x.id === 't_emp_done')) throw new Error('השאילתה לא החזירה את המשימה של העובד');
      await assertSucceeds(emp.collection('tasks').where('doneBy', '==', 'U_Emp').get());
    });

    it('עובד לא קורא משימה שעובד אחר (או המנהל) ביצע, ולא שואל בלי סינון לפי שמו', async () => {
      await assertFails(emp.doc('tasks/t_done').get());
      await assertFails(emp.doc('tasks/t_off_done').get());
      await assertFails(emp.collection('tasks').where('doneBy', '==', H.OTHER).get());
      await assertFails(emp.collection('tasks').where('doneBy', '==', 'u_mgr').get());
      await assertFails(emp.collection('tasks').where('doneBy', '==', '').get());
      await assertFails(emp.collection('tasks').where('st', '==', 'done').get());
      await assertFails(emp.collection('tasks').where('cr', '>=', 0).get());
      await assertFails(emp.collection('tasks').get());
      // טוקן בלי אימייל – נחסם
      await assertFails(env.authenticatedContext('u_emp').firestore().doc('tasks/t_emp_done').get());
    });

    it('עובד מושבת ומחובר שאינו ב-staff לא קוראים משימה שהם ביצעו', async () => {
      const off = db('disabledEmployee'), out = db('signedIn');
      await assertFails(off.doc('tasks/t_off_done').get());
      await assertFails(off.collection('tasks').where('doneBy', '==', 'u_off').get());
      await assertFails(out.doc('tasks/t_out_done').get());
      await assertFails(out.collection('tasks').where('doneBy', '==', 'u_out').get());
    });
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
  // עובד מגיב רק במשימה שסומנה "יש הערת עובד" (nc). כאן מסמנים מראש את המשימות שהעובדים מגיבים בהן (באפליקציה: tkPatch({nc:'1'}) לפני התגובה)
  beforeEach(async () => { await H.seed(env); emp = db('employee'); mgr = db('manager'); emp2 = env.authenticatedContext(H.OTHER, { email: H.OTHER + '@example.invalid' }).firestore();
    await env.withSecurityRulesDisabled((c) => Promise.all(['t_open', 't_done_late'].map((id) => c.firestore().doc('tasks/' + id).update({ nc: '1' })))); });

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
    // t_overdue: בלי nc (כמו משימה ישנה) – "בוצע" סוגר אותה כרגיל
    await assertSucceeds(emp.doc('tasks/t_overdue').update({ cAt: Date.now(), cBy: 'u_emp' }));
    let n = Date.now();
    await assertSucceeds(emp.doc('tasks/t_overdue').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '1' }));
    n = Date.now();
    await assertSucceeds(emp.doc('tasks/t_pr').update({ st: 'wait', img: IMG, sub: n, doneBy: 'u_emp' }));
  });
});

// בקשת בעל העסק 2.11.2026: "כשעובד רושם הערה הוא לא יכול לעשות בוצע – צריך אישור מנהל.
// אם המנהל כתב הערה, גם אחרי שהעובד עשה בוצע, זה יחזור שוב לעובד."
describe('הערות במשימות: nc (הערת עובד) והחזרה לעובד', () => {
  let env, emp, mgr;
  const db = (role) => H.ctxFor(env, role).firestore();
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); emp = db('employee'); mgr = db('manager'); });
  const get = async (id) => { let d; await env.withSecurityRulesDisabled(async (c) => { d = (await c.firestore().doc('tasks/' + id).get()).data(); }); return d; };

  it('עובד מגיב: קודם מסמן nc, ואז התגובה מתקבלת. בלי הסימון – התגובה נחסמת', async () => {
    await assertFails(emp.doc('tasks/t_open/c/' + fresh('c')).set(comment('u_emp')));
    await assertSucceeds(emp.doc('tasks/t_open').update({ nc: '1' }));
    await assertSucceeds(emp.doc('tasks/t_open/c/' + fresh('c')).set(comment('u_emp')));
    await assertSucceeds(emp.doc('tasks/t_open').update({ cAt: Date.now(), cBy: 'u_emp' }));
    // סימון שכבר קיים – מותר שוב (אין שינוי)
    await assertSucceeds(emp.doc('tasks/t_open').update({ nc: '1' }));
    // מנהל מגיב בלי nc
    await assertSucceeds(mgr.doc('tasks/t_pr/c/' + fresh('c')).set(comment('u_mgr')));
  });

  it('עובד עם nc לא מגיע ל-done ישירות; "בוצע" = המתנה לאישור מנהל', async () => {
    let n = Date.now();
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '' }));
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'done', open: '1', sub: n, doneBy: 'u_emp' }));
    // המתנה עם open ריק (נעלם מהרשימה של העובדים), עם תמונה מזויפת, או עם ok/late – נחסם
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'wait', open: '', sub: n, doneBy: 'u_emp' }));
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'wait', img: IMG, sub: n, doneBy: 'u_emp' }));
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'wait', sub: n, ok: n, doneBy: 'u_emp' }));
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'wait', sub: n, late: '1', doneBy: 'u_emp' }));
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'wait', sub: n, doneBy: H.OTHER }));
    n = Date.now();
    await assertSucceeds(emp.doc('tasks/t_nc').update({ st: 'wait', sub: n, doneBy: 'u_emp' }));
    // ממתינה – העובד לא סוגר אותה בעצמו
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'done', open: '', ok: Date.now() }));
    // והמנהל מאשר
    const t = await get('t_nc');
    await assertSucceeds(mgr.doc('tasks/t_nc').update({ st: 'done', open: '', ok: Date.now(), late: t.sub > t.due ? '1' : '', note: '' }));
  });

  it('עובד לא מסיר את nc (גם לא יחד עם "בוצע" או עם סימון תגובה)', async () => {
    const n = Date.now();
    await assertFails(emp.doc('tasks/t_nc').update({ nc: '' }));
    await assertFails(emp.doc('tasks/t_nc').update({ nc: '0' }));
    await assertFails(emp.doc('tasks/t_nc').update({ nc: require('firebase/compat/app').default.firestore.FieldValue.delete() }));
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '', nc: '' }));
    await assertFails(emp.doc('tasks/t_nc').update({ cAt: n, cBy: 'u_emp', nc: '' }));
    // ולא מסמן nc יחד עם שדות אחרים
    await assertFails(emp.doc('tasks/t_open').update({ nc: '1', txt: 'שונה' }));
    // ולא במשימה שאינו רשאי לקרוא
    await assertFails(emp.doc('tasks/t_done').update({ nc: '1' }));
    // מנהל רשאי
    await assertSucceeds(mgr.doc('tasks/t_nc').update({ nc: '' }));
  });

  it('משימה עם nc שנדרשת בה תמונה: צירוף תמונה ממשיך לעבוד כרגיל', async () => {
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('tasks/t_pr').update({ nc: '1' }));
    await assertSucceeds(emp.doc('tasks/t_pr').update({ st: 'wait', img: IMG, sub: Date.now(), doneBy: 'u_emp' }));
  });

  it('מנהל מחזיר לעובד משימה שבוצעה (ושממתינה לאישור): חוזרת ל-open, מופיעה אצל העובד, היעד נשמר', async () => {
    const ret = { st: 'open', open: '1', img: '', sub: 0, doneBy: '', ok: 0, late: '', note: 'לא גמור', rt: '1', cAt: Date.now(), cBy: 'u_mgr' };
    const before0 = await get('t_done_late');
    await assertSucceeds(mgr.doc('tasks/t_done_late').update(ret));
    await assertSucceeds(mgr.doc('tasks/t_wait').update(ret));
    await assertSucceeds(mgr.doc('tasks/t_done').update(ret));
    const after0 = await get('t_done_late');
    if (after0.due !== before0.due) throw new Error('היעד השתנה בהחזרה');
    // העובד רואה אותן שוב (open == '1'), כולל זו שבוצעה בזמן
    await assertSucceeds(emp.doc('tasks/t_done').get());
    const q = await assertSucceeds(emp.collection('tasks').where('open', '==', '1').get());
    for (const id of ['t_done', 't_done_late', 't_wait']) if (!q.docs.some((x) => x.id === id)) throw new Error('המשימה שהוחזרה לא מופיעה אצל העובד: ' + id);
    // היעד עבר – בסימון "בוצע" העובד חייב לסמן איחור
    let n = Date.now();
    await assertFails(emp.doc('tasks/t_done_late').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '' }));
    n = Date.now();
    await assertSucceeds(emp.doc('tasks/t_done_late').update({ st: 'done', open: '', sub: n, ok: n, doneBy: 'u_emp', late: '1' }));
  });

  it('עובד לא מחזיר משימה ל-open בעצמו (לא מ-wait ולא מ-done), ולא מסתיר איחור', async () => {
    const ret = { st: 'open', open: '1', img: '', sub: 0, doneBy: '', ok: 0, late: '', note: '' };
    await assertFails(emp.doc('tasks/t_wait').update(ret));
    await assertFails(emp.doc('tasks/t_wait').update({ st: 'open' }));
    await assertFails(emp.doc('tasks/t_done_late').update(ret));
    await assertFails(emp.doc('tasks/t_done_late').update({ late: '' }));
    await assertFails(emp.doc('tasks/t_done_late').update({ st: 'open', open: '1' }));
    await assertFails(emp.doc('tasks/t_wait').update({ rt: '1' }));
    await assertFails(emp.doc('tasks/t_open').update({ rt: '1' }));
    // עובד לא מחזיר משימה שהוא עצמו העביר להמתנה
    await assertSucceeds(emp.doc('tasks/t_nc').update({ st: 'wait', sub: Date.now(), doneBy: 'u_emp' }));
    await assertFails(emp.doc('tasks/t_nc').update({ st: 'open', sub: 0, doneBy: '' }));
  });

  for (const role of ['signedIn', 'disabledEmployee']) {
    it(`${role}: לא מסמן nc, לא מעביר להמתנה ולא מחזיר`, async () => {
      const d = db(role); const me = H.UID[role];
      await assertFails(d.doc('tasks/t_open').update({ nc: '1' }));
      await assertFails(d.doc('tasks/t_nc').update({ st: 'wait', sub: Date.now(), doneBy: me }));
      await assertFails(d.doc('tasks/t_nc/c/' + fresh('c')).set(comment(me)));
      await assertFails(d.doc('tasks/t_done').update({ st: 'open', open: '1', sub: 0, doneBy: '', ok: 0, late: '' }));
    });
  }
});
