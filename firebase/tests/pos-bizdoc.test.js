'use strict';
// קופה גל 3 (19.11.2026): מסמך ללקוח עסקי בסוף מכירה – שליחה אוטומטית מהשרת (posSaleSend → autoSend), "שלח שוב" (posDoc op:'send'),
// קובץ PDF להדפסת A4 (posDoc op:'pdf'), בחירת הערוץ לפי כרטיס הלקוח, ותאימות לכרטיס בלי snd. הפונקציות רצות בתוך תהליך הבדיקה.
// אין שום שליחה אמיתית: וואטסאפ – פונקציית שליחה מדומה (deps.send) או בלי מספר עסקי (no-wa); מייל – transport מדומה (deps.mail) או בלי סודות.
process.env.FUNCTIONS_EMULATOR = 'true';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const A = 'biz-posbd';
const SUPER = 'pbd_super', CASH = 'pbd_cash', CASH2 = 'pbd_cash2', MGR = 'pbd_mgr';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };
const W = (o) => Object.assign({}, NONE, o);
const INST1 = 'inst_aaaaaaaaaaaaaaaa';

let env, S, DOC, T;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const P = (p) => `b/${A}/${p}`;
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(P(p)).get(); v = s.exists ? s.data() : null; }); return v; }
async function set(p, o, merge) { await prep(async (d) => d.doc(P(p)).set(o, merge ? { merge: true } : {})); }
const req = (uid, data) => ({ auth: { uid, token: { email: uid + '@x.invalid' } }, data: data || {} });
async function call(fn, uid, data) {
  const C = fn === 'posDoc' ? DOC : S;
  try { return { ok: true, r: await C.call[fn]()(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; }
}
let rq = 0;
const reqId = () => 'rq' + String(++rq).padStart(8, '0') + 'b';
const L = (o) => Object.assign({ pid: 'p1', n: 'מגש', qty: 2, unit: 5000 }, o || {});
async function sell(uid, o) {
  const r = await call('posSale', uid, Object.assign({ reqId: reqId(), dev: 'K1', inst: INST1, soldAt: Date.now() - 1000, lines: [L()], pays: [{ m: 'cash', amt: 10000 }] }, o || {}));
  if (!r.ok) throw new Error('sale failed: ' + r.reason + ' ' + r.msg);
  return r.r;
}
const inBiz = (fn) => T.runInBiz({ bizId: A, prefix: `b/${A}/` }, fn);
// שליחה מדומה: וואטסאפ ומייל
function mocks() {
  const wa = [], mail = [];
  return {
    wa, mail,
    deps: {
      send: async (token, pnid, to, payload) => { wa.push({ pnid, to, payload }); return { wamid: 'wamid.T' + wa.length }; },
      mail: { secrets: () => ({ user: 'shop@x.invalid', pass: 'dummy-pass-123' }), smtp: () => ({ host: 'smtp.example.com', port: '465', from: '' }),
        transport: () => ({ sendMail: async (m) => { mail.push(m); } }) },
    },
  };
}

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('b/' + A), { name: A, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { orders: true, pos: true } });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid', perms: { pos: true, posMgr: true } });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'מנהל', role: 'manager', active: true });
    b.set(d.doc(`b/${A}/staff/${CASH}`), { name: 'קופאית', role: 'employee', active: true, perms: W({ pos: true }) });
    b.set(d.doc(`b/${A}/staff/${CASH2}`), { name: 'קופאי', role: 'employee', active: true, perms: W({ pos: true }) });
    for (const [u, role] of [[MGR, 'admin'], [CASH, 'worker'], [CASH2, 'worker']]) b.set(d.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    b.set(d.doc(P('poscfg/main')), { type: 'general', v: {} });
    b.set(d.doc(P('posdev/K1')), { name: 'קופה 1', code: 'K1', br: 'b1', on: true, st: 'active', inst: INST1, lastSeq: 0, at: 1, appr: { by: 'seed', at: 1 } });
    b.set(d.doc(P('prod/p1')), { name: 'מגש', price: 50, q: { b1: 100 }, cat: 'c1' });
    b.set(d.doc(P('arcfg/main')), { on: true, name: 'חנות בדיקה', bn: '512345678', mail: 'biz@x.invalid', wt: { inv: 'pos_inv', rc: 'pos_rc' } });
    b.set(d.doc(P('sec_cfg/wa')), { pnid: '1000000099', num: '97230000009' });
    // כרטיסים: עסקי עם וואטסאפ / עסקי עם שניהם / עסקי בלי הגדרה / עסקי רק A4 / פרטי עם ערוץ (לא חל בקופה) / עסקי בלי טלפון
    const biz = { bn: 'חברה בע"מ', vat: '123456789', wholesale: true, lim: 100000 };
    b.set(d.doc(P('cust/cWa')), Object.assign({ name: 'א', phone: '0541111111', mail: 'a@x.invalid', snd: { ch: 'wa', oc: false, inv: false, rc: false } }, biz));
    b.set(d.doc(P('cust/cBoth')), Object.assign({ name: 'ב', phone: '0542222222', mail: 'b@x.invalid', snd: { ch: 'both', oc: false, inv: false, rc: false } }, biz));
    b.set(d.doc(P('cust/cNone')), Object.assign({ name: 'ג', phone: '0543333333', mail: 'c@x.invalid' }, biz));
    b.set(d.doc(P('cust/cA4')), Object.assign({ name: 'ד', phone: '0544444444', snd: { oc: false, inv: false, rc: false, a4: true } }, biz));
    b.set(d.doc(P('cust/cPriv')), { name: 'פרטי', phone: '0545555555', snd: { ch: 'wa', oc: true, inv: true, rc: true } });
    b.set(d.doc(P('cust/cNoPh')), Object.assign({ name: 'ה', snd: { ch: 'wa', oc: false, inv: false, rc: false } }, biz));
    await b.commit();
  });
}

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  S = require('../functions/pos-sale.js')._core;
  DOC = require('../functions/pos-doc.js')._core;
  T = require('../functions/lib/tenant');
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('בחירת הערוץ לפי כרטיס הלקוח (טהור)', () => {
  it('לקוח עסקי עם snd.ch – הערוץ; both – שניהם; בלי snd / רק a4 / ערוץ לא מוכר – בלי שליחה; לקוח פרטי – אף פעם', () => {
    assert.deepEqual(DOC.autoChs({ wholesale: true, snd: { ch: 'wa' } }), ['wa']);
    assert.deepEqual(DOC.autoChs({ wholesale: true, snd: { ch: 'mail' } }), ['mail']);
    assert.deepEqual(DOC.autoChs({ wholesale: true, snd: { ch: 'both', oc: false } }), ['wa', 'mail']);
    assert.deepEqual(DOC.autoChs({ wholesale: true }), []);
    assert.deepEqual(DOC.autoChs({ wholesale: true, snd: { a4: true } }), []);
    assert.deepEqual(DOC.autoChs({ wholesale: true, snd: { ch: 'fax' } }), []);
    assert.deepEqual(DOC.autoChs({ snd: { ch: 'both' } }), []);
    assert.deepEqual(DOC.autoChs(null), []);
    assert.deepEqual(DOC.chsOf('both'), ['wa', 'mail']);
    assert.deepEqual(DOC.chsOf('mail', { ch: 'wa' }), ['mail']); // בחירה בלחיצה גוברת על הכרטיס
  });
});

