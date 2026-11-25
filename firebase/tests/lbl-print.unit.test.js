'use strict';
// הדפסת מדבקות (22.11.2026) – app-source/www/lbl-print.js, החלק הטהור: בלי אמולטור ובלי דפדפן.
// עמוד PDF לכל מדבקה בגודל 50×25 מ"מ בדיוק, Code128-B (ספרת ביקורת וקידוד, פענוח חזרה), EAN-13 זהה ל-PosBarcode, מחיר ליחידת מידה.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const WWW = path.resolve(__dirname, '..', '..', 'app-source', 'www');
const PB = require(path.join(WWW, 'pos-barcode.js'));
const LP = require(path.join(WWW, 'lbl-print.js'));

// פענוח פסי Code128 בחזרה לטקסט – מתוך רוחבי הפסים בלבד (לא משתמש בפונקציית הקידוד)
function decode128(bars) {
  const runs = [];
  for (let i = 0; i < bars.length;) { let j = i; while (j < bars.length && bars[j] === bars[i]) j++; runs.push(j - i); i = j; }
  const idx = new Map(LP.P128.map((p, v) => [p, v]));
  const vals = [];
  let k = 0;
  while (k < runs.length) {
    const w = runs.length - k === 7 ? 7 : 6;
    const v = idx.get(runs.slice(k, k + w).join(''));
    assert.ok(v !== undefined, 'רצף פסים לא מוכר במקום ' + k);
    vals.push(v); k += w;
  }
  assert.equal(vals[0], 104, 'Start B');
  assert.equal(vals[vals.length - 1], 106, 'Stop');
  const data = vals.slice(1, -2), ck = vals[vals.length - 2];
  const sum = data.reduce((s, v, i) => s + v * (i + 1), 104);
  assert.equal(ck, sum % 103, 'ספרת ביקורת');
  return data.map((v) => String.fromCharCode(v + 32)).join('');
}

