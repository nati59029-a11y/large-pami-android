'use strict';
// 2026-11-12: תמחור מחשבונית ספק (functions/pricing.js) – pinv, נעילה ותפוגה, הרשאת prc, סיום שמעדכן מלאי, חוקים בשורש וב-b/{bizId}. חלק מ-test:multibiz.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-pi', S = 'biz-pi-shelf', X = 'biz-pi-none';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'pi_mgr', P1 = 'pi_p1', P2 = 'pi_p2', NOP = 'pi_nop', OLD = 'pi_old', SM = 'pi_smgr', SP = 'pi_sp', XM = 'pi_xmgr', SUPER = 'pi_super';
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
const rid = () => 'req' + Date.now().toString(36) + (n++) + 'pi';
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false };
const PRC = Object.assign({}, NONE, { prc: true });
async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: 'ת', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: ALL,
      org: { v: 1, branches: [{ id: 'br1', name: 'א', on: true, sig: [] }, { id: 'br2', name: 'ב', on: true, sig: [] }], banks: [], cards: [] } });
    b.set(d.doc('b/' + S), { name: 'מ', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { scan: true, shelf: true } });
    b.set(d.doc('b/' + X), { name: 'ל', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { scan: true } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'המנהל', role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${P1}`), { name: 'דני', role: 'employee', active: true, br: ['br1'], perms: PRC });
    b.set(d.doc(`b/${A}/staff/${P2}`), { name: 'רותי', role: 'employee', active: true, perms: PRC });
    b.set(d.doc(`b/${A}/staff/${NOP}`), { name: 'בלי', role: 'employee', active: true, perms: Object.assign({}, NONE, { ord: true }) });
    b.set(d.doc(`b/${A}/staff/${OLD}`), { name: 'ישן', role: 'employee', active: true }); // עובד ישן בלי perms – prc כבוי
    b.set(d.doc(`b/${S}/admins/${SM}`), { email: 'sm@x.invalid' });
    b.set(d.doc(`b/${S}/staff/${SP}`), { name: 'מדף', role: 'employee', active: true, perms: PRC });
    b.set(d.doc(`b/${X}/admins/${XM}`), { email: 'xm@x.invalid' });
    for (const [u, z, role] of [[MGR, A, 'admin'], [P1, A, 'worker'], [P2, A, 'worker'], [NOP, A, 'worker'], [OLD, A, 'worker'], [SM, S, 'admin'], [SP, S, 'worker'], [XM, X, 'admin']]) {
      b.set(d.doc('users/' + u), { bizId: z, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    }
    // מוצר של הספק (ברקוד 729001), אותו ברקוד אצל ספק אחר, ומוצר בלי ספק
    b.set(d.doc(`b/${A}/prod/pA`), { name: 'במבה', price: 5.9, barcode: '729001', on: true, q: { br1: 4, br2: 1 }, cat: 'c_x', bp: { br2: 6.5 }, note: 'הערה', sup: 'אסם בע"מ', pk: 1 });
    b.set(d.doc(`b/${A}/prod/pA/p/cost`), { cost: 3.54 }); // = 3 לפני מע"מ
    b.set(d.doc(`b/${A}/prod/pA/p/ws`), { wp: 4.5 });
    b.set(d.doc(`b/${A}/prod/pO`), { name: 'במבה (ספק אחר)', price: 6, barcode: '729001', on: true, q: {}, sup: 'שטראוס' });
    b.set(d.doc(`b/${A}/prod/pN`), { name: 'ביסלי', price: 6.9, barcode: '729002', on: true, q: {} });
    b.set(d.doc(`b/${A}/ordcfg/main`), { vat: 18 });
    await b.commit();
  });
}
const LINES = [
  { n: 'במבה 80 גרם', bc: '729001', qty: 10, unit: 'u', cost: 3.2 },
  { n: 'ביסלי גריל', bc: '729002', qty: 5, unit: 'u', cost: 4 },
  // שורת קרטונים שהמכשיר כבר המיר ליחידת מלאי (מארז): 2 קרטונים × 12 = 24 מארזים, מחיר קרטון 120 ÷ 12 = 10 לפני מע"מ. unit – מידע בלבד
  { n: 'מוצר חדש', bc: '729099', qty: 24, unit: 'ct', pk: 6, ct: 12, cost: 10, raw: '2 קרטון × 120 = 240', chk: 'לבדוק מחיר' },
];
const mk = async (u, lines, biz) => {
  const r = await call('piCreate', u || MGR, { reqId: rid(), sup: 'אסם', inv: '5001', date: '2026-11-12', lines: lines || LINES });
  assert.equal(r.status, 'OK', r.text);
  return r.result.id;
};
const PFX = (z) => `b/${z || A}/`;
before(async () => { env = await H.getEnv(); require('../functions/index.js'); });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('תמחור חשבונית ספק – שרת', () => {
  beforeEach(() => seed());

  it('piCreate: כל איש צוות (גם בלי prc); מזהה בקשה – ניסיון חוזר לא יוצר שנייה; עסק בלי מדף והזמנות – נחסם', async () => {
    const reqId = rid();
    const a = await call('piCreate', NOP, { reqId, sup: 'אסם', inv: '1234567890123', lines: [{ n: 'x 4580123412341234', bc: 'bad barcode!', qty: 1, cost: 2 }] });
    assert.equal(a.status, 'OK', a.text);
    const b = await call('piCreate', NOP, { reqId, sup: 'אסם', lines: [] });
    assert.equal(b.result.dup, true); assert.equal(b.result.id, a.result.id);
    const d = await get(PFX() + 'pinv/' + a.result.id);
    assert.equal(d.st, 'new'); assert.equal(d.src, 'worker'); assert.equal(d.byName, 'בלי'); assert.equal(d.lines.length, 1);
    assert.equal(d.inv, '', 'רצף ארוך של ספרות לא נשמר'); assert.equal(d.lines[0].n, 'x'); assert.equal(d.lines[0].bc, undefined, 'ברקוד לא תקין מהזיהוי – לא נשמר');
    assert.equal((await coll(PFX() + 'pinv')).length, 1);
    // ליקוי 2: עובד ששולח חשבונית לא קובע קישור / מחירים / סימונים – רק שדות זיהוי נשמרים. ליקוי 5: שם עד 60 תווים. chk נשמר
    const long = 'א'.repeat(70);
    const c = await call('piCreate', NOP, { reqId: rid(), sup: 'אסם', lines: [{ n: long, bc: '729001', qty: 3, unit: 'ct', ct: 4, cost: 2, raw: 'r', chk: 'סה"כ לא מתאים',
      pid: 'pA', price: 0.1, wp: 0.1, wpSrc: 'stock', cto: true, nw: true, skip: true }] });
    assert.equal(c.status, 'OK', c.text);
    const cl = (await get(PFX() + 'pinv/' + c.result.id)).lines[0];
    assert.deepEqual(cl, { n: 'א'.repeat(60), bc: '729001', qty: 3, unit: 'ct', ct: 4, cost: 2, raw: 'r', chk: 'סה"כ לא מתאים' });
    assert.equal((await call('piCreate', XM, { reqId: rid(), lines: [] })).reason, 'feature-off');
    assert.equal((await call('piCreate', null, { reqId: rid(), lines: [] })).status, 'UNAUTHENTICATED');
  });

  it('הרשאה prc: עובד בלי prc / עובד ישן בלי perms – נחסם בפונקציות ובקריאה; עם prc ומנהל – מותר; כתיבה מהאפליקציה – לאף אחד', async () => {
    const id = await mk();
    for (const u of [NOP, OLD]) {
      assert.equal((await call('piClaim', u, { id })).reason, 'no-perm', u);
      await assertFails(db(u).doc(PFX() + 'pinv/' + id).get());
      await assertFails(db(u).collection(PFX() + 'pinv').get());
    }
    await assertSucceeds(db(P1).doc(PFX() + 'pinv/' + id).get());
    await assertSucceeds(db(MGR).collection(PFX() + 'pinv').get());
    await assertSucceeds(db(P1).doc(PFX() + `pinv/${id}/p/0`).get());
    await assertFails(db(NOP).doc(PFX() + `pinv/${id}/p/0`).get());
    for (const u of [MGR, P1]) {
      await assertFails(db(u).doc(PFX() + 'pinv/' + id).update({ st: 'done' }));
      await assertFails(db(u).doc(PFX() + 'pinv/zz').set({ st: 'new' }));
      await assertFails(db(u).doc(PFX() + 'pinv/' + id).delete());
      await assertFails(db(u).doc(PFX() + `pinv/${id}/p/0`).set({ d: 'x' }));
    }
  });

  it('נעילה: שניים במקביל – בדיוק אחד מצליח; השני רואה "בטיפול של"; אחרי piRelease השני נכנס; מנהל לא משחרר ולא מבטל נעילה של אחר', async () => {
    const id = await mk();
    const [a, b] = await Promise.all([call('piClaim', P1, { id }), call('piClaim', P2, { id })]);
    const ok = [a, b].filter((r) => r.status === 'OK');
    assert.equal(ok.length, 1, a.text + ' | ' + b.text);
    const lose = a.status === 'OK' ? b : a, win = a.status === 'OK' ? P1 : P2, other = win === P1 ? P2 : P1;
    assert.equal(lose.reason, 'locked'); assert.match(lose.text, win === P1 ? /דני/ : /רותי/);
    assert.equal((await call('piClaim', MGR, { id })).reason, 'locked', 'גם מנהל לא נכנס');
    assert.equal((await call('piVoid', MGR, { id })).reason, 'locked', 'מנהל לא מבטל חשבונית נעולה');
    assert.equal((await call('piRelease', MGR, { id })).result.rel, false, 'מנהל לא משחרר נעילה של אחר');
    assert.equal((await call('piDraft', other, { id, lines: LINES })).reason, 'locked');
    assert.equal((await call('piFinish', other, { id, reqId: rid(), br: 'br1', lines: LINES })).reason, 'locked');
    assert.equal((await call('piBeat', win, { id })).status, 'OK');
    assert.equal((await call('piClaim', win, { id })).status, 'OK', 'המחזיק נכנס שוב (מכשיר אחר / חזרה)');
    assert.equal((await call('piRelease', win, { id })).result.rel, true);
    assert.equal((await get(PFX() + 'pinv/' + id)).lk, undefined);
    assert.equal((await call('piClaim', other, { id })).status, 'OK');
    assert.equal((await call('piBeat', win, { id })).reason, 'locked');
  });

  it('תפוגה: 30 דקות בלי פעילות – אחר נכנס; 29 דקות – עדיין נעול; הקודם כבר לא שומר טיוטה', async () => {
    const id = await mk();
    assert.equal((await call('piClaim', P1, { id })).status, 'OK');
    await prep((d) => d.doc(PFX() + 'pinv/' + id).update({ 'lk.t': Date.now() - 29 * 60000 }));
    assert.equal((await call('piClaim', P2, { id })).reason, 'locked');
    await prep((d) => d.doc(PFX() + 'pinv/' + id).update({ 'lk.t': Date.now() - 31 * 60000 }));
    const r = await call('piClaim', P2, { id });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.lk.uid, P2);
    assert.equal((await call('piDraft', P1, { id, lines: LINES })).reason, 'locked');
    // טיוטה של המחזיק נשמרת ועובד אחר רואה אותה אחרי שחרור
    const L2 = LINES.map((l, i) => Object.assign({}, l, i === 0 ? { price: 6.9, wp: 5, wpSrc: 'man', cto: true } : {}));
    assert.equal((await call('piDraft', P2, { id, lines: L2, sup: 'אסם בע"מ' })).status, 'OK');
    await call('piRelease', P2, { id });
    const c = await call('piClaim', P1, { id });
    assert.equal(c.result.inv.lines[0].price, 6.9); assert.equal(c.result.inv.lines[0].cto, true); assert.equal(c.result.inv.sup, 'אסם בע"מ');
    assert.equal((await call('piDraft', P1, { id, lines: [{ n: 'x', bc: 'bad barcode!' }] })).reason, 'bad-barcode', 'מהמסך – ערך לא תקין נדחה');
  });

  it('piClaim: זיהוי לפי ברקוד + ספק, "קיים אצל ספק אחר", מוצר בלי ספק, עלות קודמת וסימון שינוי עלות', async () => {
    const id = await mk();
    const r = await call('piClaim', P1, { id });
    assert.equal(r.status, 'OK', r.text);
    const [m0, m1, m2] = r.result.m;
    assert.equal(r.result.vat, 18); assert.equal(r.result.ord, true);
    assert.equal(m0.k, 'bc'); assert.equal(m0.nosup, false); assert.equal(m0.m.pid, 'pA'); assert.equal(m0.m.price, 5.9); assert.equal(m0.m.wp, 4.5, 'עובד עם prc מקבל סיטונאי');
    assert.equal(m0.m.cost, 3.54); assert.equal(m0.m.costx, 3); assert.equal(m0.cch, 'up', '3.2 מול 3');
    assert.deepEqual(m0.oth.map((o) => o.pid), ['pO']); assert.equal(m0.oth[0].sup, 'שטראוס');
    assert.equal(m1.k, 'bc'); assert.equal(m1.nosup, true); assert.equal(m1.m.pid, 'pN'); assert.equal(m1.cch, '', 'בלי עלות קודמת');
    assert.equal(m2.m, null); assert.equal(m2.k, '');
    // ספק אחר בחשבונית: pA (אסם) עובר ל"ספק אחר", לא מוצע אוטומטית
    const id2 = (await call('piCreate', MGR, { reqId: rid(), sup: 'יוניליוור', lines: [LINES[0]] })).result.id;
    const r2 = await call('piClaim', MGR, { id: id2 });
    assert.equal(r2.result.m[0].m, null); assert.equal(r2.result.m[0].k, 'otherSup'); assert.deepEqual(r2.result.m[0].oth.map((o) => o.pid).sort(), ['pA', 'pO']);
  });

  it('שורה בלי ברקוד (תוספת ג\'): קוד פריט של אותו ספק, ואז שם מנורמל של אותו ספק; ספק אחר – לא; pid / "מוצר חדש" של המשתמש – נשמרים', async () => {
    await prep(async (d) => {
      await d.doc(PFX() + 'prod/pS').set({ name: 'חטיף תירס', price: 4, barcode: '', on: true, q: {}, sup: 'אסם', sku: 'K-77' });
      await d.doc(PFX() + 'prod/pM').set({ name: 'שוקו, בקבוק  1 ליטר', price: 9, barcode: '', on: true, q: {}, sup: 'אסם בע"מ' });
      await d.doc(PFX() + 'prod/pX').set({ name: 'מיץ ענבים', price: 9, barcode: '', on: true, q: {}, sup: 'שטראוס' });
    });
    const L = [
      { n: 'משהו אחר', sku: 'K-77', qty: 1 },
      { n: 'שוקו בקבוק 1 ליטר', qty: 1 },
      { n: 'שוקו בקבוק 1', qty: 1 },
      { n: 'מיץ ענבים', qty: 1 },
      { n: 'שוקו בקבוק 1 ליטר', qty: 1 },
      { n: 'כלשהו', qty: 1 },
    ];
    const id = await mk(MGR, L);
    assert.equal((await call('piClaim', P2, { id })).result.m[4].k, 'name');
    // המשתמש ביטל את ההתאמה (מוצר חדש) בשורה 5 וקישר ידנית בשורה 6 – נשמר בטיוטה ומכובד
    const L2 = L.map((l, i) => Object.assign({}, l, i === 4 ? { nw: true } : i === 5 ? { pid: 'pX' } : {}));
    assert.equal((await call('piDraft', P2, { id, lines: L2 })).status, 'OK');
    const r = await call('piClaim', P2, { id });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(r.result.m.map((x) => [x.k, x.m && x.m.pid]), [['sku', 'pS'], ['name', 'pM'], ['', null], ['', null], ['', null], ['pid', 'pX']]);
  });

  it('piFinish: רק המחזיק; מוצר קיים – מחיר/עלות כולל מע"מ/סיטונאי/מארז/קרטון/cto, כמות נוספת למלאי, שאר השדות לא משתנים; מוצר חדש נוצר; ניסיון חוזר לא מכפיל', async () => {
    const id = await mk();
    const L = [
      Object.assign({}, LINES[0], { pid: 'pA', price: 6.9, wp: 5, wpSrc: 'man', ct: 24, cto: true }),
      Object.assign({}, LINES[1], { skip: true }),
      Object.assign({}, LINES[2], { price: 9.9, wp: 5.5, wpSrc: 'auto', cto: false }),
      Object.assign({}, LINES[0], { pid: 'pA', qty: 2, price: 1 }), // שורה נוספת לאותו מוצר: רק הכמות מצטרפת
    ];
    assert.equal((await call('piFinish', P1, { id, reqId: rid(), br: 'br1', lines: L })).reason, 'not-locked', 'בלי כניסה – נדחה');
    assert.equal((await call('piClaim', P1, { id })).status, 'OK');
    assert.equal((await call('piFinish', P2, { id, reqId: rid(), br: 'br1', lines: L })).reason, 'locked');
    assert.equal((await call('piFinish', P1, { id, reqId: rid(), br: 'br2', lines: L })).reason, 'foreign-br', 'עובד משויך לסניף – רק לסניף שלו');
    assert.equal((await call('piFinish', P1, { id, reqId: rid(), br: 'br1', lines: [Object.assign({}, LINES[2], { price: undefined })] })).reason, 'bad-price', 'מוצר חדש בלי מחיר');
    const reqId = rid();
    const f = await call('piFinish', P1, { id, reqId, br: 'br1', lines: L });
    assert.equal(f.status, 'OK', f.text);
    assert.equal(f.result.added, 1); assert.equal(f.result.updated, 1); assert.equal(f.result.qty, 36, '12 של pA + 24 מארזים, בלי המרה נוספת לפי unit');
    const a = await get(PFX() + 'prod/pA');
    assert.equal(a.price, 6.9); assert.equal(a.ct, 24); assert.equal(a.cto, true); assert.equal(a.pk, 1);
    assert.deepEqual(a.q, { br1: 16, br2: 1 }, '4 + 10 + 2');
    assert.equal(a.name, 'במבה', 'השם במלאי לא מוחלף בשם מהחשבונית'); assert.equal(a.cat, 'c_x'); assert.deepEqual(a.bp, { br2: 6.5 }); assert.equal(a.note, 'הערה'); assert.equal(a.sup, 'אסם בע"מ');
    assert.equal((await get(PFX() + 'prod/pA/p/cost')).cost, 3.78, '3.2 + 18%');
    assert.equal((await get(PFX() + 'prod/pA/p/ws')).wp, 5);
    assert.equal((await get(PFX() + 'prod/pN')).q.br1, undefined, 'שורה שדולגה – לא נגעו');
    const fin = await get(PFX() + 'pinv/' + id);
    assert.equal(fin.st, 'done'); assert.equal(fin.lk, undefined); assert.equal(fin.fin.by, P1);
    const nid = fin.lines[2].pid; assert.ok(nid);
    const p = await get(PFX() + 'prod/' + nid);
    assert.equal(p.name, 'מוצר חדש'); assert.equal(p.barcode, '729099'); assert.equal(p.price, 9.9); assert.equal(p.pk, 6); assert.equal(p.ct, 12);
    assert.equal(p.cto, undefined); assert.equal(p.sup, 'אסם'); assert.deepEqual(p.q, { br1: 24 }); assert.equal(p.src, 'pinv');
    assert.equal((await get(PFX() + `prod/${nid}/p/cost`)).cost, 11.8, 'עלות מארז 10 + 18% – לא מחולקת שוב ב-ct'); assert.equal((await get(PFX() + `prod/${nid}/p/ws`)).wp, 5.5);
    const log = (await coll(PFX() + 'stockLog')).filter((x) => x.why === 'pinv');
    assert.deepEqual(log.map((x) => [x.prod, x.delta, x.br, x.pinv]).sort(), [[nid, 24, 'br1', id], ['pA', 12, 'br1', id]].sort());
    const again = await call('piFinish', P1, { id, reqId, br: 'br1', lines: L });
    assert.equal(again.status, 'OK'); assert.equal(again.result.dup, true); assert.equal(again.result.added, 1);
    assert.deepEqual((await get(PFX() + 'prod/pA')).q, { br1: 16, br2: 1 }, 'ניסיון חוזר לא מוסיף שוב');
    assert.equal((await coll(PFX() + 'prod')).length, 4);
    assert.equal((await call('piFinish', P1, { id, reqId: rid(), br: 'br1', lines: L })).reason, 'closed');
    assert.equal((await call('piClaim', P2, { id })).reason, 'closed', 'אחרי סיום – נעלם לכולם מהעריכה');
  });

  it('piVoid: מנהל בלבד, על חשבונית פנויה (או שהנעילה פגה); עובד – נחסם', async () => {
    const id = await mk();
    assert.equal((await call('piVoid', P1, { id })).reason, 'manager-only');
    assert.equal((await call('piVoid', MGR, { id })).status, 'OK');
    assert.equal((await get(PFX() + 'pinv/' + id)).st, 'void');
    assert.equal((await call('piVoid', MGR, { id })).result.dup, true);
    assert.equal((await call('piClaim', P1, { id })).reason, 'closed');
    assert.deepEqual((await get(PFX() + 'prod/pA')).q, { br1: 4, br2: 1 });
  });

  it('piImg (שלב 4): צילום בחלקים – מי ששלח (גם בלי prc) או מנהל; אחר / קובץ שאינו תמונה / גדול מדי – נחסם; np רק בחלק האחרון; קריאה לפי prc', async () => {
    const r0 = await call('piCreate', NOP, { reqId: rid(), sup: 'אסם', lines: [LINES[0]] });
    const id = r0.result.id;
    const img = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
    const a = await call('piImg', NOP, { id, k: 0, np: 2, data: img.slice(0, 600) });
    assert.equal(a.status, 'OK', a.text);
    assert.equal((await get(PFX() + 'pinv/' + id)).np, undefined, 'חלק ראשון מתוך 2 – עוד לא מוצג');
    assert.equal((await call('piImg', NOP, { id, k: 1, np: 2, data: img.slice(600) })).status, 'OK');
    assert.equal((await get(PFX() + 'pinv/' + id)).np, 2);
    assert.equal((await get(PFX() + 'pinv/' + id + '/p/0')).data + (await get(PFX() + 'pinv/' + id + '/p/1')).data, img);
    // מנהל מעלה מחדש בחלק אחד – החלק הישן נמחק
    assert.equal((await call('piImg', MGR, { id, k: 0, np: 1, data: img })).status, 'OK');
    assert.equal((await get(PFX() + 'pinv/' + id)).np, 1); assert.equal(await get(PFX() + 'pinv/' + id + '/p/1'), null);
    // עובד אחר (גם עם prc) – לא; בלי התחברות – לא
    assert.equal((await call('piImg', P1, { id, k: 0, np: 1, data: img })).reason, 'not-owner');
    assert.equal((await call('piImg', null, { id, k: 0, np: 1, data: img })).status, 'UNAUTHENTICATED');
    // תוכן וגודל
    assert.equal((await call('piImg', NOP, { id, k: 0, np: 1, data: '<html><script>alert(1)</script>' })).reason, 'bad-img');
    assert.equal((await call('piImg', NOP, { id, k: 0, np: 1, data: 'data:text/html;base64,AAAA' })).reason, 'bad-img');
    assert.equal((await call('piImg', NOP, { id, k: 0, np: 1, data: 'data:image/jpeg;base64,' + 'A'.repeat(700000) })).reason, 'img-big');
    assert.equal((await call('piImg', NOP, { id, k: 0, np: 9, data: img })).reason, 'img-big');
    assert.equal((await call('piImg', NOP, { id, k: 2, np: 2, data: 'AAAA' })).reason, 'bad-part');
    assert.equal((await call('piImg', NOP, { id, k: 0, np: 1, data: img, x: 1 })).reason, 'bad-field');
    assert.equal((await call('piImg', NOP, { id: 'nope12345', k: 0, np: 1, data: img })).reason, 'no-pinv');
    // קריאה: עובד עם prc ומנהל – כן; מי ששלח בלי prc – לא; כתיבה מהאפליקציה – לאף אחד
    await assertSucceeds(db(P1).doc(PFX() + 'pinv/' + id + '/p/0').get());
    await assertSucceeds(db(MGR).doc(PFX() + 'pinv/' + id + '/p/0').get());
    await assertFails(db(NOP).doc(PFX() + 'pinv/' + id + '/p/0').get());
    await assertFails(db(MGR).doc(PFX() + 'pinv/' + id + '/p/0').set({ data: img }));
    // piClaim מחזיר np; חשבונית סגורה – אין העלאה
    const c = await call('piClaim', P1, { id });
    assert.equal(c.result.inv.np, 1);
    const f = await call('piFinish', P1, { id, reqId: rid(), br: 'br1', lines: [Object.assign({}, LINES[0], { pid: 'pA', price: 5.9 })] });
    assert.equal(f.status, 'OK', f.text);
    assert.equal((await call('piImg', NOP, { id, k: 0, np: 1, data: img })).reason, 'closed');
  });

  it('עסק עם מדף בלבד: עובד עם prc קורא ומטפל; בלי זיהוי מלאי; סיום רק סוגר', async () => {
    const r0 = await call('piCreate', SM, { reqId: rid(), sup: 'אסם', lines: [LINES[0]] });
    const id = r0.result.id;
    await assertSucceeds(db(SP).doc(PFX(S) + 'pinv/' + id).get());
    const c = await call('piClaim', SP, { id });
    assert.equal(c.status, 'OK', c.text); assert.equal(c.result.ord, false); assert.deepEqual(c.result.m, []);
    const f = await call('piFinish', SP, { id, reqId: rid(), lines: [Object.assign({}, LINES[0], { price: 5 })] });
    assert.equal(f.status, 'OK', f.text); assert.equal(f.result.added, 0);
    assert.equal((await get(PFX(S) + 'pinv/' + id)).st, 'done');
    assert.equal((await coll(PFX(S) + 'prod')).length, 0);
  });

  it('saveProduct: שדה cto (רק קרטונים סגורים) – תוספתי; false מוחק; ערך לא תקין נדחה', async () => {
    assert.equal((await call('saveProduct', MGR, { id: 'pN', name: 'ביסלי', price: 6.9, cto: true })).status, 'OK');
    assert.equal((await get(PFX() + 'prod/pN')).cto, true);
    assert.equal((await call('saveProduct', MGR, { id: 'pN', name: 'ביסלי', price: 6.9, cto: false })).status, 'OK');
    assert.equal((await get(PFX() + 'prod/pN')).cto, undefined);
    assert.equal((await call('saveProduct', MGR, { id: 'pN', name: 'ביסלי', price: 6.9, cto: 'כן' })).reason, 'bad-field');
  });
});

describe('תמחור – לארג\' פעמי במצב legacy (שורש)', () => {
  const LM = 'pil_mgr', LE = 'pil_emp', LP = 'pil_prc';
  beforeEach(async () => {
    await env.clearFirestore();
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('admins/' + LM), { email: 'lm@x.invalid' });
      b.set(d.doc('staff/' + LM), { name: LM, role: 'manager', active: true });
      b.set(d.doc('staff/' + LE), { name: LE, role: 'employee', active: true }); // עובד ישן בלי perms – prc כבוי (החלטה 5)
      b.set(d.doc('staff/' + LP), { name: 'עם הרשאה', role: 'employee', active: true, perms: PRC });
      b.set(d.doc('prod/pA'), { name: 'עוגה', price: 10, barcode: '7290', on: true, q: { _: 5 }, sup: 'אסם' });
      await b.commit();
    });
  });
  it('עובד ישן – לא רואה ולא מטפל; עובד עם prc ומנהל – כן; הכמות נוספת ב-q._', async () => {
    const id = (await call('piCreate', LE, { reqId: rid(), sup: 'אסם', lines: [{ n: 'עוגה', bc: '7290', qty: 3, cost: 4 }] })).result.id;
    assert.ok(await get('pinv/' + id)); assert.equal(await get(`b/largpeami/pinv/${id}`), null);
    assert.equal((await call('piClaim', LE, { id })).reason, 'no-perm');
    await assertFails(db(LE).doc('pinv/' + id).get());
    await assertSucceeds(db(LP).doc('pinv/' + id).get());
    await assertSucceeds(db(LM).collection('pinv').get());
    await assertFails(db(LM).doc('pinv/' + id).update({ st: 'done' }));
    const c = await call('piClaim', LP, { id });
    assert.equal(c.status, 'OK', c.text); assert.equal(c.result.m[0].m.pid, 'pA');
    const f = await call('piFinish', LP, { id, reqId: rid(), lines: [{ n: 'עוגה', bc: '7290', qty: 3, cost: 4, pid: 'pA', price: 12 }] });
    assert.equal(f.status, 'OK', f.text);
    assert.deepEqual((await get('prod/pA')).q, { _: 8 }); assert.equal((await get('prod/pA')).price, 12);
    assert.equal((await get('prod/pA/p/cost')).cost, 4.72);
  });
});
