'use strict';
// גיטי מנהלת עסק (23.11.2026, החלטות 2–3): כלי קריאה חדשים בצ'אט – בקשות עובדים (rq), "ממתין לטיפול" (mq), משמרות (shf), מלאי (prod, stockLog) –
// והצעת משימה/תזכורת: proposeTask מחזיר כרטיס (k:'tkp') ולא כותב; הביצוע במנגנון הקיים (משימה – כתיבה ל-tasks לפי החוקים; תזכורת – secCal add),
// ואחריו secPrefs op:'tkCard' בודק שהיא נוצרה ע"י המנהל, מסמן את הכרטיס ורושם ב-sec_log. מול האמולטור, מודל מדומה בלבד (gemini-mock.js).
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-gt';
const M1 = 'gt_m1', M2 = 'gt_m2', MBR = 'gt_mbr', E1 = 'gt_e1', E2 = 'gt_e2';
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
let env, SEC, K, ST;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const dk = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const TODAY = dk(Date.now());
const dAdd = (d, k) => { const [y, m, x] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, x + k)).toISOString().slice(0, 10); };
let BIZD = dAdd(TODAY, 1);
const HR = 3600000, DAY = 864e5;

async function seed(o) {
  const opt = Object.assign({ feat: { tasks: true, secretary: true, orders: true } }, o);
  await env.clearFirestore();
  const now = Date.now();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: opt.feat });
    for (const u of [M1, M2, MBR]) { b.set(d.doc(`b/${A}/admins/${u}`), Object.assign({ email: u + '@example.invalid' }, u === MBR ? { br: ['b1'] } : {})); b.set(d.doc(`b/${A}/staff/${u}`), { name: u, role: 'manager', active: true }); }
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: 'דוד כהן', role: 'employee', active: true });
    b.set(d.doc(`b/${A}/staff/${E2}`), { name: 'רינה לוי', role: 'employee', active: true });
    for (const [u, role] of [[M1, 'admin'], [M2, 'admin'], [MBR, 'admin'], [E1, 'worker'], [E2, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@example.invalid', createdAt: 1 });
    const mgr = {}; for (const u of [M1, M2, MBR]) mgr[u] = { cv: SEC.CONSENT_VER, ca: 1, nm: 'גיטי', ad: 'f' };
    b.set(d.doc(`b/${A}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: true, pay: {}, sens: {}, mgr });
    b.set(d.doc(`b/${A}/sec_cfg/cap`), { capCents: 5000 });
    // בקשות עובדים: ממתינה עם תגובה, טופלה, וממתינה ישנה (מחוץ לטווח – עדיין מוצגת כממתינה)
    b.set(d.doc(`b/${A}/rq/r1`), { owner: E1, by: 'דוד כהן', txt: 'אפשר יום חופש ביום חמישי?', t: now - 2 * HR, st: 'new', ans: '', k: 'q', ph: 'r', cT: 'מחכה לתשובה', cN: 'דוד כהן', cAt: now - HR });
    b.set(d.doc(`b/${A}/rq/r2`), { owner: E2, by: 'רינה לוי', txt: 'המקרר מטפטף', t: now - 5 * DAY, st: 'done', ans: 'הוזמן טכנאי', k: 'b' });
    b.set(d.doc(`b/${A}/rq/r3`), { owner: E2, by: 'רינה לוי', txt: 'צריך מדים חדשים', t: now - 60 * DAY, st: 'new', ans: '', k: '' });
    // ממתין לטיפול
    b.set(d.doc(`b/${A}/mq/q1`), { uid: E1, by: 'דוד כהן', t: now - 3 * HR, st: 'new', k: 'zreport', np: 2 });
    b.set(d.doc(`b/${A}/mq/q2`), { uid: E2, by: 'רינה לוי', t: now - 2 * DAY, st: 'done', k: 'invoice', np: 1 });
    // משמרות היום: אחת עם עובד, אחת בלי
    b.set(d.doc(`b/${A}/shf/s1`), { u: E1, nm: 'דוד כהן', fx: false, d: TODAY, s: '08:00', e: '14:00' });
    b.set(d.doc(`b/${A}/shf/s2`), { u: '', nm: '', fx: false, d: TODAY, s: '14:00', e: '20:00' });
    // מלאי: מתחת למינימום, שלילי, תקין + תנועת מכירה בקופה
    b.set(d.doc(`b/${A}/prod/p1`), { name: 'קמח לבן', price: 10, on: true, q: { _: 3 }, minQ: { _: 10 } });
    b.set(d.doc(`b/${A}/prod/p2`), { name: 'סוכר', price: 7, on: true, q: { _: -2 } });
    b.set(d.doc(`b/${A}/prod/p3`), { name: 'מלח', price: 3, on: true, q: { _: 50 } });
    b.set(d.doc(`b/${A}/stockLog/l1`), { prod: 'p3', br: '_', delta: -4, why: 'pos', by: E1, at: now - HR });
    await b.commit();
  });
}
const secReqs = () => GM.state.requests.filter((r) => r.kind === 'sec');
const declNames = (req) => (((req.body.tools || [])[0] || {}).functionDeclarations || []).map((x) => x.name);
const lastIsRes = (body) => { const c = (body.contents || []).slice(-1)[0]; return !!(c && (c.parts || []).some((p) => p.functionResponse)); };
function responses(body) { const out = {}; for (const c of body.contents || []) for (const p of c.parts || []) if (p.functionResponse) out[p.functionResponse.name] = p.functionResponse.response.content; return out; }
const model = (calls, answer) => (body) => (lastIsRes(body) ? { text: answer(responses(body), body) } : { calls });
const lastRes = () => responses(secReqs().slice(-1)[0].body);
// משימה כמו cxCreate באפליקציה (אותם שדות)
const taskOf = (owner, o) => { const t = Date.now(); return Object.assign({ owner, by: owner, role: 'a', txt: 'לנקות את המחסן', cr: t, due: t + 3 * DAY, st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '', to: [E1], toN: ['דוד כהן'], ow: E1, owN: 'דוד כהן', clt: t, np: 0, wp: 0, mi: 0 }, o); };

before(async () => {
  env = await H.getEnv(); await GM.start(); require('../functions/index.js');
  SEC = require('../functions/secretary.js')._core; K = require('../functions/lib/sec-know.js'); ST = require('../functions/lib/sec-tools.js');
  while (!K.bizDay(BIZD)) BIZD = dAdd(BIZD, 1);
});
after(async () => { await GM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => GM.reset());

describe('גיטי – כלי קריאה: בקשות עובדים, ממתין לטיפול, משמרות, מלאי', () => {
  it('הכלים מוצעים בצ\'אט (רק קריאה / הצעה); מנהל עם הגבלת סניפים – לא', async () => {
    const L = ST.toolsFor('app', {});
    for (const n of ['getStaffRequests', 'getPendingQueue', 'getShifts', 'getStock', 'proposeTask']) assert.ok(L.includes(n), n);
    assert.ok(L.every((n) => /^(get|simulate|loanCalc|refuseOffTopic|propose)/.test(n)));
    const lim = ST.toolsFor('app', { brLimited: true });
    for (const n of ['getStaffRequests', 'getPendingQueue', 'getShifts', 'getStock', 'proposeTask']) assert.ok(!lim.includes(n), n);
    await seed();
    GM.state.sec = () => ({ text: 'שלום' });
    const r = await call('secChat', MBR, { text: 'מה הבקשות של העובדים?' });
    assert.equal(r.status, 'OK', r.text);
    assert.ok(!r.result.offered.includes('getStaffRequests') && !r.result.offered.includes('proposeTask'));
    assert.deepEqual(declNames(secReqs()[0]), ST.declsOf(ST.toolsFor('app', { brLimited: true })).map((x) => x.name));
  });
  it('ארבעת הכלים מחזירים את הנתונים, עם מקור ובדיקת מספרים; כל קריאה ביומן', async () => {
    await seed();
    GM.state.sec = model([{ name: 'getStaffRequests', args: {} }, { name: 'getPendingQueue', args: {} }, { name: 'getShifts', args: { days: 1 } }, { name: 'getStock', args: { product: 'מלח' } }],
      (R) => 'יש ' + R.getStaffRequests.waiting + ' בקשות ממתינות, ' + R.getShifts.count + ' משמרות היום ו-' + R.getStock.belowMin + ' מוצר מתחת למינימום.');
    const r = await call('secChat', M1, { text: 'מה המצב בעסק היום?' });
    assert.equal(r.status, 'OK', r.text);
    const R = lastRes();
    // בקשות: 2 ממתינות (כולל הישנה), אחת טופלה; תגובה אחרונה ושלב
    assert.equal(R.getStaffRequests.waiting, 2); assert.equal(R.getStaffRequests.done, 1);
    const r1 = R.getStaffRequests.items.find((x) => x.text.includes('יום חופש'));
    assert.equal(r1.from, 'דוד כהן'); assert.equal(r1.kind, 'בקשה'); assert.equal(r1.stage, 'נקראה'); assert.equal(r1.lastComment.text, 'מחכה לתשובה');
    assert.ok(!JSON.stringify(R.getStaffRequests).includes(E1), 'בלי מזהי משתמש למודל');
    // ממתין לטיפול
    assert.equal(R.getPendingQueue.waiting, 1); assert.equal(R.getPendingQueue.items[0].kind, 'דוח Z'); assert.equal(R.getPendingQueue.items[0].pages, 2);
    // משמרות
    assert.equal(R.getShifts.count, 2); assert.equal(R.getShifts.noEmployee, 1);
    assert.deepEqual(R.getShifts.byDay[0].shifts.map((s) => s.employee), ['דוד כהן', 'בלי עובד']);
    assert.match(R.getShifts.unknown, /בפועל/);
    // מלאי
    assert.equal(R.getStock.products, 3); assert.equal(R.getStock.belowMin, 1); assert.equal(R.getStock.lowItems[0].product, 'קמח לבן');
    assert.equal(R.getStock.negative, 1); assert.equal(R.getStock.items[0].stock[0].qty, 50);
    assert.equal(R.getStock.movements.byKind['מכירה בקופה'].units, -4);
    // תשובה: המספרים מאומתים, ולכל כלי מקור
    assert.deepEqual(r.result.unverified, []);
    const ls = r.result.src.map((s) => s.l).join(' | ');
    assert.match(ls, /בקשות עובדים · נתוני הענן/); assert.match(ls, /סידור משמרות/); assert.match(ls, /מלאי מוצרים · נתוני המלאי/);
    const log = (await coll(`b/${A}/sec_log`)).filter((l) => l.act === 'tool');
    for (const n of ['getStaffRequests', 'getPendingQueue', 'getShifts', 'getStock']) assert.ok(log.some((l) => String(l.note).startsWith(n)), n);
  });
  it('תוספת כבויה – הכלי לא קורא נתונים ("לא זמין")', async () => {
    await seed({ feat: { tasks: false, secretary: true, orders: false } });
    GM.state.sec = model([{ name: 'getStaffRequests', args: {} }, { name: 'getShifts', args: {} }, { name: 'getStock', args: {} }, { name: 'getPendingQueue', args: {} }], () => 'בסדר');
    const r = await call('secChat', M1, { text: 'מה המצב?' });
    assert.equal(r.status, 'OK', r.text);
    const R = lastRes();
    for (const n of ['getStaffRequests', 'getShifts', 'getStock']) assert.equal(R[n].error, 'not-available', n);
    assert.equal(R.getPendingQueue.waiting, 1, 'ממתין לטיפול – לא תלוי בתוספת');
    assert.ok(!JSON.stringify(R.getStaffRequests).includes('יום חופש'));
  });
});

describe('גיטי – הצעת משימה / תזכורת: כרטיס, ביצוע רק באישור, בדיקה בשרת ויומן', () => {
  it('proposeTask לא כותב: כרטיס עם עובד מזוהה, עובד לא מזוהה, תזכורת; בלי תאריך לתזכורת – בלי כרטיס', async () => {
    await seed();
    GM.state.sec = model([
      { name: 'proposeTask', args: { kind: 'task', text: 'לנקות את המחסן', employees: ['דוד', 'משה'], date: BIZD, urgent: true } },
      { name: 'proposeTask', args: { kind: 'reminder', text: 'להתקשר לספק הקמח', date: BIZD, time: '09:00' } },
      { name: 'proposeTask', args: { kind: 'reminder', text: 'בלי תאריך' } },
    ], () => 'הכנתי כרטיסים לאישור.');
    const r = await call('secChat', M1, { text: 'תפתחי לדוד משימה לנקות את המחסן ותזכירי לי להתקשר לספק' });
    assert.equal(r.status, 'OK', r.text);
    const [t, m] = r.result.cards;
    assert.equal(r.result.cards.length, 2);
    assert.equal(t.k, 'tkp'); assert.equal(t.kind, 'task'); assert.match(t.id, /^tp[0-9a-f]{16}$/);
    assert.deepEqual(t.to, [{ uid: E1, name: 'דוד כהן' }]); assert.deepEqual(t.unk, ['משה']); assert.equal(t.pri, 'h'); assert.equal(t.d, BIZD);
    assert.equal(m.kind, 'rem'); assert.equal(m.tm, '09:00'); assert.equal(m.txt, 'להתקשר לספק הקמח');
    assert.equal(lastRes().proposeTask.error, 'no-date');
    // שום דבר לא נוצר
    assert.equal((await coll(`b/${A}/tasks`)).length, 0); assert.equal((await coll(`b/${A}/sec_cal`)).length, 0);
    const msg = await get(`b/${A}/sec_chat/${M1}/m/${r.result.id}`);
    assert.equal(msg.cards.length, 2);
  });
  it('אישור משימה: בלי משימה – נדחה; משימה שהמנהל כתב (לפי החוקים) – הכרטיס מסומן ונרשם ביומן; מנהל אחר לא יכול', async () => {
    await seed();
    GM.state.sec = model([{ name: 'proposeTask', args: { kind: 'task', text: 'לנקות את המחסן', employees: ['דוד כהן'] } }, { name: 'proposeTask', args: { kind: 'task', text: 'לספור מלאי', allEmployees: true } }], () => 'לאשר?');
    const r = await call('secChat', M1, { text: 'משימה לדוד' });
    const mid = r.result.id, [c1, c2] = r.result.cards;
    const mark = (u, o) => call('secPrefs', u, Object.assign({ op: 'tkCard', mid, cid: c1.id, st: 'ok', kind: 'task' }, o));
    assert.equal((await mark(M1)).reason, 'not-done', 'עוד לא נוצרה משימה');
    assert.equal((await mark(M1, { cid: 'tp123' })).reason, 'bad-input');
    assert.equal((await mark(E1)).status, 'PERMISSION_DENIED', 'עובד');
    // הכתיבה – כמו האפליקציה (cxCreate): עוברת את החוקים בשם המנהל; עובד לא יכול לכתוב משימה בשם המנהל
    await assertFails(db(E1).doc(`b/${A}/tasks/sec${c1.id}`).set(taskOf(M1)));
    await assertSucceeds(db(M1).doc(`b/${A}/tasks/sec${c1.id}`).set(taskOf(M1)));
    assert.equal((await mark(M2)).reason, 'not-found', 'מנהל אחר – אין לו את ההודעה');
    const ok = await mark(M1);
    assert.equal(ok.status, 'OK', ok.text); assert.equal(ok.result.ref, 'sec' + c1.id);
    assert.equal((await mark(M1)).result.already, true);
    const card = (await get(`b/${A}/sec_chat/${M1}/m/${mid}`)).cards.find((x) => x.id === c1.id);
    assert.equal(card.st, 'ok'); assert.equal(card.ref, 'sec' + c1.id);
    const lg = (await coll(`b/${A}/sec_log`)).filter((l) => l.act === 'tkpOk');
    assert.equal(lg.length, 1); assert.equal(lg[0].tgt, 'sec' + c1.id); assert.equal(lg[0].by, M1); assert.equal(lg[0].who, 'mgr'); assert.equal(lg[0].res, undefined, 'תיקון סבב 2: לא נספר כשליחה בסיכום');
    // משימה עם אותו מזהה שמנהל אחר פתח – לא נחשבת
    await prep((d) => d.doc(`b/${A}/tasks/sec${c2.id}`).set(taskOf(M2)));
    assert.equal((await call('secPrefs', M1, { op: 'tkCard', mid, cid: c2.id, st: 'ok', kind: 'task' })).reason, 'not-done');
    // ביטול
    const no = await call('secPrefs', M1, { op: 'tkCard', mid, cid: c2.id, st: 'no' });
    assert.equal(no.status, 'OK', no.text);
    assert.equal((await get(`b/${A}/sec_chat/${M1}/m/${mid}`)).cards.find((x) => x.id === c2.id).st, 'no');
    assert.equal((await coll(`b/${A}/sec_log`)).filter((l) => l.act === 'tkpNo').length, 1);
  });
  it('אישור תזכורת: דרך secCal (add, rem, cid) – מזהה קבוע sec<cid>; רק התזכורת של הכרטיס הזה, של המנהל עצמו; אישור חוזר לא יוצר שנייה', async () => {
    await seed();
    GM.state.sec = model([{ name: 'proposeTask', args: { kind: 'reminder', text: 'להתקשר לספק', date: BIZD } }], () => 'לקבוע?');
    const r = await call('secChat', M1, { text: 'תזכירי לי להתקשר לספק' });
    const mid = r.result.id, c = r.result.cards[0];
    const other = await call('secCal', M2, { op: 'add', title: 'של מנהל אחר', d: BIZD, rem: true });
    assert.equal(other.status, 'OK', other.text);
    // תזכורת אחרת (גם של המנהל עצמו) – לא מאשרת את הכרטיס (הערת אבטחה 1)
    const mine = await call('secCal', M1, { op: 'add', title: 'תזכורת אחרת', d: BIZD, rem: true });
    assert.equal((await call('secPrefs', M1, { op: 'tkCard', mid, cid: c.id, st: 'ok', kind: 'rem', ref: mine.result.id })).reason, 'not-done');
    assert.equal((await call('secCal', M1, { op: 'add', title: 'x', d: BIZD, rem: true, cid: 'bad' })).reason, 'bad-cid');
    assert.equal((await call('secCal', M1, { op: 'add', title: 'x', d: BIZD, cid: c.id })).reason, 'bad-cid', 'cid רק לתזכורת');
    const ev = await call('secCal', M1, { op: 'add', title: c.txt, d: c.d, rem: true, cid: c.id });
    assert.equal(ev.status, 'OK', ev.text); assert.equal(ev.result.id, 'sec' + c.id);
    // ליקוי 4: הסימון נכשל והאפליקציה נפתחה מחדש – "אישור" שוב מחזיר את אותה תזכורת
    const again = await call('secCal', M1, { op: 'add', title: c.txt, d: c.d, rem: true, cid: c.id });
    assert.equal(again.status, 'OK', again.text); assert.equal(again.result.id, 'sec' + c.id); assert.equal(again.result.already, true);
    assert.equal((await call('secCal', M2, { op: 'add', title: c.txt, d: c.d, rem: true, cid: c.id })).reason, 'exists');
    const ok = await call('secPrefs', M1, { op: 'tkCard', mid, cid: c.id, st: 'ok', kind: 'rem' });
    assert.equal(ok.status, 'OK', ok.text); assert.equal(ok.result.ref, 'sec' + c.id);
    const cal = await get(`b/${A}/sec_cal/sec${c.id}`);
    assert.equal(cal.rem, true); assert.equal(cal.uid, M1); assert.equal(cal.st, 'ok');
    const lg = await coll(`b/${A}/sec_log`);
    assert.equal(lg.filter((l) => l.act === 'calAdd' && l.tgt === 'sec' + c.id).length, 1, 'נוצרה פעם אחת');
    assert.ok(lg.some((l) => l.act === 'tkpOk' && l.tgt === 'sec' + c.id && l.note === 'rem'));
  });
  it('תזכורת – מסלול אחד (ליקוי 3): proposeCalendarEvent עם reminder לא יוצר כרטיס; כרטיס תזכורת זהה פעמיים באותה תשובה – כרטיס אחד', async () => {
    await seed();
    GM.state.sec = model([
      { name: 'proposeCalendarEvent', args: { title: 'להתקשר לספק', date: BIZD, time: '10:00', reminder: true } },
      { name: 'proposeTask', args: { kind: 'reminder', text: 'להתקשר לספק', date: BIZD, time: '10:00' } },
      { name: 'proposeTask', args: { kind: 'reminder', text: 'להתקשר לספק', date: BIZD, time: '10:00' } },
    ], () => 'לקבוע?');
    const r = await call('secChat', M1, { text: 'תזכירי לי מחר ב-10 להתקשר לספק' });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.cards.length, 1); assert.equal(r.result.cards[0].k, 'tkp'); assert.equal(r.result.cards[0].kind, 'rem');
    assert.equal(lastRes().proposeCalendarEvent.error, 'use-proposeTask');
    assert.equal((await coll(`b/${A}/sec_cal`)).length, 0, 'לא נוצרה הצעה ביומן');
  });
});
