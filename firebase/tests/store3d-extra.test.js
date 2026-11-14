'use strict';
// סריקת חנות בתלת מימד – שלב 10 (14.11.2026): השרת הנלווה, באמולטור. חלק מ-test:multibiz. Gemini = gemini-mock.js בלבד (בלי פנייה החוצה).
//   1. הליבה מול Firestore ו-Storage של האמולטור: ציון לפי משקלות וסיכום סבב, "לבדיקה" לא מוריד, משימות תיקון וחוסרים, ערעור
//      (ovr, הערה קבועה, ציון מחדש, ביטול משימה – אידמפוטנטי), s3Fix, צילום אימות, no-answer נספר / gemini-error מוחזר,
//      qid חוזר של הצילום ה-99 = dup, ניקוי יומי (סל מחזור 30 יום, 3 סבבים אחרונים, טקסטורות יתומות, טיוטות, s3qid, audit),
//      ביצועי עובדים כולל עובד שעזב.
//   2. הפונקציות דרך אמולטור הפונקציות: s3Fix – רק מנהל; עסק כבוי; shelfCheck verify – רק העובד של המשימה.
process.env.SCAN_RETRY_WAIT_MS = process.env.SCAN_RETRY_WAIT_MS || '10';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-s3x', B = 'biz-s3y';
const MGR = 's3_mgrx1', E1 = 's3_empx1', E2 = 's3_empx2', EB = 's3_empy1';
const FEAT = { scan: true, tasks: true, store3d: true };
const FN = path.join(__dirname, '..', 'functions');
const RUN = 'r8k2m4q1_20261115', RUN1 = 'r9x7w5v3_20261115';
const D1 = 86400000;
const fx = (id, o) => Object.assign({ id, k: 'gon', x: 300, y: 300, w: 200, d: 60, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }, o);
const MAP = (o) => Object.assign({ br: 'main', kind: 's', name: 'החנות', v: 3, seq: 3, grid: 50, numDir: 'rtl', src: 'manual', upd: 1, by: MGR,
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1000, 0, 1000, 1000, 0, 1000], h: 300 }], walls: [], cols: [], doors: [], syms: [],
  fx: [fx('f1', { sides: 2 }), fx('f2', { hi: true, lvl: 7, x: 600 })] }, o);
function jpeg(w, h, pad) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(pad || 0), Buffer.from([0xff, 0xd9])]);
}
const IMG = jpeg(1200, 900, 3000).toString('base64'), TH = jpeg(512, 384, 800).toString('base64');
let qn = 0;
const qid = () => 'x' + Date.now().toString(36) + '-' + (qn++).toString().padStart(12, '0');
const photo = (o) => Object.assign({ qid: qid(), mode: 'run', run: RUN, slot: 'f1-a-1_a', at: Date.now() - 1000, src: 'photo', rt: 0, img: IMG, th: TH }, o);
const HOLE = { st: 'issue', conf: 0.8, iss: [{ k: 'hole', sev: 2, conf: 0.9, t: 'חור בשורה העליונה', warn: false }, { k: 'noprice', sev: 3, conf: 0.9, t: 'אין מחיר', warn: false }],
  miss: [{ n: 'כוסות 200 מ"ל', why: 'prev' }], cat: 'כוסות', prods: [] };

let env, adm;
const get = async (p) => { const s = await adm.doc(p).get(); return s.exists ? s.data() : null; };
const ids = async (p) => (await adm.collection(p).get()).docs.map((d) => d.id).sort();
const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date());

