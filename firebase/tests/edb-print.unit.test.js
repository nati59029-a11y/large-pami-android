'use strict';
// הדפסת דף אכיל (26.11.2026) – app-source/www/edb-print.js, החלק הטהור (EdbCore): בלי אמולטור ובלי דפדפן.
// פריסות A4 (עיגולים / ריבועים 6/12/24/36, A5×2, A4 מלא, גודל חופשי), מד איכות DPI, PDF בגודל A4 בדיוק, חשבון הכיול.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const WWW = path.resolve(__dirname, '..', '..', 'app-source', 'www');
const EC = require(path.join(WWW, 'edb-print.js'));
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= (e || 0.01), (m || '') + ` ${a} ≠ ${b}`);
// כל הפריטים בתוך השוליים, בלי חפיפה, ורווח של 3 מ"מ לפחות ביניהם
function sane(L) {
  const m = EC.PG.m - 1e-6;
  for (const q of L.slots) { assert.ok(q.x >= m && q.y >= m && q.x + q.w <= 210 - m && q.y + q.h <= 297 - m, 'בתוך השוליים ' + JSON.stringify(q)); }
  for (let i = 0; i < L.slots.length; i++) for (let j = i + 1; j < L.slots.length; j++) {
    const a = L.slots[i], b = L.slots[j], gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    assert.ok(Math.max(gx, gy) >= 3 - 1e-6, `רווח בין ${i} ל-${j}`);
  }
}

