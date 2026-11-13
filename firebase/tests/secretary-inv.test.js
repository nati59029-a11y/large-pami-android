'use strict';
// המזכירה העסקית – שלב 7 (2026-11-12): קליטת חשבוניות. מול אמולטור Firestore, חלק מ-test:multibiz.
// הזיהוי עצמו – מודל מדומה (פונקציה בתוך הבדיקה, או gemini-mock בבדיקת הקצה לקצה באמולטור). ווצאפ ו-Gmail – קבצים מדומים (בלי Meta ובלי Google).
// הפונקציות רצות בתוך תהליך הבדיקה (אותה עטיפה כמו onCall), כדי שאפשר להריץ גם בלי אמולטור הפונקציות. בלוק "קריאה ישירה מבחוץ" פונה גם
// לאמולטור הפונקציות (רק כשהוא רץ – ב-CI), כדי לבדוק שהשרת עצמו דוחה הכנסה אוטומטית של זיכוי/צ'ק/סכום שלילי/מעל התקרה.
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.SEC_INV_TEST_NOQUEUE = '1';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-ia', B = 'biz-ib';
const M1 = 'i_m1', M2 = 'i_m2', M3 = 'i_m3', E1 = 'i_e1', MB = 'i_mb', SUPER = 'i_super';
const SUP_WA = '972521234567', SUP_MAIL = 'billing@supplier.example';
const HP1 = '512345678', HP2 = '511111111';

let env, T, C, INV, SI, WA, G, RM;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
async function put(p, data, merge) { await prep((d) => d.doc(p).set(data, merge ? { merge: true } : {})); }
const req = (uid, data) => ({ auth: uid ? { uid, token: { email: uid + '@x.invalid' } } : undefined, data: data || {} });
async function call(fn, uid, data) {
  try { return { ok: true, r: await C.wrap(fn, INV[fn])(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, why: e.details && e.details.why, msg: e.message }; }
}
const dayIL = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
async function inBiz(biz, fn) { const b = await T.loadBiz(biz); return T.runInBiz({ bizId: biz, prefix: T.bizPrefix(b), biz: b }, () => fn(T.tdb())); }

// ---------- קבצים לדוגמה ----------
let SEQ = 0;
function pdf(pages, extra) {
  const n = pages || 1;
  let s = '%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Count ' + n + '>>endobj\n';
  for (let i = 0; i < n; i++) s += (3 + i) + ' 0 obj<</Type /Page /Parent 2 0 R>>endobj\n';
  return Buffer.from(s + (extra || '') + '%uniq ' + (++SEQ) + '\ntrailer<<>>\n%%EOF', 'latin1');
}
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF fake image ' + (++SEQ)), Buffer.alloc(200, 1)]);
// תשובות "מודל" (הסריקה האחידה – classify) לפי סוג
const RAW = {
  inv: (f) => ({ type: 'invoice', type_confidence: 0.97, fields: Object.assign({ supplier: 'ספק דמה בע"מ', supplier_id: HP1, number: 'INV-100', date: '2026-11-01', total_before_vat: 100, vat_amount: 18, total_with_vat: 118 }, f || {}), confidence: { supplier: 0.95, number: 0.95, date: 0.95, total_with_vat: 0.97 } }),
  cr: (f) => ({ type: 'credit_note', type_confidence: 0.95, fields: Object.assign({ supplier: 'ספק דמה בע"מ', supplier_id: HP1, number: 'CR-1', date: '2026-11-02', total_with_vat: 59 }, f || {}), confidence: {} }),
  rcpt: (f) => ({ type: 'receipt', type_confidence: 0.95, fields: Object.assign({ supplier: 'ספק דמה בע"מ', supplier_id: HP1, number: 'R-9', date: '2026-11-03', total_with_vat: 118, related_invoice: 'INV-100' }, f || {}), confidence: {} }),
  dn: (f) => ({ type: 'delivery_note', type_confidence: 0.95, fields: Object.assign({ supplier: 'ספק דמה בע"מ', supplier_id: HP1, number: 'DN-7', date: '2026-11-01', total_with_vat: 118 }, f || {}), confidence: {} }),
  chk: () => ({ type: 'check', type_confidence: 0.95, fields: { number: '000123', bank: 'לאומי', branch: '800', account: '1234567', date: '2026-12-15', amount: 2360, payee: 'ספק דמה בע"מ' }, confidence: {} }),
  unk: () => ({ type: 'unknown', type_confidence: 0.3, fields: {}, confidence: {} }),
};
let CLS = 0;
// קובץ שהגיע (ווצאפ / מייל) + זיהוי במודל מדומה. מחזיר את הרשומה בתור
async function arrive(buf, raw, o) {
  const opt = o || {};
  const biz = opt.biz || A;
  return inBiz(biz, async (db) => {
    const r = await INV.ingest(db, { ch: opt.ch || 'wa', from: opt.from || SUP_WA, name: 'ספק', inId: opt.inId || 'in' + (++SEQ), fn: opt.fn || 'inv.pdf', buf, why: opt.why, hist: opt.hist });
    if (!r.bad && !r.long && !r.dup) await INV.workIn(r.id, { classify: async () => { CLS++; if (raw instanceof Error) throw raw; return raw; } });
    return Object.assign({ id: r.id, r }, await (await db.doc('sec_inv/' + r.id).get()).data());
  });
}

async function seed(o) {
  const opt = o || {};
  await env.clearFirestore();
  CLS = 0;
  const ver = C.CONSENT_VER;
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    for (const biz of [A, B]) b.set(d.doc('b/' + biz), { name: biz, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true, scan: true, secretary: true } });
    b.set(d.doc(`b/${A}/admins/${M1}`), { email: 'm1@x.invalid' });
    b.set(d.doc(`b/${A}/admins/${M2}`), { email: 'm2@x.invalid' });
    b.set(d.doc(`b/${A}/admins/${M3}`), { email: 'm3@x.invalid', br: ['br1'] }); // מנהל עם הגבלת סניפים
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: 'עובד', role: 'employee', active: true });
    b.set(d.doc(`b/${B}/admins/${MB}`), { email: 'mb@x.invalid' });
    for (const [u, biz, role] of [[M1, A, 'admin'], [M2, A, 'admin'], [M3, A, 'admin'], [E1, A, 'worker'], [MB, B, 'admin']]) b.set(d.doc('users/' + u), { bizId: biz, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    const mgr = {}; for (const u of [M1, M2, M3]) mgr[u] = { cv: ver, ca: 1, nm: 'רותי', ad: 'f' };
    b.set(d.doc(`b/${A}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: false, pay: {}, mgr });
    b.set(d.doc(`b/${B}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: false, pay: {}, mgr: { [MB]: { cv: ver, ca: 1 } } });
    b.set(d.doc(`b/${A}/sec_cfg/inv`), Object.assign({ cap: 2000, nb: 2, sups: [{ id: 's1', name: 'ספק דמה בע"מ', hp: HP1, br: ['br1'] }, { id: 's2', name: 'מאפיית כהן', hp: HP2, br: ['br1', 'br2'] }], links: { ['wa:' + SUP_WA]: 's1' } }, opt.inv || {}));
    b.set(d.doc(`b/${A}/sec_cfg/wa`), { pnid: '1110001', num: '97230000000', stop: { on: false } });
    b.set(d.doc(`b/${A}/inbox/keep1`), { owner: E1, status: 'new', data: '{}' }); // נתון אחר של העסק – לא נוגעים בו
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  T = require('../functions/lib/tenant.js');
  C = require('../functions/secretary.js')._core;
  INV = require('../functions/secretary-inv.js')._core;
  SI = require('../functions/lib/sec-inv.js');
  WA = require('../functions/secretary-wa.js')._core;
  G = require('../functions/secretary-google.js')._core;
  RM = require('../functions/secretary-remind.js')._core;
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

// ---------------------------------------------------------------------------------
describe('קובץ: בדיקה לפני כל עלות (4.2, 10.3)', () => {
  beforeEach(() => seed());
  it('inspect: zip / Office / קובץ הפעלה / PDF מוצפן / PDF עם JavaScript / סוג אחר / ריק / גדול – נדחים; PDF ותמונה – עוברים; מעל 4 עמודים – "קובץ ארוך"', () => {
    assert.equal(SI.inspect(Buffer.from('PK\x03\x04zipdata', 'latin1')).why, 'zip');
    assert.equal(SI.inspect(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2])).why, 'office');
    assert.equal(SI.inspect(Buffer.from('MZ\x90\x00exe', 'latin1')).why, 'exe');
    assert.equal(SI.inspect(pdf(1, '<</Encrypt 5 0 R>>')).why, 'enc');
    assert.equal(SI.inspect(pdf(1, '<</S /JavaScript /JS (app.alert(1))>>')).why, 'active');
    assert.equal(SI.inspect(Buffer.from('<html>hi</html>')).why, 'type');
    assert.equal(SI.inspect(Buffer.alloc(0)).why, 'empty');
    assert.equal(SI.inspect(Buffer.concat([pdf(1), Buffer.alloc(SI.MAX_FILE)])).why, 'big');
    assert.deepEqual(SI.inspect(pdf(4)), { ok: true, mime: 'application/pdf', pages: 4 });
    assert.equal(SI.inspect(pdf(5)).long, true);
    assert.equal(SI.inspect(jpg()).mime, 'image/jpeg');
    assert.equal(SI.badByName('a.zip', 'application/zip'), 'zip');
    assert.equal(SI.badByName('x.exe', 'application/octet-stream'), 'exe');
    assert.equal(SI.badByName('m.docm', ''), 'zip');
    assert.equal(SI.badByName('old.xls', ''), 'office');
    assert.equal(SI.badByName('inv.pdf', 'application/pdf'), '');
    assert.equal(SI.badByName('cal.ics', 'text/calendar'), 'type');
  });
  it('קובץ חשוד שהגיע – כרטיס "התקבל קובץ שלא נקלט" עם השולח; הקובץ לא נשמר, לא נשלח לזיהוי ולא נספר במכסה', async () => {
    const x = await arrive(Buffer.from('PK\x03\x04zipdata-evil', 'latin1'), RAW.inv(), { fn: 'invoice.zip' });
    assert.equal(x.k, 'bad'); assert.deepEqual(x.why, ['zip']); assert.equal(x.np, 0); assert.equal(x.el, false);
    assert.equal(x.src[0].from, SUP_WA);
    assert.equal((await coll(`b/${A}/sec_inv/${x.id}/p`)).length, 0, 'הקובץ לא נשמר');
    assert.equal(CLS, 0, 'לא נשלח לזיהוי');
    assert.equal(await get(`b/${A}/scan_usage/_sec`), null, 'לא נספר במכסה');
    const r = await call('secDecide', M1, { op: 'claim', id: x.id, dev: 'devA0001' });
    assert.equal(r.reason, 'not-ready', 'אין מה להכניס');
    assert.ok((await call('secDecide', M1, { op: 'rej', id: x.id })).ok, 'אפשר לסגור את הכרטיס');
  });
});

