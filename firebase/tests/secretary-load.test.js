'use strict';
// המזכירה העסקית – שלב 8: בדיקת עומס (2026-11-12). מול אמולטור Firestore בלבד, ושירותים מדומים: Meta – בקשות webhook חתומות בסוד דמה
// שנבנות כאן; Gmail – google-mock.js (127.0.0.1); זיהוי חשבוניות – פונקציה מדומה. אין פנייה לשום שירות חיצוני.
// נבדק: הרבה הודעות ווצאפ בבת אחת (כולל שליחה חוזרת של Meta באמצע), הרבה מיילים בבת אחת (כמה התראות במקביל), ותור חשבוניות גדול –
// אין אובדן, אין כפילות, והמכסות נאכפות (לשולח לשעה, הצפה לשעה, מיילים ליום לתיבה, מכסת הסריקה של העסק).
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.SEC_INV_TEST_NOQUEUE = '1';
process.env.GOOGLE_API_BASE = 'http://127.0.0.1:9794';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.invalid';
process.env.GOOGLE_OAUTH_REDIRECT = 'http://127.0.0.1:5001/demo-largpeami/us-central1/secOAuthCb';
process.env.GOOGLE_CLIENT_SECRET = 'DUMMY-GOOGLE-CLIENT-SECRET-41ac';
process.env.SEC_GOOGLE_KEY = Buffer.from('test-only-sec-google-key-32bytes').toString('base64');
for (const k of ['GEMINI_API_BASE', 'WA_GRAPH_BASE', 'ELEVENLABS_API_BASE']) process.env[k] = 'http://127.0.0.1:9';
for (const k of ['GEMINI_API_KEY', 'WA_ACCESS_TOKEN']) delete process.env[k];

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers');
const GO = require('./google-mock');

const A = 'biz-ld', M1 = 'ld_m1', SUPER = 'ld_super';
const PNID = '106540352242922', SECRET = 'test-only-app-secret-ld';
const BOX = 'office@ld-biz.example';
let env, T, WA, G, CORE, INV, SEC;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
async function inBiz(fn) { const b = await T.loadBiz(A); return T.runInBiz({ bizId: A, prefix: T.bizPrefix(b), biz: b }, () => fn(T.tdb())); }
const chunks = (L, n) => Array.from({ length: Math.ceil(L.length / n) }, (_, i) => L.slice(i * n, (i + 1) * n));

// אמולטור הפונקציות רץ (ב-CI)? אז הטריגר על sec_waq מעבד ומוחק את רשומות התור, ולכן אותן לא סופרים. נבדק מול ה-hub המקומי של האמולטורים
async function fnLive() {
  if (process.env.FUNCTIONS_EMULATOR_HOST) return true;
  const hub = process.env.FIREBASE_EMULATOR_HUB; if (!hub) return false;
  try { const j = await (await fetch('http://' + hub + '/emulators')).json(); return !!(j && j.functions); } catch (e) { return false; }
}
async function seed() {
  await env.clearFirestore();
  GO.reset();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true, secretary: true, scan: true } });
    b.set(d.doc(`b/${A}/admins/${M1}`), { email: 'm1@ld-owner.example' });
    b.set(d.doc('users/' + M1), { bizId: A, role: 'admin', active: true, bizStatus: 'active', email: 'm1@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: false, pay: {}, mgr: { [M1]: { cv: SEC.CONSENT_VER, ca: 1 } } });
    b.set(d.doc(`b/${A}/sec_cfg/wa`), { pnid: PNID, num: '972500000000', hour: 5 });
    b.set(d.doc('sec_route/' + PNID), { biz: A, mgr: {} });
    await b.commit();
  });
}

