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
    assert.deepEqual((await X('300003')).ct, { fb: 'כלי כתיבה', ab: null, ai: '/' }); // ai = הקטגוריות של המוצר באפליקציה (סבב בדיקה 1)
    assert.equal((await logs('pa', 'n')).length, 0);
    // 26.11.2026: "עדכון פריטים" אומת מול כספית – פועל כברירת מחדל (בלי updOk); אין מה לשלוח
    const e = await ok('cxExport', MGR, { kind: 'upd' });
    assert.equal(e.n, 0); assert.equal(e.off, undefined);
    assert.deepEqual((await X('300001')).sp, { ab: '' }, 'בסיס הספק נרשם');
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
    assert.equal(L[0], CC.HDR_UPD.join(','));
    // "עדכון פריטים" (26.11): רק הקוד והשם שהשתנה; כל השאר ריק (= לא משתנה בכספית) – בלי ברקוד, מחיר, עלות
    assert.equal(L[1], '300002,מחברת A4' + ','.repeat(46));
    assert.equal((await X('300002')).bc.pd, undefined, 'שדה שלא השתנה – לא מסומן pd');
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
  it('עדכון פריטים (26.11): ברקוד לא נשלח; ספק שהשתנה באפליקציה – נשלח ונקלט; ספק שהשתנה רק בכספית – לא חוזר; רק קוד מהקטלוג שמקושר לאותו מוצר; updOk=false – כבוי', async () => {
    const up = () => ok('cxExport', MGR, { kind: 'upd' });
    assert.equal((await up()).n, 0);
    await P('pd').update({ barcode: '7100000000555' });
    assert.equal((await up()).n, 0, 'שינוי ברקוד באפליקציה – לא יוצר שורה');
    await P('pd').update({ barcode: '7100000000042', sup: 'ספק הדר' });
    // מתג חירום: updOk=false – כלום לא נשלח ולא מסומן
    await adm().doc(`b/${A}/cxcfg/main`).set({ updOk: false }, { merge: true });
    const off = await up();
    assert.equal(off.n, 0); assert.match(off.off, /כבויים/);
    assert.equal(((await X('300004')).sp || {}).pd, undefined);
    await adm().doc(`b/${A}/cxcfg/main`).update({ updOk: require(require.resolve('firebase-admin/firestore', { paths: [FN] })).FieldValue.delete() });
    const e = await up();
    assert.equal(e.n, 1); assert.deepEqual(e.rows[0].f, ['sp']);
    const row = e.csv.slice(1).split('\n')[1].split(',');
    assert.equal(row.length, 48);
    assert.deepEqual([row[0], row[CC.HDR_UPD.indexOf('שם ספק')]], ['300004', 'ספק הדר']);
    assert.equal(row.filter(Boolean).length, 2, 'רק קוד וספק');
    assert.deepEqual((await X('300004')).sp, { ab: 'ספק הדר', pd: 'ספק הדר' });
    // כספית קלטה → ack; אחר כך הספק השתנה רק בכספית → האפליקציה לא דורסת ולא שולחת בחזרה
    const rs = (sup) => [['300004', 'מחק', '7100000000042', sup, '', '', 0, 2, 'לא']];
    await sync(rs('ספק הדר'));
    assert.deepEqual((await X('300004')).sp, { ab: 'ספק הדר' });
    assert.equal((await up()).n, 0);
    await sync(rs('ספק אחר'));
    assert.equal((await P('pd').get()).get('sup'), 'ספק הדר');
    assert.equal((await up()).n, 0, 'שינוי רק בכספית – לא נשלח בחזרה');
    // סבב בדיקה 1: רק קוד מהקטלוג האחרון (cxcfg/seenLast) – לא מ-seen המצטבר; מוצר שה-cx שלו קוד אחר – לא נשלח; בלי הרשימה – לא נשלח כלום
    await P('pe').set({ name: 'שם חדש', price: 1, barcode: '', on: true, q: {}, cx: '300051', at: 1 });
    await adm().doc(`b/${A}/cxItem/300050`).set({ c: '300050', pid: 'pe', st: 'link', n: 'שם ישן', pr: { fb: 1, ab: 1 }, co: { fb: null, ab: null }, nm: { fb: 'שם ישן', ab: 'שם ישן' }, run: 'old', at: 1 });
    const seenRef = adm().doc(`b/${A}/cxcfg/seen`), codes0 = (await seenRef.get()).get('codes');
    await seenRef.set({ codes: codes0.concat(['300050']) });
    const lastRef = adm().doc(`b/${A}/cxcfg/seenLast`), last0 = (await lastRef.get()).data();
    assert.deepEqual(last0.s.split('\n'), ['300004'], 'הקטלוג האחרון בלבד');
    assert.equal((await up()).n, 0, 'הופיע פעם בקטלוג (seen), אבל לא בקטלוג האחרון');
    await lastRef.set(Object.assign({}, last0, { s: last0.s + '\n300050' }));
    assert.equal((await up()).n, 0, 'בקטלוג, אבל המוצר מקושר לקוד אחר');
    await P('pe').update({ cx: '300050' });
    await lastRef.delete();
    const nl = await up();
    assert.deepEqual([nl.n, nl.noLast], [0, true], 'בלי רשימת הקטלוג האחרון – לא שולחים כלום');
    await lastRef.set(Object.assign({}, last0, { s: last0.s + '\n300050' }));
    const e2 = await up();
    assert.deepEqual(e2.rows.map((x) => [x.c, x.n, x.f]), [['300050', 'שם חדש', ['nm']]]);
    assert.equal((await X('300050')).uq, undefined, 'הפקת הקובץ לא מעלה את מונה הניסיונות (רק דיווח טעינה)');
    await adm().doc(`b/${A}/cxItem/300050`).delete(); await P('pe').delete(); await seenRef.set({ codes: codes0 }); await lastRef.set(last0);
  });
  it('עדכון פריטים – סבב בדיקה 1: רק המשנית שונתה → הראשית של כספית ונקלט; קטגוריה בלי משנית (בכספית יש) / שם שמתחיל ב-"-" → "לעדכן ידנית", לא נשלח', async () => {
    const up = () => ok('cxExport', MGR, { kind: 'upd' });
    await sync([r('300003', 'סרגל', '7100000000035', 3, 'משרד', 'סרגלים'), ['300004', 'מחק', '7100000000042', 'ספק אחר', '', '', 0, 2, 'לא']]);
    assert.equal((await up()).n, 0);
    const pc = (await P('pc').get()).data();
    assert.deepEqual((await X('300003')).ct, { fb: 'משרד›סרגלים', ab: 'משרד›סרגלים', ai: pc.cat + '/' + pc.sub });
    // שם הראשית שונה באפליקציה (keep), ואז רק המשנית מוחלפת
    await adm().doc(`b/${A}/cat/${pc.cat}`).update({ name: 'משרד ראשי' });
    await adm().doc(`b/${A}/cat/csubx`).set({ name: 'מחוגים', parent: pc.cat, ord: 0 });
    await P('pc').update({ sub: 'csubx' });
    const e = await up();
    assert.equal(e.n, 1);
    const row = e.csv.slice(1).split('\n')[1].split(',');
    assert.deepEqual([row[0], row[CC.HDR_UPD.indexOf('שם קטגוריה ראשית')], row[CC.HDR_UPD.indexOf('שם קטגוריה משנית')]], ['300003', 'משרד', 'מחוגים'], 'הראשית כמו בכספית');
    assert.deepEqual([(await X('300003')).ct.pd, (await X('300003')).ct.ab], ['משרד›מחוגים', 'משרד ראשי›מחוגים']);
    assert.deepEqual((await up()).rows.map((x) => x.c), ['300003'], 'טרם נקלט – אותו ערך שוב');
    await sync([r('300003', 'סרגל', '7100000000035', 3, 'משרד', 'מחוגים')]);
    const ct = (await X('300003')).ct;
    assert.deepEqual([ct.fb, ct.ab, ct.pd], ['משרד›מחוגים', 'משרד ראשי›מחוגים', undefined], 'נקלט');
    assert.equal((await up()).n, 0);
    // המשנית הוסרה באפליקציה, ובכספית יש משנית – אי אפשר בלי NULL: לא נשלח, "לעדכן ידנית"
    await P('pc').update({ sub: require(require.resolve('firebase-admin/firestore', { paths: [FN] })).FieldValue.delete() });
    const m = await up();
    assert.equal(m.n, 0); assert.deepEqual(m.man.map((x) => [x.c, x.k]), [['300003', ['ct']]]);
    assert.equal((await X('300003')).ct.pd, undefined, 'לא סומן');
    // שם שמתחיל ב-"-" (cell היה מוסיף גרש) – לא נשלח, "לעדכן ידנית"
    await P('pc').update({ sub: 'csubx', name: '-50% סרגל' });
    const m2 = await up();
    assert.equal(m2.n, 0); assert.deepEqual(m2.man.map((x) => [x.c, x.k]), [['300003', ['nm']]]);
    await P('pc').update({ name: 'סרגל' });
    await adm().doc(`b/${A}/cat/${pc.cat}`).update({ name: 'משרד' });
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
  it('וריאנט – סבב בדיקה 2: מחושב מחדש בכל ריצה: הברקוד עבר לקוד אחר → cxv החדש; כבר לא בקטלוג → cxv נמחק והמוצר מקבל קוד כרגיל', async () => {
    assert.equal((await P('pv2').get()).get('cxv'), '300009');
    await sync([r('300030', 'מחק כחול', '7100000000042', 2)]); // הברקוד עכשיו בכספית תחת 300030, ו-300009 כבר לא בקטלוג
    const e1 = await ok('cxExport', MGR, { kind: 'new' });
    assert.equal((await P('pv2').get()).get('cxv'), '300030');
    assert.ok(e1.vars.some((v) => v.pid === 'pv2' && v.cx === '300030'));
    await sync([r('300031', 'דבר אחר', '7100000000999', 3)]); // הברקוד כבר לא בכספית בכלל
    const e2 = await ok('cxExport', MGR, { kind: 'new' });
    assert.equal(e2.varDel, 1);
    const v2 = (await P('pv2').get()).data();
    assert.equal(v2.cxv, undefined); assert.ok(/^9\d{5}$/.test(v2.cx), 'חזר להיות מועמד רגיל וקיבל קוד: ' + v2.cx);
    assert.ok(e2.csv.includes('מחק זהב'));
  });
  it('וריאנט (27.11): מוצר שכבר קיבל קוד ממתין (nw) לפני הגנת הברקוד, והברקוד שלו בכספית תחת קוד אחר → cxv + cxItem.var, לא נשלח ולא "כפול"; קוד ממתין שהופיע בקטלוג – לא; "לא וריאנט" מנקה את שניהם', async () => {
    // הקטלוג האחרון (סבב קודם): 7100000000999 תחת 300031
    const XI = (c, pid) => adm().doc(`b/${A}/cxItem/${c}`).set({ c, pid, st: 'link', nw: true, src: 'app', n: 'x', pr: { fb: null, ab: 7, pd: 7 }, co: { fb: null, ab: null, pd: null }, at: 1 });
    await P('pz').set({ name: 'בליסטר ירוק', price: 7, barcode: '7100000000999', on: true, q: { _: 2 }, cx: '900777', sku: '900777', at: 1 });
    await XI('900777', 'pz');
    await P('py').set({ name: 'בליסטר כחול', price: 7, barcode: '', bcx: ['7100000000999'], on: true, q: {}, cx: '900778', at: 1 });
    await XI('900778', 'py');
    const seenRef = adm().doc(`b/${A}/cxcfg/seen`), codes0 = (await seenRef.get()).get('codes');
    await seenRef.set({ codes: codes0.concat(['900778']) }); // 900778 כבר הופיע בקטלוג – לא נוגעים
    const e = await ok('cxExport', MGR, { kind: 'new' });
    const z = (await P('pz').get()).data();
    assert.deepEqual([z.cxv, z.cx, z.price, z.name, z.q._], ['300031', '900777', 7, 'בליסטר ירוק', 2], 'רק cxv');
    assert.equal((await X('900777')).var, '300031'); assert.equal((await X('900777')).nw, true, 'לא נמחק');
    assert.ok(!e.csv.includes('900777'), 'לא נשלח');
    assert.ok(!e.dup.some((d) => d.pid === 'pz'), 'לא "כפול"');
    assert.ok(e.vars.some((v) => v.pid === 'pz' && v.cx === '300031'));
    assert.ok(e.dup.some((d) => d.pid === 'py' && d.c === '900778'), 'קוד ממתין שהופיע בקטלוג – נשאר "כפול"');
    assert.equal((await P('py').get()).get('cxv'), undefined);
    assert.equal((await X('900778')).var, undefined);
    const e2 = await ok('cxExport', MGR, { kind: 'new' });
    assert.ok(!e2.dup.some((d) => d.pid === 'pz') && !e2.csv.includes('900777'), 'יציב בריצה נוספת');
    // "לא וריאנט" – מנקה את cxv ואת var; מאז – "כפול", לא נשלח, לא מסומן שוב
    await ok('cxDnOk', MGR, { pid: 'pz', v: true });
    assert.deepEqual([(await P('pz').get()).get('cxv'), (await P('pz').get()).get('cxvNo'), (await X('900777')).var], [undefined, true, undefined]);
    const e3 = await ok('cxExport', MGR, { kind: 'new' });
    assert.ok(e3.dup.some((d) => d.pid === 'pz' && d.c === '900777')); assert.ok(!e3.csv.includes('900777'));
    assert.equal((await P('pz').get()).get('cxv'), undefined, 'לא סומן שוב');
    await seenRef.set({ codes: codes0 });
  });
});
