'use strict';
// דיווח יומי (dailyRep, 16.11.2026): כללי Firestore, drSubmit, drMgr, drSetCfg, drSetCap, drRemind – מול האמולטור (firestore + storage).
// הפונקציות רצות בתוך תהליך הבדיקה (כמו secretary-media.test.js), כדי לכוון אותן ל-bucket של אמולטור ה-Storage ולשלוט בשעון (opts.now).
// Gemini – דמה בלבד (gemini-mock, 127.0.0.1:9799). התראות – send מדומה.
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.GEMINI_API_BASE = 'http://127.0.0.1:9799';
process.env.GEMINI_API_KEY = 'dummy-gemini-key-for-emulator';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const GM = require('./gemini-mock');
const F = require('./media-fixtures');

const A = 'biz-dr', B = 'biz-dr2', OFF = 'biz-droff';
const M1 = 'dr_m1', E1 = 'dr_e1', E2 = 'dr_e2', E3 = 'dr_e3', EX = 'dr_ex', MB = 'dr_mb', EOFF = 'dr_eoff', SUPER = 'dr_super', LE = 'dr_legacy';
const BUCKET = H.PROJECT_ID + '.appspot.com';
let env, DR, TK, bucket;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const fs = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function put(p, data, merge) { await prep((d) => d.doc(p).set(data, merge ? { merge: true } : undefined)); }
const req = (uid, data) => ({ auth: uid ? { uid, token: { email: uid + '@x.invalid' } } : undefined, data: data || {} });
let PUSH = [];
const send = async (tokens, msg, meta) => { PUSH.push({ tokens, msg, uid: meta && meta.uid }); return tokens.map((t) => ({ token: t, ok: true })); };
async function call(fn, uid, data, now) {
  try { return { ok: true, r: await DR.call[fn]({ bucket: BUCKET, send, now })(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; }
}
// שעון ישראל: m 1–12
const IL = (y, m, d, hh, mm) => TK.zoned(y, m - 1, d, hh, mm || 0);
const MON = () => IL(2026, 11, 16, 12);       // יום שני
const ID1 = E1 + '_20261116';
const jpg = (n) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n || 200, 7)]).toString('base64');
const wavB64 = (sec) => F.wav(sec).toString('base64');
const drReqs = () => GM.state.requests.filter((r) => r.kind === 'dr');
const exists = async (p) => (await bucket.file(p).exists())[0];

