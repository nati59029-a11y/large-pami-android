'use strict';
// בדיקות יחידה לחלק המתמטי של store3d-pano-cap.js (צילום 360 בטלפון, שלב 18ו). בלי דפדפן.
// הרצה: node --test app-source/www/store3d-dev/pano-cap.test.js
// הסצנה כאן סינתטית (נוצרת בקוד), לא צילום אמיתי.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../store3d-pano-cap.js')._m;

const near = (a, b, e = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= e, `${msg} ${a} != ${b} (±${e})`);
const D = Math.PI / 180;

/* סצנה סינתטית ידועה על הכדור: צבעים חלקים + קווי רשת ברוחב 2.4° כל 15° (כדי שיהיה מה ליישר) */
function scene(d) {
  const [x, y, z] = d, lon = Math.atan2(x, y) / D, lat = Math.asin(Math.max(-1, Math.min(1, z))) / D;
  let r = 128 + 60 * Math.sin(4 * x + 1.3 * y) + 35 * Math.sin(9 * z + 2 * x);
  let g = 128 + 60 * Math.sin(5 * y - 2 * z) + 30 * Math.cos(7 * x + 3 * z);
  let b = 128 + 55 * Math.cos(3 * z + 4 * y) + 30 * Math.sin(11 * y + 5 * x);
  const fl = (v) => { const t = ((v % 15) + 15) % 15; return Math.min(t, 15 - t); };
  if (fl(lon) * Math.cos(lat * D) < 1.2 || fl(lat) < 1.2) { r *= 0.35; g *= 0.35; b *= 0.35; }
  return [r, g, b];
}
/* "מצלמה" סינתטית: פריים לפי כיוון q ושדה ראייה */
function render(q, fovL, w, h, gain = 1) {
  const m = M.qToMat(q), f = M.fovOf(fovL, w, h).f, data = new Uint8ClampedArray(w * h * 4);
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    const cx = (u + 0.5 - w / 2) / f, cy = -(v + 0.5 - h / 2) / f;
    const dx = m[0] * cx + m[1] * cy - m[2], dy = m[3] * cx + m[4] * cy - m[5], dz = m[6] * cx + m[7] * cy - m[8], n = Math.hypot(dx, dy, dz);
    const c = scene([dx / n, dy / n, dz / n]), i = (v * w + u) * 4;
    data[i] = c[0] * gain; data[i + 1] = c[1] * gain; data[i + 2] = c[2] * gain; data[i + 3] = 255;
  }
  return data;
}
/* כיוון טלפון אנכי (portrait) שמסתכל ל-yaw/pitch, עם הטיה צדדית */
const qLook = (yaw, pitch, roll = 0) => M.oriToQuat(-yaw, 90 + pitch, roll, 0);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function capture(fovL, w, h, opt = {}) {
  const fv = M.fovOf(fovL, w, h), T = M.pickTargets(fv.fw, fv.fh), y0 = opt.y0 || 0;
  return T.map((t) => {
    const n = opt.noise || 0, q = qLook(t.yaw + y0 + (rnd() - 0.5) * 2 * n, t.pitch + (rnd() - 0.5) * 2 * n, (rnd() - 0.5) * 2 * (opt.roll || 0));
    const gain = opt.gain ? 1 + (rnd() - 0.5) * 2 * opt.gain : 1;
    return { data: render(q, fovL, w, h, gain), w, h, q, gain };
  });
}
function stitch(frames, fovL, W) {
  const H = W / 2, yawRef = M.yawPitch(frames[0].q).yaw, P = M.makePano(W, H, yawRef);
  for (const fr of frames) P.add(Object.assign({}, fr, { fovL }));
  const holes = P.fill();
  return { P, W, H, yawRef, holes };
}
/* שגיאה ממוצעת מול הסצנה (רמות 0–255), בפס |lat|<=latMax */
function err(S, latMax = 90, scale = 1) {
  let e = 0, n = 0;
  for (let y = 0; y < S.H; y += 2) {
    const lat = (0.5 - (y + 0.5) / S.H) * 180; if (Math.abs(lat) > latMax) continue;
    for (let x = 0; x < S.W; x += 2) {
      const c = scene(M.eqDir(x, y, S.W, S.H, S.yawRef)), i = (y * S.W + x) * 4;
      e += Math.abs(S.P.col[i] - c[0] * scale) + Math.abs(S.P.col[i + 1] - c[1] * scale) + Math.abs(S.P.col[i + 2] - c[2] * scale); n += 3;
    }
  }
  return e / n;
}

