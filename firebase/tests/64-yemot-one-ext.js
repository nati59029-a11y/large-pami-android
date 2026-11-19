'use strict';
// "כל התוכן בשלוחה אחת" (משימה 2026-11-17, שלבים 1-2): yemot_state/layout, setLineLayout, מונה משותף, ומחיקה/הורדה לפי הנתיב השמור.
// הליבה נקראת בתוך תהליך הבדיקה (כמו 61-yemot-line.js), מול האמולטור ומול שרת ימות מדומה (yemot-mock.js). אין שום פנייה לימות האמיתי.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
const SECRET = (/^YEMOT_API_KEY=(.+)$/m.exec(fs.readFileSync(path.join(H.ROOT, 'functions', '.secret.local'), 'utf8')) || [])[1];

// הגדרות קבועות לכל הקובץ (כמו CORE_ENV ב-61), כדי שקריאות במקביל לא ידרסו זו את זו
const ENV = { YEMOT_EXT: '2', YEMOT_TZINTUK_LIST: 'mivtzaim', YEMOT_EMPLOYEE_DAILY: '1', YEMOT_MAX_DAYS: '60', YEMOT_TEXT_MAX: '400',
  YEMOT_TIMEOUT_MS: '15000', YEMOT_RECIPE_MAX: '2500', YEMOT_REC_MAX_SEC: '120', FUNCTIONS_EMULATOR: 'true',
  VOICE_ENGINE: 'yemot-tts', LEXICON_SEED: 'off', VOICE_CACHE_BUCKET: H.PROJECT_ID };
const SAVED = {};
const LINE = '../functions/yemot-line.js';
const PROMO = '../functions/yemot.js';
const BOARD = '../functions/yemot-board.js';
async function core(mod, fn, uid, data) {
  try {
    return { status: 'OK', result: await require(mod)._core[fn]({ auth: uid ? { uid } : undefined, data }, SECRET, BASE) };
  } catch (e) {
    if (!(e && e.httpErrorCode)) throw e;
    return { status: String(e.code).toUpperCase().replace(/-/g, '_'), error: { message: e.message, details: e.details } };
  }
}

const israelDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
let seq = 0;
const rid = () => `t64_${Date.now().toString(36)}_${++seq}`;
const promo = (extra) => Object.assign({ requestId: rid(), promoKey: 'pk_' + rid(), text: 'בדיקה: מבצע דמה ב-10 ₪', until: addDays(israelDay(), 3), withTzintuk: false }, extra || {});
const item = (slot, extra) => Object.assign({ requestId: rid(), slot, text: 'בדיקה: טקסט ל' + slot, source: 'typed' }, extra || {});
const names = (d) => [...M.state.dirs[d].keys()].sort();
const night = (days) => ({ now: new Date(Date.now() + (days || 2) * 86400000), key: SECRET, base: BASE, ext: '2', timeoutMs: 5000 });

async function readDoc(env, p) { let v = null; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function writeDoc(env, p, data) { await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(p).set(data); }); }
const setSingle = (single) => core(LINE, 'setLayout', 'u_mgr', { single, confirm: true });

