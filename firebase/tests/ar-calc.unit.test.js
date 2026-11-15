'use strict';
// בדיקות יחידה ל-lib/ar-calc.js (לקוח עסקי ומחירים, שלב 1) – בלי אמולטור. הרצה: node --test tests/ar-calc.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AC = require('../functions/lib/ar-calc');

describe('לקוח עסקי – חישובים טהורים (ar-calc)', () => {
  it('הקובץ באפליקציה זהה תו-בתו לקובץ של השרת', () => {
    const a = fs.readFileSync(path.join(__dirname, '../../app-source/www/ar-calc.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../functions/lib/ar-calc.js'), 'utf8');
    assert.equal(a, b);
  });
  it('מינימום פרטי (inc): עלות כוללת מע"מ × (1+X%), עיגול כלפי מעלה לאגורה', () => {
    assert.equal(AC.floorOf(10, 'inc', 18, 15), 11.5);
    assert.equal(AC.floorOf(10.01, 'inc', 18, 15), 11.52); // 11.5115 → 11.52
    assert.equal(AC.floorOf(3.33, 'inc', 18, 10), 3.67); // 3.663 → 3.67
    assert.equal(AC.floorOf(10, 'inc', 18, 0), 10);
    assert.equal(AC.floorOf(10, 'inc', 18, null), 10);
    assert.equal(AC.floorOf(null, 'inc', 18, 15), null);
    assert.equal(AC.floorOf(-1, 'inc', 18, 15), null);
  });
  it('מינימום עסקי (ex): העלות מומרת ללפני מע"מ – השוואה באותה יחידה', () => {
    assert.equal(AC.floorOf(11.8, 'ex', 18, 15), 11.5); // 10 לפני מע"מ × 1.15
    assert.equal(AC.floorOf(11.8, 'ex', 18, 0), 10);
    assert.equal(AC.floorOf(1, 'ex', 18, 0), 0.85); // 0.847… → 0.85 (כלפי מעלה)
    assert.equal(AC.floorOf(11.8, 'ex', 17, 0), 10.09); // 10.085… → 10.09
    assert.equal(AC.floorOf(11.8, 'ex', undefined, 0), 10); // מע"מ חסר = 18
  });
  it('אחוז לפי קטגוריה / תת־קטגוריה / עסק; פרטי – pp נפרד, וריק = כמו עסקי', () => {
    const cfg = { pct: 15, pp: 30, cat: { c1: 20, s1: 5 } };
    assert.equal(AC.pctFor(cfg, true, 'c1', 's1'), 5);
    assert.equal(AC.pctFor(cfg, true, 'c1', 's9'), 20);
    assert.equal(AC.pctFor(cfg, true, 'c9', ''), 15);
    assert.equal(AC.pctFor(cfg, false, 'c1', 's1'), 30);
    assert.equal(AC.pctFor({ pct: 15, cat: { c1: 20 } }, false, 'c1'), 20);
    assert.equal(AC.pctFor({}, true, 'c1'), null);
    assert.equal(AC.pctFor(null, true, 'c1'), null);
  });
  it('מחיר ברירת מחדל: קבוע ← סיטונאי ← רגיל; עסקי בלי סיטונאי = רגיל ÷ (1+מע"מ) (החלטה 7)', () => {
    assert.equal(AC.defPrice({ cp: 7, wp: 8, price: 11.8, vm: 'ex', vat: 18 }), 7);
    assert.equal(AC.defPrice({ wp: 8, price: 11.8, vm: 'ex', vat: 18 }), 8);
    assert.equal(AC.defPrice({ price: 11.8, vm: 'ex', vat: 18 }), 10);
    assert.equal(AC.defPrice({ price: 10, vm: 'ex', vat: 18 }), 8.47);
    assert.equal(AC.defPrice({ wp: 8, price: 11.8, vm: 'inc', vat: 18 }), 11.8);
    assert.equal(AC.defPrice({ cp: 9, price: 11.8, vm: 'inc', vat: 18 }), 9);
  });
  it('בדיקת מחיר: מעל ברירת המחדל תמיד מותר; מתחת – רק עד המינימום; מתחת לעלות; בלי עלות', () => {
    const b = { def: 15, cost: 10, vm: 'inc', vat: 18, pct: 15 };
    assert.deepEqual(AC.priceOk(Object.assign({ price: 16 }, b)), { ok: true });
    assert.deepEqual(AC.priceOk(Object.assign({ price: 15 }, b)), { ok: true });
    assert.equal(AC.priceOk(Object.assign({ price: 11.5 }, b)).ok, true);
    assert.deepEqual(AC.priceOk(Object.assign({ price: 11.49 }, b)), { ok: false, min: 11.5, why: 'floor' });
    assert.deepEqual(AC.priceOk(Object.assign({ price: 9.99 }, b)), { ok: false, min: 11.5, why: 'below-cost' });
    assert.deepEqual(AC.priceOk({ price: 14, def: 15, cost: null, vm: 'inc', vat: 18, pct: 15 }), { ok: false, min: 15, why: 'no-cost' });
    assert.equal(AC.priceOk({ price: 14, def: 15, cost: null, vm: 'inc' }).ok, false);
    // עסקי: עלות 11.80 כולל = 10 לפני; 15% → 11.50 לפני מע"מ
    assert.equal(AC.priceOk({ price: 11.5, def: 13, cost: 11.8, vm: 'ex', vat: 18, pct: 15 }).ok, true);
    assert.equal(AC.priceOk({ price: 11.49, def: 13, cost: 11.8, vm: 'ex', vat: 18, pct: 15 }).why, 'floor');
    // מחיר ברירת מחדל שנמוך מהעלות – לא חוסם (לא העובד הוריד)
    assert.equal(AC.priceOk({ price: 5, def: 5, cost: 10, vm: 'inc', vat: 18, pct: 15 }).ok, true);
  });
  it('סכומי הזמנה: ex / inc / הנחה, באגורות', () => {
    assert.deepEqual(AC.totals(100, 'ex', 18), { net: 100, vat: 18, gross: 118 });
    assert.deepEqual(AC.totals(118, 'inc', 18), { net: 100, vat: 18, gross: 118 });
    assert.deepEqual(AC.totals(10.01, 'ex', 17), { net: 10.01, vat: 1.7, gross: 11.71 }); // 1.7017 → 1.70
    assert.deepEqual(AC.totals(0.03, 'ex', 17), { net: 0.03, vat: 0.01, gross: 0.04 }); // 0.51 אג' → 1
    assert.deepEqual(AC.totals(100, 'inc', 18, 10), { net: 76.27, vat: 13.73, gross: 90, dsc: 10 });
    assert.deepEqual(AC.totals(100, 'ex', 18, 10), { net: 90, vat: 16.2, gross: 106.2, dsc: 10 });
    assert.deepEqual(AC.totals(100, 'inc', 0), { net: 100, vat: 0, gross: 100 });
  });
  it('termsOfCust: כל ערך ישן של pay; terms חדש גובר; pay לא נדרש', () => {
    assert.deepEqual(AC.termsOfCust({ pay: 'n30' }), { b: 'eom', d: 30 });
    assert.deepEqual(AC.termsOfCust({ pay: 'n60' }), { b: 'eom', d: 60 });
    assert.deepEqual(AC.termsOfCust({ pay: 'n90' }), { b: 'eom', d: 90 });
    for (const p of ['cash', 'credit', 'transfer', undefined, '']) assert.deepEqual(AC.termsOfCust({ pay: p }), { b: 'imm', d: 0 });
    assert.deepEqual(AC.termsOfCust({ pay: 'other', payTxt: 'צ\'ק דחוי' }), { b: 'imm', d: 0, warn: true, txt: 'צ\'ק דחוי' });
    assert.deepEqual(AC.termsOfCust({ pay: 'n30', terms: { b: 'inv', d: 45 } }), { b: 'inv', d: 45 });
    assert.deepEqual(AC.termsOfCust({ pay: 'n30', terms: { b: 'bad', d: 1 } }), { b: 'eom', d: 30 });
    assert.deepEqual(AC.termsOfCust(null), { b: 'imm', d: 0 });
    assert.equal(AC.termsOk({ b: 'imm', d: 5 }), false);
    assert.equal(AC.termsOk({ b: 'eom', d: 366 }), false);
    assert.equal(AC.termsTxt({ b: 'eom', d: 60 }), 'שוטף+60');
    assert.equal(AC.termsTxt({ b: 'inv', d: 45 }), '45 ימים מהחשבונית');
  });
  it('סבב 2: cpConv (המרת מחיר קבוע בין vm), payOf (gross ?? total), staffOk (מחיר קבוע לא מכשיר את עצמו; עסקי – לא מתחת לעלות גם בלי מגבלה)', () => {
    assert.equal(AC.cpConv(11.8, 'inc', 'ex', 18), 10); assert.equal(AC.cpConv(10, 'ex', 'inc', 18), 11.8); assert.equal(AC.cpConv(7, 'ex', 'ex', 18), 7); assert.equal(AC.cpConv(7, undefined, 'inc', 18), 7);
    assert.equal(AC.payOf({ vm: 'ex', total: 100, gross: 118 }), 118); assert.equal(AC.payOf({ total: 100, gross: 1 }), 100); assert.equal(AC.payOf({ vm: 'inc', total: 100 }), 100);
    const b = { base: 15, cost: 10, vm: 'inc', vat: 18, pct: 15 };
    assert.equal(AC.staffOk(Object.assign({ price: 1, on: false, biz: false }, b)).ok, true); // פרטי בלי מגבלה – כמו קודם
    assert.equal(AC.staffOk(Object.assign({ price: 9.99, on: false, biz: true }, b)).why, 'below-cost');
    assert.equal(AC.staffOk(Object.assign({ price: 10, on: false, biz: true }, b)).ok, true);
    assert.equal(AC.staffOk(Object.assign({ price: 11, on: true, biz: false }, b)).why, 'floor'); // גם אם 11 הוא "מחיר קבוע"
    assert.equal(AC.staffOk(Object.assign({ price: 15, on: true, biz: false }, b)).ok, true);
    assert.equal(AC.staffOk({ price: 5, base: 5, cost: 10, vm: 'inc', vat: 18, on: true }).why, 'below-cost'); // ברירת מחדל מתחת לעלות – חסום לעובד
  });
  it('סבב 3: staffOk – מחיר קבוע של מנהל (mcp) מאושר גם מתחת לעלות; עסקי – מחיר 0 חסום גם בלי עלות', () => {
    const b = { base: 15, cost: 10, vm: 'inc', vat: 18, pct: 15, on: true, biz: true };
    assert.equal(AC.staffOk(Object.assign({ price: 5, mcp: 5 }, b)).ok, true);
    assert.equal(AC.staffOk(Object.assign({ price: 6, mcp: 5 }, b)).ok, true);
    assert.equal(AC.staffOk(Object.assign({ price: 4.99, mcp: 5 }, b)).why, 'below-cost');
    assert.equal(AC.staffOk(Object.assign({ price: 0, mcp: 0 }, b)).ok, true);
    assert.equal(AC.staffOk({ price: 0, base: 6, vm: 'ex', vat: 18, on: false, biz: true }).why, 'zero');
    assert.equal(AC.staffOk({ price: 0.5, base: 6, vm: 'ex', vat: 18, on: false, biz: true }).ok, true);
    assert.equal(AC.staffOk({ price: 0, base: 6, vm: 'inc', vat: 18, on: false, biz: false }).ok, true); // פרטי בלי מגבלה – כמו קודם
  });
});


