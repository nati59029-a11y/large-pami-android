'use strict';
// בדיקות יחידה להתאמת מוצרים (lib/prod-match.js, שלב 2 חלק א') – בלי אמולטור. הרצה: node --test tests/prod-match.unit.test.js
// המקרים: prod-match-cases.json (אותו קובץ גם לעותק באפליקציה). כולל מדידת ביצועים: 5,000 מוצרים, פחות מ-50ms לכל הקלדה.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../functions/lib/prod-match');
const C = JSON.parse(fs.readFileSync(path.join(__dirname, 'prod-match-cases.json'), 'utf8'));
const WWW = path.join(__dirname, '../../app-source/www/prod-match.js');

function check(PM, idx, c) {
  const r = PM.search(idx, c.q, { bought: c.bought, limit: c.limit });
  const ids = Array.from(r, (x) => x.id);
  const why = `${c.name} | "${c.q}" → ${JSON.stringify(r.map((x) => [x.id, x.s, x.k]))}`;
  if (c.top) assert.equal(ids[0], c.top, why);
  for (const id of c.in || []) assert.ok(ids.includes(id), why);
  for (const id of c.out || []) assert.ok(!ids.includes(id), why);
  if (c.order) assert.deepEqual([...ids].filter((x) => c.order.includes(x)), c.order, why);
  if (c.max != null) assert.ok(ids.length <= c.max, why);
  return r;
}

describe('התאמת מוצרים – prod-match', () => {
  const idx = M.index(C.catalog);
  it(`הקובץ מכיל לפחות 40 מקרים (${C.search.length + C.qty.length})`, () => {
    assert.ok(C.search.length + C.qty.length >= 40);
  });
  for (const c of C.search) it('חיפוש: ' + c.name, () => check(M, idx, c));
  for (const c of C.qty) it('כמות: ' + c.name, () => assert.deepEqual(M.qtyOf(c.q), c.out, c.q));

  it('שני העותקים (שרת ואפליקציה) זהים, והעותק באפליקציה נותן אותן תוצאות בדפדפן מדומה', () => {
    const a = fs.readFileSync(WWW, 'utf8'), b = fs.readFileSync(path.join(__dirname, '../functions/lib/prod-match.js'), 'utf8');
    assert.equal(a, b);
    const ctx = { self: {} }; vm.createContext(ctx); vm.runInContext(a, ctx);
    const PM = ctx.self.ProdMatch; assert.ok(PM && typeof PM.search === 'function');
    const i2 = PM.index(C.catalog);
    for (const c of C.search) check(PM, i2, c);
    for (const c of C.qty) assert.deepEqual(JSON.parse(JSON.stringify(PM.qtyOf(c.q))), c.out);
  });

  it('השם שהתאים והסוג: כינוי (al) מול שם ראשי, ציון ברקוד', () => {
    const [a] = M.search(idx, 'צלחות עמוקות ירוקות'); assert.equal(a.k, 'al'); assert.equal(a.n, 'צלחות עמוקות ירוקות');
    const [b] = M.search(idx, 'מגשים עמוקים'); assert.equal(b.k, 'name');
    const [c] = M.search(idx, '7290001'); assert.equal(c.k, 'bc'); assert.equal(c.s, 2);
    assert.equal(M.key('צָלַחַת  עֲמוּקָּה!'), M.key('צלחת עמוקה'));
    assert.equal(M.key('מק"ט'), M.key('מקט'));
  });

  it('קלט לא תקין לא זורק: מוצרים בלי שם / בלי id, כינויים לא מערך, טקסט null', () => {
    const i = M.index([null, { id: 'a' }, { name: 'x' }, { id: 'b', name: 'מוצר', al: 'לא מערך' }, { id: 'c', name: 'מוצר ג', al: [null, '', 'ג'] }]);
    assert.equal(i.P.length, 2);
    assert.deepEqual(M.search(i, null), []);
    assert.deepEqual(M.search(null, 'x'), []);
    assert.deepEqual(M.qtyOf(null), { name: '', qty: null, unit: '' });
  });

  it('ביצועים: 5,000 מוצרים – אינדקס פעם אחת, וכל הקלדה בפחות מ-50ms', () => {
    const W1 = ['צלחות', 'מגשים', 'כוסות', 'שקיות', 'מפיות', 'קופסאות', 'תבניות', 'מזלגות', 'סכינים', 'כפיות', 'נייר', 'מגבונים', 'סוללות', 'במבה', 'שוקו', 'כפפות'];
    const W2 = ['עמוקות', 'שטוחות', 'גדולות', 'קטנות', 'לבנות', 'שקופות', 'צבעוניות', 'ירוקות', 'אדומות', 'חד פעמיות', 'מקצועיות', 'פרימיום'];
    const W3 = ['100', '200', '250', '500', '750', '1000', 'מארז', 'זוגי', 'משפחתי', 'קלאסי'];
    const P = [];
    for (let i = 0; i < 5000; i++) {
      P.push({ id: 'p' + i, name: `${W1[i % W1.length]} ${W2[(i * 7) % W2.length]} ${W3[(i * 13) % W3.length]} ${i % 97}`,
        al: i % 5 ? [] : [`${W1[(i + 3) % W1.length]} ישן ${i}`], barcode: String(7290000000 + i) });
    }
    let t = process.hrtime.bigint();
    const big = M.index(P);
    const tIdx = Number(process.hrtime.bigint() - t) / 1e6;
    const Q = 'צלחת עמוקה ירוקה 250', worst = [];
    for (let k = 1; k <= Q.length; k++) {
      t = process.hrtime.bigint();
      const r = M.search(big, Q.slice(0, k), { bought: ['p7', 'p100'] });
      worst.push(Number(process.hrtime.bigint() - t) / 1e6);
      assert.ok(r.length <= 8);
    }
    const max = Math.max(...worst);
    console.log(`  ביצועים: אינדקס ${tIdx.toFixed(1)}ms; הקלדה – ממוצע ${(worst.reduce((a, b) => a + b, 0) / worst.length).toFixed(1)}ms, הכי איטית ${max.toFixed(1)}ms`);
    assert.ok(max < 50, 'הקלדה איטית: ' + max.toFixed(1) + 'ms');
    assert.equal(M.search(big, '7290004321')[0].id, 'p4321');
  });
});

