'use strict';
// סריקה אחידה (משימה 2026-11-07), שלבים 1+2: scanDocument סוג classify, מכסה לפי דף עם החזר, ברירת מחדל לעסק חדש,
// וסוגי הגבלה של מנהל־על (setScanQuota). מול האמולטור בלבד; Gemini מוחלף בשרת דמה (gemini-mock.js).
//   firebase emulators:exec --only auth,firestore,storage,functions --project demo-largpeami "node --test tests/unified-scan.test.js"

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-a', B = 'biz-b', L = 'largpeami', SUPER = 'u_super';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };
const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (name) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${name}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  const status = json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status);
  return { status, reason: json && json.error && json.error.details && json.error.details.reason, details: json && json.error && json.error.details, result: json && json.result, text };
}
let seq = 0;
const jpg = () => { const b = Buffer.alloc(200 + (seq++ % 50)); Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(b); return { mimeType: 'image/jpeg', data: b.toString('base64') }; };
const CLS = (bizId) => Object.assign({ kind: 'classify', files: [jpg()] }, bizId ? { bizId } : {});

let env;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function getDoc(p) { let v = null; await prep(async (db) => { const s = await db.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }

// עסק א': מנהל, עובד עם כל ההרשאות, עובד בלי expW, עובד בלי שום הרשאה, עובד עם trf בלבד. עסק ב': מנהל, עובד. לארג' פעמי בשורש: מנהל, עובד.
const U = { mgr: 'a_mgr', all: 'a_all', noexp: 'a_noexp', none: 'a_none', trf: 'a_trf', bmgr: 'b_mgr', bemp: 'b_emp', rmgr: 'u_mgr', remp: 'u_emp' };
async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('admins/' + U.rmgr), { email: 'x@example.invalid' });
    for (const [u, role] of [[U.rmgr, 'manager'], [U.remp, 'employee']]) b.set(d.doc('staff/' + u), { name: u, role, active: true, pushTokens: [] });
    for (const [u, role] of [[U.rmgr, 'admin'], [U.remp, 'worker']]) b.set(d.doc('users/' + u), { bizId: L, role, active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    for (const z of [A, B]) b.set(d.doc('b/' + z), { name: z, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { scan: true } });
    const mem = (z, u, role, perms) => {
      if (role === 'admin') b.set(d.doc(`b/${z}/admins/${u}`), { email: u + '@example.invalid' });
      b.set(d.doc(`b/${z}/staff/${u}`), Object.assign({ name: u, role: role === 'admin' ? 'manager' : 'employee', active: true, pushTokens: [] }, perms ? { perms: Object.assign({}, NONE, perms) } : {}));
      b.set(d.doc('users/' + u), { bizId: z, role, active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    };
    mem(A, U.mgr, 'admin'); mem(A, U.all, 'worker', { incW: true, expW: true, trf: true }); mem(A, U.noexp, 'worker', { incW: true });
    mem(A, U.none, 'worker', { expR: true }); mem(A, U.trf, 'worker', { trf: true });
    mem(B, U.bmgr, 'admin'); mem(B, U.bemp, 'worker');
    await b.commit();
  });
}

before(async () => { env = await H.getEnv(); await GM.start(); require('../functions/index.js'); });
after(async () => { await GM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(async () => { await seed(); GM.reset(); });


describe('שלב 1 – classify: סיווג + נתונים בקריאה אחת', () => {
  it('מחזיר סוג תקין לכל 6 הסוגים ו-unknown; תת־סוג לחשבונית/תעודת משלוח/קבלה/זיכוי; text גולמי לא מוחזר', async () => {
    const expect = { invoice: ['invoice', 'invoice'], delivery_note: ['invoice', 'delivery_note'], receipt: ['invoice', 'receipt'], credit_note: ['invoice', 'credit_note'], cashout: ['cashout', null], deposit: ['deposit', null], transfer: ['transfer', null], zreport: ['zreport', null], opening: ['opening', null], unknown: ['unknown', null] };
    for (const [k, [type, docType]] of Object.entries(expect)) {
      GM.state.classify = GM.CLASSIFY[k];
      const r = await call('scanDocument', U.mgr, CLS());
      assert.equal(r.status, 'OK', k + ': ' + r.text);
      assert.equal(r.result.result.type, type, k); assert.equal(r.result.result.docType, docType, k);
      assert.equal(r.result.result.allowed, true, k);
      assert.deepEqual(Object.keys(r.result).sort(), ['model', 'result', 'usage'], k);
    }
    // הבקשה עצמה: הנחיית classify, temperature 0, תמונה אחת
    const q = GM.state.requests.at(-1);
    assert.equal(q.kind, 'classify'); assert.equal(q.body.generationConfig.temperature, 0); assert.equal(q.body.contents[0].parts.length, 2);
  });
  it('חשבונית: כל השדות (ספק, ח.פ, מספר, תאריך, סכום, מע"מ), ביטחון לכל שדה, מספר דף; שדה בביטחון נמוך = לא בטוח', async () => {
    const r = (await call('scanDocument', U.all, CLS())).result.result;
    assert.deepEqual(r.fields, { supplier: 'ספק דמה בע"מ', supplier_id: '512345678', number: '123456', date: '2026-10-28', total_before_vat: 100, vat_amount: 18, total_with_vat: 118 });
    assert.equal(r.confidence.number, 0.99); assert.equal(r.page, 1); assert.equal(r.pages, 2);
    assert.deepEqual(r.uncertain, ['date']);
  });
  it('חשבונית זיכוי מחזירה סכום שלילי (גם כשהמודל החזיר חיובי או מחרוזת); קבלה מסווגת כהוצאה (invoice/receipt) עם מספר החשבונית הקשורה', async () => {
    GM.state.classify = GM.CLASSIFY.credit_note;
    const c = (await call('scanDocument', U.all, CLS())).result.result;
    assert.equal(c.credit, true);
    assert.deepEqual([c.fields.total_before_vat, c.fields.vat_amount, c.fields.total_with_vat], [-50, -9, -59]);
    GM.state.classify = GM.CLASSIFY.receipt;
    const rc = (await call('scanDocument', U.all, CLS())).result.result;
    assert.equal(rc.type, 'invoice'); assert.equal(rc.docType, 'receipt'); assert.equal(rc.fields.related_invoice, '123456');
  });
  it('תאריך שלא זוהה – ברשימת "לא בטוח" (האפליקציה ממלאת היום בצהוב); דוח Z – איזה חלק', async () => {
    GM.state.classify = GM.CLASSIFY.delivery_note;
    assert.ok((await call('scanDocument', U.all, CLS())).result.result.uncertain.includes('date'));
    GM.state.classify = GM.CLASSIFY.zreport;
    const z = (await call('scanDocument', U.all, CLS())).result.result;
    assert.equal(z.zPart, 'middle'); assert.equal(z.fields.cash_out, -10615);
  });
  it('שדות שלא ברשימה הסגורה לא עוברים; סוג לא מוכר = unknown', async () => {
    GM.state.classify = { type: 'invoice', fields: { supplier: 'x', evil: '<script>', __proto__x: 1 }, confidence: { supplier: 2 } };
    const r = (await call('scanDocument', U.mgr, CLS())).result.result;
    assert.deepEqual(r.fields, { supplier: 'x' }); assert.equal(r.confidence.supplier, 1);
    GM.state.classify = { type: 'toString', fields: { amount: 5 } };
    const u = (await call('scanDocument', U.mgr, CLS())).result.result;
    assert.equal(u.type, 'unknown'); assert.deepEqual(u.fields, {});
  });
});

describe('שלב 1 – classify: הרשאות בשרת', () => {
  it('עובד בלי expW ששולח חשבונית: סוג בלבד, בלי סכום/ספק, reason no-perm, toManager – ונספר דף אחד', async () => {
    for (const k of ['invoice', 'credit_note', 'receipt', 'cashout']) {
      GM.state.classify = GM.CLASSIFY[k];
      const r = await call('scanDocument', U.noexp, CLS());
      assert.equal(r.status, 'OK', r.text);
      const x = r.result.result;
      assert.equal(x.allowed, false, k); assert.equal(x.reason, 'no-perm'); assert.equal(x.toManager, true);
      assert.deepEqual(x.fields, {}); assert.deepEqual(x.confidence, {}); assert.equal(x.page, null);
      for (const v of Object.values(GM.CLASSIFY[k].fields)) if (v != null && String(v).length > 2) assert.ok(!r.text.includes(String(v)), k + ' דלף ' + v);
      assert.ok(!r.text.includes('ספק'), k + ': שם הספק דלף');
    }
    // אבל Z – מותר לו (incW)
    GM.state.classify = GM.CLASSIFY.zreport;
    assert.equal((await call('scanDocument', U.noexp, CLS())).result.result.allowed, true);
  });
  it('העברה: עובד בלי trf מקבל סוג בלבד; עובד עם trf בלבד מקבל העברה, אבל חשבונית – סוג בלבד; בלארג\' פעמי עובד – העברה חסומה כמו היום', async () => {
    GM.state.classify = GM.CLASSIFY.transfer;
    const n = (await call('scanDocument', U.noexp, CLS())).result.result;
    assert.equal(n.allowed, false); assert.deepEqual(n.fields, {});
    assert.equal((await call('scanDocument', U.trf, CLS())).result.result.fields.transfers[0].amount, 1234.56);
    assert.equal((await call('scanDocument', U.remp, CLS())).result.result.allowed, false);
    assert.equal((await call('scanDocument', U.rmgr, CLS())).result.result.allowed, true);
    GM.state.classify = GM.CLASSIFY.invoice;
    assert.equal((await call('scanDocument', U.trf, CLS())).result.result.allowed, false);
  });
  it('עובד בלי אף הרשאה להכניס מסמך: נדחה לפני Gemini ולפני המכסה', async () => {
    const r = await call('scanDocument', U.none, CLS());
    assert.equal(r.status, 'PERMISSION_DENIED'); assert.equal(r.reason, 'no-perm');
    assert.equal(GM.state.requests.length, 0);
    assert.equal(await getDoc(`b/${A}/scan_usage/_biz`), null);
  });
  it('classify מקבל קובץ אחד בדיוק; תוספת scan כבויה = feature-off בלי Gemini', async () => {
    assert.equal((await call('scanDocument', U.mgr, { kind: 'classify', files: [jpg(), jpg()] })).reason, 'bad-file-count');
    await prep((d) => d.doc('b/' + A).update({ 'features.scan': false }));
    assert.equal((await call('scanDocument', U.mgr, CLS())).reason, 'feature-off');
    assert.equal(GM.state.requests.length, 0);
  });
});

describe('שלב 1 – מכסה לפי דף, והחזר אטומי', () => {
  it('zreport עם 3 קבצים מוריד 3 ממונה העסק; classify מוריד 1', async () => {
    assert.equal((await call('scanDocument', U.all, { kind: 'zreport', files: [jpg(), jpg(), jpg()] })).status, 'OK');
    assert.equal((await getDoc(`b/${A}/scan_usage/_biz`)).count, 3);
    const r = await call('scanDocument', U.all, CLS());
    assert.equal((await getDoc(`b/${A}/scan_usage/_biz`)).count, 4);
    assert.equal(r.result.usage.pages, 1); assert.equal(r.result.usage.bizUsed, 4);
    assert.equal((await getDoc(`b/${A}/scan_usage/${U.all}`)).count, 2, 'המונה לכל משתמש סופר קריאות, כמו היום');
  });
  it('תקרה 20: דף 21 ביום באותו עסק נדחה (biz-daily-limit) בלי Gemini; Z של 3 דפים כשנשארו 2 – נדחה; עסק ב\' לא מושפע', async () => {
    await prep((d) => d.doc(`b/${A}/private/info`).set({ adv: { limits: { scanDaily: 20 } } }));
    for (let i = 1; i <= 18; i++) assert.equal((await call('scanDocument', i % 2 ? U.all : U.mgr, CLS())).status, 'OK', 'דף ' + i);
    const z = await call('scanDocument', U.all, { kind: 'zreport', files: [jpg(), jpg(), jpg()] });
    assert.equal(z.reason, 'biz-daily-limit', z.text);
    for (let i = 19; i <= 20; i++) assert.equal((await call('scanDocument', U.all, CLS())).status, 'OK', 'דף ' + i);
    const sent = GM.state.requests.length;
    const r21 = await call('scanDocument', U.mgr, CLS());
    assert.equal(r21.status, 'RESOURCE_EXHAUSTED'); assert.equal(r21.reason, 'biz-daily-limit'); assert.equal(r21.details.limit, 20);
    assert.match(r21.text, /מגבלת הזיהויים היומית/);
    assert.equal(GM.state.requests.length, sent);
    assert.equal((await getDoc(`b/${A}/scan_usage/_biz`)).count, 20);
    assert.equal((await call('scanDocument', U.bemp, CLS())).status, 'OK');
  });
  it('כשל Gemini ב-classify מחזיר את הדף (גם אחרי שהבקשה יצאה): מכסה, עומס, מפתח, תשובה לא קריאה – המונים חוזרים ל-0', async () => {
    for (const mode of ['quota', 'overloaded', 'badkey', 'garbage']) {
      GM.reset(); GM.state.mode = mode;
      const r = await call('scanDocument', U.all, CLS());
      assert.notEqual(r.status, 'OK', mode);
      assert.ok(GM.state.requests.length >= 1, mode + ': הבקשה יצאה');
      assert.equal((await getDoc(`b/${A}/scan_usage/_biz`)).count, 0, mode + ': מונה העסק');
      assert.equal((await getDoc(`b/${A}/scan_usage/${U.all}`)).count, 0, mode + ': מונה המשתמש');
    }
    GM.reset();
    assert.equal((await call('scanDocument', U.all, CLS())).result.usage.bizUsed, 1);
  });
  it('kinds הקיימים: כשל אחרי שבקשה יצאה – נספר כמו היום (בלי שינוי התנהגות)', async () => {
    GM.state.mode = 'quota';
    await call('scanDocument', U.all, { kind: 'invoice', files: [jpg(), jpg()] });
    assert.equal((await getDoc(`b/${A}/scan_usage/_biz`)).count, 2);
  });
  it('לארג\' פעמי (legacy, בלי תקרת עסק): classify עובד ונספר רק למשתמש, בלי מונה עסק – כמו היום', async () => {
    const r = await call('scanDocument', U.remp, CLS());
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.usage.bizLimit, null);
    assert.equal(await getDoc('scan_usage/_biz'), null);
    assert.equal((await getDoc('scan_usage/' + U.remp)).count, 1);
  });
});

describe('שלב 2 – ברירת מחדל לעסק חדש; עסקים קיימים ללא שינוי', () => {
  it('createBusiness: features.scan===true ו-bizCaps מחזיר 20; classify עובד מיד', async () => {
    const r = await call('createBusiness', SUPER, { bizId: 'biz-new', name: 'חדש', ownerEmail: 'new@example.invalid', ownerPhone: '0501234567' });
    assert.equal(r.status, 'OK', r.text);
    assert.equal((await getDoc('b/biz-new')).features.scan, true);
    const S = require('../functions/lib/scan');
    assert.equal((await S.bizCaps('biz-new', 100)).bizDaily, 20);
  });
  it('עסק קיים בלי הגדרה – בדיוק כמו היום (50); עסק עם adv.limits.scanDaily שומר על הערך; לארג\' פעמי – בלי תקרה', async () => {
    const S = require('../functions/lib/scan');
    assert.deepEqual(await S.bizCaps(B, 100), { perUser: 100, bizDaily: 50 });
    await prep((d) => d.doc(`b/${A}/private/info`).set({ adv: { limits: { scanDaily: 7 } } }));
    assert.deepEqual(await S.bizCaps(A, 100), { perUser: 100, bizDaily: 7 });
    assert.deepEqual(await S.bizCaps(L, 100), { perUser: 100, bizDaily: null });
  });
  it('מנהל־על עדיין יכול לכבות; כבוי = feature-off בלי Gemini', async () => {
    await call('createBusiness', SUPER, { bizId: 'biz-new', name: 'חדש', ownerEmail: 'new2@example.invalid', ownerPhone: '0501234567' });
    assert.equal((await call('setBusinessFeatures', SUPER, { bizId: 'biz-new', features: { scan: false } })).status, 'OK');
    assert.equal((await call('scanDocument', SUPER, CLS('biz-new'))).reason, 'feature-off');
    assert.equal(GM.state.requests.length, 0);
  });
});

describe('שלב 2 – סוגי הגבלה (setScanQuota), מנהל־על בלבד', () => {
  const S = () => require('../functions/lib/scan');
  it('רק מנהל־על: מנהל עסק, עובד, מנהל עסק אחר – נדחים (שרת); כתיבה ישירה ל-private/info מהאפליקציה – נדחית (חוקים)', async () => {
    for (const uid of [U.mgr, U.all, U.bmgr, U.rmgr]) {
      const r = await call('setScanQuota', uid, { bizId: A, mode: 'release', for: 'forever' });
      assert.equal(r.reason, 'not-superadmin', uid);
    }
    assert.equal((await call('setScanQuota', null, { bizId: A, mode: 'default' })).status, 'UNAUTHENTICATED');
    assert.equal(await getDoc(`b/${A}/private/info`), null);
    const fs1 = env.authenticatedContext(U.mgr).firestore();
    const { assertFails } = require('@firebase/rules-unit-testing');
    await assertFails(fs1.doc(`b/${A}/private/info`).set({ scanQuota: { release: { until: null } } }, { merge: true }));
    // ולידציה
    for (const bad of [{ mode: 'limit', period: 'year', n: 5 }, { mode: 'limit', period: 'day', n: -1 }, { mode: 'limit', period: 'day', n: 1.5 }, { mode: 'release', for: 'decade' }, { mode: 'x' }]) {
      assert.equal((await call('setScanQuota', SUPER, Object.assign({ bizId: A }, bad))).reason, 'bad-quota', JSON.stringify(bad));
    }
  });
  it('N דפים ליום: נאכף; נרשם ב-audit', async () => {
    assert.equal((await call('setScanQuota', SUPER, { bizId: A, mode: 'limit', period: 'day', n: 2 })).status, 'OK');
    for (let i = 0; i < 2; i++) assert.equal((await call('scanDocument', U.all, CLS())).status, 'OK');
    assert.equal((await call('scanDocument', U.all, CLS())).reason, 'biz-daily-limit');
    let acts = []; await prep(async (d) => { acts = (await d.collection(`b/${A}/audit`).get()).docs.map((x) => x.data()); });
    assert.ok(acts.some((a) => a.act === 'setScanQuota' && a.note === 'limit:day:2' && a.by === SUPER));
  });
  it('N דפים לשבוע / לחודש: נאכף עם biz-period-limit; מפתח התקופה נכון; ביום אחר באותו שבוע – עדיין חסום, בשבוע הבא – מתאפס', async () => {
    for (const period of ['week', 'month']) {
      await seed();
      assert.equal((await call('setScanQuota', SUPER, { bizId: A, mode: 'limit', period, n: 3 })).status, 'OK');
      assert.equal((await call('scanDocument', U.all, { kind: 'zreport', files: [jpg(), jpg(), jpg()] })).status, 'OK');
      const r = await call('scanDocument', U.all, CLS());
      assert.equal(r.reason, 'biz-period-limit', period); assert.equal(r.details.period, period);
      const key = (await getDoc(`b/${A}/scan_usage/_biz`)).day;
      assert.equal(key, S().periodKey(period));
      // מונה שנשמר עם מפתח של תקופה קודמת – מתאפס
      await prep((d) => d.doc(`b/${A}/scan_usage/_biz`).set({ day: period === 'week' ? 'W:2000-01-02' : 'M:2000-01', count: 3 }));
      assert.equal((await call('scanDocument', U.all, CLS())).status, 'OK', period);
    }
    // חישוב שבוע (ראשון עד שבת, שעון ישראל)
    assert.equal(S().periodKey('week', new Date('2026-11-07T12:00:00Z')), 'W:2026-11-01'); // שבת
    assert.equal(S().periodKey('week', new Date('2026-11-07T22:30:00Z')), 'W:2026-11-08'); // ראשון 00:30 בישראל
    assert.equal(S().periodKey('month', new Date('2026-11-30T22:30:00Z')), 'M:2026-12');
  });
  it('קבוע (סך N דפים, בלי איפוס): לא מתאפס ביום חדש; הגדרה חדשה מאפסת את המונה', async () => {
    assert.equal((await call('setScanQuota', SUPER, { bizId: A, mode: 'limit', period: 'total', n: 2 })).status, 'OK');
    await call('scanDocument', U.all, CLS()); await call('scanDocument', U.all, CLS());
    assert.equal((await call('scanDocument', U.all, CLS())).reason, 'biz-period-limit');
    assert.deepEqual(await S().bizCaps(A, 100, Date.now() + 40 * 86400000), { perUser: 100, bizDaily: 2, period: 'total', bizKey: 'T' });
    assert.equal((await call('setScanQuota', SUPER, { bizId: A, mode: 'limit', period: 'total', n: 2 })).status, 'OK');
    assert.equal((await getDoc(`b/${A}/scan_usage/_biz`)).count, 0);
  });
  it('שחרור ליום/שבוע/חודש: בלי תקרת עסק עד התפוגה, ואחריה חוזרת ההגבלה הרגילה; שחרור קבוע – בלי תפוגה; התקרה למשתמש נשארת', async () => {
    await prep((d) => d.doc(`b/${A}/private/info`).set({ adv: { limits: { scanDaily: 1, scanPerUserDaily: 3 } } }));
    for (const [f, days] of [['day', 1], ['week', 7], ['month', 30]]) {
      const r = await call('setScanQuota', SUPER, { bizId: A, mode: 'release', for: f });
      assert.equal(r.status, 'OK');
      const until = r.result.scanQuota.release.until;
      assert.ok(Math.abs(until - (Date.now() + days * 86400000)) < 60000, f);
      assert.equal((await S().bizCaps(A, 100)).bizDaily, null, f);
      assert.equal((await S().bizCaps(A, 100, until + 1)).bizDaily, 1, f + ': אחרי התפוגה – ההגבלה הרגילה');
    }
    assert.equal((await call('setScanQuota', SUPER, { bizId: A, mode: 'release', for: 'forever' })).status, 'OK');
    assert.equal((await S().bizCaps(A, 100, Date.now() + 3650 * 86400000)).bizDaily, null);
    for (let i = 0; i < 3; i++) assert.equal((await call('scanDocument', U.all, CLS())).status, 'OK');
    assert.equal((await call('scanDocument', U.all, CLS())).reason, 'daily-limit', 'התקרה למשתמש נשארת');
    // default – חוזר להתנהגות של היום
    assert.equal((await call('setScanQuota', SUPER, { bizId: A, mode: 'default' })).status, 'OK');
    assert.equal((await getDoc(`b/${A}/private/info`)).scanQuota, undefined);
    assert.equal((await S().bizCaps(A, 100)).bizDaily, 1);
  });
  it('עסק אחר לא מושפע מהגדרה של עסק א\'', async () => {
    await call('setScanQuota', SUPER, { bizId: A, mode: 'limit', period: 'day', n: 0 });
    assert.equal((await call('scanDocument', U.all, CLS())).reason, 'biz-daily-limit');
    assert.equal((await call('scanDocument', U.bemp, CLS())).status, 'OK');
  });
});
