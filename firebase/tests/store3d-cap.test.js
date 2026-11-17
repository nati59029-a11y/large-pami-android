'use strict';
// הקמת חנות – שלב 3 (17.11.2026): s3CapPut / s3SetupDone (s3cap.js), באמולטור. חלק מ-test:multibiz:4.
//   1. הליבה (capPut, setupDone) מול Firestore ו-Storage של האמולטור: תמונה לפריט (JPEG בלבד, נתיב cap/, מוקטנת), qid חוזר בלי כפילות,
//      מדף גבוה (t/b), תקרת 6 לגובה, חזית ידנית = ok + s3sum.fr (בלי לגעת ב-th של הסבב) / s3look, דילוג רק עם סיבה, פריט שלא בתוכנית,
//      פריט שזז במפה חוזר ל-part, orph כשהפריט נמחק מהמפה, מונים, סיום רק כשהכול ok/skip, הערות מקטע ← bay.notes פעם אחת.
//   2. הפונקציות דרך אמולטור הפונקציות: מנהל ו-s3m – כן; עובד בלי s3m – לא מעלה; עסק עם store3d כבוי – לא.
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const A = 'biz-cap', B = 'biz-capoff';
const MGR = 'cap_mgr1', E1 = 'cap_emp1', DR = 'cap_draw1', EB = 'cap_empb', EO = 'cap_other', EOFF = 'cap_off';
const FEAT = { scan: true, tasks: true, store3d: true };
const fx = (id, o) => Object.assign({ id, k: 'gon', x: 300, y: 300, w: 200, d: 60, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }, o);
const MAP = (o) => Object.assign({ br: 'main', kind: 's', name: 'החנות', v: 1, seq: 2, grid: 50, numDir: 'rtl', src: 'manual', ent: 'd1',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 500, 0, 500, 400, 0, 400], h: 300 }], walls: [], cols: [],
  doors: [{ id: 'd1', x: 250, y: 400, w: 100, a: 0, k: 'ent' }], syms: [{ id: 'y1', k: 'cash', x: 400, y: 350, a: 0 }],
  fx: [fx('f1', { x: 200, y: 150, w: 200, bays: 2 }), fx('f2', { x: 350, y: 250, w: 100, bays: 1, hi: true, num: 2 })] }, o);
// JPEG מינימלי עם מידות (כותרת SOF) ומילוי עד הגודל הנדרש
function jpeg(w, h, size) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const b = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
  return Buffer.concat([b, Buffer.alloc(Math.max(0, (size || 0) - b.length))]).toString('base64');
}
const IMG = jpeg(1200, 900, 4000), TH = jpeg(320, 240, 500), FR = jpeg(2048, 600, 5000);
let qn = 0;
const qid = () => 'q' + Date.now().toString(36) + '-' + (qn++).toString().padStart(12, '0');

let env, adm, T;
const FN = path.join(__dirname, '..', 'functions');
const get = async (p) => { const s = await adm.doc(p).get(); return s.exists ? s.data() : null; };

