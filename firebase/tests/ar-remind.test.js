'use strict';
// שלב 5 (15.11.2026): תזכורות תשלום, כרטסת וסיכום חודשי אוטומטי – ar-remind.js (arRemind, הליבה runAll עם שעון מדומה) + ar.js (arStatement, setRemCfg)
// + הפונקציות הטהורות ב-lib/ar-calc.js (remStages, ledger). רץ מול האמולטור, חלק מ-test:multibiz.
// מייל – פונקציה מדומה שמועברת לליבה (deps.mail); ב-HTTP – סודות דמה (no-secrets). אין שום שליחה אמיתית.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const TK = require('../functions/lib/tk-time');
const AC = require('../functions/lib/ar-calc');

const A = 'biz-rem';
const ALL = { scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true };
const MGR = 'rem_mgr', E1 = 'rem_e1';
const P = `b/${A}/`;
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 'OK', r.text); return r.result; };
let n = 0;
const rid = () => 'req' + Date.now().toString(36) + (n++) + 'xx';
const isBiz = (s) => { const [y, m, d] = s.split('-').map(Number); return TK.tkBiz({ y, m: m - 1, d }); };
const at = (s, hh, mm) => { const [y, m, d] = s.split('-').map(Number); return TK.zoned(y, m - 1, d, hh, mm || 0); };
const days = (from, k) => Array.from({ length: k }, (_, i) => AC.ymdAdd(from, i));

let adm, R;
const snap = (name, mail) => ({ name, bn: '', addr: '', phone: '0541111111', mail: mail || '' });
const inv = (id, cust, d, due, open, x) => Object.assign({ t: 'inv', ser: 'D', no: +id.replace(/\D/g, ''), d, due, cust, custSnap: snap('לקוח ' + cust, cust === 'c1' ? 'c1@x.invalid' : ''), lines: [{ n: 'מוצר', q: 1, p: open / 100 }],
  vm: 'inc', rate: 18, net: open, vat: 0, gross: open, open, st: 'open', draft: true, bt: 'osek', br: '_', ord: [], by: MGR, at: 1, f: '' }, x || {});

async function seed(o) {
  o = o || {};
  const cols = ['ardoc', 'arrem', 'cust', 'arcfg', 'arsum', 'aralloc', 'private', 'ord', 'arMailRate'];
  for (const c of cols) { const q = await adm.collection(P + c).get(); const b = adm.batch(); q.docs.forEach((s) => b.delete(s.ref)); if (q.size) await b.commit(); }
  const b = adm.batch();
  b.set(adm.doc('b/' + A), { name: 'עסק תזכורות', status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: ALL });
  b.set(adm.doc(`${P}admins/${MGR}`), { email: 'm@x.invalid' });
  b.set(adm.doc(`${P}staff/${MGR}`), { name: MGR, role: 'manager', active: true });
  b.set(adm.doc(`${P}staff/${E1}`), { name: E1, role: 'employee', active: true });
  for (const [u, role] of [[MGR, 'admin'], [E1, 'worker']]) b.set(adm.doc('users/' + u), { bizId: A, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
  b.set(adm.doc(`${P}ordcfg/main`), { vat: 18 });
  b.set(adm.doc(`${P}prod/pA`), { name: 'מגש', price: 100, barcode: '', on: true, q: { _: 1000 } });
  b.set(adm.doc(`${P}cust/c1`), { ar: BIG, name: 'לקוח c1', mail: 'c1@x.invalid', phone: '0541111111', wholesale: true, terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} });
  b.set(adm.doc(`${P}cust/c2`), { ar: BIG, name: 'לקוח c2', mail: 'c2@x.invalid', phone: '0541111112', wholesale: true, terms: { b: 'eom', d: 30 }, rem: { on: false }, at: 1, upd: 1, x: {} });
  b.set(adm.doc(`${P}cust/c3`), { ar: BIG, name: 'לקוח c3', phone: '0541111113', wholesale: true, terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} });
  b.set(adm.doc(`${P}cust/c4`), { ar: BIG, name: 'לקוח c4', mail: 'c4@x.invalid', phone: '0541111114', wholesale: true, terms: { b: 'eom', d: 30 }, at: 1, upd: 1, x: {} });
  if (o.main !== false) b.set(adm.doc(`${P}arcfg/main`), { on: true, name: 'עסק תזכורות', mail: 'biz@x.invalid' });
  if (o.rem !== false) b.set(adm.doc(`${P}arcfg/rem`), Object.assign({ on: true }, o.rem || {}));
  await b.commit();
}
const BIG = { bal: 100000000, open: 100000000, cr: 0 };
const put = (id, d) => adm.doc(`${P}ardoc/${id}`).set(d);
function mailer(fail) {
  const L = [];
  const f = async (biz, a) => { const why = fail && fail(a, L); const r = { ch: 'mail', to: a.to, at: a.now, ok: !why, ...(why ? { why } : {}) }; L.push(Object.assign({ biz, ok: !why, why }, a)); return r; };
  f.L = L; f.cust = () => L.filter((m) => m.to !== 'biz@x.invalid' && m.ok); return f;
}
const run = (now, mail) => R.runAll({ now, mail, only: A });

