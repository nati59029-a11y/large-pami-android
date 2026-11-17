'use strict';
// סבב 2, חבילה א' (17.11.2026):
// 1. סף פער מזומן משותף – cfg/zc (thr). קריאה וכתיבה: מנהל בלבד. עובד / מושבת / מחובר בלי תפקיד – נחסמים.
//    רשימת cfg (list) – מנהל בלבד (העובד לא יכול לעקוף את החסימה של cfg/zc ברשימה). cfg/main ו-cfg/tkw לעובד – כמו קודם (get).
// 2. תמונות בבקשות למנהל – rq/{id}/p/r1..r3 (np בבקשה) ו-rq/{id}/c/{cid}/p/1..3 (np בתגובה). גישה רק לבעל הבקשה ולמנהל,
//    רק data:image (jpeg/png/webp) ב-base64, 100 עד 900,000 תווים, בשם המשתמש ובזמן אמת. מנהל – תמונה אחת לתגובה.
// כל בדיקה רצה פעמיים: בשורש, ובתוך b/bt (עסק עם התוספת tasks; bx = עסק אחר).

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const { fsx, sv } = H;

const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(500);
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const iv = (v) => ({ integerValue: String(Math.round(+v || 0)) });
const dv = (v) => ({ doubleValue: +v });

const ENVS = [
  { name: 'שורש', P: '', mgr: 'u_mgr', e1: 'u_emp', e2: H.OTHER, off: 'u_off', out: 'u_out', foreign: null },
  { name: 'עסק b/bt', P: 'b/bt/', mgr: 'bt_mgr', e1: 'bt_e1', e2: 'bt_e2', off: 'bt_off', out: 'u_out', foreign: 'bx_mgr' },
];

