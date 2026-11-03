'use strict';
// בקשות לעדכון האפליקציה (appreq/{id}) וחלקי התמונות (appreq/{id}/p/{k}).
// בקשת בעל העסק 2.11.2026: עובד ומנהל כותבים בקשה (טקסט ותמונות), כל הצוות רואה את כל הבקשות,
// ורק מנהל משנה סטטוס (חדש / בטיפול / טופל / נדחה) ומוחק. העובד לא עורך ולא מוחק אחרי השליחה.
// נתוני הדמו (helpers.seed): appreq/r1 של עובד אחר (u_emp2) עם חלק תמונה אחד p/0.

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const MIN = 60000;
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const req = (uid, o) => Object.assign({ uid, by: uid, txt: 'הכפתור לא עובד', t: Date.now(), st: 'new', np: 0 }, o);
const status = (me, o) => Object.assign({ st: 'doing', stBy: me, stAt: Date.now(), note: '' }, o);

describe('בקשות לעדכון האפליקציה (appreq)', () => {
  let env, emp, emp2, mgr;
  const db = (role) => H.ctxFor(env, role).firestore();
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); emp = db('employee'); mgr = db('manager'); emp2 = env.authenticatedContext(H.OTHER, { email: H.OTHER + '@example.invalid' }).firestore(); });

  it('עובד ומנהל יוצרים בקשה בשמם; כל הצוות רואה את כל הבקשות (גם של עובד אחר)', async () => {
    const id = fresh('r');
    await assertSucceeds(emp.doc('appreq/' + id).set(req('u_emp', { by: 'U_Emp' })));
    await assertSucceeds(mgr.doc('appreq/' + fresh('r')).set(req('u_mgr')));
    await assertSucceeds(emp2.doc('appreq/' + id).get());
    const all = await assertSucceeds(emp2.collection('appreq').get());
    if (all.size < 3) throw new Error('עובד אחר צריך לראות את כל הבקשות, התקבלו ' + all.size);
    await assertSucceeds(emp.doc('appreq/r1').get());
  });

  it('עובד לא כותב בשם אחר (uid או by), וטוקן בלי אימייל נחסם', async () => {
    await assertFails(emp.doc('appreq/' + fresh('r')).set(req(H.OTHER)));
    await assertFails(emp.doc('appreq/' + fresh('r')).set(req('u_emp', { by: H.OTHER })));
    await assertFails(emp.doc('appreq/' + fresh('r')).set(req('u_emp', { by: 'u_mgr' })));
    await assertFails(emp.doc('appreq/' + fresh('r')).set(req('u_emp', { uid: 'u_mgr' })));
    await assertFails(mgr.doc('appreq/' + fresh('r')).set(req('u_mgr', { by: 'u_emp' })));
    await assertFails(env.authenticatedContext('u_emp').firestore().doc('appreq/' + fresh('r')).set(req('u_emp')));
  });

  it('יצירה: רק בסטטוס "חדש", בלי שדות סטטוס, טקסט 1–2000, זמן עכשיו, np בין 0 ל-8', async () => {
    const c = (o) => emp.doc('appreq/' + fresh('r')).set(req('u_emp', o));
    for (const st of ['doing', 'done', 'rej', '']) await assertFails(c({ st }));
    await assertFails(c({ stBy: 'u_emp' }));
    await assertFails(c({ stAt: Date.now() }));
    await assertFails(c({ note: 'טופל' }));
    await assertFails(c({ extra: 1 }));
    await assertFails(c({ txt: '' }));
    await assertFails(c({ txt: 'א'.repeat(2001) }));
    await assertSucceeds(c({ txt: 'א'.repeat(2000) }));
    await assertFails(c({ t: Date.now() - 10 * MIN }));
    await assertFails(c({ t: Date.now() + 10 * MIN }));
    await assertFails(c({ np: 9 }));
    await assertFails(c({ np: -1 }));
    await assertFails(c({ np: '1' }));
    await assertSucceeds(c({ np: 8 }));
    await assertFails(emp.doc('appreq/' + fresh('r')).set({ uid: 'u_emp', by: 'u_emp', txt: 'חסרים שדות' }));
  });

  it('עובד לא משנה סטטוס, לא עורך ולא מוחק – גם בבקשה שלו', async () => {
    const id = fresh('r');
    await assertSucceeds(emp.doc('appreq/' + id).set(req('u_emp')));
    await assertFails(emp.doc('appreq/' + id).update(status('u_emp')));
    await assertFails(emp.doc('appreq/' + id).update({ st: 'done' }));
    await assertFails(emp.doc('appreq/' + id).update({ txt: 'שונה' }));
    await assertFails(emp.doc('appreq/' + id).set(req('u_emp', { txt: 'שונה' })));
    await assertFails(emp.doc('appreq/' + id).delete());
    await assertFails(emp.doc('appreq/r1').update(status('u_emp')));
    await assertFails(emp.doc('appreq/r1').delete());
  });

  it('מנהל משנה סטטוס – רק שדות הסטטוס, בשמו ובזמן אמת, עם הערה עד 300 תווים', async () => {
    for (const st of ['doing', 'done', 'rej', 'new']) await assertSucceeds(mgr.doc('appreq/r1').update(status('u_mgr', { st })));
    await assertSucceeds(mgr.doc('appreq/r1').update(status('u_mgr', { st: 'done', note: 'א'.repeat(300) })));
    await assertFails(mgr.doc('appreq/r1').update(status('u_mgr', { note: 'א'.repeat(301) })));
    await assertFails(mgr.doc('appreq/r1').update(status('u_mgr', { st: 'closed' })));
    await assertFails(mgr.doc('appreq/r1').update(status('u_mgr', { stBy: 'u_emp' })));
    await assertFails(mgr.doc('appreq/r1').update(status('u_mgr', { stAt: Date.now() - 10 * MIN })));
    await assertFails(mgr.doc('appreq/r1').update(status('u_mgr', { txt: 'שונה' })));
    await assertFails(mgr.doc('appreq/r1').update({ txt: 'שונה' }));
    await assertFails(mgr.doc('appreq/r1').update(status('u_mgr', { uid: 'u_mgr' })));
    await assertSucceeds(mgr.doc('appreq/r1').delete());
  });

  it('תמונות: רק מי שיצר את הבקשה, רק חלק שהוכרז ב-np, עד 700,000 תווים, בלי עדכון; כולם קוראים, מנהל מוחק', async () => {
    const id = fresh('r');
    await assertSucceeds(emp.doc('appreq/' + id).set(req('u_emp', { np: 2 })));
    await assertSucceeds(emp.doc('appreq/' + id + '/p/0').set({ data: 'A'.repeat(700000) }));
    await assertFails(emp.doc('appreq/' + id + '/p/1').set({ data: 'A'.repeat(700001) }));
    await assertSucceeds(emp.doc('appreq/' + id + '/p/1').set({ data: 'BBBB' }));
    await assertFails(emp.doc('appreq/' + id + '/p/2').set({ data: 'CCCC' })); // מעבר ל-np
    await assertFails(emp.doc('appreq/' + id + '/p/x').set({ data: 'CCCC' }));
    await assertFails(emp.doc('appreq/' + id + '/p/1').set({ data: 'שונה' })); // אין עריכה
    await assertFails(emp.doc('appreq/' + id + '/p/1').update({ data: 'שונה' }));
    await assertFails(emp2.doc('appreq/' + id + '/p/1').set({ data: 'BBBB' }));
    await assertFails(mgr.doc('appreq/' + id + '/p/1').set({ data: 'BBBB' }));
    await assertFails(emp.doc('appreq/r1/p/1').set({ data: 'BBBB' })); // בקשה של אחר
    await assertFails(emp.doc('appreq/no_such/p/0').set({ data: 'BBBB' }));
    // שדות נוספים
    const id2 = fresh('r');
    await assertSucceeds(emp.doc('appreq/' + id2).set(req('u_emp', { np: 1 })));
    await assertFails(emp.doc('appreq/' + id2 + '/p/0').set({ data: 'AAAA', extra: 1 }));
    // קריאה ומחיקה
    await assertSucceeds(emp2.doc('appreq/' + id + '/p/0').get());
    await assertSucceeds(emp.doc('appreq/r1/p/0').get());
    await assertFails(emp.doc('appreq/' + id + '/p/0').delete());
    await assertSucceeds(mgr.doc('appreq/' + id + '/p/0').delete());
  });

  it('תמונות: אחרי 15 דקות מהשליחה אי אפשר להוסיף חלק (אין עריכה מאוחרת)', async () => {
    const id = fresh('r');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('appreq/' + id).set(req('u_emp', { np: 1, t: Date.now() - 16 * MIN })));
    await assertFails(emp.doc('appreq/' + id + '/p/0').set({ data: 'AAAA' }));
  });

  for (const role of ['signedIn', 'disabledEmployee', 'guest']) {
    it(`${role}: נחסם בכל פעולה על בקשות ותמונות`, async () => {
      const d = db(role); const me = H.UID[role] || 'nobody';
      await assertFails(d.doc('appreq/r1').get());
      await assertFails(d.collection('appreq').get());
      await assertFails(d.doc('appreq/' + fresh('r')).set(req(me)));
      await assertFails(d.doc('appreq/r1').update(status(me)));
      await assertFails(d.doc('appreq/r1').delete());
      await assertFails(d.doc('appreq/r1/p/0').get());
      await assertFails(d.doc('appreq/r1/p/1').set({ data: 'AAAA' }));
      await assertFails(d.doc('appreq/r1/p/0').delete());
    });
  }

  it('עובד מושבת לא יוצר חלק תמונה גם לבקשה שנוצרה בשמו לפני ההשבתה', async () => {
    const id = fresh('r');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('appreq/' + id).set(req('u_off', { np: 1 })));
    await assertFails(db('disabledEmployee').doc('appreq/' + id + '/p/0').set({ data: 'AAAA' }));
  });
});
