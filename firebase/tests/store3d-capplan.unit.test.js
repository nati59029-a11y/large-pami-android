'use strict';
// הקמת חנות – שלב 3 (17.11.2026): תוכנית הצילום (store3d-capplan.js), בלי אמולטור. חלק מ-test:multibiz:4.
// בודק: הקובץ באפליקציה זהה לקובץ בשרת; דטרמיניסטי (גם כשסדר הרשימות במפה שונה); כל פריט פעם אחת; כל המקטעים של S3G נמצאים;
// קירות בכיוון השעון מהדלת, קטעים עד 250 ס"מ; 300 גופים בפחות מ-50ms; geoMoved / itemState / summary.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../functions/lib/store3d-capplan');
const G = require('../../app-source/www/store3d-geo.js');

const fx = (id, o) => Object.assign({ id, k: 'gon', x: 300, y: 300, w: 200, d: 90, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }, o);
const MAP = () => ({ numDir: 'rtl', ent: 'd1',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1000, 0, 1000, 800, 0, 800], h: 300 }, { id: 'r2', name: 'מחסן', p: [1000, 0, 1600, 0, 1600, 800, 1000, 800], h: 300 }],
  walls: [{ id: 'w1', p: [200, 100, 200, 500], t: 10 }], cols: [{ id: 'c1', x: 50, y: 50, w: 30 }],
  doors: [{ id: 'd1', x: 500, y: 800, w: 180, a: 0, k: 'ent' }, { id: 'd2', x: 1000, y: 400, w: 100, a: 90, k: 'in' }],
  fx: [fx('f1', { sides: 2, num: 2 }), fx('f2', { k: 'fridge', x: 700, bays: 2, hi: true, num: 1 }), fx('f3', { x: 1300, y: 400, room: 'r2', num: 3 }), fx('f4', { x: 500, y: 500, del: 1, num: 4 })],
  syms: [{ id: 'y1', k: 'cash', x: 800, y: 700, a: 0 }, { id: 'y2', k: 'exit', x: 100, y: 700, a: 0 }] });
// מפה גדולה: 300 גופים בחדר של 60×50 מטר
function big(n) {
  const m = { numDir: 'rtl', rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 6000, 0, 6000, 5000, 0, 5000], h: 300 }], walls: [], cols: [], syms: [{ id: 'y1', k: 'cash', x: 300, y: 4800, a: 0 }],
    doors: [{ id: 'd1', x: 3000, y: 5000, w: 200, a: 0, k: 'ent' }], fx: [] };
  for (let i = 0; i < n; i++) m.fx.push(fx('f' + (i + 1), { x: 200 + (i % 20) * 280, y: 200 + Math.floor(i / 20) * 300, w: 240, d: 60, sides: 2, bays: 3, num: i + 1 }));
  return m;
}

