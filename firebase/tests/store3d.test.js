'use strict';
// סריקת חנות בתלת מימד – שלב 5 (14.11.2026): סבבים בשרת, באמולטור. חלק מ-test:multibiz.
//   1. s3Rounds (הליבה runAll, עם now מדומה ושליחת התראות מדומה) מול Firestore של האמולטור: פתיחה בזמן הנכון ובלי כפילויות
//      (גם בהרצה כפולה ובמקביל), שבוע/חודש/כל X ימים/ידני, חלוקה לכמה עובדים, מחליף קבוע לעובד שהושבת, עובד מושבת = שגיאה,
//      מפה חסרה/מחוקה, תזכורת ואיחור (פעם אחת), עסק עם התוספת כבויה, ולארג' פעמי במצב legacy (בשורש).
//   2. הפונקציות s3Run, s3Move, s3Log, s3View דרך אמולטור הפונקציות: מי רשאי, ידני, ביטול, העברה ולקיחה, יומן זמנים עם qid, מה עובד רואה.
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const TK = require('../functions/lib/tk-time');
const T = require('../functions/lib/tenant');

const A = 'biz-s3a', B = 'biz-s3b';
const MGR = 's3_mgr1', E1 = 's3_emp1', E2 = 's3_emp2', OFF = 's3_off1', SUB = 's3_sub1', EB = 's3_empb';
const LM = 's3_lmgr', LE = 's3_lemp';
const RID = 'r8k2m4q1', RID2 = 'r9x7w5v3';
const D1 = 86400000;
const at = (y, m, d, hh, mm) => TK.zoned(y, m - 1, d, hh || 0, mm || 0);
const ED = at(2026, 11, 10, 9);          // הכלל נשמר ביום שלישי 10.11.2026
const SUN = at(2026, 11, 15, 6);          // ראשון 15.11.2026 06:00 שעון ישראל
const fx = (id, o) => Object.assign({ id, k: 'gon', x: 100, y: 100, w: 200, d: 60, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }, o);
const MAP = (o) => Object.assign({ br: 'main', kind: 's', name: 'חנות', v: 1, seq: 9, grid: 50, numDir: 'rtl', rooms: [{ id: 'r1', name: 'ראשי', p: [0, 0, 1000, 0, 1000, 1000, 0, 1000], h: 300 }],
  walls: [], cols: [], doors: [], syms: [], src: 'manual', upd: ED, by: MGR,
  fx: [fx('f1', { sides: 2, bays: 3 }), fx('f2', { hi: true }), fx('f3', { room: 'r2', bays: 4 })] }, o);
const RULE = (o) => Object.assign({ br: 'main', map: 's-main', name: 'סבב שבועי', f: { k: 'week', dow: 0 }, asg: [{ u: E1, z: [] }], on: true, upd: ED, by: MGR }, o);

let env, adm;
const get = async (p) => { const s = await adm.doc(p).get(); return s.exists ? s.data() : null; };
const ids = async (p) => (await adm.collection(p).get()).docs.map((d) => d.id).sort();
const FEAT = { scan: true, tasks: true, store3d: true };

