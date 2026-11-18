'use strict';
// ניסוי "צילום חופשי של קיר" (store3d-freewall.js): חיבור עם OpenCV (opencv.js), בלי DOM. תמונות סינתטיות.
// הבדיקה על תמונות אמיתיות: scripts/freewall-real-test.js (התמונות לא במאגר).
// דרוש @techstark/opencv-js (app-source/node_modules אחרי npm install שם, או NODE_PATH). בלעדיו – בדיקות OpenCV מדולגות.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const FW = require('../../app-source/www/store3d-freewall.js');
let cv0 = null;
for (const p of ['../../app-source/node_modules/@techstark/opencv-js', '@techstark/opencv-js']) { try { cv0 = require(p); break; } catch (e) { /* הבא */ } }
const skip = cv0 ? false : 'opencv.js לא מותקן';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// "קיר" סינתטי: רקע עם רעש ומאות מלבנים ועיגולים בגדלים ובבהירויות שונים (פינות ברורות ל-AKAZE)
function wall(w, h, seed) {
  const R = rng(seed), g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = 90 + R() * 30;
  for (let k = 0; k < 900; k++) {
    const x0 = R() * w, y0 = R() * h, s = 8 + R() * 50, v = R() * 255, circ = R() < .4;
    for (let y = Math.max(0, y0 | 0); y < Math.min(h, y0 + s); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(w, x0 + s * (circ ? 1 : .5 + R())); x++) {
      if (circ && Math.hypot(x - x0 - s / 2, y - y0 - s / 2) > s / 2) continue; g[y * w + x] = v; }
  }
  return { w, h, g };
}
function crop(T, x0, y0, w, h, gain) { const g = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.max(0, Math.min(255, T.g[(y0 + y) * T.w + x0 + x] * gain)); return { w, h, g }; }
const PW = 600, PH = 800;
// אמת: שורה עליונה y=0, תחתונה y=520 (חפיפה אנכית ~35%); בתוך שורה הזזה של 400 (חפיפה ~33%) וסטייה אנכית קטנה
const TRUTH = { a0: [0, 4], a1: [400, 0], a2: [800, 10], b0: [6, 520], b1: [404, 526], b2: [806, 515] };
function setup() {
  const T = wall(1500, 1400, 5), imgs = new Map();
  Object.entries(TRUTH).forEach(([id, [x, y]], i) => imgs.set(id, crop(T, x, y, PW, PH, 1 + .05 * (i % 3) - .04)));
  const io = { gray: async id => { const g = imgs.get(id), s = Math.min(1, FW.FEAT / Math.max(g.w, g.h)); return Object.assign({}, g, { W: g.w, H: g.h, w: g.w, h: g.h, g: g.g }); } };
  return { imgs, io, rows: [['a0', 'a1', 'a2'], ['b0', 'b1', 'b2']] };
}
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a.toFixed(1)} מול ${b}`);

describe('store3d-freewall: חיבור עם OpenCV', { skip }, () => {
  let cv;
  it('טעינת opencv.js', async () => { cv = (await FW.cvReady(cv0)).cv; assert.equal(typeof cv.AKAZE, 'function'); });
  it('2 שורות × 3 תמונות: כל התמונות מוקמו, מיקומים לפי האמת (±4px)', async () => {
    const S = setup(), pl = await FW.plan(cv, S.rows, S.io, {});
    assert.deepEqual(pl.unplaced, []); assert.equal(pl.G.size, 6);
    const ref = pl.G.get(pl.ref), [rx, ry] = TRUTH[pl.ref];
    for (const [id, [x, y]] of Object.entries(TRUTH)) { const T = pl.G.get(id); near(T[2] - ref[2], x - rx, 4, id + ' x'); near(T[5] - ref[5], y - ry, 4, id + ' y'); near(T[0], 1, .02, id + ' קנה מידה'); }
    assert.ok(pl.edges.some(e => e.dir === 'v'), 'חיבור בין השורות');
  });
  it('סדר שגוי בשורה (1,3,2) – עדיין ממוקם נכון', async () => {
    const S = setup(), pl = await FW.plan(cv, [['a0', 'a2', 'a1']], S.io, {});
    assert.deepEqual(pl.unplaced, []);
    const d = id => pl.G.get(id)[2] - pl.G.get('a0')[2]; near(d('a1'), 400, 4, 'a1'); near(d('a2'), 800, 4, 'a2');
  });
  it('תמונה בלי חפיפה – מסומנת "לא חוברה" ולא נכנסת לקיר', async () => {
    const S = setup(); S.imgs.set('x', crop(wall(700, 900, 99), 0, 0, PW, PH, 1));
    const pl = await FW.plan(cv, [['a0', 'a1', 'x']], S.io, {});
    assert.deepEqual(pl.unplaced, ['x']); assert.ok(!pl.G.has('x'));
  });
  it('חיבור ידני גובר (לזוג שלא חובר)', async () => {
    const S = setup(); S.imgs.set('x', crop(wall(700, 900, 99), 0, 0, PW, PH, 1));
    const pl = await FW.plan(cv, [['a0', 'x']], S.io, { manual: { 'a0:x': { dx: 450, dy: 20 } } });
    assert.deepEqual(pl.unplaced, []); near(pl.G.get('x')[2] - pl.G.get('a0')[2], 450, 1, 'dx'); near(pl.G.get('x')[5] - pl.G.get('a0')[5], 20, 1, 'dy');
  });
  it('מסגרת, חיתוך ואריח: בלי שטח לא מכוסה בתוך החיתוך', async () => {
    const S = setup(), pl = await FW.plan(cv, S.rows, S.io, {}), fr = FW.frame(cv, pl, 400);
    assert.ok(fr.crop.x1 > fr.crop.x0 && fr.crop.y1 > fr.crop.y0);
    const io = { color: async id => { const g = S.imgs.get(id), d = new Uint8Array(g.w * g.h * 4); for (let i = 0; i < g.g.length; i++) { d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = g.g[i]; d[4 * i + 3] = 255; } return { w: g.w, h: g.h, data: d }; } };
    const V = fr.crop, k = .25, tw = Math.round((V.x1 - V.x0) * k), th = Math.round((V.y1 - V.y0) * k), t = await FW.tile(cv, pl, fr, io, V, k, 0, 0, tw, th);
    assert.equal(t.rgba.length, tw * th * 4); assert.ok(t.cov > .97, 'כיסוי ' + t.cov);
  });
});

describe('store3d-freewall: קירות המפה', () => {
  it('קיבוץ לפי חדר וצלע, אורך מסכום הקטעים וגובה תקרה', () => {
    const plan = { items: [{ k: 'w', room: 'r1', edge: 1, seg: 1, geo: [0, 0, 250, 0] }, { k: 'w', room: 'r1', edge: 1, seg: 2, geo: [250, 0, 400, 0] }, { k: 'w', room: 'r1', edge: 2, seg: 1, geo: [400, 0, 400, 300] }, { k: 'b', room: 'r1' }] };
    const W = FW.wallsOf(plan, { rooms: [{ id: 'r1', name: 'חנות', h: 280 }] });
    assert.equal(W.length, 2); assert.equal(W[0].len, 400); assert.equal(W[0].h, 280); assert.equal(W[1].len, 300); assert.equal(W[0].name, 'חנות');
  });
});
