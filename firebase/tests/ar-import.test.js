'use strict';
// ייבוא מתוכנה קודמת (15.11.2026, שלב 6): ar-import.js (arImp, arImpVoid, arImpList) + שדות עסקיים בייבוא הלקוחות (customers.js, custRows).
// רץ מול האמולטור, חלק מ-test:multibiz:2. כל הנתונים – נתוני דוגמה שנוצרו בבדיקה (לא נתונים אמיתיים).
// קריטריון: קובץ דוגמה (לקוחות + יתרות + 3 סוגי מסמכים) מיובא, וסכום היתרות = הסכום בקובץ עד האגורה; ייבוא שני = 0 רשומות חדשות.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const A = 'biz-arimp';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'aim_mgr', E1 = 'aim_e1';
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 'OK', r.text); return r.result; };
let env, n = 0;
const rid = () => 'req' + Date.now().toString(36) + (n++) + 'xx';
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function all(c) { let v = []; await prep(async (d) => { const q = await d.collection(`b/${A}/${c}`).get(); v = q.docs.map((s) => Object.assign({ id: s.id }, s.data())); }); return v; }
const IMP = () => require('../functions/ar-import.js')._core;

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('b/' + A), { name: 'עסק בדיקה', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: ALL,
      org: { v: 1, branches: [{ id: 'br1', name: 'סניף 1', on: true, sig: [] }], banks: [], cards: [] } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true, br: ['br1'] });
    for (const [u, role] of [[MGR, 'admin'], [E1, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/ordcfg/main`), { vat: 18 });
    b.set(d.doc(`b/${A}/arcfg/main`), { on: true, name: 'עסק בדיקה' });
    // לקוח קיים רגיל (יהפוך לעסקי בייבוא) ושני לקוחות עם אותו שם (זיהוי לפי שם – לא חד משמעי)
    b.set(d.doc(`b/${A}/cust/p0547000001`), { name: 'ותיק', phone: '0547000001', terms: { b: 'eom', d: 60 }, at: 1, upd: 1, x: {} });
    b.set(d.doc(`b/${A}/cust/cDUP1aaaaaaaaaaaaaaaaaaa`), { name: 'כפול', phone: '0547000002', phx: ['0547000002'], at: 1, upd: 1, x: {} });
    b.set(d.doc(`b/${A}/cust/cDUP2aaaaaaaaaaaaaaaaaaa`), { name: 'כפול', phone: '0547000003', at: 1, upd: 1, x: {} });
    await b.commit();
  });
}

// יתרה מחושבת מחדש מכל המסמכים (כולל ob/old) = cust.ar; כל מסמך: gross − הקצאות פעילות = open
async function balanced(cid) {
  const docs = (await all('ardoc')).filter((x) => x.cust === cid);
  const al = (await all('aralloc')).filter((a) => !a.void);
  let bal = 0, open = 0, cr = 0;
  for (const x of docs) {
    const dr = x.t === 'inv' || (['ob', 'old'].includes(x.t) && x.k === 'dr');
    const crd = (x.t === 'rc' || x.t === 'cr' || (['ob', 'old'].includes(x.t) && x.k === 'cr'));
    for (const k of ['gross', 'net', 'vat', 'open']) assert.ok(Number.isInteger(x[k]), k + ' שלם');
    if (x.void) { assert.equal(x.open, 0, 'מבוטל ' + x.id); assert.equal(x.st, 'void'); continue; }
    if (dr) { bal += x.gross; open += x.open; assert.equal(x.gross - al.filter((a) => a.inv === x.id).reduce((s, a) => s + a.amt, 0), x.open, 'חובה ' + x.id); }
    if (crd) { bal -= x.gross; cr += x.open; assert.equal(x.gross - al.filter((a) => a.rc === x.id).reduce((s, a) => s + a.amt, 0), x.open, 'זכות ' + x.id); }
  }
  const c = await get(`b/${A}/cust/${cid}`);
  const a = (c && c.ar) || { bal: 0, open: 0, cr: 0 };
  assert.deepEqual({ bal: a.bal, open: a.open, cr: a.cr }, { bal, open, cr }, 'יתרה מחושבת מחדש = cust.ar ' + cid);
  assert.equal(bal, open - cr);
  // שלב 5 + 6: הכרטסת (ArCalc.ledger – גם במכשיר) מכירה את ob/old: היתרה בכרטסת = cust.ar.bal, גם אחרי ביטול קבוצה
  const lg = require('../functions/lib/ar-calc').ledger(docs);
  assert.equal(lg.bal, a.bal, 'כרטסת = cust.ar.bal ' + cid);
  assert.equal(lg.dr - lg.cr, a.bal);
  return a.bal;
}
async function totalBal() { let s = 0; for (const c of await all('cust')) if (c.ar) s += await balanced(c.id); return s; }
// ייבוא קובץ שלם כמו המכשיר: מנות של 25
async function imp(kind, rows, batch) {
  const b = batch || ('b' + rid());
  const tot = { add: 0, dup: 0, bad: 0, sum: 0, rows: [] };
  for (let i = 0; i < rows.length; i += 25) {
    const r = await ok(call('arImp', MGR, { batch: b, kind, rows: rows.slice(i, i + 25), name: 'קובץ ' + kind }));
    for (const k of ['add', 'dup', 'bad', 'sum']) tot[k] += r[k];
    tot.rows.push(...r.rows.map((x) => Object.assign({}, x, { i: x.i + i })));
  }
  return Object.assign(tot, { batch: b });
}
// פורמט סכום משתנה (כמו בקבצים מתוכנות שונות)
const fmtAg = (a, j) => {
  const s = (Math.abs(a) / 100).toFixed(2), neg = a < 0;
  const th = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  switch (j % 5) {
    case 0: return (neg ? '-' : '') + s;
    case 1: return th + (neg ? '-' : ''); // מינוס בסוף
    case 2: return neg ? '(' + th + ')' : '₪ ' + th;
    case 3: return Number((neg ? '-' : '') + s); // מספר מ-Excel
    default: return (neg ? '-' : '') + s.replace('.', ','); // פסיק עשרוני
  }
};
const fmtD = (y, m, d, j) => [`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, `${d}/${m}/${y}`, `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${String(y).slice(2)}`,
  Math.round(Date.UTC(y, m - 1, d) / 864e5) + 25569, `${d}-${m}-${y}`][j % 5];

before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(async () => { await seed(); });

describe('פונקציות טהורות: תאריכים וסכומים', () => {
  it('תאריכים בכמה פורמטים, תאריך לא קיים נדחה', () => {
    const { dateOf } = IMP();
    for (const v of ['2024-03-05', '5/3/2024', '05/03/2024', '05.03.24', '5-3-2024', 45356, '45356', '2024-03-05T10:00:00', '2024/3/5']) assert.equal(dateOf(v), '2024-03-05', String(v));
    for (const v of ['2024-02-30', '31/04/2024', '13/13/2024', 'אתמול', '', null, 123, '2024-3']) assert.equal(dateOf(v), null, String(v));
    assert.equal(dateOf('29/02/2024'), '2024-02-29'); assert.equal(dateOf('29/02/2023'), null);
    assert.equal(dateOf('01/01/99'), '1999-01-01'); assert.equal(dateOf('01/01/25'), '2025-01-01');
  });
  it('סכומים: פסיקי אלפים, מינוס בהתחלה/בסוף/סוגריים, פסיק עשרוני, ₪, עיגול לאגורה', () => {
    const { agOf } = IMP();
    const T = [['1,234.50', 123450], ['-1,234.50', -123450], ['1,234.50-', -123450], ['(1,234.50)', -123450], ['₪ 1,234.5', 123450], ['1234,5', 123450], ['1234,56', 123456],
      [1234.56, 123456], [0.1 + 0.2, 30], ['12.345', 1235], ['12.344', 1234], ['1,234,567.89', 123456789], ['0', 0], ['12 345.00', 1234500], ['ש"ח 10', 1000]];
    for (const [v, e] of T) assert.equal(agOf(v), e, String(v));
    for (const v of ['abc', '1.2.3', '', '--5', '1,23,4', NaN]) assert.equal(agOf(v), null, String(v));
  });
  it('צד: חשבונית שלילית = זכות, קבלה שלילית = חובה (צ׳ק חוזר), זיכוי תמיד זכות', () => {
    const { parseRow } = IMP();
    const t = '2026-11-15';
    assert.equal(parseRow('inv', { no: '1', d: '1/1/2025', amt: '-100', name: 'x' }, t).k, 'cr');
    assert.equal(parseRow('inv', { no: '1', d: '1/1/2025', amt: '100', name: 'x' }, t).k, 'dr');
    assert.equal(parseRow('rc', { no: '1', d: '1/1/2025', amt: '-100', name: 'x' }, t).k, 'dr');
    assert.equal(parseRow('cr', { no: '1', d: '1/1/2025', amt: '-100', name: 'x' }, t).k, 'cr');
    assert.equal(parseRow('cr', { no: '1', d: '1/1/2025', amt: '100', name: 'x' }, t).k, 'cr');
    assert.equal(parseRow('ob', { dr: '500', cr: '200', name: 'x' }, t).ag, 30000);
    assert.equal(parseRow('ob', { dr: '', cr: '200', name: 'x' }, t).k, 'cr');
    assert.equal(parseRow('inv', { no: '1', d: '1/1/2099', amt: '1', name: 'x' }, t).why, 'future');
    assert.equal(parseRow('inv', { d: '1/1/2025', amt: '1', name: 'x' }, t).why, 'no-no');
    assert.equal(parseRow('inv', { no: '1', d: '1/1/2025', amt: '0', name: 'x' }, t).why, 'zero');
    assert.equal(parseRow('inv', { no: '1', d: '1/1/2025', amt: '5' }, t).why, 'no-key');
  });
  it('תיקון סבב 1 (ליקוי 1): כל צירוף של סוג מסמך × עמודת סכום / חובה / זכות – הצד נכון. בעמודות חובה / זכות הצד לפי העמודה', () => {
    const { parseRow } = IMP(), t = '2026-11-15';
    const E = { // [עמודה, ערך] → צד צפוי לכל סוג
      'amt=100': { ob: 'dr', inv: 'dr', rc: 'cr', cr: 'cr' }, 'amt=-100': { ob: 'cr', inv: 'cr', rc: 'dr', cr: 'cr' },
      'dr=100': { ob: 'dr', inv: 'dr', rc: 'dr', cr: 'dr' }, 'cr=100': { ob: 'cr', inv: 'cr', rc: 'cr', cr: 'cr' },
      'dr=-100': { ob: 'cr', inv: 'cr', rc: 'cr', cr: 'cr' }, 'cr=-100': { ob: 'dr', inv: 'dr', rc: 'dr', cr: 'dr' } };
    let n = 0;
    for (const [fv, want] of Object.entries(E)) for (const k of ['ob', 'inv', 'rc', 'cr']) {
      const [f, v] = fv.split('='); const r = parseRow(k, { no: '1', d: '1/1/2025', name: 'x', [f]: v }, t);
      assert.equal(r.k, want[k], `${k} ${fv}`); assert.equal(r.ag, 10000); n++;
    }
    assert.equal(n, 24);
    assert.equal(parseRow('rc', { no: '1', d: '1/1/2025', name: 'x', dr: '', cr: '500' }, t).k, 'cr', 'קבלה בעמודת זכות = זכות');
    assert.equal(parseRow('rc', { no: '1', d: '1/1/2025', name: 'x', dr: '700', cr: '200' }, t).ag, 50000);
    assert.equal(parseRow('inv', { no: '1', d: '1/1/2025', name: 'x', dr: '9,999,999', cr: '-9,999,999' }, t).why, 'bad-amt', 'תקרה גם אחרי החיסור');
    assert.equal(IMP().agOf('(-5)'), null);
  });
  it('תיקון סבב 1 (ליקויים 3, 4): slotOf – אותו מסמך = כבר יובא; פרטים שונים = שגיאה; אחרי ביטול – _v2.._v9', async () => {
    const { slotOf } = IMP();
    const r = { id: 'x_inv_1', cust: 'c1', ag: 100, k: 'dr', d: '2025-01-01' };
    const db = (m) => async (id) => m[id] || null;
    const x = { cust: 'c1', gross: 100, k: 'dr', d: '2025-01-01', t: 'old' };
    assert.deepEqual(await slotOf(db({}), r), { st: 'new', id: 'x_inv_1' });
    assert.deepEqual(await slotOf(db({ x_inv_1: x }), r), { st: 'dup' });
    for (const ch of [{ cust: 'c2' }, { gross: 101 }, { k: 'cr' }, { d: '2025-01-02' }]) assert.deepEqual(await slotOf(db({ x_inv_1: Object.assign({}, x, ch) }), r), { why: 'dup-diff' }, JSON.stringify(ch));
    const V = Object.assign({}, x, { void: { at: 1 } });
    assert.deepEqual(await slotOf(db({ x_inv_1: V }), r), { st: 'new', id: 'x_inv_1_v2' });
    assert.deepEqual(await slotOf(db({ x_inv_1: V, x_inv_1_v2: x }), r), { st: 'dup' });
    assert.deepEqual(await slotOf(db({ x_inv_1: V, x_inv_1_v2: Object.assign({}, x, { gross: 5 }) }), r), { why: 'dup-diff' });
    const all = {}; all.x_inv_1 = V; for (let v = 2; v <= 9; v++) all['x_inv_1_v' + v] = V;
    assert.deepEqual(await slotOf(db(all), r), { why: 'too-many-v' });
    // יתרת פתיחה בלי תאריך בקובץ (= היום): ייבוא חוזר ביום אחר – עדיין "כבר יובא"
    assert.deepEqual(await slotOf(db({ x_ob_c1: Object.assign({}, x, { t: 'ob', d: '2025-06-01' }) }), Object.assign({}, r, { id: 'x_ob_c1', dd: true })), { st: 'dup' });
  });
});

describe('הרשאות', () => {
  it('עובד – manager-only בכל הפונקציות; בלי התחברות – נדחה', async () => {
    for (const [f, d] of [['arImp', { kind: 'inv', dry: true, rows: [{ no: '1', d: '2025-01-01', amt: 1, name: 'ותיק' }] }], ['arImpVoid', { batch: 'bxxxxxxxx1' }], ['arImpList', {}]]) {
      assert.equal((await call(f, E1, d)).reason, 'manager-only', f);
      assert.notEqual((await call(f, null, d)).status, 'OK', f);
    }
    assert.equal((await all('ardoc')).length, 0);
  });
  it('קלט לא תקין: שדה לא מוכר, יותר מ-25 שורות, סוג לא קיים', async () => {
    assert.equal((await call('arImp', MGR, { batch: 'bxxxxxxxx1', kind: 'inv', rows: [{ no: '1', zz: 1 }] })).reason, 'bad-field');
    assert.equal((await call('arImp', MGR, { batch: 'bxxxxxxxx1', kind: 'inv', rows: Array(26).fill({ no: '1' }) })).reason, 'bad-rows');
    assert.equal((await call('arImp', MGR, { batch: 'bxxxxxxxx1', kind: 'ord', rows: [{ no: '1' }] })).reason, 'bad-kind');
  });
});

describe('לקוחות: שדות עסקיים בייבוא (תשובה 114)', () => {
  it('לקוח עסקי חדש עם ע.מ, איש קשר, תנאי תשלום ומספר לקוח; לקוח קיים מסומן עסקי, תנאי התשלום הקיימים לא נדרסים', async () => {
    const r = await ok(call('importCusts', MGR, { reqId: rid(), rows: [
      { name: 'מאפיית השקד', phone: '0548000001', bn: 'מאפיית השקד בע"מ', vat: '515000001', ct: 'יוסי', terms: { b: 'eom', d: 30 }, xc: '1001', wholesale: true },
      { name: 'ותיק', phone: '0547000001', bn: 'ותיק בע"מ', terms: { b: 'imm', d: 0 }, xc: '1002', wholesale: true },
      { name: 'פרטי', phone: '0548000003', xc: '1003' },
    ] }));
    assert.equal(r.bad.length, 0, JSON.stringify(r.bad));
    const a = await get(`b/${A}/cust/p0548000001`);
    assert.equal(a.wholesale, true); assert.equal(a.bn, 'מאפיית השקד בע"מ'); assert.equal(a.vat, '515000001'); assert.equal(a.ct, 'יוסי');
    assert.deepEqual(a.terms, { b: 'eom', d: 30 }); assert.equal(a.xc, '1001'); assert.equal(a.src, 'import');
    const b = await get(`b/${A}/cust/p0547000001`);
    assert.equal(b.wholesale, true); assert.deepEqual(b.terms, { b: 'eom', d: 60 }, 'fill – לא דורס'); assert.equal(b.xc, '1002'); assert.equal(b.name, 'ותיק');
    const c = await get(`b/${A}/cust/p0548000003`);
    assert.equal(c.wholesale, undefined); assert.equal(c.xc, '1003');
    // ייבוא חוזר: בלי שינוי; wholesale חסר בשורה לא מבטל סימון
    const r2 = await ok(call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'מאפיית השקד', phone: '0548000001', xc: '1001' }] }));
    assert.equal(r2.created, 0); assert.equal((await get(`b/${A}/cust/p0548000001`)).wholesale, true);
    // ע.מ לא תקין – השורה נדחית עם סיבה, השאר ממשיכות
    const r3 = await ok(call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'שגוי', phone: '0548000009', vat: '12', wholesale: true }, { name: 'תקין', phone: '0548000010' }] }));
    assert.equal(r3.bad.length, 1); assert.equal(r3.bad[0].reason, 'bad-vat'); assert.equal(r3.created, 1);
  });
});

