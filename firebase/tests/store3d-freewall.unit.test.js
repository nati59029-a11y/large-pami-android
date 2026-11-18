'use strict';
// ניסוי "צילום חופשי של קיר" (store3d-freewall.js): זיהוי חפיפה אוטומטי, בלי DOM. תמונות סינתטיות בלבד (לא מאומת על תמונות אמיתיות).
// מרקם גדול נחתך ל-2 שורות × 3 תמונות חופפות (30%), עם הבדלי בהירות וסטייה אנכית קטנה; הבנייה צריכה לשחזר את ההזזות ב-±2px.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const FW = require('../../app-source/www/store3d-freewall.js');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function texture(w, h, seed) {
  const R = rng(seed), oct = [[6, 70], [16, 60], [48, 50]].map(([cs, amp]) => { const gw = Math.ceil(w / cs) + 2, gh = Math.ceil(h / cs) + 2, v = new Float32Array(gw * gh); for (let i = 0; i < v.length; i++) v[i] = (R() - .5) * amp; return { cs, gw, v }; });
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 128; for (const L of oct) { const fx = x / L.cs, fy = y / L.cs, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, q = (yy, xx) => L.v[yy * L.gw + xx]; s += (q(y0, x0) * (1 - tx) + q(y0, x0 + 1) * tx) * (1 - ty) + (q(y0 + 1, x0) * (1 - tx) + q(y0 + 1, x0 + 1) * tx) * ty; } g[y * w + x] = Math.max(0, Math.min(255, s)); }
  return { w, h, g };
}
function crop(T, x0, y0, w, h, gain, bias) { const g = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.max(0, Math.min(255, T.g[(y0 + y) * T.w + x0 + x] * gain + bias)); return { w, h, g }; }
const PH = 360, PW = 480;
// אמת: שורה עליונה y=8, תחתונה y=248 (חפיפה אנכית ~1/3); בתוך שורה dx=336 (30% חפיפה) וסטייה אנכית קטנה
const TRUTH = [[[0, 8], [336, 12], [672, 5]], [[10, 248], [346, 252], [682, 244]]];
function setup() {
  const T = texture(1200, 640, 7), imgs = new Map(), rows = [];
  TRUTH.forEach((row, r) => { rows.push(row.map(([x, y], j) => { const id = 'p' + r + j; imgs.set(id, crop(T, x, y, PW, PH, 1 + .06 * j - .05 * r, 6 * j - 4 * r)); return id; })); });
  return { rows, imgs, load: async id => imgs.get(id) };
}
const near = (a, b, m) => assert.ok(Math.abs(a - b) <= 2, `${m}: ${a} מול ${b}`);

describe('store3d-freewall: זיהוי חפיפה', () => {
  it('משחזר הזזות בתוך שורות ובין שורות ב-±2px', async () => {
    const S = setup(), est = await FW.estimate(S.rows, S.load, {});
    TRUTH.forEach((row, r) => { for (let j = 0; j < 2; j++) { const p = est.h[r][j]; assert.ok(p.ok, 'ביטחון ' + p.score); near(p.dx, row[j + 1][0] - row[j][0], 'dx'); near(p.dy, row[j + 1][1] - row[j][1], 'dy'); } });
    const ox = r => Math.min(...TRUTH[r].map(p => p[0])), oy = r => Math.min(...TRUTH[r].map(p => p[1])), v = est.v[0];
    assert.ok(v.ok, 'ביטחון אנכי ' + v.score); near(v.dx, ox(1) - ox(0), 'vdx'); near(v.dy, oy(1) - oy(0), 'vdy');
  });
  it('פריסה: מיקום כל תמונה לפי האמת (±2px) ותפרים באמצע החפיפה', async () => {
    const S = setup(), est = await FW.estimate(S.rows, S.load, {}), L = FW.layout(S.rows, est.grays, est, {});
    const bx = L.rows[0][0].x - TRUTH[0][0][0], by = L.rows[0][0].y - TRUTH[0][0][1];
    L.rows.forEach((row, r) => row.forEach((p, j) => { near(p.x - bx, TRUTH[r][j][0], 'x'); near(p.y - by, TRUTH[r][j][1], 'y'); }));
    assert.equal(L.seams.length, 5); assert.ok(L.seams.every(s => s.ok));
    const a = L.clips.get('p00'), b = L.clips.get('p01'); assert.ok(Math.abs(a.cx1 - b.cx0) < 1e-6); assert.ok(a.cx1 > b.x && a.cx1 < a.x + a.w);
    assert.ok(L.clips.get('p00').fb && !L.clips.get('p00').ft && L.clips.get('p10').ft);
  });
  it('תיקון ידני גובר על הזיהוי', async () => {
    const S = setup(), est = await FW.estimate(S.rows, S.load, {}), adj = { [est.h[0][0].key]: { dx: 300, dy: 0 } }, L = FW.layout(S.rows, est.grays, est, { adj });
    assert.equal(L.rows[0][1].x - L.rows[0][0].x, 300); assert.ok(L.seams.find(s => s.manual));
  });
  it('תמונות בלי חפיפה אמיתית: "לא בטוח" וחלוקה לפי המחוון', async () => {
    const A = texture(PW, PH, 1), B = texture(PW, PH, 2), est = await FW.estimate([['a', 'b']], async id => (id === 'a' ? A : B), { ov: .25 }), L = FW.layout([['a', 'b']], est.grays, est, { ov: .25 });
    assert.equal(est.h[0][0].ok, false); assert.equal(L.rows[0][1].x - L.rows[0][0].x, Math.round(PW * .75)); assert.equal(L.seams[0].ok, false);
  });
  it('תמונה לאורך (צרה) בשורה עם תמונות לרוחב', async () => {
    const T = texture(1000, 400, 3), P = { a: crop(T, 0, 20, 480, 360, 1, 0), b: crop(T, 330, 20, 270, 360, 1.05, 3) }, est = await FW.estimate([['a', 'b']], async id => P[id], {});
    assert.ok(est.h[0][0].ok); near(est.h[0][0].dx, 330, 'dx'); near(est.h[0][0].dy, 0, 'dy');
  });
  it('קירות המפה: קיבוץ לפי חדר וצלע, אורך מסכום הקטעים וגובה תקרה', () => {
    const plan = { items: [{ k: 'w', room: 'r1', edge: 1, seg: 1, geo: [0, 0, 250, 0] }, { k: 'w', room: 'r1', edge: 1, seg: 2, geo: [250, 0, 400, 0] }, { k: 'w', room: 'r1', edge: 2, seg: 1, geo: [400, 0, 400, 300] }, { k: 'b', room: 'r1' }] };
    const W = FW.wallsOf(plan, { rooms: [{ id: 'r1', name: 'חנות', h: 280 }] });
    assert.equal(W.length, 2); assert.equal(W[0].len, 400); assert.equal(W[0].h, 280); assert.equal(W[1].len, 300); assert.equal(W[0].name, 'חנות');
  });
});
