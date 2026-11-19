'use strict';
// קופה גל 3 (19.11.2026): אשראי במסוף מחובר – הספק המדומה (lib/pos-card-prov.js) והוולידציה (pos-card.js _core). בלי אמולטור.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PV = require('../functions/lib/pos-card-prov');
const C = require('../functions/pos-card.js')._core;
const PCLIENT = require('../../app-source/www/pos-pay.js');

const rec = (o) => Object.assign({ id: 'K1_ref000001', amt: 4990, at: 1000000 }, o || {});
const reason = (fn) => { try { fn(); } catch (e) { return e.details && e.details.reason; } return 'ok'; };

describe('pos-card – מסוף מדומה', () => {
  it('ממתין עד MOCK.delay, ואז מאשר: מספר אישור 6 ספרות, 4 ספרות אחרונות, בלי שום מספר כרטיס', async () => {
    const r0 = await PV.mock.status(rec(), null, 1000000 + PV.MOCK.delay - 1);
    assert.equal(r0.st, 'wait');
    const r = PV.clean(await PV.mock.status(rec(), null, 1000000 + PV.MOCK.delay));
    assert.equal(r.st, 'ok'); assert.match(r.appr, /^[0-9]{6}$/); assert.match(r.last4, /^[0-9]{4}$/);
    assert.deepEqual(Object.keys(r).sort(), ['appr', 'brand', 'last4', 'st']);
    // דטרמיניסטי לכל עסקה
    assert.deepEqual(PV.clean(await PV.mock.status(rec(), null, 9e12)), r);
  });
  it('סכום שמסתיים ב-13 אגורות – נדחה; ב-99 אגורות – אין תשובה (נשאר ממתין לעולם)', async () => {
    assert.equal((await PV.mock.status(rec({ amt: 1013 }), null, 9e12)).st, 'no');
    assert.equal((await PV.mock.status(rec({ amt: 1099 }), null, 9e12)).st, 'wait');
  });
  it('ביטול: ממתינה → cancel; כבר אושרה → מחזיר את האישור (לא "בוטל" בטעות); refund → void', async () => {
    assert.equal((await PV.mock.cancel(rec({ amt: 1099 }), null, 9e12)).st, 'cancel');
    assert.equal((await PV.mock.cancel(rec(), null, 1000000)).st, 'cancel');
    assert.equal((await PV.mock.cancel(rec(), null, 9e12)).st, 'ok');
    assert.equal((await PV.mock.refund(rec())).st, 'void');
  });
  it('start מחזיר מזהה ספק וממתין', async () => {
    const r = PV.clean(await PV.mock.start(rec()));
    assert.equal(r.st, 'wait'); assert.match(r.pid, /^M[0-9a-f]{12}$/);
  });
});

describe('pos-card – CardCom (ממתין לתיעוד) ובחירת ספק', () => {
  it('כל פעולה של cardcom זורקת שגיאה ברורה בעברית', async () => {
    for (const k of ['start', 'status', 'cancel', 'refund']) {
      await assert.rejects(PV.cardcom[k](rec()), (e) => e.details.reason === 'cardcom-not-ready' && e.message === 'החיבור ל-CardCom עדיין לא הוגדר – ממתין לתיעוד');
    }
  });
  it('prov: mock / cardcom; off או ערך לא מוכר → card-off', () => {
    assert.equal(PV.prov('mock').name, 'mock'); assert.equal(PV.prov('cardcom').name, 'cardcom');
    assert.equal(reason(() => PV.prov('off')), 'card-off'); assert.equal(reason(() => PV.prov('x')), 'card-off');
  });
  it('clean: תשובה "מאושר" בלי מספר אישור או בלי 4 ספרות בדיוק → err; רצף ספרות ארוך בהודעה נמחק', () => {
    assert.equal(PV.clean({ st: 'ok', appr: '123' }).st, 'err');
    assert.equal(PV.clean({ st: 'ok', appr: '123', last4: '45801' }).st, 'err');
    assert.equal(PV.clean({ st: 'weird' }).st, 'err');
    assert.equal(PV.clean({ st: 'no', msg: 'נדחה 4580123412341234' }).msg.includes('4580'), false);
    assert.equal(PV.clean({ st: 'ok', appr: 'A1', last4: '1234', brand: 'ויזה 4580123412341234' }).brand, 'ויזה');
  });
});

