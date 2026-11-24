'use strict';
// לקוחות הקפה מכספית (24.11.2026): hk-import.js (hkGet, hkApprove) + cxBot op:'hkSnap' (caspit-bot.js). מול האמולטור, חלק מ-test:multibiz:2.
// כל הנתונים מומצאים (ת.ז נבנות עם ספרת ביקורת בבדיקה).
//   - ממתין לפני אישור: תצוגה מקדימה, בלי שום שינוי ב-cust / ardoc; תמונה חדשה מחליפה ממתינה; קלט פגום נדחה.
//   - אישור: לקוחות פרטיים עם xc, ללקוח קיים רק xc, יתרות פתיחה ob, cust.ar = חישוב מחדש מהמסמכים, "לבדוק" לא נוגע בכלום, קבוצת arimp.
//   - לילה: הפרש חיובי → old, שלילי → "לבדוק", לקוח חדש, לקוח שנמחק, אותו יום פעמיים → בלי כפילות.
//   - ביטול קבוצה (arImpVoid הקיים). הרשאות: עובד / בלי כניסה / עסק אחר. החוקים: האוספים סגורים לאפליקציה.
//   - סבב 2: hkChkDone ("טופל", בלי מחיקה); delCust – מחיקת לקוח עם מסמכים מיובאים בלבד (void + גיבוי), סירוב כשיש מסמך אמיתי / הזמנה,
//     עובד נדחה, ואחרי המחיקה הריצה הלילית לא יוצרת את הלקוח שוב.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const H = require('./helpers');

