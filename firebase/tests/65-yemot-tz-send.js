'use strict';
// בדיקות משימה 2026-11-18: שליחת צינתוק מ"שלוחות הקו" בלי מבצע (sendLineTzintuk, yemot-tz.js).
// מול אמולטור הפונקציות ושרת ימות מדומה (yemot-mock.js). אין פנייה לימות האמיתי.

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
async function call(uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl('sendLineTzintuk'), { method: 'POST', headers, body: JSON.stringify({ data: data === undefined ? {} : data }) });
  const text = await r.text(); SEEN.push(text);
  let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  return { status: json && json.error ? json.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), result: json && json.result, error: json && json.error, text };
}
async function readDoc(env, p) { let v = null; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function writeDoc(env, p, data) { await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(p).set(data); }); }

const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const monthNow = () => day().slice(0, 7);
let seq = 0;
const rid = () => `tz_${Date.now().toString(36)}_${++seq}`;
const arrTz = () => M.calls('RunTzintuk').filter((q) => Array.isArray(q.body.phones));
const tzlTz = () => M.calls('RunTzintuk').filter((q) => q.body.phones === 'tzl:mivtzaim');
const nums = (n) => Array.from({ length: n }, (_, i) => '050' + String(1000000 + i));
// רשימת "לקוחות משוב" בימות + fblist. entries: [טלפון | [טלפון, חסום]]
async function fbSetup(env, entries) {
  M.state.templates.push({ templateId: 900, description: 'לקוחות משוב', entries: new Map(entries.map((e) => (Array.isArray(e) ? [e[0], { name: null, blocked: e[1] }] : [e, { name: null, blocked: false }]))) });
  await writeDoc(env, 'yemot_state/fblist', { templateId: 900, tzOn: false, sentCount: entries.length });
}
// משוב: 4 לא חסומים (אחד מהם גם ברשימה החינמית), 1 חסום. חינמי: 3 (אחד משותף).
const FB = ['0501111111', '0502222222', ['0503333333', true], '0504444444', '0771234567'];
const FREE = ['0502222222', '+972509999999', '0508888888'];

