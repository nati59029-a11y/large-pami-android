'use strict';
// הדפסת דף אכיל, סבב 2ב (26.11.2026) – החלקים הטהורים של העורך: היסטוריה (ביטול / חזרה), הסרת רקע לפי צבע, שמירה / טעינה של פרויקט.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const EC = require(path.resolve(__dirname, '..', '..', 'app-source', 'www', 'edb-print.js'));

describe('edb-editor – היסטוריה', () => {
  it('ביטול וחזרה, שינוי זהה לא נרשם, שינוי חדש מנקה את "חזרה"', () => {
    const h = EC.mkHist(30); h.init('a'); assert.equal(h.canUndo(), false);
    assert.equal(h.commit('a'), false); assert.equal(h.commit('b'), true); assert.equal(h.commit('c'), true);
    assert.equal(h.undo(), 'b'); assert.equal(h.undo(), 'a'); assert.equal(h.undo(), null); assert.equal(h.canRedo(), true);
    assert.equal(h.redo(), 'b'); assert.equal(h.commit('x'), true); assert.equal(h.canRedo(), false); assert.equal(h.undo(), 'b');
    assert.deepEqual(h.all().sort(), ['a', 'b', 'x']);
  });
  it('מוגבל ל-30 צעדים: הישן ביותר נופל', () => {
    const h = EC.mkHist(30); h.init('s0'); for (let i = 1; i <= 50; i++) h.commit('s' + i);
    let n = 0, last = null; for (let v; (v = h.undo()) !== null;) { n++; last = v; }
    assert.equal(n, 30); assert.equal(last, 's20'); assert.equal(h.canUndo(), false);
  });
  it('all() כולל את המצב הנוכחי וגם את ה"חזרה"', () => {
    const h = EC.mkHist(5); h.init('a'); h.commit('b'); h.commit('c'); h.undo();
    assert.deepEqual(h.all().sort(), ['a', 'b', 'c']);
  });
});

describe('edb-editor – הסרת רקע לפי צבע', () => {
  const px = (...p) => new Uint8ClampedArray(p.flatMap((c) => [c[0], c[1], c[2], 255]));
  it('אותו צבע – שקוף; צבע רחוק – לא משתנה', () => {
    const d = EC.keyColor(px([200, 30, 30], [0, 0, 255], [255, 255, 255]), 200, 30, 30, 20);
    assert.equal(d[3], 0); assert.equal(d[7], 255); assert.equal(d[11], 255);
    assert.deepEqual([...d.slice(4, 7)], [0, 0, 255]); // ערוצי הצבע לא נגעו
  });
  it('צבע דומה (בתוך הרגישות) נעלם, מחוץ לה נשאר; קצה הדרגתי באמצע הטווח', () => {
    const T = 30 / 100 * 441.6729; // מרחק מקסימלי
    const near = [100 + Math.round(T * 0.5), 100, 100], mid = [100 + Math.round(T * 0.9), 100, 100], far = [100 + Math.round(T * 1.2), 100, 100];
    const d = EC.keyColor(px(near, mid, far), 100, 100, 100, 30);
    assert.equal(d[3], 0); assert.ok(d[7] > 0 && d[7] < 255, 'הדרגתי ' + d[7]); assert.equal(d[11], 255);
  });
  it('רגישות 0 – לא משנה כלום; רגישות 100 – הכול שקוף; שקיפות קיימת לא גדלה', () => {
    const a = px([1, 2, 3], [250, 250, 250]); EC.keyColor(a, 1, 2, 3, 0); assert.equal(a[3], 255); assert.equal(a[7], 255);
    const b = px([1, 2, 3], [100, 100, 100]); EC.keyColor(b, 1, 2, 3, 100); assert.equal(b[3], 0); assert.equal(b[7], 0);
    const c = new Uint8ClampedArray([10, 10, 10, 100]); EC.keyColor(c, 200, 200, 200, 5); assert.equal(c[3], 100);
  });
  it('hexRgb', () => { assert.deepEqual(EC.hexRgb('#ff8000'), [255, 128, 0]); assert.equal(EC.hexRgb('red'), null); assert.equal(EC.hexRgb('#fff'), null); });
});

