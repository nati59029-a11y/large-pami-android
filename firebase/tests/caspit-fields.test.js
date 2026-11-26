'use strict';
// סנכרון כספית – שם / ברקוד ראשי / קטגוריה בשני הכיוונים, ושינוי קוד כספית (26.11.2026, functions/caspit.js) מול האמולטור. חלק מ-test:multibiz:3. כל הנתונים מומצאים.
//   - מעבר בטוח: פריט מלפני השדרוג (בלי nm/bc/ct) – בסנכרון הראשון רק רישום בסיס, בלי שינוי באף צד; אחר כך הבדל קבוע – לא נוגעים (keep).
//   - מכספית (in, עם היסטוריה, קטגוריה חסרה נוצרת), מהאפליקציה (cxExport upd + מגבלה), כספית קלטה (ack), התנגשות (האפליקציה קובעת), ברקוד של מוצר אחר – לא משנים.
//   - cxCode: קוד מקושר למוצר אחר – חסימה; קוד קיים בכספית – קישור (הקטלוג מדלג על הקוד הישן, בלי מוצר כפול); קוד חדש – פריט חדש בקוד החדש.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./helpers');

const A = 'biz-cf';
const MGR = 'f_mgr', E1 = 'f_e1';
const FN = path.join(H.ROOT, 'functions');
let FX;
async function call(name, uid, data) {
  FX = FX || require('../functions/index.js');
  try { return { status: 'OK', result: await FX[name].run({ auth: uid ? { uid, token: { uid } } : null, data: data || {}, rawRequest: { headers: {} } }) }; } catch (e) {
    return { status: (e && e.code) || 'ERR', reason: e && e.details && e.details.reason, text: String(e && e.message).slice(0, 300) };
  }
}
const ok = async (name, uid, data) => { const r = await call(name, uid, data); assert.equal(r.status, 'OK', name + ': ' + r.text); return r.result; };
let env, adm, CC; let n = 0;
const run = () => 'cfrun' + Date.now().toString(36) + (n++) + 'zz';
const P = (id) => adm().doc(`b/${A}/prod/${id}`);
const X = async (c) => (await adm().doc(`b/${A}/cxItem/${c}`).get()).data();
const HDR = ['קוד פריט', 'שם פריט', 'ברקוד', 'ספק', 'קטגוריה ראשית', 'קטגוריה משנית', 'מחיר עלות', 'מחיר לצרכן', 'פריט ללא מעמ'];
const r = (c, nm, bc, p, c1, c2) => [c, nm, bc || '', 'ללא ספק', c1 || '', c2 || '', 0, p, 'לא'];
async function sync(rows) {
  const g = CC.groupCat([HDR].concat(rows)); const id = run();
  await ok('cxUpload', MGR, { run: id, part: 0, parts: 1, items: g.items });
  const pv = await ok('cxPreview', MGR, { run: id });
  const a = await ok('cxApply', MGR, { run: id, take: 'app' });
  return { pv, a };
}
const logs = async (pid, k) => (await adm().collection(`b/${A}/priceLog`).where('prod', '==', pid).get()).docs.map((d) => d.data()).filter((x) => x.k === k).map((x) => [x.old, x.new, x.src]);
const BASE = () => [r('300001', 'עט כחול חדש', '7100000000011', 5), r('300002', 'מחברת', '7100000000099', 8), r('300003', 'סרגל', '7100000000035', 3, 'כלי כתיבה'), r('300004', 'מחק', '7100000000042', 2)];

