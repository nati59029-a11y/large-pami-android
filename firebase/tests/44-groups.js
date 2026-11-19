'use strict';
// סבב 3, חבילה א' (17.11.2026): קבוצות התכתבות.
// 1. Firestore: grp/{gid}, grp/{gid}/m/{mid}, grp/{gid}/m/{mid}/p/1, grp/{gid}/r/{uid} – בשורש ובתוך b/bt (עסק עם התוספת groups; bx = עסק אחר).
//    וגם שחזור REST של הקריאות של groups.js (חבילה ב'): runQuery של העובד, POST ?documentId, PATCH עם updateMask.
// 2. Storage: grpv/{gid}/{mid} ו-b/bt/grpv/{gid}/{mid} – צפייה, העלאה ומחיקה.
// 3. השרת (grp-notify.js, onMsg ו-onDel – מחיקה מדורגת): נמענים, השתקה, ao, גוף ההתראה ו-last – מול אמולטור Firestore, עם שליחה מדומה (בלי אמולטור הפונקציות).
// לכל תא: "מותר" ו"נחסם".

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const deleteField = () => require('firebase/compat/app').default.firestore.FieldValue.delete(); // כמו ב-36-tasks

const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(500);
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const MP4 = { contentType: 'video/mp4' };
const up = (ref, data, meta) => new Promise((res, rej) => ref.put(data, meta).then(res, rej));

const ENVS = [
  { name: 'שורש', P: '', SP: '', biz: 'largpeami', mgr: 'u_mgr', e1: 'u_emp', e2: H.OTHER, off: 'u_off', out: 'u_out', foreign: null },
  { name: 'עסק b/bt', P: 'b/bt/', SP: 'b/bt/', biz: 'bt', mgr: 'bt_mgr', e1: 'bt_e1', e2: 'bt_e2', off: 'bt_off', out: 'u_out', foreign: 'bx_mgr' },
];

