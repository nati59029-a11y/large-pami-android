'use strict';
// סריקת חנות בתלת מימד – שלב 18א (15.11.2026): סיור 360 באמולטור. חלק מ-test:multibiz.
//   1. הליבה (putPano, delPano, cleanBiz) מול Firestore ו-Storage של האמולטור: העלאה, qid חוזר, תמונות לא תקינות, נקודה מחוץ למפה,
//      41 נקודות, בלם יומי, החלפה (גרסה חדשה), שכנות אוטומטיות ודו-כיווניות, מחיקה רכה, וניקוי שמוחק רק את הישנים.
//   2. הפונקציות s3PutPano / s3DelPano דרך אמולטור הפונקציות: מנהל, עובד עם s3m, עובד בלי s3m, עסק עם store3d כבוי.
//   3. הכללים: קריאה של smap/{mapId}/pano ושל pano/ ב-Storage לצוות העסק בלבד; כתיבה ישירה מהלקוח – חסומה (בעסק ובשורש).
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-p3a', B = 'biz-p3b';
const MGR = 'p3_mgr1', E1 = 'p3_emp1', DR = 'p3_draw1', EB = 'p3_empb', OM = 'p3_omgr';
const RMGR = 'p3_rmgr', RE1 = 'p3_remp';
const FEAT = { scan: true, tasks: true, store3d: true };
const D1 = 86400000;
function jpeg(w, h, pad) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(pad || 0), Buffer.from([0xff, 0xd9])]);
}
const FULL = jpeg(2048, 1024).toString('base64'), SM = jpeg(1024, 512).toString('base64');
let qn = 0;
const qid = () => 'p' + Date.now().toString(36) + '-' + (qn++).toString().padStart(12, '0');
// חדר 10×10 מ' (חדר שני מחוק – מחוץ למפה)
const SMAP = { br: 'main', kind: 's', name: 'החנות', v: 1, seq: 0, grid: 50, numDir: 'rtl', src: 'manual',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1000, 0, 1000, 1000, 0, 1000], h: 300 }, { id: 'r2', name: 'מחוק', p: [2000, 0, 3000, 0, 3000, 1000, 2000, 1000], h: 300, del: 1, delAt: 1, delBy: 'x' }],
  walls: [], cols: [], doors: [], syms: [], fx: [], upd: 1, by: MGR };
const PT = (o) => Object.assign({ qid: qid(), mapId: 's-main', x: 300, y: 300, yaw: 90, full: FULL, sm: SM }, o);

let env, adm;
const FN = path.join(__dirname, '..', 'functions');
const get = async (p) => { const s = await adm.doc(p).get(); return s.exists ? s.data() : null; };

