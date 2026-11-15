'use strict';
// סריקת חנות בתלת מימד – store3d, שלב 1 (14.11.2026): מטריצת תפקידים לחוקי Firestore ו-Storage, ומפתחות store3d / s3m בשרת.
// תפקידים: מנהל־על, מנהל, עובד עם הרשאת שרטוט (s3m), עובד אחראי (משויך לסבב), עובד זר (לא משויך), עובד מושבת, משתמש מעסק אחר.
// כתיבת המפה (smap) נעשית רק דרך השרת (s3SaveMap) – כאן נבדק שהרשאת s3m קיימת (roles.js, perms.s3m) ונותנת את מה שהחוזה
// מגדיר בחוקים (קריאת גרסאות וטיוטות), ושאף לקוח – גם לא מנהל־על – לא כותב ישירות smap, srun, s3br ושאר אוספי השרת.
// חלק מ-test:multibiz. רץ רק באמולטור (firestore + storage).
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-s3', OFF = 'biz-s3-off', O = 'biz-s3-oth';
const SUPER = 's3_super', MGR = 's3_mgr', S3M = 's3_draw', RESP = 's3_resp', FOR = 's3_foreign', DIS = 's3_dis', OLD = 's3_old';
const OMGR = 's3_omgr', OEMP = 's3_oemp', FMGR = 's3_fmgr';
// בשורש (לארג' פעמי במצב legacy)
const RMGR = 's3_rmgr', RS3M = 's3_rdraw', RRESP = 's3_rresp', RFOR = 's3_rfor', RDIS = 's3_rdis';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false };
const DRAW = Object.assign({}, NONE, { s3m: true });
const RUN = 'rule0001_20261116', RID = 'rule0001', SLOT = 'f1-a-1_a', MAP = 's-main';
const DAY = 86400000;

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const fs = (u) => (u ? env.authenticatedContext(u, { email: u + '@example.invalid' }) : env.unauthenticatedContext()).firestore();
const st = (u) => (u ? env.authenticatedContext(u, { email: u + '@example.invalid' }) : env.unauthenticatedContext()).storage();
const now = () => Date.now();

// נתוני התוספת – זהים בכל מסלול (P = '' בשורש או 'b/<biz>/')
function seedS3(b, d, P, resp, other) {
  const t = now();
  b.set(d.doc(P + 's3br/main'), { wh: true, cap: 500, on: true, upd: t, by: SUPER });
  b.set(d.doc(P + 's3set/main'), { w: { p: 35, h: 30, o: 20, d: 15 }, show: ['fix'], recN: 3, stype: '', catMode: 'mix', cats: [], sub: 'manual', due: 2, numDir: 'rtl', upd: t, by: MGR });
  b.set(d.doc(P + 'smap/' + MAP), { br: 'main', kind: 's', name: 'חנות', v: 1, seq: 1, grid: 50, numDir: 'rtl', rooms: [], walls: [], cols: [], doors: [], fx: [], syms: [], src: 'manual', upd: t, by: MGR });
  b.set(d.doc(P + 'smap/' + MAP + '/ver/000001'), { m: {}, v: 1, at: t, by: MGR });
  b.set(d.doc(P + 'smap/' + MAP + '/bay/f1-a-1'), { cat: 'חטיפים', catSug: 'חטיפים', catConf: 0.9, upd: t, by: MGR });
  b.set(d.doc(P + 's3draft/draft-0000000000000001'), { br: 'main', kind: 's', by: resp, at: t, st: 'ok', n: 3 });
  b.set(d.doc(P + 'sround/' + RID), { br: 'main', map: MAP, name: 'שבועי', f: { k: 'week', dow: 0 }, asg: [{ u: resp, z: [] }], on: true, upd: t, by: MGR, uids: [resp] });
  b.set(d.doc(P + 'sround/oldrule1'), { br: 'main', map: MAP, name: 'ישן', f: { k: 'manual' }, asg: [{ u: resp, z: [] }], on: false, upd: t, by: MGR, del: 1, delAt: t - 31 * DAY, delBy: MGR });
  b.set(d.doc(P + 'sround/delrule1'), { br: 'main', map: MAP, name: 'נמחק', f: { k: 'manual' }, asg: [{ u: resp, z: [] }], on: false, upd: t, by: MGR, del: 1, delAt: t - DAY, delBy: MGR });
  b.set(d.doc(P + 'srun/' + RUN), { rid: RID, br: 'main', map: MAP, mapV: 1, k: 'sched', st: 'open', asg: { [resp]: ['f1-a-1'] }, uids: [resp], n: 1, nDone: 0, nUid: { [resp]: { n: 1, d: 0 } }, openAt: t, dueAt: t + 2 * DAY, tlog: {} });
  b.set(d.doc(P + 'srun/' + RUN + '/ph/' + SLOT), { p: 'b/x/store3d/main/run/' + RUN + '/' + SLOT + '_1.jpg', w: 1600, h: 1200, sz: 400000, tsz: 40000, src: 'photo', by: resp, at: t, rx: t, qid: 'q'.repeat(16), rt: 0 });
  b.set(d.doc(P + 'srun/' + RUN + '/ai/' + SLOT), { st: 'issue', conf: 0.8, iss: [{ k: 'hole', sev: 2, conf: 0.8, t: 'חור' }], model: 'm', at: t, ver: 1 });
  b.set(d.doc(P + 's3sum/' + MAP), { b: { 'f1-a-1': { s: 'iss', r: RUN, t, n: 1 } }, run: RUN, score: 80, upd: t });
  b.set(d.doc(P + 's3fix/' + RUN + '__' + SLOT), { run: RUN, slot: SLOT, map: MAP, br: 'main', iks: [0], by: 'ai', u: resp, st: 'open', at: t, dueAt: t + 2 * DAY });
  b.set(d.doc(P + 's3appeal/' + RUN + '__' + SLOT + '__1'), { run: RUN, slot: SLOT, ik: '1', by: resp, txt: 'טעות', at: t, st: 'open' });
  b.set(d.doc(P + 's3short/' + RUN), { items: [{ n: 'במבה', c: '', bay: 'f1-a-1', why: 'low' }], st: 'draft' });
  b.set(d.doc(P + 's3use/b_main'), { m: '2026-11', n: 10, cap: 500, w80: '', upd: t });
  b.set(d.doc(P + 's3perf/' + resp + '/m/2026-11'), { runs: 1, onTime: 1, late: 0, upd: t });
  b.set(d.doc(P + 's3perf/' + other + '/m/2026-11'), { runs: 2, onTime: 2, late: 0, upd: t });
  b.set(d.doc(P + 's3qid/' + 'q'.repeat(16)), { k: 'photo', uid: resp, res: {}, at: t, exp: t + 30 * DAY });
  b.set(d.doc(P + 's3ntf/' + RUN + '_new'), { at: t, kind: 'new', to: [resp] });
}

