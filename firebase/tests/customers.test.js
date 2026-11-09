'use strict';
// לקוחות (fb/ord-cust): functions/customers.js + חוקי cust/custcfg. רץ מול האמולטור, חלק מ-test:multibiz.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-o';
const B2 = 'biz-p';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'r_mgr', E1 = 'r_e1', E2 = 'r_e2', NOORD = 'r_no', SUPER = 'r_super';
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
let env, n = 0;
const rid = () => 'req' + Date.now().toString(36) + (n++) + 'xx';
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };
async function seed(features) {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: features || ALL,
      org: { v: 1, branches: [{ id: 'br1', name: 'נחל לכיש', on: true, sig: [] }, { id: 'br2', name: 'יהודה הנשיא', on: true, sig: [] }], banks: [], cards: [] } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: MGR, role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true, br: ['br1'] });
    b.set(d.doc(`b/${A}/staff/${E2}`), { name: E2, role: 'employee', active: true, br: ['br2'] });
    b.set(d.doc(`b/${A}/staff/${NOORD}`), { name: NOORD, role: 'employee', active: true, perms: NONE });
    for (const [u, role] of [[MGR, 'admin'], [E1, 'worker'], [E2, 'worker'], [NOORD, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/prod/pA`), { name: 'עוגה', price: 10, barcode: '', on: true, q: { br1: 3, br2: 0 } });
    b.set(d.doc(`b/${A}/prod/pA/p/cost`), { cost: 4 });
    b.set(d.doc(`b/${A}/prod/pB`), { name: 'לחם', price: 7.5, barcode: '729', on: true, q: { br1: 0, br2: 10 } });
    b.set(d.doc('b/' + B2), { name: 'ב', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: features || ALL });
    b.set(d.doc(`b/${B2}/admins/m2`), { email: 'm2@x.invalid' });
    b.set(d.doc('users/m2'), { bizId: B2, role: 'admin', active: true, bizStatus: 'active', email: 'm2@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/custcfg/main`), { xKeys: [{ k: 'xcity', label: 'עיר' }] });
    await b.commit();
  });
}

const TZ = '123456782', TZ2 = '000000018';
const c1 = { name: 'דנה', phone: '050-1234567', tz: TZ };
before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => seed());

