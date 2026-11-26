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
      const bad = [{ st: 'new' }, { st: 'taken' }, { n: 0 }, { n: 11 }, { n: 1.5 }, { n: '1' }, { at: 'now' }, { at: 0 }, { by: E.edb2 }, { msg: 'x'.repeat(201) }, { msg: 5 }, { tk: E.edb }, { extra: 1 }];
      for (const x of bad) await assertFails(db(E.edb).doc(R('edbq/job_bad_0001')).set(job(E.edb, x)), JSON.stringify(x).slice(0, 40));
      await assertFails(db(E.edb).doc(R('edbq/short')).set(job(E.edb)), 'מזהה קצר');
      await assertFails(db(E.edb).doc(R('edbq/job_bad_0002')).set({ by: E.edb, at: Date.now(), st: 'up' }), 'חסר n');
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
      await assertFails(db(E.edb).doc(R('edbq/j1')).update({ st: 'err', msg: 'בוטל' }), 'השולח לא מבטל אחרי שנתפסה');
      await assertFails(db(E.mgr).doc(R('edbq/j1')).update({ st: 'done' }), 'רק התחנה שתפסה מסיימת');
      await assertFails(db(E.edb2).doc(R('edbq/j1')).update({ st: 'done', tk: E.edb }), 'שינוי tk בסיום');
      await assertSucceeds(db(E.edb2).doc(R('edbq/j1')).update({ st: 'done', msg: 'הודפס' }));
      await assertFails(db(E.edb2).doc(R('edbq/j1')).update({ st: 'err' }), 'done סופי');
      await assertFails(db(E.edb).doc(R('edbq/j1')).update({ st: 'new' }), 'done סופי – גם לשולח');
      await put('j2', job(E.edb, { st: 'taken', tk: E.edb2 }));
      await assertSucceeds(db(E.edb2).doc(R('edbq/j2')).update({ st: 'err', msg: 'המדפסת לא נמצאה' }));
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
      await assertFails(up(st(E.out).ref(F('s_up2', 2)), new Uint8Array([1]), PNG), 'מושבת');
      await assertFails(up(st(E.oth).ref(F('s_up2', 2)), new Uint8Array([1]), PNG), 'עסק אחר');
      await assertFails(up(env.unauthenticatedContext().storage().ref(F('s_up2', 2)), new Uint8Array([1]), PNG));
      if (E.P) await assertFails(up(st(E.edb).ref('edb_tmp/s_up2/p2.png'), new Uint8Array([1]), PNG), 'עובד עסק בנתיב legacy');
      else await assertFails(up(st(E.edb).ref('b/bz/edb_tmp/s_up2/p2.png'), new Uint8Array([1]), PNG), 'עובד legacy בנתיב של עסק');
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
    await lp('legacy');
    await assertSucceeds(db('r_edb').doc('edbq/job_lock_001').set(job('r_edb')));
    await assertSucceeds(db('r_edb').doc('edbs/main').set(stn('r_edb')));
  });
});
