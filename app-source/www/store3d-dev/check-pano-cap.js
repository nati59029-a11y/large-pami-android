'use strict';
// בדיקת דפדפן לשלב 18ו (צילום 360 בטלפון): צילום מדומה מלא ב-360x760 + מצבי שגיאה. הסצנה נוצרת בקוד דף הבדיקה (pano-cap.html), לא נכנסת לאפליקציה.
// הרצה: node app-source/www/store3d-dev/check-pano-cap.js [פלט.jpg] [צילום-מסך.png] [תוצאות.json]   (דורש playwright + Chromium)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const [outJpg, shot, outJson] = [process.argv[2] || 'pano-cap-out.jpg', process.argv[3] || 'pano-cap-360.png', process.argv[4]];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const srv = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 1, hasTouch: true, locale: 'he-IL', permissions: ['camera'] });
  const R = { checks: [] }, errors = [];
  const check = (name, ok, ev) => { R.checks.push({ name, ok: !!ok, ev }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' – ' + (typeof ev === 'string' ? ev : JSON.stringify(ev))); };
  const watch = (page) => { page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); };
  const open = async () => { const p = await ctx.newPage(); watch(p); await p.goto(base + '/store3d-dev/pano-cap.html', { waitUntil: 'load' }); await p.waitForFunction(() => window.__run && window.S3PanoCap); return p; };

  /* ---------- 1. צילום מדומה מלא ---------- */
  const page = await open();
  await page.evaluate(() => { window.__done = window.__run({ b64: true }).then((r) => (window.__res = r || 'null'), (e) => (window.__res = 'err:' + e.message)); });
  await page.waitForSelector('.s3pc', { timeout: 10000 });
  await page.waitForFunction(() => { const c = document.querySelector('.s3pc-cnt'); return c && /צולמו ([5-9]|\d\d)/.test(c.textContent); }, null, { timeout: 60000 });
  const ui = await page.evaluate(() => {
    const r = document.querySelector('.s3pc'), bar = document.querySelector('.s3pc-bar'), btn = [...bar.querySelectorAll('button')];
    return { dir: getComputedStyle(r).direction, ins: document.querySelector('.s3pc-ins').textContent, cnt: document.querySelector('.s3pc-cnt').textContent,
      hint: document.querySelector('.s3pc-hint').textContent, btn: btn.map((b) => ({ t: b.textContent, h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) })),
      overflow: document.documentElement.scrollWidth > innerWidth, rtl: r.getAttribute('aria-label') };
  });
  await page.screenshot({ path: shot });
  check('מסך הצילום: RTL, הוראה בעברית, מונה, כפתורים בגובה 44 לפחות, בלי גלישה לרוחב', ui.dir === 'rtl' && ui.ins.includes('עמדו במקום אחד') && ui.ins.includes('ריקה מאנשים') && /צולמו \d+ מתוך \d+/.test(ui.cnt) && ui.btn.length === 3 && ui.btn.every((b) => b.h >= 44) && !ui.overflow, ui);
  await page.waitForFunction(() => window.__res, null, { timeout: 240000 });
  const res = await page.evaluate(() => window.__res);
  if (typeof res !== 'object') { check('צילום מדומה מלא הסתיים', false, res); }
  else {
    const { fullB64, ...rest } = res; R.full = rest;
    if (fullB64) fs.writeFileSync(outJpg, Buffer.from(fullB64, 'base64'));
    check('צילום מדומה מלא הסתיים עם תוצאה', true, `${res.meta.n} פריימים, ${res.ms}ms`);
    check('גודל התמונה המלאה 4096×2048 (או 2048×1024 בטלפון חלש) וזהה לתוכן', (res.w === 4096 || res.w === 2048) && res.h === res.w / 2 && res.full.w === res.w && res.full.h === res.h, res.full);
    check('JPEG מלא עד 2.5MB', res.type === 'image/jpeg' && res.fullBytes <= 2500000 && res.fullBytes > 20000, res.fullBytes + ' בתים');
    check('תמונה קטנה 1024×512 עד 150KB', res.sm.w === 1024 && res.sm.h === 512 && res.smBytes <= 150000, res.smBytes + ' בתים');
    check('meta: n, fovH, yawRef, dev', res.meta.n >= 20 && res.meta.fovH > 30 && res.meta.fovH < 90 && typeof res.meta.yawRef === 'number' && res.meta.dev === 'mock', res.meta);
    check('כיול שדה ראייה מצא את הערך של המצלמה המדומה (62°)', Math.abs(res.meta.fovL - 62) <= 2, res.meta.fovL);
    check('התמונה המחוברת תואמת לסצנה (שגיאה ממוצעת בפס |lat|≤60°)', res.err < 12, res.err);
  }
  const left = await page.evaluate(() => !!document.querySelector('.s3pc'));
  check('המסך נסגר אחרי החיבור', !left, left);
  await page.close();

  /* ---------- 2. ביטול ---------- */
  const p2 = await open();
  await p2.evaluate(() => { window.__res = undefined; window.__run({}).then((r) => (window.__res = r === null ? 'null' : 'value')); });
  await p2.waitForFunction(() => { const c = document.querySelector('.s3pc-cnt'); return c && /צולמו [1-9]/.test(c.textContent); }, null, { timeout: 30000 });
  await p2.click('.s3pc-bar [data-k=x]');
  await sleep(200);
  let st = await p2.evaluate(() => window.__res || (document.querySelector('.s3pc [data-k=x]') || {}).textContent);
  if (st !== 'null') { await p2.click('.s3pc-bar [data-k=x]'); await p2.waitForFunction(() => window.__res, null, { timeout: 5000 }); st = await p2.evaluate(() => window.__res); }
  check('ביטול מחזיר null וסוגר את המסך', st === 'null' && !(await p2.evaluate(() => !!document.querySelector('.s3pc'))), st);
  /* צלם שוב את האחרונה */
  await p2.evaluate(() => { window.__res = undefined; window.__run({ speed: 60 }).then((r) => (window.__res = r === null ? 'null' : 'value')); });
  await p2.waitForFunction(() => { const c = document.querySelector('.s3pc-cnt'); return c && /צולמו 2 /.test(c.textContent); }, null, { timeout: 30000 });
  const before = await p2.evaluate(() => document.querySelector('.s3pc-cnt').textContent);
  await p2.click('.s3pc-bar [data-k=r]');
  const after = await p2.evaluate(() => document.querySelector('.s3pc-cnt').textContent);
  check('"צלם שוב את האחרונה" מוריד את המונה באחד', /צולמו 2 /.test(before) && /צולמו 1 /.test(after), before + ' → ' + after);
  const cl = await p2.evaluate(async () => { const o = S3PanoCap.isOpen(), c = S3PanoCap.close(); await new Promise((r) => setTimeout(r, 100)); return { o, c, res: window.__res, left: !!document.querySelector('.s3pc'), after: S3PanoCap.isOpen() }; });
  check('S3PanoCap.close() (כפתור "חזרה") סוגר את המסך ומחזיר null', cl.o && cl.c && cl.res === 'null' && !cl.left && !cl.after, cl);
  await p2.close();

  /* ---------- 3. שגיאות: אין חיישן (מדומה), מצלמה אמיתית מזויפת בלי חיישן, הרשאה נדחתה ---------- */
  const errCase = async (name, setup, runArg, want) => {
    const p = await open();
    if (setup) await p.evaluate(setup);
    await p.evaluate((a) => { window.__res = undefined; window.__run(a).then((r) => (window.__res = r === null ? 'null' : 'value'), (e) => (window.__res = 'err:' + e.message)); }, runArg);
    await p.waitForFunction(() => { const m = document.querySelector('.s3pc-msg.on [data-k=c]'); return m && !m.hidden; }, null, { timeout: 15000 }).catch(() => {});
    const txt = await p.evaluate(() => { const m = document.querySelector('.s3pc-msg.on'); return m ? m.innerText.replace(/\s+/g, ' ') : ''; });
    await p.click('.s3pc-msg [data-k=c]').catch(() => {});
    await p.waitForFunction(() => window.__res, null, { timeout: 5000 }).catch(() => {});
    const r = await p.evaluate(() => window.__res);
    check(name, want.test(txt) && r === 'null', { txt, r });
    await p.close();
  };
  await errCase('אין חיישן כיוון (מדומה): הודעה בעברית ו-null', null, { silent: true }, /חיישן הכיוון/);
  await errCase('מצלמה אמיתית בלי אירועי deviceorientation: הודעה בעברית ו-null', null, { real: true }, /חיישן הכיוון/);
  await errCase('הרשאת מצלמה נדחתה: הודעה בעברית ו-null', () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); }, { real: true }, /אין הרשאה למצלמה/);
  await errCase('אין מצלמה בכלל: הודעה בעברית ו-null', () => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); }, { real: true }, /אין גישה למצלמה/);

  check('אין שגיאות JS', errors.length === 0, errors.slice(0, 5));
  await browser.close(); srv.close();
  const fail = R.checks.filter((c) => !c.ok).length;
  if (outJson) fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(fail ? `נכשלו ${fail} בדיקות` : `כל ${R.checks.length} הבדיקות עברו`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