before(async () => {
  await H.getEnv();
  if (!process.env.FIREBASE_CONFIG) process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: H.PROJECT_ID, storageBucket: H.PROJECT_ID + '.appspot.com' });
  R = require('../functions/ar-remind.js')._core;
  adm = require(require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions')] })).getFirestore();
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('remStages / ledger – פונקציות טהורות', () => {
  it('ברירת מחדל: 3 לפני, ביום, +3, +7, +30, ואז כל 30; שבת → ראשון; לא ביום ההפקה ולא לפניו', () => {
    const st = AC.remStages('2026-12-10', '2026-11-20', '2027-03-15', {}, isBiz);
    assert.deepEqual(st.map((x) => x.k + ' ' + x.day), ['b 2026-12-07', 'a0 2026-12-10', 'a3 2026-12-13', 'a7 2026-12-17', 'a30 2027-01-10', 'm1 2027-02-08', 'm2 2027-03-10']);
    assert.deepEqual(AC.remStages('2026-12-10', '2026-12-08', '2026-12-10', {}, isBiz).map((x) => x.k), ['a0'], 'שלב "לפני" ביום שלפני ההפקה – לא');
    assert.deepEqual(AC.remStages('2026-12-10', '2026-12-10', '2026-12-10', {}, isBiz), [], 'ביום ההפקה – כלום');
  });
  it('חג: מועד בערב פסח 5787 (21.4.2027) – "ביום המועד", +3 ו-+7 עוברים ל-29.4 (אחרי חול המועד); הגדרות שונות ללקוח / לעסק', () => {
    assert.deepEqual(AC.remStages('2027-04-21', '2027-03-01', '2027-04-30', {}, isBiz).map((x) => x.k + ' ' + x.day), ['b 2027-04-18', 'a0 2027-04-29', 'a3 2027-04-29', 'a7 2027-04-29'], 'כל השלבים שנפלו בחג – ביום העסקים הבא; השרת שולח רק את האחרון (הודעה אחת)');
    assert.deepEqual(AC.remStages('2027-04-21', '2027-03-01', '2027-04-30', { b: 0, steps: [1], mon: 0 }, isBiz).map((x) => x.k + ' ' + x.day), ['a1 2027-04-29']);
    assert.deepEqual(AC.remCfg({ b: -1, steps: [3, 'x'], mon: 5 }), AC.remCfg({}), 'ערכים לא תקינים = ברירת המחדל');
  });
  it('ledger: חובה / זכות / יתרה מצטברת, קבלה מבוטלת לא נספרת, החזר כסף = חובה, טווח תאריכים עם יתרת פתיחה', () => {
    const D = [{ t: 'inv', d: '2026-11-01', gross: 10000, no: 1 }, { t: 'rc', d: '2026-11-05', gross: 3000, no: 1 }, { t: 'rc', d: '2026-11-06', gross: 999, no: 2, void: { at: 1 } },
      { t: 'ir', d: '2026-11-07', gross: 5000, no: 1 }, { t: 'cr', d: '2026-11-08', gross: 2000, no: 1, rf: { m: 'cash', amt: 500 } }, { t: 'st', d: '2026-11-09', gross: 1 }];
    const L = AC.ledger(D);
    assert.deepEqual(L.rows.map((r) => [r.t, r.dr, r.cr, r.bal]), [['inv', 10000, 0, 10000], ['rc', 0, 3000, 7000], ['ir', 5000, 5000, 7000], ['cr', 500, 2000, 5500]]);
    assert.equal(L.bal, 5500);
    const R2 = AC.ledger(D, '2026-11-06', '2026-11-07');
    assert.equal(R2.open, 7000); assert.equal(R2.rows.length, 1); assert.equal(R2.end, 7000); assert.equal(R2.bal, 5500);
  });
});

describe('arRemind – תרחיש של 40 יום מדומים (קריטריון 1)', () => {
  beforeEach(async () => { await seed(); });
  it('שתי חשבוניות ללקוח אחד: מספר ההודעות ותאריכיהן = הטבלה הצפויה; הודעה אחת ביום עם כל החשבוניות; שתי ריצות ביום – פעם אחת', async () => {
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800));
    await put('invD2', inv('invD2', 'c1', '2026-11-25', '2026-12-13', 5900));
    const m = mailer();
    for (const d of days('2026-12-03', 40)) { await run(at(d, 8, 45), m); await run(at(d, 10, 0), m); await run(at(d, 10, 15), m); }
    const sent = m.cust().map((x) => TK.dayStr(TK.ymdOf(x.now)));
    // invD1: b 7.12, ביום 10.12, +3 13.12 (ראשון), +7 17.12, +30 9.1 (שבת) → 10.1. invD2: b 10.12, ביום 13.12, +3 16.12, +7 20.12 (ראשון), +30 12.1 (מחוץ לחלון)
    assert.deepEqual(sent, ['2026-12-07', '2026-12-10', '2026-12-13', '2026-12-16', '2026-12-17', '2026-12-20', '2027-01-10']);
    assert.ok(m.cust().every((x) => x.to === 'c1@x.invalid' && Buffer.isBuffer(x.pdf) && x.pdf.length > 500));
    const d10 = m.cust()[1].text;
    assert.match(d10, /חשבונית 1 /); assert.match(d10, /חשבונית 2 /); assert.match(d10, /₪177\.00/, 'סכום כל החשבוניות הפתוחות');
    assert.ok(m.cust().every((x) => (new Date(x.now).getUTCHours() + 2) % 24 >= 9), 'לא לפני 09:00');
    const rem = (await adm.collection(P + 'arrem').get()).docs.map((s) => s.id).filter((k) => /^inv/.test(k)).sort();
    assert.deepEqual(rem, ['invD1_a0', 'invD1_a3', 'invD1_a30', 'invD1_a7', 'invD1_b', 'invD2_a0', 'invD2_a3', 'invD2_a7', 'invD2_b']);
    const sums = (await adm.collection(P + 'arrem').get()).docs.filter((s) => s.id.startsWith('sum_'));
    assert.equal(sums.length, 7, 'סיכום יומי אחד לכל יום שבו נשלחה תזכורת');
    assert.equal(m.L.filter((x) => x.to === 'biz@x.invalid').length, 7, 'מייל סיכום למנהל – פעם ביום');
    const s0 = sums[0].data(); assert.equal(s0.sent.length, 1); assert.equal(s0.owe[0].cust, 'c1'); assert.equal(s0.owe[0].open, 17700);
  });
  it('תשלום שנכנס בין הריצות עוצר; לקוח מכובה לא מקבל; לקוח בלי מייל – no-to ולא שוב; ריצות במקביל – פעם אחת', async () => {
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800));
    await put('invD3', inv('invD3', 'c2', '2026-11-20', '2026-12-10', 1000));
    await put('invD4', inv('invD4', 'c3', '2026-11-20', '2026-12-10', 1000));
    const m = mailer();
    await Promise.all([run(at('2026-12-07', 10), m), run(at('2026-12-07', 10), m), run(at('2026-12-07', 10, 1), m)]);
    assert.equal(m.cust().length, 1, 'במקביל – הודעה אחת');
    assert.equal(m.cust()[0].to, 'c1@x.invalid');
    const l3 = (await adm.doc(`${P}arrem/c_c3_2026-12-07`).get()).data();
    assert.equal(l3.r.ok, false); assert.equal(l3.r.why, 'no-to');
    assert.equal((await adm.doc(`${P}arrem/c_c2_2026-12-07`).get()).exists, false, 'לקוח מכובה – אין נעילה');
    await adm.doc(`${P}ardoc/invD1`).update({ open: 0, st: 'paid' });
    for (const d of days('2026-12-08', 20)) await run(at(d, 10), m);
    assert.equal(m.cust().length, 1, 'אחרי התשלום – אין עוד תזכורות');
    assert.equal(m.L.filter((x) => x.to === 'c2@x.invalid').length, 0);
  });
  it('תקרה יומית: 2 ביום – הלקוח השלישי מקבל מחר; מכסת המייל לשעה (rate) – הנעילה מתבטלת ונשלח בריצה הבאה', async () => {
    await seed({ rem: { cap: 2 } });
    for (const c of ['c1', 'c3', 'c4']) await put('invD' + c.slice(1), inv('invD' + c.slice(1), c, '2026-11-20', '2026-12-10', 1000, c === 'c3' ? { custSnap: snap('c3', 'c3@x.invalid') } : {}));
    let first = true;
    const m = mailer((a) => { if (a.to === 'c4@x.invalid' && first) { first = false; return 'rate'; } return ''; });
    await run(at('2026-12-07', 10), m);
    assert.deepEqual(m.cust().map((x) => x.to).sort(), ['c1@x.invalid', 'c3@x.invalid']);
    assert.equal((await adm.doc(`${P}arrem/n_2026-12-07`).get()).get('n'), 2);
    await run(at('2026-12-07', 10, 15), m);
    assert.equal(m.cust().length, 2, 'אותו יום – התקרה מלאה');
    await run(at('2026-12-08', 10), m);
    assert.deepEqual(m.cust().map((x) => x.to), ['c1@x.invalid', 'c3@x.invalid'], 'מחר: c4 קיבל rate');
    assert.equal((await adm.doc(`${P}arrem/c_c4_2026-12-08`).get()).exists, false, 'rate – הנעילה בוטלה');
    await run(at('2026-12-08', 10, 15), m);
    assert.equal(m.cust().filter((x) => x.to === 'c4@x.invalid').length, 1, 'נשלח בריצה הבאה');
    assert.equal((await adm.doc(`${P}arrem/invD4_b`).get()).exists, true);
  });
  it('כבוי: בלי "מסמכים פעילים" / בלי "תזכורות" – כלום; בשבת ובחג – כלום; קישור תשלום ונוסח של המנהל נכנסים להודעה', async () => {
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800));
    const m = mailer();
    await seed({ main: false }); await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800));
    assert.equal((await run(at('2026-12-07', 10), m))[A].skipped, 'ar-off');
    await seed({ rem: false }); await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800));
    assert.equal((await run(at('2026-12-07', 10), m))[A].rem, 'off');
    assert.equal(m.L.length, 0);
    assert.equal((await adm.collection(P + 'arrem').get()).size, 0);
    await seed({ rem: { txt: 'היי {שם}, חוב {סכום}.\n{קישור}' } }); await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800));
    await adm.doc(`${P}private/pay`).set({ mode: 'link', link: 'https://pay.example.invalid/x' });
    assert.equal((await run(at('2026-12-12', 10), m))[A].skipped, 'not-biz-day', 'שבת');
    await run(at('2026-12-07', 10), m);
    assert.equal(m.cust()[0].text, 'היי לקוח c1, חוב ₪118.00.\nלתשלום: https://pay.example.invalid/x');
  });
});

