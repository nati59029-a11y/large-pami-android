'use strict';
// קופה – אשף ייבוא מכספיט (17.11.2026, ענף feature/pos-import): functions/pos-import.js מול האמולטור. חלק מ-test:multibiz:3.
//   - הרשאות: מנהל בלבד; עובד – נדחה; מתג העסק pos כבוי – נדחה.
//   - רשומה קיימת לא נדרסת לעולם (מוצר לפי ברקוד / שם בלי ברקוד; לקוח לפי טלפון – כולל phx – או ת"ז). השוואת המסמך לפני / אחרי.
//   - שליחה חוזרת של אותה מנה לא יוצרת פעמיים; יומן posimp עם מונים; ביטול ייבוא מכבה בלי למחוק, ומוצר שנמכר נשאר פעיל.
//   - 1,200 שורות ב-6 מנות. אין כתיבה / קריאה ישירה ל-posimp מהאפליקציה.
// כל הנתונים מומצאים (דוגמה).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-pos', B = 'biz-nopos';
const MGR = 'pi_mgr', M2 = 'pi_m2', E1 = 'pi_e1';
const FN = path.join(H.ROOT, 'functions');
const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text: String(text).slice(0, 300) };
}
const jid = () => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; return Array.from(crypto.randomBytes(20), (b) => a[b % a.length]).join(''); };
let env, adm;
const P = (p) => `b/${A}/${p}`;
const snap = async (p) => { const s = await adm().doc(P(p)).get(); return s.exists ? s.data() : null; };

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const b = d.batch();
    const F = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
    for (const [biz, m, pos] of [[A, MGR, true], [B, M2, false]]) {
      b.set(d.doc('b/' + biz), { name: biz, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: Object.assign({ pos }, F) });
      b.set(d.doc(`b/${biz}/admins/${m}`), { email: m + '@x.invalid' });
      b.set(d.doc(`b/${biz}/staff/${m}`), { name: m, role: 'manager', active: true });
      b.set(d.doc('users/' + m), { bizId: biz, role: 'admin', active: true, bizStatus: 'active', email: m + '@x.invalid', createdAt: 1 });
    }
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true });
    b.set(d.doc('users/' + E1), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: E1 + '@x.invalid', createdAt: 1 });
    // רשומות קיימות (דוגמה) – אסור שישתנו
    b.set(d.doc(P('prod/old1')), { name: 'צלחות ותיקות (דוגמה)', price: 99, barcode: '7290000000101', on: true, q: { _: 5 }, at: 1, by: 'x' });
    b.set(d.doc(P('prod/old2')), { name: 'שקית נייר בלי ברקוד (דוגמה)', price: 1, barcode: '', on: true, q: {}, at: 1, by: 'x' });
    b.set(d.doc(P('cust/p0500000001')), { name: 'לקוח ותיק (דוגמה)', phone: '0500000001', phx: ['0500000001', '0500000009'], mail: 'old@example.invalid', x: {}, at: 1, by: 'x' });
    b.set(d.doc(P('cust/t000000018')), { name: 'לקוח ותיק עם ת"ז (דוגמה)', tz: '000000018', x: {}, at: 1, by: 'x' });
    b.set(d.doc(P('cat/c_bake')), { name: 'מאפים', ord: 0 });
    await b.commit();
  });
}

