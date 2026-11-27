'use strict';
// הדפסת דף אכיל, סבב 2 (26.11.2026): תור ההדפסה לתחנה במחשב – Firestore edbq/{id} ו-edbs/main, Storage edb_tmp/{jobId}/p{i}.png.
// בתוך עסק b (b/bz/...) ובשורש (לארג' פעמי, legacy). רץ מול האמולטור (חלק מ-test:multibiz:5). לכל תא: "מותר" ו"נחסם".
const { describe, it, before, after, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false, shf: false, yl: false, tkS: false, lbl: false, edb: false };
const PNG = { contentType: 'image/png' };
const MB30 = 30 * 1024 * 1024;
const DAY = 864e5;
const up = (ref, data, meta) => new Promise((res, rej) => ref.put(data, meta).then(res, rej));

// oth = מנהל של עסק אחר (bx) – ב-b; בשורש – מנהל של b/bz (אין לו מסמך בשורש)
const ENVS = [
  { name: 'b/{bizId}', P: 'b/bz/', biz: 'bz', mgr: 'z_mgr', edb: 'z_edb', edb2: 'z_edb2', noe: 'z_noe', old: 'z_old', out: 'z_out', oth: 'x_mgr' },
  { name: 'שורש (legacy)', P: '', biz: 'largpeami', mgr: 'r_mgr', edb: 'r_edb', edb2: 'r_edb2', noe: 'r_noe', old: 'r_old', out: 'r_out', oth: 'z_mgr' },
];

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
const st = (uid) => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).storage();
const job = (uid, x) => Object.assign({ by: uid, at: Date.now(), st: 'up', n: 1 }, x || {});
const stn = (uid, x) => Object.assign({ by: uid, at: Date.now(), on: true, pr: 'EPSON L130 Series', hp: true }, x || {});

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    const user = (uid, bizId, role, active) => b.set(d.doc('users/' + uid), { bizId, role, active, bizStatus: 'active', email: uid + '@example.invalid', createdAt: 1 });
    // עסק b
    for (const z of ['bz', 'bx']) b.set(d.doc('b/' + z), { name: z, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: {} });
    b.set(d.doc('b/bz/admins/z_mgr'), { email: 'z_mgr@example.invalid' });
    b.set(d.doc('b/bz/staff/z_mgr'), { name: 'z_mgr', role: 'manager', active: true }); user('z_mgr', 'bz', 'admin', true);
    b.set(d.doc('b/bx/admins/x_mgr'), { email: 'x_mgr@example.invalid' });
    b.set(d.doc('b/bx/staff/x_mgr'), { name: 'x_mgr', role: 'manager', active: true }); user('x_mgr', 'bx', 'admin', true);
    const zs = (uid, active, perms) => { b.set(d.doc('b/bz/staff/' + uid), Object.assign({ name: uid, role: 'employee', active }, perms ? { perms } : {})); user(uid, 'bz', 'worker', active); };
    zs('z_edb', true, Object.assign({}, NONE, { edb: true })); zs('z_edb2', true, Object.assign({}, NONE, { edb: true }));
    zs('z_noe', true, Object.assign({}, NONE)); zs('z_old', true, null); zs('z_out', false, Object.assign({}, NONE, { edb: true }));
    // לארג' פעמי בשורש (legacy)
    b.set(d.doc('admins/r_mgr'), { email: 'r_mgr@example.invalid' }); user('r_mgr', 'largpeami', 'admin', true);
    const rs = (uid, active, perms) => { b.set(d.doc('staff/' + uid), Object.assign({ name: uid, active }, perms ? { perms } : {})); user(uid, 'largpeami', 'worker', active); };
    rs('r_edb', true, Object.assign({}, NONE, { edb: true })); rs('r_edb2', true, Object.assign({}, NONE, { edb: true }));
    rs('r_noe', true, Object.assign({}, NONE)); rs('r_old', true, null); rs('r_out', false, Object.assign({}, NONE, { edb: true }));
    await b.commit();
  });
}

