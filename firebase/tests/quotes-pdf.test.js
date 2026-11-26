'use strict';
// הצעת מחיר – PDF ושליחה (24.11.2026, שלב 4): functions/quotes-pdf.js (qtPdf, qtSend) + 'qt' ב-WT_KEYS של ar.js.
// הפונקציות רצות בתוך תהליך הבדיקה (צריך אמולטור firestore + storage). אין שום שליחה אמיתית:
// ווטסאפ – פונקציית שליחה מדומה (deps.send); מייל – transport מדומה (deps.mail), או בלי ספק → no-secrets.
process.env.FUNCTIONS_EMULATOR = 'true';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { extract } = require('./pdf-text');
const PDF = require('../functions/lib/ar-pdf');

const A = 'biz-qpdf';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'qp_mgr', E1 = 'qp_e1', E2 = 'qp_e2', NOORD = 'qp_no', SUPER = 'qp_super';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false };
const WS = 'cWS';

let env, QP, Q, T, AR, FN, n = 0;
const rid = () => 'qpreq' + Date.now().toString(36) + (n++) + 'xx';
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const P = (p) => `b/${A}/${p}`;
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(P(p)).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(P(p)).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
async function set(p, o, merge) { await prep(async (d) => d.doc(P(p)).set(o, merge ? { merge: true } : {})); }
const req = (uid, data) => ({ auth: { uid, token: { email: uid + '@x.invalid' } }, data: data || {} });
const res = async (p) => { try { return { ok: true, r: await p }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; } };
const save = (uid, data) => res(T.scoped(Q.qtSave)(req(uid, data)));
const pdf = (uid, data) => res(QP.call.qtPdf()(req(uid, data)));
const send = (uid, data, deps) => res(QP.call.qtSend(deps)(req(uid, data)));
const has = (lines, s) => lines.some((l) => l.includes(s));
const rev = (s) => Array.from(s).reverse().join('');

function mocks() {
  const wa = [], mail = [];
  return {
    wa, mail,
    deps: {
      send: async (token, pnid, to, payload) => { wa.push({ pnid, to, payload }); return { wamid: 'wamid.Q' + wa.length }; },
      mail: { secrets: () => ({ user: 'shop@x.invalid', pass: 'dummy-pass-123' }), smtp: () => ({ host: 'smtp.example.com', port: '465', from: '' }),
        transport: () => ({ sendMail: async (m) => { mail.push(m); } }) },
    },
  };
}

async function seed(cfg) {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: 'ק', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: ALL,
      org: { v: 1, branches: [{ id: 'br1', name: 'סניף 1', on: true, sig: [] }, { id: 'br2', name: 'סניף 2', on: true, sig: [] }], banks: [], cards: [] } });
    b.set(d.doc(P('admins/' + MGR)), { email: 'm@x.invalid' });
    b.set(d.doc(P('staff/' + MGR)), { name: MGR, role: 'manager', active: true });
    b.set(d.doc(P('staff/' + E1)), { name: E1, role: 'employee', active: true, br: ['br1'] });
    b.set(d.doc(P('staff/' + E2)), { name: E2, role: 'employee', active: true, br: ['br2'] });
    b.set(d.doc(P('staff/' + NOORD)), { name: NOORD, role: 'employee', active: true, perms: NONE });
    for (const [u, role] of [[MGR, 'admin'], [E1, 'worker'], [E2, 'worker'], [NOORD, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(P('prod/pA')), { name: 'מגש עמוק', price: 89.9, barcode: '', on: true, q: { br1: 100, br2: 100 } });
    b.set(d.doc(P('prod/pB')), { name: 'כוס', price: 6.25, barcode: '', on: true, q: { br1: 100, br2: 100 } });
    b.set(d.doc(P('ordcfg/main')), { vat: 18 });
    b.set(d.doc(P('cust/' + WS)), { name: 'מסעדת הים', bn: 'מסעדת הים בע"מ', vat: '515555555', phone: '0541111111', mail: 'ws@x.invalid', wholesale: true, terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} });
    b.set(d.doc(P('sec_cfg/wa')), { pnid: '1000000099', num: '97230000009' });
    if (cfg !== false) b.set(d.doc(P('arcfg/main')), Object.assign({ on: true, name: 'לארג׳ פעמי בדיקה', bn: '512345678', addr: 'הרצל 1, אשדוד', phone: '08-1234567', mail: 'biz@x.invalid', foot: 'תודה' }, cfg || {}));
    await b.commit();
  });
}
// הצעה של עובד בסניף 1: לקוח פרטי (כולל מע"מ) או עסקי (לפני מע"מ, עם הנחה)
async function quote(uid, x) {
  const r = await save(uid || E1, Object.assign({ reqId: rid(), br: 'br1', cust: { name: 'דנה', phone: '050-1234567', mail: 'dana@x.invalid' }, items: [{ pid: 'pA', qty: 1, price: 89.9 }, { pid: 'pB', qty: 6, price: 6.25 }], days: 10 }, x || {}));
  assert.ok(r.ok, JSON.stringify(r));
  return r.r;
}
const wsQuote = () => quote(MGR, { custId: WS, cust: { name: 'מסעדת הים', phone: '0541111111' }, items: [{ pid: 'pA', qty: 3, price: 80 }, { pid: 'pB', qty: 12, price: 5.5 }], disc: 5 });

