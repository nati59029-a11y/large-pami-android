'use strict';
// בדיקת דפדפן למנוע התלת מימד (שלב 2): טעינה עצלה, בלי CDN, ביצועים, גרירה/צביטה/הקשה, אין שגיאות JS, צילום 360px.
// הרצה: node app-source/www/store3d-dev/check.js <נתיב לצילום.png> [נתיב לתוצאות.json]   (דורש playwright + Chromium)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const shot = process.argv[2] || path.join(process.cwd(), 'store3d-360.png');
const out = process.argv[3];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

const srv = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, hasTouch: true, locale: 'he-IL' });
  const page = await ctx.newPage();
  const errors = [], reqs = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => reqs.push(r.url()));
  const R = { checks: [] };
  const check = (name, ok, ev) => { R.checks.push({ name, ok: !!ok, ev }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' – ' + ev); };

  await page.goto(base + '/store3d-dev/demo.html?n=300', { waitUntil: 'load' });
  check('three לא נטען לפני כניסה לתלת מימד', !reqs.some((u) => /three/.test(u)), reqs.length + ' בקשות, אף אחת לא vendor/three');
  await page.click('#go');
  await page.waitForFunction(() => window.__h || /שגיאה/.test(document.getElementById('info').textContent), null, { timeout: 30000 });
  const st = await page.evaluate(() => window.__h && window.__h.stats());
  check('three נטען אחרי הכניסה, ממקור מקומי', reqs.some((u) => /vendor\/three\/three\.module\.min\.js$/.test(u)) && reqs.some((u) => /three\.core\.min\.js$/.test(u)), 'module+core נטענו');
  check('אין בקשות לרשת חיצונית (CDN)', reqs.every((u) => u.startsWith(base)), reqs.filter((u) => !u.startsWith(base)).join(',') || 'הכל מ-' + base);
  R.stats = st;
  check('300 גופים נבנו', st && st.fx >= 300, st && (st.fx + ' גופים, ' + st.bays + ' מקטעים, ' + st.instances + ' מופעים'));
  check('בניית סצנה של 300 גופים < 50ms', st && st.buildMs < 50, st && st.buildMs + 'ms (כולל מודל גיאומטרי)');
  const times = await page.evaluate(() => { const a = []; for (let i = 0; i < 7; i++) a.push(window.__h.renderNow()); return a.sort((x, y) => x - y); });
  R.renderMs = times;
  const st2 = await page.evaluate(() => window.__h.stats());
  check('ציור פריים (מבט מלמעלה, 300 גופים)', true, 'חציון ' + times[3].toFixed(1) + 'ms ב-SwiftShader (מעבד, לא GPU) · ' + st2.calls + ' קריאות ציור · ' + st2.tris + ' משולשים');
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot });
  check('צילום 360px', fs.existsSync(shot), shot);

  // גרירה באצבע אחת במבט מלמעלה משנה את זווית המצלמה
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const c0 = (await page.evaluate(() => window.__h.stats())).cam;
  await touch('touchStart', [[180, 300]]); for (let i = 1; i <= 8; i++) await touch('touchMove', [[180 + i * 10, 300]]); await touch('touchEnd', []);
  await page.waitForTimeout(100);
  const c1 = (await page.evaluate(() => window.__h.stats())).cam;
  check('גרירה מסובבת (מלמעלה)', Math.hypot(c1[0] - c0[0], c1[2] - c0[2]) > 0.5, JSON.stringify(c0) + ' -> ' + JSON.stringify(c1));
  // צביטה (שתי אצבעות מתרחקות) מקרבת
  const d0 = Math.hypot(c1[0], c1[1], c1[2]);
  await touch('touchStart', [[150, 300], [210, 300]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[150 - i * 8, 300], [210 + i * 8, 300]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(100);
  const c2 = (await page.evaluate(() => window.__h.stats())).cam;
  check('צביטה מקרבת (מלמעלה)', c2[1] < c1[1] - 0.5, 'גובה מצלמה ' + c1[1] + ' -> ' + c2[1] + ' (d0=' + d0.toFixed(1) + ')');

  // מבט הליכה: גובה אדם, גרירה הולכת קדימה, אין מעבר דרך גופים/קירות
  await page.click('#walk');
  await page.waitForTimeout(100);
  const w0 = (await page.evaluate(() => window.__h.stats())).cam;
  check('מבט הליכה מגובה אדם', Math.abs(w0[1] - 1.6) < 0.01, 'גובה עין ' + w0[1] + ' מ\'');
  await touch('touchStart', [[180, 200]]); for (let i = 1; i <= 10; i++) await touch('touchMove', [[180, 200 + i * 15]]); await touch('touchEnd', []);
  await page.waitForTimeout(100);
  const w1 = (await page.evaluate(() => window.__h.stats())).cam;
  check('גרירה למטה = הליכה קדימה', Math.hypot(w1[0] - w0[0], w1[2] - w0[2]) > 0.3, JSON.stringify(w0) + ' -> ' + JSON.stringify(w1));
  for (let k = 0; k < 6; k++) { await touch('touchStart', [[180, 100]]); for (let i = 1; i <= 10; i++) await touch('touchMove', [[180, 100 + i * 40]]); await touch('touchEnd', []); }
  const w2 = await page.evaluate(() => { const s = window.__h.stats(), m = S3G.buildModel(S3G.sampleMap(300)); return { cam: s.cam, inside: S3G.inAnyRoom(m, s.cam[0] * 100, s.cam[2] * 100) }; });
  check('הליכה ארוכה נשארת בתוך החנות (התנגשות)', w2.inside, JSON.stringify(w2.cam));

  // הקשה על מדף בוחרת מקטע (מבט מלמעלה; סורקים נקודות עד שנבחר)
  await page.click('#top');
  let picked = '';
  for (let y = 180; y <= 520 && !picked; y += 30) for (let x = 40; x <= 320 && !picked; x += 40) {
    await touch('touchStart', [[x, y]]); await touch('touchEnd', []);
    await page.waitForTimeout(20);
    const t = await page.textContent('#info'); if (/נבחר מקטע/.test(t)) picked = t;
  }
  check('הקשה בוחרת מקטע', !!picked, picked || 'לא נבחר');

  // שחרור זיכרון
  const gone = await page.evaluate(() => { window.__h.destroy(); return !document.querySelector('#view canvas'); });
  check('destroy משחרר ומסיר את הקנבס', gone, 'canvas הוסר');
  // מפה פגומה לא מפילה
  const bad = await page.evaluate(async () => { const h = await Store3D.open(document.getElementById('view'), { rooms: [{ id: 'r1', p: [0, 0, 1, 1, 2, 2] }], fx: [{ id: 'f1', k: 'gon', x: 'z' }] }, {}); const s = h && h.stats(); h && h.destroy(); return s; });
  check('מפה פגומה לא מפילה את התצוגה', bad && bad.skip.length >= 2, bad && bad.skip.join(' | '));
  check('אין שגיאות JS', errors.length === 0, errors.join(' | ') || 'אין');
  R.errors = errors;
  if (out) fs.writeFileSync(out, JSON.stringify(R, null, 1));
  await browser.close(); srv.close();
  process.exit(R.checks.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
