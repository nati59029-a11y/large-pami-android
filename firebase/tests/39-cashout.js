'use strict';
// סגירת קופה – שלב 2 (בקשת בעל העסק 2.11.2026): הוצאות מקופה (cashout) ואישורי הפקדה (deposits, deposits/{id}/p/{k}).
// נתוני הדמו (helpers.seed), כולם של עובד אחר (u_emp2): co1 רגילה, co2 "להפקדה" פתוחה, co3 "להפקדה" שכבר בהפקדה dp1 (ממתינה).

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const MIN = 60000;
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const co = (uid, id, o) => Object.assign({ uid, by: uid, t: Date.now(), reg: 'i_nl', d: '2026-10-20', a: 80, why: 'קניתי ביצים', dep: '', src: id, zc: '', dp: '' }, o);
const dep = (uid, items, o) => Object.assign({ uid, by: uid, t: Date.now(), d: '2026-10-21', items, a: 1000, st: 'new', why: '', np: 1 }, o);

// מילים לבדיקת הזיהוי "צריך אישור הפקדה" (השורש פ-ק-ד במובן הפקדה), זהה באפליקציה (ZDEP) ובכללים (depRe)
const DEP_YES = ['להפקיד', 'הפקדה', 'הופקד', 'מופקד', 'הפקדות', 'הפקיד', 'הפקידה', 'הפקידו', 'הפקדתי', 'הפקדנו', 'הפקדת', 'הופקדה', 'הופקדו', 'מופקדת', 'מופקדים',
  'מפקיד', 'מפקידה', 'אפקיד', 'נפקיד', 'יפקיד', 'יופקד', 'תופקד', 'ולהפקיד', 'להפקדה', 'בהפקדה', 'שהופקד', 'וההפקדה', 'כשהפקדתי', 'מההפקדה',
  'כסף להפקדה בבנק', 'הפקדה: 500', '500 להפקדה', '(הפקדה)', 'הפקדה\nבבנק', 'להפקיד-בנק', 'deposit הפקדה'];
const DEP_NO = ['קניתי חלב', 'פיקדון', 'פקדון בקבוקים', 'החזר פיקדון', 'הפקדון', 'לפקדון', 'תפקיד', 'בתפקיד', 'פקיד', 'פקידה', 'מפקד', 'המפקד', 'מפקדה', 'פקודה',
  'לפקד', 'תפקוד', 'מפקדים', 'הפקק', 'פקדנו', 'ספקים', 'ספק דמה', 'הפקה', 'deposit', ''];

function appZdep() {
  const line = H.appSourceLines().find((l) => l.startsWith('const ZDEP='));
  assert.ok(line, 'ZDEP לא נמצא באפליקציה');
  // eslint-disable-next-line no-new-func
  return new Function('return ' + line.slice('const ZDEP='.length).replace(/;$/, ''))();
}