before(async () => {
  env = await H.getEnv();
  FN = require('../functions/index.js');
  QP = require('../functions/quotes-pdf.js')._core;
  Q = require('../functions/quotes.js')._core;
  AR = require('../functions/ar.js')._core;
  T = require('../functions/lib/tenant');
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });
beforeEach(() => seed());

describe('qtPdf – המסמך', () => {
  it('index.js מייצא qtPdf ו-qtSend; ar._core מייצא cfgOf, logoOf, custOf', () => {
    assert.equal(typeof FN.qtPdf, 'function'); assert.equal(typeof FN.qtSend, 'function');
    for (const k of ['cfgOf', 'logoOf', 'custOf']) assert.equal(typeof AR[k], 'function', k);
  });
  it('לקוח פרטי: כותרת "הצעת מחיר", מס׳ רץ, "בתוקף עד" = vu של ההצעה, לתשלום = gross; הקובץ נשמר פעם אחת (pf)', async () => {
    await quote(); const q = await quote(); // מספר 2
    assert.equal(q.no, 2);
    const r = await pdf(E1, { id: q.id });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.r.no, 2); assert.equal(r.r.name, 'הצעת מחיר 2.pdf'); assert.equal(r.r.vu, q.vu);
    const buf = Buffer.from(r.r.b64, 'base64');
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
    const [pg] = extract(buf);
    const [y, m, d] = q.vu.split('-');
    assert.ok(has(pg, rev('הצעת מחיר')), pg.join('\n'));
    assert.ok(has(pg, '2 ׳סמ'));
    assert.ok(has(pg, `${d}/${m}/${y} :דע ףקותב`), 'בתוקף עד – התאריך');
    // 89.90 + 6×6.25 = 127.40 (כולל מע"מ)
    assert.equal(q.gross, 127.4);
    assert.ok(pg.some((l) => l.startsWith('₪127.40') && l.endsWith(rev('לתשלום'))), 'לתשלום = gross');
    const doc = await get('qt/' + q.id);
    assert.equal(doc.pf, true); assert.equal(doc.f, 'qt_' + q.id);
    assert.equal(doc.st, 'open'); assert.equal(doc.gross, 127.4, 'ההצעה עצמה לא השתנתה');
    const r2 = await pdf(E1, { id: q.id });
    assert.equal(r2.r.b64, r.r.b64, 'פעם שנייה – אותו קובץ מ-Storage');
  });
  it('לקוח עסקי עם הנחה: לפני מע"מ, שם העסק ומספר עוסק, לתשלום = gross; gross שלא תואם → sum-mismatch', async () => {
    const q = await wsQuote();
    const [pg] = extract(Buffer.from((await pdf(MGR, { id: q.id })).r.b64, 'base64'));
    // 3×80 + 12×5.5 = 306; הנחה 5% = 15.30 → 290.70; מע"מ 52.33 (52.326); לתשלום 343.03
    assert.equal(q.gross, 343.03);
    assert.ok(pg.some((l) => l.startsWith('₪343.03') && l.endsWith(rev('לתשלום'))), pg.join('\n'));
    assert.ok(has(pg, '515555555') && has(pg, PDF.visual('מחיר ליח׳ (לפני מע״מ)')));
    const q2 = await wsQuote();
    await set('qt/' + q2.id, { gross: 343.04 }, true);
    assert.equal((await pdf(MGR, { id: q2.id })).reason, 'sum-mismatch');
  });
  it('בלי arcfg.on → ar-off (גם qtSend, בלי רישום מזהה בקשה); עובד מסניף אחר → foreign-br; בלי הרשאת ord → no-perm; הצעה לא קיימת → no-qt', async () => {
    const q = await quote();
    await set('arcfg/main', { on: false }, true);
    assert.equal((await pdf(E1, { id: q.id })).reason, 'ar-off');
    const k = rid();
    assert.equal((await send(E1, { id: q.id, reqId: k, ch: 'mail' }, mocks().deps)).reason, 'ar-off');
    assert.equal(await get('arcfg/req_' + k), null);
    await set('arcfg/main', { on: true }, true);
    assert.equal((await pdf(E2, { id: q.id })).reason, 'foreign-br');
    const mk = mocks();
    assert.equal((await send(E2, { id: q.id, reqId: rid(), ch: 'mail' }, mk.deps)).reason, 'foreign-br');
    assert.equal(mk.mail.length, 0);
    assert.equal((await pdf(NOORD, { id: q.id })).reason, 'no-perm');
    assert.equal((await pdf(E1, { id: 'qnope' })).reason, 'no-qt');
    assert.equal((await pdf(E1, { id: q.id, x: 1 })).ok, false);
    assert.ok((await pdf(MGR, { id: q.id })).ok, 'מנהל – כל הסניפים');
  });
  it('אין arcfg בכלל → ar-off', async () => {
    await seed(false);
    const q = await quote();
    assert.equal((await pdf(E1, { id: q.id })).reason, 'ar-off');
  });
});