describe('קופה – ייבוא מכספיט (pos-import.js)', () => {
  before(async () => {
    env = await H.getEnv();
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
    require('../functions/index.js'); // initializeApp – כדי ש-getFirestore יעבוד מתהליך הבדיקה מול האמולטור
    adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore(); // כמו imports.test.js
    await seed();
  });
  after(async () => { if (env) await env.cleanup(); });

  it('הרשאות: עובד נדחה; מנהל בעסק שהקופה כבויה בו – נדחה', async () => {
    const r1 = await call('posImpList', E1, {});
    assert.equal(r1.status, 'PERMISSION_DENIED', r1.text); assert.equal(r1.reason, 'manager-only');
    const r2 = await call('posImpList', M2, {});
    assert.equal(r2.status, 'FAILED_PRECONDITION', r2.text); assert.equal(r2.reason, 'feature-off');
    const r3 = await call('posImport', E1, { job: jid(), kind: 'prod', file: 'x.csv', total: 1, at: 0, rows: [{ n: 2, name: 'א', price: 1 }] });
    assert.equal(r3.status, 'PERMISSION_DENIED');
  });

  it('בדיקה מקדימה: מחזירה אילו שורות כבר קיימות (ברקוד / שם בלי ברקוד / טלפון כולל phx / ת"ז)', async () => {
    const p = await call('posImpCheck', MGR, { kind: 'prod', keys: [{ bc: '7290000000101' }, { bc: '7290000000999' }, { nm: 'שקית נייר בלי ברקוד (דוגמה)' }, { nm: 'חדש' }] });
    assert.equal(p.status, 'OK', p.text); assert.deepEqual(p.result.ex, [0, 2]);
    const c = await call('posImpCheck', MGR, { kind: 'cust', keys: [{ ph: '050-0000009' }, { tz: '000000018' }, { ph: '0500000077' }, { ph: '0500000001' }] });
    assert.equal(c.status, 'OK', c.text); assert.deepEqual(c.result.ex, [0, 1, 3]);
  });

  it('מוצרים: חדשים נוצרים, קיימים לא נדרסים, שליחה חוזרת לא מכפילה, יומן ייבוא', async () => {
    const before = [await snap('prod/old1'), await snap('prod/old2')];
    const job = jid();
    const rows = [
      { n: 3, name: 'צלחות – מחיר אחר (דוגמה)', price: 1, barcode: '7290000000101' }, // קיים לפי ברקוד
      { n: 4, name: 'עוגת שמרים (דוגמה)', price: 24.9, barcode: '7290000000103', cid: 'c_bake', cost: 10 },
      { n: 5, name: 'שקית נייר בלי ברקוד (דוגמה)', price: 0.5 }, // קיים לפי שם
      { n: 6, name: 'מגש (דוגמה)', price: 11.8, barcode: '7290000000201', cat: 'חד פעמי' },
      { n: 7, name: 'מגש כפול (דוגמה)', price: 11.8, barcode: '7290000000201' }, // כפול בקובץ
      { n: 8, name: 'קטגוריה לא קיימת (דוגמה)', price: 2, barcode: '7290000000301', cid: 'c_nope' },
      { n: 9, name: 'מחיר שלילי (דוגמה)', price: -2 },
    ];
    const r = await call('posImport', MGR, { job, kind: 'prod', file: 'SAMPLE-export-20261117.csv', src: 'csv', total: rows.length, at: 0, rows });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual([r.result.added, r.result.dup, r.result.bad], [2, 3, 2]);
    assert.deepEqual(r.result.skipped.map((s) => [s.n, s.why]).sort(), [[3, 'exists'], [5, 'exists'], [7, 'file-dup'], [8, 'no-cat'], [9, 'bad-price']]);
    assert.deepEqual([await snap('prod/old1'), await snap('prod/old2')], before, 'רשומות קיימות לא השתנו');
    const all = (await adm().collection(P('prod')).where('imp', '==', job).get()).docs.map((d) => d.data());
    assert.equal(all.length, 2);
    const cake = all.find((x) => x.barcode === '7290000000103');
    assert.equal(cake.cat, 'c_bake'); assert.equal(cake.on, true); assert.equal(cake.src, 'posimp'); assert.equal(cake.price, 24.9);
    const tray = all.find((x) => x.barcode === '7290000000201');
    const cs = await adm().doc(P('cat/' + tray.cat)).get();
    assert.equal(cs.get('name'), 'חד פעמי', 'קטגוריה חדשה נוצרה בשם מהקובץ');
    const log = await snap('posimp/' + job);
    assert.deepEqual([log.kind, log.src, log.rows, log.added, log.dup, log.bad, log.ids.length], ['prod', 'csv', 7, 2, 3, 2]);
    assert.ok(!/\d{8}/.test(log.file), 'רצף ספרות ארוך לא נשמר בשם הקובץ');
    // שליחה חוזרת (ניתוק באמצע) – אותה תוצאה, בלי יצירה נוספת ובלי ספירה כפולה
    const again = await call('posImport', MGR, { job, kind: 'prod', file: 'SAMPLE-export-20261117.csv', src: 'csv', total: rows.length, at: 0, rows });
    assert.equal(again.status, 'OK', again.text); assert.equal(again.result.again, true);
    assert.equal((await adm().collection(P('prod')).where('imp', '==', job).get()).size, 2);
    assert.equal((await snap('posimp/' + job)).added, 2);
    // ייבוא חוזר של אותו קובץ כעבודה חדשה – 0 חדשים
    const re = await call('posImport', MGR, { job: jid(), kind: 'prod', file: 'x.csv', total: rows.length, at: 0, rows });
    assert.equal(re.result.added, 0);
  });

  it('לקוחות: חדשים נוצרים לפי מזהה t/p, קיימים (טלפון, phx, ת"ז) לא נדרסים', async () => {
    const before = [await snap('cust/p0500000001'), await snap('cust/t000000018')];
    const job = jid();
    const rows = [
      { n: 2, name: 'שם חדש לוותיק (דוגמה)', phone: '0500000001', mail: 'new@example.invalid' },
      { n: 3, name: 'טלפון נוסף של ותיק (דוגמה)', phone: '0500000009' },
      { n: 4, name: 'ת"ז קיימת (דוגמה)', tz: '000000018', phone: '0500000044' },
      { n: 5, name: 'לקוח חדש (דוגמה)', phone: '+972500000002' },
      { n: 6, name: 'לקוח חדש עם ת"ז (דוגמה)', tz: '000000026' },
      { n: 7, name: 'כפול בקובץ (דוגמה)', phone: '0500000002' },
      { n: 8, name: 'בלי מפתח (דוגמה)' },
    ];
    const r = await call('posImport', MGR, { job, kind: 'cust', file: 'SAMPLE-customers.csv', src: 'csv', total: rows.length, at: 0, rows });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual([r.result.added, r.result.dup, r.result.bad], [2, 4, 1]);
    assert.deepEqual([await snap('cust/p0500000001'), await snap('cust/t000000018')], before, 'לקוחות קיימים לא השתנו');
    const n1 = await snap('cust/p0500000002');
    assert.equal(n1.name, 'לקוח חדש (דוגמה)'); assert.deepEqual(n1.phx, ['0500000002']); assert.equal(n1.imp, job); assert.equal(n1.src, 'import');
    assert.equal((await snap('cust/t000000026')).tz, '000000026');
    assert.equal(await snap('cust/p0500000044'), null, 'לקוח עם ת"ז קיימת לא נוצר גם לפי הטלפון');
    const u = await call('posImpUndo', MGR, { job });
    assert.equal(u.status, 'FAILED_PRECONDITION'); assert.equal(u.reason, 'cust-no-undo');
  });

  it('1,200 מוצרים ב-6 מנות, אחר כך ביטול ייבוא: מכבה בלי למחוק; מוצר שנמכר נשאר פעיל; אחרי ביטול – אין המשך', async () => {
    const job = jid(); const N = 1200;
    const rows = Array.from({ length: N }, (_, i) => ({ n: i + 2, name: `מוצר דוגמה ${i}`, price: 1 + (i % 50), barcode: String(7290000500000 + i) }));
    for (let at = 0; at < N; at += 200) {
      const r = await call('posImport', MGR, { job, kind: 'prod', file: 'SAMPLE-big.xlsx', src: 'xlsx', total: N, at, rows: rows.slice(at, at + 200) });
      assert.equal(r.status, 'OK', r.text); assert.equal(r.result.added, 200);
    }
    const log = await snap('posimp/' + job);
    assert.equal(log.added, N); assert.equal(log.ids.length, N);
    const sold = log.ids[7];
    await adm().collection(P('stockLog')).add({ prod: sold, br: '_', delta: -1, why: 'order', by: MGR, at: Date.now() });
    let left = 1, off = 0, kept = 0, k = 0;
    while (left > 0 && k++ < 20) { const u = await call('posImpUndo', MGR, { job }); assert.equal(u.status, 'OK', u.text); left = u.result.left; off += u.result.off; kept += u.result.kept; }
    assert.deepEqual([off, kept, left], [N - 1, 1, 0]);
    const docs = (await adm().collection(P('prod')).where('imp', '==', job).get()).docs;
    assert.equal(docs.length, N, 'שום מוצר לא נמחק');
    assert.equal(docs.filter((d) => d.get('on') === true).map((d) => d.id).join(), sold);
    const L = await call('posImpList', MGR, {});
    const me = L.result.list.find((x) => x.id === job);
    assert.equal(me.undone, true); assert.equal(me.off, N - 1); assert.equal(me.kept, 1);
    assert.ok(L.result.cats.some((c) => c.id === 'c_bake'));
    // שליחה חוזרת של מנה שכבר נשמרה – התוצאה השמורה, בלי יצירה ובלי הדלקה מחדש
    const more = await call('posImport', MGR, { job, kind: 'prod', file: 'SAMPLE-big.xlsx', src: 'xlsx', total: N, at: 0, rows: rows.slice(0, 200) });
    assert.equal(more.status, 'OK', more.text); assert.equal(more.result.again, true);
    assert.equal((await adm().collection(P('prod')).where('imp', '==', job).where('on', '==', true).get()).size, 1);
  });

  it('posimp מהאפליקציה: כתיבה חסומה לכולם; קריאה – רק מנהל (כללי שלב 0); עובד – לא', async () => {
    const db = env.authenticatedContext(MGR, { email: MGR + '@x.invalid' }).firestore();
    await assertFails(db.doc(P('posimp/AAAAAAAAAAAAAAAAAAAA')).set({ kind: 'prod' }));
    await assertSucceeds(db.doc(P('posimp/AAAAAAAAAAAAAAAAAAAA')).get());
    await assertFails(db.doc(P('posimp/AAAAAAAAAAAAAAAAAAAA/c/0')).get());
    const de = env.authenticatedContext(E1, { email: E1 + '@x.invalid' }).firestore();
    await assertFails(de.doc(P('posimp/AAAAAAAAAAAAAAAAAAAA')).get());
  });
});