describe('כיוון ⇒ קווטרניון', () => {
  it('טלפון אנכי, alpha=0: מסתכל צפונה, ימין המסך = מזרח', () => {
    const q = M.oriToQuat(0, 90, 0, 0), m = M.qToMat(q), f = M.camFwd(q);
    near(f[0], 0); near(f[1], 1); near(f[2], 0);
    near(m[0], 1); near(m[3], 0); near(m[6], 0); // ימין המצלמה
    near(m[7], 1); // למעלה במצלמה = למעלה בעולם
  });
  it('alpha חיובי = סיבוב שמאלה (yaw יורד); beta מעל 90 = הטיה למעלה', () => {
    near(M.yawPitch(M.oriToQuat(-90, 90, 0, 0)).yaw, 90, 1e-6);
    near(M.yawPitch(M.oriToQuat(30, 90, 0, 0)).yaw, -30, 1e-6);
    near(M.yawPitch(M.oriToQuat(0, 135, 0, 0)).pitch, 45, 1e-6);
    near(M.yawPitch(M.oriToQuat(0, 60, 0, 0)).pitch, -30, 1e-6);
  });
  it('מסך לרוחב (angle=90): ימין המצלמה = y- של המכשיר, למעלה = x+ של המכשיר', () => {
    for (const [a, b, g] of [[10, 20, 30], [-70, 95, -40], [200, -30, 80]]) {
      const md = M.qToMat(M.oriToQuat(a, b, g, 0)), ms = M.qToMat(M.oriToQuat(a, b, g, 90));
      for (let r = 0; r < 3; r++) { near(ms[r * 3], -md[r * 3 + 1], 1e-9); near(ms[r * 3 + 1], md[r * 3], 1e-9); near(ms[r * 3 + 2], md[r * 3 + 2], 1e-9); }
    }
  });
  it('קווטרניון מנורמל וזווית בין כיוונים', () => {
    const q = M.oriToQuat(33, 77, -12, 0); near(Math.hypot(...q), 1, 1e-12);
    near(M.qAngle(qLook(0, 0), qLook(10, 0)), 10, 1e-6);
  });
});

describe('נקודות יעד והקרנה', () => {
  it('שורות לפי שדה הראייה, כולל זנית ונדיר, וכיסוי מלא של הכדור', () => {
    const w = 300, h = 400, fv = M.fovOf(65, w, h), T = M.pickTargets(fv.fw, fv.fh);
    assert.ok(T.length >= 20 && T.length <= 40, 'מספר נקודות ' + T.length);
    assert.equal(T.filter((t) => t.pitch === 90).length, 1); assert.equal(T.filter((t) => t.pitch === -90).length, 1);
    assert.equal(T[0].yaw, 0); assert.equal(T[0].pitch, 0);
    for (const [fl, ww, hh] of [[65, w, h], [50, 300, 400], [58, 300, 400], [62.3, 360, 480], [72, 300, 400], [65, 270, 480]]) {
      const v = M.fovOf(fl, ww, hh), TT = M.pickTargets(v.fw, v.fh), mats = TT.map((t) => M.qToMat(qLook(t.yaw, t.pitch)));
      let miss = 0;
      for (let i = 0; i < 4000; i++) {
        const z = rnd() * 2 - 1, a = rnd() * 2 * Math.PI, r = Math.sqrt(1 - z * z), d = [r * Math.sin(a), r * Math.cos(a), z];
        // כיסוי עם שוליים: כל כיוון נמצא בתוך 90% המרכזיים של פריים כלשהו
        if (!mats.some((m) => { const p = M.projToFrame(m, d, v.f, ww / 2, hh / 2); return p && Math.abs(p[0] - ww / 2) < ww * 0.45 && Math.abs(p[1] - hh / 2) < hh * 0.45; })) miss++;
      }
      assert.equal(miss, 0, `שדה ראייה ${fl}° (${TT.length} נקודות): כיוונים בלי כיסוי ${miss}`);
    }
  });
  it('שדה ראייה צר = יותר נקודות', () => {
    const a = M.pickTargets(40, 52).length, b = M.pickTargets(60, 75).length;
    assert.ok(a > b, a + ' > ' + b);
  });
  it('equirect ⇒ פריים: מרכז התמונה נופל במרכז הפריים, וימין בתמונה = ימין בפריים', () => {
    const fr = { w: 300, h: 400, fovL: 65 }, q = qLook(40, 0);
    const c = M.eqToFrame(511.5, 255.5, 1024, 512, 40, q, fr); near(c[0], 150, 0.01); near(c[1], 200, 0.01);
    const r = M.eqToFrame(560, 255.5, 1024, 512, 40, q, fr); assert.ok(r[0] > 150);
    const u = M.eqToFrame(511.5, 230, 1024, 512, 40, q, fr); assert.ok(u[1] < 200);
    assert.equal(M.eqToFrame(0, 255.5, 1024, 512, 40, q, fr), null); // מאחור
  });
});