before(async () => { env = await H.getEnv(); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

for (const E of ENVS) {
  const R = (p) => E.P + p;
  const F = (id, i) => E.P + 'edb_tmp/' + id + '/p' + (i || 0) + '.png';
  const put = (id, x) => prep((d) => d.doc(R('edbq/' + id)).set(x));

  describe(`דף אכיל – תור הדפסה, Firestore (${E.name})`, () => {
    beforeEach(seed);

    it('יצירת עבודה: מנהל ועובד עם edb – במצב up; בלי edb / ישן / מושבת / עסק אחר / לא מחובר – נחסם', async () => {
      await assertSucceeds(db(E.edb).doc(R('edbq/job_edb_0001')).set(job(E.edb)));
      await assertSucceeds(db(E.mgr).doc(R('edbq/job_mgr_0001')).set(job(E.mgr, { n: 10, msg: 'דף אכיל' })));
      for (const u of [E.noe, E.old, E.out, E.oth]) await assertFails(db(u).doc(R('edbq/job_' + u + '_01')).set(job(u)), u);
      await assertFails(env.unauthenticatedContext().firestore().doc(R('edbq/job_anon_001')).set(job('x')));
    });
    it('יצירת עבודה: שדות לא תקינים נחסמים', async () => {
      const bad = [{ st: 'new' }, { st: 'taken' }, { n: 0 }, { n: 11 }, { n: 1.5 }, { n: '1' }, { at: 'now' }, { at: 0 }, { at: 1 }, { at: Date.now() - 11 * 60000 }, { at: Date.now() + 11 * 60000 }, { by: E.edb2 }, { msg: 'x'.repeat(201) }, { msg: 5 }, { tk: E.edb }, { extra: 1 }, { code: 'paper-out' }, { ts: 1 }, { ackA: true }, { ackS: true }];
      for (const x of bad) await assertFails(db(E.edb).doc(R('edbq/job_bad_0001')).set(job(E.edb, x)), JSON.stringify(x).slice(0, 40));
      await assertFails(db(E.edb).doc(R('edbq/short')).set(job(E.edb)), 'מזהה קצר');
      await assertFails(db(E.edb).doc(R('edbq/job_bad_0002')).set({ by: E.edb, at: Date.now(), st: 'up' }), 'חסר n');
    });
    it('סבב 5 – שעון הטלפון: at עד 10 דקות הפרש (קדימה ואחורה) מותר; 11 דקות – נחסם', async () => {
      await assertSucceeds(db(E.edb).doc(R('edbq/job_clk_0001')).set(job(E.edb, { at: Date.now() - 9 * 60000 })), '9 דקות אחורה');
      await assertSucceeds(db(E.edb).doc(R('edbq/job_clk_0002')).set(job(E.edb, { at: Date.now() + 9 * 60000 })), '9 דקות קדימה');
      await assertSucceeds(db(E.edb).doc(R('edbq/job_clk_0003')).set(job(E.edb, { at: Date.now() + 5 * 60000 })), '5 דקות קדימה (היה נחסם עם nowOk)');
      await assertFails(db(E.edb).doc(R('edbq/job_clk_0004')).set(job(E.edb, { at: Date.now() - 11 * 60000 })), '11 דקות אחורה');
      await assertFails(db(E.edb).doc(R('edbq/job_clk_0005')).set(job(E.edb, { at: Date.now() + 11 * 60000 })), '11 דקות קדימה');
      await assertFails(db(E.edb).doc(R('edbq/job_clk_0006')).set(job(E.edb, { at: Date.now() + 9.5 * 60000 + 0.5 })), 'at לא שלם');
    });
    it('מעברי מצב: השולח up→new; התחנה new→taken (tk = עצמה) →done; אין קפיצות ואין שינוי שדות אחרים', async () => {
      await put('j1', job(E.edb));
      await assertFails(db(E.edb2).doc(R('edbq/j1')).update({ st: 'new' }), 'רק השולח מעביר ל-new');
      await assertFails(db(E.edb2).doc(R('edbq/j1')).update({ st: 'taken', tk: E.edb2 }), 'אין תפיסה לפני new');
      await assertFails(db(E.edb).doc(R('edbq/j1')).update({ st: 'done' }), 'up→done');
      await assertFails(db(E.edb).doc(R('edbq/j1')).update({ st: 'new', n: 2 }), 'שינוי n');
      await assertSucceeds(db(E.edb).doc(R('edbq/j1')).update({ st: 'new' }));
      await assertFails(db(E.noe).doc(R('edbq/j1')).update({ st: 'taken', tk: E.noe }), 'בלי edb – לא תופס');
      await assertFails(db(E.edb2).doc(R('edbq/j1')).update({ st: 'taken', tk: E.edb }), 'tk של מישהו אחר');
      await assertFails(db(E.edb2).doc(R('edbq/j1')).update({ st: 'taken' }), 'בלי tk');
      await assertFails(db(E.edb2).doc(R('edbq/j1')).update({ st: 'done' }), 'new→done');
      await assertSucceeds(db(E.edb2).doc(R('edbq/j1')).update({ st: 'taken', tk: E.edb2, msg: 'המחשב מדפיס' }));
      await assertFails(db(E.mgr).doc(R('edbq/j1')).update({ st: 'taken', tk: E.mgr }), 'תפיסה שנייה – העבודה כבר taken');
      await assertFails(db(E.edb).doc(R('edbq/j1')).update({ st: 'err', msg: 'בוטל' }), 'השולח לא מסמן err אחרי שנתפסה בלי code canceled (סבב 5)');
      await assertFails(db(E.mgr).doc(R('edbq/j1')).update({ st: 'done' }), 'רק התחנה שתפסה מסיימת');
      await assertFails(db(E.edb2).doc(R('edbq/j1')).update({ st: 'done', tk: E.edb }), 'שינוי tk בסיום');
      await assertSucceeds(db(E.edb2).doc(R('edbq/j1')).update({ st: 'done', msg: 'הודפס' }));
      await assertFails(db(E.edb2).doc(R('edbq/j1')).update({ st: 'err' }), 'done סופי');
      await assertFails(db(E.edb).doc(R('edbq/j1')).update({ st: 'new' }), 'done סופי – גם לשולח');
      await put('j2', job(E.edb, { st: 'taken', tk: E.edb2 }));
      await assertSucceeds(db(E.edb2).doc(R('edbq/j2')).update({ st: 'err', msg: 'המדפסת לא נמצאה' }));
    });
    it('סבב 3 – דיווח מצב בזמן ההדפסה: רק התחנה שתפסה, taken→taken, רק msg/code/ts עם מגבלות', async () => {
      await put('p1', job(E.edb, { st: 'taken', tk: E.edb2 }));
      const rep = (x) => Object.assign({ msg: 'חסר נייר במדפסת', code: 'paper-out', ts: Date.now() }, x || {});
      await assertSucceeds(db(E.edb2).doc(R('edbq/p1')).update(rep()));
      await assertSucceeds(db(E.edb2).doc(R('edbq/p1')).update(rep({ code: 'printing', msg: 'מדפיס' })), 'דיווח נוסף');
      for (const u of [E.edb, E.mgr, E.noe, E.oth]) await assertFails(db(u).doc(R('edbq/p1')).update(rep()), 'לא התחנה שתפסה: ' + u);
      const bad = [{ code: 'Paper Out' }, { code: 'x'.repeat(25) }, { code: 5 }, { code: '' }, { ts: 'now' }, { ts: 0 }, { ts: 1.5 }, { msg: 'x'.repeat(201) }, { n: 2 }, { tk: E.edb }, { by: E.edb2 }, { at: 1 }, { st: 'new' }, { extra: 1 }, { ackS: true }, { ackA: true }];
      for (const x of bad) await assertFails(db(E.edb2).doc(R('edbq/p1')).update(rep(x)), JSON.stringify(x).slice(0, 40));
      await assertSucceeds(db(E.edb2).doc(R('edbq/p1')).update({ st: 'done', msg: 'הודפס', code: 'done', ts: Date.now() }), 'סיום עם code/ts');
      await assertFails(db(E.edb2).doc(R('edbq/p1')).update(rep()), 'אחרי done – אין דיווח');
      await put('p2', job(E.edb, { st: 'new' }));
      await assertFails(db(E.edb2).doc(R('edbq/p2')).update(rep()), 'עבודה new – אין דיווח');
      await assertFails(db(E.edb2).doc(R('edbq/p2')).update({ st: 'taken', tk: E.edb2, code: 'printing' }), 'תפיסה עם code – לא');
      await put('p3', job(E.edb, { st: 'taken', tk: E.edb2 }));
      await assertSucceeds(db(E.edb2).doc(R('edbq/p3')).update({ st: 'err', msg: 'נייר תקוע', code: 'jam', ts: Date.now() }), 'כישלון עם code');
    });
    it('סבב 3 – אישור ההודעה: השולח ackA, התחנה ackS; רק true, רק אחרי done/err, כל צד רק את השדה שלו', async () => {
      await put('a1', job(E.edb, { st: 'done', tk: E.edb2, msg: 'הודפס' }));
      await assertFails(db(E.edb2).doc(R('edbq/a1')).update({ ackA: true }), 'התחנה לא מאשרת בשם השולח');
      await assertFails(db(E.edb).doc(R('edbq/a1')).update({ ackS: true }), 'השולח לא מאשר בשם התחנה');
      await assertFails(db(E.mgr).doc(R('edbq/a1')).update({ ackA: true }), 'מנהל שאינו צד');
      await assertFails(db(E.edb).doc(R('edbq/a1')).update({ ackA: false }), 'רק true');
      await assertFails(db(E.edb).doc(R('edbq/a1')).update({ ackA: true, msg: 'x' }), 'עם שדה נוסף');
      await assertFails(db(E.edb).doc(R('edbq/a1')).update({ ackA: true, ackS: true }), 'שני הצדדים יחד');
      await assertSucceeds(db(E.edb).doc(R('edbq/a1')).update({ ackA: true }));
      await assertSucceeds(db(E.edb2).doc(R('edbq/a1')).update({ ackS: true }));
      await assertFails(db(E.edb2).doc(R('edbq/a1')).update({ ackS: false }), 'אין ביטול אישור');
      await assertFails(db(E.edb).doc(R('edbq/a1')).update({ st: 'err' }), 'done עדיין סופי');
      await put('a2', job(E.edb, { st: 'err', tk: E.edb2, msg: 'נייר תקוע', code: 'jam' }));
      await assertSucceeds(db(E.edb2).doc(R('edbq/a2')).update({ ackS: true }), 'ackS אחרי err');
      await assertSucceeds(db(E.edb).doc(R('edbq/a2')).update({ ackA: true }), 'ackA אחרי err');
      await put('a3', job(E.edb, { st: 'taken', tk: E.edb2 }));
      await assertFails(db(E.edb).doc(R('edbq/a3')).update({ ackA: true }), 'לפני סיום – השולח');
      await assertFails(db(E.edb2).doc(R('edbq/a3')).update({ ackS: true }), 'לפני סיום – התחנה');
      await put('a4', job(E.edb, { st: 'err', msg: 'בוטל' }));
      await assertSucceeds(db(E.edb).doc(R('edbq/a4')).update({ ackA: true }), 'ביטול בלי תחנה – השולח מאשר');
      await assertFails(db(E.edb2).doc(R('edbq/a4')).update({ ackS: true }), 'אין tk – אין ackS');
    });
    it('ביטול: השולח up→err ו-new→err; אחר – רק עבודה new ישנה מ-24 שעות', async () => {
      await put('c1', job(E.edb)); await put('c2', job(E.edb, { st: 'new' }));
      await put('c3', job(E.edb, { st: 'new' })); await put('c4', job(E.edb, { st: 'new', at: Date.now() - DAY - 60000 }));
      await assertFails(db(E.edb2).doc(R('edbq/c1')).update({ st: 'err' }), 'אחר – up');
      await assertSucceeds(db(E.edb).doc(R('edbq/c1')).update({ st: 'err', msg: 'בוטל' }));
      await assertSucceeds(db(E.edb).doc(R('edbq/c2')).update({ st: 'err', msg: 'בוטל' }));
      await assertFails(db(E.edb2).doc(R('edbq/c3')).update({ st: 'err', msg: 'x' }), 'אחר – new טרי');
      await assertFails(db(E.edb).doc(R('edbq/c3')).update({ st: 'err', msg: 'x'.repeat(201) }), 'msg ארוך');
      await assertSucceeds(db(E.edb2).doc(R('edbq/c4')).update({ st: 'err', msg: 'פג תוקף' }), 'תחנה – ישנה מ-24 שעות');
    });
    it('קריאה: מנהל ועובד עם edb (כולל שאילתת st == new); בלי edb / ישן / מושבת / עסק אחר – נחסם. מחיקה – מנהל בלבד', async () => {
      await put('r1', job(E.edb, { st: 'new' }));
      await assertSucceeds(db(E.edb2).collection(R('edbq')).where('st', '==', 'new').limit(10).get());
      await assertSucceeds(db(E.mgr).doc(R('edbq/r1')).get());
      for (const u of [E.noe, E.old, E.out, E.oth]) { await assertFails(db(u).doc(R('edbq/r1')).get(), u); await assertFails(db(u).collection(R('edbq')).get(), u); }
      await assertFails(db(E.edb).doc(R('edbq/r1')).delete(), 'גם השולח לא מוחק');
      await assertSucceeds(db(E.mgr).doc(R('edbq/r1')).delete());
    });
    it('edbs/main (התחנה): מנהל ועובד עם edb כותבים וקוראים; שדות / מזהה לא תקינים, בלי edb – נחסם; מחיקה – מנהל', async () => {
      await assertSucceeds(db(E.edb).doc(R('edbs/main')).set(stn(E.edb)));
      await assertSucceeds(db(E.mgr).doc(R('edbs/main')).set(stn(E.mgr, { on: false })));
      await assertSucceeds(db(E.edb).doc(R('edbs/main')).set({ by: E.edb, at: Date.now(), on: true }));
      await assertSucceeds(db(E.edb2).doc(R('edbs/main')).get());
      for (const x of [{ by: E.mgr }, { on: 'yes' }, { pr: 'x'.repeat(81) }, { hp: 1 }, { at: '1' }, { extra: 1 }]) await assertFails(db(E.edb).doc(R('edbs/main')).set(stn(E.edb, x)), JSON.stringify(x).slice(0, 30));
      await assertFails(db(E.edb).doc(R('edbs/other')).set(stn(E.edb)), 'רק main');
      for (const u of [E.noe, E.old, E.out, E.oth]) { await assertFails(db(u).doc(R('edbs/main')).get(), u); await assertFails(db(u).doc(R('edbs/main')).set(stn(u)), u); }
      await assertFails(db(E.edb).doc(R('edbs/main')).delete());
      await assertSucceeds(db(E.mgr).doc(R('edbs/main')).delete());
    });
  });

  describe(`דף אכיל – סבב 5: ביטול הדפסה (${E.name})`, () => {
    beforeEach(seed);
    const CX = (x) => Object.assign({ st: 'err', code: 'canceled', msg: 'ההדפסה בוטלה', ts: Date.now() }, x || {});
    const ST = { up: {}, new: { st: 'new' }, taken: { st: 'taken', tk: 'TK' } };
    it('ביטול מכל מצב שאינו סופי (up / new / taken): השולח, מנהל; התחנה שתפסה – ב-taken', async () => {
      for (const [k, x] of Object.entries(ST)) {
        const mk = async (id) => put(id, job(E.edb, Object.assign({}, x, x.tk ? { tk: E.edb2 } : {})));
        await mk('x_by_' + k); await assertSucceeds(db(E.edb).doc(R('edbq/x_by_' + k)).update(CX()), 'השולח – ' + k);
        await mk('x_mg_' + k); await assertSucceeds(db(E.mgr).doc(R('edbq/x_mg_' + k)).update(CX({ msg: 'בוטל בידי מנהל' })), 'מנהל – ' + k);
        await mk('x_tk_' + k);
        if (k === 'taken') await assertSucceeds(db(E.edb2).doc(R('edbq/x_tk_' + k)).update(CX({ msg: 'ההדפסה בוטלה במחשב' })), 'התחנה שתפסה – taken');
        else await assertFails(db(E.edb2).doc(R('edbq/x_tk_' + k)).update(CX()), 'עובד אחר עם edb (לא שולח, לא תחנה) – ' + k);
      }
    });
    it('ביטול נחסם: בלי edb / ישן / מושבת / עסק אחר / לא מחובר; עובד אחר עם edb בעבודה שתפס מישהו אחר', async () => {
      for (const k of Object.keys(ST)) {
        await put('y_' + k, job(E.edb, Object.assign({}, ST[k], ST[k].tk ? { tk: E.mgr } : {})));
        for (const u of [E.noe, E.old, E.out, E.oth]) await assertFails(db(u).doc(R('edbq/y_' + k)).update(CX()), k + ' ' + u);
        await assertFails(env.unauthenticatedContext().firestore().doc(R('edbq/y_' + k)).update(CX()), 'לא מחובר – ' + k);
        await assertFails(db(E.edb2).doc(R('edbq/y_' + k)).update(CX()), 'עובד אחר עם edb – ' + k);
      }
    });
    it('ביטול: רק code canceled, רק st err, רק st/msg/code/ts; לא ממצב סופי', async () => {
      await put('z1', job(E.edb, { st: 'new' }));
      const bad = [{ st: 'done' }, { st: 'new' }, { code: 'cancel' }, { code: 'Canceled' }, { tk: E.edb }, { n: 2 }, { by: E.edb2 }, { at: 1 }, { alb: 'abcdefgh' }, { ackA: true }, { msg: 'x'.repeat(201) }, { ts: 'x' }, { extra: 1 }];
      for (const x of bad) await assertFails(db(E.edb).doc(R('edbq/z1')).update(CX(x)), JSON.stringify(x).slice(0, 40));
      await assertFails(db(E.edb).doc(R('edbq/z1')).update({ st: 'err', msg: 'בוטל', code: 'canceled', ts: Date.now(), ackA: true }), 'ביטול + אישור יחד');
      for (const f of ['done', 'err']) {
        await put('z_' + f, job(E.edb, { st: f, tk: E.edb2 }));
        for (const u of [E.edb, E.edb2, E.mgr]) await assertFails(db(u).doc(R('edbq/z_' + f)).update(CX()), f + ' סופי – ' + u);
      }
      await put('z2', job(E.edb, { st: 'taken', tk: E.edb2 }));
      await assertSucceeds(db(E.edb).doc(R('edbq/z2')).update({ st: 'err', code: 'canceled' }), 'מינימום: st + code');
      await assertSucceeds(db(E.edb).doc(R('edbq/z2')).update({ ackA: true }), 'אחרי ביטול – השולח מאשר');
      await assertSucceeds(db(E.edb2).doc(R('edbq/z2')).update({ ackS: true }), 'אחרי ביטול – התחנה מאשרת');
      await put('z3', job(E.edb, { st: 'taken', tk: E.edb2 }));
      await assertSucceeds(db(E.edb2).doc(R('edbq/z3')).update({ st: 'err', code: 'timeout', ts: Date.now(), msg: 'ההדפסה בוטלה – עברו שעתיים בלי שהמדפסת הדפיסה (סיבה: חסר נייר במדפסת)' }), 'ביטול אוטומטי (timeout) – התחנה');
    });
  });

  describe(`דף אכיל – סבב 5: אלבום, Firestore (${E.name})`, () => {
    beforeEach(seed);
    const alb = (uid, x) => Object.assign({ nm: 'עוגת יום הולדת', k: 'c12', by: uid, at: Date.now(), w: 2480, h: 3508, st: 'up' }, x || {});
    const putA = (id, x) => prep((d) => d.doc(R('edba/' + id)).set(x));
    it('יצירה: מנהל ועובד עם edb, במצב up; בלי edb / ישן / מושבת / עסק אחר / לא מחובר – נחסם', async () => {
      await assertSucceeds(db(E.edb).doc(R('edba/alb_edb_0001')).set(alb(E.edb)));
      await assertSucceeds(db(E.mgr).doc(R('edba/alb_mgr_0001')).set(alb(E.mgr, { k: 'full', at: Date.now() + 9 * 60000 })));
      for (const u of [E.noe, E.old, E.out, E.oth]) await assertFails(db(u).doc(R('edba/alb_' + u + '_01')).set(alb(u)), u);
      await assertFails(env.unauthenticatedContext().firestore().doc(R('edba/alb_anon_001')).set(alb('x')));
    });
    it('יצירה: שדות לא תקינים נחסמים (רשימה סגורה ומגבלות)', async () => {
      const bad = [{ st: 'ok' }, { nm: '' }, { nm: 'x'.repeat(61) }, { nm: 5 }, { k: 'c13' }, { k: 'FULL' }, { k: 7 }, { by: E.edb2 }, { at: Date.now() - 11 * 60000 }, { at: Date.now() + 11 * 60000 }, { at: '1' },
        { w: 0 }, { w: 4001 }, { w: 1.5 }, { h: -1 }, { h: '3508' }, { extra: 1 }, { page: 'edb_album/x/page.png' }, { url: 'https://evil.example/x.png' }];
      for (const x of bad) await assertFails(db(E.edb).doc(R('edba/alb_bad_0001')).set(alb(E.edb, x)), JSON.stringify(x).slice(0, 40));
      for (const k of ['nm', 'k', 'by', 'at', 'w', 'h', 'st']) { const d = alb(E.edb); delete d[k]; await assertFails(db(E.edb).doc(R('edba/alb_bad_0002')).set(d), 'חסר ' + k); }
      await assertFails(db(E.edb).doc(R('edba/short')).set(alb(E.edb)), 'מזהה קצר');
      await assertFails(db(E.edb).doc(R('edba/a.b.c.d.e.f')).set(alb(E.edb)), 'מזהה עם תווים אסורים');
    });
    it('עדכון: היוצר up→ok (רק st); שם – היוצר או מנהל (רק nm, 1..60); אחרים / שדות אחרים – נחסם', async () => {
      await putA('a1_xxxxxx', alb(E.edb));
      await assertFails(db(E.edb2).doc(R('edba/a1_xxxxxx')).update({ st: 'ok' }), 'לא היוצר');
      await assertFails(db(E.mgr).doc(R('edba/a1_xxxxxx')).update({ st: 'ok' }), 'מנהל לא מסמן ok בשם היוצר');
      await assertFails(db(E.edb).doc(R('edba/a1_xxxxxx')).update({ st: 'ok', w: 10 }), 'ok + שדה נוסף');
      await assertFails(db(E.edb).doc(R('edba/a1_xxxxxx')).update({ st: 'done' }), 'מצב לא מוכר');
      await assertSucceeds(db(E.edb).doc(R('edba/a1_xxxxxx')).update({ st: 'ok' }));
      await assertFails(db(E.edb).doc(R('edba/a1_xxxxxx')).update({ st: 'up' }), 'אין חזרה ל-up');
      await assertSucceeds(db(E.edb).doc(R('edba/a1_xxxxxx')).update({ nm: 'שם חדש' }), 'היוצר משנה שם');
      await assertSucceeds(db(E.mgr).doc(R('edba/a1_xxxxxx')).update({ nm: 'שם של מנהל' }), 'מנהל משנה שם');
      await assertFails(db(E.edb2).doc(R('edba/a1_xxxxxx')).update({ nm: 'x' }), 'עובד אחר עם edb לא משנה שם');
      for (const x of [{ nm: '' }, { nm: 'x'.repeat(61) }, { nm: 'x', k: 'full' }, { nm: 'x', by: E.edb2 }, { at: 1 }, { w: 1 }, { extra: 1 }]) await assertFails(db(E.mgr).doc(R('edba/a1_xxxxxx')).update(x), JSON.stringify(x).slice(0, 30));
      for (const u of [E.noe, E.out, E.oth]) await assertFails(db(u).doc(R('edba/a1_xxxxxx')).update({ nm: 'x' }), u);
    });
    it('קריאה: מנהל ועובד עם edb (גם רשימה לפי at); בלי edb / ישן / מושבת / עסק אחר – נחסם. מחיקה – מנהל בלבד (גם לא היוצר)', async () => {
      await putA('r1_xxxxxx', alb(E.edb, { st: 'ok' }));
      await assertSucceeds(db(E.edb2).collection(R('edba')).orderBy('at', 'desc').limit(300).get());
      await assertSucceeds(db(E.mgr).doc(R('edba/r1_xxxxxx')).get());
      for (const u of [E.noe, E.old, E.out, E.oth]) { await assertFails(db(u).doc(R('edba/r1_xxxxxx')).get(), u); await assertFails(db(u).collection(R('edba')).get(), u); }
      await assertFails(db(E.edb).doc(R('edba/r1_xxxxxx')).delete(), 'היוצר לא מוחק');
      await assertFails(db(E.oth).doc(R('edba/r1_xxxxxx')).delete(), 'מנהל של עסק אחר');
      await assertSucceeds(db(E.mgr).doc(R('edba/r1_xxxxxx')).delete());
    });
    it('הדפסה מהאלבום: עבודה עם alb – ישר new, עמוד אחד, ורק כשהדף קיים באלבום', async () => {
      await putA('alb_ok_0001', alb(E.edb, { st: 'ok' }));
      await assertSucceeds(db(E.edb2).doc(R('edbq/job_alb_0001')).set(job(E.edb2, { st: 'new', alb: 'alb_ok_0001' })));
      await assertFails(db(E.edb2).doc(R('edbq/job_alb_0002')).set(job(E.edb2, { st: 'new', alb: 'alb_missing1' })), 'דף לא קיים באלבום');
      await assertFails(db(E.edb2).doc(R('edbq/job_alb_0003')).set(job(E.edb2, { st: 'up', alb: 'alb_ok_0001' })), 'עם alb – לא up');
      await assertFails(db(E.edb2).doc(R('edbq/job_alb_0004')).set(job(E.edb2, { st: 'new', n: 2, alb: 'alb_ok_0001' })), 'עם alb – רק עמוד אחד');
      await assertFails(db(E.edb2).doc(R('edbq/job_alb_0005')).set(job(E.edb2, { st: 'new' })), 'new בלי alb – נחסם');
      for (const a of ['short', 'a/b/c/d/e', 5, 'x'.repeat(41)]) await assertFails(db(E.edb2).doc(R('edbq/job_alb_0006')).set(job(E.edb2, { st: 'new', alb: a })), 'alb לא תקין ' + String(a).slice(0, 10));
      await assertFails(db(E.noe).doc(R('edbq/job_alb_0007')).set(job(E.noe, { st: 'new', alb: 'alb_ok_0001' })), 'בלי edb');
      // התחנה תופסת ומסיימת; alb לא משתנה
      await assertSucceeds(db(E.mgr).doc(R('edbq/job_alb_0001')).update({ st: 'taken', tk: E.mgr, msg: 'המחשב מדפיס' }));
      await assertFails(db(E.mgr).doc(R('edbq/job_alb_0001')).update({ msg: 'x', code: 'printing', ts: Date.now(), alb: 'alb_other01' }), 'שינוי alb');
      await assertSucceeds(db(E.mgr).doc(R('edbq/job_alb_0001')).update({ st: 'done', msg: 'הודפס', code: 'done', ts: Date.now() }));
    });
  });

  describe(`דף אכיל – סבב 5: אלבום, Storage (${E.name})`, () => {
    const A = (id, f) => E.P + 'edb_album/' + id + '/' + (f || 'page.png');
    const JPG = { contentType: 'image/jpeg' };
    const putA = (id, x) => prep((d) => d.doc(R('edba/' + id)).set(Object.assign({ nm: 'דף', k: 'c12', by: E.edb, at: Date.now(), w: 2480, h: 3508, st: 'up' }, x || {})));
    beforeEach(async () => {
      await seed();
      await env.clearStorage();
      await putA('a_up_00001'); await putA('a_ok_00001', { st: 'ok' }); await putA('a_old_0001', { at: Date.now() - 2 * 3600000 });
      await env.withSecurityRulesDisabled(async (c) => {
        await c.storage().ref(A('a_ok_00001')).put(new Uint8Array([137, 80, 78, 71]), PNG);
        await c.storage().ref(A('a_ok_00001', 'thumb.jpg')).put(new Uint8Array([255, 216, 255]), JPG);
        await c.storage().ref(A('a_up_00001', 'thumb.jpg')).put(new Uint8Array([255, 216, 255]), JPG);
      });
    });
    it('create: רק היוצר, כשהמסמך up וטרי; page.png PNG עד 30MB, thumb.jpg JPEG עד 300KB; בלי דריסה', async () => {
      await assertSucceeds(up(st(E.edb).ref(A('a_up_00001')), new Uint8Array(MB30), PNG), 'בדיוק 30MB');
      await assertFails(up(st(E.edb).ref(A('a_up_00001')), new Uint8Array([1]), PNG), 'דריסה');
      await assertFails(up(st(E.edb).ref(A('a_up_00001', 'thumb.jpg')), new Uint8Array([1]), JPG), 'דריסת thumb');
      await putA('a_up_00002');
      await assertFails(up(st(E.edb).ref(A('a_up_00002')), new Uint8Array(MB30 + 1), PNG), 'מעל 30MB');
      await assertFails(up(st(E.edb).ref(A('a_up_00002')), new Uint8Array([1]), JPG), 'page לא PNG');
      await assertFails(up(st(E.edb).ref(A('a_up_00002', 'thumb.jpg')), new Uint8Array(300 * 1024 + 1), JPG), 'thumb מעל 300KB');
      await assertFails(up(st(E.edb).ref(A('a_up_00002', 'thumb.jpg')), new Uint8Array([1]), PNG), 'thumb לא JPEG');
      await assertFails(up(st(E.edb).ref(A('a_up_00002', 'x.png')), new Uint8Array([1]), PNG), 'שם קובץ אחר');
      await assertFails(up(st(E.edb2).ref(A('a_up_00002')), new Uint8Array([1]), PNG), 'לא היוצר');
      await assertFails(up(st(E.mgr).ref(A('a_up_00002')), new Uint8Array([1]), PNG), 'לא היוצר – גם מנהל');
      await assertFails(up(st(E.edb).ref(A('a_old_0001')), new Uint8Array([1]), PNG), 'מסמך up ישן (שעתיים)');
      await assertFails(up(st(E.edb).ref(A('a_ok_00002')), new Uint8Array([1]), PNG), 'אין מסמך');
      await putA('a_ok_00003', { st: 'ok' });
      await assertFails(up(st(E.edb).ref(A('a_ok_00003')), new Uint8Array([1]), PNG), 'מסמך כבר ok – אין החלפה');
      await assertFails(up(st(E.out).ref(A('a_up_00002')), new Uint8Array([1]), PNG), 'מושבת');
      await assertFails(up(st(E.oth).ref(A('a_up_00002')), new Uint8Array([1]), PNG), 'עסק אחר');
      await assertFails(up(env.unauthenticatedContext().storage().ref(A('a_up_00002')), new Uint8Array([1]), PNG), 'לא מחובר');
      await assertSucceeds(up(st(E.edb).ref(A('a_up_00002', 'thumb.jpg')), new Uint8Array(300 * 1024), JPG), 'thumb בדיוק 300KB');
      if (E.P) await assertFails(up(st(E.edb).ref('edb_album/a_up_00002/page.png'), new Uint8Array([1]), PNG), 'עובד עסק בנתיב legacy');
      else await assertFails(up(st(E.edb).ref('b/bz/edb_album/a_up_00002/page.png'), new Uint8Array([1]), PNG), 'עובד legacy בנתיב של עסק');
    });
    it('get: חבר פעיל בעסק כשהמסמך ok (כולל התחנה); מסמך up / אין מסמך / עסק אחר / מושבת – נחסם; list – נחסם', async () => {
      for (const u of [E.edb, E.edb2, E.mgr]) { await assertSucceeds(st(u).ref(A('a_ok_00001')).getMetadata(), u); await assertSucceeds(st(u).ref(A('a_ok_00001', 'thumb.jpg')).getMetadata(), u); }
      await assertFails(st(E.edb).ref(A('a_up_00001', 'thumb.jpg')).getMetadata(), 'מסמך עדיין up');
      await assertFails(st(E.edb).ref(A('a_none_001')).getMetadata(), 'אין מסמך');
      await assertFails(st(E.oth).ref(A('a_ok_00001')).getMetadata(), 'עסק אחר');
      await assertFails(st(E.out).ref(A('a_ok_00001')).getMetadata(), 'מושבת');
      await assertFails(env.unauthenticatedContext().storage().ref(A('a_ok_00001')).getMetadata(), 'לא מחובר');
      await assertFails(st(E.mgr).ref(E.P + 'edb_album/a_ok_00001').listAll(), 'list');
      await assertFails(st(E.mgr).ref(E.P + 'edb_album').listAll(), 'list של כל האלבום');
    });
    it('delete: מנהל בלבד; היוצר, עובד, עסק אחר – נחסם', async () => {
      await assertFails(st(E.edb).ref(A('a_ok_00001')).delete(), 'היוצר');
      await assertFails(st(E.edb2).ref(A('a_ok_00001')).delete(), 'עובד עם edb');
      await assertFails(st(E.oth).ref(A('a_ok_00001')).delete(), 'מנהל עסק אחר');
      await assertSucceeds(st(E.mgr).ref(A('a_ok_00001')).delete(), 'מנהל');
      await assertSucceeds(st(E.mgr).ref(A('a_ok_00001', 'thumb.jpg')).delete(), 'מנהל – thumb');
    });
  });

  describe(`דף אכיל – תמונות עמוד, Storage (${E.name})`, () => {
    beforeEach(async () => {
      await seed();
      await env.clearStorage();
      await put('s_up', job(E.edb, { n: 2 }));
      await put('s_new', job(E.edb, { st: 'new' }));
      await put('s_tk', job(E.edb, { st: 'taken', tk: E.edb2 }));
      await put('s_done', job(E.edb, { st: 'done', tk: E.edb2 }));
      await env.withSecurityRulesDisabled(async (c) => {
        for (const id of ['s_tk', 's_done', 's_new']) await c.storage().ref(F(id)).put(new Uint8Array([137, 80, 78, 71]), PNG);
      });
    });

    it('create: רק השולח, רק כשהעבודה up, רק p{i}.png עם i < n, PNG עד 30MB, בלי דריסה', async () => {
      await assertSucceeds(up(st(E.edb).ref(F('s_up', 0)), new Uint8Array([137, 80, 78, 71]), PNG));
      await assertSucceeds(up(st(E.edb).ref(F('s_up', 1)), new Uint8Array(MB30), PNG), 'בדיוק 30MB');
      await assertFails(up(st(E.edb).ref(F('s_up', 1)), new Uint8Array([1]), PNG), 'דריסה');
      await assertFails(up(st(E.edb).ref(F('s_up', 2)), new Uint8Array([1]), PNG), 'i >= n');
      await assertFails(up(st(E.edb).ref(E.P + 'edb_tmp/s_up/x.png'), new Uint8Array([1]), PNG), 'שם קובץ');
      await assertFails(up(st(E.edb).ref(E.P + 'edb_tmp/s_up/p0.jpg'), new Uint8Array([1]), PNG), 'סיומת');
      await put('s_up2', job(E.edb, { n: 3 }));
      await assertFails(up(st(E.edb).ref(F('s_up2', 0)), new Uint8Array([1]), { contentType: 'image/jpeg' }), 'לא PNG');
      await assertFails(up(st(E.edb).ref(F('s_up2', 1)), new Uint8Array(MB30 + 1), PNG), 'מעל 30MB');
      await assertFails(up(st(E.edb2).ref(F('s_up2', 2)), new Uint8Array([1]), PNG), 'לא השולח');
      await assertFails(up(st(E.mgr).ref(F('s_up2', 2)), new Uint8Array([1]), PNG), 'לא השולח – גם מנהל');
      await assertFails(up(st(E.edb).ref(F('s_new', 1)), new Uint8Array([1]), PNG), 'העבודה כבר new');
      await assertFails(up(st(E.edb).ref(F('nojob', 0)), new Uint8Array([1]), PNG), 'אין עבודה');
      await put('s_old', job(E.edb, { n: 2, at: Date.now() - 2 * 3600000 }));
      await assertFails(up(st(E.edb).ref(F('s_old', 0)), new Uint8Array([1]), PNG), 'עבודה up ישנה (שעתיים) – נחסם');
      await put('s_old2', job(E.edb, { n: 2, at: Date.now() - 50 * 60000 }));
      await assertSucceeds(up(st(E.edb).ref(F('s_old2', 0)), new Uint8Array([1]), PNG), 'עבודה up בת 50 דקות – מותר');
      await put('s_noat', { by: E.edb, st: 'up', n: 1 });
      await assertFails(up(st(E.edb).ref(F('s_noat', 0)), new Uint8Array([1]), PNG), 'עבודה בלי at');
      await assertFails(up(st(E.out).ref(F('s_up2', 2)), new Uint8Array([1]), PNG), 'מושבת');
      await assertFails(up(st(E.oth).ref(F('s_up2', 2)), new Uint8Array([1]), PNG), 'עסק אחר');
      await assertFails(up(env.unauthenticatedContext().storage().ref(F('s_up2', 2)), new Uint8Array([1]), PNG));
      if (E.P) await assertFails(up(st(E.edb).ref('edb_tmp/s_up2/p2.png'), new Uint8Array([1]), PNG), 'עובד עסק בנתיב legacy');
      else await assertFails(up(st(E.edb).ref('b/bz/edb_tmp/s_up2/p2.png'), new Uint8Array([1]), PNG), 'עובד legacy בנתיב של עסק');
    });
    it('עובד שהמתג edb שלו בוטל: אין עבודה חדשה, ואין העלאה לעבודה up ישנה (ליקוי 1 בבדיקת סבב 1)', async () => {
      await put('s_rv', job(E.edb, { n: 2, at: Date.now() - 2 * 3600000 }));
      await prep((d) => d.doc(R('staff/' + E.edb)).set({ perms: Object.assign({}, NONE) }, { merge: true }));
      await assertFails(db(E.edb).doc(R('edbq/job_rev_0001')).set(job(E.edb)), 'עבודה חדשה');
      await assertFails(up(st(E.edb).ref(F('s_rv', 0)), new Uint8Array([1]), PNG), 'העלאה לעבודה ישנה');
      await assertFails(up(st(E.edb).ref(F('s_rv', 1)), new Uint8Array([1]), PNG), 'העלאה שנייה לעבודה ישנה');
    });
    it('get: רק התחנה שתפסה (tk) כשהעבודה taken; השולח, מנהל, אחרי done – נחסם; list – לכולם נחסם', async () => {
      await assertSucceeds(st(E.edb2).ref(F('s_tk')).getMetadata());
      await assertFails(st(E.edb).ref(F('s_tk')).getMetadata(), 'השולח');
      await assertFails(st(E.mgr).ref(F('s_tk')).getMetadata(), 'מנהל');
      await assertFails(st(E.edb2).ref(F('s_done')).getMetadata(), 'אחרי done');
      await assertFails(st(E.edb2).ref(F('s_new')).getMetadata(), 'לפני תפיסה');
      await assertFails(st(E.oth).ref(F('s_tk')).getMetadata(), 'עסק אחר');
      await assertFails(st(E.edb2).ref(E.P + 'edb_tmp/s_tk').listAll());
      await assertFails(st(E.mgr).ref(E.P + 'edb_tmp/s_tk').listAll());
    });
    it('delete: השולח, התחנה ומנהל; עובד אחר, עסק אחר – נחסם', async () => {
      await assertFails(st(E.noe).ref(F('s_tk')).delete(), 'עובד אחר');
      await assertFails(st(E.oth).ref(F('s_tk')).delete(), 'עסק אחר');
      await assertSucceeds(st(E.edb2).ref(F('s_tk')).delete(), 'התחנה');
      await assertSucceeds(st(E.edb).ref(F('s_done')).delete(), 'השולח');
      await assertSucceeds(st(E.mgr).ref(F('s_new')).delete(), 'מנהל');
    });
  });
}

describe('דף אכיל – נעילת השורש (lpW) אחרי המעבר', () => {
  beforeEach(seed);
  it('b/largpeami.dataRoot = b: אין יצירה ועדכון ב-edbq/edbs בשורש; legacy פותח שוב', async () => {
    const lp = (dataRoot) => prep((d) => d.doc('b/largpeami').set({ name: 'lp', status: 'active', dataRoot, schemaVersion: 1, createdAt: 1, createdBy: 'migrate', migrationTarget: true }));
    await lp('b');
    await assertFails(db('r_edb').doc('edbq/job_lock_001').set(job('r_edb')));
    await assertFails(db('r_edb').doc('edbs/main').set(stn('r_edb')));
    await assertFails(db('r_edb').doc('edba/alb_lock_001').set({ nm: 'x', k: 'c12', by: 'r_edb', at: Date.now(), w: 1, h: 1, st: 'up' }), 'edba בשורש נעול');
    await lp('legacy');
    await assertSucceeds(db('r_edb').doc('edba/alb_lock_001').set({ nm: 'x', k: 'c12', by: 'r_edb', at: Date.now(), w: 1, h: 1, st: 'up' }));
    await assertSucceeds(db('r_edb').doc('edbq/job_lock_001').set(job('r_edb')));
    await assertSucceeds(db('r_edb').doc('edbs/main').set(stn('r_edb')));
  });
});
