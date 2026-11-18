'use strict';
// קופה ש6 (POS:M6) – בדיקות בלי אמולטור: lib/pos-stock.js (תנועת מלאי, ברקודים, דגלים), pos-ocr.js (פענוח תשובת ה-AI),
// pos-catalog.js (חישוב שינוי מחיר קבוצתי). הבדיקות מול האמולטור – pos-catalog.test.js.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FN = path.join(__dirname, '..', 'functions');
require(path.join(FN, 'index.js'));
const ST = require(path.join(FN, 'lib', 'pos-stock.js'));
const OCR = require(path.join(FN, 'pos-ocr.js'))._core;
const CAT = require(path.join(FN, 'pos-catalog.js'))._core;

function fakeTx() {
  const w = [];
  const db = { doc: (p) => ({ path: p }), collection: (c) => ({ doc: () => ({ path: c + '/auto', id: 'auto' }) }) };
  return { w, db, tx: { update: (r, d) => w.push(['u', r.path, d]), set: (r, d) => w.push(['s', r.path, d]) } };
}

describe('pos-stock', () => {
  it('move: עדכון q[br] בתוספת + רשומת stockLog; delta 0 – כלום; ערכים לא מוכרים – שגיאה', () => {
    const { w, db, tx } = fakeTx();
    assert.equal(ST.move(tx, db, { pid: 'p1', br: '_', delta: -3, why: 'cnt', by: 'u', name: 'צלחות', ref: 'c1' }), 'auto');
    assert.equal(w.length, 2);
    assert.equal(w[0][1], 'prod/p1'); assert.ok('q._' in w[0][2]);
    assert.deepEqual(Object.assign({}, w[1][2], { at: 0 }), { prod: 'p1', br: '_', delta: -3, why: 'cnt', by: 'u', at: 0, name: 'צלחות', ref: 'c1' });
    assert.equal(ST.move(tx, db, { pid: 'p1', br: '_', delta: 0, why: 'cnt' }), null);
    assert.equal(w.length, 2);
    assert.throws(() => ST.move(tx, db, { pid: 'p1', br: '_', delta: 1, why: 'magic' }));
    assert.throws(() => ST.move(tx, db, { pid: 'p1', br: 'a/b', delta: 1, why: 'cnt' }));
    for (const k of ['in', 'order', 'xout', 'xin', 'cancel', 'edit', 'pos', 'posret', 'rcv', 'rtv', 'cnt', 'make', 'use', 'fix', 'undo', 'dmg']) assert.ok(ST.WHY.includes(k), k);
  });
  it('codesOf: ראשי + נוספים + ארגז, בלי כפילות', () => {
    assert.deepEqual(ST.codesOf({ barcode: ' 5901234123457 ', bcs: ['111', '5901234123457'], packs: [{ bc: '222', qty: 12 }, null] }), ['5901234123457', '111', '222']);
    assert.deepEqual(ST.codesOf(null), []);
  });
  it('prodFlags: חסר מחיר / חסר פרטים / לבדיקה', () => {
    assert.deepEqual(ST.prodFlags({ price: 12.9, sku: '1', cat: 'c', barcode: '5901234123457' }, 5), []);
    assert.deepEqual(ST.prodFlags({ price: 0, sku: '1', cat: 'c' }, 5), ['noPrice']);
    assert.deepEqual(ST.prodFlags({ price: 1, sku: '1', cat: '' }, 5), ['missing']);
    assert.deepEqual(ST.prodFlags({ price: 1, sku: '1', cat: 'c' }, null), ['missing']);
    assert.deepEqual(ST.prodFlags({ price: 1, sku: '1', cat: 'c', barcode: '5901234123458' }, 1), ['bcCheck']);
    assert.deepEqual(ST.prodFlags({ price: 1, sku: '1', cat: 'c', bcRaw: '7.29E+12' }, 1), ['bcCheck']);
  });
  it('bcTaken: אינדקס posbc, ברקוד ראשי ונוסף של מוצר אחר; המוצר עצמו לא נחשב', async () => {
    const IDX = { '111': 'pA', '222': 'pSelf' };
    const PRODS = [{ id: 'pB', barcode: '333', bcs: ['444'] }, { id: 'pSelf', barcode: '555', bcs: [] }];
    const snap = (d, id) => ({ exists: !!d, id, get: (k) => d && d[k] });
    const db = {
      doc: (p) => ({ kind: 'doc', p }),
      collection: () => ({ where: (f, op, v) => ({ kind: 'q', f, op, v }) }),
    };
    const get = async (r) => {
      if (r.kind === 'doc') { const bc = r.p.split('/')[1]; return snap(IDX[bc] ? { pid: IDX[bc] } : null, bc); }
      const L = PRODS.filter((p) => (r.f === 'barcode' ? r.v.includes(p.barcode) : (p.bcs || []).some((b) => r.v.includes(b))));
      return { forEach: (fn) => L.forEach((p) => fn({ id: p.id, get: (k) => p[k] })) };
    };
    const t = await ST.bcTaken(get, db, ['111', '222', '333', '444', '555', '999'], 'pSelf');
    assert.deepEqual(t.sort((a, b) => a.bc.localeCompare(b.bc)), [{ bc: '111', pid: 'pA' }, { bc: '333', pid: 'pB' }, { bc: '444', pid: 'pB' }]);
  });
});

describe('pos-ocr – פענוח תשובה', () => {
  it('שורות תקינות; מחיר לא ברור = null; ברקוד רק ספרות; בלי שם – נזרק; JSON שבור – null', () => {
    const r = OCR.parseRows('```json\n{"rows":[{"name":" צלחות  20 ","price":"12.90 ₪","bc":"7290-0000-01012"},{"name":"מפית","price":null,"bc":"x"},{"name":"","price":3},{"name":"שגוי","price":-1,"bc":"12"}]}\n```');
    assert.deepEqual(r, [{ name: 'צלחות 20', price: 12.9, bc: '7290000001012' }, { name: 'מפית', price: null, bc: '' }, { name: 'שגוי', price: null, bc: '' }]);
    assert.equal(OCR.parseRows('not json'), null);
    assert.deepEqual(OCR.parseRows('[{"name":"א","price":1}]'), [{ name: 'א', price: 1, bc: '' }]);
    assert.ok(OCR.SYS.startsWith('POS-OCR-V1'));
  });
});

describe('pos-catalog – שינוי מחיר קבוצתי', () => {
  it('אחוז / סכום / קבוע, עיגול לאגורה, לא שלילי', () => {
    assert.equal(CAT.newPrice(10, 'pct', 10), 11);
    assert.equal(CAT.newPrice(9.9, 'pct', -10), 8.91);
    assert.equal(CAT.newPrice(9.9, 'add', 0.5), 10.4);
    assert.equal(CAT.newPrice(9.9, 'add', -20), 0);
    assert.equal(CAT.newPrice(9.9, 'set', 12), 12);
    assert.equal(CAT.newPrice(undefined, 'pct', 10), 0);
  });
});
