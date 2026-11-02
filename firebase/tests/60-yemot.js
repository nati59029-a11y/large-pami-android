'use strict';
// בדיקות לשליחת מבצע לקו ימות (sendPromoToLine) ולהורדה האוטומטית (runExpiry), מול אמולטור הפונקציות
// ומול שרת ימות מדומה (yemot-mock.js). אין שום פנייה לימות האמיתי.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const M = require('./yemot-mock');

// ---- כתובת שרת הדמה: בדיוק מה שהפונקציות באמולטור קוראות (env.local גובר על env.demo-largpeami) ----
function envValue(name) {
  let v = null;
  for (const f of ['.env', `.env.${H.PROJECT_ID}`, '.env.local']) {
    const p = path.join(H.ROOT, 'functions', f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = new RegExp(`^${name}=(.*)$`).exec(line.trim()); if (m) v = m[1].trim(); }
  }
  return v;
}
const BASE = envValue('YEMOT_API_BASE');
const BASE_URL = new URL(BASE);
const PORT = Number(BASE_URL.port);
// סוד הדמה – נקרא מהקובץ שהאמולטור טוען (functions/.secret.local), כדי לחפש אותו בכל פלט
const SECRET = (/^YEMOT_API_KEY=(.+)$/m.exec(fs.readFileSync(path.join(H.ROOT, 'functions', '.secret.local'), 'utf8')) || [])[1];

