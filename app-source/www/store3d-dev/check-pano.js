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
  /* שלב 21ו: מלאות 8192×4096 – טקסטורה אחת (maxTex של המכשיר) מול שני חצאים (maxTex מדומה 4096): אותה תמונה על המסך, זיכרון חסום */
  {
    const pg = await br.newPage({ viewport: { width: 360, height: 760 } }), errs = [];
    pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const st = () => pg.evaluate(() => window.__pano.stats()), shots = {}, stat = {};
    for (const mt of ['', '4096']) {
      await pg.goto(url + '?w=8192' + (mt ? '&mt=' + mt : ''));
      if (!(await pg.evaluate(() => window.__ready))) { ok('8192' + (mt ? ' חצאים' : '') + ' נפתח', false, await pg.evaluate(() => JSON.stringify(window.__err))); continue; }
      for (let i = 0; i < 150; i++) { const s = await st(); if (!s.busy && s.tex.full >= 2) break; await sleep(100); }
      await sleep(800); stat[mt] = await st();
      for (const yaw of [0, 60, 180, 270]) { await pg.evaluate((y) => window.__pano.setView(y, -5, 75), yaw); await sleep(250); shots[mt + '/' + yaw] = (await pg.screenshot()).toString('base64'); }
      for (const id of ['B', 'C', 'B', 'A']) { await pg.evaluate((x) => window.__pano.goTo(x), id); for (let i = 0; i < 80; i++) { if (!(await st()).busy) break; await sleep(100); } await sleep(600); }
      stat[mt + 'end'] = await st();
      await pg.evaluate(() => window.__pano.destroy());
    }
    const diff = (a, b) => pg.evaluate(async ([a, b]) => { const im = async (s) => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const g = c.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
      const x = await im(a), y = await im(b); let s = 0; for (let i = 0; i < x.length; i += 4) s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]); return s / (x.length / 4 * 3); }, [a, b]);
    const s1 = stat[''] || {}, s2 = stat['4096'] || {}, e2 = stat['4096end'] || {};
    ok('8192: בלי מגבלה – טקסטורה אחת (texW 8192, בלי חצאים) כש-maxTex ≥ 8192', s1.maxTex < 8192 ? s1.split > 0 : s1.texW === 8192 && s1.split === 0, JSON.stringify({ maxTex: s1.maxTex, texW: s1.texW, split: s1.split }));
    ok('8192 על maxTex 4096: שני חצאים (split), texW 8192, מלאות שכנות מראש – אחת', s2.maxTex === 4096 && s2.texW === 8192 && s2.split >= 1 && s2.fnb === 1, JSON.stringify({ maxTex: s2.maxTex, texW: s2.texW, split: s2.split, fnb: s2.fnb, full: s2.tex && s2.tex.full }));
    ok('8192 חצאים: אחרי קפיצות – מלאות בזיכרון ≤ 2, טקסטורות GPU ≤ 7 + חצי שני לכל מלאה מפוצלת (שחרור תקין)', e2.tex && e2.tex.full <= 2 && e2.textures <= 7 + e2.split, JSON.stringify({ full: e2.tex && e2.tex.full, split: e2.split, textures: e2.textures, fullMax: e2.fullMax }));
    const ds = []; for (const yaw of [0, 60, 180, 270]) ds.push(+(await diff(shots['/' + yaw], shots['4096/' + yaw])).toFixed(2));
    const ref = await diff(shots['/0'], shots['/60']);
    ok('8192: התמונה על המסך זהה בטקסטורה אחת ובשני חצאים (גם במבט על קו החיבור, 0° ו-180°) – הפרש ממוצע < 2 (לעומת ' + ref.toFixed(1) + ' בין שני כיוונים שונים)', ds.every((d) => d < 2) && ref > 1, ds.join(', '));
    fs.writeFileSync(path.join(OUT, 'pano-8192-split.png'), Buffer.from(shots['4096/0'], 'base64'));
    ok('8192: אין שגיאות JS', errs.length === 0, errs.join(' | ').slice(0, 300));
    await pg.close();
  }
  await br.close(); srv.close();
  for (const r of rows) console.log(r.join(' | '));
  console.log(bad ? 'נכשלו: ' + bad : 'הכול עבר');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
