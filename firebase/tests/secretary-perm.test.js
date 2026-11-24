'use strict';
// גיטי – סבב 4 חלק א (24.11.2026): הרשאות הפעולה של גיטי ותקרות הסכום (lib/sec-perm.js, sec_cfg/perm).
// מסך: secPrefs op:'perm' (רק מנהל־העל); צ'אט: הוראה → כרטיס, נשמר רק ב-secPrefs op:'permCard' (רק מנהל־העל); תשלום – תמיד נדחה;
// אכיפה: proposeTask, אישור התחייבות, תור ההתחייבויות, המונה היומי (takeAuto); כללי Firestore ל-sec_cfg/perm.
// מול האמולטור, מודל מדומה בלבד (gemini-mock.js).
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-pm';
const SA = 'pm_sa', M2 = 'pm_m2', E1 = 'pm_e1'; // SA – מנהל העסק וגם מנהל־העל (superadmins); M2 – מנהל רגיל
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
let env, SEC, PERM, CMT, T;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const logs = async (re) => (await coll(`b/${A}/sec_log`)).filter((l) => re.test(l.act));
const inBiz = (fn) => T.runInBiz({ bizId: A, prefix: 'b/' + A + '/' }, () => fn(T.tdb()));
const secReqs = () => GM.state.requests.filter((r) => r.kind === 'sec');
const lastIsRes = (body) => { const c = (body.contents || []).slice(-1)[0]; return !!(c && (c.parts || []).some((p) => p.functionResponse)); };
function responses(body) { const out = {}; for (const c of body.contents || []) for (const p of c.parts || []) if (p.functionResponse) out[p.functionResponse.name] = p.functionResponse.response.content; return out; }