before(async () => {
  env = await H.getEnv();
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
  CC = require('../functions/lib/caspit-core.js');
  FX = FX || require('../functions/index.js'); // מאתחל את firebase-admin
  adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const b = d.batch();
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { orders: true }, org: { v: 1, branches: [], banks: [], cards: [] } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
    b.set(d.doc('users/' + MGR), { bizId: A, role: 'admin', active: true, bizStatus: 'active', email: MGR + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true });
    b.set(d.doc('users/' + E1), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: E1 + '@x.invalid', createdAt: 1 });
    const pr = [['pa', 'עט כחול', 5, '7100000000011', '300001'], ['pb', 'מחברת', 8, '7100000000028', '300002'], ['pc', 'סרגל', 3, '7100000000035', '300003'], ['pd', 'מחק', 2, '7100000000042', '300004']];
    for (const [id, nm, p, bc, c] of pr) {
      b.set(d.doc(`b/${A}/prod/${id}`), { name: nm, price: p, barcode: bc, on: true, q: {}, cx: c, sku: c, at: 1 });
      // cxItem מלפני השדרוג – רק pr/co
      b.set(d.doc(`b/${A}/cxItem/${c}`), { c, pid: id, st: 'link', n: nm, pr: { fb: p, ab: p }, co: { fb: null, ab: null }, run: 'old', at: 1 });
    }
    b.set(d.doc(`b/${A}/cxcfg/main`), { last: { run: 'old', at: 1 }, gen: 0, cats: [1] });
    b.set(d.doc(`b/${A}/cxcfg/seen`), { codes: ['300001', '300002', '300003', '300004', '300009'] });
    await b.commit();
  });
  // גיבוי לפני אישור ראשון כבר "נעשה" (העסק סונכרן לפני השדרוג)
  await adm().doc(`b/${A}/cxcfg/main`).set({ bak: { id: 'x', n: 4, at: 1 } }, { merge: true });
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('כספית: שם / ברקוד / קטגוריה, ושינוי קוד (26.11)', () => {
  it('מעבר בטוח: בלי בסיס לשדה – רק רישום בסיס, שום צד לא משתנה; קובץ עדכוני פריטים ריק', async () => {
    const { pv, a } = await sync(BASE());
    assert.equal(pv.cnt.fx['nm:base0'], 4); assert.equal(pv.cnt.fx['bc:base0'], 4); assert.equal(pv.cnt.fx['ct:base0'], 4);
    assert.deepEqual([a.res.fin, a.res.fout, a.res.bdup], [0, 0, 0]);
    assert.equal((await P('pa').get()).get('name'), 'עט כחול');
    assert.equal((await P('pb').get()).get('barcode'), '7100000000028');
    assert.equal((await P('pc').get()).get('cat'), undefined);
    assert.deepEqual((await X('300001')).nm, { fb: 'עט כחול חדש', ab: 'עט כחול' });
    assert.deepEqual((await X('300002')).bc, { fb: '7100000000099', ab: '7100000000028' });
    assert.deepEqual((await X('300003')).ct, { fb: 'כלי כתיבה', ab: null });
    assert.equal((await logs('pa', 'n')).length, 0);
    const e = await ok('cxExport', MGR, { kind: 'upd' });
    assert.equal(e.n, 0);
  });
  it('הבדל קבוע שאף צד לא שינה מאז הבסיס – לא נוגעים (keep), ולא יוצא לכספית', async () => {
    const { pv } = await sync(BASE());
    assert.equal(pv.cnt.fx['nm:keep'], 1); assert.equal(pv.cnt.fx['bc:keep'], 1); assert.equal(pv.cnt.fx['ct:keep'], 1);
    assert.equal((await P('pa').get()).get('name'), 'עט כחול');
    assert.equal((await ok('cxExport', MGR, { kind: 'upd' })).n, 0);
  });
  it('מכספית לאפליקציה: שם שהשתנה בכספית (היסטוריה), קטגוריה חדשה נוצרת', async () => {
    const rows = BASE(); rows[0] = r('300001', 'עט כחול 2', '7100000000011', 5); rows[2] = r('300003', 'סרגל', '7100000000035', 3, 'משרד', 'סרגלים');
    const { a } = await sync(rows);
    assert.equal(a.res.fin, 2);
    assert.equal((await P('pa').get()).get('name'), 'עט כחול 2');
    assert.deepEqual(await logs('pa', 'n'), [['עט כחול', 'עט כחול 2', 'caspit']]);
    const pc = (await P('pc').get()).data();
    assert.equal((await adm().doc(`b/${A}/cat/${pc.cat}`).get()).get('name'), 'משרד');
    assert.equal((await adm().doc(`b/${A}/cat/${pc.sub}`).get()).get('name'), 'סרגלים');
    assert.deepEqual((await X('300001')).nm, { fb: 'עט כחול 2', ab: 'עט כחול 2' });
  });
  it('מהאפליקציה לכספית: שינוי שם במוצר (כמו עריכת מוצר / מדבקות) → cxExport upd; מעל המגבלה – limit בלי סימון; כספית קלטה → ack', async () => {
    await P('pb').update({ name: 'מחברת A4' }); // עריכת מוצר שומרת ל-prod
    const lim = await call('cxExport', MGR, { kind: 'upd', max: 0 });
    assert.equal(lim.reason, 'limit');
    assert.equal((await X('300002')).nm.pd, undefined);
    const e = await ok('cxExport', MGR, { kind: 'upd' });
    assert.equal(e.n, 1);
    const L = e.csv.slice(1).split('\n');
    assert.equal(L[0], CC.HDR_NEW.join(','));
    assert.ok(L[1].startsWith('300002,7100000000028,מחברת A4,,,8,'), L[1]);
    assert.deepEqual(e.rows[0].f, ['nm']);
    assert.equal((await X('300002')).nm.pd, 'מחברת A4');
    const rows = BASE(); rows[0] = r('300001', 'עט כחול 2', '7100000000011', 5); rows[1] = r('300002', 'מחברת A4', '7100000000028', 8); rows[2] = r('300003', 'סרגל', '7100000000035', 3, 'משרד', 'סרגלים');
    const { pv } = await sync(rows);
    assert.equal(pv.cnt.fx['nm:ack'], 1);
    const x2 = await X('300002');
    assert.equal(x2.nm.pd, undefined); assert.equal(x2.nm.ab, 'מחברת A4');
    assert.equal((await ok('cxExport', MGR, { kind: 'upd' })).n, 0);
  });
  it('התנגשות: שם השתנה בשני הצדדים – האפליקציה קובעת, הערך של כספית בהיסטוריה, ויוצא לכספית', async () => {
    await P('pa').update({ name: 'עט A' });
    const rows = BASE(); rows[0] = r('300001', 'עט B', '7100000000011', 5); rows[1] = r('300002', 'מחברת A4', '7100000000028', 8); rows[2] = r('300003', 'סרגל', '7100000000035', 3, 'משרד', 'סרגלים');
    const { pv, a } = await sync(rows);
    assert.equal(pv.cnt.fx['nm:conf'], 1); assert.equal(a.res.fout, 1);
    assert.equal((await P('pa').get()).get('name'), 'עט A');
    assert.deepEqual((await logs('pa', 'n')).filter((x) => x[2] === 'conf'), [['עט B', 'עט A', 'conf']]);
    assert.equal((await X('300001')).nm.pd, 'עט A');
    const e = await ok('cxExport', MGR, { kind: 'upd' });
    assert.deepEqual(e.rows.map((x) => x.c), ['300001']);
  });
  it('ברקוד מכספית שכבר שייך למוצר אחר באפליקציה – לא משנים, מסומן לבדיקה (ושוב בסנכרון הבא)', async () => {
    const rows = [r('300001', 'עט A', '7100000000011', 5), r('300002', 'מחברת A4', '7100000000035', 8), r('300004', 'מחק', '7100000000042', 2)];
    for (let k = 0; k < 2; k++) {
      const { pv, a } = await sync(rows);
      assert.ok(pv.warn.some((w) => w.c === '300002' && w.w === 'bcdup'), JSON.stringify(pv.warn));
      assert.equal(a.res.bdup, 1);
      assert.equal((await P('pb').get()).get('barcode'), '7100000000028');
    }
  });
  it('cxCode: מנהל בלבד; קוד שמקושר למוצר אחר – חסימה', async () => {
    assert.notEqual((await call('cxCode', E1, { pid: 'pd', code: '300009' })).status, 'OK');
    assert.notEqual((await call('cxCode', null, { pid: 'pd', code: '300009' })).status, 'OK');
    const x = await call('cxCode', MGR, { pid: 'pd', code: '300002' });
    assert.equal(x.reason, 'code-taken'); assert.ok(x.text.includes('מחברת A4'));
    assert.equal((await P('pd').get()).get('cx'), '300004');
  });
  it('cxCode: קוד שקיים בכספית ולא מקושר – קישור; הקוד הישן נשאר (old) והקטלוג לא יוצר ממנו מוצר כפול', async () => {
    const r1 = await ok('cxCode', MGR, { pid: 'pd', code: '300009' });
    assert.deepEqual([r1.mode, r1.old, r1.code], ['link', '300004', '300009']);
    assert.equal((await P('pd').get()).get('cx'), '300009');
    const old = await X('300004');
    assert.deepEqual([old.old, old.to, old.pid], [true, '300009', 'pd']);
    assert.deepEqual(await logs('pd', 'x'), [['300004', '300009', 'code']]);
    const nP = (await adm().collection(`b/${A}/prod`).get()).size;
    const { pv } = await sync([r('300004', 'מחק', '', 2), r('300009', 'מחק לבן', '7100000000042', 2)]);
    assert.equal(pv.cnt.old, 1); assert.equal(pv.cnt.nw, 0);
    assert.equal((await adm().collection(`b/${A}/prod`).get()).size, nP);
    assert.equal((await X('300009')).pid, 'pd');
  });
  it('cxCode: קוד שלא קיים בכספית – פריט חדש בקוד החדש (נשלח בפריטים חדשים למרות שהברקוד בכספית תחת הקוד הקודם)', async () => {
    const r2 = await ok('cxCode', MGR, { pid: 'pd', code: '777777' });
    assert.deepEqual([r2.mode, r2.old], ['new', '300009']);
    const x = await X('777777');
    assert.deepEqual([x.nw, x.from, x.pid], [true, '300009', 'pd']);
    const e = await ok('cxExport', MGR, { kind: 'new' });
    assert.ok(e.csv.includes('\n777777,7100000000042,'), e.csv);
    assert.equal(e.dupN, 0);
    assert.equal((await X('300009')).old, true);
  });
  it('וריאנט (26.11): מוצר לא מקושר שהברקוד שלו בכספית תחת קוד אחר → cxv, בלי קוד חדש ובלי "כפול"; הקטלוג לא מקשר אליו; "לא וריאנט" – חוזר לכפולים ולא מסומן שוב', async () => {
    await P('pv1').set({ name: 'מחק אדום', price: 4, barcode: '7100000000042', on: true, q: { _: 3 }, at: 1 });
    await P('pv2').set({ name: 'מחק זהב', price: 4, barcode: '', bcx: ['7100000000042'], on: true, q: {}, at: 1 });
    await P('pv3').set({ name: 'מוצר חדש באמת', price: 6, barcode: '7100000000777', on: true, q: {}, at: 1 });
    const e = await ok('cxExport', MGR, { kind: 'new' });
    assert.deepEqual([e.varN, e.varNew, e.dupN], [2, 2, 0], JSON.stringify(e.dup));
    assert.deepEqual(e.vars.map((v) => [v.pid, v.cx]).sort(), [['pv1', '300009'], ['pv2', '300009']]);
    assert.ok(!e.csv.includes('מחק אדום') && !e.csv.includes('מחק זהב')); assert.ok(e.csv.includes('מוצר חדש באמת'));
    const v1 = (await P('pv1').get()).data();
    assert.deepEqual([v1.cxv, v1.cx, v1.price, v1.name, v1.q._], ['300009', undefined, 4, 'מחק אדום', 3], 'רק cxv – בלי מחיר / שם / כמות');
    const e2 = await ok('cxExport', MGR, { kind: 'new', max: 5 });
    assert.deepEqual([e2.varNew, e2.dupN], [0, 0]);
    // הקטלוג לא מקשר לווריאנט (גם לא לפי שם)
    const g = CC.groupCat([HDR, r('300020', 'מחק אדום', '7100000000888', 4)]); const id = run();
    await ok('cxUpload', MGR, { run: id, part: 0, parts: 1, items: g.items });
    const pv = await ok('cxPreview', MGR, { run: id });
    assert.equal(pv.cnt.link, 0); assert.equal(pv.cnt.nw, 1);
    // "לא וריאנט" – מנהל בלבד
    assert.notEqual((await call('cxDnOk', E1, { pid: 'pv1', v: true })).status, 'OK');
    assert.equal((await call('cxDnOk', MGR, { pid: 'pv1', v: 'x' })).reason, 'bad-v');
    await ok('cxDnOk', MGR, { pid: 'pv1', v: true });
    const v1b = (await P('pv1').get()).data();
    assert.deepEqual([v1b.cxv, v1b.cxvNo], [undefined, true]);
    const e3 = await ok('cxExport', MGR, { kind: 'new' });
    assert.deepEqual([e3.varN, e3.varNew, e3.dupN], [1, 0, 1]); assert.equal(e3.dup[0].pid, 'pv1');
    assert.equal((await P('pv1').get()).get('cxv'), undefined, 'לא סומן שוב אוטומטית');
  });
});
