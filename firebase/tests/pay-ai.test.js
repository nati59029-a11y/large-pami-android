'use strict';
// כלל שכר בכתב חופשי (payRuleAi, שלב D 19.11.2026) – מול אמולטור Firestore. הפונקציה רצה בתוך תהליך הבדיקה (כמו daily-rep.test.js),
// כדי לשלוט בשעון (opts.now). Gemini – דמה בלבד (gemini-mock, 127.0.0.1:9799).
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.GEMINI_API_BASE = 'http://127.0.0.1:9799';
process.env.GEMINI_API_KEY = 'dummy-gemini-key-for-emulator';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-pay', B = 'biz-pay2';
const M1 = 'pay_m1', E1 = 'pay_e1', EX = 'pay_ex', MB = 'pay_mb', SUPER = 'pay_super', LM = 'pay_legacy_m';
const EMP_NAME = 'דנה-פרטית', BIZ_NAME = 'עסק-סודי';
const TXT = 'בונוס 150 אם כל המשימות בזמן, ו-2% ממה שמעל 20 אלף בשעות שעבד';
const NOW = Date.UTC(2026, 10, 19, 10); // 19.11.2026 12:00 שעון ישראל
const DAY = '2026-11-19';
let env, PA, PC;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function put(p, data) { await prep((d) => d.doc(p).set(data)); }
const req = (uid, data) => ({ auth: uid ? { uid, token: { email: uid + '@x.invalid' } } : undefined, data });
async function call(uid, data, o) {
  try { return { ok: true, r: await PA.call(Object.assign({ now: NOW }, o))(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; }
}
const payReqs = () => GM.state.requests.filter((r) => r.kind === 'payrule');

async function seed() {
  await env.clearFirestore();
  GM.reset();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    const biz = (id) => b.set(d.doc('b/' + id), { name: BIZ_NAME, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true } });
    biz(A); biz(B);
    b.set(d.doc(`b/${A}/admins/${M1}`), { email: 'm1@x.example', name: 'מנהל' });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: EMP_NAME, role: 'employee', active: true });
    b.set(d.doc(`b/${A}/staff/${EX}`), { name: 'מושבת', role: 'employee', active: false });
    b.set(d.doc(`b/${B}/admins/${MB}`), { email: 'mb@x.example' });
    for (const [u, bz, role] of [[M1, A, 'admin'], [E1, A, 'worker'], [EX, A, 'worker'], [MB, B, 'admin'], [SUPER, A, 'admin'], [LM, 'largpeami', 'admin']]) {
      b.set(d.doc('users/' + u), { bizId: bz, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    }
    // לארג' פעמי במצב legacy (שורש) – השרת חייב לדחות
    b.set(d.doc('b/largpeami'), { name: 'ל', status: 'active', dataRoot: 'legacy', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true } });
    b.set(d.doc('admins/' + LM), { email: 'lm@x.example' });
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv(); await GM.start();
  require('../functions/index.js');
  PA = require('../functions/payroll-ai.js')._core;
  PC = require('../functions/lib/payroll-core.js');
});
after(async () => { await GM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('payRuleAi – הרשאות וקלט', () => {
  beforeEach(seed);
  it('עובד, עובד מושבת ובלי התחברות – סירוב, בלי פנייה ל-Gemini ובלי מונה', async () => {
    let r = await call(E1, { text: TXT });
    assert.equal(r.ok, false); assert.equal(r.code, 'permission-denied'); assert.equal(r.reason, 'not-manager');
    r = await call(EX, { text: TXT });
    assert.equal(r.code, 'permission-denied'); assert.equal(r.reason, 'staff-disabled');
    r = await call(null, { text: TXT });
    assert.equal(r.code, 'unauthenticated');
    assert.equal(payReqs().length, 0);
    assert.equal(await get(`b/${A}/payai/${DAY}`), null);
  });
  it('עסק legacy (שורש) נדחה', async () => {
    const r = await call(LM, { text: TXT });
    assert.equal(r.code, 'failed-precondition'); assert.equal(r.reason, 'legacy');
    assert.equal(payReqs().length, 0);
  });
  it('טקסט ריק / ארוך / לא טקסט / base לא תקין – invalid-argument, בלי Gemini ובלי מונה', async () => {
    for (const [data, reason] of [[{ text: '   ' }, 'empty'], [{ text: 'א'.repeat(501) }, 'too-long'], [{}, 'bad-text'], [{ text: 7 }, 'bad-text'], [{ text: TXT, base: 'hr' }, 'bad-base']]) {
      const r = await call(M1, data);
      assert.equal(r.code, 'invalid-argument', JSON.stringify(data)); assert.equal(r.reason, reason);
    }
    assert.equal((await call(M1, [1])).reason, 'bad-input');
    assert.equal(payReqs().length, 0);
    assert.equal(await get(`b/${A}/payai/${DAY}`), null);
  });
});

describe('payRuleAi – פענוח', () => {
  beforeEach(seed);
  it('פלט תקין: רכיבים שעוברים validComp, הסבר, ומונה 1; שום דבר מהכלל לא נשמר בשרת', async () => {
    const r = await call(M1, { text: TXT, base: { mode: 'hr', rate: 40 } });
    assert.equal(r.ok, true, r.msg);
    assert.equal(r.r.ok, true); assert.equal(r.r.comp.length, 2);
    for (const c of r.r.comp) { const v = PC.validComp(c); assert.equal(v.ok, true); assert.deepEqual(v.comp, c); assert.equal(c.ai, 1); assert.equal(c.src, TXT); }
    assert.ok(r.r.explain); assert.deepEqual(r.r.use, { n: 1, max: 50 });
    assert.deepEqual(Object.keys(await get(`b/${A}/payai/${DAY}`)).sort(), ['at', 'n']);
    // במסד העסק נוסף רק מסמך המונה
    const adb = require(require.resolve('firebase-admin/firestore', { paths: [path.join(H.ROOT, 'functions')] })).getFirestore();
    const cols = (await adb.doc('b/' + A).listCollections()).map((c) => c.id).sort();
    assert.deepEqual(cols, ['admins', 'payai', 'staff']);
    const body = JSON.stringify(payReqs()[0].body);
    assert.ok(body.includes('PAY-RULE-V1'));
    assert.deepEqual(JSON.parse(payReqs()[0].body.contents[0].parts[0].text), { rule: TXT, cur: { mode: 'hr', rate: 40 } });
  });
  it('לא נשלח שם עובד, שם עסק או מזהים ל-Gemini (גם כשהאפליקציה שולחת שדות נוספים ב-base)', async () => {
    const r = await call(M1, { text: TXT, base: { mode: 'mo', mo: 6000, name: EMP_NAME, id: E1, uid: E1 } });
    assert.equal(r.ok, true);
    const body = JSON.stringify(payReqs()[0].body);
    for (const s of [EMP_NAME, BIZ_NAME, E1, M1, A]) assert.ok(!body.includes(s), 'נשלח ל-Gemini: ' + s);
  });
  it('שינוי בסיס בלבד – ok עם base', async () => {
    GM.state.payrule = 'base';
    const r = await call(M1, { text: 'שעתי 45 ו-20 נסיעות ליום' });
    assert.equal(r.r.ok, true); assert.deepEqual(r.r.comp, []); assert.equal(r.r.base.rate, 45);
  });
  it('JSON שבור ← unparsed; רכיבים לא חוקיים ← unparsed; שניהם נספרים במונה', async () => {
    GM.state.payrule = 'broken';
    let r = await call(M1, { text: TXT });
    assert.equal(r.ok, true); assert.equal(r.r.ok, false); assert.equal(r.r.unparsed, true); assert.ok(r.r.explain);
    GM.state.payrule = 'bad';
    r = await call(M1, { text: TXT });
    assert.equal(r.r.unparsed, true); assert.equal(r.r.comp, undefined); assert.equal(r.r.dropped, 5);
    assert.equal((await get(`b/${A}/payai/${DAY}`)).n, 2);
  });
  it('תקלה בשירות ה-AI – unavailable, והפענוח מוחזר למונה', async () => {
    GM.state.mode = 'overloaded';
    const r = await call(M1, { text: TXT });
    assert.equal(r.code, 'unavailable'); assert.equal(r.reason, 'ai-unavailable');
    assert.equal((await get(`b/${A}/payai/${DAY}`)).n, 0);
  });
});

describe('payRuleAi – תקרה יומית לעסק', () => {
  beforeEach(seed);
  it('הפענוח ה-50 עובר, ה-51 נחסם (resource-exhausted) בלי פנייה ל-Gemini; עסק אחר ויום אחר – לא מושפעים', async () => {
    await put(`b/${A}/payai/${DAY}`, { n: 49 });
    let r = await call(M1, { text: TXT });
    assert.equal(r.ok, true); assert.deepEqual(r.r.use, { n: 50, max: 50 });
    const before = payReqs().length;
    r = await call(SUPER, { text: TXT }); // גם מנהל אחר באותו עסק – אותה תקרה
    assert.equal(r.code, 'resource-exhausted'); assert.equal(r.reason, 'cap');
    r = await call(M1, { text: TXT });
    assert.equal(r.reason, 'cap');
    assert.equal(payReqs().length, before);
    assert.equal((await get(`b/${A}/payai/${DAY}`)).n, 50);
    assert.equal((await call(MB, { text: TXT })).ok, true); // עסק אחר
    r = await call(M1, { text: TXT }, { now: NOW + 24 * 3600000 }); // מחר
    assert.equal(r.ok, true); assert.equal(r.r.use.n, 1);
  });
});
