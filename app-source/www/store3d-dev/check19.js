'use strict';
// בדיקת דפדפן לשלב 19ג (הליכה אמיתית) ו-19ד (מדידה והגנת ביצועים). דף הבדיקה: slots.html (תמונות נוצרות בקוד, לא באפליקציה).
// הרצה: node app-source/www/store3d-dev/check19.js [תוצאות.json]   (דורש playwright + Chromium)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, ''), f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const R = { checks: [], perf: {} }, errors = [];
  const check = (name, ok, ev) => { R.checks.push({ name, ok: !!ok, ev }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' – ' + (typeof ev === 'string' ? ev : JSON.stringify(ev))); };
  const open = async (qs, dsf, throttle) => { const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: dsf || 1, hasTouch: false, locale: 'he-IL' });
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
    if (throttle) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
    await page.goto(base + '/store3d-dev/slots.html' + qs, { waitUntil: 'load' }); await page.waitForFunction(() => window.__h, null, { timeout: 60000 }); await sleep(800); return page; };
  const st = (page) => page.evaluate(() => window.__h.stats());
  const pos = async (page) => (await st(page)).walk;
  const fixed = (page) => page.evaluate(() => { const M = window.__model, s = window.__h.stats().walk, r = S3G.resolveCircle(s[0] * 100, s[1] * 100, 25, M.segs); return Math.hypot(r[0] - s[0] * 100, r[1] - s[1] * 100) < 2; });

  /* 1. הליכה אל קיר ואל מדף: 3 שניות עם חץ למעלה לא עוברות דרכם */
  let page = await open('?mode=walk');
  const G = await page.evaluate(() => { const M = window.__model, b = M.bays.filter((o) => o.lv.length > 1)[0], out = { b: { id: b.id, x: b.x, y: b.y, nx: b.nx, ny: b.ny }, near: null };
    for (const sg of [1, -1]) for (const d of [150, 120, 90]) { const x = b.x + sg * b.nx * d, y = b.y + sg * b.ny * d; if (!out.near && S3G.inAnyRoom(M, x, y)) { out.near = [x, y]; out.sg = sg; } }
    return out; });
  await page.evaluate(([x, y]) => window.__h.walkTo(x, y), G.near); await sleep(2500);
  /* פונים אל המדף (מנסים לחצות אותו) וצועדים 3 שניות */
  const tx = G.b.x - G.sg * G.b.nx * 400, ty = G.b.y - G.sg * G.b.ny * 400;
  await page.evaluate(([x, y]) => window.__h.walkTo(x, y), [tx, ty]); await sleep(2500);
  const p0 = await pos(page); await page.keyboard.down('ArrowUp'); await sleep(3000); await page.keyboard.up('ArrowUp'); await sleep(300);
  const p1 = await pos(page), side = (p) => (p[0] * 100 - G.b.x) * G.b.nx * G.sg + (p[1] * 100 - G.b.y) * G.b.ny * G.sg;
  check('הליכה 3 שניות אל מדף: נשארים בצד המקורי ולא חודרים (מרחק ≥ רדיוס)', side(p1) > 0 && await fixed(page), { p0, p1, side0: +side(p0).toFixed(1), side1: +side(p1).toFixed(1) });
  /* קיר: מטרה רחוקה מעבר לקיר השמאלי */
  await page.evaluate(() => window.__h.walkTo(-500, window.__h.stats().walk[1] * 100)); await sleep(4000);
  await page.keyboard.down('ArrowUp'); await sleep(3000); await page.keyboard.up('ArrowUp'); await sleep(300);
  const pw = await pos(page);
  check('הליכה 3 שניות אל קיר: לא עוברים אותו', pw[0] * 100 >= 20 && await fixed(page), { pw });
  await page.close();

  /* 2. האצה ובלימה בפתח פתוח (מעבר ארוך), ג'ויסטיק */
  page = await open('?mode=walk&n=12');
  const jv = await page.evaluate(() => { const j = document.querySelector('.s3d-joy'), r = j.getBoundingClientRect(), cs = getComputedStyle(j);
    return { w: r.width, h: r.height, left: r.left, bottom: innerHeight - r.bottom, disp: cs.display, label: j.textContent, aria: j.getAttribute('aria-label') }; });
  check("ג'ויסטיק בהליכה: מוצג, ≥44px, שמאל-למטה, תווית בעברית", jv.disp === 'block' && jv.w >= 44 && jv.h >= 44 && jv.left < 40 && jv.bottom < 200 && /[א-ת]/.test(jv.label), jv);
  /* מקום פנוי: קרוב למרכז החדר הראשי, פונים לכיוון הארוך */
  const free = await page.evaluate(() => { const M = window.__model, b = M.bounds; return [(b[0] + b[2]) / 2, b[3] - 60]; });
  await page.evaluate(([x, y]) => window.__h.walkTo(x, y), free); await sleep(3500);
  await page.evaluate(([x, y]) => window.__h.walkTo(x, y), [free[0] - 600, free[1]]); await sleep(1500);
  const jc = await page.evaluate(() => { const r = document.querySelector('.s3d-joy').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const a0 = await pos(page);
  await page.mouse.move(jc[0], jc[1]); await page.mouse.down(); await page.mouse.move(jc[0], jc[1] - 40, { steps: 4 });
  await sleep(250); const a1 = await pos(page); await sleep(1500); const a2 = await pos(page); await sleep(500); const a3 = await pos(page);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const v = d(a2, a3) / .5;
  await page.mouse.up(); await sleep(60); const b0 = await pos(page); await sleep(700); const b1 = await pos(page);
  check("ג'ויסטיק: התחלה איטית (האצה), אחר כך ~1.3 מ'/ש'", d(a0, a1) < .45 && v > .9 && v < 1.45, { early: +d(a0, a1).toFixed(2), speed: +v.toFixed(2) });
  check('שחרור: בלימה (עוצר תוך ~0.5 מ\') ואז נשאר במקום', d(b0, b1) < .5 && d(b1, await pos(page)) < .01, { brake: +d(b0, b1).toFixed(2) });
  /* גרירה בקנבס כמו היום: מסתכלת וגם מזיזה קדימה */
  const c0 = await pos(page), y0 = (await st(page)).cam;
  await page.mouse.move(200, 300); await page.mouse.down(); await page.mouse.move(150, 260, { steps: 6 }); await page.mouse.up(); await sleep(300);
  const c1 = await pos(page);
  check('גרירה בהליכה נשארת כמו היום (מזיזה את המיקום)', d(c0, c1) > .01, { c0, c1 });
  /* 3. מעבר מעופף 900ms, בשני הכיוונים, בלי קפיצה */
  const samples = async (m) => { const out = []; const t0 = Date.now(); await page.evaluate((m) => window.__h.setMode(m), m);
    while (Date.now() - t0 < 1500) { out.push([Date.now() - t0, (await st(page)).cam]); await sleep(40); } return out; };
  const walkCam = (await st(page)).cam;
  const dn = await samples('top'); const topCam = dn[dn.length - 1][1];
  const maxStep = (a) => a.slice(1).reduce((m, s, i) => Math.max(m, Math.hypot(...s[1].map((v, k) => v - a[i][1][k]))), 0);
  const mid = dn.find((s) => s[0] > 400 && s[0] < 500);
  check('מעבר לעליון: רציף (בלי קפיצה), מסתיים אחרי ~900ms', mid && d3(mid[1], walkCam) > .3 && d3(mid[1], topCam) > .3 && maxStep(dn) < .45 * d3(walkCam, topCam) + 1, { walkCam, topCam, mid: mid && mid[1], maxStep: +maxStep(dn).toFixed(2) });
  const up = await samples('walk');
  check('מעבר חזרה לגובה העיניים: רציף ומגיע לגובה 1.6', Math.abs(up[up.length - 1][1][1] - 1.6) < .02 && maxStep(up) < .45 * d3(walkCam, topCam) + 1, { end: up[up.length - 1][1], maxStep: +maxStep(up).toFixed(2) });
  function d3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  const hid = await (async () => { await page.evaluate(() => window.__h.setMode('top', true)); await sleep(200); return page.evaluate(() => getComputedStyle(document.querySelector('.s3d-joy')).display); })();
  check("ג'ויסטיק מוסתר במבט עליון", hid === 'none', hid);
  await page.close();

  /* 4. מדידה (19ד): מפה עם ~100 מקטעים, האטת מעבד פי 4 */
  page = await open('?mode=walk&n=26', 1, 4);
  const nb = await page.evaluate(() => window.__model.bays.length);
  await page.evaluate(([x, y]) => window.__h.walkTo(x, y), [300, 300]); await sleep(3000);
  await page.keyboard.down('ArrowRight'); await sleep(6000); const sm = await st(page); await page.keyboard.up('ArrowRight'); await sleep(300);
  R.perf.throttle4 = { bays: nb, fps: sm.fps, calls: sm.calls, tris: sm.tris, textures: sm.textures, geometries: sm.geometries, gpuMB: sm.gpuMB, downloaded: sm.downloaded, slots: sm.slots, dprDrop: sm.dprDrop, px: sm.px, buildMs: sm.buildMs };
  check('מפת ~100 מקטעים: stats מדווח fps, טקסטורות, MB שהורדו והערכת זיכרון גרפי', nb >= 90 && nb <= 130 && sm.fps > 0 && sm.textures > 0 && sm.downloaded.files > 0 && sm.gpuMB > 0, R.perf.throttle4);
  await page.close();
  /* הגנת dpr: מסך 2x והאטה פי 8 */
  page = await open('?mode=walk&n=60', 2, 25);
  await page.keyboard.down('ArrowRight'); await sleep(9000); const sg = await st(page); await page.keyboard.up('ArrowRight');
  R.perf.guard = { px: sg.px, dprDrop: sg.dprDrop, fps: sg.fps };
  check('FPS נמוך (<28) 2 שניות על מסך 2x: יורדים ל-dpr 1', sg.fps >= 28 || (sg.dprDrop && sg.px === 1), R.perf.guard);
  await page.close();

  check('אין שגיאות JavaScript', errors.length === 0, errors);
  await browser.close(); srv.close();
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(R, null, 1));
  process.exit(R.checks.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
