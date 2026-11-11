'use strict';
// ייבוא ברקע (משימה 2026-11-11, שלב 3): functions/imports.js + חוקי impJobs. רץ מול האמולטור, חלק מ-test:multibiz.
//   - 916 לקוחות מדומים (tests/import-gen.js): נשלחים, ומשם השרת לבד (הטריגר באמולטור) – בלי שום קריאה נוספת מה"טלפון".
//   - ייבוא חוזר: 0 חדשים, אין כרטיס כפול. השוואה מלאה לייבוא הישן (importCusts/importProducts) על אותו קובץ, בעסק אחר.
//   - כשל מדומה באמצע (פעם אחת) → ניסיון חוזר → המונים לא נספרים פעמיים.
//   - אין ספרות כרטיס / CVV גלויים במסמכי impJobs, בחלקים ובתוצאות השורות, ולא ביומנים של הקוד שרץ בתהליך הבדיקה.
//   - הרשאות: עובד ומנהל של עסק אחר – לא יוצרים, לא קוראים, לא "נסה שוב". אף אחד לא קורא את החלקים.
// הערה: האמולטור לא מריץ ניסיונות חוזרים של טריגר. את "הניסיון החוזר" מריצים ישירות (processChunk) מתהליך הבדיקה – אותו קוד בדיוק.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');
const G = require('./import-gen');