function pdfInfo(u8) {
  const s = Buffer.from(u8).toString('latin1');
  const boxes = [...s.matchAll(/\/Type \/Page \/Parent[^\n]*?\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
  const count = +(s.match(/\/Type \/Pages \/Count (\d+)/) || [])[1];
  return { s, boxes, count };
}
const fake = (w, h, rects) => ({ w, h, bits: new Uint8Array(Math.ceil(w / 8) * h).fill(255), rects: rects || [] });

describe('lbl-print – הדפסת מדבקות', () => {
  it('טבלת Code128: 107 ערכים, כל תו 11 מודולים (Stop 13), בלי כפילויות; Start B ו-Stop לפי התקן', () => {
    assert.equal(LP.P128.length, 107);
    LP.P128.forEach((p, i) => assert.equal([...p].reduce((s, d) => s + +d, 0), i === 106 ? 13 : 11, 'ערך ' + i));
    assert.equal(new Set(LP.P128).size, 107);
    const b = (p) => [...p].map((d, i) => (i % 2 ? '0' : '1').repeat(+d)).join('');
    assert.equal(b(LP.P128[104]), '11010010000');
    assert.equal(b(LP.P128[106]), '1100011101011');
    assert.equal(b(LP.P128[0]), '11011001100');
  });

  it("Code128-B: '63621060' – ערכים, ספרת ביקורת, ופענוח חזרה", () => {
    const r = LP.code128('63621060');
    // '6'=22 '3'=19 '6'=22 '2'=18 '1'=17 '0'=16 '6'=22 '0'=16; 104+22+38+66+72+85+96+154+128 = 765; 765 % 103 = 44
    assert.deepEqual(r.codes, [104, 22, 19, 22, 18, 17, 16, 22, 16, 44, 106]);
    assert.equal(r.bars.length, 10 * 11 + 13);
    assert.equal(decode128(r.bars), '63621060');
    assert.equal(PB.bars('63621060'), '', 'לא EAN-8 תקין');
    assert.deepEqual(LP.barsFor('63621060'), { kind: 'c128', bars: r.bars });
  });

  it("Code128-B: 'ABC-123' – ערכים, ספרת ביקורת 70, ופענוח חזרה", () => {
    const r = LP.code128('ABC-123');
    // 104 + 33·1 + 34·2 + 35·3 + 13·4 + 17·5 + 18·6 + 19·7 = 688; 688 % 103 = 70
    assert.deepEqual(r.codes, [104, 33, 34, 35, 13, 17, 18, 19, 70, 106]);
    assert.equal(decode128(r.bars), 'ABC-123');
    assert.throws(() => LP.code128('שלום'));
    assert.throws(() => LP.code128(''));
    assert.deepEqual(LP.barsFor('שלום'), { kind: '', bars: '' });
  });

  it('EAN-13 / EAN-8 תקינים – אותם פסים כמו PosBarcode.bars', () => {
    for (const c of ['5901234123457', '7290000068183', PB.internal('200', 17)]) assert.deepEqual(LP.barsFor(c), { kind: 'ean13', bars: PB.bars(c) });
    assert.deepEqual(LP.barsFor('96385074'), { kind: 'ean8', bars: PB.bars('96385074') });
    assert.equal(LP.barsFor('5901234123458').kind, 'c128', 'ספרת ביקורת שגויה – Code128');
    assert.deepEqual(LP.barsFor(''), { kind: '', bars: '' });
  });

  it('מחיר ליחידת מידה: ל-100 גרם (גרם / ק"ג) ולליטר (מ"ל / ליטר)', () => {
    assert.deepEqual(LP.unitPrice(12.9, '500 גרם'), { per: '100 גרם', v: 2.58 });
    assert.deepEqual(LP.unitPrice('19.90', '1 ק"ג'), { per: '100 גרם', v: 1.99 });
    assert.deepEqual(LP.unitPrice(7.5, '1.5 ליטר'), { per: 'ליטר', v: 5 });
    assert.deepEqual(LP.unitPrice(9, '750 מ"ל'), { per: 'ליטר', v: 12 });
    assert.deepEqual(LP.unitPrice(5, "250ג'"), { per: '100 גרם', v: 2 });
    assert.deepEqual(LP.unitPrice(10, '0,5 kg'), { per: '100 גרם', v: 2 });
    assert.equal(LP.unitPrice(10, ''), null);
    assert.equal(LP.unitPrice(10, '3 יחידות'), null);
    assert.equal(LP.unitPrice('', '500 גרם'), null);
    assert.equal(LP.unitPrice(10, '0 גרם'), null);
  });

  it('PDF: מספר העמודים = סכום הכמויות; כל עמוד MediaBox 0 0 141.73 70.87 (50×25 מ"מ)', () => {
    const basket = [{ n: 3 }, { n: 1 }, { n: 5 }];
    const seq = LP.expand(basket);
    assert.deepEqual(seq, [0, 0, 0, 1, 2, 2, 2, 2, 2]);
    const pdf = LP.mkPdf(basket.map(() => fake(LP.W, LP.H, [[10, 20, 3, 100]])), seq);
    const { s, boxes, count } = pdfInfo(pdf);
    assert.ok(s.startsWith('%PDF-1.4'));
    assert.ok(s.trimEnd().endsWith('%%EOF'));
    assert.equal(count, 9);
    assert.equal(boxes.length, 9);
    for (const b of boxes) {
      assert.equal(b.length, 4);
      assert.equal(b[0], 0); assert.equal(b[1], 0);
      assert.ok(Math.abs(b[2] - 141.73) <= 0.01, 'רוחב ' + b[2]);
      assert.ok(Math.abs(b[3] - 70.87) <= 0.01, 'גובה ' + b[3]);
    }
    assert.ok(Math.abs(LP.PW - 50 / 25.4 * 72) < 1e-9 && Math.abs(LP.PH - 25 / 25.4 * 72) < 1e-9);
    // תמונה ותוכן אחד לכל מדבקה ייחודית, לא לכל עותק
    assert.equal((s.match(/\/Subtype \/Image/g) || []).length, 3);
  });

  it('PDF: טבלת xref מצביעה בדיוק על כל אובייקט; הפסים מומרים לנקודות (0 בתחתית העמוד)', () => {
    const pdf = LP.mkPdf([fake(LP.W, LP.H, [[0, 0, LP.W, LP.H / 2]])], LP.expand([{ n: 2 }]));
    const s = Buffer.from(pdf).toString('latin1');
    const xr = +s.match(/startxref\n(\d+)/)[1];
    assert.ok(s.slice(xr).startsWith('xref\n'));
    const offs = s.slice(xr).split('\n').slice(3).filter((l) => / 00000 n $/.test(l)).map((l) => +l.slice(0, 10));
    offs.forEach((o, i) => assert.ok(s.slice(o).startsWith((i + 1) + ' 0 obj'), 'אובייקט ' + (i + 1)));
    assert.match(s, /0 35\.433 141\.732 35\.433 re/);
    assert.equal(LP.expand([{ n: 0 }, { n: 500 }, { n: 'x' }]).length, 1 + 500 + 1, 'כמות 1–999');
    assert.equal(LP.expand([{ n: 999 }, { n: 1000 }, { n: 5000 }]).length, 3 * 999, 'עד 999 בשורה');
  });

  it('toBits: 1 ביט לפיקסל, לבן = 1, שורות מרופדות לבית', () => {
    const w = 10, h = 2, d = new Uint8ClampedArray(w * h * 4).fill(255);
    for (const x of [0, 9]) { const i = x * 4; d[i] = d[i + 1] = d[i + 2] = 0; }
    const b = LP.toBits(d, w, h);
    assert.equal(b.length, 4);
    assert.deepEqual([...b], [0x7f, 0x80, 0xff, 0xc0]);
  });
  // לוגו וחותמת כשרות (24.11.2026)
  it('layBox: top – פס 64 והתוכן מוקטן (~78%) וממורכז; bot – קופסאות 64×64 בפינות התחתונות בתוך המדבקה, והשורה התחתונה מוצרת מהן', () => {
    const t = LP.layBox('top');
    assert.ok(Math.abs(t.t.s - (LP.H - 64) / LP.H) < 1e-12 && t.t.s > 0.77 && t.t.s < 0.79);
    assert.equal(t.t.dy, 64);
    assert.ok(Math.abs(t.t.dx * 2 + LP.W * t.t.s - LP.W) <= 1, 'ממורכז');
    assert.equal(t.ib, 0);
    for (const r of [t.logo, t.stamp]) assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= LP.W && r[1] + r[3] <= 64, 'בתוך הפס ' + r);
    assert.ok(t.logo[0] > t.stamp[0] + t.stamp[2], 'לוגו מימין, חותמת משמאל, בלי חפיפה');
    const b = LP.layBox('bot');
    assert.equal(b.t, null);
    assert.deepEqual([b.logo[2], b.logo[3], b.stamp[2], b.stamp[3]], [64, 64, 64, 64]);
    assert.ok(b.logo[0] + 64 <= LP.W && b.logo[1] + 64 <= LP.H && b.stamp[0] >= 0 && b.stamp[1] + 64 <= LP.H);
    assert.ok(b.logo[0] > LP.W / 2 && b.stamp[0] < LP.W / 2, 'לוגו בימין, חותמת בשמאל');
    assert.ok(14 + b.ib >= b.stamp[0] + 64 && LP.W - 14 - b.ib <= b.logo[0], 'השורה התחתונה לא נוגעת בקופסאות');
    assert.equal(LP.layBox(''), null);
    assert.equal(LP.layBox('x'), null);
  });

  it('xfRects: מלבני ברקוד עוברים את אותה הקטנה והזזה של התצוגה; בלי טרנספורם – אותו מערך', () => {
    const t = LP.layBox('top').t, R = [[0, 0, 10, 100], [100, 86, 4, 116]];
    const X = LP.xfRects(R, t);
    assert.deepEqual(X[0], [t.dx, t.dy, 10 * t.s, 100 * t.s]);
    assert.deepEqual(X[1], [100 * t.s + t.dx, 86 * t.s + t.dy, 4 * t.s, 116 * t.s]);
    for (const r of X) assert.ok(r[0] >= 0 && r[1] >= 64 && r[0] + r[2] <= LP.W && r[1] + r[3] <= LP.H);
    assert.equal(LP.xfRects(R, null), R);
    assert.deepEqual(LP.xfRects(null, t), []);
  });

  it('bw1: שחור-לבן לפי סף; שקיפות = לבן; האלפא 255', () => {
    // 4 פיקסלים: שחור, אפור 120, לבן, שחור שקוף לגמרי
    const d = new Uint8ClampedArray([0, 0, 0, 255, 120, 120, 120, 255, 255, 255, 255, 255, 0, 0, 0, 0]);
    LP.bw1(d, 4, 1);
    assert.deepEqual([...d], [0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    const e = new Uint8ClampedArray([120, 120, 120, 255, 0, 0, 0, 64]);
    LP.bw1(e, 2, 1, 100);
    assert.deepEqual([...e], [255, 255, 255, 255, 255, 255, 255, 255], 'סף 100: אפור 120 לבן; שחור ב-25% אטימות (בהירות ~191) לבן');
    const f = new Uint8ClampedArray([255, 0, 0, 255]);
    assert.equal(LP.bw1(f, 1, 1), f, 'מחזיר את אותו מערך');
    assert.deepEqual([...f], [0, 0, 0, 255], 'אדום (בהירות 76) – שחור');
  });

  it('imgOk: רק PNG ב-data URL, עד 40,000 תווים', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    assert.equal(LP.imgOk(png), true);
    assert.equal(LP.imgOk('data:image/png;base64,' + 'A'.repeat(40000 - 22)), true);
    assert.equal(LP.imgOk('data:image/png;base64,' + 'A'.repeat(40000 - 21)), false, 'מעל 40,000');
    assert.equal(LP.imgOk(png.replace('png', 'jpeg')), false);
    assert.equal(LP.imgOk('data:image/svg+xml;base64,PHN2Zz4='), false);
    assert.equal(LP.imgOk('data:image/png;base64,abc"><script>'), false);
    assert.equal(LP.imgOk(''), false);
    assert.equal(LP.imgOk(null), false);
    assert.equal(LP.imgOk({}), false);
  });

  it('mkPdf עם גודל לכל מדבקה (pw/ph): MediaBox לפי המדבקה, הפסים מומרים לפי הגודל שלה; בלי pw/ph – בדיוק כמו קודם', () => {
    const pw = 40 / 25.4 * 72, ph = 30 / 25.4 * 72, w = 472, h = 354;
    const L = [fake(LP.W, LP.H, [[0, 0, LP.W, LP.H / 2]]), Object.assign(fake(w, h, [[0, 0, w, h / 2]]), { pw, ph })];
    const { s, boxes, count } = pdfInfo(LP.mkPdf(L, [0, 1, 1]));
    assert.equal(count, 3);
    assert.deepEqual(boxes.map((b) => b.join(' ')), ['0 0 141.73 70.87', '0 0 113.39 85.04', '0 0 113.39 85.04']);
    assert.match(s, /q 113\.39 0 0 85\.04 0 0 cm \/Im0 Do Q\n0 g\n0 42\.52 113\.386 42\.52 re/);
    assert.match(s, /\/Width 472 \/Height 354/);
    const L2 = [fake(LP.W, LP.H, [[1, 2, 3, 4]])], a = LP.mkPdf(L2, [0, 0]), b = LP.mkPdf([Object.assign({}, L2[0], { pw: undefined, ph: 0 })], [0, 0]);
    assert.deepEqual([...a], [...b]);
  });

  it('mkPdf בלי לוגו – בדיוק אותם בייטים כמו לפני השינוי (טביעת SHA-256)', () => {
    const crypto = require('node:crypto');
    const bits = new Uint8Array(Math.ceil(LP.W / 8) * LP.H);
    for (let i = 0; i < bits.length; i++) bits[i] = (i * 37 + 11) & 255;
    const L = [{ w: LP.W, h: LP.H, bits, rects: [[10, 20, 4, 100], [30.5, 20, 8, 100]] }, { w: LP.W, h: LP.H, bits: bits.slice().reverse(), rects: [] }];
    const h = crypto.createHash('sha256').update(LP.mkPdf(L, LP.expand([{ n: 2 }, { n: 1 }]))).digest('hex');
    assert.equal(h, '86746cd26819a4632317386dd72e92c5a72664055beb98b2828d72dcf2130f12');
  });
});