async function seed() {
  await env.clearFirestore();
  const now = Date.now();
  const b = adm.batch();
  b.set(adm.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: FEAT });
  b.set(adm.doc('b/' + B), { name: 'ב', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: Object.assign({}, FEAT, { store3d: false }) });
  b.set(adm.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
  for (const [u, role] of [[MGR, 'manager'], [E1, 'employee'], [E2, 'employee']]) {
    b.set(adm.doc(`b/${A}/staff/${u}`), { name: u, role, active: true, pushTokens: ['tok_' + u + '_0123456789abcdef'] });
    b.set(adm.doc('users/' + u), { bizId: A, role: role === 'manager' ? 'admin' : 'worker', active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
  }
  b.set(adm.doc(`b/${B}/staff/${EB}`), { name: EB, role: 'manager', active: true });
  b.set(adm.doc(`b/${B}/admins/${EB}`), { email: EB + '@example.invalid' });
  b.set(adm.doc('users/' + EB), { bizId: B, role: 'admin', active: true, bizStatus: 'active', email: EB + '@example.invalid', createdAt: 1 });
  b.set(adm.doc(`b/${A}/smap/s-main`), MAP());
  b.set(adm.doc(`b/${A}/s3set/main`), { w: { p: 25, h: 25, o: 25, d: 25 }, due: 3, recN: 2, upd: 1, by: MGR });
  const run = { rid: 'r8k2m4q1', br: 'main', map: 's-main', mapV: 3, k: 'sched', st: 'open', uids: [E1, E2], n: 8, nDone: 0,
    asg: { [E1]: ['f1-a-1', 'f1-a-2', 'f1-b-1', 'f1-b-2'], [E2]: ['f2-a-1', 'f2-a-2'] }, nUid: { [E1]: { n: 4, d: 0 }, [E2]: { n: 4, d: 0 } },
    openAt: now - 3600000, dueAt: now + D1, tlog: { [E1]: [], [E2]: [] } };
  b.set(adm.doc(`b/${A}/srun/${RUN}`), run);
  b.set(adm.doc(`b/${A}/srun/${RUN1}`), Object.assign({}, run, { rid: 'r9x7w5v3', uids: [E1], n: 1, asg: { [E1]: ['f1-a-1'] }, nUid: { [E1]: { n: 1, d: 0 } }, tlog: { [E1]: [] } }));
  await b.commit();
}

describe('שלב 10 – הליבה מול האמולטור (Firestore + Storage + gemini-mock)', () => {
  let AI, XX, T, db, bucket, sent;
  const send = async (tokens, msg) => { sent.push({ tokens, kind: msg.kind }); return tokens.map((t) => ({ token: t, ok: true })); };
  const deps = (o) => Object.assign({ base: 'http://127.0.0.1:' + GM.PORT, key: 'test-key', bucket, send, userMax: 400 }, o);
  const W = (uid, o) => Object.assign({ uid, mgr: uid === MGR, bizId: A, brs: null }, o);
  const shelf = (uid, input, o) => AI.shelfCore(db, W(uid), input, Date.now(), deps(o));
  const err = async (p) => { try { await p; } catch (e) { return (e.details && e.details.reason) || e.code || e.message; } return 'OK'; };
  const files = async (sub) => (await bucket.getFiles({ prefix: `b/${A}/store3d/${sub || ''}` }))[0].map((f) => f.name).sort();
  const use = async () => ((await get(`b/${A}/s3use/b_main`)) || { n: 0 }).n;
  const inBiz = (fn) => T.runInBiz({ bizId: A, prefix: `b/${A}/` }, fn);
  const appeal = async (run, slot, ik, o) => {
    const aid = `${run}__${slot}__${ik}`;
    const d = Object.assign({ run, slot, ik, by: E1, at: Date.now() - 5000, txt: 'זה לא נפל, זו תצוגה', st: 'acc', dec: 'המגשים על הרצפה הם תצוגה קבועה', decBy: MGR, decAt: Date.now() - 1000, note: true }, o);
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    await adm.doc(`b/${A}/s3appeal/${aid}`).set(d);
    return aid;
  };
  const appeals = (o) => XX.appealsBiz(Object.assign({ db, now: Date.now(), send }, o));

  before(async () => {
    env = await H.getEnv();
    await GM.start();
    AI = require(path.join(FN, 'store3d-ai.js'))._ai;
    XX = require(path.join(FN, 'store3d-extra.js'))._x;
    T = require(path.join(FN, 'lib', 'tenant.js'));
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
    db = T.prefixed(adm, `b/${A}/`);
    bucket = require(require.resolve('firebase-admin/storage', { paths: [FN] })).getStorage().bucket(H.PROJECT_ID + '.appspot.com');
  });
  after(async () => { await GM.stop(); });
  beforeEach(async () => {
    sent = []; GM.reset(); await seed();
    for (const f of (await bucket.getFiles({ prefix: `b/${A}/store3d/` }))[0]) await f.delete();
  });

  it('ציון לפי משקלות הסניף (25/25/25/25) ב-ai.sc; סיום סבב: sum, s3sum.score, משימת תיקון אוטומטית + התראה, השוואה לסבב קודם', async () => {
    await shelf(E1, photo({ run: RUN1 }));
    const ai = await get(`b/${A}/srun/${RUN1}/ai/f1-a-1_a`);
    assert.deepEqual(ai.sc, { p: 100, h: 100, o: 55, d: 50, all: 76 }, 'fallen 3 (−50), face 2 (−30), order 1 (−15)');
    const run = await get(`b/${A}/srun/${RUN1}`);
    assert.equal(run.st, 'done');
    assert.deepEqual([run.sum.score, run.sum.nIss, run.sum.nMiss, run.sum.cat, run.sum.prev], [76, 1, 0, { p: 100, h: 100, o: 55, d: 50 }, '']);
    assert.equal((await get(`b/${A}/s3sum/s-main`)).score, 76);
    const f = await get(`b/${A}/s3fix/${RUN1}__f1-a-1_a`);
    assert.deepEqual([f.st, f.u, f.by, f.iks, f.dueAt - f.at, f.map, f.br], ['open', E1, 'ai', [0, 1, 2], 3 * D1, 's-main', 'main']);
    assert.ok(await get(`b/${A}/s3ntf/${RUN1}_fix_${E1}`));
    assert.deepEqual(sent.map((s) => s.kind).sort(), ['done', 'fix']);
    assert.equal(await get(`b/${A}/s3short/${RUN1}`), null, 'אין חוסרים בתשובה');
    // ריצה חוזרת של הסיום – בלי כפילות
    await XX.finishRun(db, RUN1, Date.now(), { send });
    assert.deepEqual([(await ids(`b/${A}/s3fix`)).length, sent.length], [1, 2]);
    // סבב שני של אותה מפה – השוואה לקודם
    const R2 = 'r9x7w5v3_20261122';
    await adm.doc(`b/${A}/srun/${R2}`).set(Object.assign(run, { st: 'open', nDone: 0, nUid: { [E1]: { n: 1, d: 0 } }, openAt: Date.now() + 5, dueAt: Date.now() + D1, sum: null, doneAt: null }));
    GM.state.shelf = 'shelf-clean';
    await shelf(E1, photo({ run: R2 }));
    const s2 = (await get(`b/${A}/srun/${R2}`)).sum;
    assert.deepEqual([s2.score, s2.prev, s2.dScore], [100, RUN1, 24]);
  });

  it('"לבדיקה" (AI לא בטוח) לא מוריד ציון ולא פותח משימת תיקון; חוסרים נכתבים ל-s3short', async () => {
    GM.state.shelf = { st: 'review', conf: 0.5, iss: [{ k: 'noprice', sev: 3, conf: 0.4, t: 'אולי אין מחיר', warn: false }] };
    await shelf(E1, photo({ run: RUN1 }));
    const ai = await get(`b/${A}/srun/${RUN1}/ai/f1-a-1_a`);
    assert.deepEqual([ai.st, ai.sc.all, (await get(`b/${A}/srun/${RUN1}`)).sum.score], ['review', 100, 100]);
    assert.deepEqual(await ids(`b/${A}/s3fix`), []);
    await seed();
    GM.state.shelf = HOLE;
    await shelf(E1, photo({ run: RUN1 }));
    const sh = await get(`b/${A}/s3short/${RUN1}`);
    assert.deepEqual([sh.st, sh.items.map((i) => [i.n, i.why, i.bay])], ['draft', [['כוסות 200 מ"ל', 'miss', 'f1-a-1'], ['חור בשורה העליונה', 'hole', 'f1-a-1']]]);
  });

  it('ערעור שהתקבל: ai.ovr, ציון מחדש, הערה קבועה (src appeal), סיכום ו-s3sum מחדש, המשימה מתעדכנת ואז מבוטלת; ריצה חוזרת לא משנה; ערעור פתוח – לא נוגעים', async () => {
    await shelf(E1, photo({ run: RUN1 }));
    await appeal(RUN1, 'f1-a-1_a', '0', { st: 'open', decBy: undefined, decAt: Date.now() });
    assert.equal(await appeals(), 0, 'פתוח – לא מטופל');
    await appeal(RUN1, 'f1-a-1_a', '0');
    assert.equal(await appeals(), 1);
    let ai = await get(`b/${A}/srun/${RUN1}/ai/f1-a-1_a`);
    assert.deepEqual([ai.ovr, ai.sc.d, ai.sc.all], [{ 0: 'acc' }, 100, 89]);
    const bay = await get(`b/${A}/smap/s-main/bay/f1-a-1`);
    assert.deepEqual(bay.notes.map((n) => [n.t, n.src, n.by]), [['המגשים על הרצפה הם תצוגה קבועה', 'appeal', MGR]]);
    assert.deepEqual([(await get(`b/${A}/srun/${RUN1}`)).sum.score, (await get(`b/${A}/s3sum/s-main`)).score, (await get(`b/${A}/s3sum/s-main`)).b['f1-a-1'].n], [89, 89, 2]);
    assert.deepEqual((await get(`b/${A}/s3fix/${RUN1}__f1-a-1_a`)).iks, [1, 2]);
    assert.equal(await appeals(), 0, 'כבר טופל');
    assert.equal((await get(`b/${A}/smap/s-main/bay/f1-a-1`)).notes.length, 1, 'בלי הערה כפולה');
    await appeal(RUN1, 'f1-a-1_a', 'all', { note: false });
    assert.equal(await appeals(), 1);
    ai = await get(`b/${A}/srun/${RUN1}/ai/f1-a-1_a`);
    assert.equal(ai.sc.all, 100);
    const f = await get(`b/${A}/s3fix/${RUN1}__f1-a-1_a`);
    assert.deepEqual([f.st, f.cBy], ['cancel', MGR]);
    assert.deepEqual([(await get(`b/${A}/s3sum/s-main`)).b['f1-a-1'].s, (await get(`b/${A}/srun/${RUN1}`)).sum.nOk], ['ok', 1]);
    assert.equal((await get(`b/${A}/smap/s-main/bay/f1-a-1`)).notes.length, 1, 'note:false – בלי הערה');
  });

  it('תיקון סבב 1: כשל באמצע ההשלמה של ערעור – לא מסומן כמטופל, והריצה הבאה משלימה (ציון, s3sum, חוסרים, משימה); אחר כך מסומן sv', async () => {
    GM.state.shelf = HOLE;
    await shelf(E1, photo({ run: RUN1 }));
    const run0 = await get(`b/${A}/srun/${RUN1}`);
    assert.deepEqual([run0.sum.score, (await get(`b/${A}/s3short/${RUN1}`)).items.map((i) => i.why)], [80, ['miss', 'hole']]);
    const aid = await appeal(RUN1, 'f1-a-1_a', '0', { note: false });
    let fail = true;
    const inject = async () => { if (fail) throw new Error('simulated failure'); };
    assert.equal(await appeals({ inject }), 0, 'נכשל באמצע');
    assert.deepEqual((await get(`b/${A}/srun/${RUN1}/ai/f1-a-1_a`)).ovr, { 0: 'acc' }, 'הטרנזקציה הראשונה נכתבה');
    assert.equal((await get(`b/${A}/srun/${RUN1}`)).sum.score, 80, 'הסיכום עוד לא עודכן');
    assert.equal((await get(`b/${A}/s3appeal/${aid}`)).sv, undefined, 'לא מסומן כמטופל');
    fail = false;
    assert.equal(await appeals({ inject }), 1, 'הריצה הבאה משלימה');
    assert.equal((await get(`b/${A}/srun/${RUN1}`)).sum.score, 88, 'בלי hole: p50 h100 o100 d100 → 87.5 → 88');
    assert.deepEqual((await get(`b/${A}/s3short/${RUN1}`)).items.map((i) => i.why), ['miss'], 's3short מתעדכן אחרי ערעור (עוד draft)');
    assert.deepEqual([(await get(`b/${A}/s3sum/s-main`)).score, (await get(`b/${A}/s3sum/s-main`)).b['f1-a-1'].n], [88, 1]);
    assert.deepEqual((await get(`b/${A}/s3fix/${RUN1}__f1-a-1_a`)).iks, [1]);
    assert.equal(typeof (await get(`b/${A}/s3appeal/${aid}`)).sv, 'number', 'מסומן כמטופל רק עכשיו');
    assert.equal(await appeals(), 0);
    // אחרי שהמנהל אישר את רשימת החוסרים – ערעור נוסף לא משנה אותה
    await adm.doc(`b/${A}/s3short/${RUN1}`).update({ st: 'ok', okBy: MGR, okAt: Date.now() });
    await appeal(RUN1, 'f1-a-1_a', 'all', { note: false });
    assert.equal(await appeals(), 1);
    assert.deepEqual((await get(`b/${A}/s3short/${RUN1}`)).items.map((i) => i.why), ['miss']);
  });

  it('s3Fix: משימה ידנית m_<qid> + התראה; qid חוזר = dup; עובד לא פעיל / מקום לא קיים נדחים; הכרעה רק ב-sent; ביטול', async () => {
    const q = qid();
    const inp = { qid: q, map: 's-main', slot: 'f1-a-2_a', u: E1, man: 'לסדר את הכוסות לפי גודל' };
    const r = await XX.fixCore(db, { uid: MGR, bizId: A }, inp, Date.now(), { send });
    assert.deepEqual([r.ok, r.fixTaskId, r.st], [true, 'm_' + q, 'open']);
    const f = await get(`b/${A}/s3fix/m_${q}`);
    assert.deepEqual([f.iks, f.man, f.by, f.u, f.dueAt - f.at, f.run], [[], inp.man, MGR, E1, 3 * D1, undefined]);
    assert.deepEqual(sent.map((s) => s.kind), ['fix']);
    assert.equal((await XX.fixCore(db, { uid: MGR, bizId: A }, inp, Date.now(), { send })).dup, true);
    assert.equal(sent.length, 1);
    assert.equal(await err(XX.fixCore(db, { uid: MGR, bizId: A }, Object.assign({}, inp, { u: E2 }), Date.now(), { send })), 'bad-qid');
    await adm.doc(`b/${A}/staff/${E2}`).update({ active: false });
    assert.equal(await err(XX.fixCore(db, { uid: MGR, bizId: A }, Object.assign({}, inp, { qid: qid(), u: E2 }), Date.now(), { send })), 'staff-disabled');
    assert.equal(await err(XX.fixCore(db, { uid: MGR, bizId: A }, Object.assign({}, inp, { qid: qid(), slot: 'f9-a-1_a' }), Date.now(), { send })), 'bad-slot');
    assert.equal(await err(XX.fixCore(db, { uid: MGR, bizId: A }, Object.assign({}, inp, { qid: qid(), man: '' }), Date.now(), { send })), 'bad-man');
    // תיקון סבב 1: עובד ששויך לסניף אחר – המשימה הולכת למנהל
    await adm.doc(`b/${A}/staff/${E1}`).update({ br: ['other'] });
    const q2 = qid();
    const r2 = await XX.fixCore(db, { uid: MGR, bizId: A }, Object.assign({}, inp, { qid: q2 }), Date.now(), { send });
    assert.deepEqual([r2.u, r2.toMgr, (await get(`b/${A}/s3fix/m_${q2}`)).u], [MGR, true, MGR]);
    assert.equal((await XX.fixCore(db, { uid: MGR, bizId: A }, Object.assign({}, inp, { qid: q2 }), Date.now(), { send })).dup, true, 'qid חוזר – dup');
    await adm.doc(`b/${A}/staff/${E1}`).update({ br: ['main'] });
    assert.equal((await XX.fixCore(db, { uid: MGR, bizId: A }, Object.assign({}, inp, { qid: qid() }), Date.now(), { send })).u, E1, 'משויך לסניף – אצלו');
    assert.equal(await err(XX.fixCore(db, { uid: MGR, bizId: A }, { fixTaskId: 'm_' + q, decide: 'ok' }, Date.now(), {})), 'fix-not-sent');
    assert.equal((await XX.fixCore(db, { uid: MGR, bizId: A }, { fixTaskId: 'm_' + q, cancel: true }, Date.now(), {})).st, 'cancel');
    assert.deepEqual([(await get(`b/${A}/s3fix/m_${q}`)).cBy, await err(XX.fixCore(db, { uid: MGR, bizId: A }, { fixTaskId: 'm_' + q, cancel: true }, Date.now(), {}))], [MGR, 'fix-closed']);
  });

  it('צילום אימות (verify): רק העובד של המשימה; נספר במכסה; עדיין יש בעיה – rej; תוקן – ok, קובץ ב-fix/; אדם – לא נשמר; משימה ידנית – sent ואז הכרעת מנהל', async () => {
    await shelf(E1, photo({ run: RUN1 }));
    const FX = `${RUN1}__f1-a-1_a`;
    const v = (uid, o) => shelf(uid, photo(Object.assign({ mode: 'verify', run: undefined, fix: FX }, o)));
    assert.equal(await err(v(E2)), 'not-assigned');
    assert.equal(await err(v(E1, { slot: 'f1-a-2_a' })), 'bad-slot');
    const n0 = await use();
    let r = await v(E1);
    assert.deepEqual([r.fixSt, r.st, await use()], ['rej', 'issue', n0 + 1]);
    assert.equal((await get(`b/${A}/s3fix/${FX}`)).st, 'rej');
    GM.state.shelf = { st: 'person' };
    r = await v(E1);
    assert.deepEqual([r.st, r.fixSt], ['person', 'rej']);
    const vp1 = (await get(`b/${A}/s3fix/${FX}`)).vp;
    GM.state.shelf = 'shelf-clean';
    r = await v(E1);
    const f = await get(`b/${A}/s3fix/${FX}`);
    assert.deepEqual([r.fixSt, f.st, f.vst, typeof f.doneAt], ['ok', 'ok', 'ok', 'number']);
    assert.match(f.vp, new RegExp(`^b/${A}/store3d/main/fix/${FX}_[0-9]+\\.jpg$`));
    assert.deepEqual(await files('main/fix/'), [f.vp, f.vth].sort(), 'צילום האימות הקודם נמחק');
    assert.notEqual(f.vp, vp1);
    assert.equal(await err(v(E1)), 'fix-closed');
    const q = qid();
    await XX.fixCore(db, { uid: MGR, bizId: A }, { qid: q, map: 's-main', slot: 'f1-a-2_a', u: E1, man: 'לנקות' }, Date.now(), { send });
    r = await shelf(E1, photo({ mode: 'verify', run: undefined, fix: 'm_' + q, slot: 'f1-a-2_a' }));
    assert.equal(r.fixSt, 'sent');
    assert.equal((await XX.fixCore(db, { uid: MGR, bizId: A }, { fixTaskId: 'm_' + q, decide: 'ok' }, Date.now(), {})).st, 'ok');
  });

  it('החלטת המשתמש "ענה = נספר": no-answer (200 בלי תוכן) נספר; gemini-error (400) ו-429 מוחזרים; qid חוזר של הצילום ה-99 = dup', async () => {
    GM.state.mode = 'noanswer';
    assert.equal(await err(shelf(E1, photo())), 'no-answer');
    assert.equal(await use(), 1, 'Gemini ענה בלי תוכן – נספר');
    GM.state.mode = 'badreq';
    assert.equal(await err(shelf(E1, photo())), 'gemini-error');
    assert.equal(await use(), 1, 'gemini-error – מוחזר');
    GM.state.mode = 'noanswer';
    assert.equal(await err(AI.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: [IMG, IMG] }, Date.now(), deps())), 'no-answer');
    assert.equal(await use(), 3, 'טיוטה: 2 תמונות נספרות');
    GM.reset();
    const dir = `b/${A}/store3d/main/run/${RUN}/`;
    for (let i = 1; i <= 98; i++) await bucket.file(`${dir}f1-a-1_a_${i}.jpg`).save(Buffer.from('x'), { resumable: false });
    const inp = photo();
    assert.equal((await shelf(E1, inp)).st, 'issue');
    assert.ok((await files(`main/run/${RUN}/`)).includes(dir + 'f1-a-1_a_99.jpg'));
    const d = await shelf(E1, inp);
    assert.deepEqual([d.dup, d.st], [true, 'issue'], 'הצילום ה-99 הצליח – qid חוזר מקבל dup ולא too-many');
    assert.equal(await err(shelf(E1, photo())), 'too-many', 'qid חדש – too-many');
  });

  it('ניקוי יומי (s3Clean): סל מחזור רק אחרי 30 יום (עם גרסה ויומן), כללי סבב, 3 סבבים אחרונים לכל מקום, טקסטורות יתומות, טיוטות, s3qid', async () => {
    const NOW = Date.now() + 40 * D1; // "עוד 40 יום": כל הקבצים שנוצרו עכשיו נחשבים ישנים
    await adm.doc(`b/${A}/smap/s-main`).set(MAP({
      fx: [fx('f1', { sides: 2 }), fx('f2', { hi: true, lvl: 7, x: 600 }), fx('f3', { x: 800, del: 1, delAt: NOW - 31 * D1, delBy: MGR }), fx('f4', { x: 900, del: 1, delAt: NOW - 29 * D1, delBy: MGR })],
      tx: [{ id: 't1', path: `b/${A}/store3d/main/tex/s-main/t1_1.jpg`, w: 512, h: 512 }],
    }));
    await adm.doc(`b/${A}/smap/s-main/ver/000002`).set({ m: { tx: [{ id: 't8', path: `b/${A}/store3d/main/tex/s-main/t8_1.jpg`, w: 512, h: 512 }] }, v: 2, at: NOW - 10 * D1, by: MGR });
    await adm.doc(`b/${A}/smap/s-main/ver/000001`).set({ m: { tx: [{ id: 't7', path: `b/${A}/store3d/main/tex/s-main/t7_1.jpg`, w: 512, h: 512 }] }, v: 1, at: NOW - 31 * D1, by: MGR });
    await adm.doc(`b/${A}/smap/w-main`).set(MAP({ kind: 'w', name: 'מחסן' }));
    await adm.doc(`b/${A}/sround/oldrule1`).set({ br: 'main', map: 's-main', name: 'ישן', on: false, del: 1, delAt: NOW - 31 * D1, delBy: MGR, upd: 1, by: MGR });
    await adm.doc(`b/${A}/sround/newrule1`).set({ br: 'main', map: 's-main', name: 'חדש', on: false, del: 1, delAt: NOW - 29 * D1, delBy: MGR, upd: 1, by: MGR });
    await adm.doc(`b/${A}/sround/liverule`).set({ br: 'main', map: 's-main', name: 'חי', on: true, upd: 1, by: MGR });
    await adm.doc(`b/${A}/s3draft/oldxdraftxxxxxxxxx1`).set({ br: 'main', kind: 's', by: MGR, at: NOW - 31 * D1, st: 'ok', n: 1 });
    await adm.doc(`b/${A}/s3draft/newxdraftxxxxxxxxx1`).set({ br: 'main', kind: 's', by: MGR, at: NOW - 2 * D1, st: 'ok', n: 1 });
    await adm.doc(`b/${A}/s3qid/oldxqidxxxxxxxxxxx1`).set({ k: 'photo', uid: E1, at: 1, exp: NOW - 1 });
    await adm.doc(`b/${A}/s3qid/newxqidxxxxxxxxxxx1`).set({ k: 'photo', uid: E1, at: 1, exp: NOW + D1 });
    // 5 סבבים לאותו מקום צילום, לפי הסדר; ph של כל סבב מצביע על הקבצים שלו
    const runs = ['r8k2m4q1_20261001', 'r8k2m4q1_20261008', 'r8k2m4q1_20261015', 'r8k2m4q1_20261022', 'r8k2m4q1_20261029'];
    for (const r of runs) {
      const p = `b/${A}/store3d/main/run/${r}/f1-a-1_a_1.jpg`, t = p.replace('.jpg', '_t.jpg');
      await bucket.file(p).save(Buffer.from('x'), { resumable: false });
      await bucket.file(t).save(Buffer.from('x'), { resumable: false });
      await adm.doc(`b/${A}/srun/${r}`).set({ br: 'main', map: 's-main', k: 'sched', st: 'done', n: 1, nDone: 1, openAt: 1, dueAt: 2, doneAt: 2 });
      await adm.doc(`b/${A}/srun/${r}/ph/f1-a-1_a`).set({ p, th: t, w: 1200, h: 900, sz: 4000, tsz: 900, src: 'photo', by: E1, at: 1, rx: 1, qid: 'q', rt: 0 });
      await new Promise((ok) => setTimeout(ok, 15));
    }
    // תיקון סבב 1: 3 סבבי מחסן חדשים יותר ודיווח יזום – באותו מקום צילום ובאותה תיקיית run/; לא דוחקים את סבבי החנות
    const wruns = ['w7w7w7w7_20261101', 'w7w7w7w7_20261108', 'w7w7w7w7_20261115', 'ad_adhocadhocadhoc01'];
    for (const r of wruns) {
      const p = `b/${A}/store3d/main/run/${r}/f1-a-1_a_1.jpg`;
      await bucket.file(p).save(Buffer.from('x'), { resumable: false });
      await bucket.file(p.replace('.jpg', '_t.jpg')).save(Buffer.from('x'), { resumable: false });
      await adm.doc(`b/${A}/srun/${r}`).set({ br: 'main', map: r.startsWith('ad_') ? 's-main' : 'w-main', k: r.startsWith('ad_') ? 'adhoc' : 'sched', st: 'done', n: 1, nDone: 1, openAt: 1, dueAt: 2, doneAt: 2 });
      await adm.doc(`b/${A}/srun/${r}/ph/f1-a-1_a`).set({ p, th: p.replace('.jpg', '_t.jpg'), w: 1200, h: 900, sz: 4000, tsz: 900, src: 'photo', by: E1, at: 1, rx: 1, qid: 'q', rt: 0 });
      await new Promise((ok) => setTimeout(ok, 15));
    }
    await adm.doc(`b/${A}/srun/${runs[0]}/ai/f1-a-1_a`).set({ st: 'ok', conf: 1, iss: [], model: 'm', at: 1, ver: 1 });
    await adm.doc(`b/${A}/s3sum/s-main`).set({ b: { 'f1-a-1': { s: 'ok', r: runs[0], t: 1, n: 0, th: `b/${A}/store3d/main/run/${runs[0]}/f1-a-1_a_1_t.jpg` } }, upd: 1 });
    // קובץ תועה בסבב שנשמר
    await bucket.file(`b/${A}/store3d/main/run/${runs[4]}/f1-a-1_a_2.jpg`).save(Buffer.from('x'), { resumable: false });
    for (const t of ['t1', 't7', 't8', 't9']) await bucket.file(`b/${A}/store3d/main/tex/s-main/${t}_1.jpg`).save(Buffer.from('x'), { resumable: false });

    const out = await inBiz(() => XX.cleanBiz({ bizId: A, now: NOW, bucket, send }));
    assert.ok(Object.values(out).every((v) => v !== -1), JSON.stringify(out));
    const m = await get(`b/${A}/smap/s-main`);
    assert.deepEqual([m.fx.map((f) => f.id), m.v, m.seq], [['f1', 'f2', 'f4'], 4, 3], 'f3 (31 יום) נמחק סופית; f4 (29 יום) נשאר; seq לא יורד');
    const ver = await get(`b/${A}/smap/s-main/ver/000003`);
    assert.deepEqual([ver.by, ver.m.fx.length, ver.why], ['system', 4, 'ניקוי סל המחזור (30 יום)']);
    assert.deepEqual(await ids(`b/${A}/sround`), ['liverule', 'newrule1']);
    assert.deepEqual(await ids(`b/${A}/s3draft`), ['newxdraftxxxxxxxxx1']);
    assert.deepEqual(await ids(`b/${A}/s3qid`), ['newxqidxxxxxxxxxxx1']);
    const left = await files('main/run/');
    assert.deepEqual(left.map((f) => f.split('/run/')[1]), runs.slice(2).concat(wruns).sort().flatMap((r) => [`${r}/f1-a-1_a_1.jpg`, `${r}/f1-a-1_a_1_t.jpg`]),
      '3 הסבבים האחרונים של החנות נשארו, וגם המחסן והדיווח היזום; התועה נמחק');
    const ph0 = await get(`b/${A}/srun/${runs[0]}/ph/f1-a-1_a`), ph4 = await get(`b/${A}/srun/${runs[4]}/ph/f1-a-1_a`);
    assert.deepEqual([ph0.gone, ph0.p, ph0.th, ph0.w], [true, undefined, undefined, 1200], 'הטקסט נשאר, בלי נתיב');
    assert.deepEqual([ph4.gone, typeof ph4.p], [undefined, 'string']);
    assert.ok(await get(`b/${A}/srun/${runs[0]}/ai/f1-a-1_a`), 'תוצאת הטקסט נשמרת תמיד');
    assert.equal((await get(`b/${A}/s3sum/s-main`)).b['f1-a-1'].th, undefined, 's3sum לא מצביע על מוקטנת שנמחקה');
    assert.deepEqual((await files('main/tex/')).map((f) => f.split('/tex/')[1]), ['s-main/t1_1.jpg', 's-main/t8_1.jpg'], 't9 יתומה ו-t7 (בגרסה שהוחלפה לפני 31 יום) נמחקו; t1 במפה, t8 בגרסה מלפני 10 ימים');
    const audit = (await adm.collection(`b/${A}/audit`).where('act', '==', 's3Clean').get()).docs.map((d) => d.data());
    assert.deepEqual([audit.length, audit[0].part, audit[0].parts], [1, 1, 1]);
    assert.match(audit[0].note, /tex s-main\/t7_1\.jpg/);
    assert.match(audit[0].note, /smap\/s-main: fx f3/);
    assert.match(audit[0].note, /sround\/oldrule1/);
    // ריצה שנייה – אין עוד מה למחוק, בלי רשומת audit נוספת
    await inBiz(() => XX.cleanBiz({ bizId: A, now: NOW, bucket, send }));
    assert.equal((await get(`b/${A}/smap/s-main`)).v, 4);
    assert.equal((await adm.collection(`b/${A}/audit`).where('act', '==', 's3Clean').get()).size, 1);
  });

  it('ביצועי עובדים (s3perf) – מחושבים מחדש בכל ריצה; עובד שעזב נשאר; בלי כפילות בריצה חוזרת; סבב שהסתיים בלי sum – מסוכם (רשת ביטחון)', async () => {
    const now = Date.now();
    await adm.doc(`b/${A}/srun/${RUN}`).update({ st: 'done', doneAt: now - 1000, dueAt: now + D1, tlog: { [E1]: [{ k: 's', t: now - 5000 }, { k: 'p', t: now - 4000 }, { k: 'r', t: now - 3000 }, { k: 'e', t: now - 2000 }], [E2]: [] }, work: { [E1]: 30 }, pause: { [E1]: 2 } });
    await adm.doc(`b/${A}/srun/${RUN}/ph/f1-a-1_a`).set({ by: E1, rt: 2, w: 1, h: 1, sz: 1, tsz: 1, src: 'photo', at: 1, rx: 1, qid: 'q' });
    await adm.doc(`b/${A}/srun/${RUN}/ph/f2-a-1_t`).set({ by: E2, rt: 0, w: 1, h: 1, sz: 1, tsz: 1, src: 'photo', at: 1, rx: 1, qid: 'q' });
    await adm.doc(`b/${A}/s3fix/m_fixfixfixfixfix01`).set({ slot: 'f1-a-1_a', map: 's-main', br: 'main', iks: [], man: 'x', by: MGR, u: E2, st: 'ok', at: now - 9000, dueAt: now + D1, doneAt: now - 500 });
    await adm.doc(`b/${A}/staff/${E2}`).update({ active: false }); // עזב
    await inBiz(() => XX.cleanBiz({ bizId: A, now, bucket, send }));
    await inBiz(() => XX.cleanBiz({ bizId: A, now, bucket, send }));
    const p1 = await get(`b/${A}/s3perf/${E1}/m/${month()}`), p2 = await get(`b/${A}/s3perf/${E2}/m/${month()}`);
    assert.deepEqual([p1.runs, p1.onTime, p1.work, p1.pause, p1.pauses, p1.photos, p1.retakes], [1, 1, 30, 2, 1, 1, 2]);
    assert.deepEqual([p2.runs, p2.photos, p2.fixOk], [1, 1, 1], 'עובד שעזב – ההיסטוריה נשארת ומחושבת');
    assert.equal(typeof (await get(`b/${A}/srun/${RUN}`)).sum.score, 'number', 'רשת ביטחון: הסבב סוכם');
    assert.ok(await get(`b/${A}/staff/${E2}`), 'שום דבר של העובד לא נמחק');
  });

  it('שלב 13ב – סיכום למזכירה (secBrief): מנהל – כל הסניפים; מנהל עם הגבלת סניפים – רק שלו; עובד / תוספת כבויה / עסק אחר – כלום', async () => {
    const now = Date.now();
    const sum = (score, o) => Object.assign({ score, nOk: 5, nIss: 3, nRev: 1, nMiss: 0, nBad: 0, cat: { p: 55, h: 90, o: 80, d: 100 }, prev: '', dScore: 0 }, o);
    const R2 = 'r1a2b3c4_20261101', ROLD = 'r8k2m4q1_20261101', ROTH = 'r5t6y7u8_20261110';
    await adm.doc(`b/${A}/srun/${R2}`).set({ br: 'main', map: 's-main', st: 'done', k: 'sched', uids: [E1], doneAt: now - 2 * D1, sum: sum(78, { prev: ROLD, dScore: -6 }) });
    await adm.doc(`b/${A}/srun/${ROLD}`).set({ br: 'main', map: 's-main', st: 'closed', k: 'sched', uids: [E1], doneAt: now - 9 * D1, sum: sum(84) });
    await adm.doc(`b/${A}/srun/${ROTH}`).set({ br: 'north', map: 's-north', st: 'done', k: 'sched', uids: [E2], doneAt: now - D1, sum: sum(91, { cat: { p: 95, h: 95, o: 95, d: 95 } }) });
    await adm.doc(`b/${A}/srun/ad_${'q'.repeat(20)}`).set({ br: 'main', map: 's-main', st: 'done', k: 'adhoc', uids: [E1], doneAt: now - 1000, sum: sum(11) });
    await adm.doc(`b/${A}/s3short/${R2}`).set({ items: [{ n: 'במבה' }, { n: 'ביסלי' }], st: 'draft' });
    await adm.doc(`b/${A}/s3fix/${R2}__f1-a-1_a`).set({ br: 'main', st: 'open', u: E1 });
    await adm.doc(`b/${A}/s3fix/${ROTH}__f1-a-1_a`).set({ br: 'north', st: 'rej', u: E2 });
    await adm.doc(`b/${A}/s3fix/${ROLD}__f1-a-1_a`).set({ br: 'main', st: 'ok', u: E1 });
    const bizOf = (id) => T.loadBiz(id);
    const bizA = await bizOf(A), bizB = await bizOf(B);
    const brief = (who, brs, biz) => T.runInBiz({ bizId: biz || A, prefix: `b/${biz || A}/` }, () => XX.secBrief(T.tdb(), who, brs, now));
    const all = await brief({ uid: MGR, role: 'manager', biz: bizA }, null);
    assert.ok(all && all.text.includes('ציון 78 מתוך 100') && all.text.includes('(-6 מהסבב הקודם)'), all && all.text);
    assert.ok(all.text.includes('ציון 91') && all.text.includes('סניף north'), 'כל הסניפים');
    assert.ok(all.text.includes('קטגוריות חלשות: מחירים 55') && all.text.includes('רשימת חוסרים: 2 פריטים (ממתינה לאישור)'));
    assert.ok(all.text.includes('משימות תיקון פתוחות: 2.'), all.text);
    assert.ok(!all.text.includes('84') && !all.text.includes('ציון 11'), 'רק הסבב האחרון לכל מפה, בלי דיווח יזום');
    assert.ok(!all.text.includes(E1) && !all.text.includes(E2), 'בלי מזהי עובדים');
    assert.equal(all.at, now - D1);
    const lim = await brief({ uid: MGR, role: 'manager', biz: bizA }, ['main']);
    assert.ok(lim.text.includes('בסניפים שלך') && lim.text.includes('ציון 78') && !lim.text.includes('north') && !lim.text.includes('91'), lim.text);
    assert.ok(lim.text.includes('משימות תיקון פתוחות: 1.'));
    assert.equal(await brief({ uid: MGR, role: 'manager', biz: bizA }, ['nosuch']), null, 'סניף בלי נתונים – אין בלוק');
    assert.equal(await brief({ uid: E1, role: 'employee', biz: bizA }, null), null, 'עובד – כלום');
    assert.equal(await brief({ uid: MGR, role: 'manager', biz: Object.assign({}, bizA, { features: Object.assign({}, bizA.features, { store3d: false }) }) }, null), null, 'תוספת כבויה – כלום');
    assert.equal(await brief({ uid: EB, role: 'manager', biz: bizB }, null, B), null, 'עסק אחר (התוספת כבויה שם) – כלום');
    // עסק אחר עם התוספת פעילה – רואה רק את הנתונים שלו (כאן אין לו סבבים), לא של עסק א
    assert.equal(await brief({ uid: EB, role: 'manager', biz: Object.assign({}, bizB, { features: Object.assign({}, bizB.features, { store3d: true }) }) }, null, B), null);
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

describe('שלב 10 – הפונקציות (אמולטור הפונקציות)', () => {
  before(async () => {
    env = await H.getEnv();
    await GM.start();
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  });
  after(async () => { await GM.stop(); });
  beforeEach(async () => { GM.reset(); await seed(); });

  it('s3Fix: מנהל – כן; עובד / אורח / עסק עם store3d כבוי – לא; ביטול', async () => {
    const inp = { qid: qid(), map: 's-main', slot: 'f1-a-2_a', u: E1, man: 'לסדר' };
    assert.equal((await call('s3Fix', null, inp)).status, 'UNAUTHENTICATED');
    assert.equal((await call('s3Fix', E1, inp)).reason, 'manager-only');
    assert.equal((await call('s3Fix', EB, inp)).reason, 'feature-off');
    const r = await call('s3Fix', MGR, inp);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.fixTaskId, 'm_' + inp.qid);
    assert.equal((await get(`b/${A}/s3fix/m_${inp.qid}`)).u, E1);
    const c = await call('s3Fix', MGR, { fixTaskId: 'm_' + inp.qid, cancel: true });
    assert.equal(c.result.st, 'cancel');
  });

  it('shelfCheck verify: רק העובד של המשימה; ok כשהבעיה נעלמה', async () => {
    const inp = { qid: qid(), map: 's-main', slot: 'f1-a-2_a', u: E1, man: 'לסדר' };
    await call('s3Fix', MGR, inp);
    const v = (uid) => call('shelfCheck', uid, photo({ mode: 'verify', run: undefined, fix: 'm_' + inp.qid, slot: 'f1-a-2_a' }));
    assert.equal((await v(E2)).reason, 'not-assigned');
    const r = await v(E1);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.fixSt, 'sent', 'משימה ידנית – ממתינה להכרעת מנהל');
  });
});