// ---------- ווצאפ: גוף webhook חתום, כמו ש-Meta שולחת ----------
function hookReq(msgs) {
  const body = { object: 'whatsapp_business_account', entry: [{ id: 'x', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PNID }, contacts: [], messages: msgs } }] }] };
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const hd = { 'content-length': String(raw.length), 'x-hub-signature-256': sig };
  return { method: 'POST', rawBody: raw, get: (h) => hd[String(h).toLowerCase()] };
}
function fakeRes() { return { code: 0, body: '', headersSent: false, status(c) { this.code = c; return this; }, set() { return this; }, send(b) { this.body = b; this.headersSent = true; return this; } }; }
// Meta: אם התשובה אינה 200 – שולחת שוב (עד 6 ניסיונות כאן)
async function deliver(msgs, now) {
  for (let i = 0; i < 6; i++) {
    const res = fakeRes();
    try { await WA.handleHook(hookReq(msgs), res, { secret: SECRET, now }); } catch (e) { res.code = 500; }
    if (res.code === 200) return i + 1;
  }
  return 0;
}

before(async () => {
  env = await H.getEnv(); require('../functions/index.js'); await GO.start();
  T = require('../functions/lib/tenant.js'); SEC = require('../functions/secretary.js')._core;
  WA = require('../functions/secretary-wa.js')._core; INV = require('../functions/secretary-inv.js')._core;
  CORE = require('../functions/secretary-google.js')._core; G = require('../functions/lib/sec-google.js');
});
after(async () => { await GO.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('עומס: ווצאפ, מייל ותור חשבוניות – בלי אובדן, בלי כפילות, המכסות נאכפות', () => {
  it('ווצאפ: 320 הודעות מ-32 שולחים בבת אחת + שליחה חוזרת של כולן במקביל → 320 רשומות בדיוק; 5 לשעה לשולח (השאר "מעל המגבלה", בלי עיבוד); מעל 300 לשעה – עצירה אוטומטית', async () => {
    await seed();
    const now = Date.now();
    const msgs = [];
    for (let s = 0; s < 32; s++) for (let k = 0; k < 10; k++) msgs.push({ id: `wamid.LD${s}_${k}`, from: '97252' + String(1000000 + s), timestamp: String(Math.floor(now / 1000)), type: 'text', text: { body: `הודעה ${k} משולח ${s}` } });
    // כל הודעה נשלחת פעמיים (Meta שולחת שוב), והכול מעורבב ובמקביל – 40 בקשות בכל פעם
    const reqs = msgs.map((m) => [m]).concat(msgs.map((m) => [m])).sort(() => Math.random() - 0.5);
    const tries = [];
    for (const c of chunks(reqs, 40)) tries.push(...(await Promise.all(c.map((r) => deliver(r, now)))));
    assert.ok(tries.every((n) => n > 0), 'כל בקשה התקבלה בסוף (אולי אחרי ניסיון חוזר)');
    const ins = await coll(`b/${A}/sec_in`);
    assert.equal(ins.length, 320, 'אין אובדן ואין כפילות');
    assert.equal(new Set(ins.map((x) => x.wamid)).size, 320);
    const bySnd = {};
    for (const x of ins) (bySnd[x.from] = bySnd[x.from] || []).push(x.st);
    assert.equal(Object.keys(bySnd).length, 32);
    for (const [wa, L] of Object.entries(bySnd)) {
      assert.equal(L.filter((s) => s !== 'over').length, 5, wa + ': 5 לעיבוד'); // ב-CI הטריגר (אמולטור הפונקציות) כבר מעבד אותן – המצב משתנה מ-new
      assert.equal(L.filter((s) => s === 'over').length, 5, wa + ': 5 מעל המגבלה – נשמרו בלי עיבוד');
    }
    // בלי אמולטור הפונקציות התור נשאר לבדיקה; איתו (CI) הטריגר מעבד ומוחק את רשומות התור
    if (!(await fnLive())) { const q = (await coll('sec_waq')).filter((x) => x.biz === A); assert.equal(q.length, 160, 'רשומה אחת בתור לכל הודעה לעיבוד – בלי כפילות'); }
    const snd = await coll(`b/${A}/sec_snd`);
    assert.ok(snd.every((x) => x.n === 10 && x.rn === 10), 'מונה לכל שולח – מדויק');
    assert.equal((await get(`b/${A}/sec_cfg/wa_use`)).n, 320, 'מונה ההצפה – מדויק');
    const wa = await get(`b/${A}/sec_cfg/wa`);
    assert.equal(wa.stop && wa.stop.on, true, 'מעל 300 הודעות בשעה – עצירה אוטומטית'); assert.equal(wa.stop.why, 'flood');
    assert.equal((await coll(`b/${A}/sec_log`)).filter((l) => l.act === 'autoStop').length, 1, 'עצירה אחת בלבד');
  });

  it('מייל: 120 מיילים בבת אחת, 4 התראות במקביל ועוד ריצות המשך → 120 בדיוק; מכסה יומית לתיבה נאכפת גם במקביל', async () => {
    await seed();
    // חיבור התיבה (כמו בבדיקות שלב 6): קישור מהשרת → קוד מהדמה → secOAuthCb → אישור
    const call = (fn, data) => CORE.call[fn]({ auth: { uid: M1, token: { email: M1 + '@x.invalid' } }, data });
    const r = await call('secGoogle', { op: 'connect', kind: 'mail' });
    const u = new URL(r.url);
    const code = GO.code({ challenge: u.searchParams.get('code_challenge'), scope: u.searchParams.get('scope'), email: BOX });
    const res = fakeRes();
    await CORE.handleCb({ method: 'GET', query: { state: u.searchParams.get('state'), code }, originalUrl: '/secOAuthCb' }, res);
    const tok = (/name="tok" value="([A-Za-z0-9_-]{43})"/.exec(res.body || '') || [])[1];
    assert.ok(tok, 'דף אישור החיבור');
    await CORE.handleCb({ method: 'POST', body: { tok, ok: '1' }, originalUrl: '/secOAuthCb' }, fakeRes());
    await CORE.mailHook(GO.note(BOX)); // התראה ראשונה – נקודת ההתחלה
    for (let i = 0; i < 120; i++) GO.addMail(BOX, { from: `c${i}@cust.example`, subject: 'שאלה ' + i, text: 'שלום ' + i });
    const runs = await Promise.all([0, 1, 2, 3].map(() => CORE.mailHook(GO.note(BOX)).catch((e) => ({ err: String(e && (e.code || e.message)) }))));
    for (let i = 0; i < 10; i++) { const x = await CORE.mailHook(GO.note(BOX)).catch(() => ({})); if (!x.more && !x.lag) break; }
    const box = G.boxIdOf(BOX);
    for (let i = 0; i < 6; i++) await inBiz(() => CORE.ingestBox(box, BOX, {})).catch(() => {}); // ריצות המשך (כמו secCalSync)
    const mails = (await coll(`b/${A}/sec_in`)).filter((x) => x.ch === 'mail');
    assert.equal(mails.length, 120, 'אין אובדן ואין כפילות: ' + JSON.stringify(runs).slice(0, 300));
    assert.equal(new Set(mails.map((x) => x.gid)).size, 120);
    const use = (await get(`b/${A}/sec_cfg/mail_use`)).in[box];
    assert.equal(use.n, 120, 'מונה המכסה היומית – בדיוק כמספר המיילים שנקלטו (שמירה כפולה במקביל לא נספרת פעמיים)');
    // מכסה יומית: נשארו 30 מקומות, מגיעים 60 – בדיוק 30 נקלטים, גם כשההתראות מגיעות במקביל
    await prep((d) => d.doc(`b/${A}/sec_cfg/mail_use`).set({ in: { [box]: { d: use.d, n: G.DAY_IN_MAX - 30 } } }, { merge: true }));
    for (let i = 0; i < 60; i++) GO.addMail(BOX, { from: `d${i}@cust.example`, subject: 'עוד ' + i, text: 'x' + i });
    await Promise.all([0, 1, 2].map(() => CORE.mailHook(GO.note(BOX)).catch(() => ({}))));
    for (let i = 0; i < 4; i++) await inBiz(() => CORE.ingestBox(box, BOX, {})).catch(() => {});
    const after2 = (await coll(`b/${A}/sec_in`)).filter((x) => x.ch === 'mail');
    assert.equal(after2.length, 150, 'רק 30 נוספו – המכסה היומית נאכפת');
    assert.equal((await get(`b/${A}/sec_cfg/mail_use`)).in[box].n, G.DAY_IN_MAX);
  });

  it('תור חשבוניות: 150 קבצים + 50 כפולים (אותו קובץ ממייל ומווצאפ) במקביל → 150 רשומות; זיהוי במקביל (וגם פעמיים לאותו קובץ) → כל קובץ מזוהה פעם אחת; מכסת הסריקה (100) נאכפת בדיוק', async () => {
    await seed();
    await prep((d) => d.doc(`b/${A}/private/info`).set({ adv: { limits: { scanDaily: 100 } } }));
    const pdf = (i) => Buffer.from('%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Count 1>>endobj\n3 0 obj<</Type /Page /Parent 2 0 R>>endobj\n%uniq ' + i + '\ntrailer<<>>\n%%EOF', 'latin1');
    const arr = [];
    for (let i = 0; i < 150; i++) arr.push({ ch: 'wa', from: '972521234567', inId: 'w' + i, fn: 'inv' + i + '.pdf', buf: pdf(i) });
    for (let i = 0; i < 50; i++) arr.push({ ch: 'mail', from: 'billing@supplier.example', inId: 'g' + i, fn: 'inv' + i + '.pdf', buf: pdf(i) });
    arr.sort(() => Math.random() - 0.5);
    const res = [];
    for (const c of chunks(arr, 40)) res.push(...(await inBiz((db) => Promise.all(c.map((o) => INV.ingest(db, o))))));
    let L = await coll(`b/${A}/sec_inv`);
    assert.equal(L.length, 150, 'אין כפילות');
    assert.equal(res.filter((r) => r.dup).length, 50);
    assert.equal(L.filter((x) => (x.src || []).length === 2).length, 50, 'הכפולים נרשמו כמקור נוסף על אותה רשומה (לא אבדו)');
    assert.ok(L.every((x) => x.st === 'q'));
    let CLS = 0;
    const seen = new Map();
    const classify = (id) => async () => { CLS++; seen.set(id, (seen.get(id) || 0) + 1); return { type: 'invoice', type_confidence: 0.97, fields: { supplier: 'ספק', supplier_id: '512345678', number: 'N-' + id.slice(1, 9), date: '2026-11-01', total_with_vat: 100 }, confidence: {} }; };
    const jobs = L.map((x) => x.id).concat(L.slice(0, 30).map((x) => x.id)).sort(() => Math.random() - 0.5); // 30 קבצים מקבלים "טריגר" פעמיים
    let errs = 0;
    for (const c of chunks(jobs, 10)) errs += (await inBiz(() => Promise.allSettled(c.map((id) => INV.workIn(id, { classify: classify(id) }))))).filter((r) => r.status === 'rejected').length;
    // תקלה זמנית (למשל עומס על מונה הסריקה) – הקובץ לא אובד: secRemind מחזיר אותו לתור אחרי 10 דקות (requeue), והזיהוי ממשיך
    for (let k = 1; k <= 4; k++) {
      const left = (await coll(`b/${A}/sec_inv`)).filter((x) => x.st === 'q' || x.st === 'qw');
      if (!left.length) break;
      await inBiz((db) => INV.requeue(db, A, Date.now() + k * 11 * 60000));
      await inBiz(() => Promise.allSettled(left.map((x) => INV.workIn(x.id, { classify: classify(x.id), now: Date.now() + k * 11 * 60000 }))));
    }
    if (errs) console.log('תקלות זמניות שטופלו בניסיון חוזר: ' + errs);
    L = await coll(`b/${A}/sec_inv`);
    assert.ok([...seen.values()].every((n) => n === 1), 'אף קובץ לא נשלח לזיהוי פעמיים');
    assert.equal(CLS, 100, 'בדיוק 100 זיהויים – מכסת העסק');
    assert.equal(L.filter((x) => x.k === 'inv').length, 100);
    const q = L.filter((x) => x.err === 'quota');
    assert.equal(q.length, 50, 'השאר – "לא זוהה (מכסה)", נשארים בתור לטיפול ידני ולא נעלמים');
    assert.ok(q.every((x) => x.st === 'new' && x.np >= 1), 'הקובץ נשמר');
    assert.equal(L.filter((x) => x.st === 'q' || x.st === 'qw').length, 0, 'שום קובץ לא נתקע באמצע');
    assert.equal((await get(`b/${A}/scan_usage/_biz`)).count, 100, 'מונה הסריקה של העסק – בדיוק 100');
  });
});
