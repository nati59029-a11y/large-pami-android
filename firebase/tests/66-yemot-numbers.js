'use strict';
// "מספרים בקו" (משימה 2026-11-19): yemotFbList { action:'numbers' | 'block' | 'unblock' }.
// מול אמולטור הפונקציות ושרת ימות מדומה (yemot-mock.js). אין פנייה לימות האמיתי.

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
const fbl = (uid, data) => call('yemotFbList', uid, data);
async function readDoc(env, p) { let v = null; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function writeDoc(env, p, data) { await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(p).set(data); }); }
const fbForm = (env, p, phone, name) => writeDoc(env, p, { data: JSON.stringify({ f: { phone, name }, by: 'u_emp', at: 1, hi: 0, man: 0, hp: 0, wq: 0 }), img: '', owner: 'u_emp', at: '1', st: 'ok' });

const TPL = 900;
const entry = (t, p) => t.entries.get(p);
async function setup(env, withList) {
  const t = { templateId: TPL, description: 'לקוחות משוב', entries: new Map([
    ['0501111111', { name: 'דנה', blocked: false }], ['0502222222', { name: null, blocked: false }], ['0503333333', { name: 'חסום', blocked: true }], ['0771234567', { name: 'יוסי', blocked: false }],
  ]) };
  M.state.templates.push(t);
  M.state.tzl.mivtzaim = ['0502222222', '+972509999999', '0508888888'];
  if (withList !== false) await writeDoc(env, 'yemot_state/fblist', { templateId: TPL, tzOn: true, sentCount: 4 });
  return t;
}