async function seed() {
  await env.clearFirestore();
  const b = adm.batch();
  b.set(adm.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: FEAT });
  b.set(adm.doc('b/' + B), { name: 'ב', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: Object.assign({}, FEAT, { store3d: false }) });
  b.set(adm.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
  for (const [u, role, perms] of [[MGR, 'manager', null], [E1, 'employee', null], [DR, 'employee', { s3m: true }]]) {
    b.set(adm.doc(`b/${A}/staff/${u}`), Object.assign({ name: u, role, active: true }, perms ? { perms } : {}));
    b.set(adm.doc('users/' + u), { bizId: A, role: role === 'manager' ? 'admin' : 'worker', active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
  }
  b.set(adm.doc(`b/${B}/staff/${EB}`), { name: EB, role: 'employee', active: true, perms: { s3m: true } });
  b.set(adm.doc('users/' + EB), { bizId: B, role: 'worker', active: true, bizStatus: 'active', email: EB + '@example.invalid', createdAt: 1 });
  // עסק אחר עם store3d פעיל – מנהל שלו לא קורא את העסק שלנו
  b.set(adm.doc('b/biz-p3c'), { name: 'ג', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: FEAT });
  b.set(adm.doc('b/biz-p3c/admins/' + OM), { email: OM + '@example.invalid' });
  b.set(adm.doc('users/' + OM), { bizId: 'biz-p3c', role: 'admin', active: true, bizStatus: 'active', email: OM + '@example.invalid', createdAt: 1 });
  b.set(adm.doc(`b/${A}/smap/s-main`), SMAP);
  b.set(adm.doc('b/biz-p3c/smap/s-main'), SMAP);
  await b.commit();
}

after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

// ---------------- 1. הליבה ----------------
describe('store3d-pano – הליבה מול האמולטור (Firestore + Storage)', () => {
  let C, X, T, db, bucket;
  const mgr = { uid: MGR, bizId: A, brs: null }, drw = { uid: DR, bizId: A, brs: null };
  const err = async (p) => { try { await p; } catch (e) { return (e.details && e.details.reason) || e.code || e.message; } return 'OK'; };
  const files = async () => (await bucket.getFiles({ prefix: `b/${A}/store3d/` }))[0].map((f) => f.name.split('/store3d/main/')[1]).sort();
  const put = (who, o, opts) => C.putPano(db, who, PT(o), Date.now(), bucket, opts);
  before(async () => {
    env = await H.getEnv();
    C = require(path.join(FN, 'store3d-map.js'))._map;
    X = require(path.join(FN, 'store3d-extra.js'))._x;
    T = require(path.join(FN, 'lib', 'tenant.js'));
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
    db = T.prefixed(adm, `b/${A}/`);
    bucket = require(require.resolve('firebase-admin/storage', { paths: [FN] })).getStorage().bucket(H.PROJECT_ID + '.appspot.com');
  });
  beforeEach(async () => {
    await seed();
    await bucket.deleteFiles({ prefix: `b/${A}/store3d/` }).catch(() => {});
  });

  it('מנהל מעלה: מסמך, שני קבצי JPEG, מונה יומי; qid חוזר – אותה תשובה בלי קובץ נוסף; qid של משתמש אחר – נדחה', async () => {
    const q = qid();
    const r = await put(mgr, { qid: q });
    assert.deepEqual([r.ok, r.id, r.ver, r.w, r.h, r.nb, r.yaw], [true, 'p1', 1, 2048, 1024, [], 90]);
    assert.equal(r.full, `b/${A}/store3d/main/pano/s-main/p1_1.jpg`);
    const d = await get(`b/${A}/smap/s-main/pano/p1`);
    assert.deepEqual([d.x, d.y, d.yaw, d.full, d.sm, d.w, d.h, d.ver, d.by, d.sz], [300, 300, 90, r.full, r.sm, 2048, 1024, 1, MGR, jpeg(2048, 1024).length]);
    assert.ok(Number.isInteger(d.at) && d.at === d.upd);
    const [meta] = await bucket.file(r.sm).getMetadata();
    assert.equal(meta.contentType, 'image/jpeg');
    assert.deepEqual(await files(), ['pano/s-main/p1_1.jpg', 'pano/s-main/p1_1_s.jpg']);
    assert.equal((await get(`b/${A}/s3use/p_main`)).n, 1);
    const again = await put(mgr, { qid: q, x: 900 });
    assert.deepEqual(again, Object.assign({}, r, { dup: true }));
    assert.equal((await files()).length, 2);
    assert.equal((await get(`b/${A}/s3use/p_main`)).n, 1, 'ניסיון חוזר לא נספר');
    assert.equal(await err(put(drw, { qid: q })), 'bad-qid');
    assert.equal((await get(`b/${A}/s3qid/${q}`)).k, 'pano');
  });

  it('שלב 21ו: 8192×4096 של 6.5MB (מעל המגבלה הקודמת של 3MB) – נשמרת עם w/h/sz הנכונים', async () => {
    const big = jpeg(8192, 4096, 6500000);
    const r = await put(mgr, { full: big.toString('base64') });
    assert.deepEqual([r.ok, r.w, r.h], [true, 8192, 4096]);
    const d = await get(`b/${A}/smap/s-main/pano/p1`);
    assert.deepEqual([d.w, d.h, d.sz], [8192, 4096, big.length]);
    const [meta] = await bucket.file(r.full).getMetadata();
    assert.equal(+meta.size, big.length);
  });

  it('תמונה לא 2:1 / גדולה מדי / לא JPEG / קטנה במידה אחרת – נדחות, בלי קבצים ובלי מונה', async () => {
    assert.equal(await err(put(mgr, { full: jpeg(2048, 1000).toString('base64') })), 'bad-ratio');
    assert.equal(await err(put(mgr, { full: jpeg(2048, 1024, 8000000).toString('base64') })), 'too-big', 'שלב 21ו: מעל 8,000,000');
    assert.equal(await err(put(mgr, { full: jpeg(16384, 8192).toString('base64') })), 'bad-size');
    assert.equal(await err(put(mgr, { full: Buffer.from('not an image at all').toString('base64') })), 'bad-type');
    assert.equal(await err(put(mgr, { sm: jpeg(800, 400).toString('base64') })), 'bad-size');
    assert.equal(await err(put(mgr, { sm: undefined })), 'bad-img');
    assert.deepEqual(await files(), []);
    assert.equal(await get(`b/${A}/s3use/p_main`), null);
  });

  it('נקודה מחוץ למפה / בחדר מחוק / מפה לא קיימת / סניף אחר – נדחות', async () => {
    assert.equal(await err(put(mgr, { x: 1500, y: 300 })), 'out-of-map');
    assert.equal(await err(put(mgr, { x: 2500, y: 300 })), 'out-of-map', 'חדר מחוק');
    assert.equal(await err(put(mgr, { x: 300, y: 300, yaw: 400 })), 'bad-pt');
    assert.equal(await err(put(mgr, { mapId: 'w-main' })), 'no-wh');
    await adm.doc(`b/${A}/s3br/main`).set({ wh: true, cap: 500, on: true, upd: 1, by: 'x' });
    assert.equal(await err(put(mgr, { mapId: 'w-main' })), 'no-map');
    assert.equal(await err(put(Object.assign({}, drw, { brs: ['other'] }), {})), 'other-branch');
    assert.deepEqual(await files(), []);
  });

  it('41 נקודות פעילות – נדחית; מחוקה לא נספרת', async () => {
    const b = adm.batch();
    for (let i = 1; i <= 40; i++) b.set(adm.doc(`b/${A}/smap/s-main/pano/p${i}`), { x: 10 * i, y: 900, yaw: 0, nb: [], full: 'x', sm: 'x', w: 2048, h: 1024, sz: 1, ver: 1, by: MGR, at: 1, upd: 1 });
    await b.commit();
    assert.equal(await err(put(mgr, {})), 'pano-limit');
    assert.deepEqual(await files(), [], 'נבדק לפני ההעלאה');
    await adm.doc(`b/${A}/smap/s-main/pano/p40`).update({ del: 1, delAt: 1, delBy: MGR });
    const r = await put(mgr, {});
    assert.equal(r.id, 'p41', 'המזהה לא חוזר לשימוש');
  });

  it('בלם יומי: 60 העלאות ביום לסניף; עדכון כיוון בלי תמונה – לא נספר ולא נחסם', async () => {
    const r = await put(mgr, {});
    const day = (await get(`b/${A}/s3use/p_main`)).d;
    await adm.doc(`b/${A}/s3use/p_main`).set({ d: day, n: 60, upd: 1 });
    assert.equal(await err(put(mgr, {})), 'pano-day');
    assert.equal(await err(put(mgr, { id: r.id })), 'pano-day', 'גם החלפת תמונה');
    const u = await put(mgr, { id: r.id, yaw: 180, full: undefined, sm: undefined });
    assert.deepEqual([u.ver, u.yaw, u.full], [1, 180, r.full]);
    assert.equal((await get(`b/${A}/s3use/p_main`)).n, 60);
    await adm.doc(`b/${A}/s3use/p_main`).set({ d: '2000-01-01', n: 60, upd: 1 });
    assert.equal((await put(mgr, {})).id, 'p2', 'יום חדש');
    assert.equal((await put(mgr, {}, { maxDay: 1 }).catch((e) => e.details.reason)), 'pano-day');
  });

  it('שכנות: אוטומטי עד 8 מ\' ודו-כיווני; nb שנשלח – כמו שהוא; החלפה = גרסה חדשה והקבצים הקודמים נשארים', async () => {
    const a = await put(drw, { x: 100, y: 100 });
    const b = await put(drw, { x: 500, y: 100 });
    assert.deepEqual(b.nb, ['p1']);
    assert.deepEqual(b.linked, ['p1']);
    assert.deepEqual((await get(`b/${A}/smap/s-main/pano/p1`)).nb, ['p2'], 'קישור חוזר');
    const c = await put(drw, { x: 900, y: 900, nb: [] });
    assert.deepEqual(c.nb, []);
    assert.equal(await err(put(drw, { nb: ['p99'] })), 'bad-nb');
    // החלפת p1 באותו מקום בלי nb – השכנות נשמרות; גרסה 2
    const a2 = await put(drw, { id: a.id, x: 100, y: 100 });
    assert.deepEqual([a2.ver, a2.nb, a2.full], [2, ['p2'], `b/${A}/store3d/main/pano/s-main/p1_2.jpg`]);
    assert.deepEqual(await files(), ['pano/s-main/p1_1.jpg', 'pano/s-main/p1_1_s.jpg', 'pano/s-main/p1_2.jpg', 'pano/s-main/p1_2_s.jpg',
      'pano/s-main/p2_1.jpg', 'pano/s-main/p2_1_s.jpg', 'pano/s-main/p3_1.jpg', 'pano/s-main/p3_1_s.jpg']);
    // קישור ידני p3 ↔ p1
    await put(drw, { id: c.id, x: 900, y: 900, nb: ['p1'], full: undefined, sm: undefined });
    assert.deepEqual((await get(`b/${A}/smap/s-main/pano/p1`)).nb.sort(), ['p2', 'p3']);
    assert.equal(await err(put(drw, { id: 'p77' })), 'no-pano');
  });

  it('מחיקה רכה: del/delAt/delBy, יוצאת מהשכנות, מחיקה חוזרת = dup; החלפה של נקודה מחוקה – נדחית', async () => {
    await put(mgr, { x: 100, y: 100 });
    await put(mgr, { x: 500, y: 100 });
    const r = await C.delPano(db, mgr, { mapId: 's-main', id: 'p1' }, 1800000000000);
    assert.deepEqual(r, { ok: true, mapId: 's-main', id: 'p1', delAt: 1800000000000 });
    const d = await get(`b/${A}/smap/s-main/pano/p1`);
    assert.deepEqual([d.del, d.delAt, d.delBy, d.full.endsWith('p1_1.jpg')], [1, 1800000000000, MGR, true]);
    assert.deepEqual((await get(`b/${A}/smap/s-main/pano/p2`)).nb, []);
    assert.equal((await C.delPano(db, mgr, { mapId: 's-main', id: 'p1' }, 1800000001000)).dup, true);
    assert.equal(await err(C.delPano(db, mgr, { mapId: 's-main', id: 'p9' }, 1)), 'no-pano');
    assert.equal(await err(put(mgr, { id: 'p1' })), 'pano-gone');
    assert.equal((await files()).length, 4, 'הקבצים נשארים עד הניקוי');
  });

  // תיקון סבב 1 (בודק עצמאי): בקשות מקבילות לא עוקפות את התקרות, ואף בקשה לא מוחקת קבצים של נקודה שנשמרה
  const exists = async (p) => (await bucket.file(p).exists())[0];
  const allPts = async () => (await adm.collection(`b/${A}/smap/s-main/pano`).get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const seedPts = async (k) => {
    const b = adm.batch();
    for (let i = 1; i <= k; i++) b.set(adm.doc(`b/${A}/smap/s-main/pano/p${i}`), { x: 10 * i, y: 900, yaw: 0, nb: [], full: 'x', sm: 'x', w: 2048, h: 1024, sz: 1, ver: 1, by: MGR, at: 1, upd: 1 });
    await b.commit();
  };
  const filesOk = async (ids) => { const L = await allPts(); for (const id of ids) { const d = L.find((x) => x.id === id); assert.ok(d && await exists(d.full) && await exists(d.sm), 'קבצים של ' + id); } };

  it('מקביל מול 40 נקודות: 38 קיימות, 5 בקשות במקביל → בדיוק 2 נשמרות, 40 פעילות, הקבצים שלהן קיימים, ובלי קבצים יתומים', async () => {
    await seedPts(38);
    const r = await Promise.allSettled([1, 2, 3, 4, 5].map(() => put(mgr, {})));
    const ok = r.filter((x) => x.status === 'fulfilled').map((x) => x.value.id);
    assert.equal(ok.length, 2, JSON.stringify(r.map((x) => x.status === 'fulfilled' ? x.value.id : x.reason.details && x.reason.details.reason)));
    assert.ok(r.filter((x) => x.status === 'rejected').every((x) => x.reason.details.reason === 'pano-limit'));
    assert.equal((await allPts()).filter((d) => d.del !== 1).length, 40);
    await filesOk(ok);
    assert.equal((await files()).length, 4, 'הבקשות שנדחו מחקו רק את הקבצים שלהן');
  });

  it('מקביל מול 60 ביום: המונה ב-58, 5 בקשות במקביל → לכל היותר 2 נשמרות, המונה לא עובר 60, הקבצים של מה שנשמר קיימים', async () => {
    await put(mgr, {});
    const day = (await get(`b/${A}/s3use/p_main`)).d;
    await adm.doc(`b/${A}/s3use/p_main`).set({ d: day, n: 58, upd: 1 });
    const r = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => put(mgr, { x: 100 * i })));
    const ok = r.filter((x) => x.status === 'fulfilled').map((x) => x.value.id);
    const n = (await get(`b/${A}/s3use/p_main`)).n;
    assert.ok(ok.length <= 2 && ok.length >= 1, String(ok.length));
    assert.equal(n, 58 + ok.length);
    assert.ok(r.filter((x) => x.status === 'rejected').every((x) => ['pano-day', 'busy'].includes(x.reason.details.reason)));
    await filesOk(['p1'].concat(ok));
    assert.equal((await files()).length, 2 * (1 + ok.length));
  });

  it('אותו qid במקביל: בדיוק נקודה אחת, עם קבצים קיימים; השאר dup עם אותה תשובה', async () => {
    const q = qid();
    const r = await Promise.allSettled([1, 2, 3].map(() => put(mgr, { qid: q })));
    const vals = r.filter((x) => x.status === 'fulfilled').map((x) => x.value);
    assert.equal(vals.length, 3, JSON.stringify(r.map((x) => x.status === 'rejected' && x.reason.message)));
    assert.equal(vals.filter((v) => !v.dup).length, 1);
    assert.ok(vals.every((v) => v.id === vals[0].id && v.full === vals[0].full));
    assert.equal((await allPts()).length, 1);
    await filesOk([vals[0].id]);
    assert.equal((await files()).length, 2);
  });

  it('nb לנקודה מחוקה – bad-nb; mapId מסוכן ב-put וב-del – bad-map-id; id לא תקין ב-del – bad-pt', async () => {
    await put(mgr, { x: 100, y: 100 });
    await C.delPano(db, mgr, { mapId: 's-main', id: 'p1' }, Date.now());
    assert.equal(await err(put(mgr, { nb: ['p1'] })), 'bad-nb');
    for (const m of ['../x', 's-A/B', 's-main/../w', '', null]) {
      assert.equal(await err(put(mgr, { mapId: m })), 'bad-map-id', 'put ' + m);
      assert.equal(await err(C.delPano(db, mgr, { mapId: m, id: 'p1' }, 1)), 'bad-map-id', 'del ' + m);
    }
    for (const id of ['x1', '../p1', 'p12345', '', 5]) assert.equal(await err(C.delPano(db, mgr, { mapId: 's-main', id }, 1)), 'bad-pt', 'id ' + id);
  });

  it('עובד s3m ששויך לסניף אחר (staff.br דרך myBranches): put ו-del נחסמים; מנהל – לא מוגבל', async () => {
    const staff = (br) => ({ exists: true, get: (k) => (k === 'br' ? br : undefined) });
    assert.deepEqual(C.myBranches({ role: 'employee', staff: staff(['other']) }), ['other']);
    assert.equal(C.myBranches({ role: 'employee', staff: staff(undefined) }), null);
    assert.equal(C.myBranches({ role: 'manager', staff: staff(['other']) }), null);
    const lim = { uid: DR, bizId: A, brs: C.myBranches({ role: 'employee', staff: staff(['other']) }) };
    assert.equal(await err(put(lim, {})), 'other-branch');
    await put(mgr, {});
    assert.equal(await err(C.delPano(db, lim, { mapId: 's-main', id: 'p1' }, 1)), 'other-branch');
    const mine = { uid: DR, bizId: A, brs: C.myBranches({ role: 'employee', staff: staff(['main']) }) };
    assert.equal((await put(mine, { x: 600 })).id, 'p2');
    assert.equal((await get(`b/${A}/smap/s-main/pano/p1`)).del, undefined);
  });

  it('s3Clean: מוחק רק גרסאות שהוחלפו לפני 30+ יום ונקודות שנמחקו לפני 30+ יום; לא נוגע בנקודות פעילות, בטקסטורות ובמפה', async () => {
    const NOW = Date.now();
    const P = `b/${A}/store3d/main/pano/s-main/`;
    const save = (n) => bucket.file(P + n).save(Buffer.from('x'), { resumable: false });
    // קבצים חדשים (נוצרו עכשיו) – לכן "now" של הניקוי מוזז קדימה ב-40 יום, וזמני המסמכים יחסית אליו
    const T0 = NOW + 40 * D1;
    for (const n of ['p1_1.jpg', 'p1_1_s.jpg', 'p1_2.jpg', 'p1_2_s.jpg', 'p2_1.jpg', 'p2_2.jpg', 'p3_1.jpg', 'p3_1_s.jpg', 'p4_1.jpg']) await save(n);
    await bucket.file(`b/${A}/store3d/main/tex/s-main/t1_1.jpg`).save(Buffer.from('x'), { resumable: false });
    // מפה בלי פריטים בסל המחזור, עם טקסטורה בשימוש – כך ששאר שלבי הניקוי לא משנים כלום, ורק pano נבדק
    await adm.doc(`b/${A}/smap/s-main`).set(Object.assign({}, SMAP, { rooms: [SMAP.rooms[0]], tx: [{ id: 't1', path: `b/${A}/store3d/main/tex/s-main/t1_1.jpg`, w: 512, h: 512 }] }));
    const doc = (o) => Object.assign({ x: 100, y: 100, yaw: 0, nb: [], full: 'x', sm: 'x', w: 2048, h: 1024, sz: 1, by: MGR, upd: 1 }, o);
    await adm.doc(`b/${A}/smap/s-main/pano/p1`).set(doc({ ver: 2, at: T0 - 31 * D1 }));   // הוחלפה לפני 31 יום
    await adm.doc(`b/${A}/smap/s-main/pano/p2`).set(doc({ ver: 2, at: T0 - 10 * D1 }));   // הוחלפה לפני 10 ימים
    await adm.doc(`b/${A}/smap/s-main/pano/p3`).set(doc({ ver: 1, at: 1, del: 1, delAt: T0 - 31 * D1, delBy: MGR }));
    await adm.doc(`b/${A}/smap/s-main/pano/p4`).set(doc({ ver: 1, at: 1, del: 1, delAt: T0 - 29 * D1, delBy: MGR }));
    const map0 = await get(`b/${A}/smap/s-main`);
    const out = await T.runInBiz({ bizId: A, prefix: `b/${A}/` }, () => X.cleanBiz({ bizId: A, now: T0, bucket, send: async () => [] }));
    assert.ok(Object.values(out).every((v) => v !== -1), JSON.stringify(out));
    assert.equal(out.pano, 5, '3 קבצים של p1_1 ו-p3 (4) + מסמך p3 = 5');
    assert.deepEqual(await files(), ['pano/s-main/p1_2.jpg', 'pano/s-main/p1_2_s.jpg', 'pano/s-main/p2_1.jpg', 'pano/s-main/p2_2.jpg', 'pano/s-main/p4_1.jpg', 'tex/s-main/t1_1.jpg']);
    assert.equal(await get(`b/${A}/smap/s-main/pano/p3`), null);
    for (const p of ['p1', 'p2', 'p4']) assert.ok(await get(`b/${A}/smap/s-main/pano/${p}`), p);
    assert.deepEqual(await get(`b/${A}/smap/s-main`), map0, 'המפה לא השתנתה');
    const au = (await adm.collection(`b/${A}/audit`).where('act', '==', 's3Clean').get()).docs.map((x) => x.data().note).join('\n');
    assert.match(au, /pano s-main\/p1_1\.jpg/);
    assert.match(au, /pano s-main\/p3/);
  });
});

// ---------------- 2. הפונקציות (אמולטור הפונקציות – רץ ב-CI) ----------------
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, message: j && j.error && j.error.message, result: j && j.result, text };
}