describe('זיהוי דרך המכסה הקיימת – לפי קבצים (109)', () => {
  beforeEach(() => seed());
  it('PDF של 4 עמודים = 1 במונה העסק ובמונה המזכירה; PDF של 5 עמודים – "קובץ ארוך", בלי זיהוי ובלי ספירה; מכסת העסק נגמרה – "לא זוהה" בלי פנייה למודל', async () => {
    await put(`b/${A}/private/info`, { adv: { limits: { scanDaily: 2 } } });
    const a = await arrive(pdf(4), RAW.inv({ number: 'P4' }));
    assert.equal(a.k, 'inv'); assert.equal(CLS, 1);
    assert.equal((await get(`b/${A}/scan_usage/_biz`)).count, 1, 'קובץ = 1');
    assert.equal((await get(`b/${A}/scan_usage/_sec`)).count, 1);
    const l = await arrive(pdf(5), RAW.inv());
    assert.equal(l.k, 'long'); assert.equal(l.st, 'new'); assert.equal(CLS, 1, 'קובץ ארוך – לא נשלח לזיהוי');
    assert.ok(l.np >= 1, 'הקובץ נשמר לבדיקה ידנית');
    await arrive(jpg(), RAW.inv({ number: 'J1' }));
    assert.equal((await get(`b/${A}/scan_usage/_biz`)).count, 2);
    const q = await arrive(jpg(), RAW.inv({ number: 'J2' }));
    assert.equal(q.k, 'unk'); assert.equal(q.err, 'quota'); assert.equal(CLS, 2, 'מכסה נגמרה – בלי מודל');
  });
  it('זיהוי שנכשל – לא נספר (כמו בסריקה האחידה), והמסמך נשאר ככרטיס "לא זוהה"', async () => {
    const x = await arrive(pdf(1), new Error('model down'));
    assert.equal(x.k, 'unk'); assert.equal(x.err, 'ai');
    assert.equal((await get(`b/${A}/scan_usage/_sec`)).count, 0, 'הוחזר למונה');
  });
});

describe('כפילויות: אותה חשבונית ממייל, מווצאפ ומסריקה (4.5, 10.4, 39)', () => {
  beforeEach(() => seed());
  it('אותו קובץ בווצאפ (הורדה מ-Meta מדומה) וב-Gmail (קובץ מצורף, גם במייל גדול) – רשומה אחת עם שני מקורות, זיהוי אחד', async () => {
    const buf = pdf(1);
    // ווצאפ: ההודעה נשמרה ב-sec_in, העיבוד מוריד את הקובץ ומעביר לתור
    await put(`b/${A}/sec_in/mW1`, { wamid: 'wamid.W1', ch: 'wa', from: SUP_WA, pnid: '1110001', name: 'ספק', t: Date.now(), rt: Date.now(), type: 'other', sub: 'document', media: { id: 'med1', mime: 'application/pdf', fn: 'inv.pdf' }, own: 'sec', st: 'new', flags: [], tf: Date.now(), text: '' });
    const wr = await inBiz(A, () => WA.workIn('mW1', { token: 'x', media: async (tok, id, max) => { assert.equal(id, 'med1'); assert.equal(max, SI.MAX_FILE); return { buf, mime: 'application/pdf' }; } }));
    assert.equal(wr.file, true); assert.ok(wr.inv);
    const inW = await get(`b/${A}/sec_in/mW1`);
    assert.equal(inW.st, 'done'); assert.equal(inW.inv, wr.inv);
    await inBiz(A, () => INV.workIn(wr.inv, { classify: async () => { CLS++; return RAW.inv(); } }));
    // Gmail: מייל גדול (רק המבנה מורד, בלי הגוף) עם אותו PDF מצורף
    const b64u = (x) => x.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const msg = { id: 'gm1', threadId: 'tg1', labelIds: ['INBOX'], internalDate: String(Date.now()), sizeEstimate: 900000, snippet: 'מצורפת חשבונית',
      payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'Billing <' + SUP_MAIL + '>' }, { name: 'Subject', value: 'חשבונית' }, { name: 'Content-Type', value: 'multipart/mixed; boundary=x' }],
        parts: [{ mimeType: 'text/plain', body: { data: b64u(Buffer.from('מצורפת')) } }, { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'att1', size: buf.length } }] } };
    const reqs = [];
    const c = {
      meta: async () => Object.assign({}, msg, { payload: { mimeType: msg.payload.mimeType, headers: msg.payload.headers } }),
      full: async () => { reqs.push('full'); return msg; },
      struct: async () => { reqs.push('struct'); return { id: msg.id, payload: { mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain', body: { size: 10 } }, { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'att1', size: buf.length } }] } }; },
      att: async (gid, aid) => { reqs.push('att:' + aid); return { size: buf.length, data: b64u(buf) }; },
    };
    const st = await inBiz(A, (db) => G.saveMail(db, c, { boxId: 'gmbox1', addr: 'office@a.example', mgrMails: new Set() }, 'gm1', Date.now(), {}));
    assert.equal(st, 'saved');
    assert.deepEqual(reqs, ['struct', 'att:att1'], 'מייל גדול: בלי הגוף, רק מבנה + הקובץ');
    const L = await coll(`b/${A}/sec_inv`);
    assert.equal(L.length, 1, 'רשומה אחת');
    assert.deepEqual(L[0].src.map((s) => s.ch), ['wa', 'mail']);
    assert.equal(CLS, 1, 'זיהוי אחד בלבד');
    const inM = (await coll(`b/${A}/sec_in`)).find((x) => x.ch === 'mail');
    assert.deepEqual(inM.inv, [L[0].id]); assert.deepEqual(inM.files, ['invoice.pdf']);
  });
  it('אותה חשבונית בקובץ אחר (צילום בווצאפ ו-PDF במייל): השנייה ממתינה עם חשד לכפילות והתראה; ואותו ספק + תאריך + סכום – גם', async () => {
    const a = await arrive(jpg(), RAW.inv());
    assert.equal(a.el, true);
    const b = await arrive(pdf(1), RAW.inv({ number: 'inv 100' }), { ch: 'mail', from: SUP_MAIL });
    assert.equal(b.dup, a.id); assert.equal(b.el, false); assert.ok(b.why.includes('dup'));
    const notes = await coll(`b/${A}/sec_note/${M1}/n`);
    assert.ok(notes.some((n) => /כפולה/.test(n.title)), 'התראה (39)');
    const c2 = await arrive(pdf(1), RAW.inv({ number: 'OTHER-5' }));
    assert.ok([a.id, b.id].includes(c2.dup), 'אותו סכום ואותו תאריך אצל אותו ספק');
    const d = await arrive(pdf(1), RAW.inv({ number: 'NEW-6', total_with_vat: 300 }));
    assert.equal(d.dup, '');
  });
  it('חשבונית שנדחתה לא נחשבת "כפולה"; המכשיר שמצא כפילות אצלו (סריקה ידנית) מעכב – ממתינה + התראה, ולא נכנסת אוטומטית', async () => {
    const a = await arrive(jpg(), RAW.inv());
    await call('secDecide', M1, { op: 'rej', id: a.id });
    const b = await arrive(pdf(1), RAW.inv());
    assert.equal(b.dup, ''); assert.equal(b.el, true);
    const h = await call('secDecide', M1, { op: 'hold', id: b.id, why: 'dup' });
    assert.ok(h.ok);
    const x = await get(`b/${A}/sec_inv/${b.id}`);
    assert.equal(x.el, false); assert.equal(x.hold, 'dup');
    assert.ok((await coll(`b/${A}/sec_note/${M2}/n`)).some((n) => /כפולה/.test(n.title)));
    assert.equal((await call('secDecide', M1, { op: 'claim', id: b.id, mode: 'auto', dev: 'devA0001' })).reason, 'not-eligible');
  });
});

