'use strict';
// גיטי – סבב 3 חלק א (23.11.2026): הרשאת קריאה לכל קבוצה פנימית (secPrefs op:'grp', sec_cfg/main.grp), הכלי getGroupMessages
// (רק קבוצות מורשות, ההרשאה נבדקת מחדש בכל קריאה) ו-secComm (פיד מאוחד: מייל, ווצאפ, קבוצות מורשות; רשימת קבוצות להגדרות).
// מול האמולטור, מודל מדומה בלבד (gemini-mock.js). מסמכי grp לא משתנים.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-gc', B = 'biz-gc2';
const M1 = 'gc_m1', M2 = 'gc_m2', MBR = 'gc_mbr', E1 = 'gc_e1', BM = 'gc_bm';
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
let env, SEC, ST;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const MIN = 60000;
// מזהי קבוצות חדשים בכל seed: מחיקת הקבוצות הקודמות (clearFirestore) מפעילה טריגרים (grpDelB) שרצים באיחור – שלא יפגעו בקבוצות החדשות
let G1 = 'g1', G2 = 'g2', GSEQ = 0;

async function seed(o) {
  const opt = Object.assign({ feat: { tasks: true, secretary: true, groups: true } }, o);
  await env.clearFirestore();
  GSEQ++; G1 = 'g1x' + GSEQ; G2 = 'g2x' + GSEQ;
  const now = Date.now();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: opt.feat });
    b.set(d.doc('b/' + B), { name: B, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { secretary: true, groups: true } });
    for (const u of [M1, M2, MBR]) { b.set(d.doc(`b/${A}/admins/${u}`), Object.assign({ email: u + '@example.invalid' }, u === MBR ? { br: ['b1'] } : {})); b.set(d.doc(`b/${A}/staff/${u}`), { name: u, role: 'manager', active: true }); }
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: 'דוד כהן', role: 'employee', active: true });
    b.set(d.doc(`b/${B}/admins/${BM}`), { email: BM + '@example.invalid' }); b.set(d.doc(`b/${B}/staff/${BM}`), { name: BM, role: 'manager', active: true });
    for (const [u, role, biz] of [[M1, 'admin', A], [M2, 'admin', A], [MBR, 'admin', A], [E1, 'worker', A], [BM, 'admin', B]]) b.set(d.doc('users/' + u), { bizId: biz, role, active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    const mgr = {}; for (const u of [M1, M2, MBR]) mgr[u] = { cv: SEC.CONSENT_VER, ca: 1, nm: 'גיטי', ad: 'f' };
    b.set(d.doc(`b/${A}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: true, pay: {}, sens: {}, mgr });
    b.set(d.doc(`b/${A}/sec_cfg/cap`), { capCents: 5000 });
    b.set(d.doc(`b/${B}/sec_cfg/main`), { mode: 'all', mainUid: '', mgr: { [BM]: { cv: SEC.CONSENT_VER, ca: 1, nm: 'גיטי', ad: 'f' } } });
    // קבוצות: g1 (תיפתח), g2 (תישאר סגורה). מסמכי grp לא משתנים בשום בדיקה
    b.set(d.doc(`b/${A}/grp/${G1}`), { name: 'צוות בוקר', mem: [E1], ao: false, md: true, by: M1, t: now - 10 * MIN });
    b.set(d.doc(`b/${A}/grp/${G2}`), { name: 'הנהלה', mem: [], ao: false, md: true, by: M1, t: now - 10 * MIN });
    b.set(d.doc(`b/${A}/grp/${G1}/m/a1`), { by: E1, byN: 'דוד כהן', t: now - 5 * MIN, k: 't', txt: 'הספק של הקמח יגיע מחר ב-9' });
    b.set(d.doc(`b/${A}/grp/${G1}/m/a2`), { by: M1, byN: 'gc_m1', t: now - 4 * MIN, k: 't', txt: 'מעולה, תודה' });
    b.set(d.doc(`b/${A}/grp/${G1}/m/a3`), { by: E1, byN: 'דוד כהן', t: now - 3 * MIN, k: 'img', txt: 'המדף' });
    b.set(d.doc(`b/${A}/grp/${G2}/m/s1`), { by: M2, byN: 'gc_m2', t: now - 2 * MIN, k: 't', txt: 'סוד של ההנהלה' });
    b.set(d.doc(`b/${A}/grp/${G1}/r/${M1}`), { t: now - 4 * MIN }); // M1 קרא עד a2 – a3 לא נקראה
    // מייל, ווצאפ, והודעה אישית של מנהל בווצאפ (own:'mgr' – לא בפיד)
    b.set(d.doc(`b/${A}/sec_in/ml1`), { ch: 'mail', own: 'sec', from: 'a@x.example', name: 'ספק א', subj: 'חשבונית', text: 'מצורפת חשבונית', t: now - 6 * MIN, rt: now - 6 * MIN, st: 'done', flags: [], hum: true });
    b.set(d.doc(`b/${A}/sec_in/ml2`), { ch: 'mail', own: 'sec', from: 'b@x.example', name: 'לקוח ב', subj: 'שאלה', text: 'מתי פתוחים?', t: now - 1 * MIN, rt: now - 1 * MIN, st: 'done', flags: [], hd: true });
    b.set(d.doc(`b/${A}/sec_in/w1`), { ch: 'wa', own: 'sec', from: '972501234567', name: 'רונית', text: 'יש לכם לחם?', t: now - 7 * MIN, rt: now - 7 * MIN, st: 'done', type: 'text', flags: [] });
    b.set(d.doc(`b/${A}/sec_in/w2`), { ch: 'wa', own: 'mgr', mgr: M1, from: '972509999999', name: 'מנהל', text: 'אישי של המנהל', t: now - 30000, rt: now - 30000, st: 'done', type: 'text', flags: [] });
    await b.commit();
  });
}
const secReqs = () => GM.state.requests.filter((r) => r.kind === 'sec');
const lastIsRes = (body) => { const c = (body.contents || []).slice(-1)[0]; return !!(c && (c.parts || []).some((p) => p.functionResponse)); };
function responses(body) { const out = {}; for (const c of body.contents || []) for (const p of c.parts || []) if (p.functionResponse) out[p.functionResponse.name] = p.functionResponse.response.content; return out; }
const model = (calls, answer) => (body) => (lastIsRes(body) ? { text: answer(responses(body), body) } : { calls });
const lastRes = () => responses(secReqs().slice(-1)[0].body);
const setGrp = (u, gid, on) => call('secPrefs', u, { op: 'grp', gid, on });
async function askGroups(args) {
  GM.reset();
  GM.state.sec = model([{ name: 'getGroupMessages', args: args || {} }], () => 'הנה ההודעות.');
  const r = await call('secChat', M1, { text: 'מה כתבו בקבוצות?' });
  assert.equal(r.status, 'OK', r.text);
  return lastRes().getGroupMessages;
}

before(async () => {
  env = await H.getEnv(); await GM.start(); require('../functions/index.js');
  SEC = require('../functions/secretary.js')._core; ST = require('../functions/lib/sec-tools.js');
});
after(async () => { await GM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => GM.reset());

describe('גיטי – הרשאת קבוצות (secPrefs op:grp)', () => {
  it('ברירת מחדל כבוי; מנהל מפעיל ומכבה – נשמר ונרשם ביומן; מסמך הקבוצה לא משתנה', async () => {
    await seed();
    const core = (g) => ({ name: g.name, mem: g.mem, ao: g.ao, md: g.md, by: g.by, t: g.t, grp: g.grp, sec: g.sec }); // last – נכתב בטריגר grpMsg (לא כאן)
    const g0 = core(await get(`b/${A}/grp/${G1}`));
    const st0 = await call('secState', M1, {});
    assert.equal(st0.status, 'OK', st0.text); assert.deepEqual(st0.result.grp, { on: true, n: 0, edit: true });
    const on = await setGrp(M1, G1, true);
    assert.equal(on.status, 'OK', on.text); assert.deepEqual([on.result.gid, on.result.on], [G1, true]);
    assert.deepEqual((await get(`b/${A}/sec_cfg/main`)).grp, [G1]);
    assert.equal((await setGrp(M2, G1, true)).status, 'OK', 'כל מנהל של העסק (בלי הגבלת סניפים) – כמו שאר הגדרות המזכירה');
    assert.deepEqual((await get(`b/${A}/sec_cfg/main`)).grp, [G1], 'בלי כפילות');
    assert.equal((await call('secState', M1, {})).result.grp.n, 1);
    const off = await setGrp(M1, G1, false);
    assert.equal(off.status, 'OK', off.text);
    assert.deepEqual((await get(`b/${A}/sec_cfg/main`)).grp, []);
    const log = (await coll(`b/${A}/sec_log`)).filter((l) => l.act === 'grpOn' || l.act === 'grpOff');
    assert.deepEqual(log.map((l) => l.act).sort(), ['grpOff', 'grpOn', 'grpOn']);
    assert.ok(log.every((l) => l.tgt === G1 && l.note === 'צוות בוקר' && l.who === 'mgr'));
    assert.deepEqual(core(await get(`b/${A}/grp/${G1}`)), g0, 'מסמך הקבוצה לא השתנה');
    assert.ok(!Object.keys(await get(`b/${A}/grp/${G1}`)).some((k) => !['name', 'mem', 'ao', 'md', 'by', 't', 'last', 'pin'].includes(k)), 'בלי שדות חדשים במסמך הקבוצה');
  });
  it('נחסם: עובד, מנהל עם הגבלת סניפים, מנהל של עסק אחר, בלי התחברות, קבוצה שלא קיימת, קלט לא תקין, תוספת כבויה', async () => {
    await seed();
    assert.equal((await setGrp(E1, G1, true)).status, 'PERMISSION_DENIED');
    assert.equal((await setGrp(MBR, G1, true)).reason, 'branch-limited');
    assert.equal((await setGrp(BM, G1, true)).reason, 'not-found', 'עסק אחר – הקבוצה לא קיימת אצלו');
    assert.equal((await setGrp(null, G1, true)).status, 'UNAUTHENTICATED');
    assert.equal((await setGrp(M1, 'nope', true)).reason, 'not-found');
    assert.equal((await setGrp(M1, 'nope', false)).reason, 'not-found');
    assert.equal((await setGrp(M1, 'a/b', true)).reason, 'bad-input');
    assert.equal((await setGrp(M1, G1, 'yes')).reason, 'bad-input');
    assert.equal((await get(`b/${A}/sec_cfg/main`)).grp, undefined, 'שום דבר לא נשמר');
    assert.equal((await get(`b/${B}/sec_cfg/main`)).grp, undefined);
    await seed({ feat: { tasks: true, secretary: true, groups: false } });
    assert.equal((await setGrp(M1, G1, true)).reason, 'feature-off');
    assert.equal((await call('secState', M1, {})).result.grp.on, false);
  });
  it('כיבוי קבוצה שנמחקה (שהייתה פתוחה) – מותר', async () => {
    await seed();
    assert.equal((await setGrp(M1, G2, true)).status, 'OK');
    await prep((d) => d.doc(`b/${A}/grp/${G2}`).delete());
    assert.equal((await call('secState', M1, {})).result.grp.n, 0, 'קבוצה שנמחקה לא נספרת במרכז השליטה');
    const r = await setGrp(M1, G2, false);
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual((await get(`b/${A}/sec_cfg/main`)).grp, []);
    // תקרה: 50 קבוצות פתוחות – ה-51 נדחית
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).set({ grp: Array.from({ length: 50 }, (_, i) => 'z' + i) }, { merge: true }));
    assert.equal((await setGrp(M1, G1, true)).reason, 'too-many');
    assert.equal((await get(`b/${A}/sec_cfg/main`)).grp.length, 50);
  });
});

describe('גיטי – הכלי getGroupMessages', () => {
  it('מוצע בצ\'אט (קריאה); לא למנהל עם הגבלת סניפים', () => {
    assert.ok(ST.toolsFor('app', {}).includes('getGroupMessages'));
    assert.ok(!ST.toolsFor('app', { brLimited: true }).includes('getGroupMessages'));
  });
  it('בלי הרשאה – כלום; קבוצה פתוחה – רק היא; כיבוי – חוסם מיד; חיפוש וסינון לפי שם', async () => {
    await seed();
    let R = await askGroups();
    assert.equal(R.allowedGroups, 0); assert.equal(R.count, 0);
    assert.ok(!JSON.stringify(R).includes('הקמח') && !JSON.stringify(R).includes('סוד'));
    assert.equal((await setGrp(M1, G1, true)).status, 'OK');
    R = await askGroups();
    assert.equal(R.allowedGroups, 1); assert.deepEqual(R.groups, ['צוות בוקר']);
    assert.equal(R.count, 3);
    assert.deepEqual(R.items.map((x) => x.text), ['[תמונה] המדף', 'מעולה, תודה', 'הספק של הקמח יגיע מחר ב-9'], 'מהחדשה לישנה');
    assert.equal(R.items[2].from, 'דוד כהן'); assert.equal(R.items[2].group, 'צוות בוקר');
    assert.ok(!JSON.stringify(R).includes('סוד'), 'קבוצה סגורה לא נקראה');
    assert.ok(!JSON.stringify(R).includes(E1), 'בלי מזהי משתמש');
    assert.match(R.note, /מידע בלבד/);
    R = await askGroups({ query: 'קמח' });
    assert.equal(R.count, 1); assert.match(R.items[0].text, /קמח/);
    R = await askGroups({ group: 'הנהלה' });
    assert.equal(R.count, 0); assert.deepEqual(R.groups, ['צוות בוקר'], 'שם של קבוצה סגורה – לא נקראת');
    R = await askGroups({ limit: 1 });
    assert.equal(R.count, 1); assert.equal(R.more, true);
    // ליקוי 1 (בדיקה סבב 1): מילה אחרי התו ה-80 בהודעה ארוכה – נמצאת בחיפוש
    await prep((d) => d.doc(`b/${A}/grp/${G1}/m/a4`).set({ by: E1, byN: 'דוד כהן', t: Date.now() - 8 * MIN, k: 't', txt: 'א'.repeat(150) + ' מילהנדירה בסוף' }));
    R = await askGroups({ query: 'מילהנדירה' });
    assert.equal(R.count, 1, 'התאמה אחרי 80 תווים'); assert.match(R.items[0].text, /מילהנדירה/);
    const log = (await coll(`b/${A}/sec_log`)).filter((l) => l.act === 'tool' && String(l.note).startsWith('getGroupMessages'));
    assert.ok(log.length >= 1);
    assert.equal((await setGrp(M1, G1, false)).status, 'OK');
    R = await askGroups();
    assert.equal(R.allowedGroups, 0); assert.equal(R.count, 0);
    assert.ok(!JSON.stringify(R).includes('הקמח'), 'כיבוי – עוצר מיד');
  });
  it('תוספת הקבוצות כבויה – "לא זמין", גם אם נשמרה הרשאה', async () => {
    await seed({ feat: { tasks: true, secretary: true, groups: false } });
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).set({ grp: [G1] }, { merge: true }));
    const R = await askGroups();
    assert.equal(R.error, 'not-available');
    assert.ok(!JSON.stringify(R).includes('הקמח'));
  });
});

describe('גיטי – secComm: פיד מאוחד ורשימת קבוצות', () => {
  it('פיד: מייל + ווצאפ (בלי הודעה אישית של מנהל) + רק קבוצות פתוחות; מצב טופל / לא נקרא', async () => {
    await seed();
    let r = await call('secComm', M1, { op: 'feed' });
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual(r.result.items.map((x) => x.id), ['mail:ml2', 'mail:ml1', 'wa:w1'], 'בלי קבוצות לפני הרשאה');
    assert.ok(!JSON.stringify(r.result).includes('אישי של המנהל'));
    assert.equal(r.result.items[0].done, true); assert.equal(r.result.items[1].done, false); assert.equal(r.result.items[1].open, true);
    assert.deepEqual(r.result.items[2].ref, { wa: '972501234567' });
    assert.equal((await setGrp(M1, G1, true)).status, 'OK');
    r = await call('secComm', M1, { op: 'feed' });
    const ids = r.result.items.map((x) => x.id);
    assert.deepEqual(ids, ['mail:ml2', `grp:${G1}:a3`, `grp:${G1}:a2`, `grp:${G1}:a1`, 'mail:ml1', 'wa:w1'], 'כרונולוגי');
    assert.ok(!ids.some((x) => x.startsWith(`grp:${G2}`)), 'קבוצה סגורה לא מופיעה');
    const a3 = r.result.items.find((x) => x.id === `grp:${G1}:a3`), a1 = r.result.items.find((x) => x.id === `grp:${G1}:a1`);
    assert.equal(a3.unread, true); assert.equal(a1.unread, false, 'נקרא לפי מצב הקריאה'); assert.equal(a3.grp, 'צוות בוקר');
    assert.deepEqual(a3.ref, { gid: G1, mid: 'a3' }); assert.equal(a3.prev, '[תמונה] המדף');
    assert.deepEqual(r.result.groups, [{ gid: G1, name: 'צוות בוקר' }]);
    // מנהל אחר: "לא נקרא" לפי מצב הקריאה שלו (אין לו – הכול לא נקרא, חוץ מהודעות שלו)
    const r2 = await call('secComm', M2, { op: 'feed', ch: 'grp' });
    assert.equal(r2.status, 'OK', r2.text);
    assert.deepEqual(r2.result.items.map((x) => x.unread), [true, true, true]);
    // סינון לפי ערוץ ולפי "פתוח"
    assert.deepEqual((await call('secComm', M1, { op: 'feed', ch: 'grp' })).result.items.map((x) => x.id), [`grp:${G1}:a3`, `grp:${G1}:a2`, `grp:${G1}:a1`]);
    assert.deepEqual((await call('secComm', M1, { op: 'feed', ch: 'mail' })).result.items.map((x) => x.id), ['mail:ml2', 'mail:ml1']);
    assert.deepEqual((await call('secComm', M1, { op: 'feed', st: 'open' })).result.items.map((x) => x.id), [`grp:${G1}:a3`, 'mail:ml1', 'wa:w1']);
    // כיבוי – הקבוצה נעלמת מהפיד מיד
    assert.equal((await setGrp(M1, G1, false)).status, 'OK');
    assert.ok(!(await call('secComm', M1, { op: 'feed' })).result.items.some((x) => x.ch === 'grp'));
  });
  it('דפים: limit + before – בלי כפילויות ובלי חורים', async () => {
    await seed();
    assert.equal((await setGrp(M1, G1, true)).status, 'OK');
    const seen = [];
    let before, n = 0, more = true;
    while (more && n++ < 10) {
      const r = await call('secComm', M1, Object.assign({ op: 'feed', limit: 2 }, before ? { before } : {}));
      assert.equal(r.status, 'OK', r.text);
      seen.push(...r.result.items.map((x) => x.id));
      more = r.result.more; before = r.result.next;
    }
    assert.deepEqual(seen, ['mail:ml2', `grp:${G1}:a3`, `grp:${G1}:a2`, `grp:${G1}:a1`, 'mail:ml1', 'wa:w1']);
  });
  it('דפים: הודעות אישיות של מנהל (own:mgr) שנקראו וסוננו לא גורמות לדילוג על הודעת ווצאפ רגילה', async () => {
    await seed();
    const now = Date.now();
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc(`b/${A}/sec_in/ml3`), { ch: 'mail', own: 'sec', from: 'c@x.example', name: 'ספק ג', subj: 'ישן', text: 'ישן', t: now - 8 * MIN, rt: now - 8 * MIN, st: 'done', flags: [] });
      b.set(d.doc(`b/${A}/sec_in/w3`), { ch: 'wa', own: 'mgr', mgr: M1, from: '972509999999', name: 'מנהל', text: 'אישי 2', t: now - 42000, rt: now - 42000, st: 'done', type: 'text', flags: [] });
      b.set(d.doc(`b/${A}/sec_in/w4`), { ch: 'wa', own: 'sec', from: '972501111111', name: 'יוסי', text: 'הודעה רגילה', t: now - 4 * MIN, rt: now - 4 * MIN, st: 'done', type: 'text', flags: [] });
      await b.commit();
    });
    const seen = [];
    let before, n = 0, more = true;
    while (more && n++ < 12) {
      const r = await call('secComm', M1, Object.assign({ op: 'feed', limit: 2 }, before ? { before } : {}));
      assert.equal(r.status, 'OK', r.text);
      seen.push(...r.result.items.map((x) => x.id));
      more = r.result.more; before = r.result.next;
    }
    assert.deepEqual(seen, ['mail:ml2', 'wa:w4', 'mail:ml1', 'wa:w1', 'mail:ml3'], 'w4 לא נדלגה, בלי כפילויות, בלי הודעות אישיות');
  });
  it('הרשאות וקלט: בלי התחברות, עובד, תוספת כבויה (בלי קבוצות), קלט לא תקין; עסק אחר לא רואה', async () => {
    await seed();
    assert.equal((await setGrp(M1, G1, true)).status, 'OK');
    assert.equal((await call('secComm', null, { op: 'feed' })).status, 'UNAUTHENTICATED');
    assert.equal((await call('secComm', E1, { op: 'feed' })).status, 'PERMISSION_DENIED');
    assert.equal((await call('secComm', M1, { op: 'feed', ch: 'x' })).reason, 'bad-ch');
    assert.equal((await call('secComm', M1, { op: 'feed', limit: 500 })).reason, 'bad-limit');
    assert.equal((await call('secComm', M1, { op: 'feed', before: -1 })).reason, 'bad-before');
    assert.equal((await call('secComm', M1, { op: 'x' })).reason, 'bad-op');
    const rb = await call('secComm', BM, { op: 'feed' });
    assert.equal(rb.status, 'OK', rb.text); assert.deepEqual(rb.result.items, [], 'עסק אחר – רק הנתונים שלו');
    await prep((d) => d.doc('b/' + A).set({ features: { tasks: true, secretary: true, groups: false } }, { merge: true }));
    const r = await call('secComm', M1, { op: 'feed' });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.grpOn, false); assert.ok(!r.result.items.some((x) => x.ch === 'grp'));
  });
  it('רשימת הקבוצות להגדרות: מצב לכל קבוצה; מנהל עם הגבלת סניפים – צפייה בלבד', async () => {
    await seed();
    assert.equal((await setGrp(M1, G2, true)).status, 'OK');
    const r = await call('secComm', M1, { op: 'groups' });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.on, true); assert.equal(r.result.edit, true);
    const by = Object.fromEntries(r.result.groups.map((g) => [g.gid, g]));
    assert.equal(by[G1].on, false); assert.equal(by[G2].on, true); assert.equal(by[G1].name, 'צוות בוקר'); assert.equal(by[G1].n, 1);
    assert.equal((await call('secComm', MBR, { op: 'groups' })).result.edit, false);
    assert.equal((await call('secComm', E1, { op: 'groups' })).status, 'PERMISSION_DENIED');
  });
});
