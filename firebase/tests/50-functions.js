'use strict';
// בדיקות לפונקציות השרת (שלב 3), מול אמולטור הפונקציות. Gemini מוחלף בשרת דמה מקומי (gemini-mock.js).
// הקריאות נשלחות בדיוק כמו שאפליקציה שולחת קריאה לפונקציה (callable): POST עם {"data": ...} וטוקן כניסה.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const M = require('./gemini-mock');
const { appPrompts } = require('../scripts/app-prompts');
const SERVER_PROMPTS = require('../functions/lib/prompts');

const FN = ['scanDocument', 'registerPushToken', 'reportBackupStatus', 'getBackupKey'];
const ROLE_EXPECT = { guest: 'UNAUTHENTICATED', signedIn: 'PERMISSION_DENIED', disabledEmployee: 'PERMISSION_DENIED', employee: 'OK', manager: 'OK' };
const RESULTS = [];

// כתובת אמולטור הפונקציות – מתוך firebase.json (האמולטור לא מפרסם אותה במשתנה סביבה)
const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
function fnUrl(name) {
  const host = process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`;
  return `http://${host}/${H.PROJECT_ID}/us-central1/${name}`;
}
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  const status = json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status);
  return { http: r.status, status, json, result: json && json.result, error: json && json.error };
}

// קבצים קטנים עם "חתימת" סוג אמיתית בתחילתם
const fileOf = (head, size) => { const b = Buffer.alloc(size || 200); Buffer.from(head).copy(b); return b; };
const JPG = (size) => fileOf([0xff, 0xd8, 0xff, 0xe0], size);
const PNG = () => fileOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = () => fileOf(Buffer.from('%PDF-1.7\n'));
const b64 = (buf) => buf.toString('base64');
const jpgFile = (size) => ({ mimeType: 'image/jpeg', data: b64(JPG(size)) });

const MB10 = 10 * 1024 * 1024;
const DUMMY_MASTER = Buffer.from('dummy-backup-master-key-32-bytes'); // אותו ערך דמה ש-scripts/ensure-emulator-secrets.js כותב

// קלט תקין לכל פונקציה, לבדיקת התפקידים
const VALID = {
  scanDocument: () => ({ kind: 'invoice', files: [jpgFile()] }),
  registerPushToken: () => ({ token: 'tok_' + 'a'.repeat(40) }),
  reportBackupStatus: () => ({ file: 'seed.bin', device: 'בדיקה' }),
  getBackupKey: () => ({}),
};

async function usageOf(env, uid) {
  let v = null;
  await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc('scan_usage/' + uid).get(); v = s.exists ? s.data() : null; });
  return v;
}
async function docOf(env, p) {
  let v = null;
  await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(p).get(); v = s.exists ? s.data() : null; });
  return v;
}