describe('לקוחות – saveCust', () => {
  it('לקוח חדש לפי ת"ז → cust/t{tz}, רגיל (בלי wholesale), src manual', async () => {
    const r = await call('saveCust', E1, { cust: Object.assign({ mail: 'D@x.co', addr: 'הרצל 1', x: { xcity: 'אשדוד' } }, c1) });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.id, 't' + TZ); assert.ok(r.result.created);
    const d = await get(`b/${A}/cust/t${TZ}`);
    assert.equal(d.phone, '0501234567'); assert.equal(d.mail, 'd@x.co'); assert.equal(d.x.xcity, 'אשדוד'); assert.equal(d.wholesale, undefined); assert.equal(d.src, 'manual');
  });
  it('fill:true לא דורס, רק ממלא ריקים; בלי fill – דורס', async () => {
    await call('saveCust', E1, { cust: c1 });
    await call('saveCust', E1, { fill: true, cust: { tz: TZ, name: 'אחר', addr: 'בן גוריון 2' } });
    let d = await get(`b/${A}/cust/t${TZ}`); assert.equal(d.name, 'דנה'); assert.equal(d.addr, 'בן גוריון 2');
    await call('saveCust', E1, { cust: { tz: TZ, name: 'דנה לוי' } });
    d = await get(`b/${A}/cust/t${TZ}`); assert.equal(d.name, 'דנה לוי');
  });
  it('בלי ת"ז → p{phone}; כשנוספת ת"ז – מועבר ל-t{tz}, הישן מסומן mv ולא נמחק', async () => {
    const r = await call('saveCust', E1, { cust: { name: 'יוסי', phone: '0521112222' } });
    assert.equal(r.result.id, 'p0521112222');
    const r2 = await call('saveCust', E1, { fill: true, cust: { phone: '0521112222', tz: TZ2 } });
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.id, 't' + TZ2);
    assert.equal((await get(`b/${A}/cust/t${TZ2}`)).name, 'יוסי');
    assert.equal((await get(`b/${A}/cust/p0521112222`)).mv, 't' + TZ2);
  });
  it('ולידציה: ת"ז שגויה, last4 של 5 ספרות, שדה חופשי עם 8 ספרות, שדה חופשי לא מוגדר, שדה זר (card)', async () => {
    const bad = async (cust, reason) => { const r = await call('saveCust', E1, { cust }); assert.equal(r.status, 'INVALID_ARGUMENT', r.text); assert.equal(r.reason, reason); };
    await bad(Object.assign({}, c1, { tz: '123456789' }), 'bad-tz');
    await bad(Object.assign({}, c1, { last4: '12345' }), 'bad-last4');
    await bad(Object.assign({}, c1, { x: { xcity: '45801234' } }), 'card-like');
    await bad(Object.assign({}, c1, { x: { xzzz: 'a' } }), 'bad-x');
    await bad(Object.assign({}, c1, { card: '4580123456789012' }), 'bad-field');
  });
  it('מספר כרטיס עם נקודות / לוכסנים / קו תחתון בשם, בכתובת ובשדה חופשי – נדחה; ב-last4 – נחתך', async () => {
    for (const v of ['4580.1234.1234.1234', '4580/1234/1234/1234', '4580_1234_1234_1234', '4580 . 1234 . 1234 . 1234']) {
      for (const f of [{ name: 'x ' + v }, { addr: 'רחוב ' + v }, { x: { xcity: v } }]) {
        const r = await call('saveCust', E1, { cust: Object.assign({}, c1, f) });
        assert.equal(r.reason, 'card-like', v + ' ' + JSON.stringify(f) + ' ' + r.text);
      }
      const r = await call('saveCust', E1, { cust: Object.assign({}, c1, { last4: v }) });
      assert.equal(r.status, 'OK', r.text); assert.equal((await get(`b/${A}/cust/t${TZ}`)).last4, '1234');
    }
    const r = await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'א', phone: '0501111111', x: { xcity: '5326.1000.2000.3456' } }, { name: 'ב', phone: '0502222222', addr: 'הרצל 4580/1234/5678/9012' }] });
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/cust/p0501111111`)).last4, '3456');
    assert.deepEqual(r.result.bad.map((x) => [x.i, x.reason]), [[1, 'card-like']]);
    assert.ok(!r.text.includes('5326') && !r.text.includes('4580'));
  });
  it('מספר כרטיס עם כל מפריד שאינו אות/ספרה (– — ־ = ! U+200F U+200B NBSP @ ×) בשם, בכתובת, במייל ובשדה חופשי – נדחה; ב-last4 – נחתך', async () => {
    for (const sep of ['\u2013', '\u2014', '\u05BE', '=', '!', '\u200F', '\u200B', '\u00A0', '\u2060', '×', '(', '%']) {
      const v = ['4580', '1234', '5678', '9012'].join(sep);
      for (const f of [{ name: 'x ' + v }, { addr: 'רחוב ' + v }, { x: { xcity: v } }].concat(/\s/.test(sep) ? [] : [{ mail: v + '@x.com' }])) { // רווח במייל נדחה כבר כ-bad-email
        const r = await call('saveCust', E1, { cust: Object.assign({}, c1, f) });
        assert.equal(r.reason, 'card-like', JSON.stringify(sep) + ' ' + JSON.stringify(f) + ' ' + r.text);
      }
      const r = await call('saveCust', E1, { cust: Object.assign({}, c1, { last4: v }) });
      assert.equal(r.status, 'OK', r.text); assert.equal((await get(`b/${A}/cust/t${TZ}`)).last4, '9012');
    }
    const ok = await call('saveCust', E1, { cust: Object.assign({}, c1, { addr: 'רחוב 12 דירה 3456 כניסה 5678' }) }); // אות מפרידה בין רצפים
    assert.equal(ok.status, 'OK', ok.text);
  });
  it('last4 עם מספר כרטיס מלא → נחתך ל-4 ספרות; המספר המלא לא נשמר בשום מקום', async () => {
    const r = await call('saveCust', E1, { cust: Object.assign({}, c1, { last4: '4580-1234-5678-9012' }) });
    assert.equal(r.status, 'OK', r.text);
    const d = await get(`b/${A}/cust/t${TZ}`); assert.equal(d.last4, '9012');
    assert.ok(!JSON.stringify(d).includes('45801234')); assert.ok(!r.text.includes('45801234'));
  });
  it('סיטונאי: עובד לא יכול (גם false); מנהל מסמן ומבטל', async () => {
    let r = await call('saveCust', E1, { cust: c1, wholesale: true }); assert.equal(r.reason, 'manager-only');
    r = await call('saveCust', E1, { cust: c1, wholesale: false }); assert.equal(r.reason, 'manager-only');
    r = await call('saveCust', MGR, { cust: c1, wholesale: true }); assert.equal(r.status, 'OK', r.text);
    assert.equal((await get(`b/${A}/cust/t${TZ}`)).wholesale, true);
    await call('saveCust', E1, { cust: { tz: TZ, addr: 'x 1' } }); // עדכון של עובד לא מוריד סיטונאי
    assert.equal((await get(`b/${A}/cust/t${TZ}`)).wholesale, true);
    r = await call('saveCust', MGR, { cust: { tz: TZ }, wholesale: false });
    assert.equal((await get(`b/${A}/cust/t${TZ}`)).wholesale, false);
  });
  it('עובד בלי ord / תוספת כבויה – נחסם', async () => {
    assert.equal((await call('saveCust', NOORD, { cust: c1 })).reason, 'no-perm');
    await seed(Object.assign({}, ALL, { orders: false }));
    assert.equal((await call('saveCust', MGR, { cust: c1 })).status, 'FAILED_PRECONDITION');
  });
});

describe('לקוחות – importCusts', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ name: 'לקוח ' + i, phone: '05' + String(20000000 + i).padStart(8, '0') }));
  it('500 לקוחות ב-3 מנות; ייבוא חוזר – אין כפולים, לא דורס', async () => {
    const all = rows(500);
    for (let i = 0; i < 500; i += 200) { const r = await call('importCusts', MGR, { reqId: rid(), rows: all.slice(i, i + 200) }); assert.equal(r.status, 'OK', r.text.slice(0, 300)); assert.equal(r.result.bad.length, 0); }
    assert.equal((await coll(`b/${A}/cust`)).length, 500);
    const again = all.slice(0, 200).map((x) => Object.assign({}, x, { name: 'שונה' }));
    const r = await call('importCusts', MGR, { reqId: rid(), rows: again });
    assert.equal(r.result.created, 0);
    assert.equal((await coll(`b/${A}/cust`)).length, 500);
    assert.equal((await get(`b/${A}/cust/p0520000000`)).name, 'לקוח 0');
  });
  it('עמודת כרטיס מלא (ב-last4 או בשדה חופשי) → נשמרות 4 אחרונות בלבד; last4 של 5 ספרות → שורה שגויה; wholesale מתעלמים', async () => {
    const r = await call('importCusts', MGR, { reqId: rid(), rows: [
      { name: 'א', phone: '0501111111', last4: '4580123456789012', wholesale: true },
      { name: 'ב', phone: '0502222222', x: { xcity: '5326 1000 2000 3456' } },
      { name: 'ג', phone: '0503333333', last4: '12345' },
      { name: 'ד', phone: 'abc' }] });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.created, 2); assert.deepEqual(r.result.bad.map((x) => [x.i, x.reason]), [[2, 'bad-last4'], [3, 'bad-phone']]);
    const a = await get(`b/${A}/cust/p0501111111`), b = await get(`b/${A}/cust/p0502222222`);
    assert.equal(a.last4, '9012'); assert.equal(a.wholesale, undefined); assert.equal(b.last4, '3456'); assert.deepEqual(b.x, {});
    assert.ok(!r.text.includes('4580123456789012') && !JSON.stringify(a).includes('45801234') && !JSON.stringify(b).includes('53261000'));
  });
  it('אותו reqId = מנה אחת; עובד לא מייבא', async () => {
    const q = rid();
    await call('importCusts', MGR, { reqId: q, rows: rows(3) });
    assert.ok((await call('importCusts', MGR, { reqId: q, rows: rows(5) })).result.dup);
    assert.equal((await coll(`b/${A}/cust`)).length, 3);
    assert.equal((await call('importCusts', E1, { reqId: rid(), rows: rows(1) })).reason, 'manager-only');
  });
});

describe('לקוחות – setCustCfg וחוקים', () => {
  it('setCustCfg: מנהל בלבד, יוצר מזהה, דוחה 21 שדות', async () => {
    assert.equal((await call('setCustCfg', E1, { xKeys: [{ label: 'א' }] })).reason, 'manager-only');
    const r = await call('setCustCfg', MGR, { xKeys: [{ k: 'xcity', label: 'עיר' }, { label: 'תאריך ניוד' }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.xKeys.length, 2); assert.match(r.result.xKeys[1].k, /^x[0-9a-z]+$/);
    assert.equal((await call('setCustCfg', MGR, { xKeys: Array.from({ length: 21 }, (_, i) => ({ label: 'ש' + i })) })).reason, 'bad-x');
  });
  it('חוקים: עובד עם ord ומנהל קוראים; בלי ord – לא; אף אחד לא כותב (גם wholesale); עסק אחר – לא', async () => {
    await call('saveCust', E1, { cust: c1 });
    const p = `b/${A}/cust/t${TZ}`;
    await assertSucceeds(db(E1).doc(p).get());
    await assertSucceeds(db(MGR).doc(p).get());
    await assertSucceeds(db(E1).doc(`b/${A}/custcfg/main`).get());
    await assertFails(db(NOORD).doc(p).get());
    await assertFails(db('m2').doc(p).get());
    await assertFails(db(MGR).doc(p).update({ wholesale: true }));
    await assertFails(db(E1).doc(p).update({ wholesale: true }));
    await assertFails(db(MGR).doc(`b/${A}/cust/tnew`).set({ name: 'x' }));
    await assertFails(db(MGR).doc(`b/${A}/custcfg/main`).set({ xKeys: [] }));
  });
  it('ת"ז של לקוח בעסק אחר – לא נגיש מהעסק השני (cust בתוך b/{bizId})', async () => {
    await call('saveCust', MGR, { cust: c1 });
    const r = await call('saveCust', 'm2', { cust: { tz: TZ } }); // אין לקוח בעסק ב → חובה שם וטלפון
    assert.equal(r.reason, 'bad-name');
    assert.equal(await get(`b/${B2}/cust/t${TZ}`), null);
  });
});

// ---------- fb/ord-card: כרטיס מלא מוצפן ----------
describe('כרטיס אשראי מוצפן – setCard/getCard/delCard, ייבוא, חוקים', () => {
  const CARD = { num: '4580 1234 5678 9012', exp: '07/28', name: 'Dana Levi', cvv: '123' };
  const leak = (s) => /4580123456789012|4580 1234 5678 9012|"123"|Dana Levi/.test(s);
  async function mkOrd(id, status, br, custId) { await prep((d) => d.doc(`b/${A}/ord/${id}`).set({ no: 1, br, status, custId, total: 1, items: [], cust: { name: 'x', phone: '0501234567' }, at: 1 })); }
  it('מנהל שומר; ב-Firestore רק מוצפן + 4 ספרות; צפייה מחזירה הכול ונרשמת ביומן; מחיקה', async () => {
    await call('saveCust', MGR, { cust: c1 });
    const r = await call('setCard', MGR, { custId: 't' + TZ, card: CARD });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.last4, '9012');
    const cu = await get(`b/${A}/cust/t${TZ}`), p = await get(`b/${A}/cust/t${TZ}/p/card`);
    assert.equal(cu.last4, '9012'); assert.equal(cu.card, true); assert.ok(p.box && p.box.ct && p.box.iv && p.box.tag);
    assert.ok(!leak(JSON.stringify(cu) + JSON.stringify(p)));
    const v = await call('getCard', MGR, { custId: 't' + TZ, act: 'view' });
    assert.equal(v.status, 'OK', v.text); assert.deepEqual(v.result.card, { num: '4580123456789012', exp: '07/28', name: 'Dana Levi', cvv: '123' });
    const lg = await coll(`b/${A}/cardLog`);
    assert.deepEqual(lg.map((x) => x.act).sort(), ['set', 'view']); assert.ok(lg.every((x) => x.by === MGR && x.cust === 't' + TZ && typeof x.t === 'number'));
    assert.ok(!leak(JSON.stringify(lg)));
    assert.equal((await call('delCard', MGR, { custId: 't' + TZ })).status, 'OK');
    assert.equal(await get(`b/${A}/cust/t${TZ}/p/card`), null);
    const cu2 = await get(`b/${A}/cust/t${TZ}`); assert.equal(cu2.card, undefined); assert.equal(cu2.last4, undefined);
    assert.equal((await call('getCard', MGR, { custId: 't' + TZ, act: 'view' })).reason, 'no-card');
    assert.ok((await coll(`b/${A}/cardLog`)).some((x) => x.act === 'del'));
  });
  it('ולידציה: מספר קצר, תוקף 13, CVV 5 ספרות, שדה זר – נדחים בלי להחזיר את הערך', async () => {
    await call('saveCust', MGR, { cust: c1 });
    for (const [card, reason] of [[{ num: '123456' }, 'bad-card-num'], [{ num: '4580123456789012', exp: '13/28' }, 'bad-card-exp'], [{ num: '4580123456789012', cvv: '12345' }, 'bad-card-cvv'], [{ num: '4580123456789012', pin: '1' }, 'bad-field']]) {
      const r = await call('setCard', MGR, { custId: 't' + TZ, card }); assert.equal(r.reason, reason, r.text); assert.ok(!r.text.includes('4580123456789012'));
    }
  });
  it('עובד: לא רואה (view); מעתיק מספר בלבד רק בהזמנה שלא שולמה, מקושרת, בסניף שלו – ונרשם ביומן', async () => {
    await call('saveCust', MGR, { cust: c1 }); await call('setCard', MGR, { custId: 't' + TZ, card: CARD });
    const id = 't' + TZ;
    await mkOrd('oOpen', 'wait_pay', 'br1', id); await mkOrd('oPaid', 'paid', 'br1', id); await mkOrd('oOther', 'new', 'br1', 'p0500000000'); await mkOrd('oBr2', 'new', 'br2', id);
    assert.equal((await call('getCard', E1, { custId: id, act: 'view', ordId: 'oOpen' })).reason, 'manager-only');
    assert.equal((await call('getCard', E1, { custId: id, act: 'copy' })).reason, 'need-ord');
    assert.equal((await call('getCard', E1, { custId: id, act: 'copy', ordId: 'oPaid' })).reason, 'ord-paid');
    assert.equal((await call('getCard', E1, { custId: id, act: 'copy', ordId: 'oOther' })).reason, 'not-linked');
    assert.equal((await call('getCard', E1, { custId: id, act: 'copy', ordId: 'oBr2' })).reason, 'foreign-br');
    assert.equal((await call('getCard', NOORD, { custId: id, act: 'copy', ordId: 'oOpen' })).reason, 'no-perm');
    const r = await call('getCard', E1, { custId: id, act: 'copy', ordId: 'oOpen' });
    assert.equal(r.status, 'OK', r.text); assert.deepEqual(r.result.card, { num: '4580123456789012' });
    const lg = (await coll(`b/${A}/cardLog`)).filter((x) => x.act === 'copy');
    assert.equal(lg.length, 1); assert.equal(lg[0].by, E1); assert.equal(lg[0].ord, 'oOpen'); assert.equal(lg[0].f, 'num');
    assert.equal((await call('delCard', E1, { custId: id })).reason, 'manager-only');
    assert.equal((await call('setCard', E1, { custId: id, card: CARD })).reason, 'need-ord');
    assert.equal((await call('setCard', E1, { custId: id, card: CARD, ordId: 'oOpen' })).status, 'OK');
  });
  it('הפרדת עסקים: מנהל עסק אחר לא מגיע; מוצפן שהועתק לעסק אחר לא נפתח (מפתח לכל עסק)', async () => {
    await call('saveCust', MGR, { cust: c1 }); await call('setCard', MGR, { custId: 't' + TZ, card: CARD });
    assert.equal((await call('getCard', 'm2', { custId: 't' + TZ, act: 'view' })).reason, 'no-card');
    const p = await get(`b/${A}/cust/t${TZ}/p/card`);
    await prep(async (d) => { await d.doc(`b/${B2}/cust/t${TZ}`).set({ name: 'x', phone: '0501234567', tz: TZ }); await d.doc(`b/${B2}/cust/t${TZ}/p/card`).set(p); });
    const r = await call('getCard', 'm2', { custId: 't' + TZ, act: 'view' });
    assert.equal(r.reason, 'bad-box', r.text); assert.ok(!r.text.includes('4580'));
  });
  it('ייבוא: card מלא + CVV נשמר מוצפן, last4 בלקוח; ייבוא חוזר לא דורס; שגוי → שורה שגויה', async () => {
    const r = await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'א', phone: '0501111111', card: { num: '5326100020003456', exp: '2029-03', name: 'A B', cvv: '9876' } }, { name: 'ב', phone: '0502222222', card: { num: '12' } }] });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.created, 1); assert.deepEqual(r.result.bad.map((x) => [x.i, x.reason]), [[1, 'bad-card-num']]);
    assert.ok(!r.text.includes('5326100020003456'));
    assert.equal((await get(`b/${A}/cust/p0501111111`)).last4, '3456');
    const v = await call('getCard', MGR, { custId: 'p0501111111', act: 'view' });
    assert.deepEqual(v.result.card, { num: '5326100020003456', exp: '03/29', name: 'A B', cvv: '9876' });
    await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'א', phone: '0501111111', card: { num: '4111111111111111' } }] });
    assert.equal((await call('getCard', MGR, { custId: 'p0501111111', act: 'view' })).result.card.num, '5326100020003456');
  });
  it('חוקים: המוצפן לא קריא לאף אחד (גם מנהל); cardLog – מנהל קורא, עובד לא; אין כתיבה', async () => {
    await call('saveCust', MGR, { cust: c1 }); await call('setCard', MGR, { custId: 't' + TZ, card: CARD });
    const p = `b/${A}/cust/t${TZ}/p/card`;
    await assertFails(db(MGR).doc(p).get()); await assertFails(db(E1).doc(p).get()); await assertFails(db(SUPER).doc(p).get());
    await assertFails(db(MGR).collection(`b/${A}/cust/t${TZ}/p`).get());
    await assertFails(db(MGR).doc(p).set({ box: {} }));
    await assertSucceeds(db(MGR).collection(`b/${A}/cardLog`).get());
    await assertFails(db(E1).collection(`b/${A}/cardLog`).get());
    await assertFails(db('m2').collection(`b/${A}/cardLog`).get());
    await assertFails(db(MGR).collection(`b/${A}/cardLog`).add({ t: 1 }));
    await assertFails(db(MGR).doc(`b/${A}/cardQ/${MGR}`).get()); await assertFails(db(MGR).doc(`b/${A}/cardQ/${MGR}`).set({ mn: 0 }));
  });
  it('ליקוי 2: מעבר מטלפון לת"ז – המוצפן מוצפן מחדש לנתיב החדש, הישן נמחק, נרשם move; הישן נדחה ב-getCard', async () => {
    await call('saveCust', MGR, { cust: { name: 'יוסי', phone: '0521112222' } });
    assert.equal((await call('setCard', MGR, { custId: 'p0521112222', card: CARD })).status, 'OK');
    const r = await call('saveCust', E1, { fill: true, cust: { phone: '0521112222', tz: TZ2 } });
    assert.equal(r.status, 'OK', r.text); assert.ok(!leak(r.text));
    assert.equal(await get(`b/${A}/cust/p0521112222/p/card`), null);
    const old = await get(`b/${A}/cust/p0521112222`); assert.equal(old.mv, 't' + TZ2); assert.equal(old.card, undefined);
    const nu = await get(`b/${A}/cust/t${TZ2}`); assert.equal(nu.card, true); assert.equal(nu.last4, '9012');
    const v = await call('getCard', MGR, { custId: 't' + TZ2, act: 'view' });
    assert.equal(v.status, 'OK', v.text); assert.equal(v.result.card.num, '4580123456789012'); assert.equal(v.result.card.cvv, '123');
    assert.equal((await call('getCard', MGR, { custId: 'p0521112222', act: 'view' })).reason, 'no-card');
    assert.ok((await coll(`b/${A}/cardLog`)).some((x) => x.act === 'move' && x.cust === 't' + TZ2 && x.from === 'p0521112222'));
    // לקוח עם סימון card בלי מוצפן / בלי סימון – getCard מסרב
    await prep((d) => d.doc(`b/${A}/cust/p0533333333`).set({ name: 'z', phone: '0533333333' }));
    assert.equal((await call('getCard', MGR, { custId: 'p0533333333', act: 'view' })).reason, 'no-card');
  });
  it('ליקוי 3: עובד בלי רשימת סניפים = כל הסניפים (כמו orders.js); הזמנה בלי סניף – בלי בדיקת סניף', async () => {
    await call('saveCust', MGR, { cust: c1 }); await call('setCard', MGR, { custId: 't' + TZ, card: CARD });
    const id = 't' + TZ;
    await mkOrd('oB2', 'new', 'br2', id); await mkOrd('oNB', 'new', '_', id);
    await prep(async (d) => { await d.doc(`b/${A}/staff/r_all`).set({ name: 'r_all', role: 'employee', active: true }); await d.doc('users/r_all').set({ bizId: A, role: 'worker', active: true, bizStatus: 'active', email: 'r_all@x.invalid', createdAt: 1 }); });
    assert.equal((await call('getCard', 'r_all', { custId: id, act: 'copy', ordId: 'oB2' })).status, 'OK');
    assert.equal((await call('getCard', E1, { custId: id, act: 'copy', ordId: 'oB2' })).reason, 'foreign-br');
    assert.equal((await call('getCard', E1, { custId: id, act: 'copy', ordId: 'oNB' })).status, 'OK');
  });
  it('ליקוי 4: מכסת פענוח – עובד 20 בדקה, החריגה נדחית בעברית ונרשמת ביומן; מנהל 60 בדקה', async () => {
    await call('saveCust', MGR, { cust: c1 }); await call('setCard', MGR, { custId: 't' + TZ, card: CARD });
    const id = 't' + TZ; await mkOrd('oQ', 'new', 'br1', id);
    for (let i = 0; i < 20; i++) assert.equal((await call('getCard', E1, { custId: id, act: 'copy', ordId: 'oQ' })).status, 'OK', 'i=' + i);
    const r = await call('getCard', E1, { custId: id, act: 'copy', ordId: 'oQ' });
    assert.equal(r.reason, 'card-quota', r.text); assert.match(r.text, /מכסת/); assert.ok(!leak(r.text));
    assert.ok((await coll(`b/${A}/cardLog`)).some((x) => x.act === 'quota' && x.by === E1 && x.f === 'min'));
    // יומי: מונה שכבר ב-150 היום
    const d = new Date().toISOString().slice(0, 10);
    await prep((x) => x.doc(`b/${A}/cardQ/${E1}`).set({ m: 0, mn: 0, d, dn: 150 }));
    assert.equal((await call('getCard', E1, { custId: id, act: 'copy', ordId: 'oQ' })).reason, 'card-quota');
    await prep((x) => x.doc(`b/${A}/cardQ/${MGR}`).set({ m: Math.floor(Date.now() / 60000), mn: 59, d, dn: 59 }));
    assert.equal((await call('getCard', MGR, { custId: id, act: 'view' })).status, 'OK');
    assert.equal((await call('getCard', MGR, { custId: id, act: 'view' })).reason, 'card-quota');
  });
});
