'use strict';
// הקמת חנות שלב 5 (17.11.2026): s3CapCheck / s3CapDec / s3SetupLim (s3capai.js) מול האמולטור (Firestore + Storage). חלק מ-test:multibiz:4.
// Gemini = gemini-mock.js בלבד (127.0.0.1:9799) – אין פנייה החוצה. התמונות סינתטיות (JPEG מינימלי).
//   תקין נשמר (ai, ph.quad/xr/q, st, מונים), חריגה נזרקת (ונספרת, s3qid נמחק), נספר 1, מכסה מלאה עוצרת לפני Gemini, qid חוזר לא מחייב,
//   429 מוחזר, תיקון ידני (man) לא נדרס, אדם בתמונה – התמונה נמחקת, גודל המסמך עד 60,000, החלטות (מוצר, סוג ← מפה עם fx.st, העתק לרשימה),
//   s3SetupLim, והרשאות דרך הפונקציות עצמן (exports.<שם>.run, בלי אמולטור הפונקציות).
process.env.SCAN_RETRY_WAIT_MS = process.env.SCAN_RETRY_WAIT_MS || '10';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-cai', B = 'biz-caioff';
const MGR = 'cai_mgr1', E1 = 'cai_emp1', DR = 'cai_draw1', EB = 'cai_empb', EO = 'cai_other', EOFF = 'cai_off', SA = 'cai_super1';
const FEAT = { scan: true, tasks: true, store3d: true };
const FN = path.join(__dirname, '..', 'functions');
const fx = (id, o) => Object.assign({ id, k: 'gon', x: 300, y: 300, w: 200, d: 60, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }, o);
const MAP = (o) => Object.assign({ br: 'main', kind: 's', name: 'החנות', v: 1, seq: 2, grid: 50, numDir: 'rtl', src: 'manual', ent: 'd1',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 500, 0, 500, 400, 0, 400], h: 300 }], walls: [], cols: [],
  doors: [{ id: 'd1', x: 250, y: 400, w: 100, a: 0, k: 'ent' }], syms: [{ id: 'y1', k: 'cash', x: 400, y: 350, a: 0 }],
  fx: [fx('f1', { x: 200, y: 150, w: 200, bays: 2 }), fx('f2', { x: 350, y: 250, w: 100, bays: 1, hi: true, num: 2 })] }, o);
function jpeg(w, h, size) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const b = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
  return Buffer.concat([b, Buffer.alloc(Math.max(0, (size || 0) - b.length))]).toString('base64');
}
const IMG = jpeg(1200, 900, 4000), TH = jpeg(320, 240, 500), FR = jpeg(2048, 600, 5000);
let qn = 0;
const qid = () => 'a' + Date.now().toString(36) + '-' + (qn++).toString().padStart(12, '0');
const T0 = 1800000000000;

let env, adm;
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
  b.set(adm.doc('superadmins/' + SA), {});
  b.set(adm.doc(`b/${A}/smap/s-main`), map || MAP());
  await b.commit();
}