for (const E of ENVS) {
  describe(`סף משותף ותמונות בבקשות – ${E.name}`, () => {
    let env;
    const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
    const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
    const R = (p) => E.P + p;
    const rq = (owner, o) => Object.assign({ owner, by: owner, txt: 'בקשה', t: Date.now(), st: 'new', ans: '' }, o);
    const cm = (uid, o) => Object.assign({ uid, by: uid, txt: 'תגובה', t: Date.now() }, o);
    const photo = (uid, o) => Object.assign({ img: IMG, t: Date.now(), uid }, o);

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
          b.set(d.doc('b/bt/staff/bt_off'), { name: 'bt_off', role: 'employee', active: false });
          b.set(d.doc('b/bt/cfg/main'), { data: '{}' });
        }
        b.set(d.doc(R('cfg/zc')), { thr: 50, by: E.mgr, at: Date.now() });
        b.set(d.doc(R('rq/q1')), rq(E.e1, { np: 2 }));
        b.set(d.doc(R('rq/q1/p/r1')), photo(E.e1));
        b.set(d.doc(R('rq/q1/c/cw')), cm(E.e1, { np: 3 }));
        b.set(d.doc(R('rq/q1/c/cw/p/1')), photo(E.e1));
        b.set(d.doc(R('rq/q1/c/cm')), cm(E.mgr, { np: 1 }));
        b.set(d.doc(R('rq/q1/c/c0')), cm(E.e1));
        b.set(d.doc(R('rq/q2')), rq(E.e2, { np: 1 }));
        b.set(d.doc(R('rq/q2/p/r1')), photo(E.e2));
        b.set(d.doc(R('rq/qold')), rq(E.e1)); // בקשה ישנה, בלי np
        await b.commit();
      });
    });

    // ---------- 1. סף משותף ----------
    it('cfg/zc: מנהל קורא; עובד, עובד מושבת, מחובר בלי תפקיד ומנהל של עסק אחר – נחסמים', async () => {
      await assertSucceeds(fs(E.mgr).doc(R('cfg/zc')).get());
      for (const u of [E.e1, E.off, E.out]) await assertFails(fs(u).doc(R('cfg/zc')).get());
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('cfg/zc')).get());
      // שאר מסמכי cfg לעובד – כמו קודם (get)
      await assertSucceeds(fs(E.e1).doc(R('cfg/main')).get());
    });

    it('cfg (list): מנהל – כן; עובד – לא (כדי שלא יקרא את cfg/zc ברשימה)', async () => {
      await assertSucceeds(fs(E.mgr).collection(R('cfg')).get());
      await assertFails(fs(E.e1).collection(R('cfg')).get());
      await assertFails(fs(E.off).collection(R('cfg')).get());
    });

    it('cfg/zc: כתיבה – מנהל בלבד, רק thr מספר 0..1,000,000 (+by, at); עובד וזר – נחסמים', async () => {
      const m = fs(E.mgr);
      await assertSucceeds(m.doc(R('cfg/zc')).set({ thr: 80, by: E.mgr, at: Date.now() }));
      await assertSucceeds(m.doc(R('cfg/zc')).set({ thr: 0 }));
      await assertSucceeds(m.doc(R('cfg/zc')).set({ thr: 12.5 }));
      await assertFails(m.doc(R('cfg/zc')).set({ thr: -1 }));
      await assertFails(m.doc(R('cfg/zc')).set({ thr: 1000001 }));
      await assertFails(m.doc(R('cfg/zc')).set({ thr: '50' }));
      await assertFails(m.doc(R('cfg/zc')).set({ by: E.mgr }));
      await assertFails(m.doc(R('cfg/zc')).set({ thr: 50, x: 1 }));
      await assertFails(m.doc(R('cfg/zc')).set({ thr: 50, at: 'היום' }));
      for (const u of [E.e1, E.off, E.out]) await assertFails(fs(u).doc(R('cfg/zc')).set({ thr: 0 }));
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('cfg/zc')).set({ thr: 0 }));
      await assertFails(fs(E.e1).doc(R('cfg/zc')).delete());
      await assertSucceeds(m.doc(R('cfg/zc')).delete());
      // cfg/main לא הושפע: מנהל כותב כמו קודם, עובד לא
      await assertSucceeds(m.doc(R('cfg/main')).set({ data: '{}' }));
      await assertFails(fs(E.e1).doc(R('cfg/main')).set({ data: '{}' }));
    });

    // ---------- 2. np בבקשה ובתגובה ----------
    it('rq: יצירה עם np 0..3 (וגם בלי np – כמו קודם); np לא חוקי – נחסם', async () => {
      const e = fs(E.e1);
      await assertSucceeds(e.doc(R('rq/' + fresh('q'))).set(rq(E.e1)));
      for (const np of [0, 1, 2, 3]) await assertSucceeds(e.doc(R('rq/' + fresh('q'))).set(rq(E.e1, { np })));
      await assertFails(e.doc(R('rq/' + fresh('q'))).set(rq(E.e1, { np: 4 })));
      await assertFails(e.doc(R('rq/' + fresh('q'))).set(rq(E.e1, { np: -1 })));
      await assertFails(e.doc(R('rq/' + fresh('q'))).set(rq(E.e1, { np: '2' })));
      // הבעלים לא משנה np אחר כך
      await assertFails(e.doc(R('rq/q1')).update({ np: 3 }));
    });

    it('rq/c: תגובה עם np – בעל הבקשה עד 3, מנהל עד 1; בלי np – כמו קודם', async () => {
      await assertSucceeds(fs(E.e1).doc(R('rq/q1/c/' + fresh('c'))).set(cm(E.e1, { np: 3 })));
      await assertSucceeds(fs(E.e1).doc(R('rq/q1/c/' + fresh('c'))).set(cm(E.e1)));
      await assertFails(fs(E.e1).doc(R('rq/q1/c/' + fresh('c'))).set(cm(E.e1, { np: 4 })));
      await assertSucceeds(fs(E.mgr).doc(R('rq/q1/c/' + fresh('c'))).set(cm(E.mgr, { np: 1 })));
      await assertFails(fs(E.mgr).doc(R('rq/q1/c/' + fresh('c'))).set(cm(E.mgr, { np: 2 })));
      await assertFails(fs(E.e2).doc(R('rq/q1/c/' + fresh('c'))).set(cm(E.e2, { np: 1 })));
    });

    // ---------- 3. תמונות הבקשה ----------
    it('rq/p: קריאה – בעל הבקשה ומנהל; עובד אחר, מושבת, מחובר בלי תפקיד, מנהל של עסק אחר – נחסמים', async () => {
      await assertSucceeds(fs(E.e1).doc(R('rq/q1/p/r1')).get());
      await assertSucceeds(fs(E.e1).collection(R('rq/q1/p')).get());
      await assertSucceeds(fs(E.mgr).doc(R('rq/q2/p/r1')).get());
      await assertSucceeds(fs(E.mgr).collection(R('rq/q1/p')).get());
      await assertFails(fs(E.e1).doc(R('rq/q2/p/r1')).get());
      await assertFails(fs(E.e1).collection(R('rq/q2/p')).get());
      await assertFails(fs(E.e2).doc(R('rq/q1/p/r1')).get());
      for (const u of [E.off, E.out]) await assertFails(fs(u).doc(R('rq/q1/p/r1')).get());
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('rq/q1/p/r1')).get());
    });

    it('rq/p: יצירה – רק בעל הבקשה, rN עם N <= np, תמונה תקינה; בלי עדכון; מחיקה – מנהל', async () => {
      const e = fs(E.e1);
      await assertSucceeds(e.doc(R('rq/q1/p/r2')).set(photo(E.e1)));
      await assertFails(e.doc(R('rq/q1/p/r3')).set(photo(E.e1)));            // np = 2
      await assertFails(e.doc(R('rq/qold/p/r1')).set(photo(E.e1)));          // בקשה ישנה בלי np
      await assertFails(e.doc(R('rq/q1/p/x1')).set(photo(E.e1)));            // מזהה לא חוקי
      await assertFails(fs(E.e2).doc(R('rq/q2/p/r1')).set(photo(E.e2)));     // קיים = עדכון – אסור
      await assertFails(fs(E.mgr).doc(R('rq/q1/p/r2')).set(photo(E.mgr)));   // מנהל לא מוסיף לבקשה של עובד
      await assertFails(fs(E.e2).doc(R('rq/q1/p/r2')).set(photo(E.e2)));     // עובד אחר
      await assertFails(fs(E.off).doc(R('rq/q1/p/r2')).set(photo(E.off)));
      await assertFails(fs(E.out).doc(R('rq/q1/p/r2')).set(photo(E.out)));
      await assertFails(e.doc(R('rq/q1/p/r1')).update({ img: IMG }));
      await assertFails(e.doc(R('rq/q1/p/r1')).delete());
      await assertSucceeds(fs(E.mgr).doc(R('rq/q1/p/r1')).delete());
    });

    it('rq/p: סוג וגודל – רק data:image jpeg/png/webp ב-base64, 100..900,000 תווים, בשמו, בזמן אמת, בלי שדות נוספים', async () => {
      const e = fs(E.e1); const P = () => R('rq/q1/p/r2');
      await assertSucceeds(e.doc(P()).set(photo(E.e1, { img: 'data:image/png;base64,' + 'A'.repeat(899900) })));
      await prep((d) => d.doc(P()).delete());
      await assertSucceeds(e.doc(P()).set(photo(E.e1, { img: 'data:image/webp;base64,' + 'A'.repeat(200) })));
      await prep((d) => d.doc(P()).delete());
      await assertFails(e.doc(P()).set(photo(E.e1, { img: 'data:image/jpeg;base64,' + 'A'.repeat(900000) })));   // מעל 900,000
      await assertFails(e.doc(P()).set(photo(E.e1, { img: 'data:image/jpeg;base64,AAAA' })));                      // קטן מ-100
      await assertFails(e.doc(P()).set(photo(E.e1, { img: 'data:application/pdf;base64,' + 'A'.repeat(500) })));
      await assertFails(e.doc(P()).set(photo(E.e1, { img: 'data:image/svg+xml;base64,' + 'A'.repeat(500) })));
      await assertFails(e.doc(P()).set(photo(E.e1, { img: 'data:text/html;base64,' + 'A'.repeat(500) })));
      await assertFails(e.doc(P()).set(photo(E.e1, { img: 12345 })));
      await assertFails(e.doc(P()).set(photo(E.e2)));                                                               // uid של אחר
      await assertFails(e.doc(P()).set(photo(E.e1, { t: Date.now() - 10 * 60000 })));                              // לא בזמן אמת
      await assertFails(e.doc(P()).set(photo(E.e1, { x: 1 })));
    });

    // ---------- 4. תמונות בתגובה ----------
    it('rq/c/p: יצירה – רק כותב התגובה, N <= np של התגובה; מנהל – תמונה אחת; קריאה – בעל הבקשה ומנהל', async () => {
      await assertSucceeds(fs(E.e1).doc(R('rq/q1/c/cw/p/2')).set(photo(E.e1)));
      await assertSucceeds(fs(E.e1).doc(R('rq/q1/c/cw/p/3')).set(photo(E.e1)));
      await assertFails(fs(E.e1).doc(R('rq/q1/c/cw/p/4')).set(photo(E.e1)));
      await assertFails(fs(E.e1).doc(R('rq/q1/c/cw/p/1')).set(photo(E.e1)));      // קיים – בלי עדכון
      await assertFails(fs(E.e1).doc(R('rq/q1/c/c0/p/1')).set(photo(E.e1)));      // תגובה בלי np
      await assertFails(fs(E.e1).doc(R('rq/q1/c/cm/p/1')).set(photo(E.e1)));      // תגובה של המנהל
      await assertFails(fs(E.e1).doc(R('rq/q1/c/nope/p/1')).set(photo(E.e1)));    // תגובה לא קיימת
      await assertSucceeds(fs(E.mgr).doc(R('rq/q1/c/cm/p/1')).set(photo(E.mgr)));
      await assertFails(fs(E.mgr).doc(R('rq/q1/c/cm/p/2')).set(photo(E.mgr)));
      await assertFails(fs(E.mgr).doc(R('rq/q1/c/cw/p/2')).set(photo(E.mgr)));    // לא התגובה שלו
      await assertFails(fs(E.e1).doc(R('rq/q1/c/cw/p/2')).set(photo(E.e1, { img: 'data:application/pdf;base64,' + 'A'.repeat(500) })));
      await assertSucceeds(fs(E.e1).collection(R('rq/q1/c/cw/p')).get());
      await assertSucceeds(fs(E.mgr).doc(R('rq/q1/c/cw/p/1')).get());
      await assertFails(fs(E.e2).doc(R('rq/q1/c/cw/p/1')).get());
      await assertFails(fs(E.e2).collection(R('rq/q1/c/cw/p')).get());
      for (const u of [E.off, E.out]) await assertFails(fs(u).doc(R('rq/q1/c/cw/p/1')).get());
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('rq/q1/c/cw/p/1')).get());
      await assertFails(fs(E.e1).doc(R('rq/q1/c/cw/p/1')).delete());
      await assertSucceeds(fs(E.mgr).doc(R('rq/q1/c/cw/p/1')).delete());
    });

    it('נתונים ישנים: בקשה ותגובות בלי np נקראות כמו קודם', async () => {
      await assertSucceeds(fs(E.e1).doc(R('rq/qold')).get());
      await assertSucceeds(fs(E.mgr).doc(R('rq/qold')).get());
      await assertSucceeds(fs(E.e1).collection(R('rq/q1/c')).get());
      await assertSucceeds(fs(E.e1).collection(R('rq/qold/p')).get());
    });
  });
}

