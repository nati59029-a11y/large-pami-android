'use strict';
// קופה ש6 (POS:M6, 17.11.2026): pos-catalog.js, pos-inv.js, pos-ocr.js מול האמולטור. חלק מ-test:multibiz:3. נתונים מומצאים (דוגמה).
//   קטלוג: מוצר חדש (חובה מלאה, מק"ט רץ, ברקוד פנימי, אינדקס posbc, היסטוריית מחיר), ברקוד של מוצר אחר נדחה (א 5.2), עריכה,
//          הוספה מהירה מהקופה (reqId, fromPos, התראה, ברקוד קיים = אותו מוצר), ברקודים פנימיים, שינוי מחירים קבוצתי, תור מדבקות.
//   ספירה (א 5.13): המלאי לא משתנה עד אישור מנהל; אחרי אישור – תנועת cnt לכל פער; אחראי משמרת סופר, עובד בלי posMgr – לא.
//   מחירון מצילום (ו 5.15): מחזיר שורות ולא יוצר מוצר. הרשאות: עובד, מתג כבוי.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-pos6', B = 'biz-nopos6';
const MGR = 'c6_mgr', M2 = 'c6_m2', CASH = 'c6_cash', LEAD = 'c6_lead', E1 = 'c6_e1';
const FN = path.join(H.ROOT, 'functions');
const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text: String(text).slice(0, 300) };
}
const ok = (r) => { assert.equal(r.status, 'OK', r.text); return r.result; };
const rid = () => 'r' + crypto.randomBytes(8).toString('hex');
let env, adm;
const P = (p) => `b/${A}/${p}`;
const doc = async (p) => { const s = await adm().doc(P(p)).get(); return s.exists ? s.data() : null; };

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const b = d.batch();
    const F = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
    for (const [biz, m, pos] of [[A, MGR, true], [B, M2, false]]) {
      b.set(d.doc('b/' + biz), { name: biz, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: Object.assign({ pos }, F) });
      b.set(d.doc(`b/${biz}/admins/${m}`), { email: m + '@x.invalid' });
      b.set(d.doc(`b/${biz}/staff/${m}`), { name: m, role: 'manager', active: true });
      b.set(d.doc('users/' + m), { bizId: biz, role: 'admin', active: true, bizStatus: 'active', email: m + '@x.invalid', createdAt: 1 });
    }
    const emp = (uid, perms) => {
      b.set(d.doc(`b/${A}/staff/${uid}`), Object.assign({ name: uid, role: 'employee', active: true }, perms ? { perms } : {}));
      b.set(d.doc('users/' + uid), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: uid + '@x.invalid', createdAt: 1 });
    };
    const base = { incR: false, incW: true, expR: true, expW: true, sup: true, sal: false, rep: false, ord: true, trf: false, bal: false, ordP: false, prc: false, s3m: false };
    emp(CASH, Object.assign({}, base, { pos: true })); emp(LEAD, Object.assign({}, base, { posMgr: true })); emp(E1, base);
    b.set(d.doc(P('cat/c_bake')), { name: 'מאפים', ord: 0 });
    b.set(d.doc(P('prod/old1')), { name: 'צלחות ותיקות (דוגמה)', price: 12.9, barcode: '5901234123457', on: true, q: { _: 5 }, at: 1, by: 'x' });
    b.set(d.doc(P('prod/old2')), { name: 'כוסות (דוגמה)', price: 9.9, barcode: '4006381333931', bcs: ['7290000001029'], on: true, q: { _: 2 }, cat: 'c_bake', at: 1, by: 'x' });
    await b.commit();
  });
}

