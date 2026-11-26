'use strict';
// קופה – אשף ייבוא מכספיט (17.11.2026, ענף feature/pos-import): בדיקות בלי אמולטור.
//   הליבה של המכשיר (app-source/www/pos-import.js): קידוד windows-1255 / UTF-8, CSV, Excel של 5,200 שורות, ניחוש עמודות,
//   מחיר כולל / לפני מע"מ, שגויים, לא פעילים, כפולים בקובץ ומול המערכת.
//   ניקוי השורה בשרת (functions/pos-import.js): אותם כללים.
// כל קבצי הדוגמה מומצאים ומסומנים כדוגמה (tests/fixtures/pos-import/README.md).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..', '..');
const P = require(path.join(ROOT, 'app-source', 'www', 'pos-import.js'));
const FN = path.join(ROOT, 'firebase', 'functions');
const FX = path.join(__dirname, 'fixtures', 'pos-import');
const bytes = (f) => new Uint8Array(fs.readFileSync(path.join(FX, f)));

// כמו המסך: קריאה ← שורת כותרות ← ניחוש עמודות (כל שדה פעם אחת)
function open(name, b, kind, XL) {
  const rd = P.readRows(name, b, XL);
  const rows = rd.rows.filter(P.filled);
  const h = P.headerAt(rows);
  const H = rows[h].map((x) => String(x == null ? '' : x).trim());
  const used = new Set();
  const map = H.map((x) => { const g = P.guess(kind, x); if (!g || used.has(g)) return ''; used.add(g); return g; });
  return { rd, H, R: rows.slice(h + 1), first: h + 2, map };
}

