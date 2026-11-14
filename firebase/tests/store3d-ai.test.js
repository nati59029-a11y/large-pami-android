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

  it('mapDraft: טיוטה תקינה עם אזורים לא בטוחים (uz, ok:false) ב-s3draft; נספר לפי מספר התמונות; שבורה – fail והחזרת מכסה', async () => {
    const q = qid();
    const r = await X.draftCore(db, W(DR), { qid: q, br: 'main', kind: 's', imgs: [IMG, IMG], cctv: true }, Date.now(), deps());
    assert.deepEqual([r.draftId, r.st, r.n, r.usage.n, r.drop], [q, 'ok', 2, 2, 0]);
    assert.ok(r.m.uz.length === 3 && r.m.uz.every((u) => u.ok === false));
    const rq = GM.state.requests[0];
    assert.equal(rq.kind, 's3draft');
    assert.equal(rq.body.contents[0].parts.length, 3, 'הנחיה + 2 תמונות');
    assert.match(rq.body.contents[0].parts[0].text, /מצלמות אבטחה/);
    const d = await get(`b/${A}/s3draft/${q}`);
    assert.deepEqual([d.st, d.by, d.n, d.br, d.kind, d.m.src, d.m.fx.length], ['ok', DR, 2, 'main', 's', 'draft', 5]);
    assert.deepEqual(await files(), [], 'תמונות הטיוטה לא נשמרות');
    const again = await X.draftCore(db, W(DR), { qid: q, br: 'main', kind: 's', imgs: [IMG] }, Date.now(), deps());
    assert.deepEqual([again.dup, again.draftId, GM.state.requests.length], [true, q, 1]);
    GM.state.mapdraft = 'mapdraft-broken';
    const q2 = qid();
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: q2, br: 'main', kind: 's', imgs: [IMG, IMG, IMG] }, Date.now(), deps())), 'bad-answer');
    assert.equal((await get(`b/${A}/s3draft/${q2}`)).st, 'fail');
    assert.equal((await use()).n, 5, 'Gemini ענה (טיוטה שבורה) – 3 התמונות נספרות (החלטת המשתמש)');
    assert.equal(await get(`b/${A}/s3qid/${q2}`), null);
    GM.state.mapdraft = 'mapdraft-unsure';
    const u = await X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: [IMG] }, Date.now(), deps());
    assert.deepEqual([u.conf, u.m.fx.length, u.m.uz.length], [0.3, 0, 1]);
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 'w', imgs: [IMG] }, Date.now(), deps())), 'no-wh');
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: [] }, Date.now(), deps())), 'bad-img-count');
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'zz', kind: 's', imgs: [IMG] }, Date.now(), deps())), 'no-branch');
    assert.equal(await err(X.draftCore(db, W(DR, { brs: ['other'] }), { qid: qid(), br: 'main', kind: 's', imgs: [IMG] }, Date.now(), deps())), 'other-branch');
    GM.state.mode = 'quota';
    const before = (await use()).n;
    assert.equal(await err(X.draftCore(db, W(MGR), { qid: qid(), br: 'main', kind: 's', imgs: [IMG, IMG] }, Date.now(), deps())), 'gemini-quota');
    assert.equal((await use()).n, before, '429 – מוחזר');
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