const A = 'biz-o', B = 'biz-p';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'i_mgr', M2 = 'i_m2', E1 = 'i_e1', NOORD = 'i_no', LM = 'i_lm', LE = 'i_le';
const FN = path.join(H.ROOT, 'functions');
const FN_EMU = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
const KEY = (/^CARD_ENC_KEY=(.+)$/m.exec(fs.readFileSync(path.join(FN, '.secret.local'), 'utf8')) || [])[1];
const short = (t) => String(t == null ? '' : t).replace(/\d{8,}/g, '#').slice(0, 300); // לעולם לא מדפיסים רצף ספרות ארוך
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jid = () => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; return Array.from(crypto.randomBytes(20), (b) => a[b % a.length]).join(''); };
let n = 0; const rid = () => 'req' + Date.now().toString(36) + (n++) + 'xx';
let env, I, CARD, adm, logs;
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const b = d.batch();
    const org = { v: 1, branches: [{ id: 'br1', name: 'נחל לכיש', on: true, sig: [] }, { id: 'br2', name: 'יהודה הנשיא', on: true, sig: [] }], banks: [], cards: [] };
    for (const [biz, m] of [[A, MGR], [B, M2]]) {
      b.set(d.doc('b/' + biz), { name: biz, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: ALL, org });
      b.set(d.doc(`b/${biz}/admins/${m}`), { email: m + '@x.invalid' });
      b.set(d.doc(`b/${biz}/staff/${m}`), { name: m, role: 'manager', active: true });
      b.set(d.doc('users/' + m), { bizId: biz, role: 'admin', active: true, bizStatus: 'active', email: m + '@x.invalid', createdAt: 1 });
      b.set(d.doc(`b/${biz}/custcfg/main`), { xKeys: [{ k: 'xcity', label: 'עיר' }] });
    }
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true });
    b.set(d.doc('users/' + E1), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: E1 + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/staff/${NOORD}`), { name: NOORD, role: 'employee', active: true, perms: { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false } });
    b.set(d.doc('users/' + NOORD), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: NOORD + '@x.invalid', createdAt: 1 });
    // לארג' פעמי במצב legacy (שורש): מנהל ועובד, ומסמך עבודה בשורש – לבדיקת החוקים
    b.set(d.doc('admins/' + LM), { email: 'lm@x.invalid' });
    b.set(d.doc('staff/' + LE), { name: LE, role: 'employee', active: true });
    b.set(d.doc('impJobs/AAAAAAAAAAAAAAAAAAAA'), { k: 'cust', total: 1, st: 'done' });
    await b.commit();
  });
}

// שליחת קובץ כמו האפליקציה: קריאות של 200 שורות, מזהה עבודה אחד
async function upload(uid, kind, rows, ns, extra) {
  const job = jid();
  for (let at = 0; at < rows.length; at += 200) {
    const r = await call('startImport', uid, Object.assign({ job, kind, total: rows.length, at, rows: rows.slice(at, at + 200), ns: ns.slice(at, at + 200) }, extra || {}));
    assert.equal(r.status, 'OK', short(r.text));
  }
  return job;
}
async function waitJob(biz, job, ms) {
  const t0 = Date.now(); let d = null;
  while (Date.now() - t0 < (ms || 240000)) {
    const s = await adm().doc(`b/${biz}/impJobs/${job}`).get();
    d = s.exists ? s.data() : null;
    if (d && (d.st === 'done' || d.st === 'part')) return d;
    await sleep(400);
  }
  assert.fail('הייבוא לא הסתיים בזמן: ' + short(JSON.stringify(d && { st: d.st, dn: d.dn, fr: d.fr, next: d.next, recv: d.recv })));
}
// כל המסמכים מתחת ל-impQ (חלקים, תוצאות שורות) – כולל מסמכי אב שלא קיימים
async function walkColl(coll, out) { for (const d of await coll.listDocuments()) await walkDoc(d, out); }
async function walkDoc(d, out) { const s = await d.get(); if (s.exists) out.push({ path: d.path, data: s.data() }); for (const c of await d.listCollections()) await walkColl(c, out); }
async function impDocs(biz) { const out = []; await walkColl(adm().collection('impQ'), out); (await adm().collection(`b/${biz}/impJobs`).get()).forEach((s) => out.push({ path: s.ref.path, data: s.data(), job: true })); return out; }
const strings = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (o && typeof o === 'object') Object.values(o).forEach((v) => strings(v, out)); return out; };
const keysDeep = (o, out = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); keysDeep(v, out); } return out; };
const CARD_RUN = /\d(?:[\s.\-/]*\d){12,18}/;
function noSecrets(docs, cards, where) {
  for (const x of docs) {
    const s = strings(x.data); const box = x.data.box ? strings(x.data.box) : [];
    const plain = s.filter((v) => !box.includes(v));
    assert.ok(!plain.some((v) => CARD_RUN.test(v)), where + ': רצף של 13–19 ספרות גלוי ב-' + x.path.replace(/\d{8,}/g, '#'));
    assert.ok(!keysDeep(x.data).some((k) => /^(cvv|num|cards?|phone|tz|name|mail|addr)$/.test(k)), where + ': שדה לקוח/כרטיס גלוי ב-' + x.path);
    const all = JSON.stringify(x.data);
    for (const c of cards) assert.ok(!all.includes(c.num) && !all.includes('"cvv":"' + c.cvv + '"'), where + ': מספר כרטיס/CVV גלוי');
  }
}
async function custs(biz) {
  const s = await adm().collection(`b/${biz}/cust`).get(); const out = {};
  for (const d of s.docs) {
    const o = Object.assign({}, d.data()); delete o.at; delete o.upd; delete o.by;
    const cards = [];
    for (const k of [1, 2, 3]) {
      const p = await adm().doc(`b/${biz}/cust/${d.id}/p/card${k > 1 ? k : ''}`).get();
      if (p.exists) cards.push({ s: k, last4: p.get('last4'), src: p.get('src'), c: CARD.open(KEY, biz, 'cust/' + d.id + (k > 1 ? '#' + k : ''), p.get('box')) });
    }
    out[d.id] = { o, cards };
  }
  return out;
}
async function prods(biz) {
  const s = await adm().collection(`b/${biz}/prod`).get(); const out = {};
  for (const d of s.docs) {
    const o = Object.assign({}, d.data()); delete o.at; delete o.upd; delete o.by;
    const [c, w] = await Promise.all([adm().doc(`b/${biz}/prod/${d.id}/p/cost`).get(), adm().doc(`b/${biz}/prod/${d.id}/p/ws`).get()]);
    assert.ok(!out[o.name], 'מוצר כפול: ' + o.name);
    out[o.name] = { o, cost: c.exists ? c.get('cost') : null, wp: w.exists ? w.get('wp') : null };
  }
  return out;
}
const moves = async (biz) => (await adm().collection(`b/${biz}/stockLog`).get()).docs.map((d) => [d.get('name'), d.get('br'), d.get('delta'), d.get('why'), d.get('note')].join('|')).sort();
const catsOf = async (biz) => (await adm().collection(`b/${biz}/cat`).get()).docs.map((d) => [d.id, d.get('name'), d.get('parent') || ''].join('|')).sort();
const logCount = async (biz, act) => (await adm().collection(`b/${biz}/cardLog`).where('act', '==', act).get()).size;

// עבודה שנכתבת ישירות (כמו startImport), עם _t = כשל מדומה בניסיון הראשון (באמולטור)
async function mkJob(biz, uid, kind, rows, opts) {
  const o = opts || {}; const job = jid(); const now = Date.now();
  const chunks = I.pack(kind, rows, rows.map((_, i) => i + 2), 0).map((c) => I.sealChunk(KEY, biz, job, c));
  const got = {}; chunks.forEach((c) => { got[c.n] = c.cnt; });
  await adm().doc(`b/${biz}/impJobs/${job}`).set({ k: kind, uid, t: now, upd: now, total: rows.length, br: o.br || null, addQty: false, st: 'run', recv: rows.length, got, next: 0, wait: [], dn: 0, fr: 0, cnt: { c: 0, u: 0, s: 0, b: 0, sk: 0 }, bad: [], fail: [] });
  const refs = [];
  for (const c of chunks) {
    const ref = I.qRef(biz, job).collection('c').doc(String(c.n));
    await ref.set(Object.assign({ biz, job, n: c.n, cnt: c.cnt, k: kind, uid, box: c.box, t: now, tries: 0, st: 'q', kk: 0 }, o.t != null ? { _t: o.t } : {}));
    refs.push(ref);
  }
  return { job, refs };
}
// הניסיון הראשון: הטריגר באמולטור (נכשל בכוונה). אם הטריגר לא רץ תוך 20 שניות – מריצים את הניסיון הראשון ישירות, עם אותו כשל.
async function firstTryFails(ref, failAt) {
  const t0 = Date.now(); let tries = 0;
  while (Date.now() - t0 < 20000) { const s = await ref.get(); tries = s.exists ? (s.get('tries') || 0) : 0; if (tries >= 1) break; await sleep(300); }
  if (tries >= 1) { await sleep(2000); return 'trigger'; }
  await assert.rejects(I.processChunk(ref, { failAt }), /injected/);
  return 'direct';
}

before(async () => {
  assert.ok(KEY, 'חסר CARD_ENC_KEY ב-functions/.secret.local');
  env = await H.getEnv();
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
  process.env.CARD_ENC_KEY = KEY; // הניסיון החוזר שרץ בתהליך הבדיקה צריך את מפתח הדמה (כמו האמולטור)
  require('../functions/index.js');
  I = require('../functions/imports.js')._core;
  CARD = require('../functions/lib/card.js');
  adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  // יומנים של הקוד שרץ בתהליך הבדיקה – נאספים ונבדקים שאין בהם ספרות כרטיס
  logs = [];
  const L = require(require.resolve('firebase-functions/logger', { paths: [FN] }));
  for (const k of ['log', 'info', 'warn', 'error', 'debug', 'write']) { const f = L[k]; if (typeof f === 'function') L[k] = (...a) => { logs.push(JSON.stringify(a)); return f.apply(L, a); }; }
  for (const k of ['log', 'warn', 'error']) { const f = console[k]; console[k] = (...a) => { logs.push(a.map(String).join(' ')); return f.apply(console, a); }; }
  await seed();
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

const C916 = G.customers(916);
const P450 = G.products(450);

describe('ייבוא ברקע – לקוחות (916 מדומים)', () => {
  let job1;
  it('916 לקוחות: נשלחים, והשרת מסיים לבד (בלי קריאה נוספת מהטלפון); זמן נמדד; סיכום נכון; החלקים נמחקו', { timeout: 300000 }, async () => {
    const t0 = Date.now();
    job1 = await upload(MGR, 'cust', C916.rows, C916.ns);
    const tUp = Date.now() - t0;
    noSecrets(await impDocs(A), C916.cards, 'מיד אחרי השליחה');
    const j = await waitJob(A, job1);
    console.log(`ייבוא 916 לקוחות באמולטור: שליחה ${tUp}ms, עד סיום בשרת ${Date.now() - t0}ms`);
    assert.equal(j.st, 'done'); assert.equal(j.dn, 916); assert.equal(j.fr, 0);
    assert.deepEqual({ c: j.cnt.c, u: j.cnt.u, s: j.cnt.s, b: j.cnt.b }, { c: 912, u: 0, s: 0, b: 4 });
    assert.deepEqual(j.bad.map((x) => [x.n, x.r]), [[2, 'bad-phone'], [3, 'bad-phone'], [4, 'bad-phone'], [5, 'bad-phone']]);
    assert.equal((await adm().collection(`b/${A}/cust`).get()).size, 912);
    const out = []; await walkColl(adm().collection('impQ'), out);
    assert.equal(out.filter((x) => x.path.includes(job1)).length, 0, 'החלקים המוצפנים ותוצאות השורות נמחקו בסיום');
    noSecrets(await impDocs(A), C916.cards, 'בסיום');
  });

  it('ייבוא חוזר של אותו קובץ: 0 חדשים, אין לקוח כפול ואין כרטיס כפול', { timeout: 300000 }, async () => {
    const job = await upload(MGR, 'cust', C916.rows, C916.ns);
    const j = await waitJob(A, job);
    assert.equal(j.st, 'done'); assert.equal(j.cnt.c, 0); assert.equal(j.cnt.s + j.cnt.u, 912); assert.equal(j.cnt.b, 4);
    const all = await custs(A);
    assert.equal(Object.keys(all).length, 912);
    const withCards = Object.values(all).filter((x) => x.cards.length);
    assert.equal(withCards.length, C916.cards.length);
    assert.ok(withCards.every((x) => x.cards.length === 1 && x.o.cards.length === 1), 'כרטיס כפול');
  });

  it('התוצאה זהה לייבוא הישן (importCusts) על אותו קובץ: אותם לקוחות, שדות וכרטיסים (מפוענחים)', { timeout: 300000 }, async () => {
    let created = 0;
    for (let at = 0; at < C916.rows.length; at += 200) {
      const r = await call('importCusts', M2, { reqId: rid(), rows: C916.rows.slice(at, at + 200) });
      assert.equal(r.status, 'OK', short(r.text)); created += r.result.created;
    }
    assert.equal(created, 912);
    const [a, b] = [await custs(A), await custs(B)];
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    const diff = Object.keys(a).filter((id) => JSON.stringify(a[id]) !== JSON.stringify(b[id]));
    assert.deepEqual(diff.length, 0, 'לקוחות שונים: ' + diff.slice(0, 5).join(','));
    assert.equal(await logCount(A, 'import'), await logCount(B, 'import'));
  });

  it('שליחה חוזרת של אותו חלק (ניתוק באמצע) לא מכפילה; חלק חופף / קובץ אחר באותה עבודה – נדחים', { timeout: 120000 }, async () => {
    const rows = [{ name: 'כפול', phone: '0549990001' }, { name: 'כפול ב', phone: '0549990002' }, { name: 'כפול ג', phone: '0549990003' }];
    const job = jid(); const d = { job, kind: 'cust', total: 3, at: 0, rows };
    const r1 = await call('startImport', MGR, d), r2 = await call('startImport', MGR, d);
    assert.equal(r1.status, 'OK', short(r1.text)); assert.equal(r2.status, 'OK', short(r2.text)); assert.equal(r2.result.recv, 3);
    assert.equal((await call('startImport', MGR, Object.assign({}, d, { total: 4 }))).reason, 'job-mismatch');
    const j = await waitJob(A, job);
    assert.equal(j.cnt.c, 3); assert.equal(j.dn, 3);
    const job2 = jid();
    assert.equal((await call('startImport', MGR, { job: job2, kind: 'cust', total: 4, at: 0, rows: rows.slice(0, 2) })).status, 'OK');
    assert.equal((await call('startImport', MGR, { job: job2, kind: 'cust', total: 4, at: 1, rows: rows.slice(0, 2) })).reason, 'bad-at');
  });
});

describe('ייבוא ברקע – כשל באמצע וניסיון חוזר', () => {
  it('לקוחות: כשל מדומה אחרי 3 שורות (פעם אחת) → ניסיון חוזר → כל השורות פעם אחת, סכום המונים = מספר השורות, בלי יומן עם ספרות כרטיס', { timeout: 120000 }, async () => {
    const { rows, cards } = G.customers(60, { seed: 77, bad: 0 });
    const fresh = rows.map((r, i) => Object.assign({}, r, { phone: '05' + String(30000000 + i).slice(-8) }, r.tz ? { tz: G.tzCheck(String(40000000 + i)) } : {}));
    const before0 = (await adm().collection(`b/${A}/cust`).get()).size;
    const { job, refs } = await mkJob(A, MGR, 'cust', fresh, { t: 3 });
    const how = await firstTryFails(refs[0], 3);
    const rc = I.qRef(A, job).collection('r').doc('0').collection('i');
    let recs = 0; for (let k = 0; k < 50 && recs < 3; k++) { recs = (await rc.get()).size; if (recs < 3) await sleep(300); }
    if ((await adm().doc(`b/${A}/impJobs/${job}`).get()).get('st') !== 'done') assert.equal(recs, 3, 'לפני הכשל בוצעו 3 שורות (' + how + ')');
    logs.length = 0;
    await I.processChunk(refs[0]); // הניסיון החוזר
    const j = await waitJob(A, job, 60000);
    assert.equal(j.st, 'done');
    assert.equal(j.cnt.c + j.cnt.u + j.cnt.s + j.cnt.b, 60);
    assert.equal(j.cnt.c, 60);
    assert.equal((await adm().collection(`b/${A}/cust`).get()).size, before0 + 60);
    const all = await custs(A);
    const mine = fresh.filter((r) => r.cards).map((r) => all[r.tz ? 't' + r.tz : 'p' + r.phone]);
    assert.ok(mine.every((x) => x && x.cards.length === 1), 'כרטיס כפול אחרי ניסיון חוזר');
    const L = logs.join('\n');
    for (const c of cards) assert.ok(!L.includes(c.num), 'מספר כרטיס ביומן');
    assert.ok(!/cvv/i.test(L) && !CARD_RUN.test(L.replace(/\b1[6-9]\d{11}\b/g, '')), 'ספרות כרטיס ביומן'); // בלי חותמות זמן (13 ספרות של מילישניות)
  });

  it('מוצרים: כשל מדומה אחרי השמירה ולפני סיום החלק → ניסיון חוזר → המונים פעם אחת, בלי מוצר כפול', { timeout: 120000 }, async () => {
    const rows = G.products(30, { seed: 9 }).rows.map((p, i) => Object.assign({}, p, { name: 'כשל ' + i, barcode: 'F' + String(i).padStart(5, '0') }));
    const { job, refs } = await mkJob(A, MGR, 'prod', rows, { t: 0, br: 'br1' });
    await firstTryFails(refs[0], 0);
    await I.processChunk(refs[0]);
    const j = await waitJob(A, job, 60000);
    assert.equal(j.st, 'done'); assert.equal(j.cnt.c, 30); assert.equal(j.cnt.u, 0);
    const p = await prods(A);
    assert.equal(Object.keys(p).filter((k) => k.startsWith('כשל ')).length, 30);
    assert.equal((await moves(A)).filter((m) => m.startsWith('כשל ')).length, rows.filter((r) => r.qty).length, 'תנועת מלאי פעם אחת לכל מוצר עם כמות');
  });

  it('שגיאה קבועה (המשתמש כבר לא מנהל) → החלק מסומן כשגוי בלי ניסיונות אינסופיים; "נסה שוב" אחרי תיקון → מסתיים', { timeout: 120000 }, async () => {
    const rows = [{ name: 'ק1', phone: '0547770001' }, { name: 'ק2', phone: '0547770002' }];
    const { job, refs } = await mkJob(A, E1, 'cust', rows);
    let j;
    try { j = await waitJob(A, job, 20000); } catch (e) { await I.processChunk(refs[0]); j = await waitJob(A, job, 20000); }
    assert.equal(j.st, 'part'); assert.equal(j.fr, 2); assert.equal(j.fail.length, 1); assert.equal(j.fail[0].why, 'manager-only');
    assert.equal((await call('startImport', E1, { retry: job })).reason, 'manager-only');
    await env.withSecurityRulesDisabled((c) => c.firestore().doc(`b/${A}/admins/${E1}`).set({ email: 'e1@x.invalid' }));
    const r = await call('startImport', MGR, { retry: job });
    assert.equal(r.status, 'OK', short(r.text)); assert.equal(r.result.n, 1);
    try { j = await waitJob(A, job, 20000); } catch (e) { await I.processChunk(I.qRef(A, job).collection('c').doc('0-1')); j = await waitJob(A, job, 20000); }
    assert.equal(j.st, 'done'); assert.equal(j.cnt.c, 2); assert.equal(j.fr, 0);
    await env.withSecurityRulesDisabled((c) => c.firestore().doc(`b/${A}/admins/${E1}`).delete());
  });
});

describe('ייבוא ברקע – מוצרים: זהה לייבוא הישן', () => {
  it('450 מוצרים לסניף br1: אותם מוצרים, שדות, עלויות, קטגוריות ותנועות מלאי כמו importProducts; ייבוא חוזר – 0 חדשים', { timeout: 300000 }, async () => {
    // ניקוי מוצרים מהבדיקה הקודמת בעסק A, כדי שההשוואה תהיה על אותו מצב התחלתי
    await env.withSecurityRulesDisabled(async (c) => { const d = c.firestore(); for (const col of ['prod', 'stockLog', 'cat']) { const s = await d.collection(`b/${A}/${col}`).get(); for (const x of s.docs) await x.ref.delete(); } });
    for (const p of (await adm().collection(`b/${A}/prod`).listDocuments())) await adm().recursiveDelete(p);
    const job = await upload(MGR, 'prod', P450.rows, P450.ns, { br: 'br1', addQty: false });
    const j = await waitJob(A, job);
    assert.equal(j.st, 'done'); assert.equal(j.cnt.c, 450); assert.equal(j.cnt.b, 0);
    let added = 0;
    for (let at = 0; at < P450.rows.length; at += 200) {
      const r = await call('importProducts', M2, { reqId: rid(), br: 'br1', addQty: false, rows: P450.rows.slice(at, at + 200) });
      assert.equal(r.status, 'OK', short(r.text)); added += r.result.added;
    }
    assert.equal(added, 450);
    assert.deepEqual(await prods(A), await prods(B));
    assert.deepEqual(await moves(A), await moves(B));
    assert.deepEqual(await catsOf(A), await catsOf(B));
    const job2 = await upload(MGR, 'prod', P450.rows, P450.ns, { br: 'br1', addQty: false });
    const j2 = await waitJob(A, job2);
    assert.equal(j2.cnt.c, 0); assert.equal(j2.cnt.u, 450);
    assert.equal((await adm().collection(`b/${A}/prod`).get()).size, 450);
  });
});

describe('ייבוא ברקע – הרשאות', () => {
  const rows = [{ name: 'א', phone: '0541110001' }];
  it('עובד (גם עם הרשאת הזמנות), עובד בלי הזמנות, מנהל של עסק אחר – לא יוצרים עבודה; הייבוא הישן ממשיך לעבוד', async () => {
    assert.equal((await call('startImport', E1, { job: jid(), kind: 'cust', total: 1, at: 0, rows })).reason, 'manager-only');
    assert.equal((await call('startImport', NOORD, { job: jid(), kind: 'cust', total: 1, at: 0, rows })).reason, 'no-perm');
    assert.equal((await call('startImport', M2, { bizId: A, job: jid(), kind: 'cust', total: 1, at: 0, rows })).reason, 'foreign-biz');
    assert.equal((await call('startImport', null, { job: jid(), kind: 'cust', total: 1, at: 0, rows })).status, 'UNAUTHENTICATED');
    assert.equal((await call('startImport', MGR, { job: 'x', kind: 'cust', total: 1, at: 0, rows })).reason, 'bad-job');
    assert.equal((await call('startImport', MGR, { job: jid(), kind: 'zz', total: 1, at: 0, rows })).reason, 'bad-kind');
    const old = await call('importCusts', MGR, { reqId: rid(), rows: [{ name: 'ישן', phone: '0541110009' }] });
    assert.equal(old.status, 'OK', short(old.text)); assert.equal(old.result.created, 1);
    const oldP = await call('importProducts', E1, { reqId: rid(), br: 'br1', rows: [{ name: 'ישן', price: 1 }] });
    assert.equal(oldP.status, 'OK', short(oldP.text));
  });
  it('חוקים: מנהל העסק קורא את מסמך העבודה; עובד ומנהל של עסק אחר – לא; אף אחד לא כותב; את החלקים (impQ) אף אחד לא קורא', async () => {
    const job = await upload(MGR, 'cust', rows, [2]);
    await waitJob(A, job, 60000);
    await assertSucceeds(db(MGR).doc(`b/${A}/impJobs/${job}`).get());
    await assertSucceeds(db(MGR).collection(`b/${A}/impJobs`).get());
    await assertFails(db(E1).doc(`b/${A}/impJobs/${job}`).get());
    await assertFails(db(E1).collection(`b/${A}/impJobs`).get());
    await assertFails(db(M2).doc(`b/${A}/impJobs/${job}`).get());
    await assertFails(db(MGR).doc(`b/${A}/impJobs/${job}`).set({ st: 'done' }));
    await assertFails(db(MGR).collection(`b/${A}/impJobs`).add({ k: 'cust' }));
    const { refs } = await mkJob(B, M2, 'cust', [{ name: 'ב', phone: '0541110002' }]);
    for (const u of [M2, MGR, E1]) {
      await assertFails(db(u).doc(refs[0].path).get());
      await assertFails(db(u).collection(refs[0].parent.path).get());
      await assertFails(db(u).doc(refs[0].path).set({ st: 'q' }));
    }
    // לארג' פעמי (שורש): מנהל קורא, עובד לא
    await assertSucceeds(db(LM).doc('impJobs/AAAAAAAAAAAAAAAAAAAA').get());
    await assertFails(db(LE).doc('impJobs/AAAAAAAAAAAAAAAAAAAA').get());
    await assertFails(db(LM).doc('impJobs/AAAAAAAAAAAAAAAAAAAA').set({ st: 'x' }));
  });
  it('"נסה שוב" – רק מנהל של העסק', async () => {
    const job = await upload(MGR, 'cust', [{ name: 'ג', phone: '0541110003' }], [2]);
    assert.equal((await call('startImport', E1, { retry: job })).reason, 'manager-only');
    assert.equal((await call('startImport', M2, { bizId: A, retry: job })).reason, 'foreign-biz');
    assert.equal((await call('startImport', M2, { retry: job })).reason, 'no-job');
    await waitJob(A, job, 60000);
  });
});
