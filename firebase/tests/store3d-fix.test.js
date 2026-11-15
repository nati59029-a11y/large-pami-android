'use strict';
// סריקת חנות בתלת מימד – שלב 20ג, חלק השרת (15.11.2026): mapFix (תיקון טיוטה בכתב), באמולטור. חלק מ-test:multibiz:4.
// Gemini = gemini-mock.js בלבד (127.0.0.1:9799). אין שום פנייה החוצה.
//   1. הליבה (fixCore) מול Firestore של האמולטור: תקין נכתב, בלי תמונות, לא נספר במכסה ולא ב-5 ההקמות, רק בלם 400 ביום;
//      qid חוזר; שבורה – ניסיון חוזר ואז fail עם סיבה; טיוטה נוכחית לא תקינה נדחית לפני Gemini; 429 – s3qid נמחק.
//   2. הפונקציה דרך אמולטור הפונקציות: מי רשאי, עסק עם store3d כבוי.
process.env.SCAN_RETRY_WAIT_MS = process.env.SCAN_RETRY_WAIT_MS || '10';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-s3f', B = 'biz-s3g';
const MGR = 's3f_mgr1', E1 = 's3f_emp1', DR = 's3f_draw1', EB = 's3f_empb';
const FEAT = { scan: true, tasks: true, store3d: true };
const FN = path.join(__dirname, '..', 'functions');
let qn = 0;
const qid = () => 'f' + Date.now().toString(36) + '-' + (qn++).toString().padStart(12, '0');
const AI = require(path.join(FN, 'lib', 'store3d-ai.js'));
const F = require(path.join(FN, 'lib', 'store3d-fix.js'));
const ans = () => { const o = JSON.parse(JSON.stringify(GM.fixture('mapdraft-ok'))); delete o._example; delete o._meta; return o; };
// הטיוטה הנוכחית – כמו ש-mapDraft מחזיר (אותה בדיקה)
const DRAFT = () => AI.evalDraft(ans(), 'STOP', { br: 'main', kind: 's', numDir: 'rtl', bizId: A, uid: MGR, now: Date.now() }).d.map;
const TXT = 'המקררים על הקיר השמאלי';

let env, adm;
const get = async (p) => { const s = await adm.doc(p).get(); return s.exists ? s.data() : null; };