describe('תיקון סבב 1 (בודק 5): יתרת זכות, טיוטה, לא אחרי 20:00', () => {
  beforeEach(async () => { await seed(); });
  it('קבלה עם זכות שמכסה את החוב (bal<=0) – אין תזכורת; זכות חלקית – הסכום = bal ושורת "בניכוי יתרת זכות"; טיוטה מסומנת', async () => {
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800));
    await put('invD4', inv('invD4', 'c4', '2026-11-20', '2026-12-10', 11800));
    await adm.doc(`${P}cust/c1`).update({ ar: { bal: -500, open: 11800, cr: 12300 } });
    await adm.doc(`${P}cust/c4`).update({ ar: { bal: 5000, open: 11800, cr: 6800 } });
    const m = mailer();
    const out = await run(at('2026-12-07', 10), m);
    assert.deepEqual(m.cust().map((x) => x.to), ['c4@x.invalid'], JSON.stringify(out[A]));
    assert.equal(out[A].credit, 1);
    const t = m.cust()[0].text;
    assert.match(t, /בסך ₪50\.00/); assert.match(t, /בניכוי יתרת זכות ₪68\.00/); assert.match(t, /חשבונית 4 \(טיוטה – לא מסמך רשמי\)/);
    assert.equal((await adm.doc(`${P}arrem/c_c1_2026-12-07`).get()).exists, false, 'לקוח בזכות – אין נעילה');
    assert.equal((await adm.doc(`${P}arrem/c_c4_2026-12-07`).get()).get('r').amt, 5000);
  });
  it('זכות שנכנסה אחרי הסריקה ולפני השליחה – לא נשלח (credit), ולא נשלח שוב באותו יום', async () => {
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800, { draft: false }));
    const m = mailer();
    const ref = adm.doc(`${P}cust/c1`);
    const orig = adm.runTransaction.bind(adm);
    let hit = false;
    adm.runTransaction = async (fn, o) => { const r = await orig(fn, o); if (!hit) { hit = true; await ref.update({ ar: { bal: 0, open: 11800, cr: 11800 } }); } return r; };
    try { await run(at('2026-12-07', 10), m); } finally { adm.runTransaction = orig; }
    assert.equal(m.cust().length, 0);
    assert.equal((await adm.doc(`${P}arrem/c_c1_2026-12-07`).get()).get('r').why, 'credit');
  });
  it('לא אחרי 20:00: ביום התזכורת ב-20:30 – כלום; ביום העסקים הבא – הודעה אחת (גם בשתי ריצות)', async () => {
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800));
    const m = mailer();
    assert.equal((await run(at('2026-12-07', 20, 30), m))[A].skipped, 'late');
    assert.equal(m.L.length, 0);
    await run(at('2026-12-08', 10), m); await run(at('2026-12-08', 10, 15), m);
    assert.deepEqual(m.cust().map((x) => TK.dayStr(TK.ymdOf(x.now))), ['2026-12-08']);
  });
});

