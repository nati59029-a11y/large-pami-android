'use strict';
// lib/hours.js (0.1.14): ניתוח קובץ "שעות לעובד" – כותרות לפי מילות מפתח, ערכי טקסט ו-Excel, חצות, יציאה חסרה, מבנה לא מוכר, חודשים לסנכרון
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/lib/hours.js');
const X = require('../src/lib/xlsx.full.min.js');
const U = require('../src/lib/util.js');

test('CSV כמו בכספית המדומה: כותרת עם שם, תאריך/כניסה/יציאה/הפסקה/סה"כ, שורת סיכום, יציאה חסרה, חוצה חצות', () => {
  const rows = [
    ['דוח שעות עובד - מיכל רוזנצוויג'],
    [],
    ['תאריך', 'יום', 'כניסה', 'יציאה', 'זמן הפסקה', 'סה"כ שעות', 'שעות רגילות', '125%', '150%', 'פעולות'],
    ['03/11/2026', "ב'", '07:41', '15:58', '0:30', '7:47', '7:47', '0', '0', ''],
    ['04/11/2026', "ג'", '7:39', '', '', '', '', '', '', ''],
    ['05/11/2026', "ד'", '22:10', '06:05', '00:15', '', '', '', '', ''],
    ['31/10/2026', "ו'", '08:00', '12:00', '', '4:00', '', '', '', ''],
    ['סה"כ', '', '', '', '', '19:47', '', '', '', ''],
  ];
  const r = H.parse(rows, '2026-11');
  assert.equal(r.ok, true);
  assert.equal(r.nm, 'מיכל רוזנצוויג');
  assert.equal(r.out, 1, 'שורה מחוץ לחודש');
  assert.deepEqual(r.rows, [
    { d: '2026-11-03', i: '07:41', o: '15:58', b: 30, t: 467 },
    { d: '2026-11-04', i: '07:39', o: '', b: 0 },
    { d: '2026-11-05', i: '22:10', o: '06:05', b: 15, t: 460, n: 1 },
  ]);
});

test('xlsx עם ערכים גולמיים: מספר סידורי לתאריך, שבר יממה לשעה ולמשך; תאריך-שעה ביציאה ביום שאחרי', () => {
  const ws = X.utils.aoa_to_sheet([
    ['תאריך', 'שעת כניסה', 'שעת יציאה', 'הפסקה (דקות)', 'סה"כ'],
    [46329, 7 / 24 + 30 / 1440, 16 / 24, 20, 8 / 24 + 10 / 1440],
    [46330, 23 / 24, 46331 + 2 / 24, 0, ''],
  ]);
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'a');
  const u8 = new Uint8Array(X.write(wb, { type: 'array', bookType: 'xlsx' }));
  const rows = U.readRows(u8, 'x.xlsx', X, null);
  const day = (n) => new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10);
  const r = H.parse(rows, day(46329).slice(0, 7));
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows[0], { d: day(46329), i: '07:30', o: '16:00', b: 20, t: 490 });
  assert.deepEqual(r.rows[1], { d: day(46330), i: '23:00', o: '02:00', b: 0, t: 180, n: 1 });
});

test('תאריך בלי שנה – לפי החודש המבוקש (גם מעבר שנה); תאריך ISO; עשרוני = שעות', () => {
  assert.equal(H.pDate('03/11', '2026-11'), '2026-11-03');
  assert.equal(H.pDate('31/12', '2027-01'), '2026-12-31');
  assert.equal(H.pDate('2026-11-03 07:00', '2026-11'), '2026-11-03');
  assert.equal(H.pDate('31/02/2026', '2026-02'), null);
  assert.equal(H.pDate('8:17', '2026-11'), null);
  assert.equal(H.pDur('8.5'), 510); assert.equal(H.pDur('8:17'), 497); assert.equal(H.pDur('30', true), 30); assert.equal(H.pDur('-0:10'), null);
  assert.deepEqual(H.pTime('7:05'), { min: 425 }); assert.equal(H.pTime('abc'), null); assert.equal(H.pTime('25:00'), null);
});

test('מבנה לא מוכר → ok:false (לא שולחים שורות); קובץ ריק עם כותרות → 0 שורות', () => {
  assert.deepEqual(H.parse([['דוח שעות עובד - x'], ['a', 'b'], ['1', '2']], '2026-11'), { ok: false, why: 'no-hdr' });
  assert.deepEqual(H.parse([['שם', 'שעות'], ['x', '8']], '2026-11'), { ok: false, why: 'no-hdr' });
  const r = H.parse([['תאריך', 'כניסה', 'יציאה']], '2026-11');
  assert.equal(r.ok, true); assert.equal(r.rows.length, 0);
  assert.equal(H.parse([['תאריך', 'כניסה', 'יציאה']], '2026-13').ok, false);
});

test('מגבלה: עד 200 שורות לעובד', () => {
  const rows = [['תאריך', 'כניסה', 'יציאה']].concat(Array.from({ length: 300 }, () => ['03/11/2026', '08:00', '09:00']));
  assert.equal(H.parse(rows, '2026-11').rows.length, 200);
});

test('חודשים לסנכרון: בימים 1–5 גם הקודם (גם בינואר); בוקר – רק הנוכחי', () => {
  assert.deepEqual(H.monthsFor('2026-11-22'), ['2026-11']);
  assert.deepEqual(H.monthsFor('2026-11-05'), ['2026-10', '2026-11']);
  assert.deepEqual(H.monthsFor('2027-01-01'), ['2026-12', '2027-01']);
  assert.deepEqual(H.monthsFor('2026-11-02', true), ['2026-11']);
});
