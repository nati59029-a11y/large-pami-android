'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/lib/sanitize.js');

// סודות "שתולים" – אף אחד מהם לא אמור להופיע בדוח אחרי הניקוי
const SECRETS = ['SESSIONabc123def456', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.sflKxwRJSMeKKF2QT4fwpM', 'owner@example.co.il', '052-1234567', '0521234567', '+972 52 123 4567',
  '039876543', '123456782', '4580123412341234', 'Zx9kQ2mP7vL4nR8sT1wY6bC3', 'hunter2pass', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'];
const planted = {
  v: 1,
  cookie: 'sid=SESSIONabc123def456',
  headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.sflKxwRJSMeKKF2QT4fwpM', 'x-api-key': 'Zx9kQ2mP7vL4nR8sT1wY6bC3' },
  pages: [{ name: 'catalogs', controls: [
    { tag: 'button', text: 'שלח ל owner@example.co.il' },
    { tag: 'span', text: 'טלפון 052-1234567 או 0521234567 או +972 52 123 4567' },
    { tag: 'span', text: 'ח.פ 039876543 ת"ז 123456782 כרטיס 4580 1234 1234 1234' },
    { tag: 'input', name: 'password', password: 'hunter2pass' },
    { tag: 'a', href: '#/item/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' },
  ] }],
  net: [{ m: 'GET', p: '/api/x', q: ['token={s}'], url: '/api/x?token=Zx9kQ2mP7vL4nR8sT1wY6bC3&page=2', st: 200, sz: 123456, rh: ['authorization', 'content-type'] }],
  big: 4580123412341234,
};

test('ניקוי: אף סוד שתול לא נשאר', () => {
  const out = JSON.stringify(S.clean(planted));
  for (const s of SECRETS) assert.ok(!out.includes(s), 'leaked: ' + s);
  assert.ok(!/\d{5,}/.test(out.replace(/"(sz|st)":\d+/g, '')), 'long number leaked: ' + out.match(/\d{5,}/));
});

test('ניקוי: המבנה השימושי נשאר (שמות כותרות, טקסט כפתורים, נתיב, סטטוס, גודל)', () => {
  const o = S.clean(planted);
  assert.equal(o.pages[0].controls[0].text.startsWith('שלח ל'), true);
  assert.deepEqual(o.net[0].rh, ['authorization', 'content-type']);
  assert.equal(o.net[0].p, '/api/x');
  assert.equal(o.net[0].st, 200);
  assert.equal(o.net[0].sz, 123456);
  assert.equal(o.headers.Authorization, '[x]');
  assert.equal(o.cookie, '[x]');
  assert.equal(o.pages[0].controls[3].password, '[x]');
  assert.match(o.net[0].url, /token=\[x\]/);
  assert.deepEqual(o.net[0].q, ['token={s}']); // מציין מקום (בלי ערך) נשאר
  assert.equal(o.big, '[n]');
});

test('ניקוי: טקסטים קוצרו ל-200 תווים, עברית ונתיבי # נשמרים', () => {
  const o = S.sanitize({ t: 'א'.repeat(500), h: '#/csv-imports', css: 'div.container>button.btn-primary' });
  assert.ok(o.t.length <= 201);
  assert.equal(o.h, '#/csv-imports');
  assert.equal(o.css, 'div.container>button.btn-primary');
});

test('גודל: דוח גדול מ-1MB מקוצר ומסומן truncated', () => {
  const rep = { v: 1, net: Array.from({ length: 3000 }, () => ({ m: 'GET', p: '/api/items/{n}/' + 'x'.repeat(150), q: ['a'.repeat(150), 'b'.repeat(150), 'c'.repeat(150)], st: 200 })) };
  const o = S.clean(rep);
  assert.ok(S.size(o) <= S.MAX_BYTES, 'size ' + S.size(o));
  assert.equal(o.truncated, true);
  assert.ok(o.net.length > 100);
  const small = S.clean({ v: 1, a: [1, 2] });
  assert.equal(small.truncated, undefined);
});

// ---------- 0.1.10: קובץ שעות עובד מההיכרות (empHours) ----------
test('שורת כותרות של קובץ השעות: רק מילים מוכרות נשלחות, כל תא אחר "?"; מ-5 השורות הראשונות רק סוג התא', () => {
  const NAMES = ['גלעד שפרינצק', 'משה', 'הדס', 'בני', 'מיכל רוזנצוויג', 'דוח שעות עובד - גלעד שפרינצק', 'עובד: דנה', 'שם: יוסי'];
  for (const n of NAMES) assert.equal(S.hdrCell(n), '?', n);
  for (const h of ['תאריך', 'יום', 'כניסה', 'יציאה', 'שעות', 'שעות רגילות', '100%', '125%', '150%', '175%', '200%', '225%', '250%', 'סה"כ', 'סה״כ שעות', 'הפסקה', 'זמן', 'הערות', 'סניף', 'חנות', 'שם העובד', 'כרטיס', 'שעת כניסה', 'כניסה ויציאה', "מס' כרטיס"]) assert.notEqual(S.hdrCell(h), '?', h);
  assert.equal(S.hdrCell(''), '');
  assert.equal(S.hdrCell('x'.repeat(50)), '?');
  const rows = [['דוח שעות עובד - גלעד שפרינצק'], ['תאריך', 'כניסה', 'יציאה', 'שעות רגילות', '125%', 'עובד: גלעד', ''], ['03/11/2026', '07:41', '15:58', '8:17', 0, 'גלעד', ''], ['04/11', '7:39', '16:05', 8.43, '0', '', null], ['סה"כ', '', '', '16:43', '', '', '']];
  const r = S.fileShape(rows, 5);
  assert.equal(r.hi, 1);
  assert.deepEqual(r.hdr, ['תאריך', 'כניסה', 'יציאה', 'שעות רגילות', '125%', '?', '']);
  assert.deepEqual(r.kinds[0], ['text']);
  assert.deepEqual(r.kinds[2], ['date', 'time', 'time', 'time', 'num', 'text', 'empty']);
  assert.deepEqual(r.kinds[3], ['date', 'time', 'time', 'num', 'num', 'empty', 'empty']);
  assert.equal(r.kinds.length, 5);
  const txt = JSON.stringify(S.clean({ files: [r] }));
  for (const x of ['גלעד', 'שפרינצק', '07:41', '15:58', '8:17', '03/11', '16:43', '8.43']) assert.ok(!txt.includes(x), 'דלף לדוח: ' + x);
  // בלי שורה עם 2 כותרות מוכרות – בלי כותרות בכלל
  assert.equal(S.fileShape([['דוח שעות עובד - דנה'], ['דנה', 'כהן']]).hdr, null);
  assert.equal(S.fileShape(null).hdr, null);
});

test('hdrRaw (0.1.12, קובץ מבצעים): שורת הכותרות כמו שהיא – הראשונה עם 2+ תאי טקסט בלבד; מהשורות רק סוג התא', () => {
  const R = [['מבצעים'], ['מספר מבצע', 'שם מבצע', 'מתאריך', 'מחיר מבצע'], [301, 'קוקה קולה 1+1', '01/11/2026', 12.9], ['302', 'במבה', '05/11/2026', 10]];
  const o = S.hdrRaw(R, 5);
  assert.equal(o.hi, 1);
  assert.deepEqual(o.hdr, ['מספר מבצע', 'שם מבצע', 'מתאריך', 'מחיר מבצע']);
  assert.deepEqual(o.kinds[2], ['num', 'text', 'date', 'num']);
  assert.ok(!JSON.stringify(o).includes('קוקה') && !JSON.stringify(o).includes('במבה'));
  assert.equal(S.hdrRaw([[1, 2], ['x']], 5).hdr, null, 'בלי שורת טקסט – בלי כותרות');
});

test('hdrRaw (תיקון בודק 0.1.12): כל תא דרך הרשימה הלבנה; ספרה / ₪ → "?" – שורת נתונים לא דולפת', () => {
  assert.deepEqual(S.hdrRaw([['מזומן', '1,234.50']], 5).hdr, ['מזומן', '?']);
  assert.deepEqual(S.hdrRaw([['קופאי', 'משה כהן']], 5).hdr, ['קופאי', '?']);
  assert.deepEqual(S.hdrRaw([['מבצע', '₪ 10', 'קוקה קולה', 'אשראי']], 5).hdr, ['מבצע', '?', '?', 'אשראי']);
  const t = JSON.stringify([S.hdrRaw([['מזומן', '1,234.50']], 5), S.hdrRaw([['קופאי', 'משה כהן']], 5)]);
  for (const x of ['1,234', 'משה', 'כהן']) assert.ok(!t.includes(x), x);
  assert.deepEqual(S.hdrStrict(['125%', 'שעות', 'סה"כ']), ['?', 'שעות', 'סה"כ']);
});

test('listSafe (0.1.13): רק תווית מוכרת שאינה של אנשים; אפשרות לא מוכרת → ?; שם סניף מתוך טקסט ארוך', () => {
  assert.deepEqual(S.listSafe('אמצעי תשלום', ['מזומן', 'אשראי', 'הקפה', "צ'ק"]), { lbl: 'אמצעי תשלום', opts: ['מזומן', 'אשראי', 'הקפה', "צ'ק"] });
  assert.deepEqual(S.listSafe('קופה', ['כל הקופות', 'קופה 2', 'יוסי כהן', '4580123412341234']), { lbl: 'קופה', opts: ['כל הקופות', 'קופה 2', '?', '?'] });
  assert.deepEqual(S.listSafe('סניף', ["לארג' פעמי-נחל לכיש"], ['יהודה הנשיא', 'נחל לכיש']).opts, ['נחל לכיש']);
  for (const l of ['קופאי', 'לקוח', 'שם עובד', 'בחר משתמש', 'סוכן', 'בלבלה', '', 'קופה 3']) assert.equal(S.listSafe(l, ['מזומן']), null, l);
});