describe('ימות 2026-11-18: שליחת צינתוקים מהקו (sendLineTzintuk)', () => {
  let env;
  before(async () => {
    if (!process.env.FUNCTIONS_EMULATOR_HOST && !process.env.FIREBASE_EMULATOR_HUB) throw new Error('הבדיקות רצות רק בתוך האמולטור (npm test)');
    assert.ok(SECRET && SECRET.startsWith('DUMMY-SECRET-'), 'חסר סוד דמה YEMOT_API_KEY');
    env = await H.getEnv();
    await M.start(PORT);
  });
  after(async () => {
    await M.stop();
    for (const t of SEEN) assert.ok(!t.includes(SECRET), 'המפתח דלף: ' + t.slice(0, 200));
  });
  beforeEach(async () => { await H.seed(env); M.reset(); });

  it('index.js מייצא את sendLineTzintuk, ולא את _core', () => {
    const ex = require('../functions/index.js');
    assert.equal(typeof ex.sendLineTzintuk, 'function'); assert.equal(ex._core, undefined);
  });

  it('עובד, משתמש לא פעיל ולא מחובר – נדחים בלי שום פנייה לימות ובלי רשומה', async () => {
    await fbSetup(env, FB); M.state.tzl.mivtzaim = FREE.slice();
    for (const [uid, st] of [[null, 'UNAUTHENTICATED'], ['u_out', 'PERMISSION_DENIED'], ['u_off', 'PERMISSION_DENIED'], ['u_emp', 'PERMISSION_DENIED']]) {
      for (const data of [{ action: 'preview', target: 'fb' }, { action: 'send', target: 'all', requestId: rid() }]) {
        const r = await call(uid, data);
        assert.equal(r.status, st, `${uid} ${data.action}: ${r.text}`);
      }
    }
    assert.equal(M.state.requests.length, 0);
    assert.equal(await readDoc(env, 'yemot_state/tzsend'), null);
  });

  it('קלט לא תקין נדחה בלי פנייה לימות', async () => {
    for (const data of [{ action: 'x', target: 'fb' }, { action: 'send', target: 'everyone', requestId: rid() }, { action: 'send', target: 'fb' }, { action: 'send', target: 'fb', requestId: 'a b' }]) {
      const r = await call('u_mgr', data);
      assert.equal(r.status, 'INVALID_ARGUMENT', JSON.stringify(data) + r.text);
    }
    assert.equal(M.state.requests.length, 0);
  });

  it('preview: fb = לקוחות משוב לא חסומים (כולל מי שברשימה החינמית); all = חינמי + משוב שאינו בחינמי; עלות 0.1 למספר בתשלום; לא שולח', async () => {
    await fbSetup(env, FB); M.state.tzl.mivtzaim = FREE.slice();
    const f = await call('u_mgr', { action: 'preview', target: 'fb' });
    assert.equal(f.status, 'OK', f.text);
    assert.equal(f.result.free, 0); assert.equal(f.result.paid, 4); assert.equal(f.result.total, 4); assert.equal(f.result.cost, 0.4); assert.equal(f.result.capped, false);
    const a = await call('u_mgr', { action: 'preview', target: 'all' });
    assert.equal(a.status, 'OK', a.text);
    assert.equal(a.result.free, 3); assert.equal(a.result.paid, 3); assert.equal(a.result.total, 6); assert.equal(a.result.cost, 0.3);
    assert.equal(M.calls('RunTzintuk').length, 0, 'preview לא שולח');
  });

  it('send fb: צינתוק בתשלום רק ללקוחות המשוב (לא חסומים), בלי tzl:; רשומה, מונה חודשי; ניסיון חוזר עם אותו requestId לא שולח', async () => {
    await fbSetup(env, FB); M.state.tzl.mivtzaim = FREE.slice();
    const id = rid();
    const r = await call('u_mgr', { action: 'send', target: 'fb', requestId: id });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.status, 'done'); assert.equal(r.result.sent, 4); assert.equal(r.result.failed, 0); assert.equal(r.result.uncertain, 0); assert.equal(r.result.cost, 0.4);
    assert.equal(tzlTz().length, 0, 'ללקוחות משוב בלבד – בלי הרשימה החינמית');
    assert.equal(arrTz().length, 1);
    assert.deepEqual(arrTz()[0].body.phones.slice().sort(), ['0501111111', '0502222222', '0504444444', '0771234567']);
    const rec = await readDoc(env, 'yemot_tzsend/' + id);
    assert.equal(rec.status, 'done'); assert.equal(rec.target, 'fb'); assert.equal(rec.byUid, 'u_mgr'); assert.ok(rec.at && rec.doneAt);
    assert.equal(rec.result.sent, 4); assert.equal(rec.fbTzSent.length, 4);
    assert.deepEqual((await readDoc(env, 'yemot_state/fblist')).tzMonth, { month: monthNow(), count: 4 });
    assert.equal((await readDoc(env, 'yemot_state/tzsend')).lockAt, null, 'הנעילה שוחררה');
    M.state.requests = [];
    const r2 = await call('u_mgr', { action: 'send', target: 'fb', requestId: id });
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.duplicate, true); assert.equal(r2.result.sent, 4);
    assert.equal(M.state.requests.length, 0, 'אותו requestId – בלי שום פנייה לימות');
    assert.deepEqual((await readDoc(env, 'yemot_state/fblist')).tzMonth, { month: monthNow(), count: 4 });
  });

  it('send all: tzl: לרשימה החינמית (חינם) + מפורש רק למשוב שאינו בה – כל מספר פעם אחת', async () => {
    await fbSetup(env, FB); M.state.tzl.mivtzaim = FREE.slice();
    const id = rid();
    const r = await call('u_mgr', { action: 'send', target: 'all', requestId: id });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.status, 'done'); assert.equal(r.result.sent, 6); assert.equal(r.result.paidSent, 3); assert.equal(r.result.cost, 0.3);
    assert.equal(tzlTz().length, 1);
    assert.equal(arrTz().length, 1);
    const paid = arrTz()[0].body.phones.slice().sort();
    assert.deepEqual(paid, ['0501111111', '0504444444', '0771234567'], 'בלי חסום ובלי מי שברשימה החינמית');
    const cmds = M.state.requests.map((q) => q.cmd + (Array.isArray(q.body.phones) ? '[]' : ''));
    assert.ok(cmds.indexOf('RunTzintuk') < cmds.indexOf('RunTzintuk[]'), 'החינמי קודם');
    const rec = await readDoc(env, 'yemot_tzsend/' + id);
    assert.equal(rec.status, 'done'); assert.equal(rec.freeTz, 'sent'); assert.equal(rec.target, 'all');
    assert.deepEqual((await readDoc(env, 'yemot_state/fblist')).tzMonth, { month: monthNow(), count: 3 }, 'רק בתשלום נספר');
  });

  it('send all בלי רשימת משוב (עוד לא נוצרה): רק tzl:, בלי בתשלום', async () => {
    M.state.tzl.mivtzaim = FREE.slice();
    const r = await call('u_mgr', { action: 'send', target: 'all', requestId: rid() });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.status, 'done'); assert.equal(r.result.sent, 3); assert.equal(r.result.paidSent, 0);
    assert.equal(tzlTz().length, 1); assert.equal(arrTz().length, 0);
  });

  it('פסק זמן בצינתוק בתשלום – uncertain, לא נספר; ניסיון חוזר (אותו requestId) לא שולח', async () => {
    await fbSetup(env, FB); M.state.tzl.mivtzaim = FREE.slice();
    M.setMode('tzphones', 'hang');
    const id = rid();
    const r = await call('u_mgr', { action: 'send', target: 'fb', requestId: id });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.status, 'uncertain'); assert.equal(r.result.uncertain, 4); assert.equal(r.result.sent, 0);
    assert.match(r.result.message, /לא ידוע/);
    const rec = await readDoc(env, 'yemot_tzsend/' + id);
    assert.equal(rec.status, 'uncertain'); assert.equal(rec.fbTz, 'uncertain');
    assert.equal((await readDoc(env, 'yemot_state/fblist')).tzMonth, undefined, 'לא ודאי – לא נספר');
    M.setMode('tzphones', undefined);
    M.state.requests = [];
    const r2 = await call('u_mgr', { action: 'send', target: 'fb', requestId: id });
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.status, 'uncertain'); assert.equal(r2.result.duplicate, true);
    assert.equal(M.state.requests.length, 0, 'אין שליחה חוזרת');
  });

  it('פסק זמן בצינתוק החינמי (all) – uncertain לחינמי, והבתשלום נשלח פעם אחת', async () => {
    await fbSetup(env, FB); M.state.tzl.mivtzaim = FREE.slice();
    M.setMode('tzintuk', 'hang'); M.setMode('tzphones', 'ok'); // רק החינמי (tzl:) לא עונה
    const r = await call('u_mgr', { action: 'send', target: 'all', requestId: rid() });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.status, 'uncertain'); assert.equal(r.result.freeTz, 'uncertain'); assert.equal(r.result.uncertain, 3); assert.equal(r.result.paidSent, 3);
    assert.equal(tzlTz().length, 1); assert.equal(arrTz().length, 1);
  });

  it('שליחה פעילה במקביל נחסמת (busy); רשומה שנתקעה ב-sending – אותו requestId מחזיר "לא ודאי" בלי שליחה', async () => {
    await fbSetup(env, FB);
    await writeDoc(env, 'yemot_state/tzsend', { lockAt: new Date().toISOString(), requestId: 'other_req_1' });
    const r = await call('u_mgr', { action: 'send', target: 'fb', requestId: rid() });
    assert.equal(r.status, 'FAILED_PRECONDITION', r.text); assert.equal(r.error.details.reason, 'busy');
    await writeDoc(env, 'yemot_state/tzsend', { lockAt: null });
    const id = rid();
    await writeDoc(env, 'yemot_tzsend/' + id, { requestId: id, target: 'fb', status: 'sending', byUid: 'u_mgr', at: new Date().toISOString() });
    const r2 = await call('u_mgr', { action: 'send', target: 'fb', requestId: id });
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.status, 'uncertain'); assert.equal(r2.result.duplicate, true);
    assert.equal(M.calls('RunTzintuk').length, 0);
  });

  it('מעל המכסה: preview מסמן capped; send לא שולח כלום (גם לא החינמי) ומזהיר fb-tz-capped', async () => {
    M.state.tzl.mivtzaim = FREE.slice();
    const max = (await call('u_mgr', { action: 'preview', target: 'fb' })).result.max;
    assert.ok(Number.isInteger(max) && max > 0);
    await fbSetup(env, nums(max + 1));
    const p = await call('u_mgr', { action: 'preview', target: 'all' });
    assert.equal(p.result.capped, true); assert.equal(p.result.paid, max + 1);
    const id = rid();
    const r = await call('u_mgr', { action: 'send', target: 'all', requestId: id });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.status, 'capped'); assert.ok(r.result.warnings.includes('fb-tz-capped')); assert.equal(r.result.sent, 0);
    assert.equal(M.calls('RunTzintuk').length, 0);
    assert.equal((await readDoc(env, 'yemot_tzsend/' + id)).status, 'capped');
  });

  it('כשל בקריאת הרשימות לפני שליחה: לא נשלח, ואותו requestId מותר לנסות שוב', async () => {
    await fbSetup(env, FB); M.state.tzl.mivtzaim = FREE.slice();
    M.setMode('entries', 'error');
    const id = rid();
    const r = await call('u_mgr', { action: 'send', target: 'fb', requestId: id });
    assert.equal(r.status, 'UNAVAILABLE', r.text); assert.equal(r.error.details.reason, 'read-failed');
    assert.equal(M.calls('RunTzintuk').length, 0);
    assert.equal((await readDoc(env, 'yemot_tzsend/' + id)).status, 'not-sent');
    M.setMode('entries', 'ok');
    const r2 = await call('u_mgr', { action: 'send', target: 'fb', requestId: id });
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.status, 'done'); assert.equal(r2.result.sent, 4);
  });

  it('כללים: yemot_tzsend ו-yemot_state/tzsend סגורים לאפליקציה (שורש ו-b/)', async () => {
    await writeDoc(env, 'yemot_tzsend/r1', { status: 'done' });
    await writeDoc(env, 'yemot_state/tzsend', { lockAt: null });
    for (const role of ['employee', 'manager']) {
      const db = H.ctxFor(env, role).firestore();
      for (const p of ['yemot_tzsend/r1', 'yemot_state/tzsend', 'b/largpeami/yemot_tzsend/r1']) {
        await assertFails(db.doc(p).get());
        await assertFails(db.doc(p).set({ status: 'x' }));
      }
    }
  });
});