describe('ימות: כל התוכן בשלוחה אחת (yemot_state/layout)', () => {
  let env;
  before(async () => {
    if (!process.env.FUNCTIONS_EMULATOR_HOST && !process.env.FIREBASE_EMULATOR_HUB) throw new Error('הבדיקות רצות רק בתוך האמולטור (npm test)');
    assert.ok(SECRET && SECRET.startsWith('DUMMY-SECRET-'), 'חסר סוד דמה YEMOT_API_KEY');
    env = await H.getEnv();
    await M.start(PORT);
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
    require('../functions/index.js');
    for (const [k, v] of Object.entries(ENV)) { SAVED[k] = process.env[k]; process.env[k] = v; }
  });
  after(async () => {
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await M.stop();
  });
  beforeEach(async () => { await H.seed(env); await H.grantLine(env); M.reset(); });

  it('index.js מייצא את setLineLayout', () => {
    assert.equal(typeof require('../functions/index.js').setLineLayout, 'function');
  });

  it('בלי מסמך הגדרה: getLineState מחזיר את המבנה הרגיל (1/2/3/4), והעלאות הולכות לשלוחות של היום', async () => {
    const st = await core(LINE, 'lineState', 'u_emp', {});
    assert.equal(st.status, 'OK');
    assert.deepEqual(st.result.layout, { single: false, ext: '1', exts: { recipes: '1', promos: '2', updates: '3', hours: '4' } });
    assert.equal((await core(PROMO, 'sendPromo', 'u_mgr', promo())).status, 'OK');
    assert.equal((await core(LINE, 'publishItem', 'u_mgr', item('updates'))).status, 'OK');
    assert.deepEqual(names('2'), ['000.tts', '001.tts']);
    assert.deepEqual(names('3'), ['000.tts', '001.tts']);
    assert.equal((await readDoc(env, 'yemot_state/line')).nextNum, 2);
    assert.equal(await readDoc(env, 'yemot_state/layout'), null, 'שום מסמך הגדרה לא נוצר מעצמו');
  });

  it('setLineLayout: עובד נדחה, בלי אישור נדחה, קלט לא תקין נדחה; מנהל – נשמר בלי שום פנייה לימות', async () => {
    let r = await core(LINE, 'setLayout', 'u_emp', { single: true, confirm: true });
    assert.equal(r.status, 'PERMISSION_DENIED'); assert.equal(r.error.details.reason, 'manager-only');
    r = await core(LINE, 'setLayout', 'u_mgr', { single: true });
    assert.equal(r.status, 'INVALID_ARGUMENT'); assert.equal(r.error.details.reason, 'confirm-needed');
    r = await core(LINE, 'setLayout', 'u_mgr', { single: 'yes', confirm: true });
    assert.equal(r.status, 'INVALID_ARGUMENT'); assert.equal(r.error.details.reason, 'bad-input');
    r = await core(LINE, 'setLayout', 'u_mgr', { single: true, confirm: true, ext: '3' });
    assert.equal(r.status, 'INVALID_ARGUMENT');
    assert.equal(await readDoc(env, 'yemot_state/layout'), null);
    r = await setSingle(true);
    assert.equal(r.status, 'OK'); assert.equal(r.result.single, true); assert.match(r.result.message, /שלוחה 1/);
    const d = await readDoc(env, 'yemot_state/layout');
    assert.equal(d.single, true); assert.equal(d.ext, '1'); assert.equal(d.updatedBy, 'u_mgr');
    assert.equal(M.state.requests.length, 0, 'שינוי ההגדרה לא פונה לימות');
    const st = await core(LINE, 'lineState', 'u_emp', {});
    assert.deepEqual(st.result.layout.exts, { recipes: '1', promos: '1', updates: '1', hours: '1' });
  });

  it('שלוחה אחת: מבצע ומתכון במקביל מקבלים מספרים שונים בשלוחה 1 (מונה משותף yemot_state/ext-1); עדכון ושעות גם לשלוחה 1', async () => {
    await setSingle(true);
    const [p, r] = await Promise.all([core(PROMO, 'sendPromo', 'u_mgr', promo()), core(LINE, 'publishItem', 'u_mgr', item('recipes'))]);
    assert.equal(p.status, 'OK', JSON.stringify(p.error)); assert.equal(r.status, 'OK', JSON.stringify(r.error));
    assert.notEqual(p.result.file, r.result.file);
    assert.deepEqual(names('1'), ['000.tts', '001.tts', '002.tts']);
    assert.deepEqual(names('2'), ['000.tts'], 'שום דבר לא עלה לשלוחה 2');
    const pr = await readDoc(env, `yemot_promos/${p.result.promoKey}`);
    assert.match(pr.path, /^ivr2:1\/00[12]\.tts$/);
    const u = await core(LINE, 'publishItem', 'u_emp', item('updates'));
    const h = await core(LINE, 'publishItem', 'u_mgr', item('hours'));
    assert.equal(u.result.path, 'ivr2:1/003.tts'); assert.equal(h.result.path, 'ivr2:1/004.tts');
    assert.match(u.result.message, /שלוחה 1/); assert.match(h.result.message, /שלוחה 1/);
    assert.equal((await readDoc(env, `yemot_items/${u.result.id}`)).ext, '1');
    assert.equal((await readDoc(env, 'yemot_state/ext-1')).nextNum, 5);
    assert.equal(await readDoc(env, 'yemot_state/line'), null, 'המונה של שלוחה 2 לא נגע');
    assert.deepEqual(names('3'), ['000.tts']); assert.deepEqual(names('4'), ['000.tts']);
  });

  it('מבצע שכבר בשלוחה 2 ונשלח שוב אחרי המעבר: עולה לשלוחה 1, והקובץ הישן בשלוחה 2 נמחק אחרי ההעלאה', async () => {
    const first = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: 'pk_move_one_1' }));
    assert.equal(first.result.file, '001.tts'); assert.deepEqual(names('2'), ['000.tts', '001.tts']);
    await setSingle(true);
    const again = await core(PROMO, 'sendPromo', 'u_mgr', promo({ promoKey: 'pk_move_one_1' }));
    assert.equal(again.status, 'OK', JSON.stringify(again.error));
    assert.deepEqual(names('2'), ['000.tts'], 'הקובץ הישן ירד משלוחה 2');
    assert.deepEqual(names('1'), ['000.tts', '001.tts']);
    assert.equal((await readDoc(env, 'yemot_promos/pk_move_one_1')).path, 'ivr2:1/001.tts');
  });

  it('מבצע ישן בשלוחה 2 יורד בלילה אחרי המעבר (לפי הנתיב השמור), וגם מבצע בשלוחה 1', async () => {
    const old = await core(PROMO, 'sendPromo', 'u_mgr', promo({ until: addDays(israelDay(), 0) }));
    await setSingle(true);
    const neu = await core(PROMO, 'sendPromo', 'u_mgr', promo({ until: addDays(israelDay(), 0) }));
    assert.deepEqual(names('2'), ['000.tts', '001.tts']); assert.deepEqual(names('1'), ['000.tts', '001.tts']);
    const out = await require(PROMO).runExpiry(night(2));
    assert.equal(out.removed, 2, JSON.stringify(out));
    assert.deepEqual(names('2'), ['000.tts']); assert.deepEqual(names('1'), ['000.tts']);
    assert.equal((await readDoc(env, `yemot_promos/${old.result.promoKey}`)).status, 'removed');
    assert.equal((await readDoc(env, `yemot_promos/${neu.result.promoKey}`)).status, 'removed');
  });

  it('הורדה בלילה לא מוחקת קובץ של סוג אחר באותו מספר (מבצע מול מתכון, והודעה זמנית מול מבצע)', async () => {
    await setSingle(true);
    M.state.dirs['1'].set('005.tts', 'מתכון'); M.state.dirs['1'].set('006.tts', 'מבצע');
    const now = new Date().toISOString(), past = addDays(israelDay(), -1);
    await writeDoc(env, 'yemot_promos/pk_due_shared_1', { status: 'live', path: 'ivr2:1/005.tts', file: '005.tts', until: past, text: 'מבצע ישן', updatedAt: now });
    await writeDoc(env, 'yemot_items/it_live_recipe_1', { slot: 'recipes', ext: '1', status: 'live', path: 'ivr2:1/005.tts', file: '005.tts', text: 'מתכון', createdAt: now, updatedAt: now });
    await writeDoc(env, 'yemot_items/it_due_hours_1', { slot: 'hours', ext: '1', status: 'live', temporary: true, until: past, path: 'ivr2:1/006.tts', file: '006.tts', text: 'שעות זמניות', createdAt: now, updatedAt: now });
    await writeDoc(env, 'yemot_promos/pk_live_shared_2', { status: 'live', path: 'ivr2:1/006.tts', file: '006.tts', until: addDays(israelDay(), 20), text: 'מבצע חי', updatedAt: now });
    const o1 = await require(PROMO).runExpiry(night(1));
    const o2 = await require(LINE).runLineExpiry(night(1));
    assert.equal(o1.removed, 0); assert.equal(o2.removed, 0);
    assert.deepEqual(names('1'), ['000.tts', '005.tts', '006.tts'], 'שום קובץ של סוג אחר לא נמחק');
    assert.equal(M.calls('FileAction').length, 0);
    assert.equal((await readDoc(env, 'yemot_promos/pk_due_shared_1')).error, 'path-reused');
    assert.equal((await readDoc(env, 'yemot_items/it_due_hours_1')).error, 'path-reused');
  });

  it('פריט שנכשל ושומר נתיב: מילוי חורים מעל 999 לא לוקח את המספר שלו; ניסיון חוזר שלו לא דורס מבצע שמחזיק את הנתיב (תיקון בודק, סבב 1)', async () => {
    await setSingle(true);
    const now = new Date().toISOString();
    // א. פריט failed (כשל ודאי) עם נתיב 001 – המספר נחשב תפוס במילוי החורים
    await writeDoc(env, 'yemot_state/ext-1', { nextNum: 1000, recent: [] });
    await writeDoc(env, 'yemot_items/t64_failed_keep_a', { slot: 'recipes', ext: '1', status: 'failed', uncertain: false, path: 'ivr2:1/001.tts', file: '001.tts', byUid: 'u_mgr', text: 'מתכון', createdAt: now, updatedAt: now });
    const p = await core(PROMO, 'sendPromo', 'u_mgr', promo());
    assert.equal(p.status, 'OK', JSON.stringify(p.error));
    assert.equal(p.result.file, '002.tts', 'לא 001 – של הפריט שנכשל');
    // ב. מבצע מחזיק את 003, ופריט שנכשל עם אותו נתיב נשלח שוב – מקבל מספר חדש, קובץ המבצע לא נדרס
    M.state.dirs['1'].set('003.tts', 'מבצע');
    await writeDoc(env, 'yemot_state/ext-1', { nextNum: 10, recent: [] });
    await writeDoc(env, 'yemot_promos/pk_hold_003', { status: 'live', path: 'ivr2:1/003.tts', file: '003.tts', until: addDays(israelDay(), 5), text: 'מבצע', updatedAt: now });
    const it2 = item('recipes');
    await writeDoc(env, 'yemot_items/' + it2.requestId, { slot: 'recipes', ext: '1', status: 'failed', uncertain: false, path: 'ivr2:1/003.tts', file: '003.tts', byUid: 'u_mgr', text: 'מתכון', createdAt: now, updatedAt: now });
    const r = await core(LINE, 'publishItem', 'u_mgr', it2);
    assert.equal(r.status, 'OK', JSON.stringify(r.error));
    assert.equal(r.result.path, 'ivr2:1/010.tts');
    assert.equal(M.state.dirs['1'].get('003.tts'), 'מבצע', 'קובץ המבצע לא נדרס');
    // ג. בלי רשומה אחרת – ניסיון חוזר עדיין עולה לאותו נתיב (ההתנהגות הקיימת)
    const it3 = item('recipes');
    await writeDoc(env, 'yemot_items/' + it3.requestId, { slot: 'recipes', ext: '1', status: 'failed', uncertain: false, path: 'ivr2:1/007.tts', file: '007.tts', byUid: 'u_mgr', text: 'מתכון', createdAt: now, updatedAt: now });
    const r3 = await core(LINE, 'publishItem', 'u_mgr', it3);
    assert.equal(r3.status, 'OK', JSON.stringify(r3.error)); assert.equal(r3.result.path, 'ivr2:1/007.tts');
  });

  it('הודעה זמנית בשלוחה 1 יורדת בלילה; הודעה זמנית ישנה בשלוחה 4 – גם', async () => {
    const h4 = await core(LINE, 'publishItem', 'u_mgr', item('hours', { until: israelDay() }));
    await setSingle(true);
    const h1 = await core(LINE, 'publishItem', 'u_mgr', item('hours', { until: israelDay() }));
    assert.equal(h4.result.path, 'ivr2:4/001.tts'); assert.equal(h1.result.path, 'ivr2:1/001.tts');
    const out = await require(LINE).runLineExpiry(night(2));
    assert.equal(out.removed, 2, JSON.stringify(out));
    assert.deepEqual(names('4'), ['000.tts']); assert.deepEqual(names('1'), ['000.tts']);
  });

  it('המסך המשותף: מבצע מוצג כ"מבצע" (מהאפליקציה, לא "קובץ ותיק"), ליד מתכון; הורדת המבצע מוחקת רק אותו', async () => {
    await setSingle(true);
    const p = await core(PROMO, 'sendPromo', 'u_mgr', promo());
    const r = await core(LINE, 'publishItem', 'u_mgr', item('recipes'));
    const b = await core(BOARD, 'board', 'u_mgr', { slot: 'recipes' });
    assert.equal(b.status, 'OK', JSON.stringify(b.error)); assert.equal(b.result.ext, '1');
    const pr = b.result.onLine.find((x) => x.file === p.result.file);
    const it2 = b.result.onLine.find((x) => x.file === r.result.file);
    assert.equal(pr.origin, 'app'); assert.equal(pr.type, 'promos'); assert.equal(pr.ref.kind, 'promo'); assert.notEqual(pr.title, 'קובץ ותיק');
    assert.equal(pr.actions.extend, true, 'מבצע אפשר להאריך');
    assert.equal(it2.type, 'recipes'); assert.equal(it2.actions.extend, false);
    const bp = await core(BOARD, 'board', 'u_emp', { slot: 'promos' });
    assert.equal(bp.status, 'OK'); assert.equal(bp.result.ext, '1');
    assert.ok(bp.result.onLine.some((x) => x.type === 'promos' && x.origin === 'app'));
    const rm = await core(LINE, 'removeItem', 'u_mgr', { requestId: rid(), promoKey: p.result.promoKey });
    assert.equal(rm.status, 'OK', JSON.stringify(rm.error));
    assert.deepEqual(names('1'), ['000.tts', r.result.file].sort());
    // האזנה לקובץ המבצע בשלוחה 1 – מהרשומה (נוסח), לא "מהקו"
    const p2 = await core(PROMO, 'sendPromo', 'u_mgr', promo());
    const ls = await core(BOARD, 'listen', 'u_emp', { ref: { kind: 'file', ext: '1', file: p2.result.file } });
    assert.equal(ls.status, 'OK'); assert.equal(ls.result.mode, 'text');
  });

  it('חזרה ל-single:false מחזירה את ההתנהגות הקודמת: מבצע לשלוחה 2 (מונה yemot_state/line), מתכון לשלוחה 1', async () => {
    await setSingle(true);
    await core(PROMO, 'sendPromo', 'u_mgr', promo());
    const back = await setSingle(false);
    assert.equal(back.status, 'OK'); assert.equal((await readDoc(env, 'yemot_state/layout')).single, false);
    const p = await core(PROMO, 'sendPromo', 'u_mgr', promo());
    const u = await core(LINE, 'publishItem', 'u_mgr', item('updates'));
    assert.equal(p.result.file, '001.tts'); assert.deepEqual(names('2'), ['000.tts', '001.tts']);
    assert.equal(u.result.path, 'ivr2:3/001.tts');
    assert.equal((await readDoc(env, 'yemot_state/line')).nextNum, 2);
    const st = await core(LINE, 'lineState', 'u_emp', {});
    assert.deepEqual(st.result.layout.exts, { recipes: '1', promos: '2', updates: '3', hours: '4' });
    // המבצע שעלה לשלוחה 1 בזמן "שלוחה אחת" עדיין יורד בתאריך שלו
    const out = await require(PROMO).runExpiry(night(10));
    assert.equal(out.removed, 2, JSON.stringify(out)); assert.deepEqual(names('1'), ['000.tts']);
  });
});