describe('store3d-capplan – תוכנית הצילום', () => {
  it('הקובץ באפליקציה זהה תו-בתו לקובץ של השרת', () => {
    const a = fs.readFileSync(path.join(__dirname, '../../app-source/www/store3d-capplan.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../functions/lib/store3d-capplan.js'), 'utf8');
    assert.equal(a, b);
  });
  it('דטרמיניסטי: אותה מפה (גם בסדר רשימות הפוך) = אותה תוכנית', () => {
    const a = P.capPlan(MAP());
    const m = MAP(); for (const k of ['rooms', 'walls', 'doors', 'fx', 'syms']) m[k].reverse();
    assert.deepEqual(P.capPlan(m), a);
    assert.deepEqual(P.capPlan(MAP()), a);
  });
  it('כל פריט פעם אחת, ord רציף, כל מפתח לפי התבנית ועד 13 תווים; כל המקטעים של S3G נמצאים; גוף מחוק ועמוד – לא', () => {
    const m = MAP(), pl = P.capPlan(m), keys = pl.items.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length);
    pl.items.forEach((it, i) => assert.equal(it.ord, i + 1));
    for (const k of keys) { assert.match(k, P.KEY_RE); assert.ok(k.length <= 13, k); }
    const bays = G.buildModel(m).bays.map((b) => 'b_' + b.id).sort();
    assert.deepEqual(keys.filter((k) => k.startsWith('b_')).sort(), bays);
    assert.ok(!keys.some((k) => k.startsWith('b_f4') || k.startsWith('c_')));
    for (const k of ['d_d1', 'd_d2', 'k_y1', 'iw_w1-a-1', 'iw_w1-b-2', 'fl_r1-1', 'ce_r2-1']) assert.ok(keys.includes(k), k);
    assert.ok(!keys.includes('k_y2'), 'רק סמל קופה');
    const hi = pl.items.find((i) => i.key === 'b_f2-a-1');
    assert.deepEqual(hi.lv, ['t', 'b'], 'מדף גבוה – מפתח אחד, עליון ותחתון');
  });
  it('סדר: דלת הכניסה ← קירות מהדלת בכיוון השעון ← קיר פנימי ← גופים לפי num ← דלת פנימית, קופה ← רצפה ← תקרה; ואז החדר הבא', () => {
    const pl = P.capPlan(MAP()), k = pl.items.map((i) => i.key);
    assert.equal(k[0], 'd_d1');
    assert.deepEqual(k.slice(1, 4), ['w_r1-3-3', 'w_r1-3-4', 'w_r1-4-1']);
    const ix = (x) => k.indexOf(x);
    assert.ok(ix('w_r1-3-2') < ix('iw_w1-a-1') && ix('iw_w1-b-2') < ix('b_f2-a-1') && ix('b_f2-a-2') < ix('b_f1-a-1') && ix('b_f1-b-2') < ix('d_d2'));
    assert.ok(ix('d_d2') < ix('k_y1') && ix('k_y1') < ix('fl_r1-1') && ix('fl_r1-4') < ix('ce_r1-1') && ix('ce_r1-4') < ix('w_r2-4-1'));
    assert.ok(!k.slice(ix('w_r2-4-1')).includes('d_d2'), 'דלת בין חדרים – פעם אחת');
    for (const it of pl.items.filter((i) => i.k === 'w' || i.k === 'iw')) assert.ok(Math.hypot(it.geo[2] - it.geo[0], it.geo[3] - it.geo[1]) <= 250.5, it.key);
    // חדר שמוגדר נגד כיוון השעון – אותו מסלול על המסך
    const m = MAP(); m.rooms[0].p = [0, 0, 0, 800, 1000, 800, 1000, 0];
    const g1 = P.capPlan(MAP()).items.filter((i) => i.k === 'w' && i.room === 'r1').map((i) => i.geo.join());
    const g2 = P.capPlan(m).items.filter((i) => i.k === 'w' && i.room === 'r1').map((i) => i.geo.join());
    assert.deepEqual(g2, g1);
  });
  it('300 גופים (1800 מקטעים): כל פריט פעם אחת, פחות מ-50ms', () => {
    const m = big(300);
    P.capPlan(m);
    const t0 = process.hrtime.bigint();
    const pl = P.capPlan(m);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(pl.items.filter((i) => i.k === 'b').length, 1800);
    assert.equal(new Set(pl.items.map((i) => i.key)).size, pl.n);
    assert.equal(pl.big, false);
    assert.ok(ms < 50, ms + 'ms');
  });
  it('תוכנית מעל 5000 פריטים – big; מפה ריקה / בלי חדרים – תוכנית ריקה', () => {
    assert.equal(P.capPlan(null).n, 0);
    assert.equal(P.capPlan({ rooms: [] }).n, 0);
    const m = big(300); m.fx.forEach((f) => { f.bays = 10; });
    m.rooms.push({ id: 'r2', p: [6000, 0, 9999, 0, 9999, 9999, 6000, 9999] });
    assert.equal(P.capPlan(m).big, true);
  });
  it('geoMoved: עד 30 ס"מ – לא; מעל – כן; זווית בדלת מעל 5 מעלות (גם מעבר ל-360); בלי geo שמור – לא', () => {
    assert.equal(P.geoMoved([0, 0, 100, 0], [30, 0, 100, 0], 'w'), false);
    assert.equal(P.geoMoved([0, 0, 100, 0], [31, 0, 100, 0], 'w'), true);
    assert.equal(P.geoMoved([10, 10, 100, 358], [10, 10, 100, 2], 'd'), false);
    assert.equal(P.geoMoved([10, 10, 100, 0], [10, 10, 100, 6], 'd'), true);
    assert.equal(P.geoMoved(undefined, [0, 0, 1, 1], 'b'), false);
  });
  it('itemState / summary: חסר = todo; תמונה = part; ok שזז = part; skip עם סיבה = skip; סיום רק כשהכול ok או skip', () => {
    const pl = P.capPlan(MAP()), it = pl.items.find((i) => i.key === 'b_f1-a-1');
    assert.equal(P.itemState(null, it), 'todo');
    assert.equal(P.itemState({ st: 'part', ph: [{ n: 1 }] }, it), 'part');
    assert.equal(P.itemState({ st: 'ok', geo: it.geo }, it), 'ok');
    assert.equal(P.itemState({ st: 'ok', geo: [it.geo[0] + 40, it.geo[1], it.geo[2], it.geo[3]], ph: [{ n: 1 }] }, it), 'part');
    assert.equal(P.itemState({ st: 'skip', why: 'חסום' }, it), 'skip');
    assert.equal(P.itemState({ st: 'skip' }, it), 'todo', 'דילוג בלי סיבה לא נחשב');
    assert.equal(P.itemState({ st: 'orph', ph: [{ n: 1 }] }, it), 'part');
    const docs = {}; for (const i of pl.items) docs[i.key] = { st: 'ok', geo: i.geo };
    let s = P.summary(pl, docs);
    assert.equal(s.all, true); assert.equal(s.ok, pl.n);
    docs['d_d1'] = { st: 'skip', why: 'אין גישה' }; docs['k_y1'] = { st: 'part', ph: [{ n: 1 }] }; delete docs['fl_r1-1'];
    s = P.summary(pl, docs);
    assert.equal(s.all, false); assert.deepEqual(s.miss, ['k_y1', 'fl_r1-1']); assert.equal(s.skip, 1);
  });
  it('label / guide – טקסט בעברית לכל סוג', () => {
    const m = MAP();
    for (const it of P.capPlan(m).items) { assert.ok(/[֐-׿]/.test(P.label(it, m)), it.key); assert.ok(P.guide(it).length > 10, it.key); }
  });
});
