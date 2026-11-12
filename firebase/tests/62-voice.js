'use strict';
// בדיקות שלב 9 (משימה 2026-11-02): הקול המשוכפל (ElevenLabs) בכל ההקראות בקו – lib/voice.js.
// מול ElevenLabs מדומה (elevenlabs-mock.js) וימות מדומה (yemot-mock.js). אין שום פנייה החוצה.
// הליבה נקראת בתוך תהליך הבדיקה (_core) עם הגדרות הקול, ויומן התהליך נאסף – כדי לחפש בו את המפתח.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const M = require('./yemot-mock');
const E = require('./elevenlabs-mock');

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
const EBASE = envValue('ELEVENLABS_API_BASE');
const SECRETS = fs.readFileSync(path.join(H.ROOT, 'functions', '.secret.local'), 'utf8');
const SECRET = (/^YEMOT_API_KEY=(.+)$/m.exec(SECRETS) || [])[1];
const EKEY = (/^ELEVENLABS_API_KEY=(.+)$/m.exec(SECRETS) || [])[1];

const LOGS = [], SEEN = [];
const VOICE_ENV = {
  YEMOT_EXT: '2', YEMOT_TZINTUK_LIST: 'mivtzaim', YEMOT_EMPLOYEE_DAILY: '1', YEMOT_MAX_DAYS: '60', YEMOT_TEXT_MAX: '400',
  YEMOT_TIMEOUT_MS: '15000', YEMOT_RECIPE_MAX: '2500', YEMOT_REC_MAX_SEC: '120', FUNCTIONS_EMULATOR: 'true',
  VOICE_ENGINE: 'elevenlabs', ELEVENLABS_API_BASE: EBASE, ELEVENLABS_API_KEY: EKEY, VOICE_CACHE_BUCKET: H.PROJECT_ID,
  ELEVENLABS_MONTHLY_CHARS: '36000', ELEVENLABS_TIMEOUT_MS: '5000', VOICE_PREVIEW_DAILY: '30', VOICE_CACHE_HOURS: '48', LEXICON_SEED: 'off',
};
// קריאה לליבה בתוך התהליך, עם הגדרות הקול ויומן שנאסף
async function core(mod, fn, uid, data, envPatch) {
  const env = Object.assign({}, VOICE_ENV, envPatch || {});
  const saved = {}; for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const ow = process.stdout.write, ew = process.stderr.write;
  process.stdout.write = function (c, ...a) { LOGS.push(String(c)); return ow.call(this, c, ...a); };
  process.stderr.write = function (c, ...a) { LOGS.push(String(c)); return ew.call(this, c, ...a); };
  try {
    const args = fn === 'previewItem' || fn === 'lineState' ? [{ auth: uid ? { uid } : undefined, data }] : [{ auth: uid ? { uid } : undefined, data }, SECRET, BASE];
    const result = await require(mod)._core[fn](...args);
    const text = JSON.stringify({ result }); SEEN.push(text);
    return { status: 'OK', result, text };
  } catch (e) {
    const error = e && e.httpErrorCode ? { status: String(e.code).toUpperCase().replace(/-/g, '_'), message: e.message, details: e.details } : { status: 'INTERNAL', message: String(e && e.message), details: { reason: 'internal' } };
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
const MONTH = () => israelDay().slice(0, 7);
let seq = 0;
const rid = () => `t62_${Date.now().toString(36)}_${++seq}`;
const item = (slot, extra) => Object.assign({ requestId: rid(), slot, text: 'בדיקת קול ' + rid(), source: 'typed' }, extra || {});
const promo = (extra) => Object.assign({ requestId: rid(), promoKey: 'pk_' + rid(), text: 'מבצע קול ' + rid(), until: addDays(israelDay(), 3), withTzintuk: false }, extra || {});
const dir = (d) => M.state.dirs[d];
const ups = () => M.calls('UploadFile');
const texts = () => M.calls('UploadTextFile');

async function readDoc(env, p) { let v = null; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function writeDoc(env, p, data) { await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(p).set(data); }); }
async function allDocs(env, cols) {
  const out = [];
  await env.withSecurityRulesDisabled(async (c) => { for (const col of cols) (await c.firestore().collection(col).get()).forEach((d) => out.push({ col, id: d.id, data: d.data() })); });
  return out;
}
// firebase-admin מותקן בתיקיית הפונקציות (אותו מופע שהקוד משתמש בו)
const bucket = () => require(require.resolve('firebase-admin/storage', { paths: [path.join(H.ROOT, 'functions')] })).getStorage().bucket(H.PROJECT_ID);

describe('שלב 9: הקול המשוכפל (ElevenLabs) – מנוע, גבול חודשי, כשל, מטמון "שמע קודם", מילון', () => {
  let env;
  before(async () => {
    if (!process.env.FUNCTIONS_EMULATOR_HOST && !process.env.FIREBASE_EMULATOR_HUB) throw new Error('הבדיקות רצות רק בתוך האמולטור (npm test)');
    assert.ok(EKEY && EKEY.startsWith('DUMMY-ELEVEN-'), 'חסר סוד דמה ELEVENLABS_API_KEY');
    assert.ok(EBASE && new URL(EBASE).hostname === '127.0.0.1', 'ELEVENLABS_API_BASE חייב להיות שרת דמה מקומי');
    env = await H.getEnv();
    await M.start(Number(new URL(BASE).port));
    await E.start(Number(new URL(EBASE).port));
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
    require('../functions/index.js');
  });
  after(async () => { await E.stop(); await M.stop(); });
  beforeEach(async () => {
    await H.seed(env); M.reset(); E.reset();
    await bucket().deleteFiles({ prefix: 'voice_cache/' });
  });

  it('index.js מייצא את previewVoice (15 פונקציות, כולל שלב 5 של משימה 2026-11-04)', () => {
    const ex = require('../functions/index.js');
    assert.equal(typeof ex.previewVoice, 'function');
    assert.equal(Object.keys(ex).length, 117); // +7 תמחור חשבונית (pi* – pricing.test.js, 12.11.2026) // +1 ordProfit (12.11.2026, רווחיות הזמנות) // +3 מ-main (recurringTasks, ensureLinePlans, requestBizApk – 12.11.2026) // +2 המזכירה שלב 7 (secInv, secDecide – secretary-inv.test.js) // +7 המזכירה שלב 6 (secOAuthCb, secMailHook, secCalSync, secGoogle, secMail, secMailSend, secAdminMail – secretary-google.test.js) // +6 המזכירה שלב 5 (secWaHook, secWaWork, secInbox, secSend, secWaCfg, secAdminWa – secretary-wa.test.js) // +5 המזכירה שלב 4 (secNotes, secReports, secHistory, secRemind, secDaily – secretary-remind.test.js) +5 המזכירה שלב 3 (secFacts, secSens, secRules, secCal, secImport – secretary-know.test.js) +4 המזכירה שלב 2 (secChat, secChatLoad, secMirrorPut, secPrefs) +7 המזכירה שלב 1 (secretary.js); +2 ייבוא ברקע (startImport, runImportChunk – imports.test.js, 11.11.2026); +1 mergeCust (2026-11-10); +1 getCosts (00:12); // +3 ניוד קווים (setCellCfg, saveLinePlan, checkLines – lines.test.js); +3 כרטיס (fb/ord-card: setCard, getCard, delCard); +3 לקוחות (customers.js: saveCust, importCusts, setCustCfg); +4 קטלוג (orders-catalog.test.js); +13 הזמנות שלב 1 (orders.js, orders.test.js); +1 sendInviteMail; +1 publicBrand (דף פתיחה); +2 סניפים (setBusinessOrg, setStaffBranches); + setStaffName (סריקה אחידה שלב 6); + setScanQuota (סריקה אחידה); // 15 + 12 של ריבוי עסקים (משימה 2026-11-05, business.js: 10 פונקציות ניהול ו-2 סנכרון; completeInvite הוסרה בשלב 6ג; setBusinessBrand – עדכון חוזה 14)
  });

  // ---------------- הצלחה ----------------
  it('מתכון בקול המשוכפל: בקשה אחת ל-ElevenLabs עם ההגדרות, ו-UploadFile לימות (convertAudio=1, נתיב .wav, מקור mp3)', async () => {
    const r = await core(LINE, 'publishItem', 'u_emp', item('recipes', { text: 'עוגת שוקולד ב-10 ₪' }));
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.file, '001.wav'); assert.equal(r.result.engine, 'elevenlabs');
    assert.equal(E.state.requests.length, 1);
    const q = E.state.requests[0];
    assert.equal(q.path, '/v1/text-to-speech/B0rytFMCoK8EmM1samtX');
    assert.equal(q.query.output_format, 'mp3_44100_64');
    assert.equal(q.key, EKEY);
    assert.deepEqual(q.body, { text: 'עוגת שוקולד ב-10 שקלים', model_id: 'eleven_v3', language_code: 'he', voice_settings: { speed: 0.9 } });
    assert.equal(texts().length, 0);
    assert.equal(ups().length, 1);
    const u = ups()[0].body;
    assert.deepEqual([u.path, u.convertAudio, u.fileName, u.type], ['ivr2:1/001.wav', '1', '001.mp3', 'audio/mpeg']);
    assert.ok(Buffer.compare(dir('1').get('001.wav'), E.fakeAudio('עוגת שוקולד ב-10 שקלים')) === 0, 'מה שעלה לימות = מה שהשירות החזיר');
    const rec = await readDoc(env, 'yemot_items/' + r.result.id);
    assert.equal(rec.engine, 'elevenlabs'); assert.equal(rec.status, 'live');
    const usage = await readDoc(env, `voice_usage/m-${MONTH()}`);
    assert.equal(usage.chars, 'עוגת שוקולד ב-10 שקלים'.length); assert.equal(usage.limit, 36000);
  });

  it('כל סוגי ההקראה עוברים בקול המשוכפל: מבצע (שני המסכים), מתכון, עדכון מוקלד, שעות ופתיחה', async () => {
    dir('').delete('M1000.wav'); dir('').set('BACKUP_M1000.wav', 'פתיחה מוקלטת'); // אחרי העברת ההקלטה הישנה לגיבוי (הוראות שלב 6ד)
    const a = await core(PROMO, 'sendPromo', 'u_emp', promo()); // מסך המבצעים הישן (בלי origin)
    const b = await core(PROMO, 'sendPromo', 'u_emp', promo({ origin: 'builder' })); // "שמור ושלח לקו"
    const c = await core(LINE, 'publishItem', 'u_emp', item('recipes'));
    const d = await core(LINE, 'publishItem', 'u_emp', item('updates'));
    const e = await core(LINE, 'publishItem', 'u_mgr', item('hours'));
    const f = await core(LINE, 'publishItem', 'u_mgr', item('opening'));
    for (const x of [a, b, c, d, e, f]) assert.equal(x.status, 'OK', x.text);
    assert.equal(E.state.requests.length, 6);
    assert.equal(texts().length, 0);
    assert.deepEqual(ups().map((q) => q.body.path).sort(), ['ivr2:/M1000.wav', 'ivr2:1/001.wav', 'ivr2:2/001.wav', 'ivr2:2/002.wav', 'ivr2:3/001.wav', 'ivr2:4/001.wav']);
    assert.ok(ups().every((q) => q.body.convertAudio === '1' && /\.mp3$/.test(q.body.fileName)));
  });

  it('עדכון שהוקלט נשאר כמו שהוא: לא עובר דרך ElevenLabs', async () => {
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF', 0, 'latin1'); wav.writeUInt32LE(36 + 16000, 4); wav.write('WAVE', 8, 'latin1'); wav.write('fmt ', 12, 'latin1');
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'latin1'); wav.writeUInt32LE(16000, 40);
    const r = await core(LINE, 'publishItem', 'u_emp', { requestId: rid(), slot: 'updates', source: 'recording', audio: { mimeType: 'audio/wav', data: wav.toString('base64') } });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(E.state.requests.length, 0);
    assert.deepEqual([ups()[0].body.fileName, ups()[0].body.type], ['001.wav', 'audio/wav']);
    assert.equal((await readDoc(env, 'yemot_items/' + r.result.id)).engine, 'recording');
  });

  it('החלפת מנוע במבצע קיים: הקובץ הישן .tts נמחק אחרי שה-.wav עלה (הטיפול הקיים ב-yemot.js)', async () => {
    const key = 'pk_sw_' + rid();
    const t = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: key, text: 'מבצע ישן', engine: 'tts' }));
    assert.equal(t.status, 'OK', t.text); assert.equal(t.result.file, '001.tts');
    const w = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: key, text: 'מבצע חדש' }));
    assert.equal(w.status, 'OK', w.text); assert.equal(w.result.action, 'replaced'); assert.equal(w.result.file, '002.wav');
    assert.ok(!dir('2').has('001.tts')); assert.ok(dir('2').has('002.wav')); assert.ok(dir('2').has('000.tts'));
    const cmds = M.state.requests.map((q) => q.cmd);
    assert.ok(cmds.lastIndexOf('UploadFile') < cmds.lastIndexOf('FileAction'), cmds.join(','));
  });

  // ---------------- כשלים: אין מעבר אוטומטי ----------------
  // refunded: האם התווים חוזרים למונה. רק כשהבקשה בוודאות לא חויבה (401/403, או שהחיבור לא נוצר – בדיקה נפרדת למטה).
  // ניתוק אחרי שהבקשה הגיעה, 500, ותשובה שאינה שמע – ייתכן שחויבו, ולכן לא מחזירים.
  for (const [mode, label, refunded] of [['network', 'ניתוק אחרי שהבקשה הגיעה', false], ['http401', '401 (מפתח שגוי)', true], ['http403', '403 (הרשאה)', true], ['http500', '500', false], ['json', 'תשובה שאינה שמע', false]]) {
    it(`${label}: voice-unavailable בעברית, שום דבר לא עולה לימות, התווים ${refunded ? 'מוחזרים' : 'לא מוחזרים'}; "שלח בקול הממוחשב" עובד`, async () => {
      E.setMode(mode);
      const req = item('recipes');
      const r = await core(LINE, 'publishItem', 'u_emp', req);
      assert.equal(r.status, 'UNAVAILABLE', r.text); assert.equal(r.error.details.reason, 'voice-unavailable');
      assert.match(r.error.message, /הקול האנושי לא זמין/);
      assert.equal(ups().length + texts().length, 0, 'אין מעבר אוטומטי – לא עלה כלום');
      assert.equal((await readDoc(env, 'yemot_items/' + req.requestId)).status, 'failed');
      assert.equal((await readDoc(env, `voice_usage/m-${MONTH()}`)).chars, refunded ? 0 : req.text.length);
      // הבחירה של המשתמש: שליחה חוזרת עם engine:'tts' (אותו requestId – הרשומה שנכשלה)
      const t = await core(LINE, 'publishItem', 'u_emp', Object.assign({}, req, { engine: 'tts' }));
      assert.equal(t.status, 'OK', t.text); assert.equal(t.result.file, '001.tts'); assert.equal(t.result.engine, 'yemot-tts');
      assert.equal(texts().length, 1); assert.equal(E.state.requests.length, 1);
    });
  }

  it('החיבור לא נוצר (השרת סירב): voice-unavailable, והתווים מוחזרים – הבקשה בוודאות לא הגיעה', async () => {
    const r = await core(LINE, 'publishItem', 'u_emp', item('recipes', { text: 'שלום' }), { ELEVENLABS_API_BASE: 'http://127.0.0.1:9795' });
    assert.equal(r.error.details.reason, 'voice-unavailable', r.text);
    assert.equal((await readDoc(env, `voice_usage/m-${MONTH()}`)).chars, 0);
    assert.equal(E.state.requests.length, 0); assert.equal(ups().length, 0);
    assert.ok(LOGS.some((l) => l.includes('no-connect')));
  });

  it('פסק זמן: voice-unavailable, ולא מחזירים את התווים (ייתכן שהשירות חייב)', async () => {
    E.setMode('hang');
    const r = await core(LINE, 'publishItem', 'u_emp', item('recipes', { text: 'שלום' }), { ELEVENLABS_TIMEOUT_MS: '300' });
    assert.equal(r.error.details.reason, 'voice-unavailable');
    assert.equal((await readDoc(env, `voice_usage/m-${MONTH()}`)).chars, 4);
    assert.equal(ups().length, 0);
  });

  it('מבצע: כשל בקול עם בקשת צינתוק של עובד – לא נשלח צינתוק, המכסה היומית מוחזרת; "שלח בקול הממוחשב" כן מצנתק', async () => {
    E.setMode('network');
    const p = promo({ withTzintuk: true });
    const r = await core(PROMO, 'sendPromo', 'u_emp', p);
    assert.equal(r.error.details.reason, 'voice-unavailable', r.text);
    assert.equal(M.calls('RunTzintuk').length, 0); assert.equal(ups().length + texts().length, 0);
    const u = await readDoc(env, 'yemot_usage/u_emp');
    assert.ok(!u || u.count === 0, JSON.stringify(u));
    const rec = await readDoc(env, 'yemot_promos/' + p.promoKey);
    assert.equal(rec.status, 'failed'); assert.equal(rec.error, 'voice-unavailable'); assert.equal(rec.lockAt, null);
    const t = await core(PROMO, 'sendPromo', 'u_emp', Object.assign({}, p, { requestId: rid(), engine: 'tts' }));
    assert.equal(t.status, 'OK', t.text); assert.equal(t.result.tzintuk, 'sent'); assert.equal(t.result.file, '001.tts');
  });

  it('engine לא מוכר נדחה (bad-input) בלי פנייה לשום שירות', async () => {
    for (const [mod, fn, data] of [[LINE, 'publishItem', item('recipes', { engine: 'eleven' })], [PROMO, 'sendPromo', promo({ engine: 5 })]]) {
      const r = await core(mod, fn, 'u_mgr', data);
      assert.equal(r.error.details.reason, 'bad-input', r.text);
    }
    assert.equal(E.state.requests.length + M.state.requests.length, 0);
  });

  // ---------------- גבול חודשי ----------------
  it('תקרה חודשית: מעבר = voice-quota בלי פנייה ל-ElevenLabs; למנהל המספרים, לעובד לא; לא עלה כלום', async () => {
    await writeDoc(env, `voice_usage/m-${MONTH()}`, { month: MONTH(), chars: 95, limit: 100 });
    const env2 = { ELEVENLABS_MONTHLY_CHARS: '100' };
    const ok = await core(LINE, 'publishItem', 'u_emp', item('recipes', { text: 'אבגד' }), env2); // 95+4 = 99 – נכנס
    assert.equal(ok.status, 'OK', ok.text);
    const e = await core(LINE, 'publishItem', 'u_emp', item('recipes', { text: 'אבגד' + rid() }), env2);
    assert.equal(e.status, 'RESOURCE_EXHAUSTED', e.text); assert.equal(e.error.details.reason, 'voice-quota');
    assert.equal(e.error.details.used, undefined, 'לעובד לא מוצגים המספרים');
    const m = await core(PROMO, 'sendPromo', 'u_mgr', promo(), env2);
    assert.equal(m.error.details.reason, 'voice-quota', m.text);
    assert.equal(m.error.details.used, 99); assert.equal(m.error.details.limit, 100); assert.match(m.error.message, /99 מתוך 100/);
    assert.equal(E.state.requests.length, 1, 'רק הבקשה שנכנסה בגבול הגיעה לשירות');
    assert.equal(ups().length, 1);
    const usage = await readDoc(env, `voice_usage/m-${MONTH()}`);
    assert.equal(usage.chars, 99); assert.ok(usage.capHitAt);
    // הודעה למנהל: getLineState מחזיר את מצב התקרה (near)
    const s = await core(LINE, 'lineState', 'u_mgr', {}, env2);
    assert.equal(s.result.voice.engine, 'elevenlabs'); assert.equal(s.result.voice.quota.used, 99); assert.equal(s.result.voice.quota.near, true); assert.ok(s.result.voice.quota.capHitAt);
    const se = await core(LINE, 'lineState', 'u_emp', {}, env2);
    assert.equal(se.result.voice.quota, undefined); assert.equal(se.result.voice.preview, 'voice');
  });

  it('המונה החודשי לפי שעון ישראל (YYYY-MM)', () => {
    const v = require('../functions/lib/voice');
    assert.equal(v._test.monthKey(new Date('2026-10-31T22:30:00Z')), '2026-11'); // 00:30 ב-1.11 בישראל
    assert.equal(v._test.monthKey(new Date('2026-10-31T21:30:00Z')), '2026-10');
  });

  // ---------------- מטמון "שמע קודם" ----------------
  it('שמע קודם ואז שליחה של אותו נוסח: פנייה אחת בלבד ל-ElevenLabs, ומה שעלה לקו = מה שהושמע', async () => {
    const text = 'מתכון לבדיקת מטמון ' + rid();
    const p = await core(LINE, 'previewItem', 'u_emp', { text });
    assert.equal(p.status, 'OK', p.text); assert.equal(p.result.mime, 'audio/mpeg'); assert.equal(p.result.cached, false);
    const p2 = await core(LINE, 'previewItem', 'u_emp', { text: '  ' + text + '\n' }); // אותו נוסח אחרי ניקוי
    assert.equal(p2.result.cached, true);
    const s = await core(LINE, 'publishItem', 'u_emp', item('recipes', { text }));
    assert.equal(s.status, 'OK', s.text);
    assert.equal(E.state.requests.length, 1, 'תצוגה + תצוגה + שליחה = פנייה אחת');
    assert.ok(Buffer.compare(dir('1').get(s.result.file), Buffer.from(p.result.data, 'base64')) === 0);
    assert.equal((await readDoc(env, `voice_usage/m-${MONTH()}`)).chars, text.length, 'התווים נספרו פעם אחת');
    // גם מבצע: שמע קודם בחלון "שמור ושלח" ואז שליחה
    const pt = 'מבצע לבדיקת מטמון ' + rid();
    await core(LINE, 'previewItem', 'u_emp', { text: pt });
    const ps = await core(PROMO, 'sendPromo', 'u_emp', promo({ text: pt, origin: 'builder' }));
    assert.equal(ps.status, 'OK', ps.text);
    assert.equal(E.state.requests.length, 2);
    // נוסח אחר = פנייה חדשה
    await core(LINE, 'publishItem', 'u_emp', item('recipes', { text: text + ' שונה' }));
    assert.equal(E.state.requests.length, 3);
  });

  it('שמע קודם: עובד ומנהל כן, אורח/מושבת לא; מגבלה יומית (רק פניות אמיתיות נספרות); כשל = שגיאה (האפליקציה עוברת לקול הטלפון)', async () => {
    for (const uid of [null, 'u_out', 'u_off']) {
      const r = await core(LINE, 'previewItem', uid, { text: 'שלום' });
      assert.notEqual(r.status, 'OK', String(uid));
    }
    assert.equal(E.state.requests.length, 0);
    const lim = { VOICE_PREVIEW_DAILY: '2' };
    assert.equal((await core(LINE, 'previewItem', 'u_mgr', { text: 'א ' + rid() }, lim)).status, 'OK');
    const same = 'ב ' + rid();
    assert.equal((await core(LINE, 'previewItem', 'u_mgr', { text: same }, lim)).status, 'OK');
    assert.equal((await core(LINE, 'previewItem', 'u_mgr', { text: same }, lim)).result.cached, true); // מהמטמון – לא נספר
    const over = await core(LINE, 'previewItem', 'u_mgr', { text: 'ג ' + rid() }, lim);
    assert.equal(over.error.details.reason, 'preview-limit', over.text);
    assert.equal((await core(LINE, 'previewItem', 'u_emp', { text: 'ד ' + rid() }, lim)).status, 'OK', 'המגבלה לכל משתמש בנפרד');
    assert.equal(E.state.requests.length, 3);
    E.setMode('http500');
    const f = await core(LINE, 'previewItem', 'u_emp', { text: 'ה ' + rid() });
    assert.equal(f.error.details.reason, 'voice-unavailable');
    const off = await core(LINE, 'previewItem', 'u_emp', { text: 'ו' }, { VOICE_ENGINE: 'yemot-tts' });
    assert.equal(off.error.details.reason, 'voice-off');
    const tooLong = await core(LINE, 'previewItem', 'u_emp', { text: 'א'.repeat(2501) });
    assert.equal(tooLong.error.details.reason, 'text-too-long');
    assert.equal(M.state.requests.length, 0, 'שמע קודם לא פונה לימות');
  });

  it('שמע קודם: מגבלה יומית לפי תווים לכל משתמש; לא נספרת כשנדחתה בתקרה או כשהבקשה לא הגיעה לשירות', async () => {
    const lim = { VOICE_PREVIEW_DAILY_CHARS: '20' };
    const t10 = () => 'א'.repeat(6) + rid().slice(-4); // 10 תווים, שונה בכל פעם
    assert.equal((await core(LINE, 'previewItem', 'u_emp', { text: t10() }, lim)).status, 'OK');
    assert.equal((await core(LINE, 'previewItem', 'u_emp', { text: t10() }, lim)).status, 'OK'); // 20 – בדיוק בגבול
    const over = await core(LINE, 'previewItem', 'u_emp', { text: 'ב' }, lim);
    assert.equal(over.error.details.reason, 'preview-limit', over.text);
    const day = await readDoc(env, 'voice_usage/p-u_emp');
    assert.deepEqual([day.count, day.chars], [2, 20]);
    assert.equal(E.state.requests.length, 2);
    // משתמש אחר: נדחה בתקרה הכוללת – לא נספר ביום שלו ולא בתת-התקרה
    await writeDoc(env, `voice_usage/m-${MONTH()}`, { month: MONTH(), chars: 99, previewChars: 0, limit: 100 });
    const cap = await core(LINE, 'previewItem', 'u_mgr', { text: 'שלום' }, { ELEVENLABS_MONTHLY_CHARS: '100' });
    assert.equal(cap.error.details.reason, 'voice-quota', cap.text);
    assert.equal(await readDoc(env, 'voice_usage/p-u_mgr'), null);
    assert.equal((await readDoc(env, `voice_usage/m-${MONTH()}`)).previewChars, 0);
    // החיבור לא נוצר: נספר ואז הוחזר (יום + חודש)
    await writeDoc(env, `voice_usage/m-${MONTH()}`, { month: MONTH(), chars: 0, previewChars: 0, limit: 36000 });
    const nc = await core(LINE, 'previewItem', 'u_mgr', { text: 'שלום' }, { ELEVENLABS_API_BASE: 'http://127.0.0.1:9795' });
    assert.equal(nc.error.details.reason, 'voice-unavailable', nc.text);
    const d2 = await readDoc(env, 'voice_usage/p-u_mgr');
    assert.deepEqual([d2.count, d2.chars], [0, 0]);
    assert.deepEqual([(await readDoc(env, `voice_usage/m-${MONTH()}`)).chars, (await readDoc(env, `voice_usage/m-${MONTH()}`)).previewChars], [0, 0]);
    // 500 – הגיע לשירות, נספר
    E.setMode('http500');
    await core(LINE, 'previewItem', 'u_mgr', { text: 'שלום' });
    assert.deepEqual([(await readDoc(env, 'voice_usage/p-u_mgr')).chars, (await readDoc(env, `voice_usage/m-${MONTH()}`)).previewChars], [4, 4]);
  });

  it('שמע קודם: תת-תקרה חודשית להשמעות – ההשמעות נעצרות, והשליחות ממשיכות מהמכסה שנשארה', async () => {
    const env2 = { VOICE_PREVIEW_MONTHLY_CHARS: '30', ELEVENLABS_MONTHLY_CHARS: '100' };
    await writeDoc(env, `voice_usage/m-${MONTH()}`, { month: MONTH(), chars: 28, previewChars: 28, limit: 100 });
    const p = await core(LINE, 'previewItem', 'u_emp', { text: 'שלום' }, env2);
    assert.equal(p.error.details.reason, 'preview-limit', p.text);
    assert.equal(await readDoc(env, 'voice_usage/p-u_emp'), null, 'נדחה – לא נספר ביום של המשתמש');
    const s = await core(LINE, 'publishItem', 'u_emp', item('recipes', { text: 'שלום' }), env2);
    assert.equal(s.status, 'OK', s.text);
    const m = await readDoc(env, `voice_usage/m-${MONTH()}`);
    assert.deepEqual([m.chars, m.previewChars], [32, 28]);
    assert.equal(E.state.requests.length, 1);
    // ברירות המחדל: 3000 ביום, 10000 בחודש להשמעות, 36000 בסך הכול
    const st = require('../functions/lib/voice')._test.settings();
    assert.deepEqual([st.previewDailyChars, st.previewMonthly, st.monthly], [3000, 10000, 36000]);
    const q = await core(LINE, 'lineState', 'u_mgr', {}, env2);
    assert.deepEqual([q.result.voice.quota.previewUsed, q.result.voice.quota.previewLimit], [28, 30]);
  });

  it('אותו נוסח בקול אחר: מבצע שבקו בקול הממוחשב מוקרא מחדש בקול המשוכפל; אותו נוסח באותו קול – בלי פנייה', async () => {
    const key = 'pk_eng_' + rid(), text = 'מבצע זהה ' + rid();
    const t = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: key, text, engine: 'tts' }));
    assert.equal(t.status, 'OK', t.text); assert.equal(t.result.file, '001.tts');
    const w = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: key, text }));
    assert.equal(w.status, 'OK', w.text); assert.equal(w.result.action, 'replaced'); assert.equal(w.result.file, '002.wav');
    assert.equal(E.state.requests.length, 1); assert.ok(!dir('2').has('001.tts'));
    const again = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: key, text }));
    assert.equal(again.result.action, 'none', again.text); assert.equal(E.state.requests.length, 1);
    // רשומה ישנה בלי שדה engine (מלפני הפרסום): הקול לפי סוג הקובץ
    const k2 = 'pk_old_' + rid(), t2 = 'מבצע ישן ' + rid();
    dir('2').set('050.tts', t2);
    await writeDoc(env, 'yemot_promos/' + k2, { text: t2, spoken: t2, status: 'live', file: '050.tts', path: 'ivr2:2/050.tts', until: addDays(israelDay(), 3), tzintuk: 'skipped', byUid: 'u_mgr', lockAt: null });
    const o = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: k2, text: t2 }));
    assert.equal(o.status, 'OK', o.text); assert.equal(o.result.action, 'replaced'); assert.match(o.result.file, /\.wav$/);
    assert.ok(!dir('2').has('050.tts')); assert.equal(E.state.requests.length, 2);
  });

  it('previewVoice דרך האמולטור (הקול הממוחשב מוגדר שם): voice-off, ולאורח – נדחה', async () => {
    const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
    const url = `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/previewVoice`;
    const call = async (uid) => { const h = { 'Content-Type': 'application/json' }; if (uid) h.Authorization = 'Bearer ' + H.mockToken(uid); const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ data: { text: 'שלום' } }) }); return r.json(); };
    assert.equal((await call('u_emp')).error.details.reason, 'voice-off');
    assert.ok((await call(null)).error);
    assert.equal(E.state.requests.length, 0);
  });

  // ---------------- מילון ----------------
  it('מילון: הרשומה הראשונה נוספת פעם אחת, לא דורסת, וחלה לפני השליחה (3 צורות הגרש)', async () => {
    const seed = require(PROMO).shared;
    seed._resetSeed();
    await writeDoc(env, 'yemot_lexicon/main', { text: "במבה=במבָּה\nלארג׳ פעמי=הגייה של המנהל", updatedAt: 1, updatedBy: 'u_mgr' });
    const on = { LEXICON_SEED: 'on' };
    const r = await core(LINE, 'publishItem', 'u_emp', item('recipes', { text: "במבה של לארג' פעמי ושל לארג’ פעמי ושל לארג׳ פעמי" }), on);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(E.state.requests[0].body.text, 'במבָּה של Large פעמי ושל Large פעמי ושל הגייה של המנהל', 'הצורה שכבר הייתה במילון לא נדרסה');
    const lx = await readDoc(env, 'yemot_lexicon/main');
    assert.deepEqual(lx.text.split('\n'), ['# שם החנות בקול המשוכפל (נוסף אוטומטית פעם אחת)',
      "לארג' פעמי=Large פעמי", "לארדז' פעמי=Large פעמי", "בלארג'=ב Large",
      'לארדז׳ פעמי=Large פעמי', 'בלארג׳=ב Large', // "לארג׳ פעמי" כבר היה במילון – לא נוסף ולא נדרס
      'לארג’ פעמי=Large פעמי', 'לארדז’ פעמי=Large פעמי', 'בלארג’=ב Large',
      'במבה=במבָּה', 'לארג׳ פעמי=הגייה של המנהל']);
    assert.deepEqual(Object.keys(lx).sort(), ['text', 'updatedAt', 'updatedBy'], 'רק שלושת השדות שהכללים מתירים');
    // המנהל מחק את הרשומה – היא לא חוזרת (גם אחרי טעינה מחדש של השרת)
    await writeDoc(env, 'yemot_lexicon/main', { text: 'במבה=במבָּה', updatedAt: 2, updatedBy: 'u_mgr' });
    seed._resetSeed();
    await core(LINE, 'publishItem', 'u_emp', item('recipes'), on);
    assert.equal((await readDoc(env, 'yemot_lexicon/main')).text, 'במבה=במבָּה');
    // מילון ריק (אין מסמך): נוצר עם הרשומה
    await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc('yemot_lexicon/main').delete(); await c.firestore().doc('yemot_state/lexicon-seed-1').delete(); });
    seed._resetSeed();
    const s = await core(LINE, 'lineState', 'u_mgr', {}, on);
    assert.equal(s.result.lexicon.split('\n')[1], "לארג' פעמי=Large פעמי");
    seed._resetSeed();
  });

  it('מילון: שם החנות תמיד "Large פעמי" – בנוסח האוטומטי של מבצע ("בלארג\'" ← "ב Large"), בפתיחה ("לארדז\' פעמי") ובכל צורות הגרש', async () => {
    const seed = require(PROMO).shared;
    seed._resetSeed();
    const on = { LEXICON_SEED: 'on' };
    // הנוסח האוטומטי באפליקציה עדיין מתחיל ב"מבצע בלארג'" (אם ישתנה – הרשומה צריכה להשתנות איתו)
    const app = fs.readFileSync(path.join(H.ROOT, '..', 'app-source', 'www', 'yemot-promo.js'), 'utf8');
    assert.ok(app.includes(`const p=["מבצע בלארג'"]`), 'ymText השתנה – לבדוק את רשומת "בלארג\'" במילון');
    const auto = "מבצע בלארג'. במבה. 80 גרם. 3 ב-10 שקלים. המבצע בתוקף עד 9.11.";
    const a = await core(PROMO, 'sendPromo', 'u_emp', promo({ text: auto, origin: 'builder' }), on);
    assert.equal(a.status, 'OK', a.text);
    assert.equal(E.state.requests[0].body.text, 'מבצע ב Large. במבה. 80 גרם. 3 ב-10 שקלים. המבצע בתוקף עד 9.11.');
    assert.equal((await readDoc(env, 'yemot_promos/' + a.result.promoKey)).text, auto, 'ברשומה נשמר הנוסח המקורי');
    dir('').delete('M1000.wav'); dir('').set('BACKUP_M1000.wav', 'פתיחה מוקלטת');
    const o = await core(LINE, 'publishItem', 'u_mgr', item('opening', { text: "שלום וברכה, הגעתם לקו המבצעים והעדכונים של לארדז' פעמי. למתכון שבועי הקישו 1." }), on);
    assert.equal(o.status, 'OK', o.text);
    assert.equal(E.state.requests[1].body.text, 'שלום וברכה, הגעתם לקו המבצעים והעדכונים של Large פעמי. למתכון שבועי הקישו 1.');
    const v = await core(LINE, 'publishItem', 'u_emp', item('recipes', { text: "בלארג׳ ובלארג’ ושל לארדז׳ פעמי ושל לארדז’ פעמי ושל לארג׳ פעמי" }), on);
    assert.equal(v.status, 'OK', v.text);
    assert.equal(E.state.requests[2].body.text, 'ב Large וב Large ושל Large פעמי ושל Large פעמי ושל Large פעמי');
    seed._resetSeed();
  });

  // ---------------- פתיחה ----------------
  it('פתיחה בקול המשוכפל: לא דורסת הקלטת פתיחה ישנה (M1000.wav) – בלי פנייה ל-ElevenLabs; אחרי גיבוי – עולה ומוחקת את ה-.tts שלנו', async () => {
    const t = await core(LINE, 'publishItem', 'u_mgr', item('opening', { text: 'פתיחה ממוחשבת', engine: 'tts' }));
    assert.equal(t.status, 'OK', t.text); assert.ok(dir('').has('M1000.tts'));
    const r = await core(LINE, 'publishItem', 'u_mgr', item('opening'));
    assert.equal(r.error.details.reason, 'opening-legacy-file', r.text);
    assert.equal(E.state.requests.length, 0); assert.equal(dir('').get('M1000.wav'), 'פתיחה מוקלטת'); assert.equal(ups().length, 0);
    dir('').delete('M1000.wav'); dir('').set('BACKUP_M1000.wav', 'פתיחה מוקלטת');
    const ok = await core(LINE, 'publishItem', 'u_mgr', item('opening'));
    assert.equal(ok.status, 'OK', ok.text); assert.equal(ok.result.file, 'M1000.wav'); assert.equal(ok.result.replaced, 'M1000.tts');
    assert.ok(!dir('').has('M1000.tts')); assert.ok(dir('').has('BACKUP_M1000.wav'));
    // החלפה נוספת בקול המשוכפל: M1000.wav הוא שלנו – מותר לדרוס
    const again = await core(LINE, 'publishItem', 'u_mgr', item('opening'));
    assert.equal(again.status, 'OK', again.text);
  });

  // ---------------- ניקוי המטמון ----------------
  it('ניקוי לילי של המטמון: קובץ ישן נמחק, חדש נשאר', async () => {
    const b = bucket();
    await b.file('voice_cache/old.mp3').save(Buffer.from('x'), { resumable: false, metadata: { metadata: { createdAt: '2020-01-01T00:00:00.000Z' } } });
    await b.file('voice_cache/new.mp3').save(Buffer.from('y'), { resumable: false, metadata: { metadata: { createdAt: new Date().toISOString() } } });
    const saved = process.env.VOICE_CACHE_BUCKET; process.env.VOICE_CACHE_BUCKET = H.PROJECT_ID;
    try { assert.deepEqual(await require('../functions/lib/voice').cleanCache(), { removed: 1 }); } finally { if (saved === undefined) delete process.env.VOICE_CACHE_BUCKET; else process.env.VOICE_CACHE_BUCKET = saved; }
    assert.equal((await b.file('voice_cache/old.mp3').exists())[0], false);
    assert.equal((await b.file('voice_cache/new.mp3').exists())[0], true);
  });

  // ---------------- סוד ----------------
  it('המפתח של ElevenLabs לא מופיע בתשובות, ביומן, במסד או בבקשות לימות – גם כשהשירות מחזיר אותו בהודעת השגיאה', async () => {
    E.setMode('leak');
    await core(LINE, 'publishItem', 'u_mgr', item('recipes'));
    await core(LINE, 'previewItem', 'u_mgr', { text: 'בדיקת סוד' });
    await core(PROMO, 'sendPromo', 'u_mgr', promo());
    E.setMode('ok');
    await core(LINE, 'publishItem', 'u_mgr', item('recipes'));
    assert.ok(E.state.requests.length >= 3 && E.state.requests.every((q) => q.key === EKEY), 'המפתח נשלח רק בכותרת');
    assert.ok(E.state.requests.every((q) => !JSON.stringify(q.query).includes(EKEY) && !JSON.stringify(q.body).includes(EKEY)));
    for (const t of SEEN) assert.ok(!t.includes(EKEY), 'בתשובה: ' + t.slice(0, 120));
    assert.ok(LOGS.length > 0, 'נאסף יומן');
    for (const t of LOGS) assert.ok(!t.includes(EKEY), 'ביומן: ' + t.slice(0, 120));
    const docs = await allDocs(env, ['yemot_items', 'yemot_promos', 'voice_usage', 'yemot_state']);
    assert.ok(!JSON.stringify(docs).includes(EKEY));
    assert.ok(!JSON.stringify(M.state.requests).includes(EKEY));
  });

  it('הקוד: המפתח רק ב-defineSecret, ואף קובץ חוץ מ-voice.js לא פונה ל-ElevenLabs', () => {
    const root = path.join(H.ROOT, 'functions');
    const files = ['index.js', 'yemot.js', 'yemot-line.js', 'yemot-hook.js'].concat(fs.readdirSync(path.join(root, 'lib')).map((f) => 'lib/' + f));
    for (const f of files) {
      const t = fs.readFileSync(path.join(root, f), 'utf8');
      if (f !== 'lib/voice.js') assert.ok(!/elevenlabs\.io|xi-api-key|text-to-speech/.test(t), f);
      assert.ok(!/DUMMY-ELEVEN|sk_[A-Za-z0-9]{20,}/.test(t), 'מפתח בקוד: ' + f);
    }
    const v = fs.readFileSync(path.join(root, 'lib/voice.js'), 'utf8');
    assert.match(v, /defineSecret\('ELEVENLABS_API_KEY'\)/);
  });

  // ---------------- משימה 2026-11-04, סבב תיקון 1 (הבהרת המתאם): פתיחה בקול המשוכפל שדורסת M1000.wav של האפליקציה ----------------
  const riff = (n) => { const b = Buffer.alloc(n, 7); b.write('RIFF', 0, 'latin1'); return b; };
  async function oldOpening(content, extra) {
    const id = 'oldopen_' + rid();
    dir('').set('M1000.wav', content);
    await writeDoc(env, 'yemot_items/' + id, Object.assign({ slot: 'opening', ext: '', kind: 'text', text: 'פתיחה קודמת', spoken: 'פתיחה קודמת', engine: 'elevenlabs', status: 'live', file: 'M1000.wav', path: 'ivr2:/M1000.wav', createdAt: '2026-11-03T10:00:00.000Z', byUid: 'u_mgr', byRole: 'manager' }, extra || {}));
    return id;
  }
  it('פתיחה בקול המשוכפל דורסת M1000.wav של האפליקציה: הורדה הצליחה ← עותק שמע נשמר; הורדה נכשלה ← ממשיכים עם הנוסח בלבד ומסמנים audioError', async () => {
    await bucket().deleteFiles({ prefix: 'line_audio/' });
    const prevAudio = riff(300);
    const a = await oldOpening(prevAudio);
    const ok = await core(LINE, 'publishItem', 'u_mgr', item('opening'));
    assert.equal(ok.status, 'OK', ok.text); assert.deepEqual(ok.result.backedUp, [a]); assert.deepEqual(ok.result.warnings, []);
    assert.equal(M.calls('DownloadFile').length, 1);
    const pa = await readDoc(env, 'yemot_items/' + a);
    assert.equal(pa.status, 'replaced'); assert.equal(pa.audioPath, `line_audio/items/${a}.wav`);
    const [saved] = await bucket().file(pa.audioPath).download(); assert.ok(saved.equals(prevAudio));
    // הורדה נכשלה (404): לא נחסם – הנוסח בלבד
    await H.seed(env); M.reset(); E.reset();
    const b = await oldOpening(riff(300));
    M.setMode('download', '404');
    const t = await core(LINE, 'publishItem', 'u_mgr', item('opening'));
    assert.equal(t.status, 'OK', t.text); assert.deepEqual(t.result.backedUp, []);
    assert.deepEqual(t.result.warnings, ['opening-backup-text-only']); assert.match(t.result.message, /הקראה מחדש/);
    assert.ok(Buffer.compare(dir('').get('M1000.wav'), riff(300)) !== 0, 'הפתיחה החדשה עלתה');
    const pb = await readDoc(env, 'yemot_items/' + b);
    assert.equal(pb.status, 'replaced'); assert.equal(pb.audioError, 'backup-failed'); assert.equal(pb.audioPath, undefined); assert.equal(pb.text, 'פתיחה קודמת');
  });
  it('פתיחה בקול המשוכפל – חובת גיבוי נשארת כשלקודמת אין נוסח (הקלטה), וגם בהקלטת פתיחה', async () => {
    const a = await oldOpening(riff(300), { kind: 'audio', text: null, spoken: null, engine: 'recording' });
    M.setMode('download', '404');
    const t = await core(LINE, 'publishItem', 'u_mgr', item('opening'));
    assert.equal(t.error && t.error.details.reason, 'backup-failed', t.text);
    assert.equal(E.state.requests.length, 0, 'בלי פנייה ל-ElevenLabs'); assert.equal(ups().length, 0);
    assert.equal((await readDoc(env, 'yemot_items/' + a)).status, 'live');
  });
});
