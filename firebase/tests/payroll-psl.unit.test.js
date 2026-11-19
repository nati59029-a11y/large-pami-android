'use strict';
// שכר, שלב ה' (19.11.2026): פענוח תלושים – הפונקציות הטהורות של app-source/www/payroll-psl.js. טקסט סינתטי בלבד (לא תלוש אמיתי).
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../app-source/www/payroll-psl.js');

const rv = (s) => [...s].reverse().join('');
// שורה בסדר חזותי (כמו ש-PDF לפעמים מחזיר): כל השורה הפוכה, אבל המספרים נשארים בכיוון שלהם
const vis = (line) => rv(line).replace(/[\d.,/]+/g, (m) => rv(m));
const ecOf = (r, k) => (r.ec.find((e) => e.k === k) || {}).a;

const SLIP = [
  'תלוש שכר לחודש אוקטובר 2026',
  'שם העובד: דנה כהן   ת.ז. 012345674',
  'שכר בסיס 8,000.00',
  'סה"כ ברוטו 9,250.50',
  'ביטוח לאומי עובד 310.00 ביטוח לאומי מעביד 420.75',
  'פנסיה עובד 6% 555.00 פנסיה מעביד 6.5% 601.28',
  'פיצויים 6% 555.03',
  'קרן השתלמות מעביד 7.5% 693.79',
  'נטו לתשלום: ₪7,412.30',
].join('\n');
const EMPS = [{ id: 'e1', name: 'דנה כהן' }, { id: 'e2', name: 'יוסי לוי', tz: '23456789' }, { id: 'e3', name: 'דנה' }];

test('1 תלוש רגיל: ברוטו, נטו וכל רכיבי עלות המעביד', () => {
  const r = P.parseSlip(SLIP);
  assert.equal(r.gross, 9250.5);
  assert.equal(r.net, 7412.3);
  assert.equal(ecOf(r, 'bl'), 420.75, 'ביטוח לאומי מעביד – לא של העובד');
  assert.equal(ecOf(r, 'pen'), 601.28, 'פנסיה מעביד – לא האחוז ולא של העובד');
  assert.equal(ecOf(r, 'sev'), 555.03);
  assert.equal(ecOf(r, 'kh'), 693.79);
  assert.equal(ecOf(r, 'mt'), undefined, 'מס מעסיקים לא קיים ← ריק');
  assert.equal(r.found, 6);
  assert.deepEqual(r.warn, []);
});

test('2 עברית הפוכה (סדר חזותי) – אותה תוצאה', () => {
  const r = P.parseSlip(SLIP.split('\n').map(vis).join('\n'));
  assert.equal(r.gross, 9250.5);
  assert.equal(r.net, 7412.3);
  assert.equal(ecOf(r, 'bl'), 420.75);
  assert.equal(ecOf(r, 'pen'), 601.28);
  assert.equal(ecOf(r, 'kh'), 693.79);
});

test('3 ספרות הפוכות בתוך מספר ("05.214,7") ← 7,412.50', () => {
  const r = P.parseSlip('נטו לתשלום 05.214,7\nסה"כ ברוטו 00.000,01');
  assert.equal(r.net, 7412.5);
  assert.equal(r.gross, 10000);
});

test('4 פסיקים, ₪, ש"ח, גרשיים שונים ונקודתיים', () => {
  const r = P.parseSlip('סה״כ ברוטו: 12,345.67 ש"ח\nשכר נטו ₪ 10,001.10\nמס מעסיקים: 1,234.00');
  assert.equal(r.gross, 12345.67);
  assert.equal(r.net, 10001.1);
  assert.equal(ecOf(r, 'mt'), 1234);
});

test('5 שדות חסרים ← null, בלי שגיאה; טקסט ריק', () => {
  const r = P.parseSlip('תלוש שכר\nשם: משה\nשכר נטו 5,000.00');
  assert.equal(r.gross, null);
  assert.equal(r.net, 5000);
  assert.deepEqual(r.ec, []);
  const e = P.parseSlip('');
  assert.equal(e.gross, null); assert.equal(e.net, null); assert.equal(e.found, 0);
  assert.equal(P.parseSlip(undefined).found, 0);
});

test('6 תווית בשורה אחת והערך בשורה הבאה', () => {
  const r = P.parseSlip('נטו לתשלום\n6,100.00\nסה"כ ברוטו\n7,000.00');
  assert.equal(r.net, 6100);
  assert.equal(r.gross, 7000);
});

test('7 אימות: נטו גדול מברוטו ← אזהרה; ערך שלילי ← ריק עם אזהרה; עלות גדולה מהברוטו ← לא נלקחת', () => {
  const a = P.parseSlip('סה"כ ברוטו 5,000.00\nנטו לתשלום 6,000.00');
  assert.ok(a.warn.some((w) => /גדול מהברוטו/.test(w)));
  const b = P.parseSlip('סה"כ ברוטו 5,000.00\nנטו לתשלום -100.00\nפיצויים 9,999.00');
  assert.equal(b.net, null);
  assert.equal(ecOf(b, 'sev'), undefined);
  assert.ok(b.warn.length >= 2);
});