describe('פונקציות שרת (שלב 3)', () => {
  let env;
  before(async () => {
    if (!process.env.FUNCTIONS_EMULATOR_HOST && !process.env.FIREBASE_EMULATOR_HUB) throw new Error('הבדיקות רצות רק בתוך האמולטור (npm test)');
    env = await H.getEnv();
    await M.start();
  });
  after(async () => { await M.stop(); });
  beforeEach(async () => { await H.seed(env); await H.clearStorageAndSeed(env); M.reset(); });

  // ---------------- 1. תפקידים: לכל פונקציה × 5 תפקידים ----------------
  for (const fn of FN) {
    for (const role of H.ROLES) {
      it(`${fn} × ${role}: ${ROLE_EXPECT[role] === 'OK' ? 'מצליח' : 'נדחה (' + ROLE_EXPECT[role] + ')'}`, async () => {
        const r = await call(fn, H.UID[role], VALID[fn]());
        assert.equal(r.status, ROLE_EXPECT[role], JSON.stringify(r.json));
        if (role === 'signedIn') assert.equal(r.error.details.reason, 'not-staff');
        if (role === 'disabledEmployee') assert.equal(r.error.details.reason, 'staff-disabled');
        if (ROLE_EXPECT[role] !== 'OK') {
          // אין תופעות לוואי לנדחה: לא נספר זיהוי, לא נרשם טלפון, לא עודכן גיבוי, ולא הגיעה בקשה ל-Gemini
          if (H.UID[role]) assert.equal(await usageOf(env, H.UID[role]), null);
          assert.equal(M.state.requests.length, 0);
          if (fn === 'registerPushToken' && role === 'disabledEmployee') assert.deepEqual((await docOf(env, 'staff/u_off')).pushTokens, []);
          if (fn === 'reportBackupStatus' && H.UID[role]) assert.equal((await docOf(env, 'app_backup_status/' + H.UID[role])).size, 1234);
        }
        RESULTS.push({ fn, role, status: r.status });
      });
    }
    it(`${fn} × מנהל כמו היום (רק admins, בלי staff)`, async () => {
      if (fn === 'reportBackupStatus') {
        await env.withSecurityRulesDisabled((c) => new Promise((ok, no) => c.storage().ref(`app_backups/${H.MANAGER_ONLY_ADMINS}/seed.bin`).put(new Uint8Array(10), { contentType: 'application/octet-stream' }).then(ok, no)));
      }
      const r = await call(fn, H.MANAGER_ONLY_ADMINS, VALID[fn]());
      // המזכירה שלב 4: מנהל בלי מסמך staff נרשם ב-push_tokens/{uid} – בלי ליצור מסמך staff
      if (fn === 'registerPushToken') {
        assert.equal(r.status, 'OK', JSON.stringify(r.json));
        assert.equal(await docOf(env, 'staff/' + H.MANAGER_ONLY_ADMINS), null);
        assert.deepEqual((await docOf(env, 'push_tokens/' + H.MANAGER_ONLY_ADMINS)).pushTokens, [VALID[fn]().token]);
      } else assert.equal(r.status, 'OK', JSON.stringify(r.json));
    });
  }

  it('עובד מושבת נחסם מיד גם בפונקציות: אותו טוקן, הקריאה הבאה אחרי ההשבתה נדחית', async () => {
    assert.equal((await call('getBackupKey', 'u_emp')).status, 'OK');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc('staff/u_emp').update({ active: false }));
    for (const fn of FN) assert.equal((await call(fn, 'u_emp', VALID[fn]())).status, 'PERMISSION_DENIED', fn);
  });

  // ---------------- 2. scanDocument ----------------
  describe('scanDocument', () => {
    it('קובץ גדול מ-10MB נדחה (10MB + בית אחד); קובץ של בדיוק 10MB מתקבל', async () => {
      const big = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile(MB10 + 1)] });
      assert.equal(big.status, 'INVALID_ARGUMENT', JSON.stringify(big.json).slice(0, 300));
      assert.equal(big.error.details.reason, 'too-big');
      assert.equal(M.state.requests.length, 0);
      const ok = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile(MB10)] });
      assert.equal(ok.status, 'OK', JSON.stringify(ok.json).slice(0, 300));
      // וגם: כמה קבצים שיחד עוברים 10MB
      const two = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile(6 * 1024 * 1024), jpgFile(6 * 1024 * 1024)] });
      assert.equal(two.status, 'INVALID_ARGUMENT');
      assert.equal(two.error.details.reason, 'too-big');
    });

    it('קובץ שאינו תמונה או PDF נדחה – גם כשהלקוח "מצהיר" שהוא תמונה', async () => {
      const cases = [
        { mimeType: 'text/plain', data: b64(Buffer.from('hello world')) },
        { mimeType: 'application/zip', data: b64(fileOf([0x50, 0x4b, 0x03, 0x04])) },
        { mimeType: 'image/jpeg', data: b64(fileOf(Buffer.from('MZ'))) },             // קובץ הרצה שמתחזה ל-JPEG
        { mimeType: 'image/jpeg', data: b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')) },
        { mimeType: 'image/png', data: b64(JPG()) },                                   // סוג מוצהר לא תואם לתוכן
        { mimeType: 'image/jpeg', data: 'not base64!!' },
      ];
      for (const f of cases) {
        const r = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [f] });
        assert.equal(r.status, 'INVALID_ARGUMENT', f.mimeType);
        assert.ok(['bad-type', 'bad-base64'].includes(r.error.details.reason), r.error.details.reason);
      }
      assert.equal(M.state.requests.length, 0);
      // תמונה ו-PDF אמיתיים מתקבלים
      for (const f of [{ mimeType: 'image/png', data: b64(PNG()) }, { mimeType: 'application/pdf', data: b64(PDF()) }, jpgFile()]) {
        const r = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [f] });
        assert.equal(r.status, 'OK', f.mimeType);
        const sent = M.state.requests[M.state.requests.length - 1].body.contents[0].parts[1].inline_data;
        assert.equal(sent.mime_type, f.mimeType);
        assert.equal(sent.data, f.data);
      }
    });

    it('קלט לא תקין: סוג זיהוי לא מוכר, מספר קבצים לא מתאים', async () => {
      const bads = [
        { kind: 'other', files: [jpgFile()] },
        { kind: 'invoice', files: [] },
        { kind: 'invoice', files: [jpgFile(), jpgFile(), jpgFile(), jpgFile(), jpgFile()] },
        { kind: 'product', files: [jpgFile(), jpgFile()] },
        { kind: 'feedback', files: [jpgFile(), jpgFile()] },
        { kind: 'zreport', files: [jpgFile()] },
        { kind: 'zreport', files: [jpgFile(), jpgFile()] },
        { kind: 'zreport', files: [jpgFile(), jpgFile(), jpgFile(), jpgFile()] },
        { kind: 'opening', files: [] },
        { kind: 'opening', files: [jpgFile(), jpgFile()] },
        { kind: 'deposit', files: [] },
        { kind: 'deposit', files: [jpgFile(), jpgFile()] },
        { kind: 'cashout', files: [] },
        { kind: 'cashout', files: [jpgFile(), jpgFile()] },
        'טקסט במקום אובייקט',
      ];
      for (const d of bads) assert.equal((await call('scanDocument', 'u_emp', d)).status, 'INVALID_ARGUMENT', JSON.stringify(d).slice(0, 80));
      assert.equal(M.state.requests.length, 0);
    });

    it('הקריאה ה-101 באותו יום נדחית; משתמש אחר לא מושפע; ביום חדש המונה מתאפס', async () => {
      const uid = 'u_emp2';
      for (let i = 1; i <= 100; i++) {
        const r = await call('scanDocument', uid, { kind: 'product', files: [jpgFile()] });
        assert.equal(r.status, 'OK', `קריאה ${i}: ${JSON.stringify(r.json)}`);
        assert.equal(r.result.usage.used, i);
      }
      const r101 = await call('scanDocument', uid, { kind: 'product', files: [jpgFile()] });
      assert.equal(r101.status, 'RESOURCE_EXHAUSTED');
      assert.equal(r101.error.details.reason, 'daily-limit');
      assert.equal(r101.error.details.limit, 100);
      assert.match(r101.error.message, /מגבלת השימוש/); // האפליקציה מזהה את הביטוי הזה ומחכה לפני ניסיון חוזר
      assert.equal(M.state.requests.length, 100, 'הקריאה ה-101 לא הגיעה ל-Gemini');
      assert.equal((await usageOf(env, uid)).count, 100);
      // משתמש אחר – לא מושפע
      assert.equal((await call('scanDocument', 'u_emp', { kind: 'product', files: [jpgFile()] })).status, 'OK');
      // "מחר": המונה שמור עם תאריך של אתמול – מתאפס
      await env.withSecurityRulesDisabled((c) => c.firestore().doc('scan_usage/' + uid).set({ day: '2000-01-01', count: 100 }));
      const tomorrow = await call('scanDocument', uid, { kind: 'product', files: [jpgFile()] });
      assert.equal(tomorrow.status, 'OK');
      assert.equal(tomorrow.result.usage.used, 1);
    });

    it('סוג זיהוי שהוא שם מובנה של JavaScript (__proto__, constructor, toString, hasOwnProperty) נדחה לפני Gemini ולא נספר', async () => {
      const many = Array.from({ length: 12 }, () => jpgFile());
      for (const kind of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
        for (const files of [[jpgFile()], many]) {
          const r = await call('scanDocument', 'u_emp', { kind, files });
          assert.equal(r.status, 'INVALID_ARGUMENT', `${kind}: ${JSON.stringify(r.json).slice(0, 200)}`);
          assert.equal(r.error.details.reason, 'bad-kind', kind);
        }
      }
      // גם סוג שאינו מחרוזת
      for (const kind of [null, 1, ['invoice'], { invoice: 1 }]) assert.equal((await call('scanDocument', 'u_emp', { kind, files: [jpgFile()] })).status, 'INVALID_ARGUMENT');
      assert.equal(M.state.requests.length, 0, 'שום בקשה לא הגיעה ל-Gemini');
      assert.equal(M.state.listCalls, 0);
      assert.equal(await usageOf(env, 'u_emp'), null, 'המונה לא נוצר ולא השתנה');
      // וגם בתוך קוד השרת עצמו: בניית הבקשה מסרבת לסוג כזה
      const scan = require('../functions/lib/scan');
      for (const kind of ['__proto__', 'constructor', 'toString']) {
        assert.equal(scan.isKind(kind), false);
        assert.throws(() => scan.buildGeminiBody(kind, [jpgFile()]), (e) => e.details && e.details.reason === 'bad-kind');
      }
    });

    it('ניסיון שבו הבקשה יצאה ל-Gemini נספר במגבלה היומית גם כשהוא נכשל (מפתח לא תקין, מכסה, עומס)', async () => {
      M.state.mode = 'badkey';
      const r1 = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile()] });
      assert.equal(r1.status, 'FAILED_PRECONDITION');
      assert.match(r1.error.message, /מפתח/); // האפליקציה מפסיקה לנסות שוב כשההודעה כוללת "מפתח"
      M.state.mode = 'quota';
      const r2 = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile()] });
      assert.equal(r2.status, 'RESOURCE_EXHAUSTED');
      assert.equal(r2.error.details.reason, 'gemini-quota');
      M.state.mode = 'overloaded';
      const r3 = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile()] });
      assert.equal(r3.status, 'UNAVAILABLE');
      assert.equal(r3.error.message, 'הזיהוי עמוס כרגע, נסו שוב בעוד דקה', 'הודעה פשוטה, בלי שם המודל');
      assert.ok(M.state.requests.length >= 3);
      assert.equal((await usageOf(env, 'u_emp')).count, 3, 'כל אחד משלושת הניסיונות נספר פעם אחת');
    });

    // ---- תקציב זמן כולל (תיקון אחרי בדיקת שלב 4) ----
    // באמולטור כל הזמנים מוכפלים ב-SCAN_TIME_SCALE (functions/.env.demo-largpeami), כדי שהבדיקה לא תחכה 100 שניות.
    const SCALE = Number((fs.readFileSync(path.join(H.ROOT, 'functions', '.env.demo-largpeami'), 'utf8').match(/^SCAN_TIME_SCALE=(.+)$/m) || [])[1]);

    it('תקציב הזמן בשרת: 100 שניות לחשבונית, למוצר ולסגירת קופה, 135 למשוב – תמיד פחות ממה שהטלפון מחכה (120 / 150)', () => {
      const scan = require('../functions/lib/scan');
      assert.deepEqual(Object.fromEntries(Object.entries(scan.KINDS).map(([k, v]) => [k, v.budgetMs])), { invoice: 100000, product: 100000, feedback: 135000, zreport: 100000, opening: 100000, deposit: 100000, cashout: 100000, transfer: 100000, recipe: 135000, classify: 100000, invlines: 100000, ordlist: 100000, payproof: 100000 });
      assert.deepEqual(scan.PHONE_WAIT_MS, { invoice: 120000, product: 120000, feedback: 150000, zreport: 120000, opening: 120000, deposit: 120000, cashout: 120000, transfer: 120000, recipe: 150000, classify: 120000, invlines: 120000, ordlist: 120000, payproof: 120000 });
      for (const k of Object.keys(scan.KINDS)) assert.ok(scan.KINDS[k].budgetMs < scan.PHONE_WAIT_MS[k], k);
      // מחוץ לאמולטור אין קיצור זמנים, גם אם מישהו הגדיר SCAN_TIME_SCALE
      const prevE = process.env.FUNCTIONS_EMULATOR, prevS = process.env.SCAN_TIME_SCALE;
      process.env.SCAN_TIME_SCALE = '0.01'; delete process.env.FUNCTIONS_EMULATOR;
      try { assert.deepEqual(scan.timesFor('feedback'), { timeoutMs: 150000, budgetMs: 135000 }); }
      finally { if (prevE !== undefined) process.env.FUNCTIONS_EMULATOR = prevE; if (prevS === undefined) delete process.env.SCAN_TIME_SCALE; else process.env.SCAN_TIME_SCALE = prevS; }
      assert.ok(SCALE > 0 && SCALE < 1, 'SCAN_TIME_SCALE באמולטור');
    });

    it('כש-Gemini איטי: השרת עוצר בסוף התקציב ומחזיר שגיאה ברורה; הקריאה נספרת פעם אחת, כי בקשות יצאו (חשבונית)', async () => {
      const budget = 100000 * SCALE, perModel = 30000 * SCALE;
      M.state.delayMs = perModel * 2; // כל מודל "חושב" יותר מהזמן שמוקצב לו
      const t0 = Date.now();
      const r = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile()] });
      const took = Date.now() - t0;
      assert.equal(r.status, 'DEADLINE_EXCEEDED', JSON.stringify(r.json));
      assert.equal(r.error.details.reason, 'time-budget');
      assert.match(r.error.message, /לקח יותר מדי זמן/);
      assert.ok(took >= budget - 300 && took <= budget + 1500, `נמשך ${took}ms, תקציב ${budget}ms`);
      assert.ok(M.state.requests.length >= 3, 'ניסה כמה מודלים בתוך התקציב: ' + M.state.requests.length);
      // אף מודל לא התחיל אחרי סוף התקציב
      for (const q of M.state.requests) assert.ok(q.at - t0 <= budget + 200, 'בקשה שהתחילה אחרי סוף התקציב');
      assert.equal((await usageOf(env, 'u_emp')).count, 1, 'קריאה אחת = ספירה אחת, גם אם נוסו כמה מודלים');
      // ואחרי ש-Gemini חוזר לענות מהר – הזיהוי עובד, והוא השני היום
      M.reset();
      const ok = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile()] });
      assert.equal(ok.status, 'OK');
      assert.equal(ok.result.usage.used, 2);
    });

    it('הזמן לכל מודל נחתך לפי מה שנשאר מהתקציב: במשוב (150 שניות למודל, תקציב 135) השרת לא מחכה מעבר לתקציב', async () => {
      const budget = 135000 * SCALE;
      M.state.delayMs = 150000 * SCALE * 2;
      const t0 = Date.now();
      const r = await call('scanDocument', 'u_mgr', { kind: 'feedback', files: [jpgFile()] });
      const took = Date.now() - t0;
      assert.equal(r.status, 'DEADLINE_EXCEEDED', JSON.stringify(r.json));
      assert.equal(r.error.details.reason, 'time-budget');
      assert.ok(took >= budget - 300 && took <= budget + 1500, `נמשך ${took}ms, תקציב ${budget}ms (בלי חיתוך היה מחכה ${150000 * SCALE}ms למודל הראשון)`);
      // המודל הראשון קיבל רק את מה שנשאר מהתקציב, ולכן לא נשאר זמן למודל שני
      assert.equal(M.state.requests.length, 1);
      assert.equal((await usageOf(env, 'u_mgr')).count, 1);
    });

    it('אם התקציב נגמר לפני שיצאה בקשה כלשהי ל-Gemini – הקריאה לא נספרת', async () => {
      // רשימת המודלים איטית יותר מכל התקציב, ולכן אף בקשת זיהוי לא יוצאת
      const scan = require('../functions/lib/scan');
      scan._resetCacheForTests();
      M.state.listDelayMs = 100000 * SCALE * 2;
      const stats = { sent: 0 };
      await assert.rejects(scan.callGemini(`http://127.0.0.1:${M.PORT}`, 'k', {}, 30000 * SCALE, false, { deadline: Date.now() + 200, stats }), (e) => e.details && e.details.reason === 'time-budget');
      assert.equal(stats.sent, 0);
      assert.equal(M.state.requests.length, 0);
      // וב-index.js: הקריאה מוחזרת למונה רק כש-stats.sent === 0
      const src = fs.readFileSync(path.join(H.ROOT, 'functions', 'index.js'), 'utf8');
      assert.match(src, /if \(stats\.sent === 0\) await scan\.refundScan\(who\.uid, usage\.day\);/);
    });

    it('שגיאה מ-Gemini שהגוף שלה מגיע לאט: גם קריאת גוף השגיאה מוגבלת בתקציב, והקריאה נספרת', async () => {
      const budget = 100000 * SCALE;
      M.state.mode = 'slowErrorBody';
      M.state.delayMs = budget * 3;
      const t0 = Date.now();
      const r = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile()] });
      const took = Date.now() - t0;
      assert.equal(r.status, 'DEADLINE_EXCEEDED', JSON.stringify(r.json));
      assert.equal(r.error.details.reason, 'time-budget');
      assert.ok(took <= budget + 1500, `נמשך ${took}ms, תקציב ${budget}ms (בלי המגבלה היה נמשך ${budget * 3}ms)`);
      assert.equal(M.state.requests.length, 1);
      assert.equal((await usageOf(env, 'u_emp')).count, 1);
    });

    it('חיבור שנקטע אחרי שהבקשה הגיעה ל-Gemini – נספר; רק כשלא נוצר חיבור בכלל (ECONNREFUSED) – לא נספר', async () => {
      M.state.mode = 'hangup';
      const r = await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile()] });
      assert.equal(r.status, 'UNAVAILABLE', JSON.stringify(r.json));
      assert.equal(r.error.details.reason, 'network');
      assert.equal(M.state.requests.length, 1, 'הבקשה הגיעה במלואה לשרת הדמה');
      assert.equal((await usageOf(env, 'u_emp')).count, 1);
      // אין שרת בכלל בכתובת (פורט 59997 סגור) – החיבור נדחה מיד (ECONNREFUSED), ולכן אף בקשה לא יצאה
      const scan = require('../functions/lib/scan');
      scan._resetCacheForTests();
      const stats = { sent: 0 };
      await assert.rejects(scan.callGemini('http://127.0.0.1:59997', 'k', {}, 30000, false, { deadline: Date.now() + 5000, stats }), (e) => e.details && e.details.reason === 'network');
      assert.equal(stats.sent, 0);
      // וההבחנה עצמה: רק שלושת הקודים האלה נחשבים "לא נוצר חיבור"
      for (const c of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) assert.equal(scan.neverConnected({ cause: { code: c } }), true, c);
      for (const c of ['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE', 'ETIMEDOUT']) assert.equal(scan.neverConnected({ cause: { code: c } }), false, c);
      assert.equal(scan.neverConnected(new TypeError('fetch failed')), false, 'שגיאה בלי קוד – נספרת');
      assert.equal(scan.neverConnected({ cause: { errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] } }), true);
    });

    it('תשובה שמגיעה בתוך התקציב מתקבלת כרגיל, גם כשהיא איטית', async () => {
      M.state.delayMs = 30000 * SCALE * 0.5;
      const r = await call('scanDocument', 'u_emp', { kind: 'product', files: [jpgFile()] });
      assert.equal(r.status, 'OK');
      assert.deepEqual(r.result.data, M.ANSWERS.product);
      assert.equal(M.state.requests.length, 1);
    });

    it('הבקשה ל-Gemini זהה לזו שהאפליקציה שולחת היום: אותה הנחיה, אותן הגדרות, אותו סדר חלקים; המפתח מהכספת', async () => {
      const P = appPrompts();
      const pages = [jpgFile(300), jpgFile(400)];
      await call('scanDocument', 'u_emp', { kind: 'invoice', files: pages });
      await call('scanDocument', 'u_emp', { kind: 'product', files: [pages[0]] });
      const fb4 = [jpgFile(310), jpgFile(320), jpgFile(330), jpgFile(340)];
      await call('scanDocument', 'u_mgr', { kind: 'feedback', files: fb4 });
      await call('scanDocument', 'u_mgr', { kind: 'feedback', files: [fb4[0]] });
      const [inv, prod, fb, fb1] = M.state.requests;
      const img = (f) => ({ inline_data: { mime_type: f.mimeType, data: f.data } });
      // ocrAI: parts=[{text:OCAI_P}, ...pages]; generationConfig {responseMimeType:'application/json', temperature:0}
      assert.deepEqual(inv.body, { contents: [{ parts: [{ text: P.invoice.value }, ...pages.map(img)] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
      // shAI: [{text:SHAI_P},{inline_data}] temperature .1
      assert.deepEqual(prod.body, { contents: [{ parts: [{ text: P.product.value }, img(pages[0])] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } });
      // fbAI: [{text:FB_P}, {text:'תמונה 1: …'}, תמונה, …]
      const caps = P.feedbackCaptions.value;
      assert.deepEqual(fb.body.contents[0].parts, [{ text: P.feedback.value }, ...fb4.flatMap((f, i) => [{ text: caps[i] }, img(f)])]);
      assert.deepEqual(fb1.body.contents[0].parts, [{ text: P.feedback.value }, { text: caps[0] }, img(fb4[0])]);
      assert.deepEqual(fb.body.generationConfig, { responseMimeType: 'application/json', temperature: 0.1 });
      // בחירת מודל כמו באפליקציה: רגיל – flash קודם; טופס משוב ("pro") – pro קודם
      assert.equal(inv.model, 'gemini-2.5-flash');
      assert.equal(fb.model, 'gemini-2.5-pro');
      // המפתח שהגיע לשרת הדמה הוא מפתח הדמה מהקובץ המקומי – לא מהלקוח
      for (const r of M.state.requests) assert.equal(r.key, 'dummy-gemini-key-for-emulator');
    });

    it('מבנה התשובה: text זהה למה ש-shAIcall מחזירה היום, ו-data זהה ל-JSON.parse שהאפליקציה עושה', async () => {
      for (const [split, fenced] of [[false, false], [true, false], [false, true]]) {
        M.reset(); M.state.split = split; M.state.fenced = fenced;
        for (const kind of ['invoice', 'product', 'feedback', 'recipe']) {
          const r = await call('scanDocument', 'u_emp', { kind, files: [jpgFile()] });
          assert.equal(r.status, 'OK');
          const raw = M.rawAnswer(kind);
          // העתקה מילולית של מה ש-shAIcall עושה עם התשובה של Gemini (www/index.html, shAIcall):
          const pt = (((raw.candidates || [])[0] || {}).content || {}).parts;
          const appText = pt.map((p) => p.text || '').join('');
          assert.equal(r.result.text, appText);
          // ומה ש-ocrAI / shAI / fbAI עושים עם הטקסט:
          const appObj = JSON.parse(String(appText).replace(/```json|```/g, '').trim());
          assert.deepEqual(r.result.data, appObj);
          assert.deepEqual(r.result.data, M.ANSWERS[kind]);
          assert.deepEqual(Object.keys(r.result).sort(), ['data', 'model', 'text', 'usage']);
        }
      }
    });

    it('ההנחיות בשרת זהות תו-בתו להנחיות שבאפליקציה (ה-ZIP של הגרסה שבטלפונים)', () => {
      const P = appPrompts();
      assert.equal(SERVER_PROMPTS.invoice, P.invoice.value);
      assert.equal(SERVER_PROMPTS.product, P.product.value);
      assert.equal(SERVER_PROMPTS.feedback, P.feedback.value);
      assert.deepEqual(SERVER_PROMPTS.feedbackCaptions, P.feedbackCaptions.value);
      assert.equal(SERVER_PROMPTS.zreport, P.zreport.value);
      assert.equal(SERVER_PROMPTS.opening, P.opening.value);
      assert.equal(SERVER_PROMPTS.deposit, P.deposit.value);
      assert.equal(SERVER_PROMPTS.cashout, P.cashout.value);
      assert.equal(SERVER_PROMPTS.transfer, P.transfer.value);
      assert.equal(SERVER_PROMPTS.invlines, P.invlines.value); // תמחור חשבונית ספק: INVL_P (באמצע שורת OCAI_P)
      assert.ok(P.invlines.value.includes('"lines"') && P.invlines.value !== P.invoice.value);
    });

    it('סגירת קופה: דוח Z – בדיוק 3 צילומים בבקשה אחת, ודף פתיחה – צילום אחד; ההנחיה מהאפליקציה, temperature 0, התשובה מפוענחת', async () => {
      const P = appPrompts();
      const z3 = [jpgFile(301), jpgFile(302), jpgFile(303)], op = jpgFile(304);
      const rz = await call('scanDocument', 'u_emp', { kind: 'zreport', files: z3 });
      const ro = await call('scanDocument', 'u_mgr', { kind: 'opening', files: [op] });
      assert.equal(rz.status, 'OK', JSON.stringify(rz.json).slice(0, 200));
      assert.equal(ro.status, 'OK', JSON.stringify(ro.json).slice(0, 200));
      const [qz, qo] = M.state.requests;
      const img = (f) => ({ inline_data: { mime_type: f.mimeType, data: f.data } });
      // zcAI: parts=[{text:ZR_P}, תמונה 1 (עליון), 2 (אמצעי), 3 (תחתון)] – בסדר שהעובד צילם
      assert.deepEqual(qz.body, { contents: [{ parts: [{ text: P.zreport.value }, ...z3.map(img)] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
      assert.deepEqual(qo.body, { contents: [{ parts: [{ text: P.opening.value }, img(op)] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
      assert.equal(qz.kind, 'zreport'); assert.equal(qo.kind, 'opening');
      assert.deepEqual(rz.result.data, M.ANSWERS.zreport);
      assert.deepEqual(ro.result.data, M.ANSWERS.opening);
      // כל אחת נספרת פעם אחת במגבלה היומית (3 הצילומים של דוח Z = זיהוי אחד)
      assert.equal((await usageOf(env, 'u_emp')).count, 1);
      // ההנחיות מבקשות את כל השדות שהאפליקציה קוראת
      for (const k of ['register', 'store', 'date', 'time', 'report_no', 'credit', 'cash', 'checks', 'voucher_buy', 'voucher_credit', 'voucher_issue', 'house', 'rounding', 'total', 'open_float', 'cash_sales', 'cash_out', 'cash_in_drawer']) assert.ok(P.zreport.value.includes('"' + k + '"'), k);
      for (const k of ['register', 'store', 'date', 'time', 'total']) assert.ok(P.opening.value.includes('"' + k + '"'), k);
    });

    it('אישור הפקדה (deposit): צילום אחד בכל קריאה, ההנחיה מהאפליקציה, temperature 0, מחזיר תאריך וסכום', async () => {
      const P = appPrompts();
      const f = jpgFile(401);
      const r = await call('scanDocument', 'u_emp', { kind: 'deposit', files: [f] });
      assert.equal(r.status, 'OK', JSON.stringify(r.json).slice(0, 200));
      const [q] = M.state.requests;
      assert.deepEqual(q.body, { contents: [{ parts: [{ text: P.deposit.value }, { inline_data: { mime_type: f.mimeType, data: f.data } }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
      assert.equal(q.kind, 'deposit');
      assert.deepEqual(r.result.data, M.ANSWERS.deposit);
      assert.equal((await usageOf(env, 'u_emp')).count, 1);
      for (const k of ['date', 'amount']) assert.ok(P.deposit.value.includes('"' + k + '"'), k);
      assert.ok(P.deposit.value.includes('יתרה'), 'ההנחיה אומרת לא לקחת יתרה');
      // משתמש שאינו בצוות – נחסם לפני Gemini
      const before = M.state.requests.length;
      assert.notEqual((await call('scanDocument', 'u_out', { kind: 'deposit', files: [jpgFile(402)] })).status, 'OK');
      assert.equal(M.state.requests.length, before);
    });

    it('פתק הוצאה מקופה (cashout): צילום אחד, ההנחיה מהאפליקציה, temperature 0, מחזיר קופה, תאריך, שעה וסכום', async () => {
      const P = appPrompts();
      const f = jpgFile(403);
      const r = await call('scanDocument', 'u_emp', { kind: 'cashout', files: [f] });
      assert.equal(r.status, 'OK', JSON.stringify(r.json).slice(0, 200));
      const [q] = M.state.requests;
      assert.deepEqual(q.body, { contents: [{ parts: [{ text: P.cashout.value }, { inline_data: { mime_type: f.mimeType, data: f.data } }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
      assert.equal(q.kind, 'cashout');
      assert.deepEqual(r.result.data, M.ANSWERS.cashout);
      for (const k of ['register', 'store', 'date', 'time', 'amount']) assert.ok(P.cashout.value.includes('"' + k + '"'), k);
      assert.ok(P.cashout.value.includes('מזומן שהוצא מהקופה'), 'ההנחיה מצביעה על שורת הסכום');
      // גם המנהל; ומשתמש שאינו בצוות – נחסם לפני Gemini
      assert.equal((await call('scanDocument', 'u_mgr', { kind: 'cashout', files: [jpgFile(404)] })).status, 'OK');
      const before = M.state.requests.length;
      assert.notEqual((await call('scanDocument', 'u_out', { kind: 'cashout', files: [jpgFile(405)] })).status, 'OK');
      assert.equal(M.state.requests.length, before);
    });

    it('צילום העברה (transfer): מנהל בלבד – מנהל עובר; עובד נחסם לפני Gemini ובלי ירידה במכסה', async () => {
      const P = appPrompts();
      const f = jpgFile(406);
      const r = await call('scanDocument', 'u_mgr', { kind: 'transfer', files: [f] });
      assert.equal(r.status, 'OK', JSON.stringify(r.json).slice(0, 200));
      const [q] = M.state.requests;
      assert.deepEqual(q.body, { contents: [{ parts: [{ text: P.transfer.value }, { inline_data: { mime_type: f.mimeType, data: f.data } }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
      assert.equal(q.kind, 'transfer');
      assert.deepEqual(r.result.data, M.ANSWERS.transfer);
      assert.equal((await usageOf(env, 'u_mgr')).count, 1);
      // גם מנהל "ישן" (רק admins, בלי staff)
      assert.equal((await call('scanDocument', H.MANAGER_ONLY_ADMINS, { kind: 'transfer', files: [jpgFile(407)] })).status, 'OK');
      // עובד פעיל: permission-denied, בלי פנייה ל-Gemini ובלי ספירה במכסה
      const before = M.state.requests.length, u0 = await usageOf(env, 'u_emp');
      const e = await call('scanDocument', 'u_emp', { kind: 'transfer', files: [jpgFile(408)] });
      assert.equal(e.status, 'PERMISSION_DENIED');
      assert.equal(e.error.message, 'צילום העברה מותר למנהל בלבד.');
      assert.equal(e.error.details.reason, 'manager-only');
      assert.equal(M.state.requests.length, before);
      assert.deepEqual(await usageOf(env, 'u_emp'), u0, 'מכסת העובד לא השתנתה');
      // שאר הסוגים לא השתנו: אותו עובד עדיין יכול לזהות חשבונית
      assert.equal((await call('scanDocument', 'u_emp', { kind: 'invoice', files: [jpgFile(409)] })).status, 'OK');
    });

    it('אין פנייה החוצה: באמולטור הקוד מסרב לפנות לכתובת שאינה מקומית', async () => {
      const scan = require('../functions/lib/scan');
      const prev = process.env.FUNCTIONS_EMULATOR;
      process.env.FUNCTIONS_EMULATOR = 'true';
      try {
        await assert.rejects(scan.callGemini('https://generativelanguage.googleapis.com', 'x', {}, 1000, false), (e) => e.details && e.details.reason === 'emulator-outbound-blocked');
      } finally { if (prev === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = prev; }
      const envDemo = fs.readFileSync(path.join(H.ROOT, 'functions', '.env.demo-largpeami'), 'utf8');
      assert.match(envDemo, /^GEMINI_API_BASE=http:\/\/127\.0\.0\.1:9799$/m);
    });

    it('המונה היומי (scan_usage) סגור לגמרי ללקוחות – גם לבעליו וגם למנהל', async () => {
      await call('scanDocument', 'u_emp', { kind: 'product', files: [jpgFile()] });
      for (const role of H.ROLES) {
        const db = H.ctxFor(env, role).firestore();
        const me = H.UID[role] || 'x';
        await assertFails(db.doc('scan_usage/' + me).get());
        await assertFails(db.doc('scan_usage/u_emp').get());
        await assertFails(db.collection('scan_usage').get());
        await assertFails(db.doc('scan_usage/' + me).set({ day: '2000-01-01', count: 0 }));
        await assertFails(db.doc('scan_usage/u_emp').delete());
      }
    });
  });

  // ---------------- 3. getBackupKey ----------------
  describe('getBackupKey', () => {
    const hkdf = (uid) => Buffer.from(crypto.hkdfSync('sha256', DUMMY_MASTER, Buffer.from('large-pami/app-backup/v1'), Buffer.from('uid:' + uid), 32)).toString('base64');

    it('אותו משתמש מקבל תמיד אותו מפתח (32 בתים, נגזר ב-HKDF ממפתח-האב ומהמזהה)', async () => {
      const a = await call('getBackupKey', 'u_emp');
      const b = await call('getBackupKey', 'u_emp');
      assert.equal(a.status, 'OK');
      assert.equal(a.result.key, b.result.key);
      assert.equal(Buffer.from(a.result.key, 'base64').length, 32);
      assert.equal(a.result.key, hkdf('u_emp'));
      assert.deepEqual({ alg: a.result.alg, bits: a.result.bits, version: a.result.version }, { alg: 'AES-GCM', bits: 256, version: 'v1' });
    });

    it('שני משתמשים מקבלים מפתחות שונים', async () => {
      const keys = [];
      for (const uid of ['u_emp', 'u_emp2', 'u_mgr', H.MANAGER_ONLY_ADMINS]) keys.push((await call('getBackupKey', uid)).result.key);
      assert.equal(new Set(keys).size, 4);
    });

    it('אי אפשר לבקש מפתח של משתמש אחר', async () => {
      for (const who of ['u_emp', 'u_mgr']) {
        const r = await call('getBackupKey', who, { uid: H.OTHER });
        assert.equal(r.status, 'PERMISSION_DENIED');
        assert.equal(r.error.details.reason, 'other-user');
        assert.ok(!JSON.stringify(r.json).includes(hkdf(H.OTHER)));
      }
      // מזהה של עצמו בקלט – מותר, ומחזיר את המפתח שלו
      assert.equal((await call('getBackupKey', 'u_emp', { uid: 'u_emp' })).result.key, hkdf('u_emp'));
    });
  });

  // ---------------- 4. registerPushToken ----------------
  describe('registerPushToken', () => {
    const tok = (n) => `tok${n}_` + 'x'.repeat(30);
    it('מוסיף ל-staff/{uid}.pushTokens, בלי כפילויות, ושאר השדות לא משתנים', async () => {
      const before = await docOf(env, 'staff/u_emp');
      assert.equal((await call('registerPushToken', 'u_emp', { token: tok(1) })).status, 'OK');
      assert.equal((await call('registerPushToken', 'u_emp', { token: tok(1) })).status, 'OK');
      const after = await docOf(env, 'staff/u_emp');
      assert.deepEqual(after.pushTokens, [tok(1)]);
      const { pushTokens: _a, ...restA } = after; const { pushTokens: _b, ...restB } = before;
      assert.deepEqual(restA, restB);
      assert.deepEqual((await docOf(env, 'staff/u_emp2')).pushTokens, []);
    });
    it('מגבלה של 5 טלפונים: השישי נכנס, והישן ביותר יוצא', async () => {
      for (let i = 1; i <= 6; i++) await call('registerPushToken', 'u_mgr', { token: tok(i) });
      const r = await docOf(env, 'staff/u_mgr');
      assert.deepEqual(r.pushTokens, [tok(2), tok(3), tok(4), tok(5), tok(6)]);
    });
    it('בדיקת אורך ותווים: קצר מדי, ארוך מדי, תווים אסורים, לא מחרוזת – נדחים', async () => {
      for (const t of ['short', 'a'.repeat(4097), 'abc def ghi jkl mno pqr stu', 'x'.repeat(25) + '<script>', 12345678901234567890, null]) {
        const r = await call('registerPushToken', 'u_emp', { token: t });
        assert.equal(r.status, 'INVALID_ARGUMENT', String(t).slice(0, 30));
      }
      assert.deepEqual((await docOf(env, 'staff/u_emp')).pushTokens, []);
    });
  });

  // ---------------- 5. reportBackupStatus ----------------
  describe('reportBackupStatus', () => {
    const put = (uid, name, size) => env.withSecurityRulesDisabled((c) => new Promise((ok, no) => c.storage().ref(`app_backups/${uid}/${name}`).put(new Uint8Array(size), { contentType: 'application/octet-stream' }).then(ok, no)));
    it('כותב ל-app_backup_status/{uid} של השולח בלבד; הגודל נלקח מהקובץ ב-Storage והשעה מהשרת', async () => {
      await put('u_emp', 'b-2026.bin', 4321);
      const t0 = Date.now();
      const r = await call('reportBackupStatus', 'u_emp', { file: 'b-2026.bin', device: 'Galaxy A52\n', size: 999999999, lastBackupAt: '1999-01-01T00:00:00Z' });
      assert.equal(r.status, 'OK', JSON.stringify(r.json));
      const d = await docOf(env, 'app_backup_status/u_emp');
      assert.deepEqual(Object.keys(d).sort(), ['device', 'lastBackupAt', 'size']);
      assert.equal(d.size, 4321);            // לא 999999999 מהלקוח
      assert.equal(d.device, 'Galaxy A52');
      assert.ok(Math.abs(Date.parse(d.lastBackupAt) - t0) < 60000, d.lastBackupAt); // לא 1999 מהלקוח
      // של אחרים – לא השתנה
      for (const uid of ['u_mgr', 'u_emp2', 'u_off', 'u_out']) assert.equal((await docOf(env, 'app_backup_status/' + uid)).size, 1234);
    });
    it('אי אפשר לעדכן גיבוי של משתמש אחר, או להצביע על קובץ בתיקייה של אחר', async () => {
      const r1 = await call('reportBackupStatus', 'u_emp', { file: 'seed.bin', uid: H.OTHER });
      assert.equal(r1.status, 'PERMISSION_DENIED');
      await put(H.OTHER, 'only-other.bin', 50);
      const r2 = await call('reportBackupStatus', 'u_emp', { file: 'only-other.bin' });
      assert.equal(r2.status, 'NOT_FOUND');
      const r3 = await call('reportBackupStatus', 'u_emp', { file: `../${H.OTHER}/seed.bin` });
      assert.equal(r3.status, 'INVALID_ARGUMENT');
      assert.equal((await docOf(env, 'app_backup_status/' + H.OTHER)).size, 1234);
    });
    it('קובץ שלא הועלה – נדחה (אי אפשר לדווח "גובה" בלי גיבוי)', async () => {
      const r = await call('reportBackupStatus', 'u_emp', { file: 'never-uploaded.bin' });
      assert.equal(r.status, 'NOT_FOUND');
      assert.equal((await docOf(env, 'app_backup_status/u_emp')).size, 1234);
    });
  });

  // ---------------- 6. כיסוי ----------------
  it('כיסוי: 4 הפונקציות קיימות בשמות המדויקים, וכל אחת נבדקה מול 5 התפקידים עם התוצאה הצפויה', () => {
    const exported = Object.keys(require('../functions/index.js')).filter((n) => !['orderPick', 'orderPickOk', 'supOrdSet', 'orderAuth', 'secLearn', 'sendPromoToLine', 'expirePromosOnLine', 'publishLineItem', 'removeLineItem', 'getLineState', 'tzintukJoin', 'listLineFiles', 'previewVoice', 'getLineBoard', 'getLineAudio', 'extendLineItem', 'restoreLineItem', 'createBusiness', 'inviteBusinessAdmin', 'completeInvite', 'setBusinessStatus', 'setBusinessFeatures', 'setBusinessAdv', 'setScanQuota', 'setYemotToken', 'logBusinessEntry', 'setBusinessBrand', 'setBusinessRanks', 'setStaffPerms', 'setStaffPrc', 'addStaff', 'setStaffActive', 'setStaffName', 'setBusinessOrg', 'setStaffBranches', 'syncLegacyAdmin', 'syncLegacyStaff', 'cashoutTotal', 'publicBrand', 'sendInviteMail', 'saveProduct', 'stockIn', 'stockSet', 'wipeStock', 'restoreStock', 'wipeCusts', 'restoreCusts', 'createOrder', 'updateOrder', 'setOrderStatus', 'markOrderPaid', 'unpayOrder', 'cancelOrder', 'markOrderCalled', 'getPayLink', 'setBusinessPayLink', 'setOrderCfg', 'saveCat', 'importProducts', 'transferStock', 'getWsPrices', 'getCosts', 'ordProfit', 'saveCust', 'importCusts', 'setCustCfg', 'setCellCfg', 'saveLinePlan', 'checkLines', 'setCard', 'getCard', 'delCard', 'mergeCust', 'findCust', 'setCustPrice', 'delCustPrice', 'setPriceCfg', 'ackPriceAlert', 'delAlias', 'ordParse', 'startImport', 'runImportChunk', 'recurringTasks', 'ensureLinePlans', 'requestBizApk', 'secState', 'secConsent', 'secSetup', 'secAdminGet', 'secAdminSetCfg', 'secAdminReadChat', 'secBackupDaily', 'secChat', 'secChatLoad', 'secMirrorPut', 'secPrefs', 'secFacts', 'secSens', 'secRules', 'secCal', 'secImport', 'secNotes', 'secReports', 'secHistory', 'secRemind', 'secDaily', 'secWaHook', 'secWaWork', 'secInbox', 'secSend', 'secWaCfg', 'secAdminWa', 'secOAuthCb', 'secMailHook', 'secCalSync', 'secGoogle', 'secMail', 'secMailSend', 'secAdminMail', 'secInv', 'secDecide', 'piCreate', 'piClaim', 'piBeat', 'piRelease', 'piDraft', 'piFinish', 'piVoid', 'piImg', 'arFile', 'arOc', 'arPdf', 'arSend', 'setArCfg', 'arIssue', 'arReceipt', 'arCredit', 'arVoidRc', 'arProof', 'arProofGet', 'arDoc', 'arMonthly', 'setArOff', 'secMailWork', 's3Rounds', 's3Run', 's3Move', 's3Log', 's3View', 's3SaveMap', 's3SetBranch', 's3PutTex', 'shelfCheck', 'mapDraft', 'mapFix', 's3Fix', 's3Clean', 's3PutPano', 's3DelPano', 'arStatement', 'setRemCfg', 'arRemind', 'arImp', 'arImpVoid', 'arImpList', 'tkNudge'].includes(n)).sort(); // tkNudge (מרכז עבודה סבב 3) – בסוף הקובץ; תיקון טיוטה בכתב (mapFix) – ב-store3d-fix.test.js; סיור 360 (s3PutPano, s3DelPano) – ב-store3d-pano.test.js; ייבוא מתוכנה קודמת (arImp, arImpVoid, arImpList) – ב-ar-import.test.js; כרטסת ותזכורות (arStatement, setRemCfg, arRemind) – ב-ar-remind.test.js; חשבוניות, קבלות וזיכויים (ar*, setArOff) – ב-ar-docs.test.js; arFile – ב-ar-file.test.js; אישור הזמנה (arOc, arPdf, arSend, setArCfg) – ב-ar.test.js; // תמחור חשבונית (pi*) – ב-pricing.test.js; רשימה חופשית וכינויים (delAlias, ordParse) – ב-orders.test.js; לקוח עסקי ומחירים (findCust, setCustPrice, delCustPrice, setPriceCfg, ackPriceAlert) – ב-customers.test.js ו-orders.test.js; recurringTasks (משימות קבועות) – ב-recurring.test.js; ייבוא ברקע – ב-imports.test.js; המזכירה (sec*) – ב-secretary.test.js; פונקציות ימות נבדקות ב-60-yemot.js, ב-61-yemot-line.js וב-62-voice.js; פונקציות הניהול של ריבוי עסקים – ב-multi-business-server.test.js; cashoutTotal – ב-perms-6g.test.js; publicBrand – ב-public-brand.test.js
    assert.deepEqual(exported, [...FN].sort());
    const missing = [];
    for (const fn of FN) for (const role of H.ROLES) if (!RESULTS.find((r) => r.fn === fn && r.role === role && r.status === ROLE_EXPECT[role])) missing.push(`${fn}/${role}`);
    assert.deepEqual(missing, []);
    console.log(`# פונקציות: ${FN.join(', ')}; בדיקות תפקידים: ${RESULTS.length} (4 × 5)`);
  });
});

// ---------------- מרכז עבודה סבב 3 (15.11.2026): tkNudge – "הזכר לעובד" בהתראת טלפון ----------------
// הליבה (tasks-nudge.js: _core.nudge) נקראת ישירות מול Firestore של האמולטור, עם שליחה מדומה (אין FCM אמיתי) – כמו secretary-remind.test.js.
// השער (requireStaff + מנהל בלבד) נבדק גם דרך אמולטור הפונקציות, אם הוא רץ.
describe('tkNudge – "הזכר לעובד" (מרכז עבודה סבב 3)', () => {
  let env, NG, T, RS;
  const PUSH = [];
  let BADTOK = '';
  const send = async (tokens, msg, meta) => { PUSH.push({ tokens, msg, meta }); return tokens.map((t) => ({ token: t, ok: t !== BADTOK, code: t === BADTOK ? 'messaging/registration-token-not-registered' : undefined })); };
  const TOK = (u) => 'tok' + u + '_' + 'a'.repeat(30);
  const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
  const task = (o) => Object.assign({ owner: 'u_mgr', by: 'u_mgr', role: 'a', txt: 'סוד: לספור את הכספת', cr: Date.now() - 3600e3, due: Date.now() + 86400e3, st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '', to: ['u_emp'], toN: ['u_emp'], ow: 'u_emp', owN: 'u_emp', clt: Date.now(), np: 0, wp: 0, mi: 0 }, o);
  // כמו onCall(T.scoped(...)): requireStaff קובע את העסק, ואז הליבה
  const run = (uid, data, now) => T.runInBiz({}, async () => { const who = await RS.requireStaff({ auth: { uid }, data: Object.assign({}, data) }, { feature: 'tasks' }); return NG.nudge(who, data, { send, now }); });
  const err = async (p) => { try { await p; return 'OK'; } catch (e) { return (e.details && e.details.reason) || e.code || String(e); } };
  before(async () => {
    env = await H.getEnv(); require('../functions/index.js');
    NG = require('../functions/tasks-nudge.js')._core; T = require('../functions/lib/tenant.js'); RS = require('../functions/lib/roles.js');
  });
  beforeEach(async () => {
    await H.seed(env); PUSH.length = 0; BADTOK = '';
    const now = Date.now();
    await prep(async (d) => {
      const b = d.batch();
      b.update(d.doc('staff/u_emp'), { pushTokens: [TOK('E1'), TOK('E1b')] });
      b.update(d.doc('staff/u_emp2'), { pushTokens: [TOK('E2')] });
      b.update(d.doc('staff/u_off'), { pushTokens: [TOK('OFF')] });
      b.set(d.doc('tasks/t1'), task({ nd: now, ndN: 'u_mgr' }));
      b.set(d.doc('tasks/t2'), task({ ow: '', owN: '', to: ['u_emp', 'u_emp2', 'u_off', 'u_mgr'], toN: ['a', 'b', 'c', 'd'], nd: now }));
      b.set(d.doc('tasks/t3'), task({ st: 'done', nd: now }));
      b.set(d.doc('tasks/t4'), task({ nd: now - 20 * 60000 }));
      b.set(d.doc('tasks/t5'), task({}));
      // עסק אחר (biz-x): מנהל ומשימה משלו
      b.set(d.doc('b/biz-x'), { name: 'biz-x', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', bizId: 'biz-x', features: { tasks: true } });
      b.set(d.doc('b/biz-x/admins/bx_mgr'), { email: 'bx_mgr@example.invalid' });
      b.set(d.doc('b/biz-x/staff/bx_e1'), { name: 'bx_e1', role: 'employee', active: true, pushTokens: [TOK('BX')] });
      b.set(d.doc('users/bx_mgr'), { bizId: 'biz-x', role: 'admin', active: true, bizStatus: 'active', email: 'bx_mgr@example.invalid', createdAt: 1 });
      b.set(d.doc('b/biz-x/tasks/x1'), task({ owner: 'bx_mgr', by: 'bx_mgr', to: ['bx_e1'], toN: ['bx_e1'], ow: 'bx_e1', owN: 'bx_e1', nd: now }));
      await b.commit();
    });
  });

  it('מנהל: נשלח למטפל (ow) בלבד, טקסט כללי בלי תוכן המשימה, data {k:"tk", id}', async () => {
    const r = await run('u_mgr', { taskId: 't1' });
    assert.deepEqual(r, { ok: true, n: 1, sent: 1 });
    assert.equal(PUSH.length, 1);
    assert.deepEqual(PUSH[0].tokens.sort(), [TOK('E1'), TOK('E1b')].sort());
    assert.equal(PUSH[0].msg.body, 'תזכורת מהמנהל למשימה – פרטים באפליקציה');
    assert.equal(PUSH[0].msg.id, 't1');
    assert.ok(!JSON.stringify(PUSH[0].msg).includes('כספת'), 'אין תוכן משימה בהתראה');
    assert.equal(PUSH[0].meta.uid, 'u_emp');
  });

  it('בלי מטפל: לנמענים הפעילים בלבד (לא עובד מושבת, לא המנהל עצמו)', async () => {
    const r = await run('u_mgr', { taskId: 't2' });
    assert.equal(r.n, 2); assert.equal(r.sent, 2);
    assert.deepEqual(PUSH.map((x) => x.meta.uid).sort(), ['u_emp', 'u_emp2']);
  });

  it('הגבלה בשרת: פעם ב-30 דקות למשימה (גם עם nd חדש), ואחרי 30 דקות – שוב מותר', async () => {
    const t = Date.now();
    assert.equal((await run('u_mgr', { taskId: 't1' }, t)).sent, 1);
    assert.equal(await err(run('u_mgr', { taskId: 't1' }, t + 1000)), 'rate-limit');
    await prep((d) => d.doc('tasks/t1').update({ nd: t + 10 * 60000 }));
    assert.equal(await err(run('u_mgr', { taskId: 't1' }, t + 10 * 60000)), 'rate-limit');
    await prep((d) => d.doc('tasks/t1').update({ nd: t + 31 * 60000 }));
    assert.equal((await run('u_mgr', { taskId: 't1' }, t + 31 * 60000)).sent, 1);
    assert.equal(PUSH.length, 2);
  });

  it('נדחה: עובד, משימה שבוצעה, בלי תזכורת חדשה (nd ישן/חסר), משימה לא קיימת, מזהה לא תקין', async () => {
    assert.equal(await err(run('u_emp', { taskId: 't1' })), 'not-manager');
    assert.equal(await err(run('u_mgr', { taskId: 't3' })), 'not-open');
    assert.equal(await err(run('u_mgr', { taskId: 't4' })), 'no-nd');
    assert.equal(await err(run('u_mgr', { taskId: 't5' })), 'no-nd');
    assert.equal(await err(run('u_mgr', { taskId: 'nope' })), 'no-task');
    assert.equal(await err(run('u_mgr', { taskId: '../x' })), 'bad-task');
    assert.equal(await err(run('u_off', { taskId: 't1' })), 'staff-disabled');
    assert.equal(PUSH.length, 0);
  });

  it('ריבוי עסקים: מנהל של עסק אחר לא מגיע למשימה של לארג\' פעמי ולהפך; בתוך העסק שלו – כן', async () => {
    assert.equal(await err(run('bx_mgr', { taskId: 't1' })), 'no-task');
    assert.equal(await err(run('bx_mgr', { taskId: 't1', bizId: 'largpeami' })), 'foreign-biz');
    assert.equal(await err(run('u_mgr', { taskId: 'x1' })), 'no-task');
    const r = await run('bx_mgr', { taskId: 'x1' });
    assert.equal(r.sent, 1); assert.deepEqual(PUSH[0].tokens, [TOK('BX')]);
    assert.ok(await docOf(env, 'b/biz-x/fn_rate/tkNudge_x1'), 'ההגבלה נשמרת בתוך העסק');
    await prep((d) => d.doc('b/biz-x').update({ 'features.tasks': false }));
    await prep((d) => d.doc('b/biz-x/tasks/x1').update({ nd: Date.now() }));
    assert.notEqual(await err(run('bx_mgr', { taskId: 'x1' }, Date.now() + 40 * 60000)), 'OK', 'תוספת משימות כבויה – נחסם');
  });

  it('טלפון שלא רשום יותר יוצא מרשימת הטלפונים של העובד', async () => {
    BADTOK = TOK('E1b');
    const r = await run('u_mgr', { taskId: 't1' });
    assert.equal(r.sent, 1);
    assert.deepEqual((await docOf(env, 'staff/u_emp')).pushTokens, [TOK('E1')]);
  });

  it('דרך אמולטור הפונקציות: מנהל OK; עובד/לא מחובר נחסמים', { skip: !process.env.FUNCTIONS_EMULATOR_HOST && 'אמולטור הפונקציות לא רץ' }, async () => {
    await prep((d) => Promise.all(['u_emp', 'u_emp2'].map((u) => d.doc('staff/' + u).update({ pushTokens: [] }))));
    assert.equal((await call('tkNudge', 'u_mgr', { taskId: 't1' })).status, 'OK');
    assert.equal((await call('tkNudge', 'u_emp', { taskId: 't2' })).status, 'PERMISSION_DENIED');
    assert.equal((await call('tkNudge', null, { taskId: 't2' })).status, 'UNAUTHENTICATED');
  });
});