// עסקים b/bt ו-b/bx (כמו ב-43), כולל users/{uid} לכללי Storage
function seedBiz(d, b) {
  for (const [biz, mgr, emps] of [['bt', 'bt_mgr', ['bt_e1', 'bt_e2']], ['bx', 'bx_mgr', ['bx_e1']]]) {
    b.set(d.doc('b/' + biz), { name: biz, status: 'active', features: { tasks: true, groups: true } });
    b.set(d.doc(`b/${biz}/admins/${mgr}`), { email: mgr + '@example.invalid' });
    for (const u of [mgr, ...emps]) {
      b.set(d.doc(`b/${biz}/staff/${u}`), { name: u, role: u === mgr ? 'manager' : 'employee', active: true });
      b.set(d.doc('users/' + u), { bizId: biz, role: u === mgr ? 'admin' : 'worker', active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    }
  }
  b.set(d.doc('b/bt/staff/bt_off'), { name: 'bt_off', role: 'employee', active: false });
  b.set(d.doc('users/bt_off'), { bizId: 'bt', role: 'worker', active: false, bizStatus: 'active', email: 'bt_off@example.invalid', createdAt: 1 });
}

for (const E of ENVS) {
  const R = (p) => E.P + p;
  const grp = (o) => Object.assign({ name: 'צוות בוקר', mem: [E.e1, E.off], ao: false, md: true, by: E.mgr, t: Date.now() }, o);
  const msg = (uid, o) => Object.assign({ by: uid, byN: uid, t: Date.now(), k: 't', txt: 'שלום' }, o);
  const vpOf = (gid, mid) => E.SP + 'grpv/' + gid + '/' + mid;
  const vid = (uid, gid, mid, o) => msg(uid, Object.assign({ k: 'vid', txt: '', vp: vpOf(gid, mid), vs: 30, vb: 1000 }, o));
  const photo = (uid, o) => Object.assign({ img: IMG, t: Date.now(), uid }, o);

  // ---------------------------------------------------------------------------------
  describe(`קבוצות – Firestore – ${E.name}`, () => {
    let env;
    const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
    const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));

    before(async () => { env = await H.getEnv(); });
    beforeEach(async () => {
      await H.seed(env);
      await prep(async (d) => {
        const b = d.batch();
        if (E.P) seedBiz(d, b);
        b.set(d.doc(R('grp/g1')), grp());                              // e1 + off חברים, מדיה מותרת
        b.set(d.doc(R('grp/g0')), grp({ name: 'בלי מדיה', md: false }));
        b.set(d.doc(R('grp/gao')), grp({ name: 'הודעות', ao: true }));  // רק המנהל שולח
        b.set(d.doc(R('grp/g2')), grp({ name: 'אחרים', mem: [E.e2] })); // e1 לא חבר
        b.set(d.doc(R('grp/g1/m/m1')), msg(E.e1));
        b.set(d.doc(R('grp/g1/m/mi')), msg(E.e1, { k: 'img', txt: '' }));
        b.set(d.doc(R('grp/g1/m/mi/p/1')), photo(E.e1));
        b.set(d.doc(R('grp/g1/m/mi2')), msg(E.e1, { k: 'img', txt: '' }));
        b.set(d.doc(R('grp/g1/m/mm')), msg(E.mgr, { k: 'img', txt: '' }));
        b.set(d.doc(R('grp/g1/r/' + E.e1)), { t: 1, mu: false });
        b.set(d.doc(R('grp/g2/m/m1')), msg(E.e2));
        await b.commit();
      });
    });

    it('grp: קריאה – מנהל וחבר פעיל; לא-חבר, חבר מושבת, מחובר בלי תפקיד ומנהל של עסק אחר – נחסמים', async () => {
      await assertSucceeds(fs(E.mgr).doc(R('grp/g1')).get());
      await assertSucceeds(fs(E.mgr).doc(R('grp/g2')).get());
      await assertSucceeds(fs(E.e1).doc(R('grp/g1')).get());
      await assertFails(fs(E.e1).doc(R('grp/g2')).get());
      await assertFails(fs(E.off).doc(R('grp/g1')).get());
      await assertFails(fs(E.out).doc(R('grp/g1')).get());
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g1')).get());
    });

    it('grp: רשימה – עובד רק עם where mem array-contains עצמו; מנהל – הכול', async () => {
      await assertSucceeds(fs(E.e1).collection(R('grp')).where('mem', 'array-contains', E.e1).get());
      await assertFails(fs(E.e1).collection(R('grp')).get());
      await assertFails(fs(E.off).collection(R('grp')).where('mem', 'array-contains', E.off).get());
      await assertSucceeds(fs(E.mgr).collection(R('grp')).get());
      if (E.foreign) await assertFails(fs(E.foreign).collection(R('grp')).get());
    });

    it('grp: יצירה, עריכה ומחיקה – מנהל בלבד; שדות ואורך השם נבדקים', async () => {
      const m = fs(E.mgr), e = fs(E.e1);
      await assertSucceeds(m.doc(R('grp/' + fresh('n'))).set(grp()));
      await assertSucceeds(m.doc(R('grp/' + fresh('n'))).set(grp({ name: 'א'.repeat(60), mem: [] })));
      await assertFails(e.doc(R('grp/' + fresh('n'))).set(grp({ by: E.e1 })));
      await assertFails(m.doc(R('grp/' + fresh('n'))).set(grp({ name: 'א'.repeat(61) })));
      await assertFails(m.doc(R('grp/' + fresh('n'))).set(grp({ name: '' })));
      await assertFails(m.doc(R('grp/' + fresh('n'))).set(grp({ x: 1 })));
      await assertFails(m.doc(R('grp/' + fresh('n'))).set(grp({ ao: 'כן' })));
      await assertFails(m.doc(R('grp/' + fresh('n'))).set(grp({ by: E.e1 })), 'by חייב להיות המנהל עצמו');
      await assertFails(m.doc(R('grp/' + fresh('n'))).set(grp({ t: Date.now() - 600000 })), 'זמן אמת');
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/' + fresh('n'))).set(grp({ by: E.foreign })));
      // עריכה: מנהל – שם, חברים, מתגים, last תקין; by ו-t לא משתנים
      await assertSucceeds(m.doc(R('grp/g1')).update({ name: 'חדש', mem: [E.e1, E.e2], ao: true, md: false }));
      await assertSucceeds(m.doc(R('grp/g1')).update({ last: { txt: 'היי', byN: E.mgr, t: Date.now(), k: 't' } }));
      await assertFails(m.doc(R('grp/g1')).update({ last: { txt: 'א'.repeat(121), byN: E.mgr, t: 1, k: 't' } }));
      await assertFails(m.doc(R('grp/g1')).update({ last: { txt: 'x', byN: E.mgr, t: 1, k: 't', z: 1 } }));
      // תוספת 17.11 – הצמדת הודעה: מנהל מצמיד ומבטל; עובד, מושבת ועסק אחר – נחסמים; מבנה נבדק
      const pin = { mid: 'm1', txt: 'שלום', byN: E.e1, t: Date.now(), k: 't' };
      await assertSucceeds(m.doc(R('grp/g1')).update({ pin }));
      await assertFails(e.doc(R('grp/g1')).update({ pin }), 'עובד מצמיד');
      await assertFails(fs(E.off).doc(R('grp/g1')).update({ pin }));
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g1')).update({ pin }));
      await assertFails(m.doc(R('grp/g1')).update({ pin: Object.assign({}, pin, { txt: 'א'.repeat(121) }) }));
      await assertFails(m.doc(R('grp/g1')).update({ pin: Object.assign({}, pin, { x: 1 }) }));
      await assertFails(m.doc(R('grp/g1')).update({ pin: Object.assign({}, pin, { mid: '../x' }) }));
      await assertFails(m.doc(R('grp/g1')).update({ pin: { txt: 'בלי mid', t: 1 } }));
      await assertFails(m.doc(R('grp/g1')).update({ pin: 'm1' }));
      await assertFails(e.doc(R('grp/g1')).update({ pin: deleteField() }), 'עובד מבטל הצמדה');
      await assertSucceeds(m.doc(R('grp/g1')).update({ pin: deleteField() }), 'מנהל מבטל הצמדה');
      await assertFails(m.doc(R('grp/g1')).update({ by: 'x' }));
      await assertFails(m.doc(R('grp/g1')).update({ t: 5 }));
      await assertFails(e.doc(R('grp/g1')).update({ name: 'שלי' }));
      await assertFails(e.doc(R('grp/g1')).update({ last: { txt: 'x', byN: E.e1, t: 1, k: 't' } }));
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g1')).update({ name: 'זר' }));
      // מחיקה
      await assertFails(e.doc(R('grp/g2')).delete());
      await assertFails(fs(E.off).doc(R('grp/g1')).delete());
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g2')).delete());
      await assertSucceeds(m.doc(R('grp/g2')).delete());
    });

    it('m: קריאה – מנהל וחבר פעיל; לא-חבר, מושבת, מחובר בלי תפקיד, עסק אחר – נחסמים', async () => {
      await assertSucceeds(fs(E.mgr).doc(R('grp/g2/m/m1')).get());
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/m1')).get());
      await assertSucceeds(fs(E.e1).collection(R('grp/g1/m')).orderBy('t').get());
      await assertFails(fs(E.e1).doc(R('grp/g2/m/m1')).get());
      await assertFails(fs(E.e1).collection(R('grp/g2/m')).get());
      await assertFails(fs(E.off).doc(R('grp/g1/m/m1')).get());
      await assertFails(fs(E.out).doc(R('grp/g1/m/m1')).get());
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g1/m/m1')).get());
    });

    it('m: שליחת טקסט – חבר פעיל ומנהל; לא-חבר, מושבת, זר – נחסמים; בשמו ובזמן אמת', async () => {
      const add = (uid, gid, o) => fs(uid).doc(R(`grp/${gid}/m/${fresh('m')}`)).set(msg(uid, o));
      await assertSucceeds(add(E.e1, 'g1'));
      await assertSucceeds(add(E.mgr, 'g1'));
      await assertSucceeds(add(E.mgr, 'g2'), 'מנהל שולח גם בקבוצה שהוא לא ב-mem שלה');
      await assertFails(add(E.e1, 'g2'), 'לא חבר');
      await assertFails(add(E.off, 'g1'), 'עובד מושבת');
      await assertFails(add(E.out, 'g1'));
      if (E.foreign) await assertFails(add(E.foreign, 'g1'));
      await assertFails(add(E.e1, 'gnone'), 'קבוצה שלא קיימת');
      await assertFails(fs(E.e1).doc(R(`grp/g1/m/${fresh('m')}`)).set(msg(E.e2)), 'by של מישהו אחר');
      await assertFails(add(E.e1, 'g1', { byN: E.e2 }), 'byN של מישהו אחר');
      await assertFails(add(E.e1, 'g1', { t: Date.now() - 600000 }), 'זמן ישן');
      await assertFails(add(E.e1, 'g1', { txt: '' }), 'טקסט ריק');
      await assertSucceeds(add(E.e1, 'g1', { txt: 'א'.repeat(2000) }));
      await assertFails(add(E.e1, 'g1', { txt: 'א'.repeat(2001) }));
      await assertFails(add(E.e1, 'g1', { k: 'x' }));
      await assertFails(add(E.e1, 'g1', { extra: 1 }));
      await assertFails(add(E.e1, 'g1', { vp: vpOf('g1', 'x') }), 'vp רק בסרטון');
    });

    it('m: קבוצה עם ao – רק המנהל שולח; חבר נחסם', async () => {
      const id = fresh('m');
      await assertFails(fs(E.e1).doc(R('grp/gao/m/' + id)).set(msg(E.e1)));
      await assertFails(fs(E.e1).doc(R('grp/gao/m/' + id)).set(msg(E.e1, { k: 'img', txt: '' })));
      await assertSucceeds(fs(E.mgr).doc(R('grp/gao/m/' + fresh('m'))).set(msg(E.mgr)));
      // קריאה בקבוצת ao – כמו כל קבוצה
      await assertSucceeds(fs(E.e1).collection(R('grp/gao/m')).get());
    });

    it('m: מדיה – רק כש-md == true; סרטון עם vp מדויק, עד 60 שניות ו-30MB', async () => {
      const m1 = fresh('m');
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/' + fresh('m'))).set(msg(E.e1, { k: 'img', txt: '' })));
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/' + fresh('m'))).set(msg(E.e1, { k: 'img', txt: 'כיתוב' })));
      await assertFails(fs(E.e1).doc(R('grp/g0/m/' + fresh('m'))).set(msg(E.e1, { k: 'img', txt: '' })), 'md=false – תמונה');
      await assertFails(fs(E.mgr).doc(R('grp/g0/m/' + fresh('m'))).set(msg(E.mgr, { k: 'img', txt: '' })), 'md=false – גם מנהל');
      const g0id = fresh('m');
      await assertFails(fs(E.e1).doc(R('grp/g0/m/' + g0id)).set(vid(E.e1, 'g0', g0id)), 'md=false – סרטון');
      await assertSucceeds(fs(E.e1).doc(R('grp/g0/m/' + fresh('m'))).set(msg(E.e1)), 'md=false – טקסט מותר');
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/' + m1)).set(vid(E.e1, 'g1', m1)));
      const v = (o) => { const id = fresh('m'); return fs(E.e1).doc(R('grp/g1/m/' + id)).set(vid(E.e1, 'g1', id, o)); };
      await assertFails(v({ vp: vpOf('g1', 'other') }), 'vp של הודעה אחרת');
      await assertFails(v({ vp: (E.P ? '' : 'b/bt/') + 'grpv/g1/x' }), 'vp בעסק אחר');
      await assertFails(v({ vs: 61 }));
      await assertFails(v({ vs: 0 }));
      await assertSucceeds(v({ vb: 31457280 }));
      await assertFails(v({ vb: 31457281 }));
      await assertFails(v({ vb: '100' }));
      const id2 = fresh('m');
      const noVs = vid(E.e1, 'g1', id2); delete noVs.vs;
      await assertFails(fs(E.e1).doc(R('grp/g1/m/' + id2)).set(noVs), 'סרטון בלי vs');
    });

    it('m: אין עדכון (גם לא לשולח ולא למנהל); מחיקה – מנהל בלבד', async () => {
      await assertFails(fs(E.e1).doc(R('grp/g1/m/m1')).update({ txt: 'שונה' }));
      await assertFails(fs(E.mgr).doc(R('grp/g1/m/m1')).update({ txt: 'שונה' }));
      await assertFails(fs(E.e1).doc(R('grp/g1/m/m1')).set(msg(E.e1, { txt: 'דריסה' })), 'דריסה = עדכון');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/m1')).delete(), 'עובד לא מוחק גם הודעה שלו');
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g1/m/m1')).delete());
      await assertSucceeds(fs(E.mgr).doc(R('grp/g1/m/m1')).delete());
    });

    it('m/p/1: תמונה – רק שולח הודעת img, רק המזהה 1, בלי דריסה; קריאה כמו הקבוצה; מחיקה – מנהל', async () => {
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/mi2/p/1')).set(photo(E.e1)));
      await assertFails(fs(E.e1).doc(R('grp/g1/m/mi/p/1')).set(photo(E.e1)), 'דריסה');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/mi2/p/2')).set(photo(E.e1)), 'רק 1');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/m1/p/1')).set(photo(E.e1)), 'הודעת טקסט');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/mm/p/1')).set(photo(E.e1)), 'הודעה של המנהל');
      await assertSucceeds(fs(E.mgr).doc(R('grp/g1/m/mm/p/1')).set(photo(E.mgr)));
      await assertFails(fs(E.e1).doc(R('grp/g1/m/none/p/1')).set(photo(E.e1)), 'הודעה שלא קיימת');
      const bad = [photo(E.e1, { img: 'data:image/gif;base64,' + 'A'.repeat(500) }), photo(E.e1, { img: 'data:image/jpeg;base64,AA' }),
        photo(E.e1, { img: 'data:image/jpeg;base64,' + 'A'.repeat(900001) }), photo(E.e1, { uid: E.e2 }), photo(E.e1, { t: 1 }), photo(E.e1, { x: 1 })];
      for (const p of bad) await assertFails(fs(E.e1).doc(R('grp/g1/m/mi2/p/1')).set(p));
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/mi/p/1')).get());
      await assertSucceeds(fs(E.mgr).doc(R('grp/g1/m/mi/p/1')).get());
      await assertFails(fs(E.e2).doc(R('grp/g1/m/mi/p/1')).get(), 'לא חבר');
      await assertFails(fs(E.off).doc(R('grp/g1/m/mi/p/1')).get());
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g1/m/mi/p/1')).get());
      await assertFails(fs(E.e1).doc(R('grp/g1/m/mi/p/1')).delete());
      await assertSucceeds(fs(E.mgr).doc(R('grp/g1/m/mi/p/1')).delete());
    });

    it('r: כל משתמש כותב רק את שלו (t, mu); של משתמש אחר – נחסם; קריאה – רק הבעלים והמנהל', async () => {
      const now = Date.now();
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/r/' + E.e1)).set({ t: now, mu: true }));
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/r/' + E.e1)).update({ t: now + 1000 }));
      await assertSucceeds(fs(E.e1).doc(R('grp/gao/r/' + E.e1)).set({ t: now, mu: true }), 'מותר לשמור, השרת מתעלם ב-ao');
      await assertSucceeds(fs(E.mgr).doc(R('grp/g2/r/' + E.mgr)).set({ t: now }));
      await assertFails(fs(E.e1).doc(R('grp/g1/r/' + E.off)).set({ t: now }), 'r של משתמש אחר');
      await assertFails(fs(E.mgr).doc(R('grp/g1/r/' + E.e1)).set({ t: now, mu: false }), 'גם מנהל לא כותב r של אחר');
      await assertFails(fs(E.e1).doc(R('grp/g2/r/' + E.e1)).set({ t: now }), 'לא חבר');
      await assertFails(fs(E.off).doc(R('grp/g1/r/' + E.off)).set({ t: now }), 'מושבת');
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g1/r/' + E.foreign)).set({ t: now }));
      await assertFails(fs(E.e1).doc(R('grp/g1/r/' + E.e1)).set({ t: now, x: 1 }));
      await assertFails(fs(E.e1).doc(R('grp/g1/r/' + E.e1)).set({ mu: 'כן' }));
      await assertFails(fs(E.e1).doc(R('grp/g1/r/' + E.e1)).set({ t: now + 3600000 }), 'זמן עתידי');
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/r/' + E.e1)).get());
      await assertSucceeds(fs(E.mgr).doc(R('grp/g1/r/' + E.e1)).get());
      await assertFails(fs(E.e2).doc(R('grp/g1/r/' + E.e1)).get());
      // החלטת המתאם 17.11: חבר בקבוצה לא קורא את r של חבר אחר (ולא את כל האוסף)
      await prep(async (d) => {
        await d.doc(R('grp/g3')).set(grp({ mem: [E.e1, E.e2] }));
        await d.doc(R('grp/g3/r/' + E.e2)).set({ t: 1, mu: true });
        await d.doc(R('grp/g3/r/' + E.e1)).set({ t: 1 });
      });
      await assertFails(fs(E.e1).doc(R('grp/g3/r/' + E.e2)).get(), 'r של חבר אחר');
      await assertFails(fs(E.e1).collection(R('grp/g3/r')).get(), 'list של r');
      await assertSucceeds(fs(E.e1).doc(R('grp/g3/r/' + E.e1)).get());
      await assertSucceeds(fs(E.e2).doc(R('grp/g3/r/' + E.e2)).get());
      await assertSucceeds(fs(E.mgr).doc(R('grp/g3/r/' + E.e2)).get());
      await assertSucceeds(fs(E.mgr).collection(R('grp/g3/r')).get(), 'מנהל – list');
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g3/r/' + E.e2)).get());
      await assertFails(fs(E.e1).doc(R('grp/g1/r/' + E.e1)).delete());
      await assertSucceeds(fs(E.mgr).doc(R('grp/g1/r/' + E.e1)).delete());
    });

    // תוספת 19.11: תשובה (re), העברה (fw) וסימונים (x)
    it('m: re (תשובה) ו-fw (הועברה) – מותרים בכל סוג הודעה; מבנה ואורך נבדקים', async () => {
      const re = { mid: 'm1', txt: 'שלום', byN: E.e1, k: 't' };
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/' + fresh('re'))).set(msg(E.e1, { re })));
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/' + fresh('re'))).set(msg(E.e1, { k: 'img', txt: '', re: { mid: 'mi' } })));
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/' + fresh('fw'))).set(msg(E.e1, { fw: true })));
      const vm = fresh('fv');
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/' + vm)).set(vid(E.e1, 'g1', vm, { fw: true, re })));
      await assertSucceeds(fs(E.mgr).doc(R('grp/gao/m/' + fresh('re'))).set(msg(E.mgr, { re, fw: true })));
      await assertFails(fs(E.e1).doc(R('grp/gao/m/' + fresh('re'))).set(msg(E.e1, { re })), 'ao – תשובה של חבר נחסמת');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/' + fresh('re'))).set(msg(E.e1, { fw: false })), 'fw רק true');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/' + fresh('re'))).set(msg(E.e1, { re: 'm1' })), 're לא מפה');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/' + fresh('re'))).set(msg(E.e1, { re: { txt: 'x' } })), 'בלי mid');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/' + fresh('re'))).set(msg(E.e1, { re: { mid: 'a/b' } })), 'mid לא תקין');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/' + fresh('re'))).set(msg(E.e1, { re: { mid: 'm1', txt: 'א'.repeat(121) } })), 'ציטוט ארוך');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/' + fresh('re'))).set(msg(E.e1, { re: { mid: 'm1', k: 'doc' } })), 'k לא תקין');
      await assertFails(fs(E.e1).doc(R('grp/g1/m/' + fresh('re'))).set(msg(E.e1, { re: { mid: 'm1', x: 1 } })), 'שדה זר ב-re');
    });

    it('x: סימון – רק המסמך שלי ({mid}_{uid}), רק להודעה קיימת, רק מהרשימה; גם ב-ao; קריאה כמו הקבוצה; מחיקה – הבעלים או המנהל', async () => {
      await prep((d) => d.doc(R('grp/gao/m/a1')).set(msg(E.mgr)));
      const x = (uid, mid, o) => Object.assign({ mid, uid, byN: uid, e: '👍', t: Date.now() }, o);
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/x/m1_' + E.e1)).set(x(E.e1, 'm1')));
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/x/m1_' + E.e1)).set(x(E.e1, 'm1', { e: '❤️' })), 'החלפה');
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/x/m1_' + E.e1)).set(x(E.e1, 'm1', { e: '' })), 'ביטול');
      await assertSucceeds(fs(E.e1).doc(R('grp/gao/x/a1_' + E.e1)).set(x(E.e1, 'a1')), 'ao – סימון מותר (החלטת הבעלים)');
      await assertSucceeds(fs(E.mgr).doc(R('grp/g2/x/m1_' + E.mgr)).set(x(E.mgr, 'm1')));
      await assertFails(fs(E.e1).doc(R('grp/g1/x/m1_' + E.off)).set(x(E.off, 'm1')), 'בשם אחר');
      await assertFails(fs(E.e1).doc(R('grp/g1/x/m1_' + E.e1)).set(x(E.off, 'm1')), 'uid לא שלי');
      await assertFails(fs(E.e1).doc(R('grp/g1/x/mi_' + E.e1)).set(x(E.e1, 'm1')), 'מזהה לא תואם');
      await assertFails(fs(E.e1).doc(R('grp/g1/x/nope_' + E.e1)).set(x(E.e1, 'nope')), 'הודעה שלא קיימת');
      await assertFails(fs(E.e1).doc(R('grp/g1/x/m1_' + E.e1)).set(x(E.e1, 'm1', { e: '💩' })), 'אימוג\'י לא מהרשימה');
      await assertFails(fs(E.e1).doc(R('grp/g1/x/m1_' + E.e1)).set(x(E.e1, 'm1', { t: Date.now() - 3600000 })), 'זמן לא אמיתי');
      await assertFails(fs(E.e1).doc(R('grp/g1/x/m1_' + E.e1)).set(x(E.e1, 'm1', { z: 1 })), 'שדה זר');
      await assertFails(fs(E.e1).doc(R('grp/g1/x/m1_' + E.e1)).set(x(E.e1, 'm1', { byN: 'מישהו אחר' })), 'שם לא שלי');
      await assertFails(fs(E.e1).doc(R('grp/g2/x/m1_' + E.e1)).set(x(E.e1, 'm1')), 'לא חבר');
      await assertFails(fs(E.off).doc(R('grp/g1/x/m1_' + E.off)).set(x(E.off, 'm1')), 'מושבת');
      if (E.foreign) await assertFails(fs(E.foreign).doc(R('grp/g1/x/m1_' + E.foreign)).set(x(E.foreign, 'm1')));
      await assertSucceeds(fs(E.e1).collection(R('grp/g1/x')).get());
      await assertSucceeds(fs(E.mgr).collection(R('grp/g1/x')).get());
      await assertFails(fs(E.e1).collection(R('grp/g2/x')).get(), 'לא חבר – קריאה');
      if (E.foreign) await assertFails(fs(E.foreign).collection(R('grp/g1/x')).get());
      await prep((d) => d.doc(R('grp/g1/x/mi_' + E.mgr)).set(x(E.mgr, 'mi')));
      await assertFails(fs(E.e1).doc(R('grp/g1/x/mi_' + E.mgr)).delete(), 'סימון של אחר');
      await assertSucceeds(fs(E.e1).doc(R('grp/g1/x/m1_' + E.e1)).delete());
      await assertSucceeds(fs(E.mgr).doc(R('grp/g1/x/mi_' + E.mgr)).delete());
      await assertSucceeds(fs(E.mgr).doc(R('grp/gao/x/a1_' + E.e1)).delete(), 'מנהל מוחק כל סימון');
    });

    if (E.P) {
      it('עסק בלי התוספת groups – הכול נחסם, גם למנהל', async () => {
        await prep((d) => d.doc('b/bt').update({ features: { tasks: true, groups: false } }));
        await assertFails(fs(E.mgr).doc(R('grp/g1')).get());
        await assertFails(fs(E.mgr).doc(R('grp/' + fresh('n'))).set(grp()));
        await assertFails(fs(E.e1).doc(R(`grp/g1/m/${fresh('m')}`)).set(msg(E.e1)));
        await assertFails(fs(E.e1).doc(R('grp/g1/r/' + E.e1)).set({ t: 1 }));
      });
    } else {
      it('שורש אחרי המעבר (b/largpeami.dataRoot == "b") – כתיבה נחסמת, קריאה לא', async () => {
        await prep((d) => d.doc('b/largpeami').set({ name: 'x', status: 'active', dataRoot: 'b', features: { tasks: true } }));
        await assertFails(fs(E.mgr).doc(R('grp/' + fresh('n'))).set(grp()));
        await assertFails(fs(E.e1).doc(R(`grp/g1/m/${fresh('m')}`)).set(msg(E.e1)));
        await assertFails(fs(E.e1).doc(R('grp/g1/r/' + E.e1)).set({ t: 1 }));
        await assertSucceeds(fs(E.e1).doc(R('grp/g1/m/m1')).get());
      });
    }
  });

  // ---------------------------------------------------------------------------------
  describe(`קבוצות – Storage (סרטונים) – ${E.name}`, () => {
    let env;
    const st = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).storage();
    const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
    const SEEN = vpOf('g1', 'mv0'); // קובץ קיים לצפייה

    before(async () => { env = await H.getEnv(); });
    beforeEach(async () => {
      await H.seed(env);
      await env.clearStorage();
      const now = Date.now();
      await prep(async (d) => {
        const b = d.batch();
        if (E.P) seedBiz(d, b);
        b.set(d.doc(R('grp/g1')), grp());
        b.set(d.doc(R('grp/g0')), grp({ md: false }));
        b.set(d.doc(R('grp/g2')), grp({ mem: [E.e2] }));
        b.set(d.doc(R('grp/gao')), grp({ ao: true }));
        b.set(d.doc(R('grp/g1/m/mv0')), vid(E.e1, 'g1', 'mv0'));
        b.set(d.doc(R('grp/g1/m/mv1')), vid(E.e1, 'g1', 'mv1'));
        b.set(d.doc(R('grp/g1/m/mvold')), vid(E.e1, 'g1', 'mvold', { t: now - 40 * 60000 }));
        b.set(d.doc(R('grp/g1/m/mvbad')), vid(E.e1, 'g1', 'mvbad', { vp: vpOf('g1', 'other') }));
        b.set(d.doc(R('grp/g1/m/mt')), msg(E.e1));
        b.set(d.doc(R('grp/g1/m/mvm')), vid(E.mgr, 'g1', 'mvm'));
        b.set(d.doc(R('grp/g0/m/mv1')), vid(E.e1, 'g0', 'mv1')); // נשלחה כשהמדיה הייתה מותרת, ואז md כובה
        await b.commit();
      });
      await env.withSecurityRulesDisabled((c) => c.storage().ref(SEEN).put(new Uint8Array([1, 2, 3]), MP4));
    });

    it('get: מנהל וחבר פעיל; לא-חבר, מושבת, מחובר בלי תפקיד, עסק אחר – נחסמים; list – לכולם נחסם', async () => {
      await assertSucceeds(st(E.mgr).ref(SEEN).getMetadata());
      await assertSucceeds(st(E.e1).ref(SEEN).getMetadata());
      await assertFails(st(E.e2).ref(SEEN).getMetadata());
      await assertFails(st(E.off).ref(SEEN).getMetadata());
      await assertFails(st(E.out).ref(SEEN).getMetadata());
      await assertFails(env.unauthenticatedContext().storage().ref(SEEN).getMetadata());
      if (E.foreign) await assertFails(st(E.foreign).ref(SEEN).getMetadata());
      await assertFails(st(E.mgr).ref(E.SP + 'grpv/g1').listAll());
      await assertFails(st(E.e1).ref(E.SP + 'grpv/g1').listAll());
    });

    it('create: מנהל, או חבר פעיל כש-ao לא true; רק כש-md == true; סרטון עד 30MB; בלי דריסה (ההודעה נכתבת אחרי ההעלאה)', async () => {
      const f = (gid) => vpOf(gid, fresh('v'));
      await assertSucceeds(up(st(E.e1).ref(f('g1')), new Uint8Array([1, 2]), MP4), 'חבר פעיל, לפני שההודעה קיימת');
      await assertSucceeds(up(st(E.mgr).ref(f('g1')), new Uint8Array([1]), { contentType: 'video/webm' }));
      await assertSucceeds(up(st(E.mgr).ref(f('g2')), new Uint8Array([1]), MP4), 'מנהל – גם בקבוצה שהוא לא ב-mem שלה');
      await assertFails(up(st(E.e1).ref(SEEN), new Uint8Array([3]), MP4), 'דריסה של קובץ קיים');
      await assertFails(up(st(E.mgr).ref(SEEN), new Uint8Array([3]), MP4), 'דריסה – גם מנהל');
      await assertFails(up(st(E.e2).ref(f('g1')), new Uint8Array([1]), MP4), 'לא חבר');
      await assertFails(up(st(E.off).ref(f('g1')), new Uint8Array([1]), MP4), 'חבר מושבת');
      await assertFails(up(st(E.out).ref(f('g1')), new Uint8Array([1]), MP4));
      await assertFails(up(env.unauthenticatedContext().storage().ref(f('g1')), new Uint8Array([1]), MP4));
      if (E.foreign) await assertFails(up(st(E.foreign).ref(f('g1')), new Uint8Array([1]), MP4), 'עסק אחר');
      await assertFails(up(st(E.e1).ref(f('g0')), new Uint8Array([1]), MP4), 'md=false');
      await assertFails(up(st(E.mgr).ref(f('g0')), new Uint8Array([1]), MP4), 'md=false – גם מנהל');
      await assertFails(up(st(E.e1).ref(f('gao')), new Uint8Array([1]), MP4), 'ao – עובד');
      await assertSucceeds(up(st(E.mgr).ref(f('gao')), new Uint8Array([1]), MP4), 'ao – מנהל');
      await assertFails(up(st(E.e1).ref(f('gnone')), new Uint8Array([1]), MP4), 'קבוצה שלא קיימת');
      await assertFails(up(st(E.e1).ref(f('g1')), new Uint8Array([1]), { contentType: 'image/jpeg' }), 'לא סרטון');
      await assertFails(up(st(E.e1).ref(f('g1')), new Uint8Array([1]), { contentType: 'video/quicktime' }), 'mov לא מותר');
      await assertFails(up(st(E.e1).ref(f('g1')), new Uint8Array(30 * 1024 * 1024 + 1), MP4), 'מעל 30MB');
      await assertSucceeds(up(st(E.e1).ref(f('g1')), new Uint8Array(30 * 1024 * 1024), { contentType: 'video/3gpp' }), 'בדיוק 30MB');
      if (E.P) await assertFails(up(st(E.e1).ref('grpv/g1/' + fresh('v')), new Uint8Array([1]), MP4), 'עובד עסק בנתיב legacy');
      else await assertFails(up(st(E.e1).ref('b/bt/grpv/g1/' + fresh('v')), new Uint8Array([1]), MP4), 'עובד legacy בנתיב של עסק');
    });

    it('delete: מנהל בלבד; השולח, עובד אחר ועסק אחר – נחסמים', async () => {
      await assertFails(st(E.e1).ref(SEEN).delete());
      await assertFails(st(E.e2).ref(SEEN).delete());
      if (E.foreign) await assertFails(st(E.foreign).ref(SEEN).delete());
      await assertSucceeds(st(E.mgr).ref(SEEN).delete());
    });
  });
}

