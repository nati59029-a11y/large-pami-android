'use strict';
// בדיקות יחידה ל-store3d-geo.js (מתמטיקה טהורה, בלי דפדפן). הרצה: node --test app-source/www/store3d-dev/geo.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../store3d-geo.js');

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, a + ' != ' + b);
const SQ = [0, 0, 1000, 0, 1000, 800, 0, 800];

describe('מצולעים', () => {
  it('שטח וסימן', () => {
    near(G.polyArea(SQ), 800000);
    near(G.polyArea([0, 0, 0, 800, 1000, 800, 1000, 0]), -800000);
  });
  it('מצולע תקין (כולל צורת L)', () => {
    assert.equal(G.polyValid(SQ).ok, true);
    const L = [0, 0, 600, 0, 600, 300, 300, 300, 300, 600, 0, 600];
    const v = G.polyValid(L); assert.equal(v.ok, true); near(v.area, 270000);
  });
  it('מצולע לא חוקי – הודעה בעברית', () => {
    const cases = [
      [[0, 0, 100, 0], 'לפחות 3'],
      [[0, 0, 100, 0, 100], 'זוגי'],
      [[0, 0, 1000, 1000, 1000, 0, 0, 1000], 'חוצים'], // פרפר
      [[0, 0, 50, 0, 50, 50, 0, 50], 'קטן מדי'],      // 0.25 מ"ר
      [[0, 0, 100.5, 0, 100, 100], 'מחוץ'],
      [[0, 0, 20000, 0, 0, 500], 'מחוץ'],
      [[0, 0, 500, 0, 500, 500, 500, 0], 'באותה נקודה'],
      [[0, 0, 1000, 0, 500, 0, 500, 500], 'חוצים'],    // חוזר אחורה על אותו קו
      [new Array(82).fill(0).map((_, i) => i * 10), 'עד 40'],
      ['x', 'חסר'],
    ];
    for (const [p, msg] of cases) {
      const v = G.polyValid(p);
      assert.equal(v.ok, false, JSON.stringify(p));
      assert.match(v.err, new RegExp(msg));
      assert.match(v.err, /[֐-׿]/);
    }
  });
  it('נקודה פנימית ומרכז', () => {
    assert.equal(G.pointInPoly(500, 400, SQ), true);
    assert.equal(G.pointInPoly(1500, 400, SQ), false);
    const c = G.centroid(SQ); near(c[0], 500); near(c[1], 400);
  });
});

describe('גופים ומקטעים', () => {
  const gon = { id: 'f1', k: 'gon', x: 500, y: 500, w: 300, d: 100, h: 180, a: 0, sides: 2, bays: 3, lvl: 5, hi: false };
  it('פינות גוף מסובב 90° (עם כיוון השעון על המסך)', () => {
    const cs = G.fxCorners({ ...gon, a: 90 });
    // אורך לאורך y אחרי סיבוב: הפינה (-w/2,-d/2) => (x+d/2, y-w/2)
    near(cs[0][0], 550); near(cs[0][1], 350);
  });
  it('מספור מקטעים מימין לשמאל לעומד מול החזית', () => {
    const b = G.fxBays(gon, 'rtl');
    assert.equal(b.length, 6);
    assert.deepEqual(b.map((x) => x.id), ['f1-a-1', 'f1-a-2', 'f1-a-3', 'f1-b-1', 'f1-b-2', 'f1-b-3']);
    // צד a פונה ל-y+ (למטה במסך). העומד מולו מביט למעלה, ימינו = x+, לכן מקטע 1 בקצה הימני
    near(b[0].x, 600); near(b[0].y, 550); near(b[0].nx, 0); near(b[0].ny, 1);
    near(b[2].x, 400);
    // צד b פונה ל-y-. העומד מולו מביט למטה, ימינו = x-, לכן מקטע 1 בקצה השמאלי של המסך
    near(b[3].x, 400); near(b[3].y, 450); near(b[3].ny, -1);
    near(b[0].w, 100);
  });
  it('ltr הופך את הכיוון', () => {
    const b = G.fxBays(gon, 'ltr'); near(b[0].x, 400); near(b[3].x, 600);
  });
  it('מדף גבוה = צילום עליון ותחתון; צד אחד למקרר גם אם נכתב 2', () => {
    assert.deepEqual(G.fxBays({ ...gon, hi: true }, 'rtl')[0].lv, ['t', 'b']);
    assert.equal(G.fxBays({ ...gon, k: 'fridge', sides: 2 }, 'rtl').length, 3);
  });
  it('נורמל מסתובב עם הגוף', () => {
    const b = G.fxBays({ ...gon, a: 90 }, 'rtl');
    near(b[0].nx, -1); near(b[0].ny, 0, 1e-9);
  });
  it('ספירת מקטעים במפה ומחיקה רכה', () => {
    const m = { fx: [gon, { ...gon, id: 'f2', sides: 1 }, { ...gon, id: 'f3', del: 1 }] };
    assert.equal(G.bayCount(m), 9);
  });
});