describe('"נכנס ישר" (34–36), סניף (40), סוגי מסמכים (37, 38, 111)', () => {
  beforeEach(() => seed());
  it('חשבונית רגילה מספק מוכר (ח.פ) של סניף אחד, משולח מקושר – זכאית, לסניף שלו', async () => {
    const x = await arrive(pdf(1), RAW.inv());
    assert.equal(x.k, 'inv'); assert.equal(x.sub, 's1'); assert.equal(x.match, 'hp'); assert.equal(x.br, 'br1'); assert.equal(x.ns, '');
    assert.deepEqual(x.why, []); assert.equal(x.el, true);
  });
  it('ספק של כמה סניפים / ספק חדש – ממתין לבחירה (סניף ריק); ספק לפי שם בלבד – "נראה כמו" ולא זכאי', async () => {
    const m = await arrive(pdf(1), RAW.inv({ supplier: 'מאפיית כהן', supplier_id: HP2 }));
    assert.equal(m.sub, 's2'); assert.equal(m.br, ''); assert.equal(m.brOk, false); assert.ok(m.why.includes('br'));
    const n = await arrive(pdf(1), RAW.inv({ supplier: 'ספק חדש לגמרי', supplier_id: '599999999' }), { from: '972500000000' });
    assert.equal(n.sub, ''); assert.ok(n.why.includes('sup')); assert.ok(n.why.includes('br'));
    const nm = await arrive(pdf(1), RAW.inv({ supplier: 'מאפיית כהן', supplier_id: '' }), { from: '972500000001' });
    assert.equal(nm.match, 'name'); assert.ok(nm.why.includes('sup'));
  });
  it('עסק עם סניף אחד – אין שאלת סניף', async () => {
    await put(`b/${A}/sec_cfg/inv`, { nb: 1, br1: 'main1' }, true);
    const m = await arrive(pdf(1), RAW.inv({ supplier: 'מאפיית כהן', supplier_id: HP2 }));
    assert.equal(m.br, 'main1'); assert.equal(m.el, true);
  });
  it('שולח חדש (36): זיהוי מלא מספק מוכר – זכאית, עם סימון "שולח חדש"; אחרי "נכנס ישר" – התראה + יומן; אישור השולח מקשר ומוריד את הסימון', async () => {
    const x = await arrive(pdf(1), RAW.inv(), { ch: 'mail', from: SUP_MAIL });
    assert.equal(x.ns, 'm:' + SUP_MAIL); assert.equal(x.el, true);
    assert.ok((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devA0001' })).ok);
    const d = await call('secDecide', M1, { op: 'done', id: x.id, dev: 'devA0001' });
    assert.ok(d.ok); assert.equal(d.r.auto, true);
    const lg = await coll(`b/${A}/sec_log`);
    assert.ok(lg.some((l) => l.act === 'invAuto' && l.tgt === x.id), 'נרשם ביומן (10.7)');
    const nt = await coll(`b/${A}/sec_note/${M2}/n`);
    assert.ok(nt.some((n) => /שולח חדש/.test(n.title) && n.body.includes(SUP_MAIL)), 'התראה גם כשנכנסה');
    const s = await call('secDecide', M1, { op: 'sender', id: x.id });
    assert.ok(s.ok); assert.equal(s.r.sender, SUP_MAIL);
    assert.equal((await get(`b/${A}/sec_cfg/inv`)).links['m:' + SUP_MAIL], 's1');
    assert.equal((await get(`b/${A}/sec_inv/${x.id}`)).ns, '');
    const y = await arrive(pdf(1), RAW.inv({ number: 'INV-200', total_with_vat: 50 }), { ch: 'mail', from: SUP_MAIL });
    assert.equal(y.ns, '', 'השולח מקושר עכשיו');
  });
  it('זיכוי, קבלה, תעודת משלוח, צ\'ק, לא זוהה, סכום שלילי, סכום בגובה התקרה ומעליה, שדה לא בטוח – תמיד ממתינים', async () => {
    const cr = await arrive(pdf(1), RAW.cr());
    assert.equal(cr.k, 'cr'); assert.ok(cr.f.total < 0); assert.ok(cr.why.includes('type') && cr.why.includes('neg'));
    const rc = await arrive(pdf(1), RAW.rcpt());
    assert.equal(rc.k, 'rcpt'); assert.equal(rc.f.rel, 'INV-100'); assert.equal(rc.el, false);
    const dn = await arrive(pdf(1), RAW.dn());
    assert.equal(dn.k, 'dn'); assert.equal(dn.el, false);
    const ck = await arrive(pdf(1), RAW.chk());
    assert.equal(ck.k, 'chk'); assert.equal(ck.f.amt, 2360); assert.equal(ck.f.no, '000123'); assert.equal(ck.el, false);
    const uk = await arrive(pdf(1), RAW.unk());
    assert.equal(uk.k, 'unk'); assert.equal(uk.el, false);
    const ng = await arrive(pdf(1), RAW.inv({ number: 'N1', total_with_vat: -500 }));
    assert.equal(ng.k, 'inv'); assert.ok(ng.why.includes('neg'));
    const eq = await arrive(pdf(1), RAW.inv({ number: 'E1', total_with_vat: 2000 }));
    assert.ok(eq.why.includes('cap'), 'בגובה התקרה – ממתין (הנחה שמרנית)');
    const hi = await arrive(pdf(1), RAW.inv({ number: 'H1', total_with_vat: 2500 }));
    assert.ok(hi.why.includes('cap'));
    const un = await arrive(pdf(1), Object.assign(RAW.inv({ number: 'U1', total_with_vat: 40 }), { confidence: { total_with_vat: 0.4 } }));
    assert.ok(un.why.includes('fields'), 'סכום לא בטוח');
  });
  it('"עצור הכל" – החשבונית לא זכאית, ותפיסה אוטומטית של חשבונית שכבר סומנה זכאית נדחית', async () => {
    const x = await arrive(pdf(1), RAW.inv());
    assert.equal(x.el, true);
    await put(`b/${A}/sec_cfg/wa`, { stop: { on: true, auto: false, why: 'mgr', at: 1, by: M1 } }, true);
    const r = await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devA0001' });
    assert.equal(r.reason, 'not-eligible'); assert.ok(r.why.includes('stop'));
    assert.equal((await get(`b/${A}/sec_inv/${x.id}`)).el, false);
    const y = await arrive(pdf(1), RAW.inv({ number: 'S2', total_with_vat: 70 }));
    assert.ok(y.why.includes('stop'));
    assert.ok((await call('secDecide', M1, { op: 'claim', id: y.id, mode: 'man', dev: 'devA0001' })).ok, 'אישור ידני עדיין עובד');
  });
  it('כיבוי "נכנס ישר" לעסק או לספק, ושינוי התקרה – נבדקים שוב ברגע התפיסה', async () => {
    const x = await arrive(pdf(1), RAW.inv({ total_with_vat: 900 }));
    assert.equal(x.el, true);
    assert.ok((await call('secInv', M1, { op: 'cfg', cap: 500 })).ok);
    assert.deepEqual((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devA0001' })).why, ['cap']);
    const y = await arrive(pdf(1), RAW.inv({ number: 'O2', total_with_vat: 100 }));
    assert.ok((await call('secInv', M1, { op: 'cfg', sub: 's1', off: true })).ok);
    assert.ok((await call('secDecide', M1, { op: 'claim', id: y.id, mode: 'auto', dev: 'devA0001' })).why.includes('off'));
    assert.ok((await call('secInv', M1, { op: 'cfg', sub: 's1', off: false, auto: false })).ok);
    assert.ok((await call('secDecide', M1, { op: 'claim', id: y.id, mode: 'auto', dev: 'devA0001' })).why.includes('off'));
    const lg = await coll(`b/${A}/sec_log`);
    assert.ok(lg.some((l) => l.act === 'invCfg'));
  });
});

describe('תפיסה חד־פעמית בשרת (4.7, 110) וסגירה באמצע', () => {
  beforeEach(() => seed());
  it('שני מכשירים (של שני מנהלים) פותחים באותו רגע – רק אחד תופס; השני מקבל "כבר הוכנסה במכשיר אחר"', async () => {
    for (let i = 0; i < 3; i++) {
      const x = await arrive(pdf(1), RAW.inv({ number: 'T' + i, total_with_vat: 10 + i }));
      assert.equal(x.el, true);
      const rs = await Promise.all([
        call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devPhone01' }),
        call('secDecide', M2, { op: 'claim', id: x.id, mode: 'auto', dev: 'devDesk002' }),
        call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devTablet3' }),
      ]);
      assert.equal(rs.filter((r) => r.ok).length, 1, 'בדיוק אחד');
      assert.ok(rs.filter((r) => !r.ok).every((r) => r.reason === 'already'), JSON.stringify(rs));
      const w = rs.findIndex((r) => r.ok);
      const [uid, dev] = [[M1, 'devPhone01'], [M2, 'devDesk002'], [M1, 'devTablet3']][w];
      assert.ok((await call('secDecide', uid, { op: 'done', id: x.id, dev })).ok);
      assert.equal((await call('secDecide', M2, { op: 'claim', id: x.id, mode: 'auto', dev: 'devLate004' })).reason, 'already', 'מכשיר שנפתח אחר כך');
    }
  });
  it('האפליקציה נסגרה אחרי התפיסה: אותו מכשיר ממשיך (תפיסה חוזרת מצליחה), "סיום" פעמיים לא מכפיל; מכשיר אחר לא יכול לסיים; אחרי 24 שעות – משתחררת עם התראה', async () => {
    const x = await arrive(pdf(1), RAW.inv());
    assert.ok((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'man', dev: 'devPhone01' })).ok);
    const again = await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'man', dev: 'devPhone01' });
    assert.ok(again.ok, 'אותו מכשיר – ממשיך');
    const lst = await call('secInv', M1, { op: 'list' });
    const it1 = lst.r.items.find((i) => i.id === x.id);
    assert.equal(it1.mine, true); assert.equal(it1.dev, 'devPhone01');
    assert.equal((await call('secDecide', M2, { op: 'done', id: x.id, dev: 'devDesk002' })).reason, 'not-mine');
    assert.ok((await call('secDecide', M1, { op: 'done', id: x.id, dev: 'devPhone01' })).ok);
    const d2 = await call('secDecide', M1, { op: 'done', id: x.id, dev: 'devPhone01' });
    assert.ok(d2.ok && d2.r.again, 'סיום חוזר – בלי שינוי');
    assert.equal((await coll(`b/${A}/sec_log`)).filter((l) => l.act === 'invOk' && l.tgt === x.id).length, 1);
    // תפיסה ישנה
    const y = await arrive(pdf(1), RAW.inv({ number: 'OLD', total_with_vat: 33 }));
    assert.ok((await call('secDecide', M1, { op: 'claim', id: y.id, mode: 'man', dev: 'devPhone01' })).ok);
    await put(`b/${A}/sec_inv/${y.id}`, { clAt: Date.now() - 25 * 3600e3 }, true);
    assert.ok((await call('secDecide', M2, { op: 'claim', id: y.id, mode: 'man', dev: 'devDesk002' })).ok, 'אחרי 24 שעות מכשיר אחר רשאי');
    await put(`b/${A}/sec_inv/${y.id}`, { clAt: Date.now() - 25 * 3600e3 }, true);
    const rr = await inBiz(A, (db) => INV.retention(db, Date.now()));
    assert.equal(rr.released, 1);
    assert.equal((await get(`b/${A}/sec_inv/${y.id}`)).st, 'new');
    assert.ok((await coll(`b/${A}/sec_note/${M1}/n`)).some((n) => /חזרה לתור/.test(n.title)));
  });
  it('ביטול "נכנס ישר" מחזיר ל"ממתין" ולא נכנס שוב אוטומטית; שחרור ודחייה', async () => {
    const x = await arrive(pdf(1), RAW.inv());
    await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devA0001' });
    await call('secDecide', M1, { op: 'done', id: x.id, dev: 'devA0001' });
    assert.equal((await call('secDecide', M2, { op: 'undo', id: x.id })).reason, 'not-mine');
    assert.ok((await call('secDecide', M1, { op: 'undo', id: x.id })).ok);
    const u = await get(`b/${A}/sec_inv/${x.id}`);
    assert.equal(u.st, 'new'); assert.equal(u.hold, 'undo'); assert.equal(u.el, false); assert.equal(u.purgeAt, undefined);
    assert.equal((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devA0001' })).reason, 'not-eligible');
    assert.ok((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'man', dev: 'devA0001' })).ok);
    assert.ok((await call('secDecide', M1, { op: 'release', id: x.id, dev: 'devA0001' })).ok);
    assert.equal((await get(`b/${A}/sec_inv/${x.id}`)).st, 'new');
    assert.ok((await call('secDecide', M2, { op: 'rej', id: x.id })).ok);
    assert.equal((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'man', dev: 'devA0001' })).reason, 'rejected');
  });
});