describe('s3PutPano / s3DelPano (אמולטור הפונקציות)', () => {
  before(async () => {
    env = await H.getEnv();
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  });
  beforeEach(seed);

  it('מנהל ועובד עם s3m – מעלים; עובד בלי s3m / אורח / עסק עם store3d כבוי – נחסמים; מחיקה – מנהל בלבד', async () => {
    assert.equal((await call('s3PutPano', null, PT())).status, 'UNAUTHENTICATED');
    const e1 = await call('s3PutPano', E1, PT());
    assert.deepEqual([e1.status, e1.reason], ['PERMISSION_DENIED', 'not-s3m']);
    assert.equal((await call('s3PutPano', EB, PT())).reason, 'feature-off');
    const q = qid();
    const m = await call('s3PutPano', MGR, PT({ qid: q }));
    assert.equal(m.status, 'OK', m.text);
    assert.equal(m.result.id, 'p1');
    const dup = await call('s3PutPano', MGR, PT({ qid: q }));
    assert.deepEqual([dup.result.id, dup.result.dup], ['p1', true]);
    const d = await call('s3PutPano', DR, PT({ x: 600 }));
    assert.equal(d.status, 'OK', d.text);
    assert.deepEqual([d.result.id, d.result.nb], ['p2', ['p1']]);
    const bad = await call('s3PutPano', DR, PT({ full: jpeg(2048, 2048).toString('base64') }));
    assert.deepEqual([bad.status, bad.reason], ['INVALID_ARGUMENT', 'bad-ratio']);
    assert.match(bad.message, /2:1/);
    assert.equal((await call('s3DelPano', DR, { mapId: 's-main', id: 'p1' })).reason, 'del-mgr');
    // עובד s3m ששויך לסניף אחר (staff.br → myBranches): העלאה נחסמת (other-branch), מחיקה – del-mgr
    await adm.doc(`b/${A}/staff/${DR}`).update({ br: ['other'] });
    assert.equal((await call('s3PutPano', DR, PT({ x: 700 }))).reason, 'other-branch');
    assert.equal((await call('s3DelPano', DR, { mapId: 's-main', id: 'p2' })).reason, 'del-mgr');
    assert.equal((await call('s3DelPano', MGR, { mapId: '../x', id: 'p2' })).reason, 'bad-map-id');
    assert.equal((await call('s3DelPano', MGR, { mapId: 's-main', id: 'x' })).reason, 'bad-pt');
    assert.equal((await call('s3DelPano', E1, { mapId: 's-main', id: 'p1' })).reason, 'del-mgr');
    const del = await call('s3DelPano', MGR, { mapId: 's-main', id: 'p1' });
    assert.equal(del.status, 'OK', del.text);
    assert.equal((await get(`b/${A}/smap/s-main/pano/p1`)).del, 1);
  });
});

