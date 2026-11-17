'use strict';
// הקמת חנות – שלב 4 (17.11.2026): יישור וחיבור תמונות לחזית (store3d-warp.js), בלי אמולטור ובלי DOM.
// תמונות סינתטיות בלבד: חזית "אמיתית" ידועה (מרקם אקראי קבוע), ממנה "מצלמים" תמונות בפרספקטיבה ידועה (1600×1200),
// ומודדים: שגיאת יישור גיאומטרית (בפיקסלי חזית) מול האמת, חיבור 3 חופפות לחזית אחת, "חסר קטע" בפער אמיתי, מדף גבוה, 6×1600 בזמן סביר.
// (לא מאומת על תמונות אמיתיות.)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../app-source/www/store3d-warp.js');

// ---------- עזרים ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function inv3(m) { const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g), G = b * f - c * e, Hh = -(a * f - c * d), I = a * e - b * d, det = a * A + b * B + c * C; return [A / det, D / det, G / det, B / det, E / det, Hh / det, C / det, F / det, I / det]; }
// מטריצה 3×3 של "מלבן ← מרובע" (קואורדינטות קצה, לא מרכזי פיקסלים)
function rect2quad(r, Q) { const k = W.sq2q(Q); const sx = 1 / (r.x1 - r.x0), sy = 1 / (r.y1 - r.y0); const N = [sx, 0, -r.x0 * sx, 0, sy, -r.y0 * sy, 0, 0, 1]; return mul(k, N); }
function mul(A, B) { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j]; o.push(s); } return o; }
const ap = (m, x, y) => { const z = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z]; };
// חזית אמת: רעש בכמה קני מידה + פסי מדפים, צבעוני
function truth(w, h, seed) {
  const R = rng(seed), layers = [[8, 60], [24, 70], [80, 60]].map(([cs, amp]) => { const gw = Math.ceil(w / cs) + 2, gh = Math.ceil(h / cs) + 2, v = new Float32Array(gw * gh * 3); for (let i = 0; i < v.length; i++) v[i] = (R() - .5) * amp; return { cs, gw, v }; });
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; let r = 128, g = 120, b = 110;
    for (const L of layers) { const fx = x / L.cs, fy = y / L.cs, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      for (let c = 0; c < 3; c++) { const q = (yy, xx) => L.v[((yy) * L.gw + xx) * 3 + c]; const v = (q(y0, x0) * (1 - tx) + q(y0, x0 + 1) * tx) * (1 - ty) + (q(y0 + 1, x0) * (1 - tx) + q(y0 + 1, x0 + 1) * tx) * ty; if (c === 0) r += v; else if (c === 1) g += v; else b += v; } }
    if (y % 170 < 10) { r = 200; g = 190; b = 170; }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; }
  return { w, h, data: d };
}
function bil(img, u, v) { const x = Math.min(Math.max(u, 0), img.w - 1), y = Math.min(Math.max(v, 0), img.h - 1), x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, img.w - 1), y1 = Math.min(y0 + 1, img.h - 1), fx = x - x0, fy = y - y0, o = [0, 0, 0];
  for (let c = 0; c < 3; c++) { const p = (yy, xx) => img.data[(yy * img.w + xx) * 4 + c]; o[c] = (p(y0, x0) * (1 - fx) + p(y0, x1) * fx) * (1 - fy) + (p(y1, x0) * (1 - fx) + p(y1, x1) * fx) * fy; } return o; }