async function seed(perm) {
  await env.clearFirestore();
  GM.reset();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { tasks: true, secretary: true } });
    for (const u of [SA, M2]) { b.set(d.doc(`b/${A}/admins/${u}`), { email: u + '@example.invalid' }); b.set(d.doc(`b/${A}/staff/${u}`), { name: u, role: 'manager', active: true }); }
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: 'דוד כהן', role: 'employee', active: true });
    b.set(d.doc('superadmins/' + SA), {});
    for (const [u, role] of [[SA, 'admin'], [M2, 'admin'], [E1, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    const mgr = {}; for (const u of [SA, M2]) mgr[u] = { cv: SEC.CONSENT_VER, ca: 1, nm: 'גיטי', ad: 'f' };
    b.set(d.doc(`b/${A}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: true, pay: {}, sens: {}, mgr, cmt: true });
    b.set(d.doc(`b/${A}/sec_cfg/cap`), { capCents: 5000 });
    if (perm) b.set(d.doc(`b/${A}/sec_cfg/perm`), perm);
    await b.commit();
  });
}
const chat = (u, text) => call('secChat', u, { text });

before(async () => {
  env = await H.getEnv(); await GM.start(); require('../functions/index.js');
  SEC = require('../functions/secretary.js')._core; PERM = require('../functions/lib/sec-perm.js'); CMT = require('../functions/lib/sec-cmt.js'); T = require('../functions/lib/tenant.js');
});
after(async () => { await GM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => GM.reset());

describe('גיטי – הרשאות פעולה: מסך (secPrefs op:perm)', () => {
  beforeEach(() => seed());
  it('בלי מסמך: secState מחזיר ברירת מחדל "רק אחרי אישור" ו-500/2000; מנהל־העל – edit, מנהל רגיל – צפייה בלבד', async () => {
    const s1 = (await call('secState', SA, {})).result.perm, s2 = (await call('secState', M2, {})).result.perm;
    assert.deepEqual(s1.t, { task: 'ask', rem: 'ask', msg: 'ask', ord: 'ask', tag: 'ask' });
    assert.deepEqual([s1.cap1, s1.capD, s1.anPct, s1.anMin], [500, 2000, 30, 200]);
    assert.equal(s1.edit, true); assert.equal(s2.edit, false); assert.deepEqual(s2.t, s1.t);
    assert.ok(!s1.types.some((x) => /pay|transfer/.test(x.k) || /תשלום|העבר/.test(x.l)), 'אין סוג תשלום במסך');
    assert.equal(await get(`b/${A}/sec_cfg/perm`), null, 'הקריאה לא יוצרת מסמך');
    assert.equal(s1.src.msg, 'def');
  });
  it('תאימות לאחור: בלי ערך שמור ועם מנגנון לבד דלוק (מענה אוטומטי במייל / "קיבלנו" / כלל אישי "לבד") – "לבד" לפי ההגדרות הקיימות; ערך שמור גובר', async () => {
    for (const [p, v] of [[`b/${A}/sec_cfg/mail_rep`, { auto: true }], [`b/${A}/sec_cfg/wa`, { ack: { on: true, text: 'קיבלנו' } }], [`b/${A}/sec_mrule/r1`, { uid: SA, auto: true, on: true }]]) {
      await seed();
      await prep((d) => d.doc(p).set(v));
      const s = (await call('secState', M2, {})).result.perm;
      assert.equal(s.t.msg, 'auto', p); assert.equal(s.src.msg, 'legacy', p); assert.equal(s.t.task, 'ask');
      assert.equal(await inBiz((db) => PERM.blocked(db, 'msg')), false, p);
    }
    await prep((d) => d.doc(`b/${A}/sec_cfg/perm`).set({ t: { msg: 'ask' } }));
    const s = (await call('secState', M2, {})).result.perm;
    assert.equal(s.t.msg, 'ask'); assert.equal(s.src.msg, 'set');
    assert.equal(await inBiz((db) => PERM.blocked(db, 'msg')), true, '"רק אחרי אישור" עוצר גם מנגנון דלוק');
    await seed(); // בלי מנגנון דלוק – רק אחרי אישור
    assert.equal(await inBiz((db) => PERM.blocked(db, 'msg')), true);
    // כיבוי הכללים האישיים בעסק – כלל "לבד" לא נחשב מנגנון דלוק
    await prep(async (d) => { await d.doc(`b/${A}/sec_mrule/r1`).set({ uid: SA, auto: true }); await d.doc(`b/${A}/sec_cfg/main`).update({ learn: false }); });
    assert.equal((await call('secState', M2, {})).result.perm.t.msg, 'ask');
  });
  it('מנהל רגיל נדחה – שום דבר לא נשמר; מנהל־העל משנה סוג ותקרה – נשמר ונרשם ביומן (permSet, מנהל המערכת)', async () => {
    for (const d of [{ op: 'perm', type: 'msg', lvl: 'auto' }, { op: 'perm', num: 'cap1', v: 900 }]) {
      const r = await call('secPrefs', M2, d);
      assert.equal(r.status, 'PERMISSION_DENIED', r.text); assert.equal(r.reason, 'not-superadmin');
    }
    assert.equal(await get(`b/${A}/sec_cfg/perm`), null);
    const r1 = await call('secPrefs', SA, { op: 'perm', type: 'msg', lvl: 'auto' });
    assert.equal(r1.status, 'OK', r1.text); assert.equal(r1.result.perm.t.msg, 'auto'); assert.equal(r1.result.perm.t.task, 'ask');
    const r2 = await call('secPrefs', SA, { op: 'perm', num: 'cap1', v: 900 });
    assert.equal(r2.status, 'OK', r2.text); assert.equal(r2.result.perm.cap1, 900); assert.equal(r2.result.perm.t.msg, 'auto');
    const doc = await get(`b/${A}/sec_cfg/perm`);
    assert.deepEqual(doc.t, { msg: 'auto' }); assert.equal(doc.cap1, 900); assert.equal(doc.updBy, SA);
    const l = await logs(/^perm/);
    assert.deepEqual(l.map((x) => x.note).sort(), ['cap1:500>900 screen', 'msg:ask>auto screen']);
    assert.ok(l.every((x) => x.act === 'permSet' && x.who === 'sa' && x.by === SA));
    assert.equal((await call('secState', M2, {})).result.perm.t.msg, 'auto', 'מנהל רגיל רואה את השינוי');
  });
  it('אין מסלול תשלום: סוג תשלום / רמה לא מוכרת / סכום מחוץ לגבולות – נדחים, שום דבר לא נשמר', async () => {
    for (const d of [{ type: 'pay', lvl: 'auto' }, { type: 'transfer', lvl: 'auto' }, { type: 'msg', lvl: 'always' }, { num: 'pay', v: 100 }, { num: 'cap1', v: 1e9 }, { num: 'capD', v: -1 }, {}]) {
      const r = await call('secPrefs', SA, Object.assign({ op: 'perm' }, d));
      assert.equal(r.status, 'INVALID_ARGUMENT', JSON.stringify(d) + ' ' + r.text);
    }
    assert.equal(await get(`b/${A}/sec_cfg/perm`), null);
  });
  it('כללי Firestore: מנהל לא כותב ל-sec_cfg/perm ולא קורא אותו ישירות (רק דרך secState)', async () => {
    const { assertFails } = require('@firebase/rules-unit-testing');
    await prep((d) => d.doc(`b/${A}/sec_cfg/perm`).set({ t: { msg: 'no' } }));
    for (const u of [SA, M2]) {
      const db = env.authenticatedContext(u).firestore();
      await assertFails(db.doc(`b/${A}/sec_cfg/perm`).set({ t: { msg: 'auto' } }));
      await assertFails(db.doc(`b/${A}/sec_cfg/perm`).update({ cap1: 99999 }));
      await assertFails(db.doc(`b/${A}/sec_cfg/perm`).delete());
    }
    await assertFails(env.authenticatedContext(M2).firestore().doc(`b/${A}/sec_cfg/perm`).get());
    assert.deepEqual((await get(`b/${A}/sec_cfg/perm`)).t, { msg: 'no' });
  });
});

describe('גיטי – הוראה בצ\'אט: כרטיס הצעה + אישור (secChat, secPrefs op:permCard)', () => {
  beforeEach(() => seed());
  it('מנהל רגיל: תשובה מנומסת שאין הרשאה, בלי כרטיס, בלי AI ובלי שינוי', async () => {
    const r = await chat(M2, 'תני לעצמך לשלוח הודעות לבד');
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.mode, 'perm'); assert.match(r.result.reply, /רק מנהל־העל/); assert.deepEqual(r.result.cards, []);
    assert.equal(secReqs().length, 0, 'בלי קריאה למודל');
    assert.equal(await get(`b/${A}/sec_cfg/perm`), null);
    assert.equal((await logs(/^permDeny$/)).length, 1);
  });
  it('מנהל־העל: כרטיס – לא נשמר לפני אישור; מנהל רגיל לא יכול לאשר; "אשר" שומר; אישור חוזר – already', async () => {
    const r = await chat(SA, 'תני לעצמך לשלוח הודעות לבד');
    assert.equal(r.status, 'OK', r.text); assert.equal(secReqs().length, 0);
    const c = r.result.cards.find((x) => x.k === 'perm');
    assert.ok(c && /^pm[0-9a-f]{16}$/.test(c.id), JSON.stringify(r.result.cards));
    assert.deepEqual(c.ch, { type: 'msg', lvl: 'auto' }); assert.match(c.txt, /רק אחרי אישור ← לבד/);
    assert.equal(await get(`b/${A}/sec_cfg/perm`), null, 'שום דבר לא נשמר לפני האישור');
    // מנהל רגיל – גם עם המזהים הנכונים
    const d2 = await call('secPrefs', M2, { op: 'permCard', mid: r.result.id, cid: c.id, st: 'ok' });
    assert.equal(d2.status, 'PERMISSION_DENIED'); assert.equal(await get(`b/${A}/sec_cfg/perm`), null);
    // כרטיס מזויף / מזהה לא קיים
    assert.equal((await call('secPrefs', SA, { op: 'permCard', mid: r.result.id, cid: 'pm' + '0'.repeat(16), st: 'ok' })).reason, 'not-found');
    assert.equal((await call('secPrefs', SA, { op: 'permCard', mid: r.result.id, cid: c.id, st: 'ok', ch: { type: 'msg', lvl: 'no' } })).status, 'OK', 'השינוי נקרא מהכרטיס השמור בלבד');
    assert.deepEqual((await get(`b/${A}/sec_cfg/perm`)).t, { msg: 'auto' });
    const again = await call('secPrefs', SA, { op: 'permCard', mid: r.result.id, cid: c.id, st: 'ok' });
    assert.equal(again.result.already, true);
    const m = await get(`b/${A}/sec_chat/${SA}/m/${r.result.id}`);
    assert.equal(m.cards.find((x) => x.id === c.id).st, 'ok');
    const l = await logs(/^perm(Set|Prop)$/);
    assert.deepEqual(l.map((x) => x.act).sort(), ['permProp', 'permSet']);
    assert.equal(l.find((x) => x.act === 'permSet').note, 'msg:ask>auto chat');
  });
  it('תקרה מהצ\'אט: "תעלי את התקרה ל-1000" → כרטיס; "בטל" – לא נשמר; מחוץ לגבולות – בלי כרטיס', async () => {
    const r = await chat(SA, 'תעלי את התקרה ל-1000');
    const c = r.result.cards.find((x) => x.k === 'perm');
    assert.deepEqual(c.ch, { num: 'cap1', v: 1000 });
    assert.equal((await call('secPrefs', SA, { op: 'permCard', mid: r.result.id, cid: c.id, st: 'no' })).status, 'OK');
    assert.equal(await get(`b/${A}/sec_cfg/perm`), null);
    assert.equal((await logs(/^permCardNo$/)).length, 1);
    assert.equal((await call('secPrefs', SA, { op: 'permCard', mid: r.result.id, cid: c.id, st: 'ok' })).result.already, true, 'כרטיס שבוטל לא מאושר אחר כך');
    assert.equal(await get(`b/${A}/sec_cfg/perm`), null);
    const big = await chat(SA, 'תעלי את התקרה ל-500000');
    assert.deepEqual(big.result.cards, []); assert.match(big.result.reply, /לא הוכן שינוי/);
    for (const t of ['תעלי את התקרה ל -5', 'תעלי את התקרה ל-1e9', 'תעלי את התקרה לאלף']) {
      const r2 = await chat(SA, t);
      assert.deepEqual(r2.result.cards, [], t); assert.match(r2.result.reply, /לא זיהיתי מספר/, t);
    }
    assert.equal(await get(`b/${A}/sec_cfg/perm`), null);
  });
  it('אין מסלול תשלום: בקשה בצ\'אט להרשאת תשלום נדחית – גם ממנהל־העל, בלי כרטיס ובלי AI', async () => {
    for (const u of [SA, M2]) for (const t of ['תני לעצמך לשלם לספקים לבד', 'תוסיפי לעצמך הרשאת תשלום']) {
      const r = await chat(u, t);
      assert.equal(r.status, 'OK', r.text); assert.match(r.result.reply, /תשלומים והעברות כסף חסומים/); assert.deepEqual(r.result.cards, []);
    }
    assert.equal(secReqs().length, 0); assert.equal(await get(`b/${A}/sec_cfg/perm`), null);
    assert.equal((await logs(/^permPayNo$/)).length, 4);
  });
});

describe('גיטי – אכיפה', () => {
  it('proposeTask: משימה "אסור" – בלי כרטיס (גם לא הצעה); תזכורת ב"אחרי אישור" – כרטיס כרגיל', async () => {
    await seed({ t: { task: 'no' } });
    GM.state.sec = (body) => (lastIsRes(body) ? { text: 'בסדר.' } : { calls: [{ name: 'proposeTask', args: { kind: 'task', text: 'לנקות את המחסן', employees: ['דוד כהן'] } }, { name: 'proposeTask', args: { kind: 'reminder', text: 'להתקשר לספק', date: PERM.dayKey(Date.now() + 864e5) } }] });
    const r = await chat(SA, 'פתחי משימה לדוד לנקות את המחסן ותזכירי לי מחר להתקשר לספק');
    assert.equal(r.status, 'OK', r.text);
    const res = responses(secReqs().slice(-1)[0].body);
    assert.equal(res.proposeTask.proposed, true, 'התשובה האחרונה – של התזכורת');
    const tk = r.result.cards.filter((x) => x.k === 'tkp');
    assert.deepEqual(tk.map((x) => x.kind), ['rem']);
    const first = secReqs().slice(-1)[0].body.contents.flatMap((x) => x.parts || []).filter((p) => p.functionResponse).map((p) => p.functionResponse.response.content);
    assert.ok(first.some((x) => x.error === 'not-allowed'), JSON.stringify(first));
  });
  it('התחייבות: משימה וגם תזכורת "אסור" – אין תפיסה (claim) ותור הזיהוי מתרוקן בלי AI', async () => {
    await seed({ t: { task: 'no', rem: 'no' } });
    const cid = 'cm' + 'a'.repeat(16);
    await prep(async (d) => {
      await d.doc(`b/${A}/sec_cmt/${cid}`).set({ t: Date.now(), ch: 'mail', src: {}, from: 'x', who: 'them', what: 'לשלוח הצעת מחיר', d: '', prev: '', st: 'pend' });
      await d.doc(`b/${A}/sec_cmtq/${cid}`).set({ t: Date.now(), exp: Date.now() + 864e5, n: 0, ch: 'mail', id: 'm1', from: 'x', text: 'אחזור אליך מחר עם הצעת מחיר' });
    });
    for (const kind of ['task', 'rem', undefined]) {
      const r = await call('secPrefs', SA, Object.assign({ op: 'cmt', cid, st: 'claim' }, kind ? { kind } : {}));
      assert.equal(r.status, 'PERMISSION_DENIED', r.text); assert.equal(r.reason, 'perm-no');
    }
    assert.equal((await get(`b/${A}/sec_cmt/${cid}`)).st, 'pend');
    let ai = 0;
    const out = await inBiz((db) => CMT.runQueue(db, { ai: async () => { ai++; return { text: '{}' }; } }));
    assert.equal(out.perm, 1); assert.equal(ai, 0); assert.equal((await coll(`b/${A}/sec_cmtq`)).length, 1, 'לא נמחק – רק לא מעובד');
    // רק משימה אסורה – תפיסה לתזכורת עוברת
    await prep((d) => d.doc(`b/${A}/sec_cfg/perm`).set({ t: { task: 'no', rem: 'ask' } }));
    assert.equal((await call('secPrefs', SA, { op: 'cmt', cid, st: 'claim', kind: 'task' })).reason, 'perm-no');
    assert.equal((await call('secPrefs', SA, { op: 'cmt', cid, st: 'claim', kind: 'rem' })).status, 'OK');
    // סגירה בלי סוג (= משימה) – נאכפת בשרת, גם כשמשימה כבר נוצרה במזהה ההצעה
    await prep((d) => d.doc(`b/${A}/tasks/sec${cid}`).set({ owner: SA, txt: 'x' }));
    const ok = await call('secPrefs', SA, { op: 'cmt', cid, st: 'ok' });
    assert.equal(ok.status, 'PERMISSION_DENIED', ok.text); assert.equal(ok.reason, 'perm-no');
    assert.notEqual((await get(`b/${A}/sec_cmt/${cid}`)).st, 'ok');
  });
  it('takeAuto (נקודת החיבור לחלק ב): ברירת מחדל – אישור; "לבד" בתוך התקרה; מעל 500 לפעולה ומעל 2,000 ביום – אישור; המונה רק על ביצוע', async () => {
    await seed();
    const now = Date.now();
    assert.deepEqual(await inBiz((db) => PERM.takeAuto(db, 'ord', 100, now)), { used: 0, r: 'ask', why: 'perm' });
    await prep((d) => d.doc(`b/${A}/sec_cfg/perm`).set({ t: { ord: 'auto' } }));
    assert.equal((await inBiz((db) => PERM.takeAuto(db, 'ord', 600, now))).why, 'cap1');
    for (let i = 0; i < 4; i++) assert.equal((await inBiz((db) => PERM.takeAuto(db, 'ord', 500, now))).r, 'auto');
    const last = await inBiz((db) => PERM.takeAuto(db, 'ord', 1, now));
    assert.deepEqual(last, { used: 2000, r: 'ask', why: 'capD' });
    assert.deepEqual((await get(`b/${A}/sec_cfg/use`)).pa, { d: PERM.dayKey(now), s: 2000 });
    assert.equal((await inBiz((db) => PERM.takeAuto(db, 'pay', 1, now))).r, 'no', 'אין סוג תשלום');
  });
  it('takeAuto במקביל: 6 פעולות של 500 בו-זמנית – בדיוק 4 עוברות, המונה היומי 2,000 ולא יותר', async () => {
    await seed({ t: { ord: 'auto' } });
    const now = Date.now();
    const rs = await Promise.all(Array.from({ length: 6 }, () => inBiz((db) => PERM.takeAuto(db, 'ord', 500, now))));
    assert.equal(rs.filter((x) => x.r === 'auto').length, 4, JSON.stringify(rs));
    assert.ok(rs.filter((x) => x.r !== 'auto').every((x) => x.why === 'capD'));
    assert.equal((await get(`b/${A}/sec_cfg/use`)).pa.s, 2000);
  });
});