describe('pos-card – ולידציה', () => {
  it('amtOf: שלם, חיובי, עד התקרה', () => {
    assert.equal(C.amtOf(1), 1); assert.equal(C.amtOf(C.AMT_MAX), C.AMT_MAX);
    for (const v of [0, -5, 1.5, '100', null, C.AMT_MAX + 1, NaN]) assert.equal(reason(() => C.amtOf(v)), 'bad-amt', String(v));
  });
  it('instOf: 1 = רגילה; תשלומים רק אם מותר, 2..instMax ומעל instMinAmt', () => {
    const cfg = { txTypes: ['reg', 'inst'], instMax: 3, instMinAmt: 30000 };
    assert.deepEqual(C.instOf(undefined, 100, cfg), { n: 1, tx: 'reg' });
    assert.deepEqual(C.instOf(3, 30000, cfg), { n: 3, tx: 'inst' });
    assert.equal(reason(() => C.instOf(4, 90000, cfg)), 'bad-inst');
    assert.equal(reason(() => C.instOf(2, 29999, cfg)), 'bad-inst');
    assert.equal(reason(() => C.instOf(2, 90000, { txTypes: ['reg'] })), 'bad-tx');
  });
  it('credOf: undefined/null עוברים; שדות ריקים = בלי שינוי; מספר מסוף ספרות בלבד; השגיאה בלי הערכים', () => {
    assert.equal(C.credOf(undefined), undefined); assert.equal(C.credOf(null), null);
    assert.equal(C.credOf({ term: '', user: '', pass: '' }), undefined);
    assert.deepEqual(C.credOf({ term: ' 1234 ', user: ' api ', pass: ' s3cret ' }), { term: '1234', user: 'api', pass: ' s3cret ' });
    let msg = '';
    try { C.credOf({ term: '12a', pass: 'TopSecret!' }); } catch (e) { msg = e.message + JSON.stringify(e.details); }
    assert.ok(msg && !msg.includes('TopSecret') && !msg.includes('12a'));
    assert.equal(reason(() => C.credOf({ pass: 'a\nb' })), 'bad-cred');
    assert.equal(reason(() => C.credOf({ other: 'x' })), 'bad-cred');
    assert.equal(reason(() => C.credOf('x')), 'bad-cred');
    assert.equal(C.credFull({ term: '1', user: 'u', pass: 'p' }), true); assert.equal(C.credFull({ term: '1', user: 'u' }), false);
  });
  it('modeOf ו-pub: pub לא חושף pid, by או ref', () => {
    assert.equal(C.modeOf('mock'), 'mock'); assert.equal(reason(() => C.modeOf('real')), 'bad-mode');
    const p = C.pub('K1_x', { st: 'ok', amt: 100, appr: '1', last4: '1234', pid: 'P', by: 'u', ref: 'r', sale: null });
    assert.deepEqual(Object.keys(p).sort(), ['amt', 'appr', 'id', 'last4', 'n', 'st', 'tx']);
  });
});

describe('pos-card – סבב 2: מצב לא ודאי ומסוף מדומה בייצור', () => {
  it('asOpen: רק ok/no/cancel/void סופיים; err ותשובה לא מוכרת → unk; wait נשאר', () => {
    for (const st of ['ok', 'no', 'cancel', 'void', 'wait']) assert.equal(C.asOpen({ st }).st, st);
    assert.equal(C.asOpen({ st: 'err' }).st, 'unk');
    assert.equal(C.asOpen(PV.clean({ st: 'weird' })).st, 'unk');
    assert.equal(C.asOpen(PV.clean({ st: 'ok', appr: '1' })).st, 'unk'); // "אושר" בלי 4 ספרות – לא ודאי, לא סופי
  });
  it('mockOk לפי הסביבה', () => {
    const e0 = process.env.FUNCTIONS_EMULATOR, g0 = process.env.GCLOUD_PROJECT;
    try {
      process.env.FUNCTIONS_EMULATOR = 'false';
      process.env.GCLOUD_PROJECT = 'largpeami-prod'; assert.equal(PV.mockOk(), false);
      process.env.GCLOUD_PROJECT = 'largpeami-test-f4691'; assert.equal(PV.mockOk(), true);
      process.env.FUNCTIONS_EMULATOR = 'true'; process.env.GCLOUD_PROJECT = 'largpeami-prod'; assert.equal(PV.mockOk(), true);
    } finally {
      if (e0 === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = e0;
      if (g0 === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = g0;
    }
  });
});

describe('pos-pay (לקוח) – PayCalc מקבל תשלום אשראי במסוף', () => {
  it('src:term עם cardTx נשמר כמו שהוא; ידני – כמו קודם', () => {
    const o = { payOn: ['cash', 'card'], txTypes: ['reg', 'inst'], instMax: 3 };
    const r = PCLIENT.PayCalc.add(10000, [], 0, { m: 'card', amt: 4000, last4: '1234', appr: '654321', src: 'term', cardTx: 'K1_cabcdef12' }, o);
    assert.equal(r.ok, true); assert.equal(r.pays[0].cardTx, 'K1_cabcdef12'); assert.equal(r.pays[0].src, 'term');
    const m = PCLIENT.PayCalc.add(10000, [], 0, { m: 'card', amt: 4000, last4: '1234', appr: '1' }, o);
    assert.equal(m.pays[0].src, 'manual'); assert.equal(m.pays[0].cardTx, undefined);
  });
});
