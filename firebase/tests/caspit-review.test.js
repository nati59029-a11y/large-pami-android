'use strict';
// סנכרון כספית – תיקונים אחרי בדיקה עצמאית סבב 1 (26.11.2026), מול האמולטור. חלק מ-test:multibiz:3. כל הנתונים מומצאים.
//   ליקוי 2: עדכון לכספית – שדה שלא השתנה נשלח עם הערך של כספית ולא מסומן pd; שינוי שם של קטגוריה לא מוציא את מוצריה.
//   ליקוי 3: נרמול כמו בכספית (שם ארוך נקלט, לא חוזר לעד); שורה שנשלחה 3 פעמים בלי להיקלט – לא נשלחת שוב ולא חוסמת אחרות.
//   ליקוי 4: cxCode new עם שם ומחיר זהים לקוד הישן – הקטלוג לא מאחד, הקישור לקוד החדש נוצר.
//   ליקוי 5: קוד ישן של מוצר אחר – חסום (המכירות שלו נשארות למוצר המקורי).
//   ליקוי 6: קטגוריה מכספית בשם שכבר קיים באפליקציה (מזהה ישן) – לא נוצרת כפולה.
// מבוסס על סקריפט הבודק (rv.test.js).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./helpers');

const A = 'biz-rv', MGR = 'r_mgr';
const FN = path.join(H.ROOT, 'functions');
let FX, env, adm, CC, n = 0;
async function call(name, uid, data) { FX = FX || require('../functions/index.js'); try { return { status: 'OK', result: await FX[name].run({ auth: { uid, token: { uid } }, data: data || {}, rawRequest: { headers: {} } }) }; } catch (e) { return { status: e.code || 'ERR', reason: e.details && e.details.reason, text: String(e.message) }; } }
const ok = async (nm, d) => { const r = await call(nm, MGR, d); assert.equal(r.status, 'OK', nm + ': ' + r.text); return r.result; };
const run = () => 'rvrun' + Date.now().toString(36) + (n++) + 'zz';
const P = (id) => adm().doc(`b/${A}/prod/${id}`);
const X = async (c) => (await adm().doc(`b/${A}/cxItem/${c}`).get()).data();
const HDR = ['קוד פריט', 'שם פריט', 'ברקוד', 'ספק', 'קטגוריה ראשית', 'קטגוריה משנית', 'מחיר עלות', 'מחיר לצרכן', 'פריט ללא מעמ'];
const r = (c, nm, bc, p, c1, c2) => [c, nm, bc || '', 'ללא ספק', c1 || '', c2 || '', 0, p, 'לא'];
async function sync(rows) { const g = CC.groupCat([HDR].concat(rows)); const id = run(); await ok('cxUpload', { run: id, part: 0, parts: 1, items: g.items }); const pv = await ok('cxPreview', { run: id }); const a = await ok('cxApply', { run: id, take: 'app' }); return { pv, a }; }
const LONG = 'מוצר עם שם ארוך מאוד מאוד מאוד שעובר את שישים התווים של כספית בהחלט כן';
const CUT = () => require('../functions/lib/caspit-core.js').fxNorm('nm', LONG);
let rowsNow;
const BASE = () => [r('400001', 'מחק', '7100000000042', 2), r('400002', 'עפרון', '7100000000059', 3, 'כתיבה'), r('400003', 'דבק', '7100000000066', 4), r('400004', 'קערה', '7100000000073', 9, 'כלים')];