// "צילום": מרובע אמיתי Qe (קואורדינטות קצה בתמונה 1600×1200) של טווח [a,b] בחזית, עם הזזת בהירות
function shoot(G, xr, Qe, band, light, seed) {
  const pw = 1600, ph = 1200, R = rng(seed), r = { x0: xr.a / 1000 * G.w, x1: xr.b / 1000 * G.w, y0: band[0], y1: band[1] }, T = rect2quad(r, Qe), Ti = inv3(T), d = new Uint8ClampedArray(pw * ph * 4);
  for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) { const o = (j * pw + i) * 4, [gx, gy] = ap(Ti, i + .5, j + .5);
    if (gx >= r.x0 && gx <= r.x1 && gy >= r.y0 && gy <= r.y1) { const c = bil(G, gx - .5, gy - .5); d[o] = c[0] + light; d[o + 1] = c[1] + light; d[o + 2] = c[2] + light; }
    else { const n = R() * 255; d[o] = n; d[o + 1] = n * .8; d[o + 2] = 90; } d[o + 3] = 255; }
  return { img: { w: pw, h: ph, data: d }, T, r };
}
// quad כפי שה-AI/העורך מחזיר: אלפיות שלמות
const toQ = (Qe) => Qe.map((v, i) => Math.round(v / (i % 2 ? 1200 : 1600) * 1000));
// שגיאה גיאומטרית בפיקסלי חזית: לכל פיקסל חזית שנלקח מהתמונה – לאן הוא נופל בחזית האמיתית
function geoErr(G, ph, S, shot, sh, opt) {
  const F = W.size(opt.aspect), q = ph.quad, P = q.map((v, i) => v / 1000 * (i % 2 ? ph.img.h : ph.img.w) - .5), k = W.sq2q(P), r = { x0: ph.xr.a / 1000 * F.w, x1: ph.xr.b / 1000 * F.w, y0: shot.r.y0, y1: shot.r.y1 }, M = W.mapper(r, k), Ti = inv3(shot.T);
  let mx = 0, sum = 0, n = 0; const uv = [0, 0];
  for (let y = Math.ceil(r.y0) + 2; y < r.y1 - 2; y += 7) for (let x = Math.ceil(r.x0 + sh.dx) + 2; x < r.x1 + sh.dx - 2; x += 7) {
    M(x + .5 - sh.dx, y + .5 - sh.dy, uv); const [gx, gy] = ap(Ti, uv[0] + .5, uv[1] + .5); const e = Math.hypot(gx - (x + .5), gy - (y + .5)); if (e > mx) mx = e; sum += e; n++; }
  return { max: mx, mean: sum / n };
}
const ASP = 2; // מקטע 200×100 ס"מ ⇒ חזית 2048×1024
let GT = null; const gt = () => GT || (GT = truth(2048, 1024, 7));
// שלוש תמונות חופפות (≈20% חפיפה), כל אחת בפרספקטיבה אחרת
const XR3 = [{ a: 0, b: 400 }, { a: 300, b: 700 }, { a: 600, b: 1000 }];
const QE3 = [[180, 130, 1430, 210, 1390, 1080, 150, 1010], [120, 170, 1500, 120, 1460, 1060, 170, 1110], [210, 100, 1440, 160, 1480, 1120, 130, 1050]];
let SH3 = null; const shots3 = () => SH3 || (SH3 = XR3.map((xr, i) => shoot(gt(), xr, QE3[i], [0, 1024], [0, 14, -12][i], 11 + i)));
const mk = (sh, i, xr) => ({ img: sh.img, quad: toQ(QE3[i]), xr: xr || XR3[i], lv: 'a' });
const RES = {};

