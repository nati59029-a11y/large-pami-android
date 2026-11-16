'use strict';
// סריקת חנות בתלת מימד – שלב 8 (14.11.2026): shelfCheck ו-mapDraft, באמולטור. חלק מ-test:multibiz. Gemini = gemini-mock.js בלבד
// (127.0.0.1:9799, תשובות מקובצי הדוגמה של שלב 6 ב-tests/fixtures). אין שום פנייה החוצה.
//   1. הליבה (shelfCore, draftCore) מול Firestore ו-Storage של האמולטור: תקין נכתב, שבור מחזיר מכסה, עובד זר נדחה, מכסה מלאה עוצרת,
//      אזהרה ב-80% (פעם אחת), תמונה עם אדם לא נשמרת, מחסן בלי מחירים, טיוטה עם אזורים לא בטוחים, qid חוזר, צילום חוזר, סיום סבב.
//   2. הפונקציות דרך אמולטור הפונקציות: מי רשאי, עסק עם store3d כבוי, qid של תמונה ב-s3Log (סוג פעולה אחר) – נדחה.
process.env.SCAN_RETRY_WAIT_MS = process.env.SCAN_RETRY_WAIT_MS || '10'; // 503 מהדמה – בלי המתנה ארוכה (נקרא בטעינת lib/scan.js)
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-s3a', B = 'biz-s3b';
const MGR = 's3_mgr1', E1 = 's3_emp1', E2 = 's3_emp2', DR = 's3_draw1', EB = 's3_empb';
const FEAT = { scan: true, tasks: true, store3d: true };
const FN = path.join(__dirname, '..', 'functions');
const RUN = 'r8k2m4q1_20261115', RUN1 = 'r9x7w5v3_20261115';
const D1 = 86400000;
const fx = (id, o) => Object.assign({ id, k: 'gon', x: 300, y: 300, w: 200, d: 60, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }, o);
const MAP = (o) => Object.assign({ br: 'main', kind: 's', name: 'החנות', v: 3, seq: 2, grid: 50, numDir: 'rtl', src: 'manual', upd: 1, by: MGR,
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1000, 0, 1000, 1000, 0, 1000], h: 300 }], walls: [], cols: [], doors: [], syms: [],
  fx: [fx('f1', { sides: 2 }), fx('f2', { hi: true, lvl: 7, x: 600 })] }, o);
