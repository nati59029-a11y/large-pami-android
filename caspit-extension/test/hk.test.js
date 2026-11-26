'use strict';
// lib/hk.js (0.1.21): פענוח "יצוא לאקסל" של לקוחות הקפה – כותרות, שם משפחה, סכום עם פסיק / שלילי, שורת סיכום ושורה ריקה, רק 6 שדות
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/lib/hk.js');
const U = require('../src/lib/util.js');
const X = require('../src/lib/xlsx.full.min.js');
const fx = require('./fixtures/data.js');

test('agorot: פסיק, שלילי, סוגריים, מינוס בסוף, ₪, מספר אקסל, ריק → 0, טקסט → null', () => {
  assert.equal(H.agorot('1,234.50'), 123450);
  assert.equal(H.agorot('-88.2'), -8820);
  assert.equal(H.agorot('(88.20)'), -8820);
  assert.equal(H.agorot('88.20-'), -8820);
  assert.equal(H.agorot('₪ 12,345,678.9'), 1234567890);
  assert.equal(H.agorot('‏-1,000'), -100000);
  assert.equal(H.agorot(1234.5), 123450);
  assert.equal(H.agorot(-0.1), -10);
  assert.equal(H.agorot(0.29), 29, 'עיגול לאגורה (בלי 28.999)');
  assert.equal(H.agorot(''), 0);
  assert.equal(H.agorot('-0'), 0);
  assert.equal(H.agorot('אין'), null);
  assert.equal(H.agorot('1.2.3'), null);
});

test('parse: מיפוי לפי טקסט הכותרות (לא לפי מיקום), שם פרטי + שם משפחה, רק 6 שדות', () => {
  const R = [
    ['קבוצת לקוחות', 'יתרה', 'שם משפחה', 'אימייל', 'מספר לקוח', 'ת.ז', 'שם פרטי', 'טלפון', 'כתובת', 'מספר עובד'],
    ['VIP', '1,234.50', 'כהן', 'a@b.co', 1001, '012345678', 'משה', '050-1111111', 'הדקל 5', 7],
    ['', -88.2, '', '', '1002.0', '', 'מרכולית', '', '', ''],
  ];
  const r = H.parse(R);
  assert.equal(r.ok, true); assert.equal(r.hi, 0);
  assert.deepEqual(r.rows, [
    { xc: '1001', tz: '012345678', name: 'משה כהן', ph: '050-1111111', addr: 'הדקל 5', bal: 123450 },
    { xc: '1002', tz: '', name: 'מרכולית', ph: '', addr: '', bal: -8820 },
  ]);
  for (const x of r.rows) assert.deepEqual(Object.keys(x), ['xc', 'tz', 'name', 'ph', 'addr', 'bal']);
  assert.ok(!JSON.stringify(r).includes('a@b.co') && !JSON.stringify(r).includes('VIP'), 'עמודות אחרות לא יוצאות');
});

test('parse: שורת סיכום, שורה ריקה, יתרה לא מובנת, מספר לקוח כפול – מדלגים / סופרים', () => {
  const R = [
    ['מספר לקוח', 'שם פרטי', 'יתרה'],
    [1, 'א', 10],
    ['', '', ''],
    [2, 'ב', 'לא ידוע'],
    [1, 'א שוב', 5],
    ['סה"כ', '', '1,000.00'],
    ['', 'סה״כ לקוחות: 3', 15],
  ];
  const r = H.parse(R);
  assert.deepEqual(r.rows.map((x) => [x.xc, x.bal]), [['1', 1000]]);
  assert.equal(r.skip, 3); assert.equal(r.bad, 1); assert.equal(r.dup, 1);
});

test('parse: בלי שם משפחה – רק שם פרטי; "שם לקוח" כחלופה; כותרת "ת.ז." / "ח.פ/ע.מ"', () => {
  assert.deepEqual(H.parse([['מספר לקוח', 'ת.ז.', 'שם פרטי', 'יתרה'], [5, '1', 'דנה', '0']]).rows[0], { xc: '5', tz: '1', name: 'דנה', ph: '', addr: '', bal: 0 });
  assert.deepEqual(H.parse([['מספר לקוח', 'שם לקוח', 'ח.פ/ע.מ', 'יתרה'], [6, 'בית קפה', '514', '7']]).rows[0], { xc: '6', tz: '514', name: 'בית קפה', ph: '', addr: '', bal: 700 });
});

test('parse: מבנה לא מוכר → ok:false (בלי שורות)', () => {
  assert.deepEqual(H.parse([['מספר', 'שם', 'ערך'], [1, 'x', 2]]), { ok: false, why: 'hdr', hi: -1 });
  assert.equal(H.parse([['מספר לקוח', 'טלפון', 'יתרה'], [1, '0', 2]]).why, 'name');
  assert.equal(H.parse(null).ok, false);
});

test('הקובץ של כספית המדומה (xlsx, 22 עמודות, כותרת בשורה הראשונה) – דרך readRows', () => {
  const R = U.readRows(fx.hkXlsx(X), 'customers.xlsx', X, null);
  assert.equal(R[0].length, 22);
  const r = H.parse(R);
  assert.deepEqual(r.rows, fx.HK_WANT);
  assert.equal(r.skip, 2, 'שורה ריקה + שורת סיכום');
});