// ---------- 5. שחזור הקריאות מהאפליקציה (REST, בשורש) – כמו בקוד ----------
describe('סף משותף ותמונות בבקשות – הקריאות של האפליקציה (REST)', () => {
  let env;
  const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); });

  it('zcThrLoad / CHG.zcThr: GET ו-PATCH של /cfg/zc – מנהל 200/404; עובד, מושבת, מחובר בלי תפקיד – 403', async () => {
    let r = await fsx('u_mgr', '/cfg/zc'); assert.equal(r.status, 404); // אין ערך משותף עדיין
    const body = JSON.stringify({ fields: { thr: dv(75), by: sv('u_mgr'), at: iv(Date.now()) } });
    r = await fsx('u_mgr', '/cfg/zc', { method: 'PATCH', body }); assert.equal(r.status, 200);
    r = await fsx('u_mgr', '/cfg/zc', { method: 'PATCH', body: JSON.stringify({ fields: { thr: dv(0), by: sv('u_mgr'), at: iv(Date.now()) } }) }); assert.equal(r.status, 200);
    r = await fsx(H.MANAGER_ONLY_ADMINS, '/cfg/zc'); assert.equal(r.status, 200);
    for (const u of ['u_emp', 'u_off', 'u_out']) {
      assert.equal((await fsx(u, '/cfg/zc')).status, 403, u + ' GET');
      assert.equal((await fsx(u, '/cfg/zc', { method: 'PATCH', body })).status, 403, u + ' PATCH');
    }
  });

  it('FRM.rqNew + rqImPut + rqImGet: בקשה עם np ותמונות r1..r2, וקריאתן – בעלים ומנהל; עובד אחר – 403', async () => {
    const rid = 'q_' + Date.now(); const t = Date.now();
    let r = await fsx('u_emp', '/rq?documentId=' + rid, { method: 'POST', body: JSON.stringify({ fields: { owner: sv('u_emp'), by: sv('u_emp'), txt: sv('נשברה מברשת'), t: iv(t), st: sv('new'), ans: sv(''), np: iv(2) } }) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    for (const pid of ['r1', 'r2']) {
      r = await fsx('u_emp', `/rq/${rid}/p/${pid}`, { method: 'PATCH', body: JSON.stringify({ fields: { img: sv(IMG), t: iv(Date.now()), uid: sv('u_emp') } }) });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    r = await fsx('u_emp', `/rq/${rid}/p/r3`, { method: 'PATCH', body: JSON.stringify({ fields: { img: sv(IMG), t: iv(Date.now()), uid: sv('u_emp') } }) });
    assert.equal(r.status, 403);
    r = await fsx('u_emp', `/rq/${rid}/p?pageSize=5`); assert.equal(r.status, 200); assert.equal(r.json.documents.length, 2);
    r = await fsx('u_mgr', `/rq/${rid}/p?pageSize=5`); assert.equal(r.status, 200);
    for (const u of [H.OTHER, 'u_off', 'u_out']) assert.equal((await fsx(u, `/rq/${rid}/p?pageSize=5`)).status, 403, u);
  });

  it('FRM.rqCm + rqImPut: תגובה עם np ותמונה c/{cid}/p/1 – עובד (בעלים) ומנהל', async () => {
    await prep((d) => d.doc('rq/q9').set({ owner: 'u_emp', by: 'u_emp', txt: 'בקשה', t: Date.now(), st: 'new', ans: '' }));
    for (const [u, np] of [['u_emp', 3], ['u_mgr', 1]]) {
      const cid = 'c_' + u + Date.now();
      let r = await fsx(u, `/rq/q9/c?documentId=${cid}`, { method: 'POST', body: JSON.stringify({ fields: { uid: sv(u), by: sv(u), txt: sv('הנה'), t: iv(Date.now()), np: iv(np) } }) });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      r = await fsx(u, `/rq/q9/c/${cid}/p/1`, { method: 'PATCH', body: JSON.stringify({ fields: { img: sv(IMG), t: iv(Date.now()), uid: sv(u) } }) });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      r = await fsx(H.OTHER, `/rq/q9/c/${cid}/p?pageSize=5`); assert.equal(r.status, 403);
    }
  });
});