describe('סיבוב סינתטי: צילום מכיוונים ידועים וחיבור חזרה', () => {
  const w = 240, h = 320, fovL = 65, W = 512;
  it('בלי רעש: שגיאה ממוצעת נמוכה מאוד', () => {
    const S = stitch(capture(fovL, w, h, { roll: 6, y0: 37 }), fovL, W), e = err(S);
    assert.equal(S.holes, 0, 'חורים ' + S.holes);
    assert.ok(e < 4, 'שגיאה ממוצעת ' + e.toFixed(2));
  });
  it('בהירות שונה בין פריימים (±12%): תיקון הבהירות שומר על שגיאה נמוכה', () => {
    const fr = capture(fovL, w, h, { gain: 0.12 }), S = stitch(fr, fovL, W), e = err(S, 90, fr[0].gain);
    assert.ok(e < 5, 'שגיאה עם תיקון ' + e.toFixed(2));
  });
  it('רעש כיוון של ±0.4° (כמו חיישן אמיתי): עדיין סביר', () => {
    const S = stitch(capture(fovL, w, h, { noise: 0.4 }), fovL, W), e = err(S);
    assert.ok(e < 6, 'שגיאה עם רעש ' + e.toFixed(2));
  });
  it('כיול שדה ראייה מהחפיפה מוצא את הערך האמיתי', () => {
    const fr = capture(58, w, h, {}), small = fr.map((f) => ({ data: f.data, w: f.w, h: f.h, q: f.q }));
    const r = M.estFov(small, 65, M.yawPitch(fr[0].q).yaw);
    assert.ok(r && Math.abs(r.fovL - 58) <= 1.5, 'נמצא ' + (r && r.fovL));
    assert.ok(r.score < r.base * 0.92);
  });
  it('צילום חלקי (רק שורת האופק): חורים מתמלאים בצבע ממוצע, בלי שחור', () => {
    const fr = capture(fovL, w, h, {}).filter((_, i) => i < 10), S = stitch(fr, fovL, W);
    assert.ok(S.holes > 0);
    let black = 0; for (let i = 0; i < S.W * S.H; i++) if (S.P.col[i * 4] + S.P.col[i * 4 + 1] + S.P.col[i * 4 + 2] < 3) black++;
    assert.equal(black, 0); assert.ok(err(S, 20) < 6);
  });
});