// קובץ הדוגמה: 3 לקוחות + יתרות פתיחה + חשבוניות + קבלות + זיכויים
async function sampleCusts() {
  await ok(call('importCusts', MGR, { reqId: rid(), rows: [
    { name: 'מאפיית השקד', phone: '0548000001', bn: 'מאפיית השקד בע"מ', vat: '515000001', xc: '1001', wholesale: true, terms: { b: 'eom', d: 30 } },
    { name: 'מסעדת הגפן', phone: '0548000002', bn: 'מסעדת הגפן', vat: '515000002', xc: '1002', wholesale: true },
    { name: 'קיוסק רמי', phone: '0548000003', xc: '1003' },
  ] }));
}
const SAMPLE = {
  ob: [{ xc: '1001', amt: '1,000.10' }, { vat: '515000002', dr: '0', cr: '250.25' }, { phone: '054-8000003', amt: '99.99' }],
  inv: [{ xc: '1001', no: 'A-100', d: '01/09/2025', amt: '1,180.00', due: '31/10/2025' }, { xc: '1001', no: '2025/101', d: '2025-09-15', amt: 590.5 },
    { vat: '515000002', no: '102', d: '20.09.25', amt: '2,360.33' }, { name: 'קיוסק רמי', no: '103', d: 45930, amt: '-50.00' }, { xc: '1003', no: '104', d: '1-10-2025', amt: '117.01' }],
  rc: [{ xc: '1001', no: '500', d: '05/10/2025', amt: '1,180.00', ref: 'A-100' }, { vat: '515000002', no: '501', d: '2025-10-06', amt: '1000' }, { xc: '1003', no: '502', d: '07/10/2025', amt: '(30.00)' }, { xc: '1003', no: '503', d: '08/10/2025', dr: '', cr: '40.00' }],
  cr: [{ xc: '1001', no: '900', d: '10/10/2025', amt: '-90.50', ref: '2025/101' }, { name: 'מסעדת הגפן', no: '901', d: '11/10/2025', amt: '60.33' }],
};
// סכום הקובץ באגורות (חובה − זכות), מחושב ידנית
const SAMPLE_SUM = (100010 - 25025 + 9999) + (118000 + 59050 + 236033 - 5000 + 11701) - (118000 + 100000 - 3000 + 4000) - (9050 + 6033); // 503: קבלה בעמודת "זכות" (תיקון סבב 1)