async function seed() {
  await env.clearFirestore();
  const b = adm.batch();
  b.set(adm.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: FEAT });
  b.set(adm.doc('b/' + B), { name: 'ב', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: Object.assign({}, FEAT, { store3d: false }) });
  b.set(adm.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
  for (const [u, active, role] of [[MGR, true, 'manager'], [E1, true, 'employee'], [E2, true, 'employee'], [OFF, false, 'employee'], [SUB, true, 'employee']]) {
    b.set(adm.doc(`b/${A}/staff/${u}`), { name: u, role, active, pushTokens: ['tok_' + u + '_0123456789abcdef'] });
    b.set(adm.doc('users/' + u), { bizId: A, role: role === 'manager' ? 'admin' : 'worker', active, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
  }
  b.set(adm.doc(`b/${B}/staff/${EB}`), { name: EB, role: 'employee', active: true });
  b.set(adm.doc('users/' + EB), { bizId: B, role: 'worker', active: true, bizStatus: 'active', email: EB + '@example.invalid', createdAt: 1 });
  b.set(adm.doc(`b/${A}/smap/s-main`), MAP());
  b.set(adm.doc(`b/${B}/smap/s-main`), MAP());
  await b.commit();
}

describe('s3Rounds – פתיחת סבבים, תזכורות ואיחור (ליבה מול האמולטור)', () => {
  let R, sent;
  const send = async (tokens, msg) => { sent.push({ tokens, kind: msg.kind, title: msg.title }); return tokens.map((t) => ({ token: t, ok: true })); };
  const run = (now) => R.runAll({ now, send });
  const runs = () => ids(`b/${A}/srun`);

  before(async () => {
    env = await H.getEnv();
    R = require('../functions/store3d.js')._core;
    // אותו מופע firebase-admin של הפונקציות (functions/node_modules), מול האמולטור (FIRESTORE_EMULATOR_HOST)
    adm = require(require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions')] })).getFirestore();
  });
  beforeEach(async () => { sent = []; await seed(); });

  it('שבועי: 05:55 – לא; 06:02 – סבב אחד עם מזהה <rid>_<יום>, לפי החוזה; הכלל מתעדכן; התראה "חדש" לעובד', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE());
    let out = await run(at(2026, 11, 15, 5, 55));
    assert.deepEqual(await runs(), [], JSON.stringify(out));
    assert.equal((await get(`b/${A}/sround/${RID}`)).next, SUN, 'next נכתב גם בלי פתיחה');
    const now = SUN + 2 * 60000;
    out = await run(now);
    assert.equal(out[A].opened, 1, JSON.stringify(out));
    const r = await get(`b/${A}/srun/${RID}_20261115`);
    assert.deepEqual(r, {
      rid: RID, br: 'main', map: 's-main', mapV: 1, k: 'sched', st: 'open', uids: [E1], n: 14, nDone: 0, nUid: { [E1]: { n: 14, d: 0 } },
      asg: { [E1]: ['f1-a-1', 'f1-a-2', 'f1-a-3', 'f1-b-1', 'f1-b-2', 'f1-b-3', 'f2-a-1', 'f2-a-2', 'f3-a-1', 'f3-a-2', 'f3-a-3', 'f3-a-4'] },
      openAt: now, dueAt: now + 2 * D1, tlog: { [E1]: [] },
    });
    const rule = await get(`b/${A}/sround/${RID}`);
    assert.deepEqual([rule.last, rule.lastRun, rule.next, rule.uids, rule.err], [now, RID + '_20261115', at(2026, 11, 22, 6), [E1], '']);
    assert.deepEqual(await get(`b/${A}/s3ntf/${RID}_20261115_new`), { at: now, kind: 'new', to: [E1] });
    assert.deepEqual(sent.map((s) => [s.kind, s.tokens]), [['new', ['tok_' + E1 + '_0123456789abcdef']]]);
    assert.deepEqual(await ids(`b/${B}/srun`), [], 'עסק עם store3d כבוי – לא נגעו');
  });

  it('בלי כפילויות: שתי ריצות במקביל, ריצה חוזרת וריצה מאוחרת באותו שבוע – סבב אחד והתראה אחת; שבוע אחרי – סבב חדש', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE());
    await Promise.all([run(SUN + 60000), run(SUN + 60000)]);
    await run(SUN + 5 * 60000);
    await run(at(2026, 11, 18, 22));
    assert.deepEqual(await runs(), [RID + '_20261115']);
    assert.equal(sent.filter((s) => s.kind === 'new').length, 1);
    await adm.doc(`b/${A}/srun/${RID}_20261115`).update({ st: 'done', doneAt: SUN + D1 }); // הסבב הקודם הסתיים
    await run(at(2026, 11, 22, 6, 1));
    assert.deepEqual(await runs(), [RID + '_20261115', RID + '_20261122']);
  });

  it('חודשי, כל X ימים, ידני וכבוי', async () => {
    await adm.doc(`b/${A}/sround/mrule01`).set(RULE({ f: { k: 'month', dom: 1 } }));
    await adm.doc(`b/${A}/sround/drule01`).set(RULE({ f: { k: 'days', n: 3 } }));
    await adm.doc(`b/${A}/sround/hrule01`).set(RULE({ f: { k: 'manual' } }));
    await adm.doc(`b/${A}/sround/orule01`).set(RULE({ on: false }));
    await run(at(2026, 11, 11, 6, 1));
    assert.deepEqual(await runs(), ['drule01_20261111']);
    await run(at(2026, 11, 13, 23));
    assert.deepEqual(await runs(), ['drule01_20261111'], 'לא לפני 3 ימים');
    await adm.doc(`b/${A}/srun/drule01_20261111`).update({ st: 'closed', doneAt: at(2026, 11, 13, 23) });
    await run(at(2026, 11, 14, 6, 1));
    await adm.doc(`b/${A}/srun/drule01_20261114`).update({ st: 'done', doneAt: at(2026, 11, 15, 9) });
    await run(at(2026, 12, 1, 6, 1)); // כל 3 ימים: המועד (17.11) עבר בלי ריצה – סבב אחד, עם התאריך של המועד
    assert.deepEqual(await runs(), ['drule01_20261111', 'drule01_20261114', 'drule01_20261117', 'mrule01_20261201']);
    assert.equal((await get(`b/${A}/sround/hrule01`)).next, undefined, 'ידני – בלי מועד');
  });

  it('חלוקה לכמה עובדים לפי חדרים/גופים – אף מקטע לא אצל שניים; ההתראה לשניהם', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ asg: [{ u: E1, z: ['f2', 'r2'] }, { u: E2, z: [] }] }));
    await run(SUN + 60000);
    const r = await get(`b/${A}/srun/${RID}_20261115`);
    assert.deepEqual(r.asg[E1], ['f2-a-1', 'f2-a-2', 'f3-a-1', 'f3-a-2', 'f3-a-3', 'f3-a-4']);
    assert.deepEqual(r.asg[E2], ['f1-a-1', 'f1-a-2', 'f1-a-3', 'f1-b-1', 'f1-b-2', 'f1-b-3']);
    assert.deepEqual(r.nUid, { [E1]: { n: 8, d: 0 }, [E2]: { n: 6, d: 0 } });
    assert.equal(r.n, 14);
    assert.deepEqual((await get(`b/${A}/s3ntf/${RID}_20261115_new`)).to, [E1, E2]);
  });

  it('עובד שהושבת + מחליף קבוע (s3set): בסבב שנפתח החלק אצל המחליף (subFrom), הכלל של המנהל לא משתנה, התראת left למנהל ולמחליף', async () => {
    await adm.doc(`b/${A}/s3set/main`).set({ sub: 'fixed', subU: SUB, due: 3 });
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ asg: [{ u: OFF, z: ['f1'] }, { u: E1, z: [] }] }));
    await run(SUN + 60000);
    const rule = await get(`b/${A}/sround/${RID}`);
    assert.deepEqual(rule.asg, [{ u: OFF, z: ['f1'] }, { u: E1, z: [] }], 'asg של המנהל נשאר כמו שהוא');
    assert.deepEqual([rule.uids, rule.err], [[OFF, E1, SUB], '']);
    const r = await get(`b/${A}/srun/${RID}_20261115`);
    assert.deepEqual([r.uids, r.subFrom, r.dueAt - r.openAt], [[SUB, E1], { [OFF]: SUB }, 3 * D1]);
    assert.deepEqual((await get(`b/${A}/s3ntf/${OFF}_${RID}_left`)).to.sort(), [MGR, SUB].sort());
  });

  it('עובד מושבת בלי מחליף = שגיאה: הסבב נפתח (המנהל מעביר ידנית), err בכלל והתראה למנהל; מחליף קבוע מושבת – sub-disabled', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ asg: [{ u: OFF, z: [] }], sub: 'manual' }));
    await adm.doc(`b/${A}/sround/${RID2}`).set(RULE({ asg: [{ u: OFF, z: [] }], sub: 'fixed', subU: OFF }));
    const out = await run(SUN + 60000);
    assert.equal((await get(`b/${A}/sround/${RID}`)).err, 'staff-disabled', JSON.stringify(out));
    assert.equal((await get(`b/${A}/sround/${RID2}`)).err, 'sub-disabled');
    assert.deepEqual((await get(`b/${A}/s3ntf/${OFF}_${RID}_err`)).to, [MGR]);
    assert.deepEqual((await get(`b/${A}/srun/${RID}_20261115`)).uids, [OFF]);
    assert.deepEqual(sent.filter((s) => s.kind === 'new'), [], 'לא נשלחת התראה למושבת');
    // המנהל מתקן (עובד פעיל) – השגיאה נמחקת בריצה הבאה
    await adm.doc(`b/${A}/sround/${RID}`).update({ asg: [{ u: E1, z: [] }], upd: SUN + 3600000 });
    await run(SUN + 2 * 3600000);
    assert.equal((await get(`b/${A}/sround/${RID}`)).err, '');
  });

  it('מפה חסרה / מחוקה: אין סבב, err בכלל, התראה אחת למנהל; אחרי שמירת מפה – נפתח', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ map: 's-other' }));
    await adm.doc(`b/${A}/smap/w-main`).set(MAP({ kind: 'w', del: 1, delAt: ED, delBy: MGR }));
    await adm.doc(`b/${A}/sround/${RID2}`).set(RULE({ map: 'w-main' }));
    await run(SUN + 60000);
    await run(SUN + 6 * 60000);
    assert.deepEqual(await runs(), []);
    assert.equal((await get(`b/${A}/sround/${RID}`)).err, 'no-map');
    assert.equal((await get(`b/${A}/sround/${RID2}`)).err, 'map-deleted');
    assert.deepEqual((await get(`b/${A}/s3ntf/${RID}_20261115_err`)).to, [MGR]);
    assert.equal(sent.filter((s) => s.kind === 'err').length, 2, 'פעם אחת לכל כלל');
    await adm.doc(`b/${A}/smap/s-other`).set(MAP());
    await run(SUN + 3600000);
    assert.deepEqual(await runs(), [RID + '_20261115']);
    assert.equal((await get(`b/${A}/sround/${RID}`)).err, '');
  });

  it('תזכורת 24 שעות לפני המועד (לעובד שלא סיים), ובמועד – late והתראה לעובד ולמנהל; כל אחת פעם אחת', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ asg: [{ u: E1, z: ['f1'] }, { u: E2, z: [] }] }));
    await run(SUN + 60000);
    const id = `b/${A}/srun/${RID}_20261115`;
    const r0 = await get(id);
    await adm.doc(id).update({ [`tlog.${E2}`]: [{ k: 's', t: r0.openAt + 1000 }, { k: 'e', t: r0.openAt + 2000 }] }); // E2 רשם סיום – לא מקבל תזכורת ולא התראת איחור
    await run(r0.dueAt - D1 - 60000);
    assert.equal(await get(`b/${A}/s3ntf/${RID}_20261115_remind`), null);
    await run(r0.dueAt - D1 + 60000);
    await run(r0.dueAt - D1 + 6 * 60000);
    assert.deepEqual((await get(`b/${A}/s3ntf/${RID}_20261115_remind`)).to, [E1]);
    assert.equal(sent.filter((s) => s.kind === 'remind').length, 1);
    assert.equal((await get(id)).st, 'open');
    await run(r0.dueAt + 60000);
    await run(r0.dueAt + 6 * 60000);
    assert.equal((await get(id)).st, 'late');
    assert.deepEqual((await get(`b/${A}/s3ntf/${RID}_20261115_late`)).to.sort(), [E1, MGR].sort());
    assert.equal(sent.filter((s) => s.kind === 'late').length, 2, 'עובד + מנהל, פעם אחת');
  });

  it('שלב 12: עובד שהושבת באמצע סבב פתוח לא מקבל תזכורת ולא התראת איחור (גם לא לטלפון שלו)', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ asg: [{ u: E1, z: ['f1'] }, { u: E2, z: [] }] }));
    await run(SUN + 60000);
    const id = `b/${A}/srun/${RID}_20261115`;
    const r0 = await get(id);
    assert.ok(r0.uids.includes(E2), 'E2 בסבב');
    await adm.doc(`b/${A}/staff/${E2}`).update({ active: false }); // הושבת – הטוקן נשאר ב-staff
    sent.length = 0;
    await run(r0.dueAt - D1 + 60000);
    assert.deepEqual((await get(`b/${A}/s3ntf/${RID}_20261115_remind`)).to, [E1]);
    await run(r0.dueAt + 60000);
    assert.deepEqual((await get(`b/${A}/s3ntf/${RID}_20261115_late`)).to.sort(), [E1, MGR].sort());
    assert.ok(!sent.some((x) => x.tokens.some((t) => t.startsWith('tok_' + E2 + '_'))), 'לא נשלח לטלפון של E2');
  });

  it('סבב ידני ב-04:00 ואחריו המועד המתוזמן ב-06:00 באותו יום: לא נפתח סבב שני (המועד מדולג); אחרי שהסבב הסתיים – המועד הבא נפתח', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ f: { k: 'week', dow: 6 } })); // שבת 14.11.2026
    const db = T.prefixed(adm, `b/${A}/`);
    const ctx = { db, now: at(2026, 11, 14, 4), mgrs: null, sets: {} };
    const rs = await db.doc('sround/' + RID).get();
    const m = await R.openRun(ctx, rs.ref, RID, await R.prepRule(ctx, rs.data()), RID + '_m' + ctx.now, 'manual', 0, rs.updateTime);
    assert.ok(m.runId, JSON.stringify(m));
    await adm.doc(`b/${A}/staff/${E1}`).update({ active: false }); // הושבת אחרי הסבב הידני; יש מחליף קבוע
    await adm.doc(`b/${A}/s3set/main`).set({ sub: 'fixed', subU: SUB });
    const out = await run(at(2026, 11, 14, 6, 5));
    assert.equal(out[A].skipped, 1, JSON.stringify(out));
    assert.equal(await get(`b/${A}/s3ntf/${E1}_${RID}_left`), null, 'מועד שדולג – בלי התראת left');
    assert.deepEqual(await runs(), [m.runId]);
    const rule = await get(`b/${A}/sround/${RID}`);
    assert.deepEqual([rule.lastRun, rule.last, rule.next], [m.runId, at(2026, 11, 14, 6), at(2026, 11, 21, 6)]);
    await run(at(2026, 11, 14, 6, 10));
    assert.deepEqual(await runs(), [m.runId]);
    // סבב קודם באיחור – גם כן לא נפתח סבב נוסף
    await run(at(2026, 11, 21, 6, 1));
    assert.equal((await get(`b/${A}/srun/${m.runId}`)).st, 'late');
    assert.deepEqual(await runs(), [m.runId]);
    await adm.doc(`b/${A}/srun/${m.runId}`).update({ st: 'closed', doneAt: at(2026, 11, 21, 7) });
    await run(at(2026, 11, 28, 6, 1));
    assert.deepEqual(await runs(), [m.runId, RID + '_20261128'].sort());
  });

  it('uids מתעדכן גם בכלל כבוי, ובכלל שבסל המחזור מתרוקן', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE());
    await run(SUN - 3600000);
    assert.deepEqual((await get(`b/${A}/sround/${RID}`)).uids, [E1]);
    await adm.doc(`b/${A}/sround/${RID}`).update({ asg: [{ u: E2, z: [] }], on: false, upd: SUN - 1800000 });
    await run(SUN - 600000);
    assert.deepEqual((await get(`b/${A}/sround/${RID}`)).uids, [E2]);
    await adm.doc(`b/${A}/sround/${RID}`).update({ del: 1, delAt: SUN - 300000, delBy: MGR, upd: SUN - 300000 });
    await run(SUN + 60000);
    assert.deepEqual((await get(`b/${A}/sround/${RID}`)).uids, []);
    assert.deepEqual(await runs(), [], 'כבוי / בסל – לא נפתח');
  });

  it('כתיבה לכלל רק אם לא השתנה מאז הקריאה: המנהל ערך בינתיים – השרת מדלג ולא דורס, והריצה הבאה מעדכנת', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE());
    const db = T.prefixed(adm, `b/${A}/`);
    const stale = await db.doc('sround/' + RID).get();
    await adm.doc(`b/${A}/sround/${RID}`).update({ asg: [{ u: E2, z: [] }], upd: ED + 1000 }); // עריכה של המנהל אחרי הקריאה
    const ctx = { db, now: SUN - 3600000, mgrs: null, sets: {} };
    assert.equal(await R.ruleStep(ctx, stale), 'changed');
    let rule = await get(`b/${A}/sround/${RID}`);
    assert.deepEqual([rule.asg, rule.uids, rule.next], [[{ u: E2, z: [] }], undefined, undefined]);
    // בזמן הפתיחה: גם הטרנזקציה מזהה שהכלל השתנה ולא פותחת לפי הקריאה הישנה
    const stale2 = await db.doc('sround/' + RID).get();
    await adm.doc(`b/${A}/sround/${RID}`).update({ asg: [{ u: E1, z: [] }], upd: ED + 2000 });
    assert.equal(await R.ruleStep(Object.assign({}, ctx, { now: SUN + 60000 }), stale2), 'changed');
    assert.deepEqual(await runs(), []);
    await run(SUN + 2 * 60000);
    rule = await get(`b/${A}/sround/${RID}`);
    assert.deepEqual([rule.uids, (await get(`b/${A}/srun/${RID}_20261115`)).uids], [[E1], [E1]]);
  });

  it('לארג\' פעמי במצב legacy (בשורש) – כשהתוספת מופעלת; כבויה – לא', async () => {
    await adm.doc('b/largpeami').set({ name: 'ל', status: 'active', dataRoot: 'legacy', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { scan: true, store3d: false } });
    await adm.doc('admins/' + LM).set({ email: 'l@example.invalid' });
    await adm.doc('staff/' + LE).set({ name: 'ל', role: 'employee', active: true });
    await adm.doc('smap/s-main').set(MAP());
    await adm.doc(`sround/${RID}`).set(RULE({ asg: [{ u: LE, z: [] }] }));
    await run(SUN + 60000);
    assert.deepEqual(await ids('srun'), []);
    await adm.doc('b/largpeami').update({ 'features.store3d': true });
    await run(SUN + 2 * 60000);
    assert.deepEqual(await ids('srun'), [RID + '_20261115']);
    assert.deepEqual(await runs(), [], 'לא נפתח בעסק אחר');
  });
});