describe('edb-editor – פרויקט: שמירה וטעינה', () => {
  const T = { s: 'מזל טוב', f: 'Rubik', b: true, sz: 10, col: '#ffffff', ol: '#000000', ow: 3, sh: true, x: 0.5, y: 0.5, arc: 'top' };
  const st = () => ({
    name: 'יום הולדת', k: 'c12', cu: { sh: 'c', w: 50, h: 50 }, cut: true, gi: 0,
    ds: [{ ...EC.newD(0), tx: [T] }, { ...EC.newD(0), im: 1, z: 1.5, kc: '#ff0000', kt: 30 }],
    slots: Array.from({ length: 12 }, (_, i) => ({ d: i === 3 ? 1 : 0 })),
    imgs: [{ id: 'i1', name: 'a.jpg', w: 4000, h: 3000, cap: 4000 }, { id: 'i2', name: 'b.jpg', w: 900, h: 900, cap: 900 }],
  });
  it('סיבוב מלא: pack ← JSON ← unpack נותן אותו מצב', () => {
    const rec = JSON.parse(JSON.stringify(EC.projPack(st()))), o = EC.projUnpack(rec);
    assert.equal(o.name, 'יום הולדת'); assert.equal(o.k, 'c12'); assert.equal(o.gi, 0); assert.equal(o.slots.length, 12); assert.equal(o.slots[3].d, 1);
    assert.deepEqual(o.ds[0].tx, [T]); assert.equal(o.ds[1].im, 1); assert.equal(o.ds[1].kc, '#ff0000'); assert.equal(o.ds[1].kt, 30); assert.equal(o.ds[1].z, 1.5);
    assert.deepEqual(o.imgs.map((m) => m.id), ['i1', 'i2']);
  });
  it('אין תמונות / בלי מבנה – null; תמונה חסרה – ההפניה אליה נמחקת', () => {
    assert.equal(EC.projUnpack(null), null); assert.equal(EC.projUnpack({}), null); assert.equal(EC.projUnpack('x'), null);
    const rec = EC.projPack(st()); rec.imgs[1] = null; const o = EC.projUnpack(rec);
    assert.equal(o.ds[1].im, undefined); assert.equal(o.ds[1].kc, '#ff0000');
    rec.imgs[0] = null; assert.equal(EC.projUnpack(rec).gi, -1);
  });
  it('נתונים פגומים מתוקנים: טווחים, פריסה לא מוכרת, משבצת שמצביעה על עיצוב שלא קיים, כיתובים מעל 8', () => {
    const rec = EC.projPack(st()); rec.k = 'zzz'; rec.ds[0].z = 99; rec.ds[0].br = 'abc'; rec.ds[0].tx = Array.from({ length: 12 }, () => T); rec.ds[1].kc = 'red'; rec.slots[0].d = 7; rec.gi = 5;
    const o = EC.projUnpack(rec);
    assert.equal(o.k, 'c12'); assert.equal(o.ds[0].z, 6); assert.equal(o.ds[0].br, 0); assert.equal(o.ds[0].tx.length, 8); assert.equal(o.ds[1].kc, undefined); assert.equal(o.slots[0].d, 0); assert.equal(o.gi, 0);
  });
  it('גודל מקסימלי לתמונה פרטית: לפי גודל המשבצת, בין 600 ל-4000', () => {
    assert.equal(EC.imgCap(EC.layout('c36')), 728); // 30.83 מ"מ × 2 ב-300 DPI
    assert.ok(EC.imgCap(EC.layout('c36')) < EC.imgCap(EC.layout('c6')));
    assert.equal(EC.imgCap(EC.layout('a5')), 4000); assert.equal(EC.imgCap({ n: 0 }), 600);
  });
});