describe('qtSend – שליחה', () => {
  it('מייל (ספק מדומה): קובץ PDF מצורף, נושא ושם קובץ "הצעת מחיר N", בגוף "בתוקף עד"; נרשם ב-sent וביומן', async () => {
    const q = await quote();
    const mk = mocks();
    const r = await send(E1, { id: q.id, reqId: rid(), ch: 'mail' }, mk.deps);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.r.sent.length, 1); assert.equal(r.r.sent[0].ok, true, JSON.stringify(r.r)); assert.equal(r.r.sent[0].to, 'dana@x.invalid');
    assert.equal(mk.mail.length, 1);
    const m = mk.mail[0];
    assert.equal(m.to, 'dana@x.invalid');
    assert.equal(m.attachments.length, 1); assert.equal(m.attachments[0].filename, 'הצעת מחיר 1.pdf'); assert.equal(m.attachments[0].contentType, 'application/pdf');
    assert.equal(m.attachments[0].content.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(m.subject, /^הצעת מחיר 1/);
    const [y, mo, d] = q.vu.split('-');
    assert.ok(m.text.includes(`בתוקף עד ${d}/${mo}/${y}`) && m.text.includes('₪127.40'), m.text);
    assert.equal(m.replyTo, 'biz@x.invalid');
    const doc = await get('qt/' + q.id);
    assert.equal(doc.sent.length, 1); assert.equal(doc.sent[0].ch, 'mail'); assert.equal(doc.sent[0].by, E1); assert.equal(doc.sent[0].auto, false);
    assert.equal(doc.st, 'open'); assert.equal(doc.gross, q.gross);
    const log = (await coll(`qt/${q.id}/log`)).filter((x) => x.act === 'send');
    assert.equal(log.length, 1);
    // כתובת אחרת בקלט
    const r2 = await send(E1, { id: q.id, reqId: rid(), ch: 'mail', to: 'other@x.invalid' }, mk.deps);
    assert.equal(r2.r.sent[0].to, 'other@x.invalid'); assert.equal(mk.mail.length, 2);
  });
  it('מזהה בקשה חוזר – לא שולח פעמיים: ברצף ו-5 קריאות במקביל → מייל אחד', async () => {
    const q = await quote();
    const mk = mocks();
    const k = rid();
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => send(E1, { id: q.id, reqId: k, ch: 'mail' }, mk.deps)));
    for (const r of rs) assert.ok(r.ok, JSON.stringify(r));
    assert.equal(mk.mail.length, 1, 'במקביל – מייל אחד');
    assert.equal(rs.filter((r) => !r.r.dup).length, 1);
    const again = await send(E1, { id: q.id, reqId: k, ch: 'mail' }, mk.deps);
    assert.equal(again.r.dup, true); assert.equal(again.r.sent.length, 1); assert.equal(again.r.sent[0].ok, true, 'מחזיר את התוצאה הקודמת');
    assert.equal(mk.mail.length, 1, 'ברצף – לא נשלח שוב');
    assert.equal((await get('qt/' + q.id)).sent.length, 1);
    // אותו מזהה בקשה להצעה אחרת – נדחה ולא נשלח
    const q2 = await quote();
    assert.equal((await send(E1, { id: q2.id, reqId: k, ch: 'mail' }, mk.deps)).reason, 'bad-req');
    assert.equal(mk.mail.length, 1);
  });
  it('ווטסאפ בלי תבנית qt → no-tpl (גם כשיש תבנית oc); עם תבנית – נשלח (מדומה) עם קישור והתאריך; reqId חוזר לא שולח שוב', async () => {
    await set('arcfg/main', { wt: { oc: 'order_doc' } }, true);
    const q = await quote();
    const mk = mocks();
    const r = await send(E1, { id: q.id, reqId: rid(), ch: 'wa' }, mk.deps);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.r.sent[0].ok, false); assert.equal(r.r.sent[0].why, 'no-tpl');
    assert.equal(mk.wa.length, 0);
    // המנהל שומר תבנית qt דרך setArCfg (WT_KEYS כולל 'qt'); oc נשמרת
    await FN.setArCfg.run(req(MGR, { wt: { oc: 'order_doc', qt: 'quote_doc' } }));
    const c = await get('arcfg/main');
    assert.deepEqual([c.wt.oc, c.wt.qt], ['order_doc', 'quote_doc']);
    const k = rid();
    const r2 = await send(E1, { id: q.id, reqId: k, ch: 'wa' }, mk.deps);
    assert.equal(r2.r.sent[0].ok, true, JSON.stringify(r2.r));
    assert.equal(mk.wa.length, 1);
    const [y, mo, d] = q.vu.split('-');
    const tp = mk.wa[0].payload.tpl;
    assert.equal(tp.name, 'quote_doc');
    assert.deepEqual(tp.params, ['דנה', '1', '₪127.40', `${d}/${mo}/${y}`]);
    assert.equal(tp.doc.filename, 'הצעת מחיר 1.pdf'); assert.match(tp.doc.link, /arFile\?t=/);
    assert.equal(mk.wa[0].to, '972501234567');
    assert.equal((await send(E1, { id: q.id, reqId: k, ch: 'wa' }, mk.deps)).r.dup, true);
    assert.equal(mk.wa.length, 1);
  });
  it('מייל בלי ספק מוגדר (בלי deps) → no-secrets, לא נשלח ולא נזרקת שגיאה; בלי כתובת → no-to', async () => {
    const q = await quote();
    const r = await send(E1, { id: q.id, reqId: rid(), ch: 'mail' });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.r.sent[0].ok, false); assert.equal(r.r.sent[0].why, 'no-secrets');
    const q2 = await quote(E1, { cust: { name: 'בלי מייל', phone: '050-7654321' } });
    const mk = mocks();
    const r2 = await send(E1, { id: q2.id, reqId: rid(), ch: 'mail' }, mk.deps);
    assert.equal(r2.r.sent[0].why, 'no-to'); assert.equal(mk.mail.length, 0);
  });
  it('ולידציה: ערוץ לא מוכר → bad-ch; בלי reqId → נדחה; הצעה שבוטלה → qt-closed (וה-PDF עדיין נפתח)', async () => {
    const q = await quote();
    const mk = mocks();
    assert.equal((await send(E1, { id: q.id, reqId: rid(), ch: 'sms' }, mk.deps)).reason, 'bad-ch');
    assert.equal((await send(E1, { id: q.id, ch: 'mail' }, mk.deps)).ok, false);
    assert.ok((await res(T.scoped(Q.qtSet)(req(E1, { id: q.id, act: 'cancel' })))).ok);
    assert.equal((await send(E1, { id: q.id, reqId: rid(), ch: 'mail' }, mk.deps)).reason, 'qt-closed');
    assert.equal(mk.mail.length, 0);
    assert.ok((await pdf(E1, { id: q.id })).ok);
  });
});