const A = 'biz-hk', B = 'biz-hk2';
const MGR = 'hk_mgr', E1 = 'hk_e1', MB = 'hk_mb';
const FN = path.join(H.ROOT, 'functions');
let FX, BOT, adm, env, TOK, today, yday;
async function call(name, uid, data) {
  try { return { status: 'OK', result: await FX[name].run({ auth: uid ? { uid, token: { uid } } : null, data: data || {}, rawRequest: { headers: {} } }) }; } catch (e) {
    return { status: (e && e.code) || 'ERR', reason: e && e.details && e.details.reason, text: String(e && e.message).slice(0, 300) };
  }
}
const ok = async (name, uid, data) => { const r = await call(name, uid, data); assert.equal(r.status, 'OK', name + ': ' + r.text); return r.result; };
async function bot(body) {
  const raw = Buffer.from(JSON.stringify(body));
  const req = { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9', authorization: 'Bearer ' + TOK }, body, rawBody: raw };
  const res = { code: 0, body: null, h: {}, headersSent: false, status(c) { this.code = c; return this; }, set(k, v) { this.h[k] = v; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, send(b) { this.body = b; this.headersSent = true; return this; } };
  await BOT.handle(req, res, { send: async (t) => t.map((x) => ({ token: x, ok: true })) });
  return res;
}
const snap = async (day, rows) => { const r = await bot({ op: 'hkSnap', ver: '0.1.0', day, rows }); assert.equal(r.code, 200, JSON.stringify(r.body)); return r.body; };
const get = async (p) => { const s = await adm().doc(`b/${A}/${p}`).get(); return s.exists ? s.data() : null; };
const all = async (c) => (await adm().collection(`b/${A}/${c}`).get()).docs.map((s) => Object.assign({ id: s.id }, s.data()));
// ת.ז עם ספרת ביקורת
function tzMk(s8) { let s = 0; for (let i = 0; i < 8; i++) { let d = +s8[i] * ((i % 2) + 1); if (d > 9) d -= 9; s += d; } return s8 + ((10 - (s % 10)) % 10); }
const TZA = tzMk('31234567'), TZB = tzMk('20456789');
const cHash = (xc) => 'c' + crypto.createHash('sha1').update('hk:' + xc).digest('hex').slice(0, 20);

// יתרה מחושבת מחדש מכל המסמכים = cust.ar (כמו ar-import.test.js)
async function balanced(cid) {
  const docs = (await all('ardoc')).filter((x) => x.cust === cid);
  const al = (await all('aralloc')).filter((a) => !a.void);
  let bal = 0, open = 0, cr = 0;
  for (const x of docs) {
    const dr = x.t === 'inv' || (['ob', 'old'].includes(x.t) && x.k === 'dr');
    const crd = x.t === 'rc' || x.t === 'cr' || (['ob', 'old'].includes(x.t) && x.k === 'cr');
    if (x.void) { assert.equal(x.open, 0); continue; }
    if (dr) { bal += x.gross; open += x.open; assert.equal(x.gross - al.filter((a) => a.inv === x.id).reduce((s, a) => s + a.amt, 0), x.open); }
    if (crd) { bal -= x.gross; cr += x.open; assert.equal(x.gross - al.filter((a) => a.rc === x.id).reduce((s, a) => s + a.amt, 0), x.open); }
  }
  const c = await get('cust/' + cid);
  const a = (c && c.ar) || { bal: 0, open: 0, cr: 0 };
  assert.deepEqual({ bal: a.bal, open: a.open, cr: a.cr }, { bal, open, cr }, 'cust.ar = חישוב מחדש ' + cid);
  assert.equal(require('../functions/lib/ar-calc').ledger(docs).bal, a.bal, 'כרטסת ' + cid);
  return a.bal;
}
const EXTRA = Array.from({ length: 25 }, (_, i) => ({ xc: String(400 + i), tz: '', name: 'נוסף ' + i, ph: '', addr: '', bal: 100 }));
const ROWS = () => [
  { xc: '101', tz: '', name: 'שם מכספית', ph: '0521110001', addr: 'רחוב 1', bal: 10000 }, // מותאם לפי טלפון
  { xc: '102', tz: TZA, name: 'לפי תז', ph: '', addr: '', bal: -5000 }, // מותאם לפי ת.ז, יתרה שלילית
  { xc: '103', tz: '', name: 'טלפון כפול', ph: '0521110003', addr: '', bal: 111 }, // שני לקוחות עם אותו טלפון
  { xc: '104', tz: '', name: 'יש פתיחה', ph: '0521110004', addr: '', bal: 222 }, // כבר יש ob
  { xc: '105', tz: '', name: 'מספר אחר', ph: '0521110005', addr: '', bal: 333 }, // מקושר ל-xc אחר
  { xc: 201, tz: Number(TZB), name: 'חדש תז', ph: '', addr: 'עיר', bal: 12345 }, // חדש (xc ו-tz כמספרים, כמו מאקסל)
  { xc: '202', tz: '', name: 'חדש טלפון', ph: '052-111-0002', addr: '', bal: 0 },
  { xc: '203', tz: '', name: 'בלי פרטים', ph: '', addr: '', bal: 700 },
].concat(EXTRA);

before(async () => {
  env = await H.getEnv();
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
  FX = require('../functions/index.js');
  BOT = require('../functions/caspit-bot.js')._core;
  adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  today = BOT.ilDay(Date.now()); yday = BOT.addDays(today, -1);
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(), b = d.batch();
    for (const id of [A, B]) b.set(d.doc('b/' + id), { name: 'עסק ' + id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: { orders: true }, org: { v: 1, branches: [], banks: [], cards: [] } });
    for (const [bz, m] of [[A, MGR], [B, MB]]) {
      b.set(d.doc(`b/${bz}/admins/${m}`), { email: m + '@x.invalid' });
      b.set(d.doc(`b/${bz}/staff/${m}`), { name: m, role: 'manager', active: true });
      b.set(d.doc('users/' + m), { bizId: bz, role: 'admin', active: true, bizStatus: 'active', email: m + '@x.invalid', createdAt: 1 });
    }
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true });
    b.set(d.doc('users/' + E1), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: E1 + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/ordcfg/main`), { vat: 18 });
    b.set(d.doc(`b/${A}/arcfg/main`), { on: true, name: 'עסק' });
    const C = (id, o) => b.set(d.doc(`b/${A}/cust/${id}`), Object.assign({ at: 1, upd: 1, x: {} }, o));
    C('p0521110001', { name: 'ותיק', phone: '0521110001', addr: 'כתובת קיימת' });
    C('t' + TZA, { name: 'בעל תז', tz: TZA });
    C('p0521110003', { name: 'כפול א', phone: '0521110003' });
    C('cAAAAAAAAAAAAAAAAAAAA', { name: 'כפול ב', phone: '0529999999', phx: ['0529999999', '0521110003'] });
    C('p0521110004', { name: 'עם פתיחה', phone: '0521110004', ar: { bal: 1000, open: 1000, cr: 0, at: 1 } });
    C('p0521110005', { name: 'xc אחר', phone: '0521110005', xc: '999' });
    b.set(d.doc(`b/${A}/ardoc/x_ob_p0521110004`), { t: 'ob', k: 'dr', cust: 'p0521110004', gross: 1000, net: 1000, vat: 0, open: 1000, st: 'open', d: '2025-01-01', at: 1, imp: 'old1', lines: [], ser: 'X', no: '', ext: '' });
    await b.commit();
  });
  TOK = (await ok('cxBotTok', MGR, { op: 'new' })).token;
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('לקוחות הקפה מכספית', () => {
  it('הרשאות: בלי כניסה / עובד נדחים; מנהל של עסק אחר רואה רק את העסק שלו', async () => {
    for (const f of ['hkGet', 'hkApprove']) {
      assert.notEqual((await call(f, null, {})).status, 'OK', f);
      assert.equal((await call(f, E1, f === 'hkApprove' ? { sid: 'sabcdefgh1' } : {})).reason, 'manager-only', f);
    }
    assert.equal((await ok('hkGet', MGR, {})).st, 'none');
    assert.equal((await call('hkGet', MGR, { x: 1 })).reason, 'bad-field');
  });

  it('קלט פגום מהתוסף נדחה (שדה מיותר, יתרה לא שלמה, כפילות, יותר מ-2000, יום לא תקין)', async () => {
    const bad = async (body, reason) => { const r = await bot(Object.assign({ op: 'hkSnap', ver: '0.1.0' }, body)); assert.equal(r.code, 400, JSON.stringify(r.body)); assert.equal(r.body.reason, reason); };
    await bad({ day: yday, rows: ROWS(), extra: 1 }, 'bad-field');
    await bad({ day: yday, rows: [{ xc: '1', bal: 1, note: 'x' }] }, 'bad-field');
    await bad({ day: yday, rows: [{ xc: '1', bal: 10.5 }] }, 'bad-row');
    await bad({ day: yday, rows: [{ xc: '1', bal: 1 }, { xc: '1', bal: 2 }] }, 'dup-xc');
    await bad({ day: yday, rows: Array.from({ length: 2001 }, (_, i) => ({ xc: String(i), bal: 0 })) }, 'bad-rows');
    await bad({ day: BOT.addDays(today, 1), rows: [{ xc: '1', bal: 1 }] }, 'bad-day');
    assert.equal(await get('hkcfg/main'), null, 'כלום לא נשמר');
  });

  it('לפני אישור: נשמר כממתין עם תצוגה מקדימה; cust ו-ardoc לא משתנים; תמונה חדשה מחליפה', async () => {
    const before0 = JSON.stringify([await all('cust'), await all('ardoc')]);
    const r1 = await snap(yday, ROWS().map((r) => Object.assign({}, r, { bal: r.bal + 1 })));
    assert.equal(r1.st, 'pend');
    const r = await snap(yday, ROWS());
    assert.notEqual(r.sid, r1.sid);
    assert.equal(r.n, 33); assert.equal(r.new, 28); assert.equal(r.match, 2); assert.equal(r.chk, 3);
    assert.deepEqual(r.why, { 'many-ph': 1, 'has-ob': 1, 'xc-other': 1 });
    assert.equal(r.neg, 1); assert.equal(r.zero, 1);
    assert.equal(r.sum, ROWS().reduce((s, x) => s + x.bal, 0));
    assert.equal(JSON.stringify([await all('cust'), await all('ardoc')]), before0, 'לא נוגעים בלקוחות ובמסמכים');
    const parts = await all('hkpend');
    assert.ok(parts.length && parts.every((p) => p.sid === r.sid), 'החלקים של התמונה הקודמת נמחקו');
    assert.ok(!JSON.stringify(parts).includes('note'), 'רק השדות שבחוזה');
    const g = await ok('hkGet', MGR, {});
    assert.equal(g.st, 'pend'); assert.equal(g.pend.sid, r.sid); assert.equal(g.pend.pv.chkL.length, 3);
    assert.ok(g.pend.pv.chkL.every((x) => x.msg && /[א-ת]/.test(x.msg)));
  });

  it('אישור: לקוחות פרטיים עם xc, ללקוח קיים רק xc, יתרות פתיחה, cust.ar נכון, "לבדוק" בלי שינוי, קבוצת arimp', async () => {
    const g = await ok('hkGet', MGR, {});
    assert.equal((await call('hkApprove', MGR, { sid: 'swrongsid1' })).reason, 'hk-changed');
    const r = await ok('hkApprove', MGR, { sid: g.pend.sid });
    assert.equal(r.done, true); assert.equal(r.pos, 33);
    assert.deepEqual(r.c, { new: 28, match: 2, ob: 29, chk: 3, sum: 10000 - 5000 + 12345 + 700 + 2500 });
    // לקוח קיים לפי טלפון: רק xc נוסף, השם והכתובת לא נדרסו
    const c1 = await get('cust/p0521110001');
    assert.equal(c1.xc, '101'); assert.equal(c1.name, 'ותיק'); assert.equal(c1.addr, 'כתובת קיימת'); assert.notEqual(c1.wholesale, true);
    assert.equal(await balanced('p0521110001'), 10000);
    assert.equal((await get('cust/t' + TZA)).xc, '102');
    assert.equal(await balanced('t' + TZA), -5000);
    assert.equal((await get('ardoc/x_ob_t' + TZA)).k, 'cr');
    // חדשים
    const n1 = await get('cust/t' + TZB);
    assert.equal(n1.xc, '201'); assert.equal(n1.tz, TZB); assert.equal(n1.name, 'חדש תז'); assert.equal(n1.addr, 'עיר'); assert.equal(n1.wholesale, undefined); assert.equal(n1.src, 'import');
    assert.equal(await balanced('t' + TZB), 12345);
    const n2 = await get('cust/p0521110002');
    assert.equal(n2.xc, '202'); assert.equal(n2.phone, '0521110002'); assert.equal(n2.ar, undefined, 'יתרה 0 – בלי ob');
    assert.equal(await get('ardoc/x_ob_p0521110002'), null);
    assert.equal(await balanced(cHash('203')), 700);
    for (const e of EXTRA) assert.equal(await balanced(cHash(e.xc)), 100);
    // "לבדוק": כלום לא נוצר ולא השתנה
    assert.equal((await get('cust/p0521110003')).xc, undefined);
    assert.equal((await get('cust/p0521110004')).xc, undefined);
    assert.equal(await balanced('p0521110004'), 1000);
    assert.equal((await get('cust/p0521110005')).xc, '999');
    for (const x of ['103', '104', '105']) { assert.equal((await get('hkchk/a_' + x)).xc, x); assert.equal((await get('hkc/' + x)).st, 'chk'); }
    // קבוצה
    const bt = await get('arimp/' + r.batch);
    assert.equal(bt.kind, 'ob'); assert.equal(bt.n, 29); assert.equal(bt.sum, r.c.sum); assert.equal(bt.st, 'ok');
    assert.equal((await all('ardoc')).filter((x) => x.imp === r.batch).length, 29);
    const g2 = await ok('hkGet', MGR, {});
    assert.equal(g2.st, 'on'); assert.equal(g2.first.batch, r.batch); assert.equal(g2.pend, undefined);
    assert.equal((await all('hkpend')).length, 0);
    assert.equal((await call('hkApprove', MGR, { sid: g.pend.sid })).reason, 'hk-done');
  });

  it('לילה: הפרש חיובי → מסמך, שלילי → "לבדוק", לקוח חדש, לקוח שנמחק; אותו יום פעמיים – בלי כפילות', async () => {
    await adm().doc(`b/${A}/cust/p0521110002`).delete(); // "נמחק באפליקציה"
    const rows = ROWS().map((x) => Object.assign({}, x));
    rows[0].bal = 12000; rows[1].bal = -6000; rows[6].bal = 500;
    rows.push({ xc: '301', tz: '', name: 'חדש בלילה', ph: '0521110301', addr: '', bal: 4000 });
    const r = await snap(today, rows);
    assert.equal(r.st, 'night');
    assert.equal(r.add, 1); assert.equal(r.sum, 2000); assert.equal(r.neg, 1); assert.equal(r.nsum, -1000);
    assert.equal(r.new, 1); assert.equal(r.ob, 1); assert.equal(r.del, 1); assert.equal(r.chk, 3); assert.equal(r.same, 27);
    const od = await get(`ardoc/x_old_hk${today.replace(/-/g, '')}_101`);
    assert.equal(od.t, 'old'); assert.equal(od.k, 'dr'); assert.equal(od.gross, 2000); assert.equal(od.imp, r.batch); assert.match(od.note, /חיובי הקפה בכספית/);
    assert.equal(await balanced('p0521110001'), 12000);
    assert.equal(await balanced('t' + TZA), -5000, 'הפרש שלילי – בלי מסמך');
    const ng = await get(`hkchk/n_${today.replace(/-/g, '')}_102`);
    assert.equal(ng.diff, -1000); assert.equal(ng.why, 'neg');
    assert.equal(await get('cust/p0521110002'), null, 'לקוח שנמחק לא נוצר שוב');
    assert.equal((await get('hkc/202')).st, 'del');
    const nw = await get('cust/p0521110301');
    assert.equal(nw.xc, '301'); assert.equal(await balanced('p0521110301'), 4000);
    // אותו יום שוב – כלום חדש
    const n0 = (await all('ardoc')).length;
    const r2 = await snap(today, rows);
    assert.equal(r2.add, 0); assert.equal(r2.new, 0); assert.equal(r2.neg, 0); assert.equal(r2.ob, 0);
    assert.equal((await all('ardoc')).length, n0);
    assert.equal(await balanced('p0521110001'), 12000);
    // אותו יום, חיוב נוסף בכספית → מסמך שני על ההפרש בלבד
    rows[0].bal = 12300;
    const r3 = await snap(today, rows);
    assert.equal(r3.add, 1); assert.equal(r3.sum, 300);
    assert.equal((await get(`ardoc/x_old_hk${today.replace(/-/g, '')}_101_2`)).gross, 300);
    assert.equal(await balanced('p0521110001'), 12300);
    // יום ישן יותר – נדחה
    const old = await bot({ op: 'hkSnap', ver: '0.1.0', day: yday, rows });
    assert.equal(old.body.reason, 'old-day');
    const g = await ok('hkGet', MGR, {});
    assert.equal(g.night.day, today);
    assert.ok(g.chk.some((x) => x.why === 'neg' && x.xc === '102' && x.msg));
  });

  it('ביטול קבוצה (arImpVoid הקיים): הלילה ואז הייבוא הראשון – היתרות חוזרות', async () => {
    assert.equal((await ok('hkGet', MB, {})).st, 'none', 'עסק אחר – רק המצב שלו');
    const g = await ok('hkGet', MGR, {});
    const voidAll = async (batch) => { let left = 1, k = 0; while (left > 0 && k++ < 20) left = (await ok('arImpVoid', MGR, { batch, reason: 'בדיקה' })).left; };
    await voidAll(g.night.batch);
    assert.equal(await balanced('p0521110001'), 10000);
    assert.equal(await balanced('p0521110301'), 0);
    await voidAll(g.first.batch);
    assert.equal((await get('arimp/' + g.first.batch)).st, 'void');
    for (const id of ['p0521110001', 't' + TZA, 't' + TZB, cHash('203')]) assert.equal(await balanced(id), 0, id);
    assert.equal(await balanced('p0521110004'), 1000, 'יתרת פתיחה ישנה (לא מהייבוא) – לא נגעו');
  });

  it('סבב 2 – hkChkDone: "טופל" מסמן זמן ומי, לא מוחק, ונעלם מהרשימה; עובד נדחה', async () => {
    const id = `n_${today.replace(/-/g, '')}_102`;
    assert.equal((await call('hkChkDone', E1, { id })).reason, 'manager-only');
    assert.equal((await call('hkChkDone', MGR, { id: '../x' })).reason, 'bad-id');
    assert.equal((await call('hkChkDone', MGR, { id, x: 1 })).reason, 'bad-field');
    assert.equal((await call('hkChkDone', MGR, { id: 'a_777' })).status, 'not-found');
    assert.ok((await ok('hkGet', MGR, {})).chk.some((x) => x.id === id));
    const r = await ok('hkChkDone', MGR, { id });
    assert.equal(r.ok, true); assert.equal(r.dup, undefined);
    const d = await get('hkchk/' + id);
    assert.ok(d && d.doneAt > 0, 'לא נמחק – מסומן'); assert.equal(d.doneBy, MGR); assert.equal(d.diff, -1000);
    assert.ok(!(await ok('hkGet', MGR, {})).chk.some((x) => x.id === id), 'לא מוצג יותר');
    assert.equal((await ok('hkChkDone', MGR, { id })).dup, true);
    assert.equal((await call('hkChkDone', MB, { id })).status, 'not-found', 'עסק אחר – לא רואה');
  });

  it('סבב 2 – delCust: מסרב כשיש מסמך אמיתי / הזמנה; עובד נדחה; מוחק לקוח עם מסמכים מיובאים (void + גיבוי); הלילה לא מחזיר אותו', async () => {
    const cid = cHash('203'); // יובא בייבוא הראשון (ob) – אחרי ביטול הקבוצה בבדיקה הקודמת המסמך כבר מבוטל
    const cid2 = cHash('400'); // נוסף 0 – נשתמש בו עם מסמך מיובא חי
    // מסמכים מיובאים חיים ללקוח (ob חובה + old זכות, עם הקצאה ביניהם) – כמו אחרי ייבוא
    await adm().doc(`b/${A}/ardoc/x_ob_${cid2}_v2`).set({ t: 'ob', k: 'dr', cust: cid2, gross: 500, net: 500, vat: 0, open: 300, st: 'part', d: '2026-01-01', at: 1, imp: 'tst', lines: [], ser: 'X', no: '', ext: '' });
    await adm().doc(`b/${A}/ardoc/x_old_t_${cid2}`).set({ t: 'old', k: 'cr', cust: cid2, gross: 200, net: 200, vat: 0, open: 0, st: 'ok', d: '2026-01-02', at: 2, imp: 'tst', lines: [], ser: 'X', no: '', ext: '' });
    await adm().doc(`b/${A}/aralloc/al_t1`).set({ rc: `x_old_t_${cid2}`, inv: `x_ob_${cid2}_v2`, amt: 200, cust: cid2, at: 2 });
    await adm().doc(`b/${A}/cust/${cid2}/p/card`).set({ box: { v: 1 }, last4: '1234' });
    // סירובים
    assert.ok(['no-perm', 'manager-only'].includes((await call('delCust', E1, { custId: cid2, confirm: 'מחק' })).reason), 'עובד נדחה');
    assert.equal((await call('delCust', MGR, { custId: cid2 })).reason, 'bad-confirm');
    assert.equal((await call('delCust', MGR, { custId: cid2, confirm: 'כן' })).reason, 'bad-confirm');
    assert.equal((await call('delCust', MGR, { custId: '../x', confirm: 'מחק' })).reason, 'bad-id');
    assert.equal((await call('delCust', MGR, { custId: 'p0500000000', confirm: 'מחק' })).reason, 'no-cust');
    // מסמך אמיתי (חשבונית) – סירוב, גם כשהוא מבוטל
    await adm().doc(`b/${A}/ardoc/inv_t1`).set({ t: 'inv', cust: cid, gross: 100, open: 0, st: 'void', void: { at: 1 }, d: '2026-01-01', at: 1, lines: [] });
    const r1 = await call('delCust', MGR, { custId: cid, confirm: 'מחק' });
    assert.equal(r1.reason, 'has-docs'); assert.match(r1.text, /ללקוח יש מסמכים באפליקציה – אי אפשר למחוק/);
    assert.ok(await get('cust/' + cid), 'לא נמחק');
    // הזמנה – סירוב
    const cid3 = cHash('401');
    await adm().doc(`b/${A}/ord/o_t1`).set({ custId: cid3, no: 1, status: 'new', at: 1 });
    assert.equal((await call('delCust', MGR, { custId: cid3, confirm: 'מחק' })).reason, 'has-docs');
    assert.ok(await get('cust/' + cid3));
    // מחיקה
    const c0 = await get('cust/' + cid2);
    const r = await ok('delCust', MGR, { custId: cid2, confirm: 'מחק' });
    assert.equal(r.nv, 2, 'שני המסמכים החיים (ה-ob מהייבוא הראשון כבר בוטל בבדיקה הקודמת)');
    assert.equal(await get('cust/' + cid2), null, 'הלקוח נמחק');
    assert.equal(await get(`cust/${cid2}/p/card`), null, 'גם הכרטיס המוצפן (נשמר בגיבוי)');
    for (const id of [`x_ob_${cid2}_v2`, `x_old_t_${cid2}`]) { const d = await get('ardoc/' + id); assert.ok(d, 'לא נמחק'); assert.equal(d.st, 'void'); assert.equal(d.open, 0); assert.equal(d.void.by, MGR); }
    assert.equal((await get('aralloc/al_t1')).void, true, 'ההקצאה בוטלה');
    const bk = await get('custDelBak/' + r.bak);
    assert.equal(bk.cust, cid2); assert.equal(bk.st, 'done'); assert.equal(bk.n, 1); assert.equal(bk.by, MGR);
    const it0 = await get(`custDelBak/${r.bak}/items/${cid2}`);
    assert.deepEqual(it0.d, c0, 'גיבוי מלא של מסמך הלקוח'); assert.equal(it0.p.card.last4, '1234');
    assert.ok((await all('cardLog')).some((x) => x.act === 'delcust' && x.cust === cid2 && x.by === MGR), 'יומן');
    assert.equal((await all('custBak')).length, 0, 'לא נכנס לגיבוי של "שחזור לקוחות"');
    assert.equal((await call('delCust', MGR, { custId: cid2, confirm: 'מחק' })).reason, 'no-cust', 'פעם שנייה – כבר נמחק');
    // הלילה: הלקוח בכספית עם יתרה גבוהה יותר – לא נוצר שוב ולא מקבל מסמך
    const n0 = (await all('ardoc')).length;
    await adm().doc(`b/${A}/private/cxbot`).set({ hk: { d: today, n: 0 } }, { merge: true }); // מגבלת 12 תמונות ביום – הבדיקות הקודמות כבר השתמשו בחלק
    const rn = await snap(today, [{ xc: '400', tz: '', name: 'נוסף 0', ph: '', addr: '', bal: 900 }]);
    assert.equal(rn.st, 'night'); assert.equal(rn.del, 1); assert.equal(rn.add, 0); assert.equal(rn.new, 0);
    assert.equal(await get('cust/' + cid2), null, 'לא נוצר שוב');
    assert.equal((await get('hkc/400')).st, 'del');
    assert.equal((await all('ardoc')).length, n0, 'בלי מסמך חדש');
    // ושוב – נשאר נמחק
    const rn2 = await snap(today, [{ xc: '400', tz: '', name: 'נוסף 0', ph: '', addr: '', bal: 1000 }]);
    assert.equal(rn2.del, 1); assert.equal(await get('cust/' + cid2), null);
  });

  it('מגבלת תמונות ביום לעסק', async () => {
    await adm().doc(`b/${A}/private/cxbot`).set({ hk: { d: today, n: 12 } }, { merge: true });
    const r = await bot({ op: 'hkSnap', ver: '0.1.0', day: today, rows: [{ xc: '1', bal: 0 }] });
    assert.equal(r.code, 429); assert.equal(r.body.reason, 'rate');
  });

  it('החוקים: האוספים החדשים סגורים לאפליקציה (גם למנהל)', async () => {
    const { assertFails } = require('@firebase/rules-unit-testing');
    for (const u of [MGR, E1]) {
      const c = env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
      for (const p of ['hkcfg/main', 'hkpend/x_0', 'hkc/101', 'hkchk/a_103', 'custDelBak/x', 'custDelBak/x/items/y']) {
        await assertFails(c.doc(`b/${A}/${p}`).get()); await assertFails(c.doc(`b/${A}/${p}`).set({ x: 1 }));
      }
      await assertFails(c.collection(`b/${A}/hkchk`).get());
    }
  });
});
