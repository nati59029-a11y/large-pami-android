'use strict';
// בדיקות שלב 4 (משימה 2026-11-17): לקוחות משוב ← רשימת התפוצה "לקוחות משוב" בימות (yemot-fblist.js, yemotFbList).
// מול אמולטור הפונקציות ושרת ימות מדומה (yemot-mock.js). אין פנייה לימות האמיתי.
// הסנכרון עצמו נקרא בתוך תהליך הבדיקה (runFbSync), כדי לקבוע פסק זמן קצר ולאסוף את היומן (חיפוש המפתח).

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
const SECRET = (/^YEMOT_API_KEY=(.+)$/m.exec(fs.readFileSync(path.join(H.ROOT, 'functions', '.secret.local'), 'utf8')) || [])[1];
const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (name) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${name}`;
const SEEN = [];
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text(); SEEN.push(text);
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  return { status: json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), result: json && json.result, error: json && json.error, text };
}

// הסנכרון בתוך התהליך, עם יומן שנאסף
const LOGS = [];
async function sync(o) {
  const saved = process.env.FUNCTIONS_EMULATOR; process.env.FUNCTIONS_EMULATOR = 'true';
  const ow = process.stdout.write, ew = process.stderr.write;
  process.stdout.write = function (c, ...a) { LOGS.push(String(c)); return ow.call(this, c, ...a); };
  process.stderr.write = function (c, ...a) { LOGS.push(String(c)); return ew.call(this, c, ...a); };
  try {
    const r = await require('../functions/yemot-fblist.js').runFbSync(Object.assign({ key: SECRET, base: BASE, timeoutMs: 1500 }, o || {}));
    SEEN.push(JSON.stringify(r)); return r;
  } finally { process.stdout.write = ow; process.stderr.write = ew; if (saved === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = saved; }
}

async function readDoc(env, p) { let v = null; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function writeDoc(env, p, data) { await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(p).set(data); }); }
async function ids(env, col) { let v = []; await env.withSecurityRulesDisabled(async (c) => { v = (await c.firestore().collection(col).get()).docs.map((d) => d.id).sort(); }); return v; }
// טופס משוב כמו שהאפליקציה שומרת (fbRecJ): data = מחרוזת JSON עם f.phone ו-f.name
const fb = (env, p, phone, name, st) => writeDoc(env, p, { data: JSON.stringify({ f: { phone, name, note: 'טעים' }, by: 'u_emp', at: 1, hi: 0, man: 0, hp: 0, wq: 0 }), img: '', owner: 'u_emp', at: '1', st: st || 'ok' });
const tpl = () => M.state.templates.filter((t) => t.description === 'לקוחות משוב');

describe('ימות שלב 4: לקוחות משוב ← רשימת תפוצה בימות', () => {
  let env;
  before(async () => {
    if (!process.env.FUNCTIONS_EMULATOR_HOST && !process.env.FIREBASE_EMULATOR_HUB) throw new Error('הבדיקות רצות רק בתוך האמולטור (npm test)');
    assert.ok(SECRET && SECRET.startsWith('DUMMY-SECRET-'), 'חסר סוד דמה YEMOT_API_KEY');
    env = await H.getEnv();
    await M.start(PORT);
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
    require('../functions/index.js');
  });
  after(async () => {
    await M.stop();
    // המפתח לא מופיע ביומן ולא בשום תשובה שראינו
    for (const t of LOGS.concat(SEEN)) assert.ok(!t.includes(SECRET), 'המפתח דלף: ' + t.slice(0, 200));
  });
  beforeEach(async () => { await H.seed(env); M.reset(); });

  it('index.js מייצא את yemotFbList, ולא את runFbSync/_core', () => {
    const ex = require('../functions/index.js');
    assert.equal(typeof ex.yemotFbList, 'function');
    assert.equal(ex.runFbSync, undefined); assert.equal(ex._core, undefined);
  });

  it('שורש + b/largpeami נכנסים ומאוחדים לפי טלפון; new לא נכנס; לא תקין נספר נדחה; updateType תמיד UPDATE; הרשימה נוצרת פעם אחת', async () => {
    await fb(env, 'fb/a1', '050-123-4567', 'דנה, כהן');
    await fb(env, 'b/largpeami/fb/a2', '+972501234567', 'דנה');  // אותו טלפון
    await fb(env, 'b/largpeami/fb/a3', '0771234567', 'יוסי');
    await fb(env, 'fb/a4', '0529999999', 'חדש', 'new');            // לא מאושר
    await fb(env, 'fb/a5', '12345', 'שגוי');                        // לא תקין
    await writeDoc(env, 'fb/a6', { data: 'לא JSON', img: '', owner: 'u_emp', at: '1', st: 'ok' }); // לא תקין
    const r = await sync();
    assert.equal(r.error, null, JSON.stringify(r));
    assert.equal(r.sent, 2); assert.equal(r.phones, 2);
    assert.equal(r.invalid, 3, 'a5, a6 וטופס הזרע fb_ok ({}) – נדחים');
    assert.equal(tpl().length, 1);
    assert.deepEqual([...tpl()[0].entries.keys()].sort(), ['0501234567', '0771234567']);
    assert.equal(tpl()[0].entries.get('0501234567').name, 'דנה כהן', 'פסיק בשם הוסר');
    assert.ok(!tpl()[0].entries.has('0529999999'));
    for (const q of M.calls('UploadPhoneList')) assert.equal(q.body.updateType, 'UPDATE');
    for (const c of ['ClearTemplateEntries', 'UpdateTemplateEntries', 'DeleteTemplate', 'UpdateTemplateEntry']) assert.equal(M.calls(c).length, 0, c);
    assert.deepEqual(await ids(env, 'yemot_fbsent'), ['0501234567', '0771234567']);
    const st = await readDoc(env, 'yemot_state/fblist');
    assert.equal(st.templateId, tpl()[0].templateId); assert.equal(st.sentCount, 2); assert.equal(st.lockAt, null); assert.equal(st.lastRun.sent, 2);
    // ריצה שנייה: לא מעלה ולא פונה לימות בכלל
    M.state.requests = [];
    const r2 = await sync();
    assert.equal(r2.sent, 0); assert.equal(r2.already, 2);
    assert.equal(M.state.requests.length, 0);
    // טופס חדש מאושר: רק הוא עולה, לאותה רשימה (מהמזהה השמור – בלי GetTemplates/CreateTemplate)
    await fb(env, 'fb/a7', '0541112222', 'רות');
    const r3 = await sync();
    assert.equal(r3.sent, 1);
    assert.deepEqual(M.calls('UploadPhoneList').map((q) => q.body.data), ['0541112222,רות']);
    assert.equal(M.calls('CreateTemplate').length, 0); assert.equal(M.calls('GetTemplates').length, 0);
    assert.equal(tpl().length, 1); assert.equal(tpl()[0].entries.size, 3);
  });

  it('רשימה קיימת בשם "לקוחות משוב" – נמצאת ב-GetTemplates, בלי יצירה', async () => {
    M.state.templates.push({ templateId: 777, description: 'לקוחות משוב', entries: new Map([['0500000000', { name: 'ותיק', blocked: false }]]) });
    await fb(env, 'fb/b1', '0501234567', 'א');
    const r = await sync();
    assert.equal(r.sent, 1);
    assert.equal(M.calls('CreateTemplate').length, 0);
    assert.equal((await readDoc(env, 'yemot_state/fblist')).templateId, 777);
    assert.ok(M.state.templates[0].entries.has('0500000000'), 'מספר קיים לא נמחק');
  });

  it('פסק זמן ביצירה לא יוצר רשימה שנייה, ולא מסמן נשלח', async () => {
    await fb(env, 'fb/c1', '0501234567', 'א');
    M.setMode('create', 'hangafter');
    const r = await sync();
    assert.equal(r.error, 'create-uncertain'); assert.equal(r.sent, 0);
    assert.deepEqual(await ids(env, 'yemot_fbsent'), []);
    assert.equal(M.calls('UploadPhoneList').length, 0);
    M.setMode('create', 'ok');
    const r2 = await sync();
    assert.equal(r2.sent, 1, JSON.stringify(r2));
    assert.equal(tpl().length, 1, 'נוצרה רשימה שנייה');
    assert.equal(M.calls('CreateTemplate').length, 1);
  });

  it('פסק זמן בהעלאה: לא ודאי, לא מסומן; הריצה הבאה משלימה (UPDATE, בלי כפילות)', async () => {
    await fb(env, 'fb/d1', '0501234567', 'א');
    M.setMode('phonelist', 'hangafter');
    const r = await sync();
    assert.equal(r.error, 'upload-uncertain'); assert.equal(r.uncertain, 1); assert.equal(r.sent, 0);
    assert.deepEqual(await ids(env, 'yemot_fbsent'), []);
    M.setMode('phonelist', 'ok');
    const r2 = await sync();
    assert.equal(r2.sent, 1); assert.equal(tpl()[0].entries.size, 1);
  });

  it('מספר שימות דוחה (INVALID) – נספר נדחה ולא נשלח שוב; שגיאה מימות – לא מסומן', async () => {
    await fb(env, 'fb/e1', '0501234567', 'א'); await fb(env, 'fb/e2', '0509999999', 'ב');
    M.state.invalidPhones = ['0509999999'];
    try {
      const r = await sync();
      assert.equal(r.sent, 1); assert.equal(r.rejected, 1);
      assert.equal((await readDoc(env, 'yemot_fbsent/0509999999')).st, 'rejected');
      assert.equal((await readDoc(env, 'yemot_state/fblist')).rejectedCount, 1);
    } finally { delete M.state.invalidPhones; }
    await fb(env, 'fb/e3', '0541112222', 'ג');
    M.setMode('phonelist', 'error');
    const r2 = await sync();
    assert.equal(r2.error, 'upload-failed'); assert.equal(r2.sent, 0);
    assert.equal(await readDoc(env, 'yemot_fbsent/0541112222'), null);
  });

  it('ספירה של ימות קטנה ממספר השורות (השורה הראשונה נקראה ככותרת) – אף מספר לא מסומן נשלח; uncertain; lastError count-mismatch (תיקון בודק, סבב 1)', async () => {
    await fb(env, 'fb/k1', '0501234567', 'א'); await fb(env, 'fb/k2', '0541112222', 'ב');
    M.state.headerRow = true;
    const r = await sync();
    assert.equal(r.error, 'count-mismatch'); assert.equal(r.sent, 0); assert.equal(r.uncertain, 2);
    assert.deepEqual(await ids(env, 'yemot_fbsent'), []);
    const s = await call('yemotFbList', 'u_mgr', { action: 'state' });
    assert.equal(s.result.lastError, 'count-mismatch'); assert.equal(s.result.pending, 2); assert.equal(s.result.sent, 0);
    M.state.headerRow = false;
    const r2 = await sync();
    assert.equal(r2.error, null); assert.equal(r2.sent, 2);
    assert.deepEqual(await ids(env, 'yemot_fbsent'), ['0501234567', '0541112222']);
  });

  it('נעילה: סנכרון שני בזמן ריצה – busy, בלי פנייה לימות', async () => {
    await fb(env, 'fb/f1', '0501234567', 'א');
    await writeDoc(env, 'yemot_state/fblist', { lockAt: new Date().toISOString() });
    const r = await sync();
    assert.equal(r.busy, true); assert.equal(M.state.requests.length, 0);
    await writeDoc(env, 'yemot_state/fblist', { lockAt: new Date(Date.now() - 11 * 60000).toISOString() });
    assert.equal((await sync()).sent, 1, 'נעילה ישנה משתחררת');
  });

  it('yemotFbList: עובד ולא מחובר נדחים בלי פנייה לימות; מנהל – state/sync/setTz', async () => {
    await fb(env, 'fb/g1', '0501234567', 'א');
    for (const [uid, st] of [[null, 'UNAUTHENTICATED'], ['u_out', 'PERMISSION_DENIED'], ['u_off', 'PERMISSION_DENIED'], ['u_emp', 'PERMISSION_DENIED']]) {
      for (const data of [{ action: 'state' }, { action: 'sync' }, { action: 'setTz', on: true }]) {
        const r = await call('yemotFbList', uid, data);
        assert.equal(r.status, st, `${uid} ${data.action}: ${r.text}`);
      }
    }
    assert.equal(M.state.requests.length, 0);
    assert.equal(await readDoc(env, 'yemot_state/fblist'), null);
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    const s0 = await call('yemotFbList', 'u_mgr', { action: 'state' });
    assert.equal(s0.status, 'OK', s0.text);
    assert.deepEqual(s0.result, { ok: true, templateId: null, tzOn: false, sent: 0, rejected: 0, uncertain: 0, pending: 1, lastRun: null, lastError: null, tzMonth: { month, count: 0 }, tzMax: 300 });
    assert.equal(M.state.requests.length, 0, 'state לא פונה לימות');
    const s1 = await call('yemotFbList', 'u_mgr', { action: 'sync' });
    assert.equal(s1.status, 'OK', s1.text);
    assert.deepEqual(s1.result.run, { sent: 1, rejected: 0, uncertain: 0, created: true });
    assert.equal(s1.result.sent, 1); assert.equal(s1.result.pending, 0); assert.equal(s1.result.templateId, tpl()[0].templateId);
    assert.equal(s1.result.lastError, null); assert.ok(typeof s1.result.lastRun === 'string');
    assert.ok(M.state.requests.every((q) => q.auth === SECRET), 'המפתח רק בכותרת');
    assert.ok(M.state.requests.every((q) => !JSON.stringify(q.body).includes(SECRET)));
    const t = await call('yemotFbList', 'u_mgr', { action: 'setTz', on: true });
    assert.equal(t.result.tzOn, true); assert.equal(t.result.sent, 1); assert.deepEqual(t.result.tzMonth, { month, count: 0 });
    assert.equal((await readDoc(env, 'yemot_state/fblist')).tzOn, true);
    assert.equal((await call('yemotFbList', 'u_mgr', { action: 'setTz', on: 'yes' })).error.details.reason, 'bad-input');
    assert.equal((await call('yemotFbList', 'u_mgr', { action: 'wipe' })).error.details.reason, 'bad-input');
    // ריצה שנייה: created:false, אין העלאה
    const s2 = await call('yemotFbList', 'u_mgr', { action: 'sync' });
    assert.deepEqual(s2.result.run, { sent: 0, rejected: 0, uncertain: 0, created: false });
    // נעול ← busy
    await writeDoc(env, 'yemot_state/fblist', { lockAt: new Date().toISOString() });
    const b = await call('yemotFbList', 'u_mgr', { action: 'sync' });
    assert.equal(b.status, 'FAILED_PRECONDITION'); assert.equal(b.error.details.reason, 'busy');
    // שגיאה מימות ← lastError קוד קצר, בלי טקסט מימות
    await writeDoc(env, 'yemot_state/fblist', { templateId: tpl()[0].templateId });
    await fb(env, 'fb/g2', '0541112222', 'ב');
    M.setMode('phonelist', 'error');
    const e = await call('yemotFbList', 'u_mgr', { action: 'sync' });
    assert.equal(e.status, 'OK', e.text); assert.equal(e.result.lastError, 'upload-failed'); assert.equal(e.result.pending, 1);
    assert.ok(!e.text.includes('incorrect'));
  });

  it('הריצה הלילית (nightly) מריצה את הסנכרון', async () => {
    await fb(env, 'fb/h1', '0501234567', 'א');
    const out = await require('../functions/yemot.js')._core.nightly({ key: SECRET, base: BASE, ext: '2', timeoutMs: 1500, skipCache: true });
    assert.equal(out.fblist && out.fblist.sent, 1, JSON.stringify(out));
    assert.equal(out.fblist.by, 'nightly');
  });

  it('כללים: yemot_fbsent ו-yemot_state/fblist סגורים לאפליקציה (שורש ו-b/)', async () => {
    await writeDoc(env, 'yemot_fbsent/0501234567', { st: 'sent' });
    await writeDoc(env, 'yemot_state/fblist', { tzOn: false });
    for (const role of ['employee', 'manager']) {
      const db = H.ctxFor(env, role).firestore();
      for (const p of ['yemot_fbsent/0501234567', 'yemot_state/fblist', 'b/largpeami/yemot_fbsent/0501234567']) {
        await assertFails(db.doc(p).get());
        await assertFails(db.doc(p).set({ st: 'sent' }));
      }
    }
  });

  it('בקוד אין פקודות מחיקה של רשימת תפוצה: לא NEW/REMOVE, לא ClearTemplateEntries/UpdateTemplateEntries/DeleteTemplate, לא resetList', () => {
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const f of ['lib/yemot-client.js', 'yemot-fblist.js']) {
      const t = strip(fs.readFileSync(path.join(H.ROOT, 'functions', f), 'utf8'));
      assert.ok(!/'NEW'|'REMOVE'|ClearTemplateEntries|UpdateTemplateEntr|DeleteTemplate|resetList/.test(t), f);
    }
    assert.match(fs.readFileSync(path.join(H.ROOT, 'functions', 'lib/yemot-client.js'), 'utf8'), /updateType: 'UPDATE'/);
  });

  // ---------------- שלב 5: צינתוק ללקוחות משוב במבצע (sendPromo ב-yemot.js) ----------------
  const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const in3 = () => { const [y, m, d] = day().split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 3)).toISOString().slice(0, 10); };
  let pseq = 0;
  const promo = (extra) => { const k = `fbtz_${Date.now().toString(36)}_${++pseq}`; return Object.assign({ requestId: 'rq_' + k, promoKey: 'pk_' + k, text: 'מבצע דמה ללקוחות משוב', until: in3(), withTzintuk: true }, extra || {}); };
  // רשימת תפוצה בימות + מסמך fblist. entries: [טלפון | [טלפון, חסום]]
  async function fbSetup(entries, tzOn) {
    M.state.templates.push({ templateId: 900, description: 'לקוחות משוב', entries: new Map(entries.map((e) => (Array.isArray(e) ? [e[0], { name: null, blocked: e[1] }] : [e, { name: null, blocked: false }]))) });
    await writeDoc(env, 'yemot_state/fblist', { templateId: 900, tzOn: tzOn !== false, sentCount: entries.length });
  }
  const arrTz = () => M.calls('RunTzintuk').filter((q) => Array.isArray(q.body.phones));
  const tzlTz = () => M.calls('RunTzintuk').filter((q) => q.body.phones === 'tzl:mivtzaim');
  const monthNow = () => day().slice(0, 7);

  it('שלב 5: מנהל + מתג דולק – צינתוק רגיל ואחריו מערך: לא חסומים, בלי מי שברשימה החינמית, כפול פעם אחת; נרשם במבצע ובמונה החודשי', async () => {
    await fbSetup(['0501111111', '0502222222', ['0503333333', true], ['0505555555', 1], ['0506666666', '1'], '0504444444', '0771234567', ['0508888888', 0]]);
    M.state.tzl.mivtzaim = ['0502222222', '+972504444444']; // כפולים בשתי הרשימות (גם בפורמט אחר)
    const st = await call('sendPromoToLine', 'u_mgr', { statusOnly: true });
    assert.deepEqual(st.result.fbTz, { on: true, upTo: 8, max: 300 });
    assert.equal(M.state.requests.length, 0, 'statusOnly לא פונה לימות');
    const p = promo();
    const r = await call('sendPromoToLine', 'u_mgr', p);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.tzintuk, 'sent'); assert.equal(r.result.fbTz, 'sent'); assert.equal(r.result.fbTzCount, 3);
    assert.match(r.result.message, /גם 3 לקוחות משוב קיבלו צינתוק/);
    assert.equal(tzlTz().length, 1); assert.equal(arrTz().length, 1);
    assert.deepEqual(arrTz()[0].body.phones.slice().sort(), ['0501111111', '0508888888', '0771234567'], 'חסום (true/1/"1") לא; blocked:0 כן; מי שברשימה החינמית לא (כבר קיבל)');
    const cmds = M.state.requests.map((q) => q.cmd);
    assert.ok(cmds.indexOf('RunTzintuk') < cmds.indexOf('GetTemplateEntries'), 'הרגיל קודם');
    const rec = await readDoc(env, 'yemot_promos/' + p.promoKey);
    assert.equal(rec.tzintuk, 'sent'); assert.equal(rec.fbTz, 'sent'); assert.equal(rec.fbTzCount, 3); assert.equal(rec.lastResult, 'done');
    assert.deepEqual((await readDoc(env, 'yemot_state/fblist')).tzMonth, { month: monthNow(), count: 3 });
    const s = await call('yemotFbList', 'u_mgr', { action: 'state' });
    assert.deepEqual(s.result.tzMonth, { month: monthNow(), count: 3 });
    // שליחה חוזרת של אותו מבצע (אותו נוסח, הכול נשלח) – בלי שום פנייה לימות
    M.state.requests = [];
    const r2 = await call('sendPromoToLine', 'u_mgr', promo({ promoKey: p.promoKey }));
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.action, 'none'); assert.equal(M.state.requests.length, 0);
  });

  it('שלב 5: עובד – אף פעם לא; מתג כבוי – לא; בלי צינתוק – לא', async () => {
    await fbSetup(['0501111111']);
    const e = await call('sendPromoToLine', 'u_emp', promo());
    assert.equal(e.status, 'OK', e.text); assert.equal(e.result.tzintuk, 'sent'); assert.equal(e.result.fbTz, undefined);
    assert.equal((await call('sendPromoToLine', 'u_emp', { statusOnly: true })).result.fbTz, undefined);
    const n = await call('sendPromoToLine', 'u_mgr', promo({ withTzintuk: false }));
    assert.equal(n.status, 'OK', n.text);
    assert.equal(arrTz().length, 0); assert.equal(M.calls('GetTemplateEntries').length, 0);
    await writeDoc(env, 'yemot_state/fblist', { templateId: 900, tzOn: false });
    const m = await call('sendPromoToLine', 'u_mgr', promo());
    assert.equal(m.result.tzintuk, 'sent'); assert.equal(m.result.fbTz, undefined);
    assert.equal(arrTz().length, 0); assert.equal(M.calls('GetTemplateEntries').length, 0);
    assert.equal((await readDoc(env, 'yemot_state/fblist')).tzMonth, undefined);
  });

  it('שלב 5: מעל המכסה (300) – לא נשלח לאף לקוח משוב, אזהרה fb-tz-capped; הצינתוק הרגיל נשלח', async () => {
    await fbSetup(Array.from({ length: 301 }, (_, i) => '050' + String(1000000 + i)));
    const p = promo();
    const r = await call('sendPromoToLine', 'u_mgr', p);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.tzintuk, 'sent'); assert.equal(r.result.fbTz, 'capped'); assert.equal(r.result.fbTzCount, 0);
    assert.ok(r.result.warnings.includes('fb-tz-capped'));
    assert.match(r.result.message, /301 מספרים, יותר מהמכסה \(300\)/);
    assert.equal(arrTz().length, 0); assert.equal(tzlTz().length, 1);
    assert.equal((await readDoc(env, 'yemot_promos/' + p.promoKey)).fbTz, 'capped');
    assert.equal((await readDoc(env, 'yemot_state/fblist')).tzMonth, undefined);
  });

  it("שלב 5: כשל ודאי (קריאת הרשימה נכשלה, לא יצא צינתוק) – fbTz:'failed' בלי לשנות tzintuk:'sent'; ניסיון חוזר משלים רק את המשוב", async () => {
    await fbSetup(['0501111111', '0502222222']);
    M.setMode('entries', 'error');
    const p = promo();
    const r = await call('sendPromoToLine', 'u_mgr', p);
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.tzintuk, 'sent'); assert.equal(r.result.fbTz, 'failed'); assert.equal(r.result.fbTzCount, 0);
    assert.match(r.result.message, /הצינתוק ללקוחות המשוב לא נשלח/);
    assert.ok(!r.text.includes('incorrect')); assert.equal(arrTz().length, 0);
    let rec = await readDoc(env, 'yemot_promos/' + p.promoKey);
    assert.equal(rec.tzintuk, 'sent'); assert.equal(rec.fbTz, 'failed'); assert.equal(rec.lastResult, 'partial'); assert.equal(rec.lockAt, null);
    M.setMode('entries', 'ok');
    M.state.requests = [];
    const r2 = await call('sendPromoToLine', 'u_mgr', p);
    assert.equal(r2.status, 'OK', r2.text);
    assert.equal(r2.result.action, 'tzintuk-only'); assert.equal(r2.result.fbTz, 'sent'); assert.equal(r2.result.fbTzCount, 2);
    assert.match(r2.result.message, /הצינתוק לנרשמים כבר נשלח/);
    assert.equal(tzlTz().length, 0, 'הצינתוק הרגיל לא נשלח שוב');
    assert.equal(M.calls('UploadTextFile').length, 0); assert.equal(arrTz().length, 1);
    rec = await readDoc(env, 'yemot_promos/' + p.promoKey);
    assert.equal(rec.tzintuk, 'sent'); assert.equal(rec.fbTz, 'sent'); assert.equal(rec.lastResult, 'done');
    M.state.requests = [];
    assert.equal((await call('sendPromoToLine', 'u_mgr', promo({ promoKey: p.promoKey }))).result.action, 'none');
    assert.equal(M.state.requests.length, 0);
  });

  for (const [what, mode] of [['פסק זמן ב-RunTzintuk למערך', 'hang'], ['שגיאה מימות אחרי שהקריאה יצאה', 'error']]) {
    it(`שלב 5: ${what} – fbTz:'uncertain', הודעה "לא ידוע", tzintuk נשאר 'sent'; אין שליחה חוזרת אוטומטית (סבב 2)`, async () => {
      await fbSetup(['0501111111', '0502222222']);
      M.setMode('tzphones', mode);
      const p = promo();
      const r = await call('sendPromoToLine', 'u_mgr', p);
      assert.equal(r.status, 'OK', r.text);
      assert.equal(r.result.tzintuk, 'sent'); assert.equal(r.result.fbTz, 'uncertain'); assert.equal(r.result.fbTzCount, 0);
      assert.match(r.result.message, /לא ידוע אם הצינתוק ללקוחות המשוב נשלח – בדקו בימות לפני שליחה חוזרת/);
      const rec = await readDoc(env, 'yemot_promos/' + p.promoKey);
      assert.equal(rec.tzintuk, 'sent'); assert.equal(rec.fbTz, 'uncertain'); assert.equal(rec.lockAt, null);
      assert.equal((await readDoc(env, 'yemot_state/fblist')).tzMonth, undefined, 'לא נספר במונה (לא ודאי)');
      M.setMode('tzphones', undefined);
      M.state.requests = [];
      for (const q of [p, promo({ promoKey: p.promoKey })]) {
        const r2 = await call('sendPromoToLine', 'u_mgr', q);
        assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.action, 'none');
      }
      assert.equal(M.state.requests.length, 0, 'אין RunTzintuk נוסף');
    });
  }

  it("שלב 5: fbTz:'pending' (קריסה באמצע) – כמו לא ודאי, אין שליחה (סבב 2)", async () => {
    await fbSetup(['0501111111']);
    const p = promo();
    assert.equal((await call('sendPromoToLine', 'u_mgr', p)).result.fbTz, 'sent');
    await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc('yemot_promos/' + p.promoKey).update({ fbTz: 'pending', lastResult: 'partial' }); });
    M.state.requests = [];
    const r = await call('sendPromoToLine', 'u_mgr', p);
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.action, 'none');
    assert.equal(M.state.requests.length, 0);
  });

  it('שלב 5: מבצע ישן בלי fbTz (נשלח לפני שהמתג הודלק) – הארכת תאריך לא שולחת צינתוק בתשלום (סבב 2)', async () => {
    await fbSetup(['0501111111'], false);
    const p = promo();
    assert.equal((await call('sendPromoToLine', 'u_mgr', p)).result.tzintuk, 'sent');
    assert.equal((await readDoc(env, 'yemot_promos/' + p.promoKey)).fbTz, undefined);
    await writeDoc(env, 'yemot_state/fblist', { templateId: 900, tzOn: true });
    M.state.requests = [];
    const [y, m, d] = in3().split('-').map(Number);
    const r = await call('sendPromoToLine', 'u_mgr', promo({ promoKey: p.promoKey, until: new Date(Date.UTC(y, m - 1, d + 4)).toISOString().slice(0, 10) }));
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.action, 'none'); assert.equal(r.result.fbTz, undefined);
    assert.equal(M.calls('RunTzintuk').length, 0); assert.equal(M.state.requests.length, 0);
  });

  it('נרמול טלפון ושם', () => {
    const { normPhone, cleanName } = require('../functions/yemot-fblist.js')._core;
    assert.equal(normPhone('050-123 4567'), '0501234567'); assert.equal(normPhone('00972-3-1234567'), '031234567');
    assert.equal(normPhone('501234567'), '0501234567'); assert.equal(normPhone(501234567), '0501234567');
    for (const b of ['', '123', '0601234567', '05012345678', 'tpl:12', null, undefined, {}]) assert.equal(normPhone(b), null, String(b));
    assert.equal(cleanName('א\nב,ג‏'.padEnd(60, 'ד')).length, 40);
    assert.equal(cleanName(5), '');
  });
});
