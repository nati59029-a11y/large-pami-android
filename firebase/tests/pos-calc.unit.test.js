'use strict';
// קופה שלב 0 (17.11.2026): ספריית החישוב באגורות (functions/lib/pos-calc.js) ומזהים ומספור (lib/pos-core.js). פונקציות טהורות – בלי אמולטור.
// בדיקה 5 בתוכנית: 50 מקרי מע"מ / הנחה – סכום השורות = הסה"כ, באגורה. בנוסף: העותק באפליקציה זהה, ואותו מע"מ כמו ar-calc (מסמכי ardoc).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../functions/lib/pos-calc');
const AC = require('../functions/lib/ar-calc');
const K = require('../functions/lib/pos-core');

// מחולל אקראי קבוע (אותם 50 מקרים בכל הרצה)
function prng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
const sum = (a) => a.reduce((s, x) => s + x, 0);

describe('pos-calc – ספריית חישוב באגורות', () => {
  it('העותק באפליקציה (www/pos-calc.js) זהה לקובץ השרת', () => {
    const a = fs.readFileSync(path.join(__dirname, '..', 'functions', 'lib', 'pos-calc.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '..', '..', 'app-source', 'www', 'pos-calc.js'), 'utf8');
    assert.equal(b, a);
  });

  it('הדוגמה מהתוכנית: 2 × 49.90 ₪ = 9980, לפני מע"מ 8458, מע"מ 1522', () => {
    const r = P.sale([{ unit: P.toAg(49.9), qty: 2 }]);
    assert.deepEqual([r.gross, r.net, r.vat, r.rate], [9980, 8458, 1522, 18]);
    assert.deepEqual(P.vatIn(9980, 18), { net: 8458, vat: 1522, gross: 9980, rate: 18 });
  });

  it('50 מקרים אקראיים: Σשורות = הסה"כ, לפני מע"מ + מע"מ = הסה"כ, הנחות לא שליליות', () => {
    const r = prng(20261117);
    let n = 0;
    for (let c = 0; c < 50; c++) {
      const L = [];
      const cnt = 1 + Math.floor(r() * 8);
      for (let i = 0; i < cnt; i++) {
        const weight = r() < 0.25;
        const l = { unit: 1 + Math.floor(r() * 50000), qty: weight ? Math.max(1, Math.floor(r() * 3000)) / 1000 : 1 + Math.floor(r() * 5) };
        const k = r();
        if (k < 0.2) l.dpct = Math.floor(r() * 5000) / 100;
        else if (k < 0.35) l.disc = Math.floor(r() * Math.round(l.unit * l.qty) * 0.3);
        L.push(l);
      }
      const o = { vm: r() < 0.8 ? 'inc' : 'ex', rate: r() < 0.9 ? 18 : [0, 17][Math.floor(r() * 2)] };
      const k2 = r();
      if (k2 < 0.3) o.dpct = Math.floor(r() * 2000) / 100;
      else if (k2 < 0.5) o.disc = 1 + Math.floor(r() * 300);
      const s = P.sale(L, o);
      const fin = sum(s.lines.map((x) => x.fin));
      if (o.vm === 'inc') assert.equal(fin, s.gross, `מקרה ${c}: Σשורות ≠ סה"כ`);
      else assert.equal(fin, s.net, `מקרה ${c}: Σשורות ≠ לפני מע"מ`);
      assert.equal(s.net + s.vat, s.gross, `מקרה ${c}`);
      assert.equal(s.sub - s.disc, fin, `מקרה ${c}: סכום לפני הנחה פחות הנחות`);
      assert.equal(sum(s.lines.map((x) => x.sd)), s.sdisc, `מקרה ${c}: חלוקת הנחת המכירה`);
      for (const x of s.lines) { assert.ok(Number.isInteger(x.fin) && x.fin >= 0 && x.sd >= 0 && x.disc >= 0, `מקרה ${c}`); }
      for (const v of [s.gross, s.net, s.vat, s.sub, s.disc]) assert.ok(Number.isInteger(v), `מקרה ${c}: הכול באגורות שלמות`);
      if (o.vm === 'inc') assert.equal(s.vat, P.rnd(s.gross * s.rate / (100 + s.rate)));
      n++;
    }
    assert.equal(n, 50);
  });

  it('מע"מ זהה ל-ar-calc.docSums (מסמך ardoc) – לכל סכום עד 2,000 ₪, ב-18% וב-17%', () => {
    for (const rate of [18, 17]) {
      for (let g = 0; g <= 200000; g += 7) {
        const a = P.vatIn(g, rate), b = AC.docSums([{ q: 1, p: g / 100 }], 'inc', rate, 0);
        if (a.vat !== b.vat || a.net !== b.net) assert.fail(`פער ב-${g} (${rate}%)`);
      }
    }
    assert.equal(P.VAT0, AC.VAT0);
  });

  it('לפני מע"מ (לקוח עסקי): net = Σשורות, vat = עיגול של net × 18%', () => {
    const s = P.sale([{ unit: 1000, qty: 3 }, { unit: 333, qty: 1 }], { vm: 'ex' });
    assert.deepEqual([s.net, s.vat, s.gross], [3333, 600, 3933]);
  });

  it('חלוקת הנחה (שארית גדולה): סכום מדויק, תיקו לפי הסדר, משקל 0 לא מקבל', () => {
    assert.deepEqual(P.spread(100, [1000, 1000, 1000]), [34, 33, 33]);
    assert.deepEqual(P.spread(10, [0, 5, 5]), [0, 5, 5]);
    assert.deepEqual(P.spread(-7, [1, 1]), [-4, -3]);
    assert.deepEqual(P.spread(0, [3, 4]), [0, 0]);
    assert.throws(() => P.spread(5, [0, 0]), (e) => e.reason === 'bad-amt');
  });

  it('שורה: משקל עד 3 ספרות, הנחה באחוז או בסכום, לא שניהם; הנחה גדולה מהשורה נדחית', () => {
    assert.deepEqual(P.line({ unit: 2990, qty: 0.455 }), { base: 1360, disc: 0, tot: 1360 }); // 1360.45 → 1360
    assert.deepEqual(P.line({ unit: 1000, qty: 2, dpct: 12.5 }), { base: 2000, disc: 250, tot: 1750 });
    assert.throws(() => P.line({ unit: 1000, qty: 1, disc: 1, dpct: 1 }), (e) => e.reason === 'bad-disc');
    assert.throws(() => P.line({ unit: 1000, qty: 1, disc: 1001 }), (e) => e.reason === 'bad-disc');
    assert.throws(() => P.line({ unit: 10.5, qty: 1 }), (e) => e.reason === 'bad-unit');
    assert.throws(() => P.line({ unit: 100, qty: 0.0001 }), (e) => e.reason === 'bad-qty');
    assert.throws(() => P.line({ unit: 100, qty: 0 }), (e) => e.reason === 'bad-qty');
    assert.throws(() => P.sale([]), (e) => e.reason === 'bad-line');
    assert.throws(() => P.sale([{ unit: 1, qty: 1 }], { vm: 'x' }), (e) => e.reason === 'bad-vm');
    assert.throws(() => P.sale([{ unit: 1, qty: 1 }], { rate: 101 }), (e) => e.reason === 'bad-rate');
    assert.throws(() => P.sale([{ unit: 100, qty: 1 }], { disc: 101 }), (e) => e.reason === 'bad-disc');
  });

  it('עיגול: חצי כלפי מעלה לפי ערך מוחלט; מזומן לכפולה של 10 אגורות; עודף', () => {
    assert.deepEqual([P.rnd(2.5), P.rnd(-2.5), P.rnd(1.4999), P.toAg(1.005), P.toAg(49.9)], [3, -3, 1, 101, 4990]);
    assert.deepEqual(P.cashRound(9985), { amt: 9990, diff: 5 });
    assert.deepEqual(P.cashRound(9984), { amt: 9980, diff: -4 });
    assert.deepEqual(P.cashRound(9984, 1), { amt: 9984, diff: 0 });
    assert.deepEqual(P.cashRound(1249, 50), { amt: 1250, diff: 1 });
    assert.equal(P.change(10000, 9990), 10);
    assert.equal(P.change(9000, 9990), null);
    assert.equal(P.pctOf(9990, 5), 500); // 499.5 → 500
  });
});

describe('pos-core – קודי קופה, מזהי מכירה, תרגול ומספור', () => {
  it('קוד קופה ומזהה מכירה', () => {
    assert.equal(K.devCode(1), 'K1');
    assert.equal(K.saleId('K1', 124), 'K1-000124');
    assert.ok(K.isDev('K12') && !K.isDev('K0') && !K.isDev('k1') && !K.isDev('K1-T1'));
    assert.throws(() => K.saleId('K1', 0));
  });
  it('תרגול (-T ומספר) – לא מזהה בקשה תקין', () => {
    assert.ok(K.isPractice('K1-T0007'));
    assert.ok(K.isPractice('T12-abc'));
    assert.ok(!K.isPractice('K1-000007'));
    assert.ok(!K.isReq('K1-T0007'));
    assert.ok(K.isReq('K1-000124'));
    assert.ok(K.isReq('a1b2c3d4e5f6'));
  });
  it('מספר מהמכשיר: הבא בתור / כבר ניתן / חור', () => {
    assert.equal(K.seqCheck(0, 1), 'next');
    assert.equal(K.seqCheck(5, 6), 'next');
    assert.equal(K.seqCheck(5, 5), 'used');
    assert.equal(K.seqCheck(5, 8), 'gap');
    assert.equal(K.seqCheck(5, 0), 'bad');
  });
  it('שעון המכשיר: עד 5 דקות בעתיד', () => {
    const now = Date.now();
    assert.ok(K.soldAtOk(now - 3600000, now));
    assert.ok(K.soldAtOk(now + 299000, now));
    assert.ok(!K.soldAtOk(now + 301000, now));
    assert.ok(!K.soldAtOk(1.5, now));
  });
});
