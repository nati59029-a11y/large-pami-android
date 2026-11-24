'use strict';
// גיטי – סבב 4 חלק ב (24.11.2026): מגמות וחריגות + טיוטות הזמנה מספקים (lib/sec-an.js, lib/sec-od.js, sec_an).
//  - secRemind (הליבה runRemind, זמן קבוע): טיוטה לכל ספק פעם ביום, בלי כפילות; "טיוטת הזמנה מספק: אסור" – לא נוצרת; ממתינה מעל 7 ימים – old.
//  - secReports op:'an': מגמות ממראה הכספים (עם זמן המראה ומקור) + הטיוטות; אסור – od:null; מנהל עם הגבלת סניפים – בלי נתונים.
//  - secPrefs op:'od': אישור עם עריכת כמויות → "להזמין מספקים" (supord, src:'sec') + יומן odOk; אישור חוזר – already; דחייה – odNo וחסימה ל-7 ימים;
//    "אסור" אחרי יצירה – האישור נחסם; מנהל עם הגבלת סניפים – נדחה.
//  - סיכום הבוקר: שורת "מגמות וחריגות" ו"טיוטות הזמנה מספקים" בממתין לאישור. כללי Firestore: sec_an סגור לאפליקציה.
// מול האמולטור (פונקציות דרך HTTP כמו בשאר בדיקות המזכירה), בלי AI.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-an';
const M1 = 'an_m1', M3 = 'an_m3'; // M3 – מנהל עם הגבלת סניפים
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
let env, SEC, RM, T, BIZ;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const IL = (s) => Date.parse(s + ':00+02:00');
const D = 864e5;
const send = async (tokens) => tokens.map((t) => ({ token: t, ok: true }));
const run = (iso) => RM.runRemind({ now: IL(iso), bizzes: [BIZ], send });
const drafts = async () => (await coll(`b/${A}/sec_an`)).filter((x) => x.k === 'od');
const logs = async (re) => (await coll(`b/${A}/sec_log`)).filter((l) => re.test(l.act));
const e = (n, v) => [n, 'e', v];
// המראה: נכונה ל-1.12.2026 → החודש האחרון שהסתיים 2026-11; "חומרי גלם" 1,600 מול ממוצע 1,000 – חריגה
function finOf() {
  const m = (exp, g, sups) => ({ inc: 10000, exp, own: 0, cats: [e('חומרי גלם', g), ['מכירות', 'i', 10000]], sups });
  return { v: 1, at: IL('2026-12-01T06:00'), months: { '2025-11': m(4000, 900, [['תנובה', 900]]), '2026-08': m(5000, 1000, [['תנובה', 1000]]), '2026-09': m(5000, 1000, [['תנובה', 1000]]),
    '2026-10': m(5000, 1000, [['תנובה', 1000]]), '2026-11': m(5600, 1600, [['תנובה', 1100]]) } };
}

