'use strict';
// סגירת קופה (closings/{id}) וחלקי הצילומים (closings/{id}/p/{k}).
// בקשת בעל העסק 2.11.2026 (שלב 1): עובד שולח דוח Z והצהרת פתיחה, והנתונים הכספיים נשמרים רק אצל המנהל.
// לכן העובד רק יוצר (בשמו, בסטטוס 'new') ולא קורא כלום – גם לא את מה ששלח. רק המנהל קורא, משנה סטטוס ומוחק.
// נתוני הדמו (helpers.seed): closings/z1 של עובד אחר (u_emp2) עם חלק צילומים אחד p/0.

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const MIN = 60000;
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const cl = (uid, o) => Object.assign({ uid, by: uid, t: Date.now(), st: 'new', np: 1, reg: 'i_nl', d: '2026-10-20', no: '555', data: '{"v":1,"f":{"cash":"60.10"}}' }, o);
const status = (me, o) => Object.assign({ st: 'ok', stBy: me, stAt: Date.now(), note: '' }, o);

describe('סגירת קופה (closings)', () => {
  let env, emp, emp2, mgr, out, off;
  const db = (role) => H.ctxFor(env, role).firestore();
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => {
    await H.seed(env); emp = db('employee'); mgr = db('manager'); out = db('signedIn'); off = db('disabledEmployee');
    emp2 = env.authenticatedContext(H.OTHER, { email: H.OTHER + '@example.invalid' }).firestore();
  });

  it('עובד שולח סגירה בשמו בסטטוס "new"; מנהל שולח גם בסטטוס "ok" (סגירה שהכניס בעצמו)', async () => {
    await assertSucceeds(emp.doc('closings/' + fresh('z')).set(cl('u_emp', { by: 'U_Emp' })));
    await assertSucceeds(mgr.doc('closings/' + fresh('z')).set(cl('u_mgr', { st: 'ok' })));
    await assertSucceeds(mgr.doc('closings/' + fresh('z')).set(cl('u_mgr')));
    await assertFails(emp.doc('closings/' + fresh('z')).set(cl('u_emp', { st: 'ok' })));
    await assertFails(emp.doc('closings/' + fresh('z')).set(cl('u_emp', { st: 'rej' })));
  });

  it('חסימה: עובד לא קורא סגירות – לא של אחר, לא את שלו, ולא רשימה', async () => {
    const id = fresh('z');
    await assertSucceeds(emp.doc('closings/' + id).set(cl('u_emp')));
    await assertFails(emp.doc('closings/' + id).get());
    await assertFails(emp.doc('closings/z1').get());
    await assertFails(emp.collection('closings').get());
    await assertFails(emp.collection('closings').where('uid', '==', 'u_emp').get());
    await assertFails(emp.doc('closings/z1/p/0').get());
    await assertFails(emp2.doc('closings/z1').get());
    await assertSucceeds(mgr.doc('closings/' + id).get());
    await assertSucceeds(mgr.collection('closings').where('st', '==', 'new').get());
  });

  it('חסימה: עובד לא מעדכן ולא מוחק – גם סגירה שלו', async () => {
    const id = fresh('z');
    await assertSucceeds(emp.doc('closings/' + id).set(cl('u_emp')));
    await assertFails(emp.doc('closings/' + id).update(status('u_emp')));
    await assertFails(emp.doc('closings/' + id).update({ data: '{"v":1,"f":{"cash":"9999"}}' }));
    await assertFails(emp.doc('closings/' + id).set(cl('u_emp', { no: '556' })));
    await assertFails(emp.doc('closings/' + id).delete());
    await assertFails(emp.doc('closings/z1').update(status('u_emp')));
    await assertFails(emp.doc('closings/z1').delete());
  });

  it('חסימה: עובד לא כותב בשם אחר (uid או by), וטוקן בלי אימייל נחסם', async () => {
    await assertFails(emp.doc('closings/' + fresh('z')).set(cl(H.OTHER)));
    await assertFails(emp.doc('closings/' + fresh('z')).set(cl('u_emp', { by: H.OTHER })));
    await assertFails(emp.doc('closings/' + fresh('z')).set(cl('u_emp', { by: 'u_mgr' })));
    await assertFails(emp.doc('closings/' + fresh('z')).set(cl('u_emp', { uid: 'u_mgr' })));
    await assertFails(mgr.doc('closings/' + fresh('z')).set(cl('u_mgr', { by: 'u_emp' })));
    await assertFails(env.authenticatedContext('u_emp').firestore().doc('closings/' + fresh('z')).set(cl('u_emp')));
  });

  it('חסימה: מחובר שאינו ב-staff ועובד מושבת – לא יוצרים, לא קוראים ולא מעלים צילומים', async () => {
    await assertFails(out.doc('closings/' + fresh('z')).set(cl('u_out')));
    await assertFails(off.doc('closings/' + fresh('z')).set(cl('u_off')));
    await assertFails(out.doc('closings/z1').get());
    await assertFails(off.doc('closings/z1').get());
    await assertFails(off.collection('closings').get());
    // סגירה שנשלחה לפני שהעובד הושבת: כבר אי אפשר להעלות אליה צילומים
    const id = fresh('z');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('closings/' + id).set(cl('u_off', { np: 2 })));
    await assertFails(off.doc('closings/' + id + '/p/0').set({ data: 'AAAA' }));
  });

  it('יצירה: רק השדות שהאפליקציה כותבת, קופה מוכרת, תאריך תקין, זמן עכשיו, np בין 1 ל-8, data עד 20,000 תווים', async () => {
    const c = (o) => emp.doc('closings/' + fresh('z')).set(cl('u_emp', o));
    await assertSucceeds(c({ reg: 'i_yh' }));
    await assertFails(c({ reg: 'i_cnl' }));
    await assertFails(c({ reg: 'e_sup' }));
    await assertFails(c({ d: '20/10/2026' }));
    await assertFails(c({ d: 20261020 }));
    await assertFails(c({ d: '2026-13-01' }));
    await assertFails(c({ d: '2026-00-10' }));
    await assertFails(c({ d: '2026-10-32' }));
    await assertFails(c({ d: '2026-10-00' }));
    await assertSucceeds(c({ d: '2026-12-31' }));
    await assertFails(c({ t: Date.now() - 10 * MIN }));
    await assertFails(c({ t: Date.now() + 10 * MIN }));
    await assertFails(c({ np: 0 }));
    await assertFails(c({ np: 9 }));
    await assertFails(c({ np: '1' }));
    await assertSucceeds(c({ np: 8 }));
    await assertFails(c({ no: '1'.repeat(31) }));
    await assertSucceeds(c({ data: 'א'.repeat(20000) }));
    await assertFails(c({ data: 'א'.repeat(20001) }));
    await assertFails(c({ stBy: 'u_emp' }));
    await assertFails(c({ note: 'x' }));
    await assertFails(c({ amt: 7404.15 }));
    await assertFails(emp.doc('closings/' + fresh('z')).set({ uid: 'u_emp', by: 'u_emp', t: Date.now(), st: 'new' }));
  });

  it('מנהל משנה סטטוס – רק שדות הסטטוס, בשמו ובזמן אמת, עם הערה עד 300 תווים; הסכומים לא משתנים', async () => {
    for (const st of ['ok', 'rej', 'new']) await assertSucceeds(mgr.doc('closings/z1').update(status('u_mgr', { st })));
    await assertSucceeds(mgr.doc('closings/z1').update(status('u_mgr', { st: 'rej', note: 'א'.repeat(300) })));
    await assertFails(mgr.doc('closings/z1').update(status('u_mgr', { note: 'א'.repeat(301) })));
    await assertFails(mgr.doc('closings/z1').update(status('u_mgr', { st: 'done' })));
    await assertFails(mgr.doc('closings/z1').update(status('u_mgr', { stBy: 'u_emp' })));
    await assertFails(mgr.doc('closings/z1').update(status('u_mgr', { stAt: Date.now() - 10 * MIN })));
    await assertFails(mgr.doc('closings/z1').update(status('u_mgr', { data: '{"v":1,"f":{"cash":"1"}}' })));
    await assertFails(mgr.doc('closings/z1').update({ reg: 'i_yh' }));
    await assertSucceeds(mgr.doc('closings/z1').delete());
  });

  it('צילומים: רק מי ששלח, רק חלק שהוכרז, רק ב-15 דקות; העובד לא קורא ולא מעדכן; מנהל קורא ומוחק', async () => {
    const id = fresh('z');
    await assertSucceeds(emp.doc('closings/' + id).set(cl('u_emp', { np: 2 })));
    await assertSucceeds(emp.doc('closings/' + id + '/p/0').set({ data: 'A'.repeat(700000) }));
    await assertSucceeds(emp.doc('closings/' + id + '/p/1').set({ data: 'AAAA' }));
    await assertFails(emp.doc('closings/' + id + '/p/2').set({ data: 'AAAA' }));
    await assertFails(emp.doc('closings/' + id + '/p/x').set({ data: 'AAAA' }));
    await assertFails(emp.doc('closings/' + id + '/p/0').set({ data: 'BBBB' }));
    await assertFails(emp.doc('closings/' + id + '/p/0').get());
    await assertFails(emp.doc('closings/' + id + '/p/0').delete());
    await assertFails(emp2.doc('closings/' + id + '/p/1').set({ data: 'AAAA' }));
    await assertFails(emp.doc('closings/z1/p/1').set({ data: 'AAAA' }));
    await assertFails(emp.doc('closings/' + fresh('none') + '/p/0').set({ data: 'AAAA' }));
    const idOld = fresh('z');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('closings/' + idOld).set(cl('u_emp', { np: 2, t: Date.now() - 16 * MIN })));
    await assertFails(emp.doc('closings/' + idOld + '/p/0').set({ data: 'AAAA' }));
    const id2 = fresh('z');
    await assertSucceeds(emp.doc('closings/' + id2).set(cl('u_emp')));
    await assertFails(emp.doc('closings/' + id2 + '/p/0').set({ data: 'AAAA', extra: '1' }));
    await assertFails(emp.doc('closings/' + id2 + '/p/0').set({ data: 'A'.repeat(700001) }));
    await assertSucceeds(mgr.doc('closings/' + id + '/p/0').get());
    await assertFails(mgr.doc('closings/' + id + '/p/0').set({ data: 'CCCC' }));
    await assertSucceeds(mgr.doc('closings/' + id + '/p/0').delete());
  });
});
