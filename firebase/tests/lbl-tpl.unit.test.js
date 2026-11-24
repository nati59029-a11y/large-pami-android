'use strict';
// מדבקות שלב 2 (24.11.2026) – app-source/www/lbl-tpl.js: מודל התבנית (גבולות, tplOk, norm, מ"מ→פיקסלים, שדות שמירה, גדלים, קבוצות, בדיקות).
// בלי אמולטור ובלי דפדפן. הציור עצמו (drawT מול draw) – ui-lbl-tpl.js.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const T = require(path.join(__dirname, '..', '..', 'app-source', 'www', 'lbl-tpl.js'));

const el = (o) => Object.assign({ id: 'a', t: 'name', x: 14, y: 19, w: 563, h: 54 }, o);
const doc = (o) => Object.assign({ id: 'my-1', v: 1, name: 'תבנית שלי', w: 50, h: 25, j: JSON.stringify({ grid: 12, brand: 'lay', els: [el()] }), at: 1, by: 'u' }, o);

describe('lbl-tpl: מודל התבנית', () => {
  it('מ"מ → פיקסלים (300 DPI) ונקודות: 50×25 = 591×295 = 141.73×70.87', () => {
    const d = T.dims(50, 25);
    assert.equal(d.W, 591); assert.equal(d.H, 295);
    assert.ok(Math.abs(d.PW - 141.732) < 0.001 && Math.abs(d.PH - 70.866) < 0.001);
    assert.equal(T.mm2px(104), 1228); assert.equal(T.mm2px(15), 177);
    assert.ok(T.isDef(50, 25) && !T.isDef(50, 30));
  });

  it('גבולות: 30 רכיבים, j עד 16000, שם 1..40, 100 תבניות, 10 גדלים, 999 בשורה, 5,000 בהדפסה, אישור מעל 300', () => {
    assert.equal(T.LIM.els, 30); assert.equal(T.LIM.j, 16000); assert.equal(T.LIM.name, 40); assert.equal(T.LIM.tpls, 100);
    assert.equal(T.LIM.sz, 10); assert.equal(T.LIM.q, 999); assert.equal(T.LIM.tot, 5000); assert.equal(T.LIM.ask, 300);
  });

  it('tplOk: מסמך תקין נטען; v לא מוכר, JSON שבור, שם/גודל/base מחוץ לטווח, יותר מ-30 רכיבים – null בלי קריסה', () => {
    const t = T.tplOk(doc());
    assert.equal(t.id, 'my-1'); assert.equal(t.name, 'תבנית שלי'); assert.equal(t.w, 50); assert.equal(t.brand, 'lay'); assert.equal(t.els.length, 1);
    for (const bad of [{ v: 2 }, { v: '1' }, { j: '{"els":[' }, { j: '[]' }, { j: '{}' }, { name: '' }, { name: 'x'.repeat(41) }, { w: 14 }, { w: 105 }, { h: 9 }, { h: 101 }, { w: '50' }, { base: 6 }, { base: 1.5 },
      { j: JSON.stringify({ els: Array.from({ length: 31 }, (_, i) => el({ id: 'e' + i })) }) }, { j: 'x'.repeat(16001) }]) assert.equal(T.tplOk(doc(bad)), null, JSON.stringify(bad).slice(0, 60));
    for (const x of [null, undefined, 5, 'x', []]) assert.equal(T.tplOk(x), null);
    assert.equal(T.tplOk(doc({ id: 'bad id!' })).id, '', 'מזהה לא תקין – ריק');
    assert.equal(T.tplOk(doc({ base: 3, del: true })).base, 3);
    assert.equal(T.tplOk(doc({ del: true })).del, true);
    assert.equal(T.tplOk(doc({ del: 'yes' })).del, undefined);
  });

  it('norm: סוג לא מוכר נזרק, שדות לא מוכרים נזרקים, ערכים מחוץ לטווח מוגבלים, מזהים כפולים מתוקנים', () => {
    const n = T.norm({ grid: 999, brand: 'zz', els: [el({ evil: '<script>', fs: 9999, fw: 900, al: 'x', if: 'hack', cur: '$', txt: 'y'.repeat(80) }), { t: 'script', x: 1 }, el({ t: 'bc', x: 'a', w: -5 }), null] });
    assert.equal(n.grid, 100); assert.equal(n.brand, 'lay'); assert.equal(n.els.length, 2);
    const [a, b] = n.els;
    assert.equal(a.evil, undefined); assert.equal(a.fs, 400); assert.equal(a.fw, 700); assert.equal(a.al, 'r'); assert.equal(a.if, ''); assert.equal(a.cur, 'sh'); assert.equal(a.txt.length, 40);
    assert.equal(b.t, 'bc'); assert.equal(b.x, 0); assert.equal(b.w, 1); assert.notEqual(b.id, a.id);
    assert.equal(T.norm('{"els":[]}').els.length, 0);
    assert.equal(T.norm('not json'), null);
    assert.equal(T.norm({ els: 'x' }), null);
  });

  it('fields: שדות Firestore לפי החוקים (v int, w/h מספר, j מחרוזת, base/del רק כשיש), toJ ← norm הלוך-חזור', () => {
    const t = T.tplOk(doc({ base: 2 }));
    const f = T.fields(t, 'u1', 123);
    assert.deepEqual(Object.keys(f).sort(), ['at', 'base', 'by', 'h', 'j', 'name', 'v', 'w']);
    assert.equal(f.v.integerValue, '1'); assert.equal(f.w.doubleValue, 50); assert.equal(f.base.integerValue, '2'); assert.equal(f.at.integerValue, '123'); assert.equal(f.by.stringValue, 'u1');
    assert.ok(f.j.stringValue.length >= 2 && f.j.stringValue.length <= 16000);
    assert.deepEqual(T.norm(f.j.stringValue).els, t.els);
    assert.equal(T.fields(Object.assign({}, t, { base: 0, del: true }), 'u1').base, undefined);
    assert.equal(T.fields(Object.assign({}, t, { del: true }), 'u1').del.booleanValue, true);
    assert.deepEqual(T.MASK.slice().sort(), ['at', 'base', 'by', 'del', 'h', 'j', 'name', 'v', 'w']);
  });

  it('גדלים (lbls/main): עד 10, בטווח, בלי כפילויות; def עד 40 תווים; שדות שמירה', () => {
    const L = [{ w: 50, h: 25 }, { w: 50, h: 25 }, { w: 14, h: 20 }, { w: 40, h: 30 }, null, { w: '60', h: 40 }].concat(Array.from({ length: 12 }, (_, i) => ({ w: 20 + i, h: 20 })));
    const s = T.szOk(L);
    assert.equal(s.length, 10); assert.deepEqual(s[0], { w: 50, h: 25 }); assert.deepEqual(s[1], { w: 40, h: 30 });
    assert.deepEqual(T.lblsOk({ sz: [{ w: 40, h: 30 }], def: 'abc' }), { sz: [{ w: 40, h: 30 }], def: 'abc' });
    assert.equal(T.lblsOk({ def: 'x'.repeat(41) }).def, '');
    assert.deepEqual(T.lblsOk(null), { sz: [], def: '' });
    const f = T.sFields({ sz: [{ w: 40, h: 30 }], def: 'b1' }, 'u', 5);
    assert.deepEqual(f.sz.arrayValue.values[0], { mapValue: { fields: { w: { doubleValue: 40 }, h: { doubleValue: 30 } } } });
    assert.equal(f.def.stringValue, 'b1'); assert.equal(f.at.integerValue, '5');
  });

  it('need: שדות "בתוקף עד" / מבצע כמות / מחיר מבצע / אריזה – רק כשהתבנית צריכה', () => {
    assert.deepEqual(T.need({ els: [el()] }), { ex: false, mq: false, pp: false, pack: false });
    assert.deepEqual(T.need({ els: [el({ t: 'exp' }), el({ t: 'multi' }), el({ t: 'reg' }), el({ t: 'unit' })] }), { ex: true, mq: true, pp: true, pack: true });
    assert.equal(T.need({ els: [el({ t: 'price', src: 'sale' })] }).pp, true);
    assert.deepEqual(T.need(null), { ex: false, mq: false, pp: false, pack: false });
  });

  it('qty + grp: 1..999 בשורה; קבוצות לפי גודל בסדר ההופעה, עם סכום מדבקות', () => {
    assert.equal(T.qty(0), 1); assert.equal(T.qty(1000), 999); assert.equal(T.qty('x'), 1); assert.equal(T.qty(12.7), 12);
    const G = T.grp([{ n: 2 }, { n: 5, T: { w: 40, h: 30 } }, { n: 1000 }, { n: 1, T: { w: 50, h: 25 } }, { n: 3, T: { w: 40, h: 30 } }]);
    assert.deepEqual(G, [{ w: 50, h: 25, idx: [0, 2, 3], tot: 2 + 999 + 1 }, { w: 40, h: 30, idx: [1, 4], tot: 8 }]);
  });

  it('checks: רכיב מחוץ למדבקה, ברקוד נמוך מ-5 מ"מ, פסים דקים (פחות מ-3 נקודות), טקסט לא נכנס', () => {
    const t = { w: 50, h: 25, els: [el({ id: 'n' }), el({ id: 'o', x: 500, w: 200 }), el({ id: 'b', t: 'bc', y: 240, h: 40, dg: 20 }), el({ id: 'b2', t: 'bc', y: 100, h: 80, dg: 0 })] };
    const R = T.checks(t, { n: { over: true }, b2: { mod: 2 } }), k = R.map((r) => r.id + ':' + r.k).sort();
    assert.deepEqual(k, ['b2:bcThin', 'b:bcLow', 'b:out', 'n:fit', 'o:out']);
    assert.ok(R.every((r) => typeof r.msg === 'string' && r.msg.length > 3));
    assert.deepEqual(T.checks({ w: 50, h: 25, els: [el()] }), []);
    assert.deepEqual(T.checks(null), []);
  });
});