describe('החלטות 15.11.2026: תזכורות על חובות מיובאים, ניסיון חוזר לשליחה שנכשלה', () => {
  beforeEach(async () => { await seed(); });
  const old = (id, cust, d, due, open, x) => Object.assign({ t: 'old', k: 'dr', ot: 'inv', ext: '2025/' + id, no: '2025/' + id, ser: 'X', d, ...(due ? { due } : {}), cust, custSnap: snap('לקוח ' + cust, cust === 'c1' ? 'c1@x.invalid' : ''),
    lines: [], vm: 'inc', rate: 0, net: open, vat: 0, gross: open, open, st: 'open', draft: false, bt: 'osek', br: '_', ord: [], by: MGR, at: 1, imp: 'b1', note: 'מסמך מיובא' }, x || {});
  it('חשבונית מיובאת ויתרת פתיחה מקבלות תזכורת עם המספר המקורי / "יתרת פתיחה"; זכות מיובאת – לא', async () => {
    await put('x_inv_101', old('101', 'c1', '2026-11-01', '2026-12-10', 5000));
    await put('x_ob_c1', old('ob', 'c1', '2026-10-31', '2026-12-10', 3000, { t: 'ob', ot: 'ob', ext: '', no: '' }));
    await put('x_rc_9', old('9', 'c4', '2026-11-01', '2026-12-10', 2000, { k: 'cr', ot: 'rc', st: 'ok' }));
    const m = mailer();
    await run(at('2026-12-07', 10), m);
    assert.deepEqual(m.cust().map((x) => x.to), ['c1@x.invalid']);
    const t = m.cust()[0].text;
    assert.match(t, /• חשבונית 2025\/101 מיום 01\/11\/2026/); assert.match(t, /• יתרת פתיחה מיום 31\/10\/2026/); assert.match(t, /בסך ₪80\.00/);
    assert.ok(R.remDoc({ t: 'inv' }) && R.remDoc({ t: 'ob', k: 'dr' }) && !R.remDoc({ t: 'old', k: 'cr' }) && !R.remDoc({ t: 'rc' }));
  });
  it('שליחה שנכשלה (send) – ניסיון חוזר בריצה הבאה, עד 3 ביום; הסיכום היומי מחכה; ביום העסקים הבא – שוב', async () => {
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800, { draft: false }));
    const m = mailer((a) => (a.to === 'c1@x.invalid' ? 'send' : ''));
    const o1 = (await run(at('2026-12-07', 10), m))[A];
    assert.equal(o1.fail, 1); assert.equal(o1.retry, 1);
    assert.equal((await adm.doc(`${P}arrem/invD1_b`).get()).exists, false, 'השלב שוחרר');
    assert.equal((await adm.doc(`${P}arrem/n_2026-12-07`).get()).get('done'), undefined, 'היום לא סומן done');
    assert.equal((await adm.doc(`${P}arrem/sum_2026-12-07`).get()).exists, false, 'הסיכום מחכה');
    const o2 = (await run(at('2026-12-07', 10, 15), m))[A];
    assert.equal(o2.retry, 1);
    const o3 = (await run(at('2026-12-07', 10, 30), m))[A];
    assert.equal(o3.fail, 1); assert.equal(o3.retry, undefined, 'אחרי 3 ניסיונות – לא עוד');
    const lk = await adm.doc(`${P}arrem/c_c1_2026-12-07`).get();
    assert.equal(lk.get('tries'), 3); assert.equal(lk.get('r').why, 'send');
    assert.equal(m.L.filter((x) => x.to === 'c1@x.invalid').length, 3);
    assert.equal((await adm.doc(`${P}arrem/sum_2026-12-07`).get()).exists, true, 'אחרי שהניסיונות נגמרו – סיכום יומי');
    assert.equal((await adm.doc(`${P}arrem/n_2026-12-07`).get()).get('n'), 0, 'כשלים לא נספרים בתקרה');
    await run(at('2026-12-07', 10, 45), m);
    assert.equal(m.L.filter((x) => x.to === 'c1@x.invalid').length, 3, 'באותו יום – לא עוד');
    const ok2 = mailer();
    await run(at('2026-12-08', 10), ok2);
    assert.deepEqual(ok2.cust().map((x) => x.to), ['c1@x.invalid'], 'ביום העסקים הבא – השלב נשלח');
  });
  it('תיקון בודק: מכסת המייל (rate) בניסיון חוזר לא מאפסת את מונה הניסיונות; חוב מיובא ישן בלי מועד – מועד לפי תנאי הלקוח', async () => {
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800, { draft: false }));
    let k = 0;
    const seq = ['send', 'rate', 'send', 'rate', 'send', 'send'];
    const m = mailer((a) => (a.to === 'c1@x.invalid' ? seq[k++] || '' : ''));
    for (let i = 0; i < 6; i++) await run(at('2026-12-07', 10, i * 5), m);
    const lk = await adm.doc(`${P}arrem/c_c1_2026-12-07`).get();
    assert.equal(lk.get('tries'), 3, 'רק 3 ניסיונות שליחה נספרו'); assert.equal(lk.get('r').why, 'send');
    assert.equal(m.L.filter((x) => x.to === 'c1@x.invalid' && x.why === 'send').length, 3, 'בדיוק 3 כשלי שליחה');
    assert.equal(k, 5, 'אחרי 3 ניסיונות – לא עוד (2 עצירות מכסה באמצע)');
    // חוב מיובא בלי due (יובא לפני 15.11): c4 בשוטף+30, תאריך 15.10.2026 → מועד 30.11.2026 (ראשון) → בתאריך 7.12 – תזכורת
    await seed();
    await put('x_inv_77', old('77', 'c4', '2026-10-15', undefined, 4000, { custSnap: snap('לקוח c4', 'c4@x.invalid') }));
    const m2 = mailer();
    await run(at('2026-12-07', 10), m2);
    assert.deepEqual(m2.cust().map((x) => x.to), ['c4@x.invalid']);
    assert.match(m2.cust()[0].text, /חשבונית 2025\/77 .*לתשלום עד 30\/11\/2026/);
    assert.equal((await adm.doc(`${P}ardoc/x_inv_77`).get()).get('due'), undefined, 'לא נכתב למסמך');
  });
  it('ניסיון חוזר מצליח: כשל ראשון ואז הצלחה – הודעה אחת שנשלחה, ולא עוד באותו יום; כתובת לא תקינה (bad-to) – בלי ניסיון חוזר', async () => {
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-10', 11800, { draft: false }));
    await put('invD4', inv('invD4', 'c4', '2026-11-20', '2026-12-10', 11800, { draft: false }));
    let k = 0;
    const m = mailer((a) => (a.to === 'c1@x.invalid' && k++ === 0 ? 'send' : a.to === 'c4@x.invalid' ? 'bad-to' : ''));
    const o1 = (await run(at('2026-12-07', 10), m))[A];
    assert.equal(o1.retry, 1, JSON.stringify(o1));
    await run(at('2026-12-07', 10, 15), m);
    await run(at('2026-12-07', 10, 30), m);
    assert.equal(m.cust().filter((x) => x.to === 'c1@x.invalid').length, 1);
    assert.equal(m.L.filter((x) => x.to === 'c4@x.invalid').length, 1, 'bad-to – פעם אחת');
    const lk = await adm.doc(`${P}arrem/c_c1_2026-12-07`).get();
    assert.equal(lk.get('r').ok, true); assert.equal(lk.get('tries'), 2);
    assert.equal((await adm.doc(`${P}arrem/invD1_b`).get()).exists, true);
    assert.equal((await adm.doc(`${P}arrem/n_2026-12-07`).get()).get('done'), true);
  });
});

