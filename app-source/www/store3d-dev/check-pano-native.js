'use strict';
// בדיקת דפדפן לשלב 21ד: חיבור 360 דרך התוסף (S3PanoNative מדומה) והחזרה לחיבור ב-JS כשהוא נכשל או חסר.
// הרצה: node app-source/www/store3d-dev/check-pano-native.js   (playwright + Chromium המותקן)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const srv = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
});
/* תוסף מדומה: ok – מחזיר equirect אדום 2:1; fail – זורק אחרי התחלה; none – לא זמין */
const MOCK = (kind) => {
  window.__natCalls = 0;
  window.S3PanoNative = {
    available: () => Promise.resolve(kind !== 'none'),
    cancel: () => {},
    stitch: (frames, o, onP) => new Promise((res, rej) => {
      window.__natCalls++; window.__natArgs = { n: frames.length, W: o.W, yawRef: o.yawRef, fovL: o.fovL, q: frames.every((f) => f.q && f.q.length === 4 && f.blob) };
      onP(0.5);
      if (kind === 'fail') return setTimeout(() => rej(new Error('oom')), 50);
      const c = document.createElement('canvas'); c.width = o.W; c.height = o.W / 2; const g = c.getContext('2d'); g.fillStyle = '#c03020'; g.fillRect(0, 0, c.width, c.height);
      c.toBlob((b) => res({ full: b, fovL: 61.5, stats: { pairs: 9, inlierPairs: 8, rmsDeg: 0.05 } }), 'image/jpeg', 0.92);
    }),
  };
};
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true, locale: 'he-IL' });
  let fails = 0;
  const check = (name, ok, ev) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' – ' + JSON.stringify(ev)); };
  for (const kind of ['ok', 'fail', 'none']) {
    const p = await ctx.newPage(), errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(MOCK, kind);
    await p.goto(base + '/store3d-dev/pano-cap.html', { waitUntil: 'load' });
    await p.waitForFunction(() => window.__run && window.S3PanoCap);
    await p.evaluate(() => { window.__run({ width: 2048 }).then((r) => (window.__res = r || 'null'), (e) => (window.__res = 'err:' + e.message)); });
    await p.waitForFunction(() => window.__res, null, { timeout: 300000 });
    const r = await p.evaluate(() => ({ res: window.__res, calls: window.__natCalls, args: window.__natArgs }));
    const m = r.res && r.res.meta || {};
    if (kind === 'ok') {
      check('תוסף תקין: התוצאה מהתוסף, 2048×1024, קטנה 1024×512, fovL מהתוסף, הפריימים הועברו עם כיוון', r.calls === 1 && m.engine === 'native' && r.res.full.w === 2048 && r.res.full.h === 1024 && r.res.sm.w === 1024 && m.fovL === 61.5 && r.args.W === 2048 && r.args.q && r.args.n === m.n, { meta: m, args: r.args, full: r.res.full, sm: r.res.sm });
    } else if (kind === 'fail') {
      check('תוסף נכשל: חוזרים לחיבור ב-JS ומקבלים תמונה תקינה', r.calls === 1 && m.engine === 'js' && r.res.full.w === 2048 && r.res.err < 40, { engine: m.engine, err: r.res.err });
    } else {
      check('אין תוסף: חיבור ב-JS בלי לקרוא לתוסף', !r.calls && m.engine === 'js' && r.res.full.w === 2048, { engine: m.engine, calls: r.calls });
    }
    check('בלי שגיאות בדף (' + kind + ')', !errs.length, errs);
    await p.close();
  }
  await browser.close(); srv.close();
  console.log(fails ? 'נכשל: ' + fails : 'הכול עבר');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