describe('אכיפה בשרת: קריאה ישירה ל-secDecide במצב אוטומטי (4.3)', () => {
  beforeEach(() => seed());
  // רשומות שנכתבו ישירות עם "זכאי" (כאילו גרסה ישנה או תקלה) – השרת בודק את כל התנאים שוב ודוחה
  const base = (o) => Object.assign({ st: 'new', k: 'inv', t: 1, src: [{ ch: 'wa', from: SUP_WA, t: 1 }], f: { supplier: 'ספק דמה בע"מ', hp: HP1, num: 'X1', date: '2026-11-01', total: 118 }, sub: 's1', match: 'hp', br: 'br1', brOk: true, full: true, dup: '', el: true, why: [], np: 0 }, o);
  const CASES = {
    ['f' + '1'.repeat(40)]: ['זיכוי', { k: 'cr', f: { supplier: 'ספק', hp: HP1, num: 'C1', date: '2026-11-01', total: -59 } }],
    ['f' + '2'.repeat(40)]: ['צ׳ק', { k: 'chk', f: { no: '1', amt: 100 } }],
    ['f' + '3'.repeat(40)]: ['סכום שלילי', { f: { supplier: 'ספק', hp: HP1, num: 'N1', date: '2026-11-01', total: -100 } }],
    ['f' + '4'.repeat(40)]: ['מעל התקרה', { f: { supplier: 'ספק', hp: HP1, num: 'B1', date: '2026-11-01', total: 5000 } }],
    ['f' + '5'.repeat(40)]: ['ערך מוחלט מעל התקרה', { f: { supplier: 'ספק', hp: HP1, num: 'B2', date: '2026-11-01', total: -5000 } }],
    ['f' + '6'.repeat(40)]: ['קבלה', { k: 'rcpt' }],
    ['f' + '7'.repeat(40)]: ['תעודת משלוח', { k: 'dn' }],
    ['f' + '8'.repeat(40)]: ['בלי סימון זכאות', { el: false }],
  };
  async function seedCases() { for (const [id, [, o]] of Object.entries(CASES)) await put(`b/${A}/sec_inv/${id}`, base(o)); await put(`b/${A}/sec_inv/f${'9'.repeat(40)}`, base({})); }
  it('בתוך התהליך: כל המקרים נדחים (not-eligible), הרשומה נשארת "ממתינה"; חשבונית תקינה – נתפסת', async () => {
    await seedCases();
    for (const [id, [name]] of Object.entries(CASES)) {
      const r = await call('secDecide', M1, { op: 'claim', id, mode: 'auto', dev: 'devA0001' });
      assert.equal(r.reason, 'not-eligible', name);
      assert.equal((await get(`b/${A}/sec_inv/${id}`)).st, 'new', name);
    }
    assert.ok((await call('secDecide', M1, { op: 'claim', id: 'f' + '9'.repeat(40), mode: 'auto', dev: 'devA0001' })).ok);
  });
  it('מבחוץ, דרך אמולטור הפונקציות (עוקף את האפליקציה) – אותה דחייה', { skip: !process.env.FIREBASE_EMULATOR_HUB || process.env.SEC_INV_LOCAL === '1' ? 'אמולטור הפונקציות לא רץ כאן' : false }, async () => {
    await seedCases();
    const FN = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
    const url = `http://${process.env.FUNCTIONS_EMULATOR_HOST || FN.host + ':' + FN.port}/${H.PROJECT_ID}/us-central1/secDecide`;
    for (const [id, [name]] of Object.entries(CASES)) {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + H.mockToken(M1) }, body: JSON.stringify({ data: { op: 'claim', id, mode: 'auto', dev: 'devHttp01' } }) });
      const j = await r.json();
      assert.equal(j.error && j.error.details && j.error.details.reason, 'not-eligible', name + ': ' + JSON.stringify(j));
    }
    const ok = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + H.mockToken(M1) }, body: JSON.stringify({ data: { op: 'claim', id: 'f' + '9'.repeat(40), mode: 'auto', dev: 'devHttp01' } }) });
    assert.ok((await ok.json()).result.ok);
  });
});

describe('שמירה ומחיקה (9.5): ריצה מדומה של secDaily', () => {
  beforeEach(() => seed());
  it('עותק בתור של חשבונית שאושרה – נמחק 30 יום אחרי האישור; קובץ שנדחה – אחרי 30 יום; צעירים נשארים; שום נתון אחר של העסק לא נפגע', async () => {
    const bufOk = pdf(1);
    const ok = await arrive(bufOk, RAW.inv());
    const young = await arrive(pdf(1), RAW.inv({ number: 'Y1', total_with_vat: 12 }));
    const rj = await arrive(pdf(1), RAW.inv({ number: 'R1', total_with_vat: 13 }));
    for (const x of [ok, young]) { await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'man', dev: 'devA0001' }); await call('secDecide', M1, { op: 'done', id: x.id, dev: 'devA0001' }); }
    await call('secDecide', M1, { op: 'rej', id: rj.id });
    const now = Date.now();
    await put(`b/${A}/sec_inv/${ok.id}`, { okAt: now - 31 * 864e5, purgeAt: now - 864e5 }, true);
    await put(`b/${A}/sec_inv/${rj.id}`, { rejAt: now - 31 * 864e5, purgeAt: now - 864e5 }, true);
    const before = { inbox: await get(`b/${A}/inbox/keep1`), log: (await coll(`b/${A}/sec_log`)).length };
    const r = await RM.runSecDaily({ now, bizzes: [await T.loadBiz(A)] });
    assert.deepEqual(r.errors, []);
    for (const id of [ok.id, rj.id]) {
      const x = await get(`b/${A}/sec_inv/${id}`);
      assert.equal(x.purged, true); assert.equal(x.np, 0);
      assert.equal((await coll(`b/${A}/sec_inv/${id}/p`)).length, 0, 'הקובץ נמחק מהתור');
    }
    const yx = await get(`b/${A}/sec_inv/${young.id}`);
    assert.ok(!yx.purged); assert.ok((await coll(`b/${A}/sec_inv/${young.id}/p`)).length >= 1, 'צעיר – נשאר');
    assert.deepEqual(await get(`b/${A}/inbox/keep1`), before.inbox, 'נתון אחר של העסק לא השתנה');
    assert.ok((await coll(`b/${A}/sec_log`)).length >= before.log, 'היומן לא נמחק');
    assert.ok((await coll(`b/${A}/sec_log`)).some((l) => l.act === 'retention' && /inv=2/.test(l.note || '')));
    // אותו קובץ שמגיע שוב אחרי המחיקה – לא נכנס פעם שנייה (הרשומה הקטנה נשארת)
    const again = await inBiz(A, (db) => INV.ingest(db, { ch: 'wa', from: SUP_WA, inId: 'again1', buf: bufOk }));
    assert.equal(again.dup, true); assert.equal(again.id, ok.id);
    assert.equal((await get(`b/${A}/sec_inv/${ok.id}`)).st, 'ok');
  });
});

describe('הרשאות ובידוד (10.6)', () => {
  beforeEach(() => seed());
  it('עובד – נחסם בכל פעולה; מנהל של עסק אחר – לא רואה ולא נוגע; מנהל עם הגבלת סניפים – רק הסניפים שלו, בלי הגדרות', async () => {
    const x1 = await arrive(pdf(1), RAW.inv());                                                // סניף br1
    const x2 = await arrive(pdf(1), RAW.inv({ supplier: 'מאפיית כהן', supplier_id: HP2 })); // סניף לא ידוע
    for (const [fn, d] of [['secInv', { op: 'list' }], ['secInv', { op: 'file', id: x1.id, k: 0 }], ['secDecide', { op: 'claim', id: x1.id, dev: 'devE00001' }], ['secDecide', { op: 'rej', id: x1.id }]]) {
      const r = await call(fn, E1, d);
      assert.equal(r.code, 'permission-denied', fn + ' עובד');
    }
    const lb = await call('secInv', MB, { op: 'list' });
    assert.ok(lb.ok); assert.equal(lb.r.items.length, 0, 'עסק אחר – רשימה ריקה');
    assert.equal((await call('secDecide', MB, { op: 'claim', id: x1.id, dev: 'devB00001' })).reason, 'not-found');
    assert.equal((await call('secInv', MB, { op: 'file', id: x1.id, k: 0 })).reason, 'not-found');
    assert.equal((await call('secDecide', MB, { op: 'claim', id: x1.id, dev: 'devB00001', bizId: A })).code, 'permission-denied', 'לא יכול לבחור עסק');
    const l3 = await call('secInv', M3, { op: 'list' });
    assert.deepEqual(l3.r.items.map((i) => i.id), [x1.id], 'רק סניף br1');
    assert.equal((await call('secDecide', M3, { op: 'claim', id: x2.id, dev: 'devM30001' })).reason, 'br-limited');
    assert.equal((await call('secInv', M3, { op: 'file', id: x2.id, k: 0 })).reason, 'not-found');
    assert.ok((await call('secDecide', M3, { op: 'claim', id: x1.id, dev: 'devM30001' })).ok, 'סניף שלו – מותר');
    assert.equal((await call('secInv', M3, { op: 'cfg', cap: 1 })).reason, 'br-limited');
    assert.equal((await call('secInv', M3, { op: 'sups', sups: [] })).reason, 'br-limited');
    const f = await call('secInv', M1, { op: 'file', id: x1.id, k: 0 });
    assert.ok(f.ok); assert.equal(Buffer.from(f.r.d, 'base64').slice(0, 5).toString('latin1'), '%PDF-');
  });
  it('חוקי הגישה: קריאה ישירה של sec_inv – מנהל רגיל כן; עובד, מנהל עסק אחר ומנהל עם הגבלת סניפים – לא; כתיבה – אף אחד', async () => {
    const x = await arrive(pdf(1), RAW.inv());
    const db = (u) => env.authenticatedContext(u, { email: u + '@x.invalid' }).firestore();
    await assertSucceeds(db(M1).doc(`b/${A}/sec_inv/${x.id}`).get());
    await assertSucceeds(db(M1).doc(`b/${A}/sec_inv/${x.id}/p/0`).get());
    await assertFails(db(E1).doc(`b/${A}/sec_inv/${x.id}`).get());
    await assertFails(db(MB).doc(`b/${A}/sec_inv/${x.id}`).get());
    await assertFails(db(M3).doc(`b/${A}/sec_inv/${x.id}`).get());
    await assertFails(db(M3).doc(`b/${A}/sec_inv/${x.id}/p/0`).get());
    await assertFails(db(M1).doc(`b/${A}/sec_inv/${x.id}`).update({ st: 'ok' }));
    await assertFails(db(M1).doc(`b/${A}/sec_cfg/inv`).get());
    await assertFails(db(M1).doc(`b/${A}/sec_cfg/inv`).set({ cap: 1e9 }));
  });
  it('רשימת הספקים מהמכשיר: נשמרת מנוקה; אותה רשימה שוב – בלי כתיבה; ערכים לא תקינים נדחים', async () => {
    const r = await call('secInv', M1, { op: 'sups', nb: 2, sups: [{ id: 's9', name: 'ספק\u0000 חדש', hp: '51-222-3334', br: ['br1', 'BAD BR'] }, { id: '../x', name: 'רע' }] });
    assert.ok(r.ok); assert.equal(r.r.n, 1);
    const c = await get(`b/${A}/sec_cfg/inv`);
    assert.deepEqual(c.sups, [{ id: 's9', name: 'ספק חדש', hp: '512223334', br: ['br1'] }]);
    const r2 = await call('secInv', M1, { op: 'sups', nb: 2, sups: [{ id: 's9', name: 'ספק\u0000 חדש', hp: '51-222-3334', br: ['br1', 'BAD BR'] }] });
    assert.equal(r2.r.same, true);
    assert.equal((await call('secInv', M1, { op: 'cfg', cap: -1 })).reason, 'bad-cap');
    assert.equal((await call('secDecide', M1, { op: 'claim', id: 'nope', dev: 'devA0001' })).reason, 'bad-id');
    assert.equal((await call('secDecide', M1, { op: 'claim', id: 'f' + 'a'.repeat(40) })).reason, 'bad-dev');
  });
});