describe('סיכום חודשי אוטומטי (invM)', () => {
  beforeEach(async () => { await seed({ rem: false }); });
  it('ביום העסקים הראשון בחודש – ללקוח עם invM בלבד, פעם אחת, על החודש הקודם', async () => {
    await adm.doc(`${P}cust/c1`).update({ invM: true });
    await put('invD1', inv('invD1', 'c1', '2026-11-20', '2026-12-31', 11800));
    await put('invD2', inv('invD2', 'c4', '2026-11-20', '2026-12-31', 1000));
    const m = mailer();
    await run(at('2026-12-01', 8), m);
    assert.equal(m.L.length, 0, 'לפני השעה');
    await run(at('2026-12-01', 9, 30), m); await run(at('2026-12-01', 9, 45), m); await run(at('2026-12-02', 10), m);
    assert.equal(m.L.length, 1); assert.equal(m.L[0].to, 'c1@x.invalid'); assert.match(m.L[0].subject, /11\/2026/);
    const s = (await adm.doc(`${P}arsum/c1_2026-11`).get()).data(); assert.equal(s.n, 1); assert.equal(s.tot, 11800);
    assert.equal((await adm.doc(`${P}arrem/st_c1_2026-11`).get()).get('sent')[0].ok, true);
    assert.equal((await adm.doc(`${P}arsum/c4_2026-11`).get()).exists, false);
  });
});

