'use strict';
// POS:M3 – קופה גל 2 (ש3): חיפוש מהיר ב-5,000+ מוצרים (app-source/www/pos-catalog.js).
// סלחני לשגיאות, לפי כינוי, מק"ט וברקוד חלקי; זמן תגובה להקלדה.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require(path.join(__dirname, '..', '..', 'app-source', 'www', 'pos-catalog.js'));

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const KIND = ['חלב', 'גבינה לבנה', 'גבינה צהובה', 'יוגורט', 'לחם', 'לחמניות', 'פיתות', 'אורז', 'פסטה', 'קמח', 'סוכר', 'מלח', 'שמן', 'טחינה', 'חומוס', 'קפה', 'תה', 'קקאו', 'שוקולד', 'ופלים', 'עוגיות', 'במבה', 'ביסלי', 'קרקרים', 'דגני בוקר', 'מיץ', 'מים מינרליים', 'סודה', 'רסק עגבניות', 'תירס', 'טונה', 'זיתים', 'מלפפון חמוץ', 'חומץ', 'דבש', 'ריבה', 'שקדים', 'צימוקים', 'אגוזים', 'קטשופ', 'מיונז', 'חרדל', 'נייר טואלט', 'מגבות נייר', 'סבון כלים', 'אבקת כביסה', 'מרכך כביסה', 'שקיות אשפה', 'נרות שבת', 'מגבונים'];
const BRAND = ['השדה', 'הגליל', 'עמק', 'הכרמל', 'הבית', 'טבעי', 'הזהב', 'מעדן', 'הר', 'גן', 'שפע', 'נחל', 'הדר', 'אור', 'כרם'];
const VAR = ['רגיל', 'מהדרין', 'דל שומן', 'מלא', 'קלאסי', 'ללא סוכר', 'משפחתי', 'מיני', 'פרימיום', 'מוקטן'];
const SIZE = ['100 גרם', '200 גרם', '250 גרם', '500 גרם', '1 ק"ג', '1 ליטר', '1.5 ליטר', '2 ליטר', 'מארז 4', 'מארז 6', 'מארז 12', '300 מ"ל'];
function build(n) {
  const r = rng(5787), L = [], seen = new Set();
  while (L.length < n) {
    const name = [KIND, BRAND, VAR, SIZE].map((A) => A[Math.floor(r() * A.length)]).join(' ');
    if (seen.has(name)) continue; seen.add(name);
    const i = L.length + 1;
    L.push({ id: 'p' + i, name, barcode: '7291' + String(i).padStart(8, '0') + (i % 10), sku: String(10000 + i), price: 100 + i });
  }
  L.unshift({ id: 'milk', name: 'חלב תנובה 3% 1 ליטר', barcode: '7290000000015', sku: 'A-17', price: 690, al: ['חלב בשקית', 'חלב טרי'] },
    { id: 'bread', name: 'לחם אחיד פרוס', barcode: '7290000000022', sku: '2', price: 850, al: ['לחם לבן'] },
    { id: 'cola', name: 'משקה קולה 1.5 ליטר', barcode: '7290011122233', sku: 'K-900', price: 990, al: ['קולה גדולה', 'שתייה שחורה'] },
    { id: 'tissue', name: 'מגבונים לחים לתינוק', barcode: '7290055566677', sku: 'T-5', price: 1290 });
  return L;
}
const P = build(6000);
const cat = C.build(P);
const ids = (q, n) => cat.search(q, n || 10).map((p) => p.id);