// קצה לקצה באמולטור הפונקציות (רק ב-CI): הודעת ווצאפ עם PDF → secWaHook (חתימה) → secWaWork מוריד את הקובץ משרת הדמה של Meta →
// תור החשבוניות → אותו טריגר מזהה במודל המדומה (gemini-mock, classify) דרך המכסה → כרטיס זכאי ב-sec_inv
describe('קצה לקצה: ווצאפ → תור → זיהוי (אמולטור הפונקציות)', { skip: !process.env.FIREBASE_EMULATOR_HUB || process.env.SEC_INV_LOCAL === '1' ? 'אמולטור הפונקציות לא רץ כאן' : false }, () => {
  const crypto = require('node:crypto');
  const GM = require('./gemini-mock');
  const WM = require('./wa-mock');
  const PN = '1110001';
  before(async () => { await GM.start(); await WM.start(); });
  after(async () => { await GM.stop(); await WM.stop(); });
  it('PDF מספק מוכר בווצאפ – נקלט, מזוהה פעם אחת, נספר במכסה, וזכאי ל"נכנס ישר"; אותו PDF שוב – לא נוסף', async () => {
    await seed();
    GM.reset(); WM.reset();
    await put('sec_route/' + PN, { biz: A, mgr: {} });
    GM.state.classify = RAW.inv({ number: 'E2E-1', total_with_vat: 222 });
    const buf = pdf(1);
    WM.state.files.medE2E = { data: buf, mime: 'application/pdf' };
    const SECRETS = Object.fromEntries(fsm.readFileSync(path.join(H.ROOT, 'functions', '.secret.local'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
    const FN = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
    const url = `http://${process.env.FUNCTIONS_EMULATOR_HOST || FN.host + ':' + FN.port}/${H.PROJECT_ID}/us-central1/secWaHook`;
    const send = async (wamid) => {
      const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PN }, contacts: [{ wa_id: SUP_WA, profile: { name: 'ספק' } }],
        messages: [{ from: SUP_WA, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'document', document: { id: 'medE2E', mime_type: 'application/pdf', filename: 'חשבונית.pdf' } }] } }] }] });
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', SECRETS.WA_APP_SECRET).update(raw).digest('hex') }, body: raw });
      assert.equal(r.status, 200);
    };
    await send('wamid.E2E1');
    let L = [];
    for (let i = 0; i < 100; i++) { L = await coll(`b/${A}/sec_inv`); if (L.length && L[0].st === 'new') break; await new Promise((z) => setTimeout(z, 200)); }
    assert.equal(L.length, 1, JSON.stringify(L).slice(0, 300));
    assert.equal(L[0].k, 'inv'); assert.equal(L[0].f.num, 'E2E-1'); assert.equal(L[0].sub, 's1'); assert.equal(L[0].el, true, JSON.stringify(L[0].why));
    assert.equal(GM.state.requests.filter((r) => r.kind === 'classify').length, 1);
    assert.equal((await get(`b/${A}/scan_usage/_biz`)).count, 1, 'נספר במכסת העסק – קובץ = 1');
    await send('wamid.E2E2');
    for (let i = 0; i < 40; i++) { const x = await get(`b/${A}/sec_inv/${L[0].id}`); if ((x.src || []).length === 2) break; await new Promise((z) => setTimeout(z, 200)); }
    assert.equal((await coll(`b/${A}/sec_inv`)).length, 1, 'אותו קובץ – רשומה אחת');
    assert.equal((await get(`b/${A}/sec_inv/${L[0].id}`)).src.length, 2);
    assert.equal(GM.state.requests.filter((r) => r.kind === 'classify').length, 1, 'בלי זיהוי נוסף');
  });
});

// ---------------------------------------------------------------------------------
// שלב 7 – תיקון 1 (אחרי בדיקה עצמאית, סבב 1): בדיקה לכל ליקוי
// ---------------------------------------------------------------------------------
const b64u = (x) => x.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// מייל קטן מדומה עם קובץ מצורף; ar = כותרת Authentication-Results (או בלי)
function gmail(gid, buf, from, ar, att) {
  const headers = [{ name: 'From', value: 'Billing <' + from + '>' }, { name: 'Subject', value: 'חשבונית' }, { name: 'Content-Type', value: 'multipart/mixed; boundary=x' }];
  if (ar) headers.unshift({ name: 'Authentication-Results', value: ar });
  const msg = { id: gid, threadId: 't' + gid, labelIds: ['INBOX'], internalDate: String(Date.now()), sizeEstimate: 5000, snippet: 'מצורפת חשבונית',
    payload: { mimeType: 'multipart/mixed', headers, parts: [{ mimeType: 'text/plain', body: { data: b64u(Buffer.from('מצורפת')) } }, { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'att' + gid, size: buf.length } }] } };
  return { meta: async () => Object.assign({}, msg, { payload: { mimeType: msg.payload.mimeType, headers } }), full: async () => msg, struct: async () => msg, att: att || (async () => ({ size: buf.length, data: b64u(buf) })) };
}
const saveG = (c, gid) => inBiz(A, (db) => G.saveMail(db, c, { boxId: 'gmbox1', addr: 'office@a.example', mgrMails: new Set() }, gid, Date.now(), {}));
const ARP = (dom) => 'mx.google.com; dkim=pass header.i=@' + dom + ' header.s=s1 header.b=abc; spf=pass (google.com: domain of x@' + dom + ' designates 1.2.3.4 as permitted sender) smtp.mailfrom=x@' + dom + '; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=' + dom;
// PDF עם אוסף אובייקטים דחוס (/ObjStm, FlateDecode)
function pdfObjStm(inner, o) {
  const opt = o || {};
  const data = opt.raw ? Buffer.from(inner, 'latin1') : require('node:zlib').deflateSync(Buffer.from(inner, 'latin1'));
  const head = Buffer.from('%PDF-1.5\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n' + (opt.pages || '') + '5 0 obj<</Type /ObjStm /N 1 /First 4' + (opt.raw ? '' : ' /Filter ' + (opt.filter || '/FlateDecode')) + ' /Length ' + data.length + '>>stream\n', 'latin1');
  return Buffer.concat([head, data, Buffer.from('\nendstream\nendobj\n%uniq ' + (++SEQ) + '\ntrailer<<>>\n%%EOF', 'latin1')]);
}

