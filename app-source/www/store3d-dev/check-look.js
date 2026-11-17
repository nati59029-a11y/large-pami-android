'use strict';
// בדיקת דפדפן לשלב 6 (הקמת חנות): תמונות לדגם מ-s3look, בחירת החזית החדשה, וזיכרון GPU. דף הבדיקה: look.html (תמונות נוצרות בקוד).
// הרצה: node app-source/www/store3d-dev/check-look.js [תמונה.png]   (דורש playwright + Chromium, ו-git לגרסת הבסיס להשוואה)
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const BASE = process.env.LOOK_BASE_VIEW ? fs.readFileSync(process.env.LOOK_BASE_VIEW, 'utf8') : cp.execSync('git show HEAD:app-source/www/store3d-view.js', { cwd: ROOT, maxBuffer: 1e8 }).toString();
const srv = http.createServer((req, res) => {
  const u = req.url.split('?'), p = path.normalize(decodeURIComponent(u[0])).replace(/^(\.\.[/\\])+/, ''), f = path.join(ROOT, p);
  if (/store3d-view\.js$/.test(p) && /orig=1/.test(u[1] || '')) { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end(BASE); }
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (n, ok, ev) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + ' – ' + JSON.stringify(ev)); };
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const open = async (qs, w) => {
    const ctx = await browser.newContext({ viewport: { width: w || 360, height: 640 }, locale: 'he-IL' }), page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
    if (/orig=1/.test(qs)) await page.route('**/store3d-view.js*', (r) => r.fulfill({ status: 200, contentType: TYPES['.js'], body: BASE }));
    await page.goto(base + '/store3d-dev/look.html' + qs, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__h, null, { timeout: 60000 }); await page.waitForFunction(() => { const s = window.__h.stats(); return s.photos.ok + s.photos.fail >= s.photos.want && (!s.look || s.look.ok + s.look.fail >= s.look.want); }, null, { timeout: 60000 }); await sleep(500);
    await page.evaluate(() => window.__h.renderNow()); return page;
  };
  const shot = async (page) => { await page.evaluate(() => window.__h.renderNow()); return (await page.screenshot()); };
  const st = (page) => page.evaluate(() => window.__h.stats());
  /* 1. בלי s3look: זהה בדיוק לגרסה הקודמת (השוואת צילום מסך), ואין שינוי בטעינות */
  const a = await open('?look=0&orig=1'), b = await open('?look=0');
  const sa = await shot(a), sb = await shot(b);
  check('בלי s3look: צילום זהה לקוד הקודם (בית)', Buffer.compare(sa, sb) === 0, { bytes: sa.length });
  const stb = await st(b); check('בלי s3look: אין אטלסים ואין טעינות', stb.look.atlases === 0 && stb.look.want === 0, stb.look);
  /* 2. עם s3look: תמונה לכל פריט */
  const c = await open('');
  const n = await c.evaluate(() => Object.keys(window.__look.it).length), stc = await st(c);
  check('עם s3look: כל הפריטים נטענו', stc.look.want === n && stc.look.ok === n && stc.look.fail === 0, { n, look: stc.look });
  const sc = await shot(c); check('עם s3look: הצילום שונה מהבסיס', Buffer.compare(sa, sc) !== 0, {});
  check('זיכרון GPU ≤150MB', stc.gpuMB <= 150, { gpuMB: stc.gpuMB });
  fs.writeFileSync(process.argv[2] || path.join(require('os').tmpdir(), 'look-360.png'), sc);
  /* מבט הליכה: אותה תוצאה בלי שגיאה */
  const w = await open('?mode=walk'); const sw = await st(w); check('הליכה: נטען', sw.look.ok === sw.look.want && sw.look.want > 0, sw.look);
  /* 3. setLook(null) חוזר לדגם הקודם; setLook(look) חוזר לתמונות */
  await c.evaluate(() => window.__h.setLook(null)); await sleep(300);
  const sc0 = await shot(c), st0 = await st(c); check('setLook(null): חוזר לצילום הבסיס', Buffer.compare(sa, sc0) === 0 && st0.look.atlases === 0, st0.look);
  await c.evaluate(() => window.__h.setLook(window.__look)); await c.waitForFunction(() => { const s = window.__h.stats(); return s.look.ok + s.look.fail >= s.look.want; }); const st1 = await st(c);
  check('setLook(look): תמונות חזרו', st1.look.ok === n, st1.look);
  /* 4. חזית: החדשה מבין הסבב וההקמה */
  const fn = await open('?fr=new'), fo = await open('?fr=old');
  const ln = await fn.evaluate(() => window.__loads.filter((p) => /f1-a-1_/.test(p))), lo = await fo.evaluate(() => window.__loads.filter((p) => /f1-a-1_/.test(p)));
  check('חזית הקמה חדשה מהסבב: נטענת החזית', ln.length === 1 && /front\//.test(ln[0]), ln);
  check('חזית הקמה ישנה מהסבב: נטען הסבב', lo.length === 1 && /run\//.test(lo[0]), lo);
  check('בלי שגיאות JS', errors.length === 0, errors.slice(0, 3));
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