describe('אשף ייבוא מכספיט – ליבת המכשיר', () => {
  it('CSV ב-windows-1255: עברית נקראת, שורת הכותרת של הדוח מדולגת, עמודות מזוהות', () => {
    const f = open('SAMPLE-products-windows-1255.csv', bytes('SAMPLE-products-windows-1255.csv'), 'prod');
    assert.equal(f.rd.enc, 'windows-1255');
    assert.deepEqual(f.H, ['ברקוד', 'שם פריט', 'מחיר מכירה', 'מחיר עלות', 'מחלקה', 'פעיל']);
    assert.deepEqual(f.map, ['barcode', 'name', 'price', 'cost', 'cat', 'active']);
    assert.equal(f.first, 3); // שורה 1 = כותרת הדוח, שורה 2 = כותרות
    const list = P.build('prod', f.R, f.map, { vatIn: true }, f.first);
    const by = Object.fromEntries(list.map((x) => [x.n, x]));
    assert.equal(by[3].row.name, 'צלחות 20 יח׳ (דוגמה)');
    assert.equal(by[3].row.price, 12.9);
    assert.equal(by[3].row.cost, 7.5);
    assert.equal(by[3].row.barcode, '7290000001012');
    assert.equal(by[4].row.name, 'כוסות "שקופות" 50 יח׳ (דוגמה)', 'מירכאות כפולות בתוך תא');
    assert.equal(by[8].st, 'off', 'מוצר לא פעיל – לא מייבאים (C19-015)');
    assert.equal(by[9].st, 'ok', 'P1: בלי מחיר – נקלט ומסומן'); assert.equal(by[9].row.price, 0); assert.match(by[9].why, /חסר מחיר/);
    assert.equal(by[10].st, 'ok', 'P1: ברקוד ישן לא תקין – נקלט בלי ברקוד, לבדיקה'); assert.equal(by[10].row.barcode, undefined); assert.equal(by[10].row.bcRaw, '7.29E+12'); assert.match(by[10].why, /לבדיקה/);
    assert.equal(by[11].row.price, 1234.5, 'פסיק אלפים');
    assert.equal(by[7].row.barcode, undefined, 'בלי ברקוד');
    const pv = P.classify(list, new Set());
    assert.deepEqual([pv.add, pv.dup, pv.bad, pv.off], [7, 1, 0, 1]);
    assert.match(list.find((x) => x.n === 6).why, /כפול בקובץ \(כמו שורה 3\)/);
  });

  it('CSV ב-UTF-8 עם BOM, מפריד ";", פסיק עשרוני, מחיר לפני מע"מ → כולל מע"מ 18%', () => {
    const f = open('SAMPLE-products-utf8-bom-ex-vat.csv', bytes('SAMPLE-products-utf8-bom-ex-vat.csv'), 'prod');
    assert.equal(f.rd.enc, 'utf-8');
    assert.deepEqual(f.map, ['sku', 'barcode', 'name', 'priceEx', 'cat']);
    const list = P.build('prod', f.R, f.map, { vatIn: true, rate: 18 }, f.first);
    assert.deepEqual(list.map((x) => x.row.price), [11.8, 9.99, 1]);
    assert.equal(list[0].row.sku, 'A-1');
    assert.equal(list[2].row.barcode, undefined);
  });

  it('מחיר "מחיר מכירה" שמוגדר "לפני מע"מ" – מוסיפים את שיעור המע"מ שנבחר', () => {
    const R = [['1', 'א (דוגמה)', 100], ['2', 'ב (דוגמה)', '84,75']];
    const map = ['barcode', 'name', 'price'];
    assert.deepEqual(P.build('prod', R, map, { vatIn: false, rate: 18 }).map((x) => [x.st, x.row.bcRaw]), [['ok', '1'], ['ok', '2']], 'ברקוד קצר מ-3 – נקלט בלי ברקוד, לבדיקה (P1)');
    const R2 = [['111', 'א (דוגמה)', 100], ['222', 'ב (דוגמה)', '84,75']];
    assert.deepEqual(P.build('prod', R2, map, { vatIn: false, rate: 18 }).map((x) => x.row.price), [118, 100.01]);
    assert.deepEqual(P.build('prod', R2, map, { vatIn: true }).map((x) => x.row.price), [100, 84.75]);
  });

  it('מיפוי מחלקות: קטגוריה קיימת (cid), חדשה (cat), בלי קטגוריה', () => {
    const R = [['111', 'א', 1, 'מאפים'], ['222', 'ב', 1, 'חד פעמי'], ['333', 'ג', 1, 'שונות']];
    const map = ['barcode', 'name', 'price', 'cat'];
    assert.deepEqual(P.distinctCats(R, map), ['חד פעמי', 'מאפים', 'שונות']);
    const list = P.build('prod', R, map, { cats: { 'מאפים': { cid: 'c_bake' }, 'חד פעמי': { cat: 'חד פעמי' }, 'שונות': null } });
    assert.equal(list[0].row.cid, 'c_bake'); assert.equal(list[0].row.cat, undefined);
    assert.equal(list[1].row.cat, 'חד פעמי');
    assert.equal(list[2].row.cat, undefined); assert.equal(list[2].row.cid, undefined);
  });

  it('לקוחות ב-windows-1255: טלפונים מנורמלים, ת"ז נבדקת, כפול בקובץ, חסר מפתח', () => {
    const f = open('SAMPLE-customers-windows-1255.csv', bytes('SAMPLE-customers-windows-1255.csv'), 'cust');
    assert.equal(f.rd.enc, 'windows-1255');
    assert.deepEqual(f.map, ['name', 'phone', 'tz', 'mail']);
    const list = P.build('cust', f.R, f.map, {}, f.first);
    assert.equal(list[0].row.phone, '0500000001'); assert.equal(list[0].row.mail, 'a@example.invalid');
    assert.equal(list[1].row.phone, '0500000002'); assert.equal(list[1].row.tz, '000000018');
    assert.equal(list[2].row.phone, '0500000003', 'Excel מחק את ה-0');
    const pv = P.classify(list, new Set([1])); // השרת: הלקוח השני כבר קיים
    assert.deepEqual([pv.add, pv.dup, pv.bad], [2, 2, 3]);
    assert.equal(list[1].why, 'קיים במערכת – דילגתי');
    assert.match(list[3].why, /כפול בקובץ/);
    assert.match(list[4].why, /טלפון או ת"ז/);
    assert.match(list[5].why, /טלפון/);
    assert.match(list[6].why, /ספרת ביקורת/);
  });

  it('מפתחות לבדיקה בשרת – לפי סדר השורות התקינות; אינדקס ex מהשרת מסמן את השורה הנכונה', () => {
    const R = [['111', 'א', 1], ['', 'ב בלי ברקוד', 2], ['x', 'שגוי', 3], ['333', 'ג', 4]];
    const list = P.build('prod', R, ['barcode', 'name', 'price'], {});
    assert.deepEqual(P.checkKeys('prod', list), [{ bc: '111' }, { nm: 'ב בלי ברקוד' }, { nm: 'שגוי' }, { bc: '333' }]);
    P.classify(list, new Set([3])); // הרביעי ברשימת הבדיקה = '333'
    assert.equal(list[3].st, 'dup'); assert.equal(list[0].st, 'ok');
  });

  it('שדה טקסט עם 8 ספרות ומעלה (הגנה מפני מספר כרטיס) – שגוי כבר במכשיר', () => {
    const list = P.build('prod', [['111', 'מוצר 1234 5678 9012', 5]], ['barcode', 'name', 'price'], {});
    assert.equal(list[0].st, 'bad');
  });

  it('Excel של 5,200 מוצרים (נוצר בבדיקה, נתונים מומצאים): נקרא, נבנה ומסווג מהר; ברקוד מספרי הופך לטקסט', () => {
    const aoa = [['ברקוד', 'שם פריט', 'מחיר מכירה', 'מחלקה']];
    const BC = require(path.join(ROOT, 'app-source', 'www', 'pos-barcode.js'));
    for (let i = 0; i < 5200; i++) aoa.push([+BC.internal('729', 100000 + (i % 5000)), `מוצר דוגמה ${i % 5000}`, 1 + (i % 97) / 10, i % 2 ? 'מאפים' : 'חד פעמי']);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'דוגמה');
    const buf = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const t0 = Date.now();
    const f = open('SAMPLE-5200.xlsx', buf, 'prod', XLSX);
    assert.equal(f.rd.src, 'xlsx');
    assert.equal(f.R.length, 5200);
    const list = P.build('prod', f.R, f.map, { vatIn: true }, f.first);
    assert.equal(P.checkKeys('prod', list).length, 5200, 'כל השורות נשלחות לבדיקת כפילות (11 קריאות של 500)');
    const pv = P.classify(list, new Set([0, 1, 2]));
    const ms = Date.now() - t0;
    assert.equal(list[0].row.barcode, BC.internal('729', 100000));
    assert.deepEqual([pv.add, pv.dup, pv.bad], [4997, 203, 0]); // 3 קיימים + 200 כפולים בקובץ (3 מהם כפולים של קיימים)
    assert.equal(list[5000].st, 'dup', 'שורה כפולה של רשומה קיימת – גם היא לא חדשה');
    assert.ok(ms < 5000, `5,200 שורות ב-${ms}ms`);
  });

  it('קובץ xls ישן בעברית (codepage 1255) נקרא', () => {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ברקוד', 'שם פריט', 'מחיר'], ['111', 'לחמניה (דוגמה)', 2.5]]), 'S');
    const buf = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'biff8' }));
    const f = open('SAMPLE.xls', buf, 'prod', XLSX);
    assert.equal(P.build('prod', f.R, f.map, {}, f.first)[0].row.name, 'לחמניה (דוגמה)');
  });

  it('קבצי הדוגמה מסומנים כדוגמה ואין בהם נתונים אמיתיים', () => {
    const readme = fs.readFileSync(path.join(FX, 'README.md'), 'utf8');
    assert.match(readme, /דוגמה עם נתונים מומצאים/);
    for (const f of fs.readdirSync(FX).filter((x) => x.endsWith('.csv'))) {
      assert.match(f, /^SAMPLE-/);
      const t = P.decode(bytes(f)).text;
      assert.match(t, /דוגמה/);
      for (const m of t.match(/0?5\d[\d-]{7,9}/g) || []) assert.match(m.replace(/\D/g, ''), /^0?500000/, 'טלפון לא מומצא: ' + m);
    }
  });
});

