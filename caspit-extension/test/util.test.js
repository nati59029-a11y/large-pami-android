'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/lib/util.js');
const A = require('../src/lib/api.js');
const C = require('../src/lib/caspit-core.js');
const X = require('../src/lib/xlsx.full.min.js');
const fx = require('./fixtures/data.js');

test('sha256 של קובץ: יציב, ושונה כשהתוכן שונה', async () => {
  assert.equal(await U.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const a = await U.sha256(new TextEncoder().encode(fx.salesCsv('2026-11-17')));
  assert.equal(a, await U.sha256(new TextEncoder().encode(fx.salesCsv('2026-11-17'))));
  assert.notEqual(a, await U.sha256(new TextEncoder().encode(fx.salesCsv('2026-11-16'))));
});

test('parseCsv: מירכאות, פסיק בתוך שדה, CRLF, BOM, נקודה-פסיק', () => {
  assert.deepEqual(U.parseCsv('﻿a,b\r\n"x,1","y ""q"""\n'), [['a', 'b'], ['x,1', 'y "q"']]);
  assert.deepEqual(U.parseCsv('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('readRows: CSV ב-windows-1255 (כמו מכספית) → דוח מכירות מזוהה', () => {
  const bytes = fx.win1255(fx.salesCsv('2026-11-17'));
  const rows = U.readRows(bytes, 'sales.csv', X, C);
  const det = C.detect(rows);
  assert.equal(det.kind, 'sales');
  const p = C.parseSales(rows, det);
  assert.equal(p.lines.length, 3);
  assert.equal(p.lines[0].d, '2026-11-17');
});

test('readRows: קטלוג xlsx → groupCat', () => {
  const bytes = fx.catalogXlsx(X);
  const rows = U.readRows(bytes, 'catalog.xlsx', X, C);
  const det = C.detect(rows);
  assert.equal(det.kind, 'cat');
  const g = C.groupCat(rows, det);
  assert.equal(g.items.length, 3);
});

test('base64 הלוך ושוב, ומזהה ריצה תואם לשרת', () => {
  const u = new Uint8Array([0, 1, 2, 250, 255]);
  assert.deepEqual(U.fromB64(U.toB64(u)), u);
  const id = U.rid('cx');
  assert.match(id, /^[A-Za-z0-9_-]{8,40}$/);
  assert.notEqual(id, U.rid('cx'));
});

test('לקוח cxBot: Bearer, JSON, op מותר בלבד, סיווג שגיאות', async () => {
  const token = 'biz123.' + 'A'.repeat(43);
  const calls = [];
  const mk = (status, body) => async (url, init) => { calls.push({ url, init }); return { status, ok: status < 300, json: async () => body }; };
  let c = A.client({ url: 'https://x.test/cxBot', token, ver: '0.1.0', fetch: mk(200, { ok: true, days: [] }) });
  const r = await c.call('hello', { mode: 'sync' });
  assert.equal(r.ok, true);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + token);
  assert.deepEqual(JSON.parse(calls[0].init.body), { mode: 'sync', op: 'hello', ver: '0.1.0' });
  assert.equal(calls[0].init.credentials, 'omit');
  await assert.rejects(c.call('cxSetCfg', {}), { code: 'bad-op' });
  for (const [st, body, code] of [[401, {}, 'auth'], [403, {}, 'auth'], [429, {}, 'rate'], [500, {}, 'server'], [503, null, 'server'], [409, { ok: false, reason: 'first-manual' }, 'first-manual'], [409, { ok: false, reason: 'stale' }, 'stale'], [200, { ok: false }, 'fail']]) {
    c = A.client({ url: 'https://x.test/cxBot', token, ver: '1', fetch: mk(st, body) });
    await assert.rejects(c.call('apply', {}), { code }, String(st));
  }
  c = A.client({ url: 'https://x.test/cxBot', token, ver: '1', fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(c.call('hello', {}), { code: 'network' });
  c = A.client({ url: 'https://x.test/cxBot', token: 'bad', ver: '1', fetch: mk(200, {}) });
  await assert.rejects(c.call('hello', {}), { code: 'auth' });
  c = A.client({ url: 'http://evil.test/cxBot', token, ver: '1', fetch: mk(200, {}) });
  await assert.rejects(c.call('hello', {}), { code: 'auth' });
});

test('לקוח cxBot: זמן קצוב → timeout', async () => {
  const token = 'biz123.' + 'A'.repeat(43);
  const c = A.client({ url: 'https://x.test/cxBot', token, ver: '1', fetch: (u, init) => new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  await assert.rejects(c.call('hello', {}, { timeout: 50 }), { code: 'timeout' });
});

test('menuPick / menuAll (היכרות 0.1.12, תיקוני בודק): רק התאמה מדויקת; קישור bad / לא תחת התפריט – לא נבחר', () => {
  // בלי "מבצעים" מדויק: "ייבוא מבצעים" / "הוספת מבצעים" (bad) ו"רשימת מבצעים" (חלקי) – אף אחד לא נבחר
  const noExact = [{ t: 'ייבוא מבצעים', h: '#/pi', u: 'כרטיס הטבות', bad: true }, { t: 'הוספת מבצעים', h: '#/pa', u: 'כרטיס הטבות', bad: true }, { t: 'רשימת מבצעים', h: '#/pl', u: 'כרטיס הטבות' }];
  assert.equal(U.menuPick(noExact, 'מבצעים'), null);
  assert.equal(U.menuPick([{ t: 'מבצעים', h: '#/x', bad: true }], 'מבצעים'), null, 'מדויק אבל bad – לא');
  assert.equal(U.menuPick(noExact.concat([{ t: 'מבצעים', h: '#/promotions', u: 'כרטיס הטבות' }]), 'מבצעים').h, '#/promotions');
  const L = [
    { t: 'הגדרות אשראי', h: '#/credit-settings', u: 'דוחות', bad: true },
    { t: 'ייבוא תקבולים', h: '#/receipts-import', u: 'דוחות', bad: true },
    { t: 'הוסף אמצעי תשלום', h: '#/pm/new', u: 'דוחות', bad: true },
    { t: 'דוח תקבולים', h: '#/receipts-outside' },
    { t: 'דוח אמצעי תשלום', h: '#/payment-methods-report', u: 'דוחות' },
    { t: 'סיכום קופה יומי', h: '#/cash-register-summary', u: 'קופות' },
    { t: 'דוח Z', h: '#/catalogs', u: 'דוחות' },
    { t: 'דוח מלאי', h: '#/stock', u: 'דוחות' },
  ];
  const got = U.menuAll(L, ['דוח אמצעי תשלום', 'דוח תקבולים', 'סיכום קופה', 'דוח z', 'דוח קופאים'], ['דוחות', 'קופות'], ['#/catalogs'], 8, /^#\/[\w\-/?=&.%]*$/);
  assert.deepEqual(got.map((l) => l.h), ['#/payment-methods-report', '#/cash-register-summary']);
  assert.equal(U.menuAll(L, ['דוח אמצעי תשלום', 'סיכום קופה'], ['דוחות', 'קופות'], [], 1).length, 1, 'עד max');
});