// ---------------------------------------------------------------------------------
describe('grpMsg / grpMsgB – התראה על הודעה חדשה (שרת, שליחה מדומה)', { skip: !process.env.FIRESTORE_EMULATOR_HOST && 'אמולטור Firestore לא רץ' }, () => {
  let env, G;
  const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
  async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
  const tok = (u) => 'fcm_' + u + '_'.repeat(30);
  const T0 = Date.now();

  before(async () => {
    env = await H.getEnv();
    require('../functions/index.js');
    G = require('../functions/grp-notify.js')._core;
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('b/gbz'), { name: 'gbz', status: 'active', dataRoot: 'b', features: { tasks: true, groups: true } });
      b.set(d.doc('b/gnz'), { name: 'gnz', status: 'active', dataRoot: 'b', features: { tasks: true, groups: false } });
      b.set(d.doc('b/gsz'), { name: 'gsz', status: 'suspended', dataRoot: 'b', features: { tasks: true, groups: true } });
      for (const biz of ['gbz', 'gnz', 'gsz']) {
        const P = 'b/' + biz + '/';
        for (const m of ['m1', 'm2']) b.set(d.doc(P + 'admins/' + m), { email: m + '@x.invalid' });
        b.set(d.doc(P + 'staff/m1'), { name: 'המנהל', active: true, pushTokens: [tok('m1')] });
        b.set(d.doc(P + 'push_tokens/m2'), { pushTokens: [tok('m2')] }); // מנהל בלי staff
        for (const [u, act] of [['e1', true], ['e2', true], ['e3', true], ['eoff', false], ['eout', true]]) {
          b.set(d.doc(P + 'staff/' + u), { name: 'עובד ' + u, active: act, pushTokens: [tok(u)] });
        }
        b.set(d.doc(P + 'grp/g1'), { name: 'משמרת ערב', mem: ['e1', 'e2', 'e3', 'eoff', 'ghost'], ao: false, md: true, by: 'm1', t: 1 });
        b.set(d.doc(P + 'grp/gao'), { name: 'הודעות', mem: ['e1', 'e2', 'e3'], ao: true, md: true, by: 'm1', t: 1 });
        for (const g of ['g1', 'gao']) b.set(d.doc(P + `grp/${g}/r/e3`), { t: 1, mu: true });
      }
      // legacy בשורש (אין b/largpeami = legacy)
      b.set(d.doc('admins/m1'), { email: 'm1@x.invalid' });
      b.set(d.doc('staff/m1'), { name: 'המנהל', active: true, pushTokens: [tok('m1')] });
      b.set(d.doc('staff/e1'), { name: 'דנה', active: true, pushTokens: [tok('e1')] });
      b.set(d.doc('staff/e2'), { name: 'יוסי', active: true, pushTokens: [tok('e2')] });
      b.set(d.doc('grp/g1'), { name: 'כולם', mem: ['e1', 'e2'], ao: false, md: true, by: 'm1', t: 1 });
      await b.commit();
    });
  });
  const run = async (biz, gid, m) => {
    const calls = [];
    const send = async (toks, msg, g) => { calls.push({ toks, msg, g }); return toks.map((t) => ({ token: t, ok: true })); };
    const out = await G.onMsg(biz, gid, 'mx' + (++seq), Object.assign({ byN: 'e1', t: T0, k: 't', txt: 'שלום לכולם' }, m), { send });
    return { out, calls, to: calls.flatMap((c) => c.toks).map((t) => t.replace(/^fcm_|_+$/g, '')).sort() };
  };

  it('נמענים: חברים פעילים ומנהלים, חוץ מהשולח, מושבת, מי שהשתיק ומי שלא חבר', async () => {
    const r = await run('gbz', 'g1', { by: 'e1' });
    assert.equal(r.out.ok, true);
    assert.deepEqual(r.to, ['e2', 'm1', 'm2'], 'e3 השתיק, eoff מושבת, eout לא חבר, ghost בלי מסמך, e1 השולח');
    const r2 = await run('gbz', 'g1', { by: 'm1', byN: 'm1' });
    assert.deepEqual(r2.to, ['e1', 'e2', 'm2'], 'מנהל ששולח – לא מקבל, מנהל אחר כן');
  });

  it('ao: השתקה לא חוסמת', async () => {
    const r = await run('gbz', 'gao', { by: 'm1', byN: 'm1' });
    assert.deepEqual(r.to, ['e1', 'e2', 'e3', 'm2']);
  });

  it('גוף ההתראה: שם הקבוצה; "שולח: טקסט" / 📷 תמונה / 🎬 סרטון; שם השולח מ-staff (לא מההודעה)', async () => {
    let r = await run('gbz', 'g1', { by: 'e1', byN: 'מזויף' });
    assert.deepEqual(r.calls[0].msg, { title: 'משמרת ערב', body: 'עובד e1: שלום לכולם' });
    assert.equal(r.calls[0].g, 'g1');
    r = await run('gbz', 'g1', { by: 'e2', k: 'img', txt: '' });
    assert.equal(r.calls[0].msg.body, 'עובד e2: 📷 תמונה');
    r = await run('gbz', 'g1', { by: 'e2', k: 'vid', txt: 'תראו' });
    assert.equal(r.calls[0].msg.body, 'עובד e2: 🎬 סרטון תראו');
    const long = G.msgOf({ k: 't', txt: 'א'.repeat(300) }, 'דנה', 'ק');
    assert.ok(long.body.length <= 'דנה: '.length + 100 && long.body.endsWith('…'));
    assert.equal(G.msgOf({ k: 't', txt: 'שורה\n\nשנייה' }, '', 'ק').body, 'שורה שנייה');
  });

  it('last מתעדכן מהשרת; הודעה ישנה יותר לא דורסת', async () => {
    await run('gbz', 'g1', { by: 'e1', t: T0 + 5000, txt: 'חדשה' });
    assert.deepEqual((await get('b/gbz/grp/g1')).last, { txt: 'חדשה', byN: 'עובד e1', t: T0 + 5000, k: 't' });
    await run('gbz', 'g1', { by: 'e2', t: T0, txt: 'ישנה' });
    assert.equal((await get('b/gbz/grp/g1')).last.txt, 'חדשה');
    await run('gbz', 'g1', { by: 'e2', t: T0 + 9000, k: 'img', txt: '' });
    assert.deepEqual((await get('b/gbz/grp/g1')).last, { txt: '', byN: 'עובד e2', t: T0 + 9000, k: 'img' });
  });

  it('legacy בשורש (בלי בדיקת תוספת, כמו החוקים); עסק בלי groups, עסק מושהה, קבוצה שלא קיימת, קלט לא תקין – בלי שליחה', async () => {
    const r = await run(null, 'g1', { by: 'e1' });
    assert.deepEqual(r.to, ['e2', 'm1']);
    assert.equal(r.calls[0].msg.body, 'דנה: שלום לכולם');
    assert.equal((await get('grp/g1')).last.byN, 'דנה');
    for (const [biz, gid, m] of [['gnz', 'g1', { by: 'e1' }], ['gsz', 'g1', { by: 'e1' }], ['gbz', 'none', { by: 'e1' }], ['gbz', 'g1', { by: 'e1', k: 'x' }], ['gbz', 'g1', { by: '../x' }], ['zz', 'g1', { by: 'e1' }]]) {
      const x = await run(biz, gid, m);
      assert.equal(x.out.ok, false, biz + '/' + gid);
      assert.equal(x.calls.length, 0);
    }
    // אחרי המעבר (dataRoot 'b') – הודעה בשורש לא נשלחת
    await prep((d) => d.doc('b/largpeami').set({ name: 'x', status: 'active', dataRoot: 'b', features: { tasks: true } }));
    assert.equal((await run(null, 'g1', { by: 'e1' })).calls.length, 0);
  });

  it('המפתח groups ברשימת התוספות (setBusinessFeatures מקבל אותו לכל עסק), ופעיל בלארג\' פעמי legacy בלי מסמך', () => {
    const T = require('../functions/lib/tenant.js');
    assert.ok(T.FEATURES.includes('groups'));
    assert.equal(T.ALL_ON.groups, true);
  });

  it('טלפון שלא רשום יותר נמחק מהרשימה (BAD_TOKEN)', async () => {
    const send = async (toks) => toks.map((t) => ({ token: t, ok: false, code: 'messaging/registration-token-not-registered' }));
    await G.onMsg('gbz', 'g1', 'mbad', { by: 'e1', byN: 'e1', t: T0, k: 't', txt: 'x' }, { send });
    assert.deepEqual((await get('b/gbz/staff/e2')).pushTokens, []);
  });

  it('grpMDel: מחיקת ההודעה האחרונה מחשבת מחדש את last; הודעה ישנה – last לא משתנה; אין הודעות – last נמחק; סרטון – רק הקובץ שלה', async () => {
    const del = [];
    const bucket = { file: (p) => ({ delete: async () => { del.push(p); } }) };
    const M = (by, t, o) => Object.assign({ by, byN: by, t, k: 't', txt: 'הודעה ' + t }, o);
    for (const P of ['b/gbz/', '']) {
      const biz = P ? 'gbz' : null;
      const vp = P + 'grpv/g1/m3';
      await prep(async (d) => {
        const b = d.batch();
        b.set(d.doc(P + 'grp/g1/m/m1'), M('e1', T0 + 1000));
        b.set(d.doc(P + 'grp/g1/m/m2'), M('e2', T0 + 2000, { k: 'img', txt: '' }));
        b.update(d.doc(P + 'grp/g1'), { last: { txt: 'סוד', byN: 'x', t: T0 + 3000, k: 'vid' }, pin: { mid: 'm3', txt: 'סוד', byN: 'x', t: T0 + 3000, k: 'vid' } });
        await b.commit();
      });
      const m3 = M('e1', T0 + 3000, { k: 'vid', txt: 'סוד', vp, vs: 5, vb: 10 }); // כבר נמחקה (המנהל)
      del.length = 0;
      let r = await G.onMDel(biz, 'g1', 'm3', m3, { bucket });
      assert.deepEqual(r, { ok: true, last: 'recalc', file: 'deleted', pin: true });
      assert.equal((await get(P + 'grp/g1')).pin, undefined, 'ההודעה המוצמדת נמחקה – pin נמחק');
      await prep((d) => d.doc(P + 'grp/g1').update({ pin: { mid: 'm2', t: T0 + 2000 } }));
      assert.deepEqual(del, [vp], 'נמחק רק הקובץ של ההודעה');
      const nm = P ? 'עובד e2' : 'יוסי';
      assert.deepEqual((await get(P + 'grp/g1')).last, { txt: '', byN: nm, t: T0 + 2000, k: 'img' }, 'הטקסט שנמחק לא נשאר');
      // מחיקת הודעה ישנה (m1) – last לא משתנה
      await prep((d) => d.doc(P + 'grp/g1/m/m1').delete());
      r = await G.onMDel(biz, 'g1', 'm1', M('e1', T0 + 1000), { bucket });
      assert.equal(r.last, 'older');
      assert.equal(r.pin, false);
      assert.equal((await get(P + 'grp/g1')).pin.mid, 'm2', 'pin של הודעה אחרת נשאר');
      assert.equal((await get(P + 'grp/g1')).last.t, T0 + 2000);
      // vp שלא תואם בדיוק לנתיב של ההודעה – לא נמחק שום קובץ
      del.length = 0;
      await G.onMDel(biz, 'g1', 'm9', M('e1', 1, { k: 'vid', vp: P + 'grpv/g2/m9' }), { bucket });
      await G.onMDel(biz, 'g1', 'm9', M('e1', 1, { k: 'vid', vp: P + 'grpv/g1/m8' }), { bucket });
      assert.deepEqual(del, []);
      // מחיקת ההודעה האחרונה שנשארה – last נמחק
      await prep((d) => d.doc(P + 'grp/g1/m/m2').delete());
      r = await G.onMDel(biz, 'g1', 'm2', M('e2', T0 + 2000, { k: 'img', txt: '' }), { bucket });
      assert.equal(r.last, 'cleared');
      assert.equal(r.pin, true);
      assert.equal((await get(P + 'grp/g1')).pin, undefined);
      assert.equal((await get(P + 'grp/g1')).last, undefined);
    }
    // הקבוצה כולה נמחקה (grpDel) – בלי חישוב last ובלי מחיקת קבצים (בלי לולאה)
    await prep((d) => d.doc('b/gbz/grp/g1').delete());
    del.length = 0;
    assert.deepEqual(await G.onMDel('gbz', 'g1', 'mz', M('e1', T0, { k: 'vid', vp: 'b/gbz/grpv/g1/mz' }), { bucket }), { ok: true, last: 'no-group', file: 'skip', pin: false });
    assert.equal(await get('b/gbz/grp/g1'), null, 'הקבוצה לא נוצרה מחדש');
    assert.deepEqual(del, []);
    assert.equal((await G.onMDel('../x', 'g1', 'm1', {}, { bucket })).ok, false);
  });

  it('grpDel: מחיקת קבוצה מוחקת m, m/p, r והסרטונים בתחילית שלה בלבד; קבוצה שנוצרה מחדש – לא נוגעים', async () => {
    await prep(async (d) => {
      const b = d.batch();
      for (const P of ['b/gbz/', '']) {
        b.set(d.doc(P + 'grp/g1/m/a'), { by: 'e1', k: 'img' });
        b.set(d.doc(P + 'grp/g1/m/a/p/1'), { img: 'x' });
        b.set(d.doc(P + 'grp/g1/r/e1'), { t: 1 });
        b.set(d.doc(P + 'grp/g9/m/a'), { by: 'e1', k: 't' }); // קבוצה אחרת – נשארת
        b.delete(d.doc(P + 'grp/g1'));
      }
      await b.commit();
    });
    const pre = [];
    const bucket = { deleteFiles: async (o) => { pre.push(o.prefix); } };
    assert.deepEqual(await G.onDel('gbz', 'g1', { bucket }), { ok: true, files: true });
    assert.deepEqual(await G.onDel(null, 'g1', { bucket }), { ok: true, files: true });
    assert.deepEqual(pre, ['b/gbz/grpv/g1/', 'grpv/g1/']);
    for (const p of ['b/gbz/grp/g1/m/a', 'b/gbz/grp/g1/m/a/p/1', 'b/gbz/grp/g1/r/e1', 'grp/g1/m/a', 'grp/g1/m/a/p/1', 'grp/g1/r/e1']) assert.equal(await get(p), null, p);
    assert.ok(await get('b/gbz/grp/g9/m/a'), 'קבוצה אחרת לא נמחקה');
    assert.ok(await get('grp/g9/m/a'));
    // Storage נכשל – המחיקה ב-Firestore עדיין עוברת (ה-lifecycle ינקה)
    assert.deepEqual(await G.onDel('gbz', 'g7', { bucket: { deleteFiles: async () => { throw new Error('x'); } } }), { ok: true, files: false });
    // הקבוצה קיימת (נוצרה מחדש) – לא נמחק דבר
    assert.equal((await G.onDel('gbz', 'gao', { bucket })).r, 'exists');
    assert.ok(await get('b/gbz/grp/gao/r/e3'));
    assert.equal((await G.onDel('gbz', '../x', { bucket })).ok, false);
  });
});