describe('מספור גופים מהכניסה', () => {
  // חדר 1000x1000, כניסה בתחתית באמצע. העומד בכניסה מביט למעלה, ימינו = x+
  const base = {
    numDir: 'rtl', ent: 'd1',
    rooms: [{ id: 'r1', name: 'א', p: [0, 0, 1000, 0, 1000, 1000, 0, 1000], h: 300 }],
    doors: [{ id: 'd1', x: 500, y: 1000, w: 120, k: 'ent' }],
    fx: [
      { id: 'f1', x: 200, y: 500 }, { id: 'f2', x: 800, y: 500 }, { id: 'f3', x: 500, y: 500 }, { id: 'f4', x: 500, y: 200 },
    ],
  };
  it('rtl: ימין ראשון, ובאותו טור הקרוב לכניסה ראשון', () => {
    assert.deepEqual(G.autoNumber(base).map((o) => o.id + ':' + o.num), ['f2:1', 'f3:2', 'f4:3', 'f1:4']);
  });
  it('ltr: שמאל ראשון', () => {
    assert.deepEqual(G.autoNumber({ ...base, numDir: 'ltr' }).map((o) => o.id), ['f1', 'f3', 'f4', 'f2']);
  });
  it('כניסה בצד ימין של המסך: העומד מביט שמאלה, ימינו = למעלה במסך', () => {
    const m = { ...base, doors: [{ id: 'd1', x: 1000, y: 500, w: 120, k: 'ent' }], fx: [{ id: 'a', x: 500, y: 100 }, { id: 'b', x: 500, y: 900 }] };
    assert.deepEqual(G.autoNumber(m).map((o) => o.id), ['a', 'b']);
  });
  it('בלי דלת כניסה: ברירת מחדל מהצלע התחתונה, בלי קריסה', () => {
    const e = G.entrance({ ...base, doors: [], ent: undefined });
    near(e.x, 500); near(e.y, 1000); near(e.ly, -1);
  });
});

describe('קירות, דלתות והתנגשות', () => {
  const map = {
    rooms: [{ id: 'r1', name: 'א', p: [0, 0, 1000, 0, 1000, 1000, 0, 1000], h: 300 }],
    doors: [{ id: 'd1', x: 500, y: 1000, w: 100, k: 'ent' }],
    walls: [{ id: 'w1', p: [500, 0, 500, 400], t: 10 }],
    cols: [], fx: [{ id: 'f1', k: 'gon', x: 250, y: 500, w: 200, d: 100, h: 180, a: 0, sides: 2, bays: 2, lvl: 4, room: 'r1' }],
  };
  it('פתח הדלת נחתך מהקיר', () => {
    const s = G.cutDoors(0, 1000, 1000, 1000, map.doors);
    assert.equal(s.length, 2); near(s[0][2], 450); near(s[1][0], 550);
    assert.equal(G.roomWallSegs(map).length, 5);
  });
  it('אי אפשר לעבור דרך קיר', () => {
    const segs = G.walkSegments(map);
    const [x] = G.moveWithCollision(300, 200, 800, 200, 25, segs); // קיר פנימי ב-x=500
    assert.ok(x <= 500 - 25 - 5 + 0.01, 'x=' + x);
  });
  it('אפשר לעבור דרך פתח הדלת, ואי אפשר דרך הקיר שלידה', () => {
    const segs = G.walkSegments(map);
    const [, y1] = G.moveWithCollision(500, 900, 500, 1100, 25, segs);
    near(y1, 1100);
    const [, y2] = G.moveWithCollision(200, 900, 200, 1100, 25, segs);
    assert.ok(y2 < 1000, 'y2=' + y2);
  });
  it('גוף חוסם הליכה', () => {
    const [, y] = G.moveWithCollision(250, 300, 250, 700, 25, G.walkSegments(map));
    assert.ok(y <= 450 - 25 + 0.01, 'y=' + y);
  });
});

describe('בדיקת מפה ומודל', () => {
  it('מפת הדוגמה תקינה ומסומנת "דוגמה"', () => {
    const m = G.sampleMap(300);
    assert.match(m.name, /^דוגמה/);
    assert.ok(m.name.length <= 40);
    assert.deepEqual(G.validateMap(m), []);
    assert.ok(m.fx.length >= 300);
    const nums = m.fx.map((f) => f.num); assert.equal(new Set(nums).size, nums.length);
  });
  it('שגיאות בעברית למפה שבורה', () => {
    const e = G.validateMap({ rooms: [], fx: [{ id: 'x', k: 'zzz', sides: 3 }] });
    assert.ok(e.length >= 3); assert.ok(e.every((s) => /[֐-׿]/.test(s)));
  });
  it('יותר מ-2000 מקטעים נחסם', () => {
    const fx = Array.from({ length: 70 }, (_, i) => ({ id: 'f' + i, k: 'gon', x: 100, y: 100, w: 100, d: 50, h: 100, a: 0, sides: 2, bays: 15, lvl: 3, room: 'r1' }));
    assert.ok(G.validateMap({ rooms: [{ id: 'r1', p: SQ, h: 300 }], fx }).some((s) => /2000/.test(s)));
  });
  it('המודל מדלג על רכיבים פגומים ולא קורס', () => {
    const md = G.buildModel({ rooms: [{ id: 'r1', p: SQ, h: 300 }, { id: 'r2', p: [0, 0, 1, 1, 2, 2] }], fx: [{ id: 'f1', k: 'gon', x: 'a' }, null], doors: [{ id: 'd1', x: NaN }] });
    assert.equal(md.rooms.length, 1); assert.equal(md.fx.length, 0); assert.ok(md.skip.length >= 3);
    assert.doesNotThrow(() => G.buildModel(null));
  });
  it('ביצועים: מודל של 300 גופים בפחות מ-50ms', () => {
    const m = G.sampleMap(300);
    G.buildModel(m); // חימום
    const t0 = process.hrtime.bigint();
    const md = G.buildModel(m);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log('buildModel 300 fx:', ms.toFixed(2), 'ms, bays:', md.bays.length, 'segs:', md.segs.length);
    assert.ok(md.fx.length >= 300);
    assert.ok(ms < 50, ms + 'ms');
  });
});
