'use strict';
// בדיקות משימה 2026-11-23: מי שיצא מרשימת הצינתוקים החינמית לא מקבל צינתוק בתשלום, ו"דוח הקו" (yemotFbList action:'report').
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
const tz = (uid, data) => call('sendLineTzintuk', uid, data);
const fbl = (uid, data) => call('yemotFbList', uid, data);
async function readDoc(env, p) { let v = null; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function writeDoc(env, p, data) { await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(p).set(data); }); }

const monthNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const dmy = (ym, d) => `${String(d).padStart(2, '0')}/${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
let seq = 0;
const rid = () => `tz_${Date.now().toString(36)}_${++seq}`;
const arrTz = () => M.calls('RunTzintuk').filter((q) => Array.isArray(q.body.phones));
const paidSent = () => arrTz().flatMap((q) => q.body.phones).sort();

// משוב: 5 לא חסומים, אחד חסום. חינמי: 0502222222 (גם משוב), 0508888888.
// יומן: 0501111111 הסיר את עצמו; 0504444444 הוצא ע"י מנהל (PhoneAction); 0505555555 הסיר ונרשם שוב (ולכן ברשימה החינמית).
const FB = ['0501111111', '0502222222', '0503333333', '0504444444', '0505555555', '0771234567'];
async function setup(env, o) {
  o = o || {};
  const m = monthNow();
  M.state.templates.push({ templateId: 900, description: 'לקוחות משוב', entries: new Map(FB.map((p) => [p, { name: null, blocked: p === '0503333333' }])) });
  await writeDoc(env, 'yemot_state/fblist', { templateId: 900, tzOn: true, sentCount: FB.length });
  M.state.tzl.mivtzaim = ['0502222222', '0508888888', '0505555555'];
  M.state.tzlLog.mivtzaim = o.noLog ? [] : [
    { Folder: '9', Phone: '0501111111', PhoneAction: '', Date: dmy(m, 1), Time: '10:00:00', TypeOperation: 'AddToListTzintuk' },
    { Folder: '9', Phone: '0501111111', PhoneAction: '', Date: dmy(m, 2), Time: '11:00:00', TypeOperation: 'RemovingToListTzintuk' },
    { Folder: '', Phone: '0771111111', PhoneAction: '+972504444444', Date: dmy(m, 3), Time: '09:00:00', TypeOperation: 'AdminRemovingToListTzintuk' },
    { Folder: '9', Phone: '0505555555', Date: dmy(m, 1), Time: '08:00:00', TypeOperation: 'RemovingToListTzintuk' },
    { Folder: '9', Phone: '0505555555', Date: dmy(m, 4), Time: '08:00:00', TypeOperation: 'AddToListTzintuk' },
    { Folder: '9', Phone: '0508888888', Date: dmy(m, 5), Time: '12:30:00', TypeOperation: 'AddToListTzintuk' },
    { Folder: '9', Phone: '0771111111', Date: dmy(m, 5), Time: '13:00:00', TypeOperation: 'RunTzintuk' },
  ];
}

describe('ימות 2026-11-23: מי שיצא מהצינתוקים לא מקבל בתשלום, ודוח הקו', () => {
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
  beforeEach(async () => { await H.seed(env); await H.grantLine(env); M.reset(); });

  it('preview + send all: מי שהסיר את עצמו ומי שמנהל הוציא – לא מקבלים בתשלום; מי שנרשם שוב מקבל מהחינמי', async () => {
    await setup(env);
    const p = await tz('u_mgr', { action: 'preview', target: 'all' });
    assert.equal(p.status, 'OK', p.text);
    assert.equal(p.result.free, 3); assert.equal(p.result.paid, 1); assert.equal(p.result.skipped, 2);
    const r = await tz('u_mgr', { action: 'send', target: 'all', requestId: rid() });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.status, 'done');
    assert.deepEqual(paidSent(), ['0771234567'], 'בלי 0501111111 (הסיר), 0504444444 (מנהל), החסום, ומי שבחינמי');
    assert.equal(M.calls('TzintukimListManagement').filter((q) => q.body.action === 'getLogList').length >= 1, true);
    for (const a of M.calls('TzintukimListManagement').map((q) => q.body.action)) assert.ok(['getlistEnteres', 'getLogList'].includes(a), a);
    const o = await readDoc(env, 'yemot_state/tzlopt');
    assert.deepEqual(Object.keys(o.out).sort(), ['0501111111', '0504444444']);
    assert.equal(o.out['0501111111'].how, 'self'); assert.equal(o.out['0504444444'].how, 'admin');
  });

  it('send fb (רק לקוחות משוב): גם כאן מי שיצא לא מקבל', async () => {
    await setup(env);
    const r = await tz('u_mgr', { action: 'send', target: 'fb', requestId: rid() });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(paidSent(), ['0502222222', '0505555555', '0771234567']);
  });

  it('בלי יומן: מי שהיה ברשימה החינמית ונעלם ממנה – נחשב יצא (תמונת מצב שמורה)', async () => {
    await setup(env, { noLog: true });
    M.state.tzl.mivtzaim = ['0501111111', '0502222222'];
    assert.equal((await tz('u_mgr', { action: 'preview', target: 'all' })).result.skipped, 0);
    M.state.tzl.mivtzaim = ['0502222222']; // 0501111111 יצא
    const p = await tz('u_mgr', { action: 'preview', target: 'all' });
    assert.equal(p.result.skipped, 1);
    const r = await tz('u_mgr', { action: 'send', target: 'all', requestId: rid() });
    assert.equal(r.status, 'OK', r.text);
    assert.ok(!paidSent().includes('0501111111'));
    assert.equal((await readDoc(env, 'yemot_state/tzlopt')).out['0501111111'].how, 'gone');
    // נרשם שוב ← יוצא מהרשימה של "יצאו"
    M.state.tzl.mivtzaim = ['0502222222', '0501111111'];
    await tz('u_mgr', { action: 'preview', target: 'all' });
    assert.equal((await readDoc(env, 'yemot_state/tzlopt')).out['0501111111'], undefined);
  });

  it('היומן לא נקרא ואין שום מידע קודם: לא נשלח שום צינתוק (optout-unknown); עם מידע שמור – ממשיכים לפיו', async () => {
    await setup(env);
    M.setMode('tzlog', 'error');
    const id = rid();
    const r = await tz('u_mgr', { action: 'send', target: 'all', requestId: id });
    assert.equal(r.status, 'UNAVAILABLE', r.text); assert.equal(r.error.details.reason, 'optout-unknown');
    assert.equal(M.calls('RunTzintuk').length, 0);
    assert.ok(!r.text.includes('incorrect'));
    // מידע שמור מריצה קודמת: 0501111111 יצא
    await writeDoc(env, 'yemot_state/tzlopt', { seen: ['0502222222', '0508888888', '0505555555', '0501111111'], out: { '0501111111': { at: '2026-01-01T00:00:00', how: 'self' } }, logOk: true, at: 'x' });
    const r2 = await tz('u_mgr', { action: 'send', target: 'all', requestId: id });
    assert.equal(r2.status, 'OK', r2.text);
    assert.deepEqual(paidSent(), ['0504444444', '0771234567'], 'בלי יומן אי אפשר לדעת על 0504444444 – רק מה שנשמר');
  });

  it('numbers מסמן מי שיצא (מהמידע השמור, בלי פנייה נוספת ליומן)', async () => {
    await setup(env);
    await tz('u_mgr', { action: 'preview', target: 'all' });
    M.state.requests = [];
    const r = await fbl('u_mgr', { action: 'numbers' });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(r.result.gone.slice().sort(), ['0501111111', '0504444444']);
    assert.equal(M.calls('TzintukimListManagement').filter((q) => q.body.action === 'getLogList').length, 0);
  });

  it('report: נרשמו / התנתקו בחודש, מצב עכשיו, ומי שמע את הקו (עם מספרים)', async () => {
    await setup(env);
    const m = monthNow();
    M.state.ymgr[`ivr2:/Log/LogFolderEnterExit-${m}.ymgr`] = [
      { Folder: '/', Phone: '0501111111', EnterDate: dmy(m, 3), EnterTime: '10:00:00', ExitTime: '10:00:20', TimeTotal: '20', CallId: 'c1' },
      { Folder: '2', Phone: '0501111111', EnterDate: dmy(m, 3), EnterTime: '10:00:20', ExitTime: '10:01:00', TimeTotal: '40', CallId: 'c1' },
      { Folder: '2', Phone: '0501111111', EnterDate: dmy(m, 6), EnterTime: '09:00:00', TimeTotal: '30', CallId: 'c2' },
      { Folder: '1', Phone: '+972529999999', EnterDate: dmy(m, 4), EnterTime: '08:00:00', TimeTotal: '5', CallId: 'c3' },
    ];
    const r = await fbl('u_mgr', { action: 'report', month: m });
    assert.equal(r.status, 'OK', r.text);
    const x = r.result;
    assert.deepEqual(x.counts, { free: 3, fbActive: 5, fbBlocked: 1, skipped: 2 });
    assert.deepEqual(x.joined.map((e) => e.p).sort(), ['0501111111', '0505555555', '0508888888']);
    assert.deepEqual(x.left.map((e) => e.p + ':' + e.how).sort(), ['0501111111:self', '0504444444:admin', '0505555555:self']);
    assert.deepEqual(x.out.map((e) => e.p).sort(), ['0501111111', '0504444444']);
    assert.ok(x.out.every((e) => e.fb === true));
    assert.equal(x.heard.calls, 3); assert.equal(x.heard.phones, 2);
    const a = x.heard.rows.find((e) => e.p === '0501111111');
    assert.deepEqual(a, { p: '0501111111', n: 2, sec: 90, last: `${m}-06T09:00:00` });
    assert.equal(x.heardErr, null); assert.equal(x.logOk, true);
    assert.equal(M.calls('RenderYMGRFile')[0].body.convertType, 'json');
    assert.equal(M.calls('RunTzintuk').length, 0, 'הדוח לא שולח');
    for (const cmd of ['UpdateTemplateEntry', 'UploadPhoneList', 'FileAction']) assert.equal(M.calls(cmd).length, 0, cmd);
  });

  it('report: יומן השיחות לא קיים – heardErr, ושאר הדוח מוצג; חודש לא תקין / עתידי נדחה; עובד נדחה בלי פנייה לימות', async () => {
    await setup(env);
    const r = await fbl('u_mgr', { action: 'report', month: monthNow() });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.heard, null); assert.ok(r.result.heardErr); assert.equal(r.result.joined.length, 3);
    for (const month of ['2026-13', 'abc', '', '2999-01', undefined]) {
      const b = await fbl('u_mgr', { action: 'report', month });
      assert.equal(b.status, 'INVALID_ARGUMENT', String(month));
    }
    M.state.requests = [];
    const e = await fbl('u_emp', { action: 'report', month: monthNow() });
    assert.equal(e.status, 'PERMISSION_DENIED');
    assert.equal(M.state.requests.length, 0);
  });
});