describe('s3capai – בדיקה חכמה, "המערכת מציעה" ומכסת הקמה (ליבה מול האמולטור)', () => {
  let X, C, db, bucket;
  const drw = { uid: DR, bizId: A, brs: null, mgr: false }, mgr = { uid: MGR, bizId: A, brs: null, mgr: true };
  const deps = (o) => Object.assign({ base: 'http://127.0.0.1:' + GM.PORT, key: 'test-key', userMax: 400, bucket, send: async () => [] }, o);
  const err = async (p) => { try { await p; } catch (e) { return (e.details && e.details.reason) || e.code || e.message; } return 'OK'; };
  const put = (o, who) => C.capPut(db, who || drw, Object.assign({ qid: qid(), mapId: 's-main' }, o), T0, bucket);
  const check = (o, d, who, now) => X.checkCore(db, who || drw, Object.assign({ qid: qid(), mapId: 's-main', key: 'b_f1-a-1' }, o), now || T0 + 1000, deps(d));
  const dec = (o, who) => X.decCore(db, who || drw, Object.assign({ qid: qid(), mapId: 's-main', key: 'b_f1-a-1' }, o), T0 + 5000);
  const cap = (k) => get(`b/${A}/s3setup/s-main/cap/${k || 'b_f1-a-1'}`);
  const use = () => get(`b/${A}/s3use/s_s-main`);
  const nReq = () => GM.state.requests.filter((r) => r.kind === 's3bay').length;

  before(async () => {
    env = await H.getEnv();
    await GM.start();
    X = require(path.join(FN, 's3capai.js'))._capai;
    C = require(path.join(FN, 's3cap.js'))._cap;
    const T = require(path.join(FN, 'lib', 'tenant.js'));
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
    db = T.prefixed(adm, `b/${A}/`);
    bucket = require(require.resolve('firebase-admin/storage', { paths: [FN] })).getStorage().bucket(H.PROJECT_ID + '.appspot.com');
  });
  after(async () => { await GM.stop(); });
  beforeEach(async () => { GM.reset(); await seed(); await bucket.deleteFiles({ prefix: `b/${A}/store3d/` }).catch(() => {}); });

  it('תקין נשמר: ai (סוג, מוצרים auto/rev, diff), quad/xr/q לתמונה, ברקוד לא תקין נמחק, נספר 1, usage; qid חוזר – בלי ספירה ובלי Gemini', async () => {
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    const q = qid();
    const r = await check({ qid: q });
    assert.equal(r.ok, true); assert.equal(r.kind, 'dfr'); assert.equal(r.prods, 2);
    assert.deepEqual(r.usage, { n: 1, lim: 2 * 3 + 50, w80: false }, 'מכסה: 2 × 3 מקטעים + 50');
    const d = await cap();
    assert.equal(d.ai.ver, 'bayscan-v1'); assert.equal(d.ai.cov, 0.97); assert.deepEqual(d.ai.ends, ['l', 'r']);
    assert.deepEqual(d.ai.prods.map((p) => p.st), ['auto', 'rev']);
    assert.equal(d.ai.prods[0].bc, '7290000000011'); assert.equal(d.ai.prods[1].bc, undefined, 'ברקוד שלא עומד בתבנית – נמחק');
    const kd = d.ai.diff.find((x) => x.k === 'kind');
    assert.deepEqual([kd.was, kd.got, kd.st], ['גונדולה', 'מקרר דלתות', 'rev'], 'שינוי סוג – תמיד באישור');
    assert.equal(d.ai.diff.find((x) => x.k === 'prod').st, 'auto', 'מוצר ≥ 0.8 – נכנס לבד');
    assert.deepEqual(d.ph[0].quad, [10, 20, 990, 15, 985, 980, 12, 990]); assert.deepEqual(d.ph[0].xr, { a: 0, b: 1000 }); assert.equal(d.ph[0].q, 0.9);
    assert.equal(d.st, 'part', 'אין חזית ויש diff ממתין – לא ok');
    assert.equal((await use()).n, 1);
    assert.equal((await get(`b/${A}/s3use/b_main`)), null, 'המכסה החודשית של הסניף לא נספרת');
    const again = await check({ qid: q });
    assert.equal(again.dup, true); assert.equal((await use()).n, 1); assert.equal(nReq(), 1, 'qid חוזר – בלי Gemini');
    assert.equal(await err(check({ qid: q }, {}, mgr)), 'bad-qid', 'qid של משתמש אחר');
    // ההנחיה: ההערה היא נתון בתוך JSON, לא הוראה
    const txt = GM.state.requests[0].body.contents[0].parts[0].text;
    assert.ok(txt.startsWith('אתה בודק פריט אחד בהקמת חנות')); assert.equal(GM.state.requests[0].body.contents[0].parts.length, 2, 'הנחיה + תמונה אחת');
  });

  it('חריגה נזרקת: 81 מוצרים / סוג לא מוכר / quad של 7 / תמונה שלא נשלחה / לא JSON – bad-answer, בלי כתיבה, נספר (Gemini ענה), s3qid נמחק', async () => {
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    const base = Object.assign({}, GM.BAY_DEF);
    const bads = [
      Object.assign({}, base, { prods: Array.from({ length: 81 }, (_, i) => ({ n: 'מוצר ' + i, conf: 0.9 })) }),
      Object.assign({}, base, { kind: 'shelf' }),
      Object.assign({}, base, { photos: [{ i: 1, quad: [1, 2, 3, 4, 5, 6, 7] }] }),
      Object.assign({}, base, { photos: [{ i: 2, xr: { a: 0, b: 10 } }] }),
      Object.assign({}, base, { cov: 1.5 }),
      'not json',
    ];
    let n = 0;
    for (const v of bads) {
      GM.state.bayscan = v;
      const q = qid();
      assert.equal(await err(check({ qid: q })), 'bad-answer', JSON.stringify(v).slice(0, 60));
      n++;
      assert.equal((await use()).n, n, 'נספר');
      assert.equal(await get(`b/${A}/s3qid/${q}`), null, 's3qid נמחק – אפשר לנסות שוב');
    }
    assert.equal((await cap()).ai, undefined, 'לא נכתב כלום');
  });

  it('מכסה: מלאה עוצרת לפני Gemini (s3-setup-limit); 429 – מוחזר; 80% – w80 פעם אחת; תקרה גדלה עם המפה ולא יורדת; s3SetupLim', async () => {
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    await adm.doc(`b/${A}/s3use/s_s-main`).set({ n: 56, lim: 56, upd: 1 });
    assert.equal(await err(check()), 's3-setup-limit');
    assert.equal(nReq(), 0, 'בלי Gemini'); assert.equal((await use()).n, 56);
    GM.state.mode = 'quota';
    await adm.doc(`b/${A}/s3use/s_s-main`).set({ n: 10, lim: 56, upd: 1 });
    assert.notEqual(await err(check()), 'OK');
    assert.equal((await use()).n, 10, '429 – לא ענה ⇒ מוחזר');
    GM.state.mode = 'ok';
    await adm.doc(`b/${A}/s3use/s_s-main`).set({ n: 43, lim: 56, upd: 1 });
    let r = await check();
    assert.deepEqual(r.usage, { n: 44, lim: 56, w80: false }, '44/56 = 78%');
    r = await check();
    assert.equal(r.usage.w80, true); assert.equal((await use()).w80, true);
    assert.ok(await get(`b/${A}/s3ntf/s-main_sw80`), 'push למנהלים פעם אחת');
    // המפה גדלה: 2 × (3 + 10) + 50 = 76 – התקרה עולה; ירידה – לא
    await adm.doc(`b/${A}/smap/s-main`).set(MAP({ fx: MAP().fx.concat([fx('f3', { x: 100, y: 300, bays: 10, num: 3 })]) }));
    r = await check();
    assert.equal(r.usage.lim, 76); assert.equal(r.usage.w80, false, 'מתחת ל-80% מהתקרה החדשה');
    await adm.doc(`b/${A}/smap/s-main`).set(MAP());
    assert.equal((await check()).usage.lim, 76, 'לא יורדת');
    // s3SetupLim: מנהל־על קובע – לא מחושבת מחדש; n לא משתנה
    const L = await X.limCore(db, { uid: SA, bizId: A }, { qid: qid(), mapId: 's-main', lim: 47 }, T0 + 9000);
    assert.deepEqual([L.n, L.lim, L.was], [47, 47, 76]);
    const u = await use();
    assert.deepEqual([u.n, u.lim, u.limBy, u.limAt], [47, 47, SA, T0 + 9000]);
    assert.equal(await err(check()), 's3-setup-limit', 'lim = n ⇒ חסום');
    await X.limCore(db, { uid: SA, bizId: A }, { qid: qid(), mapId: 's-main', lim: 200 }, T0 + 9500);
    assert.equal((await use()).w80, false, 'w80 מתאפס מתחת ל-80%');
    assert.equal((await check()).usage.lim, 200, 'תקרה ידנית לא משתנה עם המפה');
    assert.equal(await err(X.limCore(db, { uid: SA, bizId: A }, { qid: qid(), mapId: 's-main', lim: 100001 }, 1)), 'bad-lim');
    assert.equal(await err(X.limCore(db, { uid: SA, bizId: A }, { qid: qid(), mapId: 's-none', lim: 5 }, 1)), 'no-map');
  });

  it('תיקון ידני (op geo, man:1) לא נדרס; אדם בתמונה – התמונה נמחקת מ-ph ומ-Storage, retake; פריט שדולג / בלי תמונות – נדחה', async () => {
    assert.equal(await err(check()), 'no-photos');
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    await put({ key: 'b_f1-a-1', op: 'geo', n: 1, xr: { a: 100, b: 600 } });
    let d = await cap();
    assert.equal(d.ph[0].man, 1, 'geo מסמן man');
    GM.state.bayscan = Object.assign({}, GM.BAY_DEF, { photos: [{ i: 1, quad: [0, 0, 1000, 0, 1000, 1000, 0, 1000], xr: { a: 0, b: 500 }, q: 0.7 }, { i: 2, xr: { a: 400, b: 1000 }, q: 0.8 }] });
    await check();
    d = await cap();
    assert.deepEqual(d.ph[0].xr, { a: 100, b: 600 }, 'man – xr לא נדרס'); assert.equal(d.ph[0].quad, undefined); assert.equal(d.ph[0].q, 0.7, 'q כן');
    assert.deepEqual(d.ph[1].xr, { a: 400, b: 1000 });
    GM.state.bayscan = Object.assign({}, GM.BAY_DEF, { per: [2], retake: 'יש אדם בתמונה – צלמו שוב' });
    const r = await check();
    assert.equal(r.per, 1); assert.equal(r.retake, 'יש אדם בתמונה – צלמו שוב');
    d = await cap();
    assert.deepEqual(d.ph.map((p) => p.n), [1]);
    const [files] = await bucket.getFiles({ prefix: `b/${A}/store3d/main/cap/s-main/b_f1-a-1_2` });
    assert.equal(files.length, 0, 'הקבצים של התמונה עם האדם נמחקו');
    await put({ key: 'b_f1-a-1', op: 'skip', why: 'אין גישה' });
    assert.equal(await err(check()), 'skipped');
  });

  it('סבב בדיקה 1, ליקוי 1: אדם בתמונה כשכבר יש חזית – הפריט נשאר part, החזית מסומנת frRe ויורדת מהדגם (s3sum / s3look); חזית חדשה + בדיקה נקייה ⇒ ok', async () => {
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    await put({ key: 'b_f1-a-1', op: 'front', img: FR, th: TH, man: true });
    let d = await cap();
    assert.equal(d.st, 'ok', 'חזית ידנית מאושרת');
    const sum0 = await get(`b/${A}/s3sum/s-main`);
    assert.equal(sum0.b['f1-a-1'].fr, d.frTh);
    GM.state.bayscan = Object.assign({}, GM.BAY_DEF, { kind: 'gon', per: [2], retake: '' });
    const r = await check();
    assert.deepEqual([r.st, r.frRe, r.per], ['part', 1, 1]);
    d = await cap();
    assert.deepEqual([d.st, d.frRe, d.frV, d.okBy], ['part', 1, 1, undefined], 'לא ok, האישור הידני בטל');
    assert.match(d.ai.retake, /אדם/);
    const sum1 = await get(`b/${A}/s3sum/s-main`);
    assert.equal(sum1.b['f1-a-1'].fr, undefined, 'החזית לא מוצגת בדגם'); assert.equal(sum1.b['f1-a-1'].frT, undefined);
    assert.equal((await get(`b/${A}/s3setup/s-main`)).capOk, 0);
    // החלטה ב"המערכת מציעה" לא מחזירה ok לחזית שסומנה
    await dec({ at: d.ai.at, k: 'prod', i: 0, st: 'ok' });
    assert.equal((await cap()).st, 'part');
    // חזית חדשה (frV 2) ובדיקה נקייה ⇒ ok
    await put({ key: 'b_f1-a-1', op: 'front', img: FR, th: TH, man: false });
    GM.state.bayscan = Object.assign({}, GM.BAY_DEF, { kind: 'gon', diff: [] });
    assert.equal((await check()).st, 'ok');
    // קיר: אותו דבר מול s3look
    await put({ key: 'd_d1', op: 'ph', img: IMG, th: TH });
    await put({ key: 'd_d1', op: 'front', img: FR, th: TH, man: true });
    assert.ok((await get(`b/${A}/s3look/s-main`)).it.d_d1);
    GM.state.bayscan = Object.assign({}, GM.BAY_DEF, { per: [1] });
    assert.equal((await check({ key: 'd_d1' })).st, 'part');
    assert.equal((await get(`b/${A}/s3look/s-main`)).it.d_d1, undefined, 's3look בלי הפריט');
  });

  it('סבב בדיקה 1, ליקוי 2: מוצר בלי שם נעלם, שאר המוצרים נשמרים, והבדיקה נספרת פעם אחת', async () => {
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    GM.state.bayscan = Object.assign({}, GM.BAY_DEF, { prods: [{ conf: 0.9, cat: 'כוסות' }, { n: '', conf: 0.95 }, { n: 'מפיות לבנות', conf: 0.85 }] });
    const r = await check();
    assert.deepEqual([r.ok, r.prods, r.noName], [true, 1, 2]);
    const d = await cap();
    assert.deepEqual(d.ai.prods.map((p) => p.n + ':' + p.st), ['מפיות לבנות:auto']);
    assert.equal((await use()).n, 1);
  });

  it('גודל המסמך: מוצרים עם טקסטים ארוכים – נשמר עד 60,000 בתים, בביטחון הנמוך מוצאים קודם, ai.cut', async () => {
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    // 80 מוצרים בגבולות השדות הם כ-40KB; כדי לבדוק את רשת הביטחון – שדה עזר גדול במסמך (במציאות: frH, ph וכו')
    await adm.doc(`b/${A}/s3setup/s-main/cap/b_f1-a-1`).set({ pad: 'x'.repeat(30000) }, { merge: true });
    const long = 'א'.repeat(60);
    GM.state.bayscan = Object.assign({}, GM.BAY_DEF, { diff: [], prods: Array.from({ length: 80 }, (_, i) => ({ n: long + i, brand: long, var: long, size: 'ב'.repeat(20), cat: 'ג'.repeat(30), conf: i < 40 ? 0.5 : 0.95 })) });
    await check();
    const d = await cap();
    const CA = require(path.join(FN, 'lib', 'store3d-capai.js'));
    assert.ok(CA.sizeOf(d) <= 60000, 'עד 60,000');
    assert.ok(d.ai.cut > 0 && d.ai.prods.length === 80 - d.ai.cut);
    assert.ok(d.ai.prods.every((p) => p.conf === 0.95) || d.ai.prods.filter((p) => p.conf === 0.95).length === 40, 'הנמוכים הוצאו קודם');
  });

  it('החלטות: מוצר (ביטול), סוג שאושר ← המפה (fx.st + k בסיסי, גרסה קודמת ב-ver), ok אחרי חזית; at ישן נדחה; העתק לרשימה – מנהל בלבד, רק הוספה', async () => {
    await put({ key: 'b_f1-a-1', op: 'ph', img: IMG, th: TH });
    await put({ key: 'b_f1-a-1', op: 'front', img: FR, th: TH, man: false });
    await check();
    let d = await cap();
    const at = d.ai.at;
    assert.equal(d.st, 'part');
    assert.equal(await err(dec({ at: at - 1, k: 'prod', i: 0, st: 'no' })), 'stale-ai');
    let r = await dec({ at, k: 'prod', i: 0, st: 'no' });
    assert.equal(r.st, 'no'); assert.equal((await cap()).ai.prods[0].st, 'no', 'ביטול של מוצר שנכנס לבד');
    await dec({ at, k: 'prod', i: 0, st: 'ok' });
    const ki = d.ai.diff.findIndex((x) => x.k === 'kind');
    r = await dec({ at, k: 'diff', i: ki, st: 'ok' });
    assert.equal(r.mapV, 2);
    const m = await get(`b/${A}/smap/s-main`);
    const f1 = m.fx.find((f) => f.id === 'f1');
    assert.deepEqual([f1.k, f1.st, f1.glass], ['fridge', 'dfr', true], 'סוג מפורט ב-st, k בסיסי');
    assert.ok(await get(`b/${A}/smap/s-main/ver/000001`), 'הגרסה הקודמת נשמרה');
    d = await cap();
    assert.equal(d.ai.diff[ki].st, 'ok'); assert.equal(d.ai.diff[ki].by, DR);
    assert.equal(d.st, 'ok', 'חזית + כיסוי 0.97 + שני קצוות + בלי diff ממתין');
    assert.equal((await get(`b/${A}/s3setup/s-main`)).capOk, 1);
    // העתק לרשימה
    assert.equal(await err(dec({ at, k: 'exp' })), 'not-mgr');
    await adm.doc(`b/${A}/smap/s-main/bay/f1-a-1`).set({ exp: [{ n: 'כוסות קרטון 250 מ"ל', c: 'ישן', q: 3 }, { n: 'צלחות' }], upd: 1, by: MGR });
    r = await dec({ at, k: 'exp' }, mgr);
    assert.equal(r.added, 0, 'מוצר שכבר ברשימה – לא נוסף; rev – לא נוסף');
    const b = await get(`b/${A}/smap/s-main/bay/f1-a-1`);
    assert.deepEqual(b.exp[0], { n: 'כוסות קרטון 250 מ"ל', c: 'ישן', q: 3 }, 'רשומה קיימת לא השתנתה');
    await dec({ at, k: 'prod', i: 1, st: 'ok' });
    r = await dec({ at, k: 'exp' }, mgr);
    assert.equal(r.added, 1); assert.equal((await get(`b/${A}/smap/s-main/bay/f1-a-1`)).exp[2].n, 'מפיות לבנות');
    assert.equal(await err(dec({ at, k: 'diff', i: 0, st: 'maybe' })), 'bad-input');
  });

  // ---------- הרשאות דרך הפונקציות עצמן (exports.<שם>.run, בלי אמולטור הפונקציות) ----------
  it('הרשאות: מנהל ו-s3m – מותר; בלי s3m / סניף אחר / עסק אחר / תוסף כבוי / עובד מושבת – נדחה; s3SetupLim – מנהל־על בלבד', async () => {
    const IX = require(path.join(FN, 'index.js'));
    const call = async (name, uid, data, biz) => {
      try { await IX[name].run({ auth: { uid, token: { uid } }, data: Object.assign({ bizId: biz || A }, data), rawRequest: { headers: {} } }); return 'OK'; }
      catch (e) { return (e.details && e.details.reason) || e.code; }
    };
    const IN = { s3CapCheck: () => ({ qid: qid(), mapId: 's-main', key: 'b_f1-a-1' }), s3CapDec: () => ({ qid: qid(), mapId: 's-main', key: 'b_f1-a-1', k: 'prod', i: 0, st: 'no', at: 5 }) };
    const PASS = { s3CapCheck: 'no-photos', s3CapDec: 'stale-ai' };   // עבר את ההרשאה ונעצר בבדיקה הבאה
    for (const fn of Object.keys(IN)) {
      assert.equal(await call(fn, MGR, IN[fn]()), PASS[fn], fn + ' מנהל');
      assert.equal(await call(fn, DR, IN[fn]()), PASS[fn], fn + ' s3m');
      assert.equal(await call(fn, E1, IN[fn]()), 'not-s3m', fn + ' בלי s3m');
      assert.equal(await call(fn, EO, IN[fn]()), 'other-branch', fn + ' סניף אחר');
      assert.equal(await call(fn, EB, IN[fn]()), 'foreign-biz', fn + ' עסק אחר');
      assert.equal(await call(fn, EB, IN[fn](), B), 'feature-off', fn + ' תוסף כבוי');
      assert.equal(await call(fn, EOFF, IN[fn]()), 'staff-disabled', fn + ' עובד מושבת');
    }
    const LI = () => ({ qid: qid(), mapId: 's-main', lim: 300 });
    for (const u of [MGR, DR, E1]) assert.equal(await call('s3SetupLim', u, LI()), 'not-superadmin', 's3SetupLim ' + u);
    assert.equal(await call('s3SetupLim', SA, LI()), 'OK', 'מנהל־על');
    assert.equal((await use()).lim, 300);
    assert.equal(await call('s3SetupLim', SA, LI(), B), 'feature-off');
  });
});
