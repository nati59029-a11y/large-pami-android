'use strict';
// "שליחת משימות" לעובד מורשה (19.11.2026): staff/{uid}.perms.tkS (רק השרת כותב) + dg == '1' במשימה (owner = השולח).
// העובד המורשה: שולח משימה לעובדים אחרים (role 'a', חובה נמענים, לא לעצמו, np 0–3, בלי pr ובלי תמונות מנהל), קורא את מה ששלח
// (גם אחרי שבוצע), מאשר / מחזיר רק כשממתינה לאישור, מוחק, מגיב וקורא תגובות ותמונות. שום יכולת מנהל אחרת.
// בלי המתג / המתג כובה / עובד מושבת / עסק אחר – כלום. כל בדיקה רצה פעמיים: בשורש וב-b/{bizId} (עסק bt; עסק bx = "עסק אחר").

const { describe, it, before, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const D1 = 86400000, H1 = 3600000;
let seq = 0;
const fresh = (p) => `${p}_${Date.now()}_${++seq}`;
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(200);

const ENVS = [
  { name: 'שורש', P: '', mgr: 'u_mgr', s: 'u_snd', s2: 'u_snd2', e1: 'u_emp', e2: H.OTHER, off: 'u_off', foreign: null },
  { name: 'עסק b/bt', P: 'b/bt/', mgr: 'bt_mgr', s: 'bt_snd', s2: 'bt_snd2', e1: 'bt_e1', e2: 'bt_e2', off: 'bt_off', foreign: 'bx_snd' },
];

for (const E of ENVS) {
  describe(`שליחת משימות (tkS / dg) – ${E.name}`, () => {
    let env;
    const fs = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
    const T = (id) => `${E.P}tasks/${id}`;
    const ST = (u) => `${E.P}staff/${u}`;
    const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
    const base = (o) => { const t = Date.now(); return Object.assign({ owner: E.s, by: E.s, role: 'a', txt: 'משימה', cr: t - H1, due: t + 4 * D1,
      st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '',
      to: [E.e1], toN: [E.e1], ow: E.e1, owN: E.e1, clt: t - H1, np: 0, mi: 0, wp: 0, dg: '1' }, o); };
    const waitOf = (o) => base(Object.assign({ st: 'wait', sub: Date.now() - H1, doneBy: E.e1 }, o));
    const doneOf = (o) => base(Object.assign({ st: 'done', open: '', sub: Date.now() - H1, ok: Date.now() - H1, doneBy: E.e1 }, o));
    // משימה חדשה של השולח (בזמן אמת)
    const mk = (o, who) => { const t = Date.now(), u = who || E.s; return Object.assign({ owner: u, by: u, role: 'a', txt: 'חדשה', cr: t, due: t + 4 * D1,
      st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '',
      to: [E.e1], toN: [E.e1], ow: E.e1, owN: E.e1, clt: t, np: 0, mi: 0, wp: 0, dg: '1' }, o); };
    const approve = (late) => ({ st: 'done', open: '', ok: Date.now(), late, note: '' });
    const reject = (o) => Object.assign({ st: 'open', img: '', sub: 0, doneBy: '', note: 'חסר צילום', rt: '1' }, o);
    const setTkS = (u, v) => prep((d) => d.doc(ST(u)).update({ 'perms.tkS': v }));

    before(async () => { env = await H.getEnv(); });
    beforeEach(async () => {
      await H.seed(env);
      await prep(async (d) => {
        const b = d.batch();
        const emp = (biz, u, o) => b.set(d.doc((biz ? `b/${biz}/` : '') + 'staff/' + u), Object.assign({ name: u, email: u + '@example.invalid', role: 'employee', active: true, pushTokens: [] }, o));
        if (E.P) {
          for (const [biz, mgr, emps] of [['bt', 'bt_mgr', ['bt_e1', 'bt_e2']], ['bx', 'bx_mgr', ['bx_e1']]]) {
            b.set(d.doc('b/' + biz), { name: biz, status: 'active', features: { tasks: true } });
            b.set(d.doc(`b/${biz}/admins/${mgr}`), { email: mgr + '@example.invalid' });
            emp(biz, mgr, { role: 'manager' });
            for (const u of emps) emp(biz, u);
          }
          emp('bt', 'bt_off', { active: false, perms: { tkS: true } });
          emp('bx', 'bx_snd', { perms: { tkS: true } });
        }
        const z = E.P ? 'bt' : '';
        emp(z, E.s, { perms: { incW: true, tkS: true } });
        emp(z, E.s2, { perms: { tkS: true } });
        if (!E.P) await d.doc('staff/u_off').update({ perms: { tkS: true } });
        const t = Date.now();
        b.set(d.doc(T('sO')), base({}));                                        // שלחתי – פתוחה
        b.set(d.doc(T('sW')), waitOf({}));                                      // שלחתי – ממתינה לאישור, בזמן
        b.set(d.doc(T('sWl')), waitOf({ dl: t - 2 * H1 }));                      // שלחתי – ממתינה, בוצעה אחרי היעד
        b.set(d.doc(T('sW0')), waitOf({ dl: 0 }));                              // שלחתי – בלי יעד
        b.set(d.doc(T('sWnp')), waitOf({ np: 2, wp: 2 }));                      // שלחתי – עם תמונות ביצוע
        b.set(d.doc(T('sD')), doneOf({}));                                      // שלחתי – בוצעה
        b.set(d.doc(T('sWme')), waitOf({ to: [E.s], toN: [E.s], ow: E.s, doneBy: E.s })); // המנהל העביר אליי – לא מאשר עבודה של עצמי
        b.set(d.doc(T('oW')), waitOf({ owner: E.s2, by: E.s2 }));               // של שולח אחר
        b.set(d.doc(T('oD')), doneOf({ owner: E.s2, by: E.s2 }));
        b.set(d.doc(T('mW')), waitOf({ owner: E.mgr, by: E.mgr, dg: '' }));     // של המנהל
        b.set(d.doc(T('mD')), doneOf({ owner: E.mgr, by: E.mgr, dg: '' }));
        b.set(d.doc(T('shW')), waitOf({ dg: '' }));                             // owner = העובד אבל בלי dg (כמו משימת משמרת) – לא "שלחתי"
        b.set(d.doc(T('shD')), doneOf({ dg: '' }));
        b.set(d.doc(T('sD') + '/c/c1'), { uid: E.e1, by: E.e1, txt: 'בוצע', t: t - H1 });
        b.set(d.doc(T('sD') + '/p/w1'), { img: IMG, t: t - H1, uid: E.e1 });
        await b.commit();
      });
    });

    it('יצירה: עובד מורשה שולח לעובד אחד / לכמה, עם בקשת תמונות 0–3; משימת עובד רגילה (w) – כמו היום', async () => {
      const w = fs(E.s);
      for (const np of [0, 1, 3]) await assertSucceeds(w.doc(T(fresh('n'))).set(mk({ np })));
      await assertSucceeds(w.doc(T(fresh('n'))).set(mk({ to: [E.e1, E.e2], toN: [E.e1, E.e2], ow: '', owN: '', clt: 0 })));
      await assertSucceeds(w.doc(T(fresh('n'))).set(mk({ dl: Date.now() + D1, pri: 'h' })));
      // הכי כבד שמותר (מגבלת 1000 הביטויים בכללים): 30 נמענים, 20 פריטים ברשימה, יעד, עדיפות, נושא, זמן ו-3 תמונות
      await assertSucceeds(w.doc(T(fresh('n'))).set(mk({ dl: Date.now() + D1, pri: 'h', cat: 'מלאי', est: 30, np: 3, ck: Array.from({ length: 20 }, (_, i) => 'פריט ' + i), ckd: [],
        to: Array.from({ length: 30 }, (_, i) => 'x' + i), toN: Array.from({ length: 30 }, (_, i) => 'n' + i), ow: '', owN: '', clt: 0 })));
      const t = Date.now();
      await assertSucceeds(w.doc(T(fresh('n'))).set({ owner: E.s, by: E.s, role: 'w', txt: 'רגילה', cr: t, due: t + 4 * D1, st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '' }));
    });

    it('יצירה: נמען = עצמי, בלי נמענים, pr, תמונות מנהל, np 4, role w עם dg, role a בלי dg, owner אחר, nd – נחסם', async () => {
      const bad = (o, who) => assertFails(fs(who || E.s).doc(T(fresh('n'))).set(mk(o, who)));
      await bad({ to: [E.s], toN: [E.s], ow: E.s });
      await bad({ to: [E.e1, E.s], toN: ['a', 'b'], ow: '' });
      const no = mk({}); for (const k of ['to', 'toN', 'ow', 'owN', 'clt', 'np', 'mi', 'wp']) delete no[k];
      await assertFails(fs(E.s).doc(T(fresh('n'))).set(no));
      await bad({ pr: '1' });
      await bad({ mi: 1 });
      await bad({ np: 4 });
      await bad({ role: 'w' });
      await bad({ dg: '' });
      await bad({ dg: '2' });
      await bad({ owner: E.s2 });
      await bad({ nd: Date.now() });
      await bad({ st: 'done', open: '' });
      await bad({ to: [E.e1, E.e2], toN: [E.e1, E.e2], ow: E.e1 }); // כמה נמענים – ow חייב להיות ריק (mgrNewOk)
    });

    it('יצירה עם dg: עובד בלי המתג, מנהל, מושבת, מחובר בלי תפקיד, עסק אחר – נחסם', async () => {
      await assertFails(fs(E.e1).doc(T(fresh('n'))).set(mk({ to: [E.e2], toN: [E.e2], ow: E.e2 }, E.e1)));
      await assertFails(fs(E.mgr).doc(T(fresh('n'))).set(mk({}, E.mgr)));
      await assertFails(fs(E.off).doc(T(fresh('n'))).set(mk({}, E.off)));
      await assertFails(fs('u_out').doc(T(fresh('n'))).set(mk({}, 'u_out')));
      if (E.foreign) await assertFails(fs(E.foreign).doc(T(fresh('n'))).set(mk({}, E.foreign)));
      // מנהל בלי dg – כמו היום
      const m0 = mk({}, E.mgr); delete m0.dg;
      await assertSucceeds(fs(E.mgr).doc(T(fresh('n'))).set(m0));
    });

    it('קריאה: מה ששלחתי (גם בוצעה, גם תגובות ותמונות); לא משימה סגורה של שולח אחר / של המנהל / בלי dg', async () => {
      const w = fs(E.s);
      for (const id of ['sO', 'sW', 'sD']) await assertSucceeds(w.doc(T(id)).get());
      await assertSucceeds(w.doc(T('sD') + '/c/c1').get());
      await assertSucceeds(w.collection(T('sD') + '/c').get());
      await assertSucceeds(w.doc(T('sD') + '/p/w1').get());
      for (const id of ['oD', 'mD', 'shD']) await assertFails(w.doc(T(id)).get());
      await assertFails(w.collection(T('oD') + '/c').get());
      await assertFails(w.doc(T('mD') + '/p/w1').get());
      // עובד בלי המתג – לא קורא משימה שבוצעה (גם לא כנמען, כמו היום)
      await assertFails(fs(E.e2).doc(T('sD')).get());
    });

    it('שאילתה: owner == אני && dg == "1" – מותר (כולל בוצעו); owner בלבד / dg בלבד – נחסם', async () => {
      const q = fs(E.s).collection(`${E.P}tasks`);
      const r = await assertSucceeds(q.where('owner', '==', E.s).where('dg', '==', '1').get());
      const ids = r.docs.map((d) => d.id).sort();
      for (const id of ['sD', 'sO', 'sW']) if (!ids.includes(id)) throw new Error('חסר ' + id + ': ' + ids.join(','));
      if (ids.includes('shD') || ids.includes('oD')) throw new Error('נכנסה משימה לא שלי: ' + ids.join(','));
      await assertFails(q.where('owner', '==', E.s).get());
      await assertFails(q.where('dg', '==', '1').get());
      await assertFails(q.where('owner', '==', E.s2).where('dg', '==', '1').get());
      await assertFails(fs(E.e1).collection(`${E.P}tasks`).where('owner', '==', E.e1).where('dg', '==', '1').get());
    });

    it('אישור: ממתינה → בוצעה, late לפי היעד (dl / due; dl = 0 תמיד בזמן); late שגוי, ok ישן, הערה – נחסם', async () => {
      const w = fs(E.s);
      await assertFails(w.doc(T('sW')).update(approve('1')));
      await assertSucceeds(w.doc(T('sW')).update(approve('')));
      await assertFails(w.doc(T('sWl')).update(approve('')));
      await assertSucceeds(w.doc(T('sWl')).update(approve('1')));
      await assertFails(w.doc(T('sW0')).update(approve('1')));
      await assertFails(w.doc(T('sW0')).update(Object.assign(approve(''), { ok: Date.now() - 10 * 60000 })));
      await assertFails(w.doc(T('sW0')).update(Object.assign(approve(''), { note: 'x' })));
      await assertSucceeds(w.doc(T('sW0')).update(approve('')));
      await assertSucceeds(w.doc(T('sWnp')).update(approve('')));
    });

    it('החזרה: ממתינה → פתוחה עם הערה (גם עם סימון תגובה ו-wp 0); שדות אחרים / ממצב אחר – נחסם', async () => {
      const w = fs(E.s);
      await assertSucceeds(w.doc(T('sW')).update(reject({})));
      await assertSucceeds(w.doc(T('sWnp')).update(reject({ wp: 0, cAt: Date.now(), cBy: E.s, cT: 'חסר צילום', cN: E.s, open: '1', ok: 0, late: '' })));
      await assertFails(w.doc(T('sWl')).update(reject({ wp: 1 })));
      await assertFails(w.doc(T('sWl')).update(reject({ txt: 'שונה' })));
      await assertFails(w.doc(T('sWl')).update(reject({ cAt: Date.now(), cBy: E.e1 })));
      await assertFails(w.doc(T('sWl')).update(reject({ cN: 'מישהו', cAt: Date.now(), cBy: E.s })));
      await assertFails(w.doc(T('sWl')).update(reject({ note: 'א'.repeat(501) })));
      await assertFails(w.doc(T('sD')).update(reject({})), 'מבוצעת – רק המנהל מחזיר');
    });

    it('השולח לא עורך ולא מנהל: פתוחה → בוצעה, txt/to/ow/dl/pri/nd/pr/np/owner/dg, העברה – נחסם', async () => {
      const w = fs(E.s);
      const n = Date.now();
      await assertFails(w.doc(T('sO')).update({ st: 'done', open: '', ok: n, late: '', note: '' }));
      for (const p of [{ txt: 'אחר' }, { to: [E.e2] }, { ow: E.e2, owN: E.e2 }, { ow: '' }, { dl: n + D1 }, { pri: 'h' }, { nd: n, ndN: E.s }, { pr: '1' }, { np: 3 }, { owner: E.s2 }, { dg: '' }, { mi: 2 }]) {
        await assertFails(w.doc(T('sO')).update(p), JSON.stringify(p));
        await assertFails(w.doc(T('sW')).update(p), JSON.stringify(p));
      }
      await assertFails(w.doc(T('sW')).update(Object.assign(approve(''), { txt: 'אחר' })));
    });

    it('אישור / החזרה של משימה לא שלי (שולח אחר, מנהל, בלי dg) או כשאני המטפל – נחסם', async () => {
      const w = fs(E.s);
      for (const id of ['oW', 'mW', 'shW', 'sWme']) {
        await assertFails(w.doc(T(id)).update(approve('')), id);
        await assertFails(w.doc(T(id)).update(reject({})), id);
      }
      // עובד אחר (נמען, בלי המתג) לא מאשר
      await assertFails(fs(E.e1).doc(T('sW')).update(approve('')));
      await assertFails(fs(E.s2).doc(T('sW')).update(approve('')));
    });

    it('מחיקה: מה ששלחתי (בכל מצב); של המנהל / שולח אחר / בלי dg / עובד אחר – נחסם', async () => {
      const w = fs(E.s);
      for (const id of ['sO', 'sW', 'sD']) await assertSucceeds(w.doc(T(id)).delete());
      for (const id of ['mW', 'mD', 'oW', 'shW']) await assertFails(w.doc(T(id)).delete(), id);
      await assertFails(fs(E.e1).doc(T('sWl')).delete());
    });

    it('תגובות: מגיב במה ששלחתי בכל מצב (בלי nc), מסמן תגובה ו"נקרא"; לא מוחק תגובות, לא כותב/מוחק תמונות', async () => {
      const w = fs(E.s), n = Date.now();
      for (const id of ['sD', 'sW', 'sO']) await assertSucceeds(w.doc(T(id) + '/c/' + fresh('c')).set({ uid: E.s, by: E.s, txt: 'שאלה', t: n }));
      await assertSucceeds(w.doc(T('sD')).update({ cAt: n, cBy: E.s, cT: 'שאלה', cN: E.s }));
      await assertSucceeds(w.doc(T('sD')).update({ rd: { [E.s]: n } }));
      await assertFails(w.doc(T('mD') + '/c/' + fresh('c')).set({ uid: E.s, by: E.s, txt: 'x', t: n }));
      await assertFails(w.doc(T('sD') + '/c/c1').delete());
      await assertFails(w.doc(T('sO') + '/p/m1').set({ img: IMG, t: n, uid: E.s }));
      await assertFails(w.doc(T('sO') + '/p/w1').set({ img: IMG, t: n, uid: E.s }));
      await assertFails(w.doc(T('sD') + '/p/w1').delete());
    });

    it('staff: השולח לא משנה לעצמו את המתג, לא קורא את רשימת העובדים ולא מסמך של עובד אחר', async () => {
      const w = fs(E.s);
      await assertFails(w.doc(ST(E.s)).update({ 'perms.tkS': false }));
      await assertFails(fs(E.e1).doc(ST(E.e1)).update({ perms: { tkS: true } }));
      await assertFails(w.collection(`${E.P}staff`).get());
      await assertFails(w.doc(ST(E.e1)).get());
    });

    it('המתג כובה / העובד הושבת: אין קריאה, שאילתה, יצירה, אישור, מחיקה או תגובה – גם במה שכבר שלח', async () => {
      for (const off of [() => setTkS(E.s, false), () => prep((d) => d.doc(ST(E.s)).update({ active: false }))]) {
        await off();
        const w = fs(E.s), n = Date.now();
        await assertFails(w.doc(T('sD')).get());
        await assertFails(w.collection(`${E.P}tasks`).where('owner', '==', E.s).where('dg', '==', '1').get());
        await assertFails(w.doc(T(fresh('n'))).set(mk({})));
        await assertFails(w.doc(T('sW')).update(approve('')));
        await assertFails(w.doc(T('sW')).update(reject({})));
        await assertFails(w.doc(T('sO')).delete());
        await assertFails(w.doc(T('sD') + '/c/' + fresh('c')).set({ uid: E.s, by: E.s, txt: 'x', t: n }));
        await assertFails(w.collection(T('sD') + '/c').get());
        await prep((d) => d.doc(ST(E.s)).update({ 'perms.tkS': true, active: true }));
      }
      // עובד ישן בלי perms – כבוי
      await prep((d) => d.doc(ST(E.s)).set({ name: E.s, email: E.s + '@example.invalid', role: 'employee', active: true, pushTokens: [] }));
      await assertFails(fs(E.s).doc(T('sD')).get());
      await assertFails(fs(E.s).doc(T(fresh('n'))).set(mk({})));
    });

    it('המנהל: רואה ומטפל במשימות dg כמו בכל משימה (אישור, החזרה, מחיקה)', async () => {
      const m = fs(E.mgr);
      await assertSucceeds(m.doc(T('sD')).get());
      await assertSucceeds(m.doc(T('sW')).update(approve('')));
      await assertSucceeds(m.doc(T('sWl')).update(reject({})));
      await assertSucceeds(m.doc(T('oD')).delete());
    });

    it('גלאי rv/tk3: צוות – get מותר (404 = הכללים החדשים); מושבת / בלי תפקיד – נחסם', async () => {
      await assertSucceeds(fs(E.s).doc(`${E.P}rv/tk3`).get());
      await assertSucceeds(fs(E.e1).doc(`${E.P}rv/tk3`).get());
      await assertSucceeds(fs(E.mgr).doc(`${E.P}rv/tk3`).get());
      await assertFails(fs(E.off).doc(`${E.P}rv/tk3`).get());
      await assertFails(fs('u_out').doc(`${E.P}rv/tk3`).get());
    });

    if (E.foreign) {
      it('עסק אחר: שולח מורשה בעסק bx לא קורא, לא מאשר ולא מוחק משימות של bt', async () => {
        await prep((d) => d.doc(T('fx')).set(doneOf({ owner: E.foreign, by: E.foreign })));
        const w = fs(E.foreign);
        await assertFails(w.doc(T('fx')).get());
        await assertFails(w.doc(T('fx')).delete());
        await assertFails(w.doc(T('sW')).update(approve('')));
      });
    }
  });
}