describe('שליחה אוטומטית מהשרת אחרי המכירה (autoSend – הטריגר posSaleSend)', () => {
  beforeEach(seed);

  it('עסקי + וואטסאפ: נשלח פעם אחת עם תבנית וקישור, נרשם ב-possale.sent וב-ardoc.sent; אירוע כפול – לא נשלח שוב', async () => {
    const s = await sell(CASH, { cust: 'cWa' });
    assert.deepEqual(s.docs.map((x) => x.t), ['inv', 'rc']);
    const M = mocks();
    const r = await inBiz(() => DOC.autoSend(A, s.id, M.deps));
    assert.equal(r.sent.length, 2); assert.ok(r.sent.every((x) => x.ok && x.ch === 'wa' && x.auto === true));
    assert.equal(M.wa.length, 2); assert.equal(M.mail.length, 0);
    assert.equal(M.wa[0].payload.tpl.name, 'pos_inv'); assert.equal(M.wa[1].payload.tpl.name, 'pos_rc');
    assert.match(M.wa[0].payload.tpl.doc.link, /arFile\?t=/);
    const sale = await get('possale/' + s.id);
    assert.equal(sale.sent.length, 2); assert.ok(sale.autoSnd > 0); assert.equal(sale.sent[0].doc, s.docs[0].id);
    assert.equal((await get('ardoc/' + s.docs[0].id)).sent.length, 1);
    const again = await inBiz(() => DOC.autoSend(A, s.id, M.deps));
    assert.equal(again.skip, 'dup'); assert.equal(M.wa.length, 2);
  });

  it('עסקי + שניהם: וואטסאפ ומייל (transport מדומה) עם PDF מצורף', async () => {
    const s = await sell(CASH, { cust: 'cBoth', lines: [L({ qty: 1 })], pays: [{ m: 'cash', amt: 5000 }] });
    const M = mocks();
    const r = await inBiz(() => DOC.autoSend(A, s.id, M.deps));
    assert.ok(r.sent.length >= 2 && r.sent.every((x) => x.ok), JSON.stringify(r.sent));
    assert.ok(M.mail.length >= 1); assert.equal(M.mail[0].to, 'b@x.invalid');
    assert.equal(M.mail[0].attachments[0].content.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  it('תאימות: עסקי בלי snd / רק A4 / לקוח פרטי עם ערוץ / בלי לקוח – לא נשלח כלום (כמו היום)', async () => {
    const M = mocks();
    for (const c of ['cNone', 'cA4', 'cPriv']) {
      const s = await sell(CASH, { cust: c });
      const r = await inBiz(() => DOC.autoSend(A, s.id, M.deps));
      assert.equal(r.skip, 'no-snd', c);
      assert.equal((await get('possale/' + s.id)).sent, undefined);
    }
    const s0 = await sell(CASH);
    assert.equal((await inBiz(() => DOC.autoSend(A, s0.id, M.deps))).skip, 'no-doc');
    assert.equal(M.wa.length + M.mail.length, 0);
  });

  it('"עצור הכל" עוצר שליחה אוטומטית ונרשם stopped; אין טלפון בכרטיס – no-to; המכירה עצמה לא נפגעת', async () => {
    await set('sec_cfg/wa', { stop: { on: true } }, true);
    const s = await sell(CASH, { cust: 'cWa' });
    const M = mocks();
    const r = await inBiz(() => DOC.autoSend(A, s.id, M.deps));
    assert.ok(r.sent.length && r.sent.every((x) => !x.ok && x.why === 'stopped'));
    assert.equal(M.wa.length, 0);
    const s2 = await sell(CASH, { cust: 'cNoPh' });
    const r2 = await inBiz(() => DOC.autoSend(A, s2.id, M.deps));
    assert.ok(r2.sent.every((x) => x.why === 'no-to'));
    assert.equal((await get('possale/' + s2.id)).st, 'ok');
  });
});

describe('posDoc: "שלח שוב" (send) ו-PDF ל-A4 (pdf)', () => {
  beforeEach(seed);

  it('send בלחיצה: ערוץ לא תקין – bad-ch; קופאי אחר – not-pos; בלי מספר וואטסאפ – נרשם no-wa; בלי סודות מייל – no-secrets', async () => {
    const s = await sell(CASH, { cust: 'cNone' });
    assert.equal((await call('posDoc', CASH, { op: 'send', sale: s.id, ch: 'fax' })).reason, 'bad-ch');
    assert.equal((await call('posDoc', CASH, { op: 'send', sale: s.id })).reason, 'bad-ch');
    assert.equal((await call('posDoc', CASH2, { op: 'send', sale: s.id, ch: 'wa' })).reason, 'not-pos');
    await set('sec_cfg/wa', { pnid: null }, true);
    const r = await call('posDoc', CASH, { op: 'send', sale: s.id, ch: 'both' });
    assert.equal(r.ok, true, r.msg);
    const why = r.r.sent.map((x) => x.ch + ':' + x.why).sort();
    assert.ok(why.includes('wa:no-wa') && why.includes('mail:no-secrets'), why.join(','));
    assert.ok(r.r.sent.every((x) => x.auto === false));
    const sale = await get('possale/' + s.id);
    assert.equal(sale.sent.length, r.r.sent.length); assert.equal(sale.autoSnd, undefined);
    // מנהל עם קופה – גם מכירה של קופאי אחר
    assert.equal((await call('posDoc', MGR, { op: 'send', sale: s.id, ch: 'wa' })).ok, true);
  });

  it('send ללקוח בלי טלפון – no-to (הודעה ברורה בקופה); מכירה שעדיין בלי מסמך – no-doc', async () => {
    const s = await sell(CASH, { cust: 'cNoPh' });
    const r = await call('posDoc', CASH, { op: 'send', sale: s.id, ch: 'wa' });
    assert.equal(r.r.sent[0].why, 'no-to');
    await set('possale/' + s.id, { docs: [] }, true);
    assert.equal((await call('posDoc', CASH, { op: 'send', sale: s.id, ch: 'wa' })).reason, 'no-doc');
    assert.equal((await call('posDoc', CASH, { op: 'pdf', sale: s.id })).reason, 'no-doc');
  });

  it('pdf: קובץ לכל מסמך (חשבונית + קבלה), כולל הנחה בשורה והקפה חלקית', async () => {
    const s = await sell(MGR, { cust: 'cNone', lines: [L({ qty: 3, mdisc: { amt: 1000, why: 'לקוח קבוע' } })], pays: [{ m: 'cash', amt: 10000 }], debt: 4000 });
    const r = await call('posDoc', MGR, { op: 'pdf', sale: s.id });
    assert.equal(r.ok, true, r.msg);
    assert.deepEqual(r.r.files.map((f) => f.t), ['inv', 'rc']);
    for (const f of r.r.files) assert.equal(Buffer.from(f.b64, 'base64').subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(r.r.files[0].name, /^חשבונית מס/);
  });
});
