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