const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (name) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${name}`;
const SEEN = []; // כל תשובה גולמית מהפונקציה – לחיפוש הסוד
async function call(uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl('sendPromoToLine'), { method: 'POST', headers, body: JSON.stringify({ data }) });
  const text = await r.text();
  SEEN.push(text);
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  const status = json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status);
  return { status, result: json && json.result, error: json && json.error, text };
}

// מצב ישן (YEMOT_EMPLOYEE_DAILY=1: עובד מצנתק פעם ביום). ברירת המחדל היום היא 0 (עובד לא מצנתק, 61-yemot-line.js),
// ולכן הבדיקות של המכסה היומית רצות על הליבה (sendPromo) בתוך תהליך הבדיקה, עם ההגדרה 1. אותו שרת דמה, אותו מסד.
const LEGACY_ENV = { YEMOT_EXT: '2', YEMOT_TZINTUK_LIST: 'mivtzaim', YEMOT_EMPLOYEE_DAILY: '1', YEMOT_MAX_DAYS: '60', YEMOT_TEXT_MAX: '400', YEMOT_TIMEOUT_MS: '15000', FUNCTIONS_EMULATOR: 'true' };
let legacyDepth = 0; let legacySaved = null;
async function callQ(uid, data) {
  if (legacyDepth++ === 0) { legacySaved = {}; for (const [k, v] of Object.entries(LEGACY_ENV)) { legacySaved[k] = process.env[k]; process.env[k] = v; } }
  try {
    const result = await require('../functions/yemot.js')._core.sendPromo({ auth: uid ? { uid } : undefined, data }, SECRET, BASE);
    const text = JSON.stringify({ result }); SEEN.push(text);
    return { status: 'OK', result, text };
  } catch (e) {
    const http = e && e.httpErrorCode; // HttpsError
    const error = http ? { status: String(e.code).toUpperCase().replace(/-/g, '_'), message: e.message, details: e.details } : { status: 'INTERNAL', message: 'שגיאה בשליחה לקו.', details: { reason: 'internal' } };
    const text = JSON.stringify({ error }); SEEN.push(text);
    return { status: error.status, error, text };
  } finally {
    if (--legacyDepth === 0) for (const [k, v] of Object.entries(legacySaved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const israelDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const HEB = /[֐-׿]/;
let seq = 0;
const rid = () => `test_req_${Date.now().toString(36)}_${++seq}`;
const promo = (extra) => Object.assign({ requestId: rid(), promoKey: 'pk_' + rid(), text: 'בדיקה: מבצע דמה, שתי חבילות ב-10 ₪', until: addDays(israelDay(), 3), withTzintuk: true }, extra || {});

async function readDoc(env, p) {
  let v = null;
  await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(p).get(); v = s.exists ? s.data() : null; });
  return v;
}
async function writeDoc(env, p, data) { await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(p).set(data); }); }
async function allYemotDocs(env) {
  const out = [];
  await env.withSecurityRulesDisabled(async (c) => {
    for (const col of ['yemot_promos', 'yemot_usage', 'yemot_state']) {
      const s = await c.firestore().collection(col).get();
      s.forEach((d) => out.push({ col, id: d.id, data: d.data() }));
    }
  });
  return out;
}

describe('ימות: שליחת מבצע לקו (sendPromoToLine) והורדה (runExpiry)', () => {
  let env;
  let runExpiry;
  before(async () => {
    if (!process.env.FUNCTIONS_EMULATOR_HOST && !process.env.FIREBASE_EMULATOR_HUB) throw new Error('הבדיקות רצות רק בתוך האמולטור (npm test)');
    assert.ok(['127.0.0.1', 'localhost'].includes(BASE_URL.hostname), 'YEMOT_API_BASE באמולטור חייב להיות שרת דמה מקומי: ' + BASE);
    assert.ok(SECRET && SECRET.startsWith('DUMMY-SECRET-'), 'חסר סוד דמה YEMOT_API_KEY ב-functions/.secret.local');
    env = await H.getEnv();
    await M.start(PORT);
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
    require('../functions/index.js'); // מאתחל את firebase-admin בתהליך הבדיקה (מול האמולטור)
    runExpiry = require('../functions/yemot.js').runExpiry;
  });
  after(async () => { await M.stop(); });
  beforeEach(async () => { await H.seed(env); M.reset(); });

  // ---------------- 0. ייצוא ----------------
  it('index.js מייצא את שתי פונקציות ימות (sendPromoToLine ו-expirePromosOnLine)', () => {
    const ex = require('../functions/index.js');
    assert.equal(typeof ex.sendPromoToLine, 'function', 'sendPromoToLine לא מיוצא מ-index.js');
    assert.equal(typeof ex.expirePromosOnLine, 'function', 'expirePromosOnLine לא מיוצא מ-index.js');
    assert.equal(typeof ex.expirePromosOnLine.run, 'function', 'expirePromosOnLine אינה פונקציה מתוזמנת');
  });

  // ---------------- 1. הרשאות ----------------
  for (const role of ['guest', 'signedIn', 'disabledEmployee']) {
    it(`${role}: נדחה, ואין אף קריאה לשרת הדמה (גם לא בבדיקת מצב)`, async () => {
      const r = await call(H.UID[role], promo());
      assert.equal(r.status, role === 'guest' ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED');
      assert.match(r.error.message, HEB);
      const s = await call(H.UID[role], { statusOnly: true });
      assert.equal(s.status, r.status);
      assert.equal(M.state.requests.length, 0);
      assert.deepEqual(await allYemotDocs(env), []);
    });
  }

  // ---------------- 2. עובד: פעם ביום עם צינתוק ----------------
  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] עובד: שליחה ראשונה עם צינתוק מצליחה – העלאה לשלוחה 2 (לא 000.tts) ואחריה צינתוק ל-mivtzaim', async () => {
    const before0 = await callQ('u_emp', { statusOnly: true });
    assert.equal(before0.status, 'OK');
    assert.deepEqual(before0.result.tzintukToday, { day: israelDay(), used: 0, limit: 1, allowed: true });
    const r = await callQ('u_emp', promo());
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.ok, true);
    assert.equal(r.result.tzintuk, 'sent');
    assert.equal(r.result.file, '001.tts');
    assert.match(r.result.message, HEB);
    assert.deepEqual(r.result.tzintukToday, { day: israelDay(), used: 1, limit: 1, allowed: false });
    const cmds = M.state.requests.map((q) => q.cmd);
    assert.deepEqual(cmds, ['GetIVR2Dir', 'UploadTextFile', 'RunTzintuk']);
    const up = M.calls('UploadTextFile')[0].body;
    assert.match(up.what, /^ivr2:2\/\d{3}\.tts$/);
    assert.notEqual(up.what, 'ivr2:2/000.tts');
    assert.equal(up.contents, 'בדיקה: מבצע דמה, שתי חבילות ב-10 שקלים'); // ₪ הוחלף ב"שקלים"
    assert.equal(M.calls('RunTzintuk')[0].body.phones, 'tzl:mivtzaim');
    assert.equal(M.state.files.get('000.tts'), 'פתיח'); // הפתיח לא נגעו בו
    const rec = await readDoc(env, 'yemot_promos/' + r.result.id);
    assert.equal(rec.status, 'live'); assert.equal(rec.tzintuk, 'sent'); assert.equal(rec.path, 'ivr2:2/001.tts'); assert.equal(rec.byRole, 'employee');
  });

  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] עובד: שליחה שנייה עם צינתוק באותו יום נדחית בעברית, בלי פנייה לימות; בלי צינתוק – עובר בלי הגבלה ובלי RunTzintuk', async () => {
    assert.equal((await callQ('u_emp', promo())).status, 'OK');
    M.reset();
    const r2 = await callQ('u_emp', promo());
    assert.equal(r2.status, 'RESOURCE_EXHAUSTED');
    assert.equal(r2.error.details.reason, 'daily-limit');
    assert.match(r2.error.message, /כבר שלחת היום/);
    assert.equal(M.state.requests.length, 0);
    const st = await callQ('u_emp', { statusOnly: true });
    assert.equal(st.result.tzintukToday.allowed, false);
    for (let i = 0; i < 3; i++) {
      const r = await callQ('u_emp', promo({ withTzintuk: false }));
      assert.equal(r.status, 'OK', r.text);
      assert.equal(r.result.tzintuk, 'skipped');
      assert.equal(r.result.withTzintuk, false);
      assert.match(r.result.message, /בלי צינתוק/);
    }
    assert.equal(M.calls('RunTzintuk').length, 0, 'בלי צינתוק – אסור RunTzintuk');
    assert.equal(M.calls('UploadTextFile').length, 3);
    assert.equal((await readDoc(env, 'yemot_usage/u_emp')).count, 1); // שליחות בלי צינתוק לא נספרות
  });

  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] עובד: למחרת (לפי שעון ישראל) אפשר שוב לשלוח עם צינתוק', async () => {
    // המונה של אתמול: day = אתמול, count = 1. השרת משווה ליום של היום בשעון ישראל.
    await writeDoc(env, 'yemot_usage/u_emp', { day: addDays(israelDay(), -1), count: 1, updatedAt: 'x' });
    const r = await callQ('u_emp', promo());
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.tzintuk, 'sent');
    assert.deepEqual(await readDoc(env, 'yemot_usage/u_emp').then((u) => [u.day, u.count]), [israelDay(), 1]);
  });

  it('גבול היום בשעון ישראל (ולא UTC): חורף UTC+2, קיץ UTC+3', () => {
    const { israelDay: d } = require('../functions/yemot.js')._test;
    assert.equal(d(new Date('2026-11-01T21:59:59Z')), '2026-11-01');
    assert.equal(d(new Date('2026-11-01T22:00:00Z')), '2026-11-02');
    assert.equal(d(new Date('2026-07-01T20:59:59Z')), '2026-07-01');
    assert.equal(d(new Date('2026-07-01T21:00:00Z')), '2026-07-02');
  });

  // ---------------- 3. מנהל ----------------
  it('מנהל: 3 שליחות עם צינתוק באותו יום מצליחות, כל אחת לקובץ אחר', async () => {
    const files = [];
    for (let i = 0; i < 3; i++) {
      const r = await call('u_mgr', promo());
      assert.equal(r.status, 'OK', r.text);
      assert.equal(r.result.tzintuk, 'sent');
      assert.equal(r.result.usage, null);
      assert.equal(r.result.tzintukToday.allowed, true);
      files.push(r.result.file);
    }
    assert.deepEqual(files, ['001.tts', '002.tts', '003.tts']);
    assert.equal(M.calls('RunTzintuk').length, 3);
    assert.equal(await readDoc(env, 'yemot_usage/u_mgr'), null);
  });

  // ---------------- 4. מקביליות ----------------
  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] שתי שליחות של אותו עובד בו-זמנית (עם צינתוק) – רק אחת עוברת', async () => {
    const rs = await Promise.all([callQ('u_emp', promo()), callQ('u_emp', promo())]);
    const st = rs.map((r) => r.status).sort();
    assert.deepEqual(st, ['OK', 'RESOURCE_EXHAUSTED'], JSON.stringify(rs.map((r) => r.text)));
    assert.equal(M.calls('UploadTextFile').length, 1);
    assert.equal(M.calls('RunTzintuk').length, 1);
    assert.equal((await readDoc(env, 'yemot_usage/u_emp')).count, 1);
  });

  it('אותה בקשה (requestId) פעמיים בו-זמנית – העלאה אחת בלבד; השנייה "בטיפול" או duplicate', async () => {
    const p = promo();
    const rs = await Promise.all([call('u_mgr', p), call('u_mgr', p)]);
    // אחת מבצעת; השנייה מקבלת "בטיפול" (אם הגיעה בזמן הנעילה) או "כבר נשלח" (אם הגיעה אחרי שהראשונה הסתיימה)
    const okFirst = rs.filter((r) => r.status === 'OK' && r.result.duplicate === false);
    assert.equal(okFirst.length, 1, JSON.stringify(rs.map((r) => r.text)));
    const other = rs.find((r) => r !== okFirst[0]);
    assert.ok((other.status === 'ABORTED' && other.error.details.reason === 'busy') || (other.status === 'OK' && other.result.duplicate === true), other.text);
    assert.equal(M.calls('UploadTextFile').length, 1);
    const again = await call('u_mgr', p);
    assert.equal(again.result.duplicate, true);
    assert.equal(M.calls('UploadTextFile').length, 1);
  });

  it('4 מנהלים/שליחות במקביל – 4 מספרי קבצים שונים, בלי דריסה', async () => {
    const rs = await Promise.all([1, 2, 3, 4].map(() => call('u_mgr', promo({ withTzintuk: false }))));
    rs.forEach((r) => assert.equal(r.status, 'OK', r.text));
    const names = rs.map((r) => r.result.file);
    assert.equal(new Set(names).size, 4, names.join(','));
    assert.equal(M.calls('UploadTextFile').length, 4);
    assert.ok(!names.includes('000.tts'));
  });

  // ---------------- 5. כשלים בימות ----------------
  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] שגיאה בהעלאה: אין צינתוק, המכסה משתחררת, הודעה בעברית, והסוד לא דולף (שרת הדמה מחזיר אותו בהודעה)', async () => {
    M.setMode('upload', 'error');
    const r = await callQ('u_emp', promo());
    assert.equal(r.status, 'UNAVAILABLE');
    assert.equal(r.error.details.reason, 'yemot-upload-failed');
    assert.match(r.error.message, /נכשלה/);
    assert.ok(!r.text.includes(SECRET), 'הסוד הופיע בתשובה');
    assert.ok(!r.text.includes('incorrect'), 'טקסט מימות הועבר לטלפון');
    assert.equal(M.calls('RunTzintuk').length, 0);
    assert.equal((await readDoc(env, 'yemot_usage/u_emp')).count, 0);
    assert.equal((await callQ('u_emp', { statusOnly: true })).result.tzintukToday.allowed, true);
    for (const mode of ['exception', 'http500']) {
      M.setMode('upload', mode);
      const x = await callQ('u_emp', promo());
      assert.equal(x.status, 'UNAVAILABLE'); assert.ok(!x.text.includes(SECRET));
    }
    M.setMode('upload', 'ok');
    const ok = await callQ('u_emp', promo());
    assert.equal(ok.status, 'OK', ok.text); // המכסה באמת שוחררה
    const docs = JSON.stringify(await allYemotDocs(env));
    assert.ok(!docs.includes(SECRET));
    assert.ok(docs.includes('"status":"failed"'));
  });

  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] שגיאה ברשימת הקבצים (GetIVR2Dir): אין העלאה ואין צינתוק, המכסה משתחררת', async () => {
    M.setMode('dir', 'error');
    const r = await callQ('u_emp', promo());
    assert.equal(r.status, 'UNAVAILABLE');
    assert.equal(M.calls('UploadTextFile').length, 0);
    assert.equal(M.calls('RunTzintuk').length, 0);
    assert.equal((await readDoc(env, 'yemot_usage/u_emp')).count, 0);
  });

  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] שגיאה בצינתוק אחרי העלאה מוצלחת: ההודעה נשארת בקו, tzintuk=failed, והמכסה של העובד לא נספרת', async () => {
    M.setMode('tzintuk', 'error');
    const r = await callQ('u_emp', promo());
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.tzintuk, 'failed');
    assert.match(r.result.message, /הצינתוק לנרשמים לא נשלח/);
    assert.ok(!r.text.includes(SECRET));
    assert.ok(M.state.files.has(r.result.file));
    assert.equal(r.result.tzintukToday.allowed, true);
    assert.equal((await readDoc(env, 'yemot_promos/' + r.result.id)).status, 'live');
  });

  // ---------------- 6. קלט ----------------
  it('קלט לא תקין נדחה, בלי אף פנייה לימות', async () => {
    const today = israelDay();
    const cases = [
      [{ text: '' }, 'empty-text'], [{ text: '   \n\t ' }, 'empty-text'], [{ text: 5 }, 'empty-text'],
      [{ text: 'א'.repeat(401) }, 'text-too-long'],
      [{ until: addDays(today, -1) }, 'date-past'], [{ until: addDays(today, 61) }, 'date-too-far'],
      [{ until: '2026-02-30' }, 'bad-date'], [{ until: '1.12.2026' }, 'bad-date'], [{ until: undefined }, 'bad-date'],
      [{ requestId: 'short' }, 'bad-request-id'], [{ requestId: '../../x/yyyyyy' }, 'bad-request-id'],
      [{ withTzintuk: 'yes' }, 'bad-input'], [{ promoKey: 'x/../y' }, 'bad-promo-key'], [{ source: { size: 'p9', index: 0 } }, 'bad-input'],
    ];
    for (const [patch, reason] of cases) {
      const r = await call('u_mgr', promo(patch));
      assert.equal(r.status, 'INVALID_ARGUMENT', JSON.stringify(patch));
      assert.equal(r.error.details.reason, reason, JSON.stringify(patch));
      assert.match(r.error.message, HEB);
    }
    const arr = await call('u_mgr', ['x']);
    assert.equal(arr.status, 'INVALID_ARGUMENT');
    assert.equal(M.state.requests.length, 0);
    // הגבולות עצמם מותרים: היום, היום+60, ו-400 תווים
    for (const p of [{ until: today }, { until: addDays(today, 60) }, { text: 'ב'.repeat(400) }]) {
      const r = await call('u_mgr', promo(Object.assign({ withTzintuk: false }, p)));
      assert.equal(r.status, 'OK', r.text);
    }
  });

  // ---------------- 7. מספור קבצים ----------------
  it('מספור: ממשיך מהמספר הגבוה בשלוחה (כל סוג קובץ); בלי 000 בשלוחה – מתחיל ב-001', async () => {
    M.reset({ '000.tts': 'פתיח', '004.wav': 'x', '010.tts': 'y', 'M0000.tts': 'z' });
    assert.equal((await call('u_mgr', promo({ withTzintuk: false }))).result.file, '011.tts');
    await H.seed(env); M.reset({});
    assert.equal((await call('u_mgr', promo({ withTzintuk: false }))).result.file, '001.tts');
    // שלוחה מלאה עד 999: בוחר את הפנוי הקטן ביותר
    await H.seed(env); M.reset({ '000.tts': 'פ', '001.tts': 'a', '002.tts': 'b', '999.tts': 'c' });
    assert.equal((await call('u_mgr', promo({ withTzintuk: false }))).result.file, '003.tts');
    assert.equal((await call('u_mgr', promo({ withTzintuk: false }))).result.file, '004.tts');
    assert.equal(M.state.files.get('000.tts'), 'פ');
  });

  // ---------------- 8. הורדה אוטומטית ----------------
  it('runExpiry: מבצע שפג תוקפו נמחק ומסומן removed; מבצע בתוקף, 000.tts ונתיב זר – לא נמחקים', async () => {
    const today = israelDay();
    const old = await call('u_mgr', promo({ until: today, withTzintuk: false }));
    const live = await call('u_mgr', promo({ until: addDays(today, 5), withTzintuk: false }));
    assert.equal(old.status, 'OK'); assert.equal(live.status, 'OK');
    // רשומות "זרות" שמצביעות על הפתיח ועל שלוחה אחרת – אסור למחוק
    await writeDoc(env, 'yemot_promos/evil_000', { status: 'live', path: 'ivr2:2/000.tts', until: addDays(today, -3) });
    await writeDoc(env, 'yemot_promos/evil_ext', { status: 'live', path: 'ivr2:3/001.tts', until: addDays(today, -3) });
    M.state.requests = [];
    const now = new Date(Date.now() + 2 * 86400000); // "בעוד יומיים": אחרי until של הישן, לפני until של החדש
    const out = await runExpiry({ now, key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(out.removed, 1, JSON.stringify(out));
    assert.equal(out.skipped, 2);
    const del = M.calls('FileAction');
    assert.equal(del.length, 1);
    assert.deepEqual(del[0].body, { action: 'delete', what: 'ivr2:2/' + old.result.file });
    assert.ok(!M.state.files.has(old.result.file));
    assert.ok(M.state.files.has(live.result.file));
    assert.ok(M.state.files.has('000.tts'));
    const rec = await readDoc(env, 'yemot_promos/' + old.result.id);
    assert.equal(rec.status, 'removed'); assert.ok(rec.removedAt);
    assert.equal((await readDoc(env, 'yemot_promos/' + live.result.id)).status, 'live');
    assert.equal((await readDoc(env, 'yemot_promos/evil_000')).status, 'live');
    // ריצה נוספת לא מוחקת שוב
    M.state.requests = [];
    const out2 = await runExpiry({ now, key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(out2.removed, 0);
    assert.equal(M.calls('FileAction').length, 0);
  });

  it('runExpiry: מחיקה שנכשלה מסומנת remove-failed ומנוסה שוב בריצה הבאה; קובץ שכבר נעלם מסומן removed', async () => {
    const today = israelDay();
    const a = await call('u_mgr', promo({ until: today, withTzintuk: false }));
    const b = await call('u_mgr', promo({ until: today, withTzintuk: false }));
    M.state.files.delete(b.result.file); // מישהו מחק ידנית
    const now = new Date(Date.now() + 2 * 86400000);
    M.setMode('delete', 'error');
    const o1 = await runExpiry({ now, key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(o1.failed, 1); assert.equal(o1.missing, 1);
    assert.equal((await readDoc(env, 'yemot_promos/' + a.result.id)).status, 'remove-failed');
    assert.equal((await readDoc(env, 'yemot_promos/' + b.result.id)).status, 'removed');
    M.setMode('delete', 'ok');
    const o2 = await runExpiry({ now, key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(o2.removed, 1);
    assert.equal((await readDoc(env, 'yemot_promos/' + a.result.id)).status, 'removed');
    assert.ok(!M.state.files.has(a.result.file));
  });

  // ---------------- 9. סוד ----------------
  it('הסוד: נשלח לימות רק בכותרת authorization; לא בכתובת, לא בגוף, לא בתשובות ולא ברשומות', async () => {
    await call('u_mgr', promo());
    M.setMode('upload', 'exception');
    await call('u_emp', promo());
    assert.ok(M.state.requests.length >= 3);
    for (const q of M.state.requests) {
      assert.equal(q.auth, SECRET);
      assert.ok(!q.url.includes(SECRET)); assert.ok(!JSON.stringify(q.body).includes(SECRET));
      assert.equal(`${BASE_URL.hostname}:${PORT}`, `127.0.0.1:${PORT}`);
    }
    assert.ok(!JSON.stringify(await allYemotDocs(env)).includes(SECRET));
    const leaked = SEEN.filter((t) => t.includes(SECRET));
    assert.deepEqual(leaked, [], 'הסוד הופיע בתשובה של הפונקציה');
  });

  // ---------------- 10. כללים ----------------
  it('כללים: האפליקציה (אורח, עובד, מנהל) לא יכולה לכתוב ולא לקרוא את אוספי ימות', async () => {
    await writeDoc(env, 'yemot_promos/p1', { status: 'live' });
    await writeDoc(env, 'yemot_usage/u_emp', { day: israelDay(), count: 0 });
    await writeDoc(env, 'yemot_state/line', { nextNum: 5 });
    for (const role of ['guest', 'employee', 'manager']) {
      const db = H.ctxFor(env, role).firestore();
      for (const p of ['yemot_promos/p1', 'yemot_promos/new1', 'yemot_usage/u_emp', 'yemot_usage/u_mgr', 'yemot_state/line']) {
        await assertFails(db.doc(p).set({ status: 'live', count: 0, nextNum: 1 }));
        await assertFails(db.doc(p).get());
      }
      await assertFails(db.doc('yemot_usage/u_emp').delete());
      await assertFails(db.collection('yemot_promos').get());
    }
  });
  // ---------------- 11. מבצע אחד = קובץ אחד (promoKey) ----------------
  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] ניסיון חוזר אחרי צינתוק שנכשל: רק צינתוק, בלי העלאה נוספת; המכסה נספרת רק כשהצינתוק הצליח', async () => {
    const key = 'pk_retry_' + rid();
    M.setMode('tzintuk', 'error');
    const r1 = await callQ('u_emp', promo({ promoKey: key }));
    assert.equal(r1.status, 'OK', r1.text);
    assert.equal(r1.result.action, 'uploaded'); assert.equal(r1.result.tzintuk, 'failed');
    assert.match(r1.result.message, /לא יועלה פעמיים/);
    assert.equal((await readDoc(env, 'yemot_usage/u_emp')).count, 0);
    M.setMode('tzintuk', 'ok');
    const r2 = await callQ('u_emp', promo({ promoKey: key }));
    assert.equal(r2.status, 'OK', r2.text);
    assert.equal(r2.result.action, 'tzintuk-only'); assert.equal(r2.result.tzintuk, 'sent');
    assert.equal(r2.result.file, r1.result.file);
    assert.equal(M.calls('UploadTextFile').length, 1, 'העלאה שנייה של אותו מבצע');
    assert.equal(M.calls('RunTzintuk').length, 2);
    assert.equal((await readDoc(env, 'yemot_usage/u_emp')).count, 1);
    assert.equal(r2.result.tzintukToday.allowed, false);
    // ניסיון שלישי, אותו נוסח: שום פנייה לימות, גם לא נחסם במכסה
    M.state.requests = [];
    const r3 = await callQ('u_emp', promo({ promoKey: key, until: addDays(israelDay(), 5) }));
    assert.equal(r3.status, 'OK', r3.text);
    assert.equal(r3.result.action, 'none');
    assert.match(r3.result.message, /תאריך ההורדה עודכן/);
    assert.equal(M.state.requests.length, 0);
    const rec = await readDoc(env, 'yemot_promos/' + key);
    assert.equal(rec.until, addDays(israelDay(), 5)); assert.equal(rec.tzintuk, 'sent'); assert.equal(rec.lockAt, null);
  });

  it('אותו מבצע עם נוסח אחר: הקובץ הקיים מוחלף באותו נתיב, ולא נוסף קובץ שני', async () => {
    const key = 'pk_replace_' + rid();
    const r1 = await call('u_mgr', promo({ promoKey: key, text: 'בדיקה: נוסח ראשון', withTzintuk: false }));
    const r2 = await call('u_mgr', promo({ promoKey: key, text: 'בדיקה: נוסח מתוקן', withTzintuk: false }));
    assert.equal(r2.status, 'OK', r2.text);
    assert.equal(r2.result.action, 'replaced');
    assert.equal(r2.result.file, r1.result.file);
    assert.deepEqual([...M.state.files.keys()].sort(), ['000.tts', r1.result.file]);
    assert.equal(M.state.files.get(r1.result.file), 'בדיקה: נוסח מתוקן');
    assert.equal((await readDoc(env, 'yemot_promos/' + key)).text, 'בדיקה: נוסח מתוקן');
    // החלפה שנכשלה: הרשומה נשארת live (הקובץ עדיין בקו), והנוסח הרשום לא משתנה
    M.setMode('upload', 'error');
    const r3 = await call('u_mgr', promo({ promoKey: key, text: 'בדיקה: נוסח שלישי', withTzintuk: false }));
    assert.equal(r3.status, 'UNAVAILABLE');
    const rec = await readDoc(env, 'yemot_promos/' + key);
    assert.equal(rec.status, 'live'); assert.equal(rec.text, 'בדיקה: נוסח מתוקן'); assert.equal(rec.lockAt, null);
  });

  it('החלפה לא דורסת קובץ שרשומה אחרת מחזיקה (מקצה מספר חדש)', async () => {
    const key = 'pk_guard_' + rid();
    const r1 = await call('u_mgr', promo({ promoKey: key, text: 'בדיקה: א', withTzintuk: false }));
    await writeDoc(env, 'yemot_promos/pk_other_xxxx', { status: 'live', path: 'ivr2:2/' + r1.result.file, file: r1.result.file, until: israelDay() });
    const r2 = await call('u_mgr', promo({ promoKey: key, text: 'בדיקה: ב', withTzintuk: false }));
    assert.equal(r2.status, 'OK', r2.text);
    assert.notEqual(r2.result.file, r1.result.file);
    assert.equal(M.state.files.get(r1.result.file), 'בדיקה: א');
  });

  it('אותו מבצע פעמיים במקביל (requestId שונה): העלאה אחת בלבד', async () => {
    const key = 'pk_par_' + rid();
    const rs = await Promise.all([call('u_mgr', promo({ promoKey: key, withTzintuk: false })), call('u_mgr', promo({ promoKey: key, withTzintuk: false }))]);
    assert.equal(M.calls('UploadTextFile').length, 1, JSON.stringify(rs.map((r) => r.text)));
    for (const r of rs) assert.ok(r.status === 'OK' || (r.status === 'ABORTED' && r.error.details.reason === 'busy'), r.text);
    assert.ok(rs.some((r) => r.status === 'OK' && r.result.action === 'uploaded'));
  });

  it('ברירת מחדל בטוחה: בלי withTzintuk = בלי צינתוק, עם אזהרה, ובלי מכסה', async () => {
    await writeDoc(env, 'yemot_usage/u_emp', { day: israelDay(), count: 1, updatedAt: 'x' }); // כבר ניצל את המכסה
    const p = promo(); delete p.withTzintuk; delete p.promoKey;
    const r = await call('u_emp', p);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.withTzintuk, false); assert.equal(r.result.tzintuk, 'skipped');
    assert.deepEqual(r.result.warnings, ['with-tzintuk-missing', 'promo-key-missing']);
    assert.equal(M.calls('RunTzintuk').length, 0);
    assert.equal(M.calls('UploadTextFile').length, 1);
    const ok = await call('u_emp', promo({ withTzintuk: false }));
    assert.deepEqual(ok.result.warnings, []);
  });
  // ---------------- 12. סבב 3: ליקויי הבודק ----------------
  it('ליקוי 1א: אותו requestId אחרי החלפת נוסח שנכשלה – לא "כבר נשלח", אלא מנסה שוב ומחליף', async () => {
    const key = 'pk_d1a_' + rid();
    await call('u_mgr', promo({ promoKey: key, text: 'בדיקה: ישן', withTzintuk: false }));
    const p = promo({ promoKey: key, text: 'בדיקה: חדש', withTzintuk: false });
    M.setMode('upload', 'error');
    assert.equal((await call('u_mgr', p)).status, 'UNAVAILABLE');
    M.setMode('upload', 'ok');
    const r = await call('u_mgr', p); // אותו requestId בדיוק – כמו באפליקציה
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.duplicate, false);
    assert.equal(r.result.action, 'replaced');
    assert.equal(M.state.files.get(r.result.file), 'בדיקה: חדש');
  });

  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] ליקוי 1ב: אותו requestId אחרי צינתוק שנכשל – שולח את הצינתוק, בלי העלאה נוספת', async () => {
    const p = promo({ promoKey: 'pk_d1b_' + rid() });
    M.setMode('tzintuk', 'error');
    const r1 = await callQ('u_emp', p);
    assert.equal(r1.result.tzintuk, 'failed');
    M.setMode('tzintuk', 'ok');
    const r2 = await callQ('u_emp', p);
    assert.equal(r2.status, 'OK', r2.text);
    assert.equal(r2.result.duplicate, false);
    assert.equal(r2.result.tzintuk, 'sent');
    assert.equal(M.calls('UploadTextFile').length, 1);
    assert.equal(M.calls('RunTzintuk').length, 2);
    assert.equal((await readDoc(env, 'yemot_usage/u_emp')).count, 1);
    const r3 = await callQ('u_emp', p); // עכשיו באמת הצליח – כפילות אמיתית
    assert.equal(r3.result.duplicate, true);
    assert.equal(M.calls('RunTzintuk').length, 2);
  });

  it('ליקוי 1ג: אותו requestId בזמן שהשליחה בטיפול – "בטיפול" (ABORTED/busy), לא "נשלח"', async () => {
    const key = 'pk_d1c_' + rid();
    const p = promo({ promoKey: key, withTzintuk: false });
    await writeDoc(env, 'yemot_promos/' + key, { status: 'uploading', path: null, file: null, text: null, until: p.until, lockAt: new Date().toISOString(), lockReq: p.requestId, lastRequestId: p.requestId });
    const r = await call('u_mgr', p);
    assert.equal(r.status, 'ABORTED', r.text);
    assert.equal(r.error.details.reason, 'busy');
    assert.equal(M.state.requests.length, 0);
  });

  it('ליקוי 2: החלפה שנכשלה לא מאריכה את הנוסח הישן; כשל לא ודאי – ההורדה לפי התאריך המוקדם', async () => {
    const key = 'pk_d2_' + rid();
    const today = israelDay();
    await call('u_mgr', promo({ promoKey: key, text: 'בדיקה: ישן', until: today, withTzintuk: false }));
    M.setMode('upload', 'error');
    assert.equal((await call('u_mgr', promo({ promoKey: key, text: 'בדיקה: חדש', until: addDays(today, 20), withTzintuk: false }))).status, 'UNAVAILABLE');
    const rec = await readDoc(env, 'yemot_promos/' + key);
    assert.equal(rec.text, 'בדיקה: ישן');
    assert.equal(rec.until, today, 'הנוסח הישן קיבל את תאריך ההורדה החדש');
    M.setMode('upload', 'ok');
    const out = await runExpiry({ now: new Date(Date.now() + 2 * 86400000), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(out.removed, 1, JSON.stringify(out));
    assert.equal((await readDoc(env, 'yemot_promos/' + key)).status, 'removed');
  });

  it('ליקוי 3א: רשומה שנתקעה ב-uploading (נעילה ישנה) – ההורדה מוחקת את הקובץ שבקו', async () => {
    const today = israelDay();
    M.state.files.set('005.tts', 'יתום');
    await writeDoc(env, 'yemot_promos/pk_stuck_aaaa', { status: 'uploading', path: 'ivr2:2/005.tts', file: '005.tts', text: null, until: today, lockAt: new Date(Date.now() - 10 * 60000).toISOString() });
    const out = await runExpiry({ now: new Date(Date.now() + 2 * 86400000), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(out.removed, 1, JSON.stringify(out));
    assert.ok(!M.state.files.has('005.tts'));
    assert.equal((await readDoc(env, 'yemot_promos/pk_stuck_aaaa')).status, 'removed');
  });

  it('ליקוי 3ב: שליחה חוזרת של רשומה תקועה משתמשת באותו נתיב – בלי קובץ יתום', async () => {
    M.state.files.set('005.tts', 'יתום');
    await writeDoc(env, 'yemot_promos/pk_stuck_bbbb', { status: 'uploading', path: 'ivr2:2/005.tts', file: '005.tts', text: null, until: israelDay(), lockAt: new Date(Date.now() - 10 * 60000).toISOString() });
    const r = await call('u_mgr', promo({ promoKey: 'pk_stuck_bbbb', withTzintuk: false }));
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.file, '005.tts');
    assert.deepEqual([...M.state.files.keys()].sort(), ['000.tts', '005.tts']);
  });

  it('[מצב ישן, YEMOT_EMPLOYEE_DAILY=1] ליקוי 3ג: חריגה פנימית אחרי ההעלאה – המכסה מוחזרת, הנעילה משתחררת, והקובץ נשאר בר-הורדה', async () => {
    const key = 'pk_d3c_' + rid();
    await writeDoc(env, 'yemot_test/fault', { at: 'after-upload' }); // הזרקת תקלה – פעילה רק באמולטור
    const r = await callQ('u_emp', promo({ promoKey: key, until: israelDay() }));
    await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc('yemot_test/fault').delete(); });
    assert.equal(r.status, 'INTERNAL', r.text);
    assert.equal(M.calls('UploadTextFile').length, 1);
    assert.equal((await readDoc(env, 'yemot_usage/u_emp')).count, 0, 'המכסה נספרה בלי צינתוק');
    const rec = await readDoc(env, 'yemot_promos/' + key);
    assert.equal(rec.lockAt, null);
    const file = rec.path.split('/')[1];
    assert.ok(M.state.files.has(file));
    const out = await runExpiry({ now: new Date(Date.now() + 2 * 86400000), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(out.removed, 1, JSON.stringify(out));
    assert.ok(!M.state.files.has(file));
  });

  it('הורדה לא מוחקת קובץ שרשומה פעילה אחרת מחזיקה (אותו נתיב)', async () => {
    const today = israelDay();
    M.state.files.set('007.tts', 'מבצע חדש');
    await writeDoc(env, 'yemot_promos/pk_old_cccc', { status: 'failed', uncertain: true, path: 'ivr2:2/007.tts', until: addDays(today, -2) });
    await writeDoc(env, 'yemot_promos/pk_new_cccc', { status: 'live', path: 'ivr2:2/007.tts', until: addDays(today, 10) });
    const out = await runExpiry({ now: new Date(), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(M.calls('FileAction').length, 0, JSON.stringify(out));
    assert.ok(M.state.files.has('007.tts'));
  });
});
