'use strict';
// בדיקות שלב 2 (משימה 2026-11-02): תוכן שלוחות הקו (publishLineItem, removeLineItem, getLineState),
// שכבת הקול (lib/voice.js), מילון ההגייה (lib/lexicon.js), ההרחבה של sendPromoToLine (עובד בלי צינתוק, מבצע ידני),
// ושלוחה 5 – הצטרפות ישירה (tzintukJoin). מול אמולטור הפונקציות ושרת ימות מדומה (yemot-mock.js). אין פנייה לימות האמיתי.
// חלק מהבדיקות קוראות לליבה בתוך תהליך הבדיקה (_core): החלפת הסיומת ב-voice.js, פסק זמן קצר, ויומנים.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const M = require('./yemot-mock');

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
const PORT = Number(new URL(BASE).port);
const SECRETS = fs.readFileSync(path.join(H.ROOT, 'functions', '.secret.local'), 'utf8');
const SECRET = (/^YEMOT_API_KEY=(.+)$/m.exec(SECRETS) || [])[1];
const HOOK = (/^YEMOT_HOOK_SECRET=(.+)$/m.exec(SECRETS) || [])[1];

const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (name) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${name}`;
const SEEN = [];
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text();
  SEEN.push(text);
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  const status = json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status);
  return { status, result: json && json.result, error: json && json.error, text };
}

// ---- ליבה בתוך התהליך, עם הגדרות קבועות ויומן שנאסף (לחיפוש הסוד) ----
const LOGS = [];
const CORE_ENV = { YEMOT_EXT: '2', YEMOT_TZINTUK_LIST: 'mivtzaim', YEMOT_EMPLOYEE_DAILY: '1', YEMOT_MAX_DAYS: '60', YEMOT_TEXT_MAX: '400',
  YEMOT_TIMEOUT_MS: '15000', YEMOT_RECIPE_MAX: '2500', YEMOT_REC_MAX_SEC: '120', FUNCTIONS_EMULATOR: 'true',
  VOICE_ENGINE: 'yemot-tts', LEXICON_SEED: 'off', VOICE_CACHE_BUCKET: H.PROJECT_ID }; // bucket: שמע שמור (line_audio/, משימה 2026-11-04) // שלב 9: בבדיקות האלה – הקול הממוחשב, כמו קודם (הקול המשוכפל: 62-voice.js)
async function core(mod, fn, uid, data, envPatch) {
  const env = Object.assign({}, CORE_ENV, envPatch || {});
  const saved = {}; for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const ow = process.stdout.write, ew = process.stderr.write;
  process.stdout.write = function (c, ...a) { LOGS.push(String(c)); return ow.call(this, c, ...a); };
  process.stderr.write = function (c, ...a) { LOGS.push(String(c)); return ew.call(this, c, ...a); };
  try {
    const result = await require(mod)._core[fn]({ auth: uid ? { uid } : undefined, data }, SECRET, BASE);
    const text = JSON.stringify({ result }); SEEN.push(text);
    return { status: 'OK', result, text };
  } catch (e) {
    const error = e && e.httpErrorCode ? { status: String(e.code).toUpperCase().replace(/-/g, '_'), message: e.message, details: e.details } : { status: 'INTERNAL', message: 'שגיאה', details: { reason: 'internal' } };
    const text = JSON.stringify({ error }); SEEN.push(text);
    return { status: error.status, error, text };
  } finally {
    process.stdout.write = ow; process.stderr.write = ew;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const LINE = '../functions/yemot-line.js';
const PROMO = '../functions/yemot.js';

const israelDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const HEB = /[֐-׿]/;
let seq = 0;
const rid = () => `t61_${Date.now().toString(36)}_${++seq}`;
const promo = (extra) => Object.assign({ requestId: rid(), promoKey: 'pk_' + rid(), text: 'בדיקה: מבצע דמה ב-10 ₪', until: addDays(israelDay(), 3), withTzintuk: false }, extra || {});
const item = (slot, extra) => Object.assign({ requestId: rid(), slot, text: 'בדיקה: טקסט ל' + slot, source: 'typed' }, extra || {});
const dir = (d) => M.state.dirs[d];
const names = (d) => [...dir(d).keys()].sort();

function wav(sec, o) {
  const { rate = 8000, ch = 1, bits = 16, riff = 'RIFF', fmt = 1 } = o || {};
  const data = Math.round(sec * rate) * ch * (bits / 8);
  const b = Buffer.alloc(44 + data);
  b.write(riff, 0, 'latin1'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'latin1'); b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(fmt, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * ch * bits / 8, 28); b.writeUInt16LE(ch * bits / 8, 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(data, 40);
  for (let i = 44; i < b.length; i++) b[i] = i % 7;
  return b;
}
const audio = (buf) => ({ mimeType: 'audio/wav', data: buf.toString('base64') });

async function readDoc(env, p) { let v = null; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function writeDoc(env, p, data) { await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(p).set(data); }); }
async function allDocs(env, cols) {
  const out = [];
  await env.withSecurityRulesDisabled(async (c) => { for (const col of cols) (await c.firestore().collection(col).get()).forEach((d) => out.push({ col, id: d.id, data: d.data() })); });
  return out;
}
// firebase-admin מותקן בתיקיית הפונקציות (אותו מופע שהקוד משתמש בו) – לשמע השמור line_audio/ (משימה 2026-11-04)
const bucket = () => require(require.resolve('firebase-admin/storage', { paths: [path.join(H.ROOT, 'functions')] })).getStorage().bucket(H.PROJECT_ID);
async function stored(p) { const f = bucket().file(p); const [ok] = await f.exists(); if (!ok) return null; return (await f.download())[0]; }
const YCOLS = ['yemot_items', 'yemot_promos', 'yemot_state', 'yemot_usage', 'yemot_hook_usage', 'yemot_lexicon'];

describe('ימות שלב 2: תוכן שלוחות, שכבת קול, מילון, עובד בלי צינתוק, שלוחה 5', () => {
  let env;
  before(async () => {
    if (!process.env.FUNCTIONS_EMULATOR_HOST && !process.env.FIREBASE_EMULATOR_HUB) throw new Error('הבדיקות רצות רק בתוך האמולטור (npm test)');
    assert.ok(SECRET && SECRET.startsWith('DUMMY-SECRET-'), 'חסר סוד דמה YEMOT_API_KEY');
    assert.ok(HOOK && HOOK.startsWith('DUMMY-HOOK-'), 'חסר סוד דמה YEMOT_HOOK_SECRET');
    env = await H.getEnv();
    await M.start(PORT);
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
    require('../functions/index.js');
  });
  after(async () => { await M.stop(); });
  beforeEach(async () => { await H.seed(env); M.reset(); });

  // ---------------- 0. ייצוא ----------------
  it('index.js מייצא את הפונקציות החדשות (publishLineItem, removeLineItem, getLineState), ולא את uploadPreview (פ1=טלפון) ולא את tzintukJoin (מושבת)', () => {
    const ex = require('../functions/index.js');
    for (const n of ['publishLineItem', 'removeLineItem', 'getLineState', 'listLineFiles', 'sendPromoToLine', 'expirePromosOnLine', 'getLineBoard', 'getLineAudio', 'extendLineItem', 'restoreLineItem']) assert.equal(typeof ex[n], 'function', n + ' לא מיוצא');
    assert.equal(ex.uploadPreview, undefined);
    assert.equal(ex.tzintukJoin, undefined, 'tzintukJoin מושבת (אין פעולת הוספה מתועדת) ואסור שיפורסם');
    assert.equal(ex._core, undefined); assert.equal(ex.shared, undefined);
    assert.equal(Object.keys(ex).length, 75, Object.keys(ex).join(',')); // +7 המזכירה שלב 1 (secretary.js – secretary.test.js) +1 mergeCust (2026-11-10) // +3 ניוד קווים (setCellCfg, saveLinePlan, checkLines – lines.test.js); +3 כרטיס (fb/ord-card: setCard, getCard, delCard); +3 לקוחות (customers.js: saveCust, importCusts, setCustCfg); +4 קטלוג (saveCat, importProducts, transferStock, getWsPrices, getCosts – orders-catalog.test.js); +13 הזמנות שלב 1 (orders.js, orders.test.js); +1 sendInviteMail (מייל עצמי); +1 publicBrand (דף פתיחה); +2 סניפים (setBusinessOrg, setStaffBranches); 15 = כולל previewVoice (שלב 9, 62-voice.js) ו-4 הפונקציות של שלב 5 (משימה 2026-11-04); +12 של ריבוי עסקים (משימה 2026-11-05, business.js: 10 פונקציות ניהול ו-2 סנכרון; completeInvite הוסרה בשלב 6ג; setBusinessBrand נוספה בעדכון חוזה 14; setBusinessRanks ו-setStaffPerms – עדכון חוזה 15) + setScanQuota (סריקה אחידה)
    assert.equal(ex.runLineExpiry, undefined); assert.equal(ex.cleanLineAudio, undefined);
  });

  // ---------------- 1. תפקידים ----------------
  for (const role of ['guest', 'signedIn', 'disabledEmployee']) {
    it(`${role}: כל שלוש הפונקציות נדחות, בלי פנייה לימות`, async () => {
      for (const [fn, data] of [['publishLineItem', item('recipes')], ['removeLineItem', { requestId: rid(), id: 'x'.repeat(10) }], ['getLineState', {}]]) {
        const r = await call(fn, H.UID[role], data);
        assert.equal(r.status, role === 'guest' ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED', fn);
        assert.match(r.error.message, HEB);
      }
      assert.equal(M.state.requests.length, 0);
    });
  }

  // ---------------- 2. עובד ← אף פעם לא צינתוק (קריטריון 1) ----------------
  it('עובד ששולח עם בקשת צינתוק מהמסך החדש (origin=builder): נדחה (tzintuk-manager-only) בעברית, ושרת הדמה לא קיבל אף קריאה – גם לא צינתוק', async () => {
    const r = await call('sendPromoToLine', 'u_emp', promo({ withTzintuk: true, origin: 'builder' }));
    assert.equal(r.status, 'PERMISSION_DENIED', r.text);
    assert.equal(r.error.details.reason, 'tzintuk-manager-only');
    assert.match(r.error.message, /רק מנהל יכול לשלוח צינתוק/);
    assert.equal(M.calls('RunTzintuk').length, 0);
    assert.equal(M.state.requests.length, 0);
    assert.deepEqual(await allDocs(env, ['yemot_promos', 'yemot_usage']), [], 'נוצרה רשומה או נתפסה מכסה');
    // אותו עובד מהמסך החדש בלי צינתוק – עולה לקו, בלי RunTzintuk
    const ok = await call('sendPromoToLine', 'u_emp', promo({ origin: 'builder' }));
    assert.equal(ok.status, 'OK', ok.text);
    assert.equal(ok.result.tzintuk, 'skipped');
    assert.deepEqual(M.state.requests.map((q) => q.cmd), ['GetIVR2Dir', 'UploadTextFile']);
    // מנהל מהמסך החדש עם צינתוק – כן
    const m = await call('sendPromoToLine', 'u_mgr', promo({ withTzintuk: true, origin: 'builder' }));
    assert.equal(m.result.tzintuk, 'sent');
    assert.equal(M.calls('RunTzintuk').length, 1);
    // ערך origin לא מוכר – נדחה
    assert.equal((await call('sendPromoToLine', 'u_mgr', promo({ origin: 'old' }))).error.details.reason, 'bad-input');
  });

  it('פ5=לא: מסך המבצעים הקיים (בלי origin) – בלי שינוי: עובד מצנתק פעם ביום', async () => {
    const st = await call('sendPromoToLine', 'u_emp', { statusOnly: true });
    assert.deepEqual(st.result.tzintukToday, { day: israelDay(), used: 0, limit: 1, allowed: true });
    const r = await call('sendPromoToLine', 'u_emp', promo({ withTzintuk: true }));
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.tzintuk, 'sent');
    const r2 = await call('sendPromoToLine', 'u_emp', promo({ withTzintuk: true }));
    assert.equal(r2.error.details.reason, 'daily-limit');
    assert.equal(M.calls('RunTzintuk').length, 1);
  });

  it('מבצע ידני: מנהל בלבד, בלי source, promoKey שמתחיל ב-man_', async () => {
    const e = await call('sendPromoToLine', 'u_emp', promo({ manual: true, promoKey: 'man_' + rid() }));
    assert.equal(e.status, 'PERMISSION_DENIED'); assert.equal(e.error.details.reason, 'manual-manager-only'); assert.match(e.error.message, HEB);
    const s = await call('sendPromoToLine', 'u_mgr', promo({ manual: true, promoKey: 'man_' + rid(), source: { size: 'p8', index: 1 } }));
    assert.equal(s.error.details.reason, 'bad-input');
    const k = await call('sendPromoToLine', 'u_mgr', promo({ manual: true, promoKey: 'pk_' + rid() }));
    assert.equal(k.error.details.reason, 'bad-promo-key');
    const t = await call('sendPromoToLine', 'u_mgr', promo({ manual: 'yes' }));
    assert.equal(t.error.details.reason, 'bad-input');
    assert.equal(M.state.requests.length, 0);
    const key = 'man_' + rid();
    const ok = await call('sendPromoToLine', 'u_mgr', promo({ manual: true, promoKey: key }));
    assert.equal(ok.status, 'OK', ok.text);
    assert.equal((await readDoc(env, 'yemot_promos/' + key)).manual, true);
  });

  // ---------------- 3. עובד ← לא שלוחה 4, לא פתיחה, לא מילון, לא הסרה (קריטריון 2) ----------------
  it('עובד שמנסה לכתוב לשלוחה 4, לפתיחה, למילון או להסיר: נדחה בעברית, בלי פנייה לימות', async () => {
    for (const slot of ['hours', 'opening']) {
      const r = await call('publishLineItem', 'u_emp', item(slot));
      assert.equal(r.status, 'PERMISSION_DENIED', slot);
      assert.equal(r.error.details.reason, 'slot-manager-only');
      assert.match(r.error.message, /רק מנהל יכול לשנות את/);
    }
    const rm = await call('removeLineItem', 'u_emp', { requestId: rid(), id: 'abcdefgh12' });
    assert.equal(rm.error.details.reason, 'manager-only'); assert.match(rm.error.message, /למנהל בלבד/);
    // מילון: כתיבה ישירה למסד – הכללים חוסמים עובד (ההודעה בעברית מוצגת באפליקציה, שלב 5)
    const db = H.ctxFor(env, 'employee').firestore();
    await assertFails(db.doc('yemot_lexicon/main').set({ text: 'א=ב', updatedAt: Date.now(), updatedBy: 'u_emp' }));
    await assertFails(db.doc('yemot_lexicon/main').get());
    assert.equal(M.state.requests.length, 0);
    assert.deepEqual(await allDocs(env, ['yemot_items']), []);
  });

  // ---------------- 4. מתכון חדש = מספר גבוה מהכול, בלי דריסה (קריטריון 3) ----------------
  it('מתכון חדש מקבל מספר גבוה מכל הקבצים בשלוחה 1, ואף קובץ קיים לא נדרס', async () => {
    M.reset(null, { '1': { '000.tts': 'ותיק', '003.tts': 'ג', '010.wav': 'הקלטה', 'M0000.tts': 'פתיח', 'ext.ini': 'type=playfile' } });
    const before0 = new Map(dir('1'));
    const r1 = await call('publishLineItem', 'u_emp', item('recipes', { text: 'עוגה\nשתי כוסות קמח' }));
    assert.equal(r1.status, 'OK', r1.text);
    assert.equal(r1.result.file, '011.tts'); assert.equal(r1.result.path, 'ivr2:1/011.tts');
    assert.match(r1.result.message, /ויושמע ראשון/);
    const r2 = await call('publishLineItem', 'u_mgr', item('recipes'));
    assert.equal(r2.result.file, '012.tts');
    for (const [k, v] of before0) assert.equal(dir('1').get(k), v, 'נדרס: ' + k);
    assert.equal(M.calls('FileAction').length, 0);
    // אין מילוי חורים: גם אם 012 נמחק ידנית, הבא הוא 013
    dir('1').delete('012.tts');
    assert.equal((await call('publishLineItem', 'u_mgr', item('recipes'))).result.file, '013.tts');
    const rec = await readDoc(env, 'yemot_items/' + r1.result.id);
    assert.equal(rec.status, 'live'); assert.equal(rec.title, 'עוגה'); assert.equal(rec.byRole, 'employee'); assert.equal(rec.ext, '1');
  });

  it('4 מתכונים במקביל – 4 מספרים שונים, כולם מעל הקיימים, בלי דריסה', async () => {
    M.reset(null, { '1': { '000.tts': 'ותיק', '005.tts': 'ה' } });
    const rs = await Promise.all([1, 2, 3, 4].map(() => call('publishLineItem', 'u_emp', item('recipes'))));
    rs.forEach((r) => assert.equal(r.status, 'OK', r.text));
    const files = rs.map((r) => r.result.file);
    assert.equal(new Set(files).size, 4, files.join(','));
    files.forEach((f) => assert.ok(Number(f.slice(0, 3)) > 5, f));
    assert.equal(dir('1').get('005.tts'), 'ה'); assert.equal(dir('1').get('000.tts'), 'ותיק');
  });

  it('שלוחה מלאה (999): line-full, בלי העלאה ובלי מילוי חור', async () => {
    M.reset(null, { '1': { '001.tts': 'א', '999.tts': 'ת' } });
    const r = await call('publishLineItem', 'u_mgr', item('recipes'));
    assert.equal(r.status, 'RESOURCE_EXHAUSTED'); assert.equal(r.error.details.reason, 'line-full'); assert.match(r.error.message, HEB);
    assert.equal(M.calls('UploadTextFile').length, 0);
  });

  // ---------------- 5. voice.js ומילון (קריטריון 4) ----------------
  it('שינוי הסיומת ב-voice.js משנה את כל ההעלאות: מבצע, מתכון, עדכון, שעות ופתיחה', async () => {
    const voice = require('../functions/lib/voice');
    voice._test.setTextExt('xyz');
    try {
      const p = await core(PROMO, 'sendPromo', 'u_mgr', promo());
      assert.equal(p.status, 'OK', p.text); assert.equal(p.result.file, '001.xyz');
      const out = {};
      for (const slot of ['recipes', 'updates', 'hours', 'opening']) {
        const r = await core(LINE, 'publishItem', 'u_mgr', item(slot));
        assert.equal(r.status, 'OK', r.text); out[slot] = r.result.path;
      }
      assert.deepEqual(out, { recipes: 'ivr2:1/001.xyz', updates: 'ivr2:3/001.xyz', hours: 'ivr2:4/001.xyz', opening: 'ivr2:/M1000.xyz' });
      for (const q of M.calls('UploadTextFile')) assert.match(q.body.what, /\.xyz$/);
      assert.equal(M.calls('UploadTextFile').length, 5);
    } finally { voice._test.setTextExt('tts'); }
    // ובחזרה: אותה פעולה – tts
    assert.equal((await core(LINE, 'publishItem', 'u_mgr', item('recipes'))).result.file, '002.tts');
  });

  it('אף קובץ קוד חוץ מ-voice.js ו-yemot-client.js לא מכיר את סיומת הקובץ או את פקודות ההעלאה', () => {
    const root = path.join(H.ROOT, 'functions');
    const files = fs.readdirSync(root).filter((f) => f.endsWith('.js')).concat(fs.readdirSync(path.join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => 'lib/' + f));
    const offenders = files.filter((f) => !['lib/voice.js', 'lib/yemot-client.js'].includes(f))
      .filter((f) => /\.tts\b|'tts'|UploadTextFile|UploadFile/.test(fs.readFileSync(path.join(root, f), 'utf8')));
    assert.deepEqual(offenders, []);
    assert.ok(files.length >= 10);
  });

  it('המילון מוחל לפני ההעלאה: בקו ההגייה, ברשומה הטקסט המקורי; שינוי במילון מעלה מבצע מחדש', async () => {
    await writeDoc(env, 'yemot_lexicon/main', { text: "לארג'=לארדז'", updatedAt: Date.now(), updatedBy: 'u_mgr' });
    const r = await call('publishLineItem', 'u_emp', item('recipes', { text: "מתכון של לארג' פעמי" }));
    assert.equal(r.status, 'OK', r.text);
    assert.equal(dir('1').get(r.result.file), "מתכון של לארדז' פעמי");
    assert.equal(r.result.spoken, "מתכון של לארדז' פעמי");
    const rec = await readDoc(env, 'yemot_items/' + r.result.id);
    assert.equal(rec.text, "מתכון של לארג' פעמי"); assert.equal(rec.spoken, "מתכון של לארדז' פעמי");
    // מבצעים: גם דרך המילון. אותו נוסח + מילון אחר = העלאה מחדש לאותו קובץ
    const key = 'pk_lex_' + rid();
    const p1 = await call('sendPromoToLine', 'u_mgr', promo({ promoKey: key, text: "מבצע בלארג'" }));
    assert.equal(M.state.files.get(p1.result.file), "מבצע בלארדז'");
    assert.equal((await readDoc(env, 'yemot_promos/' + key)).text, "מבצע בלארג'");
    await writeDoc(env, 'yemot_lexicon/main', { text: "לארג'=לַארְג'", updatedAt: Date.now(), updatedBy: 'u_mgr' });
    const p2 = await call('sendPromoToLine', 'u_mgr', promo({ promoKey: key, text: "מבצע בלארג'" }));
    assert.equal(p2.result.action, 'replaced'); assert.equal(p2.result.file, p1.result.file);
    assert.equal(M.state.files.get(p1.result.file), "מבצע בלַארְג'");
  });

  it('מילון: כל הדוגמאות ב-lexicon-cases.json (משותפות לשרת ולאפליקציה), ומגבלות הניתוח', () => {
    const L = require('../functions/lib/lexicon');
    const { cases } = require('./lexicon-cases.json');
    assert.ok(cases.length >= 10);
    for (const c of cases) assert.equal(L.applyLexicon(c.input, L.parseLexicon(c.lexicon).entries), c.output, c.name);
    const p = L.parseLexicon('א=ב\nבלי\n' + 'ג'.repeat(41) + '=ד\n=ריק');
    assert.deepEqual(p.bad, [2, 3, 4]); assert.equal(p.entries.length, 1);
    const many = Array.from({ length: 305 }, (_, i) => `מ${i}=נ`).join('\n');
    assert.equal(L.parseLexicon(many).entries.length, 300);
  });

  // ---------------- 6. טבלת המצבים: העלאה ----------------
  it('העלאה – כשל ודאי: failed, אין קובץ, UNAVAILABLE בעברית, הסוד לא דולף (שרת הדמה מחזיר אותו)', async () => {
    for (const mode of ['error', 'exception', 'http500']) {
      M.reset(); M.setMode('upload', mode);
      const r = await call('publishLineItem', 'u_emp', item('recipes'));
      assert.equal(r.status, 'UNAVAILABLE', mode); assert.equal(r.error.details.reason, 'yemot-upload-failed');
      assert.match(r.error.message, /נכשלה/);
      assert.ok(!r.text.includes(SECRET)); assert.ok(!r.text.includes('incorrect'));
      assert.deepEqual(names('1'), ['000.tts']);
    }
    M.reset(); M.setMode('dir', 'error');
    const d = await call('publishLineItem', 'u_emp', item('recipes'));
    assert.equal(d.error.details.reason, 'yemot-upload-failed'); assert.equal(M.calls('UploadTextFile').length, 0);
    const docs = await allDocs(env, ['yemot_items']);
    assert.ok(docs.every((x) => x.data.status === 'failed' && x.data.lockAt === null), JSON.stringify(docs));
    assert.ok(!JSON.stringify(docs).includes(SECRET));
  });

  it('העלאה – ניסיון חוזר עם אותו requestId: אחרי כשל – לאותו נתיב; אחרי הצלחה – duplicate בלי העלאה', async () => {
    const it1 = item('recipes');
    M.setMode('upload', 'error');
    assert.equal((await call('publishLineItem', 'u_emp', it1)).status, 'UNAVAILABLE');
    const failed = await readDoc(env, 'yemot_items/' + it1.requestId);
    M.setMode('upload', 'ok');
    const r = await call('publishLineItem', 'u_emp', it1);
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.path, failed.path);
    assert.equal(M.calls('GetIVR2Dir').length, 1, 'הוקצה מספר חדש בניסיון החוזר');
    const again = await call('publishLineItem', 'u_emp', it1);
    assert.equal(again.result.duplicate, true);
    assert.equal(M.calls('UploadTextFile').length, 2);
    // requestId של משתמש אחר / שלוחה אחרת – נדחה
    const other = await call('publishLineItem', 'u_emp2', it1);
    assert.equal(other.error.details.reason, 'bad-request-id');
    const slot2 = await call('publishLineItem', 'u_emp', Object.assign({}, it1, { slot: 'updates' }));
    assert.equal(slot2.error.details.reason, 'bad-request-id');
  });

  it('העלאה – פסק זמן (לא ודאי): yemot-uncertain, failed+uncertain; ניסיון חוזר – אותו נתיב, קובץ אחד', async () => {
    const it1 = item('recipes');
    M.setMode('upload', 'hang');
    const r = await core(LINE, 'publishItem', 'u_emp', it1, { YEMOT_TIMEOUT_MS: '700' });
    assert.equal(r.status, 'UNAVAILABLE', r.text); assert.equal(r.error.details.reason, 'yemot-uncertain');
    assert.match(r.error.message, /לא בטוח/);
    const rec = await readDoc(env, 'yemot_items/' + it1.requestId);
    assert.equal(rec.status, 'failed'); assert.equal(rec.uncertain, true); assert.equal(rec.lockAt, null);
    M.setMode('upload', 'ok');
    const r2 = await core(LINE, 'publishItem', 'u_emp', it1);
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.path, rec.path);
    assert.deepEqual(names('1'), ['000.tts', rec.file]);
  });

  it('העלאה – נעילה: פריט בטיפול ← busy; החלפת פתיחה אחרת בטיפול ← busy; בלי פנייה לימות', async () => {
    const it1 = item('recipes');
    await writeDoc(env, 'yemot_items/' + it1.requestId, { slot: 'recipes', byUid: 'u_emp', status: 'uploading', lockAt: new Date().toISOString(), lockReq: it1.requestId, path: null });
    const r = await call('publishLineItem', 'u_emp', it1);
    assert.equal(r.status, 'ABORTED'); assert.equal(r.error.details.reason, 'busy'); assert.match(r.error.message, HEB);
    await writeDoc(env, 'yemot_state/structure', { lockAt: new Date().toISOString(), lockReq: 'someone_else_1' });
    const h = await call('publishLineItem', 'u_mgr', item('opening'));
    assert.equal(h.error.details.reason, 'busy');
    assert.equal(M.state.requests.length, 0);
    // נעילה ישנה (מעל 120 שניות) – ממשיכים
    await writeDoc(env, 'yemot_state/structure', { lockAt: new Date(Date.now() - 200000).toISOString(), lockReq: 'someone_else_1' });
    assert.equal((await call('publishLineItem', 'u_mgr', item('opening'))).status, 'OK');
  });

  it('קלט לא תקין נדחה בעברית, בלי פנייה לימות', async () => {
    const cases = [
      [{ requestId: 'short' }, 'bad-request-id'], [{ slot: 'promos' }, 'bad-slot'], [{ slot: '__proto__' }, 'bad-slot'],
      [{ text: '' }, 'empty-text'], [{ text: 5 }, 'empty-text'], [{ text: 'א'.repeat(2501) }, 'text-too-long'],
      [{ source: 'recording' }, 'bad-input'], [{ source: undefined }, 'bad-input'], [{ text: undefined }, 'bad-input'],
      [{ audio: audio(wav(1)) }, 'bad-input'],
    ];
    for (const [patch, reason] of cases) {
      const r = await call('publishLineItem', 'u_mgr', item('recipes', patch));
      assert.equal(r.error && r.error.details.reason, reason, JSON.stringify(patch).slice(0, 80));
      assert.match(r.error.message, HEB);
    }
    for (const [slot, max] of [['updates', 800], ['hours', 600], ['opening', 600]]) {
      assert.equal((await call('publishLineItem', 'u_mgr', item(slot, { text: 'ב'.repeat(max + 1) }))).error.details.reason, 'text-too-long', slot);
    }
    assert.equal(M.state.requests.length, 0);
    assert.equal((await call('publishLineItem', 'u_mgr', item('recipes', { text: 'ב'.repeat(2500) }))).status, 'OK');
  });

  // ---------------- 7. הקלטה (שלוחה 3) ----------------
  it('הקלטה: WAV תקין עולה לשלוחה 3 דרך UploadFile (convertAudio=1); פורמט אחר / ארוך מדי – נדחה; מתכונים – מותר (משימה 2026-11-04)', async () => {
    const b = wav(1.5);
    const r = await call('publishLineItem', 'u_emp', { requestId: rid(), slot: 'updates', audio: audio(b), source: 'recording' });
    assert.equal(r.status, 'OK', r.text);
    assert.match(r.result.path, /^ivr2:3\/001\.wav$/); assert.equal(r.result.kind, 'audio');
    const up = M.calls('UploadFile')[0].body;
    assert.equal(up.path, r.result.path); assert.equal(up.convertAudio, '1'); assert.equal(up.size, b.length);
    assert.ok(Buffer.isBuffer(dir('3').get('001.wav')) && dir('3').get('001.wav').equals(b));
    const rec = await readDoc(env, 'yemot_items/' + r.result.id);
    assert.equal(rec.durationSec, 1.5); assert.equal(rec.text, null); assert.match(rec.title, /^הקלטה \d\d\/\d\d \d\d:\d\d$/);
    const bads = [
      [{ audio: audio(wav(1, { ch: 2 })) }, 'bad-audio'], [{ audio: audio(wav(1, { rate: 44100 })) }, 'bad-audio'],
      [{ audio: audio(wav(1, { riff: 'RIFX' })) }, 'bad-audio'], [{ audio: audio(wav(1, { fmt: 3 })) }, 'bad-audio'],
      [{ audio: audio(wav(0)) }, 'bad-audio'], [{ audio: { mimeType: 'audio/webm', data: 'AAAA' } }, 'bad-audio'],
      [{ audio: { mimeType: 'audio/wav', data: '@@@@' } }, 'bad-audio'],
      [{ audio: audio(wav(121)) }, 'audio-too-long'], [{ audio: audio(wav(126)) }, 'audio-too-long'],
      [{ audio: audio(wav(1)), source: 'typed' }, 'bad-input'],
    ];
    for (const [patch, reason] of bads) {
      const x = await call('publishLineItem', 'u_emp', Object.assign({ requestId: rid(), slot: 'updates', source: 'recording' }, patch));
      assert.equal(x.error && x.error.details.reason, reason, JSON.stringify(patch).slice(0, 60)); assert.match(x.error.message, HEB);
    }
    const na = await call('publishLineItem', 'u_emp', { requestId: rid(), slot: 'recipes', audio: audio(wav(1)), source: 'recording' });
    assert.equal(na.status, 'OK', na.text); assert.equal(na.result.path, 'ivr2:1/001.wav'); // משימה 2026-11-04: הקלטה בכל השלוחות
    assert.equal(M.calls('UploadFile').length, 2);
    // שלוחה 3 = היסטוריה (פ4): הקלדה אחרי הקלטה – קובץ חדש, הקודם נשאר
    const t = await call('publishLineItem', 'u_emp', item('updates'));
    assert.equal(t.result.file, '002.tts'); assert.deepEqual(names('3'), ['000.tts', '001.wav', '002.tts']);
  });

  // ---------------- 8. טבלת המצבים: החלפה (שלוחה 4 והפתיחה) ----------------
  // ---------------- 8. החלפה (הפתיחה) ----------------
  it('החלפה (פתיחה) – כשל בהעלאה: הקודמת נשארת live ובקו; אחרי החלפת מנוע קול – החדשה עולה ורק אחר כך הקודמת נמחקת', async () => {
    const a = await call('publishLineItem', 'u_mgr', item('opening', { text: 'א' }));
    M.setMode('upload', 'error');
    assert.equal((await call('publishLineItem', 'u_mgr', item('opening', { text: 'ב' }))).status, 'UNAVAILABLE');
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'live');
    assert.equal(dir('').get('M1000.tts'), 'א');
    M.setMode('upload', 'ok');
    const voice = require('../functions/lib/voice');
    voice._test.setTextExt('xyz');
    try {
      M.setMode('delete', 'error');
      const b = await core(LINE, 'publishItem', 'u_mgr', item('opening', { text: 'ג' }));
      assert.equal(b.status, 'OK', b.text); assert.deepEqual(b.result.warnings, ['yemot-remove-failed']);
      assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'remove-failed');
      M.setMode('delete', 'ok');
      const c = await core(LINE, 'publishItem', 'u_mgr', item('opening', { text: 'ד' }));
      assert.equal(c.status, 'OK', c.text);
      const cmds = M.state.requests.map((q) => q.cmd);
      assert.ok(cmds.lastIndexOf('UploadTextFile') < cmds.lastIndexOf('FileAction'), cmds.join(','));
    } finally { voice._test.setTextExt('tts'); }
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'replaced');
    assert.ok(!dir('').has('M1000.tts')); assert.equal(dir('').get('M1000.xyz'), 'ד');
    assert.equal(dir('').get('M1000.wav'), 'פתיחה מוקלטת');
  });

  // ---------------- סבב 3: שלוחה 4 ----------------
  it('שלוחה 4: כל הודעה קבועה בקובץ חדש וגבוה יותר (מושמעת ראשונה); הקודמות ו-000.tts נשארות עד שהמנהל מוחק', async () => {
    const a = await call('publishLineItem', 'u_mgr', item('hours', { text: 'שעות א' }));
    const b = await call('publishLineItem', 'u_mgr', item('hours', { text: 'שעות ב' }));
    assert.equal(a.result.file, '001.tts'); assert.equal(b.result.file, '002.tts'); assert.equal(b.result.replaced, null);
    assert.deepEqual(names('4'), ['000.tts', '001.tts', '002.tts']);
    assert.equal(M.calls('FileAction').length, 0);
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'live');
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).temporary, false);
  });

  it('שלוחה 4: רשימת הקבצים מהקו (מנהל) – מהגבוה לנמוך, כולל 000.tts הוותיק, בלי ext.ini; עובד נדחה', async () => {
    dir('4').set('ext.ini', 'type=playfile'); dir('4').set('M0000.tts', 'x');
    const a = await call('publishLineItem', 'u_mgr', item('hours', { text: 'זמני', until: addDays(israelDay(), 3) }));
    const r = await call('listLineFiles', 'u_mgr', { ext: '4' });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(r.result.files.map((f) => [f.name, f.legacy]), [['001.tts', false], ['000.tts', true]]);
    assert.equal(r.result.files[0].item.id, a.result.id); assert.equal(r.result.files[0].item.until, addDays(israelDay(), 3)); assert.equal(r.result.files[0].item.temporary, true);
    const e = await call('listLineFiles', 'u_emp', { ext: '4' });
    assert.equal(e.error.details.reason, 'manager-only'); assert.match(e.error.message, HEB);
    assert.equal((await call('listLineFiles', 'u_mgr', { ext: '1' })).error.details.reason, 'bad-slot');
    M.setMode('dir', 'error');
    const f = await call('listLineFiles', 'u_mgr', { ext: '4' });
    assert.equal(f.error.details.reason, 'yemot-list-failed'); assert.ok(!f.text.includes(SECRET));
  });

  it('שלוחה 4: מנהל מוחק קובץ לפי שם – גם 000.tts הוותיק – קובץ אחד בנתיב מדויק; פריט של השרת מסומן removed', async () => {
    const a = await call('publishLineItem', 'u_mgr', item('hours'));
    M.state.requests = [];
    const r0 = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '4', file: '000.tts' });
    assert.equal(r0.status, 'OK', r0.text); assert.equal(r0.result.removed, true);
    assert.deepEqual(M.calls('FileAction').map((q) => q.body), [{ action: 'delete', what: 'ivr2:4/000.tts' }]);
    const r1 = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '4', file: a.result.file });
    assert.equal(r1.status, 'OK');
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'removed');
    assert.deepEqual(names('4'), []);
    const again = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '4', file: '000.tts' });
    assert.equal(again.result.duplicate, true); assert.equal(M.calls('FileAction').length, 2);
    assert.equal((await readDoc(env, 'yemot_state/ext-4')).lockAt, null);
    // כשל במחיקה
    dir('4').set('005.tts', 'x'); M.setMode('delete', 'error');
    const f = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '4', file: '005.tts' });
    assert.equal(f.error.details.reason, 'yemot-remove-failed'); assert.ok(dir('4').has('005.tts')); assert.ok(!f.text.includes(SECRET));
  });

  it('שלוחה 4: עובד לא מוחק ולא מוסיף; מחיקה מחוץ לשמות המותרים של שלוחה 4 נדחית בלי פנייה לימות', async () => {
    const w = await call('removeLineItem', 'u_emp', { requestId: rid(), ext: '4', file: '000.tts' });
    assert.equal(w.error.details.reason, 'manager-only'); assert.match(w.error.message, HEB);
    const wa = await call('publishLineItem', 'u_emp', item('hours', { until: addDays(israelDay(), 2) }));
    assert.equal(wa.error.details.reason, 'slot-manager-only');
    // שלב 5 (משימה 2026-11-04): מחיקה לפי שם הורחבה לשלוחות 1–3 (עם גיבוי) – הן כבר לא כאן. שלוחה 5, שורש ושמות לא חוקיים – עדיין נדחים.
    for (const [ext, file] of [['5', '000.tts'], ['0', '001.tts'], ['2/1', '001.tts'], ['', 'M1000.tts'], ['4', 'ext.ini'], ['4', 'M0000.tts'], ['4', '../5/ext.ini'],
      ['4', '1/000.tts'], ['4', '0000.tts'], ['4', '000'], ['4', ''], ['4', '000.tts/'], [undefined, '000.tts'], ['4', 5]]) {
      const r = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext, file });
      assert.equal(r.error && r.error.details.reason, 'bad-file', JSON.stringify([ext, file])); assert.match(r.error.message, HEB);
    }
    assert.equal(M.state.requests.length, 0);
    assert.equal(dir('4').get('000.tts'), 'שעות ותיקות');
    const { safePath } = require(LINE)._core;
    assert.deepEqual(['ivr2:4/000.tts', 'ivr2:1/000.tts', 'ivr2:3/000.wav', 'ivr2:4/', 'ivr2:4', 'ivr2:4/00.tts'].map(safePath), [true, false, false, false, false, false]);
  });

  // ---------------- שלב 6: הערות לא מכשילות מבדיקת שרת סבב 2 ----------------
  it('שלב 6 – מחיקה בשלוחה 4: רשימה סגורה של סיומות קול (tts/wav); סיומת אחרת נדחית בלי פנייה לימות, והרשימה מסמנת אותה "לא למחיקה"', async () => {
    // שלב 5 (משימה 2026-11-04): קובץ ותיק נמחק רק אחרי גיבוי – לכן 003.wav הוא WAV אמיתי (קודם: 'x')
    for (const [f, c] of [['001.ini', 'x'], ['002.mp3', 'x'], ['003.wav', wav(1)], ['004.ymgr', 'x']]) dir('4').set(f, c);
    M.state.requests = [];
    for (const file of ['001.ini', '002.mp3', '004.ymgr']) {
      const r = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '4', file });
      assert.equal(r.error && r.error.details.reason, 'bad-file', file); assert.match(r.error.message, HEB);
    }
    assert.equal(M.state.requests.length, 0);
    const l = await call('listLineFiles', 'u_mgr', { ext: '4' });
    assert.equal(l.status, 'OK', l.text);
    assert.deepEqual(l.result.files.map((x) => [x.name, x.deletable]), [['004.ymgr', false], ['003.wav', true], ['002.mp3', false], ['001.ini', false], ['000.tts', true]]);
    const w = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '4', file: '003.wav' });
    assert.equal(w.status, 'OK', w.text);
    assert.deepEqual(M.calls('FileAction').map((q) => q.body.what), ['ivr2:4/003.wav']);
    for (const f of ['001.ini', '002.mp3', '004.ymgr', '000.tts']) assert.ok(dir('4').has(f), f);
    const voice = require('../functions/lib/voice');
    assert.deepEqual(['000.tts', '001.WAV', '001.wav', '001.mp3', '001.ini', 'M1000.tts', '01.tts', '001.tts\n', 5].map(voice.isDeletableContent), [true, true, true, false, false, false, false, false, false]);
  });

  it('שלב 6 – לילה בשלוחה 4: הודעה זמנית שפג תוקפה לא נמחקת אם רשומה אחרת (בתוקף) מחזיקה את אותו נתיב (path-reused, כמו במבצעים)', async () => {
    const today = israelDay();
    const t = await call('publishLineItem', 'u_mgr', item('hours', { text: 'זמני ישן', until: today }));
    assert.equal(t.status, 'OK', t.text);
    await writeDoc(env, 'yemot_items/reuse_hours_1', { slot: 'hours', status: 'live', temporary: false, path: t.result.path, file: t.result.file, title: 'קבוע חדש' });
    M.state.requests = [];
    const out = await require('../functions/yemot-line.js').runLineExpiry({ now: new Date(Date.now() + 2 * 86400000), key: SECRET, base: BASE, timeoutMs: 5000 });
    assert.equal(out.removed, 0, JSON.stringify(out)); assert.equal(out.skipped, 1, JSON.stringify(out));
    assert.equal(M.calls('FileAction').length, 0);
    assert.ok(dir('4').has(t.result.file));
    const rec = await readDoc(env, 'yemot_items/' + t.result.id);
    assert.equal(rec.status, 'removed'); assert.equal(rec.error, 'path-reused');
    assert.equal((await readDoc(env, 'yemot_items/reuse_hours_1')).status, 'live');
  });

  it('שלב 6 – מבצעים: מחיקת הקובץ הישן אחרי החלפת מנוע קול עובדת גם בשלוחה מקוננת (YEMOT_EXT=2/1), ולא נוגעת בשלוחה אחרת', async () => {
    const { staleRe } = require(PROMO)._core;
    assert.deepEqual(['ivr2:2/1/005.tts', 'ivr2:2/005.tts', 'ivr2:2/1/5/005.tts', 'ivr2:3/1/005.tts', 'ivr2:2/1/ext.ini'].map((p) => staleRe('2/1').test(p)), [true, false, false, false, false]);
    assert.deepEqual(['ivr2:2/005.tts', 'ivr2:2/1/005.tts', 'ivr2:3/005.tts'].map((p) => staleRe('2').test(p)), [true, false, false]);
    M.state.dirs['2/1'] = new Map([['000.tts', 'פתיח מקונן']]);
    const key = 'pk_nested_' + rid();
    const a = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: key, text: 'מבצע מקונן א' }), { YEMOT_EXT: '2/1' });
    assert.equal(a.status, 'OK', a.text); assert.equal(a.result.file, '001.tts');
    assert.ok(dir('2/1').has('001.tts'));
    const voice = require('../functions/lib/voice');
    voice._test.setTextExt('xyz');
    try {
      M.state.requests = [];
      const b = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: key, text: 'מבצע מקונן ב' }), { YEMOT_EXT: '2/1' });
      assert.equal(b.status, 'OK', b.text); assert.match(b.result.file, /\.xyz$/);
      assert.deepEqual(M.calls('FileAction').map((q) => q.body.what), ['ivr2:2/1/001.tts']);
    } finally { voice._test.setTextExt('tts'); }
    assert.ok(!dir('2/1').has('001.tts')); assert.equal(dir('2/1').get('000.tts'), 'פתיח מקונן');
    assert.equal(M.state.files.size, 1, 'שלוחה 2 עצמה לא נגעה');
  });

  it('שלוחה 4: הודעה זמנית – תאריך חובה תקין (היום עד 60 יום), רק בשלוחה 4', async () => {
    const today = israelDay();
    for (const [until, reason] of [[addDays(today, -1), 'date-past'], [addDays(today, 61), 'date-too-far'], ['2026-02-30', 'bad-date'], ['1.12.2026', 'bad-date'], [5, 'bad-date']]) {
      const r = await call('publishLineItem', 'u_mgr', item('hours', { until }));
      assert.equal(r.error && r.error.details.reason, reason, String(until)); assert.match(r.error.message, HEB);
    }
    for (const slot of ['recipes', 'updates', 'opening']) assert.equal((await call('publishLineItem', 'u_mgr', item(slot, { until: today }))).error.details.reason, 'bad-input', slot);
    assert.equal(M.state.requests.length, 0);
    for (const until of [today, addDays(today, 60)]) {
      const r = await call('publishLineItem', 'u_mgr', item('hours', { until }));
      assert.equal(r.status, 'OK', r.text); assert.match(r.result.message, /תרד מהקו אחרי/);
      const rec = await readDoc(env, 'yemot_items/' + r.result.id);
      assert.equal(rec.until, until); assert.equal(rec.temporary, true);
    }
  });

  it('לילה (expirePromosOnLine): מוחק רק הודעות זמניות שפג תוקפן בשלוחה 4 ומבצעים שפג תוקפם – שום דבר אחר', async () => {
    const today = israelDay();
    const tOld = await call('publishLineItem', 'u_mgr', item('hours', { text: 'זמני ישן', until: today }));
    const tNew = await call('publishLineItem', 'u_mgr', item('hours', { text: 'זמני בתוקף', until: addDays(today, 5) }));
    const perm = await call('publishLineItem', 'u_mgr', item('hours', { text: 'קבוע' }));
    const rec = await call('publishLineItem', 'u_emp', item('recipes'));
    const pOld = await call('sendPromoToLine', 'u_mgr', promo({ until: today }));
    const pNew = await call('sendPromoToLine', 'u_mgr', promo({ until: addDays(today, 5) }));
    // רשומות "זרות": מתכון שסומן זמני, ופריט זמני שמצביע על 000.tts – אסור למחוק
    dir('1').set('009.tts', 'מתכון'); dir('4').set('009.tts', 'אחר');
    await writeDoc(env, 'yemot_items/evil_rec_1', { slot: 'recipes', status: 'live', temporary: true, until: addDays(today, -3), path: 'ivr2:1/009.tts', file: '009.tts' });
    await writeDoc(env, 'yemot_items/evil_000_1', { slot: 'hours', status: 'live', temporary: true, until: addDays(today, -3), path: 'ivr2:4/000.tts', file: '000.tts' });
    await writeDoc(env, 'yemot_items/evil_ext_1', { slot: 'hours', status: 'live', temporary: true, until: addDays(today, -3), path: 'ivr2:1/009.tts', file: '009.tts' });
    M.state.requests = [];
    const out = await require('../functions/yemot.js')._core.nightly({ now: new Date(Date.now() + 2 * 86400000), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(out.promos.removed, 1, JSON.stringify(out)); assert.equal(out.line.removed, 1, JSON.stringify(out));
    assert.equal(out.line.skipped, 2);
    assert.deepEqual(M.calls('FileAction').map((q) => q.body.what).sort(), ['ivr2:2/' + pOld.result.file, tOld.result.path].sort());
    assert.ok(!dir('4').has(tOld.result.file));
    for (const f of [tNew.result.file, perm.result.file, '000.tts', '009.tts']) assert.ok(dir('4').has(f), f);
    assert.ok(dir('1').has(rec.result.file) && dir('1').has('009.tts'));
    assert.ok(M.state.files.has(pNew.result.file));
    assert.equal((await readDoc(env, 'yemot_items/' + tOld.result.id)).status, 'removed');
    assert.equal((await readDoc(env, 'yemot_items/' + tNew.result.id)).status, 'live');
    // מחיקה שנכשלה – remove-failed וניסיון בלילה הבא; ריצה חוזרת לא מוחקת שוב
    M.state.requests = [];
    const out2 = await require('../functions/yemot.js')._core.nightly({ now: new Date(Date.now() + 2 * 86400000), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(out2.line.removed, 0); assert.equal(M.calls('FileAction').length, 0);
    const t3 = await call('publishLineItem', 'u_mgr', item('hours', { until: today }));
    M.setMode('delete', 'error');
    const o3 = await require('../functions/yemot-line.js').runLineExpiry({ now: new Date(Date.now() + 2 * 86400000), key: SECRET, base: BASE, timeoutMs: 5000 });
    assert.equal(o3.failed, 1); assert.equal((await readDoc(env, 'yemot_items/' + t3.result.id)).status, 'remove-failed');
    M.setMode('delete', 'ok');
    assert.equal((await require('../functions/yemot-line.js').runLineExpiry({ now: new Date(Date.now() + 2 * 86400000), key: SECRET, base: BASE, timeoutMs: 5000 })).removed, 1);
  });

  it('פתיחה (פ2=קובץ-תוכן): כותבת רק ivr2:/M1000.tts, דורסת אותו בעדכון הבא; M1000.wav ו-ext.ini לא נוגעים', async () => {
    const a = await call('publishLineItem', 'u_mgr', item('opening', { text: 'שלום וברוכים הבאים' }));
    assert.equal(a.status, 'OK', a.text); assert.equal(a.result.path, 'ivr2:/M1000.tts');
    const b = await call('publishLineItem', 'u_mgr', item('opening', { text: 'פתיחה חדשה' }));
    assert.equal(b.result.path, 'ivr2:/M1000.tts');
    assert.equal(dir('').get('M1000.tts'), 'פתיחה חדשה');
    assert.equal(dir('').get('M1000.wav'), 'פתיחה מוקלטת'); assert.equal(dir('').get('ext.ini'), 'type=menu');
    assert.equal(M.calls('FileAction').length, 0); assert.equal(M.calls('GetIVR2Dir').length, 0);
    assert.deepEqual(M.calls('UploadTextFile').map((q) => q.body.what), ['ivr2:/M1000.tts', 'ivr2:/M1000.tts']);
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'replaced');
    const st = await call('getLineState', 'u_mgr', {});
    assert.equal(st.result.slots.opening.mode, 'file'); assert.equal(st.result.slots.opening.current.text, 'פתיחה חדשה');
  });

  // ---------------- 9. טבלת המצבים: מחיקה (removeLineItem) ----------------
  it('מחיקה: הצלחה; כשל ← remove-failed ואז ניסיון חוזר; קובץ שכבר נעלם ← removed בלי מחיקה; פעם שנייה ← duplicate', async () => {
    const a = await call('publishLineItem', 'u_emp', item('recipes'));
    const b = await call('publishLineItem', 'u_emp', item('recipes'));
    M.setMode('delete', 'error');
    const f = await call('removeLineItem', 'u_mgr', { requestId: rid(), id: a.result.id });
    assert.equal(f.status, 'UNAVAILABLE'); assert.equal(f.error.details.reason, 'yemot-remove-failed'); assert.ok(!f.text.includes(SECRET));
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'remove-failed');
    M.setMode('delete', 'ok');
    const ok = await call('removeLineItem', 'u_mgr', { requestId: rid(), id: a.result.id });
    assert.equal(ok.status, 'OK', ok.text); assert.ok(!dir('1').has(a.result.file));
    const ra = await readDoc(env, 'yemot_items/' + a.result.id);
    assert.equal(ra.status, 'removed'); assert.equal(ra.removedBy, 'u_mgr');
    const dup = await call('removeLineItem', 'u_mgr', { requestId: rid(), id: a.result.id });
    assert.equal(dup.result.duplicate, true);
    dir('1').delete(b.result.file); M.state.requests = [];
    const gone = await call('removeLineItem', 'u_mgr', { requestId: rid(), id: b.result.id });
    assert.equal(gone.status, 'OK'); assert.equal(M.calls('FileAction').length, 0);
    assert.equal(dir('1').get('000.tts'), 'מתכון ותיק');
    const nf = await call('removeLineItem', 'u_mgr', { requestId: rid(), id: 'nosuchitem1' });
    assert.equal(nf.error.details.reason, 'item-not-found'); assert.match(nf.error.message, HEB);
  });

  it('מחיקה – פסק זמן: remove-failed+uncertain; בניסיון הבא בודקים ברשימה ומוחקים', async () => {
    const a = await call('publishLineItem', 'u_emp', item('recipes'));
    M.setMode('delete', 'hang');
    const r = await core(LINE, 'removeItem', 'u_mgr', { requestId: rid(), id: a.result.id }, { YEMOT_TIMEOUT_MS: '700' });
    assert.equal(r.error.details.reason, 'yemot-remove-failed');
    const x = await readDoc(env, 'yemot_items/' + a.result.id);
    assert.equal(x.status, 'remove-failed'); assert.equal(x.uncertain, true);
    M.setMode('delete', 'ok');
    assert.equal((await core(LINE, 'removeItem', 'u_mgr', { requestId: rid(), id: a.result.id })).status, 'OK');
    assert.ok(!dir('1').has(a.result.file));
  });

  it('מחיקה – הגנה: רשומה מזויפת שמצביעה על 000.tts, על ext.ini או על שלוחה 5 – לא נמחקת; פתיחה לא מוסרת', async () => {
    for (const [id, p, slot, ext] of [['fake00000a', 'ivr2:1/000.tts', 'recipes', '1'], ['fake00000b', 'ivr2:5/ext.ini', 'recipes', '5'], ['fake00000c', 'ivr2:2/001.tts', 'recipes', '2']]) {
      await writeDoc(env, 'yemot_items/' + id, { slot, ext, status: 'live', path: p, file: p.split('/').pop() });
      const r = await call('removeLineItem', 'u_mgr', { requestId: rid(), id });
      assert.equal(r.error.details.reason, 'item-not-found', p);
    }
    await writeDoc(env, 'yemot_items/fake00000d', { slot: 'opening', ext: '', status: 'live', path: 'ivr2:/M1000.tts', file: 'M1000.tts' });
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), id: 'fake00000d' })).error.details.reason, 'bad-slot');
    assert.equal(M.state.requests.length, 0);
    const { safePath } = require(LINE)._core;
    assert.deepEqual(['ivr2:1/001.tts', 'ivr2:4/999.wav', 'ivr2:/M1000.tts', 'ivr2:1/000.tts', 'ivr2:2/001.tts', 'ivr2:/M0000.tts', 'ivr2:1/../5/ext.ini', 'ivr2:5/001.tts'].map(safePath),
      [true, true, true, false, false, false, false, false]);
  });

  // ---------------- 10. getLineState ----------------
  it('getLineState: עובד מקבל רק מתכונים ועדכונים (לא שעות ולא פתיחה); מנהל – הכול; בלי פנייה לימות', async () => {
    await call('publishLineItem', 'u_emp', item('recipes', { text: 'ראשון' }));
    await call('publishLineItem', 'u_emp', item('recipes', { text: 'שני' }));
    await call('publishLineItem', 'u_mgr', item('hours'));
    await writeDoc(env, 'yemot_lexicon/main', { text: 'א=ב', updatedAt: 1, updatedBy: 'u_mgr' });
    M.state.requests = [];
    const e = await call('getLineState', 'u_emp', { slots: ['recipes', 'hours', 'opening'] });
    assert.equal(e.status, 'OK', e.text);
    assert.deepEqual(Object.keys(e.result.slots), ['recipes']);
    assert.deepEqual(e.result.slots.recipes.map((x) => x.title), ['שני', 'ראשון']);
    assert.equal(e.result.lexicon, 'א=ב'); assert.equal(e.result.preview, 'phone'); assert.equal(e.result.structure, 'off');
    assert.equal(e.result.limits.recipes, 2500);
    const all = await call('getLineState', 'u_emp', {});
    assert.deepEqual(Object.keys(all.result.slots).sort(), ['recipes', 'updates']);
    const m = await call('getLineState', 'u_mgr', {});
    assert.deepEqual(Object.keys(m.result.slots).sort(), ['hours', 'opening', 'recipes', 'updates']);
    assert.equal((await call('getLineState', 'u_mgr', { slots: ['bad'] })).error.details.reason, 'bad-input');
    assert.equal(M.state.requests.length, 0);
  });

  // ---------------- 11. סריקת מתכון ----------------
  it('scanDocument סוג recipe: 1-2 תמונות, מודל pro, temperature 0.1, ההנחיה מבקשת JSON של title/text', () => {
    const scan = require('../functions/lib/scan');
    assert.equal(scan.isKind('recipe'), true);
    assert.equal(scan.KINDS.recipe.pro, true); assert.equal(scan.KINDS.recipe.maxFiles, 2);
    const jpg = { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64') };
    assert.throws(() => scan.validateScanInput({ kind: 'recipe', files: [jpg, jpg, jpg] }, 1e6), (e) => e.details.reason === 'bad-file-count');
    const body = scan.buildGeminiBody('recipe', [jpg, jpg]);
    assert.match(body.contents[0].parts[0].text, /מתכון[\s\S]*כתב יד[\s\S]*"title"[\s\S]*"text"/);
    assert.equal(body.contents[0].parts.length, 3); assert.equal(body.generationConfig.temperature, 0.1);
    // אחרי המיזוג עם סגירת הקופה: גם zreport, opening ו-deposit (מהאפליקציה). recipe רק בשרת – לא בקובץ שנוצר אוטומטית
    assert.deepEqual(Object.keys(require('../functions/lib/prompts')).sort(), ['cashout', 'deposit', 'feedback', 'feedbackCaptions', 'invoice', 'opening', 'product', 'transfer', 'zreport'], 'prompts.js (נוצר אוטומטית) לא השתנה');
    assert.ok(!Object.hasOwn(require('../functions/lib/prompts'), 'recipe'));
  });

  // ---------------- 12. כללים ----------------
  it('כללים: האפליקציה לא קוראת ולא כותבת את yemot_items, yemot_line_backups, yemot_state, yemot_hook_usage', async () => {
    for (const p of ['yemot_items/i1', 'yemot_line_backups/b1', 'yemot_state/ext-1', 'yemot_hook_usage/h1']) await writeDoc(env, p, { status: 'live' });
    for (const role of ['guest', 'employee', 'manager']) {
      const db = H.ctxFor(env, role).firestore();
      for (const p of ['yemot_items/i1', 'yemot_items/new1', 'yemot_line_backups/b1', 'yemot_state/ext-1', 'yemot_hook_usage/h1']) {
        await assertFails(db.doc(p).set({ status: 'removed' })); await assertFails(db.doc(p).get());
      }
      await assertFails(db.collection('yemot_items').get());
    }
  });

  // ---------------- 13. שלוחה 5 – tzintukJoin (מושבת: אין פעולת הוספה מתועדת) ----------------
  // הפונקציה לא מיובאת מ-index.js, ולכן נבדקת בתוך תהליך הבדיקה (הליבה handleJoin).
  const JK = 'k-test-hook-1';
  async function join(query, method) {
    const out = { code: 0, text: null };
    const res = { status(c) { out.code = c; return this; }, set() { return this; }, send(b) { out.text = b; } };
    const req = method === 'POST' ? { method, query: {}, body: query } : { method: 'GET', query, body: {} };
    await require('../functions/yemot-hook.js')._core.handleJoin(req, res, { secret: JK, daily: 3 });
    SEEN.push(String(out.text)); return out;
  }

  it('tzintukJoin מושבת: אין בקוד שום קריאה ל-TzintukimListManagement או ל-resetList, והקובץ לא מיובא', () => {
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const root = path.join(H.ROOT, 'functions');
    const files = fs.readdirSync(root).filter((f) => f.endsWith('.js')).concat(fs.readdirSync(path.join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => 'lib/' + f));
    assert.deepEqual(files.filter((f) => /TzintukimListManagement|resetList/.test(strip(fs.readFileSync(path.join(root, f), 'utf8')))), []);
    assert.ok(!/yemot-hook/.test(strip(fs.readFileSync(path.join(root, 'index.js'), 'utf8'))), 'index.js מייבא את yemot-hook');
    assert.equal(require('../functions/yemot-hook.js')._core.BLOCKED, true);
  });

  it('tzintukJoin: בלי סוד או עם סוד שגוי ← 403, בלי פנייה לימות ובלי רשומה; בלי סוד בשרת – תמיד 403', async () => {
    for (const p of [{ ApiPhone: '0541234567' }, { ApiPhone: '0541234567', key: 'wrong' }, { ApiPhone: '0541234567', key: JK + 'x' }, { ApiPhone: '0541234567', key: '' }]) {
      assert.equal((await join(p)).code, 403, JSON.stringify(p));
    }
    assert.equal((await join({ ApiPhone: '0541234567', key: 'wrong' }, 'POST')).code, 403);
    const out = { code: 0 }; const res = { status(c) { out.code = c; return this; }, set() { return this; }, send() {} };
    await require('../functions/yemot-hook.js')._core.handleJoin({ method: 'GET', query: { ApiPhone: '0541234567', key: '' }, body: {} }, res, { secret: '' });
    assert.equal(out.code, 403);
    assert.equal(M.state.requests.length, 0);
    assert.deepEqual(await allDocs(env, ['yemot_hook_usage']), []);
  });

  it('tzintukJoin: מספר מזוהה ← הודעה שהשירות עוד לא פעיל, בפורמט מודול API, בלי שום פנייה לימות (גם ב-POST ו-972)', async () => {
    const r = await join({ ApiPhone: '0541234567', ApiDID: '023131165', ApiCallId: 'abc', key: JK });
    assert.equal(r.code, 200);
    assert.equal(r.text, 'id_list_message=t-ההצטרפות דרך השלוחה הזו עוד לא פעילה&go_to_folder=/');
    assert.match((await join({ ApiPhone: '972521234567', key: JK }, 'POST')).text, /עוד לא פעילה/);
    assert.equal(M.state.requests.length, 0);
    const docs = JSON.stringify(await allDocs(env, ['yemot_hook_usage']));
    assert.ok(!docs.includes('0541234567') && !docs.includes('541234567'), 'מספר הטלפון נשמר במסד');
    // אף הודעה לא מכילה תו אסור בטקסט t- (נקודה, מקף) או מפריד (& =)
    for (const m of Object.values(require('../functions/yemot-hook.js')._core.MSG)) assert.ok(!/[.\-&=]/.test(m), m);
  });

  it('tzintukJoin: מספר חסוי / לא ישראלי ← "מספר לא מזוהה"; ניתוק (hangup) ← תשובה ריקה', async () => {
    for (const ph of ['', 'anonymous', 'Restricted', '123', '+14155550100', '0000000000', '05412345678']) {
      const r = await join({ ApiPhone: ph, key: JK });
      assert.equal(r.code, 200); assert.match(r.text, /^id_list_message=t-מספר לא מזוהה[^.&=-]*&go_to_folder=\/$/, ph);
    }
    assert.match((await join({ key: JK })).text, /מספר לא מזוהה/);
    assert.equal((await join({ ApiPhone: '0541234567', key: JK, hangup: 'yes' })).text, '');
    assert.equal(M.state.requests.length, 0);
  });

  it('tzintukJoin: הגבלת קצב – עד 3 פעמים ביום לאותו מספר; מספר אחר לא מושפע', async () => {
    for (let i = 0; i < 3; i++) assert.match((await join({ ApiPhone: '0501112222', key: JK })).text, /עוד לא פעילה/);
    assert.match((await join({ ApiPhone: '0501112222', key: JK })).text, /הבקשה כבר התקבלה היום/);
    assert.match((await join({ ApiPhone: '0503334444', key: JK })).text, /עוד לא פעילה/);
    assert.equal(M.state.requests.length, 0);
  });

  // ---------------- 14. הסוד ----------------
  it('הסוד של ימות: רק בכותרת authorization; לא בתשובות, לא ברשומות ולא ביומנים (גם כששרת הדמה מחזיר אותו בשגיאה)', async () => {
    M.setMode('upload', 'error');
    await core(LINE, 'publishItem', 'u_mgr', item('recipes'));
    M.setMode('upload', 'exception');
    await core(PROMO, 'sendPromo', 'u_mgr', promo());
    M.setMode('upload', 'ok'); M.setMode('delete', 'error');
    await call('publishLineItem', 'u_mgr', item('hours')); await call('publishLineItem', 'u_mgr', item('hours'));
    assert.ok(M.state.requests.length >= 4);
    for (const q of M.state.requests) { assert.equal(q.auth, SECRET); assert.ok(!q.url.includes(SECRET)); assert.ok(!JSON.stringify(q.body).includes(SECRET)); }
    assert.ok(!JSON.stringify(await allDocs(env, YCOLS)).includes(SECRET));
    assert.deepEqual(SEEN.filter((t) => t.includes(SECRET) || (HOOK && t.includes(HOOK))), []);
    assert.ok(LOGS.length > 0, 'לא נאספו יומנים');
    assert.deepEqual(LOGS.filter((t) => t.includes(SECRET)), []);
  });

  // ================= משימה 2026-11-04, שלב 4: הקלטה בכל השלוחות, מבצע מוקלט, גיבוי הפתיחה =================
  const recItem = (slot, sec, extra) => Object.assign({ requestId: rid(), slot, audio: audio(wav(sec)), source: 'recording' }, extra || {});
  const recPromo = (sec, extra) => Object.assign({ requestId: rid(), promoKey: 'rec_' + rid(), audio: audio(wav(sec)), until: addDays(israelDay(), 3), withTzintuk: false }, extra || {});
  const noLegacyOpening = () => { dir('').delete('M1000.wav'); dir('').set('BACKUP_M1000.wav', 'פתיחה מוקלטת'); };
  // מצב הייצור (הנחה, החלטה 6): פתיחה של האפליקציה בקובץ שמע, ברשומה ישנה בלי שדות השמע החדשים
  async function oldAppOpening(content) {
    const id = 'oldopen_' + rid();
    dir('').set('M1000.wav', content || wav(2));
    await writeDoc(env, 'yemot_items/' + id, { slot: 'opening', ext: '', kind: 'text', text: 'פתיחה קודמת', spoken: 'פתיחה קודמת', engine: 'elevenlabs', status: 'live', file: 'M1000.wav', path: 'ivr2:/M1000.wav', createdAt: '2026-11-03T10:00:00.000Z', byUid: 'u_mgr', byRole: 'manager' });
    return id;
  }
  const failingStore = { async put() { throw new Error('storage down'); }, async size() { throw new Error('storage down'); } };

  it('ש4 הרשאות × שלוחה: עובד מקליט ב-1, 2, 3; נדחה (slot-manager-only) ב-4 ובפתיחה בלי פנייה לימות; מנהל מקליט בכולן', async () => {
    await bucket().deleteFiles({ prefix: 'line_audio/' });
    noLegacyOpening();
    for (const slot of ['recipes', 'updates']) { const r = await call('publishLineItem', 'u_emp', recItem(slot, 1)); assert.equal(r.status, 'OK', slot + r.text); assert.equal(r.result.kind, 'audio'); }
    const ep = await call('sendPromoToLine', 'u_emp', recPromo(1)); assert.equal(ep.status, 'OK', ep.text);
    const before = M.state.requests.length;
    for (const slot of ['hours', 'opening']) {
      const r = await call('publishLineItem', 'u_emp', recItem(slot, 1));
      assert.equal(r.status, 'PERMISSION_DENIED', slot); assert.equal(r.error.details.reason, 'slot-manager-only'); assert.match(r.error.message, HEB);
    }
    assert.equal(M.state.requests.length, before, 'עובד שנדחה – בלי פנייה לימות');
    for (const role of ['guest', 'disabledEmployee']) {
      assert.notEqual((await call('publishLineItem', H.UID[role], recItem('recipes', 1))).status, 'OK');
      assert.notEqual((await call('sendPromoToLine', H.UID[role], recPromo(1))).status, 'OK');
    }
    assert.equal(M.state.requests.length, before);
    const today = israelDay();
    const out = {};
    for (const [slot, extra] of [['recipes'], ['updates'], ['hours'], ['hours', { until: addDays(today, 2) }], ['opening']]) {
      const r = await call('publishLineItem', 'u_mgr', recItem(slot, 1, extra));
      assert.equal(r.status, 'OK', slot + r.text); out[slot + (extra ? '-temp' : '')] = r.result;
    }
    assert.equal(out.opening.path, 'ivr2:/M1000.wav'); assert.match(out.hours.path, /^ivr2:4\/\d{3}\.wav$/);
    const tmp = await readDoc(env, 'yemot_items/' + out['hours-temp'].id);
    assert.equal(tmp.temporary, true); assert.equal(tmp.until, addDays(today, 2)); assert.equal(tmp.kind, 'audio');
    assert.equal((await readDoc(env, 'yemot_items/' + out.hours.id)).temporary, false);
    const mp = await call('sendPromoToLine', 'u_mgr', recPromo(1)); assert.equal(mp.status, 'OK', mp.text);
    assert.equal(M.calls('RunTzintuk').length, 0, 'אין צינתוק בשום הקלטה');
  });

  it('ש4 צינתוק עם הקלטה: נדחה לעובד ולמנהל (tzintuk-not-with-recording), בלי פנייה לימות ובלי מכסה', async () => {
    for (const uid of ['u_emp', 'u_mgr']) {
      for (const origin of [undefined, 'builder']) {
        const r = await call('sendPromoToLine', uid, recPromo(1, { withTzintuk: true, origin }));
        assert.equal(r.status, 'INVALID_ARGUMENT', uid); assert.equal(r.error.details.reason, 'tzintuk-not-with-recording'); assert.match(r.error.message, HEB);
      }
    }
    assert.equal(M.state.requests.length, 0);
    assert.equal(await readDoc(env, 'yemot_usage/u_emp'), null);
  });

  it('ש4 אורך: מעל 120 שניות נדחה בכל שלוחה ובמבצע; בפתיחה – מעל 60 נדחה ו-60 עובר', async () => {
    noLegacyOpening();
    for (const slot of ['recipes', 'updates', 'hours']) {
      const r = await call('publishLineItem', 'u_mgr', recItem(slot, 120.5));
      assert.equal(r.error.details.reason, 'audio-too-long', slot); assert.equal(r.error.details.max, 120); assert.match(r.error.message, /120/);
    }
    const p = await call('sendPromoToLine', 'u_mgr', recPromo(121));
    assert.equal(p.error.details.reason, 'audio-too-long'); assert.equal(p.error.details.max, 120);
    const o = await call('publishLineItem', 'u_mgr', recItem('opening', 61));
    assert.equal(o.error.details.reason, 'audio-too-long'); assert.equal(o.error.details.max, 60); assert.match(o.error.message, /60 שניות/);
    assert.equal(M.state.requests.length, 0);
    const ok = await call('publishLineItem', 'u_mgr', recItem('opening', 60));
    assert.equal(ok.status, 'OK', ok.text);
    assert.equal((await readDoc(env, 'yemot_items/' + ok.result.id)).durationSec, 60);
  });

  it('ש4 מבצע מוקלט – קלט: בלי תאריך ← date-required; תאריך לא תקין/עבר/רחוק; מפתח בלי rec_; עם נוסח/מקור/ידני/מנוע – נדחה בלי פנייה לימות', async () => {
    const today = israelDay();
    const cases = [
      [{ until: undefined }, 'date-required'], [{ until: null }, 'date-required'], [{ until: '' }, 'date-required'],
      [{ until: '2026-13-01' }, 'bad-date'], [{ until: addDays(today, -1) }, 'date-past'], [{ until: addDays(today, 61) }, 'date-too-far'],
      [{ promoKey: 'pk_' + rid() }, 'bad-promo-key'], [{ promoKey: 'man_' + rid() }, 'bad-promo-key'],
      [{ text: 'נוסח' }, 'bad-input'], [{ source: { size: 'p8', index: 1 } }, 'bad-input'], [{ manual: true }, 'bad-input'], [{ engine: 'tts' }, 'bad-input'],
      [{ withTzintuk: 'no' }, 'bad-input'], [{ audio: { mimeType: 'audio/webm', data: 'AAAA' } }, 'bad-audio'], [{ audio: audio(wav(1, { rate: 44100 })) }, 'bad-audio'],
    ];
    for (const uid of ['u_emp', 'u_mgr']) {
      for (const [patch, reason] of cases) {
        const r = await call('sendPromoToLine', uid, Object.assign(recPromo(1), patch));
        assert.equal(r.error && r.error.details.reason, reason, uid + ' ' + JSON.stringify(patch).slice(0, 50)); assert.match(r.error.message, HEB);
      }
    }
    assert.equal(M.state.requests.length, 0);
    // מבצע טקסט בלי תאריך – בלי שינוי (bad-date, כמו קודם)
    assert.equal((await call('sendPromoToLine', 'u_mgr', promo({ until: undefined }))).error.details.reason, 'bad-date');
  });

  it('ש4 מבצע מוקלט: אותו מספור (גבוה מהקיים), live, בלי צינתוק, שמע שמור; לחיצה כפולה ← duplicate; מפתח בשימוש ← bad-promo-key; ריצת הלילה מורידה אחרי התאריך', async () => {
    await bucket().deleteFiles({ prefix: 'line_audio/' });
    const today = israelDay();
    const t = await call('sendPromoToLine', 'u_mgr', promo());
    assert.equal(t.result.file, '001.tts');
    const b = wav(2);
    const req = recPromo(2, { audio: audio(b), until: today });
    const r = await call('sendPromoToLine', 'u_emp', req);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.file, '002.wav'); assert.equal(r.result.tzintuk, 'skipped'); assert.equal(r.result.kind, 'audio'); assert.equal(r.result.audioSaved, true);
    assert.match(r.result.message, /בלי צינתוק/);
    assert.ok(M.state.files.get('002.wav').equals(b));
    const up = M.calls('UploadFile')[0].body; assert.equal(up.path, 'ivr2:2/002.wav'); assert.equal(up.convertAudio, '1');
    const rec = await readDoc(env, 'yemot_promos/' + req.promoKey);
    assert.equal(rec.status, 'live'); assert.equal(rec.kind, 'audio'); assert.equal(rec.engine, 'recording'); assert.equal(rec.durationSec, 2);
    assert.equal(rec.text, null); assert.equal(rec.until, today); assert.equal(rec.withTzintuk, false); assert.match(rec.title, /^הקלטה \d\d\/\d\d \d\d:\d\d$/);
    assert.equal(rec.audioPath, `line_audio/promos/${req.promoKey}.wav`); assert.equal(rec.audioBytes, b.length);
    assert.ok((await stored(rec.audioPath)).equals(b), 'העותק השמור = מה שעלה');
    assert.equal(M.calls('RunTzintuk').length, 0);
    // לחיצה כפולה (אותו requestId): בלי העלאה נוספת
    const d = await call('sendPromoToLine', 'u_emp', req);
    assert.equal(d.status, 'OK'); assert.equal(d.result.duplicate, true); assert.equal(M.calls('UploadFile').length, 1);
    // אותו מפתח, בקשה אחרת: לא מחליפים הקלטה בהקלטה
    const other = await call('sendPromoToLine', 'u_emp', Object.assign({}, req, { requestId: rid() }));
    assert.equal(other.error.details.reason, 'bad-promo-key'); assert.equal(M.calls('UploadFile').length, 1);
    // ריצת הלילה: אותו מנגנון כמו מבצע רגיל
    const out = await require('../functions/yemot.js').runExpiry({ now: new Date(Date.now() + 2 * 86400000), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(out.removed, 1, JSON.stringify(out)); // רק המוקלט (התאריך עבר); מבצע הטקסט עוד בתוקף
    assert.ok(M.state.files.has('001.tts'));
    assert.ok(!M.state.files.has('002.wav'));
    assert.equal((await readDoc(env, 'yemot_promos/' + req.promoKey)).status, 'removed');
  });

  it('ש4 מבצע מוקלט – מצבים: כשל ודאי ← failed + ניסיון חוזר באותו requestId לאותו נתיב; פסק זמן ← uncertain; עומס (נעילה) ← busy', async () => {
    const req = recPromo(1);
    M.setMode('upload', 'error');
    const f = await call('sendPromoToLine', 'u_mgr', req);
    assert.equal(f.error.details.reason, 'yemot-upload-failed');
    const x = await readDoc(env, 'yemot_promos/' + req.promoKey);
    assert.equal(x.status, 'failed'); assert.equal(x.lastResult, 'failed');
    M.setMode('upload', 'ok');
    const ok = await call('sendPromoToLine', 'u_mgr', req);
    assert.equal(ok.status, 'OK', ok.text); assert.match(ok.result.file, /^\d{3}\.wav$/);
    assert.equal(M.calls('UploadFile').length, 2); assert.equal([...M.state.files.keys()].filter((n) => n.endsWith('.wav')).length, 1);
    M.setMode('upload', 'hang');
    const req2 = recPromo(1);
    const h = await core(PROMO, 'sendPromo', 'u_mgr', req2, { YEMOT_TIMEOUT_MS: '300' });
    assert.equal(h.error.details.reason, 'yemot-upload-failed');
    assert.equal((await readDoc(env, 'yemot_promos/' + req2.promoKey)).uncertain, true);
    M.setMode('upload', 'ok');
    const req3 = recPromo(1);
    await writeDoc(env, 'yemot_promos/' + req3.promoKey, { status: 'uploading', lockAt: new Date().toISOString(), lockReq: req3.requestId });
    const bz = await call('sendPromoToLine', 'u_mgr', req3);
    assert.equal(bz.error.details.reason, 'busy');
  });

  it('ש4 הקלטה לא נוגעת במונה התווים ולא פונה ל-ElevenLabs (גם כשהקול המשוכפל מוגדר), בכל השלוחות ובמבצע', async () => {
    noLegacyOpening();
    const el = { VOICE_ENGINE: 'elevenlabs', ELEVENLABS_API_BASE: 'http://127.0.0.1:9', ELEVENLABS_API_KEY: 'DUMMY-ELEVEN-x' }; // כתובת שלא קיימת: פנייה = כשל
    for (const slot of ['recipes', 'updates', 'hours', 'opening']) {
      const r = await core(LINE, 'publishItem', 'u_mgr', recItem(slot, 1), el);
      assert.equal(r.status, 'OK', slot + r.text); assert.equal(r.result.engine, 'recording');
    }
    const p = await core(PROMO, 'sendPromo', 'u_mgr', recPromo(1), el);
    assert.equal(p.status, 'OK', p.text); assert.equal(p.result.engine, 'recording');
    assert.deepEqual((await allDocs(env, ['voice_usage'])).map((d) => d.id), [], 'מונה התווים לא נוצר ולא השתנה');
  });

  it('ש4 שמע שמור: הקלטה ← line_audio/items/<id>.wav זהה; כשל Storage ← ההעלאה מצליחה עם אזהרה audio-not-saved ו-audioError', async () => {
    await bucket().deleteFiles({ prefix: 'line_audio/' });
    const b = wav(1.2);
    const r = await core(LINE, 'publishItem', 'u_emp', recItem('recipes', 1.2, { audio: audio(b) }));
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.audioSaved, true); assert.deepEqual(r.result.warnings, []);
    const rec = await readDoc(env, 'yemot_items/' + r.result.id);
    assert.equal(rec.audioPath, `line_audio/items/${r.result.id}.wav`); assert.equal(rec.audioMime, 'audio/wav'); assert.equal(rec.audioBytes, b.length); assert.ok(rec.audioSavedAt);
    assert.ok((await stored(rec.audioPath)).equals(b));
    // טקסט בקול הממוחשב – אין שמע לשמור
    const t = await core(LINE, 'publishItem', 'u_emp', item('recipes'));
    assert.equal(t.result.audioSaved, false); assert.equal((await readDoc(env, 'yemot_items/' + t.result.id)).audioPath, undefined);
    const voice = require('../functions/lib/voice');
    voice._test.setLineStore(failingStore);
    try {
      const f = await core(LINE, 'publishItem', 'u_emp', recItem('updates', 1));
      assert.equal(f.status, 'OK', f.text); assert.deepEqual(f.result.warnings, ['audio-not-saved']); assert.equal(f.result.audioSaved, false);
      const fr = await readDoc(env, 'yemot_items/' + f.result.id); assert.equal(fr.status, 'live'); assert.equal(fr.audioError, 'save-failed');
      const pf = await core(PROMO, 'sendPromo', 'u_emp', recPromo(1));
      assert.equal(pf.status, 'OK', pf.text); assert.ok(pf.result.warnings.includes('audio-not-saved'));
    } finally { voice._test.setLineStore(null); }
  });

  it('ש4 הקלטה – מצבים בשלוחות: כשל ודאי ← failed; פסק זמן ← uncertain, ניסיון חוזר לאותו נתיב; לחיצה כפולה ← duplicate בלי העלאה', async () => {
    const req = recItem('hours', 1);
    M.setMode('upload', 'error');
    const f = await call('publishLineItem', 'u_mgr', req);
    assert.equal(f.error.details.reason, 'yemot-upload-failed'); assert.equal((await readDoc(env, 'yemot_items/' + req.requestId)).status, 'failed');
    M.setMode('upload', 'hang');
    const h = await core(LINE, 'publishItem', 'u_mgr', req, { YEMOT_TIMEOUT_MS: '300' });
    assert.equal(h.error.details.reason, 'yemot-uncertain');
    const x = await readDoc(env, 'yemot_items/' + req.requestId); assert.equal(x.uncertain, true);
    M.setMode('upload', 'ok');
    const ok = await call('publishLineItem', 'u_mgr', req);
    assert.equal(ok.status, 'OK', ok.text); assert.equal(ok.result.path, x.path, 'ניסיון חוזר – אותו נתיב');
    const n = M.calls('UploadFile').length;
    const d = await call('publishLineItem', 'u_mgr', req);
    assert.equal(d.result.duplicate, true); assert.equal(M.calls('UploadFile').length, n);
    assert.equal(names('4').filter((q) => q.endsWith('.wav')).length, 1);
  });

  it('ש4 getLineState: אורך הקלטה לכל שלוחה (פתיחה 60) ו-canRecord לפי תפקיד', async () => {
    const e = await call('getLineState', 'u_emp', {});
    assert.deepEqual(e.result.limits.recordSecBySlot, { recipes: 120, promos: 120, updates: 120, hours: 120, opening: 60 });
    assert.deepEqual(e.result.limits.canRecord, { recipes: true, promos: true, updates: true, hours: false, opening: false });
    const m = await call('getLineState', 'u_mgr', {});
    assert.deepEqual(m.result.limits.canRecord, { recipes: true, promos: true, updates: true, hours: true, opening: true });
    assert.equal(M.state.requests.length, 0);
  });

  it('ש4 פתיחה – גיבוי לפני החלפה: רשומה ישנה בלי שמע שמור ← DownloadFile ← Storage ← רק אז העלאה; הקודמת replaced עם removedAt ו-audioPath', async () => {
    await bucket().deleteFiles({ prefix: 'line_audio/' });
    const prevAudio = wav(2);
    const prevId = await oldAppOpening(prevAudio);
    const b = wav(3);
    const r = await core(LINE, 'publishItem', 'u_mgr', recItem('opening', 3, { audio: audio(b) }));
    assert.equal(r.status, 'OK', r.text); assert.deepEqual(r.result.backedUp, [prevId]); assert.equal(r.result.replaced, 'M1000.wav');
    const cmds = M.state.requests.map((q) => q.cmd);
    assert.ok(cmds.indexOf('DownloadFile') >= 0 && cmds.indexOf('DownloadFile') < cmds.indexOf('UploadFile'), cmds.join(','));
    const dl = M.calls('DownloadFile')[0];
    assert.equal(dl.body.path, 'ivr2:/M1000.wav'); assert.equal(dl.auth, SECRET); assert.ok(!dl.url.includes(SECRET)); assert.ok(!JSON.stringify(dl.body).includes(SECRET));
    const prev = await readDoc(env, 'yemot_items/' + prevId);
    assert.equal(prev.status, 'replaced'); assert.ok(prev.removedAt); assert.equal(prev.audioPath, `line_audio/items/${prevId}.wav`); assert.equal(prev.audioBytes, prevAudio.length);
    assert.equal(prev.text, 'פתיחה קודמת', 'הרשומה הקודמת לא נמחקה ולא שינתה תוכן');
    assert.ok((await stored(prev.audioPath)).equals(prevAudio), 'הגיבוי = הקובץ שהיה בקו');
    assert.ok(dir('').get('M1000.wav').equals(b)); assert.equal(dir('').get('ext.ini'), 'type=menu');
    // החלפה נוספת: לפתיחה הנוכחית כבר יש שמע שמור ← בלי הורדה מהקו
    M.state.requests = [];
    const again = await core(LINE, 'publishItem', 'u_mgr', recItem('opening', 1));
    assert.equal(again.status, 'OK', again.text); assert.deepEqual(again.result.backedUp, []); assert.equal(M.calls('DownloadFile').length, 0);
  });

  it('ש4 פתיחה – אין גיבוי אפשרי ← backup-failed, שום דבר לא הוחלף (404, ריק, JSON, גודל לא תואם, לא WAV, פסק זמן, כשל Storage); ניסיון חוזר מצליח', async () => {
    const voice = require('../functions/lib/voice');
    const scenarios = [
      ['404', {}], ['empty', {}], ['json', {}], ['short', {}], ['http500', {}], ['hang', { YEMOT_TIMEOUT_MS: '300' }], ['not-wav', {}], ['store', {}],
    ];
    for (const [mode, envPatch] of scenarios) {
      M.reset();
      const prevAudio = mode === 'not-wav' ? Buffer.from('<html>error</html>') : wav(2);
      const prevId = await oldAppOpening(prevAudio);
      if (!['not-wav', 'store'].includes(mode)) M.setMode('download', mode);
      if (mode === 'store') voice._test.setLineStore(failingStore);
      const req = recItem('opening', 1);
      let r;
      try { r = await core(LINE, 'publishItem', 'u_mgr', req, envPatch); } finally { voice._test.setLineStore(null); }
      assert.equal(r.error && r.error.details.reason, 'backup-failed', mode + ' ' + r.text); assert.equal(r.status, 'UNAVAILABLE');
      assert.match(r.error.message, /שום דבר לא נמחק ולא הוחלף/);
      assert.ok(dir('').get('M1000.wav').equals(prevAudio), mode + ': הפתיחה בקו לא השתנתה');
      assert.equal(M.calls('UploadFile').length + M.calls('UploadTextFile').length + M.calls('FileAction').length, 0, mode);
      const prev = await readDoc(env, 'yemot_items/' + prevId);
      assert.equal(prev.status, 'live', mode); assert.equal(prev.audioPath, undefined, mode);
      const mine = await readDoc(env, 'yemot_items/' + req.requestId);
      assert.equal(mine.status, 'failed'); assert.equal(mine.error, 'backup-failed'); assert.equal(mine.lockAt, null);
      assert.equal((await readDoc(env, 'yemot_state/structure')).lockAt, null, 'נעילת הפתיחה שוחררה');
      await writeDoc(env, 'yemot_items/' + prevId, Object.assign(prev, { status: 'replaced' })); // ניקוי לתרחיש הבא
    }
    // ניסיון חוזר באותו requestId אחרי שההורדה חזרה לעבוד
    M.reset();
    const prevId = await oldAppOpening(wav(2));
    M.setMode('download', '404');
    const req = recItem('opening', 1);
    assert.equal((await core(LINE, 'publishItem', 'u_mgr', req)).error.details.reason, 'backup-failed');
    M.setMode('download', 'ok');
    const ok = await core(LINE, 'publishItem', 'u_mgr', req);
    assert.equal(ok.status, 'OK', ok.text); assert.deepEqual(ok.result.backedUp, [prevId]);
  });

  it('ש4 פתיחה – החלפה בטקסט לנתיב אחר (קול ממוחשב) מתנהגת כמו היום: בלי הורדה ובלי חסימה; פתיחה קודמת בטקסט – בלי הורדה; קובץ ותיק בלי רשומה – opening-legacy-file כמו קודם', async () => {
    const prevId = await oldAppOpening(wav(2));
    M.setMode('download', '404'); // גם אם ההורדה לא עובדת – החלפה בטקסט לא נחסמת (סבב תיקון 1, ליקוי 3)
    const t = await call('publishLineItem', 'u_mgr', item('opening', { text: 'פתיחה חדשה בטקסט' }));
    assert.equal(t.status, 'OK', t.text); assert.deepEqual(t.result.backedUp, []);
    assert.equal(M.calls('DownloadFile').length, 0, 'בלי הורדה מהקו');
    assert.ok(!dir('').has('M1000.wav'), 'כמו היום: הקודמת (שלנו) נמחקת אחרי ההעלאה'); assert.ok(dir('').has('M1000.tts'));
    assert.equal((await readDoc(env, 'yemot_items/' + prevId)).status, 'replaced');
    // עכשיו הפתיחה בטקסט: הקלטה חדשה לא צריכה הורדה
    M.state.requests = [];
    const r = await call('publishLineItem', 'u_mgr', recItem('opening', 1));
    assert.equal(r.status, 'OK', r.text); assert.equal(M.calls('DownloadFile').length, 0); assert.ok(!dir('').has('M1000.tts'));
    // קובץ ותיק בלי רשומה: ההגנה הקיימת
    await H.seed(env); M.reset();
    const l = await call('publishLineItem', 'u_mgr', recItem('opening', 1));
    assert.equal(l.error.details.reason, 'opening-legacy-file'); assert.equal(dir('').get('M1000.wav'), 'פתיחה מוקלטת');
    assert.equal(M.calls('DownloadFile').length, 0); assert.equal(M.calls('UploadFile').length, 0);
  });

  it('ש4 פתיחה – כשל העלאה אחרי גיבוי מוצלח: yemot-upload-failed, הקודמת נשארת בקו (live) עם הגיבוי; ניסיון חוזר מצליח בלי הורדה נוספת', async () => {
    await bucket().deleteFiles({ prefix: 'line_audio/' });
    const prevAudio = wav(2);
    const prevId = await oldAppOpening(prevAudio);
    for (const mode of ['error', 'http500']) {
      M.setMode('upload', mode);
      M.state.requests = [];
      const req = recItem('opening', 1);
      const f = await core(LINE, 'publishItem', 'u_mgr', req);
      assert.equal(f.error && f.error.details.reason, 'yemot-upload-failed', mode + ' ' + f.text);
      assert.ok(dir('').get('M1000.wav').equals(prevAudio), mode + ': הפתיחה בקו לא השתנתה');
      assert.equal(M.calls('FileAction').length, 0);
      const prev = await readDoc(env, 'yemot_items/' + prevId);
      assert.equal(prev.status, 'live'); assert.equal(prev.audioPath, `line_audio/items/${prevId}.wav`);
      assert.ok((await stored(prev.audioPath)).equals(prevAudio), 'הגיבוי = הקובץ שבקו');
      assert.equal(M.calls('DownloadFile').length, mode === 'error' ? 1 : 0, 'בפעם השנייה כבר יש עותק – בלי הורדה');
      assert.equal((await readDoc(env, 'yemot_items/' + req.requestId)).status, 'failed');
      assert.equal((await readDoc(env, 'yemot_state/structure')).lockAt, null);
      if (mode === 'http500') {
        M.setMode('upload', 'ok'); M.state.requests = [];
        const ok = await core(LINE, 'publishItem', 'u_mgr', req);
        assert.equal(ok.status, 'OK', ok.text); assert.equal(M.calls('DownloadFile').length, 0); assert.deepEqual(ok.result.backedUp, []);
        assert.equal((await readDoc(env, 'yemot_items/' + prevId)).status, 'replaced');
      }
    }
  });

  it('ש4 מבצע – מפתחות rec_/rst_ שמורים: נוסח טקסט אליהם נדחה (bad-promo-key) בלי פנייה לימות; העלאה חדשה מאפסת שדות שמע ישנים', async () => {
    const r = await call('sendPromoToLine', 'u_emp', recPromo(1));
    assert.equal(r.status, 'OK', r.text);
    M.state.requests = [];
    for (const key of [r.result.promoKey, 'rec_' + rid(), 'rst_' + rid()]) {
      for (const uid of ['u_emp', 'u_mgr']) {
        const t = await call('sendPromoToLine', uid, promo({ promoKey: key }));
        assert.equal(t.error && t.error.details.reason, 'bad-promo-key', key);
      }
    }
    assert.equal(M.state.requests.length, 0);
    const rec = await readDoc(env, 'yemot_promos/' + r.result.promoKey);
    assert.equal(rec.kind, 'audio'); assert.equal(rec.status, 'live');
    // מבצע טקסט עם עותק שמע ישן (למשל מקול משוכפל קודם): נוסח חדש בקול הממוחשב – העותק הישן מתאפס
    const p = promo();
    assert.equal((await call('sendPromoToLine', 'u_mgr', p)).status, 'OK');
    const ref = 'yemot_promos/' + p.promoKey;
    await writeDoc(env, ref, Object.assign(await readDoc(env, ref), { kind: 'audio', audioPath: `line_audio/promos/${p.promoKey}.mp3`, audioMime: 'audio/mpeg', audioBytes: 123, audioSavedAt: '2026-11-01T00:00:00.000Z', audioError: 'save-failed' }));
    const p2 = await call('sendPromoToLine', 'u_mgr', Object.assign({}, p, { requestId: rid(), text: 'נוסח אחר לגמרי' }));
    assert.equal(p2.status, 'OK', p2.text); assert.equal(p2.result.action, 'replaced');
    const after = await readDoc(env, ref);
    for (const f of ['kind', 'audioPath', 'audioMime', 'audioBytes', 'audioSavedAt', 'audioError']) assert.equal(after[f], null, f);
    assert.equal(after.text, 'נוסח אחר לגמרי');
  });

  // ================= משימה 2026-11-04, שלב 5: רשימת הקו, האזנה, הורדה, הארכה, החזרה, שמירת שמע =================
  const BOARD = '../functions/yemot-board.js';
  const dayAt = (day, hhmmZ) => `${day}T${hhmmZ || '10:00'}:00.000Z`; // 10:00Z = 12:00/13:00 בישראל – אותו יום
  const yemotCalls = () => M.state.requests.length;
  // רשומה של האפליקציה ישירות במסד (מצב "בקו" או "ירד")
  async function itemDoc(slot, extra) {
    const id = 'it5_' + rid();
    const ext = { recipes: '1', updates: '3', hours: '4', opening: '' }[slot];
    await writeDoc(env, 'yemot_items/' + id, Object.assign({ slot, ext, kind: 'text', text: 'נוסח ' + slot, spoken: 'נוסח ' + slot, title: 'כותרת ' + slot, engine: 'yemot-tts', status: 'live',
      file: null, path: null, createdAt: dayAt(israelDay()), updatedAt: dayAt(israelDay()), byUid: 'u_mgr', byRole: 'manager', temporary: false, until: null }, extra || {}));
    return id;
  }
  async function promoDoc(extra) {
    const id = 'pk_' + rid();
    await writeDoc(env, 'yemot_promos/' + id, Object.assign({ status: 'live', text: 'מבצע ישן', spoken: 'מבצע ישן', until: addDays(israelDay(), 3), file: null, path: null, withTzintuk: false, tzintuk: 'skipped',
      byUid: 'u_mgr', byRole: 'manager', createdAt: dayAt(israelDay()), updatedAt: dayAt(israelDay()) }, extra || {}));
    return id;
  }
  const B = () => require(BOARD)._core;

  it('ש5 מטריצת הרשאות: עובד נדחה בכל הורדה/הארכה/החזרה, ברשימה ובהאזנה של שלוחה 4 ופתיחה – בלי שום פנייה לימות; אורח/מושבת נדחים בכל הפונקציות', async () => {
    const hid = await itemDoc('hours', { file: '001.tts', path: 'ivr2:4/001.tts' });
    const oid = await itemDoc('opening', { file: 'M1000.tts', path: 'ivr2:/M1000.tts' });
    const rid0 = await itemDoc('recipes', { status: 'removed', removedAt: dayAt(israelDay()), file: '001.tts', path: 'ivr2:1/001.tts' });
    const pk = await promoDoc({ file: '001.tts', path: 'ivr2:2/001.tts' });
    const denied = [
      ['getLineBoard', { slot: 'hours' }, 'slot-manager-only'], ['getLineBoard', { slot: 'opening' }, 'slot-manager-only'],
      ['getLineAudio', { ref: { kind: 'item', id: hid } }, 'slot-manager-only'], ['getLineAudio', { ref: { kind: 'item', id: oid } }, 'slot-manager-only'],
      ['getLineAudio', { ref: { kind: 'file', ext: '4', file: '000.tts' } }, 'slot-manager-only'], ['getLineAudio', { ref: { kind: 'file', ext: '', file: 'M1000.wav' } }, 'slot-manager-only'],
    ];
    for (const ext of ['1', '2', '3', '4']) denied.push(['removeLineItem', { requestId: rid(), ext, file: '000.tts' }, 'manager-only']);
    denied.push(['removeLineItem', { requestId: rid(), promoKey: pk }, 'manager-only'], ['removeLineItem', { requestId: rid(), id: hid }, 'manager-only'], ['removeLineItem', { requestId: rid(), id: oid }, 'manager-only']);
    for (const [kind, id] of [['promo', pk], ['item', hid], ['item', oid], ['item', rid0]]) denied.push(['extendLineItem', { requestId: rid(), kind, id, until: addDays(israelDay(), 5) }, 'manager-only']);
    for (const [kind, id, until] of [['item', rid0], ['promo', pk, addDays(israelDay(), 2)], ['item', hid], ['item', oid], ['backup', '20261104-101010-abcdef']]) denied.push(['restoreLineItem', { requestId: rid(), kind, id, until }, 'manager-only']);
    for (const [fn, data, reason] of denied) {
      const r = await call(fn, 'u_emp', data);
      assert.equal(r.status, 'PERMISSION_DENIED', fn + JSON.stringify(data) + r.text); assert.equal(r.error.details.reason, reason, fn); assert.match(r.error.message, HEB);
    }
    assert.equal(yemotCalls(), 0, 'עובד שנדחה – בלי פנייה לימות');
    for (const role of ['guest', 'signedIn', 'disabledEmployee']) {
      for (const [fn, data] of [['getLineBoard', { slot: 'recipes' }], ['getLineAudio', { ref: { kind: 'item', id: rid0 } }], ['extendLineItem', { requestId: rid(), kind: 'promo', id: pk, until: addDays(israelDay(), 5) }], ['restoreLineItem', { requestId: rid(), kind: 'item', id: rid0 }]]) {
        const r = await call(fn, H.UID[role], data);
        assert.equal(r.status, role === 'guest' ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED', role + fn); assert.match(r.error.message, HEB);
      }
    }
    assert.equal(yemotCalls(), 0);
    // מה שמותר לעובד: רשימות 1–3 והאזנה בהן (בלי כפתורי ניהול)
    for (const slot of ['recipes', 'promos', 'updates']) {
      const r = await call('getLineBoard', 'u_emp', { slot });
      assert.equal(r.status, 'OK', slot + r.text); assert.equal(r.result.canManage, false);
      for (const e of r.result.onLine) assert.deepEqual(e.actions, { remove: false, extend: false });
      for (const e of r.result.recent) assert.equal(e.restore.allowed, false);
    }
    const a = await call('getLineAudio', 'u_emp', { ref: { kind: 'item', id: rid0 } });
    assert.equal(a.status, 'OK', a.text); assert.equal(a.result.mode, 'text');
    assert.equal(await readDoc(env, 'yemot_promos/' + pk).then((x) => x.status), 'live', 'שום דבר לא השתנה');
  });

  it('ש5 getLineBoard: מה שבקו בפועל (מהגבוה לנמוך), "מהאפליקציה"/"קובץ ותיק", בלי ext.ini, M* ותיקיות; פתיחה – רק M1000.*; missing; ירדו ב-7 ימים (שעון ישראל), רשומה ישנה = אין שמע שמור', async () => {
    const today = israelDay();
    dir('1').set('ext.ini', 'type=playfile'); dir('1').set('M0001.wav', 'x'); dir('1').set('001.tts', 'מתכון א'); dir('1').set('002.wav', wav(1));
    const a = await itemDoc('recipes', { file: '001.tts', path: 'ivr2:1/001.tts' });
    const gone = await itemDoc('recipes', { file: '005.tts', path: 'ivr2:1/005.tts' }); // בקו לפי המסד, אבל לא בתיקייה
    const d6 = await itemDoc('recipes', { status: 'removed', removedAt: dayAt(addDays(today, -6)), removedBy: 'u_mgr' }); // יום 6 אחורה – כן
    const d7 = await itemDoc('recipes', { status: 'removed', removedAt: dayAt(addDays(today, -7)) }); // יום 7 אחורה – לא
    const rep = await itemDoc('recipes', { status: 'replaced', updatedAt: dayAt(addDays(today, -1)) }); // ישנה: replaced בלי removedAt ← updatedAt
    const m = await call('getLineBoard', 'u_mgr', { slot: 'recipes' });
    assert.equal(m.status, 'OK', m.text);
    assert.deepEqual(m.result.onLine.map((e) => [e.file, e.origin]), [['002.wav', 'legacy'], ['001.tts', 'app'], ['000.tts', 'legacy']]);
    const [w, t, l] = m.result.onLine;
    assert.equal(t.ref.kind, 'item'); assert.equal(t.ref.id, a); assert.equal(t.listen, 'text'); assert.deepEqual(t.actions, { remove: true, extend: false });
    assert.equal(w.listen, 'line'); assert.equal(w.kind, 'audio'); assert.deepEqual(w.ref, { kind: 'file', ext: '1', file: '002.wav' }); assert.equal(l.listen, 'text'); assert.equal(l.actions.remove, true);
    assert.deepEqual(m.result.missing.map((x) => x.ref.id), [gone]);
    assert.deepEqual(m.result.recent.map((x) => x.ref.id).sort(), [d6, rep].sort(), 'יום 7 אחורה לא מופיע');
    const r6 = m.result.recent.find((x) => x.ref.id === d6);
    assert.equal(r6.hasSavedAudio, false); assert.equal(r6.downReason, 'removed'); assert.deepEqual(r6.restore, { allowed: true, needsUntil: false, costNote: false });
    assert.equal(m.result.recent.find((x) => x.ref.id === rep).downReason, 'replaced');
    assert.ok(!m.result.recent.some((x) => x.ref.id === d7));
    assert.deepEqual(M.calls('GetIVR2Dir').map((q) => q.body.path), ['1']);
    // פתיחה: רק M1000.* מהשורש (לא ext.ini, לא BACKUP_*)
    dir('').set('BACKUP_M1000.wav', 'x');
    const o = await call('getLineBoard', 'u_mgr', { slot: 'opening' });
    assert.deepEqual(o.result.onLine.map((e) => [e.file, e.origin, e.actions.remove]), [['M1000.wav', 'legacy', false]]);
    assert.equal(M.calls('GetIVR2Dir')[1].body.path, '/');
    // מבצעים: ירד מהאפליקציה / בלילה; קובץ 001 ותיק
    const pr = await promoDoc({ status: 'removed', removedAt: dayAt(addDays(today, -2)), removedVia: 'app' });
    const pe = await promoDoc({ status: 'removed', removedAt: dayAt(today), kind: null });
    const p = await call('getLineBoard', 'u_mgr', { slot: 'promos' });
    assert.equal(p.status, 'OK', p.text);
    assert.deepEqual(p.result.onLine.map((e) => [e.file, e.origin]), [['000.tts', 'legacy']]);
    assert.deepEqual(p.result.recent.map((x) => [x.ref.id, x.downReason, x.kind, x.restore.needsUntil]), [[pe, 'expired', 'text', true], [pr, 'removed', 'text', true]]);
  });

  it('ש5 getLineBoard – מטמון: קריאה שנייה בלי פנייה לימות; שינוי במסד (העלאה) ← קריאה מחדש; רענון לא יותר מפעם ב-15 שניות; כשל עם מטמון ← stale, בלי מטמון ← yemot-list-failed בלי המפתח', async () => {
    const r1 = await call('getLineBoard', 'u_emp', { slot: 'updates' });
    assert.equal(r1.status, 'OK'); assert.equal(r1.result.cached, false);
    const r2 = await call('getLineBoard', 'u_emp', { slot: 'updates' });
    assert.equal(r2.result.cached, true); assert.equal(M.calls('GetIVR2Dir').length, 1);
    const r3 = await call('getLineBoard', 'u_emp', { slot: 'updates', refresh: true });
    assert.equal(r3.result.cached, true, 'רענון מיד אחרי קריאה – מהמטמון'); assert.equal(M.calls('GetIVR2Dir').length, 1);
    const up = await call('publishLineItem', 'u_emp', item('updates'));
    assert.equal(up.status, 'OK');
    const n = M.calls('GetIVR2Dir').length;
    const r4 = await call('getLineBoard', 'u_emp', { slot: 'updates' });
    assert.equal(r4.result.cached, false); assert.equal(M.calls('GetIVR2Dir').length, n + 1);
    assert.ok(r4.result.onLine.some((e) => e.ref.id === up.result.id), 'ההודעה החדשה ברשימה');
    // מטמון ישן מ-3 דקות + כשל בקו ← מחזירים את הישן עם stale
    const c = await readDoc(env, 'yemot_state/board-updates');
    await writeDoc(env, 'yemot_state/board-updates', Object.assign(c, { fetchedAt: new Date(Date.now() - 180000).toISOString() }));
    M.setMode('dir', 'error');
    const r5 = await call('getLineBoard', 'u_emp', { slot: 'updates' });
    assert.equal(r5.status, 'OK', r5.text); assert.equal(r5.result.stale, true); assert.equal(r5.result.cached, true);
    const r6 = await call('getLineBoard', 'u_mgr', { slot: 'hours' });
    assert.equal(r6.error.details.reason, 'yemot-list-failed'); assert.match(r6.error.message, HEB); assert.ok(!r6.text.includes(SECRET));
    for (const bad of [{ slot: 'x' }, { slot: 'constructor' }, {}, { slot: 'recipes', refresh: 'yes' }]) {
      const r = await call('getLineBoard', 'u_mgr', bad); assert.ok(['bad-slot', 'bad-input'].includes(r.error.details.reason), JSON.stringify(bad));
    }
  });

  it('ש5 getLineAudio: שמע שמור ← מ-Storage; נוסח ← הקראה בטלפון (קירוב); הקלטה ותיקה ← מהקו (נספר, מכסה 60 ביום); tts ותיק ← GetTextFile; כשל ← listen-unavailable; Storage נופל ← נוסח', async () => {
    const b = wav(1.5);
    const rec = await call('publishLineItem', 'u_emp', recItem('recipes', 1.5, { audio: audio(b) }));
    const s = await call('getLineAudio', 'u_emp', { ref: { kind: 'item', id: rec.result.id } });
    assert.equal(s.status, 'OK', s.text); assert.equal(s.result.mode, 'audio'); assert.equal(s.result.source, 'saved'); assert.ok(Buffer.from(s.result.data, 'base64').equals(b));
    const tx = await itemDoc('updates', { text: 'עדכון‏ חשוב' });
    const t = await call('getLineAudio', 'u_emp', { ref: { kind: 'item', id: tx } });
    assert.deepEqual(t.result, { ok: true, mode: 'text', text: 'עדכון חשוב', approx: true });
    M.state.requests = [];
    const lw = wav(1); dir('3').set('007.wav', lw);
    const l = await call('getLineAudio', 'u_emp', { ref: { kind: 'file', ext: '3', file: '007.wav' } });
    assert.equal(l.result.source, 'line'); assert.ok(Buffer.from(l.result.data, 'base64').equals(lw));
    assert.equal(M.calls('DownloadFile')[0].auth, SECRET); assert.ok(!l.text.includes(SECRET));
    const lt = await call('getLineAudio', 'u_emp', { ref: { kind: 'file', ext: '1', file: '000.tts' } });
    assert.equal(lt.result.mode, 'text'); assert.equal(lt.result.text, 'מתכון ותיק');
    assert.equal((await readDoc(env, 'yemot_state/listen-u_emp')).count, 2);
    // הקלטה ישנה בלי עותק, שעדיין בקו ← מהקו
    dir('3').set('008.wav', wav(1));
    const old = await itemDoc('updates', { kind: 'audio', text: null, engine: 'recording', file: '008.wav', path: 'ivr2:3/008.wav' });
    assert.equal((await call('getLineAudio', 'u_mgr', { ref: { kind: 'item', id: old } })).result.source, 'line');
    // אותה הקלטה אחרי שירדה ← לא מורידים מהקו (הנתיב אולי שייך עכשיו למשהו אחר)
    const oldDown = await itemDoc('updates', { kind: 'audio', text: null, engine: 'recording', file: '008.wav', path: 'ivr2:3/008.wav', status: 'removed', removedAt: dayAt(israelDay()) });
    const n = M.calls('DownloadFile').length;
    assert.equal((await call('getLineAudio', 'u_mgr', { ref: { kind: 'item', id: oldDown } })).error.details.reason, 'listen-unavailable'); assert.equal(M.calls('DownloadFile').length, n);
    // מכסה יומית
    await writeDoc(env, 'yemot_state/listen-u_emp', { day: israelDay(), count: 60 });
    const lim = await call('getLineAudio', 'u_emp', { ref: { kind: 'file', ext: '3', file: '007.wav' } });
    assert.equal(lim.error.details.reason, 'listen-limit'); assert.match(lim.error.message, HEB);
    assert.equal((await call('getLineAudio', 'u_emp', { ref: { kind: 'item', id: rec.result.id } })).status, 'OK', 'שמע שמור – בלי מכסה');
    M.setMode('download', '404');
    const f = await call('getLineAudio', 'u_mgr', { ref: { kind: 'file', ext: '3', file: '007.wav' } });
    assert.equal(f.error.details.reason, 'listen-unavailable'); assert.match(f.error.message, HEB);
    for (const ref of [{ kind: 'file', ext: '4', file: 'ext.ini' }, { kind: 'file', ext: '', file: 'M1001.wav' }, { kind: 'file', ext: '5', file: '000.tts' }, { kind: 'file', ext: '1', file: '../x.wav' }]) {
      assert.equal((await call('getLineAudio', 'u_mgr', { ref })).error.details.reason, 'bad-file', JSON.stringify(ref));
    }
    assert.equal((await call('getLineAudio', 'u_mgr', { ref: { kind: 'item', id: 'nope_nope_1' } })).error.details.reason, 'item-not-found');
    // Storage נופל: פריט עם נוסח ועותק ← נוסח
    const voice = require('../functions/lib/voice');
    const both = await itemDoc('recipes', { audioPath: `line_audio/items/x${rid()}.mp3`, audioMime: 'audio/mpeg' });
    voice._test.setLineStore({ async get() { throw new Error('down'); } });
    try { const r = await core(BOARD, 'listen', 'u_mgr', { ref: { kind: 'item', id: both } }); assert.equal(r.result.mode, 'text', r.text); } finally { voice._test.setLineStore(null); }
  });

  it('ש5 הורדת מבצע באמצע (מנהל): מחיקה בנתיב שלו בלבד, removed + removedVia/removedBy, הרשומה נשמרת; כפולה ← duplicate; נעול ← busy; pending ← item-uncertain; כשל ← remove-failed וניסיון חוזר; path-reused לא נמחק', async () => {
    const s = await call('sendPromoToLine', 'u_mgr', promo());
    assert.equal(s.result.file, '001.tts');
    M.state.requests = [];
    const req = { requestId: rid(), promoKey: s.result.promoKey };
    const r = await call('removeLineItem', 'u_mgr', req);
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.removed, true); assert.match(r.result.message, HEB);
    assert.deepEqual(M.calls('FileAction').map((q) => q.body), [{ action: 'delete', what: 'ivr2:2/001.tts' }]);
    assert.deepEqual(names('2'), ['000.tts'], '001.tts הוותיק לא נגע');
    const x = await readDoc(env, 'yemot_promos/' + s.result.promoKey);
    assert.equal(x.status, 'removed'); assert.equal(x.removedVia, 'app'); assert.equal(x.removedBy, 'u_mgr'); assert.ok(x.removedAt); assert.equal(x.text, 'בדיקה: מבצע דמה ב-10 שקלים'); assert.equal(x.lockAt, null);
    const d = await call('removeLineItem', 'u_mgr', req);
    assert.equal(d.result.duplicate, true); assert.equal(M.calls('FileAction').length, 1);
    // נעול / pending
    const pk1 = await promoDoc({ file: '003.tts', path: 'ivr2:2/003.tts', lockAt: new Date().toISOString(), lockReq: 'other_req_1' });
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), promoKey: pk1 })).error.details.reason, 'busy');
    const pk2 = await promoDoc({ file: '004.tts', path: 'ivr2:2/004.tts', pending: { text: 'x', until: israelDay(), at: new Date().toISOString() } });
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), promoKey: pk2 })).error.details.reason, 'item-uncertain');
    // נתיב לא בטוח (000 / שלוחה אחרת) – לא נמחק
    const pk3 = await promoDoc({ file: '000.tts', path: 'ivr2:2/000.tts' });
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), promoKey: pk3 })).error.details.reason, 'item-not-found');
    assert.ok(dir('2').has('000.tts'));
    // כשל במחיקה ← remove-failed; ניסיון חוזר מצליח
    dir('2').set('006.tts', 'מבצע'); const pk4 = await promoDoc({ file: '006.tts', path: 'ivr2:2/006.tts' });
    M.setMode('delete', 'error');
    const f = await call('removeLineItem', 'u_mgr', { requestId: rid(), promoKey: pk4 });
    assert.equal(f.error.details.reason, 'yemot-remove-failed'); assert.ok(!f.text.includes(SECRET));
    assert.equal((await readDoc(env, 'yemot_promos/' + pk4)).status, 'remove-failed'); assert.ok(dir('2').has('006.tts'));
    M.setMode('delete', 'ok');
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), promoKey: pk4 })).status, 'OK'); assert.ok(!dir('2').has('006.tts'));
    // path-reused: מבצע אחר (בתוקף) מחזיק את אותו נתיב ← הקובץ נשאר
    dir('2').set('009.tts', 'חדש'); const pOld = await promoDoc({ file: '009.tts', path: 'ivr2:2/009.tts' }); const pNew = await promoDoc({ file: '009.tts', path: 'ivr2:2/009.tts' });
    const pr = await call('removeLineItem', 'u_mgr', { requestId: rid(), promoKey: pOld });
    assert.equal(pr.status, 'OK'); assert.ok(dir('2').has('009.tts')); assert.equal((await readDoc(env, 'yemot_promos/' + pOld)).error, 'path-reused');
    assert.equal((await readDoc(env, 'yemot_promos/' + pNew)).status, 'live');
  });

  it('ש5 הורדת קובץ ותיק בשלוחות 1–4: גיבוי חובה (טקסט / שמע) ← yemot_line_backups complete ← רק אז מחיקה (applied); כשל גיבוי ← backup-failed ושום דבר לא נמחק; ניסיון חוזר משתמש באותו גיבוי', async () => {
    for (const ext of ['1', '2', '3', '4']) {
      M.state.requests = [];
      const before = dir(ext).get('000.tts');
      const r = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext, file: '000.tts' });
      assert.equal(r.status, 'OK', ext + r.text); assert.match(r.result.backupId, /^\d{8}-\d{6}-[A-Za-z0-9]{1,6}$/);
      const cmds = M.state.requests.map((q) => q.cmd);
      assert.ok(cmds.indexOf('GetTextFile') >= 0 && cmds.indexOf('GetTextFile') < cmds.indexOf('FileAction'), cmds.join(','));
      assert.deepEqual(M.calls('FileAction').map((q) => q.body.what), [`ivr2:${ext}/000.tts`]);
      const bk = await readDoc(env, 'yemot_line_backups/' + r.result.backupId);
      assert.equal(bk.status, 'complete'); assert.equal(bk.result, 'applied'); assert.equal(bk.text, before); assert.equal(bk.kind, 'text'); assert.equal(bk.path, `ivr2:${ext}/000.tts`); assert.equal(bk.reason, 'file');
      assert.ok(!dir(ext).has('000.tts'));
    }
    // ב"ירדו בשבוע האחרון"
    const b1 = await call('getLineBoard', 'u_mgr', { slot: 'recipes' });
    assert.equal(b1.result.recent[0].ref.kind, 'backup'); assert.equal(b1.result.recent[0].downReason, 'legacy-removed'); assert.equal(b1.result.recent[0].restore.allowed, true);
    // שמע ותיק ← עותק ב-Storage, זהה
    const lw = wav(1); dir('3').set('000.wav', lw);
    const w = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '3', file: '000.wav' });
    assert.equal(w.status, 'OK', w.text);
    const wb = await readDoc(env, 'yemot_line_backups/' + w.result.backupId);
    assert.equal(wb.storagePath, `line_audio/backups/${w.result.backupId}.wav`); assert.ok((await stored(wb.storagePath)).equals(lw));
    // כשלי גיבוי: לא נמחק כלום
    const cases = [['download', '404', '010.wav', wav(1)], ['download', 'short', '011.wav', wav(1)], ['download', 'ok', '012.wav', Buffer.from('<html>err</html>')]];
    for (const [cmd, mode, file, content] of cases) {
      M.reset(); dir('4').set(file, content); M.setMode(cmd, mode);
      const f = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '4', file });
      assert.equal(f.error && f.error.details.reason, 'backup-failed', mode + f.text); assert.equal(f.status, 'UNAVAILABLE'); assert.match(f.error.message, /שום דבר לא נמחק/);
      assert.equal(M.calls('FileAction').length, 0); assert.ok(dir('4').has(file));
    }
    M.reset(); M.setMode('text', 'error'); M.setMode('download', '404');
    const ft = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '1', file: '000.tts' });
    assert.equal(ft.error.details.reason, 'backup-failed'); assert.equal(M.calls('FileAction').length, 0); assert.ok(dir('1').has('000.tts'));
    // GetTextFile לא עובד, אבל DownloadFile כן ← גיבוי מהורדה
    M.reset(); M.setMode('text', 'nocontents');
    const fb = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '1', file: '000.tts' });
    assert.equal(fb.status, 'OK', fb.text); assert.equal((await readDoc(env, 'yemot_line_backups/' + fb.result.backupId)).text, 'מתכון ותיק');
    // כשל במחיקה אחרי גיבוי ← not-applied; ניסיון חוזר באותו requestId – אותו גיבוי, בלי הורדה נוספת
    M.reset(); M.setMode('delete', 'error');
    const req = { requestId: rid(), ext: '3', file: '000.tts' };
    const df = await call('removeLineItem', 'u_mgr', req);
    assert.equal(df.error.details.reason, 'yemot-remove-failed');
    const bks = (await allDocs(env, ['yemot_line_backups'])).filter((q) => q.data.opId === req.requestId);
    assert.equal(bks.length, 1); assert.equal(bks[0].data.result, 'not-applied');
    M.setMode('delete', 'ok'); M.state.requests = [];
    const ok = await call('removeLineItem', 'u_mgr', req);
    assert.equal(ok.status, 'OK', ok.text); assert.equal(ok.result.backupId, bks[0].id); assert.equal(M.calls('GetTextFile').length, 0);
    assert.equal((await readDoc(env, 'yemot_line_backups/' + bks[0].id)).result, 'applied');
  });

  it('ש5 בטיחות נתיב: מחיקה לפי שם רק ivr2:<1-4>/NNN.tts|wav – אף פעם ext.ini, M*, שורש, תיקייה או שלוחה 5 (בלי פנייה לימות); safePath הקיים בלי שינוי', async () => {
    for (const [ext, file] of [['1', 'ext.ini'], ['2', 'M1000.wav'], ['3', 'M0001.tts'], ['', 'M1000.wav'], ['', 'ext.ini'], ['1', ''], ['1', '1'], ['1', '001.tts/'], ['1', '../4/000.tts'], ['1', '001.ini'],
      ['5', '000.tts'], ['1/2', '000.tts'], [1, '000.tts'], ['4', '000.TTS\n'], ['4', '0001.tts']]) {
      const r = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext, file });
      assert.equal(r.error && r.error.details.reason, 'bad-file', JSON.stringify([ext, file]));
    }
    assert.equal(yemotCalls(), 0);
    const { safeFilePath, safePath } = require(LINE)._core;
    assert.deepEqual(['ivr2:1/000.tts', 'ivr2:2/001.wav', 'ivr2:4/999.tts', 'ivr2:1/ext.ini', 'ivr2:/M1000.wav', 'ivr2:5/000.tts', 'ivr2:1/', 'ivr2:1/000.mp3', 'ivr2:1/2/000.tts', 'ivr2:1/000.tts\n'].map(safeFilePath),
      [true, true, true, false, false, false, false, false, false, false]);
    assert.deepEqual(['ivr2:4/000.tts', 'ivr2:1/000.tts', 'ivr2:1/001.tts', 'ivr2:/M1000.wav', 'ivr2:/M1001.wav'].map(safePath), [true, false, true, true, false]);
    // רשומה מזויפת של מבצע / פריט שמצביעה על ext.ini או על M1000 – לא נמחקת
    const pk = await promoDoc({ file: 'ext.ini', path: 'ivr2:2/ext.ini' });
    const it = await itemDoc('updates', { file: 'ext.ini', path: 'ivr2:3/ext.ini' });
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), promoKey: pk })).error.details.reason, 'item-not-found');
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), id: it })).error.details.reason, 'item-not-found');
    // העלאה לא ודאית באותו נתיב ← לא נמחק "כקובץ ותיק"
    dir('3').set('006.tts', 'אולי שלנו');
    await itemDoc('updates', { status: 'failed', uncertain: true, file: '006.tts', path: 'ivr2:3/006.tts' });
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '3', file: '006.tts' })).error.details.reason, 'item-uncertain');
    assert.equal(M.calls('FileAction').length, 0); assert.ok(dir('3').has('006.tts'));
  });

  it('ש5 הורדת הקלטה בלי עותק שמור: קודם עותק מהקו; אין עותק ← no-backup-confirm (לא נמחק), ורק עם confirmNoBackup:true – נמחקת', async () => {
    const lw = wav(1); dir('3').set('004.wav', lw);
    const id = await itemDoc('updates', { kind: 'audio', text: null, engine: 'recording', file: '004.wav', path: 'ivr2:3/004.wav' });
    const r = await call('removeLineItem', 'u_mgr', { requestId: rid(), id });
    assert.equal(r.status, 'OK', r.text);
    const x = await readDoc(env, 'yemot_items/' + id);
    assert.equal(x.status, 'removed'); assert.equal(x.audioPath, `line_audio/items/${id}.wav`); assert.ok((await stored(x.audioPath)).equals(lw));
    dir('3').set('005.wav', wav(1));
    const id2 = await itemDoc('updates', { kind: 'audio', text: null, engine: 'recording', file: '005.wav', path: 'ivr2:3/005.wav' });
    M.setMode('download', '404'); M.state.requests = [];
    const c = await call('removeLineItem', 'u_mgr', { requestId: rid(), id: id2 });
    assert.equal(c.error.details.reason, 'no-backup-confirm'); assert.match(c.error.message, /לאשר/); assert.ok(dir('3').has('005.wav'));
    assert.equal(M.calls('FileAction').length, 0);
    const y = await readDoc(env, 'yemot_items/' + id2); assert.equal(y.status, 'live'); assert.equal(y.lockAt, null);
    const ok = await call('removeLineItem', 'u_mgr', { requestId: rid(), id: id2, confirmNoBackup: true });
    assert.equal(ok.status, 'OK', ok.text); assert.ok(!dir('3').has('005.wav'));
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), id: id2, confirmNoBackup: 'yes' })).error.details.reason, 'bad-input');
  });

  it('ש5 extendLineItem: מבצע ושלוחה 4 זמנית בלבד; שינוי ברשומה בלבד (אפס פניות לימות); כפולה ← duplicate; untilHistory; בלי תוקף ← no-expiry; לא בקו ← item-not-live; תאריכים', async () => {
    const today = israelDay();
    const pk = await promoDoc({ file: '001.tts', path: 'ivr2:2/001.tts', until: today });
    const req = { requestId: rid(), kind: 'promo', id: pk, until: addDays(today, 10) };
    const r = await call('extendLineItem', 'u_mgr', req);
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.previousUntil, today); assert.equal(r.result.until, addDays(today, 10));
    assert.match(r.result.message, new RegExp(addDays(today, 10).split('-').reverse().join('/')));
    const x = await readDoc(env, 'yemot_promos/' + pk);
    assert.equal(x.until, addDays(today, 10)); assert.equal(x.extendedBy, 'u_mgr'); assert.equal(x.extendReq, req.requestId);
    assert.deepEqual(x.untilHistory.map((h) => h.until), [today]); assert.equal(x.text, 'מבצע ישן'); assert.equal(x.status, 'live');
    const d = await call('extendLineItem', 'u_mgr', req);
    assert.equal(d.result.duplicate, true); assert.equal((await readDoc(env, 'yemot_promos/' + pk)).untilHistory.length, 1);
    const short = await call('extendLineItem', 'u_mgr', { requestId: rid(), kind: 'promo', id: pk, until: addDays(today, 1) });
    assert.equal(short.status, 'OK', 'מותר גם לקצר');
    const h = await itemDoc('hours', { file: '001.tts', path: 'ivr2:4/001.tts', temporary: true, until: today });
    assert.equal((await call('extendLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: h, until: addDays(today, 5) })).status, 'OK');
    for (const [slot, extra] of [['recipes', {}], ['updates', {}], ['opening', {}], ['hours', { temporary: false }]]) {
      const id = await itemDoc(slot, extra);
      const e = await call('extendLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id, until: addDays(today, 5) });
      assert.equal(e.error.details.reason, 'no-expiry', slot); assert.match(e.error.message, HEB);
    }
    const gone = await promoDoc({ status: 'removed', removedAt: dayAt(today) });
    assert.equal((await call('extendLineItem', 'u_mgr', { requestId: rid(), kind: 'promo', id: gone, until: addDays(today, 5) })).error.details.reason, 'item-not-live');
    for (const [until, reason] of [[addDays(today, -1), 'date-past'], [addDays(today, 61), 'date-too-far'], ['2026-02-30', 'bad-date'], [undefined, 'bad-date']]) {
      assert.equal((await call('extendLineItem', 'u_mgr', { requestId: rid(), kind: 'promo', id: pk, until })).error.details.reason, reason, String(until));
    }
    assert.equal((await call('extendLineItem', 'u_mgr', { requestId: 'x', kind: 'promo', id: pk, until: today })).error.details.reason, 'bad-request-id');
    assert.equal(yemotCalls(), 0, 'הארכה לא פונה לימות');
  });

  it('ש5 ריצת הלילה לא מורידה פריט שהוארך (מבצע ושלוחה 4), ומורידה אותו אחרי התאריך החדש', async () => {
    const today = israelDay();
    const s = await call('sendPromoToLine', 'u_mgr', promo({ until: today }));
    const h = await call('publishLineItem', 'u_mgr', item('hours', { until: today }));
    assert.equal(h.status, 'OK', h.text);
    assert.equal((await call('extendLineItem', 'u_mgr', { requestId: rid(), kind: 'promo', id: s.result.promoKey, until: addDays(today, 3) })).status, 'OK');
    assert.equal((await call('extendLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: h.result.id, until: addDays(today, 3) })).status, 'OK');
    const night = (days) => require('../functions/yemot.js')._core.nightly({ now: new Date(Date.now() + days * 86400000), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000, skipCache: true });
    const o1 = await night(1);
    assert.equal(o1.promos.checked, 0, JSON.stringify(o1)); assert.equal(o1.line.checked, 0);
    assert.ok(M.state.files.has(s.result.file)); assert.ok(dir('4').has(h.result.file));
    const o2 = await night(4);
    assert.equal(o2.promos.removed, 1); assert.equal(o2.line.removed, 1);
    assert.ok(!M.state.files.has(s.result.file)); assert.ok(!dir('4').has(h.result.file));
  });

  it('ש5 restoreLineItem – הקלטה שירדה: העלאה חדשה במספר חדש (מושמעת ראשונה), אותו שמע, restoredFrom; המקורית לא השתנתה; כפולה ← duplicate; בקשה אחרת ← already-on-line; אין מחיקה ואין דריסה', async () => {
    const b = wav(2);
    const p = await call('publishLineItem', 'u_emp', recItem('recipes', 2, { audio: audio(b) }));
    assert.equal(p.result.file, '001.wav');
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), id: p.result.id })).status, 'OK');
    dir('1').set('003.tts', 'מתכון אחר'); // קובץ אחר בשלוחה
    const orig = await readDoc(env, 'yemot_items/' + p.result.id);
    const snapshot = new Map([...dir('1').entries()]);
    M.state.requests = [];
    const req = { requestId: rid(), kind: 'item', id: p.result.id };
    const r = await call('restoreLineItem', 'u_mgr', req);
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.file, '004.wav', 'מספר חדש, גבוה מכל מה שבשלוחה'); assert.deepEqual(r.result.restoredFrom, { kind: 'item', id: p.result.id });
    assert.equal(r.result.usedCost, false); assert.match(r.result.message, HEB);
    assert.ok(dir('1').get('004.wav').equals(b), 'אותו שמע');
    for (const [k, v] of snapshot) assert.ok(dir('1').get(k) === v || (Buffer.isBuffer(v) && dir('1').get(k).equals(v)), 'לא נדרס: ' + k);
    assert.equal(M.calls('FileAction').length + M.calls('RunTzintuk').length, 0, 'בלי מחיקה ובלי צינתוק');
    assert.deepEqual(await readDoc(env, 'yemot_items/' + p.result.id), orig, 'הרשומה המקורית לא השתנתה');
    const nr = await readDoc(env, 'yemot_items/' + r.result.id);
    assert.equal(nr.status, 'live'); assert.deepEqual(nr.restoredFrom, { kind: 'item', id: p.result.id }); assert.equal(nr.byUid, 'u_mgr'); assert.equal(nr.kind, 'audio');
    assert.equal(nr.audioPath, `line_audio/items/${r.result.id}.wav`, 'להחזרה יש עותק משלה');
    const d = await call('restoreLineItem', 'u_mgr', req);
    assert.equal(d.result.duplicate, true); assert.equal(M.calls('UploadFile').length, 1);
    const again = await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: p.result.id });
    assert.equal(again.error.details.reason, 'already-on-line'); assert.match(again.error.message, HEB);
    const bd = await call('getLineBoard', 'u_mgr', { slot: 'recipes' });
    const rr = bd.result.recent.find((x) => x.ref.id === p.result.id); assert.equal(rr.restore.allowed, false); assert.equal(rr.alreadyRestored, true);
    // עדיין בקו ← restore-not-down
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: r.result.id })).error.details.reason, 'restore-not-down');
  });

  it('ש5 restoreLineItem – חלון 7 ימים (שעון ישראל): יום 6 אחורה ← מותר, יום 7 ← restore-too-old; תאריך: חובה במבצע ובשלוחה 4 זמנית, אסור ב-1/3/פתיחה; בלי תוכן ← no-saved-content', async () => {
    const today = israelDay();
    const ok6 = await itemDoc('updates', { status: 'removed', removedAt: dayAt(addDays(today, -6), '21:30') }); // 23:30/00:30 בישראל – לפי שעון ישראל
    const old7 = await itemDoc('updates', { status: 'removed', removedAt: dayAt(addDays(today, -7)) });
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: old7 })).error.details.reason, 'restore-too-old');
    const day6 = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(dayAt(addDays(today, -6), '21:30')));
    const r6 = await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: ok6 });
    if (day6 >= addDays(today, -6)) assert.equal(r6.status, 'OK', r6.text); else assert.equal(r6.error.details.reason, 'restore-too-old');
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: old7, until: today })).error.details.reason, 'restore-too-old');
    const rc = await itemDoc('recipes', { status: 'removed', removedAt: dayAt(today) });
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: rc, until: addDays(today, 2) })).error.details.reason, 'bad-input');
    const ht = await itemDoc('hours', { status: 'removed', removedAt: dayAt(today), temporary: true, until: addDays(today, -1) });
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: ht })).error.details.reason, 'date-required');
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: ht, until: addDays(today, -1) })).error.details.reason, 'date-past');
    const hr = await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: ht, until: addDays(today, 2) });
    assert.equal(hr.status, 'OK', hr.text); const hn = await readDoc(env, 'yemot_items/' + hr.result.id); assert.equal(hn.temporary, true); assert.equal(hn.until, addDays(today, 2));
    const pk = await promoDoc({ status: 'removed', removedAt: dayAt(today), file: '005.tts', path: 'ivr2:2/005.tts' });
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'promo', id: pk })).error.details.reason, 'date-required');
    const empty = await itemDoc('updates', { status: 'removed', removedAt: dayAt(today), kind: 'audio', text: null, engine: 'recording' });
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: empty })).error.details.reason, 'no-saved-content');
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: 'r'.repeat(57), kind: 'item', id: rc })).error.details.reason, 'bad-request-id', 'requestId עד 56');
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: 'nope_nope_1' })).error.details.reason, 'item-not-found');
  });

  it('ש5 restoreLineItem – מבצע: promoKey rst_, מספר חדש, בלי צינתוק, תאריך חדש; ריצת הלילה מורידה אותו בתאריך החדש; המקורי לא השתנה', async () => {
    const today = israelDay();
    const s = await call('sendPromoToLine', 'u_mgr', promo({ until: today }));
    assert.equal((await call('removeLineItem', 'u_mgr', { requestId: rid(), promoKey: s.result.promoKey })).status, 'OK');
    const orig = await readDoc(env, 'yemot_promos/' + s.result.promoKey);
    const req = { requestId: rid(), kind: 'promo', id: s.result.promoKey, until: addDays(today, 2) };
    const r = await call('restoreLineItem', 'u_mgr', req);
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.id, 'rst_' + req.requestId); assert.equal(r.result.file, '002.tts'); assert.equal(r.result.until, addDays(today, 2));
    assert.equal(M.calls('RunTzintuk').length, 0);
    const n = await readDoc(env, 'yemot_promos/rst_' + req.requestId);
    assert.equal(n.status, 'live'); assert.equal(n.withTzintuk, false); assert.deepEqual(n.restoredFrom, { kind: 'promo', id: s.result.promoKey }); assert.equal(n.text, orig.text);
    assert.deepEqual(await readDoc(env, 'yemot_promos/' + s.result.promoKey), orig);
    assert.equal((await call('restoreLineItem', 'u_mgr', req)).result.duplicate, true);
    const out = await require('../functions/yemot.js').runExpiry({ now: new Date(Date.now() + 3 * 86400000), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });
    assert.equal(out.removed, 1); assert.ok(!M.state.files.has('002.tts'));
  });

  it('ש5 restoreLineItem – נוסח בלי שמע שמור בקול המשוכפל ← cost-confirm-needed עם מספר תווים (בלי פנייה לימות/ElevenLabs); engine:tts ← בלי עלות; מקור בקול הממוחשב ← בלי אישור', async () => {
    const el = { VOICE_ENGINE: 'elevenlabs', ELEVENLABS_API_BASE: 'http://127.0.0.1:9', ELEVENLABS_API_KEY: 'DUMMY-ELEVEN-x' };
    const id = await itemDoc('recipes', { status: 'removed', removedAt: dayAt(israelDay()), engine: 'elevenlabs', text: 'מתכון בקול האנושי', path: 'ivr2:1/002.wav', file: '002.wav' });
    const c = await core(BOARD, 'restore', 'u_mgr', { requestId: rid(), kind: 'item', id }, el);
    assert.equal(c.error.details.reason, 'cost-confirm-needed', c.text); assert.equal(c.error.details.chars, 'מתכון בקול האנושי'.length); assert.match(c.error.message, /תווים/);
    assert.equal(yemotCalls(), 0); assert.deepEqual((await allDocs(env, ['voice_usage'])).map((d) => d.id), []);
    const t = await core(BOARD, 'restore', 'u_mgr', { requestId: rid(), kind: 'item', id, engine: 'tts' }, el);
    assert.equal(t.status, 'OK', t.text); assert.match(t.result.file, /\.tts$/); assert.equal(t.result.usedCost, false);
    const bd = await core(BOARD, 'board', 'u_mgr', { slot: 'recipes' }, el);
    assert.equal(bd.status, 'OK', bd.text);
    const tid = await itemDoc('updates', { status: 'removed', removedAt: dayAt(israelDay()), engine: 'yemot-tts', path: 'ivr2:3/002.tts', file: '002.tts' });
    const tt = await core(BOARD, 'restore', 'u_mgr', { requestId: rid(), kind: 'item', id: tid }, el);
    assert.equal(tt.status, 'OK', tt.text); assert.equal(tt.result.usedCost, false);
  });

  it('ש5 restoreLineItem – קובץ ותיק שירד: חוזר לשמו המקורי מהגיבוי; שם תפוס ← name-taken (לא דורסים); פעם שנייה ← already-on-line', async () => {
    const r = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '4', file: '000.tts' });
    assert.equal(r.status, 'OK', r.text);
    dir('4').set('000.tts', 'מישהו העלה ידנית');
    const taken = await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'backup', id: r.result.backupId });
    assert.equal(taken.error.details.reason, 'name-taken'); assert.equal(dir('4').get('000.tts'), 'מישהו העלה ידנית');
    dir('4').delete('000.tts');
    const ok = await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'backup', id: r.result.backupId });
    assert.equal(ok.status, 'OK', ok.text); assert.equal(dir('4').get('000.tts'), 'שעות ותיקות');
    assert.equal(M.calls('UploadTextFile').slice(-1)[0].body.what, 'ivr2:4/000.tts');
    const again = await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'backup', id: r.result.backupId });
    assert.equal(again.error.details.reason, 'already-on-line');
    const b = await call('getLineBoard', 'u_mgr', { slot: 'hours' });
    assert.ok(b.result.onLine.some((e) => e.file === '000.tts' && e.origin === 'legacy'));
  });

  it('ש5 cleanLineAudio: רק line_audio/, רק אחרי 8 ימים מיום הירידה (שעון ישראל, גם במעבר שעון); פריט בקו – לעולם לא; בלי רשומה – אחרי יומיים; voice_cache ושמות אחרים – לא נוגעים', async () => {
    await bucket().deleteFiles({ prefix: 'line_audio/' });
    const put = (p, createdAt) => bucket().file(p).save(Buffer.from('RIFFxxxx'), { resumable: false, contentType: 'audio/wav', metadata: { metadata: { createdAt } } });
    // ירד ב-25.10.2026 00:30 שעון ישראל (21:30Z ב-24.10, לפני סוף שעון הקיץ) ← נמחק החל מ-02.11 00:00 שעון ישראל
    const downId = 'down_item_1', liveId = 'live_item_1', promoKey = 'pk_down_promo1';
    await writeDoc(env, 'yemot_items/' + downId, { slot: 'recipes', status: 'removed', removedAt: '2026-10-24T21:30:00.000Z', audioPath: `line_audio/items/${downId}.wav`, text: null });
    await writeDoc(env, 'yemot_items/' + liveId, { slot: 'recipes', status: 'live', createdAt: '2026-01-01T00:00:00.000Z', audioPath: `line_audio/items/${liveId}.wav` });
    await writeDoc(env, 'yemot_promos/' + promoKey, { status: 'removed', removedAt: '2026-10-24T21:30:00.000Z', audioPath: `line_audio/promos/${promoKey}.mp3` });
    await writeDoc(env, 'yemot_line_backups/20261024-120000-abcdef', { reason: 'file', status: 'complete', result: 'applied', ext: '1', file: '000.tts', kind: 'text', text: 'גיבוי', createdAt: '2026-10-24T21:00:00.000Z', finishedAt: '2026-10-24T21:30:00.000Z' });
    const old = '2026-01-01T00:00:00.000Z';
    for (const p of [`line_audio/items/${downId}.wav`, `line_audio/items/${liveId}.wav`, `line_audio/promos/${promoKey}.mp3`, 'line_audio/items/orphan_old_1.wav', 'line_audio/items/short.wav', 'line_audio/other/x_x_x_x_1.wav', 'line_audio/items/odd_name_1.txt', 'voice_cache/old_cache_1.mp3']) await put(p, old);
    await put('line_audio/items/orphan_new_1.wav', '2026-11-01T20:00:00.000Z');
    // בתהליך הבדיקה: אותו bucket כמו בשמירה (VOICE_CACHE_BUCKET, כמו ב-CORE_ENV)
    const withBucket = async (fn) => { const s0 = process.env.VOICE_CACHE_BUCKET; process.env.VOICE_CACHE_BUCKET = H.PROJECT_ID; try { return await fn(); } finally { if (s0 === undefined) delete process.env.VOICE_CACHE_BUCKET; else process.env.VOICE_CACHE_BUCKET = s0; } };
    const clean = (iso) => withBucket(() => require(BOARD).cleanLineAudio({ now: new Date(iso) }));
    const o1 = await clean('2026-11-01T21:59:00.000Z'); // 01.11 23:59 שעון ישראל – יום 7 ← נשאר
    assert.ok(await stored(`line_audio/items/${downId}.wav`), 'יום 7 – נשאר'); assert.ok(await stored(`line_audio/promos/${promoKey}.mp3`));
    assert.equal(await stored('line_audio/items/orphan_old_1.wav'), null, 'בלי רשומה, ישן – נמחק'); assert.ok(await stored('line_audio/items/orphan_new_1.wav'), 'בלי רשומה, חדש – נשאר');
    assert.equal((await readDoc(env, 'yemot_line_backups/20261024-120000-abcdef')).text, 'גיבוי');
    assert.equal(o1.removed, 1, JSON.stringify(o1));
    const o2 = await clean('2026-11-01T22:01:00.000Z'); // 02.11 00:01 שעון ישראל – יום 8 ← נמחק
    assert.equal(await stored(`line_audio/items/${downId}.wav`), null); assert.equal(await stored(`line_audio/promos/${promoKey}.mp3`), null);
    const dx = await readDoc(env, 'yemot_items/' + downId); assert.equal(dx.audioPath, undefined); assert.ok(dx.audioPurgedAt); assert.equal(dx.status, 'removed');
    assert.ok((await readDoc(env, 'yemot_promos/' + promoKey)).audioPurgedAt);
    const bk = await readDoc(env, 'yemot_line_backups/20261024-120000-abcdef'); assert.equal(bk.text, undefined); assert.ok(bk.purgedAt);
    assert.equal(o2.texts, 1);
    // לעולם לא: פריט בקו, שמות שלא תואמים, תיקיות אחרות
    const o3 = await clean('2027-06-01T00:00:00.000Z');
    for (const p of [`line_audio/items/${liveId}.wav`, 'line_audio/items/short.wav', 'line_audio/other/x_x_x_x_1.wav', 'line_audio/items/odd_name_1.txt', 'voice_cache/old_cache_1.mp3']) assert.ok(await stored(p), 'לא נמחק: ' + p);
    assert.ok(o3.skipped >= 3, JSON.stringify(o3));
    const voice = require('../functions/lib/voice');
    for (const p of ['voice_cache/a_a_a_a_1.mp3', 'line_audio/items/short.wav', 'line_audio/x/aaaaaaaaa.wav', 'app_backups/u/aaaaaaaa.wav']) await assert.rejects(voice.deleteLineAudio(p), p);
    // ריצת הלילה קוראת לניקוי
    const n = await withBucket(() => require('../functions/yemot.js')._core.nightly({ key: SECRET, base: BASE, ext: '2', timeoutMs: 5000, skipCache: true }));
    assert.ok(n.lineAudio && n.lineAudio.checked >= 4, JSON.stringify(n));
  });

  it('ש5 כללים: line_audio/ ב-Storage סגור לטלפון (גם למנהל); yemot_state/listen-* ו-board-* סגורים', async () => {
    await bucket().file('line_audio/items/rules_test_1.wav').save(Buffer.from('RIFF'), { resumable: false });
    await writeDoc(env, 'yemot_state/listen-u_emp', { day: '2026-11-04', count: 1 });
    for (const role of ['guest', 'employee', 'manager']) {
      const st = H.ctxFor(env, role).storage();
      await assertFails(st.ref('line_audio/items/rules_test_1.wav').getDownloadURL());
      await assertFails(st.ref('line_audio/items/new_file_1.wav').put(new Uint8Array([1]), { contentType: 'audio/wav' }));
      const db = H.ctxFor(env, role).firestore();
      for (const p of ['yemot_state/listen-u_emp', 'yemot_state/board-recipes', 'yemot_state/restore-x']) { await assertFails(db.doc(p).get()); await assertFails(db.doc(p).set({ x: 1 })); }
    }
  });

  it('ש5 פתיחה (מנהל): רשימה והאזנה; החזרת פתיחה שירדה = החלפה רגילה של הנוכחית (הנוכחית replaced, ext.ini ו-M* אחרים לא נוגעים)', async () => {
    noLegacyOpening();
    const a = await call('publishLineItem', 'u_mgr', item('opening', { text: 'פתיחה א' }));
    const b = await call('publishLineItem', 'u_mgr', item('opening', { text: 'פתיחה ב' }));
    assert.equal(b.status, 'OK', b.text);
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'replaced');
    const l = await call('getLineAudio', 'u_mgr', { ref: { kind: 'item', id: b.result.id } });
    assert.equal(l.result.mode, 'text'); assert.equal(l.result.text, 'פתיחה ב');
    const bd = await call('getLineBoard', 'u_mgr', { slot: 'opening' });
    assert.deepEqual(bd.result.onLine.map((e) => [e.file, e.origin, e.ref.id]), [['M1000.tts', 'app', b.result.id]]);
    assert.equal(bd.result.recent[0].ref.id, a.result.id); assert.equal(bd.result.recent[0].downReason, 'replaced');
    const r = await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'item', id: a.result.id });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.path, 'ivr2:/M1000.tts');
    assert.equal(dir('').get('M1000.tts'), 'פתיחה א');
    assert.equal((await readDoc(env, 'yemot_items/' + b.result.id)).status, 'replaced');
    assert.equal(dir('').get('ext.ini'), 'type=menu'); assert.equal(dir('').get('BACKUP_M1000.wav'), 'פתיחה מוקלטת');
    assert.equal(M.calls('RunTzintuk').length, 0);
  });

  it('ש5 תיקון סבב 1: פסק זמן במחיקת קובץ ותיק (ימות מחקה בפועל) ← גיבוי uncertain שמופיע ב"ירדו" וניתן להחזרה; ניסיון חוזר ← applied; אחרי החזרה – "כבר הוחזר" רק כל עוד הקובץ בקו', async () => {
    M.setMode('delete', 'hangafter');
    const req = { requestId: rid(), ext: '3', file: '000.tts' };
    const r = await core(LINE, 'removeItem', 'u_mgr', req, { YEMOT_TIMEOUT_MS: '300' });
    assert.equal(r.error && r.error.details.reason, 'yemot-remove-failed', r.text);
    assert.ok(!dir('3').has('000.tts'), 'ימות מחקה בפועל');
    const bk = (await allDocs(env, ['yemot_line_backups'])).find((q) => q.data.opId === req.requestId);
    assert.equal(bk.data.result, 'uncertain'); assert.equal(bk.data.status, 'complete');
    M.setMode('delete', 'ok');
    const b1 = await call('getLineBoard', 'u_mgr', { slot: 'updates' });
    const e1 = b1.result.recent.find((x) => x.ref.id === bk.id);
    assert.ok(e1, 'מופיע ב"ירדו בשבוע האחרון" עוד לפני הניסיון החוזר'); assert.equal(e1.restore.allowed, true);
    const again = await call('removeLineItem', 'u_mgr', { requestId: rid(), ext: '3', file: '000.tts' });
    assert.equal(again.status, 'OK', again.text); assert.equal(again.result.duplicate, true); assert.equal(again.result.backupId, bk.id);
    assert.equal((await readDoc(env, 'yemot_line_backups/' + bk.id)).result, 'applied');
    assert.equal(M.calls('FileAction').length, 1, 'הניסיון החוזר לא מחק שוב');
    const rs = await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'backup', id: bk.id });
    assert.equal(rs.status, 'OK', rs.text); assert.equal(dir('3').get('000.tts'), 'עדכון ותיק');
    const e2 = (await call('getLineBoard', 'u_mgr', { slot: 'updates' })).result.recent.find((x) => x.ref.id === bk.id);
    assert.equal(e2.alreadyRestored, true); assert.equal(e2.restore.allowed, false, 'אחרי החזרה – בלי כפתור "החזר"');
    // הקובץ שהוחזר ירד שוב (מחוץ לאפליקציה) ← אפשר להחזיר שוב
    dir('3').delete('000.tts');
    await writeDoc(env, 'yemot_state/board-updates', { stale: true });
    const e3 = (await call('getLineBoard', 'u_mgr', { slot: 'updates' })).result.recent.find((x) => x.ref.id === bk.id);
    assert.equal(e3.alreadyRestored, false); assert.equal(e3.restore.allowed, true);
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'backup', id: bk.id })).status, 'OK');
    // פסק זמן שבו ימות לא מחקה ← הגיבוי uncertain לא מוצג כ"ירד", והחזרה ← restore-not-down
    M.setMode('delete', 'hang');
    const req2 = { requestId: rid(), ext: '1', file: '000.tts' };
    assert.equal((await core(LINE, 'removeItem', 'u_mgr', req2, { YEMOT_TIMEOUT_MS: '300' })).error.details.reason, 'yemot-remove-failed');
    assert.ok(dir('1').has('000.tts'));
    const bk2 = (await allDocs(env, ['yemot_line_backups'])).find((q) => q.data.opId === req2.requestId);
    assert.equal(bk2.data.result, 'uncertain');
    M.setMode('delete', 'ok');
    assert.ok(!(await call('getLineBoard', 'u_mgr', { slot: 'recipes' })).result.recent.some((x) => x.ref.id === bk2.id));
    assert.equal((await call('restoreLineItem', 'u_mgr', { requestId: rid(), kind: 'backup', id: bk2.id })).error.details.reason, 'restore-not-down');
    assert.equal(dir('1').get('000.tts'), 'מתכון ותיק');
  });

  it('ש5 תיקון סבב 1: requestId בלי אות/ספרה נדחה בהורדה לפי שם (בלי פנייה לימות); האזנה מהקו שנכשלה לא נספרת במכסה', async () => {
    for (const requestId of ['________', '--------', '_-_-_-_-_-']) {
      const r = await call('removeLineItem', 'u_mgr', { requestId, ext: '4', file: '000.tts' });
      assert.equal(r.error && r.error.details.reason, 'bad-request-id', requestId);
    }
    assert.equal(yemotCalls(), 0); assert.ok(dir('4').has('000.tts'));
    dir('3').set('007.wav', wav(1));
    M.setMode('download', '404'); M.setMode('text', 'error');
    for (const file of ['007.wav', '000.tts']) assert.equal((await call('getLineAudio', 'u_emp', { ref: { kind: 'file', ext: '3', file } })).error.details.reason, 'listen-unavailable', file);
    const c = await readDoc(env, 'yemot_state/listen-u_emp');
    assert.equal(c ? c.count : 0, 0, 'כשל לא נספר');
    M.setMode('download', 'ok');
    assert.equal((await call('getLineAudio', 'u_emp', { ref: { kind: 'file', ext: '3', file: '007.wav' } })).status, 'OK');
    assert.equal((await readDoc(env, 'yemot_state/listen-u_emp')).count, 1, 'הצלחה נספרת');
  });

  it('ש5 הסוד של ימות לא דולף: לא באף תשובה ולא ביומן (כולל כל בדיקות שלב 5, וגם כששרת הדמה מחזיר אותו בשגיאה)', async () => {
    M.setMode('dir', 'error'); M.setMode('download', 'error'); M.setMode('text', 'exception');
    await core(BOARD, 'board', 'u_mgr', { slot: 'hours' });
    await core(BOARD, 'listen', 'u_mgr', { ref: { kind: 'file', ext: '4', file: '000.tts' } });
    await core(LINE, 'removeItem', 'u_mgr', { requestId: rid(), ext: '4', file: '000.tts' });
    dir('4').set('009.wav', wav(1)); M.setMode('dir', 'ok');
    await core(BOARD, 'listen', 'u_mgr', { ref: { kind: 'file', ext: '4', file: '009.wav' } }); // הורדה נכשלת (השגיאה מכילה את המפתח)
    await core(LINE, 'removeItem', 'u_mgr', { requestId: rid(), ext: '4', file: '009.wav' }); // גיבוי נכשל
    M.setMode('upload', 'error');
    const it = await itemDoc('updates', { status: 'removed', removedAt: dayAt(israelDay()) });
    await core(BOARD, 'restore', 'u_mgr', { requestId: rid(), kind: 'item', id: it }); // העלאה נכשלת
    assert.ok(LOGS.some((t) => t.includes('listen-unavailable')) && LOGS.some((t) => t.includes('backup-failed')), 'היומנים של שלב 5 נאספו');
    assert.ok(SEEN.length > 50);
    assert.deepEqual(SEEN.filter((t) => t.includes(SECRET)), []);
    assert.deepEqual(LOGS.filter((t) => t.includes(SECRET)), []);
  });
});