function jpeg(w, h, pad) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(pad || 0), Buffer.from([0xff, 0xd9])]);
}
const IMG = jpeg(1200, 900, 3000).toString('base64'), TH = jpeg(512, 384, 800).toString('base64');
let qn = 0;
const qid = () => 'q' + Date.now().toString(36) + '-' + (qn++).toString().padStart(12, '0');
const photo = (o) => Object.assign({ qid: qid(), mode: 'run', run: RUN, slot: 'f1-a-1_a', at: Date.now() - 1000, src: 'photo', rt: 0, img: IMG, th: TH }, o);

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
  for (const [u, role, perms] of [[MGR, 'manager', null], [E1, 'employee', null], [E2, 'employee', null], [DR, 'employee', { s3m: true }]]) {
    b.set(adm.doc(`b/${A}/staff/${u}`), Object.assign({ name: u, role, active: true, pushTokens: ['tok_' + u + '_0123456789abcdef'] }, perms ? { perms } : {}));
    b.set(adm.doc('users/' + u), { bizId: A, role: role === 'manager' ? 'admin' : 'worker', active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
  }
  b.set(adm.doc(`b/${B}/staff/${EB}`), { name: EB, role: 'employee', active: true, perms: { s3m: true } });
  b.set(adm.doc('users/' + EB), { bizId: B, role: 'worker', active: true, bizStatus: 'active', email: EB + '@example.invalid', createdAt: 1 });
  b.set(adm.doc(`b/${A}/smap/s-main`), MAP());
  b.set(adm.doc(`b/${A}/smap/w-main`), MAP({ kind: 'w', name: 'מחסן' }));
  b.set(adm.doc(`b/${A}/s3set/main`), { stype: 'כלים חד-פעמיים', recN: 2, upd: 1, by: MGR });
  b.set(adm.doc(`b/${A}/smap/s-main/bay/f1-a-1`), { notes: [{ t: 'המגשים ליד המדף הם תצוגה קבועה', at: 1, by: MGR, src: 'mgr' }], exp: [{ n: 'מגשי אלומיניום', pid: 'p77' }], upd: 1, by: MGR });
  const run = { rid: 'r8k2m4q1', br: 'main', map: 's-main', mapV: 3, k: 'sched', st: 'open', uids: [E1, E2], n: 8, nDone: 0,
    asg: { [E1]: ['f1-a-1', 'f1-a-2', 'f1-b-1', 'f1-b-2'], [E2]: ['f2-a-1', 'f2-a-2'] }, nUid: { [E1]: { n: 4, d: 0 }, [E2]: { n: 4, d: 0 } },
    openAt: now - 3600000, dueAt: now + D1, tlog: { [E1]: [], [E2]: [] } };
  b.set(adm.doc(`b/${A}/srun/${RUN}`), run);
  b.set(adm.doc(`b/${A}/srun/${RUN1}`), Object.assign({}, run, { rid: 'r9x7w5v3', uids: [E1], n: 1, asg: { [E1]: ['f1-a-1'] }, nUid: { [E1]: { n: 1, d: 0 } }, tlog: { [E1]: [] } }));
  await b.commit();
}

describe('shelfCheck / mapDraft – הליבה מול האמולטור (Firestore + Storage + gemini-mock)', () => {
  let X, db, bucket, sent;
  const send = async (tokens, msg) => { sent.push({ tokens, kind: msg.kind }); return tokens.map((t) => ({ token: t, ok: true })); };
  const deps = (o) => Object.assign({ base: 'http://127.0.0.1:' + GM.PORT, key: 'test-key', bucket, send, userMax: 400 }, o);
  const W = (uid, o) => Object.assign({ uid, mgr: uid === MGR, bizId: A, brs: null }, o);
  const shelf = (uid, input, o) => X.shelfCore(db, W(uid), input, Date.now(), deps(o));
  const err = async (p) => { try { await p; } catch (e) { return (e.details && e.details.reason) || e.code || e.message; } return 'OK'; };
  const files = async () => (await bucket.getFiles({ prefix: `b/${A}/store3d/` }))[0].map((f) => f.name).sort();
  const use = () => get(`b/${A}/s3use/b_main`);

  before(async () => {
    env = await H.getEnv();
    await GM.start();
    X = require(path.join(FN, 'store3d-ai.js'))._ai;
    const T = require(path.join(FN, 'lib', 'tenant.js'));
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
    db = T.prefixed(adm, `b/${A}/`);
    bucket = require(require.resolve('firebase-admin/storage', { paths: [FN] })).getStorage().bucket(H.PROJECT_ID + '.appspot.com');
  });
  after(async () => { await GM.stop(); });
  beforeEach(async () => {
    sent = []; GM.reset(); await seed();
    for (const f of (await bucket.getFiles({ prefix: `b/${A}/store3d/` }))[0]) await f.delete();
  });

  it('תקין נכתב: ph + ai + קבצים + nDone + s3sum + מכסה; ההקשר (סוג חנות, הערה קבועה, "מה אמור להיות") נשלח; qid חוזר – בלי Gemini ובלי מכסה', async () => {
    const inp = photo();
    const r = await shelf(E1, inp);
    assert.deepEqual([r.st, r.iss.map((i) => i.k), r.runId, r.usage], ['issue', ['fallen', 'face', 'order'], RUN, { m: month(), n: 1, cap: 500, w80: false }]);
    assert.equal(GM.state.requests.length, 1);
    const rq = GM.state.requests[0];
    assert.equal(rq.kind, 's3shelf');
    const parts = rq.body.contents[0].parts;
    assert.match(parts[0].text, /סוג החנות: כלים חד-פעמיים/);
    assert.match(parts[0].text, /המגשים ליד המדף הם תצוגה קבועה/);
    assert.match(parts[0].text, /מה אמור להיות במדף \(רשימת המנהל\): מגשי אלומיניום/);
    assert.match(parts[0].text, /מספר המלצות מרבי: 2/);
    assert.equal(parts[1].inline_data.data, IMG, 'נשלחת התמונה המלאה בלבד');
    const dir = `b/${A}/store3d/main/run/${RUN}/`;
    const ph = await get(`b/${A}/srun/${RUN}/ph/f1-a-1_a`);
    assert.deepEqual([ph.p, ph.th, ph.w, ph.h, ph.by, ph.qid, ph.src, ph.person], [dir + 'f1-a-1_a_1.jpg', dir + 'f1-a-1_a_1_t.jpg', 1200, 900, E1, inp.qid, 'photo', undefined]);
    assert.deepEqual(await files(), [dir + 'f1-a-1_a_1.jpg', dir + 'f1-a-1_a_1_t.jpg']);
    assert.equal((await bucket.file(ph.p).getMetadata())[0].contentType, 'image/jpeg');
    const ai = await get(`b/${A}/srun/${RUN}/ai/f1-a-1_a`);
    assert.deepEqual([ai.st, ai.iss.length, ai.ver, ai.recs.length, typeof ai.model], ['issue', 3, require(path.join(FN, 'lib', 'prompts-shelf.js')).VERSION, 2, 'string']);
    const run = await get(`b/${A}/srun/${RUN}`);
    assert.deepEqual([run.nDone, run.nUid[E1], run.st], [1, { n: 4, d: 1 }, 'open']);
    const sum = await get(`b/${A}/s3sum/s-main`);
    assert.deepEqual(sum.b['f1-a-1'], { s: 'iss', r: RUN, t: ai.at, n: 3, th: ph.th });
    assert.equal(sum.run, RUN);
    assert.deepEqual([(await use()).n, (await get(`b/${A}/s3use/u_${E1}`)).n], [1, 1]);
    const again = await shelf(E1, inp);
    assert.deepEqual([again.dup, again.st, again.usage.n], [true, 'issue', 1]);
    assert.equal(GM.state.requests.length, 1, 'qid חוזר – לא נשלח שוב ל-Gemini');
    assert.equal((await use()).n, 1, 'qid חוזר – לא נספר שוב');
    assert.equal(await err(shelf(E1, Object.assign({}, inp, { mode: 'adhoc', map: 's-main' }))), 'bad-qid', 'אותו qid לסוג פעולה אחר');
  });

  it('עובד זר נדחה (בלי Gemini ובלי מכסה); מנהל יכול, והמקטע נזקף לעובד שלו; מקום לא קיים / סבב סגור / verify', async () => {
    assert.equal(await err(shelf(E2, photo())), 'not-assigned');
    assert.equal(await err(shelf(DR, photo())), 'not-assigned');
    assert.equal(await err(shelf(E1, photo({ slot: 'f2-a-1_t' }))), 'not-assigned');
    assert.equal(await err(shelf(E1, photo({ slot: 'f1-a-3_a' }))), 'bad-slot');
    assert.equal(await err(shelf(E2, photo({ slot: 'f2-a-1_a' }))), 'bad-slot', 'מדף גבוה – עליון/תחתון');
    assert.equal(await err(shelf(E1, photo({ mode: 'verify' }))), 'bad-fix', 'שלב 10: verify בלי מזהה משימה');
    assert.equal(await err(shelf(E1, photo({ mode: 'garbage' }))), 'bad-mode');
    assert.equal(await err(shelf(E1, photo({ img: jpeg(1200, 900, 3000).toString('base64').replace(/^\/9j/, 'iVBO') }))), 'bad-img');
    assert.equal(GM.state.requests.length, 0);
    assert.equal(await use(), null);
    const r = await shelf(MGR, photo({ slot: 'f1-b-2_a' }));
    assert.equal(r.st, 'issue');
    assert.deepEqual((await get(`b/${A}/srun/${RUN}`)).nUid[E1], { n: 4, d: 1 });
    await adm.doc(`b/${A}/srun/${RUN}`).update({ st: 'done' });
    assert.equal(await err(shelf(E1, photo())), 'run-closed');
    assert.equal(GM.state.requests.length, 1);
  });

  it('החזרת מכסה (החלטת המשתמש): Gemini ענה – גם שבור / לא JSON – נספר; 429 / עמוס / ניתוק – מוחזר. בכל כשל: אין ph/ai/קובץ, s3qid נמחק, ואותו qid עובר אחר כך', async () => {
    const inp = photo();
    let expectN = 0;
    for (const [mode, shelfAns, reason, charged] of [['ok', 'shelf-broken', 'bad-answer', true], ['garbage', null, 'bad-answer', true], ['ok', 'not json at all', 'bad-answer', true],
      ['quota', null, 'gemini-quota', false], ['overloaded', null, 'overloaded', false], ['hangup', null, 'network', false]]) {
      GM.reset(); GM.state.mode = mode; GM.state.shelf = shelfAns;
      assert.equal(await err(shelf(E1, inp)), reason, mode + '/' + shelfAns);
      assert.ok(GM.state.requests.length >= 1, 'נשלח ל-Gemini');
      if (charged) expectN++;
      assert.equal((await use()).n, expectN, charged ? 'Gemini ענה – נספר' : 'לא הגיע ל-AI / נדחה בלי חיוב – מוחזר');
      assert.equal(await get(`b/${A}/s3qid/${inp.qid}`), null);
    }
    assert.equal((await get(`b/${A}/s3use/u_${E1}`)).n, 6, 'הבלם היומי לעובד לא מוחזר');
    assert.deepEqual(await ids(`b/${A}/srun/${RUN}/ph`), []);
    assert.deepEqual(await ids(`b/${A}/srun/${RUN}/ai`), []);
    assert.deepEqual(await files(), []);
    GM.reset();
    assert.equal((await shelf(E1, inp)).st, 'issue');
    assert.equal((await use()).n, expectN + 1);
  });

  it('תיקון סבב 1: שתי שמירות מקבילות לאותו מקום צילום – כל אחת בקובץ משלה, אף קובץ של בקשה אחרת לא נמחק, ph מצביע על קובץ קיים', async () => {
    const [a, b] = await Promise.all([shelf(E1, photo()), shelf(MGR, photo())]);
    assert.deepEqual([a.st, b.st], ['issue', 'issue']);
    const ph = await get(`b/${A}/srun/${RUN}/ph/f1-a-1_a`);
    const L = await files();
    assert.ok(L.includes(ph.p) && L.includes(ph.th), 'הקבצים של ph קיימים: ' + L.join(','));
    assert.equal(L.length, 2, 'הצילום הישן נמחק, הנוכחי נשאר');
    assert.equal((await get(`b/${A}/s3sum/s-main`)).b['f1-a-1'].th, ph.th);
    assert.equal((await get(`b/${A}/srun/${RUN}`)).nDone, 1);
  });

  it('תיקון סבב 1: תקרת 99 צילומים חוזרים – נבדקת לפני המכסה ולפני Gemini', async () => {
    await bucket.file(`b/${A}/store3d/main/run/${RUN}/f1-a-1_a_99.jpg`).save(Buffer.from('x'), { resumable: false });
    assert.equal(await err(shelf(E1, photo())), 'too-many');
    assert.equal(GM.state.requests.length, 0);
    assert.equal(await use(), null);
  });

  it('תמונה עם אדם לא נשמרת: אין קובץ ב-Storage, ph.person, תוצאה person, לא נספר "צולם"; נספר במכסה', async () => {
    GM.state.shelf = { st: 'person' };
    const r = await shelf(E1, photo());
    assert.deepEqual([r.st, r.iss], ['person', []]);
    assert.deepEqual(await files(), []);
    const ph = await get(`b/${A}/srun/${RUN}/ph/f1-a-1_a`);
    assert.deepEqual([ph.person, ph.p, ph.th, ph.w], [true, undefined, undefined, 1200]);
    assert.equal((await get(`b/${A}/srun/${RUN}/ai/f1-a-1_a`)).st, 'person');
    assert.equal((await get(`b/${A}/srun/${RUN}`)).nDone, 0);
    assert.equal((await get(`b/${A}/s3sum/s-main`)).b['f1-a-1'].s, 'miss');
    assert.equal((await use()).n, 1);
    // צילום חוזר בלי אדם – נשמר, ועכשיו נספר
    GM.state.shelf = 'shelf-clean';
    assert.equal((await shelf(E1, photo())).st, 'ok');
    assert.equal((await get(`b/${A}/srun/${RUN}`)).nDone, 1);
    assert.equal((await get(`b/${A}/srun/${RUN}/ph/f1-a-1_a`)).person, undefined);
  });

  it('תיקון סבב 1: צילום עם אדם אחרי צילום תקין – הצילום הקודם (ph, ai, קבצים, s3sum) נשאר; נספר במכסה', async () => {
    await shelf(E1, photo());
    const ph0 = await get(`b/${A}/srun/${RUN}/ph/f1-a-1_a`), sum0 = (await get(`b/${A}/s3sum/s-main`)).b['f1-a-1'];
    const f0 = await files();
    GM.state.shelf = { st: 'person' };
    const q = photo();
    const r = await shelf(E1, q);
    assert.deepEqual([r.st, r.kept], ['person', true]);
    assert.deepEqual(await get(`b/${A}/srun/${RUN}/ph/f1-a-1_a`), ph0);
    assert.equal((await get(`b/${A}/srun/${RUN}/ai/f1-a-1_a`)).st, 'issue');
    assert.deepEqual((await get(`b/${A}/s3sum/s-main`)).b['f1-a-1'], sum0);
    assert.deepEqual(await files(), f0, 'הקבצים הקודמים לא נמחקו');
    assert.equal((await get(`b/${A}/srun/${RUN}`)).nDone, 1);
    assert.equal((await use()).n, 2);
    assert.deepEqual([(await shelf(E1, q)).dup, (await shelf(E1, q)).kept], [true, true]);
  });

  it('צילום חוזר: קובץ חדש (_2), הקודם נמחק, nDone לא עולה פעמיים; מדף גבוה – s3sum לפי הגרוע מבין עליון ותחתון', async () => {
    await shelf(E1, photo());
    GM.state.shelf = 'shelf-clean';
    await shelf(E1, photo({ rt: 1 }));
    const dir = `b/${A}/store3d/main/run/${RUN}/`;
    assert.deepEqual(await files(), [dir + 'f1-a-1_a_2.jpg', dir + 'f1-a-1_a_2_t.jpg']);
    assert.deepEqual([(await get(`b/${A}/srun/${RUN}`)).nDone, (await get(`b/${A}/srun/${RUN}/ph/f1-a-1_a`)).rt], [1, 1]);
    await shelf(E2, photo({ slot: 'f2-a-1_t' }));
    GM.state.shelf = 'shelf-ok';
    await shelf(E2, photo({ slot: 'f2-a-1_b' }));
    const s = (await get(`b/${A}/s3sum/s-main`)).b['f2-a-1'];
    assert.deepEqual([s.s, s.n], ['iss', 3]);
    assert.deepEqual((await get(`b/${A}/srun/${RUN}`)).nUid[E2], { n: 4, d: 2 });
  });

  it('סבב מסתיים כשהכל צולם (done + התראה למנהל)', async () => {
    await shelf(E1, photo({ run: RUN1 }));
    const run = await get(`b/${A}/srun/${RUN1}`);
    assert.deepEqual([run.st, run.nDone, typeof run.doneAt], ['done', 1, 'number']);
    assert.ok(await get(`b/${A}/s3ntf/${RUN1}_done`));
  });

  it('מחסן בלי בדיקת מחירים (shelf-warehouse-prices) + דיווח יזום: סבב ad_<qid>, נספר במכסה; מחסן בלי wh נחסם', async () => {
    GM.state.shelf = 'shelf-warehouse-prices';
    const inp = photo({ mode: 'adhoc', run: undefined, map: 'w-main', txt: 'ארגז נפל' });
    assert.equal(await err(shelf(E2, inp)), 'no-wh');
    await adm.doc(`b/${A}/s3br/main`).set({ wh: true, cap: 500, on: true, upd: 1, by: MGR });
    const r = await shelf(E2, inp);
    assert.deepEqual([r.st, r.iss.map((i) => i.k), r.runId], ['issue', ['fallen'], 'ad_' + inp.qid]);
    assert.match(GM.state.requests[0].body.contents[0].parts[0].text, /זה מקטע במחסן/);
    const run = await get(`b/${A}/srun/ad_${inp.qid}`);
    assert.deepEqual([run.k, run.st, run.uids, run.asg, run.map, run.mapV], ['adhoc', 'done', [E2], { [E2]: ['f1-a-1'] }, 'w-main', 3]);
    assert.equal(run.txt, 'ארגז נפל', '7ב: ההערה נשמרת בסבב היזום');
    assert.ok(!JSON.stringify(GM.state.requests.map((x) => x.body)).includes('ארגז נפל'), '7ב: ההערה לא נשלחת ל-AI');
    assert.deepEqual((await get(`b/${A}/srun/ad_${inp.qid}/ai/f1-a-1_a`)).iss.map((i) => i.k), ['fallen']);
    assert.equal((await use()).n, 1);
    assert.equal(await err(X.shelfCore(db, W(E2, { brs: ['other'] }), photo({ mode: 'adhoc', map: 's-main' }), Date.now(), deps())), 'other-branch');
    // דיווח יזום של עובד: מונה יומי נפרד (20; כאן 2), בנוסף למכסה החודשית; מנהל – בלי המונה הזה
    GM.state.shelf = 'shelf-clean';
    const adh = (u) => shelf(u, photo({ mode: 'adhoc', map: 's-main' }), { adhocMax: 2 });
    await adh(E2);
    assert.equal((await get(`b/${A}/s3use/a_${E2}`)).n, 2);
    const nReq = GM.state.requests.length;
    assert.equal(await err(adh(E2)), 's3-adhoc-day');
    assert.equal(GM.state.requests.length, nReq, 'בלי Gemini');
    assert.equal((await adh(MGR)).st, 'ok', 'מנהל לא מוגבל');
    assert.equal(await get(`b/${A}/s3use/a_${MGR}`), null);
    assert.equal((await use()).n, 3, 'הדיווחים היזומים נספרים גם במכסה החודשית');
    await adm.doc(`b/${A}/s3br/main`).set({ wh: true, cap: 500, on: false, upd: 1, by: MGR });
    assert.equal(await err(shelf(E1, photo())), 'br-off');
  });

  it('מכסה: אזהרה ב-80% פעם אחת בחודש (s3ntf + התראה למנהלים), מכסה מלאה עוצרת בלי Gemini; בלם יומי לעובד', async () => {
    await adm.doc(`b/${A}/s3br/main`).set({ wh: false, cap: 5, on: true, upd: 1, by: MGR });
    await adm.doc(`b/${A}/s3use/b_main`).set({ m: month(), n: 3, cap: 5, w80: '', upd: 1 });
    let r = await shelf(E1, photo());
    assert.deepEqual([r.usage.n, r.usage.w80], [4, true]);
    assert.equal((await use()).w80, month());
    const ntf = await get(`b/${A}/s3ntf/main_${month()}_w80`);
    assert.deepEqual([ntf.kind, ntf.to], ['w80', [MGR]]);
    assert.deepEqual(sent.map((s) => s.kind), ['w80']);
    r = await shelf(E1, photo({ slot: 'f1-a-2_a' }));
    assert.equal(r.usage.n, 5);
    assert.deepEqual(sent.map((s) => s.kind), ['w80'], 'אזהרה פעם אחת');
    const before = GM.state.requests.length;
    const e = await err(shelf(E1, photo({ slot: 'f1-b-1_a' })));
    assert.equal(e, 's3-month-limit');
    assert.equal(GM.state.requests.length, before, 'מכסה מלאה – לא נשלח ל-Gemini');
    await adm.doc(`b/${A}/s3br/main`).set({ wh: false, cap: 500, on: true, upd: 1, by: MGR });
    assert.equal(await err(shelf(E1, photo({ slot: 'f1-b-1_a' }), { userMax: 2 })), 's3-user-day');
  });

  it('mapDraft: טיוטה תקינה עם אזורים לא בטוחים (uz, ok:false) ב-s3draft; נספרת כבדיקה אחת (לא לפי מספר התמונות); שבורה – fail; כשל לפני תשובה – מוחזרת בדיקה אחת', async () => {
    const q = qid();
    const r = await X.draftCore(db, W(DR), { qid: q, br: 'main', kind: 's', imgs: [IMG, IMG], cctv: true }, Date.now(), deps());
    assert.deepEqual([r.draftId, r.st, r.n, r.usage.n, r.drop], [q, 'ok', 2, 1, 0], '2 תמונות = בדיקה אחת במכסה');
    assert.equal((await get(`b/${A}/s3use/u_${DR}`)).n, 1, 'גם הבלם היומי – 1');
    assert.ok(r.m.uz.length === 3 && r.m.uz.every((u) => u.ok === false));
    const rq = GM.state.requests[0];
    assert.equal(rq.kind, 's3draft');
    assert.equal(rq.body.contents[0].parts.length, 3, 'הנחיה + 2 תמונות');
    assert.equal(rq.body.generationConfig.maxOutputTokens, 65536, 'maxOutputTokens מפורש לטיוטה (תיקון 15.11.2026)');
    assert.match(rq.body.contents[0].parts[0].text, /מצלמות אבטחה/);
    const d = await get(`b/${A}/s3draft/${q}`);
    assert.deepEqual([d.st, d.by, d.n, d.br, d.kind, d.m.src, d.m.fx.length], ['ok', DR, 2, 'main', 's', 'draft', 5]);
    assert.equal(d.conf, r.conf, '7ב: conf נשמר'); assert.ok(d.conf >= 0 && d.conf <= 1);
    if (r.notes) assert.equal(d.notes, r.notes, '7ב: notes נשמר'); else assert.equal(d.notes, undefined);
    assert.deepEqual(await files(), [], 'תמונות הטיוטה לא נשמרות');
    const again = await X.draftCore(db, W(DR), { qid: q, br: 'main', kind: 's', imgs: [IMG] }, Date.now(), deps());
    assert.deepEqual([again.dup, again.draftId, GM.state.requests.length], [true, q, 1]);
    GM.state.mapdraft = 'mapdraft-broken';
    const q2 = qid();
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: q2, br: 'main', kind: 's', imgs: [IMG, IMG, IMG] }, Date.now(), deps())), 'bad-answer');
    assert.deepEqual([(await get(`b/${A}/s3draft/${q2}`)).st, (await get(`b/${A}/s3draft/${q2}`)).why], ['fail', 'no-rooms']);
    assert.equal(GM.state.requests.length, 3, 'שבורה – ניסיון חוזר אחד (תיקון 15.11.2026)');
    assert.equal((await use()).n, 1, 'שבורה גם בניסיון החוזר – ההקמה לא נספרת (החלטת המשתמש 15.11.2026)');
    assert.equal(await get(`b/${A}/s3qid/${q2}`), null);
    GM.state.mapdraft = 'mapdraft-unsure';
    const u = await X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: [IMG] }, Date.now(), deps());
    assert.deepEqual([u.conf, u.m.fx.length, u.m.uz.length], [0.3, 0, 1]);
    // 15.11.2026: טיוטה עם 5 תמונות – המונה החודשי והבלם היומי עולים ב-1 בלבד
    const b5 = (await use()).n, u5 = (await get(`b/${A}/s3use/u_${MGR}`)).n;
    const r5 = await X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: Array(5).fill(IMG) }, Date.now(), deps());
    assert.deepEqual([r5.n, r5.usage.n, (await use()).n, (await get(`b/${A}/s3use/u_${MGR}`)).n], [5, b5 + 1, b5 + 1, u5 + 1]);
    // תקרה: 100 תמונות – עד 13,000,000 בתים; 101 תמונות / מעל 13MB – נדחה לפני המכסה ולפני Gemini
    const nReq = GM.state.requests.length, b101 = (await use()).n;
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: Array(101).fill(IMG) }, Date.now(), deps())), 'bad-img-count');
    const BIG = jpeg(1200, 900, 1490000).toString('base64');
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: Array(9).fill(BIG) }, Date.now(), deps())), 'too-big', '9 × 1.49MB > 13MB');
    assert.deepEqual([GM.state.requests.length, (await use()).n], [nReq, b101]);
    const r100 = await X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: Array(100).fill(IMG) }, Date.now(), deps());
    assert.deepEqual([r100.st, r100.n, r100.usage.n], ['ok', 100, b101 + 1]);
    assert.equal(GM.state.requests[GM.state.requests.length - 1].body.contents[0].parts.length, 101, 'הנחיה + 100 תמונות');
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 'w', imgs: [IMG] }, Date.now(), deps())), 'no-wh');
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: [] }, Date.now(), deps())), 'bad-img-count');
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'zz', kind: 's', imgs: [IMG] }, Date.now(), deps())), 'no-branch');
    assert.equal(await err(X.draftCore(db, W(DR, { brs: ['other'] }), { qid: qid(), br: 'main', kind: 's', imgs: [IMG] }, Date.now(), deps())), 'other-branch');
    // עד כאן 5 הקמות היום בסניף (התקרה היומית, 15.11.2026) – מאפסים את המונה היומי כדי לבדוק כאן רק את החזרת המכסה החודשית
    assert.equal((await get(`b/${A}/s3use/d_main`)).n, 4, 'הטיוטה השבורה לא נספרה בתקרה היומית');
    await adm.doc(`b/${A}/s3use/d_main`).delete();
    GM.state.mode = 'quota';
    const before = (await use()).n;
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: Array(5).fill(IMG) }, Date.now(), deps())), 'gemini-quota');
    assert.equal((await use()).n, before, '429 – מוחזרת בדיקה אחת בדיוק (5 תמונות, לא 5 בדיקות)');
  });

  it('mapDraft: עד 5 הקמות ביום לסניף (החלטת המשתמש 15.11.2026) – השישית נדחית לפני Gemini; כשל מחזיר; qid חוזר לא נספר; יום חדש מתאפס; סניף אחר לא מושפע', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const dd = (br) => get(`b/${A}/s3use/d_${br}`);
    const draft = (q, br) => X.draftCore(db, W(MGR), { qid: q || qid(), br: br || 'main', kind: 's', imgs: [IMG] }, Date.now(), deps());
    await adm.doc('b/' + A).update({ org: { branches: [{ id: 'main', name: 'ראשי', on: true }, { id: 'br2', name: 'שני', on: true }] } });
    // יום חדש: מסמך מאתמול עם 5 – לא חוסם, ומתחילים מ-1
    await adm.doc(`b/${A}/s3use/d_main`).set({ d: '2026-01-01', n: 5, upd: 1 });
    const q1 = qid();
    assert.equal((await draft(q1)).st, 'ok');
    assert.deepEqual([(await dd('main')).d, (await dd('main')).n], [today, 1], 'יום חדש מאפס את המונה');
    // qid חוזר (dup) – לא נספר
    assert.equal((await draft(q1)).dup, true);
    assert.equal((await dd('main')).n, 1, 'qid חוזר לא נספר');
    for (let i = 2; i <= 5; i++) assert.equal((await draft()).st, 'ok', 'הקמה ' + i);
    assert.equal((await dd('main')).n, 5);
    // השישית – נדחית לפני Gemini, בלי מכסה חודשית ובלי s3draft / s3qid
    const nReq = GM.state.requests.length, b6 = (await use()).n, q6 = qid();
    let e6 = null;
    try { await draft(q6); } catch (e) { e6 = e; }
    assert.equal(e6 && e6.details && e6.details.reason, 'draft-daily');
    assert.equal(e6.code, 'resource-exhausted');
    assert.match(e6.message, /5 הקמות היום בסניף הזה/);
    assert.deepEqual([GM.state.requests.length, (await use()).n, (await dd('main')).n], [nReq, b6, 5]);
    assert.equal(await get(`b/${A}/s3draft/${q6}`), null);
    assert.equal(await get(`b/${A}/s3qid/${q6}`), null);
    // סניף אחר – לא מושפע
    assert.equal((await draft(null, 'br2')).st, 'ok');
    assert.equal((await dd('br2')).n, 1);
    assert.equal((await dd('main')).n, 5);
    // כשל של Gemini לפני תשובה (429) – המונה היומי חוזר ב-1, ואחריו אפשר הקמה נוספת
    await adm.doc(`b/${A}/s3use/d_main`).set({ d: today, n: 4, upd: 1 });
    GM.state.mode = 'quota';
    assert.equal(await err(draft()), 'gemini-quota');
    assert.equal((await dd('main')).n, 4, 'כשל מחזיר את המונה היומי');
    GM.state.mode = 'ok';
    assert.equal((await draft()).st, 'ok', 'אחרי כשל – אפשר הקמה נוספת');
    assert.equal((await dd('main')).n, 5);
    assert.equal(await err(draft()), 'draft-daily');
  });

  it('mapDraft (תיקון 15.11.2026): קטועה → ניסיון חוזר → הצלחה נספרת 1; שבורה פעמיים → bad-answer עם סיבה, לא נספרת; פריטים פסולים מושמטים; בדיקת מדף בלי maxOutputTokens', async () => {
    const dd = async () => { const x = await get(`b/${A}/s3use/d_main`); return x ? x.n : 0; };
    const draft = (q) => X.draftCore(db, W(MGR), { qid: q || qid(), br: 'main', kind: 's', imgs: [IMG, IMG] }, Date.now(), deps());
    // 1. תשובה קטועה (MAX_TOKENS), ואז תקינה – הצלחה, נספרת פעם אחת בדיוק
    GM.state.mapdraftSeq = [{ cut: 'mapdraft-ok' }, 'mapdraft-ok'];
    const q1 = qid();
    const r1 = await draft(q1);
    assert.deepEqual([r1.st, r1.usage.n, r1.drop, GM.state.requests.length], ['ok', 1, 0, 2]);
    assert.deepEqual([(await use()).n, await dd(), (await get(`b/${A}/s3use/u_${MGR}`)).n], [1, 1, 1]);
    assert.ok(GM.state.requests.every((x) => x.body.generationConfig.maxOutputTokens === 65536));
    assert.equal((await get(`b/${A}/s3draft/${q1}`)).why, undefined, 'הצלחה – בלי why');
    // qid חוזר – dup, בלי Gemini ובלי מכסה (בלי שינוי)
    assert.equal((await draft(q1)).dup, true);
    assert.deepEqual([GM.state.requests.length, (await use()).n, await dd()], [2, 1, 1]);
    // 2. קטועה פעמיים – bad-answer עם הסיבה המפורטת; המכסה החודשית והתקרה היומית לא משתנות
    GM.state.mapdraftSeq = [{ cut: 'mapdraft-ok' }, { cut: 'mapdraft-ok' }];
    const q2 = qid();
    let e2 = null;
    try { await draft(q2); } catch (e) { e2 = e; }
    assert.deepEqual([e2.code, e2.details.reason, e2.details.why], ['internal', 'bad-answer', 'cut']);
    assert.match(e2.message, /נקטעה/); assert.match(e2.message, /לא נספרה במכסה/);
    assert.equal(GM.state.requests.length, 4, 'ניסיון חוזר אחד בלבד');
    assert.deepEqual([(await use()).n, await dd()], [1, 1], 'שבורה – לא נספרת');
    const f2 = await get(`b/${A}/s3draft/${q2}`);
    assert.deepEqual([f2.st, f2.why], ['fail', 'cut']);
    assert.equal(await get(`b/${A}/s3qid/${q2}`), null, 'אפשר לנסות שוב עם אותו qid');
    // לא JSON ואז בלי חדר – הסיבה של הניסיון האחרון
    GM.state.mapdraftSeq = ['not json at all', 'mapdraft-broken'];
    let e3 = null;
    try { await draft(); } catch (e) { e3 = e; }
    assert.deepEqual([e3.details.reason, e3.details.why], ['bad-answer', 'no-rooms']);
    assert.deepEqual([(await use()).n, await dd()], [1, 1]);
    // 3. שבורה ואז תקינה – נספרת 1
    GM.state.mapdraftSeq = ['not json at all', 'mapdraft-ok'];
    assert.equal((await draft()).st, 'ok');
    assert.deepEqual([(await use()).n, await dd()], [2, 2]);
    // 4. גוף עם חדר שלא קיים ומקרר דו-צדדי וגוף פסול – cleanDraft מסנן; חדר פסול (קירות חוצים) לצד חדר תקין – מושמט, הטיוטה נשמרת
    const okAns = GM.fixture('mapdraft-ok');
    const part = JSON.parse(JSON.stringify(okAns)); delete part._example; delete part._meta;
    part.rooms.push({ name: 'פסול', p: [0, 0, 500, 500, 500, 0, 0, 500], h: 300 });
    part.fx.push({ k: 'shelf', x: 1, y: 1, w: 100, d: 50, h: 100, a: 0, sides: 1, bays: 1, lvl: 1, room: 'x' });
    GM.state.mapdraftSeq = [part];
    const n0 = GM.state.requests.length;
    const r4 = await draft();
    assert.deepEqual([r4.st, r4.drop, r4.m.rooms.length, GM.state.requests.length - n0], ['ok', 2, 1, 1], 'חדר + גוף הושמטו, בלי ניסיון חוזר');
    assert.deepEqual([(await use()).n, await dd()], [3, 3]);
    // 5. בדיקת מדף – בלי maxOutputTokens (לא השתנתה)
    await shelf(E1, photo());
    const last = GM.state.requests[GM.state.requests.length - 1];
    assert.deepEqual([last.kind, last.body.generationConfig.maxOutputTokens], ['s3shelf', undefined]);
  });
  it('mapDraft עם שאלון וסקיצה (15.11.2026): קלט לא תקין נדחה לפני המכסה ו-Gemini; תקין – בהנחיה, בטיוטה (מידות, חדרים, שורות) וב-s3draft; בלי השדות – כמו קודם', async () => {
    const dd = async () => { const x = await get(`b/${A}/s3use/d_main`); return x ? x.n : 0; };
    const INFO = { w: 1400, l: 1500, rooms: 2, rows: 3, ent: 'd', cash: 'r', note: 'קופה ליד הכניסה' };
    const SK = { rooms: [[0, 0, 1400, 0, 1400, 1000, 0, 1000], [0, 1000, 1400, 1000, 1400, 1500, 0, 1500]], rows: [[600, 300, 600, 1100], [1100, 300, 1100, 900], [200, 1250, 1200, 1250]], rt: ['s', 'w'], rk: ['gon', 'gon', 'fridge'], ent: [700, 1500], cash: [1200, 1400] };
    const draft = (extra, q) => X.draftCore(db, W(MGR), Object.assign({ qid: q || qid(), br: 'main', kind: 's', imgs: [IMG] }, extra), Date.now(), deps());
    const un = async () => ((await use()) || {}).n || 0;
    const n0 = GM.state.requests.length, u0 = await un(), d0 = await dd();
    for (const bad of [{ info: { w: 50 } }, { info: 'x' }, { info: INFO, sketch: { rooms: [[0, 0, 5000, 0, 5000, 5000]] } }, { sketch: SK }, { info: INFO, sketch: Object.assign({}, SK, { rk: ['gon'] }) }, { info: Object.assign({ zz: 1 }, INFO) }])
      assert.equal(await err(draft(bad)), 'bad-info', JSON.stringify(bad).slice(0, 60));
    assert.deepEqual([GM.state.requests.length - n0, await un(), await dd()], [0, u0, d0], 'בלי Gemini ובלי מכסה');
    GM.state.mapdraftSeq = ['mapdraft-ok'];
    const q1 = qid();
    const r = await draft({ info: INFO, sketch: SK }, q1);
    assert.equal(r.st, 'ok');
    const pr = JSON.stringify(GM.state.requests[GM.state.requests.length - 1].body);
    assert.match(pr, /מחייבים/); assert.match(pr, /רוחב 14 מטר/); assert.match(pr, /חדר 2 \(מחסן\)/); assert.match(pr, /הכניסה הראשית בנקודה \(700,1500\)/);
    assert.deepEqual(r.m.rooms.map((x) => x.p), SK.rooms);
    assert.deepEqual(r.m.rooms.map((x) => x.name), ['אולם מכירות', 'מחסן']);
    assert.ok(r.m.fx.some((f) => f.k === 'fridge' && f.x === 700 && f.y === 1250));
    assert.ok(r.m.fx.every((f) => f.x >= 0 && f.x <= 1400 && f.y >= 0 && f.y <= 1500));
    const doc = await get(`b/${A}/s3draft/${q1}`);
    assert.deepEqual(doc.info, INFO);
    assert.deepEqual(doc.sk.rooms.map((x) => x.p), SK.rooms, 'Firestore: מערך של {p} (בלי מערך בתוך מערך)');
    assert.deepEqual([doc.sk.rk, doc.sk.ent], [SK.rk, SK.ent]);
    // בלי השדות (גרסת אפליקציה ישנה) – בלי info/sk ב-s3draft, וההנחיה בלי "נתונים מבעל החנות"
    GM.state.mapdraftSeq = ['mapdraft-ok'];
    const q2 = qid();
    assert.equal((await draft({}, q2)).st, 'ok');
    const pr2 = JSON.stringify(GM.state.requests[GM.state.requests.length - 1].body);
    assert.doesNotMatch(pr2, /מבעל החנות/);
    const doc2 = await get(`b/${A}/s3draft/${q2}`);
    assert.deepEqual([doc2.info, doc2.sk], [undefined, undefined]);
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

describe('shelfCheck / mapDraft (אמולטור הפונקציות)', () => {
  before(async () => {
    env = await H.getEnv();
    await GM.start();
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  });
  after(async () => { await GM.stop(); });
  beforeEach(async () => { GM.reset(); await seed(); });

  it('shelfCheck: העובד האחראי – כן; עובד אחר / אורח / עסק עם store3d כבוי – לא; qid של תמונה ב-s3Log נדחה', async () => {
    assert.equal((await call('shelfCheck', null, photo())).status, 'UNAUTHENTICATED');
    assert.equal((await call('shelfCheck', EB, photo())).reason, 'feature-off');
    assert.equal((await call('shelfCheck', E2, photo())).reason, 'not-assigned');
    const inp = photo();
    const r = await call('shelfCheck', E1, inp);
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual([r.result.st, r.result.usage.n], ['issue', 1]);
    assert.ok(await get(`b/${A}/srun/${RUN}/ph/f1-a-1_a`));
    const d = await call('shelfCheck', E1, inp);
    assert.equal(d.result.dup, true);
    const lg = await call('s3Log', E1, { qid: inp.qid, run: RUN, ev: 's', at: Date.now() });
    assert.equal(lg.reason, 'bad-qid', 'הערה פתוחה משלב 5: qid חוזר מסוג אחר');
  });

  it('mapDraft: מנהל ו-s3m – כן; עובד בלי s3m / עסק כבוי – לא', async () => {
    assert.equal((await call('mapDraft', E1, { qid: qid(), br: 'main', kind: 's', imgs: [IMG] })).reason, 'not-s3m');
    assert.equal((await call('mapDraft', EB, { qid: qid(), br: 'main', kind: 's', imgs: [IMG] })).reason, 'feature-off');
    const r = await call('mapDraft', DR, { qid: qid(), br: 'main', kind: 's', imgs: [IMG] });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.st, 'ok');
  });
});