describe('מיון לפי עדיפות (pri) – מלאי וקרטון', () => {
  const cat = [
    { id: 'a', name: 'צלחות עמוקות', barcode: '111', q: { x: 0, y: 5 }, cto: true, ct: 10 },
    { id: 'b', name: 'צלחות עמוקות גדולות', q: { x: 7, y: 0 }, cto: true, ct: 10 },
    { id: 'c', name: 'צלחות עמוקות לבנות', q: { x: 3 } },
    { id: 'd', name: 'צלחות עמוקות', q: { x: -2 } },
    { id: 'e', name: 'צלחות' },
  ];
  const idx = M.index(cat);
  const stkOf = (br) => (p) => br ? ((p.q || {})[br] || 0) : Object.values(p.q || {}).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  const mk = (br, ws) => { const s = stkOf(br); return (p) => (s(p) > 0 ? 2 : 0) + (ws && p.cto && p.ct >= 2 ? 1 : 0); };
  const ids = (r) => r.map((x) => x.id);
  const pos = (r, id) => ids(r).indexOf(id);
  it('במלאי לפני שאזל, גם אם לשני ציון גבוה יותר', () => {
    const r = M.search(idx, 'צלחות עמוקות', { pri: mk('x', false) });
    assert.ok(pos(r, 'c') < pos(r, 'd') && pos(r, 'b') < pos(r, 'd') && pos(r, 'c') >= 0);
    const free = M.search(idx, 'צלחות עמוקות');
    assert.ok(pos(free, 'd') < pos(free, 'c'), 'בלי pri הציון מכריע');
  });
  it('בסניף שנבחר נספר רק הסניף; בלי סניף – סך הכול', () => {
    assert.ok(pos(M.search(idx, 'צלחות עמוקות', { pri: mk('y', false) }), 'a') < pos(M.search(idx, 'צלחות עמוקות', { pri: mk('y', false) }), 'b'));
    const rx = M.search(idx, 'צלחות עמוקות', { pri: mk('x', false) }), ry = M.search(idx, 'צלחות עמוקות', { pri: mk('y', false) });
    assert.ok(pos(rx, 'a') > pos(rx, 'b') && pos(ry, 'b') > pos(ry, 'a'));
    const all = M.search(idx, 'צלחות עמוקות', { pri: mk(null, false) });
    assert.ok(pos(all, 'a') >= 0 && pos(all, 'd') > pos(all, 'a') && pos(all, 'd') > pos(all, 'c'));
  });
  it('לקוח עסקי: cto לפני לא-cto כששניהם במלאי; לקוח פרטי – לא', () => {
    const biz = M.search(idx, 'צלחות עמוקות', { pri: mk(null, true) });
    assert.ok(pos(biz, 'b') < pos(biz, 'c'));
    const priv = M.search(idx, 'צלחות עמוקות', { pri: mk(null, false) });
    assert.equal(pos(priv, 'b') < pos(priv, 'c'), pos(M.search(idx, 'צלחות עמוקות', { pri: (p) => (stkOf(null)(p) > 0 ? 2 : 0) }), 'b') < pos(M.search(idx, 'צלחות עמוקות', { pri: (p) => (stkOf(null)(p) > 0 ? 2 : 0) }), 'c'));
  });
  it('ברקוד מדויק תמיד ראשון, גם אם אזל', () => {
    const r = M.search(idx, '111', { pri: (p) => (p.id === 'a' ? -5 : 9) });
    assert.equal(r[0].id, 'a');
  });
  it('pri שזורק / מחזיר לא-מספר לא שובר, ובלי pri התוצאה זהה', () => {
    const base = ids(M.search(idx, 'צלחות עמוקות'));
    assert.deepEqual(ids(M.search(idx, 'צלחות עמוקות', { pri: () => { throw new Error('x'); } })), base);
    assert.deepEqual(ids(M.search(idx, 'צלחות עמוקות', { pri: () => 'a' })), base);
    assert.deepEqual(ids(M.search(idx, 'צלחות עמוקות', { pri: () => NaN })), base);
    assert.ok(!('pr' in M.search(idx, 'צלחות עמוקות', { pri: () => 1 })[0]));
  });
  it('pri נקרא פעם אחת לכל תוצאה, והמיון יציב', () => {
    let n = 0; const r = M.search(idx, 'צלחות', { pri: () => { n++; return 1; } });
    assert.equal(n, r.length);
    assert.deepEqual(ids(M.search(idx, 'צלחות', { pri: () => 1 })), ids(M.search(idx, 'צלחות')));
  });
  it('ביצועים עם pri: 5,000 מוצרים מתחת ל-50ms', () => {
    const P = []; for (let i = 0; i < 5000; i++) P.push({ id: 'p' + i, name: `כוסות גדולות ${i % 97} מארז ${i}`, q: { x: i % 3 }, cto: i % 2 === 0, ct: 10 });
    const big = M.index(P); let max = 0;
    for (const t of ['כ', 'כוסות', 'כוסות גדולות 5']) { const s = process.hrtime.bigint(); M.search(big, t, { pri: mk(null, true) }); max = Math.max(max, Number(process.hrtime.bigint() - s) / 1e6); }
    console.log(`  ביצועים עם pri (5,000 מוצרים): הכי איטית ${max.toFixed(1)}ms`);
    assert.ok(max < 50, max.toFixed(1));
  });
});