async function seed(map) {
  await env.clearFirestore();
  const b = adm.batch();
  b.set(adm.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: FEAT });
  b.set(adm.doc('b/' + B), { name: 'ב', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: Object.assign({}, FEAT, { store3d: false }) });
  b.set(adm.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
  for (const [u, role, perms, o] of [[MGR, 'manager', null], [E1, 'employee', null], [DR, 'employee', { s3m: true }], [EO, 'employee', { s3m: true }, { br: ['other'] }], [EOFF, 'employee', { s3m: true }, { active: false }]]) {
    b.set(adm.doc(`b/${A}/staff/${u}`), Object.assign({ name: u, role, active: true }, perms ? { perms } : {}, o || {}));
    b.set(adm.doc('users/' + u), { bizId: A, role: role === 'manager' ? 'admin' : 'worker', active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
  }
  b.set(adm.doc(`b/${B}/staff/${EB}`), { name: EB, role: 'employee', active: true, perms: { s3m: true } });
  b.set(adm.doc('users/' + EB), { bizId: B, role: 'worker', active: true, bizStatus: 'active', email: EB + '@example.invalid', createdAt: 1 });
  b.set(adm.doc(`b/${A}/smap/s-main`), map || MAP());
  b.set(adm.doc(`b/${A}/s3sum/s-main`), { b: { 'f1-a-1': { s: 'ok', r: 'run1', t: 1800000000000, n: 0, th: 'b/x/old_t.jpg' } }, upd: 1 });
  await b.commit();
}

describe('s3cap – הליבה מול האמולטור (Firestore + Storage)', () => {
  let C, P, db, bucket;
  const drw = { uid: DR, bizId: A };
  before(async () => {
    env = await H.getEnv();
    C = require(path.join(FN, 's3cap.js'))._cap;
    P = require(path.join(FN, 'lib', 'store3d-capplan.js'));
    T = require(path.join(FN, 'lib', 'tenant.js'));
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
    db = T.prefixed(adm, `b/${A}/`);
    bucket = require(require.resolve('firebase-admin/storage', { paths: [FN] })).getStorage().bucket(H.PROJECT_ID + '.appspot.com');
  });
  beforeEach(async () => { await seed(); await bucket.deleteFiles({ prefix: `b/${A}/store3d/` }).catch(() => {}); });
  const err = async (p) => { try { await p; } catch (e) { return e.details && e.details.reason; } return 'OK'; };
  const put = (o, now) => C.capPut(db, drw, Object.assign({ qid: qid(), mapId: 's-main' }, o), now || 1800000000000, bucket);

  it('תמונה: נשמרת ב-cap/ (JPEG + מוקטנת), part, geo/geoV, מונה; אותו qid – אותה תשובה בלי קובץ נוסף; תמונה שנייה n=2', async () => {
    const q = qid();
    const r = await C.capPut(db, drw, { qid: q, mapId: 's-main', key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH }, 1800000000000, bucket);
    assert.deepEqual([r.st, r.n, r.ph], ['part', 1, 1]);
    const d = await get(`b/${A}/s3setup/s-main/cap/b_f1-a-1`);
    assert.equal(d.k, 'b'); assert.equal(d.st, 'part'); assert.equal(d.geoV, 1); assert.equal(d.geo.length, 4); assert.equal(d.by, DR);
    assert.equal(d.ph[0].p, `b/${A}/store3d/main/cap/s-main/b_f1-a-1_1.jpg`); assert.equal(d.ph[0].th, `b/${A}/store3d/main/cap/s-main/b_f1-a-1_1_t.jpg`);
    assert.deepEqual([d.ph[0].lv, d.ph[0].w, d.ph[0].h], ['a', 1200, 900]);
    const [meta] = await bucket.file(d.ph[0].p).getMetadata();
    assert.equal(meta.contentType, 'image/jpeg');
    const again = await C.capPut(db, drw, { qid: q, mapId: 's-main', key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH }, 1800000001000, bucket);
    assert.equal(again.dup, true);
    let [files] = await bucket.getFiles({ prefix: `b/${A}/store3d/main/cap/` });
    assert.equal(files.length, 2, 'בלי קבצים נוספים');
    assert.equal((await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH })).n, 2);
    [files] = await bucket.getFiles({ prefix: `b/${A}/store3d/main/cap/` });
    assert.equal(files.length, 4);
    const s = await get(`b/${A}/s3setup/s-main`);
    assert.deepEqual([s.v, s.st, s.capPart, s.capOk, s.mapV], [1, 'cap', 1, 0, 1]);
    assert.equal(await err(C.capPut(db, { uid: MGR, bizId: A }, { qid: q, mapId: 's-main', key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH }, 1, bucket)), 'bad-qid', 'qid של משתמש אחר');
  });

  it('קלט: PNG / גדול מדי / בלי מוקטנת / פריט לא בתוכנית / מפתח לא תקין / גובה לא מתאים / סניף אחר – נדחים, בלי קבצים', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000)]).toString('base64');
    assert.equal(await err(put({ key: 'b_f1-a-1', op: 'ph', img: png, th: TH })), 'bad-type');
    assert.equal(await err(put({ key: 'b_f1-a-1', op: 'ph', img: jpeg(3000, 2000, 4000), th: TH })), 'bad-size');
    assert.equal(await err(put({ key: 'b_f1-a-1', op: 'ph', img: jpeg(1200, 900, 1600000), th: TH })), 'too-big');
    assert.equal(await err(put({ key: 'b_f1-a-1', op: 'ph', img: IMG })), 'bad-img');
    assert.equal(await err(put({ key: 'b_f9-a-1', op: 'ph', img: IMG, th: TH })), 'not-in-plan');
    assert.equal(await err(put({ key: 'x_1', op: 'ph', img: IMG, th: TH })), 'bad-key');
    assert.equal(await err(put({ key: 'b_f2-a-1', op: 'ph', lv: 'a', img: IMG, th: TH })), 'bad-lv', 'מדף גבוה – עליון/תחתון');
    assert.equal(await err(put({ key: 'b_f1-a-1', op: 'ph', lv: 't', img: IMG, th: TH })), 'bad-lv');
    assert.equal(await err(put({ key: 'b_f1-a-1', op: 'nope' })), 'bad-op');
    assert.equal(await err(C.capPut(db, { uid: DR, bizId: A, brs: ['other'] }, { qid: qid(), mapId: 's-main', key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH }, 1, bucket)), 'other-branch');
    assert.equal(await err(put({ mapId: 's-zz', key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH })), 'no-branch');
    const [files] = await bucket.getFiles({ prefix: `b/${A}/store3d/` });
    assert.equal(files.length, 0);
  });

  it('מדף גבוה: עליון ותחתון באותו מפתח; עד 6 לכל גובה (ph-full); off מסמן ולא מוחק', async () => {
    for (let i = 0; i < 6; i++) assert.equal((await put({ key: 'b_f2-a-1', op: 'ph', lv: 't', img: IMG, th: TH })).n, i + 1);
    assert.equal(await err(put({ key: 'b_f2-a-1', op: 'ph', lv: 't', img: IMG, th: TH })), 'ph-full');
    assert.equal((await put({ key: 'b_f2-a-1', op: 'ph', lv: 'b', img: IMG, th: TH })).n, 7);
    const r = await put({ key: 'b_f2-a-1', op: 'off', n: 3 });
    assert.equal(r.off, true);
    const d = await get(`b/${A}/s3setup/s-main/cap/b_f2-a-1`);
    assert.equal(d.ph.length, 7); assert.equal(d.ph[2].off, true); assert.deepEqual(d.ph.map((p) => p.lv).join(''), 'ttttttb');
    assert.equal((await put({ key: 'b_f2-a-1', op: 'off', n: 3 })).off, false, 'שוב – חוזרת לשימוש');
    assert.equal(await err(put({ key: 'b_f2-a-1', op: 'off', n: 50 })), 'no-photo');
  });

  it('geo (שלב 4ב): תיקון ידני נשמר ב-ph[n] בלבד, בלי קובץ ובלי שינוי st; קלט לא תקין / n לא קיים נדחים; qid חוזר – אותה תשובה', async () => {
    await put({ key: 'b_f2-a-1', op: 'ph', lv: 't', img: IMG, th: TH });
    await put({ key: 'b_f2-a-1', op: 'ph', lv: 'b', img: IMG, th: TH });
    const [f0] = await bucket.getFiles({ prefix: `b/${A}/store3d/` });
    const before = await get(`b/${A}/s3setup/s-main/cap/b_f2-a-1`);
    const s0 = await get(`b/${A}/s3setup/s-main`);
    const q = qid(), quad = [10, 20, 990, 15, 980, 970, 5, 990];
    const r = await C.capPut(db, drw, { qid: q, mapId: 's-main', key: 'b_f2-a-1', op: 'geo', n: 2, quad, xr: { a: 0, b: 600 }, yr: { a: 450, b: 1000 } }, 1800000003000, bucket);
    assert.deepEqual([r.ok, r.op, r.n, r.st], [true, 'geo', 2, 'part']);
    let d = await get(`b/${A}/s3setup/s-main/cap/b_f2-a-1`);
    assert.deepEqual(d.ph[1].quad, quad); assert.deepEqual(d.ph[1].xr, { a: 0, b: 600 }); assert.deepEqual(d.ph[1].yr, { a: 450, b: 1000 });
    assert.deepEqual([d.ph[1].p, d.ph[1].th, d.ph[1].lv, d.ph[1].w, d.ph[1].at], [before.ph[1].p, before.ph[1].th, 'b', 1200, before.ph[1].at], 'שאר שדות התמונה לא משתנים');
    assert.deepEqual(d.ph[0], before.ph[0], 'תמונה אחרת לא משתנה');
    assert.equal(d.st, before.st);
    const s1 = await get(`b/${A}/s3setup/s-main`);
    assert.deepEqual([s1.capOk, s1.capPart, s1.capSkip], [s0.capOk, s0.capPart, s0.capSkip], 'מונים לא משתנים');
    // רק xr – quad ו-yr נשארים
    await put({ key: 'b_f2-a-1', op: 'geo', n: 2, xr: { a: 100, b: 700 } });
    d = await get(`b/${A}/s3setup/s-main/cap/b_f2-a-1`);
    assert.deepEqual([d.ph[1].xr, d.ph[1].quad, d.ph[1].yr], [{ a: 100, b: 700 }, quad, { a: 450, b: 1000 }]);
    // qid חוזר – אותה תשובה, בלי כתיבה (הערך הקודם לא חוזר)
    const again = await C.capPut(db, drw, { qid: q, mapId: 's-main', key: 'b_f2-a-1', op: 'geo', n: 2, quad, xr: { a: 0, b: 600 } }, 1800000009000, bucket);
    assert.equal(again.dup, true); assert.equal(again.n, 2);
    assert.deepEqual((await get(`b/${A}/s3setup/s-main/cap/b_f2-a-1`)).ph[1].xr, { a: 100, b: 700 });
    // קלט לא תקין
    const g = (o) => err(put(Object.assign({ key: 'b_f2-a-1', op: 'geo', n: 1 }, o)));
    assert.equal(await g({ quad: [0, 0, 1000, 0, 1000, 1000, 0] }), 'bad-quad', '7 מספרים');
    assert.equal(await g({ quad: [0, 0, 1001, 0, 1000, 1000, 0, 1000] }), 'bad-quad', 'מעל 1000');
    assert.equal(await g({ quad: [0, 0, 999.5, 0, 1000, 1000, 0, 1000] }), 'bad-quad', 'לא שלם');
    assert.equal(await g({ quad: [-1, 0, 1000, 0, 1000, 1000, 0, 1000] }), 'bad-quad', 'שלילי');
    assert.equal(await g({ quad: '0,0,1000,0,1000,1000,0,1000' }), 'bad-quad');
    assert.equal(await g({ xr: { a: 500, b: 500 } }), 'bad-xr', 'a == b');
    assert.equal(await g({ xr: { a: 600, b: 100 } }), 'bad-xr', 'a > b');
    assert.equal(await g({ xr: { a: 0, b: 1200 } }), 'bad-xr');
    assert.equal(await g({ xr: [0, 500] }), 'bad-xr', 'מערך במקום {a,b}');
    assert.equal(await g({ xr: { a: 0, b: 500, c: 1 } }), 'bad-xr', 'שדה זר');
    assert.equal(await g({ yr: { a: 900, b: 100 } }), 'bad-yr');
    assert.equal(await g({ yr: { a: -5, b: 100 } }), 'bad-yr');
    assert.equal(await g({ yr: { a: 100, b: 149 } }), 'bad-yr', 'b-a < 50');
    assert.notEqual(await g({ yr: { a: 100, b: 150 } }), 'bad-yr', 'b-a = 50 מותר');
    assert.equal(await g({}), 'bad-input', 'בלי quad/xr/yr');
    assert.equal(await g({ n: 0, xr: { a: 0, b: 500 } }), 'bad-n');
    assert.equal(await g({ n: 50, xr: { a: 0, b: 500 } }), 'no-photo', 'n לא קיים');
    assert.equal(await err(put({ key: 'b_f1-a-1', op: 'geo', n: 1, xr: { a: 0, b: 500 } })), 'no-photo', 'פריט בלי תמונות');
    assert.equal(await get(`b/${A}/s3setup/s-main/cap/b_f1-a-1`), null, 'לא נוצר מסמך');
    assert.equal(await err(put({ key: 'b_f9-a-1', op: 'geo', n: 1, xr: { a: 0, b: 500 } })), 'not-in-plan');
    assert.equal(await err(C.capPut(db, { uid: DR, bizId: A, brs: ['other'] }, { qid: qid(), mapId: 's-main', key: 'b_f2-a-1', op: 'geo', n: 1, xr: { a: 0, b: 500 } }, 1, bucket)), 'other-branch');
    const [f1] = await bucket.getFiles({ prefix: `b/${A}/store3d/` });
    assert.equal(f1.length, f0.length, 'בלי קבצים חדשים');
  });

  it('geo (סבב בדיקה של שלב 2): הרשאות דרך הפונקציה עצמה (exports.s3CapPut.run) – מנהל ו-s3m מותר; בלי s3m / סניף אחר / עסק אחר / תוסף כבוי / עובד מושבת – נדחה', async () => {
    const IX = require(path.join(FN, 'index.js'));
    const call = async (uid, biz) => {
      try { await IX.s3CapPut.run({ auth: { uid, token: { uid } }, data: { bizId: biz || A, qid: qid(), mapId: 's-main', key: 'b_f1-a-1', op: 'geo', n: 1, xr: { a: 0, b: 500 } }, rawRequest: { headers: {} } }); return 'OK'; }
      catch (e) { return (e.details && e.details.reason) || e.code; }
    };
    // מותר = עבר את ההרשאה ונעצר בבדיקת התוכן (אין עדיין תמונה לפריט)
    assert.equal(await call(MGR), 'no-photo', 'מנהל');
    assert.equal(await call(DR), 'no-photo', 's3m');
    assert.equal(await call(E1), 'not-s3m');
    assert.equal(await call(EO), 'other-branch');
    assert.equal(await call(EB), 'foreign-biz');
    assert.equal(await call(EB, B), 'feature-off');
    assert.equal(await call(EOFF), 'staff-disabled');
  });
  it('geo על פריט ok: נשאר ok (okBy לא נמחק)', async () => {
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    await put({ key: 'b_f1-a-1', op: 'front', img: FR, th: TH, man: true });
    const r = await put({ key: 'b_f1-a-1', op: 'geo', n: 1, quad: [0, 0, 1000, 0, 1000, 1000, 0, 1000] });
    assert.equal(r.st, 'ok');
    const d = await get(`b/${A}/s3setup/s-main/cap/b_f1-a-1`);
    assert.deepEqual([d.st, d.okBy, d.ph[0].quad.length], ['ok', DR, 8]);
  });

  it('חזית ידנית (man) = ok עם okBy; מקטע ← s3sum.b[bay].fr/frT בלי לגעת ב-th/s; דלת ← s3look; חזית שנייה – frV 2 ו-frH', async () => {
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    const r = await put({ key: 'b_f1-a-1', op: 'front', img: FR, th: TH, man: true }, 1800000005000);
    assert.deepEqual([r.st, r.v], ['ok', 1]);
    let d = await get(`b/${A}/s3setup/s-main/cap/b_f1-a-1`);
    assert.deepEqual([d.st, d.okBy, d.man, d.frV, d.fr], ['ok', DR, true, 1, `b/${A}/store3d/main/front/s-main/b_f1-a-1_1.jpg`]);
    const sum = await get(`b/${A}/s3sum/s-main`);
    assert.deepEqual(sum.b['f1-a-1'], { s: 'ok', r: 'run1', t: 1800000000000, n: 0, th: 'b/x/old_t.jpg', fr: `b/${A}/store3d/main/front/s-main/b_f1-a-1_1_t.jpg`, frT: 1800000005000 });
    await put({ key: 'b_f1-a-1', op: 'front', img: FR, th: TH }, 1800000006000);
    d = await get(`b/${A}/s3setup/s-main/cap/b_f1-a-1`);
    assert.deepEqual([d.st, d.frV, d.okBy, d.frH.length, d.frH[0].v], ['part', 2, undefined, 1, 1], 'חזית בלי man – ממתינה לבדיקה');
    await put({ key: 'd_d1', op: 'front', img: FR, th: TH, man: true }, 1800000007000);
    const look = await get(`b/${A}/s3look/s-main`);
    assert.deepEqual(look.it.d_d1, { th: `b/${A}/store3d/main/front/s-main/d_d1_1_t.jpg`, p: `b/${A}/store3d/main/front/s-main/d_d1_1.jpg`, t: 1800000007000, v: 1 });
    assert.equal(look.v, 1);
    const s = await get(`b/${A}/s3setup/s-main`);
    assert.deepEqual([s.capOk, s.capPart], [1, 1]);
  });

  it('דילוג: רק עם סיבה; ביטול דילוג; פריט ok שהמקום שלו זז במפה ← part; פריט שנמחק מהמפה ← orph (לא נמחק)', async () => {
    assert.equal(await err(put({ key: 'k_y1', op: 'skip', why: '   ' })), 'bad-why');
    assert.equal((await put({ key: 'k_y1', op: 'skip', why: 'אין קופה עדיין' })).st, 'skip');
    assert.equal((await get(`b/${A}/s3setup/s-main/cap/k_y1`)).why, 'אין קופה עדיין');
    assert.equal((await put({ key: 'k_y1', op: 'unskip' })).st, 'todo');
    assert.equal(await err(put({ key: 'k_y1', op: 'unskip' })), 'not-skipped');
    await put({ key: 'b_f1-a-1', op: 'front', img: FR, th: TH, man: true });
    // הגוף f1 זז 100 ס"מ, והגוף f2 נמחק – גרסת מפה חדשה
    await adm.doc(`b/${A}/smap/s-main`).set(MAP({ v: 2, fx: [fx('f1', { x: 300, y: 150, w: 200, bays: 2 }), fx('f2', { x: 350, y: 250, w: 100, bays: 1, hi: true, num: 2, del: 1 })] }));
    await adm.doc(`b/${A}/s3setup/s-main/cap/b_f2-a-1`).set({ k: 'b', ord: 9, st: 'part', ph: [{ n: 1 }], upd: 1, by: DR });
    const r = await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    assert.equal(r.st, 'part', 'הפריט זז – צריך לצלם שוב');
    const d = await get(`b/${A}/s3setup/s-main/cap/b_f1-a-1`);
    assert.deepEqual([d.st, d.okBy, d.geoV, !!d.fr], ['part', undefined, 2, true], 'החזית נשארת');
    const o = await get(`b/${A}/s3setup/s-main/cap/b_f2-a-1`);
    assert.deepEqual([o.st, o.ph.length], ['orph', 1]);
    const s = await get(`b/${A}/s3setup/s-main`);
    assert.deepEqual([s.mapV, s.capOk, s.capPart], [2, 0, 1]);
    assert.equal(await err(put({ key: 'b_f2-a-1', op: 'ph', lv: 't', img: IMG, th: TH })), 'not-in-plan');
  });

  it('סיום: נדחה עם רשימת חסרים; כשהכול ok / דולג – done, והערת מקטע נוספת ל-bay.notes פעם אחת (בלי לגעת בקיימות)', async () => {
    const who = { uid: MGR, bizId: A };
    const e = await C.setupDone(db, who, { qid: qid(), mapId: 's-main' }, 1800000000000).catch((x) => x);
    assert.equal(e.details.reason, 'not-done');
    const plan = P.capPlan(MAP());
    assert.equal(e.details.n, plan.n); assert.equal(e.details.miss.length, Math.min(20, plan.n)); assert.equal(e.details.miss[0], plan.items[0].key);
    await adm.doc(`b/${A}/smap/s-main/bay/f1-a-1`).set({ cat: 'חטיפים', notes: [{ t: 'קיימת', at: 1, by: MGR }], upd: 1, by: MGR });
    await adm.doc(`b/${A}/s3setup/s-main/n/f1-a-1`).set({ t: 'המדף התחתון שבור', upd: 1, by: DR });
    await adm.doc(`b/${A}/s3setup/s-main/n/f1-a-2`).set({ t: '', upd: 1, by: DR });
    // הקמת חנות שלב 2 (סבב בדיקה 1): הערה לשיוך מחדש (re:1), והערה מטיוטה שהפריט במספר שלה כבר אחר – לא מועתקות
    await adm.doc(`b/${A}/s3setup/s-main/n/f2-a-1`).set({ t: 'לשיוך מחדש', upd: 1, by: DR, re: 1 });
    await adm.doc(`b/${A}/smap/s-main/bay/f2-a-1`).delete();
    await adm.doc(`b/${A}/s3setup/s-main/n/f2`).set({ t: 'על גוף אחר', upd: 1, by: DR, d: 'מקרר מספר 7 "אחר"', on: 'draft', g: { t: 'fx', k: 'fridge', x: 9000, y: 9000 } });
    for (const it of plan.items) {
      if (it.key === 'w_r1-1-1') await put({ key: it.key, op: 'skip', why: 'מכוסה במדפים' });
      else await adm.doc(`b/${A}/s3setup/s-main/cap/${it.key}`).set({ k: it.k, ord: it.ord, st: 'ok', geo: it.geo, okBy: MGR, okAt: 1, fr: 'x', upd: 1, by: MGR });
    }
    const q = qid();
    const r = await C.setupDone(db, who, { qid: q, mapId: 's-main' }, 1800000009000);
    assert.deepEqual([r.ok, r.n, r.skip, r.notes], [true, plan.n, 1, 1]);
    const s = await get(`b/${A}/s3setup/s-main`);
    assert.deepEqual([s.st, s.doneBy, s.doneAt], ['done', MGR, 1800000009000]);
    const bay = await get(`b/${A}/smap/s-main/bay/f1-a-1`);
    assert.deepEqual(bay.notes, [{ t: 'קיימת', at: 1, by: MGR }, { t: 'המדף התחתון שבור', at: 1800000009000, by: DR, src: 'setup' }]);
    assert.equal(bay.cat, 'חטיפים');
    assert.equal((await get(`b/${A}/s3setup/s-main/n/f1-a-1`)).bay, 1);
    assert.equal(await get(`b/${A}/smap/s-main/bay/f1-a-2`), null, 'הערה ריקה – לא נוצר כלום');
    assert.equal(await get(`b/${A}/smap/s-main/bay/f2-a-1`), null, 'הערה לשיוך מחדש – לא מועתקת ל-bay.notes');
    assert.equal(r.re, 2, 'מספר ההערות שמחכות לשיוך');
    assert.equal((await C.setupDone(db, who, { qid: q, mapId: 's-main' }, 1800000010000)).dup, true);
    await C.setupDone(db, who, { qid: qid(), mapId: 's-main' }, 1800000011000);
    assert.equal((await get(`b/${A}/smap/s-main/bay/f1-a-1`)).notes.length, 2, 'לא מועתקת פעמיים');
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
describe('s3CapPut / s3SetupDone (אמולטור הפונקציות)', () => {
  before(async () => {
    env = await H.getEnv();
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  });
  beforeEach(() => seed());
  it('מנהל ו-s3m – כן; עובד בלי s3m – לא מעלה; אורח – לא; עסק עם store3d כבוי – לא', async () => {
    const PH = (o) => Object.assign({ qid: qid(), mapId: 's-main', key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH }, o);
    assert.equal((await call('s3CapPut', null, PH())).status, 'UNAUTHENTICATED');
    assert.equal((await call('s3CapPut', E1, PH())).reason, 'not-s3m');
    assert.equal((await call('s3CapPut', EB, PH())).reason, 'feature-off');
    assert.equal(await get(`b/${A}/s3setup/s-main/cap/b_f1-a-1`), null, 'לא נכתב כלום');
    const a = await call('s3CapPut', DR, PH());
    assert.equal(a.status, 'OK', a.text); assert.equal(a.result.n, 1);
    const m = await call('s3CapPut', MGR, PH({ key: 'k_y1', op: 'skip', why: 'אין' }));
    assert.equal(m.status, 'OK', m.text);
    assert.equal((await call('s3SetupDone', E1, { qid: qid(), mapId: 's-main' })).reason, 'not-s3m');
    assert.equal((await call('s3SetupDone', DR, { qid: qid(), mapId: 's-main' })).reason, 'not-done');
  });
});