describe('arStatement / setRemCfg (HTTP) + כרטסת = cust.ar.bal', () => {
  beforeEach(async () => { await seed(); await adm.doc(`${P}cust/c1`).update({ ar: null }); });
  it('הזמנה → חשבונית → קבלה חלקית → זיכוי: הכרטסת מהמסמכים = cust.ar.bal; PDF; עובד רואה, בלי הרשאה / לקוח לא קיים – נדחה', async () => {
    const o = await ok(call('createOrder', MGR, { reqId: rid(), cust: { name: 'לקוח c1', phone: '0541111111' }, custId: 'c1', items: [{ pid: 'pA', qty: 3, price: 100 }] }));
    await ok(call('setOrderStatus', MGR, { id: o.id, status: 'work' }));
    await ok(call('setOrderStatus', MGR, { id: o.id, status: 'out' }));
    let docs = (await adm.collection(P + 'ardoc').where('cust', '==', 'c1').get()).docs.map((s) => Object.assign({ id: s.id }, s.data()));
    const iv = docs.find((x) => x.t === 'inv');
    assert.ok(iv, 'הופקה חשבונית');
    await ok(call('arReceipt', MGR, { reqId: rid(), cust: 'c1', amt: 50, method: 'cash' }));
    await ok(call('arCredit', MGR, { reqId: rid(), inv: iv.id, mode: 'amt', amt: 20, reason: 'פגום' }));
    docs = (await adm.collection(P + 'ardoc').where('cust', '==', 'c1').get()).docs.map((s) => Object.assign({ id: s.id }, s.data()));
    const c = (await adm.doc(`${P}cust/c1`).get()).data();
    assert.equal(AC.ledger(docs).bal, c.ar.bal, 'כרטסת = cust.ar.bal');
    const st = await ok(call('arStatement', E1, { cust: 'c1' }));
    assert.equal(st.calc, c.ar.bal); assert.equal(st.bal, c.ar.bal); assert.ok(Buffer.from(st.b64, 'base64').subarray(0, 4).toString() === '%PDF');
    const st2 = await ok(call('arStatement', MGR, { cust: 'c1', open: true }));
    assert.ok(st2.b64.length > 100);
    const sd = await ok(call('arStatement', MGR, { cust: 'c1', ch: 'mail', reqId: 'rqstm1xxxx' }));
    assert.equal(sd.sent[0].why, 'no-secrets');
    assert.equal((await call('arStatement', MGR, { cust: 'c1', from: '2026-13-01' })).reason, 'bad-date');
    assert.equal((await call('arStatement', MGR, { cust: 'nope' })).status, 'NOT_FOUND');
  });
  it('setRemCfg: רק מנהל; ערכים לא תקינים נדחים; לקוח – rem / invM; get מחזיר הגדרות וסיכומים', async () => {
    assert.equal((await call('setRemCfg', E1, { on: true })).reason, 'manager-only');
    await ok(call('setRemCfg', MGR, { on: true, hour: 8, b: 5, steps: [7, 0, 7, 14], mon: 0, cap: 50, txt: 'שלום {שם}', sum: false }));
    const r = (await adm.doc(`${P}arcfg/rem`).get()).data();
    assert.deepEqual([r.on, r.hour, r.b, r.steps, r.mon, r.cap, r.txt, r.sum], [true, 8, 5, [0, 7, 14], 0, 50, 'שלום {שם}', false]);
    for (const bad of [{ hour: 3 }, { hour: 20 }, { b: 61 }, { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { mon: 3 }, { cap: 0 }, { x: 1 }]) assert.equal((await call('setRemCfg', MGR, bad)).status, 'INVALID_ARGUMENT', JSON.stringify(bad));
    await ok(call('setRemCfg', MGR, { cust: 'c1', rem: { on: false, b: 2 }, invM: true }));
    const c = (await adm.doc(`${P}cust/c1`).get()).data();
    assert.deepEqual(c.rem, { on: false, b: 2 }); assert.equal(c.invM, true); assert.equal(c.name, 'לקוח c1');
    await ok(call('setRemCfg', MGR, { cust: 'c1', rem: null }));
    assert.equal((await adm.doc(`${P}cust/c1`).get()).get('rem'), undefined);
    assert.equal((await call('setRemCfg', E1, { cust: 'c1', invM: false })).reason, 'manager-only');
    await adm.doc(`${P}arrem/sum_${TK.dayStr(TK.ymdOf(Date.now()))}`).set({ d: 'x', sent: [], owe: [] });
    const g = await ok(call('setRemCfg', MGR, { get: true }));
    assert.equal(g.cfg.hour, 8); assert.equal(g.sums.length, 1);
  });
});
