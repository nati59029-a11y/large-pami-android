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
const CORE_ENV = { YEMOT_EXT: '2', YEMOT_TZINTUK_LIST: 'mivtzaim', YEMOT_EMPLOYEE_DAILY: '0', YEMOT_MAX_DAYS: '60', YEMOT_TEXT_MAX: '400',
  YEMOT_TIMEOUT_MS: '15000', YEMOT_RECIPE_MAX: '2500', YEMOT_REC_MAX_SEC: '120', FUNCTIONS_EMULATOR: 'true' };
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
const YCOLS = ['yemot_items', 'yemot_promos', 'yemot_state', 'yemot_usage', 'yemot_hook_usage', 'yemot_lexicon'];

async function hook(params, method) {
  const qs = new URLSearchParams(params).toString();
  const r = method === 'POST'
    ? await fetch(fnUrl('tzintukJoin'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs })
    : await fetch(fnUrl('tzintukJoin') + '?' + qs);
  const text = await r.text(); SEEN.push(text);
  return { code: r.status, text };
}

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
  it('index.js מייצא את הפונקציות החדשות (publishLineItem, removeLineItem, getLineState, tzintukJoin), ולא את uploadPreview (פ1=טלפון)', () => {
    const ex = require('../functions/index.js');
    for (const n of ['publishLineItem', 'removeLineItem', 'getLineState', 'tzintukJoin', 'sendPromoToLine', 'expirePromosOnLine']) assert.equal(typeof ex[n], 'function', n + ' לא מיוצא');
    assert.equal(ex.uploadPreview, undefined);
    assert.equal(ex._core, undefined); assert.equal(ex.shared, undefined);
    assert.equal(Object.keys(ex).length, 10, Object.keys(ex).join(','));
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
  it('עובד ששולח עם בקשת צינתוק: נדחה (tzintuk-manager-only) בעברית, ושרת הדמה לא קיבל אף קריאה – גם לא צינתוק', async () => {
    const r = await call('sendPromoToLine', 'u_emp', promo({ withTzintuk: true }));
    assert.equal(r.status, 'PERMISSION_DENIED', r.text);
    assert.equal(r.error.details.reason, 'tzintuk-manager-only');
    assert.match(r.error.message, /רק מנהל יכול לשלוח צינתוק/);
    assert.equal(M.calls('RunTzintuk').length, 0);
    assert.equal(M.state.requests.length, 0);
    assert.deepEqual(await allDocs(env, ['yemot_promos', 'yemot_usage']), []);
    const st = await call('sendPromoToLine', 'u_emp', { statusOnly: true });
    assert.equal(st.result.tzintukToday.allowed, false); assert.equal(st.result.tzintukToday.limit, 0);
    // אותו עובד בלי צינתוק – עולה לקו, בלי RunTzintuk
    const ok = await call('sendPromoToLine', 'u_emp', promo());
    assert.equal(ok.status, 'OK', ok.text);
    assert.equal(ok.result.tzintuk, 'skipped');
    assert.deepEqual(M.state.requests.map((q) => q.cmd), ['GetIVR2Dir', 'UploadTextFile']);
    // מנהל עם צינתוק – כן
    const m = await call('sendPromoToLine', 'u_mgr', promo({ withTzintuk: true }));
    assert.equal(m.result.tzintuk, 'sent');
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

  it('העלאה – נעילה: פריט בטיפול ← busy; החלפה אחרת בשלוחה 4 בטיפול ← busy; בלי פנייה לימות', async () => {
    const it1 = item('recipes');
    await writeDoc(env, 'yemot_items/' + it1.requestId, { slot: 'recipes', byUid: 'u_emp', status: 'uploading', lockAt: new Date().toISOString(), lockReq: it1.requestId, path: null });
    const r = await call('publishLineItem', 'u_emp', it1);
    assert.equal(r.status, 'ABORTED'); assert.equal(r.error.details.reason, 'busy'); assert.match(r.error.message, HEB);
    await writeDoc(env, 'yemot_state/ext-4', { lockAt: new Date().toISOString(), lockReq: 'someone_else_1' });
    const h = await call('publishLineItem', 'u_mgr', item('hours'));
    assert.equal(h.error.details.reason, 'busy');
    assert.equal(M.state.requests.length, 0);
    // נעילה ישנה (מעל 120 שניות) – ממשיכים
    await writeDoc(env, 'yemot_state/ext-4', { lockAt: new Date(Date.now() - 200000).toISOString(), lockReq: 'someone_else_1' });
    assert.equal((await call('publishLineItem', 'u_mgr', item('hours'))).status, 'OK');
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
  it('הקלטה: WAV תקין עולה לשלוחה 3 דרך UploadFile (convertAudio=1); פורמט אחר / ארוך מדי / שלוחה אחרת – נדחה', async () => {
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
    assert.equal(na.error.details.reason, 'audio-not-allowed');
    assert.equal(M.calls('UploadFile').length, 1);
    // שלוחה 3 = היסטוריה (פ4): הקלדה אחרי הקלטה – קובץ חדש, הקודם נשאר
    const t = await call('publishLineItem', 'u_emp', item('updates'));
    assert.equal(t.result.file, '002.tts'); assert.deepEqual(names('3'), ['000.tts', '001.wav', '002.tts']);
  });

  // ---------------- 8. טבלת המצבים: החלפה (שלוחה 4 והפתיחה) ----------------
  it('החלפה (שלוחה 4): החדש עולה, ורק אחרי זה הקודם נמחק; 000.tts לא נוגעים', async () => {
    const a = await call('publishLineItem', 'u_mgr', item('hours', { text: 'שעות א' }));
    assert.equal(a.result.file, '001.tts');
    const b = await call('publishLineItem', 'u_mgr', item('hours', { text: 'שעות ב' }));
    assert.equal(b.status, 'OK', b.text); assert.equal(b.result.file, '002.tts'); assert.equal(b.result.replaced, '001.tts');
    const cmds = M.state.requests.map((q) => q.cmd);
    assert.ok(cmds.lastIndexOf('UploadTextFile') < cmds.lastIndexOf('FileAction'), cmds.join(','));
    assert.deepEqual(M.calls('FileAction').map((q) => q.body), [{ action: 'delete', what: 'ivr2:4/001.tts' }]);
    assert.deepEqual(names('4'), ['000.tts', '002.tts']);
    const ra = await readDoc(env, 'yemot_items/' + a.result.id);
    assert.equal(ra.status, 'replaced'); assert.equal(ra.replacedBy, b.result.id);
    assert.equal((await readDoc(env, 'yemot_state/ext-4')).lockAt, null);
  });

  it('החלפה – כשל בהעלאה: הקודם נשאר live ובקו; כשל במחיקת הקודם: החדש live, הקודם remove-failed ונמחק בהחלפה הבאה', async () => {
    const a = await call('publishLineItem', 'u_mgr', item('hours', { text: 'א' }));
    M.setMode('upload', 'error');
    const f = await call('publishLineItem', 'u_mgr', item('hours', { text: 'ב' }));
    assert.equal(f.status, 'UNAVAILABLE');
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'live');
    assert.deepEqual(names('4'), ['000.tts', '001.tts']);
    M.setMode('upload', 'ok'); M.setMode('delete', 'error');
    const b = await call('publishLineItem', 'u_mgr', item('hours', { text: 'ג' }));
    assert.equal(b.status, 'OK', b.text);
    assert.deepEqual(b.result.warnings, ['yemot-remove-failed']); assert.match(b.result.message, /עוד לא הוסר/);
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'remove-failed');
    M.setMode('delete', 'ok');
    const c = await call('publishLineItem', 'u_mgr', item('hours', { text: 'ד' }));
    assert.equal(c.status, 'OK');
    assert.equal((await readDoc(env, 'yemot_items/' + a.result.id)).status, 'replaced');
    assert.equal((await readDoc(env, 'yemot_items/' + b.result.id)).status, 'replaced');
    assert.deepEqual(names('4'), ['000.tts', c.result.file]);
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
    assert.deepEqual(Object.keys(require('../functions/lib/prompts')).sort(), ['feedback', 'feedbackCaptions', 'invoice', 'product'], 'prompts.js (נוצר אוטומטית) לא השתנה');
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

  // ---------------- 13. שלוחה 5 – tzintukJoin ----------------
  it('tzintukJoin: בלי סוד או עם סוד שגוי ← 403, בלי שום פנייה לימות ובלי רשומה', async () => {
    for (const p of [{ ApiPhone: '0541234567' }, { ApiPhone: '0541234567', key: 'wrong' }, { ApiPhone: '0541234567', key: HOOK + 'x' }, { ApiPhone: '0541234567', key: '' }]) {
      const r = await hook(p);
      assert.equal(r.code, 403, JSON.stringify(p));
    }
    const post = await hook({ ApiPhone: '0541234567', key: 'wrong' }, 'POST');
    assert.equal(post.code, 403);
    assert.equal(M.state.requests.length, 0);
    assert.deepEqual(await allDocs(env, ['yemot_hook_usage']), []);
  });

  it('tzintukJoin: מספר מזוהה ← הוספה לרשימה mivtzaim (רק add) והודעה "נוספתם בהצלחה" וחזרה לתפריט; גם ב-POST ו-972', async () => {
    const r = await hook({ ApiPhone: '0541234567', ApiDID: '023131165', ApiCallId: 'abc', key: HOOK });
    assert.equal(r.code, 200, r.text);
    assert.equal(r.text, 'id_list_message=t-נוספתם בהצלחה לרשימת הצינתוקים&go_to_folder=/');
    const p = await hook({ ApiPhone: '972521234567', key: HOOK }, 'POST');
    assert.match(p.text, /נוספתם בהצלחה/);
    assert.deepEqual(M.state.lists.mivtzaim, ['0541234567', '0521234567']);
    const lc = M.calls('TzintukimListManagement');
    assert.equal(lc.length, 2); assert.ok(lc.every((q) => q.body.action === 'add' && q.auth === SECRET));
    assert.equal(M.state.requests.length, 2, 'פקודה אחרת מלבד הוספה');
    const docs = JSON.stringify(await allDocs(env, ['yemot_hook_usage']));
    assert.ok(!docs.includes('0541234567') && !docs.includes('541234567'), 'מספר הטלפון נשמר במסד');
  });

  it('tzintukJoin: מספר חסוי / לא ישראלי ← "מספר לא מזוהה", בלי פנייה לימות; ניתוק (hangup) ← תשובה ריקה', async () => {
    for (const ph of ['', 'anonymous', 'Restricted', '123', '+14155550100', '0000000000', '05412345678']) {
      const r = await hook({ ApiPhone: ph, key: HOOK });
      assert.equal(r.code, 200); assert.match(r.text, /^id_list_message=t-מספר לא מזוהה[^.&=-]*&go_to_folder=\/$/, ph);
    }
    assert.equal((await hook({ key: HOOK })).text.includes('מספר לא מזוהה'), true);
    const h = await hook({ ApiPhone: '0541234567', key: HOOK, hangup: 'yes' });
    assert.equal(h.text, '');
    assert.equal(M.state.requests.length, 0);
  });

  it('tzintukJoin: הגבלת קצב – עד 3 פעמים ביום לאותו מספר; מספר אחר לא מושפע', async () => {
    for (let i = 0; i < 3; i++) assert.match((await hook({ ApiPhone: '0501112222', key: HOOK })).text, /נוספתם/);
    const r = await hook({ ApiPhone: '0501112222', key: HOOK });
    assert.match(r.text, /הבקשה כבר התקבלה היום/);
    assert.equal(M.calls('TzintukimListManagement').length, 3);
    assert.match((await hook({ ApiPhone: '0503334444', key: HOOK })).text, /נוספתם/);
  });

  it('tzintukJoin: שגיאה בימות ← המתקשר שומע הודעה מנומסת, והסוד לא דולף', async () => {
    for (const mode of ['error', 'exception', 'http500']) {
      M.reset(); M.setMode('list', mode);
      const r = await hook({ ApiPhone: '0547778888', key: HOOK });
      assert.equal(r.code, 200); assert.equal(r.text, 'id_list_message=t-לא הצלחנו להוסיף אתכם כרגע נסו שוב מאוחר יותר&go_to_folder=/');
      assert.ok(!r.text.includes(SECRET));
    }
    // פסק זמן (בתוך התהליך, זמן קצר)
    M.reset(); M.setMode('list', 'hang');
    const { handleJoin } = require('../functions/yemot-hook.js')._core;
    let out = null; const res = { status(c) { out = { c }; return this; }, set() { return this; }, send(b) { out.b = b; } };
    await handleJoin({ method: 'GET', query: { ApiPhone: '0549990000', key: 'k1' }, body: {} }, res, { secret: 'k1', key: SECRET, base: BASE, list: 'mivtzaim', daily: 3, timeoutMs: 500 });
    assert.equal(out.c, 200); assert.match(out.b, /לא הצלחנו/);
    // בלי סוד בשרת – תמיד 403 (סגור כברירת מחדל)
    await handleJoin({ method: 'GET', query: { ApiPhone: '0549990000', key: '' }, body: {} }, res, { secret: '', key: SECRET, base: BASE });
    assert.equal(out.c, 403);
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
});
