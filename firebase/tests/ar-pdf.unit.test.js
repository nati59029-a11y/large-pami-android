'use strict';
// מנוע המסמכים (שלב 3 חלק א', 14.11.2026): lib/ar-pdf.js – בדיקת יחידה בלי אמולטור.
// הבדיקה מחלצת את הטקסט מה-PDF עצמו (מפענחת את הזרמים ואת טבלת ToUnicode של הגופן) ומסדרת לפי המיקום על הדף:
// כל שורה מתקבלת בסדר החזותי משמאל לימין – בדיוק מה שהעין רואה. המחרוזות הצפויות נכתבו ביד (לא מחושבות באותו אלגוריתם):
// שם בעברית חייב להופיע הפוך (משמאל לימין), ומספרים/סכומים – לא הפוכים.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const path = require('node:path');
const P = require(path.join(__dirname, '..', 'functions', 'lib', 'ar-pdf.js'));

const { extract } = require('./pdf-text'); // חילוץ טקסט מה-PDF (הועבר לקובץ עזר משותף)
const has = (lines, s) => lines.some((l) => l.includes(s));
const rev = (s) => Array.from(s).reverse().join('');

// PNG תקין של 1×1 (לבדיקת לוגו)
function png1() {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(1, 0); ih.writeUInt32BE(1, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 200, 160, 40]))), chunk('IEND', Buffer.alloc(0))]);
}

const BIZ = { name: 'לארג׳ פעמי', bn: '512345678', addr: 'רח׳ הרצל 12, בני ברק', phone: '03-1234567', foot: 'תודה רבה! העברה בנקאית: בנק 12 סניף 345.' };
const LINES = [{ n: 'מגשים עמוקים ירוקים 50 יח׳', q: 3, p: 89.9 }, { n: 'כוסות שקופות 250 מ"ל (קרטון)', q: 2, p: 145.5 }, { n: 'Coca Cola 1.5L', q: 12, p: 6.25 }, { n: 'מפיות לבנות', q: 1.5, p: 20 }];

describe('ar-pdf: סידור כיוון (bidi) – מחרוזות שנכתבו ביד', () => {
  const cases = [
    ['יוסי כהן', 'ןהכ יסוי'],
    ['לתשלום ₪1,234.50', '₪1,234.50 םולשתל'],
    ['מע״מ 18%', '18% מ״עמ'],
    ['טל׳ 03-1234567', '03-1234567 ׳לט'],
    ['תאריך: 14/11/2026', '14/11/2026 :ךיראת'],
    ['כוסות 250 מ"ל (קרטון)', '(ןוטרק) ל"מ 250 תוסוכ'],
    ['Coca Cola 1.5L', 'Coca Cola 1.5L'],
    ['מוצר ABC 12 יח׳', '׳חי ABC 12 רצומ'],
    ['office@example.invalid', 'office@example.invalid'],
    ['', ''],
  ];
  for (const [inp, out] of cases) it(JSON.stringify(inp), () => assert.equal(P.visual(inp), out));
  it('תווי שליטה של כיווניות (RLO/LRI…) ותווי בקרה מוסרים', () => {
    assert.equal(P.clean('\u202Eשלום\u2066 123\u0007'), 'שלום 123');
    assert.equal(P.visual(P.clean('\u202Dabc')), 'abc');
  });
  it('ניקוד נשאר צמוד לאות (האשכול לא מתפרק)', () => assert.equal(P.visual('שָׁלוֹם'), 'םוֹל' + 'שָׁ'));
  it('עיצוב סכומים באגורות', () => {
    assert.equal(P.moneyAg(123450), '₪1,234.50'); assert.equal(P.moneyAg(-3329), '-₪33.29'); assert.equal(P.moneyAg(5), '₪0.05'); assert.equal(P.moneyAg(0), '₪0.00');
    assert.equal(P.qtyTxt(1.5), '1.5'); assert.equal(P.qtyTxt(1200), '1,200'); assert.equal(P.dateTxt('2026-11-14'), '14/11/2026');
  });
});