before(async () => {
  env = await H.getEnv(); process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
  CC = require('../functions/lib/caspit-core.js'); FX = FX || require('../functions/index.js');
  adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const b = d.batch();
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { orders: true }, org: { v: 1, branches: [], banks: [], cards: [] } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
    b.set(d.doc('users/' + MGR), { bizId: A, role: 'admin', active: true, bizStatus: 'active', email: 'm@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/cat/catold`), { name: 'משרד', ord: 0 }); // קטגוריה ששמה שונה בעבר – המזהה אינו גיבוב של השם
    b.set(d.doc(`b/${A}/cat/catk`), { name: 'כלים', ord: 0 });
    const pr = [['pa', 'מחק', 2, '7100000000042', '400001'], ['pb', 'עפרון', 3, '7100000000059', '400002'], ['pc', 'דבק', 4, '7100000000066', '400003'], ['pk', 'קערה', 9, '7100000000073', '400004', 'catk']];
    for (const [id, nm, p, bc, c, cat] of pr) {
      b.set(d.doc(`b/${A}/prod/${id}`), Object.assign({ name: nm, price: p, barcode: bc, on: true, q: {}, cx: c, sku: c, at: 1 }, cat ? { cat } : {}));
      b.set(d.doc(`b/${A}/cxItem/${c}`), { c, pid: id, st: 'link', n: nm, pr: { fb: p, ab: p }, co: { fb: null, ab: null }, run: 'old', at: 1 });
    }
    b.set(d.doc(`b/${A}/cxcfg/main`), { last: { run: 'old', at: 1 }, gen: 0, cats: [1], bak: { id: 'x', n: 4, at: 1 }, updOk: true });
    b.set(d.doc(`b/${A}/cxcfg/seen`), { codes: ['400001', '400002', '400003', '400004'] });
    await b.commit();
  });
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('כספית – תיקונים אחרי בדיקה סבב 1', () => {
  it('בסיס: שני סנכרונים', async () => { await sync(BASE()); await sync(BASE()); rowsNow = BASE(); });
  it('ליקוי 3: שם ארוך מ-60 – נשלח, כספית מקצרת, נקלט (ack) ולא נשלח שוב', async () => {
    await P('pc').update({ name: LONG });
    assert.equal((await ok('cxExport', { kind: 'upd' })).n, 1);
    rowsNow[2] = r('400003', LONG, '7100000000066', 4); // כספית מחזירה את השם מקוצר (clean)
    const { pv } = await sync(rowsNow);
    assert.equal(pv.cnt.fx['nm:ack'], 1, JSON.stringify(pv.cnt.fx));
    const x = await X('400003');
    assert.equal(x.nm.pd, undefined); assert.equal(x.nm.ab, CUT()); assert.ok(CUT().length === 60 && CUT().endsWith('…'));
    assert.equal((await ok('cxExport', { kind: 'upd' })).n, 0);
    assert.equal((await P('pc').get()).get('name'), LONG, 'השם המלא באפליקציה לא נדרס');
  });
  it('ליקוי 2: שינוי שם בלבד – רק השם נשלח ומסומן pd; הקטגוריה והברקוד ריקים ("עדכון פריטים": ריק = לא משתנה בכספית)', async () => {
    await P('pb').update({ name: 'עפרון HB' }); // באפליקציה אין קטגוריה, בכספית "כתיבה" (keep)
    const e = await ok('cxExport', { kind: 'upd' });
    assert.deepEqual(e.rows.map((x) => [x.c, x.f]), [['400002', ['nm']]]);
    const L = e.csv.slice(1).split('\n')[1].split(',');
    assert.equal(L[CC.HDR_UPD.indexOf('שם קטגוריה ראשית')], '', 'ריק – לא משתנה בכספית (במקום לשלוח את הערך של כספית)');
    assert.equal(L[CC.HDR_UPD.indexOf('שם פריט')], 'עפרון HB');
    const x = await X('400002');
    assert.equal(x.nm.pd, 'עפרון HB'); assert.equal(x.ct.pd, undefined); assert.equal(x.bc.pd, undefined);
  });
  it('ליקוי 2 + 6: כספית שינתה את הקטגוריה (שם שכבר קיים באפליקציה) – נקלט כשינוי מכספית, לקטגוריה הקיימת, בלי כפולה', async () => {
    rowsNow[1] = r('400002', 'עפרון', '7100000000059', 3, 'משרד');
    const { pv } = await sync(rowsNow);
    assert.equal(pv.cnt.fx['ct:in'], 1, JSON.stringify(pv.cnt.fx));
    assert.equal((await P('pb').get()).get('cat'), 'catold');
    const cats = (await adm().collection(`b/${A}/cat`).get()).docs.filter((d) => d.get('name') === 'משרד');
    assert.equal(cats.length, 1, 'בלי קטגוריה כפולה');
  });
  it('ליקוי 2: שינוי שם של קטגוריה באפליקציה לא מוציא את מוצריה לכספית', async () => {
    await adm().doc(`b/${A}/cat/catk`).update({ name: 'כלי מטבח' });
    const e = await ok('cxExport', { kind: 'upd', max: 10 });
    assert.ok(!e.rows.some((x) => x.c === '400004'), JSON.stringify(e.rows));
  });
  it('ליקוי 3: שורה שנשלחה 3 פעמים בלי להיקלט – לא נשלחת שוב, מסומנת stuck ולא נספרת למגבלה', async () => {
    // סבב בדיקה 1 (עדכון פריטים): הפקת הקובץ לא מעלה את המונה – רק דיווח טעינה אמיתי מהתוסף (caspit-bot.test). כאן: כאילו נטען 3 פעמים
    assert.equal((await X('400002')).uq, undefined, 'הופק פעמיים, לא נטען – המונה לא עלה');
    await adm().doc(`b/${A}/cxItem/400002`).update({ uq: 3 });
    await sync(rowsNow);
    await P('pa').update({ name: 'מחק לבן' });
    const e = await ok('cxExport', { kind: 'upd', max: 1 });
    assert.deepEqual(e.rows.map((x) => x.c), ['400001'], 'השורה התקועה לא חוסמת');
    assert.equal(e.stuckN, 1); assert.equal(e.stuck[0].c, '400002');
    rowsNow[0] = r('400001', 'מחק לבן', '7100000000042', 2); rowsNow[1] = r('400002', 'עפרון HB', '7100000000059', 3, 'משרד');
    await sync(rowsNow);
    assert.equal((await X('400002')).uq, undefined, 'נקלט – המונה מתאפס');
  });
  it('ליקוי 4: cxCode new בשם ומחיר זהים לקוד הישן – הקטלוג לא מאחד, הקוד החדש מקושר בקליטה', async () => {
    const c = await ok('cxCode', { pid: 'pa', code: '888888' });
    assert.equal(c.mode, 'new');
    const rows = rowsNow.slice(); rows[0] = r('400001', 'מחק זהה', '7100000000042', 2); rows.push(r('888888', 'מחק זהה', '', 2)); // אותו שם ואותו מחיר
    const { pv } = await sync(rows);
    assert.deepEqual([pv.cnt.old, pv.cnt.merged, pv.cnt.nw], [1, 0, 0], JSON.stringify(pv.cnt));
    const x = await X('888888');
    assert.equal(x.nw, undefined); assert.equal(x.pid, 'pa');
  });
  it('ליקוי 5: קוד ישן של מוצר אחר – חסום; הקוד הישן עדיין למוצר המקורי (מכירות)', async () => {
    const d = await call('cxCode', MGR, { pid: 'pb', code: '400001' });
    assert.equal(d.reason, 'code-taken');
    const x = await X('400001');
    assert.deepEqual([x.old, x.pid, x.to], [true, 'pa', '888888']);
  });
});