describe('תיקון 1 – ליקוי 1: תפיסה ששוחררה לא חוזרת ל"נכנס ישר"', () => {
  beforeEach(() => seed());
  it('מכשיר א׳ תפס אוטומטית ולא דיווח 24 שעות: מכשיר ב׳ במצב אוטומטי – נדחה, והחשבונית חוזרת לאישור ידני (עיכוב, לא זכאית) עם התראה; ידני – מותר עם עיכוב; הדיווח המאוחר של א׳ – not-mine', async () => {
    const x = await arrive(pdf(1), RAW.inv());
    assert.equal(x.el, true);
    assert.ok((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devPhone01' })).ok);
    await put(`b/${A}/sec_inv/${x.id}`, { clAt: Date.now() - 25 * 3600e3 }, true);
    const b = await call('secDecide', M2, { op: 'claim', id: x.id, mode: 'auto', dev: 'devDesk002' });
    assert.equal(b.reason, 'not-eligible', JSON.stringify(b));
    const y = await get(`b/${A}/sec_inv/${x.id}`);
    assert.equal(y.st, 'new'); assert.equal(y.el, false); assert.equal(y.hold, 'rel'); assert.ok(y.why.includes('hold'));
    assert.ok((await coll(`b/${A}/sec_note/${M2}/n`)).some((n) => /אישור ידני/.test(n.title)), 'התראה');
    assert.equal((await call('secDecide', M2, { op: 'claim', id: x.id, mode: 'auto', dev: 'devDesk002' })).reason, 'not-eligible', 'גם אחר כך – לא אוטומטי');
    assert.equal((await call('secDecide', M1, { op: 'done', id: x.id, dev: 'devPhone01' })).reason, 'not-mine');
    // השתלטות ידנית על תפיסה ישנה – מותרת, אבל מסומנת
    const z = await arrive(pdf(1), RAW.inv({ number: 'Z1', total_with_vat: 21 }));
    assert.ok((await call('secDecide', M1, { op: 'claim', id: z.id, mode: 'auto', dev: 'devPhone01' })).ok);
    await put(`b/${A}/sec_inv/${z.id}`, { clAt: Date.now() - 25 * 3600e3 }, true);
    const m = await call('secDecide', M2, { op: 'claim', id: z.id, mode: 'man', dev: 'devDesk002' });
    assert.ok(m.ok); assert.equal(m.r.item.hold, 'rel');
    assert.equal((await get(`b/${A}/sec_inv/${z.id}`)).el, false);
  });
  it('שחרור בריצה היומית – חוזרת עם עיכוב ובלי זכאות; תפיסה אוטומטית אחר כך נדחית', async () => {
    const x = await arrive(pdf(1), RAW.inv());
    assert.ok((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devPhone01' })).ok);
    await put(`b/${A}/sec_inv/${x.id}`, { clAt: Date.now() - 25 * 3600e3 }, true);
    assert.equal((await inBiz(A, (db) => INV.retention(db, Date.now()))).released, 1);
    const y = await get(`b/${A}/sec_inv/${x.id}`);
    assert.equal(y.st, 'new'); assert.equal(y.el, false); assert.equal(y.hold, 'rel');
    assert.equal((await call('secDecide', M2, { op: 'claim', id: x.id, mode: 'auto', dev: 'devDesk002' })).reason, 'not-eligible');
  });
});

describe('תיקון 1 – ליקוי 2: מייל עם כתובת שולח מזויפת', () => {
  beforeEach(() => seed({ inv: { links: { ['wa:' + SUP_WA]: 's1', ['m:' + SUP_MAIL]: 's1' } } }));
  it('authOf: רק הכותרת העליונה של mx.google.com, dmarc/dkim=pass של דומיין השולח; SPF לבד, כשל, דומיין אחר או כותרת מזויפת – לא מאומת', () => {
    const G2 = require('../functions/lib/sec-google.js');
    assert.equal(G2.authOf(ARP('supplier.example'), SUP_MAIL), true);
    assert.equal(G2.authOf('mx.google.com; dkim=pass header.i=@mail.supplier.example header.s=a; spf=neutral', SUP_MAIL), true, 'תת־דומיין של השולח');
    assert.equal(G2.authOf('mx.google.com; dmarc=pass (p=NONE) header.from=supplier.example', SUP_MAIL), true);
    assert.equal(G2.authOf('mx.google.com; spf=pass smtp.mailfrom=billing@supplier.example; dkim=none; dmarc=fail header.from=supplier.example', SUP_MAIL), false, 'SPF לבד');
    assert.equal(G2.authOf('mx.google.com; dkim=pass header.i=@evil.example; dmarc=fail header.from=supplier.example', SUP_MAIL), false, 'חתימה של דומיין אחר');
    assert.equal(G2.authOf('evil.example; dmarc=pass header.from=supplier.example', SUP_MAIL), false, 'לא של Google');
    assert.equal(G2.authOf('', SUP_MAIL), false);
    assert.equal(G2.authOf(ARP('supplier.example'), 'x@other.example'), false);
    // כותרת מזויפת מתחת לכותרת של Google – לא נקראת (headersOf לוקח את הראשונה)
    const p = G2.parseMsg({ id: 'g1', payload: { headers: [{ name: 'Authentication-Results', value: 'mx.google.com; dkim=none; spf=softfail; dmarc=none header.from=supplier.example' }, { name: 'Authentication-Results', value: ARP('supplier.example') }, { name: 'From', value: SUP_MAIL }] } });
    assert.equal(p.auth, false);
  });
  it('From מזויף של שולח מקושר, בלי ח.פ: לא מזוהה כספק לפי השולח, לא זכאי (auth), מסומן ומתריע; אותו מייל מאומת – זכאי', async () => {
    const st = await saveG(gmail('gfake1', pdf(1), SUP_MAIL, 'mx.google.com; spf=softfail smtp.mailfrom=x@evil.example; dkim=none; dmarc=none header.from=supplier.example'), 'gfake1');
    assert.equal(st, 'saved');
    const L = await coll(`b/${A}/sec_inv`);
    assert.equal(L.length, 1); assert.equal(L[0].src[0].ua, true);
    await inBiz(A, () => INV.workIn(L[0].id, { classify: async () => RAW.inv({ supplier_id: '', supplier: 'ספק כלשהו', number: 'F1', total_with_vat: 1900 }) }));
    const x = Object.assign({ id: L[0].id }, await get(`b/${A}/sec_inv/${L[0].id}`));
    assert.notEqual(x.match, 'snd'); assert.equal(x.el, false); assert.ok(x.why.includes('auth')); assert.equal(x.ua, true);
    assert.ok((await coll(`b/${A}/sec_note/${M1}/n`)).some((n) => /לא מאומת/.test(n.title)), 'התראה');
    const lst = await call('secInv', M1, { op: 'list' });
    assert.equal(lst.r.items.find((i) => i.id === x.id).ua, true, 'הסימון מגיע למסך');
    assert.equal((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devA0001' })).reason, 'not-eligible');
    // מאומת
    const st2 = await saveG(gmail('gok1', pdf(1), SUP_MAIL, ARP('supplier.example')), 'gok1');
    assert.equal(st2, 'saved', 'מייל שני');
    const y0 = (await coll(`b/${A}/sec_inv`)).find((d) => d.id !== x.id);
    assert.ok(!y0.src[0].ua);
    await inBiz(A, () => INV.workIn(y0.id, { classify: async () => RAW.inv({ supplier_id: '', supplier: 'ספק דמה בע"מ', number: 'OK1', total_with_vat: 150 }) }));
    const y = await get(`b/${A}/sec_inv/${y0.id}`);
    assert.equal(y.match, 'snd'); assert.equal(y.el, true, JSON.stringify(y.why));
  });
  // שלב 8 – החלטה חדשה של בעל הפרויקט (מחליפה את הבדיקה הקודמת "עדיין לא נכנס ישר"): ח.פ של ספק מוכר מספיק גם כשהמייל לא מאומת
  it('מייל לא מאומת עם ח.פ של ספק מוכר – "נכנס ישר" (החלטת שלב 8), עם סימון והתראה "שולח לא מאומת"', async () => {
    await saveG(gmail('gfake2', pdf(1), SUP_MAIL, null), 'gfake2');
    const L = await coll(`b/${A}/sec_inv`);
    await inBiz(A, () => INV.workIn(L[0].id, { classify: async () => RAW.inv() }));
    const x = await get(`b/${A}/sec_inv/${L[0].id}`);
    assert.equal(x.match, 'hp'); assert.equal(x.ua, true); assert.equal(x.el, true, JSON.stringify(x.why)); assert.deepEqual(x.why, []);
    assert.ok((await coll(`b/${A}/sec_note/${M1}/n`)).some((n) => /לא מאומת/.test(n.title) && /תיכנס ישר/.test(n.body)), 'התראה "שולח לא מאומת"');
  });
});

describe('תיקון 1 – ליקוי 3: בדיקת PDF שלא נעקפת', () => {
  it('שם פקודה בקידוד #xx – נחסם', () => {
    assert.equal(SI.inspect(pdf(1, '<</S /J#61vaScript /J#53 (app.alert(1))>>')).why, 'active');
    assert.equal(SI.inspect(pdf(1, '<</S /#4caunch /F (cmd.exe)>>')).why, 'active');
    assert.equal(SI.inspect(pdf(1, '<</Type /Embedded#46ile>>')).why, 'active');
  });
  it('פקודה בתוך אוסף אובייקטים דחוס (/ObjStm) – נחסם; גם בלי /Type אבל עם /N ו-/First', () => {
    assert.equal(SI.inspect(pdfObjStm('3 0 <</S /JavaScript /JS (app.alert(1))>>')).why, 'active');
    assert.equal(SI.inspect(pdfObjStm('3 0 <</S /J#61vaScript>>')).why, 'active');
    const noType = Buffer.from(pdfObjStm('3 0 <</S /Launch>>').toString('latin1').replace('/Type /ObjStm ', ''), 'latin1');
    assert.equal(SI.inspect(noType).why, 'active');
    assert.equal(SI.inspect(pdfObjStm('3 0 <</Type /Page /Parent 2 0 R>>', { pages: '2 0 obj<</Type /Pages /Count 1>>endobj\n' })).ok, true, 'אוסף תקין – עובר');
  });
  it('מספר עמודים: עמודים בתוך אוסף דחוס, ו-/Count של עץ העמודים – לוקחים את הגבוה; מעל 4 – "קובץ ארוך"', () => {
    let inner = ''; for (let i = 0; i < 30; i++) inner += '<</Type /Page /Parent 2 0 R>> ';
    const a = SI.inspect(pdfObjStm(inner));
    assert.equal(a.long, true); assert.equal(a.pages, 30);
    const b = SI.inspect(pdfObjStm('<</Type /Pages /Kids [3 0 R] /Count 30>> <</Type /Page>>'));
    assert.equal(b.long, true); assert.equal(b.pages, 30);
    const c = SI.inspect(Buffer.from('%PDF-1.4\n2 0 obj<</Type /Pages /Count 12 /Kids [3 0 R]>>endobj\n3 0 obj<</Type /Page>>endobj\n%%EOF', 'latin1'));
    assert.equal(c.pages, 12); assert.equal(c.long, true);
    assert.equal(SI.inspect(Buffer.from('%PDF-1.4\n1 0 obj<</Type /Outlines /Count 9>>endobj\n2 0 obj<</Type /Pages /Count 1>>endobj\n3 0 obj<</Type /Page>>endobj\n%%EOF', 'latin1')).pages, 1, '/Count של תוכן העניינים לא נספר');
  });
  it('אוסף דחוס שאי אפשר לפרוס (מסנן אחר, נתונים פגומים) – חסום ("לא ניתן לבדוק")', () => {
    assert.equal(SI.inspect(pdfObjStm('3 0 <<>>', { filter: '/LZWDecode' })).why, 'unv');
    assert.equal(SI.inspect(pdfObjStm('3 0 <<>>', { filter: '[/ASCIIHexDecode /FlateDecode]' })).why, 'unv');
    const bad = Buffer.from(pdfObjStm('3 0 <<>>').toString('latin1').replace(/stream\n[\s\S]{4}/, 'stream\nXXXX'), 'latin1');
    assert.equal(SI.inspect(bad).why, 'unv');
  });
});

describe('תיקון 2 – בדיקת PDF: "obj" שמוסתר במילון לא מסתיר אוסף דחוס', () => {
  const hide = (extra) => Buffer.from(pdfObjStm('3 0 <</S /JavaScript /JS (app.alert(1))>>').toString('latin1').replace('/Type /ObjStm ', '/Type /ObjStm ' + extra + ' '), 'latin1');
  it('שם עם obj, מחרוזת (obj), הערה %obj, ו-(1 0 obj) / (endobj) בתוך מחרוזת – נחסם', () => {
    assert.equal(SI.inspect(hide('/Foo /objx')).why, 'active');
    assert.equal(SI.inspect(hide('/Foo (obj)')).why, 'active');
    assert.equal(SI.inspect(hide('/Foo (1 0 obj)')).why, 'active');
    assert.equal(SI.inspect(hide('/Foo (endobj)')).why, 'active');
    assert.equal(SI.inspect(hide('/Foo (a\\) obj)')).why, 'active');
    const cm = Buffer.from(pdfObjStm('3 0 <</S /Launch>>').toString('latin1').replace('/Type /ObjStm ', '/Type /ObjStm %obj\n'), 'latin1');
    assert.equal(SI.inspect(cm).why, 'active');
  });
  it('מסנן מזויף בתוך מחרוזת אחרי המסנן האמיתי – לא נפרס כטקסט גלוי (חסום או נתפס)', () => {
    const b = Buffer.from(pdfObjStm('3 0 <</S /JavaScript>>').toString('latin1').replace('/Filter /FlateDecode', '/Filter /FlateDecode /X (obj /Filter /DCTDecode)'), 'latin1');
    assert.notEqual(SI.inspect(b).ok, true);
  });
  it('קובץ רגיל עם זרם תמונה דחוס, אורך עקיף ו-"endstream" בתוך הנתונים – עובר', () => {
    const z = require('node:zlib');
    const img = Buffer.concat([Buffer.from('xx endstream yy (', 'latin1'), z.deflateSync(Buffer.from('BT /F1 12 Tf (Hello) Tj ET', 'latin1'))]);
    const head = '%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n3 0 obj<</Type /Page /Parent 2 0 R /Contents 4 0 R>>endobj\n4 0 obj<</Length 5 0 R /Filter /FlateDecode>>stream\n';
    const buf = Buffer.concat([Buffer.from(head, 'latin1'), img, Buffer.from('\nendstream\nendobj\n5 0 obj ' + img.length + ' endobj\n%uniq ' + (++SEQ) + '\ntrailer<<>>\n%%EOF', 'latin1')]);
    assert.deepEqual(SI.inspect(buf), { ok: true, mime: 'application/pdf', pages: 1 });
  });
});

describe('תיקון 3 – בדיקת PDF: מסנן עקיף נחסם, וזמן הבדיקה ליניארי', () => {
  it('/Filter עקיף (7 0 R), מערך עם הפניה, ו-/DecodeParms עקיף – "לא ניתן לבדוק"', () => {
    for (const f of ['7 0 R', '[7 0 R]', '[/FlateDecode 7 0 R]', '/FlateDecode /DecodeParms 8 0 R']) {
      const b = Buffer.from(pdfObjStm('3 0 <</S /JavaScript>>').toString('latin1').replace('/Filter /FlateDecode', '/Filter ' + f), 'latin1');
      assert.equal(SI.inspect(b).why, 'unv', f);
    }
  });
  it('קובץ של כ-9MB עם מאות אלפי זרמים (עם ובלי כותרות, ואורכים עקיפים) – נבדק בתוך פחות מ-5 שניות', () => {
    let p = ['%PDF-1.5\n'], sz = 0, n = 0;
    while (sz < 6 * 1024 * 1024) { const x = (++n) + ' 0 obj<</Length 3>>stream\nabc\nendstream\nendobj\n'; p.push(x); sz += x.length; }
    for (let i = 0; i < 60000; i++) p.push('<</Length 3>>stream\nabc\nendstream\n');
    for (let i = 0; i < 10000; i++) { p.push((n + 1) + ' 0 obj<</Length ' + (n + 2) + ' 0 R>>stream\nabc\nendstream\nendobj\n' + (n + 2) + ' 0 obj 3 endobj\n'); n += 2; }
    p.push('%%EOF');
    const b = Buffer.from(p.join(''), 'latin1');
    assert.ok(b.length < SI.MAX_FILE);
    const t = Date.now();
    assert.equal(SI.inspect(b).ok, true);
    assert.ok(Date.now() - t < 5000, 'זמן: ' + (Date.now() - t));
  });
});

describe('תיקון 1 – ליקוי 4: ביטול רק מהמכשיר שהכניס', () => {
  beforeEach(() => seed());
  it('אותו מנהל ממכשיר אחר – "אפשר לבטל רק במכשיר שבו החשבונית נכנסה", בלי שינוי; מהמכשיר שהכניס – בוטל; המזהה מגיע לרשימה', async () => {
    const x = await arrive(pdf(1), RAW.inv());
    await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devPhone01' });
    await call('secDecide', M1, { op: 'done', id: x.id, dev: 'devPhone01' });
    const l = await call('secInv', M1, { op: 'list' });
    assert.equal(l.r.items.find((i) => i.id === x.id).okDev, 'devPhone01');
    const u = await call('secDecide', M1, { op: 'undo', id: x.id, dev: 'devDesk002' });
    assert.equal(u.reason, 'other-dev');
    assert.equal((await get(`b/${A}/sec_inv/${x.id}`)).st, 'ok', 'לא השתנה');
    assert.equal((await call('secDecide', M1, { op: 'undo', id: x.id, dev: 'bad id!' })).reason, 'other-dev', 'מזהה לא תקין');
    assert.ok((await call('secDecide', M1, { op: 'undo', id: x.id, dev: 'devPhone01' })).ok);
    assert.equal((await get(`b/${A}/sec_inv/${x.id}`)).st, 'new');
  });
});

describe('תיקון 1 – ליקוי 5: קובץ שההורדה שלו נכשלה לא הולך לאיבוד', () => {
  beforeEach(() => seed());
  it('Gmail: הורדת הקובץ המצורף נכשלה – כרטיס "הקובץ לא נקלט – תקלה" עם השולח, מקושר למייל', async () => {
    const c = gmail('gdl1', pdf(1), SUP_MAIL, ARP('supplier.example'), async () => { throw new Error('net'); });
    assert.equal(await saveG(c, 'gdl1'), 'saved');
    const L = await coll(`b/${A}/sec_inv`);
    assert.equal(L.length, 1); assert.equal(L[0].k, 'bad'); assert.deepEqual(L[0].why, ['dl']); assert.equal(L[0].src[0].from, SUP_MAIL);
    const m = (await coll(`b/${A}/sec_in`)).find((x) => x.ch === 'mail');
    assert.deepEqual(m.inv, [L[0].id]);
  });
  it('Gmail: תקלה כללית בקבצים (למשל מבנה המייל) – כרטיס תקלה וסימון invErr במייל', async () => {
    const buf = pdf(1);
    const c = gmail('gdl2', buf, SUP_MAIL, null);
    const msg = await c.full();
    msg.sizeEstimate = 900000; // מייל גדול: רק המבנה, והמבנה נכשל
    c.full = async () => msg; c.meta = async () => Object.assign({}, msg, { payload: { mimeType: 'multipart/mixed', headers: msg.payload.headers } });
    c.struct = async () => { throw new Error('boom'); };
    assert.equal(await saveG(c, 'gdl2'), 'saved');
    const L = await coll(`b/${A}/sec_inv`);
    assert.equal(L.length, 1); assert.equal(L[0].k, 'bad'); assert.deepEqual(L[0].why, ['dl']);
    const m = (await coll(`b/${A}/sec_in`)).find((x) => x.ch === 'mail');
    assert.ok(m.flags.includes('invErr'));
  });
  it('ווצאפ: הורדה מ-Meta נכשלה – כרטיס תקלה עם השולח, וסימון invErr בהודעה', async () => {
    await put(`b/${A}/sec_in/mWdl`, { wamid: 'wamid.DL', ch: 'wa', from: SUP_WA, pnid: '1110001', name: 'ספק', t: Date.now(), rt: Date.now(), type: 'other', sub: 'document', media: { id: 'medDL', mime: 'application/pdf', fn: 'inv.pdf' }, own: 'sec', st: 'new', flags: [], tf: Date.now(), text: '' });
    const wr = await inBiz(A, () => WA.workIn('mWdl', { token: 'x', media: async () => { throw new Error('meta down'); } }));
    assert.ok(wr.inv, 'יש כרטיס');
    const x = await get(`b/${A}/sec_inv/${wr.inv}`);
    assert.equal(x.k, 'bad'); assert.deepEqual(x.why, ['dl']); assert.equal(x.src[0].from, SUP_WA);
    assert.ok((await get(`b/${A}/sec_in/mWdl`)).flags.includes('invErr'));
  });
});

describe('תיקון 1 – ליקויים 6, 7, 8', () => {
  beforeEach(() => seed());
  it('6: מנהל עם הגבלת סניפים לא מאשר שולח (הגדרה של כל העסק)', async () => {
    const x = await arrive(pdf(1), RAW.inv(), { from: '972509999999' }); // סניף br1, שולח חדש
    assert.ok(x.ns);
    assert.equal((await call('secDecide', M3, { op: 'sender', id: x.id })).reason, 'br-limited');
    assert.equal(((await get(`b/${A}/sec_cfg/inv`)).links || {})['wa:972509999999'], undefined);
    assert.ok((await call('secDecide', M1, { op: 'sender', id: x.id })).ok);
  });
  it('7: אותה חשבונית – בקובץ אחד זוהה ח.פ ובשני לא (אותו ספק לפי שולח מקושר) – חשד לכפילות; שני קבצים שמזוהים באותו זמן – לא שניהם זכאים', async () => {
    const a = await arrive(jpg(), RAW.inv());
    const b = await arrive(pdf(1), RAW.inv({ supplier_id: '', number: 'INV-100' }));
    assert.equal(b.match, 'snd'); assert.equal(b.dup, a.id); assert.equal(b.el, false);
    const ids = [];
    await inBiz(A, async (db) => { for (const buf of [pdf(1), jpg()]) ids.push((await INV.ingest(db, { ch: 'wa', from: SUP_WA, inId: 'cc' + (++SEQ), fn: 'a.pdf', buf })).id); });
    await inBiz(A, () => Promise.all(ids.map((id) => INV.workIn(id, { classify: async () => RAW.inv({ number: 'CC-1', total_with_vat: 77 }) }))));
    const xs = await Promise.all(ids.map((id) => get(`b/${A}/sec_inv/${id}`)));
    assert.ok(!(xs[0].el && xs[1].el), 'לא שתיהן "נכנס ישר"');
    assert.ok(xs.some((x) => x.dup), 'לפחות אחת מסומנת כפולה');
  });
  it('8: מי פרסם את רשימת הספקים ומתי – נרשם ומוצג; שינוי בשיוך סניף של ספק – חשבוניות ממתינות שלו מאבדות את הזכאות', async () => {
    await call('secInv', M1, { op: 'sups', nb: 2, dev: 'devPhone01', sups: [{ id: 's1', name: 'ספק דמה בע"מ', hp: HP1, br: ['br1'] }, { id: 's2', name: 'מאפיית כהן', hp: HP2, br: ['br1', 'br2'] }] });
    const x = await arrive(pdf(1), RAW.inv());
    assert.equal(x.el, true); assert.equal(x.br, 'br1');
    const r = await call('secInv', M2, { op: 'sups', nb: 2, dev: 'devDesk002', sups: [{ id: 's1', name: 'ספק דמה בע"מ', hp: HP1, br: ['br2'] }, { id: 's2', name: 'מאפיית כהן', hp: HP2, br: ['br1', 'br2'] }] });
    assert.equal(r.r.rev, 1);
    const y = await get(`b/${A}/sec_inv/${x.id}`);
    assert.equal(y.el, false); assert.equal(y.br, 'br2'); assert.ok(y.why.includes('hold'));
    assert.equal((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devPhone01' })).reason, 'not-eligible');
    const l1 = await call('secInv', M1, { op: 'list' }), l2 = await call('secInv', M2, { op: 'list' });
    assert.ok(l1.r.cfg.supAt > 0); assert.equal(l1.r.cfg.supMe, false); assert.equal(l2.r.cfg.supMe, true); assert.equal(l2.r.cfg.supDev, 'devDesk002');
    assert.ok((await coll(`b/${A}/sec_log`)).some((g) => g.act === 'invSups' && /dev=devDesk002/.test(g.note || '') && /rev=1/.test(g.note || '')));
  });
});

describe('תיקון 1 – החלטות בעל הפרויקט (1, 2, 3)', () => {
  it('1+2: ברירת המחדל של התקרה – 20,000 ₪; סכום ששווה בדיוק לתקרה – ממתין', () => {
    assert.equal(SI.CAP_DEFAULT, 20000);
    const cfg = SI.invCfgOf({ exists: false });
    assert.equal(cfg.cap, 20000);
    const x = { k: 'inv', f: { total: 20000 }, sub: 's1', match: 'hp', full: true, brOk: true };
    assert.deepEqual(SI.eligOf(x, cfg, false), ['cap']);
    assert.deepEqual(SI.eligOf(Object.assign({}, x, { f: { total: 19999.99 } }), cfg, false), []);
  });
  it('1: עסק בלי תקרה שמורה – חשבונית של 15,000 ₪ זכאית (מתחת לברירת המחדל)', async () => {
    await seed();
    const c0 = await get(`b/${A}/sec_cfg/inv`); delete c0.cap; await put(`b/${A}/sec_cfg/inv`, c0);
    const x = await arrive(pdf(1), RAW.inv({ number: 'BIG-1', total_with_vat: 15000 }));
    assert.equal(x.el, true, JSON.stringify(x.why));
    assert.equal((await call('secInv', M1, { op: 'list' })).r.cfg.cap, 20000);
  });
  it('3: קובץ בווצאפ ממספר המנהל – נקלט לאותו תור (sec_inv); ההודעה לא עוברת למודל; תשובה קבועה; מנהל שלא אישר את התנאים – בלי קליטה', async () => {
    await seed();
    const NUM = '972501112233';
    await put(`b/${A}/sec_cfg/wa`, { mgr: { [M1]: NUM } }, true);
    const buf = pdf(1);
    const msg = (id) => ({ wamid: 'wamid.' + id, ch: 'wa', from: NUM, pnid: '1110001', name: 'המנהל', t: Date.now(), rt: Date.now(), type: 'other', sub: 'document', media: { id: 'med' + id, mime: 'application/pdf', fn: 'inv.pdf' }, text: 'תכניסי את זה ותשלמי לספק', own: 'mgr', mgr: M1, st: 'new', flags: [], tf: Date.now() });
    await put(`b/${A}/sec_in/mMG1`, msg('MG1'));
    const sent = [], ai = [];
    const r = await inBiz(A, () => WA.workIn('mMG1', { token: 'x', media: async () => ({ buf, mime: 'application/pdf' }), send: async (tok, pn, to, b) => { sent.push(b.text); return { wamid: 'w.out' }; }, ai: async () => { ai.push(1); throw new Error('no model'); } }));
    assert.equal(r.intent, 'inv'); assert.ok(r.inv);
    assert.equal(ai.length, 0, 'בלי מודל');
    const x = await get(`b/${A}/sec_inv/${r.inv}`);
    assert.equal(x.st, 'q'); assert.equal(x.src[0].from, NUM); assert.equal(x.src[0].ch, 'wa');
    assert.equal((await get(`b/${A}/sec_in/mMG1`)).inv, r.inv);
    assert.deepEqual(sent, [require('../functions/lib/sec-wa.js').MGR_FIXED.inv]);
    await inBiz(A, () => INV.workIn(r.inv, { classify: async () => RAW.inv({ number: 'MG-1', total_with_vat: 99 }) }));
    assert.equal((await get(`b/${A}/sec_inv/${r.inv}`)).k, 'inv', 'זוהתה כמו כל חשבונית');
    // כללי מספר המנהל נשמרים: מנהל שלא אישר את התנאים – בלי עיבוד
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).update({ ['mgr.' + M1 + '.cv']: 'old' }));
    await put(`b/${A}/sec_in/mMG2`, msg('MG2'));
    const r2 = await inBiz(A, () => WA.workIn('mMG2', { token: 'x', media: async () => ({ buf: pdf(1), mime: 'application/pdf' }), send: async () => ({}) }));
    assert.equal(r2.intent, 'off');
    assert.equal((await coll(`b/${A}/sec_inv`)).length, 1);
  });
});

// ---------------------------------------------------------------------------------
describe('קבצים ממייל ישן (סריקת היסטוריה): הוצאה בלבד, מכסה מלאה – ממתין למחר, ביטול הגבלה, בלי התראות', () => {
  beforeEach(() => seed());
  const H1 = { ch: 'mail', from: SUP_MAIL, hist: true };
  it('קובץ ישן מסומן hist + noStock (גם כרטיס "לא נקלט"), ועובר את אותו זיהוי (כותרת בלבד) ואותם תנאי "נכנס ישר"', async () => {
    const a = await arrive(pdf(1), RAW.inv({ number: 'OLD-1' }), H1);
    assert.equal(a.hist, true); assert.equal(a.noStock, true); assert.equal(a.src[0].hist, true);
    assert.equal(a.k, 'inv'); assert.equal(CLS, 1);
    const bad = await arrive(Buffer.from('PK\x03\x04zip'), null, Object.assign({ fn: 'x.zip' }, H1));
    assert.equal(bad.k, 'bad'); assert.equal(bad.noStock, true);
    const L = await call('secInv', M1, { op: 'list' });
    const it = L.r.items.find((x) => x.id === a.id);
    assert.equal(it.hist, true); assert.equal(it.noStock, true);
    const n = await arrive(pdf(1), RAW.inv({ number: 'NEW-1' }));
    assert.equal(n.hist, undefined); assert.equal(L.r.items.find((x) => x.id === n.id), undefined);
  });
  it('מכסה מלאה: קובץ ישן נשאר בתור וממתין למחר (לא כרטיס "מכסה"); requeue לפני הזמן – לא; אחרי – חוזר בלי להגדיל ניסיונות', async () => {
    await put(`b/${A}/private/info`, { adv: { limits: { scanDaily: 1 } } });
    await arrive(pdf(1), RAW.inv({ number: 'N-1' }));
    const w = await arrive(pdf(1), RAW.inv({ number: 'OLD-2' }), H1);
    assert.equal(w.st, 'q'); assert.equal(w.err, undefined); assert.ok(w.qwt > Date.now()); assert.equal(CLS, 1, 'בלי מודל');
    assert.notEqual(dayIL(w.qwt), dayIL(Date.now()), 'מחר');
    assert.equal((await coll(`b/${A}/sec_log`)).filter((l) => l.act === 'invWait').length, 1);
    // קובץ חדש (לא ישן) במכסה מלאה – כמו קודם: כרטיס "מכסה"
    const q = await arrive(pdf(1), RAW.inv({ number: 'N-2' }));
    assert.equal(q.err, 'quota');
    let r = await inBiz(A, (db) => INV.requeue(db, A, w.qwt - 1000));
    assert.equal(r.requeued, 0, 'לפני מחר – לא חוזר');
    assert.equal((await get(`b/${A}/sec_inv/${w.id}`)).st, 'q');
    r = await inBiz(A, (db) => INV.requeue(db, A, w.qwt + 1));
    assert.equal(r.requeued, 1); assert.equal(r.failed, 0);
    const x = await get(`b/${A}/sec_inv/${w.id}`);
    // (באמולטור רשומת התור מפעילה מיד את הזיהוי מחדש – לכן לא בודקים כאן את המצב עצמו)
    assert.ok(['q', 'qw', 'new'].includes(x.st)); assert.equal(x.rq, undefined, 'בלי להגדיל ניסיונות'); assert.equal(x.rqAt, w.qwt + 1);
    // מחכים שהזיהוי באמולטור יסתיים, כדי שלא יתנגש בניקוי של הבדיקה הבאה
    for (let i = 0; i < 40; i++) { const v = await get(`b/${A}/sec_inv/${w.id}`); if (v && v.st !== 'qw') break; await new Promise((ok) => setTimeout(ok, 250)); }
    await new Promise((ok) => setTimeout(ok, 500));
  });
  it('ביטול הגבלה (מנהל־על, עד תאריך): קובץ ישן לא נבדק ולא נספר במכסות; קובץ חדש – עדיין כן; אחרי התאריך – חוזר להגבלה', async () => {
    await put(`b/${A}/private/info`, { adv: { limits: { scanDaily: 1 } } });
    await arrive(pdf(1), RAW.inv({ number: 'N-1' }));
    await put(`b/${A}/sec_cfg/mail_auto`, { noCapUntil: Date.now() + 864e5 });
    const a = await arrive(pdf(1), RAW.inv({ number: 'OLD-3' }), H1);
    assert.equal(a.st, 'new'); assert.equal(a.k, 'inv'); assert.equal(CLS, 2);
    assert.equal((await get(`b/${A}/scan_usage/_biz`)).count, 1, 'לא נספר');
    assert.equal((await get(`b/${A}/scan_usage/_sec`)).count, 1);
    assert.equal((await arrive(pdf(1), RAW.inv({ number: 'N-2' }))).err, 'quota', 'קובץ חדש – במכסה הרגילה');
    await put(`b/${A}/sec_cfg/mail_auto`, { noCapUntil: Date.now() - 1 });
    assert.equal((await arrive(pdf(1), RAW.inv({ number: 'OLD-4' }), H1)).st, 'q', 'התאריך עבר – מוגבל שוב');
  });
  it('קובץ ישן שנכנס ישר משולח חדש, וקובץ ישן שהמכשיר עיכב כחשד לכפילות – רק ביומן, בלי התראה', async () => {
    const x = await arrive(pdf(1), RAW.inv(), H1);
    assert.equal(x.ns, 'm:' + SUP_MAIL); assert.equal(x.el, true); assert.equal(x.hist, true);
    assert.ok((await call('secDecide', M1, { op: 'claim', id: x.id, mode: 'auto', dev: 'devA0001' })).ok);
    assert.ok((await call('secDecide', M1, { op: 'done', id: x.id, dev: 'devA0001' })).r.auto);
    const y = await arrive(pdf(1), RAW.inv({ number: 'OLD-9', total_with_vat: 77 }), H1);
    assert.ok((await call('secDecide', M1, { op: 'hold', id: y.id, why: 'dup' })).ok);
    assert.equal((await get(`b/${A}/sec_inv/${y.id}`)).hold, 'dup');
    const lg = await coll(`b/${A}/sec_log`);
    assert.ok(lg.some((l) => l.act === 'invAuto' && l.tgt === x.id)); assert.ok(lg.some((l) => l.act === 'invHold' && l.tgt === y.id));
    for (const u of [M1, M2]) assert.equal((await coll(`b/${A}/sec_note/${u}/n`)).length, 0, 'בלי שום התראה');
  });
  it('חשד לכפילות / שולח לא מאומת בקובץ ישן – רק ביומן, בלי התראה', async () => {
    await arrive(jpg(), RAW.inv());
    const n0 = (await coll(`b/${A}/sec_note/${M1}/n`)).length;
    const d = await arrive(pdf(1), RAW.inv({ number: 'inv 100' }), H1);
    assert.ok(d.dup); assert.equal(d.el, false);
    assert.equal((await coll(`b/${A}/sec_note/${M1}/n`)).length, n0, 'בלי התראה');
    assert.ok((await coll(`b/${A}/sec_log`)).some((l) => l.act === 'invDup' && l.tgt === d.id));
  });
});