describe('אשף ייבוא מכספיט – ניקוי שורה בשרת', () => {
  require(path.join(FN, 'index.js'));
  const S = require(path.join(FN, 'pos-import.js'))._core;
  const rs = (fn) => { try { fn(); return 'ok'; } catch (e) { return S.reasonOf(e); } };
  it('מוצר: שם ומחיר חובה, ברקוד, קטגוריה קיימת או חדשה, שדה לא מוכר נדחה', () => {
    assert.deepEqual(S.prodRow({ n: 3, name: ' צלחות ', price: 12.9, barcode: '7290000001012', cost: 7.5, cid: 'c_x' }), { n: 3, name: 'צלחות', price: 12.9, barcode: '7290000001012', cost: 7.5, cid: 'c_x' });
    assert.equal(rs(() => S.prodRow({ name: 'x', price: -1 })), 'bad-price');
    assert.equal(rs(() => S.prodRow({ name: '', price: 1 })), 'bad-name');
    assert.equal(rs(() => S.prodRow({ name: 'x', price: 1, barcode: '7.29E+12' })), 'bad-barcode', 'תווים אסורים – נדחה בשרת (המכשיר שולח bcRaw)');
    assert.deepEqual(S.prodRow({ name: 'x', price: 0, barcode: '5901234123458' }), { n: undefined, name: 'x', price: 0, barcode: '', bcRaw: '5901234123458', cat: 'ללא קטגוריה' }, 'ספרת ביקורת שגויה – לבדיקה; בלי קטגוריה – "ללא קטגוריה" (26.11.2026)');
    assert.equal(S.prodRow({ name: 'x', price: 1, bcRaw: '7.29E+12' }).bcRaw, '7.29E+12');
    assert.equal(rs(() => S.prodRow({ name: 'x', price: 1, on: false })), 'bad-field');
    assert.equal(rs(() => S.prodRow({ name: 'מוצר 1234567890', price: 1 })), 'card-like');
  });
  it('לקוח: טלפון או ת"ז חובה, אותה נורמליזציה כמו במכשיר', () => {
    assert.deepEqual(S.custRow({ n: 2, name: 'א', phone: '+972500000002', tz: '000000018' }), { n: 2, name: 'א', phone: '0500000002', tz: '000000018' });
    assert.equal(rs(() => S.custRow({ name: 'א' })), 'no-key');
    assert.equal(rs(() => S.custRow({ name: 'א', tz: '123456789' })), 'bad-tz');
    assert.equal(rs(() => S.custRow({ name: 'א', phone: '0500000001', mail: 'x' })), 'bad-mail');
    for (const ph of ['050-0000001', '500000003', '+972500000002']) assert.equal(S.custRow({ name: 'א', phone: ph }).phone, P.phoneOf(ph).v);
  });
});