describe('מצב סרטון', () => {
  it('slerp: קצוות, אמצע וזווית יחסית; גם כשהסימן הפוך', () => {
    const a = qLook(0, 0), b = qLook(40, 10);
    near(M.qAngle(M.qSlerp(a, b, 0), a), 0, 1e-4); near(M.qAngle(M.qSlerp(a, b, 1), b), 0, 1e-4);
    const m = M.qSlerp(a, b, 0.25), full = M.qAngle(a, b);
    near(M.qAngle(a, m), full * 0.25, 1e-6); near(M.qAngle(m, b), full * 0.75, 1e-6); near(Math.hypot(...m), 1, 1e-9);
    const nb = b.map((v) => -v), m2 = M.qSlerp(a, nb, 0.5); near(M.qAngle(m2, M.qSlerp(a, b, 0.5)), 0, 1e-4);
    near(M.qAngle(M.qSlerp(a, qLook(0.01, 0), 0.5), qLook(0.005, 0)), 0, 1e-4); // כמעט זהים: בלי חלוקה באפס
  });
  it('כיוון ברגע הפריים: אינטרפולציה בין שני ערכי חיישן, ואחרת האחרון', () => {
    const h = [{ t: 100, q: qLook(0, 0) }, { t: 120, q: qLook(2, 0) }, { t: 140, q: qLook(4, 0) }];
    near(M.yawPitch(M.oriAt(h, 130)).yaw, 3, 1e-3);
    near(M.yawPitch(M.oriAt(h, 125)).yaw, 2.5, 1e-3);
    near(M.yawPitch(M.oriAt(h, 300)).yaw, 4, 1e-9); // אחרי הערך האחרון – האחרון
    near(M.yawPitch(M.oriAt(h, 50)).yaw, 0, 1e-9);
    assert.equal(M.oriAt([], 10), null);
  });
  it('סף מהירות: 30°/ש\' עובר, 100°/ש\' נחסם', () => {
    const mk = (sp) => Array.from({ length: 20 }, (_, i) => ({ t: i * 16, q: qLook(sp * i * 0.016, 0) }));
    const s1 = M.angSpeed(mk(30), 400), s2 = M.angSpeed(mk(100), 400);
    near(s1, 30, 1); near(s2, 100, 2);
    assert.ok(s1 < M.C.VID_SPD && s2 > M.C.VID_SPD);
    assert.equal(M.angSpeed([{ t: 0, q: qLook(0, 0) }], 10), 0); // ערך אחד – אין מהירות
  });
  it('ציון חדות: פריים חד מקבל יותר מאותו פריים מטושטש', () => {
    const w = 160, h = 120, d = render(qLook(10, 5), 65, w, h), bl = new Uint8ClampedArray(d.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) { // טשטוש תנועה אופקי (9 פיקסלים)
      let s = 0, n = 0; for (let k = -4; k <= 4; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += d[(y * w + xx) * 4 + c]; n++; } } bl[(y * w + x) * 4 + c] = s / n;
    }
    const a = M.lapVar(d, w, h), b = M.lapVar(bl, w, h);
    assert.ok(a > b * 2, `חד ${a.toFixed(1)} מול מטושטש ${b.toFixed(1)}`);
  });
  it('בחירת הפריים הטוב לכל נקודה: רק בתוך מחצית המרווח, ושומרים את החד/הקרוב ביותר', () => {
    const fv = M.fovOf(62, 360, 480), T = M.pickTargets(fv.fw, fv.fh), R = M.vidRadii(T), TD = T.map((t) => M.dirOf(t.yaw, t.pitch));
    const sp = 360 / T.filter((t) => t.row === 0).length;
    near(R[0], sp / 2, 1e-6, 'רדיוס בשורת האופק = מחצית המרווח');
    assert.ok(R.every((r) => r > 5 && r < 46));
    const best = T.map(() => null), offer = (yaw, pitch, sharp) => {
      const c = M.vidPick(M.camFwd(qLook(yaw, pitch)), TD, R, best, sharp);
      for (const x of c) best[x.i] = { s: x.s, yaw, sharp }; return c.map((x) => x.i);
    };
    assert.deepEqual(offer(0, 0, 100), [0]);
    assert.deepEqual(offer(2, 0, 50), [], 'פחות חד – לא מחליף');
    assert.deepEqual(offer(1, 0, 300), [0], 'חד יותר – מחליף'); assert.equal(best[0].sharp, 300);
    assert.deepEqual(offer(sp / 2 + 0.5, 0, 1e6).includes(0), false, 'מחוץ למחצית המרווח – לא נחשב לנקודה 0');
    const c = M.vidPick(M.camFwd(qLook(R[0] * 0.9, 0)), TD, R, T.map(() => null), 300)[0], c0 = M.vidPick(M.camFwd(qLook(0, 0)), TD, R, T.map(() => null), 300)[0];
    assert.ok(c0.s > c.s, 'באותה חדות – הקרוב למרכז עדיף');
    // רדיוסים לא חופפים: כיוון אחד שייך לכל היותר לשתי נקודות
    for (let i = 0; i < 2000; i++) { const z = rnd() * 2 - 1, a = rnd() * 2 * Math.PI, r = Math.sqrt(1 - z * z), d = [r * Math.sin(a), r * Math.cos(a), z];
      assert.ok(TD.filter((t, j) => M.angDir(d, t) < R[j]).length <= 2); }
  });
  it('סיבוב רציף מדומה (שלוש שורות + תקרה ורצפה, רעש קטן): בחירה אוטומטית וחיבור עם שגיאה דומה למצב הנקודות', () => {
    const w = 120, h = 160, fovL = 62, fv = M.fovOf(fovL, w, h), T = M.pickTargets(fv.fw, fv.fh), R = M.vidRadii(T), TD = T.map((t) => M.dirOf(t.yaw, t.pitch)), best = T.map(() => null);
    const rows = [...new Set(T.map((t) => t.pitch))];
    let n = 0;
    for (const p of rows) { // 40°/ש', דגימה כל 120ms ⇒ 4.8° בין דגימות
      const len = Math.abs(p) > 89 ? 1 : 380;
      for (let a = 0; a <= len; a += 4.8) {
        const q = qLook(a + (rnd() - 0.5) * 0.6, p + 1.5 * Math.sin(a * D * 3) + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 2);
        const sharp = 100 + rnd() * 20; n++;
        for (const x of M.vidPick(M.camFwd(q), TD, R, best, sharp)) best[x.i] = { s: x.s, q };
      }
    }
    assert.ok(best.every(Boolean), 'כיסוי מלא');
    const frames = [...new Set(best)].map((b) => ({ data: render(b.q, fovL, w, h), w, h, q: b.q }));
    assert.ok(frames.length <= T.length && n > frames.length * 5, 'נשמר רק פריים לכל נקודה');
    const S = stitch(frames, fovL, 512), e = err(S);
    assert.ok(e < 6, 'שגיאה ' + e.toFixed(2));
  });
});