describe('ar-pdf: חישוב באגורות (נבדק ביד)', () => {
  it('לקוח עסקי (לפני מע״מ) עם 5% הנחה: 269.70+291.00+75.00+30.00=665.70; הנחה 33.29; 632.41; מע״מ 113.83; לתשלום 746.24', () => {
    const k = P.calc({ vm: 'ex', rate: 18, disc: 5, lines: LINES });
    assert.deepEqual(k.rows.map((r) => r.a), [26970, 29100, 7500, 3000]);
    assert.deepEqual([k.sum, k.dsc, k.net, k.vat, k.gross], [66570, -3329, 63241, 11383, 74624]);
  });
  it('לקוח פרטי (כולל מע״מ): 665.70 לתשלום, מתוכם מע״מ 101.55 (66570×18/118=10154.7)', () => {
    const k = P.calc({ vm: 'inc', rate: 18, lines: LINES });
    assert.deepEqual([k.sum, k.dsc, k.net, k.vat, k.gross], [66570, 0, 56415, 10155, 66570]);
  });
  it('total שלא תואם את סכום השורות – שגיאה (לא יוצא מסמך עם סכומים סותרים)', () => {
    assert.throws(() => P.calc({ vm: 'ex', lines: LINES, total: 665.71 }), (e) => e.reason === 'total-mismatch');
    assert.doesNotThrow(() => P.calc({ vm: 'ex', lines: LINES, total: 665.7 }));
    assert.throws(() => P.calc({ vm: 'ex', lines: [{ n: 'x', q: 'a', p: 1 }] }), (e) => e.reason === 'bad-line');
  });
});