async function seed() {
  await env.clearFirestore();
  const b = adm.batch();
  b.set(adm.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: FEAT });
  b.set(adm.doc('b/' + B), { name: 'ב', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: Object.assign({}, FEAT, { store3d: false }) });
  b.set(adm.doc(`b/${A}/admins/${MGR}`), { email: MGR + '@example.invalid' });
  for (const [u, role, perms] of [[MGR, 'manager', null], [E1, 'employee', null], [DR, 'employee', { s3m: true }]]) {
    b.set(adm.doc(`b/${A}/staff/${u}`), Object.assign({ name: u, role, active: true }, perms ? { perms } : {}));
    b.set(adm.doc('users/' + u), { bizId: A, role: role === 'manager' ? 'admin' : 'worker', active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
  }
  b.set(adm.doc(`b/${B}/staff/${EB}`), { name: EB, role: 'employee', active: true, perms: { s3m: true } });
  b.set(adm.doc('users/' + EB), { bizId: B, role: 'worker', active: true, bizStatus: 'active', email: EB + '@example.invalid', createdAt: 1 });
  b.set(adm.doc(`b/${A}/s3set/main`), { stype: 'כלים חד-פעמיים', recN: 2, upd: 1, by: MGR });
  await b.commit();
}

describe('mapFix – הליבה מול האמולטור (Firestore + gemini-mock)', () => {
  let X, db;
  const deps = (o) => Object.assign({ base: 'http://127.0.0.1:' + GM.PORT, key: 'test-key', userMax: 400 }, o);
  const W = (uid, o) => Object.assign({ uid, bizId: A, brs: null }, o);
  const fix = (uid, o, d) => X.fixCore(db, W(uid), Object.assign({ qid: qid(), br: 'main', kind: 's', txt: TXT, m: DRAFT() }, o), Date.now(), deps(d));
  const err = async (p) => { try { await p; } catch (e) { return (e.details && e.details.reason) || e.code || e.message; } return 'OK'; };
  const un = async (u) => { const x = await get(`b/${A}/s3use/u_${u}`); return x ? x.n : 0; };

  before(async () => {
    env = await H.getEnv();
    await GM.start();
    X = require(path.join(FN, 'store3d-fix.js'))._fix;
    const T = require(path.join(FN, 'lib', 'tenant.js'));
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
    db = T.prefixed(adm, `b/${A}/`);
  });
  after(async () => { await GM.stop(); });
  beforeEach(async () => { GM.reset(); await seed(); });

  it('תקין: טיוטה מתוקנת נכתבת ל-s3draft (fix:1, from); בלי תמונות; הטקסט והטיוטה בהנחיה; רק הבלם היומי עולה; qid חוזר – dup עם m, בלי Gemini', async () => {
    const corrected = ans();
    corrected.fx[0].name = 'מקררים';
    corrected.fx[0].k = 'fridge'; corrected.fx[0].glass = true;
    corrected.notes = 'המקררים הועברו לקיר השמאלי';
    GM.state.mapfix = corrected;
    const q = qid(), from = qid();
    const r = await fix(DR, { qid: q, from, sk: { rows: [[100, 100, 600, 100]] }, info: { w: 700, l: 1400 } });
    assert.deepEqual([r.draftId, r.st, r.fix, r.drop, r.m.src], [q, 'ok', true, 0, 'draft']);
    assert.deepEqual([r.m.fx[0].k, r.m.fx[0].glass, r.m.fx[0].name], ['fridge', true, 'מקררים']);
    assert.equal(r.notes, 'המקררים הועברו לקיר השמאלי');
    assert.equal(r.usage, undefined, 'לא נספר במכסה – אין usage');
    assert.equal(GM.state.requests.length, 1);
    const rq = GM.state.requests[0];
    assert.equal(rq.kind, 's3fix');
    assert.equal(rq.body.contents[0].parts.length, 1, 'הנחיה בלבד – בלי תמונות');
    assert.equal(rq.body.generationConfig.maxOutputTokens, 65536);
    const pt = rq.body.contents[0].parts[0].text;
    assert.ok(pt.includes(JSON.stringify(TXT)));
    assert.match(pt, /סוג החנות: "כלים חד-פעמיים"/);
    assert.match(pt, /"name":"מדפי קיר שמאל"/, 'הטיוטה הנוכחית בהנחיה');
    assert.ok(pt.includes('סקיצה שהמשתמש שרטט (כללים מחייבים למבנה, כשהיא ברורה): {"w":700,"l":1400,"rooms":[],"rows":[[100,100,600,100]]}.'));
    const d = await get(`b/${A}/s3draft/${q}`);
    assert.deepEqual([d.st, d.by, d.br, d.kind, d.fix, d.from, d.n, d.m.fx[0].k, d.notes], ['ok', DR, 'main', 's', 1, from, 0, 'fridge', r.notes]);
    assert.equal(d.sk, undefined, 'הסקיצה לא נשמרת');
    assert.equal(await un(DR), 1, 'הבלם היומי – 1');
    assert.equal(await get(`b/${A}/s3use/b_main`), null, 'המכסה החודשית לא נגעה');
    assert.equal(await get(`b/${A}/s3use/d_main`), null, '5 ההקמות לא נגעו');
    const again = await fix(DR, { qid: q, txt: 'משהו אחר' });
    assert.deepEqual([again.dup, again.draftId, again.m.fx[0].k, GM.state.requests.length, await un(DR)], [true, q, 'fridge', 1, 1]);
    assert.equal(await err(fix(MGR, { qid: q })), 'bad-qid', 'qid של משתמש אחר');
  });

  it('בלי הגבלה: מכסה חודשית מלאה ו-5 הקמות היום – התיקון עובר ולא משנה אותן; רק הבלם של 400 ביום עוצר (לפני Gemini)', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const month = today.slice(0, 7);
    await adm.doc(`b/${A}/s3use/b_main`).set({ m: month, n: 500, cap: 500, w80: month, upd: 1 });
    await adm.doc(`b/${A}/s3use/d_main`).set({ d: today, n: 5, upd: 1 });
    for (let i = 0; i < 3; i++) assert.equal((await fix(MGR)).st, 'ok', 'תיקון ' + (i + 1));
    assert.deepEqual([(await get(`b/${A}/s3use/b_main`)).n, (await get(`b/${A}/s3use/d_main`)).n, await un(MGR)], [500, 5, 3]);
    await adm.doc(`b/${A}/s3use/u_${MGR}`).set({ d: today, n: 400, upd: 1 });
    const n0 = GM.state.requests.length;
    let e = null;
    try { await fix(MGR); } catch (x) { e = x; }
    assert.deepEqual([e.code, e.details.reason, GM.state.requests.length], ['resource-exhausted', 's3-user-day', n0]);
    assert.match(e.message, /400/);
  });

  it('שבורה: ניסיון חוזר אחד; שבורה פעמיים – bad-answer עם why והודעה בעברית, s3draft fail, s3qid נמחק; שבורה ואז תקינה – עובר; פריט פסול מושמט', async () => {
    GM.state.mapfixSeq = ['not json at all', 'mapdraft-broken'];
    const q = qid();
    let e = null;
    try { await fix(MGR, { qid: q }); } catch (x) { e = x; }
    assert.deepEqual([e.code, e.details.reason, e.details.why], ['internal', 'bad-answer', 'no-rooms']);
    assert.match(e.message, /הטיוטה הקודמת נשארה בלי שינוי/);
    assert.equal(GM.state.requests.length, 2);
    const f = await get(`b/${A}/s3draft/${q}`);
    assert.deepEqual([f.st, f.why, f.fix], ['fail', 'no-rooms', 1]);
    assert.equal(await get(`b/${A}/s3qid/${q}`), null, 'אפשר לנסות שוב עם אותו qid');
    assert.equal(await un(MGR), 1, 'הבלם היומי לא מוחזר');
    GM.state.mapfixSeq = [{ cut: 'mapdraft-ok' }, { cut: 'mapdraft-ok' }];
    const q2 = qid();
    let e2 = null;
    try { await fix(MGR, { qid: q2 }); } catch (x) { e2 = x; }
    assert.deepEqual([e2.details.reason, e2.details.why], ['bad-answer', 'cut']);
    assert.equal(e2.message, F.fixMsg('cut'));
    const f2 = await get(`b/${A}/s3draft/${q2}`);
    assert.deepEqual([f2.st, f2.why], ['fail', 'cut']);
    assert.equal(await get(`b/${A}/s3qid/${q2}`), null);
    // שליחה חוזרת תוך פחות מ-5 דקות כשהקודמת עדיין בעבודה – busy, בלי Gemini ובלי בלם
    const qb = qid(), nb = GM.state.requests.length, ub = await un(MGR);
    await adm.doc(`b/${A}/s3qid/${qb}`).set({ k: 'fix', uid: MGR, at: Date.now() - 60000, exp: Date.now() + 86400000 });
    assert.equal(await err(fix(MGR, { qid: qb })), 'busy');
    assert.deepEqual([GM.state.requests.length, await un(MGR)], [nb, ub]);
    GM.state.mapfixSeq = ['not json at all', 'mapdraft-ok'];
    assert.equal((await fix(MGR, { qid: q })).st, 'ok', 'אותו qid אחרי כשל');
    const part = ans();
    part.fx.push({ k: 'shelf', x: 1, y: 1, w: 100, d: 50, h: 100, a: 0, sides: 1, bays: 1, lvl: 1, room: 'x' });
    GM.state.mapfixSeq = [part];
    const r = await fix(MGR);
    assert.deepEqual([r.st, r.drop], ['ok', 1]);
  });

  it('קלט: טיוטה נוכחית לא תקינה / סניף לא קיים / סניף לא משויך / מחסן בלי מחסן / qid של mapDraft / בלי מפתח – נדחים לפני Gemini ובלי בלם; 429 – s3qid נמחק', async () => {
    const bad = DRAFT(); bad.rooms[0].p = [0, 0, 500, 500, 500, 0, 0, 500];
    assert.equal(await err(fix(MGR, { m: bad })), 'bad-map');
    assert.equal(await err(fix(MGR, { m: Object.assign(DRAFT(), { br: 'other' }) })), 'bad-map', 'מפה של סניף אחר');
    assert.equal(await err(fix(MGR, { br: 'zz' })), 'no-branch');
    assert.equal(await err(X.fixCore(db, W(DR, { brs: ['other'] }), { qid: qid(), br: 'main', kind: 's', txt: TXT, m: DRAFT() }, Date.now(), deps())), 'other-branch');
    assert.equal(await err(fix(MGR, { kind: 'w' })), 'no-wh');
    assert.equal(await err(fix(MGR, { txt: '' })), 'bad-txt');
    assert.equal(await err(fix(MGR, {}, { key: '' })), 'no-key');
    const dq = qid();
    await adm.doc(`b/${A}/s3qid/${dq}`).set({ k: 'draft', uid: MGR, at: Date.now() - 3600000, exp: Date.now() + 86400000 });
    assert.equal(await err(fix(MGR, { qid: dq })), 'bad-qid');
    assert.deepEqual([GM.state.requests.length, await un(MGR)], [0, 0]);
    GM.state.mode = 'quota';
    const q = qid();
    assert.equal(await err(fix(MGR, { qid: q })), 'gemini-quota');
    assert.equal(await get(`b/${A}/s3qid/${q}`), null);
    assert.equal((await get(`b/${A}/s3draft/${q}`)).st, 'fail');
  });
});

// ---------------- הפונקציה (אמולטור הפונקציות) ----------------
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}

describe('mapFix (אמולטור הפונקציות)', () => {
  before(async () => {
    env = await H.getEnv();
    await GM.start();
    adm = require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  });
  after(async () => { await GM.stop(); });
  beforeEach(async () => { GM.reset(); await seed(); });

  it('מנהל ו-s3m – כן; עובד בלי s3m / אורח / עסק כבוי – לא', async () => {
    const data = () => ({ qid: qid(), br: 'main', kind: 's', txt: TXT, m: DRAFT() });
    assert.equal((await call('mapFix', null, data())).status, 'UNAUTHENTICATED');
    assert.equal((await call('mapFix', E1, data())).reason, 'not-s3m');
    assert.equal((await call('mapFix', EB, data())).reason, 'feature-off');
    const r = await call('mapFix', DR, data());
    assert.equal(r.status, 'OK', r.text);
    assert.deepEqual([r.result.st, r.result.fix, r.result.m.rooms.length > 0], ['ok', true, true]);
    const m = await call('mapFix', MGR, data());
    assert.equal(m.status, 'OK', m.text);
  });
});