describe('store3d-warp – יישור וחיבור (סינתטי)', () => {
  it('sq2q: 4 הפינות של ריבוע היחידה נופלות בדיוק על המרובע; quadOk דוחה מרובע הפוך/מנוון', () => {
    const Q = [10, 20, 300, 5, 320, 250, 0, 230], k = W.sq2q(Q), m = W.mapper({ x0: 0, x1: 1, y0: 0, y1: 1 }, k), o = [0, 0];
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([s, t], i) => { m(s, t, o); assert.ok(Math.abs(o[0] - Q[2 * i]) < 1e-6 && Math.abs(o[1] - Q[2 * i + 1]) < 1e-6); });
    assert.equal(W.quadOk([0, 0, 1000, 0, 1000, 1000, 0, 1000]), true);
    assert.equal(W.quadOk([0, 0, 1000, 1000, 1000, 0, 0, 1000]), false); // "פרפר"
    assert.equal(W.quadOk([0, 0, 10, 0, 10, 10, 0, 10]), false); // קטן מדי
    assert.equal(W.quadOk([0, 0, 1000, 0]), false);
  });
  it('יישור לפי quad (אלפיות שלמות) + xr מדויק: שגיאה מקסימלית < 2px בכל תמונה', () => {
    const S = shots3(); RES.exact = S.map((sh, i) => geoErr(gt(), mk(sh, i), null, sh, { dx: 0, dy: 0 }, { aspect: ASP }));
    console.log('  שגיאת יישור (xr מדויק):', RES.exact.map((e) => `max ${e.max.toFixed(2)}px / ממוצע ${e.mean.toFixed(2)}px`).join(' | '));
    for (const e of RES.exact) assert.ok(e.max < 2, JSON.stringify(e));
  });
  it('3 חופפות = חזית אחת: 2048×1024, בלי קטע חסר, כיסוי ≥0.99, שני הקצוות; הפרש צבע מהאמת קטן', () => {
    const S = shots3(), t0 = Date.now(), r = W.stitch(S.map((sh, i) => mk(sh, i)), { aspect: ASP }), ms = Date.now() - t0;
    assert.equal(r.w, 2048); assert.equal(r.h, 1024); assert.deepEqual(r.gaps, []); assert.ok(r.cov >= 0.99, String(r.cov)); assert.deepEqual(r.ends, ['l', 'r']);
    // הזזה שנמצאה כשה-xr מדויק – קרובה ל-0
    for (const s of r.seams) assert.ok(Math.hypot(s.dx, s.dy) < 1.5, JSON.stringify(s));
    let e = 0, n = 0; const G = gt(); for (let y = 6; y < 1018; y += 5) for (let x = 6; x < 2042; x += 5) { const o = (y * 2048 + x) * 4; e += Math.abs(r.data[o + 1] - G.data[o + 1]); n++; }
    RES.mae = e / n; RES.ms3 = ms; console.log(`  חזית מ-3 תמונות: ${ms}ms, הפרש צבע ממוצע מהאמת ${RES.mae.toFixed(2)} (מתוך 255; כולל הבדלי תאורה מכוונים ±14), תפרים`, JSON.stringify(r.seams));
    assert.ok(RES.mae < 12, String(RES.mae));
  });
  it('xr לא מדויק (תמונה 2 זזה ב-+15‰, תמונה 3 ב-−12‰ ≈ 31/25px): תיקון ההזזה מחזיר את היישור ל-<2px; בלי תיקון השגיאה גדולה', () => {
    const S = shots3(), bad = [XR3[0], { a: 315, b: 715 }, { a: 588, b: 988 }], ph = S.map((sh, i) => mk(sh, i, bad[i]));
    const r = W.stitch(ph, { aspect: ASP }), r0 = W.stitch(ph, { aspect: ASP, refine: false });
    const after = ph.map((p, i) => geoErr(gt(), p, null, S[i], r.shifts[[0, 1, 2].sort((a, b) => bad[a].a - bad[b].a).indexOf(i)], { aspect: ASP }));
    const before = ph.map((p, i) => geoErr(gt(), p, null, S[i], { dx: 0, dy: 0 }, { aspect: ASP }));
    RES.fix = { before: before.map((e) => +e.max.toFixed(2)), after: after.map((e) => +e.max.toFixed(2)), seams: r.seams };
    console.log('  xr שגוי – שגיאה מקסימלית לפני/אחרי תיקון:', JSON.stringify(RES.fix.before), '→', JSON.stringify(RES.fix.after), 'תפרים', JSON.stringify(r.seams));
    assert.ok(before[1].max > 20 && before[2].max > 15);
    for (const e of after) assert.ok(e.max < 2, JSON.stringify(after));
    assert.equal(r.seams.length, 2); assert.deepEqual(r0.seams, []);
    // אחרי שתמונה 3 זזה שמאלה, הקצה הימני פתוח ⇒ חסר בסוף (נכון: באמת לא צולם בתוצאה)
    assert.ok(r.gaps.length <= 1);
  });
  it('פער אמיתי ⇒ "חסר קטע": [0–400] + [600–1000] ⇒ gap ≈ 400–600; כיסוי ~0.8', () => {
    const S = shots3(), r = W.stitch([mk(S[0], 0), mk(S[2], 2)], { aspect: ASP });
    assert.equal(r.gaps.length, 1); assert.ok(Math.abs(r.gaps[0].a - 400) <= 2 && Math.abs(r.gaps[0].b - 600) <= 2, JSON.stringify(r.gaps)); assert.ok(Math.abs(r.cov - 0.8) < 0.01, String(r.cov)); assert.deepEqual(r.ends, ['l', 'r']);
  });
  it('קצה לא צולם: [0–400] + [300–700] ⇒ חסר 700–1000, הקצה הימני לא נראה', () => {
    const S = shots3(), r = W.stitch([mk(S[0], 0), mk(S[1], 1)], { aspect: ASP });
    assert.equal(r.gaps.length, 1); assert.ok(Math.abs(r.gaps[0].a - 700) <= 2 && r.gaps[0].b === 1000, JSON.stringify(r.gaps)); assert.deepEqual(r.ends, ['l']);
  });
  it('פער זעיר (פחות מ-10‰, עיגול) לא נחשב חסר: [0–400] + [405–1000]', () => {
    const S = shots3(), r = W.stitch([mk(S[0], 0), { img: S[2].img, quad: toQ(QE3[2]), xr: { a: 405, b: 1000 }, lv: 'a' }], { aspect: ASP, refine: false });
    assert.deepEqual(r.gaps, []);
  });
  it('quad חלקי (פינה מחוץ לתמונה) ⇒ הפיקסלים שלא קיימים לא נספרים כמכוסים', () => {
    const S = shots3(), q = [-100, 0, 1000, 0, 1000, 1000, -100, 1000], r = W.stitch([{ img: S[0].img, quad: q, xr: { a: 0, b: 1000 }, lv: 'a' }], { aspect: ASP });
    // quadOk דוחה ערכים מחוץ לטווח? לא – רק צורה. כאן 10% מהרוחב מחוץ לתמונה ⇒ חסר בצד שמאל
    assert.ok(r.gaps.length === 1 && r.gaps[0].a === 0 && r.gaps[0].b >= 80, JSON.stringify(r.gaps)); assert.deepEqual(r.ends, ['r']);
  });
  it('מדף גבוה: עליון בלבד ⇒ כל התחתון חסר (lv b); עליון+תחתון ⇒ בלי חסר', () => {
    const G = gt(), t = shoot(G, { a: 0, b: 1000 }, QE3[0], [0, 512], 0, 21), b = shoot(G, { a: 0, b: 1000 }, QE3[1], [512, 1024], 0, 22);
    const r1 = W.stitch([{ img: t.img, quad: toQ(QE3[0]), xr: { a: 0, b: 1000 }, lv: 't' }], { aspect: ASP });
    assert.deepEqual(r1.gaps, [{ a: 0, b: 1000, lv: 'b' }]); assert.equal(r1.lv, 'tb');
    const r2 = W.stitch([{ img: t.img, quad: toQ(QE3[0]), xr: { a: 0, b: 1000 }, lv: 't' }, { img: b.img, quad: toQ(QE3[1]), xr: { a: 0, b: 1000 }, lv: 'b' }], { aspect: ASP });
    assert.deepEqual(r2.gaps, []); assert.ok(r2.cov > 0.99);
  });
  it('2×2 (מדף גבוה, שני גבהים, עם yr חופף): 4 תמונות ⇒ חזית אחת; yr שגוי ב-20‰ (≈20px) מתוקן ל-<2px', () => {
    const G = gt(), YR = { t: { a: 0, b: 560 }, b: { a: 440, b: 1000 } }, XR = [{ a: 0, b: 560 }, { a: 440, b: 1000 }], S = [];
    for (const lv of ['t', 'b']) XR.forEach((xr, i) => { const y = YR[lv], Q = QE3[(i + (lv === 'b' ? 1 : 0)) % 3]; S.push({ lv, xr, yr: y, Q, sh: shoot(G, xr, Q, [y.a / 1000 * 1024, y.b / 1000 * 1024], 0, 60 + S.length) }); });
    const ph = (bad) => S.map((x, i) => ({ img: x.sh.img, quad: toQ(x.Q), xr: x.xr, lv: x.lv, yr: bad && i >= 2 ? { a: x.yr.a - 20, b: x.yr.b - 20 } : x.yr }));
    const r = W.stitch(ph(false), { aspect: ASP });
    assert.deepEqual(r.gaps, []); assert.ok(r.cov > 0.99); assert.equal(r.seams.length, 3);
    for (const s of r.seams) assert.ok(Math.hypot(s.dx, s.dy) < 1.5, JSON.stringify(r.seams));
    // תמונות התחתון עם yr מוזז 20‰ למעלה (≈20px): התיקון מוצא dy ≈ +20 מול העליונות
    const pb = ph(true), r2 = W.stitch(pb, { aspect: ASP });
    RES.tb = r2.seams; console.log('  2×2: תפרים (yr מדויק)', JSON.stringify(r.seams), '| yr שגוי:', JSON.stringify(r2.seams));
    const e2 = geoErr(G, pb[2], null, { r: { y0: pb[2].yr.a / 1000 * 1024, y1: pb[2].yr.b / 1000 * 1024 }, T: S[2].sh.T }, r2.shifts[2], { aspect: ASP });
    const e0 = geoErr(G, pb[2], null, { r: { y0: pb[2].yr.a / 1000 * 1024, y1: pb[2].yr.b / 1000 * 1024 }, T: S[2].sh.T }, { dx: 0, dy: 0 }, { aspect: ASP });
    console.log(`  2×2: שגיאה מקסימלית בתמונת תחתון-שמאל לפני/אחרי תיקון: ${e0.max.toFixed(2)} → ${e2.max.toFixed(2)}px`); RES.tbErr = [e0.max, e2.max];
    assert.ok(e0.max > 15 && e2.max < 2, JSON.stringify([e0, e2]));
  });
  it('בלי quad ובלי xr (לפני AI): כל התמונה, חלוקה שווה; quad שבור ⇒ כל התמונה; off לא נכנס', () => {
    const S = shots3(), r = W.stitch([{ img: S[0].img, lv: 'a' }, { img: S[1].img, quad: [1, 2, 3], lv: 'a' }, { img: S[2].img, lv: 'a', off: true }], { aspect: ASP });
    assert.deepEqual(r.gaps, []); assert.equal(r.seams.length, 0);
    const m = W.defXr([{ lv: 'a' }, { lv: 'a' }, { lv: 'a' }]); assert.deepEqual([...m.values()], [{ a: 0, b: 333 }, { a: 333, b: 667 }, { a: 667, b: 1000 }]);
  });
  it('גודל: הצלע הארוכה ≤2048; קיר גבוה וצר (aspect 0.5) ⇒ 1024×2048; maxSide מגביל', () => {
    assert.deepEqual(W.size(2), { w: 2048, h: 1024 }); assert.deepEqual(W.size(0.5), { w: 1024, h: 2048 }); assert.deepEqual(W.size(3, 900), { w: 900, h: 300 }); assert.deepEqual(W.size(NaN), { w: 2048, h: 1024 });
  });
  it('6 תמונות 1600×1200 ⇒ חזית אחת, בזמן סביר', () => {
    const G = gt(), X = [0, 150, 320, 480, 650, 800].map((a, i) => ({ a, b: Math.min(1000, a + 230 + (i === 5 ? 200 : 0)) })), S = X.map((xr, i) => shoot(G, xr, QE3[i % 3], [0, 1024], (i % 3) * 5, 40 + i));
    const t0 = Date.now(), r = W.stitch(S.map((s, i) => ({ img: s.img, quad: toQ(QE3[i % 3]), xr: X[i], lv: 'a' })), { aspect: ASP }), ms = Date.now() - t0;
    RES.ms6 = ms; console.log(`  6×1600×1200 ב-Node: ${ms}ms, כיסוי ${r.cov}, חסר ${JSON.stringify(r.gaps)}, תפרים ${r.seams.length}`);
    assert.deepEqual(r.gaps, []); assert.ok(ms < 6000, String(ms));
    for (const s of r.seams) assert.ok(Math.hypot(s.dx, s.dy) < 1.5, JSON.stringify(s));
  });
});