describe('קריטריון: קובץ דוגמה מיובא, היתרות = הקובץ עד האגורה, ייבוא שני = 0 חדשים', () => {
  it('לקוחות + יתרות + חשבוניות + קבלות + זיכויים; זיהוי לפי מספר לקוח / ע.מ / טלפון / שם; הקצאה לפי מספר חשבונית', async () => {
    await sampleCusts();
    const before0 = await totalBal();
    assert.equal(before0, 0);
    const res = {};
    for (const k of ['ob', 'inv', 'rc', 'cr']) {
      const pv = await ok(call('arImp', MGR, { kind: k, dry: true, rows: SAMPLE[k], map: { 'מס לקוח': 'xc', 'סכום': 'amt' } }));
      assert.equal(pv.bad, 0, JSON.stringify(pv.rows)); assert.equal(pv.add, SAMPLE[k].length);
      res[k] = await imp(k, SAMPLE[k]);
      assert.equal(res[k].bad, 0, JSON.stringify(res[k].rows)); assert.equal(res[k].add, SAMPLE[k].length); assert.equal(res[k].sum, pv.sum);
    }
    const sum = Object.values(res).reduce((s, r) => s + r.sum, 0);
    assert.equal(sum, SAMPLE_SUM);
    assert.equal(await totalBal(), SAMPLE_SUM, 'סכום היתרות בכרטסות = סכום הקובץ');
    // פירוט לפי לקוח
    assert.equal((await get(`b/${A}/cust/p0548000001`)).ar.bal, 100010 + 118000 + 59050 - 118000 - 9050);
    assert.equal((await get(`b/${A}/cust/p0548000002`)).ar.bal, -25025 + 236033 - 100000 - 6033);
    assert.equal((await get(`b/${A}/cust/p0548000003`)).ar.bal, 9999 - 5000 + 11701 + 3000 - 4000);
    assert.equal((await get(`b/${A}/ardoc/x_rc_503`)).k, 'cr', 'קבלה בעמודת זכות = זכות');
    // מסמכים: מזהה x_{סוג}_{מספר}, מספר מקורי, "מסמך מיובא", בלי קובץ
    const d1 = await get(`b/${A}/ardoc/x_inv_A-100`);
    assert.equal(d1.t, 'old'); assert.equal(d1.ot, 'inv'); assert.equal(d1.ext, 'A-100'); assert.equal(d1.note, 'מסמך מיובא'); assert.equal(d1.d, '2025-09-01'); assert.equal(d1.due, '2025-10-31');
    assert.equal(d1.f, undefined); assert.equal(d1.open, 0, 'נסגרה בקבלה 500 לפי מספר החשבונית'); assert.equal(d1.st, 'paid');
    const h = IMP().keyOf('2025/101');
    assert.match(h, /^h[0-9a-f]{16}$/);
    const d2 = await get(`b/${A}/ardoc/x_inv_${h}`);
    assert.equal(d2.ext, '2025/101'); assert.equal(d2.open, 59050 - 9050, 'הזיכוי 900 הוקצה לחשבונית 2025/101');
    assert.equal((await get(`b/${A}/ardoc/x_inv_103`)).k, 'cr', 'חשבונית שלילית = זכות');
    assert.equal((await get(`b/${A}/ardoc/x_rc_502`)).k, 'dr', 'קבלה שלילית = חובה');
    assert.equal((await get(`b/${A}/ardoc/x_ob_p0548000002`)).k, 'cr');
    assert.equal((await get(`b/${A}/ardoc/x_ob_p0548000001`)).d.length, 10);
    const al = (await all('aralloc')).filter((a) => !a.void);
    assert.ok(al.some((a) => a.rc === 'x_rc_500' && a.inv === 'x_inv_A-100' && a.amt === 118000));
    // לקוח 1002: זכות פתיחה + קבלה + זיכוי מקוזזים מול החשבונית (מהישן לחדש)
    assert.equal((await get(`b/${A}/ardoc/x_inv_102`)).open, 236033 - 25025 - 100000 - 6033);
    const batches = await ok(call('arImpList', MGR, {}));
    assert.equal(batches.batches.length, 4); assert.ok(batches.batches.every((b) => b.st === 'ok'));
    assert.deepEqual(batches.maps.inv, { 'מס לקוח': 'xc', 'סכום': 'amt' }, 'התאמת העמודות נשמרה');
    // ייבוא שני של אותו קובץ = 0 רשומות חדשות
    const nDocs = (await all('ardoc')).length, nAl = (await all('aralloc')).length;
    for (const k of ['ob', 'inv', 'rc', 'cr']) {
      const pv = await ok(call('arImp', MGR, { kind: k, dry: true, rows: SAMPLE[k] }));
      assert.equal(pv.add, 0); assert.equal(pv.dup, SAMPLE[k].length);
      const r = await imp(k, SAMPLE[k]);
      assert.equal(r.add, 0, k); assert.equal(r.dup, SAMPLE[k].length, k);
    }
    assert.equal((await all('ardoc')).length, nDocs); assert.equal((await all('aralloc')).length, nAl);
    assert.equal(await totalBal(), SAMPLE_SUM);
    // תיקון סבב 1 (ליקוי 3): אותו מספר עם לקוח / סכום / תאריך שונים – שגיאה בשורה, לא "כבר יובא"
    const diff = [{ xc: '1001', no: 'A-100', d: '01/09/2025', amt: '1,180.00' }, { xc: '1002', no: 'A-100', d: '01/09/2025', amt: '1,180.00' }, { xc: '1001', no: 'A-100', d: '01/09/2025', amt: '1,180.01' }, { xc: '1001', no: 'A-100', d: '02/09/2025', amt: '1,180.00' }];
    const pvd = []; // כל שורה בקובץ נפרד (באותו קובץ – "מופיע פעמיים בקובץ")
    for (const row of diff) pvd.push(await ok(call('arImp', MGR, { kind: 'inv', dry: true, rows: [row] })));
    assert.deepEqual(pvd.map((p) => (p.rows[0].ok ? p.rows[0].st : p.rows[0].why)), ['dup', 'dup-diff', 'dup-diff', 'dup-diff']);
    assert.ok(pvd[1].rows[0].msg.includes('מספר מסמך כפול עם נתונים שונים'));
    assert.deepEqual(pvd.map((p) => [p.add, p.dup, p.bad]), [[0, 1, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1]]);
    const rd = await imp('inv', diff.slice(1, 2));
    assert.equal(rd.add, 0); assert.equal(rd.bad, 1); assert.equal(rd.rows[0].why, 'dup-diff');
    assert.equal(await totalBal(), SAMPLE_SUM);
    // תוצרים נוספים: הכנסות לא נרשמות (אין tx), ו-arDoc על מסמך מיובא נדחה (אין קובץ)
    assert.equal((await call('arDoc', MGR, { id: 'x_inv_A-100', op: 'pdf' })).reason, 'imported');
  });

  it('שגיאות: לקוח לא נמצא, כמה לקוחות באותו שם, כפילות בתוך הקובץ, תאריך/סכום לא תקינים – השורות האחרות מיובאות', async () => {
    await sampleCusts();
    const rows = [{ name: 'לא קיים', no: '1', d: '2025-01-01', amt: 10 }, { name: 'כפול', no: '2', d: '2025-01-01', amt: 10 }, { xc: '1001', no: '3', d: '2025-01-01', amt: 10 },
      { xc: '1001', no: '3', d: '2025-01-02', amt: 11 }, { xc: '1001', no: '4', d: '31/02/2025', amt: 10 }, { xc: '1001', no: '5', d: '2025-01-01', amt: 'עשר' }, { phone: '0547000002', no: '6', d: '2025-01-01', amt: 7 }];
    const pv = await ok(call('arImp', MGR, { kind: 'inv', dry: true, rows }));
    assert.deepEqual(pv.rows.map((r) => r.ok ? 'ok' : r.why), ['no-cust', 'cust-many', 'ok', 'dup-file', 'bad-date', 'bad-amt', 'ok']);
    assert.ok(pv.rows[1].msg.includes('כמה לקוחות'));
    const r = await imp('inv', rows);
    assert.equal(r.add, 2); assert.equal(r.bad, 5); assert.equal(r.sum, 1700);
    assert.equal((await get(`b/${A}/ardoc/x_inv_6`)).cust, 'cDUP1aaaaaaaaaaaaaaaaaaa', 'זיהוי לפי טלפון כשהשם כפול');
    await totalBal();
  });
});