describe('ימות 2026-11-19: מספרים בקו – הצגה, חיפוש וחסימה', () => {
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

  it('עובד, לא פעיל ולא מחובר – נדחים בלי שום פנייה לימות', async () => {
    const t = await setup(env);
    for (const [uid, st] of [[null, 'UNAUTHENTICATED'], ['u_out', 'PERMISSION_DENIED'], ['u_off', 'PERMISSION_DENIED'], ['u_emp', 'PERMISSION_DENIED']]) {
      for (const data of [{ action: 'numbers' }, { action: 'block', phone: '0501111111' }, { action: 'unblock', phone: '0503333333' }]) {
        const r = await fbl(uid, data);
        assert.equal(r.status, st, `${uid} ${data.action}: ${r.text}`);
      }
    }
    assert.equal(M.state.requests.length, 0);
    assert.equal(entry(t, '0501111111').blocked, false); assert.equal(entry(t, '0503333333').blocked, true);
    assert.equal(await readDoc(env, 'yemot_fbsent/0501111111'), null);
  });

  it('numbers: שתי הרשימות, כמויות, נרמול (+972 ← 0), בלי שינוי בימות; המפתח רק בכותרת', async () => {
    await setup(env);
    const r = await fbl('u_mgr', { action: 'numbers' });
    assert.equal(r.status, 'OK', r.text);
    const x = r.result;
    assert.deepEqual(x.counts, { free: 3, fbActive: 3, fbBlocked: 1 });
    assert.deepEqual(x.free.slice().sort(), ['0502222222', '0508888888', '0509999999']);
    assert.deepEqual(x.fb.find((e) => e.p === '0503333333'), { p: '0503333333', b: true, n: 'חסום' });
    assert.deepEqual(x.fb.find((e) => e.p === '0502222222'), { p: '0502222222', b: false, n: '' });
    assert.equal(x.listReady, true); assert.equal(x.freeErr, null); assert.equal(x.fbErr, null); assert.equal(x.listName, 'mivtzaim');
    assert.deepEqual(M.state.requests.map((q) => q.cmd).sort(), ['GetTemplateEntries', 'TzintukimListManagement']);
    assert.equal(M.calls('TzintukimListManagement')[0].body.action, 'getlistEnteres');
    assert.ok(M.state.requests.every((q) => q.auth === SECRET && !JSON.stringify(q.body).includes(SECRET)));
  });

  it('numbers: רשימת לקוחות משוב עוד לא נוצרה – רק הרשימה החינמית; כשל באחת לא מסתיר את השנייה (קוד קצר, בלי טקסט מימות)', async () => {
    await setup(env, false);
    const a = await fbl('u_mgr', { action: 'numbers' });
    assert.equal(a.status, 'OK', a.text);
    assert.equal(a.result.listReady, false); assert.deepEqual(a.result.fb, []); assert.equal(a.result.counts.free, 3);
    assert.equal(M.calls('GetTemplateEntries').length, 0);
    await writeDoc(env, 'yemot_state/fblist', { templateId: TPL });
    M.setMode('tzl', 'error');
    const b = await fbl('u_mgr', { action: 'numbers' });
    assert.equal(b.status, 'OK', b.text);
    assert.equal(b.result.freeErr, 'status-ERROR'); assert.deepEqual(b.result.free, []); assert.equal(b.result.fb.length, 4);
    assert.ok(!b.text.includes('incorrect'));
  });

  it('block ואז unblock: לפי rowid, עם השם (לא נמחק), מנורמל מכל צורה; המספר מסומן "נשלח" כדי שהסנכרון לא יעלה אותו שוב', async () => {
    const t = await setup(env);
    const r = await fbl('u_mgr', { action: 'block', phone: '+972-50-111-1111' });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(r.result, { ok: true, phone: '0501111111', blocked: true, changed: 1 });
    assert.equal(entry(t, '0501111111').blocked, true); assert.equal(entry(t, '0501111111').name, 'דנה');
    const u = M.calls('UpdateTemplateEntry');
    assert.equal(u.length, 1);
    assert.deepEqual(u[0].body, { templateId: TPL, rowid: 1, phone: '0501111111', blocked: 1, name: 'דנה' });
    assert.equal((await readDoc(env, 'yemot_fbsent/0501111111')).by, 'block');
    // שאר המספרים לא נגעו
    assert.equal(entry(t, '0502222222').blocked, false); assert.equal(entry(t, '0503333333').blocked, true); assert.equal(t.entries.size, 4);
    // ביטול חסימה (בלי 0 מוביל, עם רווחים)
    const b = await fbl('u_mgr', { action: 'unblock', phone: '50 111 1111' });
    assert.equal(b.status, 'OK', b.text);
    assert.deepEqual(b.result, { ok: true, phone: '0501111111', blocked: false, changed: 1 });
    assert.equal(entry(t, '0501111111').blocked, false);
    assert.equal(M.calls('UpdateTemplateEntry')[1].body.blocked, 0);
    // כבר במצב המבוקש – בלי עדכון
    const c = await fbl('u_mgr', { action: 'unblock', phone: '0501111111' });
    assert.equal(c.result.changed, 0); assert.equal(M.calls('UpdateTemplateEntry').length, 2);
    // אין פקודות מחיקה
    for (const cmd of ['UpdateTemplateEntries', 'ClearTemplateEntries', 'DeleteTemplate', 'UploadPhoneList']) assert.equal(M.calls(cmd).length, 0, cmd);
  });

  it('מספר שלא ברשימה / לא תקין / רשימה שלא נוצרה / קלט חסר – נדחים בלי UpdateTemplateEntry', async () => {
    const t = await setup(env);
    const n = await fbl('u_mgr', { action: 'block', phone: '0508888888' }); // ברשימה החינמית בלבד
    assert.equal(n.status, 'FAILED_PRECONDITION'); assert.equal(n.error.details.reason, 'not-in-list');
    for (const phone of ['12345', 'abc', '']) {
      const b = await fbl('u_mgr', { action: 'block', phone });
      assert.equal(b.status, 'INVALID_ARGUMENT', phone); assert.equal(b.error.details.reason, 'bad-phone');
    }
    for (const data of [{ action: 'block' }, { action: 'block', phone: 501111111 }, { action: 'block', phone: '0'.repeat(40) }]) {
      const b = await fbl('u_mgr', data);
      assert.equal(b.status, 'INVALID_ARGUMENT', JSON.stringify(data)); assert.equal(b.error.details.reason, 'bad-input');
    }
    await writeDoc(env, 'yemot_state/fblist', { tzOn: true });
    const l = await fbl('u_mgr', { action: 'block', phone: '0501111111' });
    assert.equal(l.status, 'FAILED_PRECONDITION'); assert.equal(l.error.details.reason, 'no-list');
    assert.equal(M.calls('UpdateTemplateEntry').length, 0);
    assert.equal(entry(t, '0501111111').blocked, false);
    assert.equal(await readDoc(env, 'yemot_fbsent/0508888888'), null);
  });

  it('ימות לא עדכן בפועל ← not-applied; שגיאה מימות ← yemot-failed בלי טקסט מימות', async () => {
    await setup(env);
    M.setMode('update', 'ignore');
    const a = await fbl('u_mgr', { action: 'block', phone: '0502222222' });
    assert.equal(a.status, 'UNAVAILABLE', a.text); assert.equal(a.error.details.reason, 'not-applied');
    M.setMode('update', 'error');
    const b = await fbl('u_mgr', { action: 'block', phone: '0502222222' });
    assert.equal(b.status, 'UNAVAILABLE'); assert.equal(b.error.details.reason, 'yemot-failed');
    assert.ok(!b.text.includes('incorrect'));
  });

  it('אחרי חסימה: הסנכרון הלילי לא מעלה שוב את המספר, והחסימה נשארת; הצינתוק (sendLineTzintuk preview) לא סופר אותו', async () => {
    const t = await setup(env);
    // טופס משוב מאושר של מספר שנמצא ברשימה אבל עוד לא סומן "נשלח" (למשל אחרי העלאה לא ודאית)
    await fbForm(env, 'fb/n1', '0502222222', 'ב');
    assert.equal((await fbl('u_mgr', { action: 'block', phone: '0502222222' })).status, 'OK');
    const pre = await call('sendLineTzintuk', 'u_mgr', { action: 'preview', target: 'fb' });
    assert.equal(pre.status, 'OK', pre.text);
    assert.equal(pre.result.paid, 2, 'רק 0501111111 ו-0771234567 – בלי החסומים');
    const s = await fbl('u_mgr', { action: 'sync' });
    assert.equal(s.status, 'OK', s.text);
    assert.equal(M.calls('UploadPhoneList').length, 0, 'המספר החסום לא הועלה שוב');
    assert.equal(entry(t, '0502222222').blocked, true);
  });
});