test('8 checkVals: נטו חובה, חיוביים, נטו ≤ ברוטו', () => {
  assert.deepEqual(P.checkVals({ gross: 9000, net: 7000, ec: [{ k: 'bl', n: 'ב"ל', a: 300 }] }), []);
  assert.deepEqual(P.checkVals({ gross: null, net: 7000, ec: [] }), []);
  assert.ok(P.checkVals({ gross: 9000, net: null, ec: [] }).length);
  assert.ok(P.checkVals({ gross: 5000, net: 7000, ec: [] }).length);
  assert.ok(P.checkVals({ gross: 9000, net: 7000, ec: [{ k: 'bl', n: 'x', a: -1 }] }).length);
  assert.ok(P.checkVals({ gross: 9000, net: NaN, ec: [] }).length);
});

test('9 חודש: שם חודש, MM/YYYY, YYYY-MM, הפוך; תאריך מלא לא מבלבל', () => {
  assert.equal(P.findMon(SLIP), '2026-10');
  assert.equal(P.findMon(SLIP.split('\n').map(vis).join('\n')), '2026-10');
  assert.equal(P.findMon('תאריך הדפסה 05/11/2026\nתלוש לחודש 10/2026'), '2026-10');
  assert.equal(P.findMon('שכר 2026-03'), '2026-03');
  assert.equal(P.findMon('לחודש מרס 2025'), '2025-03');
  assert.equal(P.findMon('תאריך 05/11/2026'), '', 'רק תאריך מלא ← לא ידוע');
  assert.equal(P.findMon('בלי חודש'), '');
});

test('10 זיהוי עובד: שם מלא (גם הפוך, גם משפחה-פרטי), ת"ז, עמימות', () => {
  assert.deepEqual(P.findEmp(SLIP, EMPS), { id: 'e1', by: 'name' }, '"דנה כהן" גובר על "דנה" (תת-קבוצה)');
  assert.deepEqual(P.findEmp(SLIP.split('\n').map(vis).join('\n'), EMPS), { id: 'e1', by: 'name' });
  assert.deepEqual(P.findEmp('עובד: כהן דנה', EMPS), { id: 'e1', by: 'name' });
  assert.deepEqual(P.findEmp('תלוש\nמספר זהות 023456789\nשם: ישראל', EMPS), { id: 'e2', by: 'tz' }, 'ת"ז עם 0 מוביל');
  assert.equal(P.findEmp('תלוש של משה', EMPS), null);
  assert.equal(P.findEmp('דנה כהן, יוסי לוי', EMPS), null, 'שני עובדים בעמוד ← לא משויך');
  assert.equal(P.findEmp('דנה כהן', []), null);
});

test('11 קובץ מרוכז: עמודים ← קבוצות, בלי לערבב עובדים', () => {
  const pg = [
    'תלוש לחודש אוקטובר 2026\nשם: דנה כהן\nסה"כ ברוטו 9,000.00\nנטו לתשלום 7,000.00',
    'שם: דנה כהן\nפירוט נוסף עמוד 2',
    'תלוש לחודש אוקטובר 2026\nשם: יוסי לוי\nסה"כ ברוטו 6,000.00\nנטו לתשלום 5,000.00',
    'עמוד בלי שם',
    'עמוד נוסף בלי שם',
    vis('תלוש לחודש אוקטובר 2026') + '\n' + vis('שם: דנה כהן') + '\n' + vis('נטו לתשלום 7,100.00'),
  ];
  const G = P.groupPages(pg, EMPS);
  assert.deepEqual(G.map((g) => [g.sub, g.mon, g.pages]), [
    ['e1', '2026-10', [0, 1]], ['e2', '2026-10', [2]], ['', '', [3]], ['', '', [4]], ['e1', '2026-10', [5]],
  ]);
  assert.equal(P.parseSlip(G[0].text).net, 7000);
  assert.equal(P.parseSlip(G[1].text).net, 5000);
  assert.ok(!/דנה/.test(G[1].text), 'הטקסט של יוסי לא כולל עמוד של דנה');
  assert.equal(P.parseSlip(G[4].text).net, 7100);
});

test('12 אותו עובד בשני חודשים רצופים ← שתי קבוצות', () => {
  const G = P.groupPages(['דנה כהן תלוש לחודש 09/2026', 'דנה כהן תלוש לחודש 10/2026'], EMPS);
  assert.deepEqual(G.map((g) => [g.sub, g.mon, g.pages]), [['e1', '2026-09', [0]], ['e1', '2026-10', [1]]]);
});

test('13 numTok: אחוזים, תאריכים וטקסט אינם סכום', () => {
  assert.equal(P.numTok('1,234.50').n, 1234.5);
  assert.equal(P.numTok('05.432,1').n, 1234.5);
  assert.equal(P.numTok('10/2026'), null);
  assert.equal(P.numTok('abc'), null);
  assert.equal(P.numTok('450.00-').n, -450);
  const r = P.parseSlip('תגמולי מעביד 6.5 % 650.00');
  assert.equal(ecOf(r, 'pen'), 650);
});
