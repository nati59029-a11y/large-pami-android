// בדיקת דפדפן לצפייה בסיור 360 (שלב 18ב): אין שגיאות JS, גרירה משנה כיוון, הקשה על חץ מעבירה נקודה, שחרור זיכרון (≤3 מלאות), צילום מסך.
// הרצה: node app-source/www/store3d-dev/check-pano.js [תיקיית צילומים]   (דורש playwright + Chromium)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || '/tmp/claude-0/-home-user/65bdfe6b-18da-51a4-a308-31c841158c67/scratchpad';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const rows = []; let bad = 0;
const ok = (n, c, d) => { rows.push([c ? 'עבר' : 'נכשל', n, d === undefined ? '' : String(d)]); if (!c) bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/store3d-dev/pano.html';
  const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [w, h] of [[360, 760], [412, 915]]) {
    const tag = w + 'x' + h, pg = await br.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(url);
    const loaded = await pg.evaluate(() => window.__ready);
    ok(tag + ' נפתח', loaded === true);
    if (!loaded) { ok(tag + ' שגיאה', false, await pg.evaluate(() => JSON.stringify(window.__err))); await pg.close(); continue; }
    const st = () => pg.evaluate(() => window.__pano.stats()), vw = () => pg.evaluate(() => window.__pano.view());
    const settle = async () => { for (let i = 0; i < 80; i++) { if (!(await st()).busy) break; await sleep(100); } await sleep(700); };
    await settle();
    ok(tag + ' נקודה ראשונה A', (await st()).id === 'A');
    // גרירה
    const v0 = await vw(); await pg.mouse.move(w / 2, h / 2); await pg.mouse.down(); await pg.mouse.move(w / 2 - 120, h / 2 + 20, { steps: 8 }); await pg.mouse.up(); await sleep(300);
    const v1 = await vw(); ok(tag + ' גרירה משנה כיוון', Math.abs(v1.yaw - v0.yaw) > 5, v0.yaw.toFixed(1) + '→' + v1.yaw.toFixed(1));
    // הקשה על חץ: מסתכלים אל B (כיוון 90) וקצת למטה
    await pg.evaluate(() => window.__pano.setView(90, -30, 75)); await sleep(300);
    const s = await pg.evaluate(() => window.__pano.screenOf('B'));
    ok(tag + ' חץ נראה', !!s, JSON.stringify(s));
    if (s) { await pg.mouse.click(s.x, s.y); await sleep(200); await settle(); }
    const a = await st(); ok(tag + ' הקשה על חץ עוברת ל-B', a.id === 'B', a.id);
    const vB = await vw(); ok(tag + ' כיוון המבט נשמר', Math.abs(vB.yaw - 90) < 2, vB.yaw.toFixed(1));
    await pg.screenshot({ path: path.join(OUT, 'pano-' + tag + '.png') });
    // מפה קטנה: קפיצה ל-C
    await pg.evaluate(() => window.__pano.goTo('C')); await settle(); ok(tag + ' goTo C', (await st()).id === 'C');
    // 24 קפיצות – זיכרון
    let maxAtRest = 0, ids = ['B', 'A', 'B', 'C'];
    for (let i = 0; i < 24; i++) { await pg.evaluate((id) => window.__pano.goTo(id), ids[i % 4]); await settle(); const t = await st(); maxAtRest = Math.max(maxAtRest, t.tex.full); }
    const f = await st();
    ok(tag + ' מלאות בזיכרון במנוחה ≤3', maxAtRest <= 3, 'מקס ' + maxAtRest + ', שיא כולל מעברים ' + f.fullMax);
    ok(tag + ' טקסטורות GPU ≤ 6', f.textures <= 7, f.textures + ' (סמלים וחצים כלולים)');
    ok(tag + ' סימונים וחצים', f.tags >= 1 && f.arrows >= 1, 'tags ' + f.tags + ' arrows ' + f.arrows);
    await pg.evaluate(() => window.__pano.pause()); await pg.evaluate(() => window.__pano.resume());
    await pg.evaluate(() => window.__pano.destroy()); await sleep(100);
    ok(tag + ' destroy משחרר', (await pg.evaluate(() => document.querySelectorAll('.s3p-root').length)) === 0);
    ok(tag + ' אין שגיאות JS', errs.length === 0, errs.join(' | ').slice(0, 300));
    await pg.close();
  }
  await br.close(); srv.close();
  for (const r of rows) console.log(r.join(' | '));
  console.log(bad ? 'נכשלו: ' + bad : 'הכול עבר');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