describe('ar-pdf: קובץ PDF – חילוץ טקסט מהקובץ עצמו', () => {
  it('לקוח פרטי: השם בעברית בסדר הנכון, "₪1,234.50", "מתוכם מע״מ", מספר ותאריך', async () => {
    const buf = await P.render({ t: 'oc', no: 1043, d: '2026-11-14', biz: BIZ, cust: { name: 'יוסי כהן', phone: '054-1234567' }, vm: 'inc', rate: 18, lines: [{ n: 'סט כלים לאירוע', q: 1, p: 1234.5 }] });
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
    const [pg] = extract(buf);
    assert.ok(has(pg, 'ןהכ יסוי :דובכל'), pg.join('\n'));
    assert.ok(has(pg, 'ןהכ יסוי'), 'השם הפוך חזותית = נקרא נכון מימין לשמאל');
    assert.ok(!has(pg, 'יוסי כהן'), 'השם לא מופיע בסדר הלוגי (שהיה נראה הפוך)');
    assert.ok(has(pg, '₪1,234.50'), 'הסכום לא הפוך');
    assert.ok(has(pg, '18% מ״עמ םכותמ'), 'מתוכם מע״מ 18%');
    assert.ok(has(pg, '₪188.31'), 'מע״מ: 123450×18/118 = 18830.5 → 188.31');
    assert.ok(has(pg, '1043 ׳סמ') && has(pg, '14/11/2026 :ךיראת'));
    assert.ok(has(pg, rev('אישור הזמנה')));
    assert.ok(has(pg, '1 ךותמ 1 דומע'));
    assert.ok(has(pg, '(מ״עמ ללוכ) ׳חיל ריחמ'), 'כותרת עמודה עם סוגריים בכיוון הנכון');
  });
  it('לקוח עסקי: מחירים לפני מע״מ, סה״כ / הנחה / סה״כ לפני מע״מ / מע״מ / לתשלום – הסכומים שחושבו ביד', async () => {
    const buf = await P.render({ t: 'oc', no: 1042, d: '2026-11-14', biz: BIZ, cust: { name: 'ישיבת אור החיים', bn: '580012345' }, vm: 'ex', rate: 18, disc: 5, lines: LINES, terms: 'שוטף+30', due: '2026-12-30' });
    const [pg] = extract(buf);
    const row = (lab, val) => pg.some((l) => l.startsWith(val) && l.endsWith(P.visual(lab)));
    assert.ok(row('סה״כ', '₪665.70'), pg.join('\n'));
    assert.ok(row('הנחה', '-₪33.29'));
    assert.ok(row('סה״כ לפני מע״מ', '₪632.41'));
    assert.ok(row('מע״מ 18%', '₪113.83'));
    assert.ok(row('לתשלום', '₪746.24'));
    assert.ok(has(pg, P.visual('מחיר ליח׳ (לפני מע״מ)')));
    assert.ok(has(pg, '₪269.70') && has(pg, '₪291.00') && has(pg, '₪75.00') && has(pg, '₪30.00') && has(pg, '₪89.90'));
    assert.ok(has(pg, 'Coca Cola 1.5L'));
    assert.ok(has(pg, P.visual('ישיבת אור החיים')) && has(pg, '580012345'));
    assert.ok(has(pg, '30/12/2026 :דע םולשתל'));
    assert.ok(has(pg, P.visual(BIZ.foot)), 'טקסט תחתון של העסק');
  });
  it('לוגו: חסר / פגום / webp – לא מפיל; PNG תקין – נכנס לקובץ', async () => {
    const base = { t: 'oc', d: '2026-11-14', cust: { name: 'א' }, vm: 'inc', lines: [{ n: 'x', q: 1, p: 1 }] };
    for (const logo of [undefined, null, '', Buffer.from('not an image'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'data:image/webp;base64,UklGRg==', 'https://evil.invalid/x.png']) {
      const b = await P.render(Object.assign({}, base, { biz: Object.assign({}, BIZ, { logo }) }));
      assert.equal(b.subarray(0, 5).toString('latin1'), '%PDF-');
    }
    const ok = await P.render(Object.assign({}, base, { biz: Object.assign({}, BIZ, { logo: 'data:image/png;base64,' + png1().toString('base64') }) }), { compress: false });
    assert.match(ok.toString('latin1'), /\/Subtype \/Image/);
  });
  it('טיוטה: "טיוטה – לא מסמך רשמי" בכל עמוד; הרבה שורות – כמה עמודים עם מספור', async () => {
    const lines = Array.from({ length: 70 }, (_, i) => ({ n: 'מוצר ' + (i + 1), q: 1, p: 10 }));
    const pages = extract(await P.render({ t: 'inv', no: 7, d: '2026-11-14', draft: true, biz: BIZ, cust: { name: 'א' }, vm: 'ex', rate: 18, lines }));
    assert.ok(pages.length >= 2);
    pages.forEach((pg, i) => { assert.ok(has(pg, P.visual(P.DRAFT_TXT)), 'עמוד ' + (i + 1)); assert.ok(has(pg, P.visual(`עמוד ${i + 1} מתוך ${pages.length}`))); });
    const last = pages[pages.length - 1];
    assert.ok(last.some((l) => l.startsWith('₪826.00') && l.endsWith(P.visual('לתשלום'))), 'לתשלום = 700 + 18% = 826');
    assert.ok(has(pages[0], P.visual('חשבונית מס')));
  });
  it('החלטה 29: זיכוי – שורת הפניה "זיכוי לחשבונית מס מספר N" (עם טיוטה); בלי refTxt – אין שורה', async () => {
    const base = { t: 'cr', no: 4, d: '2026-11-15', draft: true, biz: BIZ, cust: { name: 'א' }, vm: 'ex', rate: 18, lines: [{ n: 'כוס', q: 2, p: 6.25 }] };
    const pg = extract(await P.render(Object.assign({ refTxt: 'זיכוי לחשבונית מס מספר 12 (טיוטה)' }, base)))[0];
    assert.ok(has(pg, '(הטויט) 12 רפסמ סמ תינובשחל יוכיז'), pg.join('\n'));
    assert.ok(has(pg, P.visual('חשבונית מס זיכוי')));
    const pg2 = extract(await P.render(Object.assign({ refTxt: 'זיכוי לחשבונית מס קבלה מספר 7' }, base, { draft: false })))[0];
    assert.ok(has(pg2, '7 רפסמ הלבק סמ תינובשחל יוכיז'), pg2.join('\n'));
    assert.ok(!extract(await P.render(base))[0].some((l) => l.includes(rev('זיכוי לחשבונית'))));
  });
  it('טבלה כללית (קבלה / כרטסת) עם סיכומים', async () => {
    const pg = extract(await P.render({ t: 'rc', no: 3, d: '2026-11-14', biz: BIZ, cust: { name: 'א' }, table: { head: ['תאריך', 'אמצעי', 'סכום'], rows: [['14/11/2026', 'העברה', 500], ['14/11/2026', 'צ׳ק 1234', 734.5]], num: [2] }, sums: [['סה״כ שולם', 1234.5]] }))[0];
    assert.ok(has(pg, '₪734.50') && has(pg, '1234 ק׳צ'));
    assert.ok(pg.some((l) => l.startsWith('₪1,234.50') && l.endsWith(P.visual('סה״כ שולם'))));
  });
});