async function seed(o) {
  const opt = o || {};
  await env.clearFirestore();
  GM.reset(); PUSH = [];
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    const biz = (id, on) => b.set(d.doc('b/' + id), { name: id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true, dailyRep: on } });
    biz(A, opt.off ? false : true); biz(B, true); biz(OFF, false);
    b.set(d.doc(`b/${A}/admins/${M1}`), { email: 'm1@x.example' });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: 'דנה', role: 'employee', active: true, br: ['b1'] });
    b.set(d.doc(`b/${A}/staff/${E2}`), { name: 'יוסי', role: 'employee', active: true });
    b.set(d.doc(`b/${A}/staff/${E3}`), { name: 'רון', role: 'employee', active: true, pushTokens: ['tokE3'] });
    b.set(d.doc(`b/${A}/staff/${EX}`), { name: 'מושבת', role: 'employee', active: false, pushTokens: ['tokEX'] });
    b.set(d.doc(`b/${B}/admins/${MB}`), { email: 'mb@x.example' });
    b.set(d.doc(`b/${OFF}/staff/${EOFF}`), { name: 'אחר', role: 'employee', active: true });
    for (const [u, bz, role] of [[M1, A, 'admin'], [E1, A, 'worker'], [E2, A, 'worker'], [E3, A, 'worker'], [MB, B, 'admin'], [EOFF, OFF, 'worker'], [SUPER, A, 'admin']]) {
      b.set(d.doc('users/' + u), { bizId: bz, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    }
    b.set(d.doc(`b/${A}/push_tokens/${M1}`), { pushTokens: ['tokM1'] }); // בתוך העסק, כמו registerPushToken
    b.set(d.doc(`b/${A}/push_tokens/${E1}`), { pushTokens: ['tokE1'] });
    b.set(d.doc(`b/${A}/drcfg/main`), { days: [0, 1, 2, 3, 4], hr: '18:00', off: ['2026-11-18'], req: { [E1]: true, [E3]: true, [EX]: true } });
    b.set(d.doc(`b/${OFF}/drcfg/main`), { req: { [EOFF]: true } });
    // לארג' פעמי במצב legacy (שורש), עם התוספת מופעלת – השרת חייב לדחות
    b.set(d.doc('b/largpeami'), { name: 'ל', status: 'active', dataRoot: 'legacy', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true, dailyRep: true } });
    b.set(d.doc('staff/' + LE), { name: 'ותיק', active: true });
    b.set(d.doc('drcfg/main'), { req: { [LE]: true } });
    if (opt.cap !== undefined) b.set(d.doc(`b/${A}/drcfg/cap`), { capCents: opt.cap });
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv(); await GM.start();
  require('../functions/index.js');
  DR = require('../functions/daily-rep.js')._core;
  TK = require('../functions/lib/tk-time.js');
  bucket = require(require.resolve('firebase-admin/storage', { paths: [path.join(H.ROOT, 'functions')] })).getStorage().bucket(BUCKET);
});
after(async () => { await GM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

// ---------------------------------------------------------------------------------
describe('dailyRep – כללי Firestore', () => {
  beforeEach(async () => {
    await seed();
    const P = `b/${A}/`;
    await put(P + 'dr/' + ID1, { uid: E1, n: 'דנה', br: 'b1', day: '2026-11-16', t: 1, ut: 1, e: [{ t: 1, txt: 'א', tr: '', np: 1, au: false, sec: 0 }], st: 'ok', ai: 'ok', ap: 2, apBy: M1 });
    await put(P + 'dr/' + ID1 + '/p/0_0', { img: jpg(), t: 1, uid: E1 });
    await put(P + 'dr/' + ID1 + '/x/m', { sum: 's', sumW: 'w', notes: [] });
    await put(P + 'dr/' + ID1 + '/x/w', { sumW: 'w', notes: [], t: 2 });
    await put(P + 'dr/' + E2 + '_20261116', { uid: E2, n: 'יוסי', br: '', day: '2026-11-16', t: 1, ut: 1, e: [], st: 'new', ai: '', ap: 0, apBy: '' });
    await put(P + 'dr/' + E2 + '_20261116/x/w', { sumW: 'w', notes: [], t: 2 });
    await put(P + 'drcfg/cap', { capCents: 500, upd: 1, updBy: SUPER });
    await put(P + 'drcfg/use', { m: '2026-11', mc: 1 });
  });
  it('עובד רואה רק את הדיווח שלו (מסמך, תמונות, x/w), לא x/m; שאילתה רק על עצמו', async () => {
    const db = fs(E1), P = `b/${A}/dr/`;
    await assertSucceeds(db.doc(P + ID1).get());
    await assertSucceeds(db.doc(P + ID1 + '/p/0_0').get());
    await assertSucceeds(db.doc(P + ID1 + '/x/w').get());
    await assertFails(db.doc(P + ID1 + '/x/m').get());
    await assertFails(db.doc(P + E2 + '_20261116').get());
    await assertFails(fs(E2).doc(P + ID1 + '/x/w').get());
    await assertFails(fs(E2).doc(P + ID1 + '/p/0_0').get());
    await assertSucceeds(db.collection(`b/${A}/dr`).where('uid', '==', E1).get());
    await assertFails(db.collection(`b/${A}/dr`).get());
  });
  it('מנהל רואה הכול; עסק אחר נחסם; אף אחד לא כותב (גם לא מנהל ומנהל־על)', async () => {
    const P = `b/${A}/dr/`;
    for (const p of [ID1, ID1 + '/p/0_0', ID1 + '/x/m', ID1 + '/x/w', E2 + '_20261116']) await assertSucceeds(fs(M1).doc(P + p).get());
    await assertSucceeds(fs(M1).collection(`b/${A}/dr`).get());
    for (const p of [ID1, ID1 + '/x/m', ID1 + '/x/w']) await assertFails(fs(MB).doc(P + p).get());
    for (const u of [E1, M1, SUPER]) {
      await assertFails(fs(u).doc(P + ID1).update({ st: 'new' }));
      await assertFails(fs(u).doc(P + 'x_20261117').set({ uid: u }));
      await assertFails(fs(u).doc(P + ID1 + '/x/w').set({ sumW: 'x' }));
      await assertFails(fs(u).doc(P + ID1 + '/p/9_9').set({ img: 'x', uid: u }));
      await assertFails(fs(u).doc(`b/${A}/drcfg/main`).set({ req: {} }));
      await assertFails(fs(u).doc(`b/${A}/drcfg/cap`).set({ capCents: 9999 }));
    }
  });
  it('drcfg: main – צוות; cap – מנהל־על בלבד; use – אף אחד', async () => {
    await assertSucceeds(fs(E1).doc(`b/${A}/drcfg/main`).get());
    await assertSucceeds(fs(M1).doc(`b/${A}/drcfg/main`).get());
    await assertFails(fs(MB).doc(`b/${A}/drcfg/main`).get());
    await assertFails(fs(E1).doc(`b/${A}/drcfg/cap`).get());
    await assertFails(fs(M1).doc(`b/${A}/drcfg/cap`).get());
    await assertSucceeds(fs(SUPER).doc(`b/${A}/drcfg/cap`).get());
    await assertFails(fs(SUPER).doc(`b/${A}/drcfg/use`).get());
  });
  it('תוספת כבויה – אין גישה לאף אחד', async () => {
    await put('b/' + A, { features: { tasks: true, dailyRep: false } }, true);
    await assertFails(fs(M1).doc(`b/${A}/dr/${ID1}`).get());
    await assertFails(fs(E1).doc(`b/${A}/dr/${ID1}`).get());
    await assertFails(fs(E1).doc(`b/${A}/drcfg/main`).get());
    await assertFails(fs(SUPER).doc(`b/${A}/drcfg/cap`).get());
  });
  it('אין כלל dr / drcfg בשורש (legacy)', async () => {
    await put('dr/' + LE + '_20261116', { uid: LE });
    await assertFails(fs(LE).doc('dr/' + LE + '_20261116').get());
    await assertFails(fs(LE).doc('drcfg/main').get());
  });
});

// ---------------------------------------------------------------------------------
describe('drSubmit', () => {
  beforeEach(() => seed());
  it('דחיות: לא חייב, שבת, חופש, יום לא מוגדר (שישי), עסק legacy, תוספת כבויה, לא מחובר', async () => {
    assert.equal((await call('drSubmit', E2, { txt: 'x' }, MON())).reason, 'not-required');
    assert.equal((await call('drSubmit', E1, { txt: 'x' }, IL(2026, 11, 21, 12))).reason, 'sat');
    assert.equal((await call('drSubmit', E1, { txt: 'x' }, IL(2026, 11, 18, 12))).reason, 'off');
    assert.equal((await call('drSubmit', E1, { txt: 'x' }, IL(2026, 11, 20, 12))).reason, 'not-day');
    assert.equal((await call('drSubmit', LE, { txt: 'x' }, MON())).reason, 'legacy');
    assert.equal((await call('drSubmit', EOFF, { txt: 'x' }, MON())).reason, 'feature-off');
    assert.equal((await call('drSubmit', null, { txt: 'x' }, MON())).reason, 'not-signed-in');
    assert.equal(await get('dr/' + LE + '_20261116'), null, 'שום דבר לא נכתב לשורש');
    assert.equal(drReqs().length, 0);
  });
  it('דחיות גודל: הקלטה מעל 120 שניות, תמונה מעל 500KB, יותר מ-3 תמונות, ריק', async () => {
    assert.equal((await call('drSubmit', E1, { audio: { mime: 'audio/wav', b64: wavB64(122), sec: 120 } }, MON())).reason, 'too-long');
    assert.equal((await call('drSubmit', E1, { imgs: [jpg(400 * 1024)] }, MON())).reason, 'too-big');
    assert.equal((await call('drSubmit', E1, { imgs: [jpg(), jpg(), jpg(), jpg()] }, MON())).reason, 'too-many');
    assert.equal((await call('drSubmit', E1, {}, MON())).reason, 'empty');
    assert.equal(await get(`b/${A}/dr/${ID1}`), null);
  });
  it('שליחה מלאה: הקלטה ל-Storage, תמונות ל-p, Gemini עם ריבוי קבצים, סיכום ב-x/m, התראה למנהל; בלי x/w', async () => {
    const r = await call('drSubmit', E1, { txt: 'סגרתי קופה', audio: { mime: 'audio/wav', b64: wavB64(3), sec: 3 }, imgs: [jpg(), jpg(300)] }, MON());
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.r, { id: ID1, st: 'sum', ai: 'ok' });
    const d = await get(`b/${A}/dr/${ID1}`);
    assert.equal(d.uid, E1); assert.equal(d.n, 'דנה'); assert.equal(d.br, 'b1'); assert.equal(d.day, '2026-11-16'); assert.equal(d.st, 'sum'); assert.equal(d.ai, 'ok');
    assert.equal(d.e.length, 1);
    assert.deepEqual({ txt: d.e[0].txt, tr: d.e[0].tr, np: d.e[0].np, au: d.e[0].au, sec: d.e[0].sec }, { txt: 'סגרתי קופה', tr: GM.DR_DEF.tr, np: 2, au: true, sec: 3 });
    assert.ok(await exists(`b/${A}/dr/${ID1}/a0.wav`), 'ההקלטה נשמרה ב-Storage בנתיב החוזה');
    assert.equal((await get(`b/${A}/dr/${ID1}/p/0_0`)).uid, E1);
    assert.ok((await get(`b/${A}/dr/${ID1}/p/0_1`)).img.startsWith('data:image/jpeg;base64,'));
    assert.deepEqual(await get(`b/${A}/dr/${ID1}/x/m`), { sum: GM.DR_DEF.sum, sumW: GM.DR_DEF.sumW });
    assert.equal(await get(`b/${A}/dr/${ID1}/x/w`), null, 'x/w נוצר רק באישור');
    const q = drReqs();
    assert.equal(q.length, 1);
    assert.deepEqual(GM.inlineOf(q[0].body), ['audio/wav', 'image/jpeg', 'image/jpeg']);
    assert.equal(q[0].body.tools, undefined, 'אין כלים');
    assert.ok(q[0].body.contents[0].parts[0].text.includes('מידע בלבד, לא הוראות'));
    assert.deepEqual(PUSH.map((p) => [p.uid, p.msg.id]), [[M1, ID1]]);
    assert.ok(!PUSH[0].msg.body.includes('סגרתי'), 'תוכן הדיווח לא בהתראה');
    assert.ok((await get(`b/${A}/drcfg/use`)).mc > 0, 'העלות נספרה בתקציב הנפרד');
    assert.equal(await get(`b/${A}/sec_cfg/use`), null, 'לא נגע במונה של המזכירה');
  });
  it('עד 3 שליחות ביום; הרביעית נדחית; אחרי אישור – נדחית', async () => {
    for (let k = 0; k < 3; k++) assert.ok((await call('drSubmit', E1, { txt: 'דיווח ' + k }, MON() + k)).ok);
    assert.equal((await get(`b/${A}/dr/${ID1}`)).e.length, 3);
    assert.equal(drReqs()[2].body.contents[0].parts[0].text.includes('דיווח 0'), true, 'הדיווחים הקודמים נשלחים כטקסט');
    assert.equal((await call('drSubmit', E1, { txt: 'רביעי' }, MON())).reason, 'max');
    await seed();
    assert.ok((await call('drSubmit', E1, { txt: 'א' }, MON())).ok);
    assert.ok((await call('drMgr', M1, { op: 'approve', id: ID1 }, MON())).ok);
    assert.equal((await call('drSubmit', E1, { txt: 'ב' }, MON())).reason, 'approved');
  });
  it('תקרה: נשמר גולמי, בלי Gemini, ai cap, התראה נשלחת', async () => {
    await seed({ cap: 0 });
    const r = await call('drSubmit', E1, { txt: 'א', audio: { mime: 'audio/wav', b64: wavB64(2) } }, MON());
    assert.deepEqual(r.r, { id: ID1, st: 'raw', ai: 'cap' });
    assert.equal(drReqs().length, 0);
    assert.ok(await exists(`b/${A}/dr/${ID1}/a0.wav`));
    assert.equal((await get(`b/${A}/dr/${ID1}`)).e[0].txt, 'א');
    assert.equal(PUSH.length, 1);
  });
  it('כשל Gemini: התקציב מוחזר, נשמר גולמי, ai err, התראה נשלחת', async () => {
    GM.state.mode = 'quota';
    const r = await call('drSubmit', E1, { txt: 'א' }, MON());
    assert.deepEqual(r.r, { id: ID1, st: 'raw', ai: 'err' });
    assert.equal(drReqs().length, 1);
    const u = await get(`b/${A}/drcfg/use`);
    assert.equal(u.mc, 0); assert.equal(u.dmc, 0);
    assert.equal(PUSH.length, 1);
    GM.state.mode = 'ok';
    GM.state.dr = 'not json';
    assert.deepEqual((await call('drSubmit', E1, { txt: 'ב' }, MON())).r, { id: ID1, st: 'raw', ai: 'err' });
  });
});

// ---------------------------------------------------------------------------------
describe('drMgr', () => {
  beforeEach(async () => {
    await seed();
    assert.ok((await call('drSubmit', E1, { txt: 'א', audio: { mime: 'audio/wav', b64: wavB64(2) } }, MON())).ok);
    PUSH = [];
  });
  it('רק מנהל; עסק אחר לא מוצא; קלט לא תקין', async () => {
    assert.equal((await call('drMgr', E1, { op: 'notes', id: ID1, notes: [] })).reason, 'not-manager');
    assert.equal((await call('drMgr', MB, { op: 'notes', id: ID1, notes: [] })).reason, 'no-report');
    assert.equal((await call('drMgr', M1, { op: 'x', id: ID1 })).reason, 'bad-op');
    assert.equal((await call('drMgr', M1, { op: 'notes', id: '../x' })).reason, 'bad-id');
  });
  it('notes → tk → notes שומר tk לפי אינדקס; approve עם sumW בלבד לוקח הערות מ-x/m; אישור חוזר כותב מחדש ושולח שוב', async () => {
    assert.ok((await call('drMgr', M1, { op: 'notes', id: ID1, notes: [{ txt: 'לבדוק מלאי' }, { txt: 'לנקות' }] })).ok);
    assert.deepEqual((await call('drMgr', M1, { op: 'tk', id: ID1, i: 1, tk: ['t1', 't2'] })).r, { ok: true, i: 1, tk: ['t1', 't2'] });
    assert.equal((await call('drMgr', M1, { op: 'tk', id: ID1, i: 5, tk: ['t1'] })).reason, 'bad-index');
    await call('drMgr', M1, { op: 'notes', id: ID1, notes: [{ txt: 'לבדוק מלאי!' }, { txt: 'לנקות היטב' }] });
    const m = await get(`b/${A}/dr/${ID1}/x/m`);
    assert.deepEqual(m.notes, [{ txt: 'לבדוק מלאי!', tk: [] }, { txt: 'לנקות היטב', tk: ['t1', 't2'] }]);
    assert.equal(m.sum, GM.DR_DEF.sum, 'הסיכום נשמר');
    const a = await call('drMgr', M1, { op: 'approve', id: ID1, sumW: 'כל הכבוד' }, MON() + 5);
    assert.ok(a.ok);
    const w = await get(`b/${A}/dr/${ID1}/x/w`);
    assert.equal(w.sumW, 'כל הכבוד'); assert.deepEqual(w.notes, m.notes);
    const d = await get(`b/${A}/dr/${ID1}`);
    assert.equal(d.st, 'ok'); assert.equal(d.apBy, M1); assert.equal(d.ap, MON() + 5);
    assert.deepEqual(PUSH.map((p) => [p.uid, p.msg.id]), [[E1, ID1]]);
    assert.ok((await call('drMgr', M1, { op: 'approve', id: ID1, sumW: 'עודכן' })).ok);
    assert.equal((await get(`b/${A}/dr/${ID1}/x/w`)).sumW, 'עודכן');
    assert.equal(PUSH.length, 2, 'אישור חוזר שולח התראה נוספת');
    assert.deepEqual((await call('drMgr', M1, { op: 'tk', id: ID1, i: 1, tk: ['t3', 't1'] })).r.tk, ['t1', 't2', 't3'], 'tk מצרף, בלי כפילויות');
    assert.deepEqual((await get(`b/${A}/dr/${ID1}/x/w`)).notes[1].tk, ['t1', 't2', 't3'], 'tk מתעדכן גם במה שאושר');
    await call('drMgr', M1, { op: 'notes', id: ID1, notes: [{ txt: '' }, { txt: 'לנקות היטב' }, { txt: '' }] });
    assert.deepEqual((await get(`b/${A}/dr/${ID1}/x/m`)).notes, [{ txt: '', tk: [] }, { txt: 'לנקות היטב', tk: ['t1', 't2', 't3'] }], 'ריקה באמצע נשארת (אינדקס), ריקה בסוף נשמטת');
    assert.equal((await call('drMgr', M1, { op: 'resum', id: ID1 })).reason, 'approved');
  });
  it('audio מחזיר את ההקלטה; שליחה בלי הקלטה – no-audio', async () => {
    const r = await call('drMgr', M1, { op: 'audio', id: ID1, i: 0 });
    assert.equal(r.r.mime, 'audio/wav');
    assert.equal(r.r.b64, wavB64(2));
    await call('drSubmit', E1, { txt: 'בלי הקלטה' }, MON());
    assert.equal((await call('drMgr', M1, { op: 'audio', id: ID1, i: 1 })).reason, 'no-audio');
    assert.equal((await call('drMgr', M1, { op: 'audio', id: ID1, i: 7 })).reason, 'bad-index');
  });
  it('resum: דיווח גולמי מסוכם מחדש, כולל ההקלטה; כפוף לתקרה', async () => {
    await seed({ cap: 0 });
    await call('drSubmit', E1, { txt: 'א', audio: { mime: 'audio/wav', b64: wavB64(2) }, imgs: [jpg()] }, MON());
    assert.equal((await get(`b/${A}/dr/${ID1}`)).st, 'raw');
    assert.deepEqual((await call('drMgr', M1, { op: 'resum', id: ID1 })).r, { ok: true, st: 'raw', ai: 'cap' });
    await put(`b/${A}/drcfg/cap`, { capCents: 500 });
    assert.deepEqual((await call('drMgr', M1, { op: 'resum', id: ID1 })).r, { ok: true, st: 'sum', ai: 'ok' });
    assert.deepEqual(GM.inlineOf(drReqs()[0].body), ['audio/wav', 'image/jpeg']);
    assert.equal((await get(`b/${A}/dr/${ID1}`)).e[0].tr, GM.DR_DEF.tr);
  });
});

// ---------------------------------------------------------------------------------
describe('drSetCfg / drSetCap', () => {
  beforeEach(() => seed());
  it('drSetCfg: מנהל בלבד, שבת נדחית, req ממוזג (false = הסרה)', async () => {
    assert.equal((await call('drSetCfg', E1, { hr: '17:00' })).reason, 'not-manager');
    assert.equal((await call('drSetCfg', M1, { days: [0, 6] })).reason, 'sat');
    const r = await call('drSetCfg', M1, { hr: '17:30', req: { [E2]: true, [E3]: false } });
    assert.ok(r.ok);
    const c = await get(`b/${A}/drcfg/main`);
    assert.equal(c.hr, '17:30'); assert.deepEqual(c.req, { [E1]: true, [E2]: true, [EX]: true }); assert.deepEqual(c.off, ['2026-11-18']);
    assert.equal(c.updBy, M1);
    assert.equal((await call('drSetCfg', LE, { hr: '17:00' })).reason, 'legacy');
  });
  it('drSetCap: מנהל־על בלבד', async () => {
    assert.equal((await call('drSetCap', M1, { capCents: 900 })).reason, 'not-superadmin');
    assert.equal((await call('drSetCap', SUPER, { bizId: A, capCents: -1 })).reason, 'bad-cap');
    assert.ok((await call('drSetCap', SUPER, { bizId: A, capCents: 900 })).ok);
    assert.equal((await get(`b/${A}/drcfg/cap`)).capCents, 900);
  });
});

// ---------------------------------------------------------------------------------
describe('drRemind', () => {
  beforeEach(() => seed());
  const run = (now) => DR.runRemind({ now, send });
  it('פעם ביום, אחרי השעה, רק לחייב פעיל שלא דיווח; לא בשבת / חופש; עסק legacy לא נכלל', async () => {
    await call('drSubmit', E1, { txt: 'א' }, MON());
    PUSH = [];
    let r = await run(IL(2026, 11, 16, 17, 59));
    assert.deepEqual(r[A], { skip: 'early' });
    assert.equal(PUSH.length, 0);
    r = await run(IL(2026, 11, 16, 18, 0));
    assert.deepEqual(PUSH.map((p) => [p.uid, p.msg.id]), [[E3, E3 + '_20261116']], 'רק E3: E1 דיווח, EX מושבת');
    assert.ok(!('largpeami' in r), 'legacy לא נכלל');
    await run(IL(2026, 11, 16, 18, 15));
    assert.equal(PUSH.length, 1, 'פעם אחת ביום');
    assert.ok((await get(`b/${A}/drcfg/rem_20261116`)).u[E3]);
    assert.deepEqual((await run(IL(2026, 11, 21, 19)))[A], { skip: 'sat' });
    assert.deepEqual((await run(IL(2026, 11, 18, 19)))[A], { skip: 'off' });
    assert.equal(PUSH.length, 1);
    await run(IL(2026, 11, 17, 19));
    assert.deepEqual(PUSH.slice(1).map((p) => p.uid).sort(), [E1, E3], 'יום חדש – תזכורת חדשה (גם E1, שעוד לא דיווח היום)');
  });
  it('שעון קיץ וחורף: 18:00 בישראל = 15:00Z בקיץ, 16:00Z בחורף', async () => {
    // E1 ו-E3 חייבים ולא דיווחו – 2 תזכורות בכל יום
    await run(Date.UTC(2026, 6, 13, 14, 59)); assert.equal(PUSH.length, 0);
    await run(Date.UTC(2026, 6, 13, 15, 0)); assert.equal(PUSH.length, 2);
    await run(Date.UTC(2026, 10, 23, 15, 59)); assert.equal(PUSH.length, 2);
    await run(Date.UTC(2026, 10, 23, 16, 0)); assert.equal(PUSH.length, 4);
  });
});