// ---------------------------------------------------------------------------------
// שחזור REST של הקריאות ב-groups.js (חבילה ב', app-source/www/groups.js בענף r3-b), בדיוק במבנה שנשלח
describe('קבוצות – הקריאות של האפליקציה (REST, groups.js)', () => {
  let env;
  const iv = (v) => ({ integerValue: String(Math.round(+v || 0)) });
  const bv = (v) => ({ booleanValue: !!v });
  const sv = H.sv;
  const arr = (a) => ({ arrayValue: { values: a.map(sv) } });
  before(async () => { env = await H.getEnv(); });
  for (const E of ENVS) {
    const B = E.P ? '/' + E.P.replace(/\/$/, '') : '';
    it(`${E.name}: רשימה, שליחה, תמונה, סרטון, מצב קריאה, השתקה, הגדרות מנהל`, async () => {
      await H.seed(env);
      await env.withSecurityRulesDisabled(async (c) => {
        const d = c.firestore(); const b = d.batch();
        if (E.P) seedBiz(d, b);
        b.set(d.doc(E.P + 'grp/g1'), { name: 'צוות', mem: [E.e1], ao: false, md: true, by: E.mgr, t: 1 });
        b.set(d.doc(E.P + 'grp/g2'), { name: 'אחרים', mem: [E.e2], ao: false, md: true, by: E.mgr, t: 1 });
        await b.commit();
      });
      const x = (uid, p, o) => H.fsx(uid, B + p, o);
      const post = (o) => ({ method: 'POST', body: JSON.stringify(o) });
      const patch = (o) => ({ method: 'PATCH', body: JSON.stringify(o) });
      // grList: עובד – runQuery עם mem ARRAY_CONTAINS uid, limit 100 (groups.js שורה 65)
      const q = (uid) => x(uid, ':runQuery', post({ structuredQuery: { from: [{ collectionId: 'grp' }], where: { fieldFilter: { field: { fieldPath: 'mem' }, op: 'ARRAY_CONTAINS', value: sv(uid) } }, limit: 100 } }));
      const r = await q(E.e1);
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.filter((y) => y.document).map((y) => y.document.name.split('/').pop()), ['g1']);
      assert.equal((await x(E.e1, ':runQuery', post({ structuredQuery: { from: [{ collectionId: 'grp' }], limit: 100 } }))).status, 403, 'בלי הסינון – נחסם');
      assert.equal((await q(E.off)).status, 403, 'עובד מושבת');
      // מנהל: /grp?pageSize=200 (שורה 64); עובד – 403
      assert.equal((await x(E.mgr, '/grp?pageSize=200')).status, 200);
      assert.equal((await x(E.e1, '/grp?pageSize=200')).status, 403);
      // r/{uid}: GET (404 כשאין), PATCH t ו-mu עם updateMask (שורות 68, 139, 221)
      assert.equal((await x(E.e1, '/grp/g1/r/' + E.e1)).status, 404);
      assert.equal((await x(E.e1, '/grp/g1/r/' + E.e1 + '?updateMask.fieldPaths=t', patch({ fields: { t: iv(Date.now() - 5000) } }))).status, 200);
      assert.equal((await x(E.e1, '/grp/g1/r/' + E.e1 + '?updateMask.fieldPaths=mu', patch({ fields: { mu: bv(true) } }))).status, 200);
      assert.equal((await x(E.e1, '/grp/g2/r/' + E.e1 + '?updateMask.fieldPaths=t', patch({ fields: { t: iv(1) } }))).status, 403);
      assert.equal((await x(E.e1, '/grp/g1/r/' + E.e2 + '?updateMask.fieldPaths=mu', patch({ fields: { mu: bv(true) } }))).status, 403);
      // grPost (שורות 176–178): POST ?documentId, txt נשלח גם בתמונה/סרטון (ריק), byN = fbBy().slice(0,60)
      const msg = (uid, k, txt, ext) => Object.assign({ by: sv(uid), byN: sv(uid.slice(0, 60)), t: iv(Date.now()), k: sv(k), txt: sv(txt) }, ext || {});
      assert.equal((await x(E.e1, '/grp/g1/m?documentId=mt1', post({ fields: msg(E.e1, 't', 'שלום') }))).status, 200);
      assert.equal((await x(E.e1, '/grp/g2/m?documentId=mt2', post({ fields: msg(E.e1, 't', 'שלום') }))).status, 403);
      assert.equal((await x(E.e1, '/grp/g1/m?documentId=mi1', post({ fields: msg(E.e1, 'img', '') }))).status, 200);
      // תמונה (שורה 195): PATCH p/1 { img, t, uid }
      const img = { img: sv('data:image/jpeg;base64,' + 'A'.repeat(500)), t: iv(Date.now()), uid: sv(E.e1) };
      assert.equal((await x(E.e1, '/grp/g1/m/mi1/p/1', patch({ fields: img }))).status, 200);
      assert.equal((await x(E.e1, '/grp/g1/m/mi1/p/1', patch({ fields: img }))).status, 403, 'בלי דריסה');
      assert.equal((await x(E.e1, '/grp/g1/m/mi1/p/1')).status, 200);
      // סרטון (שורות 214–217): קודם העלאה ל-Storage, אחר כך ההודעה עם vp = הנתיב המלא
      const vp = E.SP + 'grpv/g1/mv1';
      assert.equal((await x(E.e1, '/grp/g1/m?documentId=mv1', post({ fields: msg(E.e1, 'vid', '', { vp: sv(vp), vs: iv(12), vb: iv(2000000) }) }))).status, 200);
      assert.equal((await x(E.e1, '/grp/g1/m?documentId=mv2', post({ fields: msg(E.e1, 'vid', '', { vp: sv(vp), vs: iv(12), vb: iv(2000000) }) }))).status, 403, 'vp של הודעה אחרת');
      // מחיקת הודעה (שורות 226–227): עובד – 403, מנהל – 200
      assert.equal((await x(E.e1, '/grp/g1/m/mt1', { method: 'DELETE' })).status, 403);
      assert.equal((await x(E.mgr, '/grp/g1/m/mi1/p/1', { method: 'DELETE' })).status, 200);
      assert.equal((await x(E.mgr, '/grp/g1/m/mi1', { method: 'DELETE' })).status, 200);
      // הגדרות מנהל (שורות 251–252, 257): יצירה ב-POST ?documentId, עריכה ב-PATCH עם updateMask name/mem/ao/md, מחיקה
      const gf = { name: sv('חדשה'), mem: arr([E.e1, E.e2]), ao: bv(true), md: bv(false), by: sv(E.mgr), t: iv(Date.now()) };
      assert.equal((await x(E.mgr, '/grp?documentId=gn1', post({ fields: gf }))).status, 200);
      assert.equal((await x(E.e1, '/grp?documentId=gn2', post({ fields: Object.assign({}, gf, { by: sv(E.e1) }) }))).status, 403);
      const mask = '?' + ['name', 'mem', 'ao', 'md'].map((k) => 'updateMask.fieldPaths=' + k).join('&');
      assert.equal((await x(E.mgr, '/grp/gn1' + mask, patch({ fields: { name: sv('שם חדש'), mem: arr([E.e1]), ao: bv(false), md: bv(true) } }))).status, 200);
      assert.equal((await x(E.e1, '/grp/gn1' + mask, patch({ fields: { name: sv('x'), mem: arr([E.e1]), ao: bv(false), md: bv(true) } }))).status, 403);
      assert.equal((await x(E.e1, '/grp/gn1', { method: 'DELETE' })).status, 403);
      assert.equal((await x(E.mgr, '/grp/gn1', { method: 'DELETE' })).status, 200);
    });
  }
});
