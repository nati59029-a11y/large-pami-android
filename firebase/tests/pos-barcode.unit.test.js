'use strict';
// קופה ש6 – pos-barcode.js (מכשיר) ו-functions/lib/pos-barcode.js (שרת): בלי אמולטור.
// א 5.3 (1,000 ברקודים פנימיים תקינים וייחודיים), א 5.5 (ספרת ביקורת), א 5.6 (ברקוד חלקי), B9 (קידומות), פסים למדבקות, סורק במצב מקלדת.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const WWW = path.join(ROOT, 'app-source', 'www', 'pos-barcode.js');
const LIB = path.join(ROOT, 'firebase', 'functions', 'lib', 'pos-barcode.js');
const B = require(WWW);

describe('pos-barcode', () => {
  it('הקובץ בשרת זהה לקובץ במכשיר', () => {
    assert.equal(fs.readFileSync(LIB, 'utf8'), fs.readFileSync(WWW, 'utf8'));
  });

  it('ספרת ביקורת: EAN-13 / EAN-8 / UPC-A נבדקים; אורך אחר מתקבל בלי בדיקה (B1, א 5.5)', () => {
    assert.deepEqual(B.check('5901234123457'), { ok: true });
    assert.deepEqual(B.check('5901234123458'), { ok: false, why: 'check' });
    assert.deepEqual(B.check('96385074'), { ok: true });
    assert.deepEqual(B.check('96385075'), { ok: false, why: 'check' });
    assert.deepEqual(B.check('036000291452'), { ok: true });
    assert.deepEqual(B.check('1234567890'), { ok: true }, 'אורך 10 – מתקבל');
    assert.deepEqual(B.check('AB-12'), { ok: true });
    assert.equal(B.check('ab').ok, false);
    assert.equal(B.check('7.29E+12').ok, false);
    assert.equal(B.check(' 590 1234 123457 ').ok, true, 'רווחים מנוקים');
  });

  it('1,000 ברקודים פנימיים: EAN-13 תקינים, ייחודיים, מתחילים בקידומת (א 5.3)', () => {
    const s = new Set();
    for (let n = 1; n <= 1000; n++) {
      const c = B.internal('200', n);
      assert.equal(c.length, 13); assert.ok(c.startsWith('200')); assert.ok(B.check(c).ok); s.add(c);
    }
    assert.equal(s.size, 1000);
    assert.equal(B.kind(B.internal('200', 5)), 'int');
    assert.throws(() => B.internal('200', 0));
    assert.throws(() => B.internal('200', 1e10));
  });

  it('סוג לפי קידומת (B9): כרטיס מתנה / קופון / קבלה / פנימי / מוצר; התנגשות עם ברקודים מיובאים', () => {
    const g = B.internal('98', 7), c = B.internal('99', 7), r = B.internal('97', 7);
    assert.deepEqual([B.kind(g), B.kind(c), B.kind(r), B.kind('7290000001012'), B.kind('1234567890')], ['gift', 'cpn', 'rcpt', 'prod', 'prod']);
    assert.equal(B.kind(B.internal('55', 1), { bc: { prefixes: { gift: '55' } } }), 'gift', 'קידומת מההגדרות');
    const cl = B.clash(['9780306406157', '7290000001012', '9800000000017', B.internal('200', 1)]);
    assert.deepEqual([cl.rcpt.length, cl.gift.length, cl.int.length], [1, 1, 1], 'ספר (978) מתנגש בקידומת הקבלה – מסומן');
  });

  it('ברקוד חלקי: מ-4 ספרות אחרונות; 3 ספרות – לא מחפש (א 5.6)', () => {
    const L = [{ id: 'a', codes: ['5901234123457'] }, { id: 'b', codes: ['4006381333931', '1233457'] }, { id: 'c', codes: [] }];
    assert.deepEqual(B.partial('3457', L).map((x) => x.id), ['a', 'b']);
    assert.deepEqual(B.partial('457', L), []);
    assert.deepEqual(B.partial('3931', L).map((x) => x.id), ['b']);
    assert.deepEqual(B.partial('23457', L, 5).map((x) => x.id), ['a']);
  });

  it('פסים: פענוח חוזר בטבלה עצמאית נותן את אותן ספרות (EAN-13 ו-EAN-8)', () => {
    const Lc = { '0001101': 0, '0011001': 1, '0010011': 2, '0111101': 3, '0100011': 4, '0110001': 5, '0101111': 6, '0111011': 7, '0110111': 8, '0001011': 9 };
    const Gc = { '0100111': 0, '0110011': 1, '0011011': 2, '0100001': 3, '0011101': 4, '0111001': 5, '0000101': 6, '0010001': 7, '0001001': 8, '0010111': 9 };
    const Rc = Object.fromEntries(Object.entries(Lc).map(([k, v]) => [k.split('').map((b) => (b === '1' ? '0' : '1')).join(''), v]));
    const FIRST = { LLLLLL: 0, LLGLGG: 1, LLGGLG: 2, LLGGGL: 3, LGLLGG: 4, LGGLLG: 5, LGGGLL: 6, LGLGLG: 7, LGLGGL: 8, LGGLGL: 9 };
    for (const code of ['5901234123457', '4006381333931', B.internal('200', 42)]) {
      const s = B.bars(code);
      assert.equal(s.length, 95);
      assert.equal(s.slice(0, 3), '101'); assert.equal(s.slice(45, 50), '01010'); assert.equal(s.slice(92), '101');
      let left = '', par = '';
      for (let i = 0; i < 6; i++) { const w = s.slice(3 + i * 7, 10 + i * 7); if (w in Lc) { left += Lc[w]; par += 'L'; } else { left += Gc[w]; par += 'G'; } }
      let right = ''; for (let i = 0; i < 6; i++) right += Rc[s.slice(50 + i * 7, 57 + i * 7)];
      assert.equal(String(FIRST[par]) + left + right, code);
    }
    const s8 = B.bars('96385074');
    assert.equal(s8.length, 67);
    assert.equal(B.bars('5901234123458'), '', 'ספרת ביקורת שגויה – בלי פסים');
    assert.equal(B.bars('ABC'), '');
  });

  it('ברקוד משקל – רק עם הגדרת wbc (המודול כבוי בעסק הנוכחי)', () => {
    const body = '2' + '01234' + '001250'; const code = body + B.ckDigit(body);
    assert.equal(B.weight(code, null), null);
    assert.deepEqual(B.weight(code, { prefix: '2', mode: 'w' }), { plu: '01234', val: 1250, mode: 'w' });
    assert.equal(B.weight(code.slice(0, 12) + ((+code[12] + 1) % 10), { prefix: '2' }), null);
  });

  it('סורק במצב מקלדת: תווים מהירים + Enter = סריקה אחת; הקלדה איטית או בתוך שדה – לא', () => {
    const L = {}; let t = 1000;
    const realNow = Date.now; Date.now = () => t;
    const prev = globalThis.document;
    globalThis.document = { addEventListener: (k, f) => { L[k] = f; }, removeEventListener: (k) => { delete L[k]; } };
    try {
      const got = [];
      const stop = B.listen((c) => got.push(c), { beep: false });
      const key = (k, target) => { let pd = false; L.keydown({ key: k, target: target || { tagName: 'BODY' }, preventDefault: () => { pd = true; } }); return pd; };
      for (const ch of '7290000001012') { key(ch); t += 10; }
      assert.equal(key('Enter'), true);
      assert.deepEqual(got, ['7290000001012']);
      for (const ch of '12345') { key(ch); t += 300; }
      key('Enter');
      assert.equal(got.length, 1, 'הקלדה איטית של אדם – לא סריקה');
      t += 1000; for (const ch of '7290000002026') { key(ch, { tagName: 'INPUT', dataset: {} }); t += 5; } key('Enter', { tagName: 'INPUT', dataset: {} });
      assert.equal(got.length, 1, 'בתוך שדה טקסט – השדה מקבל את התווים');
      t += 1000; for (const ch of '7290000003030') { key(ch, { tagName: 'INPUT', dataset: { posScan: '' } }); t += 5; } key('Enter', { tagName: 'INPUT', dataset: { posScan: '' } });
      assert.deepEqual(got, ['7290000001012', '7290000003030'], 'שדה שמסומן data-pos-scan – כן');
      stop(); assert.equal(L.keydown, undefined);
    } finally { Date.now = realNow; globalThis.document = prev; }
  });
});