// ---------------- 3. הכללים ----------------
describe('store3d-pano – חוקי Firestore ו-Storage', () => {
  const fs = (u) => (u ? env.authenticatedContext(u, { email: u + '@example.invalid' }) : env.unauthenticatedContext()).firestore();
  const st = (u) => (u ? env.authenticatedContext(u, { email: u + '@example.invalid' }) : env.unauthenticatedContext()).storage();
  const PD = (o) => Object.assign({ x: 1, y: 1, yaw: 0, nb: [], full: 'x', sm: 'x', w: 2048, h: 1024, sz: 1, ver: 1, at: 1, upd: 1 }, o);
  const base = `b/${A}/store3d/main/pano/s-main`;
  before(async () => {
    env = await H.getEnv();
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
    await seed();
    const b = adm.batch();
    b.set(adm.doc(`b/${A}/smap/s-main/pano/p1`), PD({ by: MGR }));
    // שורש: לארג' פעמי במצב legacy עם store3d
    b.set(adm.doc('b/largpeami'), { name: 'L', status: 'active', dataRoot: 'legacy', features: { store3d: true } });
    b.set(adm.doc('admins/' + RMGR), { email: 'r@x.invalid' });
    b.set(adm.doc('staff/' + RMGR), { name: 'מנהל', role: 'manager', active: true });
    b.set(adm.doc('staff/' + RE1), { name: 'עובד', role: 'employee', active: true });
    for (const u of [RMGR, RE1]) b.set(adm.doc('users/' + u), { bizId: 'largpeami', role: u === RMGR ? 'admin' : 'worker', active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(adm.doc('smap/s-main'), SMAP);
    b.set(adm.doc('smap/s-main/pano/p1'), PD({ by: RMGR }));
    await b.commit();
    await env.withSecurityRulesDisabled(async (c) => {
      const s = c.storage();
      const up = (p, n) => s.ref(p).put(new Uint8Array(n).fill(7), { contentType: 'image/jpeg' });
      await up(`${base}/p1_1.jpg`, 2000); await up(`${base}/p1_1_s.jpg`, 1000); await up(`${base}/p1_2_s.jpg`, 210000);
      await up(`${base}/p2_1.jpg`, 8000000); await up(`${base}/p3_1.jpg`, 8000001); // שלב 21ו: גבול המלאה 8,000,000
      await up(`b/biz-p3c/store3d/main/pano/s-main/p1_1.jpg`, 1000);
    });
  });

  it('Firestore בעסק: צוות (מנהל, s3m, עובד רגיל) קורא; עסק אחר / store3d כבוי / אורח – לא; כתיבה ישירה – אף אחד', async () => {
    for (const u of [MGR, DR, E1]) await assertSucceeds(fs(u).doc(`b/${A}/smap/s-main/pano/p1`).get(), u);
    await assertSucceeds(fs(E1).collection(`b/${A}/smap/s-main/pano`).get(), 'רשימה – עובד');
    for (const u of [OM, EB, null]) await assertFails(fs(u).doc(`b/${A}/smap/s-main/pano/p1`).get(), String(u));
    await assertFails(fs(OM).collection(`b/${A}/smap/s-main/pano`).get());
    for (const u of [MGR, DR, E1]) {
      await assertFails(fs(u).doc(`b/${A}/smap/s-main/pano/p2`).set(PD({ by: u })), 'create ' + u);
      await assertFails(fs(u).doc(`b/${A}/smap/s-main/pano/p1`).update({ yaw: 5 }), 'update ' + u);
      await assertFails(fs(u).doc(`b/${A}/smap/s-main/pano/p1`).delete(), 'delete ' + u);
    }
  });

  it('Firestore בשורש (לארג\' פעמי): צוות קורא; כתיבה ישירה – חסומה', async () => {
    for (const u of [RMGR, RE1]) await assertSucceeds(fs(u).doc('smap/s-main/pano/p1').get(), u);
    for (const u of [MGR, OM, null]) await assertFails(fs(u).doc('smap/s-main/pano/p1').get(), String(u));
    for (const u of [RMGR, RE1]) {
      await assertFails(fs(u).doc('smap/s-main/pano/p2').set(PD({ by: u })), 'create ' + u);
      await assertFails(fs(u).doc('smap/s-main/pano/p1').update({ yaw: 5 }), 'update ' + u);
    }
  });

  it('Storage: צוות העסק קורא את pano/ (מלאה וקטנה בגודל המותר); קטנה גדולה מדי / עסק אחר – לא; רשימה וכתיבה – אף אחד', async () => {
    const can = (p) => p.then(() => true, () => false);
    const wrong = [];
    const want = (ok, got, what) => { if (ok !== got) wrong.push(`${what}: ${got ? 'מותר' : 'נחסם'}`); };
    for (const u of [MGR, DR, E1, OM, EB, null]) {
      const ok = [MGR, DR, E1].includes(u);
      want(ok, await can(st(u).ref(`${base}/p1_1.jpg`).getMetadata()), `${u} full`);
      want(ok, await can(st(u).ref(`${base}/p1_1_s.jpg`).getMetadata()), `${u} sm`);
    }
    want(false, await can(st(MGR).ref(`${base}/p1_2_s.jpg`).getMetadata()), 'קטנה מעל 200KB');
    want(true, await can(st(E1).ref(`${base}/p2_1.jpg`).getMetadata()), 'מלאה של 8,000,000 בדיוק (שלב 21ו)');
    want(false, await can(st(E1).ref(`${base}/p3_1.jpg`).getMetadata()), 'מלאה מעל 8,000,000');
    want(false, await can(st(MGR).ref('b/biz-p3c/store3d/main/pano/s-main/p1_1.jpg').getMetadata()), 'עסק אחר – מנהל שלנו');
    want(true, await can(st(OM).ref('b/biz-p3c/store3d/main/pano/s-main/p1_1.jpg').getMetadata()), 'עסק אחר – המנהל שלו');
    for (const u of [MGR, DR, E1]) {
      want(false, await can(st(u).ref(base).listAll()), 'list ' + u);
      want(false, await can(st(u).ref(`${base}/p2_1.jpg`).put(new Uint8Array(100).fill(7), { contentType: 'image/jpeg' })), 'put ' + u);
      want(false, await can(st(u).ref(`${base}/p1_1.jpg`).delete()), 'delete ' + u);
    }
    assert.deepEqual(wrong, []);
  });

});