async function seed(o) {
  const x = o || {};
  await env.clearFirestore();
  const NOW = IL('2026-12-01T08:10');
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { tasks: true, secretary: true, orders: true } });
    b.set(d.doc(`b/${A}/admins/${M1}`), { email: M1 + '@example.invalid' }); b.set(d.doc(`b/${A}/staff/${M1}`), { name: 'מנהל', role: 'manager', active: true });
    b.set(d.doc(`b/${A}/admins/${M3}`), { email: M3 + '@example.invalid', br: ['br1'] });
    for (const u of [M1, M3]) b.set(d.doc('users/' + u), { bizId: A, role: 'admin', active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    const mgr = {}; for (const u of [M1, M3]) mgr[u] = { cv: SEC.CONSENT_VER, ca: 1, nm: 'גיטי', ad: 'f', nt: u === M1 ? { sm: true, smh: 8 } : {} };
    b.set(d.doc(`b/${A}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: false, pay: {}, sens: {}, mgr });
    b.set(d.doc(`b/${A}/sec_cfg/cap`), { capCents: 5000 });
    if (x.perm) b.set(d.doc(`b/${A}/sec_cfg/perm`), x.perm);
    b.set(d.doc(`b/${A}/sec_mirror/fin`), { v: 1, data: JSON.stringify(finOf()), at: IL('2026-12-01T06:05'), devAt: IL('2026-12-01T06:00'), by: M1 });
    // מוצרים ותנועות מלאי: חלב – 28 נמכרו ב-28 יום, 2 במלאי → 19; גבינה – 14 נמכרו, 0 במלאי → 11; לחם – 100 במלאי (מספיק)
    b.set(d.doc(`b/${A}/prod/p1`), { name: 'חלב', sup: 'תנובה', q: { _: 2 }, price: 6, on: true });
    b.set(d.doc(`b/${A}/prod/p1/p/cost`), { cost: 5 });
    b.set(d.doc(`b/${A}/prod/p2`), { name: 'גבינה', sup: 'תנובה', q: { _: 0 }, price: 20, on: true });
    b.set(d.doc(`b/${A}/prod/p3`), { name: 'לחם', sup: 'אנג\'ל', q: { _: 100 }, price: 9, on: true });
    b.set(d.doc(`b/${A}/stockLog/s1`), { prod: 'p1', br: '_', delta: -28, why: 'pos', by: 'x', at: NOW - 3 * D });
    b.set(d.doc(`b/${A}/stockLog/s2`), { prod: 'p2', br: '_', delta: -14, why: 'cx', by: 'x', at: NOW - 2 * D });
    b.set(d.doc(`b/${A}/stockLog/s3`), { prod: 'p3', br: '_', delta: -5, why: 'order', by: 'x', at: NOW - 2 * D });
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv(); require('../functions/index.js');
  SEC = require('../functions/secretary.js')._core; RM = require('../functions/secretary-remind.js')._core; T = require('../functions/lib/tenant.js');
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (err) { /* */ } });

describe('גיטי – טיוטות הזמנה מספקים (secRemind)', () => {
  it('פעם ביום: טיוטה אחת לספק (רק מה שחסר), בלי כפילות בריצה חוזרת ולמחרת; יומן odNew; סיכום הבוקר עם מגמות וטיוטות', async () => {
    await seed(); BIZ = await T.loadBiz(A);
    await run('2026-12-01T06:50');
    assert.equal((await drafts()).length, 0, 'לפני 07:00 – לא');
    await run('2026-12-01T08:10'); await run('2026-12-01T08:25');
    const L = await drafts();
    assert.equal(L.length, 1, 'רק תנובה (לחם – מספיק במלאי), ופעם אחת');
    const g = L[0];
    assert.match(g.id, /^od[0-9a-f]{12}_20261201$/);
    assert.deepEqual([g.st, g.sup, g.n], ['pend', 'תנובה', 2]);
    assert.deepEqual(g.lines.map((l) => [l.pid, l.qty, l.m]), [['p2', 11, 's'], ['p1', 19, 's']]);
    assert.equal(g.lines.find((l) => l.pid === 'p1').cost, 5); assert.equal(g.amt, 95); assert.equal(g.amtPart, true, 'לגבינה אין עלות – סכום חלקי');
    assert.equal((await logs(/^odNew$/)).length, 1);
    const am = (await coll(`b/${A}/sec_note/${M1}/n`)).filter((n) => /^am:/.test(n.key));
    assert.equal(am.length, 1);
    assert.match(am[0].body, /מגמות וחריגות: הכנסות 11\/2026: 10,000 ₪ \(0% מול החודש הקודם\); הוצאות: 5,600 ₪ \(\+12%\); הוצאות חריגות: 1 – "חומרי גלם" \+60%/);
    assert.match(am[0].body, /ממתין לאישור שלך: .*1 טיוטות הזמנה מספקים/);
    assert.equal((await coll(`b/${A}/sec_note/${M1}/n`)).filter((n) => /^od/.test(n.key || '')).length, 0, 'בלי התראה קופצת חדשה');
    await run('2026-12-02T08:10');
    assert.equal((await drafts()).length, 1, 'למחרת: לספק יש טיוטה ממתינה – לא נוצרת שנייה');
    await run('2026-12-09T08:10');
    const L2 = await drafts();
    assert.equal(L2.find((x) => x.id === g.id).st, 'old', 'ממתינה מעל 7 ימים – old (לא נמחקת)');
    assert.equal(L2.filter((x) => x.st === 'pend').length, 1, 'ונוצרה טיוטה חדשה במקומה');
  });
  it('"טיוטת הזמנה מספק: אסור" – לא נוצרת טיוטה, ו-secReports לא מחזיר טיוטות (od:null)', async () => {
    await seed({ perm: { t: { ord: 'no' } } }); BIZ = await T.loadBiz(A);
    await run('2026-12-01T08:10');
    assert.equal((await drafts()).length, 0);
    const r = await call('secReports', M1, { op: 'an' });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.od, null); assert.equal(r.result.odLv, 'no');
    assert.equal(r.result.an.ok, true, 'המגמות עדיין מוצגות');
  });
});

describe('גיטי – מרכז שליטה ואישורים (secReports op:an, secPrefs op:od)', () => {
  let id;
  before(async () => { await seed(); BIZ = await T.loadBiz(A); await run('2026-12-01T08:10'); id = (await drafts())[0].id; });
  it('secReports op:an – מגמות מהמראה עם זמן ומקור, חריגה לפי הספים, והטיוטה הממתינה', async () => {
    const r = await call('secReports', M1, { op: 'an' });
    assert.equal(r.status, 'OK', r.text);
    const x = r.result;
    assert.equal(x.at, IL('2026-12-01T06:05')); assert.equal(x.src, 'מראה הכספים בענן');
    assert.deepEqual([x.an.last, x.an.prev, x.an.py], ['2026-11', '2026-10', '2025-11']);
    assert.deepEqual(x.an.anoms.map((a) => [a.k, a.n, a.pct]), [['cat', 'חומרי גלם', 60]], 'תנובה 1,100 מול 1,000 – לא חריגה');
    assert.deepEqual(x.an.sups[0], { n: 'תנובה', v: 1100, prev: 1000, py: 900, dPrev: 10, dPy: 22 });
    assert.deepEqual(x.od.map((o) => o.id), [id]); assert.equal(x.od[0].lines.length, 2);
    const lim = await call('secReports', M3, { op: 'an' });
    assert.equal(lim.status, 'OK', lim.text); assert.equal(lim.result.brLimited, true); assert.equal(lim.result.an, null); assert.equal(lim.result.od, null);
  });
  it('קלט לא תקין נדחה; מנהל עם הגבלת סניפים נדחה – שום דבר לא נכתב', async () => {
    const bad = async (d, reason) => { const r = await call('secPrefs', M1, Object.assign({ op: 'od', id }, d)); assert.equal(r.reason, reason, r.text); };
    await bad({ st: 'ok', lines: [{ pid: 'zz', qty: 1 }] }, 'bad-input');
    await bad({ st: 'ok', lines: [{ pid: 'p1', qty: 0 }] }, 'no-lines');
    await bad({ st: 'ok', lines: [{ pid: 'p1', qty: -2 }] }, 'bad-qty');
    await bad({ st: 'ok', lines: [{ pid: 'p1', qty: 1 }, { pid: 'p1', qty: 2 }] }, 'bad-input');
    await bad({ st: 'maybe' }, 'bad-input');
    assert.equal((await call('secPrefs', M1, { op: 'od', id: 'od' + '0'.repeat(12) + '_20261201', st: 'no' })).reason, 'not-found');
    const r = await call('secPrefs', M3, { op: 'od', id, st: 'ok', lines: [{ pid: 'p1', qty: 3 }] });
    assert.equal(r.status, 'PERMISSION_DENIED', r.text); assert.equal(r.reason, 'branch-limited');
    assert.equal((await coll(`b/${A}/supord`)).length, 0); assert.equal((await get(`b/${A}/sec_an/${id}`)).st, 'pend');
  });
  it('"אסור" שהוגדר אחרי יצירת הטיוטה – האישור נחסם', async () => {
    await prep((d) => d.doc(`b/${A}/sec_cfg/perm`).set({ t: { ord: 'no' } }));
    const r = await call('secPrefs', M1, { op: 'od', id, st: 'ok', lines: [{ pid: 'p1', qty: 3 }] });
    assert.equal(r.status, 'PERMISSION_DENIED', r.text); assert.equal(r.reason, 'perm-no');
    assert.equal((await coll(`b/${A}/supord`)).length, 0);
    await prep((d) => d.doc(`b/${A}/sec_cfg/perm`).delete());
  });
  it('אישור עם עריכה: רק השורות שנשארו נכנסות ל"להזמין מספקים" (לא נשלח לספק), הטיוטה מסומנת, יומן odOk; אישור חוזר – already', async () => {
    const r = await call('secPrefs', M1, { op: 'od', id, st: 'ok', lines: [{ pid: 'p1', qty: 25 }, { pid: 'p2', qty: 0 }] });
    assert.equal(r.status, 'OK', r.text); assert.deepEqual([r.result.st, r.result.n], ['ok', 1]);
    const so = await coll(`b/${A}/supord`);
    assert.equal(so.length, 1);
    assert.equal(so[0].id, 'sg' + id + '_p_p1');
    assert.deepEqual([so[0].pid, so[0].n, so[0].qty, so[0].sup, so[0].st, so[0].src, so[0].br, so[0].od, so[0].by], ['p1', 'חלב', 25, 'תנובה', 'open', 'sec', '_', id, M1]);
    const g = await get(`b/${A}/sec_an/${id}`);
    assert.equal(g.st, 'ok'); assert.equal(g.stBy, M1); assert.deepEqual(g.fin, [{ pid: 'p1', qty: 25 }]);
    const l = await logs(/^odOk$/);
    assert.equal(l.length, 1); assert.equal(l[0].who, 'mgr'); assert.equal(l[0].tgt, id); assert.match(l[0].note, /תנובה: 1 מוצרים/);
    const again = await call('secPrefs', M1, { op: 'od', id, st: 'no' });
    assert.equal(again.status, 'OK', again.text); assert.equal(again.result.already, true); assert.equal(again.result.st, 'ok');
    assert.equal((await logs(/^od(Ok|No)$/)).length, 1, 'בלי רישום נוסף');
    assert.equal((await call('supOrdSet', M1, { id: so[0].id, st: 'ord' })).status, 'OK', 'השורה מתנהגת כמו כל שורה ב"להזמין מספקים"');
    // למחרת: חלב כבר ברשימה (הוזמן) – לא מוצע שוב; גבינה עדיין חסרה – טיוטה חדשה רק איתה
    await run('2026-12-02T08:10');
    const p = (await drafts()).filter((x) => x.st === 'pend');
    assert.equal(p.length, 1); assert.deepEqual(p[0].lines.map((x) => x.pid), ['p2']);
  });
  it('דחייה: odNo, ואותו ספק לא מקבל טיוטה חדשה ב-7 הימים הבאים', async () => {
    const id2 = (await drafts()).find((x) => x.st === 'pend').id;
    const r = await call('secPrefs', M1, { op: 'od', id: id2, st: 'no' });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.st, 'no');
    assert.equal((await get(`b/${A}/sec_an/${id2}`)).st, 'no'); assert.equal((await logs(/^odNo$/)).length, 1);
    // הריצות בבדיקה בזמן קבוע (דצמבר) – זמן הדחייה מוזז לאותו יום, כאילו נדחתה אז
    await prep((d) => d.doc(`b/${A}/sec_an/${id2}`).update({ stAt: IL('2026-12-02T09:00') }));
    await run('2026-12-03T08:10');
    assert.equal((await drafts()).filter((x) => x.st === 'pend').length, 0, 'נדחתה לפני יום – לא שוב');
    await run('2026-12-10T08:10');
    assert.equal((await drafts()).filter((x) => x.st === 'pend').length, 1, 'אחרי 7 ימים – שוב מוצע');
  });
  it('כללי Firestore: sec_an – אף אחד לא קורא ולא כותב מהאפליקציה (גם מנהל)', async () => {
    const db = env.authenticatedContext(M1).firestore();
    await assertFails(db.doc(`b/${A}/sec_an/${id}`).get());
    await assertFails(db.collection(`b/${A}/sec_an`).get());
    await assertFails(db.doc(`b/${A}/sec_an/${id}`).set({ st: 'ok' }, { merge: true }));
    await assertFails(db.doc(`b/${A}/sec_an/x`).set({ k: 'od', st: 'pend' }));
    await assertFails(db.doc(`b/${A}/sec_an/${id}`).delete());
  });
});