// ---------------- הפונקציות (אמולטור הפונקציות – רץ ב-CI) ----------------
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
let qn = 0;
const qid = () => 'q' + Date.now().toString(36) + '-' + (qn++).toString().padStart(12, '0');

describe('s3Run / s3Move / s3Log / s3View (אמולטור הפונקציות)', () => {
  before(async () => {
    env = await H.getEnv();
    adm = require(require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions')] })).getFirestore();
  });
  beforeEach(async () => { await seed(); });

  it('s3Run: מנהל פותח ידנית (<rid>_m<זמן>); פעם שנייה כשהסבב פתוח – נחסם; עובד / אורח / עסק אחר – נחסמים; ביטול', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ f: { k: 'manual' }, asg: [{ u: E1, z: [] }, { u: E2, z: ['f2'] }] }));
    assert.equal((await call('s3Run', E1, { rid: RID })).reason, 'manager-only');
    assert.equal((await call('s3Run', null, { rid: RID })).status, 'UNAUTHENTICATED');
    assert.equal((await call('s3Run', EB, { rid: RID })).reason, 'feature-off');
    const r = await call('s3Run', MGR, { rid: RID });
    assert.equal(r.status, 'OK', r.text);
    assert.match(r.result.runId, /^r8k2m4q1_m[0-9]{13}$/);
    const doc = await get(`b/${A}/srun/${r.result.runId}`);
    assert.deepEqual([doc.k, doc.st, doc.n, doc.uids], ['manual', 'open', 14, [E1, E2]]);
    assert.equal((await get(`b/${A}/sround/${RID}`)).lastRun, r.result.runId);
    assert.equal((await call('s3Run', MGR, { rid: RID })).reason, 'run-open');
    assert.equal((await call('s3Run', MGR, { rid: 'nosuch1' })).reason, 'no-rule');
    assert.equal((await call('s3Run', MGR, { rid: '../x' })).reason, 'bad-rule');
    assert.equal((await call('s3Run', E1, { runId: r.result.runId, cancel: true })).reason, 'manager-only');
    assert.equal((await call('s3Run', MGR, { runId: r.result.runId, cancel: true })).status, 'OK');
    assert.equal((await get(`b/${A}/srun/${r.result.runId}`)).st, 'cancel');
    assert.equal((await call('s3Run', MGR, { runId: r.result.runId, cancel: true })).reason, 'run-closed');
    // מפה חסרה
    await adm.doc(`b/${A}/sround/${RID2}`).set(RULE({ f: { k: 'manual' }, map: 's-none' }));
    assert.equal((await call('s3Run', MGR, { rid: RID2 })).reason, 'no-map');
  });

  it('s3Log: רק העובד המשויך; נרשם ביומן שלו בלבד; qid חוזר לא נרשם פעמיים; זמן לא תקין נדחה; סיום של כולם = done והתראה למנהל', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ f: { k: 'manual' }, asg: [{ u: E1, z: ['f1'] }, { u: E2, z: [] }] }));
    const runId = (await call('s3Run', MGR, { rid: RID })).result.runId;
    const now = Date.now();
    assert.equal((await call('s3Log', SUB, { qid: qid(), run: runId, ev: 's', at: now })).reason, 'not-assigned');
    assert.equal((await call('s3Log', E1, { qid: qid(), run: runId, ev: 's', at: now + 10 * 60000 })).reason, 'bad-time');
    assert.equal((await call('s3Log', E1, { qid: 'short', run: runId, ev: 's', at: now })).reason, 'bad-qid');
    const q1 = qid();
    const a = await call('s3Log', E1, { qid: q1, run: runId, ev: 's', at: now });
    assert.equal(a.status, 'OK', a.text);
    const again = await call('s3Log', E1, { qid: q1, run: runId, ev: 's', at: now });
    assert.equal(again.result.dup, true);
    assert.equal((await call('s3Log', E2, { qid: q1, run: runId, ev: 's', at: now })).reason, 'bad-qid', 'qid של עובד אחר');
    let d = await get(`b/${A}/srun/${runId}`);
    assert.equal(d.tlog[E1].length, 1); assert.deepEqual(d.tlog[E2], []);
    await call('s3Log', E1, { qid: qid(), run: runId, ev: 'e', at: now + 1000 });
    assert.equal((await get(`b/${A}/srun/${runId}`)).st, 'open', 'E2 עוד לא סיים');
    await call('s3Log', E2, { qid: qid(), run: runId, ev: 's', at: now });
    const fin = await call('s3Log', E2, { qid: qid(), run: runId, ev: 'e', at: now + 2000 });
    assert.equal(fin.result.st, 'done', fin.text);
    d = await get(`b/${A}/srun/${runId}`);
    assert.equal(d.st, 'done'); assert.ok(d.doneAt >= d.openAt);
    assert.deepEqual((await get(`b/${A}/s3ntf/${runId}_done`)).to, [MGR]);
    assert.equal((await call('s3Log', E1, { qid: qid(), run: runId, ev: 'r', at: Date.now() })).reason, 'run-closed');
  });

  it('s3Move: מנהל מעביר; עובד לא מעביר; לקיחה רק כש-sub == any; עובד מושבת לא מקבל', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ f: { k: 'manual' }, asg: [{ u: E1, z: ['f1'] }, { u: E2, z: [] }] }));
    const runId = (await call('s3Run', MGR, { rid: RID })).result.runId;
    assert.equal((await call('s3Move', E1, { runId, from: E1, to: SUB })).reason, 'manager-only');
    assert.equal((await call('s3Move', MGR, { runId, from: E1, to: OFF })).reason, 'staff-disabled');
    assert.equal((await call('s3Move', SUB, { runId, from: E1, take: true })).reason, 'no-take', 'ברירת מחדל manual');
    const m = await call('s3Move', MGR, { runId, from: E1, to: SUB });
    assert.equal(m.status, 'OK', m.text);
    let d = await get(`b/${A}/srun/${runId}`);
    assert.deepEqual([d.uids, d.subFrom, d.asg[SUB]], [[E2, SUB], { [E1]: SUB }, ['f1-a-1', 'f1-a-2', 'f1-a-3', 'f1-b-1', 'f1-b-2', 'f1-b-3']]);
    assert.deepEqual((await get(`b/${A}/s3ntf/${runId}_move_${E1}`)).to.slice().sort(), [SUB, E1, MGR].sort(), 'שלב 12: גם מי שהחלק שלו הועבר');
    await adm.doc(`b/${A}/s3set/main`).set({ sub: 'any' });
    const t = await call('s3Move', E1, { runId, from: E2, take: true });
    assert.equal(t.status, 'OK', t.text);
    assert.deepEqual(t.result, { ok: true }, 'עובד שלוקח לא מקבל uids');
    assert.ok(Array.isArray(m.result.uids), 'מנהל כן מקבל uids');
    d = await get(`b/${A}/srun/${runId}`);
    assert.deepEqual(d.uids, [SUB, E1]);
    assert.deepEqual((await get(`b/${A}/s3ntf/${runId}_move_${E2}`)).to.slice().sort(), [E1, E2, MGR].sort(), 'שלב 12: לקיחה – גם העובד שהחלק נלקח ממנו');
  });

  it('s3View: עובד רואה רק את הסבבים שלו, רק את החלק והזמנים שלו, ולפי show; לא משויך – נחסם; מנהל – הכל', async () => {
    await adm.doc(`b/${A}/sround/${RID}`).set(RULE({ f: { k: 'manual' }, asg: [{ u: E1, z: ['f1'] }, { u: E2, z: [] }] }));
    const runId = (await call('s3Run', MGR, { rid: RID })).result.runId;
    await call('s3Log', E2, { qid: qid(), run: runId, ev: 's', at: Date.now() });
    await adm.doc(`b/${A}/srun/${runId}/ai/f1-a-1_a`).set({ st: 'issue', conf: 0.9, iss: [{ k: 'hole', sev: 2, conf: 0.8, t: 'חור', warn: false }], sc: { p: 100, h: 50, o: 100, d: 100, all: 80 }, prods: [{ n: 'במבה' }], model: 'm', at: Date.now(), ver: 1 });
    await adm.doc(`b/${A}/srun/${runId}/ai/f2-a-1_t`).set({ st: 'ok', conf: 0.9, iss: [], model: 'm', at: Date.now(), ver: 1 });
    const l = await call('s3View', E1, {});
    assert.equal(l.status, 'OK', l.text);
    assert.deepEqual(l.result.runs.map((x) => [x.runId, x.n]), [[runId, { n: 6, d: 0 }]]);
    assert.deepEqual(l.result.take, []);
    const v = (await call('s3View', E1, { runId })).result.run;
    assert.deepEqual(Object.keys(v.ai), ['f1-a-1_a']);
    assert.deepEqual(v.ai['f1-a-1_a'], { st: 'issue', iss: [{ k: 'hole', sev: 2, t: 'חור' }] });
    assert.deepEqual(v.tlog, []);
    assert.ok(!JSON.stringify(v).includes(E2), 'בלי זמנים ומקטעים של העובד השני');
    await adm.doc(`b/${A}/s3set/main`).set({ show: ['fix', 'score'] });
    assert.deepEqual((await call('s3View', E1, { runId })).result.run.ai['f1-a-1_a'].sc, { all: 80 });
    assert.equal((await call('s3View', SUB, { runId })).reason, 'not-assigned');
    assert.deepEqual((await call('s3View', SUB, {})).result.runs, []);
    assert.equal((await call('s3View', EB, {})).reason, 'feature-off');
    const mv = (await call('s3View', MGR, { runId })).result.run;
    assert.equal(mv.tlog[E2].length, 1);
    // "כל עובד יכול לקחת": הרשימה בלי מזהי משתמש של עובדים אחרים; לקיחה לפי המזהה העקיף
    await adm.doc(`b/${A}/s3set/main`).set({ show: ['fix'], sub: 'any' });
    const tk = (await call('s3View', SUB, {})).result.take;
    assert.equal(tk.length, 1);
    assert.deepEqual(tk[0].parts.map((x) => [x.n, x.bays]), [[6, 6], [8, 6]]);
    assert.ok(!JSON.stringify(tk).includes(E1) && !JSON.stringify(tk).includes(E2), JSON.stringify(tk));
    // עובד עם שיוך לסניף אחר – לא רואה ולא לוקח (אותו תנאי בשני המקומות)
    await adm.doc(`b/${A}/staff/${SUB}`).update({ br: ['other'] });
    assert.deepEqual((await call('s3View', SUB, {})).result.take, []);
    assert.equal((await call('s3Move', SUB, { runId, fromH: tk[0].parts[0].h, take: true })).reason, 'other-branch');
    await adm.doc(`b/${A}/staff/${SUB}`).update({ br: ['main'] });
    const g = await call('s3Move', SUB, { runId, fromH: tk[0].parts[0].h, take: true });
    assert.equal(g.status, 'OK', g.text);
    assert.deepEqual(g.result, { ok: true });
    assert.deepEqual((await get(`b/${A}/srun/${runId}`)).uids, [E2, SUB]);
    assert.equal((await call('s3Move', SUB, { runId, fromH: '0123456789abcdef', take: true })).reason, 'not-in-run');
  });

  it('שלב 13ב – s3View past: עובד רואה את הסבבים שלו שנסגרו ב-30 הימים האחרונים, רק את החלק שלו; לא של עובד אחר; לא ישן/מבוטל; עסק אחר – feature-off', async () => {
    const now = Date.now();
    const base = (o) => Object.assign({ rid: RID, br: 'main', map: 's-main', mapV: 1, k: 'sched', n: 8, openAt: now - 5 * D1, tlog: {} }, o);
    const R1 = RID + '_20261101', R2 = RID + '_20261102', ROLD = RID + '_20260901', RCAN = RID + '_20261103', RE2 = RID2 + '_20261104';
    await adm.doc(`b/${A}/srun/${R1}`).set(base({ st: 'done', uids: [E1, E2], asg: { [E1]: ['f1-a-1'], [E2]: ['f2-a-1'] }, nUid: { [E1]: { n: 2, d: 2 }, [E2]: { n: 6, d: 6 } }, dueAt: now - 2 * D1, doneAt: now - 3 * D1 }));
    await adm.doc(`b/${A}/srun/${R2}`).set(base({ st: 'closed', uids: [E1], asg: { [E1]: ['f1-a-1'] }, nUid: { [E1]: { n: 2, d: 1 } }, dueAt: now - 4 * D1, doneAt: now - D1 }));
    await adm.doc(`b/${A}/srun/${ROLD}`).set(base({ st: 'done', uids: [E1], asg: { [E1]: ['f1-a-1'] }, nUid: { [E1]: { n: 2, d: 2 } }, dueAt: now - 40 * D1, doneAt: now - 40 * D1 }));
    const RLATE = RID + '_20260915'; // תיקון סבב 2: איחור ארוך (המועד לפני 60 יום), הושלם לפני יומיים – חייב להופיע
    await adm.doc(`b/${A}/srun/${RLATE}`).set(base({ st: 'closed', uids: [E1], asg: { [E1]: ['f1-a-1'] }, nUid: { [E1]: { n: 2, d: 2 } }, openAt: now - 70 * D1, dueAt: now - 60 * D1, doneAt: now - 2 * D1 }));
    await adm.doc(`b/${A}/srun/${RCAN}`).set(base({ st: 'cancel', uids: [E1], asg: { [E1]: ['f1-a-1'] }, nUid: { [E1]: { n: 2, d: 0 } }, dueAt: now - D1, doneAt: now - D1 }));
    await adm.doc(`b/${A}/srun/${RE2}`).set(base({ rid: RID2, st: 'done', uids: [E2], asg: { [E2]: ['f2-a-1'] }, nUid: { [E2]: { n: 6, d: 6 } }, dueAt: now - D1, doneAt: now - D1 }));
    await adm.doc(`b/${A}/srun/${R1}/ai/f2-a-1_a`).set({ st: 'issue', conf: 0.9, iss: [{ k: 'hole', sev: 2, conf: 0.8, t: 'חור של E2', warn: false }], model: 'm', at: now, ver: 1 });
    await adm.doc(`b/${A}/srun/${R1}/ai/f1-a-1_a`).set({ st: 'ok', conf: 0.9, iss: [], model: 'm', at: now, ver: 1 });
    const l = await call('s3View', E1, {});
    assert.equal(l.status, 'OK', l.text);
    assert.deepEqual(l.result.past.map((x) => [x.runId, x.st, x.n]), [[R2, 'closed', { n: 2, d: 1 }], [RLATE, 'closed', { n: 2, d: 2 }], [R1, 'done', { n: 2, d: 2 }]], 'החדש קודם (לפי doneAt, גם באיחור ארוך); בלי ישן, מבוטל, או סבב של עובד אחר');
    assert.deepEqual(l.result.runs, [], 'runs – רק פתוחים, כמו קודם');
    assert.ok(!JSON.stringify(l.result.past).includes(E2), 'בלי מזהה של עובד אחר');
    const v = (await call('s3View', E1, { runId: R1 })).result.run;
    assert.deepEqual(Object.keys(v.ai), ['f1-a-1_a'], 'בסבב סגור – רק התוצאות שלו');
    assert.ok(!JSON.stringify(v).includes('חור של E2') && !JSON.stringify(v).includes(E2));
    assert.equal((await call('s3View', E1, { runId: RE2 })).reason, 'not-assigned', 'סבב סגור של עובד אחר');
    assert.deepEqual((await call('s3View', E2, {})).result.past.map((x) => x.runId), [RE2, R1]);
    assert.deepEqual((await call('s3View', SUB, {})).result.past, []);
    assert.equal((await call('s3View', EB, {})).reason, 'feature-off');
    assert.equal((await call('s3View', MGR, {})).result.past, undefined, 'מנהל – בלי שינוי (קורא ישירות)');
  });
});