describe('edb-print – פריסות A4', () => {
  const EXP = { 6: [2, 3, 93.67], 12: [3, 4, 64.67], 24: [4, 6, 45.33], 36: [6, 6, 30.83] }; // 36 = 6×6 מסודר (בחירת בעל העסק, סבב 2)
  for (const sh of ['c', 's']) for (const n of [6, 12, 24, 36]) {
    it(`${sh === 'c' ? 'עיגולים' : 'ריבועים'} ${n}: רשת ${EXP[n][0]}×${EXP[n][1]}, ${EXP[n][2]} מ"מ`, () => {
      const L = EC.layout(sh + n);
      assert.equal(L.shape, sh); assert.equal(L.n, n); assert.equal(L.slots.length, n);
      assert.equal(L.cols, EXP[n][0]); assert.equal(L.rows, EXP[n][1]);
      near(L.w, EXP[n][2], 0.01); assert.equal(L.w, L.h);
      sane(L);
    });
  }
  it('הרשת הנבחרת היא הגדולה ביותר מכל האפשרויות (בפריסות הקבועות – מבין הרשתות המלאות, בלי שורה חלקית)', () => {
    for (const n of [6, 12, 24, 36]) {
      const b = EC.fitGrid(n), f = EC.fitGrid(n, 0, 0, null, true);
      assert.equal(f.cols * f.rows, n, `${n}: רשת מלאה`);
      for (let c = 1; c <= n; c++) {
        const r = Math.ceil(n / c), s = Math.min((200 - (c - 1) * 3) / c, (287 - (r - 1) * 3) / r);
        assert.ok(s <= b.s + 1e-9);
        if (c * r === n) assert.ok(s <= f.s + 1e-9);
      }
      const L = EC.layout('c' + n); assert.equal(L.cols * L.rows, n, `c${n}: אין משבצות ריקות`);
    }
    assert.deepEqual([EC.fitGrid(36).cols, EC.fitGrid(36).rows], [5, 8], 'בלי full – עדיין 5×8 (לגודל חופשי ולבדיקה)');
    assert.deepEqual([EC.fitGrid(7, 0, 0, null, true).cols, EC.fitGrid(7, 0, 0, null, true).rows].sort(), [1, 7], 'מספר ראשוני – רשת מלאה 1×7');
  });
  it('A5 ×2: שני חלקים 200×142 מ"מ, אחד מתחת לשני; A4 מלא: 200×287', () => {
    const L = EC.layout('a5');
    assert.equal(L.n, 2); assert.equal(L.shape, 'r'); near(L.w, 200); near(L.h, 142);
    near(L.slots[0].y, 5); near(L.slots[1].y, 5 + 142 + 3); sane(L);
    const F = EC.layout('full'); assert.equal(F.n, 1); near(F.w, 200); near(F.h, 287); near(F.slots[0].x, 5); near(F.slots[0].y, 5);
  });
  it('36 עיגולים: 6×6 ממורכז בדף; place – שורה אחרונה חלקית עדיין ממורכזת (5×8 עם פריט אחד בשורה האחרונה)', () => {
    const L = EC.layout('c36');
    near(L.slots[0].x + (L.slots[5].x + L.w - L.slots[0].x) / 2, 105, 0.001);
    near(L.slots[0].y + (L.slots[35].y + L.h - L.slots[0].y) / 2, 148.5, 0.001);
    const P = EC.place(5, 8, 33.25, 33.25, 36), last = P[35];
    near(last.x + last.w / 2, 105, 0.001);
  });
  it('גודל חופשי: הכמות מחושבת לבד; גדול מדי = 0 ולא נשבר', () => {
    const L = EC.layout('cu', { sh: 'c', w: 50 }); // (200+3)/53 = 3, (287+3)/53 = 5
    assert.equal(L.cols, 3); assert.equal(L.rows, 5); assert.equal(L.n, 15); sane(L);
    const R = EC.layout('cu', { sh: 'r', w: 90, h: 40 }); assert.equal(R.n, 2 * 6); assert.equal(R.shape, 'r'); sane(R);
    const B = EC.layout('cu', { sh: 's', w: 200 }); assert.equal(B.n, 1);
    assert.match(EC.layTxt(EC.layout('c12')), /12 עיגולים בקוטר 6\.5 ס"מ/);
    // סבב 2: הגדלים בכפתורים ובשורת הסיכום – בס"מ, ספרה אחת
    assert.equal(EC.laySz(EC.layout('c12')), 'קוטר 6.5 ס"מ'); assert.equal(EC.laySz(EC.layout('c36')), 'קוטר 3.1 ס"מ');
    assert.equal(EC.laySz(EC.layout('s24')), 'צלע 4.5 ס"מ'); assert.equal(EC.laySz(EC.layout('full')), '20.0×28.7 ס"מ');
    assert.equal(EC.laySz(EC.layout('a5')), '20.0×14.2 ס"מ'); assert.match(EC.layTxt(EC.layout('a5')), /2 חלקים של 20\.0×14\.2 ס"מ/);
  });
});

describe('edb-print – איכות (DPI)', () => {
  it('DPI אפקטיבי: תמונה שממלאת משבצת', () => {
    assert.equal(EC.dpi(3000, 3000, 25.4 * 10, 25.4 * 10, 1, 0), 300);
    assert.equal(EC.dpi(3000, 3000, 25.4 * 10, 25.4 * 10, 2, 0), 150); // זום פי 2 = חצי
    assert.equal(EC.dpi(4000, 2000, 25.4 * 10, 25.4 * 10, 1, 0), 200); // הצד הקצר קובע (cover)
    assert.equal(EC.dpi(2000, 4000, 25.4 * 20, 25.4 * 10, 1, 90), 200); // סיבוב 90 – הצדדים מתחלפים
    assert.equal(EC.dpi(0, 100, 10, 10, 1, 0), 0);
  });
  it('דירוג: ירוק ≥250, צהוב 150–249, אדום <150', () => {
    assert.deepEqual(EC.grade(250), { c: 'g', t: 'מצוין' });
    assert.deepEqual(EC.grade(249), { c: 'y', t: 'סביר' });
    assert.deepEqual(EC.grade(150), { c: 'y', t: 'סביר' });
    assert.deepEqual(EC.grade(149), { c: 'r', t: 'תצא מטושטשת' });
  });
  it('הקטנה בטעינה – עד 4000 בצד הארוך; רינדור PDF – 450 לאינץ\' ולא מעבר ל-4000', () => {
    assert.deepEqual(EC.fitCap(8000, 6000), { w: 4000, h: 3000 });
    assert.deepEqual(EC.fitCap(1200, 900), { w: 1200, h: 900 });
    const s = EC.pdfScale(595, 842, 64.67, 64.67); near(595 * s, 64.67 / 25.4 * 450, 0.01);
    assert.ok(Math.max(595, 842) * EC.pdfScale(595, 842, 200, 287) <= 4000 + 1e-6);
  });
});

describe('edb-print – PDF', () => {
  const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
  it('כותרת PDF, עמוד אחד, MediaBox בדיוק 595.28×841.89, תמונת JPEG, xref תקין', () => {
    const L = EC.layout('c12');
    const pg = { imgs: [{ w: 800, h: 800, jpg }], draws: L.slots.map((q) => ({ i: 0, x: q.x - 1.5, y: q.y - 1.5, w: q.w + 3, h: q.h + 3 })), cuts: L.slots.map((q) => ({ c: true, ...q })), cal: EC.CAL0 };
    const u = EC.mkPdf(pg), s = Buffer.from(u).toString('latin1');
    assert.ok(s.startsWith('%PDF-1.4\n')); assert.ok(s.trimEnd().endsWith('%%EOF'));
    assert.match(s, /\/Type \/Pages \/Count 1 /);
    assert.match(s, /\/MediaBox \[0 0 595\.28 841\.89\]/);
    assert.match(s, /\/PrintScaling \/None/);
    assert.match(s, /\/Width 800 \/Height 800 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 4 /);
    assert.equal((s.match(/\/Im0 Do/g) || []).length, 12); // 12 משבצות, תמונה אחת משותפת
    assert.equal((s.match(/ c h S/g) || []).length, 12); // 12 קווי חיתוך עגולים
    // xref: כל היסט מצביע על "n 0 obj"
    const xr = +s.match(/startxref\n(\d+)/)[1]; assert.ok(s.slice(xr).startsWith('xref'));
    const offs = [...s.slice(xr).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => +m[1]);
    offs.forEach((o, i) => assert.ok(s.slice(o).startsWith((i + 1) + ' 0 obj'), 'היסט אובייקט ' + (i + 1)));
  });
  it('תמונה בלי איבוד (Flate): RGB גולמי דחוס, נפתח בחזרה לאותם בתים', () => {
    const zlib = require('node:zlib'), raw = Buffer.alloc(4 * 3 * 3); for (let i = 0; i < raw.length; i++) raw[i] = (i * 37) & 255;
    const u = EC.mkPdf({ imgs: [{ w: 4, h: 3, flate: new Uint8Array(zlib.deflateSync(raw)) }], draws: [{ i: 0, x: 0, y: 0, w: 10, h: 10 }] }), s = Buffer.from(u).toString('latin1');
    const m = s.match(/\/Width 4 \/Height 3 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/);
    assert.ok(m, 'מילון תמונה Flate'); const at = m.index + m[0].length;
    assert.deepEqual(zlib.inflateSync(Buffer.from(u.slice(at, at + +m[1]))), raw);
  });
  it('בלי קווי חיתוך – אין פקודות קו; ריבועים – re', () => {
    const L = EC.layout('s6');
    const a = Buffer.from(EC.mkPdf({ imgs: [{ w: 10, h: 10, jpg }], draws: [{ i: 0, x: 0, y: 0, w: 10, h: 10 }], cuts: [] })).toString('latin1');
    assert.ok(!/ S\n/.test(a));
    const b = Buffer.from(EC.mkPdf({ imgs: [], cuts: L.slots.map((q) => ({ c: false, ...q })) })).toString('latin1');
    assert.equal((b.match(/ re S/g) || []).length, 6);
  });
  it('מיקום: משבצת בפינה העליונה של הדף (מ"מ) → נקודות עם ציר y למעלה', () => {
    const s = Buffer.from(EC.mkPdf({ imgs: [{ w: 1, h: 1, jpg }], draws: [{ i: 0, x: 5, y: 5, w: 100, h: 50 }] })).toString('latin1');
    const K = 72 / 25.4, y = 841.89 - 55 * K;
    assert.ok(s.includes(`q ${Math.round(100 * K * 1000) / 1000} 0 0 ${Math.round(50 * K * 1000) / 1000} ${Math.round(5 * K * 1000) / 1000} ${Math.round(y * 1000) / 1000} cm /Im0 Do Q`));
  });
});

describe('edb-print – כיול', () => {
  it('קו של 100 מ"מ שנמדד 98 / 102 → קנה מידה 100/98, 100/102; צלב ב-21/18.5 → הזזה -1/+1.5', () => {
    const c = EC.calFrom(98, 102, 21, 18.5);
    near(c.sx, 100 / 98, 1e-9); near(c.sy, 100 / 102, 1e-9); near(c.ox, -1, 1e-9); near(c.oy, 1.5, 1e-9);
  });
  it('ערכים לא הגיוניים נחסמים; ריק = בלי שינוי', () => {
    const c = EC.calFrom(10, 0, 100, '');
    assert.equal(c.sx, 1.25); assert.equal(c.sy, 1); assert.equal(c.ox, -15); assert.equal(c.oy, 0);
    assert.deepEqual(EC.calNorm({ sx: 'x', sy: NaN }), { sx: 1, sy: 1, ox: 0, oy: 0 });
  });
  it('מיפוי: קנה מידה סביב מרכז הדף, הזזה במ"מ; מטריצת PDF מתאימה', () => {
    const cal = { sx: 1.02, sy: 0.98, ox: 2, oy: -1 }, m = EC.calMap(cal);
    near(m.e + m.a * 105, 105 + 2, 1e-9); near(m.f + m.d * 148.5, 148.5 - 1, 1e-9); // המרכז זז רק בהזזה
    near(m.a * 110 - m.a * 10, 102, 1e-9); // 100 מ"מ → 102
    const K = 72 / 25.4, xf = EC.calXf(cal), pt = (x, y) => [xf[0] * x * K + xf[4], xf[3] * (841.89 - y * K) + xf[5]];
    const [X, Y] = pt(30, 40); near(X, (m.e + m.a * 30) * K, 1e-6); near(Y, 841.89 - (m.f + m.d * 40) * K, 1e-6);
    assert.deepEqual(EC.calXf(EC.CAL0), [1, 0, 0, 1, 0, 0]);
    const s = Buffer.from(EC.mkPdf({ imgs: [], cal })).toString('latin1'); assert.match(s, /q 1\.02 0 0 0\.98 /);
  });
});

describe('edb-print – צבע וכיתוב', () => {
  it('רמות אוטומטיות מותחות 50..200 ל-0..255; בלי התאמות – הפיקסלים לא משתנים', () => {
    const d = new Uint8ClampedArray(400 * 4); for (let i = 0; i < 400; i++) { const v = 50 + Math.round(i * 150 / 399); d.set([v, v, v, 255], i * 4); }
    const lv = EC.levels(d); assert.ok(lv.lo[0] <= 51 && lv.hi[0] >= 199);
    const L = EC.luts(lv, true, 0, 0); assert.equal(L[0][lv.lo[0]], 0); assert.equal(L[0][lv.hi[0]], 255);
    const p = new Uint8ClampedArray([10, 120, 240, 255]); EC.adjust(p, EC.luts(null, false, 0, 0), 0); assert.deepEqual([...p], [10, 120, 240, 255]);
    const g = new Uint8ClampedArray([200, 100, 50, 255]); EC.adjust(g, EC.luts(null, false, 0, 0), -100); assert.equal(g[0], g[1]); assert.equal(g[1], g[2]); // רוויה -100 = אפור
    assert.equal(EC.adjNeeded(EC.newD()), false); assert.equal(EC.adjNeeded({ ...EC.newD(), br: 10 }), true);
  });
  it('סדר תצוגה לקשת: עברית הפוכה, מספרים בסדרם', () => {
    assert.equal(EC.visual('מזל טוב').join(''), 'בוט לזמ');
    assert.equal(EC.visual('בת 30').join(''), '30 תב');
    assert.equal(EC.visual('Happy').join(''), 'Happy');
  });
  it('מבנה נתונים מוכן לסבב 2: עיצוב חדש עם תמונה ורשימת כיתובים', () => {
    assert.deepEqual(EC.newD(0), { img: 0, x: 0, y: 0, z: 1, rot: 0, fl: false, auto: false, br: 0, ct: 0, sat: 0, tx: [] });
  });
});