describe('קופה ש6 – קטלוג, ספירה ומחירון (pos-catalog / pos-inv / pos-ocr)', () => {
  before(async () => {
    env = await H.getEnv();
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
    require('../functions/index.js');
    adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
    await GM.start();
    await seed();
  });
  after(async () => { await GM.stop(); if (env) await env.cleanup(); });

  it('הרשאות: עובד בלי הרשאה – לא; מנהל בעסק שהקופה כבויה – feature-off', async () => {
    const r1 = await call('posProdSave', E1, { name: 'א', price: 1, cat: 'c_bake', cost: 1 });
    assert.equal(r1.reason, 'not-manager');
    assert.equal((await call('posCnt', E1, { op: 'list' })).reason, 'not-lead');
    assert.equal((await call('posProdQuick', E1, { reqId: rid(), bc: '96385074', name: 'א', price: 1 })).reason, 'not-pos');
    assert.equal((await call('posProdSave', M2, { name: 'א', price: 1 })).reason, 'feature-off');
    assert.equal((await call('posOcr', CASH, { mime: 'image/jpeg', b64: 'A'.repeat(200) })).reason, 'not-manager');
  });

  it('מוצר חדש: חובה – קטגוריה ועלות; מק"ט רץ, ברקוד פנימי, אינדקס, היסטוריה, בלי דגלים', async () => {
    assert.equal((await call('posProdSave', MGR, { name: 'חדש', price: 5 })).reason, 'bad-cat');
    assert.equal((await call('posProdSave', MGR, { name: 'חדש', price: 5, cat: 'c_bake' })).reason, 'bad-cost');
    const r = ok(await call('posProdSave', MGR, { name: 'חלה מתוקה (דוגמה)', price: 14.9, cat: 'c_bake', cost: 6, autoBc: true }));
    assert.match(r.sku, /^1\d{4}$/);
    assert.match(r.barcode, /^200\d{10}$/);
    assert.deepEqual(r.flags, []);
    const p = await doc('prod/' + r.id);
    assert.equal(p.price, 14.9); assert.equal(p.on, true); assert.equal(p.src, 'admin'); assert.deepEqual(p.q, {});
    assert.equal((await doc('posbc/' + r.barcode)).pid, r.id);
    assert.equal((await doc(`prod/${r.id}/p/cost`)).cost, 6);
    const ph = (await adm().collection(P(`prod/${r.id}/ph`)).get()).docs.map((d) => d.data());
    assert.equal(ph.length, 1); assert.equal(ph[0].new, 1490);
  });

  it('ברקוד ייחודי (P19, א 5.2): ראשי / נוסף של מוצר אחר – נדחה; ספרת ביקורת שגויה – נדחה', async () => {
    assert.equal((await call('posProdSave', MGR, { name: 'כפול', price: 1, cat: 'c_bake', cost: 1, barcode: '5901234123457' })).reason, 'bc-taken');
    assert.equal((await call('posProdSave', MGR, { name: 'כפול', price: 1, cat: 'c_bake', cost: 1, bcs: ['7290000001029'] })).reason, 'bc-taken');
    assert.equal((await call('posProdSave', MGR, { name: 'כפול', price: 1, cat: 'c_bake', cost: 1, barcode: '5901234123458' })).reason, 'bad-barcode');
  });

  it('עריכת מוצר קיים: שינוי מחיר נרשם בהיסטוריה (אגורות), דגלים מחושבים, שדות קיימים נשמרים', async () => {
    const r = ok(await call('posProdSave', MGR, { id: 'old1', name: 'צלחות ותיקות (דוגמה)', price: 13.9, cat: 'c_bake', cost: 7.5 }));
    assert.equal(r.priceChanged, true);
    const p = await doc('prod/old1');
    assert.equal(p.price, 13.9); assert.deepEqual(p.q, { _: 5 }); assert.equal(p.barcode, '5901234123457'); assert.ok(p.sku);
    const ph = (await adm().collection(P('prod/old1/ph')).get()).docs.map((d) => d.data());
    assert.deepEqual(ph.map((x) => [x.old, x.new, x.why]), [[1290, 1390, 'edit']]);
    assert.equal((await doc('posbc/5901234123457')).pid, 'old1');
  });

  it('הוספה מהירה מהקופה (B5, א 5.7): קופאי יוצר; fromPos + missing; התראה למנהל; אותו reqId – אותה תוצאה; ברקוד קיים – המוצר הקיים', async () => {
    const req = rid();
    const r = ok(await call('posProdQuick', CASH, { reqId: req, bc: '96385074', name: 'מוצר מהקופה (דוגמה)', price: 4.5 }));
    assert.equal(r.created, true);
    const p = await doc('prod/' + r.id);
    assert.deepEqual(p.flags, ['fromPos', 'missing']); assert.equal(p.src, 'pos'); assert.equal(p.barcode, '96385074');
    const again = ok(await call('posProdQuick', CASH, { reqId: req, bc: '96385074', name: 'מוצר מהקופה (דוגמה)', price: 4.5 }));
    assert.equal(again.again, true); assert.equal(again.id, r.id);
    const dup = ok(await call('posProdQuick', CASH, { reqId: rid(), bc: '4006381333931', name: 'אחר', price: 1 }));
    assert.equal(dup.dup, true); assert.equal(dup.id, 'old2');
    const al = ok(await call('posAlert', MGR, { op: 'list' }));
    assert.equal(al.items.filter((x) => x.pid === r.id).length, 1);
    ok(await call('posAlert', MGR, { op: 'close', id: al.items[0].id }));
    assert.equal(ok(await call('posAlert', MGR, { op: 'list' })).items.length, 0);
  });

  it('ברקודים פנימיים: 5 פנויים, תקינים, לא חוזרים', async () => {
    const a = ok(await call('posBcGen', MGR, { n: 5 })).codes, b = ok(await call('posBcGen', MGR, { n: 5 })).codes;
    const BC = require('../functions/lib/pos-barcode');
    assert.equal(new Set(a.concat(b)).size, 10);
    assert.ok(a.concat(b).every((c) => BC.check(c).ok && c.startsWith('200')));
  });

  it('שינוי מחירים קבוצתי (P22): תצוגה מקדימה לא משנה; אישור משנה ורושם היסטוריה', async () => {
    const pv = ok(await call('posPriceBulk', MGR, { cat: 'c_bake', mode: 'pct', val: 10, dry: true }));
    assert.ok(pv.n >= 2);
    assert.equal((await doc('prod/old2')).price, 9.9);
    const ap = ok(await call('posPriceBulk', MGR, { pids: ['old2'], mode: 'add', val: 1, dry: false }));
    assert.equal(ap.n, 1);
    assert.equal((await doc('prod/old2')).price, 10.9);
    const ph = (await adm().collection(P('prod/old2/ph')).get()).docs.map((d) => d.data());
    assert.deepEqual(ph.map((x) => [x.old, x.new, x.why]), [[990, 1090, 'bulk']]);
  });

  it('תור מדבקות: אחראי משמרת מוסיף, רואה עם שם ומחיר, מסמן "הודפס"', async () => {
    ok(await call('posLbl', LEAD, { op: 'add', why: 'price', items: [{ pid: 'old2', n: 3 }] }));
    const L = ok(await call('posLbl', LEAD, { op: 'list' })).items;
    const it2 = L.find((x) => x.pid === 'old2');
    assert.equal(it2.n, 3); assert.equal(it2.price, 10.9); assert.equal(it2.barcode, '4006381333931');
    ok(await call('posLbl', LEAD, { op: 'done', ids: [it2.id] }));
    assert.equal(ok(await call('posLbl', LEAD, { op: 'list' })).items.filter((x) => x.id === it2.id).length, 0);
    assert.equal((await call('posLbl', CASH, { op: 'list' })).reason, 'not-lead');
  });

  it('ספירת מלאי (א 5.13): המלאי לא משתנה עד אישור מנהל; אחרי אישור – תנועת cnt לכל פער בלבד', async () => {
    const o = ok(await call('posCnt', LEAD, { op: 'open', scope: 'cat', cat: 'c_bake', name: 'ספירת מאפים' }));
    ok(await call('posCnt', LEAD, { op: 'add', id: o.id, items: [{ pid: 'old2', n: 1 }, { pid: 'old2', n: 1 }, { pid: 'old2', n: 1 }] }));
    ok(await call('posCnt', LEAD, { op: 'add', id: o.id, items: [{ pid: 'old1', n: 5, set: true }] })); // old1 עכשיו גם בקטגוריה – ספירה = המלאי (בלי פער)
    assert.equal((await doc('prod/old2')).q._, 2, 'לפני האישור – בלי שינוי');
    ok(await call('posCnt', LEAD, { op: 'submit', id: o.id }));
    assert.equal((await call('posCnt', LEAD, { op: 'add', id: o.id, items: [{ pid: 'old2', n: 1 }] })).reason, 'cnt-closed');
    assert.equal((await call('posCnt', LEAD, { op: 'approve', id: o.id })).reason, 'not-manager');
    let left = 1, k = 0; while (left && k++ < 10) left = ok(await call('posCnt', MGR, { op: 'approve', id: o.id })).left;
    assert.equal((await doc('prod/old2')).q._, 3);
    assert.equal((await doc('prod/old1')).q._, 5);
    const logs = (await adm().collection(P('stockLog')).where('ref', '==', o.id).get()).docs.map((d) => d.data());
    assert.deepEqual(logs.map((x) => [x.prod, x.delta, x.why]), [['old2', 1, 'cnt']]);
    const g = ok(await call('posCnt', MGR, { op: 'get', id: o.id }));
    assert.equal(g.cnt.st, 'done'); assert.equal(g.cnt.diffs, 1);
  });

  it('מחירון מצילום (ו 5.15): שורות לתצוגה מקדימה, שום מוצר לא נוצר', async () => {
    const before = (await adm().collection(P('prod')).get()).size;
    const r = ok(await call('posOcr', MGR, { mime: 'image/jpeg', b64: Buffer.from('fake-image-'.repeat(20)).toString('base64') }));
    assert.equal(r.n, 3);
    assert.deepEqual(r.rows[2], { name: 'מפיות (דוגמה)', price: null, bc: '' });
    assert.equal((await adm().collection(P('prod')).get()).size, before);
  });
});