describe('הוצאות מקופה (cashout) ואישורי הפקדה (deposits)', () => {
  let env, emp, emp2, mgr, out, off;
  const db = (role) => H.ctxFor(env, role).firestore();
  const inbox = (owner, id) => env.withSecurityRulesDisabled((c) => c.firestore().doc('inbox/' + id).set({ owner, by: owner, status: 'new', created: 'x', data: '{}', parts: '1' }));
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => {
    await H.seed(env); emp = db('employee'); mgr = db('manager'); out = db('signedIn'); off = db('disabledEmployee');
    emp2 = env.authenticatedContext(H.OTHER, { email: H.OTHER + '@example.invalid' }).firestore();
  });

  it('זיהוי "צריך הפקדה" באפליקציה (ZDEP): כל מילות פ-ק-ד של הפקדה – כן; פיקדון, תפקיד, פקיד, מפקד – לא', () => {
    const re = appZdep();
    assert.deepEqual(DEP_YES.filter((w) => !re.test(w)), [], 'מילים שלא זוהו');
    assert.deepEqual(DEP_NO.filter((w) => re.test(w)), [], 'מילים שזוהו בטעות');
  });

  it('הכללים: dep חייב להתאים לסיבה, לפי אותה רשימת מילים', async () => {
    for (const w of DEP_YES.concat(DEP_NO.filter(Boolean))) {
      const want = DEP_YES.includes(w) ? '1' : '';
      const id = fresh('w'); await inbox('u_emp', id);
      await assertSucceeds(emp.doc('cashout/' + id).set(co('u_emp', id, { why: w, dep: want })));
      const id2 = fresh('w'); await inbox('u_emp', id2);
      await assertFails(emp.doc('cashout/' + id2).set(co('u_emp', id2, { why: w, dep: want ? '' : '1' })));
    }
  });

  it('עובד יוצר מראה רק להוצאה שלו ב-inbox, בשמו, עם zc ו-dp ריקים; כל הצוות קורא, גם של אחרים', async () => {
    const id = fresh('w'); await inbox('u_emp', id);
    await assertSucceeds(emp.doc('cashout/' + id).set(co('u_emp', id)));
    await assertSucceeds(emp2.doc('cashout/' + id).get());
    await assertSucceeds(emp.doc('cashout/co1').get());
    await assertSucceeds(emp.collection('cashout').where('zc', '==', '').get());
    // בלי inbox, inbox של אחר, src שונה מהמזהה, zc/dp מלאים
    await assertFails(emp.doc('cashout/' + fresh('w')).set(co('u_emp', 'x')));
    const o = fresh('w'); await inbox(H.OTHER, o);
    await assertFails(emp.doc('cashout/' + o).set(co('u_emp', o)));
    const i2 = fresh('w'); await inbox('u_emp', i2);
    await assertFails(emp.doc('cashout/' + i2).set(co('u_emp', 'other')));
    await assertFails(emp.doc('cashout/' + i2).set(co('u_emp', i2, { zc: 'z1' })));
    await assertFails(emp.doc('cashout/' + i2).set(co('u_emp', i2, { dp: 'dp1' })));
    await assertSucceeds(emp.doc('cashout/' + i2).set(co('u_emp', i2)));
    // יצירה חוזרת = עדכון – נחסם
    await assertFails(emp.doc('cashout/' + i2).set(co('u_emp', i2, { a: 1 })));
  });

  it('חסימה: כתיבה בשם אחר (uid או by), וטוקן בלי אימייל', async () => {
    const id = fresh('w'); await inbox('u_emp', id);
    await assertFails(emp.doc('cashout/' + id).set(co(H.OTHER, id)));
    await assertFails(emp.doc('cashout/' + id).set(co('u_emp', id, { by: H.OTHER })));
    await assertFails(emp.doc('cashout/' + id).set(co('u_emp', id, { uid: 'u_mgr' })));
    await assertFails(env.authenticatedContext('u_emp').firestore().doc('cashout/' + id).set(co('u_emp', id)));
    await assertFails(emp.doc('deposits/' + fresh('d')).set(dep(H.OTHER, ['co2'])));
    await assertFails(emp.doc('deposits/' + fresh('d')).set(dep('u_emp', ['co2'], { by: H.OTHER })));
    await assertFails(mgr.doc('cashout/' + fresh('m')).set(co('u_mgr', 'tx', { by: 'u_emp' })));
  });

  it('יצירה: קופה מוכרת, תאריך תקין, סכום מספר חיובי עד 1,000,000, סיבה 1–300, זמן עכשיו, רק השדות של האפליקציה', async () => {
    const c = async (o) => { const id = fresh('w'); await inbox('u_emp', id); return emp.doc('cashout/' + id).set(co('u_emp', id, o)); };
    await assertSucceeds(c({ reg: 'i_yh' }));
    await assertFails(c({ reg: 'e_sup' }));
    await assertFails(c({ d: '20/10/2026' }));
    await assertFails(c({ d: '2026-13-01' }));
    await assertFails(c({ a: 0 }));
    await assertFails(c({ a: -5 }));
    await assertFails(c({ a: '80' }));
    await assertFails(c({ a: 1000000.01 }));
    await assertSucceeds(c({ a: 1000000 }));
    await assertSucceeds(c({ a: 0.01 }));
    await assertFails(c({ why: '' }));
    await assertFails(c({ why: 'א'.repeat(301) }));
    await assertSucceeds(c({ why: 'א'.repeat(300) }));
    await assertFails(c({ dep: 'yes' }));
    await assertFails(c({ t: Date.now() - 10 * MIN }));
    await assertFails(c({ extra: '1' }));
    const id = fresh('w'); await inbox('u_emp', id);
    const x = co('u_emp', id); delete x.zc;
    await assertFails(emp.doc('cashout/' + id).set(x));
  });

  it('חסימה: עובד לא משנה סכום, סיבה, קופה, תאריך או שיוך לסגירה (zc), ולא מוחק – גם הוצאה שלו', async () => {
    const id = fresh('w'); await inbox('u_emp', id);
    await assertSucceeds(emp.doc('cashout/' + id).set(co('u_emp', id)));
    for (const o of [{ a: 1 }, { why: 'אחר' }, { reg: 'i_yh' }, { d: '2026-10-01' }, { zc: 'z1' }, { dep: '1' }])
      await assertFails(emp.doc('cashout/' + id).update(o));
    await assertFails(emp.doc('cashout/co1').update({ zc: 'z1' }));
    await assertFails(emp.doc('cashout/co1').update({ a: 1 }));
    await assertFails(emp.doc('cashout/' + id).delete());
    await assertFails(emp.doc('cashout/co1').delete());
  });

  it('עובד מסמן dp רק בהפקדה שלו שנשלחת באותו batch, שכוללת את ההוצאה, ורק מריק', async () => {
    const d1 = fresh('d'), b = emp.batch();
    b.set(emp.doc('deposits/' + d1), dep('u_emp', ['co2']));
    b.update(emp.doc('cashout/co2'), { dp: d1 });
    await assertSucceeds(b.commit());
    // כבר מסומן – לא משנים
    const d2 = fresh('d'), b2 = emp.batch();
    b2.set(emp.doc('deposits/' + d2), dep('u_emp', ['co2']));
    b2.update(emp.doc('cashout/co2'), { dp: d2 });
    await assertFails(b2.commit());
    await assertFails(emp.doc('cashout/co2').update({ dp: '' }));
  });

  it('חסימה: עובד מסמן dp להפקדה של אחר, להפקדה שלא כוללת את ההוצאה, לפקדון שלא קיים, או בהוצאה שלא צריכה הפקדה', async () => {
    await assertFails(emp.doc('cashout/co2').update({ dp: 'dp1' })); // של עובד אחר
    const d1 = fresh('d'), b = emp.batch();
    b.set(emp.doc('deposits/' + d1), dep('u_emp', ['co1']));
    b.update(emp.doc('cashout/co2'), { dp: d1 }); // לא כוללת את co2
    await assertFails(b.commit());
    await assertFails(emp.doc('cashout/co2').update({ dp: fresh('none') }));
    const d2 = fresh('d'), b2 = emp.batch();
    b2.set(emp.doc('deposits/' + d2), dep('u_emp', ['co1']));
    b2.update(emp.doc('cashout/co1'), { dp: d2 }); // co1 לא "להפקדה"
    await assertFails(b2.commit());
    // הפקדה ישנה של העובד (יותר מ-15 דקות) – לא משמשת לסימון
    const d3 = fresh('d');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('deposits/' + d3).set(dep('u_emp', ['co2'], { t: Date.now() - 16 * MIN })));
    await assertFails(emp.doc('cashout/co2').update({ dp: d3 }));
    // הפקדה שנדחתה – לא משמשת לסימון
    const d4 = fresh('d');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('deposits/' + d4).set(dep('u_emp', ['co2'], { st: 'rej' })));
    await assertFails(emp.doc('cashout/co2').update({ dp: d4 }));
    // סימון יחד עם שינוי שדה אחר
    const d5 = fresh('d'), b5 = emp.batch();
    b5.set(emp.doc('deposits/' + d5), dep('u_emp', ['co2']));
    b5.update(emp.doc('cashout/co2'), { dp: d5, a: 1 });
    await assertFails(b5.commit());
  });

  it('מנהל: מעדכן רק zc ו-dp (כולל החזרה לריק), מוחק; לא משנה סכום', async () => {
    await assertSucceeds(mgr.doc('cashout/co1').update({ zc: 'z1' }));
    await assertSucceeds(mgr.doc('cashout/co3').update({ dp: '' }));
    await assertFails(mgr.doc('cashout/co1').update({ a: 1 }));
    await assertFails(mgr.doc('cashout/co1').update({ zc: '../x' }));
    await assertSucceeds(mgr.doc('cashout/co1').delete());
  });

  it('דחיית הפקדה: סטטוס rej ו-dp חוזר לריק באותו batch; אחרי זה עובד יכול להפקיד שוב', async () => {
    const b = mgr.batch();
    b.update(mgr.doc('deposits/dp1'), { st: 'rej', stBy: 'u_mgr', stAt: Date.now(), note: 'לא תואם' });
    b.update(mgr.doc('cashout/co3'), { dp: '' });
    await assertSucceeds(b.commit());
    const d1 = fresh('d'), b2 = emp.batch();
    b2.set(emp.doc('deposits/' + d1), dep('u_emp', ['co3'], { a: 300 }));
    b2.update(emp.doc('cashout/co3'), { dp: d1 });
    await assertSucceeds(b2.commit());
  });

  it('הפקדות: יצירה רק בסטטוס new, 1–30 הוצאות, סכום מספר עד 1,000,000, תאריך תקין, np 1–8; עובד לא מעדכן ולא מוחק', async () => {
    const c = (o, items) => emp.doc('deposits/' + fresh('d')).set(dep('u_emp', items || ['co2'], o));
    await assertSucceeds(c({}));
    await assertSucceeds(c({}, Array.from({ length: 30 }, (_, i) => 'c' + i)));
    await assertFails(c({}, Array.from({ length: 31 }, (_, i) => 'c' + i)));
    await assertFails(c({}, []));
    await assertFails(c({ items: 'co2' }));
    await assertFails(c({ st: 'ok' }));
    await assertFails(c({ st: 'rej' }));
    await assertFails(c({ a: 0 }));
    await assertFails(c({ a: '1000' }));
    await assertFails(c({ a: 1000001 }));
    await assertFails(c({ d: '2026-02-30x' }));
    await assertFails(c({ np: 0 }));
    await assertFails(c({ np: 9 }));
    await assertFails(c({ why: 'א'.repeat(501) }));
    await assertFails(c({ t: Date.now() + 10 * MIN }));
    await assertFails(c({ stBy: 'u_emp' }));
    await assertFails(emp.doc('deposits/dp1').update({ st: 'ok' }));
    await assertFails(emp.doc('deposits/dp1').delete());
    const id = fresh('d');
    await assertSucceeds(emp.doc('deposits/' + id).set(dep('u_emp', ['co2'])));
    await assertFails(emp.doc('deposits/' + id).update({ a: 1 }));
    await assertFails(emp.doc('deposits/' + id).update({ st: 'ok', stBy: 'u_emp', stAt: Date.now(), note: '' }));
    await assertSucceeds(emp.doc('deposits/dp1').get());
    // מנהל: רק שדות הסטטוס
    await assertSucceeds(mgr.doc('deposits/dp1').update({ st: 'ok', stBy: 'u_mgr', stAt: Date.now(), note: '' }));
    await assertFails(mgr.doc('deposits/dp1').update({ a: 5 }));
    await assertFails(mgr.doc('deposits/dp1').update({ st: 'done', stBy: 'u_mgr', stAt: Date.now(), note: '' }));
  });

  it('צילומי הפקדה: רק מי ששלח, חלק שהוכרז, ב-15 דקות; העובד לא קורא ולא מעדכן', async () => {
    const id = fresh('d');
    await assertSucceeds(emp.doc('deposits/' + id).set(dep('u_emp', ['co2'], { np: 2 })));
    await assertSucceeds(emp.doc('deposits/' + id + '/p/0').set({ data: 'A'.repeat(700000) }));
    await assertSucceeds(emp.doc('deposits/' + id + '/p/1').set({ data: 'AAAA' }));
    await assertFails(emp.doc('deposits/' + id + '/p/2').set({ data: 'AAAA' }));
    await assertFails(emp.doc('deposits/' + id + '/p/0').set({ data: 'BBBB' }));
    await assertFails(emp.doc('deposits/' + id + '/p/0').get());
    await assertFails(emp2.doc('deposits/' + id + '/p/1').set({ data: 'AAAA' }));
    const old = fresh('d');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('deposits/' + old).set(dep('u_emp', ['co2'], { t: Date.now() - 16 * MIN })));
    await assertFails(emp.doc('deposits/' + old + '/p/0').set({ data: 'AAAA' }));
    await assertSucceeds(mgr.doc('deposits/' + id + '/p/0').get());
    await assertSucceeds(mgr.doc('deposits/' + id + '/p/0').delete());
  });

  it('חסימה: מחובר שאינו ב-staff ועובד מושבת – לא קוראים, לא יוצרים, לא מסמנים', async () => {
    for (const x of [out, off]) {
      await assertFails(x.doc('cashout/co1').get());
      await assertFails(x.collection('cashout').where('zc', '==', '').get());
      await assertFails(x.doc('deposits/dp1').get());
      await assertFails(x.doc('cashout/co2').update({ dp: 'dp1' }));
    }
    for (const [x, u] of [[out, 'u_out'], [off, 'u_off']]) {
      const id = fresh('w'); await inbox(u, id);
      await assertFails(x.doc('cashout/' + id).set(co(u, id)));
      const d1 = fresh('d'), b = x.batch();
      b.set(x.doc('deposits/' + d1), dep(u, ['co2']));
      b.update(x.doc('cashout/co2'), { dp: d1 });
      await assertFails(b.commit());
      await assertFails(x.doc('deposits/' + fresh('d')).set(dep(u, ['co2'])));
    }
    // הפקדה שנשלחה לפני שהעובד הושבת – כבר אי אפשר להעלות אליה צילומים
    const id = fresh('d');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('deposits/' + id).set(dep('u_off', ['co2'], { np: 2 })));
    await assertFails(off.doc('deposits/' + id + '/p/0').set({ data: 'AAAA' }));
  });
});