// שלב 4 (15.11.2026): חשבוניות – סכומי מסמך באגורות, מועד תשלום, מספור
describe('שלב 4 – חשבוניות (ar-calc)', () => {
  const TK = require('../functions/lib/tk-time');
  const isB = (s) => { const [y, m, d] = s.split('-').map(Number); return TK.tkBiz({ y, m: m - 1, d }); };
  it('טבלת מע"מ: ex / inc / פטור, מע"מ פעם אחת ברמת המסמך, עיגול חצי למעלה (גם 0.005)', () => {
    // ex: 3×89.90 + 12×6.25 = 344.70, הנחה 5% = 17.235 → 17.24, לפני מע"מ 327.46, מע"מ 58.9428 → 58.94, לתשלום 386.40
    assert.deepEqual(AC.docSums([{ q: 3, p: 89.9 }, { q: 12, p: 6.25 }], 'ex', 18, 5), { sum: 34470, dsc: 1724, net: 32746, vat: 5894, gross: 38640 });
    // ex: מע"מ ברמת המסמך ולא לכל שורה: 3 שורות של 0.10 → 0.30, מע"מ 0.054 → 0.05 (ולא 3×0.02 = 0.06)
    assert.deepEqual(AC.docSums([{ q: 1, p: 0.1 }, { q: 1, p: 0.1 }, { q: 1, p: 0.1 }], 'ex', 18), { sum: 30, dsc: 0, net: 30, vat: 5, gross: 35 });
    // 0.005: לפני מע"מ 0.25 × 18% = 0.045 → 0.05 (חצי אגורה למעלה); 24.75 × 18% = 4.455 → 4.46
    assert.equal(AC.docSums([{ q: 1, p: 0.25 }], 'ex', 18).vat, 5);
    assert.equal(AC.docSums([{ q: 1, p: 24.75 }], 'ex', 18).vat, 446);
    // inc: 665.70 כולל, מתוכם מע"מ 66570×18/118 = 10154.7 → 101.55
    assert.deepEqual(AC.docSums([{ q: 3, p: 89.9 }, { q: 2, p: 145.5 }, { q: 12, p: 6.25 }, { q: 1.5, p: 20 }], 'inc', 18), { sum: 66570, dsc: 0, net: 56415, vat: 10155, gross: 66570 });
    // פטור (r = 0): בלי מע"מ, גם ב-ex
    assert.deepEqual(AC.docSums([{ q: 2, p: 10.5 }], 'ex', 0), { sum: 2100, dsc: 0, net: 2100, vat: 0, gross: 2100 });
    assert.deepEqual(AC.docSums([{ q: 2, p: 10.5 }], 'inc', 0), { sum: 2100, dsc: 0, net: 2100, vat: 0, gross: 2100 });
    // שורה שלילית (שורת התאמה) – סימטרי: totals עם סכום שלילי
    assert.deepEqual(AC.totals(-0.25, 'ex', 18), { net: -0.25, vat: -0.05, gross: -0.3 });
    // שלמים בלבד
    for (const x of Object.values(AC.docSums([{ q: 1.333, p: 7.77 }], 'ex', 17))) assert.ok(Number.isInteger(x));
  });
  it('dueOf: מיידי, ימים מהחשבונית, שוטף (כפולות 30 = סוף חודש), גבולות חודש ופברואר', () => {
    assert.equal(AC.dueOf({ b: 'imm', d: 0 }, '2026-11-17'), '2026-11-17');
    assert.equal(AC.dueOf({ b: 'inv', d: 30 }, '2027-01-31'), '2027-03-02');
    assert.equal(AC.dueOf({ b: 'eom', d: 0 }, '2026-10-05'), '2026-10-31');
    assert.equal(AC.dueOf({ b: 'eom', d: 60 }, '2026-11-15'), '2027-01-31'); // כמו dueCalc: שוטף+60 על נובמבר = 31.1
    assert.equal(AC.dueOf({ b: 'eom', d: 30 }, '2027-01-10'), '2027-02-28');
    assert.equal(AC.dueOf({ b: 'eom', d: 30 }, '2028-01-31'), '2028-02-29'); // שנה מעוברת
    assert.equal(AC.dueOf({ b: 'eom', d: 90 }, '2026-12-01'), '2027-03-31');
    assert.equal(AC.dueOf({ b: 'eom', d: 15 }, '2027-01-31'), '2027-02-15'); // שוטף+N שאינו כפולה של 30 = סוף החודש + N ימים
    assert.equal(AC.dueOf({ b: 'eom', d: 45 }, '2026-10-05'), '2026-12-15');
    assert.equal(AC.dueOf({ b: 'inv', d: 0 }, 'not-a-date'), '');
    assert.equal(AC.dueOf(null, '2026-11-17'), '2026-11-17'); // בלי תנאים = מיידי
  });
  it('dueOf עם ימי עסקים (החלטה 10): שישי / שבת / ראש השנה / פסח עוברים ליום העסקים הבא', () => {
    assert.equal(AC.dueOf({ b: 'eom', d: 0 }, '2026-10-05', isB), '2026-11-01'); // 31.10.2026 שבת → ראשון 1.11
    assert.equal(AC.dueOf({ b: 'inv', d: 0 }, '2026-11-20', isB), '2026-11-22'); // שישי → ראשון
    assert.equal(AC.dueOf({ b: 'inv', d: 10 }, '2026-09-01', isB), '2026-09-14'); // 11.9 ערב ראש השנה (שישי), 12–13 ראש השנה → 14.9
    assert.equal(AC.dueOf({ b: 'inv', d: 1 }, '2027-04-20', isB), '2027-04-29'); // 21.4 ערב פסח, פסח וחול המועד עד 22 בניסן → 29.4
    assert.equal(AC.dueOf({ b: 'eom', d: 0 }, '2027-04-05', isB), '2027-05-02'); // 30.4 שישי (אחרי פסח) → ראשון 2.5
    assert.equal(AC.dueOf({ b: 'eom', d: 30 }, '2027-01-10', isB), '2027-02-28'); // ראשון – יום עסקים, בלי דחייה
  });
  it('nextNo: סדרה חדשה מתחילה מ-start (או 1); אחרי זה – רצוף', () => {
    assert.equal(AC.nextNo(null), 1);
    assert.equal(AC.nextNo(null, 3401), 3401);
    assert.equal(AC.nextNo(3401, 3401), 3402);
    assert.equal(AC.nextNo(7, 1), 8);
    assert.equal(AC.nextNo(5, 100), 100); // start גבוה מהמונה (לא אמור לקרות – setArOff חוסם אחרי שהסדרה התחילה)
  });
});

describe('החלטה 32 – מסגרת לחיוב אחרי ליקוט (ar-calc.frameOf)', () => {
  it('סכום × (1+מרווח), עיגול לשקל שלם כלפי מעלה; מרווח לא תקין = 10%', () => {
    assert.equal(AC.frameOf(100, 10), 110);
    assert.equal(AC.frameOf(42.5, 10), 47);
    assert.equal(AC.frameOf(99.99, 10), 110);
    assert.equal(AC.frameOf(100, 0), 100);
    assert.equal(AC.frameOf(100, 12.5), 113);
    assert.equal(AC.frameOf(1.1, 10), 2); // 1.21 → 2
    assert.equal(AC.frameOf(52.5, 10), 58);
    assert.equal(AC.frameOf(100, 51), 110);
    assert.equal(AC.frameOf(100, undefined), 110);
    assert.equal(AC.frameOf(0, 10), 0);
    assert.equal(AC.mgOf(50), 50); assert.equal(AC.mgOf(-1), 10);
  });
});
