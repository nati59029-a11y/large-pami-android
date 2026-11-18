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
    const q = L.rows[0][1]; assert.ok(q.l && q.l[0] >= 0 && q.l[1] > q.l[0]); // מעבר רך באמצע אזור החפיפה
    const ovl = L.rows[0][0].x + L.rows[0][0].w - q.x; assert.ok(Math.abs((q.l[0] + q.l[1]) / 2 - ovl / 2) < 1); assert.ok(q.l[1] - q.l[0] <= .15 * q.w + 1e-6);
    assert.equal(L.rows[0][0].l, null); assert.equal(L.rows[0][0].t, null); assert.ok(L.rows[1][0].t);
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

  it('קיר גדול: 4 שורות × 16/15/16/15 תמונות, חפיפה 30%, קנה מידה ±5% ובהירות – מיקומים נשחזרים, בלי חורים', async () => {
    const R = rng(11), T = texture(8000, 2400, 21), N = [16, 15, 16, 15], imgs = new Map(), rows = [], truth = new Map();
    const bl = (x, y, sx, sy) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * T.w + x0; return (T.g[i] * (1 - fx) + T.g[i + 1] * fx) * (1 - fy) + (T.g[i + T.w] * (1 - fx) + T.g[i + T.w + 1] * fx) * fy; };
    N.forEach((n, r) => { const row = [], fr = 1 + (r % 2 ? .03 : -.03); let x = 200 + (n === 15 ? 170 : 0), y = 100 + r * 250 + Math.round((R() - .5) * 8);
      for (let j = 0; j < n; j++) { const f = fr * (1 + (R() - .5) * .04), w = 480 * f, h = 360 * f, g = new Uint8Array(480 * 360), gain = 1 + (R() - .5) * .16, bias = (R() - .5) * 16;
        for (let yy = 0; yy < 360; yy++) for (let xx = 0; xx < 480; xx++) g[yy * 480 + xx] = Math.max(0, Math.min(255, bl(x + xx * f, y + yy * f) * gain + bias));
        const id = 'q' + r + '_' + j; imgs.set(id, { w: 480, h: 360, g }); row.push(id); truth.set(id, { x, y, f });
        x += (336 + (R() - .5) * 10) * f; y += (R() - .5) * 8 + (R() - .5) * 0; if (j < n - 1) { /* המשך לתמונה הבאה */ } }
      rows.push(row); });
    const t0 = Date.now(), est = await FW.estimate(rows, async id => imgs.get(id), {}), ms = Date.now() - t0, L = FW.layout(rows, est.grays, est, {});
    const f0 = truth.get('q0_0').f, ref = L.rows[0][0], tx0 = truth.get('q0_0').x / f0, ty0 = truth.get('q0_0').y / f0; let ex = 0, ey = 0, ec = 0, bad = 0;
    L.rows.forEach(row => row.forEach(p => { const t = truth.get(p.id); ex = Math.max(ex, Math.abs(p.x - ref.x - (t.x / f0 - tx0))); ey = Math.max(ey, Math.abs(p.y - ref.y - (t.y / f0 - ty0))); ec = Math.max(ec, Math.abs(p.w / 480 - t.f / f0)); }));
    L.seams.forEach(s => { if (!s.ok) bad++; });
    // יישור מקומי (מה שנראה בעין): לכל זוג תמונות חופפות (שכנות בשורה, או מעל/מתחת) – היכן נופלת אותה נקודת מרקם (מרכז החפיפה) בכל אחת מהן בפריסה. 0 = יישור מושלם
    const at = (p, T) => { const t = truth.get(p.id); return [p.x + (T[0] - t.x) / t.f * (p.w / 480), p.y + (T[1] - t.y) / t.f * (p.h / 360)]; };
    const mis = (p, q) => { const a = truth.get(p.id), b = truth.get(q.id), x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + 480 * a.f, b.x + 480 * b.f), y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + 360 * a.f, b.y + 360 * b.f); if (x1 - x0 < 40 || y1 - y0 < 40) return null; const T = [(x0 + x1) / 2, (y0 + y1) / 2], u = at(p, T), w = at(q, T); return Math.hypot(u[0] - w[0], u[1] - w[1]); };
    let nbr = 0, vert = 0;
    L.rows.forEach((row, r) => row.forEach((p, j) => { if (j) { const m = mis(row[j - 1], p); if (m != null) nbr = Math.max(nbr, m); }
      if (r) for (const u of L.rows[r - 1]) { const m = mis(u, p); if (m != null) vert = Math.max(vert, m); } }));
    console.log(`  סטיית יישור בנקודת החפיפה: בתוך שורה ${nbr.toFixed(1)}px, בין שורות ${vert.toFixed(1)}px (גודל תמונה 480×360)`);
    assert.ok(nbr < 4, 'nbr ' + nbr); assert.ok(vert < 9, 'vert ' + vert);
    console.log(`  64 תמונות: ${ms}ms, שגיאת מיקום מרבית x=${ex.toFixed(1)} y=${ey.toFixed(1)} קנה מידה=${ec.toFixed(3)}, חיבורים לא בטוחים: ${bad}/${L.seams.length}`);
    assert.equal(bad, 0); assert.ok(ex < 60 && ey < 15, `x=${ex} y=${ey}`); assert.ok(ec < .03, String(ec));
    // בלי חורים: בתוך אזור החיתוך המשותף כל תא מכוסה בתמונה כלשהי
    const c = L.crop; assert.ok(c); let tot = 0, miss = 0; for (let y = 0; y < L.H; y += 4) for (let x = c.x0; x < c.x1; x += 4) { tot++; if (!L.rows.some(row => row.some(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h))) miss++; }
    console.log(`  כיסוי באזור המשותף: ${(100 - 100 * miss / tot).toFixed(2)}%`); assert.ok(miss / tot < .02, String(miss / tot));
    assert.ok(L.gaps.length >= 1); // שורות של 15 קצרות מ-16 ⇒ סימון "לא צולם"
  });

  it('מרקם חוזר (מוצרים זהים) + סיבוב ±1.5° וקנה מידה ±5%: חיבורים בטוחים וההזזה נכונה (±8px)', async () => {
    const R = rng(9), T = texture(3200, 500, 33); // מרקם בסיס; חוזר כל 160px אופקית (כמו מוצרים שחוזרים על מדף) עם שינוי קל
    for (let y = 0; y < T.h; y++) for (let x = 160; x < T.w; x++) T.g[y * T.w + x] = Math.round(T.g[y * T.w + (x % 160)] * .5 + T.g[y * T.w + x] * .5);
    const bl = (x, y) => { x = Math.max(0, Math.min(T.w - 2, x)); y = Math.max(0, Math.min(T.h - 2, y)); const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * T.w + x0; return (T.g[i] * (1 - fx) + T.g[i + 1] * fx) * (1 - fy) + (T.g[i + T.w] * (1 - fx) + T.g[i + T.w + 1] * fx) * fy; };
    const imgs = new Map(), ids = [], tr = []; let x = 20;
    for (let j = 0; j < 7; j++) { const f = 1 + (R() - .5) * .1, a = (R() - .5) * 3 * Math.PI / 180, y = 40 + (R() - .5) * 16, g = new Uint8Array(480 * 360), ca = Math.cos(a), sa = Math.sin(a);
      for (let yy = 0; yy < 360; yy++) for (let xx = 0; xx < 480; xx++) { const u = (xx - 240) * f, v = (yy - 180) * f; g[yy * 480 + xx] = bl(x + 240 * f + u * ca - v * sa, y + 180 * f + u * sa + v * ca); }
      imgs.set('t' + j, { w: 480, h: 360, g }); ids.push('t' + j); tr.push({ x, f }); x += 336 * f; }
    const est = await FW.estimate([ids], async id => imgs.get(id), {}); let bad = 0, mx = 0;
    est.h[0].forEach((p, j) => { if (!p.ok) bad++; mx = Math.max(mx, Math.abs(p.dx - 336)); });
    console.log(`  מרקם חוזר + סיבוב: לא בטוחים ${bad}/6, סטיית dx מרבית ${mx.toFixed(1)}px`);
    assert.equal(bad, 0); assert.ok(mx < 8, String(mx));
  });
  it('הצעת סדר: תמונות מעורבבות בשורה ⇒ נמצא הסדר הנכון (או ההפוך כולו לא נחשב: משמאל לימין)', async () => {
    const T = texture(3000, 420, 51), ids = [], G = new Map(); for (let j = 0; j < 8; j++) { const id = 'o' + j; G.set(id, crop(T, 20 + j * 336, 30, 480, 360, 1, 0)); ids.push(id); }
    const shuf = [ids[3], ids[0], ids[6], ids[1], ids[7], ids[4], ids[2], ids[5]], q = await FW.suggestOrder(shuf, G);
    assert.deepEqual(q.order, ids); assert.ok(q.changed); assert.ok(q.score > q.cur);
    const same = await FW.suggestOrder(ids, G); assert.equal(same.changed, false);
  });
});