describe('500 שורות', () => {
  it('תצוגה מקדימה בקריאה אחת, ייבוא ב-20 מנות של 25, סכום = קובץ, ייבוא חוזר = 0', async () => {
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push({ name: 'לקוח ' + i, phone: '05490000' + String(i).padStart(2, '0'), xc: 'K' + i });
    await ok(call('importCusts', MGR, { reqId: rid(), rows }));
    const L = []; let exp = 0;
    for (let j = 0; j < 500; j++) {
      const a = ((j * 7919) % 100000) + 1 - (j % 9 === 0 ? 60000 : 0) || 3; // כולל סכומים שליליים
      exp += a;
      L.push({ xc: 'K' + (j % 10), no: String(10000 + j), d: fmtD(2025, 1 + (j % 12), 1 + (j % 28), j), amt: fmtAg(a, j) });
    }
    const pv = await ok(call('arImp', MGR, { kind: 'inv', dry: true, rows: L }));
    assert.equal(pv.add, 500, JSON.stringify(pv.rows.filter((r) => !r.ok).slice(0, 3))); assert.equal(pv.sum, exp);
    const t0 = Date.now();
    const r = await imp('inv', L);
    assert.equal(r.add, 500); assert.equal(r.sum, exp);
    assert.equal(await totalBal(), exp, 'סכום היתרות = סכום הקובץ');
    const r2 = await imp('inv', L);
    assert.equal(r2.add, 0); assert.equal(r2.dup, 500);
    assert.equal((await all('ardoc')).length, 500);
    assert.ok(Date.now() - t0 < 300000);
  });
});