describe('pos-catalog – חיפוש', () => {
  it('נבנה מ-6,004 מוצרים; מוצר בלי שם / בלי id לא נכנס', () => {
    assert.equal(cat.size, 6004);
    assert.equal(C.build([{ id: 'a' }, { name: 'x' }, null, { id: 'b', name: 'ב' }]).size, 1);
  });
  it('ברקוד ומק"ט מדויקים – ראשונים, גם עם רווחים / מקפים', () => {
    assert.equal(ids('7290000000015')[0], 'milk');
    assert.equal(ids(' 7290 0000 00015 ')[0], 'milk');
    assert.equal(ids('A-17')[0], 'milk');
    assert.equal(ids('a17')[0], 'milk');
    assert.equal(ids('K-900')[0], 'cola');
    assert.equal(cat.byCode('7290000000022').id, 'bread');
    assert.equal(cat.byCode('k900').id, 'cola');
    assert.equal(cat.byCode('9999'), null);
  });
  it('ברקוד חלקי: הספרות האחרונות קודם, אחר כך תחילת הברקוד', () => {
    assert.equal(ids('22233')[0], 'cola');
    assert.equal(ids('566677')[0], 'tissue');
    assert.ok(ids('729001112', 5).includes('cola'));
    const ex = cat.explain('22233', 3)[0];
    assert.equal(ex.k, 'bc~');
  });
  it('לפי שם: כל המילים, בכל סדר, חלק ממילה', () => {
    assert.equal(ids('חלב תנובה')[0], 'milk');
    assert.equal(ids('תנובה חלב')[0], 'milk');
    assert.equal(ids('תנו')[0], 'milk');
    assert.ok(ids('לחם פרוס').includes('bread'));
  });
  it('סלחני לשגיאות כתיב: אות חסרה / מיותרת / מוחלפת / שתי אותיות בסדר הפוך, וכתיב מלא/חסר', () => {
    assert.equal(ids('תנובא')[0], 'milk', 'א במקום ה');
    assert.equal(ids('תנבה')[0], 'milk', 'אות חסרה');
    assert.equal(ids('תנוובה')[0], 'milk', 'אות מיותרת');
    assert.equal(ids('תנובה חבל')[0], 'milk', 'חבל ↔ חלב');
    assert.ok(ids('מגבונימ לחימ').includes('tissue'), 'סופיות');
    assert.ok(ids('מגבוני לחים לתנוק').includes('tissue'), 'שתי שגיאות בשלוש מילים');
    assert.ok(ids('מגבונים לחים לתינוקות').includes('tissue'), 'ריבוי');
  });
  it('לפי כינוי (al)', () => {
    assert.equal(ids('שתייה שחורה')[0], 'cola');
    assert.equal(ids('חלב בשקית')[0], 'milk');
    assert.equal(cat.explain('קולה גדולה', 1)[0].k, 'al');
  });
  it('מילה שלא קיימת בקטלוג – אין תוצאה; ריק – רשימה מההתחלה', () => {
    assert.deepEqual(ids('זזזזזז'), []);
    assert.equal(cat.search('', 5).length, 5);
  });
  it('מהיר: הקלדה אות אחרי אות ב-6,000 מוצרים – ממוצע מתחת ל-15 מ"ש, הכי איטי מתחת ל-80 מ"ש', () => {
    const queries = [];
    for (const w of ['שוקולד הזהב מיני', 'אבקת כביסה משפחתי', 'גבינה צהובה דל שומן 200', 'מים מינרליים 1.5', 'נרות שבת', 'קקאו טבעי', '7291000012', 'תנובה חלב']) for (let i = 1; i <= w.length; i++) queries.push(w.slice(0, i));
    const t = [];
    const fresh = C.build(P);
    for (const q of queries) { const a = process.hrtime.bigint(); fresh.search(q, 50); t.push(Number(process.hrtime.bigint() - a) / 1e6); }
    const avg = t.reduce((a, b) => a + b, 0) / t.length, max = Math.max(...t);
    assert.ok(avg < 15, 'ממוצע ' + avg.toFixed(2) + ' מ"ש');
    assert.ok(max < 80, 'מקסימום ' + max.toFixed(2) + ' מ"ש');
  });
  it('בניית האינדקס ל-6,000 מוצרים – מתחת לחצי שנייה', () => {
    const a = Date.now(); C.build(P); assert.ok(Date.now() - a < 500);
  });
  it('תוצאות רלוונטיות בקטלוג הגדול: "שוקולד הזהב" מחזיר רק שוקולד של הזהב', () => {
    const r = cat.search('שוקולד הזהב', 50);
    assert.ok(r.length > 0);
    assert.ok(r.every((p) => p.name.startsWith('שוקולד הזהב')), r.slice(0, 3).map((p) => p.name).join(' | '));
  });
});