async function seed(rootFeature) {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    const org = { v: 1, branches: [{ id: 'main', name: 'ראשי', on: true, sig: [] }], banks: [], cards: [] };
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { scan: true, store3d: true }, org });
    b.set(d.doc('b/' + OFF), { name: 'כבוי', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { scan: true }, org });
    b.set(d.doc('b/' + O), { name: 'אחר', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { store3d: true }, org });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'מנהל', role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${S3M}`), { name: 'משרטט', role: 'employee', active: true, perms: DRAW });
    b.set(d.doc(`b/${A}/staff/${RESP}`), { name: 'אחראי', role: 'employee', active: true, perms: NONE });
    b.set(d.doc(`b/${A}/staff/${FOR}`), { name: 'זר', role: 'employee', active: true, perms: NONE });
    b.set(d.doc(`b/${A}/staff/${DIS}`), { name: 'מושבת', role: 'employee', active: false, perms: DRAW });
    b.set(d.doc(`b/${A}/staff/${OLD}`), { name: 'ישן', role: 'employee', active: true }); // בלי perms – s3m כבוי
    b.set(d.doc(`b/${OFF}/admins/${FMGR}`), { email: 'f@x.invalid' });
    b.set(d.doc(`b/${O}/admins/${OMGR}`), { email: 'o@x.invalid' });
    b.set(d.doc(`b/${O}/staff/${OEMP}`), { name: 'עובד אחר', role: 'employee', active: true, perms: DRAW });
    for (const [u, z, role, active] of [[MGR, A, 'admin', true], [S3M, A, 'worker', true], [RESP, A, 'worker', true], [FOR, A, 'worker', true], [DIS, A, 'worker', false], [OLD, A, 'worker', true],
      [FMGR, OFF, 'admin', true], [OMGR, O, 'admin', true], [OEMP, O, 'worker', true],
      [RMGR, 'largpeami', 'admin', true], [RS3M, 'largpeami', 'worker', true], [RRESP, 'largpeami', 'worker', true], [RFOR, 'largpeami', 'worker', true], [RDIS, 'largpeami', 'worker', false]]) {
      b.set(d.doc('users/' + u), { bizId: z, role, active, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    }
    // שורש: לארג' פעמי במצב legacy
    b.set(d.doc('b/largpeami'), { name: 'L', status: 'active', dataRoot: 'legacy', features: rootFeature ? { store3d: true } : { scan: true } });
    b.set(d.doc('admins/' + RMGR), { email: 'r@x.invalid' });
    b.set(d.doc('staff/' + RMGR), { name: 'מנהל', role: 'manager', active: true });
    b.set(d.doc('staff/' + RS3M), { name: 'משרטט', role: 'employee', active: true, perms: DRAW });
    b.set(d.doc('staff/' + RRESP), { name: 'אחראי', role: 'employee', active: true });
    b.set(d.doc('staff/' + RFOR), { name: 'זר', role: 'employee', active: true });
    b.set(d.doc('staff/' + RDIS), { name: 'מושבת', role: 'employee', active: false, perms: DRAW });
    seedS3(b, d, `b/${A}/`, RESP, FOR);
    seedS3(b, d, `b/${OFF}/`, RESP, FOR);
    seedS3(b, d, '', RRESP, RFOR);
    await b.commit();
  });
}

const P = `b/${A}/`;
const okSet = (u, o) => Object.assign({ w: { p: 35, h: 30, o: 20, d: 15 }, show: ['fix', 'score'], recN: 3, stype: 'מכולת', catMode: 'mix', cats: ['חטיפים'], sub: 'manual', subU: '', due: 2, numDir: 'rtl', upd: now(), by: u }, o || {});
const okRound = (u, o) => Object.assign({ br: 'main', map: MAP, name: 'חודשי', f: { k: 'month', dom: 5 }, asg: [{ u: RESP, z: [] }], on: true, upd: now(), by: u }, o || {});
const okAppeal = (u, o) => Object.assign({ run: RUN, slot: SLOT, ik: '0', by: u, txt: 'זה לא חור', at: now(), st: 'open' }, o || {});
const AID0 = RUN + '__' + SLOT + '__0';

before(async () => { env = await H.getEnv(); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('store3d – מפתחות בשרת', () => {
  it('FEATURES כולל store3d, כבוי כברירת מחדל גם בעסק הישן; PERM_KEYS כולל s3m, כבוי כברירת מחדל', () => {
    const T = require('../functions/lib/tenant');
    const R = require('../functions/lib/roles');
    assert.ok(T.FEATURES.includes('store3d'));
    assert.equal(T.ALL_ON.store3d, false);
    assert.ok(R.PERM_KEYS.includes('s3m'));
    assert.equal(R.DEFAULT_PERMS.s3m, false);
    assert.equal(R.hasPerm({ role: 'employee', staff: { get: () => undefined } }, 's3m'), false, 'עובד ישן בלי perms');
    assert.equal(R.hasPerm({ role: 'employee', staff: { get: () => DRAW } }, 's3m'), true, 'עובד עם s3m');
    assert.equal(R.hasPerm({ role: 'employee', staff: { get: () => NONE } }, 's3m'), false);
    assert.equal(R.hasPerm({ role: 'manager' }, 's3m'), true);
  });
});

describe('store3d – חוקי Firestore בתוך עסק: מטריצת קריאה', () => {
  before(() => seed(true));
  // [נתיב, מי מורשה לקרוא]; כל השאר (מתוך כל התפקידים) – נחסם
  const ALL_ROLES = [SUPER, MGR, S3M, RESP, FOR, DIS, OLD, OMGR, OEMP, null];
  const STAFF = [SUPER, MGR, S3M, RESP, FOR, OLD];
  const rows = [
    ['s3br/main', STAFF],
    ['s3set/main', STAFF],
    ['smap/' + MAP, STAFF],
    ['smap/' + MAP + '/ver/000001', [SUPER, MGR, S3M]],
    ['smap/' + MAP + '/bay/f1-a-1', STAFF],
    ['s3draft/draft-0000000000000001', [SUPER, MGR, S3M, RESP]],
    ['sround/' + RID, [SUPER, MGR, RESP]],
    ['srun/' + RUN, [SUPER, MGR]],
    ['srun/' + RUN + '/ph/' + SLOT, STAFF],
    ['srun/' + RUN + '/ai/' + SLOT, [SUPER, MGR]],
    ['s3sum/' + MAP, STAFF],
    ['s3fix/' + RUN + '__' + SLOT, [SUPER, MGR, RESP]],
    ['s3appeal/' + RUN + '__' + SLOT + '__1', [SUPER, MGR, RESP]],
    ['s3short/' + RUN, [SUPER, MGR]],
    ['s3use/b_main', [SUPER, MGR]],
    ['s3perf/' + RESP + '/m/2026-11', [SUPER, MGR, RESP]],
    ['s3perf/' + FOR + '/m/2026-11', [SUPER, MGR, FOR]],
    ['s3qid/' + 'q'.repeat(16), []],
    ['s3ntf/' + RUN + '_new', []],
  ];
  for (const [p, okRoles] of rows) {
    it('קריאה: ' + p.split('/').filter((x, i) => i % 2 === 0).join('/'), async () => {
      for (const u of ALL_ROLES) {
        const r = fs(u).doc(P + p).get();
        if (okRoles.includes(u)) await assertSucceeds(r); else await assertFails(r);
      }
    });
  }
  it('שאילתות: עובד – רק עם סינון לעצמו (sround לפי uids, s3fix לפי u, s3appeal לפי by); בלי סינון – נחסם', async () => {
    await assertSucceeds(fs(RESP).collection(P + 'sround').where('uids', 'array-contains', RESP).get());
    await assertFails(fs(RESP).collection(P + 'sround').get());
    await assertSucceeds(fs(RESP).collection(P + 's3fix').where('u', '==', RESP).get());
    await assertFails(fs(FOR).collection(P + 's3fix').get());
    await assertSucceeds(fs(RESP).collection(P + 's3appeal').where('by', '==', RESP).get());
    await assertFails(fs(RESP).collection(P + 'srun').where('uids', 'array-contains', RESP).get());
    await assertSucceeds(fs(MGR).collection(P + 'srun').get());
    await assertSucceeds(fs(RESP).collection(P + `srun/${RUN}/ph`).get());
    await assertFails(fs(RESP).collection(P + `srun/${RUN}/ai`).get());
  });
  it('s3perf – שליפת רשימה (חוזה 4.16): עובד על עצמו – מותר; על עובד אחר – נחסם; מנהל ומנהל־על – מותר; מושבת ועסק אחר – נחסמים', async () => {
    await assertSucceeds(fs(RESP).collection(P + `s3perf/${RESP}/m`).get());
    await assertFails(fs(RESP).collection(P + `s3perf/${FOR}/m`).get());
    await assertFails(fs(S3M).collection(P + `s3perf/${RESP}/m`).get());
    for (const u of [MGR, SUPER]) { await assertSucceeds(fs(u).collection(P + `s3perf/${RESP}/m`).get(), u); await assertSucceeds(fs(u).collection(P + `s3perf/${FOR}/m`).get(), u); }
    for (const u of [DIS, OMGR, OEMP, null]) await assertFails(fs(u).collection(P + `s3perf/${RESP}/m`).get(), String(u));
    await assertFails(fs(RESP).doc(P + `s3perf/${RESP}/m/bad`).get(), 'מזהה חודש לא תקין');
    await assertFails(fs(RESP).collectionGroup('m').get(), 'collectionGroup');
  });
  it('תוספת כבויה: אף אחד בעסק (גם המנהל) לא קורא ולא כותב', async () => {
    for (const p of ['s3set/main', 'smap/' + MAP, 'sround/' + RID, 's3sum/' + MAP, 'srun/' + RUN]) await assertFails(fs(FMGR).doc(`b/${OFF}/${p}`).get());
    await assertFails(fs(FMGR).doc(`b/${OFF}/s3set/main`).set(okSet(FMGR)));
    await assertFails(fs(FMGR).doc(`b/${OFF}/sround/newrule1`).set(okRound(FMGR)));
  });
});

describe('store3d – חוקי Firestore בתוך עסק: כתיבה', () => {
  beforeEach(() => seed(true));

  it('אוספי שרת: אף לקוח (גם מנהל־על, גם s3m) לא כותב ולא מוחק – smap, ver, s3br, s3draft, srun, ph, ai, s3sum, s3fix, s3use, s3perf, s3qid, s3ntf', async () => {
    const paths = ['smap/' + MAP, 'smap/s-new', 'smap/' + MAP + '/ver/000002', 's3br/main', 's3br/br2', 's3draft/draft-0000000000000009', 'srun/' + RUN, 'srun/rule0001_20261201',
      'srun/' + RUN + '/ph/f1-a-2_a', 'srun/' + RUN + '/ai/' + SLOT, 's3sum/' + MAP, 's3fix/' + RUN + '__' + SLOT, 's3use/b_main', 's3perf/' + RESP + '/m/2026-11', 's3qid/x'.padEnd(20, 'x'), 's3ntf/zz_new'];
    for (const u of [SUPER, MGR, S3M, RESP]) {
      for (const p of paths) {
        await assertFails(fs(u).doc(P + p).set({ x: 1, upd: now(), by: u }), u + ' ' + p);
      }
      for (const p of ['smap/' + MAP, 's3br/main', 'srun/' + RUN, 's3set/main', 'sround/' + RID, 's3appeal/' + RUN + '__' + SLOT + '__1', 's3short/' + RUN, 'smap/' + MAP + '/bay/f1-a-1']) {
        await assertFails(fs(u).doc(P + p).delete(), 'delete ' + u + ' ' + p);
      }
    }
    // s3m: עדכון ישיר של המפה (גם רק שדה אחד) – נחסם; השמירה רק דרך s3SaveMap
    await assertFails(fs(S3M).doc(P + 'smap/' + MAP).update({ name: 'חדש', upd: now(), by: S3M }));
    // מכסה ומחסן לסניף (s3br) ורשימת הסניפים (org במסמך העסק) – רק השרת (s3SetBranch / setBusinessOrg, מנהל־על בלבד)
    await assertFails(fs(MGR).doc(P + 's3br/main').update({ cap: 100000 }));
    await assertFails(fs(SUPER).doc(P + 's3br/main').update({ cap: 1000 }));
    await assertFails(fs(MGR).doc('b/' + A).update({ org: { v: 2, branches: [] } }));
    await assertFails(fs(MGR).doc('b/' + A).update({ features: { store3d: true } }));
  });

  it('s3set: מנהל ומנהל־על – עם השדות והגבולות של החוזה; עובד, s3m, עסק אחר – נחסמים; שדה זר, סכום משקלות, show בלי fix, by/upd – נחסמים', async () => {
    await assertSucceeds(fs(MGR).doc(P + 's3set/main').set(okSet(MGR)));
    await assertSucceeds(fs(SUPER).doc(P + 's3set/br2').set(okSet(SUPER)));
    for (const u of [S3M, RESP, FOR, DIS, OMGR, OEMP]) await assertFails(fs(u).doc(P + 's3set/main').set(okSet(u)), u);
    const bad = [
      { w: { p: 40, h: 30, o: 20, d: 15 } }, { w: { p: 35, h: 30, o: 35 } }, { w: { p: 35, h: 30, o: 20, d: 15, x: 0 } }, { w: { p: 35.5, h: 29.5, o: 20, d: 15 } },
      { show: ['score'] }, { show: ['fix', 'photos'] }, { show: [] }, { recN: 11 }, { stype: 'x'.repeat(41) }, { catMode: 'auto' },
      { cats: Array.from({ length: 151 }, () => 'a') }, { sub: 'all' }, { subU: 'x' }, { due: 0 }, { due: 15 }, { numDir: 'up' },
      { by: RESP }, { upd: now() - 600000 }, { upd: String(now()) }, { catSug: 'x' }, { extra: 1 },
    ];
    for (const o of bad) await assertFails(fs(MGR).doc(P + 's3set/main').set(okSet(MGR, o)), JSON.stringify(o).slice(0, 60));
    const noBy = okSet(MGR); delete noBy.by;
    await assertFails(fs(MGR).doc(P + 's3set/main').set(noBy));
    await assertFails(fs(MGR).doc(P + 's3set/Bad-Id').set(okSet(MGR)));
  });

  it('bay: מנהל כותב cat/exp/notes; לא נוגע ב-catSug/catConf; עובד ו-s3m – נחסמים; מזהה מקטע לא תקין – נחסם', async () => {
    await assertSucceeds(fs(MGR).doc(P + 'smap/' + MAP + '/bay/f1-a-2').set({ cat: 'שתייה', exp: [{ n: 'קולה' }], notes: [], upd: now(), by: MGR }));
    await assertSucceeds(fs(MGR).doc(P + 'smap/' + MAP + '/bay/f1-a-1').update({ cat: 'ממתקים', upd: now(), by: MGR }));
    await assertFails(fs(MGR).doc(P + 'smap/' + MAP + '/bay/f1-a-1').update({ catSug: 'x', upd: now(), by: MGR }));
    await assertFails(fs(MGR).doc(P + 'smap/' + MAP + '/bay/f1-a-1').update({ catConf: 1, upd: now(), by: MGR }));
    await assertFails(fs(MGR).doc(P + 'smap/' + MAP + '/bay/f1-a-3').set({ cat: 'x', catSug: 'y', upd: now(), by: MGR }));
    await assertFails(fs(MGR).doc(P + 'smap/' + MAP + '/bay/f1-a-3').set({ cat: 'x'.repeat(31), upd: now(), by: MGR }));
    await assertFails(fs(MGR).doc(P + 'smap/' + MAP + '/bay/f1-a-3').set({ notes: Array.from({ length: 21 }, () => ({ t: 'a' })), upd: now(), by: MGR }));
    await assertFails(fs(MGR).doc(P + 'smap/' + MAP + '/bay/f1-a-3').set({ cat: 'x', upd: now(), by: S3M }));
    await assertFails(fs(MGR).doc(P + 'smap/' + MAP + '/bay/bad').set({ cat: 'x', upd: now(), by: MGR }));
    for (const u of [S3M, RESP, FOR, OMGR]) await assertFails(fs(u).doc(P + 'smap/' + MAP + '/bay/f1-a-1').update({ cat: 'x', upd: now(), by: u }), u);
  });

  it('sround: מנהל יוצר ומעדכן; שדות השרת (uids, next, last, lastRun, err) חסומים; עובד לא כותב', async () => {
    await assertSucceeds(fs(MGR).doc(P + 'sround/newrule1').set(okRound(MGR)));
    await assertSucceeds(fs(SUPER).doc(P + 'sround/newrule2').set(okRound(SUPER, { f: { k: 'days', n: 14 }, sub: 'any', subU: '', due: 3, map: 'w-main' })));
    for (const o of [{ uids: [FOR] }, { next: now() }, { last: now() }, { lastRun: RUN }, { err: '' }, { del: 1, delAt: now(), delBy: MGR },
      { map: 's-other' }, { br: 'Main' }, { name: '' }, { f: { k: 'week' } }, { f: { k: 'month', dom: 29 } }, { f: { k: 'days', n: 91 } }, { f: { k: 'yearly' } },
      { asg: [] }, { asg: Array.from({ length: 11 }, () => ({ u: RESP })) }, { sub: 'x' }, { due: 20 }, { on: 'yes' }, { by: RESP }]) {
      await assertFails(fs(MGR).doc(P + 'sround/newrule3').set(okRound(MGR, o)), JSON.stringify(o).slice(0, 60));
    }
    await assertFails(fs(MGR).doc(P + 'sround/BAD').set(okRound(MGR)));
    await assertSucceeds(fs(MGR).doc(P + 'sround/' + RID).update({ name: 'שבועי חדש', asg: [{ u: RESP, z: [] }, { u: FOR, z: ['r1'] }], upd: now(), by: MGR }));
    for (const k of ['uids', 'next', 'last', 'lastRun', 'err']) {
      await assertFails(fs(MGR).doc(P + 'sround/' + RID).update({ [k]: k === 'uids' ? [FOR] : 1, upd: now(), by: MGR }), k);
    }
    await assertFails(fs(MGR).doc(P + 'sround/' + RID).update({ name: 'בלי זמן' }));
    for (const u of [S3M, RESP, FOR, OMGR]) {
      await assertFails(fs(u).doc(P + 'sround/x' + 'newrule9').set(okRound(u)), u);
      await assertFails(fs(u).doc(P + 'sround/' + RID).update({ name: 'x', upd: now(), by: u }), u);
    }
  });

  it('sround – סל מחזור: מחיקה = del:1 עם delAt/delBy; ביטול מחיקה רק בתוך 30 יום; delete – נחסם', async () => {
    const r = fs(MGR).doc(P + 'sround/' + RID);
    await assertFails(r.update({ del: 1, upd: now(), by: MGR }));
    await assertFails(r.update({ del: 1, delAt: now(), delBy: RESP, upd: now(), by: MGR }));
    await assertFails(r.update({ del: 1, delAt: now() - 10 * DAY, delBy: MGR, upd: now(), by: MGR }));
    await assertFails(r.update({ del: true, delAt: now(), delBy: MGR, upd: now(), by: MGR }));
    await assertSucceeds(r.update({ del: 1, delAt: now(), delBy: MGR, upd: now(), by: MGR }));
    await assertFails(r.update({ delAt: now() + 1000, upd: now(), by: MGR }), 'שינוי delAt בלי שינוי del');
    // כלל בסל המחזור: אין עריכה ואין "נגיעה" – רק שחזור
    await assertFails(fs(MGR).doc(P + 'sround/delrule1').update({ name: 'עריכה בסל', upd: now(), by: MGR }), 'עריכה בסל');
    await assertFails(fs(MGR).doc(P + 'sround/delrule1').update({ on: true, upd: now(), by: MGR }), 'הפעלה בסל');
    await assertFails(fs(MGR).doc(P + 'sround/delrule1').update({ upd: now(), by: MGR }), 'נגיעה בסל');
    await assertFails(fs(MGR).doc(P + 'sround/delrule1').update({ del: 0, name: 'שחזור+עריכה', upd: now(), by: MGR }), 'שחזור עם עריכה');
    await assertSucceeds(fs(MGR).doc(P + 'sround/delrule1').update({ del: 0, upd: now(), by: MGR }));
    await assertSucceeds(fs(MGR).doc(P + 'sround/delrule1').update({ name: 'אחרי שחזור', upd: now(), by: MGR }), 'עריכה אחרי שחזור');
    await assertFails(fs(MGR).doc(P + 'sround/oldrule1').update({ del: 0, upd: now(), by: MGR }), 'אחרי 30 יום');
    await assertFails(r.delete());
  });

  it('s3appeal: עובד אחראי ומנהל יוצרים; עובד זר / s3m / עסק אחר – נחסמים; ערעור אחד לבעיה; הכרעה – מנהל בלבד, פעם אחת', async () => {
    await assertFails(fs(FOR).doc(P + 's3appeal/' + AID0).set(okAppeal(FOR)), 'עובד זר');
    await assertFails(fs(S3M).doc(P + 's3appeal/' + AID0).set(okAppeal(S3M)), 's3m שלא בסבב');
    await assertFails(fs(OEMP).doc(P + 's3appeal/' + AID0).set(okAppeal(OEMP)), 'עסק אחר');
    await assertFails(fs(RESP).doc(P + 's3appeal/' + AID0).set(okAppeal(RESP, { st: 'acc' })));
    await assertFails(fs(RESP).doc(P + 's3appeal/' + AID0).set(okAppeal(RESP, { by: FOR })));
    await assertFails(fs(RESP).doc(P + 's3appeal/' + AID0).set(okAppeal(RESP, { txt: '' })));
    await assertFails(fs(RESP).doc(P + 's3appeal/' + AID0).set(okAppeal(RESP, { txt: 'x'.repeat(301) })));
    await assertFails(fs(RESP).doc(P + 's3appeal/' + AID0).set(okAppeal(RESP, { ik: 'x' })));
    await assertFails(fs(RESP).doc(P + 's3appeal/' + AID0).set(okAppeal(RESP, { dec: 'x' })));
    await assertFails(fs(RESP).doc(P + 's3appeal/wrong-id').set(okAppeal(RESP)), 'מזהה לא תואם');
    const ghost = 'rule0001_20261201';
    await assertFails(fs(RESP).doc(P + `s3appeal/${ghost}__${SLOT}__0`).set(okAppeal(RESP, { run: ghost })), 'סבב שלא קיים');
    await assertSucceeds(fs(RESP).doc(P + 's3appeal/' + AID0).set(okAppeal(RESP)));
    await assertFails(fs(RESP).doc(P + 's3appeal/' + AID0).set(okAppeal(RESP, { txt: 'שוב' })), 'ערעור שני לאותה בעיה');
    await assertSucceeds(fs(MGR).doc(P + `s3appeal/${RUN}__${SLOT}__all`).set(okAppeal(MGR, { ik: 'all' })));
    // הכרעה
    const a = P + 's3appeal/' + AID0;
    await assertFails(fs(RESP).doc(a).update({ st: 'acc', decBy: RESP, decAt: now() }), 'עובד מכריע');
    await assertFails(fs(MGR).doc(a).update({ st: 'acc', decBy: MGR, decAt: now(), txt: 'שונה' }), 'שינוי הטקסט');
    await assertFails(fs(MGR).doc(a).update({ st: 'open', decBy: MGR, decAt: now() }));
    await assertFails(fs(MGR).doc(a).update({ st: 'acc', decBy: RESP, decAt: now() }));
    await assertFails(fs(MGR).doc(a).update({ st: 'acc', decBy: MGR, decAt: now(), note: 'yes' }));
    await assertSucceeds(fs(MGR).doc(a).update({ st: 'acc', dec: 'צודק', decBy: MGR, decAt: now(), note: true }));
    await assertFails(fs(MGR).doc(a).update({ st: 'rej', decBy: MGR, decAt: now() }), 'הכרעה שנייה');
    await assertFails(fs(OMGR).doc(P + `s3appeal/${RUN}__${SLOT}__1`).update({ st: 'rej', decBy: OMGR, decAt: now() }), 'מנהל של עסק אחר');
  });

  it('s3short: מנהל מאשר/משמיט; לא משנה את הפריטים; עובד – נחסם; אין יצירה', async () => {
    const p = P + 's3short/' + RUN;
    await assertFails(fs(MGR).doc(p).update({ st: 'ok', okBy: MGR, okAt: now(), items: [] }));
    await assertFails(fs(MGR).doc(p).update({ st: 'sent', okBy: MGR, okAt: now() }));
    await assertFails(fs(MGR).doc(p).update({ st: 'ok', drop: Array.from({ length: 201 }, (_, i) => i), okBy: MGR, okAt: now() }));
    await assertFails(fs(RESP).doc(p).update({ st: 'ok', okBy: RESP, okAt: now() }));
    await assertSucceeds(fs(MGR).doc(p).update({ st: 'ok', drop: [0], okBy: MGR, okAt: now() }));
    await assertFails(fs(MGR).doc(p).update({ st: 'no', okBy: MGR, okAt: now() }), 'שינוי החלטה שכבר ניתנה');
    await assertFails(fs(MGR).doc(p).update({ drop: [0, 1], okBy: MGR, okAt: now() }), 'שינוי השמטות אחרי אישור');
    await assertFails(fs(MGR).doc(P + 's3short/rule0001_20261201').set({ items: [], st: 'draft' }));
  });

  // עדכון 7ב: המסמכים המדויקים שהמסכים של שלבים 11 ו-13 שולחים (store3d-wizard.js, store3d-report.js), ושדות שרת חדשים
  it('7ב – המסמכים שהמסכים שולחים: כלל סבב מהאשף, החלפת s3set מלאה, הכרעת ערעור ואישור חוסרים', async () => {
    // אשף ההקמה (שלב 11): מזהה r + 10 תווים, עובד אחד עם z ריק, due, בלי sub/subU; תדירות לפי הסוג
    const wiz = (f) => ({ br: 'main', map: 's-main', name: 'סבב שבועי', f, asg: [{ u: RESP, z: [] }], due: 2, on: true, upd: now(), by: MGR });
    await assertSucceeds(fs(MGR).doc(P + 'sround/rk2m4q1x9za').set(wiz({ k: 'week', dow: 3 })));
    await assertSucceeds(fs(MGR).doc(P + 'sround/rk2m4q1x9zb').set(wiz({ k: 'days', n: 7 })));
    await assertSucceeds(fs(MGR).doc(P + 'sround/rk2m4q1x9zc').set(wiz({ k: 'month', dom: 1 })));
    await assertSucceeds(fs(MGR).doc(P + 'sround/rk2m4q1x9zd').set(wiz({ k: 'manual' })));
    await assertFails(fs(MGR).doc(P + 'sround/rk2m4q1x9ze').set(wiz({ k: 'week' })), 'שבועי בלי יום');
    // הגדרות (שלב 13): החלפת מסמך מלאה (בלי מיזוג) – גם כשהמחליף הקבוע (subU) יורד
    const s0 = okSet(MGR, { show: ['fix'], cats: [], sub: 'manual' }); delete s0.subU;
    await assertSucceeds(fs(MGR).doc(P + 's3set/main').set(s0));
    await assertSucceeds(fs(MGR).doc(P + 's3set/main').set(okSet(MGR, { sub: 'fixed', subU: RESP, show: ['fix', 'score', 'recs', 'full'], upd: now() + 1 })));
    await assertFails(fs(MGR).doc(P + 's3set/main').set(okSet(MGR, { numDir: 'up' })), 'numDir לא תקין');
    // הכרעת ערעור: דחייה בלי note ועם תגובה ריקה (כמו המסך)
    const a = P + 's3appeal/' + RUN + '__' + SLOT + '__1';
    await assertSucceeds(fs(MGR).doc(a).update({ st: 'rej', dec: '', decBy: MGR, decAt: now() }));
    // אישור חוסרים: drop רשימת מספרים
    await assertSucceeds(fs(MGR).doc(P + 's3short/' + RUN).update({ st: 'no', drop: [], okBy: MGR, okAt: now() }));
  });

  it('7ב – שדות שרת חדשים חסומים ללקוח: s3appeal.sv; s3use/a_{uid} – קריאה למנהל בלבד; s3draft עם conf/notes – אותה הרשאת קריאה', async () => {
    // sv – רק השרת (סימון שהערעור טופל עד הסוף): לא ביצירה, לא בהכרעה
    await assertFails(fs(RESP).doc(P + 's3appeal/' + AID0).set(okAppeal(RESP, { sv: now() })), 'sv ביצירה');
    const a = P + 's3appeal/' + RUN + '__' + SLOT + '__1';
    await assertFails(fs(MGR).doc(a).update({ st: 'acc', decBy: MGR, decAt: now(), sv: now() }), 'sv בהכרעה');
    await prep((d) => d.doc(a).update({ st: 'acc', decBy: MGR, decAt: now(), sv: now() }));
    await assertFails(fs(MGR).doc(a).update({ sv: now() + 5 }), 'שינוי sv אחרי הכרעה');
    // מונה דיווחים יזומים לעובד
    await prep((d) => d.doc(P + 's3use/a_' + RESP).set({ d: '2026-11-14', n: 3, upd: now() }));
    for (const u of [MGR, SUPER]) await assertSucceeds(fs(u).doc(P + 's3use/a_' + RESP).get(), u);
    for (const u of [RESP, S3M, FOR, OMGR]) await assertFails(fs(u).doc(P + 's3use/a_' + RESP).get(), u);
    for (const u of [MGR, SUPER, RESP]) await assertFails(fs(u).doc(P + 's3use/a_' + RESP).set({ d: '2026-11-14', n: 0, upd: now() }), u);
    // טיוטה עם conf / notes – הקריאה לא השתנתה (מנהל, s3m, היוצר)
    await prep((d) => d.doc(P + 's3draft/draft-0000000000000002').set({ br: 'main', kind: 's', by: RESP, at: now(), st: 'ok', n: 2, conf: 0.7, notes: 'קנה מידה לפי דלת' }));
    for (const u of [MGR, S3M, RESP]) await assertSucceeds(fs(u).doc(P + 's3draft/draft-0000000000000002').get(), u);
    for (const u of [FOR, OEMP]) await assertFails(fs(u).doc(P + 's3draft/draft-0000000000000002').get(), u);
  });

  it('עובד מושבת עם s3m – נחסם בכל (קריאה וכתיבה)', async () => {
    for (const p of ['smap/' + MAP, 'smap/' + MAP + '/ver/000001', 's3sum/' + MAP, 's3draft/draft-0000000000000001']) await assertFails(fs(DIS).doc(P + p).get());
    // כתיבה: ערעור (גם כשהוא ברשימת uids של הסבב), הגדרות, מקטע, כלל סבב, אישור חוסרים, המפה
    await prep((d) => d.doc(P + 'srun/' + RUN).update({ uids: [RESP, DIS] }));
    await assertFails(fs(DIS).doc(P + 's3appeal/' + AID0).set(okAppeal(DIS)), 'ערעור');
    await assertFails(fs(DIS).doc(P + 's3set/main').set(okSet(DIS)), 's3set');
    await assertFails(fs(DIS).doc(P + 'smap/' + MAP + '/bay/f1-a-2').set({ cat: 'x', upd: now(), by: DIS }), 'bay');
    await assertFails(fs(DIS).doc(P + 'sround/disrule1').set(okRound(DIS)), 'sround');
    await assertFails(fs(DIS).doc(P + 's3short/' + RUN).update({ st: 'ok', okBy: DIS, okAt: now() }), 's3short');
    await assertFails(fs(DIS).doc(P + 'smap/' + MAP).update({ name: 'x', upd: now(), by: DIS }), 'smap');
    await assertFails(fs(DIS).collection(P + `s3perf/${DIS}/m`).get(), 's3perf list');
  });
});

describe('store3d – מסלול השורש (לארג\' פעמי במצב legacy)', () => {
  it('התוספת כבויה (features.store3d חסר) – אף אחד בשורש לא קורא, גם המנהל', async () => {
    await seed(false);
    for (const u of [RMGR, RS3M, RRESP]) for (const p of ['s3set/main', 'smap/' + MAP, 's3sum/' + MAP]) await assertFails(fs(u).doc(p).get(), u + ' ' + p);
    await assertFails(fs(RMGR).doc('s3set/main').set(okSet(RMGR)));
  });
  it('התוספת מופעלת: אותה מטריצה (19 אוספים) עם התפקידים בשורש (מנהל, s3m, אחראי, זר, מושבת, עסק אחר)', async () => {
    await seed(true);
    const RSTAFF = [RMGR, RS3M, RRESP, RFOR, SUPER];
    const rows = [
      ['s3br/main', RSTAFF],
      ['s3set/main', RSTAFF],
      ['smap/' + MAP, RSTAFF],
      ['smap/' + MAP + '/ver/000001', [RMGR, RS3M, SUPER]],
      ['smap/' + MAP + '/bay/f1-a-1', RSTAFF],
      ['s3draft/draft-0000000000000001', [RMGR, RS3M, RRESP, SUPER]],
      ['sround/' + RID, [RMGR, RRESP, SUPER]],
      ['srun/' + RUN, [RMGR, SUPER]],
      ['srun/' + RUN + '/ph/' + SLOT, RSTAFF],
      ['srun/' + RUN + '/ai/' + SLOT, [RMGR, SUPER]],
      ['s3sum/' + MAP, RSTAFF],
      ['s3fix/' + RUN + '__' + SLOT, [RMGR, RRESP, SUPER]],
      ['s3appeal/' + RUN + '__' + SLOT + '__1', [RMGR, RRESP, SUPER]],
      ['s3short/' + RUN, [RMGR, SUPER]],
      ['s3use/b_main', [RMGR, SUPER]],
      ['s3perf/' + RRESP + '/m/2026-11', [RMGR, RRESP, SUPER]],
      ['s3perf/' + RFOR + '/m/2026-11', [RMGR, RFOR, SUPER]],
      ['s3qid/' + 'q'.repeat(16), []],
      ['s3ntf/' + RUN + '_new', []],
    ];
    for (const [p, ok] of rows) {
      for (const u of [RMGR, RS3M, RRESP, RFOR, RDIS, SUPER, MGR, OMGR, null]) {
        const r = fs(u).doc(p).get();
        if (ok.includes(u)) await assertSucceeds(r, u + ' ' + p); else await assertFails(r, u + ' ' + p);
      }
    }
    await assertSucceeds(fs(RMGR).doc('s3set/main').set(okSet(RMGR)));
    await assertFails(fs(RRESP).doc('s3set/main').set(okSet(RRESP)));
    await assertFails(fs(RS3M).doc('smap/' + MAP).update({ name: 'x' }));
    await assertFails(fs(RMGR).doc('smap/' + MAP).update({ name: 'x' }));
    await assertSucceeds(fs(RMGR).doc('sround/newrule1').set(okRound(RMGR, { asg: [{ u: RRESP, z: [] }] })));
    await assertFails(fs(RMGR).doc('sround/newrule2').set(okRound(RMGR, { uids: [RRESP] })));
    await assertSucceeds(fs(RRESP).doc('s3appeal/' + AID0).set(okAppeal(RRESP)));
    await assertFails(fs(RFOR).doc(`s3appeal/${RUN}__${SLOT}__2`).set(okAppeal(RFOR, { ik: '2' })));
    await assertSucceeds(fs(RMGR).doc('s3appeal/' + AID0).update({ st: 'rej', decBy: RMGR, decAt: now() }));
    for (const p of ['s3br/main', 'srun/' + RUN, 's3sum/' + MAP, 's3use/b_main']) await assertFails(fs(RMGR).doc(p).set({ x: 1 }), p);
    // s3perf – שליפת רשימה בשורש
    await assertSucceeds(fs(RRESP).collection(`s3perf/${RRESP}/m`).get());
    await assertFails(fs(RRESP).collection(`s3perf/${RFOR}/m`).get());
    for (const u of [RMGR, SUPER]) await assertSucceeds(fs(u).collection(`s3perf/${RRESP}/m`).get(), u);
    for (const u of [RDIS, MGR, null]) await assertFails(fs(u).collection(`s3perf/${RRESP}/m`).get(), String(u));
    // עובד מושבת בשורש – לא כותב
    await assertFails(fs(RDIS).doc(`s3appeal/${RUN}__${SLOT}__3`).set(okAppeal(RDIS, { ik: '3' })));
    await assertFails(fs(RDIS).doc('s3set/main').set(okSet(RDIS)));
  });
});

describe('store3d – חוקי Storage', () => {
  const JPG = (n) => new Uint8Array(n).fill(7);
  const base = `b/${A}/store3d/main`;
  const files = {
    full: `${base}/run/${RUN}/${SLOT}_1.jpg`,
    thumb: `${base}/run/${RUN}/${SLOT}_1_t.jpg`,
    bigThumb: `${base}/run/${RUN}/${SLOT}_2_t.jpg`,
    png: `${base}/run/${RUN}/${SLOT}_3.jpg`,
    tex: `${base}/tex/${MAP}/t1_1.jpg`,
    draft: `${base}/draft/draft-0000000000000001/1.jpg`,
    fix: `${base}/fix/${RUN}__${SLOT}_1.jpg`,
    fixT: `${base}/fix/${RUN}__${SLOT}_1_t.jpg`,
    stray: `${base}/other/x/y.jpg`,
    otherBiz: `b/${O}/store3d/main/run/${RUN}/${SLOT}_1.jpg`,
  };
  before(async () => {
    await seed(true);
    await env.withSecurityRulesDisabled(async (c) => {
      const s = c.storage();
      const up = (p, n, ct) => s.ref(p).put(JPG(n), { contentType: ct || 'image/jpeg' });
      await up(files.full, 2000); await up(files.thumb, 1000); await up(files.bigThumb, 160000); await up(files.png, 2000, 'image/png');
      await up(files.tex, 2000); await up(files.draft, 2000); await up(files.fix, 2000); await up(files.fixT, 1000);
      await up(files.stray, 1000); await up(files.otherBiz, 1000);
    });
  });
  it('קריאה: חברי העסק (מנהל־על, מנהל, עובדים) – רק JPEG בגודל המותר ובנתיבים המוגדרים; עובד מושבת, עסק אחר, אורח – נחסמים', async () => {
    const wrong = [];
    for (const k of ['full', 'thumb', 'tex', 'fix', 'fixT']) {
      for (const u of [SUPER, MGR, S3M, RESP, FOR, DIS, OMGR, OEMP, null]) {
        const want = [SUPER, MGR, S3M, RESP, FOR].includes(u);
        const got = await st(u).ref(files[k]).getMetadata().then(() => true, () => false);
        if (got !== want) wrong.push(`${u} ${k}: ${got ? 'מותר' : 'נחסם'}`);
      }
    }
    assert.deepEqual(wrong, []);
    for (const k of ['bigThumb', 'png', 'stray']) await assertFails(st(MGR).ref(files[k]).getMetadata(), k);
    // עדכון 7ב: תמונות טיוטת המפה לא נשמרות בשרת – הנתיב draft/ סגור לקריאה לכולם (גם מנהל־על)
    for (const u of [SUPER, MGR, S3M, RESP]) await assertFails(st(u).ref(files.draft).getMetadata(), 'draft ' + u);
    await assertFails(st(MGR).ref(files.otherBiz).getMetadata());
    await assertSucceeds(st(OMGR).ref(files.otherBiz).getMetadata());
  });
  it('רשימת קבצים (list) – נחסמת לכולם', async () => {
    for (const u of [SUPER, MGR, RESP]) await assertFails(st(u).ref(`${base}/run/${RUN}`).listAll());
  });
  it('כתיבה ומחיקה – לאף לקוח (גם מנהל־על ו-s3m), בכל נתיב, סוג וגודל', async () => {
    for (const u of [SUPER, MGR, S3M, RESP]) {
      await assertFails(st(u).ref(`${base}/run/${RUN}/${SLOT}_9.jpg`).put(JPG(1000), { contentType: 'image/jpeg' }), u);
      await assertFails(st(u).ref(`${base}/tex/${MAP}/t2_1.jpg`).put(JPG(1000), { contentType: 'image/jpeg' }), u);
      await assertFails(st(u).ref(files.full).delete(), u);
    }
  });
});