describe('ביטול קבוצה = void, ושילוב עם קבלות וחשבוניות חדשות', () => {
  it('קבלה חדשה סוגרת חוב מיובא; ביטול קבוצה מחזיר את היתרות, הקבלה חוזרת לזכות; ייבוא קובץ מתוקן אחרי ביטול', async () => {
    await sampleCusts();
    const ob = await imp('ob', [{ xc: '1001', amt: '1000' }, { xc: '1002', amt: '-200' }]);
    const inv = await imp('inv', [{ xc: '1001', no: '7', d: '2025-01-01', amt: '500' }]);
    // קבלה חדשה (מכרטיס הלקוח) – סוגרת קודם את החוב המיובא
    const rc = await ok(call('arReceipt', MGR, { reqId: rid(), cust: 'p0548000001', amt: 1200, method: 'cash' }));
    assert.equal(rc.left, 0);
    assert.deepEqual(rc.alloc.map((a) => a.inv).sort(), ['x_inv_7', 'x_ob_p0548000001']);
    assert.equal(await balanced('p0548000001'), 30000);
    const before = await totalBal();
    // ביטול יתרות הפתיחה: חוב 1000 נעלם; ההקצאה מבוטלת, והקבלה החדשה מקבלת חזרה זכות
    const v = await ok(call('arImpVoid', MGR, { batch: ob.batch, reason: 'קובץ שגוי' }));
    assert.equal(v.voided, 2); assert.equal(v.left, 0);
    const d = await get(`b/${A}/ardoc/x_ob_p0548000001`);
    assert.equal(d.st, 'void'); assert.equal(d.open, 0); assert.equal(d.void.why, 'קובץ שגוי'); assert.equal(d.gross, 100000, 'התוכן לא נמחק');
    assert.equal(await balanced('p0548000001'), 30000 - 100000);
    assert.equal(await balanced('p0548000002'), 0);
    assert.equal(await totalBal(), before - 100000 + 20000);
    const rcd = await get(`b/${A}/ardoc/${rc.id}`);
    assert.ok(rcd.open > 0, 'הקבלה חזרה להיות זכות');
    // אי אפשר להוסיף לקבוצה מבוטלת; ביטול חוזר – כלום
    assert.equal((await call('arImp', MGR, { batch: ob.batch, kind: 'ob', rows: [{ xc: '1001', amt: '1' }] })).reason, 'batch-void');
    assert.equal((await ok(call('arImpVoid', MGR, { batch: ob.batch }))).voided, 0);
    // קובץ מתוקן: אותו לקוח – מזהה חדש _v2, והזכות של הקבלה מקוזזת מולו
    const ob2 = await imp('ob', [{ xc: '1001', amt: '900' }]);
    assert.equal(ob2.add, 1);
    const n2 = await get(`b/${A}/ardoc/x_ob_p0548000001_v2`);
    assert.equal(n2.gross, 90000); assert.equal(n2.open, 90000 - 70000, 'הזכות שחזרה לקבלה קוזזה');
    assert.equal(await balanced('p0548000001'), 30000 - 100000 + 90000);
    assert.equal((await imp('ob', [{ xc: '1001', amt: '900' }])).add, 0, 'ייבוא חוזר של הקובץ המתוקן = 0');
    // תיקון סבב 1 (ליקוי 4): התצוגה המקדימה בודקת גם _v2 – תואמת לייבוא בפועל
    const pv2 = await ok(call('arImp', MGR, { kind: 'ob', dry: true, rows: [{ xc: '1001', amt: '900' }] }));
    assert.equal(pv2.add, 0); assert.equal(pv2.dup, 1); assert.equal(pv2.sum, 0);
    const pv3 = await ok(call('arImp', MGR, { kind: 'ob', dry: true, rows: [{ xc: '1001', amt: '1000' }] }));
    assert.equal(pv3.rows[0].why, 'dup-diff', 'הקובץ המקורי (1000) מול המתוקן שיובא (900)');
    // זכות פתיחה מיובאת מחדש (_v2) נשארת זכות פתוחה (אין חוב לקזז)
    await imp('ob', [{ xc: '1002', amt: '-200' }]);
    assert.equal((await get(`b/${A}/ardoc/x_ob_p0548000002_v2`)).open, 20000);
    assert.equal(await balanced('p0548000002'), -20000);
    // ביטול חשבוניות שנסגרו בקבלה חדשה – החשבונית מבוטלת והקבלה מקבלת את הסכום כזכות
    const v2 = await ok(call('arImpVoid', MGR, { batch: inv.batch }));
    assert.equal(v2.voided, 1);
    assert.equal(await balanced('p0548000001'), 30000 - 100000 + 90000 - 50000);
    assert.ok((await all('aralloc')).filter((a) => a.inv === 'x_inv_7').every((a) => a.void), 'ההקצאה לחשבונית שבוטלה מבוטלת');
    const list = await ok(call('arImpList', MGR, {}));
    assert.equal(list.batches.find((b) => b.id === ob.batch).st, 'void');
    assert.equal(list.batches.find((b) => b.id === ob2.batch).st, 'ok');
  });

  it('תיקון סבב 1 (ליקוי 2): PDF של קבלה חדשה על חוב מיובא – המספר המקורי ו"יתרת פתיחה", בלי מזהה פנימי', async () => {
    const { extract } = require('./pdf-text');
    await sampleCusts();
    await prep((d) => d.doc(`b/${A}/arcfg/seq_rcD`).set({ n: 700 })); // Storage לא מתנקה בין בדיקות – מספר קבלה חדש
    await imp('ob', [{ xc: '1001', amt: '100' }]);
    await imp('inv', [{ xc: '1001', no: '2025/101', d: '2025-01-01', amt: '50' }]);
    const rc = await ok(call('arReceipt', MGR, { reqId: rid(), cust: 'p0548000001', amt: 150, method: 'cash' }));
    assert.equal(rc.alloc.length, 2);
    const p = await ok(call('arDoc', MGR, { id: rc.id, op: 'pdf' }));
    const txt = extract(Buffer.from(p.b64, 'base64')).flat().join('\n');
    const heb = (w) => txt.includes(w) || txt.includes([...w].reverse().join(''));
    assert.ok(txt.includes('2025/101') || txt.includes('101/2025'), txt);
    assert.ok(heb('יתרת פתיחה') || heb('פתיחה'), txt);
    assert.ok(!/x_|p0548000001|h[0-9a-f]{16}/.test(txt), txt);
  });

  it('ביטול קבוצה גדולה במנות של 25 (left)', async () => {
    await sampleCusts();
    const L = Array.from({ length: 60 }, (_, j) => ({ xc: '100' + (1 + (j % 3)), no: 'R' + j, d: '2025-02-01', amt: j % 2 ? '10.01' : '-3' }));
    const r = await imp('inv', L);
    assert.equal(r.add, 60);
    let left = -1, calls = 0;
    while (left !== 0) { const v = await ok(call('arImpVoid', MGR, { batch: r.batch })); left = v.left; calls++; assert.ok(calls < 10); }
    assert.equal(calls, 3);
    assert.equal(await totalBal(), 0);
    assert.ok((await all('ardoc')).every((x) => x.void && x.st === 'void'));
    assert.ok((await all('aralloc')).every((a) => a.void));
  });
});
