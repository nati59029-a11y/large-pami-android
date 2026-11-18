'use strict';
// בדיקות יחידה לחוסרים (app-source/www/hs-core.js, שלב 1) – בלי אמולטור. הרצה: node --test tests/hs-core.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PM = require('../functions/lib/prod-match');
const WWW = path.join(__dirname, '../../app-source/www/hs-core.js');
const ctx = { self: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(WWW, 'utf8'), ctx);
const C = ctx.self.HsCore;
const J = (x) => JSON.parse(JSON.stringify(x));
const SUPS = [{ id: 's1', name: 'תנובה' }, { id: 's2', name: 'שטראוס' }, { id: 's3', name: 'אסם' }];
const it_ = (id, o) => Object.assign({ id, n: 'מוצר ' + id, nk: 'מוצר ' + id, gen: false, sups: [], supN: [], why: 'store', st: 'open' }, o);

describe('חוסרים – hs-core', () => {
  it('נטען בדפדפן מדומה (window.HsCore) עם כל הפונקציות', () => {
    for (const k of ['build', 'forSup', 'groups', 'suggest', 'xIndex', 'waText', 'custText', 'intl', 'hAdd']) assert.equal(typeof C[k], 'function', k);
  });

  it('build: שם ריק או רווחים נדחה; שם ארוך מ-80 נדחה; 80 מותר', () => {
    assert.equal(C.build({ n: '', why: 'store' }, PM).ok, false);
    assert.equal(C.build({ n: '   ', why: 'store' }, PM).ok, false);
    assert.equal(C.build({ n: 'א'.repeat(81), why: 'store' }, PM).ok, false);
    assert.equal(C.build({ n: 'א'.repeat(80), why: 'store' }, PM).ok, true);
  });

  it('build: מטרה חובה ורק store/order/both', () => {
    assert.equal(C.build({ n: 'חלב' }, PM).ok, false);
    assert.equal(C.build({ n: 'חלב', why: 'x' }, PM).ok, false);
    for (const w of ['store', 'order', 'both']) assert.equal(C.build({ n: 'חלב', why: w }, PM).d.why, w);
  });

  it('build: כמות שלילית, אפס, לא מספר או גדולה מדי – נדחית; ריקה – בלי q; עשרונית עם פסיק – מתקבלת', () => {
    for (const q of ['-1', '0', 'abc', '100001', -3]) assert.equal(C.build({ n: 'חלב', why: 'store', q }, PM).ok, false, String(q));
    assert.equal('q' in C.build({ n: 'חלב', why: 'store', q: '' }, PM).d, false);
    assert.equal(C.build({ n: 'חלב', why: 'store', q: '2,5' }, PM).d.q, 2.5);
    assert.equal(C.build({ n: 'חלב', why: 'store', q: '100000' }, PM).d.q, 100000);
  });

  it('build: בלי ספקים = פריט כללי; עם ספקים – רשימה בלי כפילויות ובלי מזהים לא תקינים; gen מוחק ספקים', () => {
    const a = C.build({ n: 'חלב', why: 'store', sups: [] }, PM).d;
    assert.equal(a.gen, true); assert.deepEqual(J(a.sups), []);
    const b = C.build({ n: 'חלב', why: 'store', sups: [SUPS[0], SUPS[1], SUPS[0], { id: '../x', name: 'רע' }] }, PM).d;
    assert.equal(b.gen, false); assert.deepEqual(J(b.sups), ['s1', 's2']); assert.deepEqual(J(b.supN), ['תנובה', 'שטראוס']);
    const c = C.build({ n: 'חלב', why: 'store', gen: true, sups: [SUPS[0]] }, PM).d;
    assert.equal(c.gen, true); assert.deepEqual(J(c.sups), []);
    const many = Array.from({ length: 11 }, (_, i) => ({ id: 'q' + i, name: 'ספק ' + i }));
    assert.equal(C.build({ n: 'חלב', why: 'store', sups: many }, PM).ok, false);
  });

  it('build: nk מנורמל (ProdMatch.key), לקוח וקישור להזמנה', () => {
    const d = C.build({ n: '  חָלָב   תנובה ', why: 'both', cust: { nm: 'דני', ph: '050-123-4567', cid: 'c1' }, ord: { id: 'o1', no: 17 } }, PM).d;
    assert.equal(d.n, 'חָלָב תנובה'); assert.equal(d.nk, PM.key('חלב תנובה'));
    assert.deepEqual(J(d.cust), { nm: 'דני', ph: '0501234567', cid: 'c1' });
    assert.deepEqual(J(d.ord), { id: 'o1', no: 17 });
    assert.equal(C.build({ n: 'חלב', why: 'store', cust: { nm: 'דני', ph: '123' } }, PM).ok, false, 'טלפון לא תקין');
    assert.equal('cust' in C.build({ n: 'חלב', why: 'store', cust: { nm: ' ', ph: '' } }, PM).d, false, 'לקוח ריק = בלי לקוח');
  });

  it('forSup: פריט כללי מופיע אצל כל ספק עם all; פריט עם 2 ספקים אצל שניהם; פריט שהגיע/נמחק – לא', () => {
    const L = [it_('a', { sups: ['s1', 's2'] }), it_('g', { gen: true }), it_('b', { sups: ['s3'] }), it_('x', { sups: ['s1'], st: 'arr' }), it_('y', { gen: true, st: 'del' })];
    const s1 = C.forSup(L, 's1'), s2 = C.forSup(L, 's2'), s3 = C.forSup(L, 's3');
    assert.deepEqual(s1.map((r) => [r.it.id, r.all]), [['a', false], ['g', true]]);
    assert.deepEqual(s2.map((r) => [r.it.id, r.all]), [['a', false], ['g', true]]);
    assert.deepEqual(s3.map((r) => [r.it.id, r.all]), [['b', false], ['g', true]]);
    assert.deepEqual(C.forSup(L, 'none').map((r) => r.it.id), ['g']);
  });

  it('groups: ספקים עם פריטים + שורות "להזמין מספקים" לפי שם (מוכר / לא מוכר), כולל הכלליים בכל קבוצה', () => {
    const L = [it_('a', { sups: ['s1', 's2'] }), it_('g', { gen: true })];
    const so = [{ id: 'so1', n: 'קוטג', qty: 2, sup: ' תנובה ', st: 'open', ord: 'o1', no: 5 }, { id: 'so2', n: 'ברגים', qty: 10, sup: 'ספק חדש', st: 'ord', ord: 'o2', no: 6 }];
    const G = C.groups(L, SUPS, so, PM);
    const by = Object.fromEntries(G.map((g) => [g.name, g]));
    assert.deepEqual(Object.keys(by).sort(), ['ספק חדש', 'שטראוס', 'תנובה'].sort());
    assert.equal(by['תנובה'].id, 's1'); assert.equal(by['תנובה'].O.length, 1); assert.deepEqual(by['תנובה'].L.map((r) => r.it.id), ['a', 'g']);
    assert.equal(by['ספק חדש'].known, false); assert.equal(by['ספק חדש'].id, C.nameId('ספק חדש')); assert.deepEqual(by['ספק חדש'].L.map((r) => r.it.id), ['g']);
    assert.ok(/^[A-Za-z0-9_-]{1,80}$/.test(C.nameId('ספק חדש')));
    assert.equal(C.nameId('ספק חדש'), C.nameId('  ספק   חדש '));
  });

  it('מזהה ספק מהענן שאינו בתבנית מותרת (../ וכו׳) לא נהיה קבוצה ולא מוצע – לא נכנס לנתיב', () => {
    const L = [it_('a', { sups: ['../../cats/X', 's1', { a: 1 }], supN: ['רע', 'תנובה', 'x'] })];
    const G = C.groups(L, SUPS, [], PM);
    assert.deepEqual(J(G.map((g) => g.id)), ['s1']);
    assert.equal(C.forSup(L, '../../cats/X').length, 0);
    const r = C.suggest('מוצר a', { items: [it_('p', { nk: PM.key('מוצר a'), sups: ['../x', 's2'] })], sups: SUPS.concat([{ id: '../x', name: 'רע' }]) }, PM);
    assert.deepEqual(J(r.map((x) => x.id)), ['s2']);
  });

  it('suggest: ספק מחשבוניות קודמות (hsx), מבחירה קודמת ומהקטלוג; מוצר לא מוכר – אין הצעה', () => {
    const idx = C.xIndex([{ id: 's1', it: [PM.key('חלב תנובה 3% 1 ליטר'), PM.key('קוטג 5%')] }, { id: 's2', it: [PM.key('שוקו בשקית')] }], PM);
    const r1 = C.suggest('חלב 3%', { idx, sups: SUPS }, PM);
    assert.equal(r1[0].id, 's1'); assert.equal(r1[0].src, 'inv');
    assert.equal(C.suggest('מברג חשמלי', { idx, sups: SUPS }, PM).length, 0);
    const prev = [it_('p', { nk: PM.key('במבה'), sups: ['s3'], st: 'arr' })];
    const r2 = C.suggest('במבה', { idx, items: prev, sups: SUPS }, PM);
    assert.equal(r2[0].id, 's3'); assert.equal(r2[0].src, 'prev');
    const cidx = C.catIndex([{ name: 'יוגורט דנונה', sup: 'שטראוס' }], SUPS, PM);
    assert.equal(C.suggest('יוגורט', { cidx, sups: SUPS }, PM)[0].id, 's2', 'אינדקס קטלוג מוכן מראש');
    const r3 = C.suggest('יוגורט', { prods: [{ name: 'יוגורט דנונה', sup: 'שטראוס' }, { name: 'יוגורט', sup: 'ספק לא קיים' }], sups: SUPS }, PM);
    assert.deepEqual(J(r3.map((x) => [x.id, x.src])), [['s2', 'cat']]);
    assert.equal(C.suggest('ח', { idx, sups: SUPS }, PM).length, 0, 'פחות משתי אותיות');
  });

  it('waText / custText / intl', () => {
    const g = { name: 'תנובה', L: [{ it: { n: 'חלב', q: 3 }, all: false }, { it: { n: 'שקיות', cust: { nm: 'סוד', ph: '0501111111' } }, all: true }], O: [{ n: 'קוטג', qty: 2, cust: 'לקוח' }] };
    const t = C.waText(g, 'החנות');
    assert.match(t, /שלום תנובה/); assert.match(t, /• חלב – כמות 3/); assert.match(t, /• שקיות/); assert.match(t, /• קוטג – כמות 2/);
    assert.ok(!/סוד|0501111111|לקוח/.test(t), 'בלי פרטי לקוחות בהודעה לספק');
    assert.match(C.custText({ n: 'חלב', cust: { nm: 'דני' } }, ''), /שלום דני,\nהמוצר "חלב" שביקשת הגיע לחנות\./);
    assert.equal(C.intl('050-123-4567'), '972501234567'); assert.equal(C.intl('+972 50 1234567'), '972501234567');
    assert.equal(C.phOk('0501234567'), true); assert.equal(C.phOk('12345'), false);
  });

  it('hAdd: שומר רק 30 רשומות אחרונות', () => {
    let h = []; for (let i = 0; i < 35; i++) h = C.hAdd(h, { k: 'man', t: i });
    assert.equal(h.length, 30); assert.equal(h[0].t, 5); assert.equal(h[29].t, 34);
  });
});
